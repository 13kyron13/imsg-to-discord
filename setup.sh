#!/bin/bash
# One-command setup for imsg-to-discord (macOS).
#
#   bash setup.sh              set everything up (safe to run again)
#   bash setup.sh doctor       check that everything is working
#   bash setup.sh permissions  open the Full Disk Access screen again
#   bash setup.sh uninstall    stop the bot and remove the background jobs
#
# It downloads its own copy of Node.js into the .runtime folder, so you don't
# need to install anything yourself.

set -e
cd "$(dirname "$0")"

NODE_MAJOR=24        # which Node.js release line to download
NODE_MIN=22          # oldest version the bot supports
RUNTIME=".runtime"
NODE_BIN="$RUNTIME/node/bin"

die() {
  printf '\n❌ %s\n' "$*" >&2
  exit 1
}

[ "$(uname -s)" = "Darwin" ] || die "This setup is for macOS. (Linux support is experimental: see docs/.)"

node_ok() {
  [ -x "$NODE_BIN/node" ] || return 1
  major="$("$NODE_BIN/node" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$major" -ge "$NODE_MIN" ]
}

if ! node_ok; then
  echo "Downloading Node.js (one time only, about 50 MB)..."
  case "$(uname -m)" in
    arm64)  PLATFORM="darwin-arm64" ;;
    x86_64) PLATFORM="darwin-x64" ;;
    *)      die "Unsupported Mac type: $(uname -m)" ;;
  esac

  BASE="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  LINE="$(curl -fsSL "$BASE/SHASUMS256.txt" | grep -m1 "${PLATFORM}\.tar\.gz" || true)"
  [ -n "$LINE" ] || die "Couldn't reach nodejs.org. Check your internet connection and run this again."

  SUM="${LINE%% *}"
  FILE="${LINE##* }"

  mkdir -p "$RUNTIME"
  curl -fsSL "$BASE/$FILE" -o "$RUNTIME/$FILE" || die "The Node.js download failed. Run this again."

  if ! echo "$SUM  $RUNTIME/$FILE" | shasum -a 256 -c - >/dev/null 2>&1; then
    rm -f "$RUNTIME/$FILE"
    die "The Node.js download was corrupted. Run this again."
  fi

  rm -rf "$RUNTIME/node" "$RUNTIME/${FILE%.tar.gz}"
  tar -xzf "$RUNTIME/$FILE" -C "$RUNTIME"
  mv "$RUNTIME/${FILE%.tar.gz}" "$RUNTIME/node"
  rm -f "$RUNTIME/$FILE"
fi

export PATH="$PWD/$NODE_BIN:$PATH"

echo "Installing the bot's parts..."
npm install --no-audit --no-fund --loglevel=error || die "Installing the bot's parts failed. Check your internet connection and run this again."

exec node scripts/setup.js "$@"
