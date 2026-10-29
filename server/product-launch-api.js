import { hasPermission, normalizeDataScopes } from "./access-control.js";
import { productLaunchMeta } from "./product-launch.js";

// HTTP routes for 开品需求 (product launch requests), mounted under /api/product-launch.
const BASE = "/api/product-launch";
const MAX_BODY_BYTES = 256 * 1024;

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

      if (suffix === "/meta" && req.method === "GET") {
        sendJson(res, 200, { ...productLaunchMeta({ countries: listCountries(), owners: listOwners() }), permissions: can });
        return true;
      }
      if (suffix === "/requests" && req.method === "GET") {
        sendJson(res, 200, { ...service.list(Object.fromEntries(url.searchParams.entries()), scope), permissions: can });
        return true;
      }
      if (suffix === "/requests" && req.method === "POST") {
        if (!can.submit) throw Object.assign(new Error("当前账号没有提交开品需求的权限。"), { statusCode: 403, code: "forbidden" });
        const request = service.create(await readJsonBody(req), auth.user, scope);
        appendActionLog(auth, "提交开品需求", "product_launch_request", request.id, { title: request.title, country: request.country, priority: request.priority });
        sendJson(res, 201, { ok: true, request });
        return true;
      }

      const match = suffix.match(/^\/requests\/([^/]+)(\/stage|\/comments)?$/);
      if (match) {
        const id = decodeURIComponent(match[1]);
        const action = match[2] || "";
        if (!action && req.method === "GET") {
          const request = service.get(id, scope);
          if (!request) sendJson(res, 404, { ok: false, code: "not_found", message: "没有找到这条开品需求。" });
          else sendJson(res, 200, { ok: true, request, permissions: can });
          return true;
        }
        if (!action && req.method === "PATCH") {
          if (!can.submit) throw Object.assign(new Error("当前账号没有修改开品需求的权限。"), { statusCode: 403, code: "forbidden" });
          const request = service.update(id, await readJsonBody(req), auth.user, { ...scope, canManage: can.manage });
          appendActionLog(auth, "修改开品需求", "product_launch_request", request.id, { title: request.title });
          sendJson(res, 200, { ok: true, request });
          return true;
        }
        if (action === "/stage" && req.method === "POST") {
          const body = await readJsonBody(req);
          const request = service.progress(id, body, auth.user, { ...scope, canManage: can.manage, owners: listOwners() });
          appendActionLog(auth, "推进开品需求", "product_launch_request", request.id, { stage: request.stage, owner: request.owner?.name || "" });
          sendJson(res, 200, { ok: true, request });
          return true;
        }
        if (action === "/comments" && req.method === "POST") {
          const request = service.comment(id, await readJsonBody(req), auth.user, scope);
          sendJson(res, 200, { ok: true, request });
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
