import React from "react";
import {
  updateMiaoshouShopActivation,
  updatePerformanceRevenueBasis,
  updateShopMiaoshouBinding,
  type MiaoshouRevenueBasis,
  type MiaoshouShopReconciliation,
  type PerformanceAnalyticsPayload,
  type ShopDirectoryPayload,
} from "../api";
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

type ShopFilter = "all" | "effective" | "eligible" | "blocked" | "unbound";

function shopStatus(row: MiaoshouShopReconciliation) {
  if (row.effective) return { label: "使用妙手", tone: "good" };
  if (row.enabled && !row.activationEligible) return { label: "已启用 · 未达标", tone: "warning" };
  if (row.activationEligible) return { label: "达标 · 未启用", tone: "info" };
  if (!row.miaoshouShopId) return { label: "未关联妙手", tone: "muted" };
  return { label: "未达标", tone: "muted" };
}

export function MiaoshouReconciliationDetails({ source, shopDirectory, partitionStats, summaryStore, canManage, onChanged }: {
  source: TransactionSource | null | undefined;
  shopDirectory?: ShopDirectoryPayload;
  partitionStats?: PerformanceAnalyticsPayload["partitionStats"];
  summaryStore?: PerformanceAnalyticsPayload["summaryStore"];
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [shopFilter, setShopFilter] = React.useState<ShopFilter>("all");
  const [shopSearch, setShopSearch] = React.useState("");
  const [shopMessage, setShopMessage] = React.useState("");
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

  const shops = reconciliation.shops || [];
  const directoryByKey = new Map((shopDirectory?.shops || []).map((shop) => [shop.key, shop]));
  const miaoshouShops = shopDirectory?.miaoshouShops || [];
  const term = shopSearch.trim().toLowerCase();
  const visibleShops = shops.filter((row) => {
    if (shopFilter === "effective" && !row.effective) return false;
    if (shopFilter === "eligible" && !(row.activationEligible && !row.effective)) return false;
    if (shopFilter === "blocked" && row.activationEligible) return false;
    if (shopFilter === "unbound" && row.miaoshouShopId) return false;
    if (term && ![row.shopName, row.shopKey, row.projectGroup, row.miaoshouShopId].some((value) => String(value || "").toLowerCase().includes(term))) return false;
    return true;
  });
  const eligibleNotEnabled = shops.filter((row) => row.activationEligible && !row.enabled).map((row) => row.shopKey);

  async function toggleShops(shopKeys: string[], enabled: boolean) {
    if (!shopKeys.length) return;
    setBusy(true);
    setShopMessage("");
    try {
      await updateMiaoshouShopActivation(shopKeys, enabled);
      setShopMessage(enabled ? `已为 ${shopKeys.length} 家店铺启用妙手口径，后台正在重算。` : `已为 ${shopKeys.length} 家店铺停用妙手口径。`);
      await onChanged();
    } catch (error) {
      setShopMessage(error instanceof Error ? error.message : "店铺切换失败");
    } finally {
      setBusy(false);
    }
  }

  async function bindShop(shopKey: string, value: string) {
    setBusy(true);
    setShopMessage("");
    try {
      await updateShopMiaoshouBinding(shopKey, value === "__auto__" ? null : value === "__none__" ? "" : value);
      setShopMessage("店铺关联已更新，后台正在重新对账。");
      await onChanged();
    } catch (error) {
      setShopMessage(error instanceof Error ? error.message : "店铺关联失败");
    } finally {
      setBusy(false);
    }
  }

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

      {partitionStats || summaryStore ? (
        <p className="ms-recon-note">
          {partitionStats ? `后台重算：上次只重算 ${partitionStats.rebuiltPartitionCount} / ${partitionStats.partitionCount} 天，用时 ${(partitionStats.durationMs / 1000).toFixed(1)} 秒。` : ""}
          {summaryStore ? `日汇总存储：${summaryStore.backend === "postgres" ? "PostgreSQL" : "内存"}${summaryStore.lastError ? `（异常：${summaryStore.lastError}）` : ""}。` : ""}
        </p>
      ) : null}

      {shops.length ? (
        <section className="ms-recon-block">
          <header>
            <h4>按店铺切换</h4>
            <p>每家店单独核对；启用且达标的店铺改用妙手为订单主来源：按站点当地支付日期归日，金额取妙手（扣除已完成退款），并补入还没出库的妙手订单。未达标的店铺继续使用 WMS。单店至少 {reconciliation.minimumShopMatchedOrders || 10} 单已匹配才参与判定。</p>
          </header>
          <div className="ms-recon-shop-toolbar">
            {([["all", `全部 ${shops.length}`], ["effective", `使用妙手 ${shops.filter((row) => row.effective).length}`], ["eligible", `达标未启用 ${shops.filter((row) => row.activationEligible && !row.effective).length}`], ["blocked", `未达标 ${shops.filter((row) => !row.activationEligible).length}`], ["unbound", `未关联 ${shops.filter((row) => !row.miaoshouShopId).length}`]] as Array<[ShopFilter, string]>).map(([id, label]) => (
              <button key={id} type="button" className={shopFilter === id ? "active" : ""} onClick={() => setShopFilter(id)}>{label}</button>
            ))}
            <input value={shopSearch} onChange={(event) => setShopSearch(event.target.value)} placeholder="搜索店铺、项目组" />
            {canManage && eligibleNotEnabled.length ? <button className="sync-button" type="button" disabled={busy} onClick={() => void toggleShops(eligibleNotEnabled, true)}>启用全部达标店铺（{eligibleNotEnabled.length}）</button> : null}
          </div>
          {shopMessage ? <p className="ms-recon-message">{shopMessage}</p> : null}
          <div className="ms-recon-table-wrap">
            <table className="ms-recon-table">
              <thead><tr><th>店铺</th><th>妙手店铺</th><th className="num">匹配</th><th className="num">数量差异</th><th className="num">金额差异</th><th className="num">未出库订单</th><th>状态</th>{canManage ? <th /> : null}</tr></thead>
              <tbody>
                {visibleShops.slice(0, 300).map((row) => {
                  const status = shopStatus(row);
                  const profile = directoryByKey.get(row.shopKey);
                  const options = miaoshouShops.filter((shop) => !row.platform || shop.platform.toLowerCase().includes(row.platform.toLowerCase()) || row.platform.toLowerCase().includes(shop.platform.toLowerCase()));
                  const bindingValue = profile?.miaoshouMatchSource === "manual" ? profile.miaoshouShopId : profile?.miaoshouMatchSource === "manual_none" ? "__none__" : "__auto__";
                  return (
                    <tr key={row.shopKey}>
                      <td><strong>{row.shopName}</strong><small>{[row.platform, row.country, row.projectGroup].filter(Boolean).join(" · ")}</small></td>
                      <td>
                        {canManage && miaoshouShops.length ? (
                          <select disabled={busy} value={bindingValue} onChange={(event) => void bindShop(row.shopKey, event.target.value)}>
                            <option value="__auto__">自动匹配{profile?.miaoshouMatchSource === "auto" && row.miaoshouShopId ? `（${row.miaoshouShopId}）` : profile?.miaoshouSuggestedShopId ? `（建议 ${profile.miaoshouSuggestedShopId}）` : ""}</option>
                            <option value="__none__">不关联妙手</option>
                            {options.map((shop) => <option key={shop.shopId} value={shop.shopId}>{shop.name} · {shop.site} · {shop.shopId}</option>)}
                          </select>
                        ) : <span>{row.miaoshouShopId || "未关联"}</span>}
                        {profile?.miaoshouBindingStale ? <small className="ms-recon-warning">绑定的妙手店铺已失效</small> : null}
                      </td>
                      <td className="num">{percent(row.orderMatchRate)}<small>{row.matchedOrderCount} / {row.eligibleOrderCount}</small></td>
                      <td className="num">{percent(row.quantityVarianceRate)}</td>
                      <td className="num">{row.comparableAmountOrders ? percent(row.amountVarianceRate) : "—"}</td>
                      <td className="num">{row.miaoshouOnlyOrderCount || 0}</td>
                      <td><span className={`ms-recon-status ${status.tone}`}>{status.label}</span>{row.blockers.length && !row.effective ? <small title={row.blockers.join("\n")}>{row.blockers[0]}{row.blockers.length > 1 ? ` 等 ${row.blockers.length} 项` : ""}</small> : null}</td>
                      {canManage ? <td>{row.enabled ? <button className="ghost-button" type="button" disabled={busy} onClick={() => void toggleShops([row.shopKey], false)}>停用</button> : <button className="ghost-button" type="button" disabled={busy || !row.activationEligible} title={row.activationEligible ? "" : "达标后才能生效；也可以先启用，达标后自动生效"} onClick={() => void toggleShops([row.shopKey], true)}>启用</button>}</td> : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

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
