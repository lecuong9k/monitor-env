import WebSocket from "ws";
import os from "os";
import { executeLocalRpc } from "./localRpc.js";

const MIN_RECONNECT_MS = Number(process.env.EDGE_RECONNECT_MIN_MS) || 5_000;
const MAX_RECONNECT_MS = Number(process.env.EDGE_RECONNECT_MAX_MS) || 60_000;

/** @type {Map<string, { upstream: import('ws').WebSocket | null }>} */
const streamRelays = new Map();

let ws = null;
let reconnectTimer = null;
let reconnectDelay = MIN_RECONNECT_MS;
let stopped = false;

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
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function encodeBase64(buffer) {
  return Buffer.from(buffer).toString("base64");
}

function closeStreamRelay(relayId, reason) {
  const relay = streamRelays.get(relayId);
  if (!relay) return;
  streamRelays.delete(relayId);
  if (relay.upstream) {
    try {
      relay.upstream.close();
    } catch {
      /* ignore */
    }
    relay.upstream = null;
  }
  sendJson({
    type: "stream_relay_closed",
    relayId,
    reason: reason || "closed",
  });
}

function openStreamRelay(relayId, path) {
  closeStreamRelay(relayId, "replaced");

  const port = Number(process.env.PORT) || 3000;
  const upstreamUrl = `ws://127.0.0.1:${port}${path}`;

  const upstream = new WebSocket(upstreamUrl);
  streamRelays.set(relayId, { upstream });

  upstream.on("open", () => {
    console.log(`[edge-agent] stream relay open: ${relayId}`);
  });

  upstream.on("message", (data, isBinary) => {
    if (!isBinary) return;
    sendJson({
      type: "stream_relay_frame",
      relayId,
      data: encodeBase64(data),
    });
  });

  upstream.on("close", () => {
    closeStreamRelay(relayId, "upstream closed");
  });

  upstream.on("error", (err) => {
    console.warn(`[edge-agent] stream relay error (${relayId}):`, err.message);
    closeStreamRelay(relayId, err.message);
  });
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

  if (msg.type === "ping") {
    sendJson({ type: "pong", at: new Date().toISOString() });
    return;
  }

  if (msg.type === "rpc") {
    void handleRpc(msg);
    return;
  }

  if (msg.type === "stream_relay_open") {
    const relayId = String(msg.relayId || "").trim();
    const path = String(msg.path || "").trim();
    if (relayId && path) {
      openStreamRelay(relayId, path);
    }
    return;
  }

  if (msg.type === "stream_relay_close") {
    closeStreamRelay(String(msg.relayId || "").trim(), "remote close");
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
    console.log(`[edge-agent] Connected, waiting for registration...`);
  });

  ws.on("message", handleMessage);

  ws.on("close", (code, reason) => {
    console.warn(
      `[edge-agent] Disconnected (${code}): ${reason?.toString() || ""}`,
    );
    for (const relayId of [...streamRelays.keys()]) {
      closeStreamRelay(relayId, "agent disconnected");
    }
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
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    for (const relayId of [...streamRelays.keys()]) {
      closeStreamRelay(relayId, "shutdown");
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
