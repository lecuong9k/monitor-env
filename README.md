# monitor-env-be (MiniPC)

Kiến trúc: MiniPC kết nối WebSocket outbound lên Mbox; video stream qua **MediaMTX trung tâm** trên server Mbox.

## Deploy Production — MiniPC

### 1) Cấu hình

Sửa `.env.production` (hoặc `.env.local`):

| Biến                     | Mô tả                                    |
| ------------------------ | ---------------------------------------- |
| `EDGE_ID`                | Unique cho mỗi MiniPC (vd: `site-a-001`) |
| `MBOX_EDGE_WS_URL`       | `ws://<mbox-ip>:20001/edge/ws`           |
| `EDGE_AGENT_TOKEN`       | Trùng với Mbox                           |
| `MEDIAMTX_API_URL`       | `http://<mbox-ip>:9997`                  |
| `MEDIAMTX_WEBRTC_URL`    | `http://<mbox-ip>:8889`                  |
| `CAMERA_SECRETS_KEY`     | `npm run secrets:key`                    |
| `CAMERA_SERVICE_API_KEY` | `openssl rand -hex 32`                   |

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
