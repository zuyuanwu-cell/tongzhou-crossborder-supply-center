"use strict";

// 平台注册表。新增平台（如 TikTok Shop）时：
// 1. 新建 core/platforms/<id>/index.js，导出与 shopee 相同的字段
//    （id、name、SELLER_ORIGINS、DISCOVERY_PAGES、API_PATTERN、matchStore、originFor、checkPage、blankTemplate）；
// 2. 在下面的列表里登记。采集调度、校准、回写中台都无需改动。

const shopee = require("./shopee");

const PLATFORMS = [shopee];

function getPlatform(id) {
  return PLATFORMS.find((platform) => platform.id === id) || null;
}

function guessPlatform(store) {
  return PLATFORMS.find((platform) => platform.matchStore(store)) || null;
}

function describePlatforms() {
  return PLATFORMS.map((platform) => ({
    id: platform.id,
    name: platform.name,
    sellerCenters: platform.SELLER_ORIGINS,
    discoveryPages: platform.DISCOVERY_PAGES,
    shopIdHint: platform.shopIdHint || "",
  }));
}

module.exports = { PLATFORMS, getPlatform, guessPlatform, describePlatforms };
