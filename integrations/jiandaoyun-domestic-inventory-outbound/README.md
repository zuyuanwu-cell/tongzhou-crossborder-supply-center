# 简道云 → 同舟国内仓出库插件

插件名称：`同舟-国内仓库存出库`

函数名称：`成品出库`

推荐运行环境：后端函数 / Node.js 20。目录同时提供 Python 3.10 版本。

## 安全规则

- 使用独立出库令牌，只能访问国内仓出库接口。
- 中台按 `来源类型 + 数据 ID + 子表行 ID/SKU + 出库批次 + 仓库 + SKU` 生成幂等键；流程重试不会重复扣库。
- 先在流程测试节点使用 `dryRun=是`，确认仓库、SKU、数量和批次校验通过，再切换为“否”。
- 多产品出库时按子表逐行调用，每一行必须传唯一 `sourceLineId`。

## 通用参数

| 名称 | ID | 必填 | 默认值/说明 |
|---|---|---:|---|
| 中台地址 | `apiBaseUrl` | 是 | `https://gyl.tongzhoukuajing.com` |
| 出库令牌 | `accessToken` | 是 | 与服务器 `JIANYUN_DOMESTIC_INVENTORY_OUTBOUND_PLUGIN_TOKEN` 一致 |

## 请求参数

| 名称 | ID | 必填 | 说明 |
|---|---|---:|---|
| 国内仓库 | `warehouse` | 是 | 优先传仓库编码，也支持精确名称或 ID |
| 简道云数据 ID | `sourceRecordId` | 是 | 当前记录 `_id`，用于防重复 |
| 子表行标识 | `sourceLineId` | 多产品必填 | 子表行 ID |
| 来源类型 | `sourceType` | 否 | 默认“简道云出库单” |
| 出库批次/次数 | `dispatchBatch` | 分批出库必填 | 同一来源分批出库时每次使用不同值 |
| 来源单号 | `referenceNo` | 否 | 领用单、发货单或调拨单号 |
| 出库时间 | `occurredAt` | 否 | 为空时使用中台接收时间 |
| 经办人 | `operatorName` | 否 | 操作人姓名 |
| 备注 | `note` | 否 | 出库说明 |
| 同舟 SKU | `sku` | 是 | 标准化后精确匹配 |
| 出库数量 | `quantity` | 是 | 必须大于 0 |
| 产品名称 | `productName` | 否 | 默认从当前仓库库存自动带入 |
| 单位 | `unit` | 否 | 默认从当前仓库库存自动带入 |
| 批次 ID | `lotId` | 否 | 指定后只扣该批次 |
| 批次号 | `lotNo` | 否 | 指定后只扣匹配批次 |
| 条码 | `barcode` | 否 | 指定后只扣匹配条码批次 |
| 仅校验不出库 | `dryRun` | 否 | `是` / `否`，正式流程选“否” |

不指定批次 ID、批次号或条码时，中台按先进先出自动分配库存批次。指定批次时库存不足会直接失败，不会改扣其他批次。

## 返回参数

建议在简道云表单中保存：`success`、`message`、`movementNo`、`warehouseName`、`sku`、`productName`、`quantity`、`beforeQty`、`afterQty`、`idempotentReplay`。

## 推荐触发条件

只在审批通过、出库数量大于 0、仓库和 SKU 均已填写时执行。首次联调使用 `dryRun=是`；正式启用前把通用令牌配置为专用出库令牌，并将 `dryRun` 改为“否”。

