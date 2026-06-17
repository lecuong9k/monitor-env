#!/bin/bash
# Deploy monitor-env-be (mediamtx + camera-service + monitor-env) bằng PM2
#
# Cách dùng trên server Linux:
#   1. Copy monitor-env-be.zip vào /home/admin/
#   2. chsh deploy/deploy.sh && ./deploy/deploy.sh
#      hoặc: bash /home/admin/monitor-env-be/deploy/deploy.sh  (sau khi đã có bản cũ)
#
# Biến tùy chọn (export trước khi chạy):
#   ADMIN_DIR          — thư mục gốc (mặc định: /home/admin)
#   ZIP_FILE           — đường dẫn zip (mặc định: $ADMIN_DIR/monitor-env-be.zip)
#   MEDIAMTX_SOURCE    — binary mediamtx (mặc định: $ADMIN_DIR/mediamtx_library/mediamtx)
#   SKIP_UNZIP=1       — bỏ qua giải nén, chỉ cài deps + restart PM2
#   SKIP_NPM=1         — bỏ qua npm (deploy chỉ đổi code/config)
#   SKIP_FIREWALL=1    — không chạy setup-firewall.sh

set -euo pipefail

ADMIN_DIR="${ADMIN_DIR:-/home/admin}"
APP_DIR="${APP_DIR:-${ADMIN_DIR}/monitor-env-be}"
ZIP_FILE="${ZIP_FILE:-${ADMIN_DIR}/monitor-env-be.zip}"
MEDIAMTX_SOURCE="${MEDIAMTX_SOURCE:-${ADMIN_DIR}/mediamtx_library/mediamtx}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { printf '\n=== %s ===\n' "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Thiếu lệnh: $1"
}

load_env_file() {
  local file=$1
  [ -f "$file" ] || return 0
  set -a
  # shellcheck disable=SC1090
  . "$file"
  set +a
}

check_required_env() {
  local missing=0
  if [ -z "${CAMERA_SECRETS_KEY:-}" ]; then
    echo "  - CAMERA_SECRETS_KEY (sinh: npm run secrets:key)"
    missing=1
  fi
  if [ -z "${CAMERA_SERVICE_API_KEY:-}" ]; then
    echo "  - CAMERA_SERVICE_API_KEY (chuỗi ngẫu nhiên, vd: openssl rand -hex 32)"
    missing=1
  fi
  if [ "$missing" -eq 1 ]; then
    die "Thiếu biến bắt buộc trong .env.production hoặc .env.local"
  fi
  if ! printf '%s' "$CAMERA_SECRETS_KEY" | grep -Eq '^[0-9a-fA-F]{64}$'; then
    die "CAMERA_SECRETS_KEY phải là 64 ký tự hex"
  fi
}

wait_http() {
  local url=$1
  local label=$2
  local tries=${3:-15}
  local i=1
  while [ "$i" -le "$tries" ]; do
    if curl -sf "$url" >/dev/null 2>&1; then
      echo "OK: $label"
      return 0
    fi
    sleep 2
    i=$((i + 1))
  done
  echo "WARN: $label chưa phản hồi sau ${tries} lần thử ($url)"
  return 1
}

log "Kiểm tra công cụ"
require_cmd node
require_cmd npm
require_cmd pm2
require_cmd curl
require_cmd unzip

STAGING_BACKUP="${ADMIN_DIR}/monitor-env/backup/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$STAGING_BACKUP"

if [ -d "$APP_DIR" ]; then
  log "Sao lưu data & .env.local trước khi deploy"
  [ -d "${APP_DIR}/data" ] && cp -a "${APP_DIR}/data" "${STAGING_BACKUP}/"
  [ -f "${APP_DIR}/.env.local" ] && cp -a "${APP_DIR}/.env.local" "${STAGING_BACKUP}/"
fi

if [ "${SKIP_UNZIP:-0}" != "1" ]; then
  log "Giải nén source"
  [ -f "$ZIP_FILE" ] || die "Không tìm thấy zip: $ZIP_FILE"
  unzip -qo "$ZIP_FILE" -d "$ADMIN_DIR"
else
  log "Bỏ qua giải nén (SKIP_UNZIP=1)"
  [ -d "$APP_DIR" ] || die "Không tìm thấy APP_DIR: $APP_DIR"
fi

log "Khôi phục data & .env.local"
mkdir -p "${APP_DIR}/data"
if [ -d "${STAGING_BACKUP}/data" ]; then
  cp -a "${STAGING_BACKUP}/data/." "${APP_DIR}/data/" 2>/dev/null || true
fi
if [ -f "${STAGING_BACKUP}/.env.local" ]; then
  cp -a "${STAGING_BACKUP}/.env.local" "${APP_DIR}/.env.local"
fi

log "Copy MediaMTX binary"
if [ -f "$MEDIAMTX_SOURCE" ]; then
  cp -f "$MEDIAMTX_SOURCE" "${APP_DIR}/mediamtx"
  chmod +x "${APP_DIR}/mediamtx"
elif [ -x "${APP_DIR}/mediamtx" ]; then
  echo "Dùng mediamtx có sẵn trong ${APP_DIR}/mediamtx"
else
  die "Không tìm thấy mediamtx tại: $MEDIAMTX_SOURCE"
fi

log "Cài dependencies"
cd "$APP_DIR"
LOCK_HASH_FILE="${APP_DIR}/.deploy-lock-hash"

if [ "${SKIP_NPM:-0}" = "1" ]; then
  echo "Bỏ qua npm (SKIP_NPM=1)"
elif [ -f package-lock.json ]; then
  NEW_HASH=$(sha256sum package-lock.json | awk '{print $1}')
  if [ -f "$LOCK_HASH_FILE" ] && [ -d node_modules ] && [ "$(cat "$LOCK_HASH_FILE")" = "$NEW_HASH" ]; then
    echo "package-lock.json không đổi — bỏ qua npm ci"
  else
    rm -rf node_modules
    npm ci --omit=dev
    printf '%s\n' "$NEW_HASH" > "$LOCK_HASH_FILE"
  fi
else
  rm -rf node_modules
  npm install --omit=dev
  rm -f "$LOCK_HASH_FILE"
fi

log "Kiểm tra cấu hình môi trường"
load_env_file "${APP_DIR}/.env.production"
load_env_file "${APP_DIR}/.env.local"
check_required_env

log "Tắt systemd cũ (nếu có) để tránh trùng port"
if command -v systemctl >/dev/null 2>&1; then
  sudo systemctl disable --now mediamtx monitor-env 2>/dev/null || true
  sudo systemctl daemon-reload 2>/dev/null || true
fi

log "Giải phóng port MediaMTX"
npm run mediamtx:stop || true

if [ "${SKIP_FIREWALL:-0}" != "1" ] && [ -f "${SCRIPT_DIR}/setup-firewall.sh" ]; then
  log "Cấu hình firewall"
  if command -v sudo >/dev/null 2>&1; then
    sudo sh "${SCRIPT_DIR}/setup-firewall.sh" || true
  else
    sh "${SCRIPT_DIR}/setup-firewall.sh" || true
  fi
fi

log "Khởi động PM2 (mediamtx → camera-service → monitor-env)"
pm2 delete mediamtx camera-service monitor-env 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save

log "Chờ service sẵn sàng"
sleep 3
wait_http "http://127.0.0.1:9997/v3/config/global/get" "MediaMTX API" || true
wait_http "http://127.0.0.1:4001/health" "camera-service" || true
wait_http "http://127.0.0.1:3000/health" "monitor-env" || true

log "Kiểm tra API camera"
if curl -sf -H "X-Camera-Service-Key: ${CAMERA_SERVICE_API_KEY}" \
  "http://127.0.0.1:4001/cameras" >/dev/null; then
  echo "OK: GET /cameras (camera-service)"
else
  echo "WARN: camera-service /cameras chưa OK — xem: pm2 logs camera-service --lines 50"
fi

if curl -sf "http://127.0.0.1:3000/cameras" | grep -q '"id"'; then
  echo "OK: GET /cameras (monitor-env proxy)"
else
  echo "WARN: monitor-env /cameras chưa trả JSON — xem: pm2 logs monitor-env --lines 50"
fi

log "Deploy hoàn tất"
pm2 list
echo ""
echo "Backup tạm: ${STAGING_BACKUP}"
echo "Data: ${APP_DIR}/data"
echo "Logs: pm2 logs --lines 100"
echo "Web UI: http://<server-ip>:3000/#/camera"
