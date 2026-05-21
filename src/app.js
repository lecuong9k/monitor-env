import Fastify from "fastify";
import configsRoutes from "./routes/config.route.js";
import modbusRtuRoutes from "./routes/modbus-rtu.route.js";
import dataLoggingRoutes from "./routes/data-logging.routes.js";
const fastify = Fastify({
    logger: true
});

// register routes
fastify.register(configsRoutes);
fastify.register(modbusRtuRoutes);
fastify.register(dataLoggingRoutes);

fastify.get("/", async () => {
    return {
        status: "ok"
    };
});

const start = async () => {
    try {
        await fastify.listen({
            port: 3000,
            host: "0.0.0.0"
        });
        console.log("Server started");
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();