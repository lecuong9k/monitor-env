import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";

const DEFAULT_CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
];

function parseCorsOrigins() {
    const raw = process.env.CORS_ORIGINS?.trim();
    if (!raw) return DEFAULT_CORS_ORIGINS;
    if (raw === "*") return true;
    return raw.split(",").map((o) => o.trim()).filter(Boolean);
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
    const isProduction = process.env.NODE_ENV === "production";
    const corsOrigins = parseCorsOrigins();

    await fastify.register(sensible);

    await fastify.register(helmet, {
        global: true,
        contentSecurityPolicy: isProduction ? undefined : false,
        crossOriginEmbedderPolicy: false
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
            "retry-after": true
        }
    });

    const serverPort = String(Number(process.env.PORT) || 3000);

    await fastify.register(cors, {
        origin: (origin, callback) => {
            if (!origin) {
                callback(null, true);
                return;
            }
            if (isOriginAllowed(origin, corsOrigins)) {
                callback(null, true);
                return;
            }
            // BE serve FE cùng cổng (localhost:3000) — cho phép origin trùng host
            try {
                const { hostname, port } = new URL(origin);
                const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
                const effectivePort = port || (hostname === "::1" ? "" : "80");
                if (
                    localHosts.has(hostname) &&
                    (effectivePort === serverPort || effectivePort === "")
                ) {
                    callback(null, true);
                    return;
                }
            } catch {
                /* ignore invalid origin URL */
            }
            callback(new Error("Not allowed by CORS"), false);
        },
        methods: ["GET", "POST", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true,
        maxAge: 86_400
    });

    fastify.addHook("onRequest", async (request, reply) => {
        reply.header("X-Content-Type-Options", "nosniff");
        reply.header("X-Frame-Options", "DENY");
        reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
        reply.removeHeader("X-Powered-By");
    });
}
