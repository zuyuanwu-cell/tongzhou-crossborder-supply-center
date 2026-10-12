import { randomBytes } from "node:crypto";
import { PERMISSION_CATALOG, ROLE_DEFAULT_PERMISSIONS, sanitizePermissionUpdate } from "./access-control.js";

export const BUILTIN_ROLE_IDS = Object.freeze({
  admin: "role-admin",
  direct: "role-direct",
  warehouse: "role-warehouse",
  distributor: "role-distributor",
});

export const USER_ROLE_TYPES = Object.freeze(["admin", "direct", "warehouse", "distributor"]);
export const CUSTOM_ROLE_TYPES = Object.freeze(["direct", "warehouse", "distributor"]);

const ROLE_TYPE_LABELS = Object.freeze({
  admin: "系统管理员",
  direct: "内部员工",
  warehouse: "仓库协作方",
  distributor: "分销合作方",
});

const DEFAULT_ROLE_META = Object.freeze({
  admin: Object.freeze({ name: "管理员", description: "系统受保护角色，拥有全部管理能力。" }),
  direct: Object.freeze({ name: "直营运营", description: "内部运营基础角色，可按岗位复制并调整。" }),
  warehouse: Object.freeze({ name: "仓库操作员", description: "按绑定仓库处理入出库、售后和协同任务。" }),
  distributor: Object.freeze({ name: "分销商", description: "面向外部分销合作方的基础资料查看角色。" }),
});

function text(value, maxLength = 0) {
  const result = String(value ?? "").trim();
  return maxLength > 0 ? result.slice(0, maxLength) : result;
}

function timestamp(value) {
  const candidate = text(value);
  return candidate && !Number.isNaN(Date.parse(candidate)) ? new Date(candidate).toISOString() : new Date().toISOString();
}

function roleError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

export function normalizeUserRoleType(value) {
  const role = text(value).toLowerCase();
  if (role === "admin") return "admin";
  if (role === "warehouse") return "warehouse";
  if (role === "distributor") return "distributor";
  return "direct";
}

export function userRoleTypeLabel(value) {
  return ROLE_TYPE_LABELS[normalizeUserRoleType(value)];
}

function uniquePermissions(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => text(value)).filter(Boolean)));
}

export function sanitizeRolePermissions(type, permissions) {
  const safeType = normalizeUserRoleType(type);
  if (safeType === "admin") return PERMISSION_CATALOG.map((permission) => permission.key);
  return sanitizePermissionUpdate(safeType, { allow: uniquePermissions(permissions), deny: [] }).allow;
}

function defaultRole(type, now) {
  const safeType = normalizeUserRoleType(type);
  const meta = DEFAULT_ROLE_META[safeType];
  return {
    id: BUILTIN_ROLE_IDS[safeType],
    name: meta.name,
    description: meta.description,
    type: safeType,
    typeLabel: ROLE_TYPE_LABELS[safeType],
    permissions: sanitizeRolePermissions(safeType, ROLE_DEFAULT_PERMISSIONS[safeType]),
    status: "active",
    system: safeType === "admin",
    builtin: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function createDefaultRoles(now = new Date().toISOString()) {
  const safeNow = timestamp(now);
  return USER_ROLE_TYPES.map((type) => defaultRole(type, safeNow));
}

function normalizedRoleId(value, type) {
  const candidate = text(value, 96);
  return candidate || BUILTIN_ROLE_IDS[normalizeUserRoleType(type)] || `role-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

function normalizeRole(role, fallbackNow) {
  if (!role || typeof role !== "object") return null;
  const type = normalizeUserRoleType(role.type || role.role);
  const id = normalizedRoleId(role.id, type);
  const system = id === BUILTIN_ROLE_IDS.admin || role.system === true;
  const meta = DEFAULT_ROLE_META[type];
  const createdAt = timestamp(role.createdAt || fallbackNow);
  const updatedAt = timestamp(role.updatedAt || createdAt);
  return {
    id,
    name: text(role.name, 80) || meta.name,
    description: text(role.description, 240),
    type: system ? "admin" : type,
    typeLabel: ROLE_TYPE_LABELS[system ? "admin" : type],
    permissions: sanitizeRolePermissions(system ? "admin" : type, role.permissions),
    status: system || role.status !== "disabled" ? "active" : "disabled",
    system,
    builtin: role.builtin === true || Object.values(BUILTIN_ROLE_IDS).includes(id),
    createdAt,
    updatedAt,
  };
}

function distinctRoles(roles) {
  const ids = new Set();
  const names = new Set();
  const result = [];
  for (const role of roles) {
    if (!role || ids.has(role.id)) continue;
    const normalizedName = role.name.toLocaleLowerCase("zh-CN");
    if (names.has(normalizedName)) continue;
    ids.add(role.id);
    names.add(normalizedName);
    result.push(role);
  }
  return result;
}

export function normalizeUserRoles(value, users = [], now = new Date().toISOString()) {
  const safeNow = timestamp(now);
  const hasStoredRoles = Array.isArray(value);
  let roles = hasStoredRoles
    ? value.map((role) => normalizeRole(role, safeNow)).filter(Boolean)
    : createDefaultRoles(safeNow);
  roles = distinctRoles(roles);

  if (!roles.some((role) => role.id === BUILTIN_ROLE_IDS.admin)) {
    roles.unshift(defaultRole("admin", safeNow));
  }

  const legacyTypes = new Set((Array.isArray(users) ? users : [])
    .filter((user) => !text(user?.roleId))
    .map((user) => normalizeUserRoleType(user?.role)));
  for (const type of legacyTypes) {
    if (!roles.some((role) => role.id === BUILTIN_ROLE_IDS[type])) roles.push(defaultRole(type, safeNow));
  }
  return distinctRoles(roles);
}

export function resolveUserRole(user, roles = []) {
  const list = Array.isArray(roles) ? roles : [];
  const roleId = text(user?.roleId);
  if (roleId) {
    const assigned = list.find((role) => role.id === roleId);
    if (assigned) return assigned;
  }
  const legacyType = normalizeUserRoleType(user?.role);
  return list.find((role) => role.id === BUILTIN_ROLE_IDS[legacyType])
    || list.find((role) => role.type === legacyType && role.status !== "disabled")
    || null;
}

export function migrateUserRoleAssignment(user, roles = []) {
  if (!user || typeof user !== "object") return user;
  const assignedRole = resolveUserRole(user, roles);
  if (!assignedRole) return { ...user, role: normalizeUserRoleType(user.role) };
  return { ...user, roleId: assignedRole.id, role: assignedRole.type, roleLabel: assignedRole.name };
}

function assertUniqueRoleName(roles, name, ignoredId = "") {
  const normalizedName = text(name, 80).toLocaleLowerCase("zh-CN");
  if (!normalizedName) throw roleError("角色名称不能为空。");
  if ((Array.isArray(roles) ? roles : []).some((role) => role.id !== ignoredId && text(role.name, 80).toLocaleLowerCase("zh-CN") === normalizedName)) {
    throw roleError("角色名称已存在，请换一个名称。", 409);
  }
}

function nextRoleId() {
  return `role-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

export function createUserRole(roles, input = {}, options = {}) {
  const type = normalizeUserRoleType(input.type);
  if (!CUSTOM_ROLE_TYPES.includes(type)) throw roleError("不能新建管理员安全类型，请使用受保护的系统管理员角色。");
  const name = text(input.name, 80);
  assertUniqueRoleName(roles, name);
  const now = timestamp(options.now);
  return {
    id: text(options.id, 96) || nextRoleId(),
    name,
    description: text(input.description, 240),
    type,
    typeLabel: ROLE_TYPE_LABELS[type],
    permissions: sanitizeRolePermissions(type, input.permissions),
    status: input.status === "disabled" ? "disabled" : "active",
    system: false,
    builtin: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateUserRole(roles, roleId, input = {}, options = {}) {
  const current = (Array.isArray(roles) ? roles : []).find((role) => role.id === roleId);
  if (!current) throw roleError("角色不存在。", 404);
  const name = Object.prototype.hasOwnProperty.call(input, "name") ? text(input.name, 80) : current.name;
  assertUniqueRoleName(roles, name, current.id);
  if (!current.system && input.type && normalizeUserRoleType(input.type) !== current.type) {
    throw roleError("角色创建后不能修改安全类型，请新建角色并迁移用户。");
  }
  const now = timestamp(options.now);
  return {
    ...current,
    name,
    description: Object.prototype.hasOwnProperty.call(input, "description") ? text(input.description, 240) : current.description,
    permissions: current.system
      ? sanitizeRolePermissions("admin", current.permissions)
      : Object.prototype.hasOwnProperty.call(input, "permissions")
        ? sanitizeRolePermissions(current.type, input.permissions)
        : current.permissions,
    status: current.system ? "active" : input.status === "disabled" ? "disabled" : input.status === "active" ? "active" : current.status,
    typeLabel: ROLE_TYPE_LABELS[current.type],
    updatedAt: now,
  };
}

export function replaceUserRole(roles, updatedRole) {
  return (Array.isArray(roles) ? roles : []).map((role) => role.id === updatedRole.id ? updatedRole : role);
}

export function deleteUserRole(roles, roleId, users = []) {
  const current = (Array.isArray(roles) ? roles : []).find((role) => role.id === roleId);
  if (!current) throw roleError("角色不存在。", 404);
  if (current.system) throw roleError("系统角色不能删除。");
  const memberCount = (Array.isArray(users) ? users : []).filter((user) => user.roleId === roleId).length;
  if (memberCount) throw roleError(`该角色仍有 ${memberCount} 个用户，请先调整用户角色。`, 409);
  return roles.filter((role) => role.id !== roleId);
}

export function projectUserRoles(roles = [], users = []) {
  const memberCounts = new Map();
  for (const user of Array.isArray(users) ? users : []) {
    const role = resolveUserRole(user, roles);
    if (role) memberCounts.set(role.id, (memberCounts.get(role.id) || 0) + 1);
  }
  return (Array.isArray(roles) ? roles : []).map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    type: role.type,
    typeLabel: ROLE_TYPE_LABELS[role.type],
    permissions: [...role.permissions],
    status: role.status,
    system: role.system,
    builtin: role.builtin,
    memberCount: memberCounts.get(role.id) || 0,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  }));
}
