function primitiveText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map(primitiveText).filter(Boolean).join("|");
  if (typeof value === "object") {
    return primitiveText(
      value.id
      || value.data_id
      || value._id
      || value.key
      || value.value
      || value.name
      || value.label
      || value.title,
    );
  }
  return "";
}

function supplierNameVariants(value) {
  const raw = primitiveText(value).trim();
  if (!raw) return [];
  const compact = raw.replace(/\s+/g, "");
  const shortened = compact.replace(/有限责任公司|股份有限公司|有限公司|公司$/g, "");
  return [...new Set([raw, compact, shortened].filter((item) => item.length >= 2))];
}

function normalizeName(value) {
  return primitiveText(value)
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s·•.,，。()（）\-_/\\]+/g, "")
    .replace(/有限责任公司|股份有限公司|有限公司|公司$/g, "");
}

function stableHash(value) {
  let hash = 0x811c9dc5;
  for (const char of value) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function supplierReference(id, name = "") {
  const normalizedId = primitiveText(id).toLocaleLowerCase("zh-CN").trim();
  const normalizedName = normalizeName(name);
  const source = normalizedId ? `id:${normalizedId}` : normalizedName ? `name:${normalizedName}` : "unknown";
  return stableHash(source).toString(36).padStart(7, "0");
}

export function supplierAlias(id, name = "") {
  const reference = supplierReference(id, name);
  return `供应商 ${reference.slice(-4).toUpperCase()}`;
}

export function suppliersMatch(leftId, leftName, rightId, rightName) {
  const leftIdText = primitiveText(leftId).toLocaleLowerCase("zh-CN").trim();
  const rightIdText = primitiveText(rightId).toLocaleLowerCase("zh-CN").trim();
  if (leftIdText && rightIdText) return leftIdText === rightIdText;

  const leftNameText = normalizeName(leftName);
  const rightNameText = normalizeName(rightName);
  return Boolean(leftNameText && rightNameText && leftNameText === rightNameText);
}

export function buildSupplierRedactionEntries(suppliers = [], textSamples = []) {
  const aliases = new Map();
  for (const supplier of suppliers) {
    const alias = supplierAlias(supplier?.id, supplier?.name);
    const variants = supplierNameVariants(supplier?.name);
    const compactName = variants.join("");
    const contextualAliases = textSamples.flatMap((sample) => String(sample || "").match(/[\p{Script=Han}A-Za-z]{2,}/gu) || [])
      .filter((candidate) => compactName.includes(candidate) && !/^(供应商|包装|制品|材料|科技|实业|印刷|日用|化妆品|用品|新材料|供应链)$/.test(candidate));
    for (const name of [...new Set([...variants, ...contextualAliases])]) {
      if (!aliases.has(name)) aliases.set(name, alias);
    }
  }
  return [...aliases.entries()]
    .map(([name, alias]) => ({ name, alias }))
    .sort((left, right) => right.name.length - left.name.length);
}

export function redactSupplierText(value, entries = []) {
  let result = String(value || "");
  for (const entry of entries) {
    if (!entry?.name || !entry?.alias) continue;
    result = result.split(entry.name).join(entry.alias);
  }
  return result;
}
