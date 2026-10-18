import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createStockupDispatchDocumentService } from "../server/stockup-dispatch-documents.js";

const outputDir = mkdtempSync(resolve(tmpdir(), "stockup-dispatch-pdf-"));
try {
  const service = createStockupDispatchDocumentService({ outputDir });
  const result = service.generate({
    id: "shipment-1",
    shipmentNo: "FY-20261018-001",
    wmsOrderNo: "SEA-001",
    destinationWarehouseName: "雅加达仓",
    transportMode: "海运",
    packages: 2,
    totalWeightKg: 10,
    totalVolumeM3: 0.048,
    documentVersion: 0,
    forwarderSnapshot: {
      forwarderName: "测试货代",
      locationName: "深圳收货点",
      address: "深圳市测试路 1 号",
      contactName: "张三",
      contactPhone: "13800000000",
      routingRequirements: "外箱贴箱唛",
    },
    lines: [{ sku: "ID-TEST-001", productName: "测试商品", shippedQty: 20, unit: "件", cartonCount: 2, unitsPerCarton: 10 }],
  });

  assert.equal(result.documents.length, 2);
  const packing = result.documents.find((item) => item.documentType === "packing_list");
  const marks = result.documents.find((item) => item.documentType === "carton_marks");
  assert.ok(packing);
  assert.ok(marks);
  assert.match(packing.sha256, /^[a-f0-9]{64}$/);
  assert.match(marks.sha256, /^[a-f0-9]{64}$/);

  const packingPdf = readFileSync(packing.filePath).toString("latin1");
  const marksPdf = readFileSync(marks.filePath).toString("latin1");
  assert.ok(packingPdf.startsWith("%PDF-1.4"));
  assert.ok(marksPdf.startsWith("%PDF-1.4"));
  assert.match(packingPdf, /\/MediaBox \[0 0 595\.28 841\.89\]/);
  assert.match(marksPdf, /\/MediaBox \[0 0 283\.46 283\.46\]/);
  assert.match(marksPdf, /\/Count 2/);
  assert.equal(packing.snapshot.version, 1);
  assert.equal(packing.snapshot.forwarderSnapshot.address, "深圳市测试路 1 号");

  console.log("stockup dispatch PDF tests passed");
} finally {
  rmSync(outputDir, { recursive: true, force: true });
}

