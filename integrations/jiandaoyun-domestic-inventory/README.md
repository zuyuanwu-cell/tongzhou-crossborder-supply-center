# 简道云 → 同舟国内库存入库插件

插件名称：`同舟-国内库存入库`

函数名称：`成品入库`

运行环境：后端函数 / Node.js 20。

## 安全与幂等

- 插件使用专用 `accessToken`，该令牌只能调用国内库存入库接口，不能出库、调整库存或调用其他中台接口。
- 中台使用 `sourceType + sourceRecordId + sourceLineId/SKU + receiptBatch + 仓库 + SKU` 生成幂等键。同一条业务记录重复执行，只返回原入库单，不会重复加库存。
- 调试时将 `dryRun` 设为 `是`，只校验参数，不写库存。
- 流程插件节点不支持整张子表直接入参，因此插件按一个 SKU 一次调用。多产品委外入库请在流程中逐行调用，并将子表行标识传入 `sourceLineId`。

## 通用参数

| 名称 | ID | 类型 | 必填 | 默认值 |
|---|---|---|---|---|
| 中台地址 | `apiBaseUrl` | 文本 | 是 | `https://gyl.tongzhoukuajing.com` |
| 入库令牌 | `accessToken` | 文本 | 是 | 由中台生成，勿放在普通表单字段中 |

## 请求参数

| 名称 | ID | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| 国内仓库 | `warehouse` | 文本 | 是 | 优先传仓库编码，也支持精确仓库名称或 ID |
| 简道云数据 ID | `sourceRecordId` | 文本 | 是 | 当前入库记录 `_id`，用于防重复 |
| 子表行标识 | `sourceLineId` | 文本 | 否 | 多产品时建议传子表行 ID |
| 来源类型 | `sourceType` | 文本 | 否 | 如“委外入库单”，默认“简道云委外入库” |
| 入库批次/次数 | `receiptBatch` | 文本 | 否 | 同一记录分批入库时必填不同值 |
| 来源单号 | `referenceNo` | 文本 | 否 | 委外入库单号、生产单号等 |
| 入库时间 | `occurredAt` | 日期时间 | 否 | 为空时使用中台接收时间 |
| 经办人 | `operatorName` | 文本 | 否 | 操作人姓名 |
| 备注 | `note` | 文本 | 否 | 入库说明 |
| 产品 ID | `productId` | 文本 | 否 | 中台产品 ID |
| 同舟 SKU | `sku` | 文本 | 是 | 精确 SKU |
| 产品名称 | `productName` | 文本 | 是 | 成品名称 |
| 产品图片 | `imageUrl` | 文本 | 否 | 图片 URL |
| 规格型号 | `specification` | 文本 | 否 | 产品规格 |
| 单位 | `unit` | 文本 | 否 | 默认“件” |
| 入库数量 | `quantity` | 数字 | 是 | 必须大于 0 |
| 人民币单位成本 | `unitCostCny` | 数字 | 否 | 用于库存成本留档 |
| 入库方式 | `packagingMode` | 下拉框 | 否 | `按件` / `按箱`，默认按件 |
| 箱数 | `cartonCount` | 数字 | 按箱必填 | 正整数 |
| 单箱数量 | `unitsPerCarton` | 数字 | 按箱必填 | 正整数 |
| 零散数量 | `looseQuantity` | 数字 | 否 | 默认 0 |
| 箱长 cm | `cartonLengthCm` | 数字 | 按箱必填 | 大于 0 |
| 箱宽 cm | `cartonWidthCm` | 数字 | 按箱必填 | 大于 0 |
| 箱高 cm | `cartonHeightCm` | 数字 | 按箱必填 | 大于 0 |
| 单箱重量 kg | `cartonWeightKg` | 数字 | 按箱必填 | 大于 0 |
| 批次号 | `lotNo` | 文本 | 否 | 可追溯批次 |
| 产品条码 | `barcode` | 文本 | 否 | 条码/EAN |
| 生产日期 | `productionDate` | 日期时间 | 否 | 中台只保存日期 |
| 有效期 | `expiryDate` | 日期时间 | 否 | 不得早于生产日期 |
| 仅校验不入库 | `dryRun` | 下拉框 | 否 | `否` / `是`，正式流程选“否” |

按箱入库时必须满足：`入库数量 = 箱数 × 单箱数量 + 零散数量`。

## 返回参数

| 名称 | ID | 类型 |
|---|---|---|
| 是否成功 | `success` | any |
| 提示信息 | `message` | any |
| 是否仅校验 | `dryRun` | any |
| 中台入库单 ID | `movementId` | any |
| 中台入库单号 | `movementNo` | any |
| 仓库 ID | `warehouseId` | any |
| 仓库编码 | `warehouseCode` | any |
| 仓库名称 | `warehouseName` | any |
| 同舟 SKU | `sku` | any |
| 入库数量 | `quantity` | any |
| 是否重复触发 | `idempotentReplay` | any |

## 推荐的委外入库触发条件

仅当审批通过、入库数量大于 0、国内仓库不为空、同舟 SKU 不为空时执行。流程第一次联调请开启 `dryRun=是`，确认返回“校验通过，未写入库存”后再切换为 `否`。
