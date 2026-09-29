import { collaborationConfig } from "./config.js";
import { withSystem } from "./db.js";
import {
  clearLegacyCsrfCookie,
  clearSessionCookies,
  csrfCookie,
  parseCookies,
  randomToken,
  safeEqual,
  sessionCookie,
  tokenHash,
  verifyPassword,
} from "./security.js";
import { requiresMfaAtLogin } from "./permissions.js";

const SESSION_COOKIE = "tz_collab_session";
const CSRF_COOKIE = "tz_collab_csrf";
const loginAttempts = new Map();

function cookieValues(header, name) {
  return String(header || "").split(";").flatMap((part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return [];
    try {
      const key = decodeURIComponent(part.slice(0, separator).trim());
      return key === name ? [decodeURIComponent(part.slice(separator + 1).trim())] : [];
    } catch {
      return [];
    }
  });
}

function matchingCsrfToken(req, auth) {
  return cookieValues(req.headers.cookie, CSRF_COOKIE)
    .find((value) => safeEqual(tokenHash(value), auth?.csrfTokenHash)) || "";
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
}

function pruneLoginAttempts(now = Date.now()) {
  for (const [key, value] of loginAttempts) {
    if (now - value.windowStartedAt > 15 * 60 * 1000) loginAttempts.delete(key);
  }
}

function assertLoginRate(req, username) {
  pruneLoginAttempts();
  const key = `${clientIp(req)}:${String(username || "").toLowerCase()}`;
  const now = Date.now();
  const entry = loginAttempts.get(key) || { count: 0, windowStartedAt: now };
  if (entry.count >= 10) throw Object.assign(new Error("登录尝试过于频繁，请稍后再试。"), { statusCode: 429, code: "login_rate_limited" });
  loginAttempts.set(key, { ...entry, count: entry.count + 1 });
  return () => loginAttempts.delete(key);
}

function membershipFromRow(row) {
  return {
    id: row.membership_id,
    organizationId: row.organization_id,
    organizationCode: row.organization_code,
    organizationName: row.organization_name,
    organizationType: row.organization_type,
    role: row.membership_role,
    status: row.membership_status,
    permissions: Array.isArray(row.permissions) ? row.permissions : [],
    mfaRequired: false,
  };
}

function publicAuth(row) {
  const membership = membershipFromRow(row);
  return {
    user: { id: row.user_id, username: row.username, displayName: row.display_name, email: row.email || "" },
    membership,
    organization: {
      id: row.organization_id,
      code: row.organization_code,
      name: row.organization_name,
      type: row.organization_type,
    },
    mfaRequired: requiresMfaAtLogin(membership),
    mfaEnabled: false,
    mfaVerifiedAt: "",
    mustChangePassword: false,
  };
}

async function writeAudit(client, auth, action, result, req, metadata = {}) {
  await client.query(
    `INSERT INTO audit_log(organization_id,actor_user_id,actor_name,action,object_type,object_id,result,ip_address,metadata)
     VALUES ($1,$2,$3,$4,'session',$5,$6,$7,$8)`,
    [auth.organization.id, auth.user.id, auth.user.displayName, action, auth.user.id, result, clientIp(req) || null, metadata],
  );
}

export async function login(req, { username, password }) {
  const clearAttempt = assertLoginRate(req, username);
  const normalizedUsername = String(username || "").trim().toLowerCase();
  if (!normalizedUsername || !password) throw Object.assign(new Error("请输入账号和密码。"), { statusCode: 400, code: "credentials_required" });
  return withSystem(async (client) => {
    const result = await client.query(
      `SELECT u.id AS user_id,u.username,u.email,u.display_name,u.password_hash,u.status AS user_status,u.must_change_password,
              u.failed_login_count,u.locked_until,u.totp_secret_ciphertext,u.totp_enabled_at,
              m.id AS membership_id,m.organization_id,m.role AS membership_role,m.status AS membership_status,m.permissions,m.mfa_required,
              o.code AS organization_code,o.name AS organization_name,o.organization_type,o.status AS organization_status
         FROM collaboration_users u
         JOIN organization_memberships m ON m.user_id=u.id
         JOIN organizations o ON o.id=m.organization_id
        WHERE lower(u.username)=lower($1)
        ORDER BY CASE m.role WHEN 'organization_admin' THEN 0 ELSE 1 END,o.code`,
      [normalizedUsername],
    );
    if (result.rowCount > 1) {
      throw Object.assign(new Error("账号归属异常，请联系管理员。"), { statusCode: 409, code: "account_membership_invalid" });
    }
    const row = result.rows[0];
    const now = new Date();
    if (!row || row.user_status !== "active" || row.membership_status !== "active" || row.organization_status !== "active") {
      throw Object.assign(new Error("账号、密码或组织无效。"), { statusCode: 401, code: "invalid_credentials" });
    }
    if (row.locked_until && new Date(row.locked_until) > now) {
      throw Object.assign(new Error("账号暂时锁定，请稍后再试。"), { statusCode: 423, code: "account_locked" });
    }
    if (!(await verifyPassword(row.password_hash, password))) {
      const nextFailures = Number(row.failed_login_count || 0) + 1;
      const lockUntil = nextFailures >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
      await client.query("UPDATE collaboration_users SET failed_login_count=$2,locked_until=$3 WHERE id=$1", [row.user_id, nextFailures, lockUntil]);
      throw Object.assign(new Error("账号、密码或组织无效。"), { statusCode: 401, code: "invalid_credentials" });
    }

    clearAttempt();
    const rawSession = randomToken();
    const rawCsrf = randomToken(24);
    const expiresAt = new Date(Date.now() + collaborationConfig.sessionAbsoluteMs);
    const mfaRequired = requiresMfaAtLogin(membershipFromRow(row));
    await client.query("UPDATE collaboration_users SET failed_login_count=0,locked_until=NULL,status='active',last_login_at=now() WHERE id=$1", [row.user_id]);
    const sessionResult = await client.query(
      `INSERT INTO collaboration_sessions(token_hash,csrf_token_hash,user_id,membership_id,ip_address,user_agent,mfa_verified_at,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [tokenHash(rawSession), tokenHash(rawCsrf), row.user_id, row.membership_id, clientIp(req) || null, String(req.headers["user-agent"] || "").slice(0, 500), null, expiresAt],
    );
    const auth = { ...publicAuth({ ...row, mfa_verified_at: null }), sessionId: sessionResult.rows[0].id };
    await writeAudit(client, auth, "auth.login", "success", req, { mfaRequired });
    return {
      auth,
      mfaSetupRequired: mfaRequired && !row.totp_secret_ciphertext,
      cookies: [sessionCookie(rawSession), csrfCookie(rawCsrf)],
    };
  });
}

export async function authenticate(req) {
  const cookies = parseCookies(req.headers.cookie);
  const rawSession = cookies[SESSION_COOKIE];
  if (!rawSession) return null;
  return withSystem(async (client) => {
    const result = await client.query(
      `SELECT s.id AS session_id,s.csrf_token_hash,s.mfa_verified_at,s.last_seen_at,s.expires_at,s.revoked_at,
              u.id AS user_id,u.username,u.email,u.display_name,u.status AS user_status,u.must_change_password,u.totp_enabled_at,u.totp_secret_ciphertext,
              m.id AS membership_id,m.organization_id,m.role AS membership_role,m.status AS membership_status,m.permissions,m.mfa_required,
              o.code AS organization_code,o.name AS organization_name,o.organization_type,o.status AS organization_status
         FROM collaboration_sessions s
         JOIN collaboration_users u ON u.id=s.user_id
         JOIN organization_memberships m ON m.id=s.membership_id
         JOIN organizations o ON o.id=m.organization_id
        WHERE s.token_hash=$1`,
      [tokenHash(rawSession)],
    );
    const row = result.rows[0];
    const now = Date.now();
    const invalid = !row || row.revoked_at || new Date(row.expires_at).getTime() <= now
      || new Date(row.last_seen_at).getTime() + collaborationConfig.sessionIdleMs <= now
      || row.user_status !== "active" || row.membership_status !== "active" || row.organization_status !== "active";
    if (invalid) return null;
    const auth = { ...publicAuth(row), sessionId: row.session_id, csrfTokenHash: row.csrf_token_hash };
    await client.query("UPDATE collaboration_sessions SET last_seen_at=now() WHERE id=$1", [row.session_id]);
    return auth;
  });
}

export function assertAuthenticated(auth) {
  if (!auth) throw Object.assign(new Error("请先登录。"), { statusCode: 401, code: "authentication_required" });
  return auth;
}

export function assertCsrf(req, auth) {
  const header = String(req.headers["x-csrf-token"] || "");
  const cookieToken = matchingCsrfToken(req, auth);
  if (!header || !cookieToken || !safeEqual(header, cookieToken)) {
    throw Object.assign(new Error("请求验证失败，请刷新页面后重试。"), { statusCode: 403, code: "csrf_failed" });
  }
}

export function refreshCsrfCookies(req, auth) {
  const token = matchingCsrfToken(req, auth);
  return token ? [csrfCookie(token), clearLegacyCsrfCookie()] : [];
}

export async function logout(req, auth) {
  if (auth?.sessionId) await withSystem((client) => client.query("UPDATE collaboration_sessions SET revoked_at=now() WHERE id=$1", [auth.sessionId]));
  return clearSessionCookies();
}
