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
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
