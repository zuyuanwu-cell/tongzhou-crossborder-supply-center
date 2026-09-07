import { JIANYUN_FORMS } from "./field-mapping.js";
import { supplierAlias, supplierReference, suppliersMatch } from "./supplier-privacy.js";

function valueOf(record, fieldId) {
  if (!fieldId) return undefined;
  const field = record?.[fieldId];
  if (field && typeof field === "object" && "value" in field) return field.value;
  return field;
}

function text(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean).join(",");
  if (typeof value === "object") {
    return text(value.name || value.label || value.title || value.value || value.data_id || value.id, fallback);
  }
  return String(value).trim() || fallback;
}

function number(value, fallback = 0) {
  const normalized = typeof value === "string" ? value.replace(/,/g, "").trim() : value;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function rowsOf(record, fieldId) {
  const value = valueOf(record, fieldId);
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.value)) return value.value;
  return [];
}

function normalizeDate(value) {
  const raw = text(value);
  if (!raw) return "";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function latestDate(values) {
  return values.filter(Boolean).sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] || "";
}

function earliestDate(values) {
  return values.filter(Boolean).sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0] || "";
}

function addDays(value, days) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function elapsedDays(startValue, endValue) {
  const start = new Date(startValue).getTime();
  const end = new Date(endValue).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 86400000));
}

function isCancelled(status) {
  return /作废|取消|驳回|终止/.test(text(status));
}

function materialKind(category, name) {
  const haystack = `${text(category)} ${text(name)}`.replace(/\s+/g, "");
  if (/内包辅材|外包辅材|包材|包装材料/.test(haystack)) return "packaging";
  if (/内料|料体|主料|内容物/.test(haystack)) return "inner";
  return "other";
}

function materialStatus(requiredQty, arrivedQty) {
  if (requiredQty > 0 && arrivedQty >= requiredQty) return "ready";
  if (arrivedQty > 0) return "partial";
  return "pending";
}

function materialStatusLabel(status) {
  if (status === "ready") return "已到齐";
  if (status === "partial") return "部分到货";
  return "待到货";
}

function packagingLeadTime(category, name) {
  const haystack = `${text(category)} ${text(name)}`.replace(/\s+/g, "");
  if (/精装|套盒|礼盒|天地盖|书型盒|抽屉盒|组合盒/.test(haystack)) {
    return { code: "premium_box", label: "精装/套盒", warningDays: 25, maxDays: 25 };
  }
  if (/单只盒|单个盒|单盒|彩盒|小盒|纸盒|折叠盒/.test(haystack)) {
    return { code: "single_box", label: "单只盒", warningDays: 7, maxDays: 10 };
  }
  return { code: "standard", label: "常规包材", warningDays: 15, maxDays: 20 };
}

function leadTimeState({ status, orderedAt, expectedDeliveryAt, expectedDeliverySource, durationDays, leadTime, now }) {
  if (status === "ready") return "ready";
  if (!orderedAt) return "review";
  const nowTime = new Date(now).getTime();
  const expectedTime = new Date(expectedDeliveryAt).getTime();
  if (expectedDeliverySource === "planned" && Number.isFinite(expectedTime)) {
    if (nowTime > expectedTime) return "overdue";
    if (nowTime >= expectedTime - 3 * 86400000) return "warning";
    return "normal";
  }
  if (durationDays > leadTime.maxDays) return "overdue";
  if (durationDays >= leadTime.warningDays) return "warning";
  return "normal";
}

function leadTimeStatusLabel(status) {
  if (status === "ready") return "已到齐";
  if (status === "overdue") return "采购逾期";
  if (status === "warning") return "临近周期";
  if (status === "review") return "待补日期";
  return "周期正常";
}

function emptyOrderProgress(orderNo, source, purchaseOrderCount = 0) {
  return {
    orderNo,
    status: "review",
    statusLabel: "数据待核查",
    materialReady: false,
    totalMaterials: 0,
    readyMaterials: 0,
    pendingMaterials: 0,
    progressPercent: 0,
    packaging: { total: 0, ready: 0, pending: 0 },
    exceptionalInner: { total: 0, ready: 0, pending: 0 },
    purchaseOrderCount,
    purchaseOrders: [],
    inboundDocumentCount: 0,
    lastPurchaseAt: "",
    lastInboundAt: "",
    readyAt: "",
    message: "未识别到包材明细，请核查生产单与采购单关联。",
    materials: [],
    source,
  };
}

function toCountSummary(materials, kind) {
  const selected = materials.filter((item) => item.kind === kind);
  const ready = selected.filter((item) => item.status === "ready").length;
  return { total: selected.length, ready, pending: selected.length - ready };
}

export function buildProductionMaterialProgress(outsourcingRecords = [], purchaseRecords = [], inboundRecords = [], source = "jiandaoyun", now = new Date()) {
  const outsourcingConfig = JIANYUN_FORMS.outsourcingOrders;
  const purchaseConfig = JIANYUN_FORMS.purchaseOrders;
  const inboundConfig = JIANYUN_FORMS.purchaseInboundOrders;
  const outsourcingFields = outsourcingConfig.fields;
  const purchaseFields = purchaseConfig.fields;
  const purchaseLineFields = purchaseConfig.detailFields;
  const inboundFields = inboundConfig.fields;
  const inboundLineFields = inboundConfig.detailFields;

  const inboundByPurchaseAndSku = new Map();
  for (const inbound of inboundRecords) {
    const purchaseOrderNo = text(valueOf(inbound, inboundFields.purchaseOrderNo));
    if (!purchaseOrderNo) continue;
    const inboundAt = normalizeDate(valueOf(inbound, inboundFields.inboundAt));
    const inboundId = text(inbound.data_id || inbound._id || inbound.id || valueOf(inbound, inboundFields.inboundNo));
    for (const line of rowsOf(inbound, inboundFields.details)) {
      const sku = text(valueOf(line, inboundLineFields.sku));
      if (!sku) continue;
      const key = `${purchaseOrderNo}\u0000${sku}`;
      const current = inboundByPurchaseAndSku.get(key) || { arrivedQty: 0, inboundDates: [], inboundIds: new Set() };
      current.arrivedQty += Math.max(0, number(valueOf(line, inboundLineFields.arrivedQty)));
      if (inboundAt) current.inboundDates.push(inboundAt);
      if (inboundId) current.inboundIds.add(inboundId);
      inboundByPurchaseAndSku.set(key, current);
    }
  }

  const purchaseByOrderNo = new Map();
  for (const purchase of purchaseRecords) {
    if (isCancelled(valueOf(purchase, purchaseFields.status))) continue;
    const outsourcingOrderNo = text(valueOf(purchase, purchaseFields.outsourcingOrderNo));
    const purchaseOrderNo = text(valueOf(purchase, purchaseFields.orderNo));
    if (!outsourcingOrderNo || !purchaseOrderNo) continue;
    const list = purchaseByOrderNo.get(outsourcingOrderNo) || [];
    list.push({ purchase, purchaseOrderNo });
    purchaseByOrderNo.set(outsourcingOrderNo, list);
  }

  const byOrderNo = {};
  for (const outsourcing of outsourcingRecords) {
    const orderNo = text(valueOf(outsourcing, outsourcingFields.orderNo));
    if (!orderNo) continue;

    const purchases = purchaseByOrderNo.get(orderNo) || [];
    const factoryId = valueOf(outsourcing, outsourcingFields.factoryId);
    const factoryName = valueOf(outsourcing, outsourcingFields.factoryFullName) || valueOf(outsourcing, outsourcingFields.supplier);
    const materialMap = new Map();
    const purchaseDates = [];
    const inboundDocumentIds = new Set();
    const plannedArrivalBySku = new Map();
    for (const line of rowsOf(outsourcing, outsourcingFields.details)) {
      const sku = text(valueOf(line, outsourcingConfig.detailFields.sku));
      const plannedArrivalAt = normalizeDate(valueOf(line, outsourcingConfig.detailFields.plannedArrivalAt));
      if (!sku || !plannedArrivalAt) continue;
      plannedArrivalBySku.set(sku, earliestDate([plannedArrivalBySku.get(sku), plannedArrivalAt]));
    }

    for (const { purchase, purchaseOrderNo } of purchases) {
      const supplierId = valueOf(purchase, purchaseFields.supplierId);
      const supplierName = valueOf(purchase, purchaseFields.supplier);
      const vendorReference = supplierReference(supplierId, supplierName);
      const alias = supplierAlias(supplierId, supplierName);
      const orderedAt = normalizeDate(valueOf(purchase, purchaseFields.orderedAt));
      if (orderedAt) purchaseDates.push(orderedAt);

      for (const line of rowsOf(purchase, purchaseFields.details)) {
        const sku = text(valueOf(line, purchaseLineFields.sku));
        const category = text(valueOf(line, purchaseLineFields.category));
        const name = text(valueOf(line, purchaseLineFields.name), sku || "未命名物料");
        const kind = materialKind(category, name);
        const isExceptionalInner = kind === "inner" && !suppliersMatch(supplierId, supplierName, factoryId, factoryName);
        if (kind !== "packaging" && !isExceptionalInner) continue;

        const requiredQty = Math.max(0, number(valueOf(line, purchaseLineFields.purchaseQty), number(valueOf(line, purchaseLineFields.requiredQty))));
        if (!sku || requiredQty <= 0) continue;

        const inbound = inboundByPurchaseAndSku.get(`${purchaseOrderNo}\u0000${sku}`) || { arrivedQty: 0, inboundDates: [], inboundIds: new Set() };
        for (const inboundId of inbound.inboundIds) inboundDocumentIds.add(inboundId);
        const aggregateKey = `${purchaseOrderNo}\u0000${sku}\u0000${category}\u0000${vendorReference}\u0000${kind}`;
        const current = materialMap.get(aggregateKey) || {
          id: supplierReference(aggregateKey, ""),
          purchaseOrderNo,
          purchaseOrderedAt: orderedAt,
          sku,
          name,
          category: category || (kind === "packaging" ? "包材" : "内料"),
          kind,
          unit: text(valueOf(line, purchaseLineFields.unit)),
          requiredQty: 0,
          arrivedQty: 0,
          latestInboundAt: "",
          supplierAlias: alias,
          inboundDates: [],
        };
        current.requiredQty += requiredQty;
        current.arrivedQty += Math.max(0, inbound.arrivedQty);
        current.inboundDates.push(...inbound.inboundDates);
        current.latestInboundAt = latestDate(current.inboundDates);
        materialMap.set(aggregateKey, current);
      }
    }

    const materials = [...materialMap.values()]
      .map(({ inboundDates, ...item }) => {
        const status = materialStatus(item.requiredQty, item.arrivedQty);
        const leadTime = packagingLeadTime(item.category, item.name);
        const plannedExpectedAt = plannedArrivalBySku.get(item.sku) || "";
        const expectedDeliveryAt = plannedExpectedAt || addDays(item.purchaseOrderedAt, leadTime.maxDays);
        const expectedDeliverySource = plannedExpectedAt ? "planned" : item.purchaseOrderedAt ? "standard" : "missing";
        const purchaseEndedAt = status === "ready" && item.latestInboundAt ? item.latestInboundAt : now;
        const purchaseDurationDays = item.purchaseOrderedAt ? elapsedDays(item.purchaseOrderedAt, purchaseEndedAt) : 0;
        const leadTimeStatus = leadTimeState({ status, orderedAt: item.purchaseOrderedAt, expectedDeliveryAt, expectedDeliverySource, durationDays: purchaseDurationDays, leadTime, now });
        return {
          ...item,
          status,
          statusLabel: materialStatusLabel(status),
          leadTime,
          expectedDeliveryAt,
          expectedDeliverySource,
          purchaseDurationDays,
          leadTimeStatus,
          leadTimeStatusLabel: leadTimeStatusLabel(leadTimeStatus),
        };
      })
      .sort((left, right) => left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name, "zh-CN"));

    const purchaseOrders = [...new Set(materials.map((item) => item.purchaseOrderNo).filter(Boolean))]
      .map((purchaseOrderNo) => {
        const orderMaterials = materials.filter((item) => item.purchaseOrderNo === purchaseOrderNo);
        const orderedAt = earliestDate(orderMaterials.map((item) => item.purchaseOrderedAt));
        const expectedDeliveryAt = latestDate(orderMaterials.map((item) => item.expectedDeliveryAt));
        const expectedMaterial = orderMaterials.find((item) => item.expectedDeliveryAt === expectedDeliveryAt);
        const ready = orderMaterials.length > 0 && orderMaterials.every((item) => item.status === "ready");
        const status = ready
          ? "ready"
          : orderMaterials.some((item) => item.leadTimeStatus === "overdue")
            ? "overdue"
            : orderMaterials.some((item) => item.leadTimeStatus === "warning")
              ? "warning"
              : orderedAt
                ? "normal"
                : "review";
        return {
          orderNo: purchaseOrderNo,
          orderedAt,
          expectedDeliveryAt,
          expectedDeliverySource: expectedMaterial?.expectedDeliverySource || "missing",
          durationDays: Math.max(0, ...orderMaterials.map((item) => item.purchaseDurationDays)),
          readyAt: ready ? latestDate(orderMaterials.map((item) => item.latestInboundAt)) : "",
          status,
          statusLabel: leadTimeStatusLabel(status),
          materialCount: orderMaterials.length,
          readyMaterials: orderMaterials.filter((item) => item.status === "ready").length,
          supplierAliases: [...new Set(orderMaterials.map((item) => item.supplierAlias).filter(Boolean))],
          leadTimeLabels: [...new Set(orderMaterials.map((item) => item.leadTime.label))],
        };
      })
      .sort((left, right) => new Date(left.orderedAt || 0).getTime() - new Date(right.orderedAt || 0).getTime());

    const packaging = toCountSummary(materials, "packaging");
    const exceptionalInner = toCountSummary(materials, "inner");
    if (packaging.total === 0) {
      const review = emptyOrderProgress(orderNo, source, purchases.length);
      review.lastPurchaseAt = latestDate(purchaseDates);
      review.purchaseOrderCount = purchaseOrders.length;
      review.inboundDocumentCount = inboundDocumentIds.size;
      review.lastInboundAt = latestDate(materials.map((item) => item.latestInboundAt));
      review.purchaseOrders = purchaseOrders;
      review.materials = materials;
      byOrderNo[orderNo] = review;
      continue;
    }

    const readyMaterials = materials.filter((item) => item.status === "ready").length;
    const totalMaterials = materials.length;
    const arrivedTotal = materials.reduce((sum, item) => sum + Math.min(item.arrivedQty, item.requiredQty), 0);
    const requiredTotal = materials.reduce((sum, item) => sum + item.requiredQty, 0);
    const hasAnyArrival = materials.some((item) => item.arrivedQty > 0);
    const status = readyMaterials === totalMaterials ? "ready" : hasAnyArrival ? "partial" : "pending";
    const statusLabel = status === "ready" ? "物料到齐" : status === "partial" ? "部分到齐" : "待到货";
    const lastInboundAt = latestDate(materials.map((item) => item.latestInboundAt));
    const readyAt = status === "ready" ? latestDate(materials.map((item) => item.latestInboundAt)) : "";

    byOrderNo[orderNo] = {
      orderNo,
      status,
      statusLabel,
      materialReady: status === "ready",
      totalMaterials,
      readyMaterials,
      pendingMaterials: totalMaterials - readyMaterials,
      progressPercent: requiredTotal > 0 ? Math.round((arrivedTotal / requiredTotal) * 100) : 0,
      packaging,
      exceptionalInner,
      purchaseOrderCount: purchaseOrders.length,
      purchaseOrders,
      inboundDocumentCount: inboundDocumentIds.size,
      lastPurchaseAt: latestDate(purchaseDates),
      lastInboundAt,
      readyAt,
      message: status === "ready"
        ? "包材及需外采内料均已到齐。"
        : `${totalMaterials - readyMaterials} 项物料仍需跟进。`,
      materials,
      source,
    };
  }

  const values = Object.values(byOrderNo);
  return {
    ok: true,
    source,
    syncedAt: new Date().toISOString(),
    counts: {
      orders: values.length,
      ready: values.filter((item) => item.status === "ready").length,
      partial: values.filter((item) => item.status === "partial").length,
      pending: values.filter((item) => item.status === "pending").length,
      review: values.filter((item) => item.status === "review").length,
    },
    byOrderNo,
  };
}

export function emptyProductionMaterialPayload(source = "empty") {
  return {
    ok: true,
    source,
    syncedAt: new Date().toISOString(),
    counts: { orders: 0, ready: 0, partial: 0, pending: 0, review: 0 },
    byOrderNo: {},
  };
}
