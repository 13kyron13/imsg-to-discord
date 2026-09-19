const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMessage } = require('../src/transport');

test('normalizeMessage creates the stable internal shape', () => {
  const result = normalizeMessage({
    id: 123,
    chatId: 456,
    sender: 789,
    chatName: null,
    isGroup: 1,
    service: 'sms',
    text: 42,
    attachments: [
      { path: '/tmp/a.jpg', name: 123, mimeType: 'image/jpeg' },
      null,
      { name: 'missing-path' },
    ],
  });

  assert.deepEqual(result, {
    id: '123',
    chatId: '456',
    sender: '789',
    chatName: null,
    isGroup: true,
    service: 'sms',
    text: '',
    attachments: [
      { path: '/tmp/a.jpg', name: '123', mimeType: 'image/jpeg' },
    ],
  });
});

test('normalizeMessage handles minimal events', () => {
  assert.deepEqual(normalizeMessage({ id: 'x' }), {
    id: 'x',
    chatId: null,
    sender: null,
    chatName: null,
    isGroup: false,
    service: null,
    text: '',
    attachments: [],
  });
});
