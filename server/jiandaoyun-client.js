import { JIANYUN_FORMS } from "./field-mapping.js";

const DEFAULT_HOST = "https://api.jiandaoyun.com";

function getEnv(name, fallback = "") {
  return process.env[name] || fallback;
}

function extractRecords(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  if (Array.isArray(payload?.data?.list)) return payload.data.list;
  if (Array.isArray(payload?.data_list)) return payload.data_list;
  if (Array.isArray(payload?.list)) return payload.list;
  return [];
}

function getLastDataId(records) {
  const last = records[records.length - 1];
  return last?.data_id || last?._id || last?.id || "";
}

export function hasJdyCredentials() {
  return Boolean(getEnv("JIANYUN_API_KEY"));
}

export async function fetchJdyFormFields(formConfig) {
  const apiKey = getEnv("JIANYUN_API_KEY");
  if (!apiKey) {
    throw new Error("缺少系统同步 API Key，当前无法读取简道云表单字段。");
  }

  const host = getEnv("JIANYUN_API_HOST", DEFAULT_HOST).replace(/\/$/, "");
  const endpoint = `${host}/api/v5/app/entry/widget/list`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ app_id: formConfig.appId, entry_id: formConfig.entryId }),
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`简道云表单字段读取失败 ${response.status}: ${text.slice(0, 240)}`);
  }

  if (Array.isArray(payload?.widgets)) return payload.widgets;
  if (Array.isArray(payload?.data?.widgets)) return payload.data.widgets;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

export async function fetchJdyDataList(formConfig, options = {}) {
  const apiKey = getEnv("JIANYUN_API_KEY");
  if (!apiKey) {
    throw new Error("缺少系统同步 API Key，当前无法请求同舟供应链数智化系统真实数据。");
  }

  const host = getEnv("JIANYUN_API_HOST", DEFAULT_HOST).replace(/\/$/, "");
  const limit = Math.min(Number(options.limit || 100), 100);
  const maxPages = Number(options.maxPages || 20);
  const endpoint = `${host}/api/v5/app/entry/data/list`;
  const allRecords = [];
  let dataId = "";

  for (let page = 0; page < maxPages; page += 1) {
    const body = {
      app_id: formConfig.appId,
      entry_id: formConfig.entryId,
      limit,
      ...(options.filter ? { filter: options.filter } : {}),
      ...(dataId ? { data_id: dataId } : {}),
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }

    if (!response.ok) {
      throw new Error(`同舟供应链数智化系统请求失败 ${response.status}: ${text.slice(0, 240)}`);
    }

    const records = extractRecords(payload);
    allRecords.push(...records);

    if (records.length < limit) break;
    const nextDataId = getLastDataId(records);
    if (!nextDataId || nextDataId === dataId) break;
    dataId = nextDataId;
  }

  return allRecords;
}

function uniqueTextValues(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function mergeJdyRecords(records) {
  const merged = new Map();
  for (const record of records) {
    const id = record?._id || record?.data_id || record?.id || JSON.stringify(record);
    merged.set(id, record);
  }
  return [...merged.values()];
}

export async function fetchJdyDataByValues(formConfig, field, values, options = {}) {
  const uniqueValues = uniqueTextValues(values);
  if (!field || uniqueValues.length === 0) return [];
  const chunkSize = Math.min(Math.max(Number(options.chunkSize || 20), 1), 20);
  const records = [];

  for (let index = 0; index < uniqueValues.length; index += chunkSize) {
    const chunk = uniqueValues.slice(index, index + chunkSize);
    const filter = {
      rel: "and",
      cond: [{ field, method: chunk.length === 1 ? "eq" : "in", value: chunk }],
    };
    records.push(...await fetchJdyDataList(formConfig, {
      filter,
      maxPages: Number(options.maxPages || 20),
    }));
  }

  return mergeJdyRecords(records);
}

export async function createJdyData(formConfig, data) {
  const apiKey = getEnv("JIANYUN_API_KEY");
  if (!apiKey) {
    throw new Error("缺少系统同步 API Key，无法同步到同舟供应链数智化系统。");
  }

  const host = getEnv("JIANYUN_API_HOST", DEFAULT_HOST).replace(/\/$/, "");
  const endpoint = `${host}/api/v5/app/entry/data/create`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      app_id: formConfig.appId,
      entry_id: formConfig.entryId,
      data,
    }),
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`同舟供应链数智化系统创建数据失败 ${response.status}: ${text.slice(0, 240)}`);
  }

  return payload;
}

export async function updateJdyData(formConfig, dataId, data) {
  const apiKey = getEnv("JIANYUN_API_KEY");
  if (!apiKey) {
    throw new Error("缺少系统同步 API Key，无法同步更新到同舟供应链数智化系统。");
  }
  if (!dataId) {
    throw new Error("缺少系统数据 ID，无法更新同舟供应链数智化系统记录。");
  }

  const host = getEnv("JIANYUN_API_HOST", DEFAULT_HOST).replace(/\/$/, "");
  const endpoint = `${host}/api/v5/app/entry/data/update`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      app_id: formConfig.appId,
      entry_id: formConfig.entryId,
      data_id: dataId,
      data,
    }),
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`同舟供应链数智化系统更新数据失败 ${response.status}: ${text.slice(0, 240)}`);
  }

  return payload;
}

export async function deleteJdyData(formConfig, dataId) {
  const apiKey = getEnv("JIANYUN_API_KEY");
  if (!apiKey) {
    throw new Error("缺少系统同步 API Key，无法同步删除同舟供应链数智化系统记录。");
  }
  if (!dataId) {
    throw new Error("缺少系统数据 ID，无法删除同舟供应链数智化系统记录。");
  }

  const host = getEnv("JIANYUN_API_HOST", DEFAULT_HOST).replace(/\/$/, "");
  const endpoint = `${host}/api/v5/app/entry/data/delete`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      app_id: formConfig.appId,
      entry_id: formConfig.entryId,
      data_id: dataId,
    }),
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`同舟供应链数智化系统删除数据失败 ${response.status}: ${text.slice(0, 240)}`);
  }

  return payload;
}

export async function fetchAllJdyProducts() {
  const [baseRecords, catalogRecords, russiaSecondWarehouseCostRecords] = await Promise.all([
    fetchJdyDataList(JIANYUN_FORMS.productBase),
    fetchJdyDataList(JIANYUN_FORMS.productCatalog),
    fetchJdyDataList(JIANYUN_FORMS.russiaSecondWarehouseCosts),
  ]);

  return { baseRecords, catalogRecords, russiaSecondWarehouseCostRecords };
}

export async function fetchAllJdyQualifications() {
  return fetchJdyDataList(JIANYUN_FORMS.qualifications);
}

export async function fetchAllJdyAssets() {
  return fetchJdyDataList(JIANYUN_FORMS.assets);
}

export async function fetchAllJdyWarehouseInfo() {
  return fetchJdyDataList(JIANYUN_FORMS.warehouseInfo);
}

export async function fetchAllJdyUserAccounts() {
  return fetchJdyDataList(JIANYUN_FORMS.userAccounts, { maxPages: 10 });
}

export async function fetchAllJdyOutsourcingOrders() {
  const inProductionFilter = {
    rel: "and",
    cond: [
      {
        field: JIANYUN_FORMS.outsourcingOrders.fields.status,
        method: "eq",
        value: ["进行中"],
      },
    ],
  };
  const [defaultRecords, inProductionRecords] = await Promise.all([
    fetchJdyDataList(JIANYUN_FORMS.outsourcingOrders),
    fetchJdyDataList(JIANYUN_FORMS.outsourcingOrders, { filter: inProductionFilter, maxPages: 10 }),
  ]);
  return mergeJdyRecords([...defaultRecords, ...inProductionRecords]);
}

function jdyFieldText(record, fieldId) {
  const field = record?.[fieldId];
  const value = field && typeof field === "object" && "value" in field ? field.value : field;
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map((item) => jdyFieldText({ value: item }, "value")).filter(Boolean).join(",");
  if (typeof value === "object") return String(value.name || value.title || value.value || value.id || "").trim();
  return String(value).trim();
}

export async function fetchAllJdyActiveOutsourcingOrders() {
  return fetchJdyDataList(JIANYUN_FORMS.outsourcingOrders, {
    filter: {
      rel: "and",
      cond: [{ field: JIANYUN_FORMS.outsourcingOrders.fields.status, method: "eq", value: ["进行中"] }],
    },
    maxPages: 20,
  });
}

export async function fetchJdyOutsourcingOrdersByFactoryId(factoryId) {
  const value = String(factoryId || "").trim();
  if (!value) return [];
  return fetchJdyDataList(JIANYUN_FORMS.outsourcingOrders, {
    filter: {
      rel: "and",
      cond: [{ field: JIANYUN_FORMS.outsourcingOrders.fields.factoryId, method: "eq", value: [value] }],
    },
    maxPages: 20,
  });
}

export async function fetchJdyFirstArticleRecordsForOrders(orderRecords = []) {
  const orderFields = JIANYUN_FORMS.outsourcingOrders.fields;
  const firstArticle = JIANYUN_FORMS.firstArticleRecords;
  const barcodes = orderRecords.map((record) => jdyFieldText(record, orderFields.barcode)).filter(Boolean);
  const skus = orderRecords.flatMap((record) => [
    jdyFieldText(record, orderFields.tongzhouSku),
    jdyFieldText(record, orderFields.productSku),
  ]).filter(Boolean);
  const productNames = orderRecords.map((record) => jdyFieldText(record, orderFields.productName)).filter(Boolean);
  const [byBarcode, bySku, byProductName] = await Promise.all([
    fetchJdyDataByValues(firstArticle, firstArticle.fields.barcode, barcodes, { maxPages: 10 }),
    fetchJdyDataByValues(firstArticle, firstArticle.fields.productSku, skus, { maxPages: 10 }),
    fetchJdyDataByValues(firstArticle, firstArticle.fields.productName, productNames, { maxPages: 10 }),
  ]);
  return mergeJdyRecords([...byBarcode, ...bySku, ...byProductName]);
}

export async function fetchJdyCraftOrderRecordsForOrders(orderRecords = []) {
  const orderFields = JIANYUN_FORMS.outsourcingOrders.fields;
  const craftOrder = JIANYUN_FORMS.craftOrders;
  const craftOrderNos = orderRecords.map((record) => jdyFieldText(record, orderFields.craftOrderNo)).filter(Boolean);
  const tongzhouSkus = orderRecords.map((record) => jdyFieldText(record, orderFields.tongzhouSku)).filter(Boolean);
  const productSkus = orderRecords.map((record) => jdyFieldText(record, orderFields.productSku)).filter(Boolean);
  const [byCraftOrderNo, byTongzhouSku, byProductSku] = await Promise.all([
    fetchJdyDataByValues(craftOrder, craftOrder.fields.craftOrderNo, craftOrderNos, { maxPages: 10 }),
    fetchJdyDataByValues(craftOrder, craftOrder.fields.tongzhouSku, tongzhouSkus, { maxPages: 10 }),
    fetchJdyDataByValues(craftOrder, craftOrder.fields.productSku, productSkus, { maxPages: 10 }),
  ]);
  return mergeJdyRecords([...byCraftOrderNo, ...byTongzhouSku, ...byProductSku]);
}

export async function updateJdyOutsourcingOrderByNo(orderNo, values = {}) {
  const normalizedOrderNo = String(orderNo || "").trim();
  if (!normalizedOrderNo) throw new Error("缺少委外加工单号，无法回写工厂反馈。");
  const records = await fetchJdyDataByValues(JIANYUN_FORMS.outsourcingOrders, JIANYUN_FORMS.outsourcingOrders.fields.orderNo, [normalizedOrderNo], { maxPages: 2 });
  const exact = records.filter((record) => String(record?.[JIANYUN_FORMS.outsourcingOrders.fields.orderNo]?.value || record?.[JIANYUN_FORMS.outsourcingOrders.fields.orderNo] || "").trim() === normalizedOrderNo);
  if (exact.length !== 1) throw new Error(exact.length ? `委外加工单号 ${normalizedOrderNo} 存在重复记录，已停止回写。` : `未找到委外加工单 ${normalizedOrderNo}，无法回写工厂反馈。`);
  const dataId = exact[0]?._id || exact[0]?.data_id || exact[0]?.id;
  const data = Object.fromEntries(Object.entries(values).filter(([fieldId, value]) => fieldId && value !== undefined).map(([fieldId, value]) => [fieldId, { value }]));
  if (!Object.keys(data).length) return { ok: true, skipped: true, dataId };
  return { ok: true, skipped: false, dataId, result: await updateJdyData(JIANYUN_FORMS.outsourcingOrders, dataId, data) };
}

export async function fetchAllJdyProductionMaterials(outsourcingOrderNos = []) {
  const purchaseRecords = await fetchJdyDataByValues(
    JIANYUN_FORMS.purchaseOrders,
    JIANYUN_FORMS.purchaseOrders.fields.outsourcingOrderNo,
    outsourcingOrderNos,
    { chunkSize: 20, maxPages: 20 },
  );
  const purchaseOrderNos = purchaseRecords.map((record) => {
    const field = record?.[JIANYUN_FORMS.purchaseOrders.fields.orderNo];
    return field && typeof field === "object" && "value" in field ? field.value : field;
  });
  const inboundRecords = await fetchJdyDataByValues(
    JIANYUN_FORMS.purchaseInboundOrders,
    JIANYUN_FORMS.purchaseInboundOrders.fields.purchaseOrderNo,
    purchaseOrderNos,
    { chunkSize: 20, maxPages: 20 },
  );
  return { purchaseRecords, inboundRecords };
}
