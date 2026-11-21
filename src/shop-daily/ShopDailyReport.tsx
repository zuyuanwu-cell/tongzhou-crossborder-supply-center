import React from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, CircleHelp, ClipboardPaste, Download, ExternalLink, FileUp, ListChecks, Maximize2, Minimize2, PackageSearch, Plus, RefreshCw, Save, Search, Settings, Store, Trash2, X } from "lucide-react";
import {
  deleteShopDailyMetric,
  deleteShopReviewOrder,
  fetchShopDailyOrders,
  fetchShopDailyReport,
  importShopDailyReport,
  saveShopReviewOrders,
  updateShopFeeRules,
  type ShopDailyImportResult,
  type ShopDailyMetrics,
  type ShopDailyOrder,
  type ShopDailyOrderDrilldownPayload,
  type ShopDailyReportPayload,
  type ShopDailyRow,
  type ShopDailyShopSummary,
  type ShopFeeRule,
} from "../api";
import { matchingShopDailyPreset, shopDailyDateRange, SHOP_DAILY_DATE_PRESETS, type ShopDailyDatePreset } from "./date-ranges";
import "./shop-daily.css";

type Filters = { dateFrom?: string; dateTo?: string; shopKey?: string; projectGroup?: string; country?: string; platform?: string; salesChannel?: string };
type Section = "report" | "import" | "reviews" | "rules";
type View = "shops" | "days";
type DataStatus = "complete" | "incomplete";
const DAY_PAGE_SIZE = 200;
type OrderDrilldownTarget = { shopKey: string; shopName: string; platform: string; dateFrom: string; dateTo: string; label: string };

const cnyFormatter = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 });
const numberFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });

function fmtCny(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : cnyFormatter.format(value);
}

function fmtNum(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : numberFormatter.format(value);
}

function safeExternalUrl(value: string | null | undefined) {
  if (!value) return "";
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function formatOrderStatus(value: string | null | undefined) {
  const raw = String(value || "").trim();
  const normalized = raw.toLowerCase();
  const labels: Record<string, string> = {
    completed: "已完成",
    delivered: "已送达",
    shipped: "已发货",
    paid: "已付款",
    processing: "处理中",
    pending: "待处理",
    cancelled: "已取消",
    canceled: "已取消",
    refunded: "已退款",
    has_out_storage: "已出库",
  };
  return labels[normalized] || raw || "状态未同步";
}

function fmtPct(value: number | null | undefined, digits = 2) {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
}

function fmtRatio(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(2);
}

function fmtLocal(value: number | null | undefined, currency: string) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return `${numberFormatter.format(value)} ${currency}`;
}

const SOURCE_LABEL: Record<string, string> = {
  import: "导入",
  ziniao: "紫鸟",
  system: "中台订单",
  registry: "订单登记",
  none: "未录入",
};

const FLAG_LABEL: Record<string, string> = {
  missing_traffic: "流量未填",
  missing_ad: "推广费未填",
  system_revenue: "用中台订单",
  missing_platform_revenue: "平台支付金额未采集",
  missing_platform_orders: "平台订单数未采集",
  missing_rate: "缺汇率",
  review_amount_missing: "测评金额待补",
  review_received_missing: "测评实收待补",
  missing_system_orders: "未匹配中台订单",
};

type PlatformOption = { key: string; value: string; label: string; count: number; mark: string };

function normalizedPlatformKey(value: string) {
  const token = String(value || "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}_]+/gu, "");
  if (token.includes("shopee") || token.includes("虾皮")) return "shopee";
  if (token.includes("tiktok") || token === "tk" || token === "tt") return "tiktok";
  if (token.includes("tokopedia")) return "tokopedia";
  if (token.includes("lazada")) return "lazada";
  if (token.includes("ozon")) return "ozon";
  return token || "other";
}

function platformPresentation(value: string) {
  const key = normalizedPlatformKey(value);
  const known: Record<string, { label: string; mark: string }> = {
    shopee: { label: "Shopee", mark: "S" },
    tiktok: { label: "TikTok Shop", mark: "♪" },
    tokopedia: { label: "Tokopedia", mark: "T" },
    lazada: { label: "Lazada", mark: "L" },
    ozon: { label: "Ozon", mark: "O₃" },
  };
  return { key, label: known[key]?.label || value || "其他平台", mark: known[key]?.mark || String(value || "其").slice(0, 2).toUpperCase() };
}

function PlatformMark({ platform }: { platform: string }) {
  const presentation = platformPresentation(platform);
  return <span className={`shop-daily-platform-mark is-${presentation.key}`} aria-hidden="true">{presentation.mark}</span>;
}

function salesChannelLabel(value: string) {
  const normalized = String(value || "").trim().toUpperCase();
  const labels: Record<string, string> = {
    TIKTOK_SHOP: "TikTok Shop",
    TOKOPEDIA: "Tokopedia",
    UNSPECIFIED: "待确认渠道",
  };
  return labels[normalized] || value || "未标记渠道";
}

const RECOGNIZED_COLUMNS = "日期、店铺、国家、平台、支付金额、展示数、访客数、订单数、加购人数、测评金额、实际收款金额、测评数量、站内推广费、站外推广费、产品成本、操作费";

function emptyRule(scope: ShopFeeRule["scope"], base?: ShopFeeRule): ShopFeeRule {
  return {
    scope,
    mode: base?.mode || "standard",
    commissionRate: base?.commissionRate ?? 0.165,
    perOrderFee: base?.perOrderFee ?? 0,
    perOrderFeeCurrency: base?.perOrderFeeCurrency || "LOCAL",
    adTaxRate: base?.adTaxRate ?? 0,
    reviewUnitCostCny: base?.reviewUnitCostCny ?? 10.4,
    fixedLocalPerCny: base?.fixedLocalPerCny ?? 0,
    stackedNetRate: base?.stackedNetRate ?? 0.868,
    stackedFactor1: base?.stackedFactor1 ?? 0.97,
    stackedFactor2: base?.stackedFactor2 ?? 0.95,
    stackedExtraRate: base?.stackedExtraRate ?? 0.05,
    useSystemProductCost: base?.useSystemProductCost ?? true,
    useSystemOperationFee: base?.useSystemOperationFee ?? true,
  };
}

function ruleKey(rule: ShopFeeRule) {
  if (rule.scope === "default") return "default";
  if (rule.scope === "country") return `country:${rule.countryKey || ""}`;
  if (rule.scope === "platform") return `platform:${rule.platform || ""}|${rule.countryKey || ""}`;
  return `shop:${rule.shopKey || ""}`;
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadCsv(name: string, header: string[], lines: Array<Array<unknown>>) {
  const csv = `﻿${[header, ...lines].map((line) => line.map(csvCell).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

type MetricDefinitionKey =
  | "payAmount" | "impressions" | "visitors" | "orderCount" | "addToCart" | "review"
  | "realSales" | "adOnsite" | "adOffsite" | "roi" | "visitRate" | "addToCartRate"
  | "conversionRate" | "aov" | "productCost" | "operationFee" | "platformFee" | "profit"
  | "profitMargin" | "adTotal" | "trafficSummary" | "reviewCost"
  | "syncedOrders" | "itemQuantity" | "systemSales" | "systemProductCost";

type MetricDefinition = {
  label: string;
  source: string;
  formula?: string | string[];
  note?: string;
};

const METRIC_DEFINITIONS: Record<MetricDefinitionKey, MetricDefinition> = {
  payAmount: {
    label: "支付金额",
    source: "优先取平台导入或紫鸟采集；Shopee 使用官方订单导表并按平台订单号去重。缺少平台数据时，暂用中台已同步订单成交额。外币按费率规则中的固定汇率或经营汇率换算成人民币。",
    formula: [
      "Shopee 本币支付销售额 = 订单小计 − 卖家承担优惠券",
      "人民币支付金额 = 本币支付金额 ÷ 汇率（1¥ = 本币）",
    ],
    note: "平台承担的优惠券、平台折扣和金币不扣减；商品折扣已经包含在订单小计内，不重复扣减。",
  },
  impressions: {
    label: "展示数",
    source: "取平台导入或紫鸟采集的展示/曝光字段。",
    formula: "汇总展示数 = Σ 每日展示数",
  },
  visitors: {
    label: "访客数",
    source: "取平台导入或紫鸟采集的访客字段；Shopee 使用商业分析的去重访客口径（hybrid_uv）。",
    formula: "汇总访客数 = Σ 每日访客数",
    note: "跨日汇总为每日访客相加，不做跨日用户去重。",
  },
  orderCount: {
    label: "订单数",
    source: "优先取平台导入或紫鸟采集的支付订单；Shopee 官方导表按支付日期、平台订单号去重。缺少平台数据时使用中台订单。",
    formula: "汇总订单数 = Σ 每日支付订单数",
  },
  addToCart: {
    label: "加购",
    source: "取平台导入或紫鸟采集的加购人数。",
    formula: "汇总加购人数 = Σ 每日加购人数",
  },
  review: {
    label: "测评",
    source: "有测评订单登记时按登记订单统计；没有登记时使用导入的测评金额、实际收款和测评数量。",
    formula: [
      "测评损失 = 测评金额 − 实际收款",
      "测评成本 = 测评损失（折人民币）+ 测评数量 × 测评单位成本",
    ],
    note: "表格主值显示测评数量；拥有成本权限时，下方同时显示测评成本。",
  },
  realSales: {
    label: "真实成交",
    source: "由支付金额和测评登记计算，不直接采集。",
    formula: [
      "真实成交 = max(0, 支付金额（人民币）− 测评金额（人民币）)",
      "真实订单数 = max(0, 订单数 − 测评数量)",
    ],
  },
  adOnsite: {
    label: "站内推广",
    source: "取平台导入或紫鸟采集的站内广告费，再按费率规则计税并换算人民币。",
    formula: "站内推广费（人民币）= 本币站内广告费 × (1 + 推广税率) ÷ 汇率",
  },
  adOffsite: {
    label: "站外推广",
    source: "取平台导入或紫鸟采集的站外广告费，再按费率规则计税并换算人民币。",
    formula: "站外推广费（人民币）= 本币站外广告费 × (1 + 推广税率) ÷ 汇率",
  },
  roi: {
    label: "ROI",
    source: "由真实成交和含税推广费计算。",
    formula: "ROI = 真实成交 ÷ (站内推广费 + 站外推广费)",
    note: "没有推广费时显示“—”。汇总值用合计金额重新计算，不对每日 ROI 求和或平均。",
  },
  visitRate: {
    label: "点击率",
    source: "由平台展示数和访客数计算。",
    formula: "点击率 = 访客数 ÷ 展示数 × 100%",
    note: "当前系统以访客数作为从展示进入店铺/商品页的访问量。",
  },
  addToCartRate: {
    label: "加购率",
    source: "由加购人数和访客数计算。",
    formula: "加购率 = 加购人数 ÷ 访客数 × 100%",
  },
  conversionRate: {
    label: "转化率",
    source: "由真实订单数和访客数计算。",
    formula: "转化率 = 真实订单数 ÷ 访客数 × 100%",
  },
  aov: {
    label: "客单价",
    source: "由真实成交和真实订单数计算。",
    formula: "客单价 = 真实成交（人民币）÷ 真实订单数",
  },
  productCost: {
    label: "产品成本",
    source: "优先使用运营导入的产品成本；未导入且费率规则允许时，使用中台订单按 SKU、国家匹配的直营产品成本。",
    formula: "产品成本 = Σ 订单商品数量 × 对应产品成本单价",
  },
  operationFee: {
    label: "操作费",
    source: "优先使用运营导入的操作费；未导入且费率规则允许时，使用中台订单打包费。",
    formula: "操作费 = Σ 每笔订单对应的操作费/打包费",
  },
  platformFee: {
    label: "平台扣费",
    source: "不是独立采集字段，而是用利润公式倒推出佣金、每单费用和叠乘系数等未单列扣费。",
    formula: "平台扣费 = 真实成交 − 推广费 − 测评成本 − 产品成本 − 操作费 − 利润预估",
  },
  profit: {
    label: "利润预估",
    source: "按每个店铺命中的费率规则逐日计算，汇总值为各行利润之和。",
    formula: [
      "标准公式：真实成交 × (1 − 佣金率) − 真实单量 × 每单费用 − 推广费 − 测评成本 − 产品成本 − 操作费",
      "叠乘公式：((真实成交 × 净收比例 − 推广费) × 系数1) × 系数2 − 测评成本 − 真实单量 × 每单费用 − 产品成本 − 真实成交 × 额外扣点 − 操作费",
    ],
  },
  profitMargin: {
    label: "利润率",
    source: "由利润预估和真实成交计算。",
    formula: "利润率 = 利润预估 ÷ 真实成交 × 100%",
    note: "汇总值使用合计利润和合计真实成交重新计算。",
  },
  adTotal: {
    label: "推广费（含税）",
    source: "站内、站外推广费取自平台导入或紫鸟采集，并按费率规则计税、换算人民币。",
    formula: "推广费（含税）= 站内推广费（含税）+ 站外推广费（含税）",
  },
  trafficSummary: {
    label: "访客 / 转化率",
    source: "访客取平台导入或紫鸟采集；转化率、加购率由汇总后的订单、加购和访客重新计算。",
    formula: ["转化率 = 真实订单数 ÷ 访客数 × 100%", "加购率 = 加购人数 ÷ 访客数 × 100%"],
  },
  reviewCost: {
    label: "测评成本",
    source: "优先取测评订单登记；没有登记时使用导入的测评数据和费率规则中的测评单位成本。",
    formula: "测评成本 = (测评金额 − 实际收款)折人民币 + 测评数量 × 测评单位成本",
  },
  syncedOrders: {
    label: "已同步订单",
    source: "取中台已同步订单事实，按订单唯一标识去重。",
    formula: "已同步订单 = 当前店铺与日期范围内的去重订单数",
  },
  itemQuantity: {
    label: "商品件数",
    source: "取中台订单商品明细数量。",
    formula: "商品件数 = Σ 订单商品行数量",
  },
  systemSales: {
    label: "成交金额",
    source: "取中台已同步订单中具备有效收入覆盖的订单商品行。",
    formula: "成交金额（人民币）= Σ 有效订单商品行成交额（人民币）",
  },
  systemProductCost: {
    label: "产品成本",
    source: "取中台订单按 SKU、国家匹配的直营产品成本。",
    formula: "产品成本 = Σ 订单商品数量 × 对应产品成本单价",
  },
};

const BASE_METRIC_HEADERS: MetricDefinitionKey[] = [
  "payAmount", "impressions", "visitors", "orderCount", "addToCart", "review", "realSales",
  "adOnsite", "adOffsite", "roi", "visitRate", "addToCartRate", "conversionRate", "aov",
];
const COST_METRIC_HEADERS: MetricDefinitionKey[] = ["productCost", "operationFee", "platformFee"];
const PROFIT_METRIC_HEADERS: MetricDefinitionKey[] = ["profit", "profitMargin"];

type MetricTooltipPosition = { left: number; top: number; width: number; above: boolean };

function MetricExplain({
  metric,
  children,
  detail,
  variant = "value",
}: {
  metric: MetricDefinitionKey;
  children?: React.ReactNode;
  detail?: string;
  variant?: "label" | "value";
}) {
  const definition = METRIC_DEFINITIONS[metric];
  const tooltipId = React.useId();
  const triggerRef = React.useRef<HTMLSpanElement>(null);
  const [position, setPosition] = React.useState<MetricTooltipPosition | null>(null);

  const show = React.useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(380, Math.max(260, window.innerWidth - 24));
    const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12));
    const above = window.innerHeight - rect.bottom < 250 && rect.top > 250;
    setPosition({ left, top: above ? rect.top - 8 : rect.bottom + 8, width, above });
  }, []);

  const hide = React.useCallback(() => setPosition(null), []);

  React.useEffect(() => {
    if (!position) return undefined;
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      window.removeEventListener("resize", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, [hide, position]);

  const formulas = definition.formula ? (Array.isArray(definition.formula) ? definition.formula : [definition.formula]) : [];
  return (
    <>
      <span
        ref={triggerRef}
        className={`shop-daily-metric-help is-${variant}`}
        tabIndex={0}
        aria-describedby={position ? tooltipId : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        <span className="shop-daily-metric-help-content">{children ?? definition.label}</span>
        {variant === "label" ? <CircleHelp size={12} aria-hidden="true" /> : null}
      </span>
      {position ? createPortal(
        <div
          id={tooltipId}
          className={`shop-daily-metric-tooltip${position.above ? " is-above" : ""}`}
          role="tooltip"
          style={{ left: position.left, top: position.top, width: position.width }}
        >
          <strong>{definition.label}</strong>
          <section><b>数据来源</b><span>{definition.source}</span></section>
          {formulas.length ? <section><b>计算公式</b>{formulas.map((formula) => <code key={formula}>{formula}</code>)}</section> : null}
          {detail ? <section><b>当前数据</b><span>{detail}</span></section> : null}
          {definition.note ? <small>{definition.note}</small> : null}
        </div>,
        document.body,
      ) : null}
    </>
  );
}

function sourceName(value: string | undefined) {
  return value ? SOURCE_LABEL[value] || value : "";
}

function metricDetail(metric: MetricDefinitionKey, row: ShopDailyMetrics, currency: string) {
  const sourced = row as ShopDailyMetrics & {
    sources?: { revenue?: string; traffic?: string; ad?: string; review?: string; productCost?: string; operationFee?: string };
    ruleMode?: "standard" | "stacked";
  };
  const sourceFor = (key: keyof NonNullable<typeof sourced.sources>) => sourceName(sourced.sources?.[key]);
  const withSource = (value: string, ...sources: Array<string>) => {
    const names = [...new Set(sources.filter(Boolean))];
    return names.length ? `${value}；本行来源：${names.join("、")}` : value;
  };
  switch (metric) {
    case "payAmount": return withSource(`当前结果 ${fmtCny(row.payCny)}${row.payLocal === null ? "" : `（${fmtLocal(row.payLocal, currency)}）`}`, sourceFor("revenue"));
    case "impressions": return withSource(`当前结果 ${fmtNum(row.impressions)}`, sourceFor("traffic"));
    case "visitors": return withSource(`当前结果 ${fmtNum(row.visitors)}`, sourceFor("traffic"));
    case "orderCount": return withSource(`当前结果 ${fmtNum(row.orderCount)} 单`, sourceFor("revenue"));
    case "addToCart": return withSource(`当前结果 ${fmtNum(row.addToCart)} 人`, sourceFor("traffic"));
    case "review": return withSource(`当前 ${fmtNum(row.reviewCount)} 单；测评金额 ${fmtCny(row.reviewAmountCny)}；测评成本 ${fmtCny(row.reviewCostCny)}`, sourceFor("review"));
    case "realSales": return withSource(`${fmtCny(row.payCny)} − ${fmtCny(row.reviewAmountCny)} = ${fmtCny(row.realSalesCny)}；真实订单 ${fmtNum(row.realOrders)} 单`, sourceFor("revenue"), sourceFor("review"));
    case "adOnsite": return withSource(`当前结果 ${fmtCny(row.adOnsiteCny)}`, sourceFor("ad"));
    case "adOffsite": return withSource(`当前结果 ${fmtCny(row.adOffsiteCny)}`, sourceFor("ad"));
    case "roi": return `${fmtCny(row.realSalesCny)} ÷ ${fmtCny(row.adTotalCny)} = ${fmtRatio(row.roi)}`;
    case "visitRate": return `${fmtNum(row.visitors)} ÷ ${fmtNum(row.impressions)} = ${fmtPct(row.visitRate)}`;
    case "addToCartRate": return `${fmtNum(row.addToCart)} ÷ ${fmtNum(row.visitors)} = ${fmtPct(row.addToCartRate)}`;
    case "conversionRate": return `${fmtNum(row.realOrders)} ÷ ${fmtNum(row.visitors)} = ${fmtPct(row.conversionRate)}`;
    case "aov": return `${fmtCny(row.realSalesCny)} ÷ ${fmtNum(row.realOrders)} 单 = ${fmtCny(row.aovCny)}`;
    case "productCost": return withSource(`当前结果 ${fmtCny(row.productCostCny)}`, sourceFor("productCost"));
    case "operationFee": return withSource(`当前结果 ${fmtCny(row.operationFeeCny)}`, sourceFor("operationFee"));
    case "platformFee": return `${fmtCny(row.realSalesCny)} − ${fmtCny(row.adTotalCny)} − ${fmtCny(row.reviewCostCny)} − ${fmtCny(row.productCostCny)} − ${fmtCny(row.operationFeeCny)} − ${fmtCny(row.profitCny)} = ${fmtCny(row.platformFeeCny)}`;
    case "profit": return `当前结果 ${fmtCny(row.profitCny)}${sourced.ruleMode ? `；使用${sourced.ruleMode === "stacked" ? "叠乘" : "标准"}公式` : ""}`;
    case "profitMargin": return `${fmtCny(row.profitCny)} ÷ ${fmtCny(row.realSalesCny)} = ${fmtPct(row.profitMargin, 1)}`;
    default: return "";
  }
}

function MetricLabel({ metric, label, detail }: { metric: MetricDefinitionKey; label?: string; detail?: string }) {
  return <MetricExplain metric={metric} variant="label" detail={detail}>{label || METRIC_DEFINITIONS[metric].label}</MetricExplain>;
}

function MetricValue({ metric, row, currency, children }: { metric: MetricDefinitionKey; row: ShopDailyMetrics; currency: string; children: React.ReactNode }) {
  return <MetricExplain metric={metric} detail={metricDetail(metric, row, currency)}>{children}</MetricExplain>;
}

function MetricCells({ row, permissions, currency }: { row: ShopDailyMetrics; permissions: ShopDailyReportPayload["permissions"]; currency: string }) {
  return (
    <>
      <td className="num"><MetricValue metric="payAmount" row={row} currency={currency}><strong>{fmtCny(row.payCny)}</strong><small>{fmtLocal(row.payLocal, currency)}</small></MetricValue></td>
      <td className="num"><MetricValue metric="impressions" row={row} currency={currency}>{fmtNum(row.impressions)}</MetricValue></td>
      <td className="num"><MetricValue metric="visitors" row={row} currency={currency}>{fmtNum(row.visitors)}</MetricValue></td>
      <td className="num"><MetricValue metric="orderCount" row={row} currency={currency}>{fmtNum(row.orderCount)}</MetricValue></td>
      <td className="num"><MetricValue metric="addToCart" row={row} currency={currency}>{fmtNum(row.addToCart)}</MetricValue></td>
      <td className="num"><MetricValue metric="review" row={row} currency={currency}>{row.reviewCount ? <>{fmtNum(row.reviewCount)} 单{permissions.cost ? <small>{fmtCny(row.reviewCostCny)}</small> : null}</> : "—"}</MetricValue></td>
      <td className="num"><MetricValue metric="realSales" row={row} currency={currency}><strong>{fmtCny(row.realSalesCny)}</strong><small>{fmtNum(row.realOrders)} 单</small></MetricValue></td>
      <td className="num"><MetricValue metric="adOnsite" row={row} currency={currency}>{fmtCny(row.adOnsiteCny)}</MetricValue></td>
      <td className="num"><MetricValue metric="adOffsite" row={row} currency={currency}>{fmtCny(row.adOffsiteCny)}</MetricValue></td>
      <td className="num"><MetricValue metric="roi" row={row} currency={currency}><strong>{fmtRatio(row.roi)}</strong></MetricValue></td>
      <td className="num"><MetricValue metric="visitRate" row={row} currency={currency}>{fmtPct(row.visitRate)}</MetricValue></td>
      <td className="num"><MetricValue metric="addToCartRate" row={row} currency={currency}>{fmtPct(row.addToCartRate)}</MetricValue></td>
      <td className="num"><MetricValue metric="conversionRate" row={row} currency={currency}>{fmtPct(row.conversionRate)}</MetricValue></td>
      <td className="num"><MetricValue metric="aov" row={row} currency={currency}>{fmtCny(row.aovCny)}</MetricValue></td>
      {permissions.cost ? <>
        <td className="num"><MetricValue metric="productCost" row={row} currency={currency}>{fmtCny(row.productCostCny)}</MetricValue></td>
        <td className="num"><MetricValue metric="operationFee" row={row} currency={currency}>{fmtCny(row.operationFeeCny)}</MetricValue></td>
        <td className="num"><MetricValue metric="platformFee" row={row} currency={currency}>{fmtCny(row.platformFeeCny)}</MetricValue></td>
      </> : null}
      {permissions.profit ? <>
        <td className={`num ${Number(row.profitCny) < 0 ? "negative" : "positive"}`}><MetricValue metric="profit" row={row} currency={currency}><strong>{fmtCny(row.profitCny)}</strong></MetricValue></td>
        <td className="num"><MetricValue metric="profitMargin" row={row} currency={currency}>{fmtPct(row.profitMargin, 1)}</MetricValue></td>
      </> : null}
    </>
  );
}

export function ShopDailyReport({ filters }: { filters: Filters }) {
  const initialRange = React.useMemo(() => shopDailyDateRange("yesterday"), []);
  const [reportFilters, setReportFilters] = React.useState<Filters>(() => ({
    ...filters,
    ...shopDailyDateRange("yesterday"),
  }));
  const [dateDraft, setDateDraft] = React.useState(initialRange);
  const [payload, setPayload] = React.useState<ShopDailyReportPayload | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [section, setSection] = React.useState<Section>("report");
  const [view, setView] = React.useState<View>("shops");
  const [dataStatus, setDataStatus] = React.useState<DataStatus>("complete");
  const [tableFullscreen, setTableFullscreen] = React.useState(false);
  const [expandedShop, setExpandedShop] = React.useState("");
  const requestRef = React.useRef<AbortController | null>(null);
  // 逐日明细按需加载：按日明细 / 下载 CSV 取全部；展开某个店铺只取该店铺。
  const [detail, setDetail] = React.useState<{ key: string; rows: ShopDailyRow[] } | null>(null);
  const [shopDetail, setShopDetail] = React.useState<Record<string, ShopDailyRow[]>>({});
  const [detailLoading, setDetailLoading] = React.useState("");
  const [dayLimit, setDayLimit] = React.useState(DAY_PAGE_SIZE);
  const detailRequestRef = React.useRef<AbortController | null>(null);
  const [orderTarget, setOrderTarget] = React.useState<OrderDrilldownTarget | null>(null);
  const [orderPayload, setOrderPayload] = React.useState<ShopDailyOrderDrilldownPayload | null>(null);
  const [orderSearch, setOrderSearch] = React.useState("");
  const [orderPage, setOrderPage] = React.useState(1);
  const [orderLoading, setOrderLoading] = React.useState(false);
  const [orderError, setOrderError] = React.useState("");
  const [orderExporting, setOrderExporting] = React.useState(false);
  const orderRequestRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    if (!tableFullscreen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTableFullscreen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [tableFullscreen]);

  React.useEffect(() => {
    setReportFilters((current) => ({
      ...current,
      shopKey: filters.shopKey || "",
      projectGroup: filters.projectGroup || "",
      country: filters.country || "",
    }));
  }, [filters.shopKey, filters.projectGroup, filters.country]);

  React.useEffect(() => {
    setReportFilters((current) => ({ ...current, platform: filters.platform || "", salesChannel: filters.salesChannel || "" }));
  }, [filters.platform, filters.salesChannel]);

  const filterKey = JSON.stringify(reportFilters);
  const load = React.useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const next = await fetchShopDailyReport(reportFilters, controller.signal, { rows: false });
      setPayload(next);
      setDetail(null);
      setShopDetail({});
      setDayLimit(DAY_PAGE_SIZE);
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return;
      setError(requestError instanceof Error ? requestError.message : "店铺日报读取失败");
    } finally {
      if (requestRef.current === controller) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  React.useEffect(() => {
    void load();
    return () => requestRef.current?.abort();
  }, [load]);

  const loadDetail = React.useCallback(async (): Promise<ShopDailyRow[] | null> => {
    if (detail?.key === filterKey) return detail.rows;
    detailRequestRef.current?.abort();
    const controller = new AbortController();
    detailRequestRef.current = controller;
    setDetailLoading("all");
    try {
      const next = await fetchShopDailyReport(reportFilters, controller.signal);
      setDetail({ key: filterKey, rows: next.rows || [] });
      return next.rows || [];
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return null;
      setError(requestError instanceof Error ? requestError.message : "逐日明细读取失败");
      return null;
    } finally {
      if (detailRequestRef.current === controller) setDetailLoading("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, detail]);

  React.useEffect(() => {
    if (view === "days" && section === "report" && payload && payload.rowCount !== undefined && !payload.rowsIncluded && detail?.key !== filterKey) void loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, section, payload, filterKey, detail?.key]);

  async function toggleShop(shopKey: string) {
    if (expandedShop === shopKey) {
      setExpandedShop("");
      return;
    }
    setExpandedShop(shopKey);
    if (detail?.key === filterKey || inlineRows || shopDetail[shopKey]) return;
    setDetailLoading(shopKey);
    try {
      const next = await fetchShopDailyReport({ ...reportFilters, shopKey });
      setShopDetail((current) => ({ ...current, [shopKey]: next.rows || [] }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "店铺明细读取失败");
    } finally {
      setDetailLoading((current) => (current === shopKey ? "" : current));
    }
  }

  React.useEffect(() => {
    if (!orderTarget) {
      orderRequestRef.current?.abort();
      return;
    }
    const timer = window.setTimeout(() => {
      orderRequestRef.current?.abort();
      const controller = new AbortController();
      orderRequestRef.current = controller;
      setOrderLoading(true);
      setOrderError("");
      void fetchShopDailyOrders({
        dateFrom: orderTarget.dateFrom,
        dateTo: orderTarget.dateTo,
        shopKey: orderTarget.shopKey,
        platform: orderTarget.platform,
        search: orderSearch,
        page: orderPage,
        pageSize: 30,
      }, controller.signal).then(setOrderPayload).catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setOrderError(requestError instanceof Error ? requestError.message : "订单明细读取失败");
      }).finally(() => {
        if (orderRequestRef.current === controller) setOrderLoading(false);
      });
    }, orderSearch ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [orderTarget, orderSearch, orderPage]);

  const permissions = payload?.permissions || { view: false, edit: false, cost: false, profit: false, manageRules: false };
  const totals = payload?.totals;
  const quality = payload?.quality;
  const singleCurrency = (payload?.currencies.length || 0) <= 1 ? payload?.currencies[0] || "" : "";
  const completeShopRows = payload?.shops || [];
  const incompleteShopRows = payload?.incompleteShops || [];
  const shopRows = dataStatus === "complete" ? completeShopRows : incompleteShopRows;
  // 兼容旧后端：若主请求已带明细（rowsIncluded 或没有 rowCount 字段），直接用。
  const inlineRows = payload && (payload.rowsIncluded || payload.rowCount === undefined) ? payload.rows || [] : null;
  const allDayRows = detail?.key === filterKey ? detail.rows : inlineRows || [];
  const dayRows = allDayRows.filter((row) => (row.dataStatus || "complete") === dataStatus);
  const dayRowCount = dataStatus === "complete"
    ? payload?.completeRowCount ?? quality?.completeRows ?? dayRows.length
    : payload?.incompleteRowCount ?? quality?.incompleteRows ?? dayRows.length;
  const activeDatePreset = matchingShopDailyPreset(reportFilters.dateFrom || "", reportFilters.dateTo || "");
  const activePlatformKey = reportFilters.platform ? normalizedPlatformKey(reportFilters.platform) : "all";
  const tiktok = payload?.tiktok;
  const showTikTokPanel = activePlatformKey === "tiktok" || Boolean(tiktok?.available);
  const platformOptions = React.useMemo<PlatformOption[]>(() => {
    const counts = new Map<string, number>();
    const values = new Map<string, string>();
    for (const shop of payload?.options.shops || []) {
      const key = normalizedPlatformKey(shop.platform);
      if (!shop.platform) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
      if (!values.has(key)) values.set(key, shop.platform);
    }
    for (const value of payload?.options.platforms || []) {
      const key = normalizedPlatformKey(value);
      if (!values.has(key)) values.set(key, value);
    }
    if (reportFilters.platform) values.set(activePlatformKey, reportFilters.platform);
    const order = ["shopee", "tiktok", "tokopedia", "lazada", "ozon"];
    return [...values.entries()].map(([key, value]) => {
      const presentation = platformPresentation(value);
      return { ...presentation, value, count: counts.get(key) || 0 };
    }).sort((left, right) => {
      const leftIndex = order.indexOf(left.key);
      const rightIndex = order.indexOf(right.key);
      if (leftIndex !== rightIndex) return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex);
      return left.label.localeCompare(right.label, "zh-CN");
    });
  }, [payload?.generatedAt, reportFilters.platform, activePlatformKey]);
  const availableShopOptions = React.useMemo(() => (payload?.options.shops || []).filter((shop) => {
    if (reportFilters.projectGroup && shop.projectGroup !== reportFilters.projectGroup) return false;
    if (reportFilters.platform && normalizedPlatformKey(shop.platform) !== activePlatformKey) return false;
    if (reportFilters.country && shop.country !== reportFilters.country) return false;
    return true;
  }), [payload?.generatedAt, reportFilters.projectGroup, reportFilters.platform, reportFilters.country, activePlatformKey]);
  const rowsByShop = React.useMemo(() => {
    const map = new Map<string, ShopDailyRow[]>();
    for (const [shopKey, rows] of Object.entries(shopDetail)) map.set(shopKey, rows);
    for (const row of dayRows) {
      const list = map.get(row.shopKey) || [];
      if (!shopDetail[row.shopKey]) list.push(row);
      map.set(row.shopKey, list);
    }
    return map;
  }, [dayRows, shopDetail]);

  async function exportCsv() {
    const allRows = inlineRows && payload?.rowCount === undefined ? inlineRows : await loadDetail();
    if (!allRows) return;
    const selectedRows = allRows.filter((row) => (row.dataStatus || "complete") === dataStatus);
    const header = ["日期", "店铺", "国家", "平台", "销售渠道", "购买渠道", "统计时区", "口径版本", "来源完整度", "缺失模块", "项目组", "数据状态", "币种", "汇率(本币/人民币)", "支付金额(本币)", "支付金额(人民币)", "展示数", "访客数", "订单数", "加购人数", "测评数量", "测评金额(人民币)", "实际收款(人民币)",
      ...(permissions.cost ? ["测评成本"] : []), "真实成交(人民币)", "真实订单数", "站内推广费(人民币)", "站外推广费(人民币)", "总推广费(人民币)", "ROI", "点击率", "加购率", "转化率", "客单价(人民币)",
      "TikTok买家数", "卖家自营GMV(人民币)", "联盟达人GMV(人民币)", "商品卡GMV(人民币)", "短视频GMV(人民币)", "直播GMV(人民币)", "未归因GMV(人民币)", "广告花费(人民币)", "广告归因成交额(人民币)", "退款金额(人民币)", "取消金额(人民币)", "期末库存",
      ...(permissions.cost ? ["产品成本", "操作费", "平台扣费"] : []), ...(permissions.profit ? ["利润预估", "利润率"] : []), "支付金额来源", "提示"];
    const lines = selectedRows.map((row) => [
      row.date, row.shopName, row.country, row.platform, (row.salesChannels?.length ? row.salesChannels : [row.salesChannel]).filter(Boolean).map((value) => salesChannelLabel(String(value))).join(" / "), row.purchaseChannel || "", row.timezone || "", row.definitionVersion || "", row.sourceDataStatus || "", (row.missingModules || []).join(" / "), row.projectGroup, row.dataStatus === "incomplete" ? "待补数据" : "完整数据", row.currency, row.localPerCny, row.payLocal ?? "", row.payCny, row.impressions, row.visitors, row.orderCount, row.addToCart, row.reviewCount, row.reviewAmountCny, row.reviewReceivedCny,
      ...(permissions.cost ? [row.reviewCostCny] : []), row.realSalesCny, row.realOrders, row.adOnsiteCny, row.adOffsiteCny, row.adTotalCny, row.roi ?? "", row.visitRate ?? "", row.addToCartRate ?? "", row.conversionRate ?? "", row.aovCny ?? "",
      row.buyerCount ?? "", row.sellerGmvCny ?? "", row.affiliateGmvCny ?? "", row.productCardGmvCny ?? "", row.videoGmvCny ?? "", row.liveGmvCny ?? "", row.unattributedGmvCny ?? "", row.adsCostCny ?? "", row.adsGrossRevenueCny ?? "", row.refundAmountCny ?? "", row.cancelAmountCny ?? "", row.stockOnHand ?? "",
      ...(permissions.cost ? [row.productCostCny, row.operationFeeCny, row.platformFeeCny] : []), ...(permissions.profit ? [row.profitCny, row.profitMargin ?? ""] : []),
      SOURCE_LABEL[row.sources.revenue] || row.sources.revenue, row.flags.map((flag) => FLAG_LABEL[flag] || flag).join(" / "),
    ]);
    downloadCsv(`店铺日报-${dataStatus === "complete" ? "完整数据" : "待补数据"}-${payload?.filters.dateFrom || ""}-${payload?.filters.dateTo || ""}.csv`, header, lines);
  }

  function openOrderDrilldown(target: OrderDrilldownTarget) {
    setOrderTarget(target);
    setOrderPayload(null);
    setOrderSearch("");
    setOrderPage(1);
    setOrderError("");
  }

  function closeOrderDrilldown() {
    orderRequestRef.current?.abort();
    setOrderTarget(null);
    setOrderPayload(null);
    setOrderSearch("");
    setOrderError("");
  }

  async function exportOrderDetails() {
    if (!orderTarget || orderExporting) return;
    setOrderExporting(true);
    setOrderError("");
    try {
      const allOrders: ShopDailyOrder[] = [];
      let page = 1;
      let pageCount = 1;
      do {
        const result = await fetchShopDailyOrders({
          dateFrom: orderTarget.dateFrom,
          dateTo: orderTarget.dateTo,
          shopKey: orderTarget.shopKey,
          platform: orderTarget.platform,
          search: orderSearch,
          page,
          pageSize: 200,
        });
        allOrders.push(...result.orders);
        pageCount = result.pageCount;
        page += 1;
      } while (page <= pageCount && allOrders.length < 20_000);
      const header = ["日期", "平台订单号", "店铺", "平台", "状态", "商品明细", "商品数量", "支付金额(本币)", "币种", "成交额(人民币)", "数据来源",
        ...(permissions.cost ? ["产品成本(人民币)", "打包费(人民币)"] : [])];
      const lines = allOrders.map((order) => [
        order.orderDate,
        order.orderNo,
        order.shopName,
        order.platform,
        order.status,
        order.items.map((item) => `${item.sku || "无SKU"} ${item.productName} ×${fmtNum(item.quantity)}`).join("；"),
        order.quantity,
        order.salesAmount,
        order.currency,
        order.salesCny,
        order.sourceSystem,
        ...(permissions.cost ? [order.productCostCny ?? "", order.packagingFeeCny ?? ""] : []),
      ]);
      downloadCsv(`店铺订单-${orderTarget.shopName}-${orderTarget.dateFrom}-${orderTarget.dateTo}.csv`, header, lines);
    } catch (requestError) {
      setOrderError(requestError instanceof Error ? requestError.message : "订单导出失败");
    } finally {
      setOrderExporting(false);
    }
  }

  async function clearMetric(row: ShopDailyRow) {
    if (!window.confirm(`清除「${row.shopName}」${row.date} 的导入数据？中台订单数据不受影响。`)) return;
    try {
      await deleteShopDailyMetric(row.shopKey, row.date);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "清除失败");
    }
  }

  function selectDatePreset(preset: ShopDailyDatePreset) {
    const range = shopDailyDateRange(preset);
    setDateDraft(range);
    setError("");
    setReportFilters((current) => ({ ...current, ...range }));
  }

  function applyCustomDateRange() {
    if (!dateDraft.dateFrom || !dateDraft.dateTo) {
      setError("请选择完整的开始和结束日期。");
      return;
    }
    if (dateDraft.dateFrom > dateDraft.dateTo) {
      setError("开始日期不能晚于结束日期。");
      return;
    }
    setError("");
    setReportFilters((current) => ({ ...current, ...dateDraft }));
  }

  function selectPlatform(value: string) {
    setError("");
    setExpandedShop("");
    setReportFilters((current) => {
      const selectedShop = (payload?.options.shops || []).find((shop) => shop.value === current.shopKey);
      const keepShop = !value || !selectedShop || normalizedPlatformKey(selectedShop.platform) === normalizedPlatformKey(value);
      return { ...current, platform: value, salesChannel: normalizedPlatformKey(value) === "tiktok" ? current.salesChannel : "", shopKey: keepShop ? current.shopKey : "" };
    });
  }

  function selectProjectGroup(value: string) {
    setError("");
    setExpandedShop("");
    setReportFilters((current) => {
      const selectedShop = (payload?.options.shops || []).find((shop) => shop.value === current.shopKey);
      const keepShop = !value || !selectedShop || selectedShop.projectGroup === value;
      return { ...current, projectGroup: value, shopKey: keepShop ? current.shopKey : "" };
    });
  }

  function selectShop(value: string) {
    setError("");
    setExpandedShop("");
    setReportFilters((current) => ({ ...current, shopKey: value }));
  }

  function selectDataStatus(value: DataStatus) {
    setDataStatus(value);
    setExpandedShop("");
    setDayLimit(DAY_PAGE_SIZE);
  }

  const headCells = (
    <>
      {BASE_METRIC_HEADERS.map((metric) => <th key={metric}><MetricLabel metric={metric} /></th>)}
      {permissions.cost ? COST_METRIC_HEADERS.map((metric) => <th key={metric}><MetricLabel metric={metric} /></th>) : null}
      {permissions.profit ? PROFIT_METRIC_HEADERS.map((metric) => <th key={metric}><MetricLabel metric={metric} /></th>) : null}
    </>
  );

  return (
    <div className="shop-daily">
      <div className="shop-daily-head">
        <div>
          <span className="shop-daily-eyebrow">SHOP DAILY</span>
          <h3>店铺日报</h3>
          <p>一行一个店铺一天。订单、成交额和成本取自中台；流量、推广费和测评通过导入或紫鸟采集写入；汇率与利润公式按「费率规则」统一计算。</p>
        </div>
        <div className="shop-daily-actions">
          <button className="ghost-button" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} />{loading ? "计算中" : "刷新"}</button>
          <button className="ghost-button" type="button" onClick={() => void exportCsv()} disabled={!dayRowCount || detailLoading === "all"}><Download size={15} />{detailLoading === "all" ? "准备中…" : "下载 CSV"}</button>
        </div>
      </div>

      <div className="shop-daily-sections" role="tablist">
        <button className={section === "report" ? "active" : ""} type="button" onClick={() => setSection("report")}><Store size={15} />日报</button>
        {permissions.edit ? <button className={section === "import" ? "active" : ""} type="button" onClick={() => setSection("import")}><FileUp size={15} />导入数据</button> : null}
        {permissions.edit ? <button className={section === "reviews" ? "active" : ""} type="button" onClick={() => setSection("reviews")}><ListChecks size={15} />测评登记 <span>{payload?.reviewOrders.length || 0}</span></button> : null}
        {permissions.cost ? <button className={section === "rules" ? "active" : ""} type="button" onClick={() => setSection("rules")}><Settings size={15} />费率规则 <span>{payload?.rules.length || 0}</span></button> : null}
      </div>

      {error ? <div className="notice shop-daily-error">{error}</div> : null}

      {section === "report" ? (
        <>
          <section className="shop-daily-filter-console" aria-label="店铺日报快捷筛选">
            <div className="shop-daily-filter-row date-row">
              <div className="shop-daily-filter-title">
                <CalendarDays size={18} />
                <span><strong>统计周期</strong><small>默认查看昨天的完整日报</small></span>
              </div>
              <div className="shop-daily-period-presets" role="group" aria-label="快捷日期范围">
                {SHOP_DAILY_DATE_PRESETS.map((preset) => (
                  <button
                    className={activeDatePreset === preset.value ? "active" : ""}
                    type="button"
                    key={preset.value}
                    aria-pressed={activeDatePreset === preset.value}
                    onClick={() => selectDatePreset(preset.value)}
                  >{preset.label}</button>
                ))}
              </div>
              <div className="shop-daily-custom-range">
                <label><span>开始日期</span><input type="date" value={dateDraft.dateFrom} onChange={(event) => setDateDraft((current) => ({ ...current, dateFrom: event.target.value }))} /></label>
                <i>至</i>
                <label><span>结束日期</span><input type="date" value={dateDraft.dateTo} onChange={(event) => setDateDraft((current) => ({ ...current, dateTo: event.target.value }))} /></label>
                <button className="ghost-button" type="button" onClick={applyCustomDateRange}>查询</button>
              </div>
            </div>
            <div className="shop-daily-filter-row platform-row">
              <div className="shop-daily-filter-title">
                <Store size={18} />
                <span><strong>销售平台</strong><small>按平台重算全部经营指标</small></span>
              </div>
              <div className="shop-daily-platform-presets" role="group" aria-label="快捷平台筛选">
                <button className={activePlatformKey === "all" ? "active" : ""} type="button" aria-pressed={activePlatformKey === "all"} onClick={() => selectPlatform("")}>
                  <span className="shop-daily-platform-mark is-all" aria-hidden="true">ALL</span>
                  <span><strong>全部平台</strong><small>{payload?.options.shops.length || 0} 家店铺</small></span>
                </button>
                {platformOptions.map((option) => (
                  <button className={activePlatformKey === option.key ? "active" : ""} type="button" key={option.key} aria-pressed={activePlatformKey === option.key} onClick={() => selectPlatform(option.value)}>
                    <PlatformMark platform={option.value} />
                    <span><strong>{option.label}</strong><small>{option.count} 家店铺</small></span>
                  </button>
                ))}
              </div>
            </div>
            <div className="shop-daily-filter-row scope-row">
              <div className="shop-daily-filter-title">
                <Search size={18} />
                <span><strong>归属与店铺</strong><small>可组合筛选，指标会同步重算</small></span>
              </div>
              <div className="shop-daily-scope-controls">
                <label>
                  <span>项目组</span>
                  <select value={reportFilters.projectGroup || ""} onChange={(event) => selectProjectGroup(event.target.value)}>
                    <option value="">全部项目组</option>
                    {(payload?.options.projectGroups || []).map((group) => <option key={group} value={group}>{group}</option>)}
                  </select>
                </label>
                <label className="shop-select">
                  <span>店铺</span>
                  <select value={reportFilters.shopKey || ""} onChange={(event) => selectShop(event.target.value)}>
                    <option value="">全部店铺（{availableShopOptions.length}）</option>
                    {availableShopOptions.map((shop) => (
                      <option key={shop.value} value={shop.value}>{shop.label}{[shop.platform, shop.country].filter(Boolean).length ? ` · ${[shop.platform, shop.country].filter(Boolean).join(" / ")}` : ""}</option>
                    ))}
                  </select>
                </label>
                {(activePlatformKey === "tiktok" || Boolean(payload?.options.salesChannels?.length)) ? (
                  <label>
                    <span>销售渠道</span>
                    <select value={reportFilters.salesChannel || ""} onChange={(event) => setReportFilters((current) => ({ ...current, salesChannel: event.target.value }))}>
                      <option value="">全部销售渠道</option>
                      {(payload?.options.salesChannels || []).map((channel) => <option key={channel} value={channel}>{salesChannelLabel(channel)}</option>)}
                    </select>
                  </label>
                ) : null}
                {(reportFilters.projectGroup || reportFilters.shopKey || reportFilters.salesChannel) ? (
                  <button className="ghost-button" type="button" onClick={() => setReportFilters((current) => ({ ...current, projectGroup: "", shopKey: "", salesChannel: "" }))}>清除筛选</button>
                ) : null}
              </div>
            </div>
          </section>

          <div className="shop-daily-summary-scope"><ListChecks size={15} /><span>经营合计仅统计 <b>{fmtNum(quality?.completeRows)}</b> 行完整数据；待补数据单独查看，不参与下方指标与利润。</span></div>

          <div className="shop-daily-kpis">
            <article><small><MetricLabel metric="payAmount" detail={totals ? metricDetail("payAmount", totals, singleCurrency) : undefined} /></small><b>{fmtCny(totals?.payCny)}</b><span>{fmtNum(totals?.orderCount)} 单</span></article>
            <article><small><MetricLabel metric="realSales" detail={totals ? metricDetail("realSales", totals, singleCurrency) : undefined} /></small><b>{fmtCny(totals?.realSalesCny)}</b><span>{fmtNum(totals?.realOrders)} 单 · 客单 {fmtCny(totals?.aovCny)}</span></article>
            <article><small><MetricLabel metric="adTotal" detail={totals ? `${fmtCny(totals.adOnsiteCny)} + ${fmtCny(totals.adOffsiteCny)} = ${fmtCny(totals.adTotalCny)}；ROI ${fmtRatio(totals.roi)}` : undefined} /></small><b>{fmtCny(totals?.adTotalCny)}</b><span>ROI {fmtRatio(totals?.roi)}</span></article>
            <article><small><MetricLabel metric="trafficSummary" detail={totals ? `${fmtNum(totals.realOrders)} ÷ ${fmtNum(totals.visitors)} = ${fmtPct(totals.conversionRate)}；${fmtNum(totals.addToCart)} ÷ ${fmtNum(totals.visitors)} = ${fmtPct(totals.addToCartRate)}` : undefined} /></small><b>{fmtNum(totals?.visitors)}</b><span>转化 {fmtPct(totals?.conversionRate)} · 加购 {fmtPct(totals?.addToCartRate)}</span></article>
            {permissions.cost ? <article><small><MetricLabel metric="reviewCost" detail={totals ? `当前 ${fmtNum(totals.reviewCount)} 单；测评损失 ${fmtCny(totals.reviewLossCny)}；测评成本 ${fmtCny(totals.reviewCostCny)}` : undefined} /></small><b>{fmtCny(totals?.reviewCostCny)}</b><span>{fmtNum(totals?.reviewCount)} 单</span></article> : null}
            {permissions.profit ? <article className={Number(totals?.profitCny) < 0 ? "negative" : "positive"}><small><MetricLabel metric="profit" detail={totals ? metricDetail("profit", totals, singleCurrency) : undefined} /></small><b>{fmtCny(totals?.profitCny)}</b><span>利润率 {fmtPct(totals?.profitMargin, 1)}</span></article> : null}
          </div>

          {showTikTokPanel ? (
            <section className="shop-daily-tiktok" aria-label="TikTok 经营拆解">
              <header>
                <div><PlatformMark platform="tiktok" /><span><strong>TikTok 经营拆解</strong><small>店铺成交、订单来源、内容归因和广告口径分开统计</small></span></div>
                <div className="shop-daily-tiktok-status">
                  <span className={tiktok?.dataStatus === "COMPLETE" ? "is-complete" : "is-partial"}>{tiktok?.dataStatus === "COMPLETE" ? "数据完整" : "数据待补"}</span>
                  {(tiktok?.channels || []).map((channel) => <em key={channel}>{salesChannelLabel(channel)}</em>)}
                </div>
              </header>
              {tiktok?.missingModules?.length ? <div className="shop-daily-tiktok-warning"><AlertTriangle size={15} />缺少：{tiktok.missingModules.join("、")}。缺失数据以“—”展示，不按 0 参与判断。</div> : null}
              <div className="shop-daily-tiktok-grid">
                <article><small>业务大盘</small><b>{fmtCny(tiktok?.business.gmvCny)}</b><span>{fmtNum(tiktok?.business.orders)} 单 · {fmtNum(tiktok?.business.buyers)} 位买家</span><p>退款 {fmtCny(tiktok?.business.refundCny)} · 取消 {fmtCny(tiktok?.business.cancelCny)} · 库存 {fmtNum(tiktok?.business.stockOnHand)}</p></article>
                <article><small>订单来源</small><b>{fmtCny(tiktok?.source.sellerGmvCny)}</b><span>卖家自营</span><p>联盟达人 {fmtCny(tiktok?.source.affiliateGmvCny)}</p></article>
                <article><small>内容归因</small><b>{fmtCny(tiktok?.content.videoGmvCny)}</b><span>短视频成交</span><p>商品卡 {fmtCny(tiktok?.content.productCardGmvCny)} · 直播 {fmtCny(tiktok?.content.liveGmvCny)} · 未归因 {fmtCny(tiktok?.content.unattributedGmvCny)}</p></article>
                <article><small>广告口径（不重复计入 GMV）</small><b>{fmtCny(tiktok?.ads.costCny)}</b><span>广告花费 · ROAS {fmtRatio(tiktok?.ads.roas)}</span><p>广告归因成交 {fmtCny(tiktok?.ads.grossRevenueCny)}</p></article>
              </div>
              <footer>印尼店铺按 TikTok Shop / Tokopedia 渠道先去重、再汇总；广告归因成交额仅用于评估广告，不与店铺 GMV 相加。</footer>
            </section>
          ) : null}

          {quality && (quality.incompleteRows || quality.rowsUsingSystemRevenue || quality.rowsWithoutTraffic || quality.rowsWithoutAd || quality.rowsWithoutRate || quality.reviewOrdersWithoutAmount || quality.standaloneShopCount) ? (
            <div className="shop-daily-quality">
              <AlertTriangle size={16} />
              <span>
                {quality.incompleteRows ? `${quality.incompleteRows} 行关键数据待补，已从经营合计中排除；` : ""}
                {quality.rowsUsingSystemRevenue ? `${quality.rowsUsingSystemRevenue} 行未导入平台支付金额，暂用中台出库订单；` : ""}
                {quality.rowsWithoutTraffic ? `${quality.rowsWithoutTraffic} 行未填展示/访客/加购；` : ""}
                {quality.rowsWithoutAd ? `${quality.rowsWithoutAd} 行未填推广费（没有投放可忽略）；` : ""}
                {quality.rowsWithoutRate ? `${quality.rowsWithoutRate} 行缺汇率；` : ""}
                {quality.reviewOrdersWithoutAmount ? `${quality.reviewOrdersWithoutAmount} 条测评订单找不到金额；` : ""}
                {quality.reviewOrdersWithoutReceived ? `${quality.reviewOrdersWithoutReceived} 条测评订单未填实际收款；` : ""}
                {quality.standaloneShopCount ? `${quality.standaloneShopCount} 个店铺在中台订单中尚未出现。` : ""}
              </span>
            </div>
          ) : null}

          <div className={`shop-daily-table-shell ${tableFullscreen ? "is-fullscreen" : ""}`}>
            <div className="shop-daily-table-toolbar">
              <div className="shop-daily-view-toggle">
                <button className={view === "shops" ? "active" : ""} type="button" onClick={() => setView("shops")}>按店铺汇总 <span>{shopRows.length}</span></button>
                <button className={view === "days" ? "active" : ""} type="button" onClick={() => setView("days")}>按日明细 <span>{dayRowCount}</span></button>
              </div>
              <div className="shop-daily-data-toggle" role="group" aria-label="数据完整性筛选">
                <button className={dataStatus === "complete" ? "active complete" : ""} type="button" onClick={() => selectDataStatus("complete")}>完整数据 <span>{quality?.completeRows || 0}</span></button>
                <button className={dataStatus === "incomplete" ? "active incomplete" : ""} type="button" onClick={() => selectDataStatus("incomplete")}>待补数据 <span>{quality?.incompleteRows || 0}</span></button>
              </div>
              <small className="shop-daily-table-range">{payload ? `${payload.filters.dateFrom} 至 ${payload.filters.dateTo}` : `${reportFilters.dateFrom || ""} 至 ${reportFilters.dateTo || ""}`}{payload?.materializationStale ? " · 中台订单正在后台更新" : ""}</small>
              <button className="shop-daily-fullscreen-button" type="button" onClick={() => setTableFullscreen((current) => !current)} aria-label={tableFullscreen ? "退出全屏" : "全屏查看数据表"} title={tableFullscreen ? "退出全屏（Esc）" : "全屏查看数据表"}>
                {tableFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}{tableFullscreen ? "退出全屏" : "全屏"}
              </button>
            </div>

            <div className="shop-daily-table-wrap">
            <table className="shop-daily-table">
              <thead><tr><th className="sticky">{view === "shops" ? "店铺" : "日期 / 店铺"}</th>{headCells}{view === "days" && permissions.edit ? <th /> : null}</tr></thead>
              <tbody>
                {view === "shops" ? shopRows.map((shop: ShopDailyShopSummary) => (
                  <React.Fragment key={shop.shopKey}>
                    <tr className={`shop-row ${dataStatus === "incomplete" ? "is-incomplete" : ""}`} onClick={() => void toggleShop(shop.shopKey)}>
                      <td className="sticky">
                        <strong>{shop.shopName}</strong>
                        <small>{[shop.platform, shop.country, shop.projectGroup].filter(Boolean).join(" · ")} · {dataStatus === "complete" ? `完整 ${shop.days} 天${shop.incompleteDays ? ` · 待补 ${shop.incompleteDays} 天` : ""}` : `待补 ${shop.days} 天 · 已排除出合计${shop.completeDays ? ` · 另有完整 ${shop.completeDays} 天` : ""}`}{shop.standaloneShop ? " · 未匹配中台" : ""}</small>
                        <span className="shop-daily-flags">{Object.entries(shop.flagCounts).map(([flag, count]) => <i key={flag}>{FLAG_LABEL[flag] || flag} {count}</i>)}</span>
                        <button className="shop-daily-order-link" type="button" onClick={(event) => {
                          event.stopPropagation();
                          openOrderDrilldown({
                            shopKey: shop.shopKey,
                            shopName: shop.shopName,
                            platform: shop.platform,
                            dateFrom: payload?.filters.dateFrom || reportFilters.dateFrom || "",
                            dateTo: payload?.filters.dateTo || reportFilters.dateTo || "",
                            label: `${payload?.filters.dateFrom || reportFilters.dateFrom || ""} 至 ${payload?.filters.dateTo || reportFilters.dateTo || ""}`,
                          });
                        }}><PackageSearch size={14} />查看具体订单 <b>{fmtNum(shop.systemOrderCount)}</b></button>
                      </td>
                      <MetricCells row={shop} permissions={permissions} currency={shop.currency} />
                    </tr>
                    {expandedShop === shop.shopKey && detailLoading === shop.shopKey ? (
                      <tr className="day-row"><td className="sticky"><small>正在读取逐日明细…</small></td></tr>
                    ) : null}
                    {expandedShop === shop.shopKey ? (rowsByShop.get(shop.shopKey) || []).filter((row) => (row.dataStatus || "complete") === dataStatus).map((row) => (
                      <tr className={`day-row ${row.dataStatus === "incomplete" ? "is-incomplete" : ""}`} key={`${row.shopKey}-${row.date}`}>
                        <td className="sticky"><span>{row.date}</span><small>收入来源：{SOURCE_LABEL[row.sources.revenue] || row.sources.revenue}</small>
                          <button className="shop-daily-order-link compact" type="button" onClick={() => openOrderDrilldown({ shopKey: row.shopKey, shopName: row.shopName, platform: row.platform, dateFrom: row.date, dateTo: row.date, label: row.date })}><PackageSearch size={13} />订单 {fmtNum(row.systemOrderCount)}</button>
                        </td>
                        <MetricCells row={row} permissions={permissions} currency={row.currency} />
                      </tr>
                    )) : null}
                  </React.Fragment>
                )) : dayRows.slice(0, dayLimit).map((row) => (
                  <tr className={row.dataStatus === "incomplete" ? "is-incomplete" : ""} key={`${row.shopKey}-${row.date}`}>
                    <td className="sticky">
                      <strong>{row.date} · {row.shopName}</strong>
                      <small>{row.currency} {row.localPerCny ? `1¥=${fmtNum(row.localPerCny)}` : ""} · 收入来源 {SOURCE_LABEL[row.sources.revenue] || row.sources.revenue}</small>
                      <span className="shop-daily-flags">{row.flags.map((flag) => <i key={flag}>{FLAG_LABEL[flag] || flag}</i>)}</span>
                      <button className="shop-daily-order-link compact" type="button" onClick={() => openOrderDrilldown({ shopKey: row.shopKey, shopName: row.shopName, platform: row.platform, dateFrom: row.date, dateTo: row.date, label: row.date })}><PackageSearch size={13} />查看 {fmtNum(row.systemOrderCount)} 笔订单</button>
                    </td>
                    <MetricCells row={row} permissions={permissions} currency={row.currency} />
                    {permissions.edit ? <td>{row.updatedAt ? <button className="shop-daily-icon" type="button" title="清除这一天的导入数据" onClick={() => void clearMetric(row)}><Trash2 size={14} /></button> : null}</td> : null}
                  </tr>
                ))}
              </tbody>
              {dataStatus === "complete" && totals && (view === "shops" ? shopRows.length : dayRowCount) ? (
                <tfoot><tr><td className="sticky"><strong>合计</strong><small>比率按合计重新计算</small></td><MetricCells row={totals} permissions={permissions} currency={singleCurrency} />{view === "days" && permissions.edit ? <td /> : null}</tr></tfoot>
              ) : null}
            </table>
            {view === "days" && detailLoading === "all" ? <div className="shop-daily-empty"><p>正在读取逐日明细…</p></div> : null}
            {view === "days" && dayRows.length > dayLimit ? (
              <div className="shop-daily-empty">
                <p>已显示 {dayLimit} / {dayRows.length} 行</p>
                <button className="ghost-button" type="button" onClick={() => setDayLimit((current) => current + DAY_PAGE_SIZE * 5)}>再显示 {Math.min(DAY_PAGE_SIZE * 5, dayRows.length - dayLimit)} 行</button>
              </div>
            ) : null}
            {!loading && !dayRowCount ? (
              <div className="shop-daily-empty">
                <Store size={30} />
                <h4>{dataStatus === "complete" ? "当前筛选范围暂无完整日报数据" : "当前筛选范围没有待补数据"}</h4>
                <p>{dataStatus === "complete" ? "可切换到「待补数据」查看缺口，或调整上方日期和店铺筛选。" : "当前范围的数据均已满足经营合计口径。"}</p>
              </div>
            ) : null}
            </div>
          </div>
        </>
      ) : section === "import" ? (
        <ImportPanel payload={payload} onImported={load} />
      ) : section === "reviews" ? (
        <ReviewPanel payload={payload} onChanged={load} />
      ) : (
        <RulesPanel payload={payload} onSaved={load} />
      )}
      {orderTarget ? (
        <OrderDrilldownDrawer
          target={orderTarget}
          payload={orderPayload}
          permissions={permissions}
          loading={orderLoading}
          error={orderError}
          search={orderSearch}
          page={orderPage}
          exporting={orderExporting}
          onClose={closeOrderDrilldown}
          onSearch={(value) => { setOrderSearch(value); setOrderPage(1); }}
          onPage={setOrderPage}
          onExport={() => void exportOrderDetails()}
        />
      ) : null}
    </div>
  );
}

function OrderDrilldownDrawer({
  target,
  payload,
  permissions,
  loading,
  error,
  search,
  page,
  exporting,
  onClose,
  onSearch,
  onPage,
  onExport,
}: {
  target: OrderDrilldownTarget;
  payload: ShopDailyOrderDrilldownPayload | null;
  permissions: ShopDailyReportPayload["permissions"];
  loading: boolean;
  error: string;
  search: string;
  page: number;
  exporting: boolean;
  onClose: () => void;
  onSearch: (value: string) => void;
  onPage: (page: number) => void;
  onExport: () => void;
}) {
  const shopUrl = safeExternalUrl(payload?.orders.find((order) => order.shopUrl)?.shopUrl);
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="shop-daily-order-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="shop-daily-order-drawer" role="dialog" aria-modal="true" aria-label={`${target.shopName}订单明细`}>
        <header>
          <div className="shop-daily-order-heading">
            <span className="shop-daily-eyebrow">ORDER DRILLDOWN</span>
            <h3>{target.shopName}</h3>
            <p><PlatformMark platform={target.platform} /> {target.platform || "未知平台"} · {target.label}</p>
            {shopUrl ? <a className="shop-daily-shop-link" href={shopUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />打开店铺</a> : null}
          </div>
          <button className="shop-daily-drawer-close" type="button" onClick={onClose} aria-label="关闭订单明细"><X size={20} /></button>
        </header>

        <div className="shop-daily-order-summary">
          <article><small><MetricLabel metric="syncedOrders" detail={payload ? `当前范围去重后共 ${fmtNum(payload.total)} 笔` : undefined} /></small><strong>{fmtNum(payload?.total)}</strong><span>笔</span></article>
          <article><small><MetricLabel metric="itemQuantity" detail={payload ? `当前范围合计 ${fmtNum(payload.totals.quantity)} 件` : undefined} /></small><strong>{fmtNum(payload?.totals.quantity)}</strong><span>件</span></article>
          <article><small><MetricLabel metric="systemSales" detail={payload ? `当前范围合计 ${fmtCny(payload.totals.salesCny)}` : undefined} /></small><strong>{fmtCny(payload?.totals.salesCny)}</strong><span>人民币口径</span></article>
          {permissions.cost ? <article><small><MetricLabel metric="systemProductCost" detail={payload ? `当前范围合计 ${fmtCny(payload.totals.productCostCny)}` : undefined} /></small><strong>{fmtCny(payload?.totals.productCostCny)}</strong><span>中台成本口径</span></article> : null}
        </div>

        <div className="shop-daily-order-toolbar">
          <label><Search size={16} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="搜索订单号、SKU 或商品名称" /></label>
          <button className="ghost-button" type="button" onClick={onExport} disabled={exporting || !payload?.total}><Download size={15} />{exporting ? "导出中" : "导出明细"}</button>
        </div>

        <div className="shop-daily-order-scope-note">
          <AlertTriangle size={15} />
          <span>这里展示中台已同步到的具体订单。日报中的平台订单数来自运营导入时，两种口径可能因同步时点不同而暂时不一致。</span>
        </div>
        {error ? <div className="notice shop-daily-error">{error}</div> : null}

        <div className={`shop-daily-order-list ${loading ? "is-loading" : ""}`}>
          {payload?.orders.map((order) => (
            <article className="shop-daily-order-card" key={order.orderKey}>
              <div className="shop-daily-order-card-head">
                <div>
                  <small>{order.orderDate} · {order.sourceSystem || "中台订单"}</small>
                  <strong>{order.orderNo}</strong>
                  <div className="shop-daily-order-meta">
                    {order.sourceOrderId && order.sourceOrderId !== order.orderNo ? <span>平台单号：{order.sourceOrderId}</span> : null}
                    {order.country ? <span>国家：{order.country}</span> : null}
                    {order.projectGroup ? <span>项目组：{order.projectGroup}</span> : null}
                    {order.createdAt ? <span>下单：{order.createdAt}</span> : null}
                    {order.shippedAt ? <span>发货：{order.shippedAt}</span> : null}
                  </div>
                </div>
                <div className="shop-daily-order-amount">
                  <strong>{fmtCny(order.salesCny)}</strong>
                  <small>{order.salesAmount ? fmtLocal(order.salesAmount, order.currency) : "暂无平台金额"}</small>
                </div>
                <span className="shop-daily-order-status" title={order.status || ""}>{formatOrderStatus(order.status)}</span>
              </div>
              <div className="shop-daily-order-products">
                {order.items.map((item) => (
                  <div className="shop-daily-order-product" key={`${order.orderKey}-${item.sku}-${item.productName}`}>
                    {item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" /> : <span className="shop-daily-product-placeholder"><PackageSearch size={17} /></span>}
                    <span><strong>{item.productName}</strong><small>{item.sku || "未匹配 SKU"}</small></span>
                    <b>× {fmtNum(item.quantity)}</b>
                  </div>
                ))}
              </div>
              <footer>
                <span>{order.items.length} 种商品 · 共 {fmtNum(order.quantity)} 件</span>
                {permissions.cost ? <span>产品成本 {fmtCny(order.productCostCny)} · 打包费 {fmtCny(order.packagingFeeCny)}</span> : null}
              </footer>
            </article>
          ))}
          {!loading && payload && !payload.orders.length ? (
            <div className="shop-daily-order-empty"><PackageSearch size={32} /><strong>没有找到具体订单</strong><span>{search ? "换一个订单号、SKU 或商品名称试试。" : "该店铺在这个周期内还没有同步到中台的订单明细。"}</span></div>
          ) : null}
          {loading && !payload ? <div className="shop-daily-order-empty"><RefreshCw className="spin" size={28} /><strong>正在读取订单明细</strong></div> : null}
        </div>

        <footer className="shop-daily-order-pagination">
          <span>共 {fmtNum(payload?.total)} 笔 · 第 {payload?.page || page} / {payload?.pageCount || 1} 页</span>
          <div>
            <button type="button" onClick={() => onPage(Math.max(1, page - 1))} disabled={loading || page <= 1}><ChevronLeft size={16} />上一页</button>
            <button type="button" onClick={() => onPage(Math.min(payload?.pageCount || 1, page + 1))} disabled={loading || page >= (payload?.pageCount || 1)}>下一页<ChevronRight size={16} /></button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

function ImportPanel({ payload, onImported }: { payload: ShopDailyReportPayload | null; onImported: () => Promise<void> }) {
  const [content, setContent] = React.useState("");
  const [defaultYear, setDefaultYear] = React.useState(new Date().getFullYear());
  const [defaultPlatform, setDefaultPlatform] = React.useState("");
  const [preview, setPreview] = React.useState<ShopDailyImportResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  async function run(dryRun: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const result = await importShopDailyReport({ content, dryRun, defaultYear, defaultPlatform });
      setPreview(result);
      if (!dryRun) {
        setMessage(`已写入 ${result.written || 0} 行（${result.shopCount} 个店铺，${result.dateFrom} 至 ${result.dateTo}）。`);
        setContent("");
        await onImported();
      }
    } catch (requestError) {
      setMessage(requestError instanceof Error ? requestError.message : "导入失败");
    } finally {
      setBusy(false);
    }
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    if (/\.xlsx?$/i.test(file.name)) {
      setMessage("暂不直接读取 .xlsx 文件：请在 Excel 中选中表格区域复制粘贴到下方，或另存为「CSV UTF-8」后上传。");
      return;
    }
    setContent(await file.text());
    setPreview(null);
  }

  const sampleKeys = ["date", "shopName", "payAmount", "impressions", "visitors", "orderCount", "addToCart", "reviewAmount", "reviewCount", "adOnsite", "adOffsite", "productCostCny", "operationFeeCny"];
  const sampleLabels: Record<string, string> = { date: "日期", shopName: "店铺", payAmount: "支付金额", impressions: "展示", visitors: "访客", orderCount: "订单", addToCart: "加购", reviewAmount: "测评金额", reviewCount: "测评数", adOnsite: "站内推广", adOffsite: "站外推广", productCostCny: "产品成本", operationFeeCny: "操作费" };

  return (
    <div className="shop-daily-panel">
      <div className="shop-daily-import-help">
        <h4><ClipboardPaste size={16} />从运营表导入</h4>
        <ol>
          <li>在 Excel 里选中包含表头（两行表头也可以）的整块区域，复制后粘贴到下方；也可以上传 CSV。</li>
          <li>只导入原始数据列：{RECOGNIZED_COLUMNS}。带「人民币」的换算列、ROI、利润等由中台统一计算，不会导入。</li>
          <li>空单元格不会覆盖已有数据；同一店铺同一天再次导入时只更新本次有值的列。</li>
        </ol>
      </div>
      <div className="shop-daily-import-options">
        <label><span>年份（日期只写月日时使用）</span><input type="number" value={defaultYear} onChange={(event) => setDefaultYear(Number(event.target.value) || new Date().getFullYear())} /></label>
        <label><span>默认平台（表里没有平台列时）</span><select value={defaultPlatform} onChange={(event) => setDefaultPlatform(event.target.value)}><option value="">不指定</option><option value="shopee">Shopee</option><option value="tiktok">TikTok</option>{(payload?.options.platforms || []).filter((item) => !["shopee", "tiktok"].includes(item.toLowerCase())).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <button className="ghost-button" type="button" onClick={() => fileRef.current?.click()}><FileUp size={15} />选择 CSV</button>
        <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" hidden onChange={(event) => { void readFile(event.target.files?.[0]); event.target.value = ""; }} />
      </div>
      <textarea className="shop-daily-paste" value={content} onChange={(event) => { setContent(event.target.value); setPreview(null); }} placeholder="在这里粘贴 Excel 表格…" rows={10} />
      <div className="shop-daily-panel-actions">
        <button className="ghost-button" type="button" disabled={busy || !content.trim()} onClick={() => void run(true)}>预览</button>
        <button className="sync-button" type="button" disabled={busy || !preview || !preview.rowCount} onClick={() => void run(false)}><Save size={15} />确认导入 {preview?.rowCount ? `${preview.rowCount} 行` : ""}</button>
        {message ? <span className="shop-daily-message">{message}</span> : null}
      </div>
      {preview ? (
        <div className="shop-daily-preview">
          <p>识别 {preview.rowCount} 行 · {preview.shopCount} 个店铺 · {preview.dateFrom || "—"} 至 {preview.dateTo || "—"} · 跳过空行/汇总行 {preview.skipped} 行</p>
          {preview.errorCount ? <div className="notice shop-daily-error"><strong>{preview.errorCount} 个问题：</strong>{preview.errors.slice(0, 8).map((item, index) => <div key={index}>{item.line ? `第 ${item.line} 行：` : ""}{item.message}</div>)}</div> : null}
          {preview.warnings.length ? <div className="notice">{preview.warnings.map((item) => <div key={item.shopKey}>{item.message}</div>)}</div> : null}
          {preview.sample.length ? (
            <div className="shop-daily-table-wrap">
              <table className="shop-daily-table compact">
                <thead><tr>{sampleKeys.map((key) => <th key={key}>{sampleLabels[key]}</th>)}</tr></thead>
                <tbody>{preview.sample.map((row, index) => <tr key={index}>{sampleKeys.map((key) => <td key={key} className={key === "date" || key === "shopName" ? "" : "num"}>{row[key] === undefined ? "" : typeof row[key] === "number" ? fmtNum(row[key] as number) : String(row[key])}</td>)}</tr>)}</tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="shop-daily-ingest">
        <h4>紫鸟自动采集</h4>
        <p>采集脚本把每天的展示、访客、加购、推广费以 JSON 推送到 <code>POST /api/shop-daily-report/ingest</code>（请求头 <code>X-Ingest-Token</code>）。字段名与导入一致：<code>date, shopName / shopKey, country, platform, impressions, visitors, addToCart, payAmount, orderCount, adOnsite, adOffsite</code>。</p>
        <p>状态：{payload?.ingestConfigured ? "服务器已配置采集令牌。" : "服务器尚未配置 SHOP_METRICS_INGEST_TOKEN，采集写入未启用。"}</p>
        {payload?.importLog.length ? (
          <ul>{payload.importLog.slice(0, 6).map((item) => <li key={item.id}>{new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false })} · {SOURCE_LABEL[item.source] || item.source} · {item.rowCount} 行 · {item.dateFrom} 至 {item.dateTo} · {item.createdBy}</li>)}</ul>
        ) : null}
      </div>
    </div>
  );
}

function ReviewPanel({ payload, onChanged }: { payload: ShopDailyReportPayload | null; onChanged: () => Promise<void> }) {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const [draft, setDraft] = React.useState({ shopKey: "", date: todayKey, orderNo: "", amount: "", receivedAmount: "", quantity: "1", note: "" });
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const shops = payload?.options.shops || [];
  const shopLabel = new Map(shops.map((shop) => [shop.value, shop.label]));

  async function save() {
    setBusy(true);
    setMessage("");
    try {
      await saveShopReviewOrders([{
        shopKey: draft.shopKey,
        shopName: shopLabel.get(draft.shopKey) || "",
        date: draft.date,
        orderNo: draft.orderNo.trim(),
        amount: draft.amount === "" ? null : Number(draft.amount),
        receivedAmount: draft.receivedAmount === "" ? null : Number(draft.receivedAmount),
        quantity: Number(draft.quantity) || 1,
        note: draft.note,
      }]);
      setDraft({ ...draft, orderNo: "", amount: "", receivedAmount: "", quantity: "1", note: "" });
      setMessage("已登记。");
      await onChanged();
    } catch (requestError) {
      setMessage(requestError instanceof Error ? requestError.message : "登记失败");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("删除这条测评登记？")) return;
    try {
      await deleteShopReviewOrder(id);
      await onChanged();
    } catch (requestError) {
      setMessage(requestError instanceof Error ? requestError.message : "删除失败");
    }
  }

  return (
    <div className="shop-daily-panel">
      <p className="shop-daily-hint">登记测评订单后，系统会从支付金额和订单数里扣除，并按「差额 + 数量 × 单位成本」计入测评成本。测评金额留空时，自动取中台同订单号的金额。某店某天有登记时，以登记为准，不再使用导入表里的测评列。</p>
      <div className="shop-daily-review-form">
        <label><span>店铺</span><select value={draft.shopKey} onChange={(event) => setDraft({ ...draft, shopKey: event.target.value })}><option value="">选择店铺</option>{shops.map((shop) => <option key={shop.value} value={shop.value}>{shop.label}{shop.platform ? ` · ${shop.platform}` : ""}</option>)}</select></label>
        <label><span>日期</span><input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>
        <label><span>订单号</span><input value={draft.orderNo} onChange={(event) => setDraft({ ...draft, orderNo: event.target.value })} placeholder="平台订单号" /></label>
        <label><span>测评金额（本币）</span><input type="number" min="0" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} placeholder="留空自动取" /></label>
        <label><span>实际收款（本币）</span><input type="number" min="0" value={draft.receivedAmount} onChange={(event) => setDraft({ ...draft, receivedAmount: event.target.value })} /></label>
        <label><span>数量</span><input type="number" min="1" value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} /></label>
        <label className="wide"><span>备注</span><input value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
        <button className="sync-button" type="button" disabled={busy || !draft.shopKey || !draft.date} onClick={() => void save()}><Plus size={15} />登记</button>
      </div>
      {message ? <span className="shop-daily-message">{message}</span> : null}
      <div className="shop-daily-table-wrap">
        <table className="shop-daily-table compact">
          <thead><tr><th>日期</th><th>店铺</th><th>订单号</th><th>测评金额</th><th>实际收款</th><th>数量</th><th>备注</th><th>登记人</th><th /></tr></thead>
          <tbody>
            {(payload?.reviewOrders || []).map((row) => (
              <tr key={row.id}>
                <td>{row.date}</td>
                <td>{shopLabel.get(row.shopKey) || row.shopName || row.shopKey}</td>
                <td>{row.orderNo || "—"}</td>
                <td className="num">{row.amount === null ? <span className="muted">自动取订单</span> : fmtNum(row.amount)}</td>
                <td className="num">{row.receivedAmount === null ? <span className="muted">未填</span> : fmtNum(row.receivedAmount)}</td>
                <td className="num">{row.quantity}</td>
                <td>{row.note}</td>
                <td>{row.createdBy}</td>
                <td><button className="shop-daily-icon" type="button" title="删除" onClick={() => void remove(row.id)}><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!payload?.reviewOrders.length ? <div className="shop-daily-empty"><p>当前日期范围内没有测评登记。</p></div> : null}
      </div>
    </div>
  );
}

function RulesPanel({ payload, onSaved }: { payload: ShopDailyReportPayload | null; onSaved: () => Promise<void> }) {
  const [rules, setRules] = React.useState<ShopFeeRule[]>(payload?.rules || []);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [newScope, setNewScope] = React.useState<ShopFeeRule["scope"]>("shop");
  const [newTarget, setNewTarget] = React.useState("");
  const [newCountry, setNewCountry] = React.useState("ID");
  const [newPlatform, setNewPlatform] = React.useState("shopee");
  const canEdit = Boolean(payload?.permissions.manageRules);
  const shops = payload?.options.shops || [];
  const shopLabel = new Map(shops.map((shop) => [shop.value, `${shop.label}${shop.platform ? ` · ${shop.platform}` : ""}`]));

  React.useEffect(() => {
    setRules((payload?.rules || []).map((rule) => ({ ...rule })));
  }, [payload?.generatedAt]);

  function update(index: number, patch: Partial<ShopFeeRule>) {
    setRules((current) => current.map((rule, position) => (position === index ? { ...rule, ...patch } : rule)));
  }

  function addRule() {
    const base = rules.find((rule) => rule.scope === "default");
    const rule = emptyRule(newScope, base);
    if (newScope === "shop") {
      if (!newTarget) return;
      rule.shopKey = newTarget;
      rule.label = shopLabel.get(newTarget) || newTarget;
    } else {
      rule.countryKey = newCountry.trim().toUpperCase();
      if (newScope === "platform") rule.platform = newPlatform;
    }
    if (rules.some((item) => ruleKey(item) === ruleKey(rule))) {
      setMessage("这个范围已经有费率规则了。");
      return;
    }
    setRules([...rules, rule]);
    setMessage("");
  }

  async function save() {
    setBusy(true);
    setMessage("");
    try {
      await updateShopFeeRules(rules);
      setMessage("费率已保存，日报已按新费率重算。");
      await onSaved();
    } catch (requestError) {
      setMessage(requestError instanceof Error ? requestError.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  const percent = (value: number) => Number((value * 100).toFixed(4));
  const fromPercent = (value: string) => (value === "" ? 0 : Number(value) / 100);

  return (
    <div className="shop-daily-panel">
      <p className="shop-daily-hint">
        优先级：店铺 &gt; 平台+国家 &gt; 国家 &gt; 全局默认。<b>标准公式</b>：真实成交 ×（1 − 佣金率）− 真实单量 × 每单费用 − 推广费 − 测评成本 − 产品成本 − 操作费。
        <b>叠乘公式</b>：((真实成交 × 净收比例 − 推广费) × 系数1) × 系数2 − 测评成本 − 真实单量 × 每单费用 − 产品成本 − 真实成交 × 额外扣点 − 操作费。
        固定汇率为 0 时使用「经营汇率」每日自动汇率。
      </p>
      <div className="shop-daily-table-wrap">
        <table className="shop-daily-table compact rules">
          <thead><tr><th className="sticky">范围</th><th>公式</th><th>佣金率 %</th><th>每单费用</th><th>推广税率 %</th><th>测评单位成本 ¥</th><th>固定汇率（1¥=本币）</th><th>叠乘：净收/系数1/系数2/额外扣点 %</th><th>产品成本用中台</th><th>操作费用中台打包费</th><th /></tr></thead>
          <tbody>
            {rules.map((rule, index) => (
              <tr key={ruleKey(rule)}>
                <td className="sticky"><strong>{rule.scope === "shop" ? shopLabel.get(rule.shopKey || "") || rule.label : rule.label}</strong><small>{{ default: "全局默认", country: "国家", platform: "平台+国家", shop: "店铺" }[rule.scope]}{rule.updatedBy ? ` · ${rule.updatedBy}` : ""}</small></td>
                <td><select disabled={!canEdit} value={rule.mode} onChange={(event) => update(index, { mode: event.target.value as ShopFeeRule["mode"] })}><option value="standard">标准</option><option value="stacked">叠乘</option></select></td>
                <td><input disabled={!canEdit || rule.mode === "stacked"} type="number" step="0.1" value={percent(rule.commissionRate)} onChange={(event) => update(index, { commissionRate: fromPercent(event.target.value) })} /></td>
                <td className="pair"><input disabled={!canEdit} type="number" step="0.01" value={rule.perOrderFee} onChange={(event) => update(index, { perOrderFee: Number(event.target.value) || 0 })} /><select disabled={!canEdit} value={rule.perOrderFeeCurrency} onChange={(event) => update(index, { perOrderFeeCurrency: event.target.value as ShopFeeRule["perOrderFeeCurrency"] })}><option value="LOCAL">本币</option><option value="CNY">人民币</option></select></td>
                <td><input disabled={!canEdit} type="number" step="0.1" value={percent(rule.adTaxRate)} onChange={(event) => update(index, { adTaxRate: fromPercent(event.target.value) })} /></td>
                <td><input disabled={!canEdit} type="number" step="0.1" value={rule.reviewUnitCostCny} onChange={(event) => update(index, { reviewUnitCostCny: Number(event.target.value) || 0 })} /></td>
                <td><input disabled={!canEdit} type="number" step="1" value={rule.fixedLocalPerCny} onChange={(event) => update(index, { fixedLocalPerCny: Number(event.target.value) || 0 })} /></td>
                <td className="quad">{(["stackedNetRate", "stackedFactor1", "stackedFactor2", "stackedExtraRate"] as const).map((key) => <input key={key} disabled={!canEdit || rule.mode !== "stacked"} type="number" step="0.1" value={percent(rule[key])} onChange={(event) => update(index, { [key]: fromPercent(event.target.value) } as Partial<ShopFeeRule>)} />)}</td>
                <td><input disabled={!canEdit} type="checkbox" checked={rule.useSystemProductCost} onChange={(event) => update(index, { useSystemProductCost: event.target.checked })} /></td>
                <td><input disabled={!canEdit} type="checkbox" checked={rule.useSystemOperationFee} onChange={(event) => update(index, { useSystemOperationFee: event.target.checked })} /></td>
                <td>{canEdit && rule.scope !== "default" ? <button className="shop-daily-icon" type="button" title="删除" onClick={() => setRules(rules.filter((_, position) => position !== index))}><Trash2 size={14} /></button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <div className="shop-daily-rule-add">
          <select value={newScope} onChange={(event) => setNewScope(event.target.value as ShopFeeRule["scope"])}><option value="shop">按店铺</option><option value="platform">按平台+国家</option><option value="country">按国家</option></select>
          {newScope === "shop" ? (
            <select value={newTarget} onChange={(event) => setNewTarget(event.target.value)}><option value="">选择店铺</option>{shops.map((shop) => <option key={shop.value} value={shop.value}>{shopLabel.get(shop.value)}</option>)}</select>
          ) : (
            <>
              <select value={newCountry} onChange={(event) => setNewCountry(event.target.value)}>{["ID", "MY", "VN", "PH", "TH", "SG"].map((code) => <option key={code} value={code}>{code}</option>)}</select>
              {newScope === "platform" ? <select value={newPlatform} onChange={(event) => setNewPlatform(event.target.value)}><option value="shopee">Shopee</option><option value="tiktok">TikTok</option></select> : null}
            </>
          )}
          <button className="ghost-button" type="button" onClick={addRule}><Plus size={15} />新增规则</button>
          <button className="sync-button" type="button" disabled={busy} onClick={() => void save()}><Save size={15} />保存费率</button>
          {message ? <span className="shop-daily-message">{message}</span> : null}
        </div>
      ) : <div className="notice">当前账号可以查看费率，修改需要「维护经营分析规则」和「经营成本」权限。</div>}
    </div>
  );
}
