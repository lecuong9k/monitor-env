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

export function upsertModbusRtu(record) {
  if (!record || typeof record !== "object") {
    throw new Error("Modbus RTU record is required");
  }
  if (record.id) {
    return updateModbusRtu(record.id, record);
  }
  return insertModbusRtu(record);
}

export function deleteModbusRtu(id) {
  return db
    .prepare(
      `
        DELETE FROM modbus_rtu
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
    `,
    )
    .all(hardwarePort);
}
