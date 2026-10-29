import http from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { collaborationConfig } from "./config.js";
import { closePools, integrationPool } from "./db.js";
import { workspaceForSession } from "./workspace.js";
import { migrate } from "./migrate.js";
import {
  assertAuthenticated,
  assertCsrf,
  authenticate,
  login,
  logout,
  refreshCsrfCookies,
} from "./auth.js";
import { bindWechat, unbindWechat, wechatBindingStatus, wechatLogin } from "./wechat-auth.js";
import {
  createWarehouseOperation,
  getWorkItem,
  listInventory,
  listNotifications,
  listWorkItems,
  markNotificationRead,
  organizationDashboard,
  submitWorkItemAction,
} from "./repository.js";
import {
  applyCollaborationProjection,
  applyInventoryProjection,
  assertInternalRequest,
  completeCommand,
  getInternalWorkItem,
  listInternalWorkItems,
  listPendingCommands,
  reconcileInternalWorkItems,
  remindInternalWorkItem,
  reviewCommand,
} from "./integration.js";
import {
  attachmentDownload,
  completeS3Upload,
  createAttachmentUpload,
  internalAttachmentUpload,
  internalAttachmentDownload,
  receiveLocalUpload,
} from "./storage.js";
import { runNotificationDeliveryBatch } from "./notifications.js";
import {
  applyOemProjection,
  awardInternalQuote,
  listInternalQuotes,
  reviewInternalSampleArtifact,
  submitOemArtifact,
  submitSupplierQuote,
  updateProductionMilestone,
} from "./oem.js";
import { applyPartnerOrderProjection, submitPartnerOrderReport } from "./partner-orders.js";
import {
  cleanupExpiredPartnerAiAudio,
  completePartnerAiTranscription,
  completePartnerAiSessionTranscription,
  createPartnerAiTranscription,
  createPartnerAiSessionTranscription,
  createPartnerProgressDraft,
  getPartnerAiTranscription,
  getPartnerAiSessionTranscription,
  getPartnerAiHealth,
  markPartnerAiDraftApplied,
  receivePartnerAiAudio,
  receivePartnerAiSessionAudio,
} from "./partner-ai.js";
import {
  confirmPartnerAiSessionOrder,
  createPartnerAiSession,
  getPartnerAiSession,
  messagePartnerAiSession,
} from "./partner-ai-sessions.js";
import {
  getPartnerAiSettings,
  partnerAiCapabilitiesFor,
  publicPartnerAiSettings,
  savePartnerAiSettings,
  testPartnerAiAsrConnection,
} from "./partner-ai-settings.js";
import { withDataContext } from "../shared/data-context.js";
import {
  acceptInvitation,
  bootstrapOrganization,
  changeOwnPassword,
  confirmPasswordReset,
  createInvitation,
  createMember,
  getOrganizationAccess,
  listInvitations,
  listMembers,
  listOrganizations,
  listOwnSessions,
  provisionOrganization,
  reissueInvitation,
  reissueInvitationInternally,
  requestPasswordReset,
  revokeInvitation,
  revokeInvitationInternally,
  revokeOwnSession,
  updateMember,
  updateMemberCredentialsInternally,
  updateOwnProfile,
  updateOrganizationStatus,
} from "./identity.js";
import { listOrganizationAccessGrants, replaceOrganizationAccessGrants } from "./access.js";

const MAX_JSON_BYTES = 2 * 1024 * 1024;
const uuidPattern = "([0-9a-fA-F-]{36})";
const organizationCodePattern = "([a-z0-9][a-z0-9_-]{1,63})";

function applySecurityHeaders(req, res) {
  const origin = String(req.headers.origin || "");
  if (origin && origin === collaborationConfig.publicOrigin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token, Idempotency-Key, If-Match, Authorization, X-AI-Draft-Id");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
}

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), ...headers });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw Object.assign(new Error("请求内容过大。"), { statusCode: 413, code: "payload_too_large" });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("请求不是有效的 JSON。"), { statusCode: 400, code: "invalid_json" });
  }
}

async function readRawBody(req, maxBytes = 50 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("附件不能超过 50MB。"), { statusCode: 413, code: "attachment_too_large" });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function queryObject(url) {
  return Object.fromEntries(url.searchParams.entries());
}

async function publicSession(auth) {
  return {
    user: auth.user,
    membership: auth.membership,
    organization: auth.organization,
    mfaRequired: false,
    mfaEnabled: false,
    mfaVerifiedAt: "",
    pendingMfa: false,
    mustChangePassword: false,
    oemEnabled: collaborationConfig.oemEnabled,
    workspace: await workspaceForSession(auth),
  };
}

async function route(req, res) {
  applySecurityHeaders(req, res);
  const requestId = String(req.headers["x-request-id"] || randomUUID()).slice(0, 100);
  res.setHeader("X-Request-Id", requestId);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/collaboration/health" && req.method === "GET") {
    const database = await integrationPool.query("SELECT now() AS now");
    sendJson(res, 200, { ok: true, service: "tongzhou-collaboration", databaseTime: database.rows[0].now, oemEnabled: collaborationConfig.oemEnabled });
    return;
  }

  if (url.pathname === "/collaboration/auth/login" && req.method === "POST") {
    const result = await login(req, await readJson(req));
    const wechat = await wechatBindingStatus(result.auth.user.id).catch(() => ({ configured: false, bound: false, boundAt: "" }));
    sendJson(res, 200, { ok: true, session: await publicSession(result.auth), mfaSetupRequired: result.mfaSetupRequired, wechat }, { "Set-Cookie": result.cookies });
    return;
  }

  if (url.pathname === "/collaboration/auth/wechat/login" && req.method === "POST") {
    const result = await wechatLogin(req, await readJson(req));
    sendJson(res, 200, { ok: true, session: await publicSession(result.auth), mfaSetupRequired: result.mfaSetupRequired, wechat: { configured: true, bound: true } }, { "Set-Cookie": result.cookies });
    return;
  }

  if (url.pathname === "/collaboration/auth/invitations/accept" && req.method === "POST") {
    sendJson(res, 200, { ok: true, ...(await acceptInvitation(await readJson(req))) });
    return;
  }
  if (url.pathname === "/collaboration/auth/password-reset/request" && req.method === "POST") {
    sendJson(res, 202, { ok: true, ...(await requestPasswordReset(req, await readJson(req))) });
    return;
  }
  if (url.pathname === "/collaboration/auth/password-reset/confirm" && req.method === "POST") {
    sendJson(res, 200, { ok: true, ...(await confirmPasswordReset(await readJson(req))) });
    return;
  }

  const auth = await authenticate(req, { allowPendingMfa: url.pathname === "/collaboration/me" });
  if (url.pathname === "/collaboration/me" && req.method === "GET") {
    if (!auth) { sendJson(res, 401, { ok: false, code: "authentication_required", message: "请先登录。" }); return; }
    const cookies = refreshCsrfCookies(req, auth);
    sendJson(res, 200, { ok: true, session: await publicSession(auth) }, cookies.length ? { "Set-Cookie": cookies } : {});
    return;
  }

  if (url.pathname === "/collaboration/auth/logout" && req.method === "POST") {
    if (auth) assertCsrf(req, auth);
    const cookies = await logout(req, auth);
    sendJson(res, 200, { ok: true }, { "Set-Cookie": cookies });
    return;
  }

  if (url.pathname.startsWith("/collaboration/internal/")) {
    assertInternalRequest(req);
    if (url.pathname === "/collaboration/internal/v1/partner-ai/config" && req.method === "GET") {
      sendJson(res, 200, { ok: true, config: publicPartnerAiSettings(await getPartnerAiSettings()) });
      return;
    }
    if (url.pathname === "/collaboration/internal/v1/partner-ai/config" && req.method === "PUT") {
      const input = await readJson(req);
      const { actorId = "internal-admin", ...settings } = input;
      sendJson(res, 200, { ok: true, config: publicPartnerAiSettings(await savePartnerAiSettings(settings, String(actorId))) });
      return;
    }
    if (url.pathname === "/collaboration/internal/v1/partner-ai/config/test" && req.method === "POST") {
      sendJson(res, 200, await testPartnerAiAsrConnection(await readJson(req)));
      return;
    }
    if (url.pathname === "/collaboration/internal/v1/partner-ai/health" && req.method === "GET") {
      sendJson(res, 200, await getPartnerAiHealth());
      return;
    }
    if (url.pathname === "/collaboration/internal/v1/organizations" && req.method === "GET") {
      sendJson(res, 200, { ok: true, ...(await listOrganizations(queryObject(url))) });
      return;
    }
    if (url.pathname === "/collaboration/internal/v1/organizations" && req.method === "POST") {
      sendJson(res, 200, { ok: true, ...(await provisionOrganization(await readJson(req))) });
      return;
    }
    if (url.pathname === "/collaboration/internal/v1/organizations/bootstrap" && req.method === "POST") {
      sendJson(res, 201, { ok: true, ...(await bootstrapOrganization(await readJson(req))) });
      return;
    }
    let organizationMatch = url.pathname.match(new RegExp(`^/collaboration/internal/v1/organizations/${organizationCodePattern}$`));
    if (organizationMatch && req.method === "GET") {
      sendJson(res, 200, { ok: true, ...(await getOrganizationAccess(organizationMatch[1])) });
      return;
    }
    if (organizationMatch && req.method === "PATCH") {
      sendJson(res, 200, { ok: true, ...(await updateOrganizationStatus(organizationMatch[1], await readJson(req))) });
      return;
    }
    const internalMemberCredentialsMatch = url.pathname.match(new RegExp(`^/collaboration/internal/v1/organizations/${organizationCodePattern}/members/${uuidPattern}/credentials$`));
    if (internalMemberCredentialsMatch && req.method === "PATCH") {
      sendJson(res, 200, { ok: true, ...(await updateMemberCredentialsInternally(internalMemberCredentialsMatch[1], internalMemberCredentialsMatch[2], await readJson(req))) });
      return;
    }
    const accessGrantMatch = url.pathname.match(new RegExp(`^/collaboration/internal/v1/organizations/${organizationCodePattern}/access-grants$`));
    if (accessGrantMatch && req.method === "GET") {
      sendJson(res, 200, { ok: true, ...(await listOrganizationAccessGrants(accessGrantMatch[1])) });
      return;
    }
    if (accessGrantMatch && req.method === "PUT") {
      sendJson(res, 200, { ok: true, ...(await replaceOrganizationAccessGrants(accessGrantMatch[1], await readJson(req))) });
      return;
    }
    let internalInvitationMatch = url.pathname.match(new RegExp(`^/collaboration/internal/v1/invitations/${uuidPattern}/(reissue|revoke)$`));
    if (internalInvitationMatch && req.method === "POST") {
      const input = await readJson(req);
      const result = internalInvitationMatch[2] === "reissue"
        ? await reissueInvitationInternally(internalInvitationMatch[1], input.actorName)
        : await revokeInvitationInternally(internalInvitationMatch[1], input.actorName);
      sendJson(res, 200, { ok: true, ...result });
      return;
    }
    if (url.pathname === "/collaboration/internal/v1/projections" && req.method === "PUT") {
      sendJson(res, 200, await applyCollaborationProjection(await readJson(req)));
      return;
    }
    if (url.pathname === "/collaboration/internal/v1/inventory" && req.method === "PUT") {
      sendJson(res, 200, await applyInventoryProjection(await readJson(req)));
      return;
    }
    if (url.pathname === "/collaboration/internal/v1/work-items" && req.method === "GET") {
      sendJson(res, 200, { ok: true, ...(await listInternalWorkItems(queryObject(url))) });
      return;
    }
    if (url.pathname === "/collaboration/internal/v1/work-items/reconcile" && req.method === "POST") {
      sendJson(res, 200, await reconcileInternalWorkItems(await readJson(req)));
      return;
    }
    let internalWorkItemMatch = url.pathname.match(new RegExp(`^/collaboration/internal/v1/work-items/${uuidPattern}$`));
    if (internalWorkItemMatch && req.method === "GET") {
      sendJson(res, 200, { ok: true, ...(await getInternalWorkItem(internalWorkItemMatch[1])) });
      return;
    }
    internalWorkItemMatch = url.pathname.match(new RegExp(`^/collaboration/internal/v1/work-items/${uuidPattern}/remind$`));
    if (internalWorkItemMatch && req.method === "POST") {
      sendJson(res, 200, await remindInternalWorkItem(internalWorkItemMatch[1], await readJson(req)));
      return;
    }
    internalWorkItemMatch = url.pathname.match(new RegExp(`^/collaboration/internal/v1/work-items/${uuidPattern}/attachments$`));
    if (internalWorkItemMatch && req.method === "PUT") {
      const fileName = decodeURIComponent(String(req.headers["x-file-name"] || ""));
      const actorName = decodeURIComponent(String(req.headers["x-actor-name"] || "供应链中台管理员"));
      const mimeType = String(req.headers["content-type"] || "").split(";")[0].trim();
      const buffer = await readRawBody(req);
      sendJson(res, 201, { ok: true, ...(await internalAttachmentUpload(internalWorkItemMatch[1], { fileName, mimeType, buffer, actorName })) });
      return;
    }
    internalWorkItemMatch = url.pathname.match(new RegExp(`^/collaboration/internal/v1/work-items/${uuidPattern}/attachments/${uuidPattern}$`));
    if (internalWorkItemMatch && req.method === "GET") {
      const download = await internalAttachmentDownload(internalWorkItemMatch[1], internalWorkItemMatch[2]);
      if (download.redirectUrl) { res.writeHead(302, { Location: download.redirectUrl }); res.end(); return; }
      res.writeHead(200, { "Content-Type": download.attachment.mime_type, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(download.attachment.file_name)}`, "Content-Length": download.attachment.size_bytes, "Cache-Control": "private, no-store" });
      download.stream.pipe(res);
      return;
    }
    if (url.pathname === "/collaboration/internal/v1/oem/projections" && req.method === "PUT") {
      sendJson(res, 200, await applyOemProjection(await readJson(req)));
      return;
    }
    if (url.pathname === "/collaboration/internal/v1/partner-orders/projections" && req.method === "PUT") {
      sendJson(res, 200, await applyPartnerOrderProjection(await readJson(req)));
      return;
    }
    if (url.pathname === "/collaboration/internal/v1/oem/quotes" && req.method === "GET") {
      sendJson(res, 200, { ok: true, ...(await listInternalQuotes(queryObject(url))) });
      return;
    }
    let oemMatch = url.pathname.match(new RegExp(`^/collaboration/internal/v1/oem/quotes/${uuidPattern}/award$`));
    if (oemMatch && req.method === "POST") {
      sendJson(res, 200, await awardInternalQuote(oemMatch[1], await readJson(req)));
      return;
    }
    oemMatch = url.pathname.match(new RegExp(`^/collaboration/internal/v1/oem/artifacts/${uuidPattern}/review$`));
    if (oemMatch && req.method === "POST") {
      sendJson(res, 200, await reviewInternalSampleArtifact(oemMatch[1], await readJson(req)));
      return;
    }
    if (url.pathname === "/collaboration/internal/v1/commands" && req.method === "GET") {
      sendJson(res, 200, { ok: true, ...(await listPendingCommands(queryObject(url))) });
      return;
    }
    let match = url.pathname.match(new RegExp(`^/collaboration/internal/v1/commands/${uuidPattern}/review$`));
    if (match && req.method === "POST") {
      sendJson(res, 200, await reviewCommand(match[1], await readJson(req)));
      return;
    }
    match = url.pathname.match(new RegExp(`^/collaboration/internal/v1/commands/${uuidPattern}/result$`));
    if (match && req.method === "POST") {
      sendJson(res, 200, await completeCommand(match[1], await readJson(req)));
      return;
    }
    sendJson(res, 404, { ok: false, code: "not_found", message: "Internal route not found." });
    return;
  }

  assertAuthenticated(auth);
  if (!["GET", "HEAD"].includes(req.method || "GET")) assertCsrf(req, auth);

  if (url.pathname === "/collaboration/v1/account/profile" && req.method === "PATCH") {
    sendJson(res, 200, { ok: true, ...(await updateOwnProfile(auth, await readJson(req))) });
    return;
  }
  if (url.pathname === "/collaboration/v1/account/wechat" && req.method === "GET") {
    sendJson(res, 200, { ok: true, wechat: await wechatBindingStatus(auth.user.id) });
    return;
  }
  if (url.pathname === "/collaboration/v1/account/wechat/bind" && req.method === "POST") {
    sendJson(res, 200, { ok: true, wechat: await bindWechat(req, auth, await readJson(req)) });
    return;
  }
  if (url.pathname === "/collaboration/v1/account/wechat/unbind" && req.method === "POST") {
    sendJson(res, 200, { ok: true, wechat: await unbindWechat(req, auth) });
    return;
  }
  if (url.pathname === "/collaboration/v1/account/password" && req.method === "POST") {
    sendJson(res, 200, { ok: true, ...(await changeOwnPassword(auth, await readJson(req))) });
    return;
  }

  if (url.pathname === "/collaboration/v1/dashboard" && req.method === "GET") {
    const [dashboard, partnerAi] = await Promise.all([
      organizationDashboard(auth),
      partnerAiCapabilitiesFor(auth.organization.id),
    ]);
    sendJson(res, 200, {
      ok: true,
      dashboard: withDataContext({ ...dashboard, partnerAi }, {
        generatedAt: new Date().toISOString(),
        effectiveAt: dashboard.inventorySyncedAt || new Date().toISOString(),
        source: "derived",
        scopeKey: `organization_${auth.organization.id}`,
        scopeLabel: `${auth.organization.name} · 已授权任务与仓库`,
        completeness: dashboard.inventorySyncedAt ? "complete" : "partial",
        coverage: { completed: dashboard.inventorySyncedAt ? 1 : 0, total: 1, unit: "warehouse" },
      }),
    });
    return;
  }
  if (url.pathname === "/collaboration/v1/partner-ai/sessions" && req.method === "POST") {
    sendJson(res, 201, await createPartnerAiSession(auth, await readJson(req)));
    return;
  }
  let partnerAiSessionMatch = url.pathname.match(new RegExp(`^/collaboration/v1/partner-ai/sessions/${uuidPattern}$`));
  if (partnerAiSessionMatch && req.method === "GET") {
    sendJson(res, 200, await getPartnerAiSession(auth, partnerAiSessionMatch[1]));
    return;
  }
  partnerAiSessionMatch = url.pathname.match(new RegExp(`^/collaboration/v1/partner-ai/sessions/${uuidPattern}/messages$`));
  if (partnerAiSessionMatch && req.method === "POST") {
    sendJson(res, 200, await messagePartnerAiSession(auth, partnerAiSessionMatch[1], await readJson(req)));
    return;
  }
  partnerAiSessionMatch = url.pathname.match(new RegExp(`^/collaboration/v1/partner-ai/sessions/${uuidPattern}/order-confirmation$`));
  if (partnerAiSessionMatch && req.method === "POST") {
    sendJson(res, 200, await confirmPartnerAiSessionOrder(auth, partnerAiSessionMatch[1], await readJson(req)));
    return;
  }
  partnerAiSessionMatch = url.pathname.match(new RegExp(`^/collaboration/v1/partner-ai/sessions/${uuidPattern}/audio-tickets$`));
  if (partnerAiSessionMatch && req.method === "POST") {
    const result = await createPartnerAiSessionTranscription(auth, partnerAiSessionMatch[1], await readJson(req), { idempotencyKey: req.headers["idempotency-key"] });
    sendJson(res, result.idempotentReplay ? 200 : 201, { ok: true, ...result });
    return;
  }
  partnerAiSessionMatch = url.pathname.match(new RegExp(`^/collaboration/v1/partner-ai/sessions/${uuidPattern}/transcriptions/${uuidPattern}/content$`));
  if (partnerAiSessionMatch && req.method === "PUT") {
    sendJson(res, 200, await receivePartnerAiSessionAudio(auth, partnerAiSessionMatch[1], partnerAiSessionMatch[2], req));
    return;
  }
  partnerAiSessionMatch = url.pathname.match(new RegExp(`^/collaboration/v1/partner-ai/sessions/${uuidPattern}/transcriptions/${uuidPattern}$`));
  if (partnerAiSessionMatch && req.method === "GET") {
    sendJson(res, 200, { ok: true, ...(await getPartnerAiSessionTranscription(auth, partnerAiSessionMatch[1], partnerAiSessionMatch[2])) });
    return;
  }
  partnerAiSessionMatch = url.pathname.match(new RegExp(`^/collaboration/v1/partner-ai/sessions/${uuidPattern}/transcriptions/${uuidPattern}/complete$`));
  if (partnerAiSessionMatch && req.method === "POST") {
    sendJson(res, 200, { ok: true, ...(await completePartnerAiSessionTranscription(auth, partnerAiSessionMatch[1], partnerAiSessionMatch[2])) });
    return;
  }
  if (url.pathname === "/collaboration/v1/admin/members" && req.method === "GET") {
    sendJson(res, 200, { ok: true, ...(await listMembers(auth)) });
    return;
  }
  if (url.pathname === "/collaboration/v1/admin/members" && req.method === "POST") {
    sendJson(res, 201, { ok: true, ...(await createMember(auth, await readJson(req))) });
    return;
  }
  if (url.pathname === "/collaboration/v1/admin/invitations" && req.method === "GET") {
    sendJson(res, 200, { ok: true, ...(await listInvitations(auth)) });
    return;
  }
  if (url.pathname === "/collaboration/v1/admin/invitations" && req.method === "POST") {
    sendJson(res, 201, { ok: true, ...(await createInvitation(auth, await readJson(req))) });
    return;
  }
  let invitationMatch = url.pathname.match(new RegExp(`^/collaboration/v1/admin/invitations/${uuidPattern}/(reissue|revoke)$`));
  if (invitationMatch && req.method === "POST") {
    const result = invitationMatch[2] === "reissue"
      ? await reissueInvitation(auth, invitationMatch[1])
      : await revokeInvitation(auth, invitationMatch[1]);
    sendJson(res, 200, { ok: true, ...result });
    return;
  }
  let identityMatch = url.pathname.match(new RegExp(`^/collaboration/v1/admin/members/${uuidPattern}$`));
  if (identityMatch && req.method === "PATCH") {
    sendJson(res, 200, { ok: true, ...(await updateMember(auth, identityMatch[1], await readJson(req))) });
    return;
  }
  if (url.pathname === "/collaboration/v1/sessions" && req.method === "GET") {
    sendJson(res, 200, { ok: true, ...(await listOwnSessions(auth)) });
    return;
  }
  identityMatch = url.pathname.match(new RegExp(`^/collaboration/v1/sessions/${uuidPattern}$`));
  if (identityMatch && req.method === "DELETE") {
    sendJson(res, 200, { ok: true, ...(await revokeOwnSession(auth, identityMatch[1])) });
    return;
  }
  if (url.pathname === "/collaboration/v1/work-items" && req.method === "GET") {
    sendJson(res, 200, { ok: true, ...(await listWorkItems(auth, queryObject(url))) });
    return;
  }
  if (url.pathname === "/collaboration/v1/warehouse-operations" && req.method === "POST") {
    const result = await createWarehouseOperation(auth, await readJson(req), {
      idempotencyKey: String(req.headers["idempotency-key"] || ""),
    });
    sendJson(res, result.idempotentReplay ? 200 : 201, { ok: true, ...result });
    return;
  }
  let match = url.pathname.match(new RegExp(`^/collaboration/v1/work-items/${uuidPattern}$`));
  if (match && req.method === "GET") {
    const [workItem, partnerAi] = await Promise.all([
      getWorkItem(auth, match[1]),
      partnerAiCapabilitiesFor(auth.organization.id),
    ]);
    sendJson(res, 200, { ok: true, ...workItem, partnerAi });
    return;
  }
  match = url.pathname.match(new RegExp(`^/collaboration/v1/work-items/${uuidPattern}/actions$`));
  if (match && req.method === "POST") {
    const result = await submitWorkItemAction(auth, match[1], await readJson(req), {
      idempotencyKey: String(req.headers["idempotency-key"] || ""),
      expectedVersion: String(req.headers["if-match"] || "").replace(/^W\//, "").replace(/"/g, ""),
      aiDraftId: String(req.headers["x-ai-draft-id"] || ""),
    });
    sendJson(res, result.idempotentReplay ? 200 : 201, { ok: true, ...result });
    return;
  }
  match = url.pathname.match(new RegExp(`^/collaboration/v1/work-items/${uuidPattern}/ai-transcriptions$`));
  if (match && req.method === "POST") {
    const result = await createPartnerAiTranscription(auth, match[1], await readJson(req), { idempotencyKey: req.headers["idempotency-key"] });
    sendJson(res, result.idempotentReplay ? 200 : 201, { ok: true, ...result });
    return;
  }
  match = url.pathname.match(new RegExp(`^/collaboration/v1/work-items/${uuidPattern}/ai-transcriptions/${uuidPattern}/content$`));
  if (match && req.method === "PUT") {
    sendJson(res, 200, await receivePartnerAiAudio(auth, match[1], match[2], req));
    return;
  }
  match = url.pathname.match(new RegExp(`^/collaboration/v1/work-items/${uuidPattern}/ai-transcriptions/${uuidPattern}$`));
  if (match && req.method === "GET") {
    sendJson(res, 200, { ok: true, ...(await getPartnerAiTranscription(auth, match[1], match[2])) });
    return;
  }
  match = url.pathname.match(new RegExp(`^/collaboration/v1/work-items/${uuidPattern}/ai-transcriptions/${uuidPattern}/complete$`));
  if (match && req.method === "POST") {
    sendJson(res, 200, { ok: true, ...(await completePartnerAiTranscription(auth, match[1], match[2])) });
    return;
  }
  match = url.pathname.match(new RegExp(`^/collaboration/v1/work-items/${uuidPattern}/ai-progress-drafts$`));
  if (match && req.method === "POST") {
    const result = await createPartnerProgressDraft(auth, match[1], await readJson(req), { idempotencyKey: req.headers["idempotency-key"] });
    sendJson(res, result.idempotentReplay ? 200 : 201, result);
    return;
  }
  match = url.pathname.match(new RegExp(`^/collaboration/v1/work-items/${uuidPattern}/ai-progress-drafts/${uuidPattern}/applied$`));
  if (match && req.method === "POST") {
    const body = await readJson(req);
    sendJson(res, 200, await markPartnerAiDraftApplied(auth, match[1], match[2], Number(body.workItemVersion)));
    return;
  }
  match = url.pathname.match(new RegExp(`^/collaboration/v1/partner-orders/${uuidPattern}/reports$`));
  if (match && req.method === "POST") {
    const result = await submitPartnerOrderReport(auth, match[1], await readJson(req), {
      idempotencyKey: String(req.headers["idempotency-key"] || ""),
      expectedVersion: String(req.headers["if-match"] || "").replace(/^W\//, "").replace(/"/g, ""),
      aiDraftId: String(req.headers["x-ai-draft-id"] || ""),
    });
    sendJson(res, result.idempotentReplay ? 200 : 201, result);
    return;
  }
  if (url.pathname === "/collaboration/v1/inventory" && req.method === "GET") {
    sendJson(res, 200, { ok: true, ...(await listInventory(auth, queryObject(url))) });
    return;
  }
  if (url.pathname === "/collaboration/v1/oem/quotes" && req.method === "POST") {
    sendJson(res, 201, await submitSupplierQuote(auth, await readJson(req), {
      idempotencyKey: String(req.headers["idempotency-key"] || ""),
      expectedVersion: String(req.headers["if-match"] || "").replace(/^W\//, "").replace(/"/g, ""),
    }));
    return;
  }
  if (url.pathname === "/collaboration/v1/oem/artifacts" && req.method === "POST") {
    sendJson(res, 201, await submitOemArtifact(auth, await readJson(req), {
      idempotencyKey: String(req.headers["idempotency-key"] || ""),
      expectedVersion: String(req.headers["if-match"] || "").replace(/^W\//, "").replace(/"/g, ""),
    }));
    return;
  }
  let oemMatch = url.pathname.match(new RegExp(`^/collaboration/v1/oem/milestones/${uuidPattern}$`));
  if (oemMatch && req.method === "PATCH") {
    sendJson(res, 200, await updateProductionMilestone(auth, oemMatch[1], await readJson(req), {
      idempotencyKey: String(req.headers["idempotency-key"] || ""),
      expectedVersion: String(req.headers["if-match"] || "").replace(/^W\//, "").replace(/"/g, ""),
    }));
    return;
  }
  if (url.pathname === "/collaboration/v1/notifications" && req.method === "GET") {
    sendJson(res, 200, { ok: true, ...(await listNotifications(auth, queryObject(url))) });
    return;
  }
  match = url.pathname.match(new RegExp(`^/collaboration/v1/notifications/${uuidPattern}/read$`));
  if (match && req.method === "POST") {
    sendJson(res, 200, { ok: true, notification: await markNotificationRead(auth, match[1]) });
    return;
  }
  if (url.pathname === "/collaboration/v1/attachments" && req.method === "POST") {
    sendJson(res, 201, { ok: true, ...(await createAttachmentUpload(auth, await readJson(req))) });
    return;
  }
  match = url.pathname.match(new RegExp(`^/collaboration/v1/attachments/${uuidPattern}/content$`));
  if (match && req.method === "PUT") {
    sendJson(res, 200, await receiveLocalUpload(auth, match[1], req));
    return;
  }
  match = url.pathname.match(new RegExp(`^/collaboration/v1/attachments/${uuidPattern}/complete$`));
  if (match && req.method === "POST") {
    sendJson(res, 200, { ok: true, ...(await completeS3Upload(auth, match[1])) });
    return;
  }
  match = url.pathname.match(new RegExp(`^/collaboration/v1/attachments/${uuidPattern}/download$`));
  if (match && req.method === "GET") {
    const download = await attachmentDownload(auth, match[1]);
    if (download.redirectUrl) { res.writeHead(302, { Location: download.redirectUrl }); res.end(); return; }
    res.writeHead(200, { "Content-Type": download.attachment.mime_type, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(download.attachment.file_name)}`, "Content-Length": download.attachment.size_bytes });
    download.stream.pipe(res);
    return;
  }
  sendJson(res, 404, { ok: false, code: "not_found", message: "Route not found." });
}

export async function startCollaborationServer() {
  if (collaborationConfig.autoMigrate) await migrate();
  const server = http.createServer((req, res) => {
    route(req, res).catch((error) => {
      const status = Number(error.statusCode || (error instanceof z.ZodError ? 400 : 500));
      const message = status >= 500 && collaborationConfig.production ? "服务暂时不可用，请稍后再试。" : (error.issues?.[0]?.message || error.message || "Unknown error");
      if (status >= 500) console.error(`[collaboration:${res.getHeader("X-Request-Id")}]`, error);
      if (!res.headersSent) sendJson(res, status, { ok: false, code: error.code || (status === 500 ? "internal_error" : "invalid_request"), message });
      else res.destroy(error);
    });
  });
  server.requestTimeout = 45_000;
  server.headersTimeout = 50_000;
  server.listen(collaborationConfig.port, "0.0.0.0", () => console.log(`Tongzhou collaboration API listening on http://localhost:${collaborationConfig.port}`));
  const deliveryTimer = setInterval(() => runNotificationDeliveryBatch().catch((error) => console.error("[collaboration:notifications]", error.message)), 30_000);
  deliveryTimer.unref();
  const partnerAiCleanupTimer = setInterval(() => cleanupExpiredPartnerAiAudio().catch((error) => console.error("[collaboration:partner-ai-cleanup]", error.message)), 5 * 60_000);
  partnerAiCleanupTimer.unref();
  const shutdown = async () => {
    clearInterval(deliveryTimer);
    clearInterval(partnerAiCleanupTimer);
    server.close();
    await closePools();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) startCollaborationServer().catch((error) => { console.error(error); process.exitCode = 1; });
