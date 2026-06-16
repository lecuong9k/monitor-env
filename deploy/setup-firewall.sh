#!/bin/sh
# Mở port production cho monitor-env + MediaMTX WebRTC
# Chạy trên Linux server: sudo sh deploy/setup-firewall.sh

set -e

if ! command -v ufw >/dev/null 2>&1; then
  echo "ufw không có — cấu hình firewall thủ công:"
  echo "  TCP: 3000 (app), 8889 (WebRTC/WHEP)"
  echo "  UDP: 8189 (WebRTC ICE)"
  echo "  KHÔNG mở: 9997 (Control API), 8554 (RTSP nội bộ)"
  exit 0
fi

ufw allow 3000/tcp comment "monitor-env app"
ufw allow 8889/tcp comment "MediaMTX WebRTC WHEP"
ufw allow 8189/udp comment "MediaMTX WebRTC ICE"

echo "Đã thêm rule ufw. Kiểm tra: ufw status"
