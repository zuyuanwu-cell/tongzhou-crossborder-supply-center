const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "小程序", "miniprogram");
const storage = new Map();
global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  removeStorageSync(key) { storage.delete(key); },
};
global.getApp = () => ({ globalData: { session: null } });

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }

function verifyStructure() {
  const app = readJson(path.join(root, "app.json"));
  assert.ok(app.pages.length >= 8, "应包含完整业务页面");
  for (const adminPage of ["pages/admin/index", "pages/admin-business/index", "pages/admin-business-detail/index", "pages/admin-container-calculator/index", "pages/admin-tasks/index", "pages/admin-task-detail/index", "pages/admin-approvals/index", "pages/admin-organizations/index", "pages/admin-organization/index"]) {
    assert.ok(app.pages.includes(adminPage), `应注册中台页面：${adminPage}`);
  }
  for (const page of app.pages) {
    for (const extension of [".js", ".json", ".wxml", ".wxss"]) {
      const file = path.join(root, `${page}${extension}`);
      assert.ok(fs.existsSync(file), `缺少页面文件：${page}${extension}`);
      if (extension === ".json") readJson(file);
      if (extension === ".js") new vm.Script(fs.readFileSync(file, "utf8"), { filename: file });
    }
  }
  assert.ok(app.pages.includes("pages/ai-progress/index"), "应注册 Hermes 快捷汇报页面");
  for (const file of walk(root, ".wxml")) {
    const text = fs.readFileSync(file, "utf8");
    assert.equal((text.match(/{{/g) || []).length, (text.match(/}}/g) || []).length, `WXML 插值未闭合：${file}`);
    assert.ok(!/{{[^}]*\.\w+\s*\(/.test(text), `WXML 中不能直接调用 JS 方法：${file}`);
  }
  const partnerDetail = fs.readFileSync(path.join(root, "pages", "task-detail", "index.wxml"), "utf8");
  assert.match(partnerDetail, /内部维护 · 供应商只读/, "首件档案必须明确为内部维护、供应商只读");
  assert.doesNotMatch(partnerDetail, /提交首件|上传首件/, "供应商端不应提供首件维护入口");
  assert.match(partnerDetail, /料体打样.*闭环|\{\{sampling\.categoryLabel\}\}闭环/, "应包含独立的打样闭环工作区");
  assert.match(partnerDetail, /最终样报价/, "最终样确认后应开放绑定报价入口");
  assert.match(partnerDetail, /实际到货条码/);
  assert.match(partnerDetail, /采购入库结算依据/, "采购单详情应展示采购入库结算依据");
  assert.match(partnerDetail, /purchaseSettlement\.inboundDocuments/, "采购入库批次应在小程序端可见");
  const partnerHome = fs.readFileSync(path.join(root, "pages", "index", "index.wxml"), "utf8");
  assert.match(partnerHome, /sendComposer/, "伙伴工作台应提供固定文字汇报入口");
  assert.match(partnerHome, /startVoiceReport/, "伙伴工作台应提供固定语音汇报入口");
  assert.match(partnerHome, /choosePhoto/, "伙伴工作台应提供拍照异常入口");
  assert.match(partnerHome, /今日待填报/, "伙伴工作台应以今日待填报作为主任务入口");
  assert.match(partnerHome, /说一句、或拍张照/, "伙伴工作台应使用 Artifact 的对话式引导");
  assert.match(partnerHome, /class="composer"/, "Hermes 输入栏应固定在首页底部");
  assert.match(partnerHome, /runHermesSuggestion/, "伙伴工作台应提供 Hermes 场景建议");
  const aiProgress = fs.readFileSync(path.join(root, "pages", "ai-progress", "index.wxml"), "utf8");
  const aiProgressScript = fs.readFileSync(path.join(root, "pages", "ai-progress", "index.js"), "utf8");
  assert.match(aiProgress, /MATCHED ORDERS/);
  assert.match(aiProgress, /process-list/, "结构化草稿应以图形化工序呈现");
  assert.match(aiProgress, /pendingMedia/, "图片异常应在同一 Hermes 会话内整理");
  assert.match(aiProgress, /voice-overlay/, "语音汇报应提供录音反馈动效");
  assert.match(aiProgress, /确认提交/);
  assert.match(aiProgress, /使用原表单/);
  assert.match(aiProgressScript, /decodeRouteText\(options\?\.prompt\)/, "首页快捷话术必须在 Hermes 会话中还原为中文");
  assert.match(aiProgressScript, /decodeURIComponent\(text\)/, "Hermes 路由话术必须安全解码");
  const partnerApi = fs.readFileSync(path.join(root, "utils", "api.js"), "utf8");
  assert.match(partnerApi, /partner-ai\/sessions/);
  assert.match(partnerApi, /order-confirmation/);
  assert.match(partnerApi, /audio-tickets/);
  assert.match(partnerDetail, /PRODUCT COVER/, "委外加工单详情应展示工艺单产品封面");
  assert.match(partnerDetail, /bindtap="previewProductCover"/, "产品封面应支持点击预览");
  assert.match(partnerDetail, /barcode-scan-button[^>]*data-index="\{\{index\}\}"[^>]*catchtap="scanLine"/, "在途收货明细必须提供可靠的逐行扫码按钮");
  const receivingBarcode = fs.readFileSync(path.join(root, "utils", "receiving-barcode.js"), "utf8");
  assert.match(receivingBarcode, /scanType:\s*\["barCode", "qrCode", "datamatrix", "pdf417"\]/);
  assert.doesNotMatch(receivingBarcode, /fetchInventory|productLookup/, "实物收货条码不得依赖商品主档查询");
  const loginPage = fs.readFileSync(path.join(root, "pages", "login", "index.wxml"), "utf8");
  const appStyles = fs.readFileSync(path.join(root, "app.wxss"), "utf8");
  const readabilityStyles = fs.readFileSync(path.join(root, "styles", "hermes-v2-readability.wxss"), "utf8");
  assert.match(loginPage, /data-mode="partner"/);
  assert.match(loginPage, /data-mode="admin"/);
  assert.match(loginPage, /中台登录/);
  assert.match(loginPage, /POWERED BY HERMES|AI ASSISTANT/, "登录页应明确 AI 助手身份");
  assert.match(loginPage, /login-card/, "登录表单应使用 Artifact 的全暗色玻璃卡片");
  assert.match(appStyles, /hermes-v2-readability\.wxss/, "小程序必须加载真机可读性修复层");
  assert.match(appStyles, /button,[\s\S]*input,[\s\S]*textarea[\s\S]*font-family/, "原生表单控件必须统一继承中文字体");
  assert.match(readabilityStyles, /\.login-page \.login-button[\s\S]*font-size:\s*28rpx/, "登录按钮文字必须达到真机可读字号");
  assert.match(readabilityStyles, /\.assistant-page \.message-body[\s\S]*font-size:\s*24rpx/, "Hermes 会话正文必须达到真机可读字号");
  assert.match(readabilityStyles, /\.tasks-page \.task-card__desc[\s\S]*font-size:\s*24rpx/, "任务卡片说明必须达到真机可读字号");
  assert.match(readabilityStyles, /\.messages-page \.message-copy[\s\S]*font-size:\s*23rpx/, "消息正文必须达到真机可读字号");
  assert.match(readabilityStyles, /\.inventory-page \.goods-sku[\s\S]*font-size:\s*21rpx/, "库存 SKU 必须达到真机可读字号");
  assert.match(readabilityStyles, /\.profile-page \.preference-row text[\s\S]*font-size:\s*19rpx/, "个人中心辅助说明必须达到真机可读字号");
  const profilePage = fs.readFileSync(path.join(root, "pages", "profile", "index.wxml"), "utf8");
  assert.match(profilePage, /助手偏好|小助理偏好/);
  assert.match(profilePage, /语音优先/);
  assert.match(profilePage, /我能处理的业务|已授权业务范围/);
  const adminDetail = fs.readFileSync(path.join(root, "pages", "admin-task-detail", "index.wxml"), "utf8");
  assert.match(adminDetail, /监管只读/);
  assert.doesNotMatch(adminDetail, /bindtap="(?:submit|upload|action)|>提交进度</, "中台任务详情不得提供伙伴写操作");
  const adminApi = fs.readFileSync(path.join(root, "utils", "admin-api.js"), "utf8");
  assert.match(adminApi, /Authorization:\s*`Bearer/);
  assert.match(adminApi, /fetchBusinessModule/);
  assert.match(adminApi, /fetchBusinessDetail/);
  assert.match(adminApi, /businessImageUrl/);
  assert.match(adminApi, /fetchContainerCalculatorBootstrap/);
  assert.match(adminApi, /runContainerCalculation/);
  assert.doesNotMatch(adminApi, /COLLABORATION_INTERNAL_TOKEN|internalToken/, "小程序不得包含服务端集成令牌");
  const adminOverview = fs.readFileSync(path.join(root, "pages", "admin", "index.wxml"), "utf8");
  const adminOverviewScript = fs.readFileSync(path.join(root, "pages", "admin", "index.js"), "utf8");
  for (const moduleLabel of ["国内仓库库存", "产品库", "资质库", "产品备货风险", "智能装柜"]) {
    assert.match(adminOverviewScript, new RegExp(moduleLabel), `中台总览应提供经营模块入口：${moduleLabel}`);
  }
  assert.match(adminOverview, /bindtap="openBusiness"/);
  assert.match(adminOverviewScript, /pages\/admin-business\/index/);
  const adminBusiness = fs.readFileSync(path.join(root, "pages", "admin-business", "index.wxml"), "utf8");
  assert.match(adminBusiness, /移动端管理视图/);
  assert.match(adminBusiness, /bindtap="openItem"/, "经营数据卡片应可进入详情");
  assert.match(adminBusiness, /bindchange="selectWarehouse"/, "国内仓库存应支持仓库筛选");
  assert.match(adminBusiness, /business-card__visual/, "经营数据列表应提供产品缩略图区域");
  assert.match(adminBusiness, /bindtap="openCalculator"/, "智能装柜列表应提供手机临时测算入口");
  assert.doesNotMatch(adminBusiness, /bindtap="(?:save|submit|confirm|adjust)|>调整库存<|>确认装柜</, "移动经营模块不得提供高风险写操作");
  const adminBusinessDetail = fs.readFileSync(path.join(root, "pages", "admin-business-detail", "index.wxml"), "utf8");
  assert.match(adminBusinessDetail, /type="2d"[^>]*id="loadingScene"/, "智能装柜详情应包含原生 Canvas 场景");
  assert.match(adminBusinessDetail, /bindtap="setViewMode"/, "智能装柜应可切换视角");
  assert.doesNotMatch(adminBusinessDetail, /bindtap="(?:save|submit|confirm|adjust)|>确认装柜</, "经营详情仍应保持只读");
  const calculator = fs.readFileSync(path.join(root, "pages", "admin-container-calculator", "index.wxml"), "utf8");
  const calculatorScript = fs.readFileSync(path.join(root, "pages", "admin-container-calculator", "index.js"), "utf8");
  assert.match(calculator, /type="2d"[^>]*id="calculatorScene"/, "临时测算结果应提供原生 Canvas 3D 视图");
  assert.match(calculator, /bindtap="runCalculation"/, "临时测算页应提供明确的计算动作");
  assert.match(calculator, /不会新建正式装柜方案/, "临时测算页应明确说明不写入正式业务数据");
  assert.match(calculatorScript, /runContainerCalculation/);
  assert.doesNotMatch(calculatorScript, /createPlan|savePackagingProfiles|confirmPlan/, "临时测算不得调用正式方案写入能力");
}

function walk(dir, extension) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(target, extension) : target.endsWith(extension) ? [target] : [];
  });
}

async function verifyDemoContract() {
  const cache = new Map();
  function loadMiniModule(file) {
    const resolved = path.extname(file) ? file : `${file}.js`;
    if (cache.has(resolved)) return cache.get(resolved).exports;
    const module = { exports: {} };
    cache.set(resolved, module);
    const source = fs.readFileSync(resolved, "utf8");
    const wrapper = `(function(require,module,exports,__filename,__dirname){${source}\n})`;
    const factory = new vm.Script(wrapper, { filename: resolved }).runInThisContext();
    const localRequire = (specifier) => {
      if (!specifier.startsWith(".")) return require(specifier);
      return loadMiniModule(path.resolve(path.dirname(resolved), specifier));
    };
    factory(localRequire, module, module.exports, resolved, path.dirname(resolved));
    return module.exports;
  }
  const configFile = path.join(root, "config.js");
  const deliveryConfig = loadMiniModule(configFile);
  assert.equal(deliveryConfig.demoMode, false, "交付配置应连接真实业务接口");
  assert.equal(
    deliveryConfig.apiBaseUrl,
    "https://partner.tongzhoukuajing.com",
    "交付配置应指向同舟伙伴服务",
  );
  assert.equal(deliveryConfig.adminApiBaseUrl, "https://gyl.tongzhoukuajing.com", "中台模式应连接正式中台 API 域名");
  cache.set(configFile, {
    exports: Object.assign({}, deliveryConfig, {
      demoMode: true,
      apiBaseUrl: "",
    }),
  });

  const api = loadMiniModule(path.join(root, "utils", "api.js"));
  const workspaceUtils = loadMiniModule(path.join(root, "utils", "workspace.js"));
  const productionUtils = loadMiniModule(path.join(root, "utils", "production.js"));
  const samplingUtils = loadMiniModule(path.join(root, "utils", "sampling.js"));
  const activityUtils = loadMiniModule(path.join(root, "utils", "activity.js"));
  const receivingBarcodeUtils = loadMiniModule(path.join(root, "utils", "receiving-barcode.js"));
  const hermesHomeUtils = loadMiniModule(path.join(root, "utils", "hermes-home.js"));
  const preferenceUtils = loadMiniModule(path.join(root, "utils", "partner-preferences.js"));
  const hermesHome = hermesHomeUtils.buildPartnerHome([
    { id: "p1", itemType: "production_order", status: "in_progress", dueAt: "2026-10-18T00:00:00+08:00", publicPayload: { productName: "男士洁面泡沫", orderNo: "JG-01", quantity: 12000, unit: "件", progressPercent: 60 } },
    { id: "p2", itemType: "purchase_order", status: "accepted", dueAt: "2026-10-30T00:00:00+08:00", publicPayload: { productName: "包材", orderNo: "CG-01" } },
  ], { exceptionReports: 1 }, "production", new Date("2026-10-16T12:00:00+08:00"));
  assert.equal(hermesHome.todayTasks[0].productName, "男士洁面泡沫");
  assert.equal(hermesHome.todayTasks[0].progressText, "60%");
  assert.equal(hermesHome.metrics.find((item) => item.key === "production").value, 1);
  assert.equal(hermesHome.metrics.find((item) => item.key === "exception").value, 1);
  const noDuePriority = hermesHomeUtils.buildPartnerHome([
    { id: "later", itemType: "production_order", status: "accepted", title: "普通订单", publicPayload: {}, dueAt: "2026-10-30T00:00:00.000Z" },
    { id: "urgent", itemType: "production_order", status: "accepted", title: "临期订单", publicPayload: {}, dueAt: "2026-10-27T00:00:00.000Z" },
  ], {}, "production", new Date("2026-10-26T00:00:00.000Z"), { dueReminder: false });
  assert.equal(noDuePriority.todayTasks[0].id, "later", "关闭交期提醒后不应重排伙伴原始任务顺序");
  assert.equal(preferenceUtils.normalizePreferences({ voiceFirst: false }).voiceFirst, false);
  assert.deepEqual(preferenceUtils.accessScopes({ capabilities: ["production.order.view", "procurement.order.view"] }).map((item) => item.label), ["委外加工单", "物料采购单"]);
  let capturedBarcode = "";
  wx.scanCode = (options) => options.success({ result: " 6971234567890 " });
  wx.showToast = () => {};
  receivingBarcodeUtils.scanReceivedBarcode({ currentValue: "", onCaptured: (value) => { capturedBarcode = value; } });
  assert.equal(capturedBarcode, "6971234567890", "扫描结果应直接写入当前明细，不需要库存中预先存在条码");
  assert.deepEqual(
    activityUtils.visibleWorkItemEvents([
      { id: "initial", eventType: "core.oem_projection", body: "收到新的 OEM 协同任务", metadata: { version: 1 } },
      { id: "sync", eventType: "core.oem_projection", body: "订单内容已由中台更新", metadata: { version: 8 } },
      { id: "partner", eventType: "partner.progress", body: "供应商已反馈生产进度" },
    ]).map((item) => item.id),
    ["initial", "partner"],
    "时间线应过滤中台同步更新并保留首次任务和伙伴动作",
  );
  assert.deepEqual(
    activityUtils.visibleNotifications([
      { id: "sync", title: "OEM 协同任务已更新", body: "订单内容已由中台更新" },
      { id: "approval", title: "打样结果已确认", body: "最终样已由中台锁定" },
    ]).map((item) => item.id),
    ["approval"],
    "消息中心应过滤同步噪音并保留关键业务通知",
  );
  assert.equal(api.config.demoMode, true, "契约测试应在隔离的演示适配器中运行");
  const loggedIn = await api.login({ username: "warehouse.admin", password: "demo" });
  assert.equal(loggedIn.session.organization.type, "warehouse");
  const dashboard = await api.fetchDashboard();
  assert.ok(dashboard.dashboard.openTasks > 0);
  const tasks = await api.fetchWorkItems({ status: "pending" });
  assert.ok(tasks.items.length > 0);
  const detail = await api.fetchWorkItem(tasks.items[0].id);
  assert.ok(detail.lines.length > 0);
  const accepted = await api.submitAction(detail.item.id, detail.item.version, { action: "accept", note: "测试接单" });
  assert.equal(accepted.item.status, "accepted");
  const inventory = await api.fetchInventory("TZKJ-DEMO-001");
  assert.equal(inventory.items.length, 1);
  const scannedInventory = await api.fetchInventory("697000000001");
  assert.equal(scannedInventory.items.length, 1, "小程序扫码应能按商品条码命中库存");
  assert.equal(scannedInventory.items[0].sku, "TZKJ-DEMO-001");
  const operation = await api.createWarehouseOperation({
    operationType: "inbound",
    warehouseRef: inventory.items[0].warehouseRef,
    referenceNo: "TEST-RK-001",
    note: "自动化契约测试",
    lines: [{ sku: inventory.items[0].sku, productName: inventory.items[0].productName, imageUrl: "", quantity: 1, unit: "件", lotNo: "", barcode: "", productionDate: "", expiryDate: "" }],
  });
  assert.equal(operation.item.status, "pending_approval");
  const notifications = await api.fetchNotifications();
  assert.ok(notifications.items.length > 0);
  await api.markNotificationRead(notifications.items[0].id);

  const packagingLogin = await api.login({ username: "packaging.operator", password: "demo" });
  const packagingWorkspace = workspaceUtils.getWorkspace(packagingLogin.session);
  assert.equal(packagingWorkspace.kind, "packaging_factory");
  assert.equal(packagingWorkspace.modules.includes("inventory"), false);
  assert.equal(packagingWorkspace.actions.includes("partner_order_report"), true);
  assert.deepEqual(packagingWorkspace.taskTypes, ["purchase_order", "sampling_task", "packaging_quote"]);
  assert.deepEqual(packagingWorkspace.sampleCategories, ["packaging"]);
  assert.equal(packagingWorkspace.actions.includes("artifact_submit"), true);
  assert.equal(packagingWorkspace.actions.includes("quote_submit"), true);
  const purchaseTasks = await api.fetchWorkItems({ itemType: "purchase_order" });
  assert.equal(purchaseTasks.items.length, 1);
  const purchaseDetail = await api.fetchWorkItem(purchaseTasks.items[0].id);
  assert.equal(purchaseDetail.item.itemType, "purchase_order");
  assert.ok(purchaseDetail.partnerOrder.lines.length > 0);
  assert.equal(purchaseDetail.item.publicPayload.linkedProductionOrderNo, "MO-202610-018");
  assert.equal(purchaseDetail.item.publicPayload.settlementBasis, "purchase_inbound");
  assert.equal(purchaseDetail.item.publicPayload.receivedQuantity, 15000);
  assert.equal(purchaseDetail.item.publicPayload.payableAmount, 29700);
  assert.equal(purchaseDetail.item.publicPayload.inboundDocuments.length, 2);
  assert.equal(purchaseDetail.partnerOrder.lines[0].unitPrice, 1.98);
  const purchaseReport = await api.submitPartnerOrderReport(purchaseDetail.item.id, purchaseDetail.item.version, { reportType: "purchase_fulfillment", stage: "preparing", completedQuantity: 6000, expectedDeliveryDate: "2026-10-24", note: "首批备货中" });
  assert.equal(purchaseReport.report.reportType, "purchase_fulfillment");
  const packagingSamples = await api.fetchWorkItems({ itemType: "sampling_task" });
  assert.equal(packagingSamples.items.length, 1);
  assert.equal(packagingSamples.items[0].publicPayload.sampleCategory, "packaging");
  const packagingSampleDetail = await api.fetchWorkItem(packagingSamples.items[0].id);
  const packagingSampling = samplingUtils.buildSamplingWorkspace(packagingSampleDetail.item, packagingSampleDetail.oem);
  assert.ok(packagingSampling.approved, "包材演示任务应展示已锁定最终样");
  const sampleQuote = await api.submitSupplierQuote(packagingSampleDetail.item.id, packagingSampleDetail.item.version, { currency: "CNY", amount: 8600, minimumOrderQuantity: 1000, leadTimeDays: 12, terms: "含税含运", sampleArtifactId: packagingSampling.approved.id });
  assert.equal(sampleQuote.quote.sampleArtifactId, packagingSampling.approved.id, "最终报价必须绑定批准样品");

  const materialLogin = await api.login({ username: "material.operator", password: "demo" });
  const materialWorkspace = workspaceUtils.getWorkspace(materialLogin.session);
  assert.deepEqual(materialWorkspace.sampleCategories, ["inner_material"]);
  const materialSamples = await api.fetchWorkItems({ itemType: "sampling_task" });
  assert.equal(materialSamples.items.length, 1);
  assert.equal(materialSamples.items[0].publicPayload.sampleCategory, "inner_material");
  const materialSample = materialSamples.items[0];
  const variants = [samplingUtils.createSampleVariant(materialSample, 0), samplingUtils.createSampleVariant(materialSample, 1)];
  variants[0].supplierMaterialCode = "SY-DEMO-A";
  variants[1].supplierMaterialCode = "SY-DEMO-B";
  const sampleForm = { summary: "完成两款料体自检", result: "passed", supplierConclusion: "可送评", nextPlan: "等待中台反馈" };
  assert.equal(samplingUtils.validateSampleRound(materialSample, variants, sampleForm, 0), "");
  const sampleInput = samplingUtils.sampleArtifactInput(materialSample, 1, variants, sampleForm, []);
  const sampleArtifact = await api.submitOemArtifact(materialSample.id, materialSample.version, sampleInput);
  assert.equal(sampleArtifact.artifact.publicPayload.sampleVariants.length, 2);
  assert.match(sampleArtifact.artifact.publicPayload.sampleVariants[0].variantCode, /SAMPLE-R1-S1/);

  const productionLogin = await api.login({ username: "production.manager", password: "demo" });
  const productionWorkspace = workspaceUtils.getWorkspace(productionLogin.session);
  assert.deepEqual(productionWorkspace.taskTypes, ["production_order", "purchase_order", "sampling_task"]);
  assert.deepEqual(productionWorkspace.sampleCategories, ["inner_material", "packaging"]);
  const productionTasks = await api.fetchWorkItems({ itemType: "production_order" });
  assert.equal(productionTasks.items.length, 1);
  const productionDetail = await api.fetchWorkItem(productionTasks.items[0].id);
  assert.ok(productionDetail.item.publicPayload.firstArticle, "加工单应读取中台维护的首件档案");
  assert.match(productionDetail.item.publicPayload.productImageUrl, /^https:\/\//, "加工单应包含安全的产品封面地址");
  assert.ok(productionDetail.partnerOrder.lines.length > 0, "加工单应包含成品、物料或包材明细");
  const productionReport = await api.submitPartnerOrderReport(productionDetail.item.id, productionDetail.item.version, { reportType: "production_progress", stage: "packaging", progressPercent: 55, completedQuantity: 6600, expectedCompletionDate: "2026-10-18", note: "进入包装阶段" });
  assert.equal(productionReport.report.reportType, "production_progress");
  const productionSamples = await api.fetchWorkItems({ itemType: "sampling_task" });
  assert.equal(productionSamples.items.length, 2, "生产厂应同时看到料体与包材打样模块");

  const overview = productionUtils.buildProductionOverview([
    { itemType: "production_order", status: "in_progress", priority: "urgent", dueAt: "2026-10-16T00:00:00+08:00", publicPayload: {} },
    { itemType: "purchase_order", status: "accepted", priority: "normal", dueAt: "2026-10-10T00:00:00+08:00", publicPayload: {} },
    { itemType: "production_order", status: "in_progress", priority: "normal", publicPayload: {} },
  ], {}, "all", new Date("2026-10-15T12:00:00+08:00"));
  assert.equal(overview.days.length, 14, "交付日历应覆盖未来 14 天");
  assert.equal(overview.alerts.find((item) => item.key === "overdue").value, 1);
  assert.equal(overview.alerts.find((item) => item.key === "dueSoon").value, 1);
  assert.equal(overview.alerts.find((item) => item.key === "unscheduled").value, 1);

  const procurementOverview = productionUtils.buildDeliveryOverview([
    { itemType: "purchase_order", status: "accepted", priority: "normal", dueAt: "2026-10-20T00:00:00+08:00", publicPayload: {} },
    { itemType: "sampling_task", status: "in_progress", priority: "urgent", dueAt: "2026-10-18T00:00:00+08:00", publicPayload: { sampleCategory: "inner_material" } },
  ], { purchaseOrders: 1, waitingTasks: 0, exceptionReports: 0 }, "all", new Date("2026-10-15T12:00:00+08:00"), "procurement");
  assert.equal(procurementOverview.selectedCount, 2, "供应商工作台应把采购与打样统一纳入交期优先队列");
  assert.equal(procurementOverview.metrics[0].label, "采购单");

  const viewerWorkspace = workspaceUtils.fallbackWorkspace({ organization: { type: "production_factory" }, membership: { role: "viewer" }, oemEnabled: true });
  assert.deepEqual(viewerWorkspace.actions, [], "查看员不应获得任何写操作");

  const serverScopedWorkspace = workspaceUtils.getWorkspace({
    organization: { type: "production_factory" }, membership: { role: "manager" }, oemEnabled: true,
    workspace: { modules: ["overview", "tasks", "notifications", "account", "production"], actions: ["production.progress.update"], capabilities: ["production.order.view", "production.progress.update"], resources: [], taskTypes: ["production_order"] },
  });
  assert.deepEqual(serverScopedWorkspace.taskTypes, ["production_order"], "服务端授权应为小程序入口的唯一真源");
  assert.equal(serverScopedWorkspace.actions.includes("partner_order_report"), true, "线上精细权限应映射为小程序订单反馈动作");
  assert.equal(serverScopedWorkspace.actions.includes("attachment_upload"), false, "未授予附件权限时客户端不得显示上传入口");
  assert.equal(serverScopedWorkspace.modules.includes("messages"), true, "线上通知模块应映射为小程序消息页");
  assert.equal(serverScopedWorkspace.modules.includes("profile"), true, "线上账户模块应映射为小程序个人中心");
  assert.equal(workspaceUtils.quickActions(serverScopedWorkspace).some((item) => item.itemType === "purchase_order"), false, "未授权采购入口不应显示");

  const serverViewerWorkspace = workspaceUtils.getWorkspace({
    organization: { type: "production_factory" }, membership: { role: "viewer" }, oemEnabled: true,
    workspace: { modules: ["overview", "tasks", "notifications", "account", "production"], actions: ["production.progress.update", "attachment.upload"], capabilities: ["production.order.view", "production.progress.update", "attachment.upload"], resources: [], taskTypes: ["production_order"] },
  });
  assert.deepEqual(serverViewerWorkspace.actions, [], "查看员不能因组织资源授权获得写操作");
}

(async () => {
  verifyStructure();
  await verifyDemoContract();
  console.log("MINIPROGRAM_CONTRACT_TEST_OK");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
