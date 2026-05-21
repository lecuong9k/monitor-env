import {
    getAllModbusRtuController,
    getModbusRtuController,
    createModbusRtuController,
    deleteModbusRtuController,
    getDevicesByHardwarePortController
} from "../controllers/modbus-rtu.controller.js";

export default async function modbusRtuRoutes(fastify) {
    fastify.get(
        "/modbus-rtu",
        getAllModbusRtuController
    );
    fastify.get(
        "/modbus-rtu/:id",
        getModbusRtuController
    );
    fastify.post(
        "/modbus-rtu",
        createModbusRtuController
    );
    fastify.delete(
        "/modbus-rtu/:id",
        deleteModbusRtuController
    );
    fastify.get(
        "/modbus-rtu/hardware-port/:hardwarePort",
        getDevicesByHardwarePortController
    );
}