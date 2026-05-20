import Fastify from "fastify";
import settingRoutes from "./routes/setting.route.js";
const fastify = Fastify({
    logger: true
});

// register routes
fastify.register(settingRoutes);

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