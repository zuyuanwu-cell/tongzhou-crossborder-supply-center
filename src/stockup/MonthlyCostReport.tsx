import React, { useEffect, useState } from "react";
import { Download, Search, TrendingUp } from "lucide-react";
import { fetchStockupMonthlyCostReport } from "../api";
import type { StockupMonthlyCostRow } from "./types";

function currentMonth() { return new Date().toISOString().slice(0, 7); }

export function MonthlyCostReport() {
  const [month, setMonth] = useState(currentMonth());
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<StockupMonthlyCostRow[]>([]);
  const [totals, setTotals] = useState({ skuCount: 0, receivedQty: 0, totalCostCny: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try { const payload = await fetchStockupMonthlyCostReport({ month, keyword }); setRows(payload.items); setTotals(payload.totals); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "报表读取失败"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [month]);

  function downloadCsv() {
    const values = [["到仓月份", "国家", "仓库", "SKU", "产品名称", "到仓数量", "批次数", "平均货品成本", "平均分摊费用", "加权到仓单价", "到仓总成本"], ...rows.map((row) => [row.month, row.country, row.warehouseName, row.sku, row.productName, row.receivedQty, row.batchCount, row.goodsUnitCostCny, row.allocatedUnitCostCny, row.weightedUnitCostCny, row.totalCostCny])];
    const csv = `\uFEFF${values.map((line) => line.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `月度到仓成本-${month}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }

  return <section className="sc-panel"><div className="sc-panel-head"><div><span className="sc-eyebrow">MONTHLY LANDED COST</span><h3>月度到仓成本</h3><p>按实际到仓月份汇总已锁定批次，不与库存移动平均混用。</p></div><button className="sc-button sc-button-secondary" disabled={!rows.length} onClick={downloadCsv}><Download size={17} />下载 CSV</button></div>
    <div className="sc-report-toolbar"><label>到仓月份<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label><div><Search size={17} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(); }} placeholder="搜索 SKU 或产品名称" /><button onClick={() => void load()}>查询</button></div></div>
    {error ? <div className="sc-alert sc-alert-danger">{error}</div> : null}
    <div className="sc-report-metrics"><article><small>覆盖 SKU</small><b>{totals.skuCount}</b></article><article><small>到仓良品数量</small><b>{totals.receivedQty.toLocaleString()}</b></article><article><small>到仓总成本</small><b>¥{totals.totalCostCny.toLocaleString()}</b></article><article><TrendingUp size={20} /><small>统计口径</small><b>已锁定批次</b></article></div>
    <div className="sc-report-table"><div className="head"><span>SKU / 产品</span><span>国家 / 仓库</span><span>到仓数量</span><span>批次数</span><span>货品单价</span><span>分摊单价</span><span>加权到仓单价</span><span>总成本</span></div>{rows.map((row) => <div key={`${row.country}-${row.warehouseName}-${row.sku}`}><span><b>{row.sku}</b><small>{row.productName}</small></span><span><b>{row.country}</b><small>{row.warehouseName}</small></span><span>{row.receivedQty}</span><span>{row.batchCount}</span><span>¥{row.goodsUnitCostCny.toFixed(2)}</span><span>¥{row.allocatedUnitCostCny.toFixed(2)}</span><span className="accent">¥{row.weightedUnitCostCny.toFixed(2)}</span><span>¥{row.totalCostCny.toLocaleString()}</span></div>)}</div>
    {!loading && !rows.length ? <div className="sc-empty"><TrendingUp size={34} /><h4>{month} 暂无已锁定成本</h4><p>到仓批次完成费用核算并锁定后，会自动进入本月报表。</p></div> : null}
  </section>;
}
