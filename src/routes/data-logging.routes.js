import {
    getDataLoggingController,
    getDataLoggingsController,
    createDataLoggingController,
    deleteDataLoggingController
} from "../controllers/data-logging.controller.js";

export default async function dataLoggingRoutes(fastify) {
    fastify.get(
        "/data-loggings",
        getDataLoggingsController
    );
    fastify.get(
        "/data-loggings/:id",
        getDataLoggingController
    );
    fastify.post(
        "/data-loggings",
        createDataLoggingController
    );
    fastify.delete(
        "/data-loggings/:id",
        deleteDataLoggingController
    );
}