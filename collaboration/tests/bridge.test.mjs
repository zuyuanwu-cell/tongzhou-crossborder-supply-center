import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initCollaborationBridgeStore } from "../../server/collaboration-bridge-db.js";
import { createCollaborationBridge } from "../../server/collaboration-bridge.js";

async function fixture(t, { commands = [], resultFailures = 0, organizations = [], accessGrants = [], inventory = null, workItems = [], workItemDetail = null, oemEnabled = false, outsourcingRecords = [], firstArticleRecords = [] } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "tongzhou-collaboration-bridge-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await initCollaborationBridgeStore(join(dir, "bridge.sqlite"));
  const requests = [];
  const movements = [];
  const stockupActions = [];
  const sourceFeedback = [];
  let remainingResultFailures = resultFailures;
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null, authorization: options.headers?.Authorization });
    const parsedUrl = new URL(String(url));
    if (parsedUrl.pathname.endsWith("/access-grants") && (options.method || "GET") === "GET") {
      return new Response(JSON.stringify({ ok: true, organization: organizations[0] || { code: "warehouse-a", organizationType: "warehouse" }, grants: accessGrants }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (parsedUrl.pathname.endsWith("/organizations") && (options.method || "GET") === "GET") {
      return new Response(JSON.stringify({ ok: true, organizations }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (parsedUrl.pathname.endsWith("/work-items") && (options.method || "GET") === "GET") {
      return new Response(JSON.stringify({ ok: true, items: workItems, counts: { pending: workItems.length }, total: workItems.length, limit: 50, offset: 0 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (/\/work-items\/[0-9a-f-]{36}$/i.test(parsedUrl.pathname) && (options.method || "GET") === "GET") {
      return new Response(JSON.stringify(workItemDetail || { item: workItems[0], lines: [], events: [], attachments: [], commands: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(url).includes("/commands?") && (options.method || "GET") === "GET") {
      return new Response(JSON.stringify({ ok: true, commands, nextCursor: commands.at(-1)?.submittedAt || "" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(url).endsWith("/result") && remainingResultFailures > 0) {
      remainingResultFailures -= 1;
      return new Response(JSON.stringify({ ok: false, message: "temporary outage" }), { status: 503, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true, status: "applied" }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const bridge = createCollaborationBridge({
    store,
    domesticInventoryService: {
      createMovement(input, _context, idempotencyKey) {
        movements.push({ input, idempotencyKey });
        return { ok: true, movementId: "movement-1", movementNo: "RK-001" };
      },
      receiveTransfer() { return { ok: true, transfer: { transferNo: "DB-001" } }; },
      list() {
        return inventory || { ok: true, warehouses: [], balances: [] };
      },
    },
    stockupCollaborationService: {
      applyWarehouseWorkOrderAction(workOrderId, payload, context, idempotencyKey) {
        stockupActions.push({ workOrderId, payload, context, idempotencyKey });
        return { ok: true, workOrder: { id: workOrderId, workOrderNo: "DWO-001", status: "completed" } };
      },
    },
    listProducts: () => [{ id: "product-1", sku: "SKU-1", name: "测试产品", imageUrl: "https://files.example.test/product.jpg", unit: "件", directCostPrice: 99 }],
    baseUrl: "http://collaboration.test",
    internalToken: "internal-test-token",
    publicOrigin: "https://partner.example.test",
    oemEnabled,
    listActiveOutsourcingOrders: async () => outsourcingRecords,
    listOutsourcingFactoryOrders: async (factoryId) => outsourcingRecords.filter((record) => String(record._widget_1741698535338?.value || "") === String(factoryId)),
    listFirstArticleRecords: async () => firstArticleRecords,
    recordOutsourcingPartnerFeedback: async (feedback) => { sourceFeedback.push(feedback); return { ok: true, skipped: false }; },
    fetchImpl,
  });
  return { bridge, movements, requests, stockupActions, sourceFeedback, store };
}

const projection = {
  organizationCode: "warehouse-a",
  coreRefType: "domestic_inbound",
  coreRefId: "inbound-1",
  itemType: "warehouse_inbound",
  title: "一号仓入库",
  version: 1,
  publicPayload: { warehouseRef: "warehouse-1", warehouseName: "一号仓", referenceNo: "RK-001" },
  lines: [{ sku: "SKU-1", productName: "测试产品", plannedQuantity: 10 }],
};

const partnerOrderProjection = {
  organizationCode: "pf-factory-a", coreRefType: "outsourcing_order", coreRefId: "MO-001", orderType: "production", itemType: "production_order",
  title: "委外加工单 MO-001", version: 1,
  publicPayload: { orderNo: "MO-001", productName: "洗护套装", fulfillmentMode: "turnkey", quantity: 1000, unit: "套" },
  lines: [{ lineRef: "finished-1", lineType: "finished_product", sku: "SKU-1", productName: "测试产品", plannedQuantity: 1000, unit: "套", responsibility: "factory" }],
};

test("core bridge persists and publishes allowlisted projections", async (t) => {
  const { bridge, requests, store } = await fixture(t);
  const queued = bridge.queueProjection(projection);
  assert.equal(queued.status, "pending");
  assert.throws(() => bridge.queueProjection({ ...projection, eventId: "unsafe", customerName: "敏感客户" }));
  const result = await bridge.flushOutbox();
  assert.deepEqual(result, { published: 1, failed: 0, disabled: false });
  assert.equal(requests[0].method, "PUT");
  assert.equal(requests[0].url, "http://collaboration.test/collaboration/internal/v1/projections");
  assert.equal(requests[0].authorization, "Bearer internal-test-token");
  assert.equal(store.status().outbox.published, 1);
});

test("core bridge publishes production and purchase orders through the private order endpoint", async (t) => {
  const { bridge, requests } = await fixture(t, { oemEnabled: true });
  const queued = bridge.queuePartnerOrderProjection(partnerOrderProjection);
  assert.equal(queued.status, "pending");
  assert.throws(() => bridge.queuePartnerOrderProjection({ ...partnerOrderProjection, customerName: "敏感客户" }));
  assert.deepEqual(await bridge.flushOutbox(), { published: 1, failed: 0, disabled: false });
  assert.equal(requests[0].url, "http://collaboration.test/collaboration/internal/v1/partner-orders/projections");
  assert.equal(requests[0].body.publicPayload.orderNo, "MO-001");
});

test("internal administrators manually publish only procurement and sampling tasks", async (t) => {
  const accessGrants = [
    { resourceType: "organization", resourceRef: "production", permissions: ["production.order.view"] },
    { resourceType: "organization", resourceRef: "procurement", permissions: ["procurement.order.view"] },
    { resourceType: "organization", resourceRef: "sampling", permissions: ["sampling.task.view"] },
  ];
  const { bridge, requests } = await fixture(t, {
    oemEnabled: true,
    organizations: [{ code: "mf-songyu", name: "松雨", organizationType: "production_factory", status: "active" }],
    accessGrants,
    workItems: [{ id: "99999999-9999-4999-8999-999999999999", itemType: "production_order", status: "in_progress" }],
  });
  const common = {
    documentNo: "SY-20261013-001",
    title: "松雨协同单",
    productName: "测试产品",
    quantity: 1000,
    unit: "件",
    dueAt: "2026-10-30T10:00:00.000Z",
    requirements: "按确认版本执行",
    lines: [{ sku: "SKU-1", productName: "测试产品", plannedQuantity: 1000, unit: "件" }],
  };

  for (const taskType of ["purchase_order", "sampling_task"]) {
    const result = await bridge.publishPartnerTask("mf-songyu", { ...common, taskType, ...(taskType === "sampling_task" ? { sampleCategory: "inner_material", sampleSubject: "formula", sampleGoal: "确认最终配方", evaluationCriteria: "气味与稳定性通过", quoteRequired: true } : {}) }, { actorName: "中台管理员" });
    assert.equal(result.delivery.published, 1);
  }

  const purchase = requests.find((request) => request.url.endsWith("/partner-orders/projections") && request.body.itemType === "purchase_order");
  const sampling = requests.find((request) => request.url.endsWith("/oem/projections") && request.body.itemType === "sampling_task");
  assert.equal(purchase.body.publicPayload.fulfillmentMode, "supplier");
  assert.equal(sampling.body.publicPayload.projectCode, "SY-20261013-001");
  assert.equal(sampling.body.publicPayload.sampleCategory, "inner_material");
  assert.equal(sampling.body.publicPayload.sampleSubject, "formula");
  assert.equal("internalCost" in sampling.body.publicPayload, false);
  await assert.rejects(() => bridge.publishPartnerTask("mf-songyu", { ...common, taskType: "production_order" }, { actorName: "中台管理员" }), /千顷 ERP 自动同步/);

  const listing = await bridge.listOrganizationWorkItems("mf-songyu", { itemType: "production_order" });
  assert.equal(listing.items[0].status, "in_progress");
  assert.match(requests.at(-1).url, /organizationCode=mf-songyu/);
  assert.match(requests.at(-1).url, /itemType=production_order/);
});

test("JiandaoYun factory binding projects only the exact factory active outsourcing orders", async (t) => {
  const fields = (values) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }]));
  const outsourcingRecords = [
    {
      data_id: "jdy-active-songyu",
      updateTime: "2026-10-13T09:42:01.811Z",
      ...fields({
        _widget_1741698535338: "215",
        _widget_1666521891102: "松雨",
        _widget_1744031628891: "广州市婉兮生物科技有限公司",
        out_order_id: "JG26092902",
        _widget_1690015838240: "进行中",
        _widget_1753770713537: "CD26063656",
        _widget_1666513866235: "DEVNEN 防晒美白乳液",
        _widget_1741575793630: "375ml 光银软管配内托",
        _widget_1666513866239: "6970000000215",
        _widget_1705027350738: "灌装,打码,装盒,包材测试",
        _widget_1743344141428: "专用箱（印箱唛）",
        _widget_1742959598371: 48,
        _widget_1666513866237: 10000,
        _widget_1741671761933: "瓶",
        _widget_1666522275282: "2026-10-30T16:00:00.000Z",
        _widget_1742543391241: "否",
        _widget_1742797820565: "否",
        _widget_1742797820567: "否",
        _widget_1742797820569: "否",
        _widget_1689752535149: "sensitive-customer",
      }),
      _widget_1666513866246: { value: [
        fields({ _widget_1667632334265: "GY26061586B1", _widget_1666513866248: "乳液料体", _widget_1666519610456: "215", _widget_1666513866251: "松雨", _widget_1666513866261: 10000, _widget_1690004171630: "瓶" }),
        fields({ _widget_1667632334265: "GY26061586B2", _widget_1666513866248: "外购玻璃瓶", _widget_1666519610456: "55", _widget_1666513866251: "其他供应商", _widget_1666513866261: 10000, _widget_1690004171630: "个" }),
      ] },
    },
    { data_id: "jdy-completed-songyu", ...fields({ _widget_1741698535338: "215", _widget_1666521891102: "松雨", _widget_1744031628891: "广州市婉兮生物科技有限公司", out_order_id: "JG25010001", _widget_1690015838240: "已完成", _widget_1753770713537: "CD25000001", _widget_1666513866235: "历史产品", _widget_1666513866237: 100, _widget_1741671761933: "件" }) },
    { data_id: "jdy-active-other", ...fields({ _widget_1741698535338: "58", _widget_1666521891102: "广州雅顿", _widget_1744031628891: "广州市白云区雅顿化妆品厂", out_order_id: "JG26000002", _widget_1690015838240: "进行中", _widget_1753770713537: "CD26000002", _widget_1666513866235: "其他工厂产品", _widget_1666513866237: 200, _widget_1741671761933: "件" }) },
  ];
  const accessGrants = [{ resourceType: "organization", resourceRef: "production", permissions: ["production.order.view", "production.progress.update", "production.material.update"] }];
  const firstArticleRecords = [{
    data_id: "first-article-1",
    updateTime: "2026-10-13T10:00:00.000Z",
    ...fields({
      _widget_1748966576636: "FA-CD26063656-V3",
      _widget_1748966576637: "CD26063656",
      _widget_1748966576638: "V3",
      _widget_1748966576639: "DEVNEN 防晒美白乳液",
      _widget_1748966576640: "375ml 光银软管配内托",
      _widget_1748966576645: "松雨",
      _widget_1748966576647: "6970000000215",
      _widget_1748966576648: "防晒美白乳液",
      _widget_1748966576649: "NA18260100001",
      _widget_1748966576775: "灌装,密封测试,打码,装盒",
      _widget_1748966576788: "48瓶/箱",
    }),
    _widget_1748966576651: { value: [fields({ _widget_1748966576655: "包材", _widget_1748966576657: "光银软管", _widget_1748966576658: "GY26061586B1", _widget_1748966576659: "375", _widget_1748966576661: "ml", _widget_1748966576663: "1", _widget_1748966576668: "敏感供应商", _widget_1748966576670: "SECRET-55" })] },
    _widget_1748966576708: { value: [{ name: "产品六面图.jpg", mime: "image/jpeg", size: 1024, url: "https://files.jiandaoyun.com/first-article/product.jpg" }] },
  }];
  const { bridge, requests } = await fixture(t, {
    oemEnabled: true,
    organizations: [{ code: "mf-songyu", name: "松雨", organizationType: "production_factory", status: "active" }],
    accessGrants,
    outsourcingRecords,
    firstArticleRecords,
  });

  const source = await bridge.getOutsourcingSourceBinding("mf-songyu");
  assert.equal(source.binding.factoryId, "215");
  assert.equal(source.activeOrderCount, 1);
  const sync = await bridge.synchronizeOutsourcingProjections({ organizationCode: "mf-songyu" });
  assert.equal(sync.queued, 1);
  assert.equal(sync.failed, 0);
  assert.equal((await bridge.flushOutbox()).published, 1);
  const projection = requests.find((request) => request.url.endsWith("/partner-orders/projections"));
  assert.equal(projection.body.coreRefId, "JG26092902");
  assert.equal(projection.body.publicPayload.fulfillmentMode, "labor_only");
  assert.equal(projection.body.publicPayload.productSpec, "375ml 光银软管配内托");
  assert.equal(projection.body.publicPayload.barcode, "6970000000215");
  assert.equal(projection.body.publicPayload.productionProcess, "灌装,打码,装盒,包材测试");
  assert.equal(projection.body.publicPayload.cartonType, "专用箱（印箱唛）");
  assert.equal(projection.body.publicPayload.piecesPerCarton, 48);
  assert.equal(projection.body.publicPayload.firstArticle.documentNo, "FA-CD26063656-V3");
  assert.equal(projection.body.publicPayload.firstArticle.matchedBy, "barcode");
  assert.equal(projection.body.publicPayload.firstArticle.images[0].label, "产品包装六面图");
  assert.equal(projection.body.publicPayload.firstArticle.bom[0].materialCode, "GY26061586B1");
  assert.equal(projection.body.lines[0].specification, "375ml 光银软管配内托");
  assert.equal(projection.body.lines.length, 2);
  assert.equal(projection.body.lines.some((line) => line.productName === "外购玻璃瓶"), false);
  assert.equal(JSON.stringify(projection.body).includes("sensitive-customer"), false);
  assert.equal(JSON.stringify(projection.body).includes("其他供应商"), false);
  assert.equal(JSON.stringify(projection.body).includes("敏感供应商"), false);
  assert.equal(JSON.stringify(projection.body).includes("SECRET-55"), false);
  const unchanged = await bridge.synchronizeOutsourcingProjections({ organizationCode: "mf-songyu" });
  assert.equal(unchanged.queued, 0);
  assert.equal(unchanged.unchanged, 1);
});

test("partner task publication is denied until the target organization has the matching grant", async (t) => {
  const { bridge } = await fixture(t, {
    oemEnabled: true,
    organizations: [{ code: "mf-songyu", name: "松雨", organizationType: "production_factory", status: "active" }],
    accessGrants: [{ resourceType: "organization", resourceRef: "production", permissions: ["production.order.view"] }],
  });
  await assert.rejects(() => bridge.publishPartnerTask("mf-songyu", {
    taskType: "sampling_task",
    documentNo: "SAMPLE-001",
    title: "打样",
    productName: "测试产品",
    quantity: 2,
    unit: "件",
    requirements: "提交样品结果",
    sampleCategory: "inner_material",
    sampleSubject: "formula",
    lines: [{ sku: "SKU-1", productName: "测试产品", plannedQuantity: 2, unit: "件" }],
  }), /尚未开通/);
});

test("saving warehouse access immediately publishes an allowlisted inventory snapshot", async (t) => {
  const accessGrants = [{
    resourceType: "warehouse",
    resourceRef: "warehouse-1",
    resourceName: "一号仓",
    permissions: ["warehouse.inventory.view"],
  }];
  const { bridge, requests, store } = await fixture(t, {
    organizations: [{ code: "warehouse-a", organizationType: "warehouse", status: "active" }],
    accessGrants,
    inventory: {
      ok: true,
      warehouses: [{ id: "warehouse-1", name: "一号仓" }],
      balances: [{ sku: "SKU-1", productName: "测试产品", availableQty: 8, reservedQty: 2, unit: "件", imageUrl: "https://files.jiandaoyun.com/product.jpg", unitCostCny: 99 }],
    },
  });

  const saved = await bridge.replaceOrganizationAccessGrants("warehouse-a", { grants: accessGrants, actorName: "内部管理员" });
  assert.equal(saved.inventoryProjection.queued, 1);
  assert.equal(saved.inventoryProjection.delivery.published, 1);
  const published = requests.find((request) => request.url.endsWith("/collaboration/internal/v1/inventory"));
  assert.ok(published);
  assert.deepEqual(published.body.items, [{ sku: "SKU-1", productName: "测试产品", imageUrl: "https://files.jiandaoyun.com/product.jpg", availableQuantity: 8, lockedQuantity: 2, inTransitQuantity: 0, unit: "件" }]);
  assert.equal(published.body.warehouseRef, "warehouse-1");
  assert.equal(published.body.items[0].imageUrl.startsWith("https://"), true);
  assert.equal("unitCostCny" in published.body.items[0], false);
  assert.equal(store.status().outbox.published, 1);

  const unchanged = await bridge.synchronizeInventoryProjections({ organizationCode: "warehouse-a" });
  assert.equal(unchanged.queued, 0);
  assert.equal(unchanged.unchanged, 1);
});

test("background synchronization backfills inventory for grants created before automatic projection", async (t) => {
  const accessGrants = [{ resourceType: "warehouse", resourceRef: "warehouse-1", resourceName: "一号仓", permissions: ["warehouse.inventory.view"] }];
  const { bridge, requests } = await fixture(t, {
    organizations: [{ code: "warehouse-a", organizationType: "warehouse", status: "active" }],
    accessGrants,
    inventory: {
      ok: true,
      warehouses: [{ id: "warehouse-1", name: "一号仓" }],
      balances: [{ sku: "SKU-2", productName: "历史授权产品", availableQty: 5, reservedQty: 0, unit: "件" }],
    },
  });

  const first = await bridge.synchronize();
  assert.equal(first.inventoryProjections.queued, 1);
  assert.equal(first.outbox.published, 1);
  assert.equal(requests.filter((request) => request.url.endsWith("/collaboration/internal/v1/inventory")).length, 1);

  const second = await bridge.synchronize();
  assert.deepEqual(second.inventoryProjections, { skipped: true, reason: "not_due" });
  assert.equal(second.outbox.published, 0);
});

test("partner inbound command is revalidated and idempotently booked in the core ledger", async (t) => {
  const command = {
    id: "11111111-1111-4111-8111-111111111111",
    organizationCode: "warehouse-a",
    workItemId: "22222222-2222-4222-8222-222222222222",
    coreRefType: "domestic_inbound",
    coreRefId: "inbound-1",
    itemType: "warehouse_inbound",
    publicPayload: projection.publicPayload,
    commandType: "inbound_confirm",
    idempotencyKey: "warehouse-submit-1",
    expectedVersion: 1,
    payload: { action: "inbound_confirm", note: "到货完好", lines: [{ sku: "SKU-1", quantity: 10 }] },
    riskLevel: "medium",
    status: "pending_sync",
    submittedByName: "仓库操作员",
    submittedAt: "2026-09-28T08:00:00.000Z",
  };
  const { bridge, movements, requests, store } = await fixture(t, { commands: [command] });
  const result = await bridge.pullCommands();
  assert.equal(result.processed, 1);
  assert.equal(movements.length, 1);
  assert.equal(movements[0].input.warehouseId, "warehouse-1");
  assert.equal(movements[0].input.lines[0].productName, "测试产品");
  assert.equal(movements[0].idempotencyKey, `collaboration:${command.id}:warehouse-submit-1`);
  assert.equal(store.command(command.id).local_status, "applied");
  assert.equal(requests.at(-1).url, `http://collaboration.test/collaboration/internal/v1/commands/${command.id}/result`);
});

test("partner stockup processing updates the domestic warehouse work order idempotently", async (t) => {
  const command = {
    id: "12121212-1212-4121-8121-121212121212",
    organizationCode: "warehouse-a",
    workItemId: "23232323-2323-4232-8232-232323232323",
    coreRefType: "stockup_warehouse_work_order",
    coreRefId: "swwo-test-1",
    itemType: "warehouse_stockup",
    publicPayload: { ...projection.publicPayload, workOrder: { workOrderId: "swwo-test-1" } },
    commandType: "stockup_process",
    idempotencyKey: "stockup-process-1",
    expectedVersion: 2,
    payload: { action: "stockup_process", note: "已验收并发货", lines: [], expenses: [], routes: [] },
    riskLevel: "medium",
    status: "pending_sync",
    submittedByName: "仓库操作员",
    submittedAt: "2026-10-13T08:00:00.000Z",
  };
  const { bridge, stockupActions, store } = await fixture(t, { commands: [command] });
  const result = await bridge.pullCommands();
  assert.equal(result.processed, 1);
  assert.equal(stockupActions.length, 1);
  assert.equal(stockupActions[0].workOrderId, "swwo-test-1");
  assert.equal(stockupActions[0].payload.action, "process");
  assert.equal(stockupActions[0].context.viewAll, true);
  assert.equal(stockupActions[0].idempotencyKey, `collaboration:${command.id}:stockup-process-1`);
  assert.equal(store.command(command.id).local_status, "applied");
});

test("high-risk adjustment remains local approval work until reviewed", async (t) => {
  const command = {
    id: "33333333-3333-4333-8333-333333333333",
    organizationCode: "warehouse-a",
    workItemId: "44444444-4444-4444-8444-444444444444",
    coreRefType: "inventory_exception",
    coreRefId: "exception-1",
    itemType: "warehouse_exception",
    publicPayload: projection.publicPayload,
    commandType: "inventory_adjustment",
    idempotencyKey: "adjustment-1",
    expectedVersion: 1,
    payload: { action: "inventory_adjustment", reason: "盘点差异", lines: [{ sku: "SKU-1", quantity: 2, direction: "decrease" }] },
    riskLevel: "high",
    status: "pending_approval",
    submittedByName: "仓库管理员",
    submittedAt: "2026-09-28T09:00:00.000Z",
  };
  const { bridge, movements } = await fixture(t, { commands: [command] });
  await bridge.pullCommands();
  assert.equal(bridge.listApprovals().length, 1);
  assert.equal(movements.length, 0);
  await bridge.reviewCommand(command.id, { approved: true, reviewer: "内控" });
  assert.equal(movements[0].input.type, "adjustment");
  assert.equal(movements[0].input.lines[0].deltaQty, -2);
});

test("a result callback outage never replays an already-booked inventory movement", async (t) => {
  const command = {
    id: "55555555-5555-4555-8555-555555555555",
    organizationCode: "warehouse-a",
    workItemId: "66666666-6666-4666-8666-666666666666",
    coreRefType: "domestic_inbound",
    coreRefId: "inbound-2",
    itemType: "warehouse_inbound",
    publicPayload: projection.publicPayload,
    commandType: "inbound_confirm",
    idempotencyKey: "warehouse-submit-2",
    expectedVersion: 1,
    payload: { action: "inbound_confirm", lines: [{ sku: "SKU-1", quantity: 4 }] },
    riskLevel: "medium",
    status: "pending_sync",
    submittedByName: "仓库操作员",
    submittedAt: "2026-09-28T10:00:00.000Z",
  };
  const { bridge, movements, store } = await fixture(t, { commands: [command], resultFailures: 1 });
  const first = await bridge.pullCommands();
  assert.equal(first.processed, 0);
  assert.equal(movements.length, 1);
  assert.equal(store.command(command.id).local_status, "awaiting_result");
  await bridge.synchronize();
  assert.equal(movements.length, 1);
  assert.equal(store.command(command.id).local_status, "applied");
});

test("factory production feedback is written back to the JiandaoYun source once", async (t) => {
  const command = {
    id: "95555555-5555-4555-8555-555555555555",
    organizationCode: "mf-songyu",
    workItemId: "96666666-6666-4666-8666-666666666666",
    coreRefType: "jiandaoyun_outsourcing_order",
    coreRefId: "JG26101301",
    itemType: "production_order",
    publicPayload: { orderNo: "JG26101301", productName: "测试产品", fulfillmentMode: "turnkey" },
    commandType: "order_production_progress",
    idempotencyKey: "production-progress-1",
    expectedVersion: 2,
    payload: { reportType: "production_progress", stage: "filling", progressPercent: 35, completedQuantity: 3500, expectedCompletionDate: "2026-10-20", note: "首批灌装完成" },
    riskLevel: "medium",
    status: "pending_sync",
    submittedByName: "松雨生产负责人",
    submittedAt: "2026-10-13T12:00:00.000Z",
  };
  const { bridge, sourceFeedback, store } = await fixture(t, { commands: [command] });
  assert.equal((await bridge.pullCommands()).processed, 1);
  assert.equal(sourceFeedback.length, 1);
  assert.deepEqual(sourceFeedback[0], { orderNo: "JG26101301", commandType: "order_production_progress", payload: command.payload, submittedByName: "松雨生产负责人", submittedAt: command.submittedAt });
  assert.match(store.command(command.id).result.message, /千顷 ERP/);
  await bridge.pullCommands();
  assert.equal(sourceFeedback.length, 1, "applied command must never be written back twice");
});

test("organization order detail is scoped to its organization and cannot leak through warehouse routes", async (t) => {
  const item = { id: "98888888-8888-4888-8888-888888888888", organizationCode: "mf-songyu", itemType: "production_order", publicPayload: { orderNo: "JG26101302" } };
  const { bridge } = await fixture(t, { workItems: [item], workItemDetail: { item, lines: [], events: [], attachments: [], commands: [], partnerOrder: { lines: [], reports: [], milestones: [] } } });
  assert.equal((await bridge.getOrganizationWorkItem("mf-songyu", item.id)).item.id, item.id);
  await assert.rejects(() => bridge.getOrganizationWorkItem("mf-other", item.id), (error) => error?.code === "organization_scope_denied");
  await assert.rejects(() => bridge.getWarehouseTask(item.id), (error) => error?.code === "warehouse_task_type_denied");
});

test("identity administration stays behind the server-side collaboration token", async (t) => {
  const { bridge, requests } = await fixture(t);
  const invitationId = "77777777-7777-4777-8777-777777777777";

  await bridge.listOrganizations({ keyword: "华东", status: "active" });
  await bridge.bootstrapOrganization({
    name: "华东仓储",
    organizationType: "warehouse",
    administrator: {
      username: "warehouse-admin",
      email: "",
      displayName: "仓库管理员",
      password: "Temporary123!",
    },
    actorName: "内部管理员",
  });
  await bridge.getOrganizationAccess("cn-east-warehouse");
  await bridge.updateOrganizationStatus("cn-east-warehouse", { status: "suspended", actorName: "内部管理员" });
  await bridge.reissueInvitation(invitationId, { actorName: "内部管理员" });
  await bridge.revokeInvitation(invitationId, { actorName: "内部管理员" });

  assert.equal(requests.length, 6);
  assert.match(requests[0].url, /^http:\/\/collaboration\.test\/collaboration\/internal\/v1\/organizations\?/);
  assert.match(requests[0].url, /keyword=%E5%8D%8E%E4%B8%9C/);
  assert.match(requests[0].url, /status=active/);
  assert.equal(requests[1].url, "http://collaboration.test/collaboration/internal/v1/organizations/bootstrap");
  assert.equal(requests[1].method, "POST");
  assert.equal(requests[1].body.code, undefined);
  assert.equal(requests[1].body.administrator.email, "");
  assert.equal(requests[1].body.administrator.password, "Temporary123!");
  assert.equal(requests[2].url, "http://collaboration.test/collaboration/internal/v1/organizations/cn-east-warehouse");
  assert.equal(requests[3].method, "PATCH");
  assert.equal(requests[4].url, `http://collaboration.test/collaboration/internal/v1/invitations/${invitationId}/reissue`);
  assert.equal(requests[5].url, `http://collaboration.test/collaboration/internal/v1/invitations/${invitationId}/revoke`);
  assert.ok(requests.every((request) => request.authorization === "Bearer internal-test-token"));
});

test("internal staff can publish an allowlisted warehouse task and read partner progress", async (t) => {
  const workItemDetail = {
    item: { id: "88888888-8888-4888-8888-888888888888", itemType: "warehouse_inbound", publicPayload: { warehouseRef: "warehouse-1" } },
    lines: [{ sku: "SKU-1" }],
    events: [],
    attachments: [],
    commands: [],
  };
  const accessGrants = [{
    resourceType: "warehouse",
    resourceRef: "warehouse-1",
    resourceName: "一号仓",
    permissions: ["warehouse.task.view", "warehouse.task.handle", "warehouse.outbound.confirm"],
  }];
  const workItems = [{ id: "88888888-8888-4888-8888-888888888888", title: "电商订单出库", status: "pending" }];
  const { bridge, requests, store } = await fixture(t, {
    organizations: [{ code: "warehouse-a", name: "一号仓协同组织", organizationType: "warehouse", status: "active" }],
    accessGrants,
    inventory: {
      ok: true,
      warehouses: [{ id: "warehouse-1", name: "一号仓" }],
      balances: [{ sku: "SKU-1", productName: "测试产品", imageUrl: "https://files.example.test/product.jpg", availableQty: 20, reservedQty: 2, unit: "件" }],
    },
    workItems,
    workItemDetail,
  });

  const options = await bridge.listWarehouseTaskOptions();
  assert.equal(options.portalUrl, "https://partner.example.test");
  assert.equal(options.organizations[0].warehouses[0].resourceRef, "warehouse-1");
  assert.equal(options.products[0].availableByWarehouse["warehouse-1"], 20);
  assert.equal("directCostPrice" in options.products[0], false);

  const published = await bridge.publishWarehouseTask({
    organizationCode: "warehouse-a",
    warehouseRef: "warehouse-1",
    itemType: "warehouse_outbound",
    referenceNo: "CK-20260929-001",
    title: "电商订单出库",
    description: "完成拣货和复核",
    priority: "urgent",
    dueAt: "2026-09-30T02:00:00.000Z",
    lines: [{ sku: "SKU-1", plannedQuantity: 12, unit: "件" }],
  }, { idempotencyKey: "publish-warehouse-task-1", actorName: "中台管理员" });

  assert.equal(published.delivery.published, 1);
  assert.equal(store.status().outbox.published, 1);
  const projectionRequest = requests.find((request) => request.url.endsWith("/collaboration/internal/v1/projections"));
  assert.ok(projectionRequest);
  assert.equal(projectionRequest.body.organizationCode, "warehouse-a");
  assert.equal(projectionRequest.body.publicPayload.warehouseRef, "warehouse-1");
  assert.equal(projectionRequest.body.lines[0].imageUrl, "https://files.example.test/product.jpg");
  assert.equal("directCostPrice" in projectionRequest.body.lines[0], false);

  const progress = await bridge.listWarehouseTasks({ organizationCode: "warehouse-a" }, { warehouseIds: ["warehouse-1"], skus: ["SKU-1"] });
  assert.equal(progress.items[0].status, "pending");
  assert.match(requests.at(-1).url, /organizationCode=warehouse-a/);
  assert.match(requests.at(-1).url, /warehouseRefs=warehouse-1/);
  assert.match(requests.at(-1).url, /skus=SKU-1/);
  assert.equal((await bridge.getWarehouseTask(workItems[0].id, { warehouseIds: ["warehouse-1"], skus: ["SKU-1"] })).lines[0].sku, "SKU-1");
  await assert.rejects(() => bridge.getWarehouseTask(workItems[0].id, { warehouseIds: ["warehouse-2"] }), /无权查看该仓库/);
  await assert.rejects(() => bridge.getWarehouseTask(workItems[0].id, { skus: ["SKU-2"] }), /无权查看该任务中的商品/);
});
