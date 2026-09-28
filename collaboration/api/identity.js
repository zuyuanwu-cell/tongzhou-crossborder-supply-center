import { z } from "zod";
import { collaborationConfig } from "./config.js";
import { withOrganization, withSystem } from "./db.js";
import { sendSecurityEmail } from "./notifications.js";
import { hashPassword, randomToken, tokenHash, validateNewPassword, verifyPassword } from "./security.js";

const roles = ["organization_admin", "manager", "operator", "finance", "viewer"];
const organizationTypes = ["internal", "warehouse", "filing_service", "sampling_factory", "packaging_factory", "production_factory"];
const resetAttempts = new Map();
const usernameSchema = z.string().trim().min(3).max(80).regex(/^[A-Za-z0-9._-]+$/);
const optionalEmailSchema = z.union([z.string().trim().email().max(320), z.literal("")]).optional().default("");

const invitationSchema = z.object({
  username: usernameSchema,
  email: optionalEmailSchema,
  role: z.enum(roles),
  mfaRequired: z.boolean().optional().default(false),
}).strict();

const accountProvisionSchema = z.object({
  username: usernameSchema,
  displayName: z.string().trim().min(1).max(120).optional(),
  email: optionalEmailSchema,
  password: z.string(),
  role: z.enum(roles),
  mfaRequired: z.boolean().optional().default(false),
}).strict();

const acceptInvitationSchema = z.object({
  token: z.string().min(32).max(512),
  displayName: z.string().trim().min(1).max(120),
  password: z.string(),
}).strict();

const resetRequestSchema = z.object({
  username: z.string().trim().min(1).max(80),
}).strict();

const resetConfirmSchema = z.object({ token: z.string().min(32).max(512), password: z.string() }).strict();

const memberUpdateSchema = z.object({
  role: z.enum(roles).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  mfaRequired: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "请至少提供一个修改字段。");

const ownProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  email: optionalEmailSchema,
  currentPassword: z.string().min(1).max(512),
}).strict();

const ownPasswordSchema = z.object({
  currentPassword: z.string().min(1).max(512),
  newPassword: z.string(),
}).strict();

const organizationSchema = z.object({
  code: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/),
  name: z.string().trim().min(1).max(200),
  organizationType: z.enum(organizationTypes),
  status: z.enum(["active", "suspended", "archived"]).optional().default("active"),
  notificationEmail: z.string().trim().email().max(320).optional().or(z.literal("")),
  wecomWebhook: z.string().trim().url().max(2_000).optional().or(z.literal("")),
}).strict();

const organizationBootstrapSchema = organizationSchema.omit({ code: true }).extend({
  administrator: accountProvisionSchema.pick({ username: true, displayName: true, email: true, password: true }),
  actorName: z.string().trim().min(1).max(120).optional().default("供应链中台管理员"),
}).strict();

const organizationStatusSchema = z.object({
  status: z.enum(["active", "suspended", "archived"]),
  actorName: z.string().trim().min(1).max(120).optional().default("供应链中台管理员"),
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

const organizationCodePrefixes = {
  internal: "in",
  warehouse: "wh",
  filing_service: "fs",
  sampling_factory: "sf",
  packaging_factory: "pf",
  production_factory: "mf",
};

export function generateOrganizationCode(organizationType, entropy = randomToken(6)) {
  const prefix = organizationCodePrefixes[organizationType] || "org";
  const suffix = String(entropy).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 10);
  if (suffix.length < 6) return `${prefix}-${randomToken(6).toLowerCase()}`;
  return `${prefix}-${suffix}`;
}

function publicMember(row) {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    email: row.email || "",
    displayName: row.display_name,
    userStatus: row.user_status,
    role: row.role,
    status: row.status,
    permissions: row.permissions || [],
    mfaRequired: false,
    mfaEnabled: false,
    mustChangePassword: false,
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : "",
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function rateLimitReset(req, input) {
  const key = `${clientIp(req)}:${input.username.toLowerCase()}`;
  const now = Date.now();
  const existing = resetAttempts.get(key);
  const entry = !existing || now - existing.startedAt > 15 * 60_000 ? { count: 0, startedAt: now } : existing;
  if (entry.count >= 5) fail("密码重置请求过于频繁，请稍后再试。", 429, "reset_rate_limited");
  resetAttempts.set(key, { ...entry, count: entry.count + 1 });
}

function developmentSecret(value) {
  return collaborationConfig.production ? {} : { developmentToken: value };
}

function publicInvitation(row) {
  const acceptedAt = row.accepted_at ? new Date(row.accepted_at).toISOString() : "";
  const expiresAt = new Date(row.expires_at).toISOString();
  const status = acceptedAt ? "accepted" : new Date(row.expires_at).getTime() <= Date.now() ? "expired" : "pending";
  return {
    id: row.id,
    username: row.username,
    email: row.email || "",
    role: row.role,
    mfaRequired: false,
    status,
    expiresAt,
    acceptedAt,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

async function deliverInvitation({ rawToken, email, organizationName, inviterName }) {
  const activationUrl = `${collaborationConfig.publicOrigin}/?invite=${encodeURIComponent(rawToken)}`;
  let delivery;
  try {
    delivery = await sendSecurityEmail({
      to: email,
      subject: `同舟协同门户邀请 · ${organizationName}`,
      text: `${inviterName} 邀请你加入 ${organizationName}。请在 48 小时内打开以下链接完成激活：\n${activationUrl}`,
    });
  } catch (error) {
    delivery = { sent: false, reason: "delivery_failed", message: String(error.message || error).slice(0, 300) };
  }
  return { activationUrl, delivery };
}

export async function createInvitation(auth, body) {
  assertOrganizationAdmin(auth);
  const input = invitationSchema.parse(body);
  const rawToken = randomToken();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60_000);
  const invitation = await withOrganization(auth.organization.id, async (client) => {
    const existing = await client.query("SELECT id FROM collaboration_users WHERE lower(username)=lower($1) OR ($2<>'' AND lower(email)=lower($2))", [input.username, input.email]);
    if (existing.rows[0]) fail("账号或邮箱已存在。", 409, "identity_exists");
    await client.query("UPDATE collaboration_invitations SET expires_at=now() WHERE organization_id=$1 AND lower(username)=lower($2) AND accepted_at IS NULL", [auth.organization.id, input.username]);
    const result = await client.query(
      `INSERT INTO collaboration_invitations(organization_id,email,username,role,mfa_required,token_hash,expires_at,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,username,email,role,mfa_required,expires_at,accepted_at,created_at`,
      [auth.organization.id, input.email, input.username, input.role, false, tokenHash(rawToken), expiresAt, auth.user.id],
    );
    await client.query(
      `INSERT INTO audit_log(organization_id,actor_user_id,actor_name,action,object_type,object_id,result,metadata)
       VALUES ($1,$2,$3,'identity.invite','invitation',$4,'created',$5)`,
      [auth.organization.id, auth.user.id, auth.user.displayName, result.rows[0].id, { username: input.username, role: input.role, mfaRequired: false }],
    );
    return result.rows[0];
  });
  const { activationUrl, delivery } = await deliverInvitation({ rawToken, email: input.email, organizationName: auth.organization.name, inviterName: auth.user.displayName });
  return { invitation: publicInvitation(invitation), delivery, ...(!delivery.sent ? { activationUrl } : {}), ...developmentSecret(rawToken) };
}

export async function listInvitations(auth) {
  assertOrganizationAdmin(auth);
  return withOrganization(auth.organization.id, async (client) => {
    const result = await client.query(
      `SELECT id,username,email,role,mfa_required,expires_at,accepted_at,created_at
         FROM collaboration_invitations
        WHERE organization_id=$1
        ORDER BY created_at DESC LIMIT 100`,
      [auth.organization.id],
    );
    return { invitations: result.rows.map(publicInvitation) };
  });
}

export async function createMember(auth, body) {
  assertOrganizationAdmin(auth);
  const input = accountProvisionSchema.parse(body);
  const passwordHash = await hashPassword(validateNewPassword(input.password));
  return withSystem(async (client) => {
    const duplicate = await client.query(
      `SELECT 1 FROM collaboration_users WHERE lower(username)=lower($1) OR ($2<>'' AND lower(email)=lower($2))
       UNION ALL
       SELECT 1 FROM collaboration_invitations WHERE accepted_at IS NULL AND expires_at>now()
        AND (lower(username)=lower($1) OR ($2<>'' AND lower(email)=lower($2))) LIMIT 1`,
      [input.username, input.email],
    );
    if (duplicate.rows[0]) fail("账号或邮箱已被使用。", 409, "identity_exists");
    const userResult = await client.query(
      `INSERT INTO collaboration_users(username,email,display_name,password_hash,status,must_change_password)
       VALUES ($1,$2,$3,$4,'active',false)
       RETURNING id,username,email,display_name,status AS user_status,must_change_password,totp_enabled_at,last_login_at,created_at`,
      [input.username, input.email || null, input.displayName || input.username, passwordHash],
    );
    const user = userResult.rows[0];
    const mfaRequired = false;
    const membershipResult = await client.query(
      `INSERT INTO organization_memberships(organization_id,user_id,role,status,mfa_required)
       VALUES ($1,$2,$3,'active',$4)
       RETURNING id,role,status,permissions,mfa_required,created_at`,
      [auth.organization.id, user.id, input.role, mfaRequired],
    );
    const membership = membershipResult.rows[0];
    await client.query(
      `INSERT INTO audit_log(organization_id,actor_user_id,actor_name,action,object_type,object_id,result,metadata)
       VALUES ($1,$2,$3,'identity.member.create','membership',$4,'created',$5)`,
      [auth.organization.id, auth.user.id, auth.user.displayName, membership.id, { username: input.username, role: input.role, mfaRequired }],
    );
    return { member: publicMember({ ...user, ...membership, user_id: user.id }) };
  });
}

export async function revokeInvitation(auth, invitationId) {
  assertOrganizationAdmin(auth);
  return withOrganization(auth.organization.id, async (client) => {
    const result = await client.query(
      `UPDATE collaboration_invitations SET expires_at=now()
        WHERE id=$1 AND organization_id=$2 AND accepted_at IS NULL
        RETURNING id,username,email,role,mfa_required,expires_at,accepted_at,created_at`,
      [invitationId, auth.organization.id],
    );
    if (!result.rows[0]) fail("邀请不存在、已激活或已撤销。", 404, "invitation_not_found");
    await client.query(
      `INSERT INTO audit_log(organization_id,actor_user_id,actor_name,action,object_type,object_id,result,metadata)
       VALUES ($1,$2,$3,'identity.invite.revoke','invitation',$4,'success',$5)`,
      [auth.organization.id, auth.user.id, auth.user.displayName, invitationId, { username: result.rows[0].username }],
    );
    return { invitation: publicInvitation(result.rows[0]) };
  });
}

export async function reissueInvitation(auth, invitationId) {
  assertOrganizationAdmin(auth);
  const rawToken = randomToken();
  const invitation = await withOrganization(auth.organization.id, async (client) => {
    const result = await client.query(
      `UPDATE collaboration_invitations
          SET token_hash=$3,expires_at=now()+interval '48 hours'
        WHERE id=$1 AND organization_id=$2 AND accepted_at IS NULL
        RETURNING id,username,email,role,mfa_required,expires_at,accepted_at,created_at`,
      [invitationId, auth.organization.id, tokenHash(rawToken)],
    );
    if (!result.rows[0]) fail("邀请不存在或已经激活。", 404, "invitation_not_found");
    await client.query(
      `INSERT INTO audit_log(organization_id,actor_user_id,actor_name,action,object_type,object_id,result,metadata)
       VALUES ($1,$2,$3,'identity.invite.reissue','invitation',$4,'success',$5)`,
      [auth.organization.id, auth.user.id, auth.user.displayName, invitationId, { username: result.rows[0].username }],
    );
    return result.rows[0];
  });
  const { activationUrl, delivery } = await deliverInvitation({ rawToken, email: invitation.email, organizationName: auth.organization.name, inviterName: auth.user.displayName });
  return { invitation: publicInvitation(invitation), delivery, ...(!delivery.sent ? { activationUrl } : {}), ...developmentSecret(rawToken) };
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
    const mfaRequired = false;
    await client.query(
      `INSERT INTO organization_memberships(organization_id,user_id,role,status,mfa_required)
       VALUES ($1,$2,$3,'active',$4)`,
      [invitation.organization_id, user.id, invitation.role, mfaRequired],
    );
    await client.query("UPDATE collaboration_invitations SET accepted_at=now() WHERE id=$1", [invitation.id]);
    await client.query(
      `INSERT INTO audit_log(organization_id,actor_user_id,actor_name,action,object_type,object_id,result,metadata)
       VALUES ($1,$2,$3,'identity.invite.accept','user',$5,'success',$4)`,
      [invitation.organization_id, user.id, user.display_name, { username: user.username, role: invitation.role }, user.id],
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
        WHERE lower(u.username)=lower($1) AND u.status='active' AND m.status='active' AND o.status='active'`,
      [input.username],
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
    await client.query("UPDATE collaboration_users SET password_hash=$2,password_changed_at=now(),must_change_password=false,failed_login_count=0,locked_until=NULL,status='active' WHERE id=$1", [reset.user_id, passwordHash]);
    await client.query("UPDATE collaboration_password_resets SET used_at=now() WHERE user_id=$1 AND used_at IS NULL", [reset.user_id]);
    await client.query("UPDATE collaboration_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [reset.user_id]);
    return { changed: true };
  });
}

export async function listMembers(auth) {
  assertOrganizationAdmin(auth);
  return withOrganization(auth.organization.id, async (client) => {
    const result = await client.query(
      `SELECT m.id,m.role,m.status,m.permissions,m.mfa_required,m.created_at,u.id AS user_id,u.username,u.email,u.display_name,u.status AS user_status,u.totp_enabled_at,u.must_change_password,u.last_login_at
         FROM organization_memberships m JOIN collaboration_users u ON u.id=m.user_id
        WHERE m.organization_id=$1 ORDER BY u.display_name,u.username`,
      [auth.organization.id],
    );
    return { members: result.rows.map(publicMember) };
  });
}

export async function updateMember(auth, membershipId, body) {
  assertOrganizationAdmin(auth);
  const input = memberUpdateSchema.parse(body);
  if (membershipId === auth.membership.id && (input.status === "disabled" || (input.role && input.role !== "organization_admin"))) fail("不能停用或降级当前登录管理员。", 409, "cannot_modify_self");
  const output = await withOrganization(auth.organization.id, async (client) => {
    const result = await client.query(
      `UPDATE organization_memberships SET role=COALESCE($3,role),status=COALESCE($4,status),mfa_required=false
        WHERE id=$1 AND organization_id=$2 RETURNING *`,
      [membershipId, auth.organization.id, input.role || null, input.status || null],
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

export async function updateOwnProfile(auth, body) {
  const input = ownProfileSchema.parse(body);
  return withSystem(async (client) => {
    const currentResult = await client.query("SELECT password_hash,email,display_name FROM collaboration_users WHERE id=$1 FOR UPDATE", [auth.user.id]);
    const current = currentResult.rows[0];
    if (!current || !(await verifyPassword(current.password_hash, input.currentPassword))) fail("当前密码不正确。", 401, "invalid_current_password");
    if (input.email) {
      const duplicate = await client.query("SELECT 1 FROM collaboration_users WHERE id<>$1 AND lower(email)=lower($2) LIMIT 1", [auth.user.id, input.email]);
      if (duplicate.rows[0]) fail("该邮箱已被其他账号使用。", 409, "email_exists");
    }
    const result = await client.query(
      `UPDATE collaboration_users SET display_name=$2,email=$3,updated_at=now()
        WHERE id=$1 RETURNING id,username,email,display_name`,
      [auth.user.id, input.displayName, input.email || null],
    );
    await client.query("UPDATE collaboration_password_resets SET used_at=now() WHERE user_id=$1 AND used_at IS NULL", [auth.user.id]);
    await client.query(
      `INSERT INTO audit_log(organization_id,actor_user_id,actor_name,action,object_type,object_id,result,metadata)
       VALUES ($1,$2,$3,'identity.profile.update','user',$5,'success',$4)`,
      [auth.organization.id, auth.user.id, auth.user.displayName, { emailChanged: (current.email || "") !== input.email, displayNameChanged: current.display_name !== input.displayName }, auth.user.id],
    );
    const user = result.rows[0];
    return { user: { id: user.id, username: user.username, displayName: user.display_name, email: user.email || "" } };
  });
}

export async function changeOwnPassword(auth, body) {
  const input = ownPasswordSchema.parse(body);
  const newPassword = validateNewPassword(input.newPassword);
  return withSystem(async (client) => {
    const currentResult = await client.query("SELECT password_hash FROM collaboration_users WHERE id=$1 FOR UPDATE", [auth.user.id]);
    const current = currentResult.rows[0];
    if (!current || !(await verifyPassword(current.password_hash, input.currentPassword))) fail("当前密码不正确。", 401, "invalid_current_password");
    if (await verifyPassword(current.password_hash, newPassword)) fail("新密码不能与当前密码相同。", 400, "password_unchanged");
    const passwordHash = await hashPassword(newPassword);
    await client.query(
      "UPDATE collaboration_users SET password_hash=$2,password_changed_at=now(),must_change_password=false,failed_login_count=0,locked_until=NULL,updated_at=now() WHERE id=$1",
      [auth.user.id, passwordHash],
    );
    await client.query("UPDATE collaboration_password_resets SET used_at=now() WHERE user_id=$1 AND used_at IS NULL", [auth.user.id]);
    await client.query("UPDATE collaboration_sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL", [auth.user.id, auth.sessionId]);
    await client.query(
      `INSERT INTO audit_log(organization_id,actor_user_id,actor_name,action,object_type,object_id,result,metadata)
       VALUES ($1,$2,$3,'identity.password.change','user',$4,'success','{}'::jsonb)`,
      [auth.organization.id, auth.user.id, auth.user.displayName, auth.user.id],
    );
    return { changed: true, mustChangePassword: false };
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

export async function listOrganizations({ keyword = "", status = "" } = {}) {
  const normalizedKeyword = String(keyword || "").trim().slice(0, 100);
  const normalizedStatus = ["active", "suspended", "archived"].includes(status) ? status : "";
  return withSystem(async (client) => {
    const result = await client.query(
      `SELECT o.id,o.code,o.name,o.organization_type,o.status,o.metadata,o.created_at,o.updated_at,
              count(DISTINCT m.id)::int AS member_count,
              count(DISTINCT m.id) FILTER (WHERE m.status='active')::int AS active_member_count,
              count(DISTINCT m.id) FILTER (WHERE m.status='active' AND m.role='organization_admin')::int AS administrator_count,
              count(DISTINCT i.id) FILTER (WHERE i.accepted_at IS NULL AND i.expires_at>now())::int AS pending_invitation_count,
              max(u.last_login_at) AS last_login_at
         FROM organizations o
         LEFT JOIN organization_memberships m ON m.organization_id=o.id
         LEFT JOIN collaboration_users u ON u.id=m.user_id
         LEFT JOIN collaboration_invitations i ON i.organization_id=o.id
        WHERE ($1='' OR o.code ILIKE '%'||$1||'%' OR o.name ILIKE '%'||$1||'%')
          AND ($2='' OR o.status=$2)
        GROUP BY o.id
        ORDER BY CASE o.status WHEN 'active' THEN 0 WHEN 'suspended' THEN 1 ELSE 2 END,o.updated_at DESC,o.name`,
      [normalizedKeyword, normalizedStatus],
    );
    return {
      organizations: result.rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        organizationType: row.organization_type,
        status: row.status,
        metadata: row.metadata || {},
        memberCount: row.member_count,
        activeMemberCount: row.active_member_count,
        administratorCount: row.administrator_count,
        pendingInvitationCount: row.pending_invitation_count,
        lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : "",
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      })),
    };
  });
}

export async function getOrganizationAccess(code) {
  const normalizedCode = String(code || "").trim().toLowerCase();
  return withSystem(async (client) => {
    const organizationResult = await client.query(
      `SELECT id,code,name,organization_type,status,metadata,created_at,updated_at
         FROM organizations WHERE code=$1`,
      [normalizedCode],
    );
    const organization = organizationResult.rows[0];
    if (!organization) fail("协作组织不存在。", 404, "organization_not_found");
    const [members, invitations] = await Promise.all([
      client.query(
        `SELECT m.id,m.role,m.status,m.permissions,m.mfa_required,m.created_at,u.id AS user_id,u.username,u.email,u.display_name,u.status AS user_status,u.totp_enabled_at,u.must_change_password,u.last_login_at
           FROM organization_memberships m JOIN collaboration_users u ON u.id=m.user_id
          WHERE m.organization_id=$1 ORDER BY CASE m.role WHEN 'organization_admin' THEN 0 ELSE 1 END,u.display_name,u.username`,
        [organization.id],
      ),
      client.query(
        `SELECT id,username,email,role,mfa_required,expires_at,accepted_at,created_at
           FROM collaboration_invitations WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100`,
        [organization.id],
      ),
    ]);
    return {
      organization: {
        id: organization.id,
        code: organization.code,
        name: organization.name,
        organizationType: organization.organization_type,
        status: organization.status,
        metadata: organization.metadata || {},
        createdAt: new Date(organization.created_at).toISOString(),
        updatedAt: new Date(organization.updated_at).toISOString(),
      },
      members: members.rows.map(publicMember),
      invitations: invitations.rows.map(publicInvitation),
    };
  });
}

export async function bootstrapOrganization(body) {
  const input = organizationBootstrapSchema.parse(body);
  const passwordHash = await hashPassword(validateNewPassword(input.administrator.password));
  const output = await withSystem(async (client) => {
    let organization;
    for (let attempt = 0; attempt < 5 && !organization; attempt += 1) {
      const code = generateOrganizationCode(input.organizationType);
      const organizationResult = await client.query(
        `INSERT INTO organizations(code,name,organization_type,status,metadata)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT(code) DO NOTHING
         RETURNING id,code,name,organization_type,status,metadata,created_at,updated_at`,
        [code, input.name, input.organizationType, input.status, { notificationEmail: input.notificationEmail || "", wecomWebhook: input.wecomWebhook || "" }],
      );
      organization = organizationResult.rows[0];
    }
    if (!organization) fail("组织编码生成失败，请重试。", 503, "organization_code_unavailable");
    const duplicate = await client.query(
      `SELECT 1 FROM collaboration_users WHERE lower(username)=lower($1) OR ($2<>'' AND lower(email)=lower($2))
       UNION ALL
       SELECT 1 FROM collaboration_invitations WHERE accepted_at IS NULL AND expires_at>now()
         AND (lower(username)=lower($1) OR ($2<>'' AND lower(email)=lower($2))) LIMIT 1`,
      [input.administrator.username, input.administrator.email],
    );
    if (duplicate.rows[0]) fail("管理员账号或邮箱已被使用。", 409, "identity_exists");
    const userResult = await client.query(
      `INSERT INTO collaboration_users(username,email,display_name,password_hash,status,must_change_password)
       VALUES ($1,$2,$3,$4,'active',false)
       RETURNING id,username,email,display_name,status,must_change_password,created_at`,
      [input.administrator.username, input.administrator.email || null, input.administrator.displayName || input.administrator.username, passwordHash],
    );
    const administrator = userResult.rows[0];
    const membershipResult = await client.query(
      `INSERT INTO organization_memberships(organization_id,user_id,role,status,mfa_required)
       VALUES ($1,$2,'organization_admin','active',false)
       RETURNING id,role,status,mfa_required,created_at`,
      [organization.id, administrator.id],
    );
    await client.query(
      `INSERT INTO audit_log(organization_id,actor_user_id,actor_name,action,object_type,object_id,result,metadata)
       VALUES ($1,NULL,$2,'identity.organization.bootstrap','organization',$4,'created',$3)`,
      [organization.id, input.actorName, { code: organization.code, administratorUsername: input.administrator.username }, organization.id],
    );
    return { organization, administrator, membership: membershipResult.rows[0] };
  });
  return {
    organization: {
      id: output.organization.id,
      code: output.organization.code,
      name: output.organization.name,
      organizationType: output.organization.organization_type,
      status: output.organization.status,
    },
    administrator: {
      membershipId: output.membership.id,
      userId: output.administrator.id,
      username: output.administrator.username,
      displayName: output.administrator.display_name,
      email: output.administrator.email || "",
      role: output.membership.role,
      mfaRequired: false,
      mustChangePassword: false,
    },
  };
}

export async function updateOrganizationStatus(code, body) {
  const input = organizationStatusSchema.parse(body);
  const normalizedCode = String(code || "").trim().toLowerCase();
  return withSystem(async (client) => {
    const result = await client.query(
      "UPDATE organizations SET status=$2 WHERE code=$1 RETURNING id,code,name,organization_type,status,updated_at",
      [normalizedCode, input.status],
    );
    const organization = result.rows[0];
    if (!organization) fail("协作组织不存在。", 404, "organization_not_found");
    if (input.status !== "active") {
      await client.query(
        `UPDATE collaboration_sessions SET revoked_at=now()
          WHERE revoked_at IS NULL AND membership_id IN (SELECT id FROM organization_memberships WHERE organization_id=$1)`,
        [organization.id],
      );
    }
    await client.query(
      `INSERT INTO audit_log(organization_id,actor_user_id,actor_name,action,object_type,object_id,result,metadata)
       VALUES ($1,NULL,$2,'identity.organization.status','organization',$4,'success',$3)`,
      [organization.id, input.actorName, { status: input.status }, organization.id],
    );
    return { organization: { id: organization.id, code: organization.code, name: organization.name, organizationType: organization.organization_type, status: organization.status, updatedAt: new Date(organization.updated_at).toISOString() } };
  });
}

export async function reissueInvitationInternally(invitationId, actorName = "供应链中台管理员") {
  const rawToken = randomToken();
  const invitation = await withSystem(async (client) => {
    const result = await client.query(
      `UPDATE collaboration_invitations i
          SET token_hash=$2,expires_at=now()+interval '48 hours'
         FROM organizations o
        WHERE i.id=$1 AND i.organization_id=o.id AND i.accepted_at IS NULL
        RETURNING i.id,i.organization_id,i.username,i.email,i.role,i.mfa_required,i.expires_at,i.accepted_at,i.created_at,o.name AS organization_name`,
      [invitationId, tokenHash(rawToken)],
    );
    if (!result.rows[0]) fail("邀请不存在或已经激活。", 404, "invitation_not_found");
    await client.query(
      `INSERT INTO audit_log(organization_id,actor_user_id,actor_name,action,object_type,object_id,result,metadata)
       VALUES ($1,NULL,$2,'identity.invite.reissue.internal','invitation',$3,'success',$4)`,
      [result.rows[0].organization_id, String(actorName).slice(0, 120) || "供应链中台管理员", invitationId, { username: result.rows[0].username }],
    );
    return result.rows[0];
  });
  const { activationUrl, delivery } = await deliverInvitation({ rawToken, email: invitation.email, organizationName: invitation.organization_name, inviterName: String(actorName).slice(0, 120) || "供应链中台管理员" });
  return { invitation: publicInvitation(invitation), delivery, ...(!delivery.sent ? { activationUrl } : {}), ...developmentSecret(rawToken) };
}

export async function revokeInvitationInternally(invitationId, actorName = "供应链中台管理员") {
  return withSystem(async (client) => {
    const result = await client.query(
      `UPDATE collaboration_invitations SET expires_at=now()
        WHERE id=$1 AND accepted_at IS NULL
        RETURNING id,organization_id,username,email,role,mfa_required,expires_at,accepted_at,created_at`,
      [invitationId],
    );
    if (!result.rows[0]) fail("邀请不存在、已激活或已撤销。", 404, "invitation_not_found");
    await client.query(
      `INSERT INTO audit_log(organization_id,actor_user_id,actor_name,action,object_type,object_id,result,metadata)
       VALUES ($1,NULL,$2,'identity.invite.revoke.internal','invitation',$3,'success',$4)`,
      [result.rows[0].organization_id, String(actorName).slice(0, 120) || "供应链中台管理员", invitationId, { username: result.rows[0].username }],
    );
    return { invitation: publicInvitation(result.rows[0]) };
  });
}
