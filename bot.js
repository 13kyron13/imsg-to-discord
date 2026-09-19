const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const MacOSTransport = require('./src/transports/macos');
const LinuxTransport = require('./src/transports/linux');
const {
  DEFAULT_SETTINGS,
  DELETE_MODES,
  MIN_DELETE_SECONDS,
  MAX_DELETE_SECONDS,
  normalizeSettings,
  formatIncomingContent,
  shouldUploadAttachments,
  settingsSummary,
} = require('./src/privacy');

const { DISCORD_TOKEN, CHANNEL_ID, OWNER_ID } = process.env;
if (!DISCORD_TOKEN || !CHANNEL_ID || !OWNER_ID) {
  console.error('Missing DISCORD_TOKEN, CHANNEL_ID or OWNER_ID. Copy .env.example to .env.');
  process.exit(1);
}

const STATE_FILE = path.join(__dirname, 'state.json');
const CONTACTS_FILE = path.join(__dirname, 'contacts.json');

function loadState() {
  try {
    const loaded = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return {
      lastId: loaded.lastId ?? null,
      replyMap: loaded.replyMap || {},
      deleteMap: loaded.deleteMap || {},
      settings: normalizeSettings(loaded.settings || DEFAULT_SETTINGS),
    };
  } catch {
    return {
      lastId: null,
      replyMap: {},
      deleteMap: {},
      settings: { ...DEFAULT_SETTINGS },
    };
  }
}

const state = loadState();

function saveState() {
  const keys = Object.keys(state.replyMap);
  if (keys.length > 500) {
    for (const k of keys.slice(0, keys.length - 500)) {
      delete state.replyMap[k];
      delete state.deleteMap[k];
    }
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
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

  if (backend === 'macos') return new MacOSTransport({ state, onStateChange: saveState });
  if (backend === 'linux') return new LinuxTransport();
  throw new Error('Unsupported message backend: ' + backend + '. Supported backends are macos and linux.');
}

const transport = createTransport();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const MAX_UPLOAD_BYTES = (Number(process.env.MAX_UPLOAD_MB) || 9.5) * 1024 * 1024;
const SETTINGS_COMMAND = new SlashCommandBuilder()
  .setName('imsg-settings')
  .setDescription('Configure iMessage privacy and Discord deletion behavior')
  .addStringOption(option => option
    .setName('visibility')
    .setDescription('Show message contents or only a notification')
    .addChoices(
      { name: 'Show message', value: 'full' },
      { name: 'Notification only', value: 'notification' },
    ))
  .addBooleanOption(option => option
    .setName('hide_contact')
    .setDescription('Hide the sender/contact name in Discord'))
  .addStringOption(option => option
    .setName('delete_mode')
    .setDescription('What to do with forwarded Discord messages')
    .addChoices(
      { name: 'Keep messages', value: 'keep' },
      { name: 'Delete with a button', value: 'button' },
      { name: 'Auto-delete after a timer', value: 'timer' },
    ))
  .addIntegerOption(option => option
    .setName('delete_after')
    .setDescription('Auto-delete delay in seconds (5-86400)')
    .setMinValue(5)
    .setMaxValue(86400));

function settingsDescription() {
  const summary = settingsSummary(state.settings);
  return [
    '**Visibility:** ' + summary.visibility,
    '**Contact:** ' + summary.contact,
    '**Deletion:** ' + summary.deletion,
    '',
    'These settings affect newly forwarded iMessages.',
    'Deleting a Discord copy does not delete the original iMessage.',
  ].join('\n');
}

function settingsPanel() {
  const embed = new EmbedBuilder()
    .setTitle('iMessage privacy settings')
    .setDescription(settingsDescription())
    .setFooter({ text: 'Only the configured owner can change these settings.' });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('imsg:settings:visibility')
      .setLabel(state.settings.visibility === 'notification' ? 'Show contents' : 'Notification only')
      .setStyle(state.settings.visibility === 'notification' ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('imsg:settings:sender')
      .setLabel(state.settings.hideSender ? 'Show contact' : 'Hide contact')
      .setStyle(state.settings.hideSender ? ButtonStyle.Success : ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('imsg:settings:delete')
      .setLabel('Cycle deletion mode')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('imsg:settings:timer')
      .setLabel('Set timer')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('imsg:settings:refresh')
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row1, row2] };
}

