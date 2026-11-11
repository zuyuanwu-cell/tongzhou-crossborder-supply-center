import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initInventoryLedgerStore } from "../server/inventory-ledger-db.js";

const directory = mkdtempSync(join(tmpdir(), "inventory-ledger-db-"));
try {
  const dbPath = join(directory, "inventory-ledger.sqlite");
  const legacy = {
    syncedAt: "2026-11-10T12:00:00.000Z",
    orders: [
      { warehouseId: "WH-1", orderId: "ORDER-1", lineId: "1", sku: "SKU-A", quantity: 2, shippedAt: "2026-11-09 10:00:00" },
      { warehouseId: "WH-2", orderId: "ORDER-2", lineId: "1", sku: "SKU-B", quantity: 3, shippedAt: "2026-11-10 10:00:00" },
    ],
  };
  const store = await initInventoryLedgerStore(dbPath, legacy);
  assert.equal(store.listOrders({ warehouseId: "WH-1", from: "2026-11-09", to: "2026-11-09" }).length, 1, "legacy JSON orders migrate once");
  store.upsertOrders([{ warehouseId: "WH-1", orderId: "ORDER-1", lineId: "1", sku: "SKU-A", quantity: 5, shippedAt: "2026-11-09 10:00:00" }]);
  assert.equal(store.listOrders({ warehouseId: "WH-1" }).length, 1, "order upsert is idempotent");
  assert.equal(store.listOrders({ warehouseId: "WH-1" })[0].quantity, 5);
  const cachedOrders = store.listOrders({ warehouseId: "WH-1" });
  assert.strictEqual(store.listOrders({ warehouseId: "WH-1" }), cachedOrders, "identical order windows reuse parsed rows");
  store.upsertOrders([{ warehouseId: "WH-1", orderId: "ORDER-4", lineId: "1", sku: "SKU-D", quantity: 1, shippedAt: "2026-11-10 10:00:00" }]);
  assert.notStrictEqual(store.listOrders({ warehouseId: "WH-1" }), cachedOrders, "order writes invalidate parsed-row reuse");
  store.replaceWarehouseOrders(["WH-2"], [{ warehouseId: "WH-2", orderId: "ORDER-3", lineId: "1", sku: "SKU-C", quantity: 4, shippedAt: "2026-11-11 10:00:00" }]);
  assert.deepEqual(store.listOrders({ warehouseId: "WH-2" }).map((row) => row.orderId), ["ORDER-3"]);

  store.upsertDailyLedger([{
    bizDate: "2026-11-10", timezone: "Asia/Shanghai", warehouseId: "WH-1", warehouseName: "Warehouse 1", sku: "SKU-A",
    openingQty: 10, inboundQty: 4, returnRestockQty: 1, transferInQty: 0, transferOutQty: 1,
    orderOutboundQty: 3, otherOutboundQty: 0, adjustQty: -1, closingQty: 10, faultyQty: 2, temporaryQty: 1,
    inTransitQty: 5, varianceQty: 0, unitCostCny: 6, inventoryValueCny: 60,
    costBasis: "effective_dated_manual_cost", costEffectiveDate: "2026-11-01", rateEffectiveDate: "2026-11-10", dataFlags: [],
  }]);
  const ledger = store.listDailyLedger({ from: "2026-11-10", to: "2026-11-10", warehouseId: "WH-1", sku: "SKU-A" });
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].closingQty, 10);
  assert.equal(ledger[0].faultyQty, 2);
  assert.deepEqual(ledger[0].dataFlags, []);
  assert.equal(store.aggregateDailyLedger({ from: "2026-11-10", to: "2026-11-10" }).inventoryValueCny, 60);
  assert.deepEqual(
    store.getDailyLedgerCoverage({ warehouseIds: ["WH-1"], skus: ["sku-a"], timezone: "Asia/Shanghai" }),
    { from: "2026-11-10", to: "2026-11-10", rowCount: 1 },
    "daily-ledger coverage is resolved without materializing the full row range",
  );
  assert.deepEqual(store.getDailyLedgerCoverage({ warehouseIds: ["WH-MISSING"] }), { from: "", to: "", rowCount: 0 });
  const indexes = store.listIndexes().map((row) => row.name);
  assert.equal(indexes.includes("idx_warehouse_orders_range"), true);
  assert.equal(indexes.includes("idx_inventory_daily_ledger_range"), true);

  const bulkOrders = Array.from({ length: 30000 }, (_, index) => ({
    warehouseId: `WH-${index % 12}`,
    orderId: `BULK-${index}`,
    lineId: "1",
    sku: `SKU-${index % 80}`,
    quantity: 1,
    shippedAt: `2026-10-${String(index % 28 + 1).padStart(2, "0")} 10:00:00`,
  }));
  store.upsertOrders(bulkOrders, { persist: false });
  const queryStartedAt = performance.now();
  const indexedRows = store.listOrders({ warehouseId: "WH-3", sku: "SKU-3", from: "2026-10-01", to: "2026-10-28" });
  const queryDurationMs = performance.now() - queryStartedAt;
  assert.equal(indexedRows.length > 0, true);
  assert.equal(queryDurationMs < 100, true, `indexed 30k-row order query took ${queryDurationMs.toFixed(1)}ms`);

  const reopened = await initInventoryLedgerStore(dbPath, { orders: [{ warehouseId: "BAD", orderId: "SHOULD-NOT-REMIGRATE", sku: "BAD", shippedAt: "2026-01-01" }] });
  assert.equal(reopened.listOrders({ warehouseId: "BAD" }).length, 0, "legacy migration never overwrites an existing database");
  console.log(`inventory ledger database tests passed (30k indexed query ${queryDurationMs.toFixed(1)}ms)`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
