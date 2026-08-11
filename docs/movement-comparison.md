# 动销与库存对比

“动销分析”页面支持按周、月、季度、年或指定时间段比较某个仓库的 SKU 状态。对比采用本期最后一个快照和上期最后一个快照，逐个展示正常、慢销、滞销及其他状态是否发生变化。

## 库存消耗对账口径

```text
期初在库 = 基期快照可售数量 + 基期快照锁定数量
理论期末 = 期初在库 - 两次快照之间的已出库订单数量
库存差异 = 实际期末在库 - 理论期末在库
```

在途库存不计入在库。系统目前没有统一入库、退货和盘点调整流水，因此：

- 正差异可能来自入库、退货、盘盈或正向库存调整。
- 负差异可能来自未同步出库、盘亏、报损或负向库存调整。
- 默认异常阈值为绝对差异至少 5 件，并且差异率至少 5%。
- 当订单缓存不能完整覆盖两次快照之间的日期时，结果标记为“订单覆盖不足”，仅作为排查线索。

## API

管理员会话或管理员在“API 接入”页面创建的 `tzai_` Agent API Key 可调用：

```http
GET /api/movement-history/compare?period=month&anchorDate=2026-08-11&warehouseId=<warehouse-id>&timezone=Asia/Shanghai
```

Agent Key 使用标准 Bearer 认证：

```http
Authorization: Bearer tzai_<YOUR_API_KEY>
```

该接口为只读计算能力，实时复用当前账号权限。只有管理员 Key 可以调用；直营、分销、游客或已停用账号均返回 `401`。接口已声明在 `/api/agent/openapi.json` 和 `/api/agent/manifest` 的 `operations` 中。

`period` 支持 `week`、`month`、`quarter`、`year` 和 `custom`。自定义周期使用 `from`、`to`；系统默认选择紧邻且天数相同的前一段作为基期。

响应包含：

- `summary`：正常、慢销、滞销、改善、恶化和库存异常 SKU 数量。
- `inventorySummary`：仓库整体期初、出库、理论期末、实际期末和差异。
- `rows`：每个仓库/SKU的前后状态、库存对账结果、订单覆盖情况和排查提示。
