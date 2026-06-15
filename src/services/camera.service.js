import {
  getStreamInfo,
  getStreamQualityState,
  setStreamQuality,
} from "./stream.service.js";
import { continuousMove, sendPtz, stopMove } from "./onvif.service.js";

const DEFAULT_CAMERA = {
  id: 1,
  name: "Camera giám sát",
  ptz_enabled: true,
};

export async function listCameras() {
  const stream = getStreamInfo(DEFAULT_CAMERA.id);

  return [
    {
      ...DEFAULT_CAMERA,
      stream_type: stream.stream_type,
      stream_url: stream.stream_url,
    },
  ];
}

export function getCameraStreamUrl(cameraId) {
  const id = Number(cameraId);
  if (id !== DEFAULT_CAMERA.id) {
    throw new Error("Không tìm thấy camera");
  }
  return getStreamInfo(id);
}

export function getCameraStreamOptions(cameraId) {
  const id = Number(cameraId);
  if (id !== DEFAULT_CAMERA.id) {
    throw new Error("Không tìm thấy camera");
  }
  return getStreamQualityState();
}

export async function updateCameraStreamQuality(cameraId, qualityId) {
  const id = Number(cameraId);
  if (id !== DEFAULT_CAMERA.id) {
    throw new Error("Không tìm thấy camera");
  }
  return setStreamQuality(qualityId);
}

export async function startCameraStream(cameraId) {
  const id = Number(cameraId);
  if (id !== DEFAULT_CAMERA.id) {
    throw new Error("Không tìm thấy camera");
  }
  const { startCameraStream: start } = await import("./stream.service.js");
  return start(id);
}

export async function stopCameraStream(cameraId) {
  const id = Number(cameraId);
  if (id !== DEFAULT_CAMERA.id) {
    throw new Error("Không tìm thấy camera");
  }
  const { stopCameraStream: stop } = await import("./stream.service.js");
  return stop();
}

export async function restartCameraStream(cameraId) {
  const id = Number(cameraId);
  if (id !== DEFAULT_CAMERA.id) {
    throw new Error("Không tìm thấy camera");
  }
  const { restartCameraStream: restart } = await import("./stream.service.js");
  return restart(id);
}

export async function executePtz(cameraId, body) {
  const id = Number(cameraId);
  if (id !== DEFAULT_CAMERA.id) {
    throw new Error("Không tìm thấy camera");
  }

  const action = body?.action;
  const speed = body?.speed;

  if (action === "stop") {
    await stopMove();
    return { success: true };
  }

  const hasVector =
    body?.pan != null || body?.tilt != null || body?.zoom != null;
  if (hasVector) {
    await continuousMove({
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

  await sendPtz(action, speed, { x: body?.x, y: body?.y });
  return { success: true };
}
