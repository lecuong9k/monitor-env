#!/bin/sh
# Firewall MiniPC — chỉ UI local (tùy chọn)
# MediaMTX/WHEP chạy trên server Mbox, không mở ở đây

set -e

if ! command -v ufw >/dev/null 2>&1; then
  echo "ufw không có — MiniPC chỉ cần outbound tới Mbox (WS :20001) và MediaMTX API (:9997)"
  exit 0
fi

ufw allow 3000/tcp comment "monitor-env UI (tùy chọn)"

echo "Đã thêm rule ufw. Kiểm tra: ufw status"
