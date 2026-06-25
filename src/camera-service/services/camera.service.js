import {
  findAllCameras,
  findCameraById,
  insertCamera,
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
  const required = ["name", "host", "username", "password", "mediamtx_path"];
  for (const key of required) {
    if (!body?.[key]) {
      throw new Error(`Thiếu trường bắt buộc: ${key}`);
    }
  }

  const camera = insertCamera({
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
    mediamtx_path: body.mediamtx_path,
    stream_quality: body.stream_quality,
    home_preset_token: body.home_preset_token,
  });

  return toAdminCamera(camera);
}

export function updateCameraRecord(cameraId, body) {
  const existing = findCameraById(cameraId);
  if (!existing) {
    throw new Error("Không tìm thấy camera");
  }

  const updated = updateCamera(cameraId, body);
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
