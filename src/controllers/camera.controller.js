import * as cameraClient from "../services/camera-client.service.js";
import WebSocket from "ws";

function parseQualityId(request) {
  const fromQuery = request.query?.quality;
  const fromBody = request.body?.qualityId;
  return fromBody ?? fromQuery ?? undefined;
}

function parseScope(request) {
  return request.body?.scope || request.query?.scope || "local";
}

export async function listCamerasController(request, reply) {
  try {
    return await cameraClient.listCameras(request);
  } catch (err) {
    request.log.error(err);
    const status = err.status === 401 ? 503 : err.status === 503 ? 503 : 500;
    return reply.code(status).send({
      error: err.message || "Camera service không khả dụng",
    });
  }
}

export async function getCameraStreamUrlController(request, reply) {
  try {
    return await cameraClient.getCameraStreamUrl(
      request.params.id,
      request,
      parseQualityId(request),
      parseScope(request),
    );
  } catch (err) {
    return reply
      .code(err.status === 404 ? 404 : 500)
      .send({ error: err.message });
  }
}

export async function startCameraStreamController(request, reply) {
  try {
    return await cameraClient.startCameraStream(
      request.params.id,
      request,
      parseQualityId(request),
      parseScope(request),
    );
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: err.message });
  }
}

export async function stopCameraStreamController(request, reply) {
  try {
    return await cameraClient.stopCameraStream(
      request.params.id,
      request,
      parseQualityId(request),
      parseScope(request),
    );
  } catch (err) {
    request.log.error(err);
    return reply.code(err.status || 500).send({ error: err.message });
  }
}

export async function heartbeatCameraStreamController(request, reply) {
  try {
    return await cameraClient.heartbeatCameraStream(
      request.params.id,
      request,
      parseQualityId(request),
      parseScope(request),
    );
  } catch (err) {
    request.log.error(err);
    return reply.code(err.status || 400).send({ error: err.message });
  }
}

export async function restartCameraStreamController(request, reply) {
  try {
    return await cameraClient.restartCameraStream(
      request.params.id,
      request,
      parseQualityId(request),
      parseScope(request),
    );
  } catch (err) {
    request.log.error(err);
    return reply.code(err.status || 500).send({ error: err.message });
  }
}

export async function getCameraStreamOptionsController(request, reply) {
  try {
    return await cameraClient.getCameraStreamOptions(
      request.params.id,
      parseQualityId(request),
    );
  } catch (err) {
    return reply
      .code(err.status === 404 ? 404 : 500)
      .send({ error: err.message });
  }
}

export async function updateCameraStreamQualityController(request, reply) {
  try {
    const { qualityId, previousQualityId } = request.body ?? {};
    if (!qualityId) {
      return reply.code(400).send({ error: "Thiếu qualityId" });
    }
    return await cameraClient.updateCameraStreamQuality(
      request.params.id,
      qualityId,
      request,
      parseScope(request),
      previousQualityId,
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

export async function talkbackCapabilitiesController(request, reply) {
  try {
    return await cameraClient.getTalkbackCapabilities(
      request.params.id,
      request,
      parseQualityId(request),
    );
  } catch (err) {
    request.log.error(err);
    return reply
      .code(err.status === 404 ? 404 : 500)
      .send({ error: err.message });
  }
}

export async function talkbackWebSocketController(socket, request) {
  const cameraId = request.params.id;
  const qualityId = parseQualityId(request);
  const upstreamUrl = cameraClient.getTalkbackWsUpstreamUrl(
    cameraId,
    qualityId,
  );
  const apiKey = cameraClient.getCameraServiceApiKey();

  /** @type {{ data: Buffer | ArrayBuffer | string; isBinary: boolean }[]} */
  const pendingClientMessages = [];
  let upstream = /** @type {WebSocket | null} */ (null);

  let closed = false;
  const closeBoth = (code, reason) => {
    if (closed) return;
    closed = true;
    try {
      socket.close(code, reason);
    } catch {
      // ignore
    }
    try {
      upstream?.close(code, reason);
    } catch {
      // ignore
    }
  };

  const flushPendingToUpstream = () => {
    if (!upstream || upstream.readyState !== WebSocket.OPEN) return;
    while (pendingClientMessages.length > 0) {
      const item = pendingClientMessages.shift();
      if (!item) break;
      upstream.send(item.data, { binary: item.isBinary });
    }
  };

  socket.on("message", (data, isBinary) => {
    if (upstream?.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
      return;
    }

    pendingClientMessages.push({ data, isBinary });
    if (upstream?.readyState === WebSocket.CLOSED) {
      pendingClientMessages.length = 0;
      closeBoth(1011, "upstream closed");
    }
  });

  socket.on("close", (code, reason) => {
    closeBoth(code, reason.toString());
  });

  socket.on("error", (err) => {
    request.log.error(err);
    closeBoth(1011, "client error");
  });

  upstream = new WebSocket(upstreamUrl, {
    headers: {
      "X-Camera-Service-Key": apiKey,
    },
  });

  upstream.on("open", () => {
    flushPendingToUpstream();
  });

  upstream.on("message", (data, isBinary) => {
    if (socket.readyState === 1) {
      socket.send(data, { binary: isBinary });
    }
  });

  upstream.on("close", (code, reason) => {
    closeBoth(code, reason.toString());
  });

  upstream.on("error", (err) => {
    request.log.error(err);
    closeBoth(1011, "upstream error");
  });
}

export async function streamStatusController(request, reply) {
  try {
    return await cameraClient.getStreamStatus(
      request.params.id,
      request,
      parseQualityId(request),
      parseScope(request),
    );
  } catch (err) {
    return reply
      .code(err.status === 404 ? 404 : 500)
      .send({ error: err.message });
  }
}
