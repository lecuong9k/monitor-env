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

export function upsertConfig(record) {
  if (!record || typeof record !== "object") {
    throw new Error("Config record is required");
  }
  if (record.id) {
    return updateConfig(record.id, record);
  }
  return insertConfig(record);
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
