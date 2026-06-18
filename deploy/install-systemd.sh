#!/bin/sh
# Cài systemd cho MiniPC (không gồm MediaMTX)
# Usage: sudo sh deploy/install-systemd.sh /opt/monitor-env-be

set -e

APP_DIR="${1:-/opt/monitor-env-be}"

if [ ! -f "$APP_DIR/.env.production" ]; then
  echo "Không tìm thấy $APP_DIR/.env.production"
  exit 1
fi

sed "s|/opt/monitor-env-be|$APP_DIR|g" "$APP_DIR/deploy/monitor-env.service" \
  > /etc/systemd/system/monitor-env.service

NODE_PATH=$(command -v node)
sed -i "s|/usr/bin/node|$NODE_PATH|g" /etc/systemd/system/monitor-env.service

systemctl daemon-reload
systemctl enable monitor-env

echo "Đã cài systemd. Khởi động:"
echo "  sudo systemctl start monitor-env"
echo "  sudo systemctl status monitor-env"
echo ""
echo "Lưu ý: chạy camera-service riêng (PM2 hoặc thêm unit)"
