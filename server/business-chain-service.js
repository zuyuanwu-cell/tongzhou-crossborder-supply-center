import { BUSINESS_CHAIN_TYPE_LABELS } from "./business-chain-config.js";

const STAGES = [
  { key: "contract", label: "合同", types: ["sales_contract"] },
  { key: "craft", label: "工艺/BOM", types: ["craft_order"] },
  { key: "production", label: "委外生产", types: ["outsourcing_order"] },
  { key: "purchase", label: "物料采购", types: ["purchase_order"] },
  { key: "inbound", label: "入库", types: ["purchase_inbound", "outsourcing_inbound"] },
  { key: "shipment", label: "发货", types: ["sales_shipment"] },
  { key: "settlement", label: "结算", types: ["purchase_prepayment", "purchase_settlement"] },
];

function escapeLike(value) {
  return String(value || "").replace(/[\\%_]/g, (character) => `\\${character}`);
}

function daysSince(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? Math.max(0, Math.floor((Date.now() - time) / 86_400_000)) : null;
}

function number(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function latestValue(values) {
  const sorted = values.filter(Boolean).sort();
  return sorted.length ? sorted[sorted.length - 1] : "";
}

function customerDisplayName(document) {
  const value = String(document?.customerName || "").trim();
  if (value && !/^[-—–]+$/.test(value)) return value;
  return document?.isInternal ? "同舟跨境供应链" : value;
}

function lineFromRow(row) {
  return {
    id: row.id, lineUuid: row.line_uuid || "", sku: row.sku || "", name: row.name || "", unit: row.unit || "",
    quantity: number(row.quantity), amount: number(row.amount), referenceNo: row.reference_no || "",
    contractNo: row.contract_no || "", contractLineNo: row.contract_line_no || "",
  };
}

export function createBusinessChainService(store, syncService) {
  function freshness() {
    const forms = store.syncStates();
    const successful = forms.filter((item) => item.lastSuccessAt);
    const failed = forms.filter((item) => item.status === "failed");
    const updatedAt = latestValue(successful.map((item) => item.lastSuccessAt));
    const oldestAt = successful.map((item) => item.lastSuccessAt).sort()[0] || "";
    return {
      updatedAt, oldestAt, complete: successful.length === Object.keys(BUSINESS_CHAIN_TYPE_LABELS).length && failed.length === 0,
      indexedForms: successful.length, expectedForms: Object.keys(BUSINESS_CHAIN_TYPE_LABELS).length,
      failedForms: failed.map((item) => ({ formKey: item.formKey, label: item.label, message: item.lastError })),
    };
  }

  function aggregateChain(chainId) {
    const documents = store.all("SELECT * FROM bc_documents WHERE chain_id = ? ORDER BY occurred_at, document_type", [chainId]).map(store.rowToDocument);
    const byType = new Map();
    for (const document of documents) {
      if (!byType.has(document.documentType)) byType.set(document.documentType, []);
      byType.get(document.documentType).push(document);
    }
    const stages = STAGES.map((stage, index) => {
      const matches = stage.types.flatMap((type) => byType.get(type) || []);
      return {
        ...stage,
        status: matches.length ? "complete" : index === 0 ? "active" : "pending",
        count: matches.length,
        lastAt: latestValue(matches.map((item) => item.updatedAt || item.occurredAt)),
      };
    });
    const contract = documents.find((item) => item.documentType === "sales_contract");
    const inboundQty = documents.filter((item) => ["purchase_inbound", "outsourcing_inbound"].includes(item.documentType)).reduce((sum, item) => sum + item.quantity, 0);
    const shippedQty = documents.filter((item) => item.documentType === "sales_shipment").reduce((sum, item) => sum + item.quantity, 0);
    const accruedPayable = documents.filter((item) => ["purchase_inbound", "outsourcing_inbound"].includes(item.documentType)).reduce((sum, item) => sum + item.payableAmount, 0);
    const paidAmount = documents.filter((item) => ["purchase_prepayment", "purchase_settlement"].includes(item.documentType)).reduce((sum, item) => sum + item.paidAmount, 0);
    return { contract, documents, stages, inboundQty, shippedQty, accruedPayable, paidAmount, unpaidAmount: Math.max(0, accruedPayable - paidAmount) };
  }

  function summary({ finance = false } = {}) {
    const contractCounts = store.first(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN is_internal=1 THEN 1 ELSE 0 END) AS internal_count,
      SUM(CASE WHEN status NOT LIKE '%完成%' AND status NOT LIKE '%完结%' AND status NOT LIKE '%作废%' AND status NOT LIKE '%取消%' THEN 1 ELSE 0 END) AS active_count
      FROM bc_documents WHERE document_type='sales_contract'`) || {};
    const quantity = store.first(`SELECT
      SUM(CASE WHEN document_type IN ('purchase_inbound','outsourcing_inbound') THEN quantity ELSE 0 END) AS inbound_qty,
      SUM(CASE WHEN document_type='sales_shipment' THEN quantity ELSE 0 END) AS shipped_qty
      FROM bc_documents`) || {};
    const pendingLinks = store.first("SELECT COUNT(*) AS count FROM bc_documents WHERE document_type<>'sales_contract' AND COALESCE(chain_id,'')='' ") || {};
    const payload = {
      ok: true,
      freshness: freshness(),
      sync: syncService.status(),
      counts: {
        contracts: number(contractCounts.total), activeContracts: number(contractCounts.active_count), internalContracts: number(contractCounts.internal_count),
        inboundQty: number(quantity.inbound_qty), shippedQty: number(quantity.shipped_qty), pendingLinks: number(pendingLinks.count),
      },
    };
    if (finance) {
      const money = store.first(`SELECT
        SUM(CASE WHEN document_type IN ('purchase_inbound','outsourcing_inbound') THEN payable_amount ELSE 0 END) AS accrued,
        SUM(CASE WHEN document_type IN ('purchase_prepayment','purchase_settlement') THEN paid_amount ELSE 0 END) AS paid
        FROM bc_documents`) || {};
      payload.finance = { accruedPayable: number(money.accrued), paidAmount: number(money.paid), unpaidAmount: Math.max(0, number(money.accrued) - number(money.paid)) };
    }
    return payload;
  }

  function listContracts(query = {}, { finance = false } = {}) {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(10, Number(query.pageSize || 20)));
    const where = ["document_type='sales_contract'"];
    const params = [];
    if (query.keyword) {
      const keyword = `%${escapeLike(query.keyword)}%`;
      where.push("(document_no LIKE ? ESCAPE '\\' OR customer_name LIKE ? ESCAPE '\\' OR source_data_id LIKE ? ESCAPE '\\')");
      params.push(keyword, keyword, keyword);
    }
    if (query.status) { where.push("status=?"); params.push(query.status); }
    if (query.internal === "yes") where.push("is_internal=1");
    if (query.internal === "no") where.push("is_internal=0");
    const sqlWhere = where.join(" AND ");
    const total = number(store.first(`SELECT COUNT(*) AS count FROM bc_documents WHERE ${sqlWhere}`, params)?.count);
    const contracts = store.all(`SELECT * FROM bc_documents WHERE ${sqlWhere} ORDER BY COALESCE(occurred_at, updated_at) DESC LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize])
      .map(store.rowToDocument)
      .map((contract) => {
        const aggregate = aggregateChain(contract.chainId);
        const item = {
          ...contract,
          customerName: customerDisplayName(contract),
          ageDays: daysSince(contract.occurredAt), stages: aggregate.stages,
          inboundQty: aggregate.inboundQty, shippedQty: aggregate.shippedQty,
          linkedDocumentCount: aggregate.documents.length - 1,
        };
        if (finance) Object.assign(item, { accruedPayable: aggregate.accruedPayable, paidAmount: aggregate.paidAmount, unpaidAmount: aggregate.unpaidAmount });
        return item;
      });
    return { ok: true, freshness: freshness(), pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }, contracts };
  }

  function getContract(id, { finance = false } = {}) {
    const contract = store.rowToDocument(store.first("SELECT * FROM bc_documents WHERE document_type='sales_contract' AND (id=? OR source_data_id=? OR document_no=?)", [id, id, id]));
    if (!contract) return null;
    const aggregate = aggregateChain(contract.chainId);
    const documents = aggregate.documents.map((document) => ({
      ...document,
      lines: store.all("SELECT * FROM bc_document_lines WHERE document_id=? ORDER BY rowid", [document.id]).map(lineFromRow),
      ...(!finance ? { amount: 0, payableAmount: 0, paidAmount: 0, supplierName: "" } : {}),
    }));
    return { ok: true, contract: { ...contract, customerName: customerDisplayName(contract), ...(!finance ? { amount: 0 } : {}) }, stages: aggregate.stages, documents, metrics: finance ? { inboundQty: aggregate.inboundQty, shippedQty: aggregate.shippedQty, accruedPayable: aggregate.accruedPayable, paidAmount: aggregate.paidAmount, unpaidAmount: aggregate.unpaidAmount } : { inboundQty: aggregate.inboundQty, shippedQty: aggregate.shippedQty } };
  }

  function listPayables(query = {}) {
    const keyword = String(query.keyword || "").trim().toLowerCase();
    const groups = new Map();
    const documents = store.all("SELECT * FROM bc_documents WHERE document_type IN ('purchase_inbound','outsourcing_inbound','purchase_prepayment','purchase_settlement')").map(store.rowToDocument);
    for (const document of documents) {
      const key = document.supplierId || document.supplierName || "未识别供应商";
      if (keyword && !`${document.supplierId} ${document.supplierName}`.toLowerCase().includes(keyword)) continue;
      const item = groups.get(key) || { supplierId: document.supplierId, supplierName: document.supplierName || "未识别供应商", accruedPayable: 0, paidAmount: 0, inboundDocumentCount: 0, paymentDocumentCount: 0, lastOccurredAt: "" };
      if (["purchase_inbound", "outsourcing_inbound"].includes(document.documentType)) { item.accruedPayable += document.payableAmount; item.inboundDocumentCount += 1; }
      else { item.paidAmount += document.paidAmount; item.paymentDocumentCount += 1; }
      item.lastOccurredAt = latestValue([item.lastOccurredAt, document.occurredAt]);
      groups.set(key, item);
    }
    const suppliers = [...groups.values()].map((item) => ({ ...item, unpaidAmount: Math.max(0, item.accruedPayable - item.paidAmount), reconciliationStatus: item.accruedPayable || item.paidAmount ? "待核对" : "无数据" }))
      .sort((a, b) => b.unpaidAmount - a.unpaidAmount);
    return { ok: true, freshness: freshness(), suppliers, totals: suppliers.reduce((sum, item) => ({ accruedPayable: sum.accruedPayable + item.accruedPayable, paidAmount: sum.paidAmount + item.paidAmount, unpaidAmount: sum.unpaidAmount + item.unpaidAmount }), { accruedPayable: 0, paidAmount: 0, unpaidAmount: 0 }) };
  }

  return { freshness, getContract, listContracts, listPayables, summary, syncStatus: () => ({ ok: true, ...syncService.status(), freshness: freshness() }) };
}
