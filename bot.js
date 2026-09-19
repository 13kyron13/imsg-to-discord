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

const { DISCORD_TOKEN, CHANNEL_ID, OWNER_ID } = process.env;
if (!DISCORD_TOKEN || !CHANNEL_ID || !OWNER_ID) {
  console.error('Missing DISCORD_TOKEN, CHANNEL_ID or OWNER_ID. Copy .env.example to .env.');
  process.exit(1);
}

const STATE_FILE = path.join(__dirname, 'state.json');
const CONTACTS_FILE = path.join(__dirname, 'contacts.json');

const DEFAULT_SETTINGS = {
  visibility: 'full',
  hideSender: false,
  deleteMode: 'keep',
  deleteAfterSeconds: 60,
};

function loadState() {
  try {
    const loaded = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return {
      lastId: loaded.lastId ?? null,
      replyMap: loaded.replyMap || {},
      deleteMap: loaded.deleteMap || {},
      settings: { ...DEFAULT_SETTINGS, ...(loaded.settings || {}) },
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
const TIMER_CHOICES = [
  ['Keep messages', 'keep'],
  ['Delete with button', 'button'],
  ['Auto-delete', 'timer'],
];

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
  const visibility = state.settings.visibility === 'notification'
    ? 'Notification only'
    : 'Show message contents';
  const contact = state.settings.hideSender ? 'Hidden' : 'Shown';
  let deletion = 'Keep messages';
  if (state.settings.deleteMode === 'button') deletion = 'Delete with button';
  if (state.settings.deleteMode === 'timer') {
    deletion = 'Auto-delete after ' + state.settings.deleteAfterSeconds + ' seconds';
  }

  return [
    '**Visibility:** ' + visibility,
    '**Contact:** ' + contact,
    '**Deletion:** ' + deletion,
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

function deleteButtonRow(messageId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('imsg:delete:' + messageId)
        .setLabel('Delete Discord copy')
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

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

function formatIncomingContent(message, files) {
  const name = contactName(message.sender) || 'Unknown';

  if (state.settings.visibility === 'notification') {
    let notification = 'New iMessage received.';
    if (!state.settings.hideSender) {
      notification = message.isGroup
        ? 'New message in ' + (message.chatName || 'group chat') + '.'
        : 'New message from ' + name + '.';
    }
    return '<@' + OWNER_ID + '> ' + notification;
  }

  let body = message.text || '';
  if (!body && files.length) {
    body = '(' + files.length + ' attachment' + (files.length > 1 ? 's' : '') + ')';
  }
  if (!body) body = '[unsupported message]';

  if (state.settings.hideSender) {
    return '<@' + OWNER_ID + '> New iMessage: ' + body;
  }

  const header = message.isGroup
    ? '**' + name + '** in *' + (message.chatName || 'group chat') + '*'
    : '**' + name + '**';

  return '<@' + OWNER_ID + '> ' + header + ': ' + body;
}

function scheduleDelete(messageId, channel, at) {
  const delay = Math.max(0, at - Date.now());

  setTimeout(async () => {
    try {
      const message = await channel.messages.fetch(messageId);
      await message.delete();
    } catch (err) {
      if (err?.code !== 10008) console.error('Scheduled delete failed:', err.message);
    } finally {
      delete state.replyMap[messageId];
      delete state.deleteMap[messageId];
      saveState();
    }
  }, delay);
}

async function restoreScheduledDeletes(channel) {
  const entries = Object.entries(state.deleteMap);
  for (const [messageId, at] of entries) {
    scheduleDelete(messageId, channel, Number(at));
  }
}

async function handleIncoming(message) {
  const channel = await client.channels.fetch(CHANNEL_ID);
  const files = state.settings.visibility === 'notification'
    ? []
    : await pollAttachments(message);
  const content = formatIncomingContent(message, files);

  const sent = await channel.send({
    content: content.slice(0, 1900),
    files,
    allowedMentions: { users: [OWNER_ID] },
  });

  if (message.chatId) state.replyMap[sent.id] = message.chatId;

  if (state.settings.deleteMode === 'button') {
    await sent.edit({ components: deleteButtonRow(sent.id) });
  } else if (state.settings.deleteMode === 'timer') {
    const deleteAt = Date.now() + state.settings.deleteAfterSeconds * 1000;
    state.deleteMap[sent.id] = deleteAt;
    scheduleDelete(sent.id, channel, deleteAt);
  }

  saveState();
}

async function registerSettingsCommand() {
  const channel = await client.channels.fetch(CHANNEL_ID);
  if (!channel.guild) return;

  const commands = await channel.guild.commands.fetch();
  const existing = commands.find(command => command.name === SETTINGS_COMMAND.name);

  if (existing) {
    await existing.edit(SETTINGS_COMMAND);
  } else {
    await channel.guild.commands.create(SETTINGS_COMMAND);
  }
}

function interactionIsOwner(interaction) {
  return interaction.user.id === OWNER_ID && interaction.channelId === CHANNEL_ID;
}

client.on('interactionCreate', async interaction => {
  if (!interactionIsOwner(interaction)) {
    if (interaction.isRepliable()) {
      await interaction.reply({
        content: 'This iMessage bot is restricted to its configured owner and channel.',
        ephemeral: true,
      }).catch(() => {});
    }
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'imsg-settings') {
    const visibility = interaction.options.getString('visibility');
    const hideContact = interaction.options.getBoolean('hide_contact');
    const deleteMode = interaction.options.getString('delete_mode');
    const deleteAfter = interaction.options.getInteger('delete_after');

    if (visibility) state.settings.visibility = visibility;
    if (hideContact !== null) state.settings.hideSender = hideContact;
    if (deleteMode) state.settings.deleteMode = deleteMode;
    if (deleteAfter !== null) {
      state.settings.deleteAfterSeconds = deleteAfter;
      state.settings.deleteMode = 'timer';
    }

    saveState();
    await interaction.reply({ ...settingsPanel(), ephemeral: true });
    return;
  }

  if (interaction.isButton()) {
    if (interaction.customId === 'imsg:settings:visibility') {
      state.settings.visibility = state.settings.visibility === 'full' ? 'notification' : 'full';
      saveState();
      await interaction.update(settingsPanel());
      return;
    }

    if (interaction.customId === 'imsg:settings:sender') {
      state.settings.hideSender = !state.settings.hideSender;
      saveState();
      await interaction.update(settingsPanel());
      return;
    }

    if (interaction.customId === 'imsg:settings:delete') {
      const modes = TIMER_CHOICES.map(choice => choice[1]);
      const index = modes.indexOf(state.settings.deleteMode);
      state.settings.deleteMode = modes[(index + 1) % modes.length];
      saveState();
      await interaction.update(settingsPanel());
      return;
    }

    if (interaction.customId === 'imsg:settings:timer') {
      const modal = new ModalBuilder()
        .setCustomId('imsg:settings:timer-modal')
        .setTitle('Set auto-delete timer');

      const input = new TextInputBuilder()
        .setCustomId('seconds')
        .setLabel('Seconds before the Discord copy is deleted')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('60')
        .setValue(String(state.settings.deleteAfterSeconds))
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId === 'imsg:settings:refresh') {
      await interaction.update(settingsPanel());
      return;
    }

    if (interaction.customId.startsWith('imsg:delete:')) {
      const messageId = interaction.customId.slice('imsg:delete:'.length);
      if (interaction.message.id !== messageId) return;

      delete state.replyMap[messageId];
      delete state.deleteMap[messageId];
      saveState();

      await interaction.deferUpdate();
      await interaction.message.delete().catch(err => {
        if (err?.code !== 10008) console.error('Button delete failed:', err.message);
      });
      return;
    }
  }

  if (interaction.isModalSubmit() && interaction.customId === 'imsg:settings:timer-modal') {
    const seconds = Number(interaction.fields.getTextInputValue('seconds'));

    if (!Number.isInteger(seconds) || seconds < 5 || seconds > 86400) {
      await interaction.reply({
        content: 'Enter a whole number from 5 to 86400 seconds.',
        ephemeral: true,
      });
      return;
    }

    state.settings.deleteAfterSeconds = seconds;
    state.settings.deleteMode = 'timer';
    saveState();

    await interaction.reply({ ...settingsPanel(), ephemeral: true });
  }
});

client.on('messageCreate', async msg => {
  if (msg.author.bot || msg.channelId !== CHANNEL_ID || msg.author.id !== OWNER_ID) return;

  const refId = msg.reference && msg.reference.messageId;
  const chatId = refId && state.replyMap[refId];

  if (!chatId) {
    await msg.reply({
      content: "Use Discord's Reply on one of the forwarded messages so I know who to send to.",
      allowedMentions: { repliedUser: false },
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

  try {
    await registerSettingsCommand();
    const channel = await client.channels.fetch(CHANNEL_ID);
    await restoreScheduledDeletes(channel);
  } catch (err) {
    console.error('Discord settings/deletion setup failed:', err.message);
  }

  await transport.start(handleIncoming);
});

async function shutdown() {
  await transport.close().catch(() => {});
  client.destroy();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

client.login(DISCORD_TOKEN);
