import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createMiaoshouClient, MIAOSHOU_BASE_URL, MiaoshouApiError } from "./miaoshou-client.js";
import { initMiaoshouTaskStore } from "./miaoshou-task-db.js";

const DEFAULT_SCOPE = { platform: "shopee", site: "ID" };
const PLATFORM_OPTIONS = [
  { value: "shopee", label: "Shopee 本土店" },
  { value: "shopeeGlobal", label: "Shopee 全球店" },
  { value: "tiktok", label: "TikTok 本土店" },
  { value: "tiktokGlobal", label: "TikTok 全球店" },
  { value: "pddkj", label: "TEMU 全托管" },
  { value: "pddkjChoice", label: "TEMU 半托管" },
  { value: "ozon", label: "Ozon" },
  { value: "mercadolibre", label: "Mercado Libre" },
];

const SITE_OPTIONS = {
  shopee: [
    { value: "ID", label: "印度尼西亚" },
    { value: "TW", label: "台湾" },
    { value: "VN", label: "越南" },
    { value: "TH", label: "泰国" },
    { value: "MY", label: "马来西亚" },
    { value: "SG", label: "新加坡" },
    { value: "PH", label: "菲律宾" },
    { value: "BR", label: "巴西" },
    { value: "MX", label: "墨西哥" },
    { value: "CL", label: "智利" },
    { value: "CO", label: "哥伦比亚" },
    { value: "PL", label: "波兰" },
    { value: "ES", label: "西班牙" },
    { value: "FR", label: "法国" },
    { value: "AR", label: "阿根廷" },
  ],
  shopeeGlobal: [{ value: "SHOPEEGLOBAL", label: "全球" }],
  tiktok: [
    { value: "ID", label: "印度尼西亚" },
    { value: "VN", label: "越南" },
    { value: "TH", label: "泰国" },
    { value: "MY", label: "马来西亚" },
    { value: "PH", label: "菲律宾" },
    { value: "BR", label: "巴西" },
    { value: "MX", label: "墨西哥" },
    { value: "ES", label: "西班牙" },
    { value: "FR", label: "法国" },
    { value: "GB", label: "英国" },
    { value: "US", label: "美国" },
    { value: "DE", label: "德国" },
    { value: "IT", label: "意大利" },
    { value: "JP", label: "日本" },
  ],
  tiktokGlobal: [
    { value: "TIKTOKGLOBAL", label: "全球" },
    { value: "TIKTOKGLOBALUS", label: "全球 - 美国" },
    { value: "TIKTOKGLOBALEU", label: "欧盟" },
  ],
  pddkj: [{ value: "PDDKJ", label: "TEMU 全托管" }],
  pddkjChoice: [{ value: "PDDKJCHOICE", label: "TEMU 半托管" }],
  ozon: [{ value: "OZON", label: "Ozon" }],
  mercadolibre: [
    { value: "CBT", label: "传统模式" },
    { value: "UP", label: "新 UP 发品模式" },
  ],
};

const MIAOSHOU_PAGE_SIZE = 50;
const DEFAULT_REQUEST_INTERVAL_MS = 1_100;
const DEFAULT_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RATE_LIMIT_RETRY_DELAY_MS = 1_500;
const EXPLICIT_INVALID_SHOP_ERROR_PATTERN = /已解绑|不存在店铺|店铺[^，。]*不存在|店铺参数|shop[^，。]*(?:unbind|not\s*exist|invalid)/i;
const SHOP_SCOPE_ERROR_PATTERN = /越权操作|无权操作|无权限[^，。]*店铺/i;

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(payload, null, 2), "utf8");
}

function text(value) {
  return String(value ?? "").trim();
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function normalizeScopes(input) {
  const rows = Array.isArray(input) ? input : [];
  const seen = new Set();
  return rows.map((row) => ({ platform: text(row?.platform), site: text(row?.site).toUpperCase() }))
    .filter((row) => row.platform && row.site)
    .filter((row) => {
      const key = `${row.platform}:${row.site}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 50);
}

function validateScopes(scopes) {
  for (const scope of scopes) {
    const sites = SITE_OPTIONS[scope.platform];
    if (!sites) throw new Error(`不支持的妙手平台：${scope.platform}`);
    if (!sites.some((site) => site.value === scope.site)) {
      throw new Error(`站点代码与平台不匹配：${scope.platform}/${scope.site}`);
    }
  }
}

function normalizeConfig(input = {}) {
  const scopes = normalizeScopes(input.scopes);
  return {
    appKey: text(input.appKey),
    appSecret: text(input.appSecret),
    automationEnabled: Boolean(input.automationEnabled),
    autoFetchWaybillDefault: input.autoFetchWaybillDefault !== false,
    pollIntervalMinutes: clampNumber(input.pollIntervalMinutes, 1, 60, 3),
    maxPackagesPerRun: clampNumber(input.maxPackagesPerRun, 1, 200, 50),
    scopes: scopes.length ? scopes : [DEFAULT_SCOPE],
    updatedAt: text(input.updatedAt),
    updatedBy: text(input.updatedBy),
    lastConnectionTestAt: text(input.lastConnectionTestAt),
    lastConnectionTestStatus: text(input.lastConnectionTestStatus),
    lastConnectionTestMessage: text(input.lastConnectionTestMessage),
    lastRunAt: text(input.lastRunAt),
    lastRunStatus: text(input.lastRunStatus),
    lastRunMessage: text(input.lastRunMessage),
  };
}

function normalizeShop(row = {}, existing = {}) {
  const now = new Date().toISOString();
  const connectionStatus = text(existing.connectionStatus) === "invalid" ? "invalid" : "active";
  return {
    shopId: text(row.shopId || existing.shopId),
    platform: text(row.platform || existing.platform),
    site: text(row.site || existing.site),
    siteName: text(row.siteName || existing.siteName),
    platformShopName: text(row.platformShopName || existing.platformShopName),
    shopNick: text(row.shopNick || existing.shopNick),
    parentShopId: text(row.parentShopId || existing.parentShopId),
    status: text(row.status ?? existing.status),
    gmtExpire: text(row.gmtExpire || existing.gmtExpire),
    gmtLastAuth: text(row.gmtLastAuth || existing.gmtLastAuth),
    autoApplyTrackingNo: Boolean(existing.autoApplyTrackingNo),
    autoFetchWaybill: existing.autoFetchWaybill !== false,
    enabledAt: text(existing.enabledAt),
    enabledBy: text(existing.enabledBy),
    connectionStatus,
    connectionError: text(existing.connectionError),
    invalidAt: text(existing.invalidAt),
    lastSeenAt: text(row.lastSeenAt || existing.lastSeenAt) || now,
    updatedAt: text(existing.updatedAt) || now,
  };
}

function shopDisplayName(shop) {
  return shop.shopNick || shop.platformShopName || shop.shopId;
}

function isInvalidShopError(error) {
  const details = `${text(error?.code)} ${text(error?.message)}`;
  return EXPLICIT_INVALID_SHOP_ERROR_PATTERN.test(details) || SHOP_SCOPE_ERROR_PATTERN.test(details);
}

function isGenericShopScopeError(error) {
  const details = `${text(error?.code)} ${text(error?.message)}`;
  return SHOP_SCOPE_ERROR_PATTERN.test(details) && !EXPLICIT_INVALID_SHOP_ERROR_PATTERN.test(details);
}

function maskKey(value) {
  const source = text(value);
  if (!source) return "";
  if (source.length <= 8) return `${source.slice(0, 2)}****`;
  return `${source.slice(0, 4)}****${source.slice(-4)}`;
}

function normalizePackageRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const items = [
    ...(Array.isArray(row.items) ? row.items : []),
    ...(Array.isArray(row.giftItems) ? row.giftItems : []),
  ];
  const packageItem = items.find((item) => item?.opOrderPackageId !== undefined || item?.op_order_package_id !== undefined);
  const opOrderPackageId = row.opOrderPackageId ?? row.op_order_package_id
    ?? packageItem?.opOrderPackageId ?? packageItem?.op_order_package_id;
  if (opOrderPackageId === undefined || opOrderPackageId === null || !text(opOrderPackageId)) return null;

  const orderInfo = row.orderInfo && typeof row.orderInfo === "object" ? row.orderInfo : {};
  const logisticsInfo = row.logisticsAgentProductInfo && typeof row.logisticsAgentProductInfo === "object"
    ? row.logisticsAgentProductInfo
    : {};
  const lastMileInfo = row.opOrderPackageToPlatformLastMile && typeof row.opOrderPackageToPlatformLastMile === "object"
    ? row.opOrderPackageToPlatformLastMile
    : {};
  const logisticsNo = [row.logisticsNo, logisticsInfo.logisticsNo, lastMileInfo.logisticsNo]
    .find((value) => text(value));

  return {
    ...row,
    opOrderPackageId,
    shopId: row.shopId ?? orderInfo.shopId,
    platform: row.platform ?? orderInfo.platform,
    site: row.site ?? orderInfo.site,
    platformOrderSn: row.platformOrderSn ?? orderInfo.platformOrderSn,
    logisticsNo: logisticsNo ?? "",
  };
}

function extractPackageRows(value, output = [], visited = new Set()) {
  if (!value || typeof value !== "object" || visited.has(value)) return output;
  visited.add(value);

  if (!Array.isArray(value) && Array.isArray(value.orderPackageList)) {
    value.orderPackageList.forEach((row) => {
      const normalized = normalizePackageRow(row);
      if (normalized) output.push(normalized);
    });
    return output;
  }

  const normalized = normalizePackageRow(value);
  const looksLikePackage = !Array.isArray(value)
    && (value.shopId !== undefined || value.appPackageNo !== undefined || value.orderInfo !== undefined || value.items !== undefined);
  if (normalized && looksLikePackage) {
    output.push(normalized);
    return output;
  }

  if (Array.isArray(value)) value.forEach((entry) => extractPackageRows(entry, output, visited));
  else Object.values(value).forEach((entry) => extractPackageRows(entry, output, visited));
  return output;
}

function uniquePackages(payload) {
  const map = new Map();
  extractPackageRows(payload?.data ?? payload).forEach((row) => {
    const id = text(row.opOrderPackageId ?? row.op_order_package_id);
    if (id && !map.has(id)) map.set(id, row);
  });
  return Array.from(map.values());
}

function firstObjectWith(value, predicate, visited = new Set()) {
  if (!value || typeof value !== "object" || visited.has(value)) return null;
  visited.add(value);
  if (!Array.isArray(value) && predicate(value)) return value;
  for (const entry of Array.isArray(value) ? value : Object.values(value)) {
    const found = firstObjectWith(entry, predicate, visited);
    if (found) return found;
  }
  return null;
}

function applyResult(payload) {
  const row = firstObjectWith(payload?.data ?? payload, (value) => value.logisticsNo || value.headLogisticsNo || value.platformPackageNo);
  return {
    trackingNo: text(row?.logisticsNo),
    headTrackingNo: text(row?.headLogisticsNo),
    logisticsType: text(row?.logisticsType),
    platformPackageNo: text(row?.platformPackageNo),
    headLogisticsCompany: text(row?.headLogisticsNoCompany),
  };
}

function waybillResult(payload) {
  const row = firstObjectWith(payload?.data ?? payload, (value) => value.waybillUrlInfo?.url || (value.url && /waybill|label|pdf/i.test(String(value.url))));
  return text(row?.waybillUrlInfo?.url || row?.url);
}

function hasCredentials(config) {
  return Boolean(text(config.appKey) && text(config.appSecret));
}

function retryDue(task, nowMs = Date.now()) {
  if (task.status === "pending") return true;
  if (task.status !== "retry_wait") return false;
  const lastAttempt = Date.parse(task.lastAttemptAt || task.updatedAt || "");
  const waitMs = Math.min(30 * 60_000, Math.max(60_000, 2 ** Math.max(0, task.attempts - 1) * 60_000));
  return !Number.isFinite(lastAttempt) || nowMs - lastAttempt >= waitMs;
}

function chunk(values, size) {
  const rows = [];
  for (let index = 0; index < values.length; index += size) rows.push(values.slice(index, index + size));
  return rows;
}

export async function initMiaoshouAutomation({
  cacheDir,
  dbPath = resolve(cacheDir, "miaoshou-tasks.sqlite"),
  fetchImpl = globalThis.fetch,
  env = process.env,
  requestTimeoutMs = Number(process.env.MIAOSHOU_REQUEST_TIMEOUT_MS || 25_000),
  requestIntervalMs = Number(process.env.MIAOSHOU_REQUEST_INTERVAL_MS || DEFAULT_REQUEST_INTERVAL_MS),
  rateLimitRetries = Number(process.env.MIAOSHOU_RATE_LIMIT_RETRIES || DEFAULT_RATE_LIMIT_RETRIES),
  rateLimitRetryDelayMs = Number(process.env.MIAOSHOU_RATE_LIMIT_RETRY_DELAY_MS || DEFAULT_RATE_LIMIT_RETRY_DELAY_MS),
  sleepImpl = sleep,
} = {}) {
  const configPath = resolve(cacheDir, "miaoshou-config.json");
  const shopsPath = resolve(cacheDir, "miaoshou-shops.json");
  let config = normalizeConfig(loadJson(configPath, {}));
  let shopState = loadJson(shopsPath, { syncedAt: "", shops: [] });
  shopState = {
    syncedAt: text(shopState.syncedAt),
    shops: (Array.isArray(shopState.shops) ? shopState.shops : []).map((shop) => normalizeShop(shop, shop)),
  };
  const taskStore = await initMiaoshouTaskStore(dbPath);
  let running = false;
  let requestQueue = Promise.resolve();
  let lastRequestStartedAt = 0;
  const safeRequestIntervalMs = clampNumber(requestIntervalMs, 0, 60_000, DEFAULT_REQUEST_INTERVAL_MS);
  const safeRateLimitRetries = clampNumber(rateLimitRetries, 0, 10, DEFAULT_RATE_LIMIT_RETRIES);
  const safeRateLimitRetryDelayMs = clampNumber(rateLimitRetryDelayMs, 0, 60_000, DEFAULT_RATE_LIMIT_RETRY_DELAY_MS);

  function enqueueApiRequest(operation) {
    const queued = requestQueue.then(async () => {
      const waitMs = Math.max(0, safeRequestIntervalMs - (Date.now() - lastRequestStartedAt));
      if (waitMs > 0) await sleepImpl(waitMs);
      lastRequestStartedAt = Date.now();
      return operation();
    });
    requestQueue = queued.catch(() => undefined);
    return queued;
  }

  function isRateLimitError(error) {
    return error instanceof MiaoshouApiError
      && error.retryable
      && !error.ambiguous
      && (error.status === 429 || /频率|限流/.test(error.message));
  }

  async function callApi(operation, { retryRateLimit = false } = {}) {
    const maxRetries = retryRateLimit ? safeRateLimitRetries : 0;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await enqueueApiRequest(operation);
      } catch (error) {
        if (!isRateLimitError(error) || attempt >= maxRetries) throw error;
        const retryDelayMs = safeRateLimitRetryDelayMs * (attempt + 1);
        if (retryDelayMs > 0) await sleepImpl(retryDelayMs);
      }
    }
  }

  function effectiveConfig() {
    return {
      ...config,
      appKey: text(env.MIAOSHOU_APP_KEY) || config.appKey,
      appSecret: text(env.MIAOSHOU_APP_SECRET) || config.appSecret,
      baseUrl: text(env.MIAOSHOU_API_BASE_URL) || MIAOSHOU_BASE_URL,
    };
  }

  function client() {
    const current = effectiveConfig();
    return createMiaoshouClient({
      appKey: current.appKey,
      appSecret: current.appSecret,
      baseUrl: current.baseUrl,
      timeoutMs: requestTimeoutMs,
      fetchImpl,
    });
  }

  function saveConfig() {
    saveJson(configPath, config);
  }

  function saveShops() {
    saveJson(shopsPath, shopState);
  }

  function markShopInvalid(shopId, reason) {
    const shop = shopState.shops.find((candidate) => candidate.shopId === text(shopId));
    if (!shop) return null;
    const now = new Date().toISOString();
    shop.connectionStatus = "invalid";
    shop.connectionError = text(reason) || "妙手返回店铺已解绑或不存在，已忽略自动申请。";
    shop.invalidAt = shop.invalidAt || now;
    shop.autoApplyTrackingNo = false;
    shop.enabledAt = "";
    shop.enabledBy = "";
    shop.updatedAt = now;
    saveShops();
    return shop;
  }

  function publicPayload({ taskLimit = 100, eventLimit = 80 } = {}) {
    const current = effectiveConfig();
    const shops = [...shopState.shops].sort((left, right) => Number(right.connectionStatus === "invalid") - Number(left.connectionStatus === "invalid") || Number(right.autoApplyTrackingNo) - Number(left.autoApplyTrackingNo) || shopDisplayName(left).localeCompare(shopDisplayName(right), "zh-CN"));
    return {
      ok: true,
      provider: "miaoshou",
      config: {
        hasCredentials: hasCredentials(current),
        credentialsSource: text(env.MIAOSHOU_APP_KEY) && text(env.MIAOSHOU_APP_SECRET) ? "environment" : "server",
        appKeyMasked: maskKey(current.appKey),
        automationEnabled: config.automationEnabled,
        autoFetchWaybillDefault: config.autoFetchWaybillDefault,
        pollIntervalMinutes: config.pollIntervalMinutes,
        maxPackagesPerRun: config.maxPackagesPerRun,
        scopes: config.scopes,
        updatedAt: config.updatedAt,
        updatedBy: config.updatedBy,
        lastConnectionTestAt: config.lastConnectionTestAt,
        lastConnectionTestStatus: config.lastConnectionTestStatus,
        lastConnectionTestMessage: config.lastConnectionTestMessage,
        lastRunAt: config.lastRunAt,
        lastRunStatus: config.lastRunStatus,
        lastRunMessage: config.lastRunMessage,
      },
      platformOptions: PLATFORM_OPTIONS,
      siteOptions: SITE_OPTIONS,
      shopsSyncedAt: shopState.syncedAt,
      counts: {
        shops: shops.length,
        enabledShops: shops.filter((shop) => shop.autoApplyTrackingNo).length,
        invalidShops: shops.filter((shop) => shop.connectionStatus === "invalid").length,
        ...taskStore.counts(),
      },
      shops,
      tasks: taskStore.listTasks({ limit: taskLimit }),
      events: taskStore.listEvents(eventLimit).map(({ details: _details, ...event }) => event),
      schedulerRunning: running,
    };
  }

  function updateConfig(input = {}, actorName = "") {
    const nextScopes = input.scopes === undefined ? config.scopes : normalizeScopes(input.scopes);
    if (!nextScopes.length) throw new Error("请至少配置一个店铺平台与站点范围");
    validateScopes(nextScopes);
    const next = normalizeConfig({
      ...config,
      ...input,
      appKey: input.appKey === undefined || !text(input.appKey) ? config.appKey : text(input.appKey),
      appSecret: input.appSecret === undefined || !text(input.appSecret) ? config.appSecret : text(input.appSecret),
      scopes: nextScopes,
      updatedAt: new Date().toISOString(),
      updatedBy: text(actorName),
    });
    if (input.clearCredentials === true) {
      next.appKey = "";
      next.appSecret = "";
      next.automationEnabled = false;
    }
    if (next.automationEnabled && !hasCredentials({ ...next, ...effectiveConfig(), appKey: text(env.MIAOSHOU_APP_KEY) || next.appKey, appSecret: text(env.MIAOSHOU_APP_SECRET) || next.appSecret })) {
      throw new Error("请先保存并检测妙手 AppKey / AppSecret，再开启自动任务");
    }
    config = next;
    saveConfig();
    return publicPayload();
  }

  async function testConnection() {
    const scope = config.scopes[0];
    const testedAt = new Date().toISOString();
    try {
      const response = await callApi(
        () => client().getShops({ ...scope, pageNo: 1, pageSize: 1 }),
        { retryRateLimit: true },
      );
      const shopList = Array.isArray(response?.data?.shopList) ? response.data.shopList : [];
      config.lastConnectionTestAt = testedAt;
      config.lastConnectionTestStatus = "success";
      config.lastConnectionTestMessage = `连接成功，${scope.platform}/${scope.site} 返回 ${shopList.length} 条店铺样本`;
      saveConfig();
      return publicPayload();
    } catch (error) {
      config.lastConnectionTestAt = testedAt;
      config.lastConnectionTestStatus = "failed";
      config.lastConnectionTestMessage = error?.message || "连接失败";
      saveConfig();
      throw error;
    }
  }

  async function syncShops() {
    if (!hasCredentials(effectiveConfig())) throw new Error("请先配置妙手 AppKey / AppSecret");
    const api = client();
    const existing = new Map(shopState.shops.map((shop) => [shop.shopId, shop]));
    const received = [];
    for (const scope of config.scopes) {
      for (let pageNo = 1; pageNo <= 20; pageNo += 1) {
        const response = await callApi(
          () => api.getShops({ ...scope, pageNo, pageSize: MIAOSHOU_PAGE_SIZE }),
          { retryRateLimit: true },
        );
        const rows = Array.isArray(response?.data?.shopList) ? response.data.shopList : [];
        rows.forEach((row) => {
          const id = text(row.shopId);
          if (!id) return;
          const normalized = normalizeShop(
            { ...row, platform: row.platform || scope.platform, site: row.site || scope.site },
            existing.get(id) || { autoFetchWaybill: config.autoFetchWaybillDefault },
          );
          normalized.connectionStatus = "active";
          normalized.connectionError = "";
          normalized.invalidAt = "";
          normalized.lastSeenAt = new Date().toISOString();
          existing.set(id, normalized);
          received.push(normalized);
        });
        if (rows.length < MIAOSHOU_PAGE_SIZE) break;
      }
    }
    const syncedAt = new Date().toISOString();
    const receivedIds = new Set(received.map((shop) => shop.shopId));
    const scopeKeys = new Set(config.scopes.map((scope) => `${scope.platform}:${scope.site}`));
    const shops = Array.from(existing.values()).map((shop) => {
      if (receivedIds.has(shop.shopId) || !scopeKeys.has(`${shop.platform}:${shop.site}`)) return shop;
      return {
        ...shop,
        connectionStatus: "invalid",
        connectionError: "妙手本次同步未返回该店铺，可能已解绑或不存在；已忽略自动申请。",
        invalidAt: shop.invalidAt || syncedAt,
        autoApplyTrackingNo: false,
        enabledAt: "",
        enabledBy: "",
        updatedAt: syncedAt,
      };
    });
    shopState = { syncedAt, shops };
    saveShops();
    return { ...publicPayload(), syncedCount: new Set(received.map((shop) => shop.shopId)).size };
  }

  function updateShop(shopId, input = {}, actorName = "") {
    const shop = shopState.shops.find((candidate) => candidate.shopId === text(shopId));
    if (!shop) throw new Error("未找到该妙手店铺，请先同步店铺");
    const enabling = input.autoApplyTrackingNo === true;
    if (enabling && shop.connectionStatus === "invalid") {
      throw new Error("该店铺已解绑或不存在，请在妙手重新绑定后同步店铺再开启。");
    }
    if (enabling && !hasCredentials(effectiveConfig())) throw new Error("请先配置妙手授权后再启用自动申请");
    shop.autoApplyTrackingNo = input.autoApplyTrackingNo === undefined ? shop.autoApplyTrackingNo : Boolean(input.autoApplyTrackingNo);
    shop.autoFetchWaybill = input.autoFetchWaybill === undefined ? shop.autoFetchWaybill : Boolean(input.autoFetchWaybill);
    shop.enabledAt = shop.autoApplyTrackingNo ? (shop.enabledAt || new Date().toISOString()) : "";
    shop.enabledBy = shop.autoApplyTrackingNo ? text(actorName) : "";
    shop.updatedAt = new Date().toISOString();
    saveShops();
    return publicPayload();
  }

  async function fetchEligiblePackages(enabledShops) {
    const api = client();
    const packageMap = new Map();
    const invalidCandidates = [];
    async function fetchBatch(shopBatch) {
      try {
        for (let page = 1; page <= 20; page += 1) {
          if (page > 1 && packageMap.size >= config.maxPackagesPerRun) break;
          const response = await callApi(
            () => api.searchPackages({
              page,
              pageSize: MIAOSHOU_PAGE_SIZE,
              shopIds: shopBatch,
              appPackageStatus: "wait_seller_send",
            }),
            { retryRateLimit: true },
          );
          const rows = uniquePackages(response);
          rows.forEach((row) => {
            const id = text(row.opOrderPackageId ?? row.op_order_package_id);
            if (id && !packageMap.has(id)) packageMap.set(id, row);
          });
          if (rows.length < MIAOSHOU_PAGE_SIZE || packageMap.size >= config.maxPackagesPerRun) break;
        }
      } catch (error) {
        if (!isInvalidShopError(error)) throw error;
        if (shopBatch.length > 1) {
          const middle = Math.ceil(shopBatch.length / 2);
          await fetchBatch(shopBatch.slice(0, middle));
          await fetchBatch(shopBatch.slice(middle));
          return;
        }
        invalidCandidates.push({
          shopId: shopBatch[0],
          reason: text(error?.message),
          genericScopeError: isGenericShopScopeError(error),
        });
      }
    }
    for (const shopBatch of chunk(enabledShops.map((shop) => shop.shopId), 100)) {
      await fetchBatch(shopBatch);
    }
    if (invalidCandidates.length === enabledShops.length && invalidCandidates.every((shop) => shop.genericScopeError)) {
      throw new MiaoshouApiError("妙手包裹接口对全部已启用店铺返回“越权操作”，请检查开放平台包裹权限；本次未停用任何店铺。", {
        code: "package_permission_denied",
      });
    }
    const invalidShops = invalidCandidates.map((candidate) => {
      const invalidShop = markShopInvalid(candidate.shopId, candidate.reason);
      return invalidShop ? {
        shopId: invalidShop.shopId,
        shopName: shopDisplayName(invalidShop),
        reason: invalidShop.connectionError,
      } : null;
    }).filter(Boolean);
    return {
      packages: Array.from(packageMap.values()).slice(0, config.maxPackagesPerRun),
      invalidShops,
    };
  }

  async function fetchWaybillForTask(task, api = client()) {
    const response = await callApi(
      () => api.getWaybill(task.opOrderPackageId),
      { retryRateLimit: true },
    );
    const url = waybillResult(response);
    if (!url) throw new Error("妙手返回成功但没有面单链接，请稍后重试获取面单");
    return taskStore.markWaybill(task.id, url);
  }

  async function applyTask(task, shop, api = client()) {
    taskStore.markRunning(task.id);
    try {
      const response = await callApi(() => api.applyTrackingNo(task.opOrderPackageId));
      const result = applyResult(response);
      if (!result.trackingNo && !result.headTrackingNo) {
        return taskStore.markFailure(task.id, {
          status: "manual_check",
          code: "missing_tracking_no",
          message: "妙手返回成功但缺少运单号，请在妙手后台核实后再处理",
        });
      }
      let completed = taskStore.markSuccess(task.id, result);
      if (shop?.autoFetchWaybill) {
        try {
          completed = await fetchWaybillForTask(completed, api);
        } catch (waybillError) {
          taskStore.addEvent(completed.id, "waybill_failed", "succeeded", waybillError?.message || "获取面单失败", waybillError?.code || "", {});
          completed = taskStore.getTask(completed.id);
        }
      }
      return completed;
    } catch (error) {
      const isApiError = error instanceof MiaoshouApiError;
      const safeRateLimitRetry = isApiError && error.retryable && !error.ambiguous && (error.status === 429 || /频率|限流/.test(error.message));
      const status = safeRateLimitRetry ? "retry_wait" : "manual_check";
      return taskStore.markFailure(task.id, {
        status,
        code: error?.code || "apply_failed",
        message: error?.message || "申请运单号失败",
        details: { status: error?.status || 0, ambiguous: Boolean(error?.ambiguous) },
      });
    }
  }

  async function runAutomation({ force = false, shopIds = [] } = {}) {
    if (running) throw new Error("妙手自动申请任务正在运行，请稍后刷新");
    const current = effectiveConfig();
    if (!hasCredentials(current)) throw new Error("请先配置妙手 AppKey / AppSecret");
    if (!force && !config.automationEnabled) return { skipped: true, message: "妙手自动任务总开关未开启", payload: publicPayload() };
    const selected = new Set((Array.isArray(shopIds) ? shopIds : []).map(text).filter(Boolean));
    const enabledShops = shopState.shops.filter((shop) => shop.autoApplyTrackingNo && (!selected.size || selected.has(shop.shopId)));
    if (!enabledShops.length) return { skipped: true, message: "当前没有已启用自动申请的店铺", payload: publicPayload() };

    running = true;
    const startedAt = new Date().toISOString();
    let discovered = 0;
    let attempted = 0;
    let succeeded = 0;
    let failed = 0;
    let existingTracking = 0;
    try {
      const { packages, invalidShops } = await fetchEligiblePackages(enabledShops);
      const shopMap = new Map(enabledShops.map((shop) => [shop.shopId, shop]));
      const api = client();
      for (const packageRow of packages) {
        const shop = shopMap.get(text(packageRow.shopId));
        if (!shop) continue;
        const observedTrackingNo = text(packageRow.logisticsNo);
        if (observedTrackingNo) {
          existingTracking += 1;
          let existingTask = taskStore.getByPackageId(text(packageRow.opOrderPackageId ?? packageRow.op_order_package_id));
          if (!existingTask) {
            existingTask = taskStore.upsertPending(packageRow, shop, {
              discoveryType: "discovered_existing_tracking",
              discoveryMessage: "发现妙手已有运单号包裹",
            });
          }
          if (
            existingTask.status !== "succeeded"
            || existingTask.trackingNo !== observedTrackingNo
            || existingTask.headTrackingNo !== text(packageRow.headLogisticsNo)
            || existingTask.logisticsType !== text(packageRow.logisticsType)
          ) {
            taskStore.markObservedTracking(existingTask.id, {
              trackingNo: observedTrackingNo,
              headTrackingNo: text(packageRow.headLogisticsNo),
              logisticsType: text(packageRow.logisticsType),
            });
          }
          continue;
        }
        const task = taskStore.upsertPending(packageRow, shop);
        if (task.attempts === 0) discovered += 1;
        if (!retryDue(task) || attempted >= config.maxPackagesPerRun) continue;
        attempted += 1;
        const result = await applyTask(task, shop, api);
        if (result.status === "succeeded") succeeded += 1;
        else failed += 1;
      }
      config.lastRunAt = new Date().toISOString();
      config.lastRunStatus = failed || invalidShops.length ? "partial" : "success";
      config.lastRunMessage = `读取 ${packages.length} 个待发货包裹，已有运单 ${existingTracking} 个，申请 ${attempted} 个，成功 ${succeeded} 个，需处理 ${failed} 个${invalidShops.length ? `，已识别并跳过失效店铺 ${invalidShops.length} 家` : ""}`;
      saveConfig();
      return { skipped: false, startedAt, discovered, existingTracking, attempted, succeeded, failed, invalidShops, payload: publicPayload() };
    } catch (error) {
      config.lastRunAt = new Date().toISOString();
      config.lastRunStatus = "failed";
      config.lastRunMessage = error?.message || "妙手自动申请任务失败";
      saveConfig();
      throw error;
    } finally {
      running = false;
    }
  }

  async function retryTask(taskId) {
    if (running) throw new Error("妙手自动申请任务正在运行，请稍后再重试单个包裹");
    const task = taskStore.resetForRetry(taskId);
    const shop = shopState.shops.find((candidate) => candidate.shopId === task.shopId);
    if (!shop) throw new Error("任务对应店铺已不存在，请先同步店铺");
    return applyTask(task, shop);
  }

  async function getWaybill(taskId) {
    const task = taskStore.getTask(taskId);
    if (!task) throw new Error("未找到妙手运单任务");
    if (task.status !== "succeeded") throw new Error("运单号尚未申请成功，不能获取面单");
    return fetchWaybillForTask(task);
  }

  function performanceContext() {
    const current = effectiveConfig();
    return {
      hasCredentials: hasCredentials(current),
      scopes: config.scopes.map((scope) => ({ ...scope })),
      shops: shopState.shops
        .filter((shop) => shop.connectionStatus !== "invalid" && text(shop.shopId))
        .map((shop) => ({
          shopId: shop.shopId,
          platform: shop.platform,
          site: shop.site,
          shopNick: shop.shopNick,
          platformShopName: shop.platformShopName,
        })),
      shopsSyncedAt: shopState.syncedAt,
    };
  }

  async function searchPerformancePackages(input) {
    if (!hasCredentials(effectiveConfig())) throw new Error("请先配置妙手 AppKey / AppSecret");
    return callApi(() => client().searchPackages(input), { retryRateLimit: true });
  }

  async function searchPerformanceReturns(input) {
    if (!hasCredentials(effectiveConfig())) throw new Error("请先配置妙手 AppKey / AppSecret");
    return callApi(() => client().searchReturns(input), { retryRateLimit: true });
  }

  async function searchPerformanceCancellations(input) {
    if (!hasCredentials(effectiveConfig())) throw new Error("请先配置妙手 AppKey / AppSecret");
    return callApi(() => client().searchCancellations(input), { retryRateLimit: true });
  }

  async function runScheduled() {
    if (running || !config.automationEnabled || !hasCredentials(effectiveConfig())) return null;
    const lastRun = Date.parse(config.lastRunAt || "");
    const intervalMs = config.pollIntervalMinutes * 60_000;
    if (Number.isFinite(lastRun) && Date.now() - lastRun < intervalMs) return null;
    try {
      return await runAutomation();
    } catch (error) {
      console.error(`[miaoshou] ${error?.message || error}`);
      return null;
    }
  }

  return {
    getWaybill,
    performanceContext,
    publicPayload,
    retryTask,
    runAutomation,
    runScheduled,
    searchPerformanceCancellations,
    searchPerformancePackages,
    searchPerformanceReturns,
    syncShops,
    testConnection,
    updateConfig,
    updateShop,
  };
}
