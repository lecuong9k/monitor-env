import crypto from "crypto";
import {
  findMachineCode,
  insertMachineCode,
} from "../repositories/device-identity.repository.js";

function generateMachineCode() {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Đảm bảo có machineCode ổn định trên MiniPC.
 * Nếu DB chưa có → sinh mới và lưu một lần.
 */
export function ensureMachineCode() {
  const existing = findMachineCode();
  if (existing) return existing;

  const code = generateMachineCode();
  try {
    return insertMachineCode(code);
  } catch (err) {
    // Race khi nhiều worker cùng seed — đọc lại.
    const again = findMachineCode();
    if (again) return again;
    throw err;
  }
}

export function getDeviceIdentity() {
  return { machineCode: ensureMachineCode() };
}
