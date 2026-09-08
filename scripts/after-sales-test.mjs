import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  calculateAfterSalesLiability,
  createAfterSalesService,
  isAfterSalesTicketWithinScope,
  resolveAfterSalesResponsibility,
} from "../server/after-sales.js";

const tempDir = mkdtempSync(resolve(tmpdir(), "tongzhou-after-sales-"));

try {
  assert.equal(resolveAfterSalesResponsibility("仓库错发", "补发且留错品").party, "warehouse");
  assert.equal(resolveAfterSalesResponsibility("产品质量问题", "客户退全款且退货").party, "supplier_quality");
  assert.equal(resolveAfterSalesResponsibility("运输破损", "补发且留错品").party, "logistics");
  assert.equal(resolveAfterSalesResponsibility("SKU匹配错误", "客户补差价留错品").party, "operations");

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
  assert.equal(upserts.length, 1);

  const actor = { id: "user-1", displayName: "运营测试" };
  const evidence = service.saveUpload({
    fileName: "proof.png",
    kind: "evidence",
    dataUrl: "data:image/png;base64,iVBORw0KGgo=",
  }, actor, "http://localhost:8787");
  assert.equal(service.canAccessUpload(evidence.id, { countries: ["MY"] }, actor.id), true, "the uploader must be able to preview an unsubmitted upload");
  assert.equal(service.canAccessUpload(evidence.id, { countries: ["ID"] }, "other-user"), false, "unsubmitted uploads are private to their uploader");
  const created = service.create({
    order: synced.order,
    customer: synced.order.customer,
    originalItems: synced.order.items,
    reissueItems: [{ sku: "TZKJ-A", productName: "测试产品", quantity: 2 }],
    primaryReason: "仓库错发",
    secondaryReason: "补发且留错品",
    needsReissue: true,
    evidenceIds: [evidence.id],
    operatorRemark: "测试错发",
    additionalLiabilityCny: 0,
    customerRecoveryCny: 0,
  }, actor);
  assert.match(created.ticket.id, /^AS-\d{8}-0001$/);
  assert.equal(created.ticket.money.totalWarehouseLiabilityCny, 30.7);
  assert.equal(created.ticket.evidence.length, 1);

  const warehouse = { id: "warehouse-1", displayName: "仓库测试" };
  const accepted = service.updateWarehouse(created.ticket.id, { action: "accept", warehouseRemark: "已核查" }, warehouse);
  assert.equal(accepted.ticket.status, "processing");
  const waiting = service.updateWarehouse(created.ticket.id, { action: "await_reshipment" }, warehouse);
  assert.equal(waiting.ticket.status, "awaiting_reshipment");
  assert.throws(() => service.updateWarehouse(created.ticket.id, { action: "shipped" }, warehouse), /面单/);

  const label = service.saveUpload({
    fileName: "label.pdf",
    kind: "label",
    dataUrl: "data:application/pdf;base64,JVBERi0xLjQ=",
  }, warehouse, "http://localhost:8787");
  const shipped = service.updateWarehouse(created.ticket.id, { action: "shipped", labelUploadIds: [label.id] }, warehouse);
  assert.equal(shipped.ticket.status, "shipped");
  assert.equal(shipped.ticket.labelUploads.length, 1);
  const completed = service.updateWarehouse(created.ticket.id, { action: "complete", note: "客户确认收到" }, warehouse);
  assert.equal(completed.ticket.status, "completed");
  assert.equal(completed.ticket.timeline.length, 5);

  const listed = service.list();
  assert.equal(listed.summary.total, 1);
  assert.equal(listed.tickets[0].customer, undefined, "customer data must not appear in list payloads");
  assert.equal(listed.tickets[0].customerSummary.configured, true);
  assert.equal(service.list({ dataScopes: { countries: ["马来西亚"] } }).summary.total, 0);
  assert.equal(service.list({ dataScopes: { countries: ["印度尼西亚"] } }).summary.total, 1);
  assert.equal(service.list({ dataScopes: { skus: ["TZKJ-B"] } }).summary.total, 0);
  assert.equal(service.list({ dataScopes: { skus: ["TZKJ-A"] } }).summary.total, 1);
  assert.equal(service.get(created.ticket.id, { countries: ["MY"] }), null);
  assert.equal(service.get(created.ticket.id, { countries: ["ID"] })?.id, created.ticket.id);
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

  console.log("after-sales workflow tests passed");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
