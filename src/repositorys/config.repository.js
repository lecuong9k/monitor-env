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

export function upsertConfig(id, value) {
    console.log('Upserting config:', id, value);
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
            UPDATE configs
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
        INSERT INTO configs (${columns})
        VALUES (${placeholders})
    `;
    return db
        .prepare(query)
        .run(...values);
}

export function deleteConfig(id) {
    return db.prepare(`
        DELETE FROM configs
        WHERE id = ?
    `).run(id);
}