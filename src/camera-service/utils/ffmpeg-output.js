import {
  isSoftwareX264Encoder,
  resolveActiveVideoEncoder,
} from "./ffmpeg-encoder.js";

/**
 * @typedef {import('./rtsp-probe.js').RtspStreamProbe} RtspStreamProbe
 */

/**
 * @param {import('fluent-ffmpeg').FfmpegCommand} cmd
 * @param {{ transcode: boolean; quality: { transcode: { preset: string; fps: number; gop?: number; maxrate: string; bufsize: string; scale?: string } }; encoder?: string }} options
 */
export function applyVideoOutput(cmd, { transcode, quality, encoder }) {
  if (!transcode) {
    return cmd.videoCodec("copy");
  }

  const tc = quality.transcode;
  const activeEncoder = encoder || resolveActiveVideoEncoder();
  const gop = tc.gop ?? tc.fps;

  if (tc.scale) {
    cmd.videoFilters(tc.scale);
  }

  if (activeEncoder === "h264_v4l2m2m") {
    return cmd
      .videoCodec("h264_v4l2m2m")
      .addOutputOption("-pix_fmt", "yuv420p")
      .addOutputOption("-g", String(gop))
      .addOutputOption("-b:v", tc.maxrate);
  }

  return cmd
    .videoCodec("libx264")
    .addOutputOption("-preset", tc.preset)
    .addOutputOption("-tune", "zerolatency")
    .addOutputOption("-profile:v", "baseline")
    .addOutputOption("-pix_fmt", "yuv420p")
    .addOutputOption("-g", String(gop))
    .addOutputOption("-maxrate", tc.maxrate)
    .addOutputOption("-bufsize", tc.bufsize)
    .addOutputOption("-sc_threshold", "0")
    .addOutputOption(
      "-x264-params",
      "ref=1:bframes=0:rc-lookahead=0:sliced-threads=1",
    );
}

/**
 * @param {import('fluent-ffmpeg').FfmpegCommand} cmd
 * @param {{ probe?: RtspStreamProbe | null }} [options]
 */
export function applyAudioOutput(cmd, { probe = null } = {}) {
  cmd.outputOptions(["-map", "0:v:0", "-map", "0:a:0?"]);

  if (probe?.audioCopyable) {
    return cmd.audioCodec("copy");
  }

  return cmd
    .audioCodec("aac")
    .addOutputOption("-ar", "44100")
    .addOutputOption("-ac", "1")
    .addOutputOption("-b:a", "64k");
}

/**
 * @param {string} encoder
 */
export function getFallbackEncoder(encoder) {
  if (isSoftwareX264Encoder(encoder)) return null;
  return "libx264";
}
