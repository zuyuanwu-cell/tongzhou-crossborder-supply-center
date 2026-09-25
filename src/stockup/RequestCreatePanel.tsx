import React, { useEffect, useMemo, useState } from "react";
import { Check, PackagePlus, Plus, Save, Search, Send, Trash2, X } from "lucide-react";
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
  projectTeams?: Array<{ id: string; name: string }>;
  defaultProjectTeamId?: string;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
};

const COMMON_COUNTRIES = ["中国", "俄罗斯", "马来西亚", "印度尼西亚", "越南", "菲律宾", "泰国", "新加坡", "美国", "英国"];
const PLATFORM_OPTIONS = ["Ozon", "Shopee", "TikTok Shop", "Lazada", "Temu", "Amazon", "Shopify", "独立站", "线下渠道"];

function skuKey(value: string) {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function countryName(value: string) {
  const country = String(value || "").replace(/[\s\u200B-\u200D\uFEFF]+/g, "").trim();
  if (/印度尼西亚|印尼/i.test(country)) return "印度尼西亚";
  if (/中国大陆|^中国$/i.test(country)) return "中国";
  if (/Russian|Russia|俄罗斯/i.test(country)) return "俄罗斯";
  return country;
}

function uniqueKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function RequestCreatePanel({ products, warehouses = [], projectTeams = [], defaultProjectTeamId = "", onClose, onSave }: Props) {
  const [query, setQuery] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ project: "", destinationCountry: "", destinationWarehouseId: "", destinationWarehouseName: "", expectedArrivalAt: "", priority: "常规", reason: "补库存", platform: "", note: "" });
  const [lines, setLines] = useState<StockupRequestDraftLine[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState(defaultProjectTeamId || "");
  const [platformChoice, setPlatformChoice] = useState("");

  useEffect(() => {
    const preferred = projectTeams.find((team) => team.id === defaultProjectTeamId);
    if (!preferred) return;
    setSelectedTeamId((current) => current === "other" || !current ? preferred.id : current);
    setForm((current) => current.project ? current : ({ ...current, project: preferred.name }));
  }, [defaultProjectTeamId, projectTeams]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, saving]);

  const productMatches = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const preferredCountry = countryName(form.destinationCountry).toLowerCase();
    const ordered = [...products].sort((left, right) => {
      const leftPreferred = preferredCountry && countryName(left.country || "").toLowerCase() === preferredCountry ? 1 : 0;
      const rightPreferred = preferredCountry && countryName(right.country || "").toLowerCase() === preferredCountry ? 1 : 0;
      return rightPreferred - leftPreferred;
    });
    const unique = new Map<string, CatalogProduct>();
    ordered.forEach((product) => {
      const key = skuKey(product.sku);
      if (key && !unique.has(key)) unique.set(key, product);
    });
    return [...unique.values()].filter((product) => !keyword || `${product.sku} ${product.name} ${product.nameEn}`.toLowerCase().includes(keyword)).slice(0, 12);
  }, [form.destinationCountry, products, query]);

  const warehouseOptions = useMemo(() => {
    const options = new Map<string, { id: string; name: string; country: string }>();
    warehouses.forEach((warehouse) => {
      const warehouseId = String(warehouse.id || "").trim();
      if (warehouseId && warehouse.name) options.set(warehouseId, { id: warehouseId, name: warehouse.name, country: countryName(warehouse.country || "") });
    });
    products.forEach((product) => product.warehouseBreakdown?.forEach((warehouse) => {
      if (warehouse.warehouseId && warehouse.warehouseName && !options.has(warehouse.warehouseId)) options.set(warehouse.warehouseId, { id: warehouse.warehouseId, name: warehouse.warehouseName, country: countryName(product.country) });
    }));
    return [...options.values()];
  }, [products, warehouses]);

  const countryOptions = useMemo(() => Array.from(new Set([
    ...warehouseOptions.map((warehouse) => warehouse.country).filter(Boolean),
    ...COMMON_COUNTRIES,
  ])), [warehouseOptions]);

  const filteredWarehouses = useMemo(() => warehouseOptions.filter((warehouse) => !form.destinationCountry || !warehouse.country || warehouse.country === form.destinationCountry), [form.destinationCountry, warehouseOptions]);

  function addProduct(product: CatalogProduct) {
    const duplicate = lines.find((line) => skuKey(line.sku) === skuKey(product.sku));
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
    <div className="sc-modal-backdrop" role="presentation">
      <div className="sc-modal sc-request-editor" role="dialog" aria-modal="true" aria-labelledby="stockup-request-title">
        <header className="sc-modal-head">
          <div>
            <span className="sc-eyebrow">NEW STOCKUP REQUEST</span>
            <h2 id="stockup-request-title">新建备货需求</h2>
            <p>只填目的地、到仓时间和产品清单，后续采购与物流由供应链接力。</p>
          </div>
          <button className="sc-icon-button" onClick={onClose} aria-label="关闭"><X size={20} /></button>
        </header>

        <div className="sc-editor-scroll">
          {error ? <div className="sc-alert sc-alert-danger">{error}</div> : null}
          <section className="sc-form-section">
            <div className="sc-section-heading"><span>01</span><div><b>需求去向</b><small>决定由谁受理、送到哪里</small></div></div>
            <div className="sc-form-grid sc-form-grid-4">
              <label>项目 / 团队
                <select value={selectedTeamId} onChange={(event) => {
                  const teamId = event.target.value;
                  const team = projectTeams.find((item) => item.id === teamId);
                  setSelectedTeamId(teamId);
                  setForm({ ...form, project: team?.name || "" });
                }}>
                  <option value="">请选择项目团队</option>
                  {projectTeams.map((team) => <option key={team.id} value={team.id}>{team.name}{team.id === defaultProjectTeamId ? "（我的团队）" : ""}</option>)}
                  <option value="other">其他团队</option>
                </select>
                {selectedTeamId === "other" ? <input value={form.project} onChange={(event) => setForm({ ...form, project: event.target.value })} placeholder="填写项目或团队名称" /> : null}
              </label>
              <label>目的国家
                <select value={form.destinationCountry} onChange={(event) => {
                  const destinationCountry = event.target.value;
                  const selectedWarehouse = warehouseOptions.find((item) => item.id === form.destinationWarehouseId);
                  setForm({ ...form, destinationCountry, ...(selectedWarehouse?.country && selectedWarehouse.country !== destinationCountry ? { destinationWarehouseId: "", destinationWarehouseName: "" } : {}) });
                }}>
                  <option value="">请选择目的国家</option>
                  {countryOptions.map((country) => <option key={country} value={country}>{country}</option>)}
                </select>
              </label>
              <label>目的仓库
                <select value={form.destinationWarehouseId} onChange={(event) => {
                  const option = warehouseOptions.find((item) => item.id === event.target.value);
                  setForm({ ...form, destinationWarehouseId: option?.id || "", destinationWarehouseName: option?.name || "", destinationCountry: option?.country || form.destinationCountry });
                }}>
                  <option value="">请选择启用仓库</option>
                  {filteredWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                </select>
              </label>
              <label>期望到仓日期<input type="date" value={form.expectedArrivalAt} onChange={(event) => setForm({ ...form, expectedArrivalAt: event.target.value })} /></label>
              <label>优先级<select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}><option>常规</option><option>加急</option><option>紧急</option></select></label>
              <label>需求原因<select value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })}><option>补库存</option><option>活动备货</option><option>新品首单</option><option>客户订单</option><option>其他</option></select></label>
              <label>销售平台（可选）
                <select value={platformChoice} onChange={(event) => {
                  const value = event.target.value;
                  setPlatformChoice(value);
                  setForm({ ...form, platform: value === "other" ? "" : value });
                }}>
                  <option value="">请选择销售平台</option>
                  {PLATFORM_OPTIONS.map((platform) => <option key={platform} value={platform}>{platform}</option>)}
                  <option value="other">其他平台</option>
                </select>
                {platformChoice === "other" ? <input value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value })} placeholder="填写其他销售平台" /> : null}
              </label>
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
                  {productMatches.length ? productMatches.map((product) => {
                    const selected = lines.some((line) => skuKey(line.sku) === skuKey(product.sku));
                    return (
                    <button key={skuKey(product.sku)} disabled={selected} onClick={() => addProduct(product)}>
                      <span className="sc-product-thumb">{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <PackagePlus size={20} />}</span>
                      <span><b>{product.sku}</b><small>{product.name}</small></span>
                      {selected ? <Check size={17} /> : <Plus size={17} />}
                    </button>
                  ); }) : <p>没有找到匹配产品</p>}
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
