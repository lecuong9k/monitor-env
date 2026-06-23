#!/bin/sh
# Tải binary MediaMTX đúng kiến trúc Linux (chạy TRÊN MiniPC, không phải Mac).
#
#   sh scripts/install-mediamtx.sh
#   MEDIAMTX_VERSION=v1.19.1 sh scripts/install-mediamtx.sh
#
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MEDIAMTX_VERSION="${MEDIAMTX_VERSION:-v1.19.1}"
BIN_PATH="${MEDIAMTX_BIN:-$ROOT/mediamtx}"

detect_linux_arch() {
  arch="$(uname -m 2>/dev/null || true)"
  case "$arch" in
    x86_64|amd64) printf '%s' "linux_amd64" ;;
    aarch64|arm64) printf '%s' "linux_arm64" ;;
    armv7l|armv7) printf '%s' "linux_armv7" ;;
    armv6l|armv6) printf '%s' "linux_armv6" ;;
    *)
      echo "ERROR: Kiến trúc không hỗ trợ: $arch (chỉ linux x86_64 / arm64 / armv7 / armv6)" >&2
      return 1
      ;;
  esac
}

mediamtx_binary_ok() {
  [ -x "$BIN_PATH" ] || return 1
  if "$BIN_PATH" --help >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

if [ "$(uname -s 2>/dev/null || true)" != "Linux" ]; then
  echo "WARN: Script này dành cho Linux MiniPC. Trên Mac/Windows chỉ dùng để kiểm tra, không chạy ./mediamtx." >&2
fi

if mediamtx_binary_ok; then
  echo "OK: $BIN_PATH đã sẵn sàng ($("$BIN_PATH" --help 2>&1 | head -1 || true))"
  exit 0
fi

if [ -f "$BIN_PATH" ]; then
  echo "WARN: $BIN_PATH không chạy được (thường là sai kiến trúc — ví dụ tải trên Mac rồi copy sang Linux)." >&2
  rm -f "$BIN_PATH"
fi

linux_arch="$(detect_linux_arch)"
asset="mediamtx_${MEDIAMTX_VERSION}_${linux_arch}.tar.gz"
url="https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX_VERSION}/${asset}"

echo "Tải MediaMTX ${MEDIAMTX_VERSION} (${linux_arch})..."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT HUP TERM

if command -v curl >/dev/null 2>&1; then
  curl -fL "$url" -o "$tmp/$asset"
elif command -v wget >/dev/null 2>&1; then
  wget -q "$url" -O "$tmp/$asset"
else
  echo "ERROR: Cần curl hoặc wget để tải $url" >&2
  exit 1
fi

tar -xzf "$tmp/$asset" -C "$tmp"
if [ ! -f "$tmp/mediamtx" ]; then
  echo "ERROR: Không tìm thấy mediamtx trong $asset" >&2
  exit 1
fi

mv "$tmp/mediamtx" "$BIN_PATH"
chmod +x "$BIN_PATH"

if ! mediamtx_binary_ok; then
  echo "ERROR: Đã tải nhưng binary vẫn không chạy — kiểm tra kiến trúc: uname -m" >&2
  exit 1
fi

echo "OK: Đã cài $BIN_PATH ($("$BIN_PATH" --help 2>&1 | head -1 || true))"
