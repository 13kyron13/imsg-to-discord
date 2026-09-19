const test = require('node:test');
const assert = require('node:assert/strict');
const LinuxTransport = require('../src/transports/linux');

test('LinuxTransport speaks the documented NDJSON protocol', async () => {
  const originalCommand = process.env.LINUX_IMESSAGE_COMMAND;
  const originalArgs = process.env.LINUX_IMESSAGE_ARGS;

  const backendCode = [
    "const readline=require('readline');",
    "setTimeout(()=>console.log(JSON.stringify({event:'message',message:{id:1,chatId:'chat-1',sender:'+61400000000',text:'hello',isGroup:false}})),50);",
    "const rl=readline.createInterface({input:process.stdin});",
    "rl.on('line',line=>{try{const r=JSON.parse(line);if(r.action==='send')process.stderr.write('received:'+r.chatId+'\\n')}catch{}});"
  ].join('');

  process.env.LINUX_IMESSAGE_COMMAND = process.execPath;
  process.env.LINUX_IMESSAGE_ARGS = JSON.stringify(['-e', backendCode]);

  try {
    const transport = new LinuxTransport();
    let gotMessage;
    const messagePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('message event timeout')), 2000);
      transport._testResolve = message => {
        clearTimeout(timeout);
        resolve(message);
      };
    });

    await transport.start(message => {
      gotMessage = message;
      transport._testResolve?.(message);
    });

    await messagePromise;

    assert.deepEqual(gotMessage, {
      id: '1',
      chatId: 'chat-1',
      sender: '+61400000000',
      chatName: null,
      isGroup: false,
      text: 'hello',
      attachments: [],
    });

    await assert.doesNotReject(() => transport.sendText('chat-1', 'reply'));
    await transport.close();
  } finally {
    if (originalCommand === undefined) delete process.env.LINUX_IMESSAGE_COMMAND;
    else process.env.LINUX_IMESSAGE_COMMAND = originalCommand;

    if (originalArgs === undefined) delete process.env.LINUX_IMESSAGE_ARGS;
    else process.env.LINUX_IMESSAGE_ARGS = originalArgs;
  }
});
