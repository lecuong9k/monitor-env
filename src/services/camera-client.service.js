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

/** Chuyển Origin/Host từ request FE sang camera-service. */
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

function qualityQuery(qualityId, scope) {
  const params = new URLSearchParams();
  if (qualityId) params.set("quality", String(qualityId));
  if (scope) params.set("scope", String(scope));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function bodyWithStreamOptions(qualityId, extra = {}) {
  const body = { ...extra };
  if (qualityId) body.qualityId = qualityId;
  return JSON.stringify(body);
}

function streamExtraFromRequest(request, scope = "local") {
  const extra = { scope };
  const raw = request?.body || {};
  if (raw.viewerId) extra.viewerId = String(raw.viewerId);
  if (raw.previousViewerId) {
    extra.previousViewerId = String(raw.previousViewerId);
  }
  if (raw.previousQualityId) {
    extra.previousQualityId = String(raw.previousQualityId);
  }
  return extra;
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
  const url = `${BASE_URL.replace(/\/$/, "")}${path}`;
  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: serviceHeaders({
        ...clientProxyHeaders(request),
        ...options.headers,
      }),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const wrapped = new Error(
      `Không kết nối được camera-service tại ${BASE_URL} (${detail}). Kiểm tra pm2 logs camera-service hoặc chạy: npm run camera-service`,
    );
    wrapped.status = 503;
    wrapped.cause = err;
    throw wrapped;
  }
  return parseResponse(res);
}

export async function listCameras(request) {
  return cameraServiceFetch("/cameras", {}, request);
}

export async function listCamerasRegistry() {
  return cameraServiceFetch("/cameras/registry");
}

/** Full config + password — chỉ dùng nội bộ cho WS Edge AI agent. */
export async function listCamerasForAiAgent() {
  return cameraServiceFetch("/cameras/ai-agent-config");
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

export async function getCameraStreamUrl(
  cameraId,
  request,
  qualityId,
  scope = "local",
) {
  const qs = qualityQuery(qualityId, scope);
  return cameraServiceFetch(
    `/cameras/${cameraId}/stream-url${qs}`,
    {},
    request,
  );
}

export async function getCameraStreamOptions(cameraId, qualityId) {
  const qs = qualityQuery(qualityId);
  return cameraServiceFetch(`/cameras/${cameraId}/stream/options${qs}`);
}

export async function getStreamStatus(
  cameraId,
  request,
  qualityId,
  scope = "local",
) {
  const qs = qualityQuery(qualityId, scope);
  return cameraServiceFetch(
    `/cameras/${cameraId}/stream/status${qs}`,
    {},
    request,
  );
}

export async function startCameraStream(
  cameraId,
  request,
  qualityId,
  scope = "local",
) {
  return cameraServiceFetch(
    `/cameras/${cameraId}/stream/start`,
    {
      method: "POST",
      body: bodyWithStreamOptions(
        qualityId,
        streamExtraFromRequest(request, scope),
      ),
    },
    request,
  );
}

export async function stopCameraStream(
  cameraId,
  request,
  qualityId,
  scope = "local",
) {
  return cameraServiceFetch(`/cameras/${cameraId}/stream/stop`, {
    method: "POST",
    body: bodyWithStreamOptions(
      qualityId,
      streamExtraFromRequest(request, scope),
    ),
  });
}

export async function heartbeatCameraStream(
  cameraId,
  request,
  qualityId,
  scope = "local",
) {
  return cameraServiceFetch(`/cameras/${cameraId}/stream/heartbeat`, {
    method: "POST",
    body: bodyWithStreamOptions(
      qualityId,
      streamExtraFromRequest(request, scope),
    ),
  });
}

export async function heartbeatCameraStreamDirect(
  cameraId,
  { qualityId, scope = "local", viewerId } = {},
) {
  const body = { scope };
  if (qualityId) body.qualityId = qualityId;
  if (viewerId) body.viewerId = String(viewerId);

  return cameraServiceFetch(`/cameras/${cameraId}/stream/heartbeat`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function restartCameraStream(
  cameraId,
  request,
  qualityId,
  scope = "local",
) {
  return cameraServiceFetch(
    `/cameras/${cameraId}/stream/restart`,
    {
      method: "POST",
      body: bodyWithStreamOptions(qualityId, { scope }),
    },
    request,
  );
}

export async function updateCameraStreamQuality(
  cameraId,
  qualityId,
  request,
  scope = "local",
  previousQualityId,
) {
  const body = { qualityId, scope };
  if (previousQualityId) {
    body.previousQualityId = previousQualityId;
  }
  const raw = request?.body || {};
  if (raw.viewerId) body.viewerId = String(raw.viewerId);
  if (raw.previousViewerId) {
    body.previousViewerId = String(raw.previousViewerId);
  }
  return cameraServiceFetch(
    `/cameras/${cameraId}/stream/quality`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    request,
  );
}

export async function executePtz(cameraId, body) {
  return cameraServiceFetch(`/cameras/${cameraId}/ptz`, {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });
}

export async function getTalkbackCapabilities(cameraId, request, qualityId) {
  const qs = qualityQuery(qualityId);
  return cameraServiceFetch(
    `/cameras/${cameraId}/talkback/capabilities${qs}`,
    {},
    request,
  );
}

export function getTalkbackWsUpstreamUrl(cameraId, qualityId) {
  const base = BASE_URL.replace(/^http/i, "ws").replace(/\/$/, "");
  const qs = qualityQuery(qualityId);
  return `${base}/cameras/${cameraId}/talkback/ws${qs}`;
}

export function getCameraServiceApiKey() {
  return API_KEY;
}

export async function checkCameraServiceHealth() {
  try {
    const res = await fetch(`${BASE_URL.replace(/\/$/, "")}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
