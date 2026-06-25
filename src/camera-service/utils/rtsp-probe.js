import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config.js";
import { resolveFfprobePath } from "../../utils/ffmpeg-path.js";

const execFileAsync = promisify(execFile);

/**
 * @typedef {{
 *   video: { codec: string; profile: string; pixFmt: string } | null;
 *   audio: { codec: string } | null;
 *   hasAudio: boolean;
 *   videoCopyable: boolean;
 *   audioCopyable: boolean;
 * }} RtspStreamProbe
 */

const COPYABLE_VIDEO_CODECS = new Set(["h264"]);
/** WebRTC/WHEP ổn định nhất với baseline — main/high copy dễ gây đứng hình/macroblock. */
const COPYABLE_VIDEO_PROFILES = new Set(["baseline", "constrained baseline"]);
const COPYABLE_PIX_FMTS = new Set(["yuv420p", "yuvj420p"]);

function getFfprobeBinary() {
  if (config.ffmpegPath) {
    process.env.FFMPEG_PATH = config.ffmpegPath;
  }
  return resolveFfprobePath();
}

/**
 * @param {Record<string, string>} stream
 */
function parseStream(stream) {
  return {
    codec: String(stream.codec_name || "").toLowerCase(),
    profile: String(stream.profile || "").toLowerCase(),
    pixFmt: String(stream.pix_fmt || "").toLowerCase(),
    type: String(stream.codec_type || "").toLowerCase(),
  };
}

/**
 * @param {ReturnType<typeof parseStream> | null | undefined} video
 */
export function isVideoCopyableFromProbe(video) {
  if (!video) return false;
  if (!COPYABLE_VIDEO_CODECS.has(video.codec)) return false;
  if (!COPYABLE_PIX_FMTS.has(video.pixFmt)) return false;
  if (!video.profile) return true;
  return COPYABLE_VIDEO_PROFILES.has(video.profile);
}

/**
 * @param {ReturnType<typeof parseStream> | null | undefined} audio
 */
export function isAudioCopyableFromProbe(audio) {
  if (!audio) return true;
  return audio.codec === "aac";
}

/**
 * @param {string} rtspUrl
 * @returns {Promise<RtspStreamProbe>}
 */
export async function probeRtspStream(rtspUrl) {
  const ffprobe = getFfprobeBinary();
  if (!ffprobe) {
    return {
      video: null,
      audio: null,
      hasAudio: false,
      videoCopyable: false,
      audioCopyable: true,
    };
  }

  try {
    const { stdout } = await execFileAsync(
      ffprobe,
      [
        "-v",
        "error",
        "-rtsp_transport",
        "tcp",
        "-select_streams",
        "v:0,a:0?",
        "-show_entries",
        "stream=codec_type,codec_name,profile,pix_fmt",
        "-of",
        "json",
        rtspUrl,
      ],
      { timeout: 15_000, maxBuffer: 1024 * 1024 },
    );

    const payload = JSON.parse(stdout);
    const streams = Array.isArray(payload.streams) ? payload.streams : [];
    let videoStream = null;
    let audioStream = null;

    for (const raw of streams) {
      const parsed = parseStream(raw);
      if (parsed.type === "video" && !videoStream) {
        videoStream = parsed;
      }
      if (parsed.type === "audio" && !audioStream) {
        audioStream = parsed;
      }
    }

    const video = videoStream
      ? {
          codec: videoStream.codec,
          profile: videoStream.profile,
          pixFmt: videoStream.pixFmt,
        }
      : null;
    const audio = audioStream ? { codec: audioStream.codec } : null;

    return {
      video,
      audio,
      hasAudio: Boolean(audio),
      videoCopyable: isVideoCopyableFromProbe(videoStream),
      audioCopyable: isAudioCopyableFromProbe(audioStream),
    };
  } catch (err) {
    console.warn(
      `[rtsp-probe] Không probe được stream:`,
      err instanceof Error ? err.message : err,
    );
    return {
      video: null,
      audio: null,
      hasAudio: false,
      videoCopyable: false,
      audioCopyable: true,
    };
  }
}
