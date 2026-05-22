import db from "../database/sqlite.js";

const COLUMNS = ["device_id", "data_name", "raw_data", "recipe", "convert_data"];

export function findDataLoggingByDeviceId(deviceId) {
  return db
    .prepare(
      `
        SELECT *
        FROM data_logging
        WHERE device_id = ?
        ORDER BY id ASC
    `,
    )
    .all(deviceId);
}

export function findAllDataLogging() {
  return db
    .prepare(
      `
        SELECT *
        FROM data_logging
        ORDER BY id DESC
    `,
    )
    .all();
}

export function findDataLoggingById(id) {
  return db
    .prepare(
      `
        SELECT *
        FROM data_logging
        WHERE id = ?
    `,
    )
    .get(id);
}

export function insertDataLogging(record) {
  const placeholders = COLUMNS.map(() => "?").join(", ");
  const values = COLUMNS.map((col) => record[col] ?? null);

  const result = db
    .prepare(
      `
        INSERT INTO data_logging (${COLUMNS.join(", ")}, updated_at)
        VALUES (${placeholders}, CURRENT_TIMESTAMP)
    `,
    )
    .run(...values);

  return findDataLoggingById(result.lastInsertRowid);
}

export function updateDataLogging(id, record) {
  const assignments = COLUMNS.map((col) => `${col} = ?`).join(", ");
  const values = [...COLUMNS.map((col) => record[col] ?? null), id];

  db.prepare(
    `
        UPDATE data_logging
        SET ${assignments},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `,
  ).run(...values);

  return findDataLoggingById(id);
}

export function upsertDataLogging(data) {
  const { id, ...payload } = data;
  const keys = Object.keys(payload);
  const values = keys.map((key) => payload[key]);

  if (id) {
    const setClause = keys.map((key) => `${key} = ?`).join(", ");

    db.prepare(
      `
            UPDATE data_logging
            SET ${setClause}
            WHERE id = ?
        `,
    ).run(...values, id);

    return findDataLoggingById(id);
  }

  return insertDataLogging(payload);
}

export function deleteDataLogging(id) {
  return db
    .prepare(
      `
        DELETE FROM data_logging
        WHERE id = ?
    `,
    )
    .run(id);
}
