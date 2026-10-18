import { ZodError } from "zod";
import { withDataContext } from "../collaboration/shared/data-context.js";

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,Idempotency-Key",
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 4 * 1024 * 1024) reject(Object.assign(new Error("请求内容不能超过 4MB。"), { statusCode: 413 }));
    });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(Object.assign(new Error("请求 JSON 格式不正确。"), { statusCode: 400 })); }
    });
    req.on("error", reject);
  });
}

function readBinaryBody(req, maxBytes = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        reject(Object.assign(new Error("附件不能超过 50MB。"), { statusCode: 413, code: "attachment_too_large" }));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => { if (!settled) resolve(Buffer.concat(chunks, size)); });
    req.on("error", (error) => { if (!settled) reject(error); });
  });
}

function publicApproval(row) {
  const command = row.command || {};
  return {
    commandId: command.id,
    organizationCode: command.organizationCode,
    workItemId: command.workItemId,
    coreRefType: command.coreRefType,
    coreRefId: command.coreRefId,
    itemType: command.itemType,
    commandType: command.commandType,
    payload: command.payload,
    submittedByName: command.submittedByName,
    submittedAt: command.submittedAt,
    riskLevel: command.riskLevel,
    status: row.local_status,
  };
}

export function createCollaborationBridgeApi({ bridge, getAuth, canManage, canViewTasks = canManage, canPublishTasks = canManage, appendActionLog = () => {} }) {
  return async function handleCollaborationBridgeApi(req, res, url) {
    if (url.pathname !== "/api/collaboration-bridge" && !url.pathname.startsWith("/api/collaboration-bridge/")) return false;
    const auth = getAuth(req);
    try {
      const suffix = url.pathname.replace("/api/collaboration-bridge", "") || "/";
      const warehouseTaskRoute = suffix === "/warehouse-tasks" || suffix.startsWith("/warehouse-tasks/");
      if (warehouseTaskRoute) {
        const warehouseIds = Array.isArray(auth?.user?.dataScopes?.warehouseIds) ? auth.user.dataScopes.warehouseIds : [];
        const skus = Array.isArray(auth?.user?.dataScopes?.skus) ? auth.user.dataScopes.skus : [];
        if (suffix === "/warehouse-tasks/options" && req.method === "GET") {
          if (!canViewTasks(auth)) throw Object.assign(new Error("当前账号没有查看协同任务的权限。"), { statusCode: 403, code: "forbidden" });
          sendJson(res, 200, await bridge.listWarehouseTaskOptions({ warehouseIds, skus }));
          return true;
        }
        if (suffix === "/warehouse-tasks" && req.method === "GET") {
          if (!canViewTasks(auth)) throw Object.assign(new Error("当前账号没有查看协同任务的权限。"), { statusCode: 403, code: "forbidden" });
          const filters = Object.fromEntries(url.searchParams.entries());
          const payload = await bridge.listWarehouseTasks(filters, { warehouseIds, skus });
          const latest = (payload.items || []).map((item) => item.updatedAt).filter(Boolean).sort().at(-1);
          sendJson(res, 200, withDataContext(payload, {
            generatedAt: new Date().toISOString(),
            effectiveAt: latest || new Date().toISOString(),
            source: "live",
            scopeKey: "domestic_collaboration_tasks",
            scopeLabel: filters.organizationCode ? `协同组织 ${filters.organizationCode}` : "当前账号可见国内仓协同任务",
            filters,
            completeness: "complete",
            coverage: { completed: payload.items?.length || 0, total: payload.total || 0, unit: "order" },
          }));
          return true;
        }
        if (suffix === "/warehouse-tasks" && req.method === "POST") {
          if (!canPublishTasks(auth)) throw Object.assign(new Error("当前账号没有发布协同任务的权限。"), { statusCode: 403, code: "forbidden" });
          const input = await readBody(req);
          const actorName = auth.user?.displayName || auth.user?.username || "供应链中台";
          const result = await bridge.publishWarehouseTask(input, { idempotencyKey: String(req.headers["idempotency-key"] || ""), actorName, warehouseIds, skus });
          appendActionLog(auth, "发布伙伴协同任务", "collaboration_work_item", result.coreRefId, { organizationCode: input.organizationCode || "", warehouseRef: input.warehouseRef || "", itemType: input.itemType || "", eventId: result.eventId, delivery: result.delivery });
          sendJson(res, result.idempotentReplay ? 200 : 201, result);
          return true;
        }
        const attachmentMatch = suffix.match(/^\/warehouse-tasks\/([0-9a-fA-F-]{36})\/attachments\/([0-9a-fA-F-]{36})$/);
        if (attachmentMatch && req.method === "GET") {
          if (!canViewTasks(auth)) throw Object.assign(new Error("当前账号没有查看协同任务附件的权限。"), { statusCode: 403, code: "forbidden" });
          const download = await bridge.downloadWarehouseTaskAttachment(attachmentMatch[1], attachmentMatch[2], { warehouseIds, skus });
          res.writeHead(200, { "Content-Type": download.contentType, "Content-Disposition": download.contentDisposition, "Content-Length": download.buffer.length, "Cache-Control": "private, no-store", "Access-Control-Allow-Origin": "*" });
          res.end(download.buffer);
          return true;
        }
        const reminderMatch = suffix.match(/^\/warehouse-tasks\/([0-9a-fA-F-]{36})\/remind$/);
        if (reminderMatch && req.method === "POST") {
          if (!canPublishTasks(auth)) throw Object.assign(new Error("当前账号没有催办协同任务的权限。"), { statusCode: 403, code: "forbidden" });
          const input = await readBody(req);
          const actorName = auth.user?.displayName || auth.user?.username || "供应链中台";
          const result = await bridge.remindWarehouseTask(reminderMatch[1], { note: input.note, actorName }, { warehouseIds, skus });
          appendActionLog(auth, "催办伙伴协同任务", "collaboration_work_item", reminderMatch[1], { remindedAt: result.remindedAt || "" });
          sendJson(res, 200, result);
          return true;
        }
        const taskMatch = suffix.match(/^\/warehouse-tasks\/([0-9a-fA-F-]{36})$/);
        if (taskMatch && req.method === "GET") {
          if (!canViewTasks(auth)) throw Object.assign(new Error("当前账号没有查看协同任务的权限。"), { statusCode: 403, code: "forbidden" });
          sendJson(res, 200, await bridge.getWarehouseTask(taskMatch[1], { warehouseIds, skus }));
          return true;
        }
        sendJson(res, 404, { ok: false, code: "not_found", message: "协同任务接口不存在。" });
        return true;
      }
      if (!canManage(auth)) throw Object.assign(new Error("当前账号没有外部协同管控权限。"), { statusCode: 403, code: "forbidden" });
      if ((suffix === "/" || suffix === "/status") && req.method === "GET") {
        sendJson(res, 200, bridge.status());
        return true;
      }
      if (suffix === "/approvals" && req.method === "GET") {
        sendJson(res, 200, { ok: true, approvals: bridge.listApprovals().map(publicApproval) });
        return true;
      }
      if (suffix === "/organizations" && req.method === "GET") {
        sendJson(res, 200, { ok: true, ...(await bridge.listOrganizations({ keyword: url.searchParams.get("keyword") || "", status: url.searchParams.get("status") || "" })) });
        return true;
      }
      if (suffix === "/organizations" && req.method === "POST") {
        const input = await readBody(req);
        const result = await bridge.provisionOrganization(input);
        appendActionLog(auth, "配置外部协作组织", "collaboration_organization", input.name || input.code || "", { code: input.code || "", organizationType: input.organizationType || "", status: input.status || "active" });
        sendJson(res, 200, result);
        return true;
      }
      if (suffix === "/organizations/bootstrap" && req.method === "POST") {
        const input = await readBody(req);
        const actorName = auth.user?.displayName || auth.user?.username || "供应链中台管理员";
        const result = await bridge.bootstrapOrganization({ ...input, actorName });
        appendActionLog(auth, "创建协作组织和首位管理员账号", "collaboration_organization", input.name || result.organization?.code || "", { code: result.organization?.code || "", administratorUsername: input.administrator?.username || "" });
        sendJson(res, 201, { ok: true, ...result });
        return true;
      }
      const organizationOutsourcingBindingMatch = suffix.match(/^\/organizations\/([a-z0-9][a-z0-9_-]{1,63})\/outsourcing-source$/);
      if (organizationOutsourcingBindingMatch && req.method === "GET") {
        const code = decodeURIComponent(organizationOutsourcingBindingMatch[1]);
        sendJson(res, 200, await bridge.getOutsourcingSourceBinding(code, { refresh: url.searchParams.get("refresh") === "1" }));
        return true;
      }
      if (organizationOutsourcingBindingMatch && req.method === "PUT") {
        const code = decodeURIComponent(organizationOutsourcingBindingMatch[1]);
        const input = await readBody(req);
        const actorName = auth.user?.displayName || auth.user?.username || "供应链中台管理员";
        const result = await bridge.saveOutsourcingSourceBinding(code, input, { actorName });
        appendActionLog(auth, "绑定千顷ERP委外加工工厂", "collaboration_organization", code, { factoryId: result.binding.factoryId, factoryName: result.binding.factoryName, synchronization: result.synchronization });
        sendJson(res, 200, result);
        return true;
      }
      const organizationOutsourcingSyncMatch = suffix.match(/^\/organizations\/([a-z0-9][a-z0-9_-]{1,63})\/outsourcing-source\/sync$/);
      if (organizationOutsourcingSyncMatch && req.method === "POST") {
        const code = decodeURIComponent(organizationOutsourcingSyncMatch[1]);
        const synchronization = await bridge.synchronizeOutsourcingProjections({ organizationCode: code });
        const delivery = await bridge.flushOutbox();
        appendActionLog(auth, "同步千顷ERP委外加工单", "collaboration_organization", code, { synchronization, delivery });
        sendJson(res, 200, { ok: true, synchronization, delivery });
        return true;
      }
      const organizationWorkItemsMatch = suffix.match(/^\/organizations\/([a-z0-9][a-z0-9_-]{1,63})\/work-items$/);
      if (organizationWorkItemsMatch && req.method === "GET") {
        const code = decodeURIComponent(organizationWorkItemsMatch[1]);
        sendJson(res, 200, { ok: true, ...(await bridge.listOrganizationWorkItems(code, Object.fromEntries(url.searchParams.entries()))) });
        return true;
      }
      const organizationWorkItemAttachmentMatch = suffix.match(/^\/organizations\/([a-z0-9][a-z0-9_-]{1,63})\/work-items\/([0-9a-fA-F-]{36})\/attachments\/([0-9a-fA-F-]{36})$/);
      if (organizationWorkItemAttachmentMatch && req.method === "GET") {
        const download = await bridge.downloadOrganizationWorkItemAttachment(decodeURIComponent(organizationWorkItemAttachmentMatch[1]), organizationWorkItemAttachmentMatch[2], organizationWorkItemAttachmentMatch[3]);
        res.writeHead(200, { "Content-Type": download.contentType, "Content-Disposition": download.contentDisposition, "Content-Length": download.buffer.length, "Cache-Control": "private, no-store" });
        res.end(download.buffer);
        return true;
      }
      const organizationWorkItemUploadMatch = suffix.match(/^\/organizations\/([a-z0-9][a-z0-9_-]{1,63})\/work-items\/([0-9a-fA-F-]{36})\/attachments$/);
      if (organizationWorkItemUploadMatch && req.method === "PUT") {
        const code = decodeURIComponent(organizationWorkItemUploadMatch[1]);
        const actorName = auth.user?.displayName || auth.user?.username || "供应链中台管理员";
        const fileName = decodeURIComponent(String(req.headers["x-file-name"] || ""));
        const mimeType = String(req.headers["content-type"] || "").split(";")[0].trim();
        const buffer = await readBinaryBody(req);
        const result = await bridge.uploadOrganizationWorkItemAttachment(code, organizationWorkItemUploadMatch[2], { fileName, mimeType, buffer }, { actorName });
        appendActionLog(auth, "上传伙伴协同需求附件", "collaboration_work_item", organizationWorkItemUploadMatch[2], { organizationCode: code, fileName, sizeBytes: buffer.length });
        sendJson(res, 201, { ok: true, ...result });
        return true;
      }
      const organizationWorkItemMatch = suffix.match(/^\/organizations\/([a-z0-9][a-z0-9_-]{1,63})\/work-items\/([0-9a-fA-F-]{36})$/);
      if (organizationWorkItemMatch && req.method === "GET") {
        sendJson(res, 200, { ok: true, ...(await bridge.getOrganizationWorkItem(decodeURIComponent(organizationWorkItemMatch[1]), organizationWorkItemMatch[2])) });
        return true;
      }
      if (organizationWorkItemsMatch && req.method === "POST") {
        const code = decodeURIComponent(organizationWorkItemsMatch[1]);
        const input = await readBody(req);
        const actorName = auth.user?.displayName || auth.user?.username || "供应链中台管理员";
        const result = await bridge.publishPartnerTask(code, input, { actorName });
        appendActionLog(auth, "发布伙伴生产/采购/打样单", "collaboration_work_item", result.coreRefId, { organizationCode: code, taskType: input.taskType || "", eventId: result.eventId, delivery: result.delivery });
        sendJson(res, 201, result);
        return true;
      }
      const organizationMatch = suffix.match(/^\/organizations\/([a-z0-9][a-z0-9_-]{1,63})$/);
      if (organizationMatch && req.method === "GET") {
        sendJson(res, 200, { ok: true, ...(await bridge.getOrganizationAccess(decodeURIComponent(organizationMatch[1]))) });
        return true;
      }
      if (organizationMatch && req.method === "PATCH") {
        const input = await readBody(req);
        const actorName = auth.user?.displayName || auth.user?.username || "供应链中台管理员";
        const result = await bridge.updateOrganizationStatus(decodeURIComponent(organizationMatch[1]), { ...input, actorName });
        appendActionLog(auth, input.status === "active" ? "启用协作组织" : "停用协作组织", "collaboration_organization", decodeURIComponent(organizationMatch[1]), { status: input.status || "" });
        sendJson(res, 200, { ok: true, ...result });
        return true;
      }
      const memberCredentialsMatch = suffix.match(/^\/organizations\/([a-z0-9][a-z0-9_-]{1,63})\/members\/([0-9a-fA-F-]{36})\/credentials$/);
      if (memberCredentialsMatch && req.method === "PATCH") {
        const input = await readBody(req);
        const code = decodeURIComponent(memberCredentialsMatch[1]);
        const membershipId = memberCredentialsMatch[2];
        const actorName = auth.user?.displayName || auth.user?.username || "供应链中台管理员";
        const result = await bridge.updateMemberCredentials(code, membershipId, { ...input, actorName });
        appendActionLog(auth, input.password ? "重置协同伙伴账号与密码" : "修改协同伙伴登录账号", "collaboration_membership", membershipId, { organizationCode: code, username: input.username || "", passwordReset: Boolean(input.password) });
        sendJson(res, 200, { ok: true, ...result });
        return true;
      }
      const accessGrantMatch = suffix.match(/^\/organizations\/([a-z0-9][a-z0-9_-]{1,63})\/access-grants$/);
      if (accessGrantMatch && req.method === "GET") {
        sendJson(res, 200, { ok: true, ...(await bridge.getOrganizationAccessGrants(decodeURIComponent(accessGrantMatch[1]))) });
        return true;
      }
      if (accessGrantMatch && req.method === "PUT") {
        const input = await readBody(req);
        const actorName = auth.user?.displayName || auth.user?.username || "供应链中台管理员";
        const code = decodeURIComponent(accessGrantMatch[1]);
        const result = await bridge.replaceOrganizationAccessGrants(code, { grants: input.grants || [], actorName });
        appendActionLog(auth, "调整协同组织资源权限", "collaboration_organization", code, { grantCount: Array.isArray(input.grants) ? input.grants.length : 0 });
        sendJson(res, 200, { ok: true, ...result });
        return true;
      }
      const invitationMatch = suffix.match(/^\/invitations\/([0-9a-fA-F-]{36})\/(reissue|revoke)$/);
      if (invitationMatch && req.method === "POST") {
        const actorName = auth.user?.displayName || auth.user?.username || "供应链中台管理员";
        const invitationId = decodeURIComponent(invitationMatch[1]);
        const result = invitationMatch[2] === "reissue"
          ? await bridge.reissueInvitation(invitationId, { actorName })
          : await bridge.revokeInvitation(invitationId, { actorName });
        appendActionLog(auth, invitationMatch[2] === "reissue" ? "重新签发协作邀请" : "撤销协作邀请", "collaboration_invitation", invitationId, {});
        sendJson(res, 200, { ok: true, ...result });
        return true;
      }
      if (suffix === "/projections" && req.method === "POST") {
        const result = bridge.queueProjection(await readBody(req));
        appendActionLog(auth, "发布外部协同任务", "collaboration_projection", result.projection.title, { eventId: result.id, organizationCode: result.projection.organizationCode, coreRefId: result.projection.coreRefId });
        sendJson(res, 202, { ok: true, eventId: result.id, status: result.status });
        return true;
      }
      if (suffix === "/inventory-projections" && req.method === "POST") {
        const result = bridge.queueInventoryProjection(await readBody(req));
        appendActionLog(auth, "发布仓库库存投影", "collaboration_inventory_projection", result.projection.warehouseName, { eventId: result.id, organizationCode: result.projection.organizationCode, itemCount: result.projection.items.length });
        sendJson(res, 202, { ok: true, eventId: result.id, status: result.status });
        return true;
      }
      if (suffix === "/oem/projections" && req.method === "POST") {
        const result = bridge.queueOemProjection(await readBody(req));
        appendActionLog(auth, "发布 OEM 私有协同任务", "oem_collaboration_projection", result.projection.title, { eventId: result.id, organizationCode: result.projection.organizationCode, coreRefId: result.projection.coreRefId, spaceType: result.projection.spaceType });
        sendJson(res, 202, { ok: true, eventId: result.id, status: result.status });
        return true;
      }
      if (suffix === "/partner-orders/projections" && req.method === "POST") {
        const result = bridge.queuePartnerOrderProjection(await readBody(req));
        appendActionLog(auth, "发布伙伴生产/采购订单", "partner_order_projection", result.projection.publicPayload.orderNo, { eventId: result.id, organizationCode: result.projection.organizationCode, coreRefId: result.projection.coreRefId, orderType: result.projection.orderType });
        sendJson(res, 202, { ok: true, eventId: result.id, status: result.status });
        return true;
      }
      if (suffix === "/oem/quotes" && req.method === "GET") {
        sendJson(res, 200, await bridge.listOemQuotes(url.searchParams.get("coreRefId") || ""));
        return true;
      }
      const awardMatch = suffix.match(/^\/oem\/quotes\/([^/]+)\/award$/);
      if (awardMatch && req.method === "POST") {
        const input = await readBody(req);
        const result = await bridge.awardOemQuote(decodeURIComponent(awardMatch[1]), { ...input, reviewer: auth.user?.displayName || auth.user?.username || "供应链中台" });
        appendActionLog(auth, "审批并定标包装报价", "supplier_quote", decodeURIComponent(awardMatch[1]), { approvalReference: input.approvalReference || "" });
        sendJson(res, 200, result);
        return true;
      }
      const sampleReviewMatch = suffix.match(/^\/oem\/artifacts\/([0-9a-fA-F-]{36})\/review$/);
      if (sampleReviewMatch && req.method === "POST") {
        const input = await readBody(req);
        const reviewer = auth.user?.displayName || auth.user?.username || "供应链中台";
        const result = await bridge.reviewSampleArtifact(sampleReviewMatch[1], { ...input, reviewer });
        appendActionLog(auth, input.approved ? "确认最终样" : "要求重新打样", "oem_artifact", sampleReviewMatch[1], { note: input.note || "", version: result.version });
        sendJson(res, 200, result);
        return true;
      }
      if (suffix === "/sync" && req.method === "POST") {
        const result = await bridge.synchronize();
        appendActionLog(auth, "执行外部协同同步", "collaboration_bridge", "协同 API", result);
        sendJson(res, result.ok ? 200 : 502, result);
        return true;
      }
      const reviewMatch = suffix.match(/^\/commands\/([^/]+)\/review$/);
      if (reviewMatch && req.method === "POST") {
        const input = await readBody(req);
        const result = await bridge.reviewCommand(decodeURIComponent(reviewMatch[1]), {
          approved: input.approved,
          note: input.note,
          reviewer: auth.user?.displayName || auth.user?.username || "供应链中台",
        });
        appendActionLog(auth, input.approved ? "批准外部协同指令" : "驳回外部协同指令", "collaboration_command", decodeURIComponent(reviewMatch[1]), { note: input.note || "", resultStatus: result.status || "" });
        sendJson(res, 200, { ok: true, ...result });
        return true;
      }
      sendJson(res, 404, { ok: false, code: "not_found", message: "协同桥接接口不存在。" });
      return true;
    } catch (error) {
      const status = Number(error.statusCode || (error instanceof ZodError ? 400 : 500));
      sendJson(res, status, {
        ok: false,
        code: error.code || (error instanceof ZodError ? "invalid_projection" : "bridge_error"),
        message: error instanceof ZodError ? (error.issues[0]?.message || "协同投影字段不符合白名单。") : error.message,
      });
      return true;
    }
  };
}
