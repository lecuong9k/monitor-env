import { config } from "../config.js";

function normalizeOrigin(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return String(value).trim().replace(/\/$/, "");
  }
}

/**
 * URL WHEP/WebRTC base — mặc định MediaMTX trung tâm (MEDIAMTX_WEBRTC_URL).
 * Ghi đè theo origin qua MEDIAMTX_WEBRTC_ORIGIN_MAP khi cần (CDN, tunnel…).
 *
 * @param {{ origin?: string | null, host?: string | null }} clientContext
 */
export function resolveWebrtcBaseUrl(clientContext = {}) {
  const origin = normalizeOrigin(clientContext.origin);
  const originMap = config.mediamtx.webrtcOriginMap;

  if (origin && originMap[origin]) {
    return originMap[origin];
  }

  return config.mediamtx.webrtcFallbackUrl;
}

/** @param {import('fastify').FastifyRequest} request */
export function clientContextFromRequest(request) {
  const origin =
    request.headers["x-client-origin"] ||
    request.headers.origin ||
    request.headers.referer ||
    null;

  const host =
    request.headers["x-forwarded-host"] || request.headers.host || null;

  return { origin, host };
}

/** Headers từ main BE proxy sang camera-service. */
export function clientContextFromProxyHeaders(headers = {}) {
  const origin =
    headers["x-client-origin"] || headers.origin || headers.referer || null;
  const host = headers["x-forwarded-host"] || headers.host || null;
  return { origin, host };
}
