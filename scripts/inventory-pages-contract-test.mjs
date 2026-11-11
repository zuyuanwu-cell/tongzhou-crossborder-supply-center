import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transform } from "esbuild";

const presetsSource = readFileSync(new URL("../src/date-presets.ts", import.meta.url), "utf8");
const compiled = await transform(presetsSource, { loader: "ts", format: "esm", target: "es2020" });
const presets = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString("base64")}`);
const now = new Date("2026-11-11T08:00:00.000Z");
assert.deepEqual(presets.resolveDatePreset("last3", now, "Asia/Shanghai"), { from: "2026-11-08", to: "2026-11-10" });
assert.deepEqual(presets.resolveDatePreset("lastWeek", now, "Asia/Shanghai"), { from: "2026-11-02", to: "2026-11-08" });
assert.deepEqual(presets.resolveDatePreset("lastMonth", now, "Asia/Shanghai"), { from: "2026-10-01", to: "2026-10-31" });

const reconciliation = readFileSync(new URL("../src/OverseasInventoryReconciliationPage.tsx", import.meta.url), "utf8");
for (const marker of ["数据完整性", "破损率", "已申请未寄出", "未收货账龄", "出库订单差异", "平台订单应发", "账实差异任务", "逐日库存台账"]) assert.equal(reconciliation.includes(marker), true, `reconciliation page must show ${marker}`);
const inventoryValue = readFileSync(new URL("../src/InventoryValuePage.tsx", import.meta.url), "utf8");
for (const marker of ["成本覆盖率", "未计价", "不良库存", "暂存库存", "成本版本"]) assert.equal(inventoryValue.includes(marker), true, `inventory value page must show ${marker}`);
const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
assert.equal(/React\.lazy\(\(\) => import\("\.\/InventoryValuePage"\)/.test(main), true);
assert.equal(/React\.lazy\(\(\) => import\("\.\/OverseasInventoryReconciliationPage"\)/.test(main), true);
assert.equal(/React\.lazy\(\(\) => import\("\.\/WarehouseCollaborationCenter"\)/.test(main), true);
const collaboration = readFileSync(new URL("../src/WarehouseCollaborationCenter.tsx", import.meta.url), "utf8");
assert.equal(/React\.lazy\(\(\) => import\("\.\/AfterSalesCenter"\)/.test(collaboration), true);

console.log("inventory page contract tests passed");
