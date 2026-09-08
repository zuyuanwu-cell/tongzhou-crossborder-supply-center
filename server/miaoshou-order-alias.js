import { normalizeMiaoshouPackages } from "./miaoshou-performance.js";

const MAX_ORDER_NUMBERS = 100;
const API_ORDER_BATCH_SIZE = 20;
const API_SHOP_BATCH_SIZE = 100;
const API_PAGE_SIZE = 50;
const MAX_API_PAGES = 10;

function text(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function validOrderNumber(value) {
  return Boolean(value) && value.length <= 160 && !/[\r\n,]/.test(value);
}

function publicApiError(error) {
  const code = text(error?.code);
  if (code === "accountApiQpsRateLimit") return "妙手接口访问频率较高，请稍后重试";
  if (code === "timeout" || code === "network_error") return "妙手接口暂时无法连接，请稍后重试";
  return text(error?.message) || "妙手订单查询失败";
}

function resultFor(orderNumber, orders, shopById, { liveQueried = false, queryFailure = "" } = {}) {
  const exactOrders = (Array.isArray(orders) ? orders : []).filter((order) => text(order.platformOrderSn) === orderNumber);
  const shopIds = [...new Set(exactOrders.map((order) => text(order.shopId)).filter(Boolean))];
  if (!validOrderNumber(orderNumber)) {
    return {
      orderNumber,
      shopAlias: "未匹配",
      platformShopName: "",
      platform: "",
      site: "",
      shopId: "",
      status: "invalid",
      source: "",
      note: "订单号格式无效",
    };
  }
  if (liveQueried && queryFailure) {
    return {
      orderNumber,
      shopAlias: "未匹配",
      platformShopName: "",
      platform: "",
      site: "",
      shopId: "",
      status: "query_failed",
      source: "miaoshou_live",
      note: queryFailure,
    };
  }
  if (!exactOrders.length) {
    return {
      orderNumber,
      shopAlias: "未匹配",
      platformShopName: "",
      platform: "",
      site: "",
      shopId: "",
      status: "unmatched",
      source: liveQueried ? "miaoshou_live" : "local_cache",
      note: "妙手未查到该平台订单号",
    };
  }
  if (shopIds.length !== 1) {
    return {
      orderNumber,
      shopAlias: "未匹配",
      platformShopName: "",
      platform: "",
      site: "",
      shopId: "",
      status: "ambiguous",
      source: liveQueried ? "miaoshou_live" : "local_cache",
      note: `同一订单号关联 ${shopIds.length} 家店铺，已停止自动判断`,
    };
  }
  const matchedOrder = exactOrders.find((order) => text(order.shopId) === shopIds[0]) || exactOrders[0];
  const shop = shopById.get(shopIds[0]);
  if (!shop) {
    return {
      orderNumber,
      shopAlias: "未匹配",
      platformShopName: "",
      platform: text(matchedOrder.platform),
      site: text(matchedOrder.site),
      shopId: shopIds[0],
      status: "shop_missing",
      source: liveQueried ? "miaoshou_live" : "local_cache",
      note: "订单已定位，但该店铺不在当前妙手店铺目录中",
    };
  }
  const shopAlias = text(shop.shopNick);
  if (!shopAlias) {
    return {
      orderNumber,
      shopAlias: "未匹配",
      platformShopName: text(shop.platformShopName),
      platform: text(matchedOrder.platform || shop.platform),
      site: text(matchedOrder.site || shop.site).toUpperCase(),
      shopId: shopIds[0],
      status: "alias_missing",
      source: liveQueried ? "miaoshou_live" : "local_cache",
      note: "订单已定位，但妙手店铺尚未配置别名",
    };
  }
  return {
    orderNumber,
    shopAlias,
    platformShopName: text(shop.platformShopName),
    platform: text(matchedOrder.platform || shop.platform),
    site: text(matchedOrder.site || shop.site).toUpperCase(),
    shopId: shopIds[0],
    status: "matched",
    source: liveQueried ? "miaoshou_live" : "local_cache",
    note: "平台订单号与妙手店铺 ID 唯一匹配",
  };
}

export function createMiaoshouOrderAliasMatcher({ store, connector } = {}) {
  if (!store?.findMiaoshouOrdersByPlatformOrderSns || !connector?.performanceContext) {
    throw new Error("订单别名匹配服务缺少数据源");
  }

  async function match(input = {}) {
    const requested = [...new Set((Array.isArray(input.orderNumbers) ? input.orderNumbers : [])
      .map((value) => text(value))
      .filter(Boolean))];
    if (!requested.length) throw new Error("请至少提供一个平台订单号");
    if (requested.length > MAX_ORDER_NUMBERS) throw new Error(`单次最多匹配 ${MAX_ORDER_NUMBERS} 个平台订单号`);

    const valid = requested.filter(validOrderNumber);
    const context = connector.performanceContext();
    const activeShops = Array.isArray(context.shops) ? context.shops : [];
    const publicShops = connector.publicPayload
      ? connector.publicPayload({ taskLimit: 0, eventLimit: 0 })?.shops
      : null;
    const shops = Array.isArray(publicShops) && publicShops.length ? publicShops : activeShops;
    const shopById = new Map(shops.map((shop) => [text(shop.shopId), shop]).filter(([shopId]) => shopId));
    const cachedOrders = store.findMiaoshouOrdersByPlatformOrderSns(valid);
    const cachedNumbers = new Set(cachedOrders.map((order) => text(order.platformOrderSn)).filter(Boolean));
    const missing = valid.filter((orderNumber) => !cachedNumbers.has(orderNumber));
    const liveOrders = [];
    const liveItems = [];
    const failures = [];
    const failureByOrder = new Map();

    function recordFailure(orderNumbers, message) {
      failures.push(message);
      for (const orderNumber of orderNumbers) {
        const current = failureByOrder.get(orderNumber) || [];
        current.push(message);
        failureByOrder.set(orderNumber, current);
      }
    }

    if (missing.length) {
      if (!context.hasCredentials) {
        recordFailure(missing, "妙手授权未配置，无法实时补查");
      } else {
        const shopsByPlatform = new Map();
        for (const shop of activeShops) {
          const platform = text(shop.platform);
          const shopId = text(shop.shopId);
          if (!platform || !shopId) continue;
          const list = shopsByPlatform.get(platform) || [];
          list.push(shopId);
          shopsByPlatform.set(platform, list);
        }
        if (!shopsByPlatform.size) recordFailure(missing, "妙手店铺目录为空，请先同步店铺");
        for (const orderBatch of chunks(missing, API_ORDER_BATCH_SIZE)) {
          for (const [platform, platformShopIds] of shopsByPlatform) {
            for (const shopBatch of chunks([...new Set(platformShopIds)], API_SHOP_BATCH_SIZE)) {
              try {
                for (let page = 1; page <= MAX_API_PAGES; page += 1) {
                  const payload = await connector.searchPerformancePackages({
                    page,
                    pageSize: API_PAGE_SIZE,
                    platform,
                    shopIds: shopBatch,
                    platformOrderSns: orderBatch.join(","),
                  });
                  const normalized = normalizeMiaoshouPackages(payload);
                  const requestedSet = new Set(orderBatch);
                  liveOrders.push(...normalized.orders.filter((order) => requestedSet.has(text(order.platformOrderSn))));
                  liveItems.push(...normalized.items.filter((item) => (
                    normalized.orders.some((order) => order.identity === item.orderIdentity && requestedSet.has(text(order.platformOrderSn)))
                  )));
                  if (normalized.sourceRowCount < API_PAGE_SIZE) break;
                  if (page === MAX_API_PAGES) throw new Error("查询结果超过安全分页上限，请缩小单次订单数量");
                }
              } catch (error) {
                recordFailure(orderBatch, `${platform}：${publicApiError(error)}`);
              }
            }
          }
        }
      }
    }

    const uniqueLiveOrders = [...new Map(liveOrders.map((order) => [text(order.identity), order])).values()];
    const uniqueLiveItems = [...new Map(liveItems.map((item) => [text(item.identity), item])).values()];
    if (uniqueLiveOrders.length && store.upsertMiaoshouPerformance) {
      store.upsertMiaoshouPerformance({ orders: uniqueLiveOrders, items: uniqueLiveItems });
    }

    const allOrders = [...cachedOrders, ...uniqueLiveOrders];
    const liveNumbers = new Set(uniqueLiveOrders.map((order) => text(order.platformOrderSn)).filter(Boolean));
    const results = requested.map((orderNumber) => resultFor(orderNumber, allOrders, shopById, {
      liveQueried: missing.includes(orderNumber),
      queryFailure: [...new Set(failureByOrder.get(orderNumber) || [])].join("；"),
    }));
    const counts = results.reduce((summary, result) => {
      summary.total += 1;
      if (result.status === "matched") summary.matched += 1;
      else if (result.status === "unmatched") summary.unmatched += 1;
      else summary.needsReview += 1;
      if (result.source === "local_cache") summary.cacheHits += 1;
      if (liveNumbers.has(result.orderNumber)) summary.liveHits += 1;
      return summary;
    }, { total: 0, matched: 0, unmatched: 0, needsReview: 0, cacheHits: 0, liveHits: 0 });

    return {
      ok: true,
      queryComplete: !failures.length,
      message: failures.length ? [...new Set(failures)].join("；") : "匹配完成",
      counts,
      results,
    };
  }

  return { match };
}
