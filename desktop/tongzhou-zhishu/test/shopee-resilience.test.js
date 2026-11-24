"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { Collector, shopeeRateLimitDetails, shopeeRateLimitCooldown } = require("../core/collector");
const { orderReportBody, loginRecoveryBody } = require("../core/page-scripts");
const shopee = require("../core/platforms/shopee");

function storeStub() {
  return { get: () => ({ ziniao: {} }) };
}

test("Shopee 报表限流标记可解析，普通错误不会误判", () => {
  assert.deepEqual(
    shopeeRateLimitDetails(new Error("page: SHOPEE_RATE_LIMIT|12345|接口限流")),
    { limited: true, retryAfterMs: 12345, message: "接口限流" },
  );
  assert.equal(shopeeRateLimitDetails(new Error("Shopee 订单报表接口 HTTP 429")).limited, true);
  assert.equal(shopeeRateLimitDetails(new Error("HTTP 500")).limited, false);
});

test("Shopee 报表脚本使用 Retry-After、退避与较慢轮询", () => {
  const script = orderReportBody({ startDate: "2026-10-01", endDate: "2026-10-31" });
  assert.match(script, /retry-after/i);
  assert.doesNotMatch(script, /5000, 15000, 30000, 60000/);
  assert.match(script, /await sleep\(3000\)/);
  assert.match(script, /SHOPEE_RATE_LIMIT/);
});

test("Shopee 429 使用全局 15/30/60 分钟退避并遵守 Retry-After", () => {
  const options = { jitterMinMs: 0, jitterMaxMs: 0, random: () => 0 };
  assert.equal(shopeeRateLimitCooldown(1, 0, options), 15 * 60_000);
  assert.equal(shopeeRateLimitCooldown(2, 0, options), 30 * 60_000);
  assert.equal(shopeeRateLimitCooldown(3, 0, options), 60 * 60_000);
  assert.equal(shopeeRateLimitCooldown(4, 90 * 60_000, options), 90 * 60_000);
});

test("Shopee 自动登录只触发浏览器保存凭据，不返回密码内容", () => {
  const script = loginRecoveryBody();
  assert.match(script, /TZ_SHOPEE_LOGIN_RECOVERY/);
  assert.match(script, /password\.value/);
  assert.doesNotMatch(script, /value:\s*password\.value/);
  assert.doesNotMatch(script, /password:\s*password\.value/);
});

test("Shopee 掉登录时会先自动提交浏览器已保存账号", async () => {
  let pageChecks = 0;
  let loginRuns = 0;
  const cli = {
    visit: async () => null,
    runInPage: async (_storeId, body) => {
      if (body.includes("TZ_SHOPEE_LOGIN_RECOVERY")) {
        loginRuns += 1;
        return { attempted: true, method: "button" };
      }
      pageChecks += 1;
      if (pageChecks === 1) {
        return { href: "https://seller.shopee.co.id/account/signin", title: "Login", text: "Login" };
      }
      return { href: "https://seller.shopee.co.id/portal/sale/order", title: "Shopee", text: "Orders" };
    },
  };
  const collector = new Collector({ cli, store: storeStub(), waits: { visit: 0, shopeeLogin: 0 } });
  const info = await collector.ensurePage("store-login", shopee, "https://seller.shopee.co.id/portal/sale/order");
  assert.equal(loginRuns, 1);
  assert.equal(info.href, "https://seller.shopee.co.id/portal/sale/order");
});

test("Shopee 自动登录遇到验证码或未自动填充时明确转人工", async () => {
  for (const recovery of [
    { requiresManual: true, reason: "需要验证码" },
    { attempted: false, autofillMissing: true, reason: "浏览器没有自动填充已保存的密码" },
  ]) {
    const collector = new Collector({
      cli: {
        visit: async () => null,
        runInPage: async (_storeId, body) => body.includes("TZ_SHOPEE_LOGIN_RECOVERY")
          ? recovery
          : { href: "https://seller.shopee.co.id/account/signin", title: "Login", text: "Login" },
      },
      store: storeStub(),
      waits: { visit: 0, shopeeLogin: 0 },
    });
    await assert.rejects(
      collector.ensurePage("store-manual", shopee, "https://seller.shopee.co.id/portal/sale/order"),
      (error) => ["CAPTCHA", "NOT_LOGGED_IN"].includes(error.code),
    );
  }
});

test("Shopee about:blank 会重新打开当前店铺页面", async () => {
  let checks = 0;
  let visits = 0;
  const reopened = [];
  const collector = new Collector({
    cli: {
      visit: async ({ url }) => {
        visits += 1;
        assert.equal(url, "https://seller.shopee.co.id/portal/sale/order");
      },
      closeStore: async ({ storeId }) => reopened.push(["close", storeId]),
      openStore: async ({ storeId, url }) => reopened.push(["open", storeId, url]),
      runInPage: async () => {
        checks += 1;
        return checks === 1
          ? { href: "about:blank", title: "", text: "" }
          : { href: "https://seller.shopee.co.id/portal/sale/order", title: "Shopee", text: "Orders" };
      },
    },
    store: storeStub(),
    waits: { visit: 0 },
  });
  const info = await collector.ensurePage("blank-store", shopee, "https://seller.shopee.co.id/portal/sale/order");
  assert.equal(visits, 0);
  assert.deepEqual(reopened, [
    ["close", "blank-store"],
    ["open", "blank-store", "https://seller.shopee.co.id/portal/sale/order"],
  ]);
  assert.equal(info.href, "https://seller.shopee.co.id/portal/sale/order");
});

test("Shopee 429 只重试当前报表窗口，不回到整店采集", async () => {
  const collector = new Collector({
    cli: {},
    store: storeStub(),
    waits: {
      shopeeReportGap: 0,
      shopeeRateLimitSchedule: [0],
      shopeeRateLimitJitterMin: 0,
      shopeeRateLimitJitterMax: 0,
      shopeeReportRetries: 1,
    },
  });
  let attempts = 0;
  collector.waitForShopeeReportSlot = async () => null;
  collector.cli = {
    visit: async () => null,
    runInPage: async (_storeId, body) => {
      if (body.includes("request_order_report")) {
        attempts += 1;
        if (attempts === 1) throw new Error("SHOPEE_RATE_LIMIT|0|接口限流");
        const invalidButComplete = Buffer.from("not-an-xlsx");
        return { reportId: "retry-current-window", bytes: invalidButComplete.length, base64: invalidButComplete.toString("base64") };
      }
      return { href: "https://seller.shopee.co.id/portal/sale/order", title: "Shopee", text: "Orders" };
    },
  };
  await assert.rejects(
    collector.collectShopeeOrderReport({
      store: { storeId: "limited-store", storeName: "限流测试店" },
      target: { country: "ID" },
      platform: shopee,
      origin: "https://seller.shopee.co.id",
      dates: ["2026-10-01"],
      timeoutMs: 90000,
    }),
    /xlsx|zip|worksheet|报表|格式|文件/i,
  );
  assert.equal(attempts, 2);
});
