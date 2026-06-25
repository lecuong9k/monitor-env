import { accessSync, constants } from "node:fs";
import { execSync } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";

const CANDIDATES = [
  process.env.FFMPEG_PATH,
  ffmpegStatic,
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
].filter(Boolean);

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveFfmpegPath() {
  for (const path of CANDIDATES) {
    if (isExecutable(path)) return path;
  }

  try {
    const found = execSync("which ffmpeg", { encoding: "utf8" }).trim();
    if (found && isExecutable(found)) return found;
  } catch {
    // not in PATH
  }

  return null;
}

const FFPROBE_CANDIDATES = [
  process.env.FFPROBE_PATH,
  "/opt/homebrew/bin/ffprobe",
  "/usr/local/bin/ffprobe",
].filter(Boolean);

export function resolveFfprobePath() {
  const ffmpeg = resolveFfmpegPath();
  if (ffmpeg) {
    const derived = ffmpeg.replace(/ffmpeg([^/\\]*)$/, "ffprobe$1");
    if (derived !== ffmpeg && isExecutable(derived)) return derived;
  }

  for (const candidate of FFPROBE_CANDIDATES) {
    if (isExecutable(candidate)) return candidate;
  }

  try {
    const found = execSync("which ffprobe", { encoding: "utf8" }).trim();
    if (found && isExecutable(found)) return found;
  } catch {
    // not in PATH
  }

  return null;
}

export function getFfmpegInstallHint() {
  return "Chạy npm install để tải ffmpeg-static, hoặc set FFMPEG_PATH trong .env";
}
