export type QualificationExpiryStatus = "expired" | "urgent" | "warning" | "valid" | "missing";
export type QualificationExpiryInfo = { status: QualificationExpiryStatus; daysLeft: number | null; label: string; actionLabel: string };
export function getQualificationExpiryInfo(expiryDate?: string, now?: Date): QualificationExpiryInfo;
export function qualificationExpiryRank(expiryDate?: string, now?: Date): number;
