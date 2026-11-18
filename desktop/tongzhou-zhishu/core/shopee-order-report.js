"use strict";

const { parseXlsx } = require("./xlsx-lite");
const { addDays } = require("./sites");

const COLUMN_SPECS = Object.freeze({
  orderId: { index: 0, names: ["No. Pesanan", "Order ID", "Order No."] },
  status: { index: 1, names: ["Status Pesanan", "Order Status"] },
  createdAt: { index: 9, names: ["Waktu Pesanan Dibuat", "Order Creation Date", "Order Created Time"] },
  paidAt: { index: 10, names: ["Waktu Pembayaran Dilakukan", "Order Paid Time", "Payment Time"] },
  subtotal: { index: 21, names: ["Subtotal Pesanan", "Product Subtotal", "Order Subtotal"] },
  sellerVoucher: { index: 28, names: ["Voucher Ditanggung Penjual", "Seller Voucher"] },
  cashback: { index: 29, names: ["Cashback Koin", "Coin Cashback"] },
  platformVoucher: { index: 30, names: ["Voucher Ditanggung Shopee", "Shopee Voucher"] },
  bundleShopee: { index: 32, names: ["Paket Diskon (Diskon dari Shopee)", "Bundle Deal (Shopee Discount)"] },
  bundleSeller: { index: 33, names: ["Paket Diskon (Diskon dari Penjual)", "Bundle Deal (Seller Discount)"] },
  coins: { index: 34, names: ["Potongan Koin Shopee", "Shopee Coins Offset"] },
  creditCardDiscount: { index: 35, names: ["Diskon Kartu Kredit", "Credit Card Discount"] },
  buyerShipping: { index: 36, names: ["Ongkos Kirim Dibayar oleh Pembeli", "Shipping Fee Paid by Buyer"] },
  shippingDiscount: { index: 37, names: ["Estimasi Potongan Biaya Pengiriman", "Estimated Shipping Fee Discount"] },
  reverseShipping: { index: 38, names: ["Ongkos Kirim Pengembalian Barang", "Return Shipping Fee"] },
  totalPayment: { index: 39, names: ["Total Pembayaran", "Total Payment"] },
  estimatedShipping: { index: 40, names: ["Perkiraan Ongkos Kirim", "Estimated Shipping Fee"] },
});

const ZERO_DECIMAL_SITES = new Set(["ID", "VN", "TW", "CL", "CO"]);
const ORDER_REPORT_LOOKBACK_DAYS = 14;
const ORDER_REPORT_MAX_RANGE_DAYS = 21;

function normalizeHeader(value) {
  return String(value || "").trim().toLocaleLowerCase().replace(/[\s._/()\-]+/g, "");
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
    throw new Error("Shopee 订单报表列结构不符合预期，已停止替换支付金额。");
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

module.exports = { ORDER_REPORT_LOOKBACK_DAYS, ORDER_REPORT_MAX_RANGE_DAYS, emptyDay, orderReportWindows, parseDate, parseMoney, parseShopeeOrderReport };
