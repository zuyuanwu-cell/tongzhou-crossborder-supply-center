import assert from "node:assert/strict";
import {
  BUILTIN_ROLE_IDS,
  createDefaultRoles,
  createUserRole,
  deleteUserRole,
  migrateUserRoleAssignment,
  normalizeUserRoles,
  projectUserRoles,
  resolveUserRole,
  updateUserRole,
} from "../server/user-roles.js";
import { effectivePermissions } from "../server/access-control.js";

const now = "2026-10-12T08:00:00.000Z";
const defaults = createDefaultRoles(now);
assert.deepEqual(defaults.map((role) => role.id), [
  BUILTIN_ROLE_IDS.admin,
  BUILTIN_ROLE_IDS.direct,
  BUILTIN_ROLE_IDS.warehouse,
  BUILTIN_ROLE_IDS.distributor,
]);
assert.equal(defaults.find((role) => role.id === BUILTIN_ROLE_IDS.admin)?.system, true);
assert.equal(defaults.find((role) => role.id === BUILTIN_ROLE_IDS.direct)?.permissions.includes("product_view"), true);

const migratedRoles = normalizeUserRoles(undefined, [
  { id: "legacy-direct", role: "direct" },
  { id: "legacy-warehouse", role: "warehouse" },
], now);
const migratedUser = migrateUserRoleAssignment({ id: "legacy-direct", role: "direct" }, migratedRoles);
assert.equal(migratedUser.roleId, BUILTIN_ROLE_IDS.direct);
assert.equal(resolveUserRole(migratedUser, migratedRoles)?.type, "direct");

const analystRole = createUserRole(migratedRoles, {
  name: "经营分析",
  description: "只允许查看经营报表",
  type: "direct",
  permissions: ["dashboard", "order_analysis", "performance_analysis"],
}, { id: "role-analyst", now });
assert.equal(analystRole.id, "role-analyst");
assert.deepEqual(analystRole.permissions, ["dashboard", "order_analysis", "performance_analysis"]);

assert.throws(() => createUserRole([...migratedRoles, analystRole], {
  name: " 经营分析 ",
  type: "direct",
  permissions: [],
}, { id: "role-duplicate", now }), /角色名称已存在/);

assert.throws(() => createUserRole(migratedRoles, {
  name: "另一个管理员",
  type: "admin",
  permissions: ["users"],
}, { id: "role-admin-copy", now }), /不能新建管理员安全类型/);

const warehouseRole = createUserRole(migratedRoles, {
  name: "雅加达仓收货",
  type: "warehouse",
  permissions: ["product_view", "domestic_inventory_receive", "users", "inventory_value"],
}, { id: "role-jakarta-receive", now });
assert.equal(warehouseRole.permissions.includes("domestic_inventory_receive"), true);
assert.equal(warehouseRole.permissions.includes("domestic_inventory_view"), true, "write permission should imply view permission");
assert.equal(warehouseRole.permissions.includes("users"), false, "warehouse security boundary must remove user administration");
assert.equal(warehouseRole.permissions.includes("inventory_value"), false, "warehouse security boundary must remove unrelated analytics");

const editedRole = updateUserRole([...migratedRoles, analystRole], analystRole.id, {
  name: "经营分析专员",
  permissions: ["dashboard", "performance_analysis", "performance_cost"],
}, { now: "2026-10-12T09:00:00.000Z" });
assert.equal(editedRole.name, "经营分析专员");
assert.equal(editedRole.permissions.includes("performance_cost"), true);
assert.equal(editedRole.updatedAt, "2026-10-12T09:00:00.000Z");

assert.throws(() => deleteUserRole(migratedRoles, BUILTIN_ROLE_IDS.admin, []), /系统角色不能删除/);
assert.throws(() => deleteUserRole([...migratedRoles, analystRole], analystRole.id, [{ id: "u-1", roleId: analystRole.id }]), /仍有 1 个用户/);
assert.equal(deleteUserRole([...migratedRoles, analystRole], analystRole.id, []).some((role) => role.id === analystRole.id), false);

const assignedUser = {
  id: "u-analyst",
  role: "direct",
  roleId: analystRole.id,
  rolePermissions: analystRole.permissions,
  permissionOverrides: { allow: ["movement"], deny: ["order_analysis"] },
};
const assignedPermissions = effectivePermissions(assignedUser);
assert.equal(assignedPermissions.includes("dashboard"), true);
assert.equal(assignedPermissions.includes("movement"), true);
assert.equal(assignedPermissions.includes("order_analysis"), false, "personal deny must override the role");
assert.equal(assignedPermissions.includes("product_view"), false, "explicit role permissions must replace legacy direct defaults");

const projected = projectUserRoles([...migratedRoles, analystRole], [
  { id: "u-1", roleId: analystRole.id },
  { id: "u-2", roleId: analystRole.id },
]);
assert.equal(projected.find((role) => role.id === analystRole.id)?.memberCount, 2);

console.log("user roles tests passed");
