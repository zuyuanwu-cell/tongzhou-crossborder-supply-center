import assert from "node:assert/strict";
import { buildReviewCenterPayload, canAccessReviewCenter, resolveReviewRange } from "../server/review-center.js";
import { buildShopDirectory } from "../server/shop-directory.js";

const now = new Date("2026-10-09T12:00:00.000Z");
const logs = [
  { id: "1", createdAt: "2026-10-09T01:00:00.000Z", action: "登录系统", targetType: "user", targetName: "张三", actorId: "u1", actorName: "张三", actorRole: "直营运营", details: { loginIp: "10.0.0.1" } },
  { id: "2", createdAt: "2026-10-09T02:00:00.000Z", action: "提交售后单", targetType: "after_sales_ticket", targetName: "AS-1", actorId: "u1", actorName: "张三", actorRole: "直营运营" },
  { id: "3", createdAt: "2026-10-08T03:00:00.000Z", action: "创建仓库工单", targetType: "warehouse_ticket", targetName: "WT-1", actorId: "u2", actorName: "李四", actorRole: "直营运营" },
  { id: "p1", createdAt: "2026-10-07T03:00:00.000Z", action: "登录系统", targetType: "user", targetName: "张三", actorId: "u1", actorName: "张三", actorRole: "直营运营" },
  { id: "p2", createdAt: "2026-10-06T03:00:00.000Z", action: "创建仓库工单", targetType: "warehouse_ticket", targetName: "WT-OLD", actorId: "u2", actorName: "李四", actorRole: "直营运营" },
  { id: "old", createdAt: "2026-09-01T03:00:00.000Z", action: "旧操作", targetType: "system", actorId: "u2", actorName: "李四" },
];

const afterSales = [{
  id: "AS-1",
  originalOrderNumber: "ORDER-1",
  warehouseId: "wh-1",
  warehouseName: "俄罗斯1仓",
  primaryReason: "仓库错发",
  secondaryReason: "补发且留错品",
  responsibility: { party: "warehouse", label: "仓库责任" },
  money: { totalWarehouseLiabilityCny: 128.5 },
  status: "completed",
  createdAt: "2026-10-08T00:00:00.000Z",
  updatedAt: "2026-10-09T00:00:00.000Z",
  completedAt: "2026-10-09T00:00:00.000Z",
  createdBy: "张三",
  timeline: [
    { type: "created", createdAt: "2026-10-08T00:00:00.000Z" },
    { type: "accept", createdAt: "2026-10-08T03:00:00.000Z" },
    { type: "complete", createdAt: "2026-10-09T00:00:00.000Z" },
  ],
  rejectionHistory: [],
}, {
  id: "AS-OLD",
  originalOrderNumber: "ORDER-OLD",
  warehouseId: "wh-1",
  warehouseName: "俄罗斯1仓",
  primaryReason: "仓库错发",
  secondaryReason: "退款",
  responsibility: { party: "warehouse", label: "仓库责任" },
  status: "completed",
  createdAt: "2026-10-07T00:00:00.000Z",
  updatedAt: "2026-10-07T08:00:00.000Z",
  completedAt: "2026-10-07T08:00:00.000Z",
  timeline: [{ type: "accept", createdAt: "2026-10-07T02:00:00.000Z" }],
}];

const outboundOrders = [
  { orderId: "O-1", sku: "SKU-A", productName: "头部产品", quantity: 80, shippedAt: "2026-10-08 12:00:00", warehouseId: "wh-1", warehouseName: "俄罗斯1仓", providerId: "sea_wms", country: "印度尼西亚", platform: "TikTok", shopCode: "SHOP-A", shopName: "店铺A" },
  { orderId: "O-2", sku: "SKU-A", productName: "头部产品", quantity: 20, shippedAt: "2026-10-09 12:00:00", warehouseId: "wh-2", warehouseName: "俄罗斯2仓", platform: "Ozon", shopCode: "SHOP-B", shopName: "店铺B" },
  { orderId: "O-3", sku: "SKU-B", productName: "新品", quantity: 10, shippedAt: "2026-10-09 12:00:00", warehouseId: "wh-2", warehouseName: "俄罗斯2仓", platform: "Ozon", shopCode: "SHOP-B", shopName: "店铺B" },
  { orderId: "O-P1", sku: "SKU-A", productName: "头部产品", quantity: 20, shippedAt: "2026-10-06 12:00:00", warehouseId: "wh-1", warehouseName: "俄罗斯1仓", providerId: "sea_wms", country: "印度尼西亚", platform: "TikTok", shopCode: "SHOP-A", shopName: "店铺A" },
  { orderId: "O-P2", sku: "SKU-A", productName: "头部产品", quantity: 30, shippedAt: "2026-10-07 12:00:00", warehouseId: "wh-2", warehouseName: "俄罗斯2仓", platform: "Ozon", shopCode: "SHOP-B", shopName: "店铺B" },
  { orderId: "O-P3", sku: "SKU-C", productName: "休眠产品", quantity: 30, shippedAt: "2026-10-07 12:00:00", warehouseId: "wh-1", warehouseName: "俄罗斯1仓", platform: "Ozon", shopCode: "SHOP-C", shopName: "店铺C" },
];

const warehouseTickets = [{
  id: "WT-1",
  title: "催发货",
  warehouseId: "wh-2",
  warehouseName: "俄罗斯2仓",
  category: "订单催促",
  priority: "urgent",
  status: "pending_warehouse",
  createdAt: "2026-10-08T00:00:00.000Z",
  updatedAt: "2026-10-08T00:00:00.000Z",
  createdBy: "李四",
  timeline: [{ type: "created", createdAt: "2026-10-08T00:00:00.000Z" }],
}];

const shopDirectory = buildShopDirectory({
  orders: outboundOrders,
  miaoshouShops: [{ shopId: "MS-ID-1", platform: "TikTok", site: "ID", platformShopName: "店铺A", shopNick: "印尼美妆旗舰店" }],
});

assert.equal(canAccessReviewCenter({ role: "admin" }), true);
assert.equal(canAccessReviewCenter({ role: "direct", user: { permissions: ["action_log", "operations"] } }), false, "普通账号即使有管理权限也不能访问复盘中心");

const range = resolveReviewRange({ from: "2026-10-08", to: "2026-10-09" }, now);
assert.deepEqual(range.days, ["2026-10-08", "2026-10-09"]);

const payload = buildReviewCenterPayload({
  from: "2026-10-08",
  to: "2026-10-09",
  now,
  actionLogs: logs,
  afterSalesTickets: afterSales,
  warehouseTickets,
  outboundOrders,
  shopDirectory,
  products: [
    { sku: "SKU-A", name: "头部产品", imageUrl: "https://example.com/a.png" },
    { sku: "SKU-C", name: "休眠产品" },
  ],
});

assert.equal(payload.overview.operations, 3);
assert.equal(payload.overview.activeUsers, 2);
assert.equal(payload.overview.collaborationTasks, 2);
assert.equal(payload.overview.openTasks, 1);
assert.equal(payload.overview.completionRate, 50);
assert.equal(payload.overview.responseSlaRate, 50, "一个 3 小时响应达标，一个 24 小时后仍未响应");
assert.equal(payload.overview.medianResponseHours, 3);
assert.equal(payload.afterSales.reasons[0].label, "仓库错发");
assert.equal(payload.afterSales.liabilityCny, 128.5);
assert.equal(payload.collaboration.warehouses.length, 2);
assert.equal(payload.collaboration.tickets.find((ticket) => ticket.id === "WT-1")?.overdue, true);
assert.equal("details" in payload.usage.entries[0], false, "复盘接口不能返回登录 IP 或原始详情载荷");
assert.deepEqual(payload.comparison.previousRange, { from: "2026-10-06", to: "2026-10-07", days: 2 });
assert.equal(payload.comparison.overview.operations.previous, 2);
assert.equal(payload.comparison.overview.operations.changeRate, 50);
assert.equal(payload.usage.daily[0].previousDate, "2026-10-06");
assert.equal(payload.products.summary.outboundQty, 110);
assert.equal(payload.products.summary.outboundComparison.previous, 80);
assert.equal(payload.products.summary.outboundComparison.changeRate, 37.5);
assert.equal(payload.products.head[0].sku, "SKU-A");
assert.equal(payload.products.growth[0].changeQty, 50);
assert.equal(payload.products.tail[0].trend, "dormant");
assert.equal(payload.products.tail[0].sku, "SKU-C");
assert.equal(payload.products.head[0].warehouses.length, 2);
assert.deepEqual(payload.products.head[0].warehouses.map((row) => row.warehouseName), ["俄罗斯1仓", "俄罗斯2仓"]);
assert.equal(payload.products.head[0].warehouses[0].changeQty, 60);
assert.equal(payload.products.head[0].warehouses[0].changeContribution, 120, "仓库拉升可超过产品净增长，体现被其他仓库抵消的部分");
assert.equal(payload.products.head[0].warehouses[1].changeQty, -10);
assert.equal(payload.products.head[0].warehouses[1].changeContribution, -20);
assert.equal(payload.products.head[0].warehouses[0].shops[0].shopName, "印尼美妆旗舰店");
assert.equal(payload.products.head[0].warehouses[0].shops[0].shopAlias, "印尼美妆旗舰店");
assert.equal(payload.products.head[0].warehouses[0].shops[0].rawShopName, "店铺A");
assert.equal(payload.products.head[0].warehouses[1].shops[0].shopAlias, "", "非东南亚 WMS 店铺保持原始名称");
assert.equal(payload.products.head[0].warehouses.reduce((sum, row) => sum + row.changeContribution, 0), 100);

console.log("review-center tests passed");
