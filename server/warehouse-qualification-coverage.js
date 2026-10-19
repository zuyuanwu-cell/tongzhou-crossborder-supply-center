import {
  buildQualificationCoverage,
  buildQualificationCoverageProducts,
  buildQualificationWarehouseOptions,
} from "../shared/qualification-coverage-core.js";

const COVERED_STATUSES = new Set(["valid", "warning", "urgent"]);

function text(value) {
  return String(value ?? "").trim();
}

function identifiers(connection) {
  return new Set([
    connection?.id,
    connection?.connectionId,
    connection?.warehouseId,
    connection?.warehouseCode,
    connection?.resolvedWarehouseId,
  ].map(text).filter(Boolean));
}

function publicRecord(record) {
  return {
    id: text(record?.id),
    qualificationName: text(record?.qualificationName || record?.qualificationCategory),
    effectiveDate: text(record?.effectiveDate),
    expiryDate: text(record?.expiryDate),
  };
}

function publicProduct(product) {
  return {
    id: text(product?.id),
    sku: text(product?.sku),
    productName: text(product?.productName),
    imageUrl: text(product?.imageUrl),
    category: text(product?.category),
    brand: text(product?.brand),
    availableQty: Number(product?.availableQty || 0),
    lockedQty: Number(product?.lockedQty || 0),
    inTransitQty: Number(product?.inTransitQty || 0),
    totalQty: Number(product?.totalQty || 0),
    status: product?.status || "missing",
    covered: Boolean(product?.covered),
    coveredCategoryCount: Number(product?.coveredCategoryCount || 0),
    registeredCategoryCount: Number(product?.registeredCategoryCount || 0),
    cells: (product?.cells || []).map((cell) => ({
      category: text(cell?.category),
      status: cell?.status || "missing",
      activeRecords: Number(cell?.activeRecords || 0),
      nearestExpiryDate: text(cell?.nearestExpiryDate),
      nearestDaysLeft: cell?.nearestDaysLeft !== null && cell?.nearestDaysLeft !== undefined && Number.isFinite(Number(cell.nearestDaysLeft)) ? Number(cell.nearestDaysLeft) : null,
      records: (cell?.records || []).map(publicRecord),
    })),
  };
}

function matchesFilter(product, keyword, status) {
  const query = text(keyword).toLocaleLowerCase();
  const keywordMatched = !query || [product.sku, product.productName, product.brand, product.category]
    .some((value) => text(value).toLocaleLowerCase().includes(query));
  if (!keywordMatched) return false;
  if (!status || status === "all") return true;
  if (status === "covered") return COVERED_STATUSES.has(product.status);
  if (status === "attention") return ["warning", "urgent"].includes(product.status);
  if (status === "risk") return ["expired", "undated", "missing"].includes(product.status);
  return product.status === status;
}

function summarize(products) {
  const covered = products.filter((product) => COVERED_STATUSES.has(product.status)).length;
  return {
    products: products.length,
    covered,
    risk: products.filter((product) => ["warning", "urgent"].includes(product.status)).length,
    urgent: products.filter((product) => product.status === "urgent").length,
    warning: products.filter((product) => product.status === "warning").length,
    expired: products.filter((product) => product.status === "expired").length,
    undated: products.filter((product) => product.status === "undated").length,
    missing: products.filter((product) => product.status === "missing").length,
    unavailable: products.filter((product) => product.status === "unavailable").length,
    coverageRate: products.length ? Math.round((covered / products.length) * 1000) / 10 : 0,
  };
}

function unavailableProduct(product, warehouseId) {
  const detail = (product?.warehouseBreakdown || []).find((row) => text(row?.warehouseId || row?.warehouseName) === warehouseId);
  const totalQty = Number(detail?.totalQty || (Number(detail?.availableQty || 0) + Number(detail?.lockedQty || 0) + Number(detail?.inTransitQty || 0)));
  if (!detail || totalQty <= 0) return null;
  return {
    id: text(product?.id || product?.sku),
    sku: text(product?.sku || product?.skuNo),
    productName: text(product?.name || product?.nameEn || product?.sku),
    imageUrl: text(product?.imageUrl),
    category: text(product?.category),
    brand: text(product?.brand),
    availableQty: Number(detail?.availableQty || 0),
    lockedQty: Number(detail?.lockedQty || 0),
    inTransitQty: Number(detail?.inTransitQty || 0),
    totalQty,
    status: "unavailable",
    covered: false,
    coveredCategoryCount: 0,
    registeredCategoryCount: 0,
    cells: [],
  };
}

export class WarehouseQualificationCoverageError extends Error {
  constructor(message, statusCode = 400, code = "warehouse_qualification_coverage_error") {
    super(message);
    this.name = "WarehouseQualificationCoverageError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function buildWarehouseQualificationCoverage({
  catalog = [],
  productBase = [],
  warehouseOnlyInventory = [],
  qualifications = [],
  connections = [],
  requestedWarehouseId = "",
  keyword = "",
  status = "all",
  qualificationAvailable = true,
  now = new Date(),
} = {}) {
  const products = buildQualificationCoverageProducts(catalog, productBase, warehouseOnlyInventory);
  const inventoryWarehouses = buildQualificationWarehouseOptions(products);
  const warehouseOptions = connections.map((connection) => {
    const aliases = identifiers(connection);
    const inventory = inventoryWarehouses.find((warehouse) => aliases.has(text(warehouse.id)))
      || inventoryWarehouses.find((warehouse) => text(warehouse.name) === text(connection?.name));
    return {
      id: text(connection?.id),
      name: text(connection?.name || inventory?.name || connection?.id),
      country: text(connection?.country || inventory?.country),
      productCount: Number(inventory?.productCount || 0),
      totalQty: Number(inventory?.totalQty || 0),
      syncedAt: text(inventory?.syncedAt),
      inventoryWarehouseId: text(inventory?.id),
    };
  }).filter((warehouse) => warehouse.id);

  const requested = text(requestedWarehouseId);
  const selectedOption = requested
    ? warehouseOptions.find((warehouse) => warehouse.id === requested)
    : warehouseOptions.find((warehouse) => warehouse.productCount > 0) || warehouseOptions[0] || null;
  if (requested && !selectedOption) {
    throw new WarehouseQualificationCoverageError("所选仓库不存在或不在当前账号的数据范围内。", 403, "warehouse_scope_forbidden");
  }

  const warehouses = warehouseOptions.map((warehouse) => ({
    id: warehouse.id,
    name: warehouse.name,
    country: warehouse.country,
    productCount: warehouse.productCount,
    totalQty: warehouse.totalQty,
    syncedAt: warehouse.syncedAt,
    synchronized: Boolean(warehouse.syncedAt),
  }));
  if (!selectedOption) {
    return {
      warehouses,
      warehouse: null,
      categories: [],
      products: [],
      completedProducts: 0,
      summary: summarize([]),
      qualificationAvailable,
    };
  }

  let result;
  if (selectedOption.inventoryWarehouseId && qualificationAvailable) {
    result = buildQualificationCoverage(products, qualifications, selectedOption.inventoryWarehouseId, now);
  } else {
    const unavailableProducts = selectedOption.inventoryWarehouseId
      ? products.map((product) => unavailableProduct(product, selectedOption.inventoryWarehouseId)).filter(Boolean)
      : [];
    result = {
      warehouse: selectedOption.inventoryWarehouseId ? {
        id: selectedOption.inventoryWarehouseId,
        name: selectedOption.name,
        country: selectedOption.country,
        productCount: unavailableProducts.length,
        totalQty: unavailableProducts.reduce((sum, product) => sum + product.totalQty, 0),
        syncedAt: selectedOption.syncedAt,
      } : null,
      categories: [],
      products: unavailableProducts,
      summary: summarize(unavailableProducts),
    };
  }

  const allProducts = result.products.map(publicProduct);
  const visibleProducts = allProducts.filter((product) => matchesFilter(product, keyword, status));
  return {
    warehouses,
    warehouse: {
      id: selectedOption.id,
      name: selectedOption.name,
      country: selectedOption.country || text(result.warehouse?.country),
      productCount: Number(result.warehouse?.productCount || allProducts.length),
      totalQty: Number(result.warehouse?.totalQty || allProducts.reduce((sum, product) => sum + product.totalQty, 0)),
      syncedAt: selectedOption.syncedAt || text(result.warehouse?.syncedAt),
    },
    categories: result.categories || [],
    products: visibleProducts,
    completedProducts: qualificationAvailable ? allProducts.length : 0,
    summary: qualificationAvailable ? result.summary : summarize(allProducts),
    qualificationAvailable,
  };
}
