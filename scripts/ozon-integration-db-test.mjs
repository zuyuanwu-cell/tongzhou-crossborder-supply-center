import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initOzonIntegrationStore } from "../server/ozon-integration-db.js";

const directory = mkdtempSync(join(tmpdir(), "tongzhou-ozon-db-"));
const legacyPath = join(directory, "ozon-integration.json");
const dbPath = join(directory, "ozon-integration.sqlite");
const secret = "integration-test-encryption-key-32-bytes";
const plaintextApiKey = "plaintext-api-key-must-not-leak";

try {
  writeFileSync(legacyPath, JSON.stringify({
    version: 2,
    updatedAt: "2026-09-15T08:00:00.000Z",
    stores: [{ id: "legacy-store", name: "旧店铺", clientId: "client-1", apiKey: plaintextApiKey, enabled: true }],
    routes: [{ storeId: "legacy-store", ozonWarehouseId: "9001", warehouseConnectionId: "ru-wh-1" }],
    skuMappings: [{ storeId: "legacy-store", warehouseConnectionId: "ru-wh-1", offerId: "SKU-1", wmsSku: "SKU-1" }],
    orders: [{ postingNumber: "100-1", storeId: "legacy-store", updatedAt: "2026-09-15T08:00:00.000Z" }],
  }), "utf8");

  const first = await initOzonIntegrationStore({ dbPath, legacyPath, encryptionSecret: secret });
  const migrated = first.loadState();
  assert.equal(migrated.stores.length, 1);
  assert.equal(migrated.stores[0].apiKey, plaintextApiKey);
  assert.equal(migrated.stores[0].ownerId || "", "", "legacy stores remain unassigned and therefore admin-only");
  assert.equal(migrated.routes.length, 1);
  assert.equal(migrated.skuMappings.length, 1);
  assert.equal(migrated.orders.length, 1);
  assert.equal(readFileSync(dbPath).includes(Buffer.from(plaintextApiKey)), false, "plaintext Api-Key must never be written to the SQL.js file");
  first.close();

  writeFileSync(legacyPath, JSON.stringify({ stores: [
    { id: "legacy-store", name: "被修改的旧店铺", clientId: "changed", apiKey: "changed-secret" },
    { id: "duplicate-import", name: "不应再次导入", clientId: "changed", apiKey: "changed-secret" },
  ] }), "utf8");
  const second = await initOzonIntegrationStore({ dbPath, legacyPath, encryptionSecret: secret });
  const reopened = second.loadState();
  assert.equal(reopened.stores.length, 1, "restarting must not import the legacy JSON twice");
  assert.equal(reopened.stores[0].name, "旧店铺");
  assert.equal(reopened.stores[0].apiKey, plaintextApiKey);

  reopened.stores[0].name = "SQL 店铺";
  reopened.scheduleRules = [{ id: "rule-1", storeId: "legacy-store", updatedAt: "2026-09-15T09:00:00.000Z" }];
  reopened.scheduleBatches = [{ id: "batch-1", ruleId: "rule-1", storeId: "legacy-store", scheduledFor: "2026-09-15T16:00+08:00", updatedAt: "2026-09-15T09:00:00.000Z" }];
  reopened.taskEvents = [
    { id: "event-1", storeId: "legacy-store", postingNumber: "100-1", updatedAt: new Date().toISOString() },
    { id: "event-old", storeId: "legacy-store", postingNumber: "100-old", updatedAt: "2020-01-15T09:00:00.000Z" },
  ];
  second.saveState(reopened);
  const saved = second.loadState();
  assert.equal(saved.stores[0].name, "SQL 店铺");
  assert.equal(saved.scheduleRules.length, 1);
  assert.equal(saved.scheduleBatches.length, 1);
  assert.equal(saved.taskEvents.length, 1);
  assert.deepEqual(second.archiveStats(), [{ month: "2020-01", entityType: "taskEvents", count: 1 }]);
  assert.equal(readFileSync(dbPath).includes(Buffer.from(plaintextApiKey)), false);
  second.close();

  console.log("ozon integration database tests passed");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
