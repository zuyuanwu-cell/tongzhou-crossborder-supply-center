import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowRightLeft,
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
  Printer,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Warehouse,
  X,
} from "lucide-react";
import {
  type CatalogProduct,
  type DomesticInventoryBalance,
  type DomesticInventoryLot,
  type DomesticInventoryMovement,
  type DomesticInventoryPayload,
  type DomesticInventoryProductOption,
  type DomesticInventoryTransfer,
  type DomesticWarehouse,
  cancelDomesticInventoryTransfer,
  createDomesticInventoryMovement,
  createDomesticInventoryTransfer,
  createDomesticWarehouse,
  fetchDomesticInventory,
  fetchDomesticInventoryLots,
  fetchDomesticInventoryMovement,
  fetchDomesticInventoryMovements,
  fetchDomesticInventoryProducts,
  fetchDomesticInventoryTransfer,
  fetchDomesticInventoryTransfers,
  fetchDomesticInventoryTransferTargets,
  importDomesticOpeningInventory,
  receiveDomesticInventoryTransfer,
  splitDomesticInventoryLot,
  updateDomesticInventorySafetyStock,
  updateDomesticInventoryLot,
  updateDomesticWarehouse,
} from "../api";
import { printInventoryMovement, printInventoryTransfer } from "./inventory-print";
import "./domestic-inventory.css";

type ViewTab = "inventory" | "lots" | "movements" | "transfers" | "warehouses";
type MovementType = "inbound" | "outbound" | "adjustment";

type SelectableProduct = {
  id: string;
  sku?: string;
  skuNo?: string;
  name?: string;
  nameEn?: string;
  imageUrl?: string;
  specification?: string;
  unit?: string;
  barcode?: string;
  brand?: string;
  category?: string;
  directCostPrice?: number;
  directPrice?: number;
  availableQty?: number;
};

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
  packagingMode: "piece" | "carton";
  cartonCount: number;
  unitsPerCarton: number;
  looseQuantity: number;
  cartonLengthCm: number;
  cartonWidthCm: number;
  cartonHeightCm: number;
  cartonWeightKg: number;
  lotNo: string;
  barcode: string;
  productionDate: string;
  expiryDate: string;
  availableQty?: number;
};

type Props = {
  products: CatalogProduct[];
  canManage: boolean;
  canReceive: boolean;
  canIssue: boolean;
  canTransfer: boolean;
  canAdjust: boolean;
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

function uniqueProducts(products: SelectableProduct[]) {
  const output = new Map<string, SelectableProduct>();
  for (const product of products) {
    const key = skuKey(product.sku || product.skuNo);
    if (!key) continue;
    const current = output.get(key);
    if (!current || (!current.imageUrl && product.imageUrl)) output.set(key, product);
  }
  return [...output.values()].sort((a, b) => skuKey(a.sku).localeCompare(skuKey(b.sku)));
}

function inventoryBalanceProduct(balance: DomesticInventoryBalance): SelectableProduct {
  return {
    id: balance.productId || `inventory:${balance.warehouseId}:${balance.sku}`,
    sku: balance.sku,
    skuNo: balance.sku,
    name: balance.productName || balance.sku,
    imageUrl: balance.imageUrl,
    specification: balance.specification,
    unit: balance.unit || "件",
    availableQty: balance.availableQty,
  };
}

function movementLabel(type: DomesticInventoryMovement["type"]) {
  return { opening: "期初库存", inbound: "采购入库", outbound: "领用 / 出库", adjustment: "库存调整", transfer_out: "调拨出库", transfer_in: "调拨入库", transfer_cancel: "调拨取消" }[type];
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

export function DomesticInventoryCenter({ products, canManage, canReceive, canIssue, canTransfer, canAdjust }: Props) {
  const [payload, setPayload] = useState<DomesticInventoryPayload>(emptyPayload);
  const [movements, setMovements] = useState<DomesticInventoryMovement[]>([]);
  const [lots, setLots] = useState<DomesticInventoryLot[]>([]);
  const [transfers, setTransfers] = useState<DomesticInventoryTransfer[]>([]);
  const [transferSummary, setTransferSummary] = useState({ inTransit: 0, received: 0, cancelled: 0 });
  const [tab, setTab] = useState<ViewTab>("inventory");
  const [warehouseId, setWarehouseId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [query, setQuery] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [movementModal, setMovementModal] = useState<MovementType | null>(null);
  const [transferModal, setTransferModal] = useState(false);
  const [focusedTransferId, setFocusedTransferId] = useState("");
  const [focusedMovementId, setFocusedMovementId] = useState("");
  const [transferStatus, setTransferStatus] = useState("");
  const [transferBusy, setTransferBusy] = useState("");
  const [warehouseModal, setWarehouseModal] = useState(false);
  const [openingImportModal, setOpeningImportModal] = useState(false);
  const [editingLot, setEditingLot] = useState<DomesticInventoryLot | null>(null);
  const [incompleteLotsOnly, setIncompleteLotsOnly] = useState(false);
  const [safetyDrafts, setSafetyDrafts] = useState<Record<string, string>>({});
  const [inventoryProducts, setInventoryProducts] = useState<DomesticInventoryProductOption[]>([]);
  const [productCatalogLoading, setProductCatalogLoading] = useState(true);
  const [productCatalogError, setProductCatalogError] = useState("");

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

  const loadLots = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchDomesticInventoryLots({ warehouseId, keyword: query, incompleteOnly: incompleteLotsOnly, limit: 300 });
      setLots(data.lots);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "库存批次读取失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, [warehouseId, query, incompleteLotsOnly]);

  const loadTransfers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchDomesticInventoryTransfers({ warehouseId, keyword: query, status: transferStatus });
      setTransfers(data.transfers);
      setTransferSummary(data.summary);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "库存调拨单读取失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, [warehouseId, query, transferStatus]);

  useEffect(() => { void loadInventory(); }, [loadInventory]);
  useEffect(() => { if (tab === "movements") void loadMovements(); }, [tab, loadMovements]);
  useEffect(() => { if (tab === "lots") void loadLots(); }, [tab, loadLots]);
  useEffect(() => { if (tab === "transfers") void loadTransfers(); }, [tab, loadTransfers]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const kind = params.get("inventoryDocument");
    const documentId = params.get("inventoryDocumentId") || "";
    if (!documentId) return;
    if (kind === "transfer") {
      setTab("transfers");
      setFocusedTransferId(documentId);
      fetchDomesticInventoryTransfer(documentId)
        .then((result) => setTransfers((current) => [result.transfer, ...current.filter((item) => item.id !== result.transfer.id)]))
        .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "扫码调拨单读取失败。"));
    } else if (kind === "movement") {
      setTab("movements");
      setFocusedMovementId(documentId);
      fetchDomesticInventoryMovement(documentId)
        .then((result) => setMovements((current) => [result.movement, ...current.filter((item) => item.id !== result.movement.id)]))
        .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "扫码库存单据读取失败。"));
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    setProductCatalogLoading(true);
    setProductCatalogError("");
    fetchDomesticInventoryProducts({ limit: 10000 })
      .then((data) => {
        if (!cancelled) setInventoryProducts(data.products);
      })
      .catch((requestError) => {
        if (!cancelled) setProductCatalogError(requestError instanceof Error ? requestError.message : "完整产品列表读取失败，请稍后重试。");
      })
      .finally(() => {
        if (!cancelled) setProductCatalogLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const activeWarehouses = useMemo(() => payload.warehouses.filter((item) => item.status === "active"), [payload.warehouses]);
  const productOptions = useMemo(() => uniqueProducts([...products, ...inventoryProducts]), [products, inventoryProducts]);
  const ledgerSkuCount = Number((payload.summary as typeof payload.summary & { ledgerSkuCount?: number }).ledgerSkuCount ?? payload.balances.length);

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

  async function receiveTransfer(transfer: DomesticInventoryTransfer) {
    if (!window.confirm(`确认 ${transfer.transferNo} 的货物已经到达 ${transfer.targetWarehouseName}，并正式计入库存吗？`)) return;
    setTransferBusy(transfer.id);
    setError("");
    try {
      await receiveDomesticInventoryTransfer(transfer.id);
      setSuccess(`${transfer.transferNo} 已确认收货，库存已进入 ${transfer.targetWarehouseName}。`);
      await Promise.all([loadTransfers(), loadInventory()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "调拨收货失败。");
    } finally {
      setTransferBusy("");
    }
  }

  async function cancelTransfer(transfer: DomesticInventoryTransfer) {
    if (!window.confirm(`确认取消 ${transfer.transferNo}？取消后库存将按原批次恢复到 ${transfer.sourceWarehouseName}。`)) return;
    setTransferBusy(transfer.id);
    setError("");
    try {
      await cancelDomesticInventoryTransfer(transfer.id);
      setSuccess(`${transfer.transferNo} 已取消，原批次库存已恢复。`);
      await Promise.all([loadTransfers(), loadInventory()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "调拨取消失败。");
    } finally {
      setTransferBusy("");
    }
  }

  async function printTransfer(transfer: DomesticInventoryTransfer) {
    try { await printInventoryTransfer(transfer); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "调拨单打印模板生成失败。"); }
  }

  async function printMovement(movement: DomesticInventoryMovement) {
    try { await printInventoryMovement(movement); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "库存单据打印模板生成失败。"); }
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

      {canManage && (!payload.warehouses.length || !ledgerSkuCount) ? <section className="domestic-onboarding">
        <header><div><span>FIRST USE</span><h3>三步建立国内仓库存台账</h3><p>先建仓，再一次性导入期初库存；之后所有入库、出库和调整都会形成可追溯流水。</p></div><FileUp size={28} /></header>
        <div>
          <article className={!payload.warehouses.length ? "current" : "done"}><b>01</b><span><strong>建立仓库档案</strong><small>维护仓库编码、名称和联系人</small></span>{!payload.warehouses.length ? <button type="button" onClick={() => { setTab("warehouses"); setWarehouseModal(true); }}>新建仓库</button> : <Check size={18} />}</article>
          <article className={payload.warehouses.length && !ledgerSkuCount ? "current" : ledgerSkuCount ? "done" : ""}><b>02</b><span><strong>导入期初库存</strong><small>下载模板后批量导入 SKU、数量和安全库存</small></span>{payload.warehouses.length && !ledgerSkuCount ? <button type="button" disabled={!activeWarehouses.length} onClick={() => setOpeningImportModal(true)}>导入期初</button> : ledgerSkuCount ? <Check size={18} /> : null}</article>
          <article className={ledgerSkuCount ? "current" : ""}><b>03</b><span><strong>维护安全库存</strong><small>在库存台账直接设置补货预警线</small></span></article>
        </div>
      </section> : null}

      <section className="domestic-inventory-metrics">
        <article><span>启用仓库</span><strong>{payload.summary.warehouses}</strong><small>国内成品仓</small></article>
        <article><span>在库 SKU</span><strong>{numberText(payload.summary.skuCount)}</strong><small>当前在库数量大于 0</small></article>
        <article><span>在库数量</span><strong>{numberText(payload.summary.onHandQty)}</strong><small>可用 {numberText(payload.summary.availableQty)}</small></article>
        <article className={payload.summary.lowStockSkuCount ? "warning" : ""}><span>低库存</span><strong>{numberText(payload.summary.lowStockSkuCount)}</strong><small>低于安全库存</small></article>
      </section>

      <section className="domestic-inventory-workspace">
        <div className="domestic-inventory-tabs">
          <button className={tab === "inventory" ? "active" : ""} onClick={() => setTab("inventory")}><Boxes size={17} />库存台账</button>
          <button className={tab === "lots" ? "active" : ""} onClick={() => setTab("lots")}><ClipboardList size={17} />批次与箱规</button>
          <button className={tab === "movements" ? "active" : ""} onClick={() => setTab("movements")}><History size={17} />进销存流水</button>
          {canTransfer || canManage ? <button className={tab === "transfers" ? "active" : ""} onClick={() => setTab("transfers")}><ArrowRightLeft size={17} />库存调拨{transferSummary.inTransit ? <em className="transfer-tab-count">{transferSummary.inTransit}</em> : null}</button> : null}
          <button className={tab === "warehouses" ? "active" : ""} onClick={() => setTab("warehouses")}><Warehouse size={17} />仓库档案</button>
          <span className="domestic-inventory-updated">更新 {dateTime(payload.updatedAt)}</span>
        </div>

        <div className="domestic-inventory-toolbar">
          <label className="domestic-inventory-search"><Search size={17} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") runSearch(); }} placeholder={tab === "transfers" ? "搜索调拨单号、SKU、产品或仓库" : tab === "movements" ? "搜索单号、关联单号、SKU 或产品" : tab === "lots" ? "搜索 SKU、产品、批次号、条码或入库单" : "搜索 SKU、产品或仓库"} /></label>
          <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} aria-label="选择国内仓库">
            <option value="">全部国内仓库</option>
            {payload.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}{warehouse.status === "inactive" ? "（已停用）" : ""}</option>)}
          </select>
          {tab === "transfers" ? <select value={transferStatus} onChange={(event) => setTransferStatus(event.target.value)} aria-label="筛选调拨状态"><option value="">全部调拨状态</option><option value="in_transit">调拨在途</option><option value="received">已收货</option><option value="cancelled">已取消</option></select> : null}
          {tab === "inventory" ? <label className="domestic-inventory-check"><input type="checkbox" checked={lowStockOnly} onChange={(event) => setLowStockOnly(event.target.checked)} />只看低库存</label> : null}
          {tab === "lots" ? <label className="domestic-inventory-check"><input type="checkbox" checked={incompleteLotsOnly} onChange={(event) => setIncompleteLotsOnly(event.target.checked)} />只看资料待补</label> : null}
          <button className="domestic-inventory-secondary" type="button" onClick={runSearch}><Search size={16} />查询</button>
          <button className="domestic-inventory-secondary icon-only" type="button" aria-label="刷新" onClick={() => void (tab === "transfers" ? loadTransfers() : tab === "movements" ? loadMovements() : tab === "lots" ? loadLots() : loadInventory())}><RefreshCw className={loading ? "spinning" : ""} size={17} /></button>
          {(canManage || canReceive || canIssue || canTransfer || canAdjust) && tab !== "warehouses" ? (
            <div className="domestic-inventory-actions">
              {canManage ? <button type="button" disabled={!activeWarehouses.length} title={activeWarehouses.length ? "批量导入期初库存" : "请先创建并启用国内仓库"} onClick={() => setOpeningImportModal(true)}><FileUp size={17} />期初导入</button> : null}
              {canReceive || canManage ? <button type="button" disabled={!activeWarehouses.length} title={activeWarehouses.length ? "登记采购入库" : "请先创建并启用国内仓库"} onClick={() => setMovementModal("inbound")}><PackagePlus size={17} />入库</button> : null}
              {canIssue || canManage ? <button type="button" disabled={!activeWarehouses.length} title={activeWarehouses.length ? "登记领用或出库" : "请先创建并启用国内仓库"} onClick={() => setMovementModal("outbound")}><ArrowUpFromLine size={17} />出库</button> : null}
              {canTransfer || canManage ? <button type="button" disabled={activeWarehouses.length < 1} title="发起两段式仓间调拨" onClick={() => setTransferModal(true)}><ArrowRightLeft size={17} />调拨</button> : null}
              {canAdjust || canManage ? <button type="button" disabled={!activeWarehouses.length} title={activeWarehouses.length ? "登记库存调整" : "请先创建并启用国内仓库"} onClick={() => setMovementModal("adjustment")}><SlidersHorizontal size={17} />调整</button> : null}
            </div>
          ) : null}
          {canManage && tab === "warehouses" ? <button className="domestic-inventory-primary" type="button" onClick={() => setWarehouseModal(true)}><Plus size={17} />新建仓库</button> : null}
        </div>

        {tab === "inventory" ? (
          <InventoryTable payload={payload} loading={loading} canManage={canManage} safetyDrafts={safetyDrafts} setSafetyDrafts={setSafetyDrafts} onSaveSafety={saveSafetyStock} />
        ) : tab === "lots" ? (
          <LotTable lots={lots} loading={loading} canEdit={canReceive || canManage} onEdit={setEditingLot} />
        ) : tab === "movements" ? (
          <MovementTable movements={movements} loading={loading} focusedId={focusedMovementId} onPrint={(movement) => void printMovement(movement)} />
        ) : tab === "transfers" ? (
          <TransferList transfers={transfers} loading={loading} focusedId={focusedTransferId} busyId={transferBusy} canOperate={canTransfer || canManage} warehouseIds={payload.warehouses.map((item) => item.id)} onReceive={(transfer) => void receiveTransfer(transfer)} onCancel={(transfer) => void cancelTransfer(transfer)} onPrint={(transfer) => void printTransfer(transfer)} />
        ) : (
          <WarehouseCards warehouses={payload.warehouses} canManage={canManage} onToggle={toggleWarehouse} />
        )}
      </section>

      {movementModal ? (
        <MovementModal
          type={movementModal}
          warehouses={activeWarehouses}
          products={productOptions}
          productsLoading={productCatalogLoading}
          productLoadError={productCatalogError}
          onClose={() => setMovementModal(null)}
          onSaved={async (message) => { setMovementModal(null); setSuccess(message); await loadInventory(); if (tab === "movements") await loadMovements(); }}
          onError={setError}
        />
      ) : null}
      {openingImportModal ? <OpeningImportModal warehouses={activeWarehouses} products={productOptions} onClose={() => setOpeningImportModal(false)} onSaved={async (message) => { setOpeningImportModal(false); setSuccess(message); setTab("inventory"); await loadInventory(); }} onError={setError} /> : null}
      {transferModal ? <TransferModal warehouses={activeWarehouses} onClose={() => setTransferModal(false)} onSaved={async (transfer) => { setTransferModal(false); setSuccess(`${transfer.transferNo} 已发出，当前为调拨在途。`); setTab("transfers"); setFocusedTransferId(transfer.id); await Promise.all([loadTransfers(), loadInventory()]); }} onError={setError} /> : null}
      {editingLot ? <LotSupplementModal lot={editingLot} onClose={() => setEditingLot(null)} onSaved={async (message) => { setEditingLot(null); setSuccess(message); await loadLots(); }} onError={setError} /> : null}
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
  if (!loading && !payload.balances.length) return <EmptyState title="当前没有在库商品" description="入库后将在这里展示；库存为 0 的商品已自动隐藏。" />;
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

function TransferList({ transfers, loading, focusedId, busyId, canOperate, warehouseIds, onReceive, onCancel, onPrint }: {
  transfers: DomesticInventoryTransfer[];
  loading: boolean;
  focusedId: string;
  busyId: string;
  canOperate: boolean;
  warehouseIds: string[];
  onReceive: (transfer: DomesticInventoryTransfer) => void;
  onCancel: (transfer: DomesticInventoryTransfer) => void;
  onPrint: (transfer: DomesticInventoryTransfer) => void;
}) {
  if (!loading && !transfers.length) return <EmptyState title="还没有库存调拨单" description="点击右上角“调拨”，选择调出仓、调入仓和产品后即可发起。" />;
  const visibleWarehouses = new Set(warehouseIds);
  const statusText = { in_transit: "调拨在途", received: "已确认收货", cancelled: "已取消" };
  return <div className="domestic-transfer-list">
    {transfers.map((transfer) => {
      const canReceiveThis = canOperate && visibleWarehouses.has(transfer.targetWarehouseId);
      const canCancelThis = canOperate && visibleWarehouses.has(transfer.sourceWarehouseId);
      return <details key={transfer.id} open={focusedId === transfer.id} className={`domestic-transfer-card ${focusedId === transfer.id ? "focused" : ""}`}>
        <summary><span className="transfer-route-icon"><ArrowRightLeft size={18} /></span><span><strong>{transfer.transferNo}</strong><small>{dateTime(transfer.shippedAt)} · {transfer.createdByName}</small></span><span className="transfer-route"><b>{transfer.sourceWarehouseName}</b><ArrowRightLeft size={14} /><b>{transfer.targetWarehouseName}</b></span><span><strong>{transfer.skuCount} 个 SKU / {numberText(transfer.totalQuantity)} 件</strong><small>{transfer.note || "无备注"}</small></span><em className={`transfer-status ${transfer.status}`}>{statusText[transfer.status]}</em></summary>
        <div className="transfer-card-body">
          <div className="transfer-lines"><header><span>产品</span><span>批次与箱规</span><span>调拨数量</span></header>{transfer.lines.map((line) => <article key={line.id}><div className="domestic-product-cell">{line.imageUrl ? <img src={line.imageUrl} alt="" /> : <span><Boxes size={18} /></span>}<div><strong>{line.productName}</strong><small>{line.sku}{line.specification ? ` · ${line.specification}` : ""}</small></div></div><div>{line.allocations.length ? line.allocations.map((allocation) => <p key={allocation.id}><b>{allocation.lotNo || "未追溯批次"}</b><small>{numberText(allocation.quantity)} {line.unit}{allocation.packagingMode === "carton" && allocation.unitsPerCarton ? ` · ${numberText(allocation.unitsPerCarton)}件/箱` : ""}</small></p>) : <span className="muted">未追溯批次</span>}</div><strong className="number-cell">{numberText(line.quantity)} {line.unit}</strong></article>)}</div>
          <footer><div><span>发出：{dateTime(transfer.shippedAt)}</span>{transfer.receivedAt ? <span>收货：{dateTime(transfer.receivedAt)} · {transfer.receivedByName}</span> : null}{transfer.cancelledAt ? <span>取消：{dateTime(transfer.cancelledAt)} · {transfer.cancelledByName}</span> : null}</div><div className="transfer-actions"><button type="button" onClick={() => onPrint(transfer)}><Printer size={15} />打印 / PDF</button>{transfer.status === "in_transit" && canCancelThis ? <button type="button" className="danger" disabled={busyId === transfer.id} onClick={() => onCancel(transfer)}>取消调拨</button> : null}{transfer.status === "in_transit" && canReceiveThis ? <button type="button" className="primary" disabled={busyId === transfer.id} onClick={() => onReceive(transfer)}>{busyId === transfer.id ? "正在处理…" : "确认收货入库"}</button> : null}</div></footer>
        </div>
      </details>;
    })}
    {loading ? <div className="domestic-loading">正在读取库存调拨单…</div> : null}
  </div>;
}

type TransferDraftLine = { sku: string; productName: string; imageUrl: string; unit: string; availableQty: number; quantity: number };

function TransferModal({ warehouses, onClose, onSaved, onError }: {
  warehouses: DomesticWarehouse[];
  onClose: () => void;
  onSaved: (transfer: DomesticInventoryTransfer) => void;
  onError: (message: string) => void;
}) {
  const [sourceWarehouseId, setSourceWarehouseId] = useState(warehouses[0]?.id || "");
  const [targetWarehouseId, setTargetWarehouseId] = useState("");
  const [targets, setTargets] = useState<DomesticWarehouse[]>([]);
  const [inventoryBalances, setInventoryBalances] = useState<DomesticInventoryBalance[]>([]);
  const [lines, setLines] = useState<TransferDraftLine[]>([]);
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState("");
  useEscapeClose(onClose, saving);

  useEffect(() => {
    if (!sourceWarehouseId) { setTargets([]); setInventoryBalances([]); setTargetWarehouseId(""); return; }
    let cancelled = false;
    setLoadingTargets(true);
    Promise.all([
      fetchDomesticInventoryTransferTargets(sourceWarehouseId),
      fetchDomesticInventory({ warehouseId: sourceWarehouseId }),
    ])
      .then(([result, inventory]) => {
        if (cancelled) return;
        setTargets(result.warehouses);
        setInventoryBalances(inventory.balances);
        setTargetWarehouseId((current) => result.warehouses.some((item) => item.id === current) ? current : result.warehouses[0]?.id || "");
      })
      .catch((requestError) => {
        if (cancelled) return;
        setTargets([]);
        setInventoryBalances([]);
        setLocalError(requestError instanceof Error ? requestError.message : "调拨仓库及库存读取失败。");
      })
      .finally(() => { if (!cancelled) setLoadingTargets(false); });
    return () => { cancelled = true; };
  }, [sourceWarehouseId]);

  useEffect(() => { setLines([]); }, [sourceWarehouseId]);
  const sourceBalances = inventoryBalances.filter((item) => item.availableQty > 0 && (!search || `${item.sku} ${item.productName}`.toLowerCase().includes(search.toLowerCase())));

  function addLine(balance: DomesticInventoryBalance) {
    if (lines.some((item) => item.sku === balance.sku)) return;
    setLines([...lines, { sku: balance.sku, productName: balance.productName, imageUrl: balance.imageUrl, unit: balance.unit, availableQty: balance.availableQty, quantity: 1 }]);
  }

  async function submit() {
    if (!sourceWarehouseId || !targetWarehouseId) { setLocalError("请选择调出仓和调入仓。"); return; }
    if (!lines.length) { setLocalError("请至少添加一个调拨产品。"); return; }
    if (lines.some((line) => line.quantity <= 0 || line.quantity > line.availableQty)) { setLocalError("调拨数量必须大于 0 且不能超过可用库存。"); return; }
    setSaving(true);
    setLocalError("");
    onError("");
    try {
      const result = await createDomesticInventoryTransfer({ sourceWarehouseId, targetWarehouseId, note, lines: lines.map((line) => ({ sku: line.sku, quantity: line.quantity })) }, `transfer-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await onSaved(result.transfer);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "库存调拨发起失败。";
      setLocalError(message);
      onError(message);
    } finally {
      setSaving(false);
    }
  }

  return <div className="domestic-modal-backdrop"><section className="domestic-modal wide transfer-modal" role="dialog" aria-modal="true" aria-label="发起库存调拨"><header><div><span><ArrowRightLeft size={20} /></span><div><p>WAREHOUSE TRANSFER</p><h3>发起库存调拨</h3></div></div><button type="button" aria-label="关闭调拨窗口" onClick={onClose}><X size={20} /></button></header><div className="domestic-modal-body transfer-modal-body"><section className="transfer-route-form"><label>调出仓 *<select value={sourceWarehouseId} onChange={(event) => setSourceWarehouseId(event.target.value)}><option value="">请选择调出仓</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label><ArrowRightLeft size={20} /><label>调入仓 *<select value={targetWarehouseId} disabled={loadingTargets} onChange={(event) => setTargetWarehouseId(event.target.value)}><option value="">{loadingTargets ? "正在读取…" : "请选择调入仓"}</option>{targets.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label></section><label>调拨备注<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：项目备货、仓间补货或库存调配原因" /></label>{localError ? <div className="domestic-inventory-notice error"><AlertTriangle size={16} />{localError}</div> : null}<div className="transfer-editor"><section><header><strong>调拨清单</strong><span>{lines.length} 个 SKU</span></header>{lines.length ? lines.map((line, index) => <article key={line.sku}><div className="domestic-product-cell">{line.imageUrl ? <img src={line.imageUrl} alt="" /> : <span><Boxes size={17} /></span>}<div><strong>{line.productName}</strong><small>{line.sku} · 可用 {numberText(line.availableQty)} {line.unit}</small></div></div><label>调拨数量<input type="number" min="0.01" max={line.availableQty} step="any" value={line.quantity} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: Number(event.target.value) } : item))} /></label><button type="button" aria-label="移除调拨产品" onClick={() => setLines((current) => current.filter((item) => item.sku !== line.sku))}><X size={15} /></button></article>) : <div className="movement-lines-empty">从右侧选择需要调拨的产品</div>}</section><aside className="movement-product-picker"><label><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索调出仓 SKU / 产品" /></label><p className="product-picker-status">{loadingTargets ? "正在读取调出仓可用库存…" : "仅显示调出仓当前可用库存"}</p><div>{sourceBalances.slice(0, 200).map((balance) => { const selected = lines.some((item) => item.sku === balance.sku); return <button type="button" key={balance.sku} disabled={selected} onClick={() => addLine(balance)}>{balance.imageUrl ? <img src={balance.imageUrl} alt="" /> : <span><Boxes size={16} /></span>}<div><strong>{balance.productName}</strong><small>{balance.sku} · 可用 {numberText(balance.availableQty)}</small></div>{selected ? <Check size={16} /> : <Plus size={16} />}</button>; })}{!loadingTargets && !sourceBalances.length ? <p className="product-picker-empty">该仓库没有可调拨库存</p> : null}</div></aside></div></div><footer><button className="domestic-inventory-secondary" type="button" onClick={onClose}>取消</button><button className="domestic-inventory-primary" type="button" disabled={saving || loadingTargets || !lines.length || !targetWarehouseId} onClick={() => void submit()}>{saving ? "正在发出…" : "确认发出并转为在途"}</button></footer></section></div>;
}

function LotTable({ lots, loading, canEdit, onEdit }: { lots: DomesticInventoryLot[]; loading: boolean; canEdit: boolean; onEdit: (lot: DomesticInventoryLot) => void }) {
  if (!loading && !lots.length) return <EmptyState title="还没有库存批次" description="新的入库、期初库存和盘盈会自动形成可追溯批次。" />;
  return (
    <div className="domestic-inventory-table-wrap">
      <table className="domestic-inventory-table domestic-lot-table">
        <thead><tr><th>产品 / 批次</th><th>仓库</th><th>入库单</th><th>数量</th><th>箱规</th><th>箱子尺寸 / 重量</th><th>生产信息</th><th>条码</th>{canEdit ? <th>操作</th> : null}</tr></thead>
        <tbody>{lots.map((lot) => <tr key={lot.id}>
          <td><strong>{lot.productName}</strong><small>{lot.sku}{lot.lotNo ? ` · 批次 ${lot.lotNo}` : " · 未录批次号"}</small>{lot.needsSupplement ? <em className="lot-incomplete-badge">资料待补：{lot.missingFields.join("、")}</em> : <em className="lot-complete-badge">资料完整</em>}</td>
          <td>{lot.warehouseName}</td>
          <td><strong>{lot.movementNo}</strong><small>{dateTime(lot.receivedAt)}</small></td>
          <td className="number-cell"><strong>{numberText(lot.remainingQty)}</strong> / {numberText(lot.receivedQty)}</td>
          <td>{lot.packagingMode === "carton" ? <><strong>{numberText(lot.cartonCount)} 箱</strong><small>{numberText(lot.unitsPerCarton)} 件/箱{lot.looseQuantity ? ` + ${numberText(lot.looseQuantity)} 件` : ""}</small></> : <span className="domestic-status normal">按件</span>}</td>
          <td>{lot.packagingMode === "carton" ? <><strong>{numberText(lot.cartonLengthCm)} × {numberText(lot.cartonWidthCm)} × {numberText(lot.cartonHeightCm)} cm</strong><small>{numberText(lot.cartonWeightKg)} kg/箱</small></> : "—"}</td>
          <td><strong>{lot.productionDate || "未录生产日期"}</strong><small>{lot.expiryDate ? `有效期 ${lot.expiryDate}` : "未录有效期"}</small></td>
          <td>{lot.barcode || "—"}</td>
          {canEdit ? <td><button className="lot-edit-button" type="button" onClick={() => onEdit(lot)}><Edit3 size={14} />{lot.needsSupplement ? "补录资料" : "修改资料"}</button></td> : null}
        </tr>)}</tbody>
      </table>
      {loading ? <div className="domestic-loading">正在读取库存批次…</div> : null}
    </div>
  );
}

type SplitLotDraft = { lotNo: string; barcode: string; productionDate: string; expiryDate: string; quantity: number };

function LotSupplementModal({ lot, onClose, onSaved, onError }: {
  lot: DomesticInventoryLot;
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [mode, setMode] = useState<"supplement" | "split">("supplement");
  const [lotNo, setLotNo] = useState(lot.lotNo);
  const [barcode, setBarcode] = useState(lot.barcode);
  const [productionDate, setProductionDate] = useState(lot.productionDate);
  const [expiryDate, setExpiryDate] = useState(lot.expiryDate);
  const [packagingMode, setPackagingMode] = useState<"piece" | "carton">(lot.packagingMode);
  const [unitsPerCarton, setUnitsPerCarton] = useState(lot.unitsPerCarton || 1);
  const [cartonLengthCm, setCartonLengthCm] = useState(lot.cartonLengthCm || 0);
  const [cartonWidthCm, setCartonWidthCm] = useState(lot.cartonWidthCm || 0);
  const [cartonHeightCm, setCartonHeightCm] = useState(lot.cartonHeightCm || 0);
  const [cartonWeightKg, setCartonWeightKg] = useState(lot.cartonWeightKg || 0);
  const firstQuantity = Math.max(1, Math.floor(lot.receivedQty / 2));
  const [splits, setSplits] = useState<SplitLotDraft[]>([
    { lotNo: "", barcode: "", productionDate: lot.productionDate, expiryDate: lot.expiryDate, quantity: firstQuantity },
    { lotNo: "", barcode: "", productionDate: lot.productionDate, expiryDate: lot.expiryDate, quantity: Math.max(1, lot.receivedQty - firstQuantity) },
  ]);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState("");
  const splitAllowed = Number.isInteger(lot.receivedQty) && Math.abs(lot.receivedQty - lot.remainingQty) < 0.000001 && lot.receivedQty >= 2;
  const splitTotal = splits.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  useEscapeClose(onClose, saving);

  function cartonFields(quantity: number) {
    if (packagingMode !== "carton") return { packagingMode: "piece" as const };
    const units = Number(unitsPerCarton || 0);
    const cartonCount = units > 0 ? Math.floor(quantity / units) : 0;
    const looseQuantity = units > 0 ? quantity - cartonCount * units : quantity;
    return { packagingMode: "carton" as const, unitsPerCarton: units, cartonCount, looseQuantity, cartonLengthCm, cartonWidthCm, cartonHeightCm, cartonWeightKg };
  }

  async function submit() {
    setSaving(true);
    setLocalError("");
    onError("");
    try {
      if (mode === "split") {
        const result = await splitDomesticInventoryLot(lot.id, splits.map((item) => ({ ...item, ...cartonFields(Number(item.quantity)) })));
        await onSaved(`${lot.sku} 已拆分为 ${result.lots.length} 个可追溯批次。`);
      } else {
        await updateDomesticInventoryLot(lot.id, { lotNo, barcode, productionDate, expiryDate, ...cartonFields(lot.receivedQty) });
        await onSaved(`${lot.sku} 的批次与箱规资料已补录。`);
      }
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "库存批次资料保存失败。";
      setLocalError(message);
      onError(message);
    } finally {
      setSaving(false);
    }
  }

  function updateSplit(index: number, patch: Partial<SplitLotDraft>) {
    setSplits((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  return <div className="domestic-modal-backdrop" role="presentation"><section className="domestic-modal lot-supplement-modal" role="dialog" aria-modal="true" aria-label="补录库存批次资料">
    <header><div><span><ClipboardList size={20} /></span><div><p>LOT INFORMATION</p><h3>补录批次与箱规</h3></div></div><button type="button" aria-label="关闭补录窗口" onClick={onClose}><X size={20} /></button></header>
    <div className="domestic-modal-body lot-supplement-body">
      <section className="lot-locked-summary"><div><strong>{lot.productName}</strong><small>{lot.sku} · {lot.warehouseName} · {lot.movementNo}</small></div><div><span>原入库数量（锁定）</span><strong>{numberText(lot.receivedQty)}</strong><small>当前剩余 {numberText(lot.remainingQty)}</small></div></section>
      {lot.needsSupplement ? <div className="lot-missing-tip"><AlertTriangle size={16} />当前待补：{lot.missingFields.join("、")}</div> : null}
      {localError ? <div className="lot-modal-error"><AlertTriangle size={16} />{localError}</div> : null}
      <div className="lot-mode-tabs"><button type="button" className={mode === "supplement" ? "active" : ""} onClick={() => setMode("supplement")}>补录当前批次</button><button type="button" className={mode === "split" ? "active" : ""} disabled={!splitAllowed} title={splitAllowed ? "按实际生产批次拆分" : "已发生出库或数量不足，不能拆分"} onClick={() => setMode("split")}>拆成多个批次</button></div>

      {mode === "supplement" ? <div className="lot-trace-grid">
        <label>批次号<input value={lotNo} onChange={(event) => setLotNo(event.target.value)} placeholder="例如 202609-A" /></label>
        <label>商品条码<input value={barcode} onChange={(event) => setBarcode(event.target.value)} placeholder="扫码或输入条码" /></label>
        <label>生产日期<input type="date" value={productionDate} onChange={(event) => setProductionDate(event.target.value)} /></label>
        <label>有效期<input type="date" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} /></label>
      </div> : <div className="lot-split-list">
        <header><div><strong>拆分明细</strong><small>各批次数量合计必须等于 {numberText(lot.receivedQty)}</small></div><span className={splitTotal === lot.receivedQty ? "valid" : "invalid"}>已分配 {numberText(splitTotal)} / {numberText(lot.receivedQty)}</span></header>
        {splits.map((item, index) => <article key={index}><b>{String(index + 1).padStart(2, "0")}</b><label>批次号 *<input value={item.lotNo} onChange={(event) => updateSplit(index, { lotNo: event.target.value })} /></label><label>数量 *<input type="number" min="1" step="1" value={item.quantity} onChange={(event) => updateSplit(index, { quantity: Number(event.target.value) })} /></label><label>生产日期<input type="date" value={item.productionDate} onChange={(event) => updateSplit(index, { productionDate: event.target.value })} /></label><label>有效期<input type="date" value={item.expiryDate} onChange={(event) => updateSplit(index, { expiryDate: event.target.value })} /></label><label>条码<input value={item.barcode} onChange={(event) => updateSplit(index, { barcode: event.target.value })} /></label><button type="button" aria-label="删除该拆分批次" disabled={splits.length <= 2} onClick={() => setSplits((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={15} /></button></article>)}
        <button className="lot-add-split" type="button" disabled={splits.length >= 50} onClick={() => setSplits((current) => [...current, { lotNo: "", barcode: "", productionDate: lot.productionDate, expiryDate: lot.expiryDate, quantity: 1 }])}><Plus size={15} />增加批次</button>
      </div>}

      <section className="lot-packaging-section"><header><div><strong>箱规信息</strong><small>不改变库存数量，系统按原入库数量自动计算整箱与零散件</small></div><select value={packagingMode} onChange={(event) => setPackagingMode(event.target.value === "carton" ? "carton" : "piece")}><option value="piece">暂按件管理</option><option value="carton">补录箱规</option></select></header>
        {packagingMode === "carton" ? <><div className="lot-carton-grid"><label>箱规（件/箱）*<input type="number" min="1" step="1" value={unitsPerCarton} onChange={(event) => setUnitsPerCarton(Number(event.target.value))} /></label><label>箱长 cm *<input type="number" min="0" step="0.01" value={cartonLengthCm || ""} onChange={(event) => setCartonLengthCm(Number(event.target.value))} /></label><label>箱宽 cm *<input type="number" min="0" step="0.01" value={cartonWidthCm || ""} onChange={(event) => setCartonWidthCm(Number(event.target.value))} /></label><label>箱高 cm *<input type="number" min="0" step="0.01" value={cartonHeightCm || ""} onChange={(event) => setCartonHeightCm(Number(event.target.value))} /></label><label>单箱重量 kg *<input type="number" min="0" step="0.001" value={cartonWeightKg || ""} onChange={(event) => setCartonWeightKg(Number(event.target.value))} /></label></div>{mode === "supplement" && unitsPerCarton > 0 ? <p className="lot-carton-result">自动计算：<strong>{Math.floor(lot.receivedQty / unitsPerCarton)} 箱</strong>{lot.receivedQty % unitsPerCarton ? ` + ${lot.receivedQty % unitsPerCarton} 件零散` : "，无零散件"}</p> : <p className="lot-carton-result">拆分模式下将分别按各批次数量自动计算箱数。</p>}</> : <p className="lot-piece-hint">仍按件管理，只补录批次、条码和生产日期，不填写箱规。</p>}
      </section>
    </div>
    <footer><button className="domestic-inventory-secondary" type="button" onClick={onClose}>取消</button><button className="domestic-inventory-primary" type="button" disabled={saving || (mode === "split" && splitTotal !== lot.receivedQty)} onClick={() => void submit()}>{saving ? "正在保存…" : mode === "split" ? "确认拆分批次" : "保存补录资料"}</button></footer>
  </section></div>;
}

function MovementTable({ movements, loading, focusedId, onPrint }: { movements: DomesticInventoryMovement[]; loading: boolean; focusedId: string; onPrint: (movement: DomesticInventoryMovement) => void }) {
  if (!loading && !movements.length) return <EmptyState title="还没有库存流水" description="入库、出库和调整记录会按时间沉淀在这里。" />;
  return (
    <div className="domestic-movement-list">
      {movements.map((movement) => (
        <details key={movement.id} open={focusedId === movement.id} className={`domestic-movement ${movement.type} ${focusedId === movement.id ? "focused" : ""}`}>
          <summary>
            <span className="movement-icon">{movementIcon(movement.type)}</span>
            <span><strong>{movement.movementNo}</strong><small>{movementLabel(movement.type)} · {movement.warehouseName}</small></span>
            <span><strong>{movement.lines.length} 个 SKU</strong><small>{movement.referenceNo || "无关联单号"}</small></span>
            <span><strong>{movement.createdByName}</strong><small>{dateTime(movement.occurredAt)}</small></span>
          </summary>
          <div className="movement-lines">
            {movement.note ? <p className="movement-note">备注：{movement.note}</p> : null}
            {movement.lines.map((line) => <div key={line.id}><span>{line.sku}</span><strong>{line.productName}</strong><span className={line.signedQty >= 0 ? "positive" : "negative"}>{line.signedQty >= 0 ? "+" : ""}{numberText(line.signedQty)} {line.unit}</span><small>{numberText(line.beforeQty)} → {numberText(line.afterQty)}</small></div>)}
            <button className="movement-print-button" type="button" onClick={() => onPrint(movement)}><Printer size={15} />打印 / 保存 PDF</button>
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

function MovementModal({ type, warehouses, products, productsLoading, productLoadError, onClose, onSaved, onError }: {
  type: MovementType;
  warehouses: DomesticWarehouse[];
  products: SelectableProduct[];
  productsLoading: boolean;
  productLoadError: string;
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
  const [visibleLimit, setVisibleLimit] = useState(60);
  const [warehouseProducts, setWarehouseProducts] = useState<SelectableProduct[]>([]);
  const [warehouseProductsLoading, setWarehouseProductsLoading] = useState(true);
  const [warehouseProductsError, setWarehouseProductsError] = useState("");
  useEscapeClose(onClose, saving);
  const selectableProducts = useMemo(() => type === "outbound"
    ? uniqueProducts(warehouseProducts.filter((product) => Number(product.availableQty || 0) > 0))
    : uniqueProducts([...products, ...warehouseProducts]), [products, type, warehouseProducts]);
  const matchingProducts = selectableProducts.filter((product) => !search || `${product.sku || ""} ${product.skuNo || ""} ${product.name || ""} ${product.nameEn || ""} ${product.barcode || ""}`.toLowerCase().includes(search.toLowerCase()));
  const visibleProducts = matchingProducts.slice(0, visibleLimit);
  const pickerLoading = type === "outbound" ? warehouseProductsLoading : productsLoading || warehouseProductsLoading;
  const pickerError = type === "outbound" ? warehouseProductsError : productLoadError || warehouseProductsError;

  useEffect(() => { setVisibleLimit(60); }, [search]);
  useEffect(() => {
    let cancelled = false;
    setWarehouseProducts([]);
    setWarehouseProductsError("");
    setWarehouseProductsLoading(Boolean(warehouseId));
    if (!warehouseId) return () => { cancelled = true; };
    fetchDomesticInventory({ warehouseId })
      .then((data) => {
        if (!cancelled) setWarehouseProducts(data.balances.map(inventoryBalanceProduct));
      })
      .catch((requestError) => {
        if (!cancelled) setWarehouseProductsError(requestError instanceof Error ? requestError.message : "所选仓库库存读取失败，请稍后重试。");
      })
      .finally(() => {
        if (!cancelled) setWarehouseProductsLoading(false);
      });
    return () => { cancelled = true; };
  }, [warehouseId]);

  function addProduct(product: SelectableProduct) {
    const sku = skuKey(product.sku || product.skuNo);
    if (lines.some((line) => line.sku === sku)) return;
    setLines([...lines, {
      productId: product.id, sku, productName: product.name || product.nameEn || sku, imageUrl: product.imageUrl || "", specification: product.specification || "", unit: product.unit || "件", availableQty: product.availableQty,
      quantity: 1, deltaQty: 0, unitCostCny: Number(product.directCostPrice || product.directPrice || 0), packagingMode: "piece", cartonCount: 1, unitsPerCarton: 1,
      looseQuantity: 0, cartonLengthCm: 0, cartonWidthCm: 0, cartonHeightCm: 0, cartonWeightKg: 0, lotNo: "", barcode: "", productionDate: "", expiryDate: "",
    }]);
  }

  function updateLine(index: number, patch: Partial<MovementLineDraft>) {
    setLines(lines.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const next = { ...item, ...patch };
      if (next.packagingMode === "carton") next.quantity = Number(next.cartonCount || 0) * Number(next.unitsPerCarton || 0) + Number(next.looseQuantity || 0);
      return next;
    }));
  }

  async function submit() {
    if (!warehouseId) { onError("请先选择仓库。"); return; }
    if (!lines.length) { onError("请至少选择一个产品。"); return; }
    if (type === "adjustment" && !note.trim()) { onError("库存调整必须填写原因。"); return; }
    if (lines.some((line) => type === "adjustment" ? !line.deltaQty : line.quantity <= 0)) { onError(type === "adjustment" ? "调整数量不能为 0。" : "数量必须大于 0。"); return; }
    if (type === "outbound" && lines.some((line) => line.quantity > Number(line.availableQty || 0))) { onError("出库数量不能超过所选仓库的可用库存。"); return; }
    if (type === "inbound" && lines.some((line) => line.packagingMode === "carton" && (!Number.isInteger(line.cartonCount) || line.cartonCount <= 0 || !Number.isInteger(line.unitsPerCarton) || line.unitsPerCarton <= 0 || [line.cartonLengthCm, line.cartonWidthCm, line.cartonHeightCm, line.cartonWeightKg].some((value) => value <= 0)))) {
      onError("按箱入库时，请完整填写箱数、箱规、箱子长宽高和单箱重量。"); return;
    }
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
        <div className="domestic-form-row"><label>仓库<select value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); setLines([]); }}><option value="">请选择仓库</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label><label>关联单号<input value={referenceNo} onChange={(event) => setReferenceNo(event.target.value)} placeholder="采购单、领用单或盘点单号" /></label></div>
        <label>备注 / 原因{type === "adjustment" ? <b>*</b> : null}<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={type === "adjustment" ? "请说明盘盈、盘亏或库存修正原因" : "选填，便于后续追溯"} /></label>
        <div className="movement-line-header"><strong>产品明细</strong><span>同一个 SKU 每张单只出现一次</span></div>
        <div className="movement-line-editor">{lines.length ? lines.map((line, index) => <article key={line.sku} className="movement-line-card">
          <div className="movement-line-edit">
            {line.imageUrl ? <img src={line.imageUrl} alt="" /> : <span className="image-placeholder"><Boxes size={17} /></span>}
            <div><strong>{line.productName}</strong><small>{line.sku}{type === "outbound" ? ` · 可用 ${numberText(Number(line.availableQty || 0))} ${line.unit}` : ""}</small></div>
            <label>{type === "adjustment" ? "调整数（±）" : "数量"}<input type="number" step="any" min={type === "outbound" ? 0.01 : undefined} max={type === "outbound" ? line.availableQty : undefined} readOnly={type === "inbound" && line.packagingMode === "carton"} value={type === "adjustment" ? line.deltaQty : line.quantity} onChange={(event) => updateLine(index, { [type === "adjustment" ? "deltaQty" : "quantity"]: Number(event.target.value) })} /></label>
            {type === "inbound" ? <label>单位成本<input type="number" min="0" step="0.01" value={line.unitCostCny} onChange={(event) => updateLine(index, { unitCostCny: Number(event.target.value) })} /></label> : null}
            <button type="button" onClick={() => setLines(lines.filter((item) => item.sku !== line.sku))}><X size={16} /></button>
          </div>
          {type === "inbound" ? <details className="movement-trace-fields">
            <summary>箱规与追溯信息 <small>可选；按箱入库时箱规必填</small></summary>
            <div className="movement-trace-grid">
              <label>入库方式<select value={line.packagingMode} onChange={(event) => updateLine(index, { packagingMode: event.target.value === "carton" ? "carton" : "piece" })}><option value="piece">按件入库</option><option value="carton">按箱入库</option></select></label>
              {line.packagingMode === "carton" ? <>
                <label>箱数 *<input type="number" min="1" step="1" value={line.cartonCount} onChange={(event) => updateLine(index, { cartonCount: Number(event.target.value) })} /></label>
                <label>箱规（件/箱）*<input type="number" min="1" step="1" value={line.unitsPerCarton} onChange={(event) => updateLine(index, { unitsPerCarton: Number(event.target.value) })} /></label>
                <label>零散数量<input type="number" min="0" step="1" value={line.looseQuantity} onChange={(event) => updateLine(index, { looseQuantity: Number(event.target.value) })} /></label>
                <label>箱长 cm *<input type="number" min="0" step="0.01" value={line.cartonLengthCm || ""} onChange={(event) => updateLine(index, { cartonLengthCm: Number(event.target.value) })} /></label>
                <label>箱宽 cm *<input type="number" min="0" step="0.01" value={line.cartonWidthCm || ""} onChange={(event) => updateLine(index, { cartonWidthCm: Number(event.target.value) })} /></label>
                <label>箱高 cm *<input type="number" min="0" step="0.01" value={line.cartonHeightCm || ""} onChange={(event) => updateLine(index, { cartonHeightCm: Number(event.target.value) })} /></label>
                <label>单箱重量 kg *<input type="number" min="0" step="0.001" value={line.cartonWeightKg || ""} onChange={(event) => updateLine(index, { cartonWeightKg: Number(event.target.value) })} /></label>
              </> : null}
              <label>生产批次<input value={line.lotNo} onChange={(event) => updateLine(index, { lotNo: event.target.value })} placeholder="例如 202609-A" /></label>
              <label>商品条码<input value={line.barcode} onChange={(event) => updateLine(index, { barcode: event.target.value })} placeholder="扫码或输入条码" /></label>
              <label>生产日期<input type="date" value={line.productionDate} onChange={(event) => updateLine(index, { productionDate: event.target.value })} /></label>
              <label>有效期<input type="date" value={line.expiryDate} onChange={(event) => updateLine(index, { expiryDate: event.target.value })} /></label>
            </div>
          </details> : null}
        </article>) : <p className="movement-lines-empty">从右侧产品库选择产品</p>}</div>
      </div>
      <aside className="movement-product-picker">
        <label><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索 SKU / 产品名称 / 条码" /></label>
        <p className={pickerError ? "product-picker-status error" : "product-picker-status"}>
          {pickerLoading ? <><RefreshCw className="spinning" size={13} />{type === "outbound" ? "正在读取所选仓库可用库存…" : "正在载入全部 SKU…"}</> : pickerError ? pickerError : type === "outbound" ? `按所选仓库实际库存显示，共 ${selectableProducts.length} 个可出库 SKU` : `已载入 ${selectableProducts.length} 个可选 SKU`}
        </p>
        <div>
          {visibleProducts.map((product) => {
            const selected = lines.some((line) => line.sku === skuKey(product.sku || product.skuNo));
            return <button type="button" key={skuKey(product.sku || product.skuNo)} disabled={selected} onClick={() => addProduct(product)}>{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <span><Boxes size={16} /></span>}<div><strong>{product.name || product.nameEn || product.sku}</strong><small>{product.sku || product.skuNo}{type === "outbound" ? ` · 可用 ${numberText(Number(product.availableQty || 0))} ${product.unit || "件"}` : ""}</small></div>{selected ? <Check size={16} /> : <Plus size={16} />}</button>;
          })}
          {!pickerLoading && !visibleProducts.length ? <p className="product-picker-empty">{type === "outbound" && !search ? "所选仓库当前没有可出库库存" : "没有找到匹配的 SKU"}</p> : null}
        </div>
        {visibleProducts.length < matchingProducts.length ? <button className="product-picker-more" type="button" onClick={() => setVisibleLimit((current) => current + 60)}>加载更多（剩余 {matchingProducts.length - visibleProducts.length}）</button> : null}
      </aside>
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
  products: SelectableProduct[];
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
