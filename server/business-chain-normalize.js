import { BUSINESS_CHAIN_FORMS } from "./business-chain-config.js";

export function fieldValue(record, fieldId) {
  if (!record || !fieldId) return undefined;
  const field = record[fieldId];
  if (field && typeof field === "object" && Object.prototype.hasOwnProperty.call(field, "value")) return field.value;
  return field;
}

export function scalarText(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  if (Array.isArray(value)) return value.map((item) => scalarText(item)).filter(Boolean).join(",");
  if (typeof value === "object") {
    return scalarText(
      value.name ?? value.label ?? value.title ?? value.text ?? value.value ?? value.data_id ?? value.id,
      fallback,
    );
  }
  const normalized = String(value).trim();
  return normalized || fallback;
}

export function numericValue(value, fallback = 0) {
  const raw = scalarText(value).replace(/,/g, "").replace(/[￥¥]/g, "");
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function isoDate(value) {
  const raw = scalarText(value);
  if (!raw) return "";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toISOString();
}

export function recordId(record) {
  return scalarText(record?.data_id || record?._id || record?.id);
}

export function linkedRecordIds(value) {
  const ids = new Set();
  const visit = (item) => {
    if (!item) return;
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (typeof item !== "object") return;
    const candidate = item.data_id || item._id || item.id || item.recordId || item.record_id;
    if (candidate) ids.add(String(candidate));
    Object.entries(item).forEach(([key, nested]) => {
      if (!["name", "label", "title", "text"].includes(key)) visit(nested);
    });
  };
  visit(value);
  return [...ids];
}

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeInternal(customerName, explicitValue) {
  const explicit = scalarText(explicitValue).toLowerCase();
  if (/^(是|yes|true|1|内部)$/.test(explicit)) return { value: true, inferred: false };
  const normalized = scalarText(customerName).replace(/[\s（）()·._-]/g, "").toLowerCase();
  return { value: normalized.includes("同舟跨境供应链"), inferred: normalized.includes("同舟跨境供应链") };
}

function baseDocument(formKey, form, record, input = {}) {
  const sourceDataId = recordId(record);
  const occurredAt = input.occurredAt || isoDate(record.createTime || record.create_time);
  const updatedAt = isoDate(record.updateTime || record.update_time || record.updatedAt) || occurredAt;
  return {
    id: `${formKey}:${sourceDataId}`,
    formKey,
    sourceFormId: form.entryId,
    sourceDataId,
    documentType: form.type,
    documentTypeLabel: form.label,
    chainId: input.chainId || "",
    documentNo: scalarText(input.documentNo),
    contractNo: scalarText(input.contractNo),
    contractLineNo: scalarText(input.contractLineNo),
    upstreamNos: [...new Set((input.upstreamNos || []).map(scalarText).filter(Boolean))],
    linkedRecordIds: [...new Set(input.linkedRecordIds || [])],
    status: scalarText(input.status, "未配置"),
    customerId: scalarText(input.customerId),
    customerName: scalarText(input.customerName),
    supplierId: scalarText(input.supplierId),
    supplierName: scalarText(input.supplierName),
    currency: scalarText(input.currency, "CNY"),
    quantity: numericValue(input.quantity),
    amount: numericValue(input.amount),
    payableAmount: numericValue(input.payableAmount),
    paidAmount: numericValue(input.paidAmount),
    occurredAt,
    updatedAt,
    isInternal: Boolean(input.isInternal),
    internalInferred: Boolean(input.internalInferred),
    lines: input.lines || [],
    raw: record,
  };
}

function normalizeLine(parentId, line, fields, index, extras = {}) {
  const uuid = scalarText(fieldValue(line, fields.uuid));
  const sku = scalarText(fieldValue(line, fields.sku));
  return {
    id: `${parentId}:${uuid || index + 1}`,
    lineUuid: uuid,
    sku,
    name: scalarText(fieldValue(line, fields.name)),
    unit: scalarText(fieldValue(line, fields.unit)),
    quantity: numericValue(fieldValue(line, fields.quantity || fields.purchaseQty || fields.arrivedQty)),
    amount: numericValue(fieldValue(line, fields.amount)),
    referenceNo: scalarText(fieldValue(line, fields.referenceNo)),
    linkedRecordIds: linkedRecordIds(fieldValue(line, fields.link)),
    ...extras,
  };
}

const settlementFields = {
  purchaseInbound: {
    link: "_widget_1739611985719",
    referenceNo: "_widget_1739611985722",
    contractNo: "_widget_1744259727986",
    quantity: "_widget_1739686399750",
    amount: "_widget_1767181642808",
  },
  outsourcingInbound: {
    link: "_widget_1742294461371",
    referenceNo: "_widget_1742204200188",
    contractNo: "_widget_1744259727998",
    sku: "_widget_1745651515786",
    quantity: "_widget_1742204200193",
    amount: "_widget_1745222659579",
  },
  prepayment: {
    link: "_widget_1749011760276",
    referenceNo: "_widget_1744004698957",
    amount: "_widget_1744004698959",
  },
  prepaymentReference: {
    purchaseLink: "_widget_1744612259564",
    outsourcingLink: "_widget_1744691668381",
    purchaseNo: "_widget_1766904211706",
    outsourcingNo: "_widget_1766904211705",
    amount: "_widget_1744612696419",
  },
};

export function normalizeBusinessChainRecord(formKey, record) {
  const form = BUSINESS_CHAIN_FORMS[formKey];
  if (!form) throw new Error(`未知业务链路表单：${formKey}`);
  const f = form.fields;
  const sourceDataId = recordId(record);
  const id = `${formKey}:${sourceDataId}`;

  if (formKey === "openingDemands") {
    return baseDocument(formKey, form, record, {
      documentNo: fieldValue(record, f.demandNo),
      occurredAt: isoDate(fieldValue(record, f.submittedAt)),
      status: "已提报",
      lines: [{ id: `${id}:1`, lineUuid: "", sku: "", name: scalarText(fieldValue(record, f.productName)), unit: "", quantity: 0, amount: 0, referenceNo: "", linkedRecordIds: [] }],
    });
  }
  if (formKey === "quotes") {
    const contractNo = scalarText(fieldValue(record, f.contractNo));
    return baseDocument(formKey, form, record, {
      documentNo: fieldValue(record, f.quoteNo), contractNo,
      status: fieldValue(record, f.contractStatus), occurredAt: isoDate(fieldValue(record, f.quotedAt)),
      customerId: fieldValue(record, f.customerId), customerName: fieldValue(record, f.customerFullName) || fieldValue(record, f.customerName),
      quantity: fieldValue(record, f.quantity), amount: fieldValue(record, f.totalAmount),
      upstreamNos: [fieldValue(record, f.craftOrderNo)],
      lines: [{ id: `${id}:1`, lineUuid: "", sku: scalarText(fieldValue(record, f.tongzhouSku) || fieldValue(record, f.productSku)), name: scalarText(fieldValue(record, f.productName)), unit: "", quantity: numericValue(fieldValue(record, f.quantity)), amount: numericValue(fieldValue(record, f.totalAmount)), referenceNo: "", linkedRecordIds: [] }],
    });
  }
  if (formKey === "salesContracts") {
    const customerName = scalarText(fieldValue(record, f.customerFullName) || fieldValue(record, f.customerName));
    const internal = normalizeInternal(customerName, fieldValue(record, f.internalContract));
    const effectiveAt = isoDate(fieldValue(record, f.effectiveAt));
    const detailRows = rows(fieldValue(record, f.details));
    const lines = detailRows.map((line, index) => normalizeLine(id, line, form.detailFields, index, {
      contractLineNo: scalarText(fieldValue(line, form.detailFields.contractLineNo)),
      linkedRecordIds: linkedRecordIds(fieldValue(line, form.detailFields.quoteLink)),
    }));
    return baseDocument(formKey, form, record, {
      chainId: `CHN-${sourceDataId}`,
      documentNo: fieldValue(record, f.contractNo), contractNo: fieldValue(record, f.contractNo), status: fieldValue(record, f.status),
      occurredAt: effectiveAt || isoDate(fieldValue(record, f.signedAt)), customerId: fieldValue(record, f.customerId), customerName,
      currency: fieldValue(record, f.currency), quantity: fieldValue(record, f.totalQty), amount: fieldValue(record, f.totalAmount),
      isInternal: internal.value, internalInferred: internal.inferred,
      linkedRecordIds: [
        ...linkedRecordIds(fieldValue(record, f.customerLink)),
        ...lines.flatMap((line) => line.linkedRecordIds),
      ],
      lines,
    });
  }
  if (formKey === "craftOrders") {
    return baseDocument(formKey, form, record, {
      documentNo: fieldValue(record, f.craftOrderNo), contractLineNo: fieldValue(record, f.contractLineNo),
      status: "已建工艺", occurredAt: isoDate(fieldValue(record, f.submittedAt)), customerId: fieldValue(record, f.customerId), customerName: fieldValue(record, f.customerName),
      supplierName: fieldValue(record, f.factory), upstreamNos: [fieldValue(record, f.quoteNo)],
      linkedRecordIds: linkedRecordIds(fieldValue(record, f.quoteLink)),
      lines: [{ id: `${id}:1`, lineUuid: "", sku: scalarText(fieldValue(record, f.tongzhouSku) || fieldValue(record, f.productSku)), name: scalarText(fieldValue(record, f.productName)), unit: "", quantity: 0, amount: 0, referenceNo: scalarText(fieldValue(record, f.quoteNo)), linkedRecordIds: linkedRecordIds(fieldValue(record, f.quoteLink)) }],
    });
  }
  if (formKey === "outsourcingOrders") {
    return baseDocument(formKey, form, record, {
      documentNo: fieldValue(record, f.orderNo), contractNo: fieldValue(record, f.contractNo), contractLineNo: fieldValue(record, f.contractLineNo),
      status: fieldValue(record, f.status), occurredAt: isoDate(fieldValue(record, f.createdAt)), customerId: fieldValue(record, f.customerId), customerName: fieldValue(record, f.customerName),
      supplierId: fieldValue(record, f.factoryId), supplierName: fieldValue(record, f.factoryFullName) || fieldValue(record, f.supplier), quantity: fieldValue(record, f.plannedQty),
      upstreamNos: [fieldValue(record, f.craftOrderNo)], linkedRecordIds: linkedRecordIds(fieldValue(record, f.contractLink)),
      lines: [{ id: `${id}:1`, lineUuid: "", sku: scalarText(fieldValue(record, f.tongzhouSku) || fieldValue(record, f.productSku)), name: scalarText(fieldValue(record, f.productName)), unit: scalarText(fieldValue(record, f.unit)), quantity: numericValue(fieldValue(record, f.plannedQty)), amount: 0, referenceNo: scalarText(fieldValue(record, f.craftOrderNo)), linkedRecordIds: [] }],
    });
  }
  if (formKey === "purchaseOrders") {
    const lines = rows(fieldValue(record, f.details)).map((line, index) => normalizeLine(id, line, { ...form.detailFields, quantity: form.detailFields.purchaseQty }, index));
    return baseDocument(formKey, form, record, {
      documentNo: fieldValue(record, f.orderNo), contractNo: fieldValue(record, f.contractNo), status: fieldValue(record, f.status), occurredAt: isoDate(fieldValue(record, f.orderedAt)),
      supplierId: fieldValue(record, f.supplierId), supplierName: fieldValue(record, f.supplier), quantity: fieldValue(record, f.totalQty), amount: fieldValue(record, f.totalAmount),
      upstreamNos: [fieldValue(record, f.outsourcingOrderNo)], linkedRecordIds: [...linkedRecordIds(fieldValue(record, f.contractLink)), ...linkedRecordIds(fieldValue(record, f.outsourcingLink))], lines,
    });
  }
  if (formKey === "purchaseInboundOrders") {
    const lines = rows(fieldValue(record, f.details)).map((line, index) => normalizeLine(id, line, { ...form.detailFields, quantity: form.detailFields.arrivedQty }, index));
    return baseDocument(formKey, form, record, {
      documentNo: fieldValue(record, f.inboundNo), status: fieldValue(record, f.settlementStatus), occurredAt: isoDate(fieldValue(record, f.inboundAt)),
      supplierId: fieldValue(record, f.supplierId), supplierName: fieldValue(record, f.supplier), quantity: fieldValue(record, f.totalQty), amount: fieldValue(record, f.totalAmount), payableAmount: fieldValue(record, f.payableAmount),
      upstreamNos: [fieldValue(record, f.purchaseOrderNo), fieldValue(record, f.outsourcingOrderNo)], linkedRecordIds: [...linkedRecordIds(fieldValue(record, f.contractLink)), ...linkedRecordIds(fieldValue(record, f.purchaseLink)), ...linkedRecordIds(fieldValue(record, f.outsourcingLink))], lines,
    });
  }
  if (formKey === "outsourcingInboundOrders") {
    return baseDocument(formKey, form, record, {
      documentNo: fieldValue(record, f.inboundNo), contractNo: fieldValue(record, f.contractNo), contractLineNo: fieldValue(record, f.contractLineNo), status: fieldValue(record, f.settlementStatus) || fieldValue(record, f.status), occurredAt: isoDate(fieldValue(record, f.occurredAt)),
      customerId: fieldValue(record, f.customerId), customerName: fieldValue(record, f.customerName), quantity: fieldValue(record, f.inboundQty), payableAmount: fieldValue(record, f.payableAmount),
      upstreamNos: [fieldValue(record, f.outsourcingOrderNo)], linkedRecordIds: linkedRecordIds(fieldValue(record, f.outsourcingLink)),
      lines: [{ id: `${id}:1`, lineUuid: "", sku: scalarText(fieldValue(record, f.productSku)), name: scalarText(fieldValue(record, f.productName)), unit: "", quantity: numericValue(fieldValue(record, f.inboundQty)), amount: numericValue(fieldValue(record, f.payableAmount)), referenceNo: scalarText(fieldValue(record, f.outsourcingOrderNo)), linkedRecordIds: [] }],
    });
  }
  if (formKey === "salesShipments") {
    const lines = rows(fieldValue(record, f.details)).map((line, index) => normalizeLine(id, line, form.detailFields, index));
    return baseDocument(formKey, form, record, {
      documentNo: fieldValue(record, f.shipmentNo), contractNo: fieldValue(record, f.contractNo), status: fieldValue(record, f.status), occurredAt: isoDate(fieldValue(record, f.shippedAt) || fieldValue(record, f.requestedAt)),
      customerId: fieldValue(record, f.customerId), customerName: fieldValue(record, f.customerName), quantity: fieldValue(record, f.totalQty), amount: fieldValue(record, f.totalAmount),
      linkedRecordIds: linkedRecordIds(fieldValue(record, f.contractLink)), lines,
    });
  }
  if (formKey === "purchasePrepayments") {
    const refs = rows(fieldValue(record, f.references));
    const upstreamNos = refs.flatMap((line) => [fieldValue(line, settlementFields.prepaymentReference.purchaseNo), fieldValue(line, settlementFields.prepaymentReference.outsourcingNo)]);
    const linkedIds = refs.flatMap((line) => [...linkedRecordIds(fieldValue(line, settlementFields.prepaymentReference.purchaseLink)), ...linkedRecordIds(fieldValue(line, settlementFields.prepaymentReference.outsourcingLink))]);
    return baseDocument(formKey, form, record, {
      documentNo: fieldValue(record, f.prepaymentNo), status: fieldValue(record, f.confirmed), occurredAt: isoDate(fieldValue(record, f.paidAt) || fieldValue(record, f.occurredAt)),
      supplierId: fieldValue(record, f.supplierId), supplierName: fieldValue(record, f.supplier), amount: fieldValue(record, f.requestedAmount), paidAmount: fieldValue(record, f.paidAmount), upstreamNos, linkedRecordIds: linkedIds,
    });
  }
  if (formKey === "purchaseSettlements") {
    const groups = [
      ["purchase-inbound", f.purchaseInbounds, settlementFields.purchaseInbound],
      ["outsourcing-inbound", f.outsourcingInbounds, settlementFields.outsourcingInbound],
      ["prepayment", f.prepayments, settlementFields.prepayment],
    ];
    const lines = groups.flatMap(([groupKey, groupField, fields]) => rows(fieldValue(record, groupField)).map((line, index) => {
      const normalized = normalizeLine(id, line, fields, index, { contractNo: scalarText(fieldValue(line, fields.contractNo)) });
      return { ...normalized, id: `${id}:${groupKey}:${normalized.lineUuid || index + 1}` };
    }));
    return baseDocument(formKey, form, record, {
      documentNo: fieldValue(record, f.settlementNo), status: fieldValue(record, f.status), occurredAt: isoDate(fieldValue(record, f.occurredAt)),
      supplierId: fieldValue(record, f.supplierId), supplierName: fieldValue(record, f.supplier), payableAmount: fieldValue(record, f.payableAmount), paidAmount: fieldValue(record, f.paidAmount),
      upstreamNos: lines.map((line) => line.referenceNo), linkedRecordIds: lines.flatMap((line) => line.linkedRecordIds), lines,
    });
  }
  return baseDocument(formKey, form, record);
}

export function normalizeBusinessChainRecords(formKey, records = []) {
  return records.map((record) => normalizeBusinessChainRecord(formKey, record)).filter((document) => document.sourceDataId);
}
