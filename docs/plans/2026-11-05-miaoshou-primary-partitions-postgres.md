# 妙手主来源、按店铺切换、分区物化与 PostgreSQL 汇总（第二阶段）

对应评审：《妙手订单对接与数据时效评审》P1 全部 + P2 第 3～5 项。

## 1. 店铺按妙手店铺 ID 人工绑定

- 店铺目录新增 `shopMiaoshouBindings`：管理员可把 WMS 店铺绑定到指定妙手店铺、设为「不关联妙手」，或恢复自动匹配。
- 人工绑定优先于名称匹配；绑定的妙手店铺失效时退回自动匹配并提示。名称不完全一致时给出「建议」店铺。
- 接口：`PATCH /api/shop-directory/miaoshou-binding { shopKey, miaoshouShopId }`（字符串=绑定，空字符串=不关联，`null`=恢复自动）。

## 2. 按店铺对账与切换

- 对账结果新增 `shops[]`：每家店的匹配率、数量/金额差异、退款终态识别、已取消已出库、未出库妙手订单数和阻断项。单店至少 10 单已匹配才参与判定；同平台有售后缺口时阻断。
- 收入模式新增 `per_shop`：只有「启用 + 单店达标」的店铺使用妙手。旧的全局 `miaoshou` 模式保留。
- 接口：`PATCH /api/performance-analytics/miaoshou-shops { shopKeys, enabled }`。第一次启用时自动从影子核对切到按店铺模式。
- 对账页新增「按店铺切换」表：可筛选、搜索、逐店启用/停用、一键启用全部达标店铺，并在表内直接绑定妙手店铺。

## 3. 妙手成为已切换店铺的订单主来源

对生效店铺：

- WMS 已出库订单的金额改用妙手（所选口径，扣除已完成退款），**日期改为站点当地支付日期**（印尼、越南、泰国 UTC+7，马来、新加坡、菲律宾 UTC+8），与平台后台和店铺日报一致。
- 补入只在妙手里、还没有 WMS 出库记录的订单（未发货、平台履约），按商品行生成事实，`sourceSystem = miaoshou`、`fulfillmentStatus = pending_wms`；已取消、未付款的不补。出库后会自动与 WMS 记录合并，不会重复。
- 未生效的店铺保持原来的 WMS 口径和出库日期。
- 已知限制：WMS 里从未出现过的店铺（全部平台履约）不在店铺目录中，暂不能切换。

## 4. 按天分区物化

- 对账后的事实按「订单最早日期」分区（整单在同一分区，打包费仍按整单计算）。
- 分区哈希 = 全局规则（产品、打包费、补录成本）+ 截至分区日期的汇率 + 分区内事实内容。只重算哈希变化的日期；新汇率只影响生效日期之后的分区。
- 分区文件写在 `.cache/performance-partitions/`，文件名带哈希，保留上一版，读写互不干扰。
- 查询线程改为常驻：新版本只重新读取变化的分区，不再整份重载快照；分区模式下不再写 1 份完整快照。
- 单元测试验证：分区结果与全量物化逐行一致。

## 5. 日汇总与 PostgreSQL

- 每个分区同时产出「店铺 × 日」「SKU × 日」两级汇总（订单数在店铺级可加总）。
- 配置 `ANALYTICS_DATABASE_URL` 时汇总写入 PostgreSQL，只同步变化的分区；未配置或 PostgreSQL 异常时使用内存 / 分区文件，结果一致。部署见 `docs/analytics-postgres.md`。
- 新接口：`GET /api/performance-analytics/summary?groupBy=total|day|shop|warehouse|country|platform|projectGroup|source|shopDay|sku|brand&dateFrom&dateTo&country&warehouseId&platform&shopKey&projectGroup&brand&revenueSource`，按经营金额/成本/利润权限裁剪字段，并遵守账号数据范围。

## 未做 / 下一步

- 经营贡献主页面的榜单、明细仍走查询线程（已改为增量刷新）；可以逐步把 KPI、趋势、品牌榜单切到汇总接口。
- 设置、汇率、妙手原始订单仍在 sql.js 文件库；如需进一步减轻主线程写盘，可把这些表迁到同一个 PostgreSQL。
