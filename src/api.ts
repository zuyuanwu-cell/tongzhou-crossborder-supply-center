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
  distributionPrice?: number;
  distributionCurrency?: string;
  directPrice?: number;
  directCurrency?: string;
  directCostPrice?: number;
  directCostCurrency?: string;
  distributionCost?: number;
  distributionCostPrice?: number;
  distributionCostCurrency?: string;
  salesPrice?: number;
  salesCurrency?: string;
  stockQty?: number;
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
  latestCostBatchId?: string;
  latestLandedUnitCostCny?: number;
  latestCostEffectiveAt?: string;
};

export type ProductPayload = {
  ok: boolean;
  internal: boolean;
  mode?: "list" | "detail";
  user?: AuthUser;
  source: "sample" | "jiandaoyun";
  syncedAt: string;
  warning?: string;
  counts: {
    productBase: number;
    catalog: number;
    directCatalog?: number;
    distributionCatalog: number;
    visibleCatalog: number;
    warehouseOnlyInventory?: number;
    productMissingWarehouse?: number;
  };
  productBase: ProductBase[];
  catalog: CatalogProduct[];
};

export type DashboardSummaryPayload = {
  ok: boolean;
  generatedAt: string;
  internal: boolean;
  user?: AuthUser;
  counts: {
    visibleCatalog: number;
    totalInventory: number;
    todayOrders: number;
    orderCount90: number;
    salesAmount90: number;
    riskSku: number;
    movementSku?: number;
    warehouseOnlySku?: number;
    stockout: number;
    replenish: number;
    slow: number;
    stagnant: number;
  };
  sync: {
    productsSyncedAt: string;
    inventorySyncedAt: string;
    orderSyncedAt: string;
    lastAutoSyncAt: string;
    autoSyncIntervalMs: number;
    backgroundRunningWarehouses: Array<{ warehouseId: string; message: string; orderCount: number }>;
    failedWarehouses: Array<{ warehouseId: string; message: string; orderCount: number }>;
  };
  movementDiagnostics?: MovementWarehouseDiagnostic[];
  warehouses: Array<{
    id: string;
    name: string;
    providerId: string;
    providerName: string;
    country: string;
    hasCredentials: boolean;
    inventoryOk: boolean;
    orderOk: boolean;
    backgroundRunning: boolean;
    message: string;
    inventoryCount: number;
    orderCount: number;
  }>;
};

export type UserRole = "guest" | "distributor" | "direct" | "admin";
export type UserStatus = "active" | "disabled";

export type PermissionOverrides = {
  allow: string[];
  deny: string[];
};

export type UserDataScopes = {
  countries: string[];
  warehouseIds: string[];
  skus: string[];
};

export type PermissionDefinition = {
  key: string;
  label: string;
  group: string;
};

export type AuthUser = {
  id?: string;
  username?: string;
  displayName?: string;
  role: UserRole;
  roleLabel: string;
  permissions: string[];
  permissionOverrides?: PermissionOverrides;
  dataScopes?: UserDataScopes;
  status?: UserStatus;
  statusLabel?: string;
};

export type AgentApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  scope: "agent:read";
  status: "active" | "expired" | "revoked";
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string;
  revokedAt: string;
};

export type AgentApiKeyPayload = {
  ok: boolean;
  scope: "agent:read";
  maxActiveKeys: number;
  keys: AgentApiKey[];
};

export type UserManagementPayload = {
  ok: boolean;
  source: "local";
  syncedAt: string;
  warning?: string;
  counts: {
    users: number;
    admin: number;
    direct: number;
    distributor: number;
    active?: number;
    disabled?: number;
  };
  users: Array<AuthUser & {
    id: string;
    username: string;
    displayName: string;
    jdySyncedAt?: string;
    jdySyncError?: string;
  }>;
  permissionCatalog: PermissionDefinition[];
  roleDefaults: Record<UserRole, string[]>;
  hardRules: {
    directDenied: string[];
    distributorDenied: string[];
    guestDenied: string[];
    adminRequired: string[];
  };
};

export type SetupStatusPayload = {
  ok: boolean;
  setupRequired: boolean;
  counts: UserManagementPayload["counts"];
};

export type DistributorApplication = {
  id: string;
  companyName: string;
  contactName: string;
  phone: string;
  wechat: string;
  email: string;
  market: string;
  note: string;
  sourceSku: string;
  status: "pending" | "contacted" | "approved" | "rejected" | string;
  createdAt: string;
  updatedAt: string;
};

export type DistributorApplicationPayload = {
  ok: boolean;
  source: "local";
  updatedAt: string;
  counts: {
    applications: number;
    pending: number;
  };
  applications: DistributorApplication[];
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

export type QuickNavLink = {
  id: string;
  categoryId: string;
  title: string;
  url: string;
  description: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type QuickNavCategory = {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  links: QuickNavLink[];
};

export type QuickNavPayload = {
  ok: boolean;
  source: "local";
  updatedAt: string;
  counts: {
    categories: number;
    links: number;
  };
  categories: QuickNavCategory[];
};

export type WecomRobot = {
  id: string;
  name: string;
  webhookMasked: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastSentAt?: string;
  lastError?: string;
};

export type WecomSchedule = {
  id: string;
  name: string;
  robotIds: string[];
  enabled: boolean;
  mode: "daily" | "interval";
  time: string;
  intervalMinutes: number;
  text: string;
  linkUrl: string;
  linkText: string;
  createdAt: string;
  updatedAt: string;
  lastSentAt?: string;
  lastRunKey?: string;
  lastError?: string;
};

export type WecomSceneConfig = {
  enabled: boolean;
  robotIds: string[];
  linkUrl: string;
  extraText: string;
  lastSignature?: string;
  lastSentAt?: string;
};

export type WecomNotificationPayload = {
  ok: boolean;
  source: "local";
  updatedAt: string;
  robots: WecomRobot[];
  schedules: WecomSchedule[];
  scenes: {
    stockupRecommendation: WecomSceneConfig;
    inventorySnapshot: WecomSceneConfig;
    qualificationExpiry: WecomSceneConfig;
  };
};

export type ActionLogEntry = {
  id: string;
  createdAt: string;
  action: string;
  targetType: string;
  targetName: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  details?: Record<string, unknown>;
};

export type ActionLogPayload = {
  ok: boolean;
  source: "local";
  updatedAt: string;
  entries: ActionLogEntry[];
};

export type AiConfigPayload = {
  ok: boolean;
  provider: "agnes";
  baseUrl: string;
  updatedAt: string;
  configured: boolean;
  apiKeyMasked: string;
  models: {
    text: string;
    image: string;
    video: string;
  };
};

export type AiTextResult = {
  ok: boolean;
  model: string;
  answer: string;
  raw?: unknown;
};

export type AiChatAttachment = {
  name: string;
  url: string;
};

export type AiChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  attachments?: AiChatAttachment[];
};

export type AiImageResult = {
  ok: boolean;
  model: string;
  images: string[];
  imageMode?: "generation" | "reference-edit";
  referenceCount?: number;
  droppedParams?: string[];
  warnings?: string[];
  raw?: unknown;
};

export type AiVideoResult = {
  ok: boolean;
  model?: string;
  taskId: string;
  status: string;
  videoUrl: string;
  remoteVideoUrl?: string;
  downloadWarning?: string;
  droppedParams?: string[];
  statusPath?: string;
  statusWarnings?: string[];
  raw?: unknown;
};

export type AiUploadResult = {
  ok: boolean;
  upload: {
    id: string;
    url: string;
    mimeType: string;
    size: number;
  };
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
  lastTestAt?: string;
  lastTestStatus?: string;
  lastTestMessage?: string;
  resolvedWarehouseId?: string;
  orderSyncStrategy?: string;
  skuMatched: number;
  syncScope: string[];
  hasCredentials?: boolean;
};

export type WarehouseTestResult = {
  ok: boolean;
  stage: string;
  providerId?: string;
  resolvedWarehouseId?: string;
  inventorySampleCount?: number;
  orderSampleCount?: number;
  message: string;
  suggestions?: string[];
  warehouses?: WarehouseConnection[];
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
    productMissingWarehouseItems?: Array<{
      id: string;
      sku: string;
      countrySku: string;
      name: string;
      country: string;
      channel: string;
      category: string;
      status: string;
      stockQty: number;
      unit: string;
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

export type MiaoshouScope = {
  platform: string;
  site: string;
};

export type MiaoshouShop = {
  shopId: string;
  platform: string;
  site: string;
  siteName: string;
  platformShopName: string;
  shopNick: string;
  parentShopId: string;
  status: string;
  gmtExpire: string;
  gmtLastAuth: string;
  autoApplyTrackingNo: boolean;
  autoFetchWaybill: boolean;
  enabledAt: string;
  enabledBy: string;
  connectionStatus: "active" | "invalid" | string;
  connectionError: string;
  invalidAt: string;
  lastSeenAt: string;
  updatedAt: string;
};

export type MiaoshouTask = {
  id: string;
  opOrderPackageId: string;
  shopId: string;
  shopName: string;
  platform: string;
  site: string;
  appPackageNo: string;
  platformOrderSn: string;
  status: "pending" | "running" | "succeeded" | "retry_wait" | "manual_check" | string;
  trackingNo: string;
  headTrackingNo: string;
  logisticsType: string;
  waybillUrl: string;
  errorCode: string;
  errorMessage: string;
  attempts: number;
  firstSeenAt: string;
  lastAttemptAt: string;
  completedAt: string;
  updatedAt: string;
};

export type MiaoshouPayload = {
  ok: boolean;
  provider: "miaoshou";
  config: {
    hasCredentials: boolean;
    credentialsSource: "environment" | "server" | string;
    appKeyMasked: string;
    automationEnabled: boolean;
    autoFetchWaybillDefault: boolean;
    pollIntervalMinutes: number;
    maxPackagesPerRun: number;
    scopes: MiaoshouScope[];
    updatedAt: string;
    updatedBy: string;
    lastConnectionTestAt: string;
    lastConnectionTestStatus: string;
    lastConnectionTestMessage: string;
    lastRunAt: string;
    lastRunStatus: string;
    lastRunMessage: string;
  };
  platformOptions: Array<{ value: string; label: string }>;
  siteOptions: Record<string, Array<{ value: string; label: string }>>;
  shopsSyncedAt: string;
  counts: {
    shops: number;
    enabledShops: number;
    invalidShops: number;
    total: number;
    pending: number;
    running: number;
    succeeded: number;
    retryWait: number;
    manualCheck: number;
  };
  shops: MiaoshouShop[];
  tasks: MiaoshouTask[];
  events: Array<{
    id: string;
    taskId: string;
    type: string;
    status: string;
    message: string;
    code: string;
    createdAt: string;
  }>;
  schedulerRunning: boolean;
  syncedCount?: number;
  runSummary?: {
    skipped?: boolean;
    message?: string;
    discovered?: number;
    existingTracking?: number;
    attempted?: number;
    succeeded?: number;
    failed?: number;
    invalidShops?: Array<{
      shopId: string;
      shopName: string;
      reason: string;
    }>;
  };
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
    sales3?: number;
    sales7?: number;
    sales15?: number;
    sales30?: number;
    sales60?: number;
    sales90: number;
    avgDaily3?: number;
    avgDaily7?: number;
    avgDaily30?: number;
    avgDaily90?: number;
    dailyWeighted?: number;
    trend30?: number[];
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

export type MovementWarehouseDiagnostic = {
  warehouseId: string;
  warehouseName: string;
  country: string;
  providerId: string;
  providerName?: string;
  hasCredentials: boolean;
  inventoryRows: number;
  inventorySku: number;
  orderRows: number;
  recentOrderRows: number;
  matchedOrderRows: number;
  skuFallbackMatchedRows: number;
  unmatchedOrderRows: number;
  outOfWindowOrderRows: number;
  missingSkuOrderRows: number;
  orderSku: number;
  unmatchedSamples: Array<{ sku: string; country: string; shippedAt: string }>;
  missingSkuOrders?: Array<{
    orderId: string;
    orderNo: string;
    country: string;
    productName: string;
    goodsSkuId: string;
    quantity: number;
    shippedAt: string;
    createdAt: string;
    status: string;
  }>;
  unmatchedSkus?: Array<{
    sku: string;
    country: string;
    orderRows: number;
    quantity: number;
    firstShippedAt: string;
    lastShippedAt: string;
    sampleShippedAt: string;
  }>;
  outOfWindowSkus?: Array<{
    sku: string;
    country: string;
    orderRows: number;
    quantity: number;
    firstShippedAt: string;
    lastShippedAt: string;
    sampleShippedAt: string;
    minAgeDays: number | null;
    maxAgeDays: number | null;
  }>;
  ok: boolean;
  running: boolean;
  failed: boolean;
  skipped: boolean;
  message: string;
  orderApiTotal?: number;
  orderApiReadRows?: number;
  orderApiReadSkuRows?: number;
  orderApiPagesRead?: number;
  orderApiPageLimit?: number;
  orderApiReachedPageLimit?: boolean;
  reason: string;
  reasonLabel: string;
  severity?: "good" | "warning" | "danger" | string;
  actionTitle?: string;
  actionItems?: string[];
  latestOrderSyncJob?: {
    jobId: string;
    status: string;
    days: number;
    running: boolean;
    current: boolean;
    currentChunkLabel: string;
    totalChunks: number;
    completedChunks: number;
    failedChunks: number;
    orderCount: number;
    createdAt: string;
    startedAt: string;
    completedAt: string;
    lastMessage: string;
    failedChunkSamples: Array<{ from: string; to: string; message: string }>;
  } | null;
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
    backgroundRunning?: boolean;
    orderApiTotal?: number;
    orderApiReadRows?: number;
    orderApiReadSkuRows?: number;
    orderApiPagesRead?: number;
    orderApiPageLimit?: number;
    orderApiReachedPageLimit?: boolean;
  }>;
  orderSyncJob?: OrderSyncJob | null;
  warehouseFreshness?: Array<{
    warehouseId: string;
    warehouseName: string;
    providerId: string;
    providerName: string;
    lastCompletedAt: string;
    orderCount: number;
    ok: boolean;
    running: boolean;
    failed: boolean;
    message: string;
  }>;
  warehouseDiagnostics?: MovementWarehouseDiagnostic[];
  syncState?: {
    usingCachedOrders: boolean;
    lastCompletedAt: string;
    backgroundRunningWarehouses: Array<{ warehouseId: string; message: string; orderCount: number }>;
    failedWarehouses: Array<{ warehouseId: string; message: string; orderCount: number }>;
  };
};

export type MovementHistoryRow = {
  sku: string;
  countrySku?: string;
  productName: string;
  brand: string;
  category: string;
  country: string;
  warehouseId: string;
  warehouseName: string;
  availableQty: number;
  lockedQty: number;
  inTransitQty: number;
  totalQty: number;
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
  status: string;
  suggestion: string;
  source: string;
  dataGap?: string;
};

export type MovementHistorySnapshot = {
  date: string;
  timezone: string;
  capturedAt: string;
  orderSyncedAt: string;
  inventorySyncedAt: string;
  reason: string;
  totals: {
    rowCount: number;
    warehouseCount: number;
    skuCount: number;
    availableQty: number;
    totalQty: number;
    sales3: number;
    sales7: number;
    sales30: number;
    sales90: number;
    stockout: number;
    replenish: number;
    slow: number;
    stagnant: number;
    noSalesData: number;
  };
  rows: MovementHistoryRow[];
};

export type MovementHistoryPayload = {
  ok: boolean;
  updatedAt: string;
  lastSnapshotAt: string;
  databasePath?: string;
  timezone: string;
  timezones: string[];
  selectedDate: string;
  dates: Array<{
    date: string;
    timezone: string;
    capturedAt: string;
    rowCount: number;
    warehouseCount: number;
    skuCount: number;
    sales30: number;
    sales90: number;
  }>;
  snapshot: MovementHistorySnapshot | null;
  trend: Array<{
    date: string;
    capturedAt: string;
    sales7: number;
    sales30: number;
    sales90: number;
    availableQty: number;
    totalQty: number;
    riskSku: number;
    rowCount: number;
  }>;
  warehouseOptions: Array<{ warehouseId: string; warehouseName: string; country: string }>;
};

export type MovementComparisonPeriod = "week" | "month" | "quarter" | "year" | "custom";

export type MovementComparisonRow = {
  id: string;
  sku: string;
  countrySku: string;
  productName: string;
  brand: string;
  category: string;
  country: string;
  warehouseId: string;
  warehouseName: string;
  previousStatus: string;
  currentStatus: string;
  previousMovementClass: string;
  currentMovementClass: string;
  previousAvailableQty: number | null;
  currentAvailableQty: number | null;
  previousSales30: number | null;
  currentSales30: number | null;
  previousDaysCover: number | null;
  currentDaysCover: number | null;
  previousSnapshotDate: string;
  currentSnapshotDate: string;
  statusChanged: boolean;
  changeType: "worsened" | "improved" | "changed" | "unchanged" | "added" | "removed" | "unavailable" | string;
  changeLabel: string;
  openingOnHandQty: number | null;
  closingOnHandQty: number | null;
  outboundQty: number;
  expectedClosingQty: number | null;
  inventoryVarianceQty: number | null;
  inventoryVarianceRate: number | null;
  inventoryAnomaly: boolean;
  inventorySeverity: "danger" | "warning" | "uncertain" | "normal" | "unavailable" | string;
  inventoryReliable: boolean;
  inventoryExplanation: string;
  orderCoverage: {
    complete: boolean;
    coverageDays: number;
    coverageFrom: string;
    coverageTo: string;
    requestedFrom: string;
    requestedTo: string;
  };
};

export type MovementComparisonPayload = {
  ok: boolean;
  timezone: string;
  ranges: {
    period: MovementComparisonPeriod;
    anchorDate: string;
    current: { from: string; to: string; label: string };
    previous: { from: string; to: string; label: string };
  };
  filters: { warehouseId: string; sku: string };
  thresholds: { quantity: number; rate: number };
  currentSnapshot: { date: string; timezone: string; capturedAt: string; orderSyncedAt: string; inventorySyncedAt: string } | null;
  previousSnapshot: { date: string; timezone: string; capturedAt: string; orderSyncedAt: string; inventorySyncedAt: string } | null;
  comparisonAvailable: boolean;
  baselineAvailable: boolean;
  summary: {
    currentSku: number;
    previousSku: number;
    normal: number;
    slow: number;
    stagnant: number;
    supplyRisk: number;
    noData: number;
    changed: number;
    unchanged: number;
    improved: number;
    worsened: number;
    added: number;
    removed: number;
    inventoryAnomaly: number;
    inventoryUncertain: number;
  };
  inventorySummary: {
    openingOnHandQty: number;
    closingOnHandQty: number;
    outboundQty: number;
    expectedClosingQty: number;
    varianceQty: number;
    matchedOrderRows: number;
    unmatchedOrderRows: number;
    unmatchedOutboundQty: number;
    orderCoverageComplete: boolean;
    ordersSyncedAt: string;
  };
  rows: MovementComparisonRow[];
};

export type OrderSyncJob = {
  id: string;
  status: "queued" | "running" | "completed" | "partial" | "failed" | string;
  days: number;
  warehouseIds: string[];
  chunkDays: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  currentWarehouseId?: string;
  currentWarehouseName?: string;
  currentChunkLabel?: string;
  totalChunks: number;
  completedChunks: number;
  totalOrders: number;
  failedChunks: number;
  progressPercent?: number;
  message?: string;
  results?: Array<{
    warehouseId: string;
    warehouseName: string;
    ok: boolean;
    skipped: boolean;
    message: string;
    orderCount: number;
    failedChunks: number;
    completedAt: string;
    orderApiTotal?: number;
    orderApiReadRows?: number;
    orderApiReadSkuRows?: number;
    orderApiPagesRead?: number;
    orderApiPageLimit?: number;
    orderApiReachedPageLimit?: boolean;
  }>;
  chunks?: Array<{
    warehouseId: string;
    warehouseName: string;
    from: string;
    to: string;
    status: string;
    orderCount: number;
    message: string;
    startedAt?: string;
    completedAt?: string;
    orderApiTotal?: number;
    orderApiReadRows?: number;
    orderApiReadSkuRows?: number;
    orderApiPagesRead?: number;
    orderApiPageLimit?: number;
    orderApiReachedPageLimit?: boolean;
  }>;
};

export type OrderAnalysisPayload = {
  ok: boolean;
  generatedAt: string;
  syncedAt: string;
  scope: "russia" | "all" | string;
  filters: {
    dateFrom: string;
    dateTo: string;
    country: string;
    warehouseId: string;
    platform: string;
    shopName: string;
    projectGroup: string;
    providerId: string;
    keyword: string;
  };
  counts: {
    orderCount: number;
    orderLines: number;
    quantity: number;
    skuCount: number;
    salesAmount: number;
    shopCount: number;
    projectGroupCount: number;
    platformCount: number;
    unrecognizedShopRows: number;
  };
  options: {
    countries: Array<{ value: string; label: string }>;
    warehouses: Array<{ warehouseId: string; warehouseName: string; country: string }>;
    platforms: Array<{ value: string; label: string }>;
    shops: Array<{ value: string; label: string; alias?: string; rawName?: string }>;
    projectGroups: Array<{ value: string; label: string }>;
  };
  daily: Array<{ key: string; orderCount: number; orderLines: number; quantity: number; salesAmount: number; skuCount: number }>;
  byShop: Array<{ key: string; orderCount: number; orderLines: number; quantity: number; salesAmount: number; skuCount: number }>;
  byProduct: Array<{ key: string; sku: string; productName: string; imageUrl: string; orderCount: number; orderLines: number; quantity: number; salesAmount: number; shopCount: number; platformCount: number }>;
  byProjectGroup: Array<{ key: string; orderCount: number; orderLines: number; quantity: number; salesAmount: number; skuCount: number }>;
  byPlatform: Array<{ key: string; orderCount: number; orderLines: number; quantity: number; salesAmount: number; skuCount: number }>;
  byWarehouse: Array<{ key: string; orderCount: number; orderLines: number; quantity: number; salesAmount: number; skuCount: number }>;
  byCountry: Array<{ key: string; orderCount: number; orderLines: number; quantity: number; salesAmount: number; skuCount: number }>;
  recentOrders: Array<{
    orderId: string;
    orderNo: string;
    externalOrderNo: string;
    date: string;
    shippedAt: string;
    createdAt: string;
    country: string;
    warehouseId: string;
    warehouseName: string;
    platform: string;
    shopName: string;
    rawShopName: string;
    shopAlias: string;
    projectGroup: string;
    sku: string;
    productName: string;
    productDisplayName: string;
    imageUrl: string;
    quantity: number;
    salesAmount: number;
    currency: string;
    status: string;
  }>;
};

export type PerformanceAmount = {
  currency: string;
  amount: number;
  rateToCny?: number;
  rateEffectiveDate?: string;
};

export type PerformanceContributionRow = {
  key: string;
  sku?: string;
  productName?: string;
  brand?: string;
  category?: string;
  imageUrl?: string;
  orderCount: number;
  orderLines: number;
  quantity: number;
  amountsByCurrency?: PerformanceAmount[];
  salesCny?: number;
  profitSalesCny?: number;
  profitProductCostCny?: number;
  profitPackagingFeeCny?: number;
  profitCogsCny?: number;
  productCostCny?: number;
  packagingFeeCny?: number;
  cogsCny?: number;
  commissionFeeCny?: number;
  logisticsFeeCny?: number;
  operatingCostCny?: number;
  estimatedProfitCny?: number;
  contributionSalesCny?: number;
  contributionOperatingCostCny?: number;
  contributionProfitCny?: number;
  grossMargin?: number;
  contributionMargin?: number;
  contributionRate?: number;
  revenueCoverageRate?: number;
  costCoverageRate?: number;
  productCostCoverageRate?: number;
  packagingCoverageRate?: number;
  profitCoverageRate?: number;
  contributionCoverageRate?: number;
  shopCount: number;
  platformCount: number;
  warehouseCount: number;
  skuCount: number;
  unitCostCny?: number;
  unitCostOriginal?: number;
  costCurrency?: string;
  costRateToCny?: number;
  costRateEffectiveDate?: string;
  costSource?: string;
  costCountry?: string;
  costEffectiveAt?: string;
  futureCostFallback?: boolean;
  date?: string;
};

export type ShopDirectoryProfile = {
  key: string;
  rawName: string;
  displayName: string;
  alias: string;
  aliasSource: "manual" | "miaoshou" | "wms" | string;
  platform: string;
  country: string;
  warehouseIds: string[];
  orderLines: number;
  latestOrderAt: string;
  projectGroup: string;
  projectGroupSource: "manual" | "inferred" | "unassigned" | string;
  miaoshouShopId: string;
  miaoshouShopName: string;
  miaoshouAlias: string;
  miaoshouMatched: boolean;
};

export type ShopDirectoryPayload = {
  shops: ShopDirectoryProfile[];
  projectGroups: string[];
  miaoshouShopCount: number;
  matchedShopCount: number;
  unmatchedShopCount: number;
  miaoshouSyncedAt: string;
  canManage: boolean;
};

export type PerformancePackagingFeeRule = {
  countryKey: string;
  countryName: string;
  mode: "tiered" | "flat";
  baseFeeCny: number;
  includedQuantity: number;
  additionalFeePerItemCny: number;
  enabled: boolean;
};

export type PerformanceSupplementalProductCost = {
  sku: string;
  countryKey: string;
  countryName: string;
  productName?: string;
  unitCostCny: number;
  effectiveDate: string;
  enabled: boolean;
  note?: string;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
};

export type PerformanceAnalyticsPayload = {
  ok: boolean;
  generatedAt: string;
  syncedAt: string;
  dataVersion?: string;
  targetDataVersion?: string;
  materializedAt?: string;
  materializationDurationMs?: number;
  materializationStale?: boolean;
  materializationRefreshStartedAt?: string;
  queryDurationMs?: number;
  workerQueryDurationMs?: number;
  scannedFactCount?: number;
  basis: "wms_outbound" | string;
  permissions: {
    revenue: boolean;
    cost: boolean;
    profit: boolean;
    manageRates: boolean;
    manageCosts: boolean;
    manageTransactionSource: boolean;
  };
  metadata: {
    sourceSyncedAt: string;
    rebuiltAt: string;
    rowCount: number;
    miaoshouOrderCount?: number;
    miaoshouItemCount?: number;
    miaoshouReturnCount?: number;
    supplementalCostCount?: number;
    enabledSupplementalCostCount?: number;
  };
  reconciliation: {
    sourceRowCount: number;
    factRowCount: number;
    sourceSyncedAt: string;
    factSourceSyncedAt: string;
    rowCountMatched: boolean;
    syncedAtMatched: boolean;
  };
  sourceQuality?: {
    status: "official" | "provisional" | string;
    warehouseCount: number;
    completeWarehouseCount: number;
    incompleteWarehouses: Array<{ warehouseId: string; message: string; apiTotal: number; readRows: number }>;
  };
  transactionSource: {
    requested: "wms" | "shadow" | "miaoshou" | string;
    effective: "wms" | "miaoshou" | string;
    activationEligible: boolean;
    roles: {
      revenue: string;
      refunds: string;
      fulfillment: string;
      productCost: string;
      packaging: string;
    };
    sync: {
      enabled: boolean;
      running: boolean;
      status?: "running" | "success" | "partial" | "failed" | string;
      intervalMinutes: number;
      initialBackfillDays: number;
      incrementalLookbackDays: number;
      lastAttemptAt?: string;
      lastSuccessAt?: string;
      lastCompletedAt?: string;
      lastError?: string;
      dateFrom?: string;
      dateTo?: string;
      orderCount?: number;
      itemCount?: number;
      returnCount?: number;
      cancellationCount?: number;
      warningCount?: number;
      warnings?: string[];
    };
    reconciliation: {
      requestedSource: string;
      effectiveSource: string;
      activationEligible: boolean;
      blockers: string[];
      thresholds: {
        orderMatchRate: number;
        quantityVarianceRate: number;
        amountVarianceRate: number;
        refundFinalizationRate: number;
      };
      eligibleOrderCount: number;
      matchedOrderCount: number;
      unmatchedOrderCount: number;
      matchedLineCount: number;
      orderMatchRate: number;
      wmsQuantity: number;
      miaoshouQuantity: number;
      quantityVarianceRate: number;
      comparableAmountOrders: number;
      amountVarianceRate: number;
      refundCount: number;
      finalizedRefundCount: number;
      refundFinalizationRate: number;
      cancelledOutboundOrders: number;
    };
  } | null;
  shopDirectory: ShopDirectoryPayload;
  filters: {
    dateFrom: string;
    dateTo: string;
    country: string;
    warehouseId: string;
    platform: string;
    shopName: string;
    projectGroup: string;
    brand: string;
    keyword: string;
  };
  totals: PerformanceContributionRow;
  quality: {
    totalLines: number;
    missingSkuLines: number;
    unmatchedProductLines: number;
    missingBrandLines: number;
    missingCurrencyLines?: number;
    missingExchangeRateLines?: number;
    zeroSalesAmountLines?: number;
    missingCostLines?: number;
    missingPackagingRuleLines?: number;
    invalidSalesAmountLines?: number;
    allocationMismatchLines?: number;
    futureCostFallbackLines?: number;
    legacyAllocatedLines: number;
    revenueCoverageRate?: number;
    costCoverageRate?: number;
    productCostCoverageRate?: number;
    packagingCoverageRate?: number;
    profitCoverageRate?: number;
    contributionCoverageRate?: number;
  };
  packagingFeeRules: PerformancePackagingFeeRule[];
  supplementalProductCosts: PerformanceSupplementalProductCost[];
  currencySummary: PerformanceAmount[];
  exchangeRates: Array<{
    currency: string;
    effectiveDate: string;
    rateToCny: number;
    source: string;
    updatedAt: string;
  }>;
  exchangeRateSync: {
    enabled: boolean;
    running: boolean;
    provider: string;
    providerUrl: string;
    intervalHours: number;
    backfillDays: number;
    lastAttemptAt: string;
    lastSuccessAt: string;
    lastRateDate: string;
    lastError: string;
    lastReason: string;
    lastUpdatedCount: number;
    currencies: string[];
    missingCurrencies: string[];
    nextSyncAt: string;
  } | null;
  resultCounts?: {
    products: number;
    brands: number;
  };
  topProduct: PerformanceContributionRow | null;
  topBrand: PerformanceContributionRow | null;
  products: PerformanceContributionRow[];
  brands: PerformanceContributionRow[];
  daily: PerformanceContributionRow[];
  recentFacts: Array<{
    id: string;
    orderDate: string;
    orderNo: string;
    shopKey?: string;
    shopName?: string;
    projectGroup?: string;
    sku: string;
    productName: string;
    brand: string;
    quantity: number;
    salesAmount?: number;
    currency?: string;
    salesCny?: number;
    unitCostCny?: number;
    productCostCny?: number;
    packagingFeeCny?: number;
    cogsCny?: number;
    commissionFeeCny?: number;
    logisticsFeeCny?: number;
    operatingCostCny?: number;
    estimatedProfitCny?: number;
    contributionProfitCny?: number;
    revenueCovered?: boolean;
    costCovered?: boolean;
    productCostCovered?: boolean;
    packagingCostCovered?: boolean;
    profitCovered?: boolean;
    contributionCovered?: boolean;
  }>;
  options: {
    countries: string[];
    warehouses: Array<{ warehouseId: string; warehouseName: string; country: string }>;
    platforms: string[];
    shops: Array<{
      value: string;
      label: string;
      rawName: string;
      alias: string;
      projectGroup: string;
      miaoshouMatched: boolean;
    }>;
    projectGroups: string[];
    brands: string[];
  };
};

export type StockupRecommendation = {
  id: string;
  recommendationKey?: string;
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
  decisionStatus?: "pending" | "accepted" | "abandoned";
  decisionAt?: string;
  decisionNote?: string;
  workflowDemandRecordId?: string;
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

export type StockupPlan = {
  id: string;
  recommendationKey: string;
  sku: string;
  country: string;
  name: string;
  unit: string;
  quantity: number;
  planType: "purchase" | "outsourcing";
  owner: string;
  expectedArrivalAt: string;
  status: "draft" | "ordered" | "in_production" | "arrived" | "cancelled";
  note: string;
  source: string;
  createdAt: string;
  updatedAt: string;
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
    acceptedRecommendations?: number;
    abandonedRecommendations?: number;
    stockupPlans?: number;
    openStockupPlans?: number;
    plannedQty?: number;
    inboundOrders: number;
    pendingInboundQty: number;
  };
  recommendations: StockupRecommendation[];
  abandonedRecommendations?: StockupRecommendation[];
  plans?: StockupPlan[];
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

export type StockupWorkflowShipmentLine = {
  id: string;
  stockupLineRecordId: string;
  demandRecordId: string;
  productRecordId: string;
  temporaryProductNo: string;
  sku: string;
  productName: string;
  shippedQty: number;
  receivedQty: number;
  damagedQty: number;
  totalWeightKg: number;
  totalVolumeM3: number;
  baseUnitCostCny: number;
  baseCostTotalCny: number;
  receiptWriteoffStatus: string;
};

export type StockupWorkflowShipment = {
  id: string;
  shipmentNo: string;
  stockupOrderRecordId: string;
  demandRecordIds: string[];
  project: string;
  carrier: string;
  trackingNo: string;
  transportMode: string;
  destinationCountry: string;
  destinationWarehouseRecordId: string;
  destinationWarehouseName: string;
  status: string;
  actualWeightKg: number;
  chargeableWeightKg: number;
  actualVolumeM3: number;
  defaultAllocationMethod: "weight" | "volume" | "quantity" | "value" | "manual";
  feeConfirmationStatus: string;
  costingStatus: string;
  currentCostVersion: number;
  wmsInboundNo: string;
  shippedAt: string;
  lines: StockupWorkflowShipmentLine[];
};

export type ShipmentFeeAllocation = {
  shipmentLineId: string;
  costBatchRecordId?: string;
  productRecordId: string;
  sku: string;
  productName: string;
  basis: number;
  totalBasis: number;
  ratio: number;
  theoreticalAmount: number;
  roundingAdjustment: number;
  finalAmount: number;
  costingQty: number;
  unitAllocationAmount: number;
  exceptionReason: string;
};

export type StockupWorkflowFee = {
  id: string;
  feeNo: string;
  shipmentRecordId: string;
  shipmentNo: string;
  feeStage: string;
  feeType: string;
  feeName: string;
  vendor: string;
  invoiceNo: string;
  occurredAt: string;
  originalAmount: number;
  currency: string;
  exchangeRate: number;
  amountCny: number;
  includedInLandedCost: boolean;
  allocationMethod: "weight" | "volume" | "quantity" | "value" | "manual";
  allocationStatus: string;
  costVersion: number;
  dataSource: string;
  description: string;
  allocations: ShipmentFeeAllocation[];
};

export type ShipmentCostBatch = {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
  costBatchNo?: string;
  uniqueKey: string;
  costType: string;
  version: number;
  formulaVersion: string;
  shipmentRecordId: string;
  shipmentNo: string;
  shipmentLineId: string;
  stockupOrderRecordId?: string;
  stockupLineRecordId?: string;
  demandRecordId?: string;
  productRecordId: string;
  temporaryProductNo: string;
  sku: string;
  productName: string;
  project?: string;
  platform?: string;
  destinationCountry?: string;
  destinationWarehouseRecordId?: string;
  destinationWarehouseName?: string;
  shippedQty: number;
  receivedQty: number;
  damagedQty?: number;
  cancelledQty?: number;
  costingQty: number;
  totalWeightKg: number;
  totalVolumeM3: number;
  goodsValueCny?: number;
  baseCostSource?: string;
  baseCurrency?: string;
  baseExchangeRate?: number;
  baseOriginalUnitCost?: number;
  baseUnitCostCny?: number;
  baseCostTotalCny: number;
  domesticFreight?: number;
  firstMileFreight?: number;
  pickupFee?: number;
  customsTaxes?: number;
  insuranceFee?: number;
  warehouseFee?: number;
  laborPackagingFee?: number;
  inspectionFee?: number;
  otherFee?: number;
  includedFeeTotal: number;
  excludedFeeTotal: number;
  actualCostTotalCny: number;
  unitLogisticsCostCny: number;
  landedUnitCostCny: number;
  riskRate?: number;
  landedUnitCostWithRiskCny?: number;
  status: string;
  isCurrent?: boolean;
  allocationDifferenceCny?: number;
  quantityDifference?: number;
  exceptionCode: number;
  exceptionReason: string;
  calculatedAt?: string;
  calculatedBy?: string;
  confirmedAt?: string;
  confirmedBy?: string;
  lockedAt?: string;
  lockedBy?: string;
  note?: string;
};

export type StockupCostPreview = {
  ok: boolean;
  formulaVersion: string;
  shipment: StockupWorkflowShipment;
  costType: string;
  version: number;
  riskRate: number;
  totals: {
    baseCostCny: number;
    includedFeesCny: number;
    excludedFeesCny: number;
    landedCostCny: number;
    allocationDifferenceCny: number;
  };
  errors: string[];
  feeResults: Array<StockupWorkflowFee & { allocationMethodLabel: string; bucket: string; allocationDifferenceCny: number }>;
  costBatches: ShipmentCostBatch[];
};

export type StockupWmsWarehouseOption = {
  connectionId: string;
  warehouseRecordId: string;
  warehouseName: string;
  connectionName: string;
  warehouseCode: string;
  warehouseId: string;
  country: string;
  providerId: string;
  providerName: string;
  receivingAddress: string;
  createSupported: boolean;
  createConfigured: boolean;
  createMode: string;
  createMessage: string;
};

export type StockupWmsPushTask = {
  id: string;
  shipmentRecordId: string;
  shipmentNo: string;
  stockupOrderRecordId: string;
  warehouseConnectionId: string;
  warehouseName: string;
  warehouseCode: string;
  country: string;
  providerId: string;
  providerName: string;
  externalReferenceNo: string;
  status: "pending_confirmation" | "pushing" | "pushed" | "failed" | "needs_manual_check" | "cancelled";
  attempts: number;
  lastError: string;
  wmsOrderNo: string;
  createdAt: string;
  confirmedAt: string;
  pushedAt: string;
  lineCount: number;
  canPush: boolean;
  createMode: string;
  createMessage: string;
};

export type StockupWorkflowPayload = {
  ok: boolean;
  source: string;
  scope?: string;
  historyHidden?: boolean;
  syncedAt: string;
  warnings: string[];
  counts: {
    demands: number;
    pendingDemands: number;
    pendingExecutionLines: number;
    pendingShipmentLines: number;
    pendingCostShipments: number;
    pendingLockShipments: number;
    activeExecutionLines: number;
    activeWorkItems: number;
    stockupOrders: number;
    stockupLines: number;
    shipments: number;
    shipmentLines: number;
    fees: number;
    feeAmountCny: number;
    costBatches: number;
    lockedCostBatches: number;
    codingQueue: number;
  };
  demands: Array<{
    id: string;
    demandBatchNo: string;
    demandLineNo: string;
    productSourceType: string;
    productRecordId: string;
    temporaryProductNo: string;
    skuCodingStatus: string;
    sku: string;
    productName: string;
    project: string;
    platform: string;
    destinationCountry: string;
    destinationWarehouseName: string;
    stockupMethod: string;
    priority: string;
    businessStatus: string;
    supplyOwner: string;
    requestedQty: number;
    plannedQty: number;
    shippedQty: number;
    receivedQty: number;
    submittedAt: string;
    expectedArrivalAt: string;
    reason: string;
  }>;
  stockupOrders: Array<{
    id: string;
    orderNo: string;
    demandBatchNo: string;
    executionMode: string;
    destinationCountry: string;
    destinationWarehouseName: string;
    project: string;
    status: string;
    plannedQty: number;
    orderedQty: number;
    completedQty: number;
    shippedQty: number;
    receivedQty: number;
    expectedCompletedAt: string;
    actualCompletedAt?: string;
    dataVersion?: number;
  }>;
  stockupLines: Array<{
    id: string;
    legacyOrderNo?: string;
    orderRecordId: string;
    demandRecordId: string;
    productRecordId: string;
    temporaryProductNo: string;
    sku: string;
    productName: string;
    supplyMode: string;
    plannedQty: number;
    orderedQty: number;
    completedQty: number;
    qualifiedQty: number;
    shippedQty: number;
    receivedQty: number;
    cancelledQty?: number;
    baseCurrency: string;
    baseExchangeRate: number;
    actualBaseUnitCost: number;
    actualReadyAt?: string;
    status: string;
  }>;
  shipments: StockupWorkflowShipment[];
  fees: StockupWorkflowFee[];
  costBatches: ShipmentCostBatch[];
  costLedger: ShipmentCostBatch[];
  productCodingQueue: Array<{
    id: string;
    temporaryProductNo: string;
    officialSku: string;
    skuCodingStatus: string;
    archiveStatus: string;
    productName: string;
    sourceDemandRecordId: string;
    sourceDemandBatchNo: string;
    codingAppliedAt: string;
    codingCompletedAt: string;
  }>;
  productOptions?: Array<{ id: string; sku: string; productName: string }>;
  warehouseOptions?: StockupWmsWarehouseOption[];
  wmsPushTasks?: StockupWmsPushTask[];
};

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "" : `${window.location.protocol}//${window.location.hostname}:8787`);

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
  const text = await response.text();
  let payload: any = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    const contentType = response.headers.get("content-type") || "";
    const preview = text.replace(/\s+/g, " ").slice(0, 160);
    throw new Error(
      contentType.includes("text/html") || text.trim().startsWith("<")
        ? `服务器返回了 HTML 页面，可能是接口反代异常或同步超时。HTTP ${response.status}${preview ? `：${preview}` : ""}`
        : `服务器返回了非 JSON 内容。HTTP ${response.status}${preview ? `：${preview}` : ""}`,
    );
  }
  if (!response.ok) {
    throw new Error(payload.message || "请求失败");
  }
  return payload as T;
}

export function resolveApiUrl(value: string) {
  if (!value || /^https?:\/\//i.test(value) || value.startsWith("data:")) return value;
  if (value.startsWith("/api/")) return `${API_BASE}${value}`;
  return value;
}

export function fetchDashboardSummary() {
  return requestJson<DashboardSummaryPayload>("/api/dashboard-summary");
}

export function fetchProducts(mode: "list" | "detail" = "list") {
  return requestJson<ProductPayload>(`/api/products?mode=${mode}`);
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

export function fetchQuickNav() {
  return requestJson<QuickNavPayload>("/api/quick-nav");
}

export function createQuickNavCategory(input: { name: string; description?: string; sortOrder?: number }) {
  return requestJson<QuickNavPayload>("/api/quick-nav/categories", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteQuickNavCategory(id: string) {
  return requestJson<QuickNavPayload>(`/api/quick-nav/categories/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function createQuickNavLink(categoryId: string, input: { title: string; url: string; description?: string; sortOrder?: number }) {
  return requestJson<QuickNavPayload>(`/api/quick-nav/categories/${encodeURIComponent(categoryId)}/links`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteQuickNavLink(categoryId: string, linkId: string) {
  return requestJson<QuickNavPayload>(`/api/quick-nav/categories/${encodeURIComponent(categoryId)}/links/${encodeURIComponent(linkId)}`, {
    method: "DELETE",
  });
}

export function fetchWecomNotifications() {
  return requestJson<WecomNotificationPayload>("/api/wecom-notifications");
}

export function fetchActionLog() {
  return requestJson<ActionLogPayload>("/api/action-log");
}

export function upsertWecomRobot(input: { id?: string; name: string; webhookUrl?: string; enabled: boolean }) {
  return requestJson<WecomNotificationPayload>("/api/wecom-notifications/robots", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteWecomRobot(id: string) {
  return requestJson<WecomNotificationPayload>(`/api/wecom-notifications/robots/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function upsertWecomSchedule(input: {
  id?: string;
  name: string;
  robotIds: string[];
  enabled: boolean;
  mode: "daily" | "interval";
  time?: string;
  intervalMinutes?: number;
  text: string;
  linkUrl?: string;
  linkText?: string;
}) {
  return requestJson<WecomNotificationPayload>("/api/wecom-notifications/schedules", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteWecomSchedule(id: string) {
  return requestJson<WecomNotificationPayload>(`/api/wecom-notifications/schedules/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function updateWecomScenes(scenes: Partial<WecomNotificationPayload["scenes"]>) {
  return requestJson<WecomNotificationPayload>("/api/wecom-notifications/scenes", {
    method: "POST",
    body: JSON.stringify({ scenes }),
  });
}

export function testWecomNotification(input: { robotIds: string[]; text: string; linkUrl?: string; linkText?: string }) {
  return requestJson<WecomNotificationPayload & { results: Array<{ robotId: string; ok: boolean; message?: string }> }>("/api/wecom-notifications/test", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function sendWecomOperatingSummary(input: { robotIds: string[]; extraText?: string; linkUrl?: string; linkText?: string }) {
  return requestJson<WecomNotificationPayload & { results: Array<{ robotId: string; ok: boolean; message?: string }> }>("/api/wecom-notifications/operating-summary", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchAiConfig() {
  return requestJson<AiConfigPayload>("/api/ai/config");
}

export function updateAiConfig(input: { apiKey?: string; baseUrl?: string; models?: Partial<AiConfigPayload["models"]> }) {
  return requestJson<AiConfigPayload>("/api/ai/config", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function runAiText(input: { prompt?: string; messages?: AiChatMessage[]; model?: string; temperature?: number; maxTokens?: number; topP?: number }) {
  return requestJson<AiTextResult>("/api/ai/text", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function streamAiText(
  input: { messages: AiChatMessage[]; model?: string; temperature?: number; maxTokens?: number; topP?: number },
  onDelta: (delta: string) => void,
) {
  const response = await fetch(`${API_BASE}/api/ai/text/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(input),
  });

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({ message: "同舟AI 流式对话失败。" }));
    throw new Error(payload.message || "同舟AI 流式对话失败。");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\n\n/);
    buffer = events.pop() || "";
    for (const event of events) {
      const eventName = event.match(/^event:\s*(.+)$/m)?.[1]?.trim();
      const dataText = event.match(/^data:\s*(.+)$/m)?.[1];
      if (!dataText) continue;
      const payload = JSON.parse(dataText);
      if (eventName === "error") throw new Error(payload.message || "同舟AI 流式对话失败。");
      if (eventName === "delta" && payload.delta) onDelta(payload.delta);
    }
  }
}

export function uploadAiImage(input: { fileName: string; dataUrl: string }) {
  return requestJson<AiUploadResult>("/api/ai/uploads", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function runAiImage(input: { prompt: string; model?: string; size?: string; n?: number; quality?: string; style?: string; seed?: number; referenceImages?: string[]; negativePrompt?: string }) {
  return requestJson<AiImageResult>("/api/ai/image", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function runAiVideo(input: { prompt: string; model?: string; duration?: number; aspectRatio?: string; resolution?: string; seed?: number; imageUrl?: string; referenceImages?: string[]; firstFrameUrl?: string; lastFrameUrl?: string; negativePrompt?: string; cameraControl?: string; motionStrength?: number }) {
  return requestJson<AiVideoResult>("/api/ai/video", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchAiVideoStatus(taskId: string) {
  return requestJson<AiVideoResult>(`/api/ai/video/${encodeURIComponent(taskId)}`);
}

export function fetchUsers() {
  return requestJson<UserManagementPayload>("/api/users");
}

export function fetchAgentApiKeys() {
  return requestJson<AgentApiKeyPayload>("/api/agent-keys");
}

export function createAgentApiKey(input: { name: string; expiresInDays: number }) {
  return requestJson<{ ok: boolean; apiKey: string; key: AgentApiKey; message: string }>("/api/agent-keys", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function revokeAgentApiKey(id: string) {
  return requestJson<{ ok: boolean; key: AgentApiKey }>(`/api/agent-keys/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function fetchSetupStatus() {
  return requestJson<SetupStatusPayload>("/api/setup");
}

export async function initializeAdmin(input: { username: string; password: string; displayName?: string }) {
  const payload = await requestJson<{ ok: boolean; token: string; user: AuthUser; setup: SetupStatusPayload }>("/api/setup/admin", {
    method: "POST",
    body: JSON.stringify(input),
  });
  localStorage.setItem(AUTH_TOKEN_KEY, payload.token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(payload.user));
  return payload;
}

export function submitDistributorApplication(input: {
  companyName: string;
  contactName: string;
  phone?: string;
  wechat?: string;
  email?: string;
  market?: string;
  note?: string;
  sourceSku?: string;
}) {
  return requestJson<{ ok: boolean; application: DistributorApplication }>("/api/distributor-applications", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchDistributorApplications() {
  return requestJson<DistributorApplicationPayload>("/api/distributor-applications");
}

export function updateDistributorApplicationStatus(id: string, status: DistributorApplication["status"]) {
  return requestJson<DistributorApplicationPayload & { application: DistributorApplication }>(`/api/distributor-applications/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function createUser(input: { username: string; password: string; displayName: string; role: UserRole; permissionOverrides?: PermissionOverrides; dataScopes?: UserDataScopes }) {
  return requestJson<UserManagementPayload & { user: AuthUser }>("/api/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateUserPermissions(id: string, input: { permissionOverrides: PermissionOverrides; dataScopes: UserDataScopes }) {
  return requestJson<UserManagementPayload & { user: AuthUser }>(`/api/users/${encodeURIComponent(id)}/permissions`, {
    method: "PATCH",
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

export function fetchMovementHistory(input: { date?: string; from?: string; to?: string; warehouseId?: string; sku?: string; timezone?: string } = {}) {
  const params = new URLSearchParams();
  if (input.date) params.set("date", input.date);
  if (input.from) params.set("from", input.from);
  if (input.to) params.set("to", input.to);
  if (input.warehouseId) params.set("warehouseId", input.warehouseId);
  if (input.sku) params.set("sku", input.sku);
  if (input.timezone) params.set("timezone", input.timezone);
  const query = params.toString() ? `?${params.toString()}` : "";
  return requestJson<MovementHistoryPayload>(`/api/movement-history${query}`);
}

export function fetchMovementComparison(input: {
  period?: MovementComparisonPeriod;
  anchorDate?: string;
  from?: string;
  to?: string;
  compareFrom?: string;
  compareTo?: string;
  warehouseId?: string;
  sku?: string;
  timezone?: string;
} = {}) {
  const params = new URLSearchParams();
  if (input.period) params.set("period", input.period);
  if (input.anchorDate) params.set("anchorDate", input.anchorDate);
  if (input.from) params.set("from", input.from);
  if (input.to) params.set("to", input.to);
  if (input.compareFrom) params.set("compareFrom", input.compareFrom);
  if (input.compareTo) params.set("compareTo", input.compareTo);
  if (input.warehouseId) params.set("warehouseId", input.warehouseId);
  if (input.sku) params.set("sku", input.sku);
  if (input.timezone) params.set("timezone", input.timezone);
  const query = params.toString() ? `?${params.toString()}` : "";
  return requestJson<MovementComparisonPayload>(`/api/movement-history/compare${query}`);
}

export function captureMovementHistory(input: { date?: string; timezone?: string } = {}) {
  return requestJson<MovementHistoryPayload>("/api/movement-history/capture", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function downloadMovementHistoryCsv(input: { date?: string; from?: string; to?: string; warehouseId?: string; sku?: string; timezone?: string } = {}) {
  const params = new URLSearchParams();
  if (input.date) params.set("date", input.date);
  if (input.from) params.set("from", input.from);
  if (input.to) params.set("to", input.to);
  if (input.warehouseId) params.set("warehouseId", input.warehouseId);
  if (input.sku) params.set("sku", input.sku);
  if (input.timezone) params.set("timezone", input.timezone);
  const query = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`${API_BASE}/api/movement-history/export${query}`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    let message = "动销历史导出失败";
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

export function syncOrders(days = 90) {
  return requestJson<{ ok: boolean; jobId: string; job: OrderSyncJob; reused?: boolean }>(
    `/api/orders/sync?days=${days}`,
    { method: "POST" },
  );
}

export function startOrderSyncJob(input: { days?: number; warehouseIds?: string[] } = {}) {
  return requestJson<{ ok: boolean; jobId: string; job: OrderSyncJob; reused?: boolean }>("/api/orders/sync-jobs", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchLatestOrderSyncJob() {
  return requestJson<{ ok: boolean; job: OrderSyncJob | null }>("/api/orders/sync-jobs/latest");
}

export function fetchOrderAnalysis(input: { dateFrom?: string; dateTo?: string; country?: string; warehouseId?: string; platform?: string; shopName?: string; projectGroup?: string; keyword?: string; scope?: "russia" | "all" } = {}) {
  const params = new URLSearchParams();
  if (input.dateFrom) params.set("dateFrom", input.dateFrom);
  if (input.dateTo) params.set("dateTo", input.dateTo);
  if (input.country) params.set("country", input.country);
  if (input.warehouseId) params.set("warehouseId", input.warehouseId);
  if (input.platform) params.set("platform", input.platform);
  if (input.shopName) params.set("shopName", input.shopName);
  if (input.projectGroup) params.set("projectGroup", input.projectGroup);
  if (input.keyword) params.set("keyword", input.keyword);
  if (input.scope) params.set("scope", input.scope);
  const query = params.toString() ? `?${params.toString()}` : "";
  return requestJson<OrderAnalysisPayload>(`/api/order-analysis${query}`);
}

export function fetchPerformanceAnalytics(input: { dateFrom?: string; dateTo?: string; country?: string; warehouseId?: string; platform?: string; shopName?: string; projectGroup?: string; brand?: string; keyword?: string } = {}, signal?: AbortSignal) {
  const params = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const query = params.toString() ? `?${params.toString()}` : "";
  return requestJson<PerformanceAnalyticsPayload>(`/api/performance-analytics${query}`, { signal });
}

export function updatePerformanceExchangeRates(rates: Array<{ currency: string; rateToCny: number; effectiveDate?: string }>) {
  return requestJson<{ ok: boolean; exchangeRates: PerformanceAnalyticsPayload["exchangeRates"]; updatedAt: string }>("/api/performance-analytics/exchange-rates", {
    method: "PATCH",
    body: JSON.stringify({ rates }),
  });
}

export function updatePerformancePackagingFeeRules(rules: PerformancePackagingFeeRule[]) {
  return requestJson<{ ok: boolean; packagingFeeRules: PerformancePackagingFeeRule[]; updatedAt: string }>("/api/performance-analytics/packaging-fees", {
    method: "PATCH",
    body: JSON.stringify({ rules }),
  });
}

export function importPerformanceSupplementalProductCosts(rows: Array<Pick<PerformanceSupplementalProductCost, "sku" | "countryKey" | "countryName" | "productName" | "unitCostCny" | "effectiveDate" | "enabled" | "note">>) {
  return requestJson<{
    ok: boolean;
    importedCount: number;
    supplementalProductCosts: PerformanceSupplementalProductCost[];
    updatedAt: string;
    errors?: Array<{ row: number; sku?: string; message: string }>;
  }>("/api/performance-analytics/supplemental-costs", {
    method: "PATCH",
    body: JSON.stringify({ rows }),
  });
}

export function syncPerformanceExchangeRates() {
  return requestJson<{
    ok: boolean;
    sync: NonNullable<PerformanceAnalyticsPayload["exchangeRateSync"]> & { skipped?: boolean; message?: string };
    exchangeRates: PerformanceAnalyticsPayload["exchangeRates"];
  }>("/api/performance-analytics/exchange-rates/sync", { method: "POST" });
}

export function syncMiaoshouPerformance(input: { dateFrom?: string; dateTo?: string; days?: number } = {}) {
  return requestJson<{
    ok: boolean;
    sync: NonNullable<PerformanceAnalyticsPayload["transactionSource"]>["sync"] & { skipped?: boolean; message?: string };
  }>("/api/performance-analytics/miaoshou/sync", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updatePerformanceRevenueSource(revenueSource: "wms" | "shadow" | "miaoshou") {
  return requestJson<{ ok: boolean; revenueSource: string; updatedAt: string }>("/api/performance-analytics/revenue-source", {
    method: "PATCH",
    body: JSON.stringify({ revenueSource }),
  });
}

export function updateShopProjectGroup(input: { shopKeys: string[]; projectGroup: string }) {
  return requestJson<{
    ok: boolean;
    updatedCount: number;
    projectGroup: string;
    shopDirectory: ShopDirectoryPayload;
  }>("/api/shop-directory/project-group", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function updateOrderShopAlias(input: { shopName: string; alias: string }) {
  return requestJson<{ ok: boolean; shopName: string; alias: string }>("/api/order-analysis/shop-alias", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchStockup() {
  return requestJson<StockupPayload>("/api/stockup");
}

export function fetchStockupWorkflow() {
  return requestJson<StockupWorkflowPayload>("/api/stockup/workflow");
}

export function createWorkflowDemand(input: {
  productSourceType: "已有产品" | "外采新品";
  productRecordId?: string;
  sku?: string;
  productName: string;
  requestedQty: number;
  unit?: string;
  specification?: string;
  project?: string;
  platform?: string;
  destinationCountry?: string;
  destinationWarehouseRecordId?: string;
  destinationWarehouseName?: string;
  stockupMethod?: string;
  priority?: string;
  expectedArrivalAt?: string;
  reason?: string;
  dryRun?: boolean;
}) {
  return requestJson<{ ok: boolean; dryRun: boolean; demandRecordId?: string; productRecordId?: string; demandBatchNo: string; temporaryProductNo: string; warning?: string }>("/api/stockup/workflow/demands", { method: "POST", body: JSON.stringify(input) });
}

export function createWorkflowExecution(input: { demandRecordId: string; plannedQty: number; executionMode: string; supplyMode?: string; expectedCompletedAt?: string; baseCurrency?: string; baseExchangeRate?: number; baseUnitCost?: number; dryRun?: boolean }) {
  return requestJson<{ ok: boolean; dryRun: boolean; orderNo: string; orderRecordId?: string; lineRecordId?: string; detailLinked?: boolean }>("/api/stockup/workflow/executions", { method: "POST", body: JSON.stringify(input) });
}

export function cancelWorkflowExecution(input: { stockupOrderRecordId: string; reason?: string; dryRun?: boolean }) {
  return requestJson<{ ok: boolean; dryRun: boolean; stockupOrderRecordId: string; orderNo?: string; orderStatus: string; cancelledQty: number; reopenedDemandCount: number; reason: string }>("/api/stockup/workflow/executions/cancel", { method: "POST", body: JSON.stringify(input) });
}

export function updateWorkflowExecutionLine(input: { stockupLineRecordId: string; orderedQty: number; completedQty: number; qualifiedQty: number; actualBaseUnitCost: number; status?: string; exceptionReason?: string; actualReadyAt?: string; dryRun?: boolean }) {
  return requestJson<{ ok: boolean; dryRun: boolean; stockupLineRecordId?: string; stockupOrderRecordId?: string; status: string; orderStatus: string; totals: { orderedQty: number; completedQty: number; shippedQty: number; receivedQty: number; allReady: boolean } }>("/api/stockup/workflow/execution-lines", { method: "PATCH", body: JSON.stringify(input) });
}

export function rollbackWorkflowExecutionLine(input: { stockupLineRecordId: string; reason?: string; dryRun?: boolean }) {
  return requestJson<{ ok: boolean; dryRun: boolean; stockupLineRecordId?: string; stockupOrderRecordId?: string; rollbackStage: string; status: string; orderStatus: string; reason: string }>("/api/stockup/workflow/execution-lines/rollback", { method: "POST", body: JSON.stringify(input) });
}

export function createWorkflowShipment(input: { stockupOrderRecordId: string; carrier?: string; trackingNo?: string; transportMode?: string; destinationWarehouseConnectionId: string; destinationWarehouseRecordId?: string; destinationWarehouseName?: string; destinationCountry?: string; shippedAt?: string; defaultAllocationMethod?: string; lines: Array<{ stockupLineRecordId: string; shippedQty: number; totalWeightKg: number; totalVolumeM3: number; baseUnitCostCny?: number }>; dryRun?: boolean }) {
  return requestJson<{ ok: boolean; dryRun: boolean; shipmentRecordId?: string; shipmentNo?: string; lineCount?: number; wmsPushTask?: StockupWmsPushTask | null; wmsTaskWarning?: string }>("/api/stockup/workflow/shipments", { method: "POST", body: JSON.stringify(input) });
}

export function confirmWorkflowWmsPush(taskId: string) {
  return requestJson<{ ok: boolean; alreadyPushed: boolean; writebackWarning?: string; task: StockupWmsPushTask }>("/api/stockup/workflow/wms-pushes/confirm", {
    method: "POST",
    body: JSON.stringify({ taskId }),
  });
}

export function voidWorkflowShipment(input: { shipmentRecordId: string; reason?: string; dryRun?: boolean }) {
  return requestJson<{ ok: boolean; dryRun: boolean; shipmentRecordId: string; shipmentNo?: string; status: string; reversedLineCount: number; reason: string }>("/api/stockup/workflow/shipments/void", { method: "POST", body: JSON.stringify(input) });
}

export function completeWorkflowProductCoding(input: { productRecordId: string; sku: string; dryRun?: boolean }) {
  return requestJson<{ ok: boolean; dryRun: boolean; productRecordId?: string; demandRecordId?: string; sku?: string }>("/api/stockup/workflow/product-coding", { method: "POST", body: JSON.stringify(input) });
}

export function previewStockupCost(input: {
  shipmentRecordId?: string;
  shipment?: StockupWorkflowShipment;
  fees?: Array<Partial<StockupWorkflowFee>>;
  costType?: "预估" | "正式" | "调整";
  version?: number;
  riskRate?: number;
}) {
  return requestJson<StockupCostPreview>("/api/stockup/workflow/cost-preview", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function createShipmentFee(input: {
  shipmentRecordId: string;
  feeStage: "预估" | "实际" | "调整";
  feeType: string;
  feeName?: string;
  vendor?: string;
  invoiceNo?: string;
  occurredAt?: string;
  originalAmount: number;
  currency: string;
  exchangeRate: number;
  includedInLandedCost: boolean;
  allocationMethod: "weight" | "volume" | "quantity" | "value" | "manual";
  description?: string;
  dryRun?: boolean;
}) {
  return requestJson<{ ok: boolean; dryRun: boolean; dataId?: string; preview: StockupCostPreview }>("/api/stockup/workflow/fees", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function createStockupCostBatches(input: {
  shipmentRecordId: string;
  costType: "预估" | "正式" | "调整";
  riskRate?: number;
  note?: string;
  dryRun?: boolean;
}) {
  return requestJson<{ ok: boolean; dryRun: boolean; version: number; created?: Array<{ shipmentLineId: string; dataId: string }>; preview: StockupCostPreview }>("/api/stockup/workflow/cost-batches", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function lockStockupCostVersion(input: { shipmentRecordId: string; version: number; dryRun?: boolean }) {
  return requestJson<{ ok: boolean; dryRun: boolean; shipmentRecordId: string; version: number; lockedCount?: number }>("/api/stockup/workflow/cost-batches/lock", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function syncStockupOrders() {
  return requestJson<StockupPayload>("/api/stockup/sync", { method: "POST" });
}

export function acceptStockupRecommendation(input: { recommendationKey?: string; recommendation: StockupRecommendation; note?: string }) {
  return requestJson<StockupPayload>("/api/stockup/recommendations/accept", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function abandonStockupRecommendation(input: { recommendationKey?: string; recommendation: StockupRecommendation; note?: string }) {
  return requestJson<StockupPayload>("/api/stockup/recommendations/abandon", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function restoreStockupRecommendation(input: { recommendationKey?: string; recommendation: StockupRecommendation; note?: string }) {
  return requestJson<StockupPayload>("/api/stockup/recommendations/restore", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function createStockupPlan(input: {
  recommendationKey?: string;
  recommendation: StockupRecommendation;
  quantity?: number;
  planType?: "purchase" | "outsourcing";
  owner?: string;
  expectedArrivalAt?: string;
  note?: string;
}) {
  return requestJson<StockupPayload>("/api/stockup/plans", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateStockupPlanStatus(id: string, status: StockupPlan["status"]) {
  return requestJson<StockupPayload>(`/api/stockup/plans/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
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

export function testWarehouseConnection(input: CreateWarehouseInput & { id?: string }) {
  return requestJson<WarehouseTestResult>("/api/warehouses/test", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchMiaoshou() {
  return requestJson<MiaoshouPayload>("/api/miaoshou");
}

export function updateMiaoshouConfig(input: {
  appKey?: string;
  appSecret?: string;
  automationEnabled?: boolean;
  autoFetchWaybillDefault?: boolean;
  pollIntervalMinutes?: number;
  maxPackagesPerRun?: number;
  scopes?: MiaoshouScope[];
}) {
  return requestJson<MiaoshouPayload>("/api/miaoshou/config", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function testMiaoshouConnection() {
  return requestJson<MiaoshouPayload>("/api/miaoshou/test", { method: "POST" });
}

export function syncMiaoshouShops() {
  return requestJson<MiaoshouPayload>("/api/miaoshou/shops/sync", { method: "POST" });
}

export function updateMiaoshouShop(shopId: string, input: { autoApplyTrackingNo?: boolean; autoFetchWaybill?: boolean }) {
  return requestJson<MiaoshouPayload>(`/api/miaoshou/shops/${encodeURIComponent(shopId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function runMiaoshouAutomation(shopIds: string[] = []) {
  return requestJson<MiaoshouPayload>("/api/miaoshou/run", {
    method: "POST",
    body: JSON.stringify({ shopIds }),
  });
}

export function retryMiaoshouTask(taskId: string) {
  return requestJson<MiaoshouPayload>(`/api/miaoshou/tasks/${encodeURIComponent(taskId)}/retry`, { method: "POST" });
}

export function fetchMiaoshouWaybill(taskId: string) {
  return requestJson<MiaoshouPayload>(`/api/miaoshou/tasks/${encodeURIComponent(taskId)}/waybill`, { method: "POST" });
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
