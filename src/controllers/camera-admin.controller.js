import * as cameraClient from "../services/camera-client.service.js";

function mapError(reply, err) {
  const status =
    err.status === 404 ? 404 : err.status === 400 ? 400 : err.status || 500;
  return reply.code(status).send({ error: err.message });
}

export async function listCamerasRegistryController(request, reply) {
  try {
    return await cameraClient.listCamerasRegistry();
  } catch (err) {
    request.log.error(err);
    return mapError(reply, err);
  }
}

export async function getCameraController(request, reply) {
  try {
    return await cameraClient.getCamera(request.params.id);
  } catch (err) {
    return mapError(reply, err);
  }
}

export async function createCameraController(request, reply) {
  try {
    return await cameraClient.createCamera(request.body ?? {});
  } catch (err) {
    request.log.error(err);
    return mapError(reply, err);
  }
}

export async function updateCameraController(request, reply) {
  try {
    return await cameraClient.updateCamera(
      request.params.id,
      request.body ?? {},
    );
  } catch (err) {
    request.log.error(err);
    return mapError(reply, err);
  }
}

export async function deleteCameraController(request, reply) {
  try {
    return await cameraClient.deleteCamera(request.params.id);
  } catch (err) {
    request.log.error(err);
    return mapError(reply, err);
  }
}
