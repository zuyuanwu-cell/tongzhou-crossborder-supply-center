import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Hash, PackagePlus, RefreshCw, Sparkles } from "lucide-react";
import {
  bindStockupFormalSku,
  completeWorkflowProductCoding,
  fetchSkuCodingCenter,
  fetchStockupProductRefs,
  reserveWorkflowSku,
} from "../api";
import type { SkuCodingCenterPayload } from "../api";
import type { StockupProductRef } from "./types";
import "./product-coding-workspace.css";

export function ProductCodingWorkspace() {
  const [refs, setRefs] = useState<StockupProductRef[]>([]);
  const [center, setCenter] = useState<SkuCodingCenterPayload | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [ruleId, setRuleId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
      setRuleId((current) => (
        current && codingData.rules.some((item) => item.id === current && item.enabled)
          ? current
          : codingData.rules.find((item) => item.enabled)?.id || ""
      ));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "新品编码数据读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => refs.find((item) => item.id === selectedId) || null,
    [refs, selectedId],
  );
  const selectedRule = center?.rules.find((item) => item.id === ruleId);

  async function createSku() {
    if (!selected || !ruleId) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const sourceId = `manual:stockup-ref:${selected.id}`;
      const product = {
        productName: selected.productName,
        specification: selected.specification,
        unit: "件",
        temporaryProductNo: selected.temporarySku,
      };
      const reserved = await reserveWorkflowSku({
        productRecordId: sourceId,
        productName: selected.productName,
        ruleId,
        mode: "direct",
        product,
      });
      const completed = await completeWorkflowProductCoding({
        productRecordId: sourceId,
        reservationId: reserved.reservation.id,
        mode: "direct",
        productName: selected.productName,
        product,
      });
      const formalSku = completed.sku || reserved.reservation.sku;
      await bindStockupFormalSku(selected.id, {
        formalSku,
        productId: completed.productRecordId,
        productName: selected.productName,
      });
      setMessage(`${selected.productName} 已生成正式 SKU：${formalSku}`);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "生成 SKU 失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="sc-coding-workspace">
      <header>
        <div>
          <span className="sc-eyebrow">NEW SKU CODING</span>
          <h2>新品 SKU 编码</h2>
          <p>无 SKU 商品先使用临时编码参与采购和履约；确认后生成正式 SKU，并自动回绑原需求、采购和仓库记录。</p>
        </div>
        <button className="sc-button sc-button-secondary" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={16} className={loading ? "spin" : ""} />
          刷新
        </button>
      </header>

      {error ? <div className="sc-alert sc-alert-danger">{error}</div> : null}
      {message ? <div className="sc-alert sc-alert-success"><CheckCircle2 size={16} />{message}</div> : null}

      <div className="sc-coding-grid">
        <div className="sc-coding-list">
          <div className="sc-coding-title"><b>待编码新品</b><span>{refs.length} 个</span></div>
          {refs.map((item) => (
            <button key={item.id} className={item.id === selectedId ? "is-active" : ""} onClick={() => setSelectedId(item.id)}>
              <span className="sc-coding-icon"><PackagePlus size={20} /></span>
              <span>
                <b>{item.productName}</b>
                <small>{item.temporarySku}{item.specification ? ` · ${item.specification}` : ""}</small>
              </span>
            </button>
          ))}
          {!loading && !refs.length ? (
            <div className="sc-coding-empty">
              <CheckCircle2 size={28} />
              <b>暂无待编码新品</b>
              <span>在备货需求中可以直接新增无 SKU 商品。</span>
            </div>
          ) : null}
        </div>

        <div className="sc-coding-editor">
          {selected ? (
            <>
              <div className="sc-coding-summary">
                <Hash size={22} />
                <div>
                  <small>当前临时编码</small>
                  <b>{selected.temporarySku}</b>
                  <span>{selected.productName}{selected.specification ? ` · ${selected.specification}` : ""}</span>
                </div>
              </div>
              <label>
                <span>选择编码规则</span>
                <select value={ruleId} onChange={(event) => setRuleId(event.target.value)}>
                  {(center?.rules || []).filter((item) => item.enabled).map((rule) => (
                    <option key={rule.id} value={rule.id}>{rule.name} · 下一编码 {rule.nextSku}</option>
                  ))}
                </select>
              </label>
              <div className="sc-coding-preview">
                <span>即将生成</span>
                <strong>{selectedRule?.nextSku || "请选择编码规则"}</strong>
                <small>编码会先预占，避免多人同时操作产生重复 SKU。</small>
              </div>
              <button className="sc-button sc-button-primary sc-coding-submit" disabled={saving || !ruleId} onClick={() => void createSku()}>
                <Sparkles size={17} />
                {saving ? "正在建档…" : "生成正式 SKU 并回绑"}
              </button>
            </>
          ) : (
            <div className="sc-coding-empty"><PackagePlus size={32} /><b>请选择待编码商品</b></div>
          )}
        </div>
      </div>
    </section>
  );
}
