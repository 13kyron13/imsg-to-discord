#!/bin/bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node || true)"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT="$UNIT_DIR/imsg-to-discord.service"
[ -n "$NODE" ] || { echo "Node.js not found."; exit 1; }
[ -f "$DIR/.env" ] || { echo "No .env file found."; exit 1; }
mkdir -p "$UNIT_DIR"
cat > "$UNIT" <<EOF
[Unit]
Description=iMessage to Discord bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
UMask=0077
WorkingDirectory=$DIR
ExecStart=$NODE --env-file=.env bot.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now imsg-to-discord.service
echo "Installed and started imsg-to-discord.service"
