import type { Dashboard, FirstArticleRecord, InvitationDeliveryResult, InventoryItem, NotificationItem, OrganizationInvitation, OrganizationMember, OrganizationMemberRole, Session, WarehouseOperationLine, WarehouseOperationType, WorkItem, WorkItemDetail } from "./types";

export type PartnerOrderReportInput =
  | { reportType: "production_progress"; stage: "planning" | "material_preparation" | "filling" | "packaging" | "quality_check" | "ready_to_ship"; progressPercent: number; completedQuantity: number; expectedCompletionDate: string; note: string }
  | { reportType: "material_readiness"; lineId: string; readiness: "not_arrived" | "partial" | "arrived"; arrivedQuantity: number; testResult: "pending" | "passed" | "failed" | "not_required"; testedAt: string; exceptionDescription: string; note: string }
  | { reportType: "purchase_fulfillment"; stage: "confirmed" | "preparing" | "ready_to_ship" | "shipped" | "delivered"; expectedDeliveryDate: string; completedQuantity: number; note: string }
  | { reportType: "exception"; category: "material_shortage" | "material_quality" | "packaging_test" | "production_delay" | "quality_issue" | "delivery_delay" | "other"; severity: "notice" | "warning" | "critical"; title: string; description: string; affectedQuantity: number; expectedResolutionDate: string }
  | { reportType: "shipment"; shippedQuantity: number; shippedAt: string; carrier: string; trackingNo: string; note: string };

const API_BASE = String(import.meta.env.VITE_COLLABORATION_API_URL || "").replace(/\/$/, "");
const demoVariant = new URLSearchParams(window.location.search).get("demo");
const demoMode = import.meta.env.DEV && demoVariant !== null;
const demoOem = demoVariant === "oem";
const demoProduction = demoVariant === "production";
const demoSupplier = demoVariant === "supplier";
const demoPartnerOrder = demoProduction || demoSupplier;
const demoAdmin = demoVariant === "admin";
const demoOrganization = demoProduction
  ? { code: "pf-factory-demo", name: "华南灌装协同工厂", type: "production_factory" }
  : demoSupplier
    ? { code: "ms-supplier-demo", name: "恒信包材供应商", type: "material_supplier" }
    : demoOem
      ? { code: "packaging-partner-demo", name: "战略包装伙伴", type: "packaging_factory" }
      : { code: "cn-warehouse-demo", name: "华东协同仓", type: "warehouse" };

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code = "request_failed") { super(message); this.status = status; this.code = code; }
}

function cookie(name: string) {
  const prefix = `${encodeURIComponent(name)}=`;
  return document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length) || "";
}

async function ensureCsrfToken() {
  let token = cookie("tz_collab_csrf");
  if (token) return decodeURIComponent(token);
  await fetch(`${API_BASE}/collaboration/me`, { credentials: "include", cache: "no-store" });
  token = cookie("tz_collab_csrf");
  return token ? decodeURIComponent(token) : "";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = String(init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (!["GET", "HEAD"].includes(method)) headers.set("X-CSRF-Token", await ensureCsrfToken());
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: "include" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(payload.message || `请求失败（${response.status}）`, response.status, payload.code);
  return payload as T;
}

let demoSession: Session = {
  user: { id: "demo-user", username: "partner.manager", displayName: demoProduction ? "工厂生产负责人" : demoSupplier ? "供应商跟单员" : "仓库负责人", email: "partner@example.test" },
  membership: { id: "demo-membership", organizationId: "demo-org", organizationCode: demoOrganization.code, organizationName: demoOrganization.name, organizationType: demoOrganization.type, role: demoAdmin ? "organization_admin" : "manager", status: "active", permissions: [], mfaRequired: false },
  organization: { id: "demo-org", ...demoOrganization },
  mfaRequired: false, mfaEnabled: false, mfaVerifiedAt: "", pendingMfa: false, mustChangePassword: false, oemEnabled: demoOem || demoPartnerOrder,
};
const now = Date.now();
let demoMembers: OrganizationMember[] = [
  { id: "demo-membership", userId: "demo-user", username: "warehouse.admin", email: "warehouse@example.test", displayName: "仓库负责人", userStatus: "active", role: "organization_admin", status: "active", permissions: [], mfaRequired: false, mfaEnabled: false, mustChangePassword: false, lastLoginAt: new Date(now - 18e5).toISOString(), createdAt: new Date(now - 30 * 864e5).toISOString() },
  { id: "demo-operator", userId: "demo-user-2", username: "warehouse.operator", email: "", displayName: "入库操作员", userStatus: "active", role: "operator", status: "active", permissions: [], mfaRequired: false, mfaEnabled: false, mustChangePassword: false, lastLoginAt: new Date(now - 864e5).toISOString(), createdAt: new Date(now - 20 * 864e5).toISOString() },
  { id: "demo-viewer", userId: "demo-user-3", username: "warehouse.viewer", email: "viewer@example.test", displayName: "质检查看员", userStatus: "active", role: "viewer", status: "disabled", permissions: [], mfaRequired: false, mfaEnabled: false, mustChangePassword: false, lastLoginAt: "", createdAt: new Date(now - 12 * 864e5).toISOString() },
];
let demoInvitations: OrganizationInvitation[] = [
  { id: "demo-invitation", username: "warehouse.finance", email: "finance@example.test", role: "finance", mfaRequired: false, status: "pending", expiresAt: new Date(now + 36 * 36e5).toISOString(), acceptedAt: "", createdAt: new Date(now - 12 * 36e5).toISOString() },
];
const demoFirstArticle: FirstArticleRecord = {
  matchedBy: "barcode", documentNo: "FA-202610-018", version: "V3", productSku: "TZKJ-DEMO01", productName: "海盐净润洗护套装",
  specification: "500ml × 2", brandName: "TONGZHOU", unit: "套", barcode: "6970000000001", filingName: "海盐净润洗护套装", bpom: "NA18260100001",
  productionProcess: "灌装、密封测试、贴标、打码、装盒、装箱", cartonSpecification: "24套/箱", updatedAt: new Date(now - 864e5).toISOString(),
  bom: [{ category: "包材", name: "500ml PET 瓶体", materialCode: "PACK-DEMO-01", netContent: "500", unit: "ml", composition: "2个/套" }, { category: "包材", name: "运输外箱", materialCode: "CARTON-DEMO-01", netContent: "", unit: "个", composition: "1箱/24套" }],
  images: [{ category: "packaging", label: "产品包装六面图", name: "首件包装示意", url: "/app-icon.svg", mime: "image/svg+xml", size: 0 }, { category: "finished", label: "成品效果", name: "首件成品示意", url: "/app-icon.svg", mime: "image/svg+xml", size: 0 }],
};
const demoItems: WorkItem[] = [
  ...(demoOem ? [{ id: "6a77af62-79fa-4e30-a77e-2e5bf82114a4", spaceId: "oem-demo", itemType: "packaging_quote", title: "包装盲报价 · 海盐净润系列", description: "按已批准设计稿，对 500ml 瓶体、泵头和运输外箱进行整套报价。", status: "accepted", priority: "urgent", publicPayload: { projectCode: "OEM-2026-031", productName: "海盐净润洗护套装", productSpec: "500ml × 2", documentVersion: "DESIGN-V4", requirements: "报价需包含开模费、版费、含税到仓价。", quantity: 12000, unit: "套", deliveryDate: "2026-11-20", quoteCurrency: "CNY" }, dueAt: new Date(now + 1728e5).toISOString(), version: 2, lastCoreSyncedAt: new Date(now - 18e4).toISOString(), createdAt: new Date(now - 864e5).toISOString(), updatedAt: new Date(now - 18e4).toISOString() } satisfies WorkItem] : []),
  ...(demoProduction ? [{ id: "7a77af62-79fa-4e30-a77e-2e5bf82114a5", spaceId: "production-demo", itemType: "production_order", title: "委外灌装加工单 · MO-202610-018", description: "全包生产 500ml 洗护套装，工厂负责料体、瓶体、泵头、标签与外箱。", status: "in_progress", priority: "urgent", publicPayload: { orderNo: "MO-202610-018", projectCode: "OEM-2026-041", productName: "海盐净润洗护套装", productSpec: "500ml × 2", barcode: "6970000000001", productionProcess: "灌装、密封测试、贴标、打码、装盒、装箱", cartonType: "专用箱（印箱唛）", piecesPerCarton: 24, factoryExpectedDeliveryDate: "2026-11-18", fulfillmentMode: "turnkey", requirements: "包材到齐后先完成密封、跌落及相容性测试，合格后方可批量灌装。", quantity: 12000, unit: "套", deliveryDate: "2026-11-20", deliveryAddress: "杭州总仓", firstArticle: demoFirstArticle }, dueAt: new Date(now + 12 * 864e5).toISOString(), version: 3, lastCoreSyncedAt: new Date(now - 18e4).toISOString(), createdAt: new Date(now - 2 * 864e5).toISOString(), updatedAt: new Date(now - 18e4).toISOString() } satisfies WorkItem] : []),
  ...(demoSupplier ? [{ id: "8a77af62-79fa-4e30-a77e-2e5bf82114a6", spaceId: "procurement-demo", itemType: "purchase_order", title: "包材采购单 · PO-202610-063", description: "采购 500ml PET 瓶体与配套泵头，按批准样封样生产。", status: "accepted", priority: "normal", publicPayload: { orderNo: "PO-202610-063", projectCode: "OEM-2026-041", productName: "500ml PET 瓶体与泵头", fulfillmentMode: "supplier", requirements: "按封样颜色及尺寸生产，出货附批次质检报告。", quantity: 24000, unit: "套", deliveryDate: "2026-10-30", deliveryAddress: "华南灌装协同工厂", paymentTerms: "月结 30 天" }, dueAt: new Date(now + 17 * 864e5).toISOString(), version: 2, lastCoreSyncedAt: new Date(now - 18e4).toISOString(), createdAt: new Date(now - 864e5).toISOString(), updatedAt: new Date(now - 18e4).toISOString() } satisfies WorkItem] : []),
  ...(!demoOem && !demoPartnerOrder ? [
  { id: "8b3c9150-a854-4d0e-b61f-2d75fc56c705", spaceId: "demo", itemType: "warehouse_transfer", title: "华东仓调拨收货 · DB-202609-001", description: "核对到货箱数、批次和外箱状态后确认收货。", status: "pending", priority: "urgent", publicPayload: { referenceNo: "DB-202609-001", warehouseName: "华东协同仓", sourceWarehouseName: "杭州总仓", destinationWarehouseName: "华东协同仓", note: "到货后请拍摄托盘和封箱标签。" }, dueAt: new Date(now + 7.2e7).toISOString(), version: 1, lastCoreSyncedAt: new Date(now - 18e4).toISOString(), createdAt: new Date(now - 36e5).toISOString(), updatedAt: new Date(now - 18e4).toISOString() },
  { id: "ea69fd79-f2a6-45e4-a117-a4432996ce7a", spaceId: "demo", itemType: "warehouse_inbound", title: "采购入库 · RK-202609-118", description: "新批次商品入库并补充生产日期。", status: "in_progress", priority: "normal", publicPayload: { referenceNo: "RK-202609-118", warehouseName: "华东协同仓" }, dueAt: new Date(now + 17.2e7).toISOString(), version: 3, lastCoreSyncedAt: new Date(now - 36e4).toISOString(), createdAt: new Date(now - 864e5).toISOString(), updatedAt: new Date(now - 36e4).toISOString() },
  { id: "dd312a54-3c1d-44a7-bf5a-cef9774e880e", spaceId: "demo", itemType: "warehouse_outbound", title: "备货出库 · BH-202609-042", description: "按批次拣货并回传装箱凭证。", status: "pending_sync", priority: "normal", publicPayload: { referenceNo: "BH-202609-042", warehouseName: "华东协同仓" }, dueAt: new Date(now + 26e7).toISOString(), version: 5, lastCoreSyncedAt: new Date(now - 9e4).toISOString(), createdAt: new Date(now - 1728e5).toISOString(), updatedAt: new Date(now - 9e4).toISOString() },
  ] as WorkItem[] : []),
];

export async function fetchMe() { if (demoMode) return { ok: true, session: demoSession }; return request<{ ok: boolean; session: Session }>("/collaboration/me"); }
export async function login(input: { username: string; password: string }) { if (demoMode) return { ok: true, session: demoSession, mfaSetupRequired: false }; return request<{ ok: boolean; session: Session; mfaSetupRequired: boolean }>("/collaboration/auth/login", { method: "POST", body: JSON.stringify(input) }); }
export async function acceptInvitation(token: string, displayName: string, password: string) { return request<{ ok: boolean; organization: { code: string; name: string } }>("/collaboration/auth/invitations/accept", { method: "POST", body: JSON.stringify({ token, displayName, password }) }); }
export async function requestPasswordReset(username: string) { return request<{ ok: boolean; accepted: boolean }>("/collaboration/auth/password-reset/request", { method: "POST", body: JSON.stringify({ username }) }); }
export async function confirmPasswordReset(token: string, password: string) { return request<{ ok: boolean; changed: boolean }>("/collaboration/auth/password-reset/confirm", { method: "POST", body: JSON.stringify({ token, password }) }); }
export async function logout() { if (demoMode) return { ok: true }; return request<{ ok: boolean }>("/collaboration/auth/logout", { method: "POST" }); }
export async function setupMfa() { return request<{ ok: boolean; configured: boolean; secret: string; uri: string }>("/collaboration/auth/mfa/setup", { method: "POST" }); }
export async function verifyMfa(token: string) { return request<{ ok: boolean; session: Session }>("/collaboration/auth/mfa/verify", { method: "POST", body: JSON.stringify({ token }) }); }
export async function updateOwnProfile(input: { displayName: string; email: string; currentPassword: string }) {
  if (demoMode) { demoSession = { ...demoSession, user: { ...demoSession.user, displayName: input.displayName, email: input.email } }; return { ok: true, user: demoSession.user }; }
  return request<{ ok: boolean; user: Session["user"] }>("/collaboration/v1/account/profile", { method: "PATCH", body: JSON.stringify(input) });
}
export async function changeOwnPassword(input: { currentPassword: string; newPassword: string }) {
  if (demoMode) { demoSession = { ...demoSession, mustChangePassword: false }; return { ok: true, changed: true, mustChangePassword: false }; }
  return request<{ ok: boolean; changed: boolean; mustChangePassword: boolean }>("/collaboration/v1/account/password", { method: "POST", body: JSON.stringify(input) });
}
export async function fetchMembers() { if (demoMode) return { ok: true, members: demoMembers }; return request<{ ok: boolean; members: OrganizationMember[] }>("/collaboration/v1/admin/members"); }
export async function fetchInvitations() { if (demoMode) return { ok: true, invitations: demoInvitations }; return request<{ ok: boolean; invitations: OrganizationInvitation[] }>("/collaboration/v1/admin/invitations"); }
export async function createInvitation(input: { username: string; email: string; role: OrganizationMemberRole; mfaRequired: boolean }) {
  if (demoMode) {
    const invitation: OrganizationInvitation = { id: crypto.randomUUID(), ...input, status: "pending", expiresAt: new Date(Date.now() + 48 * 36e5).toISOString(), acceptedAt: "", createdAt: new Date().toISOString() };
    demoInvitations = [invitation, ...demoInvitations];
    return { ok: true, invitation, delivery: { sent: false, reason: "demo" }, activationUrl: `${location.origin}${location.pathname}?invite=demo-${invitation.id}` } satisfies { ok: boolean } & InvitationDeliveryResult;
  }
  return request<{ ok: boolean } & InvitationDeliveryResult>("/collaboration/v1/admin/invitations", { method: "POST", body: JSON.stringify(input) });
}
export async function createMember(input: { username: string; displayName?: string; email?: string; password: string; role: OrganizationMemberRole; mfaRequired: boolean }) {
  if (demoMode) {
    const member: OrganizationMember = { id: crypto.randomUUID(), userId: crypto.randomUUID(), username: input.username, email: input.email || "", displayName: input.displayName || input.username, userStatus: "active", role: input.role, status: "active", permissions: [], mfaRequired: false, mfaEnabled: false, mustChangePassword: false, lastLoginAt: "", createdAt: new Date().toISOString() };
    demoMembers = [member, ...demoMembers];
    return { ok: true, member };
  }
  return request<{ ok: boolean; member: OrganizationMember }>("/collaboration/v1/admin/members", { method: "POST", body: JSON.stringify(input) });
}
export async function updateMember(id: string, input: { role?: OrganizationMemberRole; status?: "active" | "disabled"; mfaRequired?: boolean }) {
  if (demoMode) { demoMembers = demoMembers.map((member) => member.id === id ? { ...member, ...input } : member); return { ok: true, membership: { id, ...input } }; }
  return request<{ ok: boolean; membership: { id: string; role: OrganizationMemberRole; status: string; mfaRequired: boolean } }>(`/collaboration/v1/admin/members/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
}
export async function reissueInvitation(id: string) {
  if (demoMode) { const invitation = demoInvitations.find((item) => item.id === id)!; invitation.expiresAt = new Date(Date.now() + 48 * 36e5).toISOString(); invitation.status = "pending"; return { ok: true, invitation, delivery: { sent: false, reason: "demo" }, activationUrl: `${location.origin}${location.pathname}?invite=demo-${id}-renewed` } satisfies { ok: boolean } & InvitationDeliveryResult; }
  return request<{ ok: boolean } & InvitationDeliveryResult>(`/collaboration/v1/admin/invitations/${encodeURIComponent(id)}/reissue`, { method: "POST" });
}
export async function revokeInvitation(id: string) {
  if (demoMode) { demoInvitations = demoInvitations.map((item) => item.id === id ? { ...item, status: "expired", expiresAt: new Date().toISOString() } : item); return { ok: true, invitation: demoInvitations.find((item) => item.id === id)! }; }
  return request<{ ok: boolean; invitation: OrganizationInvitation }>(`/collaboration/v1/admin/invitations/${encodeURIComponent(id)}/revoke`, { method: "POST" });
}
export async function fetchDashboard() { if (demoMode) return { ok: true, dashboard: { openTasks: demoItems.length, urgentTasks: demoItems.filter((item) => item.priority === "urgent").length, waitingTasks: 0, unreadNotifications: 2, inventorySkuCount: demoPartnerOrder ? 0 : 186, inventorySyncedAt: new Date(now - 9e4).toISOString(), productionOrders: demoProduction ? 1 : 0, purchaseOrders: demoSupplier ? 1 : 0, dueSoonTasks: 1, exceptionReports: 1 } satisfies Dashboard }; return request<{ ok: boolean; dashboard: Dashboard }>("/collaboration/v1/dashboard"); }
export async function fetchWorkItems(filters: { status?: string; keyword?: string; limit?: number } = {}) { if (demoMode) return { ok: true, items: demoItems, counts: { pending: 1, in_progress: 1, pending_sync: 1 }, limit: filters.limit || 30, offset: 0 }; const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => [key, String(value)])); return request<{ ok: boolean; items: WorkItem[]; counts: Record<string, number>; limit: number; offset: number }>(`/collaboration/v1/work-items?${query}`); }
export async function fetchWorkItem(id: string) {
  if (demoMode) {
    const item = demoItems.find((entry) => entry.id === id) || demoItems[0];
    const oem = item.itemType === "packaging_quote" ? { artifacts: [], quotes: [], milestones: [] } : null;
    const partnerOrder = ["production_order", "purchase_order"].includes(item.itemType) ? {
      lines: item.itemType === "production_order" ? [
        { id: "11111111-1111-4111-8111-111111111111", lineRef: "finished", lineType: "finished_product" as const, sku: "TZKJ-SEA-001", productName: "海盐净润洗护套装", specification: "500ml × 2", imageUrl: "", plannedQuantity: 12000, completedQuantity: 3600, unit: "套", requiredAt: "2026-11-20", responsibility: "factory" as const, unitPrice: null, currency: "CNY" },
        { id: "22222222-2222-4222-8222-222222222222", lineRef: "bottle", lineType: "packaging" as const, sku: "PACK-BOTTLE-500", productName: "500ml PET 瓶体", specification: "透明琥珀色", imageUrl: "", plannedQuantity: 24500, completedQuantity: 0, unit: "个", requiredAt: "2026-10-18", responsibility: "factory" as const, unitPrice: null, currency: "CNY" },
        { id: "33333333-3333-4333-8333-333333333333", lineRef: "pump", lineType: "packaging" as const, sku: "PACK-PUMP-24", productName: "24 牙泵头", specification: "黑色哑光", imageUrl: "", plannedQuantity: 24500, completedQuantity: 0, unit: "个", requiredAt: "2026-10-18", responsibility: "factory" as const, unitPrice: null, currency: "CNY" },
        { id: "44444444-4444-4444-8444-444444444444", lineRef: "formula", lineType: "raw_material" as const, sku: "RAW-SEA-01", productName: "海盐净润料体", specification: "两款共 12 吨", imageUrl: "", plannedQuantity: 12000, completedQuantity: 0, unit: "kg", requiredAt: "2026-10-20", responsibility: "factory" as const, unitPrice: null, currency: "CNY" },
      ] : [
        { id: "55555555-5555-4555-8555-555555555555", lineRef: "bottle", lineType: "packaging" as const, sku: "PACK-BOTTLE-500", productName: "500ml PET 瓶体", specification: "透明琥珀色", imageUrl: "", plannedQuantity: 24000, completedQuantity: 8000, unit: "个", requiredAt: "2026-10-30", responsibility: "supplier" as const, unitPrice: 1.26, currency: "CNY" },
        { id: "66666666-6666-4666-8666-666666666666", lineRef: "pump", lineType: "packaging" as const, sku: "PACK-PUMP-24", productName: "24 牙泵头", specification: "黑色哑光", imageUrl: "", plannedQuantity: 24000, completedQuantity: 8000, unit: "个", requiredAt: "2026-10-30", responsibility: "supplier" as const, unitPrice: 0.72, currency: "CNY" },
      ],
      reports: item.itemType === "production_order" ? [{ id: "report-1", workItemId: item.id, lineId: "22222222-2222-4222-8222-222222222222", commandId: "command-1", reportType: "material_readiness" as const, stage: "arrived", progressPercent: null, result: "passed", quantity: 24500, expectedAt: "2026-10-12T00:00:00.000Z", severity: "", title: "500ml PET 瓶体到齐与测试", note: "密封与跌落测试合格", details: { testResult: "passed" }, submittedBy: "demo-user", createdAt: new Date(now - 864e5).toISOString() }] : [],
    } : null;
    const warehouseLines = partnerOrder || oem ? [] : [{ id: "line-1", sku: "TZKJ-DEMO-001", productName: "海盐净润洗发露", imageUrl: "", plannedQuantity: 240, completedQuantity: 0, unit: "件", lotNo: "LOT-260920-A", barcode: "697000000001", productionDate: "2026-09-20", expiryDate: "2029-09-19" }];
    return { ok: true, item, lines: warehouseLines, events: [{ id: "event-1", eventType: partnerOrder ? "core.partner_order_projection" : oem ? "core.oem_projection" : "core.projection", actorName: "供应链中台", body: partnerOrder ? "订单已发布到本组织工作台" : oem ? "包装询价已发布至贵司私有空间" : "任务已发布到华东协同仓", metadata: {}, createdAt: item.createdAt }], attachments: [], commands: [], oem, partnerOrder } as { ok: true } & WorkItemDetail;
  }
  return request<{ ok: boolean } & WorkItemDetail>(`/collaboration/v1/work-items/${id}`);
}
export async function submitAction(id: string, version: number, body: Record<string, unknown>) { if (demoMode) return { ok: true, item: { ...demoItems[0], status: body.action === "accept" ? "accepted" : "pending_sync", version: version + 1 } }; return request<{ ok: boolean; item: WorkItem }>(`/collaboration/v1/work-items/${id}/actions`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID(), "If-Match": String(version) }, body: JSON.stringify(body) }); }
export async function submitPartnerOrderReport(workItemId: string, version: number, body: PartnerOrderReportInput) { if (demoMode) return { ok: true, workItemVersion: version + 1 }; return request<{ ok: boolean; workItemVersion: number }>(`/collaboration/v1/partner-orders/${workItemId}/reports`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID(), "If-Match": String(version) }, body: JSON.stringify(body) }); }
export async function submitSupplierQuote(workItemId: string, version: number, body: { currency: string; amount: number; minimumOrderQuantity: number; leadTimeDays: number; terms: string }) { if (demoMode) return { ok: true }; return request(`/collaboration/v1/oem/quotes`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID(), "If-Match": String(version) }, body: JSON.stringify({ workItemId, ...body }) }); }
export async function submitOemArtifact(workItemId: string, version: number, body: { artifactType: string; title: string; publicPayload: { summary: string; result: string }; artifactVersion?: number }) { if (demoMode) return { ok: true }; return request(`/collaboration/v1/oem/artifacts`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID(), "If-Match": String(version) }, body: JSON.stringify({ workItemId, artifactType: body.artifactType, title: body.title, version: body.artifactVersion || 1, publicPayload: body.publicPayload }) }); }
export async function updateProductionMilestone(milestoneId: string, version: number, body: { status: string; note: string }) { if (demoMode) return { ok: true }; return request(`/collaboration/v1/oem/milestones/${milestoneId}`, { method: "PATCH", headers: { "Idempotency-Key": crypto.randomUUID(), "If-Match": String(version) }, body: JSON.stringify(body) }); }
export async function fetchInventory(keyword = "") { if (demoMode) return { ok: true, items: [{ warehouseRef: "dwh-east-01", warehouseName: "华东协同仓", sku: "TZKJ-DEMO-001", productName: "海盐净润洗发露", imageUrl: "", availableQuantity: 1880, lockedQuantity: 240, inTransitQuantity: 240, unit: "件", lastCoreSyncedAt: new Date(now - 9e4).toISOString(), version: 1 }, { warehouseRef: "dwh-east-01", warehouseName: "华东协同仓", sku: "TZKJ-DEMO-002", productName: "森系修护发膜", imageUrl: "", availableQuantity: 864, lockedQuantity: 120, inTransitQuantity: 120, unit: "件", lastCoreSyncedAt: new Date(now - 9e4).toISOString(), version: 1 }, { warehouseRef: "dwh-east-01", warehouseName: "华东协同仓", sku: "TZKJ-DEMO-003", productName: "轻盈蓬松护发素", imageUrl: "", availableQuantity: 430, lockedQuantity: 0, inTransitQuantity: 0, unit: "件", lastCoreSyncedAt: new Date(now - 9e4).toISOString(), version: 1 }] satisfies InventoryItem[], limit: 100, offset: 0 }; return request<{ ok: boolean; items: InventoryItem[]; limit: number; offset: number }>(`/collaboration/v1/inventory?keyword=${encodeURIComponent(keyword)}&limit=100`); }
export async function createWarehouseOperation(input: { operationType: WarehouseOperationType; warehouseRef: string; referenceNo: string; note: string; lines: WarehouseOperationLine[] }) {
  if (demoMode) return { ok: true, item: { ...demoItems[0], id: crypto.randomUUID(), status: "pending_approval" as const, title: "仓库自主作业", version: 1 }, command: { id: crypto.randomUUID(), status: "pending_approval" } };
  return request<{ ok: boolean; item: WorkItem; command: { id: string; type: string; status: string; riskLevel: string } }>("/collaboration/v1/warehouse-operations", {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(input),
  });
}
export async function fetchNotifications() { if (demoMode) return { ok: true, items: [{ id: "note-1", workItemId: demoItems[0].id, title: "收到新的协同任务", body: demoItems[0].title, channel: "in_app", deliveryStatus: "sent", readAt: "", createdAt: demoItems[0].createdAt }, { id: "note-2", workItemId: demoItems[2].id, title: "操作等待中台同步", body: demoItems[2].title, channel: "in_app", deliveryStatus: "sent", readAt: "", createdAt: demoItems[2].updatedAt }] satisfies NotificationItem[], limit: 30, offset: 0 }; return request<{ ok: boolean; items: NotificationItem[]; limit: number; offset: number }>("/collaboration/v1/notifications"); }
export async function markNotificationRead(id: string) { if (demoMode) return { ok: true }; return request<{ ok: boolean }>(`/collaboration/v1/notifications/${id}/read`, { method: "POST" }); }
export async function uploadAttachment(workItemId: string, file: File) {
  if (demoMode) return { ok: true, attachmentId: crypto.randomUUID() };
  const ticket = await request<{ ok: boolean; attachmentId: string; uploadUrl: string; uploadMethod: string; requiredHeaders: Record<string, string> }>("/collaboration/v1/attachments", {
    method: "POST",
    body: JSON.stringify({ workItemId, fileName: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size }),
  });
  const uploadHeaders = new Headers(ticket.requiredHeaders);
  const localUpload = ticket.uploadUrl.startsWith("/collaboration/");
  if (localUpload) uploadHeaders.set("X-CSRF-Token", decodeURIComponent(cookie("tz_collab_csrf")));
  const response = await fetch(localUpload ? `${API_BASE}${ticket.uploadUrl}` : ticket.uploadUrl, { method: ticket.uploadMethod, headers: uploadHeaders, body: file, credentials: localUpload ? "include" : "omit" });
  if (!response.ok) throw new ApiError("附件上传失败。", response.status, "upload_failed");
  if (!localUpload) await request(`/collaboration/v1/attachments/${ticket.attachmentId}/complete`, { method: "POST" });
  return { ok: true, attachmentId: ticket.attachmentId };
}
