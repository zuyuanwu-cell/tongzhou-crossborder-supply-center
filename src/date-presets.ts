export type DatePresetId = "yesterday" | "last3" | "last7" | "last15" | "last30" | "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth";

export const datePresetOptions: Array<{ id: DatePresetId; label: string }> = [
  { id: "yesterday", label: "昨天" },
  { id: "last3", label: "近 3 天" },
  { id: "last7", label: "近 7 天" },
  { id: "last15", label: "近 15 天" },
  { id: "last30", label: "近 30 天" },
  { id: "thisWeek", label: "本周（截至昨天）" },
  { id: "lastWeek", label: "上周" },
  { id: "thisMonth", label: "本月（截至昨天）" },
  { id: "lastMonth", label: "上月" },
];

function dateKey(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function closedBusinessDate(now = new Date(), timezone = "Asia/Shanghai") {
  return addDays(dateKey(now, timezone), -1);
}

export function resolveDatePreset(id: DatePresetId, now = new Date(), timezone = "Asia/Shanghai") {
  const to = closedBusinessDate(now, timezone);
  if (id.startsWith("last") && /^last\d+$/.test(id)) {
    const days = Number(id.slice(4));
    return { from: addDays(to, -(days - 1)), to };
  }
  if (id === "yesterday") return { from: to, to };
  const toDate = new Date(`${to}T00:00:00.000Z`);
  if (id === "thisWeek" || id === "lastWeek") {
    const weekday = toDate.getUTCDay() || 7;
    const currentMonday = addDays(to, -(weekday - 1));
    if (id === "thisWeek") return { from: currentMonday, to };
    return { from: addDays(currentMonday, -7), to: addDays(currentMonday, -1) };
  }
  const monthStart = `${to.slice(0, 7)}-01`;
  if (id === "thisMonth") return { from: monthStart, to };
  const previousEnd = addDays(monthStart, -1);
  return { from: `${previousEnd.slice(0, 7)}-01`, to: previousEnd };
}
