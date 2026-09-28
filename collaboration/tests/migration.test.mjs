import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "0001_foundation.sql"), "utf8");
const directAccountSql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "0002_direct_account_provisioning.sql"), "utf8");
const noMfaSql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "0003_disable_mfa_requirement.sql"), "utf8");
const noForcedPasswordSql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "0004_disable_forced_password_change.sql"), "utf8");
const identitySource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "api", "identity.js"), "utf8");
const serverSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "api", "server.js"), "utf8");
const repositorySource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "api", "repository.js"), "utf8");
const oemSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "api", "oem.js"), "utf8");
const notificationSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "api", "notifications.js"), "utf8");

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

test("authenticator requirements are disabled without removing legacy security columns", () => {
  assert.match(noMfaSql, /UPDATE organization_memberships[\s\S]*mfa_required = false/);
  assert.match(noMfaSql, /UPDATE collaboration_invitations[\s\S]*mfa_required = false/);
  assert.doesNotMatch(serverSource, /collaboration\/auth\/mfa\/(setup|verify)/);
  assert.doesNotMatch(repositorySource, /mfa_step_up_required/);
  assert.doesNotMatch(oemSource, /mfa_step_up_required/);
});
