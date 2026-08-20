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
    lastSeenAt: now,
    updatedAt: text(existing.updatedAt) || now,
  };
}

function shopDisplayName(shop) {
  return shop.platformShopName || shop.shopNick || shop.shopId;
}

function maskKey(value) {
  const source = text(value);
  if (!source) return "";
  if (source.length <= 8) return `${source.slice(0, 2)}****`;
  return `${source.slice(0, 4)}****${source.slice(-4)}`;
}

function extractPackageRows(value, output = [], visited = new Set()) {
  if (!value || typeof value !== "object" || visited.has(value)) return output;
  visited.add(value);
  if (!Array.isArray(value) && (value.opOrderPackageId !== undefined || value.op_order_package_id !== undefined)) output.push(value);
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

  function publicPayload({ taskLimit = 100, eventLimit = 80 } = {}) {
    const current = effectiveConfig();
    const shops = [...shopState.shops].sort((left, right) => Number(right.autoApplyTrackingNo) - Number(left.autoApplyTrackingNo) || shopDisplayName(left).localeCompare(shopDisplayName(right), "zh-CN"));
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
      shopsSyncedAt: shopState.syncedAt,
      counts: {
        shops: shops.length,
        enabledShops: shops.filter((shop) => shop.autoApplyTrackingNo).length,
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
      const response = await client().getShops({ ...scope, pageNo: 1, pageSize: 1 });
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
        const response = await api.getShops({ ...scope, pageNo, pageSize: 100 });
        const rows = Array.isArray(response?.data?.shopList) ? response.data.shopList : [];
        rows.forEach((row) => {
          const id = text(row.shopId);
          if (!id) return;
          const normalized = normalizeShop(
            { ...row, platform: row.platform || scope.platform, site: row.site || scope.site },
            existing.get(id) || { autoFetchWaybill: config.autoFetchWaybillDefault },
          );
          existing.set(id, normalized);
          received.push(normalized);
        });
        if (rows.length < 100) break;
      }
    }
    shopState = {
      syncedAt: new Date().toISOString(),
      shops: Array.from(existing.values()),
    };
    saveShops();
    return { ...publicPayload(), syncedCount: new Set(received.map((shop) => shop.shopId)).size };
  }

  function updateShop(shopId, input = {}, actorName = "") {
    const shop = shopState.shops.find((candidate) => candidate.shopId === text(shopId));
    if (!shop) throw new Error("未找到该妙手店铺，请先同步店铺");
    const enabling = input.autoApplyTrackingNo === true;
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
    for (const shopBatch of chunk(enabledShops.map((shop) => shop.shopId), 100)) {
      for (let page = 1; page <= 20 && packageMap.size < config.maxPackagesPerRun; page += 1) {
        const response = await api.searchPackages({
          page,
          pageSize: 100,
          shopIds: shopBatch,
          appPackageStatus: "wait_seller_send",
          appPackageTab: "waitShip",
        });
        const rows = uniquePackages(response);
        rows.forEach((row) => {
          const id = text(row.opOrderPackageId ?? row.op_order_package_id);
          if (id && !packageMap.has(id)) packageMap.set(id, row);
        });
        if (rows.length < 100) break;
      }
    }
    return Array.from(packageMap.values()).slice(0, config.maxPackagesPerRun);
  }

  async function fetchWaybillForTask(task, api = client()) {
    const response = await api.getWaybill(task.opOrderPackageId);
    const url = waybillResult(response);
    if (!url) throw new Error("妙手返回成功但没有面单链接，请稍后重试获取面单");
    return taskStore.markWaybill(task.id, url);
  }

  async function applyTask(task, shop, api = client()) {
    taskStore.markRunning(task.id);
    try {
      const response = await api.applyTrackingNo(task.opOrderPackageId);
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
    try {
      const packages = await fetchEligiblePackages(enabledShops);
      const shopMap = new Map(enabledShops.map((shop) => [shop.shopId, shop]));
      const api = client();
      for (const packageRow of packages) {
        if (text(packageRow.logisticsNo)) {
          const existingTask = taskStore.getByPackageId(text(packageRow.opOrderPackageId ?? packageRow.op_order_package_id));
          if (existingTask && existingTask.status !== "succeeded") {
            taskStore.markSuccess(existingTask.id, {
              trackingNo: text(packageRow.logisticsNo),
              headTrackingNo: text(packageRow.headLogisticsNo),
              logisticsType: text(packageRow.logisticsType),
            });
          }
          continue;
        }
        const shop = shopMap.get(text(packageRow.shopId));
        if (!shop) continue;
        const task = taskStore.upsertPending(packageRow, shop);
        if (task.attempts === 0) discovered += 1;
        if (!retryDue(task) || attempted >= config.maxPackagesPerRun) continue;
        attempted += 1;
        const result = await applyTask(task, shop, api);
        if (result.status === "succeeded") succeeded += 1;
        else failed += 1;
      }
      config.lastRunAt = new Date().toISOString();
      config.lastRunStatus = failed ? "partial" : "success";
      config.lastRunMessage = `读取 ${packages.length} 个待打单包裹，申请 ${attempted} 个，成功 ${succeeded} 个，需处理 ${failed} 个`;
      saveConfig();
      return { skipped: false, startedAt, discovered, attempted, succeeded, failed, payload: publicPayload() };
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
    publicPayload,
    retryTask,
    runAutomation,
    runScheduled,
    syncShops,
    testConnection,
    updateConfig,
    updateShop,
  };
}
