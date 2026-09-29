import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "0001_foundation.sql"), "utf8");
const directAccountSql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "0002_direct_account_provisioning.sql"), "utf8");
const noMfaSql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "0003_disable_mfa_requirement.sql"), "utf8");
const noForcedPasswordSql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "0004_disable_forced_password_change.sql"), "utf8");
const usernameOnlyLoginSql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "0005_username_only_login.sql"), "utf8");
const accessGrantSql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "0006_organization_access_grants.sql"), "utf8");
const warehouseOperationsSql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "0007_warehouse_operations.sql"), "utf8");
const authSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "api", "auth.js"), "utf8");
const identitySource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "api", "identity.js"), "utf8");
const serverSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "api", "server.js"), "utf8");
const portalSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "portal", "src", "App.tsx"), "utf8");
const repositorySource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "api", "repository.js"), "utf8");
const oemSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "api", "oem.js"), "utf8");
const notificationSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "api", "notifications.js"), "utf8");
const accessSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "api", "access.js"), "utf8");
const integrationSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "api", "integration.js"), "utf8");
const storageSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "api", "storage.js"), "utf8");
const migrateSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "api", "migrate.js"), "utf8");

test("all partner-owned tables opt into forced row-level security", () => {
  const tables = [
    "organization_memberships", "collaboration_invitations",
    "collaboration_projects", "collaboration_spaces", "work_items", "warehouse_task_lines",
    "warehouse_inventory_projections", "work_item_events", "partner_commands", "approvals",
    "attachments", "notifications", "audit_log", "oem_artifacts", "supplier_quotes", "production_milestones",
  ];
  assert.match(sql, /ALTER TABLE %I ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE %I FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /app\.current_organization_id/);
  for (const table of tables) assert.match(sql, new RegExp(`['"]${table}['"]`));
  for (const table of ["organizations", "collaboration_users", "collaboration_sessions"]) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(sql, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
  }
});

test("sensitive platform records do not store raw credentials in work items", () => {
  const workItemDefinition = sql.match(/CREATE TABLE IF NOT EXISTS work_items \([\s\S]*?\n\);/)?.[0] || "";
  assert.ok(workItemDefinition);
  assert.doesNotMatch(workItemDefinition, /password|secret|credential|unit_cost|customer_name/i);
  assert.match(sql, /token_hash text NOT NULL UNIQUE/);
  assert.match(sql, /csrf_token_hash text NOT NULL/);
});

test("notification delivery only locks notification rows across outer joins", () => {
  assert.match(notificationSource, /FOR UPDATE OF n SKIP LOCKED/);
  assert.doesNotMatch(notificationSource, /LIMIT 20 FOR UPDATE SKIP LOCKED/);
});

test("directly provisioned accounts can use the assigned password immediately", () => {
  assert.match(directAccountSql, /must_change_password boolean NOT NULL DEFAULT false/);
  assert.match(identitySource, /must_change_password\)\s*\n\s*VALUES[\s\S]*'active',false/);
  assert.doesNotMatch(identitySource, /must_change_password\)\s*\n\s*VALUES[\s\S]*'active',true/);
  assert.match(noForcedPasswordSql, /UPDATE collaboration_users[\s\S]*must_change_password = false/);
  assert.doesNotMatch(serverSource, /password_change_required/);
  assert.match(identitySource, /hashPassword\(validateNewPassword\(input\.administrator\.password\)\)/);
  assert.match(identitySource, /generateOrganizationCode\(input\.organizationType\)/);
  assert.match(identitySource, /email: optionalEmailSchema/);
});

test("partner login resolves the organization from a globally unique username", () => {
  assert.match(sql, /UNIQUE INDEX[^\n]+collaboration_users_username_lower[^\n]+lower\(username\)/i);
  assert.match(usernameOnlyLoginSql, /UNIQUE INDEX[^\n]+organization_memberships_user_unique[\s\S]+organization_memberships\(user_id\)/i);
  assert.match(authSource, /export async function login\(req, \{ username, password \}\)/);
  assert.doesNotMatch(authSource, /organization_required|AND \(\$2='' OR o\.code=\$2\)/);
  assert.doesNotMatch(identitySource.match(/const resetRequestSchema[\s\S]*?\.strict\(\);/)?.[0] || "", /organizationCode/);
  assert.match(portalSource, /请输入管理员分配的账号和密码/);
  assert.doesNotMatch(portalSource.match(/function LoginPage[\s\S]*?function CredentialFlowPage/)?.[0] || "", /组织代码/);
});

test("authenticator requirements are disabled without removing legacy security columns", () => {
  assert.match(noMfaSql, /UPDATE organization_memberships[\s\S]*mfa_required = false/);
  assert.match(noMfaSql, /UPDATE collaboration_invitations[\s\S]*mfa_required = false/);
  assert.doesNotMatch(serverSource, /collaboration\/auth\/mfa\/(setup|verify)/);
  assert.doesNotMatch(repositorySource, /mfa_step_up_required/);
  assert.doesNotMatch(oemSource, /mfa_step_up_required/);
});

test("organization resource grants are deny-by-default and RLS protected", () => {
  assert.match(accessGrantSql, /CREATE TABLE IF NOT EXISTS organization_access_grants/);
  assert.match(accessGrantSql, /UNIQUE \(organization_id, resource_type, resource_ref\)/);
  assert.match(accessGrantSql, /ALTER TABLE organization_access_grants ENABLE ROW LEVEL SECURITY/);
  assert.match(accessGrantSql, /ALTER TABLE organization_access_grants FORCE ROW LEVEL SECURITY/);
  assert.match(accessGrantSql, /FROM warehouse_inventory_projections/);
  assert.match(accessGrantSql, /FROM work_items/);
  assert.doesNotMatch(accessGrantSql, /CROSS JOIN organizations/);
});

test("resource permissions guard projections, reads, actions and attachments", () => {
  assert.match(accessSource, /有效|organization_access_grants/);
  assert.match(integrationSource, /assertResourcePermission[\s\S]*warehouse\.task\.view/);
  assert.match(integrationSource, /assertResourcePermission[\s\S]*warehouse\.inventory\.view/);
  assert.match(repositorySource, /workItemAccessPredicate/);
  assert.match(repositorySource, /assertWorkItemPermission/);
  assert.match(storageSource, /assertWorkItemPermission[\s\S]*attachment\.upload/);
  assert.match(oemSource, /packaging\.quote\.submit/);
  assert.match(oemSource, /production\.progress\.update/);
});

test("warehouse self-service stores allowlisted images and retains approval controls", () => {
  assert.match(warehouseOperationsSql, /ADD COLUMN IF NOT EXISTS image_url/);
  assert.match(repositorySource, /createWarehouseOperation/);
  assert.match(repositorySource, /pending_approval/);
  assert.match(repositorySource, /warehouse\.inventory\.adjust\.request/);
  assert.match(repositorySource, /insufficient_projected_stock/);
  assert.match(migrateSource, /GRANT SELECT,INSERT ON collaboration_projects,collaboration_spaces,warehouse_task_lines/);
  assert.match(integrationSource, /partner_warehouse_operation/);
});
