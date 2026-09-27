# 简道云国内库存入库插件接口

## 用途

用于简道云委外入库、生产入库或其他审批通过后的业务记录，将一个成品 SKU 精确登记到同舟中台国内库存。

接口仅开放“入库”能力，不接受出库、库存调整、仓库档案维护或其他中台操作。

## 接口

`POST /api/integrations/jiandaoyun/domestic-inventory/inbound`

请求头：

```http
Authorization: Bearer <JIANYUN_DOMESTIC_INVENTORY_PLUGIN_TOKEN>
Content-Type: application/json
```

最小请求：

```json
{
  "warehouse": "CN-GZ-01",
  "sourceRecordId": "简道云数据ID",
  "sourceType": "委外入库单",
  "referenceNo": "WWRK-2026-001",
  "sku": "TZKJ-TEST-001",
  "productName": "测试成品",
  "quantity": 100,
  "unit": "件"
}
```

按箱入库：

```json
{
  "warehouse": "CN-GZ-01",
  "sourceRecordId": "简道云数据ID",
  "sourceLineId": "子表行ID",
  "receiptBatch": "第1次到货",
  "sourceType": "委外入库单",
  "referenceNo": "WWRK-2026-001",
  "occurredAt": "2026-09-27T08:00:00.000Z",
  "sku": "TZKJ-TEST-001",
  "productName": "测试成品",
  "quantity": 101,
  "unit": "件",
  "unitCostCny": 3.58,
  "packagingMode": "carton",
  "cartonCount": 10,
  "unitsPerCarton": 10,
  "looseQuantity": 1,
  "cartonLengthCm": 40,
  "cartonWidthCm": 30,
  "cartonHeightCm": 20,
  "cartonWeightKg": 8.5,
  "lotNo": "LOT-20260927",
  "barcode": "690000000001",
  "productionDate": "2026-09-20",
  "expiryDate": "2029-09-19"
}
```

调试请求在以上 JSON 中增加 `"dryRun": true`。服务器会完成仓库、SKU、数量、箱规、批次日期等校验，但不会写库存。

## 幂等规则

服务器根据以下字段生成幂等键：

```text
sourceType + sourceRecordId + (sourceLineId 或 SKU) + receiptBatch + warehouse + SKU
```

- 相同业务身份重复触发时返回 HTTP 200、`idempotentReplay: true`，不重复增加库存。
- 首次成功入库返回 HTTP 201。
- 同一数据记录需要分批入库时，必须为每次到货传不同的 `receiptBatch`。

## 返回示例

```json
{
  "ok": true,
  "message": "国内库存入库成功。",
  "movementId": "dim_xxx",
  "movementNo": "RK-20260927-ABCDE",
  "warehouseId": "dwh_xxx",
  "warehouseCode": "CN-GZ-01",
  "warehouseName": "广州成品仓",
  "sku": "TZKJ-TEST-001",
  "quantity": 101,
  "idempotencyKey": "jdy-inbound-..."
}
```

## 环境变量

```env
JIANYUN_DOMESTIC_INVENTORY_PLUGIN_TOKEN=<至少48字节随机令牌>
```

正式环境修改令牌后需要重启 API 服务，并同步更新简道云插件的 `accessToken` 通用参数。
