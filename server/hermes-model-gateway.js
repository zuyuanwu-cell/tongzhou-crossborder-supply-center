import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { hasPermission } from "./access-control.js";

export const DEEPSEEK_API_BASE_URL = "https://api.deepseek.com";
export const DEEPSEEK_MODELS = Object.freeze([
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", description: "复杂业务分析与多工具任务（推荐）" },
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", description: "响应更快、成本更低" },
]);

const STORE_VERSION = 1;
const DEFAULT_MODEL = DEEPSEEK_MODELS[0].id;
const MODEL_IDS = new Set(DEEPSEEK_MODELS.map((item) => item.id));

function text(value) {
  return String(value ?? "").trim();
}

function fail(message, statusCode = 400, code = "invalid_request") {
  return Object.assign(new Error(message), { statusCode, code });
}

function safeEqual(left, right) {
  const a = Buffer.from(text(left), "utf8");
  const b = Buffer.from(text(right), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function encryptionKey(secret) {
  const source = text(secret);
  if (source.length < 16) throw new Error("DeepSeek 密钥加密主密钥长度不足，请配置 AI_CREDENTIAL_ENCRYPTION_KEY。");
  return createHash("sha256").update(`tongzhou-hermes-model:${source}`, "utf8").digest();
}

function encryptSecret(value, secret) {
  const apiKey = text(value);
  if (!apiKey) throw fail("请输入 DeepSeek API Key。", 400, "api_key_required");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return {
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  };
}

function decryptSecret(payload, secret) {
  if (!payload?.iv || !payload?.tag || !payload?.data) throw fail("DeepSeek API Key 不存在或已损坏。", 503, "model_not_configured");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(payload.data, "base64")), decipher.final()]).toString("utf8");
}

function maskedSecret(value) {
  const source = text(value);
  if (!source) return "";
  if (source.length <= 10) return `${source.slice(0, 2)}****`;
  return `${source.slice(0, 7)}****${source.slice(-4)}`;
}

function normalizeModel(value, fallback = DEFAULT_MODEL) {
  const model = text(value);
  if (!model) return fallback;
  if (!MODEL_IDS.has(model)) throw fail("请选择受支持的 DeepSeek 模型。", 400, "unsupported_model");
  return model;
}

function loadJson(path) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  } catch {
    return null;
  }
}

function saveJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  renameSync(tempPath, path);
}

function requireAdmin(auth) {
  if (!auth?.user?.id || auth.role === "guest") throw fail("请先登录。", 401, "authentication_required");
  if (auth.role !== "admin" || ["system", "legacy-internal"].includes(auth.user.id) || !hasPermission(auth, "hermes_agent_admin")) {
    throw fail("仅系统管理员可以配置智能体模型。", 403, "hermes_admin_required");
  }
}

function upstreamMessage(payload, fallback) {
  return text(payload?.error?.message || payload?.message) || fallback;
}

async function responseJson(response) {
  const raw = await response.text();
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

export function prepareHermesModelPayload(payload, model, { structured = false } = {}) {
  const prepared = { ...payload, model };
  if (!structured) return prepared;
  prepared.temperature = 0.1;
  prepared.response_format = { type: "json_object" };
  const requestedMaxTokens = Number(payload?.max_tokens);
  prepared.max_tokens = Number.isFinite(requestedMaxTokens) && requestedMaxTokens > 0
    ? Math.min(Math.floor(requestedMaxTokens), 1200)
    : 1200;
  delete prepared.tools;
  delete prepared.tool_choice;
  return prepared;
}

export function createHermesModelGateway({
  cacheDir = ".cache",
  encryptionSecret,
  proxySecret,
  partnerProxySecret,
  defaultModel = DEFAULT_MODEL,
  fetchImpl = globalThis.fetch,
  getAuth,
  parseRequestBody,
  sendJson,
  appendActionLog = () => {},
  canUpdate = () => true,
  requestTimeoutMs = 190_000,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("当前运行环境不支持 DeepSeek 网络请求。");
  encryptionKey(encryptionSecret);
  const storePath = resolve(cacheDir, "hermes-model-config.json");
  const initialModel = MODEL_IDS.has(text(defaultModel)) ? text(defaultModel) : DEFAULT_MODEL;
  let config = loadJson(storePath) || {
    version: STORE_VERSION,
    provider: "deepseek",
    baseUrl: DEEPSEEK_API_BASE_URL,
    model: initialModel,
    encryptedApiKey: null,
    apiKeyMasked: "",
    updatedAt: "",
    updatedBy: "",
    lastTest: null,
  };
  config = {
    ...config,
    version: STORE_VERSION,
    provider: "deepseek",
    baseUrl: DEEPSEEK_API_BASE_URL,
    model: MODEL_IDS.has(text(config.model)) ? text(config.model) : initialModel,
  };

  function apiKey(candidate = "") {
    return text(candidate) || decryptSecret(config.encryptedApiKey, encryptionSecret);
  }

  function publicConfig() {
    return {
      provider: "deepseek",
      providerLabel: "DeepSeek 官方 API",
      baseUrl: DEEPSEEK_API_BASE_URL,
      model: config.model,
      models: DEEPSEEK_MODELS,
      configured: Boolean(config.encryptedApiKey),
      apiKeyMasked: text(config.apiKeyMasked),
      updatedAt: text(config.updatedAt),
      lastTest: config.lastTest || null,
    };
  }

  function runtimeConfig() {
    return {
      provider: "custom:tongzhou",
      model: config.model,
      configured: Boolean(config.encryptedApiKey),
    };
  }

  async function testConnection({ apiKey: candidateKey = "", model = config.model } = {}) {
    const selectedModel = normalizeModel(model, config.model);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(requestTimeoutMs, 20_000));
    timeout?.unref?.();
    let response;
    try {
      response = await fetchImpl(`${DEEPSEEK_API_BASE_URL}/models`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey(candidateKey)}`, Accept: "application/json" },
        signal: controller.signal,
      });
    } catch (caught) {
      if (caught?.name === "AbortError") throw fail("DeepSeek 连接测试超时。", 504, "model_test_timeout");
      throw fail("无法连接 DeepSeek 官方 API，请检查服务器网络。", 502, "model_test_unreachable");
    } finally {
      clearTimeout(timeout);
    }
    const payload = await responseJson(response);
    if (!response.ok) throw fail(upstreamMessage(payload, `DeepSeek 鉴权失败（HTTP ${response.status}）。`), response.status === 401 ? 401 : 502, "model_test_failed");
    const models = (Array.isArray(payload?.data) ? payload.data : []).map((item) => text(item?.id)).filter(Boolean);
    if (models.length && !models.includes(selectedModel)) {
      throw fail(`当前 DeepSeek 账号不可用模型 ${selectedModel}。`, 409, "model_unavailable");
    }
    return { ok: true, model: selectedModel, message: `DeepSeek 连接成功，${selectedModel} 可用。`, testedAt: new Date().toISOString() };
  }

  async function saveConfig(input, actor) {
    if (!canUpdate()) throw fail("当前有智能体任务运行中，请在任务结束后再切换模型配置。", 409, "model_config_busy");
    const selectedModel = normalizeModel(input?.model, config.model);
    const candidateKey = text(input?.apiKey);
    if (!candidateKey && !config.encryptedApiKey) throw fail("首次配置必须填写 DeepSeek API Key。", 400, "api_key_required");
    const tested = await testConnection({ apiKey: candidateKey, model: selectedModel });
    config = {
      ...config,
      model: selectedModel,
      encryptedApiKey: candidateKey ? encryptSecret(candidateKey, encryptionSecret) : config.encryptedApiKey,
      apiKeyMasked: candidateKey ? maskedSecret(candidateKey) : config.apiKeyMasked,
      updatedAt: tested.testedAt,
      updatedBy: text(actor?.id),
      lastTest: { ok: true, message: tested.message, testedAt: tested.testedAt },
    };
    saveJson(storePath, config);
    return publicConfig();
  }

  async function proxyChatCompletions(req, res) {
    const supplied = text(req.headers.authorization).replace(/^Bearer\s+/i, "");
    if (!text(proxySecret) && !text(partnerProxySecret)) throw fail("模型代理尚未配置服务密钥。", 503, "model_proxy_not_configured");
    const isMainProfile = safeEqual(supplied, proxySecret);
    const isPartnerProfile = text(partnerProxySecret) && safeEqual(supplied, partnerProxySecret);
    if (!isMainProfile && !isPartnerProfile) throw fail("模型代理认证失败。", 401, "model_proxy_unauthorized");
    if (!config.encryptedApiKey) throw fail("DeepSeek 尚未配置，请由管理员在智能体工作台完成配置。", 503, "model_not_configured");
    const payload = await parseRequestBody(req, 2 * 1024 * 1024);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw fail("模型请求格式无效。", 400, "invalid_model_request");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    timeout?.unref?.();
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    res.once("close", onClose);
    try {
      const upstream = await fetchImpl(`${DEEPSEEK_API_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey()}`,
          "Content-Type": "application/json",
          Accept: payload.stream === false ? "application/json" : "text/event-stream",
        },
        body: JSON.stringify(prepareHermesModelPayload(payload, config.model, { structured: isPartnerProfile })),
        signal: controller.signal,
      });
      if (!upstream.ok) {
        const errorPayload = await responseJson(upstream);
        throw fail(upstreamMessage(errorPayload, `DeepSeek 请求失败（HTTP ${upstream.status}）。`), upstream.status === 429 ? 429 : 502, "deepseek_upstream_error");
      }
      const headers = {
        "Content-Type": upstream.headers.get("content-type") || (payload.stream === false ? "application/json; charset=utf-8" : "text/event-stream; charset=utf-8"),
        "Cache-Control": "no-store",
      };
      const requestId = upstream.headers.get("x-request-id");
      if (requestId) headers["X-Request-Id"] = requestId;
      res.writeHead(200, headers);
      if (upstream.body) {
        for await (const chunk of upstream.body) {
          if (res.writableEnded || res.destroyed) break;
          res.write(chunk);
        }
      }
      if (!res.writableEnded) res.end();
    } catch (caught) {
      if (caught?.name === "AbortError") throw fail("DeepSeek 请求超时。", 504, "deepseek_timeout");
      throw caught;
    } finally {
      clearTimeout(timeout);
      res.off("close", onClose);
    }
  }

  return {
    publicConfig,
    runtimeConfig,
    testConnection,
    saveConfig,
    async handle(req, res, url) {
      const internalPath = "/api/internal/hermes/v1/model/chat/completions";
      const isConfigPath = url.pathname === "/api/hermes/model-config";
      const isTestPath = url.pathname === "/api/hermes/model-config/test";
      if (url.pathname !== internalPath && !isConfigPath && !isTestPath) return false;
      try {
        if (url.pathname === internalPath) {
          if (req.method !== "POST") throw fail("模型代理仅接受 POST 请求。", 405, "method_not_allowed");
          await proxyChatCompletions(req, res);
          return true;
        }
        const auth = getAuth(req);
        requireAdmin(auth);
        if (isConfigPath && req.method === "GET") {
          sendJson(res, 200, { ok: true, config: publicConfig() });
          return true;
        }
        if (isTestPath && req.method === "POST") {
          const payload = await parseRequestBody(req, 32 * 1024);
          const result = await testConnection(payload);
          sendJson(res, 200, result);
          return true;
        }
        if (isConfigPath && req.method === "PUT") {
          const payload = await parseRequestBody(req, 32 * 1024);
          const saved = await saveConfig(payload, auth.user);
          appendActionLog(auth, "更新 Hermes DeepSeek 模型配置", "hermes_model_config", "deepseek", {
            model: saved.model,
            credentialsUpdated: Boolean(text(payload.apiKey)),
          });
          sendJson(res, 200, { ok: true, config: saved });
          return true;
        }
        throw fail("模型配置接口不存在。", 404, "not_found");
      } catch (caught) {
        if (!res.headersSent) sendJson(res, Number(caught?.statusCode || 500), { ok: false, code: caught?.code || "hermes_model_error", message: caught?.message || "模型配置请求失败。" });
        else if (!res.writableEnded) res.end();
        return true;
      }
    },
  };
}
