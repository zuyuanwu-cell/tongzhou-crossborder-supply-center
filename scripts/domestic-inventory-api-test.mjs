import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { initDomesticInventoryStore } from "../server/domestic-inventory-db.js";
import { createDomesticInventoryService } from "../server/domestic-inventory-service.js";
import { createDomesticInventoryApi } from "../server/domestic-inventory-api.js";

const temp = mkdtempSync(resolve(tmpdir(), "domestic-inventory-api-"));
try {
  const store = await initDomesticInventoryStore(resolve(temp, "inventory.sqlite"));
  const service = createDomesticInventoryService(store);
  const adminAuth = { role: "admin", user: { id: "admin", displayName: "管理员", role: "admin", dataScopes: {} } };
  const warehouse = service.createWarehouse({ code: "CN-TEST", name: "测试成品仓" }, { auth: adminAuth, countries: [], warehouseIds: [], skus: [] }).warehouse;
  let activeAuth = adminAuth;
  const productFixtures = {
    productBase: [
      { id: "base-1", sku: "SKU-1", skuNo: "SKU-1", name: "产品一", unit: "件", barcode: "690001" },
      ...Array.from({ length: 140 }, (_, index) => ({ id: `base-${index + 2}`, sku: `TZKJ-${String(index + 2).padStart(4, "0")}`, name: `同舟产品 ${index + 2}`, unit: "件" })),
    ],
    catalog: [
      { id: "catalog-1", sku: "SKU-1", name: "产品一（目录）", imageUrl: "https://example.com/sku-1.jpg", directCostPrice: 8.5 },
      { id: "catalog-duplicate", sku: " sku-1 ", name: "重复产品一" },
    ],
  };
  const handler = createDomesticInventoryApi({ service, getAuth: () => activeAuth, getProducts: () => productFixtures });

  async function invoke(method, path, auth, body, headers = {}) {
    activeAuth = auth;
    const request = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
    request.method = method;
    request.headers = headers;
    const response = { statusCode: 0, headers: {}, body: "", writeHead(statusCode, nextHeaders) { this.statusCode = statusCode; this.headers = nextHeaders; }, end(chunk = "") { this.body += String(chunk); } };
    const handled = await handler(request, response, new URL(path, "http://localhost"));
    assert.equal(handled, true);
    return { status: response.statusCode, headers: response.headers, payload: response.body ? JSON.parse(response.body) : null };
  }

  const viewer = { role: "direct", user: { id: "viewer", role: "direct", dataScopes: {} } };
  const receiver = { role: "direct", user: { id: "receiver", role: "direct", permissionOverrides: { allow: ["domestic_inventory_receive"], deny: [] }, dataScopes: { warehouseIds: [warehouse.id] } } };
  const distributor = { role: "distributor", user: { id: "dist", role: "distributor", permissionOverrides: { allow: ["domestic_inventory_view", "domestic_inventory_receive"], deny: [] }, dataScopes: {} } };

  const warehousesResponse = await invoke("GET", "/api/domestic-inventory/warehouses", viewer);
  assert.equal(warehousesResponse.status, 200);
  assert.equal(warehousesResponse.headers["Access-Control-Allow-Origin"], "*");
  assert.equal((await invoke("GET", "/api/domestic-inventory/openapi.json", viewer)).payload.openapi, "3.1.0");
  const productOptions = await invoke("GET", "/api/domestic-inventory/products?limit=10000", adminAuth);
  assert.equal(productOptions.status, 200);
  assert.equal(productOptions.payload.total, 141);
  assert.equal(productOptions.payload.products.filter((item) => item.sku === "SKU-1").length, 1);
  assert.equal(productOptions.payload.products.find((item) => item.sku === "SKU-1").imageUrl, "https://example.com/sku-1.jpg");
  assert.equal((await invoke("GET", "/api/domestic-inventory/products?keyword=TZKJ-0141", adminAuth)).payload.total, 1);
  const skuScopedAuth = { role: "direct", user: { id: "sku-scoped", role: "direct", permissionOverrides: { allow: ["domestic_inventory_view"], deny: ["direct_price"] }, dataScopes: { skus: ["SKU-1"] } } };
  const scopedProducts = await invoke("GET", "/api/domestic-inventory/products", skuScopedAuth);
  assert.deepEqual(scopedProducts.payload.products.map((item) => item.sku), ["SKU-1"]);
  assert.equal("directCostPrice" in scopedProducts.payload.products[0], false);
  assert.equal((await invoke("POST", "/api/domestic-inventory/movements", viewer, { warehouseId: warehouse.id, type: "inbound", lines: [{ sku: "SKU-1", productName: "产品一", quantity: 1 }] })).status, 403);
  assert.equal((await invoke("GET", "/api/domestic-inventory", distributor)).status, 403);

  const inbound = await invoke("POST", "/api/domestic-inventory/movements", receiver, {
    warehouseId: warehouse.id,
    type: "inbound",
    referenceNo: "PO-API-1",
    lines: [{ sku: "SKU-1", productName: "产品一", packagingMode: "carton", cartonCount: 2, unitsPerCarton: 10, looseQuantity: 1, quantity: 21, cartonLengthCm: 40, cartonWidthCm: 30, cartonHeightCm: 20, cartonWeightKg: 8, barcode: "690001" }],
  }, { "idempotency-key": "api-inbound-1" });
  assert.equal(inbound.status, 201);
  assert.equal((await invoke("GET", `/api/domestic-inventory/movements/${inbound.payload.movementId}`, receiver)).payload.movement.lines[0].lot.barcode, "690001");
  assert.equal((await invoke("GET", `/api/domestic-inventory/lots?warehouseId=${warehouse.id}&barcode=690001`, receiver)).payload.total, 1);
  const availability = await invoke("GET", `/api/domestic-inventory/stockup-availability?warehouseId=${warehouse.id}&skus=SKU-1`, receiver);
  assert.equal(availability.payload.items[0].cartonProfiles[0].fullCartons, 2);
  console.log("domestic inventory API tests passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
