import os from "node:os";
import { config } from "../config.js";

function normalizeOrigin(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return String(value).trim().replace(/\/$/, "");
  }
}

function monitorEnvHttpPort() {
  return (
    Number(process.env.MONITOR_ENV_HTTP_PORT) ||
    Number(process.env.PORT) ||
    3000
  );
}

/** @returns {string[]} */
function getLocalIpv4Addresses() {
  const addresses = new Set(["127.0.0.1", "localhost"]);
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (iface.family === "IPv4" && iface.address) {
        addresses.add(iface.address);
      }
    }
  }
  return [...addresses];
}

/** @returns {string | null} */
function detectMiniPcLanHttpBase() {
  const port = monitorEnvHttpPort();
  const candidates = [];

  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (iface.family !== "IPv4" || iface.internal || !iface.address) continue;
      candidates.push(iface.address);
    }
  }

  const score = (ip) => {
    if (/^192\.168\./.test(ip)) return 0;
    if (/^10\./.test(ip)) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
    return 3;
  };

  candidates.sort((a, b) => score(a) - score(b));
  const best = candidates[0];
  if (!best) return null;

  return `http://${best}:${port}`;
}

/**
 * Client truy cập trực tiếp monitor-env-be (không qua Mbox proxy).
 * @param {{ origin?: string | null, host?: string | null }} clientContext
 */
function isDirectMiniPcClient(clientContext = {}) {
  const origin = normalizeOrigin(clientContext.origin);
  if (!origin) return false;

  try {
    const { hostname } = new URL(origin);
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    ) {
      return true;
    }
    return getLocalIpv4Addresses().includes(hostname);
  } catch {
    return false;
  }
}

/**
 * Base URL HTTP cho ws MPEG-TS fallback.
 * Ưu tiên: PUBLIC_WS_ORIGIN_MAP → PUBLIC_WS_BASE_URL (env) → auto LAN IP → origin trực tiếp.
 *
 * @param {{ origin?: string | null, host?: string | null }} [clientContext]
 * @returns {string | null}
 */
export function resolvePublicWsBaseUrl(clientContext = {}) {
  const origin = normalizeOrigin(clientContext.origin);
  const originMap = config.publicWsOriginMap;

  if (origin && originMap[origin]) {
    return originMap[origin];
  }

  const staticBase = config.publicWsBaseUrl?.replace(/\/$/, "");
  if (staticBase) return staticBase;

  const autoLanBase = detectMiniPcLanHttpBase();
  if (autoLanBase) return autoLanBase;

  if (origin && isDirectMiniPcClient(clientContext)) {
    return origin;
  }

  return null;
}
