import {
  cameraStreamWsController,
  getCameraStreamOptionsController,
  getCameraStreamUrlController,
  listCamerasController,
  liveMpegTsController,
  ptzController,
  restartCameraStreamController,
  startCameraStreamController,
  stopCameraStreamController,
  updateCameraStreamQualityController,
} from "../controllers/camera.controller.js";

export default async function cameraRoutes(fastify) {
  fastify.get("/cameras", listCamerasController);
  fastify.get("/cameras/:id/stream-url", getCameraStreamUrlController);
  fastify.get("/cameras/:id/stream/options", getCameraStreamOptionsController);
  fastify.get("/cameras/:id/stream/status", async (request) => {
    const { getStreamStatus } = await import("../services/stream.service.js");
    return getStreamStatus(Number(request.params.id));
  });
  fastify.post("/cameras/:id/stream/start", startCameraStreamController);
  fastify.post("/cameras/:id/stream/stop", stopCameraStreamController);
  fastify.post("/cameras/:id/stream/restart", restartCameraStreamController);
  fastify.post(
    "/cameras/:id/stream/quality",
    updateCameraStreamQualityController,
  );
  fastify.get(
    "/cameras/:id/stream/ws",
    { websocket: true },
    cameraStreamWsController,
  );
  fastify.get(
    "/cameras/:id/stream/live.ts",
    { config: { requestTimeout: 0 } },
    liveMpegTsController,
  );
  fastify.post("/cameras/:id/ptz", ptzController);
}
