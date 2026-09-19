#!/bin/bash
# Installs a LaunchAgent so the bot starts at login and restarts if it crashes.
# Run from anywhere with:  bash install-autostart.sh

set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$(which node)"
LABEL="com.user.discordbridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ -z "$NODE" ]; then
  echo "Node.js not found. Install it from nodejs.org first."
  exit 1
fi

if [ ! -f "$DIR/.env" ]; then
  echo "No .env file found in $DIR. Copy .env.example to .env and fill it in first."
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>--env-file=.env</string>
    <string>bot.js</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/out.log</string>
  <key>StandardErrorPath</key><string>$DIR/err.log</string>
</dict>
</plist>
EOF

# Unload any old copy first (ignore errors if nothing was loaded), then load the new one
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "Installed and started."
echo
echo "One more step: give Node full disk access, or the bot can't read Messages."
echo "  1. Run:  realpath $NODE"
echo "  2. System Settings > Privacy & Security > Full Disk Access > +"
echo "  3. Press Cmd+Shift+G, paste the path from step 1, and add it."
echo
echo "Logs: $DIR/err.log"
echo "Stop it with: launchctl bootout gui/\$(id -u) $PLIST"
