import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

function headersFor(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function getJson(baseUrl, path, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: headersFor(token),
  });
  const body = await response.text();
  let data;
  try {
    data = body ? JSON.parse(body) : {};
  } catch {
    throw new Error(`${path} 返回了非 JSON 响应：${body.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(`${path} 请求失败（HTTP ${response.status}）：${JSON.stringify(data).slice(0, 500)}`);
  }
  return data;
}

function normalizeTypes(manifest, requestedTypes) {
  const accessible = new Set(
    (manifest.resources || [])
      .filter((resource) => resource.indexable && resource.accessible)
      .map((resource) => resource.type),
  );
  if (!requestedTypes?.length) return [...accessible];
  const unavailable = requestedTypes.filter((type) => !accessible.has(type));
  if (unavailable.length) {
    throw new Error(`当前身份无法校验这些资源类型：${unavailable.join(", ")}`);
  }
  return [...new Set(requestedTypes)];
}

export async function verifyAgentCoverage({
  baseUrl = "http://127.0.0.1:8787",
  token = "",
  types = [],
  pageSize = 500,
} = {}) {
  const normalizedBaseUrl = String(baseUrl).replace(/\/+$/, "");
  const manifest = await getJson(normalizedBaseUrl, "/api/agent/manifest", token);
  const selectedTypes = normalizeTypes(manifest, types);
  const typeQuery = encodeURIComponent(selectedTypes.join(","));
  const coverage = await getJson(
    normalizedBaseUrl,
    `/api/agent/coverage?types=${typeQuery}`,
    token,
  );
  const coverageByType = new Map((coverage.types || []).map((entry) => [entry.type, entry]));
  const errors = [];
  const results = [];

  for (const type of selectedTypes) {
    const expected = coverageByType.get(type);
    if (!expected) {
      errors.push(`[${type}] coverage 响应缺少该资源类型。`);
      continue;
    }

    let page = 1;
    let apiTotal = null;
    const ids = new Set();
    let enumerated = 0;

    while (true) {
      const payload = await getJson(
        normalizedBaseUrl,
        `/api/agent/resources/${encodeURIComponent(type)}?page=${page}&limit=${pageSize}`,
        token,
      );
      if (apiTotal === null) apiTotal = Number(payload.total || 0);
      if (apiTotal !== Number(payload.total || 0)) {
        errors.push(`[${type}] 分页期间 total 从 ${apiTotal} 变为 ${payload.total}，无法形成稳定全量快照。`);
        break;
      }
      for (const item of payload.items || []) {
        enumerated += 1;
        if (!item.id) errors.push(`[${type}] 第 ${enumerated} 条记录缺少 id。`);
        if (ids.has(item.id)) errors.push(`[${type}] 发现重复 id：${item.id}`);
        ids.add(item.id);
      }
      if (!payload.has_more) break;
      page += 1;
      if (page > 100000) {
        errors.push(`[${type}] 分页超过安全上限，可能存在游标或 has_more 错误。`);
        break;
      }
    }

    if (enumerated !== apiTotal) {
      errors.push(`[${type}] list 实际枚举 ${enumerated} 条，但接口 total=${apiTotal}。`);
    }
    if (enumerated !== Number(expected.enumerable_count || 0)) {
      errors.push(`[${type}] list 枚举 ${enumerated} 条，但 coverage enumerable_count=${expected.enumerable_count}。`);
    }
    if (enumerated !== Number(expected.source_count || 0)) {
      errors.push(`[${type}] 源数据 ${expected.source_count} 条，但 Agent 接口只能枚举 ${enumerated} 条。`);
    }
    if (ids.size !== enumerated) {
      errors.push(`[${type}] 枚举 ${enumerated} 条，但唯一 ID 只有 ${ids.size} 个。`);
    }
    if (Object.keys(expected.missing_required_fields || {}).length) {
      errors.push(`[${type}] 缺少必需元数据：${JSON.stringify(expected.missing_required_fields)}`);
    }
    if (Number(expected.duplicate_base_id_count || 0) > 0) {
      errors.push(`[${type}] 发现 ${expected.duplicate_base_id_count} 个重复源主键，不能保证稳定 ID。`);
    }
    if (Number(expected.fallback_id_count || 0) > 0) {
      errors.push(`[${type}] 有 ${expected.fallback_id_count} 条记录只能使用内容哈希 ID，源数据需要补稳定主键。`);
    }
    if (expected.source_complete === false) {
      errors.push(`[${type}] 上游数据源声明不完整：${expected.source_warning || "未提供原因"}`);
    }
    if (expected.complete !== true) {
      errors.push(`[${type}] 服务端 coverage 将该类型标记为不完整。`);
    }

    results.push({
      type,
      source_count: Number(expected.source_count || 0),
      enumerated_count: enumerated,
      unique_id_count: ids.size,
      pending_or_unsupported_attachments: Number(expected.pending_or_unsupported_attachments || 0),
      complete: expected.complete === true && enumerated === Number(expected.source_count || 0),
    });
  }

  if (errors.length) {
    throw new Error(`Agent 索引覆盖率校验失败：\n${errors.map((message) => `- ${message}`).join("\n")}`);
  }

  return {
    ok: true,
    base_url: normalizedBaseUrl,
    authorization_scope: manifest.authorization_scope,
    types: results,
    summary: {
      types: results.length,
      source_count: results.reduce((sum, entry) => sum + entry.source_count, 0),
      enumerated_count: results.reduce((sum, entry) => sum + entry.enumerated_count, 0),
      pending_or_unsupported_attachments: results.reduce(
        (sum, entry) => sum + entry.pending_or_unsupported_attachments,
        0,
      ),
    },
  };
}

const invokedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  const types = String(process.env.AGENT_TYPES || "")
    .split(",")
    .map((type) => type.trim())
    .filter(Boolean);
  try {
    const result = await verifyAgentCoverage({
      baseUrl: process.env.AGENT_BASE_URL || "http://127.0.0.1:8787",
      token: process.env.AGENT_TOKEN || "",
      types,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
