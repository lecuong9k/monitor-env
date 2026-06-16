# monitor-env-be

## Deploy Production with PM2 (Linux)

### 1) Chuẩn bị source

```bash
cd /home/admin/monitor-env-be
npm install --omit=dev
```

> Nếu FE tách repo, build FE trước rồi copy vào `dist/` của BE.

### 2) Cấu hình môi trường

- Sửa `.env.production` theo IP server/camera thật.
- Có thể tạo `.env.local` để ghi đè secret, file này không commit.

### 3) Cài MediaMTX binary

```bash
cd /home/admin/monitor-env-be

# x86_64
curl -LO https://github.com/bluenviron/mediamtx/releases/download/v1.19.1/mediamtx_v1.19.1_linux_amd64.tar.gz

# arm64 (Raspberry Pi aarch64)
# curl -LO https://github.com/bluenviron/mediamtx/releases/download/v1.19.1/mediamtx_v1.19.1_linux_arm64.tar.gz

tar -xzf mediamtx_v1.19.1_linux_*.tar.gz
chmod +x mediamtx
```

### 4) Nếu đã từng bật systemd trước đó, tắt để tránh đụng port

```bash
sudo systemctl disable --now mediamtx monitor-env || true
sudo systemctl daemon-reload
```

### 5) Chạy bằng PM2

```bash
cd /home/admin/monitor-env-be
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
# chạy lệnh sudo mà PM2 in ra để auto start sau reboot
```

### 6) Mở firewall

- `3000/tcp` (web app)
- `8889/tcp` (WHEP)
- `8189/udp` (WebRTC ICE)
- Không mở `9997` ra public

### 7) Kiểm tra nhanh

```bash
pm2 list
pm2 logs mediamtx --lines 100
pm2 logs monitor-env --lines 100

curl http://127.0.0.1:9997/v3/config/global/get
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/cameras
```

Nếu `/cameras` trả `text/html` thay vì JSON, nghĩa là FE/API base URL hoặc bản dist chưa đúng phiên bản.
