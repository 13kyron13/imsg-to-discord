# Linux `hwconfig.plist` preparation

The direct backend loads `MacOSConfig` from `IMSG_RUSTPUSH_HWCONFIG`. It does not currently extract the file itself.

The pinned rustpush test program documents the intended source: extract hardware information from Mac validation data, then write that data as a `MacOSConfig` plist. The rustpush source also notes that this validation data is used for the hardware identifiers and is not itself used as the authentication credential.

## Source workflow

1. Obtain suitable Mac validation data through a trusted rustpush-compatible registration workflow.
2. Extract the hardware configuration from that validation data using the rustpush hardware-config parser or the registration-provider workflow you are using.
3. Save the resulting `MacOSConfig` as an XML plist named `hwconfig.plist`.
4. Copy it to a private Linux path.
5. Point the bridge at it:

    export IMSG_RUSTPUSH_HWCONFIG=/private/path/hwconfig.plist

6. Confirm the file is not tracked by Git and is readable only by the account running the bridge.

## Important boundary

The repository intentionally does not automate extraction of Mac validation data. That process can involve private Apple registration material and is better kept as a separate provisioning step rather than embedded in the Discord bot.

Do not paste the plist into GitHub issues, Discord, or chat logs. Treat it as private device identity material even when the source workflow says the validation data itself is not an authentication credential.

## Current limitation

A Linux machine cannot currently generate its own `hwconfig.plist` inside this repository. The file must be prepared externally before `imsg-direct provision` can be used.
