import { createHash } from "node:crypto";

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || String(fallback ?? "").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

export function exceptionFingerprint({ ruleCode, warehouseId = "", project = "", resourceId = "", sku = "" }) {
  const identity = [text(ruleCode), text(warehouseId) || text(project) || "global", text(resourceId) || text(sku).toUpperCase()].join("|");
  return createHash("sha256").update(identity).digest("hex");
}

export function exceptionEvidenceHash(evidence = []) {
  return createHash("sha256").update(canonical(evidence)).digest("hex");
}

function observation(input) {
  const item = {
    ruleCode: text(input.ruleCode),
    resourceType: text(input.resourceType),
    resourceId: text(input.resourceId),
    warehouseId: text(input.warehouseId),
    project: text(input.project),
    country: text(input.country),
    sku: text(input.sku).toUpperCase(),
    title: text(input.title),
    summary: text(input.summary),
    severity: text(input.severity) || "medium",
    evidence: Array.isArray(input.evidence) ? input.evidence : [],
    href: text(input.href),
    sourceUpdatedAt: iso(input.sourceUpdatedAt),
  };
  item.fingerprint = exceptionFingerprint(item);
  item.evidenceHash = exceptionEvidenceHash(item.evidence);
  return item;
}

function daysLate(date, nowMs) {
  const parsed = Date.parse(text(date));
  return Number.isFinite(parsed) ? Math.max(0, Math.floor((nowMs - parsed) / 86_400_000)) : 0;
}

function syncObservations(source = {}, nowMs, staleAfterMs) {
  const results = Array.isArray(source.results) ? source.results : [];
  const warehouses = Array.isArray(source.warehouses) ? source.warehouses : [];
  const output = [];
  for (const result of results) {
    if (result.ok !== false || result.skipped) continue;
    const warehouseId = text(result.warehouseId || result.id);
    const warehouse = warehouses.find((item) => text(item.id || item.warehouseId) === warehouseId);
    output.push(observation({
      ruleCode: "warehouse_sync_failed",
      resourceType: "warehouse",
      resourceId: warehouseId || text(result.warehouseName),
      warehouseId,
      country: text(result.country || warehouse?.country),
      title: `${text(result.warehouseName, warehouseId) || "仓库"}同步失败`,
      summary: text(result.message) || "仓库同步未成功，请检查连接配置和上游服务。",
      severity: "critical",
      evidence: [{ type: "warehouse_sync", id: warehouseId, label: "同步错误", value: text(result.message) || "failed", updatedAt: iso(result.updatedAt || source.syncedAt) }],
      href: "#inventory",
      sourceUpdatedAt: result.updatedAt || source.syncedAt,
    }));
  }
  const syncedAt = Date.parse(text(source.syncedAt));
  if (Number.isFinite(syncedAt) && nowMs - syncedAt > staleAfterMs) {
    for (const warehouse of warehouses.length ? warehouses : [{ id: "all", name: "全部仓库" }]) {
      const warehouseId = text(warehouse.id || warehouse.warehouseId);
      output.push(observation({
        ruleCode: "warehouse_sync_stale",
        resourceType: "warehouse",
        resourceId: warehouseId || "all",
        warehouseId: warehouseId === "all" ? "" : warehouseId,
        country: text(warehouse.country),
        title: `${text(warehouse.name || warehouse.warehouseName) || "仓库"}数据已过期`,
        summary: `最近一次成功同步时间为 ${new Date(syncedAt).toISOString()}。`,
        severity: nowMs - syncedAt > staleAfterMs * 3 ? "critical" : "high",
        evidence: [{ type: "warehouse_sync", id: warehouseId || "all", label: "同步时间", value: new Date(syncedAt).toISOString(), updatedAt: new Date(syncedAt).toISOString() }],
        href: "#inventory",
        sourceUpdatedAt: new Date(syncedAt).toISOString(),
      }));
    }
  }
  return output;
}

function inventoryObservations(source = {}) {
  return (Array.isArray(source.items) ? source.items : [])
    .filter((item) => ["缺货", "补货预警", "stockout", "replenish"].includes(text(item.status).toLowerCase()) || ["缺货", "补货预警"].includes(text(item.status)))
    .map((item) => {
      const stockout = ["缺货", "stockout"].includes(text(item.status).toLowerCase()) || text(item.status) === "缺货";
      const sku = text(item.sku || item.countrySku || item.id).toUpperCase();
      const warehouseId = text(item.warehouseId || item.warehouseBreakdown?.[0]?.warehouseId);
      return observation({
        ruleCode: stockout ? "inventory_stockout" : "inventory_replenish_warning",
        resourceType: "inventory_sku",
        resourceId: text(item.id) || sku,
        warehouseId,
        project: text(item.country || item.project),
        country: text(item.country),
        sku,
        title: `${sku || "SKU"}${stockout ? "缺货" : "触发补货预警"}`,
        summary: `可用 ${number(item.availableQty)}，在途 ${number(item.inTransitQty)}，建议补货 ${number(item.replenishQty)}。`,
        severity: stockout ? "critical" : "high",
        evidence: [{
          type: "inventory_risk",
          id: text(item.id) || sku,
          label: text(item.status),
          value: { availableQty: number(item.availableQty), inTransitQty: number(item.inTransitQty), replenishQty: number(item.replenishQty), daysCover: item.daysCover ?? null },
          updatedAt: iso(source.updatedAt || source.generatedAt),
        }],
        href: "#movement",
        sourceUpdatedAt: source.updatedAt || source.generatedAt,
      });
    });
}

function stockupObservations(source = {}, nowMs) {
  const terminal = new Set(["completed", "cancelled", "closed", "received", "voided", "done"]);
  const output = [];
  for (const task of Array.isArray(source.tasks) ? source.tasks : []) {
    if (terminal.has(text(task.status).toLowerCase())) continue;
    const dueAt = task.expectedCompletedAt || task.expectedOrderAt || task.expectedArrivalAt;
    const late = daysLate(dueAt, nowMs);
    if (!dueAt || late <= 0) continue;
    const sku = text(task.sku).toUpperCase();
    output.push(observation({
      ruleCode: "stockup_task_overdue",
      resourceType: "stockup_task",
      resourceId: text(task.id || task.taskNo),
      warehouseId: text(task.warehouseId || task.destinationWarehouseId),
      project: text(task.project),
      country: text(task.country || task.destinationCountry),
      sku,
      title: `${text(task.taskNo || task.id) || "备货任务"}已逾期`,
      summary: `预计日期 ${iso(dueAt) || dueAt}，当前逾期 ${late} 天，状态为 ${text(task.status) || "未知"}。`,
      severity: late >= 3 ? "critical" : "high",
      evidence: [{ type: "stockup_task", id: text(task.id), label: "预计日期", value: dueAt, updatedAt: iso(task.updatedAt) }],
      href: "#stockup-execution",
      sourceUpdatedAt: task.updatedAt,
    }));
  }
  for (const request of Array.isArray(source.requests) ? source.requests : []) {
    if (terminal.has(text(request.status).toLowerCase())) continue;
    const dueAt = request.expectedArrivalAt;
    const late = daysLate(dueAt, nowMs);
    if (!dueAt || late <= 0) continue;
    output.push(observation({
      ruleCode: "stockup_request_overdue",
      resourceType: "stockup_request",
      resourceId: text(request.id || request.requestNo),
      warehouseId: text(request.destinationWarehouseId),
      project: text(request.project),
      country: text(request.country || request.destinationCountry),
      title: `${text(request.requestNo || request.id) || "备货需求"}预计到仓逾期`,
      summary: `预计到仓 ${iso(dueAt) || dueAt}，已逾期 ${late} 天。`,
      severity: late >= 3 ? "critical" : "high",
      evidence: [{ type: "stockup_request", id: text(request.id), label: "预计到仓", value: dueAt, updatedAt: iso(request.updatedAt) }],
      href: "#stockup",
      sourceUpdatedAt: request.updatedAt,
    }));
  }
  return output;
}

function productionObservations(source = {}, nowMs) {
  const output = [];
  for (const timeline of Array.isArray(source.timelines) ? source.timelines : []) {
    const completed = (timeline.events || []).some((event) => event.type === "completed" && iso(event.occurredAt));
    const dueAt = timeline.expectedCompletedAt;
    const late = daysLate(dueAt, nowMs);
    if (!completed && dueAt && late > 0) {
      output.push(observation({
        ruleCode: "production_overdue",
        resourceType: "production_order",
        resourceId: text(timeline.orderRecordId || timeline.id),
        project: text(timeline.project),
        country: text(timeline.country || timeline.destinationCountry),
        sku: text(timeline.sku),
        title: `${text(timeline.orderNo || timeline.orderRecordId) || "生产单"}已逾期`,
        summary: `预计完成 ${iso(dueAt) || dueAt}，已逾期 ${late} 天。`,
        severity: late >= 3 ? "critical" : "high",
        evidence: [{ type: "production_timeline", id: text(timeline.orderRecordId), label: "预计完成", value: dueAt, updatedAt: iso(timeline.updatedAt) }],
        href: "#production",
        sourceUpdatedAt: timeline.updatedAt,
      }));
    }
    const hoursUntilDue = dueAt ? (Date.parse(dueAt) - nowMs) / 3_600_000 : Number.POSITIVE_INFINITY;
    if (!completed && hoursUntilDue >= 0 && hoursUntilDue <= 72 && (timeline.materialReady === false || number(timeline.missingMaterialQty) > 0)) {
      output.push(observation({
        ruleCode: "production_material_shortage",
        resourceType: "production_order",
        resourceId: text(timeline.orderRecordId || timeline.id),
        project: text(timeline.project),
        country: text(timeline.country || timeline.destinationCountry),
        sku: text(timeline.sku),
        title: `${text(timeline.orderNo || timeline.orderRecordId) || "生产单"}临近交期但物料未齐`,
        summary: `距离预计完成约 ${Math.ceil(hoursUntilDue)} 小时，缺料数量 ${number(timeline.missingMaterialQty)}。`,
        severity: hoursUntilDue <= 24 ? "critical" : "high",
        evidence: [{ type: "production_material", id: text(timeline.orderRecordId), label: "缺料", value: number(timeline.missingMaterialQty), updatedAt: iso(timeline.updatedAt) }],
        href: "#production",
        sourceUpdatedAt: timeline.updatedAt,
      }));
    }
  }
  return output;
}

export function buildExceptionObservations({
  warehouseSync = {},
  inventoryRisk = {},
  stockup = {},
  production = {},
  now = () => new Date(),
  staleAfterMs = 2 * 60 * 60 * 1000,
} = {}) {
  const current = now();
  const nowMs = (current instanceof Date ? current : new Date(current)).getTime();
  const sourceCompleteness = {
    warehouseSync: warehouseSync.complete !== false,
    inventoryRisk: inventoryRisk.complete !== false,
    stockup: stockup.complete !== false,
    production: production.complete !== false,
  };
  const observations = [
    ...syncObservations(warehouseSync, nowMs, staleAfterMs),
    ...inventoryObservations(inventoryRisk),
    ...stockupObservations(stockup, nowMs),
    ...productionObservations(production, nowMs),
  ];
  return {
    observations,
    complete: Object.values(sourceCompleteness).every(Boolean),
    sources: sourceCompleteness,
  };
}
