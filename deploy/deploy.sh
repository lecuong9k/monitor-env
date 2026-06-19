#!/bin/bash
# =============================================================================
# Deploy MiniPC (monitor-env-be) — mô hình Edge + MediaMTX trung tâm
#
# MiniPC chạy:
#   - camera-service (:4001) — PTZ, đẩy RTSP lên MediaMTX trên server Mbox
#   - monitor-env (:3000)   — edge agent WebSocket outbound → Mbox /edge/ws
#
# KHÔNG deploy MediaMTX trên MiniPC (video qua server Mbox).
#
# Cách dùng (trên Linux):
#   cd /home/admin/monitor-env-be
#   bash deploy/deploy.sh
#
# Biến tùy chọn (export trước khi chạy):
#   ADMIN_DIR=/home/admin
#   APP_DIR=$ADMIN_DIR/monitor-env-be
#   ZIP_FILE=$ADMIN_DIR/monitor-env-be.zip
#   SKIP_UNZIP=1       — bỏ giải nén, chỉ cài deps + restart PM2
#   SKIP_NPM=1         — bỏ npm install/ci
#   SKIP_FIREWALL=1    — không chạy setup-firewall.sh
#   SKIP_PREFLIGHT=1   — bỏ kiểm tra kết nối Mbox / MediaMTX trước deploy
# =============================================================================

set -euo pipefail

ADMIN_DIR="${ADMIN_DIR:-/home/admin}"
APP_DIR="${APP_DIR:-${ADMIN_DIR}/monitor-env-be}"
ZIP_FILE="${ZIP_FILE:-${ADMIN_DIR}/monitor-env-be.zip}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { printf '\n=== %s ===\n' "$*"; }
warn() { echo "WARN: $*" >&2; }
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

# ws://host:20001/edge/ws → http://host:20001
mbox_http_base_from_ws_url() {
  local ws_url=$1
  local hostport scheme=http

  if [[ "$ws_url" =~ ^wss://([^/]+) ]]; then
    hostport="${BASH_REMATCH[1]}"
    scheme=https
  elif [[ "$ws_url" =~ ^ws://([^/]+) ]]; then
    hostport="${BASH_REMATCH[1]}"
    scheme=http
  else
    die "MBOX_EDGE_WS_URL không hợp lệ: $ws_url"
  fi

  printf '%s://%s' "$scheme" "$hostport"
}

mediamtx_api_base() {
  printf '%s' "${MEDIAMTX_API_URL%/}"
}

check_required_env() {
  local missing=0
  local var

  for var in \
    CAMERA_SERVICE_API_KEY \
    EDGE_ID \
    MBOX_EDGE_WS_URL \
    EDGE_AGENT_TOKEN \
    MEDIAMTX_API_URL \
    MEDIAMTX_WEBRTC_URL; do
    if [ -z "${!var:-}" ]; then
      echo "  - $var"
      missing=1
    fi
  done

  if [ "$missing" -eq 1 ]; then
    die "Thiếu biến bắt buộc trong .env.production hoặc .env.local"
  fi

  if ! printf '%s' "$EDGE_ID" | grep -Eq '^[a-zA-Z0-9._-]{1,64}$'; then
    die "EDGE_ID không hợp lệ: $EDGE_ID (1–64 ký tự: a-z A-Z 0-9 . _ -)"
  fi

  if [ "${STREAM_MODE:-webrtc}" != "webrtc" ]; then
    warn "STREAM_MODE=${STREAM_MODE:-} — production khuyến nghị webrtc + MediaMTX trung tâm"
  fi
}

wait_http() {
  local url=$1
  local label=$2
  local tries=${3:-15}
  local i=1

  while [ "$i" -le "$tries" ]; do
    if curl -sf --connect-timeout 5 "$url" >/dev/null 2>&1; then
      echo "OK: $label"
      return 0
    fi
    sleep 2
    i=$((i + 1))
  done

  warn "$label chưa phản hồi ($url)"
  return 1
}

preflight_remote_services() {
  local mtx_url mbox_http

  mtx_url="$(mediamtx_api_base)/v3/config/global/get"
  mbox_http="$(mbox_http_base_from_ws_url "$MBOX_EDGE_WS_URL")"

  log "Preflight — kiểm tra dịch vụ trên server Mbox"

  if wait_http "$mtx_url" "MediaMTX API ($MEDIAMTX_API_URL)" 5; then
    :
  else
    warn "MiniPC không reach được MediaMTX API — kiểm tra firewall Mbox (:9997) và MEDIAMTX_API_URL"
  fi

  if wait_http "${mbox_http}/api/edge/status" "Mbox edge gateway" 5; then
    if curl -sf "${mbox_http}/api/edge/status" | grep -q '"enabled":true'; then
      echo "OK: EDGE_GATEWAY_ENABLED trên Mbox"
    else
      warn "Edge gateway trên Mbox chưa bật (EDGE_GATEWAY_ENABLED != true)"
    fi
  else
    warn "Không gọi được ${mbox_http}/api/edge/status — kiểm tra Mbox và outbound WS"
  fi
}

cleanup_legacy_mediamtx() {
  log "Dọn MediaMTX cũ trên MiniPC (nếu có)"

  pm2 delete mediamtx 2>/dev/null || true

  if command -v systemctl >/dev/null 2>&1; then
    sudo systemctl disable --now mediamtx 2>/dev/null || true
    sudo systemctl daemon-reload 2>/dev/null || true
  fi

  if [ -f "${APP_DIR}/scripts/mediamtx-stop.sh" ]; then
    sh "${APP_DIR}/scripts/mediamtx-stop.sh" || true
  elif [ -f "${APP_DIR}/package.json" ] && grep -q '"mediamtx:stop"' "${APP_DIR}/package.json" 2>/dev/null; then
    (cd "$APP_DIR" && npm run mediamtx:stop) || true
  fi

  if [ -x "${APP_DIR}/mediamtx" ]; then
    warn "Phát hiện binary mediamtx local tại ${APP_DIR}/mediamtx — production dùng MediaMTX trên Mbox, có thể xóa file này"
  fi
}

wait_edge_agent_registered() {
  local edge_id=$1
  local tries=${2:-25}
  local i=1
  local logs

  echo "Chờ edge agent đăng ký EDGE_ID=${edge_id}..."

  while [ "$i" -le "$tries" ]; do
    logs=$(pm2 logs monitor-env --lines 80 --nostream 2>/dev/null || true)
    if printf '%s' "$logs" | grep -q "Registered as ${edge_id}"; then
      echo "OK: edge agent đã đăng ký (${edge_id})"
      return 0
    fi
    if printf '%s' "$logs" | grep -qi "Unauthorized\|invalid edgeId"; then
      die "Edge agent bị từ chối — kiểm tra EDGE_AGENT_TOKEN và EDGE_ID"
    fi
    sleep 2
    i=$((i + 1))
  done

  warn "Chưa thấy log đăng ký edge — xem: pm2 logs monitor-env --lines 100"
  return 1
}

verify_edge_on_mbox() {
  local mbox_http edge_id=$1

  mbox_http="$(mbox_http_base_from_ws_url "$MBOX_EDGE_WS_URL")"

  if ! curl -sf --connect-timeout 5 "${mbox_http}/api/edge/${edge_id}/health" >/dev/null 2>&1; then
    warn "Mbox chưa thấy edge online: GET /api/edge/${edge_id}/health"
    return 1
  fi

  if curl -sf "${mbox_http}/api/edge/${edge_id}/health" | grep -q '"online":true'; then
    echo "OK: Mbox xác nhận edge ${edge_id} online"
    return 0
  fi

  warn "Edge ${edge_id} chưa online trên Mbox"
  return 1
}

# --- Main ---

log "Kiểm tra công cụ"
require_cmd node
require_cmd npm
require_cmd pm2
require_cmd curl
require_cmd unzip

STAGING_BACKUP="${ADMIN_DIR}/monitor-env/backup/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$STAGING_BACKUP"

if [ -d "$APP_DIR" ]; then
  log "Sao lưu data & .env.local"
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
for env_file in "${APP_DIR}/.env.production" "${APP_DIR}/.env.local"; do
  [ -f "$env_file" ] && sed -i 's/\r$//' "$env_file" 2>/dev/null || true
done
load_env_file "${APP_DIR}/.env.production"
load_env_file "${APP_DIR}/.env.local"
check_required_env

if [ "${SKIP_PREFLIGHT:-0}" != "1" ]; then
  preflight_remote_services
else
  log "Bỏ qua preflight (SKIP_PREFLIGHT=1)"
fi

cleanup_legacy_mediamtx

if command -v systemctl >/dev/null 2>&1; then
  sudo systemctl disable --now monitor-env 2>/dev/null || true
fi

if [ "${SKIP_FIREWALL:-0}" != "1" ] && [ -f "${SCRIPT_DIR}/setup-firewall.sh" ]; then
  log "Cấu hình firewall MiniPC"
  if command -v sudo >/dev/null 2>&1; then
    sudo sh "${SCRIPT_DIR}/setup-firewall.sh" || true
  else
    sh "${SCRIPT_DIR}/setup-firewall.sh" || true
  fi
fi

log "Khởi động PM2 (camera-service → monitor-env + edge agent)"
pm2 delete camera-service monitor-env mediamtx 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save

log "Chờ service local sẵn sàng"
sleep 3
wait_http "http://127.0.0.1:4001/health" "camera-service" || true
wait_http "http://127.0.0.1:3000/health" "monitor-env" || true

log "Kiểm tra camera-service API"
if curl -sf -H "X-Camera-Service-Key: ${CAMERA_SERVICE_API_KEY}" \
  "http://127.0.0.1:4001/cameras" >/dev/null; then
  echo "OK: GET /cameras (camera-service)"
else
  warn "camera-service /cameras chưa OK — pm2 logs camera-service --lines 50"
fi

log "Kiểm tra edge agent → Mbox"
wait_edge_agent_registered "$EDGE_ID" || true
verify_edge_on_mbox "$EDGE_ID" || true

log "Deploy hoàn tất"
pm2 list
echo ""
echo "────────────────────────────────────────"
echo "MiniPC     : $(hostname 2>/dev/null || echo unknown)"
echo "EDGE_ID    : ${EDGE_ID}"
echo "Mbox WS    : ${MBOX_EDGE_WS_URL}"
echo "MediaMTX   : ${MEDIAMTX_WEBRTC_URL} (WHEP)"
echo "Backup     : ${STAGING_BACKUP}"
echo ""
echo "Kiểm tra thêm:"
echo "  pm2 logs monitor-env --lines 50 | grep edge-agent"
echo "  curl $(mbox_http_base_from_ws_url "$MBOX_EDGE_WS_URL")/api/edge/status"
echo "  curl $(mbox_http_base_from_ws_url "$MBOX_EDGE_WS_URL")/api/edge/${EDGE_ID}/health"
echo "────────────────────────────────────────"
