import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildCommonCollectBoxPayload,
  directHttpsUrls,
  initMiaoshouListingService,
  localizeListingWarning,
  parseListingAiOutput,
  parseListingImagePlan,
  validateListingDraft,
} from "../server/miaoshou-listing.js";

assert.deepEqual(
  directHttpsUrls(["https://cdn.example/a.jpg", "http://bad.example/b.jpg", "/api/private/file", "https://cdn.example/a.jpg"]),
  ["https://cdn.example/a.jpg"],
);

const parsed = parseListingAiOutput(`\`\`\`json
{
  "title": "Krim Perawatan Rambut SJU",
  "description": "Membantu merawat rambut agar terasa lebih lembut.",
  "keywords": ["perawatan rambut", "hair cream"],
  "sellingPoints": ["Mudah digunakan"],
  "categoryHint": "Perawatan Rambut",
  "warnings": ["Periksa klaim sebelum diterbitkan"]
}
\`\`\``);
assert.equal(parsed.title, "Krim Perawatan Rambut SJU");
assert.deepEqual(parsed.keywords, ["perawatan rambut", "hair cream"]);
assert.match(localizeListingWarning("Produk mengandung Thioglycolic Acid dan wajib uji tes patch"), /巯基乙酸/);
assert.match(parsed.warnings[0], /原提示不是中文/);

const imageBriefs = parseListingImagePlan(JSON.stringify({
  images: [
    { slot: "main", title: "白底主图", purpose: "展示商品", prompt: "保持产品包装一致的白底商品摄影", negativePrompt: "错误文字" },
    { slot: "scene", title: "使用场景", purpose: "展示使用氛围", prompt: "浴室场景中的产品静物摄影", negativePrompt: "医疗宣称" },
  ],
}));
assert.equal(imageBriefs.length, 2);
assert.equal(imageBriefs[0].slot, "main");
assert.equal(imageBriefs[0].imageUrl, "");

const baseDraft = {
  sku: "TZKJ-SJU005",
  title: parsed.title,
  description: parsed.description,
  keywords: parsed.keywords,
  sellingPoints: parsed.sellingPoints,
  categoryHint: parsed.categoryHint,
  warnings: parsed.warnings,
  platform: "tiktok",
  site: "ID",
  language: "id",
  price: 9.9,
  stock: 100,
  weight: null,
  packageLength: null,
  packageWidth: null,
  packageHeight: null,
  imageUrls: ["https://cdn.example/a.jpg", "/api/private/file"],
  barcode: "BARCODE-NOT-PUBLIC-FIELD",
};

const validation = validateListingDraft(baseDraft);
assert.equal(validation.blocking.length, 0);
assert.ok(validation.warnings.some((message) => message.includes("重量")));
assert.ok(validation.warnings.some((message) => message.includes("包装尺寸")));

const payload = buildCommonCollectBoxPayload(baseDraft);
assert.equal(payload.itemNum, "TZKJ-SJU005");
assert.equal(payload.title, baseDraft.title);
assert.deepEqual(payload.imgUrls, ["https://cdn.example/a.jpg"]);
assert.equal("weight" in payload, false, "没有来源的重量不能自动补造");
assert.equal("packageLength" in payload, false, "没有来源的尺寸不能自动补造");
assert.equal("barcode" in payload, false, "公开采集箱接口未声明条码字段，不能盲目提交");

assert.ok(validateListingDraft({ ...baseDraft, price: 100000 }).blocking.some((message) => message.includes("99,999.99")));
assert.ok(validateListingDraft({ ...baseDraft, stock: 100000 }).blocking.some((message) => message.includes("99,999")));
assert.ok(validateListingDraft({ ...baseDraft, stock: 1.5 }).blocking.some((message) => message.includes("整数")));

const cacheDir = mkdtempSync(join(tmpdir(), "tongzhou-listing-test-"));
try {
  const legacyDir = join(cacheDir, "legacy");
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(join(legacyDir, "miaoshou-listing-drafts.json"), JSON.stringify({
    version: 1,
    drafts: [{ ...baseDraft, id: "legacy-draft", version: 1, price: 64900, status: "review_ready" }],
  }), "utf8");
  const legacyService = initMiaoshouListingService({ cacheDir: legacyDir, connector: {} });
  assert.equal(legacyService.getDraft("legacy-draft")?.price, null, "旧版目标站售价必须清空，避免被当作人民币货源价");
  assert.ok(legacyService.getDraft("legacy-draft")?.warnings.some((message) => message.includes("人民币货源价")));

  const versionTwoDir = join(cacheDir, "version-two");
  mkdirSync(versionTwoDir, { recursive: true });
  writeFileSync(join(versionTwoDir, "miaoshou-listing-drafts.json"), JSON.stringify({
    version: 2,
    drafts: [{ ...baseDraft, id: "version-two-draft", version: 2, price: 9.9, status: "review_ready" }],
  }), "utf8");
  const versionTwoService = initMiaoshouListingService({ cacheDir: versionTwoDir, connector: {} });
  assert.equal(versionTwoService.getDraft("version-two-draft")?.price, 9.9, "第二版人民币货源价升级到图片方案版本时必须保留");

  let createCalls = 0;
  const connector = {
    async createCommonCollectBoxProduct(input) {
      createCalls += 1;
      assert.equal(input.itemNum, "TZKJ-SJU005");
      return { result: "success", data: { commonCollectBoxDetailId: "COLLECT-1001" } };
    },
  };
  const service = initMiaoshouListingService({ cacheDir, connector });
  const draft = service.createDraft({ ...baseDraft, sourceProductName: "SJU 脱毛膏" }, "测试管理员");
  const withWeight = service.updateDraft(draft.id, { weight: 0.12 }, "测试管理员");
  assert.equal(withWeight.weight, 0.12);
  const clearedWeight = service.updateDraft(draft.id, { weight: null }, "测试管理员");
  assert.equal(clearedWeight.weight, null, "人工清空重量时不能恢复旧值");
  const withPlatform = service.updateDraft(draft.id, {
    shopId: "1001",
    categoryId: "2",
    categoryName: "护发",
    categoryPath: "美妆 / 护发",
    platformAttributes: [{ attrId: "10", name: "品牌", valueId: "20", valueName: "SJU", customValue: "" }],
  }, "测试管理员");
  assert.equal(withPlatform.categoryId, "2");
  assert.equal(withPlatform.platformAttributes[0].valueId, "20");
  const withImageBriefs = service.updateDraft(withPlatform.id, {
    imageBriefs: [{ ...imageBriefs[0], imageUrl: "https://cdn.example/generated-main.jpg" }],
  }, "测试管理员");
  assert.equal(withImageBriefs.imageBriefs[0].imageUrl, "https://cdn.example/generated-main.jpg");
  const first = await service.pushDraft(withImageBriefs.id, { confirmed: true, actorName: "测试管理员" });
  const second = await service.pushDraft(withImageBriefs.id, { confirmed: true, actorName: "测试管理员" });
  assert.equal(first.status, "pushed");
  assert.equal(first.commonCollectBoxDetailId, "COLLECT-1001");
  assert.equal(second.commonCollectBoxDetailId, "COLLECT-1001");
  assert.equal(createCalls, 1, "已成功推送的草稿不能重复创建");

  const ambiguousService = initMiaoshouListingService({
    cacheDir: join(cacheDir, "ambiguous"),
    connector: {
      async createCommonCollectBoxProduct() {
        const error = new Error("请求超时");
        error.ambiguous = true;
        throw error;
      },
    },
  });
  const ambiguousDraft = ambiguousService.createDraft(baseDraft, "测试管理员");
  await assert.rejects(
    ambiguousService.pushDraft(ambiguousDraft.id, { confirmed: true, actorName: "测试管理员" }),
    /请求超时/,
  );
  assert.equal(ambiguousService.getDraft(ambiguousDraft.id)?.status, "manual_check");
  console.log(JSON.stringify({ ok: true, draftId: draft.id, commonCollectBoxDetailId: first.commonCollectBoxDetailId }, null, 2));
} finally {
  rmSync(cacheDir, { recursive: true, force: true });
}
