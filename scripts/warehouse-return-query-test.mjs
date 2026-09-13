import assert from "node:assert/strict";
import {
  automaticPlatformReturnDateRange,
  normalizeReturnIdentifier,
  normalizeSeaReturnOrder,
  normalizeYunReturnOrder,
  queryWarehouseReturns,
} from "../server/warehouse-return-query.js";

assert.deepEqual(
  automaticPlatformReturnDateRange(["2026-09-08 10:00:00", "2026-09-09 09:00:00"], new Date("2026-09-13T12:00:00Z")),
  { dateFrom: "2026-09-09", dateTo: "2026-09-13" },
  "platform order lookup derives a bounded range from the latest known order milestone",
);
assert.deepEqual(
  automaticPlatformReturnDateRange(["2026-01-10"], new Date("2026-09-13T12:00:00Z")),
  { dateFrom: "2026-01-10", dateTo: "2026-04-09" },
  "older orders stay inside one automatic 90-day return window",
);

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

function soapResponse(payload, status = 200) {
  const encoded = JSON.stringify(payload)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => `<SOAP-ENV:Envelope><SOAP-ENV:Body><response>${encoded}</response></SOAP-ENV:Body></SOAP-ENV:Envelope>`,
  };
}

const seaConnection = {
  id: "id-shenniu-jakarta",
  name: "印尼神牛雅加达仓",
  country: "印尼",
  providerId: "sea_wms",
  providerName: "斗仓 / 神牛 SEA WMS",
  baseUrl: "https://sea-wms.example.test",
  warehouseId: "90001",
  warehouseCode: "ID-SN-JKT",
  credentials: { appKey: "app-key", appSecret: "app-secret" },
};

const seaRequests = [];
const seaResult = await queryWarehouseReturns(seaConnection, {
  query: "000123",
  queryType: "platform_order",
  lookupAliases: ["WMS-000123"],
  dateFrom: "2026-09-01",
  dateTo: "2026-09-13",
}, {
  fetchImpl: async (url, init) => {
    seaRequests.push({ url, body: JSON.parse(init.body) });
    return jsonResponse({
      result: "success",
      data: {
        list: [
          { returnSn: "RET-WRONG", platformOrderSn: "WMS-000123-X", tab: "finish", goodsSkuList: [] },
          {
            warehouseReturnOrderId: "7788",
            returnSn: "RET-0001",
            platformOrderSn: "WMS-000123",
            trackingNo: "TRACK-001",
            tab: "finish",
            gmtModified: "2026-09-13 08:30:00",
            goodsSkuList: [{
              goodsSkuId: "SKU-ID-1",
              goodsSkuOuterId: "TZKJ-001",
              goodsName: "测试产品",
              quantity: 3,
              signQuantity: 3,
              inStorageQuantity: 2,
              discardQuantity: 1,
              inStorageGoodQuantity: 2,
              inStorageBadQuantity: 1,
              inStorageTemporaryQuantity: 0,
            }],
          },
        ],
      },
    });
  },
});
assert.equal(seaRequests.length, 1, "platform order uses one targeted SEA request");
assert.deepEqual(seaRequests[0].body.thirdOrderSns, ["000123", "WMS-000123"]);
assert.equal(seaRequests[0].body.searchTimeFrom, undefined, "SEA platform order stays targeted even when a fallback date range is supplied");
assert.equal(seaResult.complete, true);
assert.equal(seaResult.orders.length, 1, "aliases remain exact and must not match longer order numbers");
assert.equal(seaResult.orders[0].status, "mixed");
assert.deepEqual(seaResult.orders[0].items[0], {
  id: "SKU-ID-1",
  sku: "TZKJ-001",
  productName: "测试产品",
  imageUrl: "",
  expectedQty: 3,
  receivedQty: 3,
  restockedQty: 2,
  scrappedQty: 1,
  goodQty: 2,
  badQty: 1,
  pendingQty: 0,
  handlingMethod: "",
});

const seaNeedsDate = await queryWarehouseReturns(seaConnection, {
  query: "TRACK-404",
  queryType: "tracking",
}, { fetchImpl: async () => { throw new Error("must not request without a date range"); } });
assert.equal(seaNeedsDate.needsDateRange, true);
assert.equal(seaNeedsDate.pagesRead, 0);

let cursorPage = 0;
const seaIncomplete = await queryWarehouseReturns(seaConnection, {
  query: "TRACK-404",
  queryType: "tracking",
  dateFrom: "2026-09-01",
  dateTo: "2026-09-13",
}, {
  maxPages: 2,
  fetchImpl: async () => {
    cursorPage += 1;
    return jsonResponse({ code: 0, data: { list: [{ returnSn: `RET-${cursorPage}`, trackingNo: `OTHER-${cursorPage}` }], cursor: `cursor-${cursorPage}` } });
  },
});
assert.equal(seaIncomplete.orders.length, 0);
assert.equal(seaIncomplete.complete, false, "page limit must not be reported as a completed not-found query");
assert.equal(seaIncomplete.pagesRead, 2);

const yunConnection = {
  id: "ru-moscow-1",
  name: "莫斯科一仓",
  country: "俄罗斯",
  providerId: "yunwms_ru",
  providerName: "俄罗斯 YunWMS",
  baseUrl: "https://yun-wms.example.test",
  warehouseCode: "RU-MOW-01",
  credentials: { appKey: "app-key", token: "app-token" },
};

const yunServices = [];
const yunResult = await queryWarehouseReturns(yunConnection, {
  query: "R-001",
  queryType: "return_order",
}, {
  fetchImpl: async (_url, init) => {
    const service = init.body.match(/<service>(.*?)<\/service>/)?.[1] || "";
    yunServices.push(service);
    if (service === "getSpecialOrdersList") {
      return soapResponse({ ask: "Success", nextPage: "false", data: [{ return_code: "R-001", refrence_no_platform: "00000991", spo_status: "5" }] });
    }
    return soapResponse({
      ask: "Success",
      data: {
        return_code: "R-001",
        spo_update_time: "2026-09-13 09:20:00",
        items: [
          { product_sku: "RU-SKU-1", back_quantity: 2, received_qty: 2, ok_qty: 0, exception_process_instruction: 1, exception_process_instruction_text: "重新上架" },
          { product_sku: "RU-SKU-2", back_quantity: 1, received_qty: 1, sop_unsellable_qty: 0, exception_process_instruction: 4, exception_process_instruction_text: "销毁" },
        ],
      },
    });
  },
});
assert.deepEqual(yunServices, ["getSpecialOrdersList", "getReturnBill"]);
assert.equal(yunResult.complete, true);
assert.equal(yunResult.orders[0].status, "mixed");
assert.equal(yunResult.orders[0].items[0].restockedQty, 2, "explicit restock falls back to received quantity when good quantity is zero");
assert.equal(yunResult.orders[0].items[1].scrappedQty, 1, "only an explicit destroy instruction becomes scrapped quantity");

const yunBadOnly = normalizeYunReturnOrder({
  return_code: "R-BAD",
  spo_status: "5",
  items: [{ product_sku: "RU-SKU-BAD", received_qty: 2, sop_unsellable_qty: 2 }],
}, yunConnection);
assert.equal(yunBadOnly.items[0].scrappedQty, 0, "unsellable goods are not automatically treated as scrapped");
assert.equal(yunBadOnly.items[0].badQty, 2);
assert.equal(yunBadOnly.status, "received_pending", "unhandled bad goods remain pending instead of being reported as completed disposal");

const normalizedSea = normalizeSeaReturnOrder({ returnSn: "RET-CANCEL", tab: "canceled", goodsSkuList: [] }, seaConnection);
assert.equal(normalizedSea.status, "cancelled");
assert.equal(normalizeReturnIdentifier(" 00\u200b0123 "), "000123", "normalization preserves leading zeros");

const yunNeedsDate = await queryWarehouseReturns(yunConnection, {
  query: "00000991",
  queryType: "platform_order",
}, { fetchImpl: async () => { throw new Error("must not scan YunWMS without warehouse-bounded dates"); } });
assert.equal(yunNeedsDate.needsDateRange, true);

let yunMultiDetails = 0;
const yunMultiple = await queryWarehouseReturns(yunConnection, {
  query: "00000991",
  queryType: "platform_order",
  dateFrom: "2026-09-01",
  dateTo: "2026-09-13",
}, {
  fetchImpl: async (_url, init) => {
    const service = init.body.match(/<service>(.*?)<\/service>/)?.[1] || "";
    if (service === "getSpecialOrdersList") return soapResponse({ ask: "Success", nextPage: "false", data: [
      { return_code: "R-MULTI-1", refrence_no_platform: "00000991", spo_status: "5" },
      { return_code: "R-MULTI-2", refrence_no_platform: "00000991", spo_status: "5" },
      { return_code: "R-NOT-EXACT", refrence_no_platform: "000009910", spo_status: "5" },
    ] });
    yunMultiDetails += 1;
    return soapResponse({ ask: "Success", data: { items: [] } });
  },
});
assert.equal(yunMultiple.orders.length, 2, "all exact matches on the located page are returned for operator review");
assert.equal(yunMultiDetails, 2);

console.log("warehouse-return-query tests passed");
