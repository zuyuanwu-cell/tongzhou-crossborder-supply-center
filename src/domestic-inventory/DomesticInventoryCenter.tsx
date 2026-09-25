import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  Check,
  ClipboardList,
  Edit3,
  FileDown,
  FileUp,
  History,
  PackagePlus,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Warehouse,
  X,
} from "lucide-react";
import {
  type CatalogProduct,
  type DomesticInventoryMovement,
  type DomesticInventoryPayload,
  type DomesticWarehouse,
  createDomesticInventoryMovement,
  createDomesticWarehouse,
  fetchDomesticInventory,
  fetchDomesticInventoryMovements,
  importDomesticOpeningInventory,
  updateDomesticInventorySafetyStock,
  updateDomesticWarehouse,
} from "../api";
import "./domestic-inventory.css";

type ViewTab = "inventory" | "movements" | "warehouses";
type MovementType = "inbound" | "outbound" | "adjustment";

type MovementLineDraft = {
  productId: string;
  sku: string;
  productName: string;
  imageUrl: string;
  specification: string;
  unit: string;
  quantity: number;
  deltaQty: number;
  unitCostCny: number;
};

type Props = {
  products: CatalogProduct[];
  canManage: boolean;
};

const emptyPayload: DomesticInventoryPayload = {
  ok: true,
  updatedAt: "",
  summary: { warehouses: 0, skuCount: 0, onHandQty: 0, availableQty: 0, lowStockSkuCount: 0 },
  warehouses: [],
  balances: [],
};

function skuKey(value: unknown) {
  return String(value ?? "").replace(/\s+/g, "").toUpperCase();
}

function numberText(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value || 0);
}

function dateTime(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function uniqueProducts(products: CatalogProduct[]) {
  const output = new Map<string, CatalogProduct>();
  for (const product of products) {
    const key = skuKey(product.sku || product.skuNo);
    if (!key) continue;
    const current = output.get(key);
    if (!current || (!current.imageUrl && product.imageUrl)) output.set(key, product);
  }
  return [...output.values()].sort((a, b) => skuKey(a.sku).localeCompare(skuKey(b.sku)));
}

function movementLabel(type: DomesticInventoryMovement["type"]) {
  return { opening: "期初库存", inbound: "采购入库", outbound: "领用 / 出库", adjustment: "库存调整" }[type];
}

function movementIcon(type: DomesticInventoryMovement["type"]) {
  return type === "opening" ? <FileUp size={17} /> : type === "inbound" ? <ArrowDownToLine size={17} /> : type === "outbound" ? <ArrowUpFromLine size={17} /> : <SlidersHorizontal size={17} />;
}

function useEscapeClose(onClose: () => void, disabled = false) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !disabled) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [disabled, onClose]);
}

function parseCsv(content: string) {
  const delimiter = content.split(/\r?\n/, 1)[0]?.includes("\t") ? "\t" : content.split(/\r?\n/, 1)[0]?.includes(";") && !content.split(/\r?\n/, 1)[0]?.includes(",") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === '"') {
      if (quoted && content[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(field.trim()); field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && content[index + 1] === "\n") index += 1;
      row.push(field.trim()); field = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else {
      field += character;
    }
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function downloadOpeningTemplate() {
  const content = "\uFEFFSKU,期初数量,安全库存,人民币单位成本\nTZKJ-DEMO-001,100,20,9.90\n";
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "国内仓期初库存导入模板.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function DomesticInventoryCenter({ products, canManage }: Props) {
  const [payload, setPayload] = useState<DomesticInventoryPayload>(emptyPayload);
  const [movements, setMovements] = useState<DomesticInventoryMovement[]>([]);
  const [tab, setTab] = useState<ViewTab>("inventory");
  const [warehouseId, setWarehouseId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [query, setQuery] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [movementModal, setMovementModal] = useState<MovementType | null>(null);
  const [warehouseModal, setWarehouseModal] = useState(false);
  const [openingImportModal, setOpeningImportModal] = useState(false);
  const [safetyDrafts, setSafetyDrafts] = useState<Record<string, string>>({});

  const loadInventory = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchDomesticInventory({ warehouseId, keyword: query, lowStock: lowStockOnly });
      setPayload(data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "国内库存读取失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, [warehouseId, query, lowStockOnly]);

  const loadMovements = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchDomesticInventoryMovements({ warehouseId, keyword: query });
      setMovements(data.movements);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "库存流水读取失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, [warehouseId, query]);

  useEffect(() => { void loadInventory(); }, [loadInventory]);
  useEffect(() => { if (tab === "movements") void loadMovements(); }, [tab, loadMovements]);

  const activeWarehouses = useMemo(() => payload.warehouses.filter((item) => item.status === "active"), [payload.warehouses]);
  const productOptions = useMemo(() => uniqueProducts(products), [products]);

  function runSearch() {
    setQuery(keyword.trim());
  }

  async function saveSafetyStock(itemWarehouseId: string, sku: string, current: number) {
    const value = Number(safetyDrafts[`${itemWarehouseId}:${sku}`] ?? current);
    if (!Number.isFinite(value) || value < 0) {
      setError("安全库存必须是大于或等于 0 的数字。");
      return;
    }
    try {
      await updateDomesticInventorySafetyStock(itemWarehouseId, sku, value);
      setSuccess(`${sku} 的安全库存已更新。`);
      await loadInventory();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "安全库存更新失败。");
    }
  }

  async function toggleWarehouse(warehouse: DomesticWarehouse) {
    setError("");
    try {
      await updateDomesticWarehouse(warehouse.id, { ...warehouse, status: warehouse.status === "active" ? "inactive" : "active" });
      setSuccess(`${warehouse.name}已${warehouse.status === "active" ? "停用" : "启用"}。`);
      await loadInventory();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "仓库状态更新失败。");
    }
  }

  return (
    <main className="domestic-inventory-page">
      <section className="domestic-inventory-hero">
        <div>
          <p className="eyebrow">DOMESTIC INVENTORY CONTROL</p>
          <h2>国内仓进销存</h2>
          <p>管理国内成品仓的入库、出库、库存调整和安全库存，让每一件货都有可追溯流水。</p>
        </div>
        <div className="domestic-inventory-hero-mark" aria-hidden="true"><Warehouse size={34} /><span>进 · 销 · 存</span></div>
      </section>

      {error ? <div className="domestic-inventory-notice error"><AlertTriangle size={17} />{error}<button type="button" onClick={() => setError("")}><X size={15} /></button></div> : null}
      {success ? <div className="domestic-inventory-notice success"><Check size={17} />{success}<button type="button" onClick={() => setSuccess("")}><X size={15} /></button></div> : null}

      {canManage && (!payload.warehouses.length || !payload.balances.length) ? <section className="domestic-onboarding">
        <header><div><span>FIRST USE</span><h3>三步建立国内仓库存台账</h3><p>先建仓，再一次性导入期初库存；之后所有入库、出库和调整都会形成可追溯流水。</p></div><FileUp size={28} /></header>
        <div>
          <article className={!payload.warehouses.length ? "current" : "done"}><b>01</b><span><strong>建立仓库档案</strong><small>维护仓库编码、名称和联系人</small></span>{!payload.warehouses.length ? <button type="button" onClick={() => { setTab("warehouses"); setWarehouseModal(true); }}>新建仓库</button> : <Check size={18} />}</article>
          <article className={payload.warehouses.length && !payload.balances.length ? "current" : payload.balances.length ? "done" : ""}><b>02</b><span><strong>导入期初库存</strong><small>下载模板后批量导入 SKU、数量和安全库存</small></span>{payload.warehouses.length && !payload.balances.length ? <button type="button" disabled={!activeWarehouses.length} onClick={() => setOpeningImportModal(true)}>导入期初</button> : payload.balances.length ? <Check size={18} /> : null}</article>
          <article className={payload.balances.length ? "current" : ""}><b>03</b><span><strong>维护安全库存</strong><small>在库存台账直接设置补货预警线</small></span></article>
        </div>
      </section> : null}

      <section className="domestic-inventory-metrics">
        <article><span>启用仓库</span><strong>{payload.summary.warehouses}</strong><small>国内成品仓</small></article>
        <article><span>在库 SKU</span><strong>{numberText(payload.summary.skuCount)}</strong><small>已建立库存台账</small></article>
        <article><span>在库数量</span><strong>{numberText(payload.summary.onHandQty)}</strong><small>可用 {numberText(payload.summary.availableQty)}</small></article>
        <article className={payload.summary.lowStockSkuCount ? "warning" : ""}><span>低库存</span><strong>{numberText(payload.summary.lowStockSkuCount)}</strong><small>低于安全库存</small></article>
      </section>

      <section className="domestic-inventory-workspace">
        <div className="domestic-inventory-tabs">
          <button className={tab === "inventory" ? "active" : ""} onClick={() => setTab("inventory")}><Boxes size={17} />库存台账</button>
          <button className={tab === "movements" ? "active" : ""} onClick={() => setTab("movements")}><History size={17} />进销存流水</button>
          <button className={tab === "warehouses" ? "active" : ""} onClick={() => setTab("warehouses")}><Warehouse size={17} />仓库档案</button>
          <span className="domestic-inventory-updated">更新 {dateTime(payload.updatedAt)}</span>
        </div>

        <div className="domestic-inventory-toolbar">
          <label className="domestic-inventory-search"><Search size={17} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") runSearch(); }} placeholder={tab === "movements" ? "搜索单号、关联单号、SKU 或产品" : "搜索 SKU、产品或仓库"} /></label>
          <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} aria-label="选择国内仓库">
            <option value="">全部国内仓库</option>
            {payload.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}{warehouse.status === "inactive" ? "（已停用）" : ""}</option>)}
          </select>
          {tab === "inventory" ? <label className="domestic-inventory-check"><input type="checkbox" checked={lowStockOnly} onChange={(event) => setLowStockOnly(event.target.checked)} />只看低库存</label> : null}
          <button className="domestic-inventory-secondary" type="button" onClick={runSearch}><Search size={16} />查询</button>
          <button className="domestic-inventory-secondary icon-only" type="button" aria-label="刷新" onClick={() => void (tab === "movements" ? loadMovements() : loadInventory())}><RefreshCw className={loading ? "spinning" : ""} size={17} /></button>
          {canManage && tab !== "warehouses" ? (
            <div className="domestic-inventory-actions">
              <button type="button" disabled={!activeWarehouses.length} title={activeWarehouses.length ? "批量导入期初库存" : "请先创建并启用国内仓库"} onClick={() => setOpeningImportModal(true)}><FileUp size={17} />期初导入</button>
              <button type="button" disabled={!activeWarehouses.length} title={activeWarehouses.length ? "登记采购入库" : "请先创建并启用国内仓库"} onClick={() => setMovementModal("inbound")}><PackagePlus size={17} />入库</button>
              <button type="button" disabled={!activeWarehouses.length} title={activeWarehouses.length ? "登记领用或出库" : "请先创建并启用国内仓库"} onClick={() => setMovementModal("outbound")}><ArrowUpFromLine size={17} />出库</button>
              <button type="button" disabled={!activeWarehouses.length} title={activeWarehouses.length ? "登记库存调整" : "请先创建并启用国内仓库"} onClick={() => setMovementModal("adjustment")}><SlidersHorizontal size={17} />调整</button>
            </div>
          ) : null}
          {canManage && tab === "warehouses" ? <button className="domestic-inventory-primary" type="button" onClick={() => setWarehouseModal(true)}><Plus size={17} />新建仓库</button> : null}
        </div>

        {tab === "inventory" ? (
          <InventoryTable payload={payload} loading={loading} canManage={canManage} safetyDrafts={safetyDrafts} setSafetyDrafts={setSafetyDrafts} onSaveSafety={saveSafetyStock} />
        ) : tab === "movements" ? (
          <MovementTable movements={movements} loading={loading} />
        ) : (
          <WarehouseCards warehouses={payload.warehouses} canManage={canManage} onToggle={toggleWarehouse} />
        )}
      </section>

      {movementModal ? (
        <MovementModal
          type={movementModal}
          warehouses={activeWarehouses}
          products={productOptions}
          onClose={() => setMovementModal(null)}
          onSaved={async (message) => { setMovementModal(null); setSuccess(message); await loadInventory(); if (tab === "movements") await loadMovements(); }}
          onError={setError}
        />
      ) : null}
      {openingImportModal ? <OpeningImportModal warehouses={activeWarehouses} products={productOptions} onClose={() => setOpeningImportModal(false)} onSaved={async (message) => { setOpeningImportModal(false); setSuccess(message); setTab("inventory"); await loadInventory(); }} onError={setError} /> : null}
      {warehouseModal ? <WarehouseModal onClose={() => setWarehouseModal(false)} onSaved={async (name) => { setWarehouseModal(false); setSuccess(`${name}已建立。`); await loadInventory(); }} onError={setError} /> : null}
    </main>
  );
}

function InventoryTable({ payload, loading, canManage, safetyDrafts, setSafetyDrafts, onSaveSafety }: {
  payload: DomesticInventoryPayload;
  loading: boolean;
  canManage: boolean;
  safetyDrafts: Record<string, string>;
  setSafetyDrafts: (value: Record<string, string>) => void;
  onSaveSafety: (warehouseId: string, sku: string, current: number) => void;
}) {
  if (!loading && !payload.balances.length) return <EmptyState title="还没有库存台账" description="先建立国内仓库，再登记第一笔采购入库。" />;
  return (
    <div className="domestic-inventory-table-wrap">
      <table className="domestic-inventory-table">
        <thead><tr><th>产品</th><th>仓库</th><th>在库</th><th>占用</th><th>可用</th><th>安全库存</th><th>状态</th><th>更新时间</th></tr></thead>
        <tbody>
          {payload.balances.map((item) => {
            const draftKey = `${item.warehouseId}:${item.sku}`;
            return (
              <tr key={draftKey}>
                <td><div className="domestic-product-cell">{item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span><Boxes size={19} /></span>}<div><strong>{item.productName}</strong><small>{item.sku}{item.specification ? ` · ${item.specification}` : ""}</small></div></div></td>
                <td><strong>{item.warehouseName}</strong></td>
                <td className="number-cell">{numberText(item.onHandQty)} <small>{item.unit}</small></td>
                <td className="number-cell muted">{numberText(item.reservedQty)}</td>
                <td className="number-cell"><strong>{numberText(item.availableQty)}</strong></td>
                <td>{canManage ? <div className="safety-editor"><input type="number" min="0" value={safetyDrafts[draftKey] ?? item.safetyStockQty} onChange={(event) => setSafetyDrafts({ ...safetyDrafts, [draftKey]: event.target.value })} /><button aria-label="保存安全库存" type="button" onClick={() => onSaveSafety(item.warehouseId, item.sku, item.safetyStockQty)}><Check size={15} /></button></div> : numberText(item.safetyStockQty)}</td>
                <td><span className={`domestic-status ${item.lowStock ? "low" : "normal"}`}>{item.lowStock ? "需补货" : "正常"}</span></td>
                <td className="muted">{dateTime(item.updatedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {loading ? <div className="domestic-loading">正在读取库存台账…</div> : null}
    </div>
  );
}

function MovementTable({ movements, loading }: { movements: DomesticInventoryMovement[]; loading: boolean }) {
  if (!loading && !movements.length) return <EmptyState title="还没有库存流水" description="入库、出库和调整记录会按时间沉淀在这里。" />;
  return (
    <div className="domestic-movement-list">
      {movements.map((movement) => (
        <details key={movement.id} className={`domestic-movement ${movement.type}`}>
          <summary>
            <span className="movement-icon">{movementIcon(movement.type)}</span>
            <span><strong>{movement.movementNo}</strong><small>{movementLabel(movement.type)} · {movement.warehouseName}</small></span>
            <span><strong>{movement.lines.length} 个 SKU</strong><small>{movement.referenceNo || "无关联单号"}</small></span>
            <span><strong>{movement.createdByName}</strong><small>{dateTime(movement.occurredAt)}</small></span>
          </summary>
          <div className="movement-lines">
            {movement.note ? <p className="movement-note">备注：{movement.note}</p> : null}
            {movement.lines.map((line) => <div key={line.id}><span>{line.sku}</span><strong>{line.productName}</strong><span className={line.signedQty >= 0 ? "positive" : "negative"}>{line.signedQty >= 0 ? "+" : ""}{numberText(line.signedQty)} {line.unit}</span><small>{numberText(line.beforeQty)} → {numberText(line.afterQty)}</small></div>)}
          </div>
        </details>
      ))}
      {loading ? <div className="domestic-loading">正在读取进销存流水…</div> : null}
    </div>
  );
}

function WarehouseCards({ warehouses, canManage, onToggle }: { warehouses: DomesticWarehouse[]; canManage: boolean; onToggle: (warehouse: DomesticWarehouse) => void }) {
  if (!warehouses.length) return <EmptyState title="还没有国内仓库" description="创建仓库档案后即可开始登记成品库存。" />;
  return <div className="domestic-warehouse-grid">{warehouses.map((warehouse) => (
    <article key={warehouse.id} className={warehouse.status === "inactive" ? "inactive" : ""}>
      <header><span><Warehouse size={20} /></span><div><strong>{warehouse.name}</strong><small>{warehouse.code}</small></div><em>{warehouse.status === "active" ? "启用" : "停用"}</em></header>
      <dl><div><dt>库存 SKU</dt><dd>{warehouse.skuCount}</dd></div><div><dt>在库数量</dt><dd>{numberText(warehouse.onHandQty)}</dd></div><div><dt>低库存</dt><dd>{warehouse.lowStockSkuCount}</dd></div></dl>
      <p>{[warehouse.province, warehouse.city, warehouse.address].filter(Boolean).join(" ") || "暂未维护仓库地址"}</p>
      <footer><span>{warehouse.contactName || "未设联系人"}{warehouse.contactPhone ? ` · ${warehouse.contactPhone}` : ""}</span>{canManage ? <button type="button" onClick={() => onToggle(warehouse)}><Edit3 size={14} />{warehouse.status === "active" ? "停用" : "启用"}</button> : null}</footer>
    </article>
  ))}</div>;
}

function MovementModal({ type, warehouses, products, onClose, onSaved, onError }: {
  type: MovementType;
  warehouses: DomesticWarehouse[];
  products: CatalogProduct[];
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id || "");
  const [referenceNo, setReferenceNo] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<MovementLineDraft[]>([]);
  const [saving, setSaving] = useState(false);
  useEscapeClose(onClose, saving);
  const visibleProducts = products.filter((product) => !search || `${product.sku} ${product.name} ${product.nameEn}`.toLowerCase().includes(search.toLowerCase())).slice(0, 30);

  function addProduct(product: CatalogProduct) {
    const sku = skuKey(product.sku || product.skuNo);
    if (lines.some((line) => line.sku === sku)) return;
    setLines([...lines, { productId: product.id, sku, productName: product.name || product.nameEn || sku, imageUrl: product.imageUrl || "", specification: product.specification || "", unit: product.unit || "件", quantity: 1, deltaQty: 0, unitCostCny: Number(product.directCostPrice || product.directPrice || 0) }]);
  }

  async function submit() {
    if (!warehouseId) { onError("请先选择仓库。"); return; }
    if (!lines.length) { onError("请至少选择一个产品。"); return; }
    if (type === "adjustment" && !note.trim()) { onError("库存调整必须填写原因。"); return; }
    if (lines.some((line) => type === "adjustment" ? !line.deltaQty : line.quantity <= 0)) { onError(type === "adjustment" ? "调整数量不能为 0。" : "数量必须大于 0。"); return; }
    setSaving(true);
    try {
      const result = await createDomesticInventoryMovement({ warehouseId, type, referenceNo, note, lines: lines.map((line) => ({ ...line, quantity: type === "adjustment" ? undefined : line.quantity, deltaQty: type === "adjustment" ? line.deltaQty : undefined })) }, `inventory-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await onSaved(`${movementLabel(type)}已登记，单号 ${result.movementNo}。`);
    } catch (requestError) {
      onError(requestError instanceof Error ? requestError.message : "库存流水登记失败。");
    } finally {
      setSaving(false);
    }
  }

  return <div className="domestic-modal-backdrop" role="presentation"><section className="domestic-modal wide" role="dialog" aria-modal="true" aria-label={movementLabel(type)}>
    <header><div><span>{movementIcon(type)}</span><div><p>INVENTORY MOVEMENT</p><h3>{movementLabel(type)}</h3></div></div><button type="button" aria-label={`关闭${movementLabel(type)}窗口`} onClick={onClose}><X size={20} /></button></header>
    <div className="domestic-modal-body movement-form-grid">
      <div className="movement-form-main">
        <div className="domestic-form-row"><label>仓库<select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}><option value="">请选择仓库</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label><label>关联单号<input value={referenceNo} onChange={(event) => setReferenceNo(event.target.value)} placeholder="采购单、领用单或盘点单号" /></label></div>
        <label>备注 / 原因{type === "adjustment" ? <b>*</b> : null}<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={type === "adjustment" ? "请说明盘盈、盘亏或库存修正原因" : "选填，便于后续追溯"} /></label>
        <div className="movement-line-header"><strong>产品明细</strong><span>同一个 SKU 每张单只出现一次</span></div>
        <div className="movement-line-editor">{lines.length ? lines.map((line, index) => <div key={line.sku} className="movement-line-edit">
          {line.imageUrl ? <img src={line.imageUrl} alt="" /> : <span className="image-placeholder"><Boxes size={17} /></span>}
          <div><strong>{line.productName}</strong><small>{line.sku}</small></div>
          <label>{type === "adjustment" ? "调整数（±）" : "数量"}<input type="number" step="any" value={type === "adjustment" ? line.deltaQty : line.quantity} onChange={(event) => setLines(lines.map((item, itemIndex) => itemIndex === index ? { ...item, [type === "adjustment" ? "deltaQty" : "quantity"]: Number(event.target.value) } : item))} /></label>
          {type === "inbound" ? <label>单位成本<input type="number" min="0" step="0.01" value={line.unitCostCny} onChange={(event) => setLines(lines.map((item, itemIndex) => itemIndex === index ? { ...item, unitCostCny: Number(event.target.value) } : item))} /></label> : null}
          <button type="button" onClick={() => setLines(lines.filter((item) => item.sku !== line.sku))}><X size={16} /></button>
        </div>) : <p className="movement-lines-empty">从右侧产品库选择产品</p>}</div>
      </div>
      <aside className="movement-product-picker"><label><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索 SKU / 产品名称" /></label><div>{visibleProducts.map((product) => { const selected = lines.some((line) => line.sku === skuKey(product.sku || product.skuNo)); return <button type="button" key={skuKey(product.sku || product.skuNo)} disabled={selected} onClick={() => addProduct(product)}>{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <span><Boxes size={16} /></span>}<div><strong>{product.name}</strong><small>{product.sku}</small></div>{selected ? <Check size={16} /> : <Plus size={16} />}</button>; })}</div></aside>
    </div>
    <footer><button className="domestic-inventory-secondary" type="button" onClick={onClose}>取消</button><button className="domestic-inventory-primary" type="button" disabled={saving} onClick={() => void submit()}>{saving ? "正在登记…" : `确认${movementLabel(type)}`}</button></footer>
  </section></div>;
}

type OpeningImportLine = {
  productId: string;
  sku: string;
  productName: string;
  imageUrl: string;
  specification: string;
  unit: string;
  quantity: number;
  safetyStockQty: number;
  unitCostCny: number;
};

function OpeningImportModal({ warehouses, products, onClose, onSaved, onError }: {
  warehouses: DomesticWarehouse[];
  products: CatalogProduct[];
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id || "");
  const [fileName, setFileName] = useState("");
  const [lines, setLines] = useState<OpeningImportLine[]>([]);
  const [localError, setLocalError] = useState("");
  const [saving, setSaving] = useState(false);
  const productsBySku = useMemo(() => new Map(products.map((product) => [skuKey(product.sku || product.skuNo), product])), [products]);
  useEscapeClose(onClose, saving);

  async function readFile(file?: File) {
    if (!file) return;
    setFileName(file.name);
    setLines([]);
    setLocalError("");
    try {
      const matrix = parseCsv((await file.text()).replace(/^\uFEFF/, ""));
      if (matrix.length < 2) throw new Error("CSV 中没有可导入的数据行。");
      const normalizeHeader = (value: string) => value.replace(/^\uFEFF/, "").replace(/[\s_\-()（）]/g, "").toLowerCase();
      const headers = matrix[0].map(normalizeHeader);
      const findColumn = (...names: string[]) => names.map(normalizeHeader).map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1;
      const skuColumn = findColumn("SKU", "产品SKU", "商品SKU");
      const quantityColumn = findColumn("期初数量", "库存数量", "在库数量", "数量", "quantity");
      const safetyColumn = findColumn("安全库存", "安全库存数量", "safetystock");
      const costColumn = findColumn("人民币单位成本", "单位成本", "成本", "unitcostcny");
      if (skuColumn < 0 || quantityColumn < 0) throw new Error("CSV 必须包含“SKU”和“期初数量”两列。");
      const next: OpeningImportLine[] = [];
      const unknown: string[] = [];
      const seen = new Set<string>();
      matrix.slice(1).forEach((row, index) => {
        const sku = skuKey(row[skuColumn]);
        if (!sku) return;
        if (seen.has(sku)) throw new Error(`第 ${index + 2} 行 SKU ${sku} 重复。`);
        seen.add(sku);
        const product = productsBySku.get(sku);
        if (!product) { unknown.push(sku); return; }
        const quantity = Number(String(row[quantityColumn] || "").replace(/,/g, ""));
        const safetyStockQty = safetyColumn >= 0 && row[safetyColumn] !== "" ? Number(String(row[safetyColumn]).replace(/,/g, "")) : 0;
        const unitCostCny = costColumn >= 0 && row[costColumn] !== "" ? Number(String(row[costColumn]).replace(/,/g, "")) : Number(product.directCostPrice || product.directPrice || 0);
        if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`第 ${index + 2} 行 ${sku} 的期初数量必须大于 0。`);
        if (!Number.isFinite(safetyStockQty) || safetyStockQty < 0) throw new Error(`第 ${index + 2} 行 ${sku} 的安全库存不能小于 0。`);
        if (!Number.isFinite(unitCostCny) || unitCostCny < 0) throw new Error(`第 ${index + 2} 行 ${sku} 的单位成本无效。`);
        next.push({ productId: product.id, sku, productName: product.name || product.nameEn || sku, imageUrl: product.imageUrl || "", specification: product.specification || "", unit: product.unit || "件", quantity, safetyStockQty, unitCostCny });
      });
      if (unknown.length) throw new Error(`以下 SKU 不在产品库中：${unknown.slice(0, 8).join("、")}${unknown.length > 8 ? ` 等 ${unknown.length} 个` : ""}。请先维护产品资料。`);
      if (!next.length) throw new Error("CSV 中没有可导入的有效 SKU。");
      if (next.length > 2000) throw new Error("单次最多导入 2000 个 SKU，请拆分文件。");
      setLines(next);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "CSV 解析失败。");
    }
  }

  async function submit() {
    if (!warehouseId) { setLocalError("请先选择要建立期初库存的仓库。"); return; }
    if (!lines.length) { setLocalError("请先选择并校验 CSV 文件。"); return; }
    setSaving(true);
    setLocalError("");
    try {
      const result = await importDomesticOpeningInventory({ warehouseId, note: `期初库存导入：${fileName}`, lines }, `opening-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      onSaved(`已导入 ${lines.length} 个 SKU，期初单号 ${result.movementNo}。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "期初库存导入失败。";
      setLocalError(message);
      onError(message);
    } finally {
      setSaving(false);
    }
  }

  return <div className="domestic-modal-backdrop" role="presentation"><section className="domestic-modal opening-import-modal" role="dialog" aria-modal="true" aria-labelledby="opening-import-title">
    <header><div><span><FileUp size={20} /></span><div><p>OPENING INVENTORY</p><h3 id="opening-import-title">批量导入期初库存</h3></div></div><button type="button" aria-label="关闭期初库存导入窗口" onClick={onClose}><X size={20} /></button></header>
    <div className="domestic-modal-body opening-import-body">
      <div className="opening-import-guide"><strong>导入规则</strong><span>同一仓库中已有库存的 SKU 不会被覆盖；文件任一行有误时整批都不会写入。</span><button type="button" onClick={downloadOpeningTemplate}><FileDown size={16} />下载 CSV 模板</button></div>
      <label>目标仓库<select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}><option value="">请选择启用仓库</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}（{warehouse.code}）</option>)}</select></label>
      <label className="opening-file-picker"><FileUp size={24} /><strong>{fileName || "选择填写好的 CSV 文件"}</strong><span>必填列：SKU、期初数量；可选列：安全库存、人民币单位成本</span><input type="file" accept=".csv,text/csv,text/plain" hidden onChange={(event) => void readFile(event.target.files?.[0])} /></label>
      {localError ? <div className="domestic-inventory-notice error"><AlertTriangle size={16} />{localError}</div> : null}
      {lines.length ? <div className="opening-preview"><header><strong>校验通过</strong><span>{lines.length} 个唯一 SKU，确认后一次性写入</span></header><div>{lines.slice(0, 8).map((line) => <p key={line.sku}><b>{line.sku}</b><span>{line.productName}</span><em>{numberText(line.quantity)} {line.unit}</em><small>安全库存 {numberText(line.safetyStockQty)}</small></p>)}</div>{lines.length > 8 ? <footer>另有 {lines.length - 8} 个 SKU 未在预览中展开</footer> : null}</div> : null}
    </div>
    <footer><button className="domestic-inventory-secondary" type="button" onClick={onClose}>取消</button><button className="domestic-inventory-primary" type="button" disabled={saving || !lines.length || !warehouseId} onClick={() => void submit()}>{saving ? "正在导入…" : `确认导入 ${lines.length || ""} 个 SKU`}</button></footer>
  </section></div>;
}

function WarehouseModal({ onClose, onSaved, onError }: { onClose: () => void; onSaved: (name: string) => void; onError: (message: string) => void }) {
  const [form, setForm] = useState({ code: "", name: "", province: "", city: "", address: "", contactName: "", contactPhone: "", note: "" });
  const [saving, setSaving] = useState(false);
  useEscapeClose(onClose, saving);
  async function submit() {
    if (!form.code.trim() || !form.name.trim()) { onError("请填写仓库编码和仓库名称。"); return; }
    setSaving(true);
    try { const result = await createDomesticWarehouse(form); await onSaved(result.warehouse.name); }
    catch (requestError) { onError(requestError instanceof Error ? requestError.message : "仓库创建失败。"); }
    finally { setSaving(false); }
  }
  return <div className="domestic-modal-backdrop"><section className="domestic-modal" role="dialog" aria-modal="true" aria-label="新建国内仓库"><header><div><span><Warehouse size={20} /></span><div><p>WAREHOUSE MASTER</p><h3>新建国内仓库</h3></div></div><button type="button" aria-label="关闭新建仓库窗口" onClick={onClose}><X size={20} /></button></header><div className="domestic-modal-body domestic-warehouse-form"><div className="domestic-form-row"><label>仓库编码 *<input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="例如 CN-GZ-01" /></label><label>仓库名称 *<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如 广州成品仓" /></label></div><div className="domestic-form-row"><label>省份<input value={form.province} onChange={(event) => setForm({ ...form, province: event.target.value })} /></label><label>城市<input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /></label></div><label>详细地址<input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label><div className="domestic-form-row"><label>联系人<input value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} /></label><label>联系电话<input value={form.contactPhone} onChange={(event) => setForm({ ...form, contactPhone: event.target.value })} /></label></div><label>备注<textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label></div><footer><button className="domestic-inventory-secondary" onClick={onClose}>取消</button><button className="domestic-inventory-primary" disabled={saving} onClick={() => void submit()}>{saving ? "正在创建…" : "创建仓库"}</button></footer></section></div>;
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="domestic-empty"><ClipboardList size={34} /><strong>{title}</strong><p>{description}</p></div>;
}
