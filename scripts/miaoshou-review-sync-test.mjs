import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createCollectorCenter } from "../server/collector-center.js";
import { initPerformanceAnalyticsStore } from "../server/performance-analytics-db.js";
import { initShopDailyReportStore } from "../server/shop-daily-report-db.js";
import { buildShopDailyReport } from "../server/shop-daily-report.js";
import { shopDirectoryKey } from "../server/shop-directory.js";
import reviewCollector from "../desktop/tongzhou-zhishu/core/miaoshou-review-sync.js";
import zhongtaiClient from "../desktop/tongzhou-zhishu/core/zhongtai.js";

const { MiaoshouReviewSync, readReviewMarks } = reviewCollector;
const { ZhongtaiClient } = zhongtaiClient;
const shop = { platform: "Shopee", country: "ID", rawShopName: "Review Test Shop", displayName: "Review Test Shop" };
shop.key = shopDirectoryKey(shop);
const shopId = "111";
const date = new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10);
const importedDate = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
const at = (day) => `${day}T01:00:00.000Z`;
const rawMark = (orderNo, mark = "1", id = shopId) => ({ shopId: id, orderNo, mark });
const pageOf = (orders) => ({ total: orders.length, packageCount: orders.length, orders });

test("分页查询按实际店铺和订单号去重，并忽略缺失或冲突的撤标状态", async () => {
  const observed = await readReviewMarks(async ({ page, platformOrderSns, platformOrderSnsRp }) => {
    assert.equal(platformOrderSns, "REVIEW,UNKNOWN,CONFLICT,REMOVED");
    assert.equal(platformOrderSnsRp, "eq");
    const orders = page === 1
      ? [rawMark("REVIEW"), rawMark("UNKNOWN", ""), rawMark("CONFLICT"), rawMark("REMOVED", "0"), rawMark("REVIEW", "0", "999")]
      : [rawMark("REVIEW"), rawMark("CONFLICT", "0")];
    return { orders, total: "51", packageCount: page === 1 ? 50 : 1 };
  }, ["REVIEW", "UNKNOWN", "CONFLICT", "REMOVED"].map((orderNo) => ({ shopId, orderNo })));
  assert.deepEqual(observed, [{ shopId, orderNo: "REVIEW", marked: true }, { shopId, orderNo: "REMOVED", marked: false }]);
  await assert.rejects(readReviewMarks(async () => ({ orders: [], total: 1, packageCount: 0 }), [{ shopId, orderNo: "REVIEW" }]), /分页返回异常/);
});

test("采集器登录失效时跳过写入和游标推进，下一轮可重试", async () => {
  let now = Date.now();
  const entries = [];
  const requests = [];
  let loggedIn = false;
  const sync = new MiaoshouReviewSync({ isActive: () => true, now: () => now, log: (...entry) => entries.push(entry),
    requestPage: async () => {
      if (!loggedIn) throw new Error("妙手登录已失效，请重新登录。");
      return pageOf([rawMark("RECOVERED")]);
    },
  });
  const next = { date: at(date), identity: "cursor" };
  const client = { agent: async (_, body) => {
    requests.push(body.action);
    if (body.action === "plan") return { mode: "preview", recent: { orders: [{ shopId, orderNo: "RECOVERED" }], next } };
    return { added: 1, updated: 0, removed: 0, manual: 0, importedDay: 0, missingSettlement: 0, unmatched: 0 };
  } };
  await sync.tick(client);
  assert.deepEqual(requests, ["plan"]);
  assert.equal(sync.recent, null);
  assert.match(entries[0][1], /登录已失效/);
  now += 5 * 60_000;
  loggedIn = true;
  await sync.tick(client);
  assert.deepEqual(requests, ["plan", "plan", "sync"]);
  assert.deepEqual(sync.recent, next);
});

test("真实中台 HTTP 和隔离 SQLite 验证预览、入库、结算补齐、撤标和日报", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tongzhou-review-sync-"));
  let server;
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise((done) => probe.close(done));
  const baseUrl = `http://127.0.0.1:${port}`;
  const dbPath = join(dir, "shop-daily-report.sqlite");
  const orderDbPath = join(dir, "performance-analytics.sqlite");
  const center = createCollectorCenter({ filePath: join(dir, "collector-center.json") });
  const allowed = center.pairNode({ name: "review-sync-test" });
  const denied = center.pairNode({ name: "other-node-test" });
  const client = new ZhongtaiClient({ baseUrl, token: allowed.token, maxRetries: 0 });
  const other = new ZhongtaiClient({ baseUrl, token: denied.token, maxRetries: 0 });
  const contents = (path, data) => writeFileSync(join(dir, path), JSON.stringify(data));
  let businessTime = Date.now() - 60_000;
  const observations = (items) => items.map(([orderNo, marked]) => ({ shopId, orderNo, marked }));
  function send(rows, advance = true) {
    if (advance) businessTime += 1000;
    return client.agent("miaoshou-review-orders", { action: "sync", observedAt: new Date(businessTime).toISOString(), observations: observations(rows) });
  }
  async function stop() {
    if (server?.exitCode === null) {
      const exited = once(server, "exit");
      server.kill();
      await exited;
    }
  }
  async function boot(mode) {
    let diagnostics = "";
    server = spawn(process.execPath, ["server/server.js"], {
      cwd: resolve(import.meta.dirname, ".."), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|systemroot|temp|tmp|windir|localappdata|appdata|userprofile|home)$/i.test(key))),
        NO_PROXY: "127.0.0.1", API_PORT: String(port), CACHE_DIR: dir, SKIP_ENV_FILE: "true",
        BACKGROUND_JOBS_ENABLED: "false", NODE_ENV: "development", MIAOSHOU_REVIEW_SYNC_NODE_ID: allowed.node.id,
        MIAOSHOU_REVIEW_SYNC_SHOP_IDS: "*", MIAOSHOU_REVIEW_SYNC_MODE: mode, MIAOSHOU_REVIEW_SYNC_FROM: importedDate },
    });
    for (const stream of [server.stdout, server.stderr]) stream.on("data", (chunk) => { diagnostics = (diagnostics + chunk).slice(-6000); });
    for (let i = 0; i < 80 && server.exitCode === null; i += 1) {
      const health = await fetch(baseUrl + "/api/health").catch(() => null);
      if (health?.ok) return;
      await delay(100);
    }
    throw new Error("本地中台测试启动失败\n" + diagnostics);
  }
  function storedOrder(orderNo, orderDate = date, extra = {}) {
    return { identity: `shopee|${shopId}|${orderNo}`, shopId, platform: "Shopee", platformOrderSn: orderNo, site: "ID", currency: "IDR",
      orderStartedAt: at(orderDate), paidAt: at(orderDate), payAmount: 100_000, ...extra };
  }
  try {
    contents("orders-sync.json", { orders: [{ ...shop, shopName: shop.displayName }] });
    contents("miaoshou-shops.json", { shops: [{ shopId, shopNick: shop.displayName, platform: shop.platform, site: shop.country }] });
    const performance = await initPerformanceAnalyticsStore(orderDbPath);
    const beforeStart = new Date(Date.parse(importedDate + "T00:00:00+08:00") - 1).toISOString();
    performance.upsertMiaoshouPerformance({ orders: [
      storedOrder("AUTO"), storedOrder("MANUAL"), storedOrder("IMPORTED", importedDate),
      storedOrder("OUTSIDE", importedDate, { orderStartedAt: beforeStart }),
    ] });
    performance.flush();
    const original = await initShopDailyReportStore(dbPath);
    original.saveReviewOrders([{ shopKey: shop.key, shopName: shop.displayName, date, orderNo: "MANUAL", amount: 5000, receivedAmount: 4200, note: "原手工值" }], "测试运营");
    original.upsertMetrics([{ shopKey: shop.key, shopName: shop.displayName, date: importedDate, country: "ID", platform: "Shopee", currency: "IDR",
      values: { reviewAmount: 12000, reviewCount: 1 } }], { source: "import" });
    await boot("preview");
    assert.equal((await client.agent("heartbeat", {})).miaoshouReviewSync, true);
    assert.equal((await other.agent("heartbeat", {})).miaoshouReviewSync, false);
    await assert.rejects(other.agent("miaoshou-review-orders", { action: "plan" }), { status: 403 });
    assert.equal((await fetch(baseUrl + "/api/collector/agent/miaoshou-review-orders", { method: "POST" })).status, 401);
    const collect = new MiaoshouReviewSync({ requestPage: async () => pageOf([rawMark("AUTO"), rawMark("MANUAL"), rawMark("IMPORTED")]),
      isActive: () => true, now: () => businessTime, log: (_level, message) => { if (/失败/.test(message)) throw new Error(message); } });
    const plan = await client.agent("miaoshou-review-orders", { action: "plan" });
    assert.deepEqual(plan.history.orders.map((order) => order.orderNo), ["MANUAL", "AUTO", "IMPORTED"]);
    await collect.tick(client);
    const preview = await send([["AUTO", true], ["MANUAL", true], ["IMPORTED", true], ["UNKNOWN", true], ["OUTSIDE", true]]);
    assert.deepEqual([preview.dryRun, preview.added, preview.manual, preview.importedDay, preview.unmatched], [true, 1, 1, 1, 2]);
    assert.deepEqual((await initShopDailyReportStore(dbPath)).listReviewOrders().map((item) => item.orderNo), ["MANUAL"]);
    await stop();
    await boot("apply");
    const inserted = await send([["AUTO", true], ["MANUAL", true], ["IMPORTED", true]]);
    assert.deepEqual([inserted.dryRun, inserted.added, inserted.manual, inserted.importedDay], [false, 1, 1, 1]);
    assert.equal((await send([["AUTO", true]], false)).added, 0);
    assert.equal((await initShopDailyReportStore(dbPath)).listReviewOrders().find((item) => item.orderNo === "AUTO").receivedAmount, null);
    await stop();
    performance.upsertMiaoshouPerformance({ orders: [storedOrder("AUTO", date, { settledAt: at(date), escrowAmount: 85000 })] });
    performance.flush();
    await boot("apply");
    assert.equal((await send([["AUTO", true]])).updated, 1);
    const synced = (await initShopDailyReportStore(dbPath)).listReviewOrders();
    const review = synced.find((item) => item.orderNo === "AUTO");
    assert.deepEqual([review.date, review.amount, review.receivedAmount, review.quantity], [date, 100_000, 85_000, 1]);
    const report = buildShopDailyReport({ shops: [shop], reviewOrders: synced, systemDaily: [],
      metrics: [{ shopKey: shop.key, date, payAmount: 500_000, orderCount: 8 }], filters: { dateFrom: date, dateTo: date } });
    assert.equal(report.rows[0].realSalesLocal, 395_000);
    assert.equal(report.rows[0].realOrders, 6);
    const priorMark = businessTime;
    assert.equal((await send([["AUTO", false], ["MANUAL", false]])).removed, 1);
    businessTime = priorMark;
    assert.equal((await send([["AUTO", true]], false)).updated, 0);
    const left = (await initShopDailyReportStore(dbPath)).listReviewOrders();
    assert.deepEqual(left.map((item) => [item.orderNo, item.receivedAmount, item.note]), [["MANUAL", 4200, "原手工值"]]);
    await assert.rejects(send([["AUTO", true], ["AUTO", false]]), { status: 400 });
  } finally {
    await stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
