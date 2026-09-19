# Linux direct backend security notes

The direct backend handles Apple account-derived authentication state, iMessage metadata, and downloaded attachments. Treat the Linux host as a trusted endpoint.

## Sensitive files

- `hwconfig.plist`: hardware identity/configuration material used by rustpush.
- `imessage-state.plist`: persisted APS/IDS state including authentication material.
- `id_cache.plist`: rustpush identity/key cache.
- `anisette/`: local Anisette provider state when enabled.
- `attachments/`: downloaded message attachments.
- `.env`: Discord bot configuration and backend paths.

These files are ignored by Git and should remain readable only by the service account where practical.

## Process boundary

The Node bot talks to the Linux backend over a local stdin/stdout NDJSON pipe. The Node layer is responsible for Discord authorization and privacy policy. The Rust backend is responsible for Apple/iMessage transport.

The backend must not be exposed as a network-facing API. Keep `LINUX_IMESSAGE_COMMAND` local and invoke the binary directly.

## Secrets

Apple passwords and 2FA codes are entered interactively by the provisioning command and are not accepted as command-line arguments. Do not put them in `.env`, systemd unit files, shell history, or issue reports.

## Attachments

Incoming attachments are written to a local cache with restrictive Unix permissions. The backend enforces per-file and per-message attachment limits and removes old cache entries.

Discord-side attachment limits and privacy settings are enforced separately by the Node bot.

## Failure assumptions

Assume a compromised Linux account can read the bridge's local state. This project does not currently provide encrypted credential storage or hardware-backed key isolation.

Do not run the bridge under a shared multi-user account when stronger isolation is needed.

## Validation

Security validation should include checking Unix permissions after provisioning, confirming no credentials appear in process arguments, checking the systemd unit's `UMask=0077`, and confirming ignored private files do not enter commits.
