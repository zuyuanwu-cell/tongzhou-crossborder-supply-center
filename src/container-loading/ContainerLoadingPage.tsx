import React from "react";
import {
  AlertTriangle,
  Archive,
  ArchiveX,
  Boxes,
  BoxSelect,
  Calculator,
  CheckCircle2,
  ChevronRight,
  Container,
  Download,
  Eye,
  EyeOff,
  Gauge,
  History,
  Layers3,
  LoaderCircle,
  Lock,
  Maximize2,
  Minimize2,
  FileDown,
  PackagePlus,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  Scale,
  Sparkles,
  Trash2,
  Truck,
  Unlock,
  Weight,
  X,
} from "lucide-react";
import type { AuthUser, CatalogProduct } from "../api";
import {
  archiveContainerLoadingPlan,
  confirmContainerLoadingPlan,
  createContainerLoadingPlan,
  deleteContainerLoadingPlan,
  estimateContainerLoadingCapacity,
  fetchContainerLoadingBootstrap,
  fetchContainerLoadingPlan,
  fetchContainerLoadingPlans,
  recalculateContainerLoadingPlan,
  restoreContainerLoadingPlan,
  saveContainerLoadingVersion,
  voidContainerLoadingPlan,
} from "../api";
import { ContainerScene } from "./ContainerScene";
import { skuColorHex } from "./color";
import { exportContainerLoadingGuidePdf } from "./container-loading-report";
import type {
  ContainerLoadingBootstrap,
  ContainerLoadingCandidate,
  ContainerLoadingItem,
  ContainerLoadingMetrics,
  ContainerLoadingPlan,
  ContainerLoadingPlanSummary,
  ContainerLoadingStrategy,
  ContainerLoadingVersion,
  ContainerPlacement,
  ContainerType,
  SingleCartonCapacityEstimate,
  SingleCartonCapacityInput,
} from "./types";
import "./container-loading.css";

const strategyMeta: Record<ContainerLoadingStrategy, { label: string; detail: string }> = {
  max_load: { label: "最大装载", detail: "优先提高装入箱数与空间利用率" },
  balanced: { label: "重量均衡", detail: "优先控制前后、左右重心偏移" },
  sku_complete: { label: "SKU完整", detail: "优先保证整款商品一次装完" },
};

const statusMeta: Record<string, { label: string; tone: string }> = {
  draft: { label: "草稿", tone: "draft" },
  confirmed: { label: "已确认", tone: "success" },
  loaded: { label: "已装柜", tone: "success" },
  voided: { label: "已作废", tone: "muted" },
};

const defaultCustomContainer: ContainerType = {
  code: "CUSTOM",
  name: "自定义柜型",
  lengthCm: 1203,
  widthCm: 235,
  heightCm: 269,
  doorWidthCm: 234,
  doorHeightCm: 258,
  maxPayloadKg: 26600,
};

const defaultCapacityCarton: SingleCartonCapacityInput = {
  unitsPerCarton: 1,
  cartonLengthCm: 0,
  cartonWidthCm: 0,
  cartonHeightCm: 0,
  cartonWeightKg: 0,
  orientation: "upright",
};

const defaultCapacityReserve = {
  doorReserveCm: 20,
  sideClearanceCm: 3,
  topClearanceCm: 5,
  spaceReservePercent: 3,
  payloadReservePercent: 2,
};

type Props = {
  currentUser: AuthUser;
  products: CatalogProduct[];
};

type CapacityDimensionUnit = "mm" | "cm";

const capacityDimensionKeys = ["cartonLengthCm", "cartonWidthCm", "cartonHeightCm"] as const;

function displayCapacityDimension(valueCm: number, unit: CapacityDimensionUnit) {
  if (!valueCm) return "";
  const value = unit === "mm" ? valueCm * 10 : valueCm;
  return String(Math.round(value * 100) / 100);
}

function capacityDimensionToCm(value: number, unit: CapacityDimensionUnit) {
  return unit === "mm" ? value / 10 : value;
}

function hasPermission(user: AuthUser, permission: string) {
  return user.role === "admin" || user.permissions.includes(permission);
}

function cloneItems(items: ContainerLoadingItem[]) {
  return items.map((item) => ({ ...item, orientation: item.orientation || "upright", priority: Number(item.priority || 5), fragile: Boolean(item.fragile) }));
}

function emptyManualItem(product: CatalogProduct, profile?: ContainerLoadingBootstrap["packagingProfiles"][number]): ContainerLoadingItem {
  return {
    id: `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    sku: product.sku || product.skuNo,
    productName: product.name,
    imageUrl: product.imageUrl || "",
    cartonCount: 1,
    unitsPerCarton: profile?.unitsPerCarton || 0,
    cartonLengthCm: profile?.cartonLengthCm || 0,
    cartonWidthCm: profile?.cartonWidthCm || 0,
    cartonHeightCm: profile?.cartonHeightCm || 0,
    cartonWeightKg: profile?.cartonWeightKg || 0,
    orientation: profile?.orientation || "upright",
    priority: 5,
    fragile: Boolean(profile?.fragile),
  };
}

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(Number(value || 0));
}

function calculateAdjustedMetrics(base: ContainerLoadingMetrics, placements: ContainerPlacement[], plan: ContainerLoadingPlan): ContainerLoadingMetrics {
  if (!placements.length) return { ...base, loadedCartons: 0, loadedUnits: 0, loadedWeightKg: 0, loadedVolumeM3: 0, volumeUtilization: 0, weightUtilization: 0 };
  const weight = placements.reduce((sum, placement) => sum + placement.cartonWeightKg, 0);
  const centerX = placements.reduce((sum, placement) => sum + placement.cartonWeightKg * (placement.x + placement.lengthCm / 2), 0) / Math.max(weight, 1);
  const centerY = placements.reduce((sum, placement) => sum + placement.cartonWeightKg * (placement.y + placement.widthCm / 2), 0) / Math.max(weight, 1);
  const frontRearDeviation = Math.abs(centerX - plan.container.lengthCm / 2) / (plan.container.lengthCm / 2) * 100;
  const leftRightDeviation = Math.abs(centerY - plan.container.widthCm / 2) / (plan.container.widthCm / 2) * 100;
  return {
    ...base,
    loadedCartons: placements.length,
    loadedUnits: placements.reduce((sum, placement) => sum + placement.unitsPerCarton, 0),
    loadedWeightKg: Math.round(weight * 10) / 10,
    frontRearDeviation: Math.round(frontRearDeviation * 10) / 10,
    leftRightDeviation: Math.round(leftRightDeviation * 10) / 10,
    balanceScore: Math.max(0, Math.round((100 - (frontRearDeviation + leftRightDeviation) * 2.5) * 10) / 10),
  };
}

function overlap(a: ContainerPlacement, b: ContainerPlacement) {
  const epsilon = 0.01;
  return a.x < b.x + b.lengthCm - epsilon && a.x + a.lengthCm > b.x + epsilon
    && a.y < b.y + b.widthCm - epsilon && a.y + a.widthCm > b.y + epsilon
    && a.z < b.z + b.heightCm - epsilon && a.z + a.heightCm > b.z + epsilon;
}

function selectedPlacementIssue(placement: ContainerPlacement | undefined, placements: ContainerPlacement[], plan: ContainerLoadingPlan | null) {
  if (!placement || !plan) return "";
  if (placement.x < 0 || placement.y < 0 || placement.z < 0
    || placement.x + placement.lengthCm > plan.container.lengthCm
    || placement.y + placement.widthCm > plan.container.widthCm
    || placement.z + placement.heightCm > plan.container.heightCm) return "箱体超出集装箱边界";
  if (placement.widthCm > plan.container.doorWidthCm || placement.heightCm > plan.container.doorHeightCm) return "当前方向无法通过柜门";
  if (placements.some((candidate) => candidate.placementId !== placement.placementId && overlap(placement, candidate))) return "当前位置与其他箱体发生碰撞";
  return "";
}

export default function ContainerLoadingPage({ currentUser, products }: Props) {
  const [bootstrap, setBootstrap] = React.useState<ContainerLoadingBootstrap | null>(null);
  const [plan, setPlan] = React.useState<ContainerLoadingPlan | null>(null);
  const [versions, setVersions] = React.useState<ContainerLoadingVersion[]>([]);
  const [workingPlacements, setWorkingPlacements] = React.useState<ContainerPlacement[]>([]);
  const [selectedStrategy, setSelectedStrategy] = React.useState<ContainerLoadingStrategy>("max_load");
  const [selectedPlacementId, setSelectedPlacementId] = React.useState("");
  const [showShell, setShowShell] = React.useState(true);
  const [playbackSequence, setPlaybackSequence] = React.useState(0);
  const [dirty, setDirty] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [composerOpen, setComposerOpen] = React.useState(false);
  const [composerMode, setComposerMode] = React.useState<"shipment" | "manual">("shipment");
  const [sourceShipmentId, setSourceShipmentId] = React.useState("");
  const [containerCode, setContainerCode] = React.useState("AUTO");
  const [customContainer, setCustomContainer] = React.useState<ContainerType>(defaultCustomContainer);
  const [draftItems, setDraftItems] = React.useState<ContainerLoadingItem[]>([]);
  const [productToAdd, setProductToAdd] = React.useState("");
  const [planLifecycle, setPlanLifecycle] = React.useState<"active" | "archived">("active");
  const [sceneFullscreen, setSceneFullscreen] = React.useState(false);
  const [capacityOpen, setCapacityOpen] = React.useState(false);
  const [capacityContainerCode, setCapacityContainerCode] = React.useState("40HQ");
  const [capacityCarton, setCapacityCarton] = React.useState<SingleCartonCapacityInput>(defaultCapacityCarton);
  const [capacityDimensionUnit, setCapacityDimensionUnit] = React.useState<CapacityDimensionUnit>("mm");
  const [capacityTargetCartons, setCapacityTargetCartons] = React.useState(0);
  const [capacityReserve, setCapacityReserve] = React.useState(defaultCapacityReserve);
  const [capacityEstimate, setCapacityEstimate] = React.useState<SingleCartonCapacityEstimate | null>(null);
  const scenePanelRef = React.useRef<HTMLElement | null>(null);
  const queryHandledRef = React.useRef(false);
  const canManage = hasPermission(currentUser, "container_loading_manage");
  const canConfirm = hasPermission(currentUser, "container_loading_confirm");
  const uniqueProducts = React.useMemo(() => {
    const bySku = new Map<string, CatalogProduct>();
    products.forEach((product) => {
      const sku = String(product.sku || product.skuNo || "").trim();
      if (sku && !bySku.has(sku.toUpperCase())) bySku.set(sku.toUpperCase(), product);
    });
    return Array.from(bySku.values());
  }, [products]);

  const applyPlan = React.useCallback((nextPlan: ContainerLoadingPlan, nextVersions: ContainerLoadingVersion[]) => {
    const strategy = nextPlan.selectedStrategy || "max_load";
    const candidate = nextPlan.candidates.find((item) => item.strategy === strategy) || nextPlan.candidates[0];
    setPlan(nextPlan);
    setVersions(nextVersions);
    setSelectedStrategy(candidate?.strategy || strategy);
    setWorkingPlacements((candidate?.placements || []).map((placement) => ({ ...placement })));
    setSelectedPlacementId("");
    setPlaybackSequence(0);
    setDirty(false);
  }, []);

  const loadPlan = React.useCallback(async (planId: string) => {
    setBusy("load");
    setError("");
    try {
      const result = await fetchContainerLoadingPlan(planId);
      applyPlan(result.plan, result.versions);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "装柜方案加载失败");
    } finally {
      setBusy("");
    }
  }, [applyPlan]);

  const loadBootstrap = React.useCallback(async (openFirst = true) => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchContainerLoadingBootstrap();
      setBootstrap(result);
      const requestedShipmentId = !queryHandledRef.current ? new URLSearchParams(window.location.hash.split("?", 2)[1] || "").get("shipment") : "";
      if (requestedShipmentId) {
        queryHandledRef.current = true;
        const shipment = result.shipments.find((item) => item.id === requestedShipmentId);
        if (shipment) {
          setComposerMode("shipment");
          setComposerOpen(true);
          setSourceShipmentId(shipment.id);
          setDraftItems(cloneItems(shipment.lines));
        }
      } else if (openFirst && !plan && result.plans[0]) await loadPlan(result.plans[0].id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "智能装柜数据加载失败");
    } finally {
      setLoading(false);
    }
  }, [loadPlan, plan]);

  React.useEffect(() => { void loadBootstrap(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    const syncFullscreen = () => setSceneFullscreen(document.fullscreenElement === scenePanelRef.current);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  const selectedCandidate = React.useMemo(() => plan?.candidates.find((candidate) => candidate.strategy === selectedStrategy) || null, [plan, selectedStrategy]);
  const metrics = React.useMemo(() => selectedCandidate && plan ? calculateAdjustedMetrics(selectedCandidate.metrics, workingPlacements, plan) : null, [plan, selectedCandidate, workingPlacements]);
  const selectedPlacement = workingPlacements.find((placement) => placement.placementId === selectedPlacementId);
  const selectedIssue = selectedPlacementIssue(selectedPlacement, workingPlacements, plan);
  const editable = Boolean(canManage && plan?.status === "draft");
  const capacityResult = capacityEstimate?.selected || null;
  const capacityDimensionsCm = capacityDimensionKeys.map((key) => Number(capacityCarton[key] || 0));
  const capacityLooksLikeMillimetres = capacityDimensionUnit === "cm"
    && capacityDimensionsCm.every((value) => value > 0)
    && Math.max(...capacityDimensionsCm) >= 300
    && Math.max(...capacityDimensionsCm) / 10 <= 240;

  async function changePlanLifecycle(nextLifecycle: "active" | "archived") {
    setPlanLifecycle(nextLifecycle);
    setBusy("plan-list");
    setError("");
    try {
      const result = await fetchContainerLoadingPlans({ lifecycle: nextLifecycle });
      setBootstrap((current) => current ? { ...current, plans: result.plans } : current);
      if (!result.plans.some((item) => item.id === plan?.id)) {
        if (result.plans[0]) await loadPlan(result.plans[0].id);
        else {
          setPlan(null);
          setVersions([]);
          setWorkingPlacements([]);
        }
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "方案列表加载失败");
    } finally {
      setBusy("");
    }
  }

  async function toggleSceneFullscreen() {
    const element = scenePanelRef.current;
    if (!element) return;
    try {
      if (document.fullscreenElement === element) await document.exitFullscreen();
      else if (element.requestFullscreen) await element.requestFullscreen();
      else setSceneFullscreen((value) => !value);
    } catch {
      setSceneFullscreen((value) => !value);
    }
  }

  const handleMove = React.useCallback((placementId: string, position: { x: number; y: number; z: number }) => {
    setWorkingPlacements((current) => current.map((placement) => placement.placementId === placementId ? { ...placement, ...position } : placement));
    setDirty(true);
  }, []);

  const handleSelect = React.useCallback((placementId: string) => setSelectedPlacementId(placementId), []);

  function chooseStrategy(strategy: ContainerLoadingStrategy) {
    if (!plan) return;
    const candidate = plan.candidates.find((item) => item.strategy === strategy);
    if (!candidate) return;
    setSelectedStrategy(strategy);
    setWorkingPlacements(candidate.placements.map((placement) => ({ ...placement })));
    setSelectedPlacementId("");
    setPlaybackSequence(0);
    setDirty(false);
  }

  function openComposer(mode: "shipment" | "manual") {
    setCapacityOpen(false);
    setComposerMode(mode);
    setComposerOpen(true);
    setError("");
    if (mode === "shipment") {
      const shipment = bootstrap?.shipments[0];
      setSourceShipmentId(shipment?.id || "");
      setDraftItems(cloneItems(shipment?.lines || []));
    } else {
      setSourceShipmentId("");
      setDraftItems([]);
    }
  }

  function updateCapacityCarton(key: keyof SingleCartonCapacityInput, value: string | number) {
    setCapacityCarton((current) => ({ ...current, [key]: value }));
    setCapacityEstimate(null);
  }

  function updateCapacityDimension(key: typeof capacityDimensionKeys[number], value: number) {
    updateCapacityCarton(key, capacityDimensionToCm(value, capacityDimensionUnit));
  }

  function updateCapacityReserve(key: keyof typeof defaultCapacityReserve, value: number) {
    setCapacityReserve((current) => ({ ...current, [key]: value }));
    setCapacityEstimate(null);
  }

  async function calculateCapacity() {
    setBusy("capacity");
    setError("");
    try {
      const normalizedCarton = capacityLooksLikeMillimetres
        ? {
          ...capacityCarton,
          cartonLengthCm: capacityCarton.cartonLengthCm / 10,
          cartonWidthCm: capacityCarton.cartonWidthCm / 10,
          cartonHeightCm: capacityCarton.cartonHeightCm / 10,
        }
        : capacityCarton;
      if (capacityLooksLikeMillimetres) {
        setCapacityCarton(normalizedCarton);
        setCapacityDimensionUnit("mm");
        setNotice("已识别输入值为毫米，并自动换算后完成测算。");
      }
      const result = await estimateContainerLoadingCapacity({
        containerType: capacityContainerCode,
        container: capacityContainerCode === "CUSTOM" ? customContainer : undefined,
        carton: normalizedCarton,
        targetCartons: capacityTargetCartons,
        reserve: capacityReserve,
      });
      setCapacityEstimate(result.estimate);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "单箱装满数量测算失败");
    } finally {
      setBusy("");
    }
  }

  function useCapacityForPlan() {
    const estimate = capacityEstimate;
    if (!estimate || !estimate.selected.canCreate3d) return;
    const selected = estimate.selected;
    const presetExists = Boolean(bootstrap?.containerTypes.some((container) => container.code === selected.container.code));
    setComposerMode("manual");
    setSourceShipmentId("");
    setContainerCode(presetExists ? selected.container.code : "CUSTOM");
    if (!presetExists) setCustomContainer({ ...selected.container, code: "CUSTOM", name: "自定义柜型" });
    setDraftItems([{
      id: `quick-${Date.now().toString(36)}`,
      sku: "QUICK-CALC",
      productName: "单箱快速测算货物",
      imageUrl: "",
      cartonCount: selected.maxCartons,
      ...estimate.carton,
      priority: 5,
      fragile: false,
    }]);
    setCapacityOpen(false);
    setComposerOpen(true);
    setNotice(`已带入 ${selected.container.name} · ${formatNumber(selected.maxCartons)} 箱，可复核后生成正式 3D 方案。`);
  }

  function selectShipment(shipmentId: string) {
    const shipment = bootstrap?.shipments.find((item) => item.id === shipmentId);
    setSourceShipmentId(shipmentId);
    setDraftItems(cloneItems(shipment?.lines || []));
  }

  function updateDraftItem(itemId: string, key: keyof ContainerLoadingItem, value: string | number | boolean) {
    setDraftItems((current) => current.map((item) => item.id === itemId ? { ...item, [key]: value } : item));
  }

  function addProduct() {
    const product = uniqueProducts.find((item) => item.sku === productToAdd || item.skuNo === productToAdd);
    if (!product) return;
    const profile = bootstrap?.packagingProfiles.find((item) => item.sku.toUpperCase() === (product.sku || product.skuNo).toUpperCase());
    setDraftItems((current) => [...current, emptyManualItem(product, profile)]);
    setProductToAdd("");
  }

  async function generatePlan() {
    if (!draftItems.length) {
      setError("请至少添加一个待装商品。");
      return;
    }
    setBusy("generate");
    setError("");
    try {
      const result = await createContainerLoadingPlan({
        sourceShipmentId: composerMode === "shipment" ? sourceShipmentId : "",
        containerType: containerCode,
        container: containerCode === "CUSTOM" ? customContainer : undefined,
        selectedStrategy: "max_load",
        items: draftItems,
        savePackagingProfiles: true,
      });
      applyPlan(result.plan, result.versions);
      setComposerOpen(false);
      setNotice(result.plan.containerRecommendation?.mode === "auto"
        ? `已智能匹配 ${result.plan.container.name}，并生成 ${result.plan.planNo} 的三套候选方案。`
        : `已生成 ${result.plan.planNo} 的三套候选方案。`);
      const refreshed = await fetchContainerLoadingBootstrap();
      setBootstrap(refreshed);
      setPlanLifecycle("active");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "装柜方案生成失败");
    } finally {
      setBusy("");
    }
  }

  function continueWithRemaining() {
    if (!plan || !selectedCandidate?.unplaced.length) return;
    const remainingByItem = selectedCandidate.unplaced.reduce((counts, item) => {
      counts.set(item.itemId, (counts.get(item.itemId) || 0) + 1);
      return counts;
    }, new Map<string, number>());
    const remainingItems = plan.items
      .filter((item) => remainingByItem.has(item.id))
      .map((item) => ({ ...item, cartonCount: remainingByItem.get(item.id) || 0 }));
    if (!remainingItems.length) return;
    setComposerMode("manual");
    setSourceShipmentId("");
    setDraftItems(remainingItems);
    const presetExists = Boolean(bootstrap?.containerTypes.some((container) => container.code === plan.container.code));
    if (presetExists) {
      setContainerCode(plan.container.code);
    } else {
      setContainerCode("CUSTOM");
      setCustomContainer({ ...plan.container, code: "CUSTOM", name: "自定义柜型" });
    }
    setComposerOpen(true);
    setError("");
    setNotice(`已带入 ${remainingItems.reduce((sum, item) => sum + item.cartonCount, 0)} 箱未装货物，可继续生成下一柜。`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveAdjustment() {
    if (!plan) return null;
    setBusy("save");
    setError("");
    try {
      const result = await saveContainerLoadingVersion(plan.id, { expectedVersion: plan.version, strategy: selectedStrategy, placements: workingPlacements, versionType: dirty ? "manual_adjustment" : "selection" });
      applyPlan(result.plan, result.versions);
      setNotice(`方案调整已保存为 V${result.plan.version}。`);
      return result;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "方案保存失败");
      return null;
    } finally {
      setBusy("");
    }
  }

  async function recalculate() {
    if (!plan) return;
    setBusy("recalculate");
    setError("");
    try {
      const result = await recalculateContainerLoadingPlan(plan.id, {
        expectedVersion: plan.version,
        selectedStrategy,
        containerType: plan.containerRecommendation?.mode === "auto" ? "AUTO" : plan.container.code,
        container: plan.container.code === "CUSTOM" ? plan.container : undefined,
        items: plan.items,
        savePackagingProfiles: true,
      });
      applyPlan(result.plan, result.versions);
      setNotice(`已重新生成三套候选方案，当前版本 V${result.plan.version}。`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "重新计算失败");
    } finally {
      setBusy("");
    }
  }

  async function confirmPlan() {
    if (!plan || selectedIssue) return;
    setBusy("confirm");
    setError("");
    try {
      let currentPlan = plan;
      if (dirty || plan.selectedStrategy !== selectedStrategy) {
        const saved = await saveContainerLoadingVersion(plan.id, { expectedVersion: plan.version, strategy: selectedStrategy, placements: workingPlacements, versionType: dirty ? "manual_adjustment" : "selection" });
        currentPlan = saved.plan;
      }
      const result = await confirmContainerLoadingPlan(currentPlan.id, { expectedVersion: currentPlan.version, strategy: selectedStrategy });
      applyPlan(result.plan, result.versions);
      setNotice(`装柜方案 ${result.plan.planNo} 已确认并锁定版本。`);
      const refreshed = await fetchContainerLoadingBootstrap();
      setBootstrap(refreshed);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "方案确认失败");
    } finally {
      setBusy("");
    }
  }

  async function voidPlan() {
    if (!plan || !window.confirm(`确定作废装柜方案 ${plan.planNo} 吗？`)) return;
    setBusy("void");
    setError("");
    try {
      const result = await voidContainerLoadingPlan(plan.id, { expectedVersion: plan.version, reason: "用户手工作废" });
      applyPlan(result.plan, result.versions);
      setNotice(`装柜方案 ${result.plan.planNo} 已作废。`);
      const refreshed = await fetchContainerLoadingBootstrap();
      setBootstrap(refreshed);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "方案作废失败");
    } finally {
      setBusy("");
    }
  }

  async function archiveCurrentPlan() {
    if (!plan || !window.confirm(`归档后，方案 ${plan.planNo} 将从当前列表移入“已归档”。继续吗？`)) return;
    setBusy("archive");
    setError("");
    try {
      await archiveContainerLoadingPlan(plan.id, { expectedVersion: plan.version });
      setNotice(`装柜方案 ${plan.planNo} 已归档。`);
      const result = await fetchContainerLoadingPlans({ lifecycle: "active" });
      setBootstrap((current) => current ? { ...current, plans: result.plans } : current);
      setPlanLifecycle("active");
      if (result.plans[0]) await loadPlan(result.plans[0].id);
      else setPlan(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "方案归档失败");
    } finally {
      setBusy("");
    }
  }

  async function restoreCurrentPlan() {
    if (!plan) return;
    setBusy("restore");
    setError("");
    try {
      await restoreContainerLoadingPlan(plan.id, { expectedVersion: plan.version });
      setNotice(`装柜方案 ${plan.planNo} 已恢复到当前方案。`);
      const result = await fetchContainerLoadingPlans({ lifecycle: "archived" });
      setBootstrap((current) => current ? { ...current, plans: result.plans } : current);
      if (result.plans[0]) await loadPlan(result.plans[0].id);
      else setPlan(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "方案恢复失败");
    } finally {
      setBusy("");
    }
  }

  async function deleteCurrentPlan() {
    if (!plan || !window.confirm(`永久删除 ${plan.planNo}？\n此操作会同时删除版本记录，且不可恢复。`)) return;
    setBusy("delete");
    setError("");
    try {
      const planNo = plan.planNo;
      await deleteContainerLoadingPlan(plan.id, { expectedVersion: plan.version });
      const result = await fetchContainerLoadingPlans({ lifecycle: planLifecycle });
      setBootstrap((current) => current ? { ...current, plans: result.plans } : current);
      if (result.plans[0]) await loadPlan(result.plans[0].id);
      else setPlan(null);
      setNotice(`已永久删除装柜方案 ${planNo}。`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "方案删除失败");
    } finally {
      setBusy("");
    }
  }

  async function exportPdfGuide() {
    if (!plan || !metrics || !selectedCandidate) return;
    setBusy("pdf");
    setError("");
    try {
      await exportContainerLoadingGuidePdf({
        plan,
        placements: workingPlacements,
        metrics,
        strategyLabel: strategyMeta[selectedStrategy].label,
        warnings: selectedCandidate.warnings,
      });
      setNotice("可视化装柜指导报告已生成，可发送给仓库现场执行。");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "PDF 指导报告生成失败");
    } finally {
      setBusy("");
    }
  }

  function changeSelectedPlacement(mutator: (placement: ContainerPlacement) => ContainerPlacement) {
    if (!selectedPlacementId) return;
    setWorkingPlacements((current) => current.map((placement) => placement.placementId === selectedPlacementId ? mutator(placement) : placement));
    setDirty(true);
  }

  function exportInstruction() {
    if (!plan) return;
    const header = ["装柜顺序", "SKU", "产品", "箱序号", "X(cm)", "Y(cm)", "Z(cm)", "长(cm)", "宽(cm)", "高(cm)", "单箱重量(kg)", "件/箱", "锁定"];
    const rows = [...workingPlacements].sort((a, b) => a.sequence - b.sequence).map((placement) => [placement.sequence, placement.sku, placement.productName, placement.cartonIndex, placement.x, placement.y, placement.z, placement.lengthCm, placement.widthCm, placement.heightCm, placement.cartonWeightKg, placement.unitsPerCarton, placement.locked ? "是" : "否"]);
    const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${plan.planNo}-${strategyMeta[selectedStrategy].label}-装柜清单.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (loading && !bootstrap) return <div className="cl-page cl-loading"><LoaderCircle className="is-spinning" /><span>正在加载智能装柜工作台…</span></div>;

  return <div className="cl-page">
    <section className="cl-hero">
      <div><p>3D CONTAINER LOADING</p><h2>智能装柜</h2><span>从备货发运数据生成可执行的散箱装柜方案，比较装载量、重心与SKU完整度。</span></div>
      <div className="cl-hero-actions">
        <button type="button" className="cl-button secondary" onClick={() => { setComposerOpen(false); setCapacityOpen(true); setError(""); }}><Calculator size={17} />单箱装满测算</button>
        {canManage ? <button type="button" className="cl-button secondary" onClick={() => openComposer("manual")}><PackagePlus size={17} />自由模拟</button> : null}
        {canManage ? <button type="button" className="cl-button primary" onClick={() => openComposer("shipment")}><Truck size={17} />从发运单生成</button> : null}
      </div>
    </section>

    {error ? <div className="cl-message danger"><AlertTriangle size={17} /><span>{error}</span><button type="button" onClick={() => setError("")}><X size={15} /></button></div> : null}
    {notice ? <div className="cl-message success"><CheckCircle2 size={17} /><span>{notice}</span><button type="button" onClick={() => setNotice("")}><X size={15} /></button></div> : null}

    {capacityOpen ? <section className="cl-capacity-calculator">
      <header><div><span>QUICK CAPACITY</span><h3>单箱装满柜快速测算</h3><p>先扣除现场作业与安全余量，再比较空间排布和最大载重。</p></div><button type="button" onClick={() => setCapacityOpen(false)}><X size={18} /></button></header>
      <div className="cl-capacity-body">
        <form className="cl-capacity-form" onSubmit={(event) => { event.preventDefault(); void calculateCapacity(); }}>
          <div className="cl-capacity-section-title"><b>01 · 柜型与箱规</b><span>目标箱数可不填</span></div>
          <div className="cl-capacity-fields">
            <label className="wide"><span>柜型</span><select value={capacityContainerCode} onChange={(event) => { setCapacityContainerCode(event.target.value); setCapacityEstimate(null); }}><option value="AUTO">自动对比全部标准柜型</option>{bootstrap?.containerTypes.map((container) => <option key={container.code} value={container.code}>{container.name} · {container.lengthCm}×{container.widthCm}×{container.heightCm}cm</option>)}<option value="CUSTOM">自定义柜型 / 车辆</option></select></label>
            <label><span>箱规</span><div className="cl-unit-input"><input type="number" min="1" value={capacityCarton.unitsPerCarton || ""} onChange={(event) => updateCapacityCarton("unitsPerCarton", Number(event.target.value))} /><em>件/箱</em></div></label>
            <label><span>计划目标（可选）</span><div className="cl-unit-input"><input type="number" min="0" value={capacityTargetCartons || ""} placeholder="用于自动选柜" onChange={(event) => { setCapacityTargetCartons(Number(event.target.value)); setCapacityEstimate(null); }} /><em>箱</em></div></label>
            <div className="wide cl-capacity-dimension-field">
              <span className="cl-capacity-dimension-head"><span>外箱尺寸</span><span className="cl-capacity-unit-switch" role="group" aria-label="外箱尺寸单位"><button type="button" className={capacityDimensionUnit === "mm" ? "active" : ""} aria-pressed={capacityDimensionUnit === "mm"} onClick={() => setCapacityDimensionUnit("mm")}>毫米 mm</button><button type="button" className={capacityDimensionUnit === "cm" ? "active" : ""} aria-pressed={capacityDimensionUnit === "cm"} onClick={() => setCapacityDimensionUnit("cm")}>厘米 cm</button></span></span>
              <div className="cl-capacity-dimensions"><input aria-label={`外箱长度（${capacityDimensionUnit}）`} type="number" min="0.1" step="0.1" placeholder="长" value={displayCapacityDimension(capacityCarton.cartonLengthCm, capacityDimensionUnit)} onChange={(event) => updateCapacityDimension("cartonLengthCm", Number(event.target.value))} /><i>×</i><input aria-label={`外箱宽度（${capacityDimensionUnit}）`} type="number" min="0.1" step="0.1" placeholder="宽" value={displayCapacityDimension(capacityCarton.cartonWidthCm, capacityDimensionUnit)} onChange={(event) => updateCapacityDimension("cartonWidthCm", Number(event.target.value))} /><i>×</i><input aria-label={`外箱高度（${capacityDimensionUnit}）`} type="number" min="0.1" step="0.1" placeholder="高" value={displayCapacityDimension(capacityCarton.cartonHeightCm, capacityDimensionUnit)} onChange={(event) => updateCapacityDimension("cartonHeightCm", Number(event.target.value))} /><em>{capacityDimensionUnit}</em></div>
              {capacityLooksLikeMillimetres ? <span className="cl-capacity-unit-hint"><AlertTriangle size={13} />这组尺寸更像毫米：将按 {formatNumber(capacityCarton.cartonLengthCm / 10, 1)} × {formatNumber(capacityCarton.cartonWidthCm / 10, 1)} × {formatNumber(capacityCarton.cartonHeightCm / 10, 1)} cm 测算</span> : <small className="cl-capacity-unit-note">当前按{capacityDimensionUnit === "mm" ? "毫米" : "厘米"}录入，系统会统一换算后计算</small>}
            </div>
            <label><span>单箱重量</span><div className="cl-unit-input"><input type="number" min="0.01" step="0.01" value={capacityCarton.cartonWeightKg || ""} onChange={(event) => updateCapacityCarton("cartonWeightKg", Number(event.target.value))} /><em>kg</em></div></label>
            <label><span>摆放方向</span><select value={capacityCarton.orientation} onChange={(event) => updateCapacityCarton("orientation", event.target.value)}><option value="upright">保持直立，可水平旋转</option><option value="any">允许翻转，六面择优</option><option value="fixed">固定当前长宽高方向</option></select></label>
          </div>
          {capacityContainerCode === "CUSTOM" ? <div className="cl-capacity-custom">
            {([['lengthCm', '柜内长'], ['widthCm', '柜内宽'], ['heightCm', '柜内高'], ['doorWidthCm', '柜门宽'], ['doorHeightCm', '柜门高'], ['maxPayloadKg', '最大载重']] as const).map(([key, label]) => <label key={key}><span>{label}</span><input type="number" min="1" value={customContainer[key]} onChange={(event) => { setCustomContainer((current) => ({ ...current, [key]: Number(event.target.value) })); setCapacityEstimate(null); }} /></label>)}
          </div> : null}
          <details className="cl-capacity-reserve">
            <summary><span>02 · 安全预留</span><small>已启用合理默认值，可按现场调整</small></summary>
            <div>{([['doorReserveCm', '柜门作业带', 'cm'], ['sideClearanceCm', '单侧间隙', 'cm'], ['topClearanceCm', '顶部间隙', 'cm'], ['spaceReservePercent', '机动箱位', '%'], ['payloadReservePercent', '载重误差', '%']] as const).map(([key, label, unit]) => <label key={key}><span>{label}</span><div className="cl-unit-input"><input type="number" min="0" step="1" value={capacityReserve[key]} onChange={(event) => updateCapacityReserve(key, Number(event.target.value))} /><em>{unit}</em></div></label>)}</div>
          </details>
          <button type="submit" className="cl-capacity-calculate" disabled={busy === "capacity"}>{busy === "capacity" ? <LoaderCircle size={17} className="is-spinning" /> : <Calculator size={17} />}{busy === "capacity" ? "正在测算" : capacityLooksLikeMillimetres ? "按毫米换算并测算" : "一键测算装满数量"}</button>
        </form>

        <section className={`cl-capacity-result ${capacityResult ? "has-result" : ""}`}>
          {capacityResult && capacityEstimate ? <>
            <div className="cl-capacity-result-hero"><span>{capacityResult.container.code}</span><div><small>安全建议最大装载</small><strong>{formatNumber(capacityResult.maxCartons)}<em>箱</em></strong><p>合计 {formatNumber(capacityResult.maxUnits)} 件 · {formatNumber(capacityResult.loadedWeightKg, 1)} kg</p></div></div>
            <p className="cl-capacity-reason"><Sparkles size={16} />{capacityEstimate.reason}</p>
            <div className="cl-capacity-metrics">
              <article><span>限制因素</span><b>{({ space: "空间排布", weight: "安全载重", space_weight: "空间与载重", door_or_space: "柜门/尺寸" } as const)[capacityResult.limitingFactor]}</b><small>{capacityResult.targetFits === null ? "未设置目标箱数" : capacityResult.targetFits ? "目标数量可装下" : "目标数量超出单柜"}</small></article>
              <article><span>建议排布</span><b>{capacityResult.layout.alongLength} × {capacityResult.layout.acrossWidth} × {capacityResult.layout.layers}</b><small>长向 × 横向 × 层数</small></article>
              <article><span>体积利用率</span><b>{formatNumber(capacityResult.volumeUtilization, 1)}%</b><i><em style={{ width: `${Math.min(100, capacityResult.volumeUtilization)}%` }} /></i></article>
              <article><span>载重利用率</span><b>{formatNumber(capacityResult.weightUtilization, 1)}%</b><i><em style={{ width: `${Math.min(100, capacityResult.weightUtilization)}%` }} /></i></article>
            </div>
            <div className="cl-capacity-orientation"><span>采用箱体方向</span><b>{capacityResult.orientation.lengthCm} × {capacityResult.orientation.widthCm} × {capacityResult.orientation.heightCm} cm</b><small>可用柜内 {formatNumber(capacityResult.usable.lengthCm, 1)} × {formatNumber(capacityResult.usable.widthCm, 1)} × {formatNumber(capacityResult.usable.heightCm, 1)} cm</small></div>
            {capacityEstimate.alternatives.length > 1 ? <div className="cl-capacity-comparison"><header><b>柜型对比</b><span>均按相同安全预留</span></header><div>{capacityEstimate.alternatives.map((item) => <article className={item.container.code === capacityResult.container.code ? "selected" : ""} key={item.container.code}><span>{item.container.code}</span><strong>{formatNumber(item.maxCartons)} 箱</strong><small>{formatNumber(item.maxUnits)} 件 · {item.limitingFactor === "weight" ? "载重受限" : "空间受限"}</small></article>)}</div></div> : null}
            {capacityResult.warnings.length ? <div className="cl-capacity-warnings">{capacityResult.warnings.map((warning) => <p key={warning}><AlertTriangle size={14} />{warning}</p>)}</div> : <div className="cl-capacity-ok"><CheckCircle2 size={15} />尺寸、柜门与安全载重校验通过</div>}
            {canManage ? <button type="button" className="cl-capacity-to-plan" disabled={!capacityResult.canCreate3d} onClick={useCapacityForPlan}><PackagePlus size={17} />{capacityResult.canCreate3d ? "带入正式 3D 方案" : `超过 ${formatNumber(capacityResult.max3dCartons)} 箱，暂不支持逐箱3D`}</button> : null}
          </> : <div className="cl-capacity-empty"><Calculator size={42} /><h4>输入一个箱子的资料</h4><p>系统会先扣除作业通道、箱体间隙和载重误差，再给出可执行的装满数量。</p><div><span>空间排布</span><i /> <span>载重校验</span><i /> <span>柜型对比</span></div></div>}
        </section>
      </div>
    </section> : null}

    {composerOpen ? <section className="cl-composer">
      <header><div><span>NEW LOADING PLAN</span><h3>{composerMode === "shipment" ? "从发运单生成装柜方案" : "自由模拟装柜"}</h3></div><button type="button" onClick={() => setComposerOpen(false)}><X size={18} /></button></header>
      <div className="cl-composer-toolbar">
        {composerMode === "shipment" ? <label><span>来源发运单</span><select value={sourceShipmentId} onChange={(event) => selectShipment(event.target.value)}><option value="">请选择发运单</option>{bootstrap?.shipments.map((shipment) => <option value={shipment.id} key={shipment.id}>{shipment.shipmentNo} · {shipment.destinationWarehouseName} · {shipment.packages || shipment.lines.reduce((sum, line) => sum + Number(line.cartonCount || 0), 0)}箱</option>)}</select></label> : <label className="cl-add-product"><span>添加产品</span><div><select value={productToAdd} onChange={(event) => setProductToAdd(event.target.value)}><option value="">搜索并选择产品</option>{uniqueProducts.slice(0, 2000).map((product) => <option key={product.sku || product.skuNo || product.id} value={product.sku || product.skuNo}>{product.sku || product.skuNo} · {product.name}</option>)}</select><button type="button" onClick={addProduct} disabled={!productToAdd}><Plus size={16} />添加</button></div></label>}
        <label><span>柜型</span><select value={containerCode} onChange={(event) => setContainerCode(event.target.value)}><option value="AUTO">智能匹配 · 自动选择最合适柜型</option>{bootstrap?.containerTypes.map((container) => <option value={container.code} key={container.code}>{container.name} · {container.lengthCm}×{container.widthCm}×{container.heightCm}cm</option>)}<option value="CUSTOM">自定义柜型 / 车辆</option></select></label>
      </div>
      {containerCode === "AUTO" ? <div className="cl-auto-hint"><Sparkles size={17} /><div><b>智能选柜已开启</b><span>系统会实际排布 20GP、40GP、40HQ、45HQ，优先选择可完整装下的最小柜型；无法单柜装完时选择装入箱数最多且空间浪费更少的柜型。</span></div></div> : null}
      {containerCode === "CUSTOM" ? <div className="cl-custom-container">
        <label><span>柜内长 cm</span><input type="number" min="1" value={customContainer.lengthCm} onChange={(event) => setCustomContainer((current) => ({ ...current, lengthCm: Number(event.target.value) }))} /></label>
        <label><span>柜内宽 cm</span><input type="number" min="1" value={customContainer.widthCm} onChange={(event) => setCustomContainer((current) => ({ ...current, widthCm: Number(event.target.value) }))} /></label>
        <label><span>柜内高 cm</span><input type="number" min="1" value={customContainer.heightCm} onChange={(event) => setCustomContainer((current) => ({ ...current, heightCm: Number(event.target.value) }))} /></label>
        <label><span>柜门宽 cm</span><input type="number" min="1" value={customContainer.doorWidthCm} onChange={(event) => setCustomContainer((current) => ({ ...current, doorWidthCm: Number(event.target.value) }))} /></label>
        <label><span>柜门高 cm</span><input type="number" min="1" value={customContainer.doorHeightCm} onChange={(event) => setCustomContainer((current) => ({ ...current, doorHeightCm: Number(event.target.value) }))} /></label>
        <label><span>最大载重 kg</span><input type="number" min="1" value={customContainer.maxPayloadKg} onChange={(event) => setCustomContainer((current) => ({ ...current, maxPayloadKg: Number(event.target.value) }))} /></label>
      </div> : null}
      <div className="cl-draft-table">
        <div className="head"><span>商品 / SKU</span><span>箱数</span><span>件/箱</span><span>外箱长×宽×高 cm</span><span>单箱 kg</span><span>方向</span><span>优先级</span><span /></div>
        {draftItems.map((item) => <div key={item.id} className={![item.cartonCount, item.unitsPerCarton, item.cartonLengthCm, item.cartonWidthCm, item.cartonHeightCm, item.cartonWeightKg].every((value) => Number(value) > 0) ? "invalid" : ""}>
          <span className="product">{item.imageUrl ? <img src={item.imageUrl} alt="" /> : <i><Boxes size={18} /></i>}<em><b>{item.productName}</b><small>{item.sku}</small></em></span>
          <span><input aria-label={`${item.sku} 箱数`} type="number" min="1" value={item.cartonCount || ""} onChange={(event) => updateDraftItem(item.id, "cartonCount", Number(event.target.value))} /></span>
          <span><input aria-label={`${item.sku} 件每箱`} type="number" min="1" value={item.unitsPerCarton || ""} onChange={(event) => updateDraftItem(item.id, "unitsPerCarton", Number(event.target.value))} /></span>
          <span className="dimensions"><input aria-label={`${item.sku} 外箱长`} placeholder="长" type="number" min="1" value={item.cartonLengthCm || ""} onChange={(event) => updateDraftItem(item.id, "cartonLengthCm", Number(event.target.value))} /><i>×</i><input aria-label={`${item.sku} 外箱宽`} placeholder="宽" type="number" min="1" value={item.cartonWidthCm || ""} onChange={(event) => updateDraftItem(item.id, "cartonWidthCm", Number(event.target.value))} /><i>×</i><input aria-label={`${item.sku} 外箱高`} placeholder="高" type="number" min="1" value={item.cartonHeightCm || ""} onChange={(event) => updateDraftItem(item.id, "cartonHeightCm", Number(event.target.value))} /></span>
          <span><input aria-label={`${item.sku} 单箱重量`} type="number" min="0.01" step="0.1" value={item.cartonWeightKg || ""} onChange={(event) => updateDraftItem(item.id, "cartonWeightKg", Number(event.target.value))} /></span>
          <span><select value={item.orientation} onChange={(event) => updateDraftItem(item.id, "orientation", event.target.value)}><option value="fixed">固定方向</option><option value="upright">保持直立</option><option value="any">允许翻转</option></select></span>
          <span><select value={item.priority} onChange={(event) => updateDraftItem(item.id, "priority", Number(event.target.value))}>{[9, 7, 5, 3, 1].map((value) => <option value={value} key={value}>{value >= 7 ? "高" : value <= 3 ? "低" : "普通"}</option>)}</select></span>
          <span><button type="button" onClick={() => setDraftItems((current) => current.filter((candidate) => candidate.id !== item.id))}><Trash2 size={15} /></button></span>
        </div>)}
        {!draftItems.length ? <div className="empty"><Boxes size={24} /><span>{composerMode === "shipment" ? "请选择包含装箱资料的发运单" : "请先添加需要模拟的产品"}</span></div> : null}
      </div>
      <footer><span><Sparkles size={15} />将自动生成最大装载、重量均衡和SKU完整三套方案</span><button type="button" className="cl-button primary" disabled={busy === "generate" || !draftItems.length} onClick={() => void generatePlan()}>{busy === "generate" ? <LoaderCircle size={16} className="is-spinning" /> : <Sparkles size={16} />}生成3D装柜方案</button></footer>
    </section> : null}

    <div className="cl-layout">
      <aside className="cl-plan-panel">
        <div className="cl-panel-title"><div><History size={17} /><span>装柜方案</span></div><button type="button" onClick={() => void changePlanLifecycle(planLifecycle)} title="刷新"><RefreshCw size={15} /></button></div>
        <div className="cl-plan-tabs"><button type="button" className={planLifecycle === "active" ? "active" : ""} onClick={() => void changePlanLifecycle("active")}>当前方案</button><button type="button" className={planLifecycle === "archived" ? "active" : ""} onClick={() => void changePlanLifecycle("archived")}><Archive size={13} />已归档</button></div>
        <div className="cl-plan-list">
          {bootstrap?.plans.map((item: ContainerLoadingPlanSummary) => {
            const status = statusMeta[item.status] || statusMeta.draft;
            return <button type="button" className={plan?.id === item.id ? "active" : ""} key={item.id} onClick={() => void loadPlan(item.id)}>
              <span className="icon"><Container size={18} /></span><span className="copy"><b>{item.planNo}</b><small>{item.sourceShipmentNo || "自由模拟"} · {item.containerType}</small><em>{item.destinationWarehouseName || item.createdByName}</em></span><span className={`status ${status.tone}`}>{status.label}</span><ChevronRight size={15} />
            </button>;
          })}
          {!bootstrap?.plans.length ? <div className="cl-empty"><Container size={30} /><b>{planLifecycle === "archived" ? "暂无归档方案" : "暂无装柜方案"}</b><span>{planLifecycle === "archived" ? "作废方案归档后会显示在这里" : "从发运单生成或先做一次自由模拟"}</span></div> : null}
        </div>
      </aside>

      <main className="cl-workbench">
        {plan && selectedCandidate && metrics ? <>
          <header className="cl-plan-head">
            <div><span>{plan.planNo} · V{plan.version}</span><h3>{plan.name}</h3><p>{plan.sourceShipmentNo ? `来源 ${plan.sourceShipmentNo} · ${plan.destinationWarehouseName}` : "自由模拟方案"} · {plan.container.name}</p></div>
            <div className="cl-plan-actions">
              <button type="button" onClick={exportInstruction}><Download size={16} />导出清单</button>
              <button type="button" disabled={busy === "pdf"} onClick={() => void exportPdfGuide()}>{busy === "pdf" ? <LoaderCircle size={16} className="is-spinning" /> : <FileDown size={16} />}PDF指导报告</button>
              {canManage && selectedCandidate.unplaced.length ? <button type="button" onClick={continueWithRemaining}><PackagePlus size={16} />剩余货物下一柜</button> : null}
              {editable ? <button type="button" disabled={Boolean(selectedIssue) || busy === "save"} onClick={() => void saveAdjustment()}><Save size={16} />保存版本</button> : null}
              {editable ? <button type="button" onClick={() => void recalculate()}><RefreshCw size={16} />重排</button> : null}
              {canConfirm && plan.status === "draft" ? <button type="button" className="primary" disabled={Boolean(selectedIssue) || busy === "confirm"} onClick={() => void confirmPlan()}><CheckCircle2 size={16} />确认方案</button> : null}
              {canConfirm && plan.status !== "voided" ? <button type="button" className="danger" onClick={() => void voidPlan()}><ArchiveX size={16} />作废</button> : null}
              {canConfirm && plan.status === "voided" && plan.lifecycleStatus === "active" ? <button type="button" onClick={() => void archiveCurrentPlan()}><Archive size={16} />归档</button> : null}
              {canConfirm && plan.status === "voided" && plan.lifecycleStatus === "archived" ? <button type="button" onClick={() => void restoreCurrentPlan()}><RotateCcw size={16} />恢复</button> : null}
              {canConfirm && plan.status === "voided" ? <button type="button" className="danger" onClick={() => void deleteCurrentPlan()}><Trash2 size={16} />永久删除</button> : null}
            </div>
          </header>

          {plan.containerRecommendation?.mode === "auto" ? <div className="cl-recommendation"><span><Sparkles size={18} /></span><div><b>智能推荐 {plan.containerRecommendation.selectedName}</b><p>{plan.containerRecommendation.reason}</p></div><div className="cl-container-comparison">{plan.containerRecommendation.alternatives.map((item) => <span className={item.container.code === plan.container.code ? "selected" : ""} key={item.container.code}><b>{item.container.code}</b><small>{item.fullFit ? "完整装下" : `${item.metrics.loadedCartons || 0}/${item.metrics.totalCartons || 0}箱`}</small></span>)}</div></div> : null}

          <div className="cl-strategies">
            {plan.candidates.map((candidate) => <button type="button" className={selectedStrategy === candidate.strategy ? "active" : ""} key={candidate.strategy} onClick={() => chooseStrategy(candidate.strategy)}>
              <span><b>{strategyMeta[candidate.strategy].label}</b><small>{strategyMeta[candidate.strategy].detail}</small></span><em>{candidate.score}<small>综合分</small></em><i>{candidate.metrics.loadedCartons}/{candidate.metrics.totalCartons}箱</i>
            </button>)}
          </div>

          <div className="cl-metrics">
            <article><span><BoxSelect size={18} /></span><div><small>已装 / 待装</small><b>{formatNumber(metrics.loadedCartons)} <em>/ {formatNumber(metrics.unplacedCartons)} 箱</em></b></div></article>
            <article><span><Maximize2 size={18} /></span><div><small>体积利用率</small><b>{formatNumber(metrics.volumeUtilization, 1)}%</b><i style={{ width: `${Math.min(100, metrics.volumeUtilization)}%` }} /></div></article>
            <article><span><Weight size={18} /></span><div><small>载重利用率</small><b>{formatNumber(metrics.weightUtilization, 1)}%</b><em>{formatNumber(metrics.loadedWeightKg, 1)} kg</em></div></article>
            <article><span><Gauge size={18} /></span><div><small>重心均衡</small><b>{formatNumber(metrics.balanceScore, 1)}</b><em>前后 {metrics.frontRearDeviation}% · 左右 {metrics.leftRightDeviation}%</em></div></article>
            <article><span><Layers3 size={18} /></span><div><small>完整装入SKU</small><b>{metrics.completeSkuCount} / {metrics.skuCount}</b><em>{metrics.layerCount} 个高度层</em></div></article>
          </div>

          <div className="cl-visual-layout">
            <section className="cl-cargo-panel">
              <header><div><Boxes size={17} /><b>待装货物</b></div><span>{plan.items.length} SKU</span></header>
              <div className="cl-cargo-list">{plan.items.map((item) => {
                const loaded = workingPlacements.filter((placement) => placement.itemId === item.id).length;
                return <button type="button" key={item.id} onClick={() => setSelectedPlacementId(workingPlacements.find((placement) => placement.itemId === item.id)?.placementId || "")}>
                  {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <i><Boxes size={18} /></i>}<span><b>{item.productName}</b><small className="cl-sku-line"><i style={{ background: skuColorHex(item.sku) }} />{item.sku}</small><em>{item.cartonLengthCm}×{item.cartonWidthCm}×{item.cartonHeightCm}cm · {item.cartonWeightKg}kg</em></span><strong className={loaded < item.cartonCount ? "short" : ""}>{loaded}/{item.cartonCount}<small>箱</small></strong>
                </button>;
              })}</div>
            </section>

            <section className={`cl-scene-panel ${sceneFullscreen ? "is-fullscreen" : ""}`} ref={scenePanelRef}>
              <div className="cl-scene-toolbar">
                <span><Container size={16} />{plan.container.lengthCm} × {plan.container.widthCm} × {plan.container.heightCm} cm</span>
                <button type="button" onClick={() => setShowShell((value) => !value)}>{showShell ? <EyeOff size={15} /> : <Eye size={15} />}{showShell ? "隐藏箱体" : "显示箱体"}</button>
                <label><Play size={15} /><input type="range" min="0" max={workingPlacements.length} value={playbackSequence || workingPlacements.length} onChange={(event) => setPlaybackSequence(Number(event.target.value) === workingPlacements.length ? 0 : Number(event.target.value))} /><span>{playbackSequence || workingPlacements.length}/{workingPlacements.length}</span></label>
                <button type="button" className="fullscreen" onClick={() => void toggleSceneFullscreen()}>{sceneFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}{sceneFullscreen ? "退出全屏" : "全屏"}</button>
              </div>
              <ContainerScene container={plan.container} placements={workingPlacements} selectedId={selectedPlacementId} showShell={showShell} editable={editable} maxSequence={playbackSequence} onSelect={handleSelect} onMove={handleMove} />
              <div className="cl-scene-legend">{plan.items.slice(0, 8).map((item) => <span key={item.id}><i style={{ background: skuColorHex(item.sku) }} />{item.sku}</span>)}{plan.items.length > 8 ? <span>+{plan.items.length - 8} SKU</span> : null}</div>
              {workingPlacements.length > 1500 ? <div className="cl-render-limit"><AlertTriangle size={14} />当前仅精细渲染前1500箱，装载计算和导出仍包含全部箱体。</div> : null}
            </section>

            <aside className="cl-detail-panel">
              <header><div><BoxSelect size={17} /><b>箱体与校验</b></div>{selectedPlacement ? <span>#{selectedPlacement.sequence}</span> : null}</header>
              {selectedPlacement ? <div className="cl-selected-detail">
                <h4>{selectedPlacement.productName}</h4><p>{selectedPlacement.sku} · 第 {selectedPlacement.cartonIndex} 箱</p>
                <dl><div><dt>坐标 X / Y / Z</dt><dd>{selectedPlacement.x} / {selectedPlacement.y} / {selectedPlacement.z} cm</dd></div><div><dt>当前方向</dt><dd>{selectedPlacement.lengthCm} × {selectedPlacement.widthCm} × {selectedPlacement.heightCm} cm</dd></div><div><dt>单箱重量</dt><dd>{selectedPlacement.cartonWeightKg} kg</dd></div></dl>
                {selectedIssue ? <div className="cl-placement-warning"><AlertTriangle size={15} />{selectedIssue}</div> : <div className="cl-placement-ok"><CheckCircle2 size={15} />边界与碰撞初检通过</div>}
                {editable ? <>
                  <div className="cl-adjust-grid"><button type="button" onClick={() => changeSelectedPlacement((item) => ({ ...item, x: Math.max(0, item.x - 5) }))}>X−</button><button type="button" onClick={() => changeSelectedPlacement((item) => ({ ...item, x: item.x + 5 }))}>X+</button><button type="button" onClick={() => changeSelectedPlacement((item) => ({ ...item, y: Math.max(0, item.y - 5) }))}>Y−</button><button type="button" onClick={() => changeSelectedPlacement((item) => ({ ...item, y: item.y + 5 }))}>Y+</button><button type="button" onClick={() => changeSelectedPlacement((item) => ({ ...item, z: Math.max(0, item.z - 5) }))}>Z−</button><button type="button" onClick={() => changeSelectedPlacement((item) => ({ ...item, z: item.z + 5 }))}>Z+</button></div>
                  <button type="button" className="cl-detail-action" onClick={() => changeSelectedPlacement((item) => ({ ...item, lengthCm: item.widthCm, widthCm: item.lengthCm }))}><RotateCw size={15} />水平旋转90°</button>
                  <button type="button" className="cl-detail-action" onClick={() => changeSelectedPlacement((item) => ({ ...item, locked: !item.locked }))}>{selectedPlacement.locked ? <Unlock size={15} /> : <Lock size={15} />}{selectedPlacement.locked ? "解除位置锁定" : "锁定当前位置"}</button>
                </> : null}
              </div> : <div className="cl-empty detail"><BoxSelect size={30} /><b>点击一个箱体</b><span>查看产品、坐标、方向与重量；草稿方案可拖动坐标轴调整。</span></div>}

              <div className="cl-warning-list"><h4>方案提醒 <span>{selectedCandidate.warnings.length}</span></h4>{selectedCandidate.warnings.length ? selectedCandidate.warnings.map((warning) => <div key={warning}><AlertTriangle size={14} /><span>{warning}</span></div>) : <div className="ok"><CheckCircle2 size={14} /><span>当前没有高风险提醒</span></div>}</div>
              <div className="cl-version-list"><h4>版本记录 <span>{versions.length}</span></h4>{versions.slice(0, 5).map((version) => <div key={version.id}><b>V{version.version}</b><span>{({ generated: "自动生成", manual_adjustment: "人工调整", selection: "切换方案", recalculated: "重新计算", confirmed: "确认锁定", voided: "作废", archived: "归档", restored: "恢复" } as Record<string, string>)[version.versionType] || version.versionType}<small>{version.createdByName} · {new Date(version.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</small></span></div>)}</div>
            </aside>
          </div>
        </> : <div className="cl-empty workspace"><Container size={46} /><h3>选择或创建装柜方案</h3><p>首期按散箱直接装柜计算，柜型参数为参考值，确认前请结合承运人实际箱体复核。</p>{canManage ? <button type="button" className="cl-button primary" onClick={() => openComposer("shipment")}><Plus size={16} />创建第一个方案</button> : null}</div>}
      </main>
    </div>
  </div>;
}
