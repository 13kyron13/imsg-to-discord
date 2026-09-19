const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const MacOSTransport = require('./src/transports/macos');
const LinuxTransport = require('./src/transports/linux');

const { DISCORD_TOKEN, CHANNEL_ID, OWNER_ID } = process.env;
if (!DISCORD_TOKEN || !CHANNEL_ID || !OWNER_ID) {
  console.error('Missing DISCORD_TOKEN, CHANNEL_ID or OWNER_ID. Copy .env.example to .env.');
  process.exit(1);
}

const STATE_FILE = path.join(__dirname, 'state.json');
const CONTACTS_FILE = path.join(__dirname, 'contacts.json');

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { lastId: null, replyMap: {} }; }
}
const state = loadState();

function saveState() {
  const keys = Object.keys(state.replyMap);
  if (keys.length > 500) {
    for (const k of keys.slice(0, keys.length - 500)) delete state.replyMap[k];
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

function loadLocalContacts() {
  try { return JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8')); }
  catch { return {}; }
}

function contactName(value) {
  if (!value) return value;
  const contacts = loadLocalContacts();
  const raw = String(value);
  const digits = raw.replace(/\D/g, '');
  for (const [number, name] of Object.entries(contacts)) {
    if (String(number).replace(/\D/g, '') === digits) return name;
  }
  return raw;
}

function createTransport() {
  const requested = (process.env.MESSAGE_BACKEND || 'auto').toLowerCase();
  const backend = requested === 'auto'
    ? (process.platform === 'darwin' ? 'macos' : process.platform === 'linux' ? 'linux' : 'unsupported')
    : requested;

  if (backend === 'macos') {
    return new MacOSTransport({ state, onStateChange: saveState });
  }
  if (backend === 'linux') {
    return new LinuxTransport();
  }
  throw new Error('Unsupported message backend: ' + backend + '. Supported backends are macos and linux.');
}

const transport = createTransport();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const MAX_UPLOAD_BYTES = (Number(process.env.MAX_UPLOAD_MB) || 9.5) * 1024 * 1024;

async function pollAttachments(message) {
  const files = [];
  for (const a of message.attachments || []) {
    try {
      const stat = fs.statSync(a.path);
      if (files.length >= 10 || stat.size > MAX_UPLOAD_BYTES) continue;
      files.push({ attachment: a.path, name: a.name });
    } catch {}
  }
  return files;
}

async function handleIncoming(message) {
  const channel = await client.channels.fetch(CHANNEL_ID);
  const name = contactName(message.sender) || 'Unknown';
  const header = message.isGroup
    ? '**' + name + '** in *' + (message.chatName || 'group chat') + '*'
    : '**' + name + '**';

  const files = await pollAttachments(message);
  let body = message.text || '';
  if (!body && files.length) body = '(' + files.length + ' attachment' + (files.length > 1 ? 's' : '') + ')';
  if (!body) body = '[unsupported message]';

  const content = ('<@' + OWNER_ID + '> ' + header + ': ' + body).slice(0, 1900);
  const sent = await channel.send({
    content,
    files,
    allowedMentions: { users: [OWNER_ID] }
  });

  if (message.chatId) {
    state.replyMap[sent.id] = message.chatId;
    saveState();
  }
}

client.on('messageCreate', async msg => {
  if (msg.author.bot || msg.channelId !== CHANNEL_ID || msg.author.id !== OWNER_ID) return;

  const refId = msg.reference && msg.reference.messageId;
  const chatId = refId && state.replyMap[refId];

  if (!chatId) {
    await msg.reply({
      content: "Use Discord's Reply on one of the forwarded messages so I know who to send to.",
      allowedMentions: { repliedUser: false }
    });
    return;
  }

  try {
    await transport.sendText(chatId, msg.content);
    await msg.react('✅');
  } catch (err) {
    console.error('Send error:', err.message);
    await msg.react('❌').catch(() => {});
  }
});

client.once('clientReady', async () => {
  console.log('Logged in as ' + client.user.tag + '. Backend: ' + (process.env.MESSAGE_BACKEND || 'auto'));
  await transport.start(handleIncoming);
});

async function shutdown() {
  await transport.close().catch(() => {});
  client.destroy();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

client.login(DISCORD_TOKEN);
