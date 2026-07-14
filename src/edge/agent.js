import WebSocket from "ws";
import os from "os";
import { executeLocalRpc } from "./localRpc.js";
import { collectSystemStats } from "./systemStats.js";

const MIN_RECONNECT_MS = Number(process.env.EDGE_RECONNECT_MIN_MS) || 5_000;
const MAX_RECONNECT_MS = Number(process.env.EDGE_RECONNECT_MAX_MS) || 60_000;
const STATUS_REPORT_MS = Number(process.env.EDGE_STATUS_REPORT_MS) || 30_000;

let ws = null;
let reconnectTimer = null;
let statusTimer = null;
let reconnectDelay = MIN_RECONNECT_MS;
let stopped = false;
let registered = false;

function getConfig() {
  return {
    url: String(process.env.MBOX_EDGE_WS_URL || "").trim(),
    edgeId: String(process.env.EDGE_ID || "").trim(),
    token: String(process.env.EDGE_AGENT_TOKEN || "").trim(),
    streamMode: String(process.env.STREAM_MODE || "webrtc").trim(),
  };
}

function isAgentEnabled() {
  const { url, edgeId } = getConfig();
  return Boolean(url && edgeId);
}

function sendJson(payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(payload));
  return true;
}

async function collectHeartbeatPayload() {
  const stats = collectSystemStats();
  let health = null;

  try {
    const result = await executeLocalRpc({ method: "GET", path: "/health" });
    if (result.status < 400) {
      health = result.body;
    }
  } catch {
    /* health check tùy chọn */
  }

  return {
    type: "heartbeat",
    edgeId: getConfig().edgeId,
    stats,
    health,
    streamMode: getConfig().streamMode,
    pid: process.pid,
    at: new Date().toISOString(),
  };
}

async function sendHeartbeat() {
  if (!registered) return;
  sendJson(await collectHeartbeatPayload());
}

function startStatusReporter() {
  stopStatusReporter();
  statusTimer = setInterval(() => {
    void sendHeartbeat();
  }, STATUS_REPORT_MS);
}

function stopStatusReporter() {
  if (!statusTimer) return;
  clearInterval(statusTimer);
  statusTimer = null;
}

async function handleRpc(msg) {
  try {
    const result = await executeLocalRpc({
      method: msg.method,
      path: msg.path,
      body: msg.body,
      headers: msg.headers || {},
    });
    sendJson({
      type: "rpc_result",
      id: msg.id,
      status: result.status,
      body: result.body,
      headers: result.headers || {},
    });
  } catch (err) {
    sendJson({
      type: "rpc_result",
      id: msg.id,
      status: 502,
      body: { error: err.message || "Local RPC failed" },
    });
  }
}

function handleMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return;
  }

  if (msg.type === "registered") {
    registered = true;
    console.log(`[edge-agent] Registered as ${msg.edgeId}`);
    void sendHeartbeat();
    startStatusReporter();
    return;
  }

  if (msg.type === "ping") {
    sendJson({ type: "pong", at: new Date().toISOString() });
    return;
  }

  if (msg.type === "rpc") {
    void handleRpc(msg);
  }
}

function scheduleReconnect() {
  if (stopped || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_MS);
}

function connect() {
  const { url, edgeId, token, streamMode } = getConfig();
  if (!url || !edgeId) return;

  registered = false;
  stopStatusReporter();

  if (ws) {
    try {
      ws.removeAllListeners();
      ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
  }

  console.log(`[edge-agent] Connecting to ${url} as ${edgeId}...`);
  ws = new WebSocket(url);

  ws.on("open", () => {
    reconnectDelay = MIN_RECONNECT_MS;
    sendJson({
      type: "register",
      edgeId,
      token,
      meta: {
        hostname: os.hostname(),
        streamMode,
        pid: process.pid,
      },
    });
    console.log("[edge-agent] Connected, waiting for registration...");
  });

  ws.on("message", handleMessage);

  ws.on("close", (code, reason) => {
    registered = false;
    stopStatusReporter();
    console.warn(
      `[edge-agent] Disconnected (${code}): ${reason?.toString() || ""}`,
    );
    ws = null;
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    console.warn(`[edge-agent] Socket error: ${err.message}`);
  });
}

export function startEdgeAgent() {
  if (!isAgentEnabled()) {
    console.log(
      "[edge-agent] Disabled — set MBOX_EDGE_WS_URL and EDGE_ID to enable",
    );
    return;
  }

  stopped = false;
  connect();

  const shutdown = () => {
    stopped = true;
    stopStatusReporter();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/** Edge đã register với Mbox và socket còn mở. */
export function isEdgeRegistered() {
  return registered && ws != null && ws.readyState === WebSocket.OPEN;
}

/**
 * Relay ai_event lên Mbox qua WS edge (không gắn edgeId — Mbox lấy từ session).
 * @param {Record<string, unknown>} msg
 * @returns {{ ok: boolean, forwarded: boolean, error?: string }}
 */
export function forwardAiEvent(msg) {
  if (!isAgentEnabled()) {
    return {
      ok: false,
      forwarded: false,
      error: "Edge agent chưa cấu hình (MBOX_EDGE_WS_URL / EDGE_ID)",
    };
  }
  if (!isEdgeRegistered()) {
    return { ok: false, forwarded: false, error: "edge offline" };
  }

  const eventType = String(msg?.eventType ?? "").trim();
  if (!eventType) {
    return { ok: false, forwarded: false, error: "Thiếu eventType" };
  }

  const payload = {
    type: "ai_event",
    eventType,
  };

  const cameraId = String(msg?.cameraId ?? "").trim();
  if (cameraId) payload.cameraId = cameraId;

  const timestamp = String(msg?.timestamp ?? "").trim();
  if (timestamp) payload.timestamp = timestamp;

  const timestampMs = Number(msg?.timestamp_ms);
  if (Number.isFinite(timestampMs) && timestampMs > 0) {
    payload.timestamp_ms = timestampMs;
  }

  if (msg?.thumbnail != null && String(msg.thumbnail).trim()) {
    payload.thumbnail = String(msg.thumbnail);
  }

  if (Array.isArray(msg?.objects)) {
    payload.objects = msg.objects;
  }

  const area = String(msg?.area ?? "").trim();
  if (area) payload.area = area;
  const location = String(msg?.location ?? "").trim();
  if (location) payload.location = location;
  const address = String(msg?.address ?? "").trim();
  if (address) payload.address = address;

  const sent = sendJson(payload);
  if (!sent) {
    return { ok: false, forwarded: false, error: "edge offline" };
  }
  return { ok: true, forwarded: true };
}
