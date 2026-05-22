/** Hub broadcast WebSocket — cập nhật readings realtime cho FE. */

const clients = new Set();

export function addReadingsClient(socket) {
  clients.add(socket);
}

export function removeReadingsClient(socket) {
  clients.delete(socket);
}

function send(socket, payload) {
  if (socket.readyState !== 1) return;
  try {
    socket.send(JSON.stringify(payload));
  } catch (err) {
    console.error("WS send failed:", err?.message ?? err);
  }
}

export function broadcastReadings(payload) {
  for (const socket of clients) {
    send(socket, payload);
  }
}

/** Sau khi lưu data_logging (Modbus hoặc API). */
export function broadcastDataLoggingUpdate(record) {
  if (!record) return;
  broadcastReadings({
    type: "data_logging_update",
    record,
    at: new Date().toISOString(),
  });
}
