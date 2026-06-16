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
      const allowed = !origin || isOriginAllowed(origin, corsOrigins);
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
