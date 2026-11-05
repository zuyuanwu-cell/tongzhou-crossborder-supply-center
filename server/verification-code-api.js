function pathId(pathname, pattern) {
  const match = pathname.match(pattern);
  return match ? decodeURIComponent(match[1]) : "";
}

export function createVerificationCodeApi({ service, getAuth, hasPermission, parseRequestBody, sendJson, appendActionLog }) {
  function authorize(req, res, permission) {
    const auth = getAuth(req);
    if (!auth?.user?.id || auth.role === "guest") {
      sendJson(res, 401, { ok: false, message: "请先登录。" });
      return null;
    }
    if (!hasPermission(auth, permission)) {
      sendJson(res, 403, { ok: false, message: "当前账号没有验证码中心权限。" });
      return null;
    }
    return auth;
  }

  async function handle(req, res, url) {
    if (!url.pathname.startsWith("/api/verification-code-center")) return false;
    const requestAuth = getAuth(req);
    const manage = hasPermission(requestAuth, "verification_code_manage");

    if (url.pathname === "/api/verification-code-center" && req.method === "GET") {
      const auth = authorize(req, res, "verification_code_view");
      if (!auth) return true;
      sendJson(res, 200, service.payload(auth, { manage }));
      return true;
    }

    if (url.pathname === "/api/verification-code-center/mailboxes" && req.method === "POST") {
      const auth = authorize(req, res, "verification_code_manage");
      if (!auth) return true;
      const mailbox = await service.upsertMailbox(await parseRequestBody(req, 64 * 1024));
      appendActionLog(auth, "新增验证码邮箱", "verification_mailbox", mailbox.address, { mailboxId: mailbox.id, host: mailbox.host });
      sendJson(res, 201, { ...service.payload(auth, { manage: true }), mailbox });
      return true;
    }

    const mailboxId = pathId(url.pathname, /^\/api\/verification-code-center\/mailboxes\/([^/]+)$/);
    if (mailboxId && req.method === "PATCH") {
      const auth = authorize(req, res, "verification_code_manage");
      if (!auth) return true;
      const body = await parseRequestBody(req, 64 * 1024);
      const mailbox = await service.upsertMailbox(body, mailboxId);
      appendActionLog(auth, "更新验证码邮箱", "verification_mailbox", mailbox.address, { mailboxId: mailbox.id, host: mailbox.host, secretChanged: Boolean(body.password) });
      sendJson(res, 200, { ...service.payload(auth, { manage: true }), mailbox });
      return true;
    }
    if (mailboxId && req.method === "DELETE") {
      const auth = authorize(req, res, "verification_code_manage");
      if (!auth) return true;
      await service.deleteMailbox(mailboxId);
      appendActionLog(auth, "删除验证码邮箱", "verification_mailbox", mailboxId, { mailboxId });
      sendJson(res, 200, service.payload(auth, { manage: true }));
      return true;
    }

    const mailboxTestId = pathId(url.pathname, /^\/api\/verification-code-center\/mailboxes\/([^/]+)\/test$/);
    if (mailboxTestId && req.method === "POST") {
      const auth = authorize(req, res, "verification_code_manage");
      if (!auth) return true;
      const result = await service.testMailbox(mailboxTestId);
      appendActionLog(auth, "测试验证码邮箱", "verification_mailbox", mailboxTestId, { mailboxId: mailboxTestId, ok: true, latencyMs: result.latencyMs });
      sendJson(res, 200, { ...result, payload: service.payload(auth, { manage: true }) });
      return true;
    }

    if (url.pathname === "/api/verification-code-center/bindings" && req.method === "POST") {
      const auth = authorize(req, res, "verification_code_manage");
      if (!auth) return true;
      const binding = service.upsertBinding(await parseRequestBody(req, 64 * 1024));
      appendActionLog(auth, "新增验证码店铺绑定", "verification_binding", binding.shopName, { bindingId: binding.id, shopKey: binding.shopKey, allowedUserCount: binding.allowedUserIds.length });
      sendJson(res, 201, { ...service.payload(auth, { manage: true }), binding });
      return true;
    }

    const bindingId = pathId(url.pathname, /^\/api\/verification-code-center\/bindings\/([^/]+)$/);
    if (bindingId && req.method === "PATCH") {
      const auth = authorize(req, res, "verification_code_manage");
      if (!auth) return true;
      const binding = service.upsertBinding(await parseRequestBody(req, 64 * 1024), bindingId);
      appendActionLog(auth, "更新验证码店铺绑定", "verification_binding", binding.shopName, { bindingId: binding.id, shopKey: binding.shopKey, allowedUserCount: binding.allowedUserIds.length });
      sendJson(res, 200, { ...service.payload(auth, { manage: true }), binding });
      return true;
    }
    if (bindingId && req.method === "DELETE") {
      const auth = authorize(req, res, "verification_code_manage");
      if (!auth) return true;
      service.deleteBinding(bindingId);
      appendActionLog(auth, "删除验证码店铺绑定", "verification_binding", bindingId, { bindingId });
      sendJson(res, 200, service.payload(auth, { manage: true }));
      return true;
    }

    if (url.pathname === "/api/verification-code-center/requests" && req.method === "POST") {
      const auth = authorize(req, res, "verification_code_view");
      if (!auth) return true;
      const body = await parseRequestBody(req, 16 * 1024);
      const request = await service.createRequest(auth, String(body.bindingId || ""));
      appendActionLog(auth, "请求店铺登录验证码", "verification_request", request.shopName, { requestId: request.id, bindingId: request.bindingId, platform: request.platform });
      sendJson(res, 201, { request, payload: service.payload(auth, { manage }) });
      return true;
    }

    const refreshRequestId = pathId(url.pathname, /^\/api\/verification-code-center\/requests\/([^/]+)\/refresh$/);
    if (refreshRequestId && req.method === "POST") {
      const auth = authorize(req, res, "verification_code_view");
      if (!auth) return true;
      const request = await service.refreshRequest(auth, refreshRequestId, manage);
      sendJson(res, 200, { request, payload: service.payload(auth, { manage }) });
      return true;
    }

    const revealRequestId = pathId(url.pathname, /^\/api\/verification-code-center\/requests\/([^/]+)\/reveal$/);
    if (revealRequestId && req.method === "POST") {
      const auth = authorize(req, res, "verification_code_view");
      if (!auth) return true;
      const body = await parseRequestBody(req, 8 * 1024);
      const purpose = body.purpose === "copy" ? "copy" : "view";
      const revealed = service.revealCode(auth, revealRequestId, purpose, manage);
      appendActionLog(auth, purpose === "copy" ? "复制店铺登录验证码" : "查看店铺登录验证码", "verification_request", revealed.shopName, { requestId: revealRequestId, platform: revealed.platform, expiresAt: revealed.expiresAt });
      sendJson(res, 200, { ok: true, ...revealed });
      return true;
    }

    sendJson(res, 404, { ok: false, message: "验证码中心接口不存在。" });
    return true;
  }

  return { handle };
}
