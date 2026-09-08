import React from "react";
import { AlertTriangle, Bot, Check, RefreshCw, Save, Search, Sparkles, Upload } from "lucide-react";
import {
  AssetRecord,
  AiModelCatalogItem,
  CatalogProduct,
  MiaoshouCategoryMetadata,
  MiaoshouCategoryOption,
  MiaoshouListingDraft,
  MiaoshouSelectedAttribute,
  MiaoshouShopOption,
  ProductBase,
  QualificationRecord,
  fetchMiaoshouListings,
  fetchMiaoshouTikTokCategories,
  fetchMiaoshouTikTokCategoryMetadata,
  generateMiaoshouListing,
  pushMiaoshouListing,
  suggestMiaoshouTikTokCategory,
  updateMiaoshouListing,
} from "./api";

type Props = {
  product: CatalogProduct;
  productBase?: ProductBase;
  qualifications: QualificationRecord[];
  assets: AssetRecord[];
};

const STATUS_LABELS: Record<MiaoshouListingDraft["status"], string> = {
  draft: "待完善",
  review_ready: "待审核",
  pushing: "推送中",
  pushed: "已推送",
  failed: "推送失败",
  manual_check: "需人工核对",
};

function optionalNumber(value: string) {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function preferredCnyPrice(product: CatalogProduct, productBase?: ProductBase) {
  const direct: Array<[number | undefined, string | undefined]> = [
    [product.directCostPrice, product.directCostCurrency],
    [product.directPrice, product.directCurrency],
  ];
  const distribution: Array<[number | undefined, string | undefined]> = [
    [product.distributionCostPrice, product.distributionCostCurrency],
    [product.distributionCost, product.distributionCostCurrency],
  ];
  const candidates: Array<[number | undefined, string | undefined]> = [
    ...(product.channel.includes("分销") ? [...distribution, ...direct] : [...direct, ...distribution]),
    [productBase?.latestLandedUnitCostCny, "CNY"],
  ];
  const matched = candidates.find(([value, currency]) => Number(value) > 0 && (!currency || currency.toUpperCase() === "CNY"));
  return matched ? String(matched[0]) : "";
}

function localTikTokReadiness(input: {
  shopId: string;
  categoryId: string;
  metadata: MiaoshouCategoryMetadata | null;
  attributes: MiaoshouSelectedAttribute[];
  packageLength: string;
  packageWidth: string;
  packageHeight: string;
}) {
  const blocking: string[] = [];
  const warnings: string[] = [];
  const checks: boolean[] = [];
  const check = (passed: boolean, message: string) => {
    checks.push(passed);
    if (!passed) blocking.push(message);
  };
  check(Boolean(input.shopId), "请选择目标 TikTok 店铺。");
  check(Boolean(input.categoryId), "请选择妙手 TikTok 末级类目。");
  if (!input.metadata) check(false, "请读取类目要求后再判断发布准备度。");
  else {
    const selected = new Map(input.attributes.map((item) => [item.attrId, item]));
    [...input.metadata.productAttributes, ...input.metadata.saleAttributes].filter((item) => item.mandatory).forEach((attr) => {
      const value = selected.get(attr.attrId);
      check(Boolean(value && (value.valueId || value.valueName || value.customValue)), `请填写必填属性：${attr.name || attr.attrId}。`);
    });
    if (input.metadata.requirements.packageDimensions) {
      check([input.packageLength, input.packageWidth, input.packageHeight].every((value) => Number(value) > 0), "该类目要求完整的包装长、宽、高。");
    }
    const certifications = input.metadata.certifications.filter((item) => item.required);
    if (certifications.length) warnings.push(`需在妙手补充资质/认证：${certifications.map((item) => item.name || item.id).join("、")}。`);
    if (input.metadata.requirements.sizeChart) warnings.push("需在妙手补充尺码表。");
    if (input.metadata.requirements.epr) warnings.push("需在妙手补充 EPR 信息。");
    if (input.metadata.requirements.responsiblePerson) warnings.push("需在妙手补充责任人信息。");
    if (input.metadata.requirements.manufacturer) warnings.push("需在妙手补充制造商信息。");
  }
  return { blocking, warnings, ready: blocking.length === 0, completed: checks.filter(Boolean).length, total: checks.length };
}

function splitItems(value: string) {
  return Array.from(new Set(value.split(/[，,；;\n]+/).map((item) => item.trim()).filter(Boolean)));
}

function directHttps(value?: string) {
  if (!value) return "";
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function formatDraftTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { hour12: false });
}

export function MiaoshouListingWorkspace({ product, productBase, qualifications, assets }: Props) {
  const sourceImages = React.useMemo(() => Array.from(new Set([
    productBase?.imageUrl,
    product.imageUrl,
    productBase?.qualificationImageUrl,
    product.qualificationImageUrl,
    ...assets.flatMap((asset) => asset.files.map((file) => file.url)),
    ...qualifications.flatMap((record) => record.files.map((file) => file.url)),
  ].map((url) => directHttps(url)).filter(Boolean))).slice(0, 12), [assets, product, productBase, qualifications]);
  const internalMediaCount = React.useMemo(() => [
    ...assets.flatMap((asset) => asset.files),
    ...qualifications.flatMap((record) => record.files),
  ].filter((file) => file.fileId && !directHttps(file.url)).length, [assets, qualifications]);

  const [drafts, setDrafts] = React.useState<MiaoshouListingDraft[]>([]);
  const [draft, setDraft] = React.useState<MiaoshouListingDraft | null>(null);
  const [shops, setShops] = React.useState<MiaoshouShopOption[]>([]);
  const [aiConfigured, setAiConfigured] = React.useState(true);
  const [aiModels, setAiModels] = React.useState<AiModelCatalogItem[]>([]);
  const [aiModel, setAiModel] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [working, setWorking] = React.useState<"" | "generate" | "save" | "push" | "category" | "suggest" | "metadata">("");
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [confirmPush, setConfirmPush] = React.useState(false);
  const [platform, setPlatform] = React.useState("tiktok");
  const [site, setSite] = React.useState("ID");
  const [language, setLanguage] = React.useState("id");
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [keywords, setKeywords] = React.useState("");
  const [sellingPoints, setSellingPoints] = React.useState("");
  const [categoryHint, setCategoryHint] = React.useState("");
  const [shopId, setShopId] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("");
  const [categoryName, setCategoryName] = React.useState("");
  const [categoryPath, setCategoryPath] = React.useState("");
  const [platformAttributes, setPlatformAttributes] = React.useState<MiaoshouSelectedAttribute[]>([]);
  const [categoryMetadata, setCategoryMetadata] = React.useState<MiaoshouCategoryMetadata | null>(null);
  const [categoryOptions, setCategoryOptions] = React.useState<MiaoshouCategoryOption[]>([]);
  const [categorySearch, setCategorySearch] = React.useState(product.category || productBase?.category || "");
  const [categoryReason, setCategoryReason] = React.useState("");
  const [price, setPrice] = React.useState(preferredCnyPrice(product, productBase));
  const [stock, setStock] = React.useState(String(product.stockQty ?? 0));
  const [weight, setWeight] = React.useState("");
  const [packageLength, setPackageLength] = React.useState("");
  const [packageWidth, setPackageWidth] = React.useState("");
  const [packageHeight, setPackageHeight] = React.useState("");
  const [selectedImages, setSelectedImages] = React.useState<string[]>(sourceImages.slice(0, 9));

  const immutable = Boolean(draft && ["pushed", "pushing", "manual_check"].includes(draft.status));

  function hydrate(next: MiaoshouListingDraft, preserveMetadata = false) {
    setDraft(next);
    setPlatform(next.platform || "tiktok");
    setSite(next.site || "ID");
    setLanguage(next.language || "id");
    setTitle(next.title || "");
    setDescription(next.description || "");
    setKeywords((next.keywords || []).join("，"));
    setSellingPoints((next.sellingPoints || []).join("\n"));
    setCategoryHint(next.categoryHint || "");
    setShopId(next.shopId || "");
    setCategoryId(next.categoryId || "");
    setCategoryName(next.categoryName || "");
    setCategoryPath(next.categoryPath || "");
    setPlatformAttributes(next.platformAttributes || []);
    if (!preserveMetadata) setCategoryMetadata(null);
    setCategoryOptions([]);
    setCategoryReason("");
    setPrice(next.price === null ? "" : String(next.price));
    setStock(String(next.stock ?? 0));
    setWeight(next.weight === null ? "" : String(next.weight));
    setPackageLength(next.packageLength === null ? "" : String(next.packageLength));
    setPackageWidth(next.packageWidth === null ? "" : String(next.packageWidth));
    setPackageHeight(next.packageHeight === null ? "" : String(next.packageHeight));
    setSelectedImages(next.imageUrls || []);
    setConfirmPush(false);
  }

  const reload = React.useCallback(async (preferredId = "") => {
    setLoading(true);
    setError("");
    try {
      const payload = await fetchMiaoshouListings(product.sku);
      setDrafts(payload.drafts);
      setShops(payload.shops || []);
      setAiConfigured(payload.aiConfigured);
      setAiModels(payload.aiModels || []);
      setAiModel((current) => current && payload.aiModels.some((model) => model.id === current) ? current : (payload.selectedAiModel || payload.aiModels[0]?.id || ""));
      const next = payload.drafts.find((item) => item.id === preferredId) || payload.drafts[0];
      if (next) hydrate(next);
      else {
        setDraft(null);
        const defaultShop = (payload.shops || []).find((item) => item.platform.toLowerCase() === "tiktok" && item.site === "ID");
        setShopId(defaultShop?.shopId || "");
        setSelectedImages(sourceImages.slice(0, 9));
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "读取上架草稿失败");
    } finally {
      setLoading(false);
    }
  }, [product.sku, sourceImages]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const matchingShops = React.useMemo(() => shops.filter((item) => (
    item.platform.toLowerCase() === platform.toLowerCase() && item.site.toUpperCase() === site.toUpperCase()
  )), [platform, shops, site]);

  async function loadCategoryMetadata(cid = categoryId, selectedShopId = shopId) {
    if (!cid) return;
    setWorking("metadata");
    setError("");
    try {
      const result = await fetchMiaoshouTikTokCategoryMetadata({ cid, site, shopId: selectedShopId, draftId: draft?.id });
      setCategoryMetadata(result.metadata);
    } catch (nextError) {
      setCategoryMetadata(null);
      setError(nextError instanceof Error ? nextError.message : "读取类目要求失败");
    } finally {
      setWorking("");
    }
  }

  React.useEffect(() => {
    if (draft && platform === "tiktok" && categoryId && !categoryMetadata && !working) void loadCategoryMetadata();
  }, [categoryId, categoryMetadata, draft, platform, shopId, site]);

  const inputPayload = React.useMemo(() => ({
    sku: product.sku,
    model: aiModel,
    platform,
    site,
    language,
    title,
    description,
    keywords: splitItems(keywords),
    sellingPoints: splitItems(sellingPoints),
    categoryHint,
    shopId,
    categoryId,
    categoryName,
    categoryPath,
    platformAttributes,
    categoryMetadataCheckedAt: categoryMetadata ? new Date().toISOString() : "",
    price: optionalNumber(price),
    stock: optionalNumber(stock),
    weight: optionalNumber(weight),
    packageLength: optionalNumber(packageLength),
    packageWidth: optionalNumber(packageWidth),
    packageHeight: optionalNumber(packageHeight),
    barcode: productBase?.barcode || product.barcode || "",
    imageUrls: selectedImages,
  }), [aiModel, categoryHint, categoryId, categoryMetadata, categoryName, categoryPath, description, keywords, language, packageHeight, packageLength, packageWidth, platform, platformAttributes, price, product, productBase, selectedImages, sellingPoints, shopId, site, stock, title, weight]);

  async function generateDraft() {
    setWorking("generate");
    setError("");
    setMessage("");
    setConfirmPush(false);
    try {
      const result = await generateMiaoshouListing(inputPayload);
      setDrafts((current) => [result.draft, ...current.filter((item) => item.id !== result.draft.id)]);
      hydrate(result.draft);
      setMessage("AI 草稿已生成，请检查标题、详情、价格和图片后再推送。");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "AI 草稿生成失败");
    } finally {
      setWorking("");
    }
  }

  async function handleCategorySearch() {
    setWorking("category");
    setError("");
    setCategoryReason("");
    try {
      const result = await fetchMiaoshouTikTokCategories(site, categorySearch || categoryHint || product.category || product.name);
      setCategoryOptions(result.categories);
      if (!result.categories.length) setError("没有找到匹配类目，请换一个更短、更明确的中文关键词。");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "搜索妙手 TikTok 类目失败");
    } finally {
      setWorking("");
    }
  }

  async function chooseCategory(option: MiaoshouCategoryOption) {
    setCategoryId(option.cid);
    setCategoryName(option.nameChinese || option.name);
    setCategoryPath(option.pathChinese || option.path);
    setPlatformAttributes([]);
    setCategoryOptions([]);
    setCategoryMetadata(null);
    setCategoryReason("");
    await loadCategoryMetadata(option.cid, shopId);
  }

  async function handleSuggestCategory() {
    if (!draft) return;
    setWorking("suggest");
    setError("");
    setMessage("");
    try {
      const saved = await updateMiaoshouListing(draft.id, inputPayload);
      const result = await suggestMiaoshouTikTokCategory(saved.draft.id, aiModel);
      setDrafts((current) => current.map((item) => item.id === result.draft.id ? result.draft : item));
      hydrate(result.draft, true);
      setCategoryMetadata(result.metadata);
      setCategoryReason(result.reason || "AI 已从妙手候选类目中选择最接近项，请人工确认。");
      setMessage("AI 类目建议已写入草稿，平台必填属性已读取。");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "AI 推荐类目失败");
    } finally {
      setWorking("");
    }
  }

  function setAttribute(attrId: string, name: string, value: string, values: Array<{ id: string; name: string }>) {
    const matched = values.find((item) => item.id === value);
    const next: MiaoshouSelectedAttribute = {
      attrId,
      name,
      valueId: matched?.id || "",
      valueName: matched?.name || "",
      customValue: matched ? "" : value,
    };
    setPlatformAttributes((current) => [...current.filter((item) => item.attrId !== attrId), next]);
  }

  async function saveDraft(showMessage = true) {
    if (!draft) throw new Error("请先生成 AI 草稿");
    const result = await updateMiaoshouListing(draft.id, inputPayload);
    setDrafts((current) => current.map((item) => item.id === result.draft.id ? result.draft : item));
    hydrate(result.draft, true);
    if (showMessage) setMessage("人工修改已保存。");
    return result.draft;
  }

  async function handleSave() {
    setWorking("save");
    setError("");
    setMessage("");
    try {
      await saveDraft();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "保存草稿失败");
    } finally {
      setWorking("");
    }
  }

  async function handlePush() {
    if (!draft) return;
    setWorking("push");
    setError("");
    setMessage("");
    try {
      const saved = await saveDraft(false);
      if (saved.validation.blocking.length) {
        setError(saved.validation.blocking.join(" "));
        return;
      }
      const result = await pushMiaoshouListing(saved.id);
      setDrafts((current) => current.map((item) => item.id === result.draft.id ? result.draft : item));
      hydrate(result.draft, true);
      setMessage(`已推送到妙手公共采集箱，记录 ID：${result.draft.commonCollectBoxDetailId}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "推送妙手采集箱失败");
      await reload(draft.id);
    } finally {
      setWorking("");
      setConfirmPush(false);
    }
  }

  function toggleImage(url: string) {
    if (immutable) return;
    setSelectedImages((current) => current.includes(url) ? current.filter((item) => item !== url) : [...current, url].slice(0, 9));
  }

  const visibleWarnings = Array.from(new Set([
    ...(draft?.validation?.warnings || []),
    ...(internalMediaCount > 0 && !draft ? [`${internalMediaCount} 个内部附件没有公网地址，暂不能推送。`] : []),
  ]));
  const platformReadiness = localTikTokReadiness({
    shopId,
    categoryId,
    metadata: categoryMetadata,
    attributes: platformAttributes,
    packageLength,
    packageWidth,
    packageHeight,
  });
  const categoryAttributes = categoryMetadata ? [...categoryMetadata.productAttributes, ...categoryMetadata.saleAttributes] : [];
  const visibleAttributes = [
    ...categoryAttributes.filter((item) => item.mandatory),
    ...categoryAttributes.filter((item) => !item.mandatory).slice(0, 6),
  ];

  return (
    <div className="miaoshou-listing-workspace">
      <div className="listing-intro-card">
        <div className="listing-intro-icon"><Bot size={22} /></div>
        <div>
          <strong>AI 生成，人工把关</strong>
          <span>本期只推送到妙手公共采集箱，不会自动发布到任何店铺。</span>
        </div>
        {draft ? <span className={`listing-status ${draft.status}`}>{STATUS_LABELS[draft.status]}</span> : <span className="listing-status draft">尚未生成</span>}
      </div>

      {!aiConfigured ? <div className="listing-alert error"><AlertTriangle size={16} />同舟 AI 尚未配置，请先到同舟 AI 页面完成配置。</div> : null}
      {error ? <div className="listing-alert error"><AlertTriangle size={16} />{error}</div> : null}
      {message ? <div className="listing-alert success"><Check size={16} />{message}</div> : null}

      <section className="listing-card">
        <div className="listing-card-head">
          <div><span>01</span><div><strong>目标与草稿</strong><small>默认优先 TikTok 印度尼西亚站</small></div></div>
          {drafts.length ? (
            <select aria-label="历史草稿" value={draft?.id || ""} onChange={(event) => {
              const selected = drafts.find((item) => item.id === event.target.value);
              if (selected) hydrate(selected);
            }}>
              {drafts.map((item) => <option key={item.id} value={item.id}>{STATUS_LABELS[item.status]} · {formatDraftTime(item.updatedAt)}</option>)}
            </select>
          ) : null}
        </div>
        <div className="listing-target-grid">
          <label><span>平台</span><select value={platform} disabled={immutable} onChange={(event) => { setPlatform(event.target.value); setShopId(""); setCategoryId(""); setCategoryMetadata(null); }}><option value="tiktok">TikTok</option><option value="shopee">Shopee</option></select></label>
          <label><span>站点</span><select value={site} disabled={immutable} onChange={(event) => { setSite(event.target.value); setShopId(""); setCategoryId(""); setCategoryMetadata(null); }}><option value="ID">印度尼西亚</option><option value="MY">马来西亚</option><option value="VN">越南</option></select></label>
          <label><span>生成语言</span><select value={language} disabled={immutable} onChange={(event) => setLanguage(event.target.value)}><option value="id">印度尼西亚语</option><option value="en">英语</option><option value="ms">马来语</option><option value="vi">越南语</option></select></label>
          <label><span>目标店铺</span><select value={shopId} disabled={immutable || platform !== "tiktok"} onChange={(event) => { setShopId(event.target.value); setCategoryMetadata(null); }}><option value="">{matchingShops.length ? "请选择店铺" : "暂无已同步店铺"}</option>{matchingShops.map((shop) => <option key={shop.shopId} value={shop.shopId}>{shop.name}</option>)}</select></label>
          <label><span>AI 文字模型</span><select value={aiModel} disabled={!aiModels.length || Boolean(working)} onChange={(event) => setAiModel(event.target.value)}><option value="">{aiConfigured ? "暂无文字模型" : "请先配置画布密钥"}</option>{aiModels.map((model) => <option key={model.id} value={model.id}>{model.name}{model.estimatedCredits ? ` · 约 ${model.estimatedCredits} 点` : ""}</option>)}</select></label>
          <button className="listing-generate-button" type="button" onClick={generateDraft} disabled={!aiConfigured || Boolean(working)}>
            <Bot size={17} />{working === "generate" ? "正在生成…" : draft ? "重新生成新草稿" : "生成 AI 草稿"}
          </button>
        </div>
      </section>

      <section className="listing-card">
        <div className="listing-card-head"><div><span>02</span><div><strong>商品信息</strong><small>AI 不会自动补造重量、尺寸和认证</small></div></div></div>
        <div className="listing-form-grid">
          <label className="wide"><span>商品标题</span><input value={title} disabled={!draft || immutable} maxLength={255} onChange={(event) => setTitle(event.target.value)} placeholder="生成后可人工修改" /><small>{title.length}/255</small></label>
          <label><span>货源价（CNY）</span><input type="number" min="0.01" max="99999.99" step="0.01" value={price} disabled={immutable} onChange={(event) => setPrice(event.target.value)} /><small>妙手公共采集箱使用人民币货源价</small></label>
          <label><span>库存</span><input type="number" min="0" max="99999" step="1" value={stock} disabled={immutable} onChange={(event) => setStock(event.target.value)} /></label>
          <label><span>重量（kg）</span><input type="number" min="0" step="0.001" value={weight} disabled={immutable} onChange={(event) => setWeight(event.target.value)} placeholder="不自动猜测" /></label>
          <label><span>包装长（cm）</span><input type="number" min="0" step="0.1" value={packageLength} disabled={immutable} onChange={(event) => setPackageLength(event.target.value)} /></label>
          <label><span>包装宽（cm）</span><input type="number" min="0" step="0.1" value={packageWidth} disabled={immutable} onChange={(event) => setPackageWidth(event.target.value)} /></label>
          <label><span>包装高（cm）</span><input type="number" min="0" step="0.1" value={packageHeight} disabled={immutable} onChange={(event) => setPackageHeight(event.target.value)} /></label>
          <label className="wide"><span>商品详情</span><textarea rows={7} value={description} disabled={!draft || immutable} onChange={(event) => setDescription(event.target.value)} placeholder="AI 将根据产品资料生成适合移动端阅读的详情" /></label>
          <label className="wide"><span>关键词</span><input value={keywords} disabled={!draft || immutable} onChange={(event) => setKeywords(event.target.value)} placeholder="用逗号分隔" /></label>
          <label className="wide"><span>核心卖点</span><textarea rows={3} value={sellingPoints} disabled={!draft || immutable} onChange={(event) => setSellingPoints(event.target.value)} placeholder="每行一个卖点" /></label>
          <label className="wide"><span>类目建议</span><input value={categoryHint} disabled={!draft || immutable} onChange={(event) => setCategoryHint(event.target.value)} placeholder="一期作为人工参考，不自动匹配平台类目" /></label>
        </div>
      </section>

      <section className="listing-card">
        <div className="listing-card-head"><div><span>03</span><div><strong>商品图片</strong><small>最多 9 张，只显示妙手可访问的公网 HTTPS 图片</small></div></div><b>{selectedImages.length}/9</b></div>
        {sourceImages.length ? (
          <div className="listing-image-grid">
            {sourceImages.map((url) => {
              const selected = selectedImages.includes(url);
              return <button key={url} type="button" disabled={immutable} className={selected ? "selected" : ""} onClick={() => toggleImage(url)}><img src={url} alt="产品素材" /><span>{selected ? <Check size={14} /> : null}{selected ? "已选择" : "选择"}</span></button>;
            })}
          </div>
        ) : <div className="listing-empty-media">暂无可推送的公网图片，请先为产品配置公网 HTTPS 素材。</div>}
      </section>

      <section className="listing-card listing-platform-card">
        <div className="listing-card-head">
          <div><span>04</span><div><strong>TikTok 发布准备</strong><small>读取妙手真实类目和必填属性；本期不自动发布</small></div></div>
          <b className={platformReadiness.ready ? "ready" : "pending"}>{platformReadiness.ready ? "已具备基础条件" : `${platformReadiness.completed}/${platformReadiness.total} 项完成`}</b>
        </div>
        {platform !== "tiktok" ? <div className="listing-empty-media">当前批次先支持 TikTok 发布准备检查，Shopee 草稿仍可推送到公共采集箱。</div> : (
          <>
            <div className="listing-category-toolbar">
              <label><span>平台类目</span><div className="listing-category-search"><input value={categorySearch} disabled={!draft || immutable} onChange={(event) => setCategorySearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void handleCategorySearch(); }} placeholder="输入中文类目，如：脱毛、洗发水" /><button className="ghost-button" type="button" disabled={!draft || immutable || Boolean(working)} onClick={handleCategorySearch}><Search size={15} />{working === "category" ? "搜索中" : "搜索"}</button></div></label>
              <button className="listing-ai-category" type="button" disabled={!draft || immutable || !aiConfigured || Boolean(working)} onClick={handleSuggestCategory}><Sparkles size={16} />{working === "suggest" ? "AI 匹配中…" : "AI 推荐类目"}</button>
            </div>
            {categoryOptions.length ? (
              <div className="listing-category-results">
                {categoryOptions.map((option) => <button key={option.cid} type="button" onClick={() => void chooseCategory(option)}><span>{option.pathChinese || option.path}</span><small>{option.path && option.path !== option.pathChinese ? option.path : `CID ${option.cid}`}</small></button>)}
              </div>
            ) : null}
            <div className={`listing-category-current ${categoryId ? "selected" : ""}`}>
              <div><small>当前类目</small><strong>{categoryPath || categoryName || "尚未选择妙手末级类目"}</strong>{categoryId ? <span>CID {categoryId}</span> : null}</div>
              {categoryId ? <button className="ghost-button" type="button" disabled={immutable || Boolean(working)} onClick={() => void loadCategoryMetadata()}><RefreshCw size={14} />重读要求</button> : null}
            </div>
            {categoryReason ? <div className="listing-category-reason"><Sparkles size={15} />{categoryReason}</div> : null}
            {working === "metadata" ? <div className="listing-inline-loading"><RefreshCw size={15} className="spinning" />正在读取妙手类目要求…</div> : null}
            {categoryMetadata ? (
              <div className="listing-attribute-area">
                <div className="listing-subhead"><strong>平台属性</strong><span>{categoryAttributes.filter((item) => item.mandatory).length} 项必填，另显示最多 6 项常用选填</span></div>
                {visibleAttributes.length ? (
                  <div className="listing-attribute-grid">
                    {visibleAttributes.map((attr) => {
                      const selected = platformAttributes.find((item) => item.attrId === attr.attrId);
                      return (
                        <label key={attr.attrId}><span>{attr.name || attr.alias || attr.attrId}{attr.mandatory ? <b>*</b> : null}</span>{attr.values.length ? (
                          <select value={selected?.valueId || ""} disabled={immutable} onChange={(event) => setAttribute(attr.attrId, attr.name, event.target.value, attr.values)}><option value="">请选择</option>{attr.values.slice(0, 200).map((value) => <option key={value.id || value.name} value={value.id}>{value.name}</option>)}</select>
                        ) : (
                          <input value={selected?.customValue || ""} disabled={immutable || !attr.customized} onChange={(event) => setAttribute(attr.attrId, attr.name, event.target.value, [])} placeholder={attr.customized ? "请输入属性值" : "需在妙手中填写"} />
                        )}</label>
                      );
                    })}
                  </div>
                ) : <div className="listing-empty-media">该类目未返回需要在此填写的商品属性。</div>}
                <div className={`listing-readiness ${platformReadiness.ready ? "ready" : "pending"}`}>
                  <strong>{platformReadiness.ready ? <Check size={17} /> : <AlertTriangle size={17} />}{platformReadiness.ready ? "基础发布条件已齐" : "仍有发布条件未完成"}</strong>
                  {platformReadiness.blocking.length ? <ul>{platformReadiness.blocking.map((item) => <li key={item}>{item}</li>)}</ul> : null}
                  {platformReadiness.warnings.length ? <ul className="warnings">{platformReadiness.warnings.map((item) => <li key={item}>{item}</li>)}</ul> : null}
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>

      {(visibleWarnings.length || draft?.validation?.blocking.length) ? (
        <section className="listing-review-panel">
          <strong><AlertTriangle size={16} />公共采集箱推送检查</strong>
          <ul>
            {(draft?.validation?.blocking || []).map((item) => <li className="blocking" key={item}>{item}</li>)}
            {visibleWarnings.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      ) : null}

      <div className="listing-action-bar">
        <span>{draft?.lastError ? `最近错误：${draft.lastError}` : draft?.commonCollectBoxDetailId ? `妙手记录 ID：${draft.commonCollectBoxDetailId}` : "请在推送前逐项核对内容。"}</span>
        <div>
          <button className="ghost-button" type="button" disabled={!draft || immutable || Boolean(working)} onClick={handleSave}><Save size={16} />{working === "save" ? "保存中…" : "保存修改"}</button>
          {draft?.status === "pushed" ? <button className="sync-button" type="button" disabled><Check size={16} />已推送公共采集箱</button> : (
            <button className="sync-button" type="button" disabled={!draft || immutable || Boolean(working)} onClick={() => setConfirmPush(true)}><Upload size={16} />推送妙手采集箱</button>
          )}
        </div>
      </div>

      {confirmPush ? (
        <div className="listing-confirm">
          <div><strong>确认推送到妙手公共采集箱？</strong><span>这会在妙手创建一条真实商品草稿，但不会发布到店铺。</span></div>
          <button className="ghost-button" type="button" onClick={() => setConfirmPush(false)}>取消</button>
          <button className="sync-button" type="button" onClick={handlePush} disabled={Boolean(working)}>{working === "push" ? <RefreshCw size={16} className="spinning" /> : <Upload size={16} />}确认推送</button>
        </div>
      ) : null}

      {loading ? <div className="listing-loading"><RefreshCw size={18} className="spinning" />正在读取上架草稿…</div> : null}
    </div>
  );
}
