import db from "../db/sqlite.js";
import { decryptSecret, encryptSecret } from "../../utils/secrets.js";

const RTSP_TEMPLATE = "/rtsp/streaming?channel=01&subtype=";

const SELECT_PUBLIC = `
  id, name, host, onvif_port, rtsp_port, username,
  rtsp_url_override, rtsp_path_main, rtsp_path_sub, rtsp_path_mobile,
  ptz_enabled, mediamtx_path, stream_quality, status, home_preset_token,
  created_at, updated_at
`;

/** @param {Record<string, unknown>} row */
function mapRow(row) {
  if (!row) return null;
  return {
    ...row,
    ptz_enabled: Boolean(row.ptz_enabled),
    status: Number(row.status ?? 1),
  };
}

/** @param {Record<string, unknown>} row */
export function toPublicCamera(row) {
  const cam = mapRow(row);
  if (!cam) return null;
  return {
    id: cam.id,
    name: cam.name,
    ptz_enabled: cam.ptz_enabled,
    mediamtx_path: cam.mediamtx_path,
  };
}

/** @param {Record<string, unknown>} row — không trả password */
export function toAdminCamera(row) {
  const cam = mapRow(row);
  if (!cam) return null;
  return {
    id: cam.id,
    name: cam.name,
    host: cam.host,
    onvif_port: cam.onvif_port,
    rtsp_port: cam.rtsp_port,
    username: cam.username,
    rtsp_url_override: cam.rtsp_url_override,
    rtsp_path_main: cam.rtsp_path_main,
    rtsp_path_sub: cam.rtsp_path_sub,
    rtsp_path_mobile: cam.rtsp_path_mobile,
    ptz_enabled: cam.ptz_enabled,
    mediamtx_path: cam.mediamtx_path,
    stream_quality: cam.stream_quality,
    home_preset_token: cam.home_preset_token,
  };
}

/** @param {Record<string, unknown>} row */
export function toCameraWithSecrets(row) {
  if (!row) return null;
  const { password_enc, ...rest } = row;
  return {
    ...mapRow(rest),
    password: decryptSecret(password_enc),
  };
}

export function findAllCameras({ activeOnly = true } = {}) {
  const sql = activeOnly
    ? `SELECT ${SELECT_PUBLIC} FROM cameras WHERE status = 1 ORDER BY id ASC`
    : `SELECT ${SELECT_PUBLIC} FROM cameras ORDER BY id ASC`;
  return db.prepare(sql).all().map(mapRow);
}

export function findCameraById(id) {
  const row = db
    .prepare(`SELECT ${SELECT_PUBLIC} FROM cameras WHERE id = ?`)
    .get(id);
  return mapRow(row);
}

export function findCameraWithSecretsById(id) {
  const row = db
    .prepare(`SELECT ${SELECT_PUBLIC}, password_enc FROM cameras WHERE id = ?`)
    .get(id);
  return toCameraWithSecrets(row);
}

export function countCameras() {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM cameras WHERE status = 1").get()?.n ??
    0
  );
}

/**
 * @param {{
 *   name: string;
 *   host: string;
 *   username: string;
 *   password: string;
 *   onvif_port?: number;
 *   rtsp_port?: number;
 *   rtsp_url_override?: string | null;
 *   rtsp_path_main?: string;
 *   rtsp_path_sub?: string;
 *   rtsp_path_mobile?: string;
 *   ptz_enabled?: boolean;
 *   mediamtx_path: string;
 *   stream_quality?: string;
 *   home_preset_token?: string;
 * }} data
 */
export function insertCamera(data) {
  const passwordEnc = encryptSecret(data.password);
  const result = db
    .prepare(
      `
      INSERT INTO cameras (
        name, host, onvif_port, rtsp_port, username, password_enc,
        rtsp_url_override, rtsp_path_main, rtsp_path_sub, rtsp_path_mobile,
        ptz_enabled, mediamtx_path, stream_quality, home_preset_token, updated_at
      ) VALUES (
        @name, @host, @onvif_port, @rtsp_port, @username, @password_enc,
        @rtsp_url_override, @rtsp_path_main, @rtsp_path_sub, @rtsp_path_mobile,
        @ptz_enabled, @mediamtx_path, @stream_quality, @home_preset_token, datetime('now')
      )
    `,
    )
    .run({
      name: data.name,
      host: data.host,
      onvif_port: data.onvif_port ?? 80,
      rtsp_port: data.rtsp_port ?? 554,
      username: data.username,
      password_enc: passwordEnc,
      rtsp_url_override: data.rtsp_url_override ?? null,
      rtsp_path_main: data.rtsp_path_main ?? `${RTSP_TEMPLATE}0`,
      rtsp_path_sub: data.rtsp_path_sub ?? `${RTSP_TEMPLATE}1`,
      rtsp_path_mobile: data.rtsp_path_mobile ?? `${RTSP_TEMPLATE}2`,
      ptz_enabled: data.ptz_enabled === false ? 0 : 1,
      mediamtx_path: data.mediamtx_path,
      stream_quality: data.stream_quality ?? "main",
      home_preset_token: data.home_preset_token ?? "255",
    });

  return findCameraById(Number(result.lastInsertRowid));
}

/**
 * @param {number} id
 * @param {Partial<{
 *   name: string;
 *   host: string;
 *   username: string;
 *   password: string;
 *   onvif_port: number;
 *   rtsp_port: number;
 *   rtsp_url_override: string | null;
 *   rtsp_path_main: string;
 *   rtsp_path_sub: string;
 *   rtsp_path_mobile: string;
 *   ptz_enabled: boolean;
 *   mediamtx_path: string;
 *   stream_quality: string;
 *   home_preset_token: string;
 *   status: number;
 * }>} data
 */
export function updateCamera(id, data) {
  const existing = findCameraById(id);
  if (!existing) return null;

  const fields = [];
  const params = { id };

  const setters = {
    name: "name",
    host: "host",
    username: "username",
    onvif_port: "onvif_port",
    rtsp_port: "rtsp_port",
    rtsp_url_override: "rtsp_url_override",
    rtsp_path_main: "rtsp_path_main",
    rtsp_path_sub: "rtsp_path_sub",
    rtsp_path_mobile: "rtsp_path_mobile",
    mediamtx_path: "mediamtx_path",
    stream_quality: "stream_quality",
    home_preset_token: "home_preset_token",
    status: "status",
  };

  for (const [key, col] of Object.entries(setters)) {
    if (data[key] !== undefined) {
      fields.push(`${col} = @${col}`);
      params[col] = key === "ptz_enabled" ? (data[key] ? 1 : 0) : data[key];
    }
  }

  if (data.ptz_enabled !== undefined) {
    fields.push("ptz_enabled = @ptz_enabled");
    params.ptz_enabled = data.ptz_enabled ? 1 : 0;
  }

  if (data.password) {
    fields.push("password_enc = @password_enc");
    params.password_enc = encryptSecret(data.password);
  }

  if (fields.length === 0) return existing;

  fields.push("updated_at = datetime('now')");

  db.prepare(`UPDATE cameras SET ${fields.join(", ")} WHERE id = @id`).run(
    params,
  );

  return findCameraById(id);
}

export function softDeleteCamera(id) {
  return updateCamera(id, { status: 0 });
}
