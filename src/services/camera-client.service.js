import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import WebSocket from "ws";

const BASE_URL =
  process.env.CAMERA_SERVICE_URL?.trim() || "http://127.0.0.1:4001";
const API_KEY = process.env.CAMERA_SERVICE_API_KEY?.trim() || "";

function serviceHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    "X-Camera-Service-Key": API_KEY,
    ...extra,
  };
}

/** Chuyển Origin/Host từ request FE sang camera-service để chọn URL WHEP đúng. */
function clientProxyHeaders(request) {
  if (!request?.headers) return {};

  const headers = {};
  const origin = request.headers.origin;
  const referer = request.headers.referer;
  const host =
    request.headers["x-forwarded-host"] || request.headers.host || null;

  if (origin) headers["X-Client-Origin"] = origin;
  else if (referer) headers["X-Client-Origin"] = referer;
  if (host) headers["X-Forwarded-Host"] = host;

  return headers;
}

async function parseResponse(res) {
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    const message =
      typeof body === "object" && body?.error
        ? body.error
        : `Camera service error ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }

  return body;
}

export async function cameraServiceFetch(path, options = {}, request) {
  const res = await fetch(`${BASE_URL.replace(/\/$/, "")}${path}`, {
    ...options,
    headers: serviceHeaders({
      ...clientProxyHeaders(request),
      ...options.headers,
    }),
  });
  return parseResponse(res);
}

export async function listCameras(request) {
  return cameraServiceFetch("/cameras", {}, request);
}

export async function listCamerasRegistry() {
  return cameraServiceFetch("/cameras/registry");
}

export async function getCamera(cameraId) {
  return cameraServiceFetch(`/cameras/${cameraId}`);
}

export async function createCamera(body) {
  return cameraServiceFetch("/cameras", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateCamera(cameraId, body) {
  return cameraServiceFetch(`/cameras/${cameraId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteCamera(cameraId) {
  return cameraServiceFetch(`/cameras/${cameraId}`, {
    method: "DELETE",
  });
}

export async function getCameraStreamUrl(cameraId, request) {
  return cameraServiceFetch(`/cameras/${cameraId}/stream-url`, {}, request);
}

export async function getCameraStreamOptions(cameraId) {
  return cameraServiceFetch(`/cameras/${cameraId}/stream/options`);
}

export async function getStreamStatus(cameraId, request) {
  return cameraServiceFetch(`/cameras/${cameraId}/stream/status`, {}, request);
}

export async function startCameraStream(cameraId, request) {
  const relay = request?.headers?.["x-edge-relay"] === "mbox";
  return cameraServiceFetch(
    `/cameras/${cameraId}/stream/start`,
    {
      method: "POST",
      body: "{}",
      headers: relay ? { "X-Edge-Relay": "mbox" } : {},
    },
    request,
  );
}

export async function stopCameraStream(cameraId) {
  return cameraServiceFetch(`/cameras/${cameraId}/stream/stop`, {
    method: "POST",
    body: "{}",
  });
}

export async function restartCameraStream(cameraId, request) {
  return cameraServiceFetch(
    `/cameras/${cameraId}/stream/restart`,
    {
      method: "POST",
      body: "{}",
    },
    request,
  );
}

export async function updateCameraStreamQuality(cameraId, qualityId) {
  return cameraServiceFetch(`/cameras/${cameraId}/stream/quality`, {
    method: "POST",
    body: JSON.stringify({ qualityId }),
  });
}

export async function executePtz(cameraId, body) {
  return cameraServiceFetch(`/cameras/${cameraId}/ptz`, {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });
}

export async function proxyMpegTsStream(cameraId, reply, request) {
  const res = await fetch(
    `${BASE_URL.replace(/\/$/, "")}/cameras/${cameraId}/stream/live.ts`,
    {
      headers: serviceHeaders(),
    },
  );

  reply.hijack();

  if (!res.ok) {
    const text = await res.text();
    reply.raw.writeHead(res.status, { "Content-Type": "application/json" });
    reply.raw.end(text);
    return;
  }

  const headers = {
    "Content-Type": res.headers.get("content-type") || "video/mp2t",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Connection: "keep-alive",
  };

  const origin = request.headers.origin;
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
    headers.Vary = "Origin";
  }

  reply.raw.writeHead(res.status, headers);

  if (res.body) {
    await pipeline(Readable.fromWeb(res.body), reply.raw);
  } else {
    reply.raw.end();
  }
}

function wsBaseUrl() {
  const url = new URL(BASE_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.origin;
}

export function proxyCameraWebSocket(clientSocket, cameraId) {
  const upstream = new WebSocket(
    `${wsBaseUrl()}/cameras/${cameraId}/stream/ws`,
    {
      headers: {
        "X-Camera-Service-Key": API_KEY,
      },
    },
  );

  upstream.on("open", () => {
    clientSocket.on("message", (data, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(data, { binary: isBinary });
      }
    });

    upstream.on("message", (data, isBinary) => {
      if (clientSocket.readyState === 1) {
        clientSocket.send(data, { binary: isBinary });
      }
    });
  });

  const closeBoth = (code, reason) => {
    if (clientSocket.readyState === 1) clientSocket.close(code, reason);
    if (upstream.readyState === WebSocket.OPEN) upstream.close(code, reason);
  };

  upstream.on("close", (code, reason) => closeBoth(code, reason.toString()));
  upstream.on("error", () => closeBoth(1011, "Upstream error"));
  clientSocket.on("close", () => {
    if (upstream.readyState === WebSocket.OPEN) upstream.close();
  });
  clientSocket.on("error", () => {
    if (upstream.readyState === WebSocket.OPEN) upstream.close();
  });
}

export async function checkCameraServiceHealth() {
  try {
    const res = await fetch(`${BASE_URL.replace(/\/$/, "")}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
