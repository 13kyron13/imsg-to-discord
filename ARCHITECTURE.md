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
- formatting
- attachment uploads
- reply routing
- persistent state

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

The planned direct backend is a rustpush-compatible integration. Current upstream work documents Linux x86_64 operation using hardware information extracted once from an Intel Mac, with local NAC validation. That is the route intended for this project.

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

One-time provisioning is expected to use an Intel Mac hardware key. The Mac should not need to remain online for the Intel-key Linux path.

Apple Silicon provisioning is outside the first Linux target.
