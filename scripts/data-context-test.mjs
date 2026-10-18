import assert from "node:assert/strict";
import { createDataContext, withDataContext } from "../collaboration/shared/data-context.js";

const context = createDataContext({
  generatedAt: "2026-10-18T08:00:00+08:00",
  effectiveAt: "invalid",
  source: "live",
  scopeKey: "warehouse_inventory",
  scopeLabel: "印尼仓",
  filters: { country: "ID", active: true, missing: null },
  completeness: "partial",
  coverage: { completed: 12, total: 10, unit: "invalid" },
  isEstimate: true,
});

assert.equal(context.generatedAt, "2026-10-18T00:00:00.000Z");
assert.equal(context.effectiveAt, context.generatedAt, "invalid effective time should fall back to generation time");
assert.equal(context.source, "live");
assert.equal(context.completeness, "partial");
assert.deepEqual(context.coverage, { completed: 10, total: 10, unit: "warehouse" });
assert.deepEqual(context.filters, { country: "ID", active: "true", missing: "" });
assert.equal(context.isEstimate, true);
assert.equal(context.usingPreviousSuccess, false);

const original = { ok: true, rows: [] };
const payload = withDataContext(original, { source: "cache", completeness: "unavailable" });
assert.notEqual(payload, original);
assert.equal(Object.hasOwn(original, "dataContext"), false, "additive response decoration must not mutate legacy payloads");
assert.equal(payload.dataContext.source, "cache");
assert.equal(payload.dataContext.completeness, "unavailable");

console.log("data-context-test: ok");
