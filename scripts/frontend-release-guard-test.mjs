import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tongzhou-frontend-guard-"));
const verifier = path.resolve("scripts/verify-frontend-release.mjs");

function writeDistribution(name, javaScript) {
  const root = path.join(temporaryRoot, name);
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "index.html"), `<!doctype html><html><head><title>同舟供应链中台</title><link rel="stylesheet" href="/assets/main.css"></head><body><script type="module" src="/assets/main.js"></script></body></html>`);
  fs.writeFileSync(path.join(root, "assets/main.js"), javaScript);
  fs.writeFileSync(path.join(root, "assets/main.css"), ".catalog-view-toolbar{}.catalog-grid{}");
  return root;
}

const contractPath = path.join(temporaryRoot, "contract.json");
fs.writeFileSync(contractPath, JSON.stringify({
  applicationTitle: "同舟供应链中台",
  minimums: {
    entryJavaScriptBytes: 1,
    totalJavaScriptBytes: 1,
    totalCssBytes: 1,
  },
  baselineRetention: {
    minimumEntryJavaScriptRatio: 0.5,
    minimumTotalJavaScriptRatio: 0.5,
    minimumTotalCssRatio: 0.5,
    minimumProtectedMarkerRatio: 1,
  },
  features: [{
    id: "protected-ui",
    description: "关键页面",
    allOf: ["经营工作台", "俄罗斯", "汇率", "产品中心", "catalog-view-toolbar", "catalog-grid"],
  }],
  forbiddenText: [],
}, null, 2));

const good = writeDistribution("good", "经营工作台 俄罗斯 汇率 产品中心 catalog-view-toolbar catalog-grid");
const bad = writeDistribution("bad", "经营工作台 俄罗斯 产品中心 catalog-view-toolbar catalog-grid");

try {
  const passing = spawnSync(process.execPath, [verifier, "--candidate", good, "--baseline", good, "--contract", contractPath], { encoding: "utf8" });
  assert.equal(passing.status, 0, passing.stderr || passing.stdout);

  const failing = spawnSync(process.execPath, [verifier, "--candidate", bad, "--baseline", good, "--contract", contractPath], { encoding: "utf8" });
  assert.notEqual(failing.status, 0, "缺少受保护功能的候选包必须被拒绝");
  assert.match(`${failing.stdout}\n${failing.stderr}`, /缺少关键标记：汇率/);

  console.log("frontend release guard tests passed");
} finally {
  const resolvedTemporaryRoot = path.resolve(temporaryRoot);
  const resolvedSystemTemp = path.resolve(os.tmpdir());
  assert.ok(resolvedTemporaryRoot.startsWith(`${resolvedSystemTemp}${path.sep}`));
  fs.rmSync(resolvedTemporaryRoot, { recursive: true, force: true });
}
