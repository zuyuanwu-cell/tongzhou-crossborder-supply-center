import QRCode from "qrcode";
import type { DomesticInventoryMovement, DomesticInventoryTransfer } from "../api";

function html(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function quantity(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function dateTime(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

export function buildInventoryDeepLink(kind: "movement" | "transfer", id: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("inventoryDocument", kind);
  url.searchParams.set("inventoryDocumentId", id);
  url.hash = "#domestic-inventory";
  return url.toString();
}

async function openPrintTemplate(input: {
  title: string;
  documentNo: string;
  status: string;
  meta: Array<[string, string]>;
  rows: Array<{ sku: string; name: string; batch: string; carton: string; quantity: string; unit: string }>;
  note?: string;
  deepLink: string;
}) {
  const printWindow = window.open("", "_blank", "width=1100,height=820");
  if (!printWindow) throw new Error("浏览器阻止了打印窗口，请允许本站打开弹窗后重试。");
  printWindow.opener = null;
  printWindow.document.write("<!doctype html><title>正在生成打印模板…</title><p style='font-family:sans-serif;padding:30px'>正在生成二维码与打印模板…</p>");
  const qrDataUrl = await QRCode.toDataURL(input.deepLink, { width: 220, margin: 1, errorCorrectionLevel: "M", color: { dark: "#07356e", light: "#ffffff" } });
  const meta = input.meta.map(([label, value]) => `<div><span>${html(label)}</span><strong>${html(value || "—")}</strong></div>`).join("");
  const rows = input.rows.map((row, index) => `<tr><td>${index + 1}</td><td><b>${html(row.sku)}</b><small>${html(row.name)}</small></td><td>${html(row.batch || "—")}</td><td>${html(row.carton || "—")}</td><td class="number">${html(row.quantity)} ${html(row.unit)}</td><td></td></tr>`).join("");
  const content = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(input.documentNo)} ${html(input.title)}</title><style>
    @page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;color:#102b50;font-family:"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",Arial,sans-serif;font-size:12px}.page{width:100%;min-height:270mm}.header{display:flex;align-items:flex-start;justify-content:space-between;padding:8px 0 16px;border-bottom:3px solid #0c4b8f}.brand{display:flex;gap:12px;align-items:center}.logo{display:grid;place-items:center;width:44px;height:44px;border-radius:9px;background:#f45b16;color:#fff;font-size:20px;font-weight:900}.brand h1{margin:0 0 4px;font-size:24px}.brand p{margin:0;color:#6c8098}.status{padding:7px 11px;border-radius:99px;background:#edf5ff;color:#0a559e;font-weight:800}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;margin:14px 0;background:#d9e4ef;border:1px solid #d9e4ef}.meta div{display:grid;gap:4px;min-height:56px;padding:10px;background:#fff}.meta span{color:#70849b;font-size:10px}.meta strong{font-size:13px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{padding:9px 8px;border:1px solid #cad8e6;text-align:left;vertical-align:top}th{background:#edf4fb;color:#355775}th:first-child,td:first-child{width:38px;text-align:center}th:nth-child(3){width:125px}th:nth-child(4){width:150px}th:nth-child(5){width:105px}.number{text-align:right}td small{display:block;margin-top:4px;color:#6f8298}.note{min-height:52px;margin-top:12px;padding:10px;border:1px solid #cad8e6}.footer{display:grid;grid-template-columns:1fr 124px;gap:18px;align-items:end;margin-top:16px}.signatures{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.signatures div{padding-top:28px;border-bottom:1px solid #8295aa}.qr{text-align:center}.qr img{width:104px;height:104px}.qr p{margin:3px 0;color:#657b94;font-size:9px}.security{margin-top:12px;color:#7b8ea4;font-size:9px}.actions{position:fixed;right:18px;top:18px;display:flex;gap:8px}.actions button{padding:10px 14px;border:0;border-radius:8px;background:#f45b16;color:#fff;font-weight:800}.actions button:last-child{background:#fff;color:#174d87;border:1px solid #bed0e2}@media print{.actions{display:none}.page{min-height:auto}}
  </style></head><body><div class="actions"><button onclick="window.print()">打印 / 保存 PDF</button><button onclick="window.close()">关闭</button></div><main class="page"><header class="header"><div class="brand"><div class="logo">同舟</div><div><h1>${html(input.title)}</h1><p>同舟供应链 · 国内仓库存单据</p></div></div><div class="status">${html(input.status)}</div></header><section class="meta"><div><span>单据号</span><strong>${html(input.documentNo)}</strong></div>${meta}</section><table><thead><tr><th>序号</th><th>SKU / 产品</th><th>批次</th><th>箱规</th><th>数量</th><th>仓库复核</th></tr></thead><tbody>${rows}</tbody></table><div class="note"><b>备注：</b>${html(input.note || "无")}</div><footer class="footer"><div><div class="signatures"><div>制单人：</div><div>发货复核：</div><div>收货复核：</div></div><p class="security">本二维码仅包含中台安全链接；扫码后仍需登录并通过仓库权限校验。</p></div><div class="qr"><img src="${qrDataUrl}" alt="单据二维码"><p>扫码查看与操作本单据</p></div></footer></main></body></html>`;
  printWindow.document.open();
  printWindow.document.write(content);
  printWindow.document.close();
  printWindow.focus();
}

export async function printInventoryMovement(movement: DomesticInventoryMovement) {
  const typeLabels: Record<string, string> = { opening: "期初库存单", inbound: "入库单", outbound: "出库单", adjustment: "库存调整单", transfer_out: "调拨出库单", transfer_in: "调拨入库单", transfer_cancel: "调拨取消单" };
  await openPrintTemplate({
    title: typeLabels[movement.type] || "库存单据",
    documentNo: movement.movementNo,
    status: "已完成",
    deepLink: buildInventoryDeepLink("movement", movement.id),
    meta: [["仓库", movement.warehouseName], ["关联单号", movement.referenceNo], ["发生时间", dateTime(movement.occurredAt)], ["经办人", movement.createdByName], ["SKU 数", String(movement.lines.length)]],
    rows: movement.lines.map((line) => {
      const lots = line.lots?.length ? line.lots : line.lot ? [line.lot] : [];
      const lotText = lots.map((lot) => lot.lotNo).filter(Boolean).join("、") || line.allocations?.map((item) => item.lotNo).filter(Boolean).join("、") || "";
      const cartonText = lots.map((lot) => lot.packagingMode === "carton" ? `${quantity(lot.unitsPerCarton)}件/箱` : "按件").join("、");
      return { sku: line.sku, name: line.productName, batch: lotText, carton: cartonText, quantity: quantity(Math.abs(line.signedQty || line.quantity)), unit: line.unit };
    }),
    note: movement.note,
  });
}

export async function printInventoryTransfer(transfer: DomesticInventoryTransfer) {
  const statusLabels: Record<string, string> = { in_transit: "调拨在途", received: "已确认收货", cancelled: "已取消" };
  await openPrintTemplate({
    title: "库存调拨单",
    documentNo: transfer.transferNo,
    status: statusLabels[transfer.status] || transfer.status,
    deepLink: buildInventoryDeepLink("transfer", transfer.id),
    meta: [["调出仓", transfer.sourceWarehouseName], ["调入仓", transfer.targetWarehouseName], ["发出时间", dateTime(transfer.shippedAt)], ["发起人", transfer.createdByName], ["收货时间", dateTime(transfer.receivedAt)]],
    rows: transfer.lines.map((line) => ({
      sku: line.sku,
      name: line.productName,
      batch: line.allocations.map((item) => item.lotNo || "未追溯批次").join("、"),
      carton: line.allocations.map((item) => item.packagingMode === "carton" && item.unitsPerCarton ? `${quantity(item.unitsPerCarton)}件/箱` : "按件").join("、"),
      quantity: quantity(line.quantity),
      unit: line.unit,
    })),
    note: transfer.note,
  });
}
