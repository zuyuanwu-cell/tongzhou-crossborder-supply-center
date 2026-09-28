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

export function bootstrapCollaborationOrganization(input: {
  code: string;
  name: string;
  organizationType: CollaborationOrganizationType;
  status: CollaborationOrganizationStatus;
  notificationEmail?: string;
  administrator: { username: string; email: string };
}) {
  return request<{ ok: boolean } & CollaborationInvitationResult>("/api/collaboration-bridge/organizations/bootstrap", {
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
