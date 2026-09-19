#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
RUSTPUSH_REV="f35c4ee062b3c3eae54dc96b89b90ee99f5e1d0c"
TMP_ROOT="$(mktemp -d)"
RUSTPUSH_DIR="$TMP_ROOT/rustpush"
DIRECT_DIR="$TMP_ROOT/direct-imessage"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "The direct iMessage backend targets Linux only." >&2
  exit 1
fi

if [[ "$(uname -m)" != "x86_64" ]]; then
  echo "The direct iMessage backend currently targets Linux x86_64 only." >&2
  exit 1
fi

command -v cargo >/dev/null 2>&1 || {
  echo "Cargo was not found. Install Rust before building." >&2
  exit 1
}

command -v protoc >/dev/null 2>&1 || {
  echo "protoc was not found. Install the Protocol Buffers compiler before building." >&2
  echo "On Debian/Ubuntu: sudo apt-get install protobuf-compiler" >&2
  exit 1
}

command -v git >/dev/null 2>&1 || {
  echo "Git was not found." >&2
  exit 1
}

export CARGO_NET_GIT_FETCH_WITH_CLI=true
export GIT_TERMINAL_PROMPT=0

echo "Fetching pinned rustpush source..."

git clone "https://github.com/OpenBubbles/rustpush.git" "$RUSTPUSH_DIR"
git -C "$RUSTPUSH_DIR" fetch --no-tags origin "$RUSTPUSH_REV"
git -C "$RUSTPUSH_DIR" checkout --detach "$RUSTPUSH_REV"

sed -i 's#git@github.com:#https://github.com/#g' "$RUSTPUSH_DIR/.gitmodules"
git -C "$RUSTPUSH_DIR" submodule sync
git -C "$RUSTPUSH_DIR" submodule update --init

git -C "$RUSTPUSH_DIR" submodule foreach '
  if [ -f .gitmodules ]; then
    sed -i "s#git@github.com:#https://github.com/#g" .gitmodules
    git submodule sync
  fi
'

git -C "$RUSTPUSH_DIR" submodule sync --recursive
git -C "$RUSTPUSH_DIR" submodule update --init --recursive

git -C "$RUSTPUSH_DIR" submodule foreach --recursive '
  if [ -f .gitmodules ]; then
    sed -i "s#git@github.com:#https://github.com/#g" .gitmodules
    git submodule sync --recursive
  fi
'

git -C "$RUSTPUSH_DIR" submodule update --init --recursive

mkdir -p "$RUSTPUSH_DIR/certs/fairplay"
for name in \
  4056631661436364584235346952193 \
  4056631661436364584235346952194 \
  4056631661436364584235346952195 \
  4056631661436364584235346952196 \
  4056631661436364584235346952197 \
  4056631661436364584235346952198 \
  4056631661436364584235346952199 \
  4056631661436364584235346952200 \
  4056631661436364584235346952201 \
  4056631661436364584235346952208; do
  cp "$RUSTPUSH_DIR/certs/legacy-fairplay/fairplay.pem" "$RUSTPUSH_DIR/certs/fairplay/$name.pem"
  cp "$RUSTPUSH_DIR/certs/legacy-fairplay/fairplay.crt" "$RUSTPUSH_DIR/certs/fairplay/$name.crt"
done

mkdir -p "$DIRECT_DIR/src"
cp "$ROOT/linux-sidecar/direct-imessage/Cargo.toml" "$DIRECT_DIR/Cargo.toml"
cp -R "$ROOT/linux-sidecar/direct-imessage/src/." "$DIRECT_DIR/src/"

sed -i "s#rustpush = { git = \"https://github.com/OpenBubbles/rustpush\", rev = \"$RUSTPUSH_REV\" }#rustpush = { path = \"$RUSTPUSH_DIR\" }#" "$DIRECT_DIR/Cargo.toml"
printf '\n[patch.crates-io]\nquinn = { path = "'$RUSTPUSH_DIR'/third_party/quinn/quinn" }\n' >> "$DIRECT_DIR/Cargo.toml"

echo "Building direct Linux iMessage backend..."
cargo build --manifest-path "$DIRECT_DIR/Cargo.toml" --release

BIN="$DIRECT_DIR/target/release/imsg-direct"
OUT="$ROOT/linux-sidecar/direct-imessage/target/release/imsg-direct"

if [[ ! -x "$BIN" ]]; then
  echo "Build completed but imsg-direct was not produced." >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT")"
cp "$BIN" "$OUT"
chmod 0755 "$OUT"

echo
echo "Built direct Linux iMessage backend:"
echo "  $OUT"
echo
echo "Provision once with:"
echo "  $OUT provision"
echo
echo "Then configure .env:"
echo "  MESSAGE_BACKEND=linux"
echo "  LINUX_IMESSAGE_COMMAND=$OUT"
echo "  LINUX_IMESSAGE_ARGS=[\"bridge\"]"
