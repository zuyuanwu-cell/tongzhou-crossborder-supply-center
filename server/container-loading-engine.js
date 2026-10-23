const EPSILON = 0.001;
const MAX_CARTONS = 2000;

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 2) {
  const power = 10 ** digits;
  return Math.round((finiteNumber(value) + Number.EPSILON) * power) / power;
}

function positive(value, label) {
  const parsed = finiteNumber(value);
  if (parsed <= 0) throw Object.assign(new Error(`${label}必须大于 0。`), { statusCode: 400, code: "invalid_dimension" });
  return parsed;
}

export function normalizeContainer(input = {}) {
  const lengthCm = positive(input.lengthCm, "集装箱内部长度");
  const widthCm = positive(input.widthCm, "集装箱内部宽度");
  const heightCm = positive(input.heightCm, "集装箱内部高度");
  const doorWidthCm = positive(input.doorWidthCm || widthCm, "柜门宽度");
  const doorHeightCm = positive(input.doorHeightCm || heightCm, "柜门高度");
  const maxPayloadKg = positive(input.maxPayloadKg, "最大载重");
  if (doorWidthCm > widthCm + EPSILON || doorHeightCm > heightCm + EPSILON) {
    throw Object.assign(new Error("柜门尺寸不能大于集装箱内部尺寸。"), { statusCode: 400, code: "invalid_door_dimension" });
  }
  return {
    code: String(input.code || "CUSTOM"),
    name: String(input.name || input.code || "自定义柜型"),
    lengthCm,
    widthCm,
    heightCm,
    doorWidthCm,
    doorHeightCm,
    maxPayloadKg,
  };
}

function uniqueOrientations(item) {
  const l = positive(item.cartonLengthCm, `${item.sku || "商品"} 外箱长度`);
  const w = positive(item.cartonWidthCm, `${item.sku || "商品"} 外箱宽度`);
  const h = positive(item.cartonHeightCm, `${item.sku || "商品"} 外箱高度`);
  const mode = String(item.orientation || "upright");
  const candidates = mode === "any"
    ? [[l, w, h], [w, l, h], [l, h, w], [h, l, w], [w, h, l], [h, w, l]]
    : mode === "fixed"
      ? [[l, w, h]]
      : [[l, w, h], [w, l, h]];
  const seen = new Set();
  return candidates
    .map(([lengthCm, widthCm, heightCm]) => ({ lengthCm, widthCm, heightCm }))
    .filter((candidate) => {
      const key = `${candidate.lengthCm}|${candidate.widthCm}|${candidate.heightCm}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function normalizeLoadingItems(input = []) {
  const items = (Array.isArray(input) ? input : []).map((item, index) => {
    const cartonCount = Math.floor(positive(item.cartonCount, `${item.sku || `第 ${index + 1} 行`} 箱数`));
    const unitsPerCarton = Math.floor(positive(item.unitsPerCarton || 1, `${item.sku || `第 ${index + 1} 行`} 每箱件数`));
    return {
      id: String(item.id || `item-${index + 1}`),
      sku: String(item.sku || "").trim().toUpperCase(),
      productName: String(item.productName || item.sku || `商品 ${index + 1}`).trim(),
      imageUrl: String(item.imageUrl || ""),
      cartonCount,
      unitsPerCarton,
      cartonLengthCm: positive(item.cartonLengthCm, `${item.sku || `第 ${index + 1} 行`} 外箱长度`),
      cartonWidthCm: positive(item.cartonWidthCm, `${item.sku || `第 ${index + 1} 行`} 外箱宽度`),
      cartonHeightCm: positive(item.cartonHeightCm, `${item.sku || `第 ${index + 1} 行`} 外箱高度`),
      cartonWeightKg: positive(item.cartonWeightKg, `${item.sku || `第 ${index + 1} 行`} 单箱重量`),
      orientation: ["fixed", "upright", "any"].includes(String(item.orientation)) ? String(item.orientation) : "upright",
      priority: Math.max(0, Math.min(9, Math.floor(finiteNumber(item.priority, 5)))),
      fragile: Boolean(item.fragile),
      locked: Boolean(item.locked),
    };
  });
  if (!items.length) throw Object.assign(new Error("请至少添加一个待装商品。"), { statusCode: 400, code: "items_required" });
  const total = items.reduce((sum, item) => sum + item.cartonCount, 0);
  if (total > MAX_CARTONS) {
    throw Object.assign(new Error(`单个方案最多支持 ${MAX_CARTONS} 箱，当前为 ${total} 箱。`), { statusCode: 400, code: "too_many_cartons" });
  }
  return items;
}

function intersects(a, b) {
  return a.x < b.x + b.lengthCm - EPSILON
    && a.x + a.lengthCm > b.x + EPSILON
    && a.y < b.y + b.widthCm - EPSILON
    && a.y + a.widthCm > b.y + EPSILON
    && a.z < b.z + b.heightCm - EPSILON
    && a.z + a.heightCm > b.z + EPSILON;
}

function pointInsidePlacement(point, placement) {
  return point.x >= placement.x - EPSILON && point.x < placement.x + placement.lengthCm - EPSILON
    && point.y >= placement.y - EPSILON && point.y < placement.y + placement.widthCm - EPSILON
    && point.z >= placement.z - EPSILON && point.z < placement.z + placement.heightCm - EPSILON;
}

function createSpatialIndex(cellSize = 60) {
  const cells = new Map();
  const tops = new Map();
  const placementCells = (placement) => {
    const output = [];
    const minX = Math.floor(placement.x / cellSize);
    const maxX = Math.floor((placement.x + Math.max(placement.lengthCm, EPSILON) - EPSILON) / cellSize);
    const minY = Math.floor(placement.y / cellSize);
    const maxY = Math.floor((placement.y + Math.max(placement.widthCm, EPSILON) - EPSILON) / cellSize);
    const minZ = Math.floor(placement.z / cellSize);
    const maxZ = Math.floor((placement.z + Math.max(placement.heightCm, EPSILON) - EPSILON) / cellSize);
    for (let x = minX; x <= maxX; x += 1) for (let y = minY; y <= maxY; y += 1) for (let z = minZ; z <= maxZ; z += 1) output.push(`${x}|${y}|${z}`);
    return output;
  };
  return {
    add(placement) {
      for (const key of placementCells(placement)) {
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(placement);
      }
      const topKey = round(placement.z + placement.heightCm, 3).toFixed(3);
      if (!tops.has(topKey)) tops.set(topKey, []);
      tops.get(topKey).push(placement);
    },
    query(candidate) {
      const found = new Set();
      for (const key of placementCells(candidate)) for (const placement of cells.get(key) || []) found.add(placement);
      return [...found];
    },
    supporting(z) {
      return tops.get(round(z, 3).toFixed(3)) || [];
    },
    containsPoint(point) {
      const key = `${Math.floor(point.x / cellSize)}|${Math.floor(point.y / cellSize)}|${Math.floor(point.z / cellSize)}`;
      return (cells.get(key) || []).some((placement) => pointInsidePlacement(point, placement));
    },
  };
}

function supportRatio(candidate, source) {
  if (candidate.z <= EPSILON) return 1;
  const baseArea = candidate.lengthCm * candidate.widthCm;
  let supportedArea = 0;
  const placements = typeof source?.supporting === "function" ? source.supporting(candidate.z) : source;
  for (const placed of placements) {
    if (Math.abs((placed.z + placed.heightCm) - candidate.z) > EPSILON) continue;
    const overlapLength = Math.max(0, Math.min(candidate.x + candidate.lengthCm, placed.x + placed.lengthCm) - Math.max(candidate.x, placed.x));
    const overlapWidth = Math.max(0, Math.min(candidate.y + candidate.widthCm, placed.y + placed.widthCm) - Math.max(candidate.y, placed.y));
    supportedArea += overlapLength * overlapWidth;
  }
  return Math.min(1, supportedArea / baseArea);
}

function fits(candidate, source, container, ignorePlacementId = "") {
  if (candidate.x < -EPSILON || candidate.y < -EPSILON || candidate.z < -EPSILON) return false;
  if (candidate.x + candidate.lengthCm > container.lengthCm + EPSILON) return false;
  if (candidate.y + candidate.widthCm > container.widthCm + EPSILON) return false;
  if (candidate.z + candidate.heightCm > container.heightCm + EPSILON) return false;
  if (candidate.widthCm > container.doorWidthCm + EPSILON || candidate.heightCm > container.doorHeightCm + EPSILON) return false;
  const nearby = typeof source?.query === "function" ? source.query(candidate) : source;
  if (nearby.some((placement) => placement.placementId !== ignorePlacementId && intersects(candidate, placement))) return false;
  return supportRatio(candidate, source) >= 0.72;
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function expandCartons(items, strategy, variant) {
  const groups = items.map((item) => ({
    item,
    volume: item.cartonLengthCm * item.cartonWidthCm * item.cartonHeightCm,
    density: item.cartonWeightKg / (item.cartonLengthCm * item.cartonWidthCm * item.cartonHeightCm),
  }));
  groups.sort((a, b) => {
    if (b.item.priority !== a.item.priority) return b.item.priority - a.item.priority;
    if (strategy === "balanced" && b.item.cartonWeightKg !== a.item.cartonWeightKg) return b.item.cartonWeightKg - a.item.cartonWeightKg;
    if (strategy === "sku_complete" && a.item.cartonCount !== b.item.cartonCount) return a.item.cartonCount - b.item.cartonCount;
    if (b.volume !== a.volume) return b.volume - a.volume;
    return (stableHash(a.item.sku) + variant) - (stableHash(b.item.sku) + variant);
  });
  if (variant % 2 === 1 && strategy !== "sku_complete") groups.reverse();
  const boxes = [];
  for (const group of groups) {
    for (let index = 0; index < group.item.cartonCount; index += 1) {
      boxes.push({
        placementId: `${group.item.id}:${index + 1}`,
        itemId: group.item.id,
        sku: group.item.sku,
        productName: group.item.productName,
        imageUrl: group.item.imageUrl,
        cartonIndex: index + 1,
        cartonWeightKg: group.item.cartonWeightKg,
        unitsPerCarton: group.item.unitsPerCarton,
        orientations: uniqueOrientations(group.item),
        fragile: group.item.fragile,
        locked: group.item.locked,
      });
    }
  }
  return boxes;
}

function placementChoiceScore(candidate, source, bounds, container, strategy) {
  const maxX = Math.max(candidate.x + candidate.lengthCm, bounds.maxX);
  const maxY = Math.max(candidate.y + candidate.widthCm, bounds.maxY);
  const maxZ = Math.max(candidate.z + candidate.heightCm, bounds.maxZ);
  const compactVolume = maxX * maxY * maxZ;
  const centerY = candidate.y + candidate.widthCm / 2;
  const lateralOffset = Math.abs(centerY - container.widthCm / 2);
  const supportPenalty = 1 - supportRatio(candidate, source);
  if (strategy === "balanced") return candidate.z * 2e8 + lateralOffset * 1e6 + candidate.x * 1e4 + compactVolume + supportPenalty * 1e9;
  if (strategy === "sku_complete") return candidate.x * 2e8 + candidate.z * 1e6 + candidate.y * 1e4 + compactVolume;
  return compactVolume + candidate.z * 2e6 + candidate.x * 1e4 + candidate.y + supportPenalty * 1e9;
}

function prunePoints(points, source, container) {
  const unique = new Map();
  for (const point of points) {
    const normalized = { x: round(point.x, 3), y: round(point.y, 3), z: round(point.z, 3) };
    if (normalized.x > container.lengthCm + EPSILON || normalized.y > container.widthCm + EPSILON || normalized.z > container.heightCm + EPSILON) continue;
    if (typeof source?.containsPoint === "function" ? source.containsPoint(normalized) : source.some((placement) => pointInsidePlacement(normalized, placement))) continue;
    unique.set(`${normalized.x}|${normalized.y}|${normalized.z}`, normalized);
  }
  return [...unique.values()].sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y).slice(0, 12000);
}

function assignSequence(placements) {
  return [...placements]
    .sort((a, b) => a.x - b.x || a.z - b.z || a.y - b.y)
    .map((placement, index) => ({ ...placement, sequence: index + 1 }));
}

export function calculateLoadingMetrics(containerInput, itemsInput, placementsInput) {
  const container = normalizeContainer(containerInput);
  const items = normalizeLoadingItems(itemsInput);
  const placements = Array.isArray(placementsInput) ? placementsInput : [];
  const totalCartons = items.reduce((sum, item) => sum + item.cartonCount, 0);
  const loadedCartons = placements.length;
  const totalVolumeCm3 = items.reduce((sum, item) => sum + item.cartonCount * item.cartonLengthCm * item.cartonWidthCm * item.cartonHeightCm, 0);
  const loadedVolumeCm3 = placements.reduce((sum, item) => sum + finiteNumber(item.lengthCm) * finiteNumber(item.widthCm) * finiteNumber(item.heightCm), 0);
  const totalWeightKg = items.reduce((sum, item) => sum + item.cartonCount * item.cartonWeightKg, 0);
  const loadedWeightKg = placements.reduce((sum, item) => sum + finiteNumber(item.cartonWeightKg), 0);
  const containerVolumeCm3 = container.lengthCm * container.widthCm * container.heightCm;
  const weightBasis = loadedWeightKg || 1;
  const centerX = placements.reduce((sum, item) => sum + finiteNumber(item.cartonWeightKg) * (finiteNumber(item.x) + finiteNumber(item.lengthCm) / 2), 0) / weightBasis;
  const centerY = placements.reduce((sum, item) => sum + finiteNumber(item.cartonWeightKg) * (finiteNumber(item.y) + finiteNumber(item.widthCm) / 2), 0) / weightBasis;
  const frontRearDeviation = loadedCartons ? Math.abs(centerX - container.lengthCm / 2) / (container.lengthCm / 2) * 100 : 0;
  const leftRightDeviation = loadedCartons ? Math.abs(centerY - container.widthCm / 2) / (container.widthCm / 2) * 100 : 0;
  const balanceScore = Math.max(0, 100 - (frontRearDeviation + leftRightDeviation) * 2.5);
  const loadedByItem = new Map();
  placements.forEach((placement) => loadedByItem.set(placement.itemId, (loadedByItem.get(placement.itemId) || 0) + 1));
  const completeSkuCount = items.filter((item) => (loadedByItem.get(item.id) || 0) >= item.cartonCount).length;
  const layerCount = new Set(placements.map((item) => round(item.z, 1))).size;
  return {
    totalCartons,
    loadedCartons,
    unplacedCartons: Math.max(0, totalCartons - loadedCartons),
    totalUnits: items.reduce((sum, item) => sum + item.cartonCount * item.unitsPerCarton, 0),
    loadedUnits: placements.reduce((sum, item) => sum + finiteNumber(item.unitsPerCarton, 1), 0),
    totalWeightKg: round(totalWeightKg),
    loadedWeightKg: round(loadedWeightKg),
    totalVolumeM3: round(totalVolumeCm3 / 1_000_000, 3),
    loadedVolumeM3: round(loadedVolumeCm3 / 1_000_000, 3),
    volumeUtilization: round(loadedVolumeCm3 / containerVolumeCm3 * 100, 1),
    weightUtilization: round(loadedWeightKg / container.maxPayloadKg * 100, 1),
    frontRearDeviation: round(frontRearDeviation, 1),
    leftRightDeviation: round(leftRightDeviation, 1),
    balanceScore: round(balanceScore, 1),
    completeSkuCount,
    skuCount: items.length,
    layerCount,
  };
}

function buildWarnings(container, items, metrics, unplaced) {
  const warnings = [];
  if (metrics.unplacedCartons) warnings.push(`仍有 ${metrics.unplacedCartons} 箱未装入，需要换柜型、减少数量或拆分集装箱。`);
  if (metrics.weightUtilization > 95) warnings.push("载重利用率超过 95%，请预留柜重误差和现场操作余量。");
  if (metrics.frontRearDeviation > 12 || metrics.leftRightDeviation > 10) warnings.push("货物重心偏移较大，建议选择均衡方案或人工调整重箱位置。");
  const doorBlocked = unplaced.filter((box) => box.orientations.every((orientation) => orientation.widthCm > container.doorWidthCm + EPSILON || orientation.heightCm > container.doorHeightCm + EPSILON));
  if (doorBlocked.length) warnings.push(`${doorBlocked.length} 箱的允许摆放方向无法通过当前柜门。`);
  const requestedWeight = items.reduce((sum, item) => sum + item.cartonCount * item.cartonWeightKg, 0);
  if (requestedWeight > container.maxPayloadKg) warnings.push(`全部货物重 ${round(requestedWeight)}kg，超过柜型载重 ${round(container.maxPayloadKg)}kg。`);
  return warnings;
}

function planScore(strategy, metrics) {
  const loadedRate = metrics.totalCartons ? metrics.loadedCartons / metrics.totalCartons * 100 : 0;
  const completeRate = metrics.skuCount ? metrics.completeSkuCount / metrics.skuCount * 100 : 0;
  if (strategy === "balanced") return round(loadedRate * 0.45 + metrics.balanceScore * 0.4 + metrics.volumeUtilization * 0.15, 1);
  if (strategy === "sku_complete") return round(completeRate * 0.5 + loadedRate * 0.35 + metrics.balanceScore * 0.15, 1);
  return round(loadedRate * 0.55 + metrics.volumeUtilization * 0.3 + metrics.balanceScore * 0.15, 1);
}

function simulateVariant(container, items, strategy, variant) {
  const boxes = expandCartons(items, strategy, variant);
  const placements = [];
  const unplaced = [];
  const spatialIndex = createSpatialIndex();
  const bounds = { maxX: 0, maxY: 0, maxZ: 0 };
  let points = [{ x: 0, y: 0, z: 0 }];
  let loadedWeightKg = 0;
  for (const box of boxes) {
    if (loadedWeightKg + box.cartonWeightKg > container.maxPayloadKg + EPSILON) {
      unplaced.push(box);
      continue;
    }
    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;
    const orientations = variant % 3 === 2 ? [...box.orientations].reverse() : box.orientations;
    const candidatePoints = strategy === "balanced"
      ? [...points].sort((a, b) => a.z - b.z || Math.abs((a.y) - container.widthCm / 2) - Math.abs((b.y) - container.widthCm / 2) || a.x - b.x)
      : points;
    search: for (const point of candidatePoints) {
      for (const orientation of orientations) {
        const candidate = { ...box, ...orientation, x: point.x, y: point.y, z: point.z };
        if (!fits(candidate, spatialIndex, container)) continue;
        best = candidate;
        bestScore = placementChoiceScore(candidate, spatialIndex, bounds, container, strategy);
        break search;
      }
    }
    if (!best) {
      unplaced.push(box);
      continue;
    }
    placements.push(best);
    spatialIndex.add(best);
    bounds.maxX = Math.max(bounds.maxX, best.x + best.lengthCm);
    bounds.maxY = Math.max(bounds.maxY, best.y + best.widthCm);
    bounds.maxZ = Math.max(bounds.maxZ, best.z + best.heightCm);
    loadedWeightKg += box.cartonWeightKg;
    points.push(
      { x: best.x + best.lengthCm, y: best.y, z: best.z },
      { x: best.x, y: best.y + best.widthCm, z: best.z },
      { x: best.x, y: best.y, z: best.z + best.heightCm },
    );
    points = prunePoints(points, spatialIndex, container);
  }
  const sequenced = assignSequence(placements);
  const metrics = calculateLoadingMetrics(container, items, sequenced);
  return {
    strategy,
    placements: sequenced,
    unplaced: unplaced.map((box) => ({ placementId: box.placementId, itemId: box.itemId, sku: box.sku, productName: box.productName, cartonWeightKg: box.cartonWeightKg })),
    metrics,
    warnings: buildWarnings(container, items, metrics, unplaced),
    score: planScore(strategy, metrics),
  };
}

export function simulateContainerLoading({ container: containerInput, items: itemsInput, strategy = "max_load" }) {
  const container = normalizeContainer(containerInput);
  const items = normalizeLoadingItems(itemsInput);
  const normalizedStrategy = ["max_load", "balanced", "sku_complete"].includes(strategy) ? strategy : "max_load";
  let best = null;
  const cartonCount = items.reduce((sum, item) => sum + item.cartonCount, 0);
  const variantCount = cartonCount > 800 ? 1 : cartonCount > 300 ? 2 : 4;
  for (let variant = 0; variant < variantCount; variant += 1) {
    const candidate = simulateVariant(container, items, normalizedStrategy, variant);
    if (!best || candidate.score > best.score || (candidate.score === best.score && candidate.metrics.loadedCartons > best.metrics.loadedCartons)) best = candidate;
  }
  return best;
}

export function generateLoadingCandidates({ container, items }) {
  return ["max_load", "balanced", "sku_complete"].map((strategy) => simulateContainerLoading({ container, items, strategy }));
}

export function validateContainerPlacements({ container: containerInput, items: itemsInput, placements: placementsInput }) {
  const container = normalizeContainer(containerInput);
  const items = normalizeLoadingItems(itemsInput);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const placements = (Array.isArray(placementsInput) ? placementsInput : []).map((placement, index) => {
    const item = itemById.get(String(placement.itemId));
    if (!item) throw Object.assign(new Error(`第 ${index + 1} 个箱体没有对应的商品明细。`), { statusCode: 400, code: "unknown_item" });
    return {
      ...placement,
      placementId: String(placement.placementId || `${item.id}:${index + 1}`),
      itemId: item.id,
      sku: item.sku,
      productName: item.productName,
      imageUrl: item.imageUrl,
      x: finiteNumber(placement.x),
      y: finiteNumber(placement.y),
      z: finiteNumber(placement.z),
      lengthCm: positive(placement.lengthCm, "箱体长度"),
      widthCm: positive(placement.widthCm, "箱体宽度"),
      heightCm: positive(placement.heightCm, "箱体高度"),
      cartonWeightKg: item.cartonWeightKg,
      unitsPerCarton: item.unitsPerCarton,
      locked: Boolean(placement.locked),
    };
  });
  if (placements.length > MAX_CARTONS) throw Object.assign(new Error("箱体数量超过系统上限。"), { statusCode: 400 });
  const spatialIndex = createSpatialIndex();
  placements.forEach((placement) => spatialIndex.add(placement));
  const seen = new Set();
  for (const placement of placements) {
    if (seen.has(placement.placementId)) throw Object.assign(new Error("箱体编号重复。"), { statusCode: 400, code: "duplicate_placement" });
    seen.add(placement.placementId);
    if (!fits(placement, spatialIndex, container, placement.placementId)) {
      throw Object.assign(new Error(`${placement.sku} 的箱体 ${placement.placementId} 存在碰撞、越界、悬空或无法通过柜门。`), { statusCode: 400, code: "invalid_placement" });
    }
  }
  const sequenced = assignSequence(placements);
  const metrics = calculateLoadingMetrics(container, items, sequenced);
  if (metrics.loadedWeightKg > container.maxPayloadKg + EPSILON) throw Object.assign(new Error("调整后的方案超过集装箱最大载重。"), { statusCode: 400, code: "payload_exceeded" });
  return { placements: sequenced, metrics, warnings: buildWarnings(container, items, metrics, []) };
}
