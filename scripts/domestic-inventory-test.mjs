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

  const scoped = { ...admin, warehouseIds: [warehouseA.id], skus: ["SKU-A"] };
  assert.deepEqual(service.list({}, scoped).warehouses.map((item) => item.id), [warehouseA.id]);
  assert.deepEqual(service.list({}, scoped).balances.map((item) => item.sku), ["SKU-A"]);
  assert.throws(() => service.createMovement({ warehouseId: warehouseB.id, type: "inbound", lines: [{ sku: "SKU-A", productName: "产品A", quantity: 1 }] }, scoped), (error) => error?.statusCode === 403);
  assert.throws(() => service.createMovement({ warehouseId: warehouseA.id, type: "inbound", lines: [{ sku: "SKU-B", productName: "产品B", quantity: 1 }] }, scoped), (error) => error?.statusCode === 403);

  service.updateWarehouse(warehouseB.id, { status: "inactive" }, admin);
  assert.throws(() => service.createMovement({ warehouseId: warehouseB.id, type: "inbound", lines: [{ sku: "SKU-A", productName: "产品A", quantity: 1 }] }, admin), (error) => error?.code === "warehouse_inactive");
  assert.equal(service.listMovements({}, admin).movements.length, 6);
  console.log("domestic inventory tests passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
