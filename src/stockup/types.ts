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
  taskId: string;
  lineId: string;
  sku: string;
  productName: string;
  shippedQty: number;
  unit: string;
  baseUnitCostCny: number;
  weightKg: number;
  volumeM3: number;
};

export type StockupShipment = {
  id: string;
  requestId: string;
  shipmentNo: string;
  originWarehouse: string;
  destinationWarehouseId: string;
  destinationWarehouseName: string;
  destinationCountry: string;
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
  version: number;
  lines?: StockupReceiptLine[];
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
