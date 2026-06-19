import { access, mkdir, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import ffmpeg from "fluent-ffmpeg";
import { config } from "../config.js";
import {
  findCameraById,
  findCameraWithSecretsById,
} from "../repositories/camera.repository.js";
import {
  getStreamQualityPreset,
  listStreamQualityOptions,
  resolveStreamQualityId,
} from "../../config/stream-quality.js";
import {
  getFfmpegInstallHint,
  resolveFfmpegPath,
} from "../../utils/ffmpeg-path.js";
import { resolveRtspUrl } from "./onvif.service.js";
import { buildRtspUrl, maskRtspUrl } from "./rtsp.service.js";
import {
  checkMediamtxAvailable,
  clearPathSource,
  ensurePathPublisher,
  ensurePathSource,
  getRtspPublishUrl,
  getWebRtcPageUrl,
  getWhepUrl,
  isRtspPushEnabled,
  waitPathOnline,
} from "./mediamtx.service.js";
import { resolvePublicWsBaseUrl } from "../utils/public-ws-url.js";
import { clientContextFromRequest } from "../utils/webrtc-client-url.js";

/**
 * @typedef {{
 *   ffmpegProcess: import('fluent-ffmpeg').FfmpegCommand | null;
 *   outputStream: PassThrough | null;
 *   wsClients: Set<import('ws').WebSocket>;
 *   httpClients: Set<import('node:http').ServerResponse>;
 *   currentRtspUrl: string | null;
 *   qualityId: import('../../config/stream-quality.js').StreamQualityId;
 *   transcodeMode: boolean;
 *   mtxActive: boolean;
 *   localFallback: boolean;
 * }} CameraStreamState
 */

/** @type {Map<number, CameraStreamState>} */
const streams = new Map();

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

const ffmpegPath = config.ffmpegPath
  ? (() => {
      process.env.FFMPEG_PATH = config.ffmpegPath;
      return resolveFfmpegPath();
    })()
  : resolveFfmpegPath();
if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

/** @param {number} cameraId */
function getOrCreateState(cameraId) {
  if (!streams.has(cameraId)) {
    const camera = findCameraById(cameraId);
    streams.set(cameraId, {
      ffmpegProcess: null,
      outputStream: null,
      wsClients: new Set(),
      httpClients: new Set(),
      currentRtspUrl: null,
      qualityId: resolveStreamQualityId(camera?.stream_quality || "main"),
      transcodeMode: false,
      mtxActive: false,
      localFallback: false,
    });
  }
  return streams.get(cameraId);
}

function hlsDir(cameraId) {
  return path.join(path.resolve(config.hlsOutputDir), `live-${cameraId}`);
}

function hlsPlaylist(cameraId) {
  return path.join(hlsDir(cameraId), "index.m3u8");
}

function hlsPlaylistUrl(cameraId) {
  return `/streams/live-${cameraId}/index.m3u8`;
}

function ensureHlsRoot() {
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

/** @param {CameraStreamState} state */
function broadcast(state, chunk) {
  for (const client of state.wsClients) {
    if (client.readyState === 1) {
      client.send(chunk);
    } else {
      state.wsClients.delete(client);
    }
  }

  for (const client of state.httpClients) {
    if (!client.writableEnded) {
      client.write(chunk);
    } else {
      state.httpClients.delete(client);
    }
  }
}

/** @param {CameraStreamState} state */
function clearWsClients(state) {
  for (const client of state.wsClients) {
    client.close();
  }
  state.wsClients.clear();
}

/** @param {CameraStreamState} state */
function clearHttpClients(state) {
  for (const client of state.httpClients) {
    if (!client.writableEnded) client.end();
  }
  state.httpClients.clear();
}

/** @param {CameraStreamState} state */
function destroyOutputStream(state) {
  if (state.outputStream) {
    state.outputStream.removeAllListeners();
    state.outputStream.destroy();
    state.outputStream = null;
  }
}

function buildFfmpeg(source, cameraId, { mode, transcode, quality }) {
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

  const playlist = hlsPlaylist(cameraId);
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
      path.join(hlsDir(cameraId), "segment_%03d.ts"),
    ])
    .output(playlist);
}

function buildRtspPushFfmpeg(source, publishUrl, quality, transcode) {
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

  return cmd
    .outputOptions(["-f", "rtsp", "-rtsp_transport", "tcp"])
    .output(publishUrl);
}

/** @param {CameraStreamState} state */
async function startRtspPushStream(state, source, pathName, quality) {
  const publishUrl = getRtspPublishUrl(pathName);

  const tryStart = (transcode) =>
    launchFfmpeg(
      state,
      buildRtspPushFfmpeg(source, publishUrl, quality, transcode),
    );

  if (quality.transcodePolicy === "transcode") {
    await tryStart(true);
    state.transcodeMode = true;
    return;
  }

  try {
    await tryStart(false);
    state.transcodeMode = false;
  } catch (copyErr) {
    console.warn(
      `[ffmpeg rtsp-push:${quality.id}] copy failed — chuyển transcode:`,
      copyErr.message,
    );
    state.ffmpegProcess = null;
    await tryStart(true);
    state.transcodeMode = true;
  }
}

/** @param {CameraStreamState} state */
async function stopFfmpegProcess(state) {
  if (!state.ffmpegProcess) return;

  const proc = state.ffmpegProcess;
  state.ffmpegProcess = null;
  state.transcodeMode = false;

  await new Promise((resolve) => {
    proc.on("end", () => resolve());
    proc.kill("SIGTERM");
    setTimeout(() => resolve(), 2000);
  });
}

/** @param {CameraStreamState} state */
function launchFfmpeg(state, cmd, { output, cameraId } = {}) {
  return new Promise((resolveStart, reject) => {
    state.ffmpegProcess = cmd
      .on("start", () => resolveStart())
      .on("error", (err) => {
        state.ffmpegProcess = null;
        reject(err);
      })
      .on("end", () => {
        state.ffmpegProcess = null;
      });

    if (output) {
      cmd.pipe(output, { end: true });
    } else {
      cmd.run();
    }
  });
}

async function waitForPlaylist(cameraId, maxWaitMs = 20000) {
  const playlist = hlsPlaylist(cameraId);
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    try {
      await access(playlist, constants.F_OK);
      const content = await readFile(playlist, "utf8");
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

/** @param {CameraStreamState} state */
async function startMpegtsStream(state, cameraId, source, quality) {
  destroyOutputStream(state);
  state.outputStream = new PassThrough({ highWaterMark: 1024 * 512 });
  state.outputStream.on("data", (chunk) => broadcast(state, chunk));

  const tryStart = (transcode) =>
    launchFfmpeg(
      state,
      buildFfmpeg(source, cameraId, { mode: "mpegts", transcode, quality }),
      { output: state.outputStream, cameraId },
    );

  if (quality.transcodePolicy === "transcode") {
    await tryStart(true);
    state.transcodeMode = true;
    return;
  }

  try {
    await tryStart(false);
    state.transcodeMode = false;
  } catch (copyErr) {
    console.warn(
      `[ffmpeg mpegts:${quality.id}] copy failed — chuyển transcode:`,
      copyErr.message,
    );
    destroyOutputStream(state);
    state.ffmpegProcess = null;
    state.outputStream = new PassThrough({ highWaterMark: 1024 * 512 });
    state.outputStream.on("data", (chunk) => broadcast(state, chunk));
    await tryStart(true);
    state.transcodeMode = true;
  }
}

/** @param {CameraStreamState} state */
async function startHlsStream(state, cameraId, source, quality) {
  await rm(hlsDir(cameraId), { recursive: true, force: true });
  await mkdir(hlsDir(cameraId), { recursive: true });

  const startWith = async (transcode) =>
    launchFfmpeg(
      state,
      buildFfmpeg(source, cameraId, { mode: "hls", transcode, quality }),
      { cameraId },
    );

  if (quality.transcodePolicy === "transcode") {
    await startWith(true);
    state.transcodeMode = true;
    await waitForPlaylist(cameraId);
    return;
  }

  try {
    await startWith(false);
    state.transcodeMode = false;
  } catch {
    state.ffmpegProcess = null;
    await startWith(true);
    state.transcodeMode = true;
  }

  await waitForPlaylist(cameraId);
}

/** @param {CameraStreamState} state */
function isStreaming(state) {
  if (state.localFallback) return state.ffmpegProcess !== null;
  if (config.streamMode === "webrtc") {
    if (isRtspPushEnabled()) {
      return state.mtxActive && state.ffmpegProcess !== null;
    }
    return state.mtxActive;
  }
  return state.ffmpegProcess !== null;
}

function mpegtsWsUrl(cameraId) {
  return `/cameras/${cameraId}/stream/ws`;
}

function resolveMpegtsPlayUrl(cameraId, clientContext) {
  const wsPath = mpegtsWsUrl(cameraId);
  const publicBase = resolvePublicWsBaseUrl(clientContext)?.replace(/\/$/, "");
  if (publicBase) {
    return `${publicBase}${wsPath}`;
  }
  return wsPath;
}

async function startLocalMpegtsFallback(state, cameraId, source, quality) {
  if (!ffmpegPath) {
    throw new Error(
      `MediaMTX không khả dụng và không tìm thấy ffmpeg để relay local. ${getFfmpegInstallHint()}`,
    );
  }
  await startMpegtsStream(state, cameraId, source, quality);
  state.localFallback = true;
  state.mtxActive = false;
}

function getStreamQualityState(state) {
  const preset = getStreamQualityPreset(state.qualityId);
  return {
    quality: state.qualityId,
    label: preset.label,
    description: preset.description,
    options: listStreamQualityOptions(),
  };
}

export function getStreamStatus(cameraId, clientContext) {
  const camera = findCameraById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }

  const state = getOrCreateState(cameraId);
  const streaming = isStreaming(state);
  const qualityState = getStreamQualityState(state);

  if (state.localFallback) {
    const wsUrl = resolveMpegtsPlayUrl(cameraId, clientContext);
    return {
      streaming,
      mode: "mpegts",
      rtsp_configured: Boolean(state.currentRtspUrl),
      transcode: state.transcodeMode,
      stream_type: "mpegts",
      stream_url: wsUrl,
      ws_url: wsUrl,
      fallback: true,
      mediamtx_available: false,
      ...qualityState,
    };
  }

  if (config.streamMode === "webrtc") {
    const whepUrl = getWhepUrl(camera.mediamtx_path, clientContext);
    const rtspConfigured = Boolean(state.currentRtspUrl);
    const pushEnabled = isRtspPushEnabled();
    return {
      streaming,
      mode: "webrtc",
      rtsp_configured: rtspConfigured,
      stream_type: "webrtc",
      stream_url: getWebRtcPageUrl(camera.mediamtx_path, clientContext),
      whep_url: rtspConfigured ? whepUrl : null,
      mediamtx_path: camera.mediamtx_path,
      mtx_registered: state.mtxActive,
      rtsp_push: pushEnabled,
      mtx_publishing: pushEnabled && state.ffmpegProcess !== null,
      fallback: false,
      ...qualityState,
    };
  }

  if (config.streamMode === "hls") {
    const playlist = hlsPlaylistUrl(cameraId);
    return {
      streaming,
      mode: "hls",
      rtsp_configured: Boolean(state.currentRtspUrl),
      transcode: state.transcodeMode,
      stream_type: "hls",
      stream_url: playlist,
      playlist: streaming ? playlist : null,
      ...qualityState,
    };
  }

  const wsUrl = mpegtsWsUrl(cameraId);
  return {
    streaming,
    mode: "mpegts",
    rtsp_configured: Boolean(state.currentRtspUrl),
    transcode: state.transcodeMode,
    stream_type: "mpegts",
    stream_url: wsUrl,
    ws_url: streaming ? wsUrl : null,
    ...qualityState,
  };
}

export async function startCameraStream(cameraId, clientContext) {
  const camera = findCameraById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }

  const state = getOrCreateState(cameraId);

  // Start mới: luôn thử MediaMTX trung tâm trước, không giữ fallback cũ
  if (state.localFallback && config.streamMode === "webrtc") {
    await stopCameraStream(cameraId);
  } else if (isStreaming(state)) {
    return {
      ok: true,
      alreadyRunning: true,
      ...getStreamStatus(cameraId, clientContext),
    };
  }

  const quality = getStreamQualityPreset(state.qualityId);
  const source = await resolveRtspUrl(cameraId, quality.subtype);
  if (!source) {
    throw new Error("Không tìm thấy RTSP URL cho camera");
  }

  state.currentRtspUrl = source;

  if (config.streamMode === "webrtc") {
    state.localFallback = false;

    if (isRtspPushEnabled()) {
      if (!ffmpegPath) {
        throw new Error(
          `Cần ffmpeg để push RTSP lên MediaMTX. ${getFfmpegInstallHint()}`,
        );
      }

      try {
        await ensurePathPublisher(camera.mediamtx_path);
        state.mtxActive = true;
        await startRtspPushStream(state, source, camera.mediamtx_path, quality);
        await waitPathOnline(camera.mediamtx_path, 20_000);
      } catch (err) {
        console.warn(
          `[stream] RTSP push failed for camera ${cameraId}:`,
          err instanceof Error ? err.message : err,
        );
        await stopFfmpegProcess(state);
        if (state.mtxActive) {
          try {
            await clearPathSource(camera.mediamtx_path);
          } catch {
            /* ignore */
          }
          state.mtxActive = false;
        }
        throw err instanceof Error
          ? err
          : new Error("Không push được stream lên MediaMTX");
      }
    } else {
      try {
        await ensurePathSource(camera.mediamtx_path, source);
        state.mtxActive = true;
      } catch (err) {
        console.warn(
          `[stream] MediaMTX path register failed for camera ${cameraId}:`,
          err instanceof Error ? err.message : err,
        );
        state.mtxActive = false;
      }
    }
  } else {
    if (!ffmpegPath) {
      throw new Error(
        `Không tìm thấy ffmpeg binary. ${getFfmpegInstallHint()}`,
      );
    }

    if (config.streamMode === "hls") {
      await startHlsStream(state, cameraId, source, quality);
    } else {
      await startMpegtsStream(state, cameraId, source, quality);
    }
  }

  return {
    ok: true,
    alreadyRunning: false,
    ...getStreamStatus(cameraId, clientContext),
  };
}

async function activateLocalMpegtsFallback(
  state,
  camera,
  cameraId,
  source,
  quality,
) {
  try {
    await clearPathSource(camera.mediamtx_path);
  } catch {
    /* path có thể chưa tồn tại */
  }
  state.mtxActive = false;
  await startLocalMpegtsFallback(state, cameraId, source, quality);
}

export async function stopCameraStream(cameraId) {
  const camera = findCameraById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }

  const state = getOrCreateState(cameraId);

  if (state.localFallback) {
    if (!state.ffmpegProcess) {
      state.localFallback = false;
      state.currentRtspUrl = null;
      return { ok: true, stopped: false };
    }

    clearWsClients(state);
    clearHttpClients(state);

    return new Promise((resolve) => {
      const proc = state.ffmpegProcess;
      state.ffmpegProcess = null;
      state.localFallback = false;
      state.currentRtspUrl = null;
      state.transcodeMode = false;
      destroyOutputStream(state);

      proc.on("end", () => resolve({ ok: true, stopped: true }));
      proc.kill("SIGTERM");

      setTimeout(() => resolve({ ok: true, stopped: true }), 2000);
    });
  }

  if (config.streamMode === "webrtc") {
    const hadPush = state.ffmpegProcess !== null;
    const hadMtx = state.mtxActive;

    if (!hadPush && !hadMtx) {
      return { ok: true, stopped: false };
    }

    if (hadPush) {
      await stopFfmpegProcess(state);
    }

    if (hadMtx) {
      try {
        await clearPathSource(camera.mediamtx_path);
      } catch {
        /* path có thể đã bị xóa */
      }
      state.mtxActive = false;
    }

    state.currentRtspUrl = null;
    return { ok: true, stopped: true };
  }

  if (!state.ffmpegProcess) {
    return { ok: true, stopped: false };
  }

  clearWsClients(state);
  clearHttpClients(state);

  return new Promise((resolve) => {
    const proc = state.ffmpegProcess;
    state.ffmpegProcess = null;
    state.currentRtspUrl = null;
    state.transcodeMode = false;
    destroyOutputStream(state);

    proc.on("end", () => resolve({ ok: true, stopped: true }));
    proc.kill("SIGTERM");

    setTimeout(() => resolve({ ok: true, stopped: true }), 2000);
  });
}

export async function restartCameraStream(cameraId, clientContext) {
  await stopCameraStream(cameraId);
  return startCameraStream(cameraId, clientContext);
}

/** Ép relay MPEG-TS local (backup khi MediaMTX trung tâm không phát được). */
export async function forceCameraStreamFallback(cameraId, clientContext) {
  const camera = findCameraById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }

  const state = getOrCreateState(cameraId);
  const quality = getStreamQualityPreset(state.qualityId);
  const source =
    state.currentRtspUrl || (await resolveRtspUrl(cameraId, quality.subtype));
  if (!source) {
    throw new Error("Không tìm thấy RTSP URL cho camera");
  }

  state.currentRtspUrl = source;

  if (state.localFallback && state.ffmpegProcess) {
    return {
      ok: true,
      alreadyRunning: true,
      ...getStreamStatus(cameraId, clientContext),
    };
  }

  if (state.mtxActive || state.ffmpegProcess) {
    await stopCameraStream(cameraId);
  }

  await activateLocalMpegtsFallback(state, camera, cameraId, source, quality);

  return {
    ok: true,
    alreadyRunning: false,
    ...getStreamStatus(cameraId, clientContext),
  };
}

export async function setStreamQuality(cameraId, qualityId, clientContext) {
  const camera = findCameraById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }

  const state = getOrCreateState(cameraId);
  const nextId = resolveStreamQualityId(qualityId);
  const changed = nextId !== state.qualityId;
  state.qualityId = nextId;

  if (changed && isStreaming(state)) {
    await restartCameraStream(cameraId, clientContext);
  }

  return getStreamQualityState(state);
}

export function addWsClient(cameraId, socket) {
  const state = getOrCreateState(cameraId);
  const mpegtsAllowed =
    config.streamMode === "mpegts" ||
    state.localFallback ||
    state.outputStream !== null;
  if (!isStreaming(state) || !mpegtsAllowed) {
    socket.close(1013, "Stream chưa chạy");
    return;
  }

  state.wsClients.add(socket);
  socket.on("close", () => state.wsClients.delete(socket));
  socket.on("error", () => state.wsClients.delete(socket));
}

export async function attachMpegTsClient(cameraId, reply, request) {
  const state = getOrCreateState(cameraId);
  const clientContext = clientContextFromRequest(request);
  if (!isStreaming(state)) {
    await startCameraStream(cameraId, clientContext);
  }

  const res = reply.raw;
  state.httpClients.add(res);

  if (!res.headersSent) {
    res.writeHead(200, {
      "Content-Type": "video/mp2t",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Connection: "keep-alive",
      ...streamCorsHeaders(request),
    });
  }

  res.on("close", () => {
    state.httpClients.delete(res);
    if (
      state.httpClients.size === 0 &&
      state.wsClients.size === 0 &&
      isStreaming(state)
    ) {
      void stopCameraStream(cameraId);
    }
  });
}

export async function ensureMpegtsRelayStream(cameraId) {
  const camera = findCameraById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }

  const state = getOrCreateState(cameraId);
  const wsUrl = `/cameras/${cameraId}/stream/ws`;

  if (state.outputStream && state.ffmpegProcess) {
    return {
      ok: true,
      streaming: true,
      stream_type: "mpegts",
      ws_url: wsUrl,
      stream_url: wsUrl,
      relay: true,
    };
  }

  const quality = getStreamQualityPreset("mobile");
  state.qualityId = "mobile";
  const source =
    state.currentRtspUrl || (await resolveRtspUrl(cameraId, quality.subtype));
  if (!source) {
    throw new Error("Không tìm thấy RTSP URL cho camera");
  }

  state.currentRtspUrl = source;
  if (!ffmpegPath) {
    throw new Error(`Không tìm thấy ffmpeg binary. ${getFfmpegInstallHint()}`);
  }

  await startMpegtsStream(state, cameraId, source, quality);

  return {
    ok: true,
    streaming: true,
    stream_type: "mpegts",
    ws_url: wsUrl,
    stream_url: wsUrl,
    relay: true,
    quality: quality.id,
    label: quality.label,
  };
}

export function getStreamQualityForCamera(cameraId) {
  const camera = findCameraById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }
  const state = getOrCreateState(cameraId);
  return getStreamQualityState(state);
}

export function getStreamInfo(cameraId, clientContext) {
  return getStreamStatus(cameraId, clientContext);
}

export function stopAllStreams() {
  for (const cameraId of streams.keys()) {
    void stopCameraStream(cameraId);
  }
}

export async function initStreamService() {
  if (config.streamMode === "webrtc") {
    try {
      await checkMediamtxAvailable();
    } catch (err) {
      console.warn(
        "[stream] MediaMTX API unavailable at startup:",
        err instanceof Error ? err.message : err,
      );
    }
    return;
  }
  ensureHlsRoot();
}

export function getHlsOutputDir() {
  return path.resolve(config.hlsOutputDir);
}

/** @param {number} cameraId @param {0 | 1 | 2} subtype */
export function previewRtspUrl(cameraId, subtype = 0) {
  const camera = findCameraWithSecretsById(cameraId);
  if (!camera) return null;
  return maskRtspUrl(buildRtspUrl(camera, subtype));
}
