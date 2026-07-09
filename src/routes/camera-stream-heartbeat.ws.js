import { heartbeatCameraStreamDirect } from "../services/camera-client.service.js";

const MAX_ITEMS = Number(process.env.STREAM_HEARTBEAT_MAX_ITEMS) || 32;

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

/**
 * @param {Array<{ cameraId?: number | string, qualityId?: string, viewerId?: string, scope?: string }>} items
 */
async function processHeartbeatItems(items) {
  return Promise.all(
    items.map(async (item) => {
      const cameraId = Number(item?.cameraId) || 0;
      const qualityId = String(item?.qualityId || "main").trim() || "main";
      const viewerId = String(item?.viewerId || "").trim();
      const scope =
        String(item?.scope || "local").trim() === "remote" ? "remote" : "local";

      if (!cameraId || !viewerId) {
        return {
          cameraId,
          qualityId,
          ok: false,
          error: "Thiếu cameraId hoặc viewerId",
        };
      }

      try {
        const result = await heartbeatCameraStreamDirect(cameraId, {
          qualityId,
          scope,
          viewerId,
        });
        return {
          cameraId,
          qualityId,
          ok: true,
          touched: result?.touched ?? true,
        };
      } catch (err) {
        return {
          cameraId,
          qualityId,
          ok: false,
          error: err instanceof Error ? err.message : "Heartbeat thất bại",
        };
      }
    }),
  );
}

export function registerCameraStreamHeartbeatWs(fastify) {
  fastify.get(
    "/ws/camera-stream-heartbeat",
    { websocket: true },
    (socket, _request) => {
      socket.on("message", (raw) => {
        void (async () => {
          const msg = parseMessage(raw);
          if (!msg) {
            sendJson(socket, { type: "error", message: "JSON không hợp lệ" });
            return;
          }

          if (msg.type !== "stream_heartbeat") {
            sendJson(socket, {
              type: "error",
              message: `Unknown type: ${msg.type || "?"}`,
            });
            return;
          }

          const requestId = String(msg.requestId || "").trim() || undefined;
          const items = Array.isArray(msg.items)
            ? msg.items.slice(0, MAX_ITEMS)
            : [];

          if (!items.length) {
            sendJson(socket, {
              type: "stream_heartbeat_ack",
              requestId,
              ok: false,
              results: [],
              error: "Thiếu items",
            });
            return;
          }

          const results = await processHeartbeatItems(items);
          sendJson(socket, {
            type: "stream_heartbeat_ack",
            requestId,
            ok: results.length > 0 && results.every((row) => row.ok),
            results,
          });
        })().catch((err) => {
          sendJson(socket, {
            type: "stream_heartbeat_ack",
            ok: false,
            results: [],
            error: err instanceof Error ? err.message : "Lỗi heartbeat",
          });
        });
      });

      socket.on("error", () => {
        try {
          socket.close();
        } catch {
          /* ignore */
        }
      });
    },
  );
}
