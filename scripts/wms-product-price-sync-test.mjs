import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  updateWarehouseProductPurchasePrice,
  warehouseProductPriceSyncCapability,
} from "../server/wms-adapters.js";
import { createWmsProductPriceSyncService } from "../server/wms-product-price-sync.js";

const seaConnection = {
  id: "sea-id",
  name: "印尼仓",
  country: "印度尼西亚",
  providerId: "sea_wms",
  baseUrl: "https://wms.example.test",
  warehouseCode: "ID01",
  credentials: { appKey: "key", appSecret: "secret" },
};
const yunConnection = {
  id: "ru-id",
  name: "俄罗斯仓",
  country: "俄罗斯",
  providerId: "yunwms_ru",
  baseUrl: "https://yun.example.test",
  warehouseCode: "DD001",
  credentials: { appKey: "key", appToken: "token" },
};
const disabledConnection = {
  ...seaConnection,
  id: "sea-disabled",
  name: "已停用印尼仓",
  status: "已停用",
};

assert.equal(warehouseProductPriceSyncCapability(seaConnection).supported, true);
assert.equal(warehouseProductPriceSyncCapability(yunConnection).supported, false);

const originalFetch = globalThis.fetch;
let capturedBody = null;
globalThis.fetch = async (_url, options) => {
  capturedBody = JSON.parse(options.body);
  return new Response(JSON.stringify({ success: true }), { status: 200 });
};
try {
  await updateWarehouseProductPurchasePrice(seaConnection, {
    goodsSkuId: "goods-1",
    sku: "TZKJ-TEST001",
    productName: "测试产品",
    purchasePrice: 12.5,
    purchasePriceCurrency: "CNY",
  });
} finally {
  globalThis.fetch = originalFetch;
}
assert.deepEqual(
  Object.keys(capturedBody).filter((key) => key !== "requestTimestamp").sort(),
  ["goodsName", "goodsSkuId", "goodsSkuOuterId", "purchasePrice", "purchasePriceCurrency"].sort(),
);
assert.equal(capturedBody.purchasePrice, 12.5);
assert.equal("productPrice" in capturedBody, false, "must not overwrite declared value");
assert.equal("inventory" in capturedBody, false, "must not send inventory fields");

const tempDir = mkdtempSync(join(tmpdir(), "wms-price-sync-"));
const cachePath = join(tempDir, "store.json");
let currentTime = new Date("2026-11-13T10:00:00.000Z");
const updates = [];
let idSequence = 0;
const products = [
  { sku: "TZKJ-A", name: "产品 A", country: "印度尼西亚", directCostPrice: 12.5, directCostCurrency: "CNY" },
  { sku: "TZKJ-B", name: "产品 B", country: "印度尼西亚", directCostPrice: 0, directCostCurrency: "CNY" },
  { sku: "TZKJ-C", name: "产品 C", country: "印度尼西亚", directCostPrice: 3, directCostCurrency: "USD" },
  { sku: "TZKJ-D", name: "产品 D", country: "印度尼西亚", directCostPrice: 5, directCostCurrency: "CNY" },
  { sku: "TZKJ-D", name: "产品 D 重复", country: "印度尼西亚", directCostPrice: 6, directCostCurrency: "CNY" },
];
const service = createWmsProductPriceSyncService({
  cachePath,
  loadJsonCache: (path) => {
    try { return JSON.parse(readFileSync(path, "utf8")); } catch { return {}; }
  },
  saveJsonCache: (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8"),
  listConnections: () => [seaConnection, yunConnection, disabledConnection],
  listProducts: () => products,
  capabilityFor: warehouseProductPriceSyncCapability,
  fetchWarehouseCatalog: async () => ({
    ok: true,
    products: [
      { goodsSkuId: "goods-a", sku: "TZKJ-A", name: "产品 A", purchasePrice: 10, purchasePriceCurrency: "CNY" },
      { goodsSkuId: "goods-b", sku: "TZKJ-B", name: "产品 B", purchasePrice: 2, purchasePriceCurrency: "CNY" },
      { goodsSkuId: "goods-c", sku: "TZKJ-C", name: "产品 C", purchasePrice: 3, purchasePriceCurrency: "USD" },
      { goodsSkuId: "goods-d", sku: "TZKJ-D", name: "产品 D", purchasePrice: 5, purchasePriceCurrency: "CNY" },
    ],
  }),
  updatePurchasePrice: async (_connection, input) => {
    updates.push(input);
    return { ok: true };
  },
  now: () => new Date(currentTime),
  createId: () => `id-${++idSequence}`,
});

const options = service.options();
assert.equal(options.mapping.sourceField, "直营供货价");
assert.equal(options.mapping.targetField, "WMS 采购价");
assert.equal(options.warehouses.find((item) => item.id === "ru-id").capability.supported, false);
assert.equal(options.warehouses.find((item) => item.id === "sea-disabled").capability.configured, false);
assert.match(options.warehouses.find((item) => item.id === "sea-disabled").capability.message, /已停用/);

const preview = await service.preview({
  warehouseIds: ["sea-id", "ru-id"],
  actorId: "admin-1",
  allowedWarehouseIds: [],
  allowedSkus: [],
  allowedCountries: [],
});
assert.equal(preview.summary.pending, 1);
assert.equal(preview.summary.unchanged, 1);
assert.equal(preview.summary.missing_price, 1);
assert.equal(preview.summary.conflict, 1);
assert.equal(preview.warehouseSummaries.find((item) => item.warehouseId === "ru-id").status, "unsupported");

const disabledPreview = await service.preview({
  warehouseIds: ["sea-disabled"],
  actorId: "admin-1",
  allowedWarehouseIds: [],
  allowedSkus: [],
  allowedCountries: [],
});
assert.equal(disabledPreview.rows.length, 0);
assert.equal(disabledPreview.warehouseSummaries[0].status, "unsupported");

const executed = await service.execute({
  previewToken: preview.previewToken,
  idempotencyKey: "idem-1",
  actorId: "admin-1",
  allowedWarehouseIds: [],
});
assert.equal(executed.ok, true);
assert.equal(executed.summary.succeeded, 1);
assert.equal(updates.length, 1);
assert.equal(updates[0].sku, "TZKJ-A");
assert.equal(updates[0].purchasePrice, 12.5);

const replayed = await service.execute({
  previewToken: preview.previewToken,
  idempotencyKey: "idem-1",
  actorId: "admin-1",
  allowedWarehouseIds: [],
});
assert.equal(replayed.idempotentReplay, true);
assert.equal(updates.length, 1, "idempotent replay must not write WMS twice");

const disableAfterPreview = await service.preview({
  warehouseIds: ["sea-id"],
  actorId: "admin-1",
  allowedWarehouseIds: [],
  allowedSkus: [],
  allowedCountries: [],
});
seaConnection.status = "已停用";
const disabledExecution = await service.execute({
  previewToken: disableAfterPreview.previewToken,
  idempotencyKey: "idem-disabled",
  actorId: "admin-1",
  allowedWarehouseIds: [],
});
assert.equal(disabledExecution.ok, false);
assert.equal(disabledExecution.summary.failed, 1);
assert.equal(updates.length, 1, "a warehouse disabled after preview must not be written");
delete seaConnection.status;

await assert.rejects(
  () => service.preview({ warehouseIds: ["sea-id"], actorId: "admin-1", allowedWarehouseIds: ["ru-id"] }),
  (error) => error?.code === "warehouse_scope_forbidden",
);

currentTime = new Date("2026-11-13T10:11:00.000Z");
await assert.rejects(
  () => service.execute({ previewToken: preview.previewToken, idempotencyKey: "idem-2", actorId: "admin-1", allowedWarehouseIds: [] }),
  (error) => error?.code === "preview_expired",
);

rmSync(tempDir, { recursive: true, force: true });
console.log("wms product price sync tests passed");
