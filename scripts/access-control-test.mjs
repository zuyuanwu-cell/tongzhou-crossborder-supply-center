import assert from "node:assert/strict";
import { effectivePermissions, projectCatalogProduct, projectProductBase, sanitizePermissionUpdate } from "../server/access-control.js";
import { projectMovementPayload, scopeMovementSources } from "../server/movement-access.js";
import { createLocalUser, publicUser } from "../server/user-auth.js";

const distributor = {
  id: "dist-1",
  username: "partner",
  role: "distributor",
  permissionOverrides: { allow: ["direct_price", "movement"], deny: [] },
  dataScopes: { countries: ["印度尼西亚"], warehouseIds: ["wh-id"], skus: ["SKU-A"] },
  notificationTeamId: "team-a",
  wecomUserId: "partner_01",
  mentionOnProgress: true,
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
assert.equal(distributorPerformancePermissions.includes("inventory_value"), false, "a distributor can never receive warehouse value access");
assert.equal(effectivePermissions({ role: "admin" }).includes("inventory_value"), true, "administrators can view warehouse value by default");
assert.equal(effectivePermissions({ role: "direct", permissionOverrides: { allow: ["inventory_value"], deny: [] } }).includes("inventory_value"), true, "authorized operators can be granted warehouse value access");

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
assert.equal(publicDistributor.notificationTeamId, "team-a");
assert.equal(publicDistributor.wecomUserId, "partner_01");
assert.equal(publicDistributor.mentionOnProgress, true);

const directDenied = effectivePermissions({ role: "direct", permissionOverrides: { allow: [], deny: ["direct_price"] } });
assert.equal(directDenied.includes("direct_price"), false, "explicit deny overrides a role default");

const directMiaoshouPermissions = effectivePermissions({ role: "direct", permissionOverrides: { allow: [], deny: [] } });
assert.equal(directMiaoshouPermissions.includes("warehouse_return_query"), true, "direct operators can query scoped WMS returns by default");
assert.equal(directMiaoshouPermissions.includes("miaoshou_alias"), true, "direct operators can match order aliases by default");
assert.equal(directMiaoshouPermissions.includes("miaoshou_listing"), false, "AI listing requires an explicit grant");
assert.equal(directMiaoshouPermissions.includes("miaoshou_automation"), false, "waybill automation requires an explicit grant");
assert.equal(directMiaoshouPermissions.includes("miaoshou_config"), false, "connection configuration requires an explicit grant");
assert.equal(directMiaoshouPermissions.includes("ozon_orders"), true, "direct operators can view and sync Ozon orders by default");
assert.equal(directMiaoshouPermissions.includes("ozon_order_push"), true, "direct operators can review and push Ozon orders by default");
assert.equal(directMiaoshouPermissions.includes("ozon_config"), false, "Ozon store credentials and mappings remain administrator-only by default");

const legacyMiaoshouOperator = effectivePermissions({
  role: "direct",
  permissionOverrides: { allow: ["miaoshou"], deny: [] },
});
assert.equal(legacyMiaoshouOperator.includes("miaoshou_alias"), true, "legacy Miaoshou access keeps alias matching available");
assert.equal(legacyMiaoshouOperator.includes("miaoshou_config"), false, "legacy non-manager access does not gain connection configuration");

const legacyMiaoshouManager = effectivePermissions({
  role: "direct",
  permissionOverrides: { allow: ["miaoshou", "operations"], deny: ["miaoshou_config"] },
});
assert.equal(legacyMiaoshouManager.includes("miaoshou_listing"), true, "legacy managers retain AI listing access");
assert.equal(legacyMiaoshouManager.includes("miaoshou_automation"), true, "legacy managers retain waybill automation access");
assert.equal(legacyMiaoshouManager.includes("miaoshou_config"), false, "a granular deny overrides the legacy umbrella");
assert.equal(legacyMiaoshouManager.includes("operations"), false, "legacy direct managers no longer retain global operations access");
assert.equal(legacyMiaoshouManager.includes("product_sync"), true, "legacy direct managers retain product sync through a scoped permission");

const directStockupViewer = effectivePermissions({
  role: "direct",
  permissionOverrides: { allow: ["production_view"], deny: [] },
});
assert.equal(directStockupViewer.includes("production_view"), true, "direct operators can receive production view access");
assert.equal(directStockupViewer.includes("production_sync"), false, "production view does not imply refresh access");
assert.equal(directStockupViewer.includes("stockup_recommendations_view"), false, "stockup pages can be granted independently");

const savedDirectProductionOverrides = sanitizePermissionUpdate("direct", {
  allow: ["production_view", "production_sync"],
  deny: [],
});
const savedDirectProductionPermissions = effectivePermissions({
  role: "direct",
  permissionOverrides: savedDirectProductionOverrides,
});
assert.equal(savedDirectProductionPermissions.includes("production_view"), true, "saved direct production access remains visible after permission normalization");
assert.equal(savedDirectProductionPermissions.includes("production_sync"), true, "saved direct production refresh access remains available after permission normalization");

const directStockupOperator = effectivePermissions({
  role: "direct",
  permissionOverrides: { allow: ["stockup_execution_manage"], deny: ["stockup_execution_view"] },
});
assert.equal(directStockupOperator.includes("stockup_execution_manage"), true, "direct operators can receive stockup execution operations");
assert.equal(directStockupOperator.includes("stockup_execution_view"), true, "stockup operation access always includes the matching page view");

const legacyStockupViewer = effectivePermissions({
  role: "direct",
  permissionOverrides: { allow: ["stockup"], deny: [] },
});
assert.equal(legacyStockupViewer.includes("stockup_workflow_view"), true, "legacy stockup access migrates to workflow view");
assert.equal(legacyStockupViewer.includes("stockup_recommendations_view"), true, "legacy stockup access migrates to recommendation view");
assert.equal(legacyStockupViewer.includes("stockup_execution_view"), true, "legacy stockup access migrates to execution view");
assert.equal(legacyStockupViewer.includes("production_view"), true, "legacy stockup access migrates to production view");
assert.equal(legacyStockupViewer.some((permission) => permission.endsWith("_manage") || permission === "production_sync"), false, "legacy read-only stockup access does not gain write access");

const legacyStockupManager = effectivePermissions({
  role: "direct",
  permissionOverrides: { allow: ["stockup", "operations"], deny: [] },
});
assert.equal(legacyStockupManager.includes("stockup_workflow_manage"), true, "legacy stockup managers retain workflow operations");
assert.equal(legacyStockupManager.includes("stockup_recommendations_manage"), true, "legacy stockup managers retain recommendation operations");
assert.equal(legacyStockupManager.includes("stockup_execution_manage"), true, "legacy stockup managers retain execution operations");
assert.equal(legacyStockupManager.includes("production_sync"), true, "legacy stockup managers retain production refresh access");
assert.equal(legacyStockupManager.includes("operations"), false, "legacy stockup managers are migrated away from global operations");

const directSyncOperator = effectivePermissions({
  role: "direct",
  permissionOverrides: { allow: ["product_sync", "order_sync_run", "inventory_sync_run"], deny: [] },
});
assert.equal(directSyncOperator.includes("product_sync"), true, "direct operators can receive product sync access");
assert.equal(directSyncOperator.includes("order_sync_run"), true, "direct operators can receive order sync access");
assert.equal(directSyncOperator.includes("inventory_sync_run"), true, "direct operators can receive inventory sync access");
assert.equal(directSyncOperator.includes("operations"), false, "module sync access does not require global operations");
assert.equal(effectivePermissions({ role: "direct", permissionOverrides: { allow: ["movement_sync"], deny: [] } }).includes("order_sync_run"), true, "existing movement sync grants continue to permit order synchronization");

const directAnalyticsManager = effectivePermissions({
  role: "direct",
  permissionOverrides: { allow: ["inventory_value_manage", "order_analysis_manage", "performance_manage"], deny: ["inventory_value", "order_analysis", "performance_analysis"] },
});
assert.equal(directAnalyticsManager.includes("inventory_value"), true, "warehouse value maintenance implies warehouse value view");
assert.equal(directAnalyticsManager.includes("order_analysis"), true, "order analysis maintenance implies order analysis view");
assert.equal(directAnalyticsManager.includes("performance_analysis"), true, "performance maintenance implies performance analysis view");

const distributorMiaoshouPermissions = effectivePermissions({
  role: "distributor",
  permissionOverrides: { allow: ["miaoshou", "miaoshou_alias", "miaoshou_listing", "miaoshou_automation", "miaoshou_config", "operations"], deny: [] },
});
assert.equal(distributorMiaoshouPermissions.some((permission) => permission === "miaoshou" || permission.startsWith("miaoshou_")), false, "distributors cannot receive internal Miaoshou permissions");
assert.equal(effectivePermissions({ role: "distributor", permissionOverrides: { allow: ["ozon_orders", "ozon_order_push", "ozon_config"], deny: [] } }).some((permission) => permission.startsWith("ozon_")), false, "distributors cannot receive Ozon order permissions");
assert.equal(effectivePermissions({ role: "distributor", permissionOverrides: { allow: ["production_view", "stockup_recommendations_view", "product_sync"], deny: [] } }).some((permission) => permission.startsWith("stockup_") || permission === "production_view" || permission === "product_sync"), false, "distributors cannot receive internal stockup or sync permissions");

const warehousePermissions = effectivePermissions({
  role: "warehouse",
  permissionOverrides: { allow: ["after_sales_report", "warehouse_return_query", "inventory_value", "product_view", "users"], deny: [] },
});
assert.deepEqual(warehousePermissions, ["after_sales_warehouse", "warehouse_ticket_warehouse"], "warehouse operators are isolated to warehouse collaboration workspaces");
assert.equal(warehousePermissions.includes("warehouse_return_query"), false, "warehouse operators cannot query WMS return data");
assert.equal(warehousePermissions.some((permission) => permission.startsWith("ozon_")), false, "warehouse operators cannot access Ozon credentials or order queues");
assert.equal(publicUser({ id: "wh-1", username: "warehouse", role: "warehouse" }).roleLabel, "仓库操作员");
assert.throws(() => createLocalUser({
  username: "warehouse-empty",
  password: "test1234",
  displayName: "未绑定仓库账号",
  role: "warehouse",
  dataScopes: { countries: [], warehouseIds: [], skus: [] },
}), /至少绑定一个仓库/, "warehouse accounts must never be created with an unrestricted empty warehouse scope");
const scopedWarehouseUser = createLocalUser({
  username: "warehouse-scoped",
  password: "test1234",
  displayName: "印尼仓账号",
  role: "warehouse",
  dataScopes: { countries: [], warehouseIds: ["wh-id"], skus: [] },
});
assert.deepEqual(scopedWarehouseUser.dataScopes.warehouseIds, ["wh-id"]);

console.log("access-control tests passed");
