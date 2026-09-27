# 国内仓进销存 API

## 认证与权限

业务接口使用中台登录令牌：`Authorization: Bearer <登录令牌>`。接口始终叠加用户的仓库和 SKU 数据范围，不能通过传参访问范围外数据。

| 权限 | 能力 |
| --- | --- |
| `domestic_inventory_view` | 余额、仓库、流水、批次和备货可用量查询 |
| `domestic_inventory_receive` | 采购入库、批次号/条码/生产日期维护 |
| `domestic_inventory_issue` | 领用和出库 |
| `domestic_inventory_adjust` | 盘盈、盘亏与库存调整 |
| `domestic_inventory_manage` | 仓库档案、期初导入、安全库存；同时兼容全部库存写操作 |

仓库角色默认拥有查看、入库、出库和调整权限，不默认拥有仓库档案管理权限。管理员拥有全部权限。旧账号已单独配置的 `domestic_inventory_manage` 继续有效。

OpenAPI：`GET /api/domestic-inventory/openapi.json`（需要登录且具备查看权限）。Agent API Key 只读访问方式见下方“Agent 资源”。

简道云委外/生产入库使用受限的插件专用接口，不复用登录令牌，详见 [简道云国内库存入库插件接口](./jiandaoyun-domestic-inventory-plugin.md)。

## 查询接口

- `GET /api/domestic-inventory`：库存汇总、仓库统计和 SKU 余额。
- `GET /api/domestic-inventory/warehouses`：轻量仓库列表。
- `GET /api/domestic-inventory/movements`：库存流水列表，支持 `warehouseId`、`type`、`keyword`。
- `GET /api/domestic-inventory/movements/{id}`：单据详情，包含入库批次或出库批次分配。
- `GET /api/domestic-inventory/lots`：批次列表，支持 `warehouseId`、`sku`、`barcode`、`lotNo`、`keyword`、`availableOnly=1`、`limit`、`offset`。
- `GET /api/domestic-inventory/stockup-availability?warehouseId=...&skus=SKU1,SKU2`：供海外仓备货使用的国内库存可用量、可用批次和整箱数，单次最多 100 个 SKU。

`stockup-availability` 会分别返回：

- `availableQty`：总可用件数；
- `knownLotQty`：有批次子账的可用件数；
- `untrackedQty`：上线批次能力前形成的历史库存；
- `cartonProfiles`：每种箱规的可用数量、完整箱数和零散数量；
- `lots`：可用批次、条码、生产日期和有效期。

## 入库、出库与调整

`POST /api/domestic-inventory/movements`，建议每次发送唯一的 `Idempotency-Key` 请求头。

按件入库示例：

```json
{
  "warehouseId": "dwh_xxx",
  "type": "inbound",
  "referenceNo": "PO-202609-001",
  "lines": [{
    "sku": "TZKJ-DEMO-001",
    "productName": "示例产品",
    "unit": "件",
    "quantity": 120,
    "unitCostCny": 9.9,
    "lotNo": "LOT-202609-A",
    "barcode": "690000000001",
    "productionDate": "2026-09-20",
    "expiryDate": "2029-09-19"
  }]
}
```

按箱入库示例：

```json
{
  "warehouseId": "dwh_xxx",
  "type": "inbound",
  "referenceNo": "PO-202609-002",
  "lines": [{
    "sku": "TZKJ-DEMO-002",
    "productName": "示例产品二",
    "unit": "件",
    "packagingMode": "carton",
    "cartonCount": 10,
    "unitsPerCarton": 24,
    "looseQuantity": 3,
    "quantity": 243,
    "cartonLengthCm": 42,
    "cartonWidthCm": 31,
    "cartonHeightCm": 28,
    "cartonWeightKg": 11.5,
    "lotNo": "LOT-202609-B",
    "barcode": "690000000002",
    "productionDate": "2026-09-21"
  }]
}
```

服务端会校验：`quantity = cartonCount × unitsPerCarton + looseQuantity`。按箱入库必须填写箱子长、宽、高和单箱重量。第一版一条 SKU 明细对应一种箱规；同次到货存在多种箱规时，应拆成多张入库单，避免后续备货自动取箱时产生歧义。

出库与盘亏按先进先出扣减已知批次。历史库存不足以映射到批次时，差额记录为 `legacy_untracked`，总库存仍保持准确。

## 其他写接口

- `POST /api/domestic-inventory/opening-import`：期初库存导入，仅档案管理权限。
- `PATCH /api/domestic-inventory/lots/{id}`：仅修改 `lotNo`、`barcode`、`productionDate`、`expiryDate`；已发生库存流水后不允许改写箱数和数量。
- `PATCH /api/domestic-inventory/balances/{warehouseId}/{sku}`：维护安全库存。
- `POST /api/domestic-inventory/warehouses`、`PATCH /api/domestic-inventory/warehouses/{id}`：仓库档案。

## Agent 资源

有 `domestic_inventory_view` 权限的个人 Agent Key 可读取：

- `domestic_inventory_balance`
- `domestic_inventory_lot`
- `domestic_inventory_movement`

示例：`GET /api/agent/search?q=TZKJ&types=domestic_inventory_balance,domestic_inventory_lot`。Agent Key 不能调用库存写接口。
