import { listCamerasForAiAgent } from "../services/camera-client.service.js";
import { forwardAiEvent } from "../edge/agent.js";
import {
  extractTokenFromRequest,
  isAiAgentGatewayEnabled,
  verifyAiAgentToken,
} from "../edge/aiAgentAuth.js";
import {
  registerAiAgentSocket,
  unregisterAiAgentSocket,
  sendCachedAiEventConfig,
  requestAiEventConfigFromMbox,
} from "../edge/aiAgentHub.js";

const MAX_THUMBNAIL_BYTES =
  Number(process.env.EDGE_AI_EVENT_MAX_THUMBNAIL_BYTES) || 512 * 1024;
const PING_INTERVAL_MS = Number(process.env.EDGE_AI_AGENT_PING_MS) || 30_000;
const PONG_TIMEOUT_MS =
  Number(process.env.EDGE_AI_AGENT_PONG_TIMEOUT_MS) || 10_000;

function sendJson(socket, payload) {
  if (socket.readyState !== 1) return;
  socket.send(JSON.stringify(payload));
}

function parseMessage(raw) {
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

function stripBase64Prefix(value) {
  return String(value ?? "")
    .replace(/^data:image\/[^;]+;base64,/i, "")
    .trim();
}

function estimateBase64Bytes(value) {
  const raw = stripBase64Prefix(value);
  if (!raw) return 0;
  try {
    return Buffer.byteLength(raw, "base64");
  } catch {
    return raw.length;
  }
}

function validateAiEvent(msg) {
  const eventType = String(msg?.eventType ?? "").trim();
  if (!eventType) {
    return { ok: false, error: "Thiếu eventType" };
  }

  if (msg?.thumbnail != null && String(msg.thumbnail).trim()) {
    const bytes = estimateBase64Bytes(msg.thumbnail);
    if (bytes > MAX_THUMBNAIL_BYTES) {
      return {
        ok: false,
        error: `thumbnail vượt giới hạn (~${MAX_THUMBNAIL_BYTES} bytes)`,
      };
    }
  }

  return { ok: true };
}

async function handleGetCameras(socket) {
  try {
    const cameras = await listCamerasForAiAgent();
    sendJson(socket, {
      type: "cameras",
      cameras: Array.isArray(cameras) ? cameras : [],
    });
  } catch (err) {
    sendJson(socket, {
      type: "error",
      message: err?.message || "Không lấy được danh sách camera",
    });
  }
}

function handleAiEvent(socket, msg) {
  const validation = validateAiEvent(msg);
  if (!validation.ok) {
    sendJson(socket, {
      type: "ai_event_ack",
      ok: false,
      forwarded: false,
      error: validation.error,
    });
    return;
  }

  const result = forwardAiEvent(msg);
  sendJson(socket, {
    type: "ai_event_ack",
    ok: result.ok,
    forwarded: result.forwarded,
    ...(result.error ? { error: result.error } : {}),
  });
}

/**
 * WS /ws/ai-agent — Edge AI agent LAN:
 * auth → get_cameras / ai_event / ping↔pong keepalive
 * MiniPC → Agent: ai_event_config (sau auth hoặc khi Mbox push)
 */
export function registerAiAgentWs(fastify) {
  fastify.get("/ws/ai-agent", { websocket: true }, (socket, request) => {
    if (!isAiAgentGatewayEnabled()) {
      sendJson(socket, {
        type: "error",
        message: "AI agent gateway disabled — set AI_AGENT_TOKEN",
      });
      socket.close();
      return;
    }

    let authenticated = false;
    let pingTimer = null;
    let pongDeadlineTimer = null;
    let awaitingPong = false;

    function clearKeepalive() {
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
      if (pongDeadlineTimer) {
        clearTimeout(pongDeadlineTimer);
        pongDeadlineTimer = null;
      }
      awaitingPong = false;
    }

    function notePong() {
      awaitingPong = false;
      if (pongDeadlineTimer) {
        clearTimeout(pongDeadlineTimer);
        pongDeadlineTimer = null;
      }
    }

    function startKeepalive() {
      clearKeepalive();
      if (PING_INTERVAL_MS <= 0) return;

      pingTimer = setInterval(() => {
        if (socket.readyState !== 1) {
          clearKeepalive();
          return;
        }
        if (awaitingPong) return;

        awaitingPong = true;
        sendJson(socket, {
          type: "ping",
          at: new Date().toISOString(),
        });

        pongDeadlineTimer = setTimeout(() => {
          if (socket.readyState === 1) {
            sendJson(socket, {
              type: "error",
              message: "pong timeout",
            });
            try {
              socket.close();
            } catch {
              /* ignore */
            }
          }
          clearKeepalive();
        }, PONG_TIMEOUT_MS);
      }, PING_INTERVAL_MS);
    }

    function onAuthenticated() {
      if (authenticated) return;
      authenticated = true;
      registerAiAgentSocket(socket);
      sendJson(socket, { type: "auth_ok" });
      startKeepalive();
      if (!sendCachedAiEventConfig(socket)) {
        requestAiEventConfigFromMbox();
      }
    }

    const queryToken = extractTokenFromRequest(request);
    if (queryToken && verifyAiAgentToken(queryToken)) {
      onAuthenticated();
    }

    socket.on("close", () => {
      clearKeepalive();
      unregisterAiAgentSocket(socket);
    });

    socket.on("error", () => {
      clearKeepalive();
      unregisterAiAgentSocket(socket);
    });
    socket.on("message", (raw) => {
      void (async () => {
        const msg = parseMessage(raw);
        if (!msg || typeof msg !== "object") {
          sendJson(socket, { type: "error", message: "JSON không hợp lệ" });
          return;
        }

        const type = String(msg.type ?? "").trim();

        if (type === "auth") {
          if (verifyAiAgentToken(msg.token)) {
            onAuthenticated();
          } else {
            sendJson(socket, { type: "error", message: "Unauthorized" });
            socket.close();
          }
          return;
        }

        if (!authenticated) {
          sendJson(socket, {
            type: "error",
            message: 'Chưa auth — gửi { type: "auth", token }',
          });
          return;
        }

        if (type === "get_cameras") {
          await handleGetCameras(socket);
          return;
        }

        if (type === "ai_event") {
          handleAiEvent(socket, msg);
          return;
        }

        // Agent → MiniPC ping
        if (type === "ping") {
          sendJson(socket, {
            type: "pong",
            at: new Date().toISOString(),
          });
          return;
        }

        // MiniPC → Agent ping, agent trả pong
        if (type === "pong") {
          notePong();
          return;
        }

        sendJson(socket, {
          type: "error",
          message: `Unknown type: ${type || "?"}`,
        });
      })();
    });
  });
}
