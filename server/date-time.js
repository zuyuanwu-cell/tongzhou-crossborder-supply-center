const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function safeTimezone(value, fallback = "Asia/Shanghai") {
  const candidate = String(value || fallback || "Asia/Shanghai").trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return fallback || "Asia/Shanghai";
  }
}

export function dateKeyInTimezone(value = new Date(), timezone = "Asia/Shanghai") {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

// Business event dates that are already stored as YYYY-MM-DD are calendar
// dates, not UTC instants. Preserve them verbatim; convert timestamp values
// through the warehouse timezone so all inventory services share one rule.
export function eventDateInTimezone(value, timezone = "Asia/Shanghai") {
  const source = String(value ?? "").trim();
  if (!source) return "";
  if (DATE_KEY.test(source)) return source;
  const literal = source.match(/^(\d{4}-\d{2}-\d{2})(?:\s|T)/);
  if (literal && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(source)) return literal[1];
  return dateKeyInTimezone(source, timezone);
}

export function dateSemantics(timezone = "Asia/Shanghai") {
  return {
    timezone: safeTimezone(timezone),
    businessDate: "按仓库时区归属的业务发生日",
    activityDate: "退货或工单首次进入处理链路的日期",
    dispositionDate: "退货完成入库、报废或最终处置的日期",
  };
}

export function addBusinessDays(dateKey, days) {
  if (!DATE_KEY.test(String(dateKey || ""))) return "";
  const parsed = new Date(`${dateKey}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + Number(days || 0));
  return parsed.toISOString().slice(0, 10);
}

export function closedBusinessDate(value = new Date(), timezone = "Asia/Shanghai") {
  return addBusinessDays(dateKeyInTimezone(value, timezone), -1);
}

export function businessDayRange(dateKey) {
  if (!DATE_KEY.test(String(dateKey || ""))) return { from: "", to: "" };
  return { from: `${dateKey} 00:00:00`, to: `${dateKey} 23:59:59` };
}

export function dateDistanceInDays(from, to) {
  if (!DATE_KEY.test(String(from || "")) || !DATE_KEY.test(String(to || ""))) return null;
  return Math.round((new Date(`${to}T00:00:00.000Z`) - new Date(`${from}T00:00:00.000Z`)) / 86_400_000);
}
