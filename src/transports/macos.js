const Database = require('better-sqlite3');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MessageTransport, normalizeMessage } = require('../transport');

const execFileAsync = promisify(execFile);
const CHAT_DB = path.join(os.homedir(), 'Library/Messages/chat.db');
const ATTACH_DIR = path.join(os.homedir(), 'Library/Messages/Attachments');
const MAX_UPLOAD_BYTES = (Number(process.env.MAX_UPLOAD_MB) || 9.5) * 1024 * 1024;

function clean(s) {
  if (!s) return '';
  let n = String(s).replace(/\D/g, '');
  if (n.startsWith('0') && n.length === 10) n = '61' + n.slice(1);
  return n;
}

let contactsCache = {};
let contactsCacheTime = 0;

async function loadContacts() {
  const now = Date.now();
  if (now - contactsCacheTime < 60000) return contactsCache;

  const script = `tell application "Contacts"
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
end tell`;

  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script]);
    const contacts = {};
    for (const line of stdout.trim().split('\\n')) {
      const tab = line.indexOf('\\t');
      if (tab === -1) continue;
      const number = clean(line.slice(0, tab));
      const name = line.slice(tab + 1).trim();
      if (number && name) contacts[number] = name;
    }
    contactsCache = contacts;
    contactsCacheTime = now;
    return contacts;
  } catch (err) {
    console.error('Could not read Contacts:', err.message);
    return contactsCache;
  }
}

function decodeBody(buf) {
  if (!buf || !Buffer.isBuffer(buf)) return null;
  const marker = buf.indexOf('NSString');
  if (marker === -1) return null;
  let pos = marker + 13;
  let len = buf[pos];
  if (len === 0x81) { len = buf.readUInt16LE(pos + 1); pos += 3; }
  else if (len === 0x82) { len = buf.readUInt32LE(pos + 1); pos += 5; }
  else pos += 1;
  return buf.subarray(pos, pos + len).toString('utf8');
}

async function waitForFile(file, tries = 10) {
  let last = -1;
  for (let i = 0; i < tries; i++) {
    try {
      const size = fs.statSync(file).size;
      if (size > 0 && size === last) return size;
      last = size;
    } catch { last = -1; }
    await new Promise(r => setTimeout(r, 1000));
  }
  return null;
}

function resolveAttachmentPath(p) {
  if (!p) return null;
  const full = path.resolve(p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);
  return full.startsWith(ATTACH_DIR + path.sep) ? full : null;
}

class MacOSTransport extends MessageTransport {
  constructor({ state, onStateChange }) {
    super();
    if (process.platform !== 'darwin') throw new Error('The macOS Messages backend only runs on macOS.');
    this.state = state;
    this.onStateChange = onStateChange;
    this.db = new Database(CHAT_DB, { readonly: true, fileMustExist: true });
    this.newMessages = this.db.prepare('SELECT m.ROWID AS id, m.text, m.attributedBody, m.cache_has_attachments AS att, h.id AS sender, c.guid AS chat_guid, c.style AS chat_style, c.display_name AS chat_name FROM message m LEFT JOIN handle h ON m.handle_id = h.ROWID LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID LEFT JOIN chat c ON c.ROWID = cmj.chat_id WHERE m.ROWID > ? AND m.is_from_me = 0 AND m.associated_message_type = 0 ORDER BY m.ROWID');
    this.attachmentsFor = this.db.prepare('SELECT a.filename, a.mime_type, a.transfer_name FROM attachment a JOIN message_attachment_join maj ON maj.attachment_id = a.ROWID WHERE maj.message_id = ? ORDER BY a.ROWID');

    if (this.state.lastId === null) {
      this.state.lastId = this.db.prepare('SELECT MAX(ROWID) AS m FROM message').get().m || 0;
      this.onStateChange();
    }
  }

  async getAttachments(messageId) {
    const files = [];
    const notes = [];
    let total = 0;

    for (const a of this.attachmentsFor.all(messageId)) {
      if (!a.filename || a.filename.endsWith('.pluginPayloadAttachment')) continue;
      const name = a.transfer_name || path.basename(a.filename);
      let file = resolveAttachmentPath(a.filename);
      if (!file) { notes.push('[' + name + ': unavailable]'); continue; }

      const size = await waitForFile(file);
      if (!size) { notes.push('[' + name + ': has not downloaded to the Mac]'); continue; }

      let uploadName = name;
      if (/\.hei[cf]s?$/i.test(file) || /image\/hei[cf]/i.test(a.mime_type || '')) {
        const out = path.join(os.tmpdir(), 'imsg-' + messageId + '-' + files.length + '.jpg');
        try {
          await execFileAsync('sips', ['-s', 'format', 'jpeg', file, '--out', out]);
          file = out;
          uploadName = name.replace(/\.[^.]+$/, '') + '.jpg';
        } catch (err) { console.error('HEIC conversion failed:', err.message); }
      }

      const finalSize = fs.statSync(file).size;
      if (files.length >= 10) notes.push('[' + name + ': over the 10-file limit]');
      else if (total + finalSize > MAX_UPLOAD_BYTES) notes.push('[' + name + ': too large for Discord (' + (finalSize / 1048576).toFixed(1) + ' MB)]');
      else {
        total += finalSize;
        files.push({ path: file, name: uploadName, mimeType: a.mime_type || null });
      }
    }

    return { files, notes };
  }

  async poll(onMessage) {
    const rows = this.newMessages.all(this.state.lastId);
    if (!rows.length) return;
    const contacts = await loadContacts();

    for (const r of rows) {
      const prepared = r.att ? await this.getAttachments(r.id) : { files: [], notes: [] };
      const text = (r.text || decodeBody(r.attributedBody) || '').replace(/\uFFFC/g, '').trim();
      await onMessage(normalizeMessage({
        id: String(r.id),
        chatId: r.chat_guid,
        sender: contacts[clean(r.sender)] || r.sender || 'Unknown',
        chatName: r.chat_name || null,
        isGroup: r.chat_style === 43,
        text: [text, ...prepared.notes].filter(Boolean).join('\n'),
        attachments: prepared.files
      }));
      this.state.lastId = r.id;
      this.onStateChange();
    }
  }

  async start(onMessage) {
    let polling = false;
    const tick = async () => {
      if (polling) return;
      polling = true;
      try { await this.poll(onMessage); }
      catch (err) { console.error('macOS transport poll error:', err.message); }
      finally { polling = false; }
    };
    await tick();
    this.timer = setInterval(tick, 2000);
  }

  async sendText(chatId, text) {
    const script = 'on run argv\ntell application "Messages"\nsend (item 2 of argv) to chat id (item 1 of argv)\nend tell\nend run';
    await execFileAsync('osascript', ['-e', script, String(chatId), String(text)]);
  }

  status() {
    return {
      backend: 'macos',
      connected: Boolean(this.db),
      details: this.db ? 'Messages database is open.' : 'Messages database is closed.',
    };
  }

  async close() {
    if (this.timer) clearInterval(this.timer);
    if (this.db) this.db.close();
  }
}

module.exports = MacOSTransport;
