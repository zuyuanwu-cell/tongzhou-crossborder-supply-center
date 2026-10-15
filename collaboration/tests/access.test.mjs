import test from "node:test";
import assert from "node:assert/strict";
import { organizationAccessCatalog, validateGrantForOrganization } from "../api/access.js";

function organization(organizationType) {
  return { organization_type: organizationType };
}

const warehouseGrant = {
  resourceType: "warehouse",
  resourceRef: "supplier-hold-warehouse",
  resourceName: "供应商寄存仓",
  permissions: ["warehouse.inventory.view", "warehouse.task.view", "warehouse.inbound.confirm"],
};

test("warehouse resources are opt-in for the supported supplier roles", () => {
  for (const type of ["warehouse", "production_factory", "material_supplier", "packaging_factory"]) {
    const catalog = organizationAccessCatalog(type);
    assert.equal(catalog.supportsWarehouseResources, true);
    assert.ok(catalog.warehouseCapabilities.some((capability) => capability.key === "warehouse.inventory.view"));
    assert.deepEqual(validateGrantForOrganization(organization(type), warehouseGrant).permissions, warehouseGrant.permissions);
  }
});

test("filing and sampling-only organizations cannot receive warehouse resources", () => {
  for (const type of ["filing_service", "sampling_factory", "internal"]) {
    assert.equal(organizationAccessCatalog(type).supportsWarehouseResources, false);
    assert.throws(
      () => validateGrantForOrganization(organization(type), warehouseGrant),
      (error) => error?.code === "invalid_resource_type",
    );
  }
});

test("warehouse resources reject business permissions and organization resources reject warehouse permissions", () => {
  assert.throws(
    () => validateGrantForOrganization(organization("production_factory"), { ...warehouseGrant, permissions: ["production.order.view"] }),
    (error) => error?.code === "invalid_permission",
  );
  assert.throws(
    () => validateGrantForOrganization(organization("production_factory"), {
      resourceType: "organization",
      resourceRef: "production",
      resourceName: "委外生产",
      permissions: ["warehouse.inventory.view"],
    }),
    (error) => error?.code === "invalid_permission",
  );
});
