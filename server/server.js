import http from "node:http";
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { createJdyData, deleteJdyData, fetchAllJdyAssets, fetchAllJdyOutsourcingOrders, fetchAllJdyProducts, fetchAllJdyQualifications, fetchAllJdyWarehouseInfo, hasJdyCredentials, updateJdyData } from "./jiandaoyun-client.js";
import { buildProductPayload } from "./normalize-products.js";
import { buildQualificationPayload } from "./normalize-qualifications.js";
import { buildAssetPayload } from "./normalize-assets.js";
import { buildWarehouseInfoPayload } from "./normalize-warehouse-info.js";
import { buildOutsourcingOrderPayload } from "./normalize-outsourcing-orders.js";
import { sampleCatalogRecords, sampleProductBaseRecords } from "./sample-data.js";
import { JIANYUN_FORMS } from "./field-mapping.js";
import { WAREHOUSE_CONNECTIONS, WMS_PROVIDERS } from "./warehouse-config.js";
import { buildMovementPayload } from "./movement-analytics.js";
import { buildStockupPayload } from "./stockup-center.js";
import { mergeWarehouseDataIntoProducts, syncWarehouseConnection, syncWarehouseOrders, syncWarehouseStockupOrders } from "./wms-adapters.js";
import { authenticateLocalUser, createLocalUser, createSessionToken, jdyUserRecordData, jdyUserStatusData, publicUser, verifySessionToken } from "./user-auth.js";

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
const productCachePath = resolve(cacheDir, "products.json");
const warehouseCachePath = resolve(cacheDir, "warehouse-sync.json");
const inventorySnapshotCachePath = resolve(cacheDir, "inventory-snapshots.json");
const orderCachePath = resolve(cacheDir, "orders-sync.json");
const warehouseConnectionsPath = resolve(cacheDir, "warehouse-connections.json");
const qualificationCachePath = resolve(cacheDir, "qualifications.json");
const assetCachePath = resolve(cacheDir, "assets.json");
const warehouseInfoCachePath = resolve(cacheDir, "warehouse-info.json");
const quickNavCachePath = resolve(cacheDir, "quick-nav.json");
const aiConfigCachePath = resolve(cacheDir, "ai-config.json");
const wecomNotificationCachePath = resolve(cacheDir, "wecom-notifications.json");
const aiUploadDir = resolve(cacheDir, "ai-uploads");
const stockupCachePath = resolve(cacheDir, "stockup-sync.json");
const outsourcingOrderCachePath = resolve(cacheDir, "outsourcing-orders.json");
const usersCachePath = resolve(cacheDir, "users.json");
const autoSyncIntervalMs = Number(process.env.AUTO_SYNC_INTERVAL_MS || 10 * 60 * 1000);
const inventorySnapshotTimezone = process.env.INVENTORY_SNAPSHOT_TIMEZONE || "Asia/Shanghai";
let cachedProducts = loadProductCache() || buildProductPayload(sampleProductBaseRecords, sampleCatalogRecords, "sample");
let cachedWarehouseSync = loadJsonCache(warehouseCachePath) || { syncedAt: "", products: [], inventory: [], results: [] };
let cachedInventorySnapshots = loadJsonCache(inventorySnapshotCachePath) || { updatedAt: "", lastSnapshotAt: "", snapshots: [] };
let cachedOrdersSync = loadJsonCache(orderCachePath) || { syncedAt: "", orders: [], results: [] };
let cachedStockupSync = loadJsonCache(stockupCachePath) || { syncedAt: "", orders: [], results: [] };
let warehouseConnections = loadJsonCache(warehouseConnectionsPath) || WAREHOUSE_CONNECTIONS;
let cachedQualifications = loadJsonCache(qualificationCachePath) || buildQualificationPayload([], "empty");
let cachedAssets = loadJsonCache(assetCachePath) || buildAssetPayload([], "empty");
let cachedWarehouseInfo = loadJsonCache(warehouseInfoCachePath) || buildWarehouseInfoPayload([], "empty");
let cachedQuickNav = loadJsonCache(quickNavCachePath) || buildQuickNavPayload([]);
let cachedAiConfig = loadJsonCache(aiConfigCachePath) || buildAiConfig({});
let cachedWecomNotifications = loadJsonCache(wecomNotificationCachePath) || buildWecomNotificationPayload({});
let cachedOutsourcingOrders = loadJsonCache(outsourcingOrderCachePath) || buildOutsourcingOrderPayload([], "empty");
const internalAccessCode = process.env.INTERNAL_ACCESS_CODE || "admin123";
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

function saveOrderCache(payload) {
  saveJsonCache(orderCachePath, payload);
}

function saveStockupCache(payload) {
  saveJsonCache(stockupCachePath, payload);
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
      enabled: Boolean(input.scenes?.stockupRecommendation?.enabled),
      robotIds: Array.isArray(input.scenes?.stockupRecommendation?.robotIds) ? input.scenes.stockupRecommendation.robotIds.map(String).filter(Boolean) : [],
      linkUrl: String(input.scenes?.stockupRecommendation?.linkUrl || "").trim(),
      extraText: String(input.scenes?.stockupRecommendation?.extraText || "").trim(),
      lastSignature: input.scenes?.stockupRecommendation?.lastSignature || "",
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

async function notifyStockupRecommendation(payload, reason = "refresh") {
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
  const items = data?.data || data?.images || data?.output || [];
  return (Array.isArray(items) ? items : [items])
    .map((item) => item?.url || item?.image_url || item?.b64_json || item)
    .filter(Boolean);
}

function extractVideoTask(data) {
  return data?.task_id || data?.id || data?.data?.task_id || data?.data?.id || "";
}

function extractVideoUrl(data) {
  return data?.video_url
    || data?.url
    || data?.data?.video_url
    || data?.data?.url
    || data?.output?.video_url
    || data?.output?.url
    || data?.result?.video_url
    || data?.result?.url
    || "";
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

  const admin = createLocalUser({
    username: process.env.DEFAULT_ADMIN_USERNAME || "admin",
    password: process.env.DEFAULT_ADMIN_PASSWORD || internalAccessCode || "admin123",
    displayName: process.env.DEFAULT_ADMIN_NAME || "管理员",
    role: "direct",
  });
  const seeded = {
    ok: true,
    source: "local",
    syncedAt: new Date().toISOString(),
    users: [admin],
  };
  saveJsonCache(usersCachePath, seeded);
  return seeded;
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

function updateResolvedWarehouseId(connection, result) {
  if (!result?.resolvedWarehouseId) return false;
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
    skuMatched: existingConnection?.skuMatched || 0,
    syncScope: payload.syncScope?.length ? payload.syncScope : existingConnection?.syncScope || ["库存同步", "订单出库日报", "动销监控"],
    credentials: {
      appKey: payload.appKey || credentials.appKey || existingConnection?.credentials?.appKey || "",
      appSecret: payload.appSecret || credentials.appSecret || existingConnection?.credentials?.appSecret || "",
      clientId: payload.clientId || credentials.clientId || existingConnection?.credentials?.clientId || "",
      clientSecret: payload.clientSecret || credentials.clientSecret || existingConnection?.credentials?.clientSecret || "",
      token: payload.token || credentials.token || existingConnection?.credentials?.token || "",
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

function getAuth(req) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
  const sessionUser = verifySessionToken(token, sessionSecret);
  if (sessionUser) {
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

async function handleOrderSync(req, res) {
  if (!canManage(getAuth(req))) {
    sendJson(res, 401, { ok: false, message: "同步订单数据需要内部登录。" });
    return;
  }

  const days = Math.max(1, Math.min(180, Number(new URL(req.url || "/", `http://${req.headers.host}`).searchParams.get("days") || 90)));
  const results = [];
  const orders = [];

  for (const connection of warehouseConnections) {
    let result;
    try {
      result = await syncWithSameSystemFallback(connection, (target) => syncWarehouseOrders(target, days));
    } catch (error) {
      result = {
        warehouseId: connection.id,
        ok: false,
        skipped: false,
        message: error.message || "订单同步失败",
        orders: [],
      };
    }
    results.push({
      warehouseId: result.warehouseId,
      ok: result.ok,
      skipped: result.skipped,
      message: result.message || "",
      orderCount: result.orders.length,
      hasCredentials: hasWarehouseCredentials(connection),
    });
    orders.push(...result.orders);
    if (updateResolvedWarehouseId(connection, result)) saveWarehouseConnections();
  }

  cachedOrdersSync = {
    syncedAt: new Date().toISOString(),
    days,
    orders,
    results,
  };
  saveOrderCache(cachedOrdersSync);
  sendJson(res, 200, { ok: true, ...cachedOrdersSync, orders: undefined });
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
  const payload = buildStockupPayload(movementPayload, cachedStockupSync, cachedOutsourcingOrders, cachedProducts);
  if (notify) void notifyStockupRecommendation(payload, reason);
  return payload;
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
    lastAutoSyncAt = new Date().toISOString();
    console.log(`[auto-sync] refreshed products, qualifications and assets at ${lastAutoSyncAt}`);
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
      sendJson(res, 200, {
        ok: true,
        ...filterProductPayload(cachedProducts, auth),
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
      cachedWecomNotifications.robots = (cachedWecomNotifications.robots || []).filter((robot) => robot.id !== robotId);
      cachedWecomNotifications.schedules = (cachedWecomNotifications.schedules || []).map((schedule) => ({ ...schedule, robotIds: schedule.robotIds.filter((id) => id !== robotId) }));
      for (const scene of Object.values(cachedWecomNotifications.scenes || {})) {
        scene.robotIds = (scene.robotIds || []).filter((id) => id !== robotId);
      }
      cachedWecomNotifications.updatedAt = new Date().toISOString();
      saveWecomNotificationCache();
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
      cachedWecomNotifications.schedules = (cachedWecomNotifications.schedules || []).filter((schedule) => schedule.id !== scheduleId);
      cachedWecomNotifications.updatedAt = new Date().toISOString();
      saveWecomNotificationCache();
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
      sendJson(res, 200, publicWecomNotificationPayload());
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
      cachedQuickNav.categories = [
        ...(cachedQuickNav.categories || []),
        {
          id: quickNavId("cat"),
          name,
          description: String(payload.description || "").trim(),
          sortOrder: numberOrZero(payload.sortOrder),
          createdAt: now,
          updatedAt: now,
          links: [],
        },
      ];
      saveQuickNavCache();
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
      const before = (cachedQuickNav.categories || []).length;
      cachedQuickNav.categories = (cachedQuickNav.categories || []).filter((category) => category.id !== categoryId);
      if ((cachedQuickNav.categories || []).length === before) {
        sendJson(res, 404, { ok: false, message: "分类不存在。" });
        return;
      }
      saveQuickNavCache();
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
      category.links = [
        ...(category.links || []),
        {
          id: quickNavId("link"),
          categoryId,
          title,
          url: safeUrl,
          description: String(payload.description || "").trim(),
          sortOrder: numberOrZero(payload.sortOrder),
          createdAt: now,
          updatedAt: now,
        },
      ];
      category.updatedAt = now;
      saveQuickNavCache();
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
      const before = (category.links || []).length;
      category.links = (category.links || []).filter((link) => link.id !== linkId);
      if (category.links.length === before) {
        sendJson(res, 404, { ok: false, message: "快捷方式不存在。" });
        return;
      }
      category.updatedAt = new Date().toISOString();
      saveQuickNavCache();
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
      const imagePayload = {
        model,
        prompt,
        size: payload.size || "1024x1024",
        n: 1,
        quality: payload.quality,
        seed: Number.isFinite(Number(payload.seed)) ? Number(payload.seed) : undefined,
        negative_prompt: payload.negativePrompt,
        reference_images: Array.isArray(payload.referenceImages) ? payload.referenceImages.filter(Boolean) : undefined,
      };
      const images = [];
      const droppedParams = new Set();
      let raw = null;
      for (let index = 0; index < requestedCount; index += 1) {
        const perImagePayload = {
          ...imagePayload,
          seed: Number.isFinite(Number(payload.seed)) ? Number(payload.seed) + index : undefined,
        };
        const { data, dropped } = await requestAgnesWithUnsupportedParamRetry("/images/generations", perImagePayload);
        raw = data;
        dropped.forEach((param) => droppedParams.add(param));
        images.push(...extractImageUrls(data));
      }
      sendJson(res, 200, {
        ok: true,
        model,
        images: images.slice(0, requestedCount),
        droppedParams: [...droppedParams],
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
      const referenceImages = Array.isArray(payload.referenceImages) ? payload.referenceImages.filter(Boolean) : [];
      const data = await requestAgnes("/videos", compactPayload({
        model,
        prompt,
        duration: Number(payload.duration) || 5,
        aspect_ratio: payload.aspectRatio || "16:9",
        resolution: payload.resolution,
        seed: Number.isFinite(Number(payload.seed)) ? Number(payload.seed) : undefined,
        image_url: payload.imageUrl,
        reference_images: referenceImages.length ? referenceImages : undefined,
        first_frame_url: payload.firstFrameUrl,
        last_frame_url: payload.lastFrameUrl,
        negative_prompt: payload.negativePrompt,
        camera_control: payload.cameraControl,
        motion_strength: Number.isFinite(Number(payload.motionStrength)) ? Number(payload.motionStrength) : undefined,
      }));
      sendJson(res, 200, {
        ok: true,
        model,
        taskId: extractVideoTask(data),
        videoUrl: extractVideoUrl(data),
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
      const data = await requestAgnes(`/videos/${encodeURIComponent(taskId)}`, null, { method: "GET" });
      sendJson(res, 200, {
        ok: true,
        taskId,
        videoUrl: extractVideoUrl(data),
        status: data?.status || data?.data?.status || data?.result?.status || "",
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
        },
        nextRequiredSecrets: [
          "俄罗斯 YunWMS: appKey / appSecret / warehouseCode",
          "SEA WMS: 各国家 baseUrl / clientId / clientSecret / warehouseCode",
        ],
      });
      return;
    }

    if (url.pathname === "/api/warehouses/sync" && req.method === "POST") {
      await handleWarehouseSync(req, res);
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

    if (url.pathname === "/api/movement" && req.method === "GET") {
      if (!canManage(getAuth(req))) {
        sendJson(res, 401, { ok: false, message: "查看动销分析需要直营部门登录。" });
        return;
      }
      const mergedProducts = mergeWarehouseDataIntoProducts(cachedProducts, cachedWarehouseSync);
      sendJson(res, 200, buildMovementPayload(mergedProducts, cachedWarehouseSync, cachedOrdersSync));
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
      sendJson(res, 201, { ok: true, warehouse: sanitizeWarehouse(connection), warehouses: warehouseConnections.map(sanitizeWarehouse) });
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
  }
  setInterval(runScheduledInventorySnapshot, 60 * 1000);
  setInterval(runWecomSchedules, 60 * 1000);
  runScheduledInventorySnapshot();
  runWecomSchedules();
});
