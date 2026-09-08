import React from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  Clipboard,
  Copy,
  FileImage,
  LoaderCircle,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Truck,
  Upload,
  X,
} from "lucide-react";
import {
  AfterSalesAttachment,
  AfterSalesCustomer,
  AfterSalesItem,
  AfterSalesOrderSyncPayload,
  AfterSalesPayload,
  AfterSalesReissueItem,
  AfterSalesTicket,
  AuthUser,
  createAfterSalesTicket,
  downloadAfterSalesAttachment,
  fetchAfterSales,
  fetchAfterSalesTicket,
  resolveApiUrl,
  syncAfterSalesOrder,
  updateAfterSalesWarehouse,
  uploadAfterSalesAttachment,
} from "./api";

const primaryReasons = ["仓库错发", "仓库漏发少发", "产品质量问题", "快递丢失", "运输破损", "SKU匹配错误"];
const secondaryReasons = ["补发且留错品", "仓库发错货，客户差评不退货", "客户补差价留错品", "客户退全款且退货"];

const statusMeta: Record<string, { label: string; tone: string }> = {
  pending_warehouse: { label: "待仓库接单", tone: "warning" },
  processing: { label: "处理中", tone: "info" },
  awaiting_reshipment: { label: "待补发", tone: "danger" },
  shipped: { label: "补发已发出", tone: "good" },
  completed: { label: "已完结", tone: "muted" },
  cancelled: { label: "已作废", tone: "muted" },
};

const blankCustomer: AfterSalesCustomer = {
  name: "",
  phone: "",
  country: "",
  province: "",
  city: "",
  district: "",
  address: "",
  postalCode: "",
};

function hasPermission(user: AuthUser, permission: string) {
  return Boolean(user.permissions?.includes(permission));
}

function money(value: number) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(Number(value || 0));
}

function dateTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function fileSize(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("读取文件失败。"));
    reader.readAsDataURL(file);
  });
}

function responsibilityFor(primary: string, secondary: string) {
  if (["仓库错发", "仓库漏发少发"].includes(primary) || secondary === "仓库发错货，客户差评不退货") {
    return { party: "warehouse", label: "仓库承担", explanation: "履约环节责任，系统计入受影响商品成本与打包费减免。" };
  }
  if (primary === "产品质量问题") return { party: "supplier_quality", label: "产品 / 供应链", explanation: "默认进入质量追责，仓库承担金额为 0；管理员可复核转责。" };
  if (["快递丢失", "运输破损"].includes(primary)) return { party: "logistics", label: "物流承运方", explanation: "默认进入物流索赔，仓库仅协助举证；包装不当时应由管理员转责。" };
  if (primary === "SKU匹配错误") return { party: "operations", label: "运营 / 系统", explanation: "默认按映射或配置问题处理，不自动计入仓库承担。" };
  return { party: "pending_review", label: "待选择原因", explanation: "选择一级分类后自动判断责任归属。" };
}

function customerText(customer?: AfterSalesCustomer) {
  if (!customer) return "";
  const address = [customer.country, customer.province, customer.city, customer.district, customer.address].filter(Boolean).join(" ");
  return [customer.name, customer.phone, address, customer.postalCode ? `邮编：${customer.postalCode}` : ""].filter(Boolean).join("\n");
}

function reissueText(items: AfterSalesReissueItem[]) {
  return items.map((item) => `${item.sku}  ${item.productName}  × ${item.quantity}`).join("\n");
}

function AttachmentList({ attachments, onDownload }: { attachments: AfterSalesAttachment[]; onDownload: (attachment: AfterSalesAttachment) => void }) {
  if (!attachments.length) return <span className="as-empty-inline">暂无附件</span>;
  return (
    <div className="as-attachment-list">
      {attachments.map((attachment) => (
        <button type="button" key={attachment.id} onClick={() => onDownload(attachment)}>
          <FileImage size={15} />
          <span>{attachment.fileName}</span>
          <small>{fileSize(attachment.size)}</small>
        </button>
      ))}
    </div>
  );
}

export function AfterSalesCenter({ currentUser }: { currentUser: AuthUser }) {
  const canReport = hasPermission(currentUser, "after_sales_report");
  const canWarehouse = hasPermission(currentUser, "after_sales_warehouse");
  const canAdmin = hasPermission(currentUser, "operations");
  const [tab, setTab] = React.useState<"report" | "warehouse">(canReport ? "report" : "warehouse");
  const [payload, setPayload] = React.useState<AfterSalesPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");
  const [orderNumber, setOrderNumber] = React.useState("");
  const [syncedOrder, setSyncedOrder] = React.useState<AfterSalesOrderSyncPayload["order"] | null>(null);
  const [customer, setCustomer] = React.useState<AfterSalesCustomer>(blankCustomer);
  const [items, setItems] = React.useState<AfterSalesItem[]>([]);
  const [primaryReason, setPrimaryReason] = React.useState("");
  const [secondaryReason, setSecondaryReason] = React.useState("");
  const [needsReissue, setNeedsReissue] = React.useState(false);
  const [reissueItems, setReissueItems] = React.useState<AfterSalesReissueItem[]>([]);
  const [evidence, setEvidence] = React.useState<AfterSalesAttachment[]>([]);
  const [operatorRemark, setOperatorRemark] = React.useState("");
  const [additionalLiability, setAdditionalLiability] = React.useState(0);
  const [customerRecovery, setCustomerRecovery] = React.useState(0);
  const [adjustmentReason, setAdjustmentReason] = React.useState("");
  const [keyword, setKeyword] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [selectedTicket, setSelectedTicket] = React.useState<AfterSalesTicket | null>(null);
  const [warehouseRemark, setWarehouseRemark] = React.useState("");
  const [labelUploads, setLabelUploads] = React.useState<AfterSalesAttachment[]>([]);

  const responsibility = responsibilityFor(primaryReason, secondaryReason);
  const affectedCost = responsibility.party === "warehouse"
    ? items.reduce((sum, item) => sum + Number(item.unitCostCny || 0) * Number(item.affectedQty || 0), 0)
    : 0;
  const packagingFee = responsibility.party === "warehouse" ? Number(syncedOrder?.packagingFeeCny || 0) : 0;
  const liabilityTotal = Math.max(0, affectedCost + packagingFee + Number(additionalLiability || 0) - Number(customerRecovery || 0));
  const missingCosts = responsibility.party === "warehouse"
    ? items.filter((item) => item.affectedQty > 0 && item.unitCostCny <= 0).map((item) => item.sku)
    : [];
  const effectiveNeedsReissue = secondaryReason === "补发且留错品" || needsReissue;

  const refresh = React.useCallback(async (filters: { status?: string; keyword?: string } = {}) => {
    setLoading(true);
    try {
      setPayload(await fetchAfterSales(filters));
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "读取售后单失败。");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void refresh(); }, [refresh]);

  React.useEffect(() => {
    if (secondaryReason === "补发且留错品") setNeedsReissue(true);
  }, [secondaryReason]);

  async function handleSyncOrder() {
    const normalized = orderNumber.trim();
    if (!normalized) {
      setError("请输入平台后台订单号。");
      return;
    }
    setBusy("sync");
    setError("");
    setMessage("");
    try {
      const result = await syncAfterSalesOrder(normalized);
      setSyncedOrder(result.order);
      setCustomer({ ...blankCustomer, ...result.order.customer });
      setItems(result.order.items.map((item) => ({ ...item })));
      setReissueItems([]);
      setMessage(result.warning || (result.source === "miaoshou_live" ? "已从妙手实时同步原订单。" : "已从本地妙手缓存读取原订单。"));
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "同步原订单失败。");
    } finally {
      setBusy("");
    }
  }

  function updateItem(sku: string, patch: Partial<AfterSalesItem>) {
    setItems((current) => current.map((item) => item.sku === sku ? { ...item, ...patch } : item));
  }

  function toggleReissue(source: AfterSalesItem) {
    setReissueItems((current) => {
      if (current.some((item) => item.sku === source.sku)) return current.filter((item) => item.sku !== source.sku);
      return [...current, { sku: source.sku, productName: source.productName, imageUrl: source.imageUrl, quantity: Math.max(1, source.affectedQty || 1) }];
    });
  }

  function addManualReissueItem() {
    setReissueItems((current) => [...current, { sku: `待填写-${Date.now()}`, productName: "", imageUrl: "", quantity: 1 }]);
  }

  async function handleEvidenceUpload(files: FileList | null) {
    const selected = Array.from(files || []);
    if (!selected.length) return;
    setBusy("evidence");
    setError("");
    try {
      const uploads: AfterSalesAttachment[] = [];
      for (const file of selected.slice(0, 8)) {
        const dataUrl = await fileToDataUrl(file);
        uploads.push((await uploadAfterSalesAttachment({ fileName: file.name, dataUrl, kind: "evidence" })).upload);
      }
      setEvidence((current) => [...current, ...uploads]);
      setMessage(`已上传 ${uploads.length} 个售后凭证。`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "上传售后凭证失败。");
    } finally {
      setBusy("");
    }
  }

  function resetReport() {
    setOrderNumber("");
    setSyncedOrder(null);
    setCustomer(blankCustomer);
    setItems([]);
    setPrimaryReason("");
    setSecondaryReason("");
    setNeedsReissue(false);
    setReissueItems([]);
    setEvidence([]);
    setOperatorRemark("");
    setAdditionalLiability(0);
    setCustomerRecovery(0);
    setAdjustmentReason("");
  }

  async function handleSubmit() {
    if (!syncedOrder) return setError("请先同步原订单。");
    if (!primaryReason || !secondaryReason) return setError("请选择完整的售后一级和二级分类。");
    if (!items.some((item) => item.affectedQty > 0)) return setError("请填写至少一个受影响商品数量。");
    if (missingCosts.length) return setError(`请补录商品成本：${missingCosts.join("、")}`);
    if (effectiveNeedsReissue && !reissueItems.some((item) => item.sku && item.quantity > 0)) return setError("请选择补发商品和数量。");
    if ((additionalLiability > 0 || customerRecovery > 0) && !adjustmentReason.trim()) return setError("有额外承担或客户补回金额时，请填写调整说明。");
    setBusy("submit");
    setError("");
    try {
      const result = await createAfterSalesTicket({
        order: syncedOrder,
        customer,
        originalItems: items,
        reissueItems: effectiveNeedsReissue ? reissueItems.map((item) => ({ ...item, sku: item.sku.replace(/^待填写-\d+$/, "") })) : [],
        primaryReason,
        secondaryReason,
        needsReissue: effectiveNeedsReissue,
        evidenceIds: evidence.map((item) => item.id),
        operatorRemark,
        additionalLiabilityCny: additionalLiability,
        customerRecoveryCny: customerRecovery,
        adjustmentReason,
      });
      setMessage(`售后单 ${result.ticket.id} 已提交，等待仓库接单。`);
      resetReport();
      await refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "提交售后单失败。");
    } finally {
      setBusy("");
    }
  }

  async function openTicket(ticket: AfterSalesTicket) {
    setBusy(`detail:${ticket.id}`);
    setError("");
    try {
      const result = await fetchAfterSalesTicket(ticket.id);
      setSelectedTicket(result.ticket);
      setWarehouseRemark(result.ticket.warehouseRemark || "");
      setLabelUploads([]);
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : "读取售后详情失败。");
    } finally {
      setBusy("");
    }
  }

  async function copyText(value: string, label: string) {
    if (!value) return setError(`${label}暂未维护。`);
    await navigator.clipboard.writeText(value);
    setMessage(`${label}已复制。`);
  }

  async function handleLabelUpload(files: FileList | null) {
    const selected = Array.from(files || []);
    if (!selected.length) return;
    setBusy("label");
    setError("");
    try {
      const uploads: AfterSalesAttachment[] = [];
      for (const file of selected.slice(0, 4)) {
        const dataUrl = await fileToDataUrl(file);
        uploads.push((await uploadAfterSalesAttachment({ fileName: file.name, dataUrl, kind: "label" })).upload);
      }
      setLabelUploads((current) => [...current, ...uploads]);
      setMessage(`已上传 ${uploads.length} 张补发面单，提交状态后归档。`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "上传面单失败。");
    } finally {
      setBusy("");
    }
  }

  async function warehouseAction(action: "accept" | "await_reshipment" | "shipped" | "complete" | "cancel" | "reopen") {
    if (!selectedTicket) return;
    setBusy(action);
    setError("");
    try {
      const result = await updateAfterSalesWarehouse(selectedTicket.id, {
        action,
        warehouseRemark,
        note: warehouseRemark,
        labelUploadIds: labelUploads.map((upload) => upload.id),
      });
      setSelectedTicket(result.ticket);
      setLabelUploads([]);
      setMessage(`${result.ticket.id} 已更新为“${statusMeta[result.ticket.status]?.label || result.ticket.status}”。`);
      await refresh({ status, keyword });
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "更新售后单失败。");
    } finally {
      setBusy("");
    }
  }

  async function handleDownload(attachment: AfterSalesAttachment) {
    try {
      const blob = await downloadAfterSalesAttachment(attachment);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = attachment.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "下载附件失败。");
    }
  }

  return (
    <div className="after-sales-page">
      <section className="after-sales-hero">
        <div>
          <p className="eyebrow">AFTER-SALES COMMAND CENTER</p>
          <h1>售后协同中心</h1>
          <span>原单同步、责任判定、金额核算与仓库补发，一张工单走完全流程。</span>
        </div>
        <div className="after-sales-hero-badge"><ShieldCheck size={22} /><span><strong>规则自动判责</strong><small>成本快照全程可追溯</small></span></div>
      </section>

      <section className="after-sales-kpis">
        <article><span>待仓库接单</span><strong>{payload?.summary.pendingWarehouse ?? 0}</strong><small>需要仓库确认处理</small></article>
        <article><span>处理中</span><strong>{payload?.summary.processing ?? 0}</strong><small>含待补发工单</small></article>
        <article><span>待补发</span><strong>{payload?.summary.awaitingReshipment ?? 0}</strong><small>等待面单与发出</small></article>
        <article className="liability"><span>仓库承担金额</span><strong>{money(payload?.summary.warehouseLiabilityCny ?? 0)}</strong><small>不含已作废工单</small></article>
      </section>

      <div className="after-sales-tabs" role="tablist">
        {canReport ? <button className={tab === "report" ? "active" : ""} onClick={() => setTab("report")}><Clipboard size={17} />运营填报</button> : null}
        {canWarehouse ? <button className={tab === "warehouse" ? "active" : ""} onClick={() => setTab("warehouse")}><Truck size={17} />仓库处理 <span>{payload?.summary.pendingWarehouse || 0}</span></button> : null}
      </div>

      {error ? <div className="as-notice error"><AlertTriangle size={17} />{error}<button onClick={() => setError("")}><X size={15} /></button></div> : null}
      {message ? <div className="as-notice success"><Check size={17} />{message}<button onClick={() => setMessage("")}><X size={15} /></button></div> : null}

      {tab === "report" && canReport ? (
        <div className="after-sales-report-layout">
          <main className="after-sales-form-flow">
            <section className="as-step-card">
              <div className="as-step-heading"><span>01</span><div><p>同步原单</p><h2>输入平台后台订单号</h2></div></div>
              <div className="as-order-search">
                <input value={orderNumber} onChange={(event) => setOrderNumber(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void handleSyncOrder()} placeholder="例如：576239876543210987" />
                <button type="button" onClick={() => void handleSyncOrder()} disabled={busy === "sync"}>{busy === "sync" ? <LoaderCircle className="spinning" size={18} /> : <RefreshCw size={18} />}{busy === "sync" ? "正在查询妙手" : "同步原订单"}</button>
              </div>
              <p className="as-helper">严格按平台后台订单号精确匹配；本地缓存优先，必要时实时补查妙手。</p>

              {syncedOrder ? (
                <div className="as-synced-order">
                  <header><div><span>{syncedOrder.platform || "妙手订单"} · {syncedOrder.site}</span><strong>{syncedOrder.orderNumber}</strong></div><div><span>店铺别名</span><strong>{syncedOrder.shopAlias || "未配置"}</strong></div><div><span>下单时间</span><strong>{dateTime(syncedOrder.orderStartedAt)}</strong></div></header>
                  {syncedOrder.existingTickets.length ? <div className="as-duplicate-warning"><AlertTriangle size={16} />该原订单已有 {syncedOrder.existingTickets.length} 张售后单，请确认不是重复填报。</div> : null}
                  <div className="as-customer-grid">
                    {([
                      ["name", "收件人"], ["phone", "联系电话"], ["country", "国家"], ["province", "省 / 州"],
                      ["city", "城市"], ["district", "区 / 县"], ["postalCode", "邮编"], ["address", "详细地址"],
                    ] as Array<[keyof AfterSalesCustomer, string]>).map(([key, label]) => (
                      <label className={key === "address" ? "wide" : ""} key={key}><span>{label}</span><input value={customer[key]} onChange={(event) => setCustomer((current) => ({ ...current, [key]: event.target.value }))} placeholder={key === "address" ? "妙手未返回时可手工补齐" : "未读取到可手工补齐"} /></label>
                    ))}
                  </div>
                  <div className="as-item-table">
                    <div className="head"><span>原单商品</span><span>下单数量</span><span>受影响数量</span><span>直营成本 / 件</span><span>补发</span></div>
                    {items.map((item) => (
                      <div className="row" key={item.sku}>
                        <div className="product">{item.imageUrl ? <img src={resolveApiUrl(item.imageUrl)} alt="" /> : <span><PackageCheck size={20} /></span>}<div><strong>{item.sku}</strong><small>{item.productName}</small></div></div>
                        <strong>{item.orderedQty}</strong>
                        <input type="number" min="0" max={item.orderedQty} value={item.affectedQty} onChange={(event) => updateItem(item.sku, { affectedQty: Math.min(item.orderedQty, Math.max(0, Number(event.target.value))) })} />
                        <label className={item.unitCostCny <= 0 ? "cost-missing" : ""}><input type="number" min="0" step="0.01" value={item.unitCostCny || ""} placeholder="补录成本" onChange={(event) => updateItem(item.sku, { unitCostCny: Math.max(0, Number(event.target.value)), costMissing: false, costSource: "运营人工成本" })} /><small>{item.costSource}</small></label>
                        <button type="button" className={reissueItems.some((candidate) => candidate.sku === item.sku) ? "selected" : ""} onClick={() => toggleReissue(item)}>{reissueItems.some((candidate) => candidate.sku === item.sku) ? <Check size={15} /> : <Plus size={15} />}</button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>

            <section className="as-step-card">
              <div className="as-step-heading"><span>02</span><div><p>原因与凭证</p><h2>系统自动判断责任归属</h2></div></div>
              <div className="as-reason-grid">
                <label><span>售后一级分类</span><select value={primaryReason} onChange={(event) => setPrimaryReason(event.target.value)}><option value="">请选择问题原因</option>{primaryReasons.map((reason) => <option key={reason}>{reason}</option>)}</select></label>
                <label><span>售后二级分类</span><select value={secondaryReason} onChange={(event) => setSecondaryReason(event.target.value)}><option value="">请选择处理方式</option>{secondaryReasons.map((reason) => <option key={reason}>{reason}</option>)}</select></label>
              </div>
              <div className={`as-responsibility ${responsibility.party}`}><ShieldCheck size={20} /><div><span>自动责任归属</span><strong>{responsibility.label}</strong><small>{responsibility.explanation}</small></div></div>
              <div className="as-evidence-zone">
                <label><Upload size={22} /><strong>{busy === "evidence" ? "正在上传…" : "上传图片 / 视频截图 / PDF 凭证"}</strong><span>单个文件不超过 8MB，最多一次选择 8 个</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" multiple hidden onChange={(event) => void handleEvidenceUpload(event.target.files)} /></label>
                <AttachmentList attachments={evidence} onDownload={handleDownload} />
              </div>
              <label className="as-textarea"><span>运营备注</span><textarea value={operatorRemark} onChange={(event) => setOperatorRemark(event.target.value)} placeholder="说明客户反馈、沟通结果、退款情况及需要仓库注意的事项。" /></label>
            </section>

            <section className="as-step-card">
              <div className="as-step-heading"><span>03</span><div><p>补发与结算</p><h2>确认仓库动作和承担金额</h2></div></div>
              <label className="as-switch-row"><input type="checkbox" checked={effectiveNeedsReissue} disabled={secondaryReason === "补发且留错品"} onChange={(event) => setNeedsReissue(event.target.checked)} /><span><strong>需要仓库补发</strong><small>开启后必须维护补发商品与数量，并由仓库上传面单。</small></span></label>
              {effectiveNeedsReissue ? (
                <div className="as-reissue-editor">
                  <header><strong>补发商品清单</strong><button type="button" onClick={addManualReissueItem}><Plus size={15} />添加其他商品</button></header>
                  {reissueItems.length ? reissueItems.map((item, index) => (
                    <div className="as-reissue-row" key={`${item.sku}-${index}`}>
                      <input value={item.sku.replace(/^待填写-\d+$/, "")} placeholder="SKU" onChange={(event) => setReissueItems((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, sku: event.target.value } : row))} />
                      <input value={item.productName} placeholder="产品名称" onChange={(event) => setReissueItems((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, productName: event.target.value } : row))} />
                      <input type="number" min="1" value={item.quantity} onChange={(event) => setReissueItems((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: Math.max(1, Number(event.target.value)) } : row))} />
                      <button type="button" onClick={() => setReissueItems((current) => current.filter((_, rowIndex) => rowIndex !== index))}><X size={16} /></button>
                    </div>
                  )) : <div className="as-empty-inline">请在原单商品右侧点击“+”选择补发商品。</div>}
                </div>
              ) : null}
              <div className="as-adjustment-grid">
                <label><span>额外承担（元）</span><input type="number" min="0" step="0.01" value={additionalLiability || ""} placeholder="如平台赔付、补发运费" onChange={(event) => setAdditionalLiability(Math.max(0, Number(event.target.value)))} /></label>
                <label><span>客户补回（元）</span><input type="number" min="0" step="0.01" value={customerRecovery || ""} placeholder="如客户补差价" onChange={(event) => setCustomerRecovery(Math.max(0, Number(event.target.value)))} /></label>
                <label className="wide"><span>金额调整说明</span><input value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} placeholder="填写额外承担或客户补回时必填" /></label>
              </div>
            </section>
          </main>

          <aside className="as-settlement-card">
            <div className="as-settlement-head"><span>责任结算预览</span><BadgeCheck size={21} /></div>
            <div className="as-settlement-responsibility"><small>默认责任方</small><strong>{responsibility.label}</strong></div>
            <dl><div><dt>受影响产品成本</dt><dd>{money(affectedCost)}</dd></div><div><dt>打包费减免</dt><dd>{money(packagingFee)}</dd></div><div><dt>额外承担</dt><dd>{money(additionalLiability)}</dd></div><div className="minus"><dt>客户补回</dt><dd>- {money(customerRecovery)}</dd></div></dl>
            <div className="as-settlement-total"><span>仓库需承担</span><strong>{money(liabilityTotal)}</strong><small>创建后冻结本次成本与规则快照</small></div>
            {missingCosts.length ? <div className="as-cost-warning"><AlertTriangle size={16} />缺少成本：{missingCosts.join("、")}</div> : null}
            <button type="button" className="as-submit" disabled={busy === "submit" || !syncedOrder} onClick={() => void handleSubmit()}>{busy === "submit" ? <LoaderCircle className="spinning" size={18} /> : <Send size={18} />}{busy === "submit" ? "正在提交" : "提交给仓库"}</button>
            <p>系统允许同一订单多次售后，但会在同步时提示已有工单，避免重复计责。</p>
          </aside>
        </div>
      ) : null}

      {tab === "warehouse" && canWarehouse ? (
        <section className="after-sales-warehouse">
          <div className="as-warehouse-toolbar">
            <div className="as-filter-search"><Search size={17} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索售后单号、原订单号、店铺别名" /></div>
            <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option>{Object.entries(statusMeta).map(([value, meta]) => <option value={value} key={value}>{meta.label}</option>)}</select>
            <button type="button" onClick={() => void refresh({ status, keyword })}><RefreshCw size={16} />查询</button>
          </div>
          <div className="as-ticket-table">
            <div className="head"><span>售后单 / 原订单</span><span>问题与处理</span><span>责任归属</span><span>补发</span><span>仓库承担</span><span>状态</span><span></span></div>
            {loading ? <div className="as-table-empty"><LoaderCircle className="spinning" size={22} />正在读取售后单…</div> : null}
            {!loading && !(payload?.tickets.length) ? <div className="as-table-empty"><PackageCheck size={24} />当前筛选下没有售后单</div> : null}
            {(payload?.tickets || []).map((ticket) => (
              <button type="button" className="row" key={ticket.id} onClick={() => void openTicket(ticket)}>
                <span><strong>{ticket.id}</strong><small>{ticket.originalOrderNumber}</small><small>{ticket.shopAlias || ticket.platformShopName || "未配置店铺别名"}</small></span>
                <span><strong>{ticket.primaryReason}</strong><small>{ticket.secondaryReason}</small></span>
                <span><strong>{ticket.responsibility.label}</strong><small>{ticket.responsibility.overridden ? "人工复核" : "规则判定"}</small></span>
                <span><strong>{ticket.needsReissue ? `${ticket.reissueItems.reduce((sum, item) => sum + item.quantity, 0)} 件` : "无需补发"}</strong><small>{ticket.needsReissue ? `${ticket.reissueItems.length} 个 SKU` : "仅记录 / 赔付"}</small></span>
                <span><strong>{money(ticket.money.totalWarehouseLiabilityCny)}</strong></span>
                <span className={`as-status ${statusMeta[ticket.status]?.tone || "muted"}`}>{statusMeta[ticket.status]?.label || ticket.status}</span>
                <span>{busy === `detail:${ticket.id}` ? <LoaderCircle className="spinning" size={17} /> : "查看详情"}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {selectedTicket ? (
        <div className="as-drawer-backdrop" onMouseDown={(event) => event.currentTarget === event.target && setSelectedTicket(null)}>
          <aside className="as-ticket-drawer">
            <header><div><p className="eyebrow">AFTER-SALES TICKET</p><h2>{selectedTicket.id}</h2><span>原订单 {selectedTicket.originalOrderNumber}</span></div><button type="button" onClick={() => setSelectedTicket(null)}><X size={19} /></button></header>
            <div className="as-drawer-scroll">
              <section className="as-ticket-summary"><span className={`as-status ${statusMeta[selectedTicket.status]?.tone || "muted"}`}>{statusMeta[selectedTicket.status]?.label || selectedTicket.status}</span><div><small>责任归属</small><strong>{selectedTicket.responsibility.label}</strong></div><div><small>仓库承担</small><strong>{money(selectedTicket.money.totalWarehouseLiabilityCny)}</strong></div></section>
              <section className="as-drawer-section"><header><div><small>客户信息</small><strong>仅在详情中展示</strong></div><button type="button" onClick={() => void copyText(customerText(selectedTicket.customer), "客户信息")}><Copy size={15} />复制客户信息</button></header><pre>{customerText(selectedTicket.customer) || "妙手未返回客户信息，请联系运营补充。"}</pre></section>
              <section className="as-drawer-section"><header><div><small>补发清单</small><strong>{selectedTicket.needsReissue ? `${selectedTicket.reissueItems.length} 个 SKU` : "无需补发"}</strong></div>{selectedTicket.needsReissue ? <button type="button" onClick={() => void copyText(reissueText(selectedTicket.reissueItems), "补发产品信息")}><Copy size={15} />复制补发清单</button> : null}</header>{selectedTicket.needsReissue ? <div className="as-drawer-items">{selectedTicket.reissueItems.map((item) => <div key={item.sku}><span>{item.sku}</span><strong>{item.productName}</strong><b>× {item.quantity}</b></div>)}</div> : <div className="as-empty-inline">该售后单无需仓库补发。</div>}</section>
              <section className="as-drawer-section"><header><div><small>问题说明</small><strong>{selectedTicket.primaryReason} / {selectedTicket.secondaryReason}</strong></div></header><p>{selectedTicket.operatorRemark || "运营未填写补充备注。"}</p><AttachmentList attachments={selectedTicket.evidence || []} onDownload={handleDownload} /></section>
              {selectedTicket.needsReissue ? <section className="as-drawer-section"><header><div><small>补发面单</small><strong>上传后随状态动作归档</strong></div></header><label className="as-label-upload"><Upload size={18} /><span>{busy === "label" ? "正在上传…" : "选择图片或 PDF 面单"}</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" multiple hidden onChange={(event) => void handleLabelUpload(event.target.files)} /></label><AttachmentList attachments={[...(selectedTicket.labelUploads || []), ...labelUploads]} onDownload={handleDownload} /></section> : null}
              <section className="as-drawer-section"><label className="as-textarea"><span>仓库处理备注</span><textarea value={warehouseRemark} onChange={(event) => setWarehouseRemark(event.target.value)} placeholder="填写核查结果、补发物流单号或完结说明。" /></label></section>
              <section className="as-drawer-section as-timeline"><header><div><small>处理时间线</small><strong>共 {selectedTicket.timeline.length} 个节点</strong></div></header>{[...selectedTicket.timeline].reverse().map((item, index) => <div className="as-timeline-item" key={item.id}><i className={index === 0 ? "active" : ""} /><div><strong>{item.label}</strong><span>{item.actor} · {dateTime(item.createdAt)}</span>{item.note ? <p>{item.note}</p> : null}</div></div>)}</section>
            </div>
            <footer>
              {selectedTicket.status === "pending_warehouse" ? <button className="primary" onClick={() => void warehouseAction("accept")} disabled={Boolean(busy)}>确认接单</button> : null}
              {["pending_warehouse", "processing"].includes(selectedTicket.status) && selectedTicket.needsReissue ? <button className="primary" onClick={() => void warehouseAction("await_reshipment")} disabled={Boolean(busy)}>进入待补发</button> : null}
              {["processing", "awaiting_reshipment"].includes(selectedTicket.status) && selectedTicket.needsReissue ? <button className="primary" onClick={() => void warehouseAction("shipped")} disabled={Boolean(busy)}>上传面单并标记发出</button> : null}
              {selectedTicket.status === "processing" && !selectedTicket.needsReissue ? <button className="primary" onClick={() => void warehouseAction("complete")} disabled={Boolean(busy)}>确认完结</button> : null}
              {selectedTicket.status === "shipped" ? <button className="primary" onClick={() => void warehouseAction("complete")} disabled={Boolean(busy)}>确认售后完结</button> : null}
              {canAdmin && !["completed", "cancelled"].includes(selectedTicket.status) ? <button className="danger" onClick={() => void warehouseAction("cancel")} disabled={Boolean(busy)}>作废</button> : null}
              {canAdmin && ["completed", "cancelled"].includes(selectedTicket.status) ? <button onClick={() => void warehouseAction("reopen")} disabled={Boolean(busy)}>重新打开</button> : null}
            </footer>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
