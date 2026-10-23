import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { calculateLoadingMetrics, generateLoadingCandidates, normalizeContainer, normalizeLoadingItems, validateContainerPlacements } from "./container-loading-engine.js";

export const CONTAINER_TYPES = Object.freeze([
  { code: "20GP", name: "20GP 普柜", lengthCm: 589, widthCm: 235, heightCm: 239, doorWidthCm: 234, doorHeightCm: 228, maxPayloadKg: 28200 },
  { code: "40GP", name: "40GP 普柜", lengthCm: 1203, widthCm: 235, heightCm: 239, doorWidthCm: 234, doorHeightCm: 228, maxPayloadKg: 26700 },
  { code: "40HQ", name: "40HQ 高柜", lengthCm: 1203, widthCm: 235, heightCm: 269, doorWidthCm: 234, doorHeightCm: 258, maxPayloadKg: 26480 },
  { code: "45HQ", name: "45HQ 高柜", lengthCm: 1355, widthCm: 235, heightCm: 269, doorWidthCm: 234, doorHeightCm: 258, maxPayloadKg: 27700 },
]);

function nowIso() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${randomUUID()}`;
}

function businessNo() {
  const date = new Date();
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  return `ZGX-${stamp}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function actorOf(context = {}) {
  return {
    id: String(context.auth?.user?.id || "system"),
    name: String(context.auth?.user?.displayName || context.auth?.user?.username || "系统"),
  };
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function profileFromRow(row) {
  return {
    id: String(row.id),
    sku: String(row.sku),
    profileName: String(row.profile_name),
    unitsPerCarton: number(row.units_per_carton),
    cartonLengthCm: number(row.carton_length_cm),
    cartonWidthCm: number(row.carton_width_cm),
    cartonHeightCm: number(row.carton_height_cm),
    cartonWeightKg: number(row.carton_weight_kg),
    orientation: String(row.orientation || "upright"),
    fragile: Boolean(row.fragile),
    enabled: Boolean(row.enabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function planFromRow(row, includeSnapshot = true) {
  if (!row) return null;
  const snapshot = parseJson(row.snapshot_json, {});
  return {
    id: String(row.id),
    planNo: String(row.plan_no),
    name: String(row.name),
    sourceType: String(row.source_type),
    sourceShipmentId: String(row.source_shipment_id || ""),
    sourceShipmentNo: String(row.source_shipment_no || ""),
    destinationWarehouseId: String(row.destination_warehouse_id || ""),
    destinationWarehouseName: String(row.destination_warehouse_name || ""),
    containerType: String(row.container_type),
    status: String(row.status),
    selectedStrategy: String(row.selected_strategy),
    version: number(row.version, 1),
    confirmedVersion: row.confirmed_version == null ? null : number(row.confirmed_version),
    confirmedAt: String(row.confirmed_at || ""),
    confirmedBy: String(row.confirmed_by || ""),
    createdBy: String(row.created_by),
    createdByName: String(row.created_by_name),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    ...(includeSnapshot ? {
      container: snapshot.container || null,
      items: Array.isArray(snapshot.items) ? snapshot.items : [],
      candidates: Array.isArray(snapshot.candidates) ? snapshot.candidates : [],
      sourceVersion: number(snapshot.sourceVersion),
      warnings: Array.isArray(snapshot.warnings) ? snapshot.warnings : [],
    } : {
      summary: snapshot.summary || {},
    }),
  };
}

function versionFromRow(row) {
  const snapshot = parseJson(row.snapshot_json, {});
  return {
    id: String(row.id),
    planId: String(row.plan_id),
    version: number(row.version),
    versionType: String(row.version_type),
    strategy: String(row.strategy),
    createdBy: String(row.created_by),
    createdByName: String(row.created_by_name),
    createdAt: String(row.created_at),
    metrics: snapshot.metrics || {},
  };
}

function containerByInput(payload) {
  const code = String(payload.containerType || payload.container?.code || "40HQ").toUpperCase();
  const preset = CONTAINER_TYPES.find((item) => item.code === code);
  return normalizeContainer(payload.container && code === "CUSTOM" ? payload.container : (preset || payload.container || CONTAINER_TYPES[2]));
}

function strategyLabel(strategy) {
  return ({ max_load: "最大装载量", balanced: "重量均衡", sku_complete: "SKU完整优先" })[strategy] || strategy;
}

function summarizeSnapshot(snapshot) {
  const selected = snapshot.candidates?.find((candidate) => candidate.strategy === snapshot.selectedStrategy) || snapshot.candidates?.[0] || {};
  return {
    strategy: snapshot.selectedStrategy,
    strategyLabel: strategyLabel(snapshot.selectedStrategy),
    metrics: selected.metrics || {},
    warningCount: Array.isArray(selected.warnings) ? selected.warnings.length : 0,
  };
}

function generateCandidatesWithoutBlocking({ container, items }) {
  const cartonCount = items.reduce((sum, item) => sum + Number(item.cartonCount || 0), 0);
  if (cartonCount < 300) return Promise.resolve(generateLoadingCandidates({ container, items }));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./container-loading-worker.js", import.meta.url), { workerData: { container, items } });
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      void worker.terminate();
      finish(reject, Object.assign(new Error("装柜方案计算超时，请减少箱数后重试。"), { statusCode: 408, code: "calculation_timeout" }));
    }, 60_000);
    worker.once("message", (message) => {
      if (message?.ok) finish(resolve, message.candidates);
      else finish(reject, Object.assign(new Error(message?.error?.message || "装柜方案计算失败。"), message?.error || {}));
    });
    worker.once("error", (error) => finish(reject, error));
    worker.once("exit", (code) => {
      if (!settled && code !== 0) finish(reject, Object.assign(new Error("装柜计算线程异常退出。"), { statusCode: 500, code: "worker_exit" }));
    });
  });
}

export function createContainerLoadingService({ store, stockupService }) {
  function canSeeRow(row, context) {
    const actor = actorOf(context);
    if (!context.viewAll && String(row.created_by) !== actor.id) return false;
    if (context.warehouseIds?.length && row.destination_warehouse_id && !context.warehouseIds.includes(String(row.destination_warehouse_id))) return false;
    if (context.skus?.length) {
      const snapshot = parseJson(row.snapshot_json, {});
      const allowed = new Set(context.skus.map((sku) => String(sku).toUpperCase()));
      if ((snapshot.items || []).some((item) => !allowed.has(String(item.sku || "").toUpperCase()))) return false;
    }
    if (context.countries?.length && row.source_shipment_id) {
      try {
        stockupService.getShipment(String(row.source_shipment_id), context);
      } catch {
        return false;
      }
    }
    return true;
  }

  function visiblePlanRow(planId, context) {
    const row = store.first("SELECT * FROM container_loading_plans WHERE id=?", [String(planId)]);
    if (!row || !canSeeRow(row, context)) throw Object.assign(new Error("未找到装柜方案或当前账号无权查看。"), { statusCode: 404, code: "plan_not_found" });
    return row;
  }

  function listPlans(filters = {}, context = {}) {
    const rows = store.all("SELECT * FROM container_loading_plans ORDER BY updated_at DESC LIMIT 200")
      .filter((row) => canSeeRow(row, context))
      .filter((row) => !filters.status || String(row.status) === String(filters.status))
      .filter((row) => !filters.shipmentId || String(row.source_shipment_id || "") === String(filters.shipmentId));
    return { ok: true, plans: rows.map((row) => planFromRow(row, false)) };
  }

  function getPlan(planId, context = {}) {
    const row = visiblePlanRow(planId, context);
    return {
      ok: true,
      plan: planFromRow(row),
      versions: store.all("SELECT * FROM container_loading_plan_versions WHERE plan_id=? ORDER BY version DESC LIMIT 50", [String(planId)]).map(versionFromRow),
    };
  }

  function listProfiles(context = {}) {
    const actor = actorOf(context);
    const profiles = store.all("SELECT * FROM container_packaging_profiles WHERE enabled=1 ORDER BY sku,profile_name")
      .filter((row) => context.viewAll || String(row.created_by) === actor.id)
      .filter((row) => !context.skus?.length || context.skus.includes(String(row.sku).toUpperCase()))
      .map(profileFromRow);
    return profiles;
  }

  function shipmentOptions(context = {}) {
    return stockupService.listShipments({}, context).shipments
      .filter((shipment) => !["cancelled"].includes(shipment.status))
      .map((shipment) => ({
        id: shipment.id,
        shipmentNo: shipment.shipmentNo,
        destinationWarehouseId: shipment.destinationWarehouseId,
        destinationWarehouseName: shipment.destinationWarehouseName,
        destinationCountry: shipment.destinationCountry,
        status: shipment.status,
        version: shipment.version,
        packages: shipment.packages,
        totalWeightKg: shipment.totalWeightKg,
        totalVolumeM3: shipment.totalVolumeM3,
        lines: (shipment.lines || []).map((line) => ({
          id: line.id,
          sku: line.sku,
          productName: line.productName,
          imageUrl: line.imageUrl,
          cartonCount: line.cartonCount,
          unitsPerCarton: line.unitsPerCarton,
          cartonLengthCm: line.cartonLengthCm,
          cartonWidthCm: line.cartonWidthCm,
          cartonHeightCm: line.cartonHeightCm,
          cartonWeightKg: line.cartonWeightKg,
          orientation: "upright",
          priority: 5,
        })),
      }));
  }

  function bootstrap(context = {}) {
    return {
      ok: true,
      containerTypes: CONTAINER_TYPES,
      shipments: shipmentOptions(context),
      plans: listPlans({}, context).plans,
      packagingProfiles: listProfiles(context),
      limits: { maxCartons: 2000, detailedRenderCartons: 1500 },
    };
  }

  function applyProfiles(items) {
    const profiles = listProfiles({ viewAll: true, auth: { user: { id: "system" } } });
    const bySku = new Map(profiles.map((profile) => [profile.sku.toUpperCase(), profile]));
    return (Array.isArray(items) ? items : []).map((item) => {
      const profile = bySku.get(String(item.sku || "").trim().toUpperCase());
      if (!profile) return item;
      return {
        ...profile,
        ...item,
        unitsPerCarton: number(item.unitsPerCarton) > 0 ? item.unitsPerCarton : profile.unitsPerCarton,
        cartonLengthCm: number(item.cartonLengthCm) > 0 ? item.cartonLengthCm : profile.cartonLengthCm,
        cartonWidthCm: number(item.cartonWidthCm) > 0 ? item.cartonWidthCm : profile.cartonWidthCm,
        cartonHeightCm: number(item.cartonHeightCm) > 0 ? item.cartonHeightCm : profile.cartonHeightCm,
        cartonWeightKg: number(item.cartonWeightKg) > 0 ? item.cartonWeightKg : profile.cartonWeightKg,
      };
    });
  }

  function sourceFor(payload, context) {
    const sourceShipmentId = String(payload.sourceShipmentId || "");
    if (!sourceShipmentId) return { sourceType: "manual", sourceShipmentId: "", sourceShipmentNo: "", destinationWarehouseId: "", destinationWarehouseName: "", sourceVersion: 0, items: payload.items };
    const shipment = stockupService.getShipment(sourceShipmentId, context);
    return {
      sourceType: "shipment",
      sourceShipmentId: shipment.id,
      sourceShipmentNo: shipment.shipmentNo,
      destinationWarehouseId: shipment.destinationWarehouseId,
      destinationWarehouseName: shipment.destinationWarehouseName,
      sourceVersion: shipment.version,
      items: Array.isArray(payload.items) && payload.items.length ? payload.items : shipment.lines,
    };
  }

  function saveProfiles(items, context) {
    const actor = actorOf(context);
    const now = nowIso();
    for (const item of items) {
      store.run(`INSERT INTO container_packaging_profiles (id,sku,profile_name,units_per_carton,carton_length_cm,carton_width_cm,carton_height_cm,carton_weight_kg,orientation,fragile,enabled,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?)
        ON CONFLICT(sku,profile_name) DO UPDATE SET units_per_carton=excluded.units_per_carton,carton_length_cm=excluded.carton_length_cm,carton_width_cm=excluded.carton_width_cm,carton_height_cm=excluded.carton_height_cm,carton_weight_kg=excluded.carton_weight_kg,orientation=excluded.orientation,fragile=excluded.fragile,enabled=1,updated_at=excluded.updated_at`,
      [id("cpp"), item.sku, "默认箱规", item.unitsPerCarton, item.cartonLengthCm, item.cartonWidthCm, item.cartonHeightCm, item.cartonWeightKg, item.orientation, item.fragile ? 1 : 0, actor.id, now, now]);
    }
  }

  async function calculatePreview(payload, context = {}) {
    const source = sourceFor(payload, context);
    const container = containerByInput(payload);
    const items = normalizeLoadingItems(applyProfiles(source.items));
    const candidates = await generateCandidatesWithoutBlocking({ container, items });
    const selectedStrategy = ["max_load", "balanced", "sku_complete"].includes(String(payload.selectedStrategy))
      ? String(payload.selectedStrategy)
      : "max_load";
    return {
      ok: true,
      preview: true,
      sourceType: source.sourceType,
      sourceShipmentId: source.sourceShipmentId,
      sourceShipmentNo: source.sourceShipmentNo,
      destinationWarehouseId: source.destinationWarehouseId,
      destinationWarehouseName: source.destinationWarehouseName,
      sourceVersion: source.sourceVersion,
      container,
      items,
      candidates,
      selectedStrategy,
      calculatedAt: nowIso(),
    };
  }

  async function createPlan(payload, context = {}) {
    const actor = actorOf(context);
    const source = sourceFor(payload, context);
    const container = containerByInput(payload);
    const items = normalizeLoadingItems(applyProfiles(source.items));
    const candidates = await generateCandidatesWithoutBlocking({ container, items });
    const selectedStrategy = ["max_load", "balanced", "sku_complete"].includes(String(payload.selectedStrategy)) ? String(payload.selectedStrategy) : "max_load";
    const planId = id("clp");
    const planNo = businessNo();
    const now = nowIso();
    const snapshot = { container, items, candidates, selectedStrategy, sourceVersion: source.sourceVersion, summary: {} };
    snapshot.summary = summarizeSnapshot(snapshot);
    return store.transaction(() => {
      if (payload.savePackagingProfiles !== false) saveProfiles(items, context);
      store.run(`INSERT INTO container_loading_plans (id,plan_no,name,source_type,source_shipment_id,source_shipment_no,destination_warehouse_id,destination_warehouse_name,container_type,status,selected_strategy,version,snapshot_json,created_by,created_by_name,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,'draft',?,1,?,?,?,?,?)`,
      [planId, planNo, String(payload.name || `${source.sourceShipmentNo || "自由模拟"} ${container.code}`), source.sourceType, source.sourceShipmentId, source.sourceShipmentNo, source.destinationWarehouseId, source.destinationWarehouseName, container.code, selectedStrategy, JSON.stringify(snapshot), actor.id, actor.name, now, now]);
      const selected = candidates.find((candidate) => candidate.strategy === selectedStrategy) || candidates[0];
      store.run("INSERT INTO container_loading_plan_versions (id,plan_id,version,version_type,strategy,snapshot_json,created_by,created_by_name,created_at) VALUES (?,?,1,'generated',?,?,?,?,?)",
        [id("clv"), planId, selectedStrategy, JSON.stringify(selected), actor.id, actor.name, now]);
      return getPlan(planId, context);
    });
  }

  function assertExpectedVersion(row, expectedVersion) {
    if (expectedVersion == null || number(expectedVersion) === number(row.version)) return;
    const latest = planFromRow(row);
    throw Object.assign(new Error("装柜方案已被其他人更新，请刷新后重试。"), { statusCode: 409, code: "version_conflict", latest });
  }

  function saveVersion(planId, payload, context = {}) {
    const row = visiblePlanRow(planId, context);
    assertExpectedVersion(row, payload.expectedVersion);
    if (["confirmed", "loaded", "voided"].includes(String(row.status))) throw Object.assign(new Error("已确认、已装柜或已作废的方案不能直接修改，请重新生成方案。"), { statusCode: 409, code: "plan_locked" });
    const current = parseJson(row.snapshot_json, {});
    const strategy = ["max_load", "balanced", "sku_complete"].includes(String(payload.strategy)) ? String(payload.strategy) : String(current.selectedStrategy || row.selected_strategy);
    const existing = current.candidates.find((candidate) => candidate.strategy === strategy);
    if (!existing) throw Object.assign(new Error("未找到对应的候选方案。"), { statusCode: 400 });
    const validated = validateContainerPlacements({ container: current.container, items: current.items, placements: payload.placements || existing.placements });
    const candidate = { ...existing, ...validated, score: existing.score, manuallyAdjusted: true };
    const candidates = current.candidates.map((item) => item.strategy === strategy ? candidate : item);
    const snapshot = { ...current, candidates, selectedStrategy: strategy };
    snapshot.summary = summarizeSnapshot(snapshot);
    const actor = actorOf(context);
    const now = nowIso();
    const version = number(row.version, 1) + 1;
    return store.transaction(() => {
      store.run("UPDATE container_loading_plans SET selected_strategy=?,version=?,snapshot_json=?,updated_at=? WHERE id=?", [strategy, version, JSON.stringify(snapshot), now, String(planId)]);
      store.run("INSERT INTO container_loading_plan_versions (id,plan_id,version,version_type,strategy,snapshot_json,created_by,created_by_name,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        [id("clv"), String(planId), version, payload.versionType === "selection" ? "selection" : "manual_adjustment", strategy, JSON.stringify(candidate), actor.id, actor.name, now]);
      return getPlan(planId, context);
    });
  }

  async function recalculate(planId, payload, context = {}) {
    const row = visiblePlanRow(planId, context);
    assertExpectedVersion(row, payload.expectedVersion);
    if (["confirmed", "loaded", "voided"].includes(String(row.status))) throw Object.assign(new Error("当前方案状态不能重新计算。"), { statusCode: 409 });
    const current = parseJson(row.snapshot_json, {});
    const container = payload.container ? normalizeContainer(payload.container) : current.container;
    const items = normalizeLoadingItems(applyProfiles(payload.items || current.items));
    const candidates = await generateCandidatesWithoutBlocking({ container, items });
    const selectedStrategy = String(payload.selectedStrategy || current.selectedStrategy || "max_load");
    const snapshot = { ...current, container, items, candidates, selectedStrategy };
    snapshot.summary = summarizeSnapshot(snapshot);
    const actor = actorOf(context);
    const now = nowIso();
    const version = number(row.version, 1) + 1;
    const selected = candidates.find((candidate) => candidate.strategy === selectedStrategy) || candidates[0];
    return store.transaction(() => {
      if (payload.savePackagingProfiles !== false) saveProfiles(items, context);
      store.run("UPDATE container_loading_plans SET container_type=?,selected_strategy=?,version=?,snapshot_json=?,updated_at=? WHERE id=?", [container.code, selectedStrategy, version, JSON.stringify(snapshot), now, String(planId)]);
      store.run("INSERT INTO container_loading_plan_versions (id,plan_id,version,version_type,strategy,snapshot_json,created_by,created_by_name,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        [id("clv"), String(planId), version, "recalculated", selectedStrategy, JSON.stringify(selected), actor.id, actor.name, now]);
      return getPlan(planId, context);
    });
  }

  function confirmPlan(planId, payload, context = {}) {
    const row = visiblePlanRow(planId, context);
    assertExpectedVersion(row, payload.expectedVersion);
    if (row.status === "voided") throw Object.assign(new Error("已作废方案不能确认。"), { statusCode: 409 });
    const current = parseJson(row.snapshot_json, {});
    const strategy = String(payload.strategy || current.selectedStrategy || row.selected_strategy);
    const candidate = current.candidates.find((item) => item.strategy === strategy);
    if (!candidate?.placements?.length) throw Object.assign(new Error("当前方案没有可确认的装载结果。"), { statusCode: 409 });
    if (row.source_shipment_id) {
      const shipment = stockupService.getShipment(String(row.source_shipment_id), context);
      if (number(shipment.version) !== number(current.sourceVersion)) {
        throw Object.assign(new Error("来源发运单已经变化，请重新计算装柜方案后再确认。"), { statusCode: 409, code: "source_changed" });
      }
    }
    const actor = actorOf(context);
    const now = nowIso();
    const nextVersion = number(row.version, 1) + 1;
    const snapshot = { ...current, selectedStrategy: strategy };
    snapshot.summary = summarizeSnapshot(snapshot);
    return store.transaction(() => {
      store.run("UPDATE container_loading_plans SET status='confirmed',selected_strategy=?,version=?,confirmed_version=?,confirmed_at=?,confirmed_by=?,snapshot_json=?,updated_at=? WHERE id=?",
        [strategy, nextVersion, nextVersion, now, actor.name, JSON.stringify(snapshot), now, String(planId)]);
      store.run("INSERT INTO container_loading_plan_versions (id,plan_id,version,version_type,strategy,snapshot_json,created_by,created_by_name,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        [id("clv"), String(planId), nextVersion, "confirmed", strategy, JSON.stringify(candidate), actor.id, actor.name, now]);
      return getPlan(planId, context);
    });
  }

  function voidPlan(planId, payload, context = {}) {
    const row = visiblePlanRow(planId, context);
    assertExpectedVersion(row, payload.expectedVersion);
    if (row.status === "voided") return getPlan(planId, context);
    const actor = actorOf(context);
    const now = nowIso();
    const version = number(row.version, 1) + 1;
    const snapshot = parseJson(row.snapshot_json, {});
    snapshot.voidReason = String(payload.reason || "手工作废");
    return store.transaction(() => {
      store.run("UPDATE container_loading_plans SET status='voided',version=?,snapshot_json=?,updated_at=? WHERE id=?", [version, JSON.stringify(snapshot), now, String(planId)]);
      store.run("INSERT INTO container_loading_plan_versions (id,plan_id,version,version_type,strategy,snapshot_json,created_by,created_by_name,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        [id("clv"), String(planId), version, "voided", String(row.selected_strategy), JSON.stringify({ reason: snapshot.voidReason, metrics: summarizeSnapshot(snapshot).metrics }), actor.id, actor.name, now]);
      return getPlan(planId, context);
    });
  }

  return { bootstrap, calculatePreview, confirmPlan, createPlan, getPlan, listPlans, recalculate, saveVersion, voidPlan };
}
