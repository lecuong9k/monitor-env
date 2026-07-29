#!/usr/bin/env bash
# Dừng toàn bộ monitor-env-be dev stack
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Đang dừng monitor-env-be services..."

sh "$ROOT/scripts/mediamtx-stop.sh" 2>/dev/null || true
sh "$ROOT/scripts/camera-service-stop.sh" 2>/dev/null || true
sh "$ROOT/scripts/dev-stop.sh" 2>/dev/null || true

echo "Xong."
