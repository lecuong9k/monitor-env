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

if (isNewDatabase) {
  console.log("Initializing database...");
}

ensureTables();

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

export default db;
