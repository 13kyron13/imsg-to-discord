# Architecture

## Overview

The project is split into a Discord layer and a message transport layer.

    Message Transport
            |
            v
    Normalized Message
            |
            v
       Discord Bridge
        /          \
     incoming     outgoing
        |             |
        v             v
     Discord     sendText(chatId)

## Discord bridge

bot.js handles:
- Discord authentication
- owner/channel authorization
- settings commands and buttons
- attachment uploads
- reply routing
- persistent state
- privacy/deletion presentation policy orchestration

src/privacy.js contains the platform-independent privacy policy and is intentionally free of Discord SDK code so it can be unit tested.

bot.js must not contain platform-specific Apple operations.

## Transport interface

src/transport.js defines the common interface:
- start(onMessage)
- sendText(chatId, text)
- close()

## macOS transport

src/transports/macos.js uses:
- ~/Library/Messages/chat.db
- ~/Library/Messages/Attachments
- osascript
- Contacts.app
- sips for HEIC conversion

This path is CPU-independent. Intel Monterey and Hackintosh are treated as normal macOS when those services are available.

## Linux transport

src/transports/linux.js launches a local helper and exchanges newline-delimited JSON.

Incoming:
    {"event":"message","message":{"id":"...","chatId":"...","sender":"...","text":"...","attachments":[]}}

Outgoing:
    {"action":"send","chatId":"...","text":"..."}

This is deliberately an adapter boundary, not a fake iMessage implementation.

The planned direct backend is a dedicated Rust integration. The evaluated rustpush revision is kept in the separate linux-sidecar/direct-imessage crate so the stable NDJSON sidecar does not inherit rustpush's external Git submodules.

## Normalized message shape

{
  id: String,
  chatId: String,
  sender: String|null,
  chatName: String|null,
  isGroup: Boolean,
  text: String,
  attachments: [
    {
      path: String,
      name: String,
      mimeType: String|null
    }
  ]
}

IDs are opaque strings.

## Security

Discord is the authorization boundary:

    author == OWNER_ID
        AND
    channel == CHANNEL_ID
        AND
    reply references a known forwarded message
        |
        v
    transport.sendText(chatId, text)

A Linux helper must not create a second unauthenticated send path.

## Startup

macOS:
    install-autostart.sh
        -> LaunchAgent
        -> bot.js

Linux:
    install-systemd.sh
        -> systemd --user
        -> bot.js

## Future direct Linux flow

    iPhone
       |
    iMessage / IDS
       |
    rustpush-compatible backend
       |
    LinuxTransport
       |
    bot.js
       |
    Discord

One-time provisioning uses an Intel Mac hardware configuration. The Mac is not part of the long-running Linux bridge process. The direct crate persists the resulting IDS/APS state locally with restrictive permissions.

Apple Silicon provisioning is outside the first Linux target.


## Privacy and Discord presentation layer

Privacy settings are stored in state.json:

- visibility: full or notification
- hideSender: boolean
- deleteMode: keep, button, or timer
- deleteAfterSeconds: 5-86400

The settings are exposed through the owner-only /imsg-settings command.

The settings panel is an ephemeral Discord embed with buttons to toggle message contents vs notification-only, toggle contact visibility, cycle deletion mode, open a timer modal, and refresh the panel.

### Notification-only mode

The bridge sends a notification without the incoming message text and without attachments. If contact hiding is disabled, the notification may identify the sender/group. If contact hiding is enabled, no sender or group name is included.

### Hide-contact mode

Hide-contact applies to both full-message and notification modes. In full-message mode the text remains visible, but the sender and group name are omitted.

### Delete modes

Keep leaves the Discord copy until manually deleted.

Button adds a Delete Discord copy button to each forwarded message. Pressing it removes only the Discord copy. The original iMessage is never deleted.

Timer deletes the Discord copy after deleteAfterSeconds. Pending deletion timestamps are persisted and restored after restart.

The delete button and settings interactions are restricted to OWNER_ID in CHANNEL_ID.


## Reliability

The Linux transport uses exponential restart backoff when its local backend exits unexpectedly. The first retry is five seconds and the delay grows to a maximum of sixty seconds. A clean bot shutdown disables automatic restarts.

The repository's tests use Node's built-in test runner and include privacy-policy tests, normalized transport tests, and a Linux subprocess integration test. GitHub Actions runs the test suite on Node 22 and Node 24.


## Linux sidecar

`linux-sidecar/` is the Rust process boundary for the eventual direct Linux iMessage backend.

The current stable sidecar implements the NDJSON process protocol. The direct backend in `linux-sidecar/direct-imessage/` implements the real rustpush-backed authentication, receive, and text-send path. The Node `LinuxTransport` process supervisor, not the sidecar, owns restart/backoff behavior.

The separate `linux-sidecar/direct-imessage/` crate contains the direct backend. It has `provision` and `bridge` modes: provisioning authenticates the Apple Account and stores IDS/APS state; bridge mode runs the long-lived NDJSON service without requiring the Mac to remain online. Keeping this crate separate prevents rustpush's external Git submodules from breaking the stable protocol build.
