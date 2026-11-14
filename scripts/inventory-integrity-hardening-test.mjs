import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { initDomesticInventoryStore } from "../server/domestic-inventory-db.js";
import { createDomesticInventoryService } from "../server/domestic-inventory-service.js";

const temp = mkdtempSync(resolve(tmpdir(), "inventory-integrity-hardening-"));
try {
  const dbPath = resolve(temp, "inventory.sqlite");
  let store = await initDomesticInventoryStore(dbPath);
  let service = createDomesticInventoryService(store);
  const context = { auth: { user: { id: "audit-admin", displayName: "审计管理员" } }, countries: [], warehouseIds: [], skus: [] };
  const warehouse = service.createWarehouse({ code: "CN-AUDIT-01", name: "审计测试仓" }, context).warehouse;
  const request = { warehouseId: warehouse.id, type: "inbound", referenceNo: "PO-AUDIT-1", lines: [{ sku: "SKU-AUDIT", productName: "测试品", quantity: 10 }] };
  service.createMovement(request, context, "same-key");
  assert.throws(
    () => service.createMovement({ ...request, referenceNo: "PO-AUDIT-CHANGED", lines: [{ ...request.lines[0], quantity: 11 }] }, context, "same-key"),
    (error) => error?.statusCode === 409 && error?.code === "idempotency_key_conflict",
  );
  store.releaseWriterLock();

  const originalBytes = readFileSync(dbPath);
  writeFileSync(`${dbPath}.bak`, originalBytes);
  writeFileSync(dbPath, Buffer.from("not-a-sqlite-database"));
  store = await initDomesticInventoryStore(dbPath);
  service = createDomesticInventoryService(store);
  assert.equal(service.list({}, context).balances[0].onHandQty, 10, "corrupt primary database must recover from backup without reinitializing inventory");
  store.releaseWriterLock();

  const cacheDir = resolve(temp, "cache");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(resolve(cacheDir, "warehouse-connections.json"), JSON.stringify([
    { id: "warehouse-a", name: "A仓", providerId: "yunwms", baseUrl: "https://example.invalid", appKey: "A", appSecret: "secret" },
    { id: "warehouse-b", name: "B仓", providerId: "yunwms", baseUrl: "https://example.invalid" },
  ]));
  writeFileSync(resolve(cacheDir, "orders-sync.json"), JSON.stringify({ results: [{ warehouseId: "warehouse-b", credentialFallbackFrom: "warehouse-a", orderCount: 17, syncedAt: "2026-11-14T00:00:00.000Z" }] }));
  const audit = spawnSync(process.execPath, [resolve("scripts/warehouse-credential-contamination-audit.mjs"), "--cache-dir", cacheDir], { encoding: "utf8" });
  assert.equal(audit.status, 0, audit.stderr);
  const report = JSON.parse(audit.stdout);
  assert.equal(report.readOnly, true);
  assert.equal(report.automaticCorrection, false);
  assert.equal(report.summary.explicitFallbackEvidence, 1);
  assert.equal(report.summary.historicalRiskOnly, 1);
  assert.equal(report.summary.affectedOrderRows, 17);

  const serverSource = readFileSync(resolve("server/server.js"), "utf8");
  assert.equal(serverSource.includes("credentialFallbackFrom"), false, "production sync code must not borrow credentials from another warehouse");
  assert.match(serverSource, /credentialsIncluded:\s*false/, "warehouse export explicitly declares that credentials are excluded");
  assert.match(serverSource, /warehouseSyncFlights/, "warehouse sync uses a per-warehouse single-flight guard");
  console.log("inventory integrity hardening tests passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
