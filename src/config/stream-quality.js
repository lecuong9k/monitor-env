/** @typedef {'main' | 'sub' | 'mobile'} StreamQualityId */
/** @typedef {'lowLatency' | 'stable'} StreamInputProfile */
/** @typedef {'copyFirst' | 'transcode'} StreamTranscodePolicy */

/**
 * @typedef {{
 *   preset: string;
 *   fps: number;
 *   gop: number;
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
    label: "HD",
    description: "subtype=0 · HD",
    subtype: 0,
    inputProfile: "lowLatency",
    transcodePolicy: "copyFirst",
    transcode: {
      preset: "ultrafast",
      fps: 25,
      gop: 25,
      maxrate: "4M",
      bufsize: "8M",
    },
  },
  sub: {
    id: "sub",
    label: "Tiêu chuẩn",
    description: "subtype=1 · tiêu chuẩn",
    subtype: 1,
    inputProfile: "stable",
    transcodePolicy: "copyFirst",
    transcode: {
      preset: "ultrafast",
      fps: 20,
      gop: 20,
      maxrate: "2M",
      bufsize: "4M",
    },
  },
  mobile: {
    id: "mobile",
    label: "Tiết kiệm",
    description: "subtype=2 · tiết kiệm",
    subtype: 2,
    inputProfile: "stable",
    transcodePolicy: "copyFirst",
    transcode: {
      preset: "ultrafast",
      fps: 15,
      gop: 15,
      maxrate: "1.2M",
      bufsize: "2.4M",
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

const QUALITY_PATH_FIELDS = {
  main: "rtsp_path_main",
  sub: "rtsp_path_sub",
  mobile: "rtsp_path_mobile",
};

/** @param {string | null | undefined} path */
function isRtspPathConfigured(path) {
  return Boolean(String(path || "").trim());
}

/**
 * @param {{
 *   rtsp_url_override?: string | null;
 *   rtsp_path_main?: string | null;
 *   rtsp_path_sub?: string | null;
 *   rtsp_path_mobile?: string | null;
 * } | null | undefined} camera
 */
export function listStreamQualityOptionsForCamera(camera) {
  if (!camera) {
    return listStreamQualityOptions();
  }

  if (isRtspPathConfigured(camera.rtsp_url_override)) {
    const preset = STREAM_QUALITY_PRESETS.main;
    return [
      { id: preset.id, label: preset.label, description: preset.description },
    ];
  }

  return Object.values(STREAM_QUALITY_PRESETS)
    .filter((preset) =>
      isRtspPathConfigured(camera[QUALITY_PATH_FIELDS[preset.id]]),
    )
    .map(({ id, label, description }) => ({ id, label, description }));
}

/**
 * @param {{
 *   rtsp_url_override?: string | null;
 *   rtsp_path_main?: string | null;
 *   rtsp_path_sub?: string | null;
 *   rtsp_path_mobile?: string | null;
 * } | null | undefined} camera
 * @param {string} [requestedId]
 */
export function pickStreamQualityForCamera(camera, requestedId) {
  const options = listStreamQualityOptionsForCamera(camera);
  if (!options.length) {
    return resolveStreamQualityId(requestedId);
  }

  const resolved = resolveStreamQualityId(requestedId);
  if (options.some((option) => option.id === resolved)) {
    return resolved;
  }

  for (const fallbackId of ["mobile", "sub", "main"]) {
    if (options.some((option) => option.id === fallbackId)) {
      return /** @type {StreamQualityId} */ (fallbackId);
    }
  }

  return /** @type {StreamQualityId} */ (options[0].id);
}

/** @param {StreamQualityId} id */
export function getStreamQualityPreset(id) {
  return STREAM_QUALITY_PRESETS[resolveStreamQualityId(id)];
}
