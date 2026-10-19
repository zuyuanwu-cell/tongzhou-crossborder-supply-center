import React from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Eye,
  LoaderCircle,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
  Warehouse,
  X,
} from "lucide-react";
import { DataContextBar, PageHeader, ResourceBoundary } from "../../shared/OperationalUi";
import { fetchQualificationCoverage } from "./api";
import type { QualificationCoverageCell, QualificationCoveragePayload, QualificationCoverageProduct, QualificationCoverageStatus } from "./types";
import "./qualification-coverage.css";

const statusMeta: Record<QualificationCoverageStatus, { label: string; hint: string }> = {
  valid: { label: "有效", hint: "当前有效" },
  warning: { label: "临近到期", hint: "90 天内到期" },
  urgent: { label: "即将到期", hint: "30 天内到期" },
  expired: { label: "已过期", hint: "有效期已结束" },
  undated: { label: "缺少有效期", hint: "已有记录但未维护有效期" },
  missing: { label: "未覆盖", hint: "未找到对应资质记录" },
  unavailable: { label: "待同步", hint: "等待中台同步资质口径" },
};

const statusOptions = [
  ["all", "全部状态"],
  ["covered", "已覆盖"],
  ["attention", "临期关注"],
  ["risk", "失效或未覆盖"],
  ["valid", "有效"],
  ["expired", "已过期"],
  ["missing", "未覆盖"],
  ["unavailable", "待同步"],
] as const;

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function formatDate(value: string) {
  if (!value) return "未维护";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未维护";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function expiryText(cell: QualificationCoverageCell) {
  if (cell.status === "missing") return "无记录";
  if (cell.status === "undated") return "有效期未维护";
  if (!cell.nearestExpiryDate) return "未维护";
  if (cell.nearestDaysLeft === null) return formatDate(cell.nearestExpiryDate);
  if (cell.nearestDaysLeft < 0) return `${formatDate(cell.nearestExpiryDate)} · 已过期 ${Math.abs(cell.nearestDaysLeft)} 天`;
  return `${formatDate(cell.nearestExpiryDate)} · 剩余 ${cell.nearestDaysLeft} 天`;
}

function StatusMark({ status, compact = false }: { status: QualificationCoverageStatus; compact?: boolean }) {
  const meta = statusMeta[status];
  const Icon = status === "valid" ? CheckCircle2 : status === "warning" || status === "urgent" ? Clock3 : AlertTriangle;
  return <span className={`qualification-status is-${status}`} title={meta.hint}><Icon size={compact ? 14 : 16} /><span>{meta.label}</span></span>;
}

function ProductIdentity({ product }: { product: QualificationCoverageProduct }) {
  return <div className="qualification-product-identity">
    <span className="qualification-product-image">{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <Package size={21} />}</span>
    <span><b>{product.productName || product.sku}</b><code>{product.sku || "SKU 未维护"}</code>{product.brand || product.category ? <small>{[product.brand, product.category].filter(Boolean).join(" · ")}</small> : null}</span>
  </div>;
}

function QualificationDrawer({ product, onClose, returnFocus }: { product: QualificationCoverageProduct; onClose(): void; returnFocus: React.RefObject<HTMLElement | null> }) {
  const panelRef = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    const panel = panelRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => panel?.querySelector<HTMLElement>("button")?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); document.body.style.overflow = previousOverflow; window.requestAnimationFrame(() => returnFocus.current?.focus()); };
  }, [onClose, returnFocus]);
  return createPortal(<div className="qualification-drawer-layer" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <aside ref={panelRef} className="qualification-drawer" role="dialog" aria-modal="true" aria-labelledby="qualification-drawer-title">
      <header>
        <div><span><ShieldCheck size={20} /></span><div><small>只读资质视图</small><h2 id="qualification-drawer-title">{product.productName}</h2><code>{product.sku}</code></div></div>
        <button type="button" onClick={onClose} aria-label="关闭资质详情"><X size={19} /></button>
      </header>
      <div className="qualification-drawer-body">
        <section className="qualification-overview-card">
          <div><small>整体状态</small><StatusMark status={product.status} /></div>
          <div><small>覆盖路径</small><strong>{product.coveredCategoryCount}/{product.cells.length || product.registeredCategoryCount}</strong></div>
          <div><small>本仓相关库存</small><strong>{formatNumber(product.totalQty)} {product.unit}</strong></div>
        </section>
        <section className="qualification-inventory-breakdown" aria-label="库存构成">
          <div><span>可用</span><b>{formatNumber(product.availableQty)}</b></div>
          <div><span>锁定</span><b>{formatNumber(product.lockedQty)}</b></div>
          <div><span>在途</span><b>{formatNumber(product.inTransitQty)}</b></div>
        </section>
        <section className="qualification-path-details">
          <header><div><h3>认证路径与有效期</h3><p>仅展示调度判断所需的状态和日期。</p></div><span>{product.cells.length} 条路径</span></header>
          {product.cells.length ? product.cells.map((cell) => <article key={cell.category} className={`is-${cell.status}`}>
            <div><div><b>{cell.category}</b><small>{expiryText(cell)}</small></div><StatusMark status={cell.status} compact /></div>
            {cell.records.length ? <ul>{cell.records.map((record) => <li key={record.id || `${cell.category}-${record.qualificationName}`}><span><b>{record.qualificationName || cell.category}</b><small>生效 {formatDate(record.effectiveDate)}</small></span><span><small>有效期至</small><b>{formatDate(record.expiryDate)}</b></span></li>)}</ul> : <p className="qualification-no-record">当前路径暂无可用记录</p>}
          </article>) : <div className="qualification-no-path"><AlertTriangle size={20} /><b>资质数据待同步</b><span>本仓库存已识别，但尚未取得资质覆盖口径。</span></div>}
        </section>
      </div>
    </aside>
  </div>, document.body);
}

export default function QualificationCoveragePage() {
  const [data, setData] = React.useState<QualificationCoveragePayload | null>(null);
  const [warehouseRef, setWarehouseRef] = React.useState("");
  const [keyword, setKeyword] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState("");
  const [refreshToken, setRefreshToken] = React.useState(0);
  const [selected, setSelected] = React.useState<QualificationCoverageProduct | null>(null);
  const returnFocus = React.useRef<HTMLElement | null>(null);
  const requestSequence = React.useRef(0);
  const deferredKeyword = React.useDeferredValue(keyword.trim());

  React.useEffect(() => {
    const sequence = ++requestSequence.current;
    const hasData = Boolean(data);
    if (hasData) setRefreshing(true); else setLoading(true);
    setError("");
    fetchQualificationCoverage({ warehouseRef, keyword: deferredKeyword, status })
      .then((result) => {
        if (sequence !== requestSequence.current) return;
        setData(result);
        if (!warehouseRef && result.warehouse?.id) setWarehouseRef(result.warehouse.id);
      })
      .catch((reason) => {
        if (sequence !== requestSequence.current) return;
        setError(reason instanceof Error ? reason.message : "资质覆盖数据读取失败");
      })
      .finally(() => {
        if (sequence !== requestSequence.current) return;
        setLoading(false);
        setRefreshing(false);
      });
  // The latest successful response remains visible while filters refresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseRef, deferredKeyword, status, refreshToken]);

  const reload = React.useCallback(() => setRefreshToken((value) => value + 1), []);
  const openDetail = (product: QualificationCoverageProduct, trigger: HTMLElement) => { returnFocus.current = trigger; setSelected(product); };
  const filterActive = Boolean(keyword.trim() || status !== "all");
  const summary = data?.summary;
  const warehouseUnavailable = data?.dataContext?.completeness === "unavailable";

  return <div className="page-stack qualification-coverage-page">
    <PageHeader
      title="仓库资质覆盖"
      description="查看本账号已授权仓库中，正库存商品的资质状态与有效期。页面为只读，不包含资质原件。"
      secondaryActions={<><span className="qualification-readonly"><Eye size={15} />只读查询</span><button className="secondary-action" type="button" onClick={reload} disabled={refreshing}><RefreshCw className={refreshing ? "spin" : ""} size={16} />刷新</button></>}
    />

    <DataContextBar context={data?.dataContext} loading={loading} refreshing={refreshing} error={error} onRetry={reload} />

    <section className="qualification-toolbar" aria-label="资质覆盖筛选">
      <label><span><Warehouse size={15} />仓库</span><select value={warehouseRef} onChange={(event) => setWarehouseRef(event.target.value)} disabled={!data?.warehouses.length}>{data?.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}{warehouse.synchronized ? "" : " · 待同步"}</option>)}</select></label>
      <label className="qualification-search"><span className="sr-only">搜索商品</span><Search size={17} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索 SKU、商品、条码或品牌" /></label>
      <label><span className="sr-only">资质状态</span><select value={status} onChange={(event) => setStatus(event.target.value)}>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </section>

    {summary ? <section className="qualification-metrics" aria-label="资质覆盖概览">
      <article><span><Boxes size={18} />正库存商品</span><strong>{formatNumber(summary.products)}</strong><small>{data?.warehouse ? `${data.warehouse.name} · ${formatNumber(data.warehouse.totalQty)} 件相关库存` : "已授权仓库"}</small></article>
      <article className="is-good"><span><ShieldCheck size={18} />完整覆盖</span><strong>{summary.covered}</strong><small>覆盖率 {summary.coverageRate.toFixed(1)}%</small></article>
      <article className="is-warning"><span><CalendarClock size={18} />临期关注</span><strong>{summary.risk}</strong><small>即将到期 {summary.urgent} · 临近到期 {summary.warning}</small></article>
      <article className="is-danger"><span><AlertTriangle size={18} />失效或待补</span><strong>{summary.expired + summary.undated + summary.missing}</strong><small>过期 {summary.expired} · 无日期 {summary.undated} · 未覆盖 {summary.missing}</small></article>
      <article className="is-neutral"><span><LoaderCircle size={18} />待同步口径</span><strong>{summary.unavailable}</strong><small>未知不会按 0 处理</small></article>
    </section> : null}

    {data?.categories.length ? <section className="qualification-category-section">
      <header><div><h2>认证路径</h2><p>按当前仓库全部正库存商品计算，筛选列表不会改变这里的基准。</p></div></header>
      <div className="qualification-category-grid">{data.categories.map((category) => <article key={category.name}>
        <div><span><ShieldCheck size={16} /></span><div><b>{category.name}</b><small>{category.coveredProducts}/{summary?.products || 0} 个商品已覆盖</small></div><strong>{category.coverageRate.toFixed(1)}%</strong></div>
        <div className="qualification-progress" aria-label={`${category.name}覆盖率 ${category.coverageRate.toFixed(1)}%`}><i style={{ width: `${Math.max(0, Math.min(100, category.coverageRate))}%` }} /></div>
        <footer><span>临期 {category.expiringProducts}</span><span>过期 {category.expiredProducts}</span><span>未登记 {category.missingProducts}</span></footer>
      </article>)}</div>
    </section> : null}

    <section className="qualification-matrix-section">
      <header><div><h2>商品认证矩阵</h2><p>{data?.warehouse ? `${data.warehouse.name} · 仅显示可用、锁定或在途数量大于 0 的商品` : "等待仓库范围"}</p></div><span>{data ? `${data.products.length} 个结果` : "读取中"}</span></header>
      <ResourceBoundary
        loading={loading}
        hasData={Boolean(data)}
        error={error}
        empty={Boolean(data && !data.products.length)}
        emptyTitle={warehouseUnavailable ? "该仓库数据尚未同步" : filterActive ? "没有匹配的商品" : "当前仓库暂无正库存商品"}
        emptyDescription={warehouseUnavailable ? "库存或资质口径首次同步后，此处会显示可调度商品。" : filterActive ? "请调整搜索词或状态筛选。" : "可用、锁定和在途库存均为 0 时不会进入本清单。"}
        onRetry={reload}
      >
        {data?.products.length ? <div className="qualification-matrix-wrap">
          <table className="qualification-matrix">
            <thead><tr><th>商品 / SKU</th><th>整体状态</th>{data.categories.map((category) => <th key={category.name}>{category.name}</th>)}<th>本仓相关库存</th><th><span className="sr-only">查看详情</span></th></tr></thead>
            <tbody>{data.products.map((product) => <tr key={product.id}>
              <td data-label="商品"><button type="button" className="qualification-product-button" onClick={(event) => openDetail(product, event.currentTarget)}><ProductIdentity product={product} /><ChevronRight size={17} /></button></td>
              <td data-label="整体状态"><StatusMark status={product.status} /></td>
              {data.categories.map((category) => {
                const cell = product.cells.find((item) => item.category === category.name);
                return <td key={category.name} data-label={category.name}>{cell ? <div className="qualification-cell"><StatusMark status={cell.status} compact /><small>{expiryText(cell)}</small></div> : <div className="qualification-cell"><StatusMark status={product.status === "unavailable" ? "unavailable" : "missing"} compact /><small>{product.status === "unavailable" ? "等待同步" : "无记录"}</small></div>}</td>;
              })}
              <td data-label="本仓相关库存"><div className="qualification-stock"><b>{formatNumber(product.totalQty)} {product.unit}</b><small>可用 {formatNumber(product.availableQty)} · 锁定 {formatNumber(product.lockedQty)} · 在途 {formatNumber(product.inTransitQty)}</small></div></td>
              <td><button type="button" className="qualification-detail-button" aria-label={`查看 ${product.productName} 的资质详情`} onClick={(event) => openDetail(product, event.currentTarget)}><Eye size={16} /><span>查看</span></button></td>
            </tr>)}</tbody>
          </table>
        </div> : null}
      </ResourceBoundary>
    </section>
    {selected ? <QualificationDrawer product={selected} onClose={() => setSelected(null)} returnFocus={returnFocus} /> : null}
  </div>;
}
