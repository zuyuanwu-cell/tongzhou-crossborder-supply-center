import { hasPermission } from "./access-control.js";

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  });
  res.end(JSON.stringify(payload));
}

function requirePermission(auth, permission, message) {
  if (auth?.role === "admin" || hasPermission(auth, permission)) return;
  throw Object.assign(new Error(message), { statusCode: 403, code: "forbidden" });
}

function queryObject(url) {
  return Object.fromEntries(url.searchParams.entries());
}

function openApiDocument() {
  return {
    openapi: "3.0.3",
    info: { title: "同舟业务链路 API", version: "1.0.0", description: "开品、报价、合同、生产、采购、入库、发货和结算的只读索引接口。" },
    paths: {
      "/api/business-chain/summary": { get: { summary: "业务链路概览" } },
      "/api/business-chain/contracts": { get: { summary: "分页查询销售合同履约" } },
      "/api/business-chain/contracts/{id}": { get: { summary: "查询合同完整业务链路" } },
      "/api/business-chain/payables": { get: { summary: "查询供应商应付台账" } },
      "/api/business-chain/sync-status": { get: { summary: "查询索引同步状态" } },
      "/api/business-chain/sync": { post: { summary: "提交后台索引同步任务" } },
    },
  };
}

export function createBusinessChainApi({ service, syncService, getAuth, appendActionLog = () => {} }) {
  return async function handleBusinessChainApi(req, res, url) {
    if (!url.pathname.startsWith("/api/business-chain")) return false;
    const auth = getAuth(req);
    try {
      const suffix = url.pathname.replace("/api/business-chain", "") || "/";
      if (suffix === "/openapi.json" && req.method === "GET") {
        requirePermission(auth, "api_access", "当前账号没有 API 文档查看权限。");
        sendJson(res, 200, openApiDocument());
        return true;
      }
      requirePermission(auth, "business_chain_view", "当前账号没有业务链路查看权限。");
      const finance = auth?.role === "admin" || hasPermission(auth, "contract_finance_view");
      if ((suffix === "/" || suffix === "/summary") && req.method === "GET") {
        sendJson(res, 200, service.summary({ finance }));
        return true;
      }
      if (suffix === "/contracts" && req.method === "GET") {
        sendJson(res, 200, service.listContracts(queryObject(url), { finance }));
        return true;
      }
      const contractMatch = suffix.match(/^\/contracts\/([^/]+)$/);
      if (contractMatch && req.method === "GET") {
        const result = service.getContract(decodeURIComponent(contractMatch[1]), { finance });
        if (!result) sendJson(res, 404, { ok: false, code: "not_found", message: "未找到该合同链路。" });
        else sendJson(res, 200, result);
        return true;
      }
      if (suffix === "/payables" && req.method === "GET") {
        requirePermission(auth, "contract_finance_view", "当前账号没有合同财务台账权限。");
        sendJson(res, 200, service.listPayables(queryObject(url)));
        return true;
      }
      if (suffix === "/sync-status" && req.method === "GET") {
        sendJson(res, 200, service.syncStatus());
        return true;
      }
      if (suffix === "/sync" && req.method === "POST") {
        requirePermission(auth, "business_chain_sync", "当前账号没有业务链路同步权限。");
        const result = syncService.start({ reason: `manual:${auth?.user?.username || auth?.user?.id || "unknown"}` });
        appendActionLog(auth, "提交业务链路索引同步", "business_chain_sync", "all", { accepted: result.accepted });
        sendJson(res, result.accepted ? 202 : 200, { ok: true, ...result });
        return true;
      }
      sendJson(res, 404, { ok: false, code: "not_found", message: "业务链路接口不存在。" });
      return true;
    } catch (error) {
      sendJson(res, Number(error?.statusCode || 400), { ok: false, code: error?.code || "business_chain_error", message: error?.message || "业务链路请求失败。" });
      return true;
    }
  };
}
