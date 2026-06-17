function encodeCredential(value) {
  return encodeURIComponent(value);
}

function rtspPathForSubtype(camera, subtype) {
  if (subtype === 0) return camera.rtsp_path_main;
  if (subtype === 1) return camera.rtsp_path_sub;
  if (subtype === 2) return camera.rtsp_path_mobile;
  return camera.rtsp_path_main;
}

/** @param {import('../repositories/camera.repository.js').ReturnType<typeof import('../repositories/camera.repository.js').findCameraWithSecretsById>} camera @param {0 | 1 | 2} subtype */
export function buildRtspUrl(camera, subtype = 0) {
  if (camera.rtsp_url_override) {
    return camera.rtsp_url_override;
  }

  const pathPart = rtspPathForSubtype(camera, subtype);
  const normalizedPath = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
  return `rtsp://${encodeCredential(camera.username)}:${encodeCredential(camera.password)}@${camera.host}:${camera.rtsp_port}${normalizedPath}`;
}

/** @param {string | null | undefined} rtspUrl */
export function maskRtspUrl(rtspUrl) {
  if (!rtspUrl) return null;
  return rtspUrl.replace(/\/\/([^:@/]+):([^@/]+)@/, "//$1:***@");
}
