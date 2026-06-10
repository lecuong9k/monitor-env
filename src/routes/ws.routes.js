import websocket from "@fastify/websocket";
import {
  addReadingsClient,
  removeReadingsClient,
} from "../realtime/readings-hub.js";
import { getLatestDataLogging } from "../services/data-logging.service.js";

export default async function wsRoutes(fastify) {
  await fastify.register(websocket);

  fastify.get("/ws/readings", { websocket: true }, (socket, _request) => {
    addReadingsClient(socket);

    socket.on("close", () => {
      removeReadingsClient(socket);
    });

    socket.on("error", () => {
      removeReadingsClient(socket);
    });

    try {
      const records = getLatestDataLogging();
      socket.send(
        JSON.stringify({
          type: "snapshot",
          records,
          at: new Date().toISOString(),
        }),
      );
    } catch (err) {
      socket.send(
        JSON.stringify({
          type: "error",
          message: err?.message ?? "Failed to load snapshot",
        }),
      );
    }
  });
}
