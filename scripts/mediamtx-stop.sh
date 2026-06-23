#!/bin/sh
# Dừng MediaMTX local và giải phóng port (8889, 9997, 8554, 8189)
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

kill_port tcp 8889
kill_port tcp 9997
kill_port tcp 8554
kill_port udp 8189

if [ -x "./mediamtx" ]; then
  pkill -f "$(pwd)/mediamtx" 2>/dev/null || true
fi

echo "MediaMTX local ports cleared."
