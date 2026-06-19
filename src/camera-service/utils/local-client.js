/**
 * Nhận diện client UI local MiniPC (localhost / IP LAN).
 * @param {{ origin?: string | null, host?: string | null }} clientContext
 */
export function isLocalClient(clientContext = {}) {
  const origin = clientContext.origin?.trim();
  if (origin && isPrivateLanOrigin(origin)) return true;

  const host = clientContext.host?.split(",")[0]?.trim();
  if (!host) return false;

  const hostname = extractHostname(host);
  if (!hostname) return false;

  return isPrivateLanHostname(hostname);
}

function isPrivateLanOrigin(origin) {
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== "http:" && protocol !== "https:") return false;
    return isPrivateLanHostname(hostname);
  } catch {
    return false;
  }
}

function extractHostname(host) {
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end !== -1 ? host.slice(1, end) : null;
  }
  if (host.includes(":")) {
    return host.slice(0, host.lastIndexOf(":"));
  }
  return host;
}

function isPrivateLanHostname(hostname) {
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  ) {
    return true;
  }
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return true;
  }
  return false;
}
