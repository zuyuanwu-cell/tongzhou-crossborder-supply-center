import assert from "node:assert/strict";
import { createMobileAdminBusinessProviders } from "../server/mobile-admin-business.js";

let inventoryFilters = null;
const product = {
  id: "product-1",
  sku: "SKU-1",
  name: "测试产品",
  country: "中国",
  imageUrl: "https://files.example.com/product.png",
  publicDescription: "公开产品说明",
  stockQty: 18,
};
const qualification = { id: "qualification-1", sku: "SKU-1", qualificationName: "检测报告", files: [{ name: "report.pdf", url: "https://files.example.com/report.pdf" }] };
const recommendation = { id: "risk-1", sku: "SKU-1", name: "测试产品", status: "缺货", availableQty: 0, replenishQty: 20, netReplenishQty: 20, outsourcingInProductionQty: 0 };
const plan = {
  id: "plan-1", planNo: "ZGX-001", name: "测试装柜", status: "draft", containerType: "40HQ", selectedStrategy: "max_load", version: 1,
  container: { code: "40HQ", name: "40HQ 高柜", lengthCm: 1203, widthCm: 235, heightCm: 269, maxPayloadKg: 26480 },
  items: [{ id: "line-1", sku: "SKU-1", productName: "测试产品", cartonCount: 1, unitsPerCarton: 12, cartonLengthCm: 40, cartonWidthCm: 30, cartonHeightCm: 20, cartonWeightKg: 8 }],
  candidates: [{ strategy: "max_load", metrics: { loadedCartons: 1, totalCartons: 1, volumeUtilization: 52.4 }, warnings: [], placements: [{ placementId: "line-1:1", itemId: "line-1", sku: "SKU-1", x: 0, y: 0, z: 0, lengthCm: 40, widthCm: 30, heightCm: 20, sequence: 1 }] }],
};

const providers = createMobileAdminBusinessProviders({
  domesticInventoryService: {
    list(filters) {
      inventoryFilters = filters;
      return {
        updatedAt: "2026-10-16T00:00:00.000Z",
        summary: { warehouses: 1, skuCount: 1 },
        warehouses: [{ id: "warehouse-1", name: "广州仓", city: "广州", status: "active" }],
        balances: [{ id: "balance-1", warehouseId: "warehouse-1", warehouseName: "广州仓", sku: "SKU-1", productName: "测试产品", onHandQty: 10, reservedQty: 2, availableQty: 8 }],
      };
    },
  },
  domesticInventoryContextForAuth: () => ({}),
  getProducts: () => ({ syncedAt: "2026-10-16T00:00:00.000Z", productBase: [product], catalog: [product] }),
  productResponsePayload: (payload) => payload,
  getQualifications: () => ({ qualifications: [qualification] }),
  scopedPartnerPayload: (payload) => payload,
  getStockupPayload: () => ({ recommendations: [recommendation], counts: { recommendations: 1, netRecommendedQty: 20 } }),
  containerLoadingService: {
    bootstrap: () => ({
      plans: [{ ...plan, summary: { metrics: plan.candidates[0].metrics } }],
      shipments: [{ id: "shipment-1", shipmentNo: "FY-001", destinationWarehouseName: "俄罗斯仓", packages: 1, lines: plan.items }],
      containerTypes: [plan.container],
      limits: { maxCartons: 2000 },
    }),
    getPlan: () => ({ plan, versions: [] }),
    calculatePreview: async () => ({
      preview: true,
      sourceType: "manual",
      sourceShipmentId: "",
      sourceShipmentNo: "",
      destinationWarehouseName: "",
      container: plan.container,
      items: plan.items,
      selectedStrategy: "max_load",
      candidates: plan.candidates,
      calculatedAt: "2026-10-16T00:00:00.000Z",
    }),
  },
  hasPermission: () => true,
});

const inventory = providers.domesticInventory({ warehouseId: "warehouse-1" }, { role: "admin", user: {} });
assert.equal(inventoryFilters.warehouseId, "warehouse-1");
assert.equal(inventory.items[0].imageUrl, product.imageUrl, "库存缺图时应从产品库回填");
assert.equal(inventory.items[0].imageKey.length, 64);
assert.equal((await providers.domesticInventory.detail(inventory.items[0].id, { role: "admin", user: {} })).barcode, "");

const productDetail = await providers.products.detail("product-1", { role: "admin", user: {} });
assert.equal(productDetail.publicDescription, "公开产品说明");
assert.equal(providers.resolveImage(productDetail.imageKey), product.imageUrl);

const qualificationDetail = await providers.qualifications.detail("qualification-1", { role: "admin", user: {} });
assert.equal(qualificationDetail.files[0].name, "report.pdf");
assert.equal((await providers.stockupRisks.detail("risk-1", { role: "admin", user: {} })).netReplenishQty, 20);

const containerDetail = await providers.containerLoading.detail("plan-1", { role: "admin", user: {} });
assert.equal(containerDetail.candidate.placements.length, 1);
assert.equal(containerDetail.candidate.metrics.volumeUtilization, 52.4);
const calculatorBootstrap = await providers.containerLoading.calculatorBootstrap({ role: "admin", user: {} });
assert.equal(calculatorBootstrap.containerTypes[0].code, "40HQ");
assert.equal(calculatorBootstrap.shipments[0].lines[0].sku, "SKU-1");
const calculation = await providers.containerLoading.calculate({ items: plan.items, containerType: "40HQ" }, { role: "admin", user: {} });
assert.equal(calculation.preview, true);
assert.equal(calculation.candidates[0].placements.length, 1);
assert.equal(calculation.candidates[0].renderedPlacements, 1);

console.log("MOBILE_ADMIN_BUSINESS_TEST_OK");
