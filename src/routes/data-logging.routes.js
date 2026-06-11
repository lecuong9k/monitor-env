import {
  getDataLoggingController,
  getDataLoggingsController,
  getLatestDataLoggingsController,
  getLatestDataLoggingByDeviceController,
  getDataLoggingHistoryController,
  createDataLoggingController,
  deleteDataLoggingController,
} from "../controllers/data-logging.controller.js";

export default async function dataLoggingRoutes(fastify) {
  fastify.get("/data-loggings", getDataLoggingsController);
  fastify.get("/data-loggings/latest", getLatestDataLoggingsController);
  fastify.get(
    "/data-loggings/device/:deviceId/latest",
    getLatestDataLoggingByDeviceController,
  );
  fastify.get("/data-loggings/history", getDataLoggingHistoryController);
  fastify.get("/data-loggings/:id", getDataLoggingController);
  fastify.post("/data-loggings", createDataLoggingController);
  fastify.delete("/data-loggings/:id", deleteDataLoggingController);
}
