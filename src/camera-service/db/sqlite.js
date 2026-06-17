import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const beRoot = path.join(__dirname, "..", "..", "..");
const DB_DIR = path.join(beRoot, "data");
const DB_PATH = path.join(DB_DIR, "camera.db");

const TABLE_DEFINITIONS = {
  cameras: `
    CREATE TABLE IF NOT EXISTS cameras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      onvif_port INTEGER DEFAULT 80,
      rtsp_port INTEGER DEFAULT 554,
      username TEXT NOT NULL,
      password_enc TEXT NOT NULL,
      rtsp_url_override TEXT,
      rtsp_path_main TEXT,
      rtsp_path_sub TEXT,
      rtsp_path_mobile TEXT,
      ptz_enabled INTEGER DEFAULT 1,
      mediamtx_path TEXT NOT NULL UNIQUE,
      stream_quality TEXT DEFAULT 'main',
      status INTEGER DEFAULT 1,
      home_preset_token TEXT DEFAULT '255',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME
    )
  `,
};

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const isNewDatabase = !fs.existsSync(DB_PATH);
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

function tableExists(tableName) {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(tableName);
  return Boolean(row);
}

for (const [tableName, createSql] of Object.entries(TABLE_DEFINITIONS)) {
  if (!tableExists(tableName)) {
    db.exec(createSql);
    if (isNewDatabase) {
      console.log(`[camera-db] Created table: ${tableName}`);
    }
  }
}

export default db;
