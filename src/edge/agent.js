import WebSocket from "ws";
import os from "os";
import { executeLocalRpc } from "./localRpc.js";
import { collectSystemStats } from "./systemStats.js";
import { ensureMachineCode } from "../services/device-identity.service.js";

const MIN_RECONNECT_MS = Number(process.env.EDGE_RECONNECT_MIN_MS) || 5_000;
const MAX_RECONNECT_MS = Number(process.env.EDGE_RECONNECT_MAX_MS) || 60_000;
const STATUS_REPORT_MS = Number(process.env.EDGE_STATUS_REPORT_MS) || 30_000;

let ws = null;
let reconnectTimer = null;
let statusTimer = null;
let reconnectDelay = MIN_RECONNECT_MS;
let stopped = false;
let registered = false;
let cachedMachineCode = "";

function getMachineCode() {
  if (!cachedMachineCode) {
    cachedMachineCode = ensureMachineCode();
  }
  return cachedMachineCode;
}

function getConfig() {
  return {
    url: String(process.env.MBOX_EDGE_WS_URL || "").trim(),
    machineCode: getMachineCode(),
    token: String(process.env.EDGE_AGENT_KEY || "").trim(),
    streamMode: String(process.env.STREAM_MODE || "webrtc").trim(),
  };
}

function isAgentEnabled() {
  const { url, machineCode } = getConfig();
  return Boolean(url && machineCode);
}

function sendJson(payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(payload));
  return true;
}

async function collectHeartbeatPayload() {
  const stats = collectSystemStats();
  let health = null;
  const machineCode = getConfig().machineCode;

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
    machineCode,
    deviceId: machineCode,
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
    const id = String(msg.machineCode || msg.deviceId || "").trim();
    console.log(`[edge-agent] Registered as ${id}`);
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
  const { url, machineCode, token, streamMode } = getConfig();
  if (!url || !machineCode) return;

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

  console.log(`[edge-agent] Connecting to ${url} as ${machineCode}...`);
  ws = new WebSocket(url);

  ws.on("open", () => {
    reconnectDelay = MIN_RECONNECT_MS;
    sendJson({
      type: "register",
      machineCode,
      deviceId: machineCode,
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
  if (!String(process.env.MBOX_EDGE_WS_URL || "").trim()) {
    console.log(
      "[edge-agent] Disabled — set MBOX_EDGE_WS_URL to enable (machineCode tự sinh)",
    );
    return;
  }

  try {
    ensureMachineCode();
  } catch (err) {
    console.warn(
      `[edge-agent] Disabled — không lấy được machineCode: ${err.message}`,
    );
    return;
  }

  if (!isAgentEnabled()) {
    console.log(
      "[edge-agent] Disabled — thiếu MBOX_EDGE_WS_URL hoặc machineCode",
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
