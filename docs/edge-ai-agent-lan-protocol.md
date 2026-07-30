# Edge AI Agent ↔ MiniPC — WebSocket protocol (LAN)

Agent AI (máy riêng cùng LAN với MiniPC) **chỉ** dùng một WebSocket tới monitor-env-be:

`ws://<minipc-ip>:3000/ws/ai-agent`

Không dùng HTTP cho camera/event. Không kết nối thẳng Mbox — MiniPC relay `ai_event` qua edge WS sẵn có (`MBOX_EDGE_WS_URL`).

## Env

| Biến                                                | Nơi            | Mô tả                                    |
| --------------------------------------------------- | -------------- | ---------------------------------------- |
| `AI_AGENT_TOKEN`                                    | Mbox + MiniPC + agent | Token AI canonical; gateway tắt nếu empty |
| `EDGE_AI_EVENT_MAX_THUMBNAIL_BYTES`                 | MiniPC         | Mặc định `524288` (512KB)                |
| `MBOX_EDGE_WS_URL` / `DEVICE_ID` / `EDGE_AGENT_TOKEN` | MiniPC         | Cần online để `forwarded: true`          |

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
{ "type": "auth", "token": "<AI_AGENT_TOKEN>" }
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

Không gửi `deviceId` — Mbox gắn từ session MiniPC.

MiniPC → Agent:

```json
{ "type": "ai_event_ack", "ok": true, "forwarded": true }
```

hoặc `{ "ok": false, "forwarded": false, "error": "edge offline" }`.

### Cấu hình sự kiện AI (`ai_event_config`)

MiniPC nhận config từ Mbox (`/edge/ws`) rồi forward xuống mọi AI Agent đã auth:

```json
{
  "type": "ai_event_config",
  "enabledAiEvents": ["weapon_detected", "fire_detected"],
  "updatedAt": "2026-07-29T02:00:00.000Z"
}
```

| Thời điểm                               | Hành vi                                                                                |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| Edge register với Mbox                  | Mbox push `ai_event_config` → MiniPC cache + broadcast                                 |
| Operator lưu cấu hình cột (có `deviceId`) | Mbox push ngay nếu MiniPC online                                                       |
| AI Agent `auth_ok`                      | MiniPC gửi cache nếu có; không có thì gửi `{ "type": "get_ai_event_config" }` lên Mbox |

MiniPC → Mbox (khi chưa có cache):

```json
{ "type": "get_ai_event_config" }
```

Mbox → MiniPC: message `ai_event_config` như trên.

Agent nên chỉ submit `ai_event` cho các `eventType` trong `enabledAiEvents`. `[]` = tắt hết.

### Heartbeat (ping / pong)

Hai chiều sau khi `auth_ok`:

| Hướng          | Message                           | Phản hồi                                     |
| -------------- | --------------------------------- | -------------------------------------------- |
| MiniPC → Agent | `{ "type": "ping", "at": "..." }` | Agent phải trả `{ "type": "pong" }`          |
| Agent → MiniPC | `{ "type": "ping" }`              | MiniPC trả `{ "type": "pong", "at": "..." }` |

MiniPC gửi `ping` định kỳ (`EDGE_AI_AGENT_PING_MS`, mặc định 30s). Không nhận `pong` trong `EDGE_AI_AGENT_PONG_TIMEOUT_MS` (mặc định 10s) → đóng socket.

Agent mẫu / production **bắt buộc** xử lý `ping` từ MiniPC và gửi `pong`.

## Script mẫu

```bash
cd monitor-env-be
AI_AGENT_TOKEN=... MINIPC_WS_URL=ws://127.0.0.1:3000/ws/ai-agent \
  node scripts/ai-agent-ws-sample.mjs
```

## File liên quan

- [`src/routes/ai-agent.ws.js`](../src/routes/ai-agent.ws.js)
- [`src/edge/aiAgentAuth.js`](../src/edge/aiAgentAuth.js)
- [`src/edge/aiAgentHub.js`](../src/edge/aiAgentHub.js) — registry socket + cache `ai_event_config`
- [`src/edge/agent.js`](../src/edge/agent.js) — `forwardAiEvent`, relay `ai_event_config`
- Camera service: `GET /cameras/ai-agent-config` (internal, API key)
