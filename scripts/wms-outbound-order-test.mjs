import assert from "node:assert/strict";
import { createWarehouseOutboundOrder, findWarehouseOutboundOrder, updateAndVerifyWarehouseOutboundOrder, warehouseOutboundCreateCapability } from "../server/wms-adapters.js";

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

function fakeResponse(body, { status = 200, headers = {} } = {}) {
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) { return normalized[String(name).toLowerCase()] || null; },
      getSetCookie() {
        const value = normalized["set-cookie"];
        return value ? (Array.isArray(value) ? value : [value]) : [];
      },
    },
    text: async () => typeof body === "string" ? body : JSON.stringify(body),
  };
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
  let verificationLookup = 0;
  globalThis.fetch = async (_url, options = {}) => {
    const request = extractRequest(String(options.body || ""));
    requests.push(request);
    if (request.service === "modifyOrder") {
      return { ok: true, status: 200, text: async () => xmlResponse({ ask: "Success", order_code: "RU-OZON-REVIEW" }) };
    }
    verificationLookup += 1;
    const verified = verificationLookup > 1;
    return { ok: true, status: 200, text: async () => xmlResponse({
      ask: "Success",
      data: {
        order_code: "RU-OZON-REVIEW",
        reference_no: "0190626839-0049-1",
        order_status: verified ? "W" : "C",
        platform: "OZON",
        platform_shop: "FXYZ_RUOZ6005_5610463",
        warehouse_code: "MX001",
        shipping_method: "MXZFH",
        consignee_country_code: "RU",
        consignee_state: "Moscow",
        consignee_city: "Moscow",
        consignee_address1: "Ozon FBS address",
        consigne_zipcode: "101000",
        consignee_name: "Ozon buyer",
        consignee_phone: "+79990000000",
        items: [{ product_sku: verified ? "TZKJ-RU-0016" : "5540761202", quantity: 1 }],
      },
    }) };
  };
  const verified = await updateAndVerifyWarehouseOutboundOrder(connection, {
    referenceNo: "0190626839-0049-1",
    platformShop: "FXYZ_RUOZ6005_5610463",
    warehouseCode: "MX001",
    shippingMethod: "MXZFH",
    lines: [{ sku: "TZKJ-RU-0016", quantity: 1, productName: "测试商品", offerId: "TZKJ-RU-0016*1", unitPrice: 799 }],
  });
  assert.equal(verified.verified, true);
  assert.equal(verified.status, "W");
  assert.deepEqual(requests.map((request) => request.service), ["getOrderByRefCode", "modifyOrder", "getOrderByRefCode"]);
  assert.deepEqual(requests[1].params.items, [{
    product_sku: "TZKJ-RU-0016",
    quantity: 1,
    product_name: "测试商品",
    product_name_en: "测试商品",
    product_declared_value: 799,
    reference_no: "TZKJ-RU-0016*1",
  }]);
  assert.equal(requests[1].params.verify, 1);
  assert.equal(requests[1].params.forceVerify, 0);
  assert.equal(requests[1].params.warehouse_code, "MX001");
  assert.equal(requests[1].params.shipping_method, "MXZFH");

  requests.length = 0;
  let generatedLookup = 0;
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = new URL(String(url));
    const body = String(options.body || "");
    if (requestUrl.pathname === "/default/svc/web-service") {
      const request = extractRequest(body);
      requests.push({ kind: "soap", ...request });
      if (request.service === "getOrderByRefCode") {
        generatedLookup += 1;
        if (generatedLookup === 1) return fakeResponse(xmlResponse({ ask: "Failure", message: "not found" }));
        const verifiedAfterModify = generatedLookup > 2;
        return fakeResponse(xmlResponse({
          ask: "Success",
          data: {
            order_code: "RU-OZON-GENERATED",
            reference_no: "57004853-0264-2",
            order_status: verifiedAfterModify ? "W" : "C",
            platform: "OZON",
            platform_shop: "FXYZ_RUOZ6005_5610463",
            warehouse_code: "MX001",
            shipping_method: "MXZFH",
            consignee_country_code: "RU",
            consignee_city: "Moscow",
            consignee_address1: "Ozon FBS address",
            consigne_zipcode: "101000",
            consignee_name: "Ozon buyer",
            consignee_phone: "+79990000000",
            items: [{ product_sku: verifiedAfterModify ? "TZKJ-RU-0016" : "5540761202", quantity: 1 }],
          },
        }));
      }
      if (request.service === "getAccount") {
        return fakeResponse(xmlResponse({ ask: "Success", data: { company_code: "TZKJ01" } }));
      }
      if (request.service === "getSsoToken") {
        return fakeResponse(xmlResponse({ ask: "Success", data: { userCode: "TZKJ01", token: "one-time-token" } }));
      }
      if (request.service === "modifyOrder") {
        return fakeResponse(xmlResponse({ ask: "Success", order_code: "RU-OZON-GENERATED" }));
      }
      throw new Error(`unexpected SOAP service: ${request.service}`);
    }
    if (requestUrl.pathname === "/default/index/quick-login") {
      requests.push({ kind: "web-login" });
      return fakeResponse("", { status: 302, headers: { location: "/", "set-cookie": "PHPSESSID=session-id; Path=/; HttpOnly" } });
    }
    if (requestUrl.pathname === "/") {
      requests.push({ kind: "web-home" });
      return fakeResponse("<html><title>WMS</title></html>");
    }
    if (requestUrl.pathname === "/platform/order/list/page/1/pageSize/20") {
      const params = new URLSearchParams(body);
      requests.push({ kind: "platform-list", params });
      return fakeResponse({
        state: 1,
        total: "1",
        orderIdArr: ["3800052"],
        data: {
          3800052: {
            order_id: "3800052",
            platform: "ozon",
            order_status: "2",
            refrence_no: "57004853-0264-2",
            user_account: "FXYZ_RUOZ6005_5610463",
          },
        },
      });
    }
    if (requestUrl.pathname === "/platform/order/list") {
      requests.push({ kind: "platform-page" });
      return fakeResponse('<select name="order_allot[warehouse_id]"><option value="0">请选择</option><option value="1" data-code="MX001" selected>俄罗斯1仓 MX001</option></select>');
    }
    if (requestUrl.pathname === "/platform/order-op/verify") {
      const params = new URLSearchParams(body);
      requests.push({ kind: "platform-verify", params, search: requestUrl.search });
      return fakeResponse({ ask: 1, success_count: 1, fail_count: 0, successArr: [{ ref_id: "57004853-0264-2" }], failArr: [] });
    }
    throw new Error(`unexpected WMS web request: ${requestUrl.pathname}`);
  };
  const generated = await updateAndVerifyWarehouseOutboundOrder({ ...connection, baseUrl: "https://wms.example.test" }, {
    referenceNo: "57004853-0264-2",
    platformShop: "FXYZ_RUOZ6005_5610463",
    warehouseCode: "MX001",
    shippingMethod: "MXZFH",
    lines: [{ sku: "TZKJ-RU-0016", quantity: 1, productName: "测试商品", offerId: "TZKJ-RU-0016*1", unitPrice: 799 }],
  });
  assert.equal(generated.verified, true);
  assert.equal(generated.generatedFromPlatformOrder, true);
  assert.equal(generated.orderNo, "RU-OZON-GENERATED");
  assert.equal(requests.find((request) => request.kind === "platform-list").params.get("refrenceNo"), "57004853-0264-2");
  assert.equal(requests.find((request) => request.kind === "platform-verify").params.get("ref_id[]"), "57004853-0264-2");
  assert.equal(requests.find((request) => request.kind === "platform-verify").params.get("order_allot[warehouse_id]"), "1");
  assert.equal(requests.find((request) => request.kind === "platform-verify").params.get("order_allot[shipping_method]"), "MXZFH");
  assert.equal(requests.filter((request) => request.service === "modifyOrder").length, 1);

  requests.length = 0;
  globalThis.fetch = async (_url, options = {}) => {
    requests.push(extractRequest(String(options.body || "")));
    return { ok: true, status: 200, text: async () => xmlResponse({
      ask: "Success",
      data: {
        order_code: "RU-OZON-READY",
        order_status: "W",
        platform: "OZON",
        platform_shop: "FXYZ_RUOZ6005_5610463",
        warehouse_code: "MX001",
        shipping_method: "MXZFH",
        items: [{ product_sku: "TZKJ-RU-0016", quantity: 1 }],
      },
    }) };
  };
  const alreadyVerified = await updateAndVerifyWarehouseOutboundOrder(connection, {
    referenceNo: "0190626839-0049-1",
    platformShop: "FXYZ_RUOZ6005_5610463",
    warehouseCode: "MX001",
    shippingMethod: "MXZFH",
    lines: [{ sku: "TZKJ-RU-0016", quantity: 1 }],
  });
  assert.equal(alreadyVerified.alreadyVerified, true);
  assert.deepEqual(requests.map((request) => request.service), ["getOrderByRefCode"], "already verified orders must never call modifyOrder");

  requests.length = 0;
  globalThis.fetch = async (_url, options = {}) => {
    const request = extractRequest(String(options.body || ""));
    requests.push(request);
    if (request.service === "modifyOrder") {
      return { ok: true, status: 200, text: async () => xmlResponse({ ask: "Success", order_code: "RU-OZON-PENDING" }) };
    }
    return { ok: true, status: 200, text: async () => xmlResponse({
      ask: "Success",
      data: {
        order_code: "RU-OZON-PENDING",
        reference_no: "0190626839-0049-2",
        order_status: "C",
        platform: "OZON",
        platform_shop: "FXYZ_RUOZ6005_5610463",
        warehouse_code: "MX001",
        shipping_method: "MXZFH",
        consignee_country_code: "RU",
        consignee_city: "Moscow",
        consignee_address1: "Ozon FBS address",
        consigne_zipcode: "101000",
        consignee_name: "Ozon buyer",
        consignee_phone: "+79990000000",
        items: [{ product_sku: "5540761202", quantity: 1 }],
      },
    }) };
  };
  const pending = await updateAndVerifyWarehouseOutboundOrder(connection, {
    referenceNo: "0190626839-0049-2",
    platformShop: "FXYZ_RUOZ6005_5610463",
    warehouseCode: "MX001",
    shippingMethod: "MXZFH",
    lines: [{ sku: "TZKJ-RU-0016", quantity: 1 }],
  });
  assert.equal(pending.verified, false);
  assert.equal(pending.pendingConfirmation, true);
  assert.equal(requests.filter((request) => request.service === "modifyOrder").length, 1, "a delayed WMS status must not trigger repeated writes");
  assert.equal(requests.filter((request) => request.service === "getOrderByRefCode").length, 4, "the adapter should stop after bounded confirmation checks");

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
