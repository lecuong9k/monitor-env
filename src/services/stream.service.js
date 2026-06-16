import { access, mkdir, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import ffmpeg from "fluent-ffmpeg";
import { config } from "../config/camera.config.js";
import {
  getStreamQualityPreset,
  listStreamQualityOptions,
  resolveStreamQualityId,
} from "../config/stream-quality.js";
import {
  getFfmpegInstallHint,
  resolveFfmpegPath,
} from "../utils/ffmpeg-path.js";
import { resolveRtspUrl } from "./onvif.service.js";

/** @type {import('fluent-ffmpeg').FfmpegCommand | null} */
let ffmpegProcess = null;
/** @type {PassThrough | null} */
let outputStream = null;
/** @type {Set<import('ws').WebSocket>} */
const wsClients = new Set();
/** @type {Set<import('node:http').ServerResponse>} */
const httpClients = new Set();
let currentRtspUrl = null;
/** @type {import('../config/stream-quality.js').StreamQualityId} */
let currentQualityId = resolveStreamQualityId(config.streamQuality);
let transcodeMode = false;

const HLS_DIR = path.join(path.resolve(config.hlsOutputDir), "live");
const HLS_PLAYLIST = path.join(HLS_DIR, "index.m3u8");
const HLS_PLAYLIST_URL = "/streams/live/index.m3u8";

const INPUT_PROFILES = {
  lowLatency: [
    "-rtsp_transport",
    "tcp",
    "-fflags",
    "nobuffer",
    "-flags",
    "low_delay",
    "-probesize",
    "32",
    "-analyzeduration",
    "0",
    "-max_delay",
    "500000",
  ],
  stable: [
    "-rtsp_transport",
    "tcp",
    "-fflags",
    "+genpts+discardcorrupt+nobuffer",
    "-flags",
    "low_delay",
    "-probesize",
    "500000",
    "-analyzeduration",
    "500000",
    "-max_delay",
    "500000",
  ],
};

const ffmpegPath = resolveFfmpegPath();
if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

function ensureHlsDir() {
  fs.mkdirSync(config.hlsOutputDir, { recursive: true });
}

function streamCorsHeaders(req) {
  const origin = req?.headers?.origin;
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

function broadcast(chunk) {
  for (const client of wsClients) {
    if (client.readyState === 1) {
      client.send(chunk);
    } else {
      wsClients.delete(client);
    }
  }

  for (const client of httpClients) {
    if (!client.writableEnded) {
      client.write(chunk);
    } else {
      httpClients.delete(client);
    }
  }
}

function clearWsClients() {
  for (const client of wsClients) {
    client.close();
  }
  wsClients.clear();
}

function clearHttpClients() {
  for (const client of httpClients) {
    if (!client.writableEnded) client.end();
  }
  httpClients.clear();
}

function destroyOutputStream() {
  if (outputStream) {
    outputStream.removeAllListeners();
    outputStream.destroy();
    outputStream = null;
  }
}

function buildFfmpeg(source, { mode, transcode, quality }) {
  const inputOptions =
    INPUT_PROFILES[quality.inputProfile] ?? INPUT_PROFILES.lowLatency;
  const cmd = ffmpeg(source).inputOptions(inputOptions).noAudio();

  if (transcode) {
    const tc = quality.transcode;
    if (tc.scale) {
      cmd.videoFilters(tc.scale);
    }
    cmd
      .videoCodec("libx264")
      .addOutputOption("-preset", tc.preset)
      .addOutputOption("-tune", "zerolatency")
      .addOutputOption("-profile:v", "baseline")
      .addOutputOption("-pix_fmt", "yuv420p")
      .addOutputOption("-r", String(tc.fps))
      .addOutputOption("-g", String(tc.fps * 2))
      .addOutputOption("-maxrate", tc.maxrate)
      .addOutputOption("-bufsize", tc.bufsize);
  } else {
    cmd.videoCodec("copy");
  }

  if (mode === "mpegts") {
    return cmd
      .format("mpegts")
      .addOutputOption("-muxdelay", "0")
      .addOutputOption("-muxpreload", "0");
  }

  return cmd
    .outputOptions([
      "-f",
      "hls",
      "-hls_time",
      "0.5",
      "-hls_list_size",
      "3",
      "-hls_flags",
      "delete_segments+append_list+omit_endlist+program_date_time+independent_segments",
      "-hls_segment_filename",
      path.join(HLS_DIR, "segment_%03d.ts"),
    ])
    .output(HLS_PLAYLIST);
}

function launchFfmpeg(cmd, { output } = {}) {
  return new Promise((resolveStart, reject) => {
    ffmpegProcess = cmd
      .on("start", () => resolveStart())
      .on("error", (err) => {
        ffmpegProcess = null;
        reject(err);
      })
      .on("end", () => {
        ffmpegProcess = null;
      });

    if (output) {
      cmd.pipe(output, { end: true });
    } else {
      cmd.run();
    }
  });
}

async function waitForPlaylist(maxWaitMs = 20000) {
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    try {
      await access(HLS_PLAYLIST, constants.F_OK);
      const content = await readFile(HLS_PLAYLIST, "utf8");
      if (content.includes("#EXTINF") && content.includes(".ts")) {
        return;
      }
    } catch {
      // chưa sẵn sàng
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  throw new Error(
    "Timeout chờ playlist HLS — kiểm tra RTSP URL và kết nối camera",
  );
}

async function startMpegtsStream(source, quality) {
  destroyOutputStream();
  outputStream = new PassThrough({ highWaterMark: 1024 * 512 });
  outputStream.on("data", broadcast);

  const tryStart = (transcode) =>
    launchFfmpeg(buildFfmpeg(source, { mode: "mpegts", transcode, quality }), {
      output: outputStream,
    });

  if (quality.transcodePolicy === "transcode") {
    await tryStart(true);
    transcodeMode = true;
    return;
  }

  try {
    await tryStart(false);
    transcodeMode = false;
  } catch (copyErr) {
    console.warn(
      `[ffmpeg mpegts:${quality.id}] copy failed — chuyển transcode:`,
      copyErr.message,
    );
    destroyOutputStream();
    ffmpegProcess = null;
    outputStream = new PassThrough({ highWaterMark: 1024 * 512 });
    outputStream.on("data", broadcast);
    await tryStart(true);
    transcodeMode = true;
  }
}

async function startHlsStream(source, quality) {
  await rm(HLS_DIR, { recursive: true, force: true });
  await mkdir(HLS_DIR, { recursive: true });

  const startWith = async (transcode) =>
    launchFfmpeg(buildFfmpeg(source, { mode: "hls", transcode, quality }));

  if (quality.transcodePolicy === "transcode") {
    await startWith(true);
    transcodeMode = true;
    await waitForPlaylist();
    return;
  }

  try {
    await startWith(false);
    transcodeMode = false;
  } catch {
    ffmpegProcess = null;
    await startWith(true);
    transcodeMode = true;
  }

  await waitForPlaylist();
}

export function isStreaming() {
  return ffmpegProcess !== null;
}

export function getStreamQuality() {
  return currentQualityId;
}

export function getStreamQualityState() {
  const preset = getStreamQualityPreset(currentQualityId);
  return {
    quality: currentQualityId,
    label: preset.label,
    description: preset.description,
    options: listStreamQualityOptions(),
  };
}

export function getStreamStatus(cameraId = 1) {
  const streaming = isStreaming();
  const qualityState = getStreamQualityState();

  if (config.streamMode === "hls") {
    return {
      streaming,
      mode: "hls",
      rtspUrl: currentRtspUrl,
      transcode: transcodeMode,
      stream_type: "hls",
      stream_url: HLS_PLAYLIST_URL,
      playlist: streaming ? HLS_PLAYLIST_URL : null,
      ...qualityState,
    };
  }

  // const liveUrl = `/cameras/${cameraId}/stream/live.ts`;
  const wsUrl = `/cameras/${cameraId}/stream/ws`;
  return {
    streaming,
    mode: "mpegts",
    rtspUrl: currentRtspUrl,
    transcode: transcodeMode,
    stream_type: "mpegts",
    stream_url: wsUrl,
    ws_url: streaming ? wsUrl : null,
    ...qualityState,
  };
}

export async function startCameraStream(cameraId = 1) {
  if (ffmpegProcess) {
    return { ok: true, alreadyRunning: true, ...getStreamStatus(cameraId) };
  }

  if (!ffmpegPath) {
    throw new Error(`Không tìm thấy ffmpeg binary. ${getFfmpegInstallHint()}`);
  }

  const quality = getStreamQualityPreset(currentQualityId);
  const source = await resolveRtspUrl(quality.subtype);
  if (!source) {
    throw new Error(
      "Không tìm thấy RTSP URL. Cấu hình CAMERA_RTSP_URL hoặc kết nối ONVIF.",
    );
  }

  currentRtspUrl = source;

  if (config.streamMode === "hls") {
    await startHlsStream(source, quality);
  } else {
    await startMpegtsStream(source, quality);
  }

  return { ok: true, alreadyRunning: false, ...getStreamStatus(cameraId) };
}

export async function stopCameraStream() {
  if (!ffmpegProcess) {
    return { ok: true, stopped: false };
  }

  clearWsClients();
  clearHttpClients();

  return new Promise((resolve) => {
    const proc = ffmpegProcess;
    ffmpegProcess = null;
    currentRtspUrl = null;
    transcodeMode = false;
    destroyOutputStream();

    proc.on("end", () => resolve({ ok: true, stopped: true }));
    proc.kill("SIGTERM");

    setTimeout(() => resolve({ ok: true, stopped: true }), 2000);
  });
}

export async function restartCameraStream(cameraId = 1) {
  await stopCameraStream();
  return startCameraStream(cameraId);
}

/** @param {string} qualityId */
export async function setStreamQuality(qualityId) {
  const nextId = resolveStreamQualityId(qualityId);
  const changed = nextId !== currentQualityId;
  currentQualityId = nextId;

  if (changed && isStreaming()) {
    await restartCameraStream();
  }

  return getStreamQualityState();
}

export function addWsClient(socket) {
  if (!isStreaming() || config.streamMode !== "mpegts") {
    socket.close(1013, "Stream chưa chạy");
    return;
  }

  wsClients.add(socket);
  socket.on("close", () => wsClients.delete(socket));
  socket.on("error", () => wsClients.delete(socket));
}

export async function attachMpegTsClient(reply, request) {
  if (!isStreaming()) {
    await startCameraStream(Number(request.params?.id) || 1);
  }

  const res = reply.raw;
  httpClients.add(res);

  if (!res.headersSent) {
    res.writeHead(200, {
      "Content-Type": "video/mp2t",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Connection: "keep-alive",
      ...streamCorsHeaders(request),
    });
  }

  res.on("close", () => {
    httpClients.delete(res);
    if (httpClients.size === 0 && wsClients.size === 0 && isStreaming()) {
      void stopCameraStream();
    }
  });
}

export function getStreamInfo(cameraId) {
  return getStreamStatus(cameraId);
}

export function stopAllStreams() {
  void stopCameraStream();
}

export async function initStreamService() {
  ensureHlsDir();
}
