import assert from "node:assert/strict";
import {
  createWarehouseProduct,
  warehouseProductCreateCapability,
} from "../server/wms-adapters.js";

function xmlResponse(payload) {
  const escaped = JSON.stringify(payload).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<SOAP-ENV:Envelope><SOAP-ENV:Body><response>${escaped}</response></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
}

function extractYunRequest(body) {
  const service = body.match(/<service>(.*?)<\/service>/)?.[1] || "";
  const paramsText = body.match(/<paramsJson>(.*?)<\/paramsJson>/)?.[1] || "{}";
  return {
    service,
    params: JSON.parse(paramsText.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")),
  };
}

const seaConnection = {
  id: "id-jakarta",
  name: "印尼雅加达仓",
  country: "印度尼西亚",
  providerId: "sea_wms",
  baseUrl: "https://sea.example.test/api/open/erp",
  warehouseId: "56064",
  credentials: { appKey: "sea-key", appSecret: "sea-secret" },
};
const yunConnection = {
  id: "ru-moscow",
  name: "俄罗斯仓",
  country: "俄罗斯",
  providerId: "yunwms_ru",
  baseUrl: "https://yun.example.test/default/svc/web-service",
  warehouseCode: "DD001",
  credentials: { appKey: "yun-key", token: "yun-token" },
};

assert.deepEqual(warehouseProductCreateCapability(seaConnection), {
  supported: true,
  configured: true,
  createMode: "商品 SKU",
  message: "可在 SEA WMS 保存商品 SKU。",
  requiredFields: ["sku", "productName"],
});
assert.equal(warehouseProductCreateCapability(yunConnection).configured, true);
assert.deepEqual(warehouseProductCreateCapability({ providerId: "unknown" }).requiredFields, []);

const product = {
  sku: "TZKJ-IDWG034",
  productName: "测试面霜",
  productNameEn: "Test face cream",
  barcode: "697000000034",
  specification: "50g",
  brand: "同舟",
  imageUrl: "https://files.example.test/product.png",
  purchasePrice: 12.35,
  purchasePriceCurrency: "CNY",
  weightKg: 0.18,
  lengthCm: 8.2,
  widthCm: 8.2,
  heightCm: 6.4,
  hsCode: "3304990099",
  declaredValueUsd: 4.5,
  declaredNameEn: "Face cream",
};

const originalFetch = globalThis.fetch;
const requests = [];
try {
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return { ok: true, status: 200, text: async () => JSON.stringify({ result: "success", data: { goodsSkuId: "goods-sku-34" } }) };
  };
  const seaResult = await createWarehouseProduct(seaConnection, product);
  assert.equal(seaResult.externalId, "goods-sku-34");
  assert.equal(requests[0].url, "https://sea.example.test/api/open/erp/goods/save_single_sku_goods");
  assert.equal(requests[0].options.headers.AppKey, "sea-key");
  assert.ok(requests[0].options.headers.Signature);
  const seaBody = JSON.parse(requests[0].options.body);
  assert.equal(seaBody.goodsSkuOuterId, product.sku);
  assert.equal(seaBody.goodsName, product.productName);
  assert.equal(seaBody.foreignGoodsName, product.productNameEn);
  assert.equal(seaBody.weight, 0.18);
  assert.equal(seaBody.productEnglishName, "Face cream");

  requests.length = 0;
  globalThis.fetch = async (url, options = {}) => {
    const request = extractYunRequest(String(options.body || ""));
    requests.push({ url: String(url), options, request });
    return { ok: true, status: 200, text: async () => xmlResponse({ ask: "Success", message: "Success", product_sku: product.sku }) };
  };
  const yunResult = await createWarehouseProduct(yunConnection, product);
  assert.equal(yunResult.externalId, product.sku);
  assert.equal(requests[0].request.service, "createProduct");
  assert.equal(requests[0].request.params.product_sku, product.sku);
  assert.equal(requests[0].request.params.product_weight, 0.18);
  assert.equal(requests[0].request.params.product_declared_name, "Face cream");
  assert.equal(requests[0].request.params.verify, 0, "WMS 商品先以草稿建档");

  await assert.rejects(
    () => createWarehouseProduct(yunConnection, { ...product, weightKg: 0, heightCm: 0 }),
    /重量.*高度/,
  );
  await assert.rejects(
    () => createWarehouseProduct(seaConnection, { ...product, sku: "" }),
    /SKU/,
  );
  console.log("wms product create tests passed");
} finally {
  globalThis.fetch = originalFetch;
}
