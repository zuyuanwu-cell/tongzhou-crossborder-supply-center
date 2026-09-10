import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { normalizedCountryKey } from "./performance-analytics.js";

export const WAREHOUSE_TICKET_CATEGORIES = Object.freeze([
  "订单催促",
  "发货/物流问题",
  "库存/缺货问题",
  "入库/上架问题",
  "费用/赔付问题",
  "数据/系统问题",
  "其他问题",
]);

export const WAREHOUSE_TICKET_STATUSES = Object.freeze([
  "pending_warehouse",
  "processing",
  "resolved",
  "cancelled",
]);

function text(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function actorName(actor) {
  return text(actor?.displayName || actor?.username || actor?.id || "系统");
}

function event(type, label, actor, note = "") {
  return {
    id: randomUUID(),
    type,
    label,
    note: text(note),
    actor: actorName(actor),
    actorId: text(actor?.id),
    createdAt: nowIso(),
  };
}

function loadJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function createStore(cachePath) {
  let state = loadJson(cachePath, { version: 1, updatedAt: "", sequenceDate: "", sequence: 0, tickets: [], uploads: [] });
  state.tickets = Array.isArray(state.tickets) ? state.tickets : [];
  state.uploads = Array.isArray(state.uploads) ? state.uploads : [];

  function persist() {
    mkdirSync(resolve(cachePath, ".."), { recursive: true });
    state.updatedAt = nowIso();
    const temporaryPath = `${cachePath}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(state, null, 2), "utf8");
    renameSync(temporaryPath, cachePath);
  }

  function nextId() {
    const date = nowIso().slice(0, 10).replaceAll("-", "");
    if (state.sequenceDate !== date) {
      state.sequenceDate = date;
      state.sequence = 0;
    }
    state.sequence += 1;
    return `WT-${date}-${String(state.sequence).padStart(4, "0")}`;
  }

  return {
    list: () => state.tickets,
    get: (id) => state.tickets.find((ticket) => ticket.id === id) || null,
    create(ticket) {
      const created = { ...ticket, id: nextId() };
      state.tickets.unshift(created);
      persist();
      return created;
    },
    update(id, updater) {
      const index = state.tickets.findIndex((ticket) => ticket.id === id);
      if (index < 0) return null;
      state.tickets[index] = updater({ ...state.tickets[index] });
      persist();
      return state.tickets[index];
    },
    addUpload(upload) {
      state.uploads.unshift(upload);
      if (state.uploads.length > 5000) state.uploads.length = 5000;
      persist();
      return upload;
    },
    getUpload: (id) => state.uploads.find((upload) => upload.id === id) || null,
  };
}

function inScope(ticket, dataScopes = {}) {
  const warehouseIds = new Set((dataScopes.warehouseIds || []).map(text).filter(Boolean));
  const countries = new Set((dataScopes.countries || []).map(normalizedCountryKey).filter(Boolean));
  if (warehouseIds.size && !warehouseIds.has(text(ticket.warehouseId))) return false;
  if (countries.size && ticket.country && !countries.has(normalizedCountryKey(ticket.country))) return false;
  return true;
}

function summaryFor(tickets) {
  return tickets.reduce((summary, ticket) => {
    summary.total += 1;
    if (ticket.status === "pending_warehouse") summary.pendingWarehouse += 1;
    if (ticket.status === "processing") summary.processing += 1;
    if (ticket.status === "resolved") summary.resolved += 1;
    if (!["resolved", "cancelled"].includes(ticket.status)) summary.open += 1;
    if (ticket.priority === "urgent" && !["resolved", "cancelled"].includes(ticket.status)) summary.urgent += 1;
    return summary;
  }, { total: 0, open: 0, pendingWarehouse: 0, processing: 0, resolved: 0, urgent: 0 });
}

export function createWarehouseTicketService({ cachePath, uploadDir }) {
  const store = createStore(cachePath);

  function list(filters = {}) {
    const keyword = text(filters.keyword).toLowerCase();
    const status = text(filters.status);
    const createdById = text(filters.createdById);
    const visible = store.list().filter((ticket) => (
      inScope(ticket, filters.dataScopes)
      && (!createdById || text(ticket.createdById) === createdById)
    ));
    const tickets = visible.filter((ticket) => {
      if (status && status !== "all" && ticket.status !== status) return false;
      if (!keyword) return true;
      return [ticket.id, ticket.title, ticket.category, ticket.relatedOrderNumber, ticket.description]
        .some((value) => text(value).toLowerCase().includes(keyword));
    });
    return { ok: true, updatedAt: nowIso(), summary: summaryFor(visible), tickets };
  }

  function saveUpload(input, actor, requestOrigin) {
    const dataUrl = text(input.dataUrl);
    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif)|application\/pdf);base64,(.+)$/i);
    if (!match) throw new Error("请上传 PNG、JPG、WEBP、GIF 或 PDF 文件。");
    const mimeType = match[1].toLowerCase().replace("image/jpg", "image/jpeg");
    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length) throw new Error("文件内容为空。");
    if (bytes.length > 8 * 1024 * 1024) throw new Error("单个文件不能超过 8MB。");
    const suffix = mimeType === "application/pdf" ? "pdf" : mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
    const id = `wt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${suffix}`;
    mkdirSync(uploadDir, { recursive: true });
    writeFileSync(resolve(uploadDir, id), bytes);
    return store.addUpload({
      id,
      fileName: text(input.fileName) || id,
      mimeType,
      size: bytes.length,
      url: `${text(requestOrigin)}/api/warehouse-tickets/uploads/${encodeURIComponent(id)}`,
      uploadedAt: nowIso(),
      uploadedBy: actorName(actor),
      uploadedById: text(actor?.id),
    });
  }

  function attachments(ids) {
    const unique = [...new Set((Array.isArray(ids) ? ids : []).map(text).filter(Boolean))];
    return unique.map((id) => store.getUpload(id)).filter(Boolean);
  }

  function create(input, actor) {
    const category = text(input.category);
    if (!WAREHOUSE_TICKET_CATEGORIES.includes(category)) throw new Error("请选择仓库工单类型。");
    const relatedOrderNumber = text(input.relatedOrderNumber);
    if (category === "订单催促" && !relatedOrderNumber) throw new Error("订单催促工单必须填写关联订单号。");
    const title = text(input.title);
    const description = text(input.description);
    if (!title) throw new Error("请填写工单主题。");
    if (!description) throw new Error("请填写问题或诉求详情。");
    const warehouseId = text(input.warehouseId);
    if (!warehouseId) throw new Error("请选择处理仓库。");
    const now = nowIso();
    const ticket = store.create({
      warehouseId,
      warehouseName: text(input.warehouseName),
      country: text(input.country),
      category,
      priority: input.priority === "urgent" ? "urgent" : "normal",
      relatedOrderNumber,
      title: title.slice(0, 120),
      description: description.slice(0, 5000),
      attachments: attachments(input.attachmentIds),
      status: "pending_warehouse",
      warehouseRemark: "",
      createdAt: now,
      updatedAt: now,
      createdBy: actorName(actor),
      createdById: text(actor?.id),
      acceptedAt: "",
      resolvedAt: "",
      timeline: [event("created", "运营提交仓库工单", actor, description)],
      notifications: [],
    });
    return { ok: true, ticket, summary: summaryFor(store.list()) };
  }

  function updateWarehouse(id, input, actor) {
    const action = text(input.action);
    const transitions = {
      accept: { from: ["pending_warehouse"], to: "processing", label: "仓库已受理" },
      reply: { from: ["pending_warehouse", "processing"], to: "", label: "仓库回复工单" },
      resolve: { from: ["pending_warehouse", "processing"], to: "resolved", label: "仓库工单已解决" },
      cancel: { from: ["pending_warehouse", "processing"], to: "cancelled", label: "仓库工单已取消" },
      reopen: { from: ["resolved", "cancelled"], to: "processing", label: "仓库工单已重新打开" },
    };
    const transition = transitions[action];
    if (!transition) throw new Error("不支持的仓库工单动作。");
    const note = text(input.note || input.warehouseRemark);
    if (action === "reply" && !note) throw new Error("发送回复前，请填写仓库回复内容。");
    if (action === "resolve" && !note) throw new Error("完结工单前，请填写处理结果。");
    const updated = store.update(id, (ticket) => {
      if (!transition.from.includes(ticket.status)) throw new Error("当前状态不能执行该操作，请刷新后重试。");
      const now = nowIso();
      return {
        ...ticket,
        status: transition.to || ticket.status,
        warehouseRemark: note || ticket.warehouseRemark,
        updatedAt: now,
        acceptedAt: action === "accept" ? now : ticket.acceptedAt,
        resolvedAt: action === "resolve" ? now : "",
        timeline: [...(ticket.timeline || []), event(action, transition.label, actor, note)],
      };
    });
    if (!updated) throw new Error("仓库工单不存在。");
    return { ok: true, ticket: updated, summary: summaryFor(store.list()) };
  }

  function recordNotification(id, input = {}) {
    return store.update(id, (ticket) => ({
      ...ticket,
      notifications: [...(ticket.notifications || []), {
        id: randomUUID(),
        eventType: text(input.eventType),
        target: text(input.target),
        status: input.status === "sent" ? "sent" : input.status === "failed" ? "failed" : "skipped",
        robotCount: Number(input.robotCount || 0),
        failedCount: Number(input.failedCount || 0),
        message: text(input.message),
        createdAt: nowIso(),
      }].slice(-30),
    }));
  }

  return {
    list,
    get(id, dataScopes = {}, createdById = "") {
      const ticket = store.get(id);
      return ticket && inScope(ticket, dataScopes) && (!text(createdById) || text(ticket.createdById) === text(createdById)) ? ticket : null;
    },
    inScope,
    saveUpload,
    uploadPath(fileName) {
      const safeName = text(fileName);
      if (!/^wt-[a-z0-9-]+\.(?:png|jpg|jpeg|webp|gif|pdf)$/i.test(safeName)) return null;
      const upload = store.getUpload(safeName);
      const path = resolve(uploadDir, safeName);
      return upload && existsSync(path) ? { path, upload } : null;
    },
    canAccessUpload(id, dataScopes = {}, actorId = "", createdById = "") {
      const upload = store.getUpload(id);
      if (!upload) return false;
      const related = store.list().filter((ticket) => (ticket.attachments || []).some((item) => text(item.id) === text(id)));
      if (related.length) return related.some((ticket) => inScope(ticket, dataScopes) && (!text(createdById) || text(ticket.createdById) === text(createdById)));
      return Boolean(text(actorId) && text(upload.uploadedById) === text(actorId));
    },
    create,
    updateWarehouse,
    recordNotification,
  };
}
