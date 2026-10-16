import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { isIP } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const REPORT_WIDTH = 1080;
const MAX_REPORT_ITEMS = 20;
const WECOM_IMAGE_LIMIT = 2 * 1024 * 1024;
const THUMBNAIL_MAX_BYTES = 1_500_000;
const THUMBNAIL_FETCH_TIMEOUT_MS = 4_000;
const THUMBNAIL_FETCH_CONCURRENCY = 4;
const DAY_MS = 24 * 60 * 60 * 1000;
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const bundledFontPath = resolve(moduleDirectory, "../assets/fonts/NotoSansCJKsc-Regular.otf");
const bundledFontFiles = existsSync(bundledFontPath) ? [bundledFontPath] : [];

function numberOrZero(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function text(value, fallback = "-") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function truncate(value, maxLength) {
  const normalized = text(value, "");
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(1, maxLength - 1))}…` : normalized;
}

function dateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function displayDate(value, fallback = "待确认") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return text(value, fallback).slice(0, 10);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
  }).format(date).replaceAll("/", ".");
}

function displayDateTime(value) {
  const date = new Date(value || Date.now());
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replaceAll("/", ".");
}

function formatNumber(value, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits }).format(numberOrZero(value));
}

function estimatedStockout(item, generatedAt) {
  if (item.estimatedStockoutDate) return String(item.estimatedStockoutDate).slice(0, 10);
  if (item.daysCover === null || item.daysCover === undefined || !Number.isFinite(Number(item.daysCover))) return "";
  const base = new Date(generatedAt || Date.now());
  if (Number.isNaN(base.getTime())) return "";
  return dateKey(new Date(base.getTime() + Math.max(0, Number(item.daysCover)) * DAY_MS));
}

function trendSummary(values = []) {
  const points = values.map(numberOrZero).slice(-30);
  if (!points.length) return { points: [], direction: "flat", percentage: 0, label: "暂无趋势" };
  const recent = points.slice(-7);
  const previous = points.slice(-14, -7);
  const average = (rows) => rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : 0;
  const recentAverage = average(recent);
  const previousAverage = average(previous);
  const percentage = previousAverage > 0 ? ((recentAverage - previousAverage) / previousAverage) * 100 : recentAverage > 0 ? 100 : 0;
  const direction = percentage > 8 ? "up" : percentage < -8 ? "down" : "flat";
  return {
    points,
    direction,
    percentage,
    label: direction === "up" ? `近7日 ↑${formatNumber(Math.abs(percentage), 1)}%` : direction === "down" ? `近7日 ↓${formatNumber(Math.abs(percentage), 1)}%` : "近7日平稳",
  };
}

function primaryWarehouse(item) {
  const rows = Array.isArray(item.warehouseBreakdown) ? item.warehouseBreakdown : [];
  return rows
    .filter((row) => text(row.warehouseName, "") || text(row.warehouseId, ""))
    .sort((a, b) => numberOrZero(b.availableQty) - numberOrZero(a.availableQty))
    .slice(0, 2)
    .map((row) => text(row.warehouseName, row.warehouseId))
    .join(" / ") || "仓库待确认";
}

function statusRank(item) {
  if (item.status === "缺货") return 0;
  const cover = Number(item.daysCover);
  if (Number.isFinite(cover)) return Math.max(0, cover);
  return item.status === "补货预警" ? 365 : 730;
}

function safeInlineImage(value) {
  const source = String(value || "").trim();
  if (!/^data:image\/(?:png|jpe?g|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(source)) return "";
  return source.length <= Math.ceil(THUMBNAIL_MAX_BYTES * 4 / 3) + 256 ? source.replace(/\s+/g, "") : "";
}

function blockedImageHostname(hostname) {
  const host = String(hostname || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  const version = isIP(host);
  if (version === 4) {
    const octets = host.split(".").map(Number);
    return octets[0] === 10
      || octets[0] === 127
      || (octets[0] === 169 && octets[1] === 254)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168)
      || octets[0] === 0;
  }
  if (version === 6) return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb");
  return false;
}

function safeRemoteImageUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!/^https?:$/.test(url.protocol) || blockedImageHostname(url.hostname)) return "";
    return url.href;
  } catch {
    return "";
  }
}

function detectedImageMime(buffer, declaredType = "") {
  const declared = String(declaredType || "").split(";", 1)[0].trim().toLowerCase();
  if (declared === "image/png" || declared === "image/jpeg") return declared;
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  return "";
}

async function fetchThumbnailDataUri(imageUrl, options = {}) {
  const inline = safeInlineImage(imageUrl);
  if (inline) return inline;
  const remoteUrl = safeRemoteImageUrl(imageUrl);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!remoteUrl || typeof fetchImpl !== "function") return "";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(500, Number(options.thumbnailTimeoutMs) || THUMBNAIL_FETCH_TIMEOUT_MS));
  try {
    const response = await fetchImpl(remoteUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: { accept: "image/png,image/jpeg;q=0.9,*/*;q=0.1", "user-agent": "Tongzhou-Supply-Center/1.0" },
    });
    if (!response?.ok || (response.url && !safeRemoteImageUrl(response.url))) return "";
    const contentLength = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(contentLength) && contentLength > THUMBNAIL_MAX_BYTES) return "";
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > THUMBNAIL_MAX_BYTES) return "";
    const mime = detectedImageMime(buffer, response.headers?.get?.("content-type"));
    return mime ? `data:${mime};base64,${buffer.toString("base64")}` : "";
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

export function buildStockupWarningReportModel(payload = {}, options = {}) {
  const generatedAt = options.generatedAt || payload.generatedAt || new Date().toISOString();
  const maxItems = Math.max(1, Math.min(50, Number(options.maxItems) || MAX_REPORT_ITEMS));
  const sourceItems = Array.isArray(payload.recommendations) ? payload.recommendations : [];
  const sorted = [...sourceItems].sort((a, b) => {
    const rank = statusRank(a) - statusRank(b);
    if (rank) return rank;
    return numberOrZero(b.netReplenishQty) - numberOrZero(a.netReplenishQty);
  });
  const items = sorted.slice(0, maxItems).map((item, index) => {
    const stockoutDate = estimatedStockout(item, generatedAt);
    const trend = trendSummary(item.trend30);
    const daysCover = item.daysCover === null || item.daysCover === undefined ? null : numberOrZero(item.daysCover);
    return {
      rank: index + 1,
      id: text(item.id, item.sku),
      sku: text(item.sku, item.countrySku || item.id),
      name: text(item.name, "未命名产品"),
      imageUrl: text(item.imageUrl, ""),
      thumbnailDataUri: safeInlineImage(item.thumbnailDataUri || item.imageUrl),
      country: text(item.country, "未分国家"),
      warehouse: primaryWarehouse(item),
      unit: text(item.unit, "件"),
      status: text(item.status, "补货预警"),
      availableQty: numberOrZero(item.availableQty),
      inTransitQty: numberOrZero(item.inTransitQty),
      replenishQty: numberOrZero(item.replenishQty),
      outsourcingInProductionQty: numberOrZero(item.outsourcingInProductionQty),
      netReplenishQty: numberOrZero(item.netReplenishQty),
      yesterdayOutboundQty: item.yesterdayOutboundQty === null || item.yesterdayOutboundQty === undefined ? null : numberOrZero(item.yesterdayOutboundQty),
      yesterdayReservedQty: item.yesterdayReservedQty === null || item.yesterdayReservedQty === undefined ? null : numberOrZero(item.yesterdayReservedQty),
      daysCover,
      stockoutDate,
      trend,
    };
  });
  const urgentItems = sorted.filter((item) => item.status === "缺货" || (Number.isFinite(Number(item.daysCover)) && Number(item.daysCover) <= 7));
  const stockoutDates = sorted.map((item) => estimatedStockout(item, generatedAt)).filter(Boolean).sort();
  return {
    title: options.title || "备货预警日报",
    subtitle: options.subtitle || "销售动销 × 库存水位 × 委外在产",
    reportDate: dateKey(generatedAt),
    generatedAt,
    generatedAtLabel: displayDateTime(generatedAt),
    totalItems: sorted.length,
    urgentItems: urgentItems.length,
    totalNetReplenishQty: numberOrZero(payload.counts?.netRecommendedQty ?? sorted.reduce((sum, item) => sum + numberOrZero(item.netReplenishQty), 0)),
    totalOutsourcingQty: sorted.reduce((sum, item) => sum + numberOrZero(item.outsourcingInProductionQty), 0),
    nearestStockoutDate: stockoutDates[0] || "待确认",
    omittedItems: Math.max(0, sorted.length - items.length),
    items,
  };
}

export async function hydrateStockupWarningThumbnails(model, options = {}) {
  const items = Array.isArray(model?.items) ? model.items : [];
  const hydratedItems = [...items];
  const concurrency = Math.max(1, Math.min(8, Number(options.thumbnailConcurrency) || THUMBNAIL_FETCH_CONCURRENCY));
  for (let index = 0; index < items.length; index += concurrency) {
    const batch = items.slice(index, index + concurrency);
    const results = await Promise.all(batch.map((item) => item.thumbnailDataUri
      ? item.thumbnailDataUri
      : fetchThumbnailDataUri(item.imageUrl, options)));
    results.forEach((thumbnailDataUri, offset) => {
      hydratedItems[index + offset] = { ...items[index + offset], thumbnailDataUri };
    });
  }
  return { ...model, items: hydratedItems };
}

function deterministicColor(value) {
  const palette = ["#F05A1B", "#1557A0", "#0F766E", "#7C3AED", "#B45309", "#BE185D"];
  const hash = [...String(value || "")].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return palette[hash % palette.length];
}

function sparkline(points, x, y, width, height, color) {
  if (!points.length) {
    return `<line x1="${x}" y1="${y + height / 2}" x2="${x + width}" y2="${y + height / 2}" stroke="#C9D6E4" stroke-width="3" stroke-dasharray="6 7"/>`;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const coords = points.map((value, index) => {
    const px = x + (index / Math.max(1, points.length - 1)) * width;
    const py = y + height - ((value - min) / range) * height;
    return [px, py];
  });
  const line = coords.map(([px, py], index) => `${index ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
  const area = `${line} L${(x + width).toFixed(1)} ${(y + height).toFixed(1)} L${x.toFixed(1)} ${(y + height).toFixed(1)} Z`;
  const last = coords.at(-1);
  return `<path d="${area}" fill="${color}" opacity=".10"/><path d="${line}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="6" fill="#fff" stroke="${color}" stroke-width="4"/>`;
}

function metricCell(label, value, x, y, width, accent = false) {
  return `<g transform="translate(${x} ${y})"><rect width="${width}" height="72" rx="14" fill="${accent ? "#FFF1E9" : "#F4F7FB"}"/><text x="16" y="25" class="metric-label">${escapeXml(label)}</text><text x="16" y="55" class="metric-value${accent ? " accent" : ""}">${escapeXml(value)}</text></g>`;
}

function thumbnailInitials(item) {
  const skuParts = String(item.sku || "").split(/[^a-z0-9]+/i).filter(Boolean);
  if (skuParts.length) return skuParts[0].slice(0, 2).toUpperCase();
  return String(item.name || "品").trim().slice(0, 1).toUpperCase();
}

function thumbnailSvg(item, index, accent) {
  const image = safeInlineImage(item.thumbnailDataUri);
  const background = `<rect x="24" y="22" width="82" height="82" rx="18" fill="${accent}" opacity=".10"/>`;
  const content = image
    ? `<defs><clipPath id="product-thumb-${index}"><rect x="24" y="22" width="82" height="82" rx="18"/></clipPath></defs><image href="${escapeXml(image)}" x="24" y="22" width="82" height="82" preserveAspectRatio="xMidYMid slice" clip-path="url(#product-thumb-${index})"/>`
    : `${background}<path d="M47 43h36l9 12v31H38V55l9-12Zm-3 13h42M58 43v13M72 43v13" fill="none" stroke="${accent}" stroke-width="3" stroke-linejoin="round" opacity=".48"/><text x="65" y="80" text-anchor="middle" class="thumb-initial" fill="${accent}">${escapeXml(thumbnailInitials(item))}</text>`;
  return `${content}<rect x="24" y="22" width="82" height="82" rx="18" fill="none" stroke="#D7E2EE" stroke-width="2"/><rect x="88" y="14" width="38" height="28" rx="14" fill="${accent}"/><text x="107" y="34" text-anchor="middle" class="rank inverse">${String(index + 1).padStart(2, "0")}</text>`;
}

function itemSvg(item, index, y) {
  const accent = deterministicColor(item.sku);
  const riskColor = item.status === "缺货" ? "#C9362B" : "#E75A1A";
  const trendColor = item.trend.direction === "down" ? "#18816F" : item.trend.direction === "up" ? "#E85D1F" : "#2D67B2";
  const coverLabel = item.daysCover === null ? "覆盖待算" : item.daysCover <= 0 ? "已断货" : `约 ${formatNumber(item.daysCover, 1)} 天后`;
  const stockoutLabel = item.stockoutDate ? displayDate(item.stockoutDate) : "待确认";
  const metricWidth = 120;
  const metricGap = 8;
  const metricX = 210;
  const metricsY = 148;
  return `<g transform="translate(50 ${y})">
    <rect width="980" height="238" rx="26" fill="#FFFFFF" stroke="#D7E2EE" stroke-width="2"/>
    <rect x="0" y="0" width="9" height="238" rx="5" fill="${accent}"/>
    ${thumbnailSvg(item, index, accent)}
    <text x="124" y="51" class="product-name">${escapeXml(truncate(item.name, 23))}</text>
    <text x="124" y="79" class="product-meta">${escapeXml(item.sku)} · ${escapeXml(item.country)} · ${escapeXml(truncate(item.warehouse, 18))}</text>
    <rect x="124" y="94" width="92" height="30" rx="15" fill="${riskColor}" opacity=".12"/>
    <text x="170" y="115" text-anchor="middle" class="risk" fill="${riskColor}">${escapeXml(item.status)}</text>
    <text x="234" y="115" class="cover">${escapeXml(coverLabel)}</text>
    <g transform="translate(716 24)">
      <text x="0" y="19" class="caption">预计断货</text>
      <text x="0" y="57" class="stockout-date">${escapeXml(stockoutLabel)}</text>
    </g>
    <g transform="translate(858 24)">
      <text x="98" y="19" text-anchor="end" class="caption">净建议备货</text>
      <text x="98" y="57" text-anchor="end" class="recommend">${escapeXml(formatNumber(item.netReplenishQty))}<tspan class="unit"> ${escapeXml(item.unit)}</tspan></text>
    </g>
    <g transform="translate(32 148)">
      <text x="0" y="17" class="metric-label">30 日销售趋势</text>
      <text x="0" y="42" class="trend-label" fill="${trendColor}">${escapeXml(item.trend.label)}</text>
      ${sparkline(item.trend.points, 0, 49, 164, 36, trendColor)}
    </g>
    ${metricCell("昨日出库", item.yesterdayOutboundQty === null ? "待同步" : `${formatNumber(item.yesterdayOutboundQty)} ${item.unit}`, metricX, metricsY, metricWidth)}
    ${metricCell("有效订单预占", item.yesterdayReservedQty === null ? "待同步" : `${formatNumber(item.yesterdayReservedQty)} ${item.unit}`, metricX + (metricWidth + metricGap), metricsY, metricWidth)}
    ${metricCell("可售库存", `${formatNumber(item.availableQty)} ${item.unit}`, metricX + 2 * (metricWidth + metricGap), metricsY, metricWidth)}
    ${metricCell("在途", `${formatNumber(item.inTransitQty)} ${item.unit}`, metricX + 3 * (metricWidth + metricGap), metricsY, metricWidth)}
    ${metricCell("建议备货", `${formatNumber(item.replenishQty)} ${item.unit}`, metricX + 4 * (metricWidth + metricGap), metricsY, metricWidth, true)}
    ${metricCell("委外在产", `${formatNumber(item.outsourcingInProductionQty)} ${item.unit}`, metricX + 5 * (metricWidth + metricGap), metricsY, metricWidth)}
  </g>`;
}

export function renderStockupWarningSvg(model) {
  const headerHeight = 408;
  const rowGap = 18;
  const rowHeight = 238;
  const listStart = 438;
  const footerHeight = 168;
  const height = listStart + model.items.length * (rowHeight + rowGap) + footerHeight;
  const nearest = model.nearestStockoutDate === "待确认" ? "待确认" : displayDate(model.nearestStockoutDate);
  const items = model.items.map((item, index) => itemSvg(item, index, listStart + index * (rowHeight + rowGap))).join("");
  const remaining = model.omittedItems ? `长图展示最紧急 ${model.items.length} 个，另有 ${model.omittedItems} 个请进入中台查看。` : "已展示本次全部备货预警产品。";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${REPORT_WIDTH}" height="${height}" viewBox="0 0 ${REPORT_WIDTH} ${height}">
    <defs>
      <linearGradient id="header" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0A315F"/><stop offset="1" stop-color="#16569A"/></linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="18" flood-color="#13385E" flood-opacity=".09"/></filter>
      <style>
        text { font-family: "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", sans-serif; }
        .eyebrow { font-size: 16px; font-weight: 700; letter-spacing: 4px; fill: #FFB58F; }
        .title { font-size: 48px; font-weight: 800; fill: #FFFFFF; }
        .subtitle { font-size: 20px; font-weight: 500; fill: #C9DBEE; }
        .date { font-size: 18px; font-weight: 700; fill: #D9E7F5; }
        .summary-label { font-size: 16px; font-weight: 600; fill: #6B7F95; }
        .summary-value { font-size: 34px; font-weight: 800; fill: #123A66; }
        .summary-unit { font-size: 17px; font-weight: 700; fill: #7D8FA4; }
        .rank { font-size: 18px; font-weight: 800; fill: #133E6C; }
        .rank.inverse { font-size: 14px; fill: #FFFFFF; }
        .thumb-initial { font-size: 18px; font-weight: 900; }
        .product-name { font-size: 23px; font-weight: 800; fill: #142E4E; }
        .product-meta { font-size: 15px; font-weight: 600; fill: #6D8198; }
        .risk { font-size: 14px; font-weight: 800; }
        .cover { font-size: 14px; font-weight: 700; fill: #6B7E94; }
        .caption { font-size: 14px; font-weight: 700; fill: #7A8DA3; }
        .stockout-date { font-size: 29px; font-weight: 800; fill: #C93E2B; }
        .recommend { font-size: 31px; font-weight: 900; fill: #F05A1B; }
        .unit { font-size: 15px; font-weight: 700; fill: #9A6A55; }
        .metric-label { font-size: 13px; font-weight: 700; fill: #71849A; }
        .metric-value { font-size: 18px; font-weight: 800; fill: #173E69; }
        .metric-value.accent { fill: #E65318; }
        .trend-label { font-size: 14px; font-weight: 800; }
        .footer-title { font-size: 20px; font-weight: 800; fill: #173E69; }
        .footer-copy { font-size: 15px; font-weight: 600; fill: #6F8297; }
      </style>
    </defs>
    <rect width="1080" height="${height}" fill="#EEF3F8"/>
    <rect width="1080" height="300" fill="url(#header)"/>
    <circle cx="970" cy="-4" r="172" fill="#FFFFFF" opacity=".045"/><circle cx="934" cy="30" r="112" fill="none" stroke="#FFFFFF" stroke-width="2" opacity=".09"/>
    <rect x="50" y="42" width="154" height="34" rx="17" fill="#F05A1B"/><text x="127" y="65" text-anchor="middle" class="date">${escapeXml(model.reportDate)}</text>
    <text x="50" y="113" class="eyebrow">TONGZHOU · STOCKUP SIGNAL</text>
    <text x="50" y="174" class="title">${escapeXml(model.title)}</text>
    <text x="50" y="214" class="subtitle">${escapeXml(model.subtitle)}</text>
    <text x="1030" y="62" text-anchor="end" class="date">更新 ${escapeXml(model.generatedAtLabel)}</text>
    <g transform="translate(50 248)" filter="url(#shadow)">
      <rect width="980" height="142" rx="26" fill="#FFFFFF"/>
      <g transform="translate(30 29)"><text class="summary-label">需备货 SKU</text><text y="54" class="summary-value">${formatNumber(model.totalItems)}<tspan class="summary-unit"> 个</tspan></text></g>
      <line x1="244" y1="28" x2="244" y2="114" stroke="#E1E8F0"/>
      <g transform="translate(276 29)"><text class="summary-label">7 日内紧急</text><text y="54" class="summary-value" fill="#C9362B">${formatNumber(model.urgentItems)}<tspan class="summary-unit"> 个</tspan></text></g>
      <line x1="488" y1="28" x2="488" y2="114" stroke="#E1E8F0"/>
      <g transform="translate(520 29)"><text class="summary-label">净建议备货</text><text y="54" class="summary-value">${formatNumber(model.totalNetReplenishQty)}<tspan class="summary-unit"> 件</tspan></text></g>
      <line x1="734" y1="28" x2="734" y2="114" stroke="#E1E8F0"/>
      <g transform="translate(766 29)"><text class="summary-label">最近预计断货</text><text y="54" class="summary-value" fill="#E7551B">${escapeXml(nearest)}</text></g>
    </g>
    ${items}
    <g transform="translate(50 ${listStart + model.items.length * (rowHeight + rowGap) + 24})">
      <rect width="980" height="112" rx="24" fill="#E6EEF7"/>
      <circle cx="44" cy="42" r="18" fill="#1557A0"/><text x="44" y="49" text-anchor="middle" font-size="20" font-weight="900" fill="#fff">i</text>
      <text x="76" y="39" class="footer-title">${escapeXml(remaining)}</text>
      <text x="76" y="70" class="footer-copy">建议量已扣减委外在产；最终下单前请进入中台核对仓库、采购周期与在途计划。</text>
      <text x="956" y="88" text-anchor="end" class="footer-copy">同舟供应链中心 · 数据仅供内部决策</text>
    </g>
  </svg>`;
}

export function renderStockupWarningPng(payload, options = {}) {
  const model = options.model || buildStockupWarningReportModel(payload, options);
  const svg = renderStockupWarningSvg(model);
  let lastBuffer = null;
  for (const width of [REPORT_WIDTH, 900, 760]) {
    const renderer = new Resvg(svg, {
      background: "#EEF3F8",
      fitTo: { mode: "width", value: width },
      font: {
        loadSystemFonts: options.loadSystemFonts !== false,
        defaultFontFamily: options.defaultFontFamily || "Noto Sans CJK SC",
        fontFiles: Array.isArray(options.fontFiles) ? options.fontFiles : bundledFontFiles,
      },
    });
    lastBuffer = Buffer.from(renderer.render().asPng());
    if (lastBuffer.length <= WECOM_IMAGE_LIMIT) return { buffer: lastBuffer, model, svg, width };
  }
  const error = new Error(`备货预警长图 ${Math.ceil((lastBuffer?.length || 0) / 1024)}KB，超过企业微信 2MB 限制。`);
  error.code = "WECOM_IMAGE_TOO_LARGE";
  throw error;
}

export async function renderStockupWarningPngWithImages(payload, options = {}) {
  const model = options.model || buildStockupWarningReportModel(payload, options);
  const hydratedModel = await hydrateStockupWarningThumbnails(model, options);
  return renderStockupWarningPng(payload, { ...options, model: hydratedModel });
}

export function buildWecomImageBody(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("备货预警图片为空。");
  if (buffer.length > WECOM_IMAGE_LIMIT) throw new Error("备货预警图片超过企业微信 2MB 限制。");
  return {
    msgtype: "image",
    image: {
      base64: buffer.toString("base64"),
      md5: createHash("md5").update(buffer).digest("hex"),
    },
  };
}

export function buildStockupWarningLinkMarkdown(model, options = {}) {
  const linkUrl = text(options.linkUrl, "");
  const lines = [
    "### 备货预警日报已生成",
    `本次共 **${formatNumber(model.totalItems)} 个 SKU** 需要关注，其中 **${formatNumber(model.urgentItems)} 个** 预计 7 日内断货，净建议备货 **${formatNumber(model.totalNetReplenishQty)} 件**。`,
    text(options.extraText, ""),
    linkUrl ? `[进入供应链中台查看明细与处理建议](${linkUrl})` : "请进入供应链中台查看明细与处理建议。",
    `<font color=\"comment\">数据更新时间：${model.generatedAtLabel}；建议量已扣减委外在产。</font>`,
  ];
  return lines.filter(Boolean).join("\n\n");
}

export const stockupWarningReportConstants = Object.freeze({
  reportWidth: REPORT_WIDTH,
  maxItems: MAX_REPORT_ITEMS,
  wecomImageLimit: WECOM_IMAGE_LIMIT,
  thumbnailMaxBytes: THUMBNAIL_MAX_BYTES,
});
