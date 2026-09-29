import { resolveApiUrl } from "./api";

export type CollaborationOrganizationStatus = "active" | "suspended" | "archived";
export type CollaborationOrganizationType = "warehouse" | "filing_service" | "sampling_factory" | "packaging_factory" | "production_factory" | "internal";

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

export function reissueCollaborationInvitation(invitationId: string) {
  return request<{ ok: boolean } & CollaborationInvitationResult>(`/api/collaboration-bridge/invitations/${encodeURIComponent(invitationId)}/reissue`, { method: "POST", body: "{}" });
}

export function revokeCollaborationInvitation(invitationId: string) {
  return request<{ ok: boolean; invitation: CollaborationInvitation }>(`/api/collaboration-bridge/invitations/${encodeURIComponent(invitationId)}/revoke`, { method: "POST", body: "{}" });
}
