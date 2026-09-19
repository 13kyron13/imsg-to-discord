// imsg-to-discord: forwards incoming Messages (iMessage/SMS) on a Mac to a Discord channel,
// including photos and other attachments, and sends your Discord replies back through Messages.
// Setup instructions are in README.md.

const { Client, GatewayIntentBits } = require('discord.js');
const Database = require('better-sqlite3');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');

const execFileAsync = promisify(execFile);

const { DISCORD_TOKEN, CHANNEL_ID, OWNER_ID } = process.env;
if (!DISCORD_TOKEN || !CHANNEL_ID || !OWNER_ID) {
  console.error('Missing DISCORD_TOKEN, CHANNEL_ID or OWNER_ID. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const CHAT_DB = path.join(os.homedir(), 'Library/Messages/chat.db');
const ATTACH_DIR = path.join(os.homedir(), 'Library/Messages/Attachments');
const STATE_FILE = path.join(__dirname, 'state.json');
const CONTACTS_FILE = path.join(__dirname, 'contacts.json');

// Discord's upload limit is about 10 MB on a normal server. Raise it in .env
// (MAX_UPLOAD_MB=25, for example) if your server allows bigger uploads.
const MAX_UPLOAD_BYTES = (Number(process.env.MAX_UPLOAD_MB) || 9.5) * 1024 * 1024;
const MAX_FILES_PER_MESSAGE = 10;

// ---------- contacts (automatically read from macOS Contacts) ----------

// Normalize phone numbers so different formatting still matches.
// Examples:
//   "0412 345 678"    -> "61412345678"
//   "+61 412 345 678" -> "61412345678"
//   "0412345678"      -> "61412345678"
function clean(s) {
  if (!s) return '';

  let number = String(s).replace(/\D/g, '');

  // Australian local number -> international format
  if (number.startsWith('0') && number.length === 10) {
    number = '61' + number.slice(1);
  }

  return number;
}

// Contacts are cached for 60 seconds so we don't repeatedly query
// the entire macOS Contacts database for every incoming message.
let contactsCache = {};
let contactsCacheTime = 0;

async function loadContacts() {
  const now = Date.now();

  if (now - contactsCacheTime < 60000) {
    return contactsCache;
  }

  const script = `
tell application "Contacts"
    set output to {}
    repeat with p in people
        set personName to name of p

        repeat with ph in phones of p
            set phoneNumber to value of ph
            set end of output to phoneNumber & "\\t" & personName
        end repeat
    end repeat

    set AppleScript's text item delimiters to linefeed
    return output as text
end tell
`;

  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script]);

    const contacts = {};

    for (const line of stdout.trim().split('\\n')) {
      const tab = line.indexOf('\\t');

      if (tab === -1) continue;

      const number = clean(line.slice(0, tab));
      const name = line.slice(tab + 1).trim();

      if (number && name) {
        contacts[number] = name;
      }
    }

    contactsCache = contacts;
    contactsCacheTime = now;

    console.log(`Loaded ${Object.keys(contacts).length} phone numbers from Contacts.`);

    return contacts;
  } catch (err) {
    console.error('Could not read Contacts:', err.message);

    // If Contacts temporarily fails, keep using the last successful cache.
    return contactsCache;
  }
}

// ---------- state (last message seen + which Discord message maps to which chat) ----------
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { lastId: null, replyMap: {} };
  }
}
const state = loadState();
function saveState() {
  const keys = Object.keys(state.replyMap);
  if (keys.length > 500) {
    for (const k of keys.slice(0, keys.length - 500)) delete state.replyMap[k];
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

// ---------- read Messages database ----------
const db = new Database(CHAT_DB, { readonly: true, fileMustExist: true });

if (state.lastId === null) {
  // First run: start from "now" so old messages aren't dumped into Discord
  state.lastId = db.prepare('SELECT MAX(ROWID) AS m FROM message').get().m || 0;
  saveState();
}

const newMessages = db.prepare(`
  SELECT m.ROWID AS id, m.text, m.attributedBody, m.cache_has_attachments AS att,
         h.id AS sender, c.guid AS chat_guid, c.style AS chat_style, c.display_name AS chat_name
  FROM message m
  LEFT JOIN handle h ON m.handle_id = h.ROWID
  LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
  LEFT JOIN chat c ON c.ROWID = cmj.chat_id
  WHERE m.ROWID > ? AND m.is_from_me = 0 AND m.associated_message_type = 0
  ORDER BY m.ROWID
`);

const attachmentsFor = db.prepare(`
  SELECT a.filename, a.mime_type, a.transfer_name
  FROM attachment a
  JOIN message_attachment_join maj ON maj.attachment_id = a.ROWID
  WHERE maj.message_id = ?
  ORDER BY a.ROWID
`);

// Newer macOS often stores the text inside attributedBody instead of text
function decodeBody(buf) {
  if (!buf) return null;
  const marker = buf.indexOf('NSString');
  if (marker === -1) return null;
  let pos = marker + 'NSString'.length + 5;
  let len = buf[pos];
  if (len === 0x81) {
    len = buf.readUInt16LE(pos + 1);
    pos += 3;
  } else if (len === 0x82) {
    len = buf.readUInt32LE(pos + 1);
    pos += 5;
  } else {
    pos += 1;
  }
  return buf.subarray(pos, pos + len).toString('utf8');
}

// ---------- attachments ----------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The database stores paths like "~/Library/Messages/Attachments/...". Only allow files inside that folder.
function resolveAttachmentPath(p) {
  if (!p) return null;
  const full = path.resolve(p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);
  return full.startsWith(ATTACH_DIR + path.sep) ? full : null;
}

// Attachments can still be downloading when the message row appears.
// Wait until the file exists and has stopped growing.
async function waitForFile(file, tries = 10) {
  let lastSize = -1;
  for (let i = 0; i < tries; i++) {
    try {
      const size = fs.statSync(file).size;
      if (size > 0 && size === lastSize) return size;
      lastSize = size;
    } catch {
      lastSize = -1;
    }
    await sleep(1000);
  }
  return null;
}

// Returns files ready to upload plus short notes for anything that couldn't be uploaded.
// Any temporary converted files are added to tempFiles so the caller can delete them.
async function prepareAttachments(messageId, tempFiles) {
  const files = [];
  const notes = [];
  let total = 0;

  for (const a of attachmentsFor.all(messageId)) {
    // Skip link-preview data; it isn't a real attachment
    if (!a.filename || a.filename.endsWith('.pluginPayloadAttachment')) continue;

    const name = a.transfer_name || path.basename(a.filename);
    let file = resolveAttachmentPath(a.filename);
    if (!file) {
      notes.push(`[${name}: unavailable]`);
      continue;
    }

    const size = await waitForFile(file);
    if (!size) {
      notes.push(`[${name}: hasn't downloaded to the Mac]`);
      continue;
    }

    // iPhone photos are usually HEIC, which Discord can't preview. Convert to JPEG with macOS's built-in sips.
    let uploadName = name;
    const isHeic = /\.hei[cf]s?$/i.test(file) || /image\/hei[cf]/i.test(a.mime_type || '');
    if (isHeic) {
      const out = path.join(os.tmpdir(), `imsg-${messageId}-${files.length}.jpg`);
      try {
        await execFileAsync('sips', ['-s', 'format', 'jpeg', file, '--out', out]);
        tempFiles.push(out);
        file = out;
        uploadName = name.replace(/\.[^.]+$/, '') + '.jpg';
      } catch (err) {
        console.error('HEIC conversion failed, uploading original:', err.message);
      }
    }

    const finalSize = fs.statSync(file).size;
    if (files.length >= MAX_FILES_PER_MESSAGE) {
      notes.push(`[${name}: over the ${MAX_FILES_PER_MESSAGE}-file limit]`);
    } else if (total + finalSize > MAX_UPLOAD_BYTES) {
      notes.push(`[${name}: too large for Discord (${(finalSize / 1048576).toFixed(1)} MB)]`);
    } else {
      total += finalSize;
      files.push({ attachment: file, name: uploadName });
    }
  }

  return { files, notes };
}

// ---------- Discord ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    const rows = newMessages.all(state.lastId);
    if (rows.length) {
      const contacts = await loadContacts();
      const channel = await client.channels.fetch(CHANNEL_ID);
      for (const r of rows) {
        const tempFiles = [];
        try {
          const text = (r.text || decodeBody(r.attributedBody) || '').replace(/\uFFFC/g, '').trim();

          let files = [];
          let notes = [];
          if (r.att) ({ files, notes } = await prepareAttachments(r.id, tempFiles));

          let body = [text, ...notes].filter(Boolean).join('\n');
          if (!body) {
            body = files.length
              ? `(${files.length} attachment${files.length > 1 ? 's' : ''})`
              : '[unsupported message]';
          }

          const name = contacts[clean(r.sender)] || r.sender || 'Unknown';
          const isGroup = r.chat_style === 43;
          const header = isGroup
            ? `**${name}** in *${r.chat_name || 'group chat'}*`
            : `**${name}**`;
          const content = `<@${OWNER_ID}> ${header}: ${body}`.slice(0, 1900);

          // Only the owner can be pinged; @everyone etc. inside a text is ignored
          const allowedMentions = { users: [OWNER_ID] };

          let sent;
          try {
            sent = await channel.send({ content, files, allowedMentions });
          } catch (err) {
            if (!files.length) throw err;
            // Upload failed (too big, network, etc.): still deliver the text
            console.error('Upload failed:', err.message);
            sent = await channel.send({
              content: `${content}\n[attachment upload failed]`.slice(0, 1900),
              allowedMentions,
            });
          }

          if (r.chat_guid) state.replyMap[sent.id] = r.chat_guid;
          state.lastId = r.id;
          saveState();
        } finally {
          for (const f of tempFiles) fs.unlink(f, () => {});
        }
      }
    }
  } catch (err) {
    console.error('Poll error:', err.message);
  } finally {
    polling = false;
  }
}

// ---------- send via Messages (AppleScript) ----------
const SEND_SCRIPT = `on run argv
  tell application "Messages"
    send (item 2 of argv) to chat id (item 1 of argv)
  end tell
end run`;

client.on('messageCreate', async (msg) => {
  // Only you, only in your channel
  if (msg.author.bot || msg.channelId !== CHANNEL_ID || msg.author.id !== OWNER_ID) return;

  const refId = msg.reference && msg.reference.messageId;
  const guid = refId && state.replyMap[refId];
  if (!guid) {
    await msg.reply({
      content: "Use Discord's Reply on one of the forwarded messages so I know who to send to.",
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  execFile('osascript', ['-e', SEND_SCRIPT, guid, msg.content], (err, _stdout, stderr) => {
    if (err) console.error('Send error:', stderr || err.message);
    msg.react(err ? '❌' : '✅').catch(() => {});
  });
});

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}. Watching Messages...`);
  setInterval(poll, 2000);
});

client.login(DISCORD_TOKEN);
