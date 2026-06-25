import path from "path";
import { fileURLToPath } from "url";
import os from "os";

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

/** rtsp://host:8554 — FFmpeg relay lên MediaMTX central. */
function resolveCentralRtspPublishUrl() {
  const explicit =
    process.env.MEDIAMTX_CENTRAL_RTSP_PUBLISH_URL?.trim() ||
    process.env.MEDIAMTX_RTSP_PUBLISH_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const apiUrl =
    process.env.MEDIAMTX_CENTRAL_API_URL?.trim() ||
    process.env.MEDIAMTX_API_URL?.trim();
  if (!apiUrl) return null;

  try {
    const { hostname } = new URL(apiUrl);
    if (hostname) return `rtsp://${hostname}:8554`;
  } catch {
    return null;
  }

  return null;
}

function detectLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "127.0.0.1";
}

function resolveLocalWebrtcUrl() {
  const explicit = process.env.MEDIAMTX_LOCAL_WEBRTC_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const lanIp = process.env.MEDIAMTX_LOCAL_LAN_IP?.trim() || detectLanIp();
  const defaultPort = process.env.NODE_ENV === "development" ? 8890 : 8889;
  const port = Number(process.env.MEDIAMTX_LOCAL_WEBRTC_PORT) || defaultPort;
  const protocol = process.env.MEDIAMTX_LOCAL_WEBRTC_PROTOCOL?.trim() || "http";
  return `${protocol}://${lanIp}:${port}`;
}

export const config = {
  port: Number(process.env.CAMERA_SERVICE_PORT) || 4001,
  host: process.env.CAMERA_SERVICE_HOST || "127.0.0.1",
  apiKey: process.env.CAMERA_SERVICE_API_KEY?.trim() || "",
  hlsOutputDir: resolvePath(process.env.HLS_OUTPUT_DIR, "./streams"),
  ffmpegPath: process.env.FFMPEG_PATH?.trim() || null,
  /** Dev: libx264 (.env.development) | Prod Pi: h264_v4l2m2m (.env.production) */
  ffmpegVideoEncoder: process.env.FFMPEG_VIDEO_ENCODER?.trim() || null,
  ffmpegVideoEncoderFallback:
    process.env.FFMPEG_VIDEO_ENCODER_FALLBACK?.trim() || "libx264",
  streamMode:
    process.env.STREAM_MODE === "hls"
      ? "hls"
      : process.env.STREAM_MODE === "webrtc"
        ? "webrtc"
        : "mpegts",
  homePresetToken: process.env.HOME_PRESET_TOKEN || "255",
  mediamtxHealthCacheMs: Number(process.env.MEDIAMTX_HEALTH_CACHE_MS) || 10_000,
  mediamtx: {
    local: {
      apiUrl:
        process.env.MEDIAMTX_LOCAL_API_URL?.trim() ||
        (process.env.NODE_ENV === "development"
          ? "http://127.0.0.1:9996"
          : "http://127.0.0.1:9997"),
      webrtcUrl: resolveLocalWebrtcUrl(),
      rtspInternalUrl:
        process.env.MEDIAMTX_LOCAL_RTSP_URL?.trim() ||
        (process.env.NODE_ENV === "development"
          ? "rtsp://127.0.0.1:8555"
          : "rtsp://127.0.0.1:8554"),
      webrtcOriginMap: parseOriginMap(
        process.env.MEDIAMTX_LOCAL_WEBRTC_ORIGIN_MAP,
      ),
    },
    central: {
      apiUrl:
        process.env.MEDIAMTX_CENTRAL_API_URL?.trim() ||
        process.env.MEDIAMTX_API_URL?.trim() ||
        null,
      webrtcUrl:
        process.env.MEDIAMTX_CENTRAL_WEBRTC_URL?.trim() ||
        process.env.MEDIAMTX_WEBRTC_URL?.trim() ||
        null,
      rtspPublishUrl: resolveCentralRtspPublishUrl(),
      webrtcOriginMap: parseOriginMap(
        process.env.MEDIAMTX_CENTRAL_WEBRTC_ORIGIN_MAP ||
          process.env.MEDIAMTX_WEBRTC_ORIGIN_MAP,
      ),
    },
  },
  /** Dừng local ingest sau N ms không còn local MTX reader (0 = tắt). */
  streamIdleStopMs: Number(process.env.STREAM_IDLE_STOP_MS) || 120_000,
  streamIdlePollMs: Number(process.env.STREAM_IDLE_POLL_MS) || 15_000,
  /** Safety: dừng central relay khi không còn reader và remoteViewerCount = 0. */
  centralRelayIdleStopMs:
    Number(process.env.CENTRAL_RELAY_IDLE_STOP_MS) || 60_000,
  /** TTL viewer không heartbeat thì gỡ khỏi session (ms). */
  viewerHeartbeatTtlMs:
    Number(process.env.STREAM_VIEWER_HEARTBEAT_TTL_MS) || 45_000,
  /** Viewer còn trong Map nhưng MTX reader=0 liên tục → coi ghost (ms). */
  streamReaderGhostMs: Number(process.env.STREAM_READER_GHOST_MS) || 30_000,
  /** Mỗi N chu kỳ poll chạy sweep path MTX không quản lý (0 = tắt). */
  streamMtxSweepEveryPolls:
    Number(process.env.STREAM_MTX_SWEEP_EVERY_POLLS) || 4,
  /**
   * Local ingest: mediamtx = Camera RTSP → MTX local (khuyến nghị MiniPC UI).
   * ffmpeg = Camera RTSP → ffmpeg → MTX local (legacy transcode/copy).
   */
  streamLocalIngestMode: resolveStreamLocalIngestMode(),
};

/** @returns {'mediamtx' | 'ffmpeg'} */
function resolveStreamLocalIngestMode() {
  const raw = String(process.env.STREAM_LOCAL_INGEST_MODE || "mediamtx")
    .trim()
    .toLowerCase();
  return raw === "ffmpeg" ? "ffmpeg" : "mediamtx";
}

/** @typedef {'local' | 'central'} MtxTarget */
/** @typedef {'local' | 'remote'} StreamScope */

export function resolveStreamScope(raw) {
  const scope = String(raw || "local")
    .trim()
    .toLowerCase();
  return scope === "remote" ? "remote" : "local";
}
