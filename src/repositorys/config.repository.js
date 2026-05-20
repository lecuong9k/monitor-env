import db from "../database/sqlite.js";
export function findAllConfigs() {
    return db.prepare(`
        SELECT *
        FROM configs
        ORDER BY id DESC
    `).all();
}

export function findConfigById(id) {
    return db.prepare(`
        SELECT *
        FROM configs
        WHERE id = ?
    `).get(id);
}

export function upsertConfig(key, value) {
    return db.prepare(`
        INSERT INTO configs(key, value)
        VALUES (?, ?)
        ON CONFLICT(key)
        DO UPDATE SET
            value = excluded.value,
            updatedAt = CURRENT_TIMESTAMP
    `).run(key, value);
}

export function deleteConfig(key) {
    return db.prepare(`
        DELETE FROM configs
        WHERE key = ?
    `).run(key);
}