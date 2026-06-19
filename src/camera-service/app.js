import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { registerWebsocket } from "../plugins/websocket.js";
import cameraRoutes from "./routes/camera.routes.js";
import { registerInternalAuth } from "./middleware/internal-auth.js";
import { config } from "./config.js";
import {
  getHlsOutputDir,
  initStreamService,
  stopAllStreams,
} from "./services/stream.service.js";
import { assertSecretsKeyConfigured } from "../utils/secrets.js";

const BODY_LIMIT = Number(process.env.BODY_LIMIT_BYTES) || 1024 * 64;
const REQUEST_TIMEOUT = Number(process.env.REQUEST_TIMEOUT_MS) || 30_000;

const fastify = Fastify({
  logger: { name: "camera-service" },
  bodyLimit: BODY_LIMIT,
  requestTimeout: REQUEST_TIMEOUT,
});

await registerInternalAuth(fastify);
await registerWebsocket(fastify);
await fastify.register(cameraRoutes);

if (config.streamMode === "hls") {
  await fastify.register(fastifyStatic, {
    root: getHlsOutputDir(),
    prefix: "/streams/",
    decorateReply: false,
  });
}

fastify.get("/health", async () => ({
  status: "ok",
  service: "camera-service",
}));

const start = async () => {
  try {
    assertSecretsKeyConfigured();

    await initStreamService().catch((err) => {
      fastify.log.warn({ err }, "Stream service chưa sẵn sàng");
    });

    await fastify.listen({
      port: config.port,
      host: config.host,
    });

    fastify.log.info(
      `Camera service listening on http://${config.host}:${config.port}`,
    );
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

const shutdown = () => {
  stopAllStreams();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
