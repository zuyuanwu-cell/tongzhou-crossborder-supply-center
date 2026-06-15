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
  const [baseRecords, catalogRecords] = await Promise.all([
    fetchJdyDataList(JIANYUN_FORMS.productBase),
    fetchJdyDataList(JIANYUN_FORMS.productCatalog),
  ]);

  return { baseRecords, catalogRecords };
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
  const merged = new Map();
  for (const record of [...defaultRecords, ...inProductionRecords]) {
    const id = record?._id || record?.data_id || record?.id || JSON.stringify(record);
    merged.set(id, record);
  }
  return [...merged.values()];
}
