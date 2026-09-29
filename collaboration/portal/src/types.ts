export type Organization = { id: string; code: string; name: string; type: string };
export type Session = {
  user: { id: string; username: string; displayName: string; email: string };
  membership: { id: string; organizationId: string; organizationCode: string; organizationName: string; organizationType: string; role: string; status: string; permissions: string[]; mfaRequired: boolean };
  organization: Organization;
  mfaRequired: boolean;
  mfaEnabled: boolean;
  mfaVerifiedAt: string;
  pendingMfa: boolean;
  mustChangePassword: boolean;
  oemEnabled: boolean;
};
export type Dashboard = { openTasks: number; urgentTasks: number; waitingTasks: number; unreadNotifications: number; inventorySkuCount: number; inventorySyncedAt: string };
export type WorkItemStatus = "pending" | "accepted" | "in_progress" | "pending_approval" | "pending_sync" | "completed" | "rejected" | "cancelled";
export type WorkItem = {
  id: string; spaceId: string; itemType: string; title: string; description: string; status: WorkItemStatus; priority: "normal" | "urgent";
  publicPayload: { referenceNo?: string; warehouseRef?: string; warehouseName?: string; sourceWarehouseName?: string; destinationWarehouseName?: string; note?: string; projectCode?: string; productName?: string; productSpec?: string; documentVersion?: string; requirements?: string; quantity?: number; unit?: string; deliveryDate?: string; quoteCurrency?: string };
  dueAt: string; version: number; lastCoreSyncedAt: string; createdAt: string; updatedAt: string;
};
export type TaskLine = { id: string; sku: string; productName: string; imageUrl: string; plannedQuantity: number; completedQuantity: number; unit: string; lotNo: string; barcode: string; productionDate: string; expiryDate: string };
export type WorkEvent = { id: string; eventType: string; actorName: string; body: string; metadata: Record<string, unknown>; createdAt: string };
export type Attachment = { id: string; fileName: string; mimeType: string; sizeBytes: number; scanStatus: string; createdAt: string };
export type WorkCommand = { id: string; commandType: string; status: string; submittedAt: string; processedAt: string; resultCode: string; resultMessage: string; coreReference: string };
export type OemArtifact = { id: string; artifactType: string; title: string; version: number; status: string; publicPayload: { summary?: string; result?: string }; createdAt: string; updatedAt: string };
export type SupplierQuote = { id: string; currency: string; amount: number; minimumOrderQuantity: number; leadTimeDays: number; terms: string; status: string; version: number; submittedAt: string };
export type ProductionMilestone = { id: string; milestoneType: string; title: string; plannedAt: string; completedAt: string; status: "pending" | "in_progress" | "completed" | "blocked"; publicPayload: { note?: string }; version: number; updatedAt: string };
export type WorkItemDetail = { item: WorkItem; lines: TaskLine[]; events: WorkEvent[]; attachments: Attachment[]; commands: WorkCommand[]; oem?: { artifacts: OemArtifact[]; quotes: SupplierQuote[]; milestones: ProductionMilestone[] } | null };
export type InventoryItem = { warehouseRef: string; warehouseName: string; sku: string; productName: string; imageUrl: string; availableQuantity: number; lockedQuantity: number; inTransitQuantity: number; unit: string; lastCoreSyncedAt: string; version: number };
export type WarehouseOperationType = "inbound" | "outbound" | "stocktake";
export type WarehouseOperationLine = { sku: string; productName: string; imageUrl?: string; quantity?: number; countedQuantity?: number; unit: string; lotNo?: string; barcode?: string; productionDate?: string; expiryDate?: string };
export type NotificationItem = { id: string; workItemId: string; title: string; body: string; channel: string; deliveryStatus: string; readAt: string; createdAt: string };
export type OrganizationMemberRole = "organization_admin" | "manager" | "operator" | "finance" | "viewer";
export type OrganizationMember = {
  id: string; userId: string; username: string; email: string; displayName: string; userStatus: string;
  role: OrganizationMemberRole; status: "active" | "disabled"; permissions: string[]; mfaRequired: boolean; mfaEnabled: boolean;
  mustChangePassword: boolean; lastLoginAt: string; createdAt: string;
};
export type OrganizationInvitation = {
  id: string; username: string; email: string; role: OrganizationMemberRole; mfaRequired: boolean;
  status: "pending" | "expired" | "accepted"; expiresAt: string; acceptedAt: string; createdAt: string;
};
export type InvitationDeliveryResult = {
  invitation: OrganizationInvitation;
  delivery?: { sent: boolean; channel?: string; reason?: string; message?: string };
  activationUrl?: string;
};
