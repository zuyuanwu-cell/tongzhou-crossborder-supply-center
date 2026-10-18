export type StockupCollaborationLine = {
  id: string;
  requestId: string;
  productId: string;
  sku: string;
  productName: string;
  imageUrl: string;
  specification: string;
  method: string;
  requestedQty: number;
  unit: string;
  targetUnitCostCny: number | null;
  expectedArrivalAt: string;
  note: string;
  status: string;
  fulfilledQty: number;
  productRefId: string;
  procurementUrl: string;
  shelfLifeManaged: boolean;
};
export type StockupExecutionTask = {
  id: string;
  requestId: string;
  lineId: string;
  taskNo: string;
  method: string;
  assigneeId: string;
  assigneeName: string;
  supplierName: string;
  plannedQty: number;
  orderedQty: number;
  completedQty: number;
  status: string;
  expectedOrderAt: string;
  expectedCompletedAt: string;
  actualOrderedAt: string;
  actualCompletedAt: string;
  exceptionType: string;
  exceptionNote: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type StockupShipmentLine = {
  id: string;
  shipmentId: string;
  requestId: string;
  taskId: string;
  lineId: string;
  sku: string;
  productName: string;
  imageUrl: string;
  shippedQty: number;
  unit: string;
  baseUnitCostCny: number;
  weightKg: number;
  volumeM3: number;
  cartonCount: number;
  unitsPerCarton: number;
  cartonLengthCm: number;
  cartonWidthCm: number;
  cartonHeightCm: number;
  cartonWeightKg: number;
  productRefId: string;
  purchaseOrderLineId: string;
  inspectionLotId: string;
};

export type StockupShipment = {
  id: string;
  requestId: string;
  shipmentNo: string;
  originWarehouse: string;
  originWarehouseId: string;
  originAddress: string;
  destinationWarehouseId: string;
  destinationWarehouseName: string;
  destinationCountry: string;
  destinationAddress: string;
  destinationContactName: string;
  destinationContactPhone: string;
  carrier: string;
  transportMode: string;
  trackingNo: string;
  etd: string;
  eta: string;
  actualShippedAt: string;
  status: string;
  packages: number;
  totalWeightKg: number;
  totalVolumeM3: number;
  chargeableWeightKg: number;
  note: string;
  boxMark: string;
  inventoryMovementId: string;
  wmsProviderId: string;
  wmsDocumentType: "inbound" | "stockup" | "";
  wmsPushStatus: "not_created" | "pushing" | "pushed" | "failed" | "needs_manual_check" | "voided";
  wmsOrderNo: string;
  wmsPushError: string;
  wmsPushAttempts: number;
  wmsPushedAt: string;
  wmsPushedBy: string;
  workflowVersion: number;
  forwarderLocationId: string;
  forwarderSnapshot: Record<string, string>;
  reservationId: string;
  instructionPublishedAt: string;
  instructionPublishedBy: string;
  handedOverAt: string;
  documentVersion: number;
  requestIds?: string[];
  requestNos?: string[];
  version: number;
  lines?: StockupShipmentLine[];
};

export type StockupReceiptLine = {
  id: string;
  receiptId: string;
  shipmentLineId: string;
  lineId: string;
  sku: string;
  productName: string;
  expectedQty: number;
  receivedQty: number;
  goodQty: number;
  damagedQty: number;
  shortageQty: number;
  pendingQty: number;
  shelvedQty: number;
  unit: string;
  exceptionNote: string;
};

export type StockupReceipt = {
  id: string;
  requestId: string;
  shipmentId: string;
  receiptNo: string;
  warehouseId: string;
  warehouseName: string;
  wmsInboundNo: string;
  arrivedAt: string;
  shelvedAt: string;
  status: string;
  note: string;
  lifecycleStatus: "active" | "archived" | "deleted";
  archivedAt: string;
  archivedBy: string;
  deletedAt: string;
  deletedBy: string;
  version: number;
  lines?: StockupReceiptLine[];
};

export type StockupWarehouseOption = {
  id: string;
  name: string;
  country: string;
  status: string;
  address: string;
  contactName: string;
  contactPhone: string;
  providerId?: string;
  wmsDocumentType?: "inbound" | "stockup" | "";
  wmsDocumentLabel?: string;
  wmsCreateSupported?: boolean;
  wmsCreateConfigured?: boolean;
  wmsCreateMode?: string;
  wmsCreateMessage?: string;
};

export type StockupProgressEvent = {
  id: string;
  requestId: string;
  lineId: string;
  taskId: string;
  shipmentId: string;
  receiptId: string;
  eventType: string;
  title: string;
  description: string;
  actorName: string;
  occurredAt: string;
};

export type StockupCostItem = {
  id: string;
  requestId: string;
  shipmentId: string;
  receiptId: string;
  category: string;
  name: string;
  stage: string;
  vendor: string;
  invoiceNo: string;
  occurredAt: string;
  originalAmount: number;
  currency: string;
  exchangeRate: number;
  amountCny: number;
  included: boolean;
  allocationMethod: string;
  note: string;
  status: string;
};

export type StockupRequest = {
  id: string;
  requestNo: string;
  project: string;
  destinationCountry: string;
  destinationWarehouseId: string;
  destinationWarehouseName: string;
  expectedArrivalAt: string;
  priority: string;
  reason: string;
  platform: string;
  note: string;
  status: string;
  progress: number;
  requesterId: string;
  requesterName: string;
  assigneeId: string;
  assigneeName: string;
  exceptionCount: number;
  workflowVersion: number;
  sourceType: "manual" | "agent" | "recommendation" | string;
  sourceRef: string;
  sourceSnapshot: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
  isOverdue?: boolean;
  lines: StockupCollaborationLine[];
  tasks?: StockupExecutionTask[];
  shipments?: StockupShipment[];
  receipts?: StockupReceipt[];
  costItems?: StockupCostItem[];
  costVersions?: Array<Record<string, unknown>>;
  events?: StockupProgressEvent[];
  latestEvent?: StockupProgressEvent;
};

export type StockupRequestListPayload = {
  ok: boolean;
  page: number;
  pageSize: number;
  total: number;
  items: StockupRequest[];
  counts: {
    drafts: number;
    pendingAcceptance: number;
    inProgress: number;
    dueSoon: number;
    exceptions: number;
    completed: number;
  };
};

export type StockupMonthlyCostRow = {
  month: string;
  country: string;
  warehouseId: string;
  warehouseName: string;
  sku: string;
  productName: string;
  receivedQty: number;
  batchCount: number;
  goodsCostCny: number;
  allocatedCostCny: number;
  totalCostCny: number;
  goodsUnitCostCny: number;
  allocatedUnitCostCny: number;
  weightedUnitCostCny: number;
};

export type StockupMonthlyCostPeriod = {
  month: string;
  status: "active" | "archived" | "deleted";
  batchCount: number;
  archivedAt: string;
  archivedBy: string;
  deletedAt: string;
  deletedBy: string;
};

export type StockupWarehouseWorkOrderLine = {
  id: string;
  workOrderId: string;
  requestLineId: string;
  sku: string;
  productName: string;
  imageUrl: string;
  expectedQty: number;
  receivedQty: number;
  goodQty: number;
  damagedQty: number;
  shortageQty: number;
  pendingQty: number;
  unit: string;
  requiresRepack: boolean;
  replacementCartonCount: number;
  lotNo: string;
  barcode: string;
  cartonCount: number;
  unitsPerCarton: number;
  cartonLengthCm: number;
  cartonWidthCm: number;
  cartonHeightCm: number;
  cartonWeightKg: number;
  inspectionNote: string;
  productionDate: string;
  expiryDate: string;
  evidence: StockupInspectionEvidence[];
  productRefId: string;
  purchaseOrderLineId: string;
  lots?: StockupInspectionLot[];
  status: string;
  allocatedQty: number;
  unallocatedQty: number;
  updatedAt: string;
};

export type StockupWarehouseExpense = {
  id: string;
  workOrderId: string;
  category: string;
  name: string;
  amountCny: number;
  occurredAt: string;
  vendor: string;
  invoiceNo: string;
  voucherUrl: string;
  note: string;
  reviewStatus: "pending_review" | "approved" | "rejected" | string;
  includedInCost: boolean;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
};

export type StockupWarehouseRoute = {
  id: string;
  workOrderId: string;
  routeNo: string;
  routeType: "overseas_warehouse" | "domestic_customer" | "hold";
  destinationId: string;
  destinationName: string;
  destinationCountry: string;
  destinationAddress: string;
  contactName: string;
  contactPhone: string;
  carrier: string;
  transportMode: string;
  trackingNo: string;
  freightForwarder: string;
  status: string;
  plannedPickupAt: string;
  dispatchedAt: string;
  deliveredAt: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  lines: Array<{ id: string; routeId: string; workOrderLineId: string; quantity: number }>;
};

export type StockupWarehouseWorkOrder = {
  id: string;
  requestId: string;
  requestNo: string;
  workOrderNo: string;
  project: string;
  organizationCode: string;
  domesticWarehouseId: string;
  domesticWarehouseName: string;
  destinationCountry: string;
  destinationWarehouseId: string;
  destinationWarehouseName: string;
  expectedArrivalAt: string;
  senderName: string;
  senderContact: string;
  inboundCarrier: string;
  inboundTrackingNo: string;
  instructions: string;
  priority: string;
  status: string;
  collaborationEventId: string;
  collaborationCoreRefId: string;
  publishedAt: string;
  publishedBy: string;
  acceptedAt: string;
  completedAt: string;
  exceptionCount: number;
  workflowVersion: number;
  inspectionSubmittedAt: string;
  inspectionReviewedAt: string;
  inspectionReviewedBy: string;
  inspectionReviewNote: string;
  inventoryMovementIds: string[];
  version: number;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  expectedQty: number;
  receivedQty: number;
  goodQty: number;
  damagedQty: number;
  shortageQty: number;
  pendingQty: number;
  allocatedQty: number;
  expenseTotalCny: number;
  lines: StockupWarehouseWorkOrderLine[];
  routes: StockupWarehouseRoute[];
  expenses: StockupWarehouseExpense[];
  events: Array<{ id: string; workOrderId: string; eventType: string; title: string; description: string; actorId: string; actorName: string; occurredAt: string; payload: Record<string, unknown> }>;
};

export type StockupWarehouseDashboard = {
  ok: boolean;
  generatedAt: string;
  counts: Record<string, number>;
  totals: { workOrders: number; expectedQty: number; receivedQty: number; goodQty: number; damagedQty: number; shortageQty: number; expenseCny: number };
  routeBreakdown: { overseas_warehouse: number; domestic_customer: number; hold: number };
  expenseBreakdown: Record<string, number>;
  waitingProducts: Array<{ workOrderId: string; workOrderNo: string; requestNo: string; domesticWarehouseId: string; domesticWarehouseName: string; expectedArrivalAt: string; status: string; priority: string; sku: string; productName: string; imageUrl: string; expectedQty: number; receivedQty: number; unit: string }>;
  workOrders: StockupWarehouseWorkOrder[];
};

export type StockupProductRef = {
  id: string; temporarySku: string; formalSku: string; productId: string; productName: string; imageUrl: string; specification: string;
  shelfLifeManaged: boolean; codingStatus: "temporary" | "coded" | "sync_failed" | string; codingError: string; codedAt: string; codedBy: string;
};

export type StockupPurchaseOrderLine = {
  id: string; purchaseOrderId: string; requestId: string; requestLineId: string; productRefId: string; sku: string; productName: string;
  quantity: number; unit: string; merchandiseAmountCny: number; sharedAllocationCny: number; allocatedAmountCny: number; estimatedUnitCostCny: number;
  receivedQty: number; cancelledQty: number; refundedAmountCny: number; status: string;
};

export type StockupPurchaseOrder = {
  id: string; purchaseNo: string; supplierName: string; platform: string; externalOrderNo: string; orderUrl: string; paidTotalCny: number;
  merchandiseTotalCny: number; sharedAmountCny: number; allocationMode: string; allocationOverrideReason: string; status: string; orderedAt: string;
  vouchers: Array<Record<string, unknown>>; note: string; version: number; lines: StockupPurchaseOrderLine[];
};

export type StockupInspectionEvidence = {
  id?: string; kind: "damage" | "shortage" | "pending" | "repack_before" | "repack_after" | "normal" | string; attachmentId: string; fileName?: string; createdAt?: string;
};

export type StockupInspectionLot = {
  id: string; workOrderId: string; workOrderLineId: string; productRefId: string; purchaseOrderLineId: string; quantity: number; lotNo: string;
  barcode: string; productionDate: string; expiryDate: string; cartonCount: number; unitsPerCarton: number; looseQuantity: number;
  cartonLengthCm: number; cartonWidthCm: number; cartonHeightCm: number; cartonWeightKg: number; inventoryLotId: string; inventoryMovementId: string; status: string;
};

export type StockupForwarderLocation = {
  id: string; forwarderId: string; name: string; country: string; province: string; city: string; address: string; contactName: string;
  contactPhone: string; routingRequirements: string; status: string; version: number;
};

export type StockupForwarder = {
  id: string; code: string; name: string; status: string; note: string; version: number; locations: StockupForwarderLocation[];
};

export type StockupDispatchDocument = {
  id: string; shipmentId: string; version: number; documentType: "packing_list" | "carton_marks"; fileName: string; mimeType: string;
  sha256: string; snapshot: Record<string, unknown>; createdBy: string; createdAt: string;
};
