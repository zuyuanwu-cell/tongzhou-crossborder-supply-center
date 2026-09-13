export type QualificationExpiryStatus = "expired" | "urgent" | "warning" | "valid" | "missing";

export type QualificationExpiryInfo = {
  status: QualificationExpiryStatus;
  daysLeft: number | null;
  label: string;
  actionLabel: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const CHINA_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function chinaCalendarDay(value: Date) {
  const parts = CHINA_DATE_FORMATTER.formatToParts(value);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  return Date.UTC(year, month - 1, day);
}

export function getQualificationExpiryInfo(expiryDate?: string, now = new Date()): QualificationExpiryInfo {
  if (!expiryDate) {
    return {
      status: "missing",
      daysLeft: null,
      label: "未维护到期日",
      actionLabel: "请补充有效期",
    };
  }

  const expiry = new Date(expiryDate);
  if (Number.isNaN(expiry.getTime())) {
    return {
      status: "missing",
      daysLeft: null,
      label: "到期日格式异常",
      actionLabel: "请核对有效期",
    };
  }

  const daysLeft = Math.round((chinaCalendarDay(expiry) - chinaCalendarDay(now)) / DAY_MS);
  if (daysLeft < 0) {
    return {
      status: "expired",
      daysLeft,
      label: `已过期 ${Math.abs(daysLeft)} 天`,
      actionLabel: "需立即续证",
    };
  }
  if (daysLeft <= 30) {
    return {
      status: "urgent",
      daysLeft,
      label: daysLeft === 0 ? "今天到期" : `${daysLeft} 天后到期`,
      actionLabel: "尽快续证",
    };
  }
  if (daysLeft <= 90) {
    return {
      status: "warning",
      daysLeft,
      label: `${daysLeft} 天后到期`,
      actionLabel: "提前准备续证",
    };
  }
  return {
    status: "valid",
    daysLeft,
    label: `剩余 ${daysLeft} 天`,
    actionLabel: "有效期正常",
  };
}

export function qualificationExpiryRank(expiryDate?: string, now = new Date()) {
  const info = getQualificationExpiryInfo(expiryDate, now);
  if (info.status === "expired") return 0;
  if (info.status === "urgent") return 1;
  if (info.status === "warning") return 2;
  if (info.status === "missing") return 3;
  return 4;
}
