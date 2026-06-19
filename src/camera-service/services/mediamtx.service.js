import { config } from "../config.js";
import { resolveWebrtcBaseUrl } from "../utils/webrtc-client-url.js";

function apiBase() {
  return config.mediamtx.apiUrl.replace(/\/$/, "");
}

async function mtxFetch(path, options = {}) {
  const res = await fetch(`${apiBase()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(
      `MediaMTX API ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
    );
    err.status = res.status;
    throw err;
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** @param {string} pathName @param {{ origin?: string | null, host?: string | null }} [clientContext] */
export function getWhepUrl(pathName, clientContext) {
  const base = resolveWebrtcBaseUrl(clientContext).replace(/\/$/, "");
  return `${base}/${pathName}/whep`;
}

/** @param {string} pathName @param {{ origin?: string | null, host?: string | null }} [clientContext] */
export function getWebRtcPageUrl(pathName, clientContext) {
  const base = resolveWebrtcBaseUrl(clientContext).replace(/\/$/, "");
  return `${base}/${pathName}`;
}

export async function checkMediamtxAvailable() {
  await mtxFetch("/v3/config/global/get");
}

let healthCache = { available: null, checkedAt: 0 };

/** @param {{ force?: boolean }} [options] */
export async function isMediamtxAvailable(options = {}) {
  const ttl = config.mediamtxHealthCacheMs;
  const now = Date.now();

  if (
    !options.force &&
    healthCache.available !== null &&
    now - healthCache.checkedAt < ttl
  ) {
    return healthCache.available;
  }

  try {
    await checkMediamtxAvailable();
    healthCache = { available: true, checkedAt: now };
    return true;
  } catch {
    healthCache = { available: false, checkedAt: now };
    return false;
  }
}

export function isRtspPushEnabled() {
  return Boolean(config.mediamtx.rtspPublishUrl);
}

/** @param {string} pathName */
export function getRtspPublishUrl(pathName) {
  const base = config.mediamtx.rtspPublishUrl?.replace(/\/$/, "");
  if (!base) {
    throw new Error("MEDIAMTX_RTSP_PUBLISH_URL chưa cấu hình");
  }
  const normalized = String(pathName || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  if (!normalized) {
    throw new Error("mediamtx_path không hợp lệ");
  }
  return `${base}/${normalized}`;
}

/** Đăng ký path chờ MiniPC RTSP publish (thay vì VPS pull camera LAN). */
export async function ensurePathPublisher(pathName) {
  const body = {
    source: "publisher",
    sourceOnDemand: false,
    rtspTransport: "tcp",
  };

  await mtxFetch(`/v3/config/paths/replace/${encodeURIComponent(pathName)}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** @deprecated Chỉ dùng khi VPS reach được camera (dev/LAN). Production dùng ensurePathPublisher. */
export async function ensurePathSource(pathName, rtspUrl) {
  const body = {
    source: rtspUrl,
    sourceOnDemand: true,
    sourceOnDemandStartTimeout: "10s",
    sourceOnDemandCloseAfter: "10s",
    rtspTransport: "tcp",
  };

  await mtxFetch(`/v3/config/paths/replace/${encodeURIComponent(pathName)}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** SDP tối thiểu để kích hoạt WHEP reader (probe nguồn on-demand). */
const WHEP_PROBE_SDP = [
  "v=0",
  "o=- 0 0 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0 1",
  "a=msid-semantic: WMS",
  "m=video 9 UDP/TLS/RTP/SAVPF 96",
  "c=IN IP4 0.0.0.0",
  "a=rtcp-mux",
  "a=recvonly",
  "a=mid:0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "c=IN IP4 0.0.0.0",
  "a=rtcp-mux",
  "a=recvonly",
  "a=mid:1",
].join("\r\n");

/**
 * Thử POST WHEP lên MediaMTX trung tâm — xác nhận nguồn RTSP thực sự online.
 * @param {string} pathName
 * @param {{ origin?: string | null, host?: string | null }} [clientContext]
 * @param {number} [timeoutMs]
 */
export async function probeCentralWhep(
  pathName,
  clientContext,
  timeoutMs = 12_000,
) {
  const whepUrl = getWhepUrl(pathName, clientContext);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(whepUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/sdp",
        Accept: "application/sdp",
      },
      body: WHEP_PROBE_SDP,
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `MediaMTX WHEP probe failed${body ? `: ${body.slice(0, 200)}` : ""}`,
      );
    }

    const sessionUrl = res.headers.get("location");
    if (sessionUrl) {
      void fetch(sessionUrl, { method: "DELETE" }).catch(() => {});
    }

    return true;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(
        "MediaMTX WHEP probe timeout — nguồn RTSP không phản hồi kịp",
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function waitPathOnline(pathName, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const path = await mtxFetch(
        `/v3/paths/get/${encodeURIComponent(pathName)}`,
      );
      if (path?.online === true) return path;
    } catch {
      // path chưa sẵn sàng
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  throw new Error(
    "Timeout chờ MediaMTX path online — kiểm tra RTSP URL và MediaMTX",
  );
}

export async function clearPathSource(pathName) {
  try {
    await mtxFetch(`/v3/config/paths/delete/${encodeURIComponent(pathName)}`, {
      method: "DELETE",
    });
  } catch (err) {
    if (err.status === 404) return;
    throw err;
  }
}
