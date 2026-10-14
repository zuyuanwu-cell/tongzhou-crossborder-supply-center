import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { initStockupCollaborationStore } from "../server/stockup-collaboration-db.js";
import { createStockupCollaborationService } from "../server/stockup-collaboration-service.js";

const temp = mkdtempSync(resolve(tmpdir(), "stockup-warehouse-work-orders-"));
try {
  const store = await initStockupCollaborationStore(resolve(temp, "test.sqlite"));
  const service = createStockupCollaborationService(store);
  const context = {
    auth: { role: "admin", user: { id: "operations-1", displayName: "备货运营" } },
    viewAll: true,
    viewCost: true,
    revealSupplier: true,
  };
  const created = service.createRequest({
    project: "俄罗斯补货",
    destinationCountry: "俄罗斯",
    destinationWarehouseId: "ru-main",
    destinationWarehouseName: "莫斯科主仓",
    expectedArrivalAt: "2026-11-30",
    priority: "加急",
    reason: "安全库存不足",
    submit: true,
    lines: [{ productId: "p-1", sku: "SKU-WH-001", productName: "测试商品", method: "采购", requestedQty: 100, unit: "件", targetUnitCostCny: 12 }],
  }, context, "warehouse-work-order-request");

  const request = service.getRequest(created.requestId, context);
  const workOrderResult = service.createWarehouseWorkOrder({
    requestId: request.id,
    organizationCode: "wh-shenzhen",
    domesticWarehouseId: "cn-sz-01",
    domesticWarehouseName: "深圳同舟仓",
    expectedArrivalAt: "2026-10-20T08:00:00.000Z",
    senderName: "测试供应商",
    inboundTrackingNo: "SF123456",
    instructions: "签收后验货、换箱、贴码、测量并安排发运",
    submit: true,
    lines: [{ requestLineId: request.lines[0].id, expectedQty: 100 }],
  }, context, "warehouse-work-order-create");
  const workOrder = workOrderResult.workOrder;
  assert.equal(workOrder.status, "waiting_receipt");
  assert.equal(workOrder.lines[0].expectedQty, 100);
  assert.equal(service.createWarehouseWorkOrder({
    requestId: request.id,
    organizationCode: "wh-shenzhen",
    domesticWarehouseId: "cn-sz-01",
    domesticWarehouseName: "深圳同舟仓",
    submit: true,
    lines: [{ requestLineId: request.lines[0].id, expectedQty: 100 }],
  }, context, "warehouse-work-order-create").workOrder.id, workOrder.id, "create is idempotent");

  const accepted = service.applyWarehouseWorkOrderAction(workOrder.id, { action: "accept", expectedVersion: workOrder.version, note: "已准备收货" }, context, "warehouse-accept").workOrder;
  assert.equal(accepted.status, "inspecting");

  const inspection = {
    action: "process",
    expectedVersion: accepted.version,
    note: "已完成验收和分流",
    lines: [{
      id: accepted.lines[0].id,
      receivedQty: 95,
      goodQty: 90,
      damagedQty: 5,
      shortageQty: 5,
      pendingQty: 0,
      requiresRepack: true,
      replacementCartonCount: 9,
      lotNo: "LOT-202610",
      barcode: "697000000001",
      cartonCount: 9,
      unitsPerCarton: 10,
      cartonLengthCm: 50,
      cartonWidthCm: 40,
      cartonHeightCm: 30,
      cartonWeightKg: 12.5,
      inspectionNote: "5件外观破损",
    }],
    expenses: [
      { category: "换箱费", name: "更换外箱", amountCny: 90, occurredAt: "2026-10-20", note: "9箱" },
      { category: "货拉拉费", name: "送国际货代", amountCny: 60, occurredAt: "2026-10-20", note: "市内运输" },
    ],
    routes: [
      { routeType: "overseas_warehouse", destinationName: "莫斯科主仓", destinationCountry: "俄罗斯", carrier: "货拉拉 + 国际货代", status: "dispatched", lines: [{ workOrderLineId: accepted.lines[0].id, quantity: 60 }] },
      { routeType: "domestic_customer", destinationName: "上海客户", destinationCountry: "中国", carrier: "顺丰", status: "dispatched", lines: [{ workOrderLineId: accepted.lines[0].id, quantity: 20 }] },
      { routeType: "hold", destinationName: "深圳同舟仓留仓", destinationCountry: "中国", status: "held", lines: [{ workOrderLineId: accepted.lines[0].id, quantity: 10 }] },
    ],
  };
  const processed = service.applyWarehouseWorkOrderAction(workOrder.id, inspection, context, "warehouse-process-1").workOrder;
  assert.equal(processed.status, "completed");
  assert.equal(processed.goodQty, 90);
  assert.equal(processed.expenseTotalCny, 150);
  assert.deepEqual(processed.routes.map((item) => item.routeType).sort(), ["domestic_customer", "hold", "overseas_warehouse"]);
  assert.equal(processed.exceptionCount, 2, "damage and shortage are surfaced as exceptions");

  const replay = service.applyWarehouseWorkOrderAction(workOrder.id, inspection, context, "warehouse-process-1").workOrder;
  assert.equal(replay.id, processed.id);
  assert.equal(replay.expenses.length, 2, "an idempotent replay must not duplicate expenses");

  const reviewed = service.applyWarehouseWorkOrderAction(workOrder.id, {
    action: "review_expense",
    expenseId: processed.expenses[0].id,
    reviewStatus: "approved",
    includedInCost: true,
    expectedVersion: processed.version,
  }, context, "warehouse-expense-review").workOrder;
  assert.equal(reviewed.expenses.find((item) => item.id === processed.expenses[0].id)?.reviewStatus, "approved");
  const costPool = service.getRequest(request.id, context).costItems;
  const warehouseCost = costPool.find((item) => item.id === `warehouse-expense:${processed.expenses[0].id}`);
  assert.equal(warehouseCost?.stage, "国内仓");
  assert.equal(warehouseCost?.amountCny, 90);
  assert.equal(warehouseCost?.included, true, "approved domestic warehouse expense enters the stockup cost pool");

  assert.throws(() => service.applyWarehouseWorkOrderAction(workOrder.id, {
    ...inspection,
    expectedVersion: reviewed.version,
    routes: [{ routeType: "domestic_customer", destinationName: "超量客户", status: "dispatched", lines: [{ workOrderLineId: processed.lines[0].id, quantity: 91 }] }],
  }, context, "warehouse-process-overallocated"), (error) => error?.code === "warehouse_route_overallocated");

  const dashboard = service.warehouseWorkOrderDashboard({}, context);
  assert.equal(dashboard.counts.completed, 1);
  assert.equal(dashboard.totals.goodQty, 90);
  assert.equal(dashboard.totals.expenseCny, 150);
  assert.equal(dashboard.routeBreakdown.overseas_warehouse, 60);
  assert.equal(dashboard.routeBreakdown.domestic_customer, 20);
  assert.equal(dashboard.waitingProducts.length, 0);

  console.log("stockup warehouse work order tests passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
