import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const DB_DIR = "./data";
const DB_PATH = path.join(DB_DIR, "database.db");

// ======================
// CREATE DATA FOLDER
// ======================
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, {
        recursive: true
    });
    console.log("Created data folder");
}

// ======================
// CHECK DB EXISTS
// ======================

const isNewDatabase = !fs.existsSync(DB_PATH);
// ======================
// CONNECT SQLITE
// ======================

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
// ======================
// INIT DATABASE
// ======================
if (isNewDatabase) {
    console.log("Initializing database...");
    initializeDatabase();
}

function initializeDatabase() {
    db.exec(`
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
        );

        CREATE TABLE IF NOT EXISTS data_logging (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT,
            data_name TEXT,
            raw_data TEXT,
            recipe TEXT,
            convert_data TEXT,
            updated_at TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS configs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hardware_port TEXT,
            communication_type INTEGER,
            quantity INTEGER,
            ip TEXT,
            port INTEGER,
            baud_rate INTEGER,
            data_bits INTEGER,
            parity_bits INTEGER,
            stop_bits INTEGER,
            updated_at TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    console.log("Database initialized");
}

export default db;