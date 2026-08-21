import React from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  ArrowUp,
  ArrowUpRight,
  BarChart3,
  BellRing,
  Bot,
  Boxes,
  CalendarDays,
  ChevronDown,
  Check,
  Calculator,
  Copy,
  DatabaseZap,
  Download,
  ExternalLink,
  FileText,
  Grid2X2,
  Globe2,
  Image,
  KeyRound,
  LayoutDashboard,
  List,
  Lock,
  LogOut,
  Menu,
  Minus,
  PackageCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Store,
  Trash2,
  Video,
  Truck,
  X,
} from "lucide-react";
import {
  AiConfigPayload,
  AiChatAttachment,
  AiChatMessage,
  ActionLogPayload,
  AgentApiKey,
  AssetPayload,
  AssetRecord,
  AuthUser,
  CatalogProduct,
  DistributorApplicationPayload,
  InventorySnapshotPayload,
  MovementComparisonPayload,
  MovementComparisonPeriod,
  MovementHistoryPayload,
  MovementWarehouseDiagnostic,
  MovementPayload,
  MiaoshouPayload,
  MiaoshouScope,
  OrderAnalysisPayload,
  OrderSyncJob,
  ProductBase,
  ProductPayload,
  QuickNavPayload,
  QualificationPayload,
  QualificationRecord,
  StockupPayload,
  StockupCostPreview,
  StockupWorkflowPayload,
  UserManagementPayload,
  WecomNotificationPayload,
  WecomRobot,
  WecomSchedule,
  WecomSceneConfig,
  WarehousePayload,
  WarehouseInfoPayload,
  WarehouseInfoRecord,
  DashboardSummaryPayload,
  acceptStockupRecommendation,
  abandonStockupRecommendation,
  restoreStockupRecommendation,
  createStockupPlan,
  createShipmentFee,
  createStockupCostBatches,
  createWorkflowDemand,
  createWorkflowExecution,
  createWorkflowShipment,
  confirmWorkflowWmsPush,
  cancelWorkflowExecution,
  completeWorkflowProductCoding,
  rollbackWorkflowExecutionLine,
  updateWorkflowExecutionLine,
  voidWorkflowShipment,
  createWarehouseConnection,
  createQuickNavCategory,
  createQuickNavLink,
  createAgentApiKey,
  createUser,
  deleteWecomRobot,
  deleteWecomSchedule,
  deleteQuickNavCategory,
  deleteQuickNavLink,
  captureInventorySnapshot,
  captureMovementHistory,
  deleteUser,
  deleteWarehouseConnection,
  exportWarehouseConnections,
  fetchAssets,
  fetchActionLog,
  fetchAgentApiKeys,
  fetchCurrentUser,
  fetchDashboardSummary,
  fetchDistributorApplications,
  fetchInventorySnapshots,
  fetchMovement,
  fetchMovementComparison,
  fetchMovementHistory,
  fetchLatestOrderSyncJob,
  fetchMiaoshou,
  fetchOrderAnalysis,
  fetchProducts,
  fetchMiaoshouWaybill,
  fetchQuickNav,
  fetchQualifications,
  fetchSetupStatus,
  fetchStockup,
  fetchStockupWorkflow,
  fetchUsers,
  fetchWarehouses,
  fetchWecomNotifications,
  fetchWarehouseInfo,
  getStoredUser,
  importWarehouseConnections,
  initializeAdmin,
  downloadInventorySnapshotCsv,
  downloadMovementHistoryCsv,
  loginInternal,
  lockStockupCostVersion,
  logoutInternal,
  previewStockupCost,
  qualificationFileDownloadUrl,
  revokeAgentApiKey,
  syncAssets,
  syncOutsourcingOrders,
  syncOrders,
  startOrderSyncJob,
  submitDistributorApplication,
  syncProducts,
  syncQualifications,
  syncStockupOrders,
  syncWarehouses,
  syncWarehouseInfo,
  testWarehouseConnection,
  testMiaoshouConnection,
  testWecomNotification,
  updateDistributorApplicationStatus,
  updateOrderShopAlias,
  updateStockupPlanStatus,
  updateUserStatus,
  updateWarehouseConnection,
  updateMiaoshouConfig,
  updateMiaoshouShop,
  syncMiaoshouShops,
  runMiaoshouAutomation,
  retryMiaoshouTask,
  updateWecomScenes,
  upsertWecomRobot,
  upsertWecomSchedule,
  fetchAiConfig,
  fetchAiVideoStatus,
  runAiImage,
  runAiText,
  runAiVideo,
  sendWecomOperatingSummary,
  resolveApiUrl,
  streamAiText,
  updateAiConfig,
  uploadAiImage,
} from "./api";
import "./styles.css";

type AlertType = "补货" | "断货" | "健康" | "滞销";
type MovementSortKey = "sku" | "country" | "availableQty" | "sales3" | "sales7" | "sales15" | "sales30" | "sales60" | "sales90" | "avgDaily7" | "daysCover" | "status";
type SortDirection = "asc" | "desc";
type HeatmapPeriod = "day" | "week" | "month";
type MovementFilterPreset = {
  id: string;
  name: string;
  country: string;
  warehouse: string;
  status: string;
  keyword: string;
  createdAt: string;
};
type BundleSkuItem = {
  product: CatalogProduct;
  quantity: number;
};
const ALL_RECORDS = "__all__";
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

const navSections = [
  { id: "operations", label: "运营分析" },
  { id: "supply", label: "商品与协同" },
  { id: "intelligence", label: "智能与开放" },
  { id: "governance", label: "系统管理" },
];

const navItems = [
  { label: "经营总览", icon: LayoutDashboard, hash: "#dashboard", section: "operations" },
  { label: "库存同步", icon: DatabaseZap, hash: "#inventory", section: "operations" },
  { label: "库存快照", icon: Boxes, hash: "#inventory-snapshots", section: "operations" },
  { label: "订单分析", icon: FileText, hash: "#order-analysis", section: "operations" },
  { label: "动销监控", icon: BarChart3, hash: "#movement", section: "operations" },
  { label: "动销分析", icon: CalendarDays, hash: "#movement-analysis", section: "operations" },
  { label: "备货中心", icon: PackageCheck, hash: "#stockup", section: "supply" },
  { label: "产品库", icon: ShoppingBag, hash: "#products", section: "supply" },
  { label: "资质库", icon: FileText, hash: "#qualifications", section: "supply", childOf: "产品库" },
  { label: "素材库", icon: Boxes, hash: "#assets", section: "supply", childOf: "产品库" },
  { label: "仓库信息", icon: Truck, hash: "#warehouse-info", section: "supply", childOf: "产品库" },
  { label: "快捷导航", icon: Globe2, hash: "#quick-nav", section: "intelligence" },
  { label: "同舟AI", icon: Bot, hash: "#tongzhou-ai", section: "intelligence", beta: true },
  { label: "API 接入", icon: KeyRound, hash: "#api-access", section: "intelligence" },
  { label: "妙手 ERP", icon: Store, hash: "#miaoshou", section: "intelligence" },
  { label: "仓库授权", icon: ShieldCheck, hash: "#warehouses", section: "governance" },
  { label: "用户管理", icon: Lock, hash: "#users", section: "governance" },
  { label: "企业微信通知", icon: BellRing, hash: "#wecom-notifications", section: "governance" },
  { label: "操作日志", icon: List, hash: "#action-log", section: "governance" },
];

const viewHashMap = Object.fromEntries(navItems.map((item) => [item.hash, item.label]));
viewHashMap["#orders"] = "经营总览";

function getInitialView() {
  return viewHashMap[window.location.hash] ?? "经营总览";
}

function hashForView(view: string) {
  return navItems.find((item) => item.label === view)?.hash ?? "#dashboard";
}

function visibleNavItems(user: AuthUser) {
  if (canManage(user)) return navItems;
  if (canViewPartnerAssets(user)) {
    return navItems.filter((item) => ["产品库", "资质库", "素材库", "仓库信息", "快捷导航", "同舟AI", "API 接入"].includes(item.label));
  }
  return navItems.filter((item) => ["产品库", "快捷导航", "同舟AI", ...(user.role === "guest" ? [] : ["API 接入"])].includes(item.label));
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

function daysSince(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

function syncAgeText(value?: string) {
  const days = daysSince(value);
  if (days === null) return "未同步";
  if (days === 0) return "今日已更新";
  return `${days} 天前`;
}

function nextAutoSyncText(lastAutoSyncAt?: string, intervalMs?: number) {
  if (!intervalMs || intervalMs <= 0) return "未配置";
  if (!lastAutoSyncAt) return "等待首次自动同步";
  const last = new Date(lastAutoSyncAt);
  if (Number.isNaN(last.getTime())) return "等待首次自动同步";
  const next = new Date(last.getTime() + intervalMs);
  if (next.getTime() <= Date.now()) return "到点后自动触发";
  return formatDateTime(next.toISOString());
}

const MOVEMENT_FILTER_PRESETS_KEY = "tongzhou:movement-filter-presets";

function readMovementFilterPresets(): MovementFilterPreset[] {
  try {
    const raw = window.localStorage.getItem(MOVEMENT_FILTER_PRESETS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        id: String(item.id || ""),
        name: String(item.name || ""),
        country: String(item.country || "全部"),
        warehouse: String(item.warehouse || "全部"),
        status: String(item.status || "全部"),
        keyword: String(item.keyword || ""),
        createdAt: String(item.createdAt || ""),
      }))
      .filter((item) => item.id && item.name)
      .slice(0, 12);
  } catch {
    return [];
  }
}

function saveMovementFilterPresets(presets: MovementFilterPreset[]) {
  window.localStorage.setItem(MOVEMENT_FILTER_PRESETS_KEY, JSON.stringify(presets.slice(0, 12)));
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
  return user.role === "admin";
}

function canViewPartnerAssets(user: AuthUser) {
  return user.role === "admin" || user.role === "direct" || user.role === "distributor";
}

function canViewPrices(user: AuthUser) {
  return user.role === "admin" || user.role === "direct" || user.role === "distributor";
}

function canViewInventory(user: AuthUser) {
  return user.role === "admin" || user.role === "direct" || user.role === "distributor";
}

function canViewInternalCatalog(user: AuthUser) {
  return user.role === "admin" || user.role === "direct";
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
  const fallbackPrice = product.channel === "直营"
    ? product.directPrice ?? product.distributionPrice ?? 0
    : product.distributionPrice ?? product.directPrice ?? 0;
  return {
    price: product.salesPrice ?? fallbackPrice,
    currency: product.salesCurrency || (product.channel === "直营" ? product.directCurrency : product.distributionCurrency) || product.distributionCurrency,
    label: "销售价",
  };
}

function bundleSkuProductCode(product: CatalogProduct) {
  return product.sku || product.skuNo || product.id;
}

function bundleSkuCode(items: BundleSkuItem[]) {
  return items.map((item) => `${bundleSkuProductCode(item.product)}*${Math.max(1, item.quantity)}`).join("+");
}

function bundleTotals(items: BundleSkuItem[], channel: "全部" | "直营" | "分销", internal: boolean) {
  const costCurrency = priceFor(items[0]?.product || fallbackCatalog[0], channel, internal).currency;
  const salesCurrency = salesPriceFor(items[0]?.product || fallbackCatalog[0]).currency;
  return items.reduce(
    (totals, item) => {
      const quantity = Math.max(1, item.quantity);
      totals.cost += priceFor(item.product, channel, internal).price * quantity;
      totals.sales += salesPriceFor(item.product).price * quantity;
      return totals;
    },
    { cost: 0, sales: 0, costCurrency, salesCurrency },
  );
}

function csvCell(value: string | number | undefined | null) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function bundleQuoteCsv(items: BundleSkuItem[], channel: Parameters<typeof bundleTotals>[1], internal: boolean, showPrices: boolean) {
  const header = ["SKU", "产品名称", "国家", "数量", "成本币种", "成本单价", "成本小计", "销售币种", "销售单价", "销售小计"];
  const rows = items.map((item) => {
    const cost = priceFor(item.product, channel, internal);
    const sales = salesPriceFor(item.product);
    const quantity = Math.max(1, item.quantity);
    return [
      bundleSkuProductCode(item.product),
      item.product.name,
      item.product.country,
      quantity,
      showPrices ? cost.currency : "",
      showPrices ? formatMoney(cost.price) : "",
      showPrices ? formatMoney(cost.price * quantity) : "",
      showPrices ? sales.currency : "",
      showPrices ? formatMoney(sales.price) : "",
      showPrices ? formatMoney(sales.price * quantity) : "",
    ];
  });
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function downloadTextFile(fileName: string, text: string, type = "text/plain;charset=utf-8") {
  const blob = new Blob(["\uFEFF", text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

type ConfirmOptions = {
  title: string;
  body: string;
  confirmText?: string;
  cancelText?: string;
  tone?: "danger" | "warning";
  details?: string[];
};

type ConfirmRequest = ConfirmOptions & {
  resolve: (confirmed: boolean) => void;
};

const ConfirmContext = React.createContext<(options: ConfirmOptions) => Promise<boolean>>(async () => false);
const sidebarCollapsedStorageKey = "tongzhou_sidebar_collapsed";

function useConfirm() {
  return React.useContext(ConfirmContext);
}

function getStoredSidebarCollapsed() {
  try {
    return localStorage.getItem(sidebarCollapsedStorageKey) === "true";
  } catch {
    return false;
  }
}

function ConfirmDialog({ request, onClose }: { request: ConfirmRequest | null; onClose: (confirmed: boolean) => void }) {
  if (!request) return null;
  return (
    <div className="confirm-layer" role="dialog" aria-modal="true" aria-label={request.title}>
      <button className="confirm-backdrop" type="button" aria-label="取消操作" onClick={() => onClose(false)} />
      <section className={`confirm-dialog ${request.tone || "warning"}`}>
        <div className="confirm-icon">
          <AlertTriangle size={22} />
        </div>
        <div className="confirm-content">
          <p className="eyebrow">{request.tone === "danger" ? "High Impact Action" : "Confirm Action"}</p>
          <h2>{request.title}</h2>
          <p>{request.body}</p>
          {request.details?.length ? (
            <ul>
              {request.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ) : null}
          <div className="confirm-actions">
            <button className="ghost-button" type="button" onClick={() => onClose(false)}>{request.cancelText || "取消"}</button>
            <button className={`sync-button ${request.tone === "danger" ? "danger-button" : ""}`} type="button" onClick={() => onClose(true)}>{request.confirmText || "确认"}</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function App() {
  const [activeView, setActiveView] = React.useState(getInitialView);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(getStoredSidebarCollapsed);
  const [payload, setPayload] = React.useState<ProductPayload | null>(null);
  const [dashboardSummary, setDashboardSummary] = React.useState<DashboardSummaryPayload | null>(null);
  const [productDetailLoaded, setProductDetailLoaded] = React.useState(false);
  const [warehousePayload, setWarehousePayload] = React.useState<WarehousePayload | null>(null);
  const [inventorySnapshotPayload, setInventorySnapshotPayload] = React.useState<InventorySnapshotPayload | null>(null);
  const [movementPayload, setMovementPayload] = React.useState<MovementPayload | null>(null);
  const [movementHistoryPayload, setMovementHistoryPayload] = React.useState<MovementHistoryPayload | null>(null);
  const [orderAnalysisPayload, setOrderAnalysisPayload] = React.useState<OrderAnalysisPayload | null>(null);
  const [orderSyncJob, setOrderSyncJob] = React.useState<OrderSyncJob | null>(null);
  const [movementWarehouseFilter, setMovementWarehouseFilter] = React.useState("");
  const [stockupPayload, setStockupPayload] = React.useState<StockupPayload | null>(null);
  const [stockupWorkflowPayload, setStockupWorkflowPayload] = React.useState<StockupWorkflowPayload | null>(null);
  const [qualificationPayload, setQualificationPayload] = React.useState<QualificationPayload | null>(null);
  const [assetPayload, setAssetPayload] = React.useState<AssetPayload | null>(null);
  const [warehouseInfoPayload, setWarehouseInfoPayload] = React.useState<WarehouseInfoPayload | null>(null);
  const [quickNavPayload, setQuickNavPayload] = React.useState<QuickNavPayload | null>(null);
  const [aiConfigPayload, setAiConfigPayload] = React.useState<AiConfigPayload | null>(null);
  const [wecomNotificationPayload, setWecomNotificationPayload] = React.useState<WecomNotificationPayload | null>(null);
  const [actionLogPayload, setActionLogPayload] = React.useState<ActionLogPayload | null>(null);
  const [userPayload, setUserPayload] = React.useState<UserManagementPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [syncing, setSyncing] = React.useState(false);
  const [error, setError] = React.useState("");
  const [currentUser, setCurrentUser] = React.useState<AuthUser>(getStoredUser);
  const [blockedView, setBlockedView] = React.useState("");
  const [globalSearch, setGlobalSearch] = React.useState("");
  const [productSearchKeyword, setProductSearchKeyword] = React.useState("");
  const [confirmRequest, setConfirmRequest] = React.useState<ConfirmRequest | null>(null);
  const internal = canViewInternalCatalog(currentUser);

  const catalog = payload?.catalog?.length ? payload.catalog : fallbackCatalog;
  const totalInventory = dashboardSummary?.counts.totalInventory ?? catalog.reduce((sum, product) => sum + product.stockQty, 0);
  const totalOrders = dashboardSummary?.counts.todayOrders ?? 0;
  const salesAmount = dashboardSummary?.counts.salesAmount90 ?? 0;
  const riskCount = dashboardSummary?.counts.riskSku ?? catalog.filter((product) => product.alert !== "健康").length;

  React.useEffect(() => {
    try {
      localStorage.setItem(sidebarCollapsedStorageKey, String(sidebarCollapsed));
    } catch {
      // Ignore storage failures so navigation still works in private contexts.
    }
  }, [sidebarCollapsed]);

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
    loadDashboardSummary();
    if (canManage(currentUser)) {
      loadWarehouses();
      loadInventorySnapshots();
      loadOrderAnalysis();
      loadMovement();
      loadMovementHistory();
      loadStockup();
      loadDashboardSummary();
      loadUsers();
      loadWecomNotifications();
      loadActionLog();
    }
    loadQuickNav();
    loadAiConfig();
    if (canViewPartnerAssets(currentUser)) {
      loadQualifications();
      loadAssets();
      loadWarehouseInfo();
    }
  }, [currentUser.role]);

  React.useEffect(() => {
    const allowed = visibleNavItems(currentUser).some((item) => item.label === activeView);
    if (allowed) return;
    if (activeView !== "产品库") setBlockedView(activeView);
    handleViewChange("产品库", { clearBlocked: false });
  }, [currentUser.role, activeView]);

  React.useEffect(() => {
    if (!canManage(currentUser)) return;
    if (hashForView(activeView) !== "#stockup") return;
    void loadStockup();
    void loadStockupWorkflow();
  }, [activeView, currentUser.role]);

  React.useEffect(() => {
    if (!canManage(currentUser)) return;
    if (hashForView(activeView) !== "#action-log") return;
    void loadActionLog();
  }, [activeView, currentUser.role]);

  React.useEffect(() => {
    if (!["资质库", "素材库", "仓库信息"].includes(activeView)) return;
    if (!canViewPartnerAssets(currentUser)) return;
    void loadProductDetails();
  }, [activeView, currentUser.role, productDetailLoaded]);

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      void loadProducts(true);
      void loadDashboardSummary();
      void loadQuickNav();
      void loadAiConfig();
      if (canViewPartnerAssets(currentUser)) {
        void loadQualifications();
        void loadAssets();
        void loadWarehouseInfo();
      }
      if (canManage(currentUser)) {
        void loadWarehouses();
        void loadInventorySnapshots();
        void loadOrderAnalysis();
        void loadMovement();
        void loadMovementHistory();
        void loadStockup();
        void loadDashboardSummary();
        void loadUsers();
        void loadWecomNotifications();
        void loadActionLog();
      }
    }, AUTO_SYNC_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [currentUser.role]);

  React.useEffect(() => {
    if (!canManage(currentUser)) return;
    if (!orderSyncJob || !["queued", "running"].includes(orderSyncJob.status)) return;
    const timer = window.setInterval(async () => {
      const job = await loadLatestOrderJob();
      if (job && !["queued", "running"].includes(job.status)) {
        await Promise.all([loadMovement(), loadMovementHistory(), loadOrderAnalysis(), loadDashboardSummary(), loadStockup()]);
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [currentUser.role, orderSyncJob?.id, orderSyncJob?.status]);

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
      const data = await fetchProducts(productDetailLoaded ? "detail" : "list");
      setPayload(data);
      setProductDetailLoaded(data.mode === "detail");
      if (data.user) setCurrentUser(data.user);
    } catch (requestError) {
      if (!silent) setError(requestError instanceof Error ? requestError.message : "产品数据读取失败");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function loadProductDetails() {
    if (productDetailLoaded) return;
    try {
      const data = await fetchProducts("detail");
      setPayload(data);
      setProductDetailLoaded(true);
      if (data.user) setCurrentUser(data.user);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "产品详情数据读取失败");
    }
  }

  async function loadDashboardSummary() {
    try {
      const data = await fetchDashboardSummary();
      setDashboardSummary(data);
      if (data.user) setCurrentUser(data.user);
    } catch {
      setDashboardSummary(null);
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
      if (data.orderSyncJob) setOrderSyncJob(data.orderSyncJob);
    } catch {
      setMovementPayload(null);
    }
  }

  async function loadMovementHistory(input: { date?: string; from?: string; to?: string; warehouseId?: string; sku?: string; timezone?: string } = {}) {
    try {
      const data = await fetchMovementHistory(input);
      setMovementHistoryPayload(data);
    } catch {
      setMovementHistoryPayload(null);
    }
  }

  async function loadOrderAnalysis(input: { dateFrom?: string; dateTo?: string; country?: string; warehouseId?: string; platform?: string; shopName?: string; projectGroup?: string; keyword?: string; scope?: "russia" | "all" } = {}) {
    try {
      const data = await fetchOrderAnalysis(input);
      setOrderAnalysisPayload(data);
    } catch {
      setOrderAnalysisPayload(null);
    }
  }

  async function loadLatestOrderJob() {
    try {
      const data = await fetchLatestOrderSyncJob();
      setOrderSyncJob(data.job);
      return data.job;
    } catch {
      return null;
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

  async function loadStockupWorkflow() {
    try {
      const data = await fetchStockupWorkflow();
      setStockupWorkflowPayload(data);
      return data;
    } catch (requestError) {
      setStockupWorkflowPayload(null);
      throw requestError;
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

  async function loadWecomNotifications() {
    try {
      const data = await fetchWecomNotifications();
      setWecomNotificationPayload(data);
    } catch {
      setWecomNotificationPayload(null);
    }
  }

  async function loadActionLog() {
    try {
      const data = await fetchActionLog();
      setActionLogPayload(data);
    } catch {
      setActionLogPayload(null);
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
      await Promise.all([loadDashboardSummary(), loadMovement(), loadOrderAnalysis(), loadStockup(), loadQualifications(), loadAssets(), loadWarehouseInfo(), loadQuickNav(), loadAiConfig(), loadWecomNotifications(), loadActionLog()]);
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
      await Promise.all([loadDashboardSummary(), loadWarehouses(), loadInventorySnapshots(), loadProducts(), loadMovement(), loadOrderAnalysis(), loadStockup()]);
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

  async function handleOrderSync(warehouseIds: string[] = []) {
    setSyncing(true);
    setError("");
    try {
      const data = await startOrderSyncJob({ days: 90, warehouseIds });
      setOrderSyncJob(data.job);
      await Promise.all([loadDashboardSummary(), loadMovement(), loadOrderAnalysis(), loadStockup()]);
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
      await Promise.all([loadDashboardSummary(), loadStockupWorkflow()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "备货单明细同步失败");
    } finally {
      setSyncing(false);
    }
  }

  async function handleStockupDecision(item: StockupPayload["recommendations"][number], action: "accept" | "abandon" | "restore") {
    setSyncing(true);
    setError("");
    try {
      const input = { recommendationKey: item.recommendationKey, recommendation: item };
      const data = action === "accept"
        ? await acceptStockupRecommendation(input)
        : action === "restore"
          ? await restoreStockupRecommendation(input)
          : await abandonStockupRecommendation(input);
      setStockupPayload(data);
      if (action === "accept") await loadStockupWorkflow();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "更新备货建议状态失败");
    } finally {
      setSyncing(false);
    }
  }

  async function handleCreateStockupPlan(item: StockupPayload["recommendations"][number], input: { quantity: number; planType: "purchase" | "outsourcing"; owner: string; expectedArrivalAt: string; note: string }) {
    setSyncing(true);
    setError("");
    try {
      const data = await createStockupPlan({
        recommendationKey: item.recommendationKey,
        recommendation: item,
        ...input,
      });
      setStockupPayload(data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "创建备货计划失败");
      throw requestError;
    } finally {
      setSyncing(false);
    }
  }

  async function handleUpdateStockupPlanStatus(id: string, status: Parameters<typeof updateStockupPlanStatus>[1]) {
    setSyncing(true);
    setError("");
    try {
      const data = await updateStockupPlanStatus(id, status);
      setStockupPayload(data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "更新备货计划状态失败");
      throw requestError;
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

  async function handleTestWarehouse(input: Parameters<typeof testWarehouseConnection>[0]) {
    setError("");
    try {
      const result = await testWarehouseConnection(input);
      if (result.warehouses) {
        setWarehousePayload((current) => current ? { ...current, warehouses: result.warehouses || current.warehouses } : current);
      }
      return result;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "浠撳簱杩炴帴妫€娴嬪け璐?");
      throw requestError;
    }
  }

  async function handleDeleteWarehouse(id: string) {
    setError("");
    try {
      await deleteWarehouseConnection(id);
      await Promise.all([loadWarehouses(), loadProducts(), loadMovement(), loadOrderAnalysis(), loadStockup()]);
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

  async function activateLoggedInUser(user: AuthUser, targetView = blockedView) {
    setCurrentUser(user);
    await loadProducts();
    void loadQuickNav();
    void loadAiConfig();
    if (canViewPartnerAssets(user)) {
      await Promise.all([loadQualifications(), loadAssets(), loadWarehouseInfo(), loadQuickNav(), loadAiConfig()]);
    }
    if (canManage(user)) {
      await Promise.all([loadWarehouses(), loadInventorySnapshots(), loadMovement(), loadOrderAnalysis(), loadStockup(), loadUsers(), loadWecomNotifications(), loadActionLog()]);
    }
    setBlockedView("");
    if (targetView && visibleNavItems(user).some((item) => item.label === targetView)) {
      handleViewChange(targetView);
    } else if (canManage(user)) {
      handleViewChange("经营总览");
    } else {
      handleViewChange("产品库");
    }
  }

  async function handleLogin(input: { username?: string; password?: string; code?: string }) {
    const targetView = blockedView;
    const result = await loginInternal(input);
    await activateLoggedInUser(result.user, targetView);
  }

  async function handleInitialAdmin(input: { username: string; password: string; displayName?: string }) {
    const result = await initializeAdmin(input);
    await activateLoggedInUser(result.user, "经营总览");
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
    setMovementHistoryPayload(null);
    setOrderAnalysisPayload(null);
    setStockupPayload(null);
    setStockupWorkflowPayload(null);
    setUserPayload(null);
    setWecomNotificationPayload(null);
    setActionLogPayload(null);
    setBlockedView("");
  }

  function handleViewChange(view: string, options: { clearBlocked?: boolean } = { clearBlocked: true }) {
    if (options.clearBlocked !== false) setBlockedView("");
    setActiveView(view);
    window.location.hash = hashForView(view);
    setMobileNavOpen(false);
  }

  function handleGlobalSearch(event: React.FormEvent) {
    event.preventDefault();
    const keyword = globalSearch.trim();
    if (!keyword) return;
    setProductSearchKeyword(keyword);
    handleViewChange("产品库");
  }

  const confirmAction = React.useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    setConfirmRequest({ ...options, resolve });
  }), []);

  function closeConfirm(confirmed: boolean) {
    setConfirmRequest((current) => {
      current?.resolve(confirmed);
      return null;
    });
  }

  return (
    <ConfirmContext.Provider value={confirmAction}>
      <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        <Sidebar
          activeView={activeView}
          currentUser={currentUser}
          collapsed={sidebarCollapsed}
          onChange={handleViewChange}
          onClose={() => setMobileNavOpen(false)}
          onToggleCollapse={() => setSidebarCollapsed((value) => !value)}
          open={mobileNavOpen}
        />
        <div className="workspace">
        <header className="topbar">
          <button className="icon-button mobile-only" onClick={() => setMobileNavOpen(true)} aria-label="打开导航">
            <Menu size={20} />
          </button>
          <div>
            <p className="eyebrow">Tongzhou Control Tower</p>
            <h1>{activeView === "产品库" ? "产品中心" : activeView === "资质库" ? "资质库" : activeView === "素材库" ? "素材库" : activeView === "仓库信息" ? "仓库信息" : activeView === "快捷导航" ? "快捷导航" : activeView === "同舟AI" ? "同舟AI" : activeView === "API 接入" ? "API 接入" : activeView === "妙手 ERP" ? "妙手 ERP" : activeView === "企业微信通知" ? "企业微信通知" : activeView === "备货中心" ? "备货中心" : activeView === "用户管理" ? "用户管理" : activeView === "操作日志" ? "操作日志" : "同舟供应链中台"}</h1>
          </div>
          <div className="topbar-actions">
            <form className="search-box" onSubmit={handleGlobalSearch}>
              <Search size={16} />
              <input value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="搜索 SKU、国家、品牌" />
            </form>
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
              <LoginButton onLogin={handleLogin} onSetupAdmin={handleInitialAdmin} />
            )}
          </div>
        </header>

        {error ? <div className="notice danger">{error}</div> : null}
        {payload?.warning ? <div className="notice warning">{payload.warning}</div> : null}
        {blockedView ? (
          <section className="blocked-view-notice" role="status" aria-live="polite">
            <div className="blocked-view-icon">
              <Lock size={18} />
            </div>
            <div className="blocked-view-copy">
              <strong>需要登录后访问「{blockedView}」</strong>
              <span>
                {currentUser.role === "guest"
                  ? "该页面包含库存、价格、动销、备货或系统配置数据。请使用内部访问码登录，或联系运营开通分销账号。"
                  : "当前账号暂时没有该页面权限。如需查看，请联系管理员调整角色或授权范围。"}
              </span>
            </div>
            <div className="blocked-view-actions">
              {currentUser.role === "guest" ? <LoginButton onLogin={handleLogin} onSetupAdmin={handleInitialAdmin} /> : null}
              <button className="ghost-button" type="button" onClick={() => setBlockedView("")}>我知道了</button>
            </div>
          </section>
        ) : null}

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
            externalKeyword={productSearchKeyword}
            onNeedDetails={loadProductDetails}
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
        ) : activeView === "API 接入" ? (
          <AgentApiAccessPage currentUser={currentUser} />
        ) : activeView === "妙手 ERP" ? (
          <MiaoshouPage />
        ) : activeView === "库存快照" ? (
          <InventorySnapshotPage
            inventorySnapshotPayload={inventorySnapshotPayload}
            onLoadInventorySnapshots={loadInventorySnapshots}
            onCaptureInventorySnapshot={handleCaptureInventorySnapshot}
          />
        ) : activeView === "订单分析" ? (
          <OrderAnalysisPage
            payload={orderAnalysisPayload}
            onLoadOrderAnalysis={loadOrderAnalysis}
            onUpdateShopAlias={async (shopName, alias) => {
              await updateOrderShopAlias({ shopName, alias });
              await loadOrderAnalysis(orderAnalysisPayload?.filters ? {
                dateFrom: orderAnalysisPayload.filters.dateFrom,
                dateTo: orderAnalysisPayload.filters.dateTo,
                country: orderAnalysisPayload.filters.country,
                warehouseId: orderAnalysisPayload.filters.warehouseId,
                platform: orderAnalysisPayload.filters.platform,
                shopName: orderAnalysisPayload.filters.shopName,
                projectGroup: orderAnalysisPayload.filters.projectGroup,
                keyword: orderAnalysisPayload.filters.keyword,
                scope: "russia",
              } : { scope: "russia" });
            }}
            onSyncOrders={handleOrderSync}
            syncing={syncing}
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
            onTest={handleTestWarehouse}
          />
        ) : activeView === "动销监控" ? (
          <MovementBoard movementPayload={movementPayload} orderSyncJob={orderSyncJob} initialWarehouse={movementWarehouseFilter} onSyncOrders={handleOrderSync} syncing={syncing} />
        ) : activeView === "动销分析" ? (
          <MovementAnalysisPage
            movementHistoryPayload={movementHistoryPayload}
            onLoadMovementHistory={loadMovementHistory}
            onCaptureMovementHistory={captureMovementHistory}
          />
        ) : activeView === "备货中心" ? (
          <StockupCenter
            stockupPayload={stockupPayload}
            workflowPayload={stockupWorkflowPayload}
            onRefreshWorkflow={loadStockupWorkflow}
            onSyncStockup={handleStockupSync}
            onDecision={handleStockupDecision}
            onCreatePlan={handleCreateStockupPlan}
            onUpdatePlanStatus={handleUpdateStockupPlanStatus}
            syncing={syncing}
          />
        ) : activeView === "企业微信通知" ? (
          <WecomNotificationCenter payload={wecomNotificationPayload} onRefresh={loadWecomNotifications} />
        ) : activeView === "操作日志" ? (
          <ActionLogPage payload={actionLogPayload} onRefresh={loadActionLog} />
        ) : activeView === "用户管理" ? (
          <UserManagement userPayload={userPayload} />
        ) : (
          <Dashboard
            products={catalog}
            payload={payload}
            stockupPayload={stockupPayload}
            wecomNotificationPayload={wecomNotificationPayload}
            internal={internal}
            totalInventory={totalInventory}
            totalOrders={totalOrders}
            salesAmount={salesAmount}
            riskCount={riskCount}
            summary={dashboardSummary}
            onOpenMovement={() => handleViewChange("动销监控")}
            onOpenStockup={() => handleViewChange("备货中心")}
            onOpenWecom={() => handleViewChange("企业微信通知")}
            onOpenMovementWarehouse={(warehouseId) => {
              setMovementWarehouseFilter(warehouseId);
              handleViewChange("动销监控");
            }}
            onOpenWarehouses={() => handleViewChange("仓库授权")}
          />
        )}
        </div>
        <ConfirmDialog request={confirmRequest} onClose={closeConfirm} />
      </div>
    </ConfirmContext.Provider>
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

function LoginButton({
  onLogin,
  onSetupAdmin,
}: {
  onLogin: (input: { username?: string; password?: string; code?: string }) => Promise<void>;
  onSetupAdmin: (input: { username: string; password: string; displayName?: string }) => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<"account" | "code" | "setup">("account");
  const [setupRequired, setSetupRequired] = React.useState(false);
  const [setupChecked, setSetupChecked] = React.useState(false);
  const [username, setUsername] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSetupChecked(false);
    void fetchSetupStatus()
      .then((status) => {
        if (cancelled) return;
        setSetupRequired(status.setupRequired);
        if (status.setupRequired) setMode("setup");
        else setMode((current) => (current === "setup" ? "account" : current));
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "初始化状态检查失败");
      })
      .finally(() => {
        if (!cancelled) setSetupChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (mode === "setup") await onSetupAdmin({ username, password, displayName });
      else await onLogin(mode === "code" ? { code } : { username, password });
      setOpen(false);
      setUsername("");
      setDisplayName("");
      setPassword("");
      setCode("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : mode === "setup" ? "初始化管理员失败" : mode === "code" ? "访问码不正确" : "账号或密码不正确");
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
          <span>{mode === "setup" ? "首次使用，请创建管理员账号" : mode === "account" ? "使用系统账号密码登录" : "使用内部访问码登录"}</span>
          <div className="login-tabs">
            {setupRequired ? (
              <button className="active" type="button">初始化管理员</button>
            ) : (
              <>
                <button className={mode === "account" ? "active" : ""} type="button" onClick={() => setMode("account")}>账号密码</button>
                <button className={mode === "code" ? "active" : ""} type="button" onClick={() => setMode("code")}>访问码</button>
              </>
            )}
          </div>
          {!setupChecked ? <small>正在检查初始化状态...</small> : null}
          {mode === "setup" ? (
            <>
              <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="管理员账号" autoComplete="username" />
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="显示名称" autoComplete="name" />
              <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="管理员密码，至少 8 位" type="password" autoComplete="new-password" />
              <small>初始化只在没有启用的管理员时开放，创建后入口会自动关闭。</small>
            </>
          ) : mode === "account" ? (
            <>
              <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="账号" autoComplete="username" />
              <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="密码" type="password" autoComplete="current-password" />
            </>
          ) : (
            <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="内部访问码" type="password" autoComplete="one-time-code" />
          )}
          {error ? <small>{error}</small> : null}
          <button className="sync-button">{mode === "setup" ? "创建并登录" : "登录"}</button>
        </form>
      ) : null}
    </div>
  );
}

function Sidebar({
  activeView,
  currentUser,
  collapsed,
  onChange,
  onClose,
  onToggleCollapse,
  open,
}: {
  activeView: string;
  currentUser: AuthUser;
  collapsed: boolean;
  onChange: (view: string) => void;
  onClose: () => void;
  onToggleCollapse: () => void;
  open: boolean;
}) {
  const items = visibleNavItems(currentUser);
  const CollapseIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const activeItemRef = React.useRef<HTMLButtonElement | null>(null);
  const [collapsedSections, setCollapsedSections] = React.useState<Set<string>>(() => new Set());

  React.useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeView, open]);

  function toggleSection(sectionId: string) {
    setCollapsedSections((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  return (
    <>
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark">
            <img src="/tongzhou-logo.png" alt="同舟跨境" />
          </div>
          <div>
            <strong>同舟供应链</strong>
            <span>Supply Center</span>
          </div>
          <button className="icon-button close-nav" onClick={onClose} aria-label="关闭导航">
            <X size={18} />
          </button>
          <button
            className="icon-button sidebar-collapse-button"
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
            title={collapsed ? "展开侧边栏" : "折叠侧边栏"}
          >
            <CollapseIcon size={18} />
          </button>
        </div>
        <div className="sidebar-scroll-region">
          <nav aria-label="主导航">
            {navSections.map((section) => {
              const sectionItems = items.filter((item) => item.section === section.id);
              if (!sectionItems.length) return null;
              const sectionCollapsed = collapsedSections.has(section.id);
              return (
                <section className="sidebar-nav-section" key={section.id}>
                  <button
                    className="nav-section-toggle"
                    type="button"
                    onClick={() => toggleSection(section.id)}
                    aria-expanded={!sectionCollapsed}
                  >
                    <span>{section.label}</span>
                    <span className="nav-section-meta">
                      {sectionItems.length}
                      <ChevronDown size={13} className={sectionCollapsed ? "section-collapsed" : ""} />
                    </span>
                  </button>
                  <div className={`sidebar-nav-items ${sectionCollapsed ? "is-collapsed" : ""}`}>
                    {sectionItems.map((item) => {
                      const Icon = item.icon;
                      const active = activeView === item.label;
                      return (
                        <button
                          key={item.label}
                          ref={active ? activeItemRef : undefined}
                          className={`${active ? "active" : ""} ${item.childOf ? "nav-child" : ""}`}
                          onClick={() => onChange(item.label)}
                          title={collapsed ? item.label : undefined}
                        >
                          <Icon size={18} />
                          <span className="nav-label-wrap">
                            {item.beta ? <small>Beta</small> : null}
                            <span>{item.label}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </nav>
          <div className="integration-card">
            <p>同舟供应链</p>
            <strong>同舟供应链数智化系统</strong>
            <span>产品 · 仓库 · 备货协同</span>
          </div>
        </div>
      </aside>
      {open ? <button className="scrim" onClick={onClose} aria-label="关闭导航" /> : null}
    </>
  );
}

function Dashboard({
  products,
  payload,
  stockupPayload,
  wecomNotificationPayload,
  internal,
  totalInventory,
  totalOrders,
  salesAmount,
  riskCount,
  summary,
  onOpenMovement,
  onOpenStockup,
  onOpenWecom,
  onOpenMovementWarehouse,
  onOpenWarehouses,
}: {
  products: CatalogProduct[];
  payload: ProductPayload | null;
  stockupPayload: StockupPayload | null;
  wecomNotificationPayload: WecomNotificationPayload | null;
  internal: boolean;
  totalInventory: number;
  totalOrders: number;
  salesAmount: number;
  riskCount: number;
  summary: DashboardSummaryPayload | null;
  onOpenMovement: () => void;
  onOpenStockup: () => void;
  onOpenWecom: () => void;
  onOpenMovementWarehouse: (warehouseId: string) => void;
  onOpenWarehouses: () => void;
}) {
  const [heatmapPeriod, setHeatmapPeriod] = React.useState<HeatmapPeriod>("day");
  const [attentionCopyMessage, setAttentionCopyMessage] = React.useState("");
  const staleSources = [
    { label: "产品", value: summary?.sync.productsSyncedAt },
    { label: "库存", value: summary?.sync.inventorySyncedAt },
    { label: "订单", value: summary?.sync.orderSyncedAt },
  ].filter((item) => {
    const age = daysSince(item.value);
    return age === null || age >= 2;
  });
  const catalogSkuCount = summary?.counts.visibleCatalog ?? payload?.counts.catalog ?? products.length;
  const movementSkuCount = summary?.counts.movementSku ?? 0;
  const warehouseOnlySkuCount = summary?.counts.warehouseOnlySku ?? 0;
  const productRiskCount = Math.max(0, riskCount - warehouseOnlySkuCount);
  const failedWarehouses = summary?.sync.failedWarehouses ?? [];
  const inventoryIssueWarehouses = (summary?.warehouses ?? []).filter((warehouse) => !warehouse.hasCredentials || !warehouse.inventoryOk);
  const nextAutoSync = nextAutoSyncText(summary?.sync.lastAutoSyncAt, summary?.sync.autoSyncIntervalMs);
  const todayOrderNote = !summary?.sync.orderSyncedAt
    ? "订单未同步，不能判断是否真实为 0"
    : failedWarehouses.length
      ? `${failedWarehouses.length} 个仓库订单失败，今日订单可能不完整`
      : totalOrders === 0
        ? "订单链路已同步，今日暂无出库"
        : "今日 WMS 出库明细已同步";
  const syncHealthRows = [
    {
      id: "products",
      label: "产品目录",
      last: summary?.sync.productsSyncedAt,
      status: payload?.warning ? "有提醒" : summary?.sync.productsSyncedAt ? "正常" : "待同步",
      tone: payload?.warning || !summary?.sync.productsSyncedAt ? "warning" : "good",
      reason: payload?.warning || (summary?.sync.productsSyncedAt ? "产品库缓存可用于当前页面。" : "尚未完成产品目录同步。"),
    },
    {
      id: "inventory",
      label: "仓库库存",
      last: summary?.sync.inventorySyncedAt,
      status: inventoryIssueWarehouses.length ? `${inventoryIssueWarehouses.length} 仓需检查` : summary?.sync.inventorySyncedAt ? "正常" : "待同步",
      tone: inventoryIssueWarehouses.length || !summary?.sync.inventorySyncedAt ? "warning" : "good",
      reason: inventoryIssueWarehouses.length
        ? inventoryIssueWarehouses.slice(0, 3).map((warehouse) => `${warehouse.name}${warehouse.message ? `：${warehouse.message}` : ""}`).join("；")
        : summary?.sync.inventorySyncedAt ? "库存快照已生成。" : "尚未完成仓库库存同步。",
    },
    {
      id: "orders",
      label: "订单出库",
      last: summary?.sync.orderSyncedAt,
      status: failedWarehouses.length ? `${failedWarehouses.length} 仓失败` : summary?.sync.orderSyncedAt ? "正常" : "待同步",
      tone: failedWarehouses.length || !summary?.sync.orderSyncedAt ? "warning" : "good",
      reason: failedWarehouses.length
        ? failedWarehouses.slice(0, 3).map((warehouse) => `${warehouse.warehouseId}${warehouse.message ? `：${warehouse.message}` : ""}`).join("；")
        : todayOrderNote,
    },
  ];
  const wecomRobots = wecomNotificationPayload?.robots ?? [];
  const enabledWecomRobots = wecomRobots.filter((robot) => robot.enabled);
  const enabledWecomSchedules = (wecomNotificationPayload?.schedules ?? []).filter((schedule) => schedule.enabled);
  const enabledWecomScenes = Object.entries(wecomNotificationPayload?.scenes ?? {})
    .filter(([, scene]) => scene.enabled);
  const wecomErrors = [
    ...wecomRobots.filter((robot) => robot.lastError).map((robot) => `${robot.name}：${robot.lastError}`),
    ...(wecomNotificationPayload?.schedules ?? []).filter((schedule) => schedule.lastError).map((schedule) => `${schedule.name}：${schedule.lastError}`),
  ];
  const wecomHealthTone = !enabledWecomRobots.length || wecomErrors.length ? "warning" : enabledWecomSchedules.length || enabledWecomScenes.length ? "good" : "warning";
  const wecomHealthLabel = !wecomRobots.length
    ? "未配置机器人"
    : !enabledWecomRobots.length
      ? "机器人已停用"
      : wecomErrors.length
        ? `${wecomErrors.length} 个错误`
        : enabledWecomSchedules.length || enabledWecomScenes.length
          ? "通知可用"
          : "未启用推送";
  const wecomSceneLabels: Record<string, string> = {
    stockupRecommendation: "备货建议",
    inventorySnapshot: "库存快照",
    qualificationExpiry: "资质过期",
  };
  const enabledWecomSceneText = enabledWecomScenes.length
    ? enabledWecomScenes.map(([key]) => wecomSceneLabels[key] || key).join("、")
    : "未启用场景推送";
  const wecomHealthDetail = wecomErrors.length
    ? wecomErrors.slice(0, 2).join("；")
    : enabledWecomRobots.length
      ? `启用机器人 ${formatNumber(enabledWecomRobots.length)} 个，定时 ${formatNumber(enabledWecomSchedules.length)} 个，场景：${enabledWecomSceneText}。`
      : "企业微信通知尚未形成主动推送能力，备货、库存快照和资质过期仍需要人工进系统查看。";
  const diagnosticIssues = (summary?.movementDiagnostics ?? [])
    .filter((item) => item.reason !== "ok" && item.reason !== "ok_with_sku_fallback")
    .sort((a, b) => Number(b.failed) - Number(a.failed) || Number(!b.hasCredentials) - Number(!a.hasCredentials) || b.unmatchedOrderRows - a.unmatchedOrderRows);
  const staleDetail = staleSources.map((item) => `${item.label} ${syncAgeText(item.value)}`).join("、");
  const attentionItems = [
    ...(staleSources.length ? [{
      id: "stale-data",
      tone: "danger" as const,
      title: "数据新鲜度需确认",
      metric: `${staleSources.length} 项`,
      detail: `${staleDetail}。用于备货或经营复盘前建议先完成同步。`,
      actionLabel: "去同步",
      onAction: onOpenWarehouses,
    }] : []),
    ...(failedWarehouses.length ? [{
      id: "warehouse-sync-failed",
      tone: "danger" as const,
      title: "仓库订单同步失败",
      metric: `${failedWarehouses.length} 仓`,
      detail: failedWarehouses.slice(0, 3).map((item) => `${item.warehouseId}${item.message ? `：${item.message}` : ""}`).join("；"),
      actionLabel: "查仓库",
      onAction: onOpenWarehouses,
    }] : []),
    ...diagnosticIssues.slice(0, 2).map((item) => ({
      id: `movement-${item.warehouseId}`,
      tone: item.failed || !item.hasCredentials ? "danger" as const : "warning" as const,
      title: `${item.warehouseName} 动销诊断`,
      metric: item.reasonLabel,
      detail: `库存 SKU ${formatNumber(item.inventorySku)}，近 90 天订单 ${formatNumber(item.recentOrderRows)}，已匹配订单 ${formatNumber(item.matchedOrderRows)}。`,
      actionLabel: "看动销",
      onAction: () => onOpenMovementWarehouse(item.warehouseId),
    })),
    ...((stockupPayload?.counts.recommendations ?? 0) > 0 ? [{
      id: "stockup-recommendations",
      tone: "warning" as const,
      title: "备货建议待处理",
      metric: `${formatNumber(stockupPayload?.counts.recommendations ?? 0)} SKU`,
      detail: `净建议备货 ${formatNumber(stockupPayload?.counts.netRecommendedQty ?? 0)}，请确认采纳、放弃或创建备货计划。`,
      actionLabel: "处理备货",
      onAction: onOpenStockup,
    }] : []),
    ...((stockupPayload?.counts.acceptedRecommendations ?? 0) > (stockupPayload?.counts.openStockupPlans ?? 0) ? [{
      id: "accepted-without-plan",
      tone: "warning" as const,
      title: "已采纳建议待建计划",
      metric: `${formatNumber((stockupPayload?.counts.acceptedRecommendations ?? 0) - (stockupPayload?.counts.openStockupPlans ?? 0))} 条`,
      detail: "已采纳的备货建议需要继续落到采购或委外计划，避免只停留在页面状态。",
      actionLabel: "建计划",
      onAction: onOpenStockup,
    }] : []),
    ...(wecomHealthTone === "warning" ? [{
      id: "wecom-health",
      tone: "warning" as const,
      title: "企业微信通知需配置",
      metric: wecomHealthLabel,
      detail: wecomHealthDetail,
      actionLabel: "配通知",
      onAction: onOpenWecom,
    }] : []),
    ...(warehouseOnlySkuCount > 0 ? [{
      id: "warehouse-only-sku",
      tone: "warning" as const,
      title: "仓库孤儿 SKU 待治理",
      metric: `${formatNumber(warehouseOnlySkuCount)} SKU`,
      detail: "仓库有库存但产品库未建档，需补齐产品档案或确认 SKU 映射。",
      actionLabel: "看明细",
      onAction: onOpenMovement,
    }] : []),
  ].slice(0, 6);

  function attentionQueueText() {
    if (!attentionItems.length) return "今日需要处理：暂无阻断项，继续巡检备货建议、同步健康度和动销风险。";
    return [
      `今日需要处理：${formatNumber(attentionItems.length)} 项`,
      "",
      ...attentionItems.map((item, index) => [
        `${index + 1}. ${item.title}｜${item.metric}`,
        `优先级：${item.tone === "danger" ? "高" : "中"}`,
        `详情：${item.detail}`,
        `动作：${item.actionLabel}`,
      ].join("\n")),
    ].join("\n");
  }

  async function copyAttentionQueue() {
    await copyText(attentionQueueText());
    setAttentionCopyMessage(`已复制 ${formatNumber(attentionItems.length)} 项首页待办`);
    window.setTimeout(() => setAttentionCopyMessage(""), 1800);
  }

  function downloadAttentionQueueCsv() {
    const rows = [
      ["标题", "指标", "优先级", "详情", "动作"],
      ...attentionItems.map((item) => [
        item.title,
        item.metric,
        item.tone === "danger" ? "高" : "中",
        item.detail,
        item.actionLabel,
      ]),
    ];
    downloadTextFile(`tongzhou-dashboard-action-queue-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((row) => row.map(csvCell).join(",")).join("\n"), "text/csv;charset=utf-8");
    setAttentionCopyMessage("已下载首页待办 CSV");
    window.setTimeout(() => setAttentionCopyMessage(""), 1800);
  }

  return (
    <main className="dashboard-grid">
      {staleSources.length ? (
        <section className="notice danger data-freshness-notice">
          <strong>数据可能已过期</strong>
          <span>
            {staleSources.map((item) => `${item.label} ${syncAgeText(item.value)}`).join("、")}。请先同步后再用于备货、补货或经营复盘判断。
          </span>
        </section>
      ) : null}

      <section className="metric-strip">
        <Metric title="可售库存" value={formatNumber(totalInventory)} note={`${products.length} 个可见产品`} icon={Boxes} tone="blue" />
        <Metric title="今日出库订单" value={formatNumber(totalOrders)} note={todayOrderNote} icon={PackageCheck} tone="green" />
        <Metric title="90天订单金额" value={formatMoney(salesAmount)} note={`${formatNumber(summary?.counts.orderCount90 ?? 0)} 条出库明细`} icon={BarChart3} tone="orange" />
        <Metric title="动销风险 SKU" value={String(riskCount)} note={`产品风险 ${formatNumber(productRiskCount)} / 仓库孤儿 ${formatNumber(warehouseOnlySkuCount)}`} icon={AlertTriangle} tone="red" />
      </section>

      <section className="panel sync-health-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Sync Health</p>
            <h2>同步健康度</h2>
          </div>
          <span className="status-pill muted">下一次：{nextAutoSync}</span>
        </div>
        <div className="sync-health-grid">
          {syncHealthRows.map((row) => (
            <article className="sync-health-row" key={row.id}>
              <div className="sync-health-title">
                <strong>{row.label}</strong>
                <span className={`status-pill ${row.tone}`}>{row.status}</span>
              </div>
              <dl>
                <div>
                  <dt>最后成功</dt>
                  <dd>{row.last ? formatDateTime(row.last) : "未同步"}</dd>
                </div>
                <div>
                  <dt>下一次自动</dt>
                  <dd>{nextAutoSync}</dd>
                </div>
              </dl>
              <p>{row.reason}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel notification-health-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Notification Health</p>
            <h2>通知配置健康度</h2>
          </div>
          <span className={`status-pill ${wecomHealthTone}`}>{wecomHealthLabel}</span>
        </div>
        <div className="notification-health-body">
          <div className="notification-health-icon">
            <BellRing size={20} />
          </div>
          <div>
            <strong>企业微信主动提醒</strong>
            <span>{wecomHealthDetail}</span>
          </div>
          <button className="ghost-button" type="button" onClick={onOpenWecom}>
            配置通知
            <ArrowUpRight size={15} />
          </button>
        </div>
      </section>

      <section className="panel attention-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Action Queue</p>
            <h2>需要处理</h2>
          </div>
          <div className="attention-toolbar">
            <span className={`status-pill ${attentionItems.length ? "warning" : "good"}`}>
              {attentionItems.length ? `${attentionItems.length} 项待处理` : "暂无阻断"}
            </span>
            <button className="ghost-button compact-button" type="button" onClick={() => void copyAttentionQueue()} disabled={!attentionItems.length}>
              <Copy size={14} />
              复制待办
            </button>
            <button className="ghost-button compact-button" type="button" onClick={downloadAttentionQueueCsv} disabled={!attentionItems.length}>
              <Download size={14} />
              下载CSV
            </button>
          </div>
        </div>
        {attentionCopyMessage ? <div className="notice good compact-notice">{attentionCopyMessage}</div> : null}
        {attentionItems.length ? (
          <div className="attention-list">
            {attentionItems.map((item) => (
              <article className={`attention-item ${item.tone}`} key={item.id}>
                <div className="attention-marker" />
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </div>
                <div className="attention-action">
                  <em>{item.metric}</em>
                  <button className="ghost-button" type="button" onClick={item.onAction}>
                    {item.actionLabel}
                    <ArrowUpRight size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="attention-empty">
            <Check size={18} />
            <span>同步、动销诊断和备货建议当前没有需要优先处理的阻断项。</span>
          </div>
        )}
      </section>

      <section className="panel metric-definition-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Metric Definitions</p>
            <h2>经营指标口径</h2>
          </div>
          <span className="status-pill muted">避免跨集合误读</span>
        </div>
        <div className="metric-definition-grid">
          <div>
            <strong>{formatNumber(catalogSkuCount)}</strong>
            <span>产品库 SKU</span>
            <small>来自产品目录，是当前页面可见商品集合。</small>
          </div>
          <div>
            <strong>{formatNumber(movementSkuCount)}</strong>
            <span>动销分析 SKU</span>
            <small>合并产品库、仓库库存和近 90 天订单后的分析集合。</small>
          </div>
          <div>
            <strong>{formatNumber(warehouseOnlySkuCount)}</strong>
            <span>仓库孤儿 SKU</span>
            <small>仓库有库存但产品库未建档，需补档或确认 SKU 映射。</small>
          </div>
          <div>
            <strong>{formatNumber(riskCount)}</strong>
            <span>风险 SKU</span>
            <small>缺货、补货预警、慢销、滞销与仓库孤儿风险合计。</small>
          </div>
        </div>
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
        <WarehouseMovementHeatmap summary={summary} period={heatmapPeriod} onPeriodChange={setHeatmapPeriod} onWarehouseClick={onOpenMovementWarehouse} />
      </section>

      <section className="panel warehouse-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">WMS Sync</p>
            <h2>仓库连接状态</h2>
          </div>
          <button className="icon-button" type="button" aria-label="新增仓库授权" onClick={onOpenWarehouses}>
            <ArrowUpRight size={18} />
          </button>
        </div>
        <div className="warehouse-list">
          {(summary?.warehouses?.length ? summary.warehouses : warehouses).map((warehouse) => (
            <article key={"id" in warehouse ? warehouse.id : warehouse.name} className="warehouse-row">
              <div>
                <strong>{warehouse.name}</strong>
                <span>
                  {"providerName" in warehouse ? `${warehouse.providerName} · ${warehouse.country}` : `${warehouse.provider} · ${warehouse.baseUrl}`}
                </span>
              </div>
              <div className="warehouse-meta">
                {"orderOk" in warehouse ? (
                  <>
                    <span className={`status-pill ${warehouse.backgroundRunning ? "warning" : warehouse.orderOk || warehouse.inventoryOk ? "good" : "warning"}`}>
                      {warehouse.backgroundRunning ? "后台同步中" : warehouse.orderOk || warehouse.inventoryOk ? "正常" : "待同步"}
                    </span>
                    <small>{warehouse.message || `${formatNumber(warehouse.orderCount)} 条订单`}</small>
                  </>
                ) : (
                  <>
                    <span className={`status-pill ${warehouse.status === "正常" ? "good" : "warning"}`}>{warehouse.status}</span>
                    <small>{warehouse.lastSyncedAt}</small>
                  </>
                )}
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

function periodMultiplier(period: HeatmapPeriod) {
  if (period === "day") return 1 / 90;
  if (period === "week") return 7 / 90;
  return 30 / 90;
}

function periodLabel(period: HeatmapPeriod) {
  return { day: "日", week: "周", month: "月" }[period];
}

function heatLevel(value: number, max: number) {
  if (!max || value <= 0) return 0;
  return Math.min(5, Math.max(1, Math.ceil((value / max) * 5)));
}

function WarehouseMovementHeatmap({
  summary,
  period,
  onPeriodChange,
  onWarehouseClick,
}: {
  summary: DashboardSummaryPayload | null;
  period: HeatmapPeriod;
  onPeriodChange: (period: HeatmapPeriod) => void;
  onWarehouseClick: (warehouseId: string) => void;
}) {
  const warehouses = summary?.warehouses ?? [];
  const multiplier = periodMultiplier(period);
  const rows = warehouses.map((warehouse) => ({
    ...warehouse,
    periodOrders: Math.round((warehouse.orderCount || 0) * multiplier),
    turnoverScore: warehouse.inventoryCount > 0 ? ((warehouse.orderCount || 0) * multiplier) / warehouse.inventoryCount : 0,
  }));
  const maxOrders = Math.max(...rows.map((row) => row.periodOrders), 1);
  const maxTurnover = Math.max(...rows.map((row) => row.turnoverScore), 0.01);
  const totalPeriodOrders = rows.reduce((sum, row) => sum + row.periodOrders, 0);

  return (
    <div className="warehouse-heatmap" aria-label="仓库动销热力图">
      <div className="heatmap-toolbar">
        <div>
          <strong>仓库动销热力图</strong>
          <span>{periodLabel(period)}维度估算，基于近 90 天出库缓存</span>
        </div>
        <div className="heatmap-tabs" role="group" aria-label="热力图周期">
          {(["day", "week", "month"] as const).map((item) => (
            <button key={item} className={period === item ? "active" : ""} type="button" onClick={() => onPeriodChange(item)}>
              {periodLabel(item)}
            </button>
          ))}
        </div>
      </div>
      <div className="heatmap-summary">
        <span>预计{periodLabel(period)}出库 <strong>{formatNumber(totalPeriodOrders)}</strong></span>
        <span>覆盖仓库 <strong>{formatNumber(rows.length)}</strong></span>
        <span>最近订单同步 <strong>{summary?.sync.orderSyncedAt ? formatDateTime(summary.sync.orderSyncedAt) : "未同步"}</strong></span>
      </div>
      <div className="heatmap-grid">
        <span className="heatmap-head">仓库</span>
        <span className="heatmap-head">出库热度</span>
        <span className="heatmap-head">周转热度</span>
        <span className="heatmap-head">状态</span>
        {rows.length ? rows.map((row) => {
          const orderLevel = heatLevel(row.periodOrders, maxOrders);
          const turnoverLevel = heatLevel(row.turnoverScore, maxTurnover);
          return (
            <React.Fragment key={row.id}>
              <button className="heatmap-name heatmap-link" type="button" onClick={() => onWarehouseClick(row.id)}>
                <strong>{row.name}</strong>
                <small>{row.providerName} · {row.country}</small>
              </button>
              <div className={`heat-cell level-${orderLevel}`}>
                <strong>{formatNumber(row.periodOrders)}</strong>
                <small>{periodLabel(period)}出库</small>
              </div>
              <div className={`heat-cell level-${turnoverLevel}`}>
                <strong>{row.turnoverScore.toFixed(3)}</strong>
                <small>出库/库存</small>
              </div>
              <span className={`status-pill ${row.backgroundRunning ? "warning" : row.orderOk || row.inventoryOk ? "good" : "muted"}`}>
                {row.backgroundRunning ? "后台同步中" : row.orderOk || row.inventoryOk ? "正常" : "待同步"}
              </span>
            </React.Fragment>
          );
        }) : (
          <div className="heatmap-empty">暂无仓库动销数据，请先完成仓库和订单同步。</div>
        )}
      </div>
    </div>
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

function movementLeadTimeDays(country: string) {
  if (/俄罗斯/.test(country)) return 55;
  if (/印度尼西亚|印尼/.test(country)) return 35;
  if (/马来西亚|越南/.test(country)) return 30;
  return 35;
}

function movementStatusFor(item: Pick<MovementPayload["items"][number], "availableQty" | "sales7" | "sales30" | "sales90" | "dailyWeighted" | "daysCover" | "leadDays">) {
  const daysCover = item.daysCover ?? 9999;
  if (item.availableQty <= 0 && (item.sales7 > 0 || item.sales30 > 0 || item.sales90 > 0)) return "缺货";
  if (item.dailyWeighted > 0 && daysCover <= item.leadDays + 10) return "补货预警";
  if (item.availableQty > 0 && item.sales30 === 0) return "滞销";
  if (item.availableQty > 0 && item.sales90 <= 2) return "滞销";
  if (item.dailyWeighted > 0 && daysCover > 90) return "慢销";
  if (item.sales90 === 0 && item.availableQty <= 0) return "无动销数据";
  return "健康";
}

function movementSuggestionFor(status: string, item: Pick<MovementPayload["items"][number], "targetCoverDays" | "replenishQty">) {
  if (status === "缺货") return "立即核查库存，确认是否有在途或可调拨库存。";
  if (status === "补货预警") return `建议按 ${item.targetCoverDays} 天覆盖量安排补货，参考补货量 ${item.replenishQty}。`;
  if (status === "慢销") return "库存覆盖过高，建议暂停补货并评估促销或调价。";
  if (status === "滞销") return "近 30 天动销不足，建议检查渠道曝光、价格和是否清仓。";
  if (status === "无动销数据") return "暂无订单出库数据，先确认订单接口或 SKU 映射。";
  return "库存和销量处于可控区间。";
}

function movementDetailMatches(detail: { warehouseId?: string; warehouseName?: string }, warehouse: string) {
  return detail.warehouseId === warehouse || detail.warehouseName === warehouse;
}

function sumTrend30(rows: Array<{ trend30?: number[] }>) {
  return Array.from({ length: 30 }, (_, index) => rows.reduce((sum, row) => sum + (row.trend30?.[index] || 0), 0));
}

function movementWarehouseScopedItem(
  item: MovementPayload["items"][number],
  warehouse: string,
  warehouseCountry = "",
) {
  if (warehouse === "全部") return item;
  const inventoryRows = (item.warehouseBreakdown || []).filter((detail) => movementDetailMatches(detail, warehouse));
  const salesRows = (item.salesWarehouseBreakdown || []).filter((detail) => movementDetailMatches(detail, warehouse));
  if (!inventoryRows.length && !salesRows.length) return null;

  const availableQty = inventoryRows.reduce((sum, detail) => sum + (detail.availableQty || 0), 0);
  const lockedQty = inventoryRows.reduce((sum, detail) => sum + (detail.lockedQty || 0), 0);
  const inTransitQty = inventoryRows.reduce((sum, detail) => sum + (detail.inTransitQty || 0), 0);
  const totalQty = inventoryRows.reduce((sum, detail) => sum + (detail.totalQty || 0), 0);
  const sales3 = salesRows.reduce((sum, detail) => sum + (detail.sales3 || 0), 0);
  const sales7 = salesRows.reduce((sum, detail) => sum + (detail.sales7 || 0), 0);
  const sales15 = salesRows.reduce((sum, detail) => sum + (detail.sales15 || 0), 0);
  const sales30 = salesRows.reduce((sum, detail) => sum + (detail.sales30 || 0), 0);
  const sales60 = salesRows.reduce((sum, detail) => sum + (detail.sales60 || 0), 0);
  const sales90 = salesRows.reduce((sum, detail) => sum + (detail.sales90 || 0), 0);
  const avgDaily3 = sales3 / 3;
  const avgDaily7 = sales7 / 7;
  const avgDaily30 = sales30 / 30;
  const avgDaily90 = sales90 / 90;
  const dailyWeighted = avgDaily7 * 0.5 + avgDaily30 * 0.3 + avgDaily90 * 0.2;
  const country = warehouseCountry || item.country;
  const leadDays = movementLeadTimeDays(country);
  const targetCoverDays = leadDays + 20;
  const daysCover = dailyWeighted > 0 ? Math.round((availableQty / dailyWeighted) * 10) / 10 : null;
  const replenishQty = Math.max(0, Math.ceil(dailyWeighted * targetCoverDays - availableQty - inTransitQty));
  const scoped = {
    ...item,
    country,
    availableQty,
    lockedQty,
    inTransitQty,
    totalQty,
    warehouseBreakdown: inventoryRows,
    salesWarehouseBreakdown: salesRows,
    sales3,
    sales7,
    sales15,
    sales30,
    sales60,
    sales90,
    avgDaily3,
    avgDaily7,
    avgDaily30,
    avgDaily90,
    dailyWeighted,
    daysCover,
    leadDays,
    targetCoverDays,
    replenishQty,
    trend30: sumTrend30(salesRows),
  };
  const status = movementStatusFor(scoped);
  return {
    ...scoped,
    status,
    suggestion: movementSuggestionFor(status, scoped),
  };
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

function SalesWindowCell({ value }: { value: number }) {
  return <span className="movement-sales-window">{formatNumber(value)}</span>;
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

function movementRiskOwner(item: MovementPayload["items"][number]) {
  if (item.source === "warehouse_only" || item.dataGap === "warehouse_only") return "产品资料 / 仓库";
  if (item.status === "缺货" || item.status === "补货预警") return "采购 / 运营";
  if (item.status === "慢销" || item.status === "滞销") return "运营 / 销售";
  if (item.status === "无动销数据") return "仓库 / WMS";
  return "运营";
}

function movementRiskReason(item: MovementPayload["items"][number]) {
  if (item.source === "warehouse_only" || item.dataGap === "warehouse_only") return "仓库有库存但产品库未建档";
  if (item.status === "缺货") return `可售 ${formatNumber(item.availableQty)}，近90天销量 ${formatNumber(item.sales90)}`;
  if (item.status === "补货预警") return `可售天数 ${formatDaysCover(item.daysCover)}，低于补货周期 ${formatNumber(item.leadDays)} + 10 天`;
  if (item.status === "慢销") return `可售天数 ${formatDaysCover(item.daysCover)}，库存覆盖偏高`;
  if (item.status === "滞销") return `近30天销量 ${formatNumber(item.sales30)}，近90天销量 ${formatNumber(item.sales90)}`;
  if (item.status === "无动销数据") return "库存和近90天订单未形成有效动销";
  return item.suggestion || "当前指标正常";
}

function movementRiskNextAction(item: MovementPayload["items"][number]) {
  if (item.source === "warehouse_only" || item.dataGap === "warehouse_only") return "补齐产品档案、国家 SKU 或仓库 SKU 映射后重新同步仓库和订单。";
  if (item.status === "缺货") return "确认可调拨、在途和供应商交期，优先创建补货或委外计划。";
  if (item.status === "补货预警") return `按建议备货 ${formatNumber(item.replenishQty)} ${item.unit || ""} 评估采购/委外计划。`;
  if (item.status === "慢销") return "暂停补货，复核价格、渠道曝光和促销节奏。";
  if (item.status === "滞销") return "评估清仓、调价或下架，并确认是否存在 SKU 映射问题。";
  if (item.status === "无动销数据") return "先查看仓库动销诊断，确认订单同步、SKU 映射和统计窗口。";
  return item.suggestion || "保持观察。";
}

function movementRiskExecutionCsv(items: MovementPayload["items"]) {
  const header = ["SKU", "产品", "国家", "状态", "建议负责人", "风险原因", "下一步动作", "可售", "在途", "3天销量", "7天销量", "30天销量", "90天销量", "可售天数", "建议备货"];
  const rows = items.map((item) => [
    item.sku,
    item.name,
    item.country,
    item.status,
    movementRiskOwner(item),
    movementRiskReason(item),
    movementRiskNextAction(item),
    item.availableQty,
    item.inTransitQty,
    item.sales3,
    item.sales7,
    item.sales30,
    item.sales90,
    formatDaysCover(item.daysCover),
    item.replenishQty,
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function movementRiskExecutionText(items: MovementPayload["items"]) {
  if (!items.length) return "当前筛选下暂无需要处理的动销风险 SKU。";
  return [
    `动销风险执行清单：${formatNumber(items.length)} 个 SKU`,
    "",
    ...items.slice(0, 80).map((item, index) => [
      `${index + 1}. ${item.sku}｜${item.name}｜${item.country}｜${item.status}`,
      `负责人：${movementRiskOwner(item)}`,
      `原因：${movementRiskReason(item)}`,
      `动作：${movementRiskNextAction(item)}`,
      `指标：可售 ${formatNumber(item.availableQty)}，在途 ${formatNumber(item.inTransitQty)}，7/30/90天销量 ${formatNumber(item.sales7)}/${formatNumber(item.sales30)}/${formatNumber(item.sales90)}，可售天数 ${formatDaysCover(item.daysCover)}`,
    ].join("\n")),
  ].join("\n");
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

function StockupFormulaInsight({ item }: { item: StockupPayload["recommendations"][number] }) {
  const dailyWeighted = item.avgDaily7 * 0.5 + item.avgDaily30 * 0.3 + item.avgDaily90 * 0.2;
  const grossFormulaQty = Math.max(0, Math.ceil(dailyWeighted * item.targetCoverDays - item.availableQty - item.inTransitQty));
  return (
    <span className="movement-insight stockup-formula-insight has-tooltip">
      计算口径
      <span className="movement-tooltip insight-tooltip">
        <strong>备货建议计算公式</strong>
        <small>销量窗口：7天 {formatNumber(item.sales7)} / 30天 {formatNumber(item.sales30)} / 90天 {formatNumber(item.sales90)}。</small>
        <small>
          加权日均 = 7日均 {formatDecimal(item.avgDaily7)} × 50% + 30日均 {formatDecimal(item.avgDaily30)} × 30% + 90日均 {formatDecimal(item.avgDaily90)} × 20% = {formatDecimal(dailyWeighted)}。
        </small>
        <small>
          可售天数 = 可售 {formatNumber(item.availableQty)} ÷ 加权日均 {formatDecimal(dailyWeighted)} = {formatDaysCover(item.daysCover)} 天。
        </small>
        <small>
          建议备货 = max(0, ceil(加权日均 × 目标覆盖 {formatNumber(item.targetCoverDays)} - 可售 {formatNumber(item.availableQty)} - 在途 {formatNumber(item.inTransitQty)})) = {formatNumber(item.replenishQty)} {item.unit}。
        </small>
        {grossFormulaQty !== item.replenishQty ? <small>当前建议量来自服务端口径 {formatNumber(item.replenishQty)}，本页公式复算值 {formatNumber(grossFormulaQty)}，请以服务端结果为准。</small> : null}
        <small>
          净建议备货 = max(0, 建议备货 {formatNumber(item.replenishQty)} - 委外在产 {formatNumber(item.outsourcingInProductionQty)}) = {formatNumber(item.netReplenishQty)} {item.unit}。
        </small>
      </span>
    </span>
  );
}

function stockupPlanStatusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "待下单",
    ordered: "已下单",
    in_production: "生产/在途",
    arrived: "已到仓",
    cancelled: "已取消",
  };
  return labels[status] || status || "待处理";
}

function stockupPlanTypeLabel(type: string) {
  return type === "outsourcing" ? "委外排产" : "采购补货";
}

type StockupPlanItem = NonNullable<StockupPayload["plans"]>[number];

function stockupPlanExecutionRows(plans: StockupPlanItem[]) {
  return plans.map((plan) => [
    plan.sku,
    plan.name || "",
    plan.country || "",
    stockupPlanTypeLabel(plan.planType),
    stockupPlanStatusLabel(plan.status),
    plan.quantity,
    plan.unit || "",
    plan.owner || "",
    plan.expectedArrivalAt || "",
    plan.note || "",
    plan.createdAt ? formatDateTime(plan.createdAt) : "",
    plan.updatedAt ? formatDateTime(plan.updatedAt) : "",
  ]);
}

function stockupPlanExecutionCsv(plans: StockupPlanItem[]) {
  const header = ["SKU", "产品名称", "国家", "计划类型", "状态", "计划数量", "单位", "负责人", "预计到仓", "备注", "创建时间", "更新时间"];
  return [header, ...stockupPlanExecutionRows(plans)].map((row) => row.map(csvCell).join(",")).join("\n");
}

function stockupPlanExecutionText(plans: StockupPlanItem[]) {
  if (!plans.length) return "暂无未完成备货计划。";
  const totalQty = plans.reduce((sum, plan) => sum + (Number(plan.quantity) || 0), 0);
  return [
    `备货执行清单：${plans.length} 个未完成计划，合计数量 ${formatNumber(totalQty)}`,
    "",
    ...plans.map((plan, index) => [
      `${index + 1}. ${plan.sku}｜${plan.name || "-"}`,
      `类型：${stockupPlanTypeLabel(plan.planType)}；状态：${stockupPlanStatusLabel(plan.status)}`,
      `数量：${formatNumber(plan.quantity)} ${plan.unit || ""}；国家：${plan.country || "-"}`,
      `负责人：${plan.owner || "未指定"}；预计到仓：${plan.expectedArrivalAt || "未设置"}`,
      plan.note ? `备注：${plan.note}` : "",
    ].filter(Boolean).join("\n")),
  ].join("\n");
}

function dateKeyDiff(from: string, to: string) {
  const start = new Date(`${from.slice(0, 10)}T00:00:00.000Z`);
  const end = new Date(`${to.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

function stockupPlanReviewStatus(plan: StockupPlanItem) {
  const arrivedAt = (plan.updatedAt || "").slice(0, 10);
  if (!plan.expectedArrivalAt) return "未设置预计到仓";
  if (!arrivedAt) return "待确认到仓时间";
  const diff = dateKeyDiff(plan.expectedArrivalAt, arrivedAt);
  if (diff === null) return "待复核到仓日期";
  if (diff <= 0) return diff < 0 ? `提前 ${Math.abs(diff)} 天` : "按期到仓";
  return `延期 ${diff} 天`;
}

function stockupPlanReviewCsv(plans: StockupPlanItem[]) {
  const header = ["SKU", "产品名称", "国家", "计划类型", "计划数量", "单位", "负责人", "预计到仓", "标记到仓时间", "复盘结论", "备注", "创建时间", "更新时间"];
  const rows = plans.map((plan) => [
    plan.sku,
    plan.name || "",
    plan.country || "",
    stockupPlanTypeLabel(plan.planType),
    plan.quantity,
    plan.unit || "",
    plan.owner || "",
    plan.expectedArrivalAt || "",
    (plan.updatedAt || "").slice(0, 10),
    stockupPlanReviewStatus(plan),
    plan.note || "",
    plan.createdAt ? formatDateTime(plan.createdAt) : "",
    plan.updatedAt ? formatDateTime(plan.updatedAt) : "",
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function stockupPlanReviewText(plans: StockupPlanItem[]) {
  if (!plans.length) return "暂无已到仓待复盘计划。";
  return [
    `已到仓待复盘：${formatNumber(plans.length)} 个计划`,
    "",
    ...plans.slice(0, 80).map((plan, index) => [
      `${index + 1}. ${plan.sku}｜${plan.name || "-"}`,
      `数量：${formatNumber(plan.quantity)} ${plan.unit || ""}；类型：${stockupPlanTypeLabel(plan.planType)}`,
      `负责人：${plan.owner || "未指定"}；预计到仓：${plan.expectedArrivalAt || "未设置"}；标记到仓：${plan.updatedAt ? formatDateTime(plan.updatedAt) : "未记录"}`,
      `复盘结论：${stockupPlanReviewStatus(plan)}`,
      plan.note ? `备注：${plan.note}` : "",
    ].filter(Boolean).join("\n")),
  ].join("\n");
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
  if (key === "sales3") return item.sales3;
  if (key === "sales7") return item.sales7;
  if (key === "sales15") return item.sales15;
  if (key === "sales30") return item.sales30;
  if (key === "sales60") return item.sales60;
  if (key === "avgDaily7") return item.avgDaily7;
  if (key === "sales90") return item.sales90;
  if (key === "daysCover") return item.daysCover ?? Number.POSITIVE_INFINITY;
  return 0;
}

function diagnosticTone(item: MovementWarehouseDiagnostic) {
  if (item.severity === "good" || item.severity === "warning" || item.severity === "danger") return item.severity;
  if (item.reason === "ok" || item.reason === "ok_with_sku_fallback") return "good";
  if (item.reason === "running" || item.reason === "out_of_window" || item.reason === "no_orders") return "warning";
  if (item.reason === "missing_sku") return "danger";
  return "danger";
}

function movementDiagnosticSupportText(item: MovementWarehouseDiagnostic) {
  const unmatchedRows = movementUnmatchedSkuRows(item);
  const outOfWindowRows = movementOutOfWindowSkuRows(item);
  const missingSkuRows = movementMissingSkuOrderRows(item);
  return [
    `仓库：${item.warehouseName || item.warehouseId}`,
    `国家：${item.country || "-"}`,
    `WMS：${item.providerName || item.providerId || "-"}`,
    `诊断：${item.reasonLabel || item.reason}`,
    `授权：${item.hasCredentials ? "已授权" : "未授权"}`,
    `库存：${formatNumber(item.inventoryRows)} 行 / ${formatNumber(item.inventorySku)} SKU`,
    `订单：${formatNumber(item.orderRows)} 行；近90天 ${formatNumber(item.recentOrderRows)}；已匹配 ${formatNumber(item.matchedOrderRows)}`,
    `SKU兜底匹配：${formatNumber(item.skuFallbackMatchedRows)}；未匹配：${formatNumber(item.unmatchedOrderRows)}；窗口外：${formatNumber(item.outOfWindowOrderRows)}；缺SKU：${formatNumber(item.missingSkuOrderRows)}`,
    item.orderApiTotal || item.orderApiReadRows || item.orderApiReachedPageLimit ? `订单接口分页：total ${formatNumber(item.orderApiTotal || 0)}；已读包裹 ${formatNumber(item.orderApiReadRows || 0)}；SKU行 ${formatNumber(item.orderApiReadSkuRows || 0)}；页数 ${formatNumber(item.orderApiPagesRead || 0)}/${formatNumber(item.orderApiPageLimit || 0)}${item.orderApiReachedPageLimit ? "；已达到页数上限" : ""}` : "",
    item.latestOrderSyncJob ? `最近订单同步：${item.latestOrderSyncJob.status}；分片 ${formatNumber(item.latestOrderSyncJob.completedChunks)}/${formatNumber(item.latestOrderSyncJob.totalChunks)}；失败 ${formatNumber(item.latestOrderSyncJob.failedChunks)}；订单 ${formatNumber(item.latestOrderSyncJob.orderCount)}；${item.latestOrderSyncJob.lastMessage || ""}` : "",
    item.latestOrderSyncJob?.failedChunkSamples?.length ? `失败分片：${item.latestOrderSyncJob.failedChunkSamples.map((chunk) => `${chunk.from}~${chunk.to} ${chunk.message}`).join("；")}` : "",
    missingSkuRows.length ? `缺SKU订单：${missingSkuRows.map((row) => `${row.orderNo || row.orderId || "-"} / ${row.productName || row.goodsSkuId || "-"} / ${formatNumber(row.quantity)} / ${row.shippedAt || row.createdAt || "-"}`).join("；")}` : "",
    unmatchedRows.length ? `未匹配SKU：${unmatchedRows.map((row) => `${row.sku || "-"} / ${row.country || "-"} / ${formatNumber(row.orderRows)}单 / 最近${row.lastShippedAt || "-"}`).join("；")}` : "",
    outOfWindowRows.length ? `窗口外SKU：${outOfWindowRows.map((row) => `${row.sku || "-"} / ${row.country || "-"} / ${formatNumber(row.orderRows)}单 / 最近${row.lastShippedAt || "-"} / 距今${row.minAgeDays ?? "-"}天`).join("；")}` : "",
    item.actionTitle ? `处理建议：${item.actionTitle}` : "",
    item.actionItems?.length ? `下一步：${item.actionItems.join("；")}` : "",
    item.message ? `同步消息：${item.message}` : "",
  ].filter(Boolean).join("\n");
}

type MovementDiagnosticSkuWindowRow = {
  sku: string;
  country: string;
  orderRows: number;
  quantity: number;
  firstShippedAt: string;
  lastShippedAt: string;
  sampleShippedAt: string;
  minAgeDays?: number | null;
  maxAgeDays?: number | null;
};

function movementUnmatchedSkuRows(item: MovementWarehouseDiagnostic): MovementDiagnosticSkuWindowRow[] {
  if (item.unmatchedSkus?.length) {
    return item.unmatchedSkus.map((row) => ({
      sku: row.sku,
      country: row.country,
      orderRows: row.orderRows,
      quantity: row.quantity,
      firstShippedAt: row.firstShippedAt,
      lastShippedAt: row.lastShippedAt,
      sampleShippedAt: row.sampleShippedAt,
    }));
  }
  return (item.unmatchedSamples || []).map((sample) => ({
    sku: sample.sku,
    country: sample.country,
    orderRows: 1,
    quantity: 0,
    firstShippedAt: sample.shippedAt,
    lastShippedAt: sample.shippedAt,
    sampleShippedAt: sample.shippedAt,
  }));
}

function movementMissingSkuOrderRows(item: MovementWarehouseDiagnostic) {
  return item.missingSkuOrders || [];
}

function movementOutOfWindowSkuRows(item: MovementWarehouseDiagnostic): MovementDiagnosticSkuWindowRow[] {
  return (item.outOfWindowSkus || []).map((row) => ({
    sku: row.sku,
    country: row.country,
    orderRows: row.orderRows,
    quantity: row.quantity,
    firstShippedAt: row.firstShippedAt,
    lastShippedAt: row.lastShippedAt,
    sampleShippedAt: row.sampleShippedAt,
    minAgeDays: row.minAgeDays,
    maxAgeDays: row.maxAgeDays,
  }));
}

function movementMissingSkuOrderText(item: MovementWarehouseDiagnostic) {
  const rows = movementMissingSkuOrderRows(item);
  return [
    `仓库：${item.warehouseName || item.warehouseId}`,
    `诊断：${item.reasonLabel || item.reason}`,
    "这些订单行没有 SKU，无法进入动销匹配。请让 WMS/仓库侧补齐商品编码、货品 SKU 或订单明细字段后重新同步订单。",
    "",
    ["订单号", "货品ID", "商品名", "国家", "数量", "出库时间", "创建时间", "状态"].join("\t"),
    ...rows.map((row) => [
      row.orderNo || row.orderId || "-",
      row.goodsSkuId || "-",
      row.productName || "-",
      row.country || "-",
      row.quantity,
      row.shippedAt || "-",
      row.createdAt || "-",
      row.status || "-",
    ].join("\t")),
  ].join("\n");
}

function movementUnmatchedSkuGovernanceText(item: MovementWarehouseDiagnostic) {
  const rows = movementUnmatchedSkuRows(item);
  return [
    `仓库：${item.warehouseName || item.warehouseId}`,
    `诊断：${item.reasonLabel || item.reason}`,
    "请补齐产品档案、国家 SKU 或仓库 SKU 映射后重新同步订单。",
    "",
    ["SKU", "国家", "订单行", "数量", "首次出库", "最近出库"].join("\t"),
    ...rows.map((row) => [
      row.sku || "-",
      row.country || "-",
      row.orderRows,
      row.quantity,
      row.firstShippedAt || "-",
      row.lastShippedAt || row.sampleShippedAt || "-",
    ].join("\t")),
  ].join("\n");
}

function movementOutOfWindowSkuText(item: MovementWarehouseDiagnostic) {
  const rows = movementOutOfWindowSkuRows(item);
  return [
    `仓库：${item.warehouseName || item.warehouseId}`,
    `诊断：${item.reasonLabel || item.reason}`,
    "这些订单未计入当前近 90 天动销窗口。请确认是否需要调整统计窗口、重同步近期订单，或按历史停销处理。",
    "",
    ["SKU", "国家", "订单行", "数量", "首次出库", "最近出库", "最近距今天数", "最远距今天数"].join("\t"),
    ...rows.map((row) => [
      row.sku || "-",
      row.country || "-",
      row.orderRows,
      row.quantity,
      row.firstShippedAt || "-",
      row.lastShippedAt || row.sampleShippedAt || "-",
      row.minAgeDays ?? "-",
      row.maxAgeDays ?? "-",
    ].join("\t")),
  ].join("\n");
}

function MovementDiagnosticsPanel({
  diagnostics,
  onSelectWarehouse,
  onSyncWarehouseOrders,
  syncing,
}: {
  diagnostics: MovementWarehouseDiagnostic[];
  onSelectWarehouse: (warehouseId: string) => void;
  onSyncWarehouseOrders: (warehouseId: string) => void;
  syncing: boolean;
}) {
  const [copyMessage, setCopyMessage] = React.useState("");
  if (!diagnostics.length) return null;
  const problemCount = diagnostics.filter((item) => diagnosticTone(item) !== "good").length;
  const problemDiagnostics = diagnostics.filter((item) => diagnosticTone(item) !== "good");
  const diagnosticCsv = [
    ["仓库", "国家", "WMS", "诊断", "授权", "库存行", "库存SKU", "订单行", "近90天订单", "已匹配订单", "SKU兜底匹配", "未匹配订单", "窗口外订单", "缺SKU订单", "最近同步任务", "失败分片", "缺SKU订单清单", "未匹配SKU治理清单", "窗口外SKU清单", "消息"],
    ...diagnostics.map((item) => [
      item.warehouseName,
      item.country,
      item.providerName || item.providerId,
      item.reasonLabel,
      item.hasCredentials ? "已授权" : "未授权",
      item.inventoryRows,
      item.inventorySku,
      item.orderRows,
      item.recentOrderRows,
      item.matchedOrderRows,
      item.skuFallbackMatchedRows,
      item.unmatchedOrderRows,
      item.outOfWindowOrderRows,
      item.missingSkuOrderRows,
      item.latestOrderSyncJob ? `${item.latestOrderSyncJob.status}; ${item.latestOrderSyncJob.completedChunks}/${item.latestOrderSyncJob.totalChunks}; failed=${item.latestOrderSyncJob.failedChunks}; orders=${item.latestOrderSyncJob.orderCount}; ${item.latestOrderSyncJob.lastMessage}` : "",
      item.latestOrderSyncJob?.failedChunkSamples?.map((chunk) => `${chunk.from}~${chunk.to}: ${chunk.message}`).join("; ") || "",
      movementMissingSkuOrderRows(item).map((row) => `${row.orderNo || row.orderId || "-"}/${row.productName || row.goodsSkuId || "-"}/${row.quantity}/${row.shippedAt || row.createdAt || "-"}`).join("; "),
      movementUnmatchedSkuRows(item).map((row) => `${row.sku}/${row.country}/${row.orderRows}单/最近${row.lastShippedAt || row.sampleShippedAt}`).join("; "),
      movementOutOfWindowSkuRows(item).map((row) => `${row.sku}/${row.country}/${row.orderRows}单/最近${row.lastShippedAt || row.sampleShippedAt}/距今${row.minAgeDays ?? "-"}天`).join("; "),
      [item.actionTitle, ...(item.actionItems || []), item.message].filter(Boolean).join(" | "),
    ]),
  ].map((row) => row.map(csvCell).join(",")).join("\n");

  async function copyDiagnosticSummary() {
    const rows = problemDiagnostics.length ? problemDiagnostics : diagnostics;
    const text = rows.map((item) => [
      `${item.warehouseName}：${item.reasonLabel}`,
      `库存SKU ${formatNumber(item.inventorySku)}`,
      `近90天订单 ${formatNumber(item.recentOrderRows)}`,
      `已匹配 ${formatNumber(item.matchedOrderRows)}`,
      item.unmatchedOrderRows ? `未匹配 ${formatNumber(item.unmatchedOrderRows)}（${item.unmatchedSamples.map((sample) => sample.sku).join("、")}）` : "",
      item.outOfWindowOrderRows ? `窗口外 ${formatNumber(item.outOfWindowOrderRows)}` : "",
      item.actionTitle ? `处理建议：${item.actionTitle}` : "",
      item.actionItems?.length ? `下一步：${item.actionItems.join("；")}` : "",
      item.message || "",
    ].filter(Boolean).join("；")).join("\n");
    await navigator.clipboard.writeText(text);
    setCopyMessage(`已复制 ${formatNumber(rows.length)} 个仓库诊断摘要`);
    window.setTimeout(() => setCopyMessage(""), 2200);
  }

  async function copyWarehouseDiagnostic(item: MovementWarehouseDiagnostic) {
    await navigator.clipboard.writeText(movementDiagnosticSupportText(item));
    setCopyMessage(`已复制 ${item.warehouseName || item.warehouseId} 排障单`);
    window.setTimeout(() => setCopyMessage(""), 2200);
  }

  async function copyUnmatchedSkuGovernance(item: MovementWarehouseDiagnostic) {
    await navigator.clipboard.writeText(movementUnmatchedSkuGovernanceText(item));
    setCopyMessage(`已复制 ${item.warehouseName || item.warehouseId} 未匹配 SKU 治理清单`);
    window.setTimeout(() => setCopyMessage(""), 2200);
  }

  async function copyMissingSkuOrders(item: MovementWarehouseDiagnostic) {
    await copyText(movementMissingSkuOrderText(item));
    setCopyMessage(`已复制 ${item.warehouseName || item.warehouseId} 缺 SKU 订单清单`);
    window.setTimeout(() => setCopyMessage(""), 2200);
  }

  async function copyOutOfWindowSkus(item: MovementWarehouseDiagnostic) {
    await navigator.clipboard.writeText(movementOutOfWindowSkuText(item));
    setCopyMessage(`已复制 ${item.warehouseName || item.warehouseId} 超窗订单清单`);
    window.setTimeout(() => setCopyMessage(""), 2200);
  }

  function downloadUnmatchedSkuGovernance(item: MovementWarehouseDiagnostic) {
    const rows = [
      ["仓库", "仓库ID", "诊断", "SKU", "国家", "订单行", "数量", "首次出库", "最近出库", "建议动作"],
      ...movementUnmatchedSkuRows(item).map((row) => [
        item.warehouseName || item.warehouseId,
        item.warehouseId,
        item.reasonLabel || item.reason,
        row.sku,
        row.country,
        row.orderRows,
        row.quantity,
        row.firstShippedAt,
        row.lastShippedAt || row.sampleShippedAt,
        "补齐产品档案/国家SKU/仓库SKU映射后重新同步订单",
      ]),
    ];
    downloadTextFile(`tongzhou-unmatched-sku-${item.warehouseId}-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((row) => row.map(csvCell).join(",")).join("\n"), "text/csv;charset=utf-8");
  }

  function downloadMissingSkuOrders(item: MovementWarehouseDiagnostic) {
    const rows = [
      ["仓库", "仓库ID", "诊断", "订单号", "订单ID", "货品ID", "商品名", "国家", "数量", "出库时间", "创建时间", "状态", "建议动作"],
      ...movementMissingSkuOrderRows(item).map((row) => [
        item.warehouseName || item.warehouseId,
        item.warehouseId,
        item.reasonLabel || item.reason,
        row.orderNo,
        row.orderId,
        row.goodsSkuId,
        row.productName,
        row.country,
        row.quantity,
        row.shippedAt,
        row.createdAt,
        row.status,
        "让WMS/仓库侧补齐订单明细SKU后重新同步订单",
      ]),
    ];
    downloadTextFile(`tongzhou-missing-sku-orders-${item.warehouseId}-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((row) => row.map(csvCell).join(",")).join("\n"), "text/csv;charset=utf-8");
  }

  function downloadOutOfWindowSkus(item: MovementWarehouseDiagnostic) {
    const rows = [
      ["仓库", "仓库ID", "诊断", "SKU", "国家", "订单行", "数量", "首次出库", "最近出库", "最近距今天数", "最远距今天数", "建议动作"],
      ...movementOutOfWindowSkuRows(item).map((row) => [
        item.warehouseName || item.warehouseId,
        item.warehouseId,
        item.reasonLabel || item.reason,
        row.sku,
        row.country,
        row.orderRows,
        row.quantity,
        row.firstShippedAt,
        row.lastShippedAt || row.sampleShippedAt,
        row.minAgeDays ?? "",
        row.maxAgeDays ?? "",
        "确认是否调整动销统计窗口/重同步近期订单/按历史停销处理",
      ]),
    ];
    downloadTextFile(`tongzhou-out-of-window-orders-${item.warehouseId}-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((row) => row.map(csvCell).join(",")).join("\n"), "text/csv;charset=utf-8");
  }

  function downloadDiagnostics() {
    downloadTextFile(`tongzhou-movement-diagnostics-${new Date().toISOString().slice(0, 10)}.csv`, diagnosticCsv, "text/csv;charset=utf-8");
  }

  return (
    <section className="panel movement-diagnostics-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Warehouse Diagnosis</p>
          <h2>仓库动销诊断</h2>
        </div>
        <div className="diagnostic-actions">
          <span className={`status-pill ${problemCount ? "warning" : "good"}`}>{problemCount ? `${problemCount} 个需关注` : "全部正常"}</span>
          <button className="ghost-button compact-button" type="button" onClick={() => void copyDiagnosticSummary()}>复制摘要</button>
          <button className="ghost-button compact-button" type="button" onClick={downloadDiagnostics}>下载诊断</button>
        </div>
      </div>
      {copyMessage ? <div className="notice good compact-notice">{copyMessage}</div> : null}
      <div className="movement-diagnostics-grid">
        {diagnostics.map((item) => (
          <article
            key={item.warehouseId}
            className={`movement-diagnostic-card ${diagnosticTone(item)}`}
          >
            <div>
              <strong>{item.warehouseName}</strong>
              <span>{item.providerName || item.providerId || "WMS"} · {item.country || "未配置国家"}</span>
            </div>
            <span className={`status-pill ${diagnosticTone(item)}`}>{item.reasonLabel}</span>
            <dl>
              <div>
                <dt>库存 SKU</dt>
                <dd>{formatNumber(item.inventorySku)}</dd>
              </div>
              <div>
                <dt>近90天订单</dt>
                <dd>{formatNumber(item.recentOrderRows)}</dd>
              </div>
              <div>
                <dt>已匹配订单</dt>
                <dd>{formatNumber(item.matchedOrderRows)}</dd>
              </div>
              <div>
                <dt>超窗订单</dt>
                <dd>{formatNumber(item.outOfWindowOrderRows)}</dd>
              </div>
            </dl>
            {item.skuFallbackMatchedRows ? <small>其中 {formatNumber(item.skuFallbackMatchedRows)} 单使用 SKU 唯一兜底匹配。</small> : null}
            {item.latestOrderSyncJob ? (
              <div className="movement-diagnostic-action order-sync-diagnostic">
                <strong>最近订单同步：{item.latestOrderSyncJob.status}</strong>
                <small>
                  分片 {formatNumber(item.latestOrderSyncJob.completedChunks)} / {formatNumber(item.latestOrderSyncJob.totalChunks)}
                  {item.latestOrderSyncJob.failedChunks ? `；失败 ${formatNumber(item.latestOrderSyncJob.failedChunks)}` : ""}
                  {`；订单 ${formatNumber(item.latestOrderSyncJob.orderCount)}`}
                </small>
                {item.latestOrderSyncJob.currentChunkLabel ? <small>当前分片：{item.latestOrderSyncJob.currentChunkLabel}</small> : null}
                {item.latestOrderSyncJob.lastMessage ? <small>{item.latestOrderSyncJob.lastMessage}</small> : null}
                {item.latestOrderSyncJob.failedChunkSamples?.length ? (
                  <small>失败分片：{item.latestOrderSyncJob.failedChunkSamples.map((chunk) => `${chunk.from}~${chunk.to}`).join("、")}</small>
                ) : null}
              </div>
            ) : null}
            {item.unmatchedOrderRows ? (
              <small>
                未匹配 {formatNumber(item.unmatchedOrderRows)} 单：
                {movementUnmatchedSkuRows(item).slice(0, 5).map((row) => `${row.sku}(${formatNumber(row.orderRows)}单)`).join("、")}
                {movementUnmatchedSkuRows(item).length > 5 ? ` 等 ${formatNumber(movementUnmatchedSkuRows(item).length)} 个 SKU` : ""}
              </small>
            ) : null}
            {item.outOfWindowOrderRows && movementOutOfWindowSkuRows(item).length ? (
              <small>
                超窗 {formatNumber(item.outOfWindowOrderRows)} 单：
                {movementOutOfWindowSkuRows(item).slice(0, 4).map((row) => `${row.sku}(${row.lastShippedAt || "-"}，距今${row.minAgeDays ?? "-"}天)`).join("、")}
              </small>
            ) : null}
            {item.missingSkuOrderRows && movementMissingSkuOrderRows(item).length ? (
              <small>
                缺 SKU {formatNumber(item.missingSkuOrderRows)} 单：
                {movementMissingSkuOrderRows(item).slice(0, 4).map((row) => `${row.orderNo || row.orderId || "无订单号"}(${row.productName || row.goodsSkuId || "无商品名"})`).join("、")}
              </small>
            ) : null}
            {item.actionTitle ? (
              <div className="movement-diagnostic-action">
                <strong>{item.actionTitle}</strong>
                {(item.actionItems || []).map((action) => <small key={action}>{action}</small>)}
              </div>
            ) : null}
            {item.message ? <small>{item.message}</small> : null}
            <div className="movement-diagnostic-card-actions">
              <button className="ghost-button compact-button" type="button" onClick={() => void copyWarehouseDiagnostic(item)}>
                复制排障单
              </button>
              {movementUnmatchedSkuRows(item).length ? (
                <>
                  <button className="ghost-button compact-button" type="button" onClick={() => void copyUnmatchedSkuGovernance(item)}>
                    复制未匹配SKU
                  </button>
                  <button className="ghost-button compact-button" type="button" onClick={() => downloadUnmatchedSkuGovernance(item)}>
                    下载治理清单
                  </button>
                </>
              ) : null}
              {movementOutOfWindowSkuRows(item).length ? (
                <>
                  <button className="ghost-button compact-button" type="button" onClick={() => void copyOutOfWindowSkus(item)}>
                    复制超窗订单
                  </button>
                  <button className="ghost-button compact-button" type="button" onClick={() => downloadOutOfWindowSkus(item)}>
                    下载超窗清单
                  </button>
                </>
              ) : null}
              {movementMissingSkuOrderRows(item).length ? (
                <>
                  <button className="ghost-button compact-button" type="button" onClick={() => void copyMissingSkuOrders(item)}>
                    复制缺SKU订单
                  </button>
                  <button className="ghost-button compact-button" type="button" onClick={() => downloadMissingSkuOrders(item)}>
                    下载缺SKU清单
                  </button>
                </>
              ) : null}
              <button className="ghost-button compact-button" type="button" onClick={() => onSelectWarehouse(item.warehouseId)}>
                查看该仓 SKU
              </button>
              <button className="ghost-button compact-button" type="button" disabled={syncing || item.running || !item.hasCredentials} onClick={() => onSyncWarehouseOrders(item.warehouseId)}>
                {item.running ? "同步中" : "重同步订单"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function MovementBoard({
  movementPayload,
  orderSyncJob,
  initialWarehouse,
  onSyncOrders,
  syncing,
}: {
  movementPayload: MovementPayload | null;
  orderSyncJob: OrderSyncJob | null;
  initialWarehouse: string;
  onSyncOrders: (warehouseIds?: string[]) => void;
  syncing: boolean;
}) {
  const [country, setCountry] = React.useState("全部");
  const [warehouse, setWarehouse] = React.useState("全部");
  const [status, setStatus] = React.useState("全部");
  const [keywordInput, setKeywordInput] = React.useState("");
  const [keyword, setKeyword] = React.useState("");
  const [filterPresets, setFilterPresets] = React.useState<MovementFilterPreset[]>(readMovementFilterPresets);
  const [presetName, setPresetName] = React.useState("");
  const [sortKey, setSortKey] = React.useState<MovementSortKey>("sales90");
  const [sortDirection, setSortDirection] = React.useState<SortDirection>("desc");
  const [riskCopyMessage, setRiskCopyMessage] = React.useState("");

  React.useEffect(() => {
    if (initialWarehouse) setWarehouse(initialWarehouse);
  }, [initialWarehouse]);

  const items = movementPayload?.items ?? [];
  const warehouses = React.useMemo(() => {
    const values = new Map<string, string>();
    for (const item of items) {
      for (const detail of [...(item.warehouseBreakdown || []), ...(item.salesWarehouseBreakdown || [])]) {
        const id = detail.warehouseId || detail.warehouseName;
        if (id) values.set(id, detail.warehouseName || detail.warehouseId);
      }
    }
    return Array.from(values, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }, [items]);
  const statuses = ["全部", "缺货", "补货预警", "滞销", "慢销", "无动销数据", "健康"];
  const backgroundWarehouses = movementPayload?.syncState?.backgroundRunningWarehouses
    || (movementPayload?.orderSyncResults || []).filter((result) => result.backgroundRunning).map((result) => ({ warehouseId: result.warehouseId, message: result.message, orderCount: result.orderCount }));
  const failedAuthorizedWarehouses = (movementPayload?.orderSyncResults || []).filter((result) => !result.ok && result.hasCredentials && !result.backgroundRunning);
  const warehouseDiagnostics = movementPayload?.warehouseDiagnostics || [];
  const activeJob = orderSyncJob || movementPayload?.orderSyncJob || null;
  const jobRunning = Boolean(activeJob && ["queued", "running"].includes(activeJob.status));
  const selectedWarehouseCountry = warehouseDiagnostics.find((item) => item.warehouseId === warehouse || item.warehouseName === warehouse)?.country || "";
  const scopedItems = React.useMemo(() => (
    warehouse === "全部"
      ? items
      : items.map((item) => movementWarehouseScopedItem(item, warehouse, selectedWarehouseCountry)).filter((item): item is MovementPayload["items"][number] => Boolean(item))
  ), [items, selectedWarehouseCountry, warehouse]);
  const countries = uniqueSorted(scopedItems.map((item) => item.country));
  const filteredItems = scopedItems.filter((item) => {
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
  const riskExecutionItems = sortedItems.filter((item) => item.status !== "健康" || item.source === "warehouse_only" || Boolean(item.dataGap));
  const updateSort = (nextKey: MovementSortKey) => {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(["sku", "country", "status"].includes(nextKey) ? "asc" : "desc");
  };
  function persistFilterPresets(next: MovementFilterPreset[]) {
    setFilterPresets(next);
    saveMovementFilterPresets(next);
  }

  function saveCurrentFilterPreset() {
    const name = presetName.trim() || `${country}/${warehouse}/${status}`;
    const nextPreset: MovementFilterPreset = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      country,
      warehouse,
      status,
      keyword,
      createdAt: new Date().toISOString(),
    };
    persistFilterPresets([nextPreset, ...filterPresets.filter((item) => item.name !== name)].slice(0, 12));
    setPresetName("");
  }

  function applyFilterPreset(preset: MovementFilterPreset) {
    setCountry(preset.country || "全部");
    setWarehouse(preset.warehouse || "全部");
    setStatus(preset.status || "全部");
    setKeywordInput(preset.keyword || "");
    setKeyword(preset.keyword || "");
  }

  function removeFilterPreset(id: string) {
    persistFilterPresets(filterPresets.filter((item) => item.id !== id));
  }

  async function copyRiskExecutionList() {
    await copyText(movementRiskExecutionText(riskExecutionItems));
    setRiskCopyMessage(`已复制 ${formatNumber(riskExecutionItems.length)} 个风险 SKU 执行清单`);
    window.setTimeout(() => setRiskCopyMessage(""), 2000);
  }

  function downloadRiskExecutionCsv() {
    downloadTextFile(`tongzhou-movement-risk-queue-${new Date().toISOString().slice(0, 10)}.csv`, movementRiskExecutionCsv(riskExecutionItems), "text/csv;charset=utf-8");
    setRiskCopyMessage("已下载动销风险执行 CSV");
    window.setTimeout(() => setRiskCopyMessage(""), 2000);
  }

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
            {movementPayload?.syncState?.usingCachedOrders ? <span>当前使用最近一次成功缓存</span> : null}
          </div>
        </div>
        <button className="sync-button" onClick={() => onSyncOrders()} disabled={syncing || jobRunning}>
          <RefreshCw size={16} className={syncing || jobRunning ? "spinning" : ""} />
          {syncing ? "同步中" : "同步近90天订单"}
        </button>
      </section>

      {activeJob ? (
        <section className={`order-sync-status ${jobRunning ? "running" : activeJob.status === "completed" ? "good" : "warning"}`}>
          <div>
            <strong>订单后台同步：{activeJob.status}</strong>
            <span>{activeJob.currentWarehouseName || "无当前仓库"} {activeJob.currentChunkLabel ? `· ${activeJob.currentChunkLabel}` : ""}</span>
          </div>
          <div className="order-sync-progress">
            <span>{formatNumber(activeJob.completedChunks || 0)} / {formatNumber(activeJob.totalChunks || 0)} 分片</span>
            <span>{formatNumber(activeJob.totalOrders || 0)} 条订单</span>
            <span>{activeJob.completedAt ? formatDateTime(activeJob.completedAt) : activeJob.startedAt ? formatDateTime(activeJob.startedAt) : "等待开始"}</span>
          </div>
        </section>
      ) : null}

      {movementPayload?.warehouseFreshness?.length ? (
        <section className="warehouse-freshness-strip">
          {movementPayload.warehouseFreshness.map((item) => (
            <button key={item.warehouseId} type="button" className={`freshness-chip ${item.running ? "running" : item.failed ? "warning" : item.ok ? "good" : "muted"}`} onClick={() => setWarehouse(item.warehouseId)}>
              <strong>{item.warehouseName}</strong>
              <span>{item.running ? "同步中" : item.failed ? "异常" : item.ok ? "已更新" : "无订单"}</span>
              <small>{formatNumber(item.orderCount)} 单 {item.lastCompletedAt ? formatDateTime(item.lastCompletedAt) : ""}</small>
            </button>
          ))}
        </section>
      ) : null}

      <MovementDiagnosticsPanel
        diagnostics={warehouseDiagnostics}
        onSelectWarehouse={setWarehouse}
        onSyncWarehouseOrders={(warehouseId) => onSyncOrders([warehouseId])}
        syncing={syncing || jobRunning}
      />

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
        <select value={warehouse} onChange={(event) => setWarehouse(event.target.value)}>
          <option value="全部">全部仓库</option>
          {warehouses.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
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

      <section className="movement-filter-presets">
        <div className="preset-save-row">
          <label>
            <span>保存当前筛选</span>
            <input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder={`${country}/${warehouse}/${status}`} />
          </label>
          <button className="ghost-button compact-button" type="button" onClick={saveCurrentFilterPreset}>保存预设</button>
        </div>
        {filterPresets.length ? (
          <div className="preset-chip-row" aria-label="已保存的动销筛选">
            {filterPresets.map((preset) => (
              <span className="preset-chip" key={preset.id}>
                <button type="button" onClick={() => applyFilterPreset(preset)}>
                  {preset.name}
                  <small>{[preset.country, preset.status, preset.keyword].filter((item) => item && item !== "全部").join(" / ") || "全部条件"}</small>
                </button>
                <button type="button" aria-label={`删除筛选预设：${preset.name}`} onClick={() => removeFilterPreset(preset.id)}>
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <span className="preset-empty">还没有保存的筛选。可把常看的仓库、状态或关键词保存为日常巡检入口。</span>
        )}
      </section>

      {backgroundWarehouses.length ? (
        <section className="notice warning">
          部分仓库订单正在后台继续同步：{backgroundWarehouses.map((result) => `${result.warehouseId}（${result.message || "后台同步中"}）`).join("、")}。同步完成后刷新本页即可看到补齐数据。
        </section>
      ) : null}

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
          <div className="movement-risk-toolbar">
            <span className="status-pill muted">{formatNumber(filteredItems.length)} 个 SKU</span>
            <span className="status-pill warning">{formatNumber(riskExecutionItems.length)} 个风险</span>
            <button className="ghost-button compact-button" type="button" onClick={() => void copyRiskExecutionList()} disabled={!riskExecutionItems.length}>
              <Copy size={14} />
              复制风险清单
            </button>
            <button className="ghost-button compact-button" type="button" onClick={downloadRiskExecutionCsv} disabled={!riskExecutionItems.length}>
              <Download size={14} />
              下载风险CSV
            </button>
          </div>
        </div>
        {riskCopyMessage ? <div className="notice good compact-notice">{riskCopyMessage}</div> : null}
        <div className="movement-table">
          <div className="movement-row movement-head">
            <SortHeader label="SKU / 产品" sortKey="sku" activeKey={sortKey} direction={sortDirection} onSort={updateSort} />
            <SortHeader label="国家" sortKey="country" activeKey={sortKey} direction={sortDirection} onSort={updateSort} />
            <SortHeader label="库存" sortKey="availableQty" activeKey={sortKey} direction={sortDirection} onSort={updateSort} />
            <SortHeader label="3天" sortKey="sales3" activeKey={sortKey} direction={sortDirection} onSort={updateSort} />
            <SortHeader label="7天" sortKey="sales7" activeKey={sortKey} direction={sortDirection} onSort={updateSort} />
            <SortHeader label="15天" sortKey="sales15" activeKey={sortKey} direction={sortDirection} onSort={updateSort} />
            <SortHeader label="30天" sortKey="sales30" activeKey={sortKey} direction={sortDirection} onSort={updateSort} />
            <SortHeader label="60天" sortKey="sales60" activeKey={sortKey} direction={sortDirection} onSort={updateSort} />
            <SortHeader label="90天" sortKey="sales90" activeKey={sortKey} direction={sortDirection} onSort={updateSort} />
            <SortHeader label="日均销量" sortKey="avgDaily7" activeKey={sortKey} direction={sortDirection} onSort={updateSort} />
            <span>趋势</span>
            <SortHeader label="可售天数" sortKey="daysCover" activeKey={sortKey} direction={sortDirection} onSort={updateSort} />
            <SortHeader label="状态" sortKey="status" activeKey={sortKey} direction={sortDirection} onSort={updateSort} />
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
              <SalesWindowCell value={item.sales3} />
              <SalesWindowCell value={item.sales7} />
              <SalesWindowCell value={item.sales15} />
              <SalesWindowCell value={item.sales30} />
              <SalesWindowCell value={item.sales60} />
              <SalesWindowCell value={item.sales90} />
              <span className="movement-daily">
                <strong>{formatDecimal(item.avgDaily7)}</strong>
                <small>30日 {formatDecimal(item.avgDaily30)}</small>
              </span>
              <Sparkline values={item.trend30} />
              <DaysCoverInsight item={item} />
              <MovementStatusInsight item={item} />
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function StockupCenter({
  stockupPayload,
  workflowPayload,
  onRefreshWorkflow,
  onSyncStockup,
  onDecision,
  onCreatePlan,
  onUpdatePlanStatus,
  syncing,
}: {
  stockupPayload: StockupPayload | null;
  workflowPayload: StockupWorkflowPayload | null;
  onRefreshWorkflow: () => Promise<StockupWorkflowPayload>;
  onSyncStockup: () => void;
  onDecision: (item: StockupPayload["recommendations"][number], action: "accept" | "abandon" | "restore") => void;
  onCreatePlan: (item: StockupPayload["recommendations"][number], input: { quantity: number; planType: "purchase" | "outsourcing"; owner: string; expectedArrivalAt: string; note: string }) => Promise<void>;
  onUpdatePlanStatus: (id: string, status: "draft" | "ordered" | "in_production" | "arrived" | "cancelled") => Promise<void>;
  syncing: boolean;
}) {
  const recommendations = stockupPayload?.recommendations ?? [];
  const abandonedRecommendations = stockupPayload?.abandonedRecommendations ?? [];
  const plans = stockupPayload?.plans ?? [];
  const outsourcingQueue = stockupPayload?.outsourcingQueue ?? [];
  const inboundOrders = stockupPayload?.inboundOrders ?? [];
  const syncResults = stockupPayload?.syncResults ?? [];
  const acceptedRecommendations = recommendations.filter((item) => item.decisionStatus === "accepted" && !item.workflowDemandRecordId);
  const activePlans = plans.filter((plan) => !["arrived", "cancelled"].includes(plan.status));
  const arrivedPlans = plans
    .filter((plan) => plan.status === "arrived")
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  const [planDrafts, setPlanDrafts] = React.useState<Record<string, { open: boolean; quantity: number; planType: "purchase" | "outsourcing"; owner: string; expectedArrivalAt: string; note: string }>>({});
  const [planCopyMessage, setPlanCopyMessage] = React.useState("");
  const [reviewCopyMessage, setReviewCopyMessage] = React.useState("");
  const [workflowTab, setWorkflowTab] = React.useState<"overview" | "demands" | "execution" | "costs" | "coding">("overview");
  const [showPlanningTools, setShowPlanningTools] = React.useState(false);

  const currentCounts = workflowPayload?.counts;
  const actionQueue = [
    { tab: "coding" as const, label: "给外采新品分配 SKU", count: currentCounts?.codingQueue ?? 0, hint: "编码完成后才能进入正式执行" },
    { tab: "demands" as const, label: "受理并检查备货需求", count: currentCounts?.pendingDemands ?? 0, hint: "核对产品、数量、目的仓和备货方式" },
    { tab: "execution" as const, label: "推进采购 / 生产", count: currentCounts?.pendingExecutionLines ?? 0, hint: "更新已下单、已完工和检验合格数量" },
    { tab: "execution" as const, label: "登记实际发货", count: currentCounts?.pendingShipmentLines ?? 0, hint: "录入实际发货数量、重量和体积" },
    { tab: "costs" as const, label: "登记运费并分摊", count: currentCounts?.pendingCostShipments ?? 0, hint: "选择重量、体积、数量或货值口径" },
    { tab: "costs" as const, label: "复核并锁定到仓成本", count: currentCounts?.pendingLockShipments ?? 0, hint: "确认 SKU 到仓单价后锁定版本" },
  ].filter((item) => item.count > 0);
  const nextAction = actionQueue[0];

  function planFor(item: StockupPayload["recommendations"][number]) {
    return plans.find((plan) => plan.recommendationKey === item.recommendationKey && !["arrived", "cancelled"].includes(plan.status));
  }

  function draftFor(item: StockupPayload["recommendations"][number]) {
    const key = item.recommendationKey || `${item.country}-${item.sku}`;
    return planDrafts[key] || {
      open: false,
      quantity: Math.max(0, item.netReplenishQty || item.replenishQty || 0),
      planType: item.outsourcingInProductionQty > 0 ? "purchase" : "purchase",
      owner: "",
      expectedArrivalAt: "",
      note: "",
    };
  }

  function updatePlanDraft(item: StockupPayload["recommendations"][number], patch: Partial<ReturnType<typeof draftFor>>) {
    const key = item.recommendationKey || `${item.country}-${item.sku}`;
    setPlanDrafts((current) => ({ ...current, [key]: { ...draftFor(item), ...patch } }));
  }

  async function submitPlan(item: StockupPayload["recommendations"][number]) {
    const draft = draftFor(item);
    await onCreatePlan(item, {
      quantity: Number(draft.quantity) || 0,
      planType: draft.planType,
      owner: draft.owner,
      expectedArrivalAt: draft.expectedArrivalAt,
      note: draft.note,
    });
    const key = item.recommendationKey || `${item.country}-${item.sku}`;
    setPlanDrafts((current) => ({ ...current, [key]: { ...draft, open: false } }));
  }

  async function copyPlanExecutionSummary(targetPlans = activePlans) {
    await copyText(stockupPlanExecutionText(targetPlans));
    setPlanCopyMessage(targetPlans.length === 1 ? "已复制该备货计划下单信息" : `已复制 ${formatNumber(targetPlans.length)} 个未完成备货计划`);
    window.setTimeout(() => setPlanCopyMessage(""), 1800);
  }

  function downloadPlanExecutionCsv() {
    downloadTextFile(`tongzhou-stockup-plans-${new Date().toISOString().slice(0, 10)}.csv`, stockupPlanExecutionCsv(activePlans), "text/csv;charset=utf-8");
    setPlanCopyMessage("已下载备货计划执行 CSV");
    window.setTimeout(() => setPlanCopyMessage(""), 1800);
  }

  async function copyArrivedPlanReviewSummary() {
    await copyText(stockupPlanReviewText(arrivedPlans));
    setReviewCopyMessage(`已复制 ${formatNumber(arrivedPlans.length)} 个到仓复盘计划`);
    window.setTimeout(() => setReviewCopyMessage(""), 1800);
  }

  async function copyArrivedPlanReviewItem(plan: StockupPlanItem) {
    await copyText(stockupPlanReviewText([plan]));
    setReviewCopyMessage(`已复制 ${plan.sku} 到仓复盘`);
    window.setTimeout(() => setReviewCopyMessage(""), 1800);
  }

  function downloadArrivedPlanReviewCsv() {
    downloadTextFile(`tongzhou-stockup-arrived-review-${new Date().toISOString().slice(0, 10)}.csv`, stockupPlanReviewCsv(arrivedPlans), "text/csv;charset=utf-8");
    setReviewCopyMessage("已下载到仓复盘 CSV");
    window.setTimeout(() => setReviewCopyMessage(""), 1800);
  }

  const workflowTabs = [
    ["overview", "链路总览", workflowPayload?.counts.activeWorkItems ?? 0],
    ["demands", "备货需求", workflowPayload?.counts.pendingDemands ?? 0],
    ["execution", "供应执行", workflowPayload?.counts.activeExecutionLines ?? 0],
    ["costs", "发货与成本", (workflowPayload?.counts.pendingCostShipments ?? 0) + (workflowPayload?.counts.pendingLockShipments ?? 0)],
    ["coding", "新品编码", workflowPayload?.counts.codingQueue ?? 0],
  ] as const;

  return (
    <main className="movement-page stockup-page stockup-ops-page">
      <section className="stockup-command-bar">
        <div>
          <p className="eyebrow">今日备货工作台</p>
          <h2>{nextAction ? nextAction.label : "当前测试链路没有待办"}</h2>
          <p>{nextAction ? nextAction.hint : "可以从“备货需求”新建一条测试需求，系统会引导你完成后续步骤。"}</p>
        </div>
        <div className="stockup-command-actions">
          <span className="status-pill good"><Check size={14} />仅显示中台新流程数据</span>
          {nextAction ? <button className="sync-button" type="button" onClick={() => setWorkflowTab(nextAction.tab)}>处理 {nextAction.count} 项</button> : <button className="sync-button" type="button" onClick={() => setWorkflowTab("demands")}><Plus size={16} />新建测试需求</button>}
          <button className="ghost-button compact-button" type="button" disabled={syncing} onClick={() => void onRefreshWorkflow()} title="重新读取简道云业务数据"><RefreshCw size={15} className={syncing ? "spinning" : ""} />刷新</button>
        </div>
      </section>

      <section className="stockup-task-strip" aria-label="备货待办">
        {[
          ["demands", "需求", currentCounts?.pendingDemands ?? 0, "录入 / 受理"],
          ["coding", "编码", currentCounts?.codingQueue ?? 0, "新品分配 SKU"],
          ["execution", "执行", currentCounts?.activeExecutionLines ?? 0, "采购生产与发货"],
          ["costs", "成本", (currentCounts?.pendingCostShipments ?? 0) + (currentCounts?.pendingLockShipments ?? 0), "运费分摊与锁定"],
        ].map(([tab, label, count, note]) => <button type="button" key={String(tab)} onClick={() => setWorkflowTab(tab as typeof workflowTab)}><span>{label}</span><strong>{Number(count) > 0 ? formatNumber(Number(count)) : "—"}</strong><small>{note}</small></button>)}
      </section>

      <section className="stockup-workflow-shell">
        <div className="stockup-workflow-tabs" role="tablist" aria-label="备货业务链路">
          {workflowTabs.map(([key, label, count]) => (
            <button className={workflowTab === key ? "active" : ""} type="button" role="tab" aria-selected={workflowTab === key} onClick={() => setWorkflowTab(key)} key={key}>
              <span>{label}</span>
              <strong>{count > 0 ? formatNumber(count) : ""}</strong>
            </button>
          ))}
        </div>
        {workflowPayload?.historyHidden ? <div className="workflow-scope-note"><Check size={15} /><span>历史备货单已隐藏，本页只用于本轮中台链路测试；原数据仍安全保留在简道云。</span></div> : null}
        {workflowPayload?.warnings?.length ? (
          <div className="notice warning compact-notice">{workflowPayload.warnings.join("；")}</div>
        ) : null}
        {workflowTab === "overview" ? <StockupWorkflowOverview payload={workflowPayload} /> : null}
        {workflowTab === "demands" ? <StockupDemandWorkbench payload={workflowPayload} onRefresh={onRefreshWorkflow} /> : null}
        {workflowTab === "execution" ? <StockupExecutionWorkbench payload={workflowPayload} onRefresh={onRefreshWorkflow} /> : null}
        {workflowTab === "costs" ? <StockupCostWorkbench payload={workflowPayload} onRefresh={onRefreshWorkflow} /> : null}
        {workflowTab === "coding" ? <ProductCodingWorkbench payload={workflowPayload} onRefresh={onRefreshWorkflow} /> : null}
      </section>
      {workflowTab === "overview" ? <div className="stockup-legacy-tools"><div><strong>动销建议与 WMS 工具</strong><span>{showPlanningTools ? "已展开旧备货分析工具" : "默认收起，不影响本轮新流程测试"}</span></div><button className="ghost-button compact-button" type="button" onClick={() => setShowPlanningTools((current) => !current)}>{showPlanningTools ? "收起工具" : "展开工具"}</button>{showPlanningTools ? <div className="stockup-legacy-actions"><span>建议 SKU {formatNumber(stockupPayload?.counts.recommendations ?? 0)}</span><span>净建议数量 {formatNumber(stockupPayload?.counts.netRecommendedQty ?? 0)}</span><button className="ghost-button compact-button" onClick={onSyncStockup} disabled={syncing}>{syncing ? "同步中" : "同步 WMS 备货单"}</button></div> : null}</div> : null}
      {workflowTab === "overview" && acceptedRecommendations.length ? (
        <section className="panel stockup-panel accepted-stockup-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Accepted Tasks</p>
              <h2>待送入正式流程</h2>
            </div>
            <span className="status-pill good">{formatNumber(acceptedRecommendations.length)} 个 SKU</span>
          </div>
          <div className="accepted-task-grid">
            {acceptedRecommendations.slice(0, 8).map((item) => (
              <article key={item.recommendationKey || `${item.country}-${item.sku}`}>
                <div>
                  <strong>{item.sku}</strong>
                  <span>{item.name}</span>
                </div>
                <dl>
                  <div>
                    <dt>净建议</dt>
                    <dd>{formatNumber(item.netReplenishQty)} {item.unit}</dd>
                  </div>
                  <div>
                    <dt>可售天数</dt>
                    <dd>{formatDaysCover(item.daysCover)} 天</dd>
                  </div>
                  <div>
                    <dt>委外在产</dt>
                    <dd>{formatNumber(item.outsourcingInProductionQty)} {item.unit}</dd>
                  </div>
                </dl>
                <StockupFormulaInsight item={item} />
                <small>{item.decisionAt ? `采纳时间：${formatDateTime(item.decisionAt)}；尚未写入简道云正式需求。` : "已采纳，尚未写入简道云正式需求。"}</small>
                {planFor(item) ? (
                  <div className="accepted-plan-summary">
                    <span className="status-pill good">{stockupPlanStatusLabel(planFor(item)?.status || "")}</span>
                    <small>{stockupPlanTypeLabel(planFor(item)?.planType || "")} · {formatNumber(planFor(item)?.quantity || 0)} {planFor(item)?.unit || item.unit}</small>
                    <small>负责人：{planFor(item)?.owner || "未指定"} · 预计到仓：{planFor(item)?.expectedArrivalAt || "未设置"}</small>
                  </div>
                ) : null}
                {!planFor(item) && draftFor(item).open ? (
                  <div className="stockup-plan-form">
                    <label>
                      <span>计划数量</span>
                      <input type="number" min={0} value={draftFor(item).quantity} onChange={(event) => updatePlanDraft(item, { quantity: Number(event.target.value) })} />
                    </label>
                    <label>
                      <span>计划类型</span>
                      <select value={draftFor(item).planType} onChange={(event) => updatePlanDraft(item, { planType: event.target.value as "purchase" | "outsourcing" })}>
                        <option value="purchase">采购补货</option>
                        <option value="outsourcing">委外排产</option>
                      </select>
                    </label>
                    <label>
                      <span>负责人</span>
                      <input value={draftFor(item).owner} onChange={(event) => updatePlanDraft(item, { owner: event.target.value })} placeholder="采购/跟单负责人" />
                    </label>
                    <label>
                      <span>预计到仓</span>
                      <input type="date" value={draftFor(item).expectedArrivalAt} onChange={(event) => updatePlanDraft(item, { expectedArrivalAt: event.target.value })} />
                    </label>
                    <label className="stockup-plan-note">
                      <span>备注</span>
                      <textarea value={draftFor(item).note} onChange={(event) => updatePlanDraft(item, { note: event.target.value })} placeholder="供应商、批次、审批或异常说明" />
                    </label>
                    <div className="stockup-plan-actions">
                      <button className="sync-button compact-button" type="button" disabled={syncing || !draftFor(item).quantity} onClick={() => void submitPlan(item)}>创建计划</button>
                      <button className="ghost-button compact-button" type="button" disabled={syncing} onClick={() => updatePlanDraft(item, { open: false })}>取消</button>
                    </div>
                  </div>
                ) : null}
                <div className="accepted-task-actions">
                  <button className="sync-button compact-button" type="button" disabled={syncing} onClick={() => onDecision(item, "accept")}>送入正式采购 / 生产流程</button>
                  {planFor(item) ? (
                    <div className="stockup-plan-actions">
                      <button className="ghost-button compact-button" type="button" disabled={syncing} onClick={() => void onUpdatePlanStatus(planFor(item)!.id, "ordered")}>已下单</button>
                      <button className="ghost-button compact-button" type="button" disabled={syncing} onClick={() => void onUpdatePlanStatus(planFor(item)!.id, "in_production")}>生产/在途</button>
                      <button className="ghost-button compact-button" type="button" disabled={syncing} onClick={() => void onUpdatePlanStatus(planFor(item)!.id, "arrived")}>已到仓</button>
                    </div>
                  ) : (
                    <button className="sync-button compact-button" type="button" disabled={syncing} onClick={() => updatePlanDraft(item, { open: true })}>创建计划</button>
                  )}
                  <button className="ghost-button compact-button" type="button" disabled={syncing} onClick={() => onDecision(item, "restore")}>退回提醒</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {workflowTab === "overview" && showPlanningTools && activePlans.length ? (
        <section className="panel stockup-panel stockup-plan-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Plan Tracking</p>
              <h2>备货计划跟踪</h2>
            </div>
            <div className="stockup-plan-toolbar">
              <span className="status-pill good">{formatNumber(activePlans.length)} 个未完成计划</span>
              <button className="ghost-button compact-button" type="button" onClick={() => void copyPlanExecutionSummary()}>
                <Copy size={14} />
                复制执行摘要
              </button>
              <button className="ghost-button compact-button" type="button" onClick={downloadPlanExecutionCsv}>
                <Download size={14} />
                下载执行CSV
              </button>
            </div>
          </div>
          {planCopyMessage ? <div className="notice good compact-notice">{planCopyMessage}</div> : null}
          <div className="stockup-plan-grid">
            {activePlans.slice(0, 12).map((plan) => (
              <article key={plan.id}>
                <div>
                  <strong>{plan.sku}</strong>
                  <span>{plan.name || plan.country}</span>
                </div>
                <dl>
                  <div>
                    <dt>计划数量</dt>
                    <dd>{formatNumber(plan.quantity)} {plan.unit}</dd>
                  </div>
                  <div>
                    <dt>类型</dt>
                    <dd>{stockupPlanTypeLabel(plan.planType)}</dd>
                  </div>
                  <div>
                    <dt>状态</dt>
                    <dd>{stockupPlanStatusLabel(plan.status)}</dd>
                  </div>
                </dl>
                <small>负责人：{plan.owner || "未指定"} · 预计到仓：{plan.expectedArrivalAt || "未设置"}</small>
                {plan.note ? <small>{plan.note}</small> : null}
                <div className="stockup-plan-actions">
                  <button className="ghost-button compact-button" type="button" onClick={() => void copyPlanExecutionSummary([plan])}>
                    复制下单信息
                  </button>
                  <button className="ghost-button compact-button" type="button" disabled={syncing} onClick={() => void onUpdatePlanStatus(plan.id, "ordered")}>已下单</button>
                  <button className="ghost-button compact-button" type="button" disabled={syncing} onClick={() => void onUpdatePlanStatus(plan.id, "in_production")}>生产/在途</button>
                  <button className="ghost-button compact-button" type="button" disabled={syncing} onClick={() => void onUpdatePlanStatus(plan.id, "arrived")}>已到仓</button>
                  <button className="ghost-button compact-button danger-button" type="button" disabled={syncing} onClick={() => void onUpdatePlanStatus(plan.id, "cancelled")}>取消</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {workflowTab === "overview" && showPlanningTools && arrivedPlans.length ? (
        <section className="panel stockup-panel stockup-plan-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Arrival Review</p>
              <h2>已到仓待复盘</h2>
            </div>
            <div className="stockup-plan-toolbar">
              <span className="status-pill warning">{formatNumber(arrivedPlans.length)} 个到仓计划</span>
              <button className="ghost-button compact-button" type="button" onClick={() => void copyArrivedPlanReviewSummary()}>
                <Copy size={14} />
                复制复盘摘要
              </button>
              <button className="ghost-button compact-button" type="button" onClick={downloadArrivedPlanReviewCsv}>
                <Download size={14} />
                下载复盘CSV
              </button>
            </div>
          </div>
          {reviewCopyMessage ? <div className="notice good compact-notice">{reviewCopyMessage}</div> : null}
          <div className="stockup-plan-grid">
            {arrivedPlans.slice(0, 12).map((plan) => (
              <article key={plan.id}>
                <div>
                  <strong>{plan.sku}</strong>
                  <span>{plan.name || plan.country}</span>
                </div>
                <dl>
                  <div>
                    <dt>计划数量</dt>
                    <dd>{formatNumber(plan.quantity)} {plan.unit}</dd>
                  </div>
                  <div>
                    <dt>到仓复盘</dt>
                    <dd>{stockupPlanReviewStatus(plan)}</dd>
                  </div>
                  <div>
                    <dt>类型</dt>
                    <dd>{stockupPlanTypeLabel(plan.planType)}</dd>
                  </div>
                </dl>
                <small>负责人：{plan.owner || "未指定"} · 预计到仓：{plan.expectedArrivalAt || "未设置"} · 标记到仓：{plan.updatedAt ? formatDateTime(plan.updatedAt) : "未记录"}</small>
                {plan.note ? <small>{plan.note}</small> : null}
                <div className="stockup-plan-actions">
                  <button className="ghost-button compact-button" type="button" onClick={() => void copyArrivedPlanReviewItem(plan)}>
                    复制单条复盘
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {workflowTab === "overview" && showPlanningTools ? <section className="panel stockup-panel">
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
      </section> : null}

      {workflowTab === "overview" && showPlanningTools && abandonedRecommendations.length ? (
        <section className="panel stockup-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Dismissed Queue</p>
              <h2>已放弃的备货提醒</h2>
            </div>
            <span className="status-pill muted">{formatNumber(abandonedRecommendations.length)} 个 SKU</span>
          </div>
          <div className="stockup-sync-results">
            {abandonedRecommendations.slice(0, 12).map((item) => (
              <article key={item.recommendationKey || `${item.country}-${item.sku}`}>
                <strong>{item.sku} · {item.name}</strong>
                <span>{item.country}，净建议 {formatNumber(item.netReplenishQty)} {item.unit}。放弃后不会进入当前备货提醒。</span>
                <button className="ghost-button compact-button" type="button" disabled={syncing} onClick={() => onDecision(item, "restore")}>恢复提醒</button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {workflowTab === "overview" && showPlanningTools ? <section className="panel stockup-panel">
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
            <span>计算口径</span>
            <span>状态</span>
            <span>操作</span>
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
              <StockupFormulaInsight item={item} />
              <MovementStatusInsight item={item} />
              <div className="stockup-actions">
                {item.decisionStatus === "accepted" ? (
                  <span className="status-pill good">已采纳 · 待创建计划</span>
                ) : (
                  <button className="ghost-button compact-button" type="button" disabled={syncing} onClick={() => onDecision(item, "accept")}>采纳</button>
                )}
                <button className="ghost-button compact-button danger-button" type="button" disabled={syncing} onClick={() => onDecision(item, "abandon")}>放弃</button>
              </div>
            </article>
          )) : (
            <div className="stockup-empty">当前没有需要备货的 SKU。先同步仓库库存和近 90 天订单后，动销分析会自动生成建议。</div>
          )}
        </div>
      </section> : null}

      {workflowTab === "overview" && showPlanningTools ? <section className="panel stockup-panel">
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
      </section> : null}
    </main>
  );
}

function moneyCny(value: number) {
  return `¥${Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function StockupWorkflowOverview({ payload }: { payload: StockupWorkflowPayload | null }) {
  const counts = payload?.counts;
  const stages = [
    { label: "提出需求", value: counts?.pendingDemands ?? 0, note: "运营录产品、数量与目的仓" },
    { label: "采购 / 生产", value: counts?.pendingExecutionLines ?? 0, note: "供应链建执行单并跟进到合格" },
    { label: "登记发货", value: counts?.pendingShipmentLines ?? 0, note: "录实际数量、重量和体积" },
    { label: "分摊费用", value: counts?.pendingCostShipments ?? 0, note: "按重量 / 体积 / 数量 / 货值" },
    { label: "锁定成本", value: counts?.pendingLockShipments ?? 0, note: "复核 SKU 到仓单价后锁定" },
  ];
  return (
    <section className="panel workflow-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">Business Chain</p><h2>需求到到仓成本</h2></div>
        <span className={`status-pill ${payload?.source === "jiandaoyun" ? "good" : "warning"}`}>{payload ? "简道云已连接" : "正在读取"}</span>
      </div>
      <div className="workflow-stage-grid">
        {stages.map((stage, index) => (
          <article key={stage.label}>
            <small>0{index + 1}</small>
            <strong>{stage.label}</strong>
            <b>{stage.value > 0 ? formatNumber(stage.value) : "—"}</b>
            <span>{stage.note}</span>
            <em>{stage.value > 0 ? `当前待办 ${formatNumber(stage.value)}` : "已流转 / 无待办"}</em>
          </article>
        ))}
      </div>
      <div className="workflow-guidance">
        <Check size={18} />
        <span>业务单据与成本结果以简道云为准；中台负责录入、校验、计算和状态呈现。</span>
        <small>{payload?.syncedAt ? `本次读取 ${formatDateTime(payload.syncedAt)}` : "等待首次读取"}</small>
      </div>
    </section>
  );
}

function StockupDemandWorkbench({ payload, onRefresh }: { payload: StockupWorkflowPayload | null; onRefresh: () => Promise<StockupWorkflowPayload> }) {
  const codingDemandIds = new Set((payload?.productCodingQueue ?? []).map((item) => item.sourceDemandRecordId));
  const demands = (payload?.demands ?? []).filter((item) => (
    !/已完成|已取消|关闭/.test(item.businessStatus)
    && !codingDemandIds.has(item.id)
    && Math.max(0, item.requestedQty - item.plannedQty) > 0
  ));
  const productOptions = payload?.productOptions ?? [];
  const [form, setForm] = React.useState({ productSourceType: "已有产品" as "已有产品" | "外采新品", productRecordId: "", sku: "", productName: "", requestedQty: 0, unit: "件", project: "", platform: "SHOPEE", destinationCountry: "", destinationWarehouseName: "", stockupMethod: "外采成品", priority: "普通", expectedArrivalAt: "", reason: "" });
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState("");

  function selectProduct(productId: string) {
    const product = productOptions.find((item) => item.id === productId);
    setForm((current) => ({ ...current, productRecordId: productId, sku: product?.sku || "", productName: product?.productName || "" }));
  }

  async function submitDemand() {
    setBusy(true); setNotice("");
    try {
      const result = await createWorkflowDemand(form);
      await onRefresh();
      setNotice(result.warning || `需求 ${result.demandBatchNo} 已创建${result.temporaryProductNo ? `，临时产品号 ${result.temporaryProductNo}` : ""}。`);
      setOpen(false);
      setForm((current) => ({ ...current, productRecordId: "", sku: "", productName: "", requestedQty: 0, reason: "" }));
    } catch (error) { setNotice(error instanceof Error ? error.message : "需求创建失败"); }
    finally { setBusy(false); }
  }
  return (
    <section className="panel workflow-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">Demand Intake</p><h2>运营备货需求</h2></div>
        <div className="workflow-heading-actions"><span className="status-pill muted">{formatNumber(demands.length)} 条</span><button className="sync-button compact-button" type="button" onClick={() => setOpen((value) => !value)}><Plus size={14} />新建需求</button></div>
      </div>
      {notice ? <div className="notice compact-notice">{notice}</div> : null}
      {open ? <div className="workflow-create-form demand-create-form">
        <label><span>产品来源</span><select value={form.productSourceType} onChange={(event) => setForm({ ...form, productSourceType: event.target.value as typeof form.productSourceType, productRecordId: "", sku: "", productName: "" })}><option>已有产品</option><option>外采新品</option></select></label>
        {form.productSourceType === "已有产品" ? <label className="wide-field"><span>选择正式 SKU</span><select value={form.productRecordId} onChange={(event) => selectProduct(event.target.value)}><option value="">请选择</option>{productOptions.map((item) => <option value={item.id} key={item.id}>{item.sku} · {item.productName}</option>)}</select></label> : <label className="wide-field"><span>新品名称</span><input value={form.productName} onChange={(event) => setForm({ ...form, productName: event.target.value })} placeholder="输入外采新品名称" /></label>}
        <label><span>备货数量</span><input type="number" min="0" value={form.requestedQty || ""} onChange={(event) => setForm({ ...form, requestedQty: Number(event.target.value) })} /></label>
        <label><span>单位</span><input value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} /></label>
        <label><span>归属项目</span><input value={form.project} onChange={(event) => setForm({ ...form, project: event.target.value })} placeholder="如 SHOPEE 印尼" /></label>
        <label><span>平台</span><select value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value })}><option>SHOPEE</option><option>TIKTOK</option><option>OZON</option><option>其他</option></select></label>
        <label><span>目的国</span><input value={form.destinationCountry} onChange={(event) => setForm({ ...form, destinationCountry: event.target.value })} /></label>
        <label><span>目的仓</span><input value={form.destinationWarehouseName} onChange={(event) => setForm({ ...form, destinationWarehouseName: event.target.value })} /></label>
        <label><span>备货方式</span><select value={form.stockupMethod} onChange={(event) => setForm({ ...form, stockupMethod: event.target.value })}><option>外采成品</option><option>委外生产</option><option>自有成品</option><option>待判断</option></select></label>
        <label><span>优先级</span><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}><option>普通</option><option>紧急</option><option>低</option></select></label>
        <label><span>期望到仓</span><input type="date" value={form.expectedArrivalAt} onChange={(event) => setForm({ ...form, expectedArrivalAt: event.target.value })} /></label>
        <label className="wide-field"><span>备货原因</span><input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label>
        <div className="workflow-form-actions"><button className="ghost-button" type="button" onClick={() => setOpen(false)}>取消</button><button className="sync-button" type="button" disabled={busy || !form.productName || !form.requestedQty} onClick={() => void submitDemand()}>提交需求</button></div>
      </div> : null}
      <div className="workflow-table demand-workflow-table">
        <div className="workflow-table-row workflow-table-head">
          <span>批次 / 行号</span><span>SKU / 产品</span><span>项目 / 目的地</span><span>数量进度</span><span>方式 / 优先级</span><span>状态</span>
        </div>
        {demands.length ? demands.slice(0, 100).map((item) => (
          <article className="workflow-table-row" key={item.id}>
            <span><strong>{item.demandBatchNo || "未编号"}</strong><small>{item.demandLineNo || item.id.slice(-8)}</small></span>
            <span><strong>{item.sku || item.temporaryProductNo || "待编码"}</strong><small>{item.productName || "未填写产品名"}</small></span>
            <span><strong>{item.project || item.platform || "未归属"}</strong><small>{item.destinationWarehouseName || item.destinationCountry || "未指定目的地"}</small></span>
            <span><strong>{formatNumber(item.requestedQty)}</strong><small>已计划 {formatNumber(item.plannedQty)} · 已发 {formatNumber(item.shippedQty)} · 到仓 {formatNumber(item.receivedQty)}</small></span>
            <span><strong>{item.stockupMethod || item.productSourceType || "待判断"}</strong><small>{item.priority || "普通"}</small></span>
            <span className={`status-pill ${/完成|到仓/.test(item.businessStatus) ? "good" : /取消|异常/.test(item.businessStatus) ? "warning" : "muted"}`}>{item.businessStatus || "待受理"}</span>
          </article>
        )) : <div className="stockup-empty">简道云“供应链备货审批”暂无需求数据。运营提交后会自动出现在这里。</div>}
      </div>
    </section>
  );
}

type ExecutionProgressDraft = { orderedQty: number; completedQty: number; qualifiedQty: number; actualBaseUnitCost: number };

const ExecutionProgressCard = React.memo(function ExecutionProgressCard({ item, busy, onSave, onRollback }: {
  item: StockupWorkflowPayload["stockupLines"][number];
  busy: boolean;
  onSave: (item: StockupWorkflowPayload["stockupLines"][number], draft: ExecutionProgressDraft) => Promise<void>;
  onRollback: (item: StockupWorkflowPayload["stockupLines"][number]) => Promise<void>;
}) {
  const initialDraft = React.useCallback((): ExecutionProgressDraft => ({
    orderedQty: item.orderedQty,
    completedQty: item.completedQty,
    qualifiedQty: item.qualifiedQty,
    actualBaseUnitCost: item.actualBaseUnitCost,
  }), [item.actualBaseUnitCost, item.completedQty, item.orderedQty, item.qualifiedQty]);
  const [draft, setDraft] = React.useState<ExecutionProgressDraft>(initialDraft);
  React.useEffect(() => setDraft(initialDraft()), [initialDraft]);
  const canRollback = item.qualifiedQty > item.shippedQty || item.completedQty > item.qualifiedQty || item.orderedQty > item.completedQty;
  return (
    <article>
      <div><strong>{item.sku || item.temporaryProductNo || "待编码"}</strong><span>{item.productName}</span></div>
      <span>{item.supplyMode || "待定方式"}</span>
      <dl><div><dt>计划</dt><dd>{formatNumber(item.plannedQty)}</dd></div><div><dt>可发</dt><dd>{formatNumber(item.qualifiedQty)}</dd></div><div><dt>已发</dt><dd>{formatNumber(item.shippedQty)}</dd></div><div><dt>成本</dt><dd>{moneyCny(item.actualBaseUnitCost)}</dd></div></dl>
      <div className="execution-progress-form">
        <label><span>已下单</span><input type="number" min="0" value={draft.orderedQty || ""} onChange={(event) => setDraft((current) => ({ ...current, orderedQty: Number(event.target.value) }))} /></label>
        <label><span>已完工</span><input type="number" min="0" value={draft.completedQty || ""} onChange={(event) => setDraft((current) => ({ ...current, completedQty: Number(event.target.value) }))} /></label>
        <label><span>检验合格</span><input type="number" min="0" value={draft.qualifiedQty || ""} onChange={(event) => setDraft((current) => ({ ...current, qualifiedQty: Number(event.target.value) }))} /></label>
        <label><span>基础成本/件</span><input type="number" min="0" step="0.01" value={draft.actualBaseUnitCost || ""} onChange={(event) => setDraft((current) => ({ ...current, actualBaseUnitCost: Number(event.target.value) }))} /></label>
        <div className="execution-progress-actions">
          <button className="ghost-button compact-button" type="button" disabled={busy || !canRollback} onClick={() => void onRollback(item)}>退回一步</button>
          <button className="sync-button compact-button" type="button" disabled={busy} onClick={() => void onSave(item, draft)}>保存进度</button>
        </div>
      </div>
    </article>
  );
});

type ShipmentEntryDraft = { shippedQty: number; totalWeightKg: number; totalVolumeM3: number };

const ShipmentEntryLine = React.memo(function ShipmentEntryLine({ item, onChange }: {
  item: StockupWorkflowPayload["stockupLines"][number];
  onChange: (id: string, draft: ShipmentEntryDraft) => void;
}) {
  const [draft, setDraft] = React.useState<ShipmentEntryDraft>({ shippedQty: 0, totalWeightKg: 0, totalVolumeM3: 0 });
  function update(patch: Partial<ShipmentEntryDraft>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    onChange(item.id, next);
  }
  return (
    <article>
      <strong>{item.sku} · {item.productName}</strong>
      <small>可发 {formatNumber(Math.max(0, item.qualifiedQty - item.shippedQty))}</small>
      <input type="number" min="0" placeholder="发货数量" value={draft.shippedQty || ""} onChange={(event) => update({ shippedQty: Number(event.target.value) })} />
      <input type="number" min="0" step="0.001" placeholder="总重量kg" value={draft.totalWeightKg || ""} onChange={(event) => update({ totalWeightKg: Number(event.target.value) })} />
      <input type="number" min="0" step="0.000001" placeholder="总体积m³" value={draft.totalVolumeM3 || ""} onChange={(event) => update({ totalVolumeM3: Number(event.target.value) })} />
    </article>
  );
});

type ExecutionWorkbenchStep = "create" | "progress" | "shipment";

function StockupExecutionWorkbench({ payload, onRefresh }: { payload: StockupWorkflowPayload | null; onRefresh: () => Promise<StockupWorkflowPayload> }) {
  const confirm = useConfirm();
  const allOrders = payload?.stockupOrders ?? [];
  const allLines = payload?.stockupLines ?? [];
  const lineTargetQty = React.useCallback((item: StockupWorkflowPayload["stockupLines"][number]) => Math.max(0, item.plannedQty - (item.cancelledQty || 0)), []);
  const lineAvailableQty = React.useCallback((item: StockupWorkflowPayload["stockupLines"][number]) => Math.max(0, item.qualifiedQty - item.shippedQty), []);
  const activeLines = allLines.filter((item) => !/已完成|已取消|已作废|关闭/.test(item.status) && lineTargetQty(item) > item.shippedQty);
  const progressLines = activeLines.filter((item) => item.qualifiedQty < lineTargetQty(item));
  const executionOnlyLines = activeLines.filter((item) => lineAvailableQty(item) <= 0 && item.qualifiedQty < lineTargetQty(item));
  const shipmentReadyLines = activeLines.filter((item) => lineAvailableQty(item) > 0);
  const activeOrderIds = new Set(activeLines.map((item) => item.orderRecordId));
  const orders = allOrders.filter((item) => activeOrderIds.has(item.id));
  const warehouseOptions = payload?.warehouseOptions ?? [];
  const pendingWmsPushTasks = (payload?.wmsPushTasks ?? []).filter((item) => item.status !== "pushed" && item.status !== "cancelled");
  const candidateDemands = (payload?.demands ?? []).filter((item) => item.sku && !/已完成|已取消/.test(item.businessStatus) && Math.max(0, item.requestedQty - item.plannedQty) > 0);
  const [activeStep, setActiveStep] = React.useState<ExecutionWorkbenchStep>("create");
  const autoSelectedStep = React.useRef(false);
  const [executionForm, setExecutionForm] = React.useState({ demandRecordId: "", plannedQty: 0, executionMode: "外采成品", expectedCompletedAt: "", baseUnitCost: 0, baseCurrency: "CNY", baseExchangeRate: 1 });
  const [shipmentOrderId, setShipmentOrderId] = React.useState("");
  const shipmentLinesRef = React.useRef<Record<string, ShipmentEntryDraft>>({});
  const [hasShipmentQuantity, setHasShipmentQuantity] = React.useState(false);
  const [shipmentFormVersion, setShipmentFormVersion] = React.useState(0);
  const [shipmentMeta, setShipmentMeta] = React.useState({ carrier: "", trackingNo: "", transportMode: "海运", defaultAllocationMethod: "weight", destinationWarehouseConnectionId: "" });
  const [cancellationDraft, setCancellationDraft] = React.useState<{ orderId: string; orderNo: string; reason: string } | null>(null);
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const selectedOrder = orders.find((item) => item.id === shipmentOrderId);
  const selectableLines = shipmentReadyLines.filter((item) => item.orderRecordId === selectedOrder?.id);
  const selectedOrderLines = activeLines.filter((item) => item.orderRecordId === selectedOrder?.id);
  const selectedOrderAvailableQty = selectedOrderLines.reduce((sum, item) => sum + lineAvailableQty(item), 0);
  const selectedWarehouse = warehouseOptions.find((item) => item.connectionId === shipmentMeta.destinationWarehouseConnectionId);
  const orderAvailableQty = React.useCallback((orderId: string) => activeLines.filter((item) => item.orderRecordId === orderId).reduce((sum, item) => sum + lineAvailableQty(item), 0), [activeLines, lineAvailableQty]);

  React.useEffect(() => {
    if (autoSelectedStep.current || !payload) return;
    autoSelectedStep.current = true;
    setActiveStep(shipmentReadyLines.length || pendingWmsPushTasks.length ? "shipment" : progressLines.length ? "progress" : "create");
  }, [payload, pendingWmsPushTasks.length, progressLines.length, shipmentReadyLines.length]);

  React.useEffect(() => {
    if (shipmentOrderId && !orders.some((item) => item.id === shipmentOrderId)) setShipmentOrderId("");
  }, [orders, shipmentOrderId]);

  const updateShipmentLine = React.useCallback((id: string, draft: ShipmentEntryDraft) => {
    shipmentLinesRef.current[id] = draft;
    const hasQuantity = Object.values(shipmentLinesRef.current).some((item) => item.shippedQty > 0);
    setHasShipmentQuantity((current) => current === hasQuantity ? current : hasQuantity);
  }, []);

  function selectStep(step: ExecutionWorkbenchStep) {
    setActiveStep(step);
    setMessage("");
  }

  function resetShipmentForm() {
    shipmentLinesRef.current = {};
    setHasShipmentQuantity(false);
    setShipmentFormVersion((current) => current + 1);
  }

  function selectShipmentOrder(orderId: string) {
    const order = orders.find((item) => item.id === orderId);
    const exactWarehouse = warehouseOptions.find((item) => item.warehouseName === order?.destinationWarehouseName || item.connectionName === order?.destinationWarehouseName);
    const countryWarehouse = warehouseOptions.find((item) => item.country === order?.destinationCountry);
    const matchedWarehouse = exactWarehouse || countryWarehouse;
    setShipmentOrderId(orderId);
    setShipmentMeta((current) => ({
      ...current,
      destinationWarehouseConnectionId: matchedWarehouse?.connectionId || current.destinationWarehouseConnectionId,
    }));
    resetShipmentForm();
  }

  async function createExecution() {
    setBusy(true); setMessage("");
    try {
      const result = await createWorkflowExecution(executionForm);
      await onRefresh();
      setShipmentOrderId(result.orderRecordId || "");
      setActiveStep("progress");
      setMessage(`备货执行单 ${result.orderNo} 已创建。现在请更新下单、完工和合格数量。`);
      setExecutionForm({ ...executionForm, demandRecordId: "", plannedQty: 0, baseUnitCost: 0 });
    } catch (error) { setMessage(error instanceof Error ? error.message : "执行单创建失败"); }
    finally { setBusy(false); }
  }

  async function saveShipment() {
    setBusy(true); setMessage("");
    try {
      const selected = Object.entries(shipmentLinesRef.current).filter(([, item]) => item.shippedQty > 0).map(([stockupLineRecordId, item]) => ({ stockupLineRecordId, ...item }));
      const result = await createWorkflowShipment({ stockupOrderRecordId: shipmentOrderId, ...shipmentMeta, lines: selected });
      await onRefresh();
      setMessage(result.wmsTaskWarning || `发货已登记，共 ${result.lineCount || 0} 条 SKU；已生成“${result.wmsPushTask?.createMode || "WMS 建单"}”待确认任务，尚未向 WMS 推送。`);
      resetShipmentForm();
    } catch (error) { setMessage(error instanceof Error ? error.message : "发货登记失败"); }
    finally { setBusy(false); }
  }

  async function confirmWmsPush(task: NonNullable<StockupWorkflowPayload["wmsPushTasks"]>[number]) {
    const confirmed = await confirm({
      title: `确认推送到 ${task.warehouseName}`,
      body: `本次只会在 ${task.providerName || "WMS"} 创建${task.createMode || "草稿单"}，不会自动审核或入库。`,
      confirmText: `确认创建${task.createMode || "草稿单"}`,
      details: [`发货单：${task.shipmentNo || task.shipmentRecordId}`, `外部参考号：${task.externalReferenceNo}`, `SKU 明细：${task.lineCount} 行`, "重复点击会由中台拦截"],
    });
    if (!confirmed) return;
    setBusy(true); setMessage("");
    try {
      const result = await confirmWorkflowWmsPush(task.id);
      await onRefresh();
      setMessage(`${task.warehouseName} 已创建${task.createMode || "WMS 草稿单"}：${result.task.wmsOrderNo}${result.writebackWarning ? `。${result.writebackWarning}` : ""}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "WMS 推送失败"); }
    finally { setBusy(false); }
  }

  const saveLineProgress = React.useCallback(async (item: StockupWorkflowPayload["stockupLines"][number], draft: ExecutionProgressDraft) => {
    setBusy(true); setMessage("");
    try {
      const result = await updateWorkflowExecutionLine({ stockupLineRecordId: item.id, ...draft });
      await onRefresh();
      if (draft.qualifiedQty > item.shippedQty) {
        setShipmentOrderId(item.orderRecordId);
        setActiveStep("shipment");
        setMessage(`${item.sku || item.productName} 已有 ${formatNumber(draft.qualifiedQty - item.shippedQty)} 件可发，已进入步骤 3。`);
      } else {
        setMessage(`${item.sku || item.productName} 进度已更新为“${result.status}”。`);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "进度更新失败"); }
    finally { setBusy(false); }
  }, [onRefresh]);

  const rollbackLine = React.useCallback(async (item: StockupWorkflowPayload["stockupLines"][number]) => {
    const confirmed = await confirm({
      title: `退回 ${item.sku || item.productName} 的进度`,
      body: "系统只退回最近一个已完成节点，且不会把数量退到已发货数量以下。",
      confirmText: "确认退回一步",
      details: [`已下单 ${formatNumber(item.orderedQty)}`, `已完工 ${formatNumber(item.completedQty)}`, `检验合格 ${formatNumber(item.qualifiedQty)}`, `已发货 ${formatNumber(item.shippedQty)}`],
    });
    if (!confirmed) return;
    setBusy(true); setMessage("");
    try {
      const result = await rollbackWorkflowExecutionLine({ stockupLineRecordId: item.id, reason: "中台用户确认退回上一步" });
      await onRefresh();
      setActiveStep("progress");
      setMessage(`${item.sku || item.productName} 已退回“${result.rollbackStage}”节点，当前状态为“${result.status}”。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "进度退回失败"); }
    finally { setBusy(false); }
  }, [confirm, onRefresh]);

  async function submitCancellation() {
    if (!cancellationDraft?.reason.trim()) return;
    const confirmed = await confirm({
      title: `取消 ${cancellationDraft.orderNo} 的剩余数量`,
      body: "未发货剩余数量会退回需求池；已经发货的数量不会改变，原执行单和操作记录会保留。",
      confirmText: "确认取消剩余",
      tone: "danger",
      details: [`取消原因：${cancellationDraft.reason.trim()}`],
    });
    if (!confirmed) return;
    setBusy(true); setMessage("");
    try {
      const result = await cancelWorkflowExecution({ stockupOrderRecordId: cancellationDraft.orderId, reason: cancellationDraft.reason.trim() });
      await onRefresh();
      setCancellationDraft(null);
      setActiveStep("create");
      setMessage(`${cancellationDraft.orderNo} 已取消剩余 ${formatNumber(result.cancelledQty)}，相关需求已重新开放。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "取消执行单失败"); }
    finally { setBusy(false); }
  }

  const stepItems: Array<{ id: ExecutionWorkbenchStep; number: string; title: string; hint: string; count: number }> = [
    { id: "create", number: "01", title: "创建执行单", hint: "选择正式需求并确认执行方式", count: candidateDemands.length },
    { id: "progress", number: "02", title: "跟进供应进度", hint: "下单、完工、质检合格", count: executionOnlyLines.length },
    { id: "shipment", number: "03", title: "发货与 WMS 确认", hint: "登记发货后人工确认推送", count: shipmentReadyLines.length + pendingWmsPushTasks.length },
  ];

  return (
    <section className="execution-workbench">
      <nav className="execution-step-switcher" aria-label="供应执行步骤">
        {stepItems.map((step) => (
          <button className={activeStep === step.id ? "active" : ""} type="button" onClick={() => selectStep(step.id)} key={step.id}>
            <span>{step.number}</span>
            <strong>{step.title}</strong>
            <small>{step.hint}</small>
            <em>{step.count > 0 ? step.count : "—"}</em>
          </button>
        ))}
      </nav>
      {message ? <div className="notice compact-notice">{message}</div> : null}

      {activeStep === "create" ? (
        <div className="panel workflow-panel execution-current-panel">
          <div className="panel-heading"><div><p className="eyebrow">Current Task · 01</p><h2>创建采购 / 生产执行单</h2><small>只显示尚有未计划数量的正式 SKU 需求；创建后自动进入跟单。</small></div><span className="status-pill warning">{candidateDemands.length || "—"} 个待处理</span></div>
          <div className="workflow-create-form">
            <label className="wide-field"><span>选择需求</span><select value={executionForm.demandRecordId} onChange={(event) => { const demand = candidateDemands.find((item) => item.id === event.target.value); setExecutionForm({ ...executionForm, demandRecordId: event.target.value, plannedQty: Math.max(0, (demand?.requestedQty || 0) - (demand?.plannedQty || 0)), executionMode: demand?.stockupMethod || "外采成品" }); }}><option value="">请选择</option>{candidateDemands.map((item) => <option value={item.id} key={item.id}>{item.demandBatchNo} · {item.sku} · {item.productName}</option>)}</select></label>
            <label><span>计划数量</span><input type="number" min="0" value={executionForm.plannedQty || ""} onChange={(event) => setExecutionForm({ ...executionForm, plannedQty: Number(event.target.value) })} /></label>
            <label><span>执行方式</span><select value={executionForm.executionMode} onChange={(event) => setExecutionForm({ ...executionForm, executionMode: event.target.value })}><option>外采成品</option><option>委外生产</option><option>自有成品</option></select></label>
            <label><span>基础成本单价</span><input type="number" min="0" step="0.01" value={executionForm.baseUnitCost || ""} onChange={(event) => setExecutionForm({ ...executionForm, baseUnitCost: Number(event.target.value) })} /></label>
            <label><span>预计完成</span><input type="date" value={executionForm.expectedCompletedAt} onChange={(event) => setExecutionForm({ ...executionForm, expectedCompletedAt: event.target.value })} /></label>
            <div className="workflow-form-actions"><span className="form-action-hint">创建后同时写入备货主表与关联明细，不会直接进入发货。</span><button className="sync-button" type="button" disabled={busy || !executionForm.demandRecordId || !executionForm.plannedQty} onClick={() => void createExecution()}>创建并进入步骤 2</button></div>
          </div>
          {!candidateDemands.length ? <div className="stockup-empty">当前没有待转执行的需求。已创建的单据请进入步骤 2 跟进。</div> : null}
        </div>
      ) : null}

      {activeStep === "progress" ? (
        <div className="execution-step-content">
          {cancellationDraft ? (
            <div className="workflow-action-editor">
              <div><p className="eyebrow">Cancel Remaining</p><strong>取消 {cancellationDraft.orderNo} 的未发货剩余数量</strong><small>填写原因后确认；相关数量会重新回到步骤 1 的需求池。</small></div>
              <input value={cancellationDraft.reason} onChange={(event) => setCancellationDraft({ ...cancellationDraft, reason: event.target.value })} placeholder="必填：供应商缺货、计划调整等" autoFocus />
              <button className="ghost-button" type="button" disabled={busy} onClick={() => setCancellationDraft(null)}>放弃操作</button>
              <button className="sync-button danger-button" type="button" disabled={busy || !cancellationDraft.reason.trim()} onClick={() => void submitCancellation()}>确认取消剩余</button>
            </div>
          ) : null}
          <div className="panel workflow-panel">
            <div className="panel-heading"><div><p className="eyebrow">Current Task · 02</p><h2>我正在跟进的执行单</h2><small>执行单创建后始终显示；不能发货时会明确显示缺少哪个前置条件。</small></div><span className="status-pill muted">{orders.length || "—"} 单</span></div>
            <div className="workflow-card-list execution-order-list">
              {orders.length ? orders.slice(0, 50).map((item) => {
                const availableQty = orderAvailableQty(item.id);
                return (
                  <article key={item.id}>
                    <div><strong>{item.orderNo || item.id.slice(-8)}</strong><span>{item.project || item.destinationCountry || "未归属项目"}</span></div>
                    <span className={`status-pill ${availableQty > 0 ? "good" : "warning"}`}>{availableQty > 0 ? `可发 ${formatNumber(availableQty)}` : item.status || "待执行"}</span>
                    <dl><div><dt>计划</dt><dd>{formatNumber(item.plannedQty)}</dd></div><div><dt>完工</dt><dd>{formatNumber(item.completedQty)}</dd></div><div><dt>发货</dt><dd>{formatNumber(item.shippedQty)}</dd></div><div><dt>到仓</dt><dd>{formatNumber(item.receivedQty)}</dd></div></dl>
                    <div className="execution-next-action"><span>下一步</span><strong>{availableQty > 0 ? "已有合格可发数量，可以进入步骤 3" : item.completedQty > 0 ? "录入检验合格数量后即可发货" : "先在下方录入已下单和完工数量"}</strong></div>
                    <div className="execution-order-actions">
                      <button className="ghost-button compact-button" type="button" onClick={() => setActiveStep("progress")}>更新进度</button>
                      <button className="ghost-button compact-button" type="button" disabled={availableQty <= 0} onClick={() => { selectShipmentOrder(item.id); setActiveStep("shipment"); }}>去发货</button>
                      <button className="ghost-button compact-button danger-button" type="button" disabled={busy} onClick={() => setCancellationDraft({ orderId: item.id, orderNo: item.orderNo || item.id.slice(-8), reason: "" })}>取消剩余</button>
                    </div>
                  </article>
                );
              }) : <div className="stockup-empty">暂无进行中的备货执行单。需要创建时返回步骤 1。</div>}
            </div>
          </div>
          <div className="panel workflow-panel">
            <div className="panel-heading"><div><p className="eyebrow">SKU Progress</p><h2>逐 SKU 更新供应进度</h2><small>录错时使用“退回一步”；系统不会把任何数量退到已发货数量以下。</small></div><span className="status-pill muted">{progressLines.length || "—"} 行</span></div>
            <div className="workflow-card-list compact">
              {progressLines.length ? progressLines.slice(0, 80).map((item) => <ExecutionProgressCard item={item} busy={busy} onSave={saveLineProgress} onRollback={rollbackLine} key={item.id} />) : <div className="stockup-empty">当前没有待更新的采购 / 生产进度；有合格可发数量的单据请进入步骤 3。</div>}
            </div>
          </div>
        </div>
      ) : null}

      {activeStep === "shipment" ? (
        <div className="panel workflow-panel execution-current-panel">
          <div className="panel-heading"><div><p className="eyebrow">Current Task · 03</p><h2>登记实际发货并确认 WMS</h2><small>先登记本次实际发货；系统只生成待确认任务，确认后才向目标仓创建草稿 / 未审核单。</small></div><span className="status-pill good">{shipmentReadyLines.length ? `${shipmentReadyLines.length} 行可发` : pendingWmsPushTasks.length ? `${pendingWmsPushTasks.length} 个待确认` : "—"}</span></div>
          <div className="workflow-create-form">
            <label className="wide-field"><span>备货执行单</span><select value={shipmentOrderId} onChange={(event) => selectShipmentOrder(event.target.value)}><option value="">请选择</option>{orders.map((item) => { const availableQty = orderAvailableQty(item.id); return <option value={item.id} key={item.id}>{item.orderNo} · {item.project || item.destinationCountry || "未指定项目"} · {availableQty > 0 ? `可发 ${formatNumber(availableQty)}` : "待检验合格"}</option>; })}</select></label>
            <label className="wide-field"><span>发往仓库（必选）</span><select value={shipmentMeta.destinationWarehouseConnectionId} onChange={(event) => setShipmentMeta({ ...shipmentMeta, destinationWarehouseConnectionId: event.target.value })}><option value="">请选择已建档仓库</option>{warehouseOptions.map((item) => <option value={item.connectionId} key={item.connectionId}>{item.warehouseName} · {item.country} · {item.providerName}{item.createConfigured ? "" : "（授权未完成）"}</option>)}</select></label>
            <label><span>承运商</span><input value={shipmentMeta.carrier} onChange={(event) => setShipmentMeta({ ...shipmentMeta, carrier: event.target.value })} /></label>
            <label><span>物流单号</span><input value={shipmentMeta.trackingNo} onChange={(event) => setShipmentMeta({ ...shipmentMeta, trackingNo: event.target.value })} /></label>
            <label><span>运输方式</span><select value={shipmentMeta.transportMode} onChange={(event) => setShipmentMeta({ ...shipmentMeta, transportMode: event.target.value })}><option>海运</option><option>空运</option><option>陆运</option><option>快递</option></select></label>
            <label><span>默认分摊</span><select value={shipmentMeta.defaultAllocationMethod} onChange={(event) => setShipmentMeta({ ...shipmentMeta, defaultAllocationMethod: event.target.value })}>{allocationMethods.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          </div>
          {selectedWarehouse ? <div className={`shipment-readiness ${selectedWarehouse.createConfigured ? "ready" : "blocked"}`}><strong>{selectedWarehouse.warehouseName} · {selectedWarehouse.createMode}</strong><span>{selectedWarehouse.createMessage}{selectedWarehouse.receivingAddress ? ` 收货地址：${selectedWarehouse.receivingAddress}` : ""} 保存发货时只建立待确认任务，不会立即推送。</span></div> : null}
          {selectedOrder ? (
            <>
              <div className={`shipment-readiness ${selectedOrderAvailableQty > 0 ? "ready" : "blocked"}`}><strong>{selectedOrderAvailableQty > 0 ? `当前可发 ${formatNumber(selectedOrderAvailableQty)}` : "当前不能发货"}</strong><span>{selectedOrderAvailableQty > 0 ? "可只发本次实际数量，剩余合格数量保留到下次。" : "请回到步骤 2，先录入完工数量和检验合格数量。执行单不会消失。"}</span></div>
              <div className="shipment-entry-lines">{selectableLines.map((item) => <ShipmentEntryLine item={item} onChange={updateShipmentLine} key={`${shipmentOrderId}:${shipmentFormVersion}:${item.id}`} />)}{!selectableLines.length ? <div className="stockup-empty">该执行单暂无可发 SKU，但仍保留在列表中供你查看状态。</div> : null}</div>
            </>
          ) : <div className="stockup-empty">先选择一张执行单。列表同时显示“可发数量”或“待检验合格”。</div>}
          <div className="workflow-form-actions"><span className="form-action-hint">重量和体积都保留；保存后先进入待确认，不会自动向 WMS 建单。</span><button className="sync-button" type="button" disabled={busy || !shipmentOrderId || !hasShipmentQuantity || !shipmentMeta.destinationWarehouseConnectionId} onClick={() => void saveShipment()}>保存发货并生成待确认任务</button></div>
          {pendingWmsPushTasks.length ? (
            <div className="panel workflow-panel">
              <div className="panel-heading"><div><p className="eyebrow">WMS Confirmation</p><h2>待确认推送 WMS</h2><small>只有点击确认后才会在目标仓创建草稿 / 未审核单。</small></div><span className="status-pill warning">{pendingWmsPushTasks.length} 个待处理</span></div>
              <div className="workflow-card-list compact">
                {pendingWmsPushTasks.map((task) => (
                  <article key={task.id}>
                    <div><strong>{task.shipmentNo || task.externalReferenceNo}</strong><span>{task.warehouseName} · {task.providerName}</span></div>
                    <span className={`status-pill ${task.status === "failed" || task.status === "needs_manual_check" ? "warning" : "muted"}`}>{task.status === "pending_confirmation" ? "待确认" : task.status === "pushing" ? "推送中" : task.status === "failed" ? "可重试" : "需人工核实"}</span>
                    <dl><div><dt>创建方式</dt><dd>{task.createMode || "草稿"}</dd></div><div><dt>SKU</dt><dd>{task.lineCount}</dd></div><div><dt>尝试次数</dt><dd>{task.attempts}</dd></div><div><dt>参考号</dt><dd>{task.externalReferenceNo}</dd></div></dl>
                    {task.lastError ? <div className="execution-next-action"><span>上次结果</span><strong>{task.lastError}</strong></div> : null}
                    <div className="execution-order-actions"><button className="sync-button compact-button" type="button" disabled={busy || !task.canPush} onClick={() => void confirmWmsPush(task)}>{task.status === "failed" ? "确认重试" : `确认创建${task.createMode || "草稿单"}`}</button></div>
                  </article>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

const shipmentFeeTypes = ["国内运费", "头程运费", "提货费", "报关费", "清关费", "关税", "保险费", "上架费", "仓库操作费", "人工费", "标签费", "包装材料费", "检测/备案摊销", "其他"];
const allocationMethods = [
  ["weight", "按重量"], ["volume", "按体积"], ["quantity", "按数量"], ["value", "按货值"],
] as const;

function StockupCostWorkbench({ payload, onRefresh }: { payload: StockupWorkflowPayload | null; onRefresh: () => Promise<StockupWorkflowPayload> }) {
  const confirm = useConfirm();
  const allCostBatches = payload?.costBatches ?? [];
  const shipments = (payload?.shipments ?? []).filter((shipment) => (
    !/已作废/.test(shipment.status) && !(shipment.lines.length > 0 && shipment.lines.every((line) => allCostBatches.some((batch) => (
      batch.isCurrent !== false
      && batch.shipmentRecordId === shipment.id
      && batch.shipmentLineId === line.id
      && /已锁定/.test(batch.status)
    ))))
  ));
  const [shipmentId, setShipmentId] = React.useState("");
  const [feeForm, setFeeForm] = React.useState({ feeStage: "实际" as "预估" | "实际" | "调整", feeType: "头程运费", originalAmount: 0, currency: "CNY", exchangeRate: 1, allocationMethod: "weight" as "weight" | "volume" | "quantity" | "value" | "manual", vendor: "", invoiceNo: "", description: "", includedInLandedCost: true });
  const [costType, setCostType] = React.useState<"预估" | "正式" | "调整">("预估");
  const [riskRate, setRiskRate] = React.useState(0);
  const [preview, setPreview] = React.useState<StockupCostPreview | null>(null);
  const [voidReason, setVoidReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");
  const selectedShipment = shipments.find((item) => item.id === shipmentId) || shipments[0];
  const selectedFees = (payload?.fees ?? []).filter((item) => item.shipmentRecordId === selectedShipment?.id);
  const selectedBatches = (payload?.costBatches ?? []).filter((item) => item.shipmentRecordId === selectedShipment?.id);
  const selectedShipmentLocked = selectedBatches.some((item) => /已锁定/.test(item.status));
  const versions = [...new Set(selectedBatches.map((item) => item.version))].sort((a, b) => b - a);

  React.useEffect(() => {
    if (!shipmentId && shipments[0]) setShipmentId(shipments[0].id);
  }, [shipmentId, shipments]);

  async function runPreview(options: { includeDraftFee?: boolean } = {}) {
    if (!selectedShipment) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const fees = options.includeDraftFee && feeForm.originalAmount > 0 ? [...selectedFees, { ...feeForm }] : selectedFees;
      const result = await previewStockupCost({ shipment: selectedShipment, fees, costType, version: Math.max(...versions, 0) + 1, riskRate });
      setPreview(result);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "成本试算失败");
    } finally { setBusy(false); }
  }

  async function saveFee() {
    if (!selectedShipment) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await createShipmentFee({ shipmentRecordId: selectedShipment.id, ...feeForm });
      const refreshed = await onRefresh();
      const latestShipment = refreshed.shipments.find((item) => item.id === selectedShipment.id);
      const latestFees = refreshed.fees.filter((item) => item.shipmentRecordId === selectedShipment.id);
      if (latestShipment) setPreview(await previewStockupCost({ shipment: latestShipment, fees: latestFees, costType, riskRate }));
      setMessage("费用已写入简道云，并完成 SKU 分摊。");
      setFeeForm((current) => ({ ...current, originalAmount: 0, invoiceNo: "", description: "" }));
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "费用保存失败"); }
    finally { setBusy(false); }
  }

  async function generateBatches() {
    if (!selectedShipment) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await createStockupCostBatches({ shipmentRecordId: selectedShipment.id, costType, riskRate, note: "中台费用工作台计算生成" });
      setPreview(result.preview);
      await onRefresh();
      setMessage(`已生成成本版本 V${result.version}，共 ${result.created?.length || 0} 条 SKU 成本记录。`);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "成本批次生成失败"); }
    finally { setBusy(false); }
  }

  async function lockVersion(version: number) {
    if (!selectedShipment) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await lockStockupCostVersion({ shipmentRecordId: selectedShipment.id, version });
      await onRefresh();
      setMessage(`成本版本 V${version} 已锁定，共 ${result.lockedCount || 0} 条 SKU 生效。`);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "成本锁定失败"); }
    finally { setBusy(false); }
  }

  async function voidSelectedShipment() {
    if (!selectedShipment || !voidReason.trim()) return;
    const confirmed = await confirm({
      title: `作废发货单 ${selectedShipment.shipmentNo || selectedShipment.id}`,
      body: "系统会按其他未作废发货单重新汇总已发数量，并同步反冲执行单和需求；原发货记录会保留为已作废。",
      confirmText: "确认作废并反冲",
      tone: "danger",
      details: [`作废原因：${voidReason.trim()}`, `SKU 行数：${selectedShipment.lines.length}`],
    });
    if (!confirmed) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await voidWorkflowShipment({ shipmentRecordId: selectedShipment.id, reason: voidReason.trim() });
      await onRefresh();
      setShipmentId("");
      setVoidReason("");
      setPreview(null);
      setMessage(`${result.shipmentNo || "发货单"} 已作废，并反冲 ${result.reversedLineCount} 条 SKU 数量。`);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "发货单作废失败"); }
    finally { setBusy(false); }
  }

  return (
    <section className="cost-workbench-grid">
      <div className="panel workflow-panel shipment-picker-panel">
        <div className="panel-heading"><div><p className="eyebrow">Shipment</p><h2>选择发货批次</h2></div><span className="status-pill muted">{formatNumber(shipments.length)} 单</span></div>
        <select value={selectedShipment?.id || ""} onChange={(event) => { setShipmentId(event.target.value); setPreview(null); setMessage(""); setError(""); }}>
          {shipments.map((item) => <option value={item.id} key={item.id}>{item.shipmentNo || item.id} · {item.destinationWarehouseName || item.destinationCountry || "未指定仓"}</option>)}
        </select>
        {selectedShipment ? (
          <div className="shipment-facts">
            <div><span>SKU 行数</span><strong>{selectedShipment.lines.length}</strong></div>
            <div><span>总重量</span><strong>{formatDecimal(selectedShipment.actualWeightKg || selectedShipment.lines.reduce((sum, item) => sum + item.totalWeightKg, 0))} kg</strong></div>
            <div><span>总体积</span><strong>{formatDecimal(selectedShipment.actualVolumeM3 || selectedShipment.lines.reduce((sum, item) => sum + item.totalVolumeM3, 0))} m³</strong></div>
            <div><span>成本状态</span><strong>{selectedShipment.costingStatus || "待计算"}</strong></div>
          </div>
        ) : <div className="stockup-empty">简道云“同舟发货单”暂无数据。先登记实际发货和 SKU 明细，再录费用。</div>}
        {selectedShipment ? <div className="shipment-line-mini-list">{selectedShipment.lines.slice(0, 8).map((line) => <span key={line.id}><strong>{line.sku || line.temporaryProductNo || "待编码"}</strong><small>{formatNumber(line.shippedQty)} 件 · {formatDecimal(line.totalWeightKg)} kg · {formatDecimal(line.totalVolumeM3)} m³</small></span>)}</div> : null}
        {selectedShipment ? <div className="shipment-void-control"><input value={voidReason} onChange={(event) => setVoidReason(event.target.value)} placeholder={selectedShipmentLocked ? "成本已锁定，不能直接作废" : "作废原因（必填）"} disabled={selectedShipmentLocked || busy} /><button className="ghost-button compact-button danger-button" type="button" disabled={selectedShipmentLocked || busy || !voidReason.trim()} onClick={() => void voidSelectedShipment()}>作废并反冲</button></div> : null}
      </div>

      <div className="panel workflow-panel fee-entry-panel">
        <div className="panel-heading"><div><p className="eyebrow">Fee Entry</p><h2>登记并分摊费用</h2></div><span className="status-pill good">{selectedFees.length} 笔已登记</span></div>
        <div className="fee-entry-form">
          <label><span>费用阶段</span><select value={feeForm.feeStage} onChange={(event) => setFeeForm({ ...feeForm, feeStage: event.target.value as typeof feeForm.feeStage })}><option>预估</option><option>实际</option><option>调整</option></select></label>
          <label><span>费用类型</span><select value={feeForm.feeType} onChange={(event) => setFeeForm({ ...feeForm, feeType: event.target.value })}>{shipmentFeeTypes.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label><span>原币金额</span><input type="number" min="0" step="0.01" value={feeForm.originalAmount || ""} onChange={(event) => setFeeForm({ ...feeForm, originalAmount: Number(event.target.value) })} placeholder="0.00" /></label>
          <label><span>币种</span><select value={feeForm.currency} onChange={(event) => setFeeForm({ ...feeForm, currency: event.target.value })}>{["CNY", "USD", "IDR", "MYR", "VND", "RUB"].map((item) => <option key={item}>{item}</option>)}</select></label>
          <label><span>汇率</span><input type="number" min="0" step="0.000001" value={feeForm.exchangeRate} onChange={(event) => setFeeForm({ ...feeForm, exchangeRate: Number(event.target.value) })} /></label>
          <label><span>分摊方式</span><select value={feeForm.allocationMethod} onChange={(event) => setFeeForm({ ...feeForm, allocationMethod: event.target.value as typeof feeForm.allocationMethod })}>{allocationMethods.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label><span>费用供应商</span><input value={feeForm.vendor} onChange={(event) => setFeeForm({ ...feeForm, vendor: event.target.value })} placeholder="物流商 / 服务商" /></label>
          <label><span>账单号 / 发票号</span><input value={feeForm.invoiceNo} onChange={(event) => setFeeForm({ ...feeForm, invoiceNo: event.target.value })} placeholder="可选" /></label>
          <label className="fee-full-row"><span>费用说明</span><input value={feeForm.description} onChange={(event) => setFeeForm({ ...feeForm, description: event.target.value })} placeholder="费用口径或异常说明" /></label>
          <label className="fee-checkbox"><input type="checkbox" checked={feeForm.includedInLandedCost} onChange={(event) => setFeeForm({ ...feeForm, includedInLandedCost: event.target.checked })} /><span>计入到仓成本</span></label>
        </div>
        <div className="cost-action-bar">
          <button className="ghost-button" type="button" disabled={busy || !selectedShipment || !feeForm.originalAmount} onClick={() => void runPreview({ includeDraftFee: true })}><Calculator size={16} />预览本笔分摊</button>
          <button className="sync-button" type="button" disabled={busy || !selectedShipment || !feeForm.originalAmount} onClick={() => void saveFee()}><Plus size={16} />保存费用</button>
        </div>
      </div>

      <div className="panel workflow-panel cost-preview-panel">
        <div className="panel-heading"><div><p className="eyebrow">Landed Cost</p><h2>到仓成本试算</h2></div><span className={`status-pill ${preview?.ok ? "good" : "warning"}`}>{preview ? (preview.ok ? "校验通过" : "存在异常") : "待试算"}</span></div>
        <div className="cost-calculation-controls">
          <label><span>成本类型</span><select value={costType} onChange={(event) => setCostType(event.target.value as typeof costType)}><option>预估</option><option>正式</option><option>调整</option></select></label>
          <label><span>风险加成率</span><input type="number" min="0" step="0.01" value={riskRate} onChange={(event) => setRiskRate(Number(event.target.value))} /></label>
          <button className="ghost-button" type="button" disabled={busy || !selectedShipment} onClick={() => void runPreview()}><Calculator size={16} />全单试算</button>
          <button className="sync-button" type="button" disabled={busy || !selectedShipment || !selectedFees.length || (preview ? !preview.ok : false)} onClick={() => void generateBatches()}><DatabaseZap size={16} />生成成本批次</button>
        </div>
        {message ? <div className="notice good compact-notice">{message}</div> : null}
        {error ? <div className="notice warning compact-notice">{error}</div> : null}
        {preview ? (
          <>
            <div className="cost-total-strip"><span><small>基础货值</small><strong>{moneyCny(preview.totals.baseCostCny)}</strong></span><span><small>计入费用</small><strong>{moneyCny(preview.totals.includedFeesCny)}</strong></span><span><small>不计入费用</small><strong>{moneyCny(preview.totals.excludedFeesCny)}</strong></span><span><small>到仓成本合计</small><strong>{moneyCny(preview.totals.landedCostCny)}</strong></span></div>
            {preview.errors.length ? <div className="cost-error-list">{preview.errors.map((item) => <span key={item}><AlertTriangle size={14} />{item}</span>)}</div> : null}
            <div className="cost-result-table">
              <div className="cost-result-row head"><span>SKU / 产品</span><span>核算数量</span><span>基础成本</span><span>分摊费用</span><span>单件运费</span><span>到仓单价</span></div>
              {preview.costBatches.map((item) => <article className="cost-result-row" key={item.uniqueKey}><span><strong>{item.sku || item.temporaryProductNo || "待编码"}</strong><small>{item.productName}</small></span><span>{formatNumber(item.costingQty)}</span><span>{moneyCny(item.baseCostTotalCny)}</span><span>{moneyCny(item.includedFeeTotal)}</span><span>{moneyCny(item.unitLogisticsCostCny)}</span><strong>{moneyCny(item.landedUnitCostCny)}</strong></article>)}
            </div>
          </>
        ) : <div className="stockup-empty">选择发货批次后点击“全单试算”；也可以先录一笔费用并预览该笔的分摊结果。</div>}
      </div>

      <div className="panel workflow-panel cost-history-panel">
        <div className="panel-heading"><div><p className="eyebrow">Cost Versions</p><h2>成本版本</h2></div><span className="status-pill muted">{versions.length} 个版本</span></div>
        <div className="cost-version-list">
          {versions.length ? versions.map((version) => {
            const items = selectedBatches.filter((item) => item.version === version);
            const locked = items.some((item) => /已锁定/.test(item.status));
            return <article key={version}><div><strong>V{version} · {items[0]?.costType || "成本"}</strong><span>{items.length} 条 SKU · {moneyCny(items.reduce((sum, item) => sum + item.actualCostTotalCny, 0))}</span></div><span className={`status-pill ${locked ? "good" : "warning"}`}>{locked ? "已锁定" : items[0]?.status || "待确认"}</span>{!locked ? <button className="ghost-button compact-button" disabled={busy || items.some((item) => item.exceptionCode)} type="button" onClick={() => void lockVersion(version)}><Lock size={14} />确认并锁定</button> : null}</article>;
          }) : <div className="stockup-empty">尚未生成成本版本。</div>}
        </div>
      </div>
    </section>
  );
}

function ProductCodingWorkbench({ payload, onRefresh }: { payload: StockupWorkflowPayload | null; onRefresh: () => Promise<StockupWorkflowPayload> }) {
  const queue = payload?.productCodingQueue ?? [];
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  async function submit(item: StockupWorkflowPayload["productCodingQueue"][number]) {
    setBusy(true); setMessage("");
    try { const result = await completeWorkflowProductCoding({ productRecordId: item.id, sku: drafts[item.id] || "" }); await onRefresh(); setMessage(`正式 SKU ${result.sku} 已回写产品档案和来源需求。`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "编码保存失败"); } finally { setBusy(false); }
  }
  return (
    <section className="panel workflow-panel">
      <div className="panel-heading"><div><p className="eyebrow">Product Coding</p><h2>外采新品编码队列</h2></div><span className={`status-pill ${queue.length ? "warning" : "good"}`}>{queue.length ? `${queue.length} 个待处理` : "无待办"}</span></div>
      {message ? <div className="notice compact-notice">{message}</div> : null}
      <div className="coding-queue-grid">
        {queue.length ? queue.map((item) => <article key={item.id}><div className="coding-sequence">{item.temporaryProductNo || "临时号待生成"}</div><strong>{item.productName || "未填写产品名称"}</strong><span>{item.sourceDemandBatchNo ? `来源需求 ${item.sourceDemandBatchNo}` : "来自运营新品需求"}</span><dl><div><dt>编码状态</dt><dd>{item.skuCodingStatus || "待编码"}</dd></div><div><dt>正式 SKU</dt><dd>{item.officialSku || "尚未分配"}</dd></div><div><dt>申请时间</dt><dd>{item.codingAppliedAt ? formatDate(item.codingAppliedAt) : "未记录"}</dd></div></dl><div className="coding-action"><input value={drafts[item.id] || ""} onChange={(event) => setDrafts({ ...drafts, [item.id]: event.target.value.toUpperCase() })} placeholder="输入正式 SKU" /><button className="sync-button compact-button" type="button" disabled={busy || !drafts[item.id]} onClick={() => void submit(item)}>完成编码</button></div><small>{item.id.startsWith("demand:") ? "提交后会自动建立正式产品档案，并把 SKU 回写到来源需求。" : "提交后同步回写产品档案与来源需求，历史临时号继续保留追溯。"}</small></article>) : <div className="stockup-empty">当前没有等待人工编码的新品。</div>}
      </div>
    </section>
  );
}

const defaultWecomScene: WecomSceneConfig = { enabled: false, robotIds: [], linkUrl: "", extraText: "" };

const wecomNotificationTemplates = [
  {
    id: "daily-operating-summary",
    title: "今日经营摘要",
    description: "适合每天早会前推送给运营、采购和管理层，先看同步状态、动销风险和备货待办。",
    name: "今日经营摘要",
    time: "09:00",
    mode: "daily" as const,
    text: "### 今日经营摘要\n请查看经营总览里的同步健康度、需要处理队列、动销风险和备货建议，优先处理影响今日运营判断的异常。",
    linkText: "查看经营总览",
    linkUrl: "#dashboard",
  },
  {
    id: "daily-stockup",
    title: "每日备货提醒",
    description: "适合每天早会前提醒采购和运营查看缺货、慢销和已采纳建议。",
    name: "每日备货提醒",
    time: "09:30",
    mode: "daily" as const,
    text: "### 今日备货提醒\n请查看备货中心的缺货、低可售天数和已采纳待创建计划 SKU，优先处理净建议数量大、可售天数低的商品。",
    linkText: "查看备货中心",
    linkUrl: "#stockup",
    scene: "stockupRecommendation" as keyof WecomNotificationPayload["scenes"],
  },
  {
    id: "inventory-snapshot",
    title: "库存快照日报",
    description: "适合每天生成库存快照后推给仓储、运营和负责人复核。",
    name: "库存快照日报",
    time: "18:00",
    mode: "daily" as const,
    text: "### 库存快照已生成\n请关注仓库有库存但产品未建档、产品缺仓库数据、库存沉淀和动销异常的 SKU。",
    linkText: "查看库存快照",
    linkUrl: "#inventory-snapshots",
    scene: "inventorySnapshot" as keyof WecomNotificationPayload["scenes"],
  },
  {
    id: "sync-check",
    title: "同步异常检查",
    description: "适合数据同步失败、动销为空或仓库授权调整后人工提醒排查。",
    name: "同步异常检查",
    time: "10:00",
    mode: "daily" as const,
    text: "### 数据同步检查\n请确认产品、仓库库存、订单同步时间是否正常；如某个仓库动销为空，请先查看动销监控里的仓库诊断。",
    linkText: "查看动销监控",
    linkUrl: "#movement",
  },
  {
    id: "qualification-expiry",
    title: "资质过期提醒",
    description: "适合提醒运营补证、续期或下架存在合规风险的商品。",
    name: "资质过期提醒",
    time: "09:00",
    mode: "daily" as const,
    text: "### 资质过期提醒\n请检查已过期和 30 天内到期的资质，优先处理仍在售、分销公开或即将发货的商品。",
    linkText: "查看资质库",
    linkUrl: "#qualifications",
    scene: "qualificationExpiry" as keyof WecomNotificationPayload["scenes"],
  },
] satisfies Array<{
  id: string;
  title: string;
  description: string;
  name: string;
  time: string;
  mode: "daily";
  text: string;
  linkText: string;
  linkUrl: string;
  scene?: keyof WecomNotificationPayload["scenes"];
}>;

function RobotCheckboxes({
  robots,
  selected,
  onChange,
}: {
  robots: WecomRobot[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  if (!robots.length) return <div className="notice warning compact-notice">请先新增至少一个企业微信机器人。</div>;
  const selectedSet = new Set(selected);
  return (
    <div className="wecom-robot-picker">
      {robots.map((robot) => (
        <label className="wecom-check" key={robot.id}>
          <input
            type="checkbox"
            checked={selectedSet.has(robot.id)}
            onChange={(event) => {
              if (event.target.checked) onChange([...selectedSet, robot.id]);
              else onChange(selected.filter((id) => id !== robot.id));
            }}
          />
          <span>{robot.name}</span>
        </label>
      ))}
    </div>
  );
}

function WecomNotificationCenter({ payload, onRefresh }: { payload: WecomNotificationPayload | null; onRefresh: () => Promise<void> }) {
  const confirm = useConfirm();
  const [localPayload, setLocalPayload] = React.useState<WecomNotificationPayload | null>(null);
  const data = localPayload || payload;
  const robots = data?.robots || [];
  const schedules = data?.schedules || [];
  const scenes = data?.scenes || { stockupRecommendation: defaultWecomScene, inventorySnapshot: defaultWecomScene, qualificationExpiry: defaultWecomScene };
  const [robotForm, setRobotForm] = React.useState({ id: "", name: "", webhookUrl: "", enabled: true });
  const [scheduleForm, setScheduleForm] = React.useState({
    id: "",
    name: "",
    robotIds: [] as string[],
    enabled: true,
    mode: "daily" as "daily" | "interval",
    time: "09:00",
    intervalMinutes: 60,
    text: "",
    linkUrl: "",
    linkText: "查看详情",
  });
  const [sceneForm, setSceneForm] = React.useState(scenes);
  const [testForm, setTestForm] = React.useState({ robotIds: [] as string[], text: "这是一条来自同舟供应链数智化系统的测试消息。", linkUrl: "", linkText: "查看详情" });
  const [summaryForm, setSummaryForm] = React.useState({ robotIds: [] as string[], extraText: "", linkUrl: "#dashboard", linkText: "查看经营总览" });
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState("");

  function templateRobotIds(currentIds: string[]) {
    return currentIds.length ? currentIds : robots.filter((robot) => robot.enabled).map((robot) => robot.id);
  }

  function applyScheduleTemplate(template: (typeof wecomNotificationTemplates)[number]) {
    setScheduleForm((current) => ({
      ...current,
      name: current.name || template.name,
      enabled: true,
      mode: template.mode,
      time: template.time,
      intervalMinutes: 60,
      text: template.text,
      linkUrl: current.linkUrl || template.linkUrl,
      linkText: template.linkText,
      robotIds: templateRobotIds(current.robotIds),
    }));
    setMessage(`已填入「${template.title}」定时推送模板。`);
  }

  function applyTestTemplate(template: (typeof wecomNotificationTemplates)[number]) {
    setTestForm((current) => ({
      ...current,
      text: template.text,
      linkUrl: current.linkUrl || template.linkUrl,
      linkText: template.linkText,
      robotIds: templateRobotIds(current.robotIds),
    }));
    setMessage(`已填入「${template.title}」测试消息模板。`);
  }

  function applySceneTemplate(template: (typeof wecomNotificationTemplates)[number]) {
    if (!template.scene) return;
    updateScene(template.scene, {
      enabled: true,
      linkUrl: sceneForm[template.scene]?.linkUrl || template.linkUrl,
      extraText: template.text,
      robotIds: templateRobotIds(sceneForm[template.scene]?.robotIds || []),
    });
    setMessage(`已应用「${template.title}」场景推送模板，请保存场景配置。`);
  }

  React.useEffect(() => {
    if (data?.scenes) setSceneForm(data.scenes);
  }, [data?.updatedAt]);

  async function refresh(result?: WecomNotificationPayload) {
    if (result) setLocalPayload(result);
    else await onRefresh();
  }

  async function saveRobot(event: React.FormEvent) {
    event.preventDefault();
    setBusy("robot");
    setMessage("");
    try {
      const result = await upsertWecomRobot(robotForm);
      await refresh(result);
      setRobotForm({ id: "", name: "", webhookUrl: "", enabled: true });
      setMessage("机器人已保存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "机器人保存失败。");
    } finally {
      setBusy("");
    }
  }

  async function removeRobot(robot: WecomRobot) {
    const confirmed = await confirm({
      title: `删除机器人「${robot.name}」`,
      body: "删除后，依赖这个机器人的定时推送和场景通知将无法继续发送到对应群聊。",
      confirmText: "删除机器人",
      tone: "danger",
      details: ["不会删除已经发送到企业微信群里的历史消息。", "建议先确认没有定时推送仍在使用这个机器人。"],
    });
    if (!confirmed) return;
    setBusy(robot.id);
    setMessage("");
    try {
      const result = await deleteWecomRobot(robot.id);
      await refresh(result);
      setMessage("机器人已删除。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "机器人删除失败。");
    } finally {
      setBusy("");
    }
  }

  function editRobot(robot: WecomRobot) {
    setRobotForm({ id: robot.id, name: robot.name, webhookUrl: "", enabled: robot.enabled });
  }

  async function saveSchedule(event: React.FormEvent) {
    event.preventDefault();
    setBusy("schedule");
    setMessage("");
    try {
      const result = await upsertWecomSchedule(scheduleForm);
      await refresh(result);
      setScheduleForm({ id: "", name: "", robotIds: [], enabled: true, mode: "daily", time: "09:00", intervalMinutes: 60, text: "", linkUrl: "", linkText: "查看详情" });
      setMessage("定时推送已保存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "定时推送保存失败。");
    } finally {
      setBusy("");
    }
  }

  async function removeSchedule(schedule: WecomSchedule) {
    const confirmed = await confirm({
      title: `删除定时推送「${schedule.name}」`,
      body: "删除后，这条定时消息不会再自动发送。",
      confirmText: "删除推送",
      tone: "danger",
      details: [`推送模式：${schedule.mode === "daily" ? `每天 ${schedule.time}` : `每 ${schedule.intervalMinutes} 分钟`}`],
    });
    if (!confirmed) return;
    setBusy(schedule.id);
    setMessage("");
    try {
      const result = await deleteWecomSchedule(schedule.id);
      await refresh(result);
      setMessage("定时推送已删除。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "定时推送删除失败。");
    } finally {
      setBusy("");
    }
  }

  function editSchedule(schedule: WecomSchedule) {
    setScheduleForm({
      id: schedule.id,
      name: schedule.name,
      robotIds: schedule.robotIds || [],
      enabled: schedule.enabled,
      mode: schedule.mode,
      time: schedule.time || "09:00",
      intervalMinutes: schedule.intervalMinutes || 60,
      text: schedule.text,
      linkUrl: schedule.linkUrl || "",
      linkText: schedule.linkText || "查看详情",
    });
  }

  async function saveScenes() {
    setBusy("scenes");
    setMessage("");
    try {
      const result = await updateWecomScenes(sceneForm);
      await refresh(result);
      setMessage("场景推送配置已保存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "场景推送保存失败。");
    } finally {
      setBusy("");
    }
  }

  async function sendTest() {
    setBusy("test");
    setMessage("");
    try {
      const result = await testWecomNotification(testForm);
      await refresh(result);
      const failed = result.results?.filter((item) => !item.ok) || [];
      setMessage(failed.length ? `测试发送完成，${failed.length} 个机器人失败。` : "测试消息已发送。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "测试发送失败。");
    } finally {
      setBusy("");
    }
  }

  async function sendOperatingSummary() {
    setBusy("operating-summary");
    setMessage("");
    try {
      const result = await sendWecomOperatingSummary(summaryForm);
      await refresh(result);
      const failed = result.results?.filter((item) => !item.ok) || [];
      setMessage(failed.length ? `今日经营摘要已发送，${failed.length} 个机器人失败。` : "今日经营摘要已发送。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "今日经营摘要发送失败。");
    } finally {
      setBusy("");
    }
  }

  function updateScene(key: keyof WecomNotificationPayload["scenes"], patch: Partial<WecomSceneConfig>) {
    setSceneForm((current) => ({
      ...current,
      [key]: { ...(current[key] || defaultWecomScene), ...patch },
    }));
  }

  return (
    <main className="movement-page">
      <section className="library-hero movement-hero">
        <div>
          <p className="eyebrow">WeCom Robot Center</p>
          <h2>企业微信机器人通知</h2>
          <p>集中管理多个群机器人，支持定时推送、自定义链接，也支持备货建议和库存快照产生后的场景化提醒。</p>
          <div className="source-row">
            <span className={`status-pill ${robots.length ? "good" : "warning"}`}>{robots.length ? "机器人已配置" : "等待配置机器人"}</span>
            <span>{data?.updatedAt ? formatDateTime(data.updatedAt) : "暂无配置"}</span>
          </div>
        </div>
        <button className="sync-button" type="button" onClick={onRefresh}>
          <RefreshCw size={16} />
          刷新配置
        </button>
      </section>

      <section className="metric-strip movement-metrics">
        <Metric title="机器人" value={formatNumber(robots.length)} note="可配置多个群机器人" icon={BellRing} tone="blue" />
        <Metric title="定时推送" value={formatNumber(schedules.length)} note="按每天时间或间隔发送" icon={CalendarDays} tone="green" />
        <Metric title="场景推送" value={formatNumber(Object.values(scenes).filter((scene) => scene.enabled).length)} note="备货、库存、资质" icon={PackageCheck} tone="orange" />
        <Metric title="最近更新" value={data?.updatedAt ? formatDate(data.updatedAt) : "-"} note="本地通知配置" icon={Settings} tone="red" />
      </section>

      {message ? <div className={`notice ${message.includes("失败") ? "warning" : ""}`}>{message}</div> : null}

      <section className="panel wecom-panel wecom-template-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Message Templates</p>
            <h2>常用通知模板</h2>
          </div>
          <span className="status-pill muted">{formatNumber(wecomNotificationTemplates.length)} 个模板</span>
        </div>
        <div className="wecom-template-grid">
          {wecomNotificationTemplates.map((template) => (
            <article className="wecom-template-card" key={template.id}>
              <div>
                <strong>{template.title}</strong>
                <span>{template.description}</span>
              </div>
              <small>{template.time} · {template.linkText}</small>
              <div className="wecom-template-actions">
                <button className="ghost-button compact-button" type="button" onClick={() => applyScheduleTemplate(template)}>填入定时</button>
                <button className="ghost-button compact-button" type="button" onClick={() => applyTestTemplate(template)}>填入测试</button>
                {template.scene ? <button className="ghost-button compact-button" type="button" onClick={() => applySceneTemplate(template)}>应用场景</button> : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="wecom-grid">
        <form className="panel wecom-panel" onSubmit={saveRobot}>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Robot</p>
              <h2>{robotForm.id ? "编辑机器人" : "新增机器人"}</h2>
            </div>
          </div>
          <label>
            <span>机器人名称</span>
            <input value={robotForm.name} onChange={(event) => setRobotForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如：备货通知群" />
          </label>
          <label>
            <span>Webhook 地址</span>
            <input value={robotForm.webhookUrl} onChange={(event) => setRobotForm((current) => ({ ...current, webhookUrl: event.target.value }))} placeholder={robotForm.id ? "留空则保留原 webhook" : "粘贴企业微信机器人 webhook"} />
          </label>
          <label className="wecom-inline-check">
            <input type="checkbox" checked={robotForm.enabled} onChange={(event) => setRobotForm((current) => ({ ...current, enabled: event.target.checked }))} />
            <span>启用这个机器人</span>
          </label>
          <div className="wecom-actions">
            <button className="sync-button" type="submit" disabled={busy === "robot"}>{busy === "robot" ? "保存中" : "保存机器人"}</button>
            {robotForm.id ? <button className="ghost-button" type="button" onClick={() => setRobotForm({ id: "", name: "", webhookUrl: "", enabled: true })}>取消编辑</button> : null}
          </div>
        </form>

        <section className="panel wecom-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Robots</p>
              <h2>机器人列表</h2>
            </div>
          </div>
          <div className="wecom-list">
            {robots.length ? robots.map((robot) => (
              <article className="wecom-list-item" key={robot.id}>
                <div>
                  <strong>{robot.name}</strong>
                  <span>{robot.webhookMasked || "Webhook 已保存"}</span>
                  {robot.lastError ? <small className="wecom-error">{robot.lastError}</small> : <small>最近发送：{robot.lastSentAt ? formatDateTime(robot.lastSentAt) : "暂无"}</small>}
                </div>
                <span className={`status-pill ${robot.enabled ? "good" : "muted"}`}>{robot.enabled ? "启用" : "停用"}</span>
                <button className="ghost-button compact-button" type="button" onClick={() => editRobot(robot)}>编辑</button>
                <button className="ghost-button compact-button danger-button" type="button" disabled={busy === robot.id} onClick={() => removeRobot(robot)}>删除</button>
              </article>
            )) : <div className="stockup-empty">暂无机器人。先创建一个企业微信群机器人 webhook。</div>}
          </div>
        </section>
      </section>

      <section className="panel wecom-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Scheduled Push</p>
            <h2>{scheduleForm.id ? "编辑定时推送" : "新增定时推送"}</h2>
          </div>
        </div>
        <form className="wecom-form-grid" onSubmit={saveSchedule}>
          <label>
            <span>推送名称</span>
            <input value={scheduleForm.name} onChange={(event) => setScheduleForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如：每日备货提醒" />
          </label>
          <label>
            <span>模式</span>
            <select value={scheduleForm.mode} onChange={(event) => setScheduleForm((current) => ({ ...current, mode: event.target.value as "daily" | "interval" }))}>
              <option value="daily">每天固定时间</option>
              <option value="interval">按间隔循环</option>
            </select>
          </label>
          {scheduleForm.mode === "daily" ? (
            <label>
              <span>推送时间</span>
              <input type="time" value={scheduleForm.time} onChange={(event) => setScheduleForm((current) => ({ ...current, time: event.target.value }))} />
            </label>
          ) : (
            <label>
              <span>间隔分钟</span>
              <input type="number" min={5} max={1440} value={scheduleForm.intervalMinutes} onChange={(event) => setScheduleForm((current) => ({ ...current, intervalMinutes: Number(event.target.value) }))} />
            </label>
          )}
          <label>
            <span>链接文字</span>
            <input value={scheduleForm.linkText} onChange={(event) => setScheduleForm((current) => ({ ...current, linkText: event.target.value }))} />
          </label>
          <label className="wecom-span-2">
            <span>推送链接</span>
            <input value={scheduleForm.linkUrl} onChange={(event) => setScheduleForm((current) => ({ ...current, linkUrl: event.target.value }))} placeholder="可选，例如备货中心链接" />
          </label>
          <label className="wecom-span-2">
            <span>自定义文字</span>
            <textarea value={scheduleForm.text} onChange={(event) => setScheduleForm((current) => ({ ...current, text: event.target.value }))} placeholder="要定时推送到群里的内容" />
          </label>
          <div className="wecom-span-2">
            <span className="field-label">推送机器人</span>
            <RobotCheckboxes robots={robots} selected={scheduleForm.robotIds} onChange={(robotIds) => setScheduleForm((current) => ({ ...current, robotIds }))} />
          </div>
          <label className="wecom-inline-check">
            <input type="checkbox" checked={scheduleForm.enabled} onChange={(event) => setScheduleForm((current) => ({ ...current, enabled: event.target.checked }))} />
            <span>启用定时推送</span>
          </label>
          <div className="wecom-actions">
            <button className="sync-button" type="submit" disabled={busy === "schedule"}>{busy === "schedule" ? "保存中" : "保存定时推送"}</button>
            {scheduleForm.id ? <button className="ghost-button" type="button" onClick={() => setScheduleForm({ id: "", name: "", robotIds: [], enabled: true, mode: "daily", time: "09:00", intervalMinutes: 60, text: "", linkUrl: "", linkText: "查看详情" })}>取消编辑</button> : null}
          </div>
        </form>

        <div className="wecom-list wecom-schedule-list">
          {schedules.length ? schedules.map((schedule) => (
            <article className="wecom-list-item" key={schedule.id}>
              <div>
                <strong>{schedule.name}</strong>
                <span>{schedule.mode === "daily" ? `每天 ${schedule.time}` : `每 ${schedule.intervalMinutes} 分钟`} · {schedule.robotIds.length} 个机器人</span>
                <small>{schedule.lastError ? `错误：${schedule.lastError}` : `最近发送：${schedule.lastSentAt ? formatDateTime(schedule.lastSentAt) : "暂无"}`}</small>
              </div>
              <span className={`status-pill ${schedule.enabled ? "good" : "muted"}`}>{schedule.enabled ? "启用" : "停用"}</span>
              <button className="ghost-button compact-button" type="button" onClick={() => editSchedule(schedule)}>编辑</button>
              <button className="ghost-button compact-button danger-button" type="button" disabled={busy === schedule.id} onClick={() => removeSchedule(schedule)}>删除</button>
            </article>
          )) : <div className="stockup-empty">暂无定时推送。</div>}
        </div>
      </section>

      <section className="panel wecom-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Scene Push</p>
            <h2>场景化推送</h2>
          </div>
          <button className="sync-button" type="button" onClick={saveScenes} disabled={busy === "scenes"}>{busy === "scenes" ? "保存中" : "保存场景配置"}</button>
        </div>
        <div className="wecom-scene-grid">
          {([
            ["stockupRecommendation", "新的备货建议产生时", "备货建议变化后，提醒相关同事查看并安排备货。"],
            ["inventorySnapshot", "库存快照产生时", "每日或手动生成库存快照后，推送库存沉淀结果。"],
            ["qualificationExpiry", "资质过期或即将到期", "资质同步后，推送已过期和 30 天内到期的资质摘要。"],
          ] as Array<[keyof WecomNotificationPayload["scenes"], string, string]>).map(([key, title, description]) => {
            const scene = sceneForm[key] || defaultWecomScene;
            return (
              <article className="wecom-scene-card" key={key}>
                <div className="panel-heading">
                  <div>
                    <h3>{title}</h3>
                    <p>{description}</p>
                  </div>
                  <label className="wecom-switch">
                    <input type="checkbox" checked={scene.enabled} onChange={(event) => updateScene(key, { enabled: event.target.checked })} />
                    <span>{scene.enabled ? "启用" : "停用"}</span>
                  </label>
                </div>
                <label>
                  <span>提醒链接</span>
                  <input value={scene.linkUrl || ""} onChange={(event) => updateScene(key, { linkUrl: event.target.value })} placeholder="可选，例如备货中心/库存快照页面链接" />
                </label>
                <label>
                  <span>附加文字</span>
                  <textarea value={scene.extraText || ""} onChange={(event) => updateScene(key, { extraText: event.target.value })} placeholder="可选，追加到自动生成的消息后面" />
                </label>
                <span className="field-label">推送机器人</span>
                <RobotCheckboxes robots={robots} selected={scene.robotIds || []} onChange={(robotIds) => updateScene(key, { robotIds })} />
                <small>最近发送：{scene.lastSentAt ? formatDateTime(scene.lastSentAt) : "暂无"}</small>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel wecom-panel wecom-summary-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Daily Brief</p>
            <h2>一键发送今日经营摘要</h2>
          </div>
          <button
            className="sync-button"
            type="button"
            onClick={sendOperatingSummary}
            disabled={busy === "operating-summary" || !robots.some((robot) => robot.enabled)}
          >
            {busy === "operating-summary" ? "发送中" : "发送摘要"}
          </button>
        </div>
        <div className="wecom-summary-body">
          <div>
            <strong>摘要会自动包含</strong>
            <span>核心经营指标、备货建议、同步状态、动销诊断异常和 SKU 治理待办。</span>
          </div>
          <div>
            <span className="field-label">推送机器人</span>
            <RobotCheckboxes robots={robots} selected={summaryForm.robotIds} onChange={(robotIds) => setSummaryForm((current) => ({ ...current, robotIds }))} />
            <small>不选择时默认发送到所有已启用机器人。</small>
          </div>
          <div className="wecom-form-grid">
            <label>
              <span>摘要链接</span>
              <input value={summaryForm.linkUrl} onChange={(event) => setSummaryForm((current) => ({ ...current, linkUrl: event.target.value }))} placeholder="#dashboard" />
            </label>
            <label>
              <span>链接文字</span>
              <input value={summaryForm.linkText} onChange={(event) => setSummaryForm((current) => ({ ...current, linkText: event.target.value }))} />
            </label>
            <label className="wecom-span-2">
              <span>补充说明</span>
              <textarea value={summaryForm.extraText} onChange={(event) => setSummaryForm((current) => ({ ...current, extraText: event.target.value }))} placeholder="可选，例如：今天先处理俄罗斯仓动销异常和已采纳待建计划。" />
            </label>
          </div>
        </div>
      </section>

      <section className="panel wecom-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Test Push</p>
            <h2>测试发送</h2>
          </div>
        </div>
        <div className="wecom-form-grid">
          <label className="wecom-span-2">
            <span>测试文字</span>
            <textarea value={testForm.text} onChange={(event) => setTestForm((current) => ({ ...current, text: event.target.value }))} />
          </label>
          <label>
            <span>推送链接</span>
            <input value={testForm.linkUrl} onChange={(event) => setTestForm((current) => ({ ...current, linkUrl: event.target.value }))} placeholder="可选" />
          </label>
          <label>
            <span>链接文字</span>
            <input value={testForm.linkText} onChange={(event) => setTestForm((current) => ({ ...current, linkText: event.target.value }))} />
          </label>
          <div className="wecom-span-2">
            <span className="field-label">推送机器人</span>
            <RobotCheckboxes robots={robots} selected={testForm.robotIds} onChange={(robotIds) => setTestForm((current) => ({ ...current, robotIds }))} />
          </div>
          <div className="wecom-actions">
            <button className="sync-button" type="button" onClick={sendTest} disabled={busy === "test" || !testForm.robotIds.length}>{busy === "test" ? "发送中" : "发送测试消息"}</button>
          </div>
        </div>
      </section>
    </main>
  );
}

function actionTargetLabel(type: string) {
  const labels: Record<string, string> = {
    user: "用户",
    warehouse: "仓库",
    wecom_robot: "企业微信机器人",
    wecom_schedule: "定时推送",
    wecom_scene: "场景推送",
    wecom_summary: "经营摘要",
    order_sync: "订单同步",
    distributor_application: "分销申请",
    quick_nav_category: "导航分类",
    quick_nav_link: "导航链接",
    stockup_recommendation: "备货建议",
    system: "系统",
  };
  return labels[type] || type || "对象";
}

function detailSummary(details?: Record<string, unknown>) {
  if (!details) return "";
  return Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => {
      const text = Array.isArray(value) ? value.join(", ") : typeof value === "object" ? JSON.stringify(value) : String(value);
      return `${key}: ${text}`;
    })
    .join(" · ");
}

type ActionLogEntryItem = ActionLogPayload["entries"][number];

function actionLogSearchText(entry: ActionLogEntryItem) {
  return [
    entry.action,
    entry.targetType,
    actionTargetLabel(entry.targetType),
    entry.targetName,
    entry.actorName,
    entry.actorRole,
    entry.createdAt,
    detailSummary(entry.details),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function actionLogCsv(entries: ActionLogEntryItem[]) {
  const header = ["时间", "动作", "对象类型", "对象", "操作者", "角色", "明细"];
  const rows = entries.map((entry) => [
    formatDateTime(entry.createdAt),
    entry.action,
    actionTargetLabel(entry.targetType),
    entry.targetName || "未命名对象",
    entry.actorName || "系统",
    entry.actorRole || "未知角色",
    detailSummary(entry.details),
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function actionLogText(entries: ActionLogEntryItem[]) {
  if (!entries.length) return "当前筛选条件下暂无操作日志。";
  return entries.map((entry) => [
    `${formatDateTime(entry.createdAt)}｜${entry.action}`,
    `对象：${actionTargetLabel(entry.targetType)} · ${entry.targetName || "未命名对象"}`,
    `操作者：${entry.actorName || "系统"}（${entry.actorRole || "未知角色"}）`,
    detailSummary(entry.details) ? `明细：${detailSummary(entry.details)}` : "",
  ].filter(Boolean).join("\n")).join("\n\n");
}

function ActionLogPage({ payload, onRefresh }: { payload: ActionLogPayload | null; onRefresh: () => Promise<void> }) {
  const entries = payload?.entries || [];
  const [keyword, setKeyword] = React.useState("");
  const [targetType, setTargetType] = React.useState("all");
  const [actorRole, setActorRole] = React.useState("all");
  const [actionName, setActionName] = React.useState("all");
  const latest = entries[0];
  const actorCount = new Set(entries.map((entry) => entry.actorName).filter(Boolean)).size;
  const targetTypeOptions = React.useMemo(() => uniqueSorted(entries.map((entry) => entry.targetType)), [entries]);
  const actorRoleOptions = React.useMemo(() => uniqueSorted(entries.map((entry) => entry.actorRole || "未知角色")), [entries]);
  const actionOptions = React.useMemo(() => uniqueSorted(entries.map((entry) => entry.action)), [entries]);
  const filteredEntries = React.useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return entries.filter((entry) => {
      if (targetType !== "all" && entry.targetType !== targetType) return false;
      if (actorRole !== "all" && (entry.actorRole || "未知角色") !== actorRole) return false;
      if (actionName !== "all" && entry.action !== actionName) return false;
      if (normalizedKeyword && !actionLogSearchText(entry).includes(normalizedKeyword)) return false;
      return true;
    });
  }, [actionName, actorRole, entries, keyword, targetType]);
  const activeFilterCount = [keyword.trim(), targetType !== "all", actorRole !== "all", actionName !== "all"].filter(Boolean).length;

  function resetFilters() {
    setKeyword("");
    setTargetType("all");
    setActorRole("all");
    setActionName("all");
  }

  async function copyFilteredLog() {
    await copyText(actionLogText(filteredEntries));
  }

  function downloadFilteredLog() {
    downloadTextFile(`tongzhou-action-log-${new Date().toISOString().slice(0, 10)}.csv`, actionLogCsv(filteredEntries), "text/csv;charset=utf-8");
  }

  return (
    <main className="movement-page action-log-page">
      <section className="library-hero movement-hero">
        <div>
          <p className="eyebrow">Operation Trail</p>
          <h2>操作日志</h2>
          <p>记录用户、仓库、企业微信、快捷导航和备货建议等关键后台动作，方便排查配置变化和协作责任。</p>
          <div className="source-row">
            <span className={`status-pill ${entries.length ? "good" : "warning"}`}>{entries.length ? "已有记录" : "暂无记录"}</span>
            <span>{payload?.updatedAt ? formatDateTime(payload.updatedAt) : "等待操作产生"}</span>
          </div>
        </div>
        <button className="sync-button" type="button" onClick={onRefresh}>
          <RefreshCw size={16} />
          刷新日志
        </button>
      </section>

      <section className="metric-strip movement-metrics">
        <Metric title="最近记录" value={formatNumber(entries.length)} note="最多保留 300 条" icon={List} tone="blue" />
        <Metric title="操作者" value={formatNumber(actorCount)} note="按显示名去重" icon={Lock} tone="green" />
        <Metric title="筛选结果" value={formatNumber(filteredEntries.length)} note={activeFilterCount ? `已启用 ${activeFilterCount} 个条件` : "未启用筛选"} icon={Search} tone="orange" />
        <Metric title="最近动作" value={latest?.action || "-"} note={latest?.createdAt ? formatDateTime(latest.createdAt) : "暂无"} icon={FileText} tone="red" />
      </section>

      <section className="panel action-log-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Recent Actions</p>
            <h2>最近后台操作</h2>
          </div>
          <div className="action-log-toolbar">
            <span className="status-pill muted">{formatNumber(filteredEntries.length)} / {formatNumber(entries.length)} 条</span>
            <button className="ghost-button" type="button" onClick={copyFilteredLog} disabled={!filteredEntries.length}>
              <Copy size={14} />
              复制摘要
            </button>
            <button className="ghost-button" type="button" onClick={downloadFilteredLog} disabled={!filteredEntries.length}>
              <Download size={14} />
              导出 CSV
            </button>
          </div>
        </div>
        <div className="action-log-filters">
          <label>
            <span>关键词</span>
            <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜动作、对象、操作者、明细" />
          </label>
          <label>
            <span>对象类型</span>
            <select value={targetType} onChange={(event) => setTargetType(event.target.value)}>
              <option value="all">全部对象</option>
              {targetTypeOptions.map((value) => <option value={value} key={value}>{actionTargetLabel(value)}</option>)}
            </select>
          </label>
          <label>
            <span>操作者角色</span>
            <select value={actorRole} onChange={(event) => setActorRole(event.target.value)}>
              <option value="all">全部角色</option>
              {actorRoleOptions.map((value) => <option value={value} key={value}>{value}</option>)}
            </select>
          </label>
          <label>
            <span>动作</span>
            <select value={actionName} onChange={(event) => setActionName(event.target.value)}>
              <option value="all">全部动作</option>
              {actionOptions.map((value) => <option value={value} key={value}>{value}</option>)}
            </select>
          </label>
          <button className="ghost-button" type="button" onClick={resetFilters} disabled={!activeFilterCount}>
            <X size={14} />
            清空
          </button>
        </div>
        <div className="action-log-list">
          {filteredEntries.length ? filteredEntries.map((entry) => (
            <article className="action-log-item" key={entry.id}>
              <div className="action-log-main">
                <strong>{entry.action}</strong>
                <span>{actionTargetLabel(entry.targetType)} · {entry.targetName || "未命名对象"}</span>
                {detailSummary(entry.details) ? <small>{detailSummary(entry.details)}</small> : null}
              </div>
              <div className="action-log-meta">
                <span>{entry.actorName || "系统"}</span>
                <small>{entry.actorRole || "未知角色"}</small>
                <small>{formatDateTime(entry.createdAt)}</small>
              </div>
            </article>
          )) : (
            <div className="stockup-empty">{entries.length ? "当前筛选条件下暂无操作日志，可清空条件后查看全部记录。" : "暂无操作日志。创建用户、调整仓库授权、配置企业微信或处理备货建议后会自动记录。"}</div>
          )}
        </div>
      </section>
    </main>
  );
}

function AgentApiAccessPage({ currentUser }: { currentUser: AuthUser }) {
  const confirm = useConfirm();
  const [keys, setKeys] = React.useState<AgentApiKey[]>([]);
  const [loadingKeys, setLoadingKeys] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [name, setName] = React.useState("我的 Agent");
  const [expiresInDays, setExpiresInDays] = React.useState(90);
  const [newApiKey, setNewApiKey] = React.useState("");
  const manifestUrl = new URL(resolveApiUrl("/api/agent/manifest"), window.location.href).toString();
  const openApiUrl = new URL(resolveApiUrl("/api/agent/openapi.json"), window.location.href).toString();
  const apiBaseUrl = manifestUrl.replace(/\/api\/agent\/manifest$/, "");
  const agentConfig = `TONGZHOU_AGENT_BASE_URL=${apiBaseUrl}\nTONGZHOU_AGENT_TOKEN=<YOUR_API_KEY>`;
  const curlExample = `curl "${apiBaseUrl}/api/agent/search?q=SKU&types=product_catalog" \\\n  -H "Authorization: Bearer <YOUR_API_KEY>"`;
  const comparisonCurlExample = `curl "${apiBaseUrl}/api/movement-history/compare?period=month&warehouseId=<WAREHOUSE_ID>&timezone=Asia%2FShanghai" \\\n  -H "Authorization: Bearer <YOUR_API_KEY>"`;

  const loadKeys = React.useCallback(async () => {
    setLoadingKeys(true);
    setError("");
    try {
      const payload = await fetchAgentApiKeys();
      setKeys(payload.keys || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取 Agent API Key 失败。");
    } finally {
      setLoadingKeys(false);
    }
  }, []);

  React.useEffect(() => {
    if (currentUser.role === "guest") {
      setLoadingKeys(false);
      return;
    }
    void loadKeys();
  }, [currentUser.role, loadKeys]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError("");
    setNotice("");
    try {
      const payload = await createAgentApiKey({ name, expiresInDays });
      setNewApiKey(payload.apiKey);
      setNotice("API Key 已创建。完整密钥只显示这一次，请立即复制到 Agent 配置中。");
      await loadKeys();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "创建 Agent API Key 失败。");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(key: AgentApiKey) {
    const confirmed = await confirm({
      title: "撤销 Agent API Key",
      body: `撤销“${key.name}”后，使用该 Key 的 Agent 会立即失去访问权限。`,
      confirmText: "确认撤销",
      tone: "danger",
      details: [`Key：${key.keyPrefix}`, `权限：${key.scope}`],
    });
    if (!confirmed) return;
    setError("");
    try {
      await revokeAgentApiKey(key.id);
      if (newApiKey.startsWith(key.keyPrefix.replace("…", ""))) setNewApiKey("");
      setNotice(`已撤销“${key.name}”。`);
      await loadKeys();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "撤销 Agent API Key 失败。");
    }
  }

  async function handleCopy(value: string, message: string) {
    await copyText(value);
    setNotice(message);
  }

  return (
    <main className="movement-page agent-api-page">
      <section className="panel agent-api-hero">
        <div>
          <p className="eyebrow">Agent Developer Access</p>
          <h2>让你的 Agent 安全读取同舟数据</h2>
          <p>API Key 只允许调用只读 Agent 索引及明确声明的分析接口，并实时继承当前账号“{currentUser.displayName || currentUser.username}”的角色和停用状态。</p>
        </div>
        <div className="agent-api-hero-actions">
          <a className="ghost-button" href={openApiUrl} target="_blank" rel="noreferrer">
            <FileText size={16} />
            打开 OpenAPI
          </a>
          <button className="sync-button" type="button" onClick={() => void handleCopy(agentConfig, "Agent 环境变量已复制。")}>
            <Copy size={16} />
            复制接入配置
          </button>
        </div>
      </section>

      {error ? <div className="notice danger">{error}</div> : null}
      {notice ? <div className="notice good">{notice}</div> : null}

      <section className="agent-api-layout">
        <div className="panel agent-api-key-panel">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Personal Credential</p>
              <h3>我的 Agent API Key</h3>
            </div>
            <span className="agent-scope-badge">只读 · agent:read</span>
          </div>

          <form className="agent-key-form" onSubmit={handleCreate}>
            <label>
              <span>Key 名称</span>
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="例如：采购助手" />
            </label>
            <label>
              <span>有效期</span>
              <select value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value))}>
                <option value={30}>30 天</option>
                <option value={90}>90 天</option>
                <option value={180}>180 天</option>
                <option value={365}>365 天</option>
              </select>
            </label>
            <button className="sync-button" type="submit" disabled={creating || !name.trim()}>
              <KeyRound size={16} />
              {creating ? "创建中" : "创建 API Key"}
            </button>
          </form>

          {newApiKey ? (
            <div className="agent-secret-card" role="status">
              <div>
                <strong>仅显示一次</strong>
                <span>不要截图、不要发到群聊，也不要提交到代码仓库。</span>
              </div>
              <code>{newApiKey}</code>
              <div className="agent-secret-actions">
                <button className="sync-button" type="button" onClick={() => void handleCopy(newApiKey, "完整 API Key 已复制。")}>
                  <Copy size={16} />
                  复制完整 Key
                </button>
                <button className="ghost-button" type="button" onClick={() => setNewApiKey("")}>我已保存</button>
              </div>
            </div>
          ) : null}

          <div className="agent-key-list">
            {loadingKeys ? <p className="empty-text">正在读取 API Key…</p> : null}
            {!loadingKeys && !keys.length ? <p className="empty-text">还没有 API Key。创建后即可连接内部 Agent。</p> : null}
            {keys.map((key) => (
              <article className="agent-key-item" key={key.id}>
                <div className="agent-key-main">
                  <div>
                    <strong>{key.name}</strong>
                    <code>{key.keyPrefix}</code>
                  </div>
                  <span className={`agent-key-status ${key.status}`}>
                    {key.status === "active" ? "有效" : key.status === "expired" ? "已过期" : "已撤销"}
                  </span>
                </div>
                <div className="agent-key-meta">
                  <span>创建：{formatDateTime(key.createdAt)}</span>
                  <span>到期：{formatDateTime(key.expiresAt)}</span>
                  <span>最近使用：{key.lastUsedAt ? formatDateTime(key.lastUsedAt) : "尚未使用"}</span>
                </div>
                {key.status === "active" ? (
                  <button className="ghost-button danger-button compact-button" type="button" onClick={() => void handleRevoke(key)}>
                    <Trash2 size={15} />
                    撤销
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        </div>

        <div className="agent-api-docs">
          <section className="panel">
            <p className="eyebrow">Quick Start</p>
            <h3>三步接入</h3>
            <ol className="agent-step-list">
              <li><span>1</span><div><strong>创建并复制 Key</strong><small>完整 Key 只显示一次。</small></div></li>
              <li><span>2</span><div><strong>导入 OpenAPI</strong><small>{openApiUrl}</small></div></li>
              <li><span>3</span><div><strong>设置 Bearer 认证</strong><small>Authorization: Bearer tzai_...</small></div></li>
            </ol>
          </section>

          <section className="panel">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Example</p>
                <h3>最小调用示例</h3>
              </div>
              <button className="ghost-button compact-button" type="button" onClick={() => void handleCopy(curlExample, "curl 示例已复制。")}>
                <Copy size={15} />
                复制
              </button>
            </div>
            <pre className="agent-code-block"><code>{curlExample}</code></pre>
          </section>

          {currentUser.role === "admin" ? (
            <section className="panel">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Inventory Reconciliation</p>
                  <h3>库存差异计算 API</h3>
                </div>
                <button className="ghost-button compact-button" type="button" onClick={() => void handleCopy(comparisonCurlExample, "库存差异计算 curl 示例已复制。")}>
                  <Copy size={15} />
                  复制
                </button>
              </div>
              <p className="agent-operation-note">按周、月、季度、年或指定时间段返回 SKU 状态变化、理论期末库存、实际期末库存和差异；只允许管理员 Key 调用。</p>
              <pre className="agent-code-block"><code>{comparisonCurlExample}</code></pre>
            </section>
          ) : null}

          <section className="panel agent-endpoint-list">
            <p className="eyebrow">Endpoints</p>
            <h3>Agent 会用到的接口</h3>
            {[
              ["发现", "/.well-known/agent-index.json"],
              ["搜索", "/api/agent/search"],
              ["按 ID 获取", "/api/agent/resources/{type}/{id}"],
              ["增量更新", "/api/agent/updated_since"],
              ["删除同步", "/api/agent/deleted_since"],
              ...(currentUser.role === "admin" ? [["库存差异计算", "/api/movement-history/compare"]] : []),
            ].map(([label, endpoint]) => (
              <div key={endpoint}>
                <span>{label}</span>
                <code>{endpoint}</code>
              </div>
            ))}
          </section>
        </div>
      </section>
    </main>
  );
}

function UserManagement({ userPayload }: { userPayload: UserManagementPayload | null }) {
  const confirm = useConfirm();
  const users = userPayload?.users ?? [];
  const [form, setForm] = React.useState({ username: "", password: "", displayName: "", role: "distributor" as "distributor" | "direct" | "admin" });
  const [saving, setSaving] = React.useState(false);
  const [actionUserId, setActionUserId] = React.useState("");
  const [actionApplicationId, setActionApplicationId] = React.useState("");
  const [sourceApplicationId, setSourceApplicationId] = React.useState("");
  const [localPayload, setLocalPayload] = React.useState<UserManagementPayload | null>(null);
  const [applicationPayload, setApplicationPayload] = React.useState<DistributorApplicationPayload | null>(null);
  const [message, setMessage] = React.useState("");
  const visiblePayload = localPayload || userPayload;
  const visibleUsers = visiblePayload?.users ?? users;
  const applications = applicationPayload?.applications ?? [];
  const pendingApplications = applications.filter((item) => item.status === "pending");

  React.useEffect(() => {
    void loadApplications();
  }, []);

  async function loadApplications() {
    try {
      const payload = await fetchDistributorApplications();
      setApplicationPayload(payload);
    } catch {
      setApplicationPayload(null);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const result = await createUser(form);
      setLocalPayload(result);
      let nextMessage = result.warning || "用户已创建，并已同步到同舟供应链数智化系统。";
      if (sourceApplicationId) {
        try {
          const applicationResult = await updateDistributorApplicationStatus(sourceApplicationId, "approved");
          setApplicationPayload(applicationResult);
          setSourceApplicationId("");
          nextMessage = `${nextMessage} 对应分销申请已标记为已通过。`;
        } catch (statusError) {
          setSourceApplicationId("");
          nextMessage = `${nextMessage} 但分销申请状态更新失败：${statusError instanceof Error ? statusError.message : "请稍后手动标记"}`;
        }
      }
      setForm({ username: "", password: "", displayName: "", role: "distributor" });
      setMessage(nextMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建用户失败。");
    } finally {
      setSaving(false);
    }
  }

  function usernameFromApplication(application: DistributorApplicationPayload["applications"][number]) {
    const raw = application.phone || application.wechat || application.email.split("@")[0] || application.contactName || application.companyName;
    const normalized = raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "").slice(0, 32);
    return normalized || `partner${Date.now().toString(36)}`;
  }

  function fillUserFromApplication(application: DistributorApplicationPayload["applications"][number]) {
    setForm({
      username: usernameFromApplication(application),
      password: "",
      displayName: application.companyName || application.contactName,
      role: "distributor",
    });
    setSourceApplicationId(application.id);
    setMessage("已带入创建账号表单，请填写初始密码后创建。");
    window.setTimeout(() => document.getElementById("create-user-form")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
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
    const user = visibleUsers.find((item) => item.id === userId);
    const confirmed = await confirm({
      title: `删除用户「${user?.displayName || user?.username || userId}」`,
      body: "删除后该账号将无法登录系统，且会同步到同舟供应链数智化系统。",
      confirmText: "删除用户",
      tone: "danger",
      details: [`账号：${user?.username || userId}`, `角色：${user?.roleLabel || "未识别"}`],
    });
    if (!confirmed) return;
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

  async function handleApplicationStatus(applicationId: string, status: "pending" | "contacted" | "approved" | "rejected") {
    setActionApplicationId(applicationId);
    setMessage("");
    try {
      const result = await updateDistributorApplicationStatus(applicationId, status);
      setApplicationPayload(result);
      setMessage("分销申请状态已更新。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "分销申请状态更新失败。");
    } finally {
      setActionApplicationId("");
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
        <Metric title="管理员" value={formatNumber(visiblePayload?.counts.admin ?? 0)} note="可查看订单、动销、备货和用户管理" icon={ShieldCheck} tone="green" />
        <Metric title="直营运营" value={formatNumber(visiblePayload?.counts.direct ?? 0)} note="看产品、直营价、库存和素材资质" icon={ShoppingBag} tone="orange" />
        <Metric title="分销商" value={formatNumber(visiblePayload?.counts.distributor ?? 0)} note="仅看产品、分销价、素材和资质" icon={ShoppingBag} tone="red" />
      </section>

      <section className="panel distributor-application-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Partner Requests</p>
            <h2>分销账号申请</h2>
          </div>
          <span className={`status-pill ${pendingApplications.length ? "warning" : "good"}`}>
            {pendingApplications.length ? `${formatNumber(pendingApplications.length)} 条待处理` : "暂无待处理"}
          </span>
        </div>
        <div className="distributor-application-list">
          {applications.length ? applications.map((application) => (
            <article className="distributor-application-item" key={application.id}>
              <div>
                <strong>{application.companyName}</strong>
                <span>{application.contactName} · {application.market || "未填写市场"}</span>
                <small>{[application.phone, application.wechat, application.email].filter(Boolean).join(" / ") || "未填写联系方式"}</small>
                {application.sourceSku ? <small>来源 SKU：{application.sourceSku}</small> : null}
                {application.note ? <small>{application.note}</small> : null}
              </div>
              <span className={`status-pill ${application.status === "pending" ? "warning" : application.status === "approved" ? "good" : application.status === "rejected" ? "danger" : "muted"}`}>
                {application.status === "pending" ? "待处理" : application.status === "contacted" ? "已联系" : application.status === "approved" ? "已通过" : application.status === "rejected" ? "已拒绝" : application.status}
              </span>
              <div className="distributor-application-actions">
                <button className="sync-button compact-button" type="button" disabled={actionApplicationId === application.id} onClick={() => fillUserFromApplication(application)}>
                  <Plus size={14} />
                  带入建账号
                </button>
                <button className="ghost-button compact-button" type="button" disabled={actionApplicationId === application.id} onClick={() => handleApplicationStatus(application.id, "contacted")}>已联系</button>
                <button className="ghost-button compact-button" type="button" disabled={actionApplicationId === application.id} onClick={() => handleApplicationStatus(application.id, "approved")}>通过</button>
                <button className="ghost-button compact-button danger-button" type="button" disabled={actionApplicationId === application.id} onClick={() => handleApplicationStatus(application.id, "rejected")}>拒绝</button>
              </div>
            </article>
          )) : (
            <div className="stockup-empty">暂无分销账号申请。游客可从产品库横幅或锁定价格处提交申请。</div>
          )}
        </div>
      </section>

      <section className="panel warehouse-auth-form" id="create-user-form">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Create Account</p>
            <h2>创建用户</h2>
          </div>
          {sourceApplicationId ? <span className="status-pill warning">来自分销申请</span> : null}
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
            <select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as "distributor" | "direct" | "admin" }))}>
              <option value="distributor">分销商</option>
              <option value="direct">直营运营</option>
              <option value="admin">管理员</option>
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
              <span className={`status-pill ${user.role === "admin" ? "good" : user.role === "direct" ? "warning" : "muted"}`}>{user.roleLabel}</span>
              <span className={`status-pill ${user.status === "disabled" ? "danger" : "good"}`}>{user.statusLabel || (user.status === "disabled" ? "停用" : "启用")}</span>
              <span>{user.role === "admin" ? "可查看全部模块，并管理订单、动销、备货、仓库授权和用户。" : user.role === "direct" ? "可查看产品库、直营价格、库存、素材库、资质库和仓库信息。" : "可查看产品库、分销价格、销售价格、素材库和资质库。"}</span>
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
  onTest,
}: {
  warehousePayload: WarehousePayload | null;
  onSync: () => void;
  syncing: boolean;
  onCreate: (input: Parameters<typeof createWarehouseConnection>[0]) => Promise<void>;
  onUpdate: (id: string, input: Parameters<typeof updateWarehouseConnection>[1]) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onExport: () => Promise<void>;
  onImport: (file: File) => Promise<void>;
  onTest: (input: Parameters<typeof testWarehouseConnection>[0]) => Promise<Awaited<ReturnType<typeof testWarehouseConnection>>>;
}) {
  const confirm = useConfirm();
  const providers = warehousePayload?.providers ?? [];
  const connections = warehousePayload?.warehouses ?? [];
  const warehouseOnlyItems = warehousePayload?.lastSync?.warehouseOnlyInventory ?? [];
  const warehouseOnlyCount = warehousePayload?.lastSync?.warehouseOnlyCount ?? warehouseOnlyItems.length;
  const productMissingWarehouseItems = warehousePayload?.lastSync?.productMissingWarehouseItems ?? [];
  const productMissingWarehouseCount = warehousePayload?.lastSync?.productMissingWarehouseCount ?? 0;
  const warehouseOnlyCsv = React.useMemo(() => {
    const header = ["仓库", "国家", "SKU", "国家SKU", "可售", "锁定", "在途", "合计"];
    const rows = warehouseOnlyItems.map((item) => [
      item.warehouseName,
      item.country,
      item.sku,
      item.countrySku,
      item.availableQty,
      item.lockedQty,
      item.inTransitQty,
      item.totalQty,
    ]);
    return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  }, [warehouseOnlyItems]);
  const productMissingWarehouseCsv = React.useMemo(() => {
    const header = ["SKU", "国家SKU", "产品名称", "国家", "渠道", "品类", "系统状态", "系统库存", "单位", "建议动作"];
    const rows = productMissingWarehouseItems.map((item) => [
      item.sku,
      item.countrySku,
      item.name,
      item.country,
      item.channel,
      item.category,
      item.status,
      item.stockQty,
      item.unit,
      "检查仓库库存同步、仓库SKU映射或是否应下架/补货",
    ]);
    return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  }, [productMissingWarehouseItems]);
  const warehouseOnlySummary = React.useMemo(() => {
    const values = new Map<string, { warehouseId: string; warehouseName: string; skuCount: number; totalQty: number }>();
    for (const item of warehouseOnlyItems) {
      const key = item.warehouseId || item.warehouseName || "unknown";
      const current = values.get(key) || { warehouseId: item.warehouseId, warehouseName: item.warehouseName || item.warehouseId || "未识别仓库", skuCount: 0, totalQty: 0 };
      current.skuCount += 1;
      current.totalQty += item.totalQty || item.availableQty || 0;
      values.set(key, current);
    }
    return Array.from(values.values()).sort((a, b) => b.skuCount - a.skuCount || b.totalQty - a.totalQty);
  }, [warehouseOnlyItems]);
  const [gapCopyMessage, setGapCopyMessage] = React.useState("");
  const [formOpen, setFormOpen] = React.useState(false);
  const [editingWarehouse, setEditingWarehouse] = React.useState<WarehousePayload["warehouses"][number] | null>(null);
  const [deletingId, setDeletingId] = React.useState("");
  const [testingId, setTestingId] = React.useState("");
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
    const confirmed = await confirm({
      title: `删除仓库「${warehouse.name}」`,
      body: "删除后会移除该仓库授权，并清理该仓库的本地库存与订单缓存。",
      confirmText: "删除仓库",
      tone: "danger",
      details: [
        `国家/地区：${warehouse.country || "未配置"}`,
        `WMS：${warehouse.providerName || warehouse.providerId}`,
        "如只是授权失效，优先使用编辑或检测连接。",
      ],
    });
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

  async function testConnection(warehouse: WarehousePayload["warehouses"][number]) {
    setTestingId(warehouse.id);
    try {
      await onTest({ ...warehouse, id: warehouse.id });
    } finally {
      setTestingId("");
    }
  }

  async function copyWarehouseOnlySkus() {
    const text = uniqueSorted(warehouseOnlyItems.map((item) => item.sku).filter(Boolean)).join("\n");
    if (!text) return;
    await copyText(text);
    setGapCopyMessage(`已复制 ${formatNumber(text.split("\n").length)} 个待补档 SKU`);
    window.setTimeout(() => setGapCopyMessage(""), 2200);
  }

  async function copyProductMissingWarehouseSkus() {
    const text = uniqueSorted(productMissingWarehouseItems.map((item) => item.sku).filter(Boolean)).join("\n");
    if (!text) return;
    await copyText(text);
    setGapCopyMessage(`已复制 ${formatNumber(text.split("\n").length)} 个待查仓库库存 SKU`);
    window.setTimeout(() => setGapCopyMessage(""), 2200);
  }

  function downloadWarehouseOnlyCsv() {
    if (!warehouseOnlyItems.length) return;
    downloadTextFile(`tongzhou-warehouse-only-sku-${new Date().toISOString().slice(0, 10)}.csv`, warehouseOnlyCsv, "text/csv;charset=utf-8");
  }

  function downloadProductMissingWarehouseCsv() {
    if (!productMissingWarehouseItems.length) return;
    downloadTextFile(`tongzhou-product-missing-warehouse-sku-${new Date().toISOString().slice(0, 10)}.csv`, productMissingWarehouseCsv, "text/csv;charset=utf-8");
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
          onTest={onTest}
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
            <h2>SKU 治理入口</h2>
          </div>
          <div className="gap-toolbar">
            <button className="ghost-button" type="button" onClick={copyWarehouseOnlySkus} disabled={!warehouseOnlyItems.length}>复制待补档 SKU</button>
            <button className="ghost-button" type="button" onClick={downloadWarehouseOnlyCsv} disabled={!warehouseOnlyItems.length}>下载补档清单</button>
            <button className="ghost-button" type="button" onClick={copyProductMissingWarehouseSkus} disabled={!productMissingWarehouseItems.length}>复制待查库存 SKU</button>
            <button className="ghost-button" type="button" onClick={downloadProductMissingWarehouseCsv} disabled={!productMissingWarehouseItems.length}>下载缺库存清单</button>
          </div>
        </div>
        <div className="gap-summary">
          <span>仓库有库存但系统未建档：<strong>{formatNumber(warehouseOnlyCount)}</strong></span>
          <span>系统有产品但仓库无库存：<strong>{formatNumber(productMissingWarehouseCount)}</strong></span>
        </div>
        {gapCopyMessage ? <div className="notice good compact-notice">{gapCopyMessage}</div> : null}
        {warehouseOnlySummary.length ? (
          <div className="gap-governance-grid">
            {warehouseOnlySummary.slice(0, 4).map((item) => (
              <article key={item.warehouseId || item.warehouseName}>
                <strong>{item.warehouseName}</strong>
                <span>{formatNumber(item.skuCount)} 个 SKU · {formatNumber(item.totalQty)} 件库存</span>
                <small>优先确认产品档案、国家 SKU 映射和仓库编码。</small>
              </article>
            ))}
          </div>
        ) : null}
        <div className="gap-split-grid">
          <section>
            <div className="gap-list-heading">
              <strong>仓库有库存，产品库未建档</strong>
              <span>{formatNumber(warehouseOnlyItems.length)} 条样例</span>
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
                      <span className="status-pill warning">待补产品档案</span>
                      <small>处理后重新同步仓库，动销会自动并入口径。</small>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="notice">当前没有仓库-only SKU。</div>
            )}
          </section>
          <section>
            <div className="gap-list-heading">
              <strong>产品库有 SKU，仓库无库存</strong>
              <span>{formatNumber(productMissingWarehouseItems.length)} 条样例</span>
            </div>
            {productMissingWarehouseItems.length ? (
              <div className="gap-table">
                {productMissingWarehouseItems.slice(0, 8).map((item) => (
                  <article key={`${item.id}-${item.countrySku}-${item.sku}`} className="gap-row">
                    <div>
                      <strong>{item.sku}</strong>
                      <span>{item.country} · {item.name}</span>
                    </div>
                    <span>{item.channel || "未分渠道"}</span>
                    <span>系统库存 {formatNumber(item.stockQty)}</span>
                    <div className="gap-actions">
                      <span className="status-pill muted">待查仓库库存</span>
                      <small>检查库存同步、仓库 SKU 映射，或确认该 SKU 是否应下架/补货。</small>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="notice">当前没有产品库缺仓库库存 SKU。</div>
            )}
          </section>
        </div>
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
              <span className={`status-pill ${warehouse.lastTestStatus === "ok" ? "good" : warehouse.lastTestStatus ? "warning" : "muted"}`}>
                {warehouse.lastTestStatus === "ok" ? "检测正常" : warehouse.lastTestStatus ? "待排查" : "未检测"}
              </span>
              <div className="warehouse-row-actions">
                <button className="ghost-button compact-button" onClick={() => testConnection(warehouse)} disabled={testingId === warehouse.id}>
                  {testingId === warehouse.id ? "检测中" : "检测连接"}
                </button>
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

function OrderAnalysisPage({
  payload,
  onLoadOrderAnalysis,
  onUpdateShopAlias,
  onSyncOrders,
  syncing,
}: {
  payload: OrderAnalysisPayload | null;
  onLoadOrderAnalysis: (input?: { dateFrom?: string; dateTo?: string; country?: string; warehouseId?: string; platform?: string; shopName?: string; projectGroup?: string; keyword?: string; scope?: "russia" | "all" }) => Promise<void>;
  onUpdateShopAlias: (shopName: string, alias: string) => Promise<void>;
  onSyncOrders: () => Promise<void>;
  syncing: boolean;
}) {
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [country, setCountry] = React.useState("");
  const [warehouseId, setWarehouseId] = React.useState("");
  const [platform, setPlatform] = React.useState("");
  const [shopName, setShopName] = React.useState("");
  const [projectGroup, setProjectGroup] = React.useState("");
  const [keywordDraft, setKeywordDraft] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [previewImage, setPreviewImage] = React.useState<{ url: string; title: string } | null>(null);
  const filters = payload?.filters;
  const counts = payload?.counts;
  const maxDaily = Math.max(...(payload?.daily || []).map((item) => item.orderCount), 1);
  const dailyTrend = payload?.daily || [];
  const dailyPoints = dailyTrend.map((item, index) => {
    const x = dailyTrend.length <= 1 ? 50 : (index / (dailyTrend.length - 1)) * 100;
    const y = 88 - (item.orderCount / maxDaily) * 72;
    return { ...item, x, y };
  });
  const dailyLinePath = dailyPoints.map((item, index) => `${index === 0 ? "M" : "L"} ${item.x.toFixed(2)} ${item.y.toFixed(2)}`).join(" ");
  const dailyAreaPath = dailyPoints.length ? `${dailyLinePath} L ${dailyPoints[dailyPoints.length - 1].x.toFixed(2)} 96 L ${dailyPoints[0].x.toFixed(2)} 96 Z` : "";

  React.useEffect(() => {
    if (!filters) return;
    setDateFrom((current) => current || filters.dateFrom || "");
    setDateTo((current) => current || filters.dateTo || "");
    setCountry((current) => current || filters.country || "");
    setWarehouseId((current) => current || filters.warehouseId || "");
    setPlatform((current) => current || filters.platform || "");
    setShopName((current) => current || filters.shopName || "");
    setProjectGroup((current) => current || filters.projectGroup || "");
    setKeywordDraft((current) => current || filters.keyword || "");
  }, [filters?.dateFrom, filters?.dateTo]);

  async function submitFilters(event?: React.FormEvent) {
    event?.preventDefault();
    setLoading(true);
    try {
      await onLoadOrderAnalysis({ dateFrom, dateTo, country, warehouseId, platform, shopName, projectGroup, keyword: keywordDraft, scope: "russia" });
    } finally {
      setLoading(false);
    }
  }

  async function resetFilters() {
    setCountry("");
    setWarehouseId("");
    setPlatform("");
    setShopName("");
    setProjectGroup("");
    setKeywordDraft("");
    setLoading(true);
    try {
      await onLoadOrderAnalysis({ dateFrom, dateTo, scope: "russia" });
    } finally {
      setLoading(false);
    }
  }

  async function editShopAlias(rawShopName: string, currentLabel: string) {
    if (!rawShopName || rawShopName === "未识别店铺") return;
    const nextAlias = window.prompt(`设置店铺「${rawShopName}」的别称；留空则恢复原名称。`, currentLabel === rawShopName ? "" : currentLabel);
    if (nextAlias === null) return;
    setLoading(true);
    try {
      await onUpdateShopAlias(rawShopName, nextAlias.trim());
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="movement-page order-analysis-page">
      <section className="library-hero movement-hero">
        <div>
          <p className="eyebrow">Order Analysis</p>
          <h2>订单分析中心</h2>
          <p>优先聚焦俄罗斯 YunWMS 两个仓库，按出库时间查看每日订单量、SKU 件数、店铺和平台表现。</p>
          <div className="source-row">
            <span className={`status-pill ${payload?.syncedAt ? "good" : "warning"}`}>{payload?.syncedAt ? "订单缓存已同步" : "等待订单同步"}</span>
            <span>{payload?.syncedAt ? new Date(payload.syncedAt).toLocaleString("zh-CN") : "先同步订单后可查看分析"}</span>
          </div>
        </div>
        <button className="sync-button" type="button" onClick={onSyncOrders} disabled={syncing}>
          <RefreshCw size={16} className={syncing ? "spinning" : ""} />
          {syncing ? "同步中" : "重同步近90天订单"}
        </button>
      </section>

      <section className="metric-strip movement-metrics">
        <Metric title="订单数" value={formatNumber(counts?.orderCount || 0)} note="按订单号去重" icon={FileText} tone="blue" />
        <Metric title="出库件数" value={formatNumber(counts?.quantity || 0)} note={`${formatNumber(counts?.orderLines || 0)} 条 SKU 行`} icon={PackageCheck} tone="green" />
        <Metric title="项目组" value={formatNumber(counts?.projectGroupCount || 0)} note={`${formatNumber(counts?.shopCount || 0)} 个店铺`} icon={ShoppingBag} tone="orange" />
        <Metric title="SKU 数" value={formatNumber(counts?.skuCount || 0)} note={`${formatNumber(counts?.platformCount || 0)} 个平台`} icon={Boxes} tone="red" />
      </section>

      {(counts?.unrecognizedShopRows || 0) > 0 ? (
        <div className="notice warning">
          当前仍有 {formatNumber(counts?.unrecognizedShopRows || 0)} 条俄罗斯订单未识别店铺。新版本已接入 YunWMS 的 platform_shop 字段，重同步俄罗斯订单后会补齐。
        </div>
      ) : null}

      <form className="order-analysis-filter panel" onSubmit={submitFilters}>
        <label>
          <span>开始日期</span>
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label>
          <span>结束日期</span>
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
        <label>
          <span>国家</span>
          <select value={country} onChange={(event) => setCountry(event.target.value)}>
            <option value="">全部国家</option>
            {payload?.options.countries.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>
          <span>仓库</span>
          <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
            <option value="">全部仓库</option>
            {payload?.options.warehouses.map((item) => <option key={item.warehouseId} value={item.warehouseId}>{item.warehouseName}</option>)}
          </select>
        </label>
        <label>
          <span>平台</span>
          <select value={platform} onChange={(event) => setPlatform(event.target.value)}>
            <option value="">全部平台</option>
            {payload?.options.platforms.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>
          <span>项目组</span>
          <select value={projectGroup} onChange={(event) => setProjectGroup(event.target.value)}>
            <option value="">全部项目组</option>
            {payload?.options.projectGroups.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>
          <span>店铺</span>
          <select value={shopName} onChange={(event) => setShopName(event.target.value)}>
            <option value="">全部店铺</option>
            {payload?.options.shops.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="order-analysis-keyword">
          <span>搜索</span>
          <input value={keywordDraft} onChange={(event) => setKeywordDraft(event.target.value)} placeholder="订单号、SKU、商品名" />
        </label>
        <div className="order-analysis-actions">
          <button className="ghost-button" type="button" onClick={resetFilters} disabled={loading}>清空</button>
          <button className="sync-button" type="submit" disabled={loading}>{loading ? "查询中" : "查询"}</button>
        </div>
      </form>

      <section className="order-analysis-grid">
        <article className="panel order-analysis-panel order-trend-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Daily Trend</p>
              <h2>每日订单量</h2>
            </div>
          </div>
          <div className="order-line-chart">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="每日订单量趋势折线图">
              {dailyAreaPath ? <path className="order-line-area" d={dailyAreaPath} /> : null}
              {dailyLinePath ? <path className="order-line-path" d={dailyLinePath} /> : null}
              {dailyPoints.map((item) => (
                <circle key={item.key} className="order-line-point" cx={item.x} cy={item.y} r="1.8">
                  <title>{`${item.key}：${formatNumber(item.orderCount)} 单 / ${formatNumber(item.quantity)} 件`}</title>
                </circle>
              ))}
            </svg>
            <div className="order-line-axis">
              {dailyPoints.map((item) => (
                <span key={item.key}>{item.key.slice(5)}</span>
              ))}
            </div>
          </div>
        </article>
        <article className="panel order-analysis-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Project Ranking</p>
              <h2>项目组排行</h2>
            </div>
          </div>
          <div className="order-rank-list">
            {(payload?.byProjectGroup || []).slice(0, 12).map((item) => (
              <div key={item.key}>
                <strong>{item.key}</strong>
                <span>{formatNumber(item.orderCount)} 单 · {formatNumber(item.quantity)} 件 · {formatNumber(item.skuCount)} SKU</span>
              </div>
            ))}
          </div>
        </article>
        <article className="panel order-analysis-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Shop Ranking</p>
              <h2>店铺排行</h2>
            </div>
          </div>
          <div className="order-rank-list shop-rank-list">
            {(payload?.byShop || []).slice(0, 12).map((item) => {
              const shop = payload?.options.shops.find((row) => row.label === item.key || row.value === item.key);
              return (
              <div key={item.key}>
                <button className="shop-alias-button" type="button" onClick={() => editShopAlias(shop?.rawName || shop?.value || item.key, item.key)} title="设置店铺别称">
                  <strong>{item.key}</strong>
                  {shop?.alias ? <small>{shop.rawName}</small> : null}
                </button>
                <span>{formatNumber(item.orderCount)} 单 · {formatNumber(item.quantity)} 件 · {formatNumber(item.skuCount)} SKU</span>
              </div>
              );
            })}
          </div>
        </article>
      </section>

      <section className="panel order-analysis-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Product Ranking</p>
            <h2>产品排行</h2>
          </div>
          <span className="status-pill muted">{formatNumber(payload?.byProduct.length || 0)} 个产品</span>
        </div>
        <div className="order-analysis-table">
          <div className="order-analysis-row order-analysis-head">
            <span>产品</span>
            <span>SKU</span>
            <span>订单数</span>
            <span>出库件数</span>
            <span>SKU 行</span>
            <span>店铺数</span>
            <span>平台数</span>
          </div>
          {(payload?.byProduct || []).map((item, index) => (
            <article className="order-analysis-row" key={item.key}>
              <span className="order-product-cell">
                <button
                  className="order-product-thumb"
                  type="button"
                  onClick={() => item.imageUrl && setPreviewImage({ url: item.imageUrl, title: item.productName })}
                  disabled={!item.imageUrl}
                  title={item.imageUrl ? "点击查看大图" : "暂无图片"}
                >
                  {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <PackageCheck size={18} />}
                </button>
                <span><strong>{index + 1}. {item.productName}</strong><small>{item.sku}</small></span>
              </span>
              <span>{item.sku}</span>
              <strong>{formatNumber(item.orderCount)}</strong>
              <strong>{formatNumber(item.quantity)}</strong>
              <span>{formatNumber(item.orderLines)}</span>
              <span>{formatNumber(item.shopCount)}</span>
              <span>{formatNumber(item.platformCount)}</span>
            </article>
          ))}
        </div>
      </section>
      {previewImage ? (
        <div className="order-image-lightbox" role="dialog" aria-modal="true" aria-label="产品图片预览">
          <button className="modal-backdrop" type="button" onClick={() => setPreviewImage(null)} aria-label="关闭图片预览" />
          <figure>
            <button className="icon-button" type="button" onClick={() => setPreviewImage(null)} aria-label="关闭图片预览"><X size={18} /></button>
            <img src={previewImage.url} alt={previewImage.title} />
            <figcaption>{previewImage.title}</figcaption>
          </figure>
        </div>
      ) : null}
    </main>
  );
}

function movementComparisonStatusTone(status: string) {
  if (status === "健康" || status === "正常") return "good";
  if (status === "缺货" || status === "滞销") return "danger";
  if (status === "无记录" || status === "无动销数据") return "muted";
  return "warning";
}

function movementComparisonChangeTone(changeType: string) {
  if (changeType === "improved") return "good";
  if (changeType === "worsened") return "danger";
  if (changeType === "unchanged") return "muted";
  return "warning";
}

function formatComparisonQty(value: number | null) {
  return value === null ? "—" : formatNumber(value);
}

function formatSignedComparisonQty(value: number | null) {
  if (value === null) return "—";
  if (value > 0) return `+${formatNumber(value)}`;
  return formatNumber(value);
}

function MovementAnalysisPage({
  movementHistoryPayload,
  onLoadMovementHistory,
  onCaptureMovementHistory,
}: {
  movementHistoryPayload: MovementHistoryPayload | null;
  onLoadMovementHistory: (input?: { date?: string; from?: string; to?: string; warehouseId?: string; sku?: string; timezone?: string }) => Promise<void>;
  onCaptureMovementHistory: (input?: { date?: string; timezone?: string }) => Promise<MovementHistoryPayload>;
}) {
  const [busy, setBusy] = React.useState(false);
  const [date, setDate] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [warehouseId, setWarehouseId] = React.useState("");
  const [sku, setSku] = React.useState("");
  const [timezone, setTimezone] = React.useState("Asia/Shanghai");
  const [pageSize, setPageSize] = React.useState(50);
  const [page, setPage] = React.useState(1);
  const [comparisonBusy, setComparisonBusy] = React.useState(false);
  const [comparisonPeriod, setComparisonPeriod] = React.useState<MovementComparisonPeriod>("month");
  const [comparisonAnchorDate, setComparisonAnchorDate] = React.useState("");
  const [comparisonFrom, setComparisonFrom] = React.useState("");
  const [comparisonTo, setComparisonTo] = React.useState("");
  const [comparisonWarehouseId, setComparisonWarehouseId] = React.useState("");
  const [comparisonSku, setComparisonSku] = React.useState("");
  const [comparisonView, setComparisonView] = React.useState("all");
  const [comparisonPayload, setComparisonPayload] = React.useState<MovementComparisonPayload | null>(null);
  const [comparisonMessage, setComparisonMessage] = React.useState("");
  const [comparisonPage, setComparisonPage] = React.useState(1);
  const comparisonAutoLoaded = React.useRef(false);
  const snapshot = movementHistoryPayload?.snapshot || null;
  const rows = snapshot?.rows || [];
  const totals = snapshot?.totals;
  const dates = movementHistoryPayload?.dates || [];
  const timezones = movementHistoryPayload?.timezones?.length ? movementHistoryPayload.timezones : ["Asia/Shanghai"];
  const warehouses = movementHistoryPayload?.warehouseOptions || [];
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const trend = movementHistoryPayload?.trend || [];
  const maxTrendValue = Math.max(1, ...trend.map((item) => Math.max(item.sales30, item.sales90, item.availableQty)));
  const comparisonRows = React.useMemo(() => {
    const source = comparisonPayload?.rows || [];
    if (comparisonView === "changed") return source.filter((item) => item.changeType !== "unchanged");
    if (comparisonView === "worsened") return source.filter((item) => item.changeType === "worsened");
    if (comparisonView === "inventory_anomaly") return source.filter((item) => item.inventoryAnomaly);
    if (comparisonView === "slow") return source.filter((item) => item.currentMovementClass === "慢销");
    if (comparisonView === "stagnant") return source.filter((item) => item.currentMovementClass === "滞销");
    if (comparisonView === "normal") return source.filter((item) => item.currentMovementClass === "正常");
    return source;
  }, [comparisonPayload, comparisonView]);
  const comparisonPageSize = 50;
  const comparisonTotalPages = Math.max(1, Math.ceil(comparisonRows.length / comparisonPageSize));
  const safeComparisonPage = Math.min(comparisonPage, comparisonTotalPages);
  const visibleComparisonRows = comparisonRows.slice((safeComparisonPage - 1) * comparisonPageSize, safeComparisonPage * comparisonPageSize);

  React.useEffect(() => {
    if (!movementHistoryPayload) return;
    setTimezone((current) => current || movementHistoryPayload.timezone || "Asia/Shanghai");
    setDate((current) => current || movementHistoryPayload.selectedDate || "");
  }, [movementHistoryPayload?.selectedDate, movementHistoryPayload?.timezone]);

  React.useEffect(() => {
    setPage(1);
  }, [date, from, to, warehouseId, sku, timezone, pageSize]);

  React.useEffect(() => {
    setComparisonPage(1);
  }, [comparisonView, comparisonPayload]);

  const currentFilters = React.useMemo(() => ({
    date,
    from,
    to,
    warehouseId,
    sku,
    timezone,
  }), [date, from, to, warehouseId, sku, timezone]);

  async function loadComparison(overrides: Partial<{
    period: MovementComparisonPeriod;
    anchorDate: string;
    from: string;
    to: string;
    warehouseId: string;
    sku: string;
    timezone: string;
  }> = {}) {
    const selectedPeriod = overrides.period || comparisonPeriod;
    const selectedAnchorDate = overrides.anchorDate || comparisonAnchorDate || movementHistoryPayload?.selectedDate || new Date().toISOString().slice(0, 10);
    const selectedFrom = overrides.from ?? comparisonFrom;
    const selectedTo = overrides.to ?? comparisonTo;
    if (selectedPeriod === "custom" && (!selectedFrom || !selectedTo)) {
      setComparisonMessage("自定义周期需要选择开始日期和结束日期。");
      return;
    }
    setComparisonBusy(true);
    setComparisonMessage("");
    try {
      const result = await fetchMovementComparison({
        period: selectedPeriod,
        anchorDate: selectedPeriod === "custom" ? undefined : selectedAnchorDate,
        from: selectedPeriod === "custom" ? selectedFrom : undefined,
        to: selectedPeriod === "custom" ? selectedTo : undefined,
        warehouseId: overrides.warehouseId ?? comparisonWarehouseId,
        sku: overrides.sku ?? comparisonSku,
        timezone: overrides.timezone || timezone,
      });
      setComparisonPayload(result);
      setComparisonPage(1);
      setComparisonMessage(result.baselineAvailable
        ? `已对比 ${result.ranges.current.label} 与 ${result.ranges.previous.label}`
        : "当前区间有快照，但没有找到上期基准快照。");
    } catch (error) {
      setComparisonMessage(error instanceof Error ? error.message : "动销与库存对比加载失败");
    } finally {
      setComparisonBusy(false);
    }
  }

  React.useEffect(() => {
    const anchorDate = movementHistoryPayload?.selectedDate || "";
    if (!anchorDate || comparisonAutoLoaded.current) return;
    comparisonAutoLoaded.current = true;
    setComparisonAnchorDate(anchorDate);
    void loadComparison({ anchorDate, period: "month", timezone: movementHistoryPayload?.timezone || timezone });
  }, [movementHistoryPayload?.selectedDate]);

  async function applyFilters(next = currentFilters) {
    setBusy(true);
    try {
      await onLoadMovementHistory(next);
    } finally {
      setBusy(false);
    }
  }

  async function captureSnapshot() {
    setBusy(true);
    try {
      const result = await onCaptureMovementHistory({ date: date || undefined, timezone });
      setDate(result.selectedDate || result.snapshot?.date || date);
      await onLoadMovementHistory({ ...currentFilters, date: result.selectedDate || result.snapshot?.date || date });
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv() {
    setBusy(true);
    try {
      const blob = await downloadMovementHistoryCsv(currentFilters);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const range = date || [from, to].filter(Boolean).join("_") || "all";
      link.href = url;
      link.download = `movement-history-${range}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "动销历史导出失败");
    } finally {
      setBusy(false);
    }
  }

  function exportComparisonCsv() {
    if (!comparisonPayload || !comparisonRows.length) return;
    const header = ["本期", "基期", "仓库", "SKU", "产品", "基期状态", "本期状态", "状态变化", "期初在库", "期间出库", "理论期末", "实际期末", "库存差异", "差异率", "订单覆盖完整", "排查提示"];
    const data = comparisonRows.map((item) => [
      comparisonPayload.currentSnapshot?.date || comparisonPayload.ranges.current.label,
      comparisonPayload.previousSnapshot?.date || comparisonPayload.ranges.previous.label,
      item.warehouseName,
      item.sku,
      item.productName,
      item.previousStatus,
      item.currentStatus,
      item.changeLabel,
      item.openingOnHandQty,
      item.outboundQty,
      item.expectedClosingQty,
      item.closingOnHandQty,
      item.inventoryVarianceQty,
      item.inventoryVarianceRate === null ? "" : `${(item.inventoryVarianceRate * 100).toFixed(1)}%`,
      item.orderCoverage.complete ? "是" : "否",
      item.inventoryExplanation,
    ]);
    downloadTextFile(
      `tongzhou-movement-inventory-comparison-${comparisonPayload.ranges.current.from}-${comparisonPayload.ranges.current.to}.csv`,
      [header, ...data].map((row) => row.map(csvCell).join(",")).join("\n"),
      "text/csv;charset=utf-8",
    );
    setComparisonMessage(`已导出 ${formatNumber(comparisonRows.length)} 条动销与库存对比记录。`);
  }

  return (
    <main className="movement-page movement-analysis-page">
      <section className="library-hero movement-hero">
        <div>
          <p className="eyebrow">Movement Analytics</p>
          <h2>动销分析</h2>
          <p>按日保存 SKU 与仓库维度的动销快照，支持历史查看、趋势对比、时区口径筛选和 CSV 导出。</p>
          <div className="source-row">
            <span className={`status-pill ${snapshot ? "good" : "warning"}`}>{snapshot ? "历史快照已生成" : "暂无动销快照"}</span>
            <span>{snapshot?.capturedAt ? new Date(snapshot.capturedAt).toLocaleString("zh-CN") : "可先生成今日动销快照"}</span>
          </div>
        </div>
        <button className="sync-button" type="button" onClick={captureSnapshot} disabled={busy}>
          <DatabaseZap size={16} />
          {busy ? "处理中" : "生成今日快照"}
        </button>
      </section>

      <section className="panel movement-history-toolbar">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">History Query</p>
            <h2>历史筛选</h2>
            <span>日期筛选按所选时区生成日界线；导出会沿用当前筛选条件。</span>
          </div>
          <div className="movement-history-actions">
            <button className="ghost-button" type="button" onClick={() => applyFilters()} disabled={busy}>
              <Search size={16} />
              查询
            </button>
            <button className="ghost-button" type="button" onClick={exportCsv} disabled={!snapshot || busy}>
              <Download size={16} />
              导出 CSV
            </button>
          </div>
        </div>
        <div className="movement-history-filters">
          <label>
            <span>快照日期</span>
            <select value={date} onChange={(event) => setDate(event.target.value)} disabled={busy || !dates.length}>
              {dates.length ? dates.map((item) => (
                <option key={`${item.timezone}-${item.date}`} value={item.date}>{item.date} · {formatNumber(item.rowCount)} 行</option>
              )) : <option value="">暂无快照</option>}
            </select>
          </label>
          <label>
            <span>开始日期</span>
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label>
            <span>结束日期</span>
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
          <label>
            <span>时区</span>
            <select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
              {timezones.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span>仓库</span>
            <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} disabled={!warehouses.length}>
              <option value="">全部仓库</option>
              {warehouses.map((item) => <option key={item.warehouseId} value={item.warehouseId}>{item.warehouseName}</option>)}
            </select>
          </label>
          <label>
            <span>SKU / 产品</span>
            <input value={sku} onChange={(event) => setSku(event.target.value)} placeholder="搜索 SKU、产品名、品牌" />
          </label>
          <label>
            <span>分页</span>
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
              {[50, 200, 500].map((size) => <option key={size} value={size}>每页 {size} 条</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="panel movement-comparison-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Period Comparison</p>
            <h2>动销与库存对比</h2>
            <span>按期末快照比较 SKU 状态，并用“期初在库－期间出库”推算理论期末库存，定位仓库库存差异。</span>
          </div>
          <div className="movement-history-actions">
            <button className="ghost-button" type="button" onClick={() => loadComparison()} disabled={comparisonBusy}>
              <RefreshCw size={16} />
              {comparisonBusy ? "计算中" : "生成对比"}
            </button>
            <button className="ghost-button" type="button" onClick={exportComparisonCsv} disabled={!comparisonRows.length || comparisonBusy}>
              <Download size={16} />
              导出对账 CSV
            </button>
          </div>
        </div>

        <div className="movement-comparison-filters">
          <label>
            <span>对比周期</span>
            <select value={comparisonPeriod} onChange={(event) => setComparisonPeriod(event.target.value as MovementComparisonPeriod)}>
              <option value="week">按周</option>
              <option value="month">按月</option>
              <option value="quarter">按季度</option>
              <option value="year">按年</option>
              <option value="custom">指定时间段</option>
            </select>
          </label>
          {comparisonPeriod === "custom" ? (
            <>
              <label>
                <span>本期开始</span>
                <input type="date" value={comparisonFrom} onChange={(event) => setComparisonFrom(event.target.value)} />
              </label>
              <label>
                <span>本期结束</span>
                <input type="date" value={comparisonTo} onChange={(event) => setComparisonTo(event.target.value)} />
              </label>
            </>
          ) : (
            <label>
              <span>所属日期</span>
              <input type="date" value={comparisonAnchorDate} onChange={(event) => setComparisonAnchorDate(event.target.value)} />
            </label>
          )}
          <label>
            <span>仓库</span>
            <select value={comparisonWarehouseId} onChange={(event) => setComparisonWarehouseId(event.target.value)} disabled={!warehouses.length}>
              <option value="">全部仓库</option>
              {warehouses.map((item) => <option key={item.warehouseId} value={item.warehouseId}>{item.warehouseName}</option>)}
            </select>
          </label>
          <label className="comparison-keyword-field">
            <span>SKU / 产品</span>
            <input value={comparisonSku} onChange={(event) => setComparisonSku(event.target.value)} placeholder="按 SKU、产品名或品牌筛选" />
          </label>
          <label>
            <span>结果筛选</span>
            <select value={comparisonView} onChange={(event) => setComparisonView(event.target.value)}>
              <option value="all">全部 SKU</option>
              <option value="changed">状态有变化</option>
              <option value="worsened">动销恶化</option>
              <option value="inventory_anomaly">库存有差异</option>
              <option value="slow">本期慢销</option>
              <option value="stagnant">本期滞销</option>
              <option value="normal">本期正常</option>
            </select>
          </label>
        </div>

        {comparisonMessage ? <div className={`comparison-message ${comparisonPayload?.baselineAvailable ? "good" : "warning"}`}>{comparisonMessage}</div> : null}

        {comparisonPayload ? (
          <>
            <div className="comparison-range-strip">
              <span><small>基期</small><strong>{comparisonPayload.ranges.previous.label}</strong><em>{comparisonPayload.previousSnapshot?.date || "无快照"}</em></span>
              <ArrowUpRight size={18} />
              <span><small>本期</small><strong>{comparisonPayload.ranges.current.label}</strong><em>{comparisonPayload.currentSnapshot?.date || "无快照"}</em></span>
              <span className={`status-pill ${comparisonPayload.inventorySummary.orderCoverageComplete ? "good" : "warning"}`}>
                {comparisonPayload.inventorySummary.orderCoverageComplete ? "订单覆盖完整" : "订单覆盖不足"}
              </span>
            </div>

            <div className="comparison-kpi-grid">
              <article><span>正常 SKU</span><strong>{formatNumber(comparisonPayload.summary.normal)}</strong><small>本期期末状态正常</small></article>
              <article><span>慢销 / 滞销</span><strong>{formatNumber(comparisonPayload.summary.slow + comparisonPayload.summary.stagnant)}</strong><small>慢销 {formatNumber(comparisonPayload.summary.slow)} / 滞销 {formatNumber(comparisonPayload.summary.stagnant)}</small></article>
              <article><span>状态变化</span><strong>{formatNumber(comparisonPayload.summary.changed)}</strong><small>改善 {formatNumber(comparisonPayload.summary.improved)} / 恶化 {formatNumber(comparisonPayload.summary.worsened)}</small></article>
              <article><span>库存异常 SKU</span><strong>{formatNumber(comparisonPayload.summary.inventoryAnomaly)}</strong><small>阈值：差异至少 {formatNumber(comparisonPayload.thresholds.quantity)} 件且达到 {(comparisonPayload.thresholds.rate * 100).toFixed(0)}%</small></article>
            </div>

            <div className={`inventory-reconciliation-card ${comparisonPayload.inventorySummary.orderCoverageComplete ? "" : "uncertain"}`}>
              <div>
                <p className="eyebrow">Inventory Reconciliation</p>
                <h3>库存消耗对账</h3>
                <small>在库口径为“可售 + 锁定”，不包含在途；差异中可能包含入库、退货、盘点和库存调整。</small>
              </div>
              <div className="inventory-equation">
                <span><small>期初在库</small><strong>{formatNumber(comparisonPayload.inventorySummary.openingOnHandQty)}</strong></span>
                <b>－</b>
                <span><small>期间出库</small><strong>{formatNumber(comparisonPayload.inventorySummary.outboundQty)}</strong></span>
                <b>＝</b>
                <span><small>理论期末</small><strong>{formatNumber(comparisonPayload.inventorySummary.expectedClosingQty)}</strong></span>
                <b>对比</b>
                <span><small>实际期末</small><strong>{formatNumber(comparisonPayload.inventorySummary.closingOnHandQty)}</strong></span>
                <span className={`inventory-variance-total ${comparisonPayload.inventorySummary.varianceQty === 0 ? "balanced" : "warning"}`}>
                  <small>总差异</small><strong>{formatSignedComparisonQty(comparisonPayload.inventorySummary.varianceQty)}</strong>
                </span>
              </div>
              <div className="comparison-data-quality">
                <span>匹配订单行 {formatNumber(comparisonPayload.inventorySummary.matchedOrderRows)}</span>
                <span>未匹配订单行 {formatNumber(comparisonPayload.inventorySummary.unmatchedOrderRows)}</span>
                <span>未匹配出库 {formatNumber(comparisonPayload.inventorySummary.unmatchedOutboundQty)}</span>
                <span>订单同步 {comparisonPayload.inventorySummary.ordersSyncedAt ? new Date(comparisonPayload.inventorySummary.ordersSyncedAt).toLocaleString("zh-CN") : "暂无"}</span>
              </div>
            </div>

            <div className="movement-comparison-table">
              <div className="movement-comparison-row movement-comparison-head">
                <span>SKU / 产品</span><span>仓库</span><span>上期 → 本期</span><span>是否有变</span><span>库存对账</span><span>库存差异</span><span>排查提示</span>
              </div>
              {visibleComparisonRows.length ? visibleComparisonRows.map((item) => (
                <article className={`movement-comparison-row ${item.inventoryAnomaly ? "has-anomaly" : ""}`} key={item.id}>
                  <span><strong>{item.sku}</strong><small>{item.productName || item.countrySku}</small></span>
                  <span><strong>{item.warehouseName}</strong><small>{item.country}</small></span>
                  <span className="comparison-status-pair">
                    <i className={`status-pill ${movementComparisonStatusTone(item.previousStatus)}`}>{item.previousStatus}</i>
                    <ArrowUpRight size={14} />
                    <i className={`status-pill ${movementComparisonStatusTone(item.currentStatus)}`}>{item.currentStatus}</i>
                  </span>
                  <span className={`status-pill ${movementComparisonChangeTone(item.changeType)}`}>{item.changeLabel}</span>
                  <span className="comparison-inventory-flow">
                    <small>期初 {formatComparisonQty(item.openingOnHandQty)} － 出库 {formatNumber(item.outboundQty)} ＝ 理论 {formatComparisonQty(item.expectedClosingQty)}</small>
                    <strong>实际期末 {formatComparisonQty(item.closingOnHandQty)}</strong>
                  </span>
                  <span className={`inventory-variance ${item.inventorySeverity}`}>
                    <strong>{formatSignedComparisonQty(item.inventoryVarianceQty)}</strong>
                    <small>{item.inventoryVarianceRate === null ? "—" : `${(item.inventoryVarianceRate * 100).toFixed(1)}%`}</small>
                  </span>
                  <small>{item.inventoryExplanation}</small>
                </article>
              )) : <div className="stockup-empty">当前筛选下没有动销或库存对比记录。</div>}
            </div>

            <div className="snapshot-pagination">
              <span>当前显示 {formatNumber(visibleComparisonRows.length)} / {formatNumber(comparisonRows.length)} 条，第 {formatNumber(safeComparisonPage)} / {formatNumber(comparisonTotalPages)} 页</span>
              <div>
                <button className="ghost-button compact-button" type="button" onClick={() => setComparisonPage((current) => Math.max(1, current - 1))} disabled={safeComparisonPage <= 1}>上一页</button>
                <button className="ghost-button compact-button" type="button" onClick={() => setComparisonPage((current) => Math.min(comparisonTotalPages, current + 1))} disabled={safeComparisonPage >= comparisonTotalPages}>下一页</button>
              </div>
            </div>
          </>
        ) : <div className="stockup-empty">选择周期和仓库后生成对比；系统会默认尝试加载最近月份。</div>}
      </section>

      <section className="metric-strip movement-metrics">
        <Metric title="快照行" value={formatNumber(totals?.rowCount || 0)} note={`SKU ${formatNumber(totals?.skuCount || 0)} / 仓库 ${formatNumber(totals?.warehouseCount || 0)}`} icon={List} tone="blue" />
        <Metric title="30天销量" value={formatNumber(totals?.sales30 || 0)} note={`7天 ${formatNumber(totals?.sales7 || 0)} / 90天 ${formatNumber(totals?.sales90 || 0)}`} icon={BarChart3} tone="orange" />
        <Metric title="库存" value={formatNumber(totals?.availableQty || 0)} note={`总库存 ${formatNumber(totals?.totalQty || 0)}`} icon={Boxes} tone="green" />
        <Metric title="风险SKU" value={formatNumber((totals?.stockout || 0) + (totals?.replenish || 0) + (totals?.slow || 0) + (totals?.stagnant || 0))} note={`缺货 ${formatNumber(totals?.stockout || 0)} / 滞销 ${formatNumber(totals?.stagnant || 0)}`} icon={AlertTriangle} tone="red" />
      </section>

      <section className="panel movement-trend-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Trend</p>
            <h2>趋势图</h2>
            <span>{trend.length ? `当前区间 ${formatNumber(trend.length)} 个快照点` : "暂无趋势数据"}</span>
          </div>
        </div>
        <div className="movement-trend-chart">
          {trend.length ? trend.map((item) => (
            <div className="movement-trend-day" key={item.date}>
              <div className="movement-trend-bars" title={`${item.date}：30天销量 ${item.sales30}，90天销量 ${item.sales90}，可售 ${item.availableQty}`}>
                <span className="bar sales30" style={{ height: `${Math.max(4, (item.sales30 / maxTrendValue) * 100)}%` }} />
                <span className="bar sales90" style={{ height: `${Math.max(4, (item.sales90 / maxTrendValue) * 100)}%` }} />
                <span className="bar stock" style={{ height: `${Math.max(4, (item.availableQty / maxTrendValue) * 100)}%` }} />
              </div>
              <small>{item.date.slice(5)}</small>
            </div>
          )) : <div className="stockup-empty">生成至少一个动销快照后，这里会显示趋势。</div>}
        </div>
        <div className="movement-trend-legend">
          <span><i className="sales30" />30天销量</span>
          <span><i className="sales90" />90天销量</span>
          <span><i className="stock" />可售库存</span>
        </div>
      </section>

      <section className="panel movement-table-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Daily Snapshot Rows</p>
            <h2>历史动销明细</h2>
            <span>当前显示 {formatNumber(visibleRows.length)} / {formatNumber(rows.length)} 条。</span>
          </div>
        </div>
        <div className="movement-history-table">
          <div className="movement-history-row movement-history-head">
            <span>SKU / 产品</span>
            <span>仓库</span>
            <span>库存</span>
            <span>7天</span>
            <span>30天</span>
            <span>90天</span>
            <span>日均</span>
            <span>可售天数</span>
            <span>状态</span>
            <span>建议</span>
          </div>
          {visibleRows.length ? visibleRows.map((item) => (
            <article className="movement-history-row" key={`${snapshot?.date}-${item.warehouseId}-${item.countrySku}-${item.sku}`}>
              <span><strong>{item.sku}</strong><small>{item.productName || item.countrySku}</small></span>
              <span>{item.warehouseName}<small>{item.country}</small></span>
              <strong>{formatNumber(item.availableQty)}</strong>
              <span>{formatNumber(item.sales7)}</span>
              <span>{formatNumber(item.sales30)}</span>
              <span>{formatNumber(item.sales90)}</span>
              <span>{formatDecimal(item.avgDaily30)}</span>
              <span>{item.daysCover === null ? "999+ 天" : `${formatDecimal(item.daysCover)} 天`}</span>
              <span className={`status-pill ${item.status === "健康" ? "good" : item.status === "缺货" ? "danger" : "warning"}`}>{item.status}</span>
              <small>{item.suggestion}</small>
            </article>
          )) : (
            <div className="stockup-empty">暂无历史动销。请先生成今日动销快照，或调整筛选条件。</div>
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

function miaoshouTaskLabel(status: string, attempts = 0) {
  if (status === "pending") return "待申请";
  if (status === "running") return "申请中";
  if (status === "succeeded") return attempts === 0 ? "已有运单" : "申请成功";
  if (status === "retry_wait") return "等待重试";
  if (status === "manual_check") return "需要核实";
  return status || "未知";
}

function miaoshouTaskTone(status: string) {
  if (status === "succeeded") return "good";
  if (status === "manual_check") return "danger";
  return "warning";
}

function MiaoshouPage() {
  const confirm = useConfirm();
  const [payload, setPayload] = React.useState<MiaoshouPayload | null>(null);
  const [busy, setBusy] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");
  const [shopKeyword, setShopKeyword] = React.useState("");
  const [form, setForm] = React.useState({
    appKey: "",
    appSecret: "",
    automationEnabled: false,
    autoFetchWaybillDefault: true,
    pollIntervalMinutes: 3,
    maxPackagesPerRun: 50,
    scopes: [{ platform: "shopee", site: "ID" }] as MiaoshouScope[],
  });

  React.useEffect(() => {
    void load();
  }, []);

  React.useEffect(() => {
    if (!payload) return;
    setForm((current) => ({
      ...current,
      automationEnabled: payload.config.automationEnabled,
      autoFetchWaybillDefault: payload.config.autoFetchWaybillDefault,
      pollIntervalMinutes: payload.config.pollIntervalMinutes,
      maxPackagesPerRun: payload.config.maxPackagesPerRun,
      scopes: payload.config.scopes.length ? payload.config.scopes : [{ platform: "shopee", site: "ID" }],
      appKey: "",
      appSecret: "",
    }));
  }, [payload?.config.updatedAt, payload?.config.lastConnectionTestAt]);

  async function load(silent = false) {
    if (!silent) setBusy("load");
    if (!silent) setError("");
    try {
      setPayload(await fetchMiaoshou());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "妙手配置读取失败");
    } finally {
      if (!silent) setBusy("");
    }
  }

  async function perform(key: string, action: () => Promise<MiaoshouPayload>, success: string) {
    setBusy(key);
    setError("");
    setMessage("");
    try {
      const next = await action();
      setPayload(next);
      setMessage(success);
      return next;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "操作失败");
      return null;
    } finally {
      setBusy("");
    }
  }

  function updateScope(index: number, field: keyof MiaoshouScope, value: string) {
    setForm((current) => ({
      ...current,
      scopes: current.scopes.map((scope, scopeIndex) => {
        if (scopeIndex !== index) return scope;
        if (field === "platform") {
          return {
            ...scope,
            platform: value,
            site: payload?.siteOptions?.[value]?.[0]?.value || "",
          };
        }
        return { ...scope, site: value.toUpperCase() };
      }),
    }));
  }

  async function saveConfig() {
    if (form.automationEnabled && !payload?.config.automationEnabled) {
      const accepted = await confirm({
        title: "开启自动申请运单号？",
        body: "开启后，中台将按所选店铺定时读取待打单包裹，并向妙手申请运单号。",
        confirmText: "确认开启",
        details: ["只处理已单独开启的店铺", "不会调用妙手“包裹发货”接口", "超时或结果不明确时会停止并要求人工核实"],
      });
      if (!accepted) return;
    }
    await perform("save", () => updateMiaoshouConfig(form), "配置已保存。新凭据只保存在服务端，不会回传到浏览器。");
  }

  async function toggleShop(shop: MiaoshouPayload["shops"][number]) {
    const nextEnabled = !shop.autoApplyTrackingNo;
    if (nextEnabled) {
      const accepted = await confirm({
        title: `为“${shop.shopNick || shop.platformShopName || shop.shopId}”开启自动申请？`,
        body: "该店铺的待打单包裹将进入中台自动申请队列。",
        confirmText: "开启该店铺",
        details: [`平台/站点：${shop.platform} / ${shop.site}`, "包裹需已在妙手配置线上物流", "本功能不会自动发货"],
      });
      if (!accepted) return;
    }
    await perform(`shop:${shop.shopId}`, () => updateMiaoshouShop(shop.shopId, { autoApplyTrackingNo: nextEnabled, autoFetchWaybill: shop.autoFetchWaybill }), nextEnabled ? "该店铺已加入自动申请队列。" : "该店铺已停止自动申请，不影响已经成功的运单。");
  }

  async function runNow() {
    const accepted = await confirm({
      title: "立即检查已启用店铺？",
      body: "系统会读取待打单包裹，并立即为符合条件且没有运单号的包裹申请运单号。",
      confirmText: "立即检查",
      details: ["不会重复处理已成功包裹", "不会自动发货", "失败结果会进入任务日志"],
    });
    if (!accepted) return;
    const next = await perform("run", () => runMiaoshouAutomation(), "检查完成。");
    if (next?.runSummary) {
      const summary = next.runSummary;
      setMessage(summary.skipped ? summary.message || "本次未执行。" : `检查完成：已有运单 ${summary.existingTracking || 0} 个，新申请 ${summary.attempted || 0} 个，成功 ${summary.succeeded || 0} 个，需处理 ${summary.failed || 0} 个。`);
    }
  }

  async function retryTask(task: MiaoshouPayload["tasks"][number]) {
    const accepted = await confirm({
      title: "确认重新申请运单号？",
      body: `包裹 ${task.appPackageNo || task.opOrderPackageId} 将再次调用妙手申请接口。`,
      confirmText: "确认重试",
      details: ["请先在妙手后台确认该包裹目前仍无运单号", task.errorMessage || "上次失败原因未返回"],
    });
    if (!accepted) return;
    await perform(`retry:${task.id}`, () => retryMiaoshouTask(task.id), "重试完成，请查看最新状态。");
  }

  async function getWaybill(task: MiaoshouPayload["tasks"][number]) {
    if (task.waybillUrl) {
      window.open(task.waybillUrl, "_blank", "noopener,noreferrer");
      return;
    }
    const next = await perform(`waybill:${task.id}`, () => fetchMiaoshouWaybill(task.id), "面单链接已获取。");
    const updatedTask = next?.tasks.find((item) => item.id === task.id);
    if (updatedTask?.waybillUrl) window.open(updatedTask.waybillUrl, "_blank", "noopener,noreferrer");
  }

  const config = payload?.config;
  const visibleShops = (payload?.shops || []).filter((shop) => {
    const keyword = shopKeyword.trim().toLowerCase();
    return !keyword || [shop.shopId, shop.platformShopName, shop.shopNick, shop.platform, shop.site].some((value) => value.toLowerCase().includes(keyword));
  });
  const platformOptions = payload?.platformOptions || [];
  const siteOptions = payload?.siteOptions || {};

  return (
    <main className="miaoshou-page">
      <section className="panel miaoshou-hero">
        <div>
          <p className="eyebrow">Miaoshou Fulfillment</p>
          <h2>店铺自动申请运单号</h2>
          <p>同步妙手店铺，逐店开启自动申请。系统只申请运单号并获取面单，不会自动提交平台发货。</p>
        </div>
        <div className="miaoshou-hero-actions">
          <span className={`status-pill ${config?.automationEnabled ? "good" : "warning"}`}>{config?.automationEnabled ? "自动任务已开启" : "自动任务未开启"}</span>
          <button className="ghost-button" type="button" onClick={() => void load()} disabled={Boolean(busy)}><RefreshCw size={15} className={busy === "load" ? "spinning" : ""} />刷新</button>
          <button className="sync-button" type="button" onClick={() => void runNow()} disabled={Boolean(busy) || !payload?.counts.enabledShops}><RefreshCw size={15} className={busy === "run" ? "spinning" : ""} />立即检查</button>
        </div>
      </section>

      {error ? <div className="notice danger">{error}</div> : null}
      {message ? <div className="notice success">{message}</div> : null}

      <section className="miaoshou-metrics">
        <article><small>授权状态</small><strong>{config?.hasCredentials ? "已配置" : "待配置"}</strong><span>{config?.appKeyMasked || "填写 AppKey / AppSecret"}</span></article>
        <article><small>已同步店铺</small><strong>{formatNumber(payload?.counts.shops || 0)}</strong><span>自动申请 {formatNumber(payload?.counts.enabledShops || 0)} 家</span></article>
        <article><small>已取得运单</small><strong>{formatNumber(payload?.counts.succeeded || 0)}</strong><span>待申请 {formatNumber((payload?.counts.pending || 0) + (payload?.counts.running || 0))}</span></article>
        <article><small>需要处理</small><strong>{formatNumber((payload?.counts.retryWait || 0) + (payload?.counts.manualCheck || 0))}</strong><span>人工核实 {formatNumber(payload?.counts.manualCheck || 0)}</span></article>
      </section>

      <section className="miaoshou-flow">
        <article className={config?.hasCredentials ? "done" : "active"}><b>01</b><div><strong>配置授权</strong><span>保存并检测 AppKey</span></div></article>
        <article className={payload?.counts.shops ? "done" : config?.hasCredentials ? "active" : ""}><b>02</b><div><strong>同步并选择店铺</strong><span>逐店开启自动申请</span></div></article>
        <article className={config?.automationEnabled ? "active" : ""}><b>03</b><div><strong>定时申请</strong><span>失败停留，绝不自动发货</span></div></article>
      </section>

      <section className="panel miaoshou-config-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">Connection & Scheduler</p><h2>授权与自动任务</h2><span>{config?.lastConnectionTestMessage || "先保存授权，再检测连接并同步店铺。"}</span></div>
          <span className={`status-pill ${config?.lastConnectionTestStatus === "success" ? "good" : "warning"}`}>{config?.lastConnectionTestStatus === "success" ? "连接正常" : "尚未验证"}</span>
        </div>
        <div className="miaoshou-config-grid">
          <label><span>AppKey</span><input value={form.appKey} onChange={(event) => setForm((current) => ({ ...current, appKey: event.target.value }))} placeholder={config?.appKeyMasked || "妙手开放平台 AppKey"} autoComplete="off" /></label>
          <label><span>AppSecret</span><input type="password" value={form.appSecret} onChange={(event) => setForm((current) => ({ ...current, appSecret: event.target.value }))} placeholder={config?.hasCredentials ? "已保存；留空表示不修改" : "妙手开放平台 AppSecret"} autoComplete="new-password" /></label>
          <label><span>轮询间隔（分钟）</span><input type="number" min="1" max="60" value={form.pollIntervalMinutes} onChange={(event) => setForm((current) => ({ ...current, pollIntervalMinutes: Number(event.target.value) }))} /></label>
          <label><span>单次最多处理</span><input type="number" min="1" max="200" value={form.maxPackagesPerRun} onChange={(event) => setForm((current) => ({ ...current, maxPackagesPerRun: Number(event.target.value) }))} /></label>
        </div>
        <div className="miaoshou-scope-head"><div><strong>店铺同步范围</strong><span>妙手店铺接口要求同时指定平台和站点，可添加多个范围。</span></div><button className="ghost-button compact-button" type="button" onClick={() => setForm((current) => ({ ...current, scopes: [...current.scopes, { platform: "shopee", site: "ID" }] }))}><Plus size={14} />添加范围</button></div>
        <div className="miaoshou-scopes">
          {form.scopes.map((scope, index) => {
            const scopeSiteOptions = siteOptions[scope.platform] || [];
            const hasCurrentSite = scopeSiteOptions.some((option) => option.value === scope.site);
            return (
              <div className="miaoshou-scope-row" key={`${index}-${scope.platform}-${scope.site}`}>
                <label><span>平台</span><select value={scope.platform} onChange={(event) => updateScope(index, "platform", event.target.value)}>{platformOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                <label><span>站点</span><select value={scope.site} onChange={(event) => updateScope(index, "site", event.target.value)}>{!hasCurrentSite && scope.site ? <option value={scope.site}>{scope.site}（旧配置，请重新选择）</option> : null}{scopeSiteOptions.map((option) => <option key={option.value} value={option.value}>{option.label}（{option.value}）</option>)}</select></label>
                <button className="icon-button" type="button" aria-label="删除同步范围" disabled={form.scopes.length <= 1} onClick={() => setForm((current) => ({ ...current, scopes: current.scopes.filter((_, scopeIndex) => scopeIndex !== index) }))}><Trash2 size={15} /></button>
              </div>
            );
          })}
        </div>
        <div className="miaoshou-settings-row">
          <label className="toggle-line"><input type="checkbox" checked={form.automationEnabled} onChange={(event) => setForm((current) => ({ ...current, automationEnabled: event.target.checked }))} /><span><strong>自动任务总开关</strong><small>仅处理下方已启用店铺</small></span></label>
          <label className="toggle-line"><input type="checkbox" checked={form.autoFetchWaybillDefault} onChange={(event) => setForm((current) => ({ ...current, autoFetchWaybillDefault: event.target.checked }))} /><span><strong>成功后获取面单</strong><small>作为新同步店铺的默认设置</small></span></label>
        </div>
        <div className="miaoshou-config-actions">
          <span>AppSecret 不回传浏览器；若服务器环境变量已配置，页面只显示掩码。</span>
          <button className="ghost-button" type="button" disabled={Boolean(busy) || !config?.hasCredentials} onClick={() => void perform("test", testMiaoshouConnection, "妙手授权检测通过。")}>{busy === "test" ? "检测中" : "检测连接"}</button>
          <button className="ghost-button" type="button" disabled={Boolean(busy) || !config?.hasCredentials} onClick={() => void perform("sync", syncMiaoshouShops, "店铺同步完成。")}>{busy === "sync" ? "同步中" : "同步店铺"}</button>
          <button className="sync-button" type="button" disabled={Boolean(busy)} onClick={() => void saveConfig()}>{busy === "save" ? "保存中" : "保存配置"}</button>
        </div>
      </section>

      <section className="panel miaoshou-shop-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">Shop Automation</p><h2>选择自动申请店铺</h2><span>包裹必须已在妙手配置线上物流；每家店可以单独控制是否自动获取面单。</span></div>
          <label className="compact-search"><Search size={15} /><input value={shopKeyword} onChange={(event) => setShopKeyword(event.target.value)} placeholder="搜索店铺、平台、站点" /></label>
        </div>
        {visibleShops.length ? <div className="miaoshou-shop-list">
          {visibleShops.map((shop) => (
            <article className={shop.autoApplyTrackingNo ? "enabled" : ""} key={shop.shopId}>
              <div className="miaoshou-shop-main"><span className="miaoshou-shop-icon"><Store size={18} /></span><div><strong>{shop.shopNick || shop.platformShopName || shop.shopId}</strong><span>{shop.shopNick && shop.platformShopName ? `${shop.platformShopName} · ` : ""}{shop.platform} · {shop.siteName || shop.site} · ID {shop.shopId}</span></div></div>
              <div className="miaoshou-shop-auth"><span>授权状态：{shop.status || "未返回"}</span><small>{shop.gmtExpire ? `到期 ${formatDateTime(shop.gmtExpire)}` : `最近同步 ${formatDateTime(shop.lastSeenAt)}`}</small></div>
              <label className="toggle-line compact"><input type="checkbox" checked={shop.autoFetchWaybill} disabled={Boolean(busy)} onChange={(event) => void perform(`label:${shop.shopId}`, () => updateMiaoshouShop(shop.shopId, { autoFetchWaybill: event.target.checked }), event.target.checked ? "该店铺会自动获取面单。" : "该店铺仅申请运单号。")}/><span><strong>获取面单</strong><small>成功后自动保存链接</small></span></label>
              <button className={shop.autoApplyTrackingNo ? "ghost-button" : "sync-button"} type="button" disabled={Boolean(busy)} onClick={() => void toggleShop(shop)}>{busy === `shop:${shop.shopId}` ? "处理中" : shop.autoApplyTrackingNo ? "停止自动申请" : "开启自动申请"}</button>
            </article>
          ))}
        </div> : <div className="stockup-empty">{payload?.counts.shops ? "当前搜索条件下没有店铺。" : "尚未同步店铺。先保存授权和平台站点范围，再点击“同步店铺”。"}</div>}
      </section>

      <section className="panel miaoshou-task-panel">
        <div className="panel-heading"><div><p className="eyebrow">Tracking Tasks</p><h2>运单申请记录</h2><span>{config?.lastRunMessage || "开启店铺后，待打单包裹会出现在这里。"}</span></div><span className="status-pill warning">{formatNumber(payload?.counts.total || 0)} 条</span></div>
        {payload?.tasks.length ? <div className="miaoshou-task-list">
          <div className="miaoshou-task-row head"><span>包裹 / 店铺</span><span>状态</span><span>运单号</span><span>最近处理</span><span>操作</span></div>
          {payload.tasks.map((task) => (
            <article className="miaoshou-task-row" key={task.id}>
              <span><strong>{task.appPackageNo || task.opOrderPackageId}</strong><small>{task.shopName || task.shopId} · {task.platform}/{task.site}</small></span>
              <span><i className={`status-pill ${miaoshouTaskTone(task.status)}`}>{miaoshouTaskLabel(task.status, task.attempts)}</i>{task.errorMessage ? <small className="miaoshou-task-error">{task.errorMessage}</small> : null}</span>
              <span><strong>{task.trackingNo || task.headTrackingNo || "—"}</strong><small>{task.logisticsType || `尝试 ${task.attempts} 次`}</small></span>
              <span>{formatDateTime(task.updatedAt)}<small>{task.errorCode || task.platformOrderSn || ""}</small></span>
              <span className="miaoshou-task-actions">{task.status === "succeeded" ? <button className="ghost-button compact-button" type="button" disabled={Boolean(busy)} onClick={() => void getWaybill(task)}>{busy === `waybill:${task.id}` ? "获取中" : task.waybillUrl ? "打开面单" : "获取面单"}</button> : null}{["manual_check", "retry_wait"].includes(task.status) ? <button className="ghost-button compact-button" type="button" disabled={Boolean(busy)} onClick={() => void retryTask(task)}>{busy === `retry:${task.id}` ? "重试中" : "核实后重试"}</button> : null}</span>
            </article>
          ))}
        </div> : <div className="stockup-empty">暂无运单任务。本页不会展示妙手历史包裹，只记录启用本功能后由中台发现的待处理包裹。</div>}
      </section>
    </main>
  );
}

function WarehouseAuthForm({
  providers,
  initialWarehouse,
  onCreate,
  onUpdate,
  onTest,
  onClose,
}: {
  providers: WarehousePayload["providers"];
  initialWarehouse?: WarehousePayload["warehouses"][number] | null;
  onCreate: (input: Parameters<typeof createWarehouseConnection>[0]) => Promise<void>;
  onUpdate: (id: string, input: Parameters<typeof updateWarehouseConnection>[1]) => Promise<void>;
  onTest: (input: Parameters<typeof testWarehouseConnection>[0]) => Promise<Awaited<ReturnType<typeof testWarehouseConnection>>>;
  onClose: () => void;
}) {
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<Awaited<ReturnType<typeof testWarehouseConnection>> | null>(null);
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
  const isSeaWms = form.providerId === "sea_wms";
  const guide = isSeaWms
    ? {
        title: "斗仓 / 神牛 SEA WMS 示例",
        lines: [
          "baseUrl: https://对应国家的 WMS 域名",
          "clientId/AppKey: 由 WMS 后台提供",
          "clientSecret/AppSecret: 由 WMS 后台提供",
          "warehouseCode + warehouseId: 不同国家可能不同，优先找仓库资料页确认",
        ],
        template: {
          providerId: "sea_wms",
          baseUrl: "https://sea-wms.example.com",
          clientId: "your-app-key",
          clientSecret: "your-app-secret",
          warehouseCode: "ID-JKT",
          warehouseId: "12345",
        },
      }
    : {
        title: "俄罗斯 YunWMS 示例",
        lines: [
          "baseUrl: https://fsdd.yunwms.com",
          "系统会自动补齐 /default/svc/web-service",
          "appKey + appToken: YunWMS 接口授权",
          "warehouseCode: 俄罗斯仓库代码，俄罗斯 2 仓订单量大时会按日期分片同步",
        ],
        template: {
          providerId: "yunwms_ru",
          baseUrl: "https://fsdd.yunwms.com",
          appKey: "your-app-key",
          appToken: "your-app-token",
          warehouseCode: "RU-02",
        },
      };

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

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await onTest(initialWarehouse ? { ...form, id: initialWarehouse.id } : form);
      setTestResult(result);
    } finally {
      setTesting(false);
    }
  }

  async function copyTemplate() {
    await navigator.clipboard?.writeText(JSON.stringify(guide.template, null, 2));
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
      <div className="warehouse-provider-guide">
        <div>
          <strong>{guide.title}</strong>
          {guide.lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
        <button className="ghost-button compact-button" type="button" onClick={copyTemplate}>
          <Copy size={14} />
          复制模板
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
          <span>{isSeaWms ? "AppKey / ClientId" : "AppKey"}</span>
          <input value={isSeaWms ? form.clientId || form.appKey : form.appKey} onChange={(event) => {
            updateField("appKey", event.target.value);
            updateField("clientId", event.target.value);
          }} placeholder="只保存在服务端" />
        </label>
        <label>
          <span>{isSeaWms ? "AppSecret / ClientSecret" : "AppToken"}</span>
          <input type="password" value={isSeaWms ? form.clientSecret || form.appSecret : form.token || form.appSecret} onChange={(event) => {
            if (isSeaWms) {
              updateField("appSecret", event.target.value);
              updateField("clientSecret", event.target.value);
            } else {
              updateField("token", event.target.value);
            }
          }} placeholder="只保存在服务端" />
        </label>
        {isSeaWms ? (
          <label>
            <span>Token（可选）</span>
            <input type="password" value={form.token} onChange={(event) => updateField("token", event.target.value)} placeholder="如接口需要 token" />
          </label>
        ) : null}
        <div className="warehouse-auth-note">
          <strong>{selectedProvider?.name || "WMS"}</strong>
          <span>{selectedProvider?.notes || "授权信息保存后可用于库存、出库日报和商品图片同步。"}</span>
        </div>
        {testResult ? (
          <div className={`warehouse-test-result ${testResult.ok ? "good" : "warning"}`}>
            <strong>{testResult.ok ? "检测通过" : `检测未通过：${testResult.stage}`}</strong>
            <span>{testResult.message}</span>
            <small>库存样本 {formatNumber(testResult.inventorySampleCount || 0)}，订单样本 {formatNumber(testResult.orderSampleCount || 0)}，解析仓库 {testResult.resolvedWarehouseId || "未解析"}</small>
            {testResult.suggestions?.map((suggestion) => (
              <small key={suggestion}>{suggestion}</small>
            ))}
          </div>
        ) : null}
        <div className="warehouse-auth-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            取消
          </button>
          <button type="button" className="ghost-button" onClick={runTest} disabled={testing || saving}>
            {testing ? "检测中" : "检测连接"}
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
  onAddToBundle,
  onClose,
}: {
  product: CatalogProduct;
  productBase: ProductBase[];
  qualifications: QualificationRecord[];
  assets: AssetRecord[];
  onAddToBundle: (product: CatalogProduct) => void;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = React.useState<"base" | "qualifications" | "assets">("base");
  const [copiedSku, setCopiedSku] = React.useState(false);
  const [copiedAttachments, setCopiedAttachments] = React.useState(false);
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
  const attachmentLinks = [
    ...qualifications.flatMap((qualification) => qualification.files.map((file) => ({
      type: "资质",
      group: qualification.qualificationName,
      name: file.name,
      href: file.url || (file.fileId ? qualificationFileDownloadUrl(file.fileId, file.name) : ""),
    }))),
    ...assets.flatMap((asset) => asset.files.map((file) => ({
      type: "素材",
      group: asset.assetName,
      name: file.name,
      href: file.url || (file.fileId ? qualificationFileDownloadUrl(file.fileId, file.name) : ""),
    }))),
  ].filter((item) => item.href);

  async function copySku() {
    await copyText(product.sku);
    setCopiedSku(true);
    window.setTimeout(() => setCopiedSku(false), 1200);
  }

  async function copyAttachmentLinks() {
    const text = attachmentLinks.map((item) => `${item.type}｜${item.group}｜${item.name}\n${item.href}`).join("\n\n");
    await copyText(text);
    setCopiedAttachments(true);
    window.setTimeout(() => setCopiedAttachments(false), 1400);
  }

  function downloadAttachmentList() {
    const rows = [
      ["SKU", "产品", "类型", "分组", "文件名", "链接"],
      ...attachmentLinks.map((item) => [product.sku, product.name, item.type, item.group, item.name, item.href]),
    ];
    downloadTextFile(`tongzhou-${product.sku}-attachments-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((row) => row.map(csvCell).join(",")).join("\n"), "text/csv;charset=utf-8");
  }

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
            <div className="product-detail-action-row">
              <button className="ghost-button compact-button" type="button" onClick={copySku}>
                {copiedSku ? <Check size={15} /> : <Copy size={15} />}
                {copiedSku ? "已复制" : "复制 SKU"}
              </button>
              <button className="ghost-button compact-button" type="button" onClick={copyAttachmentLinks} disabled={!attachmentLinks.length}>
                {copiedAttachments ? <Check size={15} /> : <Copy size={15} />}
                {copiedAttachments ? "已复制附件" : "复制附件链接"}
              </button>
              <button className="ghost-button compact-button" type="button" onClick={downloadAttachmentList} disabled={!attachmentLinks.length}>
                <Download size={15} />
                下载附件清单
              </button>
              <button className="sync-button compact-button" type="button" onClick={() => onAddToBundle(product)}>
                <Plus size={15} />
                加入选品清单
              </button>
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

function recordMatchesKeyword(values: Array<string | undefined>, keyword: string) {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) return true;
  return values.join(" ").toLowerCase().includes(normalized);
}

function filterQualificationRecords(records: QualificationRecord[], keyword: string, category: string, market: string) {
  return records.filter((item) => {
    const keywordMatched = recordMatchesKeyword([
      item.sku,
      item.productName,
      item.qualificationName,
      item.qualificationCategory,
      item.market,
      item.issuer,
      item.remark,
      ...item.files.map((file) => file.name),
    ], keyword);
    const categoryMatched = category === "全部" || item.qualificationCategory === category;
    const marketMatched = market === "全部" || item.market === market;
    return keywordMatched && categoryMatched && marketMatched;
  });
}

function filterAssetRecords(records: AssetRecord[], keyword: string, assetType: string, category: string) {
  return records.filter((item) => {
    const keywordMatched = recordMatchesKeyword([
      item.sku,
      item.productName,
      item.productNameEn,
      item.assetName,
      item.assetType,
      item.category,
      item.remark,
      ...item.files.map((file) => file.name),
    ], keyword);
    const typeMatched = assetType === "全部" || item.assetType === assetType;
    const categoryMatched = category === "全部" || item.category === category;
    return keywordMatched && typeMatched && categoryMatched;
  });
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
  const [selectedSku, setSelectedSku] = React.useState(ALL_RECORDS);
  const [keyword, setKeyword] = React.useState("");
  const [category, setCategory] = React.useState("全部");
  const [market, setMarket] = React.useState("全部");
  const selectedProduct = products.find((product) => product.sku === selectedSku);
  const sourceQualifications = selectedProduct ? getRelatedQualifications(selectedProduct, qualificationPayload) : qualificationPayload?.qualifications || [];
  const categories = uniqueSorted(sourceQualifications.map((item) => item.qualificationCategory));
  const markets = uniqueSorted(sourceQualifications.map((item) => item.market));
  const filteredQualifications = filterQualificationRecords(sourceQualifications, keyword, category, market);

  React.useEffect(() => {
    if (selectedSku !== ALL_RECORDS && !products.some((product) => product.sku === selectedSku)) {
      setSelectedSku(ALL_RECORDS);
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
          <div className="qualification-filter-stack">
            <label className="qualification-picker">
              <span>产品</span>
              <select value={selectedSku} onChange={(event) => setSelectedSku(event.target.value)}>
                <option value={ALL_RECORDS}>全部产品</option>
                {products.map((product) => (
                  <option key={product.id} value={product.sku}>
                    {product.sku} · {product.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="qualification-picker">
              <span>搜索</span>
              <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索 SKU、产品、资质名称、附件" />
            </label>
            <label className="qualification-picker">
              <span>资质类型</span>
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="全部">全部类型</option>
                {categories.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="qualification-picker">
              <span>市场</span>
              <select value={market} onChange={(event) => setMarket(event.target.value)}>
                <option value="全部">全部市场</option>
                {markets.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>
            <span className="filter-result">当前显示 <strong>{formatNumber(filteredQualifications.length)}</strong> 条</span>
          </div>
          <QualificationCards qualifications={filteredQualifications} />
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
  const [selectedSku, setSelectedSku] = React.useState(ALL_RECORDS);
  const [keyword, setKeyword] = React.useState("");
  const [assetType, setAssetType] = React.useState("全部");
  const [category, setCategory] = React.useState("全部");
  const selectedProduct = products.find((product) => product.sku === selectedSku);
  const selectedBase = selectedProduct ? findProductBase(selectedProduct, productBase) : undefined;
  const sourceAssets = selectedProduct ? getRelatedAssets(selectedProduct, selectedBase, assetPayload) : assetPayload?.assets || [];
  const assetTypes = uniqueSorted(sourceAssets.map((item) => item.assetType));
  const categories = uniqueSorted(sourceAssets.map((item) => item.category));
  const filteredAssets = filterAssetRecords(sourceAssets, keyword, assetType, category);

  React.useEffect(() => {
    if (selectedSku !== ALL_RECORDS && !products.some((product) => product.sku === selectedSku)) {
      setSelectedSku(ALL_RECORDS);
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
          <div className="qualification-filter-stack">
            <label className="qualification-picker">
              <span>产品</span>
              <select value={selectedSku} onChange={(event) => setSelectedSku(event.target.value)}>
                <option value={ALL_RECORDS}>全部产品</option>
                {products.map((product) => (
                  <option key={product.id} value={product.sku}>
                    {product.sku} · {product.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="qualification-picker">
              <span>搜索</span>
              <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索 SKU、产品、素材名称、附件" />
            </label>
            <label className="qualification-picker">
              <span>素材类型</span>
              <select value={assetType} onChange={(event) => setAssetType(event.target.value)}>
                <option value="全部">全部类型</option>
                {assetTypes.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="qualification-picker">
              <span>分类</span>
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="全部">全部分类</option>
                {categories.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>
            <span className="filter-result">当前显示 <strong>{formatNumber(filteredAssets.length)}</strong> 条</span>
          </div>
          <AssetCards assets={filteredAssets} />
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
  externalKeyword,
  onNeedDetails,
}: {
  products: CatalogProduct[];
  internal: boolean;
  currentUser: AuthUser;
  loading: boolean;
  payload: ProductPayload | null;
  qualificationPayload: QualificationPayload | null;
  assetPayload: AssetPayload | null;
  productBase: ProductBase[];
  externalKeyword: string;
  onNeedDetails: () => Promise<void>;
}) {
  const defaultChannel = internal ? "全部" : "分销";
  const [channel, setChannel] = React.useState<"全部" | "直营" | "分销">(defaultChannel);
  const [country, setCountry] = React.useState("全部");
  const [brand, setBrand] = React.useState("全部");
  const [keywordInput, setKeywordInput] = React.useState("");
  const [keyword, setKeyword] = React.useState("");
  const [detailProduct, setDetailProduct] = React.useState<CatalogProduct | null>(null);
  const [showBackTop, setShowBackTop] = React.useState(false);
  const [viewMode, setViewMode] = React.useState<"grid" | "list">("grid");
  const [gridColumns, setGridColumns] = React.useState<4 | 6 | 8>(4);
  const [bundleItems, setBundleItems] = React.useState<BundleSkuItem[]>([]);
  const [bundleOpen, setBundleOpen] = React.useState(false);
  const [partnerCtaVisible, setPartnerCtaVisible] = React.useState(true);
  const [partnerApplicationSku, setPartnerApplicationSku] = React.useState("");
  const [mobileFiltersOpen, setMobileFiltersOpen] = React.useState(false);
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
  const activeFilterCount = Number(country !== "全部") + Number(brand !== "全部") + Number(keyword.trim().length > 0);
  React.useEffect(() => {
    if (!internal) setChannel("分销");
  }, [internal]);

  React.useEffect(() => {
    if (!externalKeyword) return;
    setKeywordInput(externalKeyword);
    setKeyword(externalKeyword);
  }, [externalKeyword]);

  function addToBundle(product: CatalogProduct) {
    setBundleItems((items) => {
      const index = items.findIndex((item) => item.product.id === product.id);
      if (index >= 0) {
        return items.map((item, itemIndex) => (itemIndex === index ? { ...item, quantity: Math.min(999, item.quantity + 1) } : item));
      }
      return [...items, { product, quantity: 1 }];
    });
    setBundleOpen(true);
  }

  function updateBundleQuantity(productId: string, quantity: number) {
    setBundleItems((items) => items.map((item) => (item.product.id === productId ? { ...item, quantity: Math.max(1, Math.min(999, quantity || 1)) } : item)));
  }

  function removeBundleItem(productId: string) {
    setBundleItems((items) => items.filter((item) => item.product.id !== productId));
  }

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

      <button
        className={`catalog-mobile-filter-toggle ${mobileFiltersOpen ? "open" : ""}`}
        type="button"
        onClick={() => setMobileFiltersOpen((value) => !value)}
        aria-expanded={mobileFiltersOpen}
      >
        <span>
          筛选
          {activeFilterCount ? <small>{activeFilterCount}</small> : null}
        </span>
        <strong>{formatNumber(filteredProducts.length)} 个产品</strong>
        <ChevronDown size={16} />
      </button>

      <section className={`catalog-filter-panel ${mobileFiltersOpen ? "open" : ""}`}>
        <div className="filter-block country-filter">
          <span>国家</span>
          <div>
            <button type="button" className={country === "全部" ? "active" : ""} onClick={() => setCountry("全部")}>
              <span className="flag-icon flag-global" />
              全部
            </button>
            {countries.map((item) => (
              <button key={item} type="button" className={country === item ? "active" : ""} onClick={() => setCountry(item)}>
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
        <div className="mobile-filter-actions">
          <button className="ghost-button compact-button" type="button" onClick={() => { setCountry("全部"); setBrand("全部"); setKeyword(""); setKeywordInput(""); }}>
            清除筛选
          </button>
          <button className="sync-button compact-button" type="button" onClick={() => setMobileFiltersOpen(false)}>
            查看结果
          </button>
        </div>
      </section>

      {!showPrices && partnerCtaVisible ? (
        <section className="partner-access-banner">
          <div>
            <strong>需要查看分销价、库存和素材？</strong>
            <span>当前为外部浏览模式。请联系同舟运营开通分销账号，登录后可查看价格、库存、资质和素材文件。</span>
          </div>
          <div>
            <button className="sync-button compact-button" type="button" onClick={() => setPartnerApplicationSku("catalog")}>
              <ShoppingBag size={14} />
              申请分销账号
            </button>
            <button className="sync-button compact-button" type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
              <Lock size={14} />
              去登录
            </button>
            <button className="ghost-button compact-button" type="button" onClick={() => setPartnerCtaVisible(false)}>
              暂不显示
            </button>
          </div>
        </section>
      ) : null}

      {loading ? <div className="notice">正在读取产品库...</div> : null}

      <section className="catalog-view-toolbar" aria-label="产品库显示方式">
        <div className="catalog-view-group" role="group" aria-label="视图">
          <button className={viewMode === "grid" ? "active" : ""} type="button" onClick={() => setViewMode("grid")} title="卡片视图">
            <Grid2X2 size={16} />
            <span>卡片</span>
          </button>
          <button className={viewMode === "list" ? "active" : ""} type="button" onClick={() => setViewMode("list")} title="列表视图">
            <List size={16} />
            <span>列表</span>
          </button>
        </div>
        <div className="catalog-view-group density-group" role="group" aria-label="每行产品数">
          {([4, 6, 8] as const).map((count) => (
            <button
              key={count}
              className={viewMode === "grid" && gridColumns === count ? "active" : ""}
              type="button"
              onClick={() => {
                setViewMode("grid");
                setGridColumns(count);
              }}
              title={`每行 ${count} 个产品`}
            >
              {count}/行
            </button>
          ))}
        </div>
      </section>

      <section
        className={viewMode === "list" ? "catalog-list" : "catalog-grid"}
        style={viewMode === "grid" ? ({ "--catalog-columns": gridColumns } as React.CSSProperties) : undefined}
      >
        {filteredProducts.map((product) => {
          const price = priceFor(product, channel, internal);
          const salesPrice = salesPriceFor(product);
          return (
            <article className={`product-card ${viewMode === "grid" && gridColumns > 4 ? "dense-card" : ""}`} key={product.id}>
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
                  <button
                    className={`bundle-add-button ${bundleItems.some((item) => item.product.id === product.id) ? "active" : ""}`}
                    type="button"
                    title="加入组合 SKU 计算器"
                    aria-label={`加入组合 SKU 计算器：${product.name}`}
                    onClick={() => addToBundle(product)}
                  >
                    <Plus size={18} />
                  </button>
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
                      <button type="button" onClick={() => setPartnerApplicationSku(product.sku)}>申请分销账号后查看</button>
                    </div>
                  )}
                  <button className="icon-button" type="button" aria-label="查看产品关联资料" onClick={async () => {
                    await onNeedDetails();
                    setDetailProduct(product);
                  }}>
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
          onAddToBundle={addToBundle}
          onClose={() => setDetailProduct(null)}
        />
      ) : null}
      {partnerApplicationSku ? (
        <DistributorApplicationModal
          sourceSku={partnerApplicationSku === "catalog" ? "" : partnerApplicationSku}
          onClose={() => setPartnerApplicationSku("")}
        />
      ) : null}
      <BundleSkuCalculator
        items={bundleItems}
        open={bundleOpen}
        channel={channel}
        internal={internal}
        showPrices={showPrices}
        onOpen={() => setBundleOpen(true)}
        onClose={() => setBundleOpen(false)}
        onQuantityChange={updateBundleQuantity}
        onRemove={removeBundleItem}
        onClear={() => setBundleItems([])}
      />
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

function DistributorApplicationModal({ sourceSku, onClose }: { sourceSku?: string; onClose: () => void }) {
  const [form, setForm] = React.useState({
    companyName: "",
    contactName: "",
    phone: "",
    wechat: "",
    email: "",
    market: "",
    note: sourceSku ? `关注 SKU：${sourceSku}` : "",
  });
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await submitDistributorApplication({ ...form, sourceSku });
      setSubmitted(true);
      setMessage(`申请已提交，编号：${result.application.id}。运营同事会根据联系方式回访。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "申请提交失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="confirm-layer" role="dialog" aria-modal="true" aria-label="申请分销账号">
      <button className="confirm-backdrop" type="button" aria-label="关闭申请表单" onClick={onClose} />
      <form className="distributor-application-modal" onSubmit={submit}>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Partner Access</p>
            <h2>申请分销账号</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <p>提交后会进入同舟运营待处理列表。账号开通后可查看分销价、库存、资质和素材文件。</p>
        <div className="distributor-application-grid">
          <label>
            <span>公司 / 店铺名称</span>
            <input value={form.companyName} onChange={(event) => setForm((current) => ({ ...current, companyName: event.target.value }))} disabled={submitted} />
          </label>
          <label>
            <span>联系人</span>
            <input value={form.contactName} onChange={(event) => setForm((current) => ({ ...current, contactName: event.target.value }))} disabled={submitted} />
          </label>
          <label>
            <span>手机号</span>
            <input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} disabled={submitted} />
          </label>
          <label>
            <span>微信</span>
            <input value={form.wechat} onChange={(event) => setForm((current) => ({ ...current, wechat: event.target.value }))} disabled={submitted} />
          </label>
          <label>
            <span>邮箱</span>
            <input value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} disabled={submitted} />
          </label>
          <label>
            <span>主要市场</span>
            <input value={form.market} onChange={(event) => setForm((current) => ({ ...current, market: event.target.value }))} placeholder="例如：俄罗斯 / 印尼 / TikTok Shop" disabled={submitted} />
          </label>
          <label className="distributor-application-span">
            <span>需求说明</span>
            <textarea value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} disabled={submitted} />
          </label>
        </div>
        {message ? <div className={`notice compact-notice ${submitted ? "good" : "warning"}`}>{message}</div> : null}
        <div className="confirm-actions">
          <button className="ghost-button" type="button" onClick={onClose}>{submitted ? "关闭" : "取消"}</button>
          {!submitted ? <button className="sync-button" type="submit" disabled={busy}>{busy ? "提交中" : "提交申请"}</button> : null}
        </div>
      </form>
    </div>
  );
}

function BundleSkuCalculator({
  items,
  open,
  channel,
  internal,
  showPrices,
  onOpen,
  onClose,
  onQuantityChange,
  onRemove,
  onClear,
}: {
  items: BundleSkuItem[];
  open: boolean;
  channel: "全部" | "直营" | "分销";
  internal: boolean;
  showPrices: boolean;
  onOpen: () => void;
  onClose: () => void;
  onQuantityChange: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
  onClear: () => void;
}) {
  const [copied, setCopied] = React.useState("");
  const code = bundleSkuCode(items);
  const totals = bundleTotals(items, channel, internal);
  const totalQty = items.reduce((sum, item) => sum + item.quantity, 0);
  const quoteText = [
    `组合SKU：${code || "未选择产品"}`,
    `组合成本：${totals.costCurrency} ${formatMoney(totals.cost)}`,
    `组合售价：${totals.salesCurrency} ${formatMoney(totals.sales)}`,
    ...items.map((item) => `${bundleSkuProductCode(item.product)} * ${item.quantity} - ${item.product.name}`),
  ].join("\n");

  async function copyValue(value: string, type: string) {
    if (!value) return;
    await copyText(value);
    setCopied(type);
    window.setTimeout(() => setCopied(""), 1200);
  }

  function downloadQuote() {
    if (!items.length) return;
    const fileName = `tongzhou-quote-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadTextFile(fileName, bundleQuoteCsv(items, channel, internal, showPrices), "text/csv;charset=utf-8");
    setCopied("download");
    window.setTimeout(() => setCopied(""), 1200);
  }

  return (
    <>
      {items.length || open ? (
        <button className={`bundle-fab ${items.length ? "has-items" : ""}`} type="button" onClick={onOpen} aria-label="打开组合 SKU 计算器">
          <Calculator size={20} />
          <span>组合SKU</span>
          {items.length ? <strong>{items.length}</strong> : null}
        </button>
      ) : null}
      {open ? (
        <div className="modal-backdrop bundle-modal-backdrop" role="presentation" onMouseDown={onClose}>
          <section className="bundle-calculator-modal" role="dialog" aria-modal="true" aria-label="组合 SKU 计算器" onMouseDown={(event) => event.stopPropagation()}>
            <header className="bundle-modal-header">
              <div>
                <p className="eyebrow">Bundle SKU Calculator</p>
                <h2>组合 SKU 计算器</h2>
              </div>
              <button className="icon-button" type="button" onClick={onClose} aria-label="关闭组合 SKU 计算器">
                <X size={18} />
              </button>
            </header>

            {items.length ? (
              <>
                <div className="bundle-code-box">
                  <small>组合编码</small>
                  <strong>{code}</strong>
                  <button className="ghost-button compact-button" type="button" onClick={() => copyValue(code, "sku")}>
                    <Copy size={15} />
                    {copied === "sku" ? "已复制" : "复制SKU"}
                  </button>
                </div>

                <div className="bundle-items">
                  {items.map((item) => {
                    const cost = priceFor(item.product, channel, internal);
                    const salesPrice = salesPriceFor(item.product);
                    return (
                      <article className="bundle-item" key={item.product.id}>
                        <div>
                          <strong>{item.product.name}</strong>
                          <span>{bundleSkuProductCode(item.product)}</span>
                        </div>
                        <div className="bundle-qty-control">
                          <button type="button" onClick={() => onQuantityChange(item.product.id, item.quantity - 1)} aria-label="减少数量">
                            <Minus size={14} />
                          </button>
                          <input
                            value={item.quantity}
                            inputMode="numeric"
                            onChange={(event) => onQuantityChange(item.product.id, Number(event.target.value))}
                            aria-label={`${item.product.name} 数量`}
                          />
                          <button type="button" onClick={() => onQuantityChange(item.product.id, item.quantity + 1)} aria-label="增加数量">
                            <Plus size={14} />
                          </button>
                        </div>
                        <div className="bundle-line-price">
                          <span>{cost.currency} {formatMoney(cost.price * item.quantity)}</span>
                          <small>{salesPrice.currency} {formatMoney(salesPrice.price * item.quantity)}</small>
                        </div>
                        <button className="icon-button danger-button" type="button" onClick={() => onRemove(item.product.id)} aria-label="移除单品">
                          <Trash2 size={15} />
                        </button>
                      </article>
                    );
                  })}
                </div>

                <div className="bundle-summary">
                  <div>
                    <small>单品数量</small>
                    <strong>{formatNumber(totalQty)}</strong>
                  </div>
                  <div>
                    <small>组合成本</small>
                    <strong>{showPrices ? `${totals.costCurrency} ${formatMoney(totals.cost)}` : "登录后可见"}</strong>
                  </div>
                  <div>
                    <small>组合售价</small>
                    <strong>{showPrices ? `${totals.salesCurrency} ${formatMoney(totals.sales)}` : "登录后可见"}</strong>
                  </div>
                </div>

                <footer className="bundle-modal-actions">
                  <button className="ghost-button" type="button" onClick={onClear}>清空</button>
                  <button className="ghost-button" type="button" onClick={downloadQuote}>
                    <Download size={16} />
                    {copied === "download" ? "已下载" : "下载报价单"}
                  </button>
                  <button className="sync-button" type="button" onClick={() => copyValue(quoteText, "quote")}>
                    <Copy size={16} />
                    {copied === "quote" ? "已复制报价" : "复制报价"}
                  </button>
                </footer>
              </>
            ) : (
              <div className="bundle-empty">
                <Calculator size={34} />
                <strong>先从产品卡片点击 + 加入单品</strong>
                <span>适合 2-3 个产品组合上架，系统会自动生成编码并汇总成本和售价。</span>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </>
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
  const confirm = useConfirm();
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
    const category = categories.find((item) => item.id === categoryId);
    const confirmed = await confirm({
      title: `删除分类「${category?.name || categoryId}」`,
      body: "删除分类会同时删除分类下的所有快捷方式。",
      confirmText: "删除分类",
      tone: "danger",
      details: [`快捷方式数量：${formatNumber(category?.links?.length || 0)}`],
    });
    if (!confirmed) return;
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
    const category = categories.find((item) => item.id === categoryId);
    const link = category?.links.find((item) => item.id === linkId);
    const confirmed = await confirm({
      title: `删除快捷方式「${link?.title || linkId}」`,
      body: "删除后，这个入口将不再出现在快捷导航里。",
      confirmText: "删除快捷方式",
      tone: "danger",
      details: [`所属分类：${category?.name || "未识别"}`, link?.url ? `链接：${link.url}` : ""].filter(Boolean),
    });
    if (!confirmed) return;
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

function renderInlineMarkdown(text: string, keyPrefix: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g).filter(Boolean);
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={key}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={key}>{part.slice(2, -2)}</strong>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      return (
        <a key={key} href={link[2]} target="_blank" rel="noreferrer">
          {link[1]}
        </a>
      );
    }
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

function renderMarkdown(content: string) {
  const lines = String(content || "").split(/\r?\n/);
  const nodes: React.ReactNode[] = [];
  let listItems: string[] = [];
  let codeLines: string[] = [];
  let inCode = false;

  const flushList = () => {
    if (!listItems.length) return;
    const items = listItems;
    listItems = [];
    nodes.push(
      <ul key={`list-${nodes.length}`}>
        {items.map((item, index) => <li key={index}>{renderInlineMarkdown(item, `li-${nodes.length}-${index}`)}</li>)}
      </ul>,
    );
  };

  const flushCode = () => {
    if (!codeLines.length) return;
    const code = codeLines.join("\n");
    codeLines = [];
    nodes.push(<pre key={`code-${nodes.length}`}><code>{code}</code></pre>);
  };

  lines.forEach((line) => {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        inCode = false;
        flushCode();
      } else {
        flushList();
        inCode = true;
      }
      return;
    }
    if (inCode) {
      codeLines.push(line);
      return;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushList();
      nodes.push(<h4 className={`level-${heading[1].length}`} key={`heading-${nodes.length}`}>{renderInlineMarkdown(heading[2], `h-${nodes.length}`)}</h4>);
      return;
    }
    const bullet = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/);
    if (bullet) {
      listItems.push(bullet[1]);
      return;
    }
    flushList();
    if (!line.trim()) {
      nodes.push(<br key={`br-${nodes.length}`} />);
      return;
    }
    nodes.push(<p key={`p-${nodes.length}`}>{renderInlineMarkdown(line, `p-${nodes.length}`)}</p>);
  });
  flushList();
  flushCode();
  return nodes.length ? nodes : null;
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
  const [chatMessages, setChatMessages] = React.useState<AiChatMessage[]>([]);
  const [textAttachments, setTextAttachments] = React.useState<AiChatAttachment[]>([]);
  const [textParams, setTextParams] = React.useState({ temperature: 0.7, topP: 1, maxTokens: 1200 });
  const [showTextAdvanced, setShowTextAdvanced] = React.useState(false);
  const [imagePrompt, setImagePrompt] = React.useState("");
  const [imageParams, setImageParams] = React.useState({ size: "1024x1024", n: 1, quality: "standard", style: "natural", seed: "", negativePrompt: "" });
  const [imageReferenceUploads, setImageReferenceUploads] = React.useState<Array<{ name: string; url: string }>>([]);
  const [images, setImages] = React.useState<string[]>([]);
  const [previewImage, setPreviewImage] = React.useState("");
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
  const [videoDownloadWarning, setVideoDownloadWarning] = React.useState("");
  const [busy, setBusy] = React.useState<"config" | "text" | "image" | "video" | "poll" | "upload" | "">("");
  const [message, setMessage] = React.useState("");
  const chatWindowRef = React.useRef<HTMLDivElement | null>(null);
  const textImageInputRef = React.useRef<HTMLInputElement | null>(null);
  const aiLocked = !canViewPartnerAssets(currentUser);

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
    void pollVideo(true);
    const timer = window.setInterval(() => {
      void pollVideo(true);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [videoTask, videoUrl]);

  React.useEffect(() => {
    chatWindowRef.current?.scrollTo({
      top: chatWindowRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [chatMessages]);

  React.useEffect(() => {
    if (!previewImage) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewImage("");
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [previewImage]);

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
    if (aiLocked) {
      setMessage("请先登录或注册账号后再使用同舟AI。");
      return;
    }
    if (!textPrompt.trim() && !textAttachments.length) {
      setMessage("请先输入要对话的内容。");
      return;
    }
    setBusy("text");
    setMessage("");
    const userMessage: AiChatMessage = {
      role: "user",
      content: textPrompt.trim() || "请分析我上传的图片。",
      attachments: textAttachments.length ? textAttachments : undefined,
    };
    const nextMessages = [...chatMessages, userMessage];
    let answer = "";
    const assistantIndex = nextMessages.length;
    setChatMessages([...nextMessages, { role: "assistant", content: "" }]);
    setTextPrompt("");
    setTextAttachments([]);
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

  async function uploadTextAttachments(files: File[]) {
    if (aiLocked) {
      setMessage("请先登录或注册账号后再上传图片。");
      return;
    }
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (!images.length) return;
    setBusy("upload");
    setMessage("");
    try {
      const uploaded: AiChatAttachment[] = [];
      for (const file of images) {
        const dataUrl = await fileToDataUrl(file);
        const result = await uploadAiImage({ fileName: file.name || `paste-${Date.now()}.png`, dataUrl });
        uploaded.push({ name: file.name || "粘贴图片", url: result.upload.url });
      }
      setTextAttachments((current) => [...current, ...uploaded]);
      setMessage(uploaded.some((item) => isPrivateUploadUrl(item.url)) ? "图片已添加到本轮对话。当前是本地/内网地址，部署到公网后模型才能稳定读取图片。" : "图片已添加到本轮对话。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "图片上传失败。");
    } finally {
      setBusy("");
      if (textImageInputRef.current) textImageInputRef.current.value = "";
    }
  }

  function handleTextPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files || []).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    event.preventDefault();
    void uploadTextAttachments(files);
  }

  async function submitImage(event: React.FormEvent) {
    event.preventDefault();
    if (aiLocked) {
      setMessage("请先登录或注册账号后再使用图片生成模型。");
      return;
    }
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
      if (result.referenceCount) {
        const warningText = result.warnings?.length ? `；编辑接口回退：${result.warnings[0]}` : "";
        setMessage(`已按参考图模式生成，参考图 ${result.referenceCount} 张${warningText}`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "图片生成失败。");
    } finally {
      setBusy("");
    }
  }

  async function submitVideo(event: React.FormEvent) {
    event.preventDefault();
    if (aiLocked) {
      setMessage("请先登录或注册账号后再使用视频生成模型。");
      return;
    }
    if (!videoPrompt.trim()) {
      setMessage("请先输入视频提示词。");
      return;
    }
    setBusy("video");
    setMessage("");
    setVideoTask("");
    setVideoStatus("");
    setVideoUrl("");
    setVideoDownloadWarning("");
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
      setVideoUrl(resolveApiUrl(result.videoUrl || ""));
      setVideoDownloadWarning(result.downloadWarning || "");
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
    if (aiLocked) {
      setMessage("请先登录或注册账号后再上传参考图片。");
      return;
    }
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
      setVideoUrl(resolveApiUrl(result.videoUrl || ""));
      setVideoDownloadWarning(result.downloadWarning || "");
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

  const imageSizeOptions = [
    { value: "1024x1024", label: "1:1 方图", ratio: "1 / 1" },
    { value: "1024x1792", label: "9:16 竖图", ratio: "9 / 16" },
    { value: "1792x1024", label: "16:9 横图", ratio: "16 / 9" },
  ];

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

      {aiLocked ? (
        <div className="notice warning ai-login-notice">
          同舟AI 可预览，但需要登录或注册账号后才能发送消息、上传图片和生成内容。
        </div>
      ) : null}

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
          <div className="ai-chat-window" ref={chatWindowRef}>
            {chatMessages.length ? chatMessages.map((item, index) => (
              <article key={`${item.role}-${index}`} className={`ai-chat-message ${item.role}`}>
                <strong>{item.role === "user" ? "你" : "同舟AI"}</strong>
                <div className="ai-markdown">{renderMarkdown(item.content)}</div>
                {item.attachments?.length ? (
                  <div className="ai-message-attachments">
                    {item.attachments.map((attachment) => (
                      <a key={attachment.url} href={attachment.url} target="_blank" rel="noreferrer">
                        <img src={attachment.url} alt={attachment.name} />
                        <span>{attachment.name}</span>
                      </a>
                    ))}
                  </div>
                ) : null}
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
            onPaste={handleTextPaste}
            placeholder="输入问题、改写需求、翻译内容或分析任务。按 Enter 发送，Shift + Enter 换行；可 Ctrl + V 粘贴图片。"
          />
          {textAttachments.length ? (
            <div className="ai-upload-list ai-text-attachments">
              {textAttachments.map((item) => (
                <span key={item.url}>
                  <img src={item.url} alt={item.name} />
                  <em>{item.name}</em>
                  <button type="button" onClick={() => setTextAttachments((current) => current.filter((attachment) => attachment.url !== item.url))}>移除</button>
                </span>
              ))}
            </div>
          ) : null}
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
            <input
              ref={textImageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="ai-hidden-file"
              onChange={(event) => void uploadTextAttachments(Array.from(event.currentTarget.files || []))}
            />
            <button className="ghost-button" type="button" onClick={() => textImageInputRef.current?.click()} disabled={aiLocked || busy === "upload" || busy === "text"}>
              <Image size={15} />
              {busy === "upload" ? "上传中" : "上传图片"}
            </button>
            <button className="ghost-button" type="button" onClick={() => setChatMessages([])}>清空对话</button>
            <button className="ghost-button" type="button" onClick={() => setShowTextAdvanced((value) => !value)}>
              {showTextAdvanced ? "隐藏参数" : "高级参数"}
            </button>
          <button className="sync-button" type="submit" disabled={aiLocked || busy === "text"}>
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
              <div className="ai-ratio-options" role="radiogroup" aria-label="图片比例">
                {imageSizeOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={imageParams.size === option.value ? "active" : ""}
                    onClick={() => setImageParams((current) => ({ ...current, size: option.value }))}
                  >
                    <i style={{ aspectRatio: option.ratio }} />
                    <b>{option.label}</b>
                  </button>
                ))}
              </div>
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
          <button className="sync-button" type="submit" disabled={aiLocked || busy === "image"}>
            {busy === "image" ? "生成中" : "生成图片"}
          </button>
          {images.length ? (
            <div className="ai-image-results">
              {images.map((item, index) => {
                const src = imageSrc(item);
                return (
                  <figure className="ai-image-card" key={`${item}-${index}`}>
                    <button className="ai-image-preview-trigger" type="button" onClick={() => setPreviewImage(src)}>
                      <img src={src} alt={`AI 生成图片 ${index + 1}`} />
                    </button>
                    <figcaption>
                      <span>图片 {index + 1}</span>
                      <a className="ghost-button compact-button" href={src} download={`tongzhou-ai-image-${index + 1}.png`}>
                        <Download size={14} />
                        下载
                      </a>
                    </figcaption>
                  </figure>
                );
              })}
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
          <button className="sync-button" type="submit" disabled={aiLocked || busy === "video"}>
            {busy === "video" ? "提交中" : "生成视频"}
          </button>
          {videoTask ? (
            <div className="ai-video-status">
              <span>任务：{videoTask}</span>
              <span>状态：{videoStatus || "处理中"}</span>
              {!videoUrl ? (
                <button className="ghost-button" type="button" onClick={() => pollVideo()} disabled={aiLocked || busy === "poll"}>
                  {busy === "poll" ? "查询中" : "查询结果"}
                </button>
              ) : null}
            </div>
          ) : null}
          {videoUrl ? (
            <>
              <video className="ai-video-result" src={videoUrl} controls playsInline />
              <a className="ghost-button compact-button" href={videoUrl} download={`tongzhou-ai-video-${videoTask || Date.now()}.mp4`}>
                <Download size={14} />
                下载视频
              </a>
              {videoDownloadWarning ? <small className="muted-text">视频已生成，但自动下载到本地失败：{videoDownloadWarning}</small> : null}
            </>
          ) : null}
        </form>
        ) : null}
      </section>

      {previewImage ? (
        <div className="ai-image-lightbox" role="dialog" aria-modal="true" onClick={() => setPreviewImage("")}>
          <button className="icon-button" type="button" aria-label="关闭预览" onClick={() => setPreviewImage("")}>
            <X size={20} />
          </button>
          <img src={previewImage} alt="AI 生成图片预览" onClick={(event) => event.stopPropagation()} />
        </div>
      ) : null}

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
