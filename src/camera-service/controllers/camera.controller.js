import {
  createCameraRecord,
  deleteCameraRecord,
  executePtz,
  getCameraById,
  getCameraStreamOptions,
  getCameraStreamUrl,
  listCameras,
  listCamerasRegistry,
  restartCameraStream,
  startCameraStream,
  stopCameraStream,
  updateCameraRecord,
  updateCameraStreamQuality,
  ensureMpegtsRelayStream,
  forceCameraStreamFallback,
} from "../services/camera.service.js";
import {
  addWsClient,
  attachMpegTsClient,
  getStreamStatus,
} from "../services/stream.service.js";
import { clientContextFromRequest } from "../utils/webrtc-client-url.js";
import { parseQualityForCamera } from "../utils/stream-quality-params.js";

export async function listCamerasController(request) {
  return listCameras(clientContextFromRequest(request));
}

export async function listCamerasRegistryController() {
  return listCamerasRegistry();
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
    return getCameraStreamUrl(
      cameraId,
      clientContextFromRequest(request),
      qualityId,
    );
  } catch (err) {
    return reply.code(404).send({ error: err.message });
  }
}

export async function liveMpegTsController(request, reply) {
  reply.hijack();
  try {
    const cameraId = Number(request.params.id);
    const qualityId = parseQualityForCamera(request, cameraId);
    await attachMpegTsClient(cameraId, reply, request, qualityId);
  } catch (err) {
    request.log.error(err);
    if (!reply.raw.writableEnded) {
      reply.raw.writeHead(500, { "Content-Type": "application/json" });
      reply.raw.end(JSON.stringify({ error: err.message }));
    }
  }
}

export async function startCameraStreamController(request, reply) {
  try {
    const cameraId = Number(request.params.id);
    const clientContext = clientContextFromRequest(request);
    if (request.headers["x-edge-relay"] === "mbox") {
      return await ensureMpegtsRelayStream(cameraId);
    }
    const qualityId = parseQualityForCamera(request, cameraId);
    return await startCameraStream(cameraId, clientContext, qualityId);
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: err.message });
  }
}

export async function stopCameraStreamController(request, reply) {
  try {
    const cameraId = Number(request.params.id);
    const qualityRaw = request.body?.qualityId ?? request.query?.quality;
    return await stopCameraStream(cameraId, qualityRaw || undefined);
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: err.message });
  }
}

export async function restartCameraStreamController(request, reply) {
  try {
    const cameraId = Number(request.params.id);
    const clientContext = clientContextFromRequest(request);
    const qualityId = parseQualityForCamera(request, cameraId);
    return await restartCameraStream(cameraId, clientContext, qualityId);
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: err.message });
  }
}

export async function forceCameraStreamFallbackController(request, reply) {
  try {
    const cameraId = Number(request.params.id);
    const clientContext = clientContextFromRequest(request);
    const qualityId = parseQualityForCamera(request, cameraId);
    return await forceCameraStreamFallback(cameraId, clientContext, qualityId);
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: err.message });
  }
}

export async function cameraStreamWsController(socket, request) {
  const cameraId = Number(request.params.id);
  try {
    getCameraById(cameraId);
  } catch {
    socket.close(1008, "Không tìm thấy camera");
    return;
  }
  const qualityId = parseQualityForCamera(request, cameraId);
  addWsClient(cameraId, socket, qualityId);
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
    return await updateCameraStreamQuality(
      Number(request.params.id),
      qualityId,
      clientContextFromRequest(request),
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

export async function streamStatusController(request) {
  const cameraId = Number(request.params.id);
  const qualityId = parseQualityForCamera(request, cameraId);
  return getStreamStatus(
    cameraId,
    clientContextFromRequest(request),
    qualityId,
  );
}
