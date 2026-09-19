const test = require('node:test');
const assert = require('node:assert/strict');
const { LinuxTransport } = (() => {
  const LinuxTransport = require('../src/transports/linux');
  return { LinuxTransport };
})();

test('LinuxTransport speaks the documented NDJSON protocol', async () => {
  const originalCommand = process.env.LINUX_IMESSAGE_COMMAND;
  const originalArgs = process.env.LINUX_IMESSAGE_ARGS;

  const backendCode = [
    "const readline=require('readline');",
    "console.log(JSON.stringify({event:'ready'}));",
    "const rl=readline.createInterface({input:process.stdin});",
    "rl.on('line',line=>{try{const r=JSON.parse(line);if(r.action==='send')console.error('received send for '+r.chatId);}catch{}});"
  ].join('');

  process.env.LINUX_IMESSAGE_COMMAND = process.execPath;
  process.env.LINUX_IMESSAGE_ARGS = JSON.stringify(['-e', backendCode]);

  try {
    const transport = new LinuxTransport();
    let gotMessage;
    let resolveMessage;

    const messagePromise = new Promise(resolve => { resolveMessage = resolve; });
    const originalCommandValue = process.env.LINUX_IMESSAGE_ARGS;

    await transport.start(message => {
      gotMessage = message;
      resolveMessage(message);
    });

    transport.child.stdout.write(JSON.stringify({
      event: 'message',
      message: {
        id: 1,
        chatId: 'chat-1',
        sender: '+61400000000',
        text: 'hello',
        isGroup: false,
      },
    }) + '\n');

    await Promise.race([
      messagePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('message event timeout')), 2000)),
    ]);

    assert.deepEqual(gotMessage, {
      id: '1',
      chatId: 'chat-1',
      sender: '+61400000000',
      chatName: null,
      isGroup: false,
      text: 'hello',
      attachments: [],
    });

    await transport.sendText('chat-1', 'reply');
    await transport.close();
    assert.equal(process.env.LINUX_IMESSAGE_ARGS, originalCommandValue);
  } finally {
    if (originalCommand === undefined) delete process.env.LINUX_IMESSAGE_COMMAND;
    else process.env.LINUX_IMESSAGE_COMMAND = originalCommand;

    if (originalArgs === undefined) delete process.env.LINUX_IMESSAGE_ARGS;
    else process.env.LINUX_IMESSAGE_ARGS = originalArgs;
  }
});
