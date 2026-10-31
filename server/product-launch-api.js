import { hasPermission, normalizeDataScopes } from "./access-control.js";
import { productLaunchMeta } from "./product-launch.js";

// HTTP routes for 开品需求 (product launch requests), mounted under /api/product-launch.
const BASE = "/api/product-launch";
const MAX_BODY_BYTES = 256 * 1024;
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

export function createProductLaunchApi({ service, getAuth, appendActionLog = () => {}, listOwners = () => [], listCountries = () => [] }) {
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
        sendJson(res, 200, { ...presentMeta(productLaunchMeta({ countries: listCountries(), owners: listOwners() }), workflowV2), permissions: can });
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
