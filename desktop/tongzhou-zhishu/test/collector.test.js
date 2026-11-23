"use strict";

// 端到端测试：模拟紫鸟 CLI + 模拟 Shopee 卖家中心 + 模拟中台。
// 运行：node --test test/

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { deflateRawSync } = require("node:zlib");

const {
  ZiniaoCli,
  findMarkedString,
  decodeMarked,
  parseJsonLoose,
  estimateCommandLineUnits,
  MAX_WINDOWS_COMMAND_LINE_UNITS,
} = require("../core/ziniao");
const { ConfigStore } = require("../core/config");
const { Collector, defaultDates, businessError, buildReplayBatches, isCommandLineTooLong } = require("../core/collector");
const { ZhongtaiClient } = require("../core/zhongtai");
const { templatizeRequest, readPath, extractMetrics, placeholderValues, fill } = require("../core/recipe");
const { dayRange, siteToday, dateList } = require("../core/sites");
const { dueSlots } = require("../core/scheduler");
const { SHOPEE_REPORT_SCHEMA_VERSION, columnMap, orderReportWindows, parseMoney, parseShopeeOrderReport } = require("../core/shopee-order-report");
const { startMockBrowser, metricsFor, ORIGIN } = require("./mock-browser");

const TOKEN = "test-ingest-token-0123456789abcdef";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tzzs-test-"));
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipFiles(files) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name);
    const source = Buffer.from(content);
    const compressed = deflateRawSync(source);
    const checksum = crc32(source);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(source.length, 22);
    header.writeUInt16LE(nameBuffer.length, 26);
    local.push(header, nameBuffer, compressed);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(8, 10);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(source.length, 24);
    directory.writeUInt16LE(nameBuffer.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, nameBuffer);
    offset += header.length + nameBuffer.length + compressed.length;
  }
  const localData = Buffer.concat(local);
  const centralData = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(localData.length, 16);
  return Buffer.concat([localData, centralData, end]);
}

function xlsxColumn(index) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function escapeXml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fakeShopeeOrderXlsx(rows) {
  const xmlRows = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => `<c r="${xlsxColumn(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`).join("")}</row>`).join("");
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:A1"/><sheetData>${xmlRows}</sheetData></worksheet>`;
  return zipFiles({ "xl/worksheets/sheet1.xml": sheet });
}

function cliWrapper() {
  // 测试环境统一通过 Node 启动模拟 CLI，避免 Windows 无法直接执行无扩展名 shell 包装器。
  const script = path.join(__dirname, "mock-ziniao-cli.js");
  return {
    cliPath: process.execPath,
    spawnImpl: (bin, args, options) => spawn(bin, [script, ...args], options),
  };
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
  const cli = new ZiniaoCli({ ...cliWrapper(), extraEnv: { MOCK_ZINIAO_URL: browser.url }, log: (level, message) => logs.push(`${level} ${message}`) });
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

test("采集拆批：保持接口顺序并限制单批请求数", () => {
  const requests = Array.from({ length: 31 }, (_, index) => ({
    key: `batch-${index}`,
    method: "GET",
    url: `https://seller.shopee.test/api/metric?shop=${index}`,
    headers: {},
  }));
  const batches = buildReplayBatches(requests, { maxRequests: 5, maxScriptChars: 12000 });
  assert.equal(batches.length, 7);
  assert.ok(batches.every((batch) => batch.length <= 5));
  assert.deepEqual(batches.flat().map((item) => item.key), requests.map((item) => item.key));
});

test("采集拆批：中间批失败只重试当前批并保留前序结果", async () => {
  const requests = Array.from({ length: 6 }, (_, index) => ({
    key: `retry-${index}`,
    method: "GET",
    url: `https://seller.shopee.test/api/metric?shop=${index}`,
    headers: {},
  }));
  const calls = [];
  let failedOnce = false;
  const cli = {
    async runInPage(_storeId, body) {
      const keys = requests.filter((item) => body.includes(`\"${item.key}\"`)).map((item) => item.key);
      calls.push(keys);
      if (keys.includes("retry-2") && !failedOnce) {
        failedOnce = true;
        const error = new Error("temporary timeout");
        error.code = "TIMEOUT";
        throw error;
      }
      return { results: Object.fromEntries(keys.map((key) => [key, { ok: true, text: "{}" }])) };
    },
  };
  const collector = new Collector({
    cli,
    store: { get: () => ({ ziniao: { retryPerStore: 1 } }) },
    waits: { retry: 0 },
  });
  collector.ensurePage = async () => null;
  const replay = await collector.runReplayBatches({
    storeId: "store-1",
    storeName: "测试店铺",
    requests,
    platform: {},
    page: "https://seller.shopee.test/",
    timeoutMs: 1000,
    maxRequests: 2,
    maxScriptChars: 12000,
  });
  assert.deepEqual(Object.keys(replay.results), requests.map((item) => item.key));
  assert.deepEqual(calls, [
    ["retry-0", "retry-1"],
    ["retry-2", "retry-3"],
    ["retry-2", "retry-3"],
    ["retry-4", "retry-5"],
  ]);
});

test("采集拆批：命令行过长时自动二分到可执行批次", async () => {
  const requests = Array.from({ length: 4 }, (_, index) => ({
    key: `split-${index}`,
    method: "GET",
    url: `https://seller.shopee.test/api/metric?shop=${index}`,
    headers: {},
  }));
  const calls = [];
  const collector = new Collector({
    cli: {
      async runInPage(_storeId, body) {
        const keys = requests.filter((item) => body.includes(`\"${item.key}\"`)).map((item) => item.key);
        calls.push(keys);
        if (keys.length > 1) {
          const error = new Error("spawn ENAMETOOLONG");
          error.code = "ENAMETOOLONG";
          throw error;
        }
        return { results: { [keys[0]]: { ok: true, text: "{}" } } };
      },
    },
    store: { get: () => ({ ziniao: { retryPerStore: 0 } }) },
  });
  const replay = await collector.runReplayBatches({
    storeId: "store-1",
    storeName: "测试店铺",
    requests,
    platform: {},
    page: "https://seller.shopee.test/",
    timeoutMs: 1000,
    maxRequests: 4,
    maxScriptChars: 12000,
  });
  assert.deepEqual(Object.keys(replay.results), requests.map((item) => item.key));
  assert.ok(calls.some((keys) => keys.length > 1));
  assert.equal(calls.filter((keys) => keys.length === 1).length, 4);
  assert.equal(isCommandLineTooLong(Object.assign(new Error("spawn ENAMETOOLONG"), { code: "ENAMETOOLONG" })), true);
});

test("紫鸟 CLI：超出 Windows 安全长度时在启动进程前拒绝", async () => {
  let spawnCount = 0;
  const cli = new ZiniaoCli({
    cliPath: process.execPath,
    spawnImpl: () => {
      spawnCount += 1;
      throw new Error("不应启动进程");
    },
  });
  const args = ["page", "exec", "--script", "x".repeat(20000)];
  assert.ok(estimateCommandLineUnits(process.execPath, args) > MAX_WINDOWS_COMMAND_LINE_UNITS);
  if (process.platform === "win32") {
    await assert.rejects(cli.runRaw(args), (error) => error.code === "COMMAND_LINE_TOO_LONG");
    assert.equal(spawnCount, 0);
  }
});

test("Shopee 官方订单导表：订单去重，支付销售额只减卖家券并保留买家实付", () => {
  const header = Array(41).fill("");
  Object.assign(header, {
    0: "No. Pesanan",
    1: "Status Pesanan",
    9: "Waktu Pesanan Dibuat",
    10: "Waktu Pembayaran Dilakukan",
    21: "Subtotal Pesanan",
    28: "Voucher Ditanggung Penjual",
    30: "Voucher Ditanggung Shopee",
    34: "Potongan Koin Shopee",
    39: "Total Pembayaran",
    40: "Perkiraan Ongkos Kirim",
  });
  const row = (orderId, paidAt, subtotal, total, sellerVoucher = "", platformVoucher = "") => {
    const values = Array(41).fill("");
    Object.assign(values, {
      0: orderId,
      1: "Telah Dikirim",
      9: "2026-11-16 08:00",
      10: paidAt,
      21: subtotal,
      28: sellerVoucher,
      30: platformVoucher,
      39: total,
    });
    return values;
  };
  const report = parseShopeeOrderReport(fakeShopeeOrderXlsx([
    header,
    row("A", "2026-11-17 10:00", "100.000", "125.000", "5.000", "20.000"),
    row("A", "2026-11-17 10:00", "50.000", "125.000"),
    row("B", "17/11/2026 12:00", "80.000", "73.317"),
    row("C", "-", "10.000", "0"),
  ]), { site: "ID" });
  assert.equal(report.rowCount, 4);
  assert.equal(report.uniqueOrderCount, 3);
  assert.equal(report.days["2026-11-17"].orderCount, 2);
  assert.equal(report.days["2026-11-17"].payAmount, 225000);
  assert.equal(report.days["2026-11-17"].buyerPaid, 198317);
  assert.equal(report.days["2026-11-17"].subtotal, 230000);
  assert.equal(report.days["2026-11-17"].sellerVoucher, 5000);
  assert.equal(report.days["2026-11-17"].platformVoucher, 20000);
  assert.equal(parseMoney("1,310.43", "MY"), 1310.43);
  assert.deepEqual(orderReportWindows(["2026-11-01", "2026-11-07", "2026-11-08"]), [
    { startDate: "2026-10-18", endDate: "2026-11-07", dates: ["2026-11-01", "2026-11-07"] },
    { startDate: "2026-10-25", endDate: "2026-11-08", dates: ["2026-11-08"] },
  ]);
});

test("Shopee 官方订单导表：支持中文、越南语和马来语关键表头且未知结构安全失败", () => {
  const header = Array(41).fill("");
  Object.assign(header, {
    0: "\uFEFF订单编号：",
    1: "订单状态",
    9: "订单创建时间",
    10: "付款时间",
    21: "商品小计",
    28: "卖家优惠券",
    39: "买家实付金额",
    40: "预估运费",
  });
  const columns = columnMap(header);
  assert.equal(columns.orderId, 0);
  assert.equal(columns.paidAt, 10);
  assert.equal(columns.totalPayment, 39);

  const vietnamese = [...header];
  vietnamese[0] = "Mã đơn hàng";
  vietnamese[10] = "Thời gian thanh toán";
  vietnamese[39] = "Tổng thanh toán";
  assert.equal(columnMap(vietnamese).paidAt, 10);

  const malay = [...header];
  malay[0] = "ID Pesanan";
  malay[10] = "Masa Pembayaran";
  malay[39] = "Jumlah Bayaran";
  assert.equal(columnMap(malay).totalPayment, 39);

  assert.throws(() => columnMap(Array(41).fill("未知列")), (error) => {
    assert.match(error.message, new RegExp(`schema=${SHOPEE_REPORT_SCHEMA_VERSION}`));
    assert.match(error.message, /columns=41/);
    return true;
  });
});

test("Shopee 官方订单导表采集：页面内下载、内存解析且证据不保留明细", async () => {
  const header = Array(41).fill("");
  Object.assign(header, {
    0: "No. Pesanan",
    1: "Status Pesanan",
    9: "Waktu Pesanan Dibuat",
    10: "Waktu Pembayaran Dilakukan",
    21: "Subtotal Pesanan",
    39: "Total Pembayaran",
    40: "Perkiraan Ongkos Kirim",
  });
  const order = Array(41).fill("");
  Object.assign(order, {
    0: "SAFE-TEST-ORDER",
    1: "Telah Dikirim",
    9: "2026-11-16 08:00",
    10: "2026-11-17 10:00",
    21: "171.356",
    39: "125.000",
  });
  const xlsx = fakeShopeeOrderXlsx([header, order]);
  let reportRuns = 0;
  const cli = {
    visit: async () => null,
    runInPage: async (_storeId, body) => {
      if (body.includes("request_order_report")) {
        reportRuns += 1;
        return { reportId: "test-report", recordCount: 1, bytes: xlsx.length, base64: xlsx.toString("base64") };
      }
      return { href: "https://seller.shopee.co.id/portal/sale/order", title: "Shopee", text: "Orders" };
    },
  };
  const collector = new Collector({ cli, store: new ConfigStore(tempDir()), zhongtaiFactory: () => null, waits: { visit: 0 } });
  const shopee = require("../core/platforms/shopee");
  const result = await collector.collectShopeeOrderReport({
    store: { storeId: "test", storeName: "Test Store" },
    target: { country: "ID" },
    platform: shopee,
    origin: "https://seller.shopee.co.id",
    dates: ["2026-11-17"],
    timeoutMs: 90000,
  });
  assert.equal(reportRuns, 1);
  assert.equal(result.days["2026-11-17"].payAmount, 171356);
  assert.equal(result.days["2026-11-17"].buyerPaid, 125000);
  assert.equal(result.days["2026-11-17"].orderCount, 1);
  assert.equal(result.reports[0].uniqueOrderCount, 1);
  assert.equal(JSON.stringify(result).includes("SAFE-TEST-ORDER"), false);
  assert.equal(Object.hasOwn(result, "base64"), false);
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
  const { evidence, ...row } = sent.rows.find((item) => item.shopName === "店铺A-MY" && item.date === "2026-11-03");
  const m = metricsFor("111", dayRange("2026-11-03", "MY").start);
  // 每行带采集证据：来源店铺、模板版本、各接口返回摘要（去掉逐小时曲线）。
  assert.equal(evidence.storeId, "1001");
  assert.equal(evidence.site, "MY");
  assert.equal(evidence.values.visitors, m.uv);
  assert.ok(Object.keys(evidence.endpoints).length >= 1);
  assert.ok(JSON.stringify(evidence).length < 60000);
  assert.equal(evidence.pageCheck, null, "一个紫鸟店铺对应多个站点时不做页面核对");
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

test("上传队列：中台失败后重启程序只补传落盘数据，不重新采集", async () => {
  const dir = tempDir();
  const dataDir = path.join(dir, "data");
  const runId = "run_restart_reupload";
  const rows = [
    {
      date: "2026-10-01",
      shopName: "逐梦测试店",
      country: "印度尼西亚",
      platform: "Shopee",
      currency: "IDR",
      orderCount: 12,
      payAmount: 345600,
      _store: { storeId: "ziniao-store-1", storeName: "逐梦测试店" },
    },
  ];
  const firstStore = new ConfigStore(dataDir);
  firstStore.appendHistory({
    id: runId,
    status: "ok",
    startedAt: "2026-11-23T10:00:00.000Z",
    finishedAt: "2026-11-23T10:01:00.000Z",
    stores: [{ storeId: "ziniao-store-1", status: "ok" }],
    rows,
  });
  const noCollectionCli = new Proxy({}, {
    get(_target, property) {
      throw new Error(`补传不应调用紫鸟采集：${String(property)}`);
    },
  });
  const firstCollector = new Collector({
    cli: noCollectionCli,
    store: firstStore,
    zhongtaiFactory: () => ({
      async ingest() {
        const error = new Error("中台暂时不可用");
        error.status = 503;
        throw error;
      },
    }),
  });
  const queued = firstCollector.queueUpload(runId, { source: "restart-test" });
  const failed = await firstCollector.attemptUploadJob(queued, { force: true });
  assert.equal(failed.ok, false);
  assert.equal(failed.queued, true);
  assert.equal(firstStore.uploadOutbox().length, 1);
  assert.deepEqual(firstStore.resultRows(runId), rows);

  // 新建 ConfigStore 与 Collector，模拟同舟智数进程彻底退出后重新启动。
  const restartedStore = new ConfigStore(dataDir);
  const uploaded = [];
  const restartedCollector = new Collector({
    cli: noCollectionCli,
    store: restartedStore,
    zhongtaiFactory: () => ({
      async ingest(uploadRows, options) {
        uploaded.push({ rows: uploadRows, options });
        return { rowCount: uploadRows.length, written: uploadRows.length, shopCount: 1, errors: [], warnings: [] };
      },
    }),
  });
  const flushed = await restartedCollector.flushUploadOutbox({ force: true });
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].ok, true);
  assert.equal(restartedStore.uploadOutbox().length, 0);
  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].options.runId, runId);
  assert.deepEqual(uploaded[0].rows, rows.map(({ _store, ...row }) => row));
  assert.equal(restartedStore.history().find((item) => item.id === runId)?.status, "ok");
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
  const tiktok = require("../core/platforms/tiktok");
  assert.deepEqual(shopee.storeSite({ platformName: "Shopee-印尼-本土" }), { site: "ID", sellerCenter: "ID" });
  assert.deepEqual(shopee.storeSite({ platformName: "Shopee-马来西亚-本土" }), { site: "MY", sellerCenter: "MY" });
  assert.equal(shopee.matchStore({ platformName: "TikTok Shop-印尼-本土" }), false);
  const [builtin] = shopee.builtinTemplates();
  const { values } = extractMetrics(builtin, {
    // 2026-11-11 真实店铺核对：页面「访客」= hybrid_uv（3003），shop_uv（424）只是店铺页访客。
    km: { json: { code: 0, result: { paid_gmv: { value: 198000 }, paid_orders: { value: 1 }, shop_uv: { value: 10 }, hybrid_uv: { value: 31 } } } },
    product: { json: { atc_uv: { value: 2 } } },
    traffic: { json: { code: 0, result: { product_card: { total: { product_impressions: 1069 } } } } },
    ads: { json: { code: 0, data: { report_by_time: [{ metrics: { cost: 15270861 } }] } } },
    adsShop: { json: { code: 0, data: { report_by_time: [{ metrics: { cost: 1000000 } }, { metrics: { cost: 500000 } }] } } },
    adsLive: { error: "HTTP 403" },
  });
  // 广告费 = 商品广告 + Shop+ 广告；直播广告取不到按 0 计（可选部分）。
  assert.deepEqual(values, { payAmount: 198000, orderCount: 1, visitors: 31, addToCart: 2, impressions: 1069, adOnsite: 167.71 });
  assert.equal(builtin.version, 3);
  // 商品广告是必需部分：取不到时整个广告费记为缺失，而不是少算。
  const partial = extractMetrics(builtin, { ads: { error: "HTTP 500" }, adsShop: { json: { data: { report_by_time: [] } } } });
  assert.ok(partial.missing.includes("adOnsite"));
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
    config.zhongtaiShops = [
      { shopKey: "k-sjj", shopName: "SJJ Beauty Official Store", countryCode: "ID", platform: "shopee" },
      { shopKey: "k-my", shopName: "YN-XP0003", countryCode: "MY", platform: "shopee" },
      { shopKey: "k-tk-generic", shopName: "NatureKiss", rawName: "NatureKiss", countryCode: "ID", platform: "tiktok" },
      { shopKey: "k-tk-sjj", shopName: "SJJ-NatureKiss", rawName: "SJJ-NatureKiss", countryCode: "ID", platform: "tiktok" },
      { shopKey: "k-shopee-sjj", shopName: "SJJ-NatureKiss", rawName: "SJJ-NatureKiss", countryCode: "ID", platform: "shopee" },
    ];
    config.stores = {
      2: { storeId: "2", enabled: false },
      3: {
        storeId: "3",
        identity: tiktok.normalizePageIdentity({
          href: "https://seller-id.tokopedia.com/homepage?shop_region=ID",
          bodyText: "Home\nAssistant\nSJJ-NatureKissBodyCare\nOrders\nProducts",
          selectorTexts: [],
          storageKeys: ["data_compass#7494815587214788302", "user_7670037873403528208"],
        }),
      },
    };
  });
  const collector = new Collector({ cli: {}, store, zhongtaiFactory: () => null });
  const { plan } = collector.plan();
  assert.equal(plan.length, 2);
  const shopeePlan = plan.find((item) => item.platform.id === "shopee");
  const tiktokPlan = plan.find((item) => item.platform.id === "tiktok");
  assert.equal(shopeePlan.origin, "https://seller.shopee.co.id");
  assert.equal(shopeePlan.targets[0].shopKey, "k-sjj");
  assert.equal(tiktokPlan.origin, "https://seller-id.tiktok.com");
  assert.equal(tiktokPlan.template.id, "builtin:tiktok-daily-v1");
  assert.equal(tiktokPlan.targets[0].shopKey, "k-tk-sjj");
  assert.equal(tiktokPlan.targets[0].shopName, "SJJ-NatureKiss");
  assert.equal(tiktok.checkPage({ href: "https://seller-id.tokopedia.com/homepage?shop_region=ID" }).ok, true);
  const storedIdentity = store.get().stores[3].identity;
  assert.equal(storedIdentity.shopName, "SJJ-NatureKissBodyCare");
  assert.equal(storedIdentity.compassId, "7494815587214788302");
  assert.equal(storedIdentity.userId, "7670037873403528208");
  assert.equal(storedIdentity.region, "ID");
  const overview = collector.storeOverview();
  assert.equal(overview.length, 3);
  assert.equal(overview.find((item) => item.storeId === "3").platform, "TikTok Shop");
  assert.equal(overview.find((item) => item.storeId === "2").targets[0].matched, false, "站点不同不自动对应");
  assert.equal(overview.find((item) => item.storeId === "3").targets[0].shopKey, "k-tk-sjj");

  store.update((config) => {
    config.zhongtaiShops.push({
      shopKey: "k-tk-alias",
      shopName: "TikTok Indonesia 11",
      rawName: "TikTok Indonesia 11",
      miaoshouAlias: "印尼TK11",
      countryCode: "ID",
      platform: "tiktok",
    });
  });
  assert.equal(
    collector.matchZhongtaiShopName("印尼TK11", "ID", "tiktok")?.shopKey,
    "k-tk-alias",
    "紫鸟 TikTok 店铺名应能通过妙手别名自动匹配中台店铺",
  );

  store.update((config) => {
    config.zhongtaiShops.push({
      shopKey: "k-tk-sjj-duplicate",
      shopName: "SJJ-NatureKiss",
      rawName: "SJJ-NatureKiss",
      countryCode: "ID",
      platform: "tiktok",
    });
  });
  assert.equal(
    collector.matchZhongtaiShopName("SJJ-NatureKiss", "ID", "tiktok"),
    null,
    "同分候选必须交给用户确认，不能静默串店",
  );
});

test("数据质量：页面数字解析与核对", () => {
  const { parsePageNumber, comparePageCheck, trimJson, pageDateText } = require("../core/quality");
  assert.deepEqual(parsePageNumber("Rp2.640.200", "ID"), { value: 2640200, approx: false });
  assert.deepEqual(parsePageNumber("3.003", "ID"), { value: 3003, approx: false });
  assert.deepEqual(parsePageNumber("RM1,234.56", "MY"), { value: 1234.56, approx: false });
  assert.deepEqual(parsePageNumber("₫1.234.567", "VN"), { value: 1234567, approx: false });
  assert.deepEqual(parsePageNumber("34k", "ID"), { value: 34000, approx: true });
  assert.equal(parsePageNumber("—", "ID"), null);
  assert.equal(pageDateText("2026-11-10"), "10-11-2026");
  // 2026-11-11 QLEV 店铺真实数据：金额、订单一致，访客口径错误。
  const check = comparePageCheck({ payAmount: 2640200, orderCount: 19, visitors: 424 }, { period: "10-11-2026", paid: true, values: { sales: "Rp2.640.200", orders: "19", visitors: "3.003" } }, "ID");
  assert.equal(check.status, "mismatch");
  assert.equal(check.fields.payAmount.match, true);
  assert.equal(check.fields.orderCount.match, true);
  assert.equal(check.fields.visitors.match, false);
  assert.equal(comparePageCheck({ payAmount: 2640200, orderCount: 19, visitors: 3003 }, { period: "10-11-2026", paid: true, values: { sales: "Rp2.640.200", orders: "19", visitors: "3.003" } }, "ID").status, "match");
  // 页面口径没切到「已付款」：只比访客数。
  const notPaid = comparePageCheck({ payAmount: 2640200, orderCount: 19, visitors: 3003 }, { period: "10-11-2026", paid: false, values: { sales: "Rp3.119.271", orders: "25", visitors: "3.003" } }, "ID");
  assert.equal(notPaid.status, "match");
  assert.deepEqual(Object.keys(notPaid.fields), ["visitors"]);
  assert.equal(comparePageCheck({ visitors: 1 }, { notes: ["找不到日期选择器"] }, "ID").status, "unchecked");
  const trimmed = trimJson({ result: { shop_uv: { value: 1, points: [1, 2, 3] } }, list: Array.from({ length: 30 }, (_, i) => i) });
  assert.equal(trimmed.result.shop_uv.points, undefined);
  assert.equal(trimmed.list.length, 25);
});

test("节点代理：下次定时时间", () => {
  const { nextRunAt } = require("../core/agent");
  const now = new Date(2026, 10, 9, 10, 0);
  assert.equal(new Date(nextRunAt({ enabled: true, times: ["09:30", "21:30"] }, now)).getHours(), 21);
  const tomorrow = new Date(nextRunAt({ enabled: true, times: ["09:30"] }, now));
  assert.equal(tomorrow.getDate(), 10);
  assert.equal(nextRunAt({ enabled: false, times: ["09:30"] }, now), "");
});
