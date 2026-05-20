import {
    getConfigsController,
    getConfigController,
    createConfigController,
    deleteConfigController
} from "../controllers/config.controller.js";

import {
    createConfigSchema
} from "../schemas/config.schema.js";

export default async function configRoutes(fastify) {
    fastify.get(
        "/configs",
        getConfigsController
    );
    fastify.get(
        "/configs/:key",
        getConfigController
    );
    fastify.post(
        "/configs",
        createConfigController
    );
    fastify.delete(
        "/configs/:key",
        deleteConfigController
    );
}