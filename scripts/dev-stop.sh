#!/bin/sh
# Giải phóng port monitor-env-be dev (Fastify :3000)
set -e
cd "$(dirname "$0")/.."

PORT="${PORT:-3000}"

kill_port() {
  pids=$(lsof -ti "tcp:${PORT}" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "Stopping tcp:${PORT} (PID $pids)"
    kill $pids 2>/dev/null || kill -9 $pids 2>/dev/null || true
  fi
}

kill_port

pkill -f "node --import ./src/load-env.js --watch src/app.js" 2>/dev/null || true

echo "monitor-env-be dev port ${PORT} cleared."
