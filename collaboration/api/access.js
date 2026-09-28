import { z } from "zod";
import { withSystem } from "./db.js";

const permissionDefinitions = Object.freeze({
  "warehouse.inventory.view": ["查看库存", "查看该仓的库存投影与同步时间"],
  "warehouse.task.view": ["查看任务", "查看该仓的入库、出库、调拨和异常任务"],
  "warehouse.task.handle": ["接单与进度", "接单并更新处理进度"],
  "warehouse.exception.report": ["上报异常", "提交任务异常和说明"],
  "warehouse.inbound.confirm": ["确认入库", "提交入库确认"],
  "warehouse.outbound.confirm": ["确认出库", "提交出库确认"],
  "warehouse.transfer.receive": ["调拨收货", "确认调拨到货"],
  "warehouse.inventory.adjust.request": ["库存调整申请", "发起需内部审批的盘盈盘亏申请"],
  "warehouse.task.complete": ["完成任务", "提交任务完成状态"],
  "filing.task.view": ["查看备案任务", "查看本组织备案协同任务"],
  "filing.task.handle": ["处理备案任务", "接单并更新备案进度"],
  "filing.artifact.submit": ["提交备案资料", "按版本回传备案资料与结果"],
  "sampling.task.view": ["查看打样任务", "查看本组织打样协同任务"],
  "sampling.task.handle": ["处理打样任务", "接单并更新打样进度"],
  "sampling.artifact.submit": ["提交打样结果", "按版本回传样品结果"],
  "packaging.quote.view": ["查看询价", "查看本组织的私有询价"],
  "packaging.quote.submit": ["提交报价", "提交本组织报价，不能查看竞争方"],
  "production.order.view": ["查看生产工单", "查看批准版本的委外生产工单"],
  "production.progress.update": ["更新生产进度", "更新里程碑、异常与交付状态"],
  "production.artifact.submit": ["提交生产资料", "提交质检报告等生产资料"],
  "attachment.upload": ["上传附件", "在已授权任务中上传附件"],
});

const allowedByOrganizationType = Object.freeze({
  warehouse: Object.keys(permissionDefinitions).filter((key) => key.startsWith("warehouse.") || key === "attachment.upload"),
  filing_service: ["filing.task.view", "filing.task.handle", "filing.artifact.submit", "attachment.upload"],
  sampling_factory: ["sampling.task.view", "sampling.task.handle", "sampling.artifact.submit", "attachment.upload"],
  packaging_factory: ["packaging.quote.view", "packaging.quote.submit", "attachment.upload"],
  production_factory: ["sampling.task.view", "sampling.task.handle", "sampling.artifact.submit", "production.order.view", "production.progress.update", "production.artifact.submit", "attachment.upload"],
  internal: [],
});

const defaultResourceRef = Object.freeze({
  filing_service: "filing",
  sampling_factory: "sampling",
  packaging_factory: "packaging_quote",
  production_factory: "production",
});

const organizationResources = Object.freeze({
  filing_service: [{ ref: "filing", name: "备案协同", permissionPrefixes: ["filing."] }],
  sampling_factory: [{ ref: "sampling", name: "打样协同", permissionPrefixes: ["sampling."] }],
  packaging_factory: [{ ref: "packaging_quote", name: "包装询报价", permissionPrefixes: ["packaging."] }],
  production_factory: [
    { ref: "sampling", name: "打样协同", permissionPrefixes: ["sampling."] },
    { ref: "production", name: "委外生产工单", permissionPrefixes: ["production."] },
  ],
});

const grantSchema = z.object({
  resourceType: z.enum(["warehouse", "organization"]),
  resourceRef: z.string().trim().min(1).max(160),
  resourceName: z.string().trim().max(240).optional().default(""),
  permissions: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
}).strict();

const replaceSchema = z.object({
  grants: z.array(grantSchema).max(500),
  actorName: z.string().trim().min(1).max(160).optional().default("供应链中台管理员"),
}).strict();

function fail(message, statusCode = 400, code = "invalid_request") {
  throw Object.assign(new Error(message), { statusCode, code });
}

function publicGrant(row) {
  return {
    id: row.id,
    resourceType: row.resource_type,
    resourceRef: row.resource_ref,
    resourceName: row.resource_name,
    permissions: Array.isArray(row.permissions) ? row.permissions : [],
    createdByName: row.created_by_name,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function catalogForType(organizationType) {
  return (allowedByOrganizationType[organizationType] || []).map((key) => ({
    key,
    label: permissionDefinitions[key][0],
    description: permissionDefinitions[key][1],
  }));
}

function capabilitiesForResource(organizationType, resourceRef) {
  if (organizationType === "warehouse") return catalogForType(organizationType);
  const resource = (organizationResources[organizationType] || []).find((item) => item.ref === resourceRef);
  if (!resource) return [];
  return catalogForType(organizationType).filter((capability) => capability.key === "attachment.upload" || resource.permissionPrefixes.some((prefix) => capability.key.startsWith(prefix)));
}

function resourceCatalogForType(organizationType) {
  return (organizationResources[organizationType] || []).map((resource) => ({
    resourceRef: resource.ref,
    resourceName: resource.name,
    capabilities: capabilitiesForResource(organizationType, resource.ref),
  }));
}

function validateGrantForOrganization(organization, grant) {
  let allowed = new Set(allowedByOrganizationType[organization.organization_type] || []);
  if (organization.organization_type === "warehouse") {
    if (grant.resourceType !== "warehouse") fail("仓库组织只能分配仓库资源。", 400, "invalid_resource_type");
  } else {
    if (grant.resourceType !== "organization" || !(organizationResources[organization.organization_type] || []).some((resource) => resource.ref === grant.resourceRef)) {
      fail("该协同组织的业务资源类型不正确。", 400, "invalid_resource_type");
    }
    allowed = new Set(capabilitiesForResource(organization.organization_type, grant.resourceRef).map((capability) => capability.key));
  }
  const permissions = [...new Set(grant.permissions)];
  if (permissions.some((permission) => !allowed.has(permission))) fail("授权中包含不适用于该组织类型的业务能力。", 400, "invalid_permission");
  return { ...grant, permissions };
}

async function activeOrganizationByCode(client, code) {
  const result = await client.query("SELECT * FROM organizations WHERE code=$1", [code]);
  if (!result.rows[0]) fail("协同组织不存在。", 404, "organization_not_found");
  return result.rows[0];
}

export async function listOrganizationAccessGrants(code) {
  return withSystem(async (client) => {
    const organization = await activeOrganizationByCode(client, code);
    const result = await client.query(
      "SELECT * FROM organization_access_grants WHERE organization_id=$1 ORDER BY resource_name,resource_ref",
      [organization.id],
    );
    return {
      organization: { code: organization.code, name: organization.name, organizationType: organization.organization_type },
      grants: result.rows.map(publicGrant),
      capabilities: catalogForType(organization.organization_type),
      resources: resourceCatalogForType(organization.organization_type),
      defaultResourceRef: defaultResourceRef[organization.organization_type] || "",
    };
  });
}

export async function replaceOrganizationAccessGrants(code, input) {
  const parsed = replaceSchema.parse(input);
  return withSystem(async (client) => {
    const organization = await activeOrganizationByCode(client, code);
    const seen = new Set();
    const grants = parsed.grants.map((raw) => {
      const grant = validateGrantForOrganization(organization, raw);
      const key = `${grant.resourceType}:${grant.resourceRef}`;
      if (seen.has(key)) fail("同一资源不能重复授权。", 400, "duplicate_resource_grant");
      seen.add(key);
      return grant;
    });
    const before = await client.query("SELECT resource_type,resource_ref,resource_name,permissions FROM organization_access_grants WHERE organization_id=$1 ORDER BY resource_type,resource_ref", [organization.id]);
    await client.query("DELETE FROM organization_access_grants WHERE organization_id=$1", [organization.id]);
    for (const grant of grants) {
      await client.query(
        `INSERT INTO organization_access_grants(organization_id,resource_type,resource_ref,resource_name,permissions,created_by_name)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [organization.id, grant.resourceType, grant.resourceRef, grant.resourceName || grant.resourceRef, JSON.stringify(grant.permissions), parsed.actorName],
      );
    }
    await client.query(
      `INSERT INTO audit_log(organization_id,actor_name,action,object_type,object_id,result,metadata)
       VALUES ($1,$2,'organization.access_grants.replace','organization',$3,'applied',$4)`,
      [organization.id, parsed.actorName, organization.id, {
        before: before.rows.map((row) => ({ resourceType: row.resource_type, resourceRef: row.resource_ref, resourceName: row.resource_name, permissions: row.permissions })),
        after: grants,
      }],
    );
    const result = await client.query("SELECT * FROM organization_access_grants WHERE organization_id=$1 ORDER BY resource_name,resource_ref", [organization.id]);
    return { grants: result.rows.map(publicGrant), capabilities: catalogForType(organization.organization_type), resources: resourceCatalogForType(organization.organization_type) };
  });
}

export async function assertResourcePermission(client, organizationId, resourceType, resourceRef, permission) {
  const result = await client.query(
    `SELECT 1 FROM organization_access_grants
      WHERE organization_id=$1 AND resource_type=$2 AND resource_ref=$3 AND permissions ? $4`,
    [organizationId, resourceType, resourceRef, permission],
  );
  if (!result.rows[0]) fail("该组织尚未获得此资源或业务能力。", 403, "resource_not_granted");
}

export function workItemViewPermission(itemType) {
  if (String(itemType).startsWith("warehouse_")) return "warehouse.task.view";
  return {
    filing_task: "filing.task.view",
    sampling_task: "sampling.task.view",
    packaging_quote: "packaging.quote.view",
    production_order: "production.order.view",
  }[itemType] || "";
}

export function workItemResource(item) {
  if (String(item.item_type).startsWith("warehouse_")) return { resourceType: "warehouse", resourceRef: String(item.public_payload?.warehouseRef || "") };
  const resourceRef = { filing_task: "filing", sampling_task: "sampling", packaging_quote: "packaging_quote", production_order: "production" }[item.item_type] || "";
  return { resourceType: "organization", resourceRef };
}

export async function assertWorkItemPermission(client, organizationId, item, permission = workItemViewPermission(item.item_type)) {
  const resource = workItemResource(item);
  if (!resource.resourceRef || !permission) fail("任务缺少可验证的资源范围。", 403, "resource_not_granted");
  await assertResourcePermission(client, organizationId, resource.resourceType, resource.resourceRef, permission);
}

export function actionPermission(itemType, action) {
  if (String(itemType).startsWith("warehouse_")) return {
    accept: "warehouse.task.handle",
    progress: "warehouse.task.handle",
    report_exception: "warehouse.exception.report",
    inbound_confirm: "warehouse.inbound.confirm",
    outbound_confirm: "warehouse.outbound.confirm",
    transfer_receive: "warehouse.transfer.receive",
    inventory_adjustment: "warehouse.inventory.adjust.request",
    complete: "warehouse.task.complete",
  }[action] || "";
  if (itemType === "filing_task") return ["accept", "progress", "complete"].includes(action) ? "filing.task.handle" : "";
  if (itemType === "sampling_task") return ["accept", "progress", "complete"].includes(action) ? "sampling.task.handle" : "";
  if (itemType === "production_order") return ["accept", "progress", "report_exception", "complete"].includes(action) ? "production.progress.update" : "";
  return "";
}

export const workItemAccessPredicate = `(
  (work_items.item_type LIKE 'warehouse_%' AND EXISTS (
    SELECT 1 FROM organization_access_grants access_grant
     WHERE access_grant.organization_id=work_items.organization_id
       AND access_grant.resource_type='warehouse'
       AND access_grant.resource_ref=work_items.public_payload->>'warehouseRef'
       AND access_grant.permissions ? 'warehouse.task.view'
  )) OR
  (work_items.item_type='filing_task' AND EXISTS (SELECT 1 FROM organization_access_grants access_grant WHERE access_grant.organization_id=work_items.organization_id AND access_grant.resource_type='organization' AND access_grant.resource_ref='filing' AND access_grant.permissions ? 'filing.task.view')) OR
  (work_items.item_type='sampling_task' AND EXISTS (SELECT 1 FROM organization_access_grants access_grant WHERE access_grant.organization_id=work_items.organization_id AND access_grant.resource_type='organization' AND access_grant.resource_ref='sampling' AND access_grant.permissions ? 'sampling.task.view')) OR
  (work_items.item_type='packaging_quote' AND EXISTS (SELECT 1 FROM organization_access_grants access_grant WHERE access_grant.organization_id=work_items.organization_id AND access_grant.resource_type='organization' AND access_grant.resource_ref='packaging_quote' AND access_grant.permissions ? 'packaging.quote.view')) OR
  (work_items.item_type='production_order' AND EXISTS (SELECT 1 FROM organization_access_grants access_grant WHERE access_grant.organization_id=work_items.organization_id AND access_grant.resource_type='organization' AND access_grant.resource_ref='production' AND access_grant.permissions ? 'production.order.view'))
)`;
