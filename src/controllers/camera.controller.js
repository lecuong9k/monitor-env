import {
  executePtz,
  getCameraStreamOptions,
  getCameraStreamUrl,
  listCameras,
  restartCameraStream,
  startCameraStream,
  stopCameraStream,
  updateCameraStreamQuality,
} from "../services/camera.service.js";
import { addWsClient } from "../services/stream.service.js";

export async function listCamerasController(request, reply) {
  try {
    return await listCameras();
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: err.message });
  }
}

export async function getCameraStreamUrlController(request, reply) {
  try {
    const { id } = request.params;
    return getCameraStreamUrl(id);
  } catch (err) {
    return reply.code(404).send({ error: err.message });
  }
}

export async function liveMpegTsController(request, reply) {
  reply.hijack();
  try {
    const { attachMpegTsClient } =
      await import("../services/stream.service.js");
    await attachMpegTsClient(reply, request);
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
    const { id } = request.params;
    return await startCameraStream(id);
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: err.message });
  }
}

export async function stopCameraStreamController(request, reply) {
  try {
    const { id } = request.params;
    return await stopCameraStream(id);
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: err.message });
  }
}

export async function restartCameraStreamController(request, reply) {
  try {
    const { id } = request.params;
    return await restartCameraStream(id);
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: err.message });
  }
}

export async function cameraStreamWsController(socket, request) {
  const { id } = request.params;
  if (Number(id) !== 1) {
    socket.close(1008, "Không tìm thấy camera");
    return;
  }
  addWsClient(socket);
}

export async function getCameraStreamOptionsController(request, reply) {
  try {
    const { id } = request.params;
    return getCameraStreamOptions(id);
  } catch (err) {
    return reply.code(404).send({ error: err.message });
  }
}

export async function updateCameraStreamQualityController(request, reply) {
  try {
    const { id } = request.params;
    const { qualityId } = request.body ?? {};
    if (!qualityId) {
      return reply.code(400).send({ error: "Thiếu qualityId" });
    }
    return await updateCameraStreamQuality(id, qualityId);
  } catch (err) {
    request.log.error(err);
    const status = err.message.includes("Không tìm thấy") ? 404 : 400;
    return reply.code(status).send({ error: err.message });
  }
}

export async function ptzController(request, reply) {
  try {
    const { id } = request.params;
    return await executePtz(id, request.body);
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: err.message });
  }
}
