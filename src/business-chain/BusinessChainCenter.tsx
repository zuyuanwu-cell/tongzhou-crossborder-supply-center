import React from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  FileSearch,
  GitBranch,
  LoaderCircle,
  RefreshCw,
  Search,
  Ship,
  Warehouse,
  X,
} from "lucide-react";
import {
  type AuthUser,
  type BusinessChainContract,
  type BusinessChainContractDetailPayload,
  type BusinessChainContractsPayload,
  type BusinessChainPayablesPayload,
  type BusinessChainSummaryPayload,
  fetchBusinessChainContract,
  fetchBusinessChainContracts,
  fetchBusinessChainPayables,
  fetchBusinessChainSummary,
  syncBusinessChain,
} from "../api";
import "./business-chain.css";

type ViewTab = "contracts" | "finance";

function hasPermission(user: AuthUser, permission: string) {
  return user.role === "admin" || user.permissions.includes(permission);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(Number(value || 0));
}

function formatMoney(value: number, currency = "CNY") {
  const raw = String(currency || "CNY").trim();
  const aliases: Record<string, string> = {
    人民币: "CNY", 人民币元: "CNY", 元: "CNY", RMB: "CNY", "￥": "CNY", "¥": "CNY",
    美元: "USD", 美金: "USD", 欧元: "EUR", 英镑: "GBP", 卢布: "RUB", 俄罗斯卢布: "RUB",
  };
  const normalized = aliases[raw] || raw.toUpperCase();
  try {
    return new Intl.NumberFormat("zh-CN", { style: "currency", currency: /^[A-Z]{3}$/.test(normalized) ? normalized : "CNY", maximumFractionDigits: 2 }).format(Number(value || 0));
  } catch {
    return `¥${formatNumber(value)}`;
  }
}

function formatDate(value: string, withTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", withTime ? {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  } : { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function stageClass(status: string) {
  return status === "complete" ? "is-complete" : status === "active" ? "is-active" : "is-pending";
}

function FreshnessBadge({ summary }: { summary: BusinessChainSummaryPayload | null }) {
  if (!summary) return <span className="bc-source-pill is-muted">等待读取</span>;
  if (summary.sync.running) return <span className="bc-source-pill is-syncing"><LoaderCircle size={14} className="bc-spin" /> 正在同步 {summary.sync.currentForm || "业务数据"}</span>;
  if (!summary.freshness.updatedAt) return <span className="bc-source-pill is-warning">尚未建立索引</span>;
  return (
    <span className={`bc-source-pill ${summary.freshness.complete ? "is-good" : "is-warning"}`}>
      {summary.freshness.complete ? <Check size={14} /> : <AlertTriangle size={14} />}
      {summary.freshness.complete ? "链路索引完整" : `${summary.freshness.failedForms.length} 个来源异常`} · {formatDate(summary.freshness.updatedAt, true)}
    </span>
  );
}

function ContractStages({ contract }: { contract: BusinessChainContract }) {
  return (
    <div className="bc-stage-track" aria-label={`${contract.documentNo} 履约进度`}>
      {contract.stages.map((stage, index) => (
        <React.Fragment key={stage.key}>
          <div className={`bc-stage ${stageClass(stage.status)}`} title={stage.lastAt ? `${stage.label}：${formatDate(stage.lastAt)}` : `${stage.label}：暂无关联单据`}>
            <span>{stage.status === "complete" ? <Check size={12} /> : index + 1}</span>
            <small>{stage.label}</small>
          </div>
          {index < contract.stages.length - 1 ? <i aria-hidden="true" /> : null}
        </React.Fragment>
      ))}
    </div>
  );
}

function TongzhouSkuList({ skus, compact = false }: { skus: string[]; compact?: boolean }) {
  if (!skus.length) return <span className="bc-sku-empty">生产单暂未填写同舟 SKU</span>;
  const visible = compact ? skus.slice(0, 4) : skus;
  return (
    <div className="bc-sku-list" aria-label="同舟 SKU">
      {visible.map((sku) => <span key={sku}>{sku}</span>)}
      {compact && skus.length > visible.length ? <em>+{skus.length - visible.length}</em> : null}
    </div>
  );
}

function ContractDrawer({ detail, loading, onClose, canViewFinance }: { detail: BusinessChainContractDetailPayload | null; loading: boolean; onClose: () => void; canViewFinance: boolean }) {
  return (
    <div className="bc-drawer-layer" role="dialog" aria-modal="true" aria-label="合同业务链路详情" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <aside className="bc-drawer">
        <header>
          <div>
            <p className="bc-eyebrow">CONTRACT TRACE</p>
            <h2>{detail?.contract.documentNo || "正在读取合同链路"}</h2>
            <span>{detail?.contract.customerName || "请稍候"}</span>
          </div>
          <button className="bc-icon-button" type="button" onClick={onClose} aria-label="关闭"><X size={19} /></button>
        </header>
        {loading ? (
          <div className="bc-drawer-loading"><LoaderCircle size={26} className="bc-spin" /> 正在整理合同上下游单据…</div>
        ) : detail ? (
          <>
            <div className="bc-detail-metrics">
              <div><span>合同数量</span><strong>{formatNumber(detail.contract.quantity)}</strong></div>
              <div><span>累计入库</span><strong>{formatNumber(detail.metrics.inboundQty)}</strong></div>
              <div><span>累计发货</span><strong>{formatNumber(detail.metrics.shippedQty)}</strong></div>
              <div><span>链路单据</span><strong>{detail.documents.length}</strong></div>
              {canViewFinance ? <div><span>待付供应商</span><strong>{formatMoney(detail.metrics.unpaidAmount || 0)}</strong></div> : null}
            </div>
            <section className="bc-contract-skus">
              <div><span>同舟 SKU</span><small>取自关联合同号一致的生产单</small></div>
              <TongzhouSkuList skus={detail.contract.tongzhouSkus} />
            </section>
            <section className="bc-detail-section">
              <div className="bc-section-title"><div><p className="bc-eyebrow">FULFILLMENT</p><h3>合同履约时间线</h3></div></div>
              <div className="bc-timeline">
                {detail.documents.map((document) => (
                  <article key={document.id} className="bc-timeline-item">
                    <div className="bc-timeline-marker"><span /></div>
                    <div className="bc-document-card">
                      <div className="bc-document-head">
                        <div><span>{document.documentTypeLabel}</span><strong>{document.documentNo || "未生成单号"}</strong></div>
                        <time>{formatDate(document.occurredAt)}</time>
                      </div>
                      <div className="bc-document-meta">
                        <span>状态：{document.status || "未标记"}</span>
                        <span>数量：{formatNumber(document.quantity)}</span>
                        {canViewFinance && document.supplierName ? <span>供应商：{document.supplierName}</span> : null}
                        {canViewFinance && document.amount ? <span>金额：{formatMoney(document.amount, document.currency)}</span> : null}
                      </div>
                      {document.lines?.length ? (
                        <div className="bc-line-list">
                          {document.lines.slice(0, 8).map((line) => (
                            <div key={line.id}><span>{line.sku || "无 SKU"}</span><strong>{line.name || "未命名产品"}</strong><em>{formatNumber(line.quantity)} {line.unit}</em></div>
                          ))}
                          {document.lines.length > 8 ? <small>另有 {document.lines.length - 8} 条明细</small> : null}
                        </div>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </>
        ) : <div className="bc-empty"><AlertTriangle size={24} /><strong>未能读取该合同链路</strong><span>请关闭后重试。</span></div>}
      </aside>
    </div>
  );
}

export function BusinessChainCenter({ user }: { user: AuthUser }) {
  const canViewFinance = hasPermission(user, "contract_finance_view");
  const canSync = hasPermission(user, "business_chain_sync");
  const [tab, setTab] = React.useState<ViewTab>("contracts");
  const [summary, setSummary] = React.useState<BusinessChainSummaryPayload | null>(null);
  const [contracts, setContracts] = React.useState<BusinessChainContractsPayload | null>(null);
  const [payables, setPayables] = React.useState<BusinessChainPayablesPayload | null>(null);
  const [keyword, setKeyword] = React.useState("");
  const [queryKeyword, setQueryKeyword] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(true);
  const [syncing, setSyncing] = React.useState(false);
  const [error, setError] = React.useState("");
  const [detail, setDetail] = React.useState<BusinessChainContractDetailPayload | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [detailLoading, setDetailLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const tasks: [Promise<BusinessChainSummaryPayload>, Promise<BusinessChainContractsPayload>, Promise<BusinessChainPayablesPayload> | null] = [
        fetchBusinessChainSummary(),
        fetchBusinessChainContracts({ keyword: queryKeyword, page, pageSize: 20 }),
        canViewFinance ? fetchBusinessChainPayables(queryKeyword) : null,
      ];
      const [nextSummary, nextContracts, nextPayables] = await Promise.all([tasks[0], tasks[1], tasks[2] || Promise.resolve(null)]);
      setSummary(nextSummary);
      setContracts(nextContracts);
      setPayables(nextPayables);
      setSyncing(nextSummary.sync.running);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "业务链路读取失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, [canViewFinance, page, queryKeyword]);

  React.useEffect(() => { void load(); }, [load]);
  React.useEffect(() => {
    if (!syncing) return undefined;
    const timer = window.setInterval(() => { void load(); }, 3500);
    return () => window.clearInterval(timer);
  }, [load, syncing]);

  async function handleSync() {
    setError("");
    try {
      const result = await syncBusinessChain();
      setSyncing(result.accepted || result.reason === "already_running");
      window.setTimeout(() => { void load(); }, 900);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "同步任务提交失败。");
    }
  }

  async function openContract(contract: BusinessChainContract) {
    setDetailOpen(true);
    setDetail(null);
    setDetailLoading(true);
    try {
      setDetail(await fetchBusinessChainContract(contract.id));
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : "合同详情读取失败。");
    } finally {
      setDetailLoading(false);
    }
  }

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    setPage(1);
    setQueryKeyword(keyword.trim());
  }

  function switchTab(nextTab: ViewTab) {
    if (nextTab === tab) return;
    setTab(nextTab);
    setKeyword("");
    setQueryKeyword("");
    setPage(1);
  }

  const cards = [
    { label: "生产中合同", value: summary?.counts.activeContracts ?? "—", hint: `同舟生效合同 ${summary?.counts.contracts ?? "—"}`, icon: GitBranch },
    { label: "累计入库数量", value: summary ? formatNumber(summary.counts.inboundQty) : "—", hint: "采购 + 委外入库", icon: Warehouse },
    { label: "累计发货数量", value: summary ? formatNumber(summary.counts.shippedQty) : "—", hint: "销售发货单累计", icon: Ship },
    { label: "待人工关联", value: summary?.counts.pendingLinks ?? "—", hint: "不凭 SKU 猜测关系", icon: FileSearch, warning: Boolean(summary?.counts.pendingLinks) },
  ];

  return (
    <main className="bc-page">
      <section className="bc-hero">
        <div>
          <p className="bc-eyebrow">BUSINESS CHAIN CONTROL</p>
          <h1>业务链路中心</h1>
          <p>仅呈现已审批生效的同舟内部合同，从生产、采购到入库、发货与结算全程可追溯。</p>
          <div className="bc-source-row"><FreshnessBadge summary={summary} /><span>数据源：千顷 ERP · 只读索引</span></div>
        </div>
        {canSync ? <button className="bc-primary-button" type="button" onClick={handleSync} disabled={syncing}><RefreshCw size={17} className={syncing ? "bc-spin" : ""} />{syncing ? "正在后台同步" : "刷新业务链路"}</button> : null}
      </section>

      {error ? <div className="bc-alert"><AlertTriangle size={18} /><span>{error}</span><button type="button" onClick={() => setError("")}><X size={16} /></button></div> : null}

      <section className="bc-metric-grid">
        {cards.map(({ label, value, hint, icon: Icon, warning }) => <article key={label} className={warning ? "is-warning" : ""}><Icon size={20} /><div><span>{label}</span><strong>{value}</strong><small>{hint}</small></div></article>)}
      </section>

      <section className="bc-workspace">
        <div className="bc-tabs" role="tablist">
          <button type="button" className={tab === "contracts" ? "is-active" : ""} onClick={() => switchTab("contracts")}><GitBranch size={18} />合同履约链路</button>
          {canViewFinance ? <button type="button" className={tab === "finance" ? "is-active" : ""} onClick={() => switchTab("finance")}><CircleDollarSign size={18} />合同财务台账</button> : null}
        </div>

        <form className="bc-toolbar" onSubmit={submitSearch}>
          <label><Search size={17} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={tab === "finance" ? "搜索供应商" : "搜索合同号、客户名称"} /></label>
          <button type="submit">查询</button>
        </form>

        {tab === "contracts" ? (
          <div className="bc-contract-list">
            {loading && !contracts ? <div className="bc-empty"><LoaderCircle size={25} className="bc-spin" /><strong>正在建立合同视图</strong></div> : null}
            {!loading && contracts?.contracts.length === 0 ? <div className="bc-empty"><FileSearch size={27} /><strong>{summary?.freshness.updatedAt ? "没有符合条件的合同" : "业务链路索引尚未生成"}</strong><span>{summary?.freshness.updatedAt ? "请调整查询条件。" : canSync ? "点击右上角“刷新业务链路”开始建立只读索引。" : "请联系管理员执行首次同步。"}</span></div> : null}
            {contracts?.contracts.map((contract) => (
              <article className="bc-contract-card" key={contract.id}>
                <div className="bc-contract-main">
                  <div className="bc-contract-title"><div><span className="bc-kind-tag is-internal">同舟生效</span><h3>{contract.documentNo || "未生成合同号"}</h3></div><span className="bc-status-tag">{contract.status || "状态未标记"}</span></div>
                  <p>{contract.customerName || "客户名称未填写"} · 生效于 {formatDate(contract.effectiveAt || contract.occurredAt)}{contract.ageDays !== null ? ` · 已生效 ${contract.ageDays} 天` : ""}</p>
                  <div className="bc-card-skus"><span>同舟 SKU</span><TongzhouSkuList skus={contract.tongzhouSkus} compact /></div>
                  <ContractStages contract={contract} />
                </div>
                <div className="bc-contract-numbers">
                  <div><span>合同数量</span><strong>{formatNumber(contract.quantity)}</strong></div>
                  <div><span>入库 / 发货</span><strong>{formatNumber(contract.inboundQty)} / {formatNumber(contract.shippedQty)}</strong></div>
                  <div><span>关联单据</span><strong>{contract.linkedDocumentCount}</strong></div>
                  {canViewFinance ? <div><span>待付供应商</span><strong>{formatMoney(contract.unpaidAmount || 0)}</strong></div> : null}
                  <button type="button" onClick={() => void openContract(contract)}>查看链路 <ArrowRight size={16} /></button>
                </div>
              </article>
            ))}
            {contracts && contracts.pagination.totalPages > 1 ? <div className="bc-pagination"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={16} />上一页</button><span>第 {page} / {contracts.pagination.totalPages} 页 · 共 {contracts.pagination.total} 份合同</span><button type="button" disabled={page >= contracts.pagination.totalPages} onClick={() => setPage((value) => value + 1)}>下一页<ChevronRight size={16} /></button></div> : null}
          </div>
        ) : (
          <div className="bc-finance-shell">
            <div className="bc-finance-metrics"><div><span>入库应付</span><strong>{formatMoney(payables?.totals.accruedPayable || 0)}</strong></div><div><span>已登记付款</span><strong>{formatMoney(payables?.totals.paidAmount || 0)}</strong></div><div className="is-emphasis"><span>待核对应付</span><strong>{formatMoney(payables?.totals.unpaidAmount || 0)}</strong></div></div>
            <div className="bc-table-wrap"><table><thead><tr><th>供应商</th><th>入库单</th><th>付款/结算单</th><th>入库应付</th><th>已登记付款</th><th>待核对应付</th><th>最后发生</th><th>状态</th></tr></thead><tbody>{payables?.suppliers.map((supplier) => <tr key={`${supplier.supplierId}:${supplier.supplierName}`}><td><strong>{supplier.supplierName}</strong><small>{supplier.supplierId || "无供应商编号"}</small></td><td>{supplier.inboundDocumentCount}</td><td>{supplier.paymentDocumentCount}</td><td>{formatMoney(supplier.accruedPayable)}</td><td>{formatMoney(supplier.paidAmount)}</td><td className="bc-money-due">{formatMoney(supplier.unpaidAmount)}</td><td>{formatDate(supplier.lastOccurredAt)}</td><td><span className="bc-status-tag">{supplier.reconciliationStatus}</span></td></tr>)}</tbody></table>{!loading && payables?.suppliers.length === 0 ? <div className="bc-empty"><CircleDollarSign size={27} /><strong>暂无供应商应付记录</strong><span>待采购入库或委外入库数据同步后自动汇总。</span></div> : null}</div>
            <p className="bc-ledger-note">当前金额为管理视图：以入库单应付减去预付款/结算单已付计算，正式入账前仍需财务核对付款归属和冲销关系。</p>
          </div>
        )}
      </section>

      {detailOpen ? <ContractDrawer detail={detail} loading={detailLoading} canViewFinance={canViewFinance} onClose={() => setDetailOpen(false)} /> : null}
    </main>
  );
}
