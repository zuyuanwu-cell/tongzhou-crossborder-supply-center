import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { JIANYUN_FORMS } from "./field-mapping.js";

function valueOf(record, fieldId) {
  if (!fieldId) return undefined;
  const field = record?.[fieldId];
  if (field && typeof field === "object" && "value" in field) return field.value;
  return field;
}

function text(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean).join(",");
  if (typeof value === "object") return text(value.name || value.value || value.title, fallback);
  return String(value).trim() || fallback;
}

function base64Url(input) {
  return Buffer.from(input).toString("base64url");
}

function signPayload(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const hash = pbkdf2Sync(String(password), salt, 210000, 32, "sha256").toString("base64url");
  return `pbkdf2_sha256$210000$${salt}$${hash}`;
}

export function verifyPassword(password, encoded) {
  const [algorithm, iterations, salt, hash] = String(encoded || "").split("$");
  if (algorithm !== "pbkdf2_sha256" || !iterations || !salt || !hash) return false;
  const candidate = pbkdf2Sync(String(password), salt, Number(iterations), 32, "sha256").toString("base64url");
  return safeEqual(candidate, hash);
}

export function normalizeRole(value) {
  const role = text(value).toLowerCase();
  if (/admin|管理员|直营|内部|direct|owner/.test(role)) return "direct";
  if (/分销|经销|代理|distribution|distributor|dealer/.test(role)) return "distributor";
  return "guest";
}

export function roleLabel(role) {
  if (role === "direct") return "直营部门";
  if (role === "distributor") return "分销商";
  return "游客";
}

export function normalizeUserAccount(record) {
  const fields = JIANYUN_FORMS.userAccounts.fields;
  const username = text(valueOf(record, fields.username));
  const role = normalizeRole(valueOf(record, fields.role));
  const statusText = text(valueOf(record, fields.status), "active");
  return {
    id: record.data_id || record._id || record.id || text(valueOf(record, fields.serialNo)) || username,
    username,
    password: text(valueOf(record, fields.password)),
    displayName: text(valueOf(record, fields.displayName), username),
    role,
    roleLabel: roleLabel(role),
    status: normalizeUserStatus(statusText),
  };
}

export function normalizeUserStatus(value) {
  const status = text(value).toLowerCase();
  if (/停用|禁用|disabled|inactive|off|0|false/.test(status)) return "disabled";
  return "active";
}

export function userStatusLabel(status) {
  return status === "disabled" ? "停用" : "启用";
}

export function authenticateLocalUser(users, username, password) {
  const normalizedUsername = text(username).toLowerCase();
  if (!normalizedUsername || !password) return null;

  const user = users.find((item) => String(item.username || "").toLowerCase() === normalizedUsername && item.status !== "disabled");
  if (!user || !verifyPassword(password, user.passwordHash)) return null;
  return publicUser(user);
}

export function createLocalUser({ username, password, displayName, role }) {
  const safeUsername = text(username);
  const safeDisplayName = text(displayName, safeUsername);
  const safeRole = normalizeRole(role);
  if (!safeUsername) throw new Error("账号不能为空。");
  if (String(password || "").length < 4) throw new Error("密码至少需要 4 位。");
  if (safeRole === "guest") throw new Error("请选择有效角色。");
  return {
    id: `user-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`,
    username: safeUsername,
    displayName: safeDisplayName,
    role: safeRole,
    roleLabel: roleLabel(safeRole),
    passwordHash: hashPassword(password),
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    jdySyncedAt: "",
    jdyDataId: "",
    jdySyncError: "",
  };
}

export function publicUser(user) {
  if (!user) return { role: "guest", roleLabel: "游客", permissions: ["product_view"] };
  const role = normalizeRole(user.role);
  const permissions = role === "direct"
    ? ["product_view", "distribution_price", "sales_price", "direct_price", "inventory", "assets", "qualifications", "operations", "users"]
    : ["product_view", "distribution_price", "sales_price", "assets", "qualifications"];
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    role,
    roleLabel: roleLabel(role),
    status: user.status === "disabled" ? "disabled" : "active",
    statusLabel: userStatusLabel(user.status),
    permissions,
    jdySyncedAt: user.jdySyncedAt || "",
    jdySyncError: user.jdySyncError || "",
  };
}

export function createSessionToken(user, secret, ttlMs = 7 * 24 * 60 * 60 * 1000) {
  const safeUser = publicUser(user);
  const payload = base64Url(JSON.stringify({
    id: safeUser.id,
    username: safeUser.username,
    displayName: safeUser.displayName,
    role: safeUser.role,
    exp: Date.now() + ttlMs,
  }));
  return `${payload}.${signPayload(payload, secret)}`;
}

export function verifySessionToken(token, secret) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return null;
  if (!safeEqual(signature, signPayload(payload, secret))) return null;
  try {
    const user = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!user.exp || user.exp < Date.now()) return null;
    return publicUser(user);
  } catch {
    return null;
  }
}

export function jdyUserRecordData(user, plainPassword) {
  const fields = JIANYUN_FORMS.userAccounts.fields;
  return {
    [fields.serialNo]: { value: user.id },
    [fields.username]: { value: user.username },
    [fields.password]: { value: plainPassword },
    [fields.displayName]: { value: user.displayName || user.username },
    [fields.role]: { value: roleLabel(user.role) },
    ...(fields.status ? { [fields.status]: { value: userStatusLabel(user.status) } } : {}),
  };
}

export function jdyUserStatusData(user) {
  const fields = JIANYUN_FORMS.userAccounts.fields;
  if (!fields.status) return {};
  return {
    [fields.status]: { value: userStatusLabel(user.status) },
  };
}
