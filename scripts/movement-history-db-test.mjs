import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initMovementHistoryStore } from "../server/movement-history-db.js";

const TIMEZONE = "Asia/Shanghai";
const STATUS = {
  stockout: "\u7f3a\u8d27",
  replenish: "\u8865\u8d27\u9884\u8b66",
  slow: "\u6162\u9500",
  stagnant: "\u6ede\u9500",
  healthy: "\u5065\u5eb7",
  noSalesData: "\u65e0\u52a8\u9500\u6570\u636e",
};

function dateKey(offset) {
  const date = new Date(Date.UTC(2026, 6, 1));
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function makeRows(day) {
  const statuses = Object.values(STATUS);
  return Array.from({ length: 400 }, (_, index) => {
    const warehouseIndex = index % 2;
    const sales30 = (index + day) % 31;
    return {
      sku: `SKU-${String(index).padStart(4, "0")}`,
      countrySku: `COUNTRY-${String(index).padStart(4, "0")}`,
      productName: `Product ${index}`,
      brand: index % 3 ? "Brand A" : "Brand B",
      category: index % 5 ? "General" : "Special",
      country: warehouseIndex ? "Russia" : "China",
      warehouseId: warehouseIndex ? "wh-b" : "wh-a",
      warehouseName: warehouseIndex ? "Warehouse B" : "Warehouse A",
      availableQty: 100 + index,
      lockedQty: index % 7,
      inTransitQty: index % 11,
      totalQty: 100 + index + (index % 7) + (index % 11),
      sales3: index % 4,
      sales7: index % 8,
      sales15: index % 16,
      sales30,
      sales60: sales30 * 2,
      sales90: sales30 * 3,
      avgDaily3: (index % 4) / 3,
      avgDaily7: (index % 8) / 7,
      avgDaily30: sales30 / 30,
      avgDaily90: (sales30 * 3) / 90,
      dailyWeighted: sales30 / 30,
      daysCover: 30,
      leadDays: 15,
      targetCoverDays: 30,
      replenishQty: index % 13,
      status: statuses[index % statuses.length],
      suggestion: "Test",
      source: "warehouse",
      dataGap: "",
    };
  });
}

function totals(rows) {
  const statusCounts = rows.reduce((result, row) => {
    result[row.status] = (result[row.status] || 0) + 1;
    return result;
  }, {});
  return {
    rowCount: rows.length,
    warehouseCount: new Set(rows.map((row) => row.warehouseId)).size,
    skuCount: new Set(rows.map((row) => row.sku)).size,
    availableQty: rows.reduce((sum, row) => sum + row.availableQty, 0),
    totalQty: rows.reduce((sum, row) => sum + row.totalQty, 0),
    sales3: rows.reduce((sum, row) => sum + row.sales3, 0),
    sales7: rows.reduce((sum, row) => sum + row.sales7, 0),
    sales30: rows.reduce((sum, row) => sum + row.sales30, 0),
    sales90: rows.reduce((sum, row) => sum + row.sales90, 0),
    stockout: statusCounts[STATUS.stockout] || 0,
    replenish: statusCounts[STATUS.replenish] || 0,
    slow: statusCounts[STATUS.slow] || 0,
    stagnant: statusCounts[STATUS.stagnant] || 0,
    noSalesData: statusCounts[STATUS.noSalesData] || 0,
  };
}

const directory = mkdtempSync(join(tmpdir(), "movement-history-"));
try {
  const store = await initMovementHistoryStore(join(directory, "history.sqlite"));
  for (let day = 0; day < 74; day += 1) {
    const rows = makeRows(day);
    store.upsertSnapshot({
      date: dateKey(day),
      timezone: TIMEZONE,
      capturedAt: `${dateKey(day)}T01:00:00.000Z`,
      totals: totals(rows),
      rows,
    }, { persist: false });
  }
  store.persist();

  const metadataStartedAt = Date.now();
  const summaries = store.summarizeSnapshots({ timezone: TIMEZONE });
  const metadataElapsed = Date.now() - metadataStartedAt;
  assert.equal(summaries.length, 74);
  assert.equal(summaries[0].rowCount, 400);
  assert.equal(summaries[0].warehouseCount, 2);

  const scopedStartedAt = Date.now();
  const scoped = store.summarizeSnapshots(
    { timezone: TIMEZONE },
    { warehouseIds: ["wh-a"], countries: ["China"] },
  );
  const scopedElapsed = Date.now() - scopedStartedAt;
  assert.equal(scoped.length, 74);
  assert.equal(scoped[0].rowCount, 200);
  assert.equal(scoped[0].warehouseCount, 1);
  assert.equal(scoped[0].skuCount, 200);

  const keyword = store.summarizeSnapshots(
    { date: dateKey(73), timezone: TIMEZONE },
    { sku: "product 39" },
  );
  assert.equal(keyword.length, 1);
  assert.equal(keyword[0].rowCount, 11);

  const latest = store.getLatestSnapshot({
    from: "2026-08-01",
    to: "2026-08-15",
    timezone: TIMEZONE,
  });
  assert.equal(latest.date, "2026-08-15");
  assert.equal(latest.rows.length, 400);

  assert.ok(metadataElapsed < 1_000, `Metadata summary took ${metadataElapsed}ms`);
  assert.ok(scopedElapsed < 3_000, `Scoped summary took ${scopedElapsed}ms`);
  console.log(`movement-history-db test passed: metadata=${metadataElapsed}ms scoped=${scopedElapsed}ms snapshots=${summaries.length}`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
