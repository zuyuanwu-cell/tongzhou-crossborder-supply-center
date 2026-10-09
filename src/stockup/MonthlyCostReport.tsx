import React, { useEffect, useState } from "react";
import { Archive, Download, RotateCcw, Search, Trash2, TrendingUp } from "lucide-react";
import { changeStockupMonthlyCostPeriod, fetchStockupMonthlyCostPeriods, fetchStockupMonthlyCostReport } from "../api";
import type { StockupMonthlyCostPeriod, StockupMonthlyCostRow } from "./types";

function currentMonth() { return new Date().toISOString().slice(0, 7); }

export function MonthlyCostReport({ canManage = false }: { canManage?: boolean }) {
  const [month, setMonth] = useState(currentMonth());
  const [view, setView] = useState<"active" | "archived" | "deleted">("active");
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<StockupMonthlyCostRow[]>([]);
  const [periods, setPeriods] = useState<StockupMonthlyCostPeriod[]>([]);
  const [period, setPeriod] = useState<StockupMonthlyCostPeriod>({ month: currentMonth(), status: "active", batchCount: 0, archivedAt: "", archivedBy: "", deletedAt: "", deletedBy: "" });
  const [totals, setTotals] = useState({ skuCount: 0, receivedQty: 0, totalCostCny: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const periodPayload = await fetchStockupMonthlyCostPeriods(view);
      setPeriods(periodPayload.periods);
      let targetMonth = month;
      if (view !== "active" && !periodPayload.periods.some((item) => item.month === targetMonth)) targetMonth = periodPayload.periods[0]?.month || "";
      if (!targetMonth) { setRows([]); setTotals({ skuCount: 0, receivedQty: 0, totalCostCny: 0 }); return; }
      if (targetMonth !== month) setMonth(targetMonth);
      const payload = await fetchStockupMonthlyCostReport({ month: targetMonth, keyword });
      setRows(payload.items); setTotals(payload.totals); setPeriod(payload.period);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "报表读取失败"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [month, view]);

  async function changeLifecycle(action: "archive" | "activate" | "delete" | "restore") {
    if (action === "delete" && !window.confirm(`${month} 月成本报表将移入回收站，历史成本不会物理删除。是否继续？`)) return;
    setLoading(true); setError("");
    try {
      const result = await changeStockupMonthlyCostPeriod(month, action);
      setPeriod(result.period);
      setView(result.period.status);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "报表状态更新失败"); }
    finally { setLoading(false); }
  }

  function downloadCsv() {
    const values = [["到仓月份", "国家", "仓库", "SKU", "产品名称", "到仓数量", "批次数", "平均货品成本", "平均分摊费用", "加权到仓单价", "到仓总成本"], ...rows.map((row) => [row.month, row.country, row.warehouseName, row.sku, row.productName, row.receivedQty, row.batchCount, row.goodsUnitCostCny, row.allocatedUnitCostCny, row.weightedUnitCostCny, row.totalCostCny])];
    const csv = `\uFEFF${values.map((line) => line.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `月度到仓成本-${month}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }

  return <section className="sc-panel"><div className="sc-panel-head"><div><span className="sc-eyebrow">MONTHLY LANDED COST</span><h3>月度到仓成本</h3><p>按实际到仓月份汇总已锁定批次；归档与删除只改变报表可见性，完整财务数据始终保留。</p></div><div className="sc-report-actions">{canManage && period.status === "active" && rows.length ? <button className="sc-button sc-button-secondary" onClick={() => void changeLifecycle("archive")}><Archive size={16} />归档本月</button> : null}{canManage && period.status === "archived" ? <><button className="sc-button sc-button-secondary" onClick={() => void changeLifecycle("activate")}><RotateCcw size={16} />取消归档</button><button className="sc-button sc-button-danger" onClick={() => void changeLifecycle("delete")}><Trash2 size={16} />移入回收站</button></> : null}{canManage && period.status === "deleted" ? <button className="sc-button sc-button-secondary" onClick={() => void changeLifecycle("restore")}><RotateCcw size={16} />恢复到归档</button> : null}<button className="sc-button sc-button-secondary" disabled={!rows.length} onClick={downloadCsv}><Download size={17} />下载 CSV</button></div></div>
    <div className="sc-lifecycle-tabs sc-report-lifecycle-tabs">{([['active','当前报表'],['archived','已归档'],['deleted','回收站']] as const).map(([id, label]) => <button className={view === id ? "is-active" : ""} key={id} onClick={() => setView(id)}>{label}</button>)}</div>
    <div className="sc-report-toolbar"><label>到仓月份{view === "active" ? <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /> : <select value={month} onChange={(event) => setMonth(event.target.value)}>{periods.map((item) => <option key={item.month} value={item.month}>{item.month} · {item.batchCount} 个批次</option>)}</select>}</label><div><Search size={17} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(); }} placeholder="搜索 SKU 或产品名称" /><button onClick={() => void load()}>查询</button></div></div>
    {error ? <div className="sc-alert sc-alert-danger">{error}</div> : null}
    <div className="sc-report-metrics"><article><small>覆盖 SKU</small><b>{totals.skuCount}</b></article><article><small>到仓良品数量</small><b>{totals.receivedQty.toLocaleString()}</b></article><article><small>到仓总成本</small><b>¥{totals.totalCostCny.toLocaleString()}</b></article><article><TrendingUp size={20} /><small>报表状态</small><b>{period.status === "deleted" ? "回收站" : period.status === "archived" ? "已归档" : "当前"}</b></article></div>
    <div className="sc-report-table"><div className="head"><span>SKU / 产品</span><span>国家 / 仓库</span><span>到仓数量</span><span>批次数</span><span>货品单价</span><span>分摊单价</span><span>加权到仓单价</span><span>总成本</span></div>{rows.map((row) => <div key={`${row.country}-${row.warehouseName}-${row.sku}`}><span><b>{row.sku}</b><small>{row.productName}</small></span><span><b>{row.country}</b><small>{row.warehouseName}</small></span><span>{row.receivedQty}</span><span>{row.batchCount}</span><span>¥{row.goodsUnitCostCny.toFixed(2)}</span><span>¥{row.allocatedUnitCostCny.toFixed(2)}</span><span className="accent">¥{row.weightedUnitCostCny.toFixed(2)}</span><span>¥{row.totalCostCny.toLocaleString()}</span></div>)}</div>
    {!loading && !rows.length ? <div className="sc-empty"><TrendingUp size={34} /><h4>{view === "active" ? `${month} 暂无已锁定成本` : view === "archived" ? "暂无已归档月度报表" : "回收站为空"}</h4><p>{view === "active" ? "到仓批次完成费用核算并锁定后，会自动进入本月报表。" : "切换到其他分组查看报表。"}</p></div> : null}
  </section>;
}
