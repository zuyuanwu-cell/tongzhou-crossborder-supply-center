import { createHash, randomUUID } from "node:crypto";
import { collaborationProjectionSchema, internalPartnerTaskSchema, internalWarehouseTaskSchema, inventoryProjectionSchema, oemProjectionSchema, partnerOrderProjectionSchema } from "../collaboration/shared/contracts.js";
import {
  inferOutsourcingFactoryBinding,
  isActiveOutsourcingStatus,
  outsourcingFactoryOptions,
  outsourcingOrderIdentity,
  outsourcingProjectionFingerprint,
  outsourcingProjectionFromRecord,
  purchaseOrderIdentity,
  purchaseProjectionFromRecord,
} from "./collaboration-outsourcing-source.js";

const systemUser = Object.freeze({
  id: "collaboration-bridge",
  username: "collaboration-bridge",
  displayName: "外部协同桥接",
  role: "admin",
  roleLabel: "系统集成",
});

function systemInventoryContext() {
  return { auth: { role: "admin", user: systemUser }, warehouseIds: [], countries: [], skus: [] };
}

function systemStockupContext() {
  return { ...systemInventoryContext(), viewAll: true, viewCost: true, revealSupplier: true };
}

function fail(message, statusCode = 400, code = "invalid_request") {
  throw Object.assign(new Error(message), { statusCode, code });
}

function nowIso() {
  return new Date().toISOString();
}

function retryAt(attemptCount) {
  const delay = Math.min(15 * 60_000, 2 ** Math.min(10, Math.max(0, attemptCount)) * 2_000);
  return new Date(Date.now() + delay).toISOString();
}

function projectionId(prefix = "collab") {
  return `${prefix}-${Date.now().toString(36)}-${randomUUID()}`;
}

function safeJson(value) {
  try { return JSON.parse(value); }
  catch { fail("协同桥接记录损坏，无法解析。", 500, "invalid_bridge_record"); }
}

function productLookup(products = []) {
  return new Map(products.map((item) => [String(item.sku || "").replace(/\s+/g, "").toUpperCase(), item]));
}

function publicImageUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" && url.href.length <= 2_000 ? url.href : "";
  } catch {
    return "";
  }
}

function normalizedSku(value) {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function inventoryProjectionStateKey(organizationCode, warehouseRef) {
  return `inventory_projection:${organizationCode}:${warehouseRef}`;
}

function inventoryProjectionVersion(previous = 0) {
  // Keep the value inside PostgreSQL int4 while remaining monotonic across restarts.
  const secondsSince2020 = Math.floor((Date.now() - Date.UTC(2020, 0, 1)) / 1_000);
  return Math.max(Number(previous || 0) + 1, secondsSince2020, 1);
}

function collaborationProjectionVersion() {
  return Math.max(1, Math.floor((Date.now() - Date.UTC(2020, 0, 1)) / 1_000));
}

function generatedSamplingDocumentNo(sampleCategory) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const day = `${value.year}${value.month}${value.day}`;
  return `DY-${sampleCategory === "packaging" ? "BC" : "LT"}-${day}-${randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase()}`;
}

function inventoryFingerprint(warehouseName, items) {
  return createHash("sha256").update(JSON.stringify({ warehouseName, items })).digest("hex");
}

function storedInventoryProjectionState(store, key) {
  try {
    const value = JSON.parse(store.state(key, "{}"));
    return { fingerprint: String(value.fingerprint || ""), version: Number(value.version || 0) };
  } catch {
    return { fingerprint: "", version: 0 };
  }
}

function parsedState(store, key, fallback) {
  try { return JSON.parse(store.state(key, JSON.stringify(fallback))); }
  catch { return fallback; }
}

function outsourcingBindingStateKey(organizationCode) {
  return `outsourcing_binding:${organizationCode}`;
}

function outsourcingTrackedStateKey(organizationCode) {
  return `outsourcing_tracked:${organizationCode}`;
}

function outsourcingProjectionStateKey(organizationCode, orderNo) {
  return `outsourcing_projection:${organizationCode}:${createHash("sha256").update(String(orderNo)).digest("hex").slice(0, 24)}`;
}

function purchaseProjectionStateKey(organizationCode, orderNo) {
  return `purchase_projection:${organizationCode}:${createHash("sha256").update(String(orderNo)).digest("hex").slice(0, 24)}`;
}

export function createCollaborationBridge({
  store,
  domesticInventoryService,
  stockupCollaborationService,
  listProducts = () => [],
  baseUrl = process.env.COLLABORATION_API_BASE_URL || "http://127.0.0.1:8790",
  internalToken = process.env.COLLABORATION_INTERNAL_TOKEN || (process.env.NODE_ENV === "production" ? "" : "local-internal-token-change-me"),
  pollIntervalMs = Number(process.env.COLLABORATION_BRIDGE_POLL_MS || 10_000),
  inventorySyncIntervalMs = Number(process.env.COLLABORATION_INVENTORY_SYNC_MS || 60_000),
  outsourcingSyncIntervalMs = Number(process.env.COLLABORATION_OUTSOURCING_SYNC_MS || 5 * 60_000),
  listActiveOutsourcingOrders = async () => [],
  listOutsourcingFactoryOrders = async () => [],
  listFirstArticleRecords = async () => [],
  listCraftOrderRecords = async () => [],
  listOutsourcingPurchaseDocuments = async () => ({ purchaseRecords: [], inboundRecords: [] }),
  recordOutsourcingPartnerFeedback = async () => ({ ok: true, skipped: true }),
  requestTimeoutMs = Number(process.env.COLLABORATION_BRIDGE_TIMEOUT_MS || 15_000),
  oemEnabled = process.env.COLLABORATION_OEM_ENABLED === "true",
  publicOrigin = process.env.COLLABORATION_PUBLIC_ORIGIN || "https://partner.tongzhoukuajing.com",
  fetchImpl = globalThis.fetch,
  onAudit = () => {},
} = {}) {
  const normalizedBaseUrl = String(baseUrl || "").replace(/\/$/, "");
  const enabled = Boolean(normalizedBaseUrl && internalToken && fetchImpl);
  let timer = null;
  let running = false;
  let lastError = "";
  let factoryOptionsCache = { loadedAt: 0, options: [] };

  async function internalRequest(path, { method = "GET", body, rawBody, headers = {}, raw = false } = {}) {
    if (!enabled) fail("协同桥接尚未配置。", 503, "collaboration_bridge_disabled");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetchImpl(`${normalizedBaseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${internalToken}`,
          ...(body === undefined || rawBody !== undefined ? {} : { "Content-Type": "application/json" }),
          ...headers,
        },
        body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        fail(payload.message || `协同 API 返回 ${response.status}`, response.status, payload.code || "collaboration_api_error");
      }
      if (raw) return response;
      return response.json().catch(() => ({}));
    } finally {
      clearTimeout(timeout);
    }
  }

  function queueProjection(input) {
    const withId = { ...input, eventId: input.eventId || projectionId("projection") };
    const projection = collaborationProjectionSchema.parse(withId);
    const row = store.enqueue({ id: projection.eventId, eventType: "projection", payload: projection, now: nowIso() });
    const stored = safeJson(row.payload_json);
    delete stored._delivery;
    if (JSON.stringify(stored) !== JSON.stringify(projection)) fail("Idempotency-Key 已用于其他协同任务。", 409, "idempotency_key_conflict");
    return { id: row.id, status: row.status, projection, idempotentReplay: row.status !== "pending" || row.created_at !== row.next_attempt_at };
  }

  function queueInventoryProjection(input) {
    const withId = { ...input, eventId: input.eventId || projectionId("inventory") };
    const projection = inventoryProjectionSchema.parse(withId);
    const row = store.enqueue({ id: projection.eventId, eventType: "inventory", payload: projection, now: nowIso() });
    return { id: row.id, status: row.status, projection };
  }

  function inventoryProjectionForGrant(organizationCode, grant) {
    if (!domesticInventoryService?.list) fail("国内库存服务不可用。", 503, "domestic_inventory_unavailable");
    const payload = domesticInventoryService.list({ warehouseId: grant.resourceRef }, systemInventoryContext());
    const warehouse = (payload.warehouses || []).find((item) => String(item.id) === String(grant.resourceRef));
    if (!warehouse) fail(`授权仓库不存在：${grant.resourceRef}`, 409, "granted_warehouse_not_found");
    const catalog = productLookup(listProducts());
    const items = (payload.balances || []).map((item) => {
      const sku = String(item.sku || "").replace(/\s+/g, "").toUpperCase();
      const product = catalog.get(sku) || {};
      return {
        sku,
        productName: String(item.productName || product.name || product.productName || item.sku || "").trim(),
        barcode: String(item.barcode || product.barcode || "").trim().slice(0, 160),
        imageUrl: publicImageUrl(item.imageUrl || product.imageUrl),
        availableQuantity: Math.max(0, Number(item.availableQty || 0)),
        lockedQuantity: Math.max(0, Number(item.reservedQty || 0)),
        inTransitQuantity: 0,
        unit: String(item.unit || product.unit || "件").trim() || "件",
      };
    }).filter((item) => item.sku && item.productName).sort((left, right) => left.sku.localeCompare(right.sku));
    const warehouseName = String(warehouse.name || grant.resourceName || grant.resourceRef).trim();
    const stateKey = inventoryProjectionStateKey(organizationCode, grant.resourceRef);
    const previous = storedInventoryProjectionState(store, stateKey);
    const fingerprint = inventoryFingerprint(warehouseName, items);
    return { fingerprint, items, previous, stateKey, warehouseName };
  }

  async function synchronizeInventoryProjections({ force = false, organizationCode = "" } = {}) {
    if (!enabled) return { scannedOrganizations: 0, queued: 0, unchanged: 0, failed: 0, disabled: true };
    const organizations = organizationCode
      ? [{ code: organizationCode, organizationType: "warehouse", status: "active" }]
      : (await listOrganizations({ status: "active" })).organizations || [];
    let queued = 0;
    let unchanged = 0;
    let failed = 0;
    const errors = [];
    for (const organization of organizations.filter((item) => item.status !== "suspended" && item.status !== "archived")) {
      try {
        const access = await getOrganizationAccessGrants(organization.code);
        const grants = (access.grants || []).filter((grant) => grant.resourceType === "warehouse" && grant.permissions?.includes("warehouse.inventory.view"));
        for (const grant of grants) {
          try {
            const snapshot = inventoryProjectionForGrant(organization.code, grant);
            if (!force && snapshot.previous.fingerprint === snapshot.fingerprint) {
              unchanged += 1;
              continue;
            }
            const version = inventoryProjectionVersion(snapshot.previous.version);
            queueInventoryProjection({
              organizationCode: organization.code,
              warehouseRef: grant.resourceRef,
              warehouseName: snapshot.warehouseName,
              version,
              syncedAt: nowIso(),
              items: snapshot.items,
            });
            store.setState(snapshot.stateKey, JSON.stringify({ fingerprint: snapshot.fingerprint, version }), nowIso());
            queued += 1;
          } catch (error) {
            failed += 1;
            errors.push(`${organization.code}/${grant.resourceRef}: ${error.message}`);
          }
        }
      } catch (error) {
        failed += 1;
        errors.push(`${organization.code}: ${error.message}`);
      }
    }
    if (!failed) store.setState("inventory_projection_last_scan_at", nowIso(), nowIso());
    return { scannedOrganizations: organizations.length, queued, unchanged, failed, disabled: false, errors };
  }

  function inventoryProjectionSyncDue() {
    const lastScan = Date.parse(store.state("inventory_projection_last_scan_at"));
    return !Number.isFinite(lastScan) || Date.now() - lastScan >= Math.max(10_000, inventorySyncIntervalMs);
  }

  async function listWarehouseTaskOptions({ warehouseIds = [], skus = [] } = {}) {
    const allowedWarehouses = new Set((warehouseIds || []).map(String).filter(Boolean));
    const allowedSkus = new Set((skus || []).map(normalizedSku).filter(Boolean));
    const response = await listOrganizations({ status: "active" });
    const warehouseOrganizations = (response.organizations || []).filter((organization) => organization.status === "active");
    const organizations = [];
    const availability = new Map();
    const warnings = [];
    for (const organization of warehouseOrganizations) {
      const access = await getOrganizationAccessGrants(organization.code);
      const warehouses = [];
      for (const grant of (access.grants || []).filter((item) => item.resourceType === "warehouse" && item.permissions?.includes("warehouse.task.view"))) {
        if (allowedWarehouses.size && !allowedWarehouses.has(String(grant.resourceRef))) continue;
        let snapshot;
        try {
          snapshot = inventoryProjectionForGrant(organization.code, grant);
        } catch (error) {
          if (error?.code !== "granted_warehouse_not_found") throw error;
          warnings.push(`协同组织 ${organization.name || organization.code} 仍绑定已移除仓库 ${grant.resourceRef}，已从发布选项中排除。`);
          continue;
        }
        warehouses.push({
          resourceRef: grant.resourceRef,
          resourceName: snapshot.warehouseName,
          permissions: grant.permissions || [],
          skuCount: snapshot.items.length,
          updatedAt: snapshot.items.reduce((latest, item) => item.updatedAt > latest ? item.updatedAt : latest, ""),
        });
        if (!availability.has(String(grant.resourceRef))) availability.set(String(grant.resourceRef), new Map());
        for (const item of snapshot.items) availability.get(String(grant.resourceRef)).set(normalizedSku(item.sku), Number(item.availableQuantity || 0));
      }
      if (warehouses.length) organizations.push({ code: organization.code, name: organization.name, warehouses });
    }
    const bySku = new Map();
    for (const item of listProducts()) {
      const sku = normalizedSku(item.sku || item.skuNo || item.countrySku);
      if (!sku || (allowedSkus.size && !allowedSkus.has(sku)) || bySku.has(sku)) continue;
      bySku.set(sku, {
        sku,
        productName: String(item.name || item.productName || sku).trim(),
        imageUrl: publicImageUrl(item.imageUrl),
        unit: String(item.unit || "件").trim() || "件",
        availableByWarehouse: Object.fromEntries([...availability.entries()].map(([warehouseRef, balances]) => [warehouseRef, Number(balances.get(sku) || 0)])),
      });
    }
    return {
      ok: true,
      portalUrl: String(publicOrigin || "").replace(/\/$/, ""),
      organizations,
      products: [...bySku.values()].sort((left, right) => left.sku.localeCompare(right.sku, "zh-CN", { numeric: true })),
      warnings,
    };
  }

  async function publishWarehouseTask(input, { idempotencyKey = "", actorName = "供应链中台", warehouseIds = [], skus = [] } = {}) {
    const parsed = internalWarehouseTaskSchema.safeParse(input);
    if (!parsed.success) fail(parsed.error.issues[0]?.message || "协同任务内容不正确。", 400, "invalid_task_payload");
    const safeKey = String(idempotencyKey || "").trim();
    if (!safeKey || safeKey.length > 160) fail("请提供有效的 Idempotency-Key。", 400, "idempotency_key_required");
    const options = await listWarehouseTaskOptions({ warehouseIds, skus });
    const organization = options.organizations.find((item) => item.code === parsed.data.organizationCode);
    if (!organization) fail("目标协同组织不存在、已停用或不在当前账号范围内。", 404, "organization_not_available");
    const warehouse = organization.warehouses.find((item) => String(item.resourceRef) === parsed.data.warehouseRef);
    if (!warehouse) fail("目标仓库未授权给该协同组织或不在当前账号范围内。", 403, "warehouse_not_granted");
    const products = new Map(options.products.map((item) => [item.sku, item]));
    const lines = parsed.data.lines.map((line) => {
      const sku = normalizedSku(line.sku);
      const product = products.get(sku);
      if (!product) fail(`SKU ${sku} 不存在或不在当前账号范围内。`, 400, "product_not_available");
      if (parsed.data.itemType === "warehouse_outbound" && Number(line.plannedQuantity) > Number(product.availableByWarehouse[parsed.data.warehouseRef] || 0)) {
        fail(`${sku} 可用库存不足，当前可用 ${Number(product.availableByWarehouse[parsed.data.warehouseRef] || 0)} ${product.unit}。`, 409, "insufficient_projected_stock");
      }
      return {
        sourceLineId: String(line.sourceLineId || ""),
        sku,
        productName: product.productName,
        imageUrl: product.imageUrl,
        barcode: product.barcode,
        plannedQuantity: Number(line.plannedQuantity),
        completedQuantity: 0,
        unit: String(line.unit || product.unit || "件"),
      };
    });
    if (new Set(lines.map((line) => line.sku)).size !== lines.length) fail("同一 SKU 不能重复添加。", 400, "duplicate_sku");
    const digest = createHash("sha256").update(safeKey).digest("hex").slice(0, 10).toUpperCase();
    const taskDate = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const coreRefId = parsed.data.coreRefId || `CWT-${taskDate}-${digest}`;
    const eventId = `warehouse-task-${digest.toLowerCase()}-${taskDate}`;
    const referenceNo = parsed.data.referenceNo || coreRefId;
    const queued = queueProjection({
      eventId,
      organizationCode: organization.code,
      coreRefType: parsed.data.coreRefType || "internal_warehouse_task",
      coreRefId,
      itemType: parsed.data.itemType,
      title: parsed.data.title,
      description: parsed.data.description,
      priority: parsed.data.priority,
      status: "pending",
      dueAt: parsed.data.dueAt,
      version: 1,
      publicPayload: {
        referenceNo,
        warehouseRef: warehouse.resourceRef,
        warehouseName: warehouse.resourceName,
        note: parsed.data.description.slice(0, 2_000),
        ...(parsed.data.workOrder ? { workOrder: parsed.data.workOrder } : {}),
      },
      lines,
    });
    const delivery = await flushOutbox();
    onAudit("发布伙伴协同任务", { id: eventId, organizationCode: organization.code, coreRefId, commandType: "publish", submittedByName: actorName }, { status: queued.status, delivery });
    return { ok: true, eventId, coreRefId, referenceNo, status: queued.status, idempotentReplay: queued.idempotentReplay, delivery };
  }

  function listWarehouseTasks(filters = {}, { warehouseIds = [], skus = [] } = {}) {
    const query = new URLSearchParams({ warehouseOnly: "true" });
    for (const key of ["organizationCode", "status", "itemType", "keyword", "overdue", "limit", "offset"]) {
      if (filters[key] !== undefined && String(filters[key]).trim()) query.set(key, String(filters[key]));
    }
    if (warehouseIds.length) query.set("warehouseRefs", warehouseIds.map(String).filter(Boolean).join(","));
    if (skus.length) query.set("skus", skus.map(normalizedSku).filter(Boolean).join(","));
    const queryString = query.toString();
    return internalRequest(`/collaboration/internal/v1/work-items${queryString ? `?${queryString}` : ""}`);
  }

  function assertWarehouseTaskScope(detail, { warehouseIds = [], skus = [] } = {}) {
    if (!String(detail?.item?.itemType || "").startsWith("warehouse_")) fail("该任务不属于仓库协同范围。", 403, "warehouse_task_type_denied");
    const allowedWarehouses = new Set(warehouseIds.map(String).filter(Boolean));
    const allowedSkus = new Set(skus.map(normalizedSku).filter(Boolean));
    if (allowedWarehouses.size && !allowedWarehouses.has(String(detail?.item?.publicPayload?.warehouseRef || ""))) fail("当前账号无权查看该仓库的协同任务。", 403, "warehouse_scope_denied");
    const taskLines = Array.isArray(detail?.lines) ? detail.lines : [];
    const hasUnauthorizedSku = !taskLines.length || taskLines.some((line) => !allowedSkus.has(normalizedSku(line.sku)));
    if (allowedSkus.size && hasUnauthorizedSku) fail("当前账号无权查看该任务中的商品范围。", 403, "sku_scope_denied");
    return detail;
  }

  async function getWarehouseTask(workItemId, scopes = {}) {
    return assertWarehouseTaskScope(await internalRequest(`/collaboration/internal/v1/work-items/${encodeURIComponent(workItemId)}`), scopes);
  }

  async function remindWarehouseTask(workItemId, { note = "", actorName = "供应链中台" } = {}, scopes = {}) {
    const detail = await getWarehouseTask(workItemId, scopes);
    if (["completed", "rejected", "cancelled"].includes(detail.item.status)) fail("已结束的协同任务无需催办。", 409, "work_item_closed");
    return internalRequest(`/collaboration/internal/v1/work-items/${encodeURIComponent(workItemId)}/remind`, {
      method: "POST",
      body: { note: String(note || "").trim().slice(0, 1_000), actorName: String(actorName || "供应链中台").trim().slice(0, 120) },
    });
  }

  async function downloadWarehouseTaskAttachment(workItemId, attachmentId, scopes = {}) {
    await getWarehouseTask(workItemId, scopes);
    const response = await internalRequest(`/collaboration/internal/v1/work-items/${encodeURIComponent(workItemId)}/attachments/${encodeURIComponent(attachmentId)}`, { raw: true });
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") || "application/octet-stream",
      contentDisposition: response.headers.get("content-disposition") || "attachment",
    };
  }

  function queueOemProjection(input) {
    if (!oemEnabled) fail("OEM 协同尚未通过国内仓试点上线门禁。", 403, "feature_disabled");
    const withId = { ...input, eventId: input.eventId || projectionId("oem") };
    const projection = oemProjectionSchema.parse(withId);
    const row = store.enqueue({ id: projection.eventId, eventType: "oem", payload: projection, now: nowIso() });
    return { id: row.id, status: row.status, projection };
  }

  function queuePartnerOrderProjection(input) {
    if (!oemEnabled) fail("生产与采购伙伴协同尚未启用。", 403, "feature_disabled");
    const withId = { ...input, eventId: input.eventId || projectionId("partner-order") };
    const projection = partnerOrderProjectionSchema.parse(withId);
    const row = store.enqueue({ id: projection.eventId, eventType: "partner_order", payload: projection, now: nowIso() });
    return { id: row.id, status: row.status, projection };
  }

  async function flushOutbox() {
    if (!enabled) return { published: 0, failed: 0, disabled: true };
    const ready = store.readyOutbox(nowIso(), 50);
    let published = 0;
    let failed = 0;
    for (const row of ready) {
      try {
        const payload = safeJson(row.payload_json);
        const path = row.event_type === "inventory"
          ? "/collaboration/internal/v1/inventory"
          : row.event_type === "oem"
            ? "/collaboration/internal/v1/oem/projections"
            : row.event_type === "partner_order"
              ? "/collaboration/internal/v1/partner-orders/projections"
              : "/collaboration/internal/v1/projections";
        const result = await internalRequest(path, { method: "PUT", body: payload });
        store.markPublished(row.id, result, nowIso());
        published += 1;
      } catch (error) {
        store.markOutboxRetry(row.id, error.message, retryAt(Number(row.attempt_count) + 1));
        failed += 1;
        lastError = error.message;
      }
    }
    return { published, failed, disabled: false };
  }

  function assertCommandShape(command) {
    const validItemTypes = {
      inbound_confirm: "warehouse_inbound",
      outbound_confirm: "warehouse_outbound",
      transfer_receive: "warehouse_transfer",
      stockup_process: "warehouse_stockup",
    };
    const requiredType = validItemTypes[command.commandType];
    if (requiredType && command.itemType !== requiredType) fail("协同动作与内部任务类型不匹配。", 409, "command_task_mismatch");
    if (["inbound_confirm", "outbound_confirm", "inventory_adjustment"].includes(command.commandType) && !command.publicPayload?.warehouseRef) {
      fail("协同任务缺少内部仓库引用。", 409, "warehouse_reference_missing");
    }
  }

  function movementLines(command, { adjustment = false } = {}) {
    const catalog = productLookup(listProducts());
    return (command.payload?.lines || []).map((line) => {
      const sku = String(line.sku || "").replace(/\s+/g, "").toUpperCase();
      const product = catalog.get(sku) || {};
      const signed = adjustment && line.direction === "decrease" ? -Math.abs(Number(line.quantity)) : Number(line.quantity);
      return {
        productId: product.id || "",
        sku,
        productName: product.name || product.productName || sku,
        imageUrl: product.imageUrl || "",
        specification: product.specification || "",
        unit: product.unit || "件",
        ...(adjustment ? { deltaQty: signed } : { quantity: Math.abs(signed) }),
        lotNo: line.lotNo || "",
        barcode: line.barcode || "",
        productionDate: line.productionDate || "",
        expiryDate: line.expiryDate || "",
      };
    });
  }

  async function applyToCore(command) {
    assertCommandShape(command);
    const context = systemInventoryContext();
    const idempotencyKey = `collaboration:${command.id}:${command.idempotencyKey}`;
    if (command.itemType === "warehouse_stockup" && command.commandType === "accept") {
      if (!stockupCollaborationService?.applyWarehouseWorkOrderAction) fail("备货国内仓主账服务不可用。", 503, "stockup_service_unavailable");
      const result = stockupCollaborationService.applyWarehouseWorkOrderAction(command.coreRefId, {
        action: "accept",
        note: command.payload?.note || "国内仓已在伙伴门户接单",
      }, systemStockupContext(), idempotencyKey);
      return { ...result, reference: result.workOrder?.workOrderNo || command.coreRefId };
    }
    if (command.commandType === "stockup_process") {
      if (!stockupCollaborationService?.applyWarehouseWorkOrderAction) fail("备货国内仓主账服务不可用。", 503, "stockup_service_unavailable");
      const stockupContext = systemStockupContext();
      const workOrder = stockupCollaborationService.getWarehouseWorkOrder?.(command.coreRefId, stockupContext);
      if (Number(workOrder?.workflowVersion) === 2) {
        const result = stockupCollaborationService.submitInspection(command.coreRefId, command.payload, stockupContext);
        return { ...result, reference: workOrder.workOrderNo || command.coreRefId };
      }
      const result = stockupCollaborationService.applyWarehouseWorkOrderAction(command.coreRefId, {
        ...command.payload,
        action: "process",
        requireComplete: true,
      }, stockupContext, idempotencyKey);
      return { ...result, reference: result.workOrder?.workOrderNo || command.coreRefId };
    }
    if (command.commandType === "transfer_receive") {
      return domesticInventoryService.receiveTransfer(command.coreRefId, context);
    }
    if (["inbound_confirm", "outbound_confirm"].includes(command.commandType)) {
      return domesticInventoryService.createMovement({
        warehouseId: command.publicPayload.warehouseRef,
        type: command.commandType === "inbound_confirm" ? "inbound" : "outbound",
        referenceNo: command.publicPayload.referenceNo || command.coreRefId,
        note: command.payload.note || `外部协同回传：${command.id}`,
        lines: movementLines(command),
      }, context, idempotencyKey);
    }
    if (command.commandType === "inventory_adjustment") {
      return domesticInventoryService.createMovement({
        warehouseId: command.publicPayload.warehouseRef,
        type: "adjustment",
        referenceNo: command.publicPayload.referenceNo || command.coreRefId,
        note: command.payload.reason,
        lines: movementLines(command, { adjustment: true }),
      }, context, idempotencyKey);
    }
    if (command.coreRefType === "jiandaoyun_outsourcing_order" && ["accept", "order_production_progress", "order_material_readiness", "order_exception", "order_shipment"].includes(command.commandType)) {
      const sourceResult = await recordOutsourcingPartnerFeedback({
        orderNo: command.coreRefId,
        commandType: command.commandType,
        payload: command.payload || {},
        submittedByName: command.submittedByName,
        submittedAt: command.submittedAt,
      });
      return { ok: true, eventOnly: true, sourceUpdated: !sourceResult?.skipped, reference: command.coreRefId };
    }
    return { ok: true, eventOnly: true, reference: command.coreRefId };
  }

  async function processStoredCommand(commandId) {
    const stored = store.command(commandId);
    if (!stored) fail("本地未找到该协同指令。", 404, "command_not_found");
    if (["applied", "rejected", "failed"].includes(stored.local_status)) return { ok: true, idempotentReplay: true, ...stored.result };
    if (stored.local_status === "awaiting_approval") fail("该协同指令仍在等待内部审批。", 409, "approval_required");
    if (stored.local_status === "awaiting_result") return reportStoredResult(stored);
    if (stored.local_status === "retry" && stored.next_attempt_at && new Date(stored.next_attempt_at).getTime() > new Date(nowIso()).getTime()) {
      return { ok: false, retryScheduled: true, nextAttemptAt: stored.next_attempt_at };
    }
    store.markCommand(commandId, "processing");
    try {
      const coreResult = await applyToCore(stored.command);
      const result = {
        status: "applied",
        resultCode: coreResult.idempotentReplay ? "idempotent_replay" : "applied",
        message: coreResult.sourceUpdated ? "工厂反馈已同步到千顷 ERP，并写入内部审计记录。" : coreResult.eventOnly ? "协同进度已写入内部审计记录。" : "协同操作已通过内部校验并入账。",
        coreReference: coreResult.movementNo || coreResult.movementId || coreResult.transfer?.transferNo || coreResult.reference || stored.command.coreRefId,
      };
      store.markCommand(commandId, "awaiting_result", { result });
      onAudit("应用外部协同指令", stored.command, result);
      return reportStoredResult(store.command(commandId));
    } catch (error) {
      const statusCode = Number(error?.statusCode || error?.status || 0);
      const retryable = statusCode >= 500
        || ["AbortError", "TimeoutError"].includes(String(error?.name || ""))
        || ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "SQLITE_BUSY"].includes(String(error?.code || ""));
      const attempt = Number(stored.attempt_count || 0) + 1;
      if (retryable && attempt < 5) {
        const nextAttemptAt = retryAt(attempt);
        store.markCommandRetry(commandId, error.message, nextAttemptAt);
        lastError = `指令 ${commandId} 暂时失败，将于 ${nextAttemptAt} 重试：${error.message}`;
        return { ok: false, retryScheduled: true, attempt, nextAttemptAt };
      }
      const result = { status: "failed", resultCode: error.code || "core_validation_failed", message: String(error.message || error).slice(0, 2_000), coreReference: "" };
      store.markCommand(commandId, "awaiting_result", { result, error: error.message });
      onAudit("拒绝外部协同指令", stored.command, result);
      return reportStoredResult(store.command(commandId));
    }
  }

  async function reportStoredResult(stored) {
    if (!stored?.result) fail("协同指令缺少待回传结果。", 500, "command_result_missing");
    try {
      await internalRequest(`/collaboration/internal/v1/commands/${encodeURIComponent(stored.command.id)}/result`, { method: "POST", body: stored.result });
      const terminalStatus = stored.result.status === "applied" ? "applied" : stored.result.status;
      store.markCommand(stored.command.id, terminalStatus, { result: stored.result, processedAt: nowIso(), remoteStatus: terminalStatus });
      return { ok: terminalStatus === "applied", ...stored.result };
    } catch (error) {
      store.markCommand(stored.command.id, "awaiting_result", { result: stored.result, error: error.message });
      lastError = `指令结果等待回传：${error.message}`;
      return { ok: false, pendingResultDelivery: true, ...stored.result };
    }
  }

  async function retryPendingResults() {
    const pending = store.listCommands(["awaiting_result"], 100);
    let delivered = 0;
    for (const stored of pending) {
      const result = await reportStoredResult(stored);
      if (!result.pendingResultDelivery) delivered += 1;
    }
    return { pending: pending.length, delivered };
  }

  async function retryPendingCommands() {
    const ready = typeof store.readyCommands === "function" ? store.readyCommands(nowIso(), 100) : [];
    let applied = 0;
    let scheduled = 0;
    for (const stored of ready) {
      const result = await processStoredCommand(stored.command.id);
      if (result.ok) applied += 1;
      else if (result.retryScheduled) scheduled += 1;
    }
    return { ready: ready.length, applied, scheduled };
  }

  async function pullCommands() {
    if (!enabled) return { received: 0, processed: 0, disabled: true };
    const cursor = store.state("command_cursor");
    const query = new URLSearchParams({ limit: "100", includeApprovals: "true" });
    if (cursor) query.set("after", cursor);
    const response = await internalRequest(`/collaboration/internal/v1/commands?${query}`);
    const commands = Array.isArray(response.commands) ? response.commands : [];
    const now = nowIso();
    for (const command of commands) store.upsertCommand(command, now);
    let processed = 0;
    for (const command of commands.filter((item) => item.status === "pending_sync")) {
      const result = await processStoredCommand(command.id);
      if (result.ok) processed += 1;
    }
    if (response.nextCursor) store.setState("command_cursor", response.nextCursor, nowIso());
    return { received: commands.length, processed, disabled: false };
  }

  async function reviewCommand(commandId, { approved, note = "", reviewer = "供应链中台" } = {}) {
    const stored = store.command(commandId);
    if (!stored) fail("本地未找到该待审批指令，请先执行同步。", 404, "command_not_found");
    const review = await internalRequest(`/collaboration/internal/v1/commands/${encodeURIComponent(commandId)}/review`, {
      method: "POST",
      body: { approved: Boolean(approved), note: String(note).slice(0, 2_000), reviewer: String(reviewer).slice(0, 200) },
    });
    if (!approved) {
      store.markCommand(commandId, "rejected", { result: review, processedAt: nowIso(), remoteStatus: "rejected" });
      onAudit("驳回外部协同指令", stored.command, review);
      return review;
    }
    store.markCommand(commandId, "received", { remoteStatus: "pending_sync" });
    onAudit("批准外部协同指令", stored.command, review);
    return processStoredCommand(commandId);
  }

  function listOemQuotes(coreRefId) {
    return internalRequest(`/collaboration/internal/v1/oem/quotes?coreRefId=${encodeURIComponent(coreRefId)}`);
  }

  function awardOemQuote(quoteId, input) {
    return internalRequest(`/collaboration/internal/v1/oem/quotes/${encodeURIComponent(quoteId)}/award`, { method: "POST", body: input });
  }

  function reviewSampleArtifact(artifactId, input) {
    return internalRequest(`/collaboration/internal/v1/oem/artifacts/${encodeURIComponent(artifactId)}/review`, { method: "POST", body: input });
  }

  function provisionOrganization(input) {
    return internalRequest("/collaboration/internal/v1/organizations", { method: "POST", body: input });
  }

  function listOrganizations({ keyword = "", status = "" } = {}) {
    const query = new URLSearchParams();
    if (keyword) query.set("keyword", String(keyword));
    if (status) query.set("status", String(status));
    const queryString = query.toString();
    const suffix = queryString ? `?${queryString}` : "";
    return internalRequest(`/collaboration/internal/v1/organizations${suffix}`);
  }

  function getPartnerAiConfig() {
    return internalRequest("/collaboration/internal/v1/partner-ai/config");
  }

  function savePartnerAiConfig(input) {
    return internalRequest("/collaboration/internal/v1/partner-ai/config", { method: "PUT", body: input });
  }

  function testPartnerAiAsr(input) {
    return internalRequest("/collaboration/internal/v1/partner-ai/config/test", { method: "POST", body: input });
  }

  function getPartnerAiHealth() {
    return internalRequest("/collaboration/internal/v1/partner-ai/health");
  }

  function getOrganizationAccess(code) {
    return internalRequest(`/collaboration/internal/v1/organizations/${encodeURIComponent(code)}`);
  }

  function getOrganizationAccessGrants(code) {
    return internalRequest(`/collaboration/internal/v1/organizations/${encodeURIComponent(code)}/access-grants`);
  }

  async function activeOutsourcingFactoryOptions({ force = false } = {}) {
    if (!force && factoryOptionsCache.loadedAt && Date.now() - factoryOptionsCache.loadedAt < 5 * 60_000) return factoryOptionsCache.options;
    const records = await listActiveOutsourcingOrders();
    const options = outsourcingFactoryOptions(records);
    factoryOptionsCache = { loadedAt: Date.now(), options };
    return options;
  }

  function storedOutsourcingBinding(code) {
    const binding = parsedState(store, outsourcingBindingStateKey(code), null);
    return binding?.factoryId ? binding : null;
  }

  async function assertOutsourcingOrganization(code) {
    const access = await getOrganizationAccessGrants(code);
    if (access.organization?.organizationType !== "production_factory") fail("只有委外生产工厂组织可以绑定简道云委外加工单。", 409, "organization_type_mismatch");
    const productionGrant = (access.grants || []).find((grant) => grant.resourceType === "organization" && grant.resourceRef === "production");
    if (!productionGrant?.permissions?.includes("production.order.view")) fail("请先为该组织开通委外加工单查看权限。", 403, "resource_not_granted");
    return access;
  }

  async function resolveOutsourcingBinding(code, organization, { infer = true, forceOptions = false } = {}) {
    const stored = storedOutsourcingBinding(code);
    if (stored || !infer) return stored;
    const suggestion = inferOutsourcingFactoryBinding(organization?.name, await activeOutsourcingFactoryOptions({ force: forceOptions }));
    if (!suggestion) return null;
    const binding = {
      factoryId: suggestion.factoryId,
      factoryName: suggestion.factoryName,
      factoryFullName: suggestion.factoryFullName,
      inferred: true,
      boundAt: nowIso(),
      boundBy: "系统按组织名称精确匹配",
    };
    store.setState(outsourcingBindingStateKey(code), JSON.stringify(binding), nowIso());
    return binding;
  }

  async function getOutsourcingSourceBinding(code, { refresh = false } = {}) {
    const access = await assertOutsourcingOrganization(code);
    const options = await activeOutsourcingFactoryOptions({ force: refresh });
    const binding = await resolveOutsourcingBinding(code, access.organization, { forceOptions: refresh });
    const selected = binding ? options.find((item) => item.factoryId === binding.factoryId) : null;
    return {
      ok: true,
      source: { appName: "千顷 ERP", formName: "委外加工单", mode: "read_only_projection" },
      binding,
      options,
      activeOrderCount: selected?.activeOrderCount || 0,
      trackedOrderCount: parsedState(store, outsourcingTrackedStateKey(code), []).length,
      lastSyncedAt: store.state(`outsourcing_last_sync:${code}`),
    };
  }

  async function saveOutsourcingSourceBinding(code, input, { actorName = "供应链中台管理员" } = {}) {
    const access = await assertOutsourcingOrganization(code);
    const factoryId = String(input?.factoryId || "").trim().slice(0, 80);
    if (!factoryId) fail("请选择千顷 ERP 中的委外灌装工厂。", 400, "factory_required");
    const options = await activeOutsourcingFactoryOptions({ force: true });
    const option = options.find((item) => item.factoryId === factoryId);
    if (!option) fail("所选工厂当前没有进行中的委外加工单，或工厂编号已失效。", 409, "factory_not_available");
    const existing = storedOutsourcingBinding(code);
    const tracked = parsedState(store, outsourcingTrackedStateKey(code), []);
    if (existing && existing.factoryId !== factoryId && tracked.length) {
      fail("该组织已经同步过委外加工单。为防止跨工厂数据残留，请新建组织后绑定新的工厂。", 409, "binding_locked");
    }
    const binding = {
      factoryId: option.factoryId,
      factoryName: option.factoryName,
      factoryFullName: option.factoryFullName,
      inferred: false,
      boundAt: nowIso(),
      boundBy: String(actorName).slice(0, 200),
    };
    store.setState(outsourcingBindingStateKey(code), JSON.stringify(binding), nowIso());
    const synchronization = await synchronizeOutsourcingProjections({ organizationCode: code, organizations: [access.organization] });
    const delivery = await flushOutbox();
    onAudit("绑定千顷ERP委外加工工厂", { id: factoryId, organizationCode: code, coreRefId: factoryId, commandType: "bind", submittedByName: actorName }, { binding, synchronization, delivery });
    return { ok: true, binding, synchronization, delivery };
  }

  async function synchronizeOutsourcingProjections({ force = false, organizationCode = "", organizations: suppliedOrganizations = null } = {}) {
    if (!enabled || !oemEnabled) return { scannedOrganizations: 0, queued: 0, unchanged: 0, skipped: 0, failed: 0, disabled: true };
    const organizations = suppliedOrganizations || (organizationCode
      ? [(await getOrganizationAccessGrants(organizationCode)).organization]
      : ((await listOrganizations({ status: "active" })).organizations || []));
    const productionOrganizations = organizations.filter((item) => item?.organizationType === "production_factory" && item.status !== "suspended" && item.status !== "archived");
    let queued = 0;
    let unchanged = 0;
    let skipped = 0;
    let failed = 0;
    const errors = [];
    const warnings = [];
    for (const organization of productionOrganizations) {
      try {
        const access = await assertOutsourcingOrganization(organization.code);
        const binding = await resolveOutsourcingBinding(organization.code, access.organization || organization);
        if (!binding) { skipped += 1; continue; }
        const records = await listOutsourcingFactoryOrders(binding.factoryId);
        let firstArticleRecords = [];
        let craftOrderRecords = [];
        try {
          firstArticleRecords = await listFirstArticleRecords(records);
        } catch (error) {
          warnings.push(`${organization.code}: 首件记录读取失败，委外工单已继续同步（${error.message}）`);
        }
        try {
          craftOrderRecords = await listCraftOrderRecords(records);
        } catch (error) {
          warnings.push(`${organization.code}: 工艺单产品封面读取失败，委外工单已继续同步（${error.message}）`);
        }
        const tracked = new Set(parsedState(store, outsourcingTrackedStateKey(organization.code), []));
        const workItems = await listOrganizationWorkItems(organization.code, { itemType: "production_order", limit: 100 });
        const existingByOrderNo = new Map((workItems.items || []).map((item) => [String(item.coreRefId || ""), item]));
        const catalog = productLookup(listProducts());
        const productionDueAt = new Map();
        for (const record of records) {
          const identity = outsourcingOrderIdentity(record);
          if (!identity.orderNo || (!isActiveOutsourcingStatus(identity.status) && !tracked.has(identity.orderNo))) continue;
          const existingItem = existingByOrderNo.get(identity.orderNo);
          const stateKey = outsourcingProjectionStateKey(organization.code, identity.orderNo);
          const previous = parsedState(store, stateKey, { fingerprint: "", version: 0 });
          const version = inventoryProjectionVersion(Math.max(Number(previous.version || 0), Number(existingItem?.version || 0)));
          const eventHash = createHash("sha256").update(`${organization.code}:${identity.orderNo}:${version}`).digest("hex").slice(0, 24);
          let projection = outsourcingProjectionFromRecord(record, {
            organizationCode: organization.code,
            version,
            currentStatus: existingItem?.status || "",
            firstArticleRecords,
            craftOrderRecords,
            eventId: `jdy-outsourcing-${eventHash}`,
          });
          if (!projection) continue;
          const product = catalog.get(normalizedSku(projection.lines[0]?.sku)) || {};
          if (!projection.lines[0]?.imageUrl && product.imageUrl) {
            const imageUrl = publicImageUrl(product.imageUrl);
            projection = {
              ...projection,
              publicPayload: { ...projection.publicPayload, productImageUrl: imageUrl },
              lines: projection.lines.map((line, index) => index === 0 ? { ...line, imageUrl } : line),
            };
          }
          productionDueAt.set(identity.orderNo, projection.dueAt || "");
          const fingerprint = outsourcingProjectionFingerprint(projection);
          if (!force && previous.fingerprint === fingerprint) { unchanged += 1; tracked.add(identity.orderNo); continue; }
          queuePartnerOrderProjection(projection);
          store.setState(stateKey, JSON.stringify({ fingerprint, version, sourceUpdatedAt: identity.updatedAt }), nowIso());
          tracked.add(identity.orderNo);
          queued += 1;
        }
        const procurementGrant = (access.grants || []).find((grant) => grant.resourceType === "organization" && grant.resourceRef === "procurement" && grant.permissions?.includes("procurement.order.view"));
        if (procurementGrant && tracked.size) {
          try {
            const { purchaseRecords = [], inboundRecords = [] } = await listOutsourcingPurchaseDocuments([...tracked]);
            const purchaseWorkItems = await listOrganizationWorkItems(organization.code, { itemType: "purchase_order", limit: 500 });
            const existingPurchaseByOrderNo = new Map((purchaseWorkItems.items || []).map((item) => [String(item.coreRefId || ""), item]));
            const factoryNames = [binding.factoryName, binding.factoryFullName, organization.name].filter(Boolean);
            for (const purchaseRecord of purchaseRecords) {
              const identity = purchaseOrderIdentity(purchaseRecord);
              if (!identity.orderNo || !tracked.has(identity.outsourcingOrderNo)) continue;
              const existingItem = existingPurchaseByOrderNo.get(identity.orderNo);
              const stateKey = purchaseProjectionStateKey(organization.code, identity.orderNo);
              const previous = parsedState(store, stateKey, { fingerprint: "", version: 0 });
              const version = inventoryProjectionVersion(Math.max(Number(previous.version || 0), Number(existingItem?.version || 0)));
              const eventHash = createHash("sha256").update(`${organization.code}:${identity.orderNo}:${version}`).digest("hex").slice(0, 24);
              const projection = purchaseProjectionFromRecord(purchaseRecord, {
                organizationCode: organization.code,
                factoryId: binding.factoryId,
                factoryNames,
                inboundRecords,
                version,
                currentStatus: existingItem?.status || "",
                dueAt: productionDueAt.get(identity.outsourcingOrderNo) || "",
                eventId: `jdy-purchase-${eventHash}`,
              });
              if (!projection) continue;
              const fingerprint = outsourcingProjectionFingerprint(projection);
              if (!force && previous.fingerprint === fingerprint) { unchanged += 1; continue; }
              queuePartnerOrderProjection(projection);
              store.setState(stateKey, JSON.stringify({ fingerprint, version, sourceUpdatedAt: identity.updatedAt }), nowIso());
              queued += 1;
            }
          } catch (error) {
            warnings.push(`${organization.code}: 采购单/采购入库单同步暂时失败，已保留上次同步数据（${error.message}）`);
          }
        }
        store.setState(outsourcingTrackedStateKey(organization.code), JSON.stringify([...tracked].sort()), nowIso());
        store.setState(`outsourcing_last_sync:${organization.code}`, nowIso(), nowIso());
      } catch (error) {
        failed += 1;
        errors.push(`${organization.code}: ${error.message}`);
      }
    }
    if (!failed) store.setState("outsourcing_projection_last_scan_at", nowIso(), nowIso());
    return { scannedOrganizations: productionOrganizations.length, queued, unchanged, skipped, failed, disabled: false, errors, warnings };
  }

  function outsourcingProjectionSyncDue() {
    const lastScan = Date.parse(store.state("outsourcing_projection_last_scan_at"));
    return !Number.isFinite(lastScan) || Date.now() - lastScan >= Math.max(60_000, outsourcingSyncIntervalMs);
  }

  function listOrganizationWorkItems(code, filters = {}) {
    const query = new URLSearchParams({ organizationCode: String(code) });
    for (const key of ["status", "itemType", "keyword", "limit", "offset"]) {
      if (filters[key] !== undefined && String(filters[key]).trim()) query.set(key, String(filters[key]));
    }
    return internalRequest(`/collaboration/internal/v1/work-items?${query.toString()}`);
  }

  async function getOrganizationWorkItem(code, workItemId) {
    const detail = await internalRequest(`/collaboration/internal/v1/work-items/${encodeURIComponent(workItemId)}`);
    if (String(detail?.item?.organizationCode || "") !== String(code || "")) fail("该协同单据不属于当前组织。", 403, "organization_scope_denied");
    if (!["production_order", "purchase_order", "sampling_task"].includes(String(detail?.item?.itemType || ""))) fail("该单据不属于伙伴生产协同范围。", 403, "partner_task_type_denied");
    return detail;
  }

  async function downloadOrganizationWorkItemAttachment(code, workItemId, attachmentId) {
    await getOrganizationWorkItem(code, workItemId);
    const response = await internalRequest(`/collaboration/internal/v1/work-items/${encodeURIComponent(workItemId)}/attachments/${encodeURIComponent(attachmentId)}`, { raw: true });
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") || "application/octet-stream",
      contentDisposition: response.headers.get("content-disposition") || "attachment",
    };
  }

  async function uploadOrganizationWorkItemAttachment(code, workItemId, file, { actorName = "供应链中台管理员" } = {}) {
    await getOrganizationWorkItem(code, workItemId);
    const fileName = String(file?.fileName || "").trim();
    const mimeType = String(file?.mimeType || "").trim();
    const buffer = Buffer.isBuffer(file?.buffer) ? file.buffer : Buffer.from(file?.buffer || "");
    if (!fileName || !mimeType || !buffer.length) fail("附件名称、类型和内容不能为空。", 400, "invalid_attachment");
    return internalRequest(`/collaboration/internal/v1/work-items/${encodeURIComponent(workItemId)}/attachments`, {
      method: "PUT",
      rawBody: buffer,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(buffer.length),
        "X-File-Name": encodeURIComponent(fileName),
        "X-Actor-Name": encodeURIComponent(actorName),
      },
    });
  }

  async function publishPartnerTask(code, input, { actorName = "供应链中台管理员" } = {}) {
    if (!oemEnabled) fail("生产、采购与打样协同尚未启用。", 403, "feature_disabled");
    const task = internalPartnerTaskSchema.parse(input);
    const documentNo = task.taskType === "sampling_task" ? (task.documentNo || generatedSamplingDocumentNo(task.sampleCategory)) : task.documentNo;
    const taskTitle = task.title || `${task.productName} · ${task.sampleCategory === "packaging" ? "包材打样" : "料体打样"}`;
    if (task.taskType === "production_order") fail("委外加工单由千顷 ERP 自动同步，请先绑定委外灌装工厂，不要重复手工录单。", 409, "source_managed_task");
    const access = await getOrganizationAccessGrants(code);
    const required = {
      production_order: { resourceRef: "production", permission: "production.order.view" },
      purchase_order: { resourceRef: "procurement", permission: "procurement.order.view" },
      sampling_task: { resourceRef: "sampling", permission: "sampling.task.view" },
    }[task.taskType];
    const grant = (access.grants || []).find((item) => item.resourceType === "organization" && item.resourceRef === required.resourceRef);
    if (!grant?.permissions?.includes(required.permission)) {
      const label = required.resourceRef === "production" ? "委外加工" : required.resourceRef === "procurement" ? "物料采购" : "打样";
      fail(`目标组织尚未开通${label}权限。`, 403, "resource_not_granted");
    }
    const version = collaborationProjectionVersion();
    const eventId = projectionId(task.taskType === "sampling_task" ? "sampling" : "partner-order");
    const deliveryDate = task.dueAt ? task.dueAt.slice(0, 10) : "";
    let queued;
    if (task.taskType === "sampling_task") {
      queued = queueOemProjection({
        eventId,
        organizationCode: code,
        coreRefType: "sampling_order",
        coreRefId: documentNo,
        spaceType: "sampling",
        itemType: "sampling_task",
        title: taskTitle,
        description: task.description || task.requirements,
        priority: task.priority,
        status: "pending",
        dueAt: task.dueAt,
        version,
        publicPayload: {
          projectCode: documentNo,
          productName: task.productName,
          productSpec: task.productSpec,
          documentVersion: `V${version}`,
          requirements: task.requirements,
          quantity: task.quantity,
          unit: task.unit,
          deliveryDate,
          sampleCategory: task.sampleCategory,
          sampleSubject: task.sampleSubject,
          sampleGoal: task.sampleGoal,
          evaluationCriteria: task.evaluationCriteria,
          quoteRequired: task.quoteRequired,
          packagingSpec: task.sampleCategory === "packaging" ? task.packagingSpec : undefined,
        },
        milestones: [],
      });
    } else {
      const production = task.taskType === "production_order";
      queued = queuePartnerOrderProjection({
        eventId,
        organizationCode: code,
        coreRefType: production ? "outsourcing_order" : "material_purchase_order",
        coreRefId: task.documentNo,
        orderType: production ? "production" : "purchase",
        itemType: task.taskType,
        title: taskTitle,
        description: task.description || task.requirements,
        priority: task.priority,
        status: "pending",
        dueAt: task.dueAt,
        version,
        publicPayload: {
          orderNo: documentNo,
          productName: task.productName,
          fulfillmentMode: production ? task.fulfillmentMode : "supplier",
          requirements: task.requirements,
          quantity: task.quantity,
          unit: task.unit,
          deliveryDate,
          deliveryAddress: task.deliveryAddress,
        },
        lines: task.lines.map((line, index) => ({
          lineRef: `${documentNo}-${String(index + 1).padStart(3, "0")}`.slice(0, 120),
          lineType: line.lineType || (production ? "finished_product" : "raw_material"),
          sku: normalizedSku(line.sku),
          productName: line.productName,
          specification: line.specification,
          imageUrl: publicImageUrl(line.imageUrl),
          plannedQuantity: line.plannedQuantity,
          unit: line.unit,
          responsibility: production ? "factory" : "supplier",
        })),
        milestones: [],
      });
    }
    const delivery = await flushOutbox();
    onAudit("发布伙伴生产/采购/打样单", { id: eventId, organizationCode: code, coreRefId: documentNo, commandType: "publish", submittedByName: actorName }, { taskType: task.taskType, status: queued.status, delivery });
    let workItemId = "";
    if (delivery.published > 0 && delivery.failed === 0) {
      const published = await listOrganizationWorkItems(code, { itemType: task.taskType, keyword: documentNo, limit: 20 });
      workItemId = published.items.find((item) => item.coreRefId === documentNo)?.id || "";
    }
    return { ok: true, eventId, coreRefId: documentNo, workItemId, status: queued.status, delivery };
  }

  async function replaceOrganizationAccessGrants(code, input) {
    const result = await internalRequest(`/collaboration/internal/v1/organizations/${encodeURIComponent(code)}/access-grants`, { method: "PUT", body: input });
    const inventoryProjection = await synchronizeInventoryProjections({ force: true, organizationCode: code });
    const delivery = await flushOutbox();
    return { ...result, inventoryProjection: { ...inventoryProjection, delivery } };
  }

  function bootstrapOrganization(input) {
    return internalRequest("/collaboration/internal/v1/organizations/bootstrap", { method: "POST", body: input });
  }

  function updateOrganizationStatus(code, input) {
    return internalRequest(`/collaboration/internal/v1/organizations/${encodeURIComponent(code)}`, { method: "PATCH", body: input });
  }

  function updateMemberCredentials(code, membershipId, input) {
    return internalRequest(`/collaboration/internal/v1/organizations/${encodeURIComponent(code)}/members/${encodeURIComponent(membershipId)}/credentials`, { method: "PATCH", body: input });
  }

  function reissueInvitation(invitationId, input) {
    return internalRequest(`/collaboration/internal/v1/invitations/${encodeURIComponent(invitationId)}/reissue`, { method: "POST", body: input });
  }

  function revokeInvitation(invitationId, input) {
    return internalRequest(`/collaboration/internal/v1/invitations/${encodeURIComponent(invitationId)}/revoke`, { method: "POST", body: input });
  }

  async function synchronize() {
    if (running) return { ok: true, skipped: true, reason: "already_running" };
    running = true;
    try {
      const inventoryProjections = inventoryProjectionSyncDue() ? await synchronizeInventoryProjections() : { skipped: true, reason: "not_due" };
      const outsourcingProjections = outsourcingProjectionSyncDue() ? await synchronizeOutsourcingProjections() : { skipped: true, reason: "not_due" };
      const outbox = await flushOutbox();
      const commandResults = await retryPendingResults();
      const commandRetries = await retryPendingCommands();
      const commands = await pullCommands();
      lastError = "";
      if (enabled) store.setState("last_successful_sync_at", nowIso(), nowIso());
      return { ok: true, inventoryProjections, outsourcingProjections, outbox, commandResults, commandRetries, commands };
    } catch (error) {
      lastError = error.message;
      return { ok: false, message: error.message, code: error.code || "sync_failed" };
    } finally {
      running = false;
    }
  }

  function status() {
    return { ok: true, enabled, oemEnabled, running, baseUrl: normalizedBaseUrl, pollIntervalMs, inventorySyncIntervalMs, outsourcingSyncIntervalMs, lastError, ...store.status() };
  }

  function start() {
    if (timer || !enabled) return;
    timer = setInterval(() => { void synchronize(); }, Math.max(5_000, pollIntervalMs));
    timer.unref();
    setImmediate(() => { void synchronize(); });
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  async function waitForIdle({ timeoutMs = 60_000 } = {}) {
    const startedAt = Date.now();
    while (running) {
      if (Date.now() - startedAt >= timeoutMs) throw new Error("Timed out waiting for collaboration bridge to become idle");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  return {
    bootstrapOrganization,
    downloadOrganizationWorkItemAttachment,
    downloadWarehouseTaskAttachment,
    flushOutbox,
    awardOemQuote,
    getOrganizationAccess,
    getOrganizationAccessGrants,
    getCommand: (commandId) => store.command(commandId),
    getPartnerAiConfig,
    getPartnerAiHealth,
    getOrganizationWorkItem,
    getOutsourcingSourceBinding,
    getWarehouseTask,
    listOrganizations,
    listOrganizationWorkItems,
    listApprovals: () => store.listCommands(["awaiting_approval"], 200),
    listOemQuotes,
    listWarehouseTaskOptions,
    listWarehouseTasks,
    pullCommands,
    provisionOrganization,
    publishPartnerTask,
    publishWarehouseTask,
    queueInventoryProjection,
    queueOemProjection,
    queuePartnerOrderProjection,
    queueProjection,
    reissueInvitation,
    remindWarehouseTask,
    replaceOrganizationAccessGrants,
    reviewCommand,
    reviewSampleArtifact,
    revokeInvitation,
    saveOutsourcingSourceBinding,
    savePartnerAiConfig,
    start,
    status,
    stop,
    synchronize,
    synchronizeInventoryProjections,
    synchronizeOutsourcingProjections,
    testPartnerAiAsr,
    updateOrganizationStatus,
    updateMemberCredentials,
    uploadOrganizationWorkItemAttachment,
    waitForIdle,
  };
}
