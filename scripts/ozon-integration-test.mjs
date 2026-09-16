import assert from "node:assert/strict";
import { createOzonIntegrationService, normalizeOzonState } from "../server/ozon-integration.js";

const posting = (postingNumber, status, offerId) => ({
  posting_number: postingNumber,
  order_id: `order-${postingNumber}`,
  order_number: postingNumber.replace(/-\d+$/, ""),
  status,
  delivery_schema: "fbs",
  in_process_at: "2026-09-15T01:00:00.000Z",
  cutoff: "2026-09-16T01:00:00.000Z",
  delivery_method: { warehouse_id: "9001", warehouse: "Ozon FBS 莫斯科仓" },
  analytics_data: { warehouse_id: "9001", warehouse: "Ozon FBS 莫斯科仓", city: "Moscow" },
  products: [{
    product_offer_id: offerId,
    product_id: `sku-${postingNumber}`,
    product_name: "测试商品",
    price: "799.00",
    quantity: 1,
    marketplace_seller_price_currency_code: "RUB",
  }],
  requirements: { products_requiring_mandatory_mark: [], products_requiring_imei: [] },
});

const requests = [];
const fakeFetch = async (url, options = {}) => {
  const body = JSON.parse(options.body || "{}");
  requests.push({ url: String(url), body, headers: options.headers });
  let payload;
  if (String(url).endsWith("/v1/seller/info")) {
    payload = { result: { company: { name: "Ozon 测试卖家" } } };
  } else if (String(url).endsWith("/v2/warehouse/list")) {
    payload = {
      cursor: "",
      has_next: false,
      warehouses: [{ warehouse_id: 9001, name: "Ozon FBS 莫斯科仓", status: "active", is_rfbs: false }],
    };
  } else if (String(url).endsWith("/v4/posting/fbs/list")) {
    payload = {
      cursor: "",
      has_next: false,
      postings: [
        posting("10000001-0001-1", "awaiting_packaging", "TZKJ-RU-0016**1"),
        posting("10000001-0002-1", "awaiting_deliver", "TZKJ-RU-0016*1"),
        posting("10000001-0003-1", "delivered", "TZKJ-RU-0016"),
      ],
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
  warehouseCode: "MX001",
}];
const inventory = [{ warehouseId: "ru-wh-1", sku: "TZKJ-RU-0016", availableQty: 25 }];
let persisted = null;
const lookupCount = new Map();
const verificationCalls = [];
const service = createOzonIntegrationService({
  initialState: {},
  save: (state) => { persisted = JSON.parse(JSON.stringify(state)); },
  fetchImpl: fakeFetch,
  warehouseConnections: () => warehouses,
  inventory: () => inventory,
  lookupWmsOrder: async (_warehouse, referenceNo) => {
    const count = (lookupCount.get(referenceNo) || 0) + 1;
    lookupCount.set(referenceNo, count);
    const found = referenceNo.endsWith("0002-1") || count > 1;
    const status = referenceNo.endsWith("0002-1") ? "D" : "C";
    return {
      found,
      orderNo: found ? `WMS-${referenceNo}` : "",
      status: found ? status : "",
      platform: found ? "OZON" : "",
      platformShop: found ? "FXYZ_RUOZ6005_5610463" : "",
      warehouseCode: found ? "MX001" : "",
      shippingMethod: found ? "MXZFH" : "",
      items: found ? [{ sku: referenceNo.endsWith("0002-1") ? "TZKJ-RU-0016" : "5540761202", quantity: 1 }] : [],
    };
  },
  verifyWmsOrder: async (_warehouse, input) => {
    verificationCalls.push(input);
    return {
      found: true,
      orderNo: `WMS-${input.referenceNo}`,
      status: "W",
      platform: "OZON",
      platformShop: "FXYZ_RUOZ6005_5610463",
      warehouseCode: "MX001",
      shippingMethod: "MXZFH",
      items: input.lines.map((line) => ({ sku: line.sku, quantity: line.quantity })),
      updated: true,
      verified: true,
    };
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
assert.equal(requests.some((request) => request.url.endsWith("/v4/posting/fbs/list")), true);
assert.equal(requests.some((request) => request.url.includes("/v3/posting/fbs/list")), false);
assert.equal(requests.some((request) => request.url.endsWith("/v2/warehouse/list")), true);
assert.equal(requests.some((request) => request.url.endsWith("/v1/warehouse/list")), false);
assert.deepEqual(requests.find((request) => request.url.endsWith("/v4/posting/fbs/list")).body.filter.statuses, ["awaiting_packaging", "awaiting_deliver"]);
assert.equal("status" in requests.find((request) => request.url.endsWith("/v4/posting/fbs/list")).body.filter, false);
assert.equal(requests[0].headers["Client-Id"], "client-123");
assert.equal(requests[0].headers["Api-Key"], "secret-api-key");

let payload = service.payload(admin);
assert.equal(payload.orders.length, 2, "provider anomalies must not retain delivered orders");
assert.equal(payload.orders.some((order) => order.status === "delivered"), false);

service.saveRoute({
  storeId: store.id,
  ozonWarehouseId: "9001",
  ozonWarehouseName: "Ozon FBS 莫斯科仓",
  warehouseConnectionId: "ru-wh-1",
}, admin);
const mapped = service.autoMap({ storeId: store.id, warehouseConnectionId: "ru-wh-1" }, admin);
assert.equal(mapped.mapped, 2, "explicit *1 and **1 package suffixes should map to the exact base WMS SKU");

payload = service.payload(admin);
const reviewOrder = payload.orders.find((order) => order.postingNumber.endsWith("0001-1"));
const reconcileOrder = payload.orders.find((order) => order.postingNumber.endsWith("0002-1"));
assert.equal(reviewOrder.ready, true);
assert.equal(reviewOrder.products[0].wmsSku, "TZKJ-RU-0016");
assert.equal(reconcileOrder.workflowStage, "reconcile");
assert.equal(reconcileOrder.reconcileReady, true);

const reviewed = service.reviewOrder(reviewOrder.postingNumber, { note: "SKU 与库存确认无误" }, scopedOperator);
assert.equal(reviewed.review.status, "approved");
const waiting = await service.pushOrder(reviewOrder.postingNumber, scopedOperator);
assert.equal(waiting.push.status, "waiting_sync");
assert.equal(waiting.push.wmsOrderNo, "");
const reconciliation = await service.reconcileWaitingOrders({ storeId: store.id }, admin);
assert.deepEqual(reconciliation, { checked: 1, linked: 0, waiting: 1, failed: 0 });
const readyForVerification = service.payload(admin).orders.find((order) => order.postingNumber === reviewOrder.postingNumber);
assert.equal(readyForVerification.linked, false);
assert.equal(readyForVerification.push.status, "ready_for_verification");
assert.equal(readyForVerification.push.wmsStatus, "C");
const linked = await service.verifyOrderInWms(reviewOrder.postingNumber, scopedOperator);
assert.equal(linked.push.status, "linked");
assert.equal(linked.push.wmsOrderNo, `WMS-${reviewOrder.postingNumber}`);
assert.equal(linked.push.platformShop, "FXYZ_RUOZ6005_5610463");
assert.equal(linked.push.wmsStatus, "W");
assert.equal(verificationCalls.length, 1);
assert.deepEqual(verificationCalls[0].lines.map((line) => ({ sku: line.sku, quantity: line.quantity })), [{ sku: "TZKJ-RU-0016", quantity: 1 }]);
assert.equal(lookupCount.get(reviewOrder.postingNumber), 2);
await service.pushOrder(reviewOrder.postingNumber, scopedOperator);
assert.equal(lookupCount.get(reviewOrder.postingNumber), 2, "linked orders must not be queried or created again");
await service.verifyOrderInWms(reviewOrder.postingNumber, scopedOperator);
assert.equal(verificationCalls.length, 1, "verified orders must not be submitted twice");

const directLink = await service.pushOrder(reconcileOrder.postingNumber, scopedOperator);
assert.equal(directLink.linked, true, "awaiting_deliver orders can be reconciled without duplicate review");
assert.equal(directLink.push.wmsOrderNo, `WMS-${reconcileOrder.postingNumber}`);
assert.equal(Boolean(persisted), true);

const unauthorized = service.payload({ role: "direct", dataScopes: { warehouseIds: ["ru-wh-2"] } });
assert.equal(unauthorized.orders.length, 0, "scoped users cannot see orders routed to another warehouse");
assert.equal(unauthorized.warehouses.length, 0);

const emptyState = normalizeOzonState({ stores: [{ id: "x", name: "x", clientId: "x", apiKey: "x" }] });
assert.equal(emptyState.updatedAt, "", "missing dates must not become the Unix epoch");
assert.equal(emptyState.stores[0].connectedAt, "");

console.log("ozon integration tests passed");
