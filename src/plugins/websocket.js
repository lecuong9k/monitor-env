import websocket from "@fastify/websocket";

/** Đăng ký @fastify/websocket một lần duy nhất — tránh ERR_HTTP_SOCKET_ASSIGNED. */
export async function registerWebsocket(fastify) {
  await fastify.register(websocket);
}
