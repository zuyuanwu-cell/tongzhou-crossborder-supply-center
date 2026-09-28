import { fileURLToPath } from "node:url";
import { collaborationConfig } from "./config.js";
import { closePools, withSystem } from "./db.js";
import { migrate } from "./migrate.js";
import { hashPassword, validateNewPassword } from "./security.js";
import { applyCollaborationProjection, applyInventoryProjection } from "./integration.js";

export async function seedDevelopmentData() {
  if (collaborationConfig.production && process.env.COLLABORATION_ALLOW_PRODUCTION_SEED !== "true") throw new Error("Production seed is disabled.");
  await migrate();
  const password = validateNewPassword(process.env.COLLABORATION_SEED_PASSWORD || "TongzhouDemo2026!");
  const passwordHash = await hashPassword(password);
  await withSystem(async (client) => {
    const org = await client.query(
      `INSERT INTO organizations(code,name,organization_type,metadata)
       VALUES ('cn-warehouse-demo','华东协同仓','warehouse',$1)
       ON CONFLICT(code) DO UPDATE SET name=excluded.name,status='active' RETURNING id`,
      [{ notificationEmail: "" }],
    );
    const user = await client.query(
      `INSERT INTO collaboration_users(username,email,display_name,password_hash,status)
       VALUES ('warehouse.admin','warehouse@example.test','仓库负责人',$1,'active')
       ON CONFLICT (lower(username)) DO UPDATE SET password_hash=excluded.password_hash,status='active' RETURNING id`,
      [passwordHash],
    );
    await client.query(
      `INSERT INTO organization_memberships(organization_id,user_id,role,status,mfa_required)
       VALUES ($1,$2,'manager','active',false)
       ON CONFLICT(organization_id,user_id) DO UPDATE SET role='manager',status='active'`,
      [org.rows[0].id, user.rows[0].id],
    );
  });
  await applyCollaborationProjection({
    eventId: "seed-task-001-v1",
    organizationCode: "cn-warehouse-demo",
    coreRefType: "domestic_transfer",
    coreRefId: "seed-transfer-001",
    itemType: "warehouse_transfer",
    title: "华东仓调拨收货 · DB-202609-001",
    description: "请核对到货箱数、批次和外箱状态后确认收货。",
    priority: "urgent",
    status: "pending",
    dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    version: 1,
    publicPayload: { referenceNo: "DB-202609-001", warehouseRef: "dwh-east-01", warehouseName: "华东协同仓", sourceWarehouseName: "杭州总仓", destinationWarehouseName: "华东协同仓", note: "到货后请拍摄托盘和封箱标签。" },
    lines: [
      { sku: "TZKJ-DEMO-001", productName: "海盐净润洗发露", plannedQuantity: 240, completedQuantity: 0, unit: "件", lotNo: "LOT-260920-A", barcode: "697000000001" },
      { sku: "TZKJ-DEMO-002", productName: "森系修护发膜", plannedQuantity: 120, completedQuantity: 0, unit: "件", lotNo: "LOT-260921-B", barcode: "697000000002" },
    ],
  });
  await applyInventoryProjection({
    eventId: "seed-inventory-001-v1",
    organizationCode: "cn-warehouse-demo",
    warehouseRef: "dwh-east-01",
    warehouseName: "华东协同仓",
    version: 1,
    syncedAt: new Date().toISOString(),
    items: [
      { sku: "TZKJ-DEMO-001", productName: "海盐净润洗发露", availableQuantity: 1880, lockedQuantity: 240, inTransitQuantity: 240, unit: "件" },
      { sku: "TZKJ-DEMO-002", productName: "森系修护发膜", availableQuantity: 864, lockedQuantity: 120, inTransitQuantity: 120, unit: "件" },
      { sku: "TZKJ-DEMO-003", productName: "轻盈蓬松护发素", availableQuantity: 430, lockedQuantity: 0, inTransitQuantity: 0, unit: "件" },
    ],
  });
  return { username: "warehouse.admin", password, organizationCode: "cn-warehouse-demo" };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedDevelopmentData()
    .then((result) => console.log(`[collaboration:seed] ${JSON.stringify(result)}`))
    .finally(closePools)
    .catch((error) => { console.error(error); process.exitCode = 1; });
}
