const { spawn } = require('child_process');
const readline = require('readline');
const { MessageTransport, normalizeMessage } = require('../transport');

const DEFAULT_RESTART_DELAY_MS = 5000;
const MAX_RESTART_DELAY_MS = 60000;

class LinuxTransport extends MessageTransport {
  constructor() {
    super();

    if (!process.env.LINUX_IMESSAGE_COMMAND) {
      throw new Error('Linux backend selected but LINUX_IMESSAGE_COMMAND is not configured.');
    }

    this.command = process.env.LINUX_IMESSAGE_COMMAND;

    try {
      this.args = process.env.LINUX_IMESSAGE_ARGS
        ? JSON.parse(process.env.LINUX_IMESSAGE_ARGS)
        : [];
    } catch (err) {
      throw new Error('LINUX_IMESSAGE_ARGS must be a JSON array: ' + err.message);
    }

    if (!Array.isArray(this.args) || this.args.some(arg => typeof arg !== 'string')) {
      throw new Error('LINUX_IMESSAGE_ARGS must be a JSON array of strings.');
    }

    this.child = null;
    this.closed = false;
    this.onMessage = null;
    this.restartTimer = null;
    this.restartDelay = DEFAULT_RESTART_DELAY_MS;
    this.rl = null;
  }

  spawnBackend() {
    if (this.closed || this.child) return;

    console.log('[linux] starting iMessage backend:', this.command);

    const child = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      env: process.env,
    });

    this.child = child;
    this.rl = readline.createInterface({ input: child.stdout });

    this.rl.on('line', (line) => {
      if (!line.trim()) return;

      try {
        const event = JSON.parse(line);

        if (event.event === 'message' && event.message) {
          Promise.resolve(this.onMessage?.(normalizeMessage(event.message)))
            .catch(err => console.error('[linux] incoming message handler failed:', err.message));
        } else if (event.event === 'error') {
          console.error('[linux backend]', event.message || 'unknown error');
        } else if (event.event === 'ready') {
          this.restartDelay = DEFAULT_RESTART_DELAY_MS;
          console.log('[linux] backend reports ready');
        }
      } catch (err) {
        console.error('[linux] invalid NDJSON from backend:', err.message);
      }
    });

    child.stderr.on('data', data => process.stderr.write('[linux backend] ' + data));

    child.on('error', err => {
      console.error('[linux] backend failed:', err.message);
    });

    child.on('exit', (code, signal) => {
      this.child = null;
      if (this.rl) this.rl.close();
      this.rl = null;

      if (this.closed) return;

      console.error('[linux] backend exited:', code, signal || 'none');
      this.scheduleRestart();
    });
  }

  scheduleRestart() {
    if (this.closed || this.restartTimer) return;

    const delay = this.restartDelay;
    console.log('[linux] restarting backend in ' + Math.ceil(delay / 1000) + 's');

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.spawnBackend();
      this.restartDelay = Math.min(this.restartDelay * 2, MAX_RESTART_DELAY_MS);
    }, delay);
  }

  async start(onMessage) {
    if (this.child || this.restartTimer) return;

    this.onMessage = onMessage;
    this.closed = false;
    this.spawnBackend();
  }

  async sendText(chatId, text) {
    if (!this.child || !this.child.stdin.writable) {
      throw new Error('Linux iMessage backend is not running');
    }

    const request = {
      action: 'send',
      chatId: String(chatId),
      text: String(text),
    };

    this.child.stdin.write(JSON.stringify(request) + '\n');
  }

  async close() {
    this.closed = true;

    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    if (this.child) {
      this.child.stdin.end();
      this.child.kill();
      this.child = null;
    }
  }
}

module.exports = LinuxTransport;
