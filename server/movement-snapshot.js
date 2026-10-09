function numberOrZero(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function statusFor({ availableQty, sales7, sales30, sales90, dailyWeighted, daysCover, leadDays }) {
  if (availableQty <= 0 && (sales7 > 0 || sales30 > 0 || sales90 > 0)) return "缺货";
  if (dailyWeighted > 0 && daysCover <= leadDays + 10) return "补货预警";
  if (availableQty > 0 && sales30 === 0) return "滞销";
  if (availableQty > 0 && sales90 <= 2) return "滞销";
  if (dailyWeighted > 0 && daysCover > 90) return "慢销";
  if (sales90 === 0 && availableQty <= 0) return "无动销数据";
  return "健康";
}

function suggestionFor(status, row) {
  if (status === "缺货") return "立即核查库存，确认是否有在途或可调拨库存。";
  if (status === "补货预警") return `建议按 ${row.targetCoverDays} 天覆盖量安排补货，参考补货量 ${row.replenishQty}。`;
  if (status === "慢销") return "库存覆盖过高，建议暂停补货并评估促销或调价。";
  if (status === "滞销") return "近 30 天动销不足，建议检查渠道曝光、价格和是否清仓。";
  if (status === "无动销数据") return "暂无订单出库数据，先确认订单接口或 SKU 映射。";
  return "库存和销量处于可控区间。";
}

function appendDataGap(value, gap) {
  const values = String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (gap && !values.includes(gap)) values.push(gap);
  return values.join(",");
}

export function buildMovementSnapshotRows(movementPayload = {}, warehouses = []) {
  const warehouseById = new Map((warehouses || []).map((warehouse) => [warehouse.id, warehouse]));
  const rows = [];
  for (const item of movementPayload.items || []) {
    const stockRows = new Map((item.warehouseBreakdown || []).map((row) => [row.warehouseId || row.warehouseName, row]));
    const salesRows = new Map((item.salesWarehouseBreakdown || []).map((row) => [row.warehouseId || row.warehouseName, row]));
    const keys = new Set([...stockRows.keys(), ...salesRows.keys()].filter(Boolean));
    const salesFields = ["sales3", "sales7", "sales15", "sales30", "sales60", "sales90"];
    const attributedSales = Object.fromEntries(salesFields.map((field) => [
      field,
      Array.from(salesRows.values()).reduce((sum, row) => sum + numberOrZero(row?.[field]), 0),
    ]));
    const residualSales = Object.fromEntries(salesFields.map((field) => [
      field,
      Math.max(0, numberOrZero(item?.[field]) - attributedSales[field]),
    ]));
    const unallocatedWarehouseKey = "__unallocated_sales__";
    if (keys.size && salesFields.some((field) => residualSales[field] > 0.000001)) {
      keys.add(unallocatedWarehouseKey);
    }
    if (!keys.size) keys.add("");
    for (const key of keys) {
      const isUnallocatedSales = key === unallocatedWarehouseKey;
      const stock = isUnallocatedSales ? {} : stockRows.get(key) || {};
      const sales = isUnallocatedSales ? residualSales : salesRows.get(key) || {};
      const hasWarehouseKey = Boolean(key) && !isUnallocatedSales;
      const hasWarehouseSales = salesRows.has(key);
      const warehouseId = isUnallocatedSales ? "" : stock.warehouseId || sales.warehouseId || "";
      const warehouse = warehouseById.get(warehouseId) || {};

      // Country/SKU totals are valid only for an unallocated aggregate row. Falling
      // back to them for a concrete warehouse duplicates the same sale across all
      // stock locations and corrupts warehouse cover/replenishment calculations.
      const useCountryFallback = !key;
      const availableQty = numberOrZero(stock.availableQty ?? (useCountryFallback ? item.availableQty : 0));
      const lockedQty = numberOrZero(stock.lockedQty ?? (useCountryFallback ? item.lockedQty : 0));
      const inTransitQty = numberOrZero(stock.inTransitQty ?? (useCountryFallback ? item.inTransitQty : 0));
      const totalQty = numberOrZero(stock.totalQty ?? (useCountryFallback ? item.totalQty : 0));
      const sales3 = numberOrZero(sales.sales3 ?? (hasWarehouseKey ? 0 : item.sales3));
      const sales7 = numberOrZero(sales.sales7 ?? (hasWarehouseKey ? 0 : item.sales7));
      const sales15 = numberOrZero(sales.sales15 ?? (hasWarehouseKey ? 0 : item.sales15));
      const sales30 = numberOrZero(sales.sales30 ?? (hasWarehouseKey ? 0 : item.sales30));
      const sales60 = numberOrZero(sales.sales60 ?? (hasWarehouseKey ? 0 : item.sales60));
      const sales90 = numberOrZero(sales.sales90 ?? (hasWarehouseKey ? 0 : item.sales90));
      const avgDaily3 = numberOrZero(sales.avgDaily3 ?? sales3 / 3);
      const avgDaily7 = numberOrZero(sales.avgDaily7 ?? sales7 / 7);
      const avgDaily30 = numberOrZero(sales.avgDaily30 ?? sales30 / 30);
      const avgDaily90 = numberOrZero(sales.avgDaily90 ?? sales90 / 90);
      const dailyWeighted = numberOrZero(sales.dailyWeighted ?? (avgDaily7 * 0.5 + avgDaily30 * 0.3 + avgDaily90 * 0.2));
      const leadDays = numberOrZero(item.leadDays);
      const targetCoverDays = numberOrZero(item.targetCoverDays);
      const daysCover = dailyWeighted > 0 ? Math.round((availableQty / dailyWeighted) * 10) / 10 : null;
      const replenishQty = isUnallocatedSales
        ? 0
        : Math.max(0, Math.ceil(dailyWeighted * targetCoverDays - availableQty - inTransitQty));
      const status = statusFor({
        availableQty,
        sales7,
        sales30,
        sales90,
        dailyWeighted,
        daysCover: daysCover ?? 9999,
        leadDays,
      });
      const warehouseSalesUnattributed = isUnallocatedSales;
      const row = {
        sku: item.sku || "",
        countrySku: item.countrySku || "",
        productName: item.name || item.sku || "",
        brand: item.brand || "",
        category: item.category || "",
        country: warehouse.country || item.country || "",
        warehouseId,
        warehouseName: isUnallocatedSales
          ? "未分仓销量"
          : stock.warehouseName || sales.warehouseName || warehouse.name || "未分仓",
        availableQty,
        lockedQty,
        inTransitQty,
        totalQty,
        sales3,
        sales7,
        sales15,
        sales30,
        sales60,
        sales90,
        avgDaily3,
        avgDaily7,
        avgDaily30,
        avgDaily90,
        dailyWeighted,
        daysCover,
        leadDays,
        targetCoverDays,
        replenishQty,
        status,
        suggestion: "",
        source: item.source || "",
        dataGap: appendDataGap(item.dataGap, warehouseSalesUnattributed ? "warehouse_sales_unattributed" : ""),
        salesAttribution: warehouseSalesUnattributed
          ? "unallocated"
          : hasWarehouseSales
            ? "warehouse"
            : hasWarehouseKey
              ? "warehouse_zero"
              : "country",
        dataCompleteness: warehouseSalesUnattributed ? "partial" : item.dataCompleteness || "",
      };
      row.suggestion = warehouseSalesUnattributed
        ? "该仓缺少可归属的订单销量，暂不生成仓库级补货建议。"
        : suggestionFor(status, row);
      rows.push(row);
    }
  }
  return rows.sort((a, b) => b.sales30 - a.sales30 || b.availableQty - a.availableQty || a.sku.localeCompare(b.sku));
}

export function movementSnapshotTotals(rows = []) {
  const statusCounts = rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});
  return {
    rowCount: rows.length,
    warehouseCount: new Set(rows.map((row) => row.warehouseId).filter(Boolean)).size,
    skuCount: new Set(rows.map((row) => row.sku).filter(Boolean)).size,
    availableQty: rows.reduce((sum, row) => sum + numberOrZero(row.availableQty), 0),
    totalQty: rows.reduce((sum, row) => sum + numberOrZero(row.totalQty), 0),
    sales3: rows.reduce((sum, row) => sum + numberOrZero(row.sales3), 0),
    sales7: rows.reduce((sum, row) => sum + numberOrZero(row.sales7), 0),
    sales30: rows.reduce((sum, row) => sum + numberOrZero(row.sales30), 0),
    sales90: rows.reduce((sum, row) => sum + numberOrZero(row.sales90), 0),
    stockout: statusCounts["缺货"] || 0,
    replenish: statusCounts["补货预警"] || 0,
    slow: statusCounts["慢销"] || 0,
    stagnant: statusCounts["滞销"] || 0,
    noSalesData: statusCounts["无动销数据"] || 0,
    unattributedSalesRows: rows.filter((row) => row.salesAttribution === "unallocated").length,
  };
}
