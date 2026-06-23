# monitor-env-be (MiniPC)

Kiến trúc hybrid: **MediaMTX local** trên MiniPC + **MediaMTX central** trên Mbox.

## Luồng video

```
Camera (LAN) ← pull on-demand ← MediaMTX local (:8889 WHEP) ← MiniPC UI
                                    ↓ FFmpeg relay (khi remote)
                              MediaMTX central (:8889 WHEP) ← Mbox UI
```

- **scope=local** (MiniPC UI): chỉ ingest local, WHEP local
- **scope=remote** (Mbox temp-info-box): ingest local + relay FFmpeg lên central
- **Không còn** fallback MPEG-TS/WebSocket

## Deploy Production — MiniPC

### 1) Cấu hình `.env.production`

| Biến                                | Mô tả                                              |
| ----------------------------------- | -------------------------------------------------- |
| `EDGE_ID`                           | Unique cho mỗi MiniPC                              |
| `MBOX_EDGE_WS_URL`                  | `ws://<mbox-ip>:20001/edge/ws`                     |
| `EDGE_AGENT_TOKEN`                  | Trùng với Mbox                                     |
| `MEDIAMTX_LOCAL_API_URL`            | `http://127.0.0.1:9997`                            |
| `MEDIAMTX_LOCAL_WEBRTC_URL`         | `http://<lan-ip>:8889` (tùy chọn, auto-detect LAN) |
| `MEDIAMTX_CENTRAL_API_URL`          | `http://<mbox-ip>:9997`                            |
| `MEDIAMTX_CENTRAL_WEBRTC_URL`       | `http://<mbox-ip>:8889`                            |
| `MEDIAMTX_CENTRAL_RTSP_PUBLISH_URL` | `rtsp://<mbox-ip>:8554`                            |

### 2) MediaMTX local

```bash
# Cần binary ./mediamtx (tải từ bluenviron/mediamtx releases)
npm run mediamtx:prod   # hoặc PM2 ecosystem
```

PM2 chạy: `mediamtx` → `camera-service` → `monitor-env`

### 3) Deploy

```bash
npm install --omit=dev
pm2 start ecosystem.config.cjs
pm2 save
```

Hoặc: `bash deploy/deploy.sh`

### Development

```bash
# Terminal 1 — MediaMTX local
npm run mediamtx:dev

# Terminal 2 — camera-service
npm run camera-service:dev

# Terminal 3 — main app + edge agent
npm run dev
```

### API stream (scope)

```bash
# MiniPC UI — local WHEP
curl -X POST http://127.0.0.1:4001/cameras/1/stream/start \
  -H "X-Camera-Service-Key: $CAMERA_SERVICE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"qualityId":"mobile","scope":"local"}'

# Mbox remote — central WHEP (qua edge RPC)
curl -X POST http://127.0.0.1:4001/cameras/1/stream/start \
  -H "X-Camera-Service-Key: $CAMERA_SERVICE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"qualityId":"mobile","scope":"remote"}'

# Dừng remote relay
curl -X POST http://127.0.0.1:4001/cameras/1/stream/stop \
  -H "X-Camera-Service-Key: $CAMERA_SERVICE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"scope":"remote"}'
```

### Firewall MiniPC

- Mở `8889/tcp` + `8189/udp` cho LAN (WHEP local UI)
- Không cần expose MediaMTX ra internet

### Firewall VPS (Mbox)

| Port     | Hướng         | Mục đích                   |
| -------- | ------------- | -------------------------- |
| 8554/tcp | MiniPC → VPS  | FFmpeg RTSP relay          |
| 8889/tcp | Browser → VPS | WHEP remote                |
| 8189/udp | Browser ↔ VPS | WebRTC ICE                 |
| 9997/tcp | MiniPC → VPS  | MediaMTX API (giới hạn IP) |
