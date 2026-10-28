import assert from "node:assert/strict";
import test from "node:test";
import { normalizePartnerChatReply, normalizePartnerOrderHints, normalizePartnerProgressDraft } from "../server/hermes-partner-draft-api.js";

test("Hermes order hints keep semantic product terms but reject invented identifiers", () => {
  const hints = normalizePartnerOrderHints({
    productTerms: ["男士洁面泡沫", "男士洗面奶", "男士洁面泡沫"],
    brand: "SJJ",
    orderNo: "JG-NOT-IN-SOURCE",
    sku: "SJJ004",
    barcode: "6971234567890",
  }, "SJJ004 的男士洗面奶做到六成");

  assert.deepEqual(hints.terms, ["男士洁面泡沫", "男士洗面奶", "SJJ"]);
  assert.deepEqual(hints.identifiers, { sku: "SJJ004" });
});

test("Hermes order hints cap and sanitize generated search terms", () => {
  const hints = normalizePartnerOrderHints({
    productTerms: ["  洁面  ", "洁面", "a", "面霜", "精华", "防晒", "洗发", "护发", "牙膏", "凝胶"],
  }, "洁面那个做完了");

  assert.equal(hints.terms[0], "洁面");
  assert.equal(hints.terms.includes("a"), false);
  assert.equal(hints.terms.length, 8);
});

test("production reporting extracts concrete milestones instead of requiring a guessed percentage", () => {
  const sourceText = "物料齐全，计划提供产前样：10月27日，计划投产：10月28日，预计交货：11月5日";
  const draft = normalizePartnerProgressDraft({ fields: {}, evidence: [] }, {
    itemType: "production_order",
    allowedStages: ["planning", "material_preparation", "filling", "packaging", "quality_check", "ready_to_ship"],
  }, sourceText);

  assert.deepEqual(draft.fields, {
    materialStatus: "ready",
    preproductionSampleStatus: "scheduled",
    preproductionSampleDate: "2026-10-27",
    productionStatus: "scheduled",
    productionStartDate: "2026-10-28",
    expectedDeliveryDate: "2026-11-05",
    note: sourceText,
  });
  assert.deepEqual(draft.missingFields, []);
  assert.equal("progressPercent" in draft.fields, false);
});

test("a production date in the next clause is not reused as the pre-production sample date", () => {
  const sourceText = "物料齐全，产前样已确认，10月28日正式投产，11月5日交货";
  const draft = normalizePartnerProgressDraft({ fields: {}, evidence: [] }, {
    itemType: "production_order",
    allowedStages: [],
  }, sourceText);

  assert.equal(draft.fields.preproductionSampleStatus, "approved");
  assert.equal(draft.fields.preproductionSampleDate, undefined);
  assert.equal(draft.fields.productionStartDate, "2026-10-28");
  assert.ok(draft.missingFields.includes("preproductionSampleDate"));
});

test("partner chat replies keep the reply but only allow order ids that were sent", () => {
  const orders = [{ id: "order-a" }, { id: "order-b" }];
  const chat = normalizePartnerChatReply({
    reply: "好的～是说 DEVNEN 身体素颜霜那张单吗？物料到齐了没？",
    intent: "ask_order_info",
    orderIds: ["order-a", "order-from-another-org", "order-a"],
  }, orders);
  assert.equal(chat.intent, "ask_order_info");
  assert.deepEqual(chat.orderIds, ["order-a"]);
  assert.match(chat.reply, /DEVNEN/);
});

test("partner chat replies fall back to a safe intent and reject empty replies", () => {
  assert.equal(normalizePartnerChatReply({ reply: "在的，请说。", intent: "delete_everything" }, []).intent, "other");
  assert.throws(() => normalizePartnerChatReply({ reply: "  ", intent: "small_talk" }, []), /有效回复/);
});
