import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initPerformanceAnalyticsStore } from "../server/performance-analytics-db.js";
import { createMiaoshouPerformanceSyncService } from "../server/miaoshou-performance-sync.js";
import {
  classifyMiaoshouAfterSalesStatus,
  normalizeMiaoshouCancellations,
  normalizeMiaoshouPackages,
  normalizeMiaoshouReturns,
  reconcileMiaoshouPerformance,
} from "../server/miaoshou-performance.js";

// --- 售后终态判定：申请中 / 处理中不能当成已完成 ------------------------------------
const pendingReturns = ["REFUND_REQUESTED", "REFUNDING", "IN_REFUND", "退款处理中", "待卖家处理", "申请退款"];
for (const status of pendingReturns) {
  assert.equal(classifyMiaoshouAfterSalesStatus("return", { appReturnStatus: status }), "pending", status);
}
for (const status of ["REFUNDED", "REFUND_SUCCESS", "退款成功", "已退款", "completed"]) {
  assert.equal(classifyMiaoshouAfterSalesStatus("return", { appReturnStatus: status }), "finalized", status);
}
// 含义不明确的状态（如 CLOSED）不当成终态，并在对账页的状态字典里提示人工确认。
assert.equal(classifyMiaoshouAfterSalesStatus("return", { appReturnStatus: "CLOSED" }), "unknown");
for (const status of ["REJECTED", "退款已驳回", "买家撤销"]) {
  assert.equal(classifyMiaoshouAfterSalesStatus("return", { appReturnStatus: status }), "rejected", status);
}
assert.equal(classifyMiaoshouAfterSalesStatus("return", { gmtFinish: "2026-08-03 12:00:00" }), "finalized", "只有完成时间时视为终态");
assert.equal(classifyMiaoshouAfterSalesStatus("return", { appReturnStatus: "REFUND_REQUESTED", gmtFinish: "2026-08-03" }), "pending", "处理中状态优先于时间字段");
for (const status of ["IN_CANCEL", "CANCEL_REQUESTED", "取消申请中", "cancelling"]) {
  assert.equal(classifyMiaoshouAfterSalesStatus("cancellation", { appCancelStatus: status }), "pending", status);
}
for (const status of ["CANCELLED", "canceled", "已取消", "取消成功"]) {
  assert.equal(classifyMiaoshouAfterSalesStatus("cancellation", { appCancelStatus: status }), "finalized", status);
}

const cancellations = normalizeMiaoshouCancellations({ data: { orderCancelList: [
  { platform: "shopee", shopId: "1", platformOrderSn: "A", appCancelStatus: "IN_CANCEL" },
  { platform: "shopee", shopId: "1", platformOrderSn: "B", appCancelStatus: "CANCELLED" },
] } });
assert.deepEqual(cancellations.map((row) => [row.platformOrderSn, row.finalized, row.statusClass]), [["A", false, "pending"], ["B", true, "finalized"]]);

// --- 退款没有单号时，标识稳定且不会跨页覆盖 -------------------------------------------
const pageOne = normalizeMiaoshouReturns({ data: { orderReturnList: [
  { platform: "shopee", shopId: "1", platformOrderSn: "A", refundAmount: 5, gmtCreate: "2026-08-01 10:00:00", appReturnStatus: "REFUNDED" },
] } });
const pageTwo = normalizeMiaoshouReturns({ data: { orderReturnList: [
  { platform: "shopee", shopId: "2", platformOrderSn: "B", refundAmount: 9, gmtCreate: "2026-08-01 11:00:00", appReturnStatus: "REFUNDED" },
] } });
assert.notEqual(pageOne[0].identity, pageTwo[0].identity, "不同店铺的第一条退款不能共用标识");
assert.equal(pageOne[0].identity, normalizeMiaoshouReturns({ data: { orderReturnList: [
  { platform: "shopee", shopId: "1", platformOrderSn: "A", refundAmount: 5, gmtCreate: "2026-08-01 10:00:00", appReturnStatus: "REFUNDED" },
] } })[0].identity, "同一条退款重复同步时标识不变");

// --- 时区：无时区时间按北京时间解析 ---------------------------------------------------
const tzPackage = normalizeMiaoshouPackages({ data: { orderPackageList: [{
  orderInfo: { platform: "shopee", shopId: "1", platformOrderSn: "TZ", gmtOrderStart: "2026-08-01 00:30:00", gmtPay: "1785515400" },
  items: [],
}] } });
assert.equal(tzPackage.orders[0].orderStartedAt, "2026-07-31T16:30:00.000Z");
assert.equal(tzPackage.orders[0].paidAt, new Date(1785515400 * 1000).toISOString(), "秒级时间戳");

// --- 金额口径与对账 -------------------------------------------------------------------
const orders = [{ identity: "tiktok|200|O1", platform: "tiktok", shopId: "200", platformOrderSn: "O1", currency: "IDR", payAmount: 100, orderAmount: 110, productAmount: 90, escrowAmount: 80 }];
const items = [{ identity: "tiktok|200|O1|1", orderIdentity: "tiktok|200|O1", platformOuterSkuId: "A", quantity: 1 }];
const facts = [{ id: "f1", sourceSystem: "sea", warehouseId: "w", orderNo: "O1", platform: "tiktok", miaoshouShopId: "200", sku: "A", quantity: 1, salesAmount: 110, currency: "IDR", salesAmountValid: true }];
const byOrderAmount = reconcileMiaoshouPerformance({ facts, orders, items, revenueBasis: "orderAmount", requestedSource: "miaoshou", syncState: { status: "success", lastSuccessAt: "x" } });
assert.equal(byOrderAmount.reconciliation.revenueBasis, "orderAmount");
assert.equal(byOrderAmount.reconciliation.amountVarianceRate, 0);
assert.equal(byOrderAmount.reconciliation.effectiveSource, "miaoshou");
assert.equal(byOrderAmount.facts[0].salesAmount, 110);
assert.equal(byOrderAmount.facts[0].miaoshouSettlementAmount, 80);
const comparison = Object.fromEntries(byOrderAmount.reconciliation.basisComparison.map((row) => [row.basis, row.amountVarianceRate]));
assert.equal(comparison.orderAmount, 0, "订单金额与 WMS 一致");
assert.ok(comparison.payAmount > 0, "买家实付与 WMS 有差异");
const defaultBasis = reconcileMiaoshouPerformance({ facts, orders, items, syncState: { status: "success", lastSuccessAt: "x" } });
assert.equal(defaultBasis.reconciliation.revenueBasis, "payAmount", "默认保持历史口径");
const withGaps = reconcileMiaoshouPerformance({ facts, orders, items, revenueBasis: "orderAmount", requestedSource: "miaoshou", syncState: { status: "success", lastSuccessAt: "x", afterSalesGaps: [{ kind: "return" }] } });
assert.equal(withGaps.reconciliation.effectiveSource, "wms", "售后缺口未补齐前不切换");
assert.match(withGaps.reconciliation.blockers.join(""), /售后/);
const pendingCancel = reconcileMiaoshouPerformance({
  facts, orders, items, revenueBasis: "orderAmount", requestedSource: "miaoshou",
  cancellations: [{ orderIdentity: "tiktok|200|O1", finalized: false, statusClass: "pending", appCancelStatus: "IN_CANCEL" }],
  syncState: { status: "success", lastSuccessAt: "x" },
});
assert.equal(pendingCancel.reconciliation.cancelledOutboundOrders, 0, "申请中的取消不算已取消");
assert.equal(pendingCancel.reconciliation.pendingCancellationCount, 1);
assert.ok(pendingCancel.reconciliation.statusDictionary.some((row) => row.status.includes("IN_CANCEL") && row.statusClass === "pending"));

// --- 入库变更检测：增量子集里没有变化的行不升级数据版本 -----------------------------------
{
  const directory = mkdtempSync(join(tmpdir(), "miaoshou-version-"));
  try {
    const store = await initPerformanceAnalyticsStore(join(directory, "analytics.sqlite"));
    const orderA = { identity: "shopee|1|A", platform: "shopee", shopId: "1", platformOrderSn: "A", currency: "IDR", payAmount: 10 };
    const orderB = { identity: "shopee|1|B", platform: "shopee", shopId: "1", platformOrderSn: "B", currency: "IDR", payAmount: 20 };
    store.upsertMiaoshouPerformance({ orders: [orderA, orderB] }, { status: "success" });
    const version = store.getMetadata().miaoshouDataVersion;
    store.upsertMiaoshouPerformance({ orders: [orderB] }, { status: "success" });
    assert.equal(store.getMetadata().miaoshouDataVersion, version, "只包含未变化行的增量不升级版本");
    store.upsertMiaoshouPerformance({ orders: [{ ...orderB, payAmount: 21 }] }, { status: "success" });
    assert.notEqual(store.getMetadata().miaoshouDataVersion, version, "行内容变化时升级版本");
    // 历史上被误判为「已取消」的记录，读取时按新规则重新判定。
    store.upsertMiaoshouPerformance({ cancellations: [{ identity: "shopee|1|A|cancel", orderIdentity: "shopee|1|A", appCancelStatus: "IN_CANCEL", finalized: true }] }, { status: "success" });
    assert.equal(store.listMiaoshouPerformance().cancellations[0].finalized, false);
    store.close?.();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// --- 同步服务：超页拆分、游标增量、售后节奏与缺口补齐 -------------------------------------
const directory = mkdtempSync(join(tmpdir(), "miaoshou-incremental-"));
try {
  const store = await initPerformanceAnalyticsStore(join(directory, "analytics.sqlite"));
  let clock = new Date("2026-08-05T02:00:00.000Z"); // 北京时间 10:00
  const calls = { packages: [], returns: [], cancellations: [] };
  let failReturns = false;
  let bigWindow = true;
  const fullPage = (input) => ({ data: { orderPackageList: Array.from({ length: 50 }, (_, index) => ({
    orderInfo: { platform: "shopee", shopId: "1", platformOrderSn: `${input.gmtModifiedFrom}-${input.page}-${index}`, currency: "IDR", payAmount: 1 },
    items: [],
  })) } });
  const connector = {
    performanceContext: () => ({ hasCredentials: true, shopsSyncedAt: "x", shops: [{ shopId: "1", platform: "shopee", site: "ID" }] }),
    searchPerformancePackages: async (input) => {
      calls.packages.push(input);
      const span = Date.parse(input.gmtModifiedTo.replace(" ", "T") + "Z") - Date.parse(input.gmtModifiedFrom.replace(" ", "T") + "Z");
      // 窗口超过 1 天时模拟单窗口超过 200 页。
      if (bigWindow && span > 24 * 3600 * 1000) return fullPage(input);
      return { data: { orderPackageList: [] } };
    },
    searchPerformanceReturns: async (input) => {
      calls.returns.push(input);
      if (failReturns) throw new Error("timeout");
      return { data: { orderReturnList: [] } };
    },
    searchPerformanceCancellations: async (input) => {
      calls.cancellations.push(input);
      return { data: { orderCancelList: [] } };
    },
  };
  const service = createMiaoshouPerformanceSyncService({ connector, store, now: () => clock, intervalMs: 5 * 60 * 1000, afterSalesIntervalMs: 30 * 60 * 1000, initialBackfillDays: 3 });

  const first = await service.run({ reason: "scheduled" });
  assert.equal(first.status, "success");
  assert.equal(first.incrementalMode, "window", "没有游标时按天回看");
  assert.ok(first.windowSplits > 0, "超过 200 页时自动拆分窗口而不是失败");
  assert.equal(first.modifiedCursor, "2026-08-05 10:00:00");
  assert.equal(calls.returns.length, 1);

  bigWindow = false;
  calls.packages.length = 0;
  calls.returns.length = 0;
  calls.cancellations.length = 0;
  clock = new Date("2026-08-05T02:06:00.000Z");
  const second = await service.run({ reason: "scheduled" });
  assert.equal(second.incrementalMode, "cursor");
  assert.equal(calls.packages.length, 1);
  assert.equal(calls.packages[0].gmtModifiedFrom, "2026-08-05 09:50:00", "游标向前重叠 10 分钟");
  assert.equal(calls.packages[0].gmtModifiedTo, "2026-08-05 10:06:00");
  assert.equal(calls.returns.length, 0, "售后在 30 分钟节奏内不重复拉取");
  assert.equal(second.afterSalesSkipped, true);

  failReturns = true;
  clock = new Date("2026-08-05T02:40:00.000Z");
  const third = await service.run({ reason: "scheduled" });
  assert.equal(third.status, "success", "售后失败不影响订单同步成功");
  assert.equal(third.afterSalesStatus, "partial");
  assert.equal(third.afterSalesGaps.length, 1);
  assert.equal(third.lastSuccessAt, clock.toISOString());

  failReturns = false;
  calls.returns.length = 0;
  clock = new Date("2026-08-05T02:46:00.000Z");
  const fourth = await service.run({ reason: "scheduled" });
  assert.ok(calls.returns.length >= 1, "有缺口时下一次立即补拉，不等 30 分钟");
  assert.equal(fourth.afterSalesGaps.length, 0);
  assert.equal(fourth.afterSalesStatus, "success");

  // 游标过旧（超过回看天数）时退回按天回看。
  clock = new Date("2026-08-12T02:00:00.000Z");
  const stale = await service.run({ reason: "scheduled" });
  assert.equal(stale.incrementalMode, "window");
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log("miaoshou incremental sync tests passed");
