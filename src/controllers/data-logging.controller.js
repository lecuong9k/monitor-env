import {
  getAllDataLogging,
  getLatestDataLogging,
  getDataLoggingHistory,
  getDataLogging,
  saveDataLogging,
  removeDataLogging,
} from "../services/data-logging.service.js";

export async function getDataLoggingsController() {
  return getAllDataLogging();
}

export async function getLatestDataLoggingsController() {
  return getLatestDataLogging();
}

export async function getDataLoggingHistoryController(request, reply) {
  try {
    const { sensor, dateFrom, dateTo } = request.query ?? {};
    return getDataLoggingHistory({ sensor, dateFrom, dateTo });
  } catch (err) {
    return reply.code(400).send({
      error: err.message ?? "Invalid history query",
    });
  }
}

export async function getDataLoggingController(request, reply) {
  try {
    const { id } = request.params;
    return getDataLogging(id);
  } catch (err) {
    return reply.code(404).send({
      error: err.message,
    });
  }
}

export async function createDataLoggingController(request) {
  const record = saveDataLogging(request.body);
  return {
    success: true,
    data: record,
  };
}

export async function deleteDataLoggingController(request) {
  const { id } = request.params;
  removeDataLogging(id);
  return {
    success: true,
  };
}
