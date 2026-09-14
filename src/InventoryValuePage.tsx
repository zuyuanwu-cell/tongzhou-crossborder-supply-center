import React from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Coins,
  Download,
  PackageSearch,
  RefreshCw,
  Search,
  Upload,
} from "lucide-react";
import type {
  InventoryValuePayload,
  InventoryValuePeriod,
} from "./api";
import { resolveApiUrl } from "./api";
import { decodeInventoryValueCsv, parseInventoryValueCostCsv } from "./inventory-value-csv";
import type { InventoryValueCostImportRow as CostImportRow } from "./inventory-value-csv";

type Props = {
  payload: InventoryValuePayload | null;
  loading: boolean;
  onLoad: (input?: { period?: InventoryValuePeriod; warehouseId?: string; country?: string; keyword?: string }) => Promise<void>;
  onImportCosts: (rows: CostImportRow[]) => Promise<{ importedCount: number }>;
};

function money(value: number) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function compactMoney(value: number) {
  const amount = Math.abs(Number(value || 0));
  if (amount >= 100000000) return `¥${(value / 100000000).toFixed(2)}亿`;
  if (amount >= 10000) return `¥${(value / 10000).toFixed(2)}万`;
  return `¥${Number(value || 0).toFixed(0)}`;
}

function quantity(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(Number(value || 0));
}

function percent(value: number | null) {
  return value === null ? "—" : `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function csvCell(value: unknown) {
  const raw = String(value ?? "");
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function downloadCsv(name: string, rows: unknown[][]) {
  const content = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

function ValueTrend({ payload }: { payload: InventoryValuePayload }) {
  const points = payload.timeline;
  if (!points.length) return <div className="iv-empty"><PackageSearch size={28} /><strong>暂无库存快照</strong><span>生成库存快照后，这里会自动形成货值趋势。</span></div>;
  const width = 760;
  const height = 220;
  const left = 28;
  const top = 18;
  const bottom = 38;
  const chartHeight = height - top - bottom;
  const values = points.map((point) => point.onHandValueCny);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(1, max - min);
  const x = (index: number) => points.length === 1 ? width / 2 : left + index * ((width - left * 2) / (points.length - 1));
  const y = (value: number) => top + (max - value) / range * chartHeight;
  const line = points.map((point, index) => `${x(index)},${y(point.onHandValueCny)}`).join(" ");
  const area = `${left},${height - bottom} ${line} ${x(points.length - 1)},${height - bottom}`;
  const labelIndexes = new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]);
  return (
    <div className="iv-chart-wrap">
      <svg className="iv-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="仓库在库货值趋势">
        {[0, 1, 2, 3].map((lineIndex) => {
          const lineY = top + lineIndex * chartHeight / 3;
          return <line key={lineIndex} x1={left} x2={width - left} y1={lineY} y2={lineY} className="iv-grid-line" />;
        })}
        <polygon points={area} className="iv-area" />
        <polyline points={line} className="iv-line" />
        {points.map((point, index) => (
          <g key={point.key}>
            <circle cx={x(index)} cy={y(point.onHandValueCny)} r={index === points.length - 1 ? 5 : 3.5} className="iv-dot">
              <title>{`${point.snapshotDate}：${money(point.onHandValueCny)}，成本覆盖率 ${percent(point.costCoverageRate)}`}</title>
            </circle>
            {labelIndexes.has(index) ? <text x={x(index)} y={height - 12} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}>{point.label}</text> : null}
          </g>
        ))}
      </svg>
      <div className="iv-chart-caption">
        <span>最低 {compactMoney(Math.min(...values))}</span>
        <span>最高 {compactMoney(Math.max(...values))}</span>
        <span>共 {points.length} 个有效周期</span>
      </div>
    </div>
  );
}

export function InventoryValuePage({ payload, loading, onLoad, onImportCosts }: Props) {
  const [period, setPeriod] = React.useState<InventoryValuePeriod>(payload?.period || "day");
  const [warehouseId, setWarehouseId] = React.useState(payload?.filters.warehouseId || "");
  const [country, setCountry] = React.useState(payload?.filters.country || "");
  const [keyword, setKeyword] = React.useState(payload?.filters.keyword || "");
  const [onlyMissing, setOnlyMissing] = React.useState(false);
  const [sortMode, setSortMode] = React.useState<"change" | "value">("change");
  const [importing, setImporting] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  const runLoad = React.useCallback((nextPeriod = period) => onLoad({ period: nextPeriod, warehouseId, country, keyword }), [onLoad, period, warehouseId, country, keyword]);
  const rows = React.useMemo(() => {
    const source = onlyMissing ? (payload?.rows || []).filter((row) => row.costSource === "missing") : [...(payload?.rows || [])];
    return source.sort((left, right) => sortMode === "value"
      ? right.onHandValueCny - left.onHandValueCny
      : Math.abs(right.valueChangeCny) - Math.abs(left.valueChangeCny));
  }, [payload?.rows, onlyMissing, sortMode]);

  function changePeriod(next: InventoryValuePeriod) {
    setPeriod(next);
    void runLoad(next);
  }

  function downloadMissingTemplate() {
    if (!payload?.missingCosts.length) return;
    const effectiveDate = new Date().toISOString().slice(0, 10);
    downloadCsv(`仓库货值待补成本-${effectiveDate}.csv`, [
      ["SKU", "国家代码", "国家名称", "产品名称", "人民币单位成本", "生效日期", "启用", "备注"],
      ...payload.missingCosts.map((row) => [row.sku, row.countryKey, row.country, row.productName, "", effectiveDate, "是", "仓库货值缺失成本补录"]),
    ]);
  }

  async function importFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImporting(true);
    setMessage("");
    try {
      const rows = parseInventoryValueCostCsv(decodeInventoryValueCsv(await file.arrayBuffer()));
      const result = await onImportCosts(rows);
      setMessage(`已成功补录 ${result.importedCount} 条成本，货值已重新计算。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "成本导入失败，请检查CSV后重试。");
    } finally {
      setImporting(false);
    }
  }

  const summary = payload?.summary;
  const change = summary?.periodChangeCny || 0;
  return (
    <div className="iv-page">
      <section className="iv-hero">
        <div>
          <p className="eyebrow">INVENTORY VALUE</p>
          <h1>仓库货值</h1>
          <p>用库存快照 × 直营供货价，查看每个周期的货值变化与具体 SKU 增减。</p>
        </div>
        <div className="iv-hero-badge">
          <Coins size={25} />
          <span><small>当前估值口径</small><strong>在库库存 · 人民币</strong></span>
        </div>
      </section>

      <section className="iv-toolbar">
        <div className="iv-period-tabs">
          {([ ["day", "按日"], ["week", "按周"], ["month", "按月"] ] as Array<[InventoryValuePeriod, string]>).map(([value, label]) => (
            <button key={value} className={period === value ? "active" : ""} type="button" onClick={() => changePeriod(value)}>{label}</button>
          ))}
        </div>
        <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} aria-label="仓库筛选">
          <option value="">全部仓库</option>
          {payload?.options.warehouses.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select value={country} onChange={(event) => setCountry(event.target.value)} aria-label="国家筛选">
          <option value="">全部国家</option>
          {payload?.options.countries.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <label className="iv-search"><Search size={16} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void runLoad(); }} placeholder="搜索 SKU、产品或仓库" /></label>
        <button className="iv-primary" type="button" disabled={loading} onClick={() => void runLoad()}>{loading ? <RefreshCw className="spin" size={16} /> : <Search size={16} />}查询</button>
      </section>

      <section className="iv-kpis">
        <article><span>当前在库货值</span><strong>{summary ? money(summary.onHandValueCny) : "—"}</strong><small>{payload?.currentPeriod ? `${payload.currentPeriod.snapshotDate} 快照` : "等待库存快照"}</small></article>
        <article className={change > 0 ? "up" : change < 0 ? "down" : ""}><span>较上期变化</span><strong>{summary ? `${change > 0 ? "+" : ""}${money(change)}` : "—"}</strong><small>{summary?.periodChangeRate === null ? "暂无可比上期" : `${change >= 0 ? "增长" : "下降"} ${percent(Math.abs(summary?.periodChangeRate || 0))}`}</small></article>
        <article><span>在途货值</span><strong>{summary ? money(summary.inTransitValueCny) : "—"}</strong><small>{summary ? `${quantity(summary.inTransitQty)} 件在途` : "—"}</small></article>
        <article><span>成本覆盖率</span><strong>{summary ? percent(summary.costCoverageRate) : "—"}</strong><small>{summary ? `${quantity(summary.coveredOnHandQty)} / ${quantity(summary.onHandQty)} 件已估值` : "—"}</small></article>
        <article className={summary?.missingCostSkuCount ? "warning" : ""}><span>缺失成本</span><strong>{summary ? `${summary.missingCostSkuCount} SKU` : "—"}</strong><small>{summary?.missingCostSkuCount ? "未计入当前货值" : "当前库存均有成本"}</small></article>
      </section>

      {message ? <div className="iv-message">{message}</div> : null}

      <section className="iv-main-grid">
        <article className="iv-panel iv-trend-panel">
          <header><div><p className="eyebrow">VALUE TREND</p><h2>周期货值变化</h2></div><span>{payload?.previousPeriod ? `${payload.previousPeriod.snapshotDate} → ${payload.currentPeriod?.snapshotDate}` : "等待形成对比周期"}</span></header>
          {payload ? <ValueTrend payload={payload} /> : <div className="iv-empty"><RefreshCw className={loading ? "spin" : ""} /><strong>正在读取货值</strong></div>}
          <footer><AlertTriangle size={14} /><span>历史快照按当前直营供货价统一重算，变化主要反映库存数量变化；缺失成本不会按 0 元误计。</span></footer>
        </article>

        <article className="iv-panel iv-cost-panel">
          <header><div><p className="eyebrow">COST COVERAGE</p><h2>缺失成本补齐</h2></div><span>{payload?.missingCosts.length || 0} 个待补</span></header>
          {payload?.missingCosts.length ? (
            <>
              <div className="iv-cost-list">
                {payload.missingCosts.slice(0, 6).map((row) => <div key={row.key}><span><strong>{row.sku}</strong><small>{row.productName} · {row.country}</small></span><em>{quantity(row.onHandQty)} 件</em></div>)}
                {payload.missingCosts.length > 6 ? <small>另有 {payload.missingCosts.length - 6} 个 SKU，请下载完整模板。</small> : null}
              </div>
              {payload.permissions.manageCosts ? <div className="iv-cost-actions"><button type="button" onClick={downloadMissingTemplate}><Download size={15} />下载待补模板</button><button className="primary" type="button" disabled={importing} onClick={() => fileRef.current?.click()}><Upload size={15} />{importing ? "导入中" : "导入补齐"}</button></div> : <p className="iv-permission-note">仅管理员可导入成本，请将待补清单交给管理员维护。</p>}
            </>
          ) : <div className="iv-empty compact"><Coins size={25} /><strong>当前成本已覆盖</strong><span>直营供货价优先，补录成本仅作缺失兜底。</span></div>}
          <input ref={fileRef} hidden type="file" accept=".csv,text/csv" onChange={importFile} />
        </article>
      </section>

      <section className="iv-panel iv-table-panel">
        <header>
          <div><p className="eyebrow">SKU MOVEMENT</p><h2>产品货值变化明细</h2><span>共 {rows.length} 个 SKU × 国家</span></div>
          <div className="iv-table-controls"><button className={sortMode === "change" ? "active" : ""} type="button" onClick={() => setSortMode("change")}>按变化排序</button><button className={sortMode === "value" ? "active" : ""} type="button" onClick={() => setSortMode("value")}>按货值排序</button><label><input type="checkbox" checked={onlyMissing} onChange={(event) => setOnlyMissing(event.target.checked)} />只看缺成本</label><button type="button" title="重新查询" onClick={() => void runLoad()}><RefreshCw size={15} /></button></div>
        </header>
        <div className="iv-table">
          <div className="iv-table-row head"><span>产品 / 仓库</span><span>在库数量</span><span>单位成本</span><span>当前货值</span><span>上期货值</span><span>货值变化</span></div>
          {rows.slice(0, 300).map((row) => (
            <div className="iv-table-row" key={row.key}>
              <span className="iv-product-cell">{row.imageUrl ? <img src={resolveApiUrl(row.imageUrl)} alt="" /> : <i><PackageSearch size={18} /></i>}<span><strong>{row.productName || row.sku}</strong><small>{row.sku} · {row.country} · {row.warehouseNames.join("、") || "未标记仓库"}</small></span></span>
              <span><strong>{quantity(row.onHandQty)}</strong><small className={row.quantityChange > 0 ? "positive" : row.quantityChange < 0 ? "negative" : ""}>{row.quantityChange > 0 ? "+" : ""}{quantity(row.quantityChange)}</small></span>
              <span>{row.unitCostCny === null ? <em className="iv-missing">待补</em> : <><strong>¥{row.unitCostCny.toFixed(2)}</strong><small>{row.costSourceLabel}</small></>}</span>
              <span><strong>{row.unitCostCny === null ? "—" : money(row.onHandValueCny)}</strong></span>
              <span><strong>{row.costSource === "missing" ? "—" : money(row.previousValueCny)}</strong></span>
              <span className={row.valueChangeCny > 0 ? "positive" : row.valueChangeCny < 0 ? "negative" : ""}>{row.valueChangeCny > 0 ? <ArrowUpRight size={15} /> : row.valueChangeCny < 0 ? <ArrowDownRight size={15} /> : null}<strong>{row.costSource === "missing" ? "—" : `${row.valueChangeCny > 0 ? "+" : ""}${money(row.valueChangeCny)}`}</strong><small>{row.valueChangeRate === null ? "新增/无上期" : percent(row.valueChangeRate)}</small></span>
            </div>
          ))}
          {!rows.length ? <div className="iv-empty"><PackageSearch size={28} /><strong>没有符合条件的产品</strong><span>请调整筛选条件，或先补齐缺失成本。</span></div> : null}
        </div>
      </section>
    </div>
  );
}
