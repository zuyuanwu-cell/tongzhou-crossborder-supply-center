import type { Dashboard, InvitationDeliveryResult, InventoryItem, NotificationItem, OrganizationInvitation, OrganizationMember, OrganizationMemberRole, Session, WarehouseOperationLine, WarehouseOperationType, WorkItem, WorkItemDetail } from "./types";

const API_BASE = String(import.meta.env.VITE_COLLABORATION_API_URL || "").replace(/\/$/, "");
const demoVariant = new URLSearchParams(window.location.search).get("demo");
const demoMode = import.meta.env.DEV && demoVariant !== null;
const demoOem = demoVariant === "oem";
const demoAdmin = demoVariant === "admin";

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
  user: { id: "demo-user", username: "warehouse.admin", displayName: "仓库负责人", email: "warehouse@example.test" },
  membership: { id: "demo-membership", organizationId: "demo-org", organizationCode: demoOem ? "packaging-partner-demo" : "cn-warehouse-demo", organizationName: demoOem ? "战略包装伙伴" : "华东协同仓", organizationType: demoOem ? "packaging_factory" : "warehouse", role: demoAdmin ? "organization_admin" : "manager", status: "active", permissions: [], mfaRequired: false },
  organization: { id: "demo-org", code: demoOem ? "packaging-partner-demo" : "cn-warehouse-demo", name: demoOem ? "战略包装伙伴" : "华东协同仓", type: demoOem ? "packaging_factory" : "warehouse" },
  mfaRequired: false, mfaEnabled: false, mfaVerifiedAt: "", pendingMfa: false, mustChangePassword: false, oemEnabled: demoOem,
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
const demoItems: WorkItem[] = [
  ...(demoOem ? [{ id: "6a77af62-79fa-4e30-a77e-2e5bf82114a4", spaceId: "oem-demo", itemType: "packaging_quote", title: "包装盲报价 · 海盐净润系列", description: "按已批准设计稿，对 500ml 瓶体、泵头和运输外箱进行整套报价。", status: "accepted", priority: "urgent", publicPayload: { projectCode: "OEM-2026-031", productName: "海盐净润洗护套装", productSpec: "500ml × 2", documentVersion: "DESIGN-V4", requirements: "报价需包含开模费、版费、含税到仓价。", quantity: 12000, unit: "套", deliveryDate: "2026-11-20", quoteCurrency: "CNY" }, dueAt: new Date(now + 1728e5).toISOString(), version: 2, lastCoreSyncedAt: new Date(now - 18e4).toISOString(), createdAt: new Date(now - 864e5).toISOString(), updatedAt: new Date(now - 18e4).toISOString() } satisfies WorkItem] : []),
  { id: "8b3c9150-a854-4d0e-b61f-2d75fc56c705", spaceId: "demo", itemType: "warehouse_transfer", title: "华东仓调拨收货 · DB-202609-001", description: "核对到货箱数、批次和外箱状态后确认收货。", status: "pending", priority: "urgent", publicPayload: { referenceNo: "DB-202609-001", warehouseName: "华东协同仓", sourceWarehouseName: "杭州总仓", destinationWarehouseName: "华东协同仓", note: "到货后请拍摄托盘和封箱标签。" }, dueAt: new Date(now + 7.2e7).toISOString(), version: 1, lastCoreSyncedAt: new Date(now - 18e4).toISOString(), createdAt: new Date(now - 36e5).toISOString(), updatedAt: new Date(now - 18e4).toISOString() },
  { id: "ea69fd79-f2a6-45e4-a117-a4432996ce7a", spaceId: "demo", itemType: "warehouse_inbound", title: "采购入库 · RK-202609-118", description: "新批次商品入库并补充生产日期。", status: "in_progress", priority: "normal", publicPayload: { referenceNo: "RK-202609-118", warehouseName: "华东协同仓" }, dueAt: new Date(now + 17.2e7).toISOString(), version: 3, lastCoreSyncedAt: new Date(now - 36e4).toISOString(), createdAt: new Date(now - 864e5).toISOString(), updatedAt: new Date(now - 36e4).toISOString() },
  { id: "dd312a54-3c1d-44a7-bf5a-cef9774e880e", spaceId: "demo", itemType: "warehouse_outbound", title: "备货出库 · BH-202609-042", description: "按批次拣货并回传装箱凭证。", status: "pending_sync", priority: "normal", publicPayload: { referenceNo: "BH-202609-042", warehouseName: "华东协同仓" }, dueAt: new Date(now + 26e7).toISOString(), version: 5, lastCoreSyncedAt: new Date(now - 9e4).toISOString(), createdAt: new Date(now - 1728e5).toISOString(), updatedAt: new Date(now - 9e4).toISOString() },
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
export async function fetchDashboard() { if (demoMode) return { ok: true, dashboard: { openTasks: 3, urgentTasks: 1, waitingTasks: 1, unreadNotifications: 2, inventorySkuCount: 186, inventorySyncedAt: new Date(now - 9e4).toISOString() } satisfies Dashboard }; return request<{ ok: boolean; dashboard: Dashboard }>("/collaboration/v1/dashboard"); }
export async function fetchWorkItems(filters: { status?: string; keyword?: string } = {}) { if (demoMode) return { ok: true, items: demoItems, counts: { pending: 1, in_progress: 1, pending_sync: 1 }, limit: 30, offset: 0 }; const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value).map(([key, value]) => [key, String(value)])); return request<{ ok: boolean; items: WorkItem[]; counts: Record<string, number>; limit: number; offset: number }>(`/collaboration/v1/work-items?${query}`); }
export async function fetchWorkItem(id: string) { if (demoMode) { const item = demoItems.find((entry) => entry.id === id) || demoItems[0]; const oem = item.itemType === "packaging_quote" ? { artifacts: [], quotes: [], milestones: [] } : null; return { ok: true, item, lines: oem ? [] : [{ id: "line-1", sku: "TZKJ-DEMO-001", productName: "海盐净润洗发露", imageUrl: "", plannedQuantity: 240, completedQuantity: 0, unit: "件", lotNo: "LOT-260920-A", barcode: "697000000001", productionDate: "2026-09-20", expiryDate: "2029-09-19" }, { id: "line-2", sku: "TZKJ-DEMO-002", productName: "森系修护发膜", imageUrl: "", plannedQuantity: 120, completedQuantity: 0, unit: "件", lotNo: "LOT-260921-B", barcode: "697000000002", productionDate: "2026-09-21", expiryDate: "2029-09-20" }], events: [{ id: "event-1", eventType: oem ? "core.oem_projection" : "core.projection", actorName: "供应链中台", body: oem ? "包装询价已发布至贵司私有空间" : "任务已发布到华东协同仓", metadata: {}, createdAt: item.createdAt }], attachments: [], commands: [], oem } as { ok: true } & WorkItemDetail; } return request<{ ok: boolean } & WorkItemDetail>(`/collaboration/v1/work-items/${id}`); }
export async function submitAction(id: string, version: number, body: Record<string, unknown>) { if (demoMode) return { ok: true, item: { ...demoItems[0], status: body.action === "accept" ? "accepted" : "pending_sync", version: version + 1 } }; return request<{ ok: boolean; item: WorkItem }>(`/collaboration/v1/work-items/${id}/actions`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID(), "If-Match": String(version) }, body: JSON.stringify(body) }); }
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
