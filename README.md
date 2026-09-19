# iMessage to Discord

Forwards incoming iMessage and SMS from a Mac to a private Discord channel, pings you, and lets you reply from Discord using Discord's Reply feature.

Works by reading the Mac's Messages database and sending replies through the Messages app with AppleScript. It runs on your own Mac with your own Discord bot. It is not a hosted or public bot.

## Requirements

- A Mac (left on and connected to Wi-Fi) signed into Messages with your Apple ID
- Node.js 20.6 or newer
- A private Discord server that only you are in

## Setup

### 1. Messages on the Mac

- Open Messages on the Mac and sign in with the same Apple ID as your iPhone.
- On your iPhone: Settings > Messages > Text Message Forwarding > turn on your Mac (needed for green-bubble SMS).
- Confirm a test text shows up in the Messages app on the Mac.

### 2. Keep the Mac awake

- Plug it in. In System Settings > Battery > Options, turn on "Prevent automatic sleeping on power adapter when the display is off".
- MacBooks sleep when the lid is closed. Leave the lid open, or use `sudo pmset -a disablesleep 1` (plugged in and ventilated only; undo with `sudo pmset -a disablesleep 0`).

### 3. Create the Discord bot

1. Go to https://discord.com/developers/applications and create a New Application.
2. Bot tab: reset and copy the token. Turn **Public Bot** off. Turn **Message Content Intent** on.
3. OAuth2 > URL Generator: scope `bot`, permissions View Channels, Send Messages, Read Message History, Add Reactions. Open the URL to add the bot to your private server.
4. In Discord, turn on Developer Mode (Settings > Advanced). Right-click your channel > Copy Channel ID. Right-click your name > Copy User ID.

### 4. Install

```
npm init -y
npm install discord.js better-sqlite3
```

Copy `.env.example` to `.env` and fill in the three values (no spaces around `=`, no quotes):

```
cp .env.example .env
nano .env
```

Optional, to show names instead of numbers: copy `contacts.example.json` to `contacts.json` and edit it. Numbers should look like `+61412345678`. Changes apply without restarting.

### 5. Give Terminal access to Messages

System Settings > Privacy & Security > Full Disk Access > add Terminal (then quit and reopen it).

### 6. Run

```
node --env-file=.env bot.js
```

macOS will ask if Terminal can control Messages. Click OK. Text yourself to test.

### 7. Start automatically (optional)

```
bash install-autostart.sh
```

Follow the Full Disk Access instruction it prints for Node. Check `err.log` if something doesn't work.

## Usage

- Every incoming text is posted to the channel and pings you.
- To reply, use Discord's **Reply** on a forwarded message. The bot sends your text to that conversation and reacts with a check mark (or a cross if it failed).
- Messages that aren't replies are ignored with a reminder.
- Only the Discord user in `OWNER_ID`, in `CHANNEL_ID`, can send anything.

## Security

- **Never commit `.env`, `contacts.json` or `state.json`.** `.gitignore` covers them.
- If a token ever leaks, reset it in the Developer Portal immediately.
- Verification codes and private messages will appear in the channel. Keep the server private to you, and remember the text passes through Discord's servers.
- This bot can send texts as you. Don't give anyone else access to the channel or the token.

## Limitations

- Attachments show as `[attachment]`; images aren't forwarded.
- Tapbacks/reactions are ignored.
- iPhone calls can't be detected.
- After a restart, the bot starts only once you've logged in to the Mac (an issue if FileVault is on).
- Apple changes the Messages database format now and then, which can break message decoding.
