import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { initStockupCollaborationStore } from "../server/stockup-collaboration-db.js";
import { createStockupCollaborationService } from "../server/stockup-collaboration-service.js";

const temp = mkdtempSync(resolve(tmpdir(), "stockup-costing-"));
try {
  const store = await initStockupCollaborationStore(resolve(temp, "test.sqlite"));
  const service = createStockupCollaborationService(store);
  const context = { auth: { role: "admin", user: { id: "finance-1", displayName: "成本专员" } }, viewAll: true, viewCost: true, revealSupplier: true };
  const created = service.createRequest({ project: "项目A", destinationCountry: "俄罗斯", destinationWarehouseId: "ru-1", destinationWarehouseName: "俄罗斯1仓", expectedArrivalAt: "2026-10-30", priority: "常规", reason: "补库存", submit: true, lines: [
    { productId: "p1", sku: "SKU-A", productName: "产品A", method: "采购", requestedQty: 10, unit: "件", targetUnitCostCny: 10 },
    { productId: "p2", sku: "SKU-B", productName: "产品B", method: "采购", requestedQty: 20, unit: "件", targetUnitCostCny: 20 },
  ] }, context, "cost-flow");
  service.setRequestStatus(created.requestId, "accepted", {}, context);
  const request = service.getRequest(created.requestId, context);
  const tasks = request.lines.map((line) => service.createTask({ requestId: request.id, lineId: line.id, plannedQty: line.requestedQty }, context).task);
  tasks.forEach((task) => service.updateTask(task.id, { version: task.version, status: "completed", orderedQty: task.plannedQty, completedQty: task.plannedQty }, context));
  const shipment = service.createShipment({ requestId: request.id, carrier: "测试物流", trackingNo: "COST001", eta: "2026-10-05", lines: tasks.map((task, index) => ({ taskId: task.id, shippedQty: task.plannedQty, baseUnitCostCny: index ? 20 : 10, weightKg: index ? 20 : 10 })) }, context).shipment;
  service.dispatchShipment(shipment.id, { carrier: "测试物流", trackingNo: "COST001", eta: "2026-10-05" }, context);
  const full = service.getRequest(request.id, context);
  const receipt = service.confirmReceipt({ shipmentId: shipment.id, arrivedAt: "2026-10-05", lines: full.shipments[0].lines.map((line) => ({ shipmentLineId: line.id, expectedQty: line.shippedQty, receivedQty: line.shippedQty, goodQty: line.shippedQty, damagedQty: 0, shortageQty: 0, pendingQty: 0, shelvedQty: line.shippedQty })) }, context).receipt;
  service.addCostItem({ receiptId: receipt.id, category: "头程", name: "头程运费", originalAmount: 300, currency: "CNY", exchangeRate: 1, allocationMethod: "quantity", included: true }, context);
  const preview = service.costPreview(receipt.id, context);
  assert.equal(preview.totals.goodsCostCny, 500);
  assert.equal(preview.totals.allocatedCostCny, 300);
  assert.equal(preview.totals.totalCostCny, 800);
  assert.equal(preview.lines.reduce((sum, line) => sum + line.allocatedCostCny, 0), 300);
  service.saveCostVersion(receipt.id, {}, context, true);
  const report = service.monthlyCostReport({ month: "2026-10" }, context);
  assert.equal(report.items.length, 2);
  assert.equal(report.totals.totalCostCny, 800);
  console.log("stockup costing tests passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
