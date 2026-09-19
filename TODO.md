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
[~] Define stable backend event schema.
[ ] Integrate a real direct-iMessage Linux backend.
[ ] Integrate rustpush.
[ ] Import/enrich Intel Mac hardware key.
[ ] Add x86_64 NAC validation.
[ ] Add Apple ID / 2FA provisioning.
[ ] Persist authentication state securely.
[ ] Test incoming iMessages.
[ ] Test outgoing replies.
[ ] Test groups.
[ ] Test attachments.
[ ] Test SMS forwarding.
[ ] Test reconnect behavior.

## Discord
[x] Owner-only sending.
[x] Single-channel restriction.
[x] Reply routing.
[x] Attachment forwarding.
[x] Contact-name display.
[ ] Add backend health command.
[ ] Add startup status.
[ ] Add retry/backoff.
[ ] Improve formatting configuration.

## Reliability
[ ] Structured logging.
[ ] Graceful shutdown.
[ ] Health checks.
[ ] Linux duplicate-event protection.
[ ] Better persistent cursor handling.
[ ] Transport reconnect.
[ ] Fake transport integration tests.
[ ] CI for syntax/tests.
[ ] Linux x86_64 CI.

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
