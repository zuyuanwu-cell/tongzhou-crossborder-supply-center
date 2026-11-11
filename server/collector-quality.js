// 数据质量：让店铺日报的采集数据「不用人工核对」。
// - 证据：每次采集每个店铺每天的接口原始返回摘要、页面核对结果（与 Shopee 后台页面显示的数字比对）、截图；
// - 判定：缺失、缺字段、Shopee 还没出数、页面不一致、逻辑矛盾、与妙手订单差异、异常波动、旧口径；
// - 自动处理：给负责该店铺的采集节点下发补采命令（限次、间隔），处理不了的列为「需要人工处理」并写清楚怎么做。
// 状态用 JSON 文件持久化（摘要），证据明细与截图按日期分目录存放，默认保留 45 天。

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const QUALITY_FIELDS = Object.freeze(["payAmount", "orderCount", "visitors", "impressions", "addToCart", "adOnsite"]);
export const FIELD_LABELS = Object.freeze({
  payAmount: "支付金额",
  orderCount: "订单数",
  visitors: "访客数",
  impressions: "曝光",
  addToCart: "加购",
  adOnsite: "站内广告费",
});

// 站点时区（小时）。用于判断某个站点的「昨天」是否已经结束。
const SITE_OFFSET_HOURS = Object.freeze({ ID: 7, TH: 7, VN: 7, MY: 8, PH: 8, SG: 8, TW: 8, CN: 8, BR: -3, MX: -6, CO: -5, CL: -3 });
const COUNTRY_SITE = Object.freeze({
  印度尼西亚: "ID", 印尼: "ID", 泰国: "TH", 越南: "VN", 马来西亚: "MY", 马来: "MY", 菲律宾: "PH", 新加坡: "SG",
  台湾: "TW", 中国台湾: "TW", 巴西: "BR", 墨西哥: "MX", 哥伦比亚: "CO", 智利: "CL",
});

export const DEFAULT_QUALITY_SETTINGS = Object.freeze({
  autoBackfill: true,
  pageCheck: true,
  screenshot: true,
  windowDays: 7,
  legacyRefreshDays: 31,
  maxAttemptsPerDay: 3,
  retryGapMinutes: 90,
  notReadyGapMinutes: 120,
  retentionDays: 45,
  // 北京时间几点以后才自动补采「最近一天」（让每天的定时采集先跑）。
  latestDayStartHour: 10,
});

const STATUS_ORDER = Object.freeze(["missing", "error", "incomplete", "pending", "refresh", "warning", "ok", "verified"]);
export const STATUS_LABELS = Object.freeze({
  missing: "缺失",
  error: "有误",
  incomplete: "缺字段",
  pending: "等 Shopee 出数",
  refresh: "旧口径待补采",
  warning: "需留意",
  ok: "已采集",
  verified: "已核验",
});

const MANUAL_PATTERNS = Object.freeze([
  {
    code: "ziniao_device",
    test: /未绑定设备|错误码[:：]?\s*104|launch data/i,
    title: "紫鸟账号未绑定设备",
    action: "在紫鸟客户端里把这个店铺授权给这台采集电脑（或在紫鸟后台给子账号绑定设备），完成后在数据质量里点「立即补采」。",
  },
  {
    code: "shopee_login",
    test: /未登录|NOT_LOGGED_IN|signin|登录卖家中心/i,
    title: "Shopee 卖家中心掉登录",
    action: "在这台采集电脑的紫鸟里打开该店铺，登录 Shopee 卖家中心，完成后点「立即补采」。",
  },
  {
    code: "shopee_captcha",
    test: /安全验证|captcha/i,
    title: "Shopee 要求安全验证",
    action: "在这台采集电脑的紫鸟窗口里手动完成验证，完成后点「立即补采」。",
  },
]);

function text(value, max = 300) {
  return String(value ?? "").trim().slice(0, max);
}

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

export function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function siteOf(value) {
  const raw = text(value, 40);
  if (!raw) return "";
  const upper = raw.toUpperCase();
  if (SITE_OFFSET_HOURS[upper] !== undefined) return upper;
  return COUNTRY_SITE[raw] || "";
}

export function siteToday(site, nowMs) {
  const offset = SITE_OFFSET_HOURS[site] ?? 8;
  return new Date(nowMs + offset * 3600 * 1000).toISOString().slice(0, 10);
}

function shanghaiHour(nowMs) {
  return new Date(nowMs + 8 * 3600 * 1000).getUTCHours();
}

function median(list) {
  const sorted = [...list].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function cellKey(shopKey, date) {
  return `${shopKey}|${date}`;
}

function fileKey(shopKey) {
  return createHash("sha256").update(String(shopKey)).digest("hex").slice(0, 24);
}

function manualFromMessage(message) {
  const value = String(message || "");
  return MANUAL_PATTERNS.find((pattern) => pattern.test.test(value)) || null;
}

function sanitizePageCheck(check) {
  if (!check || typeof check !== "object") return null;
  const fields = {};
  for (const field of ["payAmount", "orderCount", "visitors"]) {
    const item = check.fields?.[field];
    if (!item) continue;
    fields[field] = { page: num(item.page), pageText: text(item.pageText, 40), collected: num(item.collected), match: Boolean(item.match) };
  }
  return {
    at: text(check.at, 40),
    date: isDate(check.date) ? check.date : "",
    status: ["match", "mismatch", "unchecked"].includes(check.status) ? check.status : "unchecked",
    message: text(check.message, 300),
    orderType: text(check.orderType, 60),
    fields,
  };
}

/**
 * 单元格判定（纯函数，便于测试）。
 * metric：店铺日报这一天的数据；evidence：采集证据摘要；system：妙手订单汇总；history：前 14 天同口径数据。
 */
export function evaluateCell({ metric = null, evidence = null, system = null, history = [] } = {}) {
  const issues = [];
  if (!metric) {
    return { status: "missing", issues: [{ code: "missing", level: "error", message: "没有采集到这一天的数据" }], verified: false };
  }
  const sources = metric.fieldSources || {};
  const collectedFields = QUALITY_FIELDS.filter((field) => sources[field] === "ziniao");
  const missingFields = QUALITY_FIELDS.filter((field) => num(metric[field]) === null);
  const notReady = new Set(Array.isArray(evidence?.notReady) ? evidence.notReady : []);
  const pendingFields = missingFields.filter((field) => notReady.has(field));
  const lackingFields = missingFields.filter((field) => !notReady.has(field) && (collectedFields.length || evidence));
  if (!collectedFields.length && !evidence) {
    issues.push({ code: "missing", level: "error", message: "只有人工录入的数据，没有采集数据" });
  }
  if (lackingFields.length) issues.push({ code: "incomplete", level: "incomplete", message: `缺少：${lackingFields.map((field) => FIELD_LABELS[field]).join("、")}` });
  if (pendingFields.length) issues.push({ code: "not_ready", level: "pending", message: `${pendingFields.map((field) => FIELD_LABELS[field]).join("、")}：Shopee 还没生成这一天的数据（一般当地中午后出数），会自动补采` });
  const version = Number(evidence?.templateVersion) || 0;
  if (sources.visitors === "ziniao" && version < 2) {
    issues.push({ code: "legacy", level: "refresh", message: "访客数是旧口径（只算了店铺页访客），会按新口径自动补采" });
  }
  const page = evidence?.pageCheck || null;
  if (page?.status === "mismatch") {
    const detail = Object.entries(page.fields || {}).filter(([, item]) => !item.match)
      .map(([field, item]) => `${FIELD_LABELS[field] || field}：采集 ${item.collected} / 后台页面 ${item.pageText || item.page}`).join("；");
    issues.push({ code: "page_mismatch", level: "error", message: `与 Shopee 后台页面不一致：${detail}` });
  }
  const orders = num(metric.orderCount);
  const pay = num(metric.payAmount);
  const visitors = num(metric.visitors);
  const cart = num(metric.addToCart);
  if (QUALITY_FIELDS.some((field) => (num(metric[field]) ?? 0) < 0)) issues.push({ code: "rule", level: "error", message: "有负数" });
  if (orders > 0 && pay === 0) issues.push({ code: "rule", level: "error", message: "有订单但支付金额为 0" });
  if (pay > 0 && orders === 0) issues.push({ code: "rule", level: "error", message: "有支付金额但订单数为 0" });
  if (version >= 2 && visitors > 0 && orders > visitors) issues.push({ code: "rule_warn", level: "warning", message: "订单数大于访客数" });
  if (version >= 2 && visitors > 0 && cart > visitors * 1.2) issues.push({ code: "rule_warn", level: "warning", message: "加购人数大于访客数" });
  if (system && orders !== null) {
    const other = Number(system.orderCount) || 0;
    const diff = Math.abs(orders - other);
    const tolerance = Math.max(3, Math.ceil(Math.max(orders, other) * 0.25));
    if (diff > tolerance) issues.push({ code: "miaoshou_diff", level: "warning", message: `订单数：采集 ${orders} / 妙手 ${other}（时区或口径差异也会造成，供参考）` });
  }
  for (const field of ["visitors", "payAmount", "impressions"]) {
    const value = num(metric[field]);
    const prior = history.map((row) => num(row?.[field])).filter((item) => item !== null);
    if (value === null || prior.length < 5) continue;
    const mid = median(prior);
    if (mid >= 30 && (value < mid * 0.15 || value > mid * 8)) {
      issues.push({ code: "anomaly", level: "warning", message: `${FIELD_LABELS[field]} ${value} 与近 14 天中位数 ${Math.round(mid)} 相差很大，已自动重采确认` });
    }
  }
  const verified = page?.status === "match";
  // 已与后台页面核对一致时，妙手订单差异只作提示，不降级。
  const levels = new Set(issues.filter((issue) => !(verified && issue.code === "miaoshou_diff")).map((issue) => issue.level));
  const status = levels.has("error") ? "error"
    : levels.has("incomplete") ? "incomplete"
      : levels.has("pending") ? "pending"
        : levels.has("refresh") ? "refresh"
          : levels.has("warning") ? "warning"
            : verified ? "verified" : "ok";
  return { status, issues, verified };
}

/** 需要自动补采的单元格：返回补采原因（null 表示不需要）。 */
function backfillReason(cell) {
  if (["missing", "incomplete", "error"].includes(cell.status)) return { reason: cell.status, maxAttempts: null };
  if (cell.status === "pending") return { reason: "not_ready", maxAttempts: 4, notReady: true };
  if (cell.status === "refresh") return { reason: "legacy", maxAttempts: 1 };
  if (cell.issues.some((issue) => issue.code === "anomaly")) return { reason: "anomaly", maxAttempts: 1 };
  return null;
}

function emptyState() {
  return { version: 1, settings: { ...DEFAULT_QUALITY_SETTINGS }, evidence: {}, storeKeys: {}, attempts: {}, actions: [], lastCycle: null };
}

export function createCollectorQuality({ dir, now = () => Date.now(), saveDelayMs = 500 } = {}) {
  const stateFile = dir ? join(dir, "quality.json") : "";
  const evidenceDir = dir ? join(dir, "evidence") : "";
  let state = emptyState();
  if (stateFile && existsSync(stateFile)) {
    try {
      const parsed = JSON.parse(readFileSync(stateFile, "utf8"));
      state = { ...emptyState(), ...parsed, settings: { ...DEFAULT_QUALITY_SETTINGS, ...(parsed.settings || {}) } };
    } catch (error) {
      console.error("[collector-quality] failed to read state, starting empty", error);
    }
  }
  let saveTimer = null;
  let lastEvaluation = null;

  function saveNow() {
    if (!stateFile) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    mkdirSync(dir, { recursive: true });
    const temp = `${stateFile}.tmp`;
    writeFileSync(temp, JSON.stringify(state));
    renameSync(temp, stateFile);
  }

  function scheduleSave() {
    if (!stateFile || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        saveNow();
      } catch (error) {
        console.error("[collector-quality] save failed", error);
      }
    }, saveDelayMs);
    saveTimer.unref?.();
  }

  function evidenceFile(shopKey, date, ext) {
    return join(evidenceDir, date, `${fileKey(shopKey)}.${ext}`);
  }

  function isoNow() {
    return new Date(now()).toISOString();
  }

  function logAction(entry) {
    state.actions.push({ at: isoNow(), ...entry });
    if (state.actions.length > 500) state.actions = state.actions.slice(-500);
    scheduleSave();
  }

  /** 证据摘要：判定只用摘要；明细（接口原始返回）写文件，点开时再读。 */
  function recordEvidence(nodeId, items = []) {
    let saved = 0;
    for (const item of Array.isArray(items) ? items : []) {
      const shopKey = text(item.shopKey, 200);
      const date = text(item.date, 10);
      const evidence = item.evidence;
      if (!shopKey || !isDate(date) || !evidence || typeof evidence !== "object") continue;
      const key = cellKey(shopKey, date);
      const previous = state.evidence[key];
      const values = {};
      for (const field of QUALITY_FIELDS) if (num(evidence.values?.[field]) !== null) values[field] = num(evidence.values[field]);
      let pageCheck = sanitizePageCheck(evidence.pageCheck);
      // 后续补采没有做页面核对、但数字与已核验的那次相同：沿用核验结果。
      if (!pageCheck && previous?.pageCheck?.status === "match") {
        const same = Object.keys(previous.pageCheck.fields || {}).every((field) => previous.values?.[field] === values[field]);
        if (same) pageCheck = { ...previous.pageCheck, carried: true };
      }
      const summary = {
        shopKey,
        shopName: text(item.shopName, 160),
        date,
        nodeId: text(nodeId, 80),
        storeId: text(evidence.storeId, 40),
        storeName: text(evidence.storeName, 120),
        site: siteOf(evidence.site) || text(evidence.site, 8),
        templateVersion: Number(evidence.templateVersion) || 1,
        collectedAt: text(evidence.collectedAt, 40) || isoNow(),
        values,
        missing: Array.isArray(evidence.missing) ? evidence.missing.filter((field) => QUALITY_FIELDS.includes(field)) : [],
        notReady: Array.isArray(evidence.notReady) ? evidence.notReady.filter((field) => QUALITY_FIELDS.includes(field)) : [],
        pageCheck,
        hasScreenshot: Boolean(previous?.hasScreenshot && pageCheck?.carried),
        screenshotMime: pageCheck?.carried ? previous?.screenshotMime || "image/jpeg" : "",
      };
      state.evidence[key] = summary;
      if (summary.storeId) state.storeKeys[`${summary.nodeId}|${summary.storeId}`] = { shopKey, shopName: summary.shopName, site: summary.site, at: summary.collectedAt };
      if (evidenceDir) {
        const file = evidenceFile(shopKey, date, "json");
        mkdirSync(join(evidenceDir, date), { recursive: true });
        writeFileSync(file, JSON.stringify({ ...summary, endpoints: evidence.endpoints || {}, rawPage: evidence.pageCheck?.raw || null, notes: evidence.pageCheck?.notes || [] }));
      }
      saved += 1;
    }
    if (saved) scheduleSave();
    return { saved };
  }

  function attachScreenshot(nodeId, { storeId = "", date = "", shopName = "", mime = "image/jpeg", base64 = "" } = {}) {
    if (!isDate(date) || !base64) return { ok: false, message: "截图缺少日期或内容" };
    // 同一个紫鸟店铺可能对应多个中台店铺（跨境多站点）：按店铺名区分。
    const candidates = Object.values(state.evidence).filter((item) => item.nodeId === text(nodeId, 80) && item.storeId === text(storeId, 40) && item.date === date);
    const mapping = candidates.find((item) => shopName && item.shopName === text(shopName, 160)) || (candidates.length === 1 ? candidates[0] : null);
    if (!mapping) return { ok: false, message: "找不到这张截图对应的店铺数据" };
    const key = cellKey(mapping.shopKey, date);
    const summary = state.evidence[key];
    if (!summary) return { ok: false, message: "找不到这张截图对应的采集证据" };
    const buffer = Buffer.from(String(base64), "base64");
    if (!buffer.length || buffer.length > 4 * 1024 * 1024) return { ok: false, message: "截图为空或过大" };
    if (evidenceDir) {
      mkdirSync(join(evidenceDir, date), { recursive: true });
      writeFileSync(evidenceFile(mapping.shopKey, date, mime === "image/png" ? "png" : "jpg"), buffer);
    }
    summary.hasScreenshot = true;
    summary.screenshotMime = mime === "image/png" ? "image/png" : "image/jpeg";
    scheduleSave();
    return { ok: true, shopKey: mapping.shopKey };
  }

  function evidenceDetail(shopKey, date) {
    const summary = state.evidence[cellKey(shopKey, date)] || null;
    if (!summary) return null;
    let detail = null;
    const file = evidenceDir ? evidenceFile(shopKey, date, "json") : "";
    if (file && existsSync(file)) {
      try {
        detail = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        detail = null;
      }
    }
    return { summary, endpoints: detail?.endpoints || {}, rawPage: detail?.rawPage || null, notes: detail?.notes || [] };
  }

  function screenshotFile(shopKey, date) {
    const summary = state.evidence[cellKey(shopKey, date)];
    if (!summary?.hasScreenshot || !evidenceDir) return null;
    const ext = summary.screenshotMime === "image/png" ? "png" : "jpg";
    const file = evidenceFile(shopKey, date, ext);
    return existsSync(file) ? { file, mime: summary.screenshotMime || "image/jpeg" } : null;
  }

  /**
   * 判定所有店铺最近 windowDays 天的数据状态；另外扫描 legacyRefreshDays 内的旧口径数据。
   * metrics：店铺日报数据（含 fieldSources）；systemDaily：妙手订单按店铺+日期汇总；storeIndex：节点上报的店铺。
   */
  function evaluate({ metrics = [], systemDaily = [], storeIndex = [] } = {}) {
    const settings = state.settings;
    const nowMs = now();
    const metricMap = new Map(metrics.map((row) => [cellKey(row.shopKey, row.date), row]));
    const systemMap = new Map(systemDaily.map((row) => [cellKey(row.shopKey, row.date), row]));
    const shops = new Map();
    const ensure = (shopKey, seed = {}) => {
      if (!shops.has(shopKey)) shops.set(shopKey, { shopKey, shopName: seed.shopName || "", site: seed.site || "", owners: [] });
      const shop = shops.get(shopKey);
      if (!shop.shopName && seed.shopName) shop.shopName = seed.shopName;
      if (!shop.site && seed.site) shop.site = seed.site;
      return shop;
    };
    const unmatchedStores = [];
    for (const store of storeIndex) {
      if (!store.enabled || store.disabled) continue;
      const mapped = state.storeKeys[`${store.nodeId}|${store.storeId}`];
      const shopKey = store.shopKey || mapped?.shopKey || "";
      if (!shopKey) {
        unmatchedStores.push(store);
        continue;
      }
      ensure(shopKey, { shopName: store.shopName || mapped?.shopName, site: siteOf(store.site) || mapped?.site }).owners.push(store);
    }
    const oldest = addDays(new Date(nowMs).toISOString().slice(0, 10), -(settings.legacyRefreshDays + 2));
    for (const summary of Object.values(state.evidence)) {
      if (summary.date < oldest) continue;
      const shop = ensure(summary.shopKey, { shopName: summary.shopName, site: summary.site });
      if (!shop.owners.length) {
        const owner = storeIndex.find((store) => store.nodeId === summary.nodeId && store.storeId === summary.storeId);
        if (owner && owner.enabled && !owner.disabled) shop.owners.push(owner);
      }
    }
    for (const shop of shops.values()) {
      if (!shop.site) {
        const row = metrics.find((item) => item.shopKey === shop.shopKey);
        shop.site = siteOf(row?.country) || "ID";
      }
      if (!shop.shopName) shop.shopName = metrics.find((item) => item.shopKey === shop.shopKey)?.shopName || shop.shopKey;
    }

    const rows = [];
    const legacy = [];
    for (const shop of shops.values()) {
      const lastDate = addDays(siteToday(shop.site, nowMs), -1);
      const dates = Array.from({ length: settings.windowDays }, (_, index) => addDays(lastDate, -index));
      const cells = {};
      for (const date of dates) {
        const key = cellKey(shop.shopKey, date);
        const evidence = state.evidence[key] || null;
        const version = Number(evidence?.templateVersion) || 0;
        const history = [];
        for (let back = 1; back <= 14; back += 1) {
          const previous = addDays(date, -back);
          const row = metricMap.get(cellKey(shop.shopKey, previous));
          const previousVersion = Number(state.evidence[cellKey(shop.shopKey, previous)]?.templateVersion) || 0;
          // 只和同一口径的历史比，避免访客数口径修正后被当成「暴涨」。
          if (row && (previousVersion >= 2) === (version >= 2)) history.push(row);
        }
        const metric = metricMap.get(key) || null;
        const cell = evaluateCell({ metric, evidence, system: systemMap.get(key) || null, history });
        cells[date] = {
          ...cell,
          values: metric ? Object.fromEntries(QUALITY_FIELDS.map((field) => [field, num(metric[field])])) : null,
          hasEvidence: Boolean(evidence),
          hasScreenshot: Boolean(evidence?.hasScreenshot),
          collectedAt: evidence?.collectedAt || metric?.updatedAt || "",
          attempts: (state.attempts[key] || []).filter((attempt) => nowMs - Date.parse(attempt.at) < 86400000).length,
        };
      }
      for (let back = settings.windowDays; back < settings.legacyRefreshDays; back += 1) {
        const date = addDays(lastDate, -back);
        const metric = metricMap.get(cellKey(shop.shopKey, date));
        if (!metric || metric.fieldSources?.visitors !== "ziniao") continue;
        const version = Number(state.evidence[cellKey(shop.shopKey, date)]?.templateVersion) || 0;
        if (version < 2) legacy.push({ shopKey: shop.shopKey, date });
      }
      rows.push({ shopKey: shop.shopKey, shopName: shop.shopName, site: shop.site, owners: shop.owners.map((owner) => ({ nodeId: owner.nodeId, nodeName: owner.nodeName, storeId: owner.storeId, storeName: owner.storeName, online: owner.online, running: Boolean(owner.running), lastSeenAt: owner.lastSeenAt || "", lastStatus: owner.lastStatus, lastMessage: owner.lastMessage })), dates, cells });
    }
    rows.sort((a, b) => {
      const rank = (row) => Math.min(...Object.values(row.cells).map((cell) => STATUS_ORDER.indexOf(cell.status)));
      return rank(a) - rank(b) || a.shopName.localeCompare(b.shopName, "zh-CN");
    });

    const stats = { shops: rows.length, cells: 0, byStatus: {}, yesterday: {} };
    for (const row of rows) {
      for (const [date, cell] of Object.entries(row.cells)) {
        stats.cells += 1;
        stats.byStatus[cell.status] = (stats.byStatus[cell.status] || 0) + 1;
        if (date === row.dates[0]) stats.yesterday[cell.status] = (stats.yesterday[cell.status] || 0) + 1;
      }
    }
    stats.legacyCells = legacy.length;
    lastEvaluation = { evaluatedAt: isoNow(), rows, stats, legacy, unmatchedStores };
    return lastEvaluation;
  }

  /**
   * 根据判定结果安排自动补采；返回 { actions: [{ nodeId, storeIds, dates, keys, note }], manual: [...] }。
   * activeCommands(nodeId)：该节点还没执行完的数据质量命令（有就先不派新的）。
   */
  function plan(evaluation, { activeCommands = () => [] } = {}) {
    const settings = state.settings;
    const nowMs = now();
    const manual = new Map();
    const addManual = (code, item) => {
      const key = `${code}|${item.storeKey || item.shopKey || item.nodeId || ""}`;
      const current = manual.get(key);
      if (current) {
        for (const date of item.dates || []) if (!current.dates.includes(date)) current.dates.push(date);
        return;
      }
      manual.set(key, { code, ...item, dates: [...(item.dates || [])] });
    };
    const groups = new Map();
    const recentAttempts = (key) => (state.attempts[key] || []).filter((attempt) => nowMs - Date.parse(attempt.at) < 86400000);
    const consider = (row, date, cell) => {
      const need = backfillReason(cell);
      if (!need) return;
      const key = cellKey(row.shopKey, date);
      const attempts = recentAttempts(key);
      const maxAttempts = need.maxAttempts || settings.maxAttemptsPerDay;
      const last = attempts.length ? Date.parse(attempts[attempts.length - 1].at) : 0;
      const gap = (need.notReady ? settings.notReadyGapMinutes : settings.retryGapMinutes) * 60000;
      const owner = row.owners.find((item) => item.online) || row.owners[0] || null;
      if (!owner) {
        addManual("no_owner", { shopKey: row.shopKey, shopName: row.shopName, title: "没有采集节点负责这个店铺", action: "在某台采集电脑的紫鸟里登录这个店铺（同舟智数会自动发现），或在节点的「店铺」里勾选它。", dates: [date] });
        return;
      }
      const blocked = manualFromMessage(owner.lastMessage);
      if (blocked && ["failed", "partial"].includes(owner.lastStatus)) {
        addManual(blocked.code, { storeKey: `${owner.nodeId}|${owner.storeId}`, shopKey: row.shopKey, shopName: row.shopName, nodeId: owner.nodeId, nodeName: owner.nodeName, storeId: owner.storeId, storeName: owner.storeName, title: blocked.title, action: blocked.action, message: owner.lastMessage, dates: [date] });
        // 人工处理之前每 6 小时才试一次，避免反复打开失败的店铺。
        if (last && nowMs - last < 6 * 3600 * 1000) return;
      }
      if (attempts.length >= maxAttempts) {
        if (need.reason !== "anomaly") {
          addManual("exhausted", { shopKey: row.shopKey, shopName: row.shopName, nodeId: owner.nodeId, nodeName: owner.nodeName, storeId: owner.storeId, storeName: owner.storeName, title: need.notReady ? "Shopee 一直没有出数" : "自动补采多次仍未解决", action: need.notReady ? "确认这家店铺这一天在 Shopee 后台是否有数据；如果后台也没有，可以忽略。" : "打开下面的证据看看具体原因；处理后点「立即补采」。", message: cell.issues.map((issue) => issue.message).join("；"), dates: [date] });
        }
        return;
      }
      if (last && nowMs - last < gap) return;
      // 节点正在采集：等它这一轮写完再判断，避免重复派活。
      if (owner.running) return;
      // 最近一天在早上的定时采集之前不自动补采（Shopee 当地凌晨数据还没生成）。
      if (date === row.dates[0] && shanghaiHour(nowMs) < settings.latestDayStartHour) return;
      if (!owner.online) {
        addManual("node_offline", { nodeId: owner.nodeId, nodeName: owner.nodeName, title: "采集节点离线", action: "检查这台（云）电脑是否开机、同舟智数是否在运行、网络是否正常。", dates: [date] });
        return;
      }
      if (activeCommands(owner.nodeId).length) return;
      const group = groups.get(owner.nodeId) || { nodeId: owner.nodeId, nodeName: owner.nodeName, storeIds: new Set(), dates: new Set(), keys: [], reasons: new Set() };
      group.storeIds.add(owner.storeId);
      group.dates.add(date);
      group.keys.push({ key, reason: need.reason });
      group.reasons.add(need.reason);
      groups.set(owner.nodeId, group);
    };
    for (const row of evaluation.rows) {
      for (const date of row.dates) consider(row, date, row.cells[date]);
    }
    for (const item of evaluation.legacy || []) {
      const row = evaluation.rows.find((candidate) => candidate.shopKey === item.shopKey);
      if (row) consider(row, item.date, { status: "refresh", issues: [] });
    }
    for (const store of evaluation.unmatchedStores || []) {
      if (store.lastStatus === "ok" || store.lastStatus === "partial") continue;
      const blocked = manualFromMessage(store.lastMessage);
      addManual(blocked?.code || "never_collected", { storeKey: `${store.nodeId}|${store.storeId}`, nodeId: store.nodeId, nodeName: store.nodeName, storeId: store.storeId, storeName: store.storeName, shopName: store.shopName || store.storeName, title: blocked?.title || "店铺还没有成功采集过", action: blocked?.action || "在采集中心对这个节点点「立即采集」；仍失败时查看节点日志。", message: store.lastMessage });
    }
    // 同一天多个店铺页面核对都不一致：多半是 Shopee 改版，提示校准模板。
    const mismatchByDate = new Map();
    for (const row of evaluation.rows) {
      for (const [date, cell] of Object.entries(row.cells)) {
        if (cell.issues.some((issue) => issue.code === "page_mismatch")) mismatchByDate.set(date, (mismatchByDate.get(date) || 0) + 1);
      }
    }
    for (const [date, count] of mismatchByDate) {
      if (count >= 3) addManual("template", { shopKey: `template-${date}`, title: `${count} 个店铺的数据与 Shopee 后台页面不一致`, action: "Shopee 卖家中心可能改版了，请联系技术人员在同舟智数「高级：采集模板」重新校准。", dates: [date] });
    }
    const reasonText = { missing: "缺数据", incomplete: "缺字段", error: "数据有误", not_ready: "Shopee 出数后补采", legacy: "访客数按新口径重采", anomaly: "异常波动复核" };
    const actions = [...groups.values()].map((group) => ({
      nodeId: group.nodeId,
      nodeName: group.nodeName,
      storeIds: [...group.storeIds],
      dates: [...group.dates].sort().slice(-31),
      keys: group.keys,
      note: [...group.reasons].map((reason) => reasonText[reason] || reason).join("、"),
    }));
    const manualList = [...manual.values()].map((item) => ({ ...item, dates: item.dates.sort() }));
    if (lastEvaluation === evaluation) lastEvaluation.manual = manualList;
    return { actions, manual: manualList };
  }

  function recordAttempts(keys = [], { nodeId = "", commandId = "", manual = false } = {}) {
    const at = isoNow();
    for (const item of keys) {
      const key = typeof item === "string" ? item : item.key;
      const list = state.attempts[key] || [];
      list.push({ at, nodeId, commandId, reason: item.reason || (manual ? "manual" : ""), manual });
      state.attempts[key] = list.slice(-10);
    }
    scheduleSave();
  }

  function prune() {
    const cutoff = addDays(new Date(now()).toISOString().slice(0, 10), -state.settings.retentionDays);
    for (const [key, summary] of Object.entries(state.evidence)) if (summary.date < cutoff) delete state.evidence[key];
    for (const [key, list] of Object.entries(state.attempts)) {
      const fresh = list.filter((attempt) => now() - Date.parse(attempt.at) < 7 * 86400000);
      if (fresh.length) state.attempts[key] = fresh;
      else delete state.attempts[key];
    }
    if (evidenceDir && existsSync(evidenceDir)) {
      for (const name of readdirSync(evidenceDir)) {
        if (isDate(name) && name < cutoff) rmSync(join(evidenceDir, name), { recursive: true, force: true });
      }
    }
    scheduleSave();
  }

  return {
    settings() {
      return { ...state.settings };
    },
    updateSettings(patch = {}) {
      const next = { ...state.settings };
      for (const key of ["autoBackfill", "pageCheck", "screenshot"]) if (patch[key] !== undefined) next[key] = Boolean(patch[key]);
      for (const [key, min, max] of [["windowDays", 3, 31], ["maxAttemptsPerDay", 1, 6], ["retryGapMinutes", 30, 720]]) {
        if (patch[key] !== undefined && Number.isFinite(Number(patch[key]))) next[key] = Math.min(max, Math.max(min, Math.round(Number(patch[key]))));
      }
      state.settings = next;
      saveNow();
      return { ...next };
    },
    /** 下发给采集节点的设置（心跳返回）。 */
    nodeSettings() {
      return { pageCheck: state.settings.pageCheck, screenshot: state.settings.screenshot };
    },
    recordEvidence,
    attachScreenshot,
    evidenceDetail,
    screenshotFile,
    evaluate,
    plan,
    recordAttempts,
    logAction,
    actions(limit = 50) {
      return state.actions.slice(-limit).reverse();
    },
    setLastCycle(info) {
      state.lastCycle = { at: isoNow(), ...info };
      scheduleSave();
    },
    lastCycle() {
      return state.lastCycle;
    },
    lastEvaluation() {
      return lastEvaluation;
    },
    prune,
    flush() {
      saveNow();
    },
  };
}
