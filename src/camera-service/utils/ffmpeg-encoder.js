import { execSync } from "node:child_process";
import { config } from "../config.js";
import { resolveFfmpegPath } from "../../utils/ffmpeg-path.js";

/** @type {string | null} */
let cachedActiveEncoder = null;

/** @type {Set<string> | null} */
let cachedEncoders = null;

function getFfmpegBinary() {
  if (config.ffmpegPath) {
    process.env.FFMPEG_PATH = config.ffmpegPath;
  }
  return resolveFfmpegPath();
}

function listEncoders() {
  if (cachedEncoders) return cachedEncoders;

  const binary = getFfmpegBinary();
  if (!binary) {
    cachedEncoders = new Set();
    return cachedEncoders;
  }

  try {
    const output = execSync(`"${binary}" -hide_banner -encoders`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const encoders = new Set();
    for (const line of output.split("\n")) {
      const match = line.match(/^\s*([AVSFDKRCO\.]{6})\s+(\S+)/);
      if (!match) continue;
      const flags = match[1];
      const name = match[2];
      if (flags.includes("V") && flags.includes("E")) {
        encoders.add(name);
      }
    }
    cachedEncoders = encoders;
    return encoders;
  } catch {
    cachedEncoders = new Set();
    return cachedEncoders;
  }
}

function encoderExists(name) {
  return listEncoders().has(name);
}

/** Encoder video đang dùng (cache sau lần resolve đầu). */
export function resolveActiveVideoEncoder() {
  if (cachedActiveEncoder) return cachedActiveEncoder;

  const requested = config.ffmpegVideoEncoder?.trim() || "";
  const fallback = config.ffmpegVideoEncoderFallback?.trim() || "libx264";

  if (!requested) {
    console.warn(`[ffmpeg] FFMPEG_VIDEO_ENCODER chưa set — dùng ${fallback}`);
    cachedActiveEncoder = fallback;
    return cachedActiveEncoder;
  }

  if (encoderExists(requested)) {
    cachedActiveEncoder = requested;
    console.log(`[ffmpeg] video encoder: ${cachedActiveEncoder}`);
    return cachedActiveEncoder;
  }

  console.warn(
    `[ffmpeg] ${requested} không khả dụng trên máy này — fallback ${fallback}`,
  );
  cachedActiveEncoder = fallback;
  console.log(`[ffmpeg] video encoder: ${cachedActiveEncoder}`);
  return cachedActiveEncoder;
}

/** @param {string} encoder */
export function isSoftwareX264Encoder(encoder) {
  return encoder === "libx264";
}

/** Reset cache — chỉ dùng khi test. */
export function resetEncoderCache() {
  cachedActiveEncoder = null;
  cachedEncoders = null;
}
