import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkspace } from "../api/workspace.js";

const productionAuth = {
  organization: { id: "0f282180-17bd-4f0e-8798-760e036dc407", type: "production_factory" },
  membership: { role: "manager", permissions: [] },
};

test("production supplier has no warehouse module without an exact warehouse grant", () => {
  const workspace = buildWorkspace(productionAuth, [{
    resource_type: "organization",
    resource_ref: "production",
    resource_name: "委外加工单",
    permissions: ["production.order.view", "production.progress.update"],
  }]);

  assert.ok(workspace.modules.includes("production"));
  assert.ok(workspace.taskTypes.includes("production_order"));
  assert.ok(!workspace.modules.includes("inventory"));
  assert.ok(!workspace.modules.includes("warehouse_tasks"));
  assert.deepEqual(workspace.resources.map((resource) => resource.key), ["organization:production"]);
});

test("warehouse grants add a separate consignment warehouse workspace to a supplier", () => {
  const workspace = buildWorkspace(productionAuth, [
    {
      resource_type: "organization",
      resource_ref: "production",
      resource_name: "委外加工单",
      permissions: ["production.order.view", "production.progress.update"],
    },
    {
      resource_type: "warehouse",
      resource_ref: "cn-songyu",
      resource_name: "松雨寄存仓",
      permissions: [
        "warehouse.inventory.view",
        "warehouse.task.view",
        "warehouse.task.handle",
        "warehouse.inbound.confirm",
        "warehouse.exception.report",
      ],
    },
  ]);

  assert.ok(workspace.modules.includes("production"));
  assert.ok(workspace.modules.includes("inventory"));
  assert.ok(workspace.modules.includes("warehouse_tasks"));
  assert.ok(workspace.taskTypes.includes("production_order"));
  assert.ok(workspace.taskTypes.includes("warehouse_inbound"));
  assert.ok(workspace.actions.includes("warehouse.inbound.confirm"));
  assert.deepEqual(workspace.resources.find((resource) => resource.resourceRef === "cn-songyu"), {
    key: "warehouse:cn-songyu",
    resourceType: "warehouse",
    resourceRef: "cn-songyu",
    resourceName: "松雨寄存仓",
    permissions: [
      "warehouse.inventory.view",
      "warehouse.task.view",
      "warehouse.task.handle",
      "warehouse.inbound.confirm",
      "warehouse.exception.report",
    ],
  });
});

test("inventory visibility alone does not imply warehouse task visibility", () => {
  const workspace = buildWorkspace(productionAuth, [{
    resource_type: "warehouse",
    resource_ref: "cn-view-only",
    resource_name: "只读寄存仓",
    permissions: ["warehouse.inventory.view"],
  }]);

  assert.ok(workspace.modules.includes("inventory"));
  assert.ok(!workspace.modules.includes("warehouse_tasks"));
  assert.ok(!workspace.taskTypes.some((type) => type.startsWith("warehouse_")));
});

test("organization administrators receive member management without widening resource access", () => {
  const workspace = buildWorkspace({ ...productionAuth, membership: { role: "organization_admin", permissions: [] } }, []);
  assert.ok(workspace.modules.includes("members"));
  assert.ok(!workspace.modules.includes("inventory"));
  assert.deepEqual(workspace.resources, []);
});
