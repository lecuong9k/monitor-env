import {
    getSettingsController,
    getSettingController,
    createSettingController,
    deleteSettingController
} from "../controllers/setting.controller.js";

import {
    createSettingSchema
} from "../schemas/setting.schema.js";

export default async function settingRoutes(fastify) {
    fastify.get(
        "/settings",
        getSettingsController
    );
    fastify.get(
        "/settings/:key",
        getSettingController
    );
    fastify.post(
        "/settings",
        {
            schema: createSettingSchema
        },
        createSettingController
    );
    fastify.delete(
        "/settings/:key",
        deleteSettingController
    );
}