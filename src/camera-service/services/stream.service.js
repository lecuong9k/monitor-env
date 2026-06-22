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
  listStreamQualityOptionsForCamera,
  pickStreamQualityForCamera,
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
  resolveQualityPath,
  waitPathOnline,
} from "./mediamtx.service.js";
import { resolvePublicWsBaseUrl } from "../utils/public-ws-url.js";
import { clientContextFromRequest } from "../utils/webrtc-client-url.js";

/**
 * @typedef {import('../../config/stream-quality.js').StreamQualityId} StreamQualityId
 * @typedef {{
 *   ffmpegProcess: import('fluent-ffmpeg').FfmpegCommand | null;
 *   outputStream: PassThrough | null;
 *   wsClients: Set<import('ws').WebSocket>;
 *   httpClients: Set<import('node:http').ServerResponse>;
 *   currentRtspUrl: string | null;
 *   qualityId: StreamQualityId;
 *   transcodeMode: boolean;
 *   mtxActive: boolean;
 *   localFallback: boolean;
 *   mtxPathName: string | null;
 *   startingPromise: Promise<void> | null;
 *   idleSince: number | null;
 * }} QualityStreamState
 */

/** @type {Map<number, Map<StreamQualityId, QualityStreamState>>} */
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

/** @param {StreamQualityId} qualityId */
function createQualityState(qualityId) {
  return {
    ffmpegProcess: null,
    outputStream: null,
    wsClients: new Set(),
    httpClients: new Set(),
    currentRtspUrl: null,
    qualityId,
    transcodeMode: false,
    mtxActive: false,
    localFallback: false,
    mtxPathName: null,
    startingPromise: null,
    idleSince: null,
  };
}

/** @param {number} cameraId @param {StreamQualityId} qualityId */
function getOrCreateQualityState(cameraId, qualityId) {
  if (!streams.has(cameraId)) {
    streams.set(cameraId, new Map());
  }
  const byQuality = streams.get(cameraId);
  if (!byQuality.has(qualityId)) {
    byQuality.set(qualityId, createQualityState(qualityId));
  }
  return /** @type {QualityStreamState} */ (byQuality.get(qualityId));
}

/** @param {ReturnType<typeof findCameraById>} camera @param {string} [requestedId] */
export function resolveCameraQualityId(camera, requestedId) {
  return pickStreamQualityForCamera(
    camera,
    requestedId || camera?.stream_quality || "main",
  );
}

function hlsDir(cameraId, qualityId) {
  return path.join(
    path.resolve(config.hlsOutputDir),
    `live-${cameraId}-${qualityId}`,
  );
}

function hlsPlaylist(cameraId, qualityId) {
  return path.join(hlsDir(cameraId, qualityId), "index.m3u8");
}

function hlsPlaylistUrl(cameraId, qualityId) {
  return `/streams/live-${cameraId}-${qualityId}/index.m3u8`;
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

/** @param {QualityStreamState} state */
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

/** @param {QualityStreamState} state */
function clearWsClients(state) {
  for (const client of state.wsClients) {
    client.close();
  }
  state.wsClients.clear();
}

/** @param {QualityStreamState} state */
function clearHttpClients(state) {
  for (const client of state.httpClients) {
    if (!client.writableEnded) client.end();
  }
  state.httpClients.clear();
}

/** @param {QualityStreamState} state */
export function countLocalMpegtsClients(state) {
  return state.wsClients.size + state.httpClients.size;
}

/** @param {QualityStreamState} state */
function destroyOutputStream(state) {
  if (state.outputStream) {
    state.outputStream.removeAllListeners();
    state.outputStream.destroy();
    state.outputStream = null;
  }
}

function buildFfmpeg(
  source,
  cameraId,
  qualityId,
  { mode, transcode, quality },
) {
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

  const playlist = hlsPlaylist(cameraId, qualityId);
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
      path.join(hlsDir(cameraId, qualityId), "segment_%03d.ts"),
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

/** @param {QualityStreamState} state */
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

/** @param {QualityStreamState} state */
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

/** @param {QualityStreamState} state */
function launchFfmpeg(state, cmd, { output } = {}) {
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

async function waitForPlaylist(cameraId, qualityId, maxWaitMs = 20000) {
  const playlist = hlsPlaylist(cameraId, qualityId);
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

/** @param {QualityStreamState} state */
async function startMpegtsStream(state, cameraId, qualityId, source, quality) {
  destroyOutputStream(state);
  state.outputStream = new PassThrough({ highWaterMark: 1024 * 512 });
  state.outputStream.on("data", (chunk) => broadcast(state, chunk));

  const tryStart = (transcode) =>
    launchFfmpeg(
      state,
      buildFfmpeg(source, cameraId, qualityId, {
        mode: "mpegts",
        transcode,
        quality,
      }),
      { output: state.outputStream },
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

/** @param {QualityStreamState} state */
async function startHlsStream(state, cameraId, qualityId, source, quality) {
  await rm(hlsDir(cameraId, qualityId), { recursive: true, force: true });
  await mkdir(hlsDir(cameraId, qualityId), { recursive: true });

  const startWith = async (transcode) =>
    launchFfmpeg(
      state,
      buildFfmpeg(source, cameraId, qualityId, {
        mode: "hls",
        transcode,
        quality,
      }),
    );

  if (quality.transcodePolicy === "transcode") {
    await startWith(true);
    state.transcodeMode = true;
    await waitForPlaylist(cameraId, qualityId);
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

  await waitForPlaylist(cameraId, qualityId);
}

/** @param {QualityStreamState} state */
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

function mpegtsWsUrl(cameraId, qualityId) {
  return `/cameras/${cameraId}/stream/ws?quality=${encodeURIComponent(qualityId)}`;
}

function resolveMpegtsPlayUrl(cameraId, qualityId, clientContext) {
  const wsPath = mpegtsWsUrl(cameraId, qualityId);
  const publicBase = resolvePublicWsBaseUrl(clientContext)?.replace(/\/$/, "");
  if (publicBase) {
    return `${publicBase}${wsPath}`;
  }
  return wsPath;
}

/** @param {ReturnType<typeof findCameraById>} camera @param {StreamQualityId} qualityId */
function resolveMtxPathName(camera, qualityId) {
  return resolveQualityPath(camera.mediamtx_path, qualityId);
}

/** @param {QualityStreamState} state @param {ReturnType<typeof findCameraById>} camera @param {StreamQualityId} qualityId */
function getStreamQualityState(state, camera, qualityId) {
  const preset = getStreamQualityPreset(qualityId);
  return {
    quality: qualityId,
    label: preset.label,
    description: preset.description,
    options: listStreamQualityOptionsForCamera(camera),
  };
}

/** @param {number} cameraId @param {StreamQualityId} qualityId @param {import('../utils/webrtc-client-url.js').ClientContext} [clientContext] */
export function getStreamStatus(cameraId, clientContext, qualityId) {
  const camera = findCameraById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }

  const resolvedQuality = resolveCameraQualityId(camera, qualityId);
  const state = getOrCreateQualityState(cameraId, resolvedQuality);
  const streaming = isStreaming(state);
  const qualityState = getStreamQualityState(state, camera, resolvedQuality);
  const mtxPath = resolveMtxPathName(camera, resolvedQuality);

  if (state.localFallback) {
    const wsUrl = resolveMpegtsPlayUrl(
      cameraId,
      resolvedQuality,
      clientContext,
    );
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
      mediamtx_path: mtxPath,
      ...qualityState,
    };
  }

  if (config.streamMode === "webrtc") {
    const whepUrl = getWhepUrl(mtxPath, clientContext);
    const rtspConfigured = Boolean(state.currentRtspUrl);
    const pushEnabled = isRtspPushEnabled();
    return {
      streaming,
      mode: "webrtc",
      rtsp_configured: rtspConfigured,
      stream_type: "webrtc",
      stream_url: getWebRtcPageUrl(mtxPath, clientContext),
      whep_url: rtspConfigured || state.mtxActive ? whepUrl : null,
      mediamtx_path: mtxPath,
      mtx_registered: state.mtxActive,
      rtsp_push: pushEnabled,
      mtx_publishing: pushEnabled && state.ffmpegProcess !== null,
      fallback: false,
      ...qualityState,
    };
  }

  if (config.streamMode === "hls") {
    const playlist = hlsPlaylistUrl(cameraId, resolvedQuality);
    return {
      streaming,
      mode: "hls",
      rtsp_configured: Boolean(state.currentRtspUrl),
      transcode: state.transcodeMode,
      stream_type: "hls",
      stream_url: playlist,
      playlist: streaming ? playlist : null,
      mediamtx_path: mtxPath,
      ...qualityState,
    };
  }

  const wsUrl = mpegtsWsUrl(cameraId, resolvedQuality);
  return {
    streaming,
    mode: "mpegts",
    rtsp_configured: Boolean(state.currentRtspUrl),
    transcode: state.transcodeMode,
    stream_type: "mpegts",
    stream_url: wsUrl,
    ws_url: streaming ? wsUrl : null,
    mediamtx_path: mtxPath,
    ...qualityState,
  };
}

async function startQualityStreamInternal(cameraId, qualityId, clientContext) {
  const camera = findCameraById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }

  const resolvedQuality = resolveCameraQualityId(camera, qualityId);
  const state = getOrCreateQualityState(cameraId, resolvedQuality);
  const mtxPath = resolveMtxPathName(camera, resolvedQuality);
  state.mtxPathName = mtxPath;
  state.idleSince = null;

  if (state.startingPromise) {
    await state.startingPromise;
    if (isStreaming(state)) {
      return {
        ok: true,
        alreadyRunning: true,
        ...getStreamStatus(cameraId, clientContext, resolvedQuality),
      };
    }
  }

  if (isStreaming(state)) {
    return {
      ok: true,
      alreadyRunning: true,
      ...getStreamStatus(cameraId, clientContext, resolvedQuality),
    };
  }

  const quality = getStreamQualityPreset(resolvedQuality);
  const source = await resolveRtspUrl(cameraId, quality.subtype);
  if (!source) {
    throw new Error("Không tìm thấy RTSP URL cho camera");
  }

  state.currentRtspUrl = source;

  const startTask = async () => {
    if (config.streamMode === "webrtc") {
      state.localFallback = false;

      if (isRtspPushEnabled()) {
        if (!ffmpegPath) {
          throw new Error(
            `Cần ffmpeg để push RTSP lên MediaMTX. ${getFfmpegInstallHint()}`,
          );
        }

        try {
          await ensurePathPublisher(mtxPath);
          state.mtxActive = true;
          await startRtspPushStream(state, source, mtxPath, quality);
          await waitPathOnline(mtxPath, 20_000);
        } catch (err) {
          console.warn(
            `[stream] RTSP push failed camera ${cameraId} quality ${resolvedQuality}:`,
            err instanceof Error ? err.message : err,
          );
          await stopFfmpegProcess(state);
          if (state.mtxActive) {
            try {
              await clearPathSource(mtxPath);
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
          await ensurePathSource(mtxPath, source);
          state.mtxActive = true;
        } catch (err) {
          console.warn(
            `[stream] MediaMTX path register failed camera ${cameraId} quality ${resolvedQuality}:`,
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
        await startHlsStream(state, cameraId, resolvedQuality, source, quality);
      } else {
        await startMpegtsStream(
          state,
          cameraId,
          resolvedQuality,
          source,
          quality,
        );
      }
    }
  };

  state.startingPromise = startTask();
  try {
    await state.startingPromise;
  } finally {
    state.startingPromise = null;
  }

  return {
    ok: true,
    alreadyRunning: false,
    ...getStreamStatus(cameraId, clientContext, resolvedQuality),
  };
}

export async function startCameraStream(cameraId, clientContext, qualityId) {
  return startQualityStreamInternal(cameraId, qualityId, clientContext);
}

async function startLocalMpegtsFallback(
  state,
  cameraId,
  qualityId,
  source,
  quality,
) {
  if (!ffmpegPath) {
    throw new Error(
      `MediaMTX không khả dụng và không tìm thấy ffmpeg để relay local. ${getFfmpegInstallHint()}`,
    );
  }
  await startMpegtsStream(state, cameraId, qualityId, source, quality);
  state.localFallback = true;
  state.mtxActive = false;
}

async function activateLocalMpegtsFallback(
  state,
  camera,
  cameraId,
  qualityId,
  source,
  quality,
) {
  const mtxPath = resolveMtxPathName(camera, qualityId);
  if (state.mtxActive) {
    try {
      await clearPathSource(mtxPath);
    } catch {
      /* path có thể chưa tồn tại */
    }
    state.mtxActive = false;
  }
  await stopFfmpegProcess(state);
  await startLocalMpegtsFallback(state, cameraId, qualityId, source, quality);
}

/** @param {number} cameraId @param {StreamQualityId} qualityId */
export async function stopQualityStream(cameraId, qualityId) {
  const camera = findCameraById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }

  const resolvedQuality = resolveStreamQualityId(qualityId);
  const byQuality = streams.get(cameraId);
  const state = byQuality?.get(resolvedQuality);
  if (!state) {
    return { ok: true, stopped: false, quality: resolvedQuality };
  }

  state.idleSince = null;
  const mtxPath =
    state.mtxPathName || resolveMtxPathName(camera, resolvedQuality);

  if (state.localFallback) {
    if (!state.ffmpegProcess) {
      state.localFallback = false;
      state.currentRtspUrl = null;
      byQuality.delete(resolvedQuality);
      if (byQuality.size === 0) streams.delete(cameraId);
      return { ok: true, stopped: false, quality: resolvedQuality };
    }

    clearWsClients(state);
    clearHttpClients(state);

    await new Promise((resolve) => {
      const proc = state.ffmpegProcess;
      state.ffmpegProcess = null;
      state.localFallback = false;
      state.currentRtspUrl = null;
      state.transcodeMode = false;
      state.mtxPathName = null;
      destroyOutputStream(state);

      proc.on("end", () => resolve());
      proc.kill("SIGTERM");
      setTimeout(() => resolve(), 2000);
    });

    byQuality.delete(resolvedQuality);
    if (byQuality.size === 0) streams.delete(cameraId);
    return { ok: true, stopped: true, quality: resolvedQuality };
  }

  if (config.streamMode === "webrtc") {
    const hadPush = state.ffmpegProcess !== null;
    const hadMtx = state.mtxActive;

    if (!hadPush && !hadMtx) {
      byQuality.delete(resolvedQuality);
      if (byQuality.size === 0) streams.delete(cameraId);
      return { ok: true, stopped: false, quality: resolvedQuality };
    }

    if (hadPush) {
      await stopFfmpegProcess(state);
    }

    if (hadMtx) {
      try {
        await clearPathSource(mtxPath);
      } catch {
        /* path có thể đã bị xóa */
      }
      state.mtxActive = false;
    }

    state.currentRtspUrl = null;
    state.mtxPathName = null;
    byQuality.delete(resolvedQuality);
    if (byQuality.size === 0) streams.delete(cameraId);
    return { ok: true, stopped: true, quality: resolvedQuality };
  }

  if (!state.ffmpegProcess) {
    byQuality.delete(resolvedQuality);
    if (byQuality.size === 0) streams.delete(cameraId);
    return { ok: true, stopped: false, quality: resolvedQuality };
  }

  clearWsClients(state);
  clearHttpClients(state);

  await new Promise((resolve) => {
    const proc = state.ffmpegProcess;
    state.ffmpegProcess = null;
    state.currentRtspUrl = null;
    state.transcodeMode = false;
    state.mtxPathName = null;
    destroyOutputStream(state);

    proc.on("end", () => resolve());
    proc.kill("SIGTERM");
    setTimeout(() => resolve(), 2000);
  });

  byQuality.delete(resolvedQuality);
  if (byQuality.size === 0) streams.delete(cameraId);
  return { ok: true, stopped: true, quality: resolvedQuality };
}

export async function stopCameraStream(cameraId, qualityId) {
  if (qualityId) {
    return stopQualityStream(cameraId, qualityId);
  }

  const byQuality = streams.get(cameraId);
  if (!byQuality || byQuality.size === 0) {
    return { ok: true, stopped: false };
  }

  for (const q of [...byQuality.keys()]) {
    await stopQualityStream(cameraId, q);
  }
  return { ok: true, stopped: true };
}

export async function restartCameraStream(cameraId, clientContext, qualityId) {
  const camera = findCameraById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }
  const resolvedQuality = resolveCameraQualityId(camera, qualityId);
  await stopQualityStream(cameraId, resolvedQuality);
  return startQualityStreamInternal(cameraId, resolvedQuality, clientContext);
}

export async function forceCameraStreamFallback(
  cameraId,
  clientContext,
  qualityId,
) {
  const camera = findCameraById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }

  const resolvedQuality = resolveCameraQualityId(camera, qualityId);
  const state = getOrCreateQualityState(cameraId, resolvedQuality);
  const quality = getStreamQualityPreset(resolvedQuality);
  const source =
    state.currentRtspUrl || (await resolveRtspUrl(cameraId, quality.subtype));
  if (!source) {
    throw new Error("Không tìm thấy RTSP URL cho camera");
  }

  state.currentRtspUrl = source;
  state.mtxPathName = resolveMtxPathName(camera, resolvedQuality);

  if (state.localFallback && state.ffmpegProcess) {
    return {
      ok: true,
      alreadyRunning: true,
      ...getStreamStatus(cameraId, clientContext, resolvedQuality),
    };
  }

  if (state.mtxActive || state.ffmpegProcess) {
    await stopFfmpegProcess(state);
    if (state.mtxActive) {
      try {
        await clearPathSource(state.mtxPathName);
      } catch {
        /* ignore */
      }
      state.mtxActive = false;
    }
  }

  await activateLocalMpegtsFallback(
    state,
    camera,
    cameraId,
    resolvedQuality,
    source,
    quality,
  );

  return {
    ok: true,
    alreadyRunning: false,
    ...getStreamStatus(cameraId, clientContext, resolvedQuality),
  };
}

export async function setStreamQuality(cameraId, qualityId, clientContext) {
  const camera = findCameraById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }

  const resolvedQuality = resolveCameraQualityId(camera, qualityId);
  const streamResult = await startQualityStreamInternal(
    cameraId,
    resolvedQuality,
    clientContext,
  );

  return {
    ...getStreamQualityState(
      getOrCreateQualityState(cameraId, resolvedQuality),
      camera,
      resolvedQuality,
    ),
    ...streamResult,
  };
}

export function addWsClient(cameraId, socket, qualityId) {
  const camera = findCameraById(cameraId);
  if (!camera) {
    socket.close(1008, "Không tìm thấy camera");
    return;
  }

  const resolvedQuality = resolveCameraQualityId(camera, qualityId);
  const state = getOrCreateQualityState(cameraId, resolvedQuality);
  const mpegtsAllowed =
    config.streamMode === "mpegts" ||
    state.localFallback ||
    state.outputStream !== null;

  if (!isStreaming(state) || !mpegtsAllowed) {
    socket.close(1013, "Stream chưa chạy");
    return;
  }

  state.idleSince = null;
  state.wsClients.add(socket);
  socket.on("close", () => state.wsClients.delete(socket));
  socket.on("error", () => state.wsClients.delete(socket));
}

export async function attachMpegTsClient(cameraId, reply, request, qualityId) {
  const camera = findCameraById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }

  const resolvedQuality = resolveCameraQualityId(camera, qualityId);
  const clientContext = clientContextFromRequest(request);
  const state = getOrCreateQualityState(cameraId, resolvedQuality);

  if (!isStreaming(state)) {
    await startQualityStreamInternal(cameraId, resolvedQuality, clientContext);
  }

  const res = reply.raw;
  state.idleSince = null;
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
  });
}

export async function ensureMpegtsRelayStream(cameraId) {
  const camera = findCameraById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }

  const qualityId = "mobile";
  const state = getOrCreateQualityState(cameraId, qualityId);
  const wsUrl = mpegtsWsUrl(cameraId, qualityId);

  if (state.outputStream && state.ffmpegProcess) {
    return {
      ok: true,
      streaming: true,
      stream_type: "mpegts",
      ws_url: wsUrl,
      stream_url: wsUrl,
      relay: true,
      quality: qualityId,
    };
  }

  const quality = getStreamQualityPreset(qualityId);
  const source =
    state.currentRtspUrl || (await resolveRtspUrl(cameraId, quality.subtype));
  if (!source) {
    throw new Error("Không tìm thấy RTSP URL cho camera");
  }

  state.currentRtspUrl = source;
  if (!ffmpegPath) {
    throw new Error(`Không tìm thấy ffmpeg binary. ${getFfmpegInstallHint()}`);
  }

  await startMpegtsStream(state, cameraId, qualityId, source, quality);

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

export function getStreamQualityForCamera(cameraId, qualityId) {
  const camera = findCameraById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }
  const resolvedQuality = resolveCameraQualityId(camera, qualityId);
  const state = getOrCreateQualityState(cameraId, resolvedQuality);
  return getStreamQualityState(state, camera, resolvedQuality);
}

export function getStreamInfo(cameraId, clientContext, qualityId) {
  return getStreamStatus(cameraId, clientContext, qualityId);
}

export function getLifecycleTargets() {
  /** @type {Array<{ cameraId: number, qualityId: StreamQualityId, state: QualityStreamState, mtxPathName: string | null }>} */
  const targets = [];

  for (const [cameraId, byQuality] of streams) {
    for (const [qualityId, state] of byQuality) {
      if (!isStreaming(state)) continue;
      targets.push({
        cameraId,
        qualityId,
        state,
        mtxPathName: state.mtxPathName,
      });
    }
  }

  return targets;
}

export function stopAllStreams() {
  for (const cameraId of [...streams.keys()]) {
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
  } else {
    ensureHlsRoot();
  }

  const { startStreamLifecyclePoller } =
    await import("./stream-lifecycle.service.js");
  startStreamLifecyclePoller();
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

export { clientContextFromRequest };
