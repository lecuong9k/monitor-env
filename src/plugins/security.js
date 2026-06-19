import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";

const DEFAULT_CORS_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://192.168.5.97:3000",
];

function parseCorsOrigins() {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (!raw) return DEFAULT_CORS_ORIGINS;
  if (raw === "*") return true;
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

function isOriginAllowed(origin, allowed) {
  if (allowed === true) return true;
  return allowed.includes(origin);
}

/** MiniPC thường truy cập UI qua IP LAN — Vite thêm crossorigin nên browser gửi Origin. */
function isPrivateLanOrigin(origin) {
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== "http:" && protocol !== "https:") return false;
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    ) {
      return true;
    }
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname))
      return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Đăng ký middleware bảo mật: helmet, rate-limit, CORS, sensible.
 * Gọi trước khi register routes.
 */
export async function registerSecurity(fastify) {
  const corsOrigins = parseCorsOrigins();

  await fastify.register(sensible);

  await fastify.register(helmet, {
    global: true,
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    // HTTP (IP:port) không phải trustworthy origin — tắt COOP để tránh cảnh báo console.
    crossOriginOpenerPolicy: false,
  });

  await fastify.register(rateLimit, {
    global: true,
    max: Number(process.env.RATE_LIMIT_MAX) || 100,
    timeWindow: process.env.RATE_LIMIT_TIME_WINDOW || "1 minute",
    ban: Number(process.env.RATE_LIMIT_BAN) || 0,
    addHeaders: {
      "x-ratelimit-limit": true,
      "x-ratelimit-remaining": true,
      "x-ratelimit-reset": true,
      "retry-after": true,
    },
  });

  const serverPort = String(Number(process.env.PORT) || 3000);

  await fastify.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const allowed =
        isOriginAllowed(origin, corsOrigins) || isPrivateLanOrigin(origin);
      cb(allowed ? null : new Error("Origin not allowed"), allowed);
    },
    methods: ["GET", "POST", "DELETE", "PUT", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    maxAge: 86_400,
  });

  fastify.addHook("onRequest", async (request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.removeHeader("X-Powered-By");
  });
}
