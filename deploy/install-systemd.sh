#!/bin/sh
# Cài systemd units — chạy trên Linux server với quyền root
# Usage: sudo sh deploy/install-systemd.sh /opt/monitor-env-be

set -e

APP_DIR="${1:-/opt/monitor-env-be}"

if [ ! -f "$APP_DIR/mediamtx.production.yml" ]; then
  echo "Không tìm thấy $APP_DIR/mediamtx.production.yml"
  exit 1
fi

sed "s|/opt/monitor-env-be|$APP_DIR|g" "$APP_DIR/deploy/mediamtx.service" \
  > /etc/systemd/system/mediamtx.service

sed "s|/opt/monitor-env-be|$APP_DIR|g" "$APP_DIR/deploy/monitor-env.service" \
  > /etc/systemd/system/monitor-env.service

# Đường dẫn node thực tế
NODE_PATH=$(command -v node)
sed -i "s|/usr/bin/node|$NODE_PATH|g" /etc/systemd/system/monitor-env.service

systemctl daemon-reload
systemctl enable mediamtx monitor-env

echo "Đã cài systemd. Khởi động:"
echo "  sudo systemctl start mediamtx"
echo "  sudo systemctl start monitor-env"
echo "  sudo systemctl status mediamtx monitor-env"
