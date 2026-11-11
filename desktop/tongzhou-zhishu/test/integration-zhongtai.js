"use strict";

// 集成测试：同舟智数采集器（模拟紫鸟 + 模拟 Shopee）→ 真实中台服务（仓库根目录 server/server.js）。
// 运行：node test/integration-zhongtai.js（需要在中台仓库里，且已 npm install）

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { ZiniaoCli } = require("../core/ziniao");
const { ConfigStore } = require("../core/config");
const { Collector } = require("../core/collector");
const { ZhongtaiClient } = require("../core/zhongtai");
const { startMockBrowser, ORIGIN } = require("./mock-browser");
const { NodeAgent } = require("../core/agent");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const TOKEN = "integration-ingest-token-0123456789abcd";

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tzzs-int-"));
  const cacheDir = path.join(dir, "cache");
  fs.mkdirSync(cacheDir);
  fs.writeFileSync(path.join(cacheDir, "orders-sync.json"), JSON.stringify({
    syncedAt: "2026-11-04T00:00:00.000Z",
    results: [{ warehouseId: "my-warehouse", ok: true, orderApiComplete: true, orderApiTotal: 1, orderApiReadRows: 1 }],
    orders: [{
      providerId: "sea_wms", warehouseId: "my-warehouse", warehouseName: "马来仓", country: "马来西亚",
      orderId: "O-1", orderNo: "O-1", lineId: "L-1", shippedAt: "2026-11-03 10:00:00", platform: "shopee",
      shopName: "店铺A-MY", projectGroup: "测试", sku: "SKU-1", productName: "测试", quantity: 1,
      salesAmount: 100, currency: "MYR", salesAmountScope: "order_allocated", salesAmountSource: "order.orderAmount",
      salesAmountOrderTotal: 100, salesAmountAllocationResidual: 0, salesAmountValid: true,
    }],
  }));
  const port = String(32000 + Math.floor(Math.random() * 5000));
  const server = spawn(process.execPath, ["server/server.js"], {
    cwd: repoRoot,
    env: {
      ...process.env, API_PORT: port, NODE_ENV: "development", INTERNAL_ACCESS_CODE: "x", AUTH_SESSION_SECRET: "x",
      AUTO_SYNC_INTERVAL_MS: "0", PERFORMANCE_FX_AUTO_SYNC: "false", CACHE_DIR: cacheDir, SKIP_ENV_FILE: "true",
      MOVEMENT_HISTORY_DB_PATH: path.join(dir, "mh.sqlite"), STOCKUP_COLLABORATION_DB_PATH: path.join(dir, "sc.sqlite"),
      DOMESTIC_INVENTORY_DB_PATH: path.join(dir, "di.sqlite"), SYSTEM_BACKUP_DIR: path.join(dir, "bk"),
      SYSTEM_BACKUP_ENV_PATH: path.join(dir, "bk", "t.env"), SHOP_METRICS_INGEST_TOKEN: TOKEN,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });
  const baseUrl = `http://127.0.0.1:${port}`;
  const browser = await startMockBrowser({ stores: [{ storeId: "1001", storeName: "紫鸟-店铺A", shopIds: ["111", "222"] }] });
  try {
    for (let i = 0; i < 150; i += 1) {
      try {
        if ((await fetch(`${baseUrl}/api/health`)).ok) break;
      } catch { /* starting */ }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const client = new ZhongtaiClient({ baseUrl, token: TOKEN });
    await client.ping();
    const shops = await client.listShops();
    const shopA = shops.find((shop) => shop.shopName === "店铺A-MY");
    assert.ok(shopA, `中台店铺名单应包含 店铺A-MY：${JSON.stringify(shops)}`);
    assert.equal(shopA.countryCode, "MY");

    const cliFile = path.join(dir, "ziniao-cli");
    fs.writeFileSync(cliFile, `#!/bin/sh\nexec "${process.execPath}" "${path.join(__dirname, "mock-ziniao-cli.js")}" "$@"\n`);
    fs.chmodSync(cliFile, 0o755);
    const cli = new ZiniaoCli({ cliPath: cliFile, extraEnv: { MOCK_ZINIAO_URL: browser.url } });
    const store = new ConfigStore(path.join(dir, "app"));
    const collector = new Collector({ cli, store, zhongtaiFactory: () => client, waits: { fresh: 10, reused: 10, visit: 10, retry: 10 } });
    await collector.refreshStores();
    const discovery = await collector.discover({ storeId: "1001", pageUrl: `${ORIGIN}/datacenter/dashboard` });
    browser.pages.get("1001").interactAds();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const again = await collector.discover({ storeId: "1001", pageUrl: `${ORIGIN}/datacenter/dashboard`, reopen: false });
    const indexes = again.requests.filter((request) => /key-metrics|get_shop_report/.test(request.url)).map((request) => request.index);
    assert.equal(indexes.length, 2, JSON.stringify(again.requests.map((request) => [request.method, request.url, request.body, request.via])));
    const built = collector.buildTemplate({ storeId: "1001", indexes, name: "CNSC", shopIds: ["111", "222"] });
    built.template.metrics.adOnsite.scale = 100000;
    const template = store.upsertTemplate(built.template);
    store.upsertStore({ storeId: "1001", storeName: "紫鸟-店铺A", enabled: true, templateId: template.id, targets: [
      { shopName: "店铺A-MY", country: "MY", shopId: "111", shopKey: shopA.shopKey },
      { shopName: "店铺A-PH", country: "PH", shopId: "222" },
    ] });
    const preview = await collector.collect({ dates: ["2026-11-03"], mode: "preview" });
    assert.equal(preview.upload.ok, true, JSON.stringify(preview.upload));
    assert.equal(preview.upload.rowCount, 2);
    assert.ok(preview.upload.warnings.some((warning) => /店铺A-PH/.test(warning.message)), "新站点店铺应提示为独立店铺");
    const run = await collector.collect({ dates: ["2026-11-02", "2026-11-03"], mode: "upload" });
    assert.equal(run.upload.ok, true, JSON.stringify(run.upload));
    assert.equal(run.upload.written, 4);
    assert.equal(run.status, "ok");
    console.log(`[ok] 同舟智数 → 中台：试匹配 ${preview.upload.rowCount} 行，写入 ${run.upload.written} 行，店铺名单 ${shops.length} 个`);

    // ---------------- 采集中心：节点配对、心跳、计划、命令、运行记录、日志、停用 ----------------
    const session = await (await fetch(`${baseUrl}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "x" }) })).json();
    const admin = (pathname, init = {}) => fetch(`${baseUrl}${pathname}`, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${session.token}` } }).then(async (response) => ({ status: response.status, body: await response.json() }));
    const paired = await admin("/api/collector/nodes/pair", { method: "POST", body: JSON.stringify({ name: "云电脑-01", hostname: "CLOUD-01", platforms: ["Shopee"], version: "0.4.0" }) });
    assert.equal(paired.status, 200, JSON.stringify(paired.body));
    store.update((config) => {
      config.node = { id: paired.body.node.id, name: paired.body.node.name };
      config.schedule = { ...config.schedule, enabled: true, times: ["08:15"], lookbackDays: 2 };
    });
    const nodeClient = new ZhongtaiClient({ baseUrl, token: paired.body.token });
    const nodeCollector = new Collector({ cli, store, zhongtaiFactory: () => nodeClient, waits: { fresh: 10, reused: 10, visit: 10, retry: 10 } });
    const logs = [];
    let unauthorized = 0;
    const agent = new NodeAgent({
      store,
      collector: nodeCollector,
      cli,
      clientFactory: () => nodeClient,
      log: (level, message) => logs.push(`${level} ${message}`),
      version: "0.4.0",
      runCollect: (options) => nodeCollector.collect(options),
    });
    agent.onUnauthorized = () => { unauthorized += 1; };
    nodeCollector.onRunUpdate = (entry) => agent.reportRun(entry);

    await agent.heartbeat();
    let listed = await admin("/api/collector/nodes");
    let node = listed.body.nodes.find((item) => item.id === paired.body.node.id);
    assert.equal(node.online, true);
    assert.deepEqual(node.schedule, { enabled: true, times: ["08:15"], lookbackDays: 2 }, "首次心跳用节点本地计划初始化");
    assert.equal(node.storeCount, 1);

    // 中台改计划 → 节点下次心跳生效
    await admin(`/api/collector/nodes/${node.id}`, { method: "PATCH", body: JSON.stringify({ schedule: { enabled: true, times: ["09:30", "21:30"], lookbackDays: 3 } }) });
    await agent.heartbeat();
    assert.deepEqual(store.get().schedule.times, ["09:30", "21:30"]);
    assert.equal(store.get().schedule.managed, true);

    // 中台下发立即采集 → 节点执行并上报运行记录
    const command = await admin(`/api/collector/nodes/${node.id}/commands`, { method: "POST", body: JSON.stringify({ type: "collect", dates: ["2026-11-03"] }) });
    assert.equal(command.status, 200, JSON.stringify(command.body));
    await agent.heartbeat();
    for (let i = 0; i < 100 && (agent.draining || nodeCollector.running); i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    await agent.flushRuns();
    const runs = await admin(`/api/collector/nodes/${node.id}/runs`);
    const commandRun = runs.body.runs.find((item) => item.commandId === command.body.command.id);
    assert.ok(commandRun, `中台应收到命令触发的运行记录：${JSON.stringify(runs.body).slice(0, 300)}`);
    assert.equal(commandRun.status, "ok");
    assert.equal(commandRun.trigger, "command");
    assert.deepEqual(commandRun.dates, ["2026-11-03"]);
    assert.equal(commandRun.upload.written, 2);
    const detail = await admin(`/api/collector/nodes/${node.id}`);
    assert.equal(detail.body.node.commands.find((item) => item.id === command.body.command.id).status, "done");

    // 日志回传
    agent.queueLog({ at: new Date().toISOString(), level: "error", message: "测试：店铺B 未登录" });
    await agent.flushLogs();
    const nodeLogs = await admin(`/api/collector/nodes/${node.id}/logs`);
    assert.ok(nodeLogs.body.lines.some((line) => line.message.includes("店铺B 未登录")));

    // 数据质量：节点写入时附带的采集证据已归档，可查看明细、上传截图、手动补采
    const shopKeyA = shopA.shopKey;
    const evidence = await admin(`/api/collector/quality/evidence?shopKey=${encodeURIComponent(shopKeyA)}&date=2026-11-03`);
    assert.equal(evidence.status, 200, JSON.stringify(evidence.body).slice(0, 300));
    assert.equal(evidence.body.summary.storeId, "1001");
    assert.ok(Object.keys(evidence.body.endpoints).length >= 1, "证据里有接口原始返回");
    const shot = await nodeClient.agent("evidence/screenshot", { storeId: "1001", shopName: "店铺A-MY", date: "2026-11-03", mime: "image/jpeg", base64: Buffer.from("fake-jpeg").toString("base64") });
    assert.equal(shot.ok, true);
    const image = await fetch(`${baseUrl}/api/collector/quality/screenshot?shopKey=${encodeURIComponent(shopKeyA)}&date=2026-11-03`, { headers: { authorization: `Bearer ${session.token}` } });
    assert.equal(image.status, 200);
    assert.equal(Buffer.from(await image.arrayBuffer()).toString(), "fake-jpeg");
    const qualityView = await admin("/api/collector/quality?refresh=1");
    assert.equal(qualityView.status, 200, JSON.stringify(qualityView.body).slice(0, 300));
    const qualityRow = qualityView.body.rows.find((row) => row.shopKey === shopKeyA);
    assert.ok(qualityRow, `数据质量里应有 店铺A-MY：${JSON.stringify(qualityView.body.rows.map((row) => row.shopName))}`);
    assert.equal(qualityRow.owners[0].storeId, "1001");
    const recollect = await admin("/api/collector/quality/recollect", { method: "POST", body: JSON.stringify({ shopKey: shopKeyA, dates: ["2026-11-03"] }) });
    assert.equal(recollect.status, 200, JSON.stringify(recollect.body));
    const hb = await nodeClient.agent("heartbeat", agent.status());
    const delivered = hb.commands.find((item) => item.id === recollect.body.command.id);
    assert.equal(delivered.source, "quality");
    assert.deepEqual(delivered.storeIds, ["1001"]);
    assert.deepEqual(hb.quality, { pageCheck: true, screenshot: true });
    const settings = await admin("/api/collector/quality/settings", { method: "PATCH", body: JSON.stringify({ autoBackfill: false }) });
    assert.equal(settings.body.settings.autoBackfill, false);
    console.log(`[ok] 数据质量：证据归档（${Object.keys(evidence.body.endpoints).length} 个接口）、截图、巡检、手动补采命令`);

    // 停用节点 → 令牌立即失效，节点提示重新登录
    await admin(`/api/collector/nodes/${node.id}`, { method: "PATCH", body: JSON.stringify({ disabled: true }) });
    await agent.heartbeat();
    assert.equal(unauthorized, 1);
    listed = await admin("/api/collector/nodes");
    node = listed.body.nodes.find((item) => item.id === paired.body.node.id);
    assert.equal(node.disabled, true);
    console.log(`[ok] 采集中心：节点在线、计划下发、立即采集（写入 ${commandRun.upload.written} 行）、日志回传、停用生效`);
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
