import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  calculateAfterSalesLiability,
  createAfterSalesService,
  formatAfterSalesRecipientInfo,
  isAfterSalesOrderWithinScope,
  isAfterSalesTicketWithinScope,
  resolveAfterSalesResponsibility,
} from "../server/after-sales.js";
import {
  afterSalesWarehouseOptions,
  afterSalesNotificationLink,
  buildAfterSalesActivatedMarkdown,
  buildAfterSalesCreatedMarkdown,
  buildAfterSalesProgressMarkdown,
  buildAfterSalesReminderMarkdown,
  notificationRobotIds,
} from "../server/after-sales-notifications.js";

const tempDir = mkdtempSync(resolve(tmpdir(), "tongzhou-after-sales-"));

try {
  assert.equal(resolveAfterSalesResponsibility("仓库错发", "补发且留错品").party, "warehouse");
  assert.equal(resolveAfterSalesResponsibility("产品质量问题", "客户退全款且退货").party, "supplier_quality");
  assert.equal(resolveAfterSalesResponsibility("运输破损", "补发且留错品").party, "logistics");
  assert.equal(resolveAfterSalesResponsibility("SKU匹配错误", "客户补差价留错品").party, "operations");
  assert.match(formatAfterSalesRecipientInfo({ name: "张三", phone: "13800000000", country: "中国", address: "测试路 1 号" }), /收件人：张三/);

  const warehouseOptions = afterSalesWarehouseOptions({ site: "ID" }, [
    { id: "warehouse-id", name: "印尼仓", country: "印度尼西亚" },
    { id: "warehouse-my", name: "马来仓", country: "马来西亚" },
  ]);
  assert.deepEqual(warehouseOptions.map((item) => item.id), ["warehouse-id"]);
  assert.deepEqual(notificationRobotIds({ robotIds: ["fallback"], warehouseRobotIds: { "warehouse-id": ["robot-id"] } }, "warehouse-id"), ["robot-id"]);
  assert.equal(
    afterSalesNotificationLink("#after-sales", "https://gyl.example.com", { module: "after_sales", view: "warehouse", ticket: "AS-1" }),
    "https://gyl.example.com/#after-sales?module=after_sales&view=warehouse&ticket=AS-1",
  );

  const liability = calculateAfterSalesLiability({
    responsibility: { party: "warehouse" },
    affectedItems: [{ sku: "TZKJ-A", affectedQty: 2, unitCostCny: 14.4 }],
    packagingFeeCny: 1.9,
    additionalLiabilityCny: 3,
    customerRecoveryCny: 1,
  });
  assert.equal(liability.totalWarehouseLiabilityCny, 32.7);

  const upserts = [];
  const performanceStore = {
    findMiaoshouOrderBundlesByPlatformOrderSns() { return { orders: [], items: [] }; },
    upsertMiaoshouPerformance(payload) { upserts.push(payload); },
    listExchangeRates() { return [{ currency: "USD", effectiveDate: "2026-01-01", rateToCny: 7.2, source: "test" }]; },
    listSupplementalProductCosts() { return []; },
    getPerformanceSettings() {
      return { packagingFeeRules: [{ countryKey: "ID", countryName: "印度尼西亚", mode: "flat", baseFeeCny: 1.9, enabled: true }] };
    },
  };
  const connector = {
    performanceContext() {
      return { hasCredentials: true, shops: [{ shopId: "SHOP-1", platform: "shopee", site: "ID", shopNick: "印尼测试店", platformShopName: "Indonesia Test" }] };
    },
    async searchPerformancePackages(input) {
      if (input.platform !== "shopee") return { data: { orderPackageList: [] } };
      return {
        data: {
          orderPackageList: [{
            opOrderPackageId: "PKG-1",
            recipientInfo: { recipientName: "Tester", recipientPhone: "081234", recipientAddress: "Jakarta" },
            orderInfo: {
              opOrderId: "OP-1",
              platform: "shopee",
              shopId: "SHOP-1",
              platformOrderSn: "ORDER-1",
              site: "ID",
              gmtOrderStart: "2026-09-01 10:00:00",
            },
            items: [{ opOrderPackageItemId: "ITEM-1", platformOuterSkuId: "TZKJ-A", quantity: 2 }],
          }],
        },
      };
    },
  };
  const service = createAfterSalesService({
    cachePath: resolve(tempDir, "after-sales.json"),
    uploadDir: resolve(tempDir, "uploads"),
    performanceStore,
    connector,
    getProducts: () => ({
      catalog: [{ sku: "TZKJ-A", country: "印度尼西亚", name: "测试产品", directCostPrice: 2, directCostCurrency: "USD", imageUrl: "/test.png" }],
      productBase: [],
    }),
  });

  const synced = await service.syncOrder("ORDER-1");
  assert.equal(synced.source, "miaoshou_live");
  assert.equal(synced.order.items.length, 1);
  assert.equal(synced.order.items[0].orderedQty, 2);
  assert.equal(synced.order.items[0].unitCostCny, 14.4);
  assert.equal(synced.order.customer.name, "Tester");
  assert.match(synced.order.customer.recipientInfo, /电话：081234/);
  assert.equal(upserts.length, 1);
  const productOptions = service.searchProducts({ keyword: "测试", country: "ID" });
  assert.equal(productOptions.products.length, 1);
  assert.equal(productOptions.products[0].unitCostCny, 14.4);
  assert.equal(productOptions.products[0].imageUrl, "/test.png");
  const productOptionsWithoutCountry = service.searchProducts({ keyword: "测试" });
  assert.equal(productOptionsWithoutCountry.products[0].unitCostCny, 14.4, "未同步国家时仍应优先带入产品目录直营成本");

  const actor = { id: "user-1", displayName: "运营测试" };
  const evidence = service.saveUpload({
    fileName: "proof.png",
    kind: "evidence",
    dataUrl: "data:image/png;base64,iVBORw0KGgo=",
  }, actor, "http://localhost:8787");
  const videoEvidence = service.saveUploadBytes({
    fileName: "customer-feedback.mp4",
    mimeType: "video/mp4",
    kind: "evidence",
    bytes: Buffer.from("000000186674797069736f6d00000000", "hex"),
  }, actor, "http://localhost:8787");
  assert.equal(videoEvidence.mimeType, "video/mp4");
  assert.match(videoEvidence.id, /\.mp4$/);
  assert.equal(service.uploadPath(videoEvidence.id)?.upload.id, videoEvidence.id);
  assert.throws(() => service.saveUploadBytes({
    fileName: "not-a-label.mp4",
    mimeType: "video/mp4",
    kind: "label",
    bytes: Buffer.from("000000186674797069736f6d00000000", "hex"),
  }, actor, "http://localhost:8787"), /视频请上传到售后问题凭证/);
  assert.equal(service.canAccessUpload(evidence.id, { countries: ["MY"] }, actor.id), true, "the uploader must be able to preview an unsubmitted upload");
  assert.equal(service.canAccessUpload(videoEvidence.id, { countries: ["MY"] }, actor.id), true, "the uploader must be able to preview an unsubmitted video");
  assert.equal(service.canAccessUpload(evidence.id, { countries: ["ID"] }, "other-user"), false, "unsubmitted uploads are private to their uploader");
  const draft = service.saveDraft({
    orderNumber: synced.order.orderNumber,
    order: synced.order,
    customer: synced.order.customer,
    warehouseId: "warehouse-id",
    warehouseName: "印尼仓",
    originalItems: synced.order.items,
    reissueItems: [],
    primaryReasonCode: "warehouse_short_shipment",
    secondaryReasonCode: "wrong_item_bad_review_no_return",
    evidenceIds: [videoEvidence.id],
    operatorRemark: "等待客户确认是否补发",
  }, actor);
  assert.match(draft.id, /^ASD-/);
  assert.equal(draft.primaryReason, "仓库漏发少发");
  assert.equal(draft.secondaryReason, "仓库发错货，客户差评不退货");
  assert.equal(service.listDrafts(actor).length, 1);
  assert.equal(service.listDrafts({ id: "other-user" }).length, 0, "drafts must remain private to their creator");
  const created = service.create({
    order: synced.order,
    customer: synced.order.customer,
    warehouseId: "warehouse-id",
    warehouseName: "印尼仓",
    originalItems: synced.order.items,
    reissueItems: [{ sku: "TZKJ-A", productName: "测试产品", imageUrl: "/test.png", quantity: 2, unitCostCny: 14.4, costSource: "产品库直营成本" }],
    primaryReason: "仓库漏发 / 少发",
    primaryReasonCode: "warehouse_short_shipment",
    secondaryReason: "",
    secondaryReasonCode: "wrong_item_bad_review_no_return",
    needsReissue: true,
    evidenceIds: [evidence.id, videoEvidence.id],
    operatorRemark: "测试错发",
    additionalLiabilityCny: 0,
    customerRecoveryCny: 0,
    notificationRoute: { teamId: "team-a", teamName: "项目 A", submitterUserId: actor.id, submitterName: actor.displayName, submitterWecomUserId: "operator_1", mentionSubmitter: true, resolvedAt: "2026-09-12T00:00:00.000Z" },
  }, actor);
  assert.match(created.ticket.id, /^AS-\d{8}-0001$/);
  assert.equal(created.ticket.money.totalWarehouseLiabilityCny, 30.7);
  assert.equal(created.ticket.evidence.length, 2);
  assert.equal(created.ticket.warehouseId, "warehouse-id");
  assert.equal(created.ticket.notificationRoute.teamId, "team-a");
  assert.equal(created.ticket.primaryReason, "仓库漏发少发");
  assert.equal(created.ticket.secondaryReason, "仓库发错货，客户差评不退货");
  const createdMarkdown = buildAfterSalesCreatedMarkdown(created.ticket, { requestOrigin: "https://gyl.example.com" });
  assert.match(createdMarkdown, /新售后单待处理/);
  assert.match(createdMarkdown, /ticket=AS-/);

  const reminded = service.remind(created.ticket.id, actor);
  assert.equal(reminded.ticket.status, "pending_warehouse");
  assert.equal(reminded.ticket.timeline.at(-1).type, "reminder_sent");
  assert.equal(reminded.ticket.timeline.at(-1).label, "运营催办仓库");
  assert.ok(reminded.nextReminderAt);
  assert.match(buildAfterSalesReminderMarkdown(reminded.ticket, { requestOrigin: "https://gyl.example.com", statusLabel: "待仓库接单" }), /售后单催办提醒/);
  assert.match(buildAfterSalesReminderMarkdown(reminded.ticket, { requestOrigin: "https://gyl.example.com" }), /view=warehouse/);
  assert.throws(() => service.remind(created.ticket.id, actor), /30 分钟/);

  const warehouse = { id: "warehouse-1", displayName: "仓库测试" };
  const rejected = service.updateWarehouse(created.ticket.id, { action: "reject", warehouseRemark: "经核查并非仓库错发，请运营修改原因" }, warehouse);
  assert.equal(rejected.ticket.status, "rejected");
  assert.match(rejected.ticket.rejectionReason, /并非仓库错发/);
  assert.throws(() => service.resubmit(created.ticket.id, { primaryReason: "SKU匹配错误", secondaryReason: "补发且留错品" }, actor), /修改说明/);
  const resubmitted = service.resubmit(created.ticket.id, {
    primaryReason: "仓库错发",
    secondaryReason: "补发且留错品",
    correctionNote: "已复核仓库出库照片，维持仓库错发并补充说明",
  }, actor);
  assert.equal(resubmitted.ticket.status, "pending_warehouse");
  assert.equal(resubmitted.ticket.rejectionHistory.length, 1);
  const accepted = service.updateWarehouse(created.ticket.id, { action: "accept", warehouseRemark: "已核查" }, warehouse);
  assert.equal(accepted.ticket.status, "processing");
  assert.match(buildAfterSalesProgressMarkdown(accepted.ticket, { statusLabel: "仓库已受理" }), /仓库已受理/);
  const waiting = service.updateWarehouse(created.ticket.id, { action: "await_reshipment" }, warehouse);
  assert.equal(waiting.ticket.status, "awaiting_reshipment");
  assert.throws(() => service.updateWarehouse(created.ticket.id, { action: "shipped" }, warehouse), /面单/);

  const label = service.saveUpload({
    fileName: "label.pdf",
    kind: "label",
    dataUrl: "data:application/pdf;base64,JVBERi0xLjQ=",
  }, warehouse, "http://localhost:8787");
  const withLabel = service.attachLabels(created.ticket.id, [label.id], warehouse, "补发单号 SF123");
  assert.equal(withLabel.ticket.labelUploads.length, 1);
  assert.match(buildAfterSalesProgressMarkdown(withLabel.ticket, { requestOrigin: "https://gyl.example.com" }), /补发面单：已上传 1 张/);
  const shipped = service.updateWarehouse(created.ticket.id, { action: "shipped" }, warehouse);
  assert.equal(shipped.ticket.status, "shipped");
  assert.equal(shipped.ticket.labelUploads.length, 1);
  const completed = service.updateWarehouse(created.ticket.id, { action: "complete", note: "客户确认收到" }, warehouse);
  assert.equal(completed.ticket.status, "completed");
  assert.equal(completed.ticket.timeline.length, 9);
  assert.throws(() => service.remind(created.ticket.id, actor), /已完结/);
  const reopened = service.updateWarehouse(created.ticket.id, { action: "reopen", note: "继续跟进" }, actor);
  assert.equal(reopened.ticket.status, "processing");
  const cancelled = service.updateWarehouse(created.ticket.id, { action: "cancel", note: "误操作测试" }, actor);
  assert.equal(cancelled.ticket.status, "cancelled");
  assert.equal(cancelled.ticket.cancelledFromStatus, "processing");
  const activated = service.updateWarehouse(created.ticket.id, { action: "activate", note: "恢复误作废售后单" }, actor);
  assert.equal(activated.ticket.status, "processing");
  assert.equal(activated.ticket.timeline.at(-1).type, "activate");
  assert.match(activated.ticket.timeline.at(-1).label, /售后已激活/);
  assert.match(buildAfterSalesActivatedMarkdown(activated.ticket, { requestOrigin: "https://gyl.example.com", statusLabel: "仓库已受理" }), /售后单重新激活/);
  assert.match(buildAfterSalesActivatedMarkdown(activated.ticket, { requestOrigin: "https://gyl.example.com" }), /view=warehouse/);
  assert.equal(service.deleteDraft(draft.id, actor).id, draft.id);
  assert.equal(service.listDrafts(actor).length, 0);

  const listed = service.list();
  assert.equal(listed.summary.total, 1);
  assert.equal(listed.tickets[0].customer, undefined, "customer data must not appear in list payloads");
  assert.equal(listed.tickets[0].customerSummary.configured, true);
  assert.equal(service.list({ dataScopes: { countries: ["马来西亚"] } }).summary.total, 0);
  assert.equal(service.list({ dataScopes: { countries: ["印度尼西亚"] } }).summary.total, 1);
  assert.equal(service.list({ createdById: actor.id }).summary.total, 1);
  assert.equal(service.list({ createdById: "another-user" }).summary.total, 0);
  assert.equal(service.list({ dataScopes: { warehouseIds: ["warehouse-my"] } }).summary.total, 0);
  assert.equal(service.list({ dataScopes: { warehouseIds: ["warehouse-id"] } }).summary.total, 1);
  assert.equal(service.list({ dataScopes: { skus: ["TZKJ-B"] } }).summary.total, 0);
  assert.equal(service.list({ dataScopes: { skus: ["TZKJ-A"] } }).summary.total, 1);
  assert.equal(service.get(created.ticket.id, { countries: ["MY"] }), null);
  assert.equal(service.get(created.ticket.id, { countries: ["ID"] })?.id, created.ticket.id);
  assert.equal(service.get(created.ticket.id, { countries: ["ID"] }, "another-user"), null);
  service.recordNotification(created.ticket.id, { eventType: "created", target: "warehouse", status: "sent", robotCount: 1, routeLabel: "项目群：项目 A", teamId: "team-a", mentionedCount: 2 });
  assert.equal(service.get(created.ticket.id)?.notifications?.at(-1)?.status, "sent");
  assert.equal(service.get(created.ticket.id)?.notifications?.at(-1)?.routeLabel, "项目群:项目 A");
  assert.equal(service.get(created.ticket.id)?.notifications?.at(-1)?.mentionedCount, 2);
  assert.equal(service.canAccessUpload(evidence.id, { countries: ["MY"] }, "other-user"), false);
  assert.equal(service.canAccessUpload(evidence.id, { countries: ["ID"] }, "other-user"), true);
  assert.equal(service.canAccessUpload(evidence.id, { countries: ["MY"] }, actor.id), false, "submitted uploads must follow the ticket's current data scope");
  assert.equal(isAfterSalesTicketWithinScope({
    site: "ID",
    originalItems: [
      { sku: "TZKJ-A", affectedQty: 1 },
      { sku: "TZKJ-B", affectedQty: 1 },
    ],
  }, { skus: ["TZKJ-A"] }), false, "all affected SKUs must stay inside the assigned scope");
  assert.equal(isAfterSalesTicketWithinScope({
    site: "ID",
    warehouseId: "",
    originalItems: [{ sku: "TZKJ-A", affectedQty: 1 }],
  }, { warehouseIds: ["warehouse-id"] }), false, "unassigned legacy tickets must not leak into a scoped warehouse account");
  assert.equal(isAfterSalesOrderWithinScope({
    site: "ID",
    originalItems: [{ sku: "TZKJ-A", affectedQty: 1 }],
  }, { warehouseIds: ["warehouse-id"] }), true, "source orders may be synchronized before the operator selects an allowed warehouse");
  assert.equal(isAfterSalesOrderWithinScope({
    site: "MY",
    originalItems: [{ sku: "TZKJ-A", affectedQty: 1 }],
  }, { countries: ["ID"], warehouseIds: ["warehouse-id"] }), false, "country scope must still be enforced before warehouse selection");
  assert.equal(isAfterSalesOrderWithinScope({
    site: "ID",
    originalItems: [{ sku: "TZKJ-B", affectedQty: 1 }],
  }, { skus: ["TZKJ-A"], warehouseIds: ["warehouse-id"] }), false, "SKU scope must still be enforced before warehouse selection");

  console.log("after-sales workflow tests passed");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
