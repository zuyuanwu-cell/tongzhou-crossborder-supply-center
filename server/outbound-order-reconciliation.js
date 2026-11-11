function text(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function key(value) {
  return text(value).replace(/[\s\u200B-\u200D\uFEFF]+/g, "").toUpperCase();
}

function wmsOrderNumber(row) {
  return text(row?.externalOrderNo || row?.platformOrderSn || row?.referenceNo || row?.refrenceNo || row?.orderNo || row?.orderId);
}

export function buildOutboundOrderReconciliation({ wmsOrders = [], platformOrders = [], platformItems = [], platformCoverage = "complete" } = {}) {
  const itemByOrder = new Map();
  for (const item of platformItems || []) {
    const orderIdentity = text(item.orderIdentity);
    if (!orderIdentity) continue;
    const current = itemByOrder.get(orderIdentity) || { quantity: 0, skus: new Set() };
    current.quantity += number(item.quantity);
    if (item.platformOuterSkuId || item.platformSkuId) current.skus.add(text(item.platformOuterSkuId || item.platformSkuId));
    itemByOrder.set(orderIdentity, current);
  }

  const platformByNumber = new Map();
  for (const order of platformOrders || []) {
    const status = `${text(order.appOrderStatus)} ${text(order.appOrderStatusText)} ${text(order.platformOrderStatus)}`;
    if (/cancel|closed|unpaid|void|取消|关闭|未付款|待付款/i.test(status)) continue;
    const orderNumber = text(order.platformOrderSn);
    const orderKey = key(orderNumber);
    if (!orderKey) continue;
    const items = itemByOrder.get(text(order.identity)) || { quantity: 0, skus: new Set() };
    const current = platformByNumber.get(orderKey) || {
      orderNumber,
      expectedQty: 0,
      platform: text(order.platform),
      shopId: text(order.shopId),
      orderAmount: 0,
      skus: new Set(),
    };
    current.expectedQty += number(items.quantity);
    current.orderAmount += number(order.orderAmount || order.payAmount);
    for (const sku of items.skus) current.skus.add(sku);
    platformByNumber.set(orderKey, current);
  }

  const wmsByNumber = new Map();
  for (const order of wmsOrders || []) {
    const orderNumber = wmsOrderNumber(order);
    const orderKey = key(orderNumber);
    if (!orderKey) continue;
    const current = wmsByNumber.get(orderKey) || {
      orderNumber,
      shippedQty: 0,
      warehouseId: text(order.warehouseId),
      warehouseName: text(order.warehouseName),
      shopName: text(order.shopAlias || order.shopName),
      skus: new Set(),
      documents: new Set(),
    };
    current.shippedQty += number(order.quantity || order.shippedQty);
    if (order.sku) current.skus.add(text(order.sku));
    if (order.orderNo || order.orderId) current.documents.add(text(order.orderNo || order.orderId));
    wmsByNumber.set(orderKey, current);
  }

  const rows = [...new Set([...platformByNumber.keys(), ...wmsByNumber.keys()])].map((orderKey) => {
    const platform = platformByNumber.get(orderKey);
    const wms = wmsByNumber.get(orderKey);
    const expectedQty = number(platform?.expectedQty);
    const shippedQty = number(wms?.shippedQty);
    const status = !platform
      ? "wms_only"
      : !wms
        ? "missing_wms"
        : expectedQty !== shippedQty
          ? "quantity_mismatch"
          : "matched";
    return {
      orderNumber: platform?.orderNumber || wms?.orderNumber || orderKey,
      status,
      expectedQty,
      shippedQty,
      varianceQty: shippedQty - expectedQty,
      platform: platform?.platform || "",
      shopId: platform?.shopId || "",
      shopName: wms?.shopName || "",
      warehouseId: wms?.warehouseId || "",
      warehouseName: wms?.warehouseName || "",
      orderAmount: number(platform?.orderAmount),
      skus: [...new Set([...(platform?.skus || []), ...(wms?.skus || [])])],
      wmsDocuments: [...(wms?.documents || [])],
    };
  }).sort((left, right) => {
    const priority = { missing_wms: 0, quantity_mismatch: 1, wms_only: 2, matched: 3 };
    return (priority[left.status] ?? 9) - (priority[right.status] ?? 9) || Math.abs(right.varianceQty) - Math.abs(left.varianceQty) || right.orderAmount - left.orderAmount;
  });

  const sum = (filter, field) => rows.filter(filter).reduce((total, row) => total + number(row[field]), 0);
  return {
    coverage: platformCoverage,
    summary: {
      platformOrderCount: platformByNumber.size,
      wmsOrderCount: wmsByNumber.size,
      expectedQty: sum((row) => row.status !== "wms_only", "expectedQty"),
      shippedQty: sum(() => true, "shippedQty"),
      matchedOrderCount: rows.filter((row) => row.status === "matched").length,
      missingWmsOrderCount: rows.filter((row) => row.status === "missing_wms").length,
      missingWmsQty: sum((row) => row.status === "missing_wms", "expectedQty"),
      wmsOnlyOrderCount: rows.filter((row) => row.status === "wms_only").length,
      wmsOnlyQty: sum((row) => row.status === "wms_only", "shippedQty"),
      quantityMismatchOrderCount: rows.filter((row) => row.status === "quantity_mismatch").length,
      quantityMismatchQty: sum((row) => row.status === "quantity_mismatch", "varianceQty"),
    },
    rows,
  };
}
