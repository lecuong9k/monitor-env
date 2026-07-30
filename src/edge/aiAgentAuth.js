import { timingSafeEqual } from "crypto";

export function getAiAgentToken() {
  return String(process.env.AI_AGENT_TOKEN || "").trim();
}

export function isAiAgentGatewayEnabled() {
  return Boolean(getAiAgentToken());
}

/**
 * So sánh token an toàn theo thời gian.
 * @param {string | null | undefined} provided
 */
export function verifyAiAgentToken(provided) {
  const expected = getAiAgentToken();
  if (!expected) return false;
  const a = Buffer.from(String(provided ?? ""), "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Token từ query `?token=` hoặc header `x-ai-agent-token`.
 * @param {import('fastify').FastifyRequest} request
 */
export function extractTokenFromRequest(request) {
  const q = request?.query?.token;
  if (q != null && String(q).trim()) return String(q).trim();
  const h = request?.headers?.["x-ai-agent-token"];
  if (h != null && String(h).trim()) return String(h).trim();
  return "";
}
