# 仓库 WMS 板块接入计划

## 1. Provider 分层

当前仓库板块先按 WMS provider 建模：

- 俄罗斯 YunWMS
  - 文档：`https://fsdd.yunwms.com/api-doc/index.php`
  - 适用：俄罗斯多个仓库
  - 授权字段：`baseUrl`、`appKey`、`appSecret`、`warehouseCode`
- 斗仓 / 神牛 SEA WMS
  - 文档：`https://s.apifox.cn/422721aa-3e4e-48b3-89dd-eae8192f22ac/doc-4253934`
  - 适用：越南斗仓、马来神牛、印尼神牛
  - 授权字段：`baseUrl`、`clientId`、`clientSecret`、`warehouseCode`

## 2. 已建仓库连接

- 莫斯科一仓：俄罗斯 YunWMS，待授权
- 越南斗仓 A：SEA WMS，待授权
- 马来神牛一仓：SEA WMS，待授权
- 印尼神牛雅加达仓：SEA WMS，待授权

## 3. 已实现

- `GET /api/warehouses`
- `POST /api/warehouses`
- `POST /api/warehouses/sync`
- 前端仓库授权页面
- Provider 卡片
- 仓库连接清单
- 授权字段提示
- 新增仓库授权表单
- 仓库连接持久化到 `.cache/warehouse-connections.json`
- 多仓库、不同 baseUrl 的配置模型
- SEA WMS adapter 骨架
- SEA WMS 商品图片 `logoUrl` 标准化
- SEA WMS 库存字段标准化
- 产品中心图片兜底：简道云图片优先，仓库图片次之，最后使用本地视觉占位

## 4. 下一步

拿到每个仓库的真实授权参数后：

1. 把授权凭据保存到服务端环境变量或数据库，不进入前端。
2. 为每个 provider 实现 adapter。
3. 先接库存查询接口，生成标准结构：

```json
{
  "warehouseId": "id-shenniu-jakarta",
  "country": "印尼",
  "sku": "TZKJ-SJJ005",
  "countrySku": "印度尼西亚-TZKJ-SJJ005",
  "availableQty": 0,
  "lockedQty": 0,
  "inTransitQty": 0,
  "syncedAt": "2026-06-11T00:00:00.000Z"
}
```

4. 再接订单出库接口，生成日报。
5. 最后把库存和近 7/14/30 天销量合并进动销监控。

当前本地开发阶段已经支持在仓库页面录入授权。录入后的密钥会保存到服务端缓存文件，不会通过 `GET /api/warehouses` 回传给前端。

## 5. SEA WMS 环境变量

如果多个 SEA 仓库共用一套授权，可以先配置：

```bash
WMS_SEA_APP_KEY=
WMS_SEA_APP_SECRET=
```

如果某个仓库需要单独 baseUrl 或授权，用仓库 id 转大写下划线作为前缀：

```bash
WMS_VN_DOUCANG_A_BASE_URL=
WMS_VN_DOUCANG_A_APP_KEY=
WMS_VN_DOUCANG_A_APP_SECRET=
WMS_VN_DOUCANG_A_WAREHOUSE_CODE=

WMS_MY_SHENNIU_1_BASE_URL=
WMS_MY_SHENNIU_1_APP_KEY=
WMS_MY_SHENNIU_1_APP_SECRET=
WMS_MY_SHENNIU_1_WAREHOUSE_CODE=

WMS_ID_SHENNIU_JAKARTA_BASE_URL=
WMS_ID_SHENNIU_JAKARTA_APP_KEY=
WMS_ID_SHENNIU_JAKARTA_APP_SECRET=
WMS_ID_SHENNIU_JAKARTA_WAREHOUSE_CODE=
```

当前俄罗斯 YunWMS adapter 已预留，等拿到授权参数和实际返回样例后补齐字段映射。

## 6. 产品图片优先级

产品中心展示图片按以下顺序：

1. 简道云分销/直营产品库的产品图片
2. 简道云产品基础信息库的产品图片
3. 仓库 WMS 商品图片，例如 SEA WMS `logoUrl`
4. 本地分类视觉占位
