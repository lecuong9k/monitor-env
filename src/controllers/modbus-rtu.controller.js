import {
    getAllModbusRtu,
    getModbusRtu,
    saveModbusRtu,
    removeModbusRtu,
    getDevicesByHardwarePort
} from "../services/modbus-rtu.service.js";

export async function getAllModbusRtuController() {
    return getAllModbusRtu();
}

export async function getModbusRtuController(request, reply) {
    try {
        const { id } = request.params;
        return getModbusRtu(id);
    } catch (err) {
        return reply.code(404).send({
            error: err.message
        });
    }
}

export async function createModbusRtuController(request) {
    const { id, value } = request.body;
    saveModbusRtu(id, value);
    return {
        success: true
    };
}

export async function deleteModbusRtuController(request) {
    const { id } = request.params;
    removeModbusRtu(id);
    return {
        success: true
    };
}

export async function getDevicesByHardwarePortController(request, reply) {
    try {
        const { hardwarePort } = request.params;
        return getDevicesByHardwarePort(hardwarePort);
    } catch (err) {
        return reply.code(404).send({
            error: err.message
        });
    }
}