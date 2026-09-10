const permissionDefinitions = [
  ["dashboard", "经营总览", "运营分析"],
  ["inventory_sync", "库存同步看板", "运营分析"],
  ["inventory_snapshots", "库存快照", "运营分析"],
  ["order_analysis", "订单分析", "运营分析"],
  ["performance_analysis", "经营贡献分析", "运营分析"],
  ["performance_revenue", "经营销售金额", "经营分析字段"],
  ["performance_cost", "经营成本", "经营分析字段"],
  ["performance_profit", "经营预估利润", "经营分析字段"],
  ["movement", "动销监控", "动销"],
  ["movement_analysis", "动销分析", "动销"],
  ["movement_inventory", "动销库存数据", "动销"],
  ["movement_warehouse", "动销仓库明细", "动销"],
  ["movement_export", "动销数据导出", "动销"],
  ["movement_sync", "动销数据同步", "动销"],
  ["stockup", "备货中心", "商品与协同"],
  ["after_sales_report", "售后运营填报", "仓库协同"],
  ["after_sales_warehouse", "售后仓库处理", "仓库协同"],
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
  ["warehouses", "仓库授权", "系统管理"],
  ["users", "用户与权限", "系统管理"],
  ["notifications", "企业微信通知", "系统管理"],
  ["action_log", "操作日志", "系统管理"],
  ["operations", "全局同步与管理操作", "系统管理"],
];

export const PERMISSION_CATALOG = Object.freeze(permissionDefinitions.map(([key, label, group]) => ({ key, label, group })));
const LEGACY_PERMISSION_KEYS = Object.freeze(["miaoshou"]);
const MIAOSHOU_PERMISSION_KEYS = Object.freeze([
  "miaoshou_alias",
  "miaoshou_listing",
  "miaoshou_automation",
  "miaoshou_config",
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
    "warehouse_ticket_report",
    "quick_nav",
    "tongzhou_ai",
    "api_access",
    "miaoshou_alias",
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
const USER_MANAGEMENT_DENIED_ROLES = new Set(["direct", "distributor", "guest"]);
const WAREHOUSE_COLLABORATION_DENIED_ROLES = new Set(["distributor", "guest"]);
const MIAOSHOU_DENIED_ROLES = new Set(["distributor", "guest"]);
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

export function normalizeDataScopes(value) {
  return {
    countries: uniqueStrings(value?.countries),
    warehouseIds: uniqueStrings(value?.warehouseIds),
    skus: uniqueStrings(value?.skus).map((sku) => sku.toUpperCase()),
  };
}

export function effectivePermissions(user) {
  const role = roleOf(user);
  const overrides = normalizePermissionOverrides(user?.permissionOverrides);
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
  for (const permission of overrides.deny) effective.delete(permission);

  if (DIRECT_PRICE_DENIED_ROLES.has(role)) effective.delete("direct_price");
  if (PERFORMANCE_COST_DENIED_ROLES.has(role)) {
    effective.delete("performance_cost");
    effective.delete("performance_profit");
  }
  if (USER_MANAGEMENT_DENIED_ROLES.has(role)) effective.delete("users");
  if (WAREHOUSE_COLLABORATION_DENIED_ROLES.has(role)) {
    effective.delete("after_sales_report");
    effective.delete("after_sales_warehouse");
    effective.delete("warehouse_ticket_report");
    effective.delete("warehouse_ticket_warehouse");
  }
  if (MIAOSHOU_DENIED_ROLES.has(role)) {
    effective.delete("miaoshou");
    for (const permission of MIAOSHOU_PERMISSION_KEYS) effective.delete(permission);
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
      directDenied: ["users"],
      warehouseDenied: PERMISSION_KEYS.filter((key) => !WAREHOUSE_ALLOWED_PERMISSIONS.has(key)),
      distributorDenied: ["direct_price", "performance_cost", "performance_profit", "after_sales_report", "after_sales_warehouse", "warehouse_ticket_report", "warehouse_ticket_warehouse", "users", ...MIAOSHOU_PERMISSION_KEYS],
      guestDenied: ["direct_price", "performance_cost", "performance_profit", "after_sales_report", "after_sales_warehouse", "warehouse_ticket_report", "warehouse_ticket_warehouse", "users", ...MIAOSHOU_PERMISSION_KEYS],
      adminRequired: Array.from(REQUIRED_ADMIN_PERMISSIONS),
    },
  };
}

export function sanitizePermissionUpdate(role, input) {
  const overrides = normalizePermissionOverrides(input);
  if (DIRECT_PRICE_DENIED_ROLES.has(role)) {
    overrides.allow = overrides.allow.filter((key) => key !== "direct_price");
  }
  if (PERFORMANCE_COST_DENIED_ROLES.has(role)) {
    overrides.allow = overrides.allow.filter((key) => !["performance_cost", "performance_profit"].includes(key));
  }
  if (USER_MANAGEMENT_DENIED_ROLES.has(role)) {
    overrides.allow = overrides.allow.filter((key) => key !== "users");
  }
  if (WAREHOUSE_COLLABORATION_DENIED_ROLES.has(role)) {
    overrides.allow = overrides.allow.filter((key) => !["after_sales_report", "after_sales_warehouse", "warehouse_ticket_report", "warehouse_ticket_warehouse"].includes(key));
  }
  if (MIAOSHOU_DENIED_ROLES.has(role)) {
    overrides.allow = overrides.allow.filter((key) => key !== "miaoshou" && !MIAOSHOU_PERMISSION_KEYS.includes(key));
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
