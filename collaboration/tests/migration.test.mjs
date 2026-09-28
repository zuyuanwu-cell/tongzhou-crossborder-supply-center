import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "0001_foundation.sql"), "utf8");
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
