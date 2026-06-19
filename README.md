# monitor-env-be (MiniPC)

Kiến trúc: MiniPC kết nối WebSocket outbound lên Mbox; video stream qua **MediaMTX trung tâm** trên server Mbox.

## Deploy Production — MiniPC

### 1) Cấu hình

Sửa `.env.production` (hoặc `.env.local`):

| Biến                         | Mô tả                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `EDGE_ID`                    | Unique cho mỗi MiniPC (vd: `site-a-001`)                                     |
| `MBOX_EDGE_WS_URL`           | `ws://<mbox-ip>:20001/edge/ws`                                               |
| `EDGE_AGENT_TOKEN`           | Trùng với Mbox                                                               |
| `MEDIAMTX_API_URL`           | `http://<mbox-ip>:9997`                                                      |
| `MEDIAMTX_WEBRTC_URL`        | `http://<mbox-ip>:8889` — URL WHEP/WebRTC trung tâm (browser gọi trực tiếp)  |
| `MEDIAMTX_WEBRTC_ORIGIN_MAP` | Tùy chọn: `http://<fe-origin>=http://<whep-host>:8889` ghi đè theo origin FE |
| `MEDIAMTX_LOCAL_FALLBACK`    | `true` (mặc định) — relay MPEG-TS local khi MediaMTX sập, chỉ client LAN     |
| `CAMERA_SECRETS_KEY`         | `npm run secrets:key`                                                        |
| `CAMERA_SERVICE_API_KEY`     | `openssl rand -hex 32`                                                       |

### 2) Deploy

```bash
npm install --omit=dev
pm2 start ecosystem.config.cjs
pm2 save
```

Hoặc: `bash deploy/deploy.sh`

### 3) Kiểm tra

```bash
pm2 logs monitor-env --lines 50 | grep edge-agent
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:4001/health
```

Log edge agent: `[edge-agent] Registered as <EDGE_ID>`

### Development

```bash
# Terminal 1 — MediaMTX local (dev only)
npm run mediamtx

# Terminal 2 — camera-service
npm run camera-service:dev

# Terminal 3 — main app + edge agent
npm run dev
```

### Camera

Thêm camera tại `#/cau-hinh/camera`. Mỗi camera cần `mediamtx_path` **duy nhất toàn hệ thống** (vd: `site-a-cam1`).

```bash
curl -X POST http://127.0.0.1:4001/cameras \
  -H "Content-Type: application/json" \
  -H "X-Camera-Service-Key: $CAMERA_SERVICE_API_KEY" \
  -d '{"name":"Cam 1","host":"192.168.1.10","username":"admin","password":"secret","mediamtx_path":"site-a-cam1"}'
```

## MediaMTX

Production: chạy trên **server Mbox** — xem `Mbox/README` hoặc `Mbox/mediamtx.production.yml`.

MiniPC **không** chạy MediaMTX production.

### Backup local (MediaMTX sập)

Khi `STREAM_MODE=webrtc` và MediaMTX trung tâm không phản hồi, client UI local (localhost / IP LAN) tự chuyển sang relay **MPEG-TS qua FFmpeg** trên MiniPC. UI hiển thị banner cảnh báo; nhấn refresh stream để thử lại WebRTC khi MediaMTX hồi phục.

Yêu cầu: **ffmpeg** có trên MiniPC. Tắt backup: `MEDIAMTX_LOCAL_FALLBACK=false`.

Kiểm thử nhanh:

```bash
# Giả lập MediaMTX down — đổi URL sai, restart camera-service
# Mở http://<lan-ip>:3000 → chọn camera → stream qua WebSocket MPEG-TS
curl -X POST http://127.0.0.1:4001/cameras/1/stream/start \
  -H "Content-Type: application/json" \
  -H "X-Camera-Service-Key: $CAMERA_SERVICE_API_KEY" \
  -H "X-Client-Origin: http://192.168.1.100:3000"
# Response: "stream_type":"mpegts", "fallback":true
```
