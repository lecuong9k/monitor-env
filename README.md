# monitor-env-be (MiniPC)

Kiến trúc hybrid: **MediaMTX local** trên MiniPC + **MediaMTX central** trên Mbox.

## Luồng video (WebRTC + FFmpeg hub + relay)

```
Camera RTSP → FFmpeg transcode H.264 → MediaMTX local → WHEP → MiniPC UI
                              │
                              └─► FFmpeg relay (copy) → MediaMTX central → WHEP → Mbox UI
```

- **Primary ingest**: copy H.264 trước khi transcode; transcode qua `FFMPEG_VIDEO_ENCODER` (Pi: `h264_v4l2m2m`, dev: `libx264`) khi cần
- **Audio**: copy nếu camera đã AAC
- **Central relay**: copy RTSP local → central khi `remoteViewerCount > 0` — start/stop **độc lập**, không restart transcode
- **Path central**: khi `CENTRAL_PATH_REGISTERED_BY_MBOX=true`, **Mbox** đăng ký/xóa path trên MediaMTX central; MiniPC chỉ FFmpeg relay tới `MEDIAMTX_CENTRAL_RTSP_PUBLISH_URL`
- **scope=local** / **scope=remote**: chỉ tăng/giảm ref-count; join/leave một scope không làm giật viewer scope kia
- Không viewer → dừng cả primary và relay

### Viewer session (Hướng A)

Mỗi client gửi `viewerId` (UUID trong `sessionStorage`) khi `start` / `stop` / `quality` / `heartbeat`.

- `POST /cameras/:id/stream/heartbeat` — gia hạn session (~30s từ client)
- `WS /ws/camera-stream-heartbeat` — batch heartbeat qua WebSocket (giảm HTTP polling; fallback HTTP khi WS rớt)
- Viewer hết heartbeat sau `STREAM_VIEWER_HEARTBEAT_TTL_MS` (mặc định 45s) → lifecycle gỡ ghost count
- Viewer còn trong Map nhưng MTX `readerCount=0` liên tục sau `STREAM_READER_GHOST_MS` (mặc định 30s) → expire ghost + sync pipeline
- Startup + periodic sweep: dọn path MTX `-(main|sub|mobile)` không còn trong `streams` Map
- `POST /cameras/:id/stream/restart` — **deprecated (410)**; refresh client = `status` + reconnect WHEP

## Deploy Production — MiniPC

### 1) Cấu hình `.env.production`

| Biến                                | Mô tả                                              |
| ----------------------------------- | -------------------------------------------------- |
| `DEVICE_ID`                           | Unique cho mỗi MiniPC                              |
| `MBOX_EDGE_WS_URL`                  | `ws://<mbox-ip>:20001/edge/ws`                     |
| `EDGE_AGENT_TOKEN`                  | Trùng với Mbox                                     |
| `AI_AGENT_TOKEN`                    | Token AI canonical, trùng với Mbox/Dock AI agent   |
| `MEDIAMTX_LOCAL_API_URL`            | `http://127.0.0.1:9997`                            |
| `MEDIAMTX_LOCAL_WEBRTC_URL`         | `http://<lan-ip>:8889` (tùy chọn, auto-detect LAN) |
| `MEDIAMTX_CENTRAL_API_URL`          | `http://<mbox-ip>:9997`                            |
| `MEDIAMTX_CENTRAL_WEBRTC_URL`       | `http://<mbox-ip>:8889`                            |
| `MEDIAMTX_CENTRAL_RTSP_PUBLISH_URL` | `rtsp://<mbox-ip>:8554`                            |
| `STREAM_MODE`                       | `webrtc` (mặc định) hoặc `hls`                     |
| `FFMPEG_VIDEO_ENCODER`              | Dev: `libx264` · Prod Pi: `h264_v4l2m2m`           |
| `FFMPEG_VIDEO_ENCODER_FALLBACK`     | `libx264` — khi encoder env không có trên máy      |
| `STREAM_VIEWER_HEARTBEAT_TTL_MS`    | 45000 — TTL viewer không heartbeat                 |
| `STREAM_READER_GHOST_MS`            | 30000 — ghost khi không còn MTX reader             |
| `STREAM_IDLE_POLL_MS`               | 15000 — chu kỳ lifecycle poller                    |
| `STREAM_IDLE_STOP_MS`               | 120000 — dừng ingest khi idle                      |
| `STREAM_MTX_SWEEP_EVERY_POLLS`      | 4 — sweep path MTX mỗi N chu kỳ                    |

### 2) MediaMTX local

```bash
# Binary phải tải TRÊN MiniPC Linux (không copy từ Mac — sẽ lỗi Exec format error)
npm run mediamtx:install
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

### Edge AI agent (LAN)

Máy AI cùng LAN kết nối `WS /ws/ai-agent` (auth `AI_AGENT_TOKEN`) để lấy full config camera và gửi `ai_event`; MiniPC relay lên Mbox. Chi tiết: [docs/edge-ai-agent-lan-protocol.md](docs/edge-ai-agent-lan-protocol.md).

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
