# Linux x86_64 hardware validation

This checklist is for the direct rustpush-backed Linux iMessage backend. CI can verify compilation and pure helper tests, but it cannot verify an Apple account, APNs delivery, SMS routing, or real MMCS attachment downloads.

## Prerequisites

- Linux x86_64 machine.
- Node.js 22+.
- Rust/Cargo.
- A dedicated Apple test account and test phone numbers.
- A `hwconfig.plist` generated for the rustpush integration and copied to a private location.
- Discord bot token and an authorized Discord channel.
- No Apple device is required to remain online after provisioning.

Keep all Apple credentials, provisioning state, hardware configuration, and attachment cache outside Git.

## Build

From the repository root:

    bash build-linux-direct.sh

The resulting binary is:

    linux-sidecar/direct-imessage/target/release/imsg-direct

## Provision

Set the hardware configuration location:

    export IMSG_RUSTPUSH_HWCONFIG=/private/path/hwconfig.plist

Then run:

    linux-sidecar/direct-imessage/target/release/imsg-direct provision

The command asks for the Apple ID, password, and 2FA code and writes the provisioned state to `imessage-state.plist` unless `IMSG_RUSTPUSH_STATE` is set.

Check permissions before continuing:

    stat -c '%a %n' imessage-state.plist hwconfig.plist

The state file should be readable only by the account running the bridge.

## Run the bridge directly

Set:

    export MESSAGE_BACKEND=linux
    export LINUX_IMESSAGE_COMMAND=$PWD/linux-sidecar/direct-imessage/target/release/imsg-direct
    export LINUX_IMESSAGE_ARGS='["bridge"]'

Run the Discord bot and verify `/imsg-status` reports the Linux backend as connected.

## Test matrix

### iMessage

1. Send a one-to-one iMessage to the Apple test account.
2. Confirm exactly one Discord message arrives.
3. Reply to that Discord message.
4. Confirm the reply reaches the same iMessage conversation.
5. Restart the Discord bot.
6. Send another iMessage and verify it still routes correctly.
7. Repeat a reconnect scenario and verify Discord does not duplicate the same event.

### Group iMessage

1. Create a group conversation with at least three participants.
2. Send a new message from another participant.
3. Confirm Discord marks it as a group message.
4. Reply from Discord.
5. Confirm the reply targets the original participant set.

### SMS

1. Send an SMS/MMS to the registered phone number.
2. Confirm the normalized service is `sms`.
3. Confirm the generated chat ID begins with `sms:`.
4. Reply from Discord.
5. Confirm the SMS is delivered from the registered phone handle.
6. Test an SMS conversation with more than one participant where supported by the carrier/device path.

### Attachments

1. Send a small image through iMessage.
2. Confirm Discord receives the attachment.
3. Confirm the cached file opens correctly.
4. Confirm the cached file has restrictive permissions.
5. Send an attachment near the configured size limit.
6. Send an attachment above the configured size limit and confirm it is skipped without dropping the text message.
7. Send a message containing multiple attachments and confirm the configured attachment-count limit is enforced.
8. Wait past the cache age and run the bridge again to confirm old cached files are removed.

### Reconnect

1. Start the bridge and confirm connected status.
2. Interrupt the network connection long enough for the rustpush resource to enter a failed/generating state.
3. Restore the network.
4. Confirm the bridge reports disconnected and then connected.
5. Send a new message after recovery.
6. Repeat once with the Discord bot left running continuously.

### Persistence

1. Stop the bridge cleanly after receiving a message.
2. Confirm `imessage-state.plist` exists.
3. Start the bridge again.
4. Confirm it reconnects without repeating Apple provisioning.
5. Confirm new messages still route.

## Evidence to record

For each test, record:

- date/time
- Linux distribution and version
- x86_64 CPU
- rustpush revision
- Node.js version
- test account identifier with secrets omitted
- result
- relevant bot/backend log lines
- whether the Mac was offline

Do not paste Apple passwords, 2FA codes, private keys, provisioning plist contents, or complete phone/email handles into issue trackers.

## Completion criteria

Mark the real-device tasks as complete only after the same Linux host has successfully demonstrated:

- iMessage receive
- iMessage reply
- group routing
- SMS receive
- SMS reply
- attachment receive
- reconnect recovery
- state persistence

CI success alone does not satisfy these criteria.
