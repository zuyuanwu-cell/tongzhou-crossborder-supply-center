function text(value) {
  return String(value ?? "").trim();
}

function normalizedToken(value) {
  return text(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}_]+/gu, "");
}

function normalizedPlatform(value) {
  const token = normalizedToken(value);
  if (token.includes("tiktok")) return "tiktok";
  if (token.includes("shopee")) return "shopee";
  if (token.includes("ozon")) return "ozon";
  if (token.includes("lazada")) return "lazada";
  return token || "unknown";
}

function siteForCountry(value) {
  const token = normalizedToken(value);
  if (["id", "印度尼西亚", "印尼"].some((candidate) => token === normalizedToken(candidate))) return "ID";
  if (["my", "马来西亚", "马来"].some((candidate) => token === normalizedToken(candidate))) return "MY";
  if (["vn", "越南"].some((candidate) => token === normalizedToken(candidate))) return "VN";
  if (["ru", "俄罗斯", "俄罗斯联邦"].some((candidate) => token === normalizedToken(candidate))) return "RU";
  if (["ph", "菲律宾"].some((candidate) => token === normalizedToken(candidate))) return "PH";
  if (["th", "泰国"].some((candidate) => token === normalizedToken(candidate))) return "TH";
  return text(value).toUpperCase();
}

export function shopDirectoryKey(input = {}) {
  const rawName = text(input.rawShopName || input.shopName || input.shopCode);
  if (!rawName) return "";
  return [siteForCountry(input.country || input.site), normalizedPlatform(input.platform), normalizedToken(rawName)].join("|");
}

function miaoshouNames(shop) {
  return [shop.shopNick, shop.platformShopName]
    .map(normalizedToken)
    .filter(Boolean);
}

function matchingMiaoshouShop(profile, shops) {
  const name = normalizedToken(profile.rawName);
  if (!name) return null;
  const candidates = shops.filter((shop) => {
    if (normalizedPlatform(shop.platform) !== normalizedPlatform(profile.platform)) return false;
    const shopSite = siteForCountry(shop.site || shop.siteName);
    const profileSite = siteForCountry(profile.country);
    if (shopSite && profileSite && shopSite !== profileSite) return false;
    return miaoshouNames(shop).includes(name);
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function dominantValue(counts) {
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"))[0]?.[0] || "";
}

export function normalizeShopDirectorySettings(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const assignments = {};
  for (const [key, value] of Object.entries(source.shopAssignments || {})) {
    const normalizedKey = text(key);
    if (!normalizedKey || !value || typeof value !== "object") continue;
    assignments[normalizedKey] = {
      projectGroup: text(value.projectGroup),
      updatedAt: text(value.updatedAt),
      updatedBy: text(value.updatedBy),
    };
  }
  return {
    updatedAt: text(source.updatedAt),
    shopAliases: source.shopAliases && typeof source.shopAliases === "object" ? source.shopAliases : {},
    shopAssignments: assignments,
    projectGroups: [...new Set((Array.isArray(source.projectGroups) ? source.projectGroups : []).map(text).filter(Boolean))],
  };
}

export function buildShopDirectory({ orders = [], miaoshouShops = [], settings = {} } = {}) {
  const normalizedSettings = normalizeShopDirectorySettings(settings);
  const activeMiaoshouShops = (Array.isArray(miaoshouShops) ? miaoshouShops : []).filter((shop) => text(shop.shopId));
  const profiles = new Map();
  for (const order of Array.isArray(orders) ? orders : []) {
    const rawName = text(order.shopName || order.shopCode);
    const key = shopDirectoryKey({ ...order, rawShopName: rawName });
    if (!key) continue;
    const current = profiles.get(key) || {
      key,
      rawName,
      platform: text(order.platform),
      country: text(order.country),
      warehouseIds: new Set(),
      projectGroupCounts: new Map(),
      orderLines: 0,
      latestOrderAt: "",
    };
    current.orderLines += 1;
    if (text(order.warehouseId)) current.warehouseIds.add(text(order.warehouseId));
    const inferredGroup = text(order.projectGroup);
    if (inferredGroup) current.projectGroupCounts.set(inferredGroup, (current.projectGroupCounts.get(inferredGroup) || 0) + 1);
    const orderAt = text(order.shippedAt || order.createdAt);
    if (orderAt > current.latestOrderAt) current.latestOrderAt = orderAt;
    profiles.set(key, current);
  }

  const publicProfiles = [...profiles.values()].map((profile) => {
    const matchedShop = matchingMiaoshouShop(profile, activeMiaoshouShops);
    const manualAlias = text(normalizedSettings.shopAliases?.[profile.rawName]);
    const miaoshouAlias = text(matchedShop?.shopNick);
    const platformShopName = text(matchedShop?.platformShopName);
    const assignment = normalizedSettings.shopAssignments[profile.key] || null;
    const inferredProjectGroup = dominantValue(profile.projectGroupCounts);
    const projectGroup = text(assignment?.projectGroup) || inferredProjectGroup;
    const alias = manualAlias || miaoshouAlias;
    return {
      key: profile.key,
      rawName: profile.rawName,
      displayName: alias || platformShopName || profile.rawName,
      alias,
      aliasSource: manualAlias ? "manual" : miaoshouAlias ? "miaoshou" : "wms",
      platform: profile.platform,
      country: profile.country,
      warehouseIds: [...profile.warehouseIds],
      orderLines: profile.orderLines,
      latestOrderAt: profile.latestOrderAt,
      projectGroup,
      projectGroupSource: assignment?.projectGroup ? "manual" : inferredProjectGroup ? "inferred" : "unassigned",
      miaoshouShopId: text(matchedShop?.shopId),
      miaoshouShopName: platformShopName,
      miaoshouAlias,
      miaoshouMatched: Boolean(matchedShop),
    };
  }).sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-CN"));

  const byKey = new Map(publicProfiles.map((profile) => [profile.key, profile]));
  const projectGroups = [...new Set([
    ...normalizedSettings.projectGroups,
    ...publicProfiles.map((profile) => profile.projectGroup),
  ].filter(Boolean))].sort((left, right) => left.localeCompare(right, "zh-CN"));

  return {
    shops: publicProfiles,
    byKey,
    projectGroups,
    miaoshouShopCount: activeMiaoshouShops.length,
    matchedShopCount: publicProfiles.filter((profile) => profile.miaoshouMatched).length,
    unmatchedShopCount: publicProfiles.filter((profile) => !profile.miaoshouMatched).length,
  };
}

export function applyShopDirectoryProfile(order = {}, directory) {
  const rawName = text(order.rawShopName || order.shopName || order.shopCode);
  const key = shopDirectoryKey({ ...order, rawShopName: rawName });
  const profile = directory?.byKey?.get(key);
  return {
    ...order,
    shopKey: key,
    rawShopName: rawName,
    shopName: profile?.displayName || rawName,
    shopAlias: profile?.alias || "",
    projectGroup: profile?.projectGroup || text(order.projectGroup),
    miaoshouShopId: profile?.miaoshouShopId || "",
    miaoshouMatched: Boolean(profile?.miaoshouMatched),
  };
}
