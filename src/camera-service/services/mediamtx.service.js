import { config } from "../config.js";

/** @typedef {'local' | 'central'} MtxTarget */

/** @param {MtxTarget} target */
function getMtxConfig(target) {
  if (target === "central") {
    const central = config.mediamtx.central;
    if (!central.apiUrl) {
      throw new Error("MEDIAMTX_CENTRAL_API_URL chưa cấu hình");
    }
    return central;
  }
  return config.mediamtx.local;
}

/** @param {MtxTarget} target */
function apiBase(target) {
  return getMtxConfig(target).apiUrl.replace(/\/$/, "");
}

/** @param {MtxTarget} target */
async function mtxFetch(target, path, options = {}) {
  const res = await fetch(`${apiBase(target)}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(
      `MediaMTX ${target} API ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
    );
    err.status = res.status;
    throw err;
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const QUALITY_SUFFIX_RE = /-(main|sub|mobile)$/;

/** @param {string} basePath @param {string} qualityId */
export function resolveQualityPath(basePath, qualityId) {
  const base = String(basePath || "")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(QUALITY_SUFFIX_RE, "");
  const q = String(qualityId || "main")
    .trim()
    .toLowerCase();
  if (!base) {
    throw new Error("mediamtx_path không hợp lệ");
  }
  return `${base}-${q}`;
}

/** @param {MtxTarget} target @param {string} pathName */
export async function getPathStats(target, pathName) {
  try {
    return await mtxFetch(
      target,
      `/v3/paths/get/${encodeURIComponent(pathName)}`,
    );
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/** @param {Record<string, unknown> | null | undefined} pathStats */
export function countPathReaders(pathStats) {
  if (!pathStats) return 0;
  if (Array.isArray(pathStats.readers)) return pathStats.readers.length;
  if (typeof pathStats.readerCount === "number") return pathStats.readerCount;
  return 0;
}

/**
 * @param {string} pathName
 * @param {MtxTarget} target
 * @param {{ origin?: string | null, host?: string | null }} [clientContext]
 */
export function getWhepUrl(pathName, target, clientContext = {}) {
  const mtxConfig = getMtxConfig(target);
  const origin = normalizeOrigin(clientContext.origin);
  const originMap = mtxConfig.webrtcOriginMap || {};

  let base = mtxConfig.webrtcUrl?.replace(/\/$/, "") || "";
  if (origin && originMap[origin]) {
    base = originMap[origin].replace(/\/$/, "");
  }

  return `${base}/${pathName}/whep`;
}

/**
 * @param {string} pathName
 * @param {MtxTarget} target
 * @param {{ origin?: string | null, host?: string | null }} [clientContext]
 */
export function getWebRtcPageUrl(pathName, target, clientContext = {}) {
  const whep = getWhepUrl(pathName, target, clientContext);
  return whep.replace(/\/whep$/, "");
}

function normalizeOrigin(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return String(value).trim().replace(/\/$/, "");
  }
}

/** @param {MtxTarget} [target] */
export async function checkMediamtxAvailable(target = "local") {
  await mtxFetch(target, "/v3/config/global/get");
}

/** @type {Record<string, { available: boolean | null, checkedAt: number }>} */
const healthCache = {};

/** @param {MtxTarget} target @param {{ force?: boolean }} [options] */
export async function isMediamtxAvailable(target = "local", options = {}) {
  const ttl = config.mediamtxHealthCacheMs;
  const now = Date.now();
  const cache = healthCache[target] || { available: null, checkedAt: 0 };

  if (
    !options.force &&
    cache.available !== null &&
    now - cache.checkedAt < ttl
  ) {
    return cache.available;
  }

  try {
    await checkMediamtxAvailable(target);
    healthCache[target] = { available: true, checkedAt: now };
    return true;
  } catch {
    healthCache[target] = { available: false, checkedAt: now };
    return false;
  }
}

export function isCentralRelayEnabled() {
  return Boolean(config.mediamtx.central.rtspPublishUrl);
}

/** @param {string} pathName */
export function getCentralRtspPublishUrl(pathName) {
  const base = config.mediamtx.central.rtspPublishUrl?.replace(/\/$/, "");
  if (!base) {
    throw new Error("MEDIAMTX_CENTRAL_RTSP_PUBLISH_URL chưa cấu hình");
  }
  const normalized = String(pathName || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  if (!normalized) {
    throw new Error("mediamtx_path không hợp lệ");
  }
  return `${base}/${normalized}`;
}

/** URL RTSP local cho path (publish hoặc read — cùng endpoint trên MediaMTX). */
export function getLocalRtspUrl(pathName) {
  const base = config.mediamtx.local.rtspInternalUrl.replace(/\/$/, "");
  const normalized = String(pathName || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  return `${base}/${normalized}`;
}

/** Đăng ký path chờ RTSP publish (central relay). */
export async function ensurePathPublisher(target, pathName) {
  const body = {
    source: "publisher",
    sourceOnDemand: false,
    rtspTransport: "tcp",
  };

  await mtxFetch(
    target,
    `/v3/config/paths/replace/${encodeURIComponent(pathName)}`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

/** MediaMTX pull camera RTSP on-demand. */
export async function ensurePathSource(target, pathName, rtspUrl) {
  const body = {
    source: rtspUrl,
    sourceOnDemand: true,
    sourceOnDemandStartTimeout: "10s",
    sourceOnDemandCloseAfter: "10s",
    rtspTransport: "tcp",
  };

  await mtxFetch(
    target,
    `/v3/config/paths/replace/${encodeURIComponent(pathName)}`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

/** @param {MtxTarget} target @param {string} pathName @param {number} [timeoutMs] */
export async function waitPathOnline(target, pathName, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const path = await mtxFetch(
        target,
        `/v3/paths/get/${encodeURIComponent(pathName)}`,
      );
      if (path?.online === true) return path;
    } catch {
      // path chưa sẵn sàng
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  throw new Error(
    `Timeout chờ MediaMTX ${target} path online — kiểm tra RTSP URL và MediaMTX`,
  );
}

/** @param {MtxTarget} target @param {string} pathName */
export async function clearPathSource(target, pathName) {
  try {
    await mtxFetch(
      target,
      `/v3/config/paths/delete/${encodeURIComponent(pathName)}`,
      {
        method: "DELETE",
      },
    );
  } catch (err) {
    if (err.status === 404) return;
    throw err;
  }
}
