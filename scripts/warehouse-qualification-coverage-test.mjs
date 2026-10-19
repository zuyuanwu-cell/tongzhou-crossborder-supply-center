import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildWarehouseQualificationCoverage, WarehouseQualificationCoverageError } from "../server/warehouse-qualification-coverage.js";
import { effectivePermissions } from "../server/access-control.js";

const catalog = [
  {
    id: "product-1",
    sku: "TZKJ-ID-001",
    name: "印尼测试商品",
    brand: "同舟",
    category: "个护",
    warehouseBreakdown: [
      { warehouseId: "wh-id", warehouseName: "印尼仓", country: "印度尼西亚", availableQty: 8, lockedQty: 1, inTransitQty: 2, totalQty: 11 },
      { warehouseId: "wh-secret", warehouseName: "未授权仓", country: "印度尼西亚", availableQty: 99, lockedQty: 0, inTransitQty: 0, totalQty: 99 },
    ],
    warehouseSyncedAt: "2026-10-19T08:00:00.000Z",
  },
];
const qualifications = [{
  id: "qualification-1",
  sku: "TZKJ-ID-001",
  productName: "印尼测试商品",
  qualificationCategory: "印尼本土BPOM",
  qualificationName: "印尼本土注册",
  effectiveDate: "2025-01-01",
  expiryDate: "2028-01-01",
  issuer: "不应返回的证书编号",
  files: [{ id: "secret-file", fileId: "secret-file", name: "证书.pdf" }],
}];
const connections = [{ id: "wh-id", name: "印尼仓", country: "印度尼西亚" }];

const result = buildWarehouseQualificationCoverage({
  catalog,
  qualifications,
  connections,
  requestedWarehouseId: "wh-id",
  now: new Date("2026-10-19T00:00:00.000Z"),
});
assert.equal(result.warehouses.length, 1);
assert.equal(result.warehouse.id, "wh-id");
assert.equal(result.products.length, 1);
assert.equal(result.products[0].totalQty, 11);
assert.equal(result.products[0].status, "valid");
assert.equal(result.products[0].cells[0].records[0].expiryDate, "2028-01-01");
assert.equal(JSON.stringify(result).includes("secret-file"), false, "certificate files must never reach the warehouse response");
assert.equal(JSON.stringify(result).includes("不应返回的证书编号"), false, "certificate identifiers must not reach the warehouse response");

assert.throws(
  () => buildWarehouseQualificationCoverage({ catalog, qualifications, connections, requestedWarehouseId: "wh-secret" }),
  (error) => error instanceof WarehouseQualificationCoverageError && error.statusCode === 403 && error.code === "warehouse_scope_forbidden",
);

const unavailable = buildWarehouseQualificationCoverage({ catalog, qualifications: [], connections, requestedWarehouseId: "wh-id", qualificationAvailable: false });
assert.equal(unavailable.products[0].status, "unavailable");
assert.equal(unavailable.summary.missing, 0, "unavailable data must not be reported as a real qualification gap");
assert.equal(unavailable.completedProducts, 0);

const warehousePermissions = effectivePermissions({ role: "warehouse", permissionOverrides: { allow: [], deny: [] } });
assert.equal(warehousePermissions.includes("warehouse_qualification_coverage"), true);
assert.equal(effectivePermissions({ role: "warehouse", rolePermissions: ["after_sales_warehouse"], permissionOverrides: { allow: [], deny: [] } }).includes("warehouse_qualification_coverage"), true, "persisted warehouse roles receive the new read-only capability");
assert.equal(effectivePermissions({ role: "warehouse", permissionOverrides: { allow: [], deny: ["warehouse_qualification_coverage"] } }).includes("warehouse_qualification_coverage"), false);
assert.equal(effectivePermissions({ role: "distributor", permissionOverrides: { allow: ["warehouse_qualification_coverage"], deny: [] } }).includes("warehouse_qualification_coverage"), false);

const mainCenter = readFileSync(new URL("../src/WarehouseCollaborationCenter.tsx", import.meta.url), "utf8");
const partnerPortal = readFileSync(new URL("../collaboration/portal/src/App.tsx", import.meta.url), "utf8");
const partnerClientApi = readFileSync(new URL("../collaboration/portal/src/api.ts", import.meta.url), "utf8");
const partnerApi = readFileSync(new URL("../collaboration/api/server.js", import.meta.url), "utf8");
assert.match(mainCenter, /qualification_coverage/);
assert.match(mainCenter, /WarehouseQualificationCoveragePage/);
assert.doesNotMatch(partnerPortal, /qualification-coverage/);
assert.doesNotMatch(partnerClientApi, /qualification-coverage/);
assert.doesNotMatch(partnerApi, /collaboration\/v1\/qualification-coverage/);

console.log("warehouse qualification coverage tests passed");
