import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey() {
  const raw = process.env.CAMERA_SECRETS_KEY?.trim();
  if (!raw) {
    throw new Error(
      "Thiếu CAMERA_SECRETS_KEY (64 ký tự hex = 32 byte) trong .env.local",
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error("CAMERA_SECRETS_KEY phải là 64 ký tự hex (32 byte)");
  }
  return Buffer.from(raw, "hex");
}

/** @param {string} plaintext */
export function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(String(plaintext), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

/** @param {string} payload */
export function decryptSecret(payload) {
  const [ivB64, tagB64, dataB64] = String(payload).split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Dữ liệu mã hóa không hợp lệ");
  }
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivB64, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function generateSecretsKey() {
  return crypto.randomBytes(32).toString("hex");
}
