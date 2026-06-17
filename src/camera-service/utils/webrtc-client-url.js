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

function buildWebrtcBaseUrl(hostname, protocol) {
  const host = hostname?.trim();
  if (!host) return null;

  const scheme =
    protocol?.replace(/:$/, "") || config.mediamtx.webrtcProtocol || "http";
  const port = config.mediamtx.webrtcPort || 8889;

  return `${scheme}://${host}:${port}`;
}

function resolveFromOrigin(origin) {
  try {
    const url = new URL(origin);
    return buildWebrtcBaseUrl(url.hostname, url.protocol);
  } catch {
    return null;
  }
}

function resolveFromHost(hostHeader) {
  const host = hostHeader?.split(",")[0]?.trim();
  if (!host) return null;

  const hostname = host.includes(":")
    ? host.slice(0, host.lastIndexOf(":"))
    : host;
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end !== -1) {
      return buildWebrtcBaseUrl(host.slice(1, end));
    }
  }

  return buildWebrtcBaseUrl(hostname);
}

/**
 * URL WHEP động: lấy hostname từ Origin/Host của client, port từ MEDIAMTX_WEBRTC_PORT.
 * Browser vào IP/domain nào thì WHEP dùng hostname đó — không cần hardcode IP deploy.
 *
 * @param {{ origin?: string | null, host?: string | null }} clientContext
 */
export function resolveWebrtcBaseUrl(clientContext = {}) {
  const origin = normalizeOrigin(clientContext.origin);
  const originMap = config.mediamtx.webrtcOriginMap;

  if (origin && originMap[origin]) {
    return originMap[origin];
  }

  if (origin) {
    const fromOrigin = resolveFromOrigin(origin);
    if (fromOrigin) return fromOrigin;
  }

  const host = clientContext.host?.split(",")[0]?.trim() || null;
  if (host) {
    const fromHost = resolveFromHost(host);
    if (fromHost) return fromHost;
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
