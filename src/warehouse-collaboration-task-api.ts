import { resolveApiUrl } from "./api";

export type CollaborationWarehouseTaskType = "warehouse_inbound" | "warehouse_outbound" | "warehouse_stockup" | "warehouse_exception";
export type CollaborationWarehouseTaskStatus = "pending" | "accepted" | "in_progress" | "pending_approval" | "pending_sync" | "completed" | "rejected" | "cancelled";

export type CollaborationTaskWarehouse = {
  resourceRef: string;
  resourceName: string;
  permissions: string[];
  skuCount: number;
  updatedAt?: string;
};

export type CollaborationTaskOrganization = {
  code: string;
  name: string;
  warehouses: CollaborationTaskWarehouse[];
};

export type CollaborationTaskProduct = {
  sku: string;
  productName: string;
  imageUrl: string;
  unit: string;
  availableByWarehouse: Record<string, number>;
};

export type CollaborationTaskOptions = {
  ok: boolean;
  portalUrl: string;
  organizations: CollaborationTaskOrganization[];
  products: CollaborationTaskProduct[];
};

export type CollaborationWarehouseTask = {
  id: string;
  organizationCode: string;
  organizationName: string;
  coreRefType: string;
  coreRefId: string;
  itemType: CollaborationWarehouseTaskType | "warehouse_transfer";
  title: string;
  description: string;
  status: CollaborationWarehouseTaskStatus;
  priority: "normal" | "urgent";
  publicPayload: { referenceNo?: string; warehouseRef?: string; warehouseName?: string; note?: string };
  dueAt: string;
  version: number;
  lastCoreSyncedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type CollaborationWarehouseTaskDetail = {
  item: CollaborationWarehouseTask;
  lines: Array<{
    id: string;
    sku: string;
    productName: string;
    imageUrl: string;
    plannedQuantity: number;
    completedQuantity: number;
    unit: string;
    lotNo: string;
    barcode: string;
    productionDate: string;
    expiryDate: string;
  }>;
  events: Array<{ id: string; eventType: string; actorName: string; body: string; metadata: Record<string, unknown>; createdAt: string }>;
  attachments: Array<{ id: string; fileName: string; mimeType: string; sizeBytes: number; scanStatus: string; createdAt: string }>;
  commands: Array<{ id: string; commandType: string; status: string; riskLevel: string; submittedAt: string; processedAt: string; resultCode: string; resultMessage: string; coreReference: string }>;
};

const AUTH_TOKEN_KEY = "tongzhou_auth_token";

function authHeaders(extra: Record<string, string> = {}) {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(resolveApiUrl(path), {
    ...init,
    headers: authHeaders({
      "Content-Type": "application/json",
      ...((init?.headers as Record<string, string> | undefined) || {}),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `请求失败（HTTP ${response.status}）`);
  return payload as T;
}

export function fetchCollaborationTaskOptions() {
  return request<CollaborationTaskOptions>("/api/collaboration-bridge/warehouse-tasks/options");
}

export function fetchCollaborationWarehouseTasks(filters: { organizationCode?: string; status?: string; itemType?: string; keyword?: string; limit?: number; offset?: number } = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && String(value).trim()) query.set(key, String(value));
  return request<{ items: CollaborationWarehouseTask[]; counts: Record<string, number>; total: number; limit: number; offset: number }>(`/api/collaboration-bridge/warehouse-tasks${query.size ? `?${query}` : ""}`);
}

export function fetchCollaborationWarehouseTask(id: string) {
  return request<CollaborationWarehouseTaskDetail>(`/api/collaboration-bridge/warehouse-tasks/${encodeURIComponent(id)}`);
}

export function publishCollaborationWarehouseTask(input: {
  organizationCode: string;
  warehouseRef: string;
  itemType: CollaborationWarehouseTaskType;
  referenceNo?: string;
  title: string;
  description: string;
  priority: "normal" | "urgent";
  dueAt: string;
  lines: Array<{ sku: string; plannedQuantity: number; unit: string }>;
}, idempotencyKey: string) {
  return request<{ ok: boolean; eventId: string; coreRefId: string; referenceNo: string; status: string; idempotentReplay?: boolean; delivery: { published: number; failed: number; disabled?: boolean } }>("/api/collaboration-bridge/warehouse-tasks", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(input),
  });
}

export async function downloadCollaborationTaskAttachment(workItemId: string, attachmentId: string, fallbackName: string) {
  const response = await fetch(resolveApiUrl(`/api/collaboration-bridge/warehouse-tasks/${encodeURIComponent(workItemId)}/attachments/${encodeURIComponent(attachmentId)}`), { headers: authHeaders() });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || `附件下载失败（HTTP ${response.status}）`);
  }
  const disposition = response.headers.get("content-disposition") || "";
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plainName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  const fileName = encodedName ? decodeURIComponent(encodedName) : plainName || fallbackName;
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
