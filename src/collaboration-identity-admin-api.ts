import { resolveApiUrl } from "./api";

export type CollaborationOrganizationStatus = "active" | "suspended" | "archived";
export type CollaborationOrganizationType = "warehouse" | "filing_service" | "sampling_factory" | "packaging_factory" | "production_factory" | "material_supplier" | "internal";

export type CollaborationOrganization = {
  id: string;
  code: string;
  name: string;
  organizationType: CollaborationOrganizationType;
  status: CollaborationOrganizationStatus;
  metadata?: { notificationEmail?: string; wecomWebhook?: string };
  memberCount?: number;
  activeMemberCount?: number;
  administratorCount?: number;
  pendingInvitationCount?: number;
  lastLoginAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CollaborationMember = {
  id: string;
  userId: string;
  username: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  userStatus: string;
  mfaRequired: boolean;
  mfaEnabled: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string;
  createdAt: string;
};

export type CollaborationInvitation = {
  id: string;
  username: string;
  email: string;
  role: string;
  mfaRequired: boolean;
  status: "pending" | "expired" | "accepted";
  expiresAt: string;
  acceptedAt: string;
  createdAt: string;
};

export type CollaborationOrganizationAccess = {
  organization: CollaborationOrganization;
  members: CollaborationMember[];
  invitations: CollaborationInvitation[];
};

export type CollaborationInvitationResult = {
  organization?: CollaborationOrganization;
  invitation: CollaborationInvitation;
  delivery?: { sent: boolean; channel?: string; reason?: string; message?: string };
  activationUrl?: string;
};

export type CollaborationBootstrapResult = {
  organization: CollaborationOrganization;
  administrator: {
    membershipId: string;
    userId: string;
    username: string;
    displayName: string;
    email: string;
    role: string;
    mfaRequired: boolean;
    mustChangePassword: boolean;
  };
};

export type CollaborationAccessGrant = {
  id?: string;
  resourceType: "warehouse" | "organization";
  resourceRef: string;
  resourceName: string;
  permissions: string[];
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CollaborationCapability = {
  key: string;
  label: string;
  description: string;
};

export type CollaborationAccessGrantPayload = {
  organization: { code: string; name: string; organizationType: CollaborationOrganizationType };
  grants: CollaborationAccessGrant[];
  capabilities: CollaborationCapability[];
  resources?: Array<{ resourceRef: string; resourceName: string; capabilities: CollaborationCapability[] }>;
  defaultResourceRef?: string;
};

export type CollaborationApproval = {
  commandId: string;
  organizationCode: string;
  workItemId: string;
  coreRefType: string;
  coreRefId: string;
  itemType: string;
  commandType: string;
  payload: { action?: string; note?: string; reason?: string; lines?: Array<{ sku: string; quantity: number; direction?: string }> };
  submittedByName: string;
  submittedAt: string;
  riskLevel: string;
  status: string;
};

export type CollaborationPartnerTaskType = "production_order" | "purchase_order" | "sampling_task";

export type CollaborationFirstArticleRecord = {
  matchedBy: "barcode" | "sku" | "product_name"; documentNo: string; version: string; productSku: string; productName: string;
  specification: string; brandName: string; unit: string; barcode: string; filingName: string; bpom: string;
  productionProcess: string; cartonSpecification: string; updatedAt: string;
  bom: Array<{ category: string; name: string; materialCode: string; netContent: string; unit: string; composition: string }>;
  images: Array<{ category: "packaging" | "inner_pack" | "coding" | "finished" | "carton"; label: string; name: string; url: string; mime: string; size: number }>;
};

export type CollaborationPartnerWorkItem = {
  id: string;
  organizationCode: string;
  organizationName: string;
  coreRefType: string;
  coreRefId: string;
  itemType: CollaborationPartnerTaskType;
  title: string;
  description: string;
  status: string;
  priority: string;
  publicPayload: Record<string, any> & { firstArticle?: CollaborationFirstArticleRecord };
  dueAt: string;
  version: number;
  lastCoreSyncedAt: string;
  createdAt: string;
  updatedAt: string;
  sampling?: { roundCount: number; pendingReviewCount: number; approvedVersion: number | null; quoteCount: number; awardedQuoteCount: number };
};

export type CollaborationPartnerOrderLine = {
  id: string; lineRef: string; lineType: "finished_product" | "raw_material" | "packaging"; sku: string; productName: string;
  specification: string; imageUrl: string; plannedQuantity: number; completedQuantity: number; unit: string; requiredAt: string;
  responsibility: "tongzhou" | "factory" | "supplier"; unitPrice: number | null; currency: string;
};

export type CollaborationPartnerOrderReport = {
  id: string; workItemId: string; lineId: string; commandId: string; reportType: "production_progress" | "material_readiness" | "purchase_fulfillment" | "exception" | "shipment";
  stage: string; progressPercent: number | null; result: string; quantity: number | null; expectedAt: string; severity: string; title: string; note: string;
  details: Record<string, string | number | boolean | null>; submittedBy: string; submittedByName: string; createdAt: string;
};

export type CollaborationPartnerWorkItemDetail = {
  item: CollaborationPartnerWorkItem;
  lines: Array<{ id: string; sku: string; productName: string; imageUrl: string; plannedQuantity: number; completedQuantity: number; unit: string }>;
  events: Array<{ id: string; eventType: string; actorName: string; body: string; metadata: Record<string, unknown>; createdAt: string }>;
  attachments: Array<{ id: string; fileName: string; mimeType: string; sizeBytes: number; scanStatus: string; createdAt: string }>;
  commands: Array<{ id: string; commandType: string; status: string; riskLevel: string; submittedAt: string; processedAt: string; resultCode: string; resultMessage: string; coreReference: string }>;
  partnerOrder: null | {
    lines: CollaborationPartnerOrderLine[];
    reports: CollaborationPartnerOrderReport[];
    milestones: Array<{ id: string; milestoneType: string; title: string; plannedAt: string; completedAt: string; status: string; publicPayload: { note?: string }; version: number; updatedAt: string }>;
  };
  oem: null | {
    artifacts: Array<{ id: string; artifactType: string; title: string; version: number; status: string; publicPayload: { summary?: string; result?: string; reviewNote?: string; supplierConclusion?: string; nextPlan?: string; sampleQuantity?: number; unit?: string; specificationVersion?: string; reviewedBy?: string; reviewedAt?: string; approvedVariantCode?: string; approvedSupplierMaterialCode?: string; attachmentIds?: string[]; sampleVariants?: Array<{ variantCode: string; supplierMaterialCode?: string; name: string; sampleQuantity?: number; unit?: string; specificationVersion?: string; description?: string; material?: string; process?: string; structureType?: string; lengthMm?: number; widthMm?: number; heightMm?: number; diameterMm?: number; capacityMl?: number; colorPrinting?: string }> }; createdAt: string; updatedAt: string }>;
    quotes: Array<{ id: string; currency: string; amount: number; minimumOrderQuantity: number; leadTimeDays: number; terms: string; status: string; version: number; sampleArtifactId: string; sampleVersion: number | null; sampleVariantCode?: string; submittedAt: string }>;
  };
};

export type CollaborationPartnerTaskInput = {
  taskType: CollaborationPartnerTaskType;
  documentNo?: string;
  title?: string;
  productName: string;
  productSpec?: string;
  description?: string;
  requirements?: string;
  priority?: "normal" | "urgent";
  dueAt?: string;
  quantity: number;
  unit?: string;
  fulfillmentMode?: "labor_only" | "turnkey";
  deliveryAddress?: string;
  sampleCategory?: "inner_material" | "packaging";
  sampleSubject?: "formula" | "raw_material" | "packaging_box" | "packaging_bottle";
  sampleGoal?: string;
  evaluationCriteria?: string;
  quoteRequired?: boolean;
  packagingSpec?: { material?: string; process?: string; structureType?: string; lengthMm?: number; widthMm?: number; heightMm?: number; diameterMm?: number; capacityMl?: number; colorPrinting?: string; designVersion?: string; fileRequirements?: string };
  lines?: Array<{ sku: string; productName: string; specification?: string; imageUrl?: string; plannedQuantity: number; unit?: string; lineType?: "finished_product" | "raw_material" | "packaging" }>;
};

export type CollaborationOutsourcingFactoryOption = {
  factoryId: string;
  factoryName: string;
  factoryFullName: string;
  activeOrderCount: number;
};

export type CollaborationOutsourcingSource = {
  ok: boolean;
  source: { appName: string; formName: string; mode: "read_only_projection" };
  binding: null | (CollaborationOutsourcingFactoryOption & { inferred: boolean; boundAt: string; boundBy: string });
  options: CollaborationOutsourcingFactoryOption[];
  activeOrderCount: number;
  trackedOrderCount: number;
  lastSyncedAt: string;
};

const AUTH_TOKEN_KEY = "tongzhou_auth_token";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  const response = await fetch(resolveApiUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((init?.headers as Record<string, string> | undefined) || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `请求失败（HTTP ${response.status}）`);
  return payload as T;
}

export async function fetchCollaborationOrganizations(filters: { keyword?: string; status?: string } = {}) {
  const query = new URLSearchParams();
  if (filters.keyword) query.set("keyword", filters.keyword);
  if (filters.status) query.set("status", filters.status);
  const suffix = query.size ? `?${query}` : "";
  return request<{ ok: boolean; organizations: CollaborationOrganization[] }>(`/api/collaboration-bridge/organizations${suffix}`);
}

export function fetchCollaborationOrganizationAccess(code: string) {
  return request<{ ok: boolean } & CollaborationOrganizationAccess>(`/api/collaboration-bridge/organizations/${encodeURIComponent(code)}`);
}

export function fetchCollaborationOrganizationAccessGrants(code: string) {
  return request<{ ok: boolean } & CollaborationAccessGrantPayload>(`/api/collaboration-bridge/organizations/${encodeURIComponent(code)}/access-grants`);
}

export function replaceCollaborationOrganizationAccessGrants(code: string, grants: CollaborationAccessGrant[]) {
  return request<{ ok: boolean; grants: CollaborationAccessGrant[]; capabilities: CollaborationCapability[]; resources?: CollaborationAccessGrantPayload["resources"] }>(`/api/collaboration-bridge/organizations/${encodeURIComponent(code)}/access-grants`, {
    method: "PUT",
    body: JSON.stringify({ grants }),
  });
}

export function fetchCollaborationOrganizationWorkItems(code: string, itemType?: CollaborationPartnerTaskType) {
  const query = new URLSearchParams({ limit: "100" });
  if (itemType) query.set("itemType", itemType);
  return request<{ ok: boolean; items: CollaborationPartnerWorkItem[]; counts: Record<string, number>; total: number }>(`/api/collaboration-bridge/organizations/${encodeURIComponent(code)}/work-items?${query}`);
}

export function fetchCollaborationOrganizationWorkItem(code: string, workItemId: string) {
  return request<{ ok: boolean } & CollaborationPartnerWorkItemDetail>(`/api/collaboration-bridge/organizations/${encodeURIComponent(code)}/work-items/${encodeURIComponent(workItemId)}`);
}

export async function downloadCollaborationOrganizationWorkItemAttachment(code: string, workItemId: string, attachmentId: string) {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  const response = await fetch(resolveApiUrl(`/api/collaboration-bridge/organizations/${encodeURIComponent(code)}/work-items/${encodeURIComponent(workItemId)}/attachments/${encodeURIComponent(attachmentId)}`), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || `附件下载失败（HTTP ${response.status}）`);
  }
  return { blob: await response.blob(), disposition: response.headers.get("content-disposition") || "" };
}

export async function uploadCollaborationOrganizationWorkItemAttachment(code: string, workItemId: string, file: File) {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const mimeType = file.type || ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf", csv: "text/csv", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } as Record<string, string>)[extension] || "application/octet-stream";
  const response = await fetch(resolveApiUrl(`/api/collaboration-bridge/organizations/${encodeURIComponent(code)}/work-items/${encodeURIComponent(workItemId)}/attachments`), {
    method: "PUT",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": mimeType,
      "X-File-Name": encodeURIComponent(file.name),
    },
    body: file,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `附件上传失败（HTTP ${response.status}）`);
  return payload as { ok: boolean; attachmentId: string; fileName: string; mimeType: string; sizeBytes: number; scanStatus: string };
}

export function publishCollaborationPartnerTask(code: string, input: CollaborationPartnerTaskInput) {
  return request<{ ok: boolean; eventId: string; coreRefId: string; workItemId: string; status: string; delivery: { published: number; failed: number; disabled: boolean } }>(`/api/collaboration-bridge/organizations/${encodeURIComponent(code)}/work-items`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function reviewCollaborationSampleArtifact(artifactId: string, approved: boolean, note: string, approvedVariantCode = "") {
  return request<{ ok: boolean; artifactId: string; workItemId: string; status: "approved" | "rejected"; version: number; workItemVersion: number }>(`/api/collaboration-bridge/oem/artifacts/${encodeURIComponent(artifactId)}/review`, {
    method: "POST",
    body: JSON.stringify({ approved, note, approvedVariantCode }),
  });
}

export function awardCollaborationSupplierQuote(quoteId: string, approvalReference: string) {
  return request<{ ok: boolean; quoteId: string; status: string; coreRefId: string }>(`/api/collaboration-bridge/oem/quotes/${encodeURIComponent(quoteId)}/award`, {
    method: "POST",
    body: JSON.stringify({ approvalReference }),
  });
}

export function fetchCollaborationOutsourcingSource(code: string, refresh = false) {
  return request<CollaborationOutsourcingSource>(`/api/collaboration-bridge/organizations/${encodeURIComponent(code)}/outsourcing-source${refresh ? "?refresh=1" : ""}`);
}

export function saveCollaborationOutsourcingSource(code: string, factoryId: string) {
  return request<{ ok: boolean; binding: NonNullable<CollaborationOutsourcingSource["binding"]>; synchronization: { queued: number; unchanged: number; failed: number }; delivery: { published: number; failed: number; disabled: boolean } }>(`/api/collaboration-bridge/organizations/${encodeURIComponent(code)}/outsourcing-source`, {
    method: "PUT",
    body: JSON.stringify({ factoryId }),
  });
}

export function syncCollaborationOutsourcingSource(code: string) {
  return request<{ ok: boolean; synchronization: { queued: number; unchanged: number; failed: number }; delivery: { published: number; failed: number; disabled: boolean } }>(`/api/collaboration-bridge/organizations/${encodeURIComponent(code)}/outsourcing-source/sync`, {
    method: "POST",
    body: "{}",
  });
}

export function fetchCollaborationApprovals() {
  return request<{ ok: boolean; approvals: CollaborationApproval[] }>("/api/collaboration-bridge/approvals");
}

export function reviewCollaborationCommand(commandId: string, approved: boolean, note: string) {
  return request<{ ok: boolean; status: string; message?: string; coreReference?: string }>(`/api/collaboration-bridge/commands/${encodeURIComponent(commandId)}/review`, {
    method: "POST",
    body: JSON.stringify({ approved, note }),
  });
}

export function bootstrapCollaborationOrganization(input: {
  name: string;
  organizationType: CollaborationOrganizationType;
  status: CollaborationOrganizationStatus;
  notificationEmail?: string;
  administrator: { username: string; displayName?: string; email?: string; password: string };
}) {
  return request<{ ok: boolean } & CollaborationBootstrapResult>("/api/collaboration-bridge/organizations/bootstrap", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateCollaborationOrganizationStatus(code: string, status: CollaborationOrganizationStatus) {
  return request<{ ok: boolean; organization: CollaborationOrganization }>(`/api/collaboration-bridge/organizations/${encodeURIComponent(code)}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function updateCollaborationMemberCredentials(code: string, membershipId: string, input: { username?: string; password?: string }) {
  return request<{ ok: boolean; member: CollaborationMember; passwordReset: boolean; sessionsRevoked: number }>(`/api/collaboration-bridge/organizations/${encodeURIComponent(code)}/members/${encodeURIComponent(membershipId)}/credentials`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function reissueCollaborationInvitation(invitationId: string) {
  return request<{ ok: boolean } & CollaborationInvitationResult>(`/api/collaboration-bridge/invitations/${encodeURIComponent(invitationId)}/reissue`, { method: "POST", body: "{}" });
}

export function revokeCollaborationInvitation(invitationId: string) {
  return request<{ ok: boolean; invitation: CollaborationInvitation }>(`/api/collaboration-bridge/invitations/${encodeURIComponent(invitationId)}/revoke`, { method: "POST", body: "{}" });
}
