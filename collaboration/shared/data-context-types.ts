export type DataContext = {
  generatedAt: string;
  effectiveAt: string;
  timezone: string;
  source: "live" | "snapshot" | "cache" | "derived";
  scopeKey: string;
  scopeLabel: string;
  filters: Record<string, string>;
  completeness: "complete" | "partial" | "unavailable";
  coverage?: { completed: number; total: number; unit: "warehouse" | "sku" | "order" };
  isEstimate: boolean;
  usingPreviousSuccess: boolean;
};
