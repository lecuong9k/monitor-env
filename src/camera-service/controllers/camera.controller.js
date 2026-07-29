import {
  createCameraRecord,
  deleteCameraRecord,
  executePtz,
  fetchTalkbackCapabilities,
  getCameraById,
  getCameraStreamOptions,
  getCameraStreamUrl,
  listCameras,
  listCamerasForAiAgent,
  listCamerasRegistry,
  restartCameraStream,
  startCameraStream,
  stopCameraStream,
  updateCameraRecord,
  updateCameraStreamQuality,
} from "../services/camera.service.js";
import {
  getStreamStatus,
  heartbeatCameraStream,
} from "../services/stream.service.js";
import { resolveStreamScope } from "../config.js";
import { clientContextFromRequest } from "../utils/webrtc-client-url.js";
import { parseQualityForCamera } from "../utils/stream-quality-params.js";
import { handleTalkbackWebSocket } from "../services/talkback.service.js";

function streamOptionsFromBody(body = {}) {
  const options = { scope: resolveStreamScope(body.scope) };
  const previousQualityId = String(body.previousQualityId || "").trim();
  if (previousQualityId) {
    options.previousQualityId = previousQualityId;
  }
  const viewerId = String(body.viewerId || "").trim();
  if (viewerId) options.viewerId = viewerId;
  const previousViewerId = String(body.previousViewerId || "").trim();
  if (previousViewerId) options.previousViewerId = previousViewerId;
  return options;
}

function errorStatus(err, fallback = 500) {
  return typeof err?.status === "number" ? err.status : fallback;
}

export async function listCamerasController(request) {
  return listCameras(clientContextFromRequest(request));
}

export async function listCamerasRegistryController() {
  return listCamerasRegistry();
}

export async function listCamerasForAiAgentController() {
  return listCamerasForAiAgent();
}

export async function getCameraController(request, reply) {
  try {
    return getCameraById(Number(request.params.id));
  } catch (err) {
    return reply.code(404).send({ error: err.message });
  }
}

export async function createCameraController(request, reply) {
  try {
    return createCameraRecord(request.body ?? {});
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
}

export async function updateCameraController(request, reply) {
  try {
    return updateCameraRecord(Number(request.params.id), request.body ?? {});
  } catch (err) {
    const status = err.message.includes("Không tìm thấy") ? 404 : 400;
    return reply.code(status).send({ error: err.message });
  }
}

export async function deleteCameraController(request, reply) {
  try {
    return deleteCameraRecord(Number(request.params.id));
  } catch (err) {
    return reply.code(404).send({ error: err.message });
  }
}

export async function getCameraStreamUrlController(request, reply) {
  try {
    const cameraId = Number(request.params.id);
    const qualityId = parseQualityForCamera(request, cameraId);
    const scope = resolveStreamScope(
      request.query?.scope || request.body?.scope,
    );
    return getCameraStreamUrl(
      cameraId,
      clientContextFromRequest(request),
      qualityId,
      scope,
    );
  } catch (err) {
    return reply.code(404).send({ error: err.message });
  }
}

export async function startCameraStreamController(request, reply) {
  try {
    const cameraId = Number(request.params.id);
    const clientContext = clientContextFromRequest(request);
    const qualityId = parseQualityForCamera(request, cameraId);
    const options = streamOptionsFromBody(request.body);
    return await startCameraStream(cameraId, clientContext, qualityId, options);
  } catch (err) {
    request.log.error(err);
    return reply.code(errorStatus(err)).send({ error: err.message });
  }
}

export async function stopCameraStreamController(request, reply) {
  try {
    const cameraId = Number(request.params.id);
    const qualityRaw = request.body?.qualityId ?? request.query?.quality;
    const options = streamOptionsFromBody(request.body);
    return await stopCameraStream(cameraId, qualityRaw || undefined, options);
  } catch (err) {
    request.log.error(err);
    return reply.code(errorStatus(err)).send({ error: err.message });
  }
}

export async function restartCameraStreamController(request, reply) {
  try {
    const cameraId = Number(request.params.id);
    const clientContext = clientContextFromRequest(request);
    const qualityId = parseQualityForCamera(request, cameraId);
    const options = streamOptionsFromBody(request.body);
    return await restartCameraStream(
      cameraId,
      clientContext,
      qualityId,
      options,
    );
  } catch (err) {
    request.log.error(err);
    return reply.code(errorStatus(err)).send({ error: err.message });
  }
}

export async function heartbeatCameraStreamController(request, reply) {
  try {
    const cameraId = Number(request.params.id);
    const qualityId = parseQualityForCamera(request, cameraId);
    const options = streamOptionsFromBody(request.body);
    return await heartbeatCameraStream(cameraId, qualityId, options);
  } catch (err) {
    request.log.error(err);
    return reply.code(errorStatus(err, 400)).send({ error: err.message });
  }
}

export async function getCameraStreamOptionsController(request, reply) {
  try {
    const cameraId = Number(request.params.id);
    const qualityId = parseQualityForCamera(request, cameraId);
    return getCameraStreamOptions(cameraId, qualityId);
  } catch (err) {
    return reply.code(404).send({ error: err.message });
  }
}

export async function updateCameraStreamQualityController(request, reply) {
  try {
    const { qualityId } = request.body ?? {};
    if (!qualityId) {
      return reply.code(400).send({ error: "Thiếu qualityId" });
    }
    const options = streamOptionsFromBody(request.body);
    return await updateCameraStreamQuality(
      Number(request.params.id),
      qualityId,
      clientContextFromRequest(request),
      options,
    );
  } catch (err) {
    request.log.error(err);
    const status = err.message.includes("Không tìm thấy") ? 404 : 400;
    return reply.code(status).send({ error: err.message });
  }
}

export async function ptzController(request, reply) {
  try {
    return await executePtz(Number(request.params.id), request.body);
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: err.message });
  }
}

export async function talkbackCapabilitiesController(request, reply) {
  try {
    const cameraId = Number(request.params.id);
    const qualityId = parseQualityForCamera(request, cameraId);
    return await fetchTalkbackCapabilities(cameraId, qualityId);
  } catch (err) {
    request.log.error(err);
    const status = err.message.includes("Không tìm thấy") ? 404 : 500;
    return reply.code(status).send({ error: err.message });
  }
}

export async function talkbackWebSocketController(socket, request) {
  const cameraId = Number(request.params.id);
  const qualityId = parseQualityForCamera(request, cameraId);
  handleTalkbackWebSocket(cameraId, socket, { qualityId });
}

export async function streamStatusController(request) {
  const cameraId = Number(request.params.id);
  const qualityId = parseQualityForCamera(request, cameraId);
  const scope = resolveStreamScope(request.query?.scope || request.body?.scope);
  return getStreamStatus(
    cameraId,
    clientContextFromRequest(request),
    qualityId,
    scope,
  );
}
