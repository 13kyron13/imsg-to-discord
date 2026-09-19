const { spawn } = require('child_process');
const readline = require('readline');
const { MessageTransport, normalizeMessage } = require('../transport');

class LinuxTransport extends MessageTransport {
  constructor() {
    super();
    if (!process.env.LINUX_IMESSAGE_COMMAND) {
      throw new Error('Linux backend selected but LINUX_IMESSAGE_COMMAND is not configured.');
    }
    this.command = process.env.LINUX_IMESSAGE_COMMAND;
    this.args = process.env.LINUX_IMESSAGE_ARGS ? JSON.parse(process.env.LINUX_IMESSAGE_ARGS) : [];
    this.child = null;
    this.closed = false;
  }

  async start(onMessage) {
    this.child = spawn(this.command, this.args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false, env: process.env });
    const rl = readline.createInterface({ input: this.child.stdout });

    rl.on('line', line => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line);
        if (event.event === 'message' && event.message) onMessage(normalizeMessage(event.message));
        else if (event.event === 'error') console.error('[linux backend]', event.message || 'unknown error');
      } catch (err) {
        console.error('[linux] invalid NDJSON from backend:', err.message);
      }
    });

    this.child.stderr.on('data', data => process.stderr.write('[linux backend] ' + data));
    this.child.on('error', err => console.error('[linux] backend failed:', err.message));
    this.child.on('exit', (code, signal) => {
      this.child = null;
      if (!this.closed) console.error('[linux] backend exited:', code, signal || 'none');
    });
  }

  async sendText(chatId, text) {
    if (!this.child || !this.child.stdin.writable) throw new Error('Linux iMessage backend is not running');
    this.child.stdin.write(JSON.stringify({ action: 'send', chatId: String(chatId), text: String(text) }) + '\n');
  }

  async close() {
    this.closed = true;
    if (this.child) {
      this.child.stdin.end();
      this.child.kill();
      this.child = null;
    }
  }
}

module.exports = LinuxTransport;
