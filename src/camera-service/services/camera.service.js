import { randomBytes } from "node:crypto";
import {
  findAllCameras,
  findAllCamerasWithSecrets,
  findCameraById,
  insertCamera,
  setCameraMediamtxPath,
  softDeleteCamera,
  toAdminCamera,
  toPublicCamera,
  updateCamera,
} from "../repositories/camera.repository.js";
import {
  continuousMove,
  invalidateSession,
  sendPtz,
  stopMove,
} from "./onvif.service.js";
import { getTalkbackCapabilities } from "./talkback.service.js";
import { config, resolveStreamScope } from "../config.js";
import {
  getStreamInfo,
  getStreamQualityForCamera,
  restartCameraStream,
  setStreamQuality,
  startCameraStream,
  stopCameraStream,
} from "./stream.service.js";
import { ensureMachineCode } from "../../services/device-identity.service.js";

/** Segment an toàn cho MediaMTX path (chữ/số/._-). */
function sanitizePathSegment(value, maxLen = 64) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen);
}

/**
 * Base path ổn định cross-MiniPC: `{machineCode}-{cameraId}`.
 * @param {string} machineCode
 * @param {number|string} cameraId
 */
export function buildMediamtxPath(machineCode, cameraId) {
  const code = sanitizePathSegment(machineCode, 64);
  const id = String(cameraId ?? "").trim();
  if (!code || !/^\d+$/.test(id)) {
    throw new Error("Không tạo được MediaMTX path (thiếu machineCode hoặc id)");
  }
  return `${code}-${id}`;
}

function isUniqueConstraintError(err) {
  const code = String(err?.code ?? "");
  const message = String(err?.message ?? "");
  return (
    code === "SQLITE_CONSTRAINT_UNIQUE" ||
    code === "SQLITE_CONSTRAINT" ||
    /UNIQUE constraint failed/i.test(message)
  );
}

export async function listCameras(clientContext) {
  const cameras = findAllCameras();
  return cameras.map((camera) => {
    let stream;
    try {
      stream = getStreamInfo(
        camera.id,
        clientContext,
        camera.stream_quality,
        "local",
      );
    } catch {
      stream = { stream_type: config.streamMode };
    }
    return {
      ...toPublicCamera(camera),
      stream_type: stream.stream_type ?? config.streamMode,
      stream_url: stream.stream_url ?? null,
    };
  });
}

export function getCameraById(cameraId) {
  const camera = findCameraById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }
  return toAdminCamera(camera);
}

export function listCamerasRegistry() {
  return findAllCameras().map((row) => toAdminCamera(row));
}

/**
 * Full camera config (kèm password) cho Edge AI agent.
 * `cameraId` = mediamtx_path (ổn định hơn id số).
 */
export function listCamerasForAiAgent() {
  return findAllCamerasWithSecrets({ activeOnly: true }).map((cam) => ({
    id: cam.id,
    cameraId: String(cam.mediamtx_path ?? "").trim() || String(cam.id),
    name: cam.name,
    host: cam.host,
    onvif_port: cam.onvif_port,
    rtsp_port: cam.rtsp_port,
    username: cam.username,
    password: cam.password,
    rtsp_url_override: cam.rtsp_url_override ?? null,
    rtsp_path_main: cam.rtsp_path_main,
    rtsp_path_sub: cam.rtsp_path_sub,
    rtsp_path_mobile: cam.rtsp_path_mobile,
    ptz_enabled: cam.ptz_enabled,
    mediamtx_path: cam.mediamtx_path,
    stream_quality: cam.stream_quality,
    home_preset_token: cam.home_preset_token,
    status: cam.status,
  }));
}

export function getCameraStreamUrl(cameraId, clientContext, qualityId, scope) {
  return getStreamInfo(
    cameraId,
    clientContext,
    qualityId,
    resolveStreamScope(scope),
  );
}

export function getCameraStreamOptions(cameraId, qualityId) {
  return getStreamQualityForCamera(cameraId, qualityId);
}

export { startCameraStream, stopCameraStream, restartCameraStream };

export async function updateCameraStreamQuality(
  cameraId,
  qualityId,
  clientContext,
  options = {},
) {
  return setStreamQuality(cameraId, qualityId, clientContext, options);
}

export async function executePtz(cameraId, body) {
  const camera = findCameraById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }
  if (!camera.ptz_enabled) {
    throw new Error("Camera không hỗ trợ PTZ");
  }

  const action = body?.action;
  const speed = body?.speed;

  if (action === "stop") {
    await stopMove(cameraId);
    return { success: true };
  }

  const hasVector =
    body?.pan != null || body?.tilt != null || body?.zoom != null;
  if (hasVector) {
    await continuousMove(cameraId, {
      pan: Number(body.pan) || 0,
      tilt: Number(body.tilt) || 0,
      zoom: Number(body.zoom) || 0,
      timeout: Number(body.timeout) || 0,
    });
    return { success: true };
  }

  if (!action) {
    throw new Error("Thiếu action PTZ");
  }

  await sendPtz(cameraId, action, speed, { x: body?.x, y: body?.y });
  return { success: true };
}

export async function fetchTalkbackCapabilities(cameraId, qualityId = "main") {
  const camera = findCameraById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }
  return getTalkbackCapabilities(cameraId, qualityId);
}

export function createCameraRecord(body) {
  const required = ["name", "host", "username", "password"];
  for (const key of required) {
    if (!body?.[key]) {
      throw new Error(`Thiếu trường bắt buộc: ${key}`);
    }
  }

  const machineCode = ensureMachineCode();
  // Placeholder unique tới khi có id — client không được chọn path.
  const pendingPath = `pending-${randomBytes(6).toString("hex")}`;

  let camera;
  try {
    camera = insertCamera({
      name: body.name,
      host: body.host,
      username: body.username,
      password: body.password,
      onvif_port: body.onvif_port,
      rtsp_port: body.rtsp_port,
      rtsp_url_override: body.rtsp_url_override,
      rtsp_path_main: body.rtsp_path_main,
      rtsp_path_sub: body.rtsp_path_sub,
      rtsp_path_mobile: body.rtsp_path_mobile,
      ptz_enabled: body.ptz_enabled,
      mediamtx_path: pendingPath,
      stream_quality: body.stream_quality,
      home_preset_token: body.home_preset_token,
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new Error("MediaMTX path đã tồn tại — thử lại");
    }
    throw err;
  }

  const finalPath = buildMediamtxPath(machineCode, camera.id);
  try {
    camera = setCameraMediamtxPath(camera.id, finalPath);
  } catch (err) {
    softDeleteCamera(camera.id);
    if (isUniqueConstraintError(err)) {
      throw new Error("MediaMTX path đã tồn tại");
    }
    throw err;
  }

  return toAdminCamera(camera);
}

export function updateCameraRecord(cameraId, body) {
  const existing = findCameraById(cameraId);
  if (!existing) {
    throw new Error("Không tìm thấy camera");
  }

  // Path bất biến sau create (WHEP / AI agent / stream đang chạy).
  const { mediamtx_path: _ignored, ...patch } = body ?? {};
  const updated = updateCamera(cameraId, patch);
  invalidateSession(cameraId);
  return toAdminCamera(updated);
}

export function deleteCameraRecord(cameraId) {
  const existing = findCameraById(cameraId);
  if (!existing) {
    throw new Error("Không tìm thấy camera");
  }

  void stopCameraStream(cameraId, undefined, { scope: "local" });
  void stopCameraStream(cameraId, undefined, { scope: "remote" });
  invalidateSession(cameraId);
  softDeleteCamera(cameraId);
  return { ok: true };
}
