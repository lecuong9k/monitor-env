export async function registerInternalAuth(fastify) {
  const apiKey = process.env.CAMERA_SERVICE_API_KEY?.trim();

  if (!apiKey) {
    fastify.log.warn(
      "CAMERA_SERVICE_API_KEY chưa cấu hình — từ chối mọi request (trừ /health)",
    );
  }

  fastify.addHook("onRequest", async (request, reply) => {
    const url = request.url.split("?")[0] ?? "";
    if (url === "/health") return;

    const provided = request.headers["x-camera-service-key"];
    if (!apiKey || provided !== apiKey) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });
}
