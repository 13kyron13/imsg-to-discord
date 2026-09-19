<<<<<<< HEAD
# iMessage to Discord
=======
# imsg-to-discord
>>>>>>> bcd3399 (Forward attachments to Discord)

Forward incoming iMessages and SMS from a Mac to a private Discord channel, get pinged when they arrive, and reply straight from Discord.

It runs on your own Mac with your own Discord bot. It is **not** a hosted or public bot: it reads your Mac's Messages database and sends texts as you, so it only ever works for the person who sets it up.

## Features

- Incoming texts appear in a Discord channel and ping you
- Show names instead of phone numbers using a simple `contacts.json` file (edits apply without restarting)
- Reply from Discord using Discord's **Reply** button; the bot sends your text back through Messages
- Works with iMessage, SMS (via Text Message Forwarding), and group chats
- Forwards photos and other attachments (iPhone HEIC photos are converted to JPEG so they preview in Discord)
- Only you can send anything (locked to your Discord user ID and one channel)
- Optional auto-start at login

## How it works

```
iPhone -> Mac (Messages app) -> bot.js reads the Messages database -> Discord channel
                                        ^                                  |
                                        +---- AppleScript sends reply <----+
```

## Requirements

- A Mac that stays on and connected to Wi-Fi, signed into Messages with your Apple ID
- Node.js 20.6 or newer
- A private Discord server that only you are in

## Setup

### 1. Get Messages working on the Mac

1. Open Messages on the Mac and sign in with the same Apple ID as your iPhone.
2. On your iPhone: **Settings > Messages > Text Message Forwarding**, and turn on your Mac (needed for green-bubble SMS).
3. Send yourself a test text and confirm it shows up in the Messages app on the Mac.

### 2. Keep the Mac awake

- Plug it in. In **System Settings > Battery > Options**, turn on "Prevent automatic sleeping on power adapter when the display is off".
- MacBooks sleep when the lid is closed. Leave the lid open, or run `sudo pmset -a disablesleep 1` (plugged in and well ventilated only; undo with `sudo pmset -a disablesleep 0`).

### 3. Create the Discord bot

1. Go to https://discord.com/developers/applications and click **New Application**.
2. **Bot** tab: reset and copy the token. Turn **Public Bot** off and **Message Content Intent** on.
3. **OAuth2 > URL Generator**: tick scope `bot`, then permissions **View Channels**, **Send Messages**, **Read Message History**, **Add Reactions**. Open the generated URL to add the bot to your private server.
4. In Discord, turn on **Developer Mode** (Settings > Advanced). Right-click your channel > **Copy Channel ID**. Right-click your own name > **Copy User ID**.

### 4. Install

```
git clone https://github.com/13kyron13/imsg-to-discord.git
cd imsg-to-discord
npm install
```

### 5. Configure

Create your settings file:

```
cp .env.example .env
nano .env
```

Fill in the three values (no spaces around `=`, no quotes):

```
DISCORD_TOKEN=your-bot-token
CHANNEL_ID=your-channel-id
OWNER_ID=your-user-id
```

Optional: if your Discord server allows larger uploads, add `MAX_UPLOAD_MB=25` (or your server's limit) to `.env`. The default is 9.5, which suits a normal server.

Optional: show names instead of numbers.

```
cp contacts.example.json contacts.json
nano contacts.json
```

Use the number exactly as it appears in Discord (usually `+` and country code, e.g. `+61412345678`). Spaces and hidden characters are ignored.

### 6. Give Terminal access to Messages

**System Settings > Privacy & Security > Full Disk Access** > add **Terminal**, then quit and reopen it. Without this the bot can't read the Messages database.

### 7. Run

```
node --env-file=.env bot.js
```

macOS will ask whether Terminal can control Messages. Click OK. Text yourself to test.

### 8. Start automatically (optional)

```
bash install-autostart.sh
```

Follow the Full Disk Access instruction it prints for Node, and check `err.log` if something doesn't work.

## Using it

- Every incoming text is posted to the channel and pings you.
- To reply, use Discord's **Reply** on a forwarded message. The bot sends your text to that conversation and reacts with a check mark (or a cross if it failed).
- A message that isn't a reply gets a reminder instead, because the bot needs the reply link to know who to send to.

## Files

| File | Purpose |
| --- | --- |
| `bot.js` | The bot |
| `.env` | Your private settings (never committed) |
| `contacts.json` | Your number-to-name list (never committed) |
| `state.json` | Bot's memory of the last message and reply links (never committed, created automatically) |
| `.env.example`, `contacts.example.json` | Templates to copy |
| `install-autostart.sh` | Sets up start-at-login |

## Troubleshooting

- **Numbers show instead of names:** check `contacts.json` is valid JSON (commas between lines, none after the last) and the number matches. Restart the bot if it still doesn't update.
- **Nothing arrives in Discord:** confirm the text shows in the Mac's Messages app, Terminal (or Node, if auto-starting) has Full Disk Access, and the Mac isn't asleep. Check `err.log`.
- **Every message posts twice:** two copies of the bot are running (e.g. Terminal plus auto-start), or the iPhone Shortcuts automation is still on. Stop extras with `pkill -f bot.js`.
- **Reply shows a cross:** macOS may not have granted permission to control Messages. Open System Settings > Privacy & Security > Automation and allow it.
- **`launchctl bootstrap` "Input/output error":** the service is probably already loaded. Run `launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.user.discordbridge.plist` first, then try again.

## Security

- **Never commit `.env`, `contacts.json` or `state.json`.** `.gitignore` covers them.
- If a token ever leaks, reset it immediately in the Developer Portal.
- Verification codes and private messages will appear in the channel. Keep the server private to you, and remember the text passes through Discord's servers.
- This bot can send texts as you. Don't give anyone else access to the channel or token.

## Limitations

- Attachments over Discord's upload limit (about 10 MB, so most long videos) aren't uploaded; you get a note with the file name and size instead.
- Attachments only go one way: sending photos or files from Discord back to Messages isn't supported.
- Tapbacks/reactions are ignored.
- iPhone calls can't be detected.
- After a restart, the bot starts only once you've logged in to the Mac (an issue if FileVault is on).
- Apple changes the Messages database format now and then, which can break message decoding.
