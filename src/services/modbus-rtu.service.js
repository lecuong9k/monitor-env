import {
    findAllModbusRtu,
    findModbusRtuById,
    upsertModbusRtu,
    deleteModbusRtu
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
export function saveModbusRtu(id, data) {
    return upsertModbusRtu(id, data);
}

export function removeModbusRtu(id) {
    return deleteModbusRtu(id);
}