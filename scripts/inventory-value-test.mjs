import assert from "node:assert/strict";
import fs from "node:fs";
import { transform } from "esbuild";
import { buildActiveInventoryWarehouseOptions, buildInventoryValuePayload, normalizeInventoryValueEffectiveDate } from "../server/inventory-value.js";
import { normalizeSeaInventory, normalizeYunInventory } from "../server/wms-adapters.js";

const products = {
  productBase: [
    { sku: "SKU-A", name: "产品A" },
    { sku: "SKU-B", name: "产品B" },
    { sku: "SKU-C", name: "产品C" },
    { sku: "SKU-D", name: "产品D" },
  ],
  catalog: [
    { sku: "SKU-A", name: "产品A", country: "印度尼西亚", directPrice: 10, directCurrency: "CNY" },
    { sku: "SKU-B", name: "产品B", country: "印度尼西亚", directPrice: 0, directCurrency: "CNY" },
    { sku: "SKU-D", name: "产品D", country: "印度尼西亚", directPrice: 7, directCurrency: "CNY" },
  ],
};

const snapshots = [
  {
    date: "2026-09-01",
    rows: [
      { warehouseId: "WH-ID", warehouseName: "印尼仓", country: "印度尼西亚", sku: "SKU-A", availableQty: 10, inTransitQty: 2, totalQty: 12 },
      { warehouseId: "WH-ID", warehouseName: "印尼仓", country: "印度尼西亚", sku: "SKU-B", lockedQty: 2, totalQty: 2 },
      { warehouseId: "WH-ID", warehouseName: "印尼仓", country: "印度尼西亚", sku: "SKU-D", availableQty: 1, totalQty: 1 },
    ],
  },
  {
    date: "2026-09-08",
    rows: [
      { warehouseId: "WH-ID", warehouseName: "印尼仓", country: "印度尼西亚", sku: "SKU-A", availableQty: 12, inTransitQty: 3, waitInQty: 1, totalQty: 16 },
      { warehouseId: "WH-ID", warehouseName: "印尼仓", country: "印度尼西亚", sku: "SKU-B", lockedQty: 3, totalQty: 3 },
      { warehouseId: "WH-ID", warehouseName: "印尼仓", country: "印度尼西亚", sku: "SKU-C", availableQty: 4, totalQty: 4 },
    ],
  },
];

const payload = buildInventoryValuePayload({
  snapshots,
  products,
  supplementalCosts: [
    { sku: "SKU-A", countryKey: "ID", unitCostCny: 99, effectiveDate: "2026-09-08", enabled: true },
    { sku: "SKU-B", countryKey: "ID", unitCostCny: 5, effectiveDate: "2026-09-08", enabled: true },
  ],
  filters: { period: "day" },
  manageCosts: true,
});

assert.equal(payload.timeline.length, 2);
assert.equal(payload.currentPeriod.snapshotDate, "2026-09-08");
assert.equal(payload.previousPeriod.snapshotDate, "2026-09-01");
assert.equal(payload.summary.onHandQty, 19, "on-hand excludes in-transit and wait-in quantities");
assert.equal(payload.summary.inTransitQty, 3);
const quantityBoundaryPayload = buildInventoryValuePayload({
  snapshots: [{
    date: "2026-09-09",
    rows: [{
      warehouseId: "WH-BOUNDARY",
      warehouseName: "Boundary warehouse",
      country: "ID",
      sku: "SKU-A",
      availableQty: 12,
      lockedQty: 3,
      waitInQty: 1,
      inTransitQty: 4,
      faultyQty: 5,
      temporaryQty: 6,
      totalQty: 31,
    }],
  }],
  products,
  filters: { period: "day" },
});
assert.equal(quantityBoundaryPayload.summary.onHandQty, 15);
assert.equal(quantityBoundaryPayload.summary.totalQty, 15, "total inventory equals available plus locked only");
assert.equal(quantityBoundaryPayload.summary.waitInQty, 1);
assert.equal(quantityBoundaryPayload.summary.inTransitQty, 4);
assert.equal(quantityBoundaryPayload.summary.faultyQty, 5);
assert.equal(quantityBoundaryPayload.summary.temporaryQty, 6);
assert.equal(payload.summary.onHandValueCny, 135, "missing-cost stock is excluded from the known value");
assert.equal(payload.summary.previousOnHandValueCny, 107, "future manual cost versions never backfill older snapshots");
assert.equal(payload.summary.periodChangeCny, 28);
assert.equal(payload.summary.missingCostSkuCount, 1);
assert.equal(payload.summary.coveredOnHandQty, 15);
assert.equal(payload.summary.costCoverageRate, 0.7895);
assert.equal(payload.permissions.manageCosts, true);

const keywordFiltered = buildInventoryValuePayload({
  snapshots,
  products,
  supplementalCosts: [],
  filters: { period: "day", keyword: "SKU-A" },
});
assert.deepEqual(keywordFiltered.rows.map((row) => row.sku), ["SKU-A"]);
assert.equal(keywordFiltered.summary.onHandQty, 12, "keyword filters recompute the visible-period summary");
assert.equal(keywordFiltered.summary.onHandValueCny, 120, "keyword filters recompute value instead of retaining the unfiltered KPI");

const directRow = payload.rows.find((row) => row.sku === "SKU-A");
assert.equal(directRow.unitCostCny, 10, "direct supply price always wins over a manual supplement");
assert.equal(directRow.costSource, "direct_price");
assert.equal(directRow.costBasis, "current_direct_price");
assert.equal(directRow.costEffectiveDate, "");
assert.equal(directRow.onHandValueCny, 120);
assert.equal(directRow.valueChangeCny, 20);

const manualRow = payload.rows.find((row) => row.sku === "SKU-B");
assert.equal(manualRow.unitCostCny, 5);
assert.equal(manualRow.costSource, "manual_supplement");
assert.equal(manualRow.costBasis, "effective_dated_manual_cost");
assert.equal(manualRow.costEffectiveDate, "2026-09-08");
assert.equal(manualRow.previousValueCny, 0);

const missingRow = payload.missingCosts.find((row) => row.sku === "SKU-C");
assert.equal(missingRow.onHandQty, 4);

const removedRow = payload.rows.find((row) => row.sku === "SKU-D");
assert.equal(removedRow.onHandQty, 0, "SKUs that leave inventory remain visible in the change detail");
assert.equal(removedRow.valueChangeCny, -7);

const russiaWarehouseProducts = {
  productBase: [
    { sku: "SKU-RU", name: "Russia product" },
    { sku: "SKU-RU-MISSING", name: "Russia product without warehouse cost" },
  ],
  catalog: [
    { sku: "SKU-RU", name: "Russia product", country: "俄罗斯", directPrice: 99, directCurrency: "CNY" },
    { sku: "SKU-RU-MISSING", name: "Russia product without warehouse cost", country: "俄罗斯", directPrice: 88, directCurrency: "CNY" },
  ],
  warehouseCostScopes: [{ warehouseCode: "DD001", warehouseName: "俄罗斯2仓" }],
  warehouseCosts: [{ warehouseCode: "DD001", warehouseName: "俄罗斯2仓", sku: "SKU-RU", unitCostCny: 12.5 }],
};
const russiaWarehouseSnapshots = [{
  date: "2026-10-09",
  rows: [
    { warehouseId: "WH-RU-2", warehouseName: "俄罗斯2仓", providerWarehouseCode: "DD001", country: "俄罗斯", sku: "SKU-RU", availableQty: 2, totalQty: 2 },
    { warehouseId: "WH-RU-2", warehouseName: "俄罗斯2仓", providerWarehouseCode: "DD001", country: "俄罗斯", sku: "SKU-RU-MISSING", availableQty: 1, totalQty: 1 },
    { warehouseId: "WH-RU-1", warehouseName: "俄罗斯1仓", providerWarehouseCode: "DD002", country: "俄罗斯", sku: "SKU-RU", availableQty: 3, totalQty: 3 },
  ],
}];
const russiaSecondWarehouse = buildInventoryValuePayload({
  snapshots: russiaWarehouseSnapshots,
  products: russiaWarehouseProducts,
  filters: { period: "day", warehouseId: "WH-RU-2" },
});
assert.equal(russiaSecondWarehouse.summary.onHandValueCny, 25, "DD001 uses the JiandaoYun weighted supply price instead of the generic catalog cost");
assert.equal(russiaSecondWarehouse.rows.find((row) => row.sku === "SKU-RU")?.costSource, "warehouse_weighted_price");
assert.equal(russiaSecondWarehouse.missingCosts.find((row) => row.sku === "SKU-RU-MISSING")?.onHandQty, 1, "DD001 does not silently fall back to another cost table when the warehouse price is missing");
const otherRussiaWarehouse = buildInventoryValuePayload({
  snapshots: russiaWarehouseSnapshots,
  products: russiaWarehouseProducts,
  filters: { period: "day", warehouseId: "WH-RU-1" },
});
assert.equal(otherRussiaWarehouse.summary.onHandValueCny, 297, "other Russian warehouses keep their existing product catalog cost rule");

const futureWarehouseCostProducts = {
  ...russiaWarehouseProducts,
  warehouseCosts: [{ warehouseCode: "DD001", sku: "SKU-RU", unitCostCny: 12.5, effectiveAt: "2026-10-09T08:49:37.141Z" }],
};
const futureWarehouseCost = buildInventoryValuePayload({
  snapshots: [{ date: "2026-10-08", rows: [{ warehouseId: "WH-RU-2", providerWarehouseCode: "DD001", country: "RU", sku: "SKU-RU", availableQty: 2, totalQty: 2 }] }],
  products: futureWarehouseCostProducts,
  filters: { period: "day" },
});
assert.equal(futureWarehouseCost.summary.onHandValueCny, 0, "future warehouse cost versions never backfill an older snapshot");
assert.equal(futureWarehouseCost.rows[0].costSource, "missing");

const futureManualCost = buildInventoryValuePayload({
  snapshots: [{ date: "2026-09-08", rows: [{ warehouseId: "WH-ID", country: "ID", sku: "SKU-C", availableQty: 4, totalQty: 4 }] }],
  products,
  supplementalCosts: [{ sku: "SKU-C", countryKey: "ID", unitCostCny: 6, effectiveDate: "2026-09-09", enabled: true }],
  filters: { period: "day" },
});
assert.equal(futureManualCost.summary.unvaluedOnHandQty, 4);
assert.equal(futureManualCost.rows[0].costSource, "missing");

const missingWarehouseCode = buildInventoryValuePayload({
  snapshots: [{
    date: "2026-10-09",
    rows: [{ warehouseId: "WH-RU-UNKNOWN", warehouseName: russiaWarehouseProducts.warehouseCostScopes[0].warehouseName, country: "RU", sku: "SKU-RU", availableQty: 1, totalQty: 1 }],
  }],
  products: russiaWarehouseProducts,
  filters: { period: "day" },
});
assert.equal(missingWarehouseCode.rows[0].costSource, "direct_price", "warehouse-specific costs require the provider warehouse code and never infer it from the display name");

const seaInventory = normalizeSeaInventory({
  goodsSkuOuterId: "SEA-SKU",
  availableStockNum: 10,
  lockedStockNum: 2,
  waitInStorageNum: 3,
  onWayNum: 4,
  faultyStockNum: 5,
  temporaryStockNum: 6,
  stockNum: 30,
}, { id: "SEA-WH", name: "SEA warehouse", country: "ID", providerId: "sea_wms" });
assert.equal(seaInventory.totalQty, 12, "SEA normalized total is available plus locked only");

const yunInventory = normalizeYunInventory({
  product_sku: "YUN-SKU",
  sellable: 10,
  reserved: 2,
  pending: 3,
  onway: 4,
  unsellable: 5,
  warehouse_code: "DD001",
}, { id: "YUN-WH", name: "Yun warehouse", country: "RU", providerId: "yunwms_ru" });
assert.equal(yunInventory.totalQty, 12, "YunWMS normalized total is available plus locked only");

const weekly = buildInventoryValuePayload({ snapshots, products, supplementalCosts: [], filters: { period: "week" } });
assert.equal(weekly.timeline.length, 2, "weekly mode keeps the latest snapshot in each week");

const filtered = buildInventoryValuePayload({ snapshots, products, supplementalCosts: [], filters: { period: "day", warehouseId: "OTHER" } });
assert.equal(filtered.summary.onHandQty, 0, "warehouse filters are applied before valuation");

const credential = { appKey: "configured" };
const activeWarehouseOptions = buildActiveInventoryWarehouseOptions({
  connections: [
    { id: "WH-ID", name: "印尼仓", country: "印度尼西亚", providerId: "sea_wms", baseUrl: "https://wms.example", warehouseId: "56064", status: "已授权", syncScope: ["库存同步"], credentials: credential },
    { id: "WH-ID-OLD", name: "印尼仓（旧）", country: "印度尼西亚", providerId: "sea_wms", baseUrl: "https://wms.example/", warehouseId: "56064", status: "已授权", syncScope: ["库存同步"], credentials: credential },
    { id: "WH-MY", name: "马来仓", country: "马来西亚", providerId: "sea_wms", baseUrl: "https://wms.example", warehouseId: "148", status: "已授权", syncScope: ["库存同步"], credentials: credential },
    { id: "WH-DISABLED", name: "停用仓", country: "俄罗斯", status: "已停用", syncScope: ["库存同步"], credentials: credential },
    { id: "WH-NO-CREDENTIAL", name: "待授权仓", country: "俄罗斯", status: "待授权", syncScope: ["库存同步"], credentials: {} },
    { id: "WH-NO-INVENTORY", name: "未同步库存仓", country: "越南", status: "已授权", syncScope: ["订单出库日报"], credentials: credential },
  ],
  scopes: { warehouseIds: [], countries: [] },
});
assert.deepEqual(activeWarehouseOptions.map((item) => item.value), ["WH-MY", "WH-ID"], "only active inventory warehouses are returned and physical duplicates are removed");

const scopedWarehouseOptions = buildActiveInventoryWarehouseOptions({
  connections: [
    { id: "WH-ID", name: "印尼仓", country: "印度尼西亚", providerId: "sea_wms", baseUrl: "https://wms.example", warehouseId: "56064", status: "已授权", syncScope: ["库存同步"], credentials: credential },
    { id: "WH-MY", name: "马来仓", country: "马来西亚", providerId: "sea_wms", baseUrl: "https://wms.example", warehouseId: "148", status: "已授权", syncScope: ["库存同步"], credentials: credential },
  ],
  scopes: { warehouseIds: [], countries: ["ID"] },
});
assert.deepEqual(scopedWarehouseOptions.map((item) => item.value), ["WH-ID"], "warehouse options respect country data scopes");

const configuredOptionsPayload = buildInventoryValuePayload({
  snapshots,
  products,
  warehouseOptions: activeWarehouseOptions,
  filters: { period: "day" },
});
assert.deepEqual(configuredOptionsPayload.options.warehouses, [
  { value: "WH-MY", label: "马来仓" },
  { value: "WH-ID", label: "印尼仓" },
], "the warehouse dropdown uses current configured warehouses instead of historical snapshot labels");

const csvModuleSource = fs.readFileSync(new URL("../src/inventory-value-csv.ts", import.meta.url), "utf8");
const compiledCsvModule = await transform(csvModuleSource, { loader: "ts", format: "esm", target: "es2020" });
const csvModule = await import(`data:text/javascript;base64,${Buffer.from(compiledCsvModule.code).toString("base64")}`);
const utf8Template = "\uFEFFSKU,国家代码,国家名称,产品名称,人民币单位成本,生效日期,启用,备注\r\nTZKJ-001,MY,马来西亚,测试产品,12.5,2026-09-14,是,补录";
const utf8Rows = csvModule.parseInventoryValueCostCsv(csvModule.decodeInventoryValueCsv(Buffer.from(utf8Template, "utf8")));
assert.equal(utf8Rows[0].sku, "TZKJ-001", "UTF-8 BOM templates remain supported");
assert.equal(utf8Rows[0].unitCostCny, 12.5);

const utf16Template = "SKU\t国家\t人民币单位成本\t生效日期\r\nTZKJ-002\t印度尼西亚\t9.80\t2026/09/14";
const utf16Bytes = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(utf16Template, "utf16le")]);
const utf16Rows = csvModule.parseInventoryValueCostCsv(csvModule.decodeInventoryValueCsv(utf16Bytes));
assert.equal(utf16Rows[0].countryKey, "印度尼西亚", "Excel UTF-16 tab-separated exports are supported");
assert.equal(utf16Rows[0].effectiveDate, "2026-09-14");

const semicolonRows = csvModule.parseInventoryValueCostCsv("sep=;\r\n产品SKU;CountryCode;成本CNY;成本生效日期\r\nTZKJ-003;RU;1,234.50;2026-09-14");
assert.equal(semicolonRows[0].unitCostCny, 1234.5, "semicolon-separated Excel exports and header aliases are supported");

const gbkBytes = Buffer.from("U0tVLLn6vNK0+sLrLMjLw/Gx0rWlzruzybG+LMn60KfI1cbaDQpUWktKLTAwNCxWTiw2LjUsMjAyNi0wOS0xNA==", "base64");
const gbkRows = csvModule.parseInventoryValueCostCsv(csvModule.decodeInventoryValueCsv(gbkBytes));
assert.equal(gbkRows[0].sku, "TZKJ-004", "Windows Excel GBK CSV exports are supported");
assert.equal(gbkRows[0].countryKey, "VN");

const compactDateRows = csvModule.parseInventoryValueCostCsv("SKU,国家代码,人民币单位成本,生效日期\r\nTZKJ-005,RU,11.97,2026/9/14");
assert.equal(compactDateRows[0].effectiveDate, "2026-09-14", "single-digit Excel month and day values are zero-padded");
assert.equal(normalizeInventoryValueEffectiveDate("2026/9/14"), "2026-09-14", "the API applies the same date normalization as the browser");
assert.equal(normalizeInventoryValueEffectiveDate("2026-9-4 00:00:00"), "2026-09-04");

const materializedLedgerValue = buildInventoryValuePayload({
  snapshots: [{
    date: "2026-11-10",
    rows: [{
      materializedValuation: true,
      warehouseId: "WH-ID",
      warehouseName: "印尼仓",
      country: "ID",
      sku: "SKU-A",
      productName: "Frozen historical value",
      availableQty: 8,
      lockedQty: 0,
      inTransitQty: 2,
      faultyQty: 1,
      temporaryQty: 3,
      unitCostCny: 7,
      costBasis: "effective_dated_manual_cost",
      costEffectiveDate: "2026-10-01",
      rateEffectiveDate: "2026-11-10",
    }],
  }],
  products: { catalog: [{ sku: "SKU-A", country: "ID", directPrice: 999, directCurrency: "CNY" }] },
  filters: { period: "day" },
});
assert.equal(materializedLedgerValue.basis, "materialized_daily_ledger");
assert.equal(materializedLedgerValue.summary.onHandValueCny, 56, "materialized history is not repriced with the current catalog cost");
assert.equal(materializedLedgerValue.rows[0].costEffectiveDate, "2026-10-01");

console.log("inventory value tests passed");
