function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function summarizeOrderAmounts(orders = []) {
  const totals = new Map();
  let excludedLines = 0;

  for (const order of orders) {
    const amount = Number(order?.salesAmount);
    const currency = text(order?.currency).toUpperCase();
    if (!Number.isFinite(amount) || order?.salesAmountValid === false || !currency) {
      excludedLines += 1;
      continue;
    }
    totals.set(currency, number(totals.get(currency)) + amount);
  }

  const amountsByCurrency = Array.from(totals, ([currency, amount]) => ({
    currency,
    amount: Math.round(amount * 100) / 100,
  })).sort((left, right) => left.currency.localeCompare(right.currency));

  return {
    amountsByCurrency,
    currencyCount: amountsByCurrency.length,
    excludedLines,
    displayMode: amountsByCurrency.length === 0 ? "unavailable" : amountsByCurrency.length === 1 ? "single" : "multiple",
    displayCurrency: amountsByCurrency.length === 1 ? amountsByCurrency[0].currency : "",
    displayValue: amountsByCurrency.length === 1 ? amountsByCurrency[0].amount : null,
  };
}

function resultWasTruncated(result = {}) {
  const apiTotal = number(result?.orderApiTotal);
  const readRows = number(result?.orderApiReadRows || result?.orderApiReadSkuRows);
  return Boolean(result?.orderApiReachedPageLimit) || (apiTotal > 0 && readRows > 0 && readRows < apiTotal);
}

function streamState(result, { running = false, hasCredentials = true } = {}) {
  if (!hasCredentials) return { code: "unconfigured", label: "未配置", complete: false };
  if (running || result?.backgroundRunning) return { code: "syncing", label: "同步中", complete: false };
  if (resultWasTruncated(result)) return { code: "partial", label: "数据不完整", complete: false };
  if (result && result.ok === false && !result.skipped) return { code: "failed", label: "失败", complete: false };
  if (result?.ok) return { code: "complete", label: "完整", complete: true };
  return { code: "waiting", label: "待同步", complete: false };
}

export function buildWarehouseDataState({ connection = {}, inventoryResult = null, orderResult = null, hasCredentials = false } = {}) {
  const taskRunning = Boolean(orderResult?.backgroundRunning);
  const inventory = streamState(inventoryResult, { hasCredentials });
  const orders = streamState(orderResult, { hasCredentials, running: taskRunning });
  const codes = [inventory.code, orders.code];
  const overallCode = codes.includes("unconfigured")
    ? "unconfigured"
    : codes.includes("failed")
      ? "failed"
      : codes.includes("partial")
        ? "partial"
        : codes.includes("syncing")
          ? "syncing"
          : codes.every((code) => code === "complete")
            ? "complete"
            : "waiting";
  const labels = {
    unconfigured: "待配置",
    failed: "同步失败",
    partial: "数据不完整",
    syncing: "同步中",
    complete: "数据完整",
    waiting: "待同步",
  };

  return {
    warehouseId: text(connection.id),
    warehouseName: text(connection.name) || text(connection.id),
    connection: hasCredentials ? "connected" : "unconfigured",
    task: taskRunning ? "running" : orderResult?.ok ? "completed" : orderResult?.ok === false ? "failed" : "waiting",
    inventory,
    orders,
    completeness: overallCode,
    completenessLabel: labels[overallCode],
    complete: overallCode === "complete",
    truncated: resultWasTruncated(orderResult),
  };
}

export function summarizeDataHealth(warehouses = []) {
  const incomplete = warehouses.filter((warehouse) => !warehouse.complete);
  const failed = warehouses.filter((warehouse) => ["failed", "unconfigured"].includes(warehouse.completeness));
  const partial = warehouses.filter((warehouse) => warehouse.completeness === "partial");
  const syncing = warehouses.filter((warehouse) => warehouse.completeness === "syncing");
  const code = failed.length ? "failed" : partial.length ? "partial" : syncing.length ? "syncing" : incomplete.length ? "waiting" : "complete";
  const labels = {
    failed: "存在阻断项",
    partial: "部分数据不完整",
    syncing: "数据更新中",
    waiting: "存在待同步数据",
    complete: "数据完整",
  };
  return {
    code,
    label: labels[code],
    complete: code === "complete",
    warehouseCount: warehouses.length,
    completeCount: warehouses.length - incomplete.length,
    incompleteCount: incomplete.length,
    failedCount: failed.length,
    partialCount: partial.length,
    syncingCount: syncing.length,
  };
}
