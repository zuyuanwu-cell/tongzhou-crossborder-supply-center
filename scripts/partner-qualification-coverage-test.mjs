import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inventoryProjectionSchema } from "../collaboration/shared/contracts.js";
import { sanitizeQualificationCoverage } from "../server/collaboration-bridge.js";

const coverage = sanitizeQualificationCoverage({
  status: "warning",
  covered: true,
  coveredCategoryCount: 1,
  registeredCategoryCount: 1,
  cells: [{
    category: "印尼本土BPOM",
    status: "warning",
    activeRecords: 1,
    nearestExpiryDate: "2026-12-20",
    nearestDaysLeft: 62,
    records: [{
      id: "qualification-1",
      qualificationName: "印尼本土注册",
      issuer: "internal certificate number",
      effectiveDate: "2025-01-01",
      expiryDate: "2026-12-20",
      remark: "internal only",
      files: [{ id: "file-1", fileId: "secret", url: "https://secret.example.test/certificate.pdf" }],
    }],
  }],
});

assert.deepEqual(coverage.cells[0].records[0], {
  id: "qualification-1",
  qualificationName: "印尼本土注册",
  effectiveDate: "2025-01-01",
  expiryDate: "2026-12-20",
});
const serialized = JSON.stringify(coverage);
for (const forbidden of ["files", "fileId", "url", "remark", "issuer", "secret"]) assert.equal(serialized.includes(forbidden), false, `${forbidden} must not enter the partner projection`);

const projection = inventoryProjectionSchema.parse({
  eventId: "inventory-test-1",
  organizationCode: "warehouse-a",
  warehouseRef: "wms-idn-1",
  warehouseName: "印尼雅加达仓",
  version: 1,
  syncedAt: "2026-10-19T08:00:00.000Z",
  items: [{
    sku: "TZKJ-001",
    productName: "测试产品",
    country: "印度尼西亚",
    category: "个护",
    brand: "同舟",
    availableQuantity: 10,
    lockedQuantity: 2,
    inTransitQuantity: 3,
    qualificationCoverage: coverage,
  }],
});
assert.equal(projection.items[0].qualificationCoverage.status, "warning");
assert.throws(() => inventoryProjectionSchema.parse({
  ...projection,
  items: [{ ...projection.items[0], qualificationCoverage: { ...coverage, files: [] } }],
}), /unrecognized|invalid/i, "strict projection contracts must reject certificate file fields");

const portalSource = readFileSync(new URL("../collaboration/portal/src/App.tsx", import.meta.url), "utf8");
assert.equal(portalSource.includes("qualification-coverage"), false, "the page assertion remains red until the portal task is implemented");

console.log("partner qualification coverage projection tests passed");
