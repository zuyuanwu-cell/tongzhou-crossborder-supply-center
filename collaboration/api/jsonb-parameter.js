export function jsonbParameter(value, fallback) {
  const resolved = value === undefined ? fallback : value;
  return JSON.stringify(resolved ?? null);
}
