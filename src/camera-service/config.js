import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const beRoot = path.join(__dirname, "..", "..");

function resolvePath(raw, fallback) {
  const value = raw?.trim() || fallback;
  return path.isAbsolute(value) ? value : path.join(beRoot, value);
}

export const config = {
  port: Number(process.env.CAMERA_SERVICE_PORT) || 4001,
  host: process.env.CAMERA_SERVICE_HOST || "127.0.0.1",
  apiKey: process.env.CAMERA_SERVICE_API_KEY?.trim() || "",
  hlsOutputDir: resolvePath(process.env.HLS_OUTPUT_DIR, "./streams"),
  ffmpegPath: process.env.FFMPEG_PATH?.trim() || null,
  streamMode:
    process.env.STREAM_MODE === "hls"
      ? "hls"
      : process.env.STREAM_MODE === "webrtc"
        ? "webrtc"
        : "mpegts",
  homePresetToken: process.env.HOME_PRESET_TOKEN || "255",
  mediamtx: {
    apiUrl: process.env.MEDIAMTX_API_URL?.trim() || "http://127.0.0.1:9997",
    webrtcPublicUrl:
      process.env.MEDIAMTX_WEBRTC_URL?.trim() || "http://127.0.0.1:8889",
  },
};
