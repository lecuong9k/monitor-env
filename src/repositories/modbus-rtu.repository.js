import db from "../database/sqlite.js";

const COLUMNS = [
  "device_id",
  "hardware_port",
  "data_name",
  "data_type",
  "function_code",
  "register_address",
  "data_format",
  "byte_order",
  "unit",
  "status",
  "config_id",
];

export function findAllModbusRtu() {
  return db
    .prepare(
      `
        SELECT *
        FROM modbus_rtu
        WHERE COALESCE(isDelete, 0) = 0
        ORDER BY id DESC
    `,
    )
    .all();
}

export function findModbusRtuById(id) {
  return db
    .prepare(
      `
        SELECT *
        FROM modbus_rtu
        WHERE id = ?
          AND COALESCE(isDelete, 0) = 0
    `,
    )
    .get(id);
}

export function insertModbusRtu(record) {
  const placeholders = COLUMNS.map(() => "?").join(", ");
  const values = COLUMNS.map((col) => record[col] ?? null);

  const result = db
    .prepare(
      `
        INSERT INTO modbus_rtu (${COLUMNS.join(", ")}, updated_at)
        VALUES (${placeholders}, CURRENT_TIMESTAMP)
    `,
    )
    .run(...values);

  return findModbusRtuById(result.lastInsertRowid);
}

export function updateModbusRtu(id, record) {
  const assignments = COLUMNS.map((col) => `${col} = ?`).join(", ");
  const values = [...COLUMNS.map((col) => record[col] ?? null), id];

  db.prepare(
    `
        UPDATE modbus_rtu
        SET ${assignments},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `,
  ).run(...values);

  return findModbusRtuById(id);
}

export function upsertModbusRtu(data) {
  const { id, ...payload } = data;
  if (!id && payload.isDelete == null) {
    payload.isDelete = 0;
  }
  const keys = Object.keys(payload);
  const values = keys.map((key) => payload[key]);

  // UPDATE
  if (id) {
    const setClause = keys.map((key) => `${key} = ?`).join(", ");

    const query = `
            UPDATE modbus_rtu
            SET ${setClause}
            WHERE id = ?
        `;
    return db.prepare(query).run(...values, id);
  }
  // INSERT
  const columns = keys.join(", ");
  const placeholders = keys.map(() => "?").join(", ");

  const query = `
        INSERT INTO modbus_rtu (${columns})
        VALUES (${placeholders})
    `;
  return db.prepare(query).run(...values);
}

export function deleteModbusRtu(id) {
  return db
    .prepare(
      `
        UPDATE modbus_rtu
        SET isDelete = 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `,
    )
    .run(id);
}

export function findDevicesByHardwarePort(hardwarePort) {
  return db
    .prepare(
      `
        SELECT *
        FROM modbus_rtu
        WHERE hardware_port = ?
          AND COALESCE(isDelete, 0) = 0
    `,
    )
    .all(hardwarePort);
}
