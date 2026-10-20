import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";
import { actionPermission, assertWorkItemPermission } from "./access.js";
import { collaborationConfig } from "./config.js";
import { withOrganization, withSystem } from "./db.js";
import { requestPartnerProgressDraft } from "./partner-ai-bridge.js";
import { getPartnerAiSettings, partnerAiEnabledFor } from "./partner-ai-settings.js";
import { recognizeShortAudio } from "./tencent-asr.js";

const MAX_AUDIO_BYTES = 2_621_440;
const MAX_AUDIO_DURATION_MS = 50_000;
const ALLOWED_AUDIO_MIME = new Set(["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/x-aac", "audio/wav", "audio/wave", "audio/x-wav"]);
const PRODUCTION_STAGES = ["planning", "material_preparation", "filling", "packaging", "quality_check", "ready_to_ship"];
const PURCHASE_STAGES = ["confirmed", "preparing", "ready_to_ship", "shipped", "delivered"];

const transcriptionSchema = z.object({
  fileName: z.string().trim().min(1).max(240),
  mimeType: z.string().trim().min(1).max(160),
  sizeBytes: z.number().int().positive().max(MAX_AUDIO_BYTES),
  durationMs: z.number().int().positive().max(MAX_AUDIO_DURATION_MS),
  workItemVersion: z.number().int().positive(),
}).strict();

const draftSchema = z.object({
  text: z.string().trim().min(1).max(2_000),
  workItemVersion: z.number().int().positive(),
  transcriptionId: z.string().uuid().optional(),
}).strict();

const s3 = collaborationConfig.storageDriver === "s3" ? new S3Client({
  endpoint: collaborationConfig.s3.endpoint || undefined,
  region: collaborationConfig.s3.region,
  forcePathStyle: Boolean(collaborationConfig.s3.endpoint),
  credentials: collaborationConfig.s3.accessKeyId ? {
    accessKeyId: collaborationConfig.s3.accessKeyId,
    secretAccessKey: collaborationConfig.s3.secretAccessKey,
  } : undefined,
}) : null;

function fail(message, statusCode = 400, code = "invalid_partner_ai_request") {
  throw Object.assign(new Error(message), { statusCode, code });
}

function assertContributor(auth) {
  if (!auth?.membership || !["organization_admin", "manager", "operator"].includes(auth.membership.role)) {
    fail("当前岗位无权使用快捷汇报。", 403, "forbidden");
  }
}

function safeName(value) {
  return basename(String(value || "voice")).replace(/[^\p{L}\p{N}._ -]+/gu, "_").slice(0, 180) || "voice";
}

function localPath(objectKey) {
  const root = resolve(collaborationConfig.storageDir);
  const target = resolve(root, objectKey);
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error("Invalid temporary audio object key.");
  return target;
}

function draftType(itemType) {
  if (itemType === "production_order") return "production_progress";
  if (itemType === "purchase_order") return "purchase_fulfillment";
  return "work_item_progress";
}

function allowedStages(itemType) {
  if (itemType === "production_order") return PRODUCTION_STAGES;
  if (itemType === "purchase_order") return PURCHASE_STAGES;
  return [];
}

function safeTaskPayload(payload = {}) {
  const allowed = [
    "orderNo", "referenceNo", "projectCode", "productName", "productSpec", "quantity", "unit",
    "deliveryDate", "factoryExpectedDeliveryDate", "requirements", "note", "warehouseName",
  ];
  return Object.fromEntries(allowed.filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]]));
}

function draftResponse(row) {
  return {
    id: row.id,
    type: row.draft_type,
    workItemVersion: Number(row.work_item_version),
    fields: row.draft_json || {},
    evidence: row.evidence_json || [],
    missingFields: row.missing_fields || [],
    warnings: row.warnings || [],
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

async function settingsFor(auth, mode) {
  const value = await getPartnerAiSettings();
  if (!partnerAiEnabledFor(value.config, auth.organization.id, mode)) fail("当前组织尚未开放 Hermes 快捷汇报。", 403, "partner_ai_not_enabled");
  if (mode === "voice" && (!value.config.asr.secretId || !value.config.asr.secretKey)) fail("腾讯云语音识别尚未配置。", 503, "asr_not_configured");
  return value.config;
}

async function taskForProgress(client, auth, workItemId, version) {
  const result = await client.query("SELECT * FROM work_items WHERE id=$1 AND organization_id=$2", [workItemId, auth.organization.id]);
  const item = result.rows[0];
  if (!item) fail("任务不存在。", 404, "not_found");
  const permission = actionPermission(item.item_type, "progress");
  if (!permission) fail("当前任务不支持进度汇报。", 403, "progress_not_supported");
  await assertWorkItemPermission(client, auth.organization.id, item, permission);
  if (Number(item.version) !== Number(version)) fail("任务已更新，请刷新后重新生成草稿。", 409, "version_conflict");
  if (!["accepted", "in_progress"].includes(item.status)) fail("当前任务状态不能汇报进度。", 409, "invalid_state");
  return item;
}

async function enforceQuota(client, auth, config, table) {
  const active = await client.query("SELECT 1 FROM partner_ai_drafts WHERE user_id=$1 AND organization_id=$2 AND status='processing' AND updated_at>=now()-interval '2 minutes' LIMIT 1", [auth.user.id, auth.organization.id]);
  if (active.rows[0]) fail("已有一项快捷汇报正在生成，请稍候。", 429, "partner_ai_concurrent_limit");
  const counts = await client.query(
    `SELECT count(*) FILTER (WHERE user_id=$1)::int AS user_count,count(*)::int AS organization_count
       FROM ${table} WHERE organization_id=$2 AND created_at>=date_trunc('day',now())`,
    [auth.user.id, auth.organization.id],
  );
  if (Number(counts.rows[0]?.user_count || 0) >= config.userDailyLimit) fail("今日快捷汇报次数已达个人上限。", 429, "partner_ai_user_daily_limit");
  if (Number(counts.rows[0]?.organization_count || 0) >= config.organizationDailyLimit) fail("今日快捷汇报次数已达组织上限。", 429, "partner_ai_org_daily_limit");
}

export async function createPartnerAiTranscription(auth, workItemId, input) {
  assertContributor(auth);
  const parsed = transcriptionSchema.parse(input);
  if (!ALLOWED_AUDIO_MIME.has(parsed.mimeType.toLowerCase().split(";")[0])) fail("不支持该录音格式。", 415, "unsupported_audio_format");
  const config = await settingsFor(auth, "voice");
  return withOrganization(auth.organization.id, async (client) => {
    await taskForProgress(client, auth, workItemId, parsed.workItemVersion);
    await enforceQuota(client, auth, config, "partner_ai_transcriptions");
    const id = randomUUID();
    const fileName = safeName(parsed.fileName);
    const objectKey = `${auth.organization.id}/partner-ai/${workItemId}/${id}-${fileName}`;
    const row = (await client.query(
      `INSERT INTO partner_ai_transcriptions(id,organization_id,work_item_id,user_id,work_item_version,object_key,file_name,mime_type,size_bytes,duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [id, auth.organization.id, workItemId, auth.user.id, parsed.workItemVersion, objectKey, fileName, parsed.mimeType, parsed.sizeBytes, parsed.durationMs],
    )).rows[0];
    if (collaborationConfig.storageDriver === "s3") {
      const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket: collaborationConfig.s3.bucket, Key: objectKey, ContentType: parsed.mimeType, ContentLength: parsed.sizeBytes }), { expiresIn: 300 });
      return { transcriptionId: id, uploadUrl, uploadMethod: "PUT", requiredHeaders: { "Content-Type": parsed.mimeType }, expiresAt: new Date(row.expires_at).toISOString() };
    }
    return { transcriptionId: id, uploadUrl: `/collaboration/v1/work-items/${workItemId}/ai-transcriptions/${id}/content`, uploadMethod: "PUT", requiredHeaders: { "Content-Type": parsed.mimeType }, expiresAt: new Date(row.expires_at).toISOString() };
  });
}

async function transcriptionForUser(client, auth, workItemId, transcriptionId) {
  const row = (await client.query(
    "SELECT * FROM partner_ai_transcriptions WHERE id=$1 AND organization_id=$2 AND user_id=$3 AND work_item_id=$4",
    [transcriptionId, auth.organization.id, auth.user.id, workItemId],
  )).rows[0];
  if (!row) fail("录音任务不存在。", 404, "not_found");
  return row;
}

export async function receivePartnerAiAudio(auth, workItemId, transcriptionId, req) {
  assertContributor(auth);
  if (collaborationConfig.storageDriver !== "local") fail("本地录音上传入口未启用。", 404, "not_found");
  return withOrganization(auth.organization.id, async (client) => {
    const row = await transcriptionForUser(client, auth, workItemId, transcriptionId);
    if (row.status !== "created" || new Date(row.expires_at).getTime() <= Date.now()) fail("录音上传凭证已失效。", 409, "transcription_expired");
    const length = Number(req.headers["content-length"] || 0);
    const mime = String(req.headers["content-type"] || "").split(";")[0];
    if (length !== Number(row.size_bytes) || mime !== row.mime_type) fail("录音大小或格式与申请信息不一致。", 400, "audio_metadata_mismatch");
    const path = localPath(row.object_key);
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.uploading`;
    try {
      await pipeline(req, createWriteStream(temporary, { flags: "wx" }));
      if (statSync(temporary).size !== length) fail("录音上传不完整。", 400, "incomplete_upload");
      renameSync(temporary, path);
    } catch (error) {
      if (existsSync(temporary)) unlinkSync(temporary);
      throw error;
    }
    await client.query("UPDATE partner_ai_transcriptions SET status='uploaded' WHERE id=$1", [row.id]);
    return { ok: true, transcriptionId: row.id };
  });
}

async function readAudio(row) {
  if (collaborationConfig.storageDriver === "local") {
    const path = localPath(row.object_key);
    if (!existsSync(path)) fail("录音尚未上传。", 409, "audio_not_uploaded");
    const chunks = [];
    for await (const chunk of createReadStream(path)) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  const head = await s3.send(new HeadObjectCommand({ Bucket: collaborationConfig.s3.bucket, Key: row.object_key }));
  if (Number(head.ContentLength || 0) !== Number(row.size_bytes) || String(head.ContentType || "") !== row.mime_type) fail("录音大小或格式不一致。", 400, "audio_metadata_mismatch");
  const object = await s3.send(new GetObjectCommand({ Bucket: collaborationConfig.s3.bucket, Key: row.object_key }));
  const chunks = [];
  for await (const chunk of object.Body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function deleteAudioObject(row) {
  if (collaborationConfig.storageDriver === "local") {
    const path = localPath(row.object_key);
    if (existsSync(path)) unlinkSync(path);
  } else {
    await s3.send(new DeleteObjectCommand({ Bucket: collaborationConfig.s3.bucket, Key: row.object_key }));
  }
}

export async function completePartnerAiTranscription(auth, workItemId, transcriptionId) {
  assertContributor(auth);
  const config = await settingsFor(auth, "voice");
  const row = await withOrganization(auth.organization.id, async (client) => {
    const current = await transcriptionForUser(client, auth, workItemId, transcriptionId);
    if (current.status === "completed") return current;
    if (!["created", "uploaded", "failed"].includes(current.status)) fail("录音正在处理，请勿重复提交。", 409, "transcription_in_progress");
    await taskForProgress(client, auth, workItemId, Number(current.work_item_version));
    await client.query("UPDATE partner_ai_transcriptions SET status='processing',error_code='' WHERE id=$1", [current.id]);
    return current;
  });
  if (row.status === "completed") return { transcriptionId: row.id, transcript: row.transcript, durationMs: row.duration_ms };
  try {
    const buffer = await readAudio(row);
    if (buffer.length !== Number(row.size_bytes)) fail("录音上传不完整。", 400, "incomplete_upload");
    const task = await withOrganization(auth.organization.id, async (client) => (await client.query("SELECT title,public_payload FROM work_items WHERE id=$1 AND organization_id=$2", [workItemId, auth.organization.id])).rows[0]);
    const hotwords = [task?.title, task?.public_payload?.productName, task?.public_payload?.projectCode, task?.public_payload?.orderNo].filter(Boolean);
    const result = await recognizeShortAudio({
      buffer,
      mimeType: row.mime_type,
      fileName: row.file_name,
      secretId: config.asr.secretId,
      secretKey: config.asr.secretKey,
      engine: config.asr.engine,
      hotwords,
    });
    await withOrganization(auth.organization.id, (client) => client.query(
      "UPDATE partner_ai_transcriptions SET status='completed',transcript=$2,asr_request_id=$3,completed_at=now() WHERE id=$1",
      [row.id, result.transcript, result.requestId],
    ));
    return { transcriptionId: row.id, transcript: result.transcript, durationMs: result.durationMs || row.duration_ms };
  } catch (error) {
    await withOrganization(auth.organization.id, (client) => client.query(
      "UPDATE partner_ai_transcriptions SET status='failed',error_code=$2 WHERE id=$1",
      [row.id, String(error.code || "asr_failed").slice(0, 120)],
    )).catch(() => {});
    throw error;
  } finally {
    try {
      await deleteAudioObject(row);
      await withOrganization(auth.organization.id, (client) => client.query("UPDATE partner_ai_transcriptions SET deleted_at=now() WHERE id=$1", [row.id]));
    } catch {
      await withOrganization(auth.organization.id, (client) => client.query("UPDATE partner_ai_transcriptions SET error_code='audio_cleanup_failed' WHERE id=$1", [row.id])).catch(() => {});
    }
  }
}

export async function createPartnerProgressDraft(auth, workItemId, input) {
  assertContributor(auth);
  const parsed = draftSchema.parse(input);
  const config = await settingsFor(auth, parsed.transcriptionId ? "voice" : "text");
  const prepared = await withOrganization(auth.organization.id, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`partner-ai:${auth.organization.id}:${auth.user.id}`]);
    const item = await taskForProgress(client, auth, workItemId, parsed.workItemVersion);
    await enforceQuota(client, auth, config, "partner_ai_drafts");
    let transcription = null;
    if (parsed.transcriptionId) {
      transcription = await transcriptionForUser(client, auth, workItemId, parsed.transcriptionId);
      if (transcription.status !== "completed") fail("录音尚未完成转写。", 409, "transcription_not_completed");
      if (Number(transcription.work_item_version) !== Number(parsed.workItemVersion)) fail("任务已更新，请重新录音或使用当前文字生成草稿。", 409, "version_conflict");
    }
    const type = draftType(item.item_type);
    const latestReport = ["production_progress", "purchase_fulfillment"].includes(type)
      ? (await client.query(
        "SELECT report_type,stage,progress_percent,quantity,expected_at,note,created_at FROM partner_order_reports WHERE work_item_id=$1 AND organization_id=$2 AND report_type=$3 ORDER BY created_at DESC LIMIT 1",
        [item.id, auth.organization.id, type],
      )).rows[0] || null : null;
    const draft = (await client.query(
      `INSERT INTO partner_ai_drafts(organization_id,work_item_id,user_id,transcription_id,work_item_version,draft_type,source_type,source_text,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'processing') RETURNING *`,
      [auth.organization.id, item.id, auth.user.id, transcription?.id || null, Number(item.version), type, transcription ? "voice" : "text", parsed.text],
    )).rows[0];
    return {
      draft,
      task: {
        id: item.id,
        version: Number(item.version),
        itemType: item.item_type,
        title: item.title,
        description: item.description,
        dueAt: item.due_at ? new Date(item.due_at).toISOString() : "",
        publicPayload: safeTaskPayload(item.public_payload),
        allowedStages: allowedStages(item.item_type),
        latestReport,
      },
    };
  });
  try {
    const generated = await requestPartnerProgressDraft({
      principal: { organizationId: auth.organization.id, userId: auth.user.id, workItemId },
      text: parsed.text,
      task: prepared.task,
    });
    if (generated.type !== prepared.draft.draft_type) fail("草稿类型与当前任务不匹配。", 502, "draft_type_mismatch");
    const row = await withOrganization(auth.organization.id, async (client) => {
      await taskForProgress(client, auth, workItemId, parsed.workItemVersion);
      return (await client.query(
        `UPDATE partner_ai_drafts SET status='generated',draft_json=$2,evidence_json=$3,missing_fields=$4,warnings=$5,
          model=$6,provider=$7,usage_json=$8,latency_ms=$9 WHERE id=$1 AND user_id=$10 AND status='processing' RETURNING *`,
        [prepared.draft.id, generated.fields, generated.evidence, generated.missingFields, generated.warnings, generated.model || "", generated.provider || "", generated.usage || {}, Number(generated.latencyMs || 0), auth.user.id],
      )).rows[0];
    });
    if (!row) fail("草稿运行已失效，请重新生成。", 409, "draft_run_stale");
    return { ok: true, draft: draftResponse(row) };
  } catch (error) {
    await withOrganization(auth.organization.id, (client) => client.query("UPDATE partner_ai_drafts SET status='failed',warnings=$2 WHERE id=$1", [prepared.draft.id, [String(error.code || "draft_failed")]])).catch(() => {});
    throw error;
  }
}

export async function markPartnerAiDraftApplied(auth, workItemId, draftId, workItemVersion) {
  assertContributor(auth);
  return withOrganization(auth.organization.id, async (client) => {
    await taskForProgress(client, auth, workItemId, workItemVersion);
    const row = (await client.query(
      `UPDATE partner_ai_drafts SET status='applied',applied_at=now()
        WHERE id=$1 AND organization_id=$2 AND user_id=$3 AND work_item_id=$4 AND work_item_version=$5
          AND status='generated' AND expires_at>now() RETURNING *`,
      [draftId, auth.organization.id, auth.user.id, workItemId, workItemVersion],
    )).rows[0];
    if (!row) fail("草稿不存在、已失效或不属于当前任务。", 404, "draft_not_found");
    return { ok: true, draft: draftResponse(row) };
  });
}

export async function linkPartnerAiDraftToCommand(client, { auth, workItemId, workItemVersion, draftId, commandId, expectedDraftType }) {
  if (!draftId) return null;
  const row = (await client.query(
    `UPDATE partner_ai_drafts SET status='submitted',submitted_command_id=$6
      WHERE id=$1 AND organization_id=$2 AND user_id=$3 AND work_item_id=$4 AND work_item_version=$5
        AND draft_type=$7 AND status IN ('generated','applied') AND expires_at>now() RETURNING id`,
    [draftId, auth.organization.id, auth.user.id, workItemId, workItemVersion, commandId, expectedDraftType],
  )).rows[0];
  if (!row) fail("AI 草稿不存在、已失效或与当前提交不匹配。", 409, "ai_draft_mismatch");
  return row.id;
}

export async function cleanupExpiredPartnerAiAudio() {
  const rows = await withSystem(async (client) => (await client.query(
    "SELECT * FROM partner_ai_transcriptions WHERE deleted_at IS NULL AND expires_at<now() LIMIT 100",
  )).rows);
  for (const row of rows) {
    try {
      await deleteAudioObject(row);
      await withSystem((client) => client.query(
        "UPDATE partner_ai_transcriptions SET status=CASE WHEN status='completed' THEN status ELSE 'deleted' END,deleted_at=now() WHERE id=$1",
        [row.id],
      ));
    } catch {
      await withSystem((client) => client.query("UPDATE partner_ai_transcriptions SET error_code='audio_cleanup_failed' WHERE id=$1", [row.id])).catch(() => {});
    }
  }
  await withSystem(async (client) => {
    await client.query("UPDATE partner_ai_transcriptions SET status='failed',error_code='asr_worker_interrupted' WHERE status='processing' AND updated_at<now()-interval '2 minutes'");
    await client.query("UPDATE partner_ai_drafts SET status='failed',warnings='[\"draft_worker_interrupted\"]'::jsonb WHERE status='processing' AND updated_at<now()-interval '2 minutes'");
    await client.query("UPDATE partner_ai_transcriptions SET transcript='',transcript_purged_at=now() WHERE completed_at<now()-interval '30 days' AND transcript<>'' AND transcript_purged_at IS NULL");
    await client.query("UPDATE partner_ai_drafts SET source_text='',draft_json='{}'::jsonb,evidence_json='[]'::jsonb,missing_fields='[]'::jsonb,warnings='[]'::jsonb,content_purged_at=now() WHERE created_at<now()-interval '90 days' AND content_purged_at IS NULL");
  });
  return rows.length;
}

export const partnerAiLimits = { maxAudioBytes: MAX_AUDIO_BYTES, maxAudioDurationMs: MAX_AUDIO_DURATION_MS };
