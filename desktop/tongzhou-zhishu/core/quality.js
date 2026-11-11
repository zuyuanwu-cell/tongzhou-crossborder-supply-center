"use strict";

// 数据质量（采集端）：留证据、页面核对的数字解析与比对。
// 中台「采集中心 · 数据质量」根据这里上传的证据判断每个店铺每天的数据是否可信、是否需要补采。

/** 千分位用「.」的站点（印尼、越南、巴西、哥伦比亚、智利）。 */
const DOT_THOUSANDS = new Set(["ID", "VN", "BR", "CO", "CL"]);

/**
 * 解析页面上显示的数字：「Rp2.640.200」「3.003」「RM1,234.56」「34k」。
 * 返回 { value, approx }；无法解析返回 null。
 */
function parsePageNumber(textValue, site = "") {
  const raw = String(textValue || "").trim();
  if (!raw) return null;
  const match = raw.match(/([0-9][0-9.,]*)\s*([kKmM])?\s*$/);
  if (!match) return null;
  let digits = match[1];
  const suffix = (match[2] || "").toLowerCase();
  const dotThousands = DOT_THOUSANDS.has(String(site).toUpperCase());
  const thousand = dotThousands ? "." : ",";
  const decimal = dotThousands ? "," : ".";
  // 只有一个分隔符且后面不是 3 位数字时，按小数点处理（例如 34,5k / 1.5k）。
  const seps = digits.match(/[.,]/g) || [];
  if (seps.length === 1) {
    const [, after = ""] = digits.split(/[.,]/);
    const sep = seps[0];
    if (after.length !== 3 || suffix) {
      digits = digits.replace(sep, ".");
      const value = Number(digits);
      if (!Number.isFinite(value)) return null;
      return { value: suffix === "k" ? value * 1000 : suffix === "m" ? value * 1e6 : value, approx: Boolean(suffix) };
    }
    digits = sep === thousand ? digits.replace(sep, "") : digits.replace(sep, ".");
  } else {
    digits = digits.split(thousand).join("").replace(decimal, ".");
  }
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  return { value: suffix === "k" ? value * 1000 : suffix === "m" ? value * 1e6 : value, approx: Boolean(suffix) };
}

/** 页面字段 → 日报字段。 */
const PAGE_FIELDS = Object.freeze({ sales: "payAmount", orders: "orderCount", visitors: "visitors" });

/**
 * 比对页面数字与采集值。返回
 * { status: "match" | "mismatch" | "unchecked", fields: { payAmount: { page, collected, match } }, message }
 */
function comparePageCheck(collected = {}, page = null, site = "") {
  if (!page || !page.period) {
    return { status: "unchecked", fields: {}, message: (page?.notes || []).join("；") || "没有完成页面核对" };
  }
  const fields = {};
  let compared = 0;
  let mismatched = 0;
  const notes = [...(page.notes || [])];
  for (const [pageKey, field] of Object.entries(PAGE_FIELDS)) {
    const parsed = parsePageNumber(page.values?.[pageKey], site);
    const mine = collected[field];
    if (!parsed || mine === undefined || mine === null) continue;
    // 页面口径没切到「已付款」时，金额和订单数不可比，只比访客数。
    if (field !== "visitors" && page.paid === false) continue;
    const tolerance = parsed.approx ? Math.max(1, Math.abs(parsed.value) * 0.01) : Math.max(1, Math.abs(parsed.value) * 0.0005);
    const match = Math.abs(parsed.value - Number(mine)) <= (field === "payAmount" ? tolerance : parsed.approx ? tolerance : 0);
    fields[field] = { page: parsed.value, pageText: String(page.values[pageKey]), collected: Number(mine), match };
    compared += 1;
    if (!match) mismatched += 1;
  }
  if (!compared) return { status: "unchecked", fields, message: notes.join("；") || "页面上没读到可比对的数字" };
  return {
    status: mismatched ? "mismatch" : "match",
    fields,
    message: mismatched ? `${mismatched} 项与 Shopee 后台页面不一致` : `${compared} 项与 Shopee 后台页面一致`,
  };
}

/** 证据里的接口原始返回：去掉逐小时曲线等大数组，控制体积。 */
function trimJson(value, { maxArray = 24, depth = 0 } = {}) {
  if (value === null || typeof value !== "object") return value;
  if (depth > 8) return "…";
  if (Array.isArray(value)) {
    const list = value.slice(0, maxArray).map((item) => trimJson(item, { maxArray, depth: depth + 1 }));
    if (value.length > maxArray) list.push(`…共 ${value.length} 项`);
    return list;
  }
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "points") continue;
    out[key] = trimJson(item, { maxArray, depth: depth + 1 });
  }
  return out;
}

function evidenceEndpoint(endpoint, response, { maxChars = 24000 } = {}) {
  let data = response?.json ? trimJson(response.json) : null;
  let textValue = data ? JSON.stringify(data) : "";
  if (textValue.length > maxChars) {
    data = { _truncated: true, preview: textValue.slice(0, maxChars) };
  }
  return {
    label: endpoint.label || endpoint.id,
    status: response?.status || 0,
    error: response?.error || "",
    ms: response?.ms || 0,
    data,
  };
}

/** 「DD-MM-YYYY」：Shopee 商业分析页面上显示的日期格式。 */
function pageDateText(date) {
  const [y, m, d] = String(date).split("-");
  return `${d}-${m}-${y}`;
}

module.exports = { parsePageNumber, comparePageCheck, trimJson, evidenceEndpoint, pageDateText, PAGE_FIELDS };
