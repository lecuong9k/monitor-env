/** Hub: registry AI Agent LAN sockets + cache ai_event_config từ Mbox. */

/** @type {Set<import('ws').WebSocket>} */
const aiAgentSockets = new Set();

/** @type {Record<string, unknown> | null} */
let lastAiEventConfig = null;

/** @type {(() => void) | null} */
let requestConfigFromMbox = null;

function sendJson(socket, payload) {
  if (!socket || socket.readyState !== 1) return;
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function registerAiAgentSocket(socket) {
  if (socket) aiAgentSockets.add(socket);
}

export function unregisterAiAgentSocket(socket) {
  if (socket) aiAgentSockets.delete(socket);
}

export function getLastAiEventConfig() {
  return lastAiEventConfig;
}

/**
 * Cache + broadcast xuống mọi AI Agent đang auth.
 * @param {Record<string, unknown>} msg
 */
export function broadcastAiEventConfig(msg) {
  if (!msg || typeof msg !== "object") return;
  const payload = {
    type: "ai_event_config",
    enabledAiEvents: Array.isArray(msg.enabledAiEvents)
      ? msg.enabledAiEvents
      : [],
    updatedAt: String(msg.updatedAt ?? "").trim() || new Date().toISOString(),
  };
  lastAiEventConfig = payload;
  for (const socket of aiAgentSockets) {
    sendJson(socket, payload);
  }
}

/** Gửi cache hiện có cho 1 socket (nếu có). @returns {boolean} */
export function sendCachedAiEventConfig(socket) {
  if (!lastAiEventConfig) return false;
  sendJson(socket, lastAiEventConfig);
  return true;
}

/** @param {() => void} fn */
export function setRequestAiEventConfigFromMbox(fn) {
  requestConfigFromMbox = typeof fn === "function" ? fn : null;
}

export function requestAiEventConfigFromMbox() {
  if (typeof requestConfigFromMbox === "function") {
    requestConfigFromMbox();
  }
}
