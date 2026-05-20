import db from "../database/sqlite.js";
export function findAllSettings() {
    return db.prepare(`
        SELECT *
        FROM settings
        ORDER BY id DESC
    `).all();
}

export function findSettingByKey(key) {
    return db.prepare(`
        SELECT *
        FROM settings
        WHERE key = ?
    `).get(key);
}

export function upsertSetting(key, value) {
    return db.prepare(`
        INSERT INTO settings(key, value)
        VALUES (?, ?)
        ON CONFLICT(key)
        DO UPDATE SET
            value = excluded.value,
            updatedAt = CURRENT_TIMESTAMP
    `).run(key, value);
}

export function deleteSetting(key) {
    return db.prepare(`
        DELETE FROM settings
        WHERE key = ?
    `).run(key);
}