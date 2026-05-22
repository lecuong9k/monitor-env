import {
    findAllModbusRtu,
    findModbusRtuById,
    upsertModbusRtu,
    deleteModbusRtu,
    findDevicesByHardwarePort
} from "../repositorys/modbus-rtu.repository.js"

export function getAllModbusRtu() {
    return findAllModbusRtu();
}

export function getModbusRtu(id) {
    const modbusRtu = findModbusRtuById(id);
    if (!modbusRtu) {
        throw new Error("Modbus RTU not found");
    }
    return modbusRtu;
}
export function saveModbusRtu(id, value) {
    return upsertModbusRtu(id, value);
}

export function removeModbusRtu(id) {
    return deleteModbusRtu(id);
}

export function getDevicesByHardwarePort(hardwarePort) {
    return findDevicesByHardwarePort(hardwarePort);
}