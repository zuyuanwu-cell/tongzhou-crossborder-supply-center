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
  const handler = createDomesticInventoryApi({ service, getAuth: () => activeAuth });

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
