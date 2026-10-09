import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { initStockupCollaborationStore } from "../server/stockup-collaboration-db.js";
import { createStockupCollaborationService } from "../server/stockup-collaboration-service.js";
import { buildYunAsnItems, buildYunAsnPayload, resolveYunWarehouseCodeFromList, warehouseStockupCreateCapability } from "../server/wms-adapters.js";

const temp = mkdtempSync(resolve(tmpdir(), "stockup-shipment-edit-wms-"));
try {
  const store = await initStockupCollaborationStore(resolve(temp, "test.sqlite"));
  const service = createStockupCollaborationService(store);
  const context = { auth: { role: "admin", user: { id: "tester", displayName: "测试管理员" } }, viewAll: true, viewCost: true, revealSupplier: true };
  const requestResult = service.createRequest({ project: "俄罗斯补货", destinationCountry: "俄罗斯", destinationWarehouseId: "ru-wms-1", destinationWarehouseName: "俄罗斯2仓", expectedArrivalAt: "2026-10-20", priority: "常规", reason: "补库存", submit: true, lines: [{ sku: "SKU-EDIT-001", productName: "测试产品", method: "采购", requestedQty: 20, unit: "件", targetUnitCostCny: 3.5 }] }, context, "shipment-edit-request");
  service.setRequestStatus(requestResult.requestId, "accepted", {}, context);
  const request = service.getRequest(requestResult.requestId, context);
  const task = service.createTask({ requestId: request.id, lineId: request.lines[0].id, plannedQty: 20 }, context).task;
  const completedTask = service.updateTask(task.id, { version: task.version, orderedQty: 20, completedQty: 20, status: "completed" }, context).task;
  const created = service.createShipment({ requestId: request.id, originWarehouseId: "cn-warehouse-1", originWarehouse: "国内测试仓", carrier: "Test Carrier", transportMode: "海运", trackingNo: "TRACK-001", eta: "2026-10-20", lines: [{ taskId: completedTask.id, requestId: request.id, shippedQty: 20, cartonCount: 2, unitsPerCarton: 10, cartonLengthCm: 40, cartonWidthCm: 30, cartonHeightCm: 20, cartonWeightKg: 5 }] }, context).shipment;
  const shipped = service.dispatchShipment(created.id, { carrier: "Test Carrier", trackingNo: "TRACK-001", eta: "2026-10-20" }, context).shipment;
  const updated = service.updateShipment(shipped.id, { version: shipped.version, eta: "2026-10-22", lines: shipped.lines.map((line) => ({ ...line, cartonCount: 4, unitsPerCarton: 5, cartonWeightKg: 3 })) }, context).shipment;
  assert.equal(updated.eta, "2026-10-22");
  assert.equal(updated.packages, 4);
  assert.equal(updated.totalWeightKg, 12);
  assert.throws(() => service.updateShipment(updated.id, { version: updated.version, lines: updated.lines.map((line) => ({ ...line, shippedQty: 19 })) }, context), (error) => error?.code === "inventory_quantity_locked");
  const pushing = service.beginShipmentWmsPush(updated.id, { providerId: "yunwms_ru", documentType: "inbound" }, context);
  assert.equal(pushing.shipment.wmsPushStatus, "pushing");
  const pushed = service.completeShipmentWmsPush(updated.id, { orderNo: "ASN-1001", documentLabel: "入库单" }, context).shipment;
  assert.equal(pushed.wmsOrderNo, "ASN-1001");
  assert.equal(service.beginShipmentWmsPush(updated.id, { providerId: "yunwms_ru", documentType: "inbound" }, context).alreadyCreated, true);
  assert.throws(() => service.updateShipment(pushed.id, { version: pushed.version, carrier: "Changed Carrier" }, context), (error) => error?.code === "wms_order_locked");
  const etaUpdated = service.updateShipment(pushed.id, { version: pushed.version, eta: "2026-10-25" }, context).shipment;
  assert.equal(etaUpdated.eta, "2026-10-25");
  const voided = service.voidShipmentWmsOrder(pushed.id, { documentLabel: "入库单", alreadyCancelled: false }, context).shipment;
  assert.equal(voided.wmsPushStatus, "voided");
  assert.equal(voided.wmsOrderNo, "ASN-1001");
  const recreating = service.beginShipmentWmsPush(voided.id, { providerId: "yunwms_ru", documentType: "inbound" }, context).shipment;
  assert.equal(recreating.wmsPushStatus, "pushing");
  assert.equal(recreating.wmsOrderNo, "");
  assert.equal(warehouseStockupCreateCapability({ id: "ru-test", providerId: "yunwms_ru" }).documentLabel, "入库单");
  assert.equal(warehouseStockupCreateCapability({ id: "sea-test", providerId: "sea_wms" }).documentLabel, "备货单");
  const yunWarehouses = [
    { warehouse_code: "DD001", warehouse_name: "东达001仓" },
    { warehouse_code: "DD002", warehouse_name: "" },
  ];
  assert.equal(resolveYunWarehouseCodeFromList({ name: "俄罗斯1仓" }, yunWarehouses), "");
  assert.equal(resolveYunWarehouseCodeFromList({ name: "俄罗斯2仓" }, yunWarehouses), "");
  assert.equal(resolveYunWarehouseCodeFromList({ name: "俄罗斯2仓", warehouseCode: "DD001" }, yunWarehouses), "DD001");
  assert.equal(resolveYunWarehouseCodeFromList({ name: "俄罗斯2仓", warehouseId: "DD001" }, yunWarehouses), "DD001");
  assert.equal(resolveYunWarehouseCodeFromList({ name: "俄罗斯仓" }, yunWarehouses), "");
  assert.equal(resolveYunWarehouseCodeFromList({ name: "俄罗斯1仓" }, [{ warehouse_code: "MX001", warehouse_name: "MX001" }]), "");
  const cartonItems = buildYunAsnItems({ lines: [{ sku: "TZKJ-QL032", quantity: 14_400, cartonCount: 200, unitsPerCarton: 72, purchasePrice: 0, purchasePriceCurrency: "CNY" }] });
  assert.equal(cartonItems.length, 200);
  assert.equal(cartonItems[0].box_no, "1");
  assert.equal(cartonItems[199].box_no, "200");
  assert.equal(cartonItems.every((item) => item.quantity === 72), true);
  assert.equal(cartonItems.reduce((sum, item) => sum + item.quantity, 0), 14_400);
  const multiSkuItems = buildYunAsnItems({ lines: [
    { sku: "SKU-A", quantity: 20, cartonCount: 2, unitsPerCarton: 10 },
    { sku: "SKU-B", quantity: 15, cartonCount: 3, unitsPerCarton: 5 },
  ] });
  assert.deepEqual(multiSkuItems.map((item) => item.box_no), ["1", "2", "3", "4", "5"]);
  assert.throws(() => buildYunAsnItems({ lines: [{ sku: "SKU-BAD", quantity: 14_400, cartonCount: 199, unitsPerCarton: 72 }] }), /装箱数据不一致/);
  const modifyPayload = buildYunAsnPayload({ referenceNo: "FY-20260929-M8P01", eta: "2026-10-15", lines: [{ sku: "TZKJ-QL032", quantity: 14_400, cartonCount: 200, unitsPerCarton: 72 }] }, "DD002", "RVAEE0004-2-410-260930-0001");
  assert.equal(modifyPayload.receiving_code, "RVAEE0004-2-410-260930-0001");
  assert.equal(modifyPayload.warehouse_code, "DD002");
  assert.equal(modifyPayload.eta_date, "2026-10-15");
  assert.equal(modifyPayload.transit_type, 1);
  assert.equal(modifyPayload.transit_warehouse_code, "DD002");
  assert.equal(modifyPayload.receiving_shipping_type, "0");
  assert.equal(modifyPayload.items.length, 200);
  console.log("stockup shipment edit and WMS tests passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
