# Linux direct iMessage backend plan

## Goal

Run the Discord bridge entirely on Linux x86_64, with no Mac remaining online at runtime.

Target architecture:

```
iPhone
  |
Apple iMessage / IDS
  |
Rust iMessage sidecar
  |
NDJSON
  |
src/transports/linux.js
  |
bot.js
  |
Discord
```

## Upstream implementation

The current OpenBubbles/rustpush project is a portable Rust library for interplatform Apple communication. Its crate exports low-level pieces including `IMClient`, Apple authentication helpers, identity types, message types, and `MacOSConfig`.

The current repository also contains an example/test executable, but it is not a suitable long-running bridge by itself. That example is interactive, stores several plist state files, handles 2FA through stdin, and contains a large amount of experimental code.

Do not build the production Linux bridge by scraping the output of that test executable.

## Proposed sidecar

Create a small Rust executable in this project that depends on rustpush and implements this repository's NDJSON contract.

### Incoming event

```json
{
  "event": "message",
  "message": {
    "id": "opaque-id",
    "chatId": "conversation-id",
    "sender": "+61400000000",
    "chatName": "Example",
    "isGroup": false,
    "text": "hello",
    "attachments": []
  }
}
```

### Outgoing request

```json
{
  "action": "send",
  "chatId": "conversation-id",
  "text": "hello back"
}
```

### Backend events

The sidecar should also support:

```json
{"event":"ready"}
{"event":"error","message":"..."}
{"event":"sent","id":"..."}
{"event":"status","connected":true}
```

Diagnostics must go to stderr. stdout is reserved for machine-readable NDJSON.

## Provisioning

The current Rustpush ecosystem documents Linux x86_64 operation using hardware information extracted from a Mac once. The enrichment path is also documented as x86_64 Linux-only.

The project target here is therefore:

1. Use an Intel Mac once to obtain the required hardware information.
2. Import the resulting hardware configuration into the Linux sidecar.
3. Authenticate the Apple Account and complete required 2FA.
4. Persist the resulting Linux-side state securely.
5. Run the sidecar and Discord bridge without the Mac.

Apple Silicon provisioning is not part of the first implementation target.

## Why a sidecar

Keeping the Rust code separate from the Node.js bot has several benefits:

- rustpush stays in Rust where its APIs belong.
- Discord UI/privacy features remain unchanged.
- The Node transport protocol stays stable if rustpush internals change.
- Authentication state can be managed without exposing it to Discord.
- Linux crashes can be isolated and automatically restarted by LinuxTransport.

## Security requirements

The sidecar must:

- Never print Apple passwords, tokens, hardware keys, or private state to stdout.
- Never accept arbitrary shell commands through NDJSON.
- Keep authentication state outside the repository.
- Avoid passing secrets in process arguments.
- Bind network services locally only if a network service becomes necessary.
- Treat the NDJSON input as trusted local IPC, not a public API.

## First implementation milestones

- [ ] Create Rust sidecar crate.
- [ ] Pin a known-good rustpush revision.
- [ ] Load imported hardware configuration.
- [ ] Implement Apple authentication and persisted state.
- [ ] Complete 2FA provisioning without placing credentials in command-line arguments.
- [ ] Subscribe to incoming iMessage events.
- [ ] Convert incoming messages to normalized NDJSON.
- [ ] Implement text sends from NDJSON.
- [ ] Implement attachment download and local temporary-file handling.
- [ ] Verify groups and SMS forwarding.
- [ ] Add reconnect handling.
- [ ] Add end-to-end Linux test using a disposable Apple test account.

## Current evidence

OpenBubbles' current Rustpush documentation explicitly describes Linux support with hardware information extracted from a Mac once, with x86_64-only enrichment. The upstream rustpush repository is active and exposes the low-level APIs required for a dedicated adapter.

This project should keep the integration behind the existing LinuxTransport boundary until the sidecar is tested end-to-end.
