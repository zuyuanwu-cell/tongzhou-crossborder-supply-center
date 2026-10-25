import test from "node:test";
import assert from "node:assert/strict";

process.env.SKIP_ENV_FILE = "true";
process.env.COLLABORATION_SECRET_KEY = "test-secret-key-at-least-thirty-two-characters";
process.env.COLLABORATION_INTERNAL_TOKEN = "test-internal-token-at-least-thirty-two-characters";
process.env.HERMES_PARTNER_BRIDGE_SECRET = "bridge-secret-at-least-thirty-two-characters";
process.env.COLLABORATION_PARTNER_AI_BRIDGE_URL = "http://partner-ai.test";

const {
  rankPartnerOrderCandidates,
  scorePartnerOrderCandidate,
  nextPartnerProgressQuestion,
  partnerAiSessionInternals,
} = await import("../api/partner-ai-sessions.js");
const { partnerAiQuickReportEnabledFor } = await import("../api/partner-ai-settings.js");

const orders = [
  {
    id: "order-a",
    orderNo: "JG26102987",
    referenceNo: "JG26102987",
    productName: "SJJ 男士清爽洁面泡沫",
    sku: "TZKJ-SJJ004",
    barcode: "6971234567890",
    aliases: ["男士洁面泡沫", "SJJ洁面"],
    dueAt: "2026-11-08T00:00:00.000Z",
  },
  {
    id: "order-b",
    orderNo: "JG26103102",
    referenceNo: "JG26103102",
    productName: "SJJ 男士清爽洁面泡沫",
    sku: "TZKJ-SJJ004",
    barcode: "6971234567890",
    aliases: ["男士洁面泡沫"],
    dueAt: "2026-11-12T00:00:00.000Z",
  },
  {
    id: "order-c",
    orderNo: "JG26104001",
    productName: "Naturekiss 日本褥疮膏",
    sku: "TZKJ-NK028",
    barcode: "6970000000028",
    aliases: ["日本褥疮膏"],
    dueAt: "2026-11-15T00:00:00.000Z",
  },
];

test("partner quick report matches order number, SKU, barcode and product aliases deterministically", () => {
  assert.equal(rankPartnerOrderCandidates("JG26104001 做完了", orders)[0].id, "order-c");
  assert.equal(rankPartnerOrderCandidates("TZKJ-NK028 现在包装", orders)[0].id, "order-c");
  assert.equal(rankPartnerOrderCandidates("条码 6970000000028", orders)[0].id, "order-c");
  assert.equal(rankPartnerOrderCandidates("日本褥疮膏质检完成", orders)[0].id, "order-c");
});

test("same product across active orders remains ambiguous and is never silently selected", () => {
  const matched = rankPartnerOrderCandidates("男士洁面泡沫现在灌装完成六成", orders);
  assert.deepEqual(matched.map((item) => item.id), ["order-a", "order-b"]);
  assert.ok(matched.every((item) => item.matchedBy === "product"));
});

test("normalized fuzzy product matching tolerates a short recognition typo", () => {
  const result = scorePartnerOrderCandidate("日本褥疮高已经包装", orders[2]);
  assert.ok(result.score >= 60);
  assert.equal(result.matchedBy, "fuzzy_product");
  assert.deepEqual(rankPartnerOrderCandidates("完全无关的牙刷", orders), []);
});

test("progress questions are asked one field at a time and expected date is conditional", () => {
  const missing = partnerAiSessionInternals.requiredMissing({});
  assert.deepEqual(missing, ["stage", "progressPercent"]);
  assert.match(nextPartnerProgressQuestion(missing), /阶段/);
  assert.deepEqual(partnerAiSessionInternals.requiredMissing({ stage: "filling", progressPercent: 60 }), ["expectedCompletionDate"]);
  assert.deepEqual(partnerAiSessionInternals.requiredMissing({ stage: "ready_to_ship", progressPercent: 100 }), []);
});

test("risk language is routed to exception reporting instead of ordinary progress", () => {
  for (const text of ["缺料停产", "测试不合格", "质量问题卡住了"]) {
    assert.equal(partnerAiSessionInternals.RISK_PATTERN.test(text), true);
  }
});

test("quick report pilot access is the intersection of the base and quick-report allowlists", () => {
  const config = {
    enabled: true,
    textEnabled: true,
    voiceEnabled: true,
    organizationIds: ["org-a", "org-b"],
    quickReportOrganizationIds: ["org-b", "org-c"],
  };
  assert.equal(partnerAiQuickReportEnabledFor(config, "org-b", "text"), true);
  assert.equal(partnerAiQuickReportEnabledFor(config, "org-a", "text"), false);
  assert.equal(partnerAiQuickReportEnabledFor(config, "org-c", "text"), false);
});
