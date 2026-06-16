#!/bin/bash

set -e

APP_DIR="/home/admin/monitor-env-be"
DATA_DIR="/home/admin/monitor-env/data"
MEDIAMTX_SOURCE="/home/admin/mediamtx_library/mediamtx"

echo "=== Unzip source ==="
unzip -qo monitor-env-be.zip -d /home/admin

echo "=== Clean old dependencies ==="
rm -rf "${APP_DIR}/node_modules"

echo "=== Restore data ==="
mkdir -p "${APP_DIR}/data"
cp -r "${DATA_DIR}/. " "${APP_DIR}/data/" 2>/dev/null || true

echo "=== Copy MediaMTX ==="
cp -f "${MEDIAMTX_SOURCE}" "${APP_DIR}/mediamtx"
chmod +x "${APP_DIR}/mediamtx"

echo "=== Install dependencies ==="
cd "${APP_DIR}"

if [ -f package-lock.json ]; then
npm ci --omit=dev
else
npm install --omit=dev
fi

echo "=== Restart PM2 ==="
pm2 delete all || true
pm2 start ecosystem.config.cjs

echo "=== Save PM2 state ==="
pm2 save

echo "=== Deploy completed ==="
pm2 list
