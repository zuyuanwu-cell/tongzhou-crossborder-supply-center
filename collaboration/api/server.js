import http from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { collaborationConfig } from "./config.js";
import { closePools, integrationPool } from "./db.js";
import { migrate } from "./migrate.js";
import {
  assertAuthenticated,
  assertCsrf,
  authenticate,
  login,
  logout,
} from "./auth.js";
import {
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
  listPendingCommands,
  reviewCommand,
} from "./integration.js";
import {
  attachmentDownload,
  completeS3Upload,
  createAttachmentUpload,
  receiveLocalUpload,
} from "./storage.js";
import { runNotificationDeliveryBatch } from "./notifications.js";
import {
  applyOemProjection,
  awardInternalQuote,
  listInternalQuotes,
  submitOemArtifact,
  submitSupplierQuote,
  updateProductionMilestone,
} from "./oem.js";
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
  updateOwnProfile,
  updateOrganizationStatus,
} from "./identity.js";

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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token, Idempotency-Key, If-Match, Authorization");
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

function queryObject(url) {
  return Object.fromEntries(url.searchParams.entries());
}

function publicSession(auth) {
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
    sendJson(res, 200, { ok: true, session: publicSession(result.auth), mfaSetupRequired: result.mfaSetupRequired }, { "Set-Cookie": result.cookies });
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
    sendJson(res, 200, { ok: true, session: publicSession(auth) });
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
    if (url.pathname === "/collaboration/internal/v1/oem/projections" && req.method === "PUT") {
      sendJson(res, 200, await applyOemProjection(await readJson(req)));
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
  if (url.pathname === "/collaboration/v1/account/password" && req.method === "POST") {
    sendJson(res, 200, { ok: true, ...(await changeOwnPassword(auth, await readJson(req))) });
    return;
  }

  if (url.pathname === "/collaboration/v1/dashboard" && req.method === "GET") {
    sendJson(res, 200, { ok: true, dashboard: await organizationDashboard(auth) });
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
  let match = url.pathname.match(new RegExp(`^/collaboration/v1/work-items/${uuidPattern}$`));
  if (match && req.method === "GET") {
    sendJson(res, 200, { ok: true, ...(await getWorkItem(auth, match[1])) });
    return;
  }
  match = url.pathname.match(new RegExp(`^/collaboration/v1/work-items/${uuidPattern}/actions$`));
  if (match && req.method === "POST") {
    const result = await submitWorkItemAction(auth, match[1], await readJson(req), {
      idempotencyKey: String(req.headers["idempotency-key"] || ""),
      expectedVersion: String(req.headers["if-match"] || "").replace(/^W\//, "").replace(/"/g, ""),
    });
    sendJson(res, result.idempotentReplay ? 200 : 201, { ok: true, ...result });
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
  server.requestTimeout = 30_000;
  server.headersTimeout = 35_000;
  server.listen(collaborationConfig.port, "0.0.0.0", () => console.log(`Tongzhou collaboration API listening on http://localhost:${collaborationConfig.port}`));
  const deliveryTimer = setInterval(() => runNotificationDeliveryBatch().catch((error) => console.error("[collaboration:notifications]", error.message)), 30_000);
  deliveryTimer.unref();
  const shutdown = async () => {
    clearInterval(deliveryTimer);
    server.close();
    await closePools();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) startCollaborationServer().catch((error) => { console.error(error); process.exitCode = 1; });
