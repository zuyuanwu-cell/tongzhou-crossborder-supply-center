import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";
import { actionPermission, assertWorkItemPermission } from "./access.js";
import { collaborationConfig } from "./config.js";
import { withOrganization, withSystem } from "./db.js";
import { jsonbParameter } from "./jsonb-parameter.js";
import { requestPartnerProgressDraft } from "./partner-ai-bridge.js";
import { getPartnerAiSettings, partnerAiEnabledFor, partnerAiQuickReportEnabledFor } from "./partner-ai-settings.js";
import { recognizeShortAudio } from "./tencent-asr.js";

const MAX_AUDIO_BYTES = 2_621_440;
const MAX_AUDIO_DURATION_MS = 50_000;
const ALLOWED_AUDIO_MIME = new Set(["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/x-aac", "audio/wav", "audio/wave", "audio/x-wav"]);
const PRODUCTION_STAGES = ["planning", "material_preparation", "filling", "packaging", "quality_check", "ready_to_ship"];
const PURCHASE_STAGES = ["confirmed", "preparing", "ready_to_ship", "shipped", "delivered"];
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]{16,200}$/;

const transcriptionSchema = z.object({
  fileName: z.string().trim().min(1).max(240),
  mimeType: z.string().trim().min(1).max(160),
  sizeBytes: z.number().int().positive().max(MAX_AUDIO_BYTES),
  durationMs: z.number().int().positive().max(MAX_AUDIO_DURATION_MS),
  workItemVersion: z.number().int().positive(),
}).strict();

const sessionTranscriptionSchema = transcriptionSchema.omit({ workItemVersion: true });

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

function requiredIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) fail("Idempotency-Key 必须是 16 到 200 位可见 ASCII 字符。", 400, "idempotency_key_required");
  return key;
}

function requestHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizedMime(value) {
  return String(value || "").toLowerCase().split(";")[0].trim();
}

function assertAudioContent(buffer, mimeType) {
  const mime = normalizedMime(mimeType);
  const riff = buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WAVE";
  const mp3 = buffer.length >= 3 && (buffer.subarray(0, 3).toString("ascii") === "ID3" || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0));
  const mp4 = buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp";
  const aac = buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0;
  const valid = ["audio/wav", "audio/wave", "audio/x-wav"].includes(mime) ? riff
    : mime === "audio/mpeg" ? mp3
      : ["audio/mp4", "audio/x-m4a"].includes(mime) ? mp4
        : ["audio/aac", "audio/x-aac"].includes(mime) ? aac
          : false;
  if (!valid) fail("录音内容与声明格式不一致。", 415, "invalid_audio_content");
}

async function collectLimited(stream, expectedBytes) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const value = Buffer.from(chunk);
    bytes += value.length;
    if (bytes > MAX_AUDIO_BYTES || bytes > expectedBytes) fail("录音文件超过允许大小。", 413, "audio_too_large");
    chunks.push(value);
  }
  if (bytes !== expectedBytes) fail("录音上传不完整。", 400, "incomplete_upload");
  return Buffer.concat(chunks, bytes);
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

export function partnerAiDraftReplayAction(status) {
  if (["generated", "applied", "submitted"].includes(status)) return "return";
  if (status === "failed") return "retry";
  return "wait";
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

async function enforceQuota(client, auth, config, table, { checkTranscriptions = false } = {}) {
  const active = await client.query("SELECT 1 FROM partner_ai_drafts WHERE user_id=$1 AND organization_id=$2 AND status='processing' AND updated_at>=now()-interval '2 minutes' LIMIT 1", [auth.user.id, auth.organization.id]);
  if (active.rows[0]) fail("已有一项快捷汇报正在生成，请稍候。", 429, "partner_ai_concurrent_limit");
  if (checkTranscriptions) {
    const activeTranscription = await client.query(
      "SELECT 1 FROM partner_ai_transcriptions WHERE user_id=$1 AND organization_id=$2 AND status IN ('created','uploaded','processing') AND expires_at>now() LIMIT 1",
      [auth.user.id, auth.organization.id],
    );
    if (activeTranscription.rows[0]) fail("已有一项录音正在处理，请完成或等待其过期。", 429, "partner_ai_concurrent_limit");
  }
  const counts = await client.query(
    `SELECT count(*) FILTER (WHERE user_id=$1)::int AS user_count,count(*)::int AS organization_count
       FROM ${table} WHERE organization_id=$2 AND created_at>=date_trunc('day',now())`,
    [auth.user.id, auth.organization.id],
  );
  if (Number(counts.rows[0]?.user_count || 0) >= config.userDailyLimit) fail("今日快捷汇报次数已达个人上限。", 429, "partner_ai_user_daily_limit");
  if (Number(counts.rows[0]?.organization_count || 0) >= config.organizationDailyLimit) fail("今日快捷汇报次数已达组织上限。", 429, "partner_ai_org_daily_limit");
}

async function transcriptionTicket(row, workItemId, { idempotentReplay = false, uploadUrl = "" } = {}) {
  const response = {
    transcriptionId: row.id,
    status: row.status,
    idempotentReplay,
    expiresAt: new Date(row.expires_at).toISOString(),
  };
  if (row.status === "completed") {
    response.transcript = row.transcript;
    response.durationMs = Number(row.duration_ms);
  }
  if (row.status !== "created") return response;
  if (collaborationConfig.storageDriver === "s3") {
    response.uploadUrl = await getSignedUrl(s3, new PutObjectCommand({
      Bucket: collaborationConfig.s3.bucket, Key: row.object_key, ContentType: row.mime_type, ContentLength: Number(row.size_bytes),
    }), { expiresIn: 300 });
  } else {
    response.uploadUrl = uploadUrl || `/collaboration/v1/work-items/${workItemId}/ai-transcriptions/${row.id}/content`;
  }
  response.uploadMethod = "PUT";
  response.requiredHeaders = { "Content-Type": row.mime_type };
  return response;
}

export async function createPartnerAiTranscription(auth, workItemId, input, options = {}) {
  assertContributor(auth);
  const parsed = transcriptionSchema.parse(input);
  parsed.mimeType = normalizedMime(parsed.mimeType);
  if (!ALLOWED_AUDIO_MIME.has(parsed.mimeType)) fail("不支持该录音格式。", 415, "unsupported_audio_format");
  const idempotencyKey = requiredIdempotencyKey(options.idempotencyKey);
  const hash = requestHash({ workItemId, ...parsed });
  const config = await settingsFor(auth, "voice");
  return withOrganization(auth.organization.id, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`partner-ai:${auth.organization.id}:${auth.user.id}`]);
    await taskForProgress(client, auth, workItemId, parsed.workItemVersion);
    const replay = (await client.query(
      "SELECT * FROM partner_ai_transcriptions WHERE organization_id=$1 AND user_id=$2 AND idempotency_key=$3",
      [auth.organization.id, auth.user.id, idempotencyKey],
    )).rows[0];
    if (replay) {
      if (replay.request_hash !== hash) fail("Idempotency-Key 已用于不同请求。", 409, "idempotency_conflict");
      return transcriptionTicket(replay, workItemId, { idempotentReplay: true });
    }
    await enforceQuota(client, auth, config, "partner_ai_transcriptions", { checkTranscriptions: true });
    const id = randomUUID();
    const fileName = safeName(parsed.fileName);
    const objectKey = `${auth.organization.id}/partner-ai/${workItemId}/${id}-${fileName}`;
    const row = (await client.query(
      `INSERT INTO partner_ai_transcriptions(id,organization_id,work_item_id,user_id,work_item_version,object_key,file_name,mime_type,size_bytes,duration_ms,idempotency_key,request_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [id, auth.organization.id, workItemId, auth.user.id, parsed.workItemVersion, objectKey, fileName, parsed.mimeType, parsed.sizeBytes, parsed.durationMs, idempotencyKey, hash],
    )).rows[0];
    return transcriptionTicket(row, workItemId);
  });
}

async function settingsForQuickReport(auth, mode) {
  const value = await getPartnerAiSettings();
  if (!partnerAiQuickReportEnabledFor(value.config, auth.organization.id, mode)) fail("当前组织尚未开放 Hermes 快捷汇报。", 403, "partner_ai_not_enabled");
  if (mode === "voice" && (!value.config.asr.secretId || !value.config.asr.secretKey)) fail("腾讯云语音识别尚未配置。", 503, "asr_not_configured");
  return value.config;
}

async function sessionForAudio(client, auth, sessionId) {
  const row = (await client.query(
    "SELECT * FROM partner_ai_sessions WHERE id=$1 AND organization_id=$2 AND user_id=$3",
    [sessionId, auth.organization.id, auth.user.id],
  )).rows[0];
  if (!row) fail("快捷汇报会话不存在。", 404, "session_not_found");
  if (["submitted", "expired"].includes(row.state) || new Date(row.expires_at).getTime() <= Date.now()) fail("快捷汇报会话已结束或过期。", 409, "session_expired");
  return row;
}

async function sessionTranscriptionForUser(client, auth, sessionId, transcriptionId) {
  const row = (await client.query(
    "SELECT * FROM partner_ai_transcriptions WHERE id=$1 AND organization_id=$2 AND user_id=$3 AND session_id=$4",
    [transcriptionId, auth.organization.id, auth.user.id, sessionId],
  )).rows[0];
  if (!row) fail("语音任务不存在。", 404, "not_found");
  return row;
}

export async function createPartnerAiSessionTranscription(auth, sessionId, input, options = {}) {
  assertContributor(auth);
  const parsed = sessionTranscriptionSchema.parse(input);
  parsed.mimeType = normalizedMime(parsed.mimeType);
  if (!ALLOWED_AUDIO_MIME.has(parsed.mimeType)) fail("不支持该录音格式。", 415, "unsupported_audio_format");
  const idempotencyKey = requiredIdempotencyKey(options.idempotencyKey);
  const hash = requestHash({ sessionId, ...parsed });
  const config = await settingsForQuickReport(auth, "voice");
  return withOrganization(auth.organization.id, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`partner-ai:${auth.organization.id}:${auth.user.id}`]);
    await sessionForAudio(client, auth, sessionId);
    const replay = (await client.query(
      "SELECT * FROM partner_ai_transcriptions WHERE organization_id=$1 AND user_id=$2 AND idempotency_key=$3",
      [auth.organization.id, auth.user.id, idempotencyKey],
    )).rows[0];
    const uploadUrl = `/collaboration/v1/partner-ai/sessions/${sessionId}/transcriptions/${replay?.id || ""}/content`;
    if (replay) {
      if (replay.request_hash !== hash || replay.session_id !== sessionId) fail("Idempotency-Key 已用于不同请求。", 409, "idempotency_conflict");
      return transcriptionTicket(replay, "", { idempotentReplay: true, uploadUrl });
    }
    await enforceQuota(client, auth, config, "partner_ai_transcriptions", { checkTranscriptions: true });
    const id = randomUUID();
    const fileName = safeName(parsed.fileName);
    const objectKey = `${auth.organization.id}/partner-ai/sessions/${sessionId}/${id}-${fileName}`;
    const row = (await client.query(
      `INSERT INTO partner_ai_transcriptions(id,organization_id,session_id,user_id,object_key,file_name,mime_type,size_bytes,duration_ms,idempotency_key,request_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [id, auth.organization.id, sessionId, auth.user.id, objectKey, fileName, parsed.mimeType, parsed.sizeBytes, parsed.durationMs, idempotencyKey, hash],
    )).rows[0];
    return transcriptionTicket(row, "", { uploadUrl: `/collaboration/v1/partner-ai/sessions/${sessionId}/transcriptions/${id}/content` });
  });
}

export async function getPartnerAiSessionTranscription(auth, sessionId, transcriptionId) {
  assertContributor(auth);
  await settingsForQuickReport(auth, "voice");
  return withOrganization(auth.organization.id, async (client) => {
    await sessionForAudio(client, auth, sessionId);
    const row = await sessionTranscriptionForUser(client, auth, sessionId, transcriptionId);
    return {
      transcriptionId: row.id,
      status: row.status,
      transcript: row.status === "completed" ? row.transcript : "",
      durationMs: Number(row.duration_ms),
      expiresAt: new Date(row.expires_at).toISOString(),
    };
  });
}

export async function receivePartnerAiSessionAudio(auth, sessionId, transcriptionId, req) {
  assertContributor(auth);
  await settingsForQuickReport(auth, "voice");
  if (collaborationConfig.storageDriver !== "local") fail("本地录音上传入口未启用。", 404, "not_found");
  return withOrganization(auth.organization.id, async (client) => {
    await sessionForAudio(client, auth, sessionId);
    const row = await sessionTranscriptionForUser(client, auth, sessionId, transcriptionId);
    if (row.status !== "created" || new Date(row.expires_at).getTime() <= Date.now()) fail("录音上传凭证已失效。", 409, "transcription_expired");
    const length = Number(req.headers["content-length"] || 0);
    const mime = normalizedMime(req.headers["content-type"]);
    if (length !== Number(row.size_bytes) || mime !== row.mime_type) fail("录音大小或格式与申请信息不一致。", 400, "audio_metadata_mismatch");
    const path = localPath(row.object_key);
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.uploading`;
    try {
      let received = 0;
      const limiter = new Transform({ transform(chunk, encoding, callback) {
        received += chunk.length;
        if (received > MAX_AUDIO_BYTES || received > length) callback(fail("录音文件超过允许大小。", 413, "audio_too_large"));
        else callback(null, chunk);
      } });
      await pipeline(req, limiter, createWriteStream(temporary, { flags: "wx" }));
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

export async function completePartnerAiSessionTranscription(auth, sessionId, transcriptionId) {
  assertContributor(auth);
  const config = await settingsForQuickReport(auth, "voice");
  const row = await withOrganization(auth.organization.id, async (client) => {
    await sessionForAudio(client, auth, sessionId);
    const current = await sessionTranscriptionForUser(client, auth, sessionId, transcriptionId);
    if (current.status === "completed") return current;
    if (current.status === "failed") fail("上次转写已失败，请重新录音。", 409, "transcription_retry_required");
    if (!["created", "uploaded"].includes(current.status)) fail("录音正在处理中，请勿重复提交。", 409, "transcription_in_progress");
    await client.query("UPDATE partner_ai_transcriptions SET status='processing',error_code='' WHERE id=$1", [current.id]);
    return current;
  });
  if (row.status === "completed") return { transcriptionId: row.id, transcript: row.transcript, durationMs: Number(row.duration_ms) };
  try {
    const buffer = await readAudio(row);
    if (buffer.length !== Number(row.size_bytes)) fail("录音上传不完整。", 400, "incomplete_upload");
    assertAudioContent(buffer, row.mime_type);
    const result = await recognizeShortAudio({
      buffer,
      mimeType: row.mime_type,
      fileName: row.file_name,
      secretId: config.asr.secretId,
      secretKey: config.asr.secretKey,
      engine: config.asr.engine,
      hotwords: [],
    });
    if (!result.transcript) fail("没有识别到清晰语音，请重录或改用文字输入。", 422, "asr_empty_transcript");
    await withOrganization(auth.organization.id, (client) => client.query(
      "UPDATE partner_ai_transcriptions SET status='completed',transcript=$2,asr_request_id=$3,completed_at=now() WHERE id=$1",
      [row.id, result.transcript, result.requestId],
    ));
    return { transcriptionId: row.id, transcript: result.transcript, durationMs: result.durationMs || Number(row.duration_ms) };
  } catch (error) {
    await withOrganization(auth.organization.id, (client) => client.query(
      "UPDATE partner_ai_transcriptions SET status='failed',error_code=$2 WHERE id=$1",
      [row.id, String(error.code || "asr_failed").slice(0, 120)],
    )).catch(() => {});
    throw error;
  } finally {
    try {
      await deleteAudioObject(row);
      await withOrganization(auth.organization.id, (client) => client.query("UPDATE partner_ai_transcriptions SET deleted_at=now(),cleanup_error='',next_cleanup_at=NULL WHERE id=$1", [row.id]));
    } catch (error) {
      await withOrganization(auth.organization.id, (client) => client.query(
        "UPDATE partner_ai_transcriptions SET cleanup_error=$2,cleanup_attempts=cleanup_attempts+1,next_cleanup_at=now()+interval '1 minute' WHERE id=$1",
        [row.id, String(error?.message || "cleanup_failed").slice(0, 500)],
      )).catch(() => {});
    }
  }
}

async function transcriptionForUser(client, auth, workItemId, transcriptionId) {
  const row = (await client.query(
    "SELECT * FROM partner_ai_transcriptions WHERE id=$1 AND organization_id=$2 AND user_id=$3 AND work_item_id=$4",
    [transcriptionId, auth.organization.id, auth.user.id, workItemId],
  )).rows[0];
  if (!row) fail("录音任务不存在。", 404, "not_found");
  return row;
}

export async function getPartnerAiTranscription(auth, workItemId, transcriptionId) {
  assertContributor(auth);
  return withOrganization(auth.organization.id, async (client) => {
    const row = await transcriptionForUser(client, auth, workItemId, transcriptionId);
    await taskForProgress(client, auth, workItemId, Number(row.work_item_version));
    return {
      transcriptionId: row.id,
      status: row.status,
      transcript: row.status === "completed" ? row.transcript : "",
      durationMs: Number(row.duration_ms),
      expiresAt: new Date(row.expires_at).toISOString(),
    };
  });
}

export async function receivePartnerAiAudio(auth, workItemId, transcriptionId, req) {
  assertContributor(auth);
  if (collaborationConfig.storageDriver !== "local") fail("本地录音上传入口未启用。", 404, "not_found");
  return withOrganization(auth.organization.id, async (client) => {
    const row = await transcriptionForUser(client, auth, workItemId, transcriptionId);
    if (row.status !== "created" || new Date(row.expires_at).getTime() <= Date.now()) fail("录音上传凭证已失效。", 409, "transcription_expired");
    const length = Number(req.headers["content-length"] || 0);
    const mime = normalizedMime(req.headers["content-type"]);
    if (length !== Number(row.size_bytes) || mime !== row.mime_type) fail("录音大小或格式与申请信息不一致。", 400, "audio_metadata_mismatch");
    const path = localPath(row.object_key);
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.uploading`;
    try {
      let received = 0;
      const limiter = new Transform({ transform(chunk, encoding, callback) {
        received += chunk.length;
        if (received > MAX_AUDIO_BYTES || received > length) callback(fail("录音文件超过允许大小。", 413, "audio_too_large"));
        else callback(null, chunk);
      } });
      await pipeline(req, limiter, createWriteStream(temporary, { flags: "wx" }));
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
    return collectLimited(createReadStream(path), Number(row.size_bytes));
  }
  const head = await s3.send(new HeadObjectCommand({ Bucket: collaborationConfig.s3.bucket, Key: row.object_key }));
  if (Number(head.ContentLength || 0) !== Number(row.size_bytes) || String(head.ContentType || "") !== row.mime_type) fail("录音大小或格式不一致。", 400, "audio_metadata_mismatch");
  const object = await s3.send(new GetObjectCommand({ Bucket: collaborationConfig.s3.bucket, Key: row.object_key }));
  return collectLimited(object.Body, Number(row.size_bytes));
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
    if (current.status === "failed") fail("上次转写已失败，请重新录音。", 409, "transcription_retry_required");
    if (!["created", "uploaded"].includes(current.status)) fail("录音正在处理，请勿重复提交。", 409, "transcription_in_progress");
    await taskForProgress(client, auth, workItemId, Number(current.work_item_version));
    await client.query("UPDATE partner_ai_transcriptions SET status='processing',error_code='' WHERE id=$1", [current.id]);
    return current;
  });
  if (row.status === "completed") return { transcriptionId: row.id, transcript: row.transcript, durationMs: row.duration_ms };
  try {
    const buffer = await readAudio(row);
    if (buffer.length !== Number(row.size_bytes)) fail("录音上传不完整。", 400, "incomplete_upload");
    assertAudioContent(buffer, row.mime_type);
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
    if (!result.transcript) fail("没有识别到清晰语音，请重录或改用文字输入。", 422, "asr_empty_transcript");
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
      await withOrganization(auth.organization.id, (client) => client.query("UPDATE partner_ai_transcriptions SET deleted_at=now(),cleanup_error='',next_cleanup_at=NULL WHERE id=$1", [row.id]));
    } catch (error) {
      await withOrganization(auth.organization.id, (client) => client.query(
        "UPDATE partner_ai_transcriptions SET cleanup_error=$2,cleanup_attempts=cleanup_attempts+1,next_cleanup_at=now()+interval '1 minute' WHERE id=$1",
        [row.id, String(error?.message || "cleanup_failed").slice(0, 500)],
      )).catch(() => {});
    }
  }
}

export async function createPartnerProgressDraft(auth, workItemId, input, options = {}) {
  assertContributor(auth);
  const parsed = draftSchema.parse(input);
  const idempotencyKey = requiredIdempotencyKey(options.idempotencyKey);
  const hash = requestHash({ workItemId, ...parsed });
  const config = await settingsFor(auth, parsed.transcriptionId ? "voice" : "text");
  const prepared = await withOrganization(auth.organization.id, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`partner-ai:${auth.organization.id}:${auth.user.id}`]);
    const item = await taskForProgress(client, auth, workItemId, parsed.workItemVersion);
    const replay = (await client.query(
      "SELECT * FROM partner_ai_drafts WHERE organization_id=$1 AND user_id=$2 AND idempotency_key=$3",
      [auth.organization.id, auth.user.id, idempotencyKey],
    )).rows[0];
    let retryDraft = null;
    if (replay) {
      if (replay.request_hash !== hash) fail("Idempotency-Key 已用于不同请求。", 409, "idempotency_conflict");
      const replayAction = partnerAiDraftReplayAction(replay.status);
      if (replayAction === "return") return { replay };
      if (replayAction === "wait") fail("该草稿正在生成，请稍候。", 409, "draft_in_progress");
      retryDraft = (await client.query(
        `UPDATE partner_ai_drafts SET status='processing',warnings='[]'::jsonb,model='',provider='',usage_json='{}'::jsonb,
           latency_ms=0,updated_at=now() WHERE id=$1 AND status='failed' RETURNING *`,
        [replay.id],
      )).rows[0];
      if (!retryDraft) fail("草稿状态已变更，请稍后重试。", 409, "draft_in_progress");
    }
    if (!retryDraft) await enforceQuota(client, auth, config, "partner_ai_drafts");
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
    const draft = retryDraft || (await client.query(
      `INSERT INTO partner_ai_drafts(organization_id,work_item_id,user_id,transcription_id,work_item_version,draft_type,source_type,source_text,status,idempotency_key,request_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'processing',$9,$10) RETURNING *`,
      [auth.organization.id, item.id, auth.user.id, transcription?.id || null, Number(item.version), type, transcription ? "voice" : "text", parsed.text, idempotencyKey, hash],
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
  if (prepared.replay) return { ok: true, idempotentReplay: true, draft: draftResponse(prepared.replay) };
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
        [
          prepared.draft.id,
          jsonbParameter(generated.fields, {}),
          jsonbParameter(generated.evidence, []),
          jsonbParameter(generated.missingFields, []),
          jsonbParameter(generated.warnings, []),
          generated.model || "",
          generated.provider || "",
          jsonbParameter(generated.usage, {}),
          Number(generated.latencyMs || 0),
          auth.user.id,
        ],
      )).rows[0];
    });
    if (!row) fail("草稿运行已失效，请重新生成。", 409, "draft_run_stale");
    return { ok: true, idempotentReplay: false, draft: draftResponse(row) };
  } catch (error) {
    await withOrganization(auth.organization.id, (client) => client.query(
      "UPDATE partner_ai_drafts SET status='failed',warnings=$2 WHERE id=$1",
      [prepared.draft.id, jsonbParameter([String(error.code || "draft_failed")], [])],
    )).catch(() => {});
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

function normalizedSubmittedFields(expectedDraftType, payload = {}) {
  if (expectedDraftType !== "production_progress") return {};
  return {
    stage: String(payload.stage || ""),
    progressPercent: payload.progressPercent == null || payload.progressPercent === "" ? null : Number(payload.progressPercent),
    completedQuantity: Number(payload.completedQuantity || 0),
    expectedCompletionDate: String(payload.expectedCompletionDate || ""),
    note: String(payload.note || "").trim(),
  };
}

export async function linkPartnerAiDraftToCommand(client, { auth, workItemId, workItemVersion, draftId, commandId, expectedDraftType, submittedPayload }) {
  if (!draftId) return null;
  const row = (await client.query(
    `UPDATE partner_ai_drafts SET status='submitted',submitted_command_id=$6
      WHERE id=$1 AND organization_id=$2 AND user_id=$3 AND work_item_id=$4 AND work_item_version=$5
        AND draft_type=$7 AND status IN ('generated','applied') AND expires_at>now() RETURNING id,session_id,draft_json`,
    [draftId, auth.organization.id, auth.user.id, workItemId, workItemVersion, commandId, expectedDraftType],
  )).rows[0];
  if (!row) fail("AI 草稿不存在、已失效或与当前提交不匹配。", 409, "ai_draft_mismatch");
  const submittedFields = normalizedSubmittedFields(expectedDraftType, submittedPayload);
  const draftFields = normalizedSubmittedFields(expectedDraftType, row.draft_json || {});
  const draftModified = row.session_id && submittedPayload ? JSON.stringify(submittedFields) !== JSON.stringify(draftFields) : null;
  await client.query(
    `UPDATE partner_ai_sessions SET state='submitted',submitted_command_id=$2,completed_at=now(),submitted_fields=$6,
       draft_modified=$7
      WHERE latest_draft_id=$1 AND organization_id=$3 AND user_id=$4 AND confirmed_work_item_id=$5`,
    [draftId, commandId, auth.organization.id, auth.user.id, workItemId, jsonbParameter(submittedFields, {}), draftModified],
  );
  return row.id;
}

export async function cleanupExpiredPartnerAiAudio() {
  const rows = await withSystem(async (client) => (await client.query(
    "SELECT * FROM partner_ai_transcriptions WHERE deleted_at IS NULL AND expires_at<now() AND (next_cleanup_at IS NULL OR next_cleanup_at<=now()) ORDER BY expires_at LIMIT 100",
  )).rows);
  for (const row of rows) {
    try {
      await deleteAudioObject(row);
      await withSystem((client) => client.query(
        "UPDATE partner_ai_transcriptions SET status=CASE WHEN status='completed' THEN status ELSE 'deleted' END,deleted_at=now(),cleanup_error='',next_cleanup_at=NULL WHERE id=$1",
        [row.id],
      ));
    } catch (error) {
      await withSystem((client) => client.query(
        "UPDATE partner_ai_transcriptions SET error_code='audio_cleanup_failed',cleanup_error=$2,cleanup_attempts=cleanup_attempts+1,next_cleanup_at=now()+least(interval '60 minutes',interval '1 minute'*power(2,least(cleanup_attempts,6))) WHERE id=$1",
        [row.id, String(error?.message || "cleanup_failed").slice(0, 500)],
      )).catch(() => {});
    }
  }
  await withSystem(async (client) => {
    await client.query("UPDATE partner_ai_transcriptions SET status='failed',error_code='asr_worker_interrupted' WHERE status='processing' AND updated_at<now()-interval '2 minutes'");
    await client.query("UPDATE partner_ai_drafts SET status='failed',warnings='[\"draft_worker_interrupted\"]'::jsonb WHERE status='processing' AND updated_at<now()-interval '2 minutes'");
    await client.query("UPDATE partner_ai_transcriptions SET transcript='',transcript_purged_at=now() WHERE completed_at<now()-interval '30 days' AND transcript<>'' AND transcript_purged_at IS NULL");
    await client.query("UPDATE partner_ai_drafts SET source_text='',draft_json='{}'::jsonb,evidence_json='[]'::jsonb,missing_fields='[]'::jsonb,warnings='[]'::jsonb,content_purged_at=now() WHERE created_at<now()-interval '90 days' AND content_purged_at IS NULL");
    await client.query("UPDATE partner_ai_sessions SET state='expired' WHERE state NOT IN ('submitted','expired') AND expires_at<now()");
    await client.query("UPDATE partner_ai_sessions SET source_text='',collected_fields='{}'::jsonb,submitted_fields='{}'::jsonb,missing_fields='[]'::jsonb,warnings='[]'::jsonb,candidate_ids='[]'::jsonb,next_question='',draft_modified=NULL,content_purged_at=now() WHERE created_at<now()-interval '90 days' AND content_purged_at IS NULL");
  });
  return rows.length;
}

export async function getPartnerAiHealth() {
  const [{ config }, metrics] = await Promise.all([
    getPartnerAiSettings(),
    withSystem(async (client) => (await client.query(`
      SELECT
        count(*) FILTER (WHERE t.created_at>=now()-interval '24 hours')::int AS transcriptions_24h,
        count(*) FILTER (WHERE t.created_at>=now()-interval '24 hours' AND t.status='completed')::int AS transcriptions_completed_24h,
        count(*) FILTER (WHERE t.created_at>=now()-interval '24 hours' AND t.status='failed')::int AS transcriptions_failed_24h,
        count(*) FILTER (WHERE t.deleted_at IS NULL AND t.expires_at<now())::int AS cleanup_pending,
        count(*) FILTER (WHERE t.deleted_at IS NULL AND t.cleanup_attempts>0)::int AS cleanup_failures,
        (SELECT count(*)::int FROM partner_ai_drafts d WHERE d.created_at>=now()-interval '24 hours') AS drafts_24h,
        (SELECT count(*)::int FROM partner_ai_drafts d WHERE d.created_at>=now()-interval '24 hours' AND d.status IN ('generated','applied','submitted')) AS drafts_succeeded_24h,
        (SELECT count(*)::int FROM partner_ai_drafts d WHERE d.created_at>=now()-interval '24 hours' AND d.status='submitted') AS drafts_submitted_24h,
        (SELECT count(*)::int FROM partner_ai_sessions s WHERE s.created_at>=now()-interval '24 hours') AS sessions_24h,
        (SELECT count(*)::int FROM partner_ai_sessions s WHERE s.created_at>=now()-interval '24 hours' AND s.state='submitted') AS sessions_submitted_24h,
        (SELECT count(*)::int FROM partner_ai_sessions s WHERE s.created_at>=now()-interval '24 hours' AND s.candidate_count>0) AS sessions_matched_24h,
        (SELECT count(*)::int FROM partner_ai_sessions s WHERE s.created_at>=now()-interval '24 hours' AND s.candidate_count>1) AS sessions_ambiguous_24h,
        (SELECT count(*)::int FROM partner_ai_sessions s WHERE s.created_at>=now()-interval '24 hours' AND s.draft_modified=true) AS sessions_draft_modified_24h,
        (SELECT coalesce(avg(s.question_count),0) FROM partner_ai_sessions s WHERE s.created_at>=now()-interval '24 hours') AS average_questions_24h,
        (SELECT coalesce(avg(s.candidate_count),0) FROM partner_ai_sessions s WHERE s.created_at>=now()-interval '24 hours' AND s.candidate_count>0) AS average_candidate_count_24h,
        (SELECT coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY d.latency_ms),0)::int FROM partner_ai_drafts d WHERE d.created_at>=now()-interval '24 hours' AND d.latency_ms>0) AS draft_p95_ms,
        max(t.created_at) AS last_transcription_at,
        (SELECT max(d.created_at) FROM partner_ai_drafts d) AS last_draft_at
      FROM partner_ai_transcriptions t
    `)).rows[0]),
  ]);
  return {
    ok: true,
    status: config.enabled ? "enabled" : "disabled",
    voiceReady: Boolean(config.voiceEnabled && config.asr.secretId && config.asr.secretKey),
    metrics: Object.fromEntries(Object.entries(metrics || {}).map(([key, value]) => [
      key,
      /_at$/.test(key) ? (value ? new Date(value).toISOString() : "") : (Number.isNaN(Number(value)) ? value : Number(value || 0)),
    ])),
    checkedAt: new Date().toISOString(),
  };
}

export const partnerAiLimits = { maxAudioBytes: MAX_AUDIO_BYTES, maxAudioDurationMs: MAX_AUDIO_DURATION_MS };
export { assertAudioContent as validatePartnerAiAudioContent };
