const config = require("../config");
const { fallbackWorkspace } = require("./workspace");
const { visibleNotifications, visibleWorkItemEvents } = require("./activity");

const COOKIE_KEY = "tz_collab_cookie_jar";
const now = Date.now();

function createDemoSession({ username, displayName, organizationName, organizationCode, organizationType, role }) {
  const session = {
    user: { id: `demo-user-${organizationType}`, username, displayName, email: `${username}@example.test` },
    membership: {
      id: `demo-membership-${organizationType}`, organizationId: `demo-org-${organizationType}`, organizationCode,
      organizationName, organizationType, role, status: "active", permissions: [],
    },
    organization: { id: `demo-org-${organizationType}`, code: organizationCode, name: organizationName, type: organizationType },
    mfaRequired: false, mfaEnabled: false, pendingMfa: false, mustChangePassword: false, oemEnabled: true,
  };
  session.workspace = fallbackWorkspace(session);
  const refs = organizationType === "production_factory"
    ? ["production", "purchase"]
    : [organizationType === "warehouse" ? "dwh-east-01" : ({ filing_service: "filing", sampling_factory: "sampling", packaging_factory: "purchase", material_supplier: "purchase" })[organizationType]];
  session.workspace.resources = refs.filter(Boolean).map((ref) => ({
    type: organizationType === "warehouse" ? "warehouse" : "organization",
    ref,
    name: organizationType === "warehouse" ? "华东协同仓" : session.workspace.label,
    permissions: session.workspace.capabilities,
  }));
  return session;
}

const demoSessions = Object.freeze({
  "warehouse.admin": createDemoSession({ username: "warehouse.admin", displayName: "陈师傅", organizationName: "华东协同仓", organizationCode: "cn-warehouse-demo", organizationType: "warehouse", role: "organization_admin" }),
  "packaging.operator": createDemoSession({ username: "packaging.operator", displayName: "周敏", organizationName: "青禾包装", organizationCode: "packaging-demo", organizationType: "packaging_factory", role: "operator" }),
  "production.manager": createDemoSession({ username: "production.manager", displayName: "何经理", organizationName: "博远制造", organizationCode: "production-demo", organizationType: "production_factory", role: "manager" }),
  "material.operator": createDemoSession({ username: "material.operator", displayName: "赵主管", organizationName: "瑞丰物料", organizationCode: "material-demo", organizationType: "material_supplier", role: "operator" }),
  "filing.operator": createDemoSession({ username: "filing.operator", displayName: "林顾问", organizationName: "启程备案服务", organizationCode: "filing-demo", organizationType: "filing_service", role: "operator" }),
  "sampling.operator": createDemoSession({ username: "sampling.operator", displayName: "许师傅", organizationName: "拾光打样中心", organizationCode: "sampling-demo", organizationType: "sampling_factory", role: "operator" }),
});

let activeDemoSession = demoSessions["warehouse.admin"];

const demoFirstArticle = {
  matchedBy: "barcode", documentNo: "FA-202610-018", version: "V3", productSku: "TZKJ-DEMO01",
  productName: "海盐净润洗护套装", specification: "500ml × 2", brandName: "TONGZHOU", unit: "套",
  barcode: "6970000000001", filingName: "海盐净润洗护套装", bpom: "NA18260100001",
  productionProcess: "灌装、密封测试、贴标、打码、装盒、装箱", cartonSpecification: "24 套/箱",
  updatedAt: new Date(now - 864e5).toISOString(),
  bom: [
    { category: "包材", name: "500ml PET 瓶体", materialCode: "PACK-DEMO-01", netContent: "500", unit: "ml", composition: "2 个/套" },
    { category: "包材", name: "运输外箱", materialCode: "CARTON-DEMO-01", netContent: "", unit: "个", composition: "1 箱/24 套" },
  ],
  images: [
    { category: "packaging", label: "产品包装六面图", name: "首件包装示意", url: "/images/brand-avatar-v2.png", mime: "image/png", size: 0 },
    { category: "finished", label: "成品效果", name: "首件成品示意", url: "/images/brand-avatar-v2.png", mime: "image/png", size: 0 },
  ],
};

let demoTasks = [
  {
    id: "193c9150-a854-4d0e-b61f-2d75fc56c706",
    itemType: "warehouse_stockup",
    title: "待签收验货 · DWO-20261013-A7K2",
    description: "签收后核对数量与外观，完成换箱、批号条码和箱规称重。",
    status: "in_progress",
    priority: "urgent",
    publicPayload: { referenceNo: "DWO-20261013-A7K2", warehouseRef: "dwh-east-01", warehouseName: "华东协同仓", destinationWarehouseName: "莫斯科主仓", note: "到货后先拍摄外箱与破损位置。" },
    dueAt: new Date(now + 7.2e7).toISOString(), version: 3, createdAt: new Date(now - 6 * 36e5).toISOString(), updatedAt: new Date(now - 18e4).toISOString(),
  },
  {
    id: "8b3c9150-a854-4d0e-b61f-2d75fc56c705",
    itemType: "warehouse_transfer",
    title: "华东仓调拨收货 · DB-202610-001",
    description: "核对到货箱数、批次和外箱状态后确认收货。",
    status: "pending", priority: "urgent",
    publicPayload: { referenceNo: "DB-202610-001", warehouseRef: "dwh-east-01", warehouseName: "华东协同仓", sourceWarehouseName: "杭州总仓", destinationWarehouseName: "华东协同仓", note: "到货后请拍摄托盘和封箱标签。" },
    dueAt: new Date(now + 9.6e7).toISOString(), version: 1, createdAt: new Date(now - 36e5).toISOString(), updatedAt: new Date(now - 18e4).toISOString(),
  },
  {
    id: "ea69fd79-f2a6-45e4-a117-a4432996ce7a",
    itemType: "warehouse_inbound",
    title: "采购入库 · RK-202610-118",
    description: "新批次商品入库并补充生产日期。",
    status: "accepted", priority: "normal",
    publicPayload: { referenceNo: "RK-202610-118", warehouseRef: "dwh-east-01", warehouseName: "华东协同仓" },
    dueAt: new Date(now + 17.2e7).toISOString(), version: 3, createdAt: new Date(now - 864e5).toISOString(), updatedAt: new Date(now - 36e4).toISOString(),
  },
  {
    id: "dd312a54-3c1d-44a7-bf5a-cef9774e880e",
    itemType: "warehouse_outbound",
    title: "备货出库 · BH-202610-042",
    description: "按批次拣货并回传装箱凭证。",
    status: "pending_sync", priority: "normal",
    publicPayload: { referenceNo: "BH-202610-042", warehouseRef: "dwh-east-01", warehouseName: "华东协同仓", destinationWarehouseName: "圣彼得堡仓" },
    dueAt: new Date(now + 26e7).toISOString(), version: 5, createdAt: new Date(now - 1728e5).toISOString(), updatedAt: new Date(now - 9e4).toISOString(),
  },
  {
    id: "a2212a54-3c1d-44a7-bf5a-cef9774e880f",
    itemType: "warehouse_exception",
    title: "破损商品复核 · YC-202610-008",
    description: "复核隔离区破损商品并上传照片。",
    status: "completed", priority: "normal",
    publicPayload: { referenceNo: "YC-202610-008", warehouseRef: "dwh-east-01", warehouseName: "华东协同仓" },
    dueAt: new Date(now - 864e5).toISOString(), version: 4, createdAt: new Date(now - 3 * 864e5).toISOString(), updatedAt: new Date(now - 864e5).toISOString(),
  },
  {
    id: "11111111-1111-4111-8111-111111111111", itemType: "packaging_quote",
    title: "洗护礼盒包装询价 · PKG-2026-106", description: "请按确认版刀模与材质要求提交含税报价和交期。",
    status: "pending", priority: "urgent",
    publicPayload: { projectCode: "PKG-2026-106", productName: "森系洗护礼盒", productSpec: "350g 白卡覆哑膜，局部烫金，内托 E 楞", documentVersion: "V3.2", requirements: "报价含打样、刀模、运输及 13% 增值税。", quantity: 12000, unit: "套", deliveryDate: "2026-11-18", quoteCurrency: "CNY" },
    dueAt: new Date(now + 864e5).toISOString(), version: 2, createdAt: new Date(now - 9e5).toISOString(), updatedAt: new Date(now - 12e4).toISOString(),
  },
  {
    id: "22222222-2222-4222-8222-222222222222", itemType: "production_order",
    title: "委外灌装加工单 · MO-202610-018", description: "全包生产 500ml 洗护套装，工厂负责料体、瓶体、泵头、标签与外箱。",
    status: "in_progress", priority: "urgent",
    publicPayload: { orderNo: "MO-202610-018", projectCode: "OEM-2026-041", productName: "海盐净润洗护套装", productImageUrl: "https://files.jiandaoyun.com/demo/product-cover.jpg", productSpec: "500ml × 2", barcode: "6970000000001", productionProcess: "灌装、密封测试、贴标、打码、装盒、装箱", cartonType: "专用箱（印箱唛）", piecesPerCarton: 24, fulfillmentMode: "turnkey", requirements: "包材到齐后先完成密封、跌落及相容性测试，合格后方可批量灌装。", quantity: 12000, unit: "套", deliveryDate: new Date(now + 3 * 864e5).toISOString().slice(0, 10), deliveryAddress: "杭州总仓", firstArticle: demoFirstArticle },
    dueAt: new Date(now + 3 * 864e5).toISOString(), version: 5, createdAt: new Date(now - 4 * 864e5).toISOString(), updatedAt: new Date(now - 22e4).toISOString(),
  },
  {
    id: "77777777-7777-4777-8777-777777777777", itemType: "purchase_order",
    title: "全包采购单 · CG-202610-063", description: "关联全包委外加工单，采购入库累计实收与应付金额作为最终结算依据。",
    status: "in_progress", priority: "normal",
    publicPayload: { orderNo: "CG-202610-063", projectCode: "MO-202610-018", linkedProductionOrderNo: "MO-202610-018", productName: "海盐净润洗护套装", fulfillmentMode: "supplier", requirements: "按采购单履约；最终结算数量与应付金额以采购入库单为准。", quantity: 24000, receivedQuantity: 15000, pendingReceiptQuantity: 9000, unit: "套", deliveryDate: new Date(now + 9 * 864e5).toISOString().slice(0, 10), orderedAt: new Date(now - 8 * 864e5).toISOString(), paymentTerms: "按采购入库单结算", settlementBasis: "purchase_inbound", orderAmount: 47520, payableAmount: 29700, settlementStatus: "部分入库·待结算", currency: "CNY", inboundDocuments: [{ inboundNo: "RK-202610-088", inboundAt: new Date(now - 2 * 864e5).toISOString(), receivedQuantity: 8000, payableAmount: 15840, settlementStatus: "待结算" }, { inboundNo: "RK-202610-103", inboundAt: new Date(now - 4 * 36e5).toISOString(), receivedQuantity: 7000, payableAmount: 13860, settlementStatus: "已核对" }] },
    dueAt: new Date(now + 9 * 864e5).toISOString(), version: 2, createdAt: new Date(now - 864e5).toISOString(), updatedAt: new Date(now - 18e4).toISOString(),
  },
  {
    id: "33333333-3333-4333-8333-333333333333", itemType: "sampling_task",
    title: "清爽洗发水料体打样", description: "一轮可送多个料体，由中台评审并选择最终样。",
    status: "in_progress", priority: "urgent",
    publicPayload: { projectCode: "DY-LT-20261014-DEMO01", productName: "清爽洗发水料体", productSpec: "清爽控油型", sampleCategory: "inner_material", sampleSubject: "formula", sampleGoal: "在清爽度与顺滑感之间确定最终配方", evaluationCriteria: "香型、黏度、起泡、肤感和稳定性", requirements: "每个料体登记可在供应商内部追溯的编码。", quantity: 3, unit: "瓶", deliveryDate: new Date(now + 6 * 864e5).toISOString().slice(0, 10), quoteRequired: true, quoteCurrency: "CNY" },
    dueAt: new Date(now + 4 * 864e5).toISOString(), version: 2, createdAt: new Date(now - 2 * 864e5).toISOString(), updatedAt: new Date(now - 32e4).toISOString(),
  },
  {
    id: "55555555-5555-4555-8555-555555555555", itemType: "sampling_task",
    title: "洗护礼盒包材打样", description: "按批准设计稿完成结构样、颜色样和测试文件。",
    status: "in_progress", priority: "normal",
    publicPayload: { projectCode: "DY-BC-20261014-DEMO01", productName: "洗护礼盒", productSpec: "天地盖礼盒", sampleCategory: "packaging", sampleSubject: "packaging_box", sampleGoal: "确认量产结构、颜色与表面工艺", evaluationCriteria: "尺寸公差、结构强度、颜色与烫金位置", requirements: "每轮上传设计稿或打样测试文件。", quantity: 3, unit: "套", deliveryDate: new Date(now + 8 * 864e5).toISOString().slice(0, 10), quoteRequired: true, quoteCurrency: "CNY", packagingSpec: { material: "350g 白卡裱 E 楞", process: "哑膜、烫金、局部 UV", structureType: "天地盖礼盒", lengthMm: 280, widthMm: 210, heightMm: 85, diameterMm: 0, capacityMl: 0, colorPrinting: "CMYK + 专橙色", designVersion: "Artwork V3", fileRequirements: "刀模图、3D 效果图、材质证明、跌落测试报告" } },
    dueAt: new Date(now + 8 * 864e5).toISOString(), version: 4, createdAt: new Date(now - 3 * 864e5).toISOString(), updatedAt: new Date(now - 24e4).toISOString(),
  },
  {
    id: "44444444-4444-4444-8444-444444444444", itemType: "filing_task",
    title: "新品功效备案资料 · FILING-2026-019", description: "复核配方、功效宣称依据与送检资料，提交备案结果。",
    status: "in_progress", priority: "urgent",
    publicPayload: { projectCode: "FILING-2026-019", productName: "海盐净润洗发露", productSpec: "控油蓬松型 500ml", documentVersion: "DOC-V4", requirements: "缺失资料请在任务时间线中一次性说明。", quantity: 1, unit: "项", deliveryDate: "2026-10-28", quoteCurrency: "CNY" },
    dueAt: new Date(now + 5 * 864e5).toISOString(), version: 4, createdAt: new Date(now - 3 * 864e5).toISOString(), updatedAt: new Date(now - 45e4).toISOString(),
  }
];

const demoOemDetails = {
  "11111111-1111-4111-8111-111111111111": { artifacts: [], quotes: [], milestones: [] },
  "22222222-2222-4222-8222-222222222222": { artifacts: [], quotes: [], milestones: [] },
  "33333333-3333-4333-8333-333333333333": { artifacts: [], quotes: [], milestones: [] },
  "55555555-5555-4555-8555-555555555555": { artifacts: [{
    id: "sample-artifact-approved-demo", artifactType: "sample_result", title: "第 1 轮包装盒送样", version: 1, status: "approved",
    publicPayload: { summary: "结构、颜色和烫金位置通过评审。", result: "passed", approvedVariantCode: "DY-BC-DEMO01-R1-S1", attachmentIds: ["demo-file-1"], sampleVariants: [{ variantCode: "DY-BC-DEMO01-R1-S1", name: "哑膜烫金方案", sampleQuantity: 3, unit: "套", material: "350g 白卡裱 E 楞", process: "哑膜、烫金、局部 UV", structureType: "天地盖礼盒", lengthMm: 280, widthMm: 210, heightMm: 85, colorPrinting: "CMYK + 专橙色" }] },
    createdAt: new Date(now - 864e5).toISOString(), updatedAt: new Date(now - 864e5).toISOString(),
  }], quotes: [], milestones: [] },
  "44444444-4444-4444-8444-444444444444": { artifacts: [], quotes: [], milestones: [] },
};

const demoPartnerOrderDetails = {
  "22222222-2222-4222-8222-222222222222": {
    lines: [
      { id: "partner-line-finished", lineType: "finished_product", sku: "TZKJ-DEMO01", productName: "海盐净润洗护套装", imageUrl: "https://files.jiandaoyun.com/demo/product-cover.jpg", specification: "500ml × 2", plannedQuantity: 12000, unit: "套" },
      { id: "partner-line-bottle", lineType: "packaging", sku: "PACK-DEMO-01", productName: "500ml PET 瓶体与泵头", imageUrl: "", specification: "透明瓶 · 24/410 泵头", plannedQuantity: 24000, unit: "套" },
      { id: "partner-line-carton", lineType: "packaging", sku: "CARTON-DEMO-01", productName: "印刷运输外箱", imageUrl: "", specification: "24 套/箱", plannedQuantity: 500, unit: "个" },
    ],
    reports: [
      { id: "report-progress-1", reportType: "production_progress", stage: "filling", progressPercent: 35, completedQuantity: 4200, expectedCompletionDate: new Date(now + 3 * 864e5).toISOString().slice(0, 10), note: "首批灌装完成，正在进行密封性检查。", createdAt: new Date(now - 22e4).toISOString(), details: {} },
      { id: "report-material-1", reportType: "material_readiness", lineId: "partner-line-bottle", readiness: "arrived", testResult: "passed", arrivedQuantity: 24000, testedAt: new Date(now - 864e5).toISOString().slice(0, 10), exceptionDescription: "", note: "瓶体、泵头已齐套并通过密封测试。", createdAt: new Date(now - 864e5).toISOString(), details: {} },
    ],
  },
  "77777777-7777-4777-8777-777777777777": {
    lines: [
      { id: "purchase-line-finished", lineType: "finished_product", sku: "TZKJ-DEMO01", productName: "海盐净润洗护套装", imageUrl: "", specification: "500ml × 2", plannedQuantity: 24000, unit: "套", unitPrice: 1.98, currency: "CNY" },
    ],
    reports: [],
  },
};

const demoInventory = [
  { warehouseRef: "dwh-east-01", warehouseName: "华东协同仓", sku: "TZKJ-DEMO-001", productName: "海盐净润洗发露", barcode: "697000000001", imageUrl: "", availableQuantity: 1880, lockedQuantity: 240, inTransitQuantity: 240, unit: "件", lastCoreSyncedAt: new Date(now - 9e4).toISOString(), version: 1 },
  { warehouseRef: "dwh-east-01", warehouseName: "华东协同仓", sku: "TZKJ-DEMO-002", productName: "森系修护发膜", barcode: "697000000002", imageUrl: "", availableQuantity: 864, lockedQuantity: 120, inTransitQuantity: 120, unit: "件", lastCoreSyncedAt: new Date(now - 9e4).toISOString(), version: 1 },
  { warehouseRef: "dwh-east-01", warehouseName: "华东协同仓", sku: "TZKJ-DEMO-003", productName: "轻盈蓬松护发素", barcode: "697000000003", imageUrl: "", availableQuantity: 32, lockedQuantity: 18, inTransitQuantity: 0, unit: "件", lastCoreSyncedAt: new Date(now - 9e4).toISOString(), version: 1 },
  { warehouseRef: "dwh-east-01", warehouseName: "华东协同仓", sku: "TZKJ-DEMO-004", productName: "氨基酸柔润沐浴露", barcode: "697000000004", imageUrl: "", availableQuantity: 0, lockedQuantity: 0, inTransitQuantity: 600, unit: "件", lastCoreSyncedAt: new Date(now - 9e4).toISOString(), version: 1 },
];

let demoNotifications = [
  { id: "note-1", workItemId: demoTasks[1].id, title: "收到新的紧急调拨任务", body: "请在今日完成华东仓调拨收货。", category: "任务通知", readAt: "", createdAt: new Date(now - 28 * 60000).toISOString() },
  { id: "note-2", workItemId: demoTasks[3].id, title: "处理结果等待中台同步", body: "备货出库 · BH-202610-042 已进入同步队列，请勿重复提交。", category: "审批结果", readAt: "", createdAt: new Date(now - 2.2 * 36e5).toISOString() },
  { id: "note-3", workItemId: "", title: "库存同步完成", body: "华东协同仓库存已于 09:32 更新，共 186 个可见 SKU。", category: "系统通知", readAt: new Date(now - 864e5).toISOString(), createdAt: new Date(now - 864e5).toISOString() },
];

function randomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const partnerDraftRequestKeys = new Map();

function currentDemoSession() {
  return wx.getStorageSync("tz_collab_session_profile") || activeDemoSession;
}

function visibleDemoTasks() {
  const workspace = currentDemoSession().workspace || {};
  const taskTypes = workspace.taskTypes || [];
  const sampleCategories = workspace.sampleCategories || [];
  return demoTasks.filter((item) => taskTypes.includes(item.itemType)
    && (item.itemType !== "sampling_task" || sampleCategories.includes(item.publicPayload?.sampleCategory)));
}

function getCookieJar() { return wx.getStorageSync(COOKIE_KEY) || {}; }

function captureCookies(response) {
  const sources = [];
  if (Array.isArray(response.cookies)) sources.push.apply(sources, response.cookies);
  const header = response.header || {};
  const setCookie = header["Set-Cookie"] || header["set-cookie"];
  if (setCookie) sources.push(String(setCookie));
  if (!sources.length) return;
  const jar = getCookieJar();
  sources.forEach((source) => {
    const regex = /(tz_collab_(?:session|csrf))=([^;,\s]*)/g;
    let match = regex.exec(source);
    while (match) {
      if (match[2]) jar[match[1]] = match[2];
      else delete jar[match[1]];
      match = regex.exec(source);
    }
  });
  wx.setStorageSync(COOKIE_KEY, jar);
}

function cookieHeader() {
  const jar = getCookieJar();
  return Object.keys(jar).map((key) => `${key}=${jar[key]}`).join("; ");
}

function clearAuth() {
  wx.removeStorageSync(COOKIE_KEY);
  wx.removeStorageSync("tz_collab_session_profile");
  const app = getApp();
  if (app) app.globalData.session = null;
}

function request(path, options) {
  const opts = options || {};
  if (!config.apiBaseUrl) return Promise.reject(new Error("尚未配置协同 API 地址，请在 config.js 中填写 apiBaseUrl。"));
  const method = String(opts.method || "GET").toUpperCase();
  const jar = getCookieJar();
  const header = Object.assign({ "content-type": "application/json" }, opts.header || {});
  const cookies = cookieHeader();
  if (cookies) header.Cookie = cookies;
  if (!["GET", "HEAD"].includes(method) && jar.tz_collab_csrf) header["X-CSRF-Token"] = decodeURIComponent(jar.tz_collab_csrf);
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${config.apiBaseUrl.replace(/\/$/, "")}${path}`,
      method,
      data: opts.data,
      header,
      timeout: Number(opts.timeout || config.requestTimeout),
      success(response) {
        captureCookies(response);
        const payload = response.data || {};
        if (response.statusCode >= 200 && response.statusCode < 300) return resolve(payload);
        if (response.statusCode === 401) {
          clearAuth();
          setTimeout(() => wx.reLaunch({ url: "/pages/login/index" }), 0);
        }
        const error = new Error(payload.message || `请求失败（${response.statusCode}）`);
        error.status = response.statusCode;
        error.code = payload.code || "request_failed";
        reject(error);
      },
      fail(error) { reject(new Error(error.errMsg || "网络连接失败，请稍后重试。")); },
    });
  });
}

function login(input) {
  if (config.demoMode) {
    const username = String(input?.username || "").trim().toLowerCase();
    activeDemoSession = demoSessions[username] || demoSessions["warehouse.admin"];
    return Promise.resolve({ ok: true, session: Object.assign({ mode: "partner" }, activeDemoSession) });
  }
  return request("/collaboration/auth/login", { method: "POST", data: input }).then((result) => Object.assign({}, result, {
    session: Object.assign({ mode: "partner" }, result.session || {}),
  }));
}

function fetchMe() {
  if (config.demoMode) return Promise.resolve({ ok: true, session: currentDemoSession() });
  return request("/collaboration/me").then((result) => Object.assign({}, result, {
    session: Object.assign({ mode: "partner" }, result.session || {}),
  }));
}

function logout() {
  if (config.demoMode) { clearAuth(); return Promise.resolve({ ok: true }); }
  return request("/collaboration/auth/logout", { method: "POST" }).finally(clearAuth);
}

function fetchDashboard() {
  if (config.demoMode) {
    const visible = visibleDemoTasks();
    const open = visible.filter((item) => !["completed", "cancelled", "rejected"].includes(item.status));
    const notifications = visibleNotifications(demoNotifications);
    return Promise.resolve({ ok: true, dashboard: {
      openTasks: open.length,
      urgentTasks: open.filter((item) => item.priority === "urgent").length,
      waitingTasks: open.filter((item) => ["pending_approval", "pending_sync"].includes(item.status)).length,
      unreadNotifications: notifications.filter((item) => !item.readAt).length,
      inventorySkuCount: currentDemoSession().organization.type === "warehouse" ? 186 : 0,
      inventorySyncedAt: currentDemoSession().organization.type === "warehouse" ? new Date(now - 9e4).toISOString() : "",
      productionOrders: open.filter((item) => item.itemType === "production_order").length,
      purchaseOrders: open.filter((item) => item.itemType === "purchase_order").length,
      exceptionReports: Object.values(demoPartnerOrderDetails).flatMap((detail) => detail.reports || []).filter((report) => report.reportType === "exception").length,
    } });
  }
  return request("/collaboration/v1/dashboard").then((result) => (
    request("/collaboration/v1/notifications?limit=100")
      .then((notifications) => {
        result.dashboard.unreadNotifications = visibleNotifications(notifications.items).filter((item) => !item.readAt).length;
        return result;
      })
      .catch(() => result)
  ));
}

function fetchWorkItems(filters) {
  const input = filters || {};
  if (config.demoMode) {
    const keyword = String(input.keyword || "").toLowerCase();
    const visible = visibleDemoTasks();
    const items = visible.filter((item) => {
      const statusMatches = !input.status || item.status === input.status;
      const typeMatches = !input.itemType || item.itemType === input.itemType;
      const keywordMatches = !keyword || `${item.title} ${item.description} ${item.publicPayload.referenceNo || ""} ${item.publicPayload.projectCode || ""} ${item.publicPayload.productName || ""}`.toLowerCase().includes(keyword);
      return statusMatches && typeMatches && keywordMatches;
    });
    const counts = {};
    visible.filter((item) => !input.itemType || item.itemType === input.itemType).forEach((item) => { counts[item.status] = (counts[item.status] || 0) + 1; });
    return Promise.resolve({ ok: true, items, counts, limit: 30, offset: 0 });
  }
  const query = [];
  if (input.status) query.push(`status=${encodeURIComponent(input.status)}`);
  if (input.keyword) query.push(`keyword=${encodeURIComponent(input.keyword)}`);
  if (input.itemType) query.push(`itemType=${encodeURIComponent(input.itemType)}`);
  if (input.limit) query.push(`limit=${encodeURIComponent(input.limit)}`);
  return request(`/collaboration/v1/work-items?${query.join("&")}`);
}

function demoLines() {
  return [
    { id: "line-1", sourceLineId: "source-1", sku: "TZKJ-DEMO-001", productName: "海盐净润洗发露", imageUrl: "", plannedQuantity: 240, completedQuantity: 0, unit: "件", lotNo: "LOT-261012-A", barcode: "697000000001", productionDate: "2026-10-12", expiryDate: "2029-10-11" },
    { id: "line-2", sourceLineId: "source-2", sku: "TZKJ-DEMO-002", productName: "森系修护发膜", imageUrl: "", plannedQuantity: 120, completedQuantity: 0, unit: "件", lotNo: "LOT-261013-B", barcode: "697000000002", productionDate: "2026-10-13", expiryDate: "2029-10-12" },
  ];
}

function fetchWorkItem(id) {
  if (config.demoMode) {
    const item = visibleDemoTasks().find((entry) => entry.id === id) || visibleDemoTasks()[0];
    const isWarehouse = String(item.itemType).startsWith("warehouse_");
    return Promise.resolve({ ok: true, item, lines: isWarehouse ? demoLines() : [], attachments: [], commands: [], oem: demoOemDetails[item.id] || null, partnerOrder: demoPartnerOrderDetails[item.id] || null, events: visibleWorkItemEvents([
      { id: "event-2", eventType: "partner.progress", actorName: currentDemoSession().user.displayName, body: isWarehouse ? "已完成到货外箱检查，正在核对批次。" : "已查看任务要求，正在准备本组织反馈。", createdAt: new Date(now - 42 * 60000).toISOString() },
      { id: "event-1", eventType: "core.projection", actorName: "供应链中台", body: "任务已发布至华东协同仓。", createdAt: item.createdAt },
    ]) });
  }
  return request(`/collaboration/v1/work-items/${id}`).then((result) => Object.assign({}, result, {
    events: visibleWorkItemEvents(result.events),
  }));
}

function submitPartnerOrderReport(workItemId, version, input, aiDraftId) {
  if (config.demoMode) {
    const detail = demoPartnerOrderDetails[workItemId] || (demoPartnerOrderDetails[workItemId] = { lines: [], reports: [] });
    const report = Object.assign({ id: randomId(), createdAt: new Date().toISOString(), details: {} }, input);
    detail.reports.unshift(report);
    demoTasks = demoTasks.map((item) => item.id === workItemId ? Object.assign({}, item, {
      status: item.status === "accepted" ? "in_progress" : item.status,
      version: Number(version) + 1,
      updatedAt: new Date().toISOString(),
    }) : item);
    return Promise.resolve({ ok: true, report, commandId: randomId() });
  }
  return request(`/collaboration/v1/partner-orders/${workItemId}/reports`, {
    method: "POST",
    header: Object.assign({ "Idempotency-Key": randomId(), "If-Match": String(version) }, aiDraftId ? { "X-AI-Draft-Id": aiDraftId } : {}),
    data: input,
  });
}

function submitAction(id, version, body, aiDraftId) {
  if (config.demoMode) {
    demoTasks = demoTasks.map((item) => item.id === id ? Object.assign({}, item, {
      status: body.action === "accept" ? "accepted" : body.action === "progress" || body.action === "report_exception" ? "in_progress" : "pending_sync",
      version: Number(version) + 1,
      updatedAt: new Date().toISOString(),
    }) : item);
    return Promise.resolve({ ok: true, item: demoTasks.find((item) => item.id === id), command: { id: randomId(), status: "pending_sync" } });
  }
  return request(`/collaboration/v1/work-items/${id}/actions`, {
    method: "POST",
    header: Object.assign({ "Idempotency-Key": randomId(), "If-Match": String(version) }, aiDraftId ? { "X-AI-Draft-Id": aiDraftId } : {}),
    data: body,
  });
}

function submitSupplierQuote(workItemId, version, input) {
  if (config.demoMode) {
    const details = demoOemDetails[workItemId] || (demoOemDetails[workItemId] = { artifacts: [], quotes: [], milestones: [] });
    const quote = Object.assign({ id: randomId(), status: "submitted", version: details.quotes.length + 1, submittedAt: new Date().toISOString() }, input);
    details.quotes.unshift(quote);
    demoTasks = demoTasks.map((item) => item.id === workItemId ? Object.assign({}, item, { status: "pending_sync", version: Number(version) + 1, updatedAt: new Date().toISOString() }) : item);
    return Promise.resolve({ ok: true, commandId: randomId(), quote });
  }
  return request("/collaboration/v1/oem/quotes", {
    method: "POST",
    header: { "Idempotency-Key": randomId(), "If-Match": String(version) },
    data: Object.assign({ workItemId }, input),
  });
}

function submitOemArtifact(workItemId, version, input) {
  if (config.demoMode) {
    const details = demoOemDetails[workItemId] || (demoOemDetails[workItemId] = { artifacts: [], quotes: [], milestones: [] });
    const artifact = Object.assign({ id: randomId(), status: "submitted", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, input);
    if (artifact.artifactType === "sample_result" && Array.isArray(artifact.publicPayload?.sampleVariants)) {
      artifact.publicPayload = Object.assign({}, artifact.publicPayload, {
        sampleVariants: artifact.publicPayload.sampleVariants.map((variant, index) => Object.assign({}, variant, {
          variantCode: variant.variantCode || `SAMPLE-R${artifact.version || 1}-S${index + 1}`,
        })),
      });
    }
    details.artifacts.unshift(artifact);
    demoTasks = demoTasks.map((item) => item.id === workItemId ? Object.assign({}, item, { status: "pending_sync", version: Number(version) + 1, updatedAt: new Date().toISOString() }) : item);
    return Promise.resolve({ ok: true, commandId: randomId(), artifact });
  }
  return request("/collaboration/v1/oem/artifacts", {
    method: "POST",
    header: { "Idempotency-Key": randomId(), "If-Match": String(version) },
    data: Object.assign({ workItemId }, input),
  });
}

function updateProductionMilestone(milestoneId, version, input) {
  if (config.demoMode) {
    Object.values(demoOemDetails).forEach((details) => {
      details.milestones = (details.milestones || []).map((item) => item.id === milestoneId ? Object.assign({}, item, {
        status: input.status,
        completedAt: input.status === "completed" ? new Date().toISOString() : "",
        publicPayload: Object.assign({}, item.publicPayload, { note: input.note || "" }),
        version: Number(item.version || 1) + 1,
      }) : item);
    });
    return Promise.resolve({ ok: true, commandId: randomId() });
  }
  return request(`/collaboration/v1/oem/milestones/${milestoneId}`, {
    method: "PATCH",
    header: { "Idempotency-Key": randomId(), "If-Match": String(version) },
    data: input,
  });
}

function fetchInventory(keyword) {
  const value = String(keyword || "").trim().toLowerCase();
  if (config.demoMode) {
    const items = demoInventory.filter((item) => !value || `${item.sku} ${item.productName} ${item.barcode || ""}`.toLowerCase().includes(value));
    return Promise.resolve({ ok: true, items, limit: 100, offset: 0 });
  }
  return request(`/collaboration/v1/inventory?keyword=${encodeURIComponent(value)}&limit=100`);
}

function createWarehouseOperation(input) {
  if (config.demoMode) {
    const id = `f${Math.random().toString(16).slice(2, 9)}-3c1d-44a7-bf5a-cef9774e880e`;
    const label = ({ inbound: "仓库自主入库", outbound: "仓库自主出库", stocktake: "库存盘点差异" })[input.operationType];
    const item = { id, itemType: input.operationType === "outbound" ? "warehouse_outbound" : input.operationType === "stocktake" ? "warehouse_exception" : "warehouse_inbound", title: `${label} · ${input.referenceNo || "自动编号"}`, description: input.note, status: "pending_approval", priority: "normal", publicPayload: { referenceNo: input.referenceNo || "待生成", warehouseRef: input.warehouseRef, warehouseName: "华东协同仓" }, dueAt: "", version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    demoTasks = [item].concat(demoTasks);
    return Promise.resolve({ ok: true, item, command: { id: randomId(), status: "pending_approval" } });
  }
  return request("/collaboration/v1/warehouse-operations", { method: "POST", header: { "Idempotency-Key": randomId() }, data: input });
}

function fetchNotifications() {
  if (config.demoMode) return Promise.resolve({ ok: true, items: visibleNotifications(demoNotifications), limit: 30, offset: 0 });
  function loadVisible(offset, collected, page) {
    return request(`/collaboration/v1/notifications?limit=100&offset=${offset}`).then((result) => {
      const source = Array.isArray(result.items) ? result.items : [];
      const items = collected.concat(visibleNotifications(source));
      if (source.length < 100 || items.length >= 100 || page >= 9) {
        return Object.assign({}, result, { items: items.slice(0, 100), limit: 100, offset: 0 });
      }
      return loadVisible(offset + source.length, items, page + 1);
    });
  }
  return loadVisible(0, [], 0);
}

function markNotificationRead(id) {
  if (config.demoMode) {
    demoNotifications = demoNotifications.map((item) => item.id === id ? Object.assign({}, item, { readAt: new Date().toISOString() }) : item);
    return Promise.resolve({ ok: true });
  }
  return request(`/collaboration/v1/notifications/${id}/read`, { method: "POST" });
}

function uploadBinary(url, method, headers, filePath, localUpload) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      success(file) {
        const requestHeaders = Object.assign({}, headers || {});
        if (localUpload) {
          const jar = getCookieJar();
          requestHeaders.Cookie = cookieHeader();
          if (jar.tz_collab_csrf) requestHeaders["X-CSRF-Token"] = decodeURIComponent(jar.tz_collab_csrf);
        }
        wx.request({
          url,
          method: method || "PUT",
          data: file.data,
          header: requestHeaders,
          timeout: config.requestTimeout,
          success(response) {
            if (response.statusCode >= 200 && response.statusCode < 300) resolve(response);
            else reject(new Error("附件上传失败，请稍后重试。"));
          },
          fail(error) { reject(new Error(error.errMsg || "附件上传失败。")); },
        });
      },
      fail() { reject(new Error("无法读取所选文件。")); },
    });
  });
}

async function uploadAttachment(workItemId, media) {
  if (config.demoMode) return { ok: true, attachmentId: randomId() };
  const ticket = await request("/collaboration/v1/attachments", { method: "POST", data: {
    workItemId,
    fileName: `现场凭证-${Date.now()}.jpg`,
    mimeType: media.type === "video" ? "video/mp4" : "image/jpeg",
    sizeBytes: Number(media.size || 0),
  } });
  const localUpload = String(ticket.uploadUrl || "").startsWith("/collaboration/");
  const uploadUrl = localUpload ? `${config.apiBaseUrl.replace(/\/$/, "")}${ticket.uploadUrl}` : ticket.uploadUrl;
  await uploadBinary(uploadUrl, ticket.uploadMethod, ticket.requiredHeaders, media.tempFilePath, localUpload);
  if (!localUpload) await request(`/collaboration/v1/attachments/${ticket.attachmentId}/complete`, { method: "POST" });
  return { ok: true, attachmentId: ticket.attachmentId };
}

function demoProgressDraft(workItemId, version, text) {
  const item = demoTasks.find((entry) => entry.id === workItemId) || {};
  const type = item.itemType === "production_order" ? "production_progress" : item.itemType === "purchase_order" ? "purchase_fulfillment" : "work_item_progress";
  const percent = String(text).match(/(?:完成|进度)[^0-9]{0,4}(\d{1,3})\s*%/);
  const quantity = String(text).match(/(?:完成|生产|采购|交付|灌装)[^0-9]{0,4}(\d+(?:\.\d+)?)\s*(?:件|套|瓶|个|箱)?/);
  const fields = type === "work_item_progress" ? { action: "progress", note: text } : { note: text };
  const evidence = [];
  if (percent && Number(percent[1]) <= 100 && type !== "purchase_fulfillment") { fields.progressPercent = Number(percent[1]); evidence.push({ field: "progressPercent", sourceQuote: percent[0], normalizedValue: Number(percent[1]) }); }
  if (quantity && type !== "work_item_progress") { fields.completedQuantity = Number(quantity[1]); evidence.push({ field: "completedQuantity", sourceQuote: quantity[0], normalizedValue: Number(quantity[1]) }); }
  return { id: randomId(), type, workItemVersion: Number(version), fields, evidence, missingFields: [], warnings: ["演示模式仅抽取明确数字，正式环境由 Hermes + DeepSeek 生成。"], expiresAt: new Date(Date.now() + 18e5).toISOString() };
}

async function createPartnerAiTranscription(workItemId, workItemVersion, recording) {
  if (config.demoMode) return { transcriptionId: randomId(), uploadUrl: "demo://voice", uploadMethod: "PUT", requiredHeaders: {}, expiresAt: new Date(Date.now() + 9e5).toISOString() };
  return request(`/collaboration/v1/work-items/${workItemId}/ai-transcriptions`, { method: "POST", header: { "Idempotency-Key": recording.idempotencyKey || randomId() }, data: {
    fileName: recording.fileName,
    mimeType: recording.mimeType,
    sizeBytes: Number(recording.sizeBytes),
    durationMs: Number(recording.durationMs),
    workItemVersion: Number(workItemVersion),
  } });
}

async function transcribePartnerAudio(workItemId, workItemVersion, recording) {
  if (config.demoMode) return { transcriptionId: randomId(), transcript: "已完成本周进度，当前工作正常推进。", durationMs: recording.durationMs };
  const ticket = await createPartnerAiTranscription(workItemId, workItemVersion, { ...recording, idempotencyKey: recording.idempotencyKey || randomId() });
  if (ticket.status === "completed") return ticket;
  if (!ticket.uploadUrl && ticket.status !== "uploaded") throw Object.assign(new Error("录音请求正在处理，请稍候重试。"), { code: "transcription_in_progress" });
  const localUpload = String(ticket.uploadUrl || "").startsWith("/collaboration/");
  const uploadUrl = localUpload ? `${config.apiBaseUrl.replace(/\/$/, "")}${ticket.uploadUrl}` : ticket.uploadUrl;
  if (ticket.status !== "uploaded") {
    try {
      await uploadBinary(uploadUrl, ticket.uploadMethod, ticket.requiredHeaders, recording.tempFilePath, localUpload);
    } catch (uploadError) {
      const current = await request(`/collaboration/v1/work-items/${workItemId}/ai-transcriptions/${ticket.transcriptionId}`);
      if (current.status === "created") await uploadBinary(uploadUrl, ticket.uploadMethod, ticket.requiredHeaders, recording.tempFilePath, localUpload);
      else if (current.status === "completed") return current;
      else if (current.status !== "uploaded") throw uploadError;
    }
  }
  return request(`/collaboration/v1/work-items/${workItemId}/ai-transcriptions/${ticket.transcriptionId}/complete`, { method: "POST", timeout: 25_000 });
}

function createPartnerProgressDraft(workItemId, workItemVersion, text, transcriptionId) {
  if (config.demoMode) return Promise.resolve({ ok: true, draft: demoProgressDraft(workItemId, workItemVersion, text) });
  const scope = `${workItemId}:${workItemVersion}:${transcriptionId || "text"}:${text}`;
  const idempotencyKey = partnerDraftRequestKeys.get(scope) || randomId();
  partnerDraftRequestKeys.set(scope, idempotencyKey);
  return request(`/collaboration/v1/work-items/${workItemId}/ai-progress-drafts`, { method: "POST", timeout: 35_000, header: { "Idempotency-Key": idempotencyKey }, data: {
    text, workItemVersion: Number(workItemVersion), ...(transcriptionId ? { transcriptionId } : {}),
  } }).then((result) => { partnerDraftRequestKeys.delete(scope); return result; });
}

function markPartnerProgressDraftApplied(workItemId, draftId, workItemVersion) {
  if (config.demoMode) return Promise.resolve({ ok: true });
  return request(`/collaboration/v1/work-items/${workItemId}/ai-progress-drafts/${draftId}/applied`, { method: "POST", data: { workItemVersion: Number(workItemVersion) } });
}

module.exports = {
  config,
  clearAuth,
  login,
  fetchMe,
  logout,
  fetchDashboard,
  fetchWorkItems,
  fetchWorkItem,
  submitAction,
  submitPartnerOrderReport,
  submitSupplierQuote,
  submitOemArtifact,
  updateProductionMilestone,
  fetchInventory,
  createWarehouseOperation,
  fetchNotifications,
  markNotificationRead,
  uploadAttachment,
  transcribePartnerAudio,
  createPartnerProgressDraft,
  markPartnerProgressDraftApplied,
};
