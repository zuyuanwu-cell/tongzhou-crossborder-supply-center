import { withOrganization } from "./db.js";

const warehouseTaskTypes = ["warehouse_inbound", "warehouse_outbound", "warehouse_transfer", "warehouse_stockup", "warehouse_exception"];

function value(row, camel, snake) {
  return row?.[camel] ?? row?.[snake];
}

function addIf(target, condition, valueToAdd) {
  if (condition && !target.includes(valueToAdd)) target.push(valueToAdd);
}

export function buildWorkspace(auth, rawGrants = []) {
  const grants = rawGrants.map((grant) => ({
    key: `${value(grant, "resourceType", "resource_type")}:${value(grant, "resourceRef", "resource_ref")}`,
    resourceType: String(value(grant, "resourceType", "resource_type") || ""),
    resourceRef: String(value(grant, "resourceRef", "resource_ref") || ""),
    resourceName: String(value(grant, "resourceName", "resource_name") || value(grant, "resourceRef", "resource_ref") || ""),
    permissions: Array.isArray(grant.permissions) ? [...new Set(grant.permissions)] : [],
  }));
  const capabilities = [...new Set(grants.flatMap((grant) => grant.permissions))];
  const has = (permission) => capabilities.includes(permission);
  const modules = ["overview", "tasks", "notifications", "account"];
  const taskTypes = [];

  addIf(modules, has("production.order.view"), "production");
  addIf(taskTypes, has("production.order.view"), "production_order");
  addIf(modules, has("procurement.order.view"), "procurement");
  addIf(taskTypes, has("procurement.order.view"), "purchase_order");
  addIf(modules, has("sampling.task.view"), "sampling");
  addIf(taskTypes, has("sampling.task.view"), "sampling_task");
  addIf(modules, has("packaging.quote.view"), "packaging_quote");
  addIf(taskTypes, has("packaging.quote.view"), "packaging_quote");
  addIf(modules, has("filing.task.view"), "filing");
  addIf(taskTypes, has("filing.task.view"), "filing_task");
  addIf(modules, has("warehouse.inventory.view"), "inventory");
  addIf(modules, has("warehouse.inventory.view"), "qualification_coverage");
  addIf(modules, has("warehouse.task.view"), "warehouse_tasks");
  if (has("warehouse.task.view")) taskTypes.push(...warehouseTaskTypes);
  addIf(modules, auth?.membership?.role === "organization_admin", "members");

  return {
    modules,
    taskTypes: [...new Set(taskTypes)],
    actions: capabilities.filter((permission) => !permission.endsWith(".view")),
    capabilities,
    resources: grants,
  };
}

export async function workspaceForSession(auth) {
  return withOrganization(auth.organization.id, async (client) => {
    const result = await client.query(
      `SELECT resource_type,resource_ref,resource_name,permissions
         FROM organization_access_grants
        WHERE organization_id=$1
        ORDER BY resource_type,resource_name,resource_ref`,
      [auth.organization.id],
    );
    return buildWorkspace(auth, result.rows);
  });
}
