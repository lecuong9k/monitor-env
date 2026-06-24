import { access, mkdir, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";
import { config, resolveStreamScope } from "../config.js";
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
  getCentralRtspPublishUrl,
  getLocalRtspUrl,
  getWebRtcPageUrl,
  getWhepUrl,
  isCentralRelayEnabled,
  resolveQualityPath,
  waitPathOnline,
} from "./mediamtx.service.js";
import { clientContextFromRequest } from "../utils/webrtc-client-url.js";

/**
 * @typedef {import('../../config/stream-quality.js').StreamQualityId} StreamQualityId
 * @typedef {import('../config.js').StreamScope} StreamScope
 * @typedef {{
 *   ffmpegRelayProcess: import('fluent-ffmpeg').FfmpegCommand | null;
 *   ffmpegProcess: import('fluent-ffmpeg').FfmpegCommand | null;
 *   currentRtspUrl: string | null;
 *   qualityId: StreamQualityId;
 *   transcodeMode: boolean;
 *   localMtxActive: boolean;
 *   centralRelayActive: boolean;
 *   localViewerCount: number;
 *   remoteViewerCount: number;
 *   activePublishTargets: { local: boolean; central: boolean };
 *   mtxPathName: string | null;
 *   startingPromise: Promise<void> | null;
 *   idleSince: number | null;
 *   centralIdleSince: number | null;
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
    ffmpegRelayProcess: null,
    ffmpegProcess: null,
    currentRtspUrl: null,
    qualityId,
    transcodeMode: false,
    localMtxActive: false,
    centralRelayActive: false,
    localViewerCount: 0,
    remoteViewerCount: 0,
    activePublishTargets: { local: false, central: false },
    mtxPathName: null,
    startingPromise: null,
    idleSince: null,
    centralIdleSince: null,
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

  if (mode === "hls") {
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

  return cmd;
}

/** @param {string} source @param {string[]} publishUrls @param {ReturnType<typeof getStreamQualityPreset>} quality */
function buildMultiPublishFfmpeg(source, publishUrls, quality) {
  if (!publishUrls.length) {
    throw new Error("Thiếu URL publish MediaMTX");
  }

  const inputOptions =
    INPUT_PROFILES[quality.inputProfile] ?? INPUT_PROFILES.lowLatency;
  const cmd = ffmpeg(source).inputOptions(inputOptions).noAudio();
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

  const rtspOut = ["-f", "rtsp", "-rtsp_transport", "tcp"];
  cmd.output(publishUrls[0]).outputOptions(rtspOut);
  for (let i = 1; i < publishUrls.length; i++) {
    cmd.output(publishUrls[i]).outputOptions(rtspOut);
  }

  return cmd;
}

/** @param {QualityStreamState} state */
function getPublishTargets(state) {
  return {
    local: state.localViewerCount > 0,
    central: state.remoteViewerCount > 0 && isCentralRelayEnabled(),
  };
}

/** @param {{ local: boolean; central: boolean }} a @param {{ local: boolean; central: boolean }} b */
function publishTargetsEqual(a, b) {
  return a.local === b.local && a.central === b.central;
}

/** @param {QualityStreamState} state @param {string} mtxPath */
async function stopFfmpegIngest(state, mtxPath) {
  await stopFfmpegField(state, "ffmpegProcess");

  const active = state.activePublishTargets;
  if (active.local) {
    try {
      await clearPathSource("local", mtxPath);
    } catch {
      /* ignore */
    }
  }
  if (active.central) {
    try {
      await clearPathSource("central", mtxPath);
    } catch {
      /* ignore */
    }
  }

  state.activePublishTargets = { local: false, central: false };
  state.localMtxActive = false;
  state.centralRelayActive = false;
  state.transcodeMode = false;
  state.centralIdleSince = null;
}

/**
 * On-demand: chỉ publish tới MTX có viewer; restart khi tập đích thay đổi.
 * @param {QualityStreamState} state
 * @param {string} mtxPath
 * @param {string} cameraRtsp
 * @param {ReturnType<typeof getStreamQualityPreset>} quality
 */
async function syncFfmpegIngest(state, mtxPath, cameraRtsp, quality) {
  if (!ffmpegPath) {
    throw new Error(`Không tìm thấy ffmpeg binary. ${getFfmpegInstallHint()}`);
  }

  if (state.remoteViewerCount > 0 && !isCentralRelayEnabled()) {
    throw new Error("MEDIAMTX_CENTRAL_RTSP_PUBLISH_URL chưa cấu hình");
  }

  const desired = getPublishTargets(state);
  const active = state.activePublishTargets;

  if (!desired.local && !desired.central) {
    await stopFfmpegIngest(state, mtxPath);
    return;
  }

  if (publishTargetsEqual(desired, active) && state.ffmpegProcess) {
    return;
  }

  await stopFfmpegField(state, "ffmpegProcess");

  if (active.local && !desired.local) {
    try {
      await clearPathSource("local", mtxPath);
    } catch {
      /* ignore */
    }
  }
  if (active.central && !desired.central) {
    try {
      await clearPathSource("central", mtxPath);
    } catch {
      /* ignore */
    }
  }

  /** @type {string[]} */
  const publishUrls = [];
  if (desired.local) {
    await ensurePathPublisher("local", mtxPath);
    publishUrls.push(getLocalRtspUrl(mtxPath));
  }
  if (desired.central) {
    await ensurePathPublisher("central", mtxPath);
    publishUrls.push(getCentralRtspPublishUrl(mtxPath));
  }

  await launchFfmpeg(
    state,
    buildMultiPublishFfmpeg(cameraRtsp, publishUrls, quality),
    "ffmpegProcess",
  );

  if (desired.local) {
    await waitPathOnline("local", mtxPath, 20_000);
  }
  if (desired.central) {
    await waitPathOnline("central", mtxPath, 20_000);
  }

  state.activePublishTargets = { ...desired };
  state.localMtxActive = desired.local;
  state.centralRelayActive = desired.central;
  state.transcodeMode = true;
  state.centralIdleSince = null;
}

/** @param {QualityStreamState} state @param {import('fluent-ffmpeg').FfmpegCommand} cmd */
function launchFfmpeg(state, cmd, field = "ffmpegRelayProcess") {
  return new Promise((resolveStart, reject) => {
    state[field] = cmd
      .on("start", () => resolveStart())
      .on("error", (err) => {
        state[field] = null;
        reject(err);
      })
      .on("end", () => {
        state[field] = null;
      })
      .run();
  });
}

/** @param {QualityStreamState} state @param {'ffmpegRelayProcess' | 'ffmpegProcess'} field */
async function stopFfmpegField(state, field) {
  if (!state[field]) return;

  const proc = state[field];
  state[field] = null;
  if (field === "ffmpegRelayProcess") {
    state.transcodeMode = false;
  }

  await new Promise((resolve) => {
    proc.on("end", () => resolve());
    proc.kill("SIGTERM");
    setTimeout(() => resolve(), 2000);
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
      "ffmpegProcess",
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
  return state.ffmpegProcess !== null;
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

/**
 * @param {number} cameraId
 * @param {import('../utils/webrtc-client-url.js').ClientContext} [clientContext]
 * @param {StreamQualityId} [qualityId]
 * @param {StreamScope} [scope]
 */
export function getStreamStatus(
  cameraId,
  clientContext,
  qualityId,
  scope = "local",
) {
  const camera = findCameraById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }

  const resolvedQuality = resolveCameraQualityId(camera, qualityId);
  const state = getOrCreateQualityState(cameraId, resolvedQuality);
  const streaming = isStreaming(state);
  const qualityState = getStreamQualityState(state, camera, resolvedQuality);
  const mtxPath = resolveMtxPathName(camera, resolvedQuality);
  const resolvedScope = resolveStreamScope(scope);
  const mtxTarget = resolvedScope === "remote" ? "central" : "local";

  if (config.streamMode === "webrtc") {
    const whepUrl = getWhepUrl(mtxPath, mtxTarget, clientContext);
    return {
      streaming,
      scope: resolvedScope,
      mode: "webrtc",
      rtsp_configured: Boolean(state.currentRtspUrl),
      transcode: state.transcodeMode,
      stream_type: "webrtc",
      stream_url: getWebRtcPageUrl(mtxPath, mtxTarget, clientContext),
      whep_url: streaming ? whepUrl : null,
      mediamtx_path: mtxPath,
      local_mtx_active: state.localMtxActive,
      central_relay_active: state.centralRelayActive,
      local_viewers: state.localViewerCount,
      remote_viewers: state.remoteViewerCount,
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

  return {
    streaming: false,
    mode: "webrtc",
    stream_type: "webrtc",
    mediamtx_path: mtxPath,
    ...qualityState,
  };
}

/**
 * @param {number} cameraId
 * @param {StreamQualityId} qualityId
 * @param {import('../utils/webrtc-client-url.js').ClientContext} clientContext
 * @param {{ scope?: StreamScope }} [options]
 */
async function startQualityStreamInternal(
  cameraId,
  qualityId,
  clientContext,
  options = {},
) {
  const camera = findCameraById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }

  const scope = resolveStreamScope(options.scope);
  const resolvedQuality = resolveCameraQualityId(camera, qualityId);
  const state = getOrCreateQualityState(cameraId, resolvedQuality);
  const mtxPath = resolveMtxPathName(camera, resolvedQuality);
  state.mtxPathName = mtxPath;
  state.idleSince = null;

  if (scope === "local") {
    state.localViewerCount += 1;
  } else {
    state.remoteViewerCount += 1;
  }

  if (state.startingPromise) {
    await state.startingPromise;
    if (config.streamMode === "webrtc" && state.currentRtspUrl) {
      await syncFfmpegIngest(state, mtxPath, state.currentRtspUrl, quality);
    }
    return {
      ok: true,
      alreadyRunning: true,
      ...getStreamStatus(cameraId, clientContext, resolvedQuality, scope),
    };
  }

  const quality = getStreamQualityPreset(resolvedQuality);
  const source = await resolveRtspUrl(cameraId, quality.subtype);
  if (!source) {
    if (scope === "local") {
      state.localViewerCount = Math.max(0, state.localViewerCount - 1);
    } else {
      state.remoteViewerCount = Math.max(0, state.remoteViewerCount - 1);
    }
    throw new Error("Không tìm thấy RTSP URL cho camera");
  }

  state.currentRtspUrl = source;

  const startTask = async () => {
    if (config.streamMode === "webrtc") {
      await syncFfmpegIngest(state, mtxPath, source, quality);
      return;
    }

    if (!ffmpegPath) {
      throw new Error(
        `Không tìm thấy ffmpeg binary. ${getFfmpegInstallHint()}`,
      );
    }

    if (config.streamMode === "hls") {
      await startHlsStream(state, cameraId, resolvedQuality, source, quality);
    }
  };

  state.startingPromise = startTask();
  try {
    await state.startingPromise;
  } catch (err) {
    if (scope === "local") {
      state.localViewerCount = Math.max(0, state.localViewerCount - 1);
    } else {
      state.remoteViewerCount = Math.max(0, state.remoteViewerCount - 1);
    }
    throw err;
  } finally {
    state.startingPromise = null;
  }

  return {
    ok: true,
    alreadyRunning: false,
    ...getStreamStatus(cameraId, clientContext, resolvedQuality, scope),
  };
}

export async function startCameraStream(
  cameraId,
  clientContext,
  qualityId,
  options = {},
) {
  return startQualityStreamInternal(
    cameraId,
    qualityId,
    clientContext,
    options,
  );
}

/**
 * @param {number} cameraId
 * @param {StreamQualityId} qualityId
 * @param {{ scope?: StreamScope }} [options]
 */
export async function stopQualityStream(cameraId, qualityId, options = {}) {
  const camera = findCameraById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }

  const scope = resolveStreamScope(options.scope);
  const resolvedQuality = resolveStreamQualityId(qualityId);
  const byQuality = streams.get(cameraId);
  const state = byQuality?.get(resolvedQuality);
  if (!state) {
    return { ok: true, stopped: false, quality: resolvedQuality, scope };
  }

  state.idleSince = null;
  const mtxPath =
    state.mtxPathName || resolveMtxPathName(camera, resolvedQuality);

  if (scope === "remote") {
    state.remoteViewerCount = Math.max(0, state.remoteViewerCount - 1);
  } else {
    state.localViewerCount = Math.max(0, state.localViewerCount - 1);
  }

  const quality = getStreamQualityPreset(resolvedQuality);
  if (config.streamMode === "webrtc" && state.currentRtspUrl) {
    await syncFfmpegIngest(state, mtxPath, state.currentRtspUrl, quality);
  }

  if (state.localViewerCount === 0 && state.remoteViewerCount === 0) {
    if (!isStreaming(state)) {
      state.currentRtspUrl = null;
      state.mtxPathName = null;
      byQuality.delete(resolvedQuality);
      if (byQuality.size === 0) streams.delete(cameraId);
    }
    return { ok: true, stopped: true, quality: resolvedQuality, scope };
  }

  return { ok: true, stopped: false, quality: resolvedQuality, scope };
}

export async function stopCameraStream(cameraId, qualityId, options = {}) {
  if (qualityId) {
    return stopQualityStream(cameraId, qualityId, options);
  }

  const byQuality = streams.get(cameraId);
  if (!byQuality || byQuality.size === 0) {
    return { ok: true, stopped: false };
  }

  for (const q of [...byQuality.keys()]) {
    await stopQualityStream(cameraId, q, options);
  }
  return { ok: true, stopped: true };
}

export async function restartCameraStream(
  cameraId,
  clientContext,
  qualityId,
  options = {},
) {
  const camera = findCameraById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }
  const resolvedQuality = resolveCameraQualityId(camera, qualityId);
  const scope = resolveStreamScope(options.scope);
  await stopQualityStream(cameraId, resolvedQuality, { scope });
  return startQualityStreamInternal(cameraId, resolvedQuality, clientContext, {
    scope,
  });
}

/**
 * @param {number} cameraId
 * @param {StreamQualityId} qualityId
 * @param {import('../utils/webrtc-client-url.js').ClientContext} clientContext
 * @param {{ scope?: StreamScope, previousQualityId?: StreamQualityId }} [options]
 */
export async function setStreamQuality(
  cameraId,
  qualityId,
  clientContext,
  options = {},
) {
  const camera = findCameraById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }

  const scope = resolveStreamScope(options.scope);
  const resolvedQuality = resolveCameraQualityId(camera, qualityId);
  const previousRaw = options.previousQualityId;
  if (previousRaw) {
    const resolvedPrevious = resolveCameraQualityId(camera, previousRaw);
    if (resolvedPrevious !== resolvedQuality) {
      await stopQualityStream(cameraId, resolvedPrevious, { scope });
    }
  }

  const streamResult = await startQualityStreamInternal(
    cameraId,
    resolvedQuality,
    clientContext,
    { scope },
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

export function getStreamQualityForCamera(cameraId, qualityId) {
  const camera = findCameraById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }
  const resolvedQuality = resolveCameraQualityId(camera, qualityId);
  const state = getOrCreateQualityState(cameraId, resolvedQuality);
  return getStreamQualityState(state, camera, resolvedQuality);
}

export function getStreamInfo(cameraId, clientContext, qualityId, scope) {
  return getStreamStatus(cameraId, clientContext, qualityId, scope);
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

/**
 * Dọn ingest mồ côi: viewer count = 0 nhưng pipeline vẫn chạy.
 * @param {number} cameraId
 * @param {StreamQualityId} qualityId
 */
export async function cleanupOrphanQualityStream(cameraId, qualityId) {
  const camera = findCameraById(cameraId);
  if (!camera) return { ok: true, cleaned: false };

  const byQuality = streams.get(cameraId);
  const resolvedQuality = resolveStreamQualityId(qualityId);
  const state = byQuality?.get(resolvedQuality);
  if (!state) return { ok: true, cleaned: false };
  if (state.localViewerCount > 0 || state.remoteViewerCount > 0) {
    return { ok: true, cleaned: false };
  }
  if (!isStreaming(state)) return { ok: true, cleaned: false };

  const mtxPath =
    state.mtxPathName || resolveMtxPathName(camera, resolvedQuality);
  state.idleSince = null;
  state.centralIdleSince = null;

  await stopFfmpegIngest(state, mtxPath);

  state.currentRtspUrl = null;
  state.mtxPathName = null;
  byQuality.delete(resolvedQuality);
  if (byQuality.size === 0) streams.delete(cameraId);

  console.log(
    `[stream] Orphan cleanup camera ${cameraId} quality ${resolvedQuality}`,
  );
  return { ok: true, cleaned: true, quality: resolvedQuality };
}

export function stopAllStreams() {
  for (const cameraId of [...streams.keys()]) {
    void stopCameraStream(cameraId, undefined, { scope: "local" });
    void stopCameraStream(cameraId, undefined, { scope: "remote" });
  }
}

export async function initStreamService() {
  if (config.streamMode === "webrtc") {
    try {
      await checkMediamtxAvailable("local");
    } catch (err) {
      console.warn(
        "[stream] MediaMTX local API unavailable at startup:",
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
