import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const beRoot = path.join(__dirname, "..", "..");

function resolvePath(raw, fallback) {
  const value = raw?.trim() || fallback;
  return path.isAbsolute(value) ? value : path.join(beRoot, value);
}

const RTSP_TEMPLATE = "/rtsp/streaming?channel=01&subtype=";

export const config = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || "0.0.0.0",
  camera: {
    host: process.env.CAMERA_HOST || "192.168.1.100",
    port: Number(process.env.CAMERA_PORT) || 80,
    username: process.env.CAMERA_USERNAME || "admin",
    password: process.env.CAMERA_PASSWORD || "password",
    rtspUrl: process.env.CAMERA_RTSP_URL?.trim() || null,
    rtspPort: Number(process.env.CAMERA_RTSP_PORT) || 554,
    /** @deprecated Chỉ dùng khi tương thích cũ — ưu tiên *_MAIN/_SUB/_MOBILE */
    rtspPath: process.env.CAMERA_RTSP_PATH || `${RTSP_TEMPLATE}0`,
    rtspPathMain: process.env.CAMERA_RTSP_PATH_MAIN || `${RTSP_TEMPLATE}0`,
    rtspPathSub: process.env.CAMERA_RTSP_PATH_SUB || `${RTSP_TEMPLATE}1`,
    rtspPathMobile: process.env.CAMERA_RTSP_PATH_MOBILE || `${RTSP_TEMPLATE}2`,
  },
  hlsOutputDir: resolvePath(process.env.HLS_OUTPUT_DIR, "./streams"),
  ffmpegPath: process.env.FFMPEG_PATH?.trim() || null,
  streamMode:
    process.env.STREAM_MODE === "hls"
      ? "hls"
      : process.env.STREAM_MODE === "webrtc"
        ? "webrtc"
        : "mpegts",
  streamQuality: process.env.STREAM_QUALITY || "main",
  mediamtx: {
    apiUrl: process.env.MEDIAMTX_API_URL?.trim() || "http://127.0.0.1:9997",
    webrtcPublicUrl:
      process.env.MEDIAMTX_WEBRTC_URL?.trim() || "http://127.0.0.1:8889",
    path: process.env.MEDIAMTX_PATH?.trim() || "camera1",
  },
  /** Slot preset cố định cho Home — tránh trùng preset 1..N đang dùng */
  homePresetToken: process.env.HOME_PRESET_TOKEN || "255",
};
