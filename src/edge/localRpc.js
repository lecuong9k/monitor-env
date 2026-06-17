const DEFAULT_PORT = 3000;

function getLocalBaseUrl() {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  return `http://127.0.0.1:${port}`;
}

/**
 * @param {{ method?: string, path: string, body?: unknown, headers?: Record<string, string> }} options
 */
export async function executeLocalRpc(options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const path = String(options.path || "").trim();
  const base = getLocalBaseUrl();
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;

  const headers = {
    Accept: "application/json",
    ...(options.headers || {}),
  };

  const relayMode = String(headers["X-Edge-Relay"] || "")
    .trim()
    .toLowerCase();
  delete headers["X-Edge-Relay"];

  let body = options.body;
  if (
    relayMode === "mbox" &&
    method === "POST" &&
    path.includes("/stream/start")
  ) {
    headers["X-Edge-Relay"] = "mbox";
  }

  const fetchOptions = { method, headers };
  if (body != null && method !== "GET" && method !== "HEAD") {
    if (!headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    fetchOptions.body = typeof body === "string" ? body : JSON.stringify(body);
  }

  const res = await fetch(url, fetchOptions);
  let responseBody = null;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      responseBody = await res.json();
    } catch {
      responseBody = null;
    }
  } else {
    const text = await res.text();
    responseBody = text || null;
  }

  const responseHeaders = {};
  const relayHeader = res.headers.get("x-edge-relay-stream");
  if (relayHeader) {
    responseHeaders["x-edge-relay-stream"] = relayHeader;
  }

  return {
    status: res.status,
    body: responseBody,
    headers: responseHeaders,
  };
}
