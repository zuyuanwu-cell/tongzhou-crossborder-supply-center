import { z } from "zod";
import { collaborationConfig } from "./config.js";
import { withOrganization, withSystem } from "./db.js";
import { sendSecurityEmail } from "./notifications.js";
import { hashPassword, randomToken, tokenHash, validateNewPassword } from "./security.js";

const roles = ["organization_admin", "manager", "operator", "finance", "viewer"];
const organizationTypes = ["internal", "warehouse", "filing_service", "sampling_factory", "packaging_factory", "production_factory"];
const resetAttempts = new Map();

const invitationSchema = z.object({
  username: z.string().trim().min(3).max(80).regex(/^[A-Za-z0-9._-]+$/),
  email: z.string().trim().email().max(320),
  role: z.enum(roles),
  mfaRequired: z.boolean().optional().default(false),
}).strict();

const acceptInvitationSchema = z.object({
  token: z.string().min(32).max(512),
  displayName: z.string().trim().min(1).max(120),
  password: z.string(),
}).strict();

const resetRequestSchema = z.object({
  organizationCode: z.string().trim().min(2).max(64),
  username: z.string().trim().min(1).max(80),
}).strict();

const resetConfirmSchema = z.object({ token: z.string().min(32).max(512), password: z.string() }).strict();

const memberUpdateSchema = z.object({
  role: z.enum(roles).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  mfaRequired: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "请至少提供一个修改字段。");

const organizationSchema = z.object({
  code: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/),
  name: z.string().trim().min(1).max(200),
  organizationType: z.enum(organizationTypes),
  status: z.enum(["active", "suspended", "archived"]).optional().default("active"),
  notificationEmail: z.string().trim().email().max(320).optional().or(z.literal("")),
  wecomWebhook: z.string().trim().url().max(2_000).optional().or(z.literal("")),
}).strict();

function fail(message, statusCode = 400, code = "invalid_request") {
  throw Object.assign(new Error(message), { statusCode, code });
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
}

function assertOrganizationAdmin(auth) {
  if (auth?.membership?.role !== "organization_admin") fail("仅组织管理员可以管理成员。", 403, "forbidden");
}

function rateLimitReset(req, input) {
  const key = `${clientIp(req)}:${input.organizationCode.toLowerCase()}:${input.username.toLowerCase()}`;
  const now = Date.now();
  const existing = resetAttempts.get(key);
  const entry = !existing || now - existing.startedAt > 15 * 60_000 ? { count: 0, startedAt: now } : existing;
  if (entry.count >= 5) fail("密码重置请求过于频繁，请稍后再试。", 429, "reset_rate_limited");
  resetAttempts.set(key, { ...entry, count: entry.count + 1 });
}

function developmentSecret(value) {
  return collaborationConfig.production ? {} : { developmentToken: value };
}

export async function createInvitation(auth, body) {
  assertOrganizationAdmin(auth);
  const input = invitationSchema.parse(body);
  const rawToken = randomToken();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60_000);
  const invitation = await withOrganization(auth.organization.id, async (client) => {
    const existing = await client.query("SELECT id FROM collaboration_users WHERE lower(username)=lower($1) OR lower(email)=lower($2)", [input.username, input.email]);
    if (existing.rows[0]) fail("账号或邮箱已存在。", 409, "identity_exists");
    await client.query("UPDATE collaboration_invitations SET expires_at=now() WHERE organization_id=$1 AND lower(username)=lower($2) AND accepted_at IS NULL", [auth.organization.id, input.username]);
    const result = await client.query(
      `INSERT INTO collaboration_invitations(organization_id,email,username,role,mfa_required,token_hash,expires_at,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,username,email,role,mfa_required,expires_at`,
      [auth.organization.id, input.email, input.username, input.role, input.mfaRequired, tokenHash(rawToken), expiresAt, auth.user.id],
    );
    await client.query(
      `INSERT INTO audit_log(organization_id,actor_user_id,actor_name,action,object_type,object_id,result,metadata)
       VALUES ($1,$2,$3,'identity.invite','invitation',$4,'created',$5)`,
      [auth.organization.id, auth.user.id, auth.user.displayName, result.rows[0].id, { username: input.username, role: input.role, mfaRequired: input.mfaRequired }],
    );
    return result.rows[0];
  });
  const activationUrl = `${collaborationConfig.publicOrigin}/?invite=${encodeURIComponent(rawToken)}`;
  const delivery = await sendSecurityEmail({
    to: input.email,
    subject: `同舟协同门户邀请 · ${auth.organization.name}`,
    text: `${auth.user.displayName} 邀请你加入 ${auth.organization.name}。请在 48 小时内打开以下链接完成激活：\n${activationUrl}`,
  });
  return { invitation: { ...invitation, expiresAt: new Date(invitation.expires_at).toISOString(), expires_at: undefined }, delivery, ...developmentSecret(rawToken) };
}

export async function acceptInvitation(body) {
  const input = acceptInvitationSchema.parse(body);
  const passwordHash = await hashPassword(validateNewPassword(input.password));
  return withSystem(async (client) => {
    const invitationResult = await client.query(
      `SELECT i.*,o.code AS organization_code,o.name AS organization_name,o.status AS organization_status
         FROM collaboration_invitations i JOIN organizations o ON o.id=i.organization_id
        WHERE i.token_hash=$1 FOR UPDATE`,
      [tokenHash(input.token)],
    );
    const invitation = invitationResult.rows[0];
    if (!invitation || invitation.accepted_at || new Date(invitation.expires_at).getTime() <= Date.now() || invitation.organization_status !== "active") fail("邀请链接无效或已过期。", 410, "invitation_invalid");
    const duplicate = await client.query("SELECT id FROM collaboration_users WHERE lower(username)=lower($1) OR ($2<>'' AND lower(email)=lower($2))", [invitation.username, invitation.email || ""]);
    if (duplicate.rows[0]) fail("账号或邮箱已存在，请联系组织管理员。", 409, "identity_exists");
    const userResult = await client.query(
      `INSERT INTO collaboration_users(username,email,display_name,password_hash,status)
       VALUES ($1,$2,$3,$4,'active') RETURNING id,username,email,display_name`,
      [invitation.username, invitation.email || null, input.displayName, passwordHash],
    );
    const user = userResult.rows[0];
    const mfaRequired = invitation.role === "organization_admin" || Boolean(invitation.mfa_required);
    await client.query(
      `INSERT INTO organization_memberships(organization_id,user_id,role,status,mfa_required)
       VALUES ($1,$2,$3,'active',$4)`,
      [invitation.organization_id, user.id, invitation.role, mfaRequired],
    );
    await client.query("UPDATE collaboration_invitations SET accepted_at=now() WHERE id=$1", [invitation.id]);
    await client.query(
      `INSERT INTO audit_log(organization_id,actor_user_id,actor_name,action,object_type,object_id,result,metadata)
       VALUES ($1,$2,$3,'identity.invite.accept','user',$2,'success',$4)`,
      [invitation.organization_id, user.id, user.display_name, { username: user.username, role: invitation.role }],
    );
    return { user: { id: user.id, username: user.username, email: user.email || "", displayName: user.display_name }, organization: { code: invitation.organization_code, name: invitation.organization_name }, mfaRequired };
  });
}

export async function requestPasswordReset(req, body) {
  const input = resetRequestSchema.parse(body);
  rateLimitReset(req, input);
  const result = await withSystem(async (client) => {
    const identity = await client.query(
      `SELECT u.id,u.email,u.display_name,o.name AS organization_name
         FROM collaboration_users u JOIN organization_memberships m ON m.user_id=u.id JOIN organizations o ON o.id=m.organization_id
        WHERE lower(u.username)=lower($1) AND o.code=$2 AND u.status='active' AND m.status='active' AND o.status='active'`,
      [input.username, input.organizationCode.toLowerCase()],
    );
    if (!identity.rows[0]?.email) return null;
    const rawToken = randomToken();
    await client.query("UPDATE collaboration_password_resets SET used_at=now() WHERE user_id=$1 AND used_at IS NULL", [identity.rows[0].id]);
    await client.query(
      `INSERT INTO collaboration_password_resets(user_id,token_hash,expires_at,requested_ip)
       VALUES ($1,$2,now()+interval '30 minutes',$3)`,
      [identity.rows[0].id, tokenHash(rawToken), clientIp(req) || null],
    );
    return { ...identity.rows[0], rawToken };
  });
  if (result) {
    const resetUrl = `${collaborationConfig.publicOrigin}/?reset=${encodeURIComponent(result.rawToken)}`;
    await sendSecurityEmail({ to: result.email, subject: "同舟协同门户密码重置", text: `${result.display_name}，请在 30 分钟内打开以下链接重置密码：\n${resetUrl}\n如非本人操作，请忽略。` });
  }
  return { accepted: true, ...(result ? developmentSecret(result.rawToken) : {}) };
}

export async function confirmPasswordReset(body) {
  const input = resetConfirmSchema.parse(body);
  const passwordHash = await hashPassword(validateNewPassword(input.password));
  return withSystem(async (client) => {
    const result = await client.query("SELECT * FROM collaboration_password_resets WHERE token_hash=$1 FOR UPDATE", [tokenHash(input.token)]);
    const reset = result.rows[0];
    if (!reset || reset.used_at || new Date(reset.expires_at).getTime() <= Date.now()) fail("密码重置链接无效或已过期。", 410, "reset_invalid");
    await client.query("UPDATE collaboration_users SET password_hash=$2,password_changed_at=now(),failed_login_count=0,locked_until=NULL,status='active' WHERE id=$1", [reset.user_id, passwordHash]);
    await client.query("UPDATE collaboration_password_resets SET used_at=now() WHERE user_id=$1 AND used_at IS NULL", [reset.user_id]);
    await client.query("UPDATE collaboration_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [reset.user_id]);
    return { changed: true };
  });
}

export async function listMembers(auth) {
  assertOrganizationAdmin(auth);
  return withOrganization(auth.organization.id, async (client) => {
    const result = await client.query(
      `SELECT m.id,m.role,m.status,m.permissions,m.mfa_required,m.created_at,u.id AS user_id,u.username,u.email,u.display_name,u.status AS user_status,u.totp_enabled_at,u.last_login_at
         FROM organization_memberships m JOIN collaboration_users u ON u.id=m.user_id
        WHERE m.organization_id=$1 ORDER BY u.display_name,u.username`,
      [auth.organization.id],
    );
    return { members: result.rows.map((row) => ({ id: row.id, userId: row.user_id, username: row.username, email: row.email || "", displayName: row.display_name, userStatus: row.user_status, role: row.role, status: row.status, permissions: row.permissions || [], mfaRequired: row.mfa_required, mfaEnabled: Boolean(row.totp_enabled_at), lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : "", createdAt: new Date(row.created_at).toISOString() })) };
  });
}

export async function updateMember(auth, membershipId, body) {
  assertOrganizationAdmin(auth);
  const input = memberUpdateSchema.parse(body);
  if (membershipId === auth.membership.id && (input.status === "disabled" || (input.role && input.role !== "organization_admin"))) fail("不能停用或降级当前登录管理员。", 409, "cannot_modify_self");
  const output = await withOrganization(auth.organization.id, async (client) => {
    const result = await client.query(
      `UPDATE organization_memberships SET role=COALESCE($3,role),status=COALESCE($4,status),mfa_required=COALESCE($5,mfa_required)
        WHERE id=$1 AND organization_id=$2 RETURNING *`,
      [membershipId, auth.organization.id, input.role || null, input.status || null, input.mfaRequired ?? null],
    );
    const membership = result.rows[0];
    if (!membership) fail("成员不存在。", 404, "not_found");
    await client.query(
      `INSERT INTO audit_log(organization_id,actor_user_id,actor_name,action,object_type,object_id,result,metadata)
       VALUES ($1,$2,$3,'identity.member.update','membership',$4,'success',$5)`,
      [auth.organization.id, auth.user.id, auth.user.displayName, membershipId, input],
    );
    return { membership: { id: membership.id, role: membership.role, status: membership.status, mfaRequired: membership.mfa_required } };
  });
  if (input.status === "disabled") await withSystem((client) => client.query("UPDATE collaboration_sessions SET revoked_at=now() WHERE membership_id=$1 AND revoked_at IS NULL", [membershipId]));
  return output;
}

export async function listOwnSessions(auth) {
  return withSystem(async (client) => {
    const result = await client.query(
      `SELECT id,ip_address,user_agent,mfa_verified_at,last_seen_at,expires_at,created_at
         FROM collaboration_sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now() ORDER BY last_seen_at DESC`,
      [auth.user.id],
    );
    return { sessions: result.rows.map((row) => ({ id: row.id, current: row.id === auth.sessionId, ipAddress: row.ip_address || "", userAgent: row.user_agent || "", mfaVerifiedAt: row.mfa_verified_at ? new Date(row.mfa_verified_at).toISOString() : "", lastSeenAt: new Date(row.last_seen_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString(), createdAt: new Date(row.created_at).toISOString() })) };
  });
}

export async function revokeOwnSession(auth, sessionId) {
  return withSystem(async (client) => {
    const result = await client.query("UPDATE collaboration_sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id", [sessionId, auth.user.id]);
    if (!result.rows[0]) fail("会话不存在。", 404, "not_found");
    return { revoked: true, current: sessionId === auth.sessionId };
  });
}

export async function provisionOrganization(body) {
  const input = organizationSchema.parse(body);
  return withSystem(async (client) => {
    const result = await client.query(
      `INSERT INTO organizations(code,name,organization_type,status,metadata)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT(code) DO UPDATE SET name=excluded.name,organization_type=excluded.organization_type,status=excluded.status,metadata=excluded.metadata
       RETURNING id,code,name,organization_type,status,metadata,created_at,updated_at`,
      [input.code, input.name, input.organizationType, input.status, { notificationEmail: input.notificationEmail || "", wecomWebhook: input.wecomWebhook || "" }],
    );
    const organization = result.rows[0];
    return { organization: { id: organization.id, code: organization.code, name: organization.name, organizationType: organization.organization_type, status: organization.status, metadata: organization.metadata, createdAt: new Date(organization.created_at).toISOString(), updatedAt: new Date(organization.updated_at).toISOString() } };
  });
}
