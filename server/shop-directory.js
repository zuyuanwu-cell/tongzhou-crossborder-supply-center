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

// 自动匹配失败时给出建议：同平台、同站点、名称互相包含的唯一店铺。
function suggestMiaoshouShop(profile, shops) {
  const name = normalizedToken(profile.rawName);
  if (!name) return null;
  const candidates = shops.filter((shop) => {
    if (normalizedPlatform(shop.platform) !== normalizedPlatform(profile.platform)) return false;
    const shopSite = siteForCountry(shop.site || shop.siteName);
    const profileSite = siteForCountry(profile.country);
    if (shopSite && profileSite && shopSite !== profileSite) return false;
    return miaoshouNames(shop).some((candidate) => candidate.includes(name) || name.includes(candidate));
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function dominantValue(counts) {
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"))[0]?.[0] || "";
}

function uniqueIdList(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => text(item)).filter(Boolean))];
}

export function normalizeShopUrl(value) {
  const candidate = text(value);
  if (!candidate) return "";
  try {
    const parsed = new URL(candidate);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function normalizeProjectGroupTeams(input) {
  const seen = new Set();
  return (Array.isArray(input) ? input : []).map((team) => {
    const name = text(team?.name);
    if (!name || seen.has(name)) return null;
    seen.add(name);
    const leaderIds = uniqueIdList(team?.leaderIds);
    const leaderIdSet = new Set(leaderIds);
    return {
      name,
      leaderIds,
      memberIds: uniqueIdList(team?.memberIds).filter((id) => !leaderIdSet.has(id)),
      inheritUnassignedShops: team?.inheritUnassignedShops === true,
      updatedAt: text(team?.updatedAt),
      updatedBy: text(team?.updatedBy),
    };
  }).filter(Boolean);
}

export function normalizeShopDirectorySettings(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const assignments = {};
  for (const [key, value] of Object.entries(source.shopAssignments || {})) {
    const normalizedKey = text(key);
    if (!normalizedKey || !value || typeof value !== "object") continue;
    const assignment = {
      projectGroup: text(value.projectGroup),
      ownerId: text(value.ownerId),
      ownerName: text(value.ownerName),
      viewerIds: uniqueIdList(value.viewerIds),
      viewerNames: uniqueIdList(value.viewerNames),
      shopUrl: normalizeShopUrl(value.shopUrl),
      updatedAt: text(value.updatedAt),
      updatedBy: text(value.updatedBy),
    };
    if (!assignment.projectGroup && !assignment.ownerId && !assignment.ownerName
      && !assignment.viewerIds.length && !assignment.viewerNames.length && !assignment.shopUrl) continue;
    assignments[normalizedKey] = assignment;
  }
  const bindings = {};
  for (const [key, value] of Object.entries(source.shopMiaoshouBindings || {})) {
    const normalizedKey = text(key);
    if (!normalizedKey || !value || typeof value !== "object") continue;
    // miaoshouShopId 为空表示管理员明确「不关联妙手」。
    bindings[normalizedKey] = {
      miaoshouShopId: text(value.miaoshouShopId),
      updatedAt: text(value.updatedAt),
      updatedBy: text(value.updatedBy),
    };
  }
  return {
    updatedAt: text(source.updatedAt),
    shopAliases: source.shopAliases && typeof source.shopAliases === "object" ? source.shopAliases : {},
    shopAssignments: assignments,
    shopMiaoshouBindings: bindings,
    projectGroups: [...new Set((Array.isArray(source.projectGroups) ? source.projectGroups : []).map(text).filter(Boolean))],
    projectGroupTeams: normalizeProjectGroupTeams(source.projectGroupTeams),
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

  const miaoshouById = new Map(activeMiaoshouShops.map((shop) => [text(shop.shopId), shop]));
  const publicProfiles = [...profiles.values()].map((profile) => {
    // 人工绑定优先于名称自动匹配；绑定的妙手店铺已失效时退回自动匹配并提示。
    const binding = normalizedSettings.shopMiaoshouBindings[profile.key] || null;
    const boundShop = binding?.miaoshouShopId ? miaoshouById.get(binding.miaoshouShopId) || null : null;
    const explicitlyUnbound = Boolean(binding && !binding.miaoshouShopId);
    const autoMatchedShop = matchingMiaoshouShop(profile, activeMiaoshouShops);
    const matchedShop = explicitlyUnbound ? null : boundShop || autoMatchedShop;
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
      ownerId: text(assignment?.ownerId),
      ownerName: text(assignment?.ownerName),
      viewerIds: uniqueIdList(assignment?.viewerIds),
      viewerNames: uniqueIdList(assignment?.viewerNames),
      shopUrl: normalizeShopUrl(assignment?.shopUrl),
      miaoshouShopId: text(matchedShop?.shopId),
      miaoshouShopName: platformShopName,
      miaoshouAlias,
      miaoshouMatched: Boolean(matchedShop),
      miaoshouMatchSource: explicitlyUnbound ? "manual_none" : boundShop ? "manual" : autoMatchedShop ? "auto" : "none",
      miaoshouBindingStale: Boolean(binding?.miaoshouShopId && !boundShop),
      miaoshouSuggestedShopId: !matchedShop ? text(suggestMiaoshouShop(profile, activeMiaoshouShops)?.shopId) : "",
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
    projectGroupTeams: normalizedSettings.projectGroupTeams,
    miaoshouShopCount: activeMiaoshouShops.length,
    matchedShopCount: publicProfiles.filter((profile) => profile.miaoshouMatched).length,
    unmatchedShopCount: publicProfiles.filter((profile) => !profile.miaoshouMatched).length,
    ownerCount: new Set(publicProfiles.map((profile) => profile.ownerId).filter(Boolean)).size,
    unassignedOwnerCount: publicProfiles.filter((profile) => !profile.ownerId).length,
    miaoshouShops: activeMiaoshouShops.map((shop) => ({
      shopId: text(shop.shopId),
      platform: text(shop.platform),
      site: text(shop.site || shop.siteName),
      name: text(shop.shopNick) || text(shop.platformShopName) || text(shop.shopId),
      platformShopName: text(shop.platformShopName),
    })),
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
    shopOwnerId: profile?.ownerId || "",
    shopOwnerName: profile?.ownerName || "",
    shopViewerIds: profile?.viewerIds || [],
    shopViewerNames: profile?.viewerNames || [],
    shopUrl: profile?.shopUrl || "",
    miaoshouShopId: profile?.miaoshouShopId || "",
    miaoshouMatched: Boolean(profile?.miaoshouMatched),
  };
}

function identityTokens(user = {}) {
  return [user.id, user.username, user.displayName]
    .map((value) => text(value).toLowerCase())
    .filter(Boolean);
}

export function resolveShopScope({ user = {}, directory, canManageAll = false } = {}) {
  const teams = normalizeProjectGroupTeams(directory?.projectGroupTeams);
  const tokens = new Set(identityTokens(user));
  const teamsOfUser = tokens.size
    ? teams.filter((team) => [...team.leaderIds, ...team.memberIds].some((id) => tokens.has(text(id).toLowerCase())))
    : [];

  if (canManageAll) {
    return {
      mode: "all",
      visibleShopKeys: null,
      teams: teamsOfUser.map((team) => team.name),
      leaderGroups: [],
      ownedShopCount: 0,
      sharedShopCount: 0,
      visibleShopCount: Array.isArray(directory?.shops) ? directory.shops.length : 0,
    };
  }

  const leaderGroups = teamsOfUser
    .filter((team) => team.leaderIds.some((id) => tokens.has(text(id).toLowerCase())))
    .map((team) => team.name);
  const visible = new Set();
  let ownedShopCount = 0;
  let sharedShopCount = 0;
  for (const shop of Array.isArray(directory?.shops) ? directory.shops : []) {
    const ownerTokens = [shop.ownerId, shop.ownerName].map((value) => text(value).toLowerCase()).filter(Boolean);
    const viewerTokens = [...(shop.viewerIds || []), ...(shop.viewerNames || [])]
      .map((value) => text(value).toLowerCase())
      .filter(Boolean);
    const ownedByUser = ownerTokens.some((token) => tokens.has(token));
    const sharedWithUser = viewerTokens.some((token) => tokens.has(token));
    const inheritedByTeam = teamsOfUser.some((team) => team.inheritUnassignedShops
      && team.name === text(shop.projectGroup)
      && !text(shop.ownerId)
      && !(shop.viewerIds || []).length
      && !(shop.viewerNames || []).length);
    if (ownedByUser) ownedShopCount += 1;
    if (sharedWithUser) sharedShopCount += 1;
    if (ownedByUser || sharedWithUser || inheritedByTeam || leaderGroups.includes(text(shop.projectGroup))) visible.add(shop.key);
  }

  return {
    mode: leaderGroups.length ? "leader" : visible.size ? "assigned" : "unassigned",
    visibleShopKeys: visible,
    teams: teamsOfUser.map((team) => team.name),
    leaderGroups,
    ownedShopCount,
    sharedShopCount,
    visibleShopCount: visible.size,
  };
}
