import db from "../database/sqlite.js";
export function findAllModbusRtu() {
    return db.prepare(`
        SELECT *
        FROM modbus_rtu
        ORDER BY id DESC
    `).all();
}

export function findModbusRtuById(id) {
    return db.prepare(`
        SELECT *
        FROM modbus_rtu
        WHERE id = ?
    `).get(id);
}

export function upsertModbusRtu(id, data) {
    return db.prepare(`
        INSERT INTO modbus_rtu(id, data)
        VALUES (?, ?)
        ON CONFLICT(id)
        DO UPDATE SET
            data = excluded.data,
            updatedAt = CURRENT_TIMESTAMP
    `).run(id, data);
}
export function deleteModbusRtu(id) {
    return db.prepare(`
        DELETE FROM modbus_rtu
        WHERE id = ?
    `).run(id);
}