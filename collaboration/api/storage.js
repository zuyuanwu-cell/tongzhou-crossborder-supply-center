import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";
import { collaborationConfig } from "./config.js";
import { withOrganization } from "./db.js";
import { assertWorkItemPermission } from "./access.js";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const allowedMimeTypes = new Set([
  "image/jpeg", "image/png", "image/webp", "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
]);
const uploadSchema = z.object({
  workItemId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(240),
  mimeType: z.string().trim().min(1).max(160),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
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

function fail(message, statusCode = 400, code = "invalid_attachment") {
  throw Object.assign(new Error(message), { statusCode, code });
}

function assertAttachmentContributor(auth) {
  if (!auth?.membership || !["organization_admin", "manager", "operator"].includes(auth.membership.role)) fail("当前岗位无权上传附件。", 403, "forbidden");
}

function safeName(value) {
  return basename(String(value || "file")).replace(/[^\p{L}\p{N}._ -]+/gu, "_").slice(0, 180) || "file";
}

function localPath(objectKey) {
  const path = resolve(collaborationConfig.storageDir, objectKey);
  if (!path.startsWith(resolve(collaborationConfig.storageDir))) throw new Error("Invalid object key.");
  return path;
}

export async function createAttachmentUpload(auth, input) {
  assertAttachmentContributor(auth);
  const parsed = uploadSchema.parse(input);
  if (!allowedMimeTypes.has(parsed.mimeType)) fail("不支持该附件类型。", 415, "unsupported_media_type");
  return withOrganization(auth.organization.id, async (client) => {
    const item = await client.query("SELECT * FROM work_items WHERE id=$1 AND organization_id=$2", [parsed.workItemId, auth.organization.id]);
    if (!item.rows[0]) fail("任务不存在。", 404, "not_found");
    await assertWorkItemPermission(client, auth.organization.id, item.rows[0], "attachment.upload");
    const id = randomUUID();
    const objectKey = `${auth.organization.id}/${parsed.workItemId}/${id}-${safeName(parsed.fileName)}`;
    await client.query(
      `INSERT INTO attachments(id,organization_id,work_item_id,object_key,file_name,mime_type,size_bytes,uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, auth.organization.id, parsed.workItemId, objectKey, parsed.fileName, parsed.mimeType, parsed.sizeBytes, auth.user.id],
    );
    if (collaborationConfig.storageDriver === "s3") {
      const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket: collaborationConfig.s3.bucket, Key: objectKey, ContentType: parsed.mimeType, ContentLength: parsed.sizeBytes }), { expiresIn: 300 });
      return { attachmentId: id, uploadUrl, uploadMethod: "PUT", expiresInSeconds: 300, requiredHeaders: { "Content-Type": parsed.mimeType } };
    }
    return { attachmentId: id, uploadUrl: `/collaboration/v1/attachments/${id}/content`, uploadMethod: "PUT", expiresInSeconds: 900, requiredHeaders: { "Content-Type": parsed.mimeType } };
  });
}

async function attachmentForOrg(auth, attachmentId, permission) {
  return withOrganization(auth.organization.id, async (client) => {
    const result = await client.query(
      `SELECT attachments.*,work_items.item_type,work_items.public_payload
         FROM attachments JOIN work_items ON work_items.id=attachments.work_item_id
        WHERE attachments.id=$1 AND attachments.organization_id=$2`,
      [attachmentId, auth.organization.id],
    );
    if (!result.rows[0]) fail("附件不存在。", 404, "not_found");
    await assertWorkItemPermission(client, auth.organization.id, result.rows[0], permission);
    return result.rows[0];
  });
}

export async function receiveLocalUpload(auth, attachmentId, req) {
  assertAttachmentContributor(auth);
  if (collaborationConfig.storageDriver !== "local") fail("本地上传入口未启用。", 404, "not_found");
  const attachment = await attachmentForOrg(auth, attachmentId, "attachment.upload");
  const contentLength = Number(req.headers["content-length"] || 0);
  if (!contentLength || contentLength !== Number(attachment.size_bytes) || contentLength > MAX_UPLOAD_BYTES) fail("附件大小与申请信息不一致。", 400, "size_mismatch");
  if (String(req.headers["content-type"] || "").split(";")[0] !== attachment.mime_type) fail("附件类型与申请信息不一致。", 400, "mime_mismatch");
  const path = localPath(attachment.object_key);
  mkdirSync(resolve(path, ".."), { recursive: true });
  const temporary = `${path}.uploading`;
  const digest = createHash("sha256");
  req.on("data", (chunk) => digest.update(chunk));
  await pipeline(req, createWriteStream(temporary, { flags: "wx" }));
  if (statSync(temporary).size !== contentLength) { unlinkSync(temporary); fail("附件传输不完整。", 400, "incomplete_upload"); }
  renameSync(temporary, path);
  const sha256 = digest.digest("hex");
  await withOrganization(auth.organization.id, (client) => client.query(
    "UPDATE attachments SET sha256=$3,scan_status=$4 WHERE id=$1 AND organization_id=$2",
    [attachmentId, auth.organization.id, sha256, collaborationConfig.trustLocalUploads ? "clean" : "pending"],
  ));
  if (!collaborationConfig.trustLocalUploads) await scanAttachment(auth, attachmentId);
  return { ok: true, attachmentId, sha256, scanStatus: collaborationConfig.trustLocalUploads ? "clean" : "pending" };
}

async function runClamScan(path) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(collaborationConfig.clamscanPath, ["--no-summary", path], { windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => resolvePromise({ clean: code === 0, infected: code === 1, output: output.slice(-2_000) }));
  });
}

export async function scanAttachment(auth, attachmentId) {
  assertAttachmentContributor(auth);
  const attachment = await attachmentForOrg(auth, attachmentId, "attachment.upload");
  let path = "";
  let temporary = false;
  try {
    if (collaborationConfig.storageDriver === "local") {
      path = localPath(attachment.object_key);
      if (!existsSync(path)) fail("附件内容尚未上传。", 409, "upload_incomplete");
    } else {
      path = resolve(collaborationConfig.storageDir, `scan-${attachment.id}`);
      mkdirSync(collaborationConfig.storageDir, { recursive: true });
      const object = await s3.send(new GetObjectCommand({ Bucket: collaborationConfig.s3.bucket, Key: attachment.object_key }));
      await pipeline(object.Body, createWriteStream(path, { flags: "wx" }));
      temporary = true;
    }
    const scan = await runClamScan(path);
    const status = scan.clean ? "clean" : scan.infected ? "rejected" : "failed";
    await withOrganization(auth.organization.id, (client) => client.query("UPDATE attachments SET scan_status=$3 WHERE id=$1 AND organization_id=$2", [attachmentId, auth.organization.id, status]));
    return { attachmentId, scanStatus: status };
  } catch (error) {
    await withOrganization(auth.organization.id, (client) => client.query("UPDATE attachments SET scan_status='failed' WHERE id=$1 AND organization_id=$2", [attachmentId, auth.organization.id])).catch(() => {});
    throw error;
  } finally {
    if (temporary && path && existsSync(path)) unlinkSync(path);
  }
}

export async function completeS3Upload(auth, attachmentId) {
  assertAttachmentContributor(auth);
  if (collaborationConfig.storageDriver !== "s3") return scanAttachment(auth, attachmentId);
  const attachment = await attachmentForOrg(auth, attachmentId, "attachment.upload");
  const head = await s3.send(new HeadObjectCommand({ Bucket: collaborationConfig.s3.bucket, Key: attachment.object_key }));
  if (Number(head.ContentLength || 0) !== Number(attachment.size_bytes)) fail("附件大小与申请信息不一致。", 400, "size_mismatch");
  if (String(head.ContentType || "") !== attachment.mime_type) fail("附件类型与申请信息不一致。", 400, "mime_mismatch");
  return scanAttachment(auth, attachmentId);
}

export async function attachmentDownload(auth, attachmentId) {
  const attachment = await attachmentForOrg(auth, attachmentId);
  if (attachment.scan_status !== "clean") fail("附件尚未通过安全检查。", 423, "attachment_not_clean");
  if (collaborationConfig.storageDriver === "s3") {
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: collaborationConfig.s3.bucket, Key: attachment.object_key, ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(attachment.file_name)}` }), { expiresIn: 60 });
    return { redirectUrl: url, attachment };
  }
  const path = localPath(attachment.object_key);
  if (!existsSync(path)) fail("附件内容不存在。", 404, "not_found");
  return { stream: createReadStream(path), attachment };
}
