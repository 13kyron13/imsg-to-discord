const DEFAULT_SETTINGS = Object.freeze({
  visibility: 'full',
  hideSender: false,
  deleteMode: 'keep',
  deleteAfterSeconds: 60,
});

const DELETE_MODES = ['keep', 'button', 'timer'];
const MIN_DELETE_SECONDS = 5;
const MAX_DELETE_SECONDS = 86400;

function normalizeSettings(settings = {}) {
  const visibility = settings.visibility === 'notification' ? 'notification' : 'full';
  const deleteMode = DELETE_MODES.includes(settings.deleteMode) ? settings.deleteMode : 'keep';
  const seconds = Number(settings.deleteAfterSeconds);

  return {
    visibility,
    hideSender: Boolean(settings.hideSender),
    deleteMode,
    deleteAfterSeconds: Number.isInteger(seconds)
      ? Math.min(MAX_DELETE_SECONDS, Math.max(MIN_DELETE_SECONDS, seconds))
      : DEFAULT_SETTINGS.deleteAfterSeconds,
  };
}

function formatIncomingContent(message, files, settings, ownerId, senderName) {
  const safe = normalizeSettings(settings);
  const name = senderName || 'Unknown';

  if (safe.visibility === 'notification') {
    let notification = 'New iMessage received.';
    if (!safe.hideSender) {
      notification = message.isGroup
        ? 'New message in ' + (message.chatName || 'group chat') + '.'
        : 'New message from ' + name + '.';
    }
    return '<@' + ownerId + '> ' + notification;
  }

  let body = message.text || '';
  if (!body && files.length) {
    body = '(' + files.length + ' attachment' + (files.length > 1 ? 's' : '') + ')';
  }
  if (!body) body = '[unsupported message]';

  if (safe.hideSender) {
    return '<@' + ownerId + '> New iMessage: ' + body;
  }

  const header = message.isGroup
    ? '**' + name + '** in *' + (message.chatName || 'group chat') + '*'
    : '**' + name + '**';

  return '<@' + ownerId + '> ' + header + ': ' + body;
}

function shouldUploadAttachments(settings) {
  return normalizeSettings(settings).visibility === 'full';
}

function settingsSummary(settings) {
  const safe = normalizeSettings(settings);
  const visibility = safe.visibility === 'notification' ? 'Notification only' : 'Show message contents';
  const contact = safe.hideSender ? 'Hidden' : 'Shown';
  let deletion = 'Keep messages';

  if (safe.deleteMode === 'button') deletion = 'Delete with button';
  if (safe.deleteMode === 'timer') deletion = 'Auto-delete after ' + safe.deleteAfterSeconds + ' seconds';

  return { visibility, contact, deletion };
}

module.exports = {
  DEFAULT_SETTINGS,
  DELETE_MODES,
  MIN_DELETE_SECONDS,
  MAX_DELETE_SECONDS,
  normalizeSettings,
  formatIncomingContent,
  shouldUploadAttachments,
  settingsSummary,
};
