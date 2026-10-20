function text(value) { return String(value ?? "").trim(); }

function suggestedActions(item) {
  if (item.ruleCode.startsWith("warehouse_sync")) return ["确认上游连接与最近成功同步时间", "重新触发仓库同步并核对数据完整性", "同步恢复前暂停自动关闭相关异常"];
  if (item.ruleCode.startsWith("inventory_")) return ["核对可用、锁定和在途数量", "确认影响订单与安全库存缺口", "需要时创建备货草稿并由负责人确认"];
  if (item.ruleCode.startsWith("stockup_")) return ["分派备货责任人并确认当前节点", "核对预计日期变化与影响仓库", "必要时发送一次催办并记录反馈"];
  if (item.ruleCode.startsWith("production_")) return ["核对生产节点与物料齐套状态", "确认受影响订单和最新承诺日期", "分派责任人并制定追赶计划"];
  return ["核对最新证据", "确认影响范围", "分派责任人并记录处理结论"];
}

export function buildExceptionDossier(item, events = [], playbooks = []) {
  const evidence = Array.isArray(item?.evidence) ? item.evidence : [];
  const affectedOrders = [];
  if (["production_order", "stockup_task", "stockup_request"].includes(item.resourceType)) affectedOrders.push({ type: item.resourceType, id: item.resourceId, href: item.href || "" });
  for (const ref of evidence) {
    if (/order|task|request|timeline/i.test(text(ref.type)) && !affectedOrders.some((entry) => entry.id === text(ref.id))) affectedOrders.push({ type: text(ref.type), id: text(ref.id), href: item.href || "" });
  }
  const inventoryGap = evidence.filter((entry) => /inventory|material/i.test(text(entry.type))).map((entry) => ({ label: text(entry.label), value: entry.value, updatedAt: text(entry.updatedAt) }));
  const productionNodes = evidence.filter((entry) => /production/i.test(text(entry.type))).map((entry) => ({ id: text(entry.id), label: text(entry.label), value: entry.value, updatedAt: text(entry.updatedAt) }));
  const latestChangeEvent = [...events].reverse().find((event) => ["evidence_updated", "severity_escalated", "reopened", "auto_resolved"].includes(event.eventType));
  return {
    caseId: item.id,
    title: item.title,
    status: item.status,
    severity: item.severity,
    summary: item.summary,
    evidence,
    affectedOrders,
    inventoryGap,
    productionNodes,
    changeSummary: item.changeSummary || latestChangeEvent?.payload?.changes || { changed: false, summary: "暂无变化记录" },
    suggestedActions: suggestedActions(item),
    playbooks: playbooks.filter((playbook) => !playbook.ruleCodes.length || playbook.ruleCodes.includes(item.ruleCode)),
    sourceUpdatedAt: item.sourceUpdatedAt || "",
    generatedAt: new Date().toISOString(),
  };
}

export function buildPersonalTodos(cases = [], userId = "") {
  const rank = { critical: 400, high: 300, medium: 200, low: 100 };
  return cases.filter((item) => !item.assigneeId || item.assigneeId === userId).map((item) => {
    const needsAssignment = !item.assigneeId;
    const needsReplenishmentDecision = item.ruleCode.startsWith("inventory_");
    // lastSeenAt is refreshed by every successful patrol, even when nobody has
    // acted. Case age is the safer reminder signal until assignment events are
    // promoted to a dedicated last_action_at column.
    const ageHours = Math.max(0, (Date.now() - Date.parse(item.firstSeenAt || item.updatedAt || new Date().toISOString())) / 3_600_000);
    const needsReminder = Boolean(item.assigneeId && ageHours >= 24);
    const score = (rank[item.severity] || 0) + (needsAssignment ? 60 : 0) + (needsReplenishmentDecision ? 40 : 0) + (needsReminder ? 25 : 0);
    return {
      id: item.id, caseId: item.id, title: item.title, severity: item.severity, status: item.status, assigneeId: item.assigneeId,
      href: item.href || "", score, needsAssignment, needsReminder, needsReplenishmentDecision,
      reason: needsAssignment ? "需要分派责任人" : needsReplenishmentDecision ? "需要补货决策" : needsReminder ? "超过 24 小时无新变化，可考虑催办" : "需要继续跟进",
      changeSummary: item.changeSummary,
    };
  }).sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
}
