import assert from "node:assert/strict";
import {
  applyShopDirectoryProfile,
  buildShopDirectory,
  normalizeShopDirectorySettings,
  normalizeShopUrl,
  resolveShopScope,
  shopDirectoryKey,
} from "../server/shop-directory.js";

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
    shopAssignments: {
      [indonesiaKey]: {
        projectGroup: "东南亚项目",
        ownerId: "operator-1",
        ownerName: "运营一号",
        shopUrl: "https://seller.example.com/shop/id-1",
      },
    },
    projectGroups: ["东南亚项目"],
    projectGroupTeams: [{ name: "东南亚项目", leaderIds: ["leader-1"], memberIds: ["operator-1"] }],
  },
});

assert.equal(directory.shops.length, 2, "same shop name in different countries must remain separate");
assert.equal(directory.matchedShopCount, 2);
assert.equal(directory.byKey.get(indonesiaKey)?.displayName, "小王 · 印尼一店");
assert.equal(directory.byKey.get(indonesiaKey)?.aliasSource, "miaoshou");
assert.equal(directory.byKey.get(indonesiaKey)?.projectGroup, "东南亚项目");
assert.equal(directory.byKey.get(indonesiaKey)?.projectGroupSource, "manual");
assert.equal(directory.byKey.get(indonesiaKey)?.ownerName, "运营一号");
assert.equal(directory.byKey.get(indonesiaKey)?.shopUrl, "https://seller.example.com/shop/id-1");

const enriched = applyShopDirectoryProfile(orders[0], directory);
assert.equal(enriched.shopName, "小王 · 印尼一店");
assert.equal(enriched.projectGroup, "东南亚项目");
assert.equal(enriched.miaoshouShopId, "ID-1");
assert.equal(enriched.shopOwnerId, "operator-1");
assert.equal(enriched.shopOwnerName, "运营一号");
assert.equal(enriched.shopUrl, "https://seller.example.com/shop/id-1");

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
  shopAssignments: {
    [indonesiaKey]: {
      projectGroup: "东南亚项目",
      ownerId: "operator-1",
      ownerName: "运营一号",
      shopUrl: "https://seller.example.com/shop/id-1",
      updatedBy: "管理员",
    },
  },
  projectGroups: ["东南亚项目", "东南亚项目", ""],
  projectGroupTeams: [
    { name: "东南亚项目", leaderIds: ["leader-1", "leader-1", ""], memberIds: ["operator-1"] },
    { name: "", leaderIds: ["ignored"] },
  ],
});
assert.deepEqual(normalized.projectGroups, ["东南亚项目"]);
assert.equal(Object.keys(normalized.shopAssignments).length, 1);
assert.deepEqual(normalized.projectGroupTeams, [{ name: "东南亚项目", leaderIds: ["leader-1"], memberIds: ["operator-1"], inheritUnassignedShops: false, updatedAt: "", updatedBy: "" }]);

const leaderScope = resolveShopScope({ user: { id: "leader-1", username: "leader" }, directory });
assert.equal(leaderScope.mode, "leader");
assert.deepEqual(leaderScope.leaderGroups, ["东南亚项目"]);
assert.ok(leaderScope.visibleShopKeys.has(indonesiaKey), "项目组长应能管理本组店铺");
const malaysiaKey = shopDirectoryKey(orders[2]);
assert.equal(leaderScope.visibleShopKeys.has(malaysiaKey), false, "项目组长不能管理其他项目组店铺");

const memberScope = resolveShopScope({ user: { id: "operator-1" }, directory });
assert.equal(memberScope.mode, "member");
assert.ok(memberScope.visibleShopKeys.has(indonesiaKey), "负责人应能访问自己负责的店铺");

const adminScope = resolveShopScope({ user: { id: "admin" }, directory, canManageAll: true });
assert.equal(adminScope.mode, "all");
assert.equal(adminScope.visibleShopKeys, null, "管理员不应被店铺范围截断");

assert.equal(normalizeShopUrl("https://seller.example.com/store/1"), "https://seller.example.com/store/1");
assert.equal(normalizeShopUrl("http://seller.example.com/store/1"), "http://seller.example.com/store/1");
assert.equal(normalizeShopUrl("javascript:alert(1)"), "", "店铺链接只允许 http/https");

console.log("shop directory tests passed");
