import type { CatalogProduct, ProductBase, QualificationRecord, WarehouseOnlyInventoryItem } from "./api";
import { getQualificationExpiryInfo } from "./qualification-expiry";

export type QualificationCoverageStatus = "valid" | "warning" | "urgent" | "expired" | "undated" | "missing";

export type QualificationCoverageWarehouse = {
  id: string;
  name: string;
  country: string;
  productCount: number;
  totalQty: number;
  syncedAt: string;
};

export type QualificationCoverageCell = {
  category: string;
  status: QualificationCoverageStatus;
  records: QualificationRecord[];
  activeRecords: number;
  nearestExpiryDate: string;
  nearestDaysLeft: number | null;
};

export type QualificationCoverageProduct = {
  id: string;
  sku: string;
  productName: string;
  imageUrl: string;
  category: string;
  brand: string;
  availableQty: number;
  lockedQty: number;
  inTransitQty: number;
  totalQty: number;
  status: QualificationCoverageStatus;
  covered: boolean;
  coveredCategoryCount: number;
  registeredCategoryCount: number;
  cells: QualificationCoverageCell[];
};

export type QualificationCoverageCategory = {
  name: string;
  coveredProducts: number;
  registeredProducts: number;
  missingProducts: number;
  expiringProducts: number;
  expiredProducts: number;
  coverageRate: number;
};

export type QualificationCoverageResult = {
  warehouse: QualificationCoverageWarehouse | null;
  categories: QualificationCoverageCategory[];
  products: QualificationCoverageProduct[];
  summary: {
    products: number;
    covered: number;
    risk: number;
    expired: number;
    undated: number;
    missing: number;
    coverageRate: number;
  };
};

const ACTIVE_STATUSES = new Set<QualificationCoverageStatus>(["valid", "warning", "urgent"]);
const STATUS_PRIORITY: Record<QualificationCoverageStatus, number> = {
  valid: 6,
  warning: 5,
  urgent: 4,
  undated: 3,
  expired: 2,
  missing: 1,
};
const ROW_RISK_PRIORITY: Record<QualificationCoverageStatus, number> = {
  missing: 0,
  expired: 1,
  undated: 2,
  urgent: 3,
  warning: 4,
  valid: 5,
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function token(value: unknown) {
  return text(value).toLocaleLowerCase().replace(/[\s_·|/\\-]+/g, "");
}

function skuToken(value: unknown) {
  return text(value).toLocaleUpperCase().replace(/\s+/g, "");
}

function skuLookupKeys(value: unknown) {
  const normalized = skuToken(value);
  if (!normalized) return [];
  const keys = new Set([normalized]);
  const tongzhouSku = normalized.match(/(TZKJ-[A-Z0-9-]+)$/)?.[1];
  if (tongzhouSku) keys.add(tongzhouSku);
  return [...keys];
}

function roundRate(part: number, total: number) {
  return total ? Math.round((part / total) * 1000) / 10 : 0;
}

function quantity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildQualificationCoverageProducts(
  catalog: CatalogProduct[],
  productBase: ProductBase[],
  warehouseOnlyInventory: WarehouseOnlyInventoryItem[],
) {
  const baseBySku = new Map<string, ProductBase>();
  for (const product of productBase) {
    for (const value of [product.sku, product.skuNo]) {
      for (const key of skuLookupKeys(value)) {
        if (!baseBySku.has(key)) baseBySku.set(key, product);
      }
    }
  }
  const unmatchedBySku = new Map<string, CatalogProduct>();
  for (const item of warehouseOnlyInventory) {
    const sku = text(item.sku || item.countrySku);
    const key = skuToken(sku);
    if (!key) continue;
    const base = skuLookupKeys(sku).map((candidate) => baseBySku.get(candidate)).find(Boolean);
    const current = unmatchedBySku.get(key) || {
      id: text(base?.id) || `warehouse-only-${key}`,
      skuNo: text(base?.skuNo),
      sku,
      name: text(base?.name) || sku,
      nameEn: text(base?.nameEn),
      country: text(item.country),
      channel: "内部库存",
      category: text(base?.category) || "未分类",
      unit: text(base?.unit),
      brand: text(base?.brand),
      status: "WMS 在库",
      alert: "健康",
      visualTone: "care",
      imageUrl: text(base?.imageUrl),
      warehouseSyncedAt: text(item.syncedAt),
      warehouseBreakdown: [],
    } as CatalogProduct;
    current.imageUrl ||= text(base?.imageUrl);
    current.name ||= text(base?.name) || sku;
    current.warehouseSyncedAt = text(item.syncedAt) > text(current.warehouseSyncedAt) ? text(item.syncedAt) : current.warehouseSyncedAt;
    const existing = current.warehouseBreakdown?.find((detail) => text(detail.warehouseId) === text(item.warehouseId));
    if (existing) {
      existing.availableQty += quantity(item.availableQty);
      existing.lockedQty += quantity(item.lockedQty);
      existing.inTransitQty += quantity(item.inTransitQty);
      existing.totalQty += quantity(item.totalQty);
    } else {
      current.warehouseBreakdown?.push({
        warehouseId: text(item.warehouseId),
        warehouseName: text(item.warehouseName),
        country: text(item.country),
        availableQty: quantity(item.availableQty),
        lockedQty: quantity(item.lockedQty),
        inTransitQty: quantity(item.inTransitQty),
        totalQty: quantity(item.totalQty),
      });
    }
    unmatchedBySku.set(key, current);
  }
  return [...catalog, ...unmatchedBySku.values()];
}

function warehouseCountry(entries: Array<{ country: string; quantity: number }>) {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const country = text(entry.country);
    if (country) counts.set(country, (counts.get(country) || 0) + Math.max(1, entry.quantity));
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"))[0]?.[0] || "未识别国家";
}

function countryAliases(country: string) {
  const normalized = token(country);
  if (["印度尼西亚", "印尼", "indonesia"].some((value) => normalized.includes(token(value))) || normalized === "id") return ["印度尼西亚", "印尼", "indonesia"];
  if (["马来西亚", "马来", "malaysia"].some((value) => normalized.includes(token(value))) || normalized === "my") return ["马来西亚", "马来", "malaysia"];
  if (["越南", "vietnam"].some((value) => normalized.includes(token(value))) || normalized === "vn") return ["越南", "vietnam"];
  if (["俄罗斯", "russia", "russianfederation"].some((value) => normalized.includes(token(value))) || normalized === "ru") return ["俄罗斯", "russia"];
  if (["菲律宾", "philippines"].some((value) => normalized.includes(token(value))) || normalized === "ph") return ["菲律宾", "philippines"];
  if (["泰国", "thailand"].some((value) => normalized.includes(token(value))) || normalized === "th") return ["泰国", "thailand"];
  return [country].filter(Boolean);
}

export function qualificationCategoryMatchesCountry(category: string, country: string) {
  const categoryToken = token(category);
  return Boolean(categoryToken) && countryAliases(country).some((alias) => categoryToken.includes(token(alias)));
}

export function buildQualificationWarehouseOptions(products: CatalogProduct[]): QualificationCoverageWarehouse[] {
  const map = new Map<string, {
    id: string;
    name: string;
    totalQty: number;
    productIds: Set<string>;
    countryEntries: Array<{ country: string; quantity: number }>;
    syncedAt: string;
  }>();
  for (const product of products) {
    for (const detail of product.warehouseBreakdown || []) {
      const totalQty = quantity(detail.totalQty || (detail.availableQty + detail.lockedQty + detail.inTransitQty));
      if (totalQty <= 0) continue;
      const id = text(detail.warehouseId || detail.warehouseName);
      if (!id) continue;
      const row = map.get(id) || {
        id,
        name: text(detail.warehouseName || detail.warehouseId) || "未命名仓库",
        totalQty: 0,
        productIds: new Set<string>(),
        countryEntries: [],
        syncedAt: "",
      };
      row.name ||= text(detail.warehouseName || detail.warehouseId);
      row.totalQty += totalQty;
      row.productIds.add(text(product.id || product.sku));
      row.countryEntries.push({ country: text(detail.country || product.country), quantity: totalQty });
      row.syncedAt = text(product.warehouseSyncedAt) > row.syncedAt ? text(product.warehouseSyncedAt) : row.syncedAt;
      map.set(id, row);
    }
  }
  return [...map.values()].map((row) => ({
    id: row.id,
    name: row.name,
    country: warehouseCountry(row.countryEntries),
    productCount: row.productIds.size,
    totalQty: row.totalQty,
    syncedAt: row.syncedAt,
  })).sort((left, right) => right.productCount - left.productCount || right.totalQty - left.totalQty || left.name.localeCompare(right.name, "zh-CN"));
}

function recordsForProduct(product: CatalogProduct, records: QualificationRecord[]) {
  const productSkus = new Set([product.sku, product.skuNo, product.countrySku].flatMap(skuLookupKeys));
  const productId = text(product.id);
  const productName = token(product.name || product.nameEn);
  return records.filter((record) => (
    (productId && text(record.productRecordId) === productId)
    || skuLookupKeys(record.sku).some((key) => productSkus.has(key))
    || (productName && productName === token(record.productName))
  ));
}

function statusForRecords(records: QualificationRecord[], now: Date): QualificationCoverageCell["status"] {
  if (!records.length) return "missing";
  return records.reduce<QualificationCoverageStatus>((best, record) => {
    const expiryStatus = getQualificationExpiryInfo(record.expiryDate, now).status;
    const status: QualificationCoverageStatus = expiryStatus === "missing" ? "undated" : expiryStatus;
    return STATUS_PRIORITY[status] > STATUS_PRIORITY[best] ? status : best;
  }, "missing");
}

function nearestActiveExpiry(records: QualificationRecord[], now: Date) {
  const candidates = records.map((record) => ({
    expiryDate: text(record.expiryDate),
    info: getQualificationExpiryInfo(record.expiryDate, now),
  })).filter((row) => ["valid", "warning", "urgent"].includes(row.info.status) && row.info.daysLeft !== null)
    .sort((left, right) => Number(left.info.daysLeft) - Number(right.info.daysLeft));
  return {
    nearestExpiryDate: candidates[0]?.expiryDate || "",
    nearestDaysLeft: candidates[0]?.info.daysLeft ?? null,
  };
}

function bestOverallStatus(cells: QualificationCoverageCell[]): QualificationCoverageStatus {
  return cells.reduce<QualificationCoverageStatus>((best, cell) => (
    STATUS_PRIORITY[cell.status] > STATUS_PRIORITY[best] ? cell.status : best
  ), "missing");
}

export function buildQualificationCoverage(
  products: CatalogProduct[],
  qualifications: QualificationRecord[],
  warehouseId: string,
  now = new Date(),
): QualificationCoverageResult {
  const warehouses = buildQualificationWarehouseOptions(products);
  const warehouse = warehouses.find((row) => row.id === warehouseId) || warehouses[0] || null;
  if (!warehouse) {
    return {
      warehouse: null,
      categories: [],
      products: [],
      summary: { products: 0, covered: 0, risk: 0, expired: 0, undated: 0, missing: 0, coverageRate: 0 },
    };
  }

  const warehouseProducts = products.map((product) => {
    const detail = (product.warehouseBreakdown || []).find((row) => text(row.warehouseId || row.warehouseName) === warehouse.id);
    const totalQty = detail ? quantity(detail.totalQty || (detail.availableQty + detail.lockedQty + detail.inTransitQty)) : 0;
    return { product, detail, totalQty };
  }).filter((row) => row.detail && row.totalQty > 0);

  const countryCategories = [...new Set(qualifications
    .map((record) => text(record.qualificationCategory))
    .filter((category) => qualificationCategoryMatchesCountry(category, warehouse.country)))];
  const linkedCategories = [...new Set(warehouseProducts.flatMap(({ product }) => recordsForProduct(product, qualifications))
    .map((record) => text(record.qualificationCategory)).filter(Boolean))];
  const categoryNames = (countryCategories.length ? countryCategories : linkedCategories).sort((left, right) => {
    const leftCount = qualifications.filter((record) => text(record.qualificationCategory) === left).length;
    const rightCount = qualifications.filter((record) => text(record.qualificationCategory) === right).length;
    return rightCount - leftCount || left.localeCompare(right, "zh-CN");
  });

  const rows = warehouseProducts.map(({ product, detail, totalQty }) => {
    const related = recordsForProduct(product, qualifications);
    const cells = categoryNames.map((category) => {
      const records = related.filter((record) => text(record.qualificationCategory) === category);
      const status = statusForRecords(records, now);
      return {
        category,
        status,
        records,
        activeRecords: records.filter((record) => ACTIVE_STATUSES.has(statusForRecords([record], now))).length,
        ...nearestActiveExpiry(records, now),
      };
    });
    const status = bestOverallStatus(cells);
    return {
      id: text(product.id || product.sku),
      sku: text(product.sku || product.skuNo),
      productName: text(product.name || product.nameEn || product.sku),
      imageUrl: text(product.imageUrl),
      category: text(product.category),
      brand: text(product.brand),
      availableQty: quantity(detail?.availableQty),
      lockedQty: quantity(detail?.lockedQty),
      inTransitQty: quantity(detail?.inTransitQty),
      totalQty,
      status,
      covered: ACTIVE_STATUSES.has(status),
      coveredCategoryCount: cells.filter((cell) => ACTIVE_STATUSES.has(cell.status)).length,
      registeredCategoryCount: cells.filter((cell) => cell.records.length > 0).length,
      cells,
    } satisfies QualificationCoverageProduct;
  }).sort((left, right) => ROW_RISK_PRIORITY[left.status] - ROW_RISK_PRIORITY[right.status] || right.totalQty - left.totalQty || left.sku.localeCompare(right.sku));

  const categories = categoryNames.map((name) => {
    const cells = rows.map((row) => row.cells.find((cell) => cell.category === name)).filter(Boolean) as QualificationCoverageCell[];
    const coveredProducts = cells.filter((cell) => ACTIVE_STATUSES.has(cell.status)).length;
    const registeredProducts = cells.filter((cell) => cell.records.length > 0).length;
    return {
      name,
      coveredProducts,
      registeredProducts,
      missingProducts: cells.length - registeredProducts,
      expiringProducts: cells.filter((cell) => ["warning", "urgent"].includes(cell.status)).length,
      expiredProducts: cells.filter((cell) => cell.status === "expired").length,
      coverageRate: roundRate(coveredProducts, rows.length),
    };
  });
  const covered = rows.filter((row) => row.covered).length;
  return {
    warehouse,
    categories,
    products: rows,
    summary: {
      products: rows.length,
      covered,
      risk: rows.filter((row) => ["warning", "urgent"].includes(row.status)).length,
      expired: rows.filter((row) => row.status === "expired").length,
      undated: rows.filter((row) => row.status === "undated").length,
      missing: rows.filter((row) => row.status === "missing").length,
      coverageRate: roundRate(covered, rows.length),
    },
  };
}
