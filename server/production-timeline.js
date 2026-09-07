function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function validDate(value) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function latestDate(values = []) {
  return values.map(validDate).filter(Boolean).sort().at(-1) || "";
}

function quantityText(totals = {}) {
  const parts = [
    ["已下单", totals.orderedQty],
    ["已完工", totals.completedQty],
    ["已发货", totals.shippedQty],
    ["已到仓", totals.receivedQty],
  ].filter(([, value]) => Number.isFinite(Number(value)) && Number(value) > 0)
    .map(([label, value]) => `${label} ${numeric(value).toLocaleString("zh-CN")}`);
  return parts.join(" · ");
}

function orderSnapshotText(order, lines) {
  const qualifiedQty = lines.reduce((sum, line) => sum + numeric(line.qualifiedQty), 0);
  const parts = [
    order.status ? `状态：${order.status}` : "",
    quantityText(order),
    qualifiedQty > 0 ? `检验合格 ${qualifiedQty.toLocaleString("zh-CN")}` : "",
  ].filter(Boolean);
  return parts.join(" · ") || "已同步当前生产状态";
}

function progressDescription(log) {
  const status = text(log.details?.status || log.details?.orderStatus);
  const totals = quantityText(log.details?.totals);
  const rollback = text(log.details?.rollbackStage);
  const reason = text(log.details?.reason);
  return [rollback ? `退回${rollback}` : status ? `更新为${status}` : "已更新生产数量", totals, reason].filter(Boolean).join(" · ");
}

function addEvent(events, event) {
  const occurredAt = validDate(event.occurredAt);
  if (!occurredAt) return;
  const key = `${event.type}|${occurredAt}|${event.title}|${event.description || ""}`;
  if (events.some((item) => item._key === key)) return;
  events.push({
    _key: key,
    id: text(event.id, key),
    occurredAt,
    type: text(event.type, "progress"),
    title: text(event.title, "生产进度更新"),
    description: text(event.description),
    actorName: text(event.actorName),
    tone: text(event.tone, "done"),
  });
}

function matchesOrderLog(log, order, lineIds, shipmentIds) {
  if (log.targetType === "stockup_execution") {
    return [order.id, order.orderNo].filter(Boolean).includes(log.targetName);
  }
  if (log.targetType === "stockup_execution_line") return lineIds.has(log.targetName);
  if (log.targetType === "shipment") {
    return log.details?.stockupOrderRecordId === order.id || shipmentIds.has(log.targetName);
  }
  if (log.targetType === "wms_stockup_push") return shipmentIds.has(log.details?.shipmentRecordId);
  return false;
}

export function buildProductionTimelines(workflow = {}, actionLogPayload = {}, wmsPushTasks = []) {
  const orders = Array.isArray(workflow.stockupOrders) ? workflow.stockupOrders : [];
  const lines = Array.isArray(workflow.stockupLines) ? workflow.stockupLines : [];
  const shipments = Array.isArray(workflow.shipments) ? workflow.shipments : [];
  const logs = Array.isArray(actionLogPayload.entries) ? actionLogPayload.entries : [];

  return orders.map((order) => {
    const orderLines = lines.filter((line) => line.orderRecordId === order.id);
    const lineIds = new Set(orderLines.map((line) => line.id));
    const orderShipments = shipments.filter((shipment) => shipment.stockupOrderRecordId === order.id);
    const shipmentIds = new Set(orderShipments.map((shipment) => shipment.id));
    const orderLogs = logs.filter((log) => matchesOrderLog(log, order, lineIds, shipmentIds));
    const events = [];
    const openedAt = validDate(order.createdAt)
      || latestDate(orderLines.map((line) => line.createdAt))
      || validDate(order.stockupDate);
    const creationLog = orderLogs.find((log) => log.targetType === "stockup_execution" && /需求转|创建/.test(log.action));

    addEvent(events, {
      id: `opened:${order.id}`,
      occurredAt: openedAt || creationLog?.createdAt,
      type: "opened",
      title: "生产单已开立",
      description: [order.orderNo, order.executionMode, order.plannedQty > 0 ? `计划 ${numeric(order.plannedQty).toLocaleString("zh-CN")}` : ""].filter(Boolean).join(" · "),
      actorName: creationLog?.actorName,
      tone: "done",
    });

    for (const log of orderLogs) {
      if (log === creationLog) continue;
      if (log.targetType === "stockup_execution_line") {
        addEvent(events, {
          id: log.id,
          occurredAt: log.createdAt,
          type: /退回/.test(log.action) ? "rollback" : "progress",
          title: /退回/.test(log.action) ? "生产进度已退回" : "生产进度已更新",
          description: progressDescription(log),
          actorName: log.actorName,
          tone: /退回/.test(log.action) ? "warning" : "done",
        });
      } else if (log.targetType === "stockup_execution") {
        addEvent(events, {
          id: log.id,
          occurredAt: log.createdAt,
          type: "cancelled",
          title: log.action || "生产单已更新",
          description: [log.details?.cancelledQty ? `取消 ${numeric(log.details.cancelledQty).toLocaleString("zh-CN")}` : "", log.details?.reason].filter(Boolean).join(" · "),
          actorName: log.actorName,
          tone: "warning",
        });
      } else if (log.targetType === "shipment") {
        addEvent(events, {
          id: log.id,
          occurredAt: log.createdAt,
          type: "shipment",
          title: "已登记发货",
          description: [log.details?.warehouseName, log.details?.lineCount ? `${log.details.lineCount} 个 SKU` : ""].filter(Boolean).join(" · "),
          actorName: log.actorName,
          tone: "done",
        });
      } else if (log.targetType === "wms_stockup_push") {
        addEvent(events, {
          id: log.id,
          occurredAt: log.createdAt,
          type: "wms",
          title: "已确认推送 WMS",
          description: [log.targetName, log.details?.warehouseName].filter(Boolean).join(" · "),
          actorName: log.actorName,
          tone: "done",
        });
      }
    }

    for (const shipment of orderShipments) {
      const logged = orderLogs.some((log) => log.targetType === "shipment" && (log.targetName === shipment.id || log.details?.stockupOrderRecordId === order.id));
      if (!logged) addEvent(events, {
        id: `shipment:${shipment.id}`,
        occurredAt: shipment.shippedAt || shipment.createdAt,
        type: "shipment",
        title: "已登记发货",
        description: [shipment.shipmentNo, shipment.destinationWarehouseName, shipment.trackingNo].filter(Boolean).join(" · "),
        tone: "done",
      });
    }

    for (const task of wmsPushTasks.filter((item) => item.stockupOrderRecordId === order.id)) {
      if (task.status === "pushed") addEvent(events, {
        id: `wms:${task.id}`,
        occurredAt: task.pushedAt || task.confirmedAt,
        type: "wms",
        title: "WMS 备货单已创建",
        description: [task.wmsOrderNo, task.warehouseName, task.providerName].filter(Boolean).join(" · "),
        actorName: task.confirmedBy,
        tone: "done",
      });
      else addEvent(events, {
        id: `wms-pending:${task.id}`,
        occurredAt: task.createdAt,
        type: "wms_pending",
        title: task.status === "failed" || task.status === "needs_manual_check" ? "WMS 推送需要处理" : "等待确认推送 WMS",
        description: [task.warehouseName, task.lastError].filter(Boolean).join(" · "),
        tone: task.status === "failed" || task.status === "needs_manual_check" ? "warning" : "current",
      });
    }

    const hasRecordedProgress = events.some((event) => ["progress", "rollback", "shipment", "wms", "wms_pending", "cancelled"].includes(event.type));
    const snapshotAt = latestDate([order.updatedAt, ...orderLines.map((line) => line.updatedAt)]);
    if (!hasRecordedProgress && snapshotAt && snapshotAt !== openedAt) addEvent(events, {
      id: `snapshot:${order.id}`,
      occurredAt: snapshotAt,
      type: "snapshot",
      title: "当前生产状态",
      description: orderSnapshotText(order, orderLines),
      tone: "current",
    });

    addEvent(events, {
      id: `completed:${order.id}`,
      occurredAt: order.actualCompletedAt,
      type: "completed",
      title: "生产与质检已完成",
      description: order.completedQty > 0 ? `完工 ${numeric(order.completedQty).toLocaleString("zh-CN")}` : "已达到可发状态",
      tone: "done",
    });
    addEvent(events, {
      id: `expected:${order.id}`,
      occurredAt: order.expectedCompletedAt,
      type: "expected",
      title: "预计完成",
      description: "计划节点，实际进度以最新跟进记录为准",
      tone: "planned",
    });

    events.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
    const cleanEvents = events.map(({ _key, ...event }) => event);
    const actualEvents = cleanEvents.filter((event) => event.tone !== "planned");
    return {
      orderRecordId: order.id,
      openedAt: openedAt || cleanEvents[0]?.occurredAt || "",
      updatedAt: latestDate(actualEvents.map((event) => event.occurredAt)),
      expectedCompletedAt: validDate(order.expectedCompletedAt),
      events: cleanEvents,
    };
  });
}
