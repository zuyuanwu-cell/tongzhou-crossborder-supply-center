import assert from "node:assert/strict";
import { applyShopDirectoryProfile, buildShopDirectory, normalizeShopDirectorySettings, shopDirectoryKey } from "../server/shop-directory.js";

const orders = [
  { country: "印度尼西亚", platform: "TikTok", shopName: "Beauty Store", warehouseId: "id", projectGroup: "旧项目", orderId: "1" },
  { country: "印度尼西亚", platform: "TikTok", shopName: "Beauty Store", warehouseId: "id", projectGroup: "旧项目", orderId: "2" },
  { country: "马来西亚", platform: "TikTok", shopName: "Beauty Store", warehouseId: "my", projectGroup: "马来项目", orderId: "3" },
];
const indonesiaKey = shopDirectoryKey(orders[0]);
const directory = buildShopDirectory({
  orders,
  miaoshouShops: [
    { shopId: "ID-1", platform: "tiktok", site: "ID", platformShopName: "Beauty Store", shopNick: "小王 · 印尼一店" },
    { shopId: "MY-1", platform: "tiktok", site: "MY", platformShopName: "Beauty Store", shopNick: "小李 · 马来店" },
  ],
  settings: {
    shopAssignments: { [indonesiaKey]: { projectGroup: "东南亚项目" } },
    projectGroups: ["东南亚项目"],
  },
});

assert.equal(directory.shops.length, 2, "same shop name in different countries must remain separate");
assert.equal(directory.matchedShopCount, 2);
assert.equal(directory.byKey.get(indonesiaKey)?.displayName, "小王 · 印尼一店");
assert.equal(directory.byKey.get(indonesiaKey)?.aliasSource, "miaoshou");
assert.equal(directory.byKey.get(indonesiaKey)?.projectGroup, "东南亚项目");
assert.equal(directory.byKey.get(indonesiaKey)?.projectGroupSource, "manual");

const enriched = applyShopDirectoryProfile(orders[0], directory);
assert.equal(enriched.shopName, "小王 · 印尼一店");
assert.equal(enriched.projectGroup, "东南亚项目");
assert.equal(enriched.miaoshouShopId, "ID-1");

const manualAliasDirectory = buildShopDirectory({
  orders: [orders[0]],
  miaoshouShops: [{ shopId: "ID-1", platform: "tiktok", site: "ID", platformShopName: "Beauty Store", shopNick: "妙手别称" }],
  settings: { shopAliases: { "Beauty Store": "人工别称" } },
});
assert.equal(manualAliasDirectory.shops[0].displayName, "人工别称", "existing manual aliases must remain highest priority");

const ambiguousDirectory = buildShopDirectory({
  orders: [orders[0]],
  miaoshouShops: [
    { shopId: "ID-1", platform: "tiktok", site: "ID", platformShopName: "Beauty Store", shopNick: "A" },
    { shopId: "ID-2", platform: "tiktok", site: "ID", platformShopName: "Beauty Store", shopNick: "B" },
  ],
});
assert.equal(ambiguousDirectory.shops[0].miaoshouMatched, false, "ambiguous automatic matches must fail closed");

const normalized = normalizeShopDirectorySettings({
  shopAssignments: { [indonesiaKey]: { projectGroup: "东南亚项目", updatedBy: "管理员" } },
  projectGroups: ["东南亚项目", "东南亚项目", ""],
});
assert.deepEqual(normalized.projectGroups, ["东南亚项目"]);
assert.equal(Object.keys(normalized.shopAssignments).length, 1);

console.log("shop directory tests passed");
