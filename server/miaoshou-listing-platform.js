function text(value) {
  return String(value ?? "").trim();
}

function bool(value) {
  return value === true || value === 1 || String(value).toLowerCase() === "true" || String(value) === "1";
}

function valuesOf(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return Object.values(value);
}

function categoryNodes(container, parentPath = [], parentPathChinese = []) {
  return valuesOf(container).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const cid = text(raw.cid ?? raw.categoryId ?? raw.id);
    if (!cid) return [];
    const name = text(raw.name ?? raw.categoryName);
    const nameChinese = text(raw.nameChinese ?? raw.chineseName ?? name);
    const path = [...parentPath, name || nameChinese].filter(Boolean);
    const pathChinese = [...parentPathChinese, nameChinese || name].filter(Boolean);
    const children = categoryNodes(raw.children, path, pathChinese);
    const explicitLeaf = text(raw.isLastLevel).toLowerCase();
    const leaf = explicitLeaf ? ["true", "1", "yes", "y"].includes(explicitLeaf) : children.length === 0;
    return [{
      cid,
      aid: text(raw.aid),
      fid: text(raw.fid),
      name,
      nameChinese,
      path: path.join(" / "),
      pathChinese: pathChinese.join(" / "),
      disabled: bool(raw.disabled),
      leaf,
      children,
    }];
  });
}

function flatten(nodes, output = []) {
  for (const node of nodes) {
    output.push({
      cid: node.cid,
      aid: node.aid,
      fid: node.fid,
      name: node.name,
      nameChinese: node.nameChinese,
      path: node.path,
      pathChinese: node.pathChinese,
      disabled: node.disabled,
      leaf: node.leaf,
    });
    flatten(node.children, output);
  }
  return output;
}

function sourceCategoryTree(response) {
  return response?.data?.cateTree ?? response?.cateTree ?? response?.data?.categoryTree ?? response?.categoryTree ?? {};
}

export function normalizeTikTokCategoryTree(response) {
  const roots = categoryNodes(sourceCategoryTree(response));
  return { roots, categories: flatten(roots) };
}

function normalizeAttribute(raw = {}) {
  return {
    attrId: text(raw.attrId ?? raw.attributeId ?? raw.id),
    name: text(raw.name ?? raw.attributeName ?? raw.attributeNameAlias),
    alias: text(raw.attributeNameAlias),
    type: text(raw.attributeType),
    mandatory: bool(raw.isMandatory ?? raw.required),
    multiple: bool(raw.isMultipleSelected),
    customized: bool(raw.isCustomized),
    values: valuesOf(raw.values ?? raw.valueList).map((value) => ({
      id: text(value?.id ?? value?.valueId),
      name: text(value?.name ?? value?.valueName ?? value?.valueNameAlias),
    })).filter((value) => value.id || value.name),
  };
}

function normalizeCertification(raw = {}) {
  return {
    id: text(raw.id ?? raw.certificationId),
    name: text(raw.name ?? raw.certificationName),
    required: bool(raw.isRequired ?? raw.isMandatory ?? raw.required),
  };
}

export function normalizeTikTokCategoryMetadata(response) {
  const source = response?.data?.categoryMetadata ?? response?.categoryMetadata ?? response?.data ?? {};
  const config = source.categoryConfig ?? {};
  const productAttributes = valuesOf(source.categoryProductAttrList).map(normalizeAttribute).filter((item) => item.attrId);
  const saleAttributes = valuesOf(source.categorySaleAttrList).map(normalizeAttribute).filter((item) => item.attrId);
  return {
    productAttributes,
    saleAttributes,
    certifications: valuesOf(config.productCertifications).map(normalizeCertification).filter((item) => item.id || item.name),
    requirements: {
      packageDimensions: bool(config.packageDimensionIsRequired),
      sizeChart: bool(config.sizeChartIsRequired),
      epr: bool(config.eprIsRequired),
      responsiblePerson: bool(config.responsiblePersonIsRequired),
      manufacturer: bool(config.manufacturerIsRequired),
    },
  };
}

function searchable(value) {
  return text(value).toLowerCase().replace(/[\s/()（）·,，.-]+/g, "");
}

function searchTokens(query) {
  const raw = text(query).toLowerCase();
  const latin = raw.match(/[a-z0-9]{2,}/g) || [];
  const chinese = (raw.match(/[\u3400-\u9fff]+/g) || []).flatMap((part) => {
    if (part.length <= 2) return [part];
    return Array.from({ length: part.length - 1 }, (_, index) => part.slice(index, index + 2));
  });
  return Array.from(new Set([...latin, ...chinese].map(searchable).filter(Boolean)));
}

export function searchTikTokCategories(categories, query, limit = 60) {
  const tokens = searchTokens(query);
  const available = (Array.isArray(categories) ? categories : []).filter((item) => item.leaf && !item.disabled);
  if (!tokens.length) return available.slice(0, limit);
  return available.map((item) => {
    const haystack = searchable(`${item.pathChinese} ${item.path} ${item.nameChinese} ${item.name}`);
    const score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? Math.max(2, token.length) : 0), 0);
    return { item, score };
  }).filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score || left.item.pathChinese.length - right.item.pathChinese.length)
    .slice(0, limit)
    .map((row) => row.item);
}

export function normalizePlatformAttributes(value) {
  return valuesOf(value).map((item) => ({
    attrId: text(item?.attrId),
    name: text(item?.name),
    valueId: text(item?.valueId),
    valueName: text(item?.valueName),
    customValue: text(item?.customValue),
  })).filter((item) => item.attrId);
}

export function validateTikTokReadiness(draft, metadata) {
  const blocking = [];
  const warnings = [];
  if (text(draft?.platform).toLowerCase() !== "tiktok") {
    return { blocking: ["当前发布准备度仅支持 TikTok。"], warnings, ready: false, completed: 0, total: 1 };
  }
  const checks = [];
  const check = (passed, failure) => {
    checks.push(Boolean(passed));
    if (!passed) blocking.push(failure);
  };
  check(text(draft?.shopId), "请选择目标 TikTok 店铺。");
  check(text(draft?.categoryId), "请选择妙手 TikTok 末级类目。");
  if (!metadata) {
    check(false, "请读取类目要求后再判断发布准备度。");
  } else {
    const selected = new Map(normalizePlatformAttributes(draft?.platformAttributes).map((item) => [item.attrId, item]));
    for (const attr of [...metadata.productAttributes, ...metadata.saleAttributes].filter((item) => item.mandatory)) {
      const value = selected.get(attr.attrId);
      check(Boolean(value && (value.valueId || value.valueName || value.customValue)), `请填写必填属性：${attr.name || attr.attrId}。`);
    }
    if (metadata.requirements.packageDimensions) {
      check([draft?.packageLength, draft?.packageWidth, draft?.packageHeight].every((value) => Number(value) > 0), "该类目要求完整的包装长、宽、高。");
    }
    const requiredCertifications = metadata.certifications.filter((item) => item.required);
    if (requiredCertifications.length) warnings.push(`该类目要求资质/认证：${requiredCertifications.map((item) => item.name || item.id).join("、")}，需在妙手发布前补齐。`);
    if (metadata.requirements.sizeChart) warnings.push("该类目要求尺码表，需在妙手发布前补齐。");
    if (metadata.requirements.epr) warnings.push("该类目要求 EPR 信息，需在妙手发布前补齐。");
    if (metadata.requirements.responsiblePerson) warnings.push("该类目要求责任人信息，需在妙手发布前补齐。");
    if (metadata.requirements.manufacturer) warnings.push("该类目要求制造商信息，需在妙手发布前补齐。");
  }
  return {
    blocking: Array.from(new Set(blocking)),
    warnings: Array.from(new Set(warnings)),
    ready: blocking.length === 0,
    completed: checks.filter(Boolean).length,
    total: checks.length,
  };
}

export function createMiaoshouCategoryService({ connector, ttlMs = 6 * 60 * 60 * 1000, now = () => Date.now() } = {}) {
  const trees = new Map();
  const metadata = new Map();

  async function getTree(site = "ID") {
    const key = text(site).toUpperCase() || "ID";
    const cached = trees.get(key);
    if (cached && now() - cached.loadedAt < ttlMs) return cached.value;
    if (!connector?.getTikTokCategoryTree) throw new Error("妙手 TikTok 类目接口尚未连接");
    const value = normalizeTikTokCategoryTree(await connector.getTikTokCategoryTree({ site: key }));
    trees.set(key, { loadedAt: now(), value });
    return value;
  }

  async function search(site, query, limit = 60) {
    const tree = await getTree(site);
    return searchTikTokCategories(tree.categories, query, limit);
  }

  async function getMetadata({ site = "ID", cid, shopId = "" }) {
    const safeCid = text(cid);
    if (!safeCid) throw new Error("请选择妙手 TikTok 类目");
    const safeSite = text(site).toUpperCase() || "ID";
    const safeShopId = text(shopId);
    const key = `${safeSite}:${safeCid}:${safeShopId}`;
    const cached = metadata.get(key);
    if (cached && now() - cached.loadedAt < ttlMs) return cached.value;
    if (!connector?.getTikTokCategoryMetadata) throw new Error("妙手 TikTok 类目属性接口尚未连接");
    const numericCid = Number(safeCid);
    if (!Number.isSafeInteger(numericCid)) throw new Error("妙手 TikTok 类目 ID 格式无效");
    const request = { cid: numericCid };
    if (safeShopId) {
      const numericShopId = Number(safeShopId);
      if (!Number.isSafeInteger(numericShopId)) throw new Error("妙手 TikTok 店铺 ID 格式无效");
      request.shopIds = [numericShopId];
    }
    else request.site = safeSite;
    const value = normalizeTikTokCategoryMetadata(await connector.getTikTokCategoryMetadata(request));
    metadata.set(key, { loadedAt: now(), value });
    return value;
  }

  return { getMetadata, getTree, search };
}
