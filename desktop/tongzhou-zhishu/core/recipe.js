"use strict";

// 采集模板（recipe）：把一次「探测」抓到的平台接口请求变成可按日期重放的模板，
// 并用 JSON 路径把返回值映射到中台店铺日报字段。模板与平台无关，各平台适配器复用。

const { dayRange } = require("./sites");

/** 中台 /api/shop-daily-report/ingest 接受的指标字段。 */
const METRIC_FIELDS = Object.freeze([
  { key: "payAmount", label: "支付金额（当地币）" },
  { key: "orderCount", label: "订单数" },
  { key: "impressions", label: "曝光量" },
  { key: "visitors", label: "访客数" },
  { key: "addToCart", label: "加购数" },
  { key: "adOnsite", label: "站内广告花费（当地币）" },
  { key: "adOffsite", label: "站外广告花费（当地币）" },
]);
const METRIC_KEYS = METRIC_FIELDS.map((field) => field.key);

// ---------------------------------------------------------------------------
// 占位符
// ---------------------------------------------------------------------------

function placeholderValues({ date, site, shopId = "", origin = "" }) {
  const { start, end } = dayRange(date, site);
  return {
    origin: String(origin || ""),
    startTs: String(start),
    endTs: String(end),
    endTsNext: String(end + 1),
    startMs: String(start * 1000),
    endMs: String(end * 1000 + 999),
    date,
    dateCompact: date.replace(/-/g, ""),
    shopId: String(shopId || ""),
  };
}

/** 替换 {name} 占位符；{cookie:xxx} 留给页面内脚本处理。 */
function fill(template, values) {
  if (template === null || template === undefined) return template;
  return String(template).replace(/\{([a-zA-Z]+)\}/g, (all, name) => (Object.prototype.hasOwnProperty.call(values, name) ? values[name] : all));
}

function fillRequest(endpoint, values) {
  const headers = {};
  for (const [name, value] of Object.entries(endpoint.headers || {})) headers[name] = fill(value, values);
  return {
    id: endpoint.id,
    method: (endpoint.method || "GET").toUpperCase(),
    url: fill(endpoint.url, values),
    body: endpoint.body === null || endpoint.body === undefined ? null : fill(endpoint.body, values),
    headers,
  };
}

// ---------------------------------------------------------------------------
// 从抓到的请求生成模板
// ---------------------------------------------------------------------------

function looksLikeEpochSeconds(value, now) {
  return /^\d{10}$/.test(value) && Math.abs(Number(value) - now / 1000) < 400 * 86400;
}

function looksLikeEpochMs(value, now) {
  return /^\d{13}$/.test(value) && Math.abs(Number(value) - now) < 400 * 86400000;
}

/**
 * 把具体请求中的日期/时间戳/店铺 ID 换成占位符。
 * 返回 { endpoint, replaced: [描述] }，replaced 为空说明没识别到日期参数（无法按天重放）。
 */
function templatizeRequest(request, { shopIds = [], cookies = {}, now = Date.now() } = {}) {
  const replaced = [];
  const shopIdSet = new Set(shopIds.map(String).filter(Boolean));
  const seconds = [];
  const millis = [];

  const scan = (value) => {
    const textValue = String(value);
    if (looksLikeEpochSeconds(textValue, now)) seconds.push(Number(textValue));
    if (looksLikeEpochMs(textValue, now)) millis.push(Number(textValue));
  };

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return { endpoint: null, replaced, error: "无效的请求地址" };
  }
  for (const value of url.searchParams.values()) scan(value);
  let bodyObject = null;
  if (request.body) {
    try {
      bodyObject = JSON.parse(request.body);
    } catch {
      bodyObject = null;
    }
  }
  const walk = (node, visit, key = "") => {
    if (Array.isArray(node)) return node.map((item) => walk(item, visit, key));
    if (node && typeof node === "object") {
      const next = {};
      for (const [childKey, value] of Object.entries(node)) next[childKey] = walk(value, visit, childKey);
      return next;
    }
    return visit(node, key);
  };
  if (bodyObject) walk(bodyObject, (leaf) => {
    scan(leaf);
    return leaf;
  });

  const minSec = seconds.length ? Math.min(...seconds) : null;
  const minMs = millis.length ? Math.min(...millis) : null;
  const mapValue = (value, key = "") => {
    const textValue = String(value);
    if (looksLikeEpochSeconds(textValue, now)) {
      const isStart = Number(textValue) === minSec && !/end|to$/i.test(key);
      replaced.push(`${key || "时间戳"} → ${isStart ? "{startTs}" : "{endTs}"}`);
      return isStart ? "{startTs}" : "{endTs}";
    }
    if (looksLikeEpochMs(textValue, now)) {
      const isStart = Number(textValue) === minMs && !/end|to$/i.test(key);
      replaced.push(`${key || "毫秒时间戳"} → ${isStart ? "{startMs}" : "{endMs}"}`);
      return isStart ? "{startMs}" : "{endMs}";
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(textValue)) {
      replaced.push(`${key || "日期"} → {date}`);
      return "{date}";
    }
    if (/^\d{8}$/.test(textValue) && /^20\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(textValue) && /date|day|dt/i.test(key)) {
      replaced.push(`${key} → {dateCompact}`);
      return "{dateCompact}";
    }
    if (shopIdSet.has(textValue) && /shop/i.test(key)) {
      replaced.push(`${key} → {shopId}`);
      return "{shopId}";
    }
    return value;
  };

  const params = [];
  for (const [key, value] of url.searchParams.entries()) {
    // SPC_CDS 是会话参数（来自 Cookie），重放时不需要，去掉以免过期。
    if (/^SPC_CDS/i.test(key) || key === "_cache_api_sw_v1_") continue;
    params.push([key, mapValue(value, key)]);
  }
  // 手工拼接，避免 URLSearchParams 把 { } 编码掉。
  const query = params.map(([key, value]) => {
    const encoded = String(value).startsWith("{") && String(value).endsWith("}") ? value : encodeURIComponent(value);
    return `${encodeURIComponent(key)}=${encoded}`;
  }).join("&");
  // 域名用 {origin} 占位，同一模板可用于不同站点（印尼、马来……）的卖家中心。
  const templUrl = `{origin}${url.pathname}${query ? `?${query}` : ""}`;

  let body = request.body ?? null;
  if (bodyObject) {
    const mapped = walk(bodyObject, (leaf, key) => {
      const next = mapValue(leaf, key);
      // 数字时间戳在 JSON 里保持数字类型：用特殊记号，序列化后再去掉引号。
      if (typeof leaf === "number" && typeof next === "string" && next.startsWith("{")) return `@@${next}@@`;
      return next;
    });
    body = JSON.stringify(mapped).replace(/"@@(\{[a-zA-Z]+\})@@"/g, "$1");
  }

  const headers = {};
  for (const [name, value] of Object.entries(request.headers || {})) {
    const lower = name.toLowerCase();
    if (["cookie", "content-length", "host", "origin", "referer", "user-agent", "accept-encoding", "connection"].includes(lower)) continue;
    const cookieName = Object.keys(cookies).find((key) => cookies[key] && cookies[key] === value);
    headers[name] = cookieName ? `{cookie:${cookieName}}` : value;
  }

  return {
    endpoint: {
      id: "",
      label: url.pathname.split("/").filter(Boolean).slice(-2).join("/"),
      origin: url.origin,
      method: (request.method || "GET").toUpperCase(),
      url: templUrl,
      body,
      headers,
    },
    replaced,
  };
}

// ---------------------------------------------------------------------------
// JSON 取值
// ---------------------------------------------------------------------------

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value.replace(/[,\s]/g, "").replace(/[^\d.+-eE]/g, "");
    if (!cleaned || !/\d/.test(cleaned)) return null;
    const number = Number(cleaned);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

/** 解析路径：a.b[0].c、list[*].value（[*] 表示把数组每一项的值相加）。 */
function parsePath(pathText) {
  const tokens = [];
  const re = /([^.[\]]+)|\[(\*|\d+)\]/g;
  let match;
  while ((match = re.exec(String(pathText || "")))) tokens.push(match[1] !== undefined ? match[1] : match[2] === "*" ? "*" : Number(match[2]));
  return tokens;
}

function readPath(root, pathText) {
  const tokens = parsePath(pathText);
  let nodes = [root];
  let wildcard = false;
  for (const token of tokens) {
    const next = [];
    for (const node of nodes) {
      if (node === null || node === undefined) continue;
      if (token === "*") {
        wildcard = true;
        if (Array.isArray(node)) next.push(...node);
        else if (typeof node === "object") next.push(...Object.values(node));
      } else if (typeof token === "number") {
        if (Array.isArray(node)) next.push(node[token]);
      } else if (typeof node === "object") {
        next.push(node[token]);
      }
    }
    nodes = next;
  }
  const numbers = nodes.map(toNumber).filter((value) => value !== null);
  if (!numbers.length) return null;
  return wildcard ? numbers.reduce((sum, value) => sum + value, 0) : numbers[0];
}

/** 列出 JSON 里所有数值叶子：[{ path, value }]。 */
function flattenNumbers(root, { limit = 3000 } = {}) {
  const out = [];
  const visit = (node, pathText, depth) => {
    if (out.length >= limit || depth > 12) return;
    if (Array.isArray(node)) {
      node.slice(0, 60).forEach((item, index) => visit(item, `${pathText}[${index}]`, depth + 1));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) visit(value, pathText ? `${pathText}.${key}` : key, depth + 1);
      return;
    }
    const number = typeof node === "number" ? node : (typeof node === "string" && /^-?\d+(\.\d+)?$/.test(node.trim()) ? Number(node) : null);
    if (number !== null && Number.isFinite(number)) out.push({ path: pathText, value: number });
  };
  visit(root, "", 0);
  return out;
}

// ---------------------------------------------------------------------------
// 字段自动建议（只是建议，必须由人对照卖家中心确认）
// ---------------------------------------------------------------------------

const NEGATIVE = /(prev|previous|last|before|ratio|rate|pct|percent|chain|compare|growth|yoy|mom|avg|average|per_|_per|rank|target|limit|budget|max|min|ts$|time|timestamp|_id$|^id$|code|status|type|version|page|total_count|offset)/i;
const HINTS = {
  visitors: [/(^|[._])(uv|visitors?|unique_visitors?|visitor_cnt|product_visitors?)($|[._])/i, /visitor/i],
  impressions: [/(^|[._])(impressions?|exposures?|product_impressions?|imp|pv|page_views?|views?)($|[._])/i, /impression|exposure/i],
  addToCart: [/(add_?to_?cart|atc|cart_add|add_cart)(_?(users?|units?|cnt|count|buyers?))?/i, /cart/i],
  payAmount: [/(^|[._])(paid_?sales|confirmed_?sales|sales|gmv|paid_?gmv|revenue|order_?amount)($|[._])/i, /sales|gmv/i],
  orderCount: [/(^|[._])(paid_?orders?|confirmed_?orders?|orders?|order_?cnt|order_?count|placed_?orders?)($|[._])/i, /order/i],
  adOnsite: [/(^|[._])(expense|cost|spend|ads_?expense|ads_?cost)($|[._])/i, /expense|cost|spend/i],
  adOffsite: [/(offsite|affiliate|ams).*(expense|cost|spend|commission)/i],
};

function suggestMetrics(endpointsWithSamples) {
  const suggestions = {};
  for (const field of METRIC_KEYS) {
    let best = null;
    for (const { endpoint, sample } of endpointsWithSamples) {
      let pathname = "";
      try {
        pathname = new URL(endpoint.url.replace(/\{[^}]+\}/g, "0")).pathname;
      } catch {
        pathname = endpoint.url;
      }
      const isAds = /\/(pas|ads?|marketing|campaigns?|advertis\w*)(\/|_|$)/i.test(pathname);
      for (const leaf of flattenNumbers(sample)) {
        const lastKey = leaf.path.split(".").pop().replace(/\[\d+\]/g, "");
        if (NEGATIVE.test(lastKey)) continue;
        const [strong, weak] = HINTS[field];
        let score = 0;
        if (strong.test(leaf.path)) score += 3;
        else if (weak && weak.test(lastKey)) score += 1;
        if (!score) continue;
        if (field.startsWith("ad") && isAds) score += 2;
        if (field.startsWith("ad") && !isAds) score -= 2;
        if (!field.startsWith("ad") && isAds) score -= 2;
        if (/\[\d+\]/.test(leaf.path)) score -= 0.5;
        score -= leaf.path.split(".").length * 0.05;
        if (score > 0 && (!best || score > best.score)) best = { endpoint: endpoint.id, path: leaf.path, value: leaf.value, score };
      }
    }
    if (best) suggestions[field] = { endpoint: best.endpoint, path: best.path, scale: 1, sampleValue: best.value };
  }
  return suggestions;
}

/** 用模板的字段映射，从各接口返回里取出一组指标。 */
function extractMetrics(template, responsesByEndpoint) {
  const values = {};
  const missing = [];
  for (const [field, mapping] of Object.entries(template.metrics || {})) {
    if (!mapping || !mapping.endpoint || !mapping.path || !METRIC_KEYS.includes(field)) continue;
    const response = responsesByEndpoint[mapping.endpoint];
    if (!response || response.error) {
      missing.push(field);
      continue;
    }
    const raw = readPath(response.json, mapping.path);
    if (raw === null) {
      missing.push(field);
      continue;
    }
    const scale = Number(mapping.scale) > 0 ? Number(mapping.scale) : 1;
    let value = raw / scale;
    value = ["orderCount", "impressions", "visitors", "addToCart"].includes(field) ? Math.round(value) : Math.round(value * 100) / 100;
    values[field] = value;
  }
  return { values, missing };
}

function validateTemplate(template) {
  const problems = [];
  if (!template || typeof template !== "object") return ["模板为空"];
  if (!template.name) problems.push("缺少模板名称");
  if (!Array.isArray(template.endpoints) || !template.endpoints.length) problems.push("没有任何接口");
  const ids = new Set((template.endpoints || []).map((endpoint) => endpoint.id));
  for (const endpoint of template.endpoints || []) {
    if (!endpoint.id) problems.push("有接口缺少 ID");
    if (!/^(https:\/\/|\{origin\}\/)/.test(endpoint.url || "")) problems.push(`接口 ${endpoint.id} 地址无效`);
    const usesDate = /\{(startTs|endTs|startMs|endMs|date|dateCompact|endTsNext)\}/.test(`${endpoint.url} ${endpoint.body || ""}`);
    if (!usesDate) problems.push(`接口 ${endpoint.label || endpoint.id} 没有日期参数，只能取到页面当前显示的日期`);
  }
  const mapped = Object.entries(template.metrics || {}).filter(([, mapping]) => mapping && mapping.path);
  if (!mapped.length) problems.push("还没有映射任何字段");
  for (const [field, mapping] of mapped) {
    if (!ids.has(mapping.endpoint)) problems.push(`字段 ${field} 指向不存在的接口`);
  }
  return problems;
}

module.exports = {
  METRIC_FIELDS,
  METRIC_KEYS,
  placeholderValues,
  fill,
  fillRequest,
  templatizeRequest,
  toNumber,
  parsePath,
  readPath,
  flattenNumbers,
  suggestMetrics,
  extractMetrics,
  validateTemplate,
};
