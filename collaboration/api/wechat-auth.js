import { createHmac } from "node:crypto";
import { z } from "zod";
import { collaborationConfig } from "./config.js";
import { withSystem } from "./db.js";
import {
  LOGIN_ROW_SELECT,
  assertLoginRate,
  assertLoginRowUsable,
  issueLoginSession,
  writeAudit,
} from "./auth.js";

// WeChat mini program quick login.
// Flow: the mini program calls wx.login() for a one-time code, we swap it for the openid
// at api.weixin.qq.com, and look up which account that WeChat was bound to.
// Raw openid / unionid / session_key never leave this module and are never stored or logged.

const codeSchema = z.object({ code: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9_\-+/=]+$/) });

function wechatError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

export function wechatConfigured() {
  return Boolean(collaborationConfig.wechat.appId && collaborationConfig.wechat.appSecret);
}

export function wechatIdentityHash(kind, value) {
  return createHmac("sha256", collaborationConfig.secretKey)
    .update(`wechat:${kind}:${collaborationConfig.wechat.appId}:${value}`)
    .digest("hex");
}

function parseCode(input) {
  const parsed = codeSchema.safeParse(input || {});
  if (!parsed.success) throw wechatError("微信授权信息无效，请重试。", 400, "wechat_code_invalid");
  return parsed.data.code;
}

export async function exchangeWechatCode(code, { fetchImpl = fetch } = {}) {
  if (!wechatConfigured()) throw wechatError("微信快捷登录还没开通，请先用账号密码登录。", 503, "wechat_not_configured");
  const url = new URL(`${collaborationConfig.wechat.apiBaseUrl}/sns/jscode2session`);
  url.searchParams.set("appid", collaborationConfig.wechat.appId);
  url.searchParams.set("secret", collaborationConfig.wechat.appSecret);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");
  let response;
  let body = {};
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(8_000) });
    body = await response.json().catch(() => ({}));
  } catch {
    throw wechatError("连不上微信服务器，请稍后再试或用账号密码登录。", 502, "wechat_unavailable");
  }
  const errcode = Number(body?.errcode || 0);
  if (errcode === 40029 || errcode === 40163) throw wechatError("微信授权已过期，请再点一次。", 400, "wechat_code_invalid");
  if (errcode === 45011) throw wechatError("操作太频繁了，请稍后再试。", 429, "wechat_rate_limited");
  if (!response?.ok || errcode || typeof body?.openid !== "string" || !body.openid) {
    console.warn(`[collaboration:wechat] jscode2session failed status=${response?.status || 0} errcode=${errcode || "none"}`);
    throw wechatError("微信登录暂时不可用，请先用账号密码登录。", 502, "wechat_unavailable");
  }
  return {
    openidHash: wechatIdentityHash("openid", body.openid),
    unionidHash: typeof body.unionid === "string" && body.unionid ? wechatIdentityHash("unionid", body.unionid) : null,
  };
}

export async function wechatBindingStatus(userId) {
  const configured = wechatConfigured();
  if (!configured || !userId) return { configured, bound: false, boundAt: "" };
  return withSystem(async (client) => {
    const result = await client.query(
      "SELECT created_at FROM collaboration_wechat_bindings WHERE user_id=$1 AND app_id=$2",
      [userId, collaborationConfig.wechat.appId],
    );
    const row = result.rows[0];
    return { configured, bound: Boolean(row), boundAt: row ? new Date(row.created_at).toISOString() : "" };
  });
}

export async function wechatLogin(req, input, options = {}) {
  const clearAttempt = assertLoginRate(req, "wechat");
  const code = parseCode(input);
  const identity = await exchangeWechatCode(code, options);
  return withSystem(async (client) => {
    const binding = await client.query(
      "SELECT id,user_id FROM collaboration_wechat_bindings WHERE app_id=$1 AND openid_hash=$2",
      [collaborationConfig.wechat.appId, identity.openidHash],
    );
    if (!binding.rows[0]) throw wechatError("这个微信还没有绑定账号。请先用账号密码登录，登录后按提示绑定微信。", 404, "wechat_not_bound");
    const result = await client.query(`${LOGIN_ROW_SELECT}\n        WHERE u.id=$1`, [binding.rows[0].user_id]);
    if (result.rowCount > 1) throw wechatError("账号归属异常，请联系管理员。", 409, "account_membership_invalid");
    const row = assertLoginRowUsable(result.rows[0]);
    clearAttempt();
    await client.query(
      "UPDATE collaboration_wechat_bindings SET last_login_at=now(),unionid_hash=coalesce($2,unionid_hash) WHERE id=$1",
      [binding.rows[0].id, identity.unionidHash],
    );
    return issueLoginSession(client, row, req, { auditAction: "auth.wechat_login", auditMetadata: { method: "wechat_mini_program" } });
  });
}

export async function bindWechat(req, auth, input, options = {}) {
  const code = parseCode(input);
  const identity = await exchangeWechatCode(code, options);
  const appId = collaborationConfig.wechat.appId;
  return withSystem(async (client) => {
    const existing = await client.query(
      "SELECT user_id FROM collaboration_wechat_bindings WHERE app_id=$1 AND openid_hash=$2",
      [appId, identity.openidHash],
    );
    const owner = existing.rows[0]?.user_id;
    if (owner && owner !== auth.user.id) {
      throw wechatError("这个微信已经绑定了别的账号。请先在那个账号的“我的”页面解除绑定，再来绑定。", 409, "wechat_bound_elsewhere");
    }
    if (!owner) {
      // One WeChat per account: binding a new WeChat replaces the old one.
      await client.query("DELETE FROM collaboration_wechat_bindings WHERE user_id=$1 AND app_id=$2", [auth.user.id, appId]);
      await client.query(
        "INSERT INTO collaboration_wechat_bindings(user_id,app_id,openid_hash,unionid_hash) VALUES ($1,$2,$3,$4)",
        [auth.user.id, appId, identity.openidHash, identity.unionidHash],
      );
      await writeAudit(client, auth, "auth.wechat_bind", "success", req, { method: "wechat_mini_program" });
    }
    return { configured: true, bound: true, boundAt: new Date().toISOString() };
  });
}

export async function unbindWechat(req, auth) {
  const appId = collaborationConfig.wechat.appId;
  return withSystem(async (client) => {
    const result = await client.query("DELETE FROM collaboration_wechat_bindings WHERE user_id=$1 AND app_id=$2", [auth.user.id, appId]);
    if (result.rowCount) await writeAudit(client, auth, "auth.wechat_unbind", "success", req, { method: "wechat_mini_program" });
    return { configured: wechatConfigured(), bound: false, boundAt: "" };
  });
}
