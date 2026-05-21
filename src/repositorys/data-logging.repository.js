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
    return db.prepare(`
        INSERT INTO data_logging(id, value)
        VALUES (?, ?)
        ON CONFLICT(id)
        DO UPDATE SET
            value = excluded.value,
            updatedAt = CURRENT_TIMESTAMP
    `).run(id, value);
}

export function deleteDataLogging(id) {
    return db.prepare(`
        DELETE FROM data_logging
        WHERE id = ?
    `).run(id);
}