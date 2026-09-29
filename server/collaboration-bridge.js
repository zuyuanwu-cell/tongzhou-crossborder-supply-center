import { createHash, randomUUID } from "node:crypto";
import { collaborationProjectionSchema, inventoryProjectionSchema, oemProjectionSchema } from "../collaboration/shared/contracts.js";

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

function inventoryProjectionStateKey(organizationCode, warehouseRef) {
  return `inventory_projection:${organizationCode}:${warehouseRef}`;
}

function inventoryProjectionVersion(previous = 0) {
  // Keep the value inside PostgreSQL int4 while remaining monotonic across restarts.
  const secondsSince2020 = Math.floor((Date.now() - Date.UTC(2020, 0, 1)) / 1_000);
  return Math.max(Number(previous || 0) + 1, secondsSince2020, 1);
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

export function createCollaborationBridge({
  store,
  domesticInventoryService,
  listProducts = () => [],
  baseUrl = process.env.COLLABORATION_API_BASE_URL || "http://127.0.0.1:8790",
  internalToken = process.env.COLLABORATION_INTERNAL_TOKEN || (process.env.NODE_ENV === "production" ? "" : "local-internal-token-change-me"),
  pollIntervalMs = Number(process.env.COLLABORATION_BRIDGE_POLL_MS || 10_000),
  inventorySyncIntervalMs = Number(process.env.COLLABORATION_INVENTORY_SYNC_MS || 60_000),
  requestTimeoutMs = Number(process.env.COLLABORATION_BRIDGE_TIMEOUT_MS || 15_000),
  oemEnabled = process.env.COLLABORATION_OEM_ENABLED === "true",
  fetchImpl = globalThis.fetch,
  onAudit = () => {},
} = {}) {
  const normalizedBaseUrl = String(baseUrl || "").replace(/\/$/, "");
  const enabled = Boolean(normalizedBaseUrl && internalToken && fetchImpl);
  let timer = null;
  let running = false;
  let lastError = "";

  async function internalRequest(path, { method = "GET", body } = {}) {
    if (!enabled) fail("协同桥接尚未配置。", 503, "collaboration_bridge_disabled");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetchImpl(`${normalizedBaseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${internalToken}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) fail(payload.message || `协同 API 返回 ${response.status}`, response.status, payload.code || "collaboration_api_error");
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  function queueProjection(input) {
    const withId = { ...input, eventId: input.eventId || projectionId("projection") };
    const projection = collaborationProjectionSchema.parse(withId);
    const row = store.enqueue({ id: projection.eventId, eventType: "projection", payload: projection, now: nowIso() });
    return { id: row.id, status: row.status, projection };
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
    const items = (payload.balances || []).map((item) => ({
      sku: String(item.sku || "").trim(),
      productName: String(item.productName || item.sku || "").trim(),
      availableQuantity: Math.max(0, Number(item.availableQty || 0)),
      lockedQuantity: Math.max(0, Number(item.reservedQty || 0)),
      inTransitQuantity: 0,
      unit: String(item.unit || "件").trim() || "件",
    })).filter((item) => item.sku && item.productName).sort((left, right) => left.sku.localeCompare(right.sku));
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
    for (const organization of organizations.filter((item) => item.organizationType === "warehouse" && item.status !== "suspended" && item.status !== "archived")) {
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

  function queueOemProjection(input) {
    if (!oemEnabled) fail("OEM 协同尚未通过国内仓试点上线门禁。", 403, "feature_disabled");
    const withId = { ...input, eventId: input.eventId || projectionId("oem") };
    const projection = oemProjectionSchema.parse(withId);
    const row = store.enqueue({ id: projection.eventId, eventType: "oem", payload: projection, now: nowIso() });
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

  function applyToCore(command) {
    assertCommandShape(command);
    const context = systemInventoryContext();
    const idempotencyKey = `collaboration:${command.id}:${command.idempotencyKey}`;
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
    return { ok: true, eventOnly: true, reference: command.coreRefId };
  }

  async function processStoredCommand(commandId) {
    const stored = store.command(commandId);
    if (!stored) fail("本地未找到该协同指令。", 404, "command_not_found");
    if (["applied", "rejected", "failed"].includes(stored.local_status)) return { ok: true, idempotentReplay: true, ...stored.result };
    if (stored.local_status === "awaiting_approval") fail("该协同指令仍在等待内部审批。", 409, "approval_required");
    if (stored.local_status === "awaiting_result") return reportStoredResult(stored);
    store.markCommand(commandId, "processing");
    try {
      const coreResult = applyToCore(stored.command);
      const result = {
        status: "applied",
        resultCode: coreResult.idempotentReplay ? "idempotent_replay" : "applied",
        message: coreResult.eventOnly ? "协同进度已写入内部审计记录。" : "协同操作已通过内部校验并入账。",
        coreReference: coreResult.movementNo || coreResult.movementId || coreResult.transfer?.transferNo || coreResult.reference || stored.command.coreRefId,
      };
      store.markCommand(commandId, "awaiting_result", { result });
      onAudit("应用外部协同指令", stored.command, result);
      return reportStoredResult(store.command(commandId));
    } catch (error) {
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

  function provisionOrganization(input) {
    return internalRequest("/collaboration/internal/v1/organizations", { method: "POST", body: input });
  }

  function listOrganizations({ keyword = "", status = "" } = {}) {
    const query = new URLSearchParams();
    if (keyword) query.set("keyword", String(keyword));
    if (status) query.set("status", String(status));
    const suffix = query.size ? `?${query}` : "";
    return internalRequest(`/collaboration/internal/v1/organizations${suffix}`);
  }

  function getOrganizationAccess(code) {
    return internalRequest(`/collaboration/internal/v1/organizations/${encodeURIComponent(code)}`);
  }

  function getOrganizationAccessGrants(code) {
    return internalRequest(`/collaboration/internal/v1/organizations/${encodeURIComponent(code)}/access-grants`);
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
      const outbox = await flushOutbox();
      const commandResults = await retryPendingResults();
      const commands = await pullCommands();
      lastError = "";
      if (enabled) store.setState("last_successful_sync_at", nowIso(), nowIso());
      return { ok: true, inventoryProjections, outbox, commandResults, commands };
    } catch (error) {
      lastError = error.message;
      return { ok: false, message: error.message, code: error.code || "sync_failed" };
    } finally {
      running = false;
    }
  }

  function status() {
    return { ok: true, enabled, oemEnabled, running, baseUrl: normalizedBaseUrl, pollIntervalMs, inventorySyncIntervalMs, lastError, ...store.status() };
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

  return {
    bootstrapOrganization,
    flushOutbox,
    awardOemQuote,
    getOrganizationAccess,
    getOrganizationAccessGrants,
    listOrganizations,
    listApprovals: () => store.listCommands(["awaiting_approval"], 200),
    listOemQuotes,
    pullCommands,
    provisionOrganization,
    queueInventoryProjection,
    queueOemProjection,
    queueProjection,
    reissueInvitation,
    replaceOrganizationAccessGrants,
    reviewCommand,
    revokeInvitation,
    start,
    status,
    stop,
    synchronize,
    synchronizeInventoryProjections,
    updateOrganizationStatus,
  };
}
