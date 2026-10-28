import { createHash, createHmac, randomUUID } from "node:crypto";
import { collaborationConfig } from "./config.js";

const DRAFT_PATH = "/api/internal/hermes/v1/partner-progress-drafts";
const ORDER_HINT_PATH = "/api/internal/hermes/v1/partner-order-hints";
const CHAT_PATH = "/api/internal/hermes/v1/partner-chat-replies";

function fail(message, statusCode = 502, code = "partner_ai_bridge_error") {
  return Object.assign(new Error(message), { statusCode, code });
}

function signatureHeaders(body, path) {
  const secret = collaborationConfig.partnerAiBridgeSecret;
  if (secret.length < 32) throw fail("伙伴智能体桥接密钥尚未配置。", 503, "partner_ai_bridge_not_configured");
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = `partner-${randomUUID()}`;
  const bodyDigest = createHash("sha256").update(body).digest("hex");
  const canonical = [timestamp, nonce, "POST", path, bodyDigest].join("\n");
  const signature = createHmac("sha256", secret).update(canonical).digest("hex");
  return {
    "Content-Type": "application/json",
    "X-Hermes-Timestamp": timestamp,
    "X-Hermes-Nonce": nonce,
    "X-Hermes-Body-Sha256": bodyDigest,
    "X-Hermes-Signature": signature,
  };
}

async function requestPartnerAi(path, payload, { fetchImpl = globalThis.fetch, timeoutMs = 35_000 } = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImpl(`${collaborationConfig.partnerAiBridgeUrl}${path}`, {
      method: "POST",
      headers: signatureHeaders(body, path),
      body,
      signal: controller.signal,
    });
    let result = {};
    try { result = await response.json(); } catch { result = {}; }
    if (!response.ok) throw fail(result.message || "Hermes 伙伴草稿服务不可用。", response.status, result.code || "partner_ai_bridge_failed");
    return result;
  } catch (error) {
    if (error?.name === "AbortError") throw fail("生成进度草稿超时，请重试或手工填写。", 504, "partner_ai_timeout");
    if (error?.code) throw error;
    throw fail("无法连接 Hermes 伙伴草稿服务。", 503, "partner_ai_unavailable");
  } finally {
    clearTimeout(timer);
  }
}

export async function requestPartnerProgressDraft(payload, options = {}) {
  const result = await requestPartnerAi(DRAFT_PATH, payload, options);
  return result.draft;
}

export async function requestPartnerChatReply(payload, options = {}) {
  const result = await requestPartnerAi(CHAT_PATH, payload, { timeoutMs: 20_000, ...options });
  return result.chat;
}

export async function requestPartnerOrderHints(payload, options = {}) {
  const result = await requestPartnerAi(ORDER_HINT_PATH, payload, { timeoutMs: 15_000, ...options });
  return result.hints;
}
