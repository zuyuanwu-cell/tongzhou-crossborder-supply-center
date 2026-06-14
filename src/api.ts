export type CatalogProduct = {
  id: string;
  skuNo: string;
  sku: string;
  name: string;
  nameEn: string;
  country: string;
  channel: "直营" | "分销" | string;
  category: string;
  unit: string;
  brand: string;
  distributionPrice: number;
  distributionCurrency: string;
  directPrice?: number;
  directCurrency?: string;
  directCostPrice?: number;
  directCostCurrency?: string;
  distributionCost?: number;
  distributionCostPrice?: number;
  distributionCostCurrency?: string;
  salesPrice?: number;
  salesCurrency?: string;
  stockQty: number;
  lockedQty?: number;
  inTransitQty?: number;
  warehouseTotalQty?: number;
  warehouseBreakdown?: Array<{
    warehouseId: string;
    warehouseName: string;
    availableQty: number;
    lockedQty: number;
    inTransitQty: number;
    totalQty: number;
  }>;
  dataGap?: string;
  warehouseSyncedAt?: string;
  status: string;
  alert: "补货" | "断货" | "健康" | "滞销";
  visualTone: "food" | "care" | "home" | "baby";
  countrySku?: string;
  imageUrl?: string;
  imageSource?: string;
  functionCategory?: string;
  productType?: string;
  skuAttribute?: string;
  barcode?: string;
  specification?: string;
  weight?: string;
  length?: string;
  width?: string;
  height?: string;
  project?: string;
  publicDescription?: string;
  sellingPoints?: string;
  sellingPointsEn?: string;
  qualificationImageUrl?: string;
};

export type ProductBase = {
  id: string;
  skuNo: string;
  sku: string;
  name: string;
  nameEn: string;
  unit: string;
  category: string;
  brand: string;
  functionCategory?: string;
  productType?: string;
  skuAttribute?: string;
  barcode?: string;
  supplier?: string;
  launchDate?: string;
  imageUrl?: string;
  imageSource?: string;
  qualificationImageUrl?: string;
  specification?: string;
  weight?: string;
  length?: string;
  width?: string;
  height?: string;
  project?: string;
  publicDescription?: string;
  sellingPoints?: string;
  sellingPointsEn?: string;
};

export type ProductPayload = {
  ok: boolean;
  internal: boolean;
  user?: AuthUser;
  source: "sample" | "jiandaoyun";
  syncedAt: string;
  warning?: string;
  counts: {
    productBase: number;
    catalog: number;
    directCatalog: number;
    distributionCatalog: number;
    visibleCatalog: number;
    warehouseOnlyInventory?: number;
    productMissingWarehouse?: number;
  };
  productBase: ProductBase[];
  catalog: CatalogProduct[];
};

export type UserRole = "guest" | "distributor" | "direct";
export type UserStatus = "active" | "disabled";

export type AuthUser = {
  id?: string;
  username?: string;
  displayName?: string;
  role: UserRole;
  roleLabel: string;
  permissions: string[];
};

export type UserManagementPayload = {
  ok: boolean;
  source: "local";
  syncedAt: string;
  warning?: string;
  counts: {
    users: number;
    direct: number;
    distributor: number;
    active?: number;
    disabled?: number;
  };
  users: Array<{
    id: string;
    username: string;
    displayName: string;
    role: UserRole;
    roleLabel: string;
    status?: UserStatus;
    statusLabel?: string;
    jdySyncedAt?: string;
    jdySyncError?: string;
  }>;
};

export type QualificationFile = {
  id: string;
  name: string;
  url?: string;
  fileId?: string;
};

export type QualificationRecord = {
  id: string;
  productRecordId: string;
  sku: string;
  productName: string;
  qualificationCategory: string;
  market: string;
  qualificationName: string;
  issuer: string;
  effectiveDate: string;
  expiryDate: string;
  files: QualificationFile[];
  remark: string;
};

export type QualificationPayload = {
  ok: boolean;
  source: "empty" | "sample" | "jiandaoyun";
  syncedAt: string;
  warning?: string;
  counts: {
    qualifications: number;
    withFiles: number;
    expired: number;
  };
  qualifications: QualificationRecord[];
};

export type AssetFile = {
  id: string;
  name: string;
  url?: string;
  fileId?: string;
};

export type AssetRecord = {
  id: string;
  productRecordId: string;
  sku: string;
  productName: string;
  productNameEn: string;
  category: string;
  assetType: string;
  assetName: string;
  imageFiles: AssetFile[];
  sourceFiles: AssetFile[];
  files: AssetFile[];
  remark: string;
};

export type AssetPayload = {
  ok: boolean;
  source: "empty" | "sample" | "jiandaoyun";
  syncedAt: string;
  warning?: string;
  counts: {
    assets: number;
    withFiles: number;
  };
  assets: AssetRecord[];
};

export type WarehouseInfoRecord = {
  id: string;
  tongzhouSerialNo: string;
  warehouseName: string;
  countryRegion: string;
  warehouseCode: string;
  shopShippingAddress: string;
  shopReturnAddress: string;
  firstMileReceivingAddress: string;
  timezone: string;
  workStartTime: string;
  workEndTime: string;
  remark: string;
  creator: string;
  createTime: string;
  updateTime: string;
  details: Array<{
    label: string;
    value: string;
  }>;
};

export type WarehouseInfoPayload = {
  ok: boolean;
  source: "empty" | "sample" | "jiandaoyun";
  syncedAt: string;
  warning?: string;
  counts: {
    records: number;
    warehouses: number;
    countries?: number;
  };
  warehouseInfo: WarehouseInfoRecord[];
};

export type WmsProvider = {
  id: string;
  name: string;
  docUrl: string;
  region: string;
  authFields: string[];
  notes: string;
};

export type WarehouseConnection = {
  id: string;
  name: string;
  country: string;
  providerId: string;
  providerName: string;
  baseUrl: string;
  warehouseCode: string;
  warehouseId?: string;
  status: string;
  lastSyncedAt: string;
  skuMatched: number;
  syncScope: string[];
  hasCredentials?: boolean;
};

export type WarehousePayload = {
  ok: boolean;
  providers: WmsProvider[];
  warehouses: WarehouseConnection[];
  lastSync?: {
    syncedAt: string;
    imageCount: number;
    inventoryCount: number;
    warehouseOnlyCount?: number;
    productMissingWarehouseCount?: number;
    warehouseOnlyInventory?: Array<{
      warehouseId: string;
      warehouseName: string;
      country: string;
      sku: string;
      countrySku: string;
      availableQty: number;
      lockedQty: number;
      inTransitQty: number;
      totalQty: number;
    }>;
    results: Array<{
      warehouseId: string;
      ok: boolean;
      skipped: boolean;
      message: string;
      productCount: number;
      inventoryCount: number;
    }>;
  };
  nextRequiredSecrets: string[];
};

export type InventorySnapshotRow = {
  warehouseId: string;
  warehouseName: string;
  country: string;
  sku: string;
  countrySku: string;
  productName: string;
  availableQty: number;
  lockedQty: number;
  waitInQty: number;
  inTransitQty: number;
  faultyQty: number;
  temporaryQty: number;
  totalQty: number;
  sourceSyncedAt: string;
};

export type InventorySnapshot = {
  date: string;
  capturedAt: string;
  sourceSyncedAt: string;
  reason: string;
  rowCount: number;
  warehouseCount: number;
  skuCount: number;
  totals: {
    availableQty: number;
    lockedQty: number;
    waitInQty: number;
    inTransitQty: number;
    totalQty: number;
  };
  rows: InventorySnapshotRow[];
};

export type InventorySnapshotPayload = {
  ok: boolean;
  updatedAt: string;
  lastSnapshotAt: string;
  selectedDate: string;
  dates: Array<{
    date: string;
    capturedAt: string;
    rowCount: number;
    warehouseCount: number;
    skuCount: number;
    totals: InventorySnapshot["totals"];
  }>;
  snapshot: InventorySnapshot | null;
};

export type WarehouseExportPayload = {
  ok: boolean;
  version: number;
  exportedAt: string;
  warehouses: Array<WarehouseConnection & {
    credentials?: {
      appKey?: string;
      appSecret?: string;
      clientId?: string;
      clientSecret?: string;
      token?: string;
    };
  }>;
};

export type MovementItem = {
  id: string;
  sku: string;
  countrySku?: string;
  name: string;
  brand: string;
  category: string;
  country: string;
  unit: string;
  imageUrl?: string;
  availableQty: number;
  lockedQty: number;
  inTransitQty: number;
  totalQty: number;
  warehouseBreakdown: Array<{
    warehouseId: string;
    warehouseName: string;
    availableQty: number;
    lockedQty: number;
    inTransitQty: number;
    totalQty: number;
  }>;
  salesWarehouseBreakdown: Array<{
    warehouseId: string;
    warehouseName: string;
    sales90: number;
  }>;
  sales3: number;
  sales7: number;
  sales15: number;
  sales30: number;
  sales60: number;
  sales90: number;
  avgDaily3: number;
  avgDaily7: number;
  avgDaily30: number;
  avgDaily90: number;
  dailyWeighted: number;
  daysCover: number | null;
  leadDays: number;
  targetCoverDays: number;
  replenishQty: number;
  status: "缺货" | "补货预警" | "慢销" | "滞销" | "无动销数据" | "健康" | string;
  suggestion: string;
  trend30: number[];
  source: "product" | "warehouse_only" | string;
  dataGap?: string;
};

export type MovementPayload = {
  ok: boolean;
  generatedAt: string;
  orderSyncedAt: string;
  inventorySyncedAt: string;
  windows: number[];
  counts: {
    sku: number;
    stockout: number;
    replenish: number;
    slow: number;
    stagnant: number;
    noSalesData: number;
    warehouseOnly: number;
  };
  items: MovementItem[];
  orderSyncResults: Array<{
    warehouseId: string;
    ok: boolean;
    skipped: boolean;
    message: string;
    orderCount: number;
    hasCredentials?: boolean;
  }>;
};

export type StockupRecommendation = {
  id: string;
  sku: string;
  countrySku?: string;
  name: string;
  country: string;
  unit: string;
  imageUrl?: string;
  status: string;
  availableQty: number;
  inTransitQty: number;
  sales7: number;
  sales30: number;
  sales90: number;
  avgDaily7: number;
  avgDaily30: number;
  avgDaily90: number;
  daysCover: number | null;
  leadDays: number;
  targetCoverDays: number;
  replenishQty: number;
  outsourcingInProductionQty: number;
  netReplenishQty: number;
  outsourcingOrders: Array<{
    id: string;
    tongzhouSku: string;
    orderNo: string;
    productName: string;
    supplier: string;
    status: string;
    unit?: string;
    plannedQty: number;
    producedQty: number;
    inProductionQty: number;
    createdAt?: string;
    expectedFinishedAt?: string;
    remark?: string;
  }>;
  suggestion: string;
  warehouseBreakdown: MovementItem["warehouseBreakdown"];
};

export type StockupInboundOrder = {
  id: string;
  orderNo: string;
  warehouseId: string;
  warehouseName: string;
  providerId: string;
  sku: string;
  productName: string;
  quantity: number;
  status: string;
  expectedArrivalAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type StockupPayload = {
  ok: boolean;
  generatedAt: string;
  movementGeneratedAt: string;
  stockupSyncedAt: string;
  outsourcingSyncedAt: string;
  counts: {
    recommendations: number;
    recommendedQty: number;
    outsourcingOrders: number;
    outsourcingInProductionQty: number;
    outsourcingInRecommendationQty: number;
    outsourcingOutsideRecommendationQty: number;
    outsourcingActiveSku: number;
    netRecommendedQty: number;
    inboundOrders: number;
    pendingInboundQty: number;
  };
  recommendations: StockupRecommendation[];
  outsourcingQueue: Array<{
    id: string;
    sku: string;
    name: string;
    unit: string;
    imageUrl?: string;
    createdAt?: string;
    remark?: string;
    remarks?: string[];
    inProductionQty: number;
    orderCount: number;
    inRecommendation: boolean;
    note: string;
    orders: StockupRecommendation["outsourcingOrders"];
  }>;
  inboundOrders: StockupInboundOrder[];
  syncResults: Array<{
    warehouseId: string;
    warehouseName: string;
    providerId: string;
    ok: boolean;
    skipped: boolean;
    message: string;
    docUrl: string;
    orderCount: number;
    hasCredentials?: boolean;
  }>;
};

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8787";

const AUTH_TOKEN_KEY = "tongzhou_auth_token";
const AUTH_USER_KEY = "tongzhou_auth_user";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...authHeaders(),
    ...((init?.headers as Record<string, string> | undefined) || {}),
  };

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || "请求失败");
  }
  return payload as T;
}

export function fetchProducts() {
  return requestJson<ProductPayload>("/api/products");
}

export function syncProducts() {
  return requestJson<ProductPayload>("/api/products/sync", { method: "POST" });
}

export function fetchQualifications() {
  return requestJson<QualificationPayload>("/api/qualifications");
}

export function syncQualifications() {
  return requestJson<QualificationPayload>("/api/qualifications/sync", { method: "POST" });
}

export function fetchAssets() {
  return requestJson<AssetPayload>("/api/assets");
}

export function fetchWarehouseInfo() {
  return requestJson<WarehouseInfoPayload>("/api/warehouse-info");
}

export function fetchUsers() {
  return requestJson<UserManagementPayload>("/api/users");
}

export function createUser(input: { username: string; password: string; displayName: string; role: UserRole }) {
  return requestJson<UserManagementPayload & { user: AuthUser }>("/api/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateUserStatus(id: string, status: UserStatus) {
  return requestJson<UserManagementPayload & { user: AuthUser }>(`/api/users/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function deleteUser(id: string) {
  return requestJson<UserManagementPayload & { deletedId: string }>(`/api/users/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function syncAssets() {
  return requestJson<AssetPayload>("/api/assets/sync", { method: "POST" });
}

export function syncWarehouseInfo() {
  return requestJson<WarehouseInfoPayload>("/api/warehouse-info/sync", { method: "POST" });
}

export function qualificationFileDownloadUrl(fileId: string, fileName?: string) {
  const params = fileName ? `?name=${encodeURIComponent(fileName)}` : "";
  return `${API_BASE}/api/qualifications/files/${encodeURIComponent(fileId)}${params}`;
}

export function fetchWarehouses() {
  return requestJson<WarehousePayload>("/api/warehouses");
}

export function syncWarehouses() {
  return requestJson<WarehousePayload["lastSync"] & { ok: boolean }>("/api/warehouses/sync", { method: "POST" });
}

export function fetchInventorySnapshots(date?: string) {
  const query = date ? `?date=${encodeURIComponent(date)}` : "";
  return requestJson<InventorySnapshotPayload>(`/api/inventory-snapshots${query}`);
}

export function captureInventorySnapshot() {
  return requestJson<InventorySnapshotPayload>("/api/inventory-snapshots/capture", { method: "POST" });
}

export async function downloadInventorySnapshotCsv(date?: string, warehouseId?: string) {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  if (warehouseId) params.set("warehouseId", warehouseId);
  const query = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`${API_BASE}/api/inventory-snapshots/export${query}`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    let message = "库存快照导出失败";
    try {
      const payload = await response.json();
      message = payload.message || message;
    } catch {
      // CSV endpoints return text on success; keep the default message on failure.
    }
    throw new Error(message);
  }
  return response.blob();
}

export function fetchMovement() {
  return requestJson<MovementPayload>("/api/movement");
}

export function syncOrders(days = 90) {
  return requestJson<{ ok: boolean; syncedAt: string; days: number; results: MovementPayload["orderSyncResults"] }>(
    `/api/orders/sync?days=${days}`,
    { method: "POST" },
  );
}

export function fetchStockup() {
  return requestJson<StockupPayload>("/api/stockup");
}

export function syncStockupOrders() {
  return requestJson<StockupPayload>("/api/stockup/sync", { method: "POST" });
}

export function syncOutsourcingOrders() {
  return requestJson<{ ok: boolean; syncedAt: string; counts: { orders: number } }>("/api/outsourcing-orders/sync", { method: "POST" });
}

export type CreateWarehouseInput = {
  name: string;
  country: string;
  providerId: string;
  baseUrl: string;
  warehouseCode: string;
  warehouseId?: string;
  appKey?: string;
  appSecret?: string;
  clientId?: string;
  clientSecret?: string;
  token?: string;
};

export function createWarehouseConnection(input: CreateWarehouseInput) {
  return requestJson<{ ok: boolean; warehouses: WarehouseConnection[] }>("/api/warehouses", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateWarehouseConnection(id: string, input: CreateWarehouseInput) {
  return requestJson<{ ok: boolean; warehouses: WarehouseConnection[] }>(`/api/warehouses/${encodeURIComponent(id)}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteWarehouseConnection(id: string) {
  return requestJson<{ ok: boolean; deletedId: string; warehouses: WarehouseConnection[] }>(`/api/warehouses/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function exportWarehouseConnections() {
  return requestJson<WarehouseExportPayload>("/api/warehouses/export");
}

export function importWarehouseConnections(payload: unknown) {
  return requestJson<{ ok: boolean; importedCount: number; warehouses: WarehouseConnection[] }>("/api/warehouses/import", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchCurrentUser() {
  return requestJson<{ ok: boolean; user: AuthUser }>("/api/me");
}

export async function loginInternal(input: { username?: string; password?: string; code?: string }) {
  const payload = await requestJson<{ ok: boolean; token: string; user: AuthUser }>("/api/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
  localStorage.setItem(AUTH_TOKEN_KEY, payload.token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(payload.user));
  return payload;
}

export function logoutInternal() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
}

export function hasInternalToken() {
  return Boolean(localStorage.getItem(AUTH_TOKEN_KEY));
}

export function getStoredUser(): AuthUser {
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY);
    return raw ? JSON.parse(raw) : { role: "guest", roleLabel: "游客", permissions: ["product_view"] };
  } catch {
    return { role: "guest", roleLabel: "游客", permissions: ["product_view"] };
  }
}
