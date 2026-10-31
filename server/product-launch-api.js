import { hasPermission, normalizeDataScopes } from "./access-control.js";
import { productLaunchMeta } from "./product-launch.js";

// HTTP routes for 开品需求 (product launch requests), mounted under /api/product-launch.
const BASE = "/api/product-launch";
const MAX_BODY_BYTES = 256 * 1024;
const FACTORY_COLLABORATION_PERMISSIONS = Object.freeze([
  "sampling.task.view",
  "sampling.task.handle",
  "sampling.artifact.submit",
  "sampling.quote.submit",
]);
const LEGACY_STAGES = Object.freeze([
  { key: "submitted", label: "待评审", main: true },
  { key: "approved", label: "已立项", main: true },
  { key: "sourcing", label: "寻源打样", main: true },
  { key: "certification", label: "资质备案", main: true },
  { key: "listing_prep", label: "上架准备", main: true },
  { key: "launched", label: "已上架", main: true },
  { key: "on_hold", label: "暂缓", main: false },
  { key: "rejected", label: "未通过", main: false },
  { key: "cancelled", label: "已撤回", main: false },
]);
const LEGACY_STAGE_BY_V2 = Object.freeze({
  factory_validation: "sourcing",
  product_definition: "certification",
  packaging: "listing_prep",
  filing: "certification",
  pilot_production: "listing_prep",
  completed: "launched",
});
const LEGACY_STAGE_LABELS = Object.fromEntries(LEGACY_STAGES.map((stage) => [stage.key, stage.label]));

function legacyStage(stage) {
  return LEGACY_STAGE_BY_V2[stage] || stage;
}

// Backend and dist/ are released independently. The old page receives its old
// stage vocabulary until the v2 frontend explicitly opts in, so a backend-first
// rollout cannot make in-flight requests disappear from the existing board.
function presentRequest(request, workflowV2) {
  if (workflowV2 || !request) return request;
  const stage = legacyStage(request.stage);
  const stageHistory = {};
  for (const [key, value] of Object.entries(request.stageHistory || {})) stageHistory[legacyStage(key)] = value;
  return { ...request, stage, stageLabel: LEGACY_STAGE_LABELS[stage] || request.stageLabel, stageHistory, launchedAt: request.completedAt || request.launchedAt || "" };
}

function presentSummary(summary, workflowV2) {
  if (workflowV2 || !summary) return summary;
  const byStage = Object.fromEntries(LEGACY_STAGES.map((stage) => [stage.key, 0]));
  for (const [key, value] of Object.entries(summary.byStage || {})) {
    const target = legacyStage(key);
    byStage[target] = (byStage[target] || 0) + Number(value || 0);
  }
  return { ...summary, byStage };
}

function presentMeta(meta, workflowV2) {
  return workflowV2 ? meta : { ...meta, stages: LEGACY_STAGES };
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("提交内容太大了。"), { statusCode: 413, code: "payload_too_large" });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw Object.assign(new Error("提交内容格式不正确。"), { statusCode: 400, code: "invalid_json" });
  }
}

function permissionsFor(auth) {
  const manage = hasPermission(auth, "product_launch_manage");
  const submit = manage || hasPermission(auth, "product_launch_submit");
  const view = submit || hasPermission(auth, "product_launch_view");
  return { view, submit, manage };
}

async function partnerFactories(collaborationBridge) {
  if (!collaborationBridge) return { enabled: false, message: "协同服务未接入。", factories: [] };
  const bridgeStatus = collaborationBridge.status?.() || {};
  if (bridgeStatus.oemEnabled === false) return { enabled: false, message: "生产与打样协同尚未启用。", factories: [] };
  try {
    const result = await collaborationBridge.listOrganizations({ status: "active" });
    const organizations = (result.organizations || []).filter((organization) => organization.organizationType === "production_factory");
    const factories = await Promise.all(organizations.map(async (organization) => {
      try {
        const access = await collaborationBridge.getOrganizationAccessGrants(organization.code);
        const grant = (access.grants || []).find((item) => item.resourceType === "organization" && item.resourceRef === "sampling");
        const permissions = Array.isArray(grant?.permissions) ? grant.permissions : [];
        const missingPermissions = FACTORY_COLLABORATION_PERMISSIONS.filter((permission) => !permissions.includes(permission));
        return {
          code: String(organization.code || ""),
          name: String(organization.name || organization.code || ""),
          organizationType: String(organization.organizationType || ""),
          ready: missingPermissions.length === 0,
          missingPermissions,
        };
      } catch (error) {
        return {
          code: String(organization.code || ""),
          name: String(organization.name || organization.code || ""),
          organizationType: String(organization.organizationType || ""),
          ready: false,
          missingPermissions: [...FACTORY_COLLABORATION_PERMISSIONS],
          error: error instanceof Error ? error.message : "权限读取失败",
        };
      }
    }));
    return { enabled: true, message: factories.length ? "" : "协同伙伴中暂无启用的委外生产工厂。", factories };
  } catch (error) {
    return { enabled: false, message: error instanceof Error ? error.message : "协同工厂读取失败。", factories: [] };
  }
}

export function createProductLaunchApi({ service, collaborationBridge = null, getAuth, appendActionLog = () => {}, listOwners = () => [], listCountries = () => [] }) {
  return async function handleProductLaunchApi(req, res, url) {
    if (url.pathname !== BASE && !url.pathname.startsWith(`${BASE}/`)) return false;
    const auth = getAuth(req);
    const can = permissionsFor(auth);
    const scope = { user: auth?.user, dataScopes: normalizeDataScopes(auth?.user?.dataScopes) };
    try {
      if (!auth?.user || !can.view) throw Object.assign(new Error("当前账号没有开品需求的查看权限。"), { statusCode: 403, code: "forbidden" });
      const suffix = url.pathname.slice(BASE.length) || "/";
      const workflowV2 = url.searchParams.get("workflowVersion") === "2" || req.headers["x-product-launch-workflow"] === "2";

      if (suffix === "/meta" && req.method === "GET") {
        const factoryCollaboration = can.manage ? await partnerFactories(collaborationBridge) : { enabled: false, message: "", factories: [] };
        sendJson(res, 200, { ...presentMeta(productLaunchMeta({ countries: listCountries(), owners: listOwners() }), workflowV2), factoryCollaboration, permissions: can });
        return true;
      }
      if (suffix === "/requests" && req.method === "GET") {
        const result = service.list(Object.fromEntries(url.searchParams.entries()), scope);
        sendJson(res, 200, { ...result, summary: presentSummary(result.summary, workflowV2), requests: result.requests.map((request) => presentRequest(request, workflowV2)), permissions: can });
        return true;
      }
      if (suffix === "/requests" && req.method === "POST") {
        if (!can.submit) throw Object.assign(new Error("当前账号没有提交开品需求的权限。"), { statusCode: 403, code: "forbidden" });
        const request = service.create(await readJsonBody(req), auth.user, scope);
        appendActionLog(auth, "提交开品需求", "product_launch_request", request.id, { title: request.title, country: request.country, priority: request.priority });
        sendJson(res, 201, { ok: true, request: presentRequest(request, workflowV2) });
        return true;
      }

      const factoryAssignmentMatch = suffix.match(/^\/requests\/([^/]+)\/factory-assignments(?:\/([^/]+)\/sync)?$/);
      if (factoryAssignmentMatch && req.method === "POST") {
        if (!can.manage) throw Object.assign(new Error("只有开品负责人可以指派或同步委外工厂。"), { statusCode: 403, code: "forbidden" });
        if (!collaborationBridge) throw Object.assign(new Error("协同服务未接入，暂时不能指派委外工厂。"), { statusCode: 503, code: "collaboration_unavailable" });
        const id = decodeURIComponent(factoryAssignmentMatch[1]);
        const assignmentId = factoryAssignmentMatch[2] ? decodeURIComponent(factoryAssignmentMatch[2]) : "";
        const current = service.get(id, scope);
        if (!current) throw Object.assign(new Error("没有找到这条开品需求。"), { statusCode: 404, code: "not_found" });
        if (assignmentId) {
          const assignment = (current.factoryAssignments || []).find((item) => item.id === assignmentId);
          if (!assignment) throw Object.assign(new Error("委外工厂协同任务不存在。"), { statusCode: 404, code: "not_found" });
          const detail = await collaborationBridge.getOrganizationWorkItem(assignment.organizationCode, assignment.workItemId);
          const request = service.syncFactoryAssignment(id, assignmentId, detail, auth.user, { ...scope, canManage: true });
          appendActionLog(auth, "同步开品委外工厂进度", "product_launch_request", request.id, { assignmentId, organizationCode: assignment.organizationCode, status: request.factoryAssignments.find((item) => item.id === assignmentId)?.status || "" });
          sendJson(res, 200, { ok: true, request: presentRequest(request, workflowV2) });
          return true;
        }

        const body = await readJsonBody(req);
        const availability = await partnerFactories(collaborationBridge);
        const factory = availability.factories.find((item) => item.code === String(body.organizationCode || ""));
        if (!factory) throw Object.assign(new Error("请选择协同伙伴中已启用的委外生产工厂。"), { statusCode: 400, code: "factory_not_found" });
        if (!factory.ready) throw Object.assign(new Error(`${factory.name} 尚未开通完整打样能力：${factory.missingPermissions.join("、")}`), { statusCode: 409, code: "factory_capability_incomplete" });
        if (current.closed) throw Object.assign(new Error("需求已结案，不能再指派委外工厂。"), { statusCode: 409, code: "request_closed" });
        if ((current.factoryAssignments || []).some((item) => item.organizationCode === factory.code && !["completed", "rejected", "cancelled"].includes(item.status))) {
          throw Object.assign(new Error(`${factory.name} 已有一条进行中的打样协同任务，请直接刷新进度。`), { statusCode: 409, code: "factory_assignment_exists" });
        }
        const allowedChecklistKeys = new Set(["material_test", "formula_development", "sample_test_report", "factory_quote"]);
        const checklistKeys = [...new Set((Array.isArray(body.checklistKeys) ? body.checklistKeys : [...allowedChecklistKeys]).map(String).filter((key) => allowedChecklistKeys.has(key)))];
        if (!checklistKeys.length) throw Object.assign(new Error("请至少选择一项交给工厂处理的任务。"), { statusCode: 400, code: "factory_task_required" });
        const dueDate = String(body.dueDate || current.nextDueDate || current.expectedLaunchDate || "").trim();
        const sampleSubject = ["formula", "raw_material", "packaging_box", "packaging_bottle"].includes(String(body.sampleSubject || "")) ? String(body.sampleSubject) : "formula";
        const sampleCategory = ["packaging_box", "packaging_bottle"].includes(sampleSubject) ? "packaging" : "inner_material";
        const requirements = String(body.requirements || [current.sellingPoints, current.reason].filter(Boolean).join("\n")).trim().slice(0, 5000);
        const assignmentSequence = (current.factoryAssignments || []).filter((item) => item.organizationCode === factory.code).length + 1;
        const documentNo = `KP-${current.id}-${factory.code}-${String(assignmentSequence).padStart(2, "0")}`.slice(0, 120);
        const published = await collaborationBridge.publishPartnerTask(factory.code, {
          taskType: "sampling_task",
          documentNo,
          title: `${current.title} · 开品打样与报价`,
          productName: current.title,
          productSpec: [current.category, current.sellingPoints].filter(Boolean).join(" · ").slice(0, 1000),
          description: `关联开品需求 ${current.id}`,
          requirements,
          priority: ["urgent", "high"].includes(current.priority) ? "urgent" : "normal",
          dueAt: /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? `${dueDate}T15:59:00.000Z` : "",
          quantity: Number(current.firstOrderQty) > 0 ? Number(current.firstOrderQty) : 1,
          unit: "件",
          sampleCategory,
          sampleSubject,
          sampleGoal: String(body.sampleGoal || `完成 ${current.title} 的打样定版`).trim().slice(0, 2000),
          evaluationCriteria: String(body.evaluationCriteria || "原料、配方、样品测试结果满足需求并具备量产可行性").trim().slice(0, 5000),
          quoteRequired: checklistKeys.includes("factory_quote"),
          lines: [],
        }, { actorName: auth.user.displayName || auth.user.username || auth.user.id || "开品负责人" });
        if (!published.workItemId) {
          throw Object.assign(new Error("协同任务未完整发布，系统没有写入指派关系；请检查协同服务后重试。"), { statusCode: 502, code: "collaboration_publish_incomplete" });
        }
        const request = service.assignFactory(id, {
          organizationCode: factory.code,
          organizationName: factory.name,
          organizationType: factory.organizationType,
          checklistKeys,
          workItemId: published.workItemId,
          documentNo: published.coreRefId || documentNo,
          dueDate: /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : "",
          sampleCategory,
          sampleSubject,
          quoteRequired: checklistKeys.includes("factory_quote"),
          requirements,
        }, auth.user, { ...scope, canManage: true });
        appendActionLog(auth, "指派开品委外工厂", "product_launch_request", request.id, { organizationCode: factory.code, workItemId: published.workItemId, checklistKeys });
        sendJson(res, 201, { ok: true, request: presentRequest(request, workflowV2) });
        return true;
      }

      const checklistMatch = suffix.match(/^\/requests\/([^/]+)\/checklist\/([^/]+)$/);
      if (checklistMatch && req.method === "PATCH") {
        const id = decodeURIComponent(checklistMatch[1]);
        const itemKey = decodeURIComponent(checklistMatch[2]);
        const request = service.updateChecklist(id, itemKey, await readJsonBody(req), auth.user, { ...scope, canManage: can.manage, owners: listOwners() });
        appendActionLog(auth, "更新开品清单", "product_launch_request", request.id, { itemKey, progress: request.checklistProgress });
        sendJson(res, 200, { ok: true, request: presentRequest(request, workflowV2) });
        return true;
      }

      const filingMatch = suffix.match(/^\/requests\/([^/]+)\/filings\/([^/]+)$/);
      if (filingMatch && req.method === "PATCH") {
        const id = decodeURIComponent(filingMatch[1]);
        const countryKey = decodeURIComponent(filingMatch[2]);
        const request = service.updateFiling(id, countryKey, await readJsonBody(req), auth.user, { ...scope, canManage: can.manage, owners: listOwners() });
        appendActionLog(auth, "更新国家备案", "product_launch_request", request.id, { countryKey, progress: request.filingProgress });
        sendJson(res, 200, { ok: true, request: presentRequest(request, workflowV2) });
        return true;
      }

      const match = suffix.match(/^\/requests\/([^/]+)(\/stage|\/comments|\/pilot)?$/);
      if (match) {
        const id = decodeURIComponent(match[1]);
        const action = match[2] || "";
        if (!action && req.method === "GET") {
          const request = service.get(id, scope);
          if (!request) sendJson(res, 404, { ok: false, code: "not_found", message: "没有找到这条开品需求。" });
          else sendJson(res, 200, { ok: true, request: presentRequest(request, workflowV2), permissions: can });
          return true;
        }
        if (!action && req.method === "PATCH") {
          if (!can.submit) throw Object.assign(new Error("当前账号没有修改开品需求的权限。"), { statusCode: 403, code: "forbidden" });
          const request = service.update(id, await readJsonBody(req), auth.user, { ...scope, canManage: can.manage });
          appendActionLog(auth, "修改开品需求", "product_launch_request", request.id, { title: request.title });
          sendJson(res, 200, { ok: true, request: presentRequest(request, workflowV2) });
          return true;
        }
        if (action === "/stage" && req.method === "POST") {
          const body = await readJsonBody(req);
          const request = service.progress(id, body, auth.user, { ...scope, canManage: can.manage, owners: listOwners() });
          appendActionLog(auth, "推进开品需求", "product_launch_request", request.id, { stage: request.stage, owner: request.owner?.name || "" });
          sendJson(res, 200, { ok: true, request: presentRequest(request, workflowV2) });
          return true;
        }
        if (action === "/comments" && req.method === "POST") {
          const request = service.comment(id, await readJsonBody(req), auth.user, scope);
          sendJson(res, 200, { ok: true, request: presentRequest(request, workflowV2) });
          return true;
        }
        if (action === "/pilot" && req.method === "PATCH") {
          const request = service.updatePilot(id, await readJsonBody(req), auth.user, { ...scope, canManage: can.manage });
          appendActionLog(auth, "更新首批生产", "product_launch_request", request.id, { pilotProduction: request.pilotProduction });
          sendJson(res, 200, { ok: true, request: presentRequest(request, workflowV2) });
          return true;
        }
      }
      sendJson(res, 404, { ok: false, code: "not_found", message: "接口不存在。" });
      return true;
    } catch (error) {
      const status = Number(error?.statusCode) || 400;
      sendJson(res, status, { ok: false, code: error?.code || "request_failed", message: error instanceof Error ? error.message : "请求失败" });
      return true;
    }
  };
}
