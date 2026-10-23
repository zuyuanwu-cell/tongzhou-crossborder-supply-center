import assert from "node:assert/strict";
import { buildWarehouseDataState, summarizeDataHealth, summarizeOrderAmounts } from "../server/dashboard-summary.js";

const mixed = summarizeOrderAmounts([
  { salesAmount: 100, currency: "CNY", salesAmountValid: true },
  { salesAmount: 20, currency: "usd", salesAmountValid: true },
  { salesAmount: 999, currency: "", salesAmountValid: true },
  { salesAmount: 50, currency: "CNY", salesAmountValid: false },
]);
assert.equal(mixed.displayMode, "multiple");
assert.equal(mixed.displayValue, null);
assert.deepEqual(mixed.amountsByCurrency, [{ currency: "CNY", amount: 100 }, { currency: "USD", amount: 20 }]);
assert.equal(mixed.excludedLines, 2);

const complete = buildWarehouseDataState({
  connection: { id: "complete", name: "完整仓" },
  hasCredentials: true,
  inventoryResult: { ok: true },
  orderResult: { ok: true, orderApiTotal: 100, orderApiReadRows: 100 },
});
assert.equal(complete.complete, true);
assert.equal(complete.completenessLabel, "数据完整");

const partial = buildWarehouseDataState({
  connection: { id: "partial", name: "截断仓" },
  hasCredentials: true,
  inventoryResult: { ok: true },
  orderResult: { ok: true, orderApiTotal: 46259, orderApiReadRows: 20000, orderApiReachedPageLimit: true },
});
assert.equal(partial.complete, false);
assert.equal(partial.completeness, "partial");
assert.equal(partial.completenessLabel, "数据不完整");

const missing = buildWarehouseDataState({ connection: { id: "missing", name: "未配置仓" }, hasCredentials: false });
assert.equal(missing.connection, "unconfigured");
assert.notEqual(missing.completenessLabel, "数据完整");

const health = summarizeDataHealth([complete, partial, missing]);
assert.equal(health.complete, false);
assert.equal(health.incompleteCount, 2);
assert.equal(health.failedCount, 1);
assert.equal(health.partialCount, 1);

console.log("[ok] mixed currencies are never added into one unlabeled amount");
console.log("[ok] truncated and unconfigured warehouses are not marked healthy");
console.log("[ok] overall health reflects the weakest warehouse dependency");
