import React from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  Clipboard,
  Copy,
  Download,
  FileText,
  ImageOff,
  LoaderCircle,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Truck,
  Upload,
  X,
  ZoomIn,
} from "lucide-react";
import {
  AfterSalesAttachment,
  AfterSalesCustomer,
  AfterSalesItem,
  AfterSalesOrderSyncPayload,
  AfterSalesPayload,
  AfterSalesReissueItem,
  AfterSalesTicket,
  AuthUser,
  createAfterSalesTicket,
  downloadAfterSalesAttachment,
  fetchAfterSales,
  fetchAfterSalesTicket,
  resolveApiUrl,
  syncAfterSalesOrder,
  updateAfterSalesWarehouse,
  uploadAfterSalesAttachment,
} from "./api";

const primaryReasons = ["仓库错发", "仓库漏发少发", "产品质量问题", "快递丢失", "运输破损", "SKU匹配错误"];
const secondaryReasons = ["补发且留错品", "仓库发错货，客户差评不退货", "客户补差价留错品", "客户退全款且退货"];

const statusMeta: Record<string, { label: string; tone: string }> = {
  pending_warehouse: { label: "待仓库接单", tone: "warning" },
  processing: { label: "仓库已受理", tone: "info" },
  awaiting_reshipment: { label: "待补发", tone: "danger" },
  shipped: { label: "补发已发出", tone: "good" },
  completed: { label: "已完结", tone: "muted" },
  cancelled: { label: "已作废", tone: "muted" },
};

type AfterSalesListFilters = { status?: string; keyword?: string; mine?: boolean };
type AfterSalesCacheEntry = { payload: AfterSalesPayload; cachedAt: number };
type AfterSalesImagePreview = { src: string; title: string; description?: string };

const AFTER_SALES_CACHE_MAX_AGE_MS = 15 * 60 * 1000;
const AFTER_SALES_REQUEST_TIMEOUT_MS = 12 * 1000;
const AFTER_SALES_AUTO_REFRESH_MS = 30 * 1000;
const AFTER_SALES_STORAGE_PREFIX = "tongzhou_after_sales_list_v1:";
const afterSalesListCache = new Map<string, AfterSalesCacheEntry>();

function afterSalesOwnerKey(user: AuthUser) {
  return String(user.id || user.username || user.role || "guest");
}

function afterSalesQueryKey(ownerKey: string, filters: AfterSalesListFilters) {
  return [ownerKey, filters.mine ? "mine" : "all", filters.status || "all", (filters.keyword || "").trim().toLowerCase()].join("|");
}

function readAfterSalesCache(ownerKey: string, filters: AfterSalesListFilters) {
  const key = afterSalesQueryKey(ownerKey, filters);
  let cached = afterSalesListCache.get(key) || null;
  if (!cached) {
    try {
      const stored = sessionStorage.getItem(`${AFTER_SALES_STORAGE_PREFIX}${key}`);
      const parsed = stored ? JSON.parse(stored) as AfterSalesCacheEntry : null;
      if (parsed?.payload?.tickets && Number.isFinite(parsed.cachedAt)) {
        cached = parsed;
        afterSalesListCache.set(key, parsed);
      }
    } catch {
      // Session cache is an optional speed-up; a storage failure must not block the live request.
    }
  }
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > AFTER_SALES_CACHE_MAX_AGE_MS) {
    afterSalesListCache.delete(key);
    try { sessionStorage.removeItem(`${AFTER_SALES_STORAGE_PREFIX}${key}`); } catch { /* no-op */ }
    return null;
  }
  return cached;
}

function writeAfterSalesCache(key: string, entry: AfterSalesCacheEntry) {
  afterSalesListCache.set(key, entry);
  try { sessionStorage.setItem(`${AFTER_SALES_STORAGE_PREFIX}${key}`, JSON.stringify(entry)); } catch { /* no-op */ }
}

function clearAfterSalesCache(ownerKey: string) {
  for (const key of afterSalesListCache.keys()) {
    if (key.startsWith(`${ownerKey}|`)) afterSalesListCache.delete(key);
  }
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const storageKey = sessionStorage.key(index) || "";
      if (storageKey.startsWith(`${AFTER_SALES_STORAGE_PREFIX}${ownerKey}|`)) sessionStorage.removeItem(storageKey);
    }
  } catch {
    // The live refresh still invalidates the in-memory cache when storage is unavailable.
  }
}

const blankCustomer: AfterSalesCustomer = {
  name: "",
  phone: "",
  country: "",
  province: "",
  city: "",
  district: "",
  address: "",
  postalCode: "",
  recipientInfo: "",
};

function hasPermission(user: AuthUser, permission: string) {
  return Boolean(user.permissions?.includes(permission));
}

function money(value: number) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(Number(value || 0));
}

function dateTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function fileSize(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("读取文件失败。"));
    reader.readAsDataURL(file);
  });
}

function responsibilityFor(primary: string, secondary: string) {
  if (["仓库错发", "仓库漏发少发"].includes(primary) || secondary === "仓库发错货，客户差评不退货") {
    return { party: "warehouse", label: "仓库承担", explanation: "履约环节责任，系统计入受影响商品成本与打包费减免。" };
  }
  if (primary === "产品质量问题") return { party: "supplier_quality", label: "产品 / 供应链", explanation: "默认进入质量追责，仓库承担金额为 0；管理员可复核转责。" };
  if (["快递丢失", "运输破损"].includes(primary)) return { party: "logistics", label: "物流承运方", explanation: "默认进入物流索赔，仓库仅协助举证；包装不当时应由管理员转责。" };
  if (primary === "SKU匹配错误") return { party: "operations", label: "运营 / 系统", explanation: "默认按映射或配置问题处理，不自动计入仓库承担。" };
  return { party: "pending_review", label: "待选择原因", explanation: "选择一级分类后自动判断责任归属。" };
}

function customerText(customer?: AfterSalesCustomer) {
  if (!customer) return "";
  if (customer.recipientInfo?.trim()) return customer.recipientInfo.trim();
  const address = [customer.country, customer.province, customer.city, customer.district, customer.address].filter(Boolean).join(" ");
  return [customer.name, customer.phone, address, customer.postalCode ? `邮编：${customer.postalCode}` : ""].filter(Boolean).join("\n");
}

function reissueText(items: AfterSalesReissueItem[]) {
  return items.map((item) => `${item.sku}  ${item.productName}  × ${item.quantity}`).join("\n");
}

function isImageAttachment(attachment: AfterSalesAttachment) {
  return attachment.mimeType.startsWith("image/") || /\.(?:png|jpe?g|webp|gif|bmp)$/i.test(attachment.fileName);
}

function ProductThumbnail({ imageUrl, title, description, onPreview }: {
  imageUrl?: string;
  title: string;
  description?: string;
  onPreview: (image: AfterSalesImagePreview) => void;
}) {
  const source = resolveApiUrl(imageUrl || "");
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => setFailed(false), [source]);

  if (!source || failed) {
    return <span className="as-product-thumb is-empty" aria-label={source ? "产品图片加载失败" : "暂无产品图片"}><ImageOff size={20} /></span>;
  }

  return (
    <button type="button" className="as-product-thumb" onClick={() => onPreview({ src: source, title, description })} aria-label={`放大查看 ${title} 产品图片`}>
      <img src={source} alt={`${title} 产品缩略图`} loading="lazy" onError={() => setFailed(true)} />
      <span><ZoomIn size={15} /></span>
    </button>
  );
}

function AttachmentPreviewCard({ attachment, onDownload, onPreview, onError }: {
  attachment: AfterSalesAttachment;
  onDownload: (attachment: AfterSalesAttachment) => void;
  onPreview: (image: AfterSalesImagePreview) => void;
  onError: (message: string) => void;
}) {
  const canPreview = isImageAttachment(attachment);
  const [previewUrl, setPreviewUrl] = React.useState("");
  const [loadingPreview, setLoadingPreview] = React.useState(canPreview);
  const [previewFailed, setPreviewFailed] = React.useState(false);

  React.useEffect(() => {
    if (!canPreview) return undefined;
    let active = true;
    let objectUrl = "";
    setLoadingPreview(true);
    setPreviewFailed(false);
    void downloadAfterSalesAttachment(attachment)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setPreviewUrl(objectUrl);
      })
      .catch((loadError) => {
        if (!active) return;
        setPreviewFailed(true);
        onError(loadError instanceof Error ? loadError.message : "面单图片预览失败，可尝试直接下载。");
      })
      .finally(() => {
        if (active) setLoadingPreview(false);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.id, attachment.url, canPreview, onError]);

  if (!canPreview) {
    return (
      <button type="button" className="as-attachment-file" onClick={() => onDownload(attachment)}>
        <FileText size={22} />
        <span><strong>{attachment.fileName}</strong><small>PDF 文件 · {fileSize(attachment.size)}</small></span>
        <Download size={16} />
      </button>
    );
  }

  return (
    <article className="as-attachment-card">
      <button
        type="button"
        className="as-attachment-thumb"
        disabled={!previewUrl}
        onClick={() => previewUrl && onPreview({ src: previewUrl, title: attachment.fileName, description: `面单图片 · ${fileSize(attachment.size)}` })}
        aria-label={`放大查看面单 ${attachment.fileName}`}
      >
        {previewUrl ? <img src={previewUrl} alt={`${attachment.fileName} 缩略图`} /> : previewFailed ? <span><ImageOff size={22} />预览失败</span> : <span><LoaderCircle className="spinning" size={22} />正在加载</span>}
        {previewUrl ? <i><ZoomIn size={16} />点击放大</i> : null}
      </button>
      <div className="as-attachment-meta">
        <span><strong>{attachment.fileName}</strong><small>{loadingPreview ? "正在读取" : fileSize(attachment.size)}</small></span>
        <button type="button" onClick={() => onDownload(attachment)} aria-label={`下载 ${attachment.fileName}`}><Download size={15} /></button>
      </div>
    </article>
  );
}

function AttachmentList({ attachments, onDownload, onPreview, onError }: {
  attachments: AfterSalesAttachment[];
  onDownload: (attachment: AfterSalesAttachment) => void;
  onPreview: (image: AfterSalesImagePreview) => void;
  onError: (message: string) => void;
}) {
  if (!attachments.length) return <span className="as-empty-inline">暂无附件</span>;
  return (
    <div className="as-attachment-gallery">
      {attachments.map((attachment) => (
        <AttachmentPreviewCard key={attachment.id} attachment={attachment} onDownload={onDownload} onPreview={onPreview} onError={onError} />
      ))}
    </div>
  );
}

export function AfterSalesCenter({ currentUser }: { currentUser: AuthUser }) {
  const canReport = hasPermission(currentUser, "after_sales_report");
  const canWarehouse = hasPermission(currentUser, "after_sales_warehouse");
  const canAdmin = hasPermission(currentUser, "operations");
  const ownerKey = afterSalesOwnerKey(currentUser);
  const initialTab = canReport ? "report" : "warehouse";
  const initialFilters: AfterSalesListFilters = { status: "all", keyword: "", mine: false };
  const initialCache = readAfterSalesCache(ownerKey, initialFilters);
  const [tab, setTab] = React.useState<"report" | "mine" | "warehouse">(initialTab);
  const [payload, setPayload] = React.useState<AfterSalesPayload | null>(initialCache?.payload || null);
  const [loading, setLoading] = React.useState(!initialCache);
  const [refreshing, setRefreshing] = React.useState(Boolean(initialCache));
  const [slowLoading, setSlowLoading] = React.useState(false);
  const [lastLoadedAt, setLastLoadedAt] = React.useState(initialCache?.cachedAt || 0);
  const [busy, setBusy] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");
  const [orderNumber, setOrderNumber] = React.useState("");
  const [syncedOrder, setSyncedOrder] = React.useState<AfterSalesOrderSyncPayload["order"] | null>(null);
  const [customer, setCustomer] = React.useState<AfterSalesCustomer>(blankCustomer);
  const [warehouseId, setWarehouseId] = React.useState("");
  const [items, setItems] = React.useState<AfterSalesItem[]>([]);
  const [primaryReason, setPrimaryReason] = React.useState("");
  const [secondaryReason, setSecondaryReason] = React.useState("");
  const [needsReissue, setNeedsReissue] = React.useState(false);
  const [reissueItems, setReissueItems] = React.useState<AfterSalesReissueItem[]>([]);
  const [evidence, setEvidence] = React.useState<AfterSalesAttachment[]>([]);
  const [operatorRemark, setOperatorRemark] = React.useState("");
  const [additionalLiability, setAdditionalLiability] = React.useState(0);
  const [customerRecovery, setCustomerRecovery] = React.useState(0);
  const [adjustmentReason, setAdjustmentReason] = React.useState("");
  const [keyword, setKeyword] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [selectedTicket, setSelectedTicket] = React.useState<AfterSalesTicket | null>(null);
  const [previewImage, setPreviewImage] = React.useState<AfterSalesImagePreview | null>(null);
  const [warehouseRemark, setWarehouseRemark] = React.useState("");
  const [labelUploads, setLabelUploads] = React.useState<AfterSalesAttachment[]>([]);
  const payloadRef = React.useRef<AfterSalesPayload | null>(initialCache?.payload || null);
  const activeFiltersRef = React.useRef<AfterSalesListFilters>(initialFilters);
  const activeQueryKeyRef = React.useRef(afterSalesQueryKey(ownerKey, initialFilters));
  const requestIdRef = React.useRef(0);
  const abortRef = React.useRef<AbortController | null>(null);

  const responsibility = responsibilityFor(primaryReason, secondaryReason);
  const affectedCost = responsibility.party === "warehouse"
    ? items.reduce((sum, item) => sum + Number(item.unitCostCny || 0) * Number(item.affectedQty || 0), 0)
    : 0;
  const packagingFee = responsibility.party === "warehouse" ? Number(syncedOrder?.packagingFeeCny || 0) : 0;
  const liabilityTotal = Math.max(0, affectedCost + packagingFee + Number(additionalLiability || 0) - Number(customerRecovery || 0));
  const missingCosts = responsibility.party === "warehouse"
    ? items.filter((item) => item.affectedQty > 0 && item.unitCostCny <= 0).map((item) => item.sku)
    : [];
  const effectiveNeedsReissue = secondaryReason === "补发且留错品" || needsReissue;

  const refresh = React.useCallback(async (filters: AfterSalesListFilters = {}) => {
    const normalizedFilters = {
      status: filters.status || "all",
      keyword: (filters.keyword || "").trim(),
      mine: Boolean(filters.mine),
    };
    const queryKey = afterSalesQueryKey(ownerKey, normalizedFilters);
    const cached = readAfterSalesCache(ownerKey, normalizedFilters);
    const sameQuery = activeQueryKeyRef.current === queryKey;
    const visiblePayload = sameQuery ? payloadRef.current : cached?.payload || null;

    activeFiltersRef.current = normalizedFilters;
    activeQueryKeyRef.current = queryKey;
    if (!sameQuery) {
      payloadRef.current = visiblePayload;
      setPayload(visiblePayload);
      setLastLoadedAt(cached?.cachedAt || 0);
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    let timedOut = false;
    setLoading(!visiblePayload);
    setRefreshing(Boolean(visiblePayload));
    setSlowLoading(false);
    setError("");
    const slowTimer = window.setTimeout(() => {
      if (requestIdRef.current === requestId) setSlowLoading(true);
    }, 900);
    const timeoutTimer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, AFTER_SALES_REQUEST_TIMEOUT_MS);
    try {
      const nextPayload = await fetchAfterSales(normalizedFilters, controller.signal);
      if (requestIdRef.current !== requestId) return;
      const cachedAt = Date.now();
      payloadRef.current = nextPayload;
      writeAfterSalesCache(queryKey, { payload: nextPayload, cachedAt });
      setPayload(nextPayload);
      setLastLoadedAt(cachedAt);
    } catch (refreshError) {
      if (requestIdRef.current !== requestId || (controller.signal.aborted && !timedOut)) return;
      setError(timedOut
        ? "售后数据读取超时，页面不会把加载失败显示成没有工单，请点击重试。"
        : refreshError instanceof Error ? refreshError.message : "读取售后单失败。");
    } finally {
      window.clearTimeout(slowTimer);
      window.clearTimeout(timeoutTimer);
      if (requestIdRef.current === requestId) {
        setLoading(false);
        setRefreshing(false);
        setSlowLoading(false);
        abortRef.current = null;
      }
    }
  }, [ownerKey]);

  React.useEffect(() => {
    void refresh({
      status: tab === "report" ? "all" : status,
      keyword: tab === "report" ? "" : keyword,
      mine: tab === "mine",
    });
  }, [refresh, tab]);

  React.useEffect(() => {
    const refreshVisibleList = () => {
      if (tab !== "report" && document.visibilityState === "visible") void refresh(activeFiltersRef.current);
    };
    const timer = window.setInterval(refreshVisibleList, AFTER_SALES_AUTO_REFRESH_MS);
    document.addEventListener("visibilitychange", refreshVisibleList);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisibleList);
      abortRef.current?.abort();
    };
  }, [refresh, tab]);

  React.useEffect(() => {
    if (secondaryReason === "补发且留错品") setNeedsReissue(true);
  }, [secondaryReason]);

  React.useEffect(() => {
    if (!previewImage) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewImage(null);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [previewImage]);

  async function handleSyncOrder() {
    const normalized = orderNumber.trim();
    if (!normalized) {
      setError("请输入平台后台订单号。");
      return;
    }
    setBusy("sync");
    setError("");
    setMessage("");
    try {
      const result = await syncAfterSalesOrder(normalized);
      setSyncedOrder(result.order);
      setCustomer({ ...blankCustomer, ...result.order.customer });
      setWarehouseId(result.order.warehouseId || "");
      setItems(result.order.items.map((item) => ({ ...item })));
      setReissueItems([]);
      setMessage(result.warning || (result.source === "miaoshou_live" ? "已从妙手实时同步原订单。" : "已从本地妙手缓存读取原订单。"));
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "同步原订单失败。");
    } finally {
      setBusy("");
    }
  }

  function updateItem(sku: string, patch: Partial<AfterSalesItem>) {
    setItems((current) => current.map((item) => item.sku === sku ? { ...item, ...patch } : item));
  }

  function toggleReissue(source: AfterSalesItem) {
    setReissueItems((current) => {
      if (current.some((item) => item.sku === source.sku)) return current.filter((item) => item.sku !== source.sku);
      return [...current, { sku: source.sku, productName: source.productName, imageUrl: source.imageUrl, quantity: Math.max(1, source.affectedQty || 1) }];
    });
  }

  function addManualReissueItem() {
    setReissueItems((current) => [...current, { sku: `待填写-${Date.now()}`, productName: "", imageUrl: "", quantity: 1 }]);
  }

  async function handleEvidenceUpload(files: FileList | null) {
    const selected = Array.from(files || []);
    if (!selected.length) return;
    setBusy("evidence");
    setError("");
    try {
      const uploads: AfterSalesAttachment[] = [];
      for (const file of selected.slice(0, 8)) {
        const dataUrl = await fileToDataUrl(file);
        uploads.push((await uploadAfterSalesAttachment({ fileName: file.name, dataUrl, kind: "evidence" })).upload);
      }
      setEvidence((current) => [...current, ...uploads]);
      setMessage(`已上传 ${uploads.length} 个售后凭证。`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "上传售后凭证失败。");
    } finally {
      setBusy("");
    }
  }

  function resetReport() {
    setOrderNumber("");
    setSyncedOrder(null);
    setCustomer(blankCustomer);
    setWarehouseId("");
    setItems([]);
    setPrimaryReason("");
    setSecondaryReason("");
    setNeedsReissue(false);
    setReissueItems([]);
    setEvidence([]);
    setOperatorRemark("");
    setAdditionalLiability(0);
    setCustomerRecovery(0);
    setAdjustmentReason("");
  }

  async function handleSubmit() {
    if (!syncedOrder) return setError("请先同步原订单。");
    if (!primaryReason || !secondaryReason) return setError("请选择完整的售后一级和二级分类。");
    if (!items.some((item) => item.affectedQty > 0)) return setError("请填写至少一个受影响商品数量。");
    if (!warehouseId) return setError("请选择负责处理该售后单的仓库。");
    if (missingCosts.length) return setError(`请补录商品成本：${missingCosts.join("、")}`);
    if (effectiveNeedsReissue && !reissueItems.some((item) => item.sku && item.quantity > 0)) return setError("请选择补发商品和数量。");
    if (effectiveNeedsReissue && !customer.recipientInfo.trim()) return setError("需要补发时，请填写完整收件信息（收件人、电话和详细地址）。");
    if ((additionalLiability > 0 || customerRecovery > 0) && !adjustmentReason.trim()) return setError("有额外承担或客户补回金额时，请填写调整说明。");
    setBusy("submit");
    setError("");
    try {
      const result = await createAfterSalesTicket({
        order: syncedOrder,
        customer,
        warehouseId,
        warehouseName: (syncedOrder.warehouseOptions || []).find((item) => item.id === warehouseId)?.name || syncedOrder.warehouseName || "",
        originalItems: items,
        reissueItems: effectiveNeedsReissue ? reissueItems.map((item) => ({ ...item, sku: item.sku.replace(/^待填写-\d+$/, "") })) : [],
        primaryReason,
        secondaryReason,
        needsReissue: effectiveNeedsReissue,
        evidenceIds: evidence.map((item) => item.id),
        operatorRemark,
        additionalLiabilityCny: additionalLiability,
        customerRecoveryCny: customerRecovery,
        adjustmentReason,
      });
      setMessage(`售后单 ${result.ticket.id} 已提交，等待仓库接单。`);
      resetReport();
      clearAfterSalesCache(ownerKey);
      setTab("mine");
      await refresh({ mine: true });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "提交售后单失败。");
    } finally {
      setBusy("");
    }
  }

  async function openTicket(ticket: AfterSalesTicket) {
    setBusy(`detail:${ticket.id}`);
    setError("");
    try {
      const result = await fetchAfterSalesTicket(ticket.id);
      setSelectedTicket(result.ticket);
      setWarehouseRemark(result.ticket.warehouseRemark || "");
      setLabelUploads([]);
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : "读取售后详情失败。");
    } finally {
      setBusy("");
    }
  }

  async function copyText(value: string, label: string) {
    if (!value) return setError(`${label}暂未维护。`);
    await navigator.clipboard.writeText(value);
    setMessage(`${label}已复制。`);
  }

  async function handleLabelUpload(files: FileList | null) {
    const selected = Array.from(files || []);
    if (!selected.length) return;
    setBusy("label");
    setError("");
    try {
      const uploads: AfterSalesAttachment[] = [];
      for (const file of selected.slice(0, 4)) {
        const dataUrl = await fileToDataUrl(file);
        uploads.push((await uploadAfterSalesAttachment({ fileName: file.name, dataUrl, kind: "label" })).upload);
      }
      setLabelUploads((current) => [...current, ...uploads]);
      setMessage(`已上传 ${uploads.length} 张补发面单，提交状态后归档。`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "上传面单失败。");
    } finally {
      setBusy("");
    }
  }

  async function warehouseAction(action: "accept" | "await_reshipment" | "shipped" | "complete" | "cancel" | "reopen") {
    if (!selectedTicket) return;
    setBusy(action);
    setError("");
    try {
      const result = await updateAfterSalesWarehouse(selectedTicket.id, {
        action,
        warehouseRemark,
        note: warehouseRemark,
        labelUploadIds: labelUploads.map((upload) => upload.id),
      });
      setSelectedTicket(result.ticket);
      setLabelUploads([]);
      setMessage(`${result.ticket.id} 已更新为“${statusMeta[result.ticket.status]?.label || result.ticket.status}”。`);
      clearAfterSalesCache(ownerKey);
      await refresh({ status, keyword, mine: tab === "mine" });
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "更新售后单失败。");
    } finally {
      setBusy("");
    }
  }

  async function handleDownload(attachment: AfterSalesAttachment) {
    try {
      const blob = await downloadAfterSalesAttachment(attachment);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = attachment.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "下载附件失败。");
    }
  }

  function closeTicket() {
    setPreviewImage(null);
    setSelectedTicket(null);
  }

  function renderTicketList(myTickets = false) {
    return (
      <section className="after-sales-warehouse">
        {myTickets ? <div className="as-progress-intro"><BadgeCheck size={20} /><div><strong>我填报的售后进度</strong><span>仓库接单、补发和完结后会更新到这里；启用企业微信场景通知后，进度也会同步到运营群。</span></div></div> : null}
        <div className="as-warehouse-toolbar">
          <div className="as-filter-search"><Search size={17} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索售后单号、原订单号、店铺别名" /></div>
          <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option>{Object.entries(statusMeta).map(([value, meta]) => <option value={value} key={value}>{meta.label}</option>)}</select>
          <button type="button" disabled={loading || refreshing} onClick={() => void refresh({ status, keyword, mine: myTickets })}><RefreshCw className={loading || refreshing ? "spinning" : ""} size={16} />{loading ? "读取中" : refreshing ? "刷新中" : "查询"}</button>
        </div>
        <div className="as-ticket-table">
          <div className="head"><span>售后单 / 原订单</span><span>问题与处理</span><span>处理仓库</span><span>补发</span><span>仓库承担</span><span>状态</span><span></span></div>
          {loading && !payload ? <div className="as-table-loading" role="status" aria-live="polite"><LoaderCircle className="spinning" size={24} /><div><strong>正在同步{myTickets ? "你的" : "仓库"}售后单</strong><span>{slowLoading ? "网络响应较慢，仍在读取；完成前不会显示为“没有售后单”。" : "已优先读取售后数据，请稍候…"}</span></div></div> : null}
          {!loading && !payload ? <div className="as-table-load-error"><AlertTriangle size={22} /><div><strong>售后单暂未加载成功</strong><span>这不代表没有售后单，请重新读取。</span></div><button type="button" onClick={() => void refresh(activeFiltersRef.current)}>重新读取</button></div> : null}
          {!loading && payload && !payload.tickets.length ? <div className="as-table-empty"><PackageCheck size={24} />{myTickets ? "你还没有填报符合当前筛选条件的售后单" : "当前筛选下没有售后单"}</div> : null}
          {(payload?.tickets || []).map((ticket) => (
            <button type="button" className="row" key={ticket.id} onClick={() => void openTicket(ticket)}>
              <span><strong>{ticket.id}</strong><small>{ticket.originalOrderNumber}</small><small>{ticket.shopAlias || ticket.platformShopName || "未配置店铺别名"}</small></span>
              <span><strong>{ticket.primaryReason}</strong><small>{ticket.secondaryReason}</small></span>
              <span><strong>{ticket.warehouseName || "待分配"}</strong><small>{ticket.responsibility.label}</small></span>
              <span><strong>{ticket.needsReissue ? `${ticket.reissueItems.reduce((sum, item) => sum + item.quantity, 0)} 件` : "无需补发"}</strong><small>{ticket.needsReissue ? `${ticket.reissueItems.length} 个 SKU` : "仅记录 / 赔付"}</small></span>
              <span><strong>{money(ticket.money.totalWarehouseLiabilityCny)}</strong></span>
              <span className={`as-status ${statusMeta[ticket.status]?.tone || "muted"}`}>{statusMeta[ticket.status]?.label || ticket.status}</span>
              <span>{busy === `detail:${ticket.id}` ? <LoaderCircle className="spinning" size={17} /> : "查看进度"}</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <div className="after-sales-page">
      <section className="after-sales-hero">
        <div>
          <p className="eyebrow">AFTER-SALES COMMAND CENTER</p>
          <h1>售后协同中心</h1>
          <span>原单同步、责任判定、金额核算与仓库补发，一张工单走完全流程。</span>
        </div>
        <div className="after-sales-hero-badge"><ShieldCheck size={22} /><span><strong>规则自动判责</strong><small>成本快照全程可追溯</small></span></div>
      </section>

      <section className="after-sales-kpis">
        <article><span>{tab === "mine" ? "我的待接单" : "待仓库接单"}</span><strong>{payload ? payload.summary.pendingWarehouse : "—"}</strong><small>{payload ? "需要仓库确认处理" : "数据读取中，不展示为 0"}</small></article>
        <article><span>处理中</span><strong>{payload ? payload.summary.processing : "—"}</strong><small>{payload ? "含待补发工单" : "数据读取中，不展示为 0"}</small></article>
        <article><span>待补发</span><strong>{payload ? payload.summary.awaitingReshipment : "—"}</strong><small>{payload ? "等待面单与发出" : "数据读取中，不展示为 0"}</small></article>
        <article className="liability"><span>仓库承担金额</span><strong>{payload ? money(payload.summary.warehouseLiabilityCny) : "—"}</strong><small>{payload ? "不含已作废工单" : "数据读取中，不展示为 0"}</small></article>
      </section>

      <div className="after-sales-tabs" role="tablist">
        {canReport ? <button className={tab === "report" ? "active" : ""} onClick={() => setTab("report")}><Clipboard size={17} />运营填报</button> : null}
        {canReport ? <button className={tab === "mine" ? "active" : ""} onClick={() => setTab("mine")}><BadgeCheck size={17} />我的售后 {tab === "mine" ? <span>{payload ? payload.summary.open : "…"}</span> : null}</button> : null}
        {canWarehouse ? <button className={tab === "warehouse" ? "active" : ""} onClick={() => setTab("warehouse")}><Truck size={17} />仓库处理 <span>{payload ? payload.summary.pendingWarehouse : "…"}</span></button> : null}
        <div className="as-data-freshness" role="status" aria-live="polite">
          {refreshing ? <><RefreshCw className="spinning" size={14} />正在后台更新，当前列表可继续使用</> : lastLoadedAt ? <><BadgeCheck size={14} />数据更新于 {new Date(lastLoadedAt).toLocaleTimeString("zh-CN", { hour12: false })}</> : <><LoaderCircle className="spinning" size={14} />正在首次读取</>}
        </div>
      </div>

      {error ? <div className="as-notice error"><AlertTriangle size={17} />{error}<button onClick={() => setError("")}><X size={15} /></button></div> : null}
      {message ? <div className="as-notice success"><Check size={17} />{message}<button onClick={() => setMessage("")}><X size={15} /></button></div> : null}

      {tab === "report" && canReport ? (
        <div className="after-sales-report-layout">
          <main className="after-sales-form-flow">
            <section className="as-step-card">
              <div className="as-step-heading"><span>01</span><div><p>同步原单</p><h2>输入平台后台订单号</h2></div></div>
              <div className="as-order-search">
                <input value={orderNumber} onChange={(event) => setOrderNumber(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void handleSyncOrder()} placeholder="例如：576239876543210987" />
                <button type="button" onClick={() => void handleSyncOrder()} disabled={busy === "sync"}>{busy === "sync" ? <LoaderCircle className="spinning" size={18} /> : <RefreshCw size={18} />}{busy === "sync" ? "正在查询妙手" : "同步原订单"}</button>
              </div>
              <p className="as-helper">严格按平台后台订单号精确匹配；本地缓存优先，必要时实时补查妙手。</p>

              {syncedOrder ? (
                <div className="as-synced-order">
                  <header><div><span>{syncedOrder.platform || "妙手订单"} · {syncedOrder.site}</span><strong>{syncedOrder.orderNumber}</strong></div><div><span>店铺别名</span><strong>{syncedOrder.shopAlias || "未配置"}</strong></div><div><span>下单时间</span><strong>{dateTime(syncedOrder.orderStartedAt)}</strong></div></header>
                  {syncedOrder.existingTickets.length ? <div className="as-duplicate-warning"><AlertTriangle size={16} />该原订单已有 {syncedOrder.existingTickets.length} 张售后单，请确认不是重复填报。</div> : null}
                  <div className="as-routing-grid">
                    <label><span>处理仓库</span><select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}><option value="">请选择处理仓库</option>{(syncedOrder.warehouseOptions || []).map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.name} · {warehouse.country}</option>)}</select><small>{syncedOrder.warehouseOptions?.length === 1 ? "已按订单国家自动匹配" : "请确认实际负责补发或处理的仓库"}</small></label>
                    <label className="as-recipient-field"><span>完整收件信息</span><textarea value={customer.recipientInfo} onChange={(event) => setCustomer((current) => ({ ...current, recipientInfo: event.target.value }))} placeholder={'请完整填写并核对：\n收件人：张三\n电话：0812xxxxxx\n地址：国家 / 省市区 / 街道门牌号\n邮编：如有请填写'} /><small>无需拆分填写。仓库端会整段显示，并可一键复制。</small></label>
                  </div>
                  <div className="as-item-table">
                    <div className="head"><span>原单商品</span><span>下单数量</span><span>受影响数量</span><span>直营成本 / 件</span><span>补发</span></div>
                    {items.map((item) => (
                      <div className="row" key={item.sku}>
                        <div className="product">{item.imageUrl ? <img src={resolveApiUrl(item.imageUrl)} alt="" /> : <span><PackageCheck size={20} /></span>}<div><strong>{item.sku}</strong><small>{item.productName}</small></div></div>
                        <strong>{item.orderedQty}</strong>
                        <input type="number" min="0" max={item.orderedQty} value={item.affectedQty} onChange={(event) => updateItem(item.sku, { affectedQty: Math.min(item.orderedQty, Math.max(0, Number(event.target.value))) })} />
                        <label className={item.unitCostCny <= 0 ? "cost-missing" : ""}><input type="number" min="0" step="0.01" value={item.unitCostCny || ""} placeholder="补录成本" onChange={(event) => updateItem(item.sku, { unitCostCny: Math.max(0, Number(event.target.value)), costMissing: false, costSource: "运营人工成本" })} /><small>{item.costSource}</small></label>
                        <button type="button" className={reissueItems.some((candidate) => candidate.sku === item.sku) ? "selected" : ""} onClick={() => toggleReissue(item)}>{reissueItems.some((candidate) => candidate.sku === item.sku) ? <Check size={15} /> : <Plus size={15} />}</button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>

            <section className="as-step-card">
              <div className="as-step-heading"><span>02</span><div><p>原因与凭证</p><h2>系统自动判断责任归属</h2></div></div>
              <div className="as-reason-grid">
                <label><span>售后一级分类</span><select value={primaryReason} onChange={(event) => setPrimaryReason(event.target.value)}><option value="">请选择问题原因</option>{primaryReasons.map((reason) => <option key={reason}>{reason}</option>)}</select></label>
                <label><span>售后二级分类</span><select value={secondaryReason} onChange={(event) => setSecondaryReason(event.target.value)}><option value="">请选择处理方式</option>{secondaryReasons.map((reason) => <option key={reason}>{reason}</option>)}</select></label>
              </div>
              <div className={`as-responsibility ${responsibility.party}`}><ShieldCheck size={20} /><div><span>自动责任归属</span><strong>{responsibility.label}</strong><small>{responsibility.explanation}</small></div></div>
              <div className="as-evidence-zone">
                <label><Upload size={22} /><strong>{busy === "evidence" ? "正在上传…" : "上传图片 / 视频截图 / PDF 凭证"}</strong><span>单个文件不超过 8MB，最多一次选择 8 个</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" multiple hidden onChange={(event) => void handleEvidenceUpload(event.target.files)} /></label>
                <AttachmentList attachments={evidence} onDownload={handleDownload} onPreview={setPreviewImage} onError={setError} />
              </div>
              <label className="as-textarea"><span>运营备注</span><textarea value={operatorRemark} onChange={(event) => setOperatorRemark(event.target.value)} placeholder="说明客户反馈、沟通结果、退款情况及需要仓库注意的事项。" /></label>
            </section>

            <section className="as-step-card">
              <div className="as-step-heading"><span>03</span><div><p>补发与结算</p><h2>确认仓库动作和承担金额</h2></div></div>
              <label className="as-switch-row"><input type="checkbox" checked={effectiveNeedsReissue} disabled={secondaryReason === "补发且留错品"} onChange={(event) => setNeedsReissue(event.target.checked)} /><span><strong>需要仓库补发</strong><small>开启后必须维护补发商品与数量，并由仓库上传面单。</small></span></label>
              {effectiveNeedsReissue ? (
                <div className="as-reissue-editor">
                  <header><strong>补发商品清单</strong><button type="button" onClick={addManualReissueItem}><Plus size={15} />添加其他商品</button></header>
                  {reissueItems.length ? reissueItems.map((item, index) => (
                    <div className="as-reissue-row" key={`${item.sku}-${index}`}>
                      <input value={item.sku.replace(/^待填写-\d+$/, "")} placeholder="SKU" onChange={(event) => setReissueItems((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, sku: event.target.value } : row))} />
                      <input value={item.productName} placeholder="产品名称" onChange={(event) => setReissueItems((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, productName: event.target.value } : row))} />
                      <input type="number" min="1" value={item.quantity} onChange={(event) => setReissueItems((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: Math.max(1, Number(event.target.value)) } : row))} />
                      <button type="button" onClick={() => setReissueItems((current) => current.filter((_, rowIndex) => rowIndex !== index))}><X size={16} /></button>
                    </div>
                  )) : <div className="as-empty-inline">请在原单商品右侧点击“+”选择补发商品。</div>}
                </div>
              ) : null}
              <div className="as-adjustment-grid">
                <label><span>额外承担（元）</span><input type="number" min="0" step="0.01" value={additionalLiability || ""} placeholder="如平台赔付、补发运费" onChange={(event) => setAdditionalLiability(Math.max(0, Number(event.target.value)))} /></label>
                <label><span>客户补回（元）</span><input type="number" min="0" step="0.01" value={customerRecovery || ""} placeholder="如客户补差价" onChange={(event) => setCustomerRecovery(Math.max(0, Number(event.target.value)))} /></label>
                <label className="wide"><span>金额调整说明</span><input value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} placeholder="填写额外承担或客户补回时必填" /></label>
              </div>
            </section>
          </main>

          <aside className="as-settlement-card">
            <div className="as-settlement-head"><span>责任结算预览</span><BadgeCheck size={21} /></div>
            <div className="as-settlement-responsibility"><small>默认责任方</small><strong>{responsibility.label}</strong></div>
            <dl><div><dt>受影响产品成本</dt><dd>{money(affectedCost)}</dd></div><div><dt>打包费减免</dt><dd>{money(packagingFee)}</dd></div><div><dt>额外承担</dt><dd>{money(additionalLiability)}</dd></div><div className="minus"><dt>客户补回</dt><dd>- {money(customerRecovery)}</dd></div></dl>
            <div className="as-settlement-total"><span>仓库需承担</span><strong>{money(liabilityTotal)}</strong><small>创建后冻结本次成本与规则快照</small></div>
            {missingCosts.length ? <div className="as-cost-warning"><AlertTriangle size={16} />缺少成本：{missingCosts.join("、")}</div> : null}
            <button type="button" className="as-submit" disabled={busy === "submit" || !syncedOrder} onClick={() => void handleSubmit()}>{busy === "submit" ? <LoaderCircle className="spinning" size={18} /> : <Send size={18} />}{busy === "submit" ? "正在提交" : "提交给仓库"}</button>
            <p>系统允许同一订单多次售后，但会在同步时提示已有工单，避免重复计责。</p>
          </aside>
        </div>
      ) : null}

      {tab === "mine" && canReport ? renderTicketList(true) : null}
      {tab === "warehouse" && canWarehouse ? renderTicketList(false) : null}

      {selectedTicket ? (
        <div className="as-drawer-backdrop" onMouseDown={(event) => event.currentTarget === event.target && closeTicket()}>
          <aside className="as-ticket-drawer" aria-label={`售后单 ${selectedTicket.id} 详情`}>
            <header><div><p className="eyebrow">AFTER-SALES TICKET</p><h2>{selectedTicket.id}</h2><span>原订单 {selectedTicket.originalOrderNumber}</span></div><button type="button" onClick={closeTicket} aria-label="关闭售后详情"><X size={19} /></button></header>
            <div className="as-drawer-scroll">
              <section className="as-ticket-summary"><span className={`as-status ${statusMeta[selectedTicket.status]?.tone || "muted"}`}>{statusMeta[selectedTicket.status]?.label || selectedTicket.status}</span><div><small>处理仓库</small><strong>{selectedTicket.warehouseName || "待分配"}</strong></div><div><small>责任归属</small><strong>{selectedTicket.responsibility.label}</strong></div><div><small>仓库承担</small><strong>{money(selectedTicket.money.totalWarehouseLiabilityCny)}</strong></div></section>
              <section className="as-drawer-section"><header><div><small>售后产品</small><strong>{selectedTicket.originalItems.reduce((sum, item) => sum + item.affectedQty, 0)} 件受影响</strong></div><span className="as-preview-hint"><ZoomIn size={13} />点击缩略图可放大</span></header><div className="as-drawer-items as-drawer-product-items">{selectedTicket.originalItems.filter((item) => item.affectedQty > 0).map((item) => <div key={item.sku}><ProductThumbnail imageUrl={item.imageUrl} title={item.productName || item.sku} description={`${item.sku} · 受影响 ${item.affectedQty} 件`} onPreview={setPreviewImage} /><span className="as-drawer-item-copy"><span>{item.sku}</span><strong>{item.productName}</strong><small>原单数量：{item.orderedQty}</small></span><b>× {item.affectedQty}</b></div>)}</div></section>
              <section className="as-drawer-section"><header><div><small>完整收件信息</small><strong>仓库可整段复制</strong></div><button type="button" onClick={() => void copyText(customerText(selectedTicket.customer), "收件信息")}><Copy size={15} />复制收件信息</button></header><pre>{customerText(selectedTicket.customer) || "运营暂未维护收件人、电话和详细地址。"}</pre></section>
              <section className="as-drawer-section"><header><div><small>补发清单</small><strong>{selectedTicket.needsReissue ? `${selectedTicket.reissueItems.length} 个 SKU` : "无需补发"}</strong></div>{selectedTicket.needsReissue ? <button type="button" onClick={() => void copyText(reissueText(selectedTicket.reissueItems), "补发产品信息")}><Copy size={15} />复制补发清单</button> : null}</header>{selectedTicket.needsReissue ? <div className="as-drawer-items as-drawer-product-items">{selectedTicket.reissueItems.map((item) => <div key={item.sku}><ProductThumbnail imageUrl={item.imageUrl} title={item.productName || item.sku} description={`${item.sku} · 补发 ${item.quantity} 件`} onPreview={setPreviewImage} /><span className="as-drawer-item-copy"><span>{item.sku}</span><strong>{item.productName}</strong></span><b>× {item.quantity}</b></div>)}</div> : <div className="as-empty-inline">该售后单无需仓库补发。</div>}</section>
              <section className="as-drawer-section"><header><div><small>问题说明</small><strong>{selectedTicket.primaryReason} / {selectedTicket.secondaryReason}</strong></div></header><p>{selectedTicket.operatorRemark || "运营未填写补充备注。"}</p><AttachmentList attachments={selectedTicket.evidence || []} onDownload={handleDownload} onPreview={setPreviewImage} onError={setError} /></section>
              {selectedTicket.needsReissue ? <section className="as-drawer-section"><header><div><small>补发面单</small><strong>{canWarehouse ? "上传后随状态动作归档" : "仓库上传后可在此查看"}</strong></div><span className="as-preview-hint"><ZoomIn size={13} />图片可放大</span></header>{canWarehouse ? <label className="as-label-upload"><Upload size={18} /><span>{busy === "label" ? "正在上传…" : "选择图片或 PDF 面单"}</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" multiple hidden onChange={(event) => void handleLabelUpload(event.target.files)} /></label> : null}<AttachmentList attachments={[...(selectedTicket.labelUploads || []), ...(canWarehouse ? labelUploads : [])]} onDownload={handleDownload} onPreview={setPreviewImage} onError={setError} /></section> : null}
              {canWarehouse ? <section className="as-drawer-section"><label className="as-textarea"><span>仓库处理备注</span><textarea value={warehouseRemark} onChange={(event) => setWarehouseRemark(event.target.value)} placeholder="填写核查结果、补发物流单号或完结说明。" /></label></section> : selectedTicket.warehouseRemark ? <section className="as-drawer-section"><header><div><small>仓库处理说明</small><strong>最近更新</strong></div></header><p>{selectedTicket.warehouseRemark}</p></section> : null}
              {selectedTicket.notifications?.length ? <section className="as-drawer-section as-notification-state"><header><div><small>企业微信通知</small><strong>最近一次：{selectedTicket.notifications.at(-1)?.status === "sent" ? "已发送" : selectedTicket.notifications.at(-1)?.status === "failed" ? "发送失败" : "未配置"}</strong></div></header><span>{dateTime(selectedTicket.notifications.at(-1)?.createdAt)}{selectedTicket.notifications.at(-1)?.message ? ` · ${selectedTicket.notifications.at(-1)?.message}` : ""}</span></section> : null}
              <section className="as-drawer-section as-timeline"><header><div><small>处理时间线</small><strong>共 {selectedTicket.timeline.length} 个节点</strong></div></header>{[...selectedTicket.timeline].reverse().map((item, index) => <div className="as-timeline-item" key={item.id}><i className={index === 0 ? "active" : ""} /><div><strong>{item.label}</strong><span>{item.actor} · {dateTime(item.createdAt)}</span>{item.note ? <p>{item.note}</p> : null}</div></div>)}</section>
            </div>
            {canWarehouse || canAdmin ? <footer>
              {selectedTicket.status === "pending_warehouse" ? <button className="primary" onClick={() => void warehouseAction("accept")} disabled={Boolean(busy)}>确认接单</button> : null}
              {["pending_warehouse", "processing"].includes(selectedTicket.status) && selectedTicket.needsReissue ? <button className="primary" onClick={() => void warehouseAction("await_reshipment")} disabled={Boolean(busy)}>进入待补发</button> : null}
              {["processing", "awaiting_reshipment"].includes(selectedTicket.status) && selectedTicket.needsReissue ? <button className="primary" onClick={() => void warehouseAction("shipped")} disabled={Boolean(busy)}>上传面单并标记发出</button> : null}
              {selectedTicket.status === "processing" && !selectedTicket.needsReissue ? <button className="primary" onClick={() => void warehouseAction("complete")} disabled={Boolean(busy)}>确认完结</button> : null}
              {selectedTicket.status === "shipped" ? <button className="primary" onClick={() => void warehouseAction("complete")} disabled={Boolean(busy)}>确认售后完结</button> : null}
              {canAdmin && !["completed", "cancelled"].includes(selectedTicket.status) ? <button className="danger" onClick={() => void warehouseAction("cancel")} disabled={Boolean(busy)}>作废</button> : null}
              {canAdmin && ["completed", "cancelled"].includes(selectedTicket.status) ? <button onClick={() => void warehouseAction("reopen")} disabled={Boolean(busy)}>重新打开</button> : null}
            </footer> : null}
          </aside>
        </div>
      ) : null}

      {previewImage ? (
        <div className="as-image-lightbox" role="dialog" aria-modal="true" aria-label="图片放大预览" onMouseDown={(event) => event.currentTarget === event.target && setPreviewImage(null)}>
          <figure>
            <button type="button" className="as-lightbox-close" onClick={() => setPreviewImage(null)} aria-label="关闭图片预览"><X size={20} /></button>
            <img src={previewImage.src} alt={previewImage.title} />
            <figcaption><strong>{previewImage.title}</strong>{previewImage.description ? <span>{previewImage.description}</span> : null}</figcaption>
          </figure>
        </div>
      ) : null}
    </div>
  );
}
