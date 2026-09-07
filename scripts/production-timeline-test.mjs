import assert from "node:assert/strict";
import { buildProductionTimelines } from "../server/production-timeline.js";
import { buildOutsourcingOrderPayload } from "../server/normalize-outsourcing-orders.js";
import { buildStockupPayload } from "../server/stockup-center.js";

const workflow = {
  stockupOrders: [{
    id: "order-1",
    orderNo: "BHD-001",
    executionMode: "委外生产",
    status: "执行中",
    plannedQty: 100,
    orderedQty: 100,
    completedQty: 60,
    shippedQty: 20,
    receivedQty: 0,
    createdAt: "2026-08-28T02:00:00.000Z",
    updatedAt: "2026-09-05T08:00:00.000Z",
    expectedCompletedAt: "2026-09-10T08:00:00.000Z",
  }],
  stockupLines: [{
    id: "line-1",
    orderRecordId: "order-1",
    orderedQty: 100,
    completedQty: 60,
    qualifiedQty: 40,
    shippedQty: 20,
    updatedAt: "2026-09-05T08:00:00.000Z",
  }],
  shipments: [{
    id: "shipment-1",
    shipmentNo: "FH-001",
    stockupOrderRecordId: "order-1",
    destinationWarehouseName: "印尼仓",
    shippedAt: "2026-09-04T05:00:00.000Z",
  }],
};

const actionLog = {
  entries: [
    {
      id: "log-create",
      createdAt: "2026-08-28T02:00:00.000Z",
      action: "需求转备货执行",
      targetType: "stockup_execution",
      targetName: "BHD-001",
      actorName: "采购员",
      details: {},
    },
    {
      id: "log-progress",
      createdAt: "2026-09-02T03:00:00.000Z",
      action: "更新备货执行进度",
      targetType: "stockup_execution_line",
      targetName: "line-1",
      actorName: "跟单员",
      details: { status: "部分完工", totals: { orderedQty: 100, completedQty: 60, shippedQty: 0 } },
    },
    {
      id: "log-shipment",
      createdAt: "2026-09-04T05:00:00.000Z",
      action: "登记发货",
      targetType: "shipment",
      targetName: "shipment-1",
      actorName: "物流员",
      details: { stockupOrderRecordId: "order-1", warehouseName: "印尼仓", lineCount: 1 },
    },
  ],
};

const timelines = buildProductionTimelines(workflow, actionLog, [{
  id: "task-1",
  stockupOrderRecordId: "order-1",
  shipmentRecordId: "shipment-1",
  status: "pushed",
  pushedAt: "2026-09-04T06:00:00.000Z",
  wmsOrderNo: "WMS-001",
  warehouseName: "印尼仓",
  providerName: "SEA WMS",
}]);

assert.equal(timelines.length, 1);
assert.equal(timelines[0].orderRecordId, "order-1");
assert.equal(timelines[0].openedAt, "2026-08-28T02:00:00.000Z");
assert.deepEqual(timelines[0].events.map((event) => event.type), ["opened", "progress", "shipment", "wms", "expected"]);
assert.match(timelines[0].events[1].description, /已完工 60/);
assert.equal(timelines[0].events.filter((event) => event.type === "shipment").length, 1, "发货数据与操作日志不应重复生成节点");
assert.equal(timelines[0].events.at(-1).tone, "planned");

const legacy = buildProductionTimelines({
  stockupOrders: [{ id: "legacy-order", orderNo: "BHD-OLD", status: "执行中", plannedQty: 10, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-06T00:00:00.000Z" }],
  stockupLines: [{ id: "legacy-line", orderRecordId: "legacy-order", qualifiedQty: 2 }],
  shipments: [],
}, {}, []);

assert.deepEqual(legacy[0].events.map((event) => event.type), ["opened", "snapshot"]);
assert.match(legacy[0].events[1].description, /检验合格 2/);

const outsourcingPayload = buildOutsourcingOrderPayload([
  {
    data_id: "tongzhou-active",
    out_order_id: { value: "JG-TZ-001" },
    _widget_1753770713537: { value: "TZKJ-NK017" },
    _widget_1689415936715: { value: "CD-TZ-001" },
    _widget_1666513866235: { value: "同舟生产商品" },
    _widget_1666521891102: { value: "需要脱敏的加工厂" },
    _widget_1741698535338: { value: "factory-sensitive-id" },
    _widget_1690015838240: { value: "进行中" },
    _widget_1742792727818: { value: "国内" },
    _widget_1743431393378: { value: "定制" },
    _widget_1666513866237: { value: 100 },
    _widget_1689922981680: { value: "2026-08-01T00:00:00.000Z" },
    _widget_1749731495043: { value: "2026-08-08T00:00:00.000Z" },
    _widget_1742287630327: { value: "产前样已确认" },
  },
  {
    data_id: "domestic-active",
    out_order_id: { value: "JG-CN-001" },
    _widget_1689415936715: { value: "CD26063717" },
    _widget_1666513866235: { value: "国内客户定制商品" },
    _widget_1690015838240: { value: "进行中" },
    _widget_1742792727818: { value: "国内" },
    _widget_1743431393378: { value: "定制品" },
    _widget_1666513866237: { value: 200 },
    _widget_1689922981680: { value: "2026-08-02T00:00:00.000Z" },
    _widget_1726742992280: { value: "2026-09-12T00:00:00.000Z" },
  },
  {
    data_id: "domestic-finished",
    out_order_id: { value: "JG-CN-OLD" },
    _widget_1689415936715: { value: "CD-OLD" },
    _widget_1666513866235: { value: "已完成定制商品" },
    _widget_1690015838240: { value: "已完成" },
    _widget_1742792727818: { value: "国内" },
    _widget_1743431393378: { value: "定制" },
    _widget_1666513866237: { value: 50 },
  },
], "test");

assert.deepEqual(outsourcingPayload.orders.map((order) => order.id), ["tongzhou-active"], "原有备货扣减数据必须保持同舟 SKU 口径");
assert.deepEqual(outsourcingPayload.domesticCustomizationOrders.map((order) => order.id), ["tongzhou-active", "domestic-active"], "国内定制视角只展示进行中记录");
assert.equal(outsourcingPayload.domesticCustomizationOrders[1].productSku, "CD26063717");
assert.equal(outsourcingPayload.domesticCustomizationOrders[0].lastFollowedAt, "2026-08-08T00:00:00.000Z");
assert.match(outsourcingPayload.orders[0].supplier, /^供应商 [A-Z0-9]{4}$/);
assert.equal("raw" in outsourcingPayload.orders[0], false, "生产接口不应返回简道云原始记录");
assert.equal(JSON.stringify(outsourcingPayload).includes("需要脱敏的加工厂"), false, "生产接口不应暴露加工方原名");

const stockupPayload = buildStockupPayload({ generatedAt: "", items: [{
  id: "CD26063717",
  sku: "CD26063717",
  countrySku: "",
  name: "不应被国内定制扣减的商品",
  country: "中国",
  unit: "件",
  status: "缺货",
  replenishQty: 300,
}] }, {}, outsourcingPayload, { productBase: [] });

assert.equal(stockupPayload.recommendations[0].outsourcingInProductionQty, 0, "国内定制订单不能影响同舟备货建议");
assert.equal(stockupPayload.domesticCustomizationQueue.length, 2, "国内定制队列应按产品 SKU 聚合并允许与同舟视角重叠");
assert.equal(stockupPayload.domesticCustomizationQueue.find((item) => item.sku === "CD26063717")?.inProductionQty, 200);

console.log("production timeline tests passed");
