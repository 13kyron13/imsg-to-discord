#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "The direct iMessage backend targets Linux only." >&2
  exit 1
fi

if [[ "$(uname -m)" != "x86_64" ]]; then
  echo "The direct iMessage backend currently targets Linux x86_64 only." >&2
  exit 1
fi

command -v cargo >/dev/null 2>&1 || {
  echo "Cargo was not found. Install Rust from rustup before building." >&2
  exit 1
}

command -v git >/dev/null 2>&1 || {
  echo "Git was not found." >&2
  exit 1
}

git config --global url."https://github.com/".insteadOf "git@github.com:"
git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"

export CARGO_NET_GIT_FETCH_WITH_CLI=true

cargo build   --manifest-path "$ROOT/linux-sidecar/direct-imessage/Cargo.toml"   --release

BIN="$ROOT/linux-sidecar/direct-imessage/target/release/imsg-direct"

if [[ ! -x "$BIN" ]]; then
  echo "Build completed but the imsg-direct binary was not found at:" >&2
  echo "  $BIN" >&2
  exit 1
fi

echo
echo "Built direct Linux iMessage backend:"
echo "  $BIN"
echo
echo "Provision once with:"
echo "  $BIN provision"
echo
echo "Then configure .env:"
echo "  MESSAGE_BACKEND=linux"
echo "  LINUX_IMESSAGE_COMMAND=$BIN"
echo "  LINUX_IMESSAGE_ARGS=["bridge"]"
