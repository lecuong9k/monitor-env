import { getDeviceIdentityController } from "../controllers/device-identity.controller.js";

export default async function deviceIdentityRoutes(fastify) {
  fastify.get("/device-identity", getDeviceIdentityController);
}
