import assert from "node:assert/strict";
import { buildOutboundOrderReconciliation } from "../server/outbound-order-reconciliation.js";

const payload = buildOutboundOrderReconciliation({
  platformOrders: [
    { identity: "P1", platformOrderSn: "ORDER-1", platform: "shopee", shopId: "SHOP-A", orderAmount: 100 },
    { identity: "P2", platformOrderSn: "ORDER-2", platform: "shopee", shopId: "SHOP-A", orderAmount: 80 },
    { identity: "P3", platformOrderSn: "ORDER-3", platform: "shopee", shopId: "SHOP-B", orderAmount: 60 },
    { identity: "P4", platformOrderSn: "ORDER-CANCELLED", platform: "shopee", shopId: "SHOP-B", orderAmount: 999, appOrderStatusText: "cancelled" },
  ],
  platformItems: [
    { orderIdentity: "P1", platformOuterSkuId: "SKU-A", quantity: 2 },
    { orderIdentity: "P2", platformOuterSkuId: "SKU-B", quantity: 3 },
    { orderIdentity: "P3", platformOuterSkuId: "SKU-C", quantity: 1 },
    { orderIdentity: "P4", platformOuterSkuId: "SKU-X", quantity: 99 },
  ],
  wmsOrders: [
    { externalOrderNo: "ORDER-1", orderNo: "WMS-1", warehouseId: "WH-1", sku: "SKU-A", quantity: 2 },
    { externalOrderNo: "ORDER-2", orderNo: "WMS-2", warehouseId: "WH-1", sku: "SKU-B", quantity: 2 },
    { externalOrderNo: "ORDER-X", orderNo: "WMS-X", warehouseId: "WH-1", sku: "SKU-X", quantity: 4 },
  ],
});

assert.equal(payload.summary.expectedQty, 6);
assert.equal(payload.summary.shippedQty, 8);
assert.equal(payload.summary.matchedOrderCount, 1);
assert.equal(payload.summary.missingWmsOrderCount, 1);
assert.equal(payload.summary.missingWmsQty, 1);
assert.equal(payload.summary.quantityMismatchOrderCount, 1);
assert.equal(payload.summary.quantityMismatchQty, -1);
assert.equal(payload.summary.wmsOnlyOrderCount, 1);
assert.equal(payload.summary.wmsOnlyQty, 4);
assert.equal(payload.rows[0].orderNumber, "ORDER-3", "missing WMS orders are prioritized");
assert.equal(payload.rows.find((row) => row.orderNumber === "ORDER-2").status, "quantity_mismatch");

console.log("outbound order reconciliation tests passed");
