const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_SETTINGS,
  MAX_DELETE_SECONDS,
  MIN_DELETE_SECONDS,
  normalizeSettings,
  formatIncomingContent,
  shouldUploadAttachments,
  settingsSummary,
} = require('../src/privacy');

const message = {
  sender: '+61412345678',
  chatName: 'Secret Group',
  isGroup: true,
  text: 'THIS SHOULD NOT LEAK',
};

test('default settings are safe and stable', () => {
  assert.deepEqual(normalizeSettings(), DEFAULT_SETTINGS);
});

test('notification-only mode does not expose text or attachments', () => {
  const settings = { visibility: 'notification', hideSender: false };
  const output = formatIncomingContent(message, [{ path: '/tmp/secret.jpg' }], settings, '123', 'Alice');

  assert.match(output, /New message in Secret Group/);
  assert.doesNotMatch(output, /THIS SHOULD NOT LEAK/);
  assert.doesNotMatch(output, /secret\.jpg/);
});

test('notification-only plus hidden contact reveals neither sender nor group', () => {
  const output = formatIncomingContent(
    message,
    [{ path: '/tmp/secret.jpg' }],
    { visibility: 'notification', hideSender: true },
    '123',
    'Alice',
  );

  assert.equal(output, '<@123> New iMessage received.');
  assert.doesNotMatch(output, /Alice|Secret Group|THIS SHOULD NOT LEAK/);
});

test('hide contact preserves the message text', () => {
  const output = formatIncomingContent(
    message,
    [],
    { visibility: 'full', hideSender: true },
    '123',
    'Alice',
  );

  assert.match(output, /THIS SHOULD NOT LEAK/);
  assert.doesNotMatch(output, /Alice|Secret Group/);
});

test('full mode can mention attachment count without exposing a path', () => {
  const output = formatIncomingContent(
    { ...message, text: '' },
    [{ path: '/tmp/private.jpg' }],
    { visibility: 'full', hideSender: true },
    '123',
    'Alice',
  );

  assert.match(output, /1 attachment/);
  assert.doesNotMatch(output, /private\.jpg/);
});

test('delete timer values are clamped to allowed limits', () => {
  assert.equal(normalizeSettings({ deleteAfterSeconds: 1 }).deleteAfterSeconds, MIN_DELETE_SECONDS);
  assert.equal(normalizeSettings({ deleteAfterSeconds: 999999 }).deleteAfterSeconds, MAX_DELETE_SECONDS);
  assert.equal(normalizeSettings({ deleteAfterSeconds: '60' }).deleteAfterSeconds, DEFAULT_SETTINGS.deleteAfterSeconds);
});

test('invalid settings fall back instead of producing unsafe presentation policy', () => {
  const settings = normalizeSettings({ visibility: 'garbage', deleteMode: 'garbage', hideSender: 0 });
  assert.equal(settings.visibility, 'full');
  assert.equal(settings.deleteMode, 'keep');
  assert.equal(settings.hideSender, false);
});

test('settings summary describes the effective values', () => {
  assert.deepEqual(
    settingsSummary({ visibility: 'notification', hideSender: true, deleteMode: 'timer', deleteAfterSeconds: 30 }),
    {
      visibility: 'Notification only',
      contact: 'Hidden',
      deletion: 'Auto-delete after 30 seconds',
    },
  );
});

test('attachment uploads are disabled in notification mode', () => {
  assert.equal(shouldUploadAttachments({ visibility: 'notification' }), false);
  assert.equal(shouldUploadAttachments({ visibility: 'full' }), true);
});
