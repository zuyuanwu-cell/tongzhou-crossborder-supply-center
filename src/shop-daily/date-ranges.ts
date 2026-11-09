export type ShopDailyDatePreset = "yesterday" | "this_week" | "this_month" | "this_quarter" | "last_month" | "last_quarter";

export const SHOP_DAILY_DATE_PRESETS: Array<{ value: ShopDailyDatePreset; label: string }> = [
  { value: "yesterday", label: "昨天" },
  { value: "this_week", label: "本周" },
  { value: "this_month", label: "本月" },
  { value: "this_quarter", label: "本季度" },
  { value: "last_month", label: "上月" },
  { value: "last_quarter", label: "上季度" },
];

function localDateKey(value: Date) {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

function localDate(year: number, month: number, day: number) {
  // Noon avoids daylight-saving boundaries moving the calendar date in browsers that observe DST.
  return new Date(year, month, day, 12, 0, 0, 0);
}

export function shopDailyDateRange(preset: ShopDailyDatePreset, now = new Date()) {
  const today = localDate(now.getFullYear(), now.getMonth(), now.getDate());
  let from = today;
  let to = today;

  if (preset === "yesterday") {
    from = localDate(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    to = from;
  } else if (preset === "this_week") {
    const mondayOffset = (today.getDay() + 6) % 7;
    from = localDate(today.getFullYear(), today.getMonth(), today.getDate() - mondayOffset);
  } else if (preset === "this_month") {
    from = localDate(today.getFullYear(), today.getMonth(), 1);
  } else if (preset === "this_quarter") {
    from = localDate(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1);
  } else if (preset === "last_month") {
    from = localDate(today.getFullYear(), today.getMonth() - 1, 1);
    to = localDate(today.getFullYear(), today.getMonth(), 0);
  } else {
    const currentQuarterMonth = Math.floor(today.getMonth() / 3) * 3;
    from = localDate(today.getFullYear(), currentQuarterMonth - 3, 1);
    to = localDate(today.getFullYear(), currentQuarterMonth, 0);
  }

  return { dateFrom: localDateKey(from), dateTo: localDateKey(to) };
}

export function matchingShopDailyPreset(dateFrom: string, dateTo: string, now = new Date()): ShopDailyDatePreset | "custom" {
  for (const preset of SHOP_DAILY_DATE_PRESETS) {
    const range = shopDailyDateRange(preset.value, now);
    if (range.dateFrom === dateFrom && range.dateTo === dateTo) return preset.value;
  }
  return "custom";
}
