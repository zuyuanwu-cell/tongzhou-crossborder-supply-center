import http from "node:http";
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createJdyData, deleteJdyData, fetchAllJdyAssets, fetchAllJdyOutsourcingOrders, fetchAllJdyProducts, fetchAllJdyQualifications, hasJdyCredentials, updateJdyData } from "./jiandaoyun-client.js";
import { buildProductPayload } from "./normalize-products.js";
import { buildQualificationPayload } from "./normalize-qualifications.js";
import { buildAssetPayload } from "./normalize-assets.js";
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
const orderCachePath = resolve(cacheDir, "orders-sync.json");
const warehouseConnectionsPath = resolve(cacheDir, "warehouse-connections.json");
const qualificationCachePath = resolve(cacheDir, "qualifications.json");
const assetCachePath = resolve(cacheDir, "assets.json");
const stockupCachePath = resolve(cacheDir, "stockup-sync.json");
const outsourcingOrderCachePath = resolve(cacheDir, "outsourcing-orders.json");
const usersCachePath = resolve(cacheDir, "users.json");
const autoSyncIntervalMs = Number(process.env.AUTO_SYNC_INTERVAL_MS || 10 * 60 * 1000);
let cachedProducts = loadProductCache() || buildProductPayload(sampleProductBaseRecords, sampleCatalogRecords, "sample");
let cachedWarehouseSync = loadJsonCache(warehouseCachePath) || { syncedAt: "", products: [], inventory: [], results: [] };
let cachedOrdersSync = loadJsonCache(orderCachePath) || { syncedAt: "", orders: [], results: [] };
let cachedStockupSync = loadJsonCache(stockupCachePath) || { syncedAt: "", orders: [], results: [] };
let warehouseConnections = loadJsonCache(warehouseConnectionsPath) || WAREHOUSE_CONNECTIONS;
let cachedQualifications = loadJsonCache(qualificationCachePath) || buildQualificationPayload([], "empty");
let cachedAssets = loadJsonCache(assetCachePath) || buildAssetPayload([], "empty");
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

function saveOutsourcingOrderCache(payload) {
  saveJsonCache(outsourcingOrderCachePath, payload);
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
    throw new Error("未配置简道云 API Key，用户已保存在本地，但未同步到简道云。");
  }
  const payload = await createJdyData(JIANYUN_FORMS.userAccounts, jdyUserRecordData(user, plainPassword));
  return payload?.data?._id || payload?.data_id || payload?._id || payload?.id || "";
}

async function syncUserStatusToJdy(user) {
  if (!hasJdyCredentials()) {
    throw new Error("未配置简道云 API Key，用户状态已保存到本地，但未同步到简道云。");
  }
  if (!JIANYUN_FORMS.userAccounts.fields.status) {
    throw new Error("未配置 USER_ACCOUNT_STATUS_FIELD，用户状态已保存到本地，但未同步到简道云。");
  }
  await updateJdyData(JIANYUN_FORMS.userAccounts, user.jdyDataId, jdyUserStatusData(user));
}

async function deleteUserFromJdy(user) {
  if (!hasJdyCredentials()) {
    throw new Error("未配置简道云 API Key，用户已从本地删除，但未同步删除到简道云。");
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
      .map(({ directPrice, directCurrency, directCostPrice, directCostCurrency, raw, ...product }) => stripInventory(product));
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
  sendJson(res, 200, { ok: true, ...cachedWarehouseSync, products: undefined, inventory: undefined });
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

  const mergedProducts = mergeWarehouseDataIntoProducts(cachedProducts, cachedWarehouseSync);
  const movementPayload = buildMovementPayload(mergedProducts, cachedWarehouseSync, cachedOrdersSync);
  sendJson(res, 200, buildStockupPayload(movementPayload, cachedStockupSync, cachedOutsourcingOrders, cachedProducts));
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
      message: "当前简道云附件只返回了文件 ID。请在 .env 配置 JIANYUN_FILE_DOWNLOAD_TEMPLATE 后再直接下载，例如包含 {fileId} 的文件下载地址模板。",
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
    await refreshOutsourcingOrderCache();
    lastAutoSyncAt = new Date().toISOString();
    console.log(`[auto-sync] refreshed products, qualifications and assets at ${lastAutoSyncAt}`);
  } catch (error) {
    console.error("[auto-sync] failed", error);
  } finally {
    autoSyncRunning = false;
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
        user.jdySyncError = error.message || "同步简道云失败";
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
        user.jdySyncError = error.message || "同步简道云状态失败";
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
        warning = error.message || "同步删除简道云失败";
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
      const mergedProducts = mergeWarehouseDataIntoProducts(cachedProducts, cachedWarehouseSync);
      const movementPayload = buildMovementPayload(mergedProducts, cachedWarehouseSync, cachedOrdersSync);
      sendJson(res, 200, buildStockupPayload(movementPayload, cachedStockupSync, cachedOutsourcingOrders, cachedProducts));
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
});
