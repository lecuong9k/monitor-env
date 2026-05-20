import Database from "better-sqlite3";

const db = new Database("database.db");
db.pragma("journal_mode = WAL");
db.prepare(`
    CREATE TABLE IF NOT EXISTS configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE,
        value TEXT,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`).run();

export default db;