# Linux iMessage sidecar

This directory contains the Linux x86_64 sidecar boundary used by the Node.js Discord bridge.

## Current state

The sidecar currently implements only the NDJSON process protocol:

- emits `{"event":"ready"}` on startup
- accepts `{"action":"send","chatId":"...","text":"..."}`
- returns a clear error until a direct iMessage backend is integrated

The stable sidecar build intentionally does not pull the unfinished rustpush integration. That keeps normal CI independent of rustpush's own Git submodules.

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

The planned direct backend lives in the separate `linux-sidecar/direct-imessage/` crate. It will pin and integrate rustpush without making the stable protocol crate depend on that external Git repository.
