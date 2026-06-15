import onvif from "onvif";
import { config } from "../config/camera.config.js";

/** @type {import('onvif').Cam | null} */
let cam = null;
/** @type {Promise<import('onvif').Cam> | null} */
let connectionPromise = null;

const HOME_PRESET_NAME = "Home";
const HOME_PRESET_TOKEN = config.homePresetToken;

function connectCamera() {
  if (connectionPromise) return connectionPromise;

  connectionPromise = new Promise((resolve, reject) => {
    const instance = new onvif.Cam(
      {
        hostname: config.camera.host,
        username: config.camera.username,
        password: config.camera.password,
        port: config.camera.port,
      },
      (err) => {
        if (err) {
          connectionPromise = null;
          reject(err);
          return;
        }
        cam = instance;
        resolve(instance);
      },
    );
  });

  return connectionPromise;
}

export async function getCam() {
  if (cam) return cam;
  return connectCamera();
}

function promisify(method, camera, options = {}) {
  return new Promise((resolve, reject) => {
    method.call(camera, options, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function encodeCredential(value) {
  return encodeURIComponent(value);
}

function rtspPathForSubtype(subtype) {
  const { rtspPathMain, rtspPathSub, rtspPathMobile } = config.camera;
  if (subtype === 0) return rtspPathMain;
  if (subtype === 1) return rtspPathSub;
  if (subtype === 2) return rtspPathMobile;
  return rtspPathMain;
}

function buildFallbackRtspUrl(subtype = 0) {
  const { host, username, password, rtspPort } = config.camera;
  const pathPart = rtspPathForSubtype(subtype);
  const normalizedPath = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
  return `rtsp://${encodeCredential(username)}:${encodeCredential(password)}@${host}:${rtspPort}${normalizedPath}`;
}

/** @param {0 | 1 | 2} subtype */
export async function resolveRtspUrl(subtype = 0) {
  if (config.camera.rtspUrl) {
    return config.camera.rtspUrl;
  }

  return buildFallbackRtspUrl(subtype);
}

function presetName(preset) {
  return String(preset?.name || preset?.Name || "").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function continuousMove({
  pan = 0,
  tilt = 0,
  zoom = 0,
  timeout = 0,
}) {
  const camera = await getCam();
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

export async function stopMove() {
  const camera = await getCam();
  return promisify(camera.stop, camera, { panTilt: true, zoom: true });
}

async function homePresetReady(camera) {
  const presets = await promisify(camera.getPresets, camera, {});
  const preset = presets?.[HOME_PRESET_TOKEN];
  return presetName(preset).toLowerCase() === HOME_PRESET_NAME.toLowerCase();
}

export async function gotoHomePosition() {
  const camera = await getCam();

  if (!(await homePresetReady(camera))) {
    throw new Error("Chưa đặt Home — nhấn «Đặt Home» trước");
  }

  await stopMove();
  await promisify(camera.gotoPreset, camera, { preset: HOME_PRESET_TOKEN });
}

export async function setHomePosition() {
  const camera = await getCam();

  await stopMove();
  await sleep(500);

  await promisify(camera.setPreset, camera, {
    presetName: HOME_PRESET_NAME,
    presetToken: HOME_PRESET_TOKEN,
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

export async function sendPtz(action, speed = 5, vector = {}) {
  if (action === "stop") {
    await stopMove();
    return;
  }

  if (action === "goto_home") {
    await gotoHomePosition();
    return;
  }

  if (action === "set_home") {
    await setHomePosition();
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

  await continuousMove({ pan, tilt, zoom, timeout: 0 });
}
