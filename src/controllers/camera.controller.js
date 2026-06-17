import * as cameraClient from "../services/camera-client.service.js";

export async function listCamerasController(request, reply) {
  try {
    return await cameraClient.listCameras(request);
  } catch (err) {
    request.log.error(err);
    const status = err.status === 401 ? 503 : 500;
    return reply.code(status).send({
      error: err.message || "Camera service không khả dụng",
    });
  }
}

export async function getCameraStreamUrlController(request, reply) {
  try {
    return await cameraClient.getCameraStreamUrl(request.params.id, request);
  } catch (err) {
    return reply
      .code(err.status === 404 ? 404 : 500)
      .send({ error: err.message });
  }
}

export async function liveMpegTsController(request, reply) {
  try {
    await cameraClient.proxyMpegTsStream(
      Number(request.params.id),
      reply,
      request,
    );
  } catch (err) {
    request.log.error(err);
    if (!reply.raw.writableEnded) {
      reply.code(500).send({ error: err.message });
    }
  }
}

export async function startCameraStreamController(request, reply) {
  try {
    return await cameraClient.startCameraStream(request.params.id, request);
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: err.message });
  }
}

export async function stopCameraStreamController(request, reply) {
  try {
    return await cameraClient.stopCameraStream(request.params.id);
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: err.message });
  }
}

export async function restartCameraStreamController(request, reply) {
  try {
    return await cameraClient.restartCameraStream(request.params.id, request);
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: err.message });
  }
}

export async function cameraStreamWsController(socket, request) {
  cameraClient.proxyCameraWebSocket(socket, Number(request.params.id));
}

export async function getCameraStreamOptionsController(request, reply) {
  try {
    return await cameraClient.getCameraStreamOptions(request.params.id);
  } catch (err) {
    return reply
      .code(err.status === 404 ? 404 : 500)
      .send({ error: err.message });
  }
}

export async function updateCameraStreamQualityController(request, reply) {
  try {
    const { qualityId } = request.body ?? {};
    if (!qualityId) {
      return reply.code(400).send({ error: "Thiếu qualityId" });
    }
    return await cameraClient.updateCameraStreamQuality(
      request.params.id,
      qualityId,
    );
  } catch (err) {
    request.log.error(err);
    const status = err.message?.includes("Không tìm thấy") ? 404 : 400;
    return reply.code(status).send({ error: err.message });
  }
}

export async function ptzController(request, reply) {
  try {
    return await cameraClient.executePtz(request.params.id, request.body);
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: err.message });
  }
}

export async function streamStatusController(request, reply) {
  try {
    return await cameraClient.getStreamStatus(request.params.id, request);
  } catch (err) {
    return reply
      .code(err.status === 404 ? 404 : 500)
      .send({ error: err.message });
  }
}
