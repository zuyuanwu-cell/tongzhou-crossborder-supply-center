import assert from "node:assert/strict";
import {
  createMiaoshouCategoryService,
  normalizeAiPlatformAttributes,
  normalizeTikTokCategoryMetadata,
  normalizeTikTokCategoryTree,
  searchTikTokCategories,
  validateTikTokReadiness,
} from "../server/miaoshou-listing-platform.js";

const treeResponse = {
  data: {
    cateTree: {
      beauty: {
        cid: 1,
        name: "Beauty & Personal Care",
        nameChinese: "美妆个护",
        isLastLevel: "false",
        children: {
          hair: { cid: 2, fid: 1, name: "Hair Care", nameChinese: "护发用品", isLastLevel: "true", children: {} },
          removal: { cid: 3, fid: 1, name: "Hair Removal", nameChinese: "脱毛用品", isLastLevel: "true", children: {} },
        },
      },
    },
  },
};
const tree = normalizeTikTokCategoryTree(treeResponse);
assert.equal(tree.roots.length, 1);
assert.equal(tree.categories.length, 3);
assert.equal(tree.categories.find((item) => item.cid === "3")?.pathChinese, "美妆个护 / 脱毛用品");
assert.equal(searchTikTokCategories(tree.categories, "脱毛", 10)[0]?.cid, "3");

const metadataResponse = {
  data: {
    categoryMetadata: {
      categoryConfig: {
        packageDimensionIsRequired: true,
        manufacturerIsRequired: true,
        productCertifications: [{ id: 99, name: "化妆品资质", isRequired: true }],
      },
      categoryProductAttrList: [{
        attrId: 10,
        name: "品牌",
        isMandatory: true,
        isCustomized: false,
        values: [{ id: 20, name: "SJU" }],
      }],
    },
  },
};
const metadata = normalizeTikTokCategoryMetadata(metadataResponse);
assert.equal(metadata.requirements.packageDimensions, true);
assert.equal(metadata.productAttributes[0].mandatory, true);

const aiAttributes = normalizeAiPlatformAttributes([
  { attrId: "10", valueId: "20", valueName: "SJU" },
  { attrId: "999", valueId: "1" },
], metadata);
assert.deepEqual(aiAttributes.selected, [{ attrId: "10", name: "品牌", valueId: "20", valueName: "SJU", customValue: "" }]);
assert.equal(aiAttributes.rejected.length, 1, "AI 返回的类目外属性必须拒绝写入");

const incomplete = validateTikTokReadiness({ platform: "tiktok", shopId: "", categoryId: "3", platformAttributes: [] }, metadata);
assert.equal(incomplete.ready, false);
assert.ok(incomplete.blocking.some((message) => message.includes("店铺")));
assert.ok(incomplete.blocking.some((message) => message.includes("品牌")));

const complete = validateTikTokReadiness({
  platform: "tiktok",
  shopId: "1001",
  categoryId: "3",
  packageLength: 10,
  packageWidth: 8,
  packageHeight: 4,
  platformAttributes: [{ attrId: "10", valueId: "20" }],
}, metadata);
assert.equal(complete.ready, true);
assert.ok(complete.warnings.some((message) => message.includes("化妆品资质")));

let treeCalls = 0;
let metadataCalls = 0;
const service = createMiaoshouCategoryService({
  connector: {
    async getTikTokCategoryTree(input) {
      treeCalls += 1;
      assert.equal(input.site, "ID");
      return treeResponse;
    },
    async getTikTokCategoryMetadata(input) {
      metadataCalls += 1;
      assert.deepEqual(input, { cid: 3, shopIds: [1001] });
      return metadataResponse;
    },
  },
});
assert.equal((await service.search("ID", "脱毛"))[0]?.cid, "3");
await service.search("ID", "护发");
assert.equal(treeCalls, 1, "类目树应使用内存缓存，避免每次打开详情都等待妙手接口");
await service.getMetadata({ site: "ID", cid: "3", shopId: "1001" });
await service.getMetadata({ site: "ID", cid: "3", shopId: "1001" });
assert.equal(metadataCalls, 1, "同店铺同类目元数据应复用缓存");

console.log(JSON.stringify({ ok: true, categories: tree.categories.length, treeCalls, metadataCalls }, null, 2));
