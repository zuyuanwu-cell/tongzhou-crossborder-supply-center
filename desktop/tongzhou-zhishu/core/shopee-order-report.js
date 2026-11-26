"use strict";

const { createHash } = require("node:crypto");
const { parseXlsx } = require("./xlsx-lite");
const { addDays } = require("./sites");

const SHOPEE_REPORT_SCHEMA_VERSION = "2026-11-v3";

const COLUMN_SPECS = Object.freeze({
  orderId: { index: 0, names: ["No. Pesanan", "ID Pesanan", "Order ID", "Order No.", "订单编号", "訂單編號", "Mã đơn hàng"] },
  status: { index: 1, names: ["Status Pesanan", "Order Status", "订单状态", "訂單狀態", "Trạng thái đơn hàng"] },
  createdAt: { index: 9, names: ["Waktu Pesanan Dibuat", "Masa Pesanan Dibuat", "Order Creation Date", "Order Created Time", "订单创建时间", "訂單建立時間", "Thời gian tạo đơn hàng"] },
  paidAt: { index: 10, names: ["Waktu Pembayaran Dilakukan", "Masa Pembayaran", "Order Paid Time", "Payment Time", "付款时间", "付款時間", "Thời gian thanh toán"] },
  subtotal: { index: 21, names: ["Subtotal Pesanan", "Subjumlah Produk", "Product Subtotal", "Order Subtotal", "商品小计", "商品小計", "Tổng tiền sản phẩm", "Tổng phụ đơn hàng"] },
  sellerVoucher: { index: 28, names: ["Voucher Ditanggung Penjual", "Baucar Penjual", "Seller Voucher", "卖家优惠券", "賣家優惠券", "Voucher của Người bán", "Voucher do Người bán tài trợ"] },
  cashback: { index: 29, names: ["Cashback Koin", "Coin Cashback", "金币返现", "金幣回饋", "Hoàn xu"] },
  platformVoucher: { index: 30, names: ["Voucher Ditanggung Shopee", "Baucar Shopee", "Shopee Voucher", "Shopee 优惠券", "Shopee 優惠券", "Voucher Shopee"] },
  bundleShopee: { index: 32, names: ["Paket Diskon (Diskon dari Shopee)", "Bundle Deal (Shopee Discount)", "Shopee 套装优惠", "Shopee 套裝優惠", "Combo khuyến mãi (Shopee tài trợ)"] },
  bundleSeller: { index: 33, names: ["Paket Diskon (Diskon dari Penjual)", "Bundle Deal (Seller Discount)", "卖家套装优惠", "賣家套裝優惠", "Combo khuyến mãi (Người bán tài trợ)"] },
  coins: { index: 34, names: ["Potongan Koin Shopee", "Shopee Coins Offset", "Shopee 金币抵扣", "Shopee 金幣折抵", "Xu Shopee"] },
  creditCardDiscount: { index: 35, names: ["Diskon Kartu Kredit", "Credit Card Discount", "信用卡优惠", "信用卡優惠", "Giảm giá thẻ tín dụng"] },
  buyerShipping: { index: 36, names: ["Ongkos Kirim Dibayar oleh Pembeli", "Shipping Fee Paid by Buyer", "买家支付运费", "買家支付運費", "Phí vận chuyển người mua trả"] },
  shippingDiscount: { index: 37, names: ["Estimasi Potongan Biaya Pengiriman", "Estimated Shipping Fee Discount", "预估运费优惠", "預估運費優惠", "Ước tính giảm phí vận chuyển"] },
  reverseShipping: { index: 38, names: ["Ongkos Kirim Pengembalian Barang", "Return Shipping Fee", "退货运费", "退貨運費", "Phí vận chuyển trả hàng"] },
  totalPayment: { index: 39, names: ["Total Pembayaran", "Jumlah Bayaran", "Total Payment", "Grand Total", "买家实付金额", "買家實付金額", "订单总金额", "訂單總金額", "Tổng thanh toán"] },
  estimatedShipping: { index: 40, names: ["Perkiraan Ongkos Kirim", "Estimated Shipping Fee", "预估运费", "預估運費", "Phí vận chuyển ước tính"] },
});

const ZERO_DECIMAL_SITES = new Set(["ID", "VN", "TW", "CL", "CO"]);
const ORDER_REPORT_LOOKBACK_DAYS = 14;
const ORDER_REPORT_MAX_RANGE_DAYS = 21;

function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\uFEFF\u200B-\u200D\u2060]/g, "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s._/()\-:：\[\]【】]+/g, "");
}

function safeHeaderValue(value, maxLength = 64) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function safeHeaderDiagnostic(header, { maxColumns = 80, maxChars = 3200 } = {}) {
  const values = [];
  let usedChars = 0;
  for (const raw of header.slice(0, maxColumns)) {
    const value = safeHeaderValue(raw);
    const nextChars = value.length + 3;
    if (usedChars + nextChars > maxChars) break;
    values.push(value);
    usedChars += nextChars;
  }
  const normalized = header.map(normalizeHeader);
  const matched = {};
  for (const [key, spec] of Object.entries(COLUMN_SPECS)) {
    const index = spec.names
      .map(normalizeHeader)
      .map((name) => normalized.indexOf(name))
      .find((candidate) => candidate >= 0);
    if (index >= 0) matched[key] = { index, header: safeHeaderValue(header[index]) };
  }
  const required = ["orderId", "paidAt", "totalPayment"];
  return {
    count: header.length,
    fingerprint: createHash("sha256").update(normalized.join("\u001f")).digest("hex").slice(0, 16),
    matched,
    missing: required.filter((key) => !matched[key]),
    headers: values,
    truncated: values.length < header.length,
  };
}

function safeHeaderPreview(header) {
  return safeHeaderDiagnostic(header);
}

function columnMap(header) {
  const normalized = header.map(normalizeHeader);
  const columns = {};
  for (const [key, spec] of Object.entries(COLUMN_SPECS)) {
    const found = spec.names.map(normalizeHeader).map((name) => normalized.indexOf(name)).find((index) => index >= 0);
    columns[key] = found >= 0 ? found : spec.index;
  }
  const recognizedOrder = COLUMN_SPECS.orderId.names.map(normalizeHeader).includes(normalized[columns.orderId]);
  const recognizedPayment = COLUMN_SPECS.totalPayment.names.map(normalizeHeader).includes(normalized[columns.totalPayment]);
  const recognizedPaidAt = COLUMN_SPECS.paidAt.names.map(normalizeHeader).includes(normalized[columns.paidAt]);
  if (header.length < 41 || !recognizedOrder || !recognizedPayment || !recognizedPaidAt) {
    throw new Error(`Shopee 订单报表列结构不符合预期，已停止替换支付金额。schema=${SHOPEE_REPORT_SCHEMA_VERSION}; columns=${header.length}; headers=${JSON.stringify(safeHeaderPreview(header))}`);
  }
  return columns;
}

function parseMoney(value, site) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "-") return 0;
  const sign = /^-/.test(raw) || /^\(.*\)$/.test(raw) ? -1 : 1;
  let number = raw.replace(/[^0-9.,]/g, "");
  if (!number) return 0;
  if (ZERO_DECIMAL_SITES.has(String(site || "").toUpperCase())) {
    number = number.replace(/[.,]/g, "");
  } else {
    const dot = number.lastIndexOf(".");
    const comma = number.lastIndexOf(",");
    const separator = Math.max(dot, comma);
    if (separator >= 0) {
      const decimals = number.length - separator - 1;
      if (decimals === 1 || decimals === 2) {
        number = `${number.slice(0, separator).replace(/[.,]/g, "")}.${number.slice(separator + 1)}`;
      } else {
        number = number.replace(/[.,]/g, "");
      }
    }
  }
  const result = Number(number);
  return Number.isFinite(result) ? Math.round(sign * result * 100) / 100 : 0;
}

function parseDate(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "-") return "";
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const local = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(raw);
  if (local) return `${local[3]}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}`;
  return "";
}

function emptyDay() {
  return {
    payAmount: 0,
    buyerPaid: 0,
    orderCount: 0,
    subtotal: 0,
    sellerVoucher: 0,
    platformVoucher: 0,
    cashback: 0,
    bundleShopee: 0,
    bundleSeller: 0,
    coins: 0,
    creditCardDiscount: 0,
    buyerShipping: 0,
    shippingDiscount: 0,
    reverseShipping: 0,
    estimatedShipping: 0,
  };
}

function parseShopeeOrderReport(buffer, { site = "" } = {}) {
  const rows = parseXlsx(buffer);
  if (!rows.length) throw new Error("Shopee 订单报表没有表头。");
  const columns = columnMap(rows[0]);
  const orders = new Map();
  for (const row of rows.slice(1)) {
    const orderId = String(row[columns.orderId] || "").trim();
    if (!orderId) continue;
    let order = orders.get(orderId);
    if (!order) {
      order = { orderId, subtotal: 0, assigned: new Set() };
      orders.set(orderId, order);
    }
    order.subtotal += parseMoney(row[columns.subtotal], site);
    for (const field of ["status", "createdAt", "paidAt", "sellerVoucher", "platformVoucher", "cashback", "bundleShopee", "bundleSeller", "coins", "creditCardDiscount", "buyerShipping", "shippingDiscount", "reverseShipping", "totalPayment", "estimatedShipping"]) {
      const raw = row[columns[field]];
      if (order.assigned.has(field) || raw === undefined || String(raw).trim() === "") continue;
      order[field] = field.endsWith("At") ? parseDate(raw) : field === "status" ? String(raw).trim() : parseMoney(raw, site);
      order.assigned.add(field);
    }
  }
  const days = {};
  for (const order of orders.values()) {
    if (!order.paidAt) continue;
    const day = days[order.paidAt] || emptyDay();
    day.orderCount += 1;
    // 运营口径：支付销售金额只减卖家承担的优惠券。订单小计已经是商品折后价；
    // Shopee/平台承担的券和金币不应减少销售额。Total Payment 仅保留作买家实付对账。
    day.payAmount += Math.max(0, (order.subtotal || 0) - (order.sellerVoucher || 0));
    day.buyerPaid += order.totalPayment || 0;
    day.subtotal += order.subtotal || 0;
    for (const field of ["sellerVoucher", "platformVoucher", "cashback", "bundleShopee", "bundleSeller", "coins", "creditCardDiscount", "buyerShipping", "shippingDiscount", "reverseShipping", "estimatedShipping"]) {
      day[field] += order[field] || 0;
    }
    days[order.paidAt] = day;
  }
  for (const day of Object.values(days)) {
    for (const field of Object.keys(day)) day[field] = Math.round(day[field] * 100) / 100;
  }
  return { rowCount: rows.length - 1, uniqueOrderCount: orders.size, days };
}

function orderReportWindows(dates, { lookbackDays = ORDER_REPORT_LOOKBACK_DAYS, maxRangeDays = ORDER_REPORT_MAX_RANGE_DAYS } = {}) {
  const wanted = [...new Set((dates || []).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort();
  const windows = [];
  let current = null;
  for (const date of wanted) {
    if (!current || date > addDays(current.startDate, maxRangeDays - 1)) {
      current = { startDate: addDays(date, -lookbackDays), endDate: date, dates: [date] };
      windows.push(current);
      continue;
    }
    current.endDate = date;
    current.dates.push(date);
  }
  return windows;
}

module.exports = {
  COLUMN_SPECS,
  SHOPEE_REPORT_SCHEMA_VERSION,
  ORDER_REPORT_LOOKBACK_DAYS,
  ORDER_REPORT_MAX_RANGE_DAYS,
  columnMap,
  emptyDay,
  normalizeHeader,
  orderReportWindows,
  parseDate,
  parseMoney,
  parseShopeeOrderReport,
  safeHeaderDiagnostic,
};
