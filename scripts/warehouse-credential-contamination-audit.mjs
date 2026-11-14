import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

function parseArgs(argv) {
  const result = { cacheDir: resolve(".cache"), output: "" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--cache-dir") result.cacheDir = resolve(argv[index + 1] || result.cacheDir);
    if (argv[index] === "--output") result.output = resolve(argv[index + 1] || "");
  }
  return result;
}

function jsonFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return entry.name.startsWith(".") ? [] : jsonFiles(path);
    return entry.isFile() && entry.name.endsWith(".json") ? [path] : [];
  });
}

function text(value) {
  return String(value ?? "").trim();
}

function collectLegacyEvidence(value, file, path = "$") {
  if (!value || typeof value !== "object") return [];
  const rows = [];
  if (!Array.isArray(value)) {
    const borrowedFrom = text(value.credentialFallbackFrom || value.credentialsBorrowedFrom || value.credentialSourceWarehouseId || value.fallbackCredentialWarehouseId);
    if (borrowedFrom) {
      rows.push({
        severity: "high",
        evidenceType: "explicit_credential_fallback",
        file: basename(file),
        jsonPath: path,
        warehouseId: text(value.warehouseId || value.id),
        warehouseName: text(value.warehouseName || value.name),
        actualCredentialSource: borrowedFrom,
        taskId: text(value.taskId || value.jobId || value.syncId),
        occurredAt: text(value.syncedAt || value.updatedAt || value.createdAt || value.startedAt),
        inventoryRows: Number(value.inventoryRows || value.rowCount || 0) || 0,
        orderRows: Number(value.orderRows || value.orderCount || 0) || 0,
      });
    }
  }
  Object.entries(value).forEach(([key, child]) => {
    if (child && typeof child === "object") rows.push(...collectLegacyEvidence(child, file, `${path}.${key}`));
  });
  return rows;
}

function hasCredentials(connection) {
  return Boolean(text(connection?.appKey) && text(connection?.appSecret));
}

function connectionRisks(payload) {
  const connections = Array.isArray(payload) ? payload : Array.isArray(payload?.connections) ? payload.connections : [];
  return connections.flatMap((connection) => {
    if (hasCredentials(connection) || text(connection?.status) === "已停用") return [];
    const sibling = connections.find((candidate) => candidate !== connection
      && text(candidate?.providerId) === text(connection?.providerId)
      && text(candidate?.baseUrl).replace(/\/+$/, "") === text(connection?.baseUrl).replace(/\/+$/, "")
      && hasCredentials(candidate));
    if (!sibling) return [];
    return [{
      severity: "medium",
      evidenceType: "historical_fallback_risk",
      file: "warehouse-connections.json",
      warehouseId: text(connection?.id),
      warehouseName: text(connection?.name),
      actualCredentialSource: text(sibling?.id),
      sourceWarehouseName: text(sibling?.name),
      taskId: "",
      occurredAt: "",
      inventoryRows: 0,
      orderRows: 0,
      note: "目标仓库缺少独立凭据，但同系统存在其他已配置仓库；仅列为历史风险，不代表已经串仓。",
    }];
  });
}

const args = parseArgs(process.argv.slice(2));
const files = jsonFiles(args.cacheDir);
const evidence = [];
const unreadableFiles = [];
let connectionsPayload = null;

for (const file of files) {
  try {
    const payload = JSON.parse(readFileSync(file, "utf8"));
    evidence.push(...collectLegacyEvidence(payload, file));
    if (basename(file) === "warehouse-connections.json") connectionsPayload = payload;
  } catch (error) {
    unreadableFiles.push({ file: basename(file), message: error.message });
  }
}
if (connectionsPayload) evidence.push(...connectionRisks(connectionsPayload));

const report = {
  reportType: "warehouse_credential_contamination_audit",
  generatedAt: new Date().toISOString(),
  cacheDirectory: args.cacheDir,
  readOnly: true,
  automaticCorrection: false,
  filesInspected: files.length,
  unreadableFiles,
  summary: {
    totalFindings: evidence.length,
    explicitFallbackEvidence: evidence.filter((item) => item.evidenceType === "explicit_credential_fallback").length,
    historicalRiskOnly: evidence.filter((item) => item.evidenceType === "historical_fallback_risk").length,
    affectedInventoryRows: evidence.reduce((sum, item) => sum + item.inventoryRows, 0),
    affectedOrderRows: evidence.reduce((sum, item) => sum + item.orderRows, 0),
  },
  findings: evidence,
};

const output = `${JSON.stringify(report, null, 2)}\n`;
if (args.output) writeFileSync(args.output, output, { encoding: "utf8", flag: "w" });
else process.stdout.write(output);
