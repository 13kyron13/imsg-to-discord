// Message Bridge: forwards incoming Messages (iMessage/SMS) on a Mac to a Discord channel,
// and sends your Discord replies back through Messages.
// Setup instructions are in README.md.

const { Client, GatewayIntentBits } = require('discord.js');
const Database = require('better-sqlite3');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { DISCORD_TOKEN, CHANNEL_ID, OWNER_ID } = process.env;
if (!DISCORD_TOKEN || !CHANNEL_ID || !OWNER_ID) {
  console.error('Missing DISCORD_TOKEN, CHANNEL_ID or OWNER_ID. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const CHAT_DB = path.join(os.homedir(), 'Library/Messages/chat.db');
const STATE_FILE = path.join(__dirname, 'state.json');
const CONTACTS_FILE = path.join(__dirname, 'contacts.json');

// ---------- contacts (number -> name), read from contacts.json ----------
// Strips everything except digits and "+", so invisible characters from copy/paste can't break matching
const clean = (s) => (s || '').replace(/[^\d+]/g, '');

// Re-read on each batch of new messages, so edits to contacts.json apply without a restart
function loadContacts() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8'));
    return Object.fromEntries(Object.entries(raw).map(([num, name]) => [clean(num), name]));
  } catch {
    return {};
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
      const contacts = loadContacts();
      const channel = await client.channels.fetch(CHANNEL_ID);
      for (const r of rows) {
        let text = (r.text || decodeBody(r.attributedBody) || '').replace(/\uFFFC/g, '').trim();
        if (!text) text = r.att ? '[attachment]' : '[unsupported message]';

        const name = contacts[clean(r.sender)] || r.sender || 'Unknown';
        const isGroup = r.chat_style === 43;
        const header = isGroup
          ? `**${name}** in *${r.chat_name || 'group chat'}*`
          : `**${name}**`;
        const content = `<@${OWNER_ID}> ${header}: ${text}`.slice(0, 1900);

        // Only the owner can be pinged; @everyone etc. inside a text is ignored
        const sent = await channel.send({ content, allowedMentions: { users: [OWNER_ID] } });
        if (r.chat_guid) state.replyMap[sent.id] = r.chat_guid;
        state.lastId = r.id;
        saveState();
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
