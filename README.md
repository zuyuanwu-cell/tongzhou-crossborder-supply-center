# 同舟跨境供应链中心

同舟跨境供应链中台，用于同步简道云产品、资质、素材、用户、委外加工单，以及 WMS 库存、订单、备货单数据。

## 本地开发

```bash
npm install
npm run dev:all
```

前端默认从 `http://localhost:5173` 启动；如果端口已被占用，Vite 会自动切到下一个可用端口，请以终端输出的 Local URL 为准。后端 API 默认运行在 `http://localhost:8787`。

## 常用命令

```bash
npm run dev       # 启动前端，端口占用时自动换端口
npm run dev:strict # 启动前端并要求固定 5173 端口
npm run api       # 启动后端
npm run dev:all   # 同时启动前后端
npm run build     # 构建前端
npm run smoke:api # 构建后冒烟检查根路径、登录态和核心内部 API
npm run test:movement-comparison # 校验动销状态与库存消耗对比口径
npm run test:miaoshou # 使用模拟妙手接口校验店铺同步、申请运单号、面单与幂等逻辑
```

构建后也可以只启动后端：`npm run build && npm run api`。当 `dist/index.html` 存在时，后端会为 `/` 和前端路由返回应用首页，API 仍然走 `/api/*`。

## 环境变量

复制 `.env.example` 为 `.env`，按实际情况填写：

```env
JIANYUN_API_KEY=
JIANYUN_API_HOST=https://api.jiandaoyun.com
INTERNAL_ACCESS_CODE=change-me-to-a-strong-internal-code
AUTH_SESSION_SECRET=
NODE_ENV=development
ALLOW_INSECURE_INTERNAL_ACCESS_CODE=false
API_PORT=8787
USER_ACCOUNT_STATUS_FIELD=
AUTO_SYNC_INTERVAL_MS=600000
ORDER_SYNC_TIMEOUT_MS=45000
ORDER_SYNC_CHUNK_DAYS=7
ORDER_SYNC_JOB_POLL_MS=5000
WAREHOUSE_TEST_TIMEOUT_MS=20000
WMS_REQUEST_TIMEOUT_MS=25000
WMS_ORDER_MAX_PAGES=200
INVENTORY_SNAPSHOT_TIMEZONE=Asia/Shanghai
MOVEMENT_HISTORY_TIMEZONE=Asia/Shanghai
MOVEMENT_HISTORY_DB_PATH=.cache/movement-history.sqlite
PERFORMANCE_ANALYTICS_DB_PATH=.cache/performance-analytics.sqlite
PERFORMANCE_FX_AUTO_SYNC=true
PERFORMANCE_FX_SYNC_INTERVAL_MS=86400000
PERFORMANCE_FX_BACKFILL_DAYS=120
PERFORMANCE_FX_ENDPOINT=https://api.frankfurter.dev/v2/rates
MIAOSHOU_APP_KEY=
MIAOSHOU_APP_SECRET=
MIAOSHOU_API_BASE_URL=https://openapi-erp.91miaoshou.com
MIAOSHOU_REQUEST_TIMEOUT_MS=25000
MIAOSHOU_TASK_DB_PATH=.cache/miaoshou-tasks.sqlite
AI_CREDENTIAL_ENCRYPTION_KEY=
```

`.env` 不会提交到 GitHub。

常用运行参数：

- `AUTO_SYNC_INTERVAL_MS`：后台自动刷新间隔，默认 10 分钟。
- `ORDER_SYNC_TIMEOUT_MS`：兼容旧同步入口的单仓等待时间；新动销同步会创建后台任务。
- `ORDER_SYNC_CHUNK_DAYS`：俄罗斯 YunWMS 和 SEA WMS 订单日期分片天数，订单量大时可从 7 调到 3。
- `ORDER_SYNC_JOB_POLL_MS`：前端查询后台订单任务进度的建议间隔。
- `WAREHOUSE_TEST_TIMEOUT_MS`：仓库授权“检测连接”的单阶段超时时间。
- `WMS_ORDER_MAX_PAGES`：订单同步单分片最多分页数；SEA WMS 印尼/马来订单量较大，建议保持 200，避免出库单被截断。
- `INVENTORY_SNAPSHOT_TIMEZONE` / `MOVEMENT_HISTORY_TIMEZONE`：库存快照与动销历史默认日期时区，页面筛选也支持手动选择时区。
- `MOVEMENT_HISTORY_DB_PATH`：动销历史 SQLite 数据库文件路径，默认 `.cache/movement-history.sqlite`；备份这个文件即可保留历史动销。
- `PERFORMANCE_ANALYTICS_DB_PATH`：经营贡献订单事实与历史日汇率数据库，默认 `.cache/performance-analytics.sqlite`。
- `PERFORMANCE_FX_AUTO_SYNC`：是否启用经营汇率自动同步，默认开启。
- `PERFORMANCE_FX_SYNC_INTERVAL_MS`：成功同步后的最短再次同步间隔，默认 24 小时；失败不会清空旧值，并会在后台检查周期内重试。
- `PERFORMANCE_FX_BACKFILL_DAYS`：首次启动补齐历史日汇率的天数，默认 120 天。
- `PERFORMANCE_FX_ENDPOINT`：默认使用 Frankfurter v2 公共接口；无需 API Key。订单出现的新币种会自动加入同步范围，也可用 `PERFORMANCE_FX_CURRENCIES=USD,RUB` 补充固定币种。
- `MIAOSHOU_APP_KEY` / `MIAOSHOU_APP_SECRET`：妙手开放平台授权；也可以由管理员在“妙手 ERP”页面录入。环境变量优先级更高，密钥不会返回前端。
- `MIAOSHOU_REQUEST_TIMEOUT_MS`：妙手单次接口超时时间；请求结果不明确时任务进入人工核实，不会盲目重试。
- `MIAOSHOU_TASK_DB_PATH`：运单申请任务与事件 SQLite 文件，默认 `.cache/miaoshou-tasks.sqlite`。
- `AI_CREDENTIAL_ENCRYPTION_KEY`：用于加密每位用户自行保存的同舟画布 API Key，生产环境建议配置为独立的高强度随机值；未配置时使用 `AUTH_SESSION_SECRET`。

## 妙手 ERP 自动申请运单号

管理员进入“智能与开放 → 妙手 ERP”，按以下顺序操作：

1. 保存 AppKey、AppSecret 和需要同步的平台/站点范围。
2. 检测连接并同步店铺。
3. 逐店开启“自动申请运单号”，确认是否成功后自动获取面单。
4. 开启自动任务总开关，或先使用“立即检查”验证少量包裹。

该任务只读取“待打单发货”包裹并调用申请运单号、获取面单接口，不调用妙手“包裹发货”接口。包裹必须已经在妙手配置线上物流。接口超时、返回成功但缺少运单号等不明确结果会停在“需要核实”，由管理员确认妙手后台状态后手动重试。

## 经营汇率自动同步

“运营分析 → 经营贡献 → 数据质量”会展示自动同步状态、最近成功时间、数据日期和异常信息。系统启动时会在汇率过期后自动补齐，之后默认每 24 小时同步一次；管理员也可以点击“立即同步”。自动任务按订单实际出现的外币保存每日历史汇率，人工录入的同日汇率优先于自动值。上游不可用时仅记录异常并继续使用上次有效汇率。

动销分析中的周期状态变化和库存消耗对账口径见 [docs/movement-comparison.md](docs/movement-comparison.md)。

## 部署

宝塔面板部署说明见 [docs/deployment-baota.md](docs/deployment-baota.md)。

