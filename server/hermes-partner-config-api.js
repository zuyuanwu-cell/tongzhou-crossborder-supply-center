import { hasPermission } from "./access-control.js";

function fail(message, statusCode = 400, code = "invalid_request") {
  throw Object.assign(new Error(message), { statusCode, code });
}

function requireAdmin(auth) {
  if (!auth?.user?.id || auth.role === "guest") fail("请先登录。", 401, "authentication_required");
  if (auth.role !== "admin" || ["system", "legacy-internal"].includes(auth.user.id) || !hasPermission(auth, "hermes_agent_admin")) {
    fail("仅系统管理员可以配置伙伴快捷汇报。", 403, "hermes_admin_required");
  }
}

export function createHermesPartnerConfigApi({ bridge, getAuth, parseRequestBody, sendJson, appendActionLog = () => {} } = {}) {
  return async function handleHermesPartnerConfig(req, res, url) {
    const configPath = "/api/hermes/partner-progress-config";
    const testPath = `${configPath}/test`;
    if (url.pathname !== configPath && url.pathname !== testPath) return false;
    try {
      const auth = getAuth(req);
      requireAdmin(auth);
      if (url.pathname === configPath && req.method === "GET") {
        const [settings, organizationResult] = await Promise.all([bridge.getPartnerAiConfig(), bridge.listOrganizations({ status: "active" })]);
        const organizations = (organizationResult?.organizations || []).map((item) => ({
          id: item.id, code: item.code, name: item.name, organizationType: item.organizationType,
        }));
        sendJson(res, 200, { ...settings, organizations });
        return true;
      }
      if (url.pathname === configPath && req.method === "PUT") {
        const input = await parseRequestBody(req, 64 * 1024);
        const result = await bridge.savePartnerAiConfig({ ...input, actorId: auth.user.id });
        appendActionLog(auth, "更新伙伴 Hermes 快捷汇报配置", "partner_ai_config", "global", {
          enabled: Boolean(result?.config?.enabled), textEnabled: Boolean(result?.config?.textEnabled), voiceEnabled: Boolean(result?.config?.voiceEnabled),
          organizationCount: Array.isArray(result?.config?.organizationIds) ? result.config.organizationIds.length : 0,
        });
        sendJson(res, 200, result);
        return true;
      }
      if (url.pathname === testPath && req.method === "POST") {
        sendJson(res, 200, await bridge.testPartnerAiAsr(await parseRequestBody(req, 32 * 1024)));
        return true;
      }
      fail("伙伴快捷汇报配置接口不存在。", 404, "not_found");
    } catch (error) {
      if (!res.headersSent) sendJson(res, Number(error?.statusCode || 500), { ok: false, code: error?.code || "partner_ai_config_error", message: error?.message || "伙伴快捷汇报配置失败。" });
      return true;
    }
  };
}
