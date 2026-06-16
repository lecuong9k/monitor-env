import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import configsRoutes from "./routes/config.route.js";
import modbusRtuRoutes from "./routes/modbus-rtu.route.js";
import dataLoggingRoutes from "./routes/data-logging.routes.js";
import recipeRoutes from "./routes/recipe.routes.js";
import wsRoutes from "./routes/ws.routes.js";
import cameraRoutes from "./routes/camera.routes.js";
import { startModbusWorkers } from "./jobs/modbus/modbus.service.js";
import {
  initStreamService,
  stopAllStreams,
} from "./services/stream.service.js";
import { config as cameraConfig } from "./config/camera.config.js";

import { registerSecurity } from "./plugins/security.js";
import { registerWebsocket } from "./plugins/websocket.js";
import { startServer } from "./jobs/camera/agent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const beRoot = path.join(__dirname, "..");
const BODY_LIMIT = Number(process.env.BODY_LIMIT_BYTES) || 1024 * 64;
const REQUEST_TIMEOUT = Number(process.env.REQUEST_TIMEOUT_MS) || 30_000;

/** Luôn resolve STATIC_DIR theo thư mục BE, không phụ thuộc cwd khi chạy npm. */
function resolveStaticDir() {
  const raw = process.env.STATIC_DIR?.trim();
  if (!raw) return path.join(beRoot, "dist");
  return path.isAbsolute(raw) ? raw : path.join(beRoot, raw);
}

const fePath = resolveStaticDir();

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
await registerWebsocket(fastify);

fastify.register(configsRoutes);
fastify.register(modbusRtuRoutes);
fastify.register(dataLoggingRoutes);
fastify.register(recipeRoutes);
await fastify.register(wsRoutes);
await fastify.register(cameraRoutes);

if (cameraConfig.streamMode === "hls") {
  await fastify.register(fastifyStatic, {
    root: cameraConfig.hlsOutputDir,
    prefix: "/streams/",
    decorateReply: false,
  });
}

fastify.get("/health", async () => {
  return {
    status: "ok",
  };
});

if (hasFeDist) {
  await fastify.register(fastifyStatic, {
    root: fePath,
    prefix: "/",
    decorateReply: true,
    setHeaders(res, filePath) {
      if (filePath.endsWith(".css")) {
        res.setHeader("Content-Type", "text/css; charset=utf-8");
      } else if (filePath.endsWith(".js")) {
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      } else if (filePath.endsWith(".svg")) {
        res.setHeader("Content-Type", "image/svg+xml");
      }
    },
  });

  fastify.get("/", async (_request, reply) => {
    return reply.sendFile("index.html", { root: fePath });
  });

  const isApiPath = (url) =>
    url === "/health" ||
    url === "/cameras" ||
    url.startsWith("/cameras/") ||
    url.startsWith("/api/") ||
    url.startsWith("/streams/") ||
    url.startsWith("/ws/") ||
    url.startsWith("/configs") ||
    url.startsWith("/modbus-rtu") ||
    url.startsWith("/data-loggings") ||
    url.startsWith("/recipes");

  /** SPA fallback; không trả index.html cho route API (tránh FE parse HTML như JSON). */
  fastify.setNotFoundHandler((request, reply) => {
    const url = request.url.split("?")[0] ?? "";

    if (
      url.startsWith("/assets/") ||
      isApiPath(url) ||
      /\.(css|js|mjs|svg|ico|png|jpg|jpeg|webp|woff2?|m3u8|ts)$/i.test(url)
    ) {
      return reply
        .code(404)
        .type("application/json")
        .send({ error: "Not found" });
    }

    if (request.method === "GET") {
      return reply.sendFile("index.html", { root: fePath });
    }

    return reply.code(404).send({ error: "Not found" });
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
    await initStreamService().catch((err) => {
      fastify.log.warn(
        { err },
        "Camera stream chưa sẵn sàng — kiểm tra CAMERA_* trong .env",
      );
    });

    await fastify.listen({
      port: Number(process.env.PORT) || 3000,
      host: process.env.HOST || "0.0.0.0",
    });
    console.log("Server started");
    if (hasFeDist) {
      console.log(
        `Web UI: http://<device-ip>:${Number(process.env.PORT) || 3000}/#/camera`,
      );
    }
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
startModbusWorkers();
// Camera -> Server
startServer()
const shutdown = () => {
  stopAllStreams();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
