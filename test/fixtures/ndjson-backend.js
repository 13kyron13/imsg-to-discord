console.log(JSON.stringify({ event: 'ready' }));

setTimeout(() => {
  console.log(JSON.stringify({
    event: 'message',
    message: {
      id: 1,
      chatId: 'chat-1',
      sender: '+61400000000',
      text: 'hello',
      isGroup: false,
    },
  }));
}, 25);

require('readline')
  .createInterface({ input: process.stdin })
  .on('line', line => {
    try {
      const request = JSON.parse(line);

      if (request.action === 'send') {
        process.stderr.write('send:' + request.chatId + '\n');
      }
    } catch {
      // Ignore malformed test input.
    }
  });
