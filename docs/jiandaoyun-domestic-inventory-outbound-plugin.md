# 简道云国内仓库存出库插件接口

## 用途

用于简道云发货单、领用单或其他审批通过后的业务记录，将一个成品 SKU 精确登记为同舟中台国内仓出库。

插件只开放出库能力，不可调用入库、调整、调拨、仓库维护或其他中台接口。产品名称、图片、规格和单位优先读取指定仓库现有库存，简道云主要维护仓库、SKU、数量和业务单号即可。

## 接口

`POST /api/integrations/jiandaoyun/domestic-inventory/outbound`

请求头：

```http
Authorization: Bearer <JIANYUN_DOMESTIC_INVENTORY_OUTBOUND_PLUGIN_TOKEN>
Content-Type: application/json
```

最小请求：

```json
{
  "warehouse": "CN-GZ-01",
  "sourceRecordId": "简道云数据ID",
  "sourceLineId": "子表行ID",
  "sourceType": "发货出库单",
  "referenceNo": "CKSQ-2026-001",
  "sku": "TZKJ-TEST-001",
  "quantity": 100
}
```

指定批次出库：

```json
{
  "warehouse": "CN-GZ-01",
  "sourceRecordId": "简道云数据ID",
  "sourceLineId": "子表行ID",
  "sourceType": "发货出库单",
  "dispatchBatch": "第1次发货",
  "referenceNo": "CKSQ-2026-001",
  "occurredAt": "2026-09-28T08:00:00.000Z",
  "operatorName": "仓库经办人",
  "sku": "TZKJ-TEST-001",
  "quantity": 100,
  "lotNo": "LOT-202609-A",
  "barcode": "690000000001"
}
```

`lotId`、`lotNo`、`barcode` 均为可选批次定位条件。传入任一条件后，库存不足不会自动改扣其他批次；全部不传时按先进先出分配。

调试时增加 `"dryRun": true`，服务端会完成仓库、SKU、可用库存和批次库存校验，但不会扣库。

## 幂等规则

服务器按以下字段生成幂等键：

```text
sourceType + sourceRecordId + (sourceLineId 或 SKU) + dispatchBatch + warehouse + SKU
```

- 首次成功出库返回 HTTP 201。
- 相同业务身份再次触发返回 HTTP 200 与 `idempotentReplay: true`，不重复扣库。
- 同一条记录需要分批出库时，每次必须传不同的 `dispatchBatch`。

## 成功响应

```json
{
  "ok": true,
  "message": "国内仓库存出库成功。",
  "movementId": "dim_xxx",
  "movementNo": "CK-20260928-ABCDE",
  "warehouseId": "dwh_xxx",
  "warehouseCode": "CN-GZ-01",
  "warehouseName": "广州成品仓",
  "sku": "TZKJ-TEST-001",
  "productName": "测试成品",
  "unit": "件",
  "quantity": 100,
  "beforeQty": 500,
  "afterQty": 400,
  "idempotentReplay": false
}
```

常见错误码：`unauthorized`、`warehouse_not_found`、`stock_not_found`、`insufficient_stock`、`insufficient_lot_stock`、`invalid_quantity`。

## 环境变量

```env
JIANYUN_DOMESTIC_INVENTORY_OUTBOUND_PLUGIN_TOKEN=<至少48字节随机令牌>
```

服务器修改令牌后需要重启 API 服务，并在简道云插件通用参数 `accessToken` 中填入相同值。不要与入库插件共用令牌。

