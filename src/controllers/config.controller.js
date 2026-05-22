import {
    getAllConfigs,
    getConfig,
    saveConfig,
    removeConfig
} from "../services/config.service.js";

export async function getConfigsController() {
    return getAllConfigs();
}

export async function getConfigController(request, reply) {
    try {
        const { id } = request.params;
        return getConfig(id);
    } catch (err) {
        return reply.code(404).send({
            error: err.message
        });
    }
}

export async function createConfigController(request) {
    const { id, value } = request.body;
    await saveConfig(id, value);
    return {
        success: true
    };
}

export async function deleteConfigController(request) {
    const { id } = request.params;
    console.log('Deleting config with id:', id);
    removeConfig(id);
    return {
        success: true
    };
}