export type ContainerLoadingStrategy = "max_load" | "balanced" | "sku_complete";
export type ContainerLoadingLifecycle = "active" | "archived";

export type ContainerType = {
  code: string;
  name: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  doorWidthCm: number;
  doorHeightCm: number;
  maxPayloadKg: number;
};

export type ContainerLoadingItem = {
  id: string;
  sku: string;
  productName: string;
  imageUrl: string;
  cartonCount: number;
  unitsPerCarton: number;
  cartonLengthCm: number;
  cartonWidthCm: number;
  cartonHeightCm: number;
  cartonWeightKg: number;
  orientation: "fixed" | "upright" | "any";
  priority: number;
  fragile: boolean;
  locked?: boolean;
};

export type ContainerPlacement = {
  placementId: string;
  itemId: string;
  sku: string;
  productName: string;
  imageUrl?: string;
  cartonIndex: number;
  cartonWeightKg: number;
  unitsPerCarton: number;
  x: number;
  y: number;
  z: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  sequence: number;
  locked: boolean;
  fragile?: boolean;
};

export type ContainerLoadingMetrics = {
  totalCartons: number;
  loadedCartons: number;
  unplacedCartons: number;
  totalUnits: number;
  loadedUnits: number;
  totalWeightKg: number;
  loadedWeightKg: number;
  totalVolumeM3: number;
  loadedVolumeM3: number;
  volumeUtilization: number;
  weightUtilization: number;
  frontRearDeviation: number;
  leftRightDeviation: number;
  balanceScore: number;
  completeSkuCount: number;
  skuCount: number;
  layerCount: number;
};

export type ContainerLoadingCandidate = {
  strategy: ContainerLoadingStrategy;
  placements: ContainerPlacement[];
  unplaced: Array<{ placementId: string; itemId: string; sku: string; productName: string; cartonWeightKg: number }>;
  metrics: ContainerLoadingMetrics;
  warnings: string[];
  score: number;
  manuallyAdjusted?: boolean;
};

export type ContainerRecommendation = {
  mode: "auto" | "manual";
  selectedCode: string;
  selectedName: string;
  reason: string;
  alternatives: Array<{
    container: ContainerType;
    bestStrategy: ContainerLoadingStrategy;
    fullFit: boolean;
    metrics: Partial<ContainerLoadingMetrics>;
  }>;
};

export type ContainerLoadingPlanSummary = {
  id: string;
  planNo: string;
  name: string;
  sourceType: "manual" | "shipment";
  sourceShipmentId: string;
  sourceShipmentNo: string;
  destinationWarehouseId: string;
  destinationWarehouseName: string;
  containerType: string;
  status: "draft" | "confirmed" | "loaded" | "voided";
  lifecycleStatus: ContainerLoadingLifecycle;
  archivedAt: string;
  archivedBy: string;
  selectedStrategy: ContainerLoadingStrategy;
  version: number;
  confirmedVersion: number | null;
  confirmedAt: string;
  confirmedBy: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  summary?: {
    strategy?: ContainerLoadingStrategy;
    strategyLabel?: string;
    metrics?: Partial<ContainerLoadingMetrics>;
    warningCount?: number;
  };
};

export type ContainerLoadingPlan = ContainerLoadingPlanSummary & {
  container: ContainerType;
  items: ContainerLoadingItem[];
  candidates: ContainerLoadingCandidate[];
  sourceVersion: number;
  warnings: string[];
  containerRecommendation: ContainerRecommendation | null;
};

export type ContainerLoadingVersion = {
  id: string;
  planId: string;
  version: number;
  versionType: string;
  strategy: ContainerLoadingStrategy;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  metrics: Partial<ContainerLoadingMetrics>;
};

export type ContainerLoadingShipmentOption = {
  id: string;
  shipmentNo: string;
  destinationWarehouseId: string;
  destinationWarehouseName: string;
  destinationCountry: string;
  status: string;
  version: number;
  packages: number;
  totalWeightKg: number;
  totalVolumeM3: number;
  lines: ContainerLoadingItem[];
};

export type ContainerPackagingProfile = {
  id: string;
  sku: string;
  profileName: string;
  unitsPerCarton: number;
  cartonLengthCm: number;
  cartonWidthCm: number;
  cartonHeightCm: number;
  cartonWeightKg: number;
  orientation: "fixed" | "upright" | "any";
  fragile: boolean;
  enabled: boolean;
};

export type ContainerLoadingBootstrap = {
  ok: boolean;
  containerTypes: ContainerType[];
  shipments: ContainerLoadingShipmentOption[];
  plans: ContainerLoadingPlanSummary[];
  packagingProfiles: ContainerPackagingProfile[];
  limits: { maxCartons: number; detailedRenderCartons: number };
};

export type SingleCartonCapacityInput = {
  unitsPerCarton: number;
  cartonLengthCm: number;
  cartonWidthCm: number;
  cartonHeightCm: number;
  cartonWeightKg: number;
  orientation: "fixed" | "upright" | "any";
};

export type ContainerCapacityAlternative = {
  container: ContainerType;
  usable: { lengthCm: number; widthCm: number; heightCm: number; doorWidthCm: number; doorHeightCm: number };
  orientation: { lengthCm: number; widthCm: number; heightCm: number };
  layout: { alongLength: number; acrossWidth: number; layers: number };
  geometricCapacity: number;
  spaceCapacity: number;
  payloadCapacity: number;
  maxCartons: number;
  maxUnits: number;
  loadedWeightKg: number;
  loadedVolumeM3: number;
  volumeUtilization: number;
  usableVolumeUtilization: number;
  weightUtilization: number;
  limitingFactor: "space" | "weight" | "space_weight" | "door_or_space";
  targetCartons: number;
  targetFits: boolean | null;
  canCreate3d: boolean;
  max3dCartons: number;
  warnings: string[];
};

export type SingleCartonCapacityEstimate = {
  carton: SingleCartonCapacityInput;
  reserve: { doorReserveCm: number; sideClearanceCm: number; topClearanceCm: number; spaceReservePercent: number; payloadReservePercent: number };
  targetCartons: number;
  selected: ContainerCapacityAlternative;
  alternatives: ContainerCapacityAlternative[];
  reason: string;
};

