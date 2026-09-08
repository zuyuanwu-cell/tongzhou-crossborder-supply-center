import assert from "node:assert/strict";
import { createMiaoshouOrderAliasMatcher } from "../server/miaoshou-order-alias.js";

function order(orderNumber, shopId, platform = "shopee") {
  return {
    identity: `${platform}|${shopId}|${orderNumber}`,
    platformOrderSn: orderNumber,
    shopId,
    platform,
    site: "ID",
  };
}

const cachedOrders = [
  order("CACHED-1", "SHOP-1"),
  order("NO-ALIAS", "SHOP-2"),
  order("AMBIGUOUS", "SHOP-1"),
  order("AMBIGUOUS", "SHOP-3"),
];
const upserts = [];
const requests = [];
const store = {
  findMiaoshouOrdersByPlatformOrderSns(orderNumbers) {
    return cachedOrders.filter((row) => orderNumbers.includes(row.platformOrderSn));
  },
  upsertMiaoshouPerformance(payload) {
    upserts.push(payload);
  },
};
const connector = {
  performanceContext() {
    return {
      hasCredentials: true,
      shops: [
        { shopId: "SHOP-1", platform: "shopee", site: "ID", shopNick: "印尼一店", platformShopName: "Shop One" },
        { shopId: "SHOP-2", platform: "shopee", site: "ID", shopNick: "", platformShopName: "Shop Two" },
        { shopId: "SHOP-3", platform: "shopee", site: "ID", shopNick: "印尼三店", platformShopName: "Shop Three" },
        { shopId: "SHOP-4", platform: "tiktok", site: "ID", shopNick: "印尼四店", platformShopName: "Shop Four" },
      ],
    };
  },
  async searchPerformancePackages(input) {
    requests.push(input);
    if (input.platform === "tiktok") throw new Error("没有符合条件的数据");
    const wanted = String(input.platformOrderSns || "");
    return {
      data: {
        orderPackageList: wanted === "LIVE-1" ? [{
          opOrderPackageId: "PKG-1",
          orderInfo: {
            opOrderId: "OP-1",
            platform: "shopee",
            shopId: "SHOP-1",
            platformOrderSn: "LIVE-1",
            site: "ID",
          },
          items: [],
        }] : [],
      },
    };
  },
};

const matcher = createMiaoshouOrderAliasMatcher({ store, connector });
const result = await matcher.match({
  orderNumbers: ["CACHED-1", "LIVE-1", "MISSING", "NO-ALIAS", "AMBIGUOUS", "BAD,ORDER"],
});
const byOrder = new Map(result.results.map((row) => [row.orderNumber, row]));

assert.equal(byOrder.get("CACHED-1")?.status, "matched");
assert.equal(byOrder.get("CACHED-1")?.shopAlias, "印尼一店");
assert.equal(byOrder.get("CACHED-1")?.source, "local_cache");
assert.equal(byOrder.get("LIVE-1")?.status, "matched");
assert.equal(byOrder.get("LIVE-1")?.source, "miaoshou_live");
assert.equal(byOrder.get("MISSING")?.status, "unmatched");
assert.equal(byOrder.get("NO-ALIAS")?.status, "alias_missing");
assert.equal(byOrder.get("NO-ALIAS")?.shopAlias, "未匹配");
assert.equal(byOrder.get("AMBIGUOUS")?.status, "ambiguous");
assert.equal(byOrder.get("BAD,ORDER")?.status, "invalid");
assert.equal(requests.length, 4);
assert.ok(requests.every((request) => !String(request.platformOrderSns).includes(",")));
assert.deepEqual(requests.map((request) => `${request.platform}:${request.platformOrderSns}`), [
  "shopee:LIVE-1",
  "tiktok:LIVE-1",
  "shopee:MISSING",
  "tiktok:MISSING",
]);
assert.equal(upserts.length, 1);
assert.equal(upserts[0].orders.length, 1);

const failingMatcher = createMiaoshouOrderAliasMatcher({
  store: {
    findMiaoshouOrdersByPlatformOrderSns() { return []; },
  },
  connector: {
    performanceContext: connector.performanceContext,
    async searchPerformancePackages() {
      const error = new Error("账户接口每秒请求频率超限");
      error.code = "accountApiQpsRateLimit";
      throw error;
    },
  },
});
const failed = await failingMatcher.match({ orderNumbers: ["RETRY-1"] });
assert.equal(failed.queryComplete, false);
assert.equal(failed.results[0].status, "query_failed");
assert.match(failed.results[0].note, /稍后重试/);

const partiallyFailingMatcher = createMiaoshouOrderAliasMatcher({
  store: {
    findMiaoshouOrdersByPlatformOrderSns() { return []; },
    upsertMiaoshouPerformance() {},
  },
  connector: {
    performanceContext: connector.performanceContext,
    async searchPerformancePackages(input) {
      if (input.platform === "tiktok") throw new Error("妙手接口请求超时");
      return {
        data: {
          orderPackageList: [{
            opOrderPackageId: "PKG-PARTIAL",
            orderInfo: {
              opOrderId: "OP-PARTIAL",
              platform: "shopee",
              shopId: "SHOP-1",
              platformOrderSn: input.platformOrderSns,
              site: "ID",
            },
            items: [],
          }],
        },
      };
    },
  },
});
const partial = await partiallyFailingMatcher.match({ orderNumbers: ["PARTIAL-1"] });
assert.equal(partial.queryComplete, false);
assert.equal(partial.results[0].status, "query_failed");
assert.match(partial.results[0].note, /已查到候选订单/);

const normalized = await matcher.match({ orderNumbers: ["'CACHED-1\u200B"] });
assert.equal(normalized.results[0].status, "matched");
assert.equal(normalized.results[0].orderNumber, "CACHED-1");

await assert.rejects(() => matcher.match({ orderNumbers: [] }), /至少提供一个/);
await assert.rejects(() => matcher.match({ orderNumbers: Array.from({ length: 101 }, (_, index) => `ORDER-${index}`) }), /最多匹配 100/);

console.log("miaoshou order alias matcher tests passed");
