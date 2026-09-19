# Direct Linux iMessage backend

This crate is the real Linux-side implementation boundary. It targets Linux x86_64 only and intentionally depends on a pinned rustpush revision.

Intended lifecycle:

1. Obtain the Apple hardware configuration once from an Intel Mac.
2. Copy that configuration to the Linux x86_64 machine.
3. Run `cargo run --release -- provision`.
4. Complete Apple ID authentication and 2FA.
5. The provision command registers the IDS identity and saves APS/IDS state locally.
6. Run `cargo run --release -- bridge`.
7. Point the Node `LinuxTransport` at the resulting executable.

## Environment

- `IMSG_RUSTPUSH_HWCONFIG`: hardware config plist. Default: `hwconfig.plist`
- `IMSG_RUSTPUSH_STATE`: persistent rustpush state. Default: `imessage-state.plist`
- `IMSG_RUSTPUSH_ANISETTE`: Anisette state path. Default: `anisette`
- `IMSG_RUSTPUSH_ATTACHMENT_DIR`: downloaded incoming attachment cache. Default: `attachments`
- `IMSG_RUSTPUSH_MAX_ATTACHMENT_MB`: maximum incoming attachment size. Default: `100`. Set to `0` for no size limit.
- `IMSG_RUSTPUSH_ATTACHMENT_MAX_AGE_HOURS`: attachment cache cleanup age. Default: `24` hours.

The bridge uses the same NDJSON protocol as the Node Linux transport.

Incoming message example:

    {"event":"message","message":{"id":"...","chatId":"imsg:...","sender":"...","chatName":null,"isGroup":false,"service":"imessage","text":"hello","attachments":[]}}

SMS uses an `sms:` chat-ID prefix so Discord replies remain tied to the SMS transport:

    {"event":"message","message":{"id":"...","chatId":"sms:...","sender":"tel:+61400000000","chatName":null,"isGroup":false,"service":"sms","text":"hello","attachments":[]}}

Incoming attachments are downloaded through rustpush MMCS/inline attachment handling into the local attachment cache before the message event is emitted. Paths are treated as local IPC data and should never be exposed as a network API.

Outgoing text requests remain:

    {"action":"send","chatId":"imsg:...","text":"reply"}

or:

    {"action":"send","chatId":"sms:...","text":"reply"}

The stdout stream is machine-readable. Diagnostics go to stderr.

## Reconnect behavior

rustpush owns APS resource regeneration. The bridge watches its resource state and emits:

    {"event":"status","connected":false}

while the APS resource is generating or failed, then:

    {"event":"status","connected":true}

after successful regeneration.

The Node Linux transport uses those status events for `/imsg-status` and restarts the entire helper only when the process itself exits.

## Real hardware validation

The source implementation is now present, but direct iMessage support is not considered validated until a Linux x86_64 host has successfully:

- loaded an Intel-Mac-derived hardware configuration
- completed Apple ID and 2FA provisioning
- received an iMessage
- received an SMS
- received a group message
- received an attachment
- replied to iMessage and SMS
- survived an APS reconnect

This crate is intentionally not part of the normal GitHub Actions compile job because the pinned rustpush repository contains an external Git submodule. The CI job still checks formatting and the Cargo manifest.
