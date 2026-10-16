import { hasPermission } from "./access-control.js";

const TERMINAL_STATUSES = new Set(["completed", "cancelled", "rejected"]);
const CORE_SYNC_EVENT_TYPES = new Set(["core.projection", "core.oem_projection"]);

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

async function sendBusinessImage(res, sourceUrl) {
  let parsed;
  try { parsed = new URL(sourceUrl); }
  catch { throw Object.assign(new Error("产品图片地址无效。"), { statusCode: 404, code: "image_not_found" }); }
  if (parsed.protocol !== "https:") throw Object.assign(new Error("产品图片地址无效。"), { statusCode: 404, code: "image_not_found" });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(parsed, { signal: controller.signal, redirect: "follow" });
    if (!response.ok) throw Object.assign(new Error("产品图片暂不可用。"), { statusCode: 502, code: "image_upstream_failed" });
    const advertisedSize = Number(response.headers.get("content-length") || 0);
    if (advertisedSize > 8 * 1024 * 1024) throw Object.assign(new Error("产品图片过大。"), { statusCode: 413, code: "image_too_large" });
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > 8 * 1024 * 1024) throw Object.assign(new Error("产品图片过大。"), { statusCode: 413, code: "image_too_large" });
    const contentType = String(response.headers.get("content-type") || "image/jpeg").split(";")[0];
    res.writeHead(200, {
      "Content-Type": contentType.startsWith("image/") ? contentType : "image/jpeg",
      "Content-Length": data.length,
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(data);
  } finally {
    clearTimeout(timeout);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 512 * 1024) reject(Object.assign(new Error("请求内容不能超过 512KB。"), { statusCode: 413, code: "payload_too_large" }));
    });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(Object.assign(new Error("请求 JSON 格式不正确。"), { statusCode: 400, code: "invalid_json" })); }
    });
    req.on("error", reject);
  });
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
}

function text(value, max = 2_000) {
  return String(value || "").trim().slice(0, max);
}

function capabilitiesFor(authOrUser) {
  const user = authOrUser?.user || authOrUser || {};
  const auth = authOrUser?.user ? authOrUser : { role: user.role || "guest", user };
  const managesCollaboration = hasPermission(auth, "operations") && hasPermission(auth, "domestic_inventory_manage");
  return {
    viewTasks: hasPermission(auth, "collaboration_task_view") || hasPermission(auth, "collaboration_task_publish") || managesCollaboration,
    viewOrganizations: managesCollaboration,
    reviewCommands: managesCollaboration,
    viewDomesticInventory: hasPermission(auth, "domestic_inventory_view"),
    viewProducts: hasPermission(auth, "product_view"),
    viewQualifications: hasPermission(auth, "qualifications"),
    viewStockupRisks: hasPermission(auth, "stockup_recommendations_view"),
    viewContainerLoading: hasPermission(auth, "container_loading_view") || hasPermission(auth, "container_loading_manage") || hasPermission(auth, "container_loading_confirm"),
  };
}

function canAccess(capabilities) {
  return Object.values(capabilities).some(Boolean);
}

function publicSession(authOrUser) {
  const user = authOrUser?.user || authOrUser;
  const capabilities = capabilitiesFor(authOrUser);
  return {
    mode: "admin",
    user,
    capabilities,
    workspace: {
      kind: "internal_admin",
      label: "供应链中台",
      modules: [
        "admin_dashboard",
        ...(capabilities.viewTasks ? ["admin_tasks"] : []),
        ...(capabilities.reviewCommands ? ["admin_approvals"] : []),
        ...(capabilities.viewOrganizations ? ["admin_organizations"] : []),
        ...(capabilities.viewDomesticInventory ? ["admin_domestic_inventory"] : []),
        ...(capabilities.viewProducts ? ["admin_products"] : []),
        ...(capabilities.viewQualifications ? ["admin_qualifications"] : []),
        ...(capabilities.viewStockupRisks ? ["admin_stockup_risks"] : []),
        ...(capabilities.viewContainerLoading ? ["admin_container_loading"] : []),
        "profile",
      ],
      actions: capabilities.reviewCommands ? ["review_partner_command"] : [],
    },
  };
}

function publicApproval(row) {
  const command = row?.command || row || {};
  return {
    commandId: command.id || row?.commandId || "",
    organizationCode: command.organizationCode || "",
    workItemId: command.workItemId || "",
    coreRefType: command.coreRefType || "",
    coreRefId: command.coreRefId || "",
    itemType: command.itemType || "",
    commandType: command.commandType || "",
    payload: command.payload || {},
    submittedByName: command.submittedByName || "",
    submittedAt: command.submittedAt || "",
    riskLevel: command.riskLevel || "",
    status: row?.local_status || command.status || "awaiting_approval",
  };
}

function isCoreSyncEvent(event) {
  if (!CORE_SYNC_EVENT_TYPES.has(text(event?.eventType, 80))) return false;
  const metadata = event?.metadata || {};
  const version = Number(metadata.version || 0);
  if (metadata.initial === true || version === 1) return false;
  if (version > 1) return true;
  return /(?:订单|任务|数据|库存).*?(?:由中台更新|同步完成|同步更新|已发布或更新)/.test(text(event?.body));
}

function sanitizeTaskDetail(detail) {
  return {
    ...detail,
    events: (Array.isArray(detail?.events) ? detail.events : []).filter((event) => !isCoreSyncEvent(event)),
  };
}

function sanitizeOrganization(item) {
  return {
    id: item?.id || "",
    code: item?.code || "",
    name: item?.name || "",
    organizationType: item?.organizationType || "",
    status: item?.status || "",
    memberCount: Number(item?.memberCount || 0),
    activeMemberCount: Number(item?.activeMemberCount || 0),
    administratorCount: Number(item?.administratorCount || 0),
    pendingInvitationCount: Number(item?.pendingInvitationCount || 0),
    lastLoginAt: item?.lastLoginAt || "",
    createdAt: item?.createdAt || "",
    updatedAt: item?.updatedAt || "",
  };
}

function sanitizeOrganizationDetail(payload) {
  return {
    organization: sanitizeOrganization(payload?.organization),
    members: (Array.isArray(payload?.members) ? payload.members : []).map((member) => ({
      id: member.id || "",
      userId: member.userId || "",
      username: member.username || "",
      displayName: member.displayName || member.username || "",
      role: member.role || "",
      status: member.status || "",
      userStatus: member.userStatus || "",
      lastLoginAt: member.lastLoginAt || "",
      createdAt: member.createdAt || "",
    })),
    invitations: (Array.isArray(payload?.invitations) ? payload.invitations : []).map((invitation) => ({
      id: invitation.id || "",
      username: invitation.username || "",
      role: invitation.role || "",
      status: invitation.status || "",
      expiresAt: invitation.expiresAt || "",
      createdAt: invitation.createdAt || "",
    })),
  };
}

function overviewFrom({ tasks, approvals, organizations }) {
  const now = Date.now();
  const items = Array.isArray(tasks?.items) ? tasks.items : [];
  const open = items.filter((item) => !TERMINAL_STATUSES.has(item.status));
  const priority = [...open].sort((left, right) => {
    const leftDue = Date.parse(left.dueAt || "") || Number.MAX_SAFE_INTEGER;
    const rightDue = Date.parse(right.dueAt || "") || Number.MAX_SAFE_INTEGER;
    const leftScore = (leftDue < now ? -4 : 0) + (left.priority === "urgent" ? -2 : 0);
    const rightScore = (rightDue < now ? -4 : 0) + (right.priority === "urgent" ? -2 : 0);
    return leftScore - rightScore || leftDue - rightDue || Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || "");
  });
  const organizationItems = Array.isArray(organizations?.organizations) ? organizations.organizations : [];
  return {
    metrics: {
      openTasks: open.length,
      urgentTasks: open.filter((item) => item.priority === "urgent").length,
      overdueTasks: open.filter((item) => item.dueAt && Date.parse(item.dueAt) < now).length,
      pendingApprovals: approvals.length,
      activeOrganizations: organizationItems.filter((item) => item.status === "active").length,
    },
    counts: tasks?.counts || {},
    priorityTasks: priority.slice(0, 6),
    approvals: approvals.slice(0, 4),
    organizations: organizationItems.slice(0, 6).map(sanitizeOrganization),
    generatedAt: new Date().toISOString(),
  };
}

export function createMobileAdminApi({
  bridge,
  business = {},
  authenticateCredentials,
  authenticateAccessCode = () => null,
  issueToken,
  resolveAuth,
  appendActionLog = () => {},
}) {
  const loginAttempts = new Map();
  const businessRoutes = new Map([
    ["domestic-inventory", { capability: "viewDomesticInventory", provider: "domesticInventory" }],
    ["products", { capability: "viewProducts", provider: "products" }],
    ["qualifications", { capability: "viewQualifications", provider: "qualifications" }],
    ["stockup-risks", { capability: "viewStockupRisks", provider: "stockupRisks" }],
    ["container-loading", { capability: "viewContainerLoading", provider: "containerLoading" }],
  ]);

  function assertLoginRate(req, username) {
    const now = Date.now();
    for (const [key, entry] of loginAttempts) if (now - entry.startedAt > 15 * 60_000) loginAttempts.delete(key);
    const key = `${clientIp(req)}:${text(username, 120).toLowerCase()}`;
    const entry = loginAttempts.get(key) || { count: 0, startedAt: now };
    if (entry.count >= 10) throw Object.assign(new Error("登录尝试过于频繁，请稍后再试。"), { statusCode: 429, code: "login_rate_limited" });
    loginAttempts.set(key, { ...entry, count: entry.count + 1 });
    return () => loginAttempts.delete(key);
  }

  function requireAuth(req, capability) {
    const auth = resolveAuth(req);
    if (!auth?.user?.id) throw Object.assign(new Error("中台会话已失效，请重新登录。"), { statusCode: 401, code: "authentication_required" });
    const capabilities = capabilitiesFor(auth);
    if (!canAccess(capabilities)) throw Object.assign(new Error("当前中台账号没有移动协同工作台权限。"), { statusCode: 403, code: "mobile_admin_forbidden" });
    if (capability && !capabilities[capability]) throw Object.assign(new Error("当前中台账号没有执行此操作的权限。"), { statusCode: 403, code: "forbidden" });
    return { auth, capabilities };
  }

  return async function handleMobileAdminApi(req, res, url) {
    if (url.pathname !== "/api/mobile-admin/v1" && !url.pathname.startsWith("/api/mobile-admin/v1/")) return false;
    try {
      const suffix = url.pathname.replace("/api/mobile-admin/v1", "") || "/";

      const imageMatch = suffix.match(/^\/images\/([a-f0-9]{64})$/);
      if (imageMatch && req.method === "GET") {
        const sourceUrl = typeof business.resolveImage === "function" ? business.resolveImage(imageMatch[1]) : "";
        if (!sourceUrl) throw Object.assign(new Error("产品图片不存在。"), { statusCode: 404, code: "image_not_found" });
        await sendBusinessImage(res, sourceUrl);
        return true;
      }

      if (suffix === "/auth/login" && req.method === "POST") {
        const input = await readBody(req);
        const credentialType = input.credentialType === "access_code" ? "access_code" : "account_password";
        const username = text(input.username, 120);
        const password = String(input.password || "");
        const accessCode = String(input.accessCode || "");
        if (credentialType === "access_code" && !accessCode) throw Object.assign(new Error("请输入中台访问码。"), { statusCode: 400, code: "credentials_required" });
        if (credentialType === "account_password" && (!username || !password)) throw Object.assign(new Error("请输入中台账号和密码。"), { statusCode: 400, code: "credentials_required" });
        if (password.length > 512 || accessCode.length > 512) throw Object.assign(new Error("登录凭据无效。"), { statusCode: 401, code: "invalid_credentials" });
        const clearAttempt = assertLoginRate(req, credentialType === "access_code" ? "access-code" : username);
        const user = credentialType === "access_code"
          ? authenticateAccessCode(accessCode)
          : authenticateCredentials(username, password);
        if (!user) throw Object.assign(new Error(credentialType === "access_code" ? "中台访问码无效。" : "账号或密码无效。"), { statusCode: 401, code: "invalid_credentials" });
        const capabilities = capabilitiesFor(user);
        if (!canAccess(capabilities)) throw Object.assign(new Error("当前账号没有移动协同工作台权限。"), { statusCode: 403, code: "mobile_admin_forbidden" });
        clearAttempt();
        const auth = { role: user.role, user };
        appendActionLog(auth, "登录中台移动端", "mobile_admin_session", user.displayName || user.username, { credentialType, ipAddress: clientIp(req) });
        sendJson(res, 200, { ok: true, token: issueToken(user), session: publicSession(auth) });
        return true;
      }

      if (suffix === "/auth/logout" && req.method === "POST") {
        const { auth } = requireAuth(req);
        appendActionLog(auth, "退出中台移动端", "mobile_admin_session", auth.user.displayName || auth.user.username, {});
        sendJson(res, 200, { ok: true });
        return true;
      }

      if ((suffix === "/" || suffix === "/session") && req.method === "GET") {
        const { auth } = requireAuth(req);
        sendJson(res, 200, { ok: true, session: publicSession(auth) });
        return true;
      }

      if (suffix === "/overview" && req.method === "GET") {
        const { auth, capabilities } = requireAuth(req);
        const [tasks, approvalRows, organizations] = await Promise.all([
          capabilities.viewTasks ? bridge.listWarehouseTasks({ limit: 200, offset: 0 }) : Promise.resolve({ items: [], counts: {}, total: 0 }),
          capabilities.reviewCommands ? Promise.resolve(bridge.listApprovals()) : Promise.resolve([]),
          capabilities.viewOrganizations ? bridge.listOrganizations({ status: "" }) : Promise.resolve({ organizations: [] }),
        ]);
        const approvals = (Array.isArray(approvalRows) ? approvalRows : []).map(publicApproval);
        sendJson(res, 200, { ok: true, capabilities, workspace: publicSession(auth).workspace, overview: overviewFrom({ tasks, approvals, organizations }) });
        return true;
      }

      if (suffix === "/business/container-loading/calculator/bootstrap" && req.method === "GET") {
        const { auth } = requireAuth(req, "viewContainerLoading");
        const provider = business.containerLoading;
        if (typeof provider?.calculatorBootstrap !== "function") throw Object.assign(new Error("临时装柜测算暂不可用。"), { statusCode: 503, code: "calculator_unavailable" });
        sendJson(res, 200, { ok: true, ...(await provider.calculatorBootstrap(auth)) });
        return true;
      }

      if (suffix === "/business/container-loading/calculator/run" && req.method === "POST") {
        const { auth } = requireAuth(req, "viewContainerLoading");
        const provider = business.containerLoading;
        if (typeof provider?.calculate !== "function") throw Object.assign(new Error("临时装柜测算暂不可用。"), { statusCode: 503, code: "calculator_unavailable" });
        const input = await readBody(req);
        sendJson(res, 200, { ok: true, ...(await provider.calculate(input, auth)) });
        return true;
      }

      const businessMatch = suffix.match(/^\/business\/([a-z-]+)$/);
      if (businessMatch && req.method === "GET") {
        const route = businessRoutes.get(businessMatch[1]);
        if (!route) throw Object.assign(new Error("中台经营模块不存在。"), { statusCode: 404, code: "not_found" });
        const { auth } = requireAuth(req, route.capability);
        const provider = business[route.provider];
        if (typeof provider !== "function") throw Object.assign(new Error("中台经营数据暂不可用。"), { statusCode: 503, code: "business_data_unavailable" });
        const filters = Object.fromEntries(url.searchParams.entries());
        sendJson(res, 200, { ok: true, module: businessMatch[1], ...(await provider(filters, auth)) });
        return true;
      }

      const businessDetailMatch = suffix.match(/^\/business\/([a-z-]+)\/([^/]+)$/);
      if (businessDetailMatch && req.method === "GET") {
        const route = businessRoutes.get(businessDetailMatch[1]);
        if (!route) throw Object.assign(new Error("中台经营模块不存在。"), { statusCode: 404, code: "not_found" });
        const { auth } = requireAuth(req, route.capability);
        const provider = business[route.provider];
        if (typeof provider !== "function") throw Object.assign(new Error("中台经营数据暂不可用。"), { statusCode: 503, code: "business_data_unavailable" });
        const recordId = decodeURIComponent(businessDetailMatch[2]);
        let item = typeof provider.detail === "function" ? await provider.detail(recordId, auth) : null;
        if (!item) {
          const fallback = await provider({ limit: 200 }, auth);
          item = (fallback.items || []).find((candidate) => String(candidate.id) === recordId) || null;
        }
        if (!item) throw Object.assign(new Error("未找到记录或当前账号无权查看。"), { statusCode: 404, code: "business_record_not_found" });
        sendJson(res, 200, { ok: true, module: businessDetailMatch[1], item });
        return true;
      }

      if (suffix === "/tasks" && req.method === "GET") {
        requireAuth(req, "viewTasks");
        const filters = Object.fromEntries(url.searchParams.entries());
        filters.limit = Math.max(1, Math.min(100, Number(filters.limit || 50)));
        filters.offset = Math.max(0, Number(filters.offset || 0));
        sendJson(res, 200, { ok: true, ...(await bridge.listWarehouseTasks(filters)) });
        return true;
      }

      const taskMatch = suffix.match(/^\/tasks\/([0-9a-fA-F-]{36})$/);
      if (taskMatch && req.method === "GET") {
        requireAuth(req, "viewTasks");
        sendJson(res, 200, { ok: true, ...sanitizeTaskDetail(await bridge.getWarehouseTask(taskMatch[1])) });
        return true;
      }

      if (suffix === "/approvals" && req.method === "GET") {
        requireAuth(req, "reviewCommands");
        const approvals = (bridge.listApprovals() || []).map(publicApproval);
        sendJson(res, 200, { ok: true, approvals });
        return true;
      }

      const reviewMatch = suffix.match(/^\/approvals\/([^/]+)\/review$/);
      if (reviewMatch && req.method === "POST") {
        const { auth } = requireAuth(req, "reviewCommands");
        const input = await readBody(req);
        const decision = text(input.decision, 20);
        const note = text(input.note);
        if (!['approve', 'reject'].includes(decision)) throw Object.assign(new Error("请选择批准或驳回。"), { statusCode: 400, code: "invalid_decision" });
        if (decision === "reject" && note.length < 2) throw Object.assign(new Error("驳回时请填写原因。"), { statusCode: 400, code: "review_note_required" });
        const commandId = decodeURIComponent(reviewMatch[1]);
        const result = await bridge.reviewCommand(commandId, {
          approved: decision === "approve",
          note: note || "移动端审批通过",
          reviewer: auth.user.displayName || auth.user.username || "供应链中台",
        });
        appendActionLog(auth, decision === "approve" ? "移动端批准协同指令" : "移动端驳回协同指令", "collaboration_command", commandId, { note, resultStatus: result.status || "" });
        sendJson(res, 200, { ok: true, ...result });
        return true;
      }

      if (suffix === "/organizations" && req.method === "GET") {
        requireAuth(req, "viewOrganizations");
        const result = await bridge.listOrganizations({ keyword: url.searchParams.get("keyword") || "", status: url.searchParams.get("status") || "" });
        sendJson(res, 200, { ok: true, organizations: (result.organizations || []).map(sanitizeOrganization) });
        return true;
      }

      const organizationMatch = suffix.match(/^\/organizations\/([a-z0-9][a-z0-9_-]{1,63})$/);
      if (organizationMatch && req.method === "GET") {
        requireAuth(req, "viewOrganizations");
        const result = await bridge.getOrganizationAccess(decodeURIComponent(organizationMatch[1]));
        sendJson(res, 200, { ok: true, ...sanitizeOrganizationDetail(result) });
        return true;
      }

      sendJson(res, 404, { ok: false, code: "not_found", message: "中台移动接口不存在。" });
      return true;
    } catch (error) {
      sendJson(res, Number(error.statusCode || 500), {
        ok: false,
        code: error.code || "mobile_admin_error",
        message: error.message || "中台移动服务暂不可用。",
      });
      return true;
    }
  };
}

export const mobileAdminInternals = {
  capabilitiesFor,
  isCoreSyncEvent,
  overviewFrom,
  publicApproval,
  publicSession,
};
