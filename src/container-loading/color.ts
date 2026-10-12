const SKU_PALETTE = [
  "#2563EB", "#F97316", "#059669", "#7C3AED",
  "#DC2626", "#0891B2", "#D97706", "#4F46E5",
  "#DB2777", "#0F766E", "#65A30D", "#9333EA",
  "#EA580C", "#0284C7", "#16A34A", "#BE123C",
] as const;

export function skuColorIndex(sku: string) {
  let hash = 2166136261;
  for (let index = 0; index < sku.length; index += 1) {
    hash ^= sku.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % SKU_PALETTE.length;
}

export function skuColorHex(sku: string) {
  return SKU_PALETTE[skuColorIndex(String(sku || ""))];
}
