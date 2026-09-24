import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { initStockupCollaborationStore } from "../server/stockup-collaboration-db.js";
import { createStockupCollaborationService } from "../server/stockup-collaboration-service.js";

const temp = mkdtempSync(resolve(tmpdir(), "stockup-shipment-"));
try {
  const store = await initStockupCollaborationStore(resolve(temp, "test.sqlite"));
  const service = createStockupCollaborationService(store);
  const operator = { auth: { role: "direct", user: { id: "operator-1", displayName: "运营一号" } }, viewAll: false, viewCost: false, revealSupplier: false };
  const supply = { auth: { role: "admin", user: { id: "supply-1", displayName: "供应链一号" } }, viewAll: true, viewCost: true, revealSupplier: true };
  const created = service.createRequest({ project: "项目A", destinationCountry: "俄罗斯", destinationWarehouseId: "ru-1", destinationWarehouseName: "俄罗斯1仓", expectedArrivalAt: "2026-10-30", priority: "常规", reason: "补库存", submit: true, lines: [{ productId: "p1", sku: "SKU-001", productName: "产品一", method: "采购", requestedQty: 10, unit: "件", targetUnitCostCny: 8 }] }, operator, "shipment-flow");
  service.setRequestStatus(created.requestId, "accepted", {}, supply);
  const detail = service.getRequest(created.requestId, supply);
  const task = service.createTask({ requestId: created.requestId, lineId: detail.lines[0].id, plannedQty: 10, supplierName: "供应商" }, supply).task;
  service.updateTask(task.id, { version: task.version, status: "completed", orderedQty: 10, completedQty: 10, actualOrderedAt: "2026-09-24", actualCompletedAt: "2026-09-28" }, supply);

  const shipment = service.createShipment({ requestId: created.requestId, originWarehouse: "广州集货仓", carrier: "测试物流", transportMode: "空运", trackingNo: "TRK001", eta: "2026-10-02", lines: [{ taskId: task.id, shippedQty: 10, baseUnitCostCny: 8, weightKg: 5 }] }, supply).shipment;
  service.dispatchShipment(shipment.id, { carrier: "测试物流", transportMode: "空运", trackingNo: "TRK001", eta: "2026-10-02", actualShippedAt: "2026-09-29" }, supply);
  const shippedDetail = service.getRequest(created.requestId, supply);
  const shipmentLine = shippedDetail.shipments[0].lines[0];
  const receipt = service.confirmReceipt({ shipmentId: shipment.id, arrivedAt: "2026-10-02", shelvedAt: "2026-10-03", lines: [{ shipmentLineId: shipmentLine.id, expectedQty: 10, receivedQty: 10, goodQty: 9, damagedQty: 1, shortageQty: 0, pendingQty: 0, shelvedQty: 9 }] }, supply);
  assert.equal(receipt.hasDifference, true);
  assert.equal(service.getRequest(created.requestId, supply).status, "arrived");
  assert.ok(service.listNotifications(operator).unread >= 4, "运营应收到供应链进度通知");
  console.log("stockup shipment/receipt tests passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
