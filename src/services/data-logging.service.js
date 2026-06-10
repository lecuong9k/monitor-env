import {
  findAllDataLogging,
  findLatestDataLogging,
  findDataLoggingHistory,
  findDataLoggingById,
  upsertDataLogging,
  deleteDataLogging,
} from "../repositories/data-logging.repository.js";
import {
  buildSensorMatchSql,
  isValidSensorId,
} from "../lib/sensor-patterns.js";
import { broadcastDataLoggingUpdate } from "../realtime/readings-hub.js";

function formatDateInput(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseStatsDateRange(dateFrom, dateTo) {
  const fromMs = new Date(`${dateFrom}T00:00:00`).getTime();
  const todayStr = formatDateInput(new Date());
  const toMs =
    dateTo === todayStr
      ? Date.now()
      : new Date(`${dateTo}T23:59:59.999`).getTime();
  return { fromMs, toMs };
}

export function getAllDataLogging() {
  return findAllDataLogging();
}

export function getLatestDataLogging() {
  return findLatestDataLogging();
}

export function getDataLoggingHistory({ sensor, dateFrom, dateTo }) {
  if (!isValidSensorId(sensor)) {
    throw new Error("Invalid sensor");
  }
  if (!dateFrom || !dateTo) {
    throw new Error("dateFrom and dateTo are required");
  }

  const { fromMs, toMs } = parseStatsDateRange(dateFrom, dateTo);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
    throw new Error("Invalid date range");
  }

  const { clause, params } = buildSensorMatchSql(sensor);
  return findDataLoggingHistory({
    fromIso: new Date(fromMs).toISOString(),
    toIso: new Date(toMs).toISOString(),
    sensorClause: clause,
    sensorParams: params,
  });
}

export function getDataLogging(id) {
  const dataLogging = findDataLoggingById(id);
  if (!dataLogging) {
    throw new Error("Data logging not found");
  }
  return dataLogging;
}

export function saveDataLogging(record) {
  const saved = upsertDataLogging(record);
  broadcastDataLoggingUpdate(saved);
  return saved;
}

export function removeDataLogging(id) {
  return deleteDataLogging(id);
}
