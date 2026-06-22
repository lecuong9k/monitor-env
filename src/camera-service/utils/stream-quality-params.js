import { pickStreamQualityForCamera } from "../../config/stream-quality.js";
import { findCameraById } from "../repositories/camera.repository.js";

/** @param {import('fastify').FastifyRequest} request @param {ReturnType<typeof findCameraById>} camera */
export function parseQualityFromRequest(request, camera) {
  const fromQuery = request.query?.quality;
  const fromBody = request.body?.qualityId;
  const raw = fromBody ?? fromQuery ?? camera?.stream_quality ?? "main";
  return pickStreamQualityForCamera(camera, String(raw));
}

/** @param {import('fastify').FastifyRequest} request */
export function parseQualityFromRequestOnly(request) {
  const fromQuery = request.query?.quality;
  const fromBody = request.body?.qualityId;
  const raw = fromBody ?? fromQuery ?? "main";
  return String(raw).trim().toLowerCase();
}

/** @param {number} cameraId @param {import('fastify').FastifyRequest} request */
export function parseQualityForCamera(request, cameraId) {
  const camera = findCameraById(cameraId);
  if (!camera) {
    throw new Error("Không tìm thấy camera");
  }
  return pickStreamQualityForCamera(
    camera,
    parseQualityFromRequestOnly(request) || camera.stream_quality || "main",
  );
}
