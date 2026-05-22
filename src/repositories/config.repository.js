import db from "../database/sqlite.js";

const COLUMNS = [
  "hardware_port",
  "communication_type",
  "ip",
  "port",
  "baud_rate",
  "data_bits",
  "parity_bits",
  "stop_bits",
];

export function findAllConfigs() {
  return db
    .prepare(
      `
        SELECT *
        FROM configs
        ORDER BY id DESC
    `,
    )
    .all();
}

export function findConfigById(id) {
  return db
    .prepare(
      `
        SELECT *
        FROM configs
        WHERE id = ?
    `,
    )
    .get(id);
}

export function insertConfig(record) {
  const placeholders = COLUMNS.map(() => "?").join(", ");
  const values = COLUMNS.map((col) => record[col] ?? null);

  const result = db
    .prepare(
      `
        INSERT INTO configs (${COLUMNS.join(", ")}, updated_at)
        VALUES (${placeholders}, CURRENT_TIMESTAMP)
    `,
    )
    .run(...values);

  return findConfigById(result.lastInsertRowid);
}

export function updateConfig(id, record) {
  const assignments = COLUMNS.map((col) => `${col} = ?`).join(", ");
  const values = [...COLUMNS.map((col) => record[col] ?? null), id];

  db.prepare(
    `
        UPDATE configs
        SET ${assignments},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `,
  ).run(...values);

  return findConfigById(id);
}

export function upsertConfig(data) {
  console.log("Upserting config:", data);
  const { id, ...payload } = data;
  const keys = Object.keys(payload);
  const values = keys.map((key) => payload[key]);
  // UPDATE
  if (id) {
    console.log("--- Update config ---");
    const setClause = keys.map((key) => `${key} = ?`).join(", ");

    const query = `
            UPDATE configs
            SET ${setClause}
            WHERE id = ?
        `;
    return db.prepare(query).run(...values, id);
  }
  // INSERT
  const columns = keys.join(", ");
  const placeholders = keys.map(() => "?").join(", ");

  const query = `
        INSERT INTO configs (${columns})
        VALUES (${placeholders})
    `;
  return db.prepare(query).run(...values);
}

export function deleteConfig(id) {
  return db
    .prepare(
      `
        DELETE FROM configs
        WHERE id = ?
    `,
    )
    .run(id);
}
