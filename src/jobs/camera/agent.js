import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';

// Thiết lập đường dẫn cho FFmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

const fastify = Fastify({ logger: true });

// Đăng ký plugin WebSocket của Fastify
await fastify.register(fastifyWebsocket);

// Quản lý trạng thái luồng toàn cục cho từng connection (nếu cần mở rộng)
let ffmpegProcess = null;
let streamReadable = null;

// Khởi tạo router WebSocket
fastify.get('/stream', { websocket: true }, (connection, req) => {
    const { socket } = connection;
    fastify.log.info('Client connected via WebSocket');

    // Phản hồi nhận diện nguồn giống như code cũ của bạn nếu cần
    socket.send(JSON.stringify({ type: 'source_acknowledged' }));

    // Lắng nghe các command từ client gửi lên
    socket.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());

            if (data.cmd === 'start') {
                startStream(socket);
            }
            if (data.cmd === 'stop') {
                stopStream();
            }
        } catch (err) {
            fastify.log.error('Dữ liệu nhận vào không đúng định dạng JSON:', err.message);
        }
    });

    // Tự động dọn dẹp khi client ngắt kết nối đột ngột
    socket.on('close', () => {
        fastify.log.info('Client disconnected');
        stopStream();
    });

    socket.on('error', (err) => {
        fastify.log.error('Socket error:', err);
        stopStream();
    });
});

// Hàm khởi chạy luồng stream chống nháy hình (hãm tốc độ bằng -re)
function startStream(socket) {
    if (ffmpegProcess) {
        fastify.log.warn('Stream đang chạy rồi!');
        return;
    }

    fastify.log.info('Start RTSP to WebSocket Stream');
    ffmpegProcess = ffmpeg(
        "rtsp://admin:123456aA%40@192.168.5.61:554/rtsp/streaming?channel=01&subtype=2"
    )
        .inputOptions([
            "-rtsp_transport tcp",
            "-reorder_queue_size 4000",
            "-max_delay 500000"
        ])
        .videoCodec("mpeg1video")
        .videoBitrate("1200k")
        .outputOptions([
            "-re",               // Hãm tốc độ gửi gói tin theo đúng thời gian thực, triệt tiêu nháy hình
            "-bf 0",
            "-g 50",
            "-preset medium",
            "-bufsize 2000k",
            "-maxrate 1500k"
        ])
        .format("mpegts")
        .fps(25)
        .on("start", (cmd) => {
            fastify.log.info(`FFmpeg bắt đầu với lệnh: ${cmd}`);
        })
        .on("error", (err) => {
            fastify.log.error(`FFmpeg gặp lỗi: ${err.message}`);
            stopStream();
        })
        .on("end", () => {
            fastify.log.info("FFmpeg kết thúc luồng");
            stopStream();
        });

    streamReadable = ffmpegProcess.pipe();

    streamReadable.on("data", (chunk) => {
        // Kiểm tra xem socket còn hoạt động tốt không
        if (!socket || socket.readyState !== 1) { // 1 tương đương với WebSocket.OPEN
            stopStream();
            return;
        }

        // Chống quá tải bộ nhớ đệm (Backpressure)
        if (socket.bufferedAmount > 1024 * 1024) {
            return;
        }

        // Gửi dữ liệu nhị phân nguyên bản (MPEG-TS)
        socket.send(chunk, { binary: true }, (err) => {
            if (err) fastify.log.error(`Lỗi gửi dữ liệu WS: ${err.message}`);
        });
    });

    streamReadable.once("data", (chunk) => {
        fastify.log.info(`First chunk hex: ${chunk.slice(0, 16).toString("hex")}`);
    });
}

// Hàm dừng và giải phóng luồng triệt để
function stopStream() {
    fastify.log.info('Hủy bỏ luồng phát...');

    if (streamReadable) {
        streamReadable.removeAllListeners("data");
        streamReadable.unpipe();
        streamReadable = null;
    }

    if (ffmpegProcess) {
        ffmpegProcess.removeAllListeners();
        try {
            ffmpegProcess.kill("SIGKILL");
        } catch (e) {
            // Tiến trình có thể đã chết trước đó
        }
        ffmpegProcess = null;
    }
}

// Khởi chạy Fastify Server
export const startServer = async () => {
    try {
        console.log('------startServer--------')
        const port = 4000;
        await fastify.listen({ port: port, host: '0.0.0.0' });
        fastify.log.info(`Server đang chạy tại: ws://localhost:${port}/stream`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

// startServer();