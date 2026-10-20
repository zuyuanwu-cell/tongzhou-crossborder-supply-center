const SUBJECT_LABELS = Object.freeze({
  formula: "配方 / 料体",
  raw_material: "原料",
  packaging_box: "包装盒",
  packaging_bottle: "包装瓶",
});

function numberValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function createSampleVariant(item, index) {
  const payload = item?.publicPayload || {};
  const specification = payload.packagingSpec || {};
  const packaging = payload.sampleCategory === "packaging";
  return {
    key: `sample-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    supplierMaterialCode: "",
    name: packaging ? `包材方案 ${index + 1}` : `料体 ${String.fromCharCode(65 + index)}`,
    sampleQuantity: String(payload.quantity || ""),
    unit: payload.unit || "份",
    specificationVersion: "",
    description: "",
    material: specification.material || "",
    process: specification.process || "",
    structureType: specification.structureType || "",
    lengthMm: String(specification.lengthMm || ""),
    widthMm: String(specification.widthMm || ""),
    heightMm: String(specification.heightMm || ""),
    diameterMm: String(specification.diameterMm || ""),
    capacityMl: String(specification.capacityMl || ""),
    colorPrinting: specification.colorPrinting || "",
  };
}

function decorateSamplingArtifact(entry) {
  const payload = entry.publicPayload || {};
  const variants = payload.sampleVariants || [];
  return Object.assign({}, entry, {
    roundLabel: `R${entry.version || 1}`,
    variantCount: variants.length || 1,
    attachmentCount: (payload.attachmentIds || []).length,
    summaryText: payload.summary || payload.supplierConclusion || "未填写摘要",
    variantCodes: variants.map((variant) => `${variant.variantCode || "待生成编码"} · ${variant.name || "未命名样品"}`),
    reviewNote: payload.reviewNote || "",
    statusLabel: entry.status === "submitted" ? "中台评审中" : entry.status === "approved" ? `最终样 ${payload.approvedVariantCode || ""}` : entry.status === "rejected" ? "需修改" : entry.status,
  });
}

function buildSamplingWorkspace(item, oem) {
  const payload = item?.publicPayload || {};
  const rounds = (oem?.artifacts || []).map(decorateSamplingArtifact);
  const approved = rounds.find((entry) => entry.status === "approved") || null;
  const latestQuote = oem?.quotes?.[0] || null;
  const packaging = payload.sampleCategory === "packaging";
  const specification = payload.packagingSpec || {};
  return {
    category: packaging ? "packaging" : "inner_material",
    categoryLabel: packaging ? "包材打样" : "料体打样",
    subjectLabel: SUBJECT_LABELS[payload.sampleSubject] || "样品",
    rounds,
    approved,
    latestQuote,
    brief: [
      { label: "本轮目标", value: payload.sampleGoal || "按发布要求完成可评审样品" },
      { label: "评审标准", value: payload.evaluationCriteria || payload.requirements || "以中台评审意见为准" },
    ],
    packagingFacts: packaging ? [
      { label: "材质", value: specification.material || "—" },
      { label: "盒型 / 瓶型", value: specification.structureType || "—" },
      { label: "尺寸", value: [specification.lengthMm, specification.widthMm, specification.heightMm].filter(Boolean).join(" × ") || (specification.diameterMm ? `口径 ${specification.diameterMm}mm` : "—") },
      { label: "工艺", value: specification.process || "—" },
      { label: "颜色 / 印刷", value: specification.colorPrinting || "—" },
      { label: "文件要求", value: specification.fileRequirements || "每轮上传设计稿或打样文件" },
    ] : [],
    route: [
      { label: "接收需求", done: item.status !== "pending" },
      { label: "送样评审", done: rounds.length > 0 },
      { label: "最终定版", done: Boolean(approved) },
      { label: "提交报价", done: Boolean(latestQuote) },
      { label: "报价确认", done: latestQuote?.status === "awarded" },
    ].map((step, index) => Object.assign({}, step, { number: index + 1 })),
  };
}

function validateSampleRound(item, variants, form, attachmentCount) {
  const payload = item?.publicPayload || {};
  if (!["accepted", "in_progress"].includes(item?.status)) return "当前任务状态不可提交新一轮样品";
  if (!String(form?.summary || "").trim()) return "请填写本轮整体说明";
  if (!(variants || []).length || variants.some((variant) => !String(variant.name || "").trim())) return "请填写每个样品或方案的名称";
  if (payload.sampleCategory === "inner_material") {
    const codes = variants.map((variant) => String(variant.supplierMaterialCode || "").trim().toUpperCase());
    if (codes.some((code) => !code)) return "请填写每个料体的供应商内部编码";
    if (new Set(codes).size !== codes.length) return "同一轮的供应商内部编码不能重复";
  }
  if (payload.sampleCategory === "packaging" && !attachmentCount) return "包材送样必须选择本轮设计稿或测试文件";
  return "";
}

function sampleArtifactInput(item, roundNumber, variants, form, attachmentIds) {
  const payload = item.publicPayload || {};
  const subjectLabel = SUBJECT_LABELS[payload.sampleSubject] || "样品";
  return {
    artifactType: "sample_result",
    title: `第 ${roundNumber} 轮${subjectLabel}送样`,
    version: roundNumber,
    publicPayload: {
      summary: String(form.summary || "").trim(),
      result: form.result || "pending",
      supplierConclusion: String(form.supplierConclusion || "").trim(),
      nextPlan: String(form.nextPlan || "").trim(),
      attachmentIds: attachmentIds || [],
      sampleVariants: variants.map((variant) => {
        const copy = Object.assign({}, variant);
        delete copy.key;
        ["sampleQuantity", "lengthMm", "widthMm", "heightMm", "diameterMm", "capacityMl"].forEach((key) => { copy[key] = numberValue(copy[key]); });
        return copy;
      }),
    },
  };
}

module.exports = { SUBJECT_LABELS, createSampleVariant, decorateSamplingArtifact, buildSamplingWorkspace, validateSampleRound, sampleArtifactInput };
