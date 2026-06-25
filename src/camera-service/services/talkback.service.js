import { randomUUID } from "crypto";
import {
  findCameraById,
  findCameraWithSecretsById,
} from "../repositories/camera.repository.js";
import { getAudioOutputs } from "./onvif.service.js";
import { buildRtspUrl } from "./rtsp.service.js";
import {
  probeRtspBackchannel,
  RtspBackchannelClient,
} from "./rtsp-backchannel.client.js";

const CAPABILITY_CACHE_MS = 5 * 60 * 1000;
const IDLE_TIMEOUT_MS = 60 * 1000;
const PCM_FRAME_BYTES = 320;

/** @type {Map<number, { result: object; expiresAt: number }>} */
const capabilityCache = new Map();

/** @type {Map<string, { cameraId: number; client: RtspBackchannelClient; idleTimer: NodeJS.Timeout | null; pushing: boolean }>} */
const sessions = new Map();

/** @type {Map<number, string>} */
const activeByCamera = new Map();

function subtypeForQuality(qualityId) {
  if (qualityId === "sub") return 1;
  if (qualityId === "mobile") return 2;
  return 0;
}

/** @param {number} cameraId @param {string} [qualityId] */
async function resolveTalkbackRtspUrl(cameraId, qualityId = "main") {
  const camera = findCameraWithSecretsById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }
  const subtype = subtypeForQuality(qualityId);
  return buildRtspUrl(camera, subtype);
}

/**
 * @param {number} cameraId
 * @param {string} [qualityId]
 */
export async function probeTalkbackCapabilities(cameraId, qualityId = "main") {
  const cached = capabilityCache.get(cameraId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const camera = findCameraById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }

  /** @type {number} */
  let audioOutputCount = 0;
  let onvifReason = "";

  try {
    const outputs = await getAudioOutputs(cameraId);
    audioOutputCount = Array.isArray(outputs) ? outputs.length : 0;
  } catch (err) {
    onvifReason =
      err instanceof Error ? err.message : "Không đọc được AudioOutput ONVIF";
  }

  const subtypes = [subtypeForQuality(qualityId), 0, 1].filter(
    (value, index, arr) => arr.indexOf(value) === index,
  );

  /** @type {{ supported: boolean; codecs: string[]; reason?: string } | null} */
  let rtspResult = null;

  for (const subtype of subtypes) {
    const rtspUrl = buildRtspUrl(findCameraWithSecretsById(cameraId), subtype);
    rtspResult = await probeRtspBackchannel(rtspUrl);
    if (rtspResult.supported) break;
  }

  if (!rtspResult) {
    rtspResult = {
      supported: false,
      codecs: [],
      reason: "Không thể probe RTSP back channel",
    };
  }

  const result = {
    supported: rtspResult.supported,
    codecs: rtspResult.codecs,
    audioOutputs: audioOutputCount,
    reason: rtspResult.supported
      ? undefined
      : rtspResult.reason ||
        (audioOutputCount === 0
          ? "Camera không có AudioOutput ONVIF"
          : undefined) ||
        onvifReason ||
        "Camera không hỗ trợ talkback",
  };

  capabilityCache.set(cameraId, {
    result,
    expiresAt: Date.now() + CAPABILITY_CACHE_MS,
  });

  return result;
}

function clearIdleTimer(session) {
  if (session.idleTimer) {
    clearTimeout(session.idleTimer);
    session.idleTimer = null;
  }
}

function scheduleIdleTimeout(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  clearIdleTimer(session);
  session.idleTimer = setTimeout(() => {
    void destroyTalkbackSession(sessionId);
  }, IDLE_TIMEOUT_MS);
}

/**
 * @param {number} cameraId
 * @param {string} [qualityId]
 */
export async function createTalkbackSession(cameraId, qualityId = "main") {
  if (activeByCamera.has(cameraId)) {
    const err = new Error("Camera đang được dùng talkback bởi viewer khác");
    err.status = 409;
    throw err;
  }

  const rtspUrl = await resolveTalkbackRtspUrl(cameraId, qualityId);
  const client = new RtspBackchannelClient(rtspUrl);

  try {
    console.log(
      `[talkback] camera=${cameraId} quality=${qualityId} — mở RTSP back channel`,
    );
    await client.connect();
    console.log(`[talkback] camera=${cameraId} — RTSP back channel sẵn sàng`);
  } catch (err) {
    console.warn(
      `[talkback] camera=${cameraId} — RTSP thất bại:`,
      err instanceof Error ? err.message : err,
    );
    await client.teardown();
    throw err;
  }

  const sessionId = randomUUID();
  sessions.set(sessionId, {
    cameraId,
    client,
    idleTimer: null,
    pushing: false,
  });
  activeByCamera.set(cameraId, sessionId);
  scheduleIdleTimeout(sessionId);

  return { sessionId };
}

/** @param {string} sessionId */
export async function destroyTalkbackSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  clearIdleTimer(session);
  sessions.delete(sessionId);
  if (activeByCamera.get(session.cameraId) === sessionId) {
    activeByCamera.delete(session.cameraId);
  }

  await session.client.teardown();
}

/** @param {string} sessionId */
export function touchTalkbackSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  scheduleIdleTimeout(sessionId);
  return true;
}

/**
 * @param {string} sessionId
 * @param {Buffer} pcmChunk
 */
export function sendTalkbackPcm(sessionId, pcmChunk) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  scheduleIdleTimeout(sessionId);

  if (pcmChunk.length < PCM_FRAME_BYTES) return true;

  for (
    let offset = 0;
    offset + PCM_FRAME_BYTES <= pcmChunk.length;
    offset += PCM_FRAME_BYTES
  ) {
    session.client.sendPcm(pcmChunk.subarray(offset, offset + PCM_FRAME_BYTES));
  }
  return true;
}

/** @param {number} cameraId */
export function invalidateTalkbackCache(cameraId) {
  capabilityCache.delete(cameraId);
}

export function stopAllTalkbackSessions() {
  for (const sessionId of [...sessions.keys()]) {
    void destroyTalkbackSession(sessionId);
  }
}

export { probeTalkbackCapabilities as getTalkbackCapabilities };

/**
 * @param {unknown} raw
 * @param {boolean} [isBinary]
 * @returns {{ kind: "json"; text: string } | { kind: "binary"; buffer: Buffer } | null}
 */
function toBuffer(raw) {
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof ArrayBuffer) return Buffer.from(raw);
  if (ArrayBuffer.isView(raw)) {
    return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  return null;
}

function parseWsPayload(raw, isBinary) {
  if (isBinary === true) {
    const buffer = toBuffer(raw);
    return buffer ? { kind: "binary", buffer } : null;
  }

  if (typeof raw === "string") {
    return { kind: "json", text: raw };
  }

  const buffer = toBuffer(raw);
  if (!buffer) return null;

  // Text frame trong Node ws thường là Buffer khi isBinary=false
  if (isBinary === false) {
    return { kind: "json", text: buffer.toString("utf8") };
  }

  // Fallback khi thiếu cờ isBinary: chỉ coi là JSON nếu parse được object có type
  const text = buffer.toString("utf8");
  try {
    const probe = JSON.parse(text);
    if (probe && typeof probe === "object" && "type" in probe) {
      return { kind: "json", text };
    }
  } catch {
    // not JSON
  }

  return { kind: "binary", buffer };
}

/**
 * @param {number} cameraId
 * @param {import("@fastify/websocket").WebSocket} socket
 * @param {{ qualityId?: string }} [options]
 */
export function handleTalkbackWebSocket(cameraId, socket, options = {}) {
  const qualityId = String(options.qualityId || "main");
  /** @type {string | null} */
  let sessionId = null;

  const sendJson = (payload) => {
    if (socket.readyState === 1) {
      socket.send(JSON.stringify(payload));
    }
  };

  const cleanup = async () => {
    if (sessionId) {
      await destroyTalkbackSession(sessionId);
      sessionId = null;
    }
  };

  sendJson({ type: "hello" });

  socket.on("message", async (raw, isBinary) => {
    const parsed = parseWsPayload(raw, isBinary);
    if (!parsed) {
      sendJson({ type: "error", message: "Tin nhắn không hợp lệ" });
      return;
    }

    if (parsed.kind === "binary") {
      if (!sessionId) return;
      sendTalkbackPcm(sessionId, parsed.buffer);
      return;
    }

    let message;
    try {
      message = JSON.parse(parsed.text);
    } catch {
      sendJson({ type: "error", message: "Tin nhắn JSON không hợp lệ" });
      return;
    }

    const type = String(message?.type || "");

    if (type === "ping") {
      if (sessionId) touchTalkbackSession(sessionId);
      sendJson({ type: "pong" });
      return;
    }

    if (type === "start") {
      if (sessionId) {
        sendJson({ type: "ready", sessionId });
        return;
      }
      console.log(
        `[talkback] WS start camera=${cameraId} quality=${qualityId}`,
      );
      try {
        const created = await createTalkbackSession(cameraId, qualityId);
        sessionId = created.sessionId;
        sendJson({ type: "ready", sessionId });
      } catch (err) {
        const status = typeof err?.status === "number" ? err.status : 500;
        const message =
          err instanceof Error ? err.message : "Không mở được talkback";
        console.warn(`[talkback] WS start failed camera=${cameraId}:`, message);
        sendJson({
          type: "error",
          message,
          status,
        });
        if (status === 409) {
          socket.close(4409, "busy");
        }
      }
      return;
    }

    if (type === "stop") {
      await cleanup();
      sendJson({ type: "stopped" });
      return;
    }

    sendJson({ type: "error", message: `Lệnh không hỗ trợ: ${type}` });
  });

  socket.on("close", () => {
    void cleanup();
  });

  socket.on("error", () => {
    void cleanup();
  });
}
