import { ZodError } from "zod";

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
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

export function createCollaborationBridgeApi({ bridge, getAuth, canManage, appendActionLog = () => {} }) {
  return async function handleCollaborationBridgeApi(req, res, url) {
    if (url.pathname !== "/api/collaboration-bridge" && !url.pathname.startsWith("/api/collaboration-bridge/")) return false;
    const auth = getAuth(req);
    try {
      if (!canManage(auth)) throw Object.assign(new Error("当前账号没有外部协同管控权限。"), { statusCode: 403, code: "forbidden" });
      const suffix = url.pathname.replace("/api/collaboration-bridge", "") || "/";
      if ((suffix === "/" || suffix === "/status") && req.method === "GET") {
        sendJson(res, 200, bridge.status());
        return true;
      }
      if (suffix === "/approvals" && req.method === "GET") {
        sendJson(res, 200, { ok: true, approvals: bridge.listApprovals().map(publicApproval) });
        return true;
      }
      if (suffix === "/organizations" && req.method === "POST") {
        const input = await readBody(req);
        const result = await bridge.provisionOrganization(input);
        appendActionLog(auth, "配置外部协作组织", "collaboration_organization", input.name || input.code || "", { code: input.code || "", organizationType: input.organizationType || "", status: input.status || "active" });
        sendJson(res, 200, result);
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
