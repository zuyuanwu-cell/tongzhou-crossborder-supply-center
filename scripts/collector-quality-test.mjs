// 数据质量（采集中心）测试：单元格判定、证据归档、自动补采计划、需要人工处理的事项。
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCollectorQuality, evaluateCell, addDays, siteToday } from "../server/collector-quality.js";

const ziniao = { payAmount: "ziniao", orderCount: "ziniao", visitors: "ziniao", impressions: "ziniao", addToCart: "ziniao", adOnsite: "ziniao" };
const full = { payAmount: 2640200, orderCount: 19, visitors: 3003, impressions: 32765, addToCart: 111, adOnsite: 1609733.48, fieldSources: ziniao };

// ---- 单元格判定 ----
assert.equal(evaluateCell({}).status, "missing");
assert.equal(evaluateCell({ metric: full, evidence: { templateVersion: 2 } }).status, "ok");
assert.equal(evaluateCell({ metric: full, evidence: { templateVersion: 1 } }).status, "refresh", "旧口径访客要重采");
assert.equal(evaluateCell({ metric: full }).status, "refresh", "没有证据的历史采集数据视为旧口径");
assert.equal(evaluateCell({ metric: full, evidence: { templateVersion: 2, pageCheck: { status: "match", fields: {} } } }).status, "verified");
const mismatch = evaluateCell({ metric: { ...full, visitors: 424 }, evidence: { templateVersion: 2, pageCheck: { status: "mismatch", fields: { visitors: { collected: 424, page: 3003, pageText: "3.003", match: false } } } } });
assert.equal(mismatch.status, "error");
assert.match(mismatch.issues[0].message, /访客数：采集 424 \/ 后台页面 3\.003/);
const pending = evaluateCell({ metric: { ...full, impressions: null }, evidence: { templateVersion: 2, notReady: ["impressions"] } });
assert.equal(pending.status, "pending");
assert.equal(evaluateCell({ metric: { ...full, impressions: null }, evidence: { templateVersion: 2 } }).status, "incomplete");
assert.equal(evaluateCell({ metric: { ...full, payAmount: 0 }, evidence: { templateVersion: 2 } }).status, "error", "有订单但金额为 0");
const miaoshou = evaluateCell({ metric: full, evidence: { templateVersion: 2 }, system: { orderCount: 40 } });
assert.equal(miaoshou.status, "warning");
assert.ok(miaoshou.issues.some((issue) => issue.code === "miaoshou_diff"));
assert.equal(evaluateCell({ metric: full, evidence: { templateVersion: 2 }, system: { orderCount: 21 } }).status, "ok", "妙手差几单在容差内");
const verifiedDiff = evaluateCell({ metric: full, evidence: { templateVersion: 2, pageCheck: { status: "match", fields: {} } }, system: { orderCount: 40 } });
assert.equal(verifiedDiff.status, "verified", "页面核对一致时妙手差异只提示");
assert.ok(verifiedDiff.issues.some((issue) => issue.code === "miaoshou_diff"));
const history = Array.from({ length: 10 }, () => ({ visitors: 3000, payAmount: 2600000, impressions: 30000 }));
assert.equal(evaluateCell({ metric: full, evidence: { templateVersion: 2 }, history }).status, "ok");
const anomaly = evaluateCell({ metric: { ...full, visitors: 120 }, evidence: { templateVersion: 2 }, history });
assert.ok(anomaly.issues.some((issue) => issue.code === "anomaly"));
assert.equal(evaluateCell({ metric: { payAmount: 1, orderCount: 1, fieldSources: { payAmount: "import" } } }).status, "error", "只有人工录入、没有采集数据");

// ---- 证据、补采计划 ----
const dir = mkdtempSync(join(tmpdir(), "tz-quality-"));
try {
  // 2026-11-11 14:00 北京时间
  let nowMs = Date.parse("2026-11-11T06:00:00Z");
  const quality = createCollectorQuality({ dir, now: () => nowMs, saveDelayMs: 1 });
  const yesterday = addDays(siteToday("ID", nowMs), -1);
  assert.equal(yesterday, "2026-11-10");
  const evidence = (overrides = {}) => ({ storeId: "s1", storeName: "QLEV", site: "ID", templateVersion: 2, values: { payAmount: 2640200, orderCount: 19, visitors: 3003 }, endpoints: { km: { label: "关键指标", status: 200, data: { result: { hybrid_uv: { value: 3003 } } } } }, pageCheck: { status: "match", date: yesterday, fields: { visitors: { collected: 3003, page: 3003, pageText: "3.003", match: true } } }, ...overrides });
  quality.recordEvidence("node1", [{ shopKey: "k-qlev", shopName: "QLEV", date: yesterday, evidence: evidence() }]);
  assert.equal(quality.attachScreenshot("node1", { storeId: "s1", date: yesterday, base64: Buffer.from("jpeg").toString("base64") }).ok, true);
  assert.equal(quality.attachScreenshot("node1", { storeId: "unknown", date: yesterday, base64: "eA==" }).ok, false);
  const detail = quality.evidenceDetail("k-qlev", yesterday);
  assert.equal(detail.endpoints.km.data.result.hybrid_uv.value, 3003);
  assert.ok(quality.screenshotFile("k-qlev", yesterday));
  // 后续补采没做页面核对但数字相同：沿用核验结果和截图。
  quality.recordEvidence("node1", [{ shopKey: "k-qlev", shopName: "QLEV", date: yesterday, evidence: evidence({ pageCheck: null }) }]);
  assert.equal(quality.evidenceDetail("k-qlev", yesterday).summary.pageCheck.status, "match");
  assert.ok(quality.screenshotFile("k-qlev", yesterday));

  const storeIndex = [
    { nodeId: "node1", nodeName: "云电脑-01", storeId: "s1", storeName: "QLEV", shopKey: "k-qlev", shopName: "QLEV", site: "ID", enabled: true, online: true, running: false, lastStatus: "ok" },
    { nodeId: "node1", nodeName: "云电脑-01", storeId: "s2", storeName: "M&S", shopKey: "k-ms", shopName: "M&S", site: "ID", enabled: true, online: true, running: false, lastStatus: "ok" },
    { nodeId: "node1", nodeName: "云电脑-01", storeId: "s3", storeName: "马来01162491731", shopKey: "", shopName: "", site: "MY", enabled: true, online: true, running: false, lastStatus: "failed", lastMessage: "ZClaw 工具调用失败：因当前账号未绑定设备，请绑定设备 错误码：104" },
  ];
  const metrics = [
    { shopKey: "k-qlev", date: yesterday, ...full },
    // M&S：昨天缺曝光（Shopee 未出数），前天旧口径，再往前 20 天也是旧口径。
    { shopKey: "k-ms", date: yesterday, ...full, impressions: null },
    { shopKey: "k-ms", date: addDays(yesterday, -1), ...full },
    { shopKey: "k-ms", date: addDays(yesterday, -20), ...full },
  ];
  quality.recordEvidence("node1", [{ shopKey: "k-ms", shopName: "M&S", date: yesterday, evidence: evidence({ storeId: "s2", storeName: "M&S", notReady: ["impressions"], pageCheck: null }) }]);
  const evaluation = quality.evaluate({ metrics, storeIndex });
  const qlev = evaluation.rows.find((row) => row.shopKey === "k-qlev");
  assert.equal(qlev.cells[yesterday].status, "verified");
  assert.equal(qlev.cells[addDays(yesterday, -1)].status, "missing");
  const ms = evaluation.rows.find((row) => row.shopKey === "k-ms");
  assert.equal(ms.cells[yesterday].status, "pending");
  assert.equal(ms.cells[addDays(yesterday, -1)].status, "refresh");
  assert.deepEqual(evaluation.legacy, [{ shopKey: "k-ms", date: addDays(yesterday, -20) }]);
  assert.equal(evaluation.stats.yesterday.verified, 1);

  const planned = quality.plan(evaluation);
  assert.equal(planned.actions.length, 1, "同一节点的补采合并成一条命令");
  const action = planned.actions[0];
  assert.equal(action.nodeId, "node1");
  assert.deepEqual(action.storeIds.sort(), ["s1", "s2"]);
  assert.ok(action.dates.includes(addDays(yesterday, -20)), "旧口径历史也补采");
  assert.ok(action.dates.includes(yesterday));
  assert.ok(planned.manual.some((item) => item.code === "ziniao_device" && item.storeName === "马来01162491731"), "设备未绑定列为人工处理");
  quality.recordAttempts(action.keys, { nodeId: "node1", commandId: "cmd1" });

  // 刚补采过：90 分钟内不再派；节点上还有未完成命令也不派。
  assert.equal(quality.plan(quality.evaluate({ metrics, storeIndex })).actions.length, 0);
  nowMs += 2.5 * 3600 * 1000;
  assert.equal(quality.plan(quality.evaluate({ metrics, storeIndex }), { activeCommands: () => [{ id: "x" }] }).actions.length, 0);
  // 旧口径只补采一次；缺失、未出数可以继续。
  const again = quality.plan(quality.evaluate({ metrics, storeIndex }));
  assert.equal(again.actions.length, 1);
  assert.ok(!again.actions[0].dates.includes(addDays(yesterday, -20)));
  // 节点正在采集：等它写完。
  assert.equal(quality.plan(quality.evaluate({ metrics, storeIndex: storeIndex.map((store) => ({ ...store, running: true })) })).actions.length, 0);
  // 节点离线：列为人工处理。
  const offline = quality.plan(quality.evaluate({ metrics, storeIndex: storeIndex.map((store) => ({ ...store, online: false })) }));
  assert.equal(offline.actions.length, 0);
  assert.ok(offline.manual.some((item) => item.code === "node_offline"));
  // 补采次数用完：列为人工处理。
  for (let i = 0; i < 3; i += 1) quality.recordAttempts([{ key: `k-qlev|${addDays(yesterday, -1)}`, reason: "missing" }], { nodeId: "node1" });
  const exhausted = quality.plan(quality.evaluate({ metrics, storeIndex }));
  assert.ok(exhausted.manual.some((item) => item.code === "exhausted" && item.shopKey === "k-qlev"));

  // 北京时间 10 点前不补采最近一天（让定时采集先跑）。
  const early = createCollectorQuality({ dir: mkdtempSync(join(tmpdir(), "tz-quality-early-")), now: () => Date.parse("2026-11-11T00:30:00Z") });
  const earlyPlan = early.plan(early.evaluate({ metrics: [], storeIndex: storeIndex.slice(0, 1) }));
  assert.ok(!earlyPlan.actions.some((item) => item.dates.includes("2026-11-10")));
  assert.ok(earlyPlan.actions[0].dates.includes("2026-11-09"));

  // 设置
  assert.equal(quality.updateSettings({ autoBackfill: false, windowDays: 99 }).windowDays, 31);
  assert.deepEqual(quality.nodeSettings(), { pageCheck: true, screenshot: true });
  quality.flush();
  const reloaded = createCollectorQuality({ dir, now: () => nowMs });
  assert.equal(reloaded.settings().autoBackfill, false);
  assert.equal(reloaded.evidenceDetail("k-qlev", yesterday).summary.pageCheck.status, "match");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("collector quality tests passed");
