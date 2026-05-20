import {
    getAllSettings,
    getSetting,
    saveSetting,
    removeSetting
} from "../services/setting.service.js";

export async function getSettingsController() {
    return getAllSettings();
}

export async function getSettingController(request, reply) {
    try {
        const { key } = request.params;
        return getSetting(key);
    } catch (err) {
        return reply.code(404).send({
            error: err.message
        });
    }
}

export async function createSettingController(request) {
    const { key, value } = request.body;
    saveSetting(key, value);
    return {
        success: true
    };
}

export async function deleteSettingController(request) {
    const { key } = request.params;
    removeSetting(key);
    return {
        success: true
    };
}