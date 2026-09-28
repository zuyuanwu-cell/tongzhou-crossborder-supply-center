import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { initDomesticInventoryStore } from "../server/domestic-inventory-db.js";
import { createDomesticInventoryService } from "../server/domestic-inventory-service.js";

const temp = mkdtempSync(resolve(tmpdir(), "domestic-inventory-"));
try {
  const store = await initDomesticInventoryStore(resolve(temp, "inventory.sqlite"));
  const service = createDomesticInventoryService(store);
  const admin = { auth: { user: { id: "admin-test", displayName: "测试管理员" } }, countries: [], warehouseIds: [], skus: [] };
  const warehouseA = service.createWarehouse({ code: "CN-GZ-01", name: "广州成品仓", province: "广东", city: "广州" }, admin).warehouse;
  const warehouseB = service.createWarehouse({ code: "CN-SZ-01", name: "深圳成品仓" }, admin).warehouse;
  assert.equal(service.list({}, admin).summary.warehouses, 2);

  const opening = service.importOpeningBalances({
    warehouseId: warehouseB.id,
    lines: [{ productId: "p3", sku: "SKU-C", productName: "产品C", quantity: 12, safetyStockQty: 3, unitCostCny: 6.5 }],
  }, admin, "idem-opening");
  assert.match(opening.movementNo, /^QC-/);
  const openingBalance = service.list({ warehouseId: warehouseB.id }, admin).balances[0];
  assert.equal(openingBalance.onHandQty, 12);
  assert.equal(openingBalance.safetyStockQty, 3);
  assert.throws(
    () => service.importOpeningBalances({ warehouseId: warehouseB.id, lines: [{ sku: "SKU-D", productName: "产品D", quantity: 2 }, { sku: "SKU-C", productName: "产品C", quantity: 1 }] }, admin),
    (error) => error?.code === "opening_balance_exists",
  );
  assert.equal(service.list({ warehouseId: warehouseB.id }, admin).balances.some((item) => item.sku === "SKU-D"), false, "failed opening import must roll back every line");

  const inbound = {
    warehouseId: warehouseA.id,
    type: "inbound",
    referenceNo: "PO-001",
    lines: [
      { productId: "p1", sku: " sku-a ", productName: "产品A", unit: "件", quantity: 10, unitCostCny: 5 },
      { productId: "p2", sku: "SKU-B", productName: "产品B", unit: "盒", quantity: 4, unitCostCny: 8 },
    ],
  };
  const firstInbound = service.createMovement(inbound, admin, "idem-inbound");
  const duplicateInbound = service.createMovement(inbound, admin, "idem-inbound");
  assert.equal(firstInbound.movementId, duplicateInbound.movementId, "idempotency must prevent duplicate stock entries");
  assert.equal(service.list({}, admin).summary.onHandQty, 26);
  const skuALotBefore = service.listLots({ warehouseId: warehouseA.id, sku: "SKU-A" }, admin).lots[0];
  assert.equal(skuALotBefore.needsSupplement, true);
  const supplementedSkuA = service.updateLot(skuALotBefore.id, {
    lotNo: "LOT-SKU-A-001", barcode: "690000000010", productionDate: "2026-09-20", expiryDate: "2029-09-20",
    packagingMode: "carton", unitsPerCarton: 6, cartonLengthCm: 40, cartonWidthCm: 30, cartonHeightCm: 20, cartonWeightKg: 7.2,
  }, admin).lot;
  assert.equal(supplementedSkuA.receivedQty, 10, "supplementing metadata must not change received quantity");
  assert.equal(supplementedSkuA.remainingQty, 10, "supplementing metadata must not change remaining quantity");
  assert.equal(supplementedSkuA.cartonCount, 1);
  assert.equal(supplementedSkuA.looseQuantity, 4);
  assert.equal(supplementedSkuA.needsSupplement, false);
  assert.equal(service.listLots({ warehouseId: warehouseA.id, incompleteOnly: "1" }, admin).lots.some((item) => item.sku === "SKU-A"), false);
  assert.throws(
    () => service.createMovement({ ...inbound, lines: [inbound.lines[0], { ...inbound.lines[0], sku: "SKU-A" }] }, admin),
    (error) => error?.code === "duplicate_sku",
  );

  const cartonInbound = service.createMovement({
    warehouseId: warehouseA.id,
    type: "inbound",
    referenceNo: "PO-CARTON-001",
    lines: [{
      productId: "p-box", sku: "SKU-BOX", productName: "整箱产品", unit: "件", quantity: 25, unitCostCny: 9,
      packagingMode: "carton", cartonCount: 2, unitsPerCarton: 12, looseQuantity: 1,
      cartonLengthCm: 40, cartonWidthCm: 30, cartonHeightCm: 25, cartonWeightKg: 8.5,
      lotNo: "LOT-202609", barcode: "690000000001", productionDate: "2026-09-01", expiryDate: "2029-09-01",
    }],
  }, admin, "idem-carton");
  const cartonLots = service.listLots({ warehouseId: warehouseA.id, sku: "SKU-BOX", availableOnly: "1" }, admin);
  assert.equal(cartonLots.total, 1);
  assert.equal(cartonLots.lots[0].packagingMode, "carton");
  assert.equal(cartonLots.lots[0].remainingQty, 25);
  assert.equal(cartonLots.lots[0].unitsPerCarton, 12);
  assert.equal(service.getMovement(cartonInbound.movementId, admin).movement.lines[0].lot.lotNo, "LOT-202609");
  assert.throws(
    () => service.createMovement({ warehouseId: warehouseA.id, type: "inbound", lines: [{ sku: "SKU-BAD", productName: "错误箱规", quantity: 10, packagingMode: "carton", cartonCount: 2, unitsPerCarton: 6, cartonLengthCm: 1, cartonWidthCm: 1, cartonHeightCm: 1, cartonWeightKg: 1 }] }, admin),
    (error) => error?.code === "packaging_quantity_mismatch",
  );
  service.updateLot(cartonLots.lots[0].id, { barcode: "690000000009", productionDate: "2026-09-02" }, admin);
  assert.equal(service.listLots({ barcode: "690000000009" }, admin).lots[0].productionDate, "2026-09-02");
  service.createMovement({ warehouseId: warehouseA.id, type: "outbound", referenceNo: "SHIP-BOX", lines: [{ sku: "SKU-BOX", productName: "整箱产品", unit: "件", quantity: 13 }] }, admin);
  const availability = service.stockupAvailability({ warehouseId: warehouseA.id, skus: "SKU-BOX" }, admin);
  assert.equal(availability.items[0].availableQty, 12);
  assert.equal(availability.items[0].knownLotQty, 12);
  assert.equal(availability.items[0].cartonProfiles[0].fullCartons, 1);
  assert.equal(availability.items[0].cartonProfiles[0].looseUnits, 0);
  assert.equal(service.listWarehouses(admin).warehouses.length, 2);

  const splitInbound = service.createMovement({
    warehouseId: warehouseA.id,
    type: "inbound",
    referenceNo: "PO-SPLIT-001",
    lines: [{ productId: "p-split", sku: "SKU-SPLIT", productName: "多批次产品", unit: "件", quantity: 25, unitCostCny: 4.5 }],
  }, admin, "idem-split");
  const splitSource = service.listLots({ warehouseId: warehouseA.id, sku: "SKU-SPLIT" }, admin).lots[0];
  const splitResult = service.splitLot(splitSource.id, { splits: [
    { lotNo: "SPLIT-A", barcode: "690100000001", productionDate: "2026-09-01", expiryDate: "2029-09-01", quantity: 12, packagingMode: "carton", unitsPerCarton: 6, cartonLengthCm: 40, cartonWidthCm: 30, cartonHeightCm: 20, cartonWeightKg: 6 },
    { lotNo: "SPLIT-B", barcode: "690100000002", productionDate: "2026-09-02", expiryDate: "2029-09-02", quantity: 13, packagingMode: "carton", unitsPerCarton: 6, cartonLengthCm: 40, cartonWidthCm: 30, cartonHeightCm: 20, cartonWeightKg: 6 },
  ] }, admin);
  assert.equal(splitResult.lots.length, 2);
  assert.equal(splitResult.lots.reduce((sum, item) => sum + item.receivedQty, 0), 25);
  assert.equal(splitResult.lots.find((item) => item.lotNo === "SPLIT-B").looseQuantity, 1);
  assert.equal(service.getMovement(splitInbound.movementId, admin).movement.lines[0].lots.length, 2);
  assert.equal(service.stockupAvailability({ warehouseId: warehouseA.id, skus: "SKU-SPLIT" }, admin).items[0].knownLotQty, 25);
  service.createMovement({ warehouseId: warehouseA.id, type: "outbound", referenceNo: "USE-SPLIT", lines: [{ sku: "SKU-SPLIT", productName: "多批次产品", unit: "件", quantity: 1 }] }, admin);
  assert.throws(
    () => service.splitLot(splitResult.lots[0].id, { splits: [{ lotNo: "X", quantity: 5 }, { lotNo: "Y", quantity: 7 }] }, admin),
    (error) => error?.code === "lot_already_allocated",
  );

  service.createMovement({ warehouseId: warehouseA.id, type: "outbound", referenceNo: "USE-001", lines: [{ sku: "SKU-A", productName: "产品A", unit: "件", quantity: 3 }] }, admin);
  assert.equal(service.list({ warehouseId: warehouseA.id }, admin).balances.find((item) => item.sku === "SKU-A").onHandQty, 7);
  assert.throws(
    () => service.createMovement({ warehouseId: warehouseA.id, type: "outbound", lines: [{ sku: "SKU-B", productName: "产品B", unit: "盒", quantity: 99 }] }, admin),
    (error) => error?.code === "insufficient_stock",
  );
  assert.equal(service.list({ warehouseId: warehouseA.id }, admin).balances.find((item) => item.sku === "SKU-B").onHandQty, 4, "failed outbound must roll back all writes");

  assert.throws(() => service.createMovement({ warehouseId: warehouseA.id, type: "adjustment", lines: [{ sku: "SKU-A", productName: "产品A", deltaQty: -1 }] }, admin), (error) => error?.code === "adjustment_reason_required");
  service.createMovement({ warehouseId: warehouseA.id, type: "adjustment", note: "盘点少一件", lines: [{ sku: "SKU-A", productName: "产品A", unit: "件", deltaQty: -1 }] }, admin);
  service.updateSafetyStock(warehouseA.id, "SKU-A", { safetyStockQty: 6 }, admin);
  const lowStock = service.list({ lowStock: "1" }, admin);
  assert.deepEqual(lowStock.balances.map((item) => item.sku), ["SKU-A"]);

  const sourceWarehouseUser = { ...admin, warehouseIds: [warehouseA.id] };
  const targetWarehouseUser = { ...admin, warehouseIds: [warehouseB.id] };
  assert.deepEqual(service.listTransferTargets(warehouseA.id, sourceWarehouseUser).warehouses.map((item) => item.id), [warehouseB.id]);
  const transfer = service.createTransfer({
    sourceWarehouseId: warehouseA.id,
    targetWarehouseId: warehouseB.id,
    note: "马来仓备货调拨",
    lines: [{ sku: "SKU-SPLIT", quantity: 6 }],
  }, sourceWarehouseUser, "transfer-1");
  assert.match(transfer.transferNo, /^DB-/);
  assert.equal(transfer.transfer.status, "in_transit");
  assert.equal(service.list({ warehouseId: warehouseA.id }, admin).balances.find((item) => item.sku === "SKU-SPLIT").onHandQty, 18);
  assert.equal(service.listTransfers({}, sourceWarehouseUser).summary.inTransit, 1);
  assert.equal(service.listTransfers({}, targetWarehouseUser).transfers[0].id, transfer.transferId);
  assert.throws(() => service.receiveTransfer(transfer.transferId, sourceWarehouseUser), (error) => error?.statusCode === 403);
  const receivedTransfer = service.receiveTransfer(transfer.transferId, targetWarehouseUser);
  assert.equal(receivedTransfer.transfer.status, "received");
  assert.equal(service.receiveTransfer(transfer.transferId, targetWarehouseUser).idempotentReplay, true);
  assert.equal(service.list({ warehouseId: warehouseB.id }, admin).balances.find((item) => item.sku === "SKU-SPLIT").onHandQty, 6);
  const receivedLot = service.listLots({ warehouseId: warehouseB.id, sku: "SKU-SPLIT" }, admin).lots[0];
  assert.equal(receivedLot.lotNo, "SPLIT-A");
  assert.equal(receivedLot.unitsPerCarton, 6);
  assert.equal(receivedLot.receivedQty, 6);

  const cancelledTransfer = service.createTransfer({
    sourceWarehouseId: warehouseA.id,
    targetWarehouseId: warehouseB.id,
    lines: [{ sku: "SKU-B", quantity: 2 }],
  }, sourceWarehouseUser, "transfer-2");
  assert.throws(() => service.cancelTransfer(cancelledTransfer.transferId, targetWarehouseUser), (error) => error?.statusCode === 403);
  assert.equal(service.cancelTransfer(cancelledTransfer.transferId, sourceWarehouseUser).transfer.status, "cancelled");
  assert.equal(service.cancelTransfer(cancelledTransfer.transferId, sourceWarehouseUser).idempotentReplay, true);
  assert.equal(service.list({ warehouseId: warehouseA.id }, admin).balances.find((item) => item.sku === "SKU-B").onHandQty, 4);
  service.createMovement({ warehouseId: warehouseA.id, type: "outbound", referenceNo: "USE-ALL-SKU-B", lines: [{ sku: "SKU-B", productName: "产品B", unit: "盒", quantity: 4 }] }, admin);
  const afterFullOutbound = service.list({ warehouseId: warehouseA.id }, admin);
  assert.equal(afterFullOutbound.balances.some((item) => item.sku === "SKU-B"), false, "zero-stock SKUs must not appear in the inventory balance list");
  assert.ok(afterFullOutbound.summary.ledgerSkuCount > afterFullOutbound.summary.skuCount, "zero-stock ledger rows remain available for traceability");

  const scoped = { ...admin, warehouseIds: [warehouseA.id], skus: ["SKU-A"] };
  assert.deepEqual(service.list({}, scoped).warehouses.map((item) => item.id), [warehouseA.id]);
  assert.deepEqual(service.list({}, scoped).balances.map((item) => item.sku), ["SKU-A"]);
  assert.throws(() => service.createMovement({ warehouseId: warehouseB.id, type: "inbound", lines: [{ sku: "SKU-A", productName: "产品A", quantity: 1 }] }, scoped), (error) => error?.statusCode === 403);
  assert.throws(() => service.createMovement({ warehouseId: warehouseA.id, type: "inbound", lines: [{ sku: "SKU-B", productName: "产品B", quantity: 1 }] }, scoped), (error) => error?.statusCode === 403);

  service.updateWarehouse(warehouseB.id, { status: "inactive" }, admin);
  assert.throws(() => service.createMovement({ warehouseId: warehouseB.id, type: "inbound", lines: [{ sku: "SKU-A", productName: "产品A", quantity: 1 }] }, admin), (error) => error?.code === "warehouse_inactive");
  assert.equal(service.listMovements({}, admin).movements.length, 13);
  console.log("domestic inventory tests passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
