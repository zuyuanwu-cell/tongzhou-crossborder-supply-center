import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  KeyRound,
  LoaderCircle,
  Lock,
  PackageCheck,
  PackagePlus,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
  X,
} from "lucide-react";
import {
  bindStockupFormalSku,
  cancelWorkflowSkuReservation,
  completeWorkflowProductCoding,
  fetchSkuCodingCenter,
  fetchStockupProductRefs,
  reserveWorkflowSku,
  retryWorkflowWmsProduct,
  updateSkuCodingRule,
} from "../api";
import type { SkuCodingCenterPayload, SkuCodingReservation, SkuCodingRule } from "../api";
import type { StockupProductRef } from "./types";
import "./product-coding-workspace.css";

type SourceMode = "direct" | "temporary";

type ProductCodingDraft = {
  ruleId: string;
  productName: string;
  productNameEn: string;
  unit: string;
  brand: string;
  category: string;
  functionCategory: string;
  productType: string;
  skuAttribute: string;
  specification: string;
  barcode: string;
  supplier: string;
  supplierCode: string;
  purchasePrice: number;
  warningQty: number;
  purchaseLeadDays: number;
  minOrderQty: number;
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  hsCode: string;
  origin: string;
  cartonSpecification: string;
  declaredNameEn: string;
  declaredValueUsd: number;
};

const emptyDraft: ProductCodingDraft = {
  ruleId: "",
  productName: "",
  productNameEn: "",
  unit: "件",
  brand: "",
  category: "",
  functionCategory: "",
  productType: "外采品",
  skuAttribute: "单品",
  specification: "",
  barcode: "",
  supplier: "",
  supplierCode: "",
  purchasePrice: 0,
  warningQty: 0,
  purchaseLeadDays: 0,
  minOrderQty: 0,
  weightKg: 0,
  lengthCm: 0,
  widthCm: 0,
  heightCm: 0,
  hsCode: "",
  origin: "中国",
  cartonSpecification: "",
  declaredNameEn: "",
  declaredValueUsd: 0,
};

const emptyRule: Partial<SkuCodingRule> = {
  name: "",
  prefix: "TZKJ-",
  digits: 3,
  kind: "自主品牌",
  brand: "",
  country: "",
  description: "",
  enabled: true,
};

function createDraftId() {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `manual:${id}`;
}

function formatDateTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

export function ProductCodingWorkspace() {
  const [refs, setRefs] = useState<StockupProductRef[]>([]);
  const [center, setCenter] = useState<SkuCodingCenterPayload | null>(null);
  const [sourceMode, setSourceMode] = useState<SourceMode>("direct");
  const [directDraftId, setDirectDraftId] = useState(createDraftId);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<ProductCodingDraft>(emptyDraft);
  const [directDraft, setDirectDraft] = useState<ProductCodingDraft>(emptyDraft);
  const [selectedWarehouses, setSelectedWarehouses] = useState<string[]>([]);
  const [showDetails, setShowDetails] = useState(true);
  const [showRules, setShowRules] = useState(false);
  const [ruleForm, setRuleForm] = useState<Partial<SkuCodingRule>>(emptyRule);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [refData, codingData] = await Promise.all([
        fetchStockupProductRefs({ codingStatus: "temporary" }),
        fetchSkuCodingCenter(),
      ]);
      setRefs(refData.productRefs || []);
      setCenter(codingData);
      setSelectedId((current) => (
        current && refData.productRefs.some((item) => item.id === current)
          ? current
          : refData.productRefs[0]?.id || ""
      ));
      const firstRuleId = codingData.rules.find((item) => item.enabled)?.id || "";
      setDirectDraft((current) => ({
        ...current,
        ruleId: current.ruleId && codingData.rules.some((item) => item.id === current.ruleId && item.enabled)
          ? current.ruleId
          : firstRuleId,
      }));
      if (sourceMode === "direct") {
        setDraft((current) => ({
          ...current,
          ruleId: current.ruleId && codingData.rules.some((item) => item.id === current.ruleId && item.enabled)
            ? current.ruleId
            : firstRuleId,
        }));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "新品编码数据读取失败");
    } finally {
      setLoading(false);
    }
  }, [sourceMode]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedRef = useMemo(() => refs.find((item) => item.id === selectedId) || null, [refs, selectedId]);
  const activeSourceId = sourceMode === "direct" ? directDraftId : selectedRef ? `manual:stockup-ref:${selectedRef.id}` : "";
  const reservations = center?.reservations || [];
  const activeReservation = reservations.find((item) => item.productRecordId === activeSourceId && item.status !== "cancelled");
  const selectedRule = center?.rules.find((item) => item.id === (activeReservation?.ruleId || draft.ruleId));
  const warehouseOptions = center?.warehouseOptions || [];
  const selectedWarehouseOptions = warehouseOptions.filter((item) => selectedWarehouses.includes(item.connectionId));
  const yunWmsSelected = selectedWarehouseOptions.some((item) => /yunwms/i.test(item.providerId));
  const missingYunFields = yunWmsSelected ? [
    !draft.weightKg ? "重量" : "",
    !draft.lengthCm ? "长度" : "",
    !draft.widthCm ? "宽度" : "",
    !draft.heightCm ? "高度" : "",
    !draft.declaredNameEn.trim() ? "英文申报名" : "",
    !draft.declaredValueUsd ? "申报价值（USD）" : "",
  ].filter(Boolean) : [];
  const recentReservations = reservations
    .filter((item) => ["completed", "partial"].includes(item.status))
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
    .slice(0, 8);

  useEffect(() => {
    const firstRule = center?.rules.find((item) => item.enabled)?.id || "";
    if (sourceMode === "direct") return;
    if (!selectedRef) return;
    setDraft({
      ...emptyDraft,
      ruleId: activeReservation?.ruleId || firstRule,
      productName: selectedRef.productName,
      specification: selectedRef.specification,
    });
    setSelectedWarehouses([]);
  }, [sourceMode, selectedRef?.id]);

  function patchDraft(values: Partial<ProductCodingDraft>) {
    const next = { ...draft, ...values };
    setDraft(next);
    if (sourceMode === "direct") setDirectDraft(next);
  }

  function activateDirectMode() {
    const firstRule = center?.rules.find((item) => item.enabled)?.id || "";
    const next = { ...directDraft, ruleId: directDraft.ruleId || firstRule };
    setSourceMode("direct");
    setDraft(next);
    setDirectDraft(next);
    setSelectedWarehouses([]);
  }

  function resetDirectForm() {
    const firstRule = center?.rules.find((item) => item.enabled)?.id || "";
    setDirectDraftId(createDraftId());
    const next = { ...emptyDraft, ruleId: firstRule };
    setDraft(next);
    setDirectDraft(next);
    setSelectedWarehouses([]);
  }

  async function reserveSku() {
    if (!activeSourceId || !draft.ruleId || !draft.productName.trim()) return;
    setBusy("reserve");
    setError("");
    setMessage("");
    try {
      const result = await reserveWorkflowSku({
        productRecordId: activeSourceId,
        productName: draft.productName.trim(),
        ruleId: draft.ruleId,
        mode: "direct",
        product: { ...draft, temporaryProductNo: selectedRef?.temporarySku || "" },
      });
      await load();
      setMessage(`已安全预占 ${result.reservation.sku}；该号码不会再分配给其他新品。`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "SKU 预占失败");
    } finally {
      setBusy("");
    }
  }

  async function cancelReservation() {
    if (!activeReservation) return;
    setBusy("cancel");
    setError("");
    setMessage("");
    try {
      await cancelWorkflowSkuReservation(activeReservation.id, "重新调整编码规则或产品资料");
      await load();
      setMessage(`${activeReservation.sku} 已撤销；为保证追溯，该号码不会回收。`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "撤销预占失败");
    } finally {
      setBusy("");
    }
  }

  async function completeArchive() {
    if (!activeReservation || !activeSourceId || !draft.productName.trim()) return;
    setBusy("complete");
    setError("");
    setMessage("");
    try {
      const result = await completeWorkflowProductCoding({
        productRecordId: activeSourceId,
        reservationId: activeReservation.id,
        mode: "direct",
        productName: draft.productName.trim(),
        warehouseConnectionIds: selectedWarehouses,
        product: { ...draft, purchasePriceCurrency: "CNY", temporaryProductNo: selectedRef?.temporarySku || "" },
      });
      const formalSku = result.sku || activeReservation.sku;
      if (sourceMode === "temporary" && selectedRef) {
        await bindStockupFormalSku(selectedRef.id, {
          formalSku,
          productId: result.productRecordId,
          productName: draft.productName.trim(),
        });
      }
      const partial = result.status === "partial";
      if (sourceMode === "direct") resetDirectForm();
      await load();
      setMessage(partial
        ? `${formalSku} 已在简道云建档；部分 WMS 建档失败，可在下方单独重试。`
        : `${formalSku} 已完成简道云${selectedWarehouses.length ? "及所选 WMS" : ""}建档。`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "产品建档失败");
    } finally {
      setBusy("");
    }
  }

  async function retryWms(reservation: SkuCodingReservation) {
    setBusy(`retry:${reservation.id}`);
    setError("");
    setMessage("");
    try {
      const result = await retryWorkflowWmsProduct(reservation.id);
      await load();
      setMessage(result.status === "completed"
        ? `${reservation.sku} 的 WMS 建档已全部完成。`
        : `${reservation.sku} 仍有 WMS 建档失败，请核对对应仓库连接。`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "WMS 重试失败");
    } finally {
      setBusy("");
    }
  }

  function editRule(rule?: SkuCodingRule) {
    setRuleForm(rule ? { ...rule } : { ...emptyRule });
    setShowRules(true);
  }

  async function saveRule() {
    if (!ruleForm.name?.trim() || !ruleForm.prefix?.trim()) return;
    setBusy("rule");
    setError("");
    setMessage("");
    try {
      const result = await updateSkuCodingRule({
        ...ruleForm,
        name: ruleForm.name.trim(),
        prefix: ruleForm.prefix.trim().toUpperCase(),
        digits: Math.max(1, Number(ruleForm.digits || 3)),
      });
      setCenter(result.codingCenter);
      setDraft((current) => ({ ...current, ruleId: result.rule.id }));
      if (sourceMode === "direct") {
        setDirectDraft((current) => ({ ...current, ruleId: result.rule.id }));
      }
      setRuleForm({ ...result.rule });
      setMessage(`编码规则「${result.rule.name}」已保存。`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "编码规则保存失败");
    } finally {
      setBusy("");
    }
  }

  function toggleWarehouse(connectionId: string) {
    setSelectedWarehouses((current) => current.includes(connectionId)
      ? current.filter((id) => id !== connectionId)
      : [...current, connectionId]);
  }

  return (
    <section className="sku-coding-center">
      <header className="sku-coding-heading">
        <div>
          <span className="sc-eyebrow">SKU CODING & ARCHIVE</span>
          <h2>新品编码与一键建档</h2>
          <small>预占全局唯一 SKU，完善产品资料后同步到简道云产品基础信息库，并可选择需要建档的 WMS。直接新建不需要先填写备货需求。</small>
        </div>
        <div className="sku-heading-actions">
          <button className="sc-button sc-button-secondary" type="button" onClick={() => setShowRules((value) => !value)}>
            <Settings2 size={15} />编码规则
          </button>
          <button className="sc-button sc-button-secondary" type="button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={15} className={loading ? "spin" : ""} />刷新
          </button>
        </div>
      </header>

      {error ? <div className="sc-alert sc-alert-danger"><AlertTriangle size={16} />{error}</div> : null}
      {message ? <div className="sc-alert sc-alert-success"><CheckCircle2 size={16} />{message}</div> : null}

      <div className="sku-catalog-basis">
        <CheckCircle2 size={20} />
        <div>
          <strong>编码基准来自简道云产品基础信息库</strong>
          <span>已识别 {center?.catalogSkuCount ?? 0} 个正式 SKU；每个规则按完整前缀独立递增，预占后不会被重复使用。</span>
        </div>
        <small>{center?.catalogSyncedAt ? `最近同步 ${formatDateTime(center.catalogSyncedAt)}` : "等待同步时间"}</small>
      </div>

      <div className="sku-coding-metrics">
        <article><span>正式 SKU 基准</span><strong>{center?.catalogSkuCount ?? 0}</strong><small>简道云产品基础信息库</small></article>
        <article><span>启用规则</span><strong>{center?.rules.filter((item) => item.enabled).length ?? 0}</strong><small>按品牌、国家或业务类型维护</small></article>
        <article><span>待转正式 SKU</span><strong>{refs.length}</strong><small>来自备货流程的临时商品</small></article>
        <article><span>WMS 待重试</span><strong>{reservations.filter((item) => item.status === "partial").length}</strong><small>简道云成功、部分仓库失败</small></article>
      </div>

      {showRules ? (
        <div className="sku-rule-workbench">
          <div className="sku-rule-list">
            {(center?.rules || []).map((rule) => (
              <button type="button" key={rule.id} className={ruleForm.id === rule.id ? "active" : ""} onClick={() => editRule(rule)}>
                <span>{rule.name}<small>{rule.description || `${rule.kind}${rule.brand ? ` · ${rule.brand}` : ""}`}</small></span>
                <strong>{rule.nextSku}</strong>
                <em className={rule.enabled ? "enabled" : ""}>{rule.enabled ? "启用" : "停用"}</em>
              </button>
            ))}
            <button className="sku-rule-add" type="button" onClick={() => editRule()}><Plus size={14} />新增编码规则</button>
          </div>
          <div className="sku-rule-form">
            <label><span>规则名称 *</span><input value={ruleForm.name || ""} onChange={(event) => setRuleForm((current) => ({ ...current, name: event.target.value }))} /></label>
            <label><span>SKU 前缀 *</span><input value={ruleForm.prefix || ""} onChange={(event) => setRuleForm((current) => ({ ...current, prefix: event.target.value }))} /></label>
            <label><span>序号位数</span><input type="number" min="1" max="8" value={ruleForm.digits || 3} onChange={(event) => setRuleForm((current) => ({ ...current, digits: Number(event.target.value) }))} /></label>
            <label><span>产品类型</span><input value={ruleForm.kind || ""} onChange={(event) => setRuleForm((current) => ({ ...current, kind: event.target.value }))} /></label>
            <label><span>品牌</span><input value={ruleForm.brand || ""} onChange={(event) => setRuleForm((current) => ({ ...current, brand: event.target.value }))} /></label>
            <label><span>国家/区域</span><input value={ruleForm.country || ""} onChange={(event) => setRuleForm((current) => ({ ...current, country: event.target.value }))} /></label>
            <label className="wide-field"><span>说明</span><input value={ruleForm.description || ""} onChange={(event) => setRuleForm((current) => ({ ...current, description: event.target.value }))} /></label>
            <label className="sku-rule-toggle"><input type="checkbox" checked={ruleForm.enabled !== false} onChange={(event) => setRuleForm((current) => ({ ...current, enabled: event.target.checked }))} />启用该规则</label>
            <div className="sku-rule-actions"><button className="sc-button sc-button-primary" type="button" disabled={busy === "rule" || !ruleForm.name || !ruleForm.prefix} onClick={() => void saveRule()}>{busy === "rule" ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}保存规则</button></div>
          </div>
        </div>
      ) : null}

      <div className="sku-source-tabs">
        <button type="button" className={sourceMode === "direct" ? "active" : ""} onClick={activateDirectMode}><PackagePlus size={15} />直接新建产品</button>
        <button type="button" className={sourceMode === "temporary" ? "active" : ""} onClick={() => setSourceMode("temporary")}><RotateCcw size={15} />临时商品转正式 SKU <strong>{refs.length}</strong></button>
      </div>

      <div className={`sku-coding-layout ${sourceMode === "direct" ? "direct-mode" : ""}`}>
        {sourceMode === "temporary" ? (
          <aside className="sku-coding-queue">
            <div className="sku-coding-section-title"><div><span>01</span><strong>选择临时商品</strong></div><small>{refs.length} 个</small></div>
            {refs.map((item) => (
              <button type="button" key={item.id} className={item.id === selectedId ? "active" : ""} onClick={() => setSelectedId(item.id)}>
                <strong>{item.productName}</strong>
                <small>{item.temporarySku}{item.specification ? ` · ${item.specification}` : ""}</small>
                <em>{reservations.some((reservation) => reservation.productRecordId === `manual:stockup-ref:${item.id}` && reservation.status !== "cancelled") ? "已预占" : "待编码"}</em>
              </button>
            ))}
            {!loading && !refs.length ? <div className="sku-coding-empty"><CheckCircle2 size={26} /><b>暂无临时商品</b><span>可切换到“直接新建产品”。</span></div> : null}
          </aside>
        ) : null}

        {(sourceMode === "direct" || selectedRef) ? (
          <div className="sku-coding-editor">
            <div className="sku-code-console">
              <div className="sku-coding-section-title"><div><span>{sourceMode === "direct" ? "01" : "02"}</span><strong>{sourceMode === "direct" ? "填写新品并预占编码" : "确认正式编码"}</strong></div><small>先预占，建档成功后正式启用</small></div>
              {sourceMode === "direct" ? <label><span>产品中文名称 *</span><input value={draft.productName} placeholder="先填写清晰的产品名称" onChange={(event) => patchDraft({ productName: event.target.value })} /></label> : <label><span>临时商品</span><input value={`${selectedRef?.temporarySku || ""} · ${draft.productName}`} disabled /></label>}
              <label><span>编码规则 *</span><select value={draft.ruleId} disabled={Boolean(activeReservation)} onChange={(event) => patchDraft({ ruleId: event.target.value })}><option value="">请选择规则</option>{(center?.rules || []).filter((item) => item.enabled).map((rule) => <option key={rule.id} value={rule.id}>{rule.name} · 下一编码 {rule.nextSku}</option>)}</select></label>
              <div className={`sku-next-code ${activeReservation ? "locked" : ""}`}><span>{activeReservation ? "已预占编码" : "系统建议下一编码"}</span><strong>{activeReservation?.sku || selectedRule?.nextSku || "选择规则后生成"}</strong><small>{selectedRule ? `当前已到 ${selectedRule.currentSku || "尚未发号"} · ${selectedRule.digits} 位序号` : "每个完整前缀独立递增"}</small></div>
              <div className="sku-code-actions">
                {activeReservation ? <><button className="sc-button sc-button-secondary danger" type="button" disabled={Boolean(busy)} onClick={() => void cancelReservation()}><X size={14} />撤销预占</button><span><Lock size={14} />号码已锁定，不会重复分配</span></> : <button className="sc-button sc-button-primary" type="button" disabled={Boolean(busy) || !draft.ruleId || !draft.productName.trim()} onClick={() => void reserveSku()}>{busy === "reserve" ? <LoaderCircle className="spin" size={15} /> : <KeyRound size={15} />}获取并预占下一编码</button>}
              </div>
            </div>

            <div className="sku-archive-form">
              <div className="sku-coding-section-title"><div><span>{sourceMode === "direct" ? "02" : "03"}</span><strong>完善产品基础信息</strong></div><button className="sku-text-button" type="button" onClick={() => setShowDetails((value) => !value)}>{showDetails ? "收起字段" : "展开字段"}<ChevronDown size={14} /></button></div>
              <div className="sku-core-fields">
                {sourceMode === "temporary" ? <label className="wide-field"><span>中文名称 *</span><input value={draft.productName} onChange={(event) => patchDraft({ productName: event.target.value })} /></label> : null}
                <label><span>品牌</span><input value={draft.brand} onChange={(event) => patchDraft({ brand: event.target.value })} /></label>
                <label><span>单位</span><input value={draft.unit} onChange={(event) => patchDraft({ unit: event.target.value })} /></label>
                <label><span>产品类型</span><select value={draft.productType} onChange={(event) => patchDraft({ productType: event.target.value })}><option>外采品</option><option>自主品</option><option>组合品</option><option>其他</option></select></label>
                <label><span>SKU 属性</span><select value={draft.skuAttribute} onChange={(event) => patchDraft({ skuAttribute: event.target.value })}><option>单品</option><option>组合品</option><option>赠品</option><option>其他</option></select></label>
              </div>
              {showDetails ? <div className="sku-detail-fields">
                <label className="wide-field"><span>英文名称</span><input value={draft.productNameEn} onChange={(event) => patchDraft({ productNameEn: event.target.value, declaredNameEn: draft.declaredNameEn || event.target.value })} /></label>
                <label><span>产品分类</span><input value={draft.category} onChange={(event) => patchDraft({ category: event.target.value })} /></label>
                <label><span>功效分类</span><input value={draft.functionCategory} onChange={(event) => patchDraft({ functionCategory: event.target.value })} /></label>
                <label><span>规格</span><input value={draft.specification} placeholder="如 50g / 100ml" onChange={(event) => patchDraft({ specification: event.target.value })} /></label>
                <label><span>条码</span><input value={draft.barcode} onChange={(event) => patchDraft({ barcode: event.target.value })} /></label>
                <label><span>供应商</span><input value={draft.supplier} onChange={(event) => patchDraft({ supplier: event.target.value })} /></label>
                <label><span>供应商编码</span><input value={draft.supplierCode} onChange={(event) => patchDraft({ supplierCode: event.target.value })} /></label>
                <label><span>采购成本 CNY</span><input type="number" min="0" step="0.01" value={draft.purchasePrice || ""} onChange={(event) => patchDraft({ purchasePrice: Number(event.target.value) })} /></label>
                <label><span>库存预警值</span><input type="number" min="0" value={draft.warningQty || ""} onChange={(event) => patchDraft({ warningQty: Number(event.target.value) })} /></label>
                <label><span>采购周期（天）</span><input type="number" min="0" value={draft.purchaseLeadDays || ""} onChange={(event) => patchDraft({ purchaseLeadDays: Number(event.target.value) })} /></label>
                <label><span>最小起订量</span><input type="number" min="0" value={draft.minOrderQty || ""} onChange={(event) => patchDraft({ minOrderQty: Number(event.target.value) })} /></label>
                <label><span>重量 kg</span><input type="number" min="0" step="0.001" value={draft.weightKg || ""} onChange={(event) => patchDraft({ weightKg: Number(event.target.value) })} /></label>
                <label><span>长 cm</span><input type="number" min="0" step="0.01" value={draft.lengthCm || ""} onChange={(event) => patchDraft({ lengthCm: Number(event.target.value) })} /></label>
                <label><span>宽 cm</span><input type="number" min="0" step="0.01" value={draft.widthCm || ""} onChange={(event) => patchDraft({ widthCm: Number(event.target.value) })} /></label>
                <label><span>高 cm</span><input type="number" min="0" step="0.01" value={draft.heightCm || ""} onChange={(event) => patchDraft({ heightCm: Number(event.target.value) })} /></label>
                <label><span>HS 编码</span><input value={draft.hsCode} onChange={(event) => patchDraft({ hsCode: event.target.value })} /></label>
                <label><span>原产地</span><input value={draft.origin} onChange={(event) => patchDraft({ origin: event.target.value })} /></label>
                <label><span>箱规</span><input value={draft.cartonSpecification} onChange={(event) => patchDraft({ cartonSpecification: event.target.value })} /></label>
                <label><span>英文申报名</span><input value={draft.declaredNameEn} onChange={(event) => patchDraft({ declaredNameEn: event.target.value })} /></label>
                <label><span>申报价值 USD</span><input type="number" min="0" step="0.01" value={draft.declaredValueUsd || ""} onChange={(event) => patchDraft({ declaredValueUsd: Number(event.target.value) })} /></label>
              </div> : null}
            </div>

            <div className="sku-warehouse-picker">
              <div className="sku-coding-section-title"><div><span>{sourceMode === "direct" ? "03" : "04"}</span><strong>选择 WMS 建档目标</strong></div><small>可不选，先只建简道云产品档案</small></div>
              <div className="sku-warehouse-grid">
                {warehouseOptions.map((warehouse) => (
                  <label key={warehouse.connectionId} className={`${selectedWarehouses.includes(warehouse.connectionId) ? "selected" : ""} ${!warehouse.createConfigured ? "disabled" : ""}`}>
                    <input type="checkbox" checked={selectedWarehouses.includes(warehouse.connectionId)} disabled={!warehouse.createConfigured} onChange={() => toggleWarehouse(warehouse.connectionId)} />
                    <span><strong>{warehouse.warehouseName}</strong><small>{warehouse.country || "未设置国家"} · {warehouse.providerName}</small></span>
                    <em>{warehouse.createConfigured ? warehouse.createMode || "可建档" : warehouse.createMessage || "未配置"}</em>
                  </label>
                ))}
                {!warehouseOptions.length ? <div className="sku-coding-empty compact"><b>暂无可选仓库连接</b><span>仍可先完成简道云产品基础档案。</span></div> : null}
              </div>
              {missingYunFields.length ? <div className="sku-field-warning"><AlertTriangle size={16} /><span>选择俄罗斯 YunWMS 后还需填写：{missingYunFields.join("、")}</span></div> : null}
            </div>

            <div className="sku-submit-bar">
              <div><strong>{activeReservation?.sku || "请先预占 SKU"}</strong><span>系统先创建简道云产品基础信息，再逐个同步到所选 WMS；单个 WMS 失败不会回滚已成功的基础档案。</span></div>
              <button className="sc-button sc-button-primary" type="button" disabled={Boolean(busy) || !activeReservation || !draft.productName.trim() || missingYunFields.length > 0} onClick={() => void completeArchive()}>{busy === "complete" ? <LoaderCircle className="spin" size={16} /> : <PackageCheck size={16} />}一键完成建档</button>
            </div>
          </div>
        ) : <div className="sku-coding-empty"><PackagePlus size={30} /><b>请选择临时商品</b></div>}
      </div>

      {recentReservations.length ? (
        <div className="sku-coding-history">
          <div className="sku-coding-section-title"><div><span>05</span><strong>最近建档记录</strong></div><small>简道云成功后，失败的 WMS 可单独重试</small></div>
          <div className="sku-history-list">
            {recentReservations.map((reservation) => (
              <article key={reservation.id}>
                <div><span className="coding-sequence">{reservation.sku}</span><strong>{reservation.productName || "未填写产品名称"}</strong><small>{formatDateTime(reservation.updatedAt)}</small></div>
                <div className="sku-archive-progress"><span className={reservation.jdyStatus === "success" ? "done" : "pending"}><Check size={13} />简道云</span>{(reservation.warehouseResults || []).map((result) => <span key={result.connectionId} className={result.status === "success" ? "done" : "failed"} title={result.message}>{result.status === "success" ? <Check size={13} /> : <AlertTriangle size={13} />}{result.warehouseName || result.connectionId}</span>)}</div>
                <div className="sku-history-status"><b className={reservation.status}>{reservation.status === "completed" ? "建档完成" : "部分失败"}</b>{reservation.status === "partial" ? <button className="sc-button sc-button-secondary" type="button" disabled={Boolean(busy)} onClick={() => void retryWms(reservation)}>{busy === `retry:${reservation.id}` ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}重试 WMS</button> : null}</div>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
