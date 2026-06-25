import onvif from "onvif";
import { findCameraWithSecretsById } from "../repositories/camera.repository.js";
import { buildRtspUrl } from "./rtsp.service.js";

/** @type {Map<number, { cam: import('onvif').Cam | null, promise: Promise<import('onvif').Cam> | null }>} */
const sessions = new Map();

function getSession(cameraId) {
  if (!sessions.has(cameraId)) {
    sessions.set(cameraId, { cam: null, promise: null });
  }
  return sessions.get(cameraId);
}

function promisify(method, camera, options = {}) {
  return new Promise((resolve, reject) => {
    method.call(camera, options, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function connectCamera(camera) {
  const session = getSession(camera.id);
  if (session.promise) return session.promise;

  session.promise = new Promise((resolve, reject) => {
    const instance = new onvif.Cam(
      {
        hostname: camera.host,
        username: camera.username,
        password: camera.password,
        port: camera.onvif_port,
      },
      (err) => {
        session.promise = null;
        if (err) {
          reject(err);
          return;
        }
        session.cam = instance;
        resolve(instance);
      },
    );
  });

  return session.promise;
}

export async function getCam(cameraId) {
  const session = getSession(cameraId);
  if (session.cam) return session.cam;

  const camera = findCameraWithSecretsById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }

  return connectCamera(camera);
}

export function invalidateSession(cameraId) {
  const session = sessions.get(cameraId);
  if (!session) return;
  session.cam = null;
  session.promise = null;
  sessions.delete(cameraId);
}

/** @param {number} cameraId @param {0 | 1 | 2} subtype */
export async function resolveRtspUrl(cameraId, subtype = 0) {
  const camera = findCameraWithSecretsById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }
  return buildRtspUrl(camera, subtype);
}

/** @param {number} cameraId */
export async function getAudioOutputs(cameraId) {
  const camera = await getCam(cameraId);
  return new Promise((resolve, reject) => {
    camera.getAudioOutputs((err, outputs) => {
      if (err) reject(err);
      else resolve(outputs);
    });
  });
}

const HOME_PRESET_NAME = "Home";

function presetName(preset) {
  return String(preset?.name || preset?.Name || "").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function continuousMove(
  cameraId,
  { pan = 0, tilt = 0, zoom = 0, timeout = 0 },
) {
  const camera = await getCam(cameraId);
  /** @type {Record<string, unknown>} */
  const options = {
    x: pan,
    y: tilt,
    zoom,
    timeout: timeout > 0 ? timeout * 1000 : undefined,
  };

  if (zoom !== 0 && pan === 0 && tilt === 0) {
    options.onlySendZoom = true;
  } else if (zoom === 0) {
    options.onlySendPanTilt = true;
  }

  await promisify(camera.continuousMove, camera, options);
}

export async function stopMove(cameraId) {
  const camera = await getCam(cameraId);
  return promisify(camera.stop, camera, { panTilt: true, zoom: true });
}

async function homePresetReady(cameraId, camera) {
  const record = findCameraWithSecretsById(cameraId);
  const token = record?.home_preset_token || "255";
  const presets = await promisify(camera.getPresets, camera, {});
  const preset = presets?.[token];
  return presetName(preset).toLowerCase() === HOME_PRESET_NAME.toLowerCase();
}

export async function gotoHomePosition(cameraId) {
  const camera = await getCam(cameraId);
  const record = findCameraWithSecretsById(cameraId);
  const token = record?.home_preset_token || "255";

  if (!(await homePresetReady(cameraId, camera))) {
    throw new Error("Chưa đặt Home — nhấn «Đặt Home» trước");
  }

  await stopMove(cameraId);
  await promisify(camera.gotoPreset, camera, { preset: token });
}

export async function setHomePosition(cameraId) {
  const camera = await getCam(cameraId);
  const record = findCameraWithSecretsById(cameraId);
  const token = record?.home_preset_token || "255";

  await stopMove(cameraId);
  await sleep(500);

  await promisify(camera.setPreset, camera, {
    presetName: HOME_PRESET_NAME,
    presetToken: token,
  });
}

function mapSpeed(speed = 5) {
  const normalized = Math.min(10, Math.max(1, Number(speed) || 5));
  return normalized / 10;
}

function normalizePanTilt(pan, tilt, speed) {
  const len = Math.hypot(pan, tilt);
  if (len > speed && len > 0) {
    const scale = speed / len;
    return [pan * scale, tilt * scale];
  }
  return [pan, tilt];
}

export async function sendPtz(cameraId, action, speed = 5, vector = {}) {
  if (action === "stop") {
    await stopMove(cameraId);
    return;
  }

  if (action === "goto_home") {
    await gotoHomePosition(cameraId);
    return;
  }

  if (action === "set_home") {
    await setHomePosition(cameraId);
    return;
  }

  const velocity = mapSpeed(speed);
  let pan = 0;
  let tilt = 0;
  let zoom = 0;

  switch (action) {
    case "up":
      tilt = velocity;
      break;
    case "down":
      tilt = -velocity;
      break;
    case "left":
      pan = -velocity;
      break;
    case "right":
      pan = velocity;
      break;
    case "up_left":
      [pan, tilt] = normalizePanTilt(-velocity, velocity, velocity);
      break;
    case "up_right":
      [pan, tilt] = normalizePanTilt(velocity, velocity, velocity);
      break;
    case "down_left":
      [pan, tilt] = normalizePanTilt(-velocity, -velocity, velocity);
      break;
    case "down_right":
      [pan, tilt] = normalizePanTilt(velocity, -velocity, velocity);
      break;
    case "vector": {
      const vx = Math.max(-1, Math.min(1, Number(vector.x) || 0));
      const vy = Math.max(-1, Math.min(1, Number(vector.y) || 0));
      [pan, tilt] = normalizePanTilt(vx * velocity, vy * velocity, velocity);
      break;
    }
    case "zoom_in":
      zoom = velocity;
      break;
    case "zoom_out":
      zoom = -velocity;
      break;
    default:
      throw new Error(`Hành động PTZ không hỗ trợ: ${action}`);
  }

  await continuousMove(cameraId, { pan, tilt, zoom, timeout: 0 });
}
