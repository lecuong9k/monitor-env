import {
  findAllConfigs,
  findConfigById,
  upsertConfig,
  deleteConfig,
} from "../repositories/config.repository.js";
import { startModbusWorkers } from "../jobs/modbus/modbus.service.js";
import { getAllModbusRtu } from "./modbus-rtu.service.js";

export function getAllConfigs() {
  return findAllConfigs();
}

export function getConfig(id) {
  const config = findConfigById(id);
  if (!config) {
    throw new Error("Config not found");
  }
  return config;
}

export async function saveConfig(record) {
  const res = upsertConfig(record);
  try {
    await startModbusWorkers();
  } catch (err) {
    console.error(
      "Failed to restart modbus workers:",
      err && err.message ? err.message : err,
    );
  }
  return res;
}

export function removeConfig(id) {
  return deleteConfig(id);
}
