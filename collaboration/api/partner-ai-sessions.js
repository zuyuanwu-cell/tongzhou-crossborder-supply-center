import { createHash } from "node:crypto";
import { z } from "zod";
import { assertWorkItemPermission, workItemAccessPredicate } from "./access.js";
import { withOrganization } from "./db.js";
import { createPartnerProgressDraft } from "./partner-ai.js";
import { requestPartnerChatReply, requestPartnerOrderHints } from "./partner-ai-bridge.js";
import { jsonbParameter } from "./jsonb-parameter.js";
import { getPartnerAiSettings, partnerAiQuickReportEnabledFor } from "./partner-ai-settings.js";

const ACTIVE_STATES = new Set(["accepted", "in_progress"]);
const SESSION_TTL_MINUTES = 30;
const MAX_SESSION_TEXT = 6_000;
const RISK_PATTERN = /(停产|缺料|断料|不合格|异常|延误|延期|卡住|无法生产|质量问题|测试失败)/u;

const createSchema = z.object({ scenario: z.literal("production_progress").default("production_progress") }).strict();
const messageSchema = z.object({ text: z.string().trim().min(1).max(2_000), transcriptionId: z.string().uuid().optional() }).strict();
const confirmationSchema = z.object({ workItemId: z.string().uuid() }).strict();

function fail(message, statusCode = 400, code = "invalid_partner_ai_session") {
  throw Object.assign(new Error(message), { statusCode, code });
}

function assertContributor(auth) {
  if (!auth?.membership || !["organization_admin", "manager", "operator"].includes(auth.membership.role)) {
    fail("当前岗位无权使用 Hermes 快捷汇报。", 403, "forbidden");
  }
}

async function assertEnabled(auth, mode = "text") {
  const { config } = await getPartnerAiSettings();
  if (!partnerAiQuickReportEnabledFor(config, auth.organization.id, mode)) fail("当前组织尚未开放 Hermes 快捷汇报。", 403, "partner_ai_not_enabled");
  return config;
}

export function normalizePartnerOrderSearch(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function canonicalProductSearch(value) {
  return normalizePartnerOrderSearch(value)
    .replace(/(?:洗面奶|洗脸奶|洗面乳|洁面乳|洁面霜)/gu, "洁面")
    .replace(/(?:泡沫|慕斯)/gu, "慕斯")
    .replace(/褥疮高/gu, "褥疮膏");
}

function characterContainment(left, right) {
  const a = new Set(Array.from(left).filter((value) => /[\p{L}\p{N}]/u.test(value)));
  const b = new Set(Array.from(right).filter((value) => /[\p{L}\p{N}]/u.test(value)));
  if (a.size < 3 || b.size < 3) return { overlap: 0, ratio: 0 };
  let overlap = 0;
  for (const value of a) if (b.has(value)) overlap += 1;
  return { overlap, ratio: overlap / Math.min(a.size, b.size) };
}

function bigrams(value) {
  const input = Array.from(value);
  if (input.length < 2) return new Set(input);
  return new Set(input.slice(0, -1).map((item, index) => `${item}${input[index + 1]}`));
}

function dice(left, right) {
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const value of a) if (b.has(value)) overlap += 1;
  return (2 * overlap) / (a.size + b.size);
}

function values(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value.split(/[，,、;；|]/u);
  return [];
}

export function scorePartnerOrderCandidate(message, candidate, hints = {}) {
  const searches = [
    { value: message, source: "local" },
    ...values(hints?.terms).map((value) => ({ value, source: "hermes" })),
    ...Object.values(hints?.identifiers || {}).map((value) => ({ value, source: "hermes" })),
  ].map((item) => ({ ...item, query: normalizePartnerOrderSearch(item.value) })).filter((item) => item.query);
  if (!searches.length) return { score: 0, matchedBy: "", matchedTerm: "" };
  const exactGroups = [
    ["order", [candidate.orderNo, candidate.referenceNo, candidate.projectCode]],
    ["sku", [candidate.sku, candidate.lineRef, candidate.barcode]],
    ["product", [candidate.productName, ...(candidate.aliases || [])]],
  ];
  const base = { order: 120, sku: 110, product: 100 };
  let best = { score: 0, matchedBy: "", matchedTerm: "" };
  for (const search of searches) {
    const query = search.query;
    for (const [kind, group] of exactGroups) {
      for (const raw of group.filter(Boolean)) {
        const token = normalizePartnerOrderSearch(raw);
        if (token.length < 2) continue;
        const prefix = search.source === "hermes" ? "hermes_" : "";
        if (query === token || query.includes(token)) {
          const score = base[kind] + (search.source === "hermes" ? 2 : 0);
          if (score > best.score) best = { score, matchedBy: `${prefix}${kind}`, matchedTerm: String(search.value) };
          continue;
        }
        if (token.includes(query) && query.length >= (kind === "product" ? 2 : 4)) {
          const score = base[kind] - (kind === "product" ? 4 : 8) + (search.source === "hermes" ? 2 : 0);
          if (score > best.score) best = { score, matchedBy: `${prefix}${kind}`, matchedTerm: String(search.value) };
          continue;
        }
        if (kind === "product" && query.length >= 3 && token.length >= 3) {
          const canonicalQuery = canonicalProductSearch(search.value);
          const canonicalToken = canonicalProductSearch(raw);
          const similarity = dice(canonicalQuery, canonicalToken);
          const containment = characterContainment(canonicalQuery, canonicalToken);
          if (similarity >= 0.32 || (containment.overlap >= 3 && containment.ratio >= 0.5)) {
            const score = Math.round(58 + Math.max(similarity, containment.ratio) * 30) + (search.source === "hermes" ? 2 : 0);
            if (score > best.score) best = { score, matchedBy: `${prefix}fuzzy_product`, matchedTerm: String(search.value) };
          }
        }
      }
    }
  }
  return best;
}

function candidateFromRow(row) {
  const payload = row.public_payload || {};
  const metadata = row.line_metadata || {};
  return {
    id: row.id,
    version: Number(row.version),
    title: row.title,
    orderNo: String(payload.orderNo || row.reference_no || ""),
    referenceNo: String(payload.referenceNo || row.reference_no || ""),
    projectCode: String(payload.projectCode || ""),
    productName: String(row.product_name || payload.productName || row.title || ""),
    sku: String(row.sku || payload.sku || ""),
    lineRef: String(row.line_ref || ""),
    barcode: String(metadata.barcode || payload.barcode || ""),
    aliases: [...values(metadata.aliases), ...values(payload.productAliases), ...values(payload.productAlias)].map(String).filter(Boolean),
    imageUrl: String(row.image_url || payload.productImageUrl || ""),
    quantity: Number(row.planned_quantity || payload.quantity || 0),
    unit: String(row.unit || payload.unit || ""),
    dueAt: row.due_at ? new Date(row.due_at).toISOString() : "",
    currentStage: String(row.current_stage || ""),
    currentProgressPercent: row.current_progress_percent == null ? null : Number(row.current_progress_percent),
    status: row.status,
  };
}

const CONVERSATION_ONLY_INTENTS = new Set(["ask_order_info", "ask_help", "small_talk", "other"]);

// Rebuilds a short transcript for the conversational reply: the partner's recent lines plus the
// assistant's last question (the session keeps only those two, which is enough context).
function conversationFor(session) {
  const partnerLines = String(session.source_text || "").split("\n").map((line) => line.trim()).filter(Boolean).slice(-5);
  const history = partnerLines.map((line) => ({ role: "partner", text: line }));
  if (session.next_question) history.push({ role: "assistant", text: String(session.next_question) });
  return history;
}

function orderSummariesForChat(orders, confirmedWorkItemId) {
  const list = Array.isArray(orders) ? orders : [];
  const confirmed = list.filter((order) => order.id === confirmedWorkItemId);
  const others = list.filter((order) => order.id !== confirmedWorkItemId).slice(0, 15 - confirmed.length);
  return [...confirmed, ...others].map((order) => ({
    id: order.id,
    orderNo: order.orderNo || order.referenceNo,
    productName: order.productName,
    quantity: order.quantity,
    unit: order.unit,
    dueAt: order.dueAt,
    currentStage: order.currentStage,
    currentProgressPercent: order.currentProgressPercent,
  }));
}

const PARTNER_HELP_PATTERN = /(帮我做什么|能做什么|可以做什么|怎么用|你是谁|干什么的|有什么用|帮助)/;

export function rankPartnerOrderCandidates(message, candidates, limit = 5, hints = {}) {
  const byOrder = new Map();
  for (const candidate of candidates) {
    const match = scorePartnerOrderCandidate(message, candidate, hints);
    if (match.score < 60) continue;
    const current = byOrder.get(candidate.id);
    if (!current || match.score > current.matchScore) byOrder.set(candidate.id, { ...candidate, matchScore: match.score, matchedBy: match.matchedBy, matchedTerm: match.matchedTerm });
  }
  return [...byOrder.values()]
    .sort((left, right) => right.matchScore - left.matchScore || String(left.dueAt || "9999").localeCompare(String(right.dueAt || "9999")))
    .slice(0, limit);
}

async function eligibleProductionOrders(client, auth) {
  const result = await client.query(
    `SELECT work_items.*,
            COALESCE(work_items.public_payload->>'referenceNo',work_items.public_payload->>'orderNo','') AS reference_no,
            line.line_ref,line.sku,line.product_name,line.image_url,line.planned_quantity,line.unit,line.metadata AS line_metadata,
            latest.stage AS current_stage,latest.progress_percent AS current_progress_percent
       FROM work_items
       LEFT JOIN partner_order_lines line
         ON line.work_item_id=work_items.id AND line.organization_id=work_items.organization_id
        AND line.active=true AND line.line_type='finished_product'
       LEFT JOIN LATERAL (
         SELECT report.stage,report.progress_percent
           FROM partner_order_reports report
          WHERE report.organization_id=work_items.organization_id
            AND report.work_item_id=work_items.id AND report.report_type='production_progress'
          ORDER BY report.created_at DESC LIMIT 1
       ) latest ON true
      WHERE work_items.organization_id=$1
        AND work_items.item_type='production_order'
        AND work_items.status IN ('accepted','in_progress')
        AND ${workItemAccessPredicate}
        AND EXISTS (
          SELECT 1 FROM organization_access_grants progress_grant
           WHERE progress_grant.organization_id=work_items.organization_id
             AND progress_grant.resource_type='organization'
             AND progress_grant.resource_ref='production'
             AND progress_grant.permissions ? 'production.progress.update'
        )
      ORDER BY work_items.due_at NULLS LAST,work_items.updated_at DESC
      LIMIT 600`,
    [auth.organization.id],
  );
  return result.rows.map(candidateFromRow);
}

async function sessionForUser(client, auth, sessionId, { lock = false, allowExpired = false } = {}) {
  const row = (await client.query(
    `SELECT * FROM partner_ai_sessions
      WHERE id=$1 AND organization_id=$2 AND user_id=$3${lock ? " FOR UPDATE" : ""}`,
    [sessionId, auth.organization.id, auth.user.id],
  )).rows[0];
  if (!row) fail("快捷汇报会话不存在。", 404, "session_not_found");
  if (!allowExpired && (row.state === "expired" || new Date(row.expires_at).getTime() <= Date.now())) {
    if (row.state !== "expired") await client.query("UPDATE partner_ai_sessions SET state='expired' WHERE id=$1", [row.id]);
    fail("快捷汇报会话已过期，请重新开始。", 409, "session_expired");
  }
  return row;
}

function requiredMissing(fields = {}) {
  const missing = [];
  if (!fields.materialStatus) missing.push("materialStatus");
  if (!fields.preproductionSampleStatus) missing.push("preproductionSampleStatus");
  if (["scheduled", "submitted", "approved"].includes(fields.preproductionSampleStatus) && !fields.preproductionSampleDate) missing.push("preproductionSampleDate");
  if (!fields.productionStatus) missing.push("productionStatus");
  if (["scheduled", "started", "completed"].includes(fields.productionStatus) && !fields.productionStartDate) missing.push("productionStartDate");
  if (!fields.expectedDeliveryDate) missing.push("expectedDeliveryDate");
  return missing;
}

export function nextPartnerProgressQuestion(missingFields = []) {
  const field = missingFields[0] || "";
  return {
    materialStatus: "这张加工单的物料和包材齐全了吗？请选择未齐、部分到齐或已齐套。",
    preproductionSampleStatus: "产前样目前是什么状态？请选择未安排、已计划、已提交、已确认或无需产前样。",
    preproductionSampleDate: "计划或实际哪一天提供产前样？",
    productionStatus: "正式生产目前是什么状态？请选择未排产、已排期、已投产或已完工。",
    productionStartDate: "计划或实际哪一天正式投产？",
    expectedDeliveryDate: "预计哪一天可以交货？",
  }[field] || "请核对汇报内容，确认无误后提交。";
}

function sessionPayload(row, extra = {}) {
  return {
    id: row.id,
    scenario: row.scenario,
    state: row.state,
    confirmedWorkItemId: row.confirmed_work_item_id || "",
    confirmedWorkItemVersion: row.confirmed_work_item_version == null ? null : Number(row.confirmed_work_item_version),
    fields: row.collected_fields || {},
    missingFields: row.missing_fields || [],
    warnings: row.warnings || [],
    nextQuestion: row.next_question || "",
    latestDraftId: row.latest_draft_id || "",
    expiresAt: new Date(row.expires_at).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : "",
    ...extra,
  };
}

async function cardsForIds(client, auth, ids, sourceText = "") {
  if (!ids.length) return [];
  const eligible = await eligibleProductionOrders(client, auth);
  const wanted = new Set(ids);
  const unique = new Map();
  for (const candidate of eligible) {
    if (!wanted.has(candidate.id)) continue;
    const match = scorePartnerOrderCandidate(sourceText, candidate);
    const current = unique.get(candidate.id);
    if (!current || match.score > current.matchScore) unique.set(candidate.id, { ...candidate, matchScore: match.score, matchedBy: match.matchedBy });
  }
  return ids.map((id) => unique.get(id)).filter(Boolean);
}

async function createSessionDraft(auth, sessionId, transcriptionId = "") {
  const prepared = await withOrganization(auth.organization.id, async (client) => {
    const session = await sessionForUser(client, auth, sessionId, { lock: true });
    if (!session.confirmed_work_item_id) fail("请先确认要汇报的加工单。", 409, "order_confirmation_required");
    const item = (await client.query("SELECT * FROM work_items WHERE id=$1 AND organization_id=$2", [session.confirmed_work_item_id, auth.organization.id])).rows[0];
    if (!item || item.item_type !== "production_order") fail("加工单已不存在。", 404, "order_not_found");
    await assertWorkItemPermission(client, auth.organization.id, item, "production.progress.update");
    if (!ACTIVE_STATES.has(item.status)) fail("加工单当前状态不能继续汇报。", 409, "invalid_state");
    if (Number(item.version) !== Number(session.confirmed_work_item_version)) {
      await client.query("UPDATE partner_ai_sessions SET state='confirming_order',next_question='订单刚刚有更新，请重新确认后再提交。' WHERE id=$1", [session.id]);
      fail("加工单刚刚有更新，请重新确认最新状态。", 409, "version_conflict");
    }
    const effectiveTranscriptionId = transcriptionId || session.latest_transcription_id || "";
    if (effectiveTranscriptionId) {
      const transcription = (await client.query(
        "SELECT id,status FROM partner_ai_transcriptions WHERE id=$1 AND session_id=$2 AND organization_id=$3 AND user_id=$4",
        [effectiveTranscriptionId, session.id, auth.organization.id, auth.user.id],
      )).rows[0];
      if (!transcription || transcription.status !== "completed") fail("语音转写尚未完成或不属于本次会话。", 409, "transcription_not_completed");
    }
    return { ...session, effectiveTranscriptionId };
  });

  const digest = createHash("sha256").update(`${prepared.id}\n${prepared.source_text}\n${prepared.confirmed_work_item_version}`).digest("hex").slice(0, 32);
  try {
    const generated = await createPartnerProgressDraft(auth, prepared.confirmed_work_item_id, {
      text: prepared.source_text,
      workItemVersion: Number(prepared.confirmed_work_item_version),
    }, { idempotencyKey: `partner-session:${digest}` });
    return withOrganization(auth.organization.id, async (client) => {
      const session = await sessionForUser(client, auth, sessionId, { lock: true });
      const fields = { ...(generated.draft.fields || {}) };
      if (!String(fields.note || "").trim()) fields.note = session.source_text.slice(-2_000);
      const missing = requiredMissing(fields);
      const warnings = [...new Set([...(generated.draft.warnings || []), ...(RISK_PATTERN.test(session.source_text) ? ["exception_report_recommended"] : [])])];
      const state = missing.length ? "collecting_progress" : "review";
      const question = RISK_PATTERN.test(session.source_text)
        ? "识别到缺料、停产或质量异常，请改用异常上报，避免写成普通进度。"
        : nextPartnerProgressQuestion(missing);
      await client.query(
        "UPDATE partner_ai_drafts SET session_id=$2,transcription_id=COALESCE($3,transcription_id),source_type=CASE WHEN $3::uuid IS NULL THEN source_type ELSE 'voice' END WHERE id=$1 AND organization_id=$4 AND user_id=$5",
        [generated.draft.id, session.id, prepared.effectiveTranscriptionId || null, auth.organization.id, auth.user.id],
      );
      const updated = (await client.query(
        `UPDATE partner_ai_sessions SET state=$2,collected_fields=$3,missing_fields=$4,warnings=$5,next_question=$6,latest_draft_id=$7,
          question_count=question_count+CASE WHEN $2='collecting_progress' THEN 1 ELSE 0 END,
          expires_at=now()+($8::text || ' minutes')::interval WHERE id=$1 RETURNING *`,
        [
          session.id,
          state,
          jsonbParameter(fields, {}),
          jsonbParameter(missing, []),
          jsonbParameter(warnings, []),
          question,
          generated.draft.id,
          String(SESSION_TTL_MINUTES),
        ],
      )).rows[0];
      return { ok: true, session: sessionPayload(updated, { draft: generated.draft, exceptionSuggested: warnings.includes("exception_report_recommended") }) };
    });
  } catch (error) {
    if (["version_conflict", "invalid_state", "forbidden", "order_not_found", "transcription_not_completed"].includes(error?.code)) throw error;
    return withOrganization(auth.organization.id, async (client) => {
      const session = await sessionForUser(client, auth, sessionId, { lock: true });
      const fallbackKey = `partner-session-fallback:${digest}`;
      let fallback = (await client.query(
        "SELECT * FROM partner_ai_drafts WHERE organization_id=$1 AND user_id=$2 AND idempotency_key=$3",
        [auth.organization.id, auth.user.id, fallbackKey],
      )).rows[0];
      const fields = { ...(session.collected_fields || {}) };
      if (!String(fields.note || "").trim()) fields.note = session.source_text.slice(-2_000);
      const missing = requiredMissing(fields);
      const warnings = [...new Set(["assistant_unavailable", ...(RISK_PATTERN.test(session.source_text) ? ["exception_report_recommended"] : [])])];
      if (!fallback) {
        fallback = (await client.query(
          `INSERT INTO partner_ai_drafts(
             organization_id,work_item_id,user_id,transcription_id,work_item_version,draft_type,source_type,source_text,
             draft_json,evidence_json,missing_fields,warnings,status,idempotency_key,request_hash,session_id
           ) VALUES ($1,$2,$3,$4,$5,'production_progress',$6,$7,$8,'[]'::jsonb,$9,$10,'generated',$11,$12,$13)
           RETURNING *`,
          [
            auth.organization.id,
            session.confirmed_work_item_id,
            auth.user.id,
            prepared.effectiveTranscriptionId || null,
            Number(session.confirmed_work_item_version),
            prepared.effectiveTranscriptionId ? "voice" : "text",
            session.source_text,
            jsonbParameter(fields, {}),
            jsonbParameter(missing, []),
            jsonbParameter(warnings, []),
            fallbackKey,
            digest,
            session.id,
          ],
        )).rows[0];
      }
      const updated = (await client.query(
        `UPDATE partner_ai_sessions SET state='collecting_progress',collected_fields=$2,missing_fields=$3,
          next_question='Hermes 暂时不可用，原话已保留，可继续手工填写并确认提交。',warnings=$4,latest_draft_id=$5,
          expires_at=now()+($6::text || ' minutes')::interval WHERE id=$1 RETURNING *`,
        [
          session.id,
          jsonbParameter(fields, {}),
          jsonbParameter(missing, []),
          jsonbParameter(warnings, []),
          fallback.id,
          String(SESSION_TTL_MINUTES),
        ],
      )).rows[0];
      return {
        ok: true,
        assistantUnavailable: true,
        session: sessionPayload(updated, {
          draft: {
            id: fallback.id,
            type: fallback.draft_type,
            workItemVersion: Number(fallback.work_item_version),
            fields: fallback.draft_json || {},
            evidence: [],
            missingFields: fallback.missing_fields || [],
            warnings: fallback.warnings || [],
            expiresAt: new Date(fallback.expires_at).toISOString(),
          },
          exceptionSuggested: warnings.includes("exception_report_recommended"),
        }),
      };
    });
  }
}

export async function createPartnerAiSession(auth, input = {}) {
  assertContributor(auth);
  const config = await assertEnabled(auth, "text");
  const parsed = createSchema.parse(input);
  return withOrganization(auth.organization.id, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`partner-ai-session:${auth.organization.id}:${auth.user.id}`]);
    await client.query("UPDATE partner_ai_sessions SET state='expired' WHERE user_id=$1 AND organization_id=$2 AND state NOT IN ('submitted','expired') AND expires_at<=now()", [auth.user.id, auth.organization.id]);
    const existing = (await client.query(
      "SELECT * FROM partner_ai_sessions WHERE user_id=$1 AND organization_id=$2 AND scenario=$3 AND state NOT IN ('submitted','expired') AND expires_at>now() ORDER BY updated_at DESC LIMIT 1",
      [auth.user.id, auth.organization.id, parsed.scenario],
    )).rows[0];
    if (existing) return { ok: true, resumed: true, session: sessionPayload(existing, { candidates: await cardsForIds(client, auth, existing.candidate_ids || [], existing.source_text), voiceEnabled: partnerAiQuickReportEnabledFor(config, auth.organization.id, "voice") }) };
    // Open with the orders due soonest so the partner can tap instead of typing an order number.
    const candidates = (await eligibleProductionOrders(client, auth)).slice(0, 5);
    const nextQuestion = candidates.length
      ? "这是你们最近要交的加工单，点一下要汇报的那张；也可以直接说产品简称或单号。"
      : "目前没有可以汇报的加工单：只有已接单、正在生产的委外加工单才能用小助理汇报。如果任务里的加工单还是“待接单”，请先去任务里接单。";
    const row = (await client.query(
      `INSERT INTO partner_ai_sessions(organization_id,user_id,scenario,next_question,state,candidate_ids,candidate_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [auth.organization.id, auth.user.id, parsed.scenario, nextQuestion, candidates.length ? "confirming_order" : "identifying_order", jsonbParameter(candidates.map((item) => item.id), []), candidates.length],
    )).rows[0];
    return { ok: true, resumed: false, session: sessionPayload(row, { candidates, voiceEnabled: partnerAiQuickReportEnabledFor(config, auth.organization.id, "voice") }) };
  });
}

export async function getPartnerAiSession(auth, sessionId) {
  assertContributor(auth);
  const config = await assertEnabled(auth, "text");
  return withOrganization(auth.organization.id, async (client) => {
    const session = await sessionForUser(client, auth, sessionId);
    let versionConflict = false;
    let confirmedOrder = null;
    if (session.confirmed_work_item_id) {
      const eligible = await eligibleProductionOrders(client, auth);
      confirmedOrder = eligible.find((item) => item.id === session.confirmed_work_item_id) || null;
      if (!confirmedOrder) fail("加工单已完成、作废或权限已撤销。", 409, "order_no_longer_available");
      versionConflict = Number(confirmedOrder.version) !== Number(session.confirmed_work_item_version);
    }
    const candidates = await cardsForIds(client, auth, session.candidate_ids || [], session.source_text);
    return { ok: true, session: sessionPayload(session, { candidates, confirmedOrder, versionConflict, voiceEnabled: partnerAiQuickReportEnabledFor(config, auth.organization.id, "voice") }) };
  });
}

export async function messagePartnerAiSession(auth, sessionId, input) {
  assertContributor(auth);
  await assertEnabled(auth, "text");
  const parsed = messageSchema.parse(input);
  const snapshot = await withOrganization(auth.organization.id, async (client) => {
    const session = await sessionForUser(client, auth, sessionId);
    if (parsed.transcriptionId) {
      const transcription = (await client.query(
        "SELECT status FROM partner_ai_transcriptions WHERE id=$1 AND session_id=$2 AND organization_id=$3 AND user_id=$4",
        [parsed.transcriptionId, session.id, auth.organization.id, auth.user.id],
      )).rows[0];
      if (!transcription || transcription.status !== "completed") fail("语音转写尚未完成或不属于本次会话。", 409, "transcription_not_completed");
    }
    return {
      confirmedWorkItemId: session.confirmed_work_item_id || "",
      history: conversationFor(session),
      orders: await eligibleProductionOrders(client, auth),
    };
  });
  let orderHints = {};
  let matchingMode = "deterministic_fallback";
  const principal = { organizationId: auth.organization.id, userId: auth.user.id };
  // The conversational reply lets 同舟小助理 answer like a person even when the intent is unclear.
  // It never writes data: drafts and submissions still go through the existing confirmed flow.
  const chatPromise = requestPartnerChatReply({
    principal,
    text: parsed.text,
    history: snapshot.history,
    orders: orderSummariesForChat(snapshot.orders, snapshot.confirmedWorkItemId),
    confirmedOrderId: snapshot.confirmedWorkItemId,
  }).catch((error) => {
    console.warn("[collaboration:partner-ai-chat]", JSON.stringify({ sessionId, organizationId: auth.organization.id, code: String(error?.code || "partner_chat_failed") }));
    return null;
  });
  if (!snapshot.confirmedWorkItemId) {
    try {
      orderHints = await requestPartnerOrderHints({ principal, text: parsed.text });
      matchingMode = "hermes_assisted";
    } catch (error) {
      console.warn("[collaboration:partner-ai-match]", JSON.stringify({
        sessionId,
        organizationId: auth.organization.id,
        mode: matchingMode,
        code: String(error?.code || "partner_order_hint_failed"),
      }));
    }
  }
  const chat = await chatPromise;
  const prepared = await withOrganization(auth.organization.id, async (client) => {
    const session = await sessionForUser(client, auth, sessionId, { lock: true });
    if (session.state === "submitted") fail("本次汇报已经提交。", 409, "session_submitted");
    const sourceText = `${session.source_text ? `${session.source_text}\n` : ""}${parsed.text}`.slice(-MAX_SESSION_TEXT);
    if (parsed.transcriptionId) {
      const transcription = (await client.query(
        "SELECT status FROM partner_ai_transcriptions WHERE id=$1 AND session_id=$2 AND organization_id=$3 AND user_id=$4",
        [parsed.transcriptionId, session.id, auth.organization.id, auth.user.id],
      )).rows[0];
      if (!transcription || transcription.status !== "completed") fail("语音转写尚未完成或不属于本次会话。", 409, "transcription_not_completed");
    }
    if (!session.confirmed_work_item_id) {
      const eligible = await eligibleProductionOrders(client, auth);
      const matched = rankPartnerOrderCandidates(parsed.text, eligible, 5, orderHints);
      const chatPicked = chat?.orderIds?.length ? eligible.filter((item) => chat.orderIds.includes(item.id)) : [];
      // A vague message ("进度怎么样" / "你能做什么") matches nothing; instead of a dead end,
      // use the orders the conversation points to, or the ones due soonest, so the partner can just tap one.
      const candidates = matched.length ? matched : chatPicked.length ? chatPicked : eligible.slice(0, 5);
      const ids = candidates.map((item) => item.id);
      const state = candidates.length ? "confirming_order" : "identifying_order";
      const helpIntro = PARTNER_HELP_PATTERN.test(parsed.text)
        ? "我可以帮你把加工单的生产进度整理成汇报：先选订单，再说进展（物料、产前样、投产、交期），你确认后才会提交。"
        : "";
      const nextQuestion = chat?.reply ? chat.reply : matched.length
        ? "我找到了几张可能的加工单，请点击确认对应的订单。"
        : candidates.length
          ? `${helpIntro || "没认出是哪张加工单。"}下面是你们最近要交的加工单，点一下就能开始；也可以直接说产品简称或单号。`
          : `${helpIntro}目前没有可以汇报的加工单：只有已接单、正在生产的委外加工单才能用小助理汇报。如果任务里的加工单还是“待接单”，请先去任务里接单。`;
      const updated = (await client.query(
        `UPDATE partner_ai_sessions SET source_text=$2,state=$3,candidate_ids=$4,candidate_count=$5,next_question=$6,message_count=message_count+1,
          latest_transcription_id=COALESCE($7,latest_transcription_id),expires_at=now()+($8::text || ' minutes')::interval WHERE id=$1 RETURNING *`,
        [
          session.id,
          sourceText,
          state,
          jsonbParameter(ids, []),
          candidates.length,
          nextQuestion,
          parsed.transcriptionId || null,
          String(SESSION_TTL_MINUTES),
        ],
      )).rows[0];
      console.info("[collaboration:partner-ai-match]", JSON.stringify({
        sessionId: session.id,
        organizationId: auth.organization.id,
        mode: matchingMode,
        candidateCount: candidates.length,
        hintCount: values(orderHints?.terms).length,
        latencyMs: Number(orderHints?.latencyMs || 0),
      }));
      return { direct: { ok: true, session: sessionPayload(updated, { candidates, matching: { mode: matchingMode, model: String(orderHints?.model || "") } }) } };
    }
    if (chat?.reply && CONVERSATION_ONLY_INTENTS.has(chat.intent)) {
      // A question or small talk about the confirmed order: answer it without turning the words into report evidence.
      const updated = (await client.query(
        `UPDATE partner_ai_sessions SET next_question=$2,message_count=message_count+1,
          latest_transcription_id=COALESCE($3,latest_transcription_id),expires_at=now()+($4::text || ' minutes')::interval WHERE id=$1 RETURNING *`,
        [session.id, chat.reply, parsed.transcriptionId || null, String(SESSION_TTL_MINUTES)],
      )).rows[0];
      return { direct: { ok: true, session: sessionPayload(updated, { conversational: true }) } };
    }
    await client.query(
      `UPDATE partner_ai_sessions SET source_text=$2,state='collecting_progress',message_count=message_count+1,
        latest_transcription_id=COALESCE($3,latest_transcription_id),expires_at=now()+($4::text || ' minutes')::interval WHERE id=$1`,
      [session.id, sourceText, parsed.transcriptionId || null, String(SESSION_TTL_MINUTES)],
    );
    return { generate: true };
  });
  if (prepared.direct) return prepared.direct;
  return createSessionDraft(auth, sessionId, parsed.transcriptionId || "");
}

export async function confirmPartnerAiSessionOrder(auth, sessionId, input) {
  assertContributor(auth);
  await assertEnabled(auth, "text");
  const parsed = confirmationSchema.parse(input);
  const result = await withOrganization(auth.organization.id, async (client) => {
    const session = await sessionForUser(client, auth, sessionId, { lock: true });
    if (session.state === "submitted") fail("本次汇报已经提交。", 409, "session_submitted");
    const candidateIds = Array.isArray(session.candidate_ids) ? session.candidate_ids : [];
    if (!candidateIds.includes(parsed.workItemId) && session.confirmed_work_item_id !== parsed.workItemId) fail("该加工单不在本次候选中。", 403, "candidate_not_allowed");
    const item = (await client.query("SELECT * FROM work_items WHERE id=$1 AND organization_id=$2", [parsed.workItemId, auth.organization.id])).rows[0];
    if (!item || item.item_type !== "production_order") fail("加工单不存在。", 404, "order_not_found");
    await assertWorkItemPermission(client, auth.organization.id, item, "production.order.view");
    await assertWorkItemPermission(client, auth.organization.id, item, "production.progress.update");
    if (!ACTIVE_STATES.has(item.status)) fail("该加工单已完成、作废或当前不可汇报。", 409, "invalid_state");
    const updated = (await client.query(
      `UPDATE partner_ai_sessions SET confirmed_work_item_id=$2,confirmed_work_item_version=$3,state='collecting_progress',
        next_question='请先确认物料和包材是否已经齐套。',expires_at=now()+($4::text || ' minutes')::interval WHERE id=$1 RETURNING *`,
      [session.id, item.id, Number(item.version), String(SESSION_TTL_MINUTES)],
    )).rows[0];
    return updated;
  });
  if (!result.source_text.trim()) return { ok: true, session: sessionPayload(result) };
  return createSessionDraft(auth, sessionId);
}

export const partnerAiSessionInternals = { requiredMissing, RISK_PATTERN };
