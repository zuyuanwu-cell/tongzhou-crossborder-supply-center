import { JIANYUN_FORMS } from "./field-mapping.js";

export const BUSINESS_CHAIN_FORM_ORDER = Object.freeze([
  "salesContracts",
  "quotes",
  "craftOrders",
  "outsourcingOrders",
  "purchaseOrders",
  "purchaseInboundOrders",
  "outsourcingInboundOrders",
  "salesShipments",
  "purchasePrepayments",
  "purchaseSettlements",
  "openingDemands",
]);

export const BUSINESS_CHAIN_FORMS = Object.freeze({
  openingDemands: { ...JIANYUN_FORMS.openingDemands, type: "opening_demand", label: "开品需求", maxPages: 20 },
  quotes: { ...JIANYUN_FORMS.quotes, type: "quote", label: "报价单", maxPages: 30 },
  salesContracts: { ...JIANYUN_FORMS.salesContracts, type: "sales_contract", label: "销售合同", maxPages: 40 },
  craftOrders: { ...JIANYUN_FORMS.craftOrders, type: "craft_order", label: "工艺单", maxPages: 30 },
  outsourcingOrders: { ...JIANYUN_FORMS.outsourcingOrders, type: "outsourcing_order", label: "委外加工单", maxPages: 40 },
  purchaseOrders: { ...JIANYUN_FORMS.purchaseOrders, type: "purchase_order", label: "物料采购单", maxPages: 40 },
  purchaseInboundOrders: { ...JIANYUN_FORMS.purchaseInboundOrders, type: "purchase_inbound", label: "采购入库单", maxPages: 40 },
  outsourcingInboundOrders: { ...JIANYUN_FORMS.outsourcingInboundOrders, type: "outsourcing_inbound", label: "委外入库单", maxPages: 40 },
  salesShipments: { ...JIANYUN_FORMS.salesShipments, type: "sales_shipment", label: "销售发货单", maxPages: 40 },
  purchasePrepayments: { ...JIANYUN_FORMS.purchasePrepayments, type: "purchase_prepayment", label: "采购预付款", maxPages: 30 },
  purchaseSettlements: { ...JIANYUN_FORMS.purchaseSettlements, type: "purchase_settlement", label: "采购结算单", maxPages: 30 },
});

export const BUSINESS_CHAIN_TYPE_LABELS = Object.freeze(Object.fromEntries(
  Object.values(BUSINESS_CHAIN_FORMS).map((form) => [form.type, form.label]),
));

export const BUSINESS_CHAIN_SYNC_INTERVAL_MS = Math.max(
  60 * 60 * 1000,
  Number(process.env.BUSINESS_CHAIN_SYNC_INTERVAL_MS || 6 * 60 * 60 * 1000),
);

export const BUSINESS_CHAIN_FULL_SYNC_INTERVAL_MS = Math.max(
  6 * 60 * 60 * 1000,
  Number(process.env.BUSINESS_CHAIN_FULL_SYNC_INTERVAL_MS || 24 * 60 * 60 * 1000),
);
