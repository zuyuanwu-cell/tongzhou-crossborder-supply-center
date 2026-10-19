export const stockupScheduleRetryMs = 10 * 60 * 1000;

export function shouldRunStockupDailySchedule({
  enabled,
  triggerMode,
  recipientCount,
  currentMinute,
  targetMinute,
  currentRunKey,
  lastRunKey,
  lastAttemptAt,
  nowMs,
  retryMs = stockupScheduleRetryMs,
}) {
  if (!enabled || !["daily", "both"].includes(triggerMode)) return false;
  if (!(Number(recipientCount) > 0)) return false;
  if (!(Number(currentMinute) >= Number(targetMinute))) return false;
  if (lastRunKey === currentRunKey) return false;

  const lastAttemptTime = Date.parse(String(lastAttemptAt || ""));
  if (Number.isFinite(lastAttemptTime) && Number(nowMs) - lastAttemptTime < retryMs) return false;
  return true;
}
