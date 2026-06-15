/** @typedef {'main' | 'sub' | 'mobile'} StreamQualityId */
/** @typedef {'lowLatency' | 'stable'} StreamInputProfile */
/** @typedef {'copyFirst' | 'transcode'} StreamTranscodePolicy */

/**
 * @typedef {{
 *   preset: string;
 *   fps: number;
 *   maxrate: string;
 *   bufsize: string;
 *   scale?: string;
 * }} StreamTranscodeOptions
 */

/** @type {Record<StreamQualityId, {
 *   id: StreamQualityId;
 *   label: string;
 *   description: string;
 *   subtype: 0 | 1 | 2;
 *   inputProfile: StreamInputProfile;
 *   transcodePolicy: StreamTranscodePolicy;
 *   transcode: StreamTranscodeOptions;
 * }>} */
export const STREAM_QUALITY_PRESETS = {
  main: {
    id: "main",
    label: "MainStream",
    description: "subtype=0 · main stream",
    subtype: 0,
    inputProfile: "lowLatency",
    transcodePolicy: "copyFirst",
    transcode: {
      preset: "veryfast",
      fps: 25,
      maxrate: "6M",
      bufsize: "12M",
    },
  },
  sub: {
    id: "sub",
    label: "SubStream",
    description: "subtype=1 · sub stream",
    subtype: 1,
    inputProfile: "stable",
    // Sub stream camera thường HEVC / timestamp lệch — chuẩn hóa H.264 cho mpegts.js
    transcodePolicy: "transcode",
    transcode: {
      preset: "veryfast",
      fps: 20,
      maxrate: "2.5M",
      bufsize: "5M",
      scale: "scale=-2:720",
    },
  },
  mobile: {
    id: "mobile",
    label: "MobileStream",
    description: "subtype=2 · mobile stream",
    subtype: 2,
    inputProfile: "stable",
    transcodePolicy: "copyFirst",
    transcode: {
      preset: "ultrafast",
      fps: 15,
      maxrate: "1.5M",
      bufsize: "3M",
      scale: "scale=-2:480",
    },
  },
};

const LEGACY_QUALITY_MAP = {
  low: "mobile",
  balanced: "sub",
  high: "main",
  mainstream: "main",
  substream: "sub",
  mobilestream: "mobile",
};

/** @param {string} id */
export function resolveStreamQualityId(id) {
  const normalized = String(id || "main")
    .trim()
    .toLowerCase();
  if (normalized in STREAM_QUALITY_PRESETS) {
    return /** @type {StreamQualityId} */ (normalized);
  }
  if (normalized in LEGACY_QUALITY_MAP) {
    return /** @type {StreamQualityId} */ (LEGACY_QUALITY_MAP[normalized]);
  }
  return "main";
}

export function listStreamQualityOptions() {
  return Object.values(STREAM_QUALITY_PRESETS).map(
    ({ id, label, description }) => ({ id, label, description }),
  );
}

/** @param {StreamQualityId} id */
export function getStreamQualityPreset(id) {
  return STREAM_QUALITY_PRESETS[resolveStreamQualityId(id)];
}
