import React, { useMemo, useState } from "react";
import { Check, Copy, PackagePlus, Plus, Save, Search, Send, Trash2, X } from "lucide-react";
import type { CatalogProduct, WarehouseConnection } from "../api";

export type StockupRequestDraftLine = {
  key: string;
  productId: string;
  sku: string;
  productName: string;
  imageUrl: string;
  specification: string;
  method: string;
  requestedQty: number;
  unit: string;
  targetUnitCostCny: number | "";
  note: string;
};

type Props = {
  products: CatalogProduct[];
  warehouses?: Array<Pick<WarehouseConnection, "id" | "name" | "country" | "status">>;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
};

function uniqueKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function RequestCreatePanel({ products, warehouses = [], onClose, onSave }: Props) {
  const [query, setQuery] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ project: "", destinationCountry: "", destinationWarehouseId: "", destinationWarehouseName: "", expectedArrivalAt: "", priority: "常规", reason: "补库存", platform: "", note: "" });
  const [lines, setLines] = useState<StockupRequestDraftLine[]>([]);

  const productMatches = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return products.filter((product) => !keyword || `${product.sku} ${product.name} ${product.nameEn}`.toLowerCase().includes(keyword)).slice(0, 12);
  }, [products, query]);

  const warehouseOptions = useMemo(() => {
    const options = new Map<string, { id: string; name: string; country: string }>();
    warehouses.forEach((warehouse) => {
      const warehouseId = String(warehouse.id || "").trim();
      if (warehouseId && warehouse.name) options.set(warehouseId, { id: warehouseId, name: warehouse.name, country: warehouse.country || "" });
    });
    products.forEach((product) => product.warehouseBreakdown?.forEach((warehouse) => {
      if (warehouse.warehouseId && warehouse.warehouseName && !options.has(warehouse.warehouseId)) options.set(warehouse.warehouseId, { id: warehouse.warehouseId, name: warehouse.warehouseName, country: product.country });
    }));
    return [...options.values()];
  }, [products, warehouses]);

  function addProduct(product: CatalogProduct) {
    const duplicate = lines.find((line) => line.sku.toUpperCase() === product.sku.toUpperCase() && line.method === "采购");
    if (duplicate) {
      setLines((current) => current.map((line) => line.key === duplicate.key ? { ...line, requestedQty: line.requestedQty + 1 } : line));
    } else {
      setLines((current) => [...current, {
        key: uniqueKey(), productId: product.id, sku: product.sku, productName: product.name, imageUrl: product.imageUrl || "",
        specification: product.specification || "", method: "采购", requestedQty: 1, unit: product.unit || "件",
        targetUnitCostCny: product.directCostPrice ?? product.directPrice ?? "", note: "",
      }]);
    }
    setShowPicker(false);
    setQuery("");
  }

  function updateLine(key: string, patch: Partial<StockupRequestDraftLine>) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
  }

  async function submit(submitNow: boolean) {
    setError("");
    if (!form.project || !form.destinationCountry || !form.destinationWarehouseName || !form.expectedArrivalAt || !form.reason) {
      setError("请先填写项目、目的地、期望到仓日期和需求原因。");
      return;
    }
    if (!lines.length || lines.some((line) => !line.sku || line.requestedQty <= 0)) {
      setError("请至少添加一个产品，并填写正确的需求数量。");
      return;
    }
    setSaving(true);
    try {
      await onSave({ ...form, submit: submitNow, lines: lines.map(({ key: _key, ...line }) => line) });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "保存失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sc-modal-backdrop" role="dialog" aria-modal="true" aria-label="新建备货需求">
      <div className="sc-modal sc-request-editor">
        <header className="sc-modal-head">
          <div>
            <span className="sc-eyebrow">NEW STOCKUP REQUEST</span>
            <h2>新建备货需求</h2>
            <p>只填目的地、到仓时间和产品清单，后续采购与物流由供应链接力。</p>
          </div>
          <button className="sc-icon-button" onClick={onClose} aria-label="关闭"><X size={20} /></button>
        </header>

        <div className="sc-editor-scroll">
          {error ? <div className="sc-alert sc-alert-danger">{error}</div> : null}
          <section className="sc-form-section">
            <div className="sc-section-heading"><span>01</span><div><b>需求去向</b><small>决定由谁受理、送到哪里</small></div></div>
            <div className="sc-form-grid sc-form-grid-4">
              <label>项目 / 团队<input value={form.project} onChange={(event) => setForm({ ...form, project: event.target.value })} placeholder="例如：直营运营一组" /></label>
              <label>目的国家<input value={form.destinationCountry} onChange={(event) => setForm({ ...form, destinationCountry: event.target.value })} placeholder="俄罗斯 / 马来西亚" /></label>
              <label>目的仓库
                <select value={form.destinationWarehouseId} onChange={(event) => {
                  const option = warehouseOptions.find((item) => item.id === event.target.value);
                  setForm({ ...form, destinationWarehouseId: option?.id || "", destinationWarehouseName: option?.name || "", destinationCountry: form.destinationCountry || option?.country || "" });
                }}>
                  <option value="">请选择启用仓库</option>
                  {warehouseOptions.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                </select>
              </label>
              <label>期望到仓日期<input type="date" value={form.expectedArrivalAt} onChange={(event) => setForm({ ...form, expectedArrivalAt: event.target.value })} /></label>
              <label>优先级<select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}><option>常规</option><option>加急</option><option>紧急</option></select></label>
              <label>需求原因<select value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })}><option>补库存</option><option>活动备货</option><option>新品首单</option><option>客户订单</option><option>其他</option></select></label>
              <label>销售平台（可选）<input value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value })} placeholder="Ozon / Shopee" /></label>
              <label>备注（可选）<input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="告诉供应链需要注意的事情" /></label>
            </div>
          </section>

          <section className="sc-form-section">
            <div className="sc-section-heading"><span>02</span><div><b>产品清单</b><small>一张需求单可以放多个产品</small></div></div>
            <div className="sc-product-toolbar">
              <div className="sc-product-search"><Search size={17} /><input value={query} onFocus={() => setShowPicker(true)} onChange={(event) => { setQuery(event.target.value); setShowPicker(true); }} placeholder="搜索 SKU、中文名或外文名" /></div>
              <button className="sc-button sc-button-secondary" onClick={() => setShowPicker((value) => !value)}><Plus size={17} />添加产品</button>
              {showPicker ? (
                <div className="sc-product-picker">
                  {productMatches.length ? productMatches.map((product) => (
                    <button key={`${product.id}-${product.sku}`} onClick={() => addProduct(product)}>
                      <span className="sc-product-thumb">{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <PackagePlus size={20} />}</span>
                      <span><b>{product.sku}</b><small>{product.name}</small></span>
                      <Plus size={17} />
                    </button>
                  )) : <p>没有找到匹配产品</p>}
                </div>
              ) : null}
            </div>

            {lines.length ? (
              <div className="sc-line-editor">
                {lines.map((line, index) => (
                  <div className="sc-line-row" key={line.key}>
                    <span className="sc-line-index">{String(index + 1).padStart(2, "0")}</span>
                    <span className="sc-product-thumb large">{line.imageUrl ? <img src={line.imageUrl} alt="" /> : <PackagePlus size={22} />}</span>
                    <div className="sc-line-product"><b>{line.sku}</b><span>{line.productName}</span><small>{line.specification || "未配置规格"}</small></div>
                    <label>执行方式<select value={line.method} onChange={(event) => updateLine(line.key, { method: event.target.value })}><option>采购</option><option>委外生产</option><option>自有库存调拨</option></select></label>
                    <label>需求数量<div className="sc-input-unit"><input type="number" min="0.01" value={line.requestedQty} onChange={(event) => updateLine(line.key, { requestedQty: Number(event.target.value) })} /><span>{line.unit}</span></div></label>
                    <label>目标成本（可选）<input type="number" min="0" step="0.01" value={line.targetUnitCostCny} onChange={(event) => updateLine(line.key, { targetUnitCostCny: event.target.value === "" ? "" : Number(event.target.value) })} /></label>
                    <div className="sc-line-actions">
                      <button title="复制一行" onClick={() => setLines((current) => [...current, { ...line, key: uniqueKey() }])}><Copy size={16} /></button>
                      <button title="删除" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}><Trash2 size={16} /></button>
                    </div>
                  </div>
                ))}
              </div>
            ) : <div className="sc-empty-inline"><PackagePlus size={28} /><b>先添加需要采购或生产的产品</b><span>产品图片、名称、规格和成本会自动带入。</span></div>}
          </section>
        </div>

        <footer className="sc-modal-foot">
          <div className="sc-safe-note"><Check size={16} />草稿不会进入供应链待办，也不会发送通知。</div>
          <div><button className="sc-button sc-button-secondary" disabled={saving} onClick={() => submit(false)}><Save size={17} />保存草稿</button><button className="sc-button sc-button-primary" disabled={saving} onClick={() => submit(true)}><Send size={17} />{saving ? "正在提交…" : "提交需求"}</button></div>
        </footer>
      </div>
    </div>
  );
}
