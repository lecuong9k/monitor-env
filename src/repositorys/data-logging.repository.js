import db from "../database/sqlite.js";

const insertDataLoggingStmt = db.prepare(`
    INSERT INTO data_logging (
        device_id,
        data_name,
        raw_data,
        recipe,
        convert_data
    ) VALUES (?, ?, ?, ?, ?)
`);

export function findAllDataLogging() {
    return db.prepare(`
        SELECT *
        FROM data_logging
        ORDER BY id DESC
    `).all();
}
export function findDataLoggingById(id) {
    return db.prepare(`
        SELECT *
        FROM data_logging
        WHERE id = ?
    `).get(id);
}

export function upsertDataLogging(id, value) {
    // lọc key hợp lệ
    const keys = Object.keys(value)

    // values tương ứng
    const values = keys.map(key => value[key]);

    // UPDATE
    if (id) {
        const setClause = keys
            .map(key => `${key} = ?`)
            .join(", ");

        const query = `
            UPDATE data_logging
            SET ${setClause}
            WHERE id = ?
        `;

        return db
            .prepare(query)
            .run(...values, id);
    }

    return insertDataLogging(value);
}

export function insertDataLogging(value) {
    return insertDataLoggingStmt.run(
        value.device_id || null,
        value.data_name || null,
        value.raw_data || null,
        value.recipe || null,
        value.convert_data || null
    );
}

export function deleteDataLogging(id) {
    return db.prepare(`
        DELETE FROM data_logging
        WHERE id = ?
    `).run(id);
}