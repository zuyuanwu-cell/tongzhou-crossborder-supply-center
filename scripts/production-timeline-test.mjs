import assert from "node:assert/strict";
import { buildProductionTimelines } from "../server/production-timeline.js";

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

console.log("production timeline tests passed");
