import test from "node:test";
import assert from "node:assert/strict";

const portalDatabaseUrl = process.env.COLLABORATION_TEST_DATABASE_URL || "";
const integrationDatabaseUrl = process.env.COLLABORATION_TEST_INTEGRATION_DATABASE_URL || "";

test("PostgreSQL migration, direct accounts, and RLS isolation work together", { skip: !portalDatabaseUrl || !integrationDatabaseUrl }, async (t) => {
  assert.notEqual(new URL(portalDatabaseUrl).username, new URL(integrationDatabaseUrl).username, "RLS test requires separate portal and integration roles");
  process.env.SKIP_ENV_FILE = "true";
  process.env.COLLABORATION_DATABASE_URL = portalDatabaseUrl;
  process.env.COLLABORATION_INTEGRATION_DATABASE_URL = integrationDatabaseUrl;
  process.env.COLLABORATION_SECRET_KEY = "test-secret-key-at-least-thirty-two-characters";
  process.env.COLLABORATION_INTERNAL_TOKEN = "test-internal-token-at-least-thirty-two-characters";
  process.env.COLLABORATION_OEM_ENABLED = "true";
  const [{ migrate }, { integrationPool, portalPool, closePools }, identity, authApi, integrationApi, repository, partnerOrders] = await Promise.all([import("../api/migrate.js"), import("../api/db.js"), import("../api/identity.js"), import("../api/auth.js"), import("../api/integration.js"), import("../api/repository.js"), import("../api/partner-orders.js")]);
  t.after(closePools);
  await migrate();
  const unique = Date.now().toString(36);
  const initialPassword = `Initial${unique}9`;
  const nextPassword = `Changed${unique}8`;
  const bootstrap = await identity.bootstrapOrganization({
    name: `测试协同仓 ${unique}`,
    organizationType: "warehouse",
    notificationEmail: "",
    administrator: { username: `admin-${unique}`, displayName: "测试管理员", email: "", password: initialPassword },
    actorName: "集成测试",
  });
  assert.match(bootstrap.organization.code, /^wh-[a-z0-9_-]{6,10}$/);
  assert.equal(bootstrap.administrator.email, "");
  assert.equal(bootstrap.administrator.mustChangePassword, false);
  const stored = await integrationPool.query("SELECT password_hash,must_change_password,email FROM collaboration_users WHERE id=$1", [bootstrap.administrator.userId]);
  assert.match(stored.rows[0].password_hash, /^\$argon2id\$/);
  assert.notEqual(stored.rows[0].password_hash, initialPassword);
  assert.equal(stored.rows[0].must_change_password, false);
  assert.equal(stored.rows[0].email, null);
  const request = { headers: { "x-forwarded-for": "127.0.0.1", "user-agent": "collaboration-integration-test" }, socket: { remoteAddress: "127.0.0.1" } };
  const signedIn = await authApi.login(request, { username: `admin-${unique}`, password: initialPassword });
  assert.equal(signedIn.auth.mustChangePassword, false);
  await identity.updateOwnProfile(signedIn.auth, { displayName: "更新后的管理员", email: `admin-${unique}@example.test`, currentPassword: initialPassword });
  await identity.changeOwnPassword(signedIn.auth, { currentPassword: initialPassword, newPassword: nextPassword });
  const signedInAgain = await authApi.login(request, { username: `admin-${unique}`, password: nextPassword });
  assert.equal(signedInAgain.auth.mustChangePassword, false);
  assert.equal(signedInAgain.auth.user.email, `admin-${unique}@example.test`);
  const grantedWarehouseRef = `warehouse-${unique}`;
  const blockedWarehouseRef = `blocked-${unique}`;
  await assert.rejects(() => integrationApi.applyInventoryProjection({
    eventId: `inventory-blocked-${unique}`,
    organizationCode: bootstrap.organization.code,
    warehouseRef: blockedWarehouseRef,
    warehouseName: "未授权仓",
    version: 1,
    syncedAt: new Date().toISOString(),
    items: [{ sku: `BLOCKED-${unique}`, productName: "不可见商品", availableQuantity: 1, lockedQuantity: 0, inTransitQuantity: 0, unit: "件" }],
  }), (error) => error?.code === "resource_not_granted");
  await integrationPool.query(
    `INSERT INTO organization_access_grants(organization_id,resource_type,resource_ref,resource_name,permissions,created_by_name)
     VALUES ($1,'warehouse',$2,'授权仓',$3::jsonb,'集成测试')`,
    [bootstrap.organization.id, grantedWarehouseRef, JSON.stringify(["warehouse.inventory.view", "warehouse.task.view"])],
  );
  await integrationApi.applyInventoryProjection({
    eventId: `inventory-granted-${unique}`,
    organizationCode: bootstrap.organization.code,
    warehouseRef: grantedWarehouseRef,
    warehouseName: "授权仓",
    version: 1,
    syncedAt: new Date().toISOString(),
    items: [{ sku: `VISIBLE-${unique}`, productName: "可见商品", availableQuantity: 2, lockedQuantity: 0, inTransitQuantity: 0, unit: "件" }],
  });
  const projectedTask = await integrationApi.applyCollaborationProjection({
    eventId: `task-granted-${unique}`,
    organizationCode: bootstrap.organization.code,
    coreRefType: "domestic_inbound",
    coreRefId: `IN-${unique}`,
    itemType: "warehouse_inbound",
    title: "授权仓入库任务",
    description: "权限集成测试",
    priority: "normal",
    status: "pending",
    dueAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    publicPayload: { referenceNo: `IN-${unique}`, warehouseRef: grantedWarehouseRef, warehouseName: "授权仓", sourceWarehouseName: "", destinationWarehouseName: "", note: "" },
    lines: [],
  });
  assert.equal((await repository.listWorkItems(signedInAgain.auth)).items.length, 1);
  const overdue = await integrationApi.listInternalWorkItems({ organizationCode: bootstrap.organization.code, overdue: "true" });
  assert.equal(overdue.counts.overdue, 1);
  assert.equal(overdue.items[0].id, projectedTask.workItemId);
  const reminder = await integrationApi.remindInternalWorkItem(projectedTask.workItemId, { actorName: "集成测试", note: "请尽快处理并反馈差异。" });
  assert.equal(reminder.ok, true);
  const reminderRows = await integrationPool.query(
    "SELECT event_type FROM work_item_events WHERE organization_id=$1 AND work_item_id=$2 AND event_type='core.reminder'",
    [bootstrap.organization.id, projectedTask.workItemId],
  );
  assert.equal(reminderRows.rowCount, 1);
  await assert.rejects(
    () => integrationApi.remindInternalWorkItem(projectedTask.workItemId, { actorName: "集成测试" }),
    (error) => error?.code === "reminder_cooldown",
  );
  await integrationPool.query(
    "UPDATE organization_access_grants SET permissions=$3::jsonb WHERE organization_id=$1 AND resource_ref=$2",
    [bootstrap.organization.id, grantedWarehouseRef, JSON.stringify(["warehouse.inventory.view", "warehouse.task.view"])],
  );
  await assert.rejects(() => repository.submitWorkItemAction(signedInAgain.auth, projectedTask.workItemId, { action: "accept", note: "接单" }, { idempotencyKey: `accept-blocked-${unique}`, expectedVersion: "1" }), (error) => error?.code === "resource_not_granted");
  await integrationPool.query(
    "UPDATE organization_access_grants SET permissions=$3::jsonb WHERE organization_id=$1 AND resource_ref=$2",
    [bootstrap.organization.id, grantedWarehouseRef, JSON.stringify(["warehouse.inventory.view"])],
  );
  assert.equal((await repository.listWorkItems(signedInAgain.auth)).items.length, 0);
  await integrationPool.query(
    `INSERT INTO warehouse_inventory_projections(organization_id,warehouse_ref,warehouse_name,sku,product_name,available_quantity,last_core_synced_at)
     VALUES ($1,$2,'未授权仓',$3,'不可见商品',3,now())`,
    [bootstrap.organization.id, blockedWarehouseRef, `HIDDEN-${unique}`],
  );
  const visibleInventory = await repository.listInventory(signedInAgain.auth);
  assert.deepEqual(visibleInventory.items.map((item) => item.sku), [`VISIBLE-${unique}`]);
  const clearedInventory = await integrationApi.applyInventoryProjection({
    eventId: `inventory-cleared-${unique}`,
    organizationCode: bootstrap.organization.code,
    warehouseRef: grantedWarehouseRef,
    warehouseName: "授权仓",
    version: 2,
    syncedAt: new Date().toISOString(),
    items: [],
  });
  assert.equal(clearedInventory.deletedItemCount, 1);
  assert.deepEqual((await repository.listInventory(signedInAgain.auth)).items, []);

  const factoryPassword = `Factory${unique}7`;
  const factory = await identity.bootstrapOrganization({
    name: `委外工厂 ${unique}`,
    organizationType: "production_factory",
    notificationEmail: "",
    administrator: { username: `factory-${unique}`, displayName: "工厂负责人", email: "", password: factoryPassword },
    actorName: "集成测试",
  });
  await integrationPool.query(
    `INSERT INTO organization_access_grants(organization_id,resource_type,resource_ref,resource_name,permissions,created_by_name)
     VALUES ($1,'organization','production','委外加工',$2::jsonb,'集成测试')`,
    [factory.organization.id, JSON.stringify(["production.order.view", "production.order.accept", "production.progress.update", "production.material.update", "production.exception.report", "production.shipment.submit", "attachment.upload"])],
  );
  const projectedOrder = await partnerOrders.applyPartnerOrderProjection({
    eventId: `partner-order-${unique}`,
    organizationCode: factory.organization.code,
    coreRefType: "jiandaoyun_outsourcing_order",
    coreRefId: `JG-${unique}`,
    orderType: "production",
    itemType: "production_order",
    title: `委外加工单 JG-${unique}`,
    description: "端到端联动测试",
    priority: "urgent",
    status: "pending",
    dueAt: "2026-10-30T08:00:00.000Z",
    version: 1,
    publicPayload: { orderNo: `JG-${unique}`, productName: "测试乳液", productSpec: "375ml 光银软管", barcode: "6970000000001", productionProcess: "灌装,打码,装盒", cartonType: "专用箱", piecesPerCarton: 48, factoryExpectedDeliveryDate: "2026-10-28", fulfillmentMode: "turnkey", requirements: "包材测试通过后生产", quantity: 12000, unit: "支", deliveryDate: "2026-10-30", currency: "CNY" },
    lines: [
      { lineRef: "finished", lineType: "finished_product", sku: `SKU-${unique}`, productName: "测试乳液", specification: "375ml 光银软管", plannedQuantity: 12000, unit: "支", responsibility: "factory" },
      { lineRef: "carton", lineType: "packaging", sku: `PACK-${unique}`, productName: "运输外箱", specification: "48支/箱", plannedQuantity: 250, unit: "个", responsibility: "factory" },
    ],
    milestones: [{ milestoneType: "material_ready", title: "物料到齐", status: "pending", publicPayload: { note: "" } }],
  });
  const factoryLogin = await authApi.login(request, { username: `factory-${unique}`, password: factoryPassword });
  const accepted = await repository.submitWorkItemAction(factoryLogin.auth, projectedOrder.workItemId, { action: "accept", note: "已接单" }, { idempotencyKey: `accept-${unique}`, expectedVersion: "1" });
  assert.equal(accepted.item.status, "accepted");
  const acceptCommand = (await integrationApi.listPendingCommands({ limit: 100 })).commands.find((command) => command.id === accepted.command.id);
  assert.ok(acceptCommand);
  await integrationApi.completeCommand(acceptCommand.id, { status: "applied", resultCode: "applied", message: "接单已同步", coreReference: `JG-${unique}` });
  assert.equal((await integrationPool.query("SELECT status FROM integration_outbox WHERE aggregate_type='partner_command' AND aggregate_id=$1", [acceptCommand.id])).rows[0].status, "sent");
  const acceptedDetail = await repository.getWorkItem(factoryLogin.auth, projectedOrder.workItemId);
  await assert.rejects(() => repository.getWorkItem(signedInAgain.auth, projectedOrder.workItemId), (error) => error?.code === "not_found");
  await assert.rejects(() => partnerOrders.submitPartnerOrderReport(factoryLogin.auth, projectedOrder.workItemId, { reportType: "production_progress", stage: "filling", progressPercent: 50, completedQuantity: 13000, expectedCompletionDate: "2026-10-28", note: "超量测试" }, { idempotencyKey: `progress-over-${unique}`, expectedVersion: String(acceptedDetail.item.version) }), (error) => error?.code === "quantity_exceeded");
  const reportBody = { reportType: "production_progress", stage: "filling", progressPercent: 35, completedQuantity: 4200, expectedCompletionDate: "2026-10-28", note: "首批灌装与密封测试已完成" };
  const report = await partnerOrders.submitPartnerOrderReport(factoryLogin.auth, projectedOrder.workItemId, reportBody, { idempotencyKey: `progress-${unique}`, expectedVersion: String(acceptedDetail.item.version) });
  assert.equal(report.report.progressPercent, 35);
  const replay = await partnerOrders.submitPartnerOrderReport(factoryLogin.auth, projectedOrder.workItemId, reportBody, { idempotencyKey: `progress-${unique}`, expectedVersion: String(acceptedDetail.item.version) });
  assert.equal(replay.idempotentReplay, true);
  const reportCommand = (await integrationApi.listPendingCommands({ limit: 100 })).commands.find((command) => command.id === report.commandId);
  assert.equal(reportCommand.payload.note, "首批灌装与密封测试已完成");
  await integrationApi.completeCommand(reportCommand.id, { status: "applied", resultCode: "applied", message: "工厂反馈已同步到千顷 ERP", coreReference: `JG-${unique}` });
  assert.equal((await integrationPool.query("SELECT status FROM integration_outbox WHERE aggregate_type='partner_command' AND aggregate_id=$1", [reportCommand.id])).rows[0].status, "sent");
  const internalDetail = await integrationApi.getInternalWorkItem(projectedOrder.workItemId);
  assert.equal(internalDetail.item.organizationCode, factory.organization.code);
  assert.equal(internalDetail.partnerOrder.lines.length, 2);
  assert.equal(internalDetail.partnerOrder.reports.length, 1);
  assert.equal(internalDetail.partnerOrder.reports[0].submittedByName, "工厂负责人");
  assert.equal(internalDetail.commands.find((command) => command.id === report.commandId).status, "applied");
  const sourceMilestoneUpdate = await partnerOrders.applyPartnerOrderProjection({
    eventId: `partner-order-update-${unique}`,
    organizationCode: factory.organization.code,
    coreRefType: "jiandaoyun_outsourcing_order",
    coreRefId: `JG-${unique}`,
    orderType: "production",
    itemType: "production_order",
    title: `委外加工单 JG-${unique}`,
    description: "端到端联动测试",
    priority: "urgent",
    status: "in_progress",
    dueAt: "2026-10-30T08:00:00.000Z",
    version: internalDetail.item.version + 1,
    publicPayload: { orderNo: `JG-${unique}`, productName: "测试乳液", productSpec: "375ml 光银软管", barcode: "6970000000001", productionProcess: "灌装,打码,装盒", cartonType: "专用箱", piecesPerCarton: 48, factoryExpectedDeliveryDate: "2026-10-28", fulfillmentMode: "turnkey", requirements: "包材测试通过后生产", quantity: 12000, unit: "支", deliveryDate: "2026-10-30", currency: "CNY" },
    lines: [
      { lineRef: "finished", lineType: "finished_product", sku: `SKU-${unique}`, productName: "测试乳液", specification: "375ml 光银软管", plannedQuantity: 12000, unit: "支", responsibility: "factory" },
      { lineRef: "carton", lineType: "packaging", sku: `PACK-${unique}`, productName: "运输外箱", specification: "48支/箱", plannedQuantity: 250, unit: "个", responsibility: "factory" },
    ],
    milestones: [{ milestoneType: "material_ready", title: "物料到齐", status: "completed", publicPayload: { note: "已到齐" } }],
  });
  assert.equal(sourceMilestoneUpdate.ignoredStaleVersion, undefined);
  const updatedInternalDetail = await integrationApi.getInternalWorkItem(projectedOrder.workItemId);
  assert.equal(updatedInternalDetail.partnerOrder.milestones[0].status, "completed");
  assert.ok(updatedInternalDetail.partnerOrder.milestones[0].completedAt);

  const resetPassword = `Reset${unique}7!`;
  const renamedUsername = `owner-${unique}`;
  const credentialUpdate = await identity.updateMemberCredentialsInternally(bootstrap.organization.code, bootstrap.administrator.membershipId, {
    username: renamedUsername,
    password: resetPassword,
    actorName: "中台账号管理员",
  });
  assert.equal(credentialUpdate.member.username, renamedUsername);
  assert.equal(credentialUpdate.passwordReset, true);
  assert.ok(credentialUpdate.sessionsRevoked >= 1);
  await assert.rejects(() => authApi.login(request, { username: `admin-${unique}`, password: nextPassword }), (error) => error?.code === "invalid_credentials");
  const renamedLogin = await authApi.login(request, { username: renamedUsername, password: resetPassword });
  assert.equal(renamedLogin.auth.user.username, renamedUsername);
  const credentialAudit = await integrationPool.query("SELECT metadata FROM audit_log WHERE action='identity.member.credentials.internal' AND object_id=$1 ORDER BY created_at DESC LIMIT 1", [bootstrap.administrator.membershipId]);
  assert.equal(credentialAudit.rows[0].metadata.passwordReset, true);
  assert.equal(credentialAudit.rows[0].metadata.password, undefined);

  const orgs = await integrationPool.query("INSERT INTO organizations(code,name,organization_type) VALUES ('rls-a','A仓','warehouse'),('rls-b','B仓','warehouse') ON CONFLICT(code) DO UPDATE SET name=excluded.name RETURNING id,code");
  const a = orgs.rows.find((row) => row.code === "rls-a").id;
  const b = orgs.rows.find((row) => row.code === "rls-b").id;
  await integrationPool.query("DELETE FROM warehouse_inventory_projections WHERE organization_id IN ($1,$2)", [a, b]);
  await integrationPool.query("INSERT INTO warehouse_inventory_projections(organization_id,warehouse_ref,warehouse_name,sku,product_name,available_quantity,last_core_synced_at) VALUES ($1,'a','A仓','A-SKU','A产品',1,now()),($2,'b','B仓','B-SKU','B产品',1,now())", [a, b]);
  await integrationPool.query("DELETE FROM organization_access_grants WHERE organization_id IN ($1,$2)", [a, b]);
  await integrationPool.query("INSERT INTO organization_access_grants(organization_id,resource_type,resource_ref,resource_name,permissions) VALUES ($1,'warehouse','a','A仓','[\"warehouse.inventory.view\"]'),($2,'warehouse','b','B仓','[\"warehouse.inventory.view\"]')", [a, b]);
  const client = await portalPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_organization_id',$1,true)", [a]);
    const rows = await client.query("SELECT sku FROM warehouse_inventory_projections ORDER BY sku");
    assert.deepEqual(rows.rows.map((row) => row.sku), ["A-SKU"]);
    const grants = await client.query("SELECT resource_ref FROM organization_access_grants ORDER BY resource_ref");
    assert.deepEqual(grants.rows.map((row) => row.resource_ref), ["a"]);
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
});
