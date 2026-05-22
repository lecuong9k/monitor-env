import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import configsRoutes from "./routes/config.route.js";
import modbusRtuRoutes from "./routes/modbus-rtu.route.js";
import dataLoggingRoutes from "./routes/data-logging.routes.js";
import { startModbusWorkers } from "./jobs/modbus/modbus.service.js";

import { registerSecurity } from "./plugins/security.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BODY_LIMIT = Number(process.env.BODY_LIMIT_BYTES) || 1024 * 64;
const REQUEST_TIMEOUT = Number(process.env.REQUEST_TIMEOUT_MS) || 30_000;

const fePath = process.env.STATIC_DIR
  ? path.resolve(process.env.STATIC_DIR)
  : path.join(__dirname, "..", "dist");

const hasFeDist =
  fs.existsSync(fePath) &&
  fs.statSync(fePath).isDirectory() &&
  fs.existsSync(path.join(fePath, "index.html"));

const fastify = Fastify({
  logger: true,
  bodyLimit: BODY_LIMIT,
  requestTimeout: REQUEST_TIMEOUT,
  trustProxy: process.env.TRUST_PROXY === "true",
});

await registerSecurity(fastify);

fastify.register(configsRoutes);
fastify.register(modbusRtuRoutes);
fastify.register(dataLoggingRoutes);

fastify.get("/health", async () => {
  return {
    status: "ok",
  };
});

if (hasFeDist) {
  await fastify.register(fastifyStatic, {
    root: fePath,
    prefix: "/",
  });

  fastify.get("/", async (_request, reply) => {
    return reply.sendFile("index.html");
  });

  fastify.log.info(`Serving FE from ${fePath}`);
} else {
  fastify.log.warn(
    `FE dist not found (expected ${fePath}/index.html) — running API-only mode`,
  );

  fastify.get("/", async () => {
    return {
      status: "ok",
      service: "monitor-env-be",
      mode: "api-only",
    };
  });
}

const start = async () => {
  try {
    await fastify.listen({
      port: Number(process.env.PORT) || 3000,
      host: process.env.HOST || "0.0.0.0",
    });
    console.log("Server started");
    if (hasFeDist) {
      console.log(
        `Web UI: http://<device-ip>:${Number(process.env.PORT) || 3000}/`,
      );
    }
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
startModbusWorkers();
