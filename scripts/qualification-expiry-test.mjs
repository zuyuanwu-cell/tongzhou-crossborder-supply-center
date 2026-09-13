import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

process.env.TZ = "Asia/Shanghai";

const source = readFileSync(resolve("src/qualification-expiry.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const expiryModule = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const now = new Date("2026-09-13T12:00:00+08:00");

assert.deepEqual(expiryModule.getQualificationExpiryInfo("", now), {
  status: "missing",
  daysLeft: null,
  label: "未维护到期日",
  actionLabel: "请补充有效期",
});
assert.equal(expiryModule.getQualificationExpiryInfo("2026-09-12T16:00:00+08:00", now).status, "expired");
assert.equal(expiryModule.getQualificationExpiryInfo("2026-09-13T23:59:59+08:00", now).label, "今天到期");
assert.equal(expiryModule.getQualificationExpiryInfo("2026-10-13T00:00:00+08:00", now).status, "urgent");
assert.equal(expiryModule.getQualificationExpiryInfo("2026-10-12T16:00:00.000Z", now).daysLeft, 30);
assert.equal(expiryModule.getQualificationExpiryInfo("2026-10-14T00:00:00+08:00", now).status, "warning");
assert.equal(expiryModule.getQualificationExpiryInfo("2026-12-12T00:00:00+08:00", now).status, "warning");
assert.equal(expiryModule.getQualificationExpiryInfo("2026-12-13T00:00:00+08:00", now).status, "valid");
assert.equal(expiryModule.qualificationExpiryRank("2026-09-12T00:00:00+08:00", now), 0);
assert.equal(expiryModule.qualificationExpiryRank("", now), 3);

console.log("qualification expiry tests passed");
