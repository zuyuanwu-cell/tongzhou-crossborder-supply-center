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
  const receipt = service.confirmReceipt({ shipmentId: shipment.id, arrivedAt: "2026-10-05", lines: full.shipments[0].lines.map((line, index) => ({ shipmentLineId: line.id, expectedQty: line.shippedQty, receivedQty: line.shippedQty, goodQty: index ? line.shippedQty : 5, damagedQty: index ? 0 : 5, shortageQty: 0, pendingQty: 0, shelvedQty: index ? line.shippedQty : 5 })) }, context).receipt;
  const freight = service.addCostItem({ receiptId: receipt.id, category: "头程", name: "头程运费", originalAmount: 300, currency: "CNY", exchangeRate: 1, allocationMethod: "quantity", included: true }, context).costItem;
  let preview = service.costPreview(receipt.id, context);
  assert.equal(preview.totals.goodsCostCny, 450);
  assert.equal(preview.totals.allocatedCostCny, 300);
  assert.equal(preview.totals.totalCostCny, 750);
  assert.equal(preview.totals.totalWeightKg, 25);
  assert.equal(preview.skuSummary.length, 2);
  assert.equal(preview.skuSummary.find((row) => row.sku === "SKU-A").goodQty, 5);
  assert.equal(preview.lines.find((row) => row.sku === "SKU-A").shipmentWeightKg, 10);
  assert.equal(preview.lines.find((row) => row.sku === "SKU-A").weightKg, 5, "received weight is prorated by good quantity instead of using the full shipment line");
  assert.match(preview.skuSummary.find((row) => row.sku === "SKU-A").calculation.weight[0], /5.*10/);
  assert.match(preview.metricExplanations.totalCostCny.formula, /货品成本/);
  assert.equal(preview.skuSummary[0].allocationBreakdown.length, 1);
  assert.equal(preview.lines.reduce((sum, line) => sum + line.allocatedCostCny, 0), 300);

  service.updateCostItem(freight.id, { originalAmount: 450, currency: "CNY", exchangeRate: 1, allocationMethod: "weight", included: true }, context);
  preview = service.costPreview(receipt.id, context);
  assert.equal(preview.totals.allocatedCostCny, 450);
  assert.equal(preview.totals.totalCostCny, 900);
  assert.equal(preview.skuSummary.find((row) => row.sku === "SKU-A").allocatedCostCny, 90);
  assert.equal(preview.skuSummary.find((row) => row.sku === "SKU-B").allocatedCostCny, 360);

  const temporaryFee = service.addCostItem({ receiptId: receipt.id, category: "作业", name: "临时费用", originalAmount: 50, currency: "CNY", exchangeRate: 1, allocationMethod: "quantity", included: true }, context).costItem;
  assert.equal(service.costPreview(receipt.id, context).totals.allocatedCostCny, 500);
  service.voidCostItem(temporaryFee.id, context);
  assert.equal(service.costPreview(receipt.id, context).totals.allocatedCostCny, 450, "voided fees must not participate in allocation");

  service.saveCostVersion(receipt.id, {}, context, false);
  assert.equal(service.getRequest(request.id, context).receipts.find((item) => item.id === receipt.id).status, "cost_review");
  service.updateCostItem(freight.id, { originalAmount: 400, currency: "CNY", exchangeRate: 1, allocationMethod: "quantity", included: true }, context);
  assert.equal(service.getRequest(request.id, context).receipts.find((item) => item.id === receipt.id).status, "cost_draft", "editing a reviewed fee invalidates the review state");
  service.saveCostVersion(receipt.id, {}, context, true);
  assert.throws(() => service.updateCostItem(freight.id, { originalAmount: 410 }, context), /先发起调整版/);
  service.saveCostVersion(receipt.id, { versionType: "adjustment", note: "修正头程账单" }, context, false);
  assert.equal(service.getRequest(request.id, context).receipts.find((item) => item.id === receipt.id).status, "cost_adjusting");
  service.updateCostItem(freight.id, { originalAmount: 420, currency: "CNY", exchangeRate: 1, allocationMethod: "quantity", included: true }, context);
  service.saveCostVersion(receipt.id, { note: "调整完成" }, context, true);
  preview = service.costPreview(receipt.id, context);
  assert.equal(preview.versions.filter((version) => version.status === "locked").length, 2, "the original locked version remains auditable after adjustment");
  assert.equal(preview.totals.totalCostCny, 870);
  const report = service.monthlyCostReport({ month: "2026-10" }, context);
  assert.equal(report.items.length, 2);
  assert.equal(report.totals.totalCostCny, 870);
  assert.equal(service.listReceipts({}, context).receipts.length, 1);
  service.updateReceiptLifecycle(receipt.id, "archive", context);
  assert.equal(service.listReceipts({}, context).receipts.length, 0, "archived receipt leaves the active cost queue");
  assert.equal(service.listReceipts({ lifecycle: "archived" }, context).receipts.length, 1);
  assert.equal(service.monthlyCostReport({ month: "2026-10" }, context).totals.totalCostCny, 870, "archiving a receipt does not change financial totals");
  service.updateReceiptLifecycle(receipt.id, "delete", context);
  assert.equal(service.monthlyCostReport({ month: "2026-10" }, context).totals.totalCostCny, 0, "recycle-bin receipts no longer participate in monthly totals");
  service.updateReceiptLifecycle(receipt.id, "restore", context);
  assert.equal(service.monthlyCostReport({ month: "2026-10" }, context).totals.totalCostCny, 870, "restoring a receipt restores monthly totals");
  service.updateReceiptLifecycle(receipt.id, "activate", context);

  service.updateMonthlyCostPeriod("2026-10", "archive", context);
  assert.equal(service.listMonthlyCostPeriods({ lifecycle: "archived" }, context).periods[0].month, "2026-10");
  service.updateMonthlyCostPeriod("2026-10", "delete", context);
  assert.equal(service.listMonthlyCostPeriods({ lifecycle: "deleted" }, context).periods[0].month, "2026-10");
  service.updateMonthlyCostPeriod("2026-10", "restore", context);
  service.updateMonthlyCostPeriod("2026-10", "activate", context);
  assert.equal(service.listMonthlyCostPeriods({ lifecycle: "active" }, context).periods[0].month, "2026-10");
  console.log("stockup costing tests passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
