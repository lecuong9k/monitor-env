import { config } from "./config.js";
import {
  countCameras,
  insertCamera,
} from "./repositories/camera.repository.js";

const RTSP_TEMPLATE = "/rtsp/streaming?channel=01&subtype=";

export function seedCamerasFromEnv() {
  if (countCameras() > 0) return;

  const host = process.env.CAMERA_HOST?.trim();
  const username = process.env.CAMERA_USERNAME?.trim();
  const password = process.env.CAMERA_PASSWORD;

  if (!host || !username || !password) {
    console.warn(
      "[camera-service] Chưa có camera trong DB — thêm tại web: #/cau-hinh/camera",
    );
    return;
  }

  const mediamtxPath =
    process.env.MEDIAMTX_PATH?.trim() ||
    process.env.CAMERA_MEDIAMTX_PATH?.trim() ||
    "camera1";

  insertCamera({
    name: process.env.CAMERA_NAME?.trim() || "Camera giám sát",
    host,
    username,
    password,
    onvif_port: Number(process.env.CAMERA_PORT) || 80,
    rtsp_port: Number(process.env.CAMERA_RTSP_PORT) || 554,
    rtsp_url_override: process.env.CAMERA_RTSP_URL?.trim() || null,
    rtsp_path_main: process.env.CAMERA_RTSP_PATH_MAIN || `${RTSP_TEMPLATE}0`,
    rtsp_path_sub: process.env.CAMERA_RTSP_PATH_SUB || `${RTSP_TEMPLATE}1`,
    rtsp_path_mobile:
      process.env.CAMERA_RTSP_PATH_MOBILE || `${RTSP_TEMPLATE}2`,
    ptz_enabled: process.env.CAMERA_PTZ_ENABLED !== "false",
    mediamtx_path: mediamtxPath,
    stream_quality: process.env.STREAM_QUALITY || "main",
    home_preset_token: config.homePresetToken,
  });

  console.log("[camera-service] Đã seed camera đầu tiên từ biến môi trường");
}
