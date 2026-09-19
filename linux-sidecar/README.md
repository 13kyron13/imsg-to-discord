# Linux iMessage sidecar

This directory contains the Linux x86_64 sidecar boundary used by the Node.js Discord bridge.

## Current state

The sidecar currently implements only the NDJSON process protocol:

- emits `{"event":"ready"}` on startup
- accepts `{"action":"send","chatId":"...","text":"..."}`
- returns a clear error until the direct iMessage backend is enabled

The direct iMessage implementation is planned behind the `direct-imessage` Cargo feature.

## Build

```bash
cargo check --manifest-path linux-sidecar/Cargo.toml
cargo fmt --manifest-path linux-sidecar/Cargo.toml -- --check
```

## Protocol

Incoming requests use one JSON object per line on stdin.

Outgoing events use one JSON object per line on stdout. Human-readable diagnostics go to stderr.

The Node bridge automatically restarts the sidecar if it exits unexpectedly.

## Direct backend

The optional `direct-imessage` feature pins the current rustpush revision being evaluated for the Linux implementation. It is deliberately not enabled by default until the Apple authentication, registration, incoming-event, and send paths are integrated and tested.
