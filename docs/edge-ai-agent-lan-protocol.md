# Edge AI Agent ↔ MiniPC — WebSocket protocol (LAN)

Agent AI (máy riêng cùng LAN với MiniPC) **chỉ** dùng một WebSocket tới monitor-env-be:

`ws://<minipc-ip>:3000/ws/ai-agent`

Không dùng HTTP cho camera/event. Không kết nối thẳng Mbox — MiniPC relay `ai_event` qua edge WS sẵn có (`MBOX_EDGE_WS_URL`).

## Env

| Biến                                                | Nơi            | Mô tả                                    |
| --------------------------------------------------- | -------------- | ---------------------------------------- |
| `EDGE_AI_AGENT_TOKEN`                               | MiniPC + agent | Shared secret LAN; gateway tắt nếu empty |
| `EDGE_AI_EVENT_MAX_THUMBNAIL_BYTES`                 | MiniPC         | Mặc định `524288` (512KB)                |
| `MBOX_EDGE_WS_URL` / `EDGE_ID` / `EDGE_AGENT_TOKEN` | MiniPC         | Cần online để `forwarded: true`          |

## Luồng

```
Edge AI Agent  --WS /ws/ai-agent-->  MiniPC (:3000)
                                         |
                                         | forwardAiEvent
                                         v
                                    Mbox /edge/ws  →  handleEdgeAiEvent
```

Agent **không** bắt buộc pull qua MediaMTX MiniPC. `get_cameras` trả full config (kèm password); agent tự dùng theo pipeline riêng.

## Messages

### Auth

Agent → MiniPC:

```json
{ "type": "auth", "token": "<EDGE_AI_AGENT_TOKEN>" }
```

Hoặc token trên query: `ws://.../ws/ai-agent?token=...` (nhận `auth_ok` ngay).

MiniPC → Agent: `{ "type": "auth_ok" }` hoặc đóng socket khi sai.

### Lấy camera (full config)

Agent → MiniPC: `{ "type": "get_cameras" }`

MiniPC → Agent:

```json
{
  "type": "cameras",
  "cameras": [
    {
      "id": 1,
      "cameraId": "cam-site-a-1",
      "name": "Cam cổng",
      "host": "192.168.1.10",
      "onvif_port": 80,
      "rtsp_port": 554,
      "username": "admin",
      "password": "...",
      "rtsp_url_override": null,
      "rtsp_path_main": "/rtsp/streaming?channel=01&subtype=0",
      "rtsp_path_sub": "/rtsp/streaming?channel=01&subtype=1",
      "rtsp_path_mobile": "/rtsp/streaming?channel=01&subtype=2",
      "ptz_enabled": true,
      "mediamtx_path": "cam-site-a-1",
      "stream_quality": "main",
      "home_preset_token": "255",
      "status": 1
    }
  ]
}
```

- Chỉ camera `status = 1`.
- `cameraId` trong `ai_event` = `mediamtx_path` (ổn định hơn id số).
- Password chỉ đi trên socket đã auth — không log.

### Submit AI event

Agent → MiniPC:

```json
{
  "type": "ai_event",
  "eventType": "fire_detected",
  "cameraId": "cam-site-a-1",
  "timestamp": "2026-07-14T08:00:00Z",
  "thumbnail": "<jpeg-b64>",
  "objects": [
    {
      "class_name": "fire",
      "confidence": 0.92,
      "bbox": { "x1": 0, "y1": 0, "x2": 100, "y2": 100 }
    }
  ]
}
```

Không gửi `edgeId` — Mbox gắn từ session MiniPC.

MiniPC → Agent:

```json
{ "type": "ai_event_ack", "ok": true, "forwarded": true }
```

hoặc `{ "ok": false, "forwarded": false, "error": "edge offline" }`.

### Heartbeat (tuỳ chọn)

`{ "type": "ping" }` → `{ "type": "pong", "at": "..." }`

## Script mẫu

```bash
cd monitor-env-be
EDGE_AI_AGENT_TOKEN=... MINIPC_WS_URL=ws://127.0.0.1:3000/ws/ai-agent \
  node scripts/ai-agent-ws-sample.mjs
```

## File liên quan

- [`src/routes/ai-agent.ws.js`](../src/routes/ai-agent.ws.js)
- [`src/edge/aiAgentAuth.js`](../src/edge/aiAgentAuth.js)
- [`src/edge/agent.js`](../src/edge/agent.js) — `forwardAiEvent`
- Camera service: `GET /cameras/ai-agent-config` (internal, API key)
