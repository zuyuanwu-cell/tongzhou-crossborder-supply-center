function rows(value) {
  return Array.isArray(value) ? value : [];
}

function isoTime(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function recoverInterruptedOrderSyncJobs(store = {}, {
  now = new Date(),
  message = "服务重启或上次进程中断，原同步任务已结束，系统将自动重新同步。",
} = {}) {
  const completedAt = isoTime(now);
  const recoveredJobIds = [];
  for (const job of rows(store.jobs)) {
    if (!job || !["queued", "running"].includes(job.status)) continue;
    recoveredJobIds.push(String(job.id || ""));
    job.status = "failed";
    job.completedAt = completedAt;
    job.currentWarehouseId = "";
    job.currentWarehouseName = "";
    job.currentChunkLabel = "";
    job.message = message;
    job.chunks = rows(job.chunks).map((chunk) => (
      chunk?.status === "running"
        ? { ...chunk, status: "failed", completedAt, message }
        : chunk
    ));
  }
  return {
    recoveredCount: recoveredJobIds.length,
    recoveredJobIds: recoveredJobIds.filter(Boolean),
  };
}
