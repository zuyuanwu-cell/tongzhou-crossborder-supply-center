import assert from "node:assert/strict";
import { resolveWarehouseBinding } from "../server/warehouse-binding.js";

const existingYun = {
  providerId: "yunwms_ru",
  warehouseCode: "",
  warehouseId: "DD002",
  resolvedWarehouseId: "DD002",
};

assert.deepEqual(
  resolveWarehouseBinding({ providerId: "yunwms_ru", warehouseCode: "DD001", warehouseId: "DD002" }, existingYun),
  { warehouseCode: "DD001", warehouseId: "DD001", resolvedWarehouseId: "DD001" },
);
assert.deepEqual(
  resolveWarehouseBinding({ providerId: "yunwms_ru", warehouseCode: "" }, existingYun),
  { warehouseCode: "DD002", warehouseId: "DD002", resolvedWarehouseId: "DD002" },
);
assert.deepEqual(
  resolveWarehouseBinding({ providerId: "yunwms_ru", warehouseCode: "MX001" }, null),
  { warehouseCode: "MX001", warehouseId: "MX001", resolvedWarehouseId: "MX001" },
);

const existingSea = {
  providerId: "sea_wms",
  warehouseCode: "ID-JKT",
  warehouseId: "56064",
  resolvedWarehouseId: "56064",
};
assert.deepEqual(
  resolveWarehouseBinding({ providerId: "sea_wms", warehouseCode: "ID-JKT", warehouseId: "56065" }, existingSea),
  { warehouseCode: "ID-JKT", warehouseId: "56065", resolvedWarehouseId: "56065" },
);

console.log("warehouse binding tests passed");
