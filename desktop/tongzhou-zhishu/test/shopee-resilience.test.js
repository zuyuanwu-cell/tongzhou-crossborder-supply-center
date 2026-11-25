"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { Collector, classifyFailure, shopeeRateLimitDetails, shopeeRateLimitCooldown, shopeeReportGap } = require("../core/collector");
const { orderReportBody, loginRecoveryBody, pageInfoBody } = require("../core/page-scripts");
const shopee = require("../core/platforms/shopee");

function storeStub() {
  return { get: () => ({ ziniao: {} }) };
}

test("Shopee normal report requests use a randomized 20-45 second gap", () => {
  assert.equal(shopeeReportGap({ minMs: 20_000, maxMs: 45_000, random: () => 0 }), 20_000);
  assert.equal(shopeeReportGap({ minMs: 20_000, maxMs: 45_000, random: () => 1 }), 45_000);
  const collector = new Collector({ cli: {}, store: storeStub(), random: () => 0.5 });
  assert.equal(collector.nextShopeeReportGap(), 32_500);
  const disabled = new Collector({ cli: {}, store: storeStub(), waits: { shopeeReportGap: 0 } });
  assert.equal(disabled.nextShopeeReportGap(), 0);
});

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
  assert.match(script, /savedAccount/);
  assert.match(script, /!loginUrl && !password && !submit && !savedAccount/);
  assert.doesNotMatch(script, /value:\s*password\.value/);
  assert.doesNotMatch(script, /password:\s*password\.value/);
});

test("Shopee preflight only closes known non-security overlays and reports login controls", () => {
  const script = pageInfoBody();
  assert.match(script, /TZ_PAGE_PREFLIGHT/);
  assert.match(script, /protectedText/);
  assert.match(script, /不再显示/);
  assert.match(script, /hasPassword/);
  assert.match(script, /hasLoginControl/);
  assert.match(script, /hasCaptcha/);
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

test("Shopee 已登录页面首次 CDP 瞬断时原位重附着，不关闭店铺窗口", async () => {
  let pageReads = 0;
  const storeActions = [];
  const collector = new Collector({
    cli: {
      runInPage: async () => {
        pageReads += 1;
        if (pageReads === 1) {
          const error = new Error("Browser automation failed: temporary CDP disconnect");
          error.code = "CDP_ERROR";
          throw error;
        }
        return { href: "https://seller.shopee.co.id/portal/sale/order", title: "Shopee", text: "Orders" };
      },
      closeStore: async ({ storeId }) => storeActions.push(["close", storeId]),
      openStore: async ({ storeId }) => storeActions.push(["open", storeId]),
      visit: async () => null,
    },
    store: storeStub(),
    waits: { pageProbeRetry: 0, pageProbeAttempts: 3, visit: 0 },
  });
  const info = await collector.ensurePage("store-cdp", shopee, "https://seller.shopee.co.id/portal/sale/order");
  assert.equal(info.href, "https://seller.shopee.co.id/portal/sale/order");
  assert.equal(pageReads, 2);
  assert.deepEqual(storeActions, []);
});

test("Shopee 登录检测与恢复之间已完成登录时重新确认页面，不误报未登录", async () => {
  let pageReads = 0;
  let recoveryRuns = 0;
  const collector = new Collector({
    cli: {
      visit: async () => null,
      runInPage: async (_storeId, body) => {
        if (body.includes("TZ_SHOPEE_LOGIN_RECOVERY")) {
          recoveryRuns += 1;
          return { attempted: false, alreadyLoggedIn: true };
        }
        pageReads += 1;
        return pageReads === 1
          ? { href: "https://seller.shopee.co.id/account/signin", title: "Login", text: "Login" }
          : { href: "https://seller.shopee.co.id/portal/sale/order", title: "Shopee", text: "Orders" };
      },
    },
    store: storeStub(),
    waits: { pageProbeRetry: 0, visit: 0, shopeeLogin: 0 },
  });
  const info = await collector.ensurePage("store-race", shopee, "https://seller.shopee.co.id/portal/sale/order");
  assert.equal(recoveryRuns, 1);
  assert.equal(info.href, "https://seller.shopee.co.id/portal/sale/order");
});

test("Shopee 登录恢复阶段 CDP 瞬断后重开当前店铺并继续登录", async () => {
  let pageReads = 0;
  let recoveryRuns = 0;
  const storeActions = [];
  const collector = new Collector({
    cli: {
      runInPage: async (_storeId, body) => {
        if (body.includes("TZ_SHOPEE_LOGIN_RECOVERY")) {
          recoveryRuns += 1;
          if (recoveryRuns === 1) {
            const error = new Error("Browser automation failed");
            error.code = "CDP_ERROR";
            throw error;
          }
          return { attempted: true, method: "button" };
        }
        pageReads += 1;
        return pageReads < 3
          ? { href: "https://seller.shopee.co.id/account/signin", title: "Login", text: "Login" }
          : { href: "https://seller.shopee.co.id/portal/sale/order", title: "Shopee", text: "Orders" };
      },
      closeStore: async ({ storeId }) => storeActions.push(["close", storeId]),
      openStore: async ({ storeId }) => storeActions.push(["open", storeId]),
      visit: async () => null,
    },
    store: storeStub(),
    waits: {
      fresh: 0,
      pageProbeRetry: 0,
      pageReadyRetry: 0,
      visit: 0,
      shopeeLogin: 0,
      shopeeLoginPollRetry: 0,
      shopeeLoginPollAttempts: 2,
    },
  });
  const info = await collector.ensurePage("store-recovery-cdp", shopee, "https://seller.shopee.co.id/portal/sale/order");
  assert.equal(info.href, "https://seller.shopee.co.id/portal/sale/order");
  assert.equal(recoveryRuns, 2);
  assert.deepEqual(storeActions, [["close", "store-recovery-cdp"], ["open", "store-recovery-cdp"]]);
  const wrapped = new Error("Shopee 官方订单导表失败：卖家中心未登录", {
    cause: Object.assign(new Error("Browser automation failed"), { code: "CDP_ERROR" }),
  });
  assert.equal(classifyFailure(wrapped), "browser_session");
});

test("Shopee 等待页面加载完成并识别卖家中心内嵌登录层", async () => {
  let reads = 0;
  let recoveryRuns = 0;
  const collector = new Collector({
    cli: {
      visit: async () => null,
      runInPage: async (_storeId, body) => {
        if (body.includes("TZ_SHOPEE_LOGIN_RECOVERY")) {
          recoveryRuns += 1;
          return { attempted: true, method: "saved-account" };
        }
        reads += 1;
        if (reads === 1) return { href: "https://seller.shopee.co.id/portal/sale/order", ready: "loading", text: "" };
        if (reads === 2) return { href: "https://seller.shopee.co.id/portal/sale/order", ready: "complete", hasPassword: true, text: "Login" };
        return { href: "https://seller.shopee.co.id/portal/sale/order", ready: "complete", text: "Orders" };
      },
    },
    store: storeStub(),
    waits: {
      pageReadyRetry: 0,
      pageReadyAttempts: 3,
      visit: 0,
      shopeeLogin: 0,
      shopeeLoginPollRetry: 0,
      shopeeLoginPollAttempts: 2,
    },
  });
  const info = await collector.ensurePage("store-overlay", shopee, "https://seller.shopee.co.id/portal/sale/order");
  assert.equal(recoveryRuns, 1);
  assert.equal(info.href, "https://seller.shopee.co.id/portal/sale/order");
  assert.equal(reads, 3);
});

test("Shopee 页面脚本内的 429 仍归入限流，不被浏览器会话分类吞掉", () => {
  const wrapped = Object.assign(new Error("页面脚本出错：Error: Shopee 订单报表接口 HTTP 429"), {
    code: "PAGE_SCRIPT_ERROR",
  });
  assert.equal(classifyFailure(wrapped), "rate_limit");
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

test("Shopee initial CDP session failure fully reopens the current store", async () => {
  let pageReads = 0;
  const storeActions = [];
  const collector = new Collector({
    cli: {
      runInPage: async () => {
        pageReads += 1;
        if (pageReads <= 3) {
          const error = new Error("Browser automation failed: stale CDP session");
          error.code = "CDP_ERROR";
          throw error;
        }
        return { href: "https://seller.shopee.co.id/portal/sale/order", title: "Shopee", text: "Orders" };
      },
      closeStore: async ({ storeId }) => storeActions.push(["close", storeId]),
      openStore: async ({ storeId, url }) => storeActions.push(["open", storeId, url]),
      visit: async () => null,
    },
    store: storeStub(),
    waits: {
      fresh: 0,
      pageProbeRetry: 0,
      pageProbeAttempts: 3,
      pageReadyRetry: 0,
      storeReconnectAttempts: 2,
      storeReconnectDelay: 0,
      visit: 0,
    },
  });
  const info = await collector.ensurePage("store-stale-session", shopee, "https://seller.shopee.co.id/portal/sale/order");
  assert.equal(info.href, "https://seller.shopee.co.id/portal/sale/order");
  assert.equal(pageReads, 4);
  assert.deepEqual(storeActions, [
    ["close", "store-stale-session"],
    ["open", "store-stale-session", "https://seller.shopee.co.id/portal/sale/order"],
  ]);
});

test("Shopee store reconnect retries once and remains bounded", async () => {
  let pageReads = 0;
  const storeActions = [];
  const collector = new Collector({
    cli: {
      runInPage: async () => {
        pageReads += 1;
        if (pageReads <= 4) {
          const error = new Error("ZClaw request timed out");
          error.code = "ZCLAW_TIMEOUT";
          throw error;
        }
        return { href: "https://seller.shopee.co.id/portal/sale/order", title: "Shopee", text: "Orders" };
      },
      closeStore: async ({ storeId }) => storeActions.push(["close", storeId]),
      openStore: async ({ storeId, url }) => storeActions.push(["open", storeId, url]),
      visit: async () => null,
    },
    store: storeStub(),
    waits: {
      fresh: 0,
      pageProbeRetry: 0,
      pageProbeAttempts: 2,
      pageReadyRetry: 0,
      storeReconnectAttempts: 2,
      storeReconnectDelay: 0,
      visit: 0,
    },
  });
  const info = await collector.ensurePage("store-reopen-twice", shopee, "https://seller.shopee.co.id/portal/sale/order");
  assert.equal(info.href, "https://seller.shopee.co.id/portal/sale/order");
  assert.equal(pageReads, 5);
  assert.deepEqual(storeActions, [
    ["close", "store-reopen-twice"],
    ["open", "store-reopen-twice", "https://seller.shopee.co.id/portal/sale/order"],
    ["close", "store-reopen-twice"],
    ["open", "store-reopen-twice", "https://seller.shopee.co.id/portal/sale/order"],
  ]);
});
