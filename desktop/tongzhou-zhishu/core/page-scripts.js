"use strict";

// 在紫鸟店铺浏览器页面里运行的脚本（作为 async 函数体传给 ZiniaoCli.runInPage）。
// 页面里已登录卖家中心，同源 fetch 自动带上 Cookie，所以不需要导出或保存任何登录凭证。

const MAX_TEXT = 400000;

/** 安装请求记录器：之后页面里发出的 fetch/XHR（含 POST 请求体和返回）都会被记录。 */
function hookBody(apiPattern) {
  return `
const pattern = new RegExp(${JSON.stringify(apiPattern)}, "i");
const w = window;
w.__tzCap = w.__tzCap || [];
if (!w.__tzHooked) {
  w.__tzHooked = true;
  const keep = (entry) => { try { if (w.__tzCap.length >= 300) w.__tzCap.shift(); w.__tzCap.push(entry); } catch (e) {} };
  const origFetch = w.fetch;
  w.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || String(input);
    const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
    const response = await origFetch.apply(this, arguments);
    try {
      const abs = new URL(url, location.href).href;
      if (pattern.test(abs)) {
        const headers = {};
        const h = (init && init.headers) || (input && input.headers);
        if (h) { if (typeof h.forEach === "function") h.forEach((v, k) => { headers[k] = v; }); else Object.assign(headers, h); }
        const clone = response.clone();
        clone.text().then((text) => keep({ via: "fetch", method, url: abs, body: init && typeof init.body === "string" ? init.body : null, headers, status: response.status, text: text.slice(0, ${MAX_TEXT}), at: Date.now() })).catch(() => {});
      }
    } catch (e) {}
    return response;
  };
  const XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send, XH = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) { this.__tz = { method: String(method || "GET").toUpperCase(), url: String(url), headers: {} }; return XO.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) { try { if (this.__tz) this.__tz.headers[k] = v; } catch (e) {} return XH.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (body) {
    const meta = this.__tz;
    if (meta) {
      this.addEventListener("loadend", () => {
        try {
          const abs = new URL(meta.url, location.href).href;
          if (!pattern.test(abs)) return;
          const text = typeof this.responseText === "string" ? this.responseText : "";
          keep({ via: "xhr", method: meta.method, url: abs, body: typeof body === "string" ? body : null, headers: meta.headers, status: this.status, text: text.slice(0, ${MAX_TEXT}), at: Date.now() });
        } catch (e) {}
      });
    }
    return XS.apply(this, arguments);
  };
}
return { hooked: true, href: location.href, captured: w.__tzCap.length };
`;
}

/**
 * 探测：返回当前页面信息、Cookie 名称、已记录的接口请求；
 * 对记录器安装前已经发生的 GET 请求（从 performance 里拿地址）重新请求一次拿到返回体。
 */
function probeBody(apiPattern, { refetch = true, maxRefetch = 40 } = {}) {
  return `
const pattern = new RegExp(${JSON.stringify(apiPattern)}, "i");
const w = window;
const captured = (w.__tzCap || []).slice();
// 记录器已经抓到的地址（不论 GET/POST）不再重新请求：performance 里看不出请求方法，POST 接口用 GET 重放只会报错。
const seen = new Set(captured.map((c) => c.url));
const resources = performance.getEntriesByType("resource")
  .filter((e) => (e.initiatorType === "fetch" || e.initiatorType === "xmlhttprequest") && pattern.test(e.name))
  .map((e) => e.name);
const unique = [...new Set(resources)].filter((u) => !seen.has(u));
const refetched = [];
if (${refetch ? "true" : "false"}) {
  for (const url of unique.slice(-${maxRefetch})) {
    try {
      const r = await fetch(url, { credentials: "include" });
      const text = await r.text();
      refetched.push({ via: "refetch", method: "GET", url, body: null, headers: {}, status: r.status, text: text.slice(0, ${MAX_TEXT}), at: Date.now() });
    } catch (e) {
      refetched.push({ via: "refetch", method: "GET", url, status: 0, error: String(e), text: "" });
    }
  }
}
return { href: location.href, title: document.title, requests: captured.concat(refetched), resourceCount: resources.length };
`;
}

/** 页面基本信息（用于等待页面、清理非安全弹窗及判断是否掉登录）。 */
function pageInfoBody() {
  return `
// TZ_PAGE_PREFLIGHT
const visible = (element) => !!(element && element.offsetParent !== null);
const safeClose = /^(关闭|取消|暂不|暂不处理|稍后|以后|以后再说|不再显示|知道了|我知道了|好的|确认|跳过|close|dismiss|not now|maybe later|later|skip|got it|ok|tutup|batal|nanti|lewati|đóng|để sau|bỏ qua)$/i;
const protectedText = /captcha|security check|验证码|安全验证|二次验证|身份验证|授权|one.time.password|otp|登录|登入|log[ -]?in|sign[ -]?in/i;
const containers = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], [class*="modal"], [class*="dialog"], [class*="popup"], [class*="announcement"], [class*="notice"], [class*="tutorial"], [class*="guide"], [class*="intercom"]'))
  .filter(visible);
let dismissed = 0;
for (const container of containers.slice(0, 8)) {
  const content = (container.innerText || "").slice(0, 1200);
  if (protectedText.test(content)) continue;
  const controls = Array.from(container.querySelectorAll('button, [role="button"], [aria-label], [title]')).filter(visible);
  const close = controls.find((element) => {
    const label = String(element.innerText || element.getAttribute('aria-label') || element.getAttribute('title') || '').trim();
    const identity = String(
      (typeof element.className === 'string' ? element.className : '')
      + ' ' + (element.getAttribute('data-testid') || '')
      + ' ' + (element.getAttribute('name') || '')
    );
    return safeClose.test(label)
      || (!label && /(?:^|[\s_-])(?:modal|dialog|popup)?[\s_-]*close(?:[\s_-]|$)|(?:^|[\s_-])close[\s_-]*(?:button|btn|icon)(?:[\s_-]|$)/i.test(identity));
  });
  if (close && !close.disabled && close.getAttribute('aria-disabled') !== 'true') {
    close.click();
    dismissed += 1;
  }
}
const bodyText = (document.body && document.body.innerText) || "";
const bodyNodes = document.body && typeof document.body.querySelectorAll === 'function'
  ? document.body.querySelectorAll('*').length
  : (document.body ? 1 : 0);
const inputs = Array.from(document.querySelectorAll("input") || []).filter(visible);
const buttons = Array.from(document.querySelectorAll("button, [role=button], input[type=submit]") || []).filter(visible);
const hasPassword = inputs.some((element) => element.type === "password" || /password|密码|kata sandi|mật khẩu/i.test((element.name || "") + " " + (element.placeholder || "")));
const hasLoginControl = buttons.some((element) => /登录|登入|log[ -]?in|sign[ -]?in|masuk|đăng nhập|继续登录|使用此账号|continue|lanjutkan/i.test(String(element.innerText || element.textContent || element.getAttribute('aria-label') || element.getAttribute('title') || "").trim()));
return {
  href: location.href,
  title: document.title,
  ready: document.readyState,
  text: bodyText.slice(0, 600),
  dismissed,
  bodyNodes,
  visuallyBlank: bodyText.trim().length < 2 && bodyNodes < 8 && !hasPassword && !hasLoginControl,
  hasPassword,
  hasLoginControl,
  hasCaptcha: /captcha|security check|验证码|安全验证|二次验证|one.time.password|otp/i.test(location.href + " " + bodyText.slice(0, 3000)),
};
`;
}

/**
 * 重放：requests = [{ key, method, url, body, headers }]；
 * 注意：紫鸟 ZClaw 会拒绝执行读取 Cookie 的脚本，所以这里不读取任何 Cookie，
 * 登录态完全依赖浏览器同源请求自动携带。
 */
function replayBody(requests, { concurrency = 3 } = {}) {
  return `
const list = ${JSON.stringify(requests)};
const sub = (v) => v;
const results = {};
let cursor = 0;
async function worker() {
  while (cursor < list.length) {
    const req = list[cursor++];
    const headers = {};
    for (const [k, v] of Object.entries(req.headers || {})) headers[k] = sub(v);
    if (req.body && !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) headers["content-type"] = "application/json;charset=UTF-8";
    const started = Date.now();
    try {
      const r = await fetch(req.url, { method: req.method || "GET", headers, body: req.method === "GET" ? undefined : sub(req.body), credentials: "include" });
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch (e) {}
      results[req.key] = { status: r.status, json, text: json ? undefined : text.slice(0, 2000), ms: Date.now() - started };
    } catch (e) {
      results[req.key] = { status: 0, error: String(e), ms: Date.now() - started };
    }
  }
}
await Promise.all(Array.from({ length: Math.min(${Math.max(1, concurrency)}, list.length) }, worker));
return { href: location.href, results };
`;
}

/**
 * 在已登录的 Shopee 卖家中心生成并下载官方订单报表。
 * 登录参数只在页面进程里从同源请求继承，不会返回给 Node，也不会写入日志或配置。
 */
function orderReportBody({ startDate, endDate, language = "en", maxBytes = 5 * 1024 * 1024 }) {
  return `
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const resources = performance.getEntriesByType("resource").map((entry) => entry.name || "");
const candidates = [location.href, ...resources].reverse();
let auth = null;
for (const candidate of candidates) {
  try {
    const url = new URL(candidate, location.href);
    if (url.origin === location.origin && url.searchParams.get("SPC_CDS")) { auth = url; break; }
  } catch (error) {}
}
if (!auth) throw new Error("当前 Shopee 页面没有可复用的登录请求上下文，请刷新订单页后重试。");
const apiUrl = (pathname, params = {}) => {
  const url = new URL(pathname, location.origin);
  for (const key of ["SPC_CDS", "SPC_CDS_VER"]) {
    const value = auth.searchParams.get(key);
    if (value) url.searchParams.set(key, value);
  }
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url.href;
};
const retryAfterMs = (response, fallbackMs) => {
  const raw = response.headers.get("retry-after") || "";
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1000, Math.min(120000, seconds * 1000));
  const at = Date.parse(raw);
  if (Number.isFinite(at)) return Math.max(1000, Math.min(120000, at - Date.now()));
  return fallbackMs;
};
const fetchWithRateLimit = async (url, label) => {
  const response = await fetch(url, { credentials: "include" });
  if (response.status !== 429) return response;
  const delay = retryAfterMs(response, 0);
  // 页面脚本不在同一店铺快速重试；Node 侧会全局熔断所有后续店铺。
  throw new Error("SHOPEE_RATE_LIMIT|" + delay + "|Shopee 订单报表接口限流（" + label + "），已进入全局冷却。");
};
const readJson = async (pathname, params) => {
  const response = await fetchWithRateLimit(apiUrl(pathname, params), pathname);
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error("Shopee 订单报表接口 HTTP " + response.status);
  const code = json && (json.code ?? json.err_code ?? json.error_code);
  if (code !== undefined && ![0, "0", 200, "200"].includes(code)) throw new Error((json && (json.message || json.msg)) || ("Shopee 订单报表接口错误 " + code));
  return json || {};
};
const created = await readJson("/api/v3/order/request_order_report", {
  start_date: ${JSON.stringify(startDate)},
  end_date: ${JSON.stringify(endDate)},
  language: ${JSON.stringify(language)},
  screening_condition: "order_creation_date",
  parcel_level_filter: 0,
});
const createdData = created.data || created.result || created;
const reportId = createdData.report_id || createdData.reportId || createdData.id;
if (!reportId) throw new Error("Shopee 没有返回订单报表任务编号。");
let report = null;
for (let attempt = 0; attempt < 60; attempt += 1) {
  const polled = await readJson("/api/v3/settings/get_report/", { report_id: reportId });
  report = polled.data || polled.result || polled;
  if (report.report) report = report.report;
  const status = report.status ?? report.report_status ?? report.state;
  if (status === 2 || /complete|success|ready/i.test(String(status))) break;
  if (status === 3 || status === -1 || /fail|error/i.test(String(status))) throw new Error("Shopee 生成订单报表失败。");
  report = null;
  await sleep(3000);
}
if (!report) throw new Error("等待 Shopee 订单报表生成超时。");
const response = await fetchWithRateLimit(apiUrl("/api/v3/settings/download_report/", { report_id: reportId }), "download_report");
if (!response.ok) throw new Error("下载 Shopee 订单报表失败：HTTP " + response.status);
const bytes = new Uint8Array(await response.arrayBuffer());
if (!bytes.length) throw new Error("Shopee 返回了空订单报表。");
if (bytes.length > ${Math.max(1, Number(maxBytes) || 1)}) throw new Error("Shopee 订单报表超过安全大小限制。");
const parts = [];
for (let offset = 0; offset < bytes.length; offset += 0x8000) parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
const disposition = response.headers.get("content-disposition") || "";
const fileName = /filename\*?=(?:UTF-8''|\")?([^\";]+)/i.exec(disposition)?.[1] || report.file_name || report.filename || "order-report.xlsx";
return {
  reportId: String(reportId),
  fileName: decodeURIComponent(String(fileName).replace(/^\"|\"$/g, "")),
  recordCount: Number(report.record_count ?? report.total_count ?? report.count ?? createdData.record_count ?? 0) || 0,
  bytes: bytes.length,
  startDate: ${JSON.stringify(startDate)},
  endDate: ${JSON.stringify(endDate)},
  base64: btoa(parts.join("")),
};
`;
}

/**
 * Shopee 登录恢复。只判断浏览器是否已经自动填充密码并触发表单，
 * 不读取、不返回、更不会记录账号或密码内容。
 */
function loginRecoveryBody() {
  return `
// TZ_SHOPEE_LOGIN_RECOVERY
const visible = (element) => !!(element && element.offsetParent !== null);
const text = (document.body && document.body.innerText) || "";
if (/captcha|security check|验证码|安全验证|二次验证|one.time.password|otp/i.test(location.href + " " + text)) {
  return { attempted: false, requiresManual: true, reason: "Shopee 要求验证码或安全验证。" };
}
const inputs = Array.from(document.querySelectorAll("input") || []).filter(visible);
const password = inputs.find((element) => element.type === "password" || /password|密码|kata sandi|mật khẩu/i.test((element.name || "") + " " + (element.placeholder || "")));
const buttons = Array.from(document.querySelectorAll("button, [role=button], input[type=submit]") || []).filter(visible);
const label = (element) => String(
  element.innerText
  || element.textContent
  || element.getAttribute("aria-label")
  || element.getAttribute("title")
  || ""
).trim();
const enabled = (element) => !!(element && !element.disabled && element.getAttribute("aria-disabled") !== "true");
const nativeSelectorsFor = (element, marker) => {
  const selectors = [];
  const tag = String(element && element.tagName || "").toLowerCase();
  const addStableAttribute = (name) => {
    const value = String(element && element.getAttribute(name) || "").trim();
    if (!value || !/^[a-z0-9_.:-]+$/i.test(value)) return;
    const selector = '[' + name + '="' + value + '"]';
    const matches = Array.from(document.querySelectorAll(selector) || []).filter(visible);
    if (matches.length === 1 && matches[0] === element) selectors.push(selector);
  };
  addStableAttribute("elementtiming");
  addStableAttribute("data-testid");
  addStableAttribute("id");
  addStableAttribute("name");
  const type = String(element && (element.type || element.getAttribute("type")) || "").toLowerCase();
  if (tag && type) {
    const typed = tag + '[type="' + type + '"]';
    const matches = Array.from(document.querySelectorAll(typed) || []).filter(visible);
    if (matches.length === 1 && matches[0] === element) selectors.push(typed);
  }
  element.setAttribute("data-tz-login-target", marker);
  selectors.push('[data-tz-login-target="' + marker + '"]');
  return Array.from(new Set(selectors));
};
const passwordToggle = (element) => /show password|hide password|password.*(?:show|hide)|eye|visibility|显示密码|隐藏密码/i.test([
  label(element),
  element && element.getAttribute("aria-label"),
  element && element.getAttribute("title"),
  element && typeof element.className === "string" ? element.className : "",
].filter(Boolean).join(" "));
const savedAccount = buttons.find((element) => enabled(element) && /继续|使用此账号|continue|saved account|lanjutkan|一键登录/i.test(label(element)));
const submit = buttons.find((element) => enabled(element) && element.getAttribute("elementtiming") === "shopee:heroComponentPaint")
  || buttons.find((element) => enabled(element) && !passwordToggle(element) && /登录|登入|log[ -]?in|sign[ -]?in|masuk|đăng nhập|继续登录/i.test(label(element)))
  || buttons.find((element) => enabled(element) && !passwordToggle(element) && String(element.type || element.getAttribute("type") || "").toLowerCase() === "submit");
const loginUrl = /\\/account\\/signin|\\/login|accounts\\.shopee/i.test(location.href);
if (!loginUrl && !password && !submit && !savedAccount) {
  return { attempted: false, alreadyLoggedIn: true };
}
if (savedAccount) {
  const nativeSelectors = nativeSelectorsFor(savedAccount, "saved-account");
  return { attempted: true, nativeClick: true, nativeSelectors, nativeSelector: nativeSelectors[0], method: "saved-account" };
}
if (password && enabled(submit)) {
  const nativeSelectors = nativeSelectorsFor(submit, "login-button");
  return { attempted: true, nativeClick: true, nativeSelectors, nativeSelector: nativeSelectors[0], method: "login-button" };
}
return {
  attempted: false,
  autofillMissing: true,
  reason: password
    ? "Shopee 登录按钮尚不可用，请确认紫鸟已记住账号密码。"
    : "没有找到可安全提交的 Shopee 登录入口。"
};
`;
}

/**
 * 页面核对：把商业分析首页切到「昨天」+「已付款订单」，读出页面上显示的支付金额、订单数、访客数。
 * 与接口取数完全独立（读的是页面文字），用于发现字段口径错误、模板失效。
 * expectDate：页面上应出现的日期文字（DD-MM-YYYY）；读完后把订单口径切回原来的选项，不改变运营的页面习惯。
 */
function pageCheckBody({ expectDate }) {
  return `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vis = (e) => !!(e && e.offsetParent !== null);
const leaves = () => [...document.querySelectorAll("body *")].filter((e) => e.children.length === 0 && vis(e));
const bodyText = () => (document.body && document.body.innerText) || "";
const expect = ${JSON.stringify(expectDate)};
const PAID = /paid order|已付款|已付款订单|已支付|pesanan dibayar|dibayar|đã thanh toán|ชำระเงินแล้ว|pedidos? pagos?|pago/i;
const ORDER_TYPE = /placed order|confirmed order|paid order|已下单|已确认|已付款|pesanan dibuat|pesanan dikonfirmasi|pesanan dibayar|đã đặt|đã xác nhận|đã thanh toán|สั่งซื้อ|ยืนยัน|ชำระ/i;
const result = { lang: document.documentElement.lang || "", href: location.href, period: "", orderType: "", restored: "", values: {}, notes: [] };
for (let i = 0; i < 20 && !document.querySelector(".eds-date-shortcut-item__text, span.label"); i += 1) await sleep(500);
// 1. 打开日期选择器，点第二个快捷项（昨天）。快捷项顺序：实时、昨天、近 7 天…，与界面语言无关。
let shortcuts = [...document.querySelectorAll(".eds-date-shortcut-item__text")].filter(vis);
if (shortcuts.length < 2) {
  const labels = [...document.querySelectorAll("span.label")].filter(vis);
  const trigger = labels.find((e) => e.closest("[class*=date], [class*=picker], [class*=period]")) || labels[0];
  if (trigger) { trigger.click(); await sleep(1200); }
  shortcuts = [...document.querySelectorAll(".eds-date-shortcut-item__text")].filter(vis);
}
if (shortcuts.length < 2) { result.notes.push("找不到日期选择器"); return result; }
shortcuts[1].click();
for (let i = 0; i < 20 && !bodyText().includes(expect); i += 1) await sleep(500);
if (!bodyText().includes(expect)) { result.notes.push("页面日期没有切到 " + expect); return result; }
result.period = expect;
// 2. 订单口径切到「已付款」。
const selectors = [...document.querySelectorAll(".eds-selector__inner")].filter(vis);
const selector = selectors.find((e) => ORDER_TYPE.test(e.textContent || "")) || null;
let original = "";
if (selector) {
  original = (selector.textContent || "").trim();
  if (!PAID.test(original)) {
    selector.click();
    await sleep(800);
    const option = leaves().find((e) => PAID.test((e.textContent || "").trim()) && e !== selector);
    if (option) { option.click(); await sleep(4500); } else { result.notes.push("找不到「已付款」选项"); }
  } else {
    await sleep(2500);
  }
  result.orderType = (selector.textContent || "").trim();
} else {
  result.notes.push("找不到订单口径选择");
  await sleep(2500);
}
// 3. 读关键指标：标签后面三行内的第一个数字。
const lines = bodyText().split(/\\n+/).map((s) => s.trim()).filter(Boolean);
const LABELS = {
  sales: /^(sales|销售额|销售|penjualan|doanh số|ยอดขาย|vendas|ventas)$/i,
  orders: /^(orders|订单|订单数|pesanan|đơn hàng|คำสั่งซื้อ|pedidos)$/i,
  visitors: /^(visitors|访客|访客数|pengunjung|lượt truy cập|người truy cập|ผู้เยี่ยมชม|visitantes)$/i,
};
const NUM = /^[^0-9\\s]{0,4}\\s?[0-9][0-9.,]*\\s?[kKmM]?$/;
for (const [key, re] of Object.entries(LABELS)) {
  for (let i = 0; i < lines.length && !result.values[key]; i += 1) {
    if (!re.test(lines[i])) continue;
    for (let j = i + 1; j <= i + 3 && j < lines.length; j += 1) {
      if (LABELS.sales.test(lines[j]) || LABELS.orders.test(lines[j]) || LABELS.visitors.test(lines[j])) break;
      if (NUM.test(lines[j])) { result.values[key] = lines[j]; break; }
    }
  }
}
result.paid = PAID.test(result.orderType || "");
result.keepOrderType = original;
return result;
`;
}

/** 页面核对后把订单口径切回原来的选项（截图之后调用）。 */
function restoreOrderTypeBody(original) {
  return `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const want = ${JSON.stringify(original || "")};
if (!want) return { restored: false };
const selector = [...document.querySelectorAll(".eds-selector__inner")].find((e) => e.offsetParent !== null && /order|订单|pesanan|đơn|คำสั่ง|pedido/i.test(e.textContent || ""));
if (!selector || (selector.textContent || "").trim() === want) return { restored: false };
selector.click();
await sleep(800);
const option = [...document.querySelectorAll("body *")].find((e) => e.children.length === 0 && e.offsetParent !== null && (e.textContent || "").trim() === want && e !== selector);
if (option) option.click();
return { restored: Boolean(option) };
`;
}

module.exports = { hookBody, probeBody, pageInfoBody, replayBody, orderReportBody, loginRecoveryBody, pageCheckBody, restoreOrderTypeBody };
