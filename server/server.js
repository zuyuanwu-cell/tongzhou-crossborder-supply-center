import http from "node:http";
import { createReadStream, mkdirSync, readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, extname, relative, resolve } from "node:path";
import { fetch as undiciFetch } from "undici";
import { createJdyData, deleteJdyData, fetchAllJdyAssets, fetchAllJdyOutsourcingOrders, fetchAllJdyProducts, fetchAllJdyQualifications, fetchAllJdyWarehouseInfo, hasJdyCredentials, updateJdyData } from "./jiandaoyun-client.js";
import { buildProductPayload } from "./normalize-products.js";
import { buildQualificationPayload } from "./normalize-qualifications.js";
import { buildAssetPayload } from "./normalize-assets.js";
import { buildWarehouseInfoPayload } from "./normalize-warehouse-info.js";
import { buildOutsourcingOrderPayload } from "./normalize-outsourcing-orders.js";
import { sampleCatalogRecords, sampleProductBaseRecords } from "./sample-data.js";
import { JIANYUN_FORMS } from "./field-mapping.js";
import { WAREHOUSE_CONNECTIONS, WMS_PROVIDERS } from "./warehouse-config.js";
import { buildMovementDiagnostics, buildMovementPayload } from "./movement-analytics.js";
import { initMovementHistoryStore } from "./movement-history-db.js";
import { buildStockupPayload } from "./stockup-center.js";
import { mergeWarehouseDataIntoProducts, syncWarehouseConnection, syncWarehouseOrders, syncWarehouseOrdersRange, syncWarehouseStockupOrders } from "./wms-adapters.js";
import { authenticateLocalUser, createLocalUser, createSessionToken, jdyUserRecordData, jdyUserStatusData, publicUser, verifySessionToken } from "./user-auth.js";

if (!globalThis.fetch) {
  globalThis.fetch = undiciFetch;
}

function loadEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (!key || process.env[key]) continue;
    process.env[key] = rest.join("=").trim();
  }
}

loadEnv();

const port = Number(process.env.API_PORT || 8787);
const cacheDir = resolve(process.cwd(), ".cache");
const distDir = resolve(process.cwd(), "dist");
const productCachePath = resolve(cacheDir, "products.json");
const warehouseCachePath = resolve(cacheDir, "warehouse-sync.json");
const inventorySnapshotCachePath = resolve(cacheDir, "inventory-snapshots.json");
const movementHistoryCachePath = resolve(cacheDir, "movement-history.json");
const movementHistoryDbPath = resolve(process.env.MOVEMENT_HISTORY_DB_PATH || resolve(cacheDir, "movement-history.sqlite"));
const orderCachePath = resolve(cacheDir, "orders-sync.json");
const orderSyncJobsCachePath = resolve(cacheDir, "order-sync-jobs.json");
const warehouseConnectionsPath = resolve(cacheDir, "warehouse-connections.json");
const qualificationCachePath = resolve(cacheDir, "qualifications.json");
const assetCachePath = resolve(cacheDir, "assets.json");
const warehouseInfoCachePath = resolve(cacheDir, "warehouse-info.json");
const quickNavCachePath = resolve(cacheDir, "quick-nav.json");
const aiConfigCachePath = resolve(cacheDir, "ai-config.json");
const wecomNotificationCachePath = resolve(cacheDir, "wecom-notifications.json");
const actionLogCachePath = resolve(cacheDir, "action-log.json");
const distributorApplicationsPath = resolve(cacheDir, "distributor-applications.json");
const aiUploadDir = resolve(cacheDir, "ai-uploads");
const aiVideoPublicDir = resolve(process.cwd(), "public", "ai-videos");
const stockupCachePath = resolve(cacheDir, "stockup-sync.json");
const stockupDecisionCachePath = resolve(cacheDir, "stockup-decisions.json");
const stockupPlanCachePath = resolve(cacheDir, "stockup-plans.json");
const outsourcingOrderCachePath = resolve(cacheDir, "outsourcing-orders.json");
const usersCachePath = resolve(cacheDir, "users.json");
const autoSyncIntervalMs = Number(process.env.AUTO_SYNC_INTERVAL_MS || 10 * 60 * 1000);
const orderSyncTimeoutMs = Number(process.env.ORDER_SYNC_TIMEOUT_MS || 45 * 1000);
const orderSyncChunkDays = Math.max(1, Math.min(30, Number(process.env.ORDER_SYNC_CHUNK_DAYS || 7)));
const inventorySnapshotTimezone = process.env.INVENTORY_SNAPSHOT_TIMEZONE || "Asia/Shanghai";
const movementHistoryTimezone = process.env.MOVEMENT_HISTORY_TIMEZONE || inventorySnapshotTimezone;
let cachedProducts = loadProductCache() || buildProductPayload(sampleProductBaseRecords, sampleCatalogRecords, "sample");
let cachedWarehouseSync = loadJsonCache(warehouseCachePath) || { syncedAt: "", products: [], inventory: [], results: [] };
let cachedInventorySnapshots = loadJsonCache(inventorySnapshotCachePath) || { updatedAt: "", lastSnapshotAt: "", snapshots: [] };
let cachedMovementHistory = loadJsonCache(movementHistoryCachePath) || { updatedAt: "", lastSnapshotAt: "", snapshots: [] };
let cachedOrdersSync = loadJsonCache(orderCachePath) || { syncedAt: "", orders: [], results: [] };
let cachedOrderSyncJobs = loadJsonCache(orderSyncJobsCachePath) || { updatedAt: "", jobs: [] };
let cachedStockupSync = loadJsonCache(stockupCachePath) || { syncedAt: "", orders: [], results: [] };
let cachedStockupDecisions = loadJsonCache(stockupDecisionCachePath) || { updatedAt: "", decisions: {} };
let cachedStockupPlans = normalizeStockupPlans(loadJsonCache(stockupPlanCachePath));
let warehouseConnections = loadJsonCache(warehouseConnectionsPath) || WAREHOUSE_CONNECTIONS;
let cachedQualifications = loadJsonCache(qualificationCachePath) || buildQualificationPayload([], "empty");
let cachedAssets = loadJsonCache(assetCachePath) || buildAssetPayload([], "empty");
let cachedWarehouseInfo = loadJsonCache(warehouseInfoCachePath) || buildWarehouseInfoPayload([], "empty");
let cachedQuickNav = loadJsonCache(quickNavCachePath) || buildQuickNavPayload([]);
let cachedAiConfig = loadJsonCache(aiConfigCachePath) || buildAiConfig({});
let cachedWecomNotifications = loadJsonCache(wecomNotificationCachePath) || buildWecomNotificationPayload({});
let cachedActionLog = normalizeActionLog(loadJsonCache(actionLogCachePath));
let cachedDistributorApplications = normalizeDistributorApplications(loadJsonCache(distributorApplicationsPath));
let cachedOutsourcingOrders = loadJsonCache(outsourcingOrderCachePath) || buildOutsourcingOrderPayload([], "empty");
const movementHistoryStore = await initMovementHistoryStore(movementHistoryDbPath, cachedMovementHistory);
const defaultInternalAccessCode = "admin123";
const configuredInternalAccessCode = String(process.env.INTERNAL_ACCESS_CODE || "").trim();
const isProductionRuntime = process.env.NODE_ENV === "production";
const allowInsecureInternalAccessCode = process.env.ALLOW_INSECURE_INTERNAL_ACCESS_CODE === "true";
const internalAccessCode = configuredInternalAccessCode || (isProductionRuntime ? "" : defaultInternalAccessCode);
const sessionSecret = process.env.AUTH_SESSION_SECRET || internalAccessCode || "tongzhou-local-session";
const directAuth = {
  role: "direct",
  user: {
    id: "system",
    username: "system",
    displayName: "系统",
    role: "direct",
    roleLabel: "直营部门",
  },
};
assertSecureRuntimeConfig();
let cachedUsers = loadUsersCache();
let autoSyncRunning = false;
let lastAutoSyncAt = "";
let lastScheduledInventorySnapshotDate = "";
let scheduledInventorySnapshotRunning = false;
let wecomScheduleRunning = false;

function loadProductCache() {
  return loadJsonCache(productCachePath);
}

function loadJsonCache(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function saveJsonCache(path, payload) {
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(path, JSON.stringify(payload, null, 2), "utf8");
}

function saveProductCache(payload) {
  saveJsonCache(productCachePath, payload);
}

function saveWarehouseCache(payload) {
  saveJsonCache(warehouseCachePath, payload);
}

function saveInventorySnapshotCache(payload) {
  saveJsonCache(inventorySnapshotCachePath, payload);
}

function saveMovementHistoryCache(payload) {
  saveJsonCache(movementHistoryCachePath, payload);
}

function saveOrderCache(payload) {
  saveJsonCache(orderCachePath, payload);
}

function saveOrderSyncJobsCache() {
  cachedOrderSyncJobs.updatedAt = new Date().toISOString();
  cachedOrderSyncJobs.jobs = (cachedOrderSyncJobs.jobs || []).slice(0, 20);
  saveJsonCache(orderSyncJobsCachePath, cachedOrderSyncJobs);
}

function saveStockupCache(payload) {
  saveJsonCache(stockupCachePath, payload);
}

function saveStockupDecisionCache() {
  cachedStockupDecisions.updatedAt = new Date().toISOString();
  saveJsonCache(stockupDecisionCachePath, cachedStockupDecisions);
}

function saveStockupPlanCache() {
  cachedStockupPlans = normalizeStockupPlans(cachedStockupPlans);
  saveJsonCache(stockupPlanCachePath, cachedStockupPlans);
}

function saveWarehouseConnections() {
  saveJsonCache(warehouseConnectionsPath, warehouseConnections);
}

function saveQualificationCache(payload) {
  saveJsonCache(qualificationCachePath, payload);
}

function saveAssetCache(payload) {
  saveJsonCache(assetCachePath, payload);
}

function saveWarehouseInfoCache(payload) {
  saveJsonCache(warehouseInfoCachePath, payload);
}

function saveQuickNavCache() {
  cachedQuickNav = buildQuickNavPayload(cachedQuickNav.categories || []);
  saveJsonCache(quickNavCachePath, cachedQuickNav);
}

function saveWecomNotificationCache() {
  cachedWecomNotifications = buildWecomNotificationPayload(cachedWecomNotifications);
  saveJsonCache(wecomNotificationCachePath, cachedWecomNotifications);
}

function saveActionLogCache() {
  cachedActionLog = normalizeActionLog(cachedActionLog);
  saveJsonCache(actionLogCachePath, cachedActionLog);
}

function saveDistributorApplicationsCache() {
  cachedDistributorApplications = normalizeDistributorApplications(cachedDistributorApplications);
  saveJsonCache(distributorApplicationsPath, cachedDistributorApplications);
}

function saveOutsourcingOrderCache(payload) {
  saveJsonCache(outsourcingOrderCachePath, payload);
}

function quickNavId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function wecomId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function stockupPlanId(prefix = "plan") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function actionLogId(prefix = "log") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function distributorApplicationId(prefix = "dist-app") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeDistributorApplications(input = {}) {
  const applications = Array.isArray(input?.applications) ? input.applications : [];
  return {
    ok: true,
    source: "local",
    updatedAt: input?.updatedAt || "",
    counts: {
      applications: applications.length,
      pending: applications.filter((item) => (item.status || "pending") === "pending").length,
    },
    applications: applications
      .map((item) => ({
        id: String(item.id || distributorApplicationId()).trim(),
        companyName: String(item.companyName || "").trim(),
        contactName: String(item.contactName || "").trim(),
        phone: String(item.phone || "").trim(),
        wechat: String(item.wechat || "").trim(),
        email: String(item.email || "").trim(),
        market: String(item.market || "").trim(),
        note: String(item.note || "").trim(),
        sourceSku: String(item.sourceSku || "").trim(),
        status: ["pending", "contacted", "approved", "rejected"].includes(item.status) ? item.status : "pending",
        createdAt: item.createdAt || new Date().toISOString(),
        updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
      }))
      .filter((item) => item.id && item.companyName && item.contactName)
      .slice(0, 500),
  };
}

function sanitizeActionLogDetails(value, depth = 0) {
  if (depth > 3) return undefined;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeActionLogDetails(item, depth + 1));
  }
  if (!value || typeof value !== "object") return value;
  const blocked = /password|secret|token|webhook|credential|authorization|api[-_]?key|app[-_]?key|access[-_]?key/i;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !blocked.test(key))
      .map(([key, entry]) => [key, sanitizeActionLogDetails(entry, depth + 1)])
      .filter(([, entry]) => entry !== undefined),
  );
}

function normalizeActionLog(input = {}) {
  const entries = Array.isArray(input?.entries) ? input.entries : [];
  return {
    ok: true,
    source: "local",
    updatedAt: input?.updatedAt || "",
    entries: entries
      .map((entry) => ({
        id: String(entry.id || actionLogId()),
        createdAt: entry.createdAt || new Date().toISOString(),
        action: String(entry.action || "update").trim(),
        targetType: String(entry.targetType || "system").trim(),
        targetName: String(entry.targetName || "").trim(),
        actorId: String(entry.actorId || "").trim(),
        actorName: String(entry.actorName || "").trim(),
        actorRole: String(entry.actorRole || "").trim(),
        details: sanitizeActionLogDetails(entry.details || {}),
      }))
      .filter((entry) => entry.action)
      .slice(0, 300),
  };
}

function appendActionLog(auth, action, targetType, targetName, details = {}) {
  const actor = auth?.user || {};
  const now = new Date().toISOString();
  const entry = {
    id: actionLogId(),
    createdAt: now,
    action: String(action || "update").trim(),
    targetType: String(targetType || "system").trim(),
    targetName: String(targetName || "").trim(),
    actorId: String(actor.id || "").trim(),
    actorName: String(actor.displayName || actor.username || auth?.role || "system").trim(),
    actorRole: String(actor.roleLabel || auth?.role || actor.role || "").trim(),
    details: sanitizeActionLogDetails(details),
  };
  cachedActionLog = normalizeActionLog({
    updatedAt: now,
    entries: [entry, ...(cachedActionLog.entries || [])],
  });
  saveActionLogCache();
  return entry;
}

function publicActionLog() {
  return normalizeActionLog(cachedActionLog);
}

function publicDistributorApplications() {
  return normalizeDistributorApplications(cachedDistributorApplications);
}

function createDistributorApplication(payload = {}) {
  const now = new Date().toISOString();
  const application = {
    id: distributorApplicationId(),
    companyName: String(payload.companyName || "").trim(),
    contactName: String(payload.contactName || "").trim(),
    phone: String(payload.phone || "").trim(),
    wechat: String(payload.wechat || "").trim(),
    email: String(payload.email || "").trim(),
    market: String(payload.market || "").trim(),
    note: String(payload.note || "").trim(),
    sourceSku: String(payload.sourceSku || "").trim(),
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  if (!application.companyName) throw new Error("请填写公司或店铺名称。");
  if (!application.contactName) throw new Error("请填写联系人。");
  if (!application.phone && !application.wechat && !application.email) throw new Error("请至少填写手机号、微信或邮箱中的一种联系方式。");
  cachedDistributorApplications = normalizeDistributorApplications({
    updatedAt: now,
    applications: [application, ...(cachedDistributorApplications.applications || [])],
  });
  saveDistributorApplicationsCache();
  appendActionLog({ role: "guest", user: { id: "guest", username: "guest", displayName: application.contactName, role: "guest", roleLabel: "外部分销申请" } }, "提交分销账号申请", "distributor_application", application.companyName, {
    applicationId: application.id,
    market: application.market,
    sourceSku: application.sourceSku,
    hasPhone: Boolean(application.phone),
    hasWechat: Boolean(application.wechat),
    hasEmail: Boolean(application.email),
  });
  return application;
}

function updateDistributorApplicationStatus(applicationId, status) {
  const allowed = new Set(["pending", "contacted", "approved", "rejected"]);
  const nextStatus = allowed.has(status) ? status : "";
  if (!nextStatus) throw new Error("无效的申请状态。");
  const application = (cachedDistributorApplications.applications || []).find((item) => item.id === applicationId);
  if (!application) throw new Error("分销账号申请不存在。");
  application.status = nextStatus;
  application.updatedAt = new Date().toISOString();
  cachedDistributorApplications.updatedAt = application.updatedAt;
  saveDistributorApplicationsCache();
  return application;
}

function isWeakInternalAccessCode(value) {
  const code = String(value || "").trim();
  return !code || code === defaultInternalAccessCode || code === "change-me-to-a-strong-internal-code" || code.length < 12;
}

function assertSecureRuntimeConfig() {
  if (isProductionRuntime && isWeakInternalAccessCode(internalAccessCode) && !allowInsecureInternalAccessCode) {
    throw new Error("Refusing to start in production: set a strong INTERNAL_ACCESS_CODE and AUTH_SESSION_SECRET.");
  }
  if (!isProductionRuntime && !configuredInternalAccessCode) {
    console.warn("[security] INTERNAL_ACCESS_CODE is not set; using the local development fallback. Do not use this in production.");
  }
}

function stockupRecommendationKey(item) {
  return [item.country, item.sku || item.countrySku || item.id].map((value) => String(value || "").trim()).filter(Boolean).join("::").toLowerCase();
}

function stockupDecisionFor(item) {
  const key = stockupRecommendationKey(item);
  return key ? cachedStockupDecisions.decisions?.[key] : null;
}

function normalizeStockupPlans(input = {}) {
  const now = new Date().toISOString();
  const plans = Array.isArray(input?.plans) ? input.plans : [];
  return {
    ok: true,
    source: "local",
    updatedAt: input?.updatedAt || "",
    plans: plans
      .map((plan) => ({
        id: String(plan.id || stockupPlanId()).trim(),
        recommendationKey: String(plan.recommendationKey || "").trim(),
        sku: String(plan.sku || "").trim(),
        country: String(plan.country || "").trim(),
        name: String(plan.name || "").trim(),
        unit: String(plan.unit || "").trim(),
        quantity: numberOrZero(plan.quantity),
        planType: plan.planType === "outsourcing" ? "outsourcing" : "purchase",
        owner: String(plan.owner || "").trim(),
        expectedArrivalAt: String(plan.expectedArrivalAt || "").trim(),
        status: ["draft", "ordered", "in_production", "arrived", "cancelled"].includes(plan.status) ? plan.status : "draft",
        note: String(plan.note || "").trim(),
        source: String(plan.source || "stockup").trim(),
        createdAt: plan.createdAt || now,
        updatedAt: plan.updatedAt || plan.createdAt || now,
      }))
      .filter((plan) => plan.id && plan.recommendationKey && plan.sku)
      .slice(0, 500),
  };
}

function stockupPlanCounts(plans = []) {
  const active = plans.filter((plan) => !["arrived", "cancelled"].includes(plan.status));
  return {
    stockupPlans: plans.length,
    openStockupPlans: active.length,
    plannedQty: active.reduce((sum, plan) => sum + numberOrZero(plan.quantity), 0),
  };
}

function recalculateStockupCounts(payload) {
  const recommendations = payload.recommendations || [];
  const plans = cachedStockupPlans.plans || [];
  payload.counts = {
    ...payload.counts,
    recommendations: recommendations.length,
    recommendedQty: recommendations.reduce((sum, item) => sum + numberOrZero(item.replenishQty), 0),
    outsourcingInRecommendationQty: recommendations.reduce((sum, item) => sum + numberOrZero(item.outsourcingInProductionQty), 0),
    netRecommendedQty: recommendations.reduce((sum, item) => sum + numberOrZero(item.netReplenishQty), 0),
    acceptedRecommendations: recommendations.filter((item) => item.decisionStatus === "accepted").length,
    abandonedRecommendations: Object.values(cachedStockupDecisions.decisions || {}).filter((item) => item?.status === "abandoned").length,
    ...stockupPlanCounts(plans),
  };
  payload.plans = plans;
  return payload;
}

function applyStockupDecisions(payload) {
  const decorated = (payload.recommendations || [])
    .map((item) => {
      const decision = stockupDecisionFor(item);
      return {
        ...item,
        recommendationKey: stockupRecommendationKey(item),
        decisionStatus: decision?.status || "pending",
        decisionAt: decision?.updatedAt || "",
        decisionNote: decision?.note || "",
      };
    });
  return recalculateStockupCounts({
    ...payload,
    recommendations: decorated.filter((item) => item.decisionStatus !== "abandoned"),
    abandonedRecommendations: decorated.filter((item) => item.decisionStatus === "abandoned"),
  });
}

function normalizeWecomWebhook(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("企业微信机器人地址必须是 http 或 https。");
  return parsed.toString();
}

function maskWebhook(url) {
  const text = String(url || "");
  if (!text) return "";
  return text.replace(/key=([^&]{4})[^&]+/i, "key=$1****");
}

function buildWecomNotificationPayload(input = {}) {
  const now = new Date().toISOString();
  const robots = (input.robots || [])
    .map((robot) => ({
      id: String(robot.id || wecomId("robot")),
      name: String(robot.name || "").trim(),
      webhookUrl: String(robot.webhookUrl || "").trim(),
      enabled: robot.enabled !== false,
      createdAt: robot.createdAt || now,
      updatedAt: robot.updatedAt || robot.createdAt || now,
      lastSentAt: robot.lastSentAt || "",
      lastError: robot.lastError || "",
    }))
    .filter((robot) => robot.name && robot.webhookUrl);
  const schedules = (input.schedules || [])
    .map((schedule) => ({
      id: String(schedule.id || wecomId("schedule")),
      name: String(schedule.name || "").trim(),
      robotIds: Array.isArray(schedule.robotIds) ? schedule.robotIds.map(String).filter(Boolean) : [],
      enabled: schedule.enabled !== false,
      mode: schedule.mode === "interval" ? "interval" : "daily",
      time: String(schedule.time || "09:00").trim(),
      intervalMinutes: Math.max(5, Math.min(1440, Number(schedule.intervalMinutes) || 60)),
      text: String(schedule.text || "").trim(),
      linkUrl: String(schedule.linkUrl || "").trim(),
      linkText: String(schedule.linkText || "查看详情").trim(),
      createdAt: schedule.createdAt || now,
      updatedAt: schedule.updatedAt || schedule.createdAt || now,
      lastSentAt: schedule.lastSentAt || "",
      lastRunKey: schedule.lastRunKey || "",
      lastError: schedule.lastError || "",
    }))
    .filter((schedule) => schedule.name && schedule.robotIds.length && schedule.text);
  const scenes = {
    stockupRecommendation: {
      enabled: input.scenes?.stockupRecommendation?.enabled !== false,
      robotIds: Array.isArray(input.scenes?.stockupRecommendation?.robotIds) ? input.scenes.stockupRecommendation.robotIds.map(String).filter(Boolean) : [],
      linkUrl: String(input.scenes?.stockupRecommendation?.linkUrl || "").trim(),
      extraText: String(input.scenes?.stockupRecommendation?.extraText || "").trim(),
      lastSignature: input.scenes?.stockupRecommendation?.lastSignature || "",
      lastItemKeys: Array.isArray(input.scenes?.stockupRecommendation?.lastItemKeys) ? input.scenes.stockupRecommendation.lastItemKeys.map(String).filter(Boolean) : [],
      lastSentAt: input.scenes?.stockupRecommendation?.lastSentAt || "",
    },
    inventorySnapshot: {
      enabled: Boolean(input.scenes?.inventorySnapshot?.enabled),
      robotIds: Array.isArray(input.scenes?.inventorySnapshot?.robotIds) ? input.scenes.inventorySnapshot.robotIds.map(String).filter(Boolean) : [],
      linkUrl: String(input.scenes?.inventorySnapshot?.linkUrl || "").trim(),
      extraText: String(input.scenes?.inventorySnapshot?.extraText || "").trim(),
      lastSignature: input.scenes?.inventorySnapshot?.lastSignature || "",
      lastSentAt: input.scenes?.inventorySnapshot?.lastSentAt || "",
    },
    qualificationExpiry: {
      enabled: Boolean(input.scenes?.qualificationExpiry?.enabled),
      robotIds: Array.isArray(input.scenes?.qualificationExpiry?.robotIds) ? input.scenes.qualificationExpiry.robotIds.map(String).filter(Boolean) : [],
      linkUrl: String(input.scenes?.qualificationExpiry?.linkUrl || "").trim(),
      extraText: String(input.scenes?.qualificationExpiry?.extraText || "").trim(),
      lastSignature: input.scenes?.qualificationExpiry?.lastSignature || "",
      lastSentAt: input.scenes?.qualificationExpiry?.lastSentAt || "",
    },
  };
  return { ok: true, source: "local", updatedAt: input.updatedAt || now, robots, schedules, scenes };
}

function publicWecomNotificationPayload() {
  const payload = buildWecomNotificationPayload(cachedWecomNotifications);
  return {
    ...payload,
    robots: payload.robots.map(({ webhookUrl, ...robot }) => ({ ...robot, webhookMasked: maskWebhook(webhookUrl) })),
  };
}

function notificationLinkLine(linkUrl, linkText = "查看详情") {
  const url = String(linkUrl || "").trim();
  if (!url) return "";
  return `\n[${String(linkText || "查看详情").trim()}](${url})`;
}

async function sendWecomRobot(robot, content) {
  if (!robot?.enabled) return { robotId: robot?.id, ok: false, skipped: true, message: "机器人已停用" };
  const response = await fetch(robot.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      msgtype: "markdown",
      markdown: { content: String(content || "").slice(0, 4000) },
    }),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok || Number(data.errcode || 0) !== 0) {
    throw new Error(data.errmsg || data.message || text || `企业微信机器人推送失败 ${response.status}`);
  }
  return { robotId: robot.id, ok: true };
}

async function sendWecomNotification(robotIds, content) {
  const ids = new Set((robotIds || []).map(String).filter(Boolean));
  const robots = (cachedWecomNotifications.robots || []).filter((robot) => ids.has(robot.id) && robot.enabled);
  const results = [];
  for (const robot of robots) {
    try {
      const result = await sendWecomRobot(robot, content);
      robot.lastSentAt = new Date().toISOString();
      robot.lastError = "";
      results.push(result);
    } catch (error) {
      robot.lastError = error.message || "推送失败";
      results.push({ robotId: robot.id, ok: false, message: robot.lastError });
    }
  }
  cachedWecomNotifications.updatedAt = new Date().toISOString();
  saveWecomNotificationCache();
  return results;
}

function stockupSignature(payload) {
  const items = (payload.recommendations || []).map((item) => `${item.sku}:${item.replenishQty}:${item.netReplenishQty}`).sort();
  return items.join("|");
}

async function notifyStockupRecommendationLegacy(payload, reason = "refresh") {
  const scene = cachedWecomNotifications.scenes?.stockupRecommendation;
  if (!scene?.enabled || !scene.robotIds?.length) return;
  const signature = stockupSignature(payload);
  if (!signature || scene.lastSignature === signature) return;
  scene.lastSignature = signature;
  scene.lastSentAt = new Date().toISOString();
  const topItems = (payload.recommendations || []).slice(0, 8).map((item, index) => `${index + 1}. ${item.sku} ${item.name || ""}：建议 ${item.replenishQty}${item.unit || ""}，净建议 ${item.netReplenishQty}${item.unit || ""}`).join("\n");
  const content = [
    "### 备货建议提醒",
    `发现 ${payload.counts?.recommendations || 0} 个 SKU 需要关注备货，净建议备货 ${payload.counts?.netRecommendedQty || 0} 件。`,
    scene.extraText,
    topItems,
    notificationLinkLine(scene.linkUrl, "查看备货中心"),
  ].filter(Boolean).join("\n\n");
  await sendWecomNotification(scene.robotIds, content);
}

function stockupMarkdownItem(item, index) {
  const daysCover = item.daysCover === null || item.daysCover === undefined ? "∞" : `${numberOrZero(item.daysCover).toFixed(1)} 天`;
  return [
    `**${index + 1}. ${item.sku || item.countrySku || item.id}｜${item.name || "未命名产品"}**`,
    `> 国家：${item.country || "-"}｜状态：${item.status || "-"}`,
    `> 动销：7天 ${numberOrZero(item.sales7)} / 30天 ${numberOrZero(item.sales30)} / 90天 ${numberOrZero(item.sales90)}，30天日均 ${numberOrZero(item.avgDaily30).toFixed(2)}`,
    `> 库存：可售 ${numberOrZero(item.availableQty)}，在途 ${numberOrZero(item.inTransitQty)}，预估可售 ${daysCover}`,
    `> 建议备货：${numberOrZero(item.replenishQty)}${item.unit || ""}，净建议 ${numberOrZero(item.netReplenishQty)}${item.unit || ""}`,
  ].join("\n");
}

async function notifyStockupRecommendation(payload, reason = "refresh") {
  const scene = cachedWecomNotifications.scenes?.stockupRecommendation;
  if (!scene?.enabled) return;
  const robotIds = scene.robotIds?.length ? scene.robotIds : (cachedWecomNotifications.robots || []).filter((robot) => robot.enabled).map((robot) => robot.id);
  if (!robotIds.length) return;
  const signature = stockupSignature(payload);
  if (!signature || scene.lastSignature === signature) return;
  const currentKeys = (payload.recommendations || []).map((item) => item.recommendationKey || stockupRecommendationKey(item)).filter(Boolean);
  const previousKeys = new Set(scene.lastItemKeys || []);
  const newItems = (payload.recommendations || []).filter((item) => !previousKeys.has(item.recommendationKey || stockupRecommendationKey(item)));
  scene.lastSignature = signature;
  scene.lastItemKeys = currentKeys;
  scene.lastSentAt = new Date().toISOString();
  if (!newItems.length && previousKeys.size) {
    saveWecomNotificationCache();
    return;
  }
  const visibleItems = (newItems.length ? newItems : payload.recommendations || []).slice(0, 8);
  const content = [
    "### 备货建议提醒",
    `新增 ${newItems.length || visibleItems.length} 个 SKU 需要关注备货，当前净建议备货 ${payload.counts?.netRecommendedQty || 0} 件。`,
    scene.extraText,
    visibleItems.map(stockupMarkdownItem).join("\n\n"),
    notificationLinkLine(scene.linkUrl, "查看备货中心"),
  ].filter(Boolean).join("\n\n");
  await sendWecomNotification(robotIds, content);
}

async function notifyInventorySnapshot(snapshot) {
  const scene = cachedWecomNotifications.scenes?.inventorySnapshot;
  if (!scene?.enabled || !scene.robotIds?.length || !snapshot) return;
  const signature = `${snapshot.date}:${snapshot.capturedAt}:${snapshot.rowCount}`;
  if (scene.lastSignature === signature) return;
  scene.lastSignature = signature;
  scene.lastSentAt = new Date().toISOString();
  const content = [
    "### 库存快照提醒",
    `库存快照已生成：${snapshot.date}`,
    `仓库 ${snapshot.warehouseCount || 0} 个，SKU ${snapshot.skuCount || 0} 个，可售库存 ${snapshot.totals?.availableQty || 0}，总库存 ${snapshot.totals?.totalQty || 0}。`,
    scene.extraText,
    notificationLinkLine(scene.linkUrl, "查看库存快照"),
  ].filter(Boolean).join("\n\n");
  await sendWecomNotification(scene.robotIds, content);
}

function qualificationExpiryRows(payload, thresholdDays = 30) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  return (payload?.qualifications || [])
    .map((item) => {
      const time = item.expiryDate ? new Date(item.expiryDate).getTime() : NaN;
      if (!Number.isFinite(time)) return null;
      const daysLeft = Math.ceil((time - now) / dayMs);
      if (daysLeft > thresholdDays) return null;
      return {
        ...item,
        daysLeft,
        urgency: daysLeft < 0 ? "expired" : "expiring",
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

function qualificationExpirySignature(rows) {
  return rows.map((item) => `${item.id}:${item.expiryDate}:${item.daysLeft < 0 ? "expired" : "expiring"}`).join("|");
}

function qualificationExpiryMarkdownItem(item, index) {
  const status = item.daysLeft < 0 ? `已过期 ${Math.abs(item.daysLeft)} 天` : `${item.daysLeft} 天后到期`;
  return [
    `**${index + 1}. ${item.sku || "-"}｜${item.qualificationName || item.productName || "未命名资质"}**`,
    `> 市场：${item.market || "-"}｜类别：${item.qualificationCategory || "-"}`,
    `> 到期日：${item.expiryDate ? item.expiryDate.slice(0, 10) : "-"}｜状态：${status}`,
  ].join("\n");
}

async function notifyQualificationExpiry(payload, reason = "refresh") {
  const scene = cachedWecomNotifications.scenes?.qualificationExpiry;
  if (!scene?.enabled) return;
  const robotIds = scene.robotIds?.length ? scene.robotIds : (cachedWecomNotifications.robots || []).filter((robot) => robot.enabled).map((robot) => robot.id);
  if (!robotIds.length) return;
  const rows = qualificationExpiryRows(payload, 30);
  if (!rows.length) return;
  const signature = qualificationExpirySignature(rows);
  if (!signature || scene.lastSignature === signature) return;
  scene.lastSignature = signature;
  scene.lastSentAt = new Date().toISOString();
  const expiredCount = rows.filter((item) => item.daysLeft < 0).length;
  const expiringCount = rows.length - expiredCount;
  const content = [
    "### 资质过期提醒",
    `发现 ${expiredCount} 条已过期资质、${expiringCount} 条 30 天内到期资质。`,
    scene.extraText,
    rows.slice(0, 10).map(qualificationExpiryMarkdownItem).join("\n\n"),
    notificationLinkLine(scene.linkUrl, "查看资质库"),
  ].filter(Boolean).join("\n\n");
  await sendWecomNotification(robotIds, content);
}

function wecomNumber(value) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(numberOrZero(value));
}

function wecomDateTime(value) {
  if (!value) return "未同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: inventorySnapshotTimezone,
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function buildOperatingSummaryMarkdown(options = {}) {
  const summary = buildDashboardSummary(directAuth);
  const stockup = buildCurrentStockupPayload({ notify: false, reason: "operating_summary" });
  const counts = summary.counts || {};
  const stockupCounts = stockup.counts || {};
  const failedWarehouses = summary.sync?.failedWarehouses || [];
  const diagnosticIssues = (summary.movementDiagnostics || []).filter((item) => !item.ok || item.failed || item.running);
  const acceptedWithoutPlan = Math.max(0, numberOrZero(stockupCounts.acceptedRecommendations) - numberOrZero(stockupCounts.openStockupPlans));
  const actionLines = [
    failedWarehouses.length ? `- 订单同步失败：${wecomNumber(failedWarehouses.length)} 个仓库，请先查看动销监控的同步任务。` : "",
    diagnosticIssues.length ? `- 动销诊断异常：${wecomNumber(diagnosticIssues.length)} 个仓库需要核对订单、库存或 SKU 匹配。` : "",
    numberOrZero(stockupCounts.recommendations) ? `- 备货建议：${wecomNumber(stockupCounts.recommendations)} 个 SKU，净建议 ${wecomNumber(stockupCounts.netRecommendedQty)}。` : "",
    acceptedWithoutPlan ? `- 已采纳待建计划：${wecomNumber(acceptedWithoutPlan)} 条，需要补齐采购/委外计划。` : "",
    numberOrZero(counts.warehouseOnlySku) ? `- 仓库未建档 SKU：${wecomNumber(counts.warehouseOnlySku)} 个，请在 SKU 治理入口补档。` : "",
  ].filter(Boolean);
  return [
    "### 同舟今日经营摘要",
    `生成时间：${wecomDateTime(new Date().toISOString())}`,
    String(options.extraText || "").trim(),
    [
      "**核心指标**",
      `- 可售库存：${wecomNumber(counts.totalInventory)}`,
      `- 今日出库订单：${wecomNumber(counts.todayOrders)}`,
      `- 90 天出库明细：${wecomNumber(counts.orderCount90)}，销售金额 ${wecomNumber(counts.salesAmount90)}`,
      `- 动销风险 SKU：${wecomNumber(counts.riskSku)}（缺货 ${wecomNumber(counts.stockout)} / 补货 ${wecomNumber(counts.replenish)} / 慢销 ${wecomNumber(counts.slow)} / 滞销 ${wecomNumber(counts.stagnant)}）`,
    ].join("\n"),
    [
      "**备货与库存**",
      `- 当前备货建议：${wecomNumber(stockupCounts.recommendations)} 个 SKU，净建议 ${wecomNumber(stockupCounts.netRecommendedQty)}`,
      `- 未完成备货计划：${wecomNumber(stockupCounts.openStockupPlans)} 个，计划数量 ${wecomNumber(stockupCounts.plannedQty)}`,
      `- WMS 待入库：${wecomNumber(stockupCounts.inboundOrders)} 单，待入库数量 ${wecomNumber(stockupCounts.pendingInboundQty)}`,
      `- 仓库有库存但产品未建档：${wecomNumber(counts.warehouseOnlySku)} 个 SKU`,
    ].join("\n"),
    [
      "**同步状态**",
      `- 产品目录：${wecomDateTime(summary.sync?.productsSyncedAt)}`,
      `- 仓库库存：${wecomDateTime(summary.sync?.inventorySyncedAt)}`,
      `- 出库订单：${wecomDateTime(summary.sync?.orderSyncedAt)}`,
    ].join("\n"),
    ["**需要处理**", ...(actionLines.length ? actionLines : ["- 暂无阻断项，建议继续巡检备货建议和同步健康度。"])].join("\n"),
    notificationLinkLine(options.linkUrl || "#dashboard", options.linkText || "查看经营总览"),
  ].filter(Boolean).join("\n\n");
}

function scheduleRunKey(schedule, now = new Date()) {
  const date = dateKeyInTimezone(now);
  const minute = minutesInTimezone(now);
  if (schedule.mode === "interval") {
    return `${date}-${Math.floor(minute / Math.max(5, Number(schedule.intervalMinutes) || 60))}`;
  }
  return `${date}-${schedule.time || "09:00"}`;
}

function shouldRunSchedule(schedule, now = new Date()) {
  if (!schedule.enabled) return false;
  const minute = minutesInTimezone(now);
  if (schedule.mode === "interval") return schedule.lastRunKey !== scheduleRunKey(schedule, now);
  const [hourText, minuteText] = String(schedule.time || "09:00").split(":");
  const target = (Number(hourText) || 0) * 60 + (Number(minuteText) || 0);
  return minute >= target && minute < target + 2 && schedule.lastRunKey !== scheduleRunKey(schedule, now);
}

async function runWecomSchedules() {
  if (wecomScheduleRunning) return;
  wecomScheduleRunning = true;
  try {
    const schedules = cachedWecomNotifications.schedules || [];
    for (const schedule of schedules) {
      if (!shouldRunSchedule(schedule)) continue;
      schedule.lastRunKey = scheduleRunKey(schedule);
      schedule.lastSentAt = new Date().toISOString();
      const content = [
        `### ${schedule.name}`,
        schedule.text,
        notificationLinkLine(schedule.linkUrl, schedule.linkText),
      ].filter(Boolean).join("\n\n");
      const results = await sendWecomNotification(schedule.robotIds, content);
      const failed = results.filter((item) => !item.ok);
      schedule.lastError = failed.length ? failed.map((item) => item.message).filter(Boolean).join("; ") : "";
    }
    cachedWecomNotifications.updatedAt = new Date().toISOString();
    saveWecomNotificationCache();
  } finally {
    wecomScheduleRunning = false;
  }
}

function buildQuickNavPayload(categories) {
  const normalizedCategories = (categories || [])
    .map((category) => ({
      id: String(category.id || quickNavId("cat")),
      name: String(category.name || "").trim(),
      description: String(category.description || "").trim(),
      sortOrder: numberOrZero(category.sortOrder),
      createdAt: category.createdAt || new Date().toISOString(),
      updatedAt: category.updatedAt || category.createdAt || new Date().toISOString(),
      links: (category.links || [])
        .map((link) => ({
          id: String(link.id || quickNavId("link")),
          categoryId: String(link.categoryId || category.id || ""),
          title: String(link.title || "").trim(),
          url: String(link.url || "").trim(),
          description: String(link.description || "").trim(),
          sortOrder: numberOrZero(link.sortOrder),
          createdAt: link.createdAt || new Date().toISOString(),
          updatedAt: link.updatedAt || link.createdAt || new Date().toISOString(),
        }))
        .filter((link) => link.title && link.url)
        .sort((left, right) => left.sortOrder - right.sortOrder || left.title.localeCompare(right.title, "zh-CN")),
    }))
    .filter((category) => category.name)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-CN"));

  return {
    ok: true,
    source: "local",
    updatedAt: new Date().toISOString(),
    counts: {
      categories: normalizedCategories.length,
      links: normalizedCategories.reduce((sum, category) => sum + category.links.length, 0),
    },
    categories: normalizedCategories,
  };
}

function normalizeQuickNavUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(withProtocol);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("快捷方式仅支持 http 或 https 链接。");
  return parsed.toString();
}

function buildAiConfig(input) {
  return {
    ok: true,
    source: "local",
    updatedAt: input.updatedAt || "",
    provider: "agnes",
    baseUrl: String(input.baseUrl || process.env.AGNES_AI_BASE_URL || "https://apihub.agnes-ai.com/v1").replace(/\/$/, ""),
    apiKey: String(input.apiKey || process.env.AGNES_AI_API_KEY || ""),
    models: {
      text: String(input.models?.text || process.env.AGNES_TEXT_MODEL || "agnes-2.0-flash"),
      image: String(input.models?.image || process.env.AGNES_IMAGE_MODEL || "agnes-image-2.1-flash"),
      video: String(input.models?.video || process.env.AGNES_VIDEO_MODEL || "agnes-video-v2.0"),
    },
  };
}

function saveAiConfigCache() {
  cachedAiConfig = buildAiConfig({ ...cachedAiConfig, updatedAt: new Date().toISOString() });
  saveJsonCache(aiConfigCachePath, cachedAiConfig);
}

function maskedSecret(value) {
  const secret = String(value || "");
  if (!secret) return "";
  if (secret.length <= 8) return `${secret.slice(0, 2)}****`;
  return `${secret.slice(0, 4)}****${secret.slice(-4)}`;
}

function publicAiConfigPayload() {
  return {
    ok: true,
    provider: cachedAiConfig.provider,
    baseUrl: cachedAiConfig.baseUrl,
    updatedAt: cachedAiConfig.updatedAt || "",
    configured: Boolean(cachedAiConfig.apiKey),
    apiKeyMasked: maskedSecret(cachedAiConfig.apiKey),
    models: cachedAiConfig.models,
  };
}

async function requestAgnes(path, payload, options = {}) {
  if (!cachedAiConfig.apiKey) {
    throw new Error("同舟AI 尚未配置 API Key。");
  }

  const response = await fetch(`${cachedAiConfig.baseUrl}${path}`, {
    method: options.method || "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cachedAiConfig.apiKey}`,
    },
    body: options.method === "GET" ? undefined : JSON.stringify(payload || {}),
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : { text: await response.text() };
  if (!response.ok) {
    const message = data?.error?.message || data?.message || data?.text || "同舟AI 请求失败。";
    throw new Error(message);
  }
  return data;
}

async function requestAgnesStream(path, payload) {
  if (!cachedAiConfig.apiKey) {
    throw new Error("同舟AI 尚未配置 API Key。");
  }

  const response = await fetch(`${cachedAiConfig.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cachedAiConfig.apiKey}`,
    },
    body: JSON.stringify(payload || {}),
  });
  if (!response.ok) {
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await response.json() : { text: await response.text() };
    const message = data?.error?.message || data?.message || data?.text || "同舟AI 请求失败。";
    throw new Error(message);
  }
  return response;
}

function extractStreamDelta(data) {
  return data?.choices?.[0]?.delta?.content
    || data?.choices?.[0]?.message?.content
    || data?.choices?.[0]?.text
    || data?.delta
    || data?.content
    || "";
}

function sendSse(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function extractTextAnswer(data) {
  return data?.choices?.[0]?.message?.content
    || data?.choices?.[0]?.text
    || data?.data?.choices?.[0]?.message?.content
    || data?.output_text
    || data?.text
    || "";
}

function extractImageUrls(data) {
  const results = [];
  const visit = (value, key = "") => {
    if (!value) return;
    if (typeof value === "string") {
      const text = value.trim();
      if (/^https?:\/\//i.test(text) || text.startsWith("data:image/") || key === "b64_json" || /^[A-Za-z0-9+/=]{200,}$/.test(text)) {
        results.push(text);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, key));
      return;
    }
    if (typeof value !== "object") return;
    for (const [itemKey, itemValue] of Object.entries(value)) {
      if (["url", "image_url", "b64_json"].includes(itemKey)) {
        visit(itemValue, itemKey);
      } else if (["data", "images", "output", "result", "content"].includes(itemKey)) {
        visit(itemValue, itemKey);
      }
    }
  };
  visit(data);
  return [...new Set(results)];
}

function extractVideoTask(data) {
  return data?.task_id || data?.id || data?.data?.task_id || data?.data?.id || "";
}

function extractVideoUrl(data) {
  const candidates = [];
  const strongKeys = new Set([
    "video_url",
    "videoUrl",
    "video",
    "download_url",
    "downloadUrl",
    "file_url",
    "fileUrl",
    "output_url",
    "outputUrl",
    "result_url",
    "resultUrl",
    "media_url",
    "mediaUrl",
    "source_url",
    "sourceUrl",
  ]);
  const containerKeys = new Set(["data", "output", "outputs", "result", "results", "content", "video", "file", "media", "asset"]);
  const isVideoLikeUrl = (text, key) => {
    if (!/^https?:\/\//i.test(text) && !text.startsWith("/")) return false;
    if (/\.(png|jpe?g|webp|gif|svg)(\?|#|$)/i.test(text)) return false;
    return strongKeys.has(key) || /video|download|file|media|result|output/i.test(key) || /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(text);
  };
  const visit = (value, key = "") => {
    if (!value) return;
    if (typeof value === "string") {
      const text = value.trim();
      if (isVideoLikeUrl(text, key)) candidates.push(text);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, key));
      return;
    }
    if (typeof value !== "object") return;
    for (const [itemKey, itemValue] of Object.entries(value)) {
      if (strongKeys.has(itemKey) || containerKeys.has(itemKey) || /video|download|file|media|result|output/i.test(itemKey)) {
        visit(itemValue, itemKey);
      }
    }
  };
  visit(data);
  return candidates[0] || "";
}

function extractVideoStatus(data) {
  return data?.status
    || data?.data?.status
    || data?.result?.status
    || data?.output?.status
    || data?.state
    || data?.data?.state
    || "";
}

function aiUploadDataUrlFromUrl(value) {
  const text = String(value || "").trim();
  const match = text.match(/\/api\/ai\/uploads\/([^/?#]+)/);
  if (!match) return text;
  const fileName = decodeURIComponent(match[1]);
  if (!/^[a-z0-9-]+\.(png|jpg|jpeg|webp|gif)$/i.test(fileName)) return text;
  const filePath = resolve(aiUploadDir, fileName);
  if (!existsSync(filePath)) return text;
  const mimeType = mimeFromExtension(fileName);
  return `data:${mimeType};base64,${readFileSync(filePath).toString("base64")}`;
}

function normalizeAiReferenceImages(values) {
  return (Array.isArray(values) ? values : [values])
    .map((value) => aiUploadDataUrlFromUrl(value))
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function aiImageReferencePayload(referenceImages) {
  const refs = normalizeAiReferenceImages(referenceImages);
  if (!refs.length) return {};
  return {
    image_url: refs[0],
    image_urls: refs,
    image: refs[0],
    images: refs,
    reference_image: refs[0],
    reference_images: refs,
    input_image: refs[0],
    input_images: refs,
  };
}

function aiReferencedProductPrompt(prompt, referenceCount = 0) {
  if (!referenceCount) return prompt;
  return [
    prompt,
    "",
    "Use the uploaded reference image as the exact product source image.",
    "The generated image must keep the reference product's package shape, label layout, colors, logo/text placement, and visible product identity as close as possible.",
    "Do not replace it with a generic bottle, box, or different package. Only change the surrounding scene, person, pose, lighting, and background needed by the prompt.",
  ].join("\n");
}

function aiImageEditPayload(payload, model, prompt, referenceImages) {
  return {
    model,
    prompt,
    size: payload.size || "1024x1024",
    n: 1,
    quality: payload.quality,
    seed: Number.isFinite(Number(payload.seed)) ? Number(payload.seed) : undefined,
    negative_prompt: payload.negativePrompt,
    ...aiImageReferencePayload(referenceImages),
  };
}

function videoMimeFromExtension(fileName) {
  const ext = extname(fileName).toLowerCase();
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".m4v") return "video/x-m4v";
  return "video/mp4";
}

function videoExtensionFromUrl(value) {
  try {
    const ext = extname(new URL(value).pathname).toLowerCase();
    if ([".mp4", ".webm", ".mov", ".m4v"].includes(ext)) return ext;
  } catch {
    // Fall back to mp4 for signed URLs or provider URLs without an extension.
  }
  return ".mp4";
}

async function cacheAiVideoUrl(remoteUrl) {
  const videoUrl = String(remoteUrl || "").trim();
  if (!/^https?:\/\//i.test(videoUrl)) return videoUrl;
  const id = createHash("sha256").update(videoUrl).digest("hex").slice(0, 24);
  const fileName = `${id}${videoExtensionFromUrl(videoUrl)}`;
  const filePath = resolve(aiVideoPublicDir, fileName);
  if (!existsSync(filePath)) {
    const response = await fetch(videoUrl, {
      headers: cachedAiConfig.apiKey ? { Authorization: `Bearer ${cachedAiConfig.apiKey}` } : {},
    });
    if (!response.ok) throw new Error(`AI video download failed: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) throw new Error("AI video download was empty.");
    mkdirSync(aiVideoPublicDir, { recursive: true });
    writeFileSync(filePath, bytes);
  }
  return `/api/ai/videos/${encodeURIComponent(fileName)}`;
}

function compactPayload(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => {
      if (value === undefined || value === null || value === "") return false;
      if (Array.isArray(value)) return value.filter(Boolean).length > 0;
      return true;
    }),
  );
}

async function requestAgnesWithUnsupportedParamRetry(path, payload) {
  let nextPayload = compactPayload(payload);
  const dropped = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const data = await requestAgnes(path, nextPayload);
      return { data, dropped };
    } catch (error) {
      const message = error.message || "";
      const match = message.match(/Setting [`'"]([^`'"]+)[`'"] is not supported/i)
        || message.match(/[`'"]([^`'"]+)[`'"].*not supported/i);
      const param = match?.[1];
      if (!param || !(param in nextPayload)) throw error;
      dropped.push(param);
      const { [param]: _ignored, ...rest } = nextPayload;
      nextPayload = rest;
    }
  }
  const data = await requestAgnes(path, nextPayload);
  return { data, dropped };
}

async function requestAgnesVideoStatus(taskId) {
  const encodedTaskId = encodeURIComponent(taskId);
  const paths = [
    `/videos/${encodedTaskId}`,
    `/videos/${encodedTaskId}/result`,
    `/videos/${encodedTaskId}/results`,
    `/videos/${encodedTaskId}/download`,
    `/tasks/${encodedTaskId}`,
  ];
  let lastData = null;
  const errors = [];
  for (const path of paths) {
    try {
      const data = await requestAgnes(path, null, { method: "GET" });
      lastData = data;
      if (extractVideoUrl(data)) return { data, path, errors };
      const status = String(extractVideoStatus(data)).toLowerCase();
      if (status && !["completed", "complete", "succeeded", "success", "done"].includes(status)) {
        return { data, path, errors };
      }
    } catch (error) {
      errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (lastData) return { data: lastData, path: paths[paths.length - 1], errors };
  throw new Error(errors[0] || "视频状态查询失败。");
}

function truncateText(value, maxLength = 180) {
  const text = String(value || "").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function aiUserQueryFromPayload(payload) {
  const prompt = String(payload.prompt || "").trim();
  const payloadMessages = Array.isArray(payload.messages) ? payload.messages : [];
  const lastUser = [...payloadMessages].reverse().find((message) => message?.role === "user")?.content || "";
  return String(lastUser || prompt || "").trim();
}

function aiMessageContentFromPayloadMessage(message) {
  const text = String(message?.content || "").trim();
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  const images = attachments
    .map((attachment) => String(attachment?.url || "").trim())
    .filter(Boolean);
  if (!images.length) return text;
  return [
    { type: "text", text: text || "请分析这张图片。" },
    ...images.map((url) => ({ type: "image_url", image_url: { url } })),
  ];
}

function aiContentToText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part?.type === "text" ? String(part.text || "").trim() : ""))
    .filter(Boolean)
    .join("\n");
}

function scoreContextItem(query, values) {
  const normalizedQuery = String(query || "").toLowerCase();
  if (!normalizedQuery) return 1;
  let score = 0;
  for (const value of values) {
    const text = String(value || "").toLowerCase();
    if (!text) continue;
    if (normalizedQuery.includes(text) || text.includes(normalizedQuery)) score += 6;
    for (const token of normalizedQuery.split(/[\s,，。；;:：/\\|]+/).filter(Boolean)) {
      if (token.length >= 2 && text.includes(token)) score += 2;
    }
  }
  return score;
}

function aiProductContext(auth, payload) {
  if (!canViewPartnerAssets(auth)) return "";
  const query = aiUserQueryFromPayload(payload);
  const catalogBySku = new Map();
  for (const item of cachedProducts.catalog || []) {
    const key = String(item.sku || item.skuNo || "").toLowerCase();
    if (!key) continue;
    if (!catalogBySku.has(key)) catalogBySku.set(key, []);
    catalogBySku.get(key).push(item);
  }

  const baseProducts = (cachedProducts.productBase || [])
    .map((product) => {
      const catalogItems = catalogBySku.get(String(product.sku || product.skuNo || "").toLowerCase()) || [];
      const countries = [...new Set(catalogItems.map((item) => item.country).filter(Boolean))].slice(0, 8);
      return {
        product,
        countries,
        score: scoreContextItem(query, [product.sku, product.skuNo, product.name, product.nameEn, product.category, product.brand, product.sellingPoints, product.publicDescription, ...countries]),
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, /产品|sku|有哪些|列举|清单|全部|越南|马来|印尼|俄罗斯/i.test(query) ? 60 : 20)
    .map(({ product, countries }, index) => {
      const size = [product.length, product.width, product.height].filter(Boolean).join(" x ");
      return `${index + 1}. SKU:${product.sku || product.skuNo || "未配置"}；中文名:${product.name || "未配置"}；英文名:${product.nameEn || "未配置"}；国家/地区:${countries.join("/") || "未配置"}；品牌:${product.brand || "未配置"}；分类:${product.category || "未分类"}；规格:${product.specification || "未配置"}；重量:${product.weight || "未配置"}；尺寸:${size || "未配置"}；公开文案:${truncateText(product.publicDescription, 160) || "未配置"}；卖点:${truncateText(product.sellingPoints, 180) || "未配置"}`;
    });

  const warehouseInfo = (cachedWarehouseInfo.warehouseInfo || [])
    .map((warehouse) => ({
      warehouse,
      score: scoreContextItem(query, [warehouse.warehouseName, warehouse.countryRegion, warehouse.warehouseCode, warehouse.shopShippingAddress, warehouse.firstMileReceivingAddress, warehouse.remark]),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, /仓库|地址|时区|上班|下班|发货|退货|头程|营业/i.test(query) ? 30 : 10)
    .map(({ warehouse }, index) => `${index + 1}. 仓库:${warehouse.warehouseName || "未配置"}；国家/地区:${warehouse.countryRegion || "未配置"}；代码:${warehouse.warehouseCode || "未配置"}；发货地址:${truncateText(warehouse.shopShippingAddress, 140) || "未配置"}；退货地址:${truncateText(warehouse.shopReturnAddress, 140) || "未配置"}；头程收货地址:${truncateText(warehouse.firstMileReceivingAddress, 140) || "未配置"}；时区:${warehouse.timezone || "未配置"}；营业时间:${[warehouse.workStartTime, warehouse.workEndTime].filter(Boolean).join(" - ") || "未配置"}；备注:${truncateText(warehouse.remark, 120) || "无"}`);

  return [
    "【同舟供应链可引用上下文】",
    "可用范围：产品基础信息、产品公开文案/卖点、规格重量尺寸、品牌分类、仓库地址/时区/营业时间。",
    "严格禁止：不要输出、推断或引用任何直营价、分销价、销售价、成本、利润、库存数量、供应商底价等价格/成本/库存敏感信息；如果用户询问这些内容，说明当前权限不支持提供。",
    `产品基础信息：\n${baseProducts.join("\n") || "暂无可引用产品基础信息。"}`,
    `仓库信息：\n${warehouseInfo.join("\n") || "暂无可引用仓库信息。"}`,
  ].join("\n");
}

function aiSystemPrompt(auth, payload) {
  const context = aiProductContext(auth, payload);
  return [
    "你是同舟供应链数智化系统中的AI助手，默认使用中文回答，回答要准确、简洁、可执行。",
    "你可以根据系统上下文回答产品信息、仓库信息，也可以基于产品资料撰写产品卖点、标题、详情页文案、短视频脚本和平台上架文案。",
    "如果用户要求列举、查询或总结产品/仓库，请直接使用下方上下文作答；不要先反问用户，除非上下文中确实没有相关信息。",
    context,
  ].filter(Boolean).join("\n\n");
}

function aiShouldDirectLookupAnswer(query) {
  const text = String(query || "").toLowerCase();
  if (!text) return false;
  if (/写|撰写|生成|改写|翻译|分析|总结|卖点|文案|标题|脚本|广告|详情页|营销|邮件|社媒|小红书|tiktok|shopee|lazada/i.test(text)) {
    return false;
  }
  return /产品|sku|仓库|地址|时区|上班|下班|营业|发货|退货|头程|有哪些|列举|查询|信息|资料|名单|清单/i.test(text);
}

function aiNumberLimitFromQuery(query, fallback = 8) {
  const text = String(query || "");
  const match = text.match(/(\d+)\s*(个|条|款|项)?/);
  if (!match) return fallback;
  return Math.max(1, Math.min(50, Number(match[1]) || fallback));
}

function aiProductRowsForQuery(query, limit) {
  const catalogBySku = new Map();
  for (const item of cachedProducts.catalog || []) {
    const key = String(item.sku || item.skuNo || "").toLowerCase();
    if (!key) continue;
    if (!catalogBySku.has(key)) catalogBySku.set(key, []);
    catalogBySku.get(key).push(item);
  }
  return (cachedProducts.productBase || [])
    .map((product) => {
      const catalogItems = catalogBySku.get(String(product.sku || product.skuNo || "").toLowerCase()) || [];
      const countries = [...new Set(catalogItems.map((item) => item.country).filter(Boolean))].slice(0, 6);
      return {
        product,
        countries,
        score: scoreContextItem(query, [product.sku, product.skuNo, product.name, product.nameEn, product.category, product.brand, product.sellingPoints, product.publicDescription, ...countries]),
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function aiDirectSafeContextAnswer(payload, auth = { role: "guest" }) {
  if (!canViewPartnerAssets(auth)) return "";
  const payloadMessages = Array.isArray(payload.messages) ? payload.messages : [];
  const lastUser = [...payloadMessages].reverse().find((message) => message?.role === "user");
  if (Array.isArray(lastUser?.attachments) && lastUser.attachments.length) return "";
  const query = aiUserQueryFromPayload(payload);
  if (!aiShouldDirectLookupAnswer(query)) return "";
  const limit = aiNumberLimitFromQuery(query, 8);
  const wantsWarehouse = /仓库|地址|时区|上班|下班|营业|发货|退货|头程/i.test(query);
  const wantsProduct = /产品|sku|商品|品名|名称|名单|清单/i.test(query) || !wantsWarehouse;

  const sections = [];
  if (wantsProduct) {
    const rows = aiProductRowsForQuery(query, limit);
    if (rows.length) {
      sections.push([
        `根据产品库安全上下文，找到 ${rows.length} 个相关产品：`,
        ...rows.map(({ product, countries }, index) => {
          const details = [
            `SKU：${product.sku || product.skuNo || "未配置"}`,
            `中文名称：${product.name || "未配置"}`,
            product.nameEn ? `英文名称：${product.nameEn}` : "",
            product.brand ? `品牌：${product.brand}` : "",
            product.category ? `分类：${product.category}` : "",
            product.specification ? `规格：${product.specification}` : "",
            countries.length ? `国家/地区：${countries.join("、")}` : "",
          ].filter(Boolean).join("；");
          return `${index + 1}. ${details}`;
        }),
      ].join("\n"));
    }
  }

  if (wantsWarehouse) {
    const rows = (cachedWarehouseInfo.warehouseInfo || [])
      .map((warehouse) => ({
        warehouse,
        score: scoreContextItem(query, [warehouse.warehouseName, warehouse.countryRegion, warehouse.warehouseCode, warehouse.shopShippingAddress, warehouse.shopReturnAddress, warehouse.firstMileReceivingAddress, warehouse.timezone, warehouse.remark]),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
    if (rows.length) {
      sections.push([
        `根据仓库信息，找到 ${rows.length} 个相关仓库：`,
        ...rows.map(({ warehouse }, index) => {
          const details = [
            `仓库：${warehouse.warehouseName || "未配置"}`,
            `国家/地区：${warehouse.countryRegion || "未配置"}`,
            warehouse.warehouseCode ? `代码：${warehouse.warehouseCode}` : "",
            warehouse.timezone ? `时区：${warehouse.timezone}` : "",
            warehouse.workStartTime || warehouse.workEndTime ? `营业时间：${[warehouse.workStartTime, warehouse.workEndTime].filter(Boolean).join(" - ")}` : "",
            warehouse.shopShippingAddress ? `发货地址：${truncateText(warehouse.shopShippingAddress, 160)}` : "",
          ].filter(Boolean).join("；");
          return `${index + 1}. ${details}`;
        }),
      ].join("\n"));
    }
  }

  if (!sections.length) return "";
  return `${sections.join("\n\n")}\n\n注：以上回答已自动排除价格、成本和库存数量等敏感字段。`;
}

function aiMessagesFromPayload(payload, auth = { role: "guest" }) {
  const prompt = String(payload.prompt || "").trim();
  const payloadMessages = Array.isArray(payload.messages) ? payload.messages : [];
  const systemPrompt = aiSystemPrompt(auth, payload);
  const inlineContext = aiProductContext(auth, payload);
  const contextInstruction = inlineContext
    ? `\n\n【系统已检索到的安全上下文】\n${inlineContext}\n\n【回答要求】请直接基于上面的检索结果回答本轮问题；如果用户要求列举产品或仓库，请直接列举名称/SKU/关键信息；如果用户要求写文案，请直接开始写；不要反问用户需要什么帮助；不要输出任何价格、成本、库存数量。`
    : "\n\n【回答要求】请直接回答本轮问题；不要输出任何价格、成本、库存数量。";
  const messages = payloadMessages
    .map((message) => {
      const role = ["system", "assistant", "user"].includes(message?.role) ? message.role : "user";
      const content = role === "user" ? aiMessageContentFromPayloadMessage(message) : String(message?.content || "").trim();
      return { role, content };
    })
    .filter((message) => aiContentToText(message.content) || Array.isArray(message.content));
  if (messages.length) {
    const lastUserIndex = messages.map((message) => message.role).lastIndexOf("user");
    const strengthenedMessages = messages.map((message, index) => (
      index === lastUserIndex
        ? {
            ...message,
            content: Array.isArray(message.content)
              ? [
                  { type: "text", text: `${aiContentToText(message.content)}${contextInstruction}` },
                  ...message.content.filter((part) => part?.type !== "text"),
                ]
              : `${message.content}${contextInstruction}`,
          }
        : message
    ));
    return messages.some((message) => message.role === "system")
      ? strengthenedMessages.map((message) => message.role === "system" ? { ...message, content: `${systemPrompt}\n\n${message.content}` } : message)
      : [{ role: "system", content: systemPrompt }, ...strengthenedMessages];
  }
  if (!prompt) return [];
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: `${prompt}${contextInstruction}` },
  ];
}

function aiChatPayload(payload, model, auth = { role: "guest" }) {
  return compactPayload({
    model,
    messages: aiMessagesFromPayload(payload, auth),
    temperature: Number.isFinite(Number(payload.temperature)) ? Number(payload.temperature) : 0.7,
    max_tokens: Number.isFinite(Number(payload.maxTokens)) ? Number(payload.maxTokens) : undefined,
    top_p: Number.isFinite(Number(payload.topP)) ? Number(payload.topP) : undefined,
    stream: Boolean(payload.stream),
  });
}

function mimeFromExtension(fileName) {
  const ext = extname(fileName).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

function saveAiUpload(payload, req) {
  const dataUrl = String(payload.dataUrl || "");
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/i);
  if (!match) throw new Error("请上传 PNG、JPG、WEBP 或 GIF 图片。");
  const mimeType = match[1].replace("image/jpg", "image/jpeg");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length) throw new Error("图片内容为空。");
  if (bytes.length > 8 * 1024 * 1024) throw new Error("单张图片不能超过 8MB。");

  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
  const id = `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  mkdirSync(aiUploadDir, { recursive: true });
  writeFileSync(resolve(aiUploadDir, id), bytes);
  const protocol = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return {
    id,
    url: `${protocol}://${host}/api/ai/uploads/${encodeURIComponent(id)}`,
    mimeType,
    size: bytes.length,
  };
}

function loadUsersCache() {
  const payload = loadJsonCache(usersCachePath);
  if (payload?.users?.length) return payload;
  return {
    ok: true,
    source: "local",
    syncedAt: "",
    users: [],
  };
}

function saveUsersCache() {
  saveJsonCache(usersCachePath, {
    ok: true,
    source: "local",
    syncedAt: new Date().toISOString(),
    users: cachedUsers.users,
  });
}

function userCounts(users) {
  return {
    users: users.length,
    direct: users.filter((user) => user.role === "direct").length,
    distributor: users.filter((user) => user.role === "distributor").length,
    active: users.filter((user) => user.status !== "disabled").length,
    disabled: users.filter((user) => user.status === "disabled").length,
  };
}

function publicUsersPayload() {
  const users = (cachedUsers.users || []).map(publicUser);
  return {
    ok: true,
    source: "local",
    syncedAt: cachedUsers.syncedAt || "",
    counts: userCounts(users),
    users,
  };
}

async function syncUserToJdy(user, plainPassword) {
  if (!hasJdyCredentials()) {
    throw new Error("未配置系统同步 API Key，用户已保存在本地，但未同步到同舟供应链数智化系统。");
  }
  const payload = await createJdyData(JIANYUN_FORMS.userAccounts, jdyUserRecordData(user, plainPassword));
  return payload?.data?._id || payload?.data_id || payload?._id || payload?.id || "";
}

async function syncUserStatusToJdy(user) {
  if (!hasJdyCredentials()) {
    throw new Error("未配置系统同步 API Key，用户状态已保存到本地，但未同步到同舟供应链数智化系统。");
  }
  if (!JIANYUN_FORMS.userAccounts.fields.status) {
    throw new Error("未配置用户状态同步字段，用户状态已保存到本地，但未同步到同舟供应链数智化系统。");
  }
  await updateJdyData(JIANYUN_FORMS.userAccounts, user.jdyDataId, jdyUserStatusData(user));
}

async function deleteUserFromJdy(user) {
  if (!hasJdyCredentials()) {
    throw new Error("未配置系统同步 API Key，用户已从本地删除，但未同步到同舟供应链数智化系统。");
  }
  await deleteJdyData(JIANYUN_FORMS.userAccounts, user.jdyDataId);
}

function activeDirectCount(users) {
  return users.filter((user) => user.role === "direct" && user.status !== "disabled").length;
}

function setupStatusPayload() {
  const users = cachedUsers.users || [];
  return {
    ok: true,
    setupRequired: activeDirectCount(users) === 0,
    counts: userCounts(users),
  };
}

function createInitialAdmin(payload = {}) {
  if (!setupStatusPayload().setupRequired) throw new Error("系统已存在直营管理员，初始化入口已关闭。");
  const password = String(payload.password || "");
  if (password.length < 8) throw new Error("首次管理员密码至少需要 8 位。");
  const user = createLocalUser({
    username: payload.username,
    password,
    displayName: payload.displayName || payload.username,
    role: "direct",
  });
  cachedUsers.users = [user, ...(cachedUsers.users || [])];
  cachedUsers.syncedAt = new Date().toISOString();
  saveUsersCache();
  appendActionLog({ role: "system", user: { id: "setup", username: "setup", displayName: "首次初始化", role: "direct", roleLabel: "系统初始化" } }, "首次初始化管理员", "user", user.displayName || user.username, {
    userId: user.id,
    username: user.username,
  });
  return user;
}

function sanitizeWarehouse(connection) {
  const hasCredentials = Boolean(
    connection.credentials?.appKey ||
      connection.credentials?.appSecret ||
      connection.credentials?.clientId ||
      connection.credentials?.clientSecret ||
      connection.credentials?.token,
  );
  const { credentials, ...safeConnection } = connection;
  return {
    ...safeConnection,
    status: hasCredentials ? "已授权" : safeConnection.status,
    hasCredentials,
  };
}

function hasWarehouseCredentials(connection) {
  return Boolean(
    connection.credentials?.appKey ||
      connection.credentials?.appSecret ||
      connection.credentials?.clientId ||
      connection.credentials?.clientSecret ||
      connection.credentials?.token,
  );
}

function normalizedConnectionBaseUrl(connection) {
  return String(connection.baseUrl || "").replace(/\/$/, "").toLowerCase();
}

function sameSystemCredentialFallback(connection) {
  const baseUrl = normalizedConnectionBaseUrl(connection);
  if (!baseUrl || connection.providerId !== "sea_wms") return null;
  return warehouseConnections.find((candidate) => (
    candidate.id !== connection.id &&
    candidate.providerId === connection.providerId &&
    normalizedConnectionBaseUrl(candidate) === baseUrl &&
    hasWarehouseCredentials(candidate)
  ));
}

async function syncWithSameSystemFallback(connection, syncer) {
  try {
    return await syncer(connection);
  } catch (error) {
    const fallback = sameSystemCredentialFallback(connection);
    if (!fallback || !/AppKey|Signature|签名|授权|credential/i.test(error.message || "")) throw error;
    const retriedConnection = {
      ...connection,
      credentials: fallback.credentials,
    };
    const result = await syncer(retriedConnection);
    return {
      ...result,
      message: result.message || `已复用同系统授权：${fallback.name}`,
      credentialFallbackFrom: fallback.id,
    };
  }
}

function withTimeout(promise, timeoutMs, message) {
  const ms = Number(timeoutMs);
  if (!Number.isFinite(ms) || ms < 1000) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(message || "请求超时");
      error.code = "SYNC_TIMEOUT";
      reject(error);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function updateResolvedWarehouseId(connection, result) {
  if (!result?.resolvedWarehouseId) return false;
  connection.resolvedWarehouseId = result.resolvedWarehouseId;
  if (connection.warehouseId === result.resolvedWarehouseId) return false;
  connection.warehouseId = result.resolvedWarehouseId;
  return true;
}

function providerName(providerId) {
  return WMS_PROVIDERS.find((provider) => provider.id === providerId)?.name || providerId;
}

function slugifyWarehouseId(name) {
  const base = String(name || "warehouse")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "warehouse"}-${Date.now().toString(36)}`;
}

function buildWarehouseConnection(payload, existingConnection = null) {
  const providerId = payload.providerId || existingConnection?.providerId || "sea_wms";
  const credentials = payload.credentials || {};
  return {
    ...(existingConnection || {}),
    id: existingConnection?.id || payload.id || slugifyWarehouseId(payload.name),
    name: payload.name || existingConnection?.name || "未命名仓库",
    country: payload.country || existingConnection?.country || "未配置国家",
    providerId,
    providerName: providerName(providerId),
    baseUrl: payload.baseUrl || existingConnection?.baseUrl || "待配置",
    warehouseCode: payload.warehouseCode || existingConnection?.warehouseCode || "",
    warehouseId: payload.warehouseId || payload.warehouseCode || existingConnection?.warehouseId || existingConnection?.warehouseCode || "",
    status: "已授权",
    lastSyncedAt: existingConnection?.lastSyncedAt || "",
    lastTestAt: existingConnection?.lastTestAt || "",
    lastTestStatus: existingConnection?.lastTestStatus || "",
    lastTestMessage: existingConnection?.lastTestMessage || "",
    resolvedWarehouseId: payload.resolvedWarehouseId || existingConnection?.resolvedWarehouseId || "",
    orderSyncStrategy: payload.orderSyncStrategy || existingConnection?.orderSyncStrategy || (providerId === "yunwms_ru" ? "date_chunk" : "cursor"),
    skuMatched: existingConnection?.skuMatched || 0,
    syncScope: payload.syncScope?.length ? payload.syncScope : existingConnection?.syncScope || ["库存同步", "订单出库日报", "动销监控"],
    credentials: {
      appKey: payload.appKey || credentials.appKey || existingConnection?.credentials?.appKey || "",
      appSecret: payload.appSecret || credentials.appSecret || existingConnection?.credentials?.appSecret || "",
      clientId: payload.clientId || credentials.clientId || existingConnection?.credentials?.clientId || "",
      clientSecret: payload.clientSecret || credentials.clientSecret || existingConnection?.credentials?.clientSecret || "",
      token: payload.token || payload.appToken || credentials.token || credentials.appToken || existingConnection?.credentials?.token || "",
    },
  };
}

function pruneWarehouseCaches(warehouseIds) {
  const ids = new Set(warehouseIds.filter(Boolean));
  if (!ids.size) return;
  cachedWarehouseSync = {
    ...cachedWarehouseSync,
    products: (cachedWarehouseSync.products || []).filter((item) => !ids.has(item.warehouseId)),
    inventory: (cachedWarehouseSync.inventory || []).filter((item) => !ids.has(item.warehouseId)),
    results: (cachedWarehouseSync.results || []).filter((item) => !ids.has(item.warehouseId)),
  };
  cachedOrdersSync = {
    ...cachedOrdersSync,
    orders: (cachedOrdersSync.orders || []).filter((item) => !ids.has(item.warehouseId)),
    results: (cachedOrdersSync.results || []).filter((item) => !ids.has(item.warehouseId)),
  };
  saveWarehouseCache(cachedWarehouseSync);
  saveOrderCache(cachedOrdersSync);
}

function parseRequestBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolveBody(body ? JSON.parse(body) : {});
      } catch (error) {
        rejectBody(error);
      }
    });
    req.on("error", rejectBody);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  });
  res.end(JSON.stringify(payload));
}

const staticMimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function isPathInside(root, target) {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !/^[a-zA-Z]:/.test(path) && !path.startsWith("\\\\"));
}

function serveFile(req, res, filePath) {
  const stats = statSync(filePath);
  if (!stats.isFile()) return false;
  res.writeHead(200, {
    "Content-Type": staticMimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
    "Content-Length": stats.size,
    "Cache-Control": filePath.includes(`${resolve(distDir, "assets")}`) ? "public, max-age=31536000, immutable" : "no-cache",
    "Access-Control-Allow-Origin": "*",
  });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  createReadStream(filePath).pipe(res);
  return true;
}

function serveDistFallback(req, res, url) {
  if (!["GET", "HEAD"].includes(req.method || "")) return false;
  if (url.pathname.startsWith("/api/")) return false;
  const indexPath = resolve(distDir, "index.html");
  if (!existsSync(indexPath)) return false;

  let pathname = "/";
  try {
    pathname = decodeURIComponent(url.pathname || "/");
  } catch {
    sendJson(res, 400, { ok: false, message: "Bad URL encoding" });
    return true;
  }

  const requestedPath = pathname === "/" ? indexPath : resolve(distDir, `.${pathname}`);
  if (isPathInside(distDir, requestedPath) && existsSync(requestedPath)) {
    return serveFile(req, res, requestedPath);
  }

  const acceptsHtml = String(req.headers.accept || "").includes("text/html");
  const looksLikePageRoute = !extname(pathname);
  if (pathname === "/" || acceptsHtml || looksLikePageRoute) {
    return serveFile(req, res, indexPath);
  }
  return false;
}

function getAuth(req) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
  const sessionUser = verifySessionToken(token, sessionSecret);
  if (sessionUser) {
    if (sessionUser.id === directAuth.user.id && sessionUser.username === directAuth.user.username) {
      return { role: directAuth.role, user: publicUser(directAuth.user) };
    }
    const currentUser = (cachedUsers.users || []).find((user) => user.id === sessionUser.id);
    if (!currentUser || currentUser.status === "disabled") return { role: "guest", user: null };
    return { role: currentUser.role, user: publicUser(currentUser) };
  }
  if (internalAccessCode && token === internalAccessCode) {
    return {
      role: "direct",
      user: {
        id: "legacy-internal",
        username: "internal",
        displayName: "内部访问",
        role: "direct",
        roleLabel: "直营部门",
      },
    };
  }
  return { role: "guest", user: null };
}

function canViewPartnerAssets(auth) {
  return auth.role === "direct" || auth.role === "distributor";
}

function canManage(auth) {
  return auth.role === "direct";
}

function stripInventory(product) {
  return {
    ...product,
    stockQty: 0,
    lockedQty: 0,
    inTransitQty: 0,
    warehouseTotalQty: 0,
    warehouseBreakdown: [],
    dataGap: product.dataGap ? "restricted" : "",
  };
}

function dateKeyInTimezone(date = new Date(), timeZone = inventorySnapshotTimezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function minutesInTimezone(date = new Date(), timeZone = inventorySnapshotTimezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function safeTimezone(value, fallback = movementHistoryTimezone) {
  const candidate = String(value || fallback || "Asia/Shanghai").trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return fallback || "Asia/Shanghai";
  }
}

function productNameBySku() {
  const names = new Map();
  for (const product of cachedProducts.catalog || []) {
    if (product.sku) names.set(String(product.sku).toLowerCase(), product.name || product.nameEn || product.sku);
  }
  for (const product of cachedProducts.productBase || []) {
    if (product.sku && !names.has(String(product.sku).toLowerCase())) {
      names.set(String(product.sku).toLowerCase(), product.name || product.nameEn || product.sku);
    }
  }
  return names;
}

function buildInventorySnapshotRows() {
  const names = productNameBySku();
  return (cachedWarehouseSync.inventory || []).map((item) => ({
    warehouseId: item.warehouseId || "",
    warehouseName: item.warehouseName || warehouseConnections.find((warehouse) => warehouse.id === item.warehouseId)?.name || item.warehouseId || "",
    country: item.country || "",
    sku: item.sku || "",
    countrySku: item.countrySku || "",
    productName: item.name || names.get(String(item.sku || "").toLowerCase()) || item.sku || "",
    availableQty: Number(item.availableQty || 0),
    lockedQty: Number(item.lockedQty || 0),
    waitInQty: Number(item.waitInQty || 0),
    inTransitQty: Number(item.inTransitQty || 0),
    faultyQty: Number(item.faultyQty || 0),
    temporaryQty: Number(item.temporaryQty || 0),
    totalQty: Number(item.totalQty || 0),
    sourceSyncedAt: item.syncedAt || cachedWarehouseSync.syncedAt || "",
  }));
}

function upsertInventorySnapshot(date = dateKeyInTimezone(), reason = "manual") {
  const rows = buildInventorySnapshotRows();
  const totals = rows.reduce((sum, item) => ({
    availableQty: sum.availableQty + item.availableQty,
    lockedQty: sum.lockedQty + item.lockedQty,
    waitInQty: sum.waitInQty + item.waitInQty,
    inTransitQty: sum.inTransitQty + item.inTransitQty,
    totalQty: sum.totalQty + item.totalQty,
  }), { availableQty: 0, lockedQty: 0, waitInQty: 0, inTransitQty: 0, totalQty: 0 });
  const snapshot = {
    date,
    capturedAt: new Date().toISOString(),
    sourceSyncedAt: cachedWarehouseSync.syncedAt || "",
    reason,
    rowCount: rows.length,
    warehouseCount: new Set(rows.map((item) => item.warehouseId).filter(Boolean)).size,
    skuCount: new Set(rows.map((item) => item.sku).filter(Boolean)).size,
    totals,
    rows,
  };

  const snapshots = (cachedInventorySnapshots.snapshots || []).filter((item) => item.date !== date);
  snapshots.unshift(snapshot);
  snapshots.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  cachedInventorySnapshots = {
    updatedAt: new Date().toISOString(),
    lastSnapshotAt: snapshot.capturedAt,
    snapshots: snapshots.slice(0, 370),
  };
  saveInventorySnapshotCache(cachedInventorySnapshots);
  void notifyInventorySnapshot(snapshot);
  return snapshot;
}

function inventorySnapshotPayload(date) {
  const snapshots = cachedInventorySnapshots.snapshots || [];
  const selectedDate = date || snapshots[0]?.date || "";
  const selectedSnapshot = snapshots.find((item) => item.date === selectedDate) || null;
  return {
    ok: true,
    updatedAt: cachedInventorySnapshots.updatedAt || "",
    lastSnapshotAt: cachedInventorySnapshots.lastSnapshotAt || "",
    dates: snapshots.map((item) => ({
      date: item.date,
      capturedAt: item.capturedAt,
      rowCount: item.rowCount || 0,
      warehouseCount: item.warehouseCount || 0,
      skuCount: item.skuCount || 0,
      totals: item.totals || {},
    })),
    selectedDate,
    snapshot: selectedSnapshot,
  };
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function inventorySnapshotCsv(snapshot) {
  const headers = ["日期", "仓库", "国家/地区", "SKU", "国家SKU", "产品名称", "可售", "锁定", "待入库", "在途", "不良", "暂存", "总库存", "库存同步时间", "快照时间"];
  const lines = [headers.map(csvCell).join(",")];
  for (const row of snapshot?.rows || []) {
    lines.push([
      snapshot.date,
      row.warehouseName,
      row.country,
      row.sku,
      row.countrySku,
      row.productName,
      row.availableQty,
      row.lockedQty,
      row.waitInQty,
      row.inTransitQty,
      row.faultyQty,
      row.temporaryQty,
      row.totalQty,
      row.sourceSyncedAt,
      snapshot.capturedAt,
    ].map(csvCell).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}`;
}

function movementStatusForSnapshot({ availableQty, sales7, sales30, sales90, dailyWeighted, daysCover, leadDays }) {
  if (availableQty <= 0 && (sales7 > 0 || sales30 > 0 || sales90 > 0)) return "缺货";
  if (dailyWeighted > 0 && daysCover <= leadDays + 10) return "补货预警";
  if (availableQty > 0 && sales30 === 0) return "滞销";
  if (availableQty > 0 && sales90 <= 2) return "滞销";
  if (dailyWeighted > 0 && daysCover > 90) return "慢销";
  if (sales90 === 0 && availableQty <= 0) return "无动销数据";
  return "健康";
}

function movementSuggestionForSnapshot(status, row) {
  if (status === "缺货") return "立即核查库存，确认是否有在途或可调拨库存。";
  if (status === "补货预警") return `建议按 ${row.targetCoverDays} 天覆盖量安排补货，参考补货量 ${row.replenishQty}。`;
  if (status === "慢销") return "库存覆盖过高，建议暂停补货并评估促销或调价。";
  if (status === "滞销") return "近 30 天动销不足，建议检查渠道曝光、价格和是否清仓。";
  if (status === "无动销数据") return "暂无订单出库数据，先确认订单接口或 SKU 映射。";
  return "库存和销量处于可控区间。";
}

function movementSnapshotRows(movementPayload) {
  const warehouseById = new Map(warehouseConnections.map((warehouse) => [warehouse.id, warehouse]));
  const rows = [];
  for (const item of movementPayload.items || []) {
    const stockRows = new Map((item.warehouseBreakdown || []).map((row) => [row.warehouseId || row.warehouseName, row]));
    const salesRows = new Map((item.salesWarehouseBreakdown || []).map((row) => [row.warehouseId || row.warehouseName, row]));
    const keys = new Set([...stockRows.keys(), ...salesRows.keys()].filter(Boolean));
    if (!keys.size) keys.add("");
    for (const key of keys) {
      const stock = stockRows.get(key) || {};
      const sales = salesRows.get(key) || {};
      const warehouseId = stock.warehouseId || sales.warehouseId || "";
      const warehouse = warehouseById.get(warehouseId) || {};
      const availableQty = numberOrZero(stock.availableQty ?? item.availableQty);
      const lockedQty = numberOrZero(stock.lockedQty ?? item.lockedQty);
      const inTransitQty = numberOrZero(stock.inTransitQty ?? item.inTransitQty);
      const totalQty = numberOrZero(stock.totalQty ?? item.totalQty);
      const sales3 = numberOrZero(sales.sales3 ?? item.sales3);
      const sales7 = numberOrZero(sales.sales7 ?? item.sales7);
      const sales15 = numberOrZero(sales.sales15 ?? item.sales15);
      const sales30 = numberOrZero(sales.sales30 ?? item.sales30);
      const sales60 = numberOrZero(sales.sales60 ?? item.sales60);
      const sales90 = numberOrZero(sales.sales90 ?? item.sales90);
      const avgDaily3 = numberOrZero(sales.avgDaily3 ?? sales3 / 3);
      const avgDaily7 = numberOrZero(sales.avgDaily7 ?? sales7 / 7);
      const avgDaily30 = numberOrZero(sales.avgDaily30 ?? sales30 / 30);
      const avgDaily90 = numberOrZero(sales.avgDaily90 ?? sales90 / 90);
      const dailyWeighted = numberOrZero(sales.dailyWeighted ?? (avgDaily7 * 0.5 + avgDaily30 * 0.3 + avgDaily90 * 0.2));
      const leadDays = numberOrZero(item.leadDays);
      const targetCoverDays = numberOrZero(item.targetCoverDays);
      const daysCover = dailyWeighted > 0 ? Math.round((availableQty / dailyWeighted) * 10) / 10 : null;
      const replenishQty = Math.max(0, Math.ceil(dailyWeighted * targetCoverDays - availableQty - inTransitQty));
      const status = movementStatusForSnapshot({
        availableQty,
        sales7,
        sales30,
        sales90,
        dailyWeighted,
        daysCover: daysCover ?? 9999,
        leadDays,
      });
      const row = {
        sku: item.sku || "",
        countrySku: item.countrySku || "",
        productName: item.name || item.sku || "",
        brand: item.brand || "",
        category: item.category || "",
        country: warehouse.country || item.country || "",
        warehouseId,
        warehouseName: stock.warehouseName || sales.warehouseName || warehouse.name || "未分仓",
        availableQty,
        lockedQty,
        inTransitQty,
        totalQty,
        sales3,
        sales7,
        sales15,
        sales30,
        sales60,
        sales90,
        avgDaily3,
        avgDaily7,
        avgDaily30,
        avgDaily90,
        dailyWeighted,
        daysCover,
        leadDays,
        targetCoverDays,
        replenishQty,
        status,
        suggestion: "",
        source: item.source || "",
        dataGap: item.dataGap || "",
      };
      row.suggestion = movementSuggestionForSnapshot(status, row);
      rows.push(row);
    }
  }
  return rows.sort((a, b) => b.sales30 - a.sales30 || b.availableQty - a.availableQty || a.sku.localeCompare(b.sku));
}

function movementSnapshotTotals(rows) {
  const statusCounts = rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});
  return {
    rowCount: rows.length,
    warehouseCount: new Set(rows.map((row) => row.warehouseId).filter(Boolean)).size,
    skuCount: new Set(rows.map((row) => row.sku).filter(Boolean)).size,
    availableQty: rows.reduce((sum, row) => sum + numberOrZero(row.availableQty), 0),
    totalQty: rows.reduce((sum, row) => sum + numberOrZero(row.totalQty), 0),
    sales3: rows.reduce((sum, row) => sum + numberOrZero(row.sales3), 0),
    sales7: rows.reduce((sum, row) => sum + numberOrZero(row.sales7), 0),
    sales30: rows.reduce((sum, row) => sum + numberOrZero(row.sales30), 0),
    sales90: rows.reduce((sum, row) => sum + numberOrZero(row.sales90), 0),
    stockout: statusCounts["缺货"] || 0,
    replenish: statusCounts["补货预警"] || 0,
    slow: statusCounts["慢销"] || 0,
    stagnant: statusCounts["滞销"] || 0,
    noSalesData: statusCounts["无动销数据"] || 0,
  };
}

function upsertMovementSnapshot(date = dateKeyInTimezone(new Date(), movementHistoryTimezone), reason = "manual", timeZone = movementHistoryTimezone) {
  const resolvedTimezone = safeTimezone(timeZone, movementHistoryTimezone);
  const movementPayload = movementResponsePayload();
  const rows = movementSnapshotRows(movementPayload);
  const snapshot = {
    date,
    timezone: resolvedTimezone,
    capturedAt: new Date().toISOString(),
    orderSyncedAt: movementPayload.orderSyncedAt || "",
    inventorySyncedAt: movementPayload.inventorySyncedAt || "",
    reason,
    totals: movementSnapshotTotals(rows),
    rows,
  };
  movementHistoryStore.upsertSnapshot(snapshot);
  return snapshot;
}

function movementHistoryDateOptions(timezone = movementHistoryTimezone) {
  return movementHistoryStore.listDates(timezone);
}

function filterMovementHistoryRows(rows, { warehouseId = "", sku = "" } = {}) {
  const skuKeyword = String(sku || "").trim().toLowerCase();
  return (rows || []).filter((row) => {
    if (warehouseId && row.warehouseId !== warehouseId) return false;
    if (skuKeyword) {
      const text = [row.sku, row.countrySku, row.productName, row.brand, row.category].join(" ").toLowerCase();
      if (!text.includes(skuKeyword)) return false;
    }
    return true;
  });
}

function movementHistorySnapshotsInRange({ date = "", from = "", to = "", timezone = movementHistoryTimezone } = {}) {
  const resolvedTimezone = safeTimezone(timezone, movementHistoryTimezone);
  return movementHistoryStore.getSnapshots({ date, from, to, timezone: resolvedTimezone });
}

function movementHistoryPayload(params = {}) {
  const timezone = safeTimezone(params.timezone, movementHistoryTimezone);
  const dates = movementHistoryDateOptions(timezone);
  const selectedDate = params.date || dates[0]?.date || "";
  const snapshots = movementHistorySnapshotsInRange({
    date: selectedDate,
    from: params.from,
    to: params.to,
    timezone,
  });
  const selectedSnapshot = snapshots[0] || null;
  const rows = selectedSnapshot ? filterMovementHistoryRows(selectedSnapshot.rows || [], params) : [];
  const filteredSnapshot = selectedSnapshot ? { ...selectedSnapshot, totals: movementSnapshotTotals(rows), rows } : null;
  const trendSnapshots = movementHistorySnapshotsInRange({
    from: params.from || dates.at(-1)?.date || "",
    to: params.to || dates[0]?.date || "",
    timezone,
  }).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const trend = trendSnapshots.map((snapshot) => {
    const trendRows = filterMovementHistoryRows(snapshot.rows || [], params);
    const totals = movementSnapshotTotals(trendRows);
    return {
      date: snapshot.date,
      capturedAt: snapshot.capturedAt || "",
      sales7: totals.sales7,
      sales30: totals.sales30,
      sales90: totals.sales90,
      availableQty: totals.availableQty,
      totalQty: totals.totalQty,
      riskSku: totals.stockout + totals.replenish + totals.slow + totals.stagnant,
      rowCount: totals.rowCount,
    };
  });
  const warehouseOptions = Array.from(new Map(
    (selectedSnapshot?.rows || [])
      .filter((row) => row.warehouseId)
      .map((row) => [row.warehouseId, { warehouseId: row.warehouseId, warehouseName: row.warehouseName, country: row.country }]),
  ).values()).sort((a, b) => a.warehouseName.localeCompare(b.warehouseName, "zh-CN"));
  return {
    ok: true,
    updatedAt: movementHistoryStore.getMetadata().updatedAt || "",
    lastSnapshotAt: movementHistoryStore.getMetadata().lastSnapshotAt || "",
    databasePath: movementHistoryStore.dbPath,
    timezone,
    timezones: Array.from(new Set([movementHistoryTimezone, inventorySnapshotTimezone, "Asia/Shanghai", "Europe/Moscow", "Asia/Jakarta", "Asia/Kuala_Lumpur", "Asia/Ho_Chi_Minh"])).filter(Boolean),
    dates,
    selectedDate,
    snapshot: filteredSnapshot,
    trend,
    warehouseOptions,
  };
}

function movementHistoryCsv(snapshots, params = {}) {
  const headers = ["日期", "时区", "仓库", "国家/地区", "SKU", "国家SKU", "产品名称", "品牌", "分类", "可售", "锁定", "在途", "总库存", "3天销量", "7天销量", "15天销量", "30天销量", "60天销量", "90天销量", "30天日均", "加权日均", "可售天数", "状态", "建议补货", "建议", "订单同步时间", "库存同步时间", "快照时间"];
  const lines = [headers.map(csvCell).join(",")];
  for (const snapshot of snapshots || []) {
    for (const row of filterMovementHistoryRows(snapshot.rows || [], params)) {
      lines.push([
        snapshot.date,
        snapshot.timezone,
        row.warehouseName,
        row.country,
        row.sku,
        row.countrySku,
        row.productName,
        row.brand,
        row.category,
        row.availableQty,
        row.lockedQty,
        row.inTransitQty,
        row.totalQty,
        row.sales3,
        row.sales7,
        row.sales15,
        row.sales30,
        row.sales60,
        row.sales90,
        Number(row.avgDaily30 || 0).toFixed(2),
        Number(row.dailyWeighted || 0).toFixed(2),
        row.daysCover ?? "",
        row.status,
        row.replenishQty,
        row.suggestion,
        snapshot.orderSyncedAt,
        snapshot.inventorySyncedAt,
        snapshot.capturedAt,
      ].map(csvCell).join(","));
    }
  }
  return `\uFEFF${lines.join("\r\n")}`;
}

function filterProductPayload(payload, auth) {
  const mergedPayload = mergeWarehouseDataIntoProducts(payload, cachedWarehouseSync);
  let catalog = mergedPayload.catalog;
  if (auth.role === "guest") {
    catalog = catalog
      .filter((product) => product.channel === "分销")
      .map(({ directPrice, directCurrency, directCostPrice, directCostCurrency, distributionPrice, distributionCurrency, distributionCost, distributionCostPrice, distributionCostCurrency, salesPrice, salesCurrency, raw, ...product }) => stripInventory(product));
  } else if (auth.role === "distributor") {
    catalog = catalog
      .filter((product) => product.channel === "分销")
      .map(({ directPrice, directCurrency, directCostPrice, directCostCurrency, raw, ...product }) => product);
  } else {
    catalog = catalog.map(({ raw, ...product }) => product);
  }

  return {
    ...mergedPayload,
    internal: auth.role === "direct",
    user: publicUser(auth.user),
    counts: {
      ...mergedPayload.counts,
      visibleCatalog: catalog.length,
    },
    productBase: canViewPartnerAssets(auth) ? payload.productBase : [],
    catalog,
  };
}

function compactCatalogProduct(product) {
  const {
    publicDescription,
    sellingPoints,
    sellingPointsEn,
    qualificationImageUrl,
    raw,
    ...compact
  } = product;
  return compact;
}

function compactProductBase(product) {
  const {
    publicDescription,
    sellingPoints,
    sellingPointsEn,
    raw,
    ...compact
  } = product;
  return compact;
}

function productResponsePayload(payload, auth, mode = "list") {
  const filtered = filterProductPayload(payload, auth);
  if (mode === "detail") return filtered;
  return {
    ...filtered,
    mode: "list",
    productBase: [],
    catalog: (filtered.catalog || []).map(compactCatalogProduct),
  };
}

function movementResponsePayload() {
  const mergedProducts = mergeWarehouseDataIntoProducts(cachedProducts, cachedWarehouseSync);
  const payload = buildMovementPayload(mergedProducts, cachedWarehouseSync, cachedOrdersSync);
  const latestJob = latestOrderSyncJob();
  const warehouseDiagnostics = buildMovementDiagnostics(
    mergedProducts,
    cachedWarehouseSync,
    cachedOrdersSync,
    warehouseConnections.map((connection) => ({
      id: connection.id,
      name: connection.name,
      country: connection.country,
      providerId: connection.providerId,
      hasCredentials: hasWarehouseCredentials(connection),
    })),
  ).map((item) => ({
    ...item,
    providerName: providerName(item.providerId),
    latestOrderSyncJob: orderSyncJobWarehouseDigest(latestJob, item.warehouseId),
  }));
  const results = cachedOrdersSync.results || [];
  const backgroundRunningWarehouses = results
    .filter((result) => result.backgroundRunning)
    .map((result) => ({
      warehouseId: result.warehouseId,
      message: result.message || "",
      orderCount: result.orderCount || 0,
    }));
  if (latestJob && ["queued", "running"].includes(latestJob.status)) {
    for (const warehouseId of latestJob.warehouseIds || []) {
      if (backgroundRunningWarehouses.some((item) => item.warehouseId === warehouseId)) continue;
      backgroundRunningWarehouses.push({
        warehouseId,
        message: latestJob.currentWarehouseId === warehouseId
          ? `Background sync running: ${latestJob.currentChunkLabel || latestJob.message || ""}`
          : "Queued in background order sync",
        orderCount: 0,
      });
    }
  }
  const failedWarehouses = results
    .filter((result) => !result.ok && !result.skipped && !result.backgroundRunning)
    .map((result) => ({
      warehouseId: result.warehouseId,
      message: result.message || "",
      orderCount: result.orderCount || 0,
    }));
  const warehouseFreshness = warehouseConnections.map((connection) => {
    const result = results.find((item) => item.warehouseId === connection.id);
    const running = latestJob && ["queued", "running"].includes(latestJob.status) && (latestJob.warehouseIds || []).includes(connection.id);
    return {
      warehouseId: connection.id,
      warehouseName: connection.name,
      providerId: connection.providerId,
      providerName: providerName(connection.providerId),
      lastCompletedAt: result?.backgroundCompletedAt || cachedOrdersSync.syncedAt || "",
      orderCount: result?.orderCount || 0,
      ok: result?.ok ?? false,
      running: Boolean(running),
      failed: Boolean(result && !result.ok && !result.skipped),
      message: running ? (latestJob.currentWarehouseId === connection.id ? latestJob.currentChunkLabel : "Queued") : (result?.message || ""),
    };
  });
  return {
    ...payload,
    orderSyncJob: publicOrderSyncJob(latestJob),
    warehouseFreshness,
    warehouseDiagnostics,
    syncState: {
      usingCachedOrders: Boolean(cachedOrdersSync.syncedAt),
      lastCompletedAt: cachedOrdersSync.syncedAt || "",
      backgroundRunningWarehouses,
      failedWarehouses,
    },
  };
}

function buildDashboardSummary(auth) {
  const products = productResponsePayload(cachedProducts, auth, "list");
  const movementPayload = auth.role === "direct" ? movementResponsePayload() : null;
  const orderResults = cachedOrdersSync.results || [];
  const warehouseResults = cachedWarehouseSync.results || [];
  const visibleCatalog = products.catalog || [];
  const orderCount90 = (cachedOrdersSync.orders || []).length;
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayOrders = (cachedOrdersSync.orders || []).filter((order) => String(order.shippedAt || order.createdAt || "").slice(0, 10) === todayKey);
  const salesAmount90 = (cachedOrdersSync.orders || []).reduce((sum, order) => sum + numberOrZero(order.salesAmount), 0);
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    internal: auth.role === "direct",
    user: publicUser(auth.user),
    counts: {
      visibleCatalog: visibleCatalog.length,
      totalInventory: visibleCatalog.reduce((sum, product) => sum + numberOrZero(product.stockQty), 0),
      todayOrders: todayOrders.length,
      orderCount90,
      salesAmount90,
      riskSku: movementPayload
        ? numberOrZero(movementPayload.counts.stockout) + numberOrZero(movementPayload.counts.replenish) + numberOrZero(movementPayload.counts.slow) + numberOrZero(movementPayload.counts.stagnant)
        : visibleCatalog.filter((product) => product.alert !== "健康").length,
      movementSku: movementPayload?.counts.sku || 0,
      warehouseOnlySku: movementPayload?.counts.warehouseOnly || 0,
      stockout: movementPayload?.counts.stockout || 0,
      replenish: movementPayload?.counts.replenish || 0,
      slow: movementPayload?.counts.slow || 0,
      stagnant: movementPayload?.counts.stagnant || 0,
    },
    sync: {
      productsSyncedAt: cachedProducts.syncedAt || "",
      inventorySyncedAt: cachedWarehouseSync.syncedAt || "",
      orderSyncedAt: cachedOrdersSync.syncedAt || "",
      lastAutoSyncAt,
      autoSyncIntervalMs,
      backgroundRunningWarehouses: movementPayload?.syncState?.backgroundRunningWarehouses || [],
      failedWarehouses: movementPayload?.syncState?.failedWarehouses || [],
    },
    movementDiagnostics: movementPayload?.warehouseDiagnostics || [],
    warehouses: warehouseConnections.map((connection) => {
      const result = warehouseResults.find((item) => item.warehouseId === connection.id);
      const orderResult = orderResults.find((item) => item.warehouseId === connection.id);
      return {
        id: connection.id,
        name: connection.name,
        providerId: connection.providerId,
        providerName: providerName(connection.providerId),
        country: connection.country,
        hasCredentials: hasWarehouseCredentials(connection),
        inventoryOk: result?.ok ?? false,
        orderOk: orderResult?.ok ?? false,
        backgroundRunning: Boolean(orderResult?.backgroundRunning),
        message: orderResult?.message || result?.message || "",
        inventoryCount: result?.inventoryCount || 0,
        orderCount: orderResult?.orderCount || 0,
      };
    }),
  };
}

function orderDateKey(order) {
  return String(order.shippedAt || order.createdAt || "").slice(0, 10);
}

function orderIdentity(order) {
  return [
    order.providerId,
    order.warehouseId,
    order.orderId || order.orderNo,
  ].map((value) => String(value || "").trim()).filter(Boolean).join("::");
}

function orderOptionRows(values) {
  return Array.from(values)
    .filter(Boolean)
    .sort((a, b) => String(a).localeCompare(String(b), "zh-CN"))
    .map((value) => ({ value, label: value }));
}

function inferOrderProjectGroup(order) {
  const candidates = [
    order.shopName,
    order.shopCode,
    order.sourceAccount,
    order.orderNo,
    order.externalOrderNo,
  ].map((value) => String(value || "").trim().toUpperCase()).filter(Boolean);
  return candidates.some((value) => value.startsWith("TZ")) ? "同舟跨境项目" : "深六项目";
}

function orderSkuLookupKeys(value) {
  const text = String(value || "").trim();
  if (!text) return [];
  const keys = new Set([text.toLowerCase()]);
  const tzkjMatch = text.match(/(TZKJ-[A-Z0-9-]+)$/i);
  if (tzkjMatch) keys.add(tzkjMatch[1].toLowerCase());
  return Array.from(keys);
}

function buildOrderProductLookup() {
  const lookup = new Map();
  const addProduct = (product) => {
    const displayName = String(product?.name || product?.nameEn || product?.productName || "").trim();
    const imageUrl = String(product?.imageUrl || "").trim();
    if (!displayName && !imageUrl) return;
    const row = { name: displayName, imageUrl };
    for (const value of [product?.sku, product?.skuNo, product?.countrySku]) {
      for (const key of orderSkuLookupKeys(value)) {
        if (!lookup.has(key)) lookup.set(key, row);
      }
    }
  };
  for (const product of cachedProducts.productBase || []) addProduct(product);
  for (const product of cachedProducts.catalog || []) addProduct(product);
  for (const product of cachedWarehouseSync.products || []) addProduct(product);
  return lookup;
}

function buildOrderAnalysisPayload(params = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const dateTo = String(params.dateTo || today).slice(0, 10);
  const dateFrom = String(params.dateFrom || dateTo).slice(0, 10);
  const country = String(params.country || "");
  const warehouseId = String(params.warehouseId || "");
  const platform = String(params.platform || "");
  const shopName = String(params.shopName || "");
  const projectGroup = String(params.projectGroup || "");
  const providerId = String(params.providerId || "");
  const keyword = String(params.keyword || "").trim().toLowerCase();
  const onlyRussia = params.onlyRussia !== false;
  const productLookup = buildOrderProductLookup();
  const allOrders = (cachedOrdersSync.orders || []).map((order) => ({
    ...order,
    date: orderDateKey(order),
    platform: String(order.platform || "").trim(),
    shopName: String(order.shopName || order.shopCode || "").trim(),
    projectGroup: String(order.projectGroup || "").trim() || inferOrderProjectGroup(order),
  })).map((order) => {
    const product = orderSkuLookupKeys(order.sku).map((key) => productLookup.get(key)).find(Boolean);
    return {
      ...order,
      productDisplayName: product?.name || order.productName || order.sku || "",
      imageUrl: product?.imageUrl || "",
    };
  });
  const selectableOrders = onlyRussia ? allOrders.filter((order) => order.providerId === "yunwms_ru" || order.country === "俄罗斯") : allOrders;
  const options = {
    countries: orderOptionRows(new Set(selectableOrders.map((order) => order.country))),
    warehouses: Array.from(new Map(selectableOrders.map((order) => [order.warehouseId, {
      warehouseId: order.warehouseId,
      warehouseName: order.warehouseName || order.warehouseId,
      country: order.country || "",
    }])).values()).sort((a, b) => a.warehouseName.localeCompare(b.warehouseName, "zh-CN")),
    platforms: orderOptionRows(new Set(selectableOrders.map((order) => order.platform || "未识别平台"))),
    shops: orderOptionRows(new Set(selectableOrders.map((order) => order.shopName || "未识别店铺"))),
    projectGroups: orderOptionRows(new Set(selectableOrders.map((order) => order.projectGroup))),
  };
  const filtered = selectableOrders.filter((order) => {
    const date = order.date;
    if (!date || date < dateFrom || date > dateTo) return false;
    if (country && order.country !== country) return false;
    if (warehouseId && order.warehouseId !== warehouseId) return false;
    if (platform && (order.platform || "未识别平台") !== platform) return false;
    if (shopName && (order.shopName || "未识别店铺") !== shopName) return false;
    if (projectGroup && order.projectGroup !== projectGroup) return false;
    if (providerId && order.providerId !== providerId) return false;
    if (keyword) {
      const haystack = [
        order.orderNo,
        order.externalOrderNo,
        order.sku,
        order.productName,
        order.productDisplayName,
        order.shopName,
        order.projectGroup,
        order.platform,
        order.warehouseName,
      ].join(" ").toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });

  const orderIds = new Set(filtered.map(orderIdentity).filter(Boolean));
  const skuSet = new Set(filtered.map((order) => order.sku).filter(Boolean));
  const quantity = filtered.reduce((sum, order) => sum + numberOrZero(order.quantity), 0);
  const salesAmount = filtered.reduce((sum, order) => sum + numberOrZero(order.salesAmount), 0);
  const aggregate = (keyFn) => {
    const rows = new Map();
    for (const order of filtered) {
      const key = keyFn(order);
      const current = rows.get(key) || { key, orderIds: new Set(), orderLines: 0, quantity: 0, salesAmount: 0, skuSet: new Set() };
      current.orderIds.add(orderIdentity(order));
      current.orderLines += 1;
      current.quantity += numberOrZero(order.quantity);
      current.salesAmount += numberOrZero(order.salesAmount);
      if (order.sku) current.skuSet.add(order.sku);
      rows.set(key, current);
    }
    return Array.from(rows.values())
      .map((row) => ({
        key: row.key,
        orderCount: row.orderIds.size,
        orderLines: row.orderLines,
        quantity: row.quantity,
        salesAmount: row.salesAmount,
        skuCount: row.skuSet.size,
      }))
      .sort((a, b) => b.orderCount - a.orderCount || b.quantity - a.quantity);
  };
  const daily = aggregate((order) => order.date).sort((a, b) => a.key.localeCompare(b.key));
  const byShop = aggregate((order) => order.shopName || "未识别店铺");
  const byProjectGroup = aggregate((order) => order.projectGroup || "未识别项目组");
  const byPlatform = aggregate((order) => order.platform || "未识别平台");
  const byWarehouse = aggregate((order) => order.warehouseName || order.warehouseId || "未识别仓库");
  const byCountry = aggregate((order) => order.country || "未识别国家");
  const recentOrders = filtered
    .slice()
    .sort((a, b) => String(b.shippedAt || b.createdAt || "").localeCompare(String(a.shippedAt || a.createdAt || "")))
    .slice(0, 200)
    .map((order) => ({
      orderId: order.orderId || "",
      orderNo: order.orderNo || "",
      externalOrderNo: order.externalOrderNo || "",
      date: order.date,
      shippedAt: order.shippedAt || "",
      createdAt: order.createdAt || "",
      country: order.country || "",
      warehouseId: order.warehouseId || "",
      warehouseName: order.warehouseName || "",
      platform: order.platform || "未识别平台",
      shopName: order.shopName || "未识别店铺",
      projectGroup: order.projectGroup || "未识别项目组",
      sku: order.sku || "",
      productName: order.productName || "",
      productDisplayName: order.productDisplayName || order.productName || order.sku || "",
      imageUrl: order.imageUrl || "",
      quantity: numberOrZero(order.quantity),
      salesAmount: numberOrZero(order.salesAmount),
      currency: order.currency || "",
      status: order.status || "",
    }));
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    syncedAt: cachedOrdersSync.syncedAt || "",
    scope: onlyRussia ? "russia" : "all",
    filters: { dateFrom, dateTo, country, warehouseId, platform, shopName, projectGroup, providerId, keyword },
    counts: {
      orderCount: orderIds.size,
      orderLines: filtered.length,
      quantity,
      skuCount: skuSet.size,
      salesAmount,
      shopCount: new Set(filtered.map((order) => order.shopName).filter(Boolean)).size,
      projectGroupCount: new Set(filtered.map((order) => order.projectGroup).filter(Boolean)).size,
      platformCount: new Set(filtered.map((order) => order.platform).filter(Boolean)).size,
      unrecognizedShopRows: filtered.filter((order) => !order.shopName).length,
    },
    options,
    daily,
    byShop,
    byProjectGroup,
    byPlatform,
    byWarehouse,
    byCountry,
    recentOrders,
  };
}

async function handleWarehouseSync(req, res) {
  if (!canManage(getAuth(req))) {
    sendJson(res, 401, { ok: false, message: "同步仓库数据需要内部登录。" });
    return;
  }

  const results = [];
  const products = [];
  const inventory = [];

  for (const connection of warehouseConnections) {
    const result = await syncWithSameSystemFallback(connection, (target) => syncWarehouseConnection(target));
    const connectionChanged = updateResolvedWarehouseId(connection, result);
    if (connectionChanged) saveWarehouseConnections();
    results.push({
      warehouseId: result.warehouseId,
      ok: result.ok,
      skipped: result.skipped,
      message: result.message || "",
      productCount: result.products.length,
      inventoryCount: result.inventory.length,
    });
    products.push(...result.products);
    inventory.push(...result.inventory);
  }

  cachedWarehouseSync = {
    syncedAt: new Date().toISOString(),
    products,
    inventory,
    results,
  };
  saveWarehouseCache(cachedWarehouseSync);
  upsertInventorySnapshot(dateKeyInTimezone(), "warehouse_sync");
  upsertMovementSnapshot(dateKeyInTimezone(new Date(), movementHistoryTimezone), "warehouse_sync", movementHistoryTimezone);
  sendJson(res, 200, { ok: true, ...cachedWarehouseSync, products: undefined, inventory: undefined });
}

async function refreshWarehouseInventoryForSnapshot(snapshotReason = "daily_3am") {
  const results = [];
  const products = [];
  const inventory = [];

  for (const connection of warehouseConnections) {
    const result = await syncWithSameSystemFallback(connection, (target) => syncWarehouseConnection(target));
    const connectionChanged = updateResolvedWarehouseId(connection, result);
    if (connectionChanged) saveWarehouseConnections();
    results.push({
      warehouseId: result.warehouseId,
      ok: result.ok,
      skipped: result.skipped,
      message: result.message || "",
      productCount: result.products.length,
      inventoryCount: result.inventory.length,
    });
    products.push(...result.products);
    inventory.push(...result.inventory);
  }

  cachedWarehouseSync = {
    syncedAt: new Date().toISOString(),
    products,
    inventory,
    results,
  };
  saveWarehouseCache(cachedWarehouseSync);
  return upsertInventorySnapshot(dateKeyInTimezone(), snapshotReason);
}

function dateOnlyDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - Math.max(1, Number(days) || 90));
  return date.toISOString().slice(0, 10);
}

function addDateDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function compareDateText(left, right) {
  return String(left).localeCompare(String(right));
}

function orderSyncChunksFor(connection, days) {
  const end = new Date().toISOString().slice(0, 10);
  const start = dateOnlyDaysAgo(days);
  if (!["yunwms_ru", "sea_wms"].includes(connection.providerId)) {
    return [{ from: start, to: end, label: `${start} ~ ${end}` }];
  }
  const chunks = [];
  let cursor = start;
  while (compareDateText(cursor, end) <= 0) {
    const chunkEnd = addDateDays(cursor, orderSyncChunkDays - 1);
    const to = compareDateText(chunkEnd, end) > 0 ? end : chunkEnd;
    chunks.push({ from: cursor, to, label: `${cursor} ~ ${to}` });
    cursor = addDateDays(to, 1);
  }
  return chunks;
}

function latestOrderSyncJob() {
  return (cachedOrderSyncJobs.jobs || [])[0] || null;
}

function findOrderSyncJob(jobId) {
  return (cachedOrderSyncJobs.jobs || []).find((job) => job.id === jobId) || null;
}

function publicOrderSyncJob(job) {
  if (!job) return null;
  return {
    ...job,
    progressPercent: job.totalChunks ? Math.round((Number(job.completedChunks || 0) / Number(job.totalChunks || 1)) * 100) : 0,
  };
}

function orderSyncJobWarehouseDigest(job, warehouseId) {
  if (!job || !warehouseId) return null;
  const chunks = (job.chunks || []).filter((chunk) => chunk.warehouseId === warehouseId);
  const result = (job.results || []).find((item) => item.warehouseId === warehouseId);
  const included = (job.warehouseIds || []).includes(warehouseId) || chunks.length || result;
  if (!included) return null;
  const failedChunks = chunks.filter((chunk) => chunk.status === "failed");
  const completedChunks = chunks.filter((chunk) => ["completed", "failed"].includes(chunk.status));
  const running = ["queued", "running"].includes(job.status) && (job.warehouseIds || []).includes(warehouseId);
  const current = running && job.currentWarehouseId === warehouseId;
  const lastChunk = [...chunks].reverse().find((chunk) => chunk.message) || chunks[chunks.length - 1];
  return {
    jobId: job.id,
    status: job.status,
    days: job.days,
    running: Boolean(running),
    current: Boolean(current),
    currentChunkLabel: current ? job.currentChunkLabel || "" : "",
    totalChunks: chunks.length,
    completedChunks: completedChunks.length || (result ? 1 : 0),
    failedChunks: failedChunks.length || numberOrZero(result?.failedChunks),
    orderCount: numberOrZero(result?.orderCount) || chunks.reduce((sum, chunk) => sum + numberOrZero(chunk.orderCount), 0),
    createdAt: job.createdAt || "",
    startedAt: job.startedAt || "",
    completedAt: result?.completedAt || job.completedAt || "",
    lastMessage: result?.message || lastChunk?.message || job.message || "",
    failedChunkSamples: failedChunks.slice(0, 3).map((chunk) => ({
      from: chunk.from,
      to: chunk.to,
      message: chunk.message || "同步分片失败",
    })),
  };
}

function selectedOrderSyncWarehouses(warehouseIds = [], { includeAllWhenEmpty = true } = {}) {
  const ids = new Set((Array.isArray(warehouseIds) ? warehouseIds : []).map((id) => String(id || "").trim()).filter(Boolean));
  const selected = ids.size
    ? warehouseConnections.filter((connection) => ids.has(connection.id))
    : (includeAllWhenEmpty ? warehouseConnections : []);
  return selected;
}

function unknownOrderSyncWarehouseIds(warehouseIds = []) {
  const ids = (Array.isArray(warehouseIds) ? warehouseIds : []).map((id) => String(id || "").trim()).filter(Boolean);
  if (!ids.length) return [];
  const known = new Set(warehouseConnections.map((connection) => connection.id));
  return ids.filter((id) => !known.has(id));
}

function createOrderSyncJob({ days = 90, warehouseIds = [] } = {}) {
  const normalizedDays = Math.max(1, Math.min(180, Number(days) || 90));
  const selected = selectedOrderSyncWarehouses(warehouseIds);
  if (!selected.length) {
    throw new Error("没有匹配到可同步的仓库。");
  }
  const totalChunks = selected.reduce((sum, connection) => sum + orderSyncChunksFor(connection, normalizedDays).length, 0);
  const job = {
    id: `order-sync-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    status: "queued",
    days: normalizedDays,
    warehouseIds: selected.map((connection) => connection.id),
    chunkDays: orderSyncChunkDays,
    createdAt: new Date().toISOString(),
    startedAt: "",
    completedAt: "",
    currentWarehouseId: "",
    currentWarehouseName: "",
    currentChunkLabel: "",
    totalChunks,
    completedChunks: 0,
    totalOrders: 0,
    failedChunks: 0,
    results: [],
    chunks: [],
    message: "Queued",
  };
  cachedOrderSyncJobs.jobs = [job, ...(cachedOrderSyncJobs.jobs || [])].slice(0, 20);
  saveOrderSyncJobsCache();
  return job;
}

function upsertOrderSyncChunk(job, chunk) {
  const index = (job.chunks || []).findIndex((item) => (
    item.warehouseId === chunk.warehouseId &&
    item.from === chunk.from &&
    item.to === chunk.to
  ));
  if (index >= 0) {
    job.chunks[index] = { ...job.chunks[index], ...chunk };
  } else {
    job.chunks = [...(job.chunks || []), chunk];
  }
}

function dedupeOrders(orders) {
  const seen = new Set();
  const deduped = [];
  for (const order of orders || []) {
    const key = [
      order.warehouseId,
      order.orderId || order.orderNo,
      order.sku,
      order.shippedAt || order.createdAt,
      order.quantity,
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(order);
  }
  return deduped;
}

function orderSyncMetaFromResult(result = {}) {
  return {
    orderApiTotal: numberOrZero(result.orderApiTotal),
    orderApiReadRows: numberOrZero(result.orderApiReadRows),
    orderApiReadSkuRows: numberOrZero(result.orderApiReadSkuRows),
    orderApiPagesRead: numberOrZero(result.orderApiPagesRead),
    orderApiPageLimit: numberOrZero(result.orderApiPageLimit),
    orderApiReachedPageLimit: Boolean(result.orderApiReachedPageLimit),
  };
}

function mergeWarehouseOrderCache(connection, result, days, replaceOrders = true) {
  const warehouseId = result.warehouseId || connection.id;
  const orderMeta = orderSyncMetaFromResult(result);
  const nextResults = (cachedOrdersSync.results || []).filter((item) => item.warehouseId !== warehouseId && item.warehouseId !== connection.id);
  nextResults.push({
    warehouseId,
    ok: Boolean(result.ok),
    skipped: Boolean(result.skipped),
    message: result.message || "",
    orderCount: result.orders?.length || 0,
    hasCredentials: hasWarehouseCredentials(connection),
    backgroundRunning: false,
    backgroundCompletedAt: new Date().toISOString(),
    ...orderMeta,
  });

  cachedOrdersSync = {
    ...cachedOrdersSync,
    syncedAt: new Date().toISOString(),
    days,
    orders: replaceOrders
      ? [
          ...(cachedOrdersSync.orders || []).filter((item) => item.warehouseId !== warehouseId && item.warehouseId !== connection.id),
          ...(result.orders || []),
        ]
      : (cachedOrdersSync.orders || []),
    results: nextResults,
  };
  saveOrderCache(cachedOrdersSync);
}

let activeOrderSyncJobPromise = null;

function startOrderSyncJob(job) {
  if (activeOrderSyncJobPromise) return;
  activeOrderSyncJobPromise = runOrderSyncJob(job.id)
    .catch((error) => {
      const runningJob = findOrderSyncJob(job.id);
      if (runningJob) {
        runningJob.status = "failed";
        runningJob.completedAt = new Date().toISOString();
        runningJob.message = error.message || "Order sync job failed";
        saveOrderSyncJobsCache();
      }
      console.error("[orders-sync-job] failed", error);
    })
    .finally(() => {
      activeOrderSyncJobPromise = null;
    });
}

async function runOrderSyncJob(jobId) {
  const job = findOrderSyncJob(jobId);
  if (!job) return;
  job.status = "running";
  job.startedAt = job.startedAt || new Date().toISOString();
  job.message = "Running";
  saveOrderSyncJobsCache();

  const selected = selectedOrderSyncWarehouses(job.warehouseIds, { includeAllWhenEmpty: false });
  if (!selected.length) {
    job.status = "failed";
    job.completedAt = new Date().toISOString();
    job.message = "Order sync job has no target warehouses";
    saveOrderSyncJobsCache();
    return;
  }
  let hadFailure = false;

  for (const connection of selected) {
    const chunks = orderSyncChunksFor(connection, job.days);
    const warehouseOrders = [];
    let warehouseFailedChunks = 0;
    let warehouseSkipped = false;
    let warehouseMessage = "";
    let resolvedWarehouseId = "";
    const warehouseOrderMeta = {
      orderApiTotal: 0,
      orderApiReadRows: 0,
      orderApiReadSkuRows: 0,
      orderApiPagesRead: 0,
      orderApiPageLimit: 0,
      orderApiReachedPageLimit: false,
    };

    for (const chunk of chunks) {
      job.currentWarehouseId = connection.id;
      job.currentWarehouseName = connection.name;
      job.currentChunkLabel = chunk.label;
      upsertOrderSyncChunk(job, {
        warehouseId: connection.id,
        warehouseName: connection.name,
        from: chunk.from,
        to: chunk.to,
        status: "running",
        orderCount: 0,
        message: "",
        startedAt: new Date().toISOString(),
      });
      saveOrderSyncJobsCache();

      try {
        const result = await syncWithSameSystemFallback(
          connection,
          (target) => syncWarehouseOrdersRange(target, chunk.from, chunk.to),
        );
        const chunkOrders = result.orders || [];
        warehouseOrders.push(...chunkOrders);
        warehouseSkipped = warehouseSkipped || Boolean(result.skipped);
        warehouseMessage = result.message || warehouseMessage;
        resolvedWarehouseId = result.resolvedWarehouseId || resolvedWarehouseId;
        const chunkMeta = orderSyncMetaFromResult(result);
        warehouseOrderMeta.orderApiTotal += chunkMeta.orderApiTotal;
        warehouseOrderMeta.orderApiReadRows += chunkMeta.orderApiReadRows;
        warehouseOrderMeta.orderApiReadSkuRows += chunkMeta.orderApiReadSkuRows;
        warehouseOrderMeta.orderApiPagesRead += chunkMeta.orderApiPagesRead;
        warehouseOrderMeta.orderApiPageLimit = Math.max(warehouseOrderMeta.orderApiPageLimit, chunkMeta.orderApiPageLimit);
        warehouseOrderMeta.orderApiReachedPageLimit = warehouseOrderMeta.orderApiReachedPageLimit || chunkMeta.orderApiReachedPageLimit;
        job.totalOrders += chunkOrders.length;
        job.completedChunks += 1;
        upsertOrderSyncChunk(job, {
          warehouseId: connection.id,
          warehouseName: connection.name,
          from: chunk.from,
          to: chunk.to,
          status: result.ok ? "completed" : "failed",
          orderCount: chunkOrders.length,
          message: result.message || "",
          completedAt: new Date().toISOString(),
          ...chunkMeta,
        });
        if (!result.ok && !result.skipped) {
          hadFailure = true;
          warehouseFailedChunks += 1;
          job.failedChunks += 1;
        }
        if (updateResolvedWarehouseId(connection, result)) saveWarehouseConnections();
      } catch (error) {
        hadFailure = true;
        warehouseFailedChunks += 1;
        job.failedChunks += 1;
        job.completedChunks += 1;
        warehouseMessage = error.message || "Order sync chunk failed";
        upsertOrderSyncChunk(job, {
          warehouseId: connection.id,
          warehouseName: connection.name,
          from: chunk.from,
          to: chunk.to,
          status: "failed",
          orderCount: 0,
          message: warehouseMessage,
          completedAt: new Date().toISOString(),
        });
      }
      saveOrderSyncJobsCache();
    }

    const dedupedOrders = dedupeOrders(warehouseOrders);
    const ok = warehouseFailedChunks === 0;
    const result = {
      warehouseId: connection.id,
      resolvedWarehouseId,
      ok,
      skipped: warehouseSkipped,
      message: ok
        ? (warehouseMessage || "Order sync completed")
        : `${warehouseFailedChunks} chunk(s) failed; using completed chunks and cached data where available`,
      ...warehouseOrderMeta,
      orders: dedupedOrders,
    };
    const replaceOrders = ok || dedupedOrders.length > 0;
    mergeWarehouseOrderCache(connection, result, job.days, replaceOrders);
    job.results = [
      ...(job.results || []).filter((item) => item.warehouseId !== connection.id && item.warehouseId !== result.warehouseId),
      {
        warehouseId: result.warehouseId || connection.id,
        warehouseName: connection.name,
        ok,
        skipped: warehouseSkipped,
        message: result.message,
        orderCount: dedupedOrders.length,
        failedChunks: warehouseFailedChunks,
        completedAt: new Date().toISOString(),
        ...warehouseOrderMeta,
      },
    ];
    saveOrderSyncJobsCache();
  }

  job.status = hadFailure ? "partial" : "completed";
  job.completedAt = new Date().toISOString();
  job.currentWarehouseId = "";
  job.currentWarehouseName = "";
  job.currentChunkLabel = "";
  job.message = hadFailure ? "Completed with partial failures" : "Completed";
  saveOrderSyncJobsCache();
  try {
    upsertMovementSnapshot(dateKeyInTimezone(new Date(), movementHistoryTimezone), "order_sync_job", movementHistoryTimezone);
  } catch (error) {
    console.error("[movement-history] capture after order sync failed", error);
  }
}

function warehouseTestMissingFields(connection) {
  const missing = [];
  const credentials = connection.credentials || {};
  if (!connection.baseUrl || /pending|待配置/i.test(String(connection.baseUrl))) missing.push("baseUrl");
  if (connection.providerId === "yunwms_ru") {
    if (!credentials.appKey && !credentials.clientId) missing.push("appKey");
    if (!credentials.token && !credentials.appSecret && !credentials.clientSecret) missing.push("appToken");
    if (!connection.warehouseCode && !connection.warehouseId) missing.push("warehouseCode");
  } else if (connection.providerId === "sea_wms") {
    if (!credentials.clientId && !credentials.appKey) missing.push("clientId/AppKey");
    if (!credentials.clientSecret && !credentials.appSecret) missing.push("clientSecret/AppSecret");
    if (!connection.warehouseCode && !connection.warehouseId) missing.push("warehouseCode/warehouseId");
  }
  return missing;
}

function classifyWarehouseTestError(error, stage) {
  const message = error.message || "Warehouse connection test failed";
  if (/token|key|secret|Signature|auth|credential|AppKey|appToken|鉴权|授权/i.test(message)) {
    return { stage: "auth", message, suggestions: ["检查 AppKey/AppToken 或 ClientSecret 是否复制完整。", "确认该账号有库存和订单接口权限。"] };
  }
  if (/warehouse|仓库|code|id/i.test(message)) {
    return { stage: "warehouse", message, suggestions: ["检查 warehouseCode 和 warehouseId 是否属于当前 baseUrl。", "俄罗斯 YunWMS 优先填仓库代码，SEA WMS 常需要 warehouseId。"] };
  }
  if (/timeout|超时|timed out/i.test(message)) {
    return { stage: `${stage}_timeout`, message, suggestions: ["接口能连通但响应较慢，建议使用后台订单同步。", "俄罗斯大仓可调小 ORDER_SYNC_CHUNK_DAYS。"] };
  }
  return { stage, message, suggestions: ["确认 baseUrl 是否能从服务器访问。", "如果是东南亚仓，请确认不同国家是否使用不同 baseUrl。"] };
}

async function testWarehouseConnectionPayload(payload) {
  const existing = payload.id ? warehouseConnections.find((connection) => connection.id === payload.id) : null;
  const connection = buildWarehouseConnection(payload, existing || null);
  const missing = warehouseTestMissingFields(connection);
  if (missing.length) {
    return {
      ok: false,
      stage: "validation",
      providerId: connection.providerId,
      message: `Missing required fields: ${missing.join(", ")}`,
      suggestions: ["按当前供应商示例补齐必填字段后再检测。"],
    };
  }

  const testTimeoutMs = Math.max(5000, Number(process.env.WAREHOUSE_TEST_TIMEOUT_MS || 20000));
  let inventoryResult;
  try {
    inventoryResult = await withTimeout(
      syncWithSameSystemFallback(connection, (target) => syncWarehouseConnection(target)),
      testTimeoutMs,
      `${connection.name || connection.id} inventory test timeout`,
    );
  } catch (error) {
    return {
      ok: false,
      providerId: connection.providerId,
      resolvedWarehouseId: connection.resolvedWarehouseId || "",
      inventorySampleCount: 0,
      orderSampleCount: 0,
      ...classifyWarehouseTestError(error, "inventory"),
    };
  }

  let orderResult;
  try {
    orderResult = await withTimeout(
      syncWithSameSystemFallback(connection, (target) => syncWarehouseOrders(target, 1)),
      testTimeoutMs,
      `${connection.name || connection.id} order test timeout`,
    );
  } catch (error) {
    const classified = classifyWarehouseTestError(error, "orders");
    return {
      ok: false,
      providerId: connection.providerId,
      resolvedWarehouseId: inventoryResult.resolvedWarehouseId || connection.resolvedWarehouseId || "",
      inventorySampleCount: inventoryResult.inventory?.length || 0,
      orderSampleCount: 0,
      ...classified,
    };
  }

  return {
    ok: Boolean(inventoryResult.ok && orderResult.ok),
    stage: inventoryResult.ok && orderResult.ok ? "completed" : "orders",
    providerId: connection.providerId,
    resolvedWarehouseId: orderResult.resolvedWarehouseId || inventoryResult.resolvedWarehouseId || connection.resolvedWarehouseId || "",
    inventorySampleCount: inventoryResult.inventory?.length || 0,
    orderSampleCount: orderResult.orders?.length || 0,
    message: orderResult.message || inventoryResult.message || "Connection test completed",
    suggestions: inventoryResult.ok && orderResult.ok ? [] : ["接口有返回但未完全通过，请检查仓库编码和接口权限。"],
  };
}

async function handleWarehouseTest(req, res) {
  if (!canManage(getAuth(req))) {
    sendJson(res, 401, { ok: false, message: "Testing warehouse connections requires direct admin login." });
    return;
  }
  const payload = await parseRequestBody(req);
  const existingIndex = payload.id ? warehouseConnections.findIndex((connection) => connection.id === payload.id) : -1;
  const result = await testWarehouseConnectionPayload(payload);
  if (existingIndex >= 0) {
    warehouseConnections[existingIndex] = {
      ...warehouseConnections[existingIndex],
      lastTestAt: new Date().toISOString(),
      lastTestStatus: result.ok ? "ok" : result.stage || "failed",
      lastTestMessage: result.message || "",
      resolvedWarehouseId: result.resolvedWarehouseId || warehouseConnections[existingIndex].resolvedWarehouseId || "",
    };
    saveWarehouseConnections();
  }
  sendJson(res, 200, {
    ...result,
    warehouses: warehouseConnections.map(sanitizeWarehouse),
  });
}

async function handleOrderSync(req, res) {
  if (!canManage(getAuth(req))) {
    sendJson(res, 401, { ok: false, message: "同步订单数据需要内部登录。" });
    return;
  }

  const requestUrl = new URL(req.url || "/", `http://${req.headers.host}`);
  const days = Math.max(1, Math.min(180, Number(requestUrl.searchParams.get("days") || 90)));
  const runningJob = latestOrderSyncJob();
  if (runningJob && ["queued", "running"].includes(runningJob.status)) {
    sendJson(res, 202, { ok: true, jobId: runningJob.id, job: publicOrderSyncJob(runningJob), reused: true });
    return;
  }
  const job = createOrderSyncJob({ days });
  startOrderSyncJob(job);
  sendJson(res, 202, { ok: true, jobId: job.id, job: publicOrderSyncJob(job) });
}

async function refreshOrderCache(days = 90) {
  const normalizedDays = Math.max(1, Math.min(180, Number(days) || 90));
  const results = [];
  const orders = [];

  const syncResults = await Promise.all(warehouseConnections.map(async (connection) => {
    let result;
    const syncPromise = syncWithSameSystemFallback(connection, (target) => syncWarehouseOrders(target, normalizedDays));
    try {
      result = await withTimeout(
        syncPromise,
        orderSyncTimeoutMs,
        `${connection.name || connection.id} 订单同步超过 ${Math.round(orderSyncTimeoutMs / 1000)} 秒，已转入后台继续同步。`,
      );
    } catch (error) {
      if (error.code === "SYNC_TIMEOUT") {
        syncPromise
          .then((lateResult) => mergeLateOrderSyncResult(connection, lateResult, normalizedDays))
          .catch((lateError) => console.error(`[orders-sync] background failed ${connection.name || connection.id}`, lateError));
      }
      result = {
        warehouseId: connection.id,
        ok: false,
        skipped: false,
        message: error.message || "订单同步失败",
        backgroundRunning: error.code === "SYNC_TIMEOUT",
        orders: [],
      };
    }
    return { connection, result };
  }));

  for (const { connection, result } of syncResults) {
    const orderMeta = orderSyncMetaFromResult(result);
    const warehouseId = result.warehouseId || connection.id;
    const cachedWarehouseOrders = (cachedOrdersSync.orders || []).filter((item) => item.warehouseId === warehouseId || item.warehouseId === connection.id);
    const visibleOrders = result.backgroundRunning ? cachedWarehouseOrders : (result.orders || []);
    results.push({
      warehouseId,
      ok: result.ok,
      skipped: result.skipped,
      message: result.message || "",
      orderCount: visibleOrders.length,
      hasCredentials: hasWarehouseCredentials(connection),
      backgroundRunning: Boolean(result.backgroundRunning),
      ...orderMeta,
    });
    orders.push(...visibleOrders);
    if (updateResolvedWarehouseId(connection, result)) saveWarehouseConnections();
  }

  cachedOrdersSync = {
    syncedAt: new Date().toISOString(),
    days: normalizedDays,
    orders,
    results,
  };
  saveOrderCache(cachedOrdersSync);
  return cachedOrdersSync;
}

function mergeLateOrderSyncResult(connection, result, days) {
  const warehouseId = result.warehouseId || connection.id;
  const orderMeta = orderSyncMetaFromResult(result);
  const nextResults = (cachedOrdersSync.results || []).filter((item) => item.warehouseId !== warehouseId && item.warehouseId !== connection.id);
  nextResults.push({
    warehouseId,
    ok: result.ok,
    skipped: result.skipped,
    message: result.message || "后台同步完成。",
    orderCount: result.orders?.length || 0,
    hasCredentials: hasWarehouseCredentials(connection),
    backgroundCompletedAt: new Date().toISOString(),
    ...orderMeta,
  });

  cachedOrdersSync = {
    ...cachedOrdersSync,
    syncedAt: new Date().toISOString(),
    days,
    orders: [
      ...(cachedOrdersSync.orders || []).filter((item) => item.warehouseId !== warehouseId && item.warehouseId !== connection.id),
      ...(result.orders || []),
    ],
    results: nextResults,
  };
  saveOrderCache(cachedOrdersSync);
  if (updateResolvedWarehouseId(connection, result)) saveWarehouseConnections();
  console.log(`[orders-sync] background completed ${connection.name || connection.id}: ${result.orders?.length || 0} orders`);
}

async function handleStockupSync(req, res) {
  if (!canManage(getAuth(req))) {
    sendJson(res, 401, { ok: false, message: "同步备货单明细需要内部登录。" });
    return;
  }

  const results = [];
  const orders = [];
  for (const connection of warehouseConnections) {
    let result;
    try {
      result = await syncWarehouseStockupOrders(connection);
    } catch (error) {
      result = {
        warehouseId: connection.id,
        warehouseName: connection.name,
        providerId: connection.providerId,
        ok: false,
        skipped: false,
        message: error.message || "备货单明细同步失败",
        docUrl: "",
        orders: [],
      };
    }
    results.push({
      warehouseId: result.warehouseId || connection.id,
      warehouseName: result.warehouseName || connection.name,
      providerId: result.providerId || connection.providerId,
      ok: result.ok,
      skipped: result.skipped,
      message: result.message || "",
      docUrl: result.docUrl || "",
      orderCount: result.orders?.length || 0,
      hasCredentials: hasWarehouseCredentials(connection),
    });
    orders.push(...(result.orders || []));
  }

  cachedStockupSync = {
    syncedAt: new Date().toISOString(),
    orders,
    results,
  };
  saveStockupCache(cachedStockupSync);

  sendJson(res, 200, buildCurrentStockupPayload({ notify: true, reason: "wms_sync" }));
}

function buildCurrentStockupPayload({ notify = false, reason = "refresh" } = {}) {
  const mergedProducts = mergeWarehouseDataIntoProducts(cachedProducts, cachedWarehouseSync);
  const movementPayload = buildMovementPayload(mergedProducts, cachedWarehouseSync, cachedOrdersSync);
  const payload = applyStockupDecisions(buildStockupPayload(movementPayload, cachedStockupSync, cachedOutsourcingOrders, cachedProducts));
  if (notify) void notifyStockupRecommendation(payload, reason);
  return payload;
}

function updateStockupDecision(payload, status) {
  const item = payload?.recommendation || payload || {};
  const key = String(payload?.recommendationKey || stockupRecommendationKey(item)).trim();
  if (!key) throw new Error("缺少备货建议标识。");
  cachedStockupDecisions.decisions = cachedStockupDecisions.decisions || {};
  if (status === "pending") {
    delete cachedStockupDecisions.decisions[key];
    saveStockupDecisionCache();
    return buildCurrentStockupPayload({ notify: false, reason: "decision_restore" });
  }
  cachedStockupDecisions.decisions[key] = {
    status,
    recommendationKey: key,
    sku: String(item.sku || "").trim(),
    country: String(item.country || "").trim(),
    name: String(item.name || "").trim(),
    replenishQty: numberOrZero(item.replenishQty),
    netReplenishQty: numberOrZero(item.netReplenishQty),
    note: String(payload?.note || "").trim(),
    updatedAt: new Date().toISOString(),
  };
  saveStockupDecisionCache();
  return buildCurrentStockupPayload({ notify: false, reason: `decision_${status}` });
}

function createStockupPlan(payload = {}) {
  const item = payload.recommendation || payload || {};
  const recommendationKey = String(payload.recommendationKey || stockupRecommendationKey(item)).trim();
  if (!recommendationKey) throw new Error("缺少备货建议标识。");
  const now = new Date().toISOString();
  const existing = (cachedStockupPlans.plans || []).find((plan) => plan.recommendationKey === recommendationKey && !["arrived", "cancelled"].includes(plan.status));
  if (existing) throw new Error("该备货建议已有未完成计划。");
  const plan = {
    id: stockupPlanId(),
    recommendationKey,
    sku: String(item.sku || payload.sku || "").trim(),
    country: String(item.country || payload.country || "").trim(),
    name: String(item.name || payload.name || "").trim(),
    unit: String(item.unit || payload.unit || "").trim(),
    quantity: Math.max(0, numberOrZero(payload.quantity || item.netReplenishQty || item.replenishQty)),
    planType: payload.planType === "outsourcing" ? "outsourcing" : "purchase",
    owner: String(payload.owner || "").trim(),
    expectedArrivalAt: String(payload.expectedArrivalAt || "").trim(),
    status: "draft",
    note: String(payload.note || "").trim(),
    source: "stockup",
    createdAt: now,
    updatedAt: now,
  };
  if (!plan.sku || !plan.quantity) throw new Error("创建备货计划需要 SKU 和计划数量。");
  cachedStockupPlans = normalizeStockupPlans({
    updatedAt: now,
    plans: [plan, ...(cachedStockupPlans.plans || [])],
  });
  saveStockupPlanCache();
  return plan;
}

function updateStockupPlanStatus(planId, status) {
  const allowed = new Set(["draft", "ordered", "in_production", "arrived", "cancelled"]);
  const nextStatus = allowed.has(status) ? status : "";
  if (!nextStatus) throw new Error("计划状态不正确。");
  const plan = (cachedStockupPlans.plans || []).find((item) => item.id === planId);
  if (!plan) throw new Error("备货计划不存在。");
  plan.status = nextStatus;
  plan.updatedAt = new Date().toISOString();
  saveStockupPlanCache();
  return plan;
}

async function handleSync(req, res) {
  if (!canManage(getAuth(req))) {
    sendJson(res, 401, { ok: false, message: "同步产品数据需要内部登录。" });
    return;
  }

  const result = await refreshProductCache();
  sendJson(res, 200, { ok: true, ...result });
}

async function refreshProductCache() {
  if (!hasJdyCredentials()) {
    cachedProducts = buildProductPayload(sampleProductBaseRecords, sampleCatalogRecords, "sample");
    saveProductCache(cachedProducts);
    return {
      warning: "未配置 JIANYUN_API_KEY，已使用样例数据。复制 .env.example 为 .env 后填入 API Key 即可同步真实数据。",
      ...filterProductPayload(cachedProducts, directAuth),
    };
  }

  const { baseRecords, catalogRecords } = await fetchAllJdyProducts();
  cachedProducts = buildProductPayload(baseRecords, catalogRecords, "jiandaoyun");
  saveProductCache(cachedProducts);
  return filterProductPayload(cachedProducts, directAuth);
}

async function handleQualificationSync(req, res) {
  if (!canManage(getAuth(req))) {
    sendJson(res, 401, { ok: false, message: "同步资质库需要内部登录。" });
    return;
  }

  const result = await refreshQualificationCache();
  sendJson(res, 200, result);
}

async function refreshQualificationCache() {
  if (!hasJdyCredentials()) {
    cachedQualifications = buildQualificationPayload([], "empty");
    saveQualificationCache(cachedQualifications);
    return {
      ...cachedQualifications,
      warning: "未配置 JIANYUN_API_KEY，暂未同步真实资质数据。",
    };
  }

  const records = await fetchAllJdyQualifications();
  cachedQualifications = buildQualificationPayload(records, "jiandaoyun");
  saveQualificationCache(cachedQualifications);
  void notifyQualificationExpiry(cachedQualifications, "qualification_sync");
  return cachedQualifications;
}

async function handleAssetSync(req, res) {
  if (!canManage(getAuth(req))) {
    sendJson(res, 401, { ok: false, message: "同步素材库需要内部登录。" });
    return;
  }

  const result = await refreshAssetCache();
  sendJson(res, 200, result);
}

async function refreshAssetCache() {
  if (!hasJdyCredentials()) {
    cachedAssets = buildAssetPayload([], "empty");
    saveAssetCache(cachedAssets);
    return {
      ...cachedAssets,
      warning: "未配置 JIANYUN_API_KEY，暂未同步真实素材数据。",
    };
  }

  const records = await fetchAllJdyAssets();
  cachedAssets = buildAssetPayload(records, "jiandaoyun");
  saveAssetCache(cachedAssets);
  return cachedAssets;
}

async function handleWarehouseInfoSync(req, res) {
  if (!canManage(getAuth(req))) {
    sendJson(res, 401, { ok: false, message: "同步仓库信息需要直营部门登录。" });
    return;
  }

  const result = await refreshWarehouseInfoCache();
  sendJson(res, 200, result);
}

async function refreshWarehouseInfoCache() {
  if (!hasJdyCredentials()) {
    cachedWarehouseInfo = buildWarehouseInfoPayload([], "empty");
    saveWarehouseInfoCache(cachedWarehouseInfo);
    return {
      ...cachedWarehouseInfo,
      warning: "未配置 JIANYUN_API_KEY，暂未同步真实仓库信息数据。",
    };
  }

  const records = await fetchAllJdyWarehouseInfo();
  cachedWarehouseInfo = buildWarehouseInfoPayload(records, "jiandaoyun");
  saveWarehouseInfoCache(cachedWarehouseInfo);
  return cachedWarehouseInfo;
}

async function refreshOutsourcingOrderCache() {
  if (!hasJdyCredentials()) {
    cachedOutsourcingOrders = buildOutsourcingOrderPayload([], "empty");
    saveOutsourcingOrderCache(cachedOutsourcingOrders);
    return {
      ...cachedOutsourcingOrders,
      warning: "未配置 JIANYUN_API_KEY，暂未同步真实委外加工单数据。",
    };
  }

  const records = await fetchAllJdyOutsourcingOrders();
  cachedOutsourcingOrders = buildOutsourcingOrderPayload(records, "jiandaoyun");
  saveOutsourcingOrderCache(cachedOutsourcingOrders);
  return cachedOutsourcingOrders;
}

async function handleQualificationFile(req, res, url) {
  const fileId = decodeURIComponent(url.pathname.replace("/api/qualifications/files/", ""));
  const template = process.env.JIANYUN_FILE_DOWNLOAD_TEMPLATE || "";
  if (!fileId) {
    sendJson(res, 400, { ok: false, message: "缺少资质附件文件 ID。" });
    return;
  }
  if (!template) {
    sendJson(res, 501, {
      ok: false,
      message: "当前系统附件只返回了文件 ID。请在 .env 配置文件下载地址模板后再直接下载，例如包含 {fileId} 的文件下载地址模板。",
    });
    return;
  }

  const apiKey = process.env.JIANYUN_API_KEY || "";
  const fileUrl = template.replace("{fileId}", encodeURIComponent(fileId));
  const response = await fetch(fileUrl, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
  if (!response.ok) {
    sendJson(res, response.status, { ok: false, message: `资质附件下载失败：${response.status}` });
    return;
  }

  const fileName = url.searchParams.get("name") || `${fileId}`;
  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const buffer = Buffer.from(await response.arrayBuffer());
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "Access-Control-Allow-Origin": "*",
  });
  res.end(buffer);
}

async function runAutoSync() {
  if (!autoSyncIntervalMs || autoSyncIntervalMs < 1000 || autoSyncRunning) return;
  autoSyncRunning = true;
  try {
    await refreshProductCache();
    await refreshQualificationCache();
    await refreshAssetCache();
    await refreshWarehouseInfoCache();
    await refreshOutsourcingOrderCache();
    const orderPayload = await refreshOrderCache(90);
    buildCurrentStockupPayload({ notify: true, reason: "auto_order_sync" });
    upsertMovementSnapshot(dateKeyInTimezone(new Date(), movementHistoryTimezone), "auto_sync", movementHistoryTimezone);
    lastAutoSyncAt = new Date().toISOString();
    console.log(`[auto-sync] refreshed products, qualifications, assets and ${orderPayload.orders.length} movement orders at ${lastAutoSyncAt}`);
  } catch (error) {
    console.error("[auto-sync] failed", error);
  } finally {
    autoSyncRunning = false;
  }
}

async function runScheduledInventorySnapshot() {
  if (scheduledInventorySnapshotRunning) return;
  const now = new Date();
  const date = dateKeyInTimezone(now);
  const minutes = minutesInTimezone(now);
  if (minutes < 180 || minutes >= 190 || lastScheduledInventorySnapshotDate === date) return;
  scheduledInventorySnapshotRunning = true;
  try {
    await refreshWarehouseInventoryForSnapshot("daily_3am");
    lastScheduledInventorySnapshotDate = date;
    console.log(`[inventory-snapshot] captured ${date} at ${new Date().toISOString()}`);
  } catch (error) {
    console.error("[inventory-snapshot] failed", error);
  } finally {
    scheduledInventorySnapshotRunning = false;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      sendJson(res, 200, { ok: true });
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (url.pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        source: cachedProducts.source,
        hasJdyCredentials: hasJdyCredentials(),
        productBaseForm: "6694ed87e77ca045d563d581 / 6756bedd6e3c85a3ea67d375",
        catalogForm: "6694ed87e77ca045d563d581 / 67f3d481b3fa6711aab2588f",
        qualificationForm: "6694ed87e77ca045d563d581 / 68ee195f8074d5854a7ebfb1",
        assetForm: "6694ed87e77ca045d563d581 / 68672aabdfae6388ba2e3ab5",
        warehouseInfoForm: "6694ed87e77ca045d563d581 / 6a2a8d48c3e061cc82bb27b7",
        outsourcingOrderForm: "67bc8e21da0d14f9f67224a5 / 67ce5652fb7c0d1442ddd88b",
        autoSyncIntervalMs,
        autoSyncIntervalMinutes: autoSyncIntervalMs ? Math.round(autoSyncIntervalMs / 60000) : 0,
        lastAutoSyncAt,
      });
      return;
    }

    if (url.pathname === "/api/dashboard-summary" && req.method === "GET") {
      sendJson(res, 200, buildDashboardSummary(getAuth(req)));
      return;
    }

    if ((url.pathname.startsWith("/api/ai/videos/") || url.pathname.startsWith("/ai-videos/")) && req.method === "GET") {
      const fileName = basename(decodeURIComponent(url.pathname.replace(/^\/(?:api\/ai\/videos|ai-videos)\//, "")));
      if (!/^[a-f0-9]{24}\.(mp4|webm|mov|m4v)$/i.test(fileName)) {
        sendJson(res, 400, { ok: false, message: "Invalid video file name." });
        return;
      }
      const filePath = resolve(aiVideoPublicDir, fileName);
      if (!existsSync(filePath)) {
        sendJson(res, 404, { ok: false, message: "Video not found." });
        return;
      }
      const stat = statSync(filePath);
      const range = req.headers.range;
      if (range) {
        const match = String(range).match(/bytes=(\d*)-(\d*)/);
        const start = match?.[1] ? Number(match[1]) : 0;
        const end = match?.[2] ? Number(match[2]) : stat.size - 1;
        if (start >= stat.size || end >= stat.size || start > end) {
          res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
          res.end();
          return;
        }
        res.writeHead(206, {
          "Content-Type": videoMimeFromExtension(fileName),
          "Content-Length": end - start + 1,
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=86400",
          "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        });
        createReadStream(filePath, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, {
        "Content-Type": videoMimeFromExtension(fileName),
        "Content-Length": stat.size,
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=86400",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      });
      createReadStream(filePath).pipe(res);
      return;
    }

    if (url.pathname === "/api/me" && req.method === "GET") {
      sendJson(res, 200, { ok: true, user: publicUser(getAuth(req).user) });
      return;
    }

    if (url.pathname === "/api/products/sync" && req.method === "POST") {
      await handleSync(req, res);
      return;
    }

    if (url.pathname === "/api/products") {
      const auth = getAuth(req);
      const mode = url.searchParams.get("mode") === "detail" ? "detail" : "list";
      sendJson(res, 200, {
        ok: true,
        ...productResponsePayload(cachedProducts, auth, mode),
      });
      return;
    }

    if (url.pathname === "/api/qualifications" && req.method === "GET") {
      if (!canViewPartnerAssets(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "查看资质库需要登录。" });
        return;
      }
      sendJson(res, 200, cachedQualifications);
      return;
    }

    if (url.pathname === "/api/qualifications/sync" && req.method === "POST") {
      await handleQualificationSync(req, res);
      return;
    }

    if (url.pathname.startsWith("/api/qualifications/files/") && req.method === "GET") {
      if (!canViewPartnerAssets(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "下载资质附件需要登录。" });
        return;
      }
      await handleQualificationFile(req, res, url);
      return;
    }

    if (url.pathname === "/api/assets" && req.method === "GET") {
      if (!canViewPartnerAssets(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "查看素材库需要登录。" });
        return;
      }
      sendJson(res, 200, cachedAssets);
      return;
    }

    if (url.pathname === "/api/assets/sync" && req.method === "POST") {
      await handleAssetSync(req, res);
      return;
    }

    if (url.pathname === "/api/warehouse-info" && req.method === "GET") {
      if (!canViewPartnerAssets(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "查看仓库信息需要登录。" });
        return;
      }
      sendJson(res, 200, cachedWarehouseInfo);
      return;
    }

    if (url.pathname === "/api/warehouse-info/sync" && req.method === "POST") {
      await handleWarehouseInfoSync(req, res);
      return;
    }

    if (url.pathname === "/api/quick-nav" && req.method === "GET") {
      sendJson(res, 200, buildQuickNavPayload(cachedQuickNav.categories || []));
      return;
    }

    if (url.pathname === "/api/action-log" && req.method === "GET") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "查看操作日志需要直营部门登录。" });
        return;
      }
      sendJson(res, 200, publicActionLog());
      return;
    }

    if (url.pathname === "/api/distributor-applications" && req.method === "GET") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "查看分销账号申请需要直营部门登录。" });
        return;
      }
      sendJson(res, 200, publicDistributorApplications());
      return;
    }

    if (url.pathname === "/api/distributor-applications" && req.method === "POST") {
      const payload = await parseRequestBody(req);
      const application = createDistributorApplication(payload);
      sendJson(res, 201, { ok: true, application });
      return;
    }

    const distributorApplicationStatusMatch = url.pathname.match(/^\/api\/distributor-applications\/([^/]+)\/status$/);
    if (distributorApplicationStatusMatch && req.method === "PATCH") {
      const auth = getAuth(req);
      if (!canManage(auth)) {
        sendJson(res, 401, { ok: false, message: "更新分销账号申请需要直营部门登录。" });
        return;
      }
      const payload = await parseRequestBody(req);
      const application = updateDistributorApplicationStatus(decodeURIComponent(distributorApplicationStatusMatch[1]), String(payload.status || ""));
      appendActionLog(auth, "更新分销账号申请状态", "distributor_application", application.companyName, {
        applicationId: application.id,
        status: application.status,
      });
      sendJson(res, 200, { ok: true, application, ...publicDistributorApplications() });
      return;
    }

    if (url.pathname === "/api/wecom-notifications" && req.method === "GET") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "查看企业微信通知配置需要直营部门登录。" });
        return;
      }
      sendJson(res, 200, publicWecomNotificationPayload());
      return;
    }

    if (url.pathname === "/api/wecom-notifications/robots" && req.method === "POST") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "配置企业微信机器人需要直营部门登录。" });
        return;
      }
      const payload = await parseRequestBody(req);
      const now = new Date().toISOString();
      const id = String(payload.id || "").trim();
      const existingRobot = (cachedWecomNotifications.robots || []).find((item) => item.id === id);
      const webhookInput = String(payload.webhookUrl || "").trim();
      let webhookUrl = existingRobot?.webhookUrl || "";
      if (webhookInput) {
        try {
          webhookUrl = normalizeWecomWebhook(webhookInput);
        } catch (error) {
          sendJson(res, 400, { ok: false, message: error.message || "企业微信机器人 webhook 地址格式不正确。" });
          return;
        }
      }
      const robot = {
        id: id || wecomId("robot"),
        name: String(payload.name || "").trim(),
        webhookUrl,
        enabled: payload.enabled !== false,
        createdAt: existingRobot?.createdAt || payload.createdAt || now,
        updatedAt: now,
        lastSentAt: existingRobot?.lastSentAt || payload.lastSentAt || "",
        lastError: existingRobot?.lastError || payload.lastError || "",
      };
      if (!robot.name || !robot.webhookUrl) {
        sendJson(res, 400, { ok: false, message: "机器人名称和 webhook 地址不能为空。" });
        return;
      }
      cachedWecomNotifications.robots = [
        ...(cachedWecomNotifications.robots || []).filter((item) => item.id !== robot.id),
        robot,
      ];
      cachedWecomNotifications.updatedAt = now;
      saveWecomNotificationCache();
      appendActionLog(getAuth(req), existingRobot ? "更新企业微信机器人" : "新增企业微信机器人", "wecom_robot", robot.name, {
        enabled: robot.enabled,
      });
      sendJson(res, 200, publicWecomNotificationPayload());
      return;
    }

    const wecomRobotMatch = url.pathname.match(/^\/api\/wecom-notifications\/robots\/([^/]+)$/);
    if (wecomRobotMatch && req.method === "DELETE") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "删除企业微信机器人需要直营部门登录。" });
        return;
      }
      const robotId = decodeURIComponent(wecomRobotMatch[1]);
      const deletedRobot = (cachedWecomNotifications.robots || []).find((robot) => robot.id === robotId);
      cachedWecomNotifications.robots = (cachedWecomNotifications.robots || []).filter((robot) => robot.id !== robotId);
      cachedWecomNotifications.schedules = (cachedWecomNotifications.schedules || []).map((schedule) => ({ ...schedule, robotIds: schedule.robotIds.filter((id) => id !== robotId) }));
      for (const scene of Object.values(cachedWecomNotifications.scenes || {})) {
        scene.robotIds = (scene.robotIds || []).filter((id) => id !== robotId);
      }
      cachedWecomNotifications.updatedAt = new Date().toISOString();
      saveWecomNotificationCache();
      appendActionLog(getAuth(req), "删除企业微信机器人", "wecom_robot", deletedRobot?.name || robotId, {
        robotId,
      });
      sendJson(res, 200, publicWecomNotificationPayload());
      return;
    }

    if (url.pathname === "/api/wecom-notifications/schedules" && req.method === "POST") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "配置定时通知需要直营部门登录。" });
        return;
      }
      const payload = await parseRequestBody(req);
      const now = new Date().toISOString();
      const schedule = {
        id: String(payload.id || wecomId("schedule")),
        name: String(payload.name || "").trim(),
        robotIds: Array.isArray(payload.robotIds) ? payload.robotIds.map(String).filter(Boolean) : [],
        enabled: payload.enabled !== false,
        mode: payload.mode === "interval" ? "interval" : "daily",
        time: String(payload.time || "09:00").trim(),
        intervalMinutes: Math.max(5, Math.min(1440, Number(payload.intervalMinutes) || 60)),
        text: String(payload.text || "").trim(),
        linkUrl: String(payload.linkUrl || "").trim(),
        linkText: String(payload.linkText || "查看详情").trim(),
        createdAt: payload.createdAt || now,
        updatedAt: now,
        lastSentAt: payload.lastSentAt || "",
        lastRunKey: payload.lastRunKey || "",
        lastError: payload.lastError || "",
      };
      if (!schedule.name || !schedule.robotIds.length || !schedule.text) {
        sendJson(res, 400, { ok: false, message: "定时通知名称、机器人和推送文字不能为空。" });
        return;
      }
      cachedWecomNotifications.schedules = [
        ...(cachedWecomNotifications.schedules || []).filter((item) => item.id !== schedule.id),
        schedule,
      ];
      cachedWecomNotifications.updatedAt = now;
      saveWecomNotificationCache();
      appendActionLog(getAuth(req), payload.id ? "更新定时推送" : "新增定时推送", "wecom_schedule", schedule.name, {
        enabled: schedule.enabled,
        mode: schedule.mode,
        robotCount: schedule.robotIds.length,
      });
      sendJson(res, 200, publicWecomNotificationPayload());
      return;
    }

    const wecomScheduleMatch = url.pathname.match(/^\/api\/wecom-notifications\/schedules\/([^/]+)$/);
    if (wecomScheduleMatch && req.method === "DELETE") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "删除定时通知需要直营部门登录。" });
        return;
      }
      const scheduleId = decodeURIComponent(wecomScheduleMatch[1]);
      const deletedSchedule = (cachedWecomNotifications.schedules || []).find((schedule) => schedule.id === scheduleId);
      cachedWecomNotifications.schedules = (cachedWecomNotifications.schedules || []).filter((schedule) => schedule.id !== scheduleId);
      cachedWecomNotifications.updatedAt = new Date().toISOString();
      saveWecomNotificationCache();
      appendActionLog(getAuth(req), "删除定时推送", "wecom_schedule", deletedSchedule?.name || scheduleId, {
        scheduleId,
      });
      sendJson(res, 200, publicWecomNotificationPayload());
      return;
    }

    if (url.pathname === "/api/wecom-notifications/scenes" && req.method === "POST") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "配置场景通知需要直营部门登录。" });
        return;
      }
      const payload = await parseRequestBody(req);
      cachedWecomNotifications.scenes = {
        ...cachedWecomNotifications.scenes,
        ...(payload.scenes || {}),
      };
      cachedWecomNotifications.updatedAt = new Date().toISOString();
      saveWecomNotificationCache();
      appendActionLog(getAuth(req), "更新企业微信场景配置", "wecom_scene", "场景推送", {
        sceneKeys: Object.keys(payload.scenes || {}),
      });
      sendJson(res, 200, publicWecomNotificationPayload());
      return;
    }

    if (url.pathname === "/api/wecom-notifications/operating-summary" && req.method === "POST") {
      const auth = getAuth(req);
      if (!canManage(auth)) {
        sendJson(res, 401, { ok: false, message: "发送今日经营摘要需要直营部门登录。" });
        return;
      }
      const payload = await parseRequestBody(req);
      const content = buildOperatingSummaryMarkdown({
        extraText: payload.extraText,
        linkUrl: payload.linkUrl,
        linkText: payload.linkText,
      });
      if (payload.dryRun === true) {
        sendJson(res, 200, { ok: true, content, results: [], ...publicWecomNotificationPayload() });
        return;
      }
      const selectedRobotIds = Array.isArray(payload.robotIds) ? payload.robotIds.map(String).filter(Boolean) : [];
      const enabledRobotIds = (cachedWecomNotifications.robots || []).filter((robot) => robot.enabled).map((robot) => robot.id);
      const robotIds = selectedRobotIds.length ? selectedRobotIds : enabledRobotIds;
      const activeRobotIds = robotIds.filter((id) => enabledRobotIds.includes(id));
      if (!activeRobotIds.length) {
        sendJson(res, 400, { ok: false, message: "请先选择至少一个已启用的企业微信机器人。" });
        return;
      }
      const results = await sendWecomNotification(activeRobotIds, content);
      const failed = results.filter((item) => !item.ok);
      appendActionLog(auth, "发送今日经营摘要", "wecom_summary", "今日经营摘要", {
        robotCount: activeRobotIds.length,
        failedCount: failed.length,
      });
      sendJson(res, 200, { ok: true, results, ...publicWecomNotificationPayload() });
      return;
    }

    if (url.pathname === "/api/wecom-notifications/test" && req.method === "POST") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "测试企业微信通知需要直营部门登录。" });
        return;
      }
      const payload = await parseRequestBody(req);
      const content = [
        "### 同舟供应链通知测试",
        String(payload.text || "这是一条企业微信机器人测试消息。").trim(),
        notificationLinkLine(payload.linkUrl, payload.linkText || "查看详情"),
      ].filter(Boolean).join("\n\n");
      const results = await sendWecomNotification(payload.robotIds || [], content);
      sendJson(res, 200, { ok: true, results, ...publicWecomNotificationPayload() });
      return;
    }

    if (url.pathname === "/api/quick-nav/categories" && req.method === "POST") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "创建快捷导航分类需要直营部门登录。" });
        return;
      }

      const payload = await parseRequestBody(req);
      const name = String(payload.name || "").trim();
      if (!name) {
        sendJson(res, 400, { ok: false, message: "分类名称不能为空。" });
        return;
      }

      const now = new Date().toISOString();
      const category = {
        id: quickNavId("cat"),
        name,
        description: String(payload.description || "").trim(),
        sortOrder: numberOrZero(payload.sortOrder),
        createdAt: now,
        updatedAt: now,
        links: [],
      };
      cachedQuickNav.categories = [
        ...(cachedQuickNav.categories || []),
        category,
      ];
      saveQuickNavCache();
      appendActionLog(getAuth(req), "新增快捷导航分类", "quick_nav_category", category.name, {
        categoryId: category.id,
      });
      sendJson(res, 201, cachedQuickNav);
      return;
    }

    const quickNavCategoryMatch = url.pathname.match(/^\/api\/quick-nav\/categories\/([^/]+)$/);
    if (quickNavCategoryMatch && req.method === "DELETE") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "删除快捷导航分类需要直营部门登录。" });
        return;
      }

      const categoryId = decodeURIComponent(quickNavCategoryMatch[1]);
      const deletedCategory = (cachedQuickNav.categories || []).find((category) => category.id === categoryId);
      const before = (cachedQuickNav.categories || []).length;
      cachedQuickNav.categories = (cachedQuickNav.categories || []).filter((category) => category.id !== categoryId);
      if ((cachedQuickNav.categories || []).length === before) {
        sendJson(res, 404, { ok: false, message: "分类不存在。" });
        return;
      }
      saveQuickNavCache();
      appendActionLog(getAuth(req), "删除快捷导航分类", "quick_nav_category", deletedCategory?.name || categoryId, {
        categoryId,
        linkCount: deletedCategory?.links?.length || 0,
      });
      sendJson(res, 200, cachedQuickNav);
      return;
    }

    const quickNavLinksMatch = url.pathname.match(/^\/api\/quick-nav\/categories\/([^/]+)\/links$/);
    if (quickNavLinksMatch && req.method === "POST") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "创建快捷方式需要直营部门登录。" });
        return;
      }

      const categoryId = decodeURIComponent(quickNavLinksMatch[1]);
      const category = (cachedQuickNav.categories || []).find((item) => item.id === categoryId);
      if (!category) {
        sendJson(res, 404, { ok: false, message: "分类不存在。" });
        return;
      }

      const payload = await parseRequestBody(req);
      const title = String(payload.title || "").trim();
      if (!title) {
        sendJson(res, 400, { ok: false, message: "快捷方式名称不能为空。" });
        return;
      }

      let safeUrl = "";
      try {
        safeUrl = normalizeQuickNavUrl(payload.url);
      } catch (error) {
        sendJson(res, 400, { ok: false, message: error.message || "链接格式不正确。" });
        return;
      }
      if (!safeUrl) {
        sendJson(res, 400, { ok: false, message: "链接不能为空。" });
        return;
      }

      const now = new Date().toISOString();
      const link = {
        id: quickNavId("link"),
        categoryId,
        title,
        url: safeUrl,
        description: String(payload.description || "").trim(),
        sortOrder: numberOrZero(payload.sortOrder),
        createdAt: now,
        updatedAt: now,
      };
      category.links = [
        ...(category.links || []),
        link,
      ];
      category.updatedAt = now;
      saveQuickNavCache();
      appendActionLog(getAuth(req), "新增快捷导航链接", "quick_nav_link", link.title, {
        categoryId,
        categoryName: category.name,
        linkId: link.id,
      });
      sendJson(res, 201, cachedQuickNav);
      return;
    }

    const quickNavLinkMatch = url.pathname.match(/^\/api\/quick-nav\/categories\/([^/]+)\/links\/([^/]+)$/);
    if (quickNavLinkMatch && req.method === "DELETE") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "删除快捷方式需要直营部门登录。" });
        return;
      }

      const categoryId = decodeURIComponent(quickNavLinkMatch[1]);
      const linkId = decodeURIComponent(quickNavLinkMatch[2]);
      const category = (cachedQuickNav.categories || []).find((item) => item.id === categoryId);
      if (!category) {
        sendJson(res, 404, { ok: false, message: "分类不存在。" });
        return;
      }
      const deletedLink = (category.links || []).find((link) => link.id === linkId);
      const before = (category.links || []).length;
      category.links = (category.links || []).filter((link) => link.id !== linkId);
      if (category.links.length === before) {
        sendJson(res, 404, { ok: false, message: "快捷方式不存在。" });
        return;
      }
      category.updatedAt = new Date().toISOString();
      saveQuickNavCache();
      appendActionLog(getAuth(req), "删除快捷导航链接", "quick_nav_link", deletedLink?.title || linkId, {
        categoryId,
        categoryName: category.name,
        linkId,
      });
      sendJson(res, 200, cachedQuickNav);
      return;
    }

    if (url.pathname === "/api/ai/config" && req.method === "GET") {
      sendJson(res, 200, publicAiConfigPayload());
      return;
    }

    if (url.pathname === "/api/ai/config" && req.method === "POST") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "配置同舟AI需要直营部门登录。" });
        return;
      }
      const payload = await parseRequestBody(req);
      cachedAiConfig = buildAiConfig({
        ...cachedAiConfig,
        baseUrl: payload.baseUrl || cachedAiConfig.baseUrl,
        apiKey: payload.apiKey === undefined ? cachedAiConfig.apiKey : String(payload.apiKey || "").trim(),
        models: {
          ...cachedAiConfig.models,
          ...(payload.models || {}),
        },
      });
      saveAiConfigCache();
      sendJson(res, 200, publicAiConfigPayload());
      return;
    }

    if (url.pathname.startsWith("/api/ai/uploads/") && req.method === "GET") {
      const fileName = decodeURIComponent(url.pathname.replace("/api/ai/uploads/", ""));
      if (!/^[a-z0-9-]+\.(png|jpg|jpeg|webp|gif)$/i.test(fileName)) {
        sendJson(res, 400, { ok: false, message: "文件名不正确。" });
        return;
      }
      const filePath = resolve(aiUploadDir, fileName);
      if (!existsSync(filePath)) {
        sendJson(res, 404, { ok: false, message: "图片不存在。" });
        return;
      }
      res.writeHead(200, {
        "Content-Type": mimeFromExtension(fileName),
        "Cache-Control": "public, max-age=86400",
      });
      res.end(readFileSync(filePath));
      return;
    }

    if (url.pathname === "/api/ai/uploads" && req.method === "POST") {
      if (!canViewPartnerAssets(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "上传同舟AI参考图需要登录。" });
        return;
      }
      const payload = await parseRequestBody(req);
      const upload = saveAiUpload(payload, req);
      sendJson(res, 201, { ok: true, upload });
      return;
    }

    if (url.pathname === "/api/ai/text/stream" && req.method === "POST") {
      const auth = getAuth(req);
      if (!canViewPartnerAssets(auth)) {
        sendJson(res, 401, { ok: false, message: "使用同舟AI需要登录。" });
        return;
      }
      const payload = await parseRequestBody(req);
      if (!aiMessagesFromPayload(payload, auth).length) {
        sendJson(res, 400, { ok: false, message: "请输入文本任务。" });
        return;
      }
      const directAnswer = aiDirectSafeContextAnswer(payload, auth);

      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });

      if (directAnswer) {
        sendSse(res, "delta", { delta: directAnswer });
        sendSse(res, "done", { ok: true, direct: true });
        res.end();
        return;
      }

      try {
        const model = String(payload.model || cachedAiConfig.models.text);
        const upstream = await requestAgnesStream("/chat/completions", aiChatPayload({ ...payload, stream: true }, model, auth));
        const upstreamType = upstream.headers.get("content-type") || "";
        if (upstreamType.includes("application/json")) {
          const data = await upstream.json();
          const answer = extractTextAnswer(data);
          if (answer) sendSse(res, "delta", { delta: answer });
          sendSse(res, "done", { ok: true });
          res.end();
          return;
        }
        const reader = upstream.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const raw = trimmed.replace(/^data:\s*/, "");
            if (!raw || raw === "[DONE]") continue;
            try {
              const parsed = JSON.parse(raw);
              const delta = extractStreamDelta(parsed);
              if (delta) sendSse(res, "delta", { delta });
            } catch {
              sendSse(res, "delta", { delta: raw });
            }
          }
        }
        sendSse(res, "done", { ok: true });
      } catch (error) {
        sendSse(res, "error", { message: error.message || "同舟AI 流式对话失败。" });
      } finally {
        res.end();
      }
      return;
    }

    if (url.pathname === "/api/ai/text" && req.method === "POST") {
      const auth = getAuth(req);
      if (!canViewPartnerAssets(auth)) {
        sendJson(res, 401, { ok: false, message: "使用同舟AI需要登录。" });
        return;
      }
      const payload = await parseRequestBody(req);
      const messages = aiMessagesFromPayload(payload, auth);
      if (!messages.length) {
        sendJson(res, 400, { ok: false, message: "请输入文本任务。" });
        return;
      }
      const directAnswer = aiDirectSafeContextAnswer(payload, auth);
      if (directAnswer) {
        sendJson(res, 200, {
          ok: true,
          model: "TZ-Context",
          answer: directAnswer,
          direct: true,
        });
        return;
      }
      const model = String(payload.model || cachedAiConfig.models.text);
      const data = await requestAgnes("/chat/completions", aiChatPayload(payload, model, auth));
      sendJson(res, 200, {
        ok: true,
        model,
        answer: extractTextAnswer(data),
        raw: data,
      });
      return;
    }

    if (url.pathname === "/api/ai/image" && req.method === "POST") {
      if (!canViewPartnerAssets(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "使用同舟AI需要登录。" });
        return;
      }
      const payload = await parseRequestBody(req);
      const prompt = String(payload.prompt || "").trim();
      if (!prompt) {
        sendJson(res, 400, { ok: false, message: "请输入图片提示词。" });
        return;
      }
      const model = String(payload.model || cachedAiConfig.models.image);
      const requestedCount = Math.max(1, Math.min(4, Number(payload.n) || 1));
      const referenceImages = normalizeAiReferenceImages(payload.referenceImages);
      const imagePrompt = aiReferencedProductPrompt(prompt, referenceImages.length);
      const imagePayload = {
        model,
        prompt: imagePrompt,
        size: payload.size || "1024x1024",
        n: 1,
        quality: payload.quality,
        seed: Number.isFinite(Number(payload.seed)) ? Number(payload.seed) : undefined,
        negative_prompt: payload.negativePrompt,
        ...aiImageReferencePayload(referenceImages),
      };
      const images = [];
      const droppedParams = new Set();
      let raw = null;
      const warnings = [];
      for (let index = 0; index < requestedCount; index += 1) {
        const perImagePayload = {
          ...imagePayload,
          seed: Number.isFinite(Number(payload.seed)) ? Number(payload.seed) + index : undefined,
        };
        let data;
        let dropped = [];
        if (referenceImages.length) {
          try {
            const editPayload = aiImageEditPayload(
              payload,
              model,
              perImagePayload.prompt,
              referenceImages,
            );
            const editResult = await requestAgnesWithUnsupportedParamRetry("/images/edits", editPayload);
            data = editResult.data;
            dropped = editResult.dropped;
          } catch (error) {
            warnings.push(error instanceof Error ? error.message : "Image edit request failed.");
            const generationResult = await requestAgnesWithUnsupportedParamRetry("/images/generations", perImagePayload);
            data = generationResult.data;
            dropped = generationResult.dropped;
          }
        } else {
          const generationResult = await requestAgnesWithUnsupportedParamRetry("/images/generations", perImagePayload);
          data = generationResult.data;
          dropped = generationResult.dropped;
        }
        raw = data;
        dropped.forEach((param) => droppedParams.add(param));
        images.push(...extractImageUrls(data));
      }
      sendJson(res, 200, {
        ok: true,
        model,
        images: images.slice(0, requestedCount),
        imageMode: referenceImages.length ? "reference-edit" : "generation",
        referenceCount: referenceImages.length,
        droppedParams: [...droppedParams],
        warnings: [...new Set(warnings)].filter(Boolean),
        raw,
      });
      return;
    }

    if (url.pathname === "/api/ai/video" && req.method === "POST") {
      if (!canViewPartnerAssets(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "使用同舟AI需要登录。" });
        return;
      }
      const payload = await parseRequestBody(req);
      const prompt = String(payload.prompt || "").trim();
      if (!prompt) {
        sendJson(res, 400, { ok: false, message: "请输入视频提示词。" });
        return;
      }
      const model = String(payload.model || cachedAiConfig.models.video);
      const referenceImages = normalizeAiReferenceImages(payload.referenceImages);
      const imageReferences = aiImageReferencePayload(referenceImages);
      const videoPayload = {
        model,
        prompt,
        duration: Number(payload.duration) || 5,
        aspect_ratio: payload.aspectRatio || "16:9",
        resolution: payload.resolution,
        seed: Number.isFinite(Number(payload.seed)) ? Number(payload.seed) : undefined,
        image_url: normalizeAiReferenceImages(payload.imageUrl)[0],
        image_urls: imageReferences.image_urls,
        reference_images: referenceImages.length ? referenceImages : undefined,
        reference_image: imageReferences.reference_image,
        input_image: imageReferences.input_image,
        first_frame_url: normalizeAiReferenceImages(payload.firstFrameUrl)[0],
        last_frame_url: normalizeAiReferenceImages(payload.lastFrameUrl)[0],
        negative_prompt: payload.negativePrompt,
        camera_control: payload.cameraControl,
        motion_strength: Number.isFinite(Number(payload.motionStrength)) ? Number(payload.motionStrength) : undefined,
      };
      const { data, dropped } = await requestAgnesWithUnsupportedParamRetry("/videos", videoPayload);
      const remoteVideoUrl = extractVideoUrl(data);
      let videoUrl = remoteVideoUrl;
      let downloadWarning = "";
      if (remoteVideoUrl) {
        try {
          videoUrl = await cacheAiVideoUrl(remoteVideoUrl);
        } catch (error) {
          downloadWarning = error instanceof Error ? error.message : "AI video download failed.";
        }
      }
      sendJson(res, 200, {
        ok: true,
        model,
        taskId: extractVideoTask(data),
        videoUrl,
        remoteVideoUrl,
        downloadWarning,
        droppedParams: dropped,
        status: data?.status || data?.data?.status || "submitted",
        raw: data,
      });
      return;
    }

    const aiVideoStatusMatch = url.pathname.match(/^\/api\/ai\/video\/([^/]+)$/);
    if (aiVideoStatusMatch && req.method === "GET") {
      if (!canViewPartnerAssets(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "使用同舟AI需要登录。" });
        return;
      }
      const taskId = decodeURIComponent(aiVideoStatusMatch[1]);
      const { data, path: statusPath, errors: statusWarnings } = await requestAgnesVideoStatus(taskId);
      const remoteVideoUrl = extractVideoUrl(data);
      let videoUrl = remoteVideoUrl;
      let downloadWarning = "";
      if (remoteVideoUrl) {
        try {
          videoUrl = await cacheAiVideoUrl(remoteVideoUrl);
        } catch (error) {
          downloadWarning = error instanceof Error ? error.message : "AI video download failed.";
        }
      }
      sendJson(res, 200, {
        ok: true,
        taskId,
        videoUrl,
        remoteVideoUrl,
        downloadWarning,
        status: extractVideoStatus(data),
        statusPath,
        statusWarnings,
        raw: data,
      });
      return;
    }

    if (url.pathname === "/api/users" && req.method === "GET") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "查看用户管理需要直营部门登录。" });
        return;
      }
      sendJson(res, 200, publicUsersPayload());
      return;
    }

    if (url.pathname === "/api/users" && req.method === "POST") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "创建用户需要直营部门登录。" });
        return;
      }
      const payload = await parseRequestBody(req);
      const username = String(payload.username || "").trim();
      if ((cachedUsers.users || []).some((user) => String(user.username).toLowerCase() === username.toLowerCase())) {
        sendJson(res, 409, { ok: false, message: "账号已存在。" });
        return;
      }

      const user = createLocalUser({
        username,
        password: payload.password,
        displayName: payload.displayName,
        role: payload.role,
      });

      try {
        user.jdyDataId = await syncUserToJdy(user, payload.password);
        user.jdySyncedAt = new Date().toISOString();
      } catch (error) {
        user.jdySyncError = error.message || "同步同舟供应链数智化系统失败";
      }

      cachedUsers.users = [user, ...(cachedUsers.users || [])];
      cachedUsers.syncedAt = new Date().toISOString();
      saveUsersCache();
      appendActionLog(getAuth(req), "创建用户", "user", user.displayName || user.username, {
        userId: user.id,
        username: user.username,
        role: user.role,
        jdySynced: Boolean(user.jdyDataId),
      });

      sendJson(res, user.jdySyncError ? 202 : 201, {
        ok: true,
        user: publicUser(user),
        warning: user.jdySyncError || "",
        ...publicUsersPayload(),
      });
      return;
    }

    const userStatusMatch = url.pathname.match(/^\/api\/users\/([^/]+)\/status$/);
    if (userStatusMatch && req.method === "PATCH") {
      const auth = getAuth(req);
      if (!canManage(auth)) {
        sendJson(res, 401, { ok: false, message: "停用或启用用户需要直营部门登录。" });
        return;
      }

      const userId = decodeURIComponent(userStatusMatch[1]);
      const payload = await parseRequestBody(req);
      const nextStatus = payload.status === "disabled" ? "disabled" : "active";
      const users = cachedUsers.users || [];
      const user = users.find((item) => item.id === userId);
      if (!user) {
        sendJson(res, 404, { ok: false, message: "用户不存在。" });
        return;
      }
      if (auth.user?.id === user.id && nextStatus === "disabled") {
        sendJson(res, 400, { ok: false, message: "不能停用当前登录账号。" });
        return;
      }
      if (user.role === "direct" && user.status !== "disabled" && nextStatus === "disabled" && activeDirectCount(users) <= 1) {
        sendJson(res, 400, { ok: false, message: "至少需要保留一个启用的直营部门账号。" });
        return;
      }

      user.status = nextStatus;
      user.updatedAt = new Date().toISOString();
      user.jdySyncError = "";
      try {
        await syncUserStatusToJdy(user);
        user.jdySyncedAt = new Date().toISOString();
      } catch (error) {
        user.jdySyncError = error.message || "同步同舟供应链数智化系统状态失败";
      }

      cachedUsers.syncedAt = new Date().toISOString();
      saveUsersCache();
      appendActionLog(auth, nextStatus === "disabled" ? "停用用户" : "启用用户", "user", user.displayName || user.username, {
        userId: user.id,
        username: user.username,
        status: nextStatus,
      });
      sendJson(res, user.jdySyncError ? 202 : 200, {
        ok: true,
        user: publicUser(user),
        warning: user.jdySyncError || "",
        ...publicUsersPayload(),
      });
      return;
    }

    const userDeleteMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
    if (userDeleteMatch && req.method === "DELETE") {
      const auth = getAuth(req);
      if (!canManage(auth)) {
        sendJson(res, 401, { ok: false, message: "删除用户需要直营部门登录。" });
        return;
      }

      const userId = decodeURIComponent(userDeleteMatch[1]);
      const users = cachedUsers.users || [];
      const user = users.find((item) => item.id === userId);
      if (!user) {
        sendJson(res, 404, { ok: false, message: "用户不存在。" });
        return;
      }
      if (auth.user?.id === user.id) {
        sendJson(res, 400, { ok: false, message: "不能删除当前登录账号。" });
        return;
      }
      if (user.role === "direct" && user.status !== "disabled" && activeDirectCount(users) <= 1) {
        sendJson(res, 400, { ok: false, message: "至少需要保留一个启用的直营部门账号。" });
        return;
      }

      cachedUsers.users = users.filter((item) => item.id !== user.id);
      cachedUsers.syncedAt = new Date().toISOString();
      let warning = "";
      try {
        await deleteUserFromJdy(user);
      } catch (error) {
        warning = error.message || "同步删除系统账号失败";
      }
      saveUsersCache();
      appendActionLog(auth, "删除用户", "user", user.displayName || user.username, {
        userId: user.id,
        username: user.username,
        role: user.role,
      });
      sendJson(res, warning ? 202 : 200, {
        ok: true,
        deletedId: user.id,
        warning,
        ...publicUsersPayload(),
      });
      return;
    }

    if (url.pathname === "/api/outsourcing-orders" && req.method === "GET") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "查看委外加工单需要直营部门登录。" });
        return;
      }
      sendJson(res, 200, cachedOutsourcingOrders);
      return;
    }

    if (url.pathname === "/api/outsourcing-orders/sync" && req.method === "POST") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "同步委外加工单需要内部登录。" });
        return;
      }
      const result = await refreshOutsourcingOrderCache();
      sendJson(res, 200, result);
      return;
    }

    if (url.pathname === "/api/warehouses" && req.method === "GET") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "查看仓库授权需要直营部门登录。" });
        return;
      }
      const mergedProducts = mergeWarehouseDataIntoProducts(cachedProducts, cachedWarehouseSync);
      sendJson(res, 200, {
        ok: true,
        providers: WMS_PROVIDERS,
        warehouses: warehouseConnections.map(sanitizeWarehouse),
        lastSync: {
          syncedAt: cachedWarehouseSync.syncedAt,
          results: cachedWarehouseSync.results,
          imageCount: cachedWarehouseSync.products.filter((item) => item.imageUrl).length,
          inventoryCount: cachedWarehouseSync.inventory.length,
          warehouseOnlyInventory: mergedProducts.warehouseOnlyInventory?.slice(0, 50) || [],
          warehouseOnlyCount: mergedProducts.counts?.warehouseOnlyInventory || 0,
          productMissingWarehouseCount: mergedProducts.counts?.productMissingWarehouse || 0,
          productMissingWarehouseItems: (mergedProducts.catalog || [])
            .filter((product) => product.dataGap === "warehouse_missing")
            .slice(0, 100)
            .map((product) => ({
              id: product.id,
              sku: product.sku,
              countrySku: product.countrySku,
              name: product.name,
              country: product.country,
              channel: product.channel,
              category: product.category,
              status: product.status,
              stockQty: product.stockQty,
              unit: product.unit,
            })),
        },
        nextRequiredSecrets: [
          "俄罗斯 YunWMS: appKey / appToken / warehouseCode",
          "SEA WMS: 各国家 baseUrl / clientId / clientSecret / warehouseCode",
        ],
      });
      return;
    }

    if (url.pathname === "/api/warehouses/sync" && req.method === "POST") {
      await handleWarehouseSync(req, res);
      return;
    }

    if (url.pathname === "/api/warehouses/test" && req.method === "POST") {
      await handleWarehouseTest(req, res);
      return;
    }

    if (url.pathname === "/api/inventory-snapshots" && req.method === "GET") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "查看库存快照需要直营部门登录。" });
        return;
      }
      sendJson(res, 200, inventorySnapshotPayload(url.searchParams.get("date") || ""));
      return;
    }

    if (url.pathname === "/api/inventory-snapshots/capture" && req.method === "POST") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "生成库存快照需要直营部门登录。" });
        return;
      }
      const snapshot = upsertInventorySnapshot(dateKeyInTimezone(), "manual");
      sendJson(res, 200, { ok: true, snapshot, ...inventorySnapshotPayload(snapshot.date) });
      return;
    }

    if (url.pathname === "/api/inventory-snapshots/export" && req.method === "GET") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "导出库存快照需要直营部门登录。" });
        return;
      }
      const payload = inventorySnapshotPayload(url.searchParams.get("date") || "");
      if (!payload.snapshot) {
        sendJson(res, 404, { ok: false, message: "没有找到该日期的库存快照。" });
        return;
      }
      const warehouseId = url.searchParams.get("warehouseId") || "";
      const snapshot = warehouseId
        ? { ...payload.snapshot, rows: (payload.snapshot.rows || []).filter((row) => row.warehouseId === warehouseId) }
        : payload.snapshot;
      const csv = inventorySnapshotCsv(snapshot);
      const suffix = warehouseId ? `-${warehouseId}` : "";
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`inventory-snapshot-${payload.snapshot.date}${suffix}.csv`)}`,
        "Access-Control-Allow-Origin": "*",
      });
      res.end(csv);
      return;
    }

    if (url.pathname === "/api/movement-history" && req.method === "GET") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "查看动销历史需要直营部门登录。" });
        return;
      }
      sendJson(res, 200, movementHistoryPayload({
        date: url.searchParams.get("date") || "",
        from: url.searchParams.get("from") || "",
        to: url.searchParams.get("to") || "",
        warehouseId: url.searchParams.get("warehouseId") || "",
        sku: url.searchParams.get("sku") || "",
        timezone: url.searchParams.get("timezone") || "",
      }));
      return;
    }

    if (url.pathname === "/api/movement-history/capture" && req.method === "POST") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "生成动销快照需要直营部门登录。" });
        return;
      }
      const payload = await parseRequestBody(req);
      const timezone = safeTimezone(payload.timezone || url.searchParams.get("timezone") || "", movementHistoryTimezone);
      const date = String(payload.date || url.searchParams.get("date") || dateKeyInTimezone(new Date(), timezone)).trim();
      const snapshot = upsertMovementSnapshot(date, "manual", timezone);
      sendJson(res, 200, { ok: true, snapshot, ...movementHistoryPayload({ date: snapshot.date, timezone }) });
      return;
    }

    if (url.pathname === "/api/movement-history/export" && req.method === "GET") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "导出动销历史需要直营部门登录。" });
        return;
      }
      const params = {
        date: url.searchParams.get("date") || "",
        from: url.searchParams.get("from") || "",
        to: url.searchParams.get("to") || "",
        warehouseId: url.searchParams.get("warehouseId") || "",
        sku: url.searchParams.get("sku") || "",
        timezone: url.searchParams.get("timezone") || "",
      };
      const snapshots = movementHistorySnapshotsInRange(params);
      if (!snapshots.length) {
        sendJson(res, 404, { ok: false, message: "没有找到可导出的动销历史。" });
        return;
      }
      const csv = movementHistoryCsv(snapshots, params);
      const range = params.date || [params.from, params.to].filter(Boolean).join("_") || "all";
      const suffix = [params.warehouseId, params.sku].filter(Boolean).join("-");
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`movement-history-${range}${suffix ? `-${suffix}` : ""}.csv`)}`,
        "Access-Control-Allow-Origin": "*",
      });
      res.end(csv);
      return;
    }

    if (url.pathname === "/api/warehouses/export" && req.method === "GET") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "导出仓库配置需要内部登录。" });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        version: 1,
        exportedAt: new Date().toISOString(),
        warehouses: warehouseConnections,
      });
      return;
    }

    if (url.pathname === "/api/warehouses/import" && req.method === "POST") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "导入仓库配置需要内部登录。" });
        return;
      }

      const payload = await parseRequestBody(req);
      const importedWarehouses = Array.isArray(payload) ? payload : payload.warehouses;
      if (!Array.isArray(importedWarehouses)) {
        sendJson(res, 400, { ok: false, message: "导入文件格式不正确，请提供 warehouses 数组。" });
        return;
      }

      let importedCount = 0;
      for (const imported of importedWarehouses) {
        if (!imported || typeof imported !== "object") continue;
        const existingIndex = warehouseConnections.findIndex((connection) => connection.id === imported.id);
        if (existingIndex >= 0) {
          warehouseConnections[existingIndex] = buildWarehouseConnection(imported, warehouseConnections[existingIndex]);
        } else {
          warehouseConnections.push(buildWarehouseConnection(imported));
        }
        importedCount += 1;
      }
      saveWarehouseConnections();
      appendActionLog(getAuth(req), "导入仓库配置", "warehouse", "仓库配置批量导入", {
        importedCount,
      });
      sendJson(res, 200, {
        ok: true,
        importedCount,
        warehouses: warehouseConnections.map(sanitizeWarehouse),
      });
      return;
    }

    if (url.pathname === "/api/orders/sync" && req.method === "POST") {
      await handleOrderSync(req, res);
      return;
    }

    if (url.pathname === "/api/order-analysis" && req.method === "GET") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "查看订单分析需要直营部门登录。" });
        return;
      }
      sendJson(res, 200, buildOrderAnalysisPayload({
        dateFrom: url.searchParams.get("dateFrom") || "",
        dateTo: url.searchParams.get("dateTo") || "",
        country: url.searchParams.get("country") || "",
        warehouseId: url.searchParams.get("warehouseId") || "",
        platform: url.searchParams.get("platform") || "",
        shopName: url.searchParams.get("shopName") || "",
        projectGroup: url.searchParams.get("projectGroup") || "",
        providerId: url.searchParams.get("providerId") || "",
        keyword: url.searchParams.get("keyword") || "",
        onlyRussia: url.searchParams.get("scope") !== "all",
      }));
      return;
    }

    if (url.pathname === "/api/orders/sync-jobs" && req.method === "POST") {
      const auth = getAuth(req);
      if (!canManage(auth)) {
        sendJson(res, 401, { ok: false, message: "Creating order sync jobs requires direct admin login." });
        return;
      }
      const payload = await parseRequestBody(req);
      const runningJob = latestOrderSyncJob();
      if (runningJob && ["queued", "running"].includes(runningJob.status)) {
        sendJson(res, 202, { ok: true, jobId: runningJob.id, job: publicOrderSyncJob(runningJob), reused: true });
        return;
      }
      const warehouseIds = Array.isArray(payload.warehouseIds) ? payload.warehouseIds : [];
      const unknownWarehouseIds = unknownOrderSyncWarehouseIds(warehouseIds);
      if (unknownWarehouseIds.length) {
        sendJson(res, 400, { ok: false, message: `未找到仓库：${unknownWarehouseIds.join(", ")}` });
        return;
      }
      const job = createOrderSyncJob({
        days: payload.days || 90,
        warehouseIds,
      });
      startOrderSyncJob(job);
      const selectedNames = job.warehouseIds
        .map((id) => warehouseConnections.find((warehouse) => warehouse.id === id)?.name || id)
        .filter(Boolean);
      appendActionLog(auth, selectedNames.length === 1 ? "重同步单仓订单" : "重同步订单", "order_sync", selectedNames.length === 1 ? selectedNames[0] : "订单同步任务", {
        days: job.days,
        warehouseCount: selectedNames.length,
        warehouses: selectedNames,
      });
      sendJson(res, 202, { ok: true, jobId: job.id, job: publicOrderSyncJob(job) });
      return;
    }

    if (url.pathname === "/api/orders/sync-jobs/latest" && req.method === "GET") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "Reading order sync jobs requires direct admin login." });
        return;
      }
      sendJson(res, 200, { ok: true, job: publicOrderSyncJob(latestOrderSyncJob()) });
      return;
    }

    if (url.pathname === "/api/stockup" && req.method === "GET") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "查看备货中心需要直营部门登录。" });
        return;
      }
      let outsourcingWarning = "";
      try {
        await refreshOutsourcingOrderCache();
      } catch (error) {
        outsourcingWarning = error.message || "委外加工单实时同步失败，当前显示上一次缓存数据。";
      }
      const stockupPayload = buildCurrentStockupPayload({ notify: true, reason: "page_refresh" });
      sendJson(res, 200, outsourcingWarning ? { ...stockupPayload, warning: outsourcingWarning } : stockupPayload);
      return;
    }

    if (url.pathname === "/api/stockup/sync" && req.method === "POST") {
      await handleStockupSync(req, res);
      return;
    }

    if (url.pathname === "/api/stockup/recommendations/accept" && req.method === "POST") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "采纳备货建议需要直营部门登录。" });
        return;
      }
      const payload = await parseRequestBody(req);
      const result = updateStockupDecision(payload, "accepted");
      const item = payload?.recommendation || payload || {};
      appendActionLog(getAuth(req), "采纳备货建议", "stockup_recommendation", String(item.sku || item.countrySku || payload?.recommendationKey || "").trim(), {
        recommendationKey: payload?.recommendationKey || stockupRecommendationKey(item),
        country: item.country,
        replenishQty: item.replenishQty,
        netReplenishQty: item.netReplenishQty,
      });
      sendJson(res, 200, result);
      return;
    }

    if (url.pathname === "/api/stockup/recommendations/abandon" && req.method === "POST") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "放弃备货建议需要直营部门登录。" });
        return;
      }
      const payload = await parseRequestBody(req);
      const result = updateStockupDecision(payload, "abandoned");
      const item = payload?.recommendation || payload || {};
      appendActionLog(getAuth(req), "放弃备货建议", "stockup_recommendation", String(item.sku || item.countrySku || payload?.recommendationKey || "").trim(), {
        recommendationKey: payload?.recommendationKey || stockupRecommendationKey(item),
        country: item.country,
        replenishQty: item.replenishQty,
        netReplenishQty: item.netReplenishQty,
      });
      sendJson(res, 200, result);
      return;
    }

    if (url.pathname === "/api/stockup/recommendations/restore" && req.method === "POST") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "恢复备货建议需要直营部门登录。" });
        return;
      }
      const payload = await parseRequestBody(req);
      const result = updateStockupDecision(payload, "pending");
      const item = payload?.recommendation || payload || {};
      appendActionLog(getAuth(req), "恢复备货建议", "stockup_recommendation", String(item.sku || item.countrySku || payload?.recommendationKey || "").trim(), {
        recommendationKey: payload?.recommendationKey || stockupRecommendationKey(item),
        country: item.country,
      });
      sendJson(res, 200, result);
      return;
    }

    if (url.pathname === "/api/stockup/plans" && req.method === "POST") {
      const auth = getAuth(req);
      if (!canManage(auth)) {
        sendJson(res, 401, { ok: false, message: "创建备货计划需要直营部门登录。" });
        return;
      }
      const payload = await parseRequestBody(req);
      const plan = createStockupPlan(payload);
      appendActionLog(auth, "创建备货计划", "stockup_plan", plan.sku, {
        planId: plan.id,
        recommendationKey: plan.recommendationKey,
        quantity: plan.quantity,
        planType: plan.planType,
        owner: plan.owner,
        expectedArrivalAt: plan.expectedArrivalAt,
      });
      sendJson(res, 201, buildCurrentStockupPayload({ notify: false, reason: "plan_create" }));
      return;
    }

    const stockupPlanStatusMatch = url.pathname.match(/^\/api\/stockup\/plans\/([^/]+)\/status$/);
    if (stockupPlanStatusMatch && req.method === "PATCH") {
      const auth = getAuth(req);
      if (!canManage(auth)) {
        sendJson(res, 401, { ok: false, message: "更新备货计划需要直营部门登录。" });
        return;
      }
      const payload = await parseRequestBody(req);
      const plan = updateStockupPlanStatus(decodeURIComponent(stockupPlanStatusMatch[1]), String(payload.status || ""));
      appendActionLog(auth, "更新备货计划状态", "stockup_plan", plan.sku, {
        planId: plan.id,
        recommendationKey: plan.recommendationKey,
        status: plan.status,
      });
      sendJson(res, 200, buildCurrentStockupPayload({ notify: false, reason: "plan_status" }));
      return;
    }

    if (url.pathname === "/api/movement" && req.method === "GET") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "查看动销分析需要直营部门登录。" });
        return;
      }
      sendJson(res, 200, movementResponsePayload());
      return;
    }

    if (url.pathname.startsWith("/api/warehouses/") && req.method === "DELETE") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "删除仓库需要内部登录。" });
        return;
      }

      const warehouseId = decodeURIComponent(url.pathname.replace("/api/warehouses/", ""));
      const index = warehouseConnections.findIndex((connection) => connection.id === warehouseId);
      if (index < 0) {
        sendJson(res, 404, { ok: false, message: "仓库不存在。" });
        return;
      }

      const [deleted] = warehouseConnections.splice(index, 1);
      saveWarehouseConnections();
      pruneWarehouseCaches([deleted.id]);
      appendActionLog(getAuth(req), "删除仓库授权", "warehouse", deleted.name || deleted.id, {
        warehouseId: deleted.id,
        country: deleted.country,
        providerId: deleted.providerId,
      });
      sendJson(res, 200, { ok: true, deletedId: deleted.id, warehouses: warehouseConnections.map(sanitizeWarehouse) });
      return;
    }

    if (url.pathname.startsWith("/api/warehouses/") && req.method === "POST") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "更新仓库需要内部登录。" });
        return;
      }

      const warehouseId = decodeURIComponent(url.pathname.replace("/api/warehouses/", ""));
      const index = warehouseConnections.findIndex((connection) => connection.id === warehouseId);
      if (index < 0) {
        sendJson(res, 404, { ok: false, message: "仓库不存在。" });
        return;
      }

      const payload = await parseRequestBody(req);
      warehouseConnections[index] = buildWarehouseConnection(payload, warehouseConnections[index]);
      saveWarehouseConnections();
      appendActionLog(getAuth(req), "更新仓库授权", "warehouse", warehouseConnections[index].name || warehouseConnections[index].id, {
        warehouseId: warehouseConnections[index].id,
        country: warehouseConnections[index].country,
        providerId: warehouseConnections[index].providerId,
      });
      sendJson(res, 200, { ok: true, warehouse: sanitizeWarehouse(warehouseConnections[index]), warehouses: warehouseConnections.map(sanitizeWarehouse) });
      return;
    }

    if (url.pathname === "/api/warehouses" && req.method === "POST") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "新增仓库需要内部登录。" });
        return;
      }

      const payload = await parseRequestBody(req);
      const connection = buildWarehouseConnection(payload);

      warehouseConnections = [connection, ...warehouseConnections];
      saveWarehouseConnections();
      appendActionLog(getAuth(req), "新增仓库授权", "warehouse", connection.name || connection.id, {
        warehouseId: connection.id,
        country: connection.country,
        providerId: connection.providerId,
      });
      sendJson(res, 201, { ok: true, warehouse: sanitizeWarehouse(connection), warehouses: warehouseConnections.map(sanitizeWarehouse) });
      return;
    }

    if (url.pathname === "/api/setup" && req.method === "GET") {
      sendJson(res, 200, setupStatusPayload());
      return;
    }

    if (url.pathname === "/api/setup/admin" && req.method === "POST") {
      if (!setupStatusPayload().setupRequired) {
        sendJson(res, 409, { ok: false, message: "系统已存在直营管理员，初始化入口已关闭。" });
        return;
      }
      const payload = await parseRequestBody(req);
      if ((cachedUsers.users || []).some((user) => String(user.username).toLowerCase() === String(payload.username || "").trim().toLowerCase())) {
        sendJson(res, 409, { ok: false, message: "账号已存在。" });
        return;
      }
      const user = createInitialAdmin(payload);
      sendJson(res, 201, {
        ok: true,
        token: createSessionToken(user, sessionSecret),
        user: publicUser(user),
        setup: setupStatusPayload(),
      });
      return;
    }

    if (url.pathname === "/api/login" && req.method === "POST") {
      const payload = await parseRequestBody(req);
      if (payload.code && internalAccessCode && payload.code === internalAccessCode) {
        const user = directAuth.user;
        sendJson(res, 200, {
          ok: true,
          token: createSessionToken(user, sessionSecret),
          user: publicUser(user),
        });
        return;
      }
      if (Object.prototype.hasOwnProperty.call(payload, "code") && String(payload.code || "").trim()) {
        sendJson(res, 401, { ok: false, message: "内部访问码不正确。" });
        return;
      }

      const username = String(payload.username || "").trim();
      const password = String(payload.password || "");
      if (!username || !password) {
        sendJson(res, 400, { ok: false, message: "请输入账号和密码。" });
        return;
      }

      const user = authenticateLocalUser(cachedUsers.users || [], username, password);
      if (!user || user.role === "guest") {
        sendJson(res, 401, { ok: false, message: "账号、密码或角色无效。" });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        token: createSessionToken(user, sessionSecret),
        user: publicUser(user),
      });
      return;
    }

    if (serveDistFallback(req, res, url)) return;
    sendJson(res, 404, { ok: false, message: "Not found" });
  } catch (error) {
    sendJson(res, 500, { ok: false, message: error.message });
  }
});

server.listen(port, () => {
  console.log(`Tongzhou API server listening on http://localhost:${port}`);
  if (autoSyncIntervalMs >= 1000) {
    setInterval(runAutoSync, autoSyncIntervalMs);
    console.log(`[auto-sync] enabled every ${Math.round(autoSyncIntervalMs / 60000)} minutes`);
    runAutoSync();
  }
  setInterval(runScheduledInventorySnapshot, 60 * 1000);
  setInterval(runWecomSchedules, 60 * 1000);
  runScheduledInventorySnapshot();
  runWecomSchedules();
});
