import assert from "node:assert/strict";
import { effectivePermissions, projectCatalogProduct, projectProductBase } from "../server/access-control.js";
import { projectMovementPayload, scopeMovementSources } from "../server/movement-access.js";
import { publicUser } from "../server/user-auth.js";

const distributor = {
  id: "dist-1",
  username: "partner",
  role: "distributor",
  permissionOverrides: { allow: ["direct_price", "movement"], deny: [] },
  dataScopes: { countries: ["印度尼西亚"], warehouseIds: ["wh-id"], skus: ["SKU-A"] },
};

const distributorPermissions = effectivePermissions(distributor);
assert.equal(distributorPermissions.includes("movement"), true, "a distributor can be granted movement access");
assert.equal(distributorPermissions.includes("direct_price"), false, "a distributor can never be granted direct price access");
assert.equal(effectivePermissions({ role: "direct", permissionOverrides: { allow: ["users"], deny: [] } }).includes("users"), false, "non-admin roles cannot grant themselves user administration");

const distributorPerformancePermissions = effectivePermissions({
  role: "distributor",
  permissionOverrides: {
    allow: ["performance_analysis", "performance_revenue", "performance_cost", "performance_profit"],
    deny: [],
  },
});
assert.equal(distributorPerformancePermissions.includes("performance_analysis"), true, "a distributor can be granted performance analysis");
assert.equal(distributorPerformancePermissions.includes("performance_revenue"), true, "a distributor can be granted performance revenue");
assert.equal(distributorPerformancePermissions.includes("performance_cost"), false, "a distributor can never be granted performance cost");
assert.equal(distributorPerformancePermissions.includes("performance_profit"), false, "a distributor can never be granted performance profit");

const projectedProduct = projectCatalogProduct({
  id: "p-1",
  sku: "SKU-A",
  country: "印度尼西亚",
  channel: "分销",
  distributionPrice: 10,
  distributionCurrency: "USD",
  salesPrice: 12,
  salesCurrency: "USD",
  directPrice: 8,
  directCurrency: "USD",
  directCostPrice: 7,
  raw: { secret: true },
}, distributor);
assert.equal(projectedProduct.distributionPrice, 10);
assert.equal("directPrice" in projectedProduct, false);
assert.equal("directCostPrice" in projectedProduct, false);
assert.equal("raw" in projectedProduct, false);

const hiddenCostProduct = projectProductBase({
  sku: "SKU-A",
  latestCostBatchId: "CB-1",
  latestLandedUnitCostCny: 12.5,
  latestCostEffectiveAt: "2026-08-20",
}, distributor);
assert.equal("latestCostBatchId" in hiddenCostProduct, false);
assert.equal("latestLandedUnitCostCny" in hiddenCostProduct, false);
assert.equal("latestCostEffectiveAt" in hiddenCostProduct, false);

const visibleCostProduct = projectProductBase({
  sku: "SKU-A",
  latestCostBatchId: "CB-1",
  latestLandedUnitCostCny: 12.5,
  latestCostEffectiveAt: "2026-08-20",
}, {
  role: "direct",
  permissionOverrides: { allow: ["performance_cost"], deny: [] },
});
assert.equal(visibleCostProduct.latestLandedUnitCostCny, 12.5);

const inventoryDeniedProduct = projectCatalogProduct({ stockQty: 5, status: "在售", alert: "健康" }, {
  role: "distributor",
  permissionOverrides: { allow: [], deny: ["inventory"] },
});
assert.equal("stockQty" in inventoryDeniedProduct, false);
assert.equal("status" in inventoryDeniedProduct, false);
assert.equal("alert" in inventoryDeniedProduct, false);

const scoped = scopeMovementSources({
  products: {
    catalog: [
      { sku: "SKU-A", country: "印度尼西亚" },
      { sku: "SKU-B", country: "印度尼西亚" },
      { sku: "SKU-A", country: "马来西亚" },
    ],
    productBase: [{ sku: "SKU-A" }, { sku: "SKU-B" }],
  },
  warehouse: {
    products: [],
    inventory: [
      { warehouseId: "wh-id", sku: "SKU-A", country: "印度尼西亚", availableQty: 5 },
      { warehouseId: "wh-id", sku: "SKU-B", country: "印度尼西亚", availableQty: 9 },
      { warehouseId: "wh-my", sku: "SKU-A", country: "马来西亚", availableQty: 7 },
    ],
    results: [{ warehouseId: "wh-id" }, { warehouseId: "wh-my" }],
  },
  orders: {
    orders: [
      { warehouseId: "wh-id", sku: "SKU-A", country: "印度尼西亚", quantity: 2 },
      { warehouseId: "wh-id", sku: "SKU-B", country: "印度尼西亚", quantity: 3 },
    ],
    results: [{ warehouseId: "wh-id" }, { warehouseId: "wh-my" }],
  },
  connections: [
    { id: "wh-id", country: "印度尼西亚" },
    { id: "wh-my", country: "马来西亚" },
  ],
}, distributor);
assert.equal(scoped.products.catalog.length, 1);
assert.equal(scoped.products.productBase.length, 1);
assert.equal(scoped.warehouse.inventory.length, 1);
assert.equal(scoped.orders.orders.length, 1);
assert.equal(scoped.connections.length, 1);

const salesOnlyUser = {
  role: "distributor",
  permissionOverrides: { allow: ["movement"], deny: [] },
};
const projectedMovement = projectMovementPayload({
  items: [{
    sku: "SKU-A",
    sales30: 4,
    sales90: 10,
    availableQty: 20,
    totalQty: 25,
    daysCover: 30,
    replenishQty: 5,
    status: "健康",
    warehouseBreakdown: [{ warehouseId: "wh-id", availableQty: 20 }],
  }],
  orderSyncResults: [{ ok: true }],
  syncState: { usingCachedOrders: true },
}, salesOnlyUser);
assert.equal(projectedMovement.items[0].status, "有动销");
assert.equal("availableQty" in projectedMovement.items[0], false);
assert.equal("warehouseBreakdown" in projectedMovement.items[0], false);
assert.equal("syncState" in projectedMovement, false);

const publicDistributor = publicUser(distributor);
assert.equal(publicDistributor.permissions.includes("direct_price"), false);
assert.deepEqual(publicDistributor.dataScopes.skus, ["SKU-A"]);

const directDenied = effectivePermissions({ role: "direct", permissionOverrides: { allow: [], deny: ["direct_price"] } });
assert.equal(directDenied.includes("direct_price"), false, "explicit deny overrides a role default");

const warehousePermissions = effectivePermissions({
  role: "warehouse",
  permissionOverrides: { allow: ["after_sales_report", "product_view", "users"], deny: [] },
});
assert.deepEqual(warehousePermissions, ["after_sales_warehouse"], "warehouse operators are isolated to the warehouse after-sales workspace");
assert.equal(publicUser({ id: "wh-1", username: "warehouse", role: "warehouse" }).roleLabel, "仓库操作员");

console.log("access-control tests passed");
