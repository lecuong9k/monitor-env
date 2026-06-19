import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const beRoot = path.join(__dirname, "..", "..");

function resolvePath(raw, fallback) {
  const value = raw?.trim() || fallback;
  return path.isAbsolute(value) ? value : path.join(beRoot, value);
}

function parseOriginMap(raw) {
  const map = {};
  if (!raw?.trim()) return map;

  for (const entry of raw.split(",")) {
    const [origin, targetUrl] = entry.split("=").map((part) => part.trim());
    if (!origin || !targetUrl) continue;
    try {
      const normalized = new URL(origin);
      map[`${normalized.protocol}//${normalized.host}`] = targetUrl.replace(
        /\/$/,
        "",
      );
    } catch {
      map[origin.replace(/\/$/, "")] = targetUrl.replace(/\/$/, "");
    }
  }

  return map;
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
  /** Khi MediaMTX trung tâm sập, client local (LAN) relay MPEG-TS qua FFmpeg. */
  mediamtxLocalFallback: process.env.MEDIAMTX_LOCAL_FALLBACK !== "false",
  mediamtxHealthCacheMs: Number(process.env.MEDIAMTX_HEALTH_CACHE_MS) || 10_000,
  /** URL public MiniPC cho ws MPEG-TS fallback — override tĩnh (tùy chọn). */
  publicWsBaseUrl:
    process.env.PUBLIC_WS_BASE_URL?.trim() ||
    process.env.MONITOR_ENV_PUBLIC_URL?.trim() ||
    null,
  /** origin=httpBase — ghi đè base ws fallback theo origin FE. */
  publicWsOriginMap: parseOriginMap(process.env.PUBLIC_WS_ORIGIN_MAP),
  mediamtx: {
    apiUrl: process.env.MEDIAMTX_API_URL?.trim() || "http://127.0.0.1:9997",
    /** Port WHEP/WebRTC MediaMTX — hostname lấy động từ Origin/Host của client. */
    webrtcPort: Number(process.env.MEDIAMTX_WEBRTC_PORT) || 8889,
    webrtcProtocol: process.env.MEDIAMTX_WEBRTC_PROTOCOL?.trim() || "http",
    /** URL WHEP/WebRTC MediaMTX trung tâm (MEDIAMTX_WEBRTC_URL). */
    webrtcFallbackUrl:
      process.env.MEDIAMTX_WEBRTC_URL?.trim() || "http://127.0.0.1:8889",
    /** origin=webrtcUrl — ghi đè khi WHEP host khác hostname FE (CDN, tunnel…). */
    webrtcOriginMap: parseOriginMap(process.env.MEDIAMTX_WEBRTC_ORIGIN_MAP),
  },
};
