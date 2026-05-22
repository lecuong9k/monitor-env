import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const DB_DIR = "./data";
const DB_PATH = path.join(DB_DIR, "database.db");

/** Định nghĩa bảng — thêm bảng mới vào đây, startup sẽ tự tạo nếu thiếu. */
const TABLE_DEFINITIONS = {
  modbus_rtu: `
    CREATE TABLE IF NOT EXISTS modbus_rtu (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT,
        hardware_port TEXT,
        data_name TEXT,
        data_type TEXT,
        function_code TEXT,
        register_address INTEGER,
        data_format INTEGER DEFAULT 0,
        byte_order INTEGER,
        unit TEXT,
        status INTEGER DEFAULT 1,
        config_id INTEGER,
        updated_at TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `,
  data_logging: `
    CREATE TABLE IF NOT EXISTS data_logging (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT,
        data_name TEXT,
        raw_data TEXT,
        recipe TEXT,
        convert_data TEXT,
        updated_at TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `,
  configs: `
    CREATE TABLE IF NOT EXISTS configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hardware_port TEXT,
        quantity INTEGER,
        communication_type INTEGER,
        ip TEXT,
        port INTEGER,
        baud_rate INTEGER,
        data_bits INTEGER,
        parity_bits INTEGER,
        stop_bits INTEGER,
        updated_at TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `,
};

/** Index bổ sung (dùng IF NOT EXISTS). */
const INDEX_DEFINITIONS = [];

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
  console.log("Created data folder");
}

const isNewDatabase = !fs.existsSync(DB_PATH);
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
// ======================
// INIT DATABASE
// ======================
if (isNewDatabase) {
  console.log("Initializing database...");
}

ensureTables();
ensureColumns();

function tableExists(tableName) {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(tableName);
  return Boolean(row);
}

/**
 * Kiểm tra từng bảng trong TABLE_DEFINITIONS;
 * bảng nào thiếu thì CREATE, sau đó đảm bảo index.
 */
function ensureTables() {
  const created = [];

  for (const [tableName, createSql] of Object.entries(TABLE_DEFINITIONS)) {
    if (tableExists(tableName)) continue;
    db.exec(createSql);
    created.push(tableName);
  }

  for (const indexSql of INDEX_DEFINITIONS) {
    db.exec(indexSql);
  }

  if (created.length > 0) {
    console.log(`Created missing tables: ${created.join(", ")}`);
  } else if (isNewDatabase) {
    console.log("Database initialized");
  }
}

function columnExists(tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((col) => col.name === columnName);
}

/** Bổ sung cột mới cho DB đã tạo trước khi đổi schema (ALTER TABLE). */
function ensureColumns() {
  const added = [];

  if (tableExists("modbus_rtu") && !columnExists("modbus_rtu", "config_id")) {
    db.exec(`ALTER TABLE modbus_rtu ADD COLUMN config_id INTEGER`);
    added.push("modbus_rtu.config_id");
  }

  if (tableExists("configs") && !columnExists("configs", "quantity")) {
    db.exec(`ALTER TABLE configs ADD COLUMN quantity INTEGER`);
    added.push("configs.quantity");
  }

  if (
    tableExists("data_logging") &&
    !columnExists("data_logging", "device_id")
  ) {
    db.exec(`ALTER TABLE data_logging ADD COLUMN device_id TEXT`);
    added.push("data_logging.device_id");
  }

  if (
    tableExists("data_logging") &&
    columnExists("data_logging", "modbus_rtu_id")
  ) {
    db.exec(`
      UPDATE data_logging
      SET device_id = (
        SELECT m.device_id FROM modbus_rtu m
        WHERE m.id = data_logging.modbus_rtu_id
        LIMIT 1
      )
      WHERE (device_id IS NULL OR device_id = '')
        AND modbus_rtu_id IS NOT NULL
    `);
  }

  if (added.length > 0) {
    console.log(`Added missing columns: ${added.join(", ")}`);
  }
}

export default db;
