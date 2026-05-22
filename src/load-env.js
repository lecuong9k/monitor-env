/**
 * Nạp biến môi trường một lần cho toàn process.
 * Chạy qua: node --import ./src/load-env.js src/app.js
 * (xem scripts trong package.json — không cần import file này trong app.js)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const rootDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
);

const envFile = path.join(rootDir, ".env");
const envLocalFile = path.join(rootDir, ".env.local");

if (fs.existsSync(envFile)) {
    config({ path: envFile });
}

if (fs.existsSync(envLocalFile)) {
    config({ path: envLocalFile, override: true });
}
