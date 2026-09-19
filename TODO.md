# TODO

Legend:
[x] done
[~] scaffolded/in progress
[ ] planned
[!] blocked/external dependency

## Foundation
[x] Separate Discord logic from message transport.
[x] Add automatic platform backend selection.
[x] Keep macOS behavior in a dedicated transport.
[x] Add Linux transport interface.
[x] Add Linux systemd user service installer.
[x] Document the normalized transport schema.
[x] Document security boundaries.
[x] Add AGENTS.md.
[x] Add ARCHITECTURE.md.

## Intel macOS / Monterey
[x] Isolate Messages database access.
[x] Isolate AppleScript sending.
[x] Isolate Contacts.app lookup.
[x] Isolate HEIC conversion.
[~] Test on Intel Monterey.
[ ] Verify Monterey schema variations against SQL queries.
[ ] Add attributedBody regression fixtures.
[ ] Test SMS Text Message Forwarding.
[ ] Test sleep/wake recovery.
[ ] Test LaunchAgent after reboot/login.
[ ] Test Intel Hackintosh.

## Linux
[x] Add Linux transport boundary.
[x] Add NDJSON subprocess protocol.
[x] Add Linux contacts.json fallback.
[x] Add systemd user startup.
[x] Define stable backend event schema.
[~] Integrate the direct-iMessage Linux backend; real Apple hardware validation remains.
[x] Design direct Rust sidecar integration.
[x] Add hardware-config loading to the direct backend.
[ ] Add x86_64 NAC validation.
[x] Add Apple ID / 2FA provisioning command.
[x] Persist provisioned IDS/APS state with restrictive local permissions.
[ ] Test incoming iMessages.
[~] Implement text replies through NDJSON.
[~] Implement and prepare group-message routing; real-device test remains.
[~] Implement incoming attachment transfer; real-device test remains.
[~] Implement SMS routing; real-device test remains.
[~] Implement rustpush resource-state reconnect reporting; real-device test remains.

## Discord
[x] Owner-only sending.
[x] Single-channel restriction.
[x] Reply routing.
[x] Attachment forwarding.
[x] Contact-name display.
[x] Add backend health command.
[ ] Add startup status.
[x] Add retry/backoff.
[ ] Improve formatting configuration.

## Reliability
[~] Structured logging.
[x] Graceful shutdown.
[ ] Health checks.
[x] Linux duplicate-event protection.
[x] Better persistent cursor handling.
[x] Transport reconnect.
[x] Fake transport integration tests.
[x] CI for syntax/tests.
[x] Linux x86_64 CI.

## Security
[x] Ignore local secrets/state.
[x] Keep authorization in Discord layer.
[ ] Linux helper threat model documentation.
[ ] Avoid sensitive command-line arguments.
[ ] Encrypted storage for future Linux credentials.

## Future
[ ] Windows backend if a viable transport exists.
[ ] ARM64 Linux after x86_64 is stable.
[ ] Raspberry Pi only if the chosen iMessage backend supports ARM64.


## Discord privacy controls
[x] Persist privacy/deletion settings in state.json.
[x] Add /imsg-settings slash command.
[x] Add an ephemeral Discord settings panel with buttons.
[x] Add notification-only mode that never forwards message contents.
[x] Add hide-contact mode.
[x] Add per-message Delete Discord copy button.
[x] Add configurable auto-delete timer.
[x] Restore pending timed deletions after bot restart.
[ ] Add optional separate settings for different chats.
[ ] Add configurable auto-delete presets beyond seconds.
[ ] Add attachment-specific privacy policy.

## Cross-platform testing
[x] Add privacy unit tests.
[x] Add transport normalization tests.
[x] Add Linux NDJSON transport integration test.
[x] Add GitHub Actions CI for Node 22 and 24.

## Linux rustpush integration
[x] Add dedicated Rust sidecar scaffold instead of using rustpush test executable.
[x] Document the current upstream API/integration boundary.
[x] Record a known-good rustpush revision for the direct integration crate.
[x] Load imported hardware configuration.
[x] Persist provisioned IDS/APS state with restrictive local permissions.
[x] Add Apple ID / 2FA provisioning command.
[x] Bridge incoming IMClient text/events to normalized NDJSON.
[x] Bridge NDJSON text send requests to IMClient.
[x] Add incoming attachment download and local cache.
[ ] End-to-end test on x86_64 Linux with a real Apple test account.

## Rust sidecar
[x] Add linux-sidecar Cargo project with stable NDJSON protocol.
[x] Isolate the evaluated rustpush revision from the stable sidecar build.
[~] Implement real rustpush-backed authentication, attachment, SMS/group routing, and IMClient reconnect handling in the direct-imessage crate.
