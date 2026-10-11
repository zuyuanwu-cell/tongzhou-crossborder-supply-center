import React from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Factory,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  Search,
  Store,
  Truck,
  Warehouse,
} from "lucide-react";
import {
  claimOverseasReconciliationReturn,
  fetchOverseasInventoryReconciliation,
  refreshOverseasInventoryReconciliation,
  type AuthUser,
  type MovementComparisonPeriod,
  type OverseasInventoryReconciliationPayload,
  type OverseasReconciliationMetricDelta,
  type OverseasReconciliationRanking,
  type OverseasReconciliationReturnFact,
  type OverseasReconciliationWarehouse,
} from "./api";
import "./overseas-inventory-reconciliation.css";

type Props = {
  currentUser: AuthUser;
};

type ReturnFilter = "all" | "in_transit" | "pending" | "restocked" | "scrapped" | "unclaimed";
type RankingMode = "skus" | "shops" | "warehouses";

const periodOptions: Array<{ value: MovementComparisonPeriod; label: string }> = [
  { value: "week", label: "本周" },
  { value: "month", label: "本月" },
  { value: "quarter", label: "本季度" },
  { value: "year", label: "本年" },
  { value: "custom", label: "自定义" },
];

const sourceLabels: Record<string, string> = {
  inventory: "库存快照",
  orders: "实际出库",
  inbound: "入库到仓",
  returns: "WMS 退货",
  transfers: "调拨流水",
};

const returnFilterLabels: Record<ReturnFilter, string> = {
  all: "全部实物退货",
  in_transit: "退货在途",
  pending: "到仓待处理",
  restocked: "已重新上架",
  scrapped: "已报废",
  unclaimed: "待运营认领",
};

function quantity(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(Number(value || 0));
}

function percent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function dateTime(value: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(parsed);
}

function csvCell(value: unknown) {
  const raw = String(value ?? "");
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function downloadCsv(name: string, rows: unknown[][]) {
  const content = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function hasPermission(user: AuthUser, permission: string) {
  return user.role === "admin" || user.permissions.includes(permission);
}

function Delta({ value, inverse = false }: { value?: OverseasReconciliationMetricDelta; inverse?: boolean }) {
  if (!value) return <span className="oir-delta neutral">无对比</span>;
  const improving = inverse ? value.change <= 0 : value.change >= 0;
  const Icon = value.change > 0 ? ArrowUpRight : value.change < 0 ? ArrowDownRight : ArrowRight;
  return (
    <span className={`oir-delta ${value.change === 0 ? "neutral" : improving ? "positive" : "negative"}`}>
      <Icon size={13} />
      {value.change > 0 ? "+" : ""}{quantity(value.change)}
      <small>{value.rate === null ? "新增" : percent(value.rate)}</small>
    </span>
  );
}

function SourceChip({ name, source }: { name: string; source: OverseasInventoryReconciliationPayload["sources"][string] }) {
  const label = source.status === "ready" ? "已就绪" : source.status === "partial" ? "部分可用" : "待接入";
  return (
    <span className={`oir-source-chip ${source.status}`} title={source.message || source.syncedAt || label}>
      <i />
      <strong>{sourceLabels[name] || name}</strong>
      <em>{label}</em>
    </span>
  );
}

function MetricCard({
  eyebrow,
  value,
  unit = "件",
  delta,
  inverse,
  tone = "default",
  detail,
}: {
  eyebrow: string;
  value: number;
  unit?: string;
  delta?: OverseasReconciliationMetricDelta;
  inverse?: boolean;
  tone?: "default" | "cyan" | "amber" | "red" | "green";
  detail: string;
}) {
  return (
    <article className={`oir-metric-card ${tone}`}>
      <span className="oir-metric-eyebrow">{eyebrow}</span>
      <div className="oir-metric-value"><strong>{quantity(value)}</strong><span>{unit}</span></div>
      <div className="oir-metric-foot"><Delta value={delta} inverse={inverse} /><span>{detail}</span></div>
    </article>
  );
}

function returnFactMatches(fact: OverseasReconciliationReturnFact, filter: ReturnFilter) {
  if (filter === "all") return true;
  if (filter === "in_transit") return fact.status === "in_transit";
  if (filter === "pending") return fact.status !== "in_transit" && fact.pendingQty > 0;
  if (filter === "restocked") return fact.restockedQty > 0;
  if (filter === "scrapped") return fact.scrappedQty > 0;
  return fact.claimStatus === "unclaimed" || fact.claimStatus === "conflict";
}

function rankingName(item: OverseasReconciliationRanking, mode: RankingMode) {
  if (mode === "skus") return item.sku || "未识别 SKU";
  if (mode === "shops") return item.shopName || "未识别店铺";
  return item.warehouseName || item.warehouseId || "未识别仓库";
}

function WarehouseMatrix({
  rows,
  selectedId,
  onSelect,
}: {
  rows: OverseasReconciliationWarehouse[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="oir-table-shell">
      <table className="oir-warehouse-table">
        <thead>
          <tr>
            <th>海外仓</th>
            <th>期初</th>
            <th>实际入库</th>
            <th>实际出库</th>
            <th>退货上架</th>
            <th>理论期末</th>
            <th>实际库存</th>
            <th>差异</th>
            <th>实物退货</th>
            <th>待认领</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.warehouseId} className={selectedId === row.warehouseId ? "selected" : ""} onClick={() => onSelect(row.warehouseId)}>
              <td>
                <button className="oir-warehouse-name" type="button" onClick={() => onSelect(row.warehouseId)}>
                  <span className={`oir-status-mark ${row.differenceTone}`} />
                  <span><strong>{row.warehouseName}</strong><small>{row.country || "海外"} · {row.skuCount} SKU</small></span>
                </button>
              </td>
              <td>{quantity(row.openingInventoryQty)}</td>
              <td className="inbound">+{quantity(row.inboundQty)}</td>
              <td className="outbound">-{quantity(row.outboundQty)}</td>
              <td className="restock">+{quantity(row.restockedQty)}</td>
              <td>{quantity(row.theoreticalInventoryQty)}</td>
              <td><strong>{quantity(row.actualInventoryQty)}</strong></td>
              <td><span className={`oir-variance ${row.differenceTone}`}>{row.varianceQty > 0 ? "+" : ""}{quantity(row.varianceQty)}</span></td>
              <td>{quantity(row.returnQty)} <small className="oir-cell-note">环比 {row.comparison.returnQty.change > 0 ? "+" : ""}{quantity(row.comparison.returnQty.change)}</small></td>
              <td>{row.unclaimedReturnCount ? <span className="oir-claim-count">{row.unclaimedReturnCount} 笔</span> : <span className="oir-muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length ? <div className="oir-empty-inline">当前筛选下没有海外仓数据</div> : null}
    </div>
  );
}

export function OverseasInventoryReconciliationPage({ currentUser }: Props) {
  const [payload, setPayload] = React.useState<OverseasInventoryReconciliationPayload | null>(null);
  const [period, setPeriod] = React.useState<MovementComparisonPeriod>("month");
  const [anchorDate, setAnchorDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [customFrom, setCustomFrom] = React.useState("");
  const [customTo, setCustomTo] = React.useState("");
  const [warehouseId, setWarehouseId] = React.useState("all");
  const [selectedWarehouseId, setSelectedWarehouseId] = React.useState("");
  const [keyword, setKeyword] = React.useState("");
  const [returnFilter, setReturnFilter] = React.useState<ReturnFilter>("all");
  const [rankingMode, setRankingMode] = React.useState<RankingMode>("skus");
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [claimingId, setClaimingId] = React.useState("");
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");

  const requestInput = React.useCallback(() => ({
    period,
    anchorDate,
    ...(period === "custom" ? { from: customFrom, to: customTo } : {}),
  }), [period, anchorDate, customFrom, customTo]);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    if (period === "custom" && (!customFrom || !customTo)) {
      setError("自定义周期需要填写开始和结束日期。");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const next = await fetchOverseasInventoryReconciliation(requestInput(), signal);
      setPayload(next);
      setSelectedWarehouseId((current) => current && next.warehouses.some((item) => item.warehouseId === current) ? current : next.warehouses[0]?.warehouseId || "");
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return;
      setError(requestError instanceof Error ? requestError.message : "海外仓库存对账读取失败");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [period, customFrom, customTo, requestInput]);

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
    // Only load once on entry; subsequent period changes are applied explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError("");
    setNotice("");
    try {
      const next = await refreshOverseasInventoryReconciliation(requestInput());
      setPayload(next);
      setNotice("WMS 退货事实已刷新；未匹配售后单的记录已进入待认领队列。");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "WMS 退货刷新失败");
    } finally {
      setRefreshing(false);
    }
  };

  const handleClaim = async (fact: OverseasReconciliationReturnFact) => {
    setClaimingId(fact.id);
    setError("");
    try {
      await claimOverseasReconciliationReturn(fact.id);
      await load();
      setNotice(`已认领退货单 ${fact.returnOrderNumber || fact.originalOrderNumber || fact.id}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "认领失败");
    } finally {
      setClaimingId("");
    }
  };

  const visibleWarehouses = React.useMemo(() => {
    if (!payload) return [];
    const normalized = keyword.trim().toLowerCase();
    return payload.warehouses.filter((row) => {
      if (warehouseId !== "all" && row.warehouseId !== warehouseId) return false;
      if (!normalized) return true;
      return [row.warehouseName, row.country, ...row.skuRows.flatMap((sku) => [sku.sku, sku.productName])]
        .some((value) => String(value || "").toLowerCase().includes(normalized));
    });
  }, [payload, warehouseId, keyword]);

  React.useEffect(() => {
    if (visibleWarehouses.length && !visibleWarehouses.some((row) => row.warehouseId === selectedWarehouseId)) {
      setSelectedWarehouseId(visibleWarehouses[0].warehouseId);
    }
  }, [visibleWarehouses, selectedWarehouseId]);

  const selectedWarehouse = payload?.warehouses.find((row) => row.warehouseId === selectedWarehouseId) || visibleWarehouses[0] || null;
  const visibleFacts = React.useMemo(() => {
    if (!payload) return [];
    const normalized = keyword.trim().toLowerCase();
    return payload.returnFacts.filter((fact) => {
      if (selectedWarehouse && fact.warehouseId !== selectedWarehouse.warehouseId) return false;
      if (!returnFactMatches(fact, returnFilter)) return false;
      if (!normalized) return true;
      return [fact.sku, fact.productName, fact.shopName, fact.returnOrderNumber, fact.originalOrderNumber]
        .some((value) => String(value || "").toLowerCase().includes(normalized));
    });
  }, [payload, selectedWarehouse, returnFilter, keyword]);

  const filteredSkuRows = React.useMemo(() => {
    if (!selectedWarehouse) return [];
    const normalized = keyword.trim().toLowerCase();
    return selectedWarehouse.skuRows.filter((row) => !normalized || [row.sku, row.productName].some((value) => value.toLowerCase().includes(normalized)));
  }, [selectedWarehouse, keyword]);

  const exportRows = () => {
    if (!payload) return;
    const rows: unknown[][] = [["仓库", "国家", "SKU", "产品", "期初库存", "实际入库", "退货上架", "实际出库", "调入", "调出", "调整", "理论期末", "实际库存", "差异", "实物退货", "报废", "待处理"]];
    for (const warehouse of visibleWarehouses) {
      for (const row of warehouse.skuRows) {
        rows.push([warehouse.warehouseName, warehouse.country, row.sku, row.productName, row.openingInventoryQty, row.inboundQty, row.restockedQty, row.outboundQty, row.transferInQty, row.transferOutQty, row.adjustmentQty, row.theoreticalInventoryQty, row.actualInventoryQty, row.varianceQty, row.returnQty, row.scrappedQty, row.pendingReturnQty]);
      }
    }
    downloadCsv(`海外仓库存对账_${payload.ranges.current.from}_${payload.ranges.current.to}.csv`, rows);
  };

  if (loading && !payload) {
    return (
      <section className="oir-page" data-testid="overseas-reconciliation-page">
        <div className="oir-loading-hero"><RefreshCw className="spin" size={24} /><strong>正在合并海外仓库存与退货事实</strong><span>读取库存快照、出入库、退货处置与售后认领关系…</span></div>
        <div className="oir-skeleton-grid">{Array.from({ length: 6 }).map((_, index) => <i key={index} />)}</div>
      </section>
    );
  }

  if (!payload) {
    return (
      <section className="oir-page" data-testid="overseas-reconciliation-page">
        <div className="oir-fatal"><AlertTriangle size={34} /><strong>海外仓库存对账暂时无法读取</strong><span>{error}</span><button type="button" onClick={() => void load()}><RefreshCw size={16} />重试</button></div>
      </section>
    );
  }

  const summary = payload.summary;
  const comparison = payload.comparison.summary;
  const rankings = payload.rankings[rankingMode];
  const rankingMax = Math.max(1, ...rankings.slice(0, 8).map((item) => item.returnQty));
  const lifecycleFilters: Array<{ key: ReturnFilter; value: number; detail: string }> = [
    { key: "in_transit", value: summary.inTransitReturnQty, detail: "WMS 已创建，尚未签收" },
    { key: "pending", value: summary.pendingReturnQty, detail: "已到仓，待质检处置" },
    { key: "restocked", value: summary.restockedQty, detail: "已恢复可售库存" },
    { key: "scrapped", value: summary.scrappedQty, detail: "已判定不可售" },
    { key: "unclaimed", value: summary.unclaimedReturnQty, detail: `${summary.unclaimedReturnCount} 笔未匹配售后单` },
  ];

  return (
    <section className="oir-page" data-testid="overseas-reconciliation-page">
      <header className="oir-hero">
        <div className="oir-hero-copy">
          <span className="oir-kicker"><i /> OVERSEAS INVENTORY CONTROL</span>
          <h2>海外仓库存对账中心</h2>
          <p>用实际库存、实际出入库与 WMS 实物退货闭环定位差异；售后漏录不会阻断事实，只进入待认领队列。</p>
          <div className="oir-source-row">
            {Object.entries(payload.sources).map(([name, source]) => <SourceChip key={name} name={name} source={source} />)}
          </div>
        </div>
        <div className="oir-hero-aside">
          <span>当前核算周期</span>
          <strong>{payload.ranges.current.label}</strong>
          <small>{payload.ranges.current.from} — {payload.ranges.current.to}</small>
          <i>对比 {payload.ranges.previous.label}</i>
          <em>生成于 {dateTime(payload.generatedAt)}</em>
        </div>
      </header>

      <div className="oir-control-bar">
        <div className="oir-period-tabs" aria-label="对账周期">
          {periodOptions.map((item) => <button key={item.value} className={period === item.value ? "active" : ""} type="button" onClick={() => setPeriod(item.value)}>{item.label}</button>)}
        </div>
        {period === "custom" ? (
          <div className="oir-date-range"><input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /><span>至</span><input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></div>
        ) : <input className="oir-anchor-date" type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} title="周期锚点日期" />}
        <button className="oir-button primary" type="button" onClick={() => void load()} disabled={loading}><Search size={16} />{loading ? "核算中" : "应用周期"}</button>
        <button className="oir-button" type="button" onClick={exportRows}><Download size={16} />导出明细</button>
        {hasPermission(currentUser, "inventory_sync_run") && hasPermission(currentUser, "warehouse_return_query") ? <button className="oir-button refresh" type="button" onClick={() => void handleRefresh()} disabled={refreshing}><RefreshCw className={refreshing ? "spin" : ""} size={16} />{refreshing ? "刷新中" : "刷新 WMS 事实"}</button> : null}
      </div>

      {error ? <div className="oir-notice error"><AlertTriangle size={17} /><span>{error}</span></div> : null}
      {notice ? <div className="oir-notice success"><CheckCircle2 size={17} /><span>{notice}</span></div> : null}

      <div className="oir-metric-grid">
        <MetricCard eyebrow="海外仓实际库存" value={summary.actualInventoryQty} unit="件" delta={comparison.actualInventoryQty} tone="cyan" detail={`${summary.warehouseCount} 个海外仓`} />
        <MetricCard eyebrow="账实差异" value={summary.varianceQty} unit="件" delta={comparison.varianceQty} inverse tone={Math.abs(summary.varianceQty) > 0 ? "red" : "green"} detail={`${summary.anomalyWarehouseCount} 个仓需关注`} />
        <MetricCard eyebrow="周期实际出库" value={summary.outboundQty} unit="件" delta={comparison.outboundQty} detail={`入库 ${quantity(summary.inboundQty)} 件`} />
        <MetricCard eyebrow="WMS 实物退货" value={summary.returnQty} unit="件" delta={comparison.returnQty} tone="amber" detail={`售后匹配率 ${percent(summary.afterSalesCoverageRate)}`} />
        <MetricCard eyebrow="已重新上架" value={summary.restockedQty} unit="件" delta={comparison.restockedQty} tone="green" detail={`已报废 ${quantity(summary.scrappedQty)} 件`} />
        <MetricCard eyebrow="退货在途" value={summary.inTransitReturnQty} unit="件" delta={comparison.inTransitReturnQty} detail={`到仓待处理 ${quantity(summary.pendingReturnQty)} 件`} />
      </div>

      <section className="oir-equation-panel">
        <div className="oir-section-heading compact">
          <div><span>RECONCILIATION FORMULA</span><h3>本期库存核算桥</h3></div>
          <p>退货收到不直接增加可售库存，只有“重新上架”才进入理论库存。</p>
        </div>
        <div className="oir-equation">
          <div><small>期初库存</small><strong>{quantity(summary.openingInventoryQty)}</strong></div><b>+</b>
          <div className="positive"><small>实际入库</small><strong>{quantity(summary.inboundQty)}</strong></div><b>+</b>
          <div className="positive"><small>退货上架</small><strong>{quantity(summary.restockedQty)}</strong></div><b>+</b>
          <div><small>调入 / 调整</small><strong>{quantity(summary.transferInQty + summary.adjustmentQty)}</strong></div><b>−</b>
          <div className="negative"><small>实际出库</small><strong>{quantity(summary.outboundQty)}</strong></div><b>−</b>
          <div><small>调出</small><strong>{quantity(summary.transferOutQty)}</strong></div><b>=</b>
          <div className="theoretical"><small>理论期末</small><strong>{quantity(summary.theoreticalInventoryQty)}</strong></div><b>→</b>
          <div className={summary.varianceQty ? "variance alert" : "variance"}><small>实际差异</small><strong>{summary.varianceQty > 0 ? "+" : ""}{quantity(summary.varianceQty)}</strong></div>
        </div>
        {payload.sources.transfers?.status === "missing" ? <div className="oir-formula-warning"><AlertTriangle size={15} />{payload.sources.transfers.message}</div> : null}
      </section>

      <section className="oir-section">
        <div className="oir-section-heading">
          <div><span>WAREHOUSE LEDGER</span><h3>仓库账实差异矩阵</h3></div>
          <div className="oir-filter-cluster">
            <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} aria-label="筛选海外仓"><option value="all">全部海外仓</option>{payload.warehouses.map((row) => <option key={row.warehouseId} value={row.warehouseId}>{row.warehouseName}</option>)}</select>
            <label className="oir-search"><Search size={15} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索 SKU / 产品 / 店铺" /></label>
          </div>
        </div>
        <WarehouseMatrix rows={visibleWarehouses} selectedId={selectedWarehouse?.warehouseId || ""} onSelect={setSelectedWarehouseId} />
      </section>

      <div className="oir-dual-grid">
        <section className="oir-section lifecycle">
          <div className="oir-section-heading compact"><div><span>RETURN LIFECYCLE</span><h3>实物退货生命周期</h3></div><strong className="oir-total-return">{quantity(summary.returnQty)} 件</strong></div>
          <div className="oir-lifecycle-flow">
            {lifecycleFilters.map((item, index) => (
              <React.Fragment key={item.key}>
                <button className={returnFilter === item.key ? "active" : ""} type="button" onClick={() => setReturnFilter(item.key)}>
                  <span>{index + 1}</span><strong>{quantity(item.value)}</strong><em>{returnFilterLabels[item.key]}</em><small>{item.detail}</small>
                </button>
                {index < lifecycleFilters.length - 1 ? <ArrowRight size={16} /> : null}
              </React.Fragment>
            ))}
          </div>
          <button className={`oir-all-returns ${returnFilter === "all" ? "active" : ""}`} type="button" onClick={() => setReturnFilter("all")}><RotateCcw size={14} />查看全部实物退货</button>
        </section>

        <section className="oir-section coverage">
          <div className="oir-section-heading compact"><div><span>OPERATION COVERAGE</span><h3>售后录单覆盖</h3></div><ClipboardCheck size={24} /></div>
          <div className="oir-coverage-score"><strong>{percent(summary.afterSalesCoverageRate)}</strong><span>WMS 实物退货已匹配售后单</span></div>
          <div className="oir-coverage-track"><i style={{ width: `${Math.min(100, summary.afterSalesCoverageRate * 100)}%` }} /></div>
          <div className="oir-coverage-grid">
            <div><small>未录单待认领</small><strong>{summary.unclaimedReturnCount} 笔 / {quantity(summary.unclaimedReturnQty)} 件</strong></div>
            <div><small>已录单未见实物</small><strong>{summary.recordedWithoutWmsCount} 笔 / {quantity(summary.recordedWithoutWmsQty)} 件</strong></div>
          </div>
          <p>后者仅作跟进提醒，不计入实物退货与库存公式。</p>
        </section>
      </div>

      <section className="oir-section">
        <div className="oir-section-heading">
          <div><span>RETURN RANKING</span><h3>退货穿透排名</h3></div>
          <div className="oir-ranking-tabs">
            <button type="button" className={rankingMode === "skus" ? "active" : ""} onClick={() => setRankingMode("skus")}><Boxes size={15} />SKU</button>
            <button type="button" className={rankingMode === "shops" ? "active" : ""} onClick={() => setRankingMode("shops")}><Store size={15} />店铺</button>
            <button type="button" className={rankingMode === "warehouses" ? "active" : ""} onClick={() => setRankingMode("warehouses")}><Warehouse size={15} />仓库</button>
          </div>
        </div>
        <div className="oir-ranking-list">
          {rankings.slice(0, 8).map((item, index) => (
            <article key={`${rankingMode}-${rankingName(item, rankingMode)}`}>
              <span className="oir-rank-number">{String(index + 1).padStart(2, "0")}</span>
              <div className="oir-rank-copy"><strong>{rankingName(item, rankingMode)}</strong><small>{rankingMode === "skus" ? item.productName || `${item.shopCount} 个店铺` : rankingMode === "shops" ? `${item.skuCount} 个 SKU · ${item.warehouseCount} 个仓` : `${item.skuCount} 个 SKU`}</small></div>
              <div className="oir-rank-bar"><i style={{ width: `${Math.max(4, item.returnQty / rankingMax * 100)}%` }} /></div>
              <strong className="oir-rank-value">{quantity(item.returnQty)}<small>件</small></strong>
              <span className={`oir-rank-change ${item.changeQty > 0 ? "up" : item.changeQty < 0 ? "down" : ""}`}>{item.changeQty > 0 ? "+" : ""}{quantity(item.changeQty)}</span>
            </article>
          ))}
          {!rankings.length ? <div className="oir-empty-inline">本周期暂无实物退货排名</div> : null}
        </div>
      </section>

      {selectedWarehouse ? (
        <section className="oir-section oir-drilldown">
          <div className="oir-section-heading">
            <div><span>WAREHOUSE DRILL-DOWN</span><h3>{selectedWarehouse.warehouseName} · SKU 对账明细</h3><p>{selectedWarehouse.country} · {selectedWarehouse.skuCount} 个 SKU · {selectedWarehouse.returnFactCount} 笔实物退货</p></div>
            <div className="oir-selected-summary"><span>差异 SKU <strong>{selectedWarehouse.anomalySkuCount}</strong></span><span>仓库差异 <strong>{selectedWarehouse.varianceQty > 0 ? "+" : ""}{quantity(selectedWarehouse.varianceQty)}</strong></span></div>
          </div>
          <div className="oir-table-shell sku-table-shell">
            <table className="oir-sku-table">
              <thead><tr><th>SKU / 产品</th><th>期初</th><th>入库</th><th>退货上架</th><th>出库</th><th>理论期末</th><th>实际库存</th><th>差异</th><th>退货</th><th>处置</th></tr></thead>
              <tbody>
                {filteredSkuRows.slice(0, 100).map((row) => <tr key={`${row.warehouseId}-${row.sku}`}>
                  <td><strong>{row.sku}</strong><small>{row.productName}</small></td><td>{quantity(row.openingInventoryQty)}</td><td className="inbound">+{quantity(row.inboundQty)}</td><td className="restock">+{quantity(row.restockedQty)}</td><td className="outbound">-{quantity(row.outboundQty)}</td><td>{quantity(row.theoreticalInventoryQty)}</td><td><strong>{quantity(row.actualInventoryQty)}</strong></td><td><span className={`oir-variance ${row.differenceTone}`}>{row.varianceQty > 0 ? "+" : ""}{quantity(row.varianceQty)}</span></td><td>{quantity(row.returnQty)}<small>{row.shopCount} 店铺</small></td><td><span className="oir-disposition">上架 {quantity(row.restockedQty)}</span><span className="oir-disposition scrap">报废 {quantity(row.scrappedQty)}</span></td>
                </tr>)}
              </tbody>
            </table>
            {!filteredSkuRows.length ? <div className="oir-empty-inline">该仓库当前没有匹配的 SKU 对账行</div> : null}
          </div>

          <div className="oir-return-detail-heading">
            <div><Truck size={18} /><strong>{returnFilterLabels[returnFilter]}</strong><span>{visibleFacts.length} 条 WMS 事实</span></div>
            <div className="oir-return-filter-pills">{(["all", "in_transit", "pending", "restocked", "scrapped", "unclaimed"] as ReturnFilter[]).map((filter) => <button key={filter} type="button" className={returnFilter === filter ? "active" : ""} onClick={() => setReturnFilter(filter)}>{returnFilterLabels[filter]}</button>)}</div>
          </div>
          <div className="oir-return-list">
            {visibleFacts.slice(0, 100).map((fact) => (
              <article key={fact.id} className={fact.claimStatus === "unclaimed" || fact.claimStatus === "conflict" ? "needs-claim" : ""}>
                <div className="oir-return-icon">{fact.status === "in_transit" ? <Truck size={19} /> : fact.scrappedQty > 0 ? <Factory size={19} /> : <PackageCheck size={19} />}</div>
                <div className="oir-return-main"><strong>{fact.returnOrderNumber || "未识别退货单"}</strong><span>{fact.sku} · {fact.productName}</span><small>原订单 {fact.originalOrderNumber || "—"} · {dateTime(fact.activityAt)}</small></div>
                <div className="oir-return-shop"><small>来源店铺</small><strong>{fact.shopName || "未识别店铺"}</strong></div>
                <div className="oir-return-quantities"><span>退货 <strong>{quantity(fact.returnQty)}</strong></span><span>上架 <strong>{quantity(fact.restockedQty)}</strong></span><span>报废 <strong>{quantity(fact.scrappedQty)}</strong></span><span>待处理 <strong>{quantity(fact.pendingQty)}</strong></span></div>
                <div className="oir-return-state"><span className={`state ${fact.status}`}>{fact.statusLabel}</span>{fact.claimStatus === "matched" ? <small className="matched">已匹配售后单</small> : fact.claimStatus === "claimed" ? <small className="claimed">{fact.claim?.ownerName || "已认领"}</small> : <>{hasPermission(currentUser, "after_sales_report") ? <button type="button" onClick={() => void handleClaim(fact)} disabled={claimingId === fact.id}>{claimingId === fact.id ? "认领中" : "认领并跟进"}</button> : <small className="unclaimed">待运营认领</small>}</>}</div>
              </article>
            ))}
            {!visibleFacts.length ? <div className="oir-empty-inline">该仓库在当前筛选下没有 WMS 实物退货</div> : null}
          </div>
        </section>
      ) : null}
    </section>
  );
}
