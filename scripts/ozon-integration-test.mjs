import assert from "node:assert/strict";
import { createOzonIntegrationService, normalizeOzonState } from "../server/ozon-integration.js";

const requests = [];
const fakeFetch = async (url, options = {}) => {
  const body = JSON.parse(options.body || "{}");
  requests.push({ url: String(url), body, headers: options.headers });
  let payload;
  if (String(url).endsWith("/v1/seller/info")) {
    payload = { result: { company: { name: "Ozon 测试卖家" } } };
  } else if (String(url).endsWith("/v1/warehouse/list")) {
    payload = { result: [{ warehouse_id: 9001, name: "Ozon FBS 莫斯科仓", status: "active", is_rfbs: false }] };
  } else if (String(url).endsWith("/v4/posting/fbs/list")) {
    payload = {
      cursor: "",
      has_next: false,
      postings: [{
        posting_number: "10000001-0001-1",
        order_id: "123456789",
        order_number: "10000001-0001",
        status_alias: "awaiting_packaging",
        delivery_schema: "fbs",
        in_process_at: "2026-09-15T01:00:00.000Z",
        cutoff: "2026-09-16T01:00:00.000Z",
        delivery_method: { warehouse_id: "9001", warehouse: "Ozon FBS 莫斯科仓" },
        analytics_data: { warehouse_id: "9001", warehouse: "Ozon FBS 莫斯科仓", city: "Moscow" },
        products: [{
          product_offer_id: "TZKJ-NK001",
          product_id: "778899",
          product_name: "NatureKiss 脱毛膏",
          price: "799.00",
          quantity: 2,
          marketplace_seller_price_currency_code: "RUB",
        }],
        addressee: null,
        customer: null,
        requirements: { products_requiring_mandatory_mark: [], products_requiring_imei: [] },
      }],
    };
  } else {
    throw new Error(`unexpected Ozon request: ${url}`);
  }
  return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
};

const warehouses = [{
  id: "ru-wh-1",
  name: "俄罗斯1仓",
  providerId: "yunwms_ru",
  country: "俄罗斯",
  status: "已启用",
  warehouseCode: "RU01",
}];
const inventory = [{ warehouseId: "ru-wh-1", sku: "TZKJ-NK001", availableQty: 25 }];
let persisted = null;
let pushed = 0;
const service = createOzonIntegrationService({
  initialState: {},
  save: (state) => { persisted = JSON.parse(JSON.stringify(state)); },
  fetchImpl: fakeFetch,
  warehouseConnections: () => warehouses,
  inventory: () => inventory,
  createWmsOrder: async (_warehouse, order) => {
    pushed += 1;
    assert.equal(order.referenceNo, "10000001-0001-1");
    assert.deepEqual(order.lines.map((line) => [line.sku, line.quantity]), [["TZKJ-NK001", 2]]);
    return { orderNo: "WMS-RU-10001", duplicate: false };
  },
  clock: () => new Date("2026-09-15T08:00:00.000Z"),
});

const admin = { id: "admin", username: "admin", displayName: "管理员", role: "admin", dataScopes: { warehouseIds: [] } };
const scopedOperator = { id: "op-1", username: "operator", role: "direct", dataScopes: { warehouseIds: ["ru-wh-1"] } };

const store = service.upsertStore({ name: "Ozon 旗舰店", clientId: "client-123", apiKey: "secret-api-key" }, admin);
assert.equal(store.hasApiKey, true);
assert.equal("apiKey" in store, false, "API payload must never expose the Ozon secret");
assert.equal(store.apiKeyMasked.includes("secret-api-key"), false);

const tested = await service.testStore(store.id);
assert.equal(tested.companyName, "Ozon 测试卖家");
assert.equal(tested.ozonWarehouses[0].id, "9001");
await service.syncStore(store.id);
assert.equal(requests.some((request) => request.url.endsWith("/v4/posting/fbs/list")), true, "current v4 FBS list endpoint is used");
assert.equal(requests.some((request) => request.url.includes("/v3/posting/fbs/list")), false, "deprecated v3 list endpoint is never used");
assert.deepEqual(requests.find((request) => request.url.endsWith("/v4/posting/fbs/list")).body.filter.status, ["awaiting_packaging", "awaiting_deliver"]);
assert.equal(requests[0].headers["Client-Id"], "client-123");
assert.equal(requests[0].headers["Api-Key"], "secret-api-key");

let payload = service.payload(admin);
assert.equal(payload.orders.length, 1);
assert.equal(payload.orders[0].ready, false);
assert.match(payload.orders[0].issues.join("；"), /尚未绑定俄罗斯仓/);

service.saveRoute({
  storeId: store.id,
  ozonWarehouseId: "9001",
  ozonWarehouseName: "Ozon FBS 莫斯科仓",
  warehouseConnectionId: "ru-wh-1",
  shippingMethod: "OZON_FBS",
  recipient: {
    countryCode: "RU",
    city: "Moscow",
    address1: "Ozon FBS delivery point",
    zipcode: "123456",
    name: "Ozon FBS",
    phone: "+79990000000",
  },
}, admin);
payload = service.payload(admin);
assert.match(payload.orders[0].issues.join("；"), /未配置目标仓 SKU/);

service.saveSkuMapping({
  storeId: store.id,
  warehouseConnectionId: "ru-wh-1",
  offerId: "TZKJ-NK001",
  ozonSku: "778899",
  productName: "NatureKiss 脱毛膏",
  wmsSku: "TZKJ-NK001",
}, admin);
payload = service.payload(admin);
assert.equal(payload.orders[0].ready, true);
assert.equal(payload.orders[0].products[0].availableQty, 25);

const reviewed = service.reviewOrder("10000001-0001-1", { note: "SKU 与库存确认无误" }, scopedOperator);
assert.equal(reviewed.review.status, "approved");
const firstPush = await service.pushOrder("10000001-0001-1", scopedOperator);
const secondPush = await service.pushOrder("10000001-0001-1", scopedOperator);
assert.equal(firstPush.push.wmsOrderNo, "WMS-RU-10001");
assert.equal(secondPush.push.wmsOrderNo, "WMS-RU-10001");
assert.equal(pushed, 1, "a reviewed Ozon posting is pushed to WMS only once");
assert.equal(Boolean(persisted), true);

const unauthorized = service.payload({ role: "direct", dataScopes: { warehouseIds: ["ru-wh-2"] } });
assert.equal(unauthorized.orders.length, 0, "scoped users cannot see orders routed to another warehouse");
assert.equal(unauthorized.warehouses.length, 0);

const emptyState = normalizeOzonState({ stores: [{ id: "x", name: "x", clientId: "x", apiKey: "x" }] });
assert.equal(emptyState.updatedAt, "", "missing dates must not become the Unix epoch");
assert.equal(emptyState.stores[0].connectedAt, "");

console.log("ozon integration tests passed");
