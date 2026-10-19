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
const partnerOrderSql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "0008_partner_order_collaboration.sql"), "utf8");
const samplingVariantSql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "0010_sampling_variants.sql"), "utf8");
const commandOutboxReconciliationSql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "0011_command_outbox_reconciliation.sql"), "utf8");
const inventoryBarcodeSql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "0012_inventory_barcode_lookup.sql"), "utf8");
const partnerQualificationSql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "0013_partner_qualification_coverage.sql"), "utf8");
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
const partnerOrderSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "api", "partner-orders.js"), "utf8");

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

test("routine core projection refreshes stay out of partner activity feeds", () => {
  assert.match(integrationSource, /const isNewWorkItem = !existing\.rows\[0\]/);
  assert.match(oemSource, /const isNewWorkItem = !existing\.rows\[0\]/);
  assert.match(integrationSource, /if \(isNewWorkItem\)[\s\S]*收到新的协同任务/);
  assert.match(oemSource, /if \(isNewWorkItem\)[\s\S]*收到新的 OEM 协同任务/);
  assert.doesNotMatch(integrationSource, /协同任务已更新/);
  assert.doesNotMatch(oemSource, /OEM 协同任务已更新/);
  assert.match(repositorySource, /coreSyncEventTypes/);
  assert.match(repositorySource, /coreSyncNotificationTitles/);
  assert.match(repositorySource, /title <> ALL\(\$3::text\[\]\)/);
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
  const taskDrawer = portalSource.match(/function TaskDetailDrawer[\s\S]*?function AccountPage/)?.[0] || "";
  assert.match(taskDrawer, /completedQuantity: line\.completedQuantity > 0 \? line\.completedQuantity : ""/);
  assert.match(taskDrawer, /hasInvalidActualQuantity/);
  assert.doesNotMatch(taskDrawer, /completedQuantity: line\.completedQuantity \|\| line\.plannedQuantity/);
});

test("supplier organizations can receive exact warehouse grants without becoming warehouse organizations", () => {
  assert.match(accessSource, /warehouseResourceOrganizationTypes/);
  assert.match(accessSource, /production_factory/);
  assert.match(accessSource, /material_supplier/);
  assert.match(accessSource, /packaging_factory/);
  assert.match(accessSource, /supportsWarehouseResources/);
  assert.match(accessSource, /grant\.resourceType === "warehouse"/);
  assert.match(accessSource, /warehouseCapabilities/);
  const warehouseOperation = repositorySource.match(/export async function createWarehouseOperation[\s\S]*?export async function listInventory/)?.[0] || "";
  assert.doesNotMatch(warehouseOperation, /organization\.type\s*!==\s*["']warehouse["']/);
  assert.match(warehouseOperation, /assertResourcePermission[\s\S]*warehouse\.task\.view/);
});

test("hybrid supplier navigation is capability driven and keeps warehouse tasks separate", () => {
  assert.match(portalSource, /hasWorkspaceModule\(session, "inventory"\)/);
  assert.match(portalSource, /hasWorkspaceModule\(session, "warehouse_tasks"\)/);
  assert.match(portalSource, /"warehouse-tasks"/);
  assert.match(portalSource, /itemType\.startsWith\("warehouse_"\)/);
  assert.doesNotMatch(portalSource, /route === "inventory" && mode === "warehouse"/);
});

test("warehouse inventory barcode lookup is projected and indexed", () => {
  assert.match(inventoryBarcodeSql, /ADD COLUMN IF NOT EXISTS barcode text NOT NULL DEFAULT ''/);
  assert.match(inventoryBarcodeSql, /organization_id, warehouse_ref, barcode/);
  assert.match(repositorySource, /product_name ILIKE \$2 OR barcode ILIKE \$2/);
  assert.match(repositorySource, /barcode: row\.barcode \|\| ""/);
  assert.match(portalSource, /扫描条码或输入 SKU 后回车/);
});

test("partner qualification coverage migration is additive and keeps sync state tenant isolated", () => {
  assert.match(partnerQualificationSql, /ADD COLUMN IF NOT EXISTS qualification_coverage jsonb/);
  assert.match(partnerQualificationSql, /CREATE TABLE IF NOT EXISTS warehouse_inventory_projection_states/);
  assert.match(partnerQualificationSql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(partnerQualificationSql, /FORCE ROW LEVEL SECURITY/);
  assert.match(partnerQualificationSql, /app\.current_organization_id/);
  assert.match(integrationSource, /qualification_coverage/);
  assert.match(integrationSource, /warehouse_inventory_projection_states/);
  assert.match(repositorySource, /warehouse\.inventory\.view/);
  assert.match(serverSource, /collaboration\/v1\/qualification-coverage/);
});

test("receiving barcode capture writes the physical code to the selected line without product lookup", () => {
  const captureComponent = portalSource.match(/function BarcodeCameraDialog[\s\S]*?function LoginPage/)?.[0] || "";
  assert.match(captureComponent, /BarcodeDetector/);
  assert.match(captureComponent, /getUserMedia/);
  assert.match(captureComponent, /扫描结果只写入当前商品，不要求商品主档已有条码/);
  assert.match(captureComponent, /event\.preventDefault\(\)/, "扫码枪回车不得误提交整个收货表单");
  assert.doesNotMatch(captureComponent, /fetchInventory|productLookup/, "收货条码采集不得依赖库存或商品主档反查");
  assert.match(portalSource, /实际到货条码[\s\S]*BarcodeCaptureInput/);
});

test("internal warehouse progress reads stay behind the integration boundary", () => {
  assert.match(integrationSource, /export async function listInternalWorkItems/);
  assert.match(integrationSource, /w\.item_type LIKE 'warehouse_%'/);
  assert.match(integrationSource, /export async function getInternalWorkItem/);
  assert.match(serverSource, /collaboration\/internal\/v1\/work-items/);
  assert.match(serverSource, /assertInternalRequest\(req\)/);
  assert.match(storageSource, /export async function internalAttachmentDownload/);
  assert.match(storageSource, /export async function internalAttachmentUpload/);
  assert.doesNotMatch(storageSource.match(/export async function internalAttachmentDownload[\s\S]*?\n\}/)?.[0] || "", /item_type LIKE 'warehouse_%'/);
  assert.match(storageSource, /scan_status !== "clean"/);
  assert.doesNotMatch(integrationSource.match(/function internalWorkItem\(row\)[\s\S]*?\n\}/)?.[0] || "", /password|secret|token|email/i);
});

test("overdue warehouse work can be filtered and safely reminded", () => {
  assert.match(integrationSource, /export async function remindInternalWorkItem/);
  assert.match(integrationSource, /event_type='core\.reminder'/);
  assert.match(integrationSource, /15 \* 60_000/);
  assert.match(integrationSource, /delivery_status\)\s*\n\s*VALUES \(\$1,\$2,\$3,\$4,'in_app','sent'\)/);
  assert.match(serverSource, /work-items\/\$\{uuidPattern\}\/remind/);
  assert.match(integrationSource, /w\.due_at<now\(\)/);
});

test("terminal partner commands reconcile their integration outbox rows", () => {
  assert.match(commandOutboxReconciliationSql, /UPDATE integration_outbox AS outbox/);
  assert.match(commandOutboxReconciliationSql, /command\.status IN \('applied', 'rejected', 'failed'\)/);
  assert.match(commandOutboxReconciliationSql, /idx_work_items_overdue/);
  assert.match(integrationSource, /UPDATE integration_outbox SET status='sent'/);
});

test("production and procurement collaboration is tenant isolated and append-only", () => {
  for (const table of ["partner_order_lines", "partner_order_reports"]) {
    assert.match(partnerOrderSql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(partnerOrderSql, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
    assert.match(partnerOrderSql, new RegExp(`CREATE POLICY tenant_isolation ON ${table}`));
  }
  assert.match(partnerOrderSql, /REVOKE UPDATE, DELETE ON partner_order_reports/);
  assert.match(partnerOrderSource, /assertResourcePermission/);
  assert.match(partnerOrderSource, /assertWorkItemPermission/);
  assert.match(partnerOrderSource, /organization_id=\$1 AND work_item_id=\$2/);
  assert.match(serverSource, /partner-orders\/projections/);
  assert.match(serverSource, /partner-orders\/\$\{uuidPattern\}\/reports/);
});

test("sampling quotes bind the exact system-generated final sample variant", () => {
  assert.match(samplingVariantSql, /sample_variant_code text NOT NULL DEFAULT ''/);
  assert.match(oemSource, /generatedSampleVariantCode/);
  assert.match(oemSource, /approvedVariantCode/);
  assert.match(oemSource, /sample_variant_code/);
});
