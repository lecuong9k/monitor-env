#!/bin/sh
# Giải phóng port camera-service (mặc định 4001)
set -e
cd "$(dirname "$0")/.."

PORT="${CAMERA_SERVICE_PORT:-4001}"

kill_port() {
  pids=$(lsof -ti "tcp:${PORT}" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "Stopping tcp:${PORT} (PID $pids)"
    kill $pids 2>/dev/null || kill -9 $pids 2>/dev/null || true
  fi
}

kill_port

pkill -f "src/camera-service/app.js" 2>/dev/null || true

echo "Camera service port ${PORT} cleared."
