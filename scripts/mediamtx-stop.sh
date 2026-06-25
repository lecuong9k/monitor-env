#!/bin/sh
# Dừng MediaMTX local dev (mediamtx.dev.yml) — KHÔNG đụng port Mbox central
# monitor-env-be: 8890, 9996, 8555, 9995, 18190/udp
set -e
cd "$(dirname "$0")/.."

kill_port() {
  proto=$1
  port=$2
  pids=$(lsof -ti "$proto:$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "Stopping $proto:$port (PID $pids)"
    kill $pids 2>/dev/null || kill -9 $pids 2>/dev/null || true
  fi
}

kill_port tcp 8890
kill_port tcp 9996
kill_port tcp 8555
kill_port tcp 9995
kill_port udp 18190

if [ -x "./mediamtx" ]; then
  pkill -f "$(pwd)/mediamtx" 2>/dev/null || true
fi

echo "MediaMTX local ports cleared."
