import {
    getAllDataLogging,
    getDataLogging,
    saveDataLogging,
    removeDataLogging
} from "../services/data-logging.service.js";

export async function getDataLoggingsController() {
    return getAllDataLogging();
}

export async function getDataLoggingController(request, reply) {
    try {
        const { id } = request.params;
        return getDataLogging(id);
    } catch (err) {
        return reply.code(404).send({
            error: err.message
        });
    }
}

export async function createDataLoggingController(request) {
    const { id, value } = request.body;
    saveDataLogging(id, value);
    return {
        success: true
    };
}

export async function deleteDataLoggingController(request) {
    const { id } = request.params;
    removeDataLogging(id);
    return {
        success: true
    };
}