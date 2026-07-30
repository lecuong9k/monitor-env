#!/usr/bin/env node
/**
 * Mẫu Edge AI agent (WS-only): auth → get_cameras → gửi 1 ai_event giả lập.
 *
 * Usage:
 *   AI_AGENT_TOKEN=... MINIPC_WS_URL=ws://127.0.0.1:3000/ws/ai-agent \
 *     node scripts/ai-agent-ws-sample.mjs
 */
import WebSocket from "ws";

const url = String(
  process.env.MINIPC_WS_URL || "ws://127.0.0.1:3000/ws/ai-agent",
).trim();
const token = String(process.env.AI_AGENT_TOKEN || "").trim();

if (!token) {
  console.error("Thiếu AI_AGENT_TOKEN");
  process.exit(1);
}

const ws = new WebSocket(url);
let cameras = [];

function send(payload) {
  ws.send(JSON.stringify(payload));
}

ws.on("open", () => {
  console.log("[sample] connected", url);
  send({ type: "auth", token });
});

ws.on("message", (raw) => {
  let msg;
  try {
    msg = JSON.parse(String(raw));
  } catch {
    console.warn("[sample] non-JSON", String(raw).slice(0, 120));
    return;
  }

  console.log(
    "[sample] ←",
    msg.type,
    msg.type === "cameras" ? `(${msg.cameras?.length ?? 0})` : msg,
  );

  if (msg.type === "auth_ok") {
    send({ type: "get_cameras" });
    return;
  }

  // MiniPC keepalive — agent phải trả pong
  if (msg.type === "ping") {
    send({ type: "pong", at: new Date().toISOString() });
    return;
  }

  if (msg.type === "pong") {
    return;
  }

  if (msg.type === "cameras") {
    cameras = Array.isArray(msg.cameras) ? msg.cameras : [];
    const cameraId =
      cameras[0]?.cameraId || cameras[0]?.mediamtx_path || "unknown";
    send({
      type: "ai_event",
      eventType: "intrusion_detected",
      cameraId,
      timestamp: new Date().toISOString(),
      objects: [
        {
          class_name: "person",
          confidence: 0.91,
          bbox: { x1: 10, y1: 20, x2: 200, y2: 300 },
        },
      ],
    });
    return;
  }

  if (msg.type === "ai_event_ack") {
    console.log("[sample] ai_event_ack", msg);
    ws.close();
    process.exit(msg.ok ? 0 : 2);
  }

  if (msg.type === "error") {
    console.error("[sample] error", msg.message);
    ws.close();
    process.exit(1);
  }
});

ws.on("error", (err) => {
  console.error("[sample] socket error", err.message);
  process.exit(1);
});

ws.on("close", () => {
  console.log("[sample] closed");
});
