import React from "react";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Clock3,
  ExternalLink,
  FileCheck2,
  FileText,
  PackageSearch,
  Search,
  ShieldAlert,
  ShieldCheck,
  Warehouse,
  X,
} from "lucide-react";
import { qualificationFileDownloadUrl, type CatalogProduct, type ProductBase, type QualificationPayload, type WarehouseOnlyInventoryItem } from "./api";
import {
  buildQualificationCoverage,
  buildQualificationCoverageProducts,
  buildQualificationWarehouseOptions,
  type QualificationCoverageCell,
  type QualificationCoverageProduct,
  type QualificationCoverageStatus,
} from "./qualification-coverage";
import "./qualification-coverage.css";

type CoverageFilter = "all" | "gap" | "attention" | "risk" | "covered";

const statusMeta: Record<QualificationCoverageStatus, { label: string; short: string; note: string }> = {
  valid: { label: "资质有效", short: "有效", note: "有效期超过 90 天" },
  warning: { label: "需要关注", short: "临期", note: "31–90 天内到期" },
  urgent: { label: "紧急续证", short: "紧急", note: "30 天内到期" },
  expired: { label: "已经过期", short: "过期", note: "仅有已过期记录" },
  undated: { label: "待核验", short: "待核验", note: "有记录但未维护有效期" },
  missing: { label: "未覆盖", short: "未登记", note: "未发现本国资质记录" },
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value || 0);
}

function formatDate(value: string) {
  if (!value) return "未维护";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : value;
}

function statusIcon(status: QualificationCoverageStatus, size = 15) {
  if (status === "valid") return <CheckCircle2 size={size} />;
  if (status === "warning" || status === "urgent") return <Clock3 size={size} />;
  if (status === "expired") return <ShieldAlert size={size} />;
  if (status === "undated") return <CircleDashed size={size} />;
  return <AlertTriangle size={size} />;
}

function CellButton({ cell, onClick }: { cell: QualificationCoverageCell; onClick: () => void }) {
  const meta = statusMeta[cell.status];
  return (
    <button className={`qualification-matrix-cell status-${cell.status}`} type="button" onClick={onClick} title={`${cell.category}：${meta.label}，${meta.note}`}>
      {statusIcon(cell.status)}
      <span>{meta.short}</span>
      {cell.records.length ? <small>{cell.records.length} 项</small> : null}
    </button>
  );
}

function DetailDrawer({
  product,
  selectedCell,
  warehouseName,
  onSelectCategory,
  onClose,
}: {
  product: QualificationCoverageProduct;
  selectedCell: QualificationCoverageCell | null;
  warehouseName: string;
  onSelectCategory: (category: string) => void;
  onClose: () => void;
}) {
  const closeRef = React.useRef<HTMLButtonElement | null>(null);
  const activeCell = selectedCell || product.cells.find((cell) => cell.records.length > 0) || product.cells[0] || null;
  React.useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return (
    <div className="qualification-drawer-layer" role="presentation">
      <button type="button" className="qualification-drawer-backdrop" aria-label="关闭明细" onClick={onClose} />
      <aside className="qualification-drawer" role="dialog" aria-modal="true" aria-label={`${product.productName}资质覆盖明细`}>
        <header>
          <div className="qualification-drawer-product">
            {product.imageUrl ? <img src={product.imageUrl} alt="" /> : <span><PackageSearch size={21} /></span>}
            <div><small>{warehouseName}</small><h2>{product.productName}</h2><p>{product.sku} · 库存 {formatNumber(product.totalQty)}</p></div>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="关闭"><X size={19} /></button>
        </header>
        <section className={`qualification-drawer-verdict status-${product.status}`}>
          <i>{statusIcon(product.status, 20)}</i>
          <div><small>国家资质覆盖结论</small><strong>{statusMeta[product.status].label}</strong><p>{statusMeta[product.status].note}</p></div>
          <b>{product.coveredCategoryCount}/{product.cells.length}</b>
        </section>
        <section className="qualification-drawer-section">
          <div className="qualification-drawer-title"><div><p className="eyebrow">CERTIFICATION PATH</p><h3>认证路径</h3></div><span>点击切换查看</span></div>
          <div className="qualification-drawer-paths">
            {product.cells.map((cell) => (
              <button className={`${activeCell?.category === cell.category ? "active" : ""} status-${cell.status}`} type="button" key={cell.category} onClick={() => onSelectCategory(cell.category)}>
                {statusIcon(cell.status, 14)}<span>{cell.category}</span><b>{statusMeta[cell.status].short}</b>
              </button>
            ))}
          </div>
        </section>
        {activeCell ? (
          <section className="qualification-drawer-section qualification-record-section">
            <div className="qualification-drawer-title"><div><p className="eyebrow">RECORD DETAIL</p><h3>{activeCell.category}</h3></div><span className={`qualification-status-chip status-${activeCell.status}`}>{statusMeta[activeCell.status].label}</span></div>
            {activeCell.records.length ? (
              <div className="qualification-record-list">
                {activeCell.records.map((record) => (
                  <article key={record.id}>
                    <div><FileCheck2 size={17} /><span><strong>{record.qualificationName || activeCell.category}</strong><small>{record.issuer || "证书编号未维护"}</small></span></div>
                    <dl>
                      <div><dt>生效日期</dt><dd>{formatDate(record.effectiveDate)}</dd></div>
                      <div><dt>到期日期</dt><dd>{formatDate(record.expiryDate)}</dd></div>
                    </dl>
                    <div className="qualification-record-files">
                      {record.files.length ? record.files.map((file) => {
                        const href = file.url || (file.fileId ? qualificationFileDownloadUrl(file.fileId, file.name) : "");
                        return href ? <a key={file.id} href={href} target="_blank" rel="noreferrer"><FileText size={14} />{file.name}<ExternalLink size={12} /></a> : null;
                      }) : <span>暂无证书附件</span>}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="qualification-missing-detail">
                <CircleDashed size={28} />
                <strong>未登记“{activeCell.category}”</strong>
                <p>这表示资质库没有找到该类型记录，不等同于法规判定为必须补办；请结合产品销售渠道和注册路径确认。</p>
                <button type="button" onClick={() => { window.location.hash = "#qualifications"; }}>打开资质库 <ChevronRight size={15} /></button>
              </div>
            )}
          </section>
        ) : null}
      </aside>
    </div>
  );
}

export default function QualificationCoveragePage({
  products,
  productBase,
  warehouseOnlyInventory,
  qualificationPayload,
}: {
  products: CatalogProduct[];
  productBase: ProductBase[];
  warehouseOnlyInventory: WarehouseOnlyInventoryItem[];
  qualificationPayload: QualificationPayload | null;
}) {
  const coverageProducts = React.useMemo(() => buildQualificationCoverageProducts(products, productBase, warehouseOnlyInventory), [productBase, products, warehouseOnlyInventory]);
  const warehouses = React.useMemo(() => buildQualificationWarehouseOptions(coverageProducts), [coverageProducts]);
  const [warehouseId, setWarehouseId] = React.useState("");
  const [filter, setFilter] = React.useState<CoverageFilter>("all");
  const [keyword, setKeyword] = React.useState("");
  const [focusedCategory, setFocusedCategory] = React.useState("");
  const [detail, setDetail] = React.useState<{ product: QualificationCoverageProduct; category: string } | null>(null);

  React.useEffect(() => {
    if (!warehouses.length) setWarehouseId("");
    else if (!warehouses.some((warehouse) => warehouse.id === warehouseId)) setWarehouseId(warehouses[0].id);
  }, [warehouseId, warehouses]);

  const coverage = React.useMemo(() => buildQualificationCoverage(
    coverageProducts,
    qualificationPayload?.qualifications || [],
    warehouseId,
  ), [coverageProducts, qualificationPayload, warehouseId]);

  React.useEffect(() => setFocusedCategory(""), [coverage.warehouse?.id]);
  React.useEffect(() => setDetail(null), [coverage.warehouse?.id]);

  const filteredProducts = coverage.products.filter((product) => {
    const query = keyword.trim().toLocaleLowerCase();
    const keywordMatched = !query || [product.sku, product.productName, product.brand, product.category].some((value) => value.toLocaleLowerCase().includes(query));
    const filterMatched = filter === "all"
      || (filter === "gap" && !product.covered)
      || (filter === "attention" && ["expired", "undated"].includes(product.status))
      || (filter === "risk" && ["warning", "urgent"].includes(product.status))
      || (filter === "covered" && product.covered);
    return keywordMatched && filterMatched;
  });
  const selectedDetailCell = detail?.product.cells.find((cell) => cell.category === detail.category) || null;
  const coverageDegrees = `${Math.max(0, Math.min(100, coverage.summary.coverageRate)) * 3.6}deg`;

  return (
    <main className="qualification-coverage-page">
      <section className="qualification-coverage-hero">
        <div className="qualification-coverage-intro">
          <p className="eyebrow">QUALIFICATION COVERAGE MAP</p>
          <h2>仓库资质覆盖</h2>
          <p>从仓库库存反查产品认证，快速定位未覆盖、临期和已过期的 SKU。</p>
          <label><Warehouse size={16} /><span>审查仓库</span><select value={coverage.warehouse?.id || warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name} · {warehouse.country} · {warehouse.productCount} SKU</option>)}</select></label>
        </div>
        <div className="qualification-coverage-score" style={{ "--coverage-degree": coverageDegrees } as React.CSSProperties}>
          <div><strong>{coverage.summary.coverageRate}%</strong><span>国家资质覆盖率</span><small>{coverage.summary.covered} / {coverage.summary.products} 个产品</small></div>
        </div>
        <div className="qualification-coverage-hero-meta">
          <span><Boxes size={15} />有库存 {formatNumber(coverage.warehouse?.totalQty || 0)}</span>
          <span><ShieldCheck size={15} />{coverage.categories.length} 条认证路径</span>
          <span><Clock3 size={15} />同步 {coverage.warehouse?.syncedAt ? formatDate(coverage.warehouse.syncedAt) : "跟随库存"}</span>
        </div>
      </section>

      <section className="qualification-coverage-kpis" aria-label="资质覆盖概览">
        <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}><span>有库存产品</span><strong>{coverage.summary.products}</strong><small>当前仓库审查范围</small></button>
        <button type="button" className={`tone-good ${filter === "covered" ? "active" : ""}`} onClick={() => setFilter("covered")}><span>已覆盖</span><strong>{coverage.summary.covered}</strong><small>至少一项本国有效资质</small></button>
        <button type="button" className={`tone-warning ${filter === "risk" ? "active" : ""}`} onClick={() => setFilter("risk")}><span>续证风险</span><strong>{coverage.summary.risk}</strong><small>90 天内到期</small></button>
        <button type="button" className={`tone-danger ${filter === "attention" ? "active" : ""}`} onClick={() => setFilter("attention")}><span>过期 / 待核验</span><strong>{coverage.summary.expired + coverage.summary.undated}</strong><small>过期 {coverage.summary.expired} · 无日期 {coverage.summary.undated}</small></button>
        <button type="button" className={`tone-gap ${filter === "gap" ? "active" : ""}`} onClick={() => setFilter("gap")}><span>完全未覆盖</span><strong>{coverage.summary.missing}</strong><small>没有本国资质记录</small></button>
      </section>

      <section className="qualification-coverage-path-panel">
        <header><div><p className="eyebrow">CERTIFICATION PATHS</p><h3>{coverage.warehouse?.country || "当前仓库"}认证路径</h3></div><p><i className="valid" />有效 <i className="warning" />临期 <i className="expired" />过期 <i className="missing" />未登记</p></header>
        <div className="qualification-path-cards">
          {coverage.categories.map((category) => (
            <button type="button" className={focusedCategory === category.name ? "active" : ""} key={category.name} onClick={() => setFocusedCategory(focusedCategory === category.name ? "" : category.name)}>
              <div><span>{category.name}</span><strong>{category.coverageRate}%</strong></div>
              <i><b style={{ width: `${category.coverageRate}%` }} /></i>
              <p><span>{category.coveredProducts} 已覆盖</span><span>{category.missingProducts} 未登记</span>{category.expiringProducts ? <em>{category.expiringProducts} 临期</em> : null}</p>
            </button>
          ))}
          {!coverage.categories.length ? <div className="qualification-coverage-empty"><ShieldAlert size={25} /><strong>未识别该仓认证路径</strong><span>请先在资质库维护带国家名称的资质类型。</span></div> : null}
        </div>
      </section>

      <section className="qualification-matrix-panel">
        <header>
          <div><p className="eyebrow">PRODUCT × CERTIFICATION</p><h3>产品认证矩阵</h3><span>空白格表示资质库未登记该类型；产品只要有一项本国有效资质即计入覆盖。</span></div>
          <div className="qualification-matrix-tools">
            <label><Search size={15} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索 SKU、产品或品牌" /></label>
            <select value={filter} onChange={(event) => setFilter(event.target.value as CoverageFilter)}><option value="all">全部产品</option><option value="gap">仅看缺口</option><option value="attention">仅看过期 / 待核验</option><option value="risk">仅看临期</option><option value="covered">仅看已覆盖</option></select>
          </div>
        </header>
        <div className="qualification-matrix-scroll">
          <table>
            <thead><tr><th>产品 / SKU</th><th>覆盖结论</th>{coverage.categories.map((category) => <th className={focusedCategory === category.name ? "is-focused" : ""} key={category.name}>{category.name}<small>{category.coverageRate}%</small></th>)}<th>仓内库存</th></tr></thead>
            <tbody>
              {filteredProducts.map((product) => (
                <tr key={product.id}>
                  <td><button type="button" className="qualification-product-cell" onClick={() => setDetail({ product, category: product.cells.find((cell) => cell.records.length > 0)?.category || product.cells[0]?.category || "" })}>{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <i><PackageSearch size={17} /></i>}<span><strong>{product.productName}</strong><small>{product.sku} · {product.brand || product.category}</small></span><ChevronRight size={15} /></button></td>
                  <td><button type="button" className={`qualification-overall-status status-${product.status}`} onClick={() => setDetail({ product, category: product.cells.find((cell) => cell.records.length > 0)?.category || product.cells[0]?.category || "" })}>{statusIcon(product.status)}<span><strong>{statusMeta[product.status].label}</strong><small>{product.coveredCategoryCount}/{product.cells.length} 条路径有效</small></span></button></td>
                  {product.cells.map((cell) => <td className={focusedCategory === cell.category ? "is-focused" : ""} key={cell.category}><CellButton cell={cell} onClick={() => setDetail({ product, category: cell.category })} /></td>)}
                  <td><strong className="qualification-stock-value">{formatNumber(product.totalQty)}</strong><small className="qualification-stock-detail">可售 {formatNumber(product.availableQty)} · 在途 {formatNumber(product.inTransitQty)}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filteredProducts.length ? <div className="qualification-coverage-empty"><PackageSearch size={26} /><strong>当前条件下没有产品</strong><span>可以切换仓库、覆盖状态或清空搜索词。</span></div> : null}
        </div>
        <footer><span>显示 {filteredProducts.length} / {coverage.products.length} 个有库存产品</span><span><AlertTriangle size={13} />“未登记”仅表示系统没有记录，最终合规要求仍需按产品和销售渠道确认。</span></footer>
      </section>

      {detail ? <DetailDrawer product={detail.product} selectedCell={selectedDetailCell} warehouseName={coverage.warehouse?.name || "当前仓库"} onSelectCategory={(category) => setDetail((current) => current ? { ...current, category } : current)} onClose={() => setDetail(null)} /> : null}
    </main>
  );
}
