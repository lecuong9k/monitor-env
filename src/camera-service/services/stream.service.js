import { access, mkdir, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
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
  ensurePathSource,
  getCentralRtspPublishUrl,
  getLocalRtspUrl,
  getWebRtcPageUrl,
  getWhepUrl,
  isCentralRelayEnabled,
  resolveQualityPath,
  waitPathOnline,
} from "./mediamtx.service.js";
import { clientContextFromRequest } from "../utils/webrtc-client-url.js";
import { resolveActiveVideoEncoder } from "../utils/ffmpeg-encoder.js";
import {
  applyAudioOutput,
  applyVideoOutput,
  getFallbackEncoder,
} from "../utils/ffmpeg-output.js";
import { probeRtspStream } from "../utils/rtsp-probe.js";

function usesMtxDirectIngest() {
  return config.streamLocalIngestMode === "mediamtx";
}

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
 *   localViewers: Map<string, { lastSeenAt: number }>;
 *   remoteViewers: Map<string, { lastSeenAt: number }>;
 *   primaryActive: boolean;
 *   relayActive: boolean;
 *   mtxPathName: string | null;
 *   startingPromise: Promise<void> | null;
 *   syncPromise: Promise<void> | null;
 *   idleSince: number | null;
 *   centralIdleSince: number | null;
 *   readerGhostSince: number | null;
 *   streamProbe: import('../utils/rtsp-probe.js').RtspStreamProbe | null;
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
    localViewers: new Map(),
    remoteViewers: new Map(),
    primaryActive: false,
    relayActive: false,
    mtxPathName: null,
    startingPromise: null,
    syncPromise: null,
    idleSince: null,
    centralIdleSince: null,
    readerGhostSince: null,
    streamProbe: null,
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

/** @param {QualityStreamState} state @param {import('../config.js').StreamScope} scope */
function viewersForScope(state, scope) {
  return scope === "remote" ? state.remoteViewers : state.localViewers;
}

/** @param {QualityStreamState} state */
function syncViewerCounts(state) {
  state.localViewerCount = state.localViewers.size;
  state.remoteViewerCount = state.remoteViewers.size;
}

/** @param {string | undefined | null} raw */
function normalizeViewerId(raw) {
  const id = String(raw || "").trim();
  if (id.length >= 8 && id.length <= 128) return id;
  return uuidv4();
}

/**
 * @param {QualityStreamState} state
 * @param {import('../config.js').StreamScope} scope
 * @param {string | undefined | null} viewerIdRaw
 */
function registerViewer(state, scope, viewerIdRaw) {
  const map = viewersForScope(state, scope);
  const viewerId = normalizeViewerId(viewerIdRaw);
  const isNew = !map.has(viewerId);
  map.set(viewerId, { lastSeenAt: Date.now() });
  syncViewerCounts(state);
  return { viewerId, isNew };
}

/**
 * @param {QualityStreamState} state
 * @param {import('../config.js').StreamScope} scope
 * @param {string | undefined | null} viewerId
 */
function unregisterViewer(state, scope, viewerId) {
  const map = viewersForScope(state, scope);
  const id = String(viewerId || "").trim();
  if (!id) {
    if (map.size === 0) return false;
    const first = map.keys().next().value;
    map.delete(first);
    syncViewerCounts(state);
    return true;
  }
  const removed = map.delete(id);
  syncViewerCounts(state);
  return removed;
}

/**
 * @param {QualityStreamState} state
 * @param {import('../config.js').StreamScope} scope
 * @param {string} viewerId
 */
function touchViewer(state, scope, viewerId) {
  const map = viewersForScope(state, scope);
  const id = String(viewerId || "").trim();
  if (!id || !map.has(id)) return false;
  map.get(id).lastSeenAt = Date.now();
  return true;
}

/** @param {QualityStreamState} state */
function clearAllViewers(state) {
  state.localViewers.clear();
  state.remoteViewers.clear();
  syncViewerCounts(state);
}

/** @param {QualityStreamState} state @param {number} ttlMs */
function expireStaleViewers(state, ttlMs) {
  const now = Date.now();
  let removed = false;
  for (const map of [state.localViewers, state.remoteViewers]) {
    for (const [id, slot] of map) {
      if (now - slot.lastSeenAt > ttlMs) {
        map.delete(id);
        removed = true;
      }
    }
  }
  if (removed) syncViewerCounts(state);
  return removed;
}

/** @param {QualityStreamState} state */
function hasRegisteredViewers(state) {
  return state.localViewers.size + state.remoteViewers.size > 0;
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
  { mode, transcode, quality, probe, encoder },
) {
  const inputOptions =
    INPUT_PROFILES[quality.inputProfile] ?? INPUT_PROFILES.lowLatency;
  const cmd = ffmpeg(source).inputOptions(inputOptions);

  applyVideoOutput(cmd, { transcode, quality, encoder });
  applyAudioOutput(cmd, { probe });

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

/**
 * @param {string} source
 * @param {string} localRtspUrl
 * @param {ReturnType<typeof getStreamQualityPreset>} quality
 * @param {{ transcode: boolean; probe?: import('../utils/rtsp-probe.js').RtspStreamProbe | null; encoder?: string }} options
 */
function buildLocalPublishFfmpeg(source, localRtspUrl, quality, options) {
  const { transcode, probe = null, encoder } = options;
  const inputOptions =
    INPUT_PROFILES[quality.inputProfile] ?? INPUT_PROFILES.lowLatency;
  const cmd = ffmpeg(source).inputOptions(inputOptions);

  applyVideoOutput(cmd, { transcode, quality, encoder });
  applyAudioOutput(cmd, { probe });
  const outputOpts = ["-f", "rtsp", "-rtsp_transport", "tcp"];
  if (!transcode && probe?.video?.codec === "h264") {
    outputOpts.push("-bsf:v", "h264_mp4toannexb");
  }
  cmd.output(localRtspUrl).outputOptions(outputOpts);

  return cmd;
}

/** @param {string} localRtspUrl @param {string} centralRtspUrl */
function buildCentralRelayFfmpeg(localRtspUrl, centralRtspUrl) {
  return ffmpeg(localRtspUrl)
    .inputOptions(INPUT_PROFILES.stable)
    .outputOptions(["-map", "0:v:0", "-map", "0:a:0?"])
    .videoCodec("copy")
    .audioCodec("copy")
    .output(centralRtspUrl)
    .outputOptions(["-f", "rtsp", "-rtsp_transport", "tcp"]);
}

/** @param {QualityStreamState} state */
function primaryDesired(state) {
  return state.localViewerCount + state.remoteViewerCount > 0;
}

/** @param {QualityStreamState} state */
function relayDesired(state) {
  return state.remoteViewerCount > 0 && isCentralRelayEnabled();
}

/** @param {QualityStreamState} state @param {string} mtxPath */
async function stopCentralRelay(state, mtxPath) {
  await stopFfmpegField(state, "ffmpegRelayProcess");
  if (state.relayActive) {
    try {
      await clearPathSource("central", mtxPath);
    } catch {
      /* ignore */
    }
  }
  state.relayActive = false;
  state.centralRelayActive = false;
  state.centralIdleSince = null;
}

/** @param {QualityStreamState} state @param {string} mtxPath */
async function stopFfmpegIngest(state, mtxPath) {
  await stopCentralRelay(state, mtxPath);
  await stopFfmpegField(state, "ffmpegProcess");
  if (state.primaryActive) {
    try {
      await clearPathSource("local", mtxPath);
    } catch {
      /* ignore */
    }
  }
  state.primaryActive = false;
  state.localMtxActive = false;
  state.transcodeMode = false;
}

/**
 * Local ingest:
 * - mediamtx: Camera RTSP → MediaMTX local (WHEP cho MiniPC UI)
 * - ffmpeg: Camera RTSP → ffmpeg → MediaMTX local (legacy)
 * Remote: syncCentralRelay — ffmpeg copy từ MTX local → MTX central (Dashboard).
 * @param {QualityStreamState} state
 * @param {string} mtxPath
 * @param {string} cameraRtsp
 * @param {ReturnType<typeof getStreamQualityPreset>} quality
 */
async function syncPrimaryIngest(state, mtxPath, cameraRtsp, quality) {
  const mtxDirect = usesMtxDirectIngest();

  if (!primaryDesired(state)) {
    await stopCentralRelay(state, mtxPath);
    await stopFfmpegField(state, "ffmpegProcess");
    if (state.primaryActive) {
      try {
        await clearPathSource("local", mtxPath);
      } catch {
        /* ignore */
      }
    }
    state.primaryActive = false;
    state.localMtxActive = false;
    state.transcodeMode = false;
    return;
  }

  if (state.primaryActive && (state.ffmpegProcess || mtxDirect)) {
    return;
  }
  if (state.primaryActive && !state.ffmpegProcess) {
    state.primaryActive = false;
    state.localMtxActive = false;
  }

  await stopFfmpegField(state, "ffmpegProcess");

  if (mtxDirect) {
    await ensurePathSource("local", mtxPath, cameraRtsp);
    await waitPathOnline("local", mtxPath, 20_000);
    state.primaryActive = true;
    state.localMtxActive = true;
    state.transcodeMode = false;
    return;
  }

  if (!ffmpegPath) {
    throw new Error(`Không tìm thấy ffmpeg binary. ${getFfmpegInstallHint()}`);
  }

  await ensurePathPublisher("local", mtxPath);
  const localUrl = getLocalRtspUrl(mtxPath);
  const probe = await ensureStreamProbe(state, cameraRtsp);

  await startIngestWithPolicy(
    state,
    quality,
    probe,
    (transcode, encoder) =>
      buildLocalPublishFfmpeg(cameraRtsp, localUrl, quality, {
        transcode,
        probe,
        encoder,
      }),
    "ffmpegProcess",
  );

  await waitPathOnline("local", mtxPath, 20_000);
  state.primaryActive = true;
  state.localMtxActive = true;
}

/**
 * Relay copy: local MTX → central MTX khi có remote viewer.
 * @param {QualityStreamState} state
 * @param {string} mtxPath
 */
async function syncCentralRelay(state, mtxPath) {
  if (!ffmpegPath) {
    throw new Error(`Không tìm thấy ffmpeg binary. ${getFfmpegInstallHint()}`);
  }

  if (state.remoteViewerCount > 0 && !isCentralRelayEnabled()) {
    throw new Error("MEDIAMTX_CENTRAL_RTSP_PUBLISH_URL chưa cấu hình");
  }

  if (!relayDesired(state)) {
    await stopCentralRelay(state, mtxPath);
    return;
  }

  if (state.relayActive && state.ffmpegRelayProcess) {
    return;
  }
  if (state.relayActive && !state.ffmpegRelayProcess) {
    state.relayActive = false;
    state.centralRelayActive = false;
  }

  if (!state.primaryActive) {
    await waitPathOnline("local", mtxPath, 20_000);
  } else if (!state.ffmpegProcess && !usesMtxDirectIngest()) {
    await waitPathOnline("local", mtxPath, 20_000);
  }

  await stopFfmpegField(state, "ffmpegRelayProcess");
  await ensurePathPublisher("central", mtxPath);
  const localReadUrl = getLocalRtspUrl(mtxPath);
  const centralUrl = getCentralRtspPublishUrl(mtxPath);
  await launchFfmpeg(
    state,
    buildCentralRelayFfmpeg(localReadUrl, centralUrl),
    "ffmpegRelayProcess",
  );
  await waitPathOnline("central", mtxPath, 20_000);
  state.relayActive = true;
  state.centralRelayActive = true;
  state.centralIdleSince = null;
}

/**
 * @param {QualityStreamState} state
 * @param {string} mtxPath
 * @param {string} cameraRtsp
 * @param {ReturnType<typeof getStreamQualityPreset>} quality
 */
async function syncStreamPipeline(state, mtxPath, cameraRtsp, quality) {
  const run = async () => {
    await syncPrimaryIngest(state, mtxPath, cameraRtsp, quality);
    await syncCentralRelay(state, mtxPath);
  };

  const previous = state.syncPromise ?? Promise.resolve();
  state.syncPromise = previous.then(run, run);
  await state.syncPromise;
}

/** @param {QualityStreamState} state @param {import('fluent-ffmpeg').FfmpegCommand} cmd */
function launchFfmpeg(state, cmd, field = "ffmpegRelayProcess") {
  return new Promise((resolveStart, reject) => {
    state[field] = cmd
      .on("start", () => resolveStart())
      .on("error", (err) => {
        state[field] = null;
        if (field === "ffmpegProcess") {
          state.primaryActive = false;
          state.localMtxActive = false;
        } else if (field === "ffmpegRelayProcess") {
          state.relayActive = false;
          state.centralRelayActive = false;
        }
        reject(err);
      })
      .on("end", () => {
        state[field] = null;
        if (field === "ffmpegProcess") {
          state.primaryActive = false;
          state.localMtxActive = false;
        } else if (field === "ffmpegRelayProcess") {
          state.relayActive = false;
          state.centralRelayActive = false;
        }
      })
      .run();
  });
}

/**
 * @param {QualityStreamState} state
 * @param {string} cameraRtsp
 */
/** @returns {import('../utils/rtsp-probe.js').RtspStreamProbe} */
async function ensureStreamProbe(state, cameraRtsp) {
  if (state.streamProbe && state.currentRtspUrl === cameraRtsp) {
    return state.streamProbe;
  }
  state.streamProbe = await probeRtspStream(cameraRtsp);
  return state.streamProbe;
}

/**
 * @param {QualityStreamState} state
 * @param {import('fluent-ffmpeg').FfmpegCommand} cmd
 * @param {string} encoder
 * @param {'ffmpegProcess' | 'ffmpegRelayProcess'} field
 */
async function launchFfmpegWithEncoderFallback(state, cmd, encoder, field) {
  try {
    await launchFfmpeg(state, cmd, field);
    return encoder;
  } catch (err) {
    const fallback = getFallbackEncoder(encoder);
    if (!fallback) throw err;
    console.warn(
      `[stream] ${encoder} thất bại — retry với ${fallback}:`,
      err instanceof Error ? err.message : err,
    );
    await stopFfmpegField(state, field);
    throw Object.assign(new Error("ENCODER_FALLBACK"), {
      cause: err,
      fallbackEncoder: fallback,
    });
  }
}

/**
 * @param {QualityStreamState} state
 * @param {ReturnType<typeof getStreamQualityPreset>} quality
 * @param {import('../utils/rtsp-probe.js').RtspStreamProbe} probe
 * @param {(transcode: boolean, encoder: string) => import('fluent-ffmpeg').FfmpegCommand} buildCmd
 * @param {'ffmpegProcess' | 'ffmpegRelayProcess'} field
 */
async function startIngestWithPolicy(
  state,
  quality,
  probe,
  buildCmd,
  field = "ffmpegProcess",
) {
  const encoder = resolveActiveVideoEncoder();
  const canTryCopy =
    quality.transcodePolicy === "copyFirst" && probe.videoCopyable;

  const startTranscode = async (activeEncoder) => {
    await launchFfmpegWithEncoderFallback(
      state,
      buildCmd(true, activeEncoder),
      activeEncoder,
      field,
    );
    state.transcodeMode = true;
    return activeEncoder;
  };

  if (quality.transcodePolicy === "transcode" || !canTryCopy) {
    try {
      await startTranscode(encoder);
    } catch (err) {
      if (err instanceof Error && err.message === "ENCODER_FALLBACK") {
        const fallback = /** @type {{ fallbackEncoder: string }} */ (err)
          .fallbackEncoder;
        await startTranscode(fallback);
        return;
      }
      throw err;
    }
    return;
  }

  try {
    await launchFfmpeg(state, buildCmd(false, encoder), field);
    state.transcodeMode = false;
  } catch (copyErr) {
    await stopFfmpegField(state, field);
    console.warn(
      "[stream] Copy stream thất bại — fallback transcode:",
      copyErr instanceof Error ? copyErr.message : copyErr,
    );
    try {
      await startTranscode(encoder);
    } catch (err) {
      if (err instanceof Error && err.message === "ENCODER_FALLBACK") {
        const fallback = /** @type {{ fallbackEncoder: string }} */ (err)
          .fallbackEncoder;
        await startTranscode(fallback);
        return;
      }
      throw err;
    }
  }
}

/** @param {QualityStreamState} state @param {'ffmpegRelayProcess' | 'ffmpegProcess'} field */
async function stopFfmpegField(state, field) {
  if (!state[field]) return;

  const proc = state[field];
  state[field] = null;

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

  const probe = await ensureStreamProbe(state, source);

  await startIngestWithPolicy(
    state,
    quality,
    probe,
    (transcode, encoder) =>
      buildFfmpeg(source, cameraId, qualityId, {
        mode: "hls",
        transcode,
        quality,
        probe,
        encoder,
      }),
    "ffmpegProcess",
  );

  await waitForPlaylist(cameraId, qualityId);
}

/** @param {QualityStreamState} state */
function isStreaming(state) {
  if (config.streamMode === "webrtc") {
    return Boolean(state.primaryActive && state.localMtxActive);
  }
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
  const streaming =
    config.streamMode === "webrtc" && resolveStreamScope(scope) === "remote"
      ? isStreaming(state) && state.centralRelayActive
      : isStreaming(state);
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
      whep_url: whepUrl,
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
  const quality = getStreamQualityPreset(resolvedQuality);
  const state = getOrCreateQualityState(cameraId, resolvedQuality);
  const mtxPath = resolveMtxPathName(camera, resolvedQuality);
  state.mtxPathName = mtxPath;
  state.idleSince = null;

  const { viewerId, isNew } = registerViewer(state, scope, options.viewerId);

  const rollbackViewer = () => {
    unregisterViewer(state, scope, viewerId);
  };

  const buildResult = (extra = {}) => ({
    ok: true,
    viewer_id: viewerId,
    ...extra,
    ...getStreamStatus(cameraId, clientContext, resolvedQuality, scope),
  });

  try {
    if (state.startingPromise) {
      await state.startingPromise;
      if (config.streamMode === "webrtc" && state.currentRtspUrl) {
        await syncStreamPipeline(state, mtxPath, state.currentRtspUrl, quality);
      }
      return buildResult({ alreadyRunning: true });
    }

    if (
      !isNew &&
      config.streamMode === "webrtc" &&
      isStreaming(state) &&
      state.currentRtspUrl
    ) {
      await syncStreamPipeline(state, mtxPath, state.currentRtspUrl, quality);
      return buildResult({ alreadyRunning: true });
    }

    if (
      isNew &&
      config.streamMode === "webrtc" &&
      isStreaming(state) &&
      state.currentRtspUrl
    ) {
      await syncStreamPipeline(state, mtxPath, state.currentRtspUrl, quality);
      return buildResult({ alreadyRunning: true });
    }

    const source = await resolveRtspUrl(cameraId, quality.subtype);
    if (!source) {
      rollbackViewer();
      throw new Error("Không tìm thấy RTSP URL cho camera");
    }

    state.currentRtspUrl = source;

    const startTask = async () => {
      if (config.streamMode === "webrtc") {
        await syncStreamPipeline(state, mtxPath, source, quality);
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
    await state.startingPromise;

    return buildResult({ alreadyRunning: false });
  } catch (err) {
    rollbackViewer();
    throw err;
  } finally {
    state.startingPromise = null;
  }
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

  unregisterViewer(state, scope, options.viewerId);

  const quality = getStreamQualityPreset(resolvedQuality);
  if (config.streamMode === "webrtc" && state.currentRtspUrl) {
    await syncStreamPipeline(state, mtxPath, state.currentRtspUrl, quality);
  }

  if (!hasRegisteredViewers(state)) {
    if (!isStreaming(state)) {
      state.currentRtspUrl = null;
      state.streamProbe = null;
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
  const err = new Error(
    "API stream/restart đã ngừng — dùng stream/status + reconnect WHEP hoặc stream/start",
  );
  err.status = 410;
  throw err;
}

/**
 * @param {number} cameraId
 * @param {StreamQualityId} qualityId
 * @param {{ scope?: StreamScope, viewerId?: string }} [options]
 */
export async function heartbeatCameraStream(cameraId, qualityId, options = {}) {
  const camera = findCameraById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }

  const scope = resolveStreamScope(options.scope);
  const viewerId = String(options.viewerId || "").trim();
  if (!viewerId) {
    throw new Error("Thiếu viewerId");
  }

  const resolvedQuality = resolveCameraQualityId(camera, qualityId);
  const byQuality = streams.get(cameraId);
  const state = byQuality?.get(resolvedQuality);
  if (!state) {
    return { ok: true, touched: false, quality: resolvedQuality, scope };
  }

  if (!touchViewer(state, scope, viewerId)) {
    registerViewer(state, scope, viewerId);
  }

  return {
    ok: true,
    touched: true,
    quality: resolvedQuality,
    scope,
    local_viewers: state.localViewerCount,
    remote_viewers: state.remoteViewerCount,
  };
}

/**
 * Gỡ toàn bộ viewer khi MTX không còn reader (ghost sau tab crash / WHEP đứt).
 * @param {number} cameraId
 * @param {StreamQualityId} qualityId
 * @param {QualityStreamState} state
 * @param {string | null} mtxPathName
 */
export async function expireGhostViewersNoReaders(
  cameraId,
  qualityId,
  state,
  mtxPathName,
) {
  if (state.localViewers.size + state.remoteViewers.size === 0) {
    return false;
  }

  clearAllViewers(state);
  state.readerGhostSince = null;
  state.idleSince = null;
  state.centralIdleSince = null;

  if (!state.currentRtspUrl || !mtxPathName) {
    return true;
  }

  const camera = findCameraById(cameraId);
  if (!camera) return true;

  const quality = getStreamQualityPreset(
    resolveStreamQualityId(camera, qualityId),
  );
  const mtxPath = state.mtxPathName || resolveMtxPathName(camera, qualityId);
  await syncStreamPipeline(state, mtxPath, state.currentRtspUrl, quality);
  return true;
}

/**
 * Hết hạn viewer không heartbeat; sync pipeline nếu cần.
 * @param {number} cameraId
 * @param {StreamQualityId} qualityId
 * @param {QualityStreamState} state
 * @param {string | null} mtxPathName
 */
export async function maintainViewerSessions(
  cameraId,
  qualityId,
  state,
  mtxPathName,
) {
  const camera = findCameraById(cameraId);
  if (!camera || !mtxPathName) return false;

  const expired = expireStaleViewers(state, config.viewerHeartbeatTtlMs);
  if (!expired || !state.currentRtspUrl) return expired;

  const quality = getStreamQualityPreset(
    resolveStreamQualityId(camera, qualityId),
  );
  const mtxPath = state.mtxPathName || resolveMtxPathName(camera, qualityId);
  await syncStreamPipeline(state, mtxPath, state.currentRtspUrl, quality);
  return true;
}

/**
 * @param {number} cameraId
 * @param {StreamQualityId} qualityId
 * @param {import('../utils/webrtc-client-url.js').ClientContext} clientContext
 * @param {{ scope?: StreamScope, previousQualityId?: StreamQualityId, viewerId?: string, previousViewerId?: string }} [options]
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
      await stopQualityStream(cameraId, resolvedPrevious, {
        scope,
        viewerId: options.previousViewerId,
      });
    }
  }

  const streamResult = await startQualityStreamInternal(
    cameraId,
    resolvedQuality,
    clientContext,
    { scope, viewerId: options.viewerId },
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

/** @returns {Set<string>} */
export function getManagedMtxPathNames() {
  const names = new Set();
  for (const [, byQuality] of streams) {
    for (const [, state] of byQuality) {
      if (state.mtxPathName) {
        names.add(state.mtxPathName);
      }
    }
  }
  return names;
}

/**
 * Dừng relay central mồ côi (viewer count = 0, relay vẫn chạy).
 * @param {number} cameraId
 * @param {StreamQualityId} qualityId
 */
export async function stopOrphanCentralRelay(cameraId, qualityId) {
  const camera = findCameraById(cameraId);
  if (!camera) return { ok: true, stopped: false };

  const byQuality = streams.get(cameraId);
  const resolvedQuality = resolveStreamQualityId(qualityId);
  const state = byQuality?.get(resolvedQuality);
  if (!state || !state.centralRelayActive) {
    return { ok: true, stopped: false };
  }

  const mtxPath =
    state.mtxPathName || resolveMtxPathName(camera, resolvedQuality);
  await stopCentralRelay(state, mtxPath);
  return { ok: true, stopped: true, quality: resolvedQuality };
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
  if (hasRegisteredViewers(state)) {
    return { ok: true, cleaned: false };
  }
  if (!isStreaming(state)) return { ok: true, cleaned: false };

  const mtxPath =
    state.mtxPathName || resolveMtxPathName(camera, resolvedQuality);
  state.idleSince = null;
  state.centralIdleSince = null;

  await stopFfmpegIngest(state, mtxPath);

  state.currentRtspUrl = null;
  state.streamProbe = null;
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

    try {
      const { reconcileOrphanMtxPathsOnStartup } =
        await import("./mediamtx.service.js");
      await reconcileOrphanMtxPathsOnStartup(getManagedMtxPathNames());
    } catch (err) {
      console.warn(
        "[stream] MTX startup reconcile failed:",
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
