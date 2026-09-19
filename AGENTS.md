# AGENTS.md

## Project purpose

This repository is a self-hosted bridge between iMessage/SMS and a private Discord channel.

Long-term targets:
- macOS Intel
- Hackintosh
- Linux x86_64 with a direct iMessage backend
- future platforms only when a compatible transport exists

## Architecture rules

1. Keep Discord code separate from message transport code.
2. New backends belong in src/transports/.
3. Do not put osascript, sips, or ~/Library/Messages paths in bot.js.
4. Linux code must not assume macOS paths, AppleScript, or Contacts.app.
5. Backends emit the normalized message shape documented in ARCHITECTURE.md.
6. Keep OWNER_ID and CHANNEL_ID authorization in the Discord layer.
7. Never commit tokens, Apple credentials, hardware keys, private bridge tokens, .env, contacts.json, or state.json.
8. Do not claim direct Linux iMessage support until the underlying backend is actually integrated and tested.

## macOS

The macOS transport is intended to support Intel Macs, including Monterey where the Messages database and Apple services remain compatible.

Hackintosh is intentionally not a separate code path. If macOS exposes the normal Messages/Contacts services, it uses the same Intel/macOS transport.

## Linux

Target Linux x86_64 first.

The current Linux transport is an NDJSON subprocess adapter. It provides a stable boundary for a direct iMessage implementation such as rustpush without tying the Discord bridge to that project's internal APIs.

Incoming event:
    {"event":"message","message":{...}}

Outgoing request:
    {"action":"send","chatId":"...","text":"..."}

One JSON object per line. Diagnostics go to stderr.

Keep a helper local or authenticated. Never expose an unauthenticated send endpoint.

## Development

Run:
- npm install
- npm test
- node --check bot.js

Use MESSAGE_BACKEND=macos, linux, or auto.

Linux requires LINUX_IMESSAGE_COMMAND until a direct Linux iMessage backend is integrated.

## Important distinction

This repository contains the Discord bridge and transport abstraction. The low-level Apple network implementation is a separate backend.

Do not confuse:
- Linux transport interface exists
- Linux can run the Discord bridge
- Linux can directly authenticate to iMessage

Only the first two are implemented by this repository today.


## Privacy controls

Treat privacy settings as security-sensitive presentation policy.

- Never include message text or attachment files when visibility is notification-only.
- hideSender must remove both the direct sender and group name from generated Discord content.
- Deletion applies to the Discord copy only. It must never call transport methods that delete or modify the original iMessage.
- Only OWNER_ID in CHANNEL_ID may use settings or delete buttons.
- Persist only chat IDs and deletion timestamps; do not persist incoming message bodies.
- Future chat-specific privacy settings must not weaken the global owner/channel authorization.

## Testing rules

- Run `npm test` before changing behavior in a transport or privacy setting.
- Keep privacy policy tests platform-independent under `test/`.
- Linux transport changes should include or update an NDJSON subprocess test.
- Do not make tests require a live Apple Account, Discord token, Messages database, or hardware key.
- CI intentionally tests the cross-platform layers without attempting real iMessage authentication.

## State persistence

state.json contains operational metadata and Discord privacy settings. Keep writes atomic and use restrictive local file permissions. Never store message bodies in state.json.
