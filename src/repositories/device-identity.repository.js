import db from "../database/sqlite.js";

export function findMachineCode() {
  const row = db
    .prepare(`SELECT machine_code FROM device_identity WHERE id = 1`)
    .get();
  return row?.machine_code ? String(row.machine_code).trim() : "";
}

export function insertMachineCode(machineCode) {
  const code = String(machineCode || "").trim();
  const now = new Date().toISOString();
  db.prepare(
    `
      INSERT INTO device_identity (id, machine_code, created_at, updated_at)
      VALUES (1, ?, ?, ?)
    `,
  ).run(code, now, now);
  return code;
}
