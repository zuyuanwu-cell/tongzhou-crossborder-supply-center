import React from "react";
import { updatePerformanceRevenueBasis, type MiaoshouRevenueBasis, type PerformanceAnalyticsPayload } from "../api";
import "./reconciliation-details.css";

type TransactionSource = NonNullable<PerformanceAnalyticsPayload["transactionSource"]>;

const BASIS_LABEL: Record<MiaoshouRevenueBasis, { title: string; hint: string }> = {
  payAmount: { title: "买家实付", hint: "含运费、扣除平台券" },
  orderAmount: { title: "订单金额", hint: "妙手订单总额" },
  productAmount: { title: "商品金额", hint: "接近平台后台「销售额」" },
  escrowAmount: { title: "结算到账", hint: "平台实际打款，适合算利润" },
};

const STATUS_CLASS_LABEL: Record<string, string> = {
  finalized: "已完成",
  pending: "处理中",
  rejected: "已驳回/撤销",
  unknown: "待确认",
};

function percent(value: number | undefined | null) {
  return value === undefined || value === null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(2)}%`;
}

function dateTime(value: string | undefined) {
  if (!value) return "—";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString("zh-CN", { hour12: false }) : value;
}

export function MiaoshouReconciliationDetails({ source, canManage, onChanged }: { source: TransactionSource | null | undefined; canManage: boolean; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  if (!source) return null;
  const sync = source.sync;
  const reconciliation = source.reconciliation;
  const currentBasis = reconciliation.revenueBasis || "payAmount";
  const comparisons = reconciliation.basisComparison || [];
  const bestBasis = comparisons
    .filter((row) => row.comparableOrders > 0)
    .sort((left, right) => left.amountVarianceRate - right.amountVarianceRate)[0]?.basis;
  const dictionary = reconciliation.statusDictionary || [];
  const gaps = sync.afterSalesGaps || [];

  async function chooseBasis(basis: MiaoshouRevenueBasis) {
    setBusy(true);
    setMessage("");
    try {
      await updatePerformanceRevenueBasis(basis);
      setMessage(`已切换为「${BASIS_LABEL[basis].title}」口径，后台正在重算对账结果。`);
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "金额口径切换失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ms-recon">
      <div className="ms-recon-sync">
        <article><span>同步方式</span><strong>{sync.incrementalMode === "cursor" ? "按修改时间增量" : "按天回看"}</strong><small>{sync.modifiedCursor ? `已同步到 ${sync.modifiedCursor}` : "等待首次同步"}{sync.windowSplits ? ` · 自动拆分 ${sync.windowSplits} 次` : ""}</small></article>
        <article><span>订单同步</span><strong>{sync.status === "success" ? "正常" : sync.status === "partial" ? "部分店铺异常" : sync.status === "running" ? "同步中" : sync.status === "failed" ? "失败" : "—"}</strong><small>每 {sync.intervalMinutes || "—"} 分钟 · 最近成功 {dateTime(sync.lastSuccessAt)}</small></article>
        <article className={gaps.length ? "warning" : ""}><span>售后同步</span><strong>{gaps.length ? `${gaps.length} 段待补齐` : sync.afterSalesStatus === "success" ? "正常" : "—"}</strong><small>最近拉取 {dateTime(sync.lastAfterSalesAt)}{sync.afterSalesSkipped ? " · 本轮按节奏跳过" : ""}</small></article>
        <article><span>售后处理中</span><strong>{(reconciliation.pendingRefundCount || 0) + (reconciliation.pendingCancellationCount || 0)} 笔</strong><small>退款 {reconciliation.pendingRefundCount || 0} · 取消 {reconciliation.pendingCancellationCount || 0}；不计入净额</small></article>
      </div>

      {comparisons.length ? (
        <section className="ms-recon-block">
          <header>
            <h4>金额口径</h4>
            <p>下表是每种口径与 WMS 订单金额的差异率，越接近 0 越一致。选中的口径用于对账门槛和切换后的正式收入。</p>
          </header>
          <div className="ms-recon-basis">
            {comparisons.map((row) => (
              <article key={row.basis} className={`${row.basis === currentBasis ? "active" : ""} ${row.basis === bestBasis ? "best" : ""}`}>
                <span>{BASIS_LABEL[row.basis]?.title || row.basis}{row.basis === bestBasis ? <em>最接近 WMS</em> : null}</span>
                <strong>{row.comparableOrders ? percent(row.amountVarianceRate) : "无数据"}</strong>
                <small>{BASIS_LABEL[row.basis]?.hint} · {row.comparableOrders} 单可比</small>
                {canManage && row.basis !== currentBasis ? <button className="ghost-button" type="button" disabled={busy} onClick={() => void chooseBasis(row.basis)}>使用此口径</button> : row.basis === currentBasis ? <b>当前口径</b> : null}
              </article>
            ))}
          </div>
          {message ? <p className="ms-recon-message">{message}</p> : null}
        </section>
      ) : null}

      {gaps.length ? (
        <section className="ms-recon-block">
          <header><h4>售后待补齐时间段</h4><p>这些时间段的售后接口上次请求失败，下一轮同步会优先补拉；补齐前不会切换妙手正式口径。</p></header>
          <table className="ms-recon-table">
            <thead><tr><th>类型</th><th>平台</th><th>时间段</th><th>失败原因</th><th>失败时间</th></tr></thead>
            <tbody>{gaps.map((gap) => <tr key={`${gap.kind}-${gap.platform}-${gap.dateFrom}`}><td>{gap.kind === "return" ? "退款" : "取消"}</td><td>{gap.platform}</td><td>{gap.dateFrom} ~ {gap.dateTo}</td><td>{gap.error}</td><td>{dateTime(gap.failedAt)}</td></tr>)}</tbody>
          </table>
        </section>
      ) : null}

      {dictionary.length ? (
        <section className="ms-recon-block">
          <header><h4>售后状态字典</h4><p>妙手返回的售后状态及系统判定结果。「待确认」的状态不会计为已完成，请核对后反馈，以便补充规则。</p></header>
          <table className="ms-recon-table">
            <thead><tr><th>类型</th><th>妙手状态</th><th>系统判定</th><th className="num">记录数</th></tr></thead>
            <tbody>{dictionary.map((row) => <tr key={`${row.kind}-${row.status}-${row.statusClass}`} className={row.statusClass === "unknown" ? "warning" : ""}><td>{row.kind === "return" ? "退款" : "取消"}</td><td>{row.status}</td><td><span className={`ms-recon-class ${row.statusClass}`}>{STATUS_CLASS_LABEL[row.statusClass] || row.statusClass}</span></td><td className="num">{row.count}</td></tr>)}</tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
