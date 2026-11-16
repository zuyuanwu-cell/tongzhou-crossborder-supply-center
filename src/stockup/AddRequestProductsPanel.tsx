import React, { useEffect, useMemo, useState } from "react";
import { Check, PackagePlus, Search, Sparkles, Trash2, X } from "lucide-react";
import { addStockupCollaborationRequestProducts, fetchStockupCollaborationProducts } from "../api";
import type { CatalogProduct } from "../api";
import type { StockupRequest } from "./types";
import "./add-request-products-panel.css";
import "./add-request-products-temporary.css";

type Props = {
  request: StockupRequest;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onOpenSkuCoding?: () => void;
};

type DraftLine = {
  key: string;
  productId: string;
  sku: string;
  productName: string;
  imageUrl: string;
  specification: string;
  requestedQty: number;
  unit: string;
  supplyMode: string;
};

const supplyModes = ["外采成品", "委外生产", "自有成品库存", "待判断"];

function skuKey(value: string) {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function productKey(product: Pick<CatalogProduct, "id" | "sku">) {
  return String(product.id || "").trim() || skuKey(product.sku);
}

function toDraft(product: CatalogProduct): DraftLine {
  return {
    key: `${productKey(product)}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    productId: product.id,
    sku: product.sku,
    productName: product.name,
    imageUrl: product.imageUrl || "",
    specification: product.specification || "",
    requestedQty: 1,
    unit: product.unit || "件",
    supplyMode: product.defaultSupplyMode || "待判断",
  };
}

function temporaryDraft(): DraftLine {
  return {
    key: `temporary-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    productId: "",
    sku: "",
    productName: "",
    imageUrl: "",
    specification: "",
    requestedQty: 1,
    unit: "件",
    supplyMode: "待判断",
  };
}

export function AddRequestProductsPanel({ request, onClose, onChanged, onOpenSkuCoding }: Props) {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchStockupCollaborationProducts().then((result) => {
      if (!cancelled) setProducts(result.products || []);
    }).catch((loadError) => {
      if (!cancelled) setError(loadError instanceof Error ? loadError.message : "产品读取失败");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const existingProductIds = useMemo(() => new Set(request.lines.map((line) => String(line.productId || line.productRefId || "").trim()).filter(Boolean)), [request.lines]);
  const existingSkus = useMemo(() => new Set(request.lines.map((line) => skuKey(line.sku)).filter(Boolean)), [request.lines]);
  const selectedKeys = useMemo(() => new Set(lines.flatMap((line) => [String(line.productId || "").trim(), skuKey(line.sku)]).filter(Boolean)), [lines]);
  const matches = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const unique = new Map<string, CatalogProduct>();
    products.forEach((product) => {
      const key = productKey(product);
      if (key && !unique.has(key)) unique.set(key, product);
    });
    return [...unique.values()]
      .filter((product) => !keyword || `${product.sku} ${product.name} ${product.nameEn || ""} ${product.barcode || ""}`.toLowerCase().includes(keyword))
      .slice(0, 200);
  }, [products, query]);

  function isExisting(product: CatalogProduct) {
    return existingProductIds.has(String(product.id || "").trim()) || existingSkus.has(skuKey(product.sku));
  }

  function isSelected(product: CatalogProduct) {
    return selectedKeys.has(String(product.id || "").trim()) || selectedKeys.has(skuKey(product.sku));
  }

  function toggleProduct(product: CatalogProduct) {
    if (isExisting(product)) return;
    setLines((current) => isSelected(product)
      ? current.filter((line) => line.productId !== product.id && skuKey(line.sku) !== skuKey(product.sku))
      : [...current, toDraft(product)]);
  }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
  }

  function addTemporaryProduct() {
    setLines((current) => [...current, temporaryDraft()]);
    setError("");
  }

  async function submit() {
    if (!lines.length) {
      setError("请至少选择一个产品");
      return;
    }
    if (lines.some((line) => !Number.isFinite(line.requestedQty) || line.requestedQty <= 0)) {
      setError("需求数量必须大于 0");
      return;
    }
    if (lines.some((line) => !line.productName.trim())) {
      setError("无 SKU 商品必须填写产品名称");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await addStockupCollaborationRequestProducts(request.id, {
        expectedVersion: request.version,
        lines: lines.map((line) => ({
          productId: line.productId,
          sku: line.sku,
          productName: line.productName,
          imageUrl: line.imageUrl,
          specification: line.specification,
          requestedQty: line.requestedQty,
          unit: line.unit,
          supplyMode: line.supplyMode,
          method: "待计算",
        })),
      });
      await onChanged();
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "新增产品失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sc-route-backdrop sc-add-products-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section className="sc-add-products-panel" role="dialog" aria-modal="true" aria-label="增加需求产品">
        <header className="sc-add-products-header">
          <div><span className="sc-eyebrow">ADD PRODUCTS</span><h2>增加需求产品</h2><p>{request.requestNo} · 一次可增加多个产品</p></div>
          <button type="button" className="sc-icon-button" onClick={onClose} disabled={saving} aria-label="关闭"><X size={20} /></button>
        </header>
        <div className="sc-add-products-note">
          <PackagePlus size={18} />
          <span>{request.routePlanVersion > 0 ? "新增产品会单独计算国内库存、调拨、采购或委外缺口；原有产品的锁库和采购记录不会被重算。" : "新增产品将并入当前需求，确认执行方案时与原有产品一起分流。"}</span>
        </div>
        {error ? <div className="sc-add-products-error">{error}</div> : null}
        <div className="sc-add-products-body">
          <div className="sc-add-products-picker">
            <div className="sc-add-products-title"><strong>选择产品</strong><span>{loading ? "正在读取…" : `${matches.length} 个可见结果`}</span></div>
            <label className="sc-add-products-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 SKU、产品名或条码" autoFocus /></label>
            <button type="button" className="sc-add-products-temporary" onClick={addTemporaryProduct}><PackagePlus size={17} /><span><strong>新增无 SKU 商品</strong><small>保存时自动生成临时编码，后续可转正式 SKU</small></span></button>
            <div className="sc-add-products-options">
              {matches.map((product) => {
                const existing = isExisting(product);
                const selected = isSelected(product);
                return <button type="button" key={productKey(product)} className={`sc-add-products-option${selected ? " selected" : ""}`} disabled={existing} onClick={() => toggleProduct(product)}>
                  <span className="sc-add-products-thumb">{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <PackagePlus size={20} />}</span>
                  <span className="sc-add-products-option-copy"><strong>{product.name || product.sku}</strong><small>{product.sku}{product.specification ? ` · ${product.specification}` : ""}</small></span>
                  <span className={`sc-add-products-option-state${existing ? " existing" : ""}`}>{existing ? "已在需求中" : selected ? <><Check size={14} />已选择</> : "选择"}</span>
                </button>;
              })}
              {!loading && !matches.length ? <div className="sc-add-products-empty">没有匹配的产品，请换个关键词。</div> : null}
            </div>
          </div>
          <div className="sc-add-products-cart">
            <div className="sc-add-products-title"><strong>本次新增</strong><span>{lines.length} 个产品</span></div>
            <div className="sc-add-products-lines">
              {lines.map((line, index) => <article className={`sc-add-products-line${line.productId || line.sku ? "" : " is-temporary"}`} key={line.key}>
                <div className="sc-add-products-line-head"><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{line.productName || "待填写新品"}</strong><small>{line.sku || "保存后自动生成临时编码"}</small></div><button type="button" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))} aria-label="删除"><Trash2 size={16} /></button></div>
                {!line.productId && !line.sku ? <div className="sc-add-products-temporary-fields">
                  <label><span>产品名称 <em>*</em></span><input value={line.productName} onChange={(event) => updateLine(line.key, { productName: event.target.value })} placeholder="例如：新品男士洁面乳" /></label>
                  <label><span>规格</span><input value={line.specification} onChange={(event) => updateLine(line.key, { specification: event.target.value })} placeholder="例如：100ml" /></label>
                  <label><span>单位</span><input value={line.unit} onChange={(event) => updateLine(line.key, { unit: event.target.value })} placeholder="件 / 盒 / 瓶" /></label>
                </div> : null}
                <div className="sc-add-products-fields">
                  <label><span>需求数量</span><div className="sc-add-products-quantity"><input type="number" min="0.0001" step="any" value={line.requestedQty} onChange={(event) => updateLine(line.key, { requestedQty: Number(event.target.value) })} /><em>{line.unit}</em></div></label>
                  <label><span>供应方式</span><select value={line.supplyMode} onChange={(event) => updateLine(line.key, { supplyMode: event.target.value })}>{supplyModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select></label>
                </div>
              </article>)}
              {!lines.length ? <div className="sc-add-products-empty prominent"><PackagePlus size={28} /><strong>从左侧选择产品</strong><span>支持一次追加多个产品</span></div> : null}
            </div>
          </div>
        </div>
        <footer className="sc-add-products-footer"><span>无 SKU 商品会先生成临时编码，不影响当前需求继续流转。</span><div>{onOpenSkuCoding ? <button type="button" className="sc-button sc-button-secondary" onClick={onOpenSkuCoding} disabled={saving}><Sparkles size={16} />新品 SKU 编码</button> : null}<button type="button" className="sc-button sc-button-secondary" onClick={onClose} disabled={saving}>取消</button><button type="button" className="sc-button sc-button-primary" onClick={() => void submit()} disabled={saving || !lines.length}><PackagePlus size={16} />{saving ? "正在增加…" : `确认增加${lines.length ? `（${lines.length}）` : ""}`}</button></div></footer>
      </section>
    </div>
  );
}
