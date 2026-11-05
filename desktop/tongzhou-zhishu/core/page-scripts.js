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

/** 页面基本信息（用于判断是否掉登录）。 */
function pageInfoBody() {
  return `return { href: location.href, title: document.title, ready: document.readyState, text: (document.body && document.body.innerText || "").slice(0, 600) };`;
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

module.exports = { hookBody, probeBody, pageInfoBody, replayBody };
