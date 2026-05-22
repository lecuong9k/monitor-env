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
    console.log('Upserting modbus rtu:', id, data);
    // lọc key hợp lệ
    const keys = Object.keys(data)

    // values tương ứng
    const values = keys.map(key => data[key]);

    // UPDATE
    if (data.id) {

        const setClause = keys
            .map(key => `${key} = ?`)
            .join(", ");

        const query = `
            UPDATE modbus_rtu
            SET ${setClause}
            WHERE id = ?
        `;

        return db
            .prepare(query)
            .run(...values, data.id);
    }

    // INSERT
    const columns = keys.join(", ");
    const placeholders = keys.map(() => "?").join(", ");
    const query = `
        INSERT INTO modbus_rtu (${columns})
        VALUES (${placeholders})
    `;
    return db
        .prepare(query)
        .run(...values);
}
export function deleteModbusRtu(id) {
    return db.prepare(`
        DELETE FROM modbus_rtu
        WHERE id = ?
    `).run(id);
}

export function findDevicesByHardwarePort(hardwarePort) {
    return db.prepare(`
        SELECT *
        FROM modbus_rtu
        WHERE hardware_port = ?
    `).all(hardwarePort);
}