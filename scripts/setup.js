#!/usr/bin/env node
'use strict';

// Guided setup for imsg-to-discord. Run it through setup.sh:
//   bash setup.sh              set everything up (safe to run again)
//   bash setup.sh doctor       check that everything is working
//   bash setup.sh permissions  open the Full Disk Access screen again
//   bash setup.sh uninstall    stop the bot and remove the background jobs

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');
const ENV_EXAMPLE = path.join(ROOT, '.env.example');
const OUT_LOG = path.join(ROOT, 'out.log');
const ERR_LOG = path.join(ROOT, 'err.log');

const API = process.env.DISCORD_API || 'https://discord.com/api/v10';
const DRY = process.env.SETUP_DRY_RUN === '1'; // used by tests: skip launchctl / open

const LABEL = 'com.user.discordbridge';
const AWAKE_LABEL = 'com.user.discordbridge.awake';
const AGENTS_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents');

// View Channels + Send Messages + Read Message History + Add Reactions + Attach Files
const PERMISSIONS = 1024 + 2048 + 65536 + 64 + 32768;
// GATEWAY_MESSAGE_CONTENT (1<<18) or GATEWAY_MESSAGE_CONTENT_LIMITED (1<<19)
const MESSAGE_CONTENT_FLAGS = (1 << 18) | (1 << 19);

const PERMISSION_ERROR = /unable to open database|not permitted|authorization denied|EPERM|EACCES/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- helpers

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2];
  }
  return out;
}

function readEnv() {
  try {
    return parseEnv(fs.readFileSync(ENV_FILE, 'utf8'));
  } catch {
    return {};
  }
}

// Update or add KEY=value lines, keeping everything else in the file as it was.
function upsertEnv(text, values) {
  let out = text;
  for (const [key, value] of Object.entries(values)) {
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(out)) {
      out = out.replace(re, () => `${key}=${value}`);
    } else {
      out = out.replace(/\n*$/, '\n') + `${key}=${value}\n`;
    }
  }
  return out;
}

function writeEnv(values) {
  let text = '';
  if (fs.existsSync(ENV_FILE)) text = fs.readFileSync(ENV_FILE, 'utf8');
  else if (fs.existsSync(ENV_EXAMPLE)) text = fs.readFileSync(ENV_EXAMPLE, 'utf8');
  fs.writeFileSync(ENV_FILE, upsertEnv(text, values), { mode: 0o600 });
  fs.chmodSync(ENV_FILE, 0o600); // the token is a secret: only you can read this file
}

function inviteUrl(appId) {
  const scope = encodeURIComponent('bot applications.commands');
  return `https://discord.com/oauth2/authorize?client_id=${appId}&permissions=${PERMISSIONS}&scope=${scope}`;
}

const xml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function buildPlist({ label, args, cwd, env, stdout, stderr }) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    `  <key>Label</key><string>${xml(label)}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...args.map((a) => `    <string>${xml(a)}</string>`),
    '  </array>',
  ];
  if (cwd) lines.push(`  <key>WorkingDirectory</key><string>${xml(cwd)}</string>`);
  if (env) {
    lines.push('  <key>EnvironmentVariables</key>', '  <dict>');
    for (const [k, v] of Object.entries(env)) {
      lines.push(`    <key>${xml(k)}</key><string>${xml(v)}</string>`);
    }
    lines.push('  </dict>');
  }
  lines.push('  <key>RunAtLoad</key><true/>', '  <key>KeepAlive</key><true/>');
  if (stdout) lines.push(`  <key>StandardOutPath</key><string>${xml(stdout)}</string>`);
  if (stderr) lines.push(`  <key>StandardErrorPath</key><string>${xml(stderr)}</string>`);
  lines.push('</dict>', '</plist>', '');
  return lines.join('\n');
}

function tail(file, maxBytes = 4000) {
  try {
    const buf = fs.readFileSync(file);
    return buf.subarray(Math.max(0, buf.length - maxBytes)).toString('utf8');
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------- prompts

let ioCache = null;

function askHidden(prompt) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n' || c === '\u0004') {
          stdin.setRawMode(false);
          stdin.removeListener('data', onData);
          stdin.pause();
          process.stdout.write('\n');
          return resolve(buf.trim());
        }
        if (c === '\u0003') {
          process.stdout.write('\n');
          process.exit(130);
        }
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1);
        else buf += c;
      }
    };
    stdin.on('data', onData);
  });
}

function getIO() {
  if (ioCache) return ioCache;
  if (process.stdin.isTTY) {
    ioCache = {
      async ask(question) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise((resolve) => rl.question(question, resolve));
        rl.close();
        return answer.trim();
      },
      askHidden,
    };
  } else {
    // Not a terminal (used by tests): read all answers up front
    const lines = fs.readFileSync(0, 'utf8').split(/\r?\n/);
    const next = async (question) => {
      process.stdout.write(question + '\n');
      return (lines.shift() || '').trim();
    };
    ioCache = { ask: next, askHidden: next };
  }
  return ioCache;
}

const ask = (q) => getIO().ask(q);
const pause = (q = 'Press Enter to continue... ') => ask(q);

async function confirm(question, defaultYes = true) {
  const answer = (await ask(`${question} ${defaultYes ? '[Y/n]' : '[y/N]'} `)).toLowerCase();
  if (!answer) return defaultYes;
  return answer.startsWith('y');
}

async function choose(title, items, label) {
  console.log(`\n${title}`);
  items.forEach((item, i) => console.log(`  ${i + 1}. ${label(item)}`));
  for (let attempt = 0; attempt < 5; attempt++) {
    const n = parseInt(await ask('Type a number and press Enter: '), 10);
    if (n >= 1 && n <= items.length) return items[n - 1];
    console.log('  That wasn\'t one of the numbers above. Try again.');
  }
  throw new Error('No choice was made.');
}

// ---------------------------------------------------------------- Discord

async function discord(method, route, token, body) {
  const res = await fetch(API + route, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'imsg-to-discord-setup',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const err = new Error(
      `Discord said no (${res.status})${json && json.message ? `: ${json.message}` : ''}`
    );
    err.status = res.status;
    throw err;
  }
  return json;
}

async function loadBot(token) {
  const [me, app] = await Promise.all([
    discord('GET', '/users/@me', token),
    discord('GET', '/oauth2/applications/@me', token),
  ]);
  return { me, app };
}

// ---------------------------------------------------------------- launchd

const uid = () => (typeof process.getuid === 'function' ? process.getuid() : 501);
const domain = () => `gui/${uid()}`;
const plistPath = (label) => path.join(AGENTS_DIR, `${label}.plist`);

function launchctl(...args) {
  return spawnSync('launchctl', args, { encoding: 'utf8' });
}

function serviceState(label) {
  const r = launchctl('print', `${domain()}/${label}`);
  if (r.status !== 0) return { installed: false, running: false };
  const state = /state = (\S+)/.exec(r.stdout);
  const pid = /\bpid = (\d+)/.exec(r.stdout);
  return {
    installed: true,
    running: Boolean(pid) || (state && state[1] === 'running'),
    state: state ? state[1] : 'unknown',
  };
}

async function installAgent(options) {
  fs.mkdirSync(AGENTS_DIR, { recursive: true });
  const file = plistPath(options.label);
  fs.writeFileSync(file, buildPlist(options));
  launchctl('bootout', `${domain()}/${options.label}`); // fine if it wasn't loaded
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(attempt === 0 ? 300 : 1000);
    last = launchctl('bootstrap', domain(), file);
    if (last.status === 0) return;
  }
  throw new Error(`Couldn't start ${options.label}: ${(last.stderr || '').trim() || 'unknown error'}`);
}

function removeAgent(label) {
  launchctl('bootout', `${domain()}/${label}`);
  try {
    fs.unlinkSync(plistPath(label));
  } catch {
    /* already gone */
  }
}

function restartBot() {
  launchctl('kickstart', '-k', `${domain()}/${LABEL}`);
}

function nodePath() {
  return fs.realpathSync(process.execPath);
}

function openFullDiskAccess() {
  if (DRY) return;
  spawnSync('open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles']);
  spawnSync('open', ['-R', nodePath()]); // shows the file in Finder so it can be dragged in
}

function openUrl(url) {
  if (!DRY) spawnSync('open', [url]);
}

// Other copies of the bot (from earlier manual runs) would post every message twice
function findStrayBots() {
  const r = spawnSync('pgrep', ['-f', 'bot\\.js'], { encoding: 'utf8' });
  const pids = (r.stdout || '')
    .split(/\s+/)
    .filter(Boolean)
    .map(Number)
    .filter((pid) => pid !== process.pid);
  if (!pids.length) return [];
  const ps = spawnSync('ps', ['-o', 'pid=,command=', '-p', pids.join(',')], { encoding: 'utf8' });
  return (ps.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean);
}

// ---------------------------------------------------------------- setup

async function fullDiskAccessFlow() {
  console.log('\nThe bot needs "Full Disk Access" so it can read your messages.');
  console.log('A settings window and a Finder window are opening:');
  console.log('  1. Drag the highlighted "node" file from Finder into the Full Disk Access list');
  console.log('     (or click + and pick it), then make sure its switch is ON.');
  openFullDiskAccess();
  await pause('Press Enter once the switch is on... ');
}

async function startAndVerify() {
  fs.writeFileSync(ERR_LOG, '');
  fs.writeFileSync(OUT_LOG, '');
  for (let round = 0; round < 3; round++) {
    if (round > 0) restartBot();
    process.stdout.write('Starting the bot');
    for (let i = 0; i < 8; i++) {
      await sleep(1000);
      process.stdout.write('.');
    }
    process.stdout.write('\n');

    const errText = tail(ERR_LOG);
    const state = serviceState(LABEL);
    if (PERMISSION_ERROR.test(errText)) {
      await fullDiskAccessFlow();
      fs.writeFileSync(ERR_LOG, '');
      continue;
    }
    if (!state.running) {
      console.log('\n⚠️  The bot stopped right after starting. Last messages:\n');
      console.log(errText.trim().split('\n').slice(-15).join('\n') || '(no error text)');
      return false;
    }
    return true;
  }
  return false;
}

async function setup() {
  console.log('\n=== imsg-to-discord setup ===');
  console.log('You\'ll need a Discord bot token. Get one at https://discord.com/developers/applications');
  console.log('(New Application > Bot tab > Reset Token). It stays on this Mac.\n');

  const existing = readEnv();
  let token = existing.DISCORD_TOKEN || '';
  let bot = null;

  if (token) {
    try {
      bot = await loadBot(token);
      console.log(`Found saved settings for the bot "${bot.me.username}".`);
      if (!(await confirm('Keep using this bot?'))) {
        token = '';
        bot = null;
      }
    } catch {
      token = '';
    }
  }

  for (let attempt = 0; !bot && attempt < 3; attempt++) {
    token = await getIO().askHidden('Paste your bot token (it won\'t show as you type) and press Enter: ');
    try {
      bot = await loadBot(token);
    } catch (err) {
      console.log(err.status === 401
        ? '  That token didn\'t work. Copy it again from the Bot tab (use Reset Token for a fresh one).'
        : `  ${err.message}`);
    }
  }
  if (!bot) throw new Error('Couldn\'t log in with that token.');
  const { me, app } = bot;
  console.log(`✅ Logged in as "${me.username}"`);

  if (app.bot_public) {
    console.log('⚠️  "Public Bot" is on. Turn it off in the Bot tab so nobody else can add your bot.');
  }

  let intentOk = (app.flags & MESSAGE_CONTENT_FLAGS) !== 0;
  for (let attempt = 0; !intentOk && attempt < 4; attempt++) {
    console.log('\n❌ "Message Content Intent" is off. In the Developer Portal open your app > Bot tab,');
    console.log('   scroll to "Privileged Gateway Intents", switch on "Message Content Intent", and click Save.');
    await pause('Press Enter when that\'s done... ');
    intentOk = ((await loadBot(token)).app.flags & MESSAGE_CONTENT_FLAGS) !== 0;
  }
  if (!intentOk) throw new Error('Message Content Intent is still off.');
  console.log('✅ Message Content Intent is on');

  // Which server and channel
  let channelId = existing.CHANNEL_ID;
  let ownerId = existing.OWNER_ID;
  const reuse = token === existing.DISCORD_TOKEN && channelId && ownerId;

  if (!reuse) {
    const invite = inviteUrl(app.id);
    console.log('\nNow add the bot to your private server. Opening this link (or copy it into a browser):');
    console.log(`\n  ${invite}\n`);
    openUrl(invite);

    let guilds = [];
    for (let attempt = 0; attempt < 5 && !guilds.length; attempt++) {
      await pause('Press Enter once you\'ve added the bot to your server... ');
      guilds = await discord('GET', '/users/@me/guilds', token);
      if (!guilds.length) console.log('  The bot isn\'t in any server yet. Use the link above, then try again.');
    }
    if (!guilds.length) throw new Error('The bot still isn\'t in a server.');

    const guild = guilds.length === 1 ? guilds[0] : await choose('Which server?', guilds, (g) => g.name);
    const channels = (await discord('GET', `/guilds/${guild.id}/channels`, token))
      .filter((c) => c.type === 0 || c.type === 5)
      .sort((a, b) => a.position - b.position);
    if (!channels.length) throw new Error('That server has no text channels the bot can use.');
    const channel = await choose(
      `Which channel should your texts go to? (in "${guild.name}")`,
      channels,
      (c) => `#${c.name}`
    );
    channelId = channel.id;

    // Only this Discord user can send messages through the bot
    const owner = (app.team && { id: app.team.owner_user_id }) || app.owner;
    if (owner && (await confirm(`\nOnly ${owner.username ? `"${owner.username}"` : 'the app owner'} will be able to reply through the bot. Is that you?`))) {
      ownerId = owner.id;
    } else {
      ownerId = '';
      for (let attempt = 0; attempt < 3 && !/^\d{15,25}$/.test(ownerId); attempt++) {
        ownerId = await ask('Paste your Discord user ID (Discord > Settings > Advanced > Developer Mode, then right-click yourself > Copy User ID): ');
      }
      if (!/^\d{15,25}$/.test(ownerId)) throw new Error('That doesn\'t look like a Discord user ID.');
    }
  }

  writeEnv({ DISCORD_TOKEN: token, CHANNEL_ID: channelId, OWNER_ID: ownerId });
  console.log('\n✅ Saved your settings to .env');

  try {
    await discord('POST', `/channels/${channelId}/messages`, token, {
      content: '✅ imsg-to-discord is set up. Your texts will show up here.',
      allowed_mentions: { parse: [] },
    });
    console.log('✅ Sent a test message to Discord. Check your channel!');
  } catch (err) {
    console.log(`\n❌ The bot couldn't post in that channel. ${err.message}`);
    console.log('   In Discord: right-click the channel > Edit Channel > Permissions, and allow the bot to');
    console.log('   View Channel, Send Messages and Attach Files. Then run this setup again.');
    throw new Error('Setup stopped before starting the bot.');
  }

  if (DRY) {
    console.log('\n(dry run: skipping background jobs)');
    return;
  }

  const stray = findStrayBots();
  if (stray.length) {
    console.log('\n⚠️  Another copy of the bot seems to be running already (it would post every text twice):');
    stray.forEach((l) => console.log('   ' + l.slice(0, 110)));
    if (await confirm('Stop those copies now?', true)) {
      spawnSync('pkill', ['-f', 'bot\\.js']);
      await sleep(1000);
    }
  }

  const keepAwake = await confirm('\nKeep this Mac from sleeping while it\'s idle? (Recommended. Closing the lid still sleeps it.)');
  if (keepAwake) {
    await installAgent({ label: AWAKE_LABEL, args: ['/usr/bin/caffeinate', '-i'] });
  } else {
    removeAgent(AWAKE_LABEL);
  }

  const node = process.execPath;
  await installAgent({
    label: LABEL,
    args: [node, '--env-file=.env', 'bot.js'],
    cwd: ROOT,
    env: { PATH: `${path.dirname(node)}:/usr/bin:/bin:/usr/sbin:/sbin` },
    stdout: OUT_LOG,
    stderr: ERR_LOG,
  });

  const ok = await startAndVerify();

  console.log('\n=== Almost done ===');
  console.log(ok ? '✅ The bot is running in the background and starts by itself when you log in.'
                 : '⚠️  The bot isn\'t running yet. Run "bash setup.sh doctor" to see what\'s wrong.');
  console.log('\nTwo things only you can do:');
  console.log('  1. On this Mac, open Messages and sign in with the same Apple ID as your iPhone.');
  console.log('  2. On your iPhone: Settings > Messages > Text Message Forwarding > turn on this Mac.');
  console.log('\nThen text yourself. It should appear in Discord within a few seconds.');
  console.log('macOS may ask if the bot can control Messages or read Contacts: click OK.');
  console.log('If anything looks wrong:  bash setup.sh doctor');
}

// ---------------------------------------------------------------- doctor

async function doctor() {
  let problems = 0;
  const check = (ok, good, bad, fix) => {
    console.log(`${ok ? '✅' : '❌'} ${ok ? good : bad}`);
    if (!ok) {
      problems++;
      if (fix) console.log(`   → ${fix}`);
    }
    return ok;
  };

  console.log('\n=== imsg-to-discord doctor ===\n');

  const major = Number(process.versions.node.split('.')[0]);
  check(major >= 22, `Node.js ${process.versions.node}`, `Node.js ${process.versions.node} is too old`, 'Run "bash setup.sh" again.');

  const env = readEnv();
  const haveEnv = check(
    Boolean(env.DISCORD_TOKEN && env.CHANNEL_ID && env.OWNER_ID),
    'Settings file (.env) is filled in',
    'Settings file (.env) is missing or incomplete',
    'Run "bash setup.sh" to create it.'
  );

  if (haveEnv) {
    try {
      const { me, app } = await loadBot(env.DISCORD_TOKEN);
      check(true, `Discord token works (bot "${me.username}")`);
      check((app.flags & MESSAGE_CONTENT_FLAGS) !== 0, 'Message Content Intent is on',
        'Message Content Intent is off',
        'Developer Portal > your app > Bot > Privileged Gateway Intents > Message Content Intent > Save.');
      check(!app.bot_public, '"Public Bot" is off', '"Public Bot" is on (anyone could add your bot)',
        'Developer Portal > your app > Bot > turn off Public Bot.');
    } catch (err) {
      check(false, '', `Discord token doesn't work (${err.message})`,
        'Get a fresh token in the Developer Portal (Bot > Reset Token), then run "bash setup.sh".');
    }
    try {
      await discord('GET', `/channels/${env.CHANNEL_ID}`, env.DISCORD_TOKEN);
      check(true, 'The bot can see your channel');
    } catch (err) {
      check(false, '', `The bot can't see your channel (${err.message})`,
        'Make sure the bot is in your server and can view that channel, or run "bash setup.sh" to pick again.');
    }
  }

  const state = serviceState(LABEL);
  check(state.installed, 'Background job is installed', 'Background job is not installed', 'Run "bash setup.sh".');
  if (state.installed) {
    check(state.running, 'The bot is running', `The bot is not running (state: ${state.state})`,
      'Look at the errors below, or run "bash setup.sh permissions".');
  }

  const errText = tail(ERR_LOG);
  if (PERMISSION_ERROR.test(errText)) {
    check(false, '', 'The bot is being blocked from reading your messages',
      'Run "bash setup.sh permissions" and switch on Full Disk Access for "node", then run doctor again.');
  }
  if (errText.trim()) {
    console.log('\nLatest error messages from the bot:\n');
    console.log(errText.trim().split('\n').slice(-12).join('\n'));
  }

  console.log(problems ? `\n${problems} thing(s) need attention.` : '\nEverything looks good.');
  console.log('Checklist you have to do by hand: sign in to Messages on this Mac, and turn on');
  console.log('Text Message Forwarding for it on your iPhone (Settings > Messages).');
  process.exitCode = problems ? 1 : 0;
}

// ---------------------------------------------------------------- permissions / uninstall

async function permissions() {
  await fullDiskAccessFlow();
  restartBot();
  console.log('Restarted the bot. Text yourself to test, or run "bash setup.sh doctor".');
}

async function uninstall() {
  removeAgent(LABEL);
  removeAgent(AWAKE_LABEL);
  console.log('✅ Stopped the bot and removed its background jobs.');
  console.log('Your settings (.env) were left alone. Delete this folder to remove everything else,');
  console.log('and remove "node" from System Settings > Privacy & Security > Full Disk Access.');
}

// ---------------------------------------------------------------- main

async function main() {
  const command = process.argv[2] || 'setup';
  if (process.platform !== 'darwin' && !DRY) throw new Error('This setup is for macOS.');
  const commands = { setup, doctor, permissions, uninstall };
  if (!commands[command]) {
    throw new Error(`Unknown command "${command}". Use: setup, doctor, permissions or uninstall.`);
  }
  await commands[command]();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`\n❌ ${err.message}`);
    process.exit(1);
  });
}

module.exports = { parseEnv, upsertEnv, buildPlist, inviteUrl, PERMISSIONS, MESSAGE_CONTENT_FLAGS };
