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

  const createdTwo = service.createRequest({ project: "项目B", destinationCountry: "俄罗斯", destinationWarehouseId: "ru-1", destinationWarehouseName: "俄罗斯1仓", expectedArrivalAt: "2026-10-30", priority: "常规", reason: "补库存", submit: true, lines: [{ productId: "p2", sku: "SKU-002", productName: "产品二", method: "采购", requestedQty: 5, unit: "件", targetUnitCostCny: 12 }] }, operator, "shipment-flow-two");
  service.setRequestStatus(createdTwo.requestId, "accepted", {}, supply);
  const detailTwo = service.getRequest(createdTwo.requestId, supply);
  const taskTwo = service.createTask({ requestId: createdTwo.requestId, lineId: detailTwo.lines[0].id, plannedQty: 5, supplierName: "供应商" }, supply).task;
  service.updateTask(taskTwo.id, { version: taskTwo.version, status: "completed", orderedQty: 5, completedQty: 5 }, supply);
  store.run("UPDATE stockup_request_lines SET image_url=? WHERE id=?", ["https://example.test/sku-001.jpg", detail.lines[0].id]);
  store.run("UPDATE stockup_request_lines SET image_url=? WHERE id=?", ["https://example.test/sku-002.jpg", detailTwo.lines[0].id]);

  const shipment = service.createShipment({ requestId: created.requestId, requestIds: [created.requestId, createdTwo.requestId], originWarehouseId: "cn-1", originWarehouse: "广州集货仓", originAddress: "广州市测试路1号", boxMark: "RU-01", carrier: "测试物流", transportMode: "空运", trackingNo: "TRK001", eta: "2026-10-02", lines: [{ requestId: created.requestId, taskId: task.id, shippedQty: 10, baseUnitCostCny: 8, cartonCount: 1, unitsPerCarton: 10, cartonLengthCm: 40, cartonWidthCm: 30, cartonHeightCm: 20, cartonWeightKg: 5, weightKg: 5 }, { requestId: createdTwo.requestId, taskId: taskTwo.id, shippedQty: 5, baseUnitCostCny: 12, cartonCount: 1, unitsPerCarton: 5, cartonLengthCm: 30, cartonWidthCm: 20, cartonHeightCm: 20, cartonWeightKg: 3, weightKg: 3 }] }, supply).shipment;
  assert.deepEqual(shipment.requestIds.sort(), [created.requestId, createdTwo.requestId].sort());
  assert.equal(shipment.lines.length, 2);
  assert.equal(shipment.lines[0].requestId.length > 0, true);
  assert.equal(shipment.lines.every((line) => line.imageUrl.startsWith("https://example.test/")), true, "shipment lines preserve product images for packing list printing");
  service.dispatchShipment(shipment.id, { carrier: "测试物流", transportMode: "空运", trackingNo: "TRK001", eta: "2026-10-02", actualShippedAt: "2026-09-29" }, supply);
  const shippedDetail = service.getRequest(created.requestId, supply);
  assert.equal(service.getRequest(createdTwo.requestId, supply).shipments[0].id, shipment.id, "合并发运应同时出现在第二张需求单");
  const receiptLines = shippedDetail.shipments[0].lines.map((shipmentLine, index) => ({ shipmentLineId: shipmentLine.id, expectedQty: shipmentLine.shippedQty, receivedQty: shipmentLine.shippedQty, goodQty: shipmentLine.shippedQty - (index === 0 ? 1 : 0), damagedQty: index === 0 ? 1 : 0, shortageQty: 0, pendingQty: 0, shelvedQty: shipmentLine.shippedQty - (index === 0 ? 1 : 0) }));
  const receipt = service.confirmReceipt({ shipmentId: shipment.id, arrivedAt: "2026-10-02", shelvedAt: "2026-10-03", lines: receiptLines }, supply);
  assert.equal(receipt.hasDifference, true);
  assert.equal(service.getRequest(created.requestId, supply).status, "arrived");
  assert.equal(service.getRequest(createdTwo.requestId, supply).status, "arrived");
  assert.ok(service.listNotifications(operator).unread >= 4, "运营应收到供应链进度通知");
  console.log("stockup shipment/receipt tests passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
