"use strict";

// 端到端测试：模拟紫鸟 CLI + 模拟 Shopee 卖家中心 + 模拟中台。
// 运行：node --test test/

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const { ZiniaoCli, findMarkedString, decodeMarked, parseJsonLoose } = require("../core/ziniao");
const { ConfigStore } = require("../core/config");
const { Collector, defaultDates, businessError } = require("../core/collector");
const { ZhongtaiClient } = require("../core/zhongtai");
const { templatizeRequest, readPath, extractMetrics, placeholderValues, fill } = require("../core/recipe");
const { dayRange, siteToday, dateList } = require("../core/sites");
const { dueSlots } = require("../core/scheduler");
const { startMockBrowser, metricsFor, ORIGIN } = require("./mock-browser");

const TOKEN = "test-ingest-token-0123456789abcdef";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tzzs-test-"));
}

function cliWrapper(dir) {
  // 用 shell 包装成「可执行文件」，模拟真实 exe 的调用方式（spawn 不经过 shell）。
  const file = path.join(dir, "ziniao-cli");
  fs.writeFileSync(file, `#!/bin/sh\nexec "${process.execPath}" "${path.join(__dirname, "mock-ziniao-cli.js")}" "$@"\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

function startMockZhongtai() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.headers["x-ingest-token"] !== TOKEN) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ ok: false, message: "采集令牌无效。" }));
      }
      if (req.url === "/api/shop-daily-report/ingest/shops") {
        return res.end(JSON.stringify({ ok: true, shops: [{ shopKey: "k1", shopName: "店铺A-MY", country: "马来西亚", platform: "Shopee" }] }));
      }
      const body = JSON.parse(raw || "{}");
      requests.push(body);
      const rows = body.rows || [];
      res.end(JSON.stringify({
        ok: true,
        dryRun: Boolean(body.dryRun),
        rowCount: rows.length,
        shopCount: new Set(rows.map((row) => row.shopName)).size,
        errors: [],
        warnings: [],
        sample: rows.slice(0, 30).map((row) => ({ shopKey: row.shopName, ...row })),
        ...(body.dryRun ? {} : { written: rows.length }),
      }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((done) => server.close(done)) })));
}

async function setup({ options = {}, stores } = {}) {
  const dir = tempDir();
  const storeList = stores || [
    { storeId: "1001", storeName: "紫鸟-店铺A", shopIds: ["111", "222"] },
    { storeId: "1002", storeName: "紫鸟-店铺B", shopIds: ["333"], loggedOut: true },
  ];
  const browser = await startMockBrowser({ stores: storeList, options });
  const zhongtai = await startMockZhongtai();
  const logs = [];
  const cli = new ZiniaoCli({ cliPath: cliWrapper(dir), extraEnv: { MOCK_ZINIAO_URL: browser.url }, log: (level, message) => logs.push(`${level} ${message}`) });
  const store = new ConfigStore(path.join(dir, "data"));
  store.update((config) => {
    config.zhongtai.baseUrl = zhongtai.url;
    config.ziniao.retryPerStore = 0;
  });
  const collector = new Collector({ cli, store, log: (level, message) => logs.push(`${level} ${message}`), zhongtaiFactory: () => new ZhongtaiClient({ baseUrl: zhongtai.url, token: TOKEN }), waits: { fresh: 10, reused: 10, visit: 10, retry: 10 } });
  return { dir, browser, zhongtai, cli, store, collector, logs, async close() {
    await browser.close();
    await zhongtai.close();
  } };
}

test("工具函数：日期、时区、取值、占位符", () => {
  assert.deepEqual(dayRange("2026-11-04", "MY"), { start: Date.parse("2026-11-03T16:00:00Z") / 1000, end: Date.parse("2026-11-04T15:59:59Z") / 1000 });
  assert.equal(dayRange("2026-11-04", "ID").start, Date.parse("2026-11-03T17:00:00Z") / 1000);
  assert.equal(siteToday("BR", Date.parse("2026-11-05T02:00:00Z")), "2026-11-04");
  assert.deepEqual(dateList("2026-10-30", "2026-11-02"), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  assert.deepEqual(defaultDates({ lookbackDays: 3, site: "MY", now: Date.parse("2026-11-05T01:00:00Z") }), ["2026-11-02", "2026-11-03", "2026-11-04"]);
  assert.equal(readPath({ a: { list: [{ v: 1 }, { v: "2.5" }] } }, "a.list[*].v"), 3.5);
  assert.equal(readPath({ a: [{ b: { c: "1,234" } }] }, "a[0].b.c"), 1234);
  assert.equal(readPath({ a: 1 }, "x.y"), null);
  assert.equal(fill("t={startTs}&k={unknown}", placeholderValues({ date: "2026-11-04", site: "SG" })), `t=${dayRange("2026-11-04", "SG").start}&k={unknown}`);
  assert.equal(businessError({ code: 0, data: {} }), "");
  assert.equal(businessError({ code: 401, message: "need login" }), "need login");
  assert.equal(businessError({ error: 0 }), "");
});

test("紫鸟输出解析：标记字符串可在任意位置、可被二次编码", () => {
  assert.deepEqual(decodeMarked(findMarkedString({ data: { result: 'TZJSON:{"a":1}' } }, "TZJSON:")), { a: 1 });
  assert.deepEqual(decodeMarked(findMarkedString({ data: { value: JSON.stringify('TZJSON:{"a":[1,2]}') } }, "TZJSON:")), { a: [1, 2] });
  assert.deepEqual(parseJsonLoose('提示：xxx\n{"ok":true,"data":1}'), { ok: true, data: 1 });
});

test("模板生成：时间戳、店铺 ID、csrf 头替换为占位符", () => {
  const start = Math.floor(Date.now() / 1000) - 86400 * 3;
  const { endpoint, replaced } = templatizeRequest({
    method: "POST",
    url: `${ORIGIN}/api/pas/v1/report/get_shop_report/?cnsc_shop_id=111&SPC_CDS=abc`,
    body: JSON.stringify({ start_time: start, end_time: start + 86399, shop_id: 111, filter: { day: "2026-11-01" } }),
    headers: { "x-csrftoken": "tok123", cookie: "should-drop", "content-type": "application/json" },
  }, { shopIds: ["111"], cookies: { csrftoken: "tok123" } });
  assert.equal(endpoint.url, "{origin}/api/pas/v1/report/get_shop_report/?cnsc_shop_id={shopId}");
  assert.equal(endpoint.body, '{"start_time":{startTs},"end_time":{endTs},"shop_id":{shopId},"filter":{"day":"{date}"}}');
  assert.deepEqual(endpoint.headers, { "x-csrftoken": "{cookie:csrftoken}", "content-type": "application/json" });
  assert.ok(replaced.length >= 3);
});

test("校准 → 试采 → 正式采集 → 写入中台（含 CNSC 多站点、掉登录店铺）", async (t) => {
  const env = await setup({ options: { functionBody: true, socksFailOnce: true } });
  t.after(() => env.close());
  const { collector, store, browser, zhongtai, logs } = env;

  // 店铺列表
  const stores = await collector.refreshStores();
  assert.equal(stores.length, 2);
  assert.equal(stores[0].storeName, "紫鸟-店铺A");

  // 1. 探测：首次只能看到 GET 接口（POST 广告接口发生在运营操作之后）
  const pageUrl = `${ORIGIN}/datacenter/dashboard`;
  const first = await collector.discover({ storeId: "1001", pageUrl });
  assert.ok(logs.some((line) => /代理连接失败/.test(line)), "SOCKS 失败应自动重试");
  const keyMetrics = first.requests.find((request) => request.url.includes("key-metrics"));
  assert.ok(keyMetrics, "应通过 performance 记录 + 重新请求拿到 key-metrics");
  assert.ok(keyMetrics.numberCount > 5);

  // 2. 运营在紫鸟窗口里打开广告报表后再抓一次（不重新导航）
  browser.pages.get("1001").interactAds();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const second = await collector.discover({ storeId: "1001", pageUrl, reopen: false });
  const ads = second.requests.find((request) => request.url.includes("get_shop_report"));
  assert.ok(ads, "记录器应捕获 POST 广告接口");
  assert.equal(ads.method, "POST");

  // 3. 生成模板 + 字段建议
  const built = collector.buildTemplate({ storeId: "1001", indexes: [keyMetrics.index, ads.index], name: "Shopee CNSC", shopIds: ["111", "222"] });
  const [traffic, adsEndpoint] = built.template.endpoints;
  assert.match(traffic.url, /start_ts=\{startTs\}&end_ts=\{endTs\}/);
  assert.match(traffic.url, /cnsc_shop_id=\{shopId\}/);
  assert.match(adsEndpoint.body, /"start_time":\{startTs\}/);
  assert.ok(adsEndpoint.headers["x-csrftoken"]);
  const s = built.suggestions;
  assert.equal(s.visitors?.path, "data.metrics.uv.value");
  assert.equal(s.impressions?.path, "data.metrics.pv.value");
  assert.equal(s.addToCart?.path, "data.metrics.atc_users.value");
  assert.equal(s.orderCount?.path, "data.metrics.placed_orders.value");
  assert.equal(s.payAmount?.path, "data.metrics.placed_sales.value");
  assert.equal(s.adOnsite?.path, "data.report.cost");
  assert.equal(s.adOnsite?.endpoint, adsEndpoint.id);
  // 人工校准：广告花费单位是 1/100000
  built.template.metrics.adOnsite.scale = 100000;
  const saved = store.upsertTemplate(built.template);

  // 4. 试采
  const date = "2026-11-03";
  const trial = await collector.testTemplate({ storeId: "1001", template: saved, date, target: { country: "MY", shopId: "222" } });
  const expected = metricsFor("222", dayRange(date, "MY").start);
  assert.equal(trial.values.visitors, expected.uv);
  assert.equal(trial.values.payAmount, expected.sales);
  assert.equal(trial.values.adOnsite, Math.round((50 + expected.atc / 10) * 100) / 100);
  assert.deepEqual(trial.missing, []);

  // 5. 店铺映射：店铺A 下两个站点；店铺B 掉登录
  store.upsertStore({ storeId: "1001", storeName: "紫鸟-店铺A", platform: "shopee", enabled: true, templateId: saved.id, targets: [
    { shopName: "店铺A-MY", country: "MY", shopId: "111" },
    { shopName: "店铺A-PH", country: "PH", shopId: "222", currency: "PHP" },
  ] });
  store.upsertStore({ storeId: "1002", storeName: "紫鸟-店铺B", platform: "shopee", enabled: true, templateId: saved.id, targets: [{ shopName: "店铺B-TH", country: "TH", shopId: "333" }] });
  store.upsertStore({ storeId: "1003", storeName: "未配置", platform: "shopee", enabled: true, templateId: "", targets: [] });

  // 6. 预览（中台试匹配）
  const dates = ["2026-11-02", "2026-11-03"];
  const progress = [];
  const preview = await collector.collect({ dates, mode: "preview", onProgress: (event) => progress.push(event) });
  assert.equal(preview.rowCount, 4);
  assert.equal(preview.upload.dryRun, true);
  assert.equal(zhongtai.requests.at(-1).dryRun, true);
  assert.equal(preview.status, "partial");
  const storeB = preview.stores.find((item) => item.storeId === "1002");
  assert.equal(storeB.status, "failed");
  assert.match(storeB.message, /未登录/);
  assert.equal(preview.stores.find((item) => item.storeId === "1003"), undefined, "紫鸟里不存在的店铺不参与");
  assert.ok(progress.some((event) => event.phase === "upload"));

  // 7. 正式写入（先关掉校准时打开的窗口，验证采集后会关闭自己打开的窗口）
  await env.cli.closeStore({ storeId: "1001" });
  const run = await collector.collect({ dates, mode: "upload" });
  const sent = zhongtai.requests.at(-1);
  assert.equal(sent.dryRun, false);
  assert.equal(sent.source, "ziniao");
  assert.equal(sent.rows.length, 4);
  const row = sent.rows.find((item) => item.shopName === "店铺A-MY" && item.date === "2026-11-03");
  const m = metricsFor("111", dayRange("2026-11-03", "MY").start);
  assert.deepEqual(row, {
    date: "2026-11-03", shopName: "店铺A-MY", country: "马来西亚", platform: "Shopee", currency: "MYR",
    visitors: m.uv, impressions: m.pv, addToCart: m.atc, orderCount: m.orders, payAmount: m.sales,
    adOnsite: Math.round((50 + m.atc / 10) * 100) / 100,
  });
  assert.equal(sent.rows.find((item) => item.shopName === "店铺A-PH").currency, "PHP");
  assert.equal(run.upload.written, 4);
  // 采集后关闭本次打开的窗口
  assert.ok(!browser.pages.has("1001"));

  // 8. 历史与重新上传
  const history = store.history();
  assert.equal(history[0].id, run.id);
  assert.equal(store.resultRows(run.id).length, 4);
  const again = await collector.reupload(run.id);
  assert.equal(again.written, 4);
});

test("CLI 把脚本当作表达式时同样可用；中台令牌错误时给出明确提示", async (t) => {
  const env = await setup({ options: { functionBody: false } });
  t.after(() => env.close());
  const info = await env.cli.openStore({ storeId: "1001" });
  assert.equal(info.reused, false);
  const value = await env.cli.runInPage("1001", "await new Promise((r) => setTimeout(r, 30)); return { href: location.href, n: 1 + 1 };", { pollMs: 50 });
  assert.equal(value.n, 2);
  assert.equal(env.cli.execStyle.wrap, "expr");
  await assert.rejects(() => env.cli.runInPage("1001", "throw new Error('boom')", { pollMs: 50 }), /boom/);

  const bad = new ZhongtaiClient({ baseUrl: env.zhongtai.url, token: "wrong-token-wrong-token-xx" });
  await assert.rejects(() => bad.ping(), /采集令牌无效/);
  const good = new ZhongtaiClient({ baseUrl: env.zhongtai.url, token: TOKEN });
  assert.equal((await good.ping()).ok, true);
  assert.equal((await good.listShops()).length, 1);
  await assert.rejects(() => new ZhongtaiClient({ baseUrl: "", token: TOKEN }).ping(), /中台地址/);
});

test("定时：到点触发一次、错过 2 小时内补跑、不重复", () => {
  const now = new Date(2026, 10, 5, 9, 40);
  const due = dueSlots({ times: ["09:30", "21:00", "bad"], now });
  assert.deepEqual(due, ["2026-11-05 09:30"]);
  assert.deepEqual(dueSlots({ times: ["09:30"], now, done: new Set(due) }), []);
  assert.deepEqual(dueSlots({ times: ["06:00"], now }), []);
});

test("取值：缺字段与比例换算", () => {
  const template = { metrics: { visitors: { endpoint: "e1", path: "a.uv" }, adOnsite: { endpoint: "e2", path: "cost", scale: 100000 } } };
  const result = extractMetrics(template, { e1: { json: { a: { uv: "12.6" } } }, e2: { error: "HTTP 500" } });
  assert.deepEqual(result.values, { visitors: 13 });
  assert.deepEqual(result.missing, ["adOnsite"]);
});

test("零配置：识别站点、内置模板取值、自动对应中台店铺", () => {
  const shopee = require("../core/platforms/shopee");
  assert.deepEqual(shopee.storeSite({ platformName: "Shopee-印尼-本土" }), { site: "ID", sellerCenter: "ID" });
  assert.deepEqual(shopee.storeSite({ platformName: "Shopee-马来西亚-本土" }), { site: "MY", sellerCenter: "MY" });
  assert.equal(shopee.matchStore({ platformName: "TikTok Shop-印尼-本土" }), false);
  const [builtin] = shopee.builtinTemplates();
  const { values } = extractMetrics(builtin, {
    km: { json: { code: 0, result: { paid_gmv: { value: 198000 }, paid_orders: { value: 1 }, shop_uv: { value: 10 } } } },
    product: { json: { atc_uv: { value: 2 } } },
    traffic: { json: { code: 0, result: { product_card: { total: { product_impressions: 1069 } } } } },
    ads: { json: { code: 0, data: { report_by_time: [{ metrics: { cost: 15270861 } }] } } },
  });
  assert.deepEqual(values, { payAmount: 198000, orderCount: 1, visitors: 10, addToCart: 2, impressions: 1069, adOnsite: 152.71 });
  const values2 = placeholderValues({ date: "2026-11-03", site: "ID", origin: "https://seller.shopee.co.id" });
  assert.equal(fill(builtin.endpoints[0].url, values2), "https://seller.shopee.co.id/api/mydata/v3/dashboard/key-metrics/?start_time=1793638800&end_time=1793725200&period=day&fetag=fetag");

  const dir = tempDir();
  const store = new ConfigStore(dir);
  store.update((config) => {
    config.storeCache = [
      { storeId: "1", storeName: "SJJ Beauty Official Store", platformName: "Shopee-印尼-本土" },
      { storeId: "2", storeName: "YN-XP0003", platformName: "Shopee-印尼-本土" },
      { storeId: "3", storeName: "印尼TK1", platformName: "TikTok Shop-印尼-本土" },
    ];
    config.zhongtaiShops = [{ shopKey: "k-sjj", shopName: "SJJ Beauty Official Store", countryCode: "ID" }, { shopKey: "k-my", shopName: "YN-XP0003", countryCode: "MY" }];
    config.stores = { 2: { storeId: "2", enabled: false } };
  });
  const collector = new Collector({ cli: {}, store, zhongtaiFactory: () => null });
  const { plan } = collector.plan();
  assert.equal(plan.length, 1);
  assert.equal(plan[0].origin, "https://seller.shopee.co.id");
  assert.equal(plan[0].targets[0].shopKey, "k-sjj");
  const overview = collector.storeOverview();
  assert.equal(overview.length, 2);
  assert.equal(overview.find((item) => item.storeId === "2").targets[0].matched, false, "站点不同不自动对应");
});

test("节点代理：下次定时时间", () => {
  const { nextRunAt } = require("../core/agent");
  const now = new Date(2026, 10, 9, 10, 0);
  assert.equal(new Date(nextRunAt({ enabled: true, times: ["09:30", "21:30"] }, now)).getHours(), 21);
  const tomorrow = new Date(nextRunAt({ enabled: true, times: ["09:30"] }, now));
  assert.equal(tomorrow.getDate(), 10);
  assert.equal(nextRunAt({ enabled: false, times: ["09:30"] }, now), "");
});
