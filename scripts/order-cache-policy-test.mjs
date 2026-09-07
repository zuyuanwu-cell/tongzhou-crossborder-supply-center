import assert from "node:assert/strict";
import { replaceWarehouseOrderRows, selectWarehouseOrderSnapshot } from "../server/order-cache-policy.js";

const cached = [
  { warehouseId: "warehouse-a", orderId: "old-a-1" },
  { warehouseId: "warehouse-a", orderId: "old-a-2" },
];
const incoming = [{ warehouseId: "warehouse-a", orderId: "new-a-1" }];

assert.deepEqual(
  selectWarehouseOrderSnapshot({ result: { ok: true, orders: incoming }, cachedWarehouseOrders: cached, publishable: true }),
  {
    orders: incoming,
    orderCount: 1,
    liveOrderCount: 1,
    published: true,
    usingPreviousSuccessfulData: false,
  },
  "a complete successful warehouse sync should replace its previous snapshot",
);

for (const result of [
  { ok: false, orders: [] },
  { ok: false, backgroundRunning: true, orders: [] },
  { ok: true, skipped: true, orders: [] },
  { ok: true, orderApiComplete: false, orders: incoming },
]) {
  const selected = selectWarehouseOrderSnapshot({ result, cachedWarehouseOrders: cached, publishable: false });
  assert.deepEqual(selected.orders, cached, "an incomplete warehouse attempt must retain the last successful snapshot");
  assert.equal(selected.published, false);
  assert.equal(selected.usingPreviousSuccessfulData, true);
  assert.equal(selected.orderCount, 2);
}

assert.deepEqual(
  selectWarehouseOrderSnapshot({ result: { ok: false, orders: [] }, cachedWarehouseOrders: [], publishable: false }),
  {
    orders: [],
    orderCount: 0,
    liveOrderCount: 0,
    published: false,
    usingPreviousSuccessfulData: false,
  },
  "a first failed sync should remain unavailable instead of pretending cached data exists",
);

const combined = [
  ...cached,
  { warehouseId: "warehouse-b", orderId: "keep-b-1" },
];
assert.deepEqual(
  replaceWarehouseOrderRows(combined, ["warehouse-a", "resolved-a"], incoming),
  [
    { warehouseId: "warehouse-b", orderId: "keep-b-1" },
    { warehouseId: "warehouse-a", orderId: "new-a-1" },
  ],
  "publishing one warehouse must not affect another warehouse",
);

console.log("order cache policy tests passed");
