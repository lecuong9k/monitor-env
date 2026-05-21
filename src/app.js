import Fastify from "fastify";
import configsRoutes from "./routes/config.route.js";
import modbusRtuRoutes from "./routes/modbus-rtu.route.js";
import dataLoggingRoutes from "./routes/data-logging.routes.js";
import { registerSecurity } from "./plugins/security.js";

const BODY_LIMIT = Number(process.env.BODY_LIMIT_BYTES) || 1024 * 64;
const REQUEST_TIMEOUT = Number(process.env.REQUEST_TIMEOUT_MS) || 30_000;

const fastify = Fastify({
    logger: true,
    bodyLimit: BODY_LIMIT,
    requestTimeout: REQUEST_TIMEOUT,
    trustProxy: process.env.TRUST_PROXY === "true"
});

await registerSecurity(fastify);

fastify.register(configsRoutes);
fastify.register(modbusRtuRoutes);
fastify.register(dataLoggingRoutes);

fastify.get("/", async () => {
    return {
        status: "ok",
        service: "monitor-env-be"
    };
});

fastify.get("/health", async () => {
    return {
        status: "ok"
    };
});

const start = async () => {
    try {
        await fastify.listen({
            port: Number(process.env.PORT) || 3000,
            host: process.env.HOST || "0.0.0.0"
        });
        console.log("Server started");
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
