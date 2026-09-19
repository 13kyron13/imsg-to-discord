# iMessage to Discord

A self-hosted bridge that forwards iMessage/SMS conversations to a private Discord channel and lets the owner reply from Discord.

The project now separates Discord from the message transport, so macOS and Linux can use different iMessage backends.

## Supported targets

### Intel macOS

The native macOS backend uses the same Messages.app mechanisms as the original project:

- Messages database at `~/Library/Messages/chat.db`
- AppleScript for sending
- Contacts.app for names
- `sips` for HEIC conversion

The code is CPU-architecture independent and is intended to support Intel Macs. Monterey is a specific compatibility target, but it still needs real-device testing against the installed Messages database schema and permissions.

### Hackintosh

A Hackintosh that behaves like a normal supported macOS installation can use the same macOS backend. There is deliberately no separate Hackintosh implementation.

### Linux x86_64

Linux has a transport adapter that launches a local iMessage backend and communicates with it using newline-delimited JSON (NDJSON).

The adapter is ready for the direct Linux iMessage implementation under `linux-sidecar/direct-imessage`. That backend now contains provisioning, authentication, incoming-event handling, and text sending, although real Linux hardware validation is still pending.

The intended long-term backend is a rustpush-compatible implementation capable of authenticating on Linux after Intel-Mac provisioning. This is the part that still needs end-to-end integration and testing.

ARM is not currently a target.

## Architecture

```
                    +-------------------+
                    |    Discord Bot    |
                    |      bot.js       |
                    +---------+---------+
                              |
                       MessageTransport
                         /          \
                        /            \
             +---------+              +---------+
             |                                  |
       macOS transport                    Linux transport
       src/transports/                    src/transports/
          macos.js                           linux.js
             |                                  |
        Messages.app                    local iMessage backend
        chat.db / AppleScript              NDJSON stdin/stdout
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design.

See [TODO.md](TODO.md) for implementation status and planned work.

See [AGENTS.md](AGENTS.md) for instructions for contributors and coding agents.

## Installation

Requirements:

- Node.js 22+
- A private Discord server/channel
- macOS for the native macOS backend, or Linux x86_64 plus a compatible iMessage backend for Linux

Clone the repository:

```bash
git clone https://github.com/yoimdoingstuff/imsg-to-discord.git
cd imsg-to-discord
npm install
```

Create configuration:

```bash
cp .env.example .env
```

Set:

```text
DISCORD_TOKEN=your-bot-token
CHANNEL_ID=your-channel-id
OWNER_ID=your-discord-user-id
MESSAGE_BACKEND=auto
```

## macOS setup

Open Messages and sign in with the same Apple Account used by the iPhone.

For SMS, enable Text Message Forwarding on the iPhone.

Grant the terminal application Full Disk Access:

System Settings -> Privacy & Security -> Full Disk Access

The first time the bot sends a message, macOS may also ask for permission to control Messages.

Run:

```bash
npm start
```

On macOS, `MESSAGE_BACKEND=auto` selects the macOS transport.

For automatic startup:

```bash
bash install-autostart.sh
```

The Mac still needs to be awake and signed in for the native Messages backend. This is a limitation of this backend, not of the Discord layer.

## Linux setup

Linux uses:

```text
bot.js
  |
LinuxTransport
  |
stdin/stdout NDJSON
  |
direct iMessage backend
```

Configure:

```text
MESSAGE_BACKEND=linux
LINUX_IMESSAGE_COMMAND=/path/to/backend
LINUX_IMESSAGE_ARGS=[]
```

Arguments must be a JSON array.

The backend emits incoming messages as:

```json
{"event":"message","message":{"id":"123","chatId":"chat-guid","sender":"+61400000000","chatName":null,"isGroup":false,"text":"hello","attachments":[]}}
```

The bridge sends replies as:

```json
{"action":"send","chatId":"chat-guid","text":"hello back"}
```

Diagnostics should be written to stderr.

Install the Linux user service:

```bash
bash install-systemd.sh
```

View logs:

```bash
journalctl --user -u imsg-to-discord -f
```

### Direct iMessage Linux work

The Linux adapter is not itself an iMessage implementation.

The next major task is real Linux hardware validation of the direct backend. The desired final architecture is:

```
iPhone
   |
Apple iMessage / IDS
   |
Linux x86_64 direct backend
   |
LinuxTransport
   |
Discord
```

The intended Intel workflow is a one-time provisioning/enrichment step using an Intel Mac, followed by runtime operation entirely on Linux.

Do not assume that merely setting `MESSAGE_BACKEND=linux` provides direct iMessage connectivity. A compatible backend must be installed and configured.

## Contacts

You can optionally create:

```bash
cp contacts.example.json contacts.json
```

The Discord layer uses this file as a fallback name mapping. The macOS backend additionally reads Contacts.app.

## Security

The Discord bot is deliberately restricted to:

- one configured Discord channel
- one configured Discord owner
- replies to known forwarded messages

Never commit:

- `.env`
- `contacts.json`
- `state.json`
- iMessage authentication material
- hardware keys
- Apple credentials

A Linux iMessage backend must be treated as a privileged local component. Do not expose its unauthenticated stdin/stdout bridge as a network service.

Remember that private messages forwarded into Discord are processed by Discord's infrastructure.

## Current limitations

- Direct Linux iMessage code exists, but it is not yet end-to-end validated on real Linux hardware.
- Linux requires the direct backend executable, or another compatible backend, speaking the documented NDJSON protocol.
- Intel Monterey compatibility needs real-device testing.
- Hackintosh compatibility depends on Messages.app, Contacts, Apple services, and permissions functioning normally.
- ARM Linux/Raspberry Pi is not currently targeted.
- SMS and group routing are implemented in the direct backend but still need real-device validation.
- Reconnect status is implemented through rustpush resource-state events and still needs real-device testing.
- Linux incoming attachments are downloaded by the direct backend into a private local cache and exposed to the Discord layer as attachment paths.
- Sending attachments from Discord back to Messages is not implemented.
- Tapbacks/reactions and calls are not currently bridged.

## Project status

The cross-platform foundation is now in place. The remaining difficult work is the direct Linux iMessage backend and real hardware testing.

Humanity has successfully separated the Discord bot from Apple's operating system. The next challenge is convincing Apple's infrastructure that Linux deserves to participate.


## Privacy controls

The bot includes an owner-only privacy settings panel.

Run the /imsg-settings slash command to open an ephemeral settings panel with buttons for Notification only, Hide contact, Delete with a button, Auto-delete, Keep messages, and setting the timer.

Notification only tells you that a message arrived without showing the message text or uploading its attachments.

Hide contact hides the sender and group name while leaving the message body visible.

Delete with a button puts a Delete Discord copy button under every forwarded message.

Auto-delete removes the Discord copy after a configurable number of seconds. The timer accepts 5 to 86400 seconds.

Keep messages leaves forwarded messages in Discord normally.

The slash command also accepts options directly. For example: /imsg-settings visibility:notification hide_contact:true delete_mode:timer delete_after:60

Settings are stored in state.json and restored after restart. Deleting a Discord copy never deletes the original iMessage.

The settings panel and delete buttons only respond to the configured Discord owner in the configured channel.


## Development and tests

Run the test suite with:

```bash
npm test
```

The suite checks JavaScript syntax, privacy behavior, normalized transport events, and the Linux NDJSON adapter using a local mock subprocess. It does not contact Apple or Discord.

GitHub Actions tests Node.js 22 and 24 on every push to `main` and pull request.


## Linux sidecar development

The repository contains two Rust layers under `linux-sidecar/`.

The stable sidecar owns the NDJSON protocol. `linux-sidecar/direct-imessage/` owns the rustpush-backed implementation.

Current direct-backend state:

- Apple hardware-config loading implemented.
- Interactive Apple ID and 2FA provisioning implemented.
- IDS registration and persistent APS/IDS state implemented.
- Incoming text messages converted to normalized NDJSON.
- Text replies sent through IMClient.
- Incoming attachment transfer is implemented. Real Linux x86_64 end-to-end validation remains outstanding.
- The direct crate is deliberately excluded from normal GitHub Actions compilation until rustpush's external submodule can be built reproducibly in CI. Formatting and manifest validation are still automated.
