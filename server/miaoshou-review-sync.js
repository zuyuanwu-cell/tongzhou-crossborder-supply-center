import { miaoshouBusinessDate } from "./miaoshou-performance.js";
import { COUNTRY_CURRENCY } from "./shop-daily-report.js";
import { normalizedCountryKey } from "./performance-analytics.js";

const DAY = 86400000;
const BEIJING = "+08:00";
const PLAN_SIZE = 160;
const text = (value) => String(value ?? "").trim();
const orderKey = ({ shopId, orderNo }) => JSON.stringify([shopId, orderNo]);
const dateAt = (time) => new Date(time).toISOString().slice(0, 10);

export function createMiaoshouReviewSync({ env, getShops, performanceStore, reviewStore, now = Date.now }) {
  const nodeId = text(env.MIAOSHOU_REVIEW_SYNC_NODE_ID);
  const shopIds = new Set(text(env.MIAOSHOU_REVIEW_SYNC_SHOP_IDS).split(",").map(text).filter(Boolean));
  const allBoundShops = shopIds.has("*");
  const mode = text(env.MIAOSHOU_REVIEW_SYNC_MODE) || "preview";
  const fromDate = text(env.MIAOSHOU_REVIEW_SYNC_FROM);
  const configuredStart = /^\d{4}-\d{2}-\d{2}$/.test(fromDate) ? Date.parse(`${fromDate}T00:00:00${BEIJING}`) : NaN;
  const validStart = !fromDate || (Number.isFinite(configuredStart) && dateAt(configuredStart + 8 * 3600000) === fromDate);
  const enabled = Boolean(nodeId && shopIds.size && validStart && ["preview", "apply"].includes(mode));
  const assigned = (candidate) => enabled && candidate === nodeId;
  const allowedShopId = (id) => Boolean(id && (allBoundShops || shopIds.has(id)));
  const historyStart = (time) => Math.max(time - 90 * DAY, configuredStart || 0);

  function shopScope() {
    const shops = new Map();
    const ambiguous = new Set();
    let unbound = 0;
    for (const shop of getShops()) {
      const id = text(shop.miaoshouShopId);
      if (!allowedShopId(id) || shop.miaoshouBindingStale) {
        if (allBoundShops) unbound += 1;
        continue;
      }
      if (shops.has(id)) ambiguous.add(id);
      shops.set(id, shop);
    }
    for (const id of ambiguous) shops.delete(id);
    const unboundShopCount = allBoundShops ? unbound + ambiguous.size : [...shopIds].filter((id) => !shops.has(id)).length;
    return { shops, unboundShopCount };
  }

  function plan({ recent, history }) {
    const { shops, unboundShopCount } = shopScope();
    const time = now();
    const cutoff = dateAt(time - 2 * DAY);
    function page(from, to, cursor) {
      const safeCursor = /^\d{4}-\d{2}-\d{2}/.test(text(cursor?.date)) && text(cursor?.identity)
        ? { date: text(cursor.date).slice(0, 35), identity: text(cursor.identity).slice(0, 400) }
        : null;
      const rows = performanceStore.listMiaoshouReviewCandidates([...shops.keys()], { from, to, cursor: safeCursor, limit: PLAN_SIZE + 1 });
      const batch = rows.slice(0, PLAN_SIZE);
      const last = batch.at(-1);
      return {
        orders: batch.map(({ shopId, orderNo }) => ({ shopId, orderNo })),
        next: rows.length > PLAN_SIZE ? { date: last.date, identity: last.identity } : null,
      };
    }
    return {
      mode,
      unboundShopCount,
      recent: page(new Date(Math.max(Date.parse(cutoff), historyStart(time))).toISOString(), dateAt(time + 2 * DAY), recent),
      history: history === false ? null : page(new Date(historyStart(time)).toISOString(), cutoff, history),
    };
  }

  function ingest(body) {
    const { observations, observedAt } = body ?? {};
    const time = now();
    const observed = Date.parse(observedAt);
    if (!Array.isArray(observations) || !observations.length || observations.length > PLAN_SIZE * 2 ||
        !Number.isFinite(observed) || observed > time + 5 * 60000 || observed < time - DAY) return null;
    const state = new Map();
    for (const row of observations) {
      const shopId = text(row?.shopId);
      const orderNo = text(row?.orderNo);
      if (!allowedShopId(shopId) || !orderNo || orderNo.length > 120 || typeof row.marked !== "boolean") return null;
      const key = orderKey({ shopId, orderNo });
      if (state.has(key) && state.get(key) !== row.marked) return null;
      state.set(key, row.marked);
    }
    const { shops } = shopScope();
    const orderNos = [...new Set(observations.map((row) => text(row.orderNo)))];
    const rows = [];
    let missingSettlement = 0;
    for (const order of performanceStore.findMiaoshouOrdersByPlatformOrderSns(orderNos)) {
      const key = orderKey({ shopId: order.shopId, orderNo: order.platformOrderSn });
      const shop = shops.get(order.shopId);
      if (!shop || !state.has(key) || !(Date.parse(order.orderStartedAt) >= historyStart(time))) continue;
      const marked = state.get(key);
      const date = miaoshouBusinessDate(order.paidAt || order.orderStartedAt, order.site || shop.country);
      const currency = COUNTRY_CURRENCY[normalizedCountryKey(shop.country)];
      if (marked && (!date || !order.currency || (currency && currency !== order.currency))) continue;
      // 现有订单库把缺失结算金额归一成 0，需要结算时间和可区分的金额再回填。
      const receivedAmount = Number.isFinite(Date.parse(order.settledAt)) && order.escrowAmount !== 0 ? order.escrowAmount : null;
      if (marked && receivedAmount === null) missingSettlement += 1;
      rows.push({ shopKey: shop.key, shopName: shop.displayName, orderNo: order.platformOrderSn, date,
        marked, amount: order.payAmount > 0 ? order.payAmount : null, receivedAmount });
      state.delete(key);
    }
    const dryRun = mode === "preview";
    const counts = reviewStore.syncMiaoshouReviews(rows, { observedAt: new Date(observed).toISOString(), dryRun });
    return { ok: true, dryRun, ...counts, unmatched: state.size, missingSettlement };
  }

  return { assigned, plan, ingest };
}
