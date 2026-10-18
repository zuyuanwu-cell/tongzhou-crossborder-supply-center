const COMPLETENESS = new Set(["complete", "partial", "unavailable"]);
const SOURCES = new Set(["live", "snapshot", "cache", "derived"]);
const COVERAGE_UNITS = new Set(["warehouse", "sku", "order"]);

function iso(value, fallback) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

export function createDataContext(input = {}) {
  const now = new Date().toISOString();
  const generatedAt = iso(input.generatedAt, now);
  const total = Math.max(0, Number(input.coverage?.total) || 0);
  const coverage = input.coverage && Number.isFinite(Number(input.coverage.total))
    ? {
      completed: Math.min(total, Math.max(0, Number(input.coverage.completed) || 0)),
      total,
      unit: COVERAGE_UNITS.has(input.coverage.unit) ? input.coverage.unit : "warehouse",
    }
    : undefined;
  return {
    generatedAt,
    effectiveAt: iso(input.effectiveAt, generatedAt),
    timezone: String(input.timezone || "Asia/Shanghai"),
    source: SOURCES.has(input.source) ? input.source : "derived",
    scopeKey: String(input.scopeKey || "current_user"),
    scopeLabel: String(input.scopeLabel || "当前账号可见范围"),
    filters: Object.fromEntries(Object.entries(input.filters || {}).map(([key, value]) => [key, String(value ?? "")])),
    completeness: COMPLETENESS.has(input.completeness) ? input.completeness : "complete",
    ...(coverage ? { coverage } : {}),
    isEstimate: Boolean(input.isEstimate),
    usingPreviousSuccess: Boolean(input.usingPreviousSuccess),
  };
}

export function withDataContext(payload, input = {}) {
  return { ...payload, dataContext: createDataContext(input) };
}
