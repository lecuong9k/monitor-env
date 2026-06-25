import {
  createCameraController,
  deleteCameraController,
  getCameraController,
  getCameraStreamOptionsController,
  getCameraStreamUrlController,
  listCamerasController,
  listCamerasRegistryController,
  ptzController,
  restartCameraStreamController,
  heartbeatCameraStreamController,
  startCameraStreamController,
  stopCameraStreamController,
  streamStatusController,
  talkbackCapabilitiesController,
  talkbackWebSocketController,
  updateCameraController,
  updateCameraStreamQualityController,
} from "../controllers/camera.controller.js";

export default async function cameraRoutes(fastify) {
  fastify.get("/cameras", listCamerasController);
  fastify.get("/cameras/registry", listCamerasRegistryController);
  fastify.post("/cameras", createCameraController);
  fastify.get("/cameras/:id", getCameraController);
  fastify.put("/cameras/:id", updateCameraController);
  fastify.delete("/cameras/:id", deleteCameraController);

  fastify.get("/cameras/:id/stream-url", getCameraStreamUrlController);
  fastify.get("/cameras/:id/stream/options", getCameraStreamOptionsController);
  fastify.get("/cameras/:id/stream/status", streamStatusController);
  fastify.post("/cameras/:id/stream/start", startCameraStreamController);
  fastify.post("/cameras/:id/stream/stop", stopCameraStreamController);
  fastify.post(
    "/cameras/:id/stream/heartbeat",
    heartbeatCameraStreamController,
  );
  fastify.post("/cameras/:id/stream/restart", restartCameraStreamController);
  fastify.post(
    "/cameras/:id/stream/quality",
    updateCameraStreamQualityController,
  );
  fastify.post("/cameras/:id/ptz", ptzController);
  fastify.get(
    "/cameras/:id/talkback/capabilities",
    talkbackCapabilitiesController,
  );
  fastify.get(
    "/cameras/:id/talkback/ws",
    { websocket: true },
    talkbackWebSocketController,
  );
}
