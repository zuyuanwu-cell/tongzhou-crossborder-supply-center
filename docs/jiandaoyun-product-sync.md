# 简道云产品同步接入说明

## 1. 同步范围

当前已接入两个简道云表单的同步抽象：

- 产品基础信息库
  - 应用 ID：`6694ed87e77ca045d563d581`
  - 表单 ID：`6756bedd6e3c85a3ea67d375`
- 分销和直营产品库
  - 应用 ID：`6694ed87e77ca045d563d581`
  - 表单 ID：`67f3d481b3fa6711aab2588f`

同步接口会先读取产品基础信息，再读取产品库，并按 `sku_no / SKU` 关联基础信息、分类、单位、品牌等字段。

## 2. 本地环境变量

复制 `.env.example` 为 `.env`，填入：

```bash
JIANYUN_API_KEY=你的简道云 API Key
JIANYUN_API_HOST=https://api.jiandaoyun.com
INTERNAL_ACCESS_CODE=请改成内部访问码
API_PORT=8787
```

没有配置 `JIANYUN_API_KEY` 时，系统会使用样例数据，便于前端继续开发。

## 3. 运行方式

分别启动：

```bash
npm run api
npm run dev
```

也可以同时启动：

```bash
npm run dev:all
```

网页端默认读取：

```bash
http://localhost:8787/api/products
```

## 4. 权限边界

- 公开产品库：不需要登录，只返回分销产品，不返回直营价、产品基础信息原始记录和内部字段。
- 内部产品库：需要访问码，返回直营和分销产品，并显示直营价。
- 同步按钮：仅内部登录后可见。
- 同步接口：`POST /api/products/sync` 仅允许内部访问码调用。

当前本地开发默认访问码是 `admin123`。正式部署必须通过 `.env` 改掉。

## 5. 字段映射

字段映射集中在：

```bash
server/field-mapping.js
```

你给出的字段样例已经先映射为：

### 产品基础信息

- `skuNo`: `sku_no`
- `sku`: `sku`
- `productName`: `product_name`
- `productNameEn`: `product_name_en`
- `unit`: `unit`
- `category`: `_widget_1733739239160`
- `brand`: `_widget_1755611852775`
- `imageFiles`: `_widget_1734174872134`
- `launchDate`: `_widget_1751037635487`

### 分销和直营产品库

- `skuNo`: `_widget_1744033159644`
- `country`: `_widget_1744033213779`
- `sku`: `_widget_1744033490763`
- `skuType`: `_widget_1758184515867`
- `category`: `_widget_1744106911139`
- `productNameCn`: `_widget_1744033490764`
- `productNameEn`: `_widget_1744033490765`
- `unit`: `_widget_1744033490766`
- `directPrice`: `_widget_1750297769188`
- `directCurrency`: `_widget_1750297769189`
- `distributionCost`: `_widget_1744033582426`
- `distributionCurrency`: `_widget_1744033582428`
- `salesPrice`: `_widget_1745662159158`
- `salesCurrency`: `_widget_1745662159159`
- `countrySku`: `_widget_1744034417634`

如果简道云字段含义和当前推断不一致，只需要调整 `server/field-mapping.js`。

当前产品库表没有仓库实时库存字段，前端会显示为“待 WMS”。库存数量将在仓库 WMS 接入后通过 `国家-SKU / SKU` 与产品库合并。

## 6. 已实现接口

```bash
GET /api/health
GET /api/products
POST /api/products/sync
POST /api/login
```

简道云数据查询使用：

```bash
POST https://api.jiandaoyun.com/api/v5/app/entry/data/list
Authorization: Bearer <JIANYUN_API_KEY>
```

同步逻辑会按 `data_id` 分页获取，单次最多 100 条。

## 7. 当前同步结果

最近一次真实同步结果：

- 产品基础信息：506 条
- 产品库记录：339 条
- 有直营价记录：339 条
- 有分销展示价记录：331 条

公开产品库会展示分销口径价格；内部登录后可查看直营价。
