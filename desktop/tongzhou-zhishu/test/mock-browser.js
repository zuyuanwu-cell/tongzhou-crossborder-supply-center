"use strict";

// 测试用：模拟「紫鸟店铺浏览器 + 已登录的 Shopee 卖家中心」。
// 每个店铺是一个 vm 上下文（window/document/fetch/XHR/performance），
// 模拟的卖家中心接口按日期和店铺 ID 返回确定性的数值，便于断言。

const http = require("node:http");
const vm = require("node:vm");

const ORIGIN = "https://seller.shopee.cn";

function metricsFor(shopId, startTs) {
  const day = Math.floor(startTs / 86400) % 100;
  const base = Number(shopId) % 1000;
  return {
    uv: 1000 + base + day,
    pv: 5000 + base + day,
    atc: 100 + day,
    orders: 20 + (day % 7),
    sales: 1234.5 + day,
  };
}

function shopeeApi({ method, url, headers, body, cookies }) {
  const parsed = new URL(url);
  if (parsed.origin !== ORIGIN) return { status: 0, error: "TypeError: Failed to fetch (CORS)" };
  if (parsed.pathname === "/api/mydata/v3/dashboard/key-metrics/") {
    const start = Number(parsed.searchParams.get("start_ts"));
    const end = Number(parsed.searchParams.get("end_ts"));
    if (!start || !end || end <= start) return { status: 200, json: { code: 10001, message: "invalid time range" } };
    const shopId = parsed.searchParams.get("cnsc_shop_id") || "0";
    const m = metricsFor(shopId, start);
    return {
      status: 200,
      json: {
        code: 0,
        data: {
          period: { start_ts: start, end_ts: end },
          metrics: {
            uv: { value: m.uv, chain_ratio: 0.12, previous: m.uv - 50 },
            pv: { value: m.pv, chain_ratio: 0.05 },
            atc_users: { value: m.atc },
            placed_orders: { value: m.orders },
            placed_sales: { value: String(m.sales) },
          },
        },
      },
    };
  }
  if (parsed.pathname === "/api/pas/v1/report/get_shop_report/" && method === "POST") {
    const token = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === "x-csrftoken")?.[1];
    if (token !== cookies.csrftoken) return { status: 403, json: { code: 403, message: "csrf" } };
    const payload = JSON.parse(body || "{}");
    const m = metricsFor(payload.shop_id || 0, payload.start_time);
    return { status: 200, json: { code: 0, data: { report: { cost: Math.round((50 + m.atc / 10) * 100000), impression: m.pv * 2, click: 10 } } } };
  }
  return { status: 404, json: { code: 404, message: "not found" } };
}

class FakePage {
  constructor(store) {
    this.store = store;
    this.cookies = { csrftoken: "csrf-" + store.storeId, SPC_EC: "secret" };
    this.navigate(`${ORIGIN}/datacenter/dashboard?cnsc_shop_id=${store.shopIds[0]}`);
  }

  navigate(href) {
    const page = this;
    this.href = href;
    this.resources = [];
    const doFetch = async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input.url, page.href).href;
      const method = (init.method || "GET").toUpperCase();
      const headers = {};
      if (init.headers) Object.assign(headers, init.headers);
      const result = shopeeApi({ method, url, headers, body: init.body, cookies: page.cookies });
      page.resources.push({ name: url, initiatorType: "fetch" });
      if (result.error) throw new TypeError(result.error);
      const textValue = JSON.stringify(result.json);
      const response = {
        status: result.status,
        ok: result.status >= 200 && result.status < 300,
        text: async () => textValue,
        json: async () => JSON.parse(textValue),
        clone: () => response,
      };
      return response;
    };
    class XMLHttpRequest {
      open(method, url) {
        this.method = method;
        this.url = url;
        this.listeners = {};
      }
      setRequestHeader() {}
      addEventListener(name, fn) {
        this.listeners[name] = fn;
      }
      send(body) {
        doFetch(this.url, { method: this.method, body }).then(async (response) => {
          this.status = response.status;
          this.responseText = await response.text();
          this.listeners.loadend && this.listeners.loadend();
        });
      }
    }
    const window = {
      location: { get href() { return page.href; } },
      document: {
        title: "Shopee 卖家中心 - 商业分析",
        readyState: "complete",
        get cookie() { return Object.entries(page.cookies).filter(([key]) => key !== "SPC_EC").map(([key, value]) => `${key}=${value}`).join("; "); },
        body: { innerText: "商业分析 访客数 浏览量" },
      },
      performance: { getEntriesByType: () => page.resources.slice() },
      fetch: doFetch,
      XMLHttpRequest,
      URL,
      setTimeout,
      console,
    };
    window.window = window;
    this.context = vm.createContext(window);
    // 页面首次加载时请求的接口（发生在记录器安装之前，只能从 performance 里看到地址）。
    const now = Math.floor(Date.now() / 1000);
    const start = now - 7 * 86400 - (now % 86400) - 8 * 3600;
    this.resources.push({ name: `${ORIGIN}/api/mydata/v3/dashboard/key-metrics/?start_ts=${start}&end_ts=${start + 7 * 86400 - 1}&period=past7days&cnsc_shop_id=${this.store.shopIds[0]}`, initiatorType: "xmlhttprequest" });
    this.resources.push({ name: `${ORIGIN}/api/selleraccount/shop_info/?cnsc_shop_id=${this.store.shopIds[0]}`, initiatorType: "fetch" });
  }

  evaluate(script) {
    return vm.runInContext(script, this.context, { timeout: 5000 });
  }

  /** 模拟运营在窗口里打开广告报表：页面发出一个 POST 接口。 */
  interactAds() {
    const now = Math.floor(Date.now() / 1000);
    const start = now - 86400 - (now % 86400) - 8 * 3600;
    return vm.runInContext(`fetch("${ORIGIN}/api/pas/v1/report/get_shop_report/", { method: "POST", headers: { "content-type": "application/json", "x-csrftoken": document.cookie.match(/csrftoken=([^;]+)/)[1] }, body: JSON.stringify({ start_time: ${start}, end_time: ${start + 86399}, shop_id: ${this.store.shopIds[0]}, campaign_type: "all" }) })`, this.context);
  }
}

function startMockBrowser({ stores, options = {} }) {
  const pages = new Map();
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", async () => {
      const args = JSON.parse(raw || "[]");
      calls.push(args);
      const reply = (code, stdout, stderr = "") => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ code, stdout, stderr }));
      };
      const flag = (name) => {
        const index = args.indexOf(name);
        return index >= 0 ? args[index + 1] : undefined;
      };
      const ok = (data) => reply(0, JSON.stringify({ ok: true, data }));
      try {
        if (args.includes("--help")) {
          if (args[0] === "page" && args[1] === "exec") return reply(0, "Usage: ziniao-cli page exec --store-id <id> --script <js> [--target-id]");
          return reply(0, "Usage");
        }
        if (args[0] === "--version") return reply(0, "ziniao-cli version 1.2.0 (mock)");
        if (args[0] === "doctor") return ok({ checks: [{ name: "bridge", ok: true }] });
        if (args[0] === "store" && args[1] === "list") return ok({ list: stores.map((store) => ({ storeId: store.storeId, storeName: store.storeName, platformName: "Shopee", ip: "1.2.3.4" })) });
        if (args[0] === "store" && args[1] === "open") {
          const id = flag("--id");
          const store = stores.find((item) => item.storeId === id);
          if (!store) return reply(1, "", JSON.stringify({ ok: false, error: { type: "business", code: "STORE_NOT_FOUND", message: "店铺不存在" } }));
          if (options.socksFailOnce && !options.socksFailed) {
            options.socksFailed = true;
            return reply(1, "", JSON.stringify({ ok: false, error: { type: "network", code: "ERR_SOCKS_CONNECTION_FAILED", message: "net::ERR_SOCKS_CONNECTION_FAILED" } }));
          }
          const reused = pages.has(id);
          if (!reused) pages.set(id, new FakePage(store));
          if (store.loggedOut) pages.get(id).href = "https://accounts.shopee.cn/seller/login";
          else if (flag("--url")) pages.get(id).navigate(flag("--url"));
          return ok({ storeId: id, reused });
        }
        if (args[0] === "store" && args[1] === "close") {
          pages.delete(flag("--id"));
          return ok({ closed: true });
        }
        if (args[0] === "page" && args[1] === "visit") {
          pages.get(flag("--store-id")).navigate(flag("--url"));
          return ok({ url: flag("--url") });
        }
        if (args[0] === "page" && args[1] === "exec") {
          const page = pages.get(flag("--store-id"));
          if (!page) return reply(1, "", JSON.stringify({ ok: false, error: { type: "business", code: "STORE_NOT_OPEN", message: "店铺未打开" } }));
          const script = flag("--script");
          // 模拟真实 CLI：脚本被当作函数体执行（必须 return），结果放在 data.result。
          if (options.functionBody) {
            const value = page.evaluate(`(function(){${script}\n})()`);
            return ok({ result: value === undefined ? null : value });
          }
          const value = page.evaluate(script);
          return ok({ result: value === undefined ? null : value, type: typeof value });
        }
        return reply(1, "", JSON.stringify({ ok: false, error: { type: "validation", code: "UNKNOWN", message: `unknown command ${args.join(" ")}` } }));
      } catch (error) {
        return reply(1, "", JSON.stringify({ ok: false, error: { type: "unknown", code: "MOCK", message: error.message } }));
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    url: `http://127.0.0.1:${server.address().port}`,
    pages,
    calls,
    close: () => new Promise((done) => server.close(done)),
  })));
}

module.exports = { startMockBrowser, metricsFor, ORIGIN };
