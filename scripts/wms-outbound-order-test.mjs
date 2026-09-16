import assert from "node:assert/strict";
import { createWarehouseOutboundOrder, findWarehouseOutboundOrder, warehouseOutboundCreateCapability } from "../server/wms-adapters.js";

function xmlResponse(payload) {
  const escaped = JSON.stringify(payload)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return `<SOAP-ENV:Envelope><SOAP-ENV:Body><response>${escaped}</response></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
}

function extractRequest(body) {
  const service = body.match(/<service>(.*?)<\/service>/)?.[1] || "";
  const paramsText = body.match(/<paramsJson>(.*?)<\/paramsJson>/)?.[1] || "{}";
  const params = JSON.parse(paramsText.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
  return { service, params };
}

const connection = {
  id: "ru-wh-1",
  name: "俄罗斯1仓",
  providerId: "yunwms_ru",
  country: "俄罗斯",
  status: "已启用",
  baseUrl: "https://wms.example.test/service",
  warehouseCode: "RU01",
  credentials: { appKey: "app-key", token: "app-token" },
};
assert.equal(warehouseOutboundCreateCapability(connection).configured, true);
assert.equal(warehouseOutboundCreateCapability({ providerId: "sea_wms" }).supported, false);

const originalFetch = globalThis.fetch;
const requests = [];
try {
  globalThis.fetch = async (_url, options = {}) => {
    const request = extractRequest(String(options.body || ""));
    requests.push(request);
    const payload = request.service === "getOrderByRefCode"
      ? { ask: "Failure", message: "not found" }
      : { ask: "Success", order_code: "RU-OUT-1001" };
    return { ok: true, status: 200, text: async () => xmlResponse(payload) };
  };
  const created = await createWarehouseOutboundOrder(connection, {
    referenceNo: "10000001-0001-1",
    orderNumber: "10000001-0001",
    shopName: "Ozon 旗舰店",
    shippingMethod: "OZON_FBS",
    recipient: { countryCode: "RU", city: "Moscow", address1: "FBS point", zipcode: "123456", name: "Ozon FBS", phone: "+79990000000" },
    saleAmount: 1598,
    currency: "RUB",
    lines: [{ sku: "TZKJ-NK001", quantity: 2, productName: "NatureKiss 脱毛膏", offerId: "TZKJ-NK001", unitPrice: 799 }],
  });
  assert.equal(created.orderNo, "RU-OUT-1001");
  assert.equal(created.duplicate, false);
  assert.deepEqual(requests.map((request) => request.service), ["getOrderByRefCode", "createOrder"]);
  assert.equal(requests[1].params.reference_no, "10000001-0001-1");
  assert.equal(requests[1].params.warehouse_code, "RU01");
  assert.equal(requests[1].params.verify, 1);
  assert.deepEqual(requests[1].params.items, [{
    product_sku: "TZKJ-NK001",
    quantity: 2,
    product_name: "NatureKiss 脱毛膏",
    product_name_en: "NatureKiss 脱毛膏",
    product_declared_value: 799,
    reference_no: "TZKJ-NK001",
  }]);

  requests.length = 0;
  globalThis.fetch = async (_url, options = {}) => {
    requests.push(extractRequest(String(options.body || "")));
    return { ok: true, status: 200, text: async () => xmlResponse({ ask: "Success", data: { order_code: "RU-OUT-EXISTS" } }) };
  };
  const duplicate = await createWarehouseOutboundOrder(connection, {
    referenceNo: "10000001-0001-1",
    shippingMethod: "OZON_FBS",
    recipient: { address1: "FBS point", zipcode: "123456", name: "Ozon FBS", phone: "+79990000000" },
    lines: [{ sku: "TZKJ-NK001", quantity: 2 }],
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.orderNo, "RU-OUT-EXISTS");
  assert.deepEqual(requests.map((request) => request.service), ["getOrderByRefCode"], "existing reference must stop before createOrder");

  requests.length = 0;
  globalThis.fetch = async (_url, options = {}) => {
    requests.push(extractRequest(String(options.body || "")));
    return { ok: true, status: 200, text: async () => xmlResponse({
      ask: "Success",
      data: {
        order_code: "RU-OZON-EXISTS",
        order_status: "D",
        platform: "OZON",
        platform_shop: "FXYZ_RUOZ6005_5610463",
        warehouse_code: "MX001",
        shipping_method: "MXZFH",
        items: [{ product_sku: "TZKJ-RU-0016", quantity: 1 }],
      },
    }) };
  };
  const linked = await findWarehouseOutboundOrder(connection, "0187062354-0015-1");
  assert.equal(linked.found, true);
  assert.equal(linked.orderNo, "RU-OZON-EXISTS");
  assert.equal(linked.platform, "OZON");
  assert.equal(linked.platformShop, "FXYZ_RUOZ6005_5610463");
  assert.deepEqual(linked.items, [{ sku: "TZKJ-RU-0016", quantity: 1 }]);
  assert.deepEqual(requests.map((request) => request.service), ["getOrderByRefCode"], "read-only lookup must never call createOrder");

  requests.length = 0;
  globalThis.fetch = async (_url, options = {}) => {
    requests.push(extractRequest(String(options.body || "")));
    return { ok: true, status: 200, text: async () => xmlResponse({ ask: "Failure", message: "order not found" }) };
  };
  const missing = await findWarehouseOutboundOrder(connection, "0190626839-0049-1");
  assert.equal(missing.found, false);
  assert.equal(missing.orderNo, "");
  assert.deepEqual(requests.map((request) => request.service), ["getOrderByRefCode"], "missing orders must remain a read-only result");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("wms outbound order tests passed");
