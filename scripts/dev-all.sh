#!/usr/bin/env bash
# Chạy đồng thời: mediamtx:dev, camera-service:dev, dev
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PIDS=()
CLEANING_UP=0

kill_tree() {
  local pid="$1"
  local sig="$2"
  local child

  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill_tree "$child" "$sig"
  done

  kill "-$sig" "$pid" 2>/dev/null || true
}

run_stop_scripts() {
  sh "$ROOT/scripts/mediamtx-stop.sh" 2>/dev/null || true
  sh "$ROOT/scripts/camera-service-stop.sh" 2>/dev/null || true
  sh "$ROOT/scripts/dev-stop.sh" 2>/dev/null || true
}

cleanup() {
  if [ "$CLEANING_UP" -eq 1 ]; then
    return
  fi
  CLEANING_UP=1
  trap '' SIGINT SIGTERM

  echo ""
  echo "Đang dừng monitor-env-be services..."

  for pid in "${PIDS[@]}"; do
    kill_tree "$pid" TERM
  done

  sleep 1

  for pid in "${PIDS[@]}"; do
    kill_tree "$pid" KILL
  done

  run_stop_scripts

  wait 2>/dev/null || true
  exit 0
}

trap cleanup SIGINT SIGTERM

run_service() {
  local name="$1"
  shift

  (
    cd "$ROOT" || exit 1
    "$@" 2>&1 | while IFS= read -r line; do
      printf '[%s] %s\n' "$name" "$line"
    done
  ) &

  PIDS+=("$!")
}

echo "Khởi động monitor-env-be: mediamtx:dev, camera-service:dev, dev"
echo "Nhấn Ctrl+C để dừng tất cả."
echo ""

run_service "mediamtx"         npm run mediamtx:dev
run_service "camera-service"   npm run camera-service:dev
run_service "be"               npm run dev

wait
