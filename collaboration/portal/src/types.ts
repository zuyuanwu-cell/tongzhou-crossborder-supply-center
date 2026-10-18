export type Organization = { id: string; code: string; name: string; type: string };
export type WorkspaceResource = { key: string; resourceType: "warehouse" | "organization"; resourceRef: string; resourceName: string; permissions: string[] };
export type PartnerWorkspace = { modules: string[]; taskTypes: string[]; actions: string[]; capabilities: string[]; resources: WorkspaceResource[] };
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
  workspace: PartnerWorkspace;
};
export type Dashboard = { openTasks: number; urgentTasks: number; waitingTasks: number; unreadNotifications: number; inventorySkuCount: number; inventorySyncedAt: string; productionOrders: number; purchaseOrders: number; dueSoonTasks: number; exceptionReports: number };
export type WorkItemStatus = "pending" | "accepted" | "in_progress" | "pending_approval" | "pending_sync" | "completed" | "rejected" | "cancelled";
export type FirstArticleBomItem = { category: string; name: string; materialCode: string; netContent: string; unit: string; composition: string };
export type FirstArticleImage = { category: "packaging" | "inner_pack" | "coding" | "finished" | "carton"; label: string; name: string; url: string; mime: string; size: number };
export type FirstArticleRecord = {
  matchedBy: "barcode" | "sku" | "product_name"; documentNo: string; version: string; productSku: string; productName: string;
  specification: string; brandName: string; unit: string; barcode: string; filingName: string; bpom: string;
  productionProcess: string; cartonSpecification: string; updatedAt: string; bom: FirstArticleBomItem[]; images: FirstArticleImage[];
};
export type PurchaseInboundDocument = { inboundNo: string; inboundAt: string; receivedQuantity: number; payableAmount: number; settlementStatus: string };
export type WorkItem = {
  id: string; spaceId: string; itemType: string; title: string; description: string; status: WorkItemStatus; priority: "normal" | "urgent";
  publicPayload: { referenceNo?: string; warehouseRef?: string; warehouseName?: string; sourceWarehouseName?: string; destinationWarehouseName?: string; note?: string; projectCode?: string; productName?: string; productImageUrl?: string; productSpec?: string; barcode?: string; productionProcess?: string; cartonType?: string; piecesPerCarton?: number; factoryExpectedDeliveryDate?: string; documentVersion?: string; requirements?: string; quantity?: number; unit?: string; deliveryDate?: string; quoteCurrency?: string; orderNo?: string; fulfillmentMode?: "labor_only" | "turnkey" | "supplier"; deliveryAddress?: string; paymentTerms?: string; currency?: string; linkedProductionOrderNo?: string; orderedAt?: string; settlementBasis?: "" | "purchase_inbound"; orderAmount?: number; receivedQuantity?: number; pendingReceiptQuantity?: number; payableAmount?: number; settlementStatus?: string; inboundDocuments?: PurchaseInboundDocument[]; sampleCategory?: "inner_material" | "packaging"; sampleSubject?: "formula" | "raw_material" | "packaging_box" | "packaging_bottle"; sampleGoal?: string; evaluationCriteria?: string; quoteRequired?: boolean; packagingSpec?: { material?: string; process?: string; structureType?: string; lengthMm?: number; widthMm?: number; heightMm?: number; diameterMm?: number; capacityMl?: number; colorPrinting?: string; designVersion?: string; fileRequirements?: string }; firstArticle?: FirstArticleRecord; workOrder?: { workOrderId: string; workflowVersion?: number; requestNo: string; expectedArrivalAt: string; senderName: string; senderContact: string; inboundCarrier: string; inboundTrackingNo: string; instructions: string; destinationCountry: string; destinationWarehouseName: string; expenseCategories: string[]; lineRequirements?: Record<string, { shelfLifeManaged?: boolean }> } };
  dueAt: string; version: number; lastCoreSyncedAt: string; createdAt: string; updatedAt: string;
};
export type TaskLine = { id: string; sourceLineId: string; sku: string; productName: string; imageUrl: string; plannedQuantity: number; completedQuantity: number; unit: string; lotNo: string; barcode: string; productionDate: string; expiryDate: string };
export type WorkEvent = { id: string; eventType: string; actorName: string; body: string; metadata: Record<string, unknown>; createdAt: string };
export type Attachment = { id: string; fileName: string; mimeType: string; sizeBytes: number; scanStatus: string; createdAt: string };
export type WorkCommand = { id: string; commandType: string; status: string; payload: Record<string, unknown>; submittedAt: string; processedAt: string; resultCode: string; resultMessage: string; coreReference: string };
export type SampleVariant = { variantCode?: string; supplierMaterialCode?: string; name: string; sampleQuantity?: number; unit?: string; specificationVersion?: string; description?: string; material?: string; process?: string; structureType?: string; lengthMm?: number; widthMm?: number; heightMm?: number; diameterMm?: number; capacityMl?: number; colorPrinting?: string };
export type OemArtifact = { id: string; artifactType: string; title: string; version: number; status: string; publicPayload: { summary?: string; result?: string; roundNo?: number; sampleCategory?: string; sampleSubject?: string; sampleQuantity?: number; unit?: string; specificationVersion?: string; supplierConclusion?: string; nextPlan?: string; reviewNote?: string; reviewedBy?: string; reviewedAt?: string; approvedVariantCode?: string; approvedSupplierMaterialCode?: string; sampleVariants?: SampleVariant[]; attachmentIds?: string[] }; createdAt: string; updatedAt: string };
export type SupplierQuote = { id: string; currency: string; amount: number; minimumOrderQuantity: number; leadTimeDays: number; terms: string; status: string; version: number; sampleArtifactId?: string; sampleVersion?: number | null; sampleVariantCode?: string; submittedAt: string };
export type ProductionMilestone = { id: string; milestoneType: string; title: string; plannedAt: string; completedAt: string; status: "pending" | "in_progress" | "completed" | "blocked"; publicPayload: { note?: string }; version: number; updatedAt: string };
export type PartnerOrderLine = { id: string; lineRef: string; lineType: "finished_product" | "raw_material" | "packaging"; sku: string; productName: string; specification: string; imageUrl: string; plannedQuantity: number; completedQuantity: number; unit: string; requiredAt: string; responsibility: "tongzhou" | "factory" | "supplier"; unitPrice: number | null; currency: string };
export type PartnerOrderReport = { id: string; workItemId: string; lineId: string; commandId: string; reportType: "production_progress" | "material_readiness" | "purchase_fulfillment" | "exception" | "shipment"; stage: string; progressPercent: number | null; result: string; quantity: number | null; expectedAt: string; severity: string; title: string; note: string; details: Record<string, string | number | boolean | null>; submittedBy: string; createdAt: string };
export type WorkItemDetail = { item: WorkItem; lines: TaskLine[]; events: WorkEvent[]; attachments: Attachment[]; commands: WorkCommand[]; oem?: { artifacts: OemArtifact[]; quotes: SupplierQuote[]; milestones: ProductionMilestone[] } | null; partnerOrder?: { lines: PartnerOrderLine[]; reports: PartnerOrderReport[] } | null };
export type InventoryItem = { warehouseRef: string; warehouseName: string; sku: string; productName: string; barcode: string; imageUrl: string; availableQuantity: number; lockedQuantity: number; inTransitQuantity: number; unit: string; lastCoreSyncedAt: string; version: number };
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
