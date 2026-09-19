# Direct Linux iMessage backend

This crate is the real Linux-side implementation boundary. Unlike the stable linux-sidecar protocol crate, it intentionally depends on a pinned rustpush revision.

Intended lifecycle:

1. Obtain the Apple hardware configuration once from an Intel Mac.
2. Run cargo run --release -- provision on the Linux x86_64 machine.
3. Complete Apple ID authentication and 2FA.
4. The provision command saves the IDS user, identity, and APS state locally.
5. Run cargo run --release -- bridge.
6. Point the Node LinuxTransport at the resulting executable.

Environment:

- IMSG_RUSTPUSH_HWCONFIG: hardware config plist. Default: hwconfig.plist
- IMSG_RUSTPUSH_STATE: persistent rustpush state. Default: imessage-state.plist
- IMSG_RUSTPUSH_ANISETTE: Anisette state path. Default: anisette

The bridge uses the same NDJSON protocol as the Node Linux transport.

Incoming message example:

    {"event":"message","message":{"id":"...","chatId":"imsg:...","sender":"...","chatName":null,"isGroup":false,"text":"hello","attachments":[]}}

Outgoing request:

    {"action":"send","chatId":"imsg:...","text":"reply"}

The stdout stream is machine-readable. Diagnostics go to stderr.

Current limitation: incoming attachment transfer is not implemented yet. Text receive/send and the stable IPC protocol are the first target.

This crate is intentionally not part of the normal Rust CI job yet because the pinned rustpush repository contains an external Git submodule. It must be tested on Linux x86_64 with real Apple provisioning before that CI job is enabled.
