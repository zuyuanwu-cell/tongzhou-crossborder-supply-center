import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUSINESS_CHAIN_FORMS } from "../server/business-chain-config.js";
import { initBusinessChainStore } from "../server/business-chain-db.js";
import { normalizeBusinessChainRecord } from "../server/business-chain-normalize.js";
import { createBusinessChainService } from "../server/business-chain-service.js";

function value(raw) {
  return { value: raw };
}

const contractFields = BUSINESS_CHAIN_FORMS.salesContracts.fields;
const contractDetail = BUSINESS_CHAIN_FORMS.salesContracts.detailFields;
const quoteFields = BUSINESS_CHAIN_FORMS.quotes.fields;
const purchaseFields = BUSINESS_CHAIN_FORMS.purchaseOrders.fields;
const purchaseDetail = BUSINESS_CHAIN_FORMS.purchaseOrders.detailFields;
const inboundFields = BUSINESS_CHAIN_FORMS.purchaseInboundOrders.fields;
const inboundDetail = BUSINESS_CHAIN_FORMS.purchaseInboundOrders.detailFields;
const settlementFields = BUSINESS_CHAIN_FORMS.purchaseSettlements.fields;

const quote = normalizeBusinessChainRecord("quotes", {
  data_id: "quote-record-1",
  [quoteFields.quoteNo]: value("BJ-001"),
  [quoteFields.contractNo]: value("HT-001"),
  [quoteFields.customerFullName]: value("同舟跨境供应链有限公司"),
  [quoteFields.quantity]: value(1000),
  [quoteFields.totalAmount]: value(12000),
});
const contract = normalizeBusinessChainRecord("salesContracts", {
  data_id: "contract-record-1",
  [contractFields.contractNo]: value("HT-001"),
  [contractFields.customerFullName]: value("同舟跨境供应链"),
  [contractFields.status]: value("进行中"),
  [contractFields.totalQty]: value(1000),
  [contractFields.totalAmount]: value(12000),
  [contractFields.details]: value([{
    [contractDetail.sku]: value("TZKJ-001"),
    [contractDetail.name]: value("测试产品"),
    [contractDetail.quantity]: value(1000),
    [contractDetail.quoteLink]: value([{ data_id: "quote-record-1" }]),
  }]),
});
const purchase = normalizeBusinessChainRecord("purchaseOrders", {
  data_id: "purchase-record-1",
  [purchaseFields.orderNo]: value("CG-001"),
  [purchaseFields.contractNo]: value("HT-001"),
  [purchaseFields.supplierId]: value("SUP-001"),
  [purchaseFields.supplier]: value("测试供应商"),
  [purchaseFields.totalQty]: value(1000),
  [purchaseFields.totalAmount]: value(5000),
  [purchaseFields.details]: value([{
    [purchaseDetail.sku]: value("BC-001"),
    [purchaseDetail.name]: value("包装盒"),
    [purchaseDetail.purchaseQty]: value(1000),
  }]),
});
const inbound = normalizeBusinessChainRecord("purchaseInboundOrders", {
  data_id: "inbound-record-1",
  [inboundFields.inboundNo]: value("RK-001"),
  [inboundFields.purchaseOrderNo]: value("CG-001"),
  [inboundFields.supplierId]: value("SUP-001"),
  [inboundFields.supplier]: value("测试供应商"),
  [inboundFields.totalQty]: value(800),
  [inboundFields.payableAmount]: value(4000),
  [inboundFields.details]: value([{
    [inboundDetail.sku]: value("BC-001"),
    [inboundDetail.name]: value("包装盒"),
    [inboundDetail.arrivedQty]: value(800),
  }]),
});

assert.equal(contract.isInternal, true, "internal contracts are inferred from the exact customer name");
assert.equal(contract.linkedRecordIds.includes("quote-record-1"), true, "contract detail quote links are promoted to the document level");
assert.equal(purchase.lines[0].quantity, 1000, "purchase detail quantity is normalized");

const settlement = normalizeBusinessChainRecord("purchaseSettlements", {
  data_id: "settlement-record-1",
  [settlementFields.settlementNo]: value("JS-001"),
  [settlementFields.purchaseInbounds]: value([{ _widget_1739611985722: value("RK-001") }]),
  [settlementFields.outsourcingInbounds]: value([{ _widget_1742204200188: value("WWRK-001") }]),
  [settlementFields.prepayments]: value([{ _widget_1744004698957: value("YF-001") }]),
});
assert.equal(new Set(settlement.lines.map((line) => line.id)).size, settlement.lines.length, "settlement child-table groups always receive unique line ids");

const tempDirectory = mkdtempSync(join(tmpdir(), "tongzhou-business-chain-"));
try {
  const store = await initBusinessChainStore(join(tempDirectory, "chain.sqlite"));
  store.upsertForm("quotes", BUSINESS_CHAIN_FORMS.quotes, [quote], { full: true });
  store.upsertForm("salesContracts", BUSINESS_CHAIN_FORMS.salesContracts, [contract], { full: true });
  store.upsertForm("purchaseOrders", BUSINESS_CHAIN_FORMS.purchaseOrders, [purchase], { full: true });
  store.upsertForm("purchaseInboundOrders", BUSINESS_CHAIN_FORMS.purchaseInboundOrders, [inbound], { full: true });
  const relations = store.rebuildRelations();
  assert.equal(relations.relations >= 3, true, "contract, quote, purchase and inbound records are deterministically related");

  const chainRows = store.all("SELECT document_type, chain_id FROM bc_documents");
  assert.equal(new Set(chainRows.map((row) => row.chain_id)).size, 1, "all linked documents share one chain id");
  assert.equal(chainRows[0].chain_id.startsWith("CHN-"), true);

  const syncService = { status: () => ({ running: false, results: [] }) };
  const service = createBusinessChainService(store, syncService);
  const contracts = service.listContracts({}, { finance: true });
  assert.equal(contracts.contracts.length, 1);
  assert.equal(contracts.contracts[0].linkedDocumentCount, 3);
  assert.equal(contracts.contracts[0].inboundQty, 800);
  assert.equal(contracts.contracts[0].accruedPayable, 4000);

  const detail = service.getContract("HT-001", { finance: true });
  assert.equal(detail.documents.length, 4);
  assert.equal(detail.metrics.inboundQty, 800);
  const payables = service.listPayables();
  assert.equal(payables.suppliers[0].supplierName, "测试供应商");
  assert.equal(payables.suppliers[0].unpaidAmount, 4000);
} finally {
  rmSync(tempDirectory, { recursive: true, force: true });
}

console.log("business chain tests passed");
