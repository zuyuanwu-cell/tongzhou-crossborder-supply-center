const permissionDefinitions = [
  ["dashboard", "经营总览", "运营分析"],
  ["inventory_sync", "库存同步看板", "运营分析"],
  ["inventory_sync_run", "执行库存同步", "数据同步操作"],
  ["inventory_snapshots", "库存快照", "运营分析"],
  ["inventory_snapshot_manage", "生成与删除库存快照", "运营分析操作"],
  ["inventory_value", "仓库货值", "运营分析"],
  ["inventory_value_manage", "维护仓库货值成本", "运营分析操作"],
  ["order_analysis", "订单分析", "运营分析"],
  ["order_analysis_manage", "维护订单分析设置", "运营分析操作"],
  ["performance_analysis", "经营贡献分析", "运营分析"],
  ["performance_revenue", "经营销售金额", "经营分析字段"],
  ["performance_cost", "经营成本", "经营分析字段"],
  ["performance_profit", "经营预估利润", "经营分析字段"],
  ["performance_manage", "维护经营分析规则", "运营分析操作"],
  ["movement", "动销监控", "动销"],
  ["movement_analysis", "动销分析", "动销"],
  ["movement_inventory", "动销库存数据", "动销"],
  ["movement_warehouse", "动销仓库明细", "动销"],
  ["movement_export", "动销数据导出", "动销"],
  ["movement_sync", "动销数据同步", "动销"],
  ["order_sync_run", "执行订单同步", "数据同步操作"],
  ["product_sync", "执行产品同步", "数据同步操作"],
  ["qualification_sync", "执行资质同步", "数据同步操作"],
  ["asset_sync", "执行素材同步", "数据同步操作"],
  ["warehouse_info_sync", "执行仓库信息同步", "数据同步操作"],
  ["stockup_workflow_view", "备货业务链查看", "备货协同"],
  ["stockup_workflow_manage", "备货需求、编码与成本维护", "备货协同"],
  ["stockup_recommendations_view", "备货建议查看", "备货协同"],
  ["stockup_recommendations_manage", "备货建议处理", "备货协同"],
  ["stockup_execution_view", "备货执行查看", "备货协同"],
  ["stockup_execution_manage", "备货执行操作", "备货协同"],
  ["production_view", "生产中心查看", "备货协同"],
  ["production_sync", "生产数据刷新", "备货协同"],
  ["after_sales_report", "售后运营填报", "仓库协同"],
  ["after_sales_warehouse", "售后仓库处理", "仓库协同"],
  ["warehouse_return_query", "WMS退货查询", "仓库协同"],
  ["warehouse_ticket_report", "仓库工单提交", "仓库协同"],
  ["warehouse_ticket_warehouse", "仓库工单处理", "仓库协同"],
  ["product_view", "产品库", "商品与协同"],
  ["distribution_price", "分销价", "产品字段"],
  ["sales_price", "销售价", "产品字段"],
  ["direct_price", "直营价", "产品字段"],
  ["inventory", "产品库存", "产品字段"],
  ["qualifications", "资质库", "商品与协同"],
  ["assets", "素材库", "商品与协同"],
  ["warehouse_info", "仓库信息", "商品与协同"],
  ["quick_nav", "快捷导航", "智能与开放"],
  ["tongzhou_ai", "同舟 AI", "智能与开放"],
  ["api_access", "API 接入", "智能与开放"],
  ["miaoshou_alias", "妙手订单别名匹配", "妙手 ERP"],
  ["miaoshou_listing", "妙手 AI 上架", "妙手 ERP"],
  ["miaoshou_automation", "妙手自动运单", "妙手 ERP"],
  ["miaoshou_config", "妙手连接配置", "妙手 ERP"],
  ["ozon_orders", "Ozon 订单查看与同步", "Ozon 订单"],
  ["ozon_order_push", "Ozon 订单审核推单", "Ozon 订单"],
  ["ozon_config", "Ozon 店铺与映射配置", "Ozon 订单"],
  ["warehouses", "仓库授权", "系统管理"],
  ["users", "用户与权限", "系统管理"],
  ["notifications", "企业微信通知", "系统管理"],
  ["action_log", "操作日志", "系统管理"],
  ["operations", "全局同步与管理操作", "系统管理"],
];

export const PERMISSION_CATALOG = Object.freeze(permissionDefinitions.map(([key, label, group]) => ({ key, label, group })));
const LEGACY_PERMISSION_KEYS = Object.freeze(["miaoshou", "stockup"]);
const MIAOSHOU_PERMISSION_KEYS = Object.freeze([
  "miaoshou_alias",
  "miaoshou_listing",
  "miaoshou_automation",
  "miaoshou_config",
]);
const OZON_PERMISSION_KEYS = Object.freeze(["ozon_orders", "ozon_order_push", "ozon_config"]);
export const STOCKUP_VIEW_PERMISSION_KEYS = Object.freeze([
  "stockup_workflow_view",
  "stockup_recommendations_view",
  "stockup_execution_view",
  "production_view",
]);
export const STOCKUP_MANAGE_PERMISSION_KEYS = Object.freeze([
  "stockup_workflow_manage",
  "stockup_recommendations_manage",
  "stockup_execution_manage",
  "production_sync",
]);
const STOCKUP_PERMISSION_KEYS = Object.freeze([...STOCKUP_VIEW_PERMISSION_KEYS, ...STOCKUP_MANAGE_PERMISSION_KEYS]);
const INTERNAL_SYNC_PERMISSION_KEYS = Object.freeze([
  "inventory_sync_run",
  "order_sync_run",
  "product_sync",
  "qualification_sync",
  "asset_sync",
  "warehouse_info_sync",
]);
const INTERNAL_ANALYSIS_MANAGE_PERMISSION_KEYS = Object.freeze([
  "inventory_snapshot_manage",
  "inventory_value_manage",
  "order_analysis_manage",
  "performance_manage",
]);
export const PERMISSION_KEYS = Object.freeze([...PERMISSION_CATALOG.map((item) => item.key), ...LEGACY_PERMISSION_KEYS]);
const permissionKeySet = new Set(PERMISSION_KEYS);

export const ROLE_DEFAULT_PERMISSIONS = Object.freeze({
  admin: Object.freeze(PERMISSION_CATALOG.map((item) => item.key)),
  direct: Object.freeze([
    "product_view",
    "distribution_price",
    "sales_price",
    "direct_price",
    "inventory",
    "qualifications",
    "assets",
    "warehouse_info",
    "after_sales_report",
    "warehouse_return_query",
    "warehouse_ticket_report",
    "quick_nav",
    "tongzhou_ai",
    "api_access",
    "miaoshou_alias",
    "ozon_orders",
    "ozon_order_push",
  ]),
  warehouse: Object.freeze([
    "after_sales_warehouse",
    "warehouse_ticket_warehouse",
  ]),
  distributor: Object.freeze([
    "product_view",
    "distribution_price",
    "sales_price",
    "inventory",
    "qualifications",
    "assets",
    "warehouse_info",
    "quick_nav",
    "tongzhou_ai",
    "api_access",
  ]),
  guest: Object.freeze(["product_view", "quick_nav", "tongzhou_ai"]),
});

const REQUIRED_ADMIN_PERMISSIONS = new Set(["operations", "users"]);
const DIRECT_PRICE_DENIED_ROLES = new Set(["distributor", "guest"]);
const PERFORMANCE_COST_DENIED_ROLES = new Set(["distributor", "guest"]);
const SYSTEM_MANAGEMENT_DENIED_ROLES = new Set(["direct", "warehouse", "distributor", "guest"]);
const WAREHOUSE_COLLABORATION_DENIED_ROLES = new Set(["distributor", "guest"]);
const MIAOSHOU_DENIED_ROLES = new Set(["distributor", "guest"]);
const OZON_DENIED_ROLES = new Set(["distributor", "guest"]);
const STOCKUP_DENIED_ROLES = new Set(["distributor", "guest"]);
const INTERNAL_SYNC_DENIED_ROLES = new Set(["distributor", "guest"]);
const WAREHOUSE_ALLOWED_PERMISSIONS = new Set(["after_sales_warehouse", "warehouse_ticket_warehouse"]);

function roleOf(user) {
  return ["admin", "direct", "warehouse", "distributor"].includes(user?.role) ? user.role : "guest";
}

function uniqueStrings(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)));
}

export function normalizePermissionOverrides(value) {
  const allow = uniqueStrings(value?.allow).filter((key) => permissionKeySet.has(key));
  const deny = uniqueStrings(value?.deny).filter((key) => permissionKeySet.has(key));
  return { allow, deny };
}

function addPermission(values, permission) {
  if (!values.includes(permission)) values.push(permission);
}

export function migrateLegacyPermissionOverrides(role, value) {
  const overrides = normalizePermissionOverrides(value);
  const allowedLegacyMiaoshou = overrides.allow.includes("miaoshou");
  const allowedLegacyStockup = overrides.allow.includes("stockup");
  const deniedLegacyStockup = overrides.deny.includes("stockup");
  const hadGlobalOperations = overrides.allow.includes("operations") && !overrides.deny.includes("operations") && role !== "admin";
  const legacyEffective = new Set([...(ROLE_DEFAULT_PERMISSIONS[role] || []), ...overrides.allow]);
  if (hadGlobalOperations) {
    const legacyOperationMappings = [
      ["product_view", "product_sync"],
      ["qualifications", "qualification_sync"],
      ["assets", "asset_sync"],
      ["warehouse_info", "warehouse_info_sync"],
      ["inventory_sync", "inventory_sync_run"],
      ["inventory_snapshots", "inventory_snapshot_manage"],
      ["inventory_value", "inventory_value_manage"],
      ["order_analysis", "order_analysis_manage"],
      ["performance_analysis", "performance_manage"],
    ];
    for (const [viewPermission, operationPermission] of legacyOperationMappings) {
      if (legacyEffective.has(viewPermission)) addPermission(overrides.allow, operationPermission);
    }
  }
  if (overrides.allow.includes("movement_sync") && !overrides.deny.includes("movement_sync")) {
    addPermission(overrides.allow, "order_sync_run");
  }
  if (allowedLegacyMiaoshou && overrides.allow.includes("operations") && !overrides.deny.includes("operations") && role !== "admin") {
    // 旧版用 miaoshou + operations 表示妙手管理能力。迁移为妙手域内权限后，
    // 即可安全移除非管理员的全局 operations 权限。
    for (const permission of ["miaoshou_listing", "miaoshou_automation", "miaoshou_config"]) {
      addPermission(overrides.allow, permission);
    }
  }
  if (allowedLegacyStockup) {
    for (const permission of STOCKUP_VIEW_PERMISSION_KEYS) addPermission(overrides.allow, permission);
    // 历史上只有 stockup + operations 才能执行备货写操作。迁移时把这组能力
    // 收敛为备货域内的细权限，避免继续保留全局管理权。
    if (overrides.allow.includes("operations") && !overrides.deny.includes("operations") && role !== "admin") {
      for (const permission of STOCKUP_MANAGE_PERMISSION_KEYS) addPermission(overrides.allow, permission);
    }
  }
  if (deniedLegacyStockup) {
    for (const permission of STOCKUP_PERMISSION_KEYS) addPermission(overrides.deny, permission);
  }
  return overrides;
}

export function normalizeDataScopes(value) {
  return {
    countries: uniqueStrings(value?.countries),
    warehouseIds: uniqueStrings(value?.warehouseIds),
    skus: uniqueStrings(value?.skus).map((sku) => sku.toUpperCase()),
  };
}

export function effectivePermissions(user) {
  const role = roleOf(user);
  const overrides = sanitizePermissionUpdate(role, user?.permissionOverrides);
  const effective = new Set(ROLE_DEFAULT_PERMISSIONS[role] || ROLE_DEFAULT_PERMISSIONS.guest);
  for (const permission of overrides.allow) effective.add(permission);

  // 兼容历史“妙手 ERP”总权限：原先普通账号可使用别名匹配，只有同时具备
  // 全局管理权限的账号可以配置、上架和执行自动运单。细权限显式拒绝仍优先。
  if (effective.has("miaoshou")) {
    effective.add("miaoshou_alias");
    if (effective.has("operations")) {
      effective.add("miaoshou_listing");
      effective.add("miaoshou_automation");
      effective.add("miaoshou_config");
    }
  }
  if (effective.has("stockup")) {
    for (const permission of STOCKUP_VIEW_PERMISSION_KEYS) effective.add(permission);
  }
  for (const permission of overrides.deny) effective.delete(permission);

  if (DIRECT_PRICE_DENIED_ROLES.has(role)) effective.delete("direct_price");
  if (PERFORMANCE_COST_DENIED_ROLES.has(role)) {
    effective.delete("performance_cost");
    effective.delete("performance_profit");
    effective.delete("inventory_value");
  }
  if (SYSTEM_MANAGEMENT_DENIED_ROLES.has(role)) {
    effective.delete("users");
    effective.delete("operations");
  }
  if (WAREHOUSE_COLLABORATION_DENIED_ROLES.has(role)) {
    effective.delete("after_sales_report");
    effective.delete("after_sales_warehouse");
    effective.delete("warehouse_return_query");
    effective.delete("warehouse_ticket_report");
    effective.delete("warehouse_ticket_warehouse");
  }
  if (MIAOSHOU_DENIED_ROLES.has(role)) {
    effective.delete("miaoshou");
    for (const permission of MIAOSHOU_PERMISSION_KEYS) effective.delete(permission);
  }
  if (OZON_DENIED_ROLES.has(role)) {
    for (const permission of OZON_PERMISSION_KEYS) effective.delete(permission);
  }
  if (STOCKUP_DENIED_ROLES.has(role)) {
    effective.delete("stockup");
    for (const permission of STOCKUP_PERMISSION_KEYS) effective.delete(permission);
  }
  if (INTERNAL_SYNC_DENIED_ROLES.has(role)) {
    for (const permission of INTERNAL_SYNC_PERMISSION_KEYS) effective.delete(permission);
    for (const permission of INTERNAL_ANALYSIS_MANAGE_PERMISSION_KEYS) effective.delete(permission);
  }
  if (role === "warehouse") {
    for (const permission of [...effective]) {
      if (!WAREHOUSE_ALLOWED_PERMISSIONS.has(permission)) effective.delete(permission);
    }
  }
  if (role === "admin") {
    for (const permission of REQUIRED_ADMIN_PERMISSIONS) effective.add(permission);
  }
  return PERMISSION_KEYS.filter((key) => effective.has(key));
}

export function hasPermission(authOrUser, permission) {
  if (!permissionKeySet.has(permission)) return false;
  const user = authOrUser?.user || authOrUser;
  return effectivePermissions(user).includes(permission);
}

export function permissionConfiguration() {
  return {
    permissionCatalog: PERMISSION_CATALOG,
    roleDefaults: ROLE_DEFAULT_PERMISSIONS,
    hardRules: {
      directDenied: ["users", "operations"],
      warehouseDenied: PERMISSION_KEYS.filter((key) => !WAREHOUSE_ALLOWED_PERMISSIONS.has(key)),
      distributorDenied: ["direct_price", "performance_cost", "performance_profit", "inventory_value", "after_sales_report", "after_sales_warehouse", "warehouse_return_query", "warehouse_ticket_report", "warehouse_ticket_warehouse", "users", "operations", ...INTERNAL_SYNC_PERMISSION_KEYS, ...INTERNAL_ANALYSIS_MANAGE_PERMISSION_KEYS, ...STOCKUP_PERMISSION_KEYS, ...MIAOSHOU_PERMISSION_KEYS, ...OZON_PERMISSION_KEYS],
      guestDenied: ["direct_price", "performance_cost", "performance_profit", "inventory_value", "after_sales_report", "after_sales_warehouse", "warehouse_return_query", "warehouse_ticket_report", "warehouse_ticket_warehouse", "users", "operations", ...INTERNAL_SYNC_PERMISSION_KEYS, ...INTERNAL_ANALYSIS_MANAGE_PERMISSION_KEYS, ...STOCKUP_PERMISSION_KEYS, ...MIAOSHOU_PERMISSION_KEYS, ...OZON_PERMISSION_KEYS],
      adminRequired: Array.from(REQUIRED_ADMIN_PERMISSIONS),
    },
  };
}

export function sanitizePermissionUpdate(role, input) {
  const overrides = migrateLegacyPermissionOverrides(role, input);
  const permissionImplications = [
    ["inventory_snapshot_manage", "inventory_snapshots"],
    ["inventory_value_manage", "inventory_value"],
    ["order_analysis_manage", "order_analysis"],
    ["performance_manage", "performance_analysis"],
    ["stockup_workflow_manage", "stockup_workflow_view"],
    ["stockup_recommendations_manage", "stockup_recommendations_view"],
    ["stockup_execution_manage", "stockup_execution_view"],
    ["production_sync", "production_view"],
  ];
  for (const [operationPermission, viewPermission] of permissionImplications) {
    if (overrides.allow.includes(operationPermission) && !overrides.deny.includes(operationPermission)) {
      addPermission(overrides.allow, viewPermission);
      overrides.deny = overrides.deny.filter((permission) => permission !== viewPermission);
    }
  }
  if (DIRECT_PRICE_DENIED_ROLES.has(role)) {
    overrides.allow = overrides.allow.filter((key) => key !== "direct_price");
  }
  if (PERFORMANCE_COST_DENIED_ROLES.has(role)) {
    overrides.allow = overrides.allow.filter((key) => !["performance_cost", "performance_profit", "inventory_value"].includes(key));
  }
  if (SYSTEM_MANAGEMENT_DENIED_ROLES.has(role)) {
    overrides.allow = overrides.allow.filter((key) => !["users", "operations"].includes(key));
  }
  if (WAREHOUSE_COLLABORATION_DENIED_ROLES.has(role)) {
    overrides.allow = overrides.allow.filter((key) => !["after_sales_report", "after_sales_warehouse", "warehouse_return_query", "warehouse_ticket_report", "warehouse_ticket_warehouse"].includes(key));
  }
  if (MIAOSHOU_DENIED_ROLES.has(role)) {
    overrides.allow = overrides.allow.filter((key) => key !== "miaoshou" && !MIAOSHOU_PERMISSION_KEYS.includes(key));
  }
  if (OZON_DENIED_ROLES.has(role)) {
    overrides.allow = overrides.allow.filter((key) => !OZON_PERMISSION_KEYS.includes(key));
  }
  if (STOCKUP_DENIED_ROLES.has(role)) {
    overrides.allow = overrides.allow.filter((key) => key !== "stockup" && !STOCKUP_PERMISSION_KEYS.includes(key));
  }
  if (INTERNAL_SYNC_DENIED_ROLES.has(role)) {
    overrides.allow = overrides.allow.filter((key) => !INTERNAL_SYNC_PERMISSION_KEYS.includes(key) && !INTERNAL_ANALYSIS_MANAGE_PERMISSION_KEYS.includes(key));
  }
  if (role === "warehouse") {
    overrides.allow = overrides.allow.filter((key) => WAREHOUSE_ALLOWED_PERMISSIONS.has(key));
    overrides.deny = overrides.deny.filter((key) => WAREHOUSE_ALLOWED_PERMISSIONS.has(key));
  }
  if (role === "admin") {
    overrides.deny = overrides.deny.filter((key) => !REQUIRED_ADMIN_PERMISSIONS.has(key));
  }
  return overrides;
}

export function isWithinDataScope(item, dataScopes) {
  const scopes = normalizeDataScopes(dataScopes);
  const country = String(item?.country || "").trim();
  const skuValues = [item?.sku, item?.skuNo, item?.countrySku]
    .map((value) => String(value || "").trim().toUpperCase())
    .filter(Boolean);
  if (scopes.countries.length && !scopes.countries.includes(country)) return false;
  if (scopes.skus.length && !skuValues.some((sku) => scopes.skus.includes(sku))) return false;
  return true;
}

const directPriceFields = ["directPrice", "directCurrency", "directCostPrice", "directCostCurrency"];
const distributionPriceFields = ["distributionPrice", "distributionCurrency", "distributionCost", "distributionCostPrice", "distributionCostCurrency"];
const salesPriceFields = ["salesPrice", "salesCurrency"];
const inventoryFields = ["stockQty", "lockedQty", "inTransitQty", "warehouseTotalQty", "warehouseBreakdown", "warehouseSyncedAt", "dataGap", "status", "alert"];

function omitFields(value, fields) {
  const result = { ...value };
  for (const field of fields) delete result[field];
  return result;
}

export function projectCatalogProduct(product, user) {
  let result = omitFields(product, ["raw"]);
  if (!hasPermission(user, "direct_price")) result = omitFields(result, directPriceFields);
  if (!hasPermission(user, "distribution_price")) result = omitFields(result, distributionPriceFields);
  if (!hasPermission(user, "sales_price")) result = omitFields(result, salesPriceFields);
  if (!hasPermission(user, "inventory")) result = omitFields(result, inventoryFields);
  return result;
}

export function projectProductBase(product, user) {
  const sensitiveCostFields = ["latestCostBatchId", "latestLandedUnitCostCny", "latestCostEffectiveAt"];
  const projected = omitFields(product, ["raw"]);
  return hasPermission(user, "performance_cost") ? projected : omitFields(projected, sensitiveCostFields);
}
