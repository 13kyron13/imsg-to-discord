const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const LinuxTransport = require('../src/transports/linux');

test('LinuxTransport speaks the documented NDJSON protocol', async () => {
  const originalCommand = process.env.LINUX_IMESSAGE_COMMAND;
  const originalArgs = process.env.LINUX_IMESSAGE_ARGS;

  process.env.LINUX_IMESSAGE_COMMAND = process.execPath;
  process.env.LINUX_IMESSAGE_ARGS = JSON.stringify([
    path.join(__dirname, 'fixtures', 'ndjson-backend.js'),
  ]);

  let transport;

  try {
    const received = new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('message event timeout')),
        3000
      );

      transport = new LinuxTransport();

      transport.start(message => {
        clearTimeout(timeout);
        resolve(message);
      }).catch(reject);
    });

    const message = await received;

    assert.deepEqual(message, {
      id: '1',
      chatId: 'chat-1',
      sender: '+61400000000',
      chatName: null,
      isGroup: false,
      service: 'imessage',
      text: 'hello',
      attachments: [],
    });

    assert.equal(transport.status().connected, true);

    await transport.sendText('chat-1', 'reply');
  } finally {
    await transport?.close();

    if (originalCommand === undefined) {
      delete process.env.LINUX_IMESSAGE_COMMAND;
    } else {
      process.env.LINUX_IMESSAGE_COMMAND = originalCommand;
    }

    if (originalArgs === undefined) {
      delete process.env.LINUX_IMESSAGE_ARGS;
    } else {
      process.env.LINUX_IMESSAGE_ARGS = originalArgs;
    }
  }
});
