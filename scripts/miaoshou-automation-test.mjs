import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMiaoshouSignature, MIAOSHOU_PATHS } from "../server/miaoshou-client.js";
import { initMiaoshouAutomation } from "../server/miaoshou-automation.js";

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(payload);
    },
  };
}

const calls = [];
let injectedRateLimitFailures = 0;
async function fetchMock(url, init) {
  const path = new URL(url).pathname;
  const body = JSON.parse(init.body || "{}");
  calls.push({ path, body, headers: init.headers });
  if (path === MIAOSHOU_PATHS.shops) {
    if (body.pageSize !== 1 && body.site === "VN" && injectedRateLimitFailures === 0) {
      injectedRateLimitFailures += 1;
      return jsonResponse({
        result: "fail",
        code: "rate_limit",
        message: "账户接口每秒请求频率超限",
      });
    }
    const vietnamShop = body.site === "VN";
    return jsonResponse({
      result: "success",
      code: "200",
      message: "success",
      data: {
        shopList: body.pageSize === 1 ? [{ shopId: "SHOP-1" }] : [{
          shopId: vietnamShop ? "SHOP-VN" : "SHOP-1",
          platform: vietnamShop ? "tiktok" : "shopee",
          site: vietnamShop ? "VN" : "ID",
          siteName: vietnamShop ? "越南" : "印度尼西亚",
          platformShopName: vietnamShop ? "Vietnam Store" : "测试店铺",
          shopNick: vietnamShop ? "VN ALIAS" : "TEST",
          status: "active",
        }],
      },
    });
  }
  if (path === MIAOSHOU_PATHS.packages) {
    return jsonResponse({
      result: "success",
      code: "200",
      data: [{
        orderPackageList: [{
          shopId: "SHOP-1",
          shopName: "测试店铺",
          platform: "shopee",
          site: "ID",
          appPackageNo: "PKG-001",
          orderInfo: {
            shopId: "SHOP-1",
            platform: "shopee",
            site: "ID",
            platformOrderSn: "ORDER-001",
          },
          items: [{
            opOrderPackageId: 123456,
            opOrderPackageItemId: 789,
            title: "测试商品",
            quantity: 1,
          }],
          appPackageStatus: "wait_seller_send",
          logisticsNo: "",
        }],
      }],
    });
  }
  if (path === MIAOSHOU_PATHS.applyTrackingNo) {
    return jsonResponse({
      result: "success",
      code: "200",
      data: [{ logisticsNo: "TRACK-001", headLogisticsNo: "", logisticsType: "online" }],
    });
  }
  if (path === MIAOSHOU_PATHS.waybill) {
    return jsonResponse({
      result: "success",
      code: "200",
      data: [{ waybillUrlInfo: { platformOrderSn: "ORDER-001", url: "https://labels.example/PKG-001.pdf" } }],
    });
  }
  return jsonResponse({ result: "fail", code: "not_found", message: path }, 404);
}

const signature = buildMiaoshouSignature({
  appSecret: "secret",
  path: "/open/test",
  timestamp: "1720000000",
  appKey: "app-key",
  bodyText: '{"hello":"world"}',
});
assert.equal(signature, "8ef5cf5ba685472fc4e5b6f1fd4efe8a5b6c0c16628713b3022c0c790cb0744d");

const cacheDir = mkdtempSync(join(tmpdir(), "tongzhou-miaoshou-test-"));
try {
  const automation = await initMiaoshouAutomation({
    cacheDir,
    fetchImpl: fetchMock,
    env: {},
    requestIntervalMs: 0,
    rateLimitRetryDelayMs: 0,
  });
  automation.updateConfig({
    appKey: "app-key",
    appSecret: "secret",
    automationEnabled: true,
    scopes: [
      { platform: "shopee", site: "ID" },
      { platform: "tiktok", site: "VN" },
    ],
    pollIntervalMinutes: 1,
    maxPackagesPerRun: 10,
  }, "测试管理员");
  await automation.testConnection();
  const synced = await automation.syncShops();
  assert.equal(synced.counts.shops, 2);
  assert.equal(synced.shops.find((shop) => shop.shopId === "SHOP-1")?.shopNick, "TEST");
  assert.equal(synced.shops.find((shop) => shop.shopId === "SHOP-VN")?.shopNick, "VN ALIAS");
  assert.equal(injectedRateLimitFailures, 1);
  assert.equal(calls.filter((call) => call.path === MIAOSHOU_PATHS.shops && call.body.site === "VN").length, 2);
  assert.equal(synced.siteOptions.tiktok.find((option) => option.value === "VN")?.label, "越南");
  assert.ok(calls.filter((call) => call.path === MIAOSHOU_PATHS.shops && call.body.pageSize !== 1).every((call) => call.body.pageSize === 50));
  automation.updateShop("SHOP-1", { autoApplyTrackingNo: true, autoFetchWaybill: true }, "测试管理员");

  const firstRun = await automation.runAutomation({ force: true });
  assert.equal(firstRun.attempted, 1);
  assert.equal(firstRun.succeeded, 1);
  const firstPayload = automation.publicPayload();
  assert.equal(firstPayload.counts.succeeded, 1);
  assert.equal(firstPayload.tasks[0].trackingNo, "TRACK-001");
  assert.equal(firstPayload.tasks[0].waybillUrl, "https://labels.example/PKG-001.pdf");
  assert.equal(firstPayload.tasks[0].shopName, "TEST");
  assert.equal(firstPayload.tasks[0].platformOrderSn, "ORDER-001");
  assert.equal(firstPayload.tasks[0].packageSnapshot, undefined, "前端载荷不应暴露原始包裹快照");
  assert.ok(calls.filter((call) => call.path === MIAOSHOU_PATHS.packages).every((call) => (
    call.body.pageSize === 50
    && call.body.appPackageStatus === "wait_seller_send"
    && call.body.appPackageTab === undefined
  )));

  const secondRun = await automation.runAutomation({ force: true });
  assert.equal(secondRun.attempted, 0, "同一包裹不能重复申请");
  assert.equal(calls.filter((call) => call.path === MIAOSHOU_PATHS.applyTrackingNo).length, 1);

  const signedRequest = calls.find((call) => call.path === MIAOSHOU_PATHS.shops);
  assert.ok(signedRequest.headers["x-app-key"]);
  assert.ok(signedRequest.headers["x-timestamp"]);
  assert.match(signedRequest.headers["x-sign"], /^[a-f0-9]{64}$/);
  console.log(JSON.stringify({
    ok: true,
    shops: firstPayload.counts.shops,
    succeeded: firstPayload.counts.succeeded,
    trackingNo: firstPayload.tasks[0].trackingNo,
    waybillUrl: firstPayload.tasks[0].waybillUrl,
    applyCalls: calls.filter((call) => call.path === MIAOSHOU_PATHS.applyTrackingNo).length,
  }, null, 2));
} finally {
  rmSync(cacheDir, { recursive: true, force: true });
}
