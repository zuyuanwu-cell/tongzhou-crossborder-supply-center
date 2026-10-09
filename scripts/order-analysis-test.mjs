import assert from "node:assert/strict";
import { buildOrderAnalysisFromFacts } from "../server/order-analysis.js";

const facts = [
  { providerId: "sea_wms", warehouseId: "my", warehouseName: "神牛马来仓", country: "马来西亚", orderId: "MY-1", sku: "A", quantity: 1, orderDate: "2026-10-09", status: "已出库" },
  { providerId: "sea_wms", warehouseId: "my", warehouseName: "神牛马来仓", country: "马来西亚", orderId: "MY-1", sku: "B", quantity: 2, orderDate: "2026-10-09", status: "已出库" },
  { providerId: "sea_wms", warehouseId: "vn", warehouseName: "斗仓（越南2仓）", country: "越南", orderId: "VN-1", sku: "A", quantity: 3, orderDate: "2026-10-09", status: "已出库" },
  { providerId: "sea_wms", warehouseId: "id", warehouseName: "神牛印尼仓", country: "印度尼西亚", orderId: "ID-1", sku: "C", quantity: 1, orderDate: "2026-10-09", status: "已拦截" },
  { providerId: "sea_wms", warehouseId: "dou", warehouseName: "斗仓（马来1仓）", country: "马来西亚", orderId: "DOU-1", sku: "A", quantity: 9, orderDate: "2026-10-09", status: "已出库" },
  { providerId: "yunwms_ru", warehouseId: "ru", warehouseName: "俄罗斯1仓", country: "俄罗斯", orderId: "RU-1", sku: "R", quantity: 10, orderDate: "2026-10-09", status: "已出库" },
];

const shenniu = buildOrderAnalysisFromFacts({ facts, scope: "shenniu", filters: { dateFrom: "2026-10-09", dateTo: "2026-10-09" } });
assert.equal(shenniu.scope, "shenniu");
assert.equal(shenniu.counts.orderCount, 3);
assert.equal(shenniu.counts.orderLines, 4);
assert.equal(shenniu.counts.quantity, 7);
assert.equal(shenniu.counts.exceptionOrderCount, 1);
assert.deepEqual(shenniu.options.warehouses.map((row) => row.warehouseId).sort(), ["id", "my", "vn"]);

const all = buildOrderAnalysisFromFacts({ facts, scope: "all" });
assert.equal(all.counts.orderCount, 5);

const russia = buildOrderAnalysisFromFacts({ facts, scope: "russia" });
assert.equal(russia.counts.orderCount, 1);

console.log("order analysis scope and reconciliation tests passed");
