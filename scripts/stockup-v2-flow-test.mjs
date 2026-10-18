import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { initDomesticInventoryStore } from "../server/domestic-inventory-db.js";
import { createDomesticInventoryService } from "../server/domestic-inventory-service.js";
import { initStockupCollaborationStore } from "../server/stockup-collaboration-db.js";
import { createStockupCollaborationService } from "../server/stockup-collaboration-service.js";

const temp = mkdtempSync(resolve(tmpdir(), "stockup-v2-flow-"));
try {
  const inventoryStore = await initDomesticInventoryStore(resolve(temp, "inventory.sqlite"));
  const inventory = createDomesticInventoryService(inventoryStore);
  const context = { auth: { role: "admin", user: { id: "tester", displayName: "测试管理员" } }, viewAll: true, viewCost: true, revealSupplier: true };
  const inventoryContext = { auth: context.auth, countries: [], warehouseIds: [], skus: [] };
  const warehouse = inventory.createWarehouse({ code: "CN-SZ", name: "深圳仓" }, inventoryContext).warehouse;
  const store = await initStockupCollaborationStore(resolve(temp, "stockup.sqlite"));
  const service = createStockupCollaborationService(store, { inventoryGateway: {
    createInspectionInbound: (input, ctx) => inventory.createMovement({ ...input, type: "inbound", allowDuplicateSkus: true }, inventoryContext, `inspection:${input.referenceNo}`),
    reserveStock: (input) => inventory.reserveStock(input, inventoryContext, `reservation:${input.referenceNo}`),
    releaseReservation: (reservationId) => inventory.releaseReservation(reservationId, inventoryContext),
    commitReservation: (reservationId, input) => inventory.commitReservation(reservationId, input, inventoryContext),
    recodeSku: (input) => inventory.recodeSku(input, inventoryContext),
  } });

  const requestResult = service.createSpotRequest({
    workflowVersion: 2, project: "Shopee 印尼", destinationCountry: "印度尼西亚", destinationWarehouseId: "id-jkt-1", destinationWarehouseName: "雅加达仓", expectedArrivalAt: "2026-11-30", priority: "常规", reason: "补库存", submit: false,
    lines: [{ sku: "", productName: "待编码测试商品", procurementUrl: "https://detail.1688.com/example", requestedQty: 20, unit: "件" }],
  }, context, "request-1");
  assert.equal(requestResult.status, "draft");
  const draft = service.getRequest(requestResult.requestId, context);
  assert.match(draft.lines[0].sku, /^TMP-/);
  assert.ok(draft.lines[0].productRefId);
  const updatedDraft = service.updateRequest(draft.id, { version: draft.version, note: "人工已审核 Agent/需求草稿", lines: [{ ...draft.lines[0], productName: "待编码测试商品（已核对）", requestedQty: 20 }] }, context).request;
  assert.equal(updatedDraft.lines[0].productRefId, draft.lines[0].productRefId);
  assert.equal(updatedDraft.lines[0].sku, draft.lines[0].sku);
  assert.equal(updatedDraft.lines[0].productName, "待编码测试商品（已核对）");
  const request = service.setRequestStatus(draft.id, "submitted", {}, context).request;
  assert.equal(request.status, "submitted");

  const purchase = service.createPurchaseOrder({ supplierName: "1688 测试供应商", externalOrderNo: "1688-001", orderUrl: "https://detail.1688.com/example", paidTotalCny: 80, lines: [{ requestLineId: request.lines[0].id, quantity: 20, merchandiseAmount: 70 }], allocationOverrides: { [request.lines[0].id]: 80 }, allocationOverrideReason: "测试按业务确认覆盖分摊" }, context, "purchase-1").purchaseOrder;
  assert.equal(purchase.sharedAmountCny, 10);
  assert.equal(purchase.lines[0].estimatedUnitCostCny, 4);
  const partlyReceived = service.recordPurchaseEvent(purchase.id, { lineId: purchase.lines[0].id, action: "receive", quantity: 19, note: "分批到货" }, context).purchaseOrder;
  assert.equal(partlyReceived.lines[0].receivedQty, 19);
  const refunded = service.recordPurchaseEvent(purchase.id, { lineId: purchase.lines[0].id, action: "refund", amountCny: 8, note: "短少索赔" }, context).purchaseOrder;
  assert.equal(refunded.lines[0].refundedAmountCny, 8);

  const workOrder = service.createWarehouseWorkOrder({ requestId: request.id, organizationCode: "partner-sz", domesticWarehouseId: warehouse.id, domesticWarehouseName: warehouse.name, submit: true, lines: [{ requestLineId: request.lines[0].id, purchaseOrderLineId: purchase.lines[0].id, expectedQty: 20 }] }, context, "work-order-1").workOrder;
  assert.equal(workOrder.workflowVersion, 2);
  const accepted = service.applyWarehouseWorkOrderAction(workOrder.id, { action: "accept", expectedVersion: workOrder.version }, context, "accept-1").workOrder;
  const inspectionPayload = { lines: [{ id: accepted.lines[0].id, receivedQty: 19, goodQty: 18, damagedQty: 1, shortageQty: 1, pendingQty: 0, lots: [{ quantity: 18, lotNo: "LOT-202610", barcode: "6970001", productionDate: "2026-10-10", cartonCount: 2, unitsPerCarton: 9, looseQuantity: 0, cartonLengthCm: 40, cartonWidthCm: 30, cartonHeightCm: 20, cartonWeightKg: 5 }], evidence: [{ kind: "damage", attachmentId: "att-damage", fileName: "damage.jpg" }, { kind: "shortage", attachmentId: "att-shortage", fileName: "shortage.jpg" }] }] };
  const submitted = service.submitInspection(workOrder.id, inspectionPayload, context);
  assert.equal(submitted.status, "inspection_review");
  assert.equal(service.reviewInspection(workOrder.id, { action: "reject", note: "请核对短少凭证" }, context).status, "warehouse_inspection");
  assert.equal(service.submitInspection(workOrder.id, inspectionPayload, context).status, "inspection_review");
  const approved = service.reviewInspection(workOrder.id, { action: "approve" }, context);
  assert.equal(approved.status, "inventory_ready");
  assert.equal(service.reviewInspection(workOrder.id, { action: "approve" }, context).idempotentReplay, true);
  assert.equal(inventory.stockupAvailability({ warehouseId: warehouse.id, sku: request.lines[0].sku }, inventoryContext).items[0].onHandQty, 18);

  const forwarder = service.createForwarder({ code: "FF-1", name: "测试货代", locations: [{ name: "深圳收货点", country: "中国", address: "深圳市测试路 1 号", contactName: "张三", contactPhone: "13800000000" }] }).forwarderId;
  const location = service.listForwarders().forwarders.find((item) => item.id === forwarder).locations[0];
  const approvedOrder = service.getWarehouseWorkOrder(workOrder.id, context);
  const temporarySkuShipment = service.createReservedShipment({ forwarderLocationId: location.id, transportMode: "海运", lines: [{ inspectionLotId: approvedOrder.lines[0].lots[0].id, quantity: 18 }] }, context).shipment;
  assert.throws(() => service.beginShipmentWmsPush(temporarySkuShipment.id, { providerId: "sea_wms", documentType: "stockup" }, context), (error) => error?.code === "formal_sku_required");
  service.cancelReservedShipment(temporarySkuShipment.id, { reason: "绑定正式 SKU 前释放测试锁库" }, context);

  const coded = service.bindFormalSku(request.lines[0].productRefId, { formalSku: "ID-TEST-001", productName: "待编码测试商品" }, context).productRef;
  assert.equal(coded.formalSku, "ID-TEST-001");
  assert.equal(inventory.stockupAvailability({ warehouseId: warehouse.id, sku: "ID-TEST-001" }, inventoryContext).items[0].onHandQty, 18);

  const reservationInput = { forwarderLocationId: location.id, transportMode: "海运", lines: [{ inspectionLotId: approvedOrder.lines[0].lots[0].id, quantity: 18 }] };
  const cancelledShipment = service.createReservedShipment(reservationInput, context).shipment;
  assert.equal(cancelledShipment.status, "inventory_reserved");
  assert.equal(inventory.stockupAvailability({ warehouseId: warehouse.id, sku: "ID-TEST-001" }, inventoryContext).items[0].reservedQty, 18);
  assert.throws(() => service.createReservedShipment(reservationInput, context), (error) => error?.code === "inspection_lot_over_reserved");
  service.cancelReservedShipment(cancelledShipment.id, { reason: "测试取消释放库存" }, context);
  assert.equal(inventory.stockupAvailability({ warehouseId: warehouse.id, sku: "ID-TEST-001" }, inventoryContext).items[0].reservedQty, 0);
  const shipment = service.createReservedShipment(reservationInput, context).shipment;
  assert.equal(inventory.stockupAvailability({ warehouseId: warehouse.id, sku: "ID-TEST-001" }, inventoryContext).items[0].reservedQty, 18);

  service.beginShipmentWmsPush(shipment.id, { providerId: "sea_wms", documentType: "stockup" }, context);
  const wms = service.completeShipmentWmsPush(shipment.id, { orderNo: "SEA-001", documentLabel: "备货单" }, context).shipment;
  assert.equal(wms.status, "wms_created");
  service.recordDispatchDocuments(shipment.id, [{ documentType: "packing_list", fileName: "packing.pdf", filePath: "/tmp/packing.pdf", sha256: "a", snapshot: {} }, { documentType: "carton_marks", fileName: "marks.pdf", filePath: "/tmp/marks.pdf", sha256: "b", snapshot: {} }], context);
  service.issueDispatchInstruction(shipment.id, {}, context);
  const handed = service.handoverShipment(shipment.id, { carrier: "测试物流", trackingNo: "TRACK-001", actualFreightCny: 9 }, context).shipment;
  assert.equal(handed.status, "handed_over");
  const balance = inventory.stockupAvailability({ warehouseId: warehouse.id, sku: "ID-TEST-001" }, inventoryContext).items[0];
  assert.equal(balance.onHandQty, 0);
  assert.equal(balance.reservedQty, 0);

  const receipt = service.confirmReceipt({ shipmentId: shipment.id, arrivedAt: "2026-11-20", lines: handed.lines.map((line) => ({ shipmentLineId: line.id, expectedQty: line.shippedQty, receivedQty: line.shippedQty, goodQty: line.shippedQty, damagedQty: 0, shortageQty: 0, pendingQty: 0 })) }, context).receipt;
  assert.equal(service.getShipment(shipment.id, context).status, "overseas_received");
  const preview = service.costPreview(receipt.id, context);
  assert.equal(preview.totals.goodsCostCny, 72);
  assert.equal(preview.totals.allocatedCostCny, 9);
  assert.equal(preview.totals.totalCostCny, 81);
  assert.equal(preview.totals.unitCostCny, 4.5);
  assert.equal(preview.lossPool[0].lossQty, 2);
  const locked = service.saveCostVersion(receipt.id, {}, context, true);
  assert.equal(locked.status, "locked");
  assert.equal(service.getRequest(request.id, context).status, "cost_locked");

  console.log("stockup v2 end-to-end tests passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

