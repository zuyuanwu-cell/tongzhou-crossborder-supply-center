import assert from "node:assert/strict";
import { cancelWarehouseStockupOrder, createWarehouseStockupOrder, previewWarehouseStockupOrder, repairYunAsnCartons } from "../server/wms-adapters.js";

function xmlResponse(payload) {
  const escaped = JSON.stringify(payload).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
  return `<SOAP-ENV:Envelope><SOAP-ENV:Body><response>${escaped}</response></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
}

function extractRequest(body) {
  const service = body.match(/<service>(.*?)<\/service>/)?.[1] || "";
  const paramsText = body.match(/<paramsJson>(.*?)<\/paramsJson>/)?.[1] || "{}";
  const params = JSON.parse(paramsText.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
  return { service, params };
}

const connection = {
  id: "ru-wh-2",
  name: "俄罗斯2仓",
  providerId: "yunwms_ru",
  baseUrl: "https://wms.example.test/default/svc/web-service",
  warehouseCode: "DD002",
  credentials: { appKey: "app-key", token: "app-token" },
};
const input = {
  referenceNo: "FY-20260929-M8P01",
  carrier: "贝加尔",
  transportMode: "海运",
  trackingNo: "TRACK-1",
  eta: "2026-10-15",
  verify: true,
  lines: [{ sku: "TZKJ-QL032", productName: "QLEV 男士脱毛膏", quantity: 14_400, cartonCount: 200, unitsPerCarton: 72 }],
};

const preview = await previewWarehouseStockupOrder(connection, input);
assert.equal(preview.totalBoxes, 200);
assert.equal(preview.totalQuantity, 14_400);
assert.equal(preview.itemCount, 200);
assert.equal(preview.canVerify, true);

const originalFetch = globalThis.fetch;
const requests = [];
try {
  globalThis.fetch = async (_url, options = {}) => {
    const request = extractRequest(String(options.body || ""));
    requests.push(request);
    return { ok: true, status: 200, text: async () => xmlResponse({ ask: "Success", message: "Success", receiving_code: "RVAEE0004-2-410-260930-TEST" }) };
  };
  const created = await createWarehouseStockupOrder(connection, input);
  assert.equal(created.orderNo, "RVAEE0004-2-410-260930-TEST");
  assert.equal(created.createMode, "verified");
  assert.equal(requests[0].service, "createAsn");
  assert.equal(requests[0].params.verify, 1);
  assert.equal(requests[0].params.transit_type, 1);
  assert.equal(requests[0].params.transit_warehouse_code, "DD002");
  assert.equal(requests[0].params.receiving_shipping_type, "5");
  assert.equal(requests[0].params.items.length, 200);
  assert.equal(requests[0].params.items.every((item) => item.quantity === 72), true);

  requests.length = 0;
  let repairReadCount = 0;
  globalThis.fetch = async (_url, options = {}) => {
    const request = extractRequest(String(options.body || ""));
    requests.push(request);
    if (request.service === "modifyAsn") return { ok: true, status: 200, text: async () => xmlResponse({ ask: "Success", message: "Success", receiving_code: "RVAEE0004-2-410-260930-TEST" }) };
    repairReadCount += 1;
    const items = repairReadCount === 1
      ? [{ product_sku: "TZKJ-QL032", quantity: "14400", box_no: "1" }]
      : Array.from({ length: 200 }, (_, index) => ({ product_sku: "TZKJ-QL032", quantity: "72", box_no: String(index + 1) }));
    return { ok: true, status: 200, text: async () => xmlResponse({ ask: "Success", nextPage: "false", data: [{ receiving_code: "RVAEE0004-2-410-260930-TEST", reference_no: input.referenceNo, warehouse_code: "DD002", receiving_status: "C", box_total: repairReadCount === 1 ? "1" : "200", sku_total: "14400", items }] }) };
  };
  const repaired = await repairYunAsnCartons(connection, { ...input, receivingCode: "RVAEE0004-2-410-260930-TEST", verify: false }, { apply: true });
  assert.equal(repaired.applied, true);
  assert.equal(repaired.after.boxTotal, 200);
  assert.equal(repaired.after.itemCount, 200);
  assert.deepEqual(requests.map((request) => request.service), ["getAsnList", "modifyAsn", "getAsnList"]);
  assert.equal(requests[1].params.items.length, 200);

  requests.length = 0;
  let getCount = 0;
  globalThis.fetch = async (_url, options = {}) => {
    const request = extractRequest(String(options.body || ""));
    requests.push(request);
    if (request.service === "cancelAsn") return { ok: true, status: 200, text: async () => xmlResponse({ ask: "Success", message: "取消入库单，操作成功", receiving_code: "RVAEE0004-2-410-260930-TEST" }) };
    getCount += 1;
    const status = getCount === 1 ? "C" : "X";
    return { ok: true, status: 200, text: async () => xmlResponse({ ask: "Success", nextPage: "false", data: [{ receiving_code: "RVAEE0004-2-410-260930-TEST", reference_no: input.referenceNo, warehouse_code: "DD002", receiving_status: status, box_total: "200", sku_total: "14400", items: [] }] }) };
  };
  const cancelled = await cancelWarehouseStockupOrder(connection, { receivingCode: "RVAEE0004-2-410-260930-TEST", referenceNo: input.referenceNo });
  assert.equal(cancelled.after.status, "X");
  assert.deepEqual(requests.map((request) => request.service), ["getAsnList", "cancelAsn", "getAsnList"]);

  requests.length = 0;
  globalThis.fetch = async (_url, options = {}) => {
    const request = extractRequest(String(options.body || ""));
    requests.push(request);
    return { ok: true, status: 200, text: async () => xmlResponse({ ask: "Success", nextPage: "false", data: [{ receiving_code: "RVAEE0004-2-410-260930-TEST", reference_no: input.referenceNo, warehouse_code: "DD002", receiving_status: "Z", box_total: "200", sku_total: "14400", items: [] }] }) };
  };
  await assert.rejects(() => cancelWarehouseStockupOrder(connection, { receivingCode: "RVAEE0004-2-410-260930-TEST", referenceNo: input.referenceNo }), /不能直接撤回/);
  assert.deepEqual(requests.map((request) => request.service), ["getAsnList"]);
  console.log("wms inbound order tests passed");
} finally {
  globalThis.fetch = originalFetch;
}
