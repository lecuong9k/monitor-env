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

export async function ensurePathSource(pathName, rtspUrl) {
  const body = {
    source: rtspUrl,
    sourceOnDemand: true,
    sourceOnDemandStartTimeout: "10s",
    sourceOnDemandCloseAfter: "10s",
    rtspTransport: "tcp",
  };

  try {
    await mtxFetch(`/v3/config/paths/patch/${encodeURIComponent(pathName)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (err.status !== 404) throw err;
    await mtxFetch(`/v3/config/paths/add/${encodeURIComponent(pathName)}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
}

export async function waitPathOnline(pathName, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const path = await mtxFetch(
        `/v3/paths/get/${encodeURIComponent(pathName)}`,
      );
      if (path?.online || path?.available) return path;
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
    await mtxFetch(`/v3/config/paths/patch/${encodeURIComponent(pathName)}`, {
      method: "PATCH",
      body: JSON.stringify({
        source: "publisher",
        sourceOnDemand: false,
      }),
    });
  } catch {
    // bỏ qua nếu path không tồn tại
  }
}
