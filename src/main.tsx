import React from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  ArrowUp,
  ArrowUpRight,
  BarChart3,
  Bot,
  Boxes,
  CalendarDays,
  ChevronDown,
  Check,
  Copy,
  DatabaseZap,
  Download,
  ExternalLink,
  FileText,
  Globe2,
  Image,
  KeyRound,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  PackageCheck,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Video,
  Truck,
  X,
} from "lucide-react";
import {
  AiConfigPayload,
  AssetPayload,
  AssetRecord,
  AuthUser,
  CatalogProduct,
  InventorySnapshotPayload,
  MovementPayload,
  ProductBase,
  ProductPayload,
  QuickNavPayload,
  QualificationPayload,
  QualificationRecord,
  StockupPayload,
  UserManagementPayload,
  WarehousePayload,
  WarehouseInfoPayload,
  WarehouseInfoRecord,
  createWarehouseConnection,
  createQuickNavCategory,
  createQuickNavLink,
  createUser,
  deleteQuickNavCategory,
  deleteQuickNavLink,
  captureInventorySnapshot,
  deleteUser,
  deleteWarehouseConnection,
  exportWarehouseConnections,
  fetchAssets,
  fetchCurrentUser,
  fetchInventorySnapshots,
  fetchMovement,
  fetchProducts,
  fetchQuickNav,
  fetchQualifications,
  fetchStockup,
  fetchUsers,
  fetchWarehouses,
  fetchWarehouseInfo,
  getStoredUser,
  importWarehouseConnections,
  downloadInventorySnapshotCsv,
  loginInternal,
  logoutInternal,
  qualificationFileDownloadUrl,
  syncAssets,
  syncOutsourcingOrders,
  syncOrders,
  syncProducts,
  syncQualifications,
  syncStockupOrders,
  syncWarehouses,
  syncWarehouseInfo,
  updateUserStatus,
  updateWarehouseConnection,
  fetchAiConfig,
  fetchAiVideoStatus,
  runAiImage,
  runAiText,
  runAiVideo,
  streamAiText,
  updateAiConfig,
  uploadAiImage,
} from "./api";
import "./styles.css";

type AlertType = "补货" | "断货" | "健康" | "滞销";
type MovementSortKey = "sku" | "country" | "availableQty" | "avgDaily7" | "sales90" | "daysCover" | "status";
type SortDirection = "asc" | "desc";
const AUTO_SYNC_INTERVAL_MS = 10 * 60 * 1000;

type Warehouse = {
  name: string;
  country: string;
  provider: string;
  baseUrl: string;
  status: "正常" | "延迟" | "异常";
  lastSyncedAt: string;
};

type DailyOrder = {
  date: string;
  country: string;
  orders: number;
  amount: number;
  exceptions: number;
};

const fallbackCatalog: CatalogProduct[] = [
  {
    id: "fallback-1",
    skuNo: "00001",
    sku: "TZ-RU-CP-1024",
    name: "黑麦能量饼干组合",
    nameEn: "Rye Energy Cookie Set",
    country: "俄罗斯",
    channel: "分销",
    category: "食品",
    unit: "箱",
    brand: "同舟",
    distributionPrice: 11.8,
    distributionCurrency: "USD",
    directPrice: 10.2,
    directCurrency: "USD",
    stockQty: 1840,
    status: "在售",
    alert: "补货",
    visualTone: "food",
  },
  {
    id: "fallback-2",
    skuNo: "00002",
    sku: "TZ-VN-HC-8801",
    name: "便携护颈热敷仪",
    nameEn: "Portable Neck Warmer",
    country: "越南",
    channel: "直营",
    category: "个护",
    unit: "台",
    brand: "同舟",
    distributionPrice: 29.8,
    distributionCurrency: "USD",
    directPrice: 26.5,
    directCurrency: "USD",
    stockQty: 426,
    status: "预警",
    alert: "断货",
    visualTone: "care",
  },
  {
    id: "fallback-3",
    skuNo: "00003",
    sku: "TZ-MY-KT-7302",
    name: "厨房密封收纳套装",
    nameEn: "Kitchen Storage Set",
    country: "马来西亚",
    channel: "分销",
    category: "家居",
    unit: "套",
    brand: "同舟",
    distributionPrice: 8.9,
    distributionCurrency: "USD",
    directPrice: 7.6,
    directCurrency: "USD",
    stockQty: 3860,
    status: "在售",
    alert: "滞销",
    visualTone: "home",
  },
  {
    id: "fallback-4",
    skuNo: "00004",
    sku: "TZ-ID-BB-4126",
    name: "婴童柔纸巾箱装",
    nameEn: "Baby Soft Tissue Box",
    country: "印尼",
    channel: "直营",
    category: "母婴",
    unit: "箱",
    brand: "同舟",
    distributionPrice: 15.4,
    distributionCurrency: "USD",
    directPrice: 13.2,
    directCurrency: "USD",
    stockQty: 2260,
    status: "在售",
    alert: "健康",
    visualTone: "baby",
  },
];

const warehouses: Warehouse[] = [
  { name: "莫斯科一仓", country: "俄罗斯", provider: "YunWMS RU", baseUrl: "fsdd.yunwms.com", status: "正常", lastSyncedAt: "10:42" },
  { name: "越南斗仓 A", country: "越南", provider: "SEA WMS", baseUrl: "vn-api.partner-wms.local", status: "延迟", lastSyncedAt: "09:18" },
  { name: "马来神牛一仓", country: "马来西亚", provider: "SEA WMS", baseUrl: "my-api.partner-wms.local", status: "正常", lastSyncedAt: "10:39" },
  { name: "印尼神牛雅加达仓", country: "印尼", provider: "SEA WMS", baseUrl: "id-api.partner-wms.local", status: "正常", lastSyncedAt: "10:41" },
];

const dailyOrders: DailyOrder[] = [
  { date: "06-05", country: "俄罗斯", orders: 218, amount: 6320, exceptions: 3 },
  { date: "06-06", country: "越南", orders: 166, amount: 5140, exceptions: 7 },
  { date: "06-07", country: "马来西亚", orders: 142, amount: 3920, exceptions: 2 },
  { date: "06-08", country: "印尼", orders: 246, amount: 7480, exceptions: 4 },
  { date: "06-09", country: "俄罗斯", orders: 238, amount: 6810, exceptions: 2 },
  { date: "06-10", country: "越南", orders: 191, amount: 5680, exceptions: 5 },
  { date: "06-11", country: "印尼", orders: 264, amount: 8010, exceptions: 3 },
];

const navItems = [
  { label: "经营总览", icon: LayoutDashboard, hash: "#dashboard" },
  { label: "库存同步", icon: DatabaseZap, hash: "#inventory" },
  { label: "库存快照", icon: Boxes, hash: "#inventory-snapshots" },
  { label: "订单日报", icon: CalendarDays, hash: "#orders" },
  { label: "动销监控", icon: BarChart3, hash: "#movement" },
  { label: "备货中心", icon: PackageCheck, hash: "#stockup" },
  { label: "产品库", icon: ShoppingBag, hash: "#products" },
  { label: "资质库", icon: FileText, hash: "#qualifications", childOf: "产品库" },
  { label: "素材库", icon: Boxes, hash: "#assets", childOf: "产品库" },
  { label: "仓库信息", icon: Truck, hash: "#warehouse-info", childOf: "产品库" },
  { label: "快捷导航", icon: Globe2, hash: "#quick-nav" },
  { label: "同舟AI", icon: Bot, hash: "#tongzhou-ai", beta: true },
  { label: "仓库授权", icon: ShieldCheck, hash: "#warehouses" },
  { label: "用户管理", icon: Lock, hash: "#users" },
];

const viewHashMap = Object.fromEntries(navItems.map((item) => [item.hash, item.label]));

function getInitialView() {
  return viewHashMap[window.location.hash] ?? "经营总览";
}

function hashForView(view: string) {
  return navItems.find((item) => item.label === view)?.hash ?? "#dashboard";
}

function visibleNavItems(user: AuthUser) {
  if (canManage(user)) return navItems;
  if (canViewPartnerAssets(user)) {
    return navItems.filter((item) => ["产品库", "资质库", "素材库", "仓库信息", "快捷导航", "同舟AI"].includes(item.label));
  }
  return navItems.filter((item) => item.label === "产品库");
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatDecimal(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value);
}

function formatMoney(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function formatDate(value?: string) {
  if (!value) return "未配置";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-CN");
}

function formatDateTime(value?: string) {
  if (!value) return "未配置";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function parseTimeToMinutes(value?: string) {
  const match = String(value || "").match(/(\d{1,2})[:：](\d{1,2})|(\d{1,2})\s*(?:点|时|h)/i);
  if (!match) return null;
  const hour = Number(match[1] ?? match[3]);
  const minute = Number(match[2] ?? 0);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23 || !Number.isFinite(minute) || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function timezoneOffsetMinutes(value?: string) {
  const text = String(value || "");
  const match = text.match(/UTC\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?|GMT\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?/i);
  if (!match) return null;
  const sign = (match[1] || match[4]) === "-" ? -1 : 1;
  const hour = Number(match[2] || match[5] || 0);
  const minute = Number(match[3] || match[6] || 0);
  return sign * (hour * 60 + minute);
}

function minutesInWarehouseTimezone(timezone?: string) {
  const now = new Date();
  const offset = timezoneOffsetMinutes(timezone);
  if (offset !== null) {
    const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    return (utcMinutes + offset + 24 * 60) % (24 * 60);
  }

  try {
    if (timezone && /[A-Za-z]+\/[A-Za-z_]+/.test(timezone)) {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(now);
      const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
      const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
      return hour * 60 + minute;
    }
  } catch {
    // Fall back to local time if the configured timezone is not an IANA name.
  }

  return now.getHours() * 60 + now.getMinutes();
}

function isWarehouseWorking(record?: WarehouseInfoRecord) {
  const start = parseTimeToMinutes(record?.workStartTime);
  const end = parseTimeToMinutes(record?.workEndTime);
  if (start === null || end === null) return true;
  const current = minutesInWarehouseTimezone(record?.timezone);
  if (start <= end) return current >= start && current <= end;
  return current >= start || current <= end;
}

function isConfiguredText(value?: string) {
  return Boolean(value && value.trim() && value.trim() !== "未配置");
}

function isWarehouseAddressValue(record: WarehouseInfoRecord, value: string) {
  return [record.shopShippingAddress, record.shopReturnAddress, record.firstMileReceivingAddress].some((address) => address === value && isConfiguredText(address));
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function CopyableSku({ sku, className = "" }: { sku: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);

  async function handleCopy(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    await copyText(sku);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <button className={`copyable-sku ${copied ? "copied" : ""} ${className}`} type="button" onClick={handleCopy} title="点击复制 SKU">
      <span>{copied ? "已复制" : sku}</span>
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

function flagCodeForCountry(country: string) {
  if (/俄罗斯|RU\b/i.test(country)) return "ru";
  if (/越南|VN\b/i.test(country)) return "vn";
  if (/马来|MY\b/i.test(country)) return "my";
  if (/印尼|印度尼西亚|ID\b/i.test(country)) return "id";
  if (/泰国|TH\b/i.test(country)) return "th";
  if (/菲律宾|PH\b/i.test(country)) return "ph";
  if (/新加坡|SG\b/i.test(country)) return "sg";
  if (/中国|CN\b/i.test(country)) return "cn";
  return "global";
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function canManage(user: AuthUser) {
  return user.role === "direct";
}

function canViewPartnerAssets(user: AuthUser) {
  return user.role === "direct" || user.role === "distributor";
}

function canViewPrices(user: AuthUser) {
  return user.role === "direct" || user.role === "distributor";
}

function canViewInventory(user: AuthUser) {
  return user.role === "direct" || user.role === "distributor";
}

function includesFuzzy(product: CatalogProduct, keyword: string) {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) return true;
  const haystack = [
    product.skuNo,
    product.sku,
    product.name,
    product.nameEn,
    product.country,
    product.category,
    product.brand,
    product.unit,
    product.countrySku,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(normalizedKeyword);
}

function alertClass(alert: AlertType | string) {
  return {
    补货: "warning",
    断货: "danger",
    健康: "good",
    滞销: "muted",
  }[alert] || "muted";
}

function priceFor(product: CatalogProduct, channel: "全部" | "直营" | "分销", internal: boolean) {
  if (internal && channel === "直营") {
    return {
      price: product.directCostPrice ?? product.directPrice ?? 0,
      currency: product.directCostCurrency || product.directCurrency || product.distributionCurrency,
      label: "直营成本价",
    };
  }
  return {
    price: product.distributionCostPrice ?? product.distributionCost ?? product.distributionPrice ?? 0,
    currency: product.distributionCostCurrency || product.distributionCurrency,
    label: "分销成本价",
  };
}

function salesPriceFor(product: CatalogProduct) {
  return {
    price: product.salesPrice ?? 0,
    currency: product.salesCurrency || product.distributionCurrency,
    label: "销售价",
  };
}

function App() {
  const [activeView, setActiveView] = React.useState(getInitialView);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [payload, setPayload] = React.useState<ProductPayload | null>(null);
  const [warehousePayload, setWarehousePayload] = React.useState<WarehousePayload | null>(null);
  const [inventorySnapshotPayload, setInventorySnapshotPayload] = React.useState<InventorySnapshotPayload | null>(null);
  const [movementPayload, setMovementPayload] = React.useState<MovementPayload | null>(null);
  const [stockupPayload, setStockupPayload] = React.useState<StockupPayload | null>(null);
  const [qualificationPayload, setQualificationPayload] = React.useState<QualificationPayload | null>(null);
  const [assetPayload, setAssetPayload] = React.useState<AssetPayload | null>(null);
  const [warehouseInfoPayload, setWarehouseInfoPayload] = React.useState<WarehouseInfoPayload | null>(null);
  const [quickNavPayload, setQuickNavPayload] = React.useState<QuickNavPayload | null>(null);
  const [aiConfigPayload, setAiConfigPayload] = React.useState<AiConfigPayload | null>(null);
  const [userPayload, setUserPayload] = React.useState<UserManagementPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [syncing, setSyncing] = React.useState(false);
  const [error, setError] = React.useState("");
  const [currentUser, setCurrentUser] = React.useState<AuthUser>(getStoredUser);
  const internal = canManage(currentUser);

  const catalog = payload?.catalog?.length ? payload.catalog : fallbackCatalog;
  const totalInventory = catalog.reduce((sum, product) => sum + product.stockQty, 0);
  const totalOrders = dailyOrders.reduce((sum, day) => sum + day.orders, 0);
  const salesAmount = dailyOrders.reduce((sum, day) => sum + day.amount, 0);
  const riskCount = catalog.filter((product) => product.alert !== "健康").length;

  React.useEffect(() => {
    void loadCurrentUser();
  }, []);

  React.useEffect(() => {
    const syncViewFromHash = () => setActiveView(getInitialView());
    window.addEventListener("hashchange", syncViewFromHash);
    return () => window.removeEventListener("hashchange", syncViewFromHash);
  }, []);

  React.useEffect(() => {
    loadProducts();
    if (canManage(currentUser)) {
      loadWarehouses();
      loadInventorySnapshots();
      loadMovement();
      loadStockup();
      loadUsers();
    }
    if (canViewPartnerAssets(currentUser)) {
      loadQualifications();
      loadAssets();
      loadWarehouseInfo();
      loadQuickNav();
      loadAiConfig();
    }
  }, [currentUser.role]);

  React.useEffect(() => {
    const allowed = visibleNavItems(currentUser).some((item) => item.label === activeView);
    if (!allowed) handleViewChange("产品库");
  }, [currentUser.role, activeView]);

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      void loadProducts(true);
      if (canViewPartnerAssets(currentUser)) {
        void loadQualifications();
        void loadAssets();
        void loadWarehouseInfo();
        void loadQuickNav();
        void loadAiConfig();
      }
      if (canManage(currentUser)) {
        void loadWarehouses();
        void loadInventorySnapshots();
        void loadMovement();
        void loadStockup();
        void loadUsers();
      }
    }, AUTO_SYNC_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [currentUser.role]);

  async function loadCurrentUser() {
    try {
      const data = await fetchCurrentUser();
      setCurrentUser(data.user);
    } catch {
      setCurrentUser({ role: "guest", roleLabel: "游客", permissions: ["product_view"] });
    }
  }

  async function loadProducts(silent = false) {
    if (!silent) setLoading(true);
    if (!silent) setError("");
    try {
      const data = await fetchProducts();
      setPayload(data);
      if (data.user) setCurrentUser(data.user);
    } catch (requestError) {
      if (!silent) setError(requestError instanceof Error ? requestError.message : "产品数据读取失败");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function loadWarehouses() {
    try {
      const data = await fetchWarehouses();
      setWarehousePayload(data);
    } catch {
      setWarehousePayload(null);
    }
  }

  async function loadInventorySnapshots(date?: string) {
    try {
      const data = await fetchInventorySnapshots(date);
      setInventorySnapshotPayload(data);
    } catch {
      setInventorySnapshotPayload(null);
    }
  }

  async function loadMovement() {
    try {
      const data = await fetchMovement();
      setMovementPayload(data);
    } catch {
      setMovementPayload(null);
    }
  }

  async function loadStockup() {
    try {
      const data = await fetchStockup();
      setStockupPayload(data);
    } catch {
      setStockupPayload(null);
    }
  }

  async function loadQualifications() {
    try {
      const data = await fetchQualifications();
      setQualificationPayload(data);
    } catch {
      setQualificationPayload(null);
    }
  }

  async function loadAssets() {
    try {
      const data = await fetchAssets();
      setAssetPayload(data);
    } catch {
      setAssetPayload(null);
    }
  }

  async function loadWarehouseInfo() {
    try {
      const data = await fetchWarehouseInfo();
      setWarehouseInfoPayload(data);
    } catch {
      setWarehouseInfoPayload(null);
    }
  }

  async function loadQuickNav() {
    try {
      const data = await fetchQuickNav();
      setQuickNavPayload(data);
    } catch {
      setQuickNavPayload(null);
    }
  }

  async function loadAiConfig() {
    try {
      const data = await fetchAiConfig();
      setAiConfigPayload(data);
    } catch {
      setAiConfigPayload(null);
    }
  }

  async function loadUsers() {
    try {
      const data = await fetchUsers();
      setUserPayload(data);
    } catch {
      setUserPayload(null);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setError("");
    try {
      const data = await syncProducts();
      setPayload(data);
      await syncOutsourcingOrders().catch(() => null);
      await Promise.all([loadMovement(), loadStockup(), loadQualifications(), loadAssets(), loadWarehouseInfo(), loadQuickNav(), loadAiConfig()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "同步失败");
    } finally {
      setSyncing(false);
    }
  }

  async function handleWarehouseSync() {
    setSyncing(true);
    setError("");
    try {
      await syncWarehouses();
      await Promise.all([loadWarehouses(), loadInventorySnapshots(), loadProducts(), loadMovement(), loadStockup()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "仓库同步失败");
    } finally {
      setSyncing(false);
    }
  }

  async function handleCaptureInventorySnapshot() {
    setError("");
    try {
      const data = await captureInventorySnapshot();
      setInventorySnapshotPayload(data);
      return data;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "库存快照生成失败");
      throw requestError;
    }
  }

  async function handleOrderSync() {
    setSyncing(true);
    setError("");
    try {
      await syncOrders(90);
      await Promise.all([loadMovement(), loadStockup()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "订单同步失败");
    } finally {
      setSyncing(false);
    }
  }

  async function handleStockupSync() {
    setSyncing(true);
    setError("");
    try {
      const data = await syncStockupOrders();
      setStockupPayload(data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "备货单明细同步失败");
    } finally {
      setSyncing(false);
    }
  }

  async function handleQualificationSync() {
    setSyncing(true);
    setError("");
    try {
      const data = await syncQualifications();
      setQualificationPayload(data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "资质库同步失败");
    } finally {
      setSyncing(false);
    }
  }

  async function handleAssetSync() {
    setSyncing(true);
    setError("");
    try {
      const data = await syncAssets();
      setAssetPayload(data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "素材库同步失败");
    } finally {
      setSyncing(false);
    }
  }

  async function handleWarehouseInfoSync() {
    setSyncing(true);
    setError("");
    try {
      const data = await syncWarehouseInfo();
      setWarehouseInfoPayload(data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "仓库信息同步失败");
    } finally {
      setSyncing(false);
    }
  }

  async function handleCreateWarehouse(input: Parameters<typeof createWarehouseConnection>[0]) {
    setError("");
    try {
      await createWarehouseConnection(input);
      await loadWarehouses();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "新增仓库失败");
      throw requestError;
    }
  }

  async function handleUpdateWarehouse(id: string, input: Parameters<typeof updateWarehouseConnection>[1]) {
    setError("");
    try {
      await updateWarehouseConnection(id, input);
      await loadWarehouses();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "更新仓库失败");
      throw requestError;
    }
  }

  async function handleDeleteWarehouse(id: string) {
    setError("");
    try {
      await deleteWarehouseConnection(id);
      await Promise.all([loadWarehouses(), loadProducts(), loadMovement(), loadStockup()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "删除仓库失败");
      throw requestError;
    }
  }

  async function handleExportWarehouses() {
    setError("");
    try {
      const data = await exportWarehouseConnections();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `tongzhou-warehouse-connections-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "导出仓库配置失败");
      throw requestError;
    }
  }

  async function handleImportWarehouses(file: File) {
    setError("");
    try {
      const content = await file.text();
      const payload = JSON.parse(content);
      await importWarehouseConnections(payload);
      await loadWarehouses();
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "导入仓库配置失败";
      setError(message);
      throw requestError;
    }
  }

  async function handleLogin(input: { username?: string; password?: string; code?: string }) {
    const result = await loginInternal(input);
    setCurrentUser(result.user);
    await loadProducts();
    if (canViewPartnerAssets(result.user)) {
      await Promise.all([loadQualifications(), loadAssets(), loadWarehouseInfo(), loadQuickNav(), loadAiConfig()]);
    }
    if (canManage(result.user)) {
      await Promise.all([loadWarehouses(), loadInventorySnapshots(), loadMovement(), loadStockup(), loadUsers()]);
    }
  }

  function handleLogout() {
    logoutInternal();
    setCurrentUser({ role: "guest", roleLabel: "游客", permissions: ["product_view"] });
    setQualificationPayload(null);
    setAssetPayload(null);
    setWarehouseInfoPayload(null);
    setQuickNavPayload(null);
    setAiConfigPayload(null);
    setWarehousePayload(null);
    setInventorySnapshotPayload(null);
    setMovementPayload(null);
    setStockupPayload(null);
    setUserPayload(null);
  }

  function handleViewChange(view: string) {
    setActiveView(view);
    window.location.hash = hashForView(view);
    setMobileNavOpen(false);
  }

  return (
    <div className="app-shell">
      <Sidebar activeView={activeView} currentUser={currentUser} onChange={handleViewChange} onClose={() => setMobileNavOpen(false)} open={mobileNavOpen} />
      <div className="workspace">
        <header className="topbar">
          <button className="icon-button mobile-only" onClick={() => setMobileNavOpen(true)} aria-label="打开导航">
            <Menu size={20} />
          </button>
          <div>
            <p className="eyebrow">Tongzhou Control Tower</p>
            <h1>{activeView === "产品库" ? "产品中心" : activeView === "资质库" ? "资质库" : activeView === "素材库" ? "素材库" : activeView === "仓库信息" ? "仓库信息" : activeView === "快捷导航" ? "快捷导航" : activeView === "同舟AI" ? "同舟AI" : activeView === "备货中心" ? "备货中心" : activeView === "用户管理" ? "用户管理" : "同舟供应链中台"}</h1>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={16} />
              <input placeholder="搜索 SKU、国家、仓库" />
            </label>
            {currentUser.role !== "guest" ? (
              <>
                {canManage(currentUser) ? (
                  <button className="sync-button" onClick={handleSync} disabled={syncing}>
                    <RefreshCw size={16} className={syncing ? "spinning" : ""} />
                    {syncing ? "同步中" : "同步"}
                  </button>
                ) : null}
                <button className="ghost-button" onClick={handleLogout}>
                  <LogOut size={16} />
                  退出 {currentUser.roleLabel}
                </button>
              </>
            ) : (
              <LoginButton onLogin={handleLogin} />
            )}
          </div>
        </header>

        {error ? <div className="notice danger">{error}</div> : null}
        {payload?.warning ? <div className="notice warning">{payload.warning}</div> : null}

        {activeView === "产品库" ? (
          <ProductLibrary
            products={catalog}
            internal={internal}
            currentUser={currentUser}
            loading={loading}
            payload={payload}
            qualificationPayload={qualificationPayload}
            assetPayload={assetPayload}
            productBase={payload?.productBase || []}
          />
        ) : activeView === "资质库" ? (
          <QualificationLibrary products={catalog} qualificationPayload={qualificationPayload} onSyncQualifications={handleQualificationSync} syncing={syncing} />
        ) : activeView === "素材库" ? (
          <AssetLibrary
            products={catalog}
            productBase={payload?.productBase || []}
            assetPayload={assetPayload}
            onSyncAssets={handleAssetSync}
            syncing={syncing}
          />
        ) : activeView === "仓库信息" ? (
          <WarehouseInfoLibrary warehouseInfoPayload={warehouseInfoPayload} onSyncWarehouseInfo={handleWarehouseInfoSync} syncing={syncing} />
        ) : activeView === "快捷导航" ? (
          <QuickNavPage quickNavPayload={quickNavPayload} currentUser={currentUser} onRefresh={loadQuickNav} />
        ) : activeView === "同舟AI" ? (
          <TongzhouAiPanel aiConfig={aiConfigPayload} currentUser={currentUser} onRefreshConfig={loadAiConfig} />
        ) : activeView === "库存快照" ? (
          <InventorySnapshotPage
            inventorySnapshotPayload={inventorySnapshotPayload}
            onLoadInventorySnapshots={loadInventorySnapshots}
            onCaptureInventorySnapshot={handleCaptureInventorySnapshot}
          />
        ) : activeView === "仓库授权" || activeView === "库存同步" ? (
          <WarehouseBoard
            warehousePayload={warehousePayload}
            onSync={handleWarehouseSync}
            syncing={syncing}
            onCreate={handleCreateWarehouse}
            onUpdate={handleUpdateWarehouse}
            onDelete={handleDeleteWarehouse}
            onExport={handleExportWarehouses}
            onImport={handleImportWarehouses}
          />
        ) : activeView === "动销监控" ? (
          <MovementBoard movementPayload={movementPayload} onSyncOrders={handleOrderSync} syncing={syncing} />
        ) : activeView === "备货中心" ? (
          <StockupCenter stockupPayload={stockupPayload} onSyncStockup={handleStockupSync} syncing={syncing} />
        ) : activeView === "用户管理" ? (
          <UserManagement userPayload={userPayload} />
        ) : (
          <Dashboard
            products={catalog}
            payload={payload}
            internal={internal}
            totalInventory={totalInventory}
            totalOrders={totalOrders}
            salesAmount={salesAmount}
            riskCount={riskCount}
          />
        )}
      </div>
    </div>
  );
}

function stockLabel(product: CatalogProduct) {
  if (product.stockQty > 0) return `${formatNumber(product.stockQty)} ${product.unit}`;
  if (product.dataGap === "warehouse_missing") return "仓库缺失";
  return "待 WMS";
}

function StockFact({ product }: { product: CatalogProduct }) {
  const details = product.warehouseBreakdown || [];
  return (
    <span className={`stock-fact ${details.length ? "has-tooltip" : ""}`}>
      <Boxes size={15} />
      {stockLabel(product)}
      {details.length ? (
        <span className="stock-tooltip">
          <strong>库存分布</strong>
          {details.map((detail) => (
            <small key={`${detail.warehouseId}-${detail.warehouseName}`}>
              {detail.warehouseName || detail.warehouseId}：可售 {formatNumber(detail.availableQty)}，锁定 {formatNumber(detail.lockedQty)}，在途 {formatNumber(detail.inTransitQty)}
            </small>
          ))}
        </span>
      ) : null}
    </span>
  );
}

function LoginButton({ onLogin }: { onLogin: (input: { username?: string; password?: string; code?: string }) => Promise<void> }) {
  const [open, setOpen] = React.useState(false);
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await onLogin({ username, password });
      setOpen(false);
      setUsername("");
      setPassword("");
    } catch {
      setError("账号或密码不正确");
    }
  }

  return (
    <div className="login-wrap">
      <button className="ghost-button" onClick={() => setOpen((value) => !value)}>
        <Lock size={16} />
        登录
      </button>
      {open ? (
        <form className="login-popover" onSubmit={submit}>
          <span>使用系统账号密码登录</span>
          <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="账号" autoComplete="username" />
          <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="密码" type="password" autoComplete="current-password" />
          {error ? <small>{error}</small> : null}
          <button className="sync-button">登录</button>
        </form>
      ) : null}
    </div>
  );
}

function Sidebar({
  activeView,
  currentUser,
  onChange,
  onClose,
  open,
}: {
  activeView: string;
  currentUser: AuthUser;
  onChange: (view: string) => void;
  onClose: () => void;
  open: boolean;
}) {
  const items = visibleNavItems(currentUser);
  return (
    <>
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark">
            <Truck size={22} />
          </div>
          <div>
            <strong>同舟供应链</strong>
            <span>Supply Center</span>
          </div>
          <button className="icon-button close-nav" onClick={onClose} aria-label="关闭导航">
            <X size={18} />
          </button>
        </div>
        <nav>
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                className={`${activeView === item.label ? "active" : ""} ${item.childOf ? "nav-child" : ""}`}
                onClick={() => onChange(item.label)}
              >
                <Icon size={18} />
                <span className="nav-label-wrap">
                  {item.beta ? <small>Beta</small> : null}
                  <span>{item.label}</span>
                </span>
              </button>
            );
          })}
        </nav>
        <div className="integration-card">
          <p>同舟供应链</p>
          <strong>同舟供应链数智化系统</strong>
          <span>产品 · 仓库 · 备货协同</span>
        </div>
        <button className="settings-link">
          <Settings size={17} />
          字段映射设置
        </button>
      </aside>
      {open ? <button className="scrim" onClick={onClose} aria-label="关闭导航" /> : null}
    </>
  );
}

function Dashboard({
  products,
  payload,
  internal,
  totalInventory,
  totalOrders,
  salesAmount,
  riskCount,
}: {
  products: CatalogProduct[];
  payload: ProductPayload | null;
  internal: boolean;
  totalInventory: number;
  totalOrders: number;
  salesAmount: number;
  riskCount: number;
}) {
  return (
    <main className="dashboard-grid">
      <section className="metric-strip">
        <Metric title="可售库存" value={formatNumber(totalInventory)} note={`${products.length} 个可见产品`} icon={Boxes} tone="blue" />
        <Metric title="今日出库订单" value={formatNumber(totalOrders)} note="WMS 日报演示数据" icon={PackageCheck} tone="green" />
        <Metric title="日报销售额" value={`$${formatNumber(salesAmount)}`} note="覆盖 4 个国家" icon={BarChart3} tone="orange" />
        <Metric title="动销风险 SKU" value={String(riskCount)} note="需采购确认" icon={AlertTriangle} tone="red" />
      </section>

      <section className="panel sales-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">System Sync</p>
            <h2>产品数据同步</h2>
          </div>
          <span className={`status-pill ${payload?.source === "jiandaoyun" ? "good" : "warning"}`}>
            {payload?.source === "jiandaoyun" ? "真实数据" : "样例数据"}
          </span>
        </div>
        <div className="sync-summary">
          <div>
            <strong>{payload?.counts.productBase ?? 0}</strong>
            <span>产品基础信息</span>
          </div>
          <div>
            <strong>{payload?.counts.catalog ?? products.length}</strong>
            <span>产品库记录</span>
          </div>
          <div>
            <strong>{payload?.counts.distributionCatalog ?? products.filter((product) => product.channel === "分销").length}</strong>
            <span>分销公开</span>
          </div>
          <div>
            <strong>{payload?.counts.directCatalog ?? products.filter((product) => product.channel === "直营").length}</strong>
            <span>{internal ? "直营内部" : "直营隐藏"}</span>
          </div>
        </div>
        <div className="bar-chart compact" aria-label="近 7 天订单日报柱状图">
          {dailyOrders.map((day) => (
            <div className="bar-group" key={`${day.date}-${day.country}`}>
              <span className="bar amount" style={{ height: `${Math.max(18, day.amount / 95)}px` }} />
              <span className="bar orders" style={{ height: `${Math.max(18, day.orders / 3.6)}px` }} />
              <small>{day.date}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="panel warehouse-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">WMS Sync</p>
            <h2>仓库连接状态</h2>
          </div>
          <button className="icon-button" aria-label="新增仓库授权">
            <ArrowUpRight size={18} />
          </button>
        </div>
        <div className="warehouse-list">
          {warehouses.map((warehouse) => (
            <article key={warehouse.name} className="warehouse-row">
              <div>
                <strong>{warehouse.name}</strong>
                <span>
                  {warehouse.provider} · {warehouse.baseUrl}
                </span>
              </div>
              <div className="warehouse-meta">
                <span className={`status-pill ${warehouse.status === "正常" ? "good" : "warning"}`}>{warehouse.status}</span>
                <small>{warehouse.lastSyncedAt}</small>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel alert-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Movement Alert</p>
            <h2>动销监控</h2>
          </div>
          <button className="ghost-button">安全库存 21 天</button>
        </div>
        <div className="risk-table">
          {products.map((product) => (
            <article key={product.id} className="risk-row">
              <div>
                <strong>{product.name}</strong>
                <CopyableSku sku={product.sku} className="risk-sku" />
              </div>
              <span>{product.country}</span>
              <span>{stockLabel(product)}</span>
              <span>{product.channel}</span>
              <span className={`status-pill ${alertClass(product.alert)}`}>{product.alert}</span>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function movementStatusClass(status: string) {
  return {
    缺货: "danger",
    补货预警: "warning",
    慢销: "muted",
    滞销: "danger",
    无动销数据: "muted",
    健康: "good",
  }[status] || "muted";
}

function formatDaysCover(value: number | null) {
  if (value === null) return "∞";
  if (value > 999) return "999+";
  return value.toFixed(value < 10 ? 1 : 0);
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  return (
    <div className="sparkline" aria-label="近30天销量走势">
      {values.map((value, index) => (
        <span key={`${index}-${value}`} style={{ height: `${Math.max(3, (value / max) * 34)}px` }} />
      ))}
    </div>
  );
}

function InventoryBreakdown({ item }: { item: MovementPayload["items"][number] }) {
  const details = item.warehouseBreakdown || [];
  return (
    <span className={`movement-stock ${details.length ? "has-tooltip" : ""}`}>
      {formatNumber(item.availableQty)}
      {details.length ? (
        <span className="stock-tooltip movement-tooltip">
          <strong>仓库库存分布</strong>
          {details.map((detail) => (
            <small key={`${detail.warehouseId}-${detail.warehouseName}`}>
              {detail.warehouseName || detail.warehouseId}：可售 {formatNumber(detail.availableQty)}，锁定 {formatNumber(detail.lockedQty)}，在途 {formatNumber(detail.inTransitQty)}
            </small>
          ))}
        </span>
      ) : null}
    </span>
  );
}

function SalesBreakdown({ item }: { item: MovementPayload["items"][number] }) {
  const details = item.salesWarehouseBreakdown || [];
  return (
    <span className={`movement-windows ${details.length ? "has-tooltip" : ""}`}>
      {formatNumber(item.sales3)} / {formatNumber(item.sales7)} / {formatNumber(item.sales15)} / {formatNumber(item.sales30)} / {formatNumber(item.sales60)} / {formatNumber(item.sales90)}
      {details.length ? (
        <span className="movement-tooltip">
          <strong>近 90 天销量分布</strong>
          {details.map((detail) => (
            <small key={`${detail.warehouseId}-${detail.warehouseName}`}>
              {detail.warehouseName || detail.warehouseId}：{formatNumber(detail.sales90)}
            </small>
          ))}
        </span>
      ) : null}
    </span>
  );
}

function DaysCoverInsight({ item }: { item: Pick<MovementPayload["items"][number], "availableQty" | "avgDaily7" | "avgDaily30" | "avgDaily90" | "daysCover" | "leadDays" | "targetCoverDays" | "inTransitQty" | "replenishQty"> }) {
  const dailyWeighted = item.avgDaily7 * 0.5 + item.avgDaily30 * 0.3 + item.avgDaily90 * 0.2;
  return (
    <span className="movement-insight has-tooltip">
      {formatDaysCover(item.daysCover)} 天
      <span className="movement-tooltip insight-tooltip">
        <strong>可售天数计算</strong>
        <small>公式：可售库存 ÷ 加权日均销量。</small>
        <small>
          加权日均 = 7日均 {formatDecimal(item.avgDaily7)} × 50% + 30日均 {formatDecimal(item.avgDaily30)} × 30% + 90日均 {formatDecimal(item.avgDaily90)} × 20% = {formatDecimal(dailyWeighted)}
        </small>
        <small>
          当前：可售 {formatNumber(item.availableQty)}，在途 {formatNumber(item.inTransitQty)}，可售天数 {formatDaysCover(item.daysCover)} 天。
        </small>
        <small>补货周期 {formatNumber(item.leadDays)} 天，目标覆盖 {formatNumber(item.targetCoverDays)} 天，建议备货 {formatNumber(item.replenishQty)}。</small>
      </span>
    </span>
  );
}

function MovementStatusInsight({ item }: { item: Pick<MovementPayload["items"][number], "status" | "availableQty" | "sales7" | "sales30" | "sales90" | "avgDaily7" | "avgDaily30" | "avgDaily90" | "daysCover" | "leadDays" | "suggestion"> }) {
  const dailyWeighted = item.avgDaily7 * 0.5 + item.avgDaily30 * 0.3 + item.avgDaily90 * 0.2;
  return (
    <span className="movement-status-wrap has-tooltip">
      <span className={`status-pill ${movementStatusClass(item.status)}`}>{item.status}</span>
      <span className="movement-tooltip insight-tooltip">
        <strong>状态判断规则</strong>
        <small>缺货：可售为 0，且近 7 / 30 / 90 天任一窗口有销量。</small>
        <small>补货预警：加权日均销量大于 0，且可售天数 ≤ 补货周期 + 10 天。</small>
        <small>滞销：可售大于 0，近 30 天无销量，或近 90 天销量 ≤ 2。</small>
        <small>慢销：加权日均销量大于 0，且可售天数 &gt; 90 天。</small>
        <small>
          当前命中：可售 {formatNumber(item.availableQty)}，7/30/90天销量 {formatNumber(item.sales7)} / {formatNumber(item.sales30)} / {formatNumber(item.sales90)}，加权日均 {formatDecimal(dailyWeighted)}，可售 {formatDaysCover(item.daysCover)} 天，补货周期 {formatNumber(item.leadDays)} 天。
        </small>
        <small>{item.suggestion}</small>
      </span>
    </span>
  );
}

function OutsourcingInsight({ item }: { item: StockupPayload["recommendations"][number] }) {
  const orders = item.outsourcingOrders || [];
  return (
    <span className="movement-insight outsourcing-insight has-tooltip">
      {formatNumber(item.outsourcingInProductionQty)} {item.unit}
      <span className="movement-tooltip insight-tooltip">
        <strong>委外加工单关联</strong>
        <small>按委外加工单的同舟 SKU 字段关联当前 SKU，代表已经在生产的数量。</small>
        <small>净建议备货 = 建议备货 {formatNumber(item.replenishQty)} - 委外在产 {formatNumber(item.outsourcingInProductionQty)} = {formatNumber(item.netReplenishQty)}。</small>
        {orders.length ? orders.slice(0, 8).map((order) => (
          <small key={order.id}>
            {order.orderNo || order.id}：计划 {formatNumber(order.plannedQty)}，已产 {formatNumber(order.producedQty)}，在产 {formatNumber(order.inProductionQty)}，状态 {order.status}
          </small>
        )) : <small>当前 SKU 暂无匹配委外加工单。</small>}
      </span>
    </span>
  );
}

function MovementThumb({ item }: { item: { imageUrl?: string } }) {
  return (
    <div className="movement-thumb" aria-hidden="true">
      {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <ShoppingBag size={18} />}
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
}: {
  label: string;
  sortKey: MovementSortKey;
  activeKey: MovementSortKey;
  direction: SortDirection;
  onSort: (key: MovementSortKey) => void;
}) {
  const active = sortKey === activeKey;
  return (
    <button className={`sort-header ${active ? "active" : ""}`} type="button" onClick={() => onSort(sortKey)}>
      <span>{label}</span>
      <ChevronDown size={14} style={{ transform: active && direction === "asc" ? "rotate(180deg)" : undefined }} />
    </button>
  );
}

function movementSortValue(item: MovementPayload["items"][number], key: MovementSortKey) {
  if (key === "sku") return item.sku || "";
  if (key === "country") return item.country || "";
  if (key === "status") return item.status || "";
  if (key === "availableQty") return item.availableQty;
  if (key === "avgDaily7") return item.avgDaily7;
  if (key === "sales90") return item.sales90;
  if (key === "daysCover") return item.daysCover ?? Number.POSITIVE_INFINITY;
  return 0;
}

function MovementBoard({
  movementPayload,
  onSyncOrders,
  syncing,
}: {
  movementPayload: MovementPayload | null;
  onSyncOrders: () => void;
  syncing: boolean;
}) {
  const [country, setCountry] = React.useState("全部");
  const [status, setStatus] = React.useState("全部");
  const [keywordInput, setKeywordInput] = React.useState("");
  const [keyword, setKeyword] = React.useState("");
  const [sortKey, setSortKey] = React.useState<MovementSortKey>("sales90");
  const [sortDirection, setSortDirection] = React.useState<SortDirection>("desc");

  const items = movementPayload?.items ?? [];
  const countries = uniqueSorted(items.map((item) => item.country));
  const statuses = ["全部", "缺货", "补货预警", "滞销", "慢销", "无动销数据", "健康"];
  const failedAuthorizedWarehouses = (movementPayload?.orderSyncResults || []).filter((result) => !result.ok && result.hasCredentials);
  const filteredItems = items.filter((item) => {
    const keywordMatched = !keyword || [item.sku, item.name, item.brand, item.category, item.country].join(" ").toLowerCase().includes(keyword.toLowerCase());
    const countryMatched = country === "全部" || item.country === country;
    const statusMatched = status === "全部" || item.status === status;
    return keywordMatched && countryMatched && statusMatched;
  });
  const sortedItems = React.useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...filteredItems].sort((a, b) => {
      const aValue = movementSortValue(a, sortKey);
      const bValue = movementSortValue(b, sortKey);
      if (typeof aValue === "number" && typeof bValue === "number") {
        return (aValue - bValue) * direction;
      }
      return String(aValue).localeCompare(String(bValue), "zh-CN") * direction;
    });
  }, [filteredItems, sortDirection, sortKey]);
  const updateSort = (nextKey: MovementSortKey) => {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(["sku", "country", "status"].includes(nextKey) ? "asc" : "desc");
  };

  return (
    <main className="movement-page">
      <section className="library-hero movement-hero">
        <div>
          <p className="eyebrow">Movement Control</p>
          <h2>动销分析看板</h2>
          <p>
            基于仓库实时库存和近 90 天出库订单，按 SKU 判断缺货、补货预警、慢销和滞销，并估算库存还能销售多少天。
          </p>
          <div className="source-row">
            <span className={`status-pill ${movementPayload?.orderSyncedAt ? "good" : "warning"}`}>
              {movementPayload?.orderSyncedAt ? "订单已同步" : "订单待同步"}
            </span>
            <span>{movementPayload?.orderSyncedAt ? new Date(movementPayload.orderSyncedAt).toLocaleString("zh-CN") : "先同步订单后可看到销量走势"}</span>
          </div>
        </div>
        <button className="sync-button" onClick={onSyncOrders} disabled={syncing}>
          <RefreshCw size={16} className={syncing ? "spinning" : ""} />
          {syncing ? "同步中" : "同步近90天订单"}
        </button>
      </section>

      <section className="metric-strip movement-metrics">
        <Metric title="缺货 SKU" value={formatNumber(movementPayload?.counts.stockout ?? 0)} note="有销量但可售为 0" icon={AlertTriangle} tone="red" />
        <Metric title="补货预警" value={formatNumber(movementPayload?.counts.replenish ?? 0)} note="可售天数低于补货周期" icon={PackageCheck} tone="orange" />
        <Metric title="慢销 / 滞销" value={formatNumber((movementPayload?.counts.slow ?? 0) + (movementPayload?.counts.stagnant ?? 0))} note="库存覆盖过高或无销量" icon={BarChart3} tone="blue" />
        <Metric title="仓库未建档" value={formatNumber(movementPayload?.counts.warehouseOnly ?? 0)} note="仓库有库存但产品库缺失" icon={Boxes} tone="green" />
      </section>

      <form
        className="movement-filter-panel"
        onSubmit={(event) => {
          event.preventDefault();
          setKeyword(keywordInput);
        }}
      >
        <label className="catalog-search large">
          <Search size={17} />
          <input value={keywordInput} onChange={(event) => setKeywordInput(event.target.value)} placeholder="搜索 SKU、产品名、品牌、分类" />
        </label>
        <select value={country} onChange={(event) => setCountry(event.target.value)}>
          <option value="全部">全部国家</option>
          {countries.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          {statuses.map((item) => (
            <option key={item} value={item}>{item === "全部" ? "全部状态" : item}</option>
          ))}
        </select>
        <button className="sync-button" type="submit">
          <Search size={16} />
          搜索
        </button>
      </form>

      {failedAuthorizedWarehouses.length ? (
        <section className="notice warning">
          部分已授权仓库订单未同步成功：{failedAuthorizedWarehouses.map((result) => `${result.warehouseId}（${result.message}）`).join("、")}
        </section>
      ) : null}

      <section className="panel movement-table-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">SKU Risk Queue</p>
            <h2>SKU 动销明细</h2>
          </div>
          <span className="status-pill muted">{formatNumber(filteredItems.length)} 个 SKU</span>
        </div>
        <div className="movement-table">
          <div className="movement-row movement-head">
            <SortHeader label="SKU / 产品" sortKey="sku" activeKey={sortKey} direction={sortDirection} onSort={updateSort} />
            <SortHeader label="国家" sortKey="country" activeKey={sortKey} direction={sortDirection} onSort={updateSort} />
            <SortHeader label="库存" sortKey="availableQty" activeKey={sortKey} direction={sortDirection} onSort={updateSort} />
            <SortHeader label="3 / 7 / 15 / 30 / 60 / 90 天" sortKey="sales90" activeKey={sortKey} direction={sortDirection} onSort={updateSort} />
            <SortHeader label="日均销量" sortKey="avgDaily7" activeKey={sortKey} direction={sortDirection} onSort={updateSort} />
            <span>趋势</span>
            <SortHeader label="可售天数" sortKey="daysCover" activeKey={sortKey} direction={sortDirection} onSort={updateSort} />
            <SortHeader label="状态" sortKey="status" activeKey={sortKey} direction={sortDirection} onSort={updateSort} />
            <span>建议</span>
          </div>
          {sortedItems.slice(0, 80).map((item) => (
            <article className="movement-row" key={`${item.country}-${item.sku}-${item.id}`}>
              <div className="movement-product">
                <MovementThumb item={item} />
                <div>
                  <strong>{item.sku}</strong>
                  <span>{item.name}</span>
                  {item.source === "warehouse_only" ? <small>仓库 SKU 未建档</small> : null}
                </div>
              </div>
              <span>{item.country}</span>
              <InventoryBreakdown item={item} />
              <SalesBreakdown item={item} />
              <span className="movement-daily">
                <strong>{formatDecimal(item.avgDaily7)}</strong>
                <small>30日 {formatDecimal(item.avgDaily30)}</small>
              </span>
              <Sparkline values={item.trend30} />
              <DaysCoverInsight item={item} />
              <MovementStatusInsight item={item} />
              <span className="movement-suggestion">{item.suggestion}</span>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function StockupCenter({
  stockupPayload,
  onSyncStockup,
  syncing,
}: {
  stockupPayload: StockupPayload | null;
  onSyncStockup: () => void;
  syncing: boolean;
}) {
  const recommendations = stockupPayload?.recommendations ?? [];
  const outsourcingQueue = stockupPayload?.outsourcingQueue ?? [];
  const inboundOrders = stockupPayload?.inboundOrders ?? [];
  const syncResults = stockupPayload?.syncResults ?? [];

  return (
    <main className="movement-page stockup-page">
      <section className="library-hero movement-hero">
        <div>
          <p className="eyebrow">Stockup Center</p>
          <h2>备货中心</h2>
          <p>
            将动销分析里需要补货的 SKU 汇总成备货建议，后续可一键生成同舟供应链备货计划；同时预留 WMS 备货单 / 入库单明细同步，用于核对在途和已创建单据。
          </p>
          <div className="source-row">
            <span className={`status-pill ${stockupPayload?.stockupSyncedAt ? "good" : "warning"}`}>
              {stockupPayload?.stockupSyncedAt ? "WMS 明细已同步" : "WMS 明细待同步"}
            </span>
            <span>{stockupPayload?.stockupSyncedAt ? new Date(stockupPayload.stockupSyncedAt).toLocaleString("zh-CN") : "建议备货来自动销分析实时计算"}</span>
          </div>
        </div>
        <button className="sync-button" onClick={onSyncStockup} disabled={syncing}>
          <RefreshCw size={16} className={syncing ? "spinning" : ""} />
          {syncing ? "同步中" : "同步 WMS 备货单"}
        </button>
      </section>

      <section className="metric-strip movement-metrics">
        <Metric title="建议备货 SKU" value={formatNumber(stockupPayload?.counts.recommendations ?? 0)} note="缺货与补货预警 SKU" icon={PackageCheck} tone="orange" />
        <Metric title="净建议备货" value={formatNumber(stockupPayload?.counts.netRecommendedQty ?? 0)} note="建议数量扣减委外在产" icon={Boxes} tone="green" />
        <Metric title="委外在产数量" value={formatNumber(stockupPayload?.counts.outsourcingInProductionQty ?? 0)} note={`${formatNumber(stockupPayload?.counts.outsourcingActiveSku ?? 0)} 个排产 SKU`} icon={Settings} tone="blue" />
        <Metric title="WMS 备货单" value={formatNumber(stockupPayload?.counts.inboundOrders ?? 0)} note="来自仓库入库 / 备货单接口" icon={FileText} tone="blue" />
      </section>

      <section className="panel stockup-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Outsourcing Production</p>
            <h2>委外排产清单</h2>
          </div>
          <span className="status-pill muted">{formatNumber(outsourcingQueue.length)} 个 SKU</span>
        </div>
        <div className="stockup-table">
          <div className="stockup-row stockup-head outsourcing-queue-head">
            <span>SKU / 产品</span>
            <span>委外在产</span>
            <span>加工单</span>
            <span>开单时间</span>
            <span>跟单备注</span>
            <span>是否在备货建议</span>
            <span>说明</span>
          </div>
          {outsourcingQueue.length ? outsourcingQueue.map((item) => (
            <article className="stockup-row outsourcing-queue-row" key={item.id}>
              <div className="movement-product">
                <MovementThumb item={item} />
                <div>
                  <strong>{item.sku}</strong>
                  <span>{item.name}</span>
                </div>
              </div>
              <strong>{formatNumber(item.inProductionQty)} {item.unit}</strong>
              <span>{formatNumber(item.orderCount)} 张</span>
              <span>{formatDateTime(item.createdAt)}</span>
              <span className="movement-insight outsourcing-remark has-tooltip">
                {item.remark || "无"}
                <span className="movement-tooltip insight-tooltip">
                  <strong>跟单备注</strong>
                  {item.remarks?.length ? item.remarks.slice(0, 8).map((remark, index) => (
                    <small key={`${item.id}-remark-${index}`}>{remark}</small>
                  )) : <small>暂无跟单备注。</small>}
                </span>
              </span>
              <span className={`status-pill ${item.inRecommendation ? "good" : "warning"}`}>
                {item.inRecommendation ? "在备货建议内" : "不在备货建议内"}
              </span>
              <span className="movement-suggestion">{item.note}</span>
            </article>
          )) : (
            <div className="stockup-empty">暂无进行中的委外排产 SKU。</div>
          )}
        </div>
      </section>

      <section className="panel stockup-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Replenishment Queue</p>
            <h2>建议备货清单</h2>
          </div>
          <span className="status-pill muted">{formatNumber(recommendations.length)} 个 SKU</span>
        </div>
        <div className="stockup-table">
          <div className="stockup-row stockup-head">
            <span>SKU / 产品</span>
            <span>国家</span>
            <span>可售 / 在途</span>
            <span>近 7 / 30 天销量</span>
            <span>可售天数</span>
            <span>建议备货</span>
            <span>委外在产</span>
            <span>净建议</span>
            <span>状态</span>
          </div>
          {recommendations.length ? recommendations.slice(0, 80).map((item) => (
            <article className="stockup-row" key={`${item.country}-${item.sku}-${item.id}`}>
              <div className="movement-product">
                <MovementThumb item={item} />
                <div>
                  <strong>{item.sku}</strong>
                  <span>{item.name}</span>
                </div>
              </div>
              <span>{item.country}</span>
              <span>{formatNumber(item.availableQty)} / {formatNumber(item.inTransitQty)}</span>
              <span>{formatNumber(item.sales7)} / {formatNumber(item.sales30)}</span>
              <DaysCoverInsight item={item} />
              <strong>{formatNumber(item.replenishQty)} {item.unit}</strong>
              <OutsourcingInsight item={item} />
              <strong>{formatNumber(item.netReplenishQty)} {item.unit}</strong>
              <MovementStatusInsight item={item} />
            </article>
          )) : (
            <div className="stockup-empty">当前没有需要备货的 SKU。先同步仓库库存和近 90 天订单后，动销分析会自动生成建议。</div>
          )}
        </div>
      </section>

      <section className="panel stockup-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">WMS Inbound Orders</p>
            <h2>WMS 备货单明细</h2>
          </div>
          <span className="status-pill muted">{formatNumber(inboundOrders.length)} 条明细</span>
        </div>
        {syncResults.length ? (
          <div className="stockup-sync-results">
            {syncResults.map((result) => (
              <article key={result.warehouseId}>
                <strong>{result.warehouseName || result.warehouseId}</strong>
                <span>{result.message || (result.ok ? "同步成功" : "待配置")}</span>
                {result.docUrl ? <a href={result.docUrl} target="_blank" rel="noreferrer">接口文档</a> : null}
              </article>
            ))}
          </div>
        ) : null}
        <div className="stockup-table">
          <div className="stockup-row stockup-head inbound-head">
            <span>单号</span>
            <span>仓库</span>
            <span>SKU / 产品</span>
            <span>数量</span>
            <span>状态</span>
            <span>预计到仓</span>
          </div>
          {inboundOrders.length ? inboundOrders.map((order) => (
            <article className="stockup-row inbound-row" key={order.id || `${order.warehouseId}-${order.orderNo}-${order.sku}`}>
              <strong>{order.orderNo}</strong>
              <span>{order.warehouseName || order.warehouseId}</span>
              <span>{order.sku} · {order.productName}</span>
              <span>{formatNumber(order.quantity)}</span>
              <span>{order.status}</span>
              <span>{order.expectedArrivalAt ? formatDate(order.expectedArrivalAt) : "未配置"}</span>
            </article>
          )) : (
            <div className="stockup-empty">暂无 WMS 备货单明细。当前已预留斗仓 / 神牛 SEA WMS 与俄罗斯 YunWMS 接口入口，补齐字段映射后即可同步。</div>
          )}
        </div>
      </section>
    </main>
  );
}

function UserManagement({ userPayload }: { userPayload: UserManagementPayload | null }) {
  const users = userPayload?.users ?? [];
  const [form, setForm] = React.useState({ username: "", password: "", displayName: "", role: "distributor" as "distributor" | "direct" });
  const [saving, setSaving] = React.useState(false);
  const [actionUserId, setActionUserId] = React.useState("");
  const [localPayload, setLocalPayload] = React.useState<UserManagementPayload | null>(null);
  const [message, setMessage] = React.useState("");
  const visiblePayload = localPayload || userPayload;
  const visibleUsers = visiblePayload?.users ?? users;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const result = await createUser(form);
      setLocalPayload(result);
      setForm({ username: "", password: "", displayName: "", role: "distributor" });
      setMessage(result.warning || "用户已创建，并已同步到同舟供应链数智化系统。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建用户失败。");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(userId: string, status: "active" | "disabled") {
    setActionUserId(userId);
    setMessage("");
    try {
      const result = await updateUserStatus(userId, status);
      setLocalPayload(result);
      setMessage(result.warning || (status === "disabled" ? "用户已停用，并已同步到同舟供应链数智化系统。" : "用户已启用，并已同步到同舟供应链数智化系统。"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "更新用户状态失败。");
    } finally {
      setActionUserId("");
    }
  }

  async function handleDeleteUser(userId: string) {
    if (!window.confirm("确认删除这个用户？删除后该账号将无法登录。")) return;
    setActionUserId(userId);
    setMessage("");
    try {
      const result = await deleteUser(userId);
      setLocalPayload(result);
      setMessage(result.warning || "用户已删除，并已同步到同舟供应链数智化系统。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除用户失败。");
    } finally {
      setActionUserId("");
    }
  }

  return (
    <main className="movement-page">
      <section className="library-hero movement-hero">
        <div>
          <p className="eyebrow">User Access</p>
          <h2>用户管理</h2>
          <p>
            用户账号和角色由管理员统一维护。这里用于查看当前可登录账号，不在系统里展示或修改密码。
          </p>
          <div className="source-row">
            <span className={`status-pill ${userPayload?.syncedAt ? "good" : "warning"}`}>
            {visiblePayload?.syncedAt ? "本地用户库已读取" : "等待读取本地用户库"}
            </span>
            <span>{visiblePayload?.syncedAt ? new Date(visiblePayload.syncedAt).toLocaleString("zh-CN") : "登录后自动读取"}</span>
          </div>
        </div>
      </section>

      <section className="metric-strip movement-metrics">
        <Metric title="用户总数" value={formatNumber(visiblePayload?.counts.users ?? 0)} note="本地库为准，创建后同步系统" icon={Lock} tone="blue" />
        <Metric title="直营部门" value={formatNumber(visiblePayload?.counts.direct ?? 0)} note="可查看全部内容" icon={ShieldCheck} tone="green" />
        <Metric title="分销商" value={formatNumber(visiblePayload?.counts.distributor ?? 0)} note="仅看产品、分销价、素材和资质" icon={ShoppingBag} tone="orange" />
        <Metric title="停用用户" value={formatNumber(visiblePayload?.counts.disabled ?? 0)} note="停用后不可登录" icon={X} tone="red" />
      </section>

      <section className="panel warehouse-auth-form">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Create Account</p>
            <h2>创建用户</h2>
          </div>
        </div>
        <form onSubmit={submit}>
          <label>
            <span>账号</span>
            <input value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} placeholder="登录账号" />
          </label>
          <label>
            <span>姓名</span>
            <input value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} placeholder="显示名称" />
          </label>
          <label>
            <span>密码</span>
            <input value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} placeholder="初始密码" type="password" />
          </label>
          <label>
            <span>角色</span>
            <select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as "distributor" | "direct" }))}>
              <option value="distributor">分销商</option>
              <option value="direct">直营部门</option>
            </select>
          </label>
          <div className="warehouse-auth-actions">
            <button className="sync-button" type="submit" disabled={saving}>
              <Lock size={16} />
              {saving ? "创建中" : "创建并同步系统"}
            </button>
          </div>
        </form>
        {message ? <div className={`notice ${message.includes("失败") || message.includes("未同步") ? "warning" : ""}`}>{message}</div> : null}
      </section>

      <section className="panel stockup-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Accounts</p>
            <h2>账号列表</h2>
          </div>
          <span className="status-pill muted">{formatNumber(visibleUsers.length)} 个账号</span>
        </div>
        <div className="stockup-table">
          <div className="stockup-row stockup-head user-row">
            <span>账号</span>
            <span>姓名</span>
            <span>角色</span>
            <span>状态</span>
            <span>权限说明</span>
            <span>操作</span>
          </div>
          {visibleUsers.length ? visibleUsers.map((user) => (
            <article className="stockup-row user-row" key={user.id || user.username}>
              <strong>{user.username}</strong>
              <span>{user.displayName || "-"}</span>
              <span className={`status-pill ${user.role === "direct" ? "good" : "warning"}`}>{user.roleLabel}</span>
              <span className={`status-pill ${user.status === "disabled" ? "danger" : "good"}`}>{user.statusLabel || (user.status === "disabled" ? "停用" : "启用")}</span>
              <span>{user.role === "direct" ? "可查看直营价、库存、动销、备货和仓库授权。" : "可查看产品库、分销价格、销售价格、素材库和资质库。"}</span>
              <span className="user-actions">
                <button
                  type="button"
                  className="ghost-button"
                  disabled={actionUserId === user.id}
                  onClick={() => handleStatusChange(user.id, user.status === "disabled" ? "active" : "disabled")}
                >
                  {user.status === "disabled" ? "启用" : "停用"}
                </button>
                <button
                  type="button"
                  className="ghost-button danger-button"
                  disabled={actionUserId === user.id}
                  onClick={() => handleDeleteUser(user.id)}
                >
                  删除
                </button>
              </span>
            </article>
          )) : (
            <div className="stockup-empty">暂无可显示用户。请确认系统账号数据可读取。</div>
          )}
        </div>
      </section>
    </main>
  );
}

function WarehouseBoard({
  warehousePayload,
  onSync,
  syncing,
  onCreate,
  onUpdate,
  onDelete,
  onExport,
  onImport,
}: {
  warehousePayload: WarehousePayload | null;
  onSync: () => void;
  syncing: boolean;
  onCreate: (input: Parameters<typeof createWarehouseConnection>[0]) => Promise<void>;
  onUpdate: (id: string, input: Parameters<typeof updateWarehouseConnection>[1]) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onExport: () => Promise<void>;
  onImport: (file: File) => Promise<void>;
}) {
  const providers = warehousePayload?.providers ?? [];
  const connections = warehousePayload?.warehouses ?? [];
  const warehouseOnlyItems = warehousePayload?.lastSync?.warehouseOnlyInventory ?? [];
  const warehouseOnlyCount = warehousePayload?.lastSync?.warehouseOnlyCount ?? warehouseOnlyItems.length;
  const productMissingWarehouseCount = warehousePayload?.lastSync?.productMissingWarehouseCount ?? 0;
  const [formOpen, setFormOpen] = React.useState(false);
  const [editingWarehouse, setEditingWarehouse] = React.useState<WarehousePayload["warehouses"][number] | null>(null);
  const [deletingId, setDeletingId] = React.useState("");
  const [importing, setImporting] = React.useState(false);
  const importInputRef = React.useRef<HTMLInputElement | null>(null);
  const authorizedCount = connections.filter((item) => item.status === "已授权").length;
  function openCreateForm() {
    setEditingWarehouse(null);
    setFormOpen((value) => !value);
  }

  function openEditForm(warehouse: WarehousePayload["warehouses"][number]) {
    setEditingWarehouse(warehouse);
    setFormOpen(true);
  }

  function closeForm() {
    setEditingWarehouse(null);
    setFormOpen(false);
  }

  async function deleteConnection(warehouse: WarehousePayload["warehouses"][number]) {
    const confirmed = window.confirm(`确定删除仓库「${warehouse.name}」吗？删除后会同时清理该仓库的本地库存和订单缓存。`);
    if (!confirmed) return;
    setDeletingId(warehouse.id);
    try {
      await onDelete(warehouse.id);
    } finally {
      setDeletingId("");
    }
  }

  async function importConfig(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      await onImport(file);
    } finally {
      setImporting(false);
    }
  }

  return (
    <main className="warehouse-page">
      <section className="library-hero warehouse-hero">
        <div>
          <p className="eyebrow">Warehouse Authorization</p>
          <h2>多仓库 WMS 授权与同步准备</h2>
          <p>
            仓库板块先按 provider 分层：俄罗斯仓走 YunWMS，越南斗仓、马来神牛、印尼神牛走 SEA WMS。
            每个仓库单独保存接口地址、授权凭据和仓库编码，后续库存、出库日报和动销监控都从这里派生。
          </p>
          <div className="source-row">
            <span className="status-pill warning">待录入授权</span>
            <span>{authorizedCount} / {connections.length} 个仓库已授权</span>
          </div>
        </div>
        <button className="ghost-button" onClick={onExport}>
          <ExternalLink size={16} />
          导出配置
        </button>
        <button className="ghost-button" onClick={() => importInputRef.current?.click()} disabled={importing}>
          <DatabaseZap size={16} />
          {importing ? "导入中" : "导入配置"}
        </button>
        <input ref={importInputRef} className="hidden-file-input" type="file" accept="application/json,.json" onChange={importConfig} />
        <button className="ghost-button" onClick={openCreateForm}>
          <ShieldCheck size={16} />
          {formOpen && !editingWarehouse ? "收起表单" : "新增仓库"}
        </button>
        <button className="sync-button" onClick={onSync} disabled={syncing}>
          <RefreshCw size={16} className={syncing ? "spinning" : ""} />
          {syncing ? "同步中" : "同步仓库"}
        </button>
      </section>

      {formOpen ? (
        <WarehouseAuthForm
          providers={providers}
          initialWarehouse={editingWarehouse}
          onCreate={onCreate}
          onUpdate={onUpdate}
          onClose={closeForm}
        />
      ) : null}

      <section className="metric-strip warehouse-metrics">
        <Metric title="仓库图片" value={formatNumber(warehousePayload?.lastSync?.imageCount ?? 0)} note="可作为产品图兜底" icon={ShoppingBag} tone="blue" />
        <Metric title="库存记录" value={formatNumber(warehousePayload?.lastSync?.inventoryCount ?? 0)} note="合并到产品中心" icon={Boxes} tone="green" />
        <Metric title="同步批次" value={warehousePayload?.lastSync?.syncedAt ? "1" : "0"} note={warehousePayload?.lastSync?.syncedAt ? new Date(warehousePayload.lastSync.syncedAt).toLocaleString("zh-CN") : "等待同步"} icon={DatabaseZap} tone="orange" />
        <Metric title="待授权仓库" value={String(connections.length - authorizedCount)} note="补齐凭据后启用" icon={ShieldCheck} tone="red" />
      </section>

      <section className="panel gap-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Data Gaps</p>
            <h2>数据缺口核对</h2>
          </div>
          <button className="ghost-button">先确认再同步</button>
        </div>
        <div className="gap-summary">
          <span>仓库有库存但系统未建档：<strong>{formatNumber(warehouseOnlyCount)}</strong></span>
          <span>系统有产品但仓库无库存：<strong>{formatNumber(productMissingWarehouseCount)}</strong></span>
        </div>
        {warehouseOnlyItems.length ? (
          <div className="gap-table">
            {warehouseOnlyItems.slice(0, 8).map((item) => (
              <article key={`${item.warehouseId}-${item.countrySku}-${item.sku}`} className="gap-row">
                <div>
                  <strong>{item.sku}</strong>
                  <span>{item.country} · {item.warehouseName}</span>
                </div>
                <span>可售 {formatNumber(item.availableQty)}</span>
                <span>在途 {formatNumber(item.inTransitQty)}</span>
                <div className="gap-actions">
                  <button className="ghost-button compact-button">同步创建到系统</button>
                  <button className="ghost-button compact-button">同步创建到仓库</button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="notice">当前没有仓库-only SKU。</div>
        )}
      </section>

      <section className="provider-grid">
        {providers.map((provider) => (
          <article className="panel provider-card" key={provider.id}>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">{provider.region}</p>
                <h2>{provider.name}</h2>
              </div>
              <a className="icon-button" href={provider.docUrl} target="_blank" rel="noreferrer" aria-label="打开接口文档">
                <ExternalLink size={17} />
              </a>
            </div>
            <p>{provider.notes}</p>
            <div className="auth-fields">
              {provider.authFields.map((field) => (
                <span key={field}>{field}</span>
              ))}
            </div>
          </article>
        ))}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Connections</p>
            <h2>仓库连接清单</h2>
          </div>
          <button className="ghost-button">授权信息仅服务端保存</button>
        </div>
        <div className="warehouse-connection-table">
          {connections.map((warehouse) => (
            <article key={warehouse.id} className="warehouse-connection-row">
              <div>
                <strong>{warehouse.name}</strong>
                <span>{warehouse.country} · {warehouse.providerName}</span>
              </div>
              <span>{warehouse.baseUrl}</span>
              <span>{warehouse.warehouseId && warehouse.warehouseId !== warehouse.warehouseCode ? `${warehouse.warehouseCode} / ${warehouse.warehouseId}` : warehouse.warehouseCode}</span>
              <div className="scope-tags">
                {warehouse.syncScope.map((scope) => (
                  <small key={scope}>{scope}</small>
                ))}
              </div>
              <span className={`status-pill ${warehouse.status === "已授权" ? "good" : "warning"}`}>{warehouse.status}</span>
              <div className="warehouse-row-actions">
                <button className="ghost-button compact-button" onClick={() => openEditForm(warehouse)}>编辑</button>
                <button className="ghost-button compact-button danger-button" onClick={() => deleteConnection(warehouse)} disabled={deletingId === warehouse.id}>
                  {deletingId === warehouse.id ? "删除中" : "删除"}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function InventorySnapshotPage({
  inventorySnapshotPayload,
  onLoadInventorySnapshots,
  onCaptureInventorySnapshot,
}: {
  inventorySnapshotPayload: InventorySnapshotPayload | null;
  onLoadInventorySnapshots: (date?: string) => Promise<void>;
  onCaptureInventorySnapshot: () => Promise<InventorySnapshotPayload>;
}) {
  const [snapshotBusy, setSnapshotBusy] = React.useState(false);
  const [warehouseId, setWarehouseId] = React.useState("全部");
  const [pageSize, setPageSize] = React.useState(50);
  const [page, setPage] = React.useState(1);
  const snapshot = inventorySnapshotPayload?.snapshot || null;
  const snapshotDates = inventorySnapshotPayload?.dates ?? [];
  const selectedSnapshotDate = inventorySnapshotPayload?.selectedDate || snapshotDates[0]?.date || "";
  const snapshotRows = snapshot?.rows ?? [];
  const warehouses = Array.from(new Map(snapshotRows.map((item) => [item.warehouseId, item])).values())
    .filter((item) => item.warehouseId)
    .sort((a, b) => a.warehouseName.localeCompare(b.warehouseName, "zh-CN"));
  const filteredRows = warehouseId === "全部" ? snapshotRows : snapshotRows.filter((item) => item.warehouseId === warehouseId);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const filteredTotals = filteredRows.reduce((sum, item) => ({
    availableQty: sum.availableQty + item.availableQty,
    lockedQty: sum.lockedQty + item.lockedQty,
    inTransitQty: sum.inTransitQty + item.inTransitQty,
    totalQty: sum.totalQty + item.totalQty,
  }), { availableQty: 0, lockedQty: 0, inTransitQty: 0, totalQty: 0 });

  React.useEffect(() => {
    setPage(1);
  }, [selectedSnapshotDate, warehouseId, pageSize]);

  async function changeSnapshotDate(date: string) {
    setSnapshotBusy(true);
    try {
      await onLoadInventorySnapshots(date);
      setWarehouseId("全部");
    } finally {
      setSnapshotBusy(false);
    }
  }

  async function captureSnapshot() {
    setSnapshotBusy(true);
    try {
      await onCaptureInventorySnapshot();
      setWarehouseId("全部");
    } finally {
      setSnapshotBusy(false);
    }
  }

  async function exportSnapshotCsv() {
    if (!selectedSnapshotDate) return;
    setSnapshotBusy(true);
    try {
      const selectedWarehouseId = warehouseId === "全部" ? "" : warehouseId;
      const blob = await downloadInventorySnapshotCsv(selectedSnapshotDate, selectedWarehouseId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `inventory-snapshot-${selectedSnapshotDate}${selectedWarehouseId ? `-${selectedWarehouseId}` : ""}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "库存快照导出失败");
    } finally {
      setSnapshotBusy(false);
    }
  }

  return (
    <main className="warehouse-page">
      <section className="library-hero warehouse-hero">
        <div>
          <p className="eyebrow">Inventory Snapshot</p>
          <h2>库存快照</h2>
          <p>每天凌晨 3 点自动同步仓库库存并保存当天快照；也可以手动生成今日快照，按日期和仓库筛选后导出 CSV。</p>
          <div className="source-row">
            <span className={`status-pill ${snapshot ? "good" : "warning"}`}>{snapshot ? "快照已生成" : "暂无快照"}</span>
            <span>{snapshot?.capturedAt ? new Date(snapshot.capturedAt).toLocaleString("zh-CN") : "等待生成库存快照"}</span>
          </div>
        </div>
        <button className="sync-button" type="button" onClick={captureSnapshot} disabled={snapshotBusy}>
          <DatabaseZap size={16} />
          {snapshotBusy ? "处理中" : "生成今日快照"}
        </button>
      </section>

      <section className="panel inventory-snapshot-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Snapshot Query</p>
            <h2>快照明细</h2>
            <span>当前显示 {formatNumber(visibleRows.length)} / {formatNumber(filteredRows.length)} 条记录。</span>
          </div>
          <div className="snapshot-actions">
            <select value={selectedSnapshotDate} onChange={(event) => changeSnapshotDate(event.target.value)} disabled={snapshotBusy || !snapshotDates.length}>
              {snapshotDates.length ? snapshotDates.map((item) => (
                <option key={item.date} value={item.date}>{item.date}</option>
              )) : <option value="">暂无快照</option>}
            </select>
            <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} disabled={!snapshotRows.length}>
              <option value="全部">全部仓库</option>
              {warehouses.map((item) => (
                <option key={item.warehouseId} value={item.warehouseId}>{item.warehouseName}</option>
              ))}
            </select>
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
              {[50, 200, 500].map((size) => (
                <option key={size} value={size}>每页 {size} 条</option>
              ))}
            </select>
            <button className="ghost-button" type="button" onClick={exportSnapshotCsv} disabled={!snapshot || snapshotBusy}>
              <Download size={16} />
              导出 CSV
            </button>
          </div>
        </div>

        <div className="snapshot-summary">
          <span>快照日期 <strong>{snapshot?.date || "暂无"}</strong></span>
          <span>仓库 <strong>{formatNumber(warehouseId === "全部" ? snapshot?.warehouseCount || 0 : 1)}</strong></span>
          <span>SKU <strong>{formatNumber(new Set(filteredRows.map((item) => item.sku).filter(Boolean)).size)}</strong></span>
          <span>可售库存 <strong>{formatNumber(filteredTotals.availableQty)}</strong></span>
          <span>总库存 <strong>{formatNumber(filteredTotals.totalQty)}</strong></span>
        </div>

        <div className="snapshot-table">
          <div className="snapshot-row snapshot-head">
            <span>仓库</span>
            <span>SKU / 产品</span>
            <span>可售</span>
            <span>锁定</span>
            <span>在途</span>
            <span>总库存</span>
          </div>
          {visibleRows.length ? visibleRows.map((item) => (
            <article className="snapshot-row" key={`${snapshot?.date}-${item.warehouseId}-${item.countrySku}-${item.sku}`}>
              <span>{item.warehouseName}<small>{item.country}</small></span>
              <span><strong>{item.sku}</strong><small>{item.productName || item.countrySku}</small></span>
              <strong>{formatNumber(item.availableQty)}</strong>
              <span>{formatNumber(item.lockedQty)}</span>
              <span>{formatNumber(item.inTransitQty)}</span>
              <strong>{formatNumber(item.totalQty)}</strong>
            </article>
          )) : (
            <div className="stockup-empty">暂无库存快照。请先同步仓库，或点击“生成今日快照”。</div>
          )}
        </div>

        <div className="snapshot-pagination">
          <span>第 {formatNumber(safePage)} / {formatNumber(totalPages)} 页</span>
          <div>
            <button className="ghost-button compact-button" type="button" onClick={() => setPage(1)} disabled={safePage <= 1}>首页</button>
            <button className="ghost-button compact-button" type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={safePage <= 1}>上一页</button>
            <button className="ghost-button compact-button" type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={safePage >= totalPages}>下一页</button>
            <button className="ghost-button compact-button" type="button" onClick={() => setPage(totalPages)} disabled={safePage >= totalPages}>末页</button>
          </div>
        </div>
      </section>
    </main>
  );
}

function WarehouseAuthForm({
  providers,
  initialWarehouse,
  onCreate,
  onUpdate,
  onClose,
}: {
  providers: WarehousePayload["providers"];
  initialWarehouse?: WarehousePayload["warehouses"][number] | null;
  onCreate: (input: Parameters<typeof createWarehouseConnection>[0]) => Promise<void>;
  onUpdate: (id: string, input: Parameters<typeof updateWarehouseConnection>[1]) => Promise<void>;
  onClose: () => void;
}) {
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({
    name: initialWarehouse?.name || "",
    country: initialWarehouse?.country || "",
    providerId: initialWarehouse?.providerId || providers[0]?.id || "sea_wms",
    baseUrl: initialWarehouse?.baseUrl || "",
    warehouseCode: initialWarehouse?.warehouseCode || "",
    warehouseId: initialWarehouse?.warehouseId || "",
    appKey: "",
    appSecret: "",
    clientId: "",
    clientSecret: "",
    token: "",
  });
  const editing = Boolean(initialWarehouse);

  const selectedProvider = providers.find((provider) => provider.id === form.providerId);

  function updateField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      if (initialWarehouse) {
        await onUpdate(initialWarehouse.id, form);
      } else {
        await onCreate(form);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel warehouse-auth-form">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">WMS Credential</p>
          <h2>{editing ? "编辑仓库授权" : "新增仓库授权"}</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="关闭表单">
          <X size={17} />
        </button>
      </div>
      <form onSubmit={submit}>
        <label>
          <span>仓库名称</span>
          <input required value={form.name} onChange={(event) => updateField("name", event.target.value)} placeholder="例如：印尼神牛雅加达仓" />
        </label>
        <label>
          <span>国家</span>
          <input required value={form.country} onChange={(event) => updateField("country", event.target.value)} placeholder="例如：印尼" />
        </label>
        <label>
          <span>WMS 类型</span>
          <select value={form.providerId} onChange={(event) => updateField("providerId", event.target.value)}>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>接口地址 baseUrl</span>
          <input required value={form.baseUrl} onChange={(event) => updateField("baseUrl", event.target.value)} placeholder="https://..." />
        </label>
        <label>
          <span>仓库编码</span>
          <input value={form.warehouseCode} onChange={(event) => updateField("warehouseCode", event.target.value)} placeholder="warehouseCode" />
        </label>
        <label>
          <span>库存 warehouseId（可选）</span>
          <input value={form.warehouseId} onChange={(event) => updateField("warehouseId", event.target.value)} placeholder="不确定时可先留空" />
        </label>
        <label>
          <span>{form.providerId === "sea_wms" ? "AppKey / ClientId" : "AppKey"}</span>
          <input value={form.providerId === "sea_wms" ? form.clientId || form.appKey : form.appKey} onChange={(event) => {
            updateField("appKey", event.target.value);
            updateField("clientId", event.target.value);
          }} placeholder="只保存在服务端" />
        </label>
        <label>
          <span>{form.providerId === "sea_wms" ? "AppSecret / ClientSecret" : "AppSecret"}</span>
          <input type="password" value={form.providerId === "sea_wms" ? form.clientSecret || form.appSecret : form.appSecret} onChange={(event) => {
            updateField("appSecret", event.target.value);
            updateField("clientSecret", event.target.value);
          }} placeholder="只保存在服务端" />
        </label>
        <label>
          <span>Token（可选）</span>
          <input type="password" value={form.token} onChange={(event) => updateField("token", event.target.value)} placeholder="如接口需要 token" />
        </label>
        <div className="warehouse-auth-note">
          <strong>{selectedProvider?.name || "WMS"}</strong>
          <span>{selectedProvider?.notes || "授权信息保存后可用于库存、出库日报和商品图片同步。"}</span>
        </div>
        <div className="warehouse-auth-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            取消
          </button>
          <button className="sync-button" disabled={saving}>
            {saving ? "保存中" : editing ? "更新仓库" : "保存仓库"}
          </button>
        </div>
      </form>
    </section>
  );
}

function Metric({
  title,
  value,
  note,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string;
  note: string;
  icon: typeof Boxes;
  tone: string;
}) {
  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-icon">
        <Icon size={20} />
      </div>
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function productKeySet(product?: CatalogProduct | ProductBase | null) {
  return new Set(
    [product?.sku, product?.skuNo, "countrySku" in (product || {}) ? (product as CatalogProduct).countrySku : ""]
      .filter(Boolean)
      .map((item) => String(item).trim().toLowerCase()),
  );
}

function findProductBase(product: CatalogProduct, productBase: ProductBase[]) {
  const keys = productKeySet(product);
  return productBase.find((item) => {
    const itemKeys = productKeySet(item);
    return Array.from(itemKeys).some((key) => keys.has(key));
  });
}

function getRelatedQualifications(product: CatalogProduct | undefined, qualificationPayload: QualificationPayload | null) {
  const keys = productKeySet(product);
  return (qualificationPayload?.qualifications || []).filter((item) => keys.has(item.sku.trim().toLowerCase()));
}

function getRelatedAssets(product: CatalogProduct | undefined, base: ProductBase | undefined, assetPayload: AssetPayload | null) {
  const keys = new Set([
    ...Array.from(productKeySet(product)),
    ...Array.from(productKeySet(base)),
    product?.id,
    base?.id,
    product?.name,
    base?.name,
    product?.nameEn,
    base?.nameEn,
  ].filter(Boolean).map((item) => String(item).trim().toLowerCase()));

  return (assetPayload?.assets || []).filter((item) => {
    const assetKeys = [
      item.productRecordId,
      item.sku,
      item.productName,
      item.productNameEn,
      item.assetName,
    ].filter(Boolean).map((value) => String(value).trim().toLowerCase());
    return assetKeys.some((key) => keys.has(key));
  });
}

function textOrDash(value?: string | number) {
  const text = String(value ?? "").trim();
  return text || "未配置";
}

function productDimensionText(product: CatalogProduct, base?: ProductBase) {
  const length = textOrDash(base?.length || product.length);
  const width = textOrDash(base?.width || product.width);
  const height = textOrDash(base?.height || product.height);
  if ([length, width, height].every((item) => item === "未配置")) return "未配置";
  return `${length} × ${width} × ${height}`;
}

function QualificationCards({ qualifications }: { qualifications: QualificationRecord[] }) {
  if (!qualifications.length) {
    return (
      <div className="qualification-empty">
        <PackageCheck size={22} />
        <strong>当前产品暂无关联资质</strong>
        <span>请确认资质库 SKU 字段与产品库 SKU、SKU 编号或国家 SKU 一致。</span>
      </div>
    );
  }

  return (
    <div className="qualification-list">
      {qualifications.map((qualification) => (
        <article className="qualification-card" key={qualification.id}>
          <div className="qualification-card-head">
            <FileText size={18} />
            <div>
              <strong>{qualification.qualificationName}</strong>
              <span>
                {qualification.qualificationCategory} · {qualification.market}
              </span>
            </div>
          </div>
          <dl>
            <div>
              <dt>签发方</dt>
              <dd>{qualification.issuer || "未配置"}</dd>
            </div>
            <div>
              <dt>有效期</dt>
              <dd>
                {formatDate(qualification.effectiveDate)} - {formatDate(qualification.expiryDate)}
              </dd>
            </div>
            <div>
              <dt>备注</dt>
              <dd>{qualification.remark || "无"}</dd>
            </div>
          </dl>
          <div className="qualification-files">
            {qualification.files.length ? (
              qualification.files.map((file) => {
                const href = file.url || (file.fileId ? qualificationFileDownloadUrl(file.fileId, file.name) : "");
                return href ? (
                  <a href={href} target="_blank" rel="noreferrer" download key={file.id}>
                    <Download size={15} />
                    {file.name}
                  </a>
                ) : null;
              })
            ) : (
              <span>暂无附件</span>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function AssetCards({ assets }: { assets: AssetRecord[] }) {
  if (!assets.length) {
    return (
      <div className="asset-empty">
        <strong>当前产品暂无关联素材</strong>
        <span>请确认素材库产品字段与产品基础信息记录 ID、SKU、中文名或外文名一致。</span>
      </div>
    );
  }

  return (
    <div className="asset-list">
      {assets.map((asset) => (
        <article className="asset-card" key={asset.id}>
          <div className="asset-card-head">
            <Boxes size={18} />
            <div>
              <strong>{asset.assetName}</strong>
              <span>
                {asset.assetType} · {asset.category}
              </span>
            </div>
          </div>
          <dl>
            <div>
              <dt>产品</dt>
              <dd>{asset.productName || asset.sku || "未配置"}</dd>
            </div>
            <div>
              <dt>备注</dt>
              <dd>{asset.remark || "无"}</dd>
            </div>
          </dl>
          <div className="qualification-files">
            {asset.files.length ? (
              asset.files.map((file) => {
                const href = file.url || (file.fileId ? qualificationFileDownloadUrl(file.fileId, file.name) : "");
                return href ? (
                  <a href={href} target="_blank" rel="noreferrer" download key={file.id}>
                    <Download size={15} />
                    {file.name}
                  </a>
                ) : null;
              })
            ) : (
              <span>暂无附件</span>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function ProductDetailModal({
  product,
  productBase,
  qualifications,
  assets,
  onClose,
}: {
  product: CatalogProduct;
  productBase: ProductBase[];
  qualifications: QualificationRecord[];
  assets: AssetRecord[];
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = React.useState<"base" | "qualifications" | "assets">("base");
  const base = findProductBase(product, productBase);
  const detailRows = [
    ["产品流水号", base?.skuNo || product.skuNo],
    ["SKU", product.sku],
    ["产品分类", base?.category || product.category],
    ["功效分类", base?.functionCategory || product.functionCategory],
    ["中文名称", base?.name || product.name],
    ["外文名称", base?.nameEn || product.nameEn],
    ["产品类型", base?.productType || product.productType],
    ["SKU属性", base?.skuAttribute || product.skuAttribute],
    ["品牌", base?.brand || product.brand],
    ["单位", base?.unit || product.unit],
    ["产品条码", base?.barcode || product.barcode],
    ["规格型号", base?.specification || product.specification],
    ["归属项目", base?.project || product.project],
    ["重量", base?.weight || product.weight],
    ["长宽高尺寸", productDimensionText(product, base)],
  ];
  const productImageUrl = base?.imageUrl || product.imageUrl;
  const qualificationImageUrl = base?.qualificationImageUrl || product.qualificationImageUrl;

  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label="产品关联资料">
      <button className="modal-backdrop" type="button" onClick={onClose} aria-label="关闭弹窗" />
      <section className="product-detail-modal">
        <div className="modal-head">
          <div>
            <p className="eyebrow">Linked Product Assets</p>
            <h2>{product.name}</h2>
            <span>{product.sku}</span>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭弹窗">
            <X size={18} />
          </button>
        </div>
        <div className="modal-tabs" role="tablist" aria-label="产品关联资料">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "base"}
            className={activeTab === "base" ? "active" : ""}
            onClick={() => setActiveTab("base")}
          >
            <FileText size={16} />
            产品基础信息
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "qualifications"}
            className={activeTab === "qualifications" ? "active" : ""}
            onClick={() => setActiveTab("qualifications")}
          >
            <PackageCheck size={16} />
            资质库
            <span>{qualifications.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "assets"}
            className={activeTab === "assets" ? "active" : ""}
            onClick={() => setActiveTab("assets")}
          >
            <Boxes size={16} />
            素材库
            <span>{assets.length}</span>
          </button>
        </div>
        <div className="modal-content">
          {activeTab === "base" ? (
          <section className="detail-section">
            <div className="detail-section-head">
              <FileText size={18} />
              <h3>产品基础信息</h3>
            </div>
            <dl className="product-info-grid">
              {detailRows.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{textOrDash(value)}</dd>
                </div>
              ))}
            </dl>
            <div className="copy-block">
              <strong>产品文案</strong>
              <p>{textOrDash(base?.publicDescription || product.publicDescription)}</p>
            </div>
            <div className="copy-block">
              <strong>产品卖点</strong>
              <p>{textOrDash(base?.sellingPoints || product.sellingPoints)}</p>
            </div>
            <div className="copy-block">
              <strong>产品卖点（英文）</strong>
              <p>{textOrDash(base?.sellingPointsEn || product.sellingPointsEn)}</p>
            </div>
            <div className="base-image-grid">
              <div>
                <strong>产品图片</strong>
                {productImageUrl ? <img src={productImageUrl} alt={`${product.name} 产品图片`} /> : <span>未配置</span>}
              </div>
              <div>
                <strong>资质图片</strong>
                {qualificationImageUrl ? <img src={qualificationImageUrl} alt={`${product.name} 资质图片`} /> : <span>未配置</span>}
              </div>
            </div>
          </section>
          ) : null}
          {activeTab === "qualifications" ? (
          <section className="detail-section">
            <div className="detail-section-head">
              <PackageCheck size={18} />
              <h3>资质库</h3>
            </div>
            <QualificationCards qualifications={qualifications} />
          </section>
          ) : null}
          {activeTab === "assets" ? (
          <section className="detail-section">
            <div className="detail-section-head">
              <Boxes size={18} />
              <h3>素材库</h3>
            </div>
            <AssetCards assets={assets} />
          </section>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function QualificationLibrary({
  products,
  qualificationPayload,
  onSyncQualifications,
  syncing,
}: {
  products: CatalogProduct[];
  qualificationPayload: QualificationPayload | null;
  onSyncQualifications: () => Promise<void>;
  syncing: boolean;
}) {
  const [selectedSku, setSelectedSku] = React.useState(products[0]?.sku || "");
  const selectedProduct = products.find((product) => product.sku === selectedSku) || products[0];
  const relatedQualifications = getRelatedQualifications(selectedProduct, qualificationPayload);

  React.useEffect(() => {
    if (!selectedSku && products[0]?.sku) {
      setSelectedSku(products[0].sku);
      return;
    }
    if (selectedSku && !products.some((product) => product.sku === selectedSku) && products[0]?.sku) {
      setSelectedSku(products[0].sku);
    }
  }, [products, selectedSku]);

  return (
    <main className="library-page">
      <section className="qualification-panel">
        <div className="qualification-head">
          <div>
            <p className="eyebrow">Qualification Library</p>
            <h3>资质库</h3>
            <span>
              选择产品后查看对应 SKU 的资质、有效期和附件。已同步 {formatNumber(qualificationPayload?.counts.qualifications || 0)} 条资质。
            </span>
          </div>
          <button className="sync-button" type="button" onClick={onSyncQualifications} disabled={syncing}>
            <RefreshCw size={16} className={syncing ? "spinning" : ""} />
            同步资质库
          </button>
        </div>
        <div className="qualification-layout">
          <label className="qualification-picker">
            <span>产品</span>
            <select value={selectedProduct?.sku || ""} onChange={(event) => setSelectedSku(event.target.value)}>
              {products.map((product) => (
                <option key={product.id} value={product.sku}>
                  {product.sku} · {product.name}
                </option>
              ))}
            </select>
          </label>
          <QualificationCards qualifications={relatedQualifications} />
        </div>
      </section>
    </main>
  );
}

function AssetLibrary({
  products,
  productBase,
  assetPayload,
  onSyncAssets,
  syncing,
}: {
  products: CatalogProduct[];
  productBase: ProductBase[];
  assetPayload: AssetPayload | null;
  onSyncAssets: () => Promise<void>;
  syncing: boolean;
}) {
  const [selectedSku, setSelectedSku] = React.useState(products[0]?.sku || "");
  const selectedProduct = products.find((product) => product.sku === selectedSku) || products[0];
  const selectedBase = selectedProduct ? findProductBase(selectedProduct, productBase) : undefined;
  const relatedAssets = getRelatedAssets(selectedProduct, selectedBase, assetPayload);

  React.useEffect(() => {
    if (!selectedSku && products[0]?.sku) {
      setSelectedSku(products[0].sku);
      return;
    }
    if (selectedSku && !products.some((product) => product.sku === selectedSku) && products[0]?.sku) {
      setSelectedSku(products[0].sku);
    }
  }, [products, selectedSku]);

  return (
    <main className="library-page">
      <section className="qualification-panel">
        <div className="qualification-head">
          <div>
            <p className="eyebrow">Asset Library</p>
            <h3>素材库</h3>
            <span>
              选择产品后查看对应的图片、源文件和素材附件。已同步 {formatNumber(assetPayload?.counts.assets || 0)} 条素材。
            </span>
          </div>
          <button className="sync-button" type="button" onClick={onSyncAssets} disabled={syncing}>
            <RefreshCw size={16} className={syncing ? "spinning" : ""} />
            同步素材库
          </button>
        </div>
        <div className="qualification-layout">
          <label className="qualification-picker">
            <span>产品</span>
            <select value={selectedProduct?.sku || ""} onChange={(event) => setSelectedSku(event.target.value)}>
              {products.map((product) => (
                <option key={product.id} value={product.sku}>
                  {product.sku} · {product.name}
                </option>
              ))}
            </select>
          </label>
          <AssetCards assets={relatedAssets} />
        </div>
      </section>
    </main>
  );
}

function ProductLibrary({
  products,
  internal,
  currentUser,
  loading,
  payload,
  qualificationPayload,
  assetPayload,
  productBase,
}: {
  products: CatalogProduct[];
  internal: boolean;
  currentUser: AuthUser;
  loading: boolean;
  payload: ProductPayload | null;
  qualificationPayload: QualificationPayload | null;
  assetPayload: AssetPayload | null;
  productBase: ProductBase[];
}) {
  const defaultChannel = internal ? "全部" : "分销";
  const [channel, setChannel] = React.useState<"全部" | "直营" | "分销">(defaultChannel);
  const [country, setCountry] = React.useState("全部");
  const [brand, setBrand] = React.useState("全部");
  const [keywordInput, setKeywordInput] = React.useState("");
  const [keyword, setKeyword] = React.useState("");
  const [detailProduct, setDetailProduct] = React.useState<CatalogProduct | null>(null);
  const [showBackTop, setShowBackTop] = React.useState(false);
  const visibleChannels = internal ? (["全部", "直营", "分销"] as const) : (["分销"] as const);
  const showPrices = canViewPrices(currentUser);
  const showInventory = canViewInventory(currentUser);
  const countries = uniqueSorted(products.map((product) => product.country));
  const brands = uniqueSorted(products.map((product) => product.brand));
  const filteredProducts = products.filter((product) => {
    const channelMatched = channel === "全部" || channel === "直营" || product.channel === channel;
    const countryMatched = country === "全部" || product.country === country;
    const brandMatched = brand === "全部" || product.brand === brand;
    return channelMatched && countryMatched && brandMatched && includesFuzzy(product, keyword);
  });
  React.useEffect(() => {
    if (!internal) setChannel("分销");
  }, [internal]);

  React.useEffect(() => {
    function handleScroll() {
      setShowBackTop(window.scrollY > 520);
    }

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <main className="library-page">
      <section className="library-hero">
        <div>
          <p className="eyebrow">Product Center</p>
          <h2>产品中心</h2>
          <p>
            按国家、品牌、SKU 和产品名称快速浏览在售产品，查看产品价格、品类、单位和基础资料。
          </p>
          <div className="source-row">
            <span className={`status-pill ${payload?.source === "jiandaoyun" ? "good" : "warning"}`}>
              {payload?.source === "jiandaoyun" ? "系统已同步" : "样例数据"}
            </span>
            <span>{payload?.syncedAt ? new Date(payload.syncedAt).toLocaleString("zh-CN") : "等待同步"}</span>
          </div>
        </div>
        <div className="catalog-actions">
          {visibleChannels.map((item) => (
            <button key={item} className={channel === item ? "active" : ""} onClick={() => setChannel(item)}>
              {item}
            </button>
          ))}
        </div>
      </section>

      <form
        className="catalog-search-row"
        onSubmit={(event) => {
          event.preventDefault();
          setKeyword(keywordInput);
        }}
      >
        <label className="catalog-search large">
          <Search size={17} />
          <input value={keywordInput} onChange={(event) => setKeywordInput(event.target.value)} placeholder="搜索 SKU、产品名称、分类、品牌" />
        </label>
        <button className="sync-button catalog-search-button" type="submit">
          <Search size={16} />
          搜索
        </button>
      </form>

      <section className="catalog-filter-panel">
        <div className="filter-block country-filter">
          <span>国家</span>
          <div>
            <button className={country === "全部" ? "active" : ""} onClick={() => setCountry("全部")}>
              <span className="flag-icon flag-global" />
              全部
            </button>
            {countries.map((item) => (
              <button key={item} className={country === item ? "active" : ""} onClick={() => setCountry(item)}>
                <span className={`flag-icon flag-${flagCodeForCountry(item)}`} />
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-block">
          <span>品牌</span>
          <select value={brand} onChange={(event) => setBrand(event.target.value)}>
            <option value="全部">全部品牌</option>
            {brands.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-result">
          <strong>{formatNumber(filteredProducts.length)}</strong>
          <span>个产品</span>
        </div>
      </section>

      {loading ? <div className="notice">正在读取产品库...</div> : null}

      <section className="catalog-grid">
        {filteredProducts.map((product) => {
          const price = priceFor(product, channel, internal);
          const salesPrice = salesPriceFor(product);
          return (
            <article className="product-card" key={product.id}>
              {product.imageUrl ? (
                <div className="product-photo">
                  <img src={product.imageUrl} alt={product.name} />
                  <span>{product.imageSource === "wms" ? "仓库图片" : "产品图片"}</span>
                </div>
              ) : (
                <div className={`product-visual ${product.visualTone}`} aria-label={`${product.name} 产品视觉`}>
                  <span>{product.category}</span>
                  <strong>{product.name.slice(0, 2)}</strong>
                </div>
              )}
              <div className="product-body">
                <div className="product-title-row">
                  <div>
                    <CopyableSku sku={product.sku} />
                    <h3>{product.name}</h3>
                  </div>
                  {showInventory ? <span className={`status-pill ${alertClass(product.alert)}`}>{product.alert}</span> : null}
                </div>
                <div className="product-facts">
                  <span>
                    <Globe2 size={15} />
                    {product.country}
                  </span>
                  {showInventory ? <StockFact product={product} /> : null}
                  <span>
                    <ShoppingBag size={15} />
                    {product.channel}
                  </span>
                </div>
                <div className="price-row">
                  {showPrices ? (
                    <>
                      <div>
                        <small>{price.label}</small>
                        <strong>
                          {price.currency} {formatMoney(price.price)}
                        </strong>
                      </div>
                      <div className="sales-price">
                        <small>{salesPrice.label}</small>
                        <strong>
                          {salesPrice.currency} {formatMoney(salesPrice.price)}
                        </strong>
                      </div>
                    </>
                  ) : (
                    <div className="locked-price">
                      <small>价格与库存</small>
                      <strong>登录后可见</strong>
                    </div>
                  )}
                  <button className="icon-button" type="button" aria-label="查看产品关联资料" onClick={() => setDetailProduct(product)}>
                    <ExternalLink size={17} />
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </section>
      {detailProduct ? (
        <ProductDetailModal
          product={detailProduct}
          productBase={productBase}
          qualifications={getRelatedQualifications(detailProduct, qualificationPayload)}
          assets={getRelatedAssets(detailProduct, findProductBase(detailProduct, productBase), assetPayload)}
          onClose={() => setDetailProduct(null)}
        />
      ) : null}
      <button
        className={`back-to-top-button ${showBackTop ? "visible" : ""}`}
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        aria-label="回到顶部"
        title="回到顶部"
      >
        <ArrowUp size={18} />
        <span>顶部</span>
      </button>
    </main>
  );
}

function QuickNavPage({
  quickNavPayload,
  currentUser,
  onRefresh,
}: {
  quickNavPayload: QuickNavPayload | null;
  currentUser: AuthUser;
  onRefresh: () => Promise<void>;
}) {
  const [localPayload, setLocalPayload] = React.useState<QuickNavPayload | null>(null);
  const visiblePayload = localPayload || quickNavPayload;
  const categories = visiblePayload?.categories ?? [];
  const admin = canManage(currentUser);
  const [categoryForm, setCategoryForm] = React.useState({ name: "", description: "", sortOrder: 0 });
  const [linkForm, setLinkForm] = React.useState({ categoryId: "", title: "", url: "", description: "", sortOrder: 0 });
  const [saving, setSaving] = React.useState(false);
  const [actionId, setActionId] = React.useState("");
  const [message, setMessage] = React.useState("");

  React.useEffect(() => {
    setLocalPayload(null);
  }, [quickNavPayload?.updatedAt]);

  React.useEffect(() => {
    if (!linkForm.categoryId && categories[0]?.id) {
      setLinkForm((current) => ({ ...current, categoryId: categories[0].id }));
    }
  }, [categories, linkForm.categoryId]);

  async function refreshAfterAction(payload: QuickNavPayload) {
    setLocalPayload(payload);
    await onRefresh().catch(() => null);
  }

  async function handleCreateCategory(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const result = await createQuickNavCategory(categoryForm);
      await refreshAfterAction(result);
      const nextCategory = result.categories.find((category) => category.name === categoryForm.name) || result.categories[0];
      setCategoryForm({ name: "", description: "", sortOrder: 0 });
      setLinkForm((current) => ({ ...current, categoryId: nextCategory?.id || current.categoryId }));
      setMessage("分类已创建。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建分类失败。");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateLink(event: React.FormEvent) {
    event.preventDefault();
    if (!linkForm.categoryId) {
      setMessage("请先创建或选择一个分类。");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const result = await createQuickNavLink(linkForm.categoryId, {
        title: linkForm.title,
        url: linkForm.url,
        description: linkForm.description,
        sortOrder: linkForm.sortOrder,
      });
      await refreshAfterAction(result);
      setLinkForm((current) => ({ ...current, title: "", url: "", description: "", sortOrder: 0 }));
      setMessage("快捷方式已添加。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "添加快捷方式失败。");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteCategory(categoryId: string) {
    if (!window.confirm("确认删除这个分类？分类下的快捷方式也会一起删除。")) return;
    setActionId(categoryId);
    setMessage("");
    try {
      const result = await deleteQuickNavCategory(categoryId);
      await refreshAfterAction(result);
      setMessage("分类已删除。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除分类失败。");
    } finally {
      setActionId("");
    }
  }

  async function handleDeleteLink(categoryId: string, linkId: string) {
    setActionId(linkId);
    setMessage("");
    try {
      const result = await deleteQuickNavLink(categoryId, linkId);
      await refreshAfterAction(result);
      setMessage("快捷方式已删除。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除快捷方式失败。");
    } finally {
      setActionId("");
    }
  }

  return (
    <main className="library-page quick-nav-page">
      <section className="qualification-panel quick-nav-panel">
        <div className="qualification-head">
          <div>
            <p className="eyebrow">Quick Links</p>
            <h3>快捷导航</h3>
            <span>
              已收录 {formatNumber(visiblePayload?.counts.links || 0)} 个网页工具，按 {formatNumber(visiblePayload?.counts.categories || 0)} 个分类归档。
            </span>
          </div>
          <button className="ghost-button" type="button" onClick={onRefresh}>
            <RefreshCw size={16} />
            刷新
          </button>
        </div>

        {admin ? (
          <div className="quick-nav-admin-grid">
            <form className="quick-nav-form" onSubmit={handleCreateCategory}>
              <div>
                <p className="eyebrow">Category</p>
                <h3>创建分类</h3>
              </div>
              <label>
                <span>分类名称</span>
                <input value={categoryForm.name} onChange={(event) => setCategoryForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如：平台后台" />
              </label>
              <label>
                <span>分类说明</span>
                <input value={categoryForm.description} onChange={(event) => setCategoryForm((current) => ({ ...current, description: event.target.value }))} placeholder="可选" />
              </label>
              <label>
                <span>排序</span>
                <input type="number" value={categoryForm.sortOrder} onChange={(event) => setCategoryForm((current) => ({ ...current, sortOrder: Number(event.target.value) }))} />
              </label>
              <button className="sync-button" type="submit" disabled={saving}>
                <Settings size={16} />
                创建分类
              </button>
            </form>

            <form className="quick-nav-form" onSubmit={handleCreateLink}>
              <div>
                <p className="eyebrow">Shortcut</p>
                <h3>新增快捷方式</h3>
              </div>
              <label>
                <span>所属分类</span>
                <select value={linkForm.categoryId} onChange={(event) => setLinkForm((current) => ({ ...current, categoryId: event.target.value }))}>
                  {categories.length ? categories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  )) : (
                    <option value="">请先创建分类</option>
                  )}
                </select>
              </label>
              <label>
                <span>工具名称</span>
                <input value={linkForm.title} onChange={(event) => setLinkForm((current) => ({ ...current, title: event.target.value }))} placeholder="例如：店铺后台" />
              </label>
              <label>
                <span>网址</span>
                <input value={linkForm.url} onChange={(event) => setLinkForm((current) => ({ ...current, url: event.target.value }))} placeholder="https://..." />
              </label>
              <label>
                <span>说明</span>
                <input value={linkForm.description} onChange={(event) => setLinkForm((current) => ({ ...current, description: event.target.value }))} placeholder="可选" />
              </label>
              <button className="sync-button" type="submit" disabled={saving || !categories.length}>
                <ExternalLink size={16} />
                添加快捷方式
              </button>
            </form>
          </div>
        ) : null}

        {message ? <div className={`notice ${message.includes("失败") ? "warning" : ""}`}>{message}</div> : null}

        <div className="quick-nav-grid">
          {categories.length ? categories.map((category) => (
            <section className="quick-nav-category" key={category.id}>
              <div className="quick-nav-category-head">
                <div>
                  <h3>{category.name}</h3>
                  {category.description ? <span>{category.description}</span> : null}
                </div>
                {admin ? (
                  <button className="ghost-button danger-button" type="button" disabled={actionId === category.id} onClick={() => handleDeleteCategory(category.id)}>
                    删除分类
                  </button>
                ) : null}
              </div>
              <div className="quick-nav-link-list">
                {category.links.length ? category.links.map((link) => (
                  <article className="quick-nav-link-card" key={link.id}>
                    <a href={link.url} target="_blank" rel="noreferrer">
                      <span>
                        <strong>{link.title}</strong>
                        {link.description ? <small>{link.description}</small> : <small>{link.url}</small>}
                      </span>
                      <ExternalLink size={17} />
                    </a>
                    {admin ? (
                      <button className="icon-button danger-button" type="button" title="删除快捷方式" disabled={actionId === link.id} onClick={() => handleDeleteLink(category.id, link.id)}>
                        <X size={15} />
                      </button>
                    ) : null}
                  </article>
                )) : (
                  <div className="stockup-empty">这个分类下还没有快捷方式。</div>
                )}
              </div>
            </section>
          )) : (
            <div className="stockup-empty">暂无快捷导航。管理员可以先创建分类，再添加常用网页工具。</div>
          )}
        </div>
      </section>
    </main>
  );
}

function TongzhouAiPanel({
  aiConfig,
  currentUser,
  onRefreshConfig,
}: {
  aiConfig: AiConfigPayload | null;
  currentUser: AuthUser;
  onRefreshConfig: () => Promise<void>;
}) {
  const admin = canManage(currentUser);
  const [activeTab, setActiveTab] = React.useState<"text" | "image" | "video">("text");
  const [configForm, setConfigForm] = React.useState({
    apiKey: "",
    baseUrl: aiConfig?.baseUrl || "https://apihub.agnes-ai.com/v1",
    textModel: aiConfig?.models.text || "agnes-2.0-flash",
    imageModel: aiConfig?.models.image || "agnes-image-2.1-flash",
    videoModel: aiConfig?.models.video || "agnes-video-v2.0",
  });
  const [textPrompt, setTextPrompt] = React.useState("");
  const [chatMessages, setChatMessages] = React.useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [textParams, setTextParams] = React.useState({ temperature: 0.7, topP: 1, maxTokens: 1200 });
  const [showTextAdvanced, setShowTextAdvanced] = React.useState(false);
  const [imagePrompt, setImagePrompt] = React.useState("");
  const [imageParams, setImageParams] = React.useState({ size: "1024x1024", n: 1, quality: "standard", style: "natural", seed: "", negativePrompt: "" });
  const [imageReferenceUploads, setImageReferenceUploads] = React.useState<Array<{ name: string; url: string }>>([]);
  const [images, setImages] = React.useState<string[]>([]);
  const [videoPrompt, setVideoPrompt] = React.useState("");
  const [videoParams, setVideoParams] = React.useState({
    duration: 5,
    aspectRatio: "16:9",
    resolution: "720p",
    seed: "",
    negativePrompt: "",
    cameraControl: "",
    motionStrength: 0.5,
  });
  const [videoReferenceUploads, setVideoReferenceUploads] = React.useState<Array<{ name: string; url: string }>>([]);
  const [videoFrameUploads, setVideoFrameUploads] = React.useState<{ image?: { name: string; url: string }; first?: { name: string; url: string }; last?: { name: string; url: string } }>({});
  const [videoTask, setVideoTask] = React.useState("");
  const [videoStatus, setVideoStatus] = React.useState("");
  const [videoUrl, setVideoUrl] = React.useState("");
  const [busy, setBusy] = React.useState<"config" | "text" | "image" | "video" | "poll" | "upload" | "">("");
  const [message, setMessage] = React.useState("");

  React.useEffect(() => {
    if (!aiConfig) return;
    setConfigForm((current) => ({
      ...current,
      baseUrl: aiConfig.baseUrl || current.baseUrl,
      textModel: aiConfig.models.text || current.textModel,
      imageModel: aiConfig.models.image || current.imageModel,
      videoModel: aiConfig.models.video || current.videoModel,
    }));
  }, [aiConfig?.updatedAt]);

  React.useEffect(() => {
    if (!videoTask || videoUrl) return;
    const timer = window.setInterval(() => {
      void pollVideo(true);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [videoTask, videoUrl]);

  async function saveConfig(event: React.FormEvent) {
    event.preventDefault();
    setBusy("config");
    setMessage("");
    try {
      await updateAiConfig({
        apiKey: configForm.apiKey || undefined,
        baseUrl: configForm.baseUrl,
        models: {
          text: configForm.textModel,
          image: configForm.imageModel,
          video: configForm.videoModel,
        },
      });
      setConfigForm((current) => ({ ...current, apiKey: "" }));
      await onRefreshConfig();
      setMessage("同舟AI 配置已保存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存同舟AI配置失败。");
    } finally {
      setBusy("");
    }
  }

  async function submitText(event: React.FormEvent) {
    event.preventDefault();
    if (!textPrompt.trim()) {
      setMessage("请先输入要对话的内容。");
      return;
    }
    setBusy("text");
    setMessage("");
    const nextMessages = [...chatMessages, { role: "user" as const, content: textPrompt.trim() }];
    let answer = "";
    const assistantIndex = nextMessages.length;
    setChatMessages([...nextMessages, { role: "assistant", content: "" }]);
    setTextPrompt("");
    try {
      await streamAiText({
        messages: nextMessages,
        model: aiConfig?.models.text,
        temperature: textParams.temperature,
        topP: textParams.topP,
        maxTokens: textParams.maxTokens,
      }, (delta) => {
        answer += delta;
        setChatMessages((current) => current.map((item, index) => index === assistantIndex ? { ...item, content: answer } : item));
      });
      if (!answer) {
        setChatMessages((current) => current.map((item, index) => index === assistantIndex ? { ...item, content: "模型没有返回文本内容。" } : item));
      }
    } catch (error) {
      try {
        const result = await runAiText({
          messages: nextMessages,
          model: aiConfig?.models.text,
          temperature: textParams.temperature,
          topP: textParams.topP,
          maxTokens: textParams.maxTokens,
        });
        setChatMessages((current) => current.map((item, index) => index === assistantIndex ? { ...item, content: result.answer || "模型没有返回文本内容。" } : item));
        setMessage("流式连接不可用，已切换为普通对话模式。");
      } catch (fallbackError) {
        setMessage(fallbackError instanceof Error ? fallbackError.message : error instanceof Error ? error.message : "文本生成失败。");
        setChatMessages((current) => current.filter((item) => item.content));
      }
    } finally {
      setBusy("");
    }
  }

  function handleTextKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  async function submitImage(event: React.FormEvent) {
    event.preventDefault();
    if (!imagePrompt.trim()) {
      setMessage("请先输入图片提示词。");
      return;
    }
    setBusy("image");
    setMessage("");
    setImages([]);
    try {
      const result = await runAiImage({
        prompt: imagePrompt,
        model: aiConfig?.models.image,
        size: imageParams.size,
        n: imageParams.n,
        quality: imageParams.quality,
        style: imageParams.style,
        seed: imageParams.seed ? Number(imageParams.seed) : undefined,
        negativePrompt: imageParams.negativePrompt,
        referenceImages: imageReferenceUploads.map((item) => item.url),
      });
      setImages(result.images || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "图片生成失败。");
    } finally {
      setBusy("");
    }
  }

  async function submitVideo(event: React.FormEvent) {
    event.preventDefault();
    if (!videoPrompt.trim()) {
      setMessage("请先输入视频提示词。");
      return;
    }
    setBusy("video");
    setMessage("");
    setVideoTask("");
    setVideoStatus("");
    setVideoUrl("");
    try {
      const result = await runAiVideo({
        prompt: videoPrompt,
        model: aiConfig?.models.video,
        duration: videoParams.duration,
        aspectRatio: videoParams.aspectRatio,
        resolution: videoParams.resolution,
        seed: videoParams.seed ? Number(videoParams.seed) : undefined,
        imageUrl: videoFrameUploads.image?.url,
        referenceImages: videoReferenceUploads.map((item) => item.url),
        firstFrameUrl: videoFrameUploads.first?.url,
        lastFrameUrl: videoFrameUploads.last?.url,
        negativePrompt: videoParams.negativePrompt,
        cameraControl: videoParams.cameraControl,
        motionStrength: videoParams.motionStrength,
      });
      setVideoTask(result.taskId || "");
      setVideoStatus(result.status || "submitted");
      setVideoUrl(result.videoUrl || "");
      if (!result.videoUrl && result.taskId) setMessage("视频任务已提交，系统会自动查询生成结果。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "视频生成失败。");
    } finally {
      setBusy("");
    }
  }

  function fileToDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("图片读取失败。"));
      reader.readAsDataURL(file);
    });
  }

  function isPrivateUploadUrl(url: string) {
    return /^https?:\/\/(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url);
  }

  async function uploadFiles(files: FileList | null, target: "imageRefs" | "videoRefs" | "videoImage" | "videoFirst" | "videoLast") {
    if (!files?.length) return;
    setBusy("upload");
    setMessage("");
    try {
      const uploaded = [] as Array<{ name: string; url: string }>;
      for (const file of Array.from(files)) {
        const dataUrl = await fileToDataUrl(file);
        const result = await uploadAiImage({ fileName: file.name, dataUrl });
        uploaded.push({ name: file.name, url: result.upload.url });
      }
      if (target === "imageRefs") {
        setImageReferenceUploads((current) => [...current, ...uploaded]);
      } else if (target === "videoRefs") {
        setVideoReferenceUploads((current) => [...current, ...uploaded]);
      } else {
        const key = target === "videoImage" ? "image" : target === "videoFirst" ? "first" : "last";
        setVideoFrameUploads((current) => ({ ...current, [key]: uploaded[uploaded.length - 1] }));
      }
      setMessage(uploaded.some((item) => isPrivateUploadUrl(item.url)) ? "图片已上传；当前是本地/内网地址，部署到公网后模型才能稳定读取参考图。" : "图片已上传，可直接用于模型参考。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "图片上传失败。");
    } finally {
      setBusy("");
    }
  }

  async function pollVideo(silent = false) {
    if (!videoTask) return;
    if (!silent) {
      setBusy("poll");
      setMessage("");
    }
    try {
      const result = await fetchAiVideoStatus(videoTask);
      setVideoStatus(result.status || videoStatus || "处理中");
      setVideoUrl(result.videoUrl || "");
      if (result.videoUrl) setMessage("视频已生成。");
    } catch (error) {
      if (!silent) setMessage(error instanceof Error ? error.message : "查询视频状态失败。");
    } finally {
      if (!silent) setBusy("");
    }
  }

  function imageSrc(value: string) {
    if (/^https?:\/\//i.test(value) || value.startsWith("data:")) return value;
    return `data:image/png;base64,${value}`;
  }

  const tabs = [
    { id: "text" as const, label: "文字模型", model: "TZ-Text Pro", icon: Bot },
    { id: "image" as const, label: "图片生成模型", model: "TZ-Image Studio", icon: Image },
    { id: "video" as const, label: "视频生成模型", model: "TZ-Video Motion", icon: Video },
  ];

  return (
    <main className="movement-page ai-page">
      <section className="library-hero ai-hero">
        <div>
          <p className="eyebrow">Tongzhou AI</p>
          <h2>同舟AI</h2>
          <p>把文本、图片、视频生成能力集中在一个工作台里，由管理员统一配置 API Key 和模型。</p>
          <div className="source-row">
            <span className={`status-pill ${aiConfig?.configured ? "good" : "warning"}`}>
              {aiConfig?.configured ? "API Key 已配置" : "等待管理员配置 API Key"}
            </span>
            <span>{aiConfig?.apiKeyMasked || "未配置"}</span>
          </div>
        </div>
        <div className="ai-model-stack">
          <span><Bot size={15} /> TZ-Text Pro</span>
          <span><Image size={15} /> TZ-Image Studio</span>
          <span><Video size={15} /> TZ-Video Motion</span>
        </div>
      </section>

      {message ? <div className={`notice ${message.includes("失败") || message.includes("尚未配置") ? "warning" : ""}`}>{message}</div> : null}

      <section className="panel ai-workbench">
        <div className="ai-tabs" role="tablist" aria-label="同舟AI模型切换">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} type="button" className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}>
                <Icon size={17} />
                <span>{tab.label}</span>
                <small>{tab.model}</small>
              </button>
            );
          })}
        </div>

        {activeTab === "text" ? (
        <form className="ai-tool-card ai-tool-tab" onSubmit={submitText}>
          <div className="ai-tool-head">
            <Bot size={20} />
            <div>
              <p className="eyebrow">Text Model</p>
              <h3>文字模型 <span>TZ-Text Pro</span></h3>
            </div>
          </div>
          <div className="ai-chat-window">
            {chatMessages.length ? chatMessages.map((item, index) => (
              <article key={`${item.role}-${index}`} className={`ai-chat-message ${item.role}`}>
                <strong>{item.role === "user" ? "你" : "同舟AI"}</strong>
                <p>{item.content}</p>
              </article>
            )) : (
              <div className="stockup-empty">可以询问产品信息、仓库信息，或让同舟AI基于产品资料撰写卖点文案。系统不会向模型提供价格、成本和库存敏感字段。</div>
            )}
          </div>
          <textarea
            className="ai-chat-input"
            value={textPrompt}
            onChange={(event) => setTextPrompt(event.target.value)}
            onKeyDown={handleTextKeyDown}
            placeholder="输入问题、改写需求、翻译内容或分析任务。按 Enter 发送，Shift + Enter 换行。"
          />
          {showTextAdvanced ? (
          <div className="ai-parameter-grid">
            <label>
              <span>Temperature</span>
              <input type="number" min="0" max="2" step="0.1" value={textParams.temperature} onChange={(event) => setTextParams((current) => ({ ...current, temperature: Number(event.target.value) }))} />
            </label>
            <label>
              <span>Top P</span>
              <input type="number" min="0" max="1" step="0.05" value={textParams.topP} onChange={(event) => setTextParams((current) => ({ ...current, topP: Number(event.target.value) }))} />
            </label>
            <label>
              <span>最大输出</span>
              <input type="number" min="128" max="8000" step="128" value={textParams.maxTokens} onChange={(event) => setTextParams((current) => ({ ...current, maxTokens: Number(event.target.value) }))} />
            </label>
          </div>
          ) : null}
          <div className="ai-action-row">
            <button className="ghost-button" type="button" onClick={() => setChatMessages([])}>清空对话</button>
            <button className="ghost-button" type="button" onClick={() => setShowTextAdvanced((value) => !value)}>
              {showTextAdvanced ? "隐藏参数" : "高级参数"}
            </button>
          <button className="sync-button" type="submit" disabled={busy === "text"}>
            {busy === "text" ? "发送中" : "发送"}
          </button>
          </div>
        </form>
        ) : null}

        {activeTab === "image" ? (
        <form className="ai-tool-card ai-tool-tab" onSubmit={submitImage}>
          <div className="ai-tool-head">
            <Image size={20} />
            <div>
              <p className="eyebrow">Image Model</p>
              <h3>图片生成模型 <span>TZ-Image Studio</span></h3>
            </div>
          </div>
          <textarea value={imagePrompt} onChange={(event) => setImagePrompt(event.target.value)} placeholder="描述要生成的图片，例如产品场景图、素材图、社媒配图" />
          <div className="ai-parameter-grid">
            <label>
              <span>尺寸</span>
              <select value={imageParams.size} onChange={(event) => setImageParams((current) => ({ ...current, size: event.target.value }))}>
                <option value="1024x1024">1:1 方图</option>
                <option value="1024x1792">9:16 竖图</option>
                <option value="1792x1024">16:9 横图</option>
              </select>
            </label>
            <label>
              <span>数量</span>
              <input type="number" min="1" max="4" value={imageParams.n} onChange={(event) => setImageParams((current) => ({ ...current, n: Number(event.target.value) }))} />
            </label>
            <label>
              <span>质量</span>
              <select value={imageParams.quality} onChange={(event) => setImageParams((current) => ({ ...current, quality: event.target.value }))}>
                <option value="standard">Standard</option>
                <option value="hd">HD</option>
              </select>
            </label>
            <label>
              <span>风格</span>
              <select value={imageParams.style} onChange={(event) => setImageParams((current) => ({ ...current, style: event.target.value }))}>
                <option value="natural">Natural</option>
                <option value="vivid">Vivid</option>
              </select>
            </label>
            <label>
              <span>Seed</span>
              <input value={imageParams.seed} onChange={(event) => setImageParams((current) => ({ ...current, seed: event.target.value }))} placeholder="可选" />
            </label>
          </div>
          <label className="ai-wide-field">
            <span>负向提示词</span>
            <input value={imageParams.negativePrompt} onChange={(event) => setImageParams((current) => ({ ...current, negativePrompt: event.target.value }))} placeholder="不希望出现在图片里的内容" />
          </label>
          <label className="ai-wide-field">
            <span>参考图片</span>
            <input type="file" accept="image/*" multiple onChange={(event) => uploadFiles(event.currentTarget.files, "imageRefs")} />
            {imageReferenceUploads.length ? (
              <div className="ai-upload-list">
                {imageReferenceUploads.map((item) => (
                  <span key={item.url}>
                    <img src={item.url} alt={item.name} />
                    {item.name}
                    <button type="button" onClick={() => setImageReferenceUploads((current) => current.filter((upload) => upload.url !== item.url))}>移除</button>
                  </span>
                ))}
              </div>
            ) : null}
          </label>
          <button className="sync-button" type="submit" disabled={busy === "image"}>
            {busy === "image" ? "生成中" : "生成图片"}
          </button>
          {images.length ? (
            <div className="ai-image-results">
              {images.map((item, index) => <img key={`${item}-${index}`} src={imageSrc(item)} alt={`AI 生成图片 ${index + 1}`} />)}
            </div>
          ) : null}
        </form>
        ) : null}

        {activeTab === "video" ? (
        <form className="ai-tool-card ai-tool-tab" onSubmit={submitVideo}>
          <div className="ai-tool-head">
            <Video size={20} />
            <div>
              <p className="eyebrow">Video Model</p>
              <h3>视频生成模型 <span>TZ-Video Motion</span></h3>
            </div>
          </div>
          <textarea value={videoPrompt} onChange={(event) => setVideoPrompt(event.target.value)} placeholder="描述要生成的视频，例如产品展示短片、仓库流程动画、广告分镜" />
          <div className="ai-parameter-grid">
            <label>
              <span>时长</span>
              <input type="number" min="2" max="10" value={videoParams.duration} onChange={(event) => setVideoParams((current) => ({ ...current, duration: Number(event.target.value) }))} />
            </label>
            <label>
              <span>比例</span>
              <select value={videoParams.aspectRatio} onChange={(event) => setVideoParams((current) => ({ ...current, aspectRatio: event.target.value }))}>
                <option value="16:9">16:9 横屏</option>
                <option value="9:16">9:16 竖屏</option>
                <option value="1:1">1:1 方屏</option>
              </select>
            </label>
            <label>
              <span>清晰度</span>
              <select value={videoParams.resolution} onChange={(event) => setVideoParams((current) => ({ ...current, resolution: event.target.value }))}>
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
              </select>
            </label>
            <label>
              <span>运动强度</span>
              <input type="number" min="0" max="1" step="0.1" value={videoParams.motionStrength} onChange={(event) => setVideoParams((current) => ({ ...current, motionStrength: Number(event.target.value) }))} />
            </label>
            <label>
              <span>Seed</span>
              <input value={videoParams.seed} onChange={(event) => setVideoParams((current) => ({ ...current, seed: event.target.value }))} placeholder="可选" />
            </label>
          </div>
          <div className="ai-frame-grid">
            <label>
              <span>图片参考</span>
              <input type="file" accept="image/*" onChange={(event) => uploadFiles(event.currentTarget.files, "videoImage")} />
              {videoFrameUploads.image ? <small>{videoFrameUploads.image.name}</small> : null}
            </label>
            <label>
              <span>首帧图片</span>
              <input type="file" accept="image/*" onChange={(event) => uploadFiles(event.currentTarget.files, "videoFirst")} />
              {videoFrameUploads.first ? <small>{videoFrameUploads.first.name}</small> : null}
            </label>
            <label>
              <span>尾帧图片</span>
              <input type="file" accept="image/*" onChange={(event) => uploadFiles(event.currentTarget.files, "videoLast")} />
              {videoFrameUploads.last ? <small>{videoFrameUploads.last.name}</small> : null}
            </label>
          </div>
          <label className="ai-wide-field">
            <span>多张参考图</span>
            <input type="file" accept="image/*" multiple onChange={(event) => uploadFiles(event.currentTarget.files, "videoRefs")} />
            {videoReferenceUploads.length ? (
              <div className="ai-upload-list">
                {videoReferenceUploads.map((item) => (
                  <span key={item.url}>
                    <img src={item.url} alt={item.name} />
                    {item.name}
                    <button type="button" onClick={() => setVideoReferenceUploads((current) => current.filter((upload) => upload.url !== item.url))}>移除</button>
                  </span>
                ))}
              </div>
            ) : null}
          </label>
          <div className="ai-frame-grid">
            <label>
              <span>镜头控制</span>
              <input value={videoParams.cameraControl} onChange={(event) => setVideoParams((current) => ({ ...current, cameraControl: event.target.value }))} placeholder="例如 push in / pan left" />
            </label>
            <label>
              <span>负向提示词</span>
              <input value={videoParams.negativePrompt} onChange={(event) => setVideoParams((current) => ({ ...current, negativePrompt: event.target.value }))} placeholder="避免出现的内容" />
            </label>
          </div>
          <button className="sync-button" type="submit" disabled={busy === "video"}>
            {busy === "video" ? "提交中" : "生成视频"}
          </button>
          {videoTask ? (
            <div className="ai-video-status">
              <span>任务：{videoTask}</span>
              <span>状态：{videoStatus || "处理中"}</span>
              {!videoUrl ? (
                <button className="ghost-button" type="button" onClick={() => pollVideo()} disabled={busy === "poll"}>
                  {busy === "poll" ? "查询中" : "查询结果"}
                </button>
              ) : null}
            </div>
          ) : null}
          {videoUrl ? <video className="ai-video-result" src={videoUrl} controls playsInline /> : null}
        </form>
        ) : null}
      </section>

      {admin ? (
        <section className="panel ai-config-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Admin Config</p>
              <h2>AI 配置</h2>
            </div>
            <span className={`status-pill ${aiConfig?.configured ? "good" : "warning"}`}>
              {aiConfig?.configured ? `已配置 ${aiConfig.apiKeyMasked}` : "未配置"}
            </span>
          </div>
          <form className="ai-config-form" onSubmit={saveConfig}>
            <label>
              <span>API Key</span>
              <input value={configForm.apiKey} onChange={(event) => setConfigForm((current) => ({ ...current, apiKey: event.target.value }))} placeholder={aiConfig?.configured ? "留空则不修改现有 Key" : "请输入 Agnes AI API Key"} type="password" />
            </label>
            <label>
              <span>Base URL</span>
              <input value={configForm.baseUrl} onChange={(event) => setConfigForm((current) => ({ ...current, baseUrl: event.target.value }))} />
            </label>
            <label>
              <span>文本模型</span>
              <input value={configForm.textModel} onChange={(event) => setConfigForm((current) => ({ ...current, textModel: event.target.value }))} />
            </label>
            <label>
              <span>图片模型</span>
              <input value={configForm.imageModel} onChange={(event) => setConfigForm((current) => ({ ...current, imageModel: event.target.value }))} />
            </label>
            <label>
              <span>视频模型</span>
              <input value={configForm.videoModel} onChange={(event) => setConfigForm((current) => ({ ...current, videoModel: event.target.value }))} />
            </label>
            <button className="sync-button" type="submit" disabled={busy === "config"}>
              <KeyRound size={16} />
              {busy === "config" ? "保存中" : "保存配置"}
            </button>
          </form>
        </section>
      ) : null}
    </main>
  );
}

function WarehouseInfoLibrary({
  warehouseInfoPayload,
  onSyncWarehouseInfo,
  syncing,
}: {
  warehouseInfoPayload: WarehouseInfoPayload | null;
  onSyncWarehouseInfo: () => Promise<void>;
  syncing: boolean;
}) {
  const records = warehouseInfoPayload?.warehouseInfo ?? [];
  const [selectedId, setSelectedId] = React.useState(records[0]?.id || "");
  const [keyword, setKeyword] = React.useState("");
  const [copiedAddressKey, setCopiedAddressKey] = React.useState("");
  const filteredRecords = records.filter((item) => {
    const text = [item.tongzhouSerialNo, item.warehouseName, item.countryRegion, item.warehouseCode, item.shopShippingAddress, item.shopReturnAddress, item.firstMileReceivingAddress, item.timezone, item.remark]
      .join(" ")
      .toLowerCase();
    return text.includes(keyword.trim().toLowerCase());
  });
  const selectedRecord = filteredRecords.find((item) => item.id === selectedId) || filteredRecords[0] || records[0];

  React.useEffect(() => {
    if (!selectedId && records[0]?.id) {
      setSelectedId(records[0].id);
      return;
    }
    if (selectedId && !records.some((item) => item.id === selectedId) && records[0]?.id) {
      setSelectedId(records[0].id);
    }
  }, [records, selectedId]);

  async function handleCopyAddress(key: string, value: string) {
    await copyText(value);
    setCopiedAddressKey(key);
    window.setTimeout(() => {
      setCopiedAddressKey((currentKey) => currentKey === key ? "" : currentKey);
    }, 1400);
  }

  return (
    <main className="library-page">
      <section className="qualification-panel warehouse-info-panel">
        <div className="qualification-head">
          <div>
            <p className="eyebrow">Warehouse Info</p>
            <h3>仓库信息</h3>
            <span>
              来自同舟供应链数智化系统，已同步 {formatNumber(warehouseInfoPayload?.counts.records || 0)} 条记录，覆盖 {formatNumber(warehouseInfoPayload?.counts.warehouses || 0)} 个仓库。
            </span>
          </div>
          <button className="sync-button" type="button" onClick={onSyncWarehouseInfo} disabled={syncing}>
            <RefreshCw size={16} className={syncing ? "spinning" : ""} />
            同步仓库信息
          </button>
        </div>

        <div className="warehouse-info-toolbar">
          <label className="catalog-search large">
            <Search size={17} />
            <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索仓库名称、国家/地区、仓库代码、地址" />
          </label>
          <span className={`status-pill ${warehouseInfoPayload?.source === "jiandaoyun" ? "good" : "warning"}`}>
            {warehouseInfoPayload?.source === "jiandaoyun" ? "系统已同步" : "等待同步"}
          </span>
        </div>

        <div className="warehouse-info-layout">
          <div className="warehouse-info-list">
            {filteredRecords.length ? filteredRecords.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`warehouse-info-item ${selectedRecord?.id === item.id ? "active" : ""}`}
                onClick={() => setSelectedId(item.id)}
              >
                <strong>{item.warehouseName || "未配置仓库"}</strong>
                <span>{item.countryRegion || "未配置国家/地区"}</span>
                <small>{item.warehouseCode || item.tongzhouSerialNo || "未配置仓库代码"}</small>
              </button>
            )) : (
              <div className="stockup-empty">暂无仓库信息。请先同步同舟供应链数智化系统。</div>
            )}
          </div>

          <div className="warehouse-info-detail">
            {selectedRecord ? (
              <>
                <section className="warehouse-info-card">
                  <div className="detail-section-head">
                    <Truck size={18} />
                    <div>
                      <h3>{selectedRecord.warehouseName}</h3>
                      <span>{selectedRecord.countryRegion || selectedRecord.warehouseCode || selectedRecord.tongzhouSerialNo}</span>
                    </div>
                  </div>
                  <dl className="warehouse-info-grid">
                    {selectedRecord.details.map((item) => {
                      const isCopyableAddress = isWarehouseAddressValue(selectedRecord, item.value);
                      const copied = copiedAddressKey === item.label;
                      return (
                        <div key={item.label} className={isCopyableAddress ? "copyable-address-field" : ""}>
                          <dt>
                            {item.label}
                            {isCopyableAddress ? (
                              <button
                                className={`copy-field-button ${copied ? "copied" : ""}`}
                                type="button"
                                onClick={() => handleCopyAddress(item.label, item.value)}
                                aria-label={`复制${item.label}`}
                              >
                                {copied ? <Check size={13} /> : <Copy size={13} />}
                                <span>{copied ? "已复制" : "复制"}</span>
                              </button>
                            ) : null}
                          </dt>
                          <dd>{item.value}</dd>
                        </div>
                      );
                    })}
                  </dl>
                </section>

                <WarehouseWorkScene record={selectedRecord} />
              </>
            ) : (
              <div className="stockup-empty">请选择一条仓库信息。</div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function WarehouseWorkScene({ record }: { record: WarehouseInfoRecord }) {
  const working = isWarehouseWorking(record);
  const localMinutes = minutesInWarehouseTimezone(record.timezone);
  const localTime = `${String(Math.floor(localMinutes / 60)).padStart(2, "0")}:${String(localMinutes % 60).padStart(2, "0")}`;
  const videoSrc = working ? "/warehouse-videos/warehouse-working.mp4" : "/warehouse-videos/warehouse-resting.mp4";

  return (
    <aside className={`warehouse-animation-placeholder warehouse-work-scene ${working ? "working" : "resting"}`} aria-label="仓库工作状态动画">
      <div className="warehouse-scene-status">
        <span className={`status-pill ${working ? "good" : "muted"}`}>{working ? "仓库工作中" : "仓库休息中"}</span>
        <small>{record.timezone || "本地时区"} · 当前 {localTime}</small>
      </div>

      <div className="warehouse-video-frame">
        <video
          key={videoSrc}
          className="warehouse-status-video"
          src={videoSrc}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-label={working ? "仓库上班状态视频" : "仓库休息状态视频"}
        />
      </div>

      <strong>{working ? "仓库工作中" : "仓库休息中"}</strong>
      <small>
        上班时间 {record.workStartTime || "未配置"} - {record.workEndTime || "未配置"}。
      </small>
    </aside>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
