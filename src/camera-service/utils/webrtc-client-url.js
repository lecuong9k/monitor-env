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
 * URL WHEP/WebRTC base theo scope stream.
 * @param {'local' | 'remote'} scope
 * @param {{ origin?: string | null, host?: string | null }} [clientContext]
 */
export function resolveWebrtcBaseUrl(scope = "local", clientContext = {}) {
  const origin = normalizeOrigin(clientContext.origin);
  const mtxConfig =
    scope === "remote" ? config.mediamtx.central : config.mediamtx.local;
  const originMap = mtxConfig.webrtcOriginMap || {};

  if (origin && originMap[origin]) {
    return originMap[origin];
  }

  return mtxConfig.webrtcUrl || "";
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
