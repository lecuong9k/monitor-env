/**
 * Nạp biến môi trường một lần cho toàn process.
 * Thứ tự: .env.{NODE_ENV} → .env (legacy) → .env.local (override)
 * Chạy qua: node --import ./src/load-env.js src/app.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const nodeEnv = process.env.NODE_ENV || "development";
const envByMode = path.join(rootDir, `.env.${nodeEnv}`);
const envLegacy = path.join(rootDir, ".env");
const envLocal = path.join(rootDir, ".env.local");

if (fs.existsSync(envByMode)) {
  config({ path: envByMode });
} else if (fs.existsSync(envLegacy)) {
  config({ path: envLegacy });
}

if (fs.existsSync(envLocal)) {
  config({ path: envLocal, override: true });
}
