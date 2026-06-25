import Fastify from "fastify/fastify.js";
import WebSocket from "ws";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";

// Cấu hình FFmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

const fastify = Fastify({ logger: true });
const VPS = "ws://45.76.152.73:4000";
const RECONNECT_INTERVAL = 10000; // 10 giây

let ffmpegProcess = null;
let ws = null;
let reconnectTimer = null;

// Hàm khởi chạy và quản lý kết nối WebSocket
function connectWebSocket() {
  console.log(`Đang cố gắng kết nối tới VPS: ${VPS}...`);
  ws = new WebSocket(VPS);

  ws.on("open", () => {
    console.log("Connected VPS thành công!");

    // Xóa timer reconnect nếu kết nối thành công
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    ws.send(
      JSON.stringify({
        type: "source",
      }),
    );
  });

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.cmd === "start") {
        startStream();
      }
      if (data.cmd === "stop") {
        stopStream();
      }
    } catch (err) {
      console.error("Lỗi parse message từ VPS:", err);
    }
  });

  ws.on("close", () => {
    console.log(
      `Mất kết nối tới VPS. Sẽ thử kết nối lại sau ${RECONNECT_INTERVAL / 1000} giây...`,
    );
    cleanUpStream();
    triggerReconnect();
  });

  ws.on("error", (err) => {
    console.error("Lỗi WebSocket:", err.message);
    // Event 'close' sẽ tự động được gọi sau 'error', nhưng bọc ở đây để chắc chắn
    ws.close();
  });
}

// Hàm kích hoạt kết nối lại (tránh trùng lặp timer)
function triggerReconnect() {
  if (!reconnectTimer) {
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectWebSocket();
    }, RECONNECT_INTERVAL);
  }
}

function startStream() {
  if (ffmpegProcess) return;
  console.log("Start RTSP");

  ffmpegProcess = ffmpeg(
    "rtsp://admin:123456aA%40@192.168.5.61:554/rtsp/streaming?channel=01&subtype=2",
  )
    .inputOptions([
      "-rtsp_transport tcp",
      "-fflags nobuffer",
      "-flags low_delay",
    ])
    .videoCodec("mpeg1video")
    .videoBitrate("1500k")
    .outputOptions(["-bf 0", "-g 30", "-preset ultrafast", "-tune zerolatency"])
    .format("mpegts")
    .fps(25)
    .on("start", (cmd) => {
      console.log("FFmpeg started with cmd:", cmd);
    })
    .on("error", (err) => {
      console.error("FFmpeg error:", err);
      cleanUpStream();
    })
    .on("end", () => {
      console.log("FFmpeg ended");
      cleanUpStream();
    });

  const stream = ffmpegProcess.pipe(null, { end: false });

  stream.on("data", (chunk) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Chống nghẽn mạch bộ nhớ đệm (backpressure)
      if (ws.bufferedAmount > 1024 * 1024) {
        return;
      }

      ws.send(chunk, { binary: true }, (err) => {
        if (err) console.error("WS Send Error:", err);
      });
    }
  });

  stream.once("data", (chunk) => {
    console.log("First chunk hex:", chunk.slice(0, 32).toString("hex"));
  });
}

function cleanUpStream() {
  if (ffmpegProcess) {
    try {
      ffmpegProcess.kill("SIGKILL");
    } catch (e) {}
    ffmpegProcess = null;
  }
}

function stopStream() {
  if (!ffmpegProcess) return;
  console.log("Stop RTSP");
  ffmpegProcess.kill("SIGKILL");
  ffmpegProcess = null;
}

// Khởi tạo và chạy Fastify Server
export const startServer = async () => {
  try {
    // Route cơ bản kiểm tra server chạy hay chưa
    fastify.get("/", async (request, reply) => {
      return {
        status: "Server running",
        vps_connected: ws?.readyState === WebSocket.OPEN,
      };
    });

    // Lắng nghe cổng 3000 (hoặc cổng bạn muốn)
    await fastify.listen({ port: 3000, host: "0.0.0.0" });
    console.log("Fastify server đang chạy tại port 3000");

    // Bắt đầu kích hoạt kết nối WebSocket sau khi server khởi động
    connectWebSocket();
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// startServer();
