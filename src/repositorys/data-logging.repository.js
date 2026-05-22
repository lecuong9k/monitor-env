import db from "../database/sqlite.js";
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
    console.log('Upserting data logging:', id, value);
    // lọc key hợp lệ
    const keys = Object.keys(value)

    // values tương ứng
    const values = keys.map(key => value[key]);

    // UPDATE
    if (value.id) {

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
            .run(...values, value.id);
    }

    // INSERT
    const columns = keys.join(", ");
    const placeholders = keys.map(() => "?").join(", ");
    const query = `
        INSERT INTO data_logging (${columns})
        VALUES (${placeholders})
    `;
    return db
        .prepare(query)
        .run(...values);
}

export function deleteDataLogging(id) {
    return db.prepare(`
        DELETE FROM data_logging
        WHERE id = ?
    `).run(id);
}