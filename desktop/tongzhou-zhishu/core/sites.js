"use strict";

// 站点（国家）基础信息：时区、币种、中文名。与中台 server/miaoshou-performance.js 的
// SITE_UTC_OFFSET_HOURS 保持一致，保证「按站点当地自然日」切分的口径和中台相同。
const SITES = Object.freeze({
  ID: { name: "印度尼西亚", offset: 7, currency: "IDR" },
  VN: { name: "越南", offset: 7, currency: "VND" },
  TH: { name: "泰国", offset: 7, currency: "THB" },
  MY: { name: "马来西亚", offset: 8, currency: "MYR" },
  SG: { name: "新加坡", offset: 8, currency: "SGD" },
  PH: { name: "菲律宾", offset: 8, currency: "PHP" },
  TW: { name: "台湾", offset: 8, currency: "TWD" },
  CN: { name: "中国", offset: 8, currency: "CNY" },
  RU: { name: "俄罗斯", offset: 3, currency: "RUB" },
  BR: { name: "巴西", offset: -3, currency: "BRL" },
  MX: { name: "墨西哥", offset: -6, currency: "MXN" },
  CO: { name: "哥伦比亚", offset: -5, currency: "COP" },
  CL: { name: "智利", offset: -4, currency: "CLP" },
});

const ALIASES = Object.freeze({
  印度尼西亚: "ID", 印尼: "ID", 越南: "VN", 泰国: "TH", 马来西亚: "MY", 马来: "MY",
  新加坡: "SG", 菲律宾: "PH", 台湾: "TW", 中国: "CN", 俄罗斯: "RU", 巴西: "BR",
  墨西哥: "MX", 哥伦比亚: "CO", 智利: "CL",
});

function siteCode(value) {
  const raw = String(value || "").trim();
  if (/^[A-Za-z]{2}$/.test(raw) && SITES[raw.toUpperCase()]) return raw.toUpperCase();
  return ALIASES[raw] || "";
}

function siteInfo(value) {
  const code = siteCode(value);
  return code ? { code, ...SITES[code] } : null;
}

function isDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function addDays(date, days) {
  const time = Date.parse(`${date}T00:00:00Z`) + days * 86400000;
  return new Date(time).toISOString().slice(0, 10);
}

/** 站点当地「今天」。 */
function siteToday(site, now = Date.now()) {
  const offset = siteInfo(site)?.offset ?? 8;
  return new Date(now + offset * 3600000).toISOString().slice(0, 10);
}

/** 站点当地自然日的起止 Unix 秒：[start, end]，end 为当天 23:59:59。 */
function dayRange(date, site) {
  const offset = siteInfo(site)?.offset ?? 8;
  const start = Math.round(Date.parse(`${date}T00:00:00Z`) / 1000) - offset * 3600;
  return { start, end: start + 86399 };
}

function dateList(from, to, max = 62) {
  if (!isDate(from) || !isDate(to) || from > to) return [];
  const list = [];
  for (let day = from; day <= to && list.length < max; day = addDays(day, 1)) list.push(day);
  return list;
}

module.exports = { SITES, siteCode, siteInfo, isDate, addDays, siteToday, dayRange, dateList };
