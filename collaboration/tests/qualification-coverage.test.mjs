import test from "node:test";
import assert from "node:assert/strict";
import { buildPartnerQualificationCoverage } from "../api/repository.js";
import { buildWorkspace } from "../api/workspace.js";

const grants = [
  { resourceType: "warehouse", resourceRef: "wh-a", resourceName: "印尼 A 仓", permissions: ["warehouse.inventory.view"], syncedAt: "2026-10-19T08:00:00.000Z", version: 2, itemCount: 2 },
  { resourceType: "warehouse", resourceRef: "wh-b", resourceName: "印尼 B 仓", permissions: ["warehouse.inventory.view"], syncedAt: "", version: 0, itemCount: 0 },
];
const rows = [
  { warehouse_ref: "wh-a", warehouse_name: "印尼 A 仓", sku: "SKU-VALID", product_name: "有效商品", country: "印度尼西亚", category: "个护", brand: "同舟", available_quantity: 8, locked_quantity: 1, in_transit_quantity: 2, unit: "件", last_core_synced_at: "2026-10-19T08:00:00.000Z", qualification_coverage: { status: "valid", covered: true, coveredCategoryCount: 1, registeredCategoryCount: 1, cells: [{ category: "印尼本土BPOM", status: "valid", activeRecords: 1, nearestExpiryDate: "2028-01-01", nearestDaysLeft: 439, records: [{ id: "q1", qualificationName: "本土注册", effectiveDate: "2025-01-01", expiryDate: "2028-01-01", files: [{ fileId: "must-not-leak" }] }] }] } },
  { warehouse_ref: "wh-a", warehouse_name: "印尼 A 仓", sku: "SKU-OLD", product_name: "旧投影商品", country: "印度尼西亚", category: "个护", brand: "同舟", available_quantity: 3, locked_quantity: 0, in_transit_quantity: 0, unit: "件", last_core_synced_at: "2026-10-18T08:00:00.000Z", qualification_coverage: null },
  { warehouse_ref: "wh-secret", warehouse_name: "未授权仓", sku: "SECRET", product_name: "不可见", available_quantity: 99, locked_quantity: 0, in_transit_quantity: 0, qualification_coverage: { status: "missing", covered: false, coveredCategoryCount: 0, registeredCategoryCount: 0, cells: [] } },
];

test("workspace exposes qualification coverage only with warehouse inventory capability", () => {
  assert.equal(buildWorkspace({ membership: { role: "member" } }, grants).modules.includes("qualification_coverage"), true);
  assert.equal(buildWorkspace({ membership: { role: "member" } }, []).modules.includes("qualification_coverage"), false);
});

test("partner coverage builder enforces the bound warehouse and marks legacy rows unavailable", () => {
  assert.throws(() => buildPartnerQualificationCoverage({ grants, rows, requestedWarehouseRef: "wh-secret" }), (error) => error?.statusCode === 403 && error?.code === "resource_not_granted");
  const result = buildPartnerQualificationCoverage({ grants, rows, requestedWarehouseRef: "wh-a" });
  assert.equal(result.warehouse.id, "wh-a");
  assert.deepEqual(result.products.map((item) => item.sku), ["SKU-OLD", "SKU-VALID"]);
  assert.equal(result.products[0].status, "unavailable");
  assert.equal(result.summary.unavailable, 1);
  assert.equal(result.completedProducts, 1);
  assert.equal(JSON.stringify(result).includes("wh-secret"), false);
  for (const forbidden of ["files", "fileId", "url", "remark", "must-not-leak"]) assert.equal(JSON.stringify(result).includes(forbidden), false);
});

test("partner coverage builder keeps summary scope stable while filtering the product list", () => {
  const result = buildPartnerQualificationCoverage({ grants, rows, requestedWarehouseRef: "wh-a", keyword: "VALID", status: "valid" });
  assert.equal(result.summary.products, 2);
  assert.deepEqual(result.products.map((item) => item.sku), ["SKU-VALID"]);
});
