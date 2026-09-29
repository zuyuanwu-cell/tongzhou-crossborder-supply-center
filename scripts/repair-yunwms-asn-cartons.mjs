import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { repairYunAsnCartons } from "../server/wms-adapters.js";

function parseArgs(argv) {
  const values = {};
  const lines = [];
  for (const arg of argv) {
    if (arg === "--apply") values.apply = true;
    else if (arg.startsWith("--line=")) lines.push(arg.slice("--line=".length));
    else if (arg.startsWith("--") && arg.includes("=")) {
      const separator = arg.indexOf("=");
      values[arg.slice(2, separator)] = arg.slice(separator + 1);
    }
  }
  values.lines = lines;
  return values;
}

function required(value, name) {
  if (!String(value || "").trim()) throw new Error(`缺少 --${name}=...`);
  return String(value).trim();
}

function parseLine(value) {
  const [sku, quantity, cartonCount, unitsPerCarton, purchasePrice = "0", currency = "CNY"] = String(value).split(":");
  return {
    sku: required(sku, "line"),
    quantity: Number(quantity),
    cartonCount: Number(cartonCount),
    unitsPerCarton: Number(unitsPerCarton),
    purchasePrice: Number(purchasePrice),
    purchasePriceCurrency: currency || "CNY",
  };
}

const args = parseArgs(process.argv.slice(2));
const connectionsPath = resolve(args.connections || ".cache/warehouse-connections.json");
const connections = JSON.parse(readFileSync(connectionsPath, "utf8"));
const connectionId = required(args["connection-id"], "connection-id");
const connection = connections.find((item) => String(item.id) === connectionId);
if (!connection) throw new Error(`未找到仓库连接 ${connectionId}`);
if (!args.lines.length) throw new Error("至少需要一个 --line=SKU:总件数:箱数:每箱件数");

const result = await repairYunAsnCartons(connection, {
  receivingCode: required(args.receiving, "receiving"),
  referenceNo: required(args.reference, "reference"),
  eta: args.eta || "",
  carrier: args.carrier || "",
  transportMode: args.transport || "",
  trackingNo: args.tracking || "",
  customerNote: args.note || "",
  lines: args.lines.map(parseLine),
}, { apply: Boolean(args.apply) });

console.log(JSON.stringify(result, null, 2));
if (!args.apply && !result.alreadyCorrect) {
  console.log("预检通过；确认备份后，增加 --apply 才会修改 YunWMS 原入库单。");
}
