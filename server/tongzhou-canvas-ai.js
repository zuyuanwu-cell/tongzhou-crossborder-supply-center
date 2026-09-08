import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const STORE_VERSION = 1;
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "canceled"]);
const MODEL_CATEGORIES = new Set(["chat", "image", "video"]);

function text(value) {
  return String(value ?? "").trim();
}

function loadJson(path, fallback) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  renameSync(tempPath, path);
}

function encryptionKey(secret) {
  const source = text(secret);
  if (source.length < 16) throw new Error("AI 用户密钥加密主密钥长度不足，请配置 AI_CREDENTIAL_ENCRYPTION_KEY。");
  return createHash("sha256").update(source, "utf8").digest();
}

export function encryptCanvasApiKey(value, secret) {
  const apiKey = text(value);
  if (!apiKey) throw new Error("请输入同舟画布 API Key。");
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

export function decryptCanvasApiKey(payload, secret) {
  if (!payload?.iv || !payload?.tag || !payload?.data) throw new Error("当前用户的同舟画布密钥不存在或已损坏。");
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

function normalizeModels(value) {
  return (Array.isArray(value) ? value : []).map((item) => ({
    id: text(item?.id),
    name: text(item?.name) || text(item?.id),
    category: text(item?.category).toLowerCase(),
    estimatedCredits: Number(item?.estimated_credits ?? item?.estimatedCredits) || 0,
  })).filter((item) => item.id && MODEL_CATEGORIES.has(item.category));
}

function normalizeWorkflows(value) {
  return (Array.isArray(value) ? value : []).map((item) => ({
    id: text(item?.id),
    name: text(item?.name) || text(item?.id),
    revision: Number(item?.revision) || 0,
    contract: item?.contract && typeof item.contract === "object" ? item.contract : {},
  })).filter((item) => item.id);
}

function normalizeBalance(value) {
  if (!value || typeof value !== "object") return null;
  return {
    balance: Number(value.balance) || 0,
    creditUnitPrice: Number(value.credit_unit_price ?? value.creditUnitPrice) || 0,
    currency: text(value.currency) || "CNY",
  };
}

function normalizeOutput(value) {
  if (!value || typeof value !== "object") return null;
  return {
    ...value,
    type: text(value.type),
    text: text(value.text),
    url: text(value.url),
    urls: Array.from(new Set((Array.isArray(value.urls) ? value.urls : []).map(text).filter(Boolean))),
  };
}

function publicJob(job) {
  if (!job) return null;
  const { userId: _userId, ...safe } = job;
  return safe;
}

function cleanParams(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, item]) => (
    (typeof item === "string" && item.trim()) || (typeof item === "number" && Number.isFinite(item))
  )));
}

function httpsImages(value) {
  return Array.from(new Set((Array.isArray(value) ? value : []).map(text).filter((item) => {
    try {
      return new URL(item).protocol === "https:";
    } catch {
      return false;
    }
  }))).slice(0, 8);
}

export class TongzhouCanvasApiError extends Error {
  constructor(message, { status = 0, code = "", requestId = "", retryAfter = 0 } = {}) {
    super(message);
    this.name = "TongzhouCanvasApiError";
    this.status = Number(status) || 0;
    this.code = text(code);
    this.requestId = text(requestId);
    this.retryAfter = Number(retryAfter) || 0;
  }
}

export function initTongzhouCanvasAi({
  cacheDir,
  encryptionSecret,
  baseUrl = "https://hb.tongzhoukuajing.com/api/v1",
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  sleepImpl = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)),
} = {}) {
  if (!cacheDir) throw new Error("缺少同舟画布 AI 缓存目录。");
  if (typeof fetchImpl !== "function") throw new Error("当前运行环境不支持同舟画布网络请求。");
  encryptionKey(encryptionSecret);
  const safeBaseUrl = text(baseUrl).replace(/\/+$/, "");
  const parsedBaseUrl = new URL(safeBaseUrl);
  if (parsedBaseUrl.protocol !== "https:" || parsedBaseUrl.hostname !== "hb.tongzhoukuajing.com") {
    throw new Error("同舟画布 API 地址必须使用官方 HTTPS 域名。");
  }

  const configPath = resolve(cacheDir, "tongzhou-canvas-ai-users.json");
  const jobsPath = resolve(cacheDir, "tongzhou-canvas-ai-jobs.json");
  let configState = loadJson(configPath, { version: STORE_VERSION, users: {} });
  let jobState = loadJson(jobsPath, { version: STORE_VERSION, jobs: [] });
  configState = { version: STORE_VERSION, users: configState?.users && typeof configState.users === "object" ? configState.users : {} };
  jobState = { version: STORE_VERSION, jobs: (Array.isArray(jobState?.jobs) ? jobState.jobs : []).slice(-1000) };

  function isoNow() {
    return now().toISOString();
  }

  function userKey(userId) {
    const safe = text(userId);
    if (!safe) throw new Error("请先登录后配置同舟画布 AI。");
    return safe;
  }

  function configFor(userId) {
    return configState.users[userKey(userId)] || null;
  }

  function apiKeyFor(userId) {
    const config = configFor(userId);
    if (!config?.encryptedApiKey) throw new Error("请先在同舟AI中配置你自己的同舟画布 API Key。");
    try {
      return decryptCanvasApiKey(config.encryptedApiKey, encryptionSecret);
    } catch {
      throw new Error("当前用户的同舟画布 API Key 无法解密，请重新保存密钥。");
    }
  }

  async function callWithKey(apiKey, path, { method = "GET", body, idempotencyKey = "" } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let response;
    try {
      response = await fetchImpl(`${safeBaseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new TongzhouCanvasApiError(error?.name === "AbortError" ? "同舟画布 API 请求超时。" : `同舟画布 API 连接失败：${error?.message || "未知错误"}`, {
        code: error?.name === "AbortError" ? "timeout" : "network_error",
      });
    } finally {
      clearTimeout(timer);
    }
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await response.json() : { text: await response.text() };
    if (!response.ok) {
      throw new TongzhouCanvasApiError(data?.error?.message || data?.message || data?.text || "同舟画布 API 请求失败。", {
        status: response.status,
        code: data?.error?.code,
        requestId: data?.request_id,
        retryAfter: response.headers.get("retry-after"),
      });
    }
    return data;
  }

  async function fetchCatalogWithKey(apiKey) {
    const [modelsResult, balanceResult, workflowsResult] = await Promise.all([
      callWithKey(apiKey, "/models"),
      callWithKey(apiKey, "/balance"),
      callWithKey(apiKey, "/workflows"),
    ]);
    return {
      models: normalizeModels(modelsResult?.data),
      balance: normalizeBalance(balanceResult),
      workflows: normalizeWorkflows(workflowsResult?.data),
      checkedAt: isoNow(),
    };
  }

  function chooseModel(catalog, category, requested, previous) {
    const options = catalog.models.filter((model) => model.category === category);
    const candidate = text(requested || previous);
    return options.some((model) => model.id === candidate) ? candidate : (options[0]?.id || candidate);
  }

  async function saveUserConfig(userId, input = {}) {
    const id = userKey(userId);
    const previous = configState.users[id] || {};
    if (input.clearKey === true) {
      delete configState.users[id];
      saveJson(configPath, configState);
      return publicConfig(id);
    }
    const suppliedKey = text(input.apiKey);
    const apiKey = suppliedKey || apiKeyFor(id);
    const catalog = suppliedKey ? await fetchCatalogWithKey(apiKey) : (previous.catalog || await fetchCatalogWithKey(apiKey));
    const selected = input.models || {};
    configState.users[id] = {
      encryptedApiKey: suppliedKey ? encryptCanvasApiKey(apiKey, encryptionSecret) : previous.encryptedApiKey,
      apiKeyMasked: suppliedKey ? maskedSecret(apiKey) : previous.apiKeyMasked,
      models: {
        text: chooseModel(catalog, "chat", selected.text, previous.models?.text),
        image: chooseModel(catalog, "image", selected.image, previous.models?.image),
        video: chooseModel(catalog, "video", selected.video, previous.models?.video),
      },
      workflows: {
        image: text(input.workflows?.image ?? previous.workflows?.image),
        video: text(input.workflows?.video ?? previous.workflows?.video),
      },
      catalog,
      updatedAt: isoNow(),
    };
    saveJson(configPath, configState);
    return publicConfig(id);
  }

  async function refreshCatalog(userId) {
    const id = userKey(userId);
    const previous = configFor(id);
    if (!previous) throw new Error("请先保存同舟画布 API Key。");
    const catalog = await fetchCatalogWithKey(apiKeyFor(id));
    configState.users[id] = {
      ...previous,
      catalog,
      models: {
        text: chooseModel(catalog, "chat", previous.models?.text),
        image: chooseModel(catalog, "image", previous.models?.image),
        video: chooseModel(catalog, "video", previous.models?.video),
      },
      updatedAt: isoNow(),
    };
    saveJson(configPath, configState);
    return publicConfig(id);
  }

  function listJobs(userId, limit = 30) {
    const id = userKey(userId);
    return jobState.jobs.filter((job) => job.userId === id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit).map(publicJob);
  }

  function deleteUserConfig(userId) {
    const id = userKey(userId);
    delete configState.users[id];
    jobState.jobs = jobState.jobs.filter((job) => job.userId !== id);
    saveJson(configPath, configState);
    persistJobs();
  }

  function publicConfig(userId) {
    const id = userKey(userId);
    const config = configFor(id);
    return {
      ok: true,
      provider: "tongzhou_canvas",
      baseUrl: safeBaseUrl,
      configured: Boolean(config?.encryptedApiKey),
      apiKeyMasked: text(config?.apiKeyMasked),
      updatedAt: text(config?.updatedAt),
      models: config?.models || { text: "", image: "", video: "" },
      workflows: config?.workflows || { image: "", video: "" },
      catalog: config?.catalog || { models: [], balance: null, workflows: [], checkedAt: "" },
      recentJobs: listJobs(id),
    };
  }

  function persistJobs() {
    jobState.jobs = jobState.jobs.slice(-1000);
    saveJson(jobsPath, jobState);
  }

  function findJob(userId, jobId) {
    const id = userKey(userId);
    return jobState.jobs.find((job) => job.id === text(jobId) && job.userId === id) || null;
  }

  function createLocalJob(userId, input) {
    const createdAt = isoNow();
    const id = randomUUID();
    return {
      id,
      userId: userKey(userId),
      kind: input.kind,
      category: input.category,
      model: text(input.model),
      workflowId: text(input.workflowId),
      workflowName: text(input.workflowName),
      upstreamId: "",
      idempotencyKey: `tzsc-${createHash("sha256").update(`${userId}:${id}`).digest("hex").slice(0, 32)}`,
      status: "submitting",
      progress: 0,
      estimatedCredits: 0,
      chargedCredits: null,
      output: null,
      error: null,
      requestId: "",
      createdAt,
      updatedAt: createdAt,
    };
  }

  async function submitModelTask(userId, input = {}) {
    const id = userKey(userId);
    const category = text(input.category).toLowerCase();
    if (!MODEL_CATEGORIES.has(category)) throw new Error("生成类型必须是 chat、image 或 video。");
    const config = configFor(id);
    const model = text(input.model || config?.models?.[category === "chat" ? "text" : category]);
    if (!model) throw new Error("请选择可用模型。");
    const availableModel = config?.catalog?.models?.find((item) => item.id === model);
    if (availableModel && availableModel.category !== category) throw new Error("所选模型不支持当前生成类型，请重新选择。");
    if (config?.catalog?.models?.length && !availableModel) throw new Error("所选模型不在当前密钥的可用列表中，请刷新模型后重试。");
    const prompt = text(input.prompt);
    const messages = (Array.isArray(input.messages) ? input.messages : []).slice(-14).map((message) => ({
      role: text(message?.role),
      content: text(message?.content).slice(0, 12000),
    })).filter((message) => ["system", "user", "assistant"].includes(message.role) && message.content);
    if (!prompt && !(category === "chat" && messages.length)) throw new Error("请输入生成内容。");
    const job = createLocalJob(id, { kind: "model", category, model });
    jobState.jobs.push(job);
    persistJobs();
    try {
      const response = await callWithKey(apiKeyFor(id), "/tasks", {
        method: "POST",
        idempotencyKey: job.idempotencyKey,
        body: {
          category,
          model,
          ...(prompt ? { prompt: prompt.slice(0, 12000) } : {}),
          ...(category === "chat" && messages.length ? { messages } : {}),
          ...(category !== "chat" && httpsImages(input.images).length ? { images: httpsImages(input.images) } : {}),
          params: cleanParams(input.params),
        },
      });
      job.upstreamId = text(response?.task?.id);
      if (!job.upstreamId) throw new Error("同舟画布已受理请求，但没有返回任务 ID。");
      job.status = text(response?.task?.status) || "queued";
      job.estimatedCredits = Number(response?.task?.estimated_credits) || 0;
      job.requestId = text(response?.request_id);
      job.updatedAt = isoNow();
      persistJobs();
      return publicJob(job);
    } catch (error) {
      job.status = "failed";
      job.error = { code: text(error?.code), message: error?.message || "提交生成任务失败。" };
      job.requestId = text(error?.requestId);
      job.updatedAt = isoNow();
      persistJobs();
      throw error;
    }
  }

  async function submitWorkflowRun(userId, input = {}) {
    const id = userKey(userId);
    const workflowId = text(input.workflowId);
    if (!workflowId) throw new Error("请选择已发布工作流。");
    const config = configFor(id);
    const workflow = config?.catalog?.workflows?.find((item) => item.id === workflowId);
    if (config?.catalog?.workflows?.length && !workflow) throw new Error("所选工作流不可用，请刷新工作流后重试。");
    const job = createLocalJob(id, { kind: "workflow", category: "workflow", workflowId, workflowName: workflow?.name });
    jobState.jobs.push(job);
    persistJobs();
    try {
      const response = await callWithKey(apiKeyFor(id), `/workflows/${encodeURIComponent(workflowId)}/runs`, {
        method: "POST",
        idempotencyKey: job.idempotencyKey,
        body: {
          inputs: input.inputs && typeof input.inputs === "object" && !Array.isArray(input.inputs) ? input.inputs : {},
          clientReferenceId: text(input.clientReferenceId) || job.id,
        },
      });
      job.upstreamId = text(response?.run?.id);
      if (!job.upstreamId) throw new Error("同舟画布已受理工作流，但没有返回运行 ID。");
      job.status = "queued";
      job.requestId = text(response?.request_id);
      job.updatedAt = isoNow();
      persistJobs();
      return publicJob(job);
    } catch (error) {
      job.status = "failed";
      job.error = { code: text(error?.code), message: error?.message || "提交工作流失败。" };
      job.requestId = text(error?.requestId);
      job.updatedAt = isoNow();
      persistJobs();
      throw error;
    }
  }

  async function pollJob(userId, jobId) {
    const id = userKey(userId);
    const job = findJob(id, jobId);
    if (!job) throw new Error("未找到当前用户的 AI 任务。");
    if (TERMINAL_STATUSES.has(job.status)) return publicJob(job);
    const path = job.kind === "workflow"
      ? `/workflow-runs/${encodeURIComponent(job.upstreamId)}`
      : `/tasks/${encodeURIComponent(job.upstreamId)}`;
    const response = await callWithKey(apiKeyFor(id), path);
    const source = job.kind === "workflow" ? response?.run : response?.task;
    job.status = text(source?.status) || job.status;
    job.progress = Number(source?.progress) || 0;
    job.estimatedCredits = Number(source?.estimated_credits) || job.estimatedCredits || 0;
    job.chargedCredits = source?.charged_credits === null || source?.charged_credits === undefined ? job.chargedCredits : Number(source.charged_credits);
    job.output = normalizeOutput(source?.output);
    const errorValue = source?.error;
    job.error = errorValue ? (typeof errorValue === "string" ? { code: "workflow_error", message: errorValue } : { code: text(errorValue.code), message: text(errorValue.message) }) : null;
    job.requestId = text(response?.request_id || job.requestId);
    job.updatedAt = isoNow();
    persistJobs();
    return publicJob(job);
  }

  async function waitForJob(userId, jobId, { timeoutMs = 180_000, intervalMs = 2_000 } = {}) {
    const startedAt = Date.now();
    let job = findJob(userId, jobId);
    while (job && !TERMINAL_STATUSES.has(job.status)) {
      if (Date.now() - startedAt > timeoutMs) throw new Error("AI 任务仍在处理中，请稍后在任务记录中查看结果。");
      if (intervalMs > 0) await sleepImpl(intervalMs);
      await pollJob(userId, jobId);
      job = findJob(userId, jobId);
    }
    if (!job) throw new Error("AI 任务不存在。");
    if (job.status !== "succeeded") throw new Error(job.error?.message || `AI 任务${job.status === "canceled" ? "已取消" : "生成失败"}。`);
    return publicJob(job);
  }

  return {
    deleteUserConfig,
    listJobs,
    pollJob,
    publicConfig,
    refreshCatalog,
    saveUserConfig,
    submitModelTask,
    submitWorkflowRun,
    waitForJob,
  };
}
