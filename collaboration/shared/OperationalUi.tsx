import React from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Clock3, Database, LoaderCircle, MoreHorizontal, RefreshCw } from "lucide-react";
import type { DataContext } from "./data-context-types";

function formatTimestamp(value?: string) {
  if (!value) return "等待首次同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

const sourceLabels: Record<DataContext["source"], string> = {
  live: "实时",
  snapshot: "快照",
  cache: "缓存",
  derived: "计算结果",
};

const unitLabels = { warehouse: "仓", sku: "SKU", order: "订单" } as const;

export function DataContextBar({ context, loading = false, refreshing = false, error = "", onRetry }: {
  context?: DataContext;
  loading?: boolean;
  refreshing?: boolean;
  error?: string;
  onRetry?: () => void;
}) {
  if (loading && !context) {
    return <div className="op-data-context is-loading" role="status"><LoaderCircle className="op-spin" size={15} /><span>正在确认数据范围与更新时间…</span></div>;
  }
  if (!context) {
    return <div className="op-data-context is-unavailable" role="status"><AlertTriangle size={15} /><span>{error || "数据口径暂不可用，页面不会用 0 代替未知值。"}</span>{onRetry ? <button type="button" onClick={onRetry}><RefreshCw size={14} />重试</button> : null}</div>;
  }
  const unavailable = context.completeness === "unavailable";
  const partial = context.completeness === "partial";
  const coverage = context.coverage;
  return <div className={`op-data-context ${unavailable ? "is-unavailable" : partial ? "is-partial" : "is-complete"}`} role="status" aria-live="polite">
    <span><Clock3 size={14} />截至 {formatTimestamp(context.effectiveAt)}</span>
    <span><Database size={14} />{context.scopeLabel}</span>
    {coverage ? <span>覆盖 {coverage.completed}/{coverage.total} {unitLabels[coverage.unit]}</span> : null}
    <em>{context.isEstimate ? "暂估" : sourceLabels[context.source]}{context.usingPreviousSuccess || Boolean(error) ? " · 上次成功数据" : ""}</em>
    {refreshing ? <span className="op-context-refreshing"><LoaderCircle className="op-spin" size={14} />正在更新</span> : null}
    {unavailable ? <strong><AlertTriangle size={14} />当前不可用</strong> : partial ? <strong><AlertTriangle size={14} />数据不完整</strong> : <strong><CheckCircle2 size={14} />口径完整</strong>}
    {error ? <span className="op-context-error">{error}</span> : null}
    {onRetry && error ? <button type="button" onClick={onRetry}><RefreshCw size={14} />重新读取</button> : null}
  </div>;
}

export function ResourceBoundary({ loading, hasData, error = "", empty = false, emptyTitle = "暂无数据", emptyDescription = "当前范围内没有匹配记录。", onRetry, children }: {
  loading: boolean;
  hasData: boolean;
  error?: string;
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  onRetry?: () => void;
  children: React.ReactNode;
}) {
  if (loading && !hasData) return <div className="op-resource-skeleton" role="status" aria-label="正在加载"><i /><i /><i /></div>;
  if (error && !hasData) return <div className="op-resource-state is-error" role="alert"><AlertTriangle size={24} /><strong>数据读取失败</strong><span>{error}</span>{onRetry ? <button type="button" onClick={onRetry}><RefreshCw size={15} />重新读取</button> : null}</div>;
  if (!loading && !error && empty) return <div className="op-resource-state"><Database size={24} /><strong>{emptyTitle}</strong><span>{emptyDescription}</span></div>;
  return <>{children}</>;
}

export function PageHeader({ title, description, eyebrow, context, primaryAction, secondaryActions }: {
  title: string;
  description?: string;
  eyebrow?: string;
  context?: DataContext;
  primaryAction?: React.ReactNode;
  secondaryActions?: React.ReactNode;
}) {
  return <header className="op-page-header"><div>{eyebrow ? <p>{eyebrow}</p> : null}<h1>{title}</h1>{description ? <span>{description}</span> : null}</div><div className="op-page-actions">{secondaryActions}{primaryAction}</div>{context ? <DataContextBar context={context} /> : null}</header>;
}

export function StatusBadge({ tone = "info", children }: { tone?: "success" | "warning" | "danger" | "info" | "neutral"; children: React.ReactNode }) {
  return <span className={`op-status-badge ${tone}`}>{children}</span>;
}

export function DeltaValue({ value, favorableWhen = "positive", suffix = "" }: { value: number | null; favorableWhen?: "positive" | "negative"; suffix?: string }) {
  if (value === null || !Number.isFinite(value)) return <span className="op-delta neutral">—</span>;
  const favorable = value === 0 || (favorableWhen === "positive" ? value > 0 : value < 0);
  const tone = value === 0 ? "neutral" : favorable ? "good" : "bad";
  return <span className={`op-delta ${tone}`} aria-label={`${value > 0 ? "增加" : value < 0 ? "减少" : "持平"} ${Math.abs(value)}${suffix}`}><b aria-hidden="true">{value > 0 ? "↑" : value < 0 ? "↓" : "→"}</b>{value > 0 ? "+" : ""}{value.toLocaleString("zh-CN")}{suffix}</span>;
}

export function OverflowMenu({ label = "更多操作", children }: { label?: string; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); };
  }, [open]);
  React.useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')?.focus());
  }, [open]);
  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])') || []);
    if (!items.length) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (currentIndex + 1) % items.length : (currentIndex <= 0 ? items.length : currentIndex) - 1;
    items[nextIndex]?.focus();
  };
  return <div className="op-overflow" ref={rootRef}><button ref={triggerRef} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((value) => !value)}><MoreHorizontal size={17} /><ChevronDown size={12} /></button>{open ? <div ref={menuRef} role="menu" onKeyDown={handleMenuKeyDown} onClick={() => setOpen(false)}>{children}</div> : null}</div>;
}
