import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { initDomesticInventoryStore } from "../server/domestic-inventory-db.js";
import { createDomesticInventoryService } from "../server/domestic-inventory-service.js";
import { initStockupCollaborationStore } from "../server/stockup-collaboration-db.js";
import { createStockupCollaborationService } from "../server/stockup-collaboration-service.js";

const temp = mkdtempSync(resolve(tmpdir(), "stockup-v3-routing-"));
try {
  const inventoryStore = await initDomesticInventoryStore(resolve(temp, "inventory.sqlite"));
  const inventory = createDomesticInventoryService(inventoryStore);
  const context = { auth: { role: "admin", user: { id: "v3-tester", displayName: "V3 测试管理员" } }, viewAll: true, viewCost: true, revealSupplier: true };
  const inventoryContext = { auth: context.auth, countries: [], warehouseIds: [], skus: [] };
  const target = inventory.createWarehouse({ code: "CN-GZ", name: "广州集货仓" }, inventoryContext).warehouse;
  const source = inventory.createWarehouse({ code: "CN-SZ", name: "深圳现货仓" }, inventoryContext).warehouse;

  function inbound(warehouseId, referenceNo, sku, quantity) {
    inventory.createMovement({ warehouseId, type: "inbound", referenceNo, lines: [{ productId: sku, sku, productName: sku, unit: "件", quantity, unitCostCny: 5 }] }, inventoryContext, `inbound:${referenceNo}`);
  }
  inbound(target.id, "OPEN-A", "V3-A", 1000);
  inbound(target.id, "OPEN-B", "V3-B", 600);
  inbound(source.id, "OPEN-D", "V3-D", 400);
  inbound(target.id, "OPEN-RACE", "V3-RACE", 10);
  inbound(target.id, "OPEN-ADJUST", "V3-ADJUST", 20);
  inbound(target.id, "OPEN-PARTIAL-A", "V3-PARTIAL-A", 5);
  inbound(target.id, "OPEN-PARTIAL-B", "V3-PARTIAL-B", 5);
  let failInboundReservation = false;
  let releaseInvocation = 0;
  let failReleaseAtInvocation = 0;

  const inventoryGateway = {
    getAvailabilitySummary: (skus) => ({
      queriedAt: new Date().toISOString(),
      items: skus.map((sku) => {
        const warehouses = [target, source].map((warehouse) => {
          const item = inventory.stockupAvailability({ warehouseId: warehouse.id, skus: sku }, inventoryContext).items[0];
          return { warehouseId: warehouse.id, warehouseName: warehouse.name, onHandQty: item?.onHandQty || 0, reservedQty: item?.reservedQty || 0, availableQty: item?.availableQty || 0 };
        });
        return { sku, onHandQty: warehouses.reduce((sum, item) => sum + item.onHandQty, 0), reservedQty: warehouses.reduce((sum, item) => sum + item.reservedQty, 0), availableQty: warehouses.reduce((sum, item) => sum + item.availableQty, 0), warehouses };
      }),
    }),
    createInspectionInbound: (input) => inventory.createMovement({ ...input, type: "inbound", allowDuplicateSkus: true }, inventoryContext, `inspection:${input.referenceNo}`),
    reserveStock: (input) => {
      if (failInboundReservation && String(input.referenceNo || "").startsWith("stockup-inbound:")) {
        failInboundReservation = false;
        throw Object.assign(new Error("simulated inventory reservation outage"), { code: "simulated_reservation_outage" });
      }
      return inventory.reserveStock(input, inventoryContext, `reservation:${input.referenceNo}`);
    },
    getReservation: (reservationId) => inventory.getReservation(reservationId, inventoryContext),
    releaseReservation: (reservationId) => {
      releaseInvocation += 1;
      if (failReleaseAtInvocation && releaseInvocation === failReleaseAtInvocation) {
        failReleaseAtInvocation = 0;
        throw Object.assign(new Error("simulated partial reservation release outage"), { code: "simulated_release_outage" });
      }
      return inventory.releaseReservation(reservationId, inventoryContext);
    },
    commitReservation: (reservationId, input) => inventory.commitReservation(reservationId, input, inventoryContext),
    createTransfer: (input, _context, key) => inventory.createTransfer(input, inventoryContext, key),
    getTransfer: (transferId) => inventory.getTransfer(transferId, inventoryContext),
    cancelTransfer: (transferId) => inventory.cancelTransfer(transferId, inventoryContext),
    recodeSku: (input) => inventory.recodeSku(input, inventoryContext),
  };
  const store = await initStockupCollaborationStore(resolve(temp, "stockup.sqlite"));
  const service = createStockupCollaborationService(store, { inventoryGateway, fulfillmentV3Enabled: true });

  function createRequest(reference, lines) {
    return service.createSpotRequest({
      workflowVersion: 2,
      project: "V3 回归",
      destinationCountry: "印度尼西亚",
      destinationWarehouseId: "ID-JKT",
      destinationWarehouseName: "神牛印尼仓",
      expectedArrivalAt: "2026-12-15",
      priority: "常规",
      reason: "补库存",
      submit: true,
      lines,
    }, context, reference);
  }

  // 场景 1：全量库存覆盖，确认后直接锁库并进入待发运，不产生采购入口。
  const fullCreated = createRequest("v3-full", [{ sku: "V3-A", productName: "全量库存", requestedQty: 1000, unit: "件", supplyMode: "外采成品" }]);
  const fullPreview = service.previewRoute(fullCreated.requestId, { consolidationWarehouseId: target.id, consolidationWarehouseName: target.name }, context);
  assert.deepEqual(fullPreview.routingSummary, { domesticStock: 1000, transfer: 0, purchase: 0, outsourcedProduction: 0, unresolved: 0, planned: 1000, reserved: 0, ready: 0, shipped: 0, exception: 0 });
  const fullConfirmed = service.confirmRoute(fullCreated.requestId, { expectedVersion: fullPreview.expectedRequestVersion, consolidationWarehouseId: target.id, consolidationWarehouseName: target.name }, context, "confirm-full");
  assert.equal(fullConfirmed.request.status, "inventory_ready");
  assert.equal(fullConfirmed.request.nextAction.key, "create_shipment");
  assert.equal(fullConfirmed.request.allocations[0].readyQty, 1000);
  assert.equal(inventory.stockupAvailability({ warehouseId: target.id, sku: "V3-A" }, inventoryContext).items[0].reservedQty, 1000);
  assert.equal(service.confirmRoute(fullCreated.requestId, { expectedVersion: fullPreview.expectedRequestVersion }, context, "confirm-full").idempotentReplay, true);

  // A route shipment must reuse the allocation reservation. Cancelling it keeps
  // the request stock locked; handover is the only point that deducts stock.
  const forwarderId = service.createForwarder({
    code: "V3-TEST",
    name: "V3 测试货代",
    locations: [{ name: "广州收货点", country: "中国", city: "广州", address: "测试地址", contactName: "测试联系人", contactPhone: "13800000000" }],
  }).forwarderId;
  const forwarder = service.listForwarders().forwarders.find((item) => item.id === forwarderId);
  const forwarderLocationId = forwarder.locations[0].id;
  const fullAllocation = fullConfirmed.request.allocations[0];
  const shipmentInput = {
    requestId: fullCreated.requestId,
    forwarderLocationId,
    transportMode: "海运",
    carrier: "V3 测试货代",
    trackingNo: "V3-TRACK-001",
    billingMethod: "flat",
    billingUnitPriceCny: 100,
    lines: [{ allocationId: fullAllocation.id, quantity: 1000, cartonCount: 10, unitsPerCarton: 100, cartonLengthCm: 50, cartonWidthCm: 40, cartonHeightCm: 30, cartonWeightKg: 10 }],
  };
  const firstRouteShipment = service.createRouteShipment(shipmentInput, context).shipment;
  assert.equal(firstRouteShipment.status, "inventory_reserved");
  assert.equal(firstRouteShipment.lines[0].fulfillmentAllocationId, fullAllocation.id);
  assert.equal(inventory.stockupAvailability({ warehouseId: target.id, sku: "V3-A" }, inventoryContext).items[0].reservedQty, 1000, "creating a shipment must not reserve the same stock twice");
  service.cancelReservedShipment(firstRouteShipment.id, { reason: "回归测试取消" }, context);
  assert.equal(inventory.stockupAvailability({ warehouseId: target.id, sku: "V3-A" }, inventoryContext).items[0].reservedQty, 1000, "cancelling a route shipment keeps fulfillment stock reserved");

  const secondRouteShipment = service.createRouteShipment(shipmentInput, context).shipment;
  const fullLine = service.getJourneyRequest(fullCreated.requestId, context).lines[0];
  service.bindFormalSku(fullLine.productRefId, { formalSku: "V3-A", productName: fullLine.productName }, context);
  service.beginShipmentWmsPush(secondRouteShipment.id, { providerId: "test-wms", documentType: "stockup" }, context);
  service.completeShipmentWmsPush(secondRouteShipment.id, { orderNo: "WMS-V3-001", documentLabel: "测试备货单" }, context);
  service.recordDispatchDocuments(secondRouteShipment.id, [
    { documentType: "packing_list", fileName: "packing.pdf", filePath: "test/packing.pdf", sha256: "packing-hash", snapshot: {} },
    { documentType: "carton_marks", fileName: "marks.pdf", filePath: "test/marks.pdf", sha256: "marks-hash", snapshot: {} },
  ], context);
  service.issueDispatchInstruction(secondRouteShipment.id, {}, context);
  const handedOver = service.handoverShipment(secondRouteShipment.id, { carrier: "V3 测试货代", trackingNo: "V3-TRACK-001", handedOverAt: "2026-11-01T08:00:00.000Z" }, context);
  assert.equal(handedOver.shipment.status, "handed_over");
  const afterHandover = inventory.stockupAvailability({ warehouseId: target.id, sku: "V3-A" }, inventoryContext).items[0];
  assert.equal(afterHandover.onHandQty, 0);
  assert.equal(afterHandover.reservedQty, 0);
  const completedJourney = service.getJourneyRequest(fullCreated.requestId, context);
  assert.equal(completedJourney.journeyStage, "in_transit");
  assert.equal(completedJourney.allocations[0].shippedQty, 1000);
  service.confirmReceipt({
    shipmentId: secondRouteShipment.id,
    arrivedAt: "2026-11-20",
    lines: handedOver.shipment.lines.map((line) => ({ shipmentLineId: line.id, expectedQty: line.shippedQty, receivedQty: line.shippedQty, goodQty: line.shippedQty, damagedQty: 0, shortageQty: 0, pendingQty: 0, shelvedQty: line.shippedQty })),
  }, context);
  const receivedJourney = service.getJourneyRequest(fullCreated.requestId, context);
  assert.equal(receivedJourney.journeyStage, "cost_pending");
  assert.equal(receivedJourney.nextAction.target, "costs");

  // 尚未生成外部执行单据时，改单可先释放旧锁定，再按新数量重算并保留审计原因。
  const adjustCreated = createRequest("v3-adjust", [{ sku: "V3-ADJUST", productName: "数量改单", requestedQty: 15, unit: "件", supplyMode: "外采成品" }]);
  const adjustPreview = service.previewRoute(adjustCreated.requestId, { consolidationWarehouseId: target.id, consolidationWarehouseName: target.name }, context);
  const adjustConfirmed = service.confirmRoute(adjustCreated.requestId, { expectedVersion: adjustPreview.expectedRequestVersion, consolidationWarehouseId: target.id, consolidationWarehouseName: target.name }, context, "confirm-adjust");
  const adjustDown = service.replaceRoute(adjustCreated.requestId, { expectedVersion: adjustConfirmed.request.version, consolidationWarehouseId: target.id, consolidationWarehouseName: target.name, quantityOverrides: { [adjustConfirmed.request.lines[0].id]: 10 }, overrideReason: "目的仓需求下调" }, context, "replan-adjust-down");
  assert.equal(adjustDown.request.lines[0].requestedQty, 10);
  assert.equal(adjustDown.request.allocations[0].plannedQty, 10);
  assert.equal(inventory.stockupAvailability({ warehouseId: target.id, sku: "V3-ADJUST" }, inventoryContext).items[0].reservedQty, 10);
  const adjustUp = service.replaceRoute(adjustCreated.requestId, { expectedVersion: adjustDown.request.version, consolidationWarehouseId: target.id, consolidationWarehouseName: target.name, quantityOverrides: { [adjustDown.request.lines[0].id]: 18 }, overrideReason: "目的仓需求恢复" }, context, "replan-adjust-up");
  assert.equal(adjustUp.request.lines[0].requestedQty, 18);
  assert.equal(adjustUp.request.allocations[0].plannedQty, 18);
  assert.equal(inventory.stockupAvailability({ warehouseId: target.id, sku: "V3-ADJUST" }, inventoryContext).items[0].reservedQty, 18);

  // 场景 2/3/4：同一需求同时包含部分现货+采购、纯委外、跨仓调拨。
  // Replan/cancel releases cross a service boundary. If only part of a
  // multi-SKU lock is released, stop in recovery instead of claiming every
  // quantity is still reserved.
  const partialCreated = createRequest("v3-partial-release", [
    { sku: "V3-PARTIAL-A", productName: "partial release A", requestedQty: 5, unit: "pcs", supplyMode: "外采成品" },
    { sku: "V3-PARTIAL-B", productName: "partial release B", requestedQty: 5, unit: "pcs", supplyMode: "外采成品" },
  ]);
  const partialPreview = service.previewRoute(partialCreated.requestId, { consolidationWarehouseId: target.id, consolidationWarehouseName: target.name }, context);
  service.confirmRoute(partialCreated.requestId, { expectedVersion: partialPreview.expectedRequestVersion, consolidationWarehouseId: target.id, consolidationWarehouseName: target.name }, context, "confirm-partial-release");
  failReleaseAtInvocation = releaseInvocation + 2;
  assert.throws(() => service.cancelRoute(partialCreated.requestId, { reason: "simulate release interruption" }, context), (error) => error?.code === "reservation_release_partial_failure");
  let partialJourney = service.getJourneyRequest(partialCreated.requestId, context);
  assert.equal(partialJourney.journeyStage, "route_recovery");
  const partialRecovery = partialJourney.allocations.find((allocation) => allocation.status === "reservation_recovery_required");
  assert.ok(partialRecovery);
  assert.equal([
    inventory.stockupAvailability({ warehouseId: target.id, sku: "V3-PARTIAL-A" }, inventoryContext).items[0].reservedQty,
    inventory.stockupAvailability({ warehouseId: target.id, sku: "V3-PARTIAL-B" }, inventoryContext).items[0].reservedQty,
  ].reduce((sum, value) => sum + value, 0), 5);
  service.recoverReservation(partialRecovery.id, context);
  partialJourney = service.getJourneyRequest(partialCreated.requestId, context);
  assert.equal(partialJourney.allocations.find((allocation) => allocation.id === partialRecovery.id).status, "ready");
  service.cancelRoute(partialCreated.requestId, { reason: "cancel after recovery" }, context);
  assert.equal([
    inventory.stockupAvailability({ warehouseId: target.id, sku: "V3-PARTIAL-A" }, inventoryContext).items[0].reservedQty,
    inventory.stockupAvailability({ warehouseId: target.id, sku: "V3-PARTIAL-B" }, inventoryContext).items[0].reservedQty,
  ].reduce((sum, value) => sum + value, 0), 0);

  const mixedCreated = createRequest("v3-mixed", [
    { sku: "V3-B", productName: "现货加采购", requestedQty: 2000, unit: "件", supplyMode: "外采成品" },
    { sku: "V3-C", productName: "委外生产", requestedQty: 3000, unit: "件", supplyMode: "委外生产" },
    { sku: "V3-D", productName: "跨仓调拨", requestedQty: 400, unit: "件", supplyMode: "外采成品" },
  ]);
  const mixedPreview = service.previewRoute(mixedCreated.requestId, { consolidationWarehouseId: target.id, consolidationWarehouseName: target.name }, context);
  assert.equal(mixedPreview.routingSummary.domesticStock, 600);
  assert.equal(mixedPreview.routingSummary.transfer, 400);
  assert.equal(mixedPreview.routingSummary.purchase, 1400);
  assert.equal(mixedPreview.routingSummary.outsourcedProduction, 3000);
  const mixedConfirmed = service.confirmRoute(mixedCreated.requestId, { expectedVersion: mixedPreview.expectedRequestVersion, consolidationWarehouseId: target.id, consolidationWarehouseName: target.name }, context, "confirm-mixed");
  assert.equal(mixedConfirmed.request.ownerRole, "domestic_warehouse");
  assert.equal(mixedConfirmed.request.nextAction.key, "confirm_transfer");
  const mixedLines = Object.fromEntries(mixedConfirmed.request.lines.map((line) => [line.sku, line]));
  assert.equal(mixedLines["V3-B"].allocations.find((item) => item.sourceType === "purchase").plannedQty, 1400);
  assert.equal(mixedLines["V3-C"].allocations.find((item) => item.sourceType === "outsourced_production").plannedQty, 3000);
  assert.equal(mixedLines["V3-D"].allocations.find((item) => item.sourceType === "transfer").plannedQty, 400);
  assert.equal(inventory.stockupAvailability({ warehouseId: target.id, sku: "V3-B" }, inventoryContext).items[0].reservedQty, 600);
  assert.equal(inventory.stockupAvailability({ warehouseId: source.id, sku: "V3-D" }, inventoryContext).items[0].reservedQty, 400);

  // Transfer confirmation converts the source reservation into a real two-leg
  // transfer. Only receipt at the consolidation warehouse makes it ready.
  const transferAllocation = mixedLines["V3-D"].allocations.find((item) => item.sourceType === "transfer");
  const confirmedTransfer = service.confirmTransfer(transferAllocation.id, {}, context, "confirm-transfer-d");
  assert.equal(confirmedTransfer.transfer.status, "in_transit");
  assert.equal(inventory.stockupAvailability({ warehouseId: source.id, sku: "V3-D" }, inventoryContext).items[0].reservedQty, 0);
  assert.equal(service.getJourneyRequest(mixedCreated.requestId, context).allocations.find((item) => item.id === transferAllocation.id).status, "transfer_in_progress");
  inventory.receiveTransfer(confirmedTransfer.transfer.id, inventoryContext);
  const syncedTransfer = service.syncTransfer(transferAllocation.id, context);
  const syncedAllocation = syncedTransfer.request.allocations.find((item) => item.id === transferAllocation.id);
  assert.equal(syncedAllocation.status, "ready");
  assert.equal(syncedAllocation.readyQty, 400);
  assert.equal(inventory.stockupAvailability({ warehouseId: target.id, sku: "V3-D" }, inventoryContext).items[0].reservedQty, 400);

  // 采购只能登记真实缺口，不能把现货覆盖数量再次采购。
  const purchaseAllocation = mixedLines["V3-B"].allocations.find((item) => item.sourceType === "purchase");
  assert.throws(() => service.createPurchaseOrder({ supplierName: "超量采购", paidTotalCny: 2000, lines: [{ requestLineId: mixedLines["V3-B"].id, fulfillmentAllocationId: purchaseAllocation.id, quantity: 1401, merchandiseAmount: 2000 }] }, context, "purchase-over"), (error) => error?.code === "purchase_quantity_exceeds_request");
  const purchase = service.createPurchaseOrder({ supplierName: "缺口采购", paidTotalCny: 1400, lines: [{ requestLineId: mixedLines["V3-B"].id, fulfillmentAllocationId: purchaseAllocation.id, quantity: 1400, merchandiseAmount: 1400 }] }, context, "purchase-correct").purchaseOrder;
  assert.equal(purchase.lines[0].quantity, 1400);

  // 采购分两次到货时，每次只恢复实际良品库存；首批不足不能把整段
  // 误判为齐套，尾批审核入库后才完成该采购分支。
  function receivePurchaseBatch(reference, quantity, lotNo) {
    const workOrder = service.createWarehouseWorkOrder({
      requestId: mixedCreated.requestId,
      organizationCode: "partner-target",
      domesticWarehouseId: target.id,
      domesticWarehouseName: target.name,
      expectedArrivalAt: "2026-11-20",
      submit: true,
      lines: [{ requestLineId: mixedLines["V3-B"].id, fulfillmentAllocationId: purchaseAllocation.id, expectedQty: quantity }],
    }, context, reference).workOrder;
    const accepted = service.applyWarehouseWorkOrderAction(workOrder.id, { action: "accept", expectedVersion: workOrder.version }, context, `accept-${reference}`).workOrder;
    service.submitInspection(workOrder.id, { lines: [{
      id: accepted.lines[0].id,
      receivedQty: quantity,
      goodQty: quantity,
      damagedQty: 0,
      shortageQty: 0,
      pendingQty: 0,
      lots: [{ quantity, lotNo, barcode: `BAR-${lotNo}`, productionDate: "2026-11-10", cartonCount: quantity / 100, unitsPerCarton: 100, looseQuantity: 0, cartonLengthCm: 50, cartonWidthCm: 40, cartonHeightCm: 30, cartonWeightKg: 12 }],
      evidence: [],
    }] }, context);
    return service.reviewInspection(workOrder.id, { action: "approve" }, context);
  }
  failInboundReservation = true;
  const recoveryReview = receivePurchaseBatch("purchase-inbound-1", 1000, "PUR-LOT-1");
  assert.equal(recoveryReview.status, "reservation_recovery_required");
  let purchaseAfterInbound = service.getJourneyRequest(mixedCreated.requestId, context).allocations.find((item) => item.id === purchaseAllocation.id);
  assert.equal(purchaseAfterInbound.status, "reservation_recovery_required");
  assert.equal(service.getJourneyRequest(mixedCreated.requestId, context).nextAction.target, "reservation_recovery");
  service.recoverReservation(purchaseAllocation.id, context);
  purchaseAfterInbound = service.getJourneyRequest(mixedCreated.requestId, context).allocations.find((item) => item.id === purchaseAllocation.id);
  assert.equal(purchaseAfterInbound.readyQty, 1000);
  assert.equal(purchaseAfterInbound.status, "waiting_inbound");
  receivePurchaseBatch("purchase-inbound-2", 400, "PUR-LOT-2");
  purchaseAfterInbound = service.getJourneyRequest(mixedCreated.requestId, context).allocations.find((item) => item.id === purchaseAllocation.id);
  assert.equal(purchaseAfterInbound.readyQty, 1400);
  assert.equal(purchaseAfterInbound.status, "ready");

  // 委外订单只能关联一次，防止同一完工数量被多个需求重复占用。
  const outsourcingAllocation = mixedLines["V3-C"].allocations.find((item) => item.sourceType === "outsourced_production");
  const linked = service.linkOutsourcing(outsourcingAllocation.id, { orderId: "JDY-OUT-1", orderNo: "JG261023001", expectedReadyAt: "2026-11-30" }, context);
  assert.equal(linked.allocation.status, "outsourcing_linked");
  const outsourcingWorkOrder = service.createWarehouseWorkOrder({
    requestId: mixedCreated.requestId,
    organizationCode: "partner-target",
    domesticWarehouseId: target.id,
    domesticWarehouseName: target.name,
    expectedArrivalAt: "2026-11-30",
    submit: true,
    lines: [{ requestLineId: mixedLines["V3-C"].id, fulfillmentAllocationId: outsourcingAllocation.id, expectedQty: 3000 }],
  }, context, "outsourcing-inbound-work-order").workOrder;
  const acceptedOutsourcing = service.applyWarehouseWorkOrderAction(outsourcingWorkOrder.id, { action: "accept", expectedVersion: outsourcingWorkOrder.version }, context, "accept-outsourcing-inbound").workOrder;
  service.submitInspection(outsourcingWorkOrder.id, { lines: [{
    id: acceptedOutsourcing.lines[0].id,
    receivedQty: 3000,
    goodQty: 3000,
    damagedQty: 0,
    shortageQty: 0,
    pendingQty: 0,
    lots: [{ quantity: 3000, lotNo: "OUT-LOT-1", barcode: "OUT-V3-C", productionDate: "2026-11-20", cartonCount: 30, unitsPerCarton: 100, looseQuantity: 0, cartonLengthCm: 50, cartonWidthCm: 40, cartonHeightCm: 30, cartonWeightKg: 12 }],
    evidence: [],
  }] }, context);
  service.reviewInspection(outsourcingWorkOrder.id, { action: "approve" }, context);
  const afterOutsourcingInbound = service.getJourneyRequest(mixedCreated.requestId, context);
  const readyOutsourcing = afterOutsourcingInbound.allocations.find((item) => item.id === outsourcingAllocation.id);
  assert.equal(readyOutsourcing.status, "ready", "委外完工必须经过国内仓验收入库后才可齐套");
  assert.equal(readyOutsourcing.readyQty, 3000);
  assert.equal(inventory.stockupAvailability({ warehouseId: target.id, sku: "V3-C" }, inventoryContext).items[0].reservedQty, 3000);
  assert.equal(afterOutsourcingInbound.nextAction.key, "create_shipment", "库存、调拨、采购和委外全部入库后应自动开放发运");
  const reconciliation = service.routeReconciliation(mixedCreated.requestId, context);
  assert.equal(reconciliation.summary.purchaseLineCount, 1);
  assert.equal(reconciliation.summary.warehouseLineCount, 3);
  assert.equal(reconciliation.requiresAdminReview, false);
  const secondOutsource = createRequest("v3-outsourcing-2", [{ sku: "V3-C2", productName: "第二个委外", requestedQty: 10, unit: "件", supplyMode: "委外生产" }]);
  const secondPreview = service.previewRoute(secondOutsource.requestId, { consolidationWarehouseId: target.id, consolidationWarehouseName: target.name }, context);
  const secondConfirmed = service.confirmRoute(secondOutsource.requestId, { expectedVersion: secondPreview.expectedRequestVersion, consolidationWarehouseId: target.id, consolidationWarehouseName: target.name }, context, "confirm-outsourcing-2");
  const secondAllocation = secondConfirmed.request.allocations.find((item) => item.sourceType === "outsourced_production");
  assert.throws(() => service.linkOutsourcing(secondAllocation.id, { orderId: "JDY-OUT-1", orderNo: "JG261023001" }, context), (error) => error?.code === "outsourcing_reference_conflict");

  // 场景 8：两张需求争抢同一库存，后一张必须失败且不产生假方案。
  const raceOne = createRequest("v3-race-one", [{ sku: "V3-RACE", productName: "库存争抢", requestedQty: 8, unit: "件", supplyMode: "外采成品" }]);
  const raceOnePreview = service.previewRoute(raceOne.requestId, { consolidationWarehouseId: target.id, consolidationWarehouseName: target.name }, context);
  service.confirmRoute(raceOne.requestId, { expectedVersion: raceOnePreview.expectedRequestVersion, consolidationWarehouseId: target.id, consolidationWarehouseName: target.name }, context, "confirm-race-one");
  const raceTwo = createRequest("v3-race-two", [{ sku: "V3-RACE", productName: "库存争抢", requestedQty: 8, unit: "件", supplyMode: "自有成品库存" }]);
  const raceTwoPreview = service.previewRoute(raceTwo.requestId, { consolidationWarehouseId: target.id, consolidationWarehouseName: target.name }, context);
  assert.equal(raceTwoPreview.routingSummary.domesticStock, 2);
  assert.equal(raceTwoPreview.routingSummary.unresolved, 6, "自有库存不足时不得静默改成采购");
  assert.equal(raceTwoPreview.canConfirm, false);

  // 取消后的需求必须进入真正终态，释放锁定且不能再出现“重新计算方案”。
  inbound(target.id, "OPEN-CANCEL", "V3-CANCEL", 5);
  const cancelledCreated = createRequest("v3-cancel", [{ sku: "V3-CANCEL", productName: "取消终态", requestedQty: 5, unit: "件", supplyMode: "外采成品" }]);
  const cancelledPreview = service.previewRoute(cancelledCreated.requestId, { consolidationWarehouseId: target.id, consolidationWarehouseName: target.name }, context);
  service.confirmRoute(cancelledCreated.requestId, { expectedVersion: cancelledPreview.expectedRequestVersion, consolidationWarehouseId: target.id, consolidationWarehouseName: target.name }, context, "confirm-cancelled");
  const cancelledJourney = service.cancelRoute(cancelledCreated.requestId, { reason: "回归测试取消" }, context).request;
  assert.equal(cancelledJourney.journeyStage, "cancelled");
  assert.equal(cancelledJourney.nextAction, null);
  assert.equal(inventory.stockupAvailability({ warehouseId: target.id, sku: "V3-CANCEL" }, inventoryContext).items[0].reservedQty, 0);

  // 生产试点必须同时受需求白名单和管理员身份约束，避免开启开关后
  // 把所有历史 V2 需求一起切到新状态机。
  const mixedRequestNo = service.getRequest(mixedCreated.requestId, context).requestNo;
  const pilotService = createStockupCollaborationService(store, {
    inventoryGateway,
    fulfillmentV3Enabled: true,
    fulfillmentV3PilotRequestRefs: [mixedRequestNo],
    fulfillmentV3AdminOnly: true,
  });
  assert.ok(pilotService.getJourneyRequest(mixedCreated.requestId, context).allocations?.length > 0);
  const nonAdminContext = { ...context, auth: { role: "direct", user: { id: "v3-viewer", displayName: "V3 普通用户" } } };
  assert.equal(pilotService.getJourneyRequest(mixedCreated.requestId, nonAdminContext).allocations, undefined);
  assert.throws(
    () => pilotService.previewRoute(raceTwo.requestId, { consolidationWarehouseId: target.id }, context),
    (error) => error?.code === "fulfillment_v3_not_in_pilot",
  );

  console.log("stockup V3 multi-source routing tests passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
