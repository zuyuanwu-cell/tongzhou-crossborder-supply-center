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
AGNES_AI_API_KEY=
AGNES_AI_BASE_URL=https://apihub.agnes-ai.com/v1
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
- `AGNES_AI_API_KEY` / `AGNES_AI_BASE_URL`：同舟AI 生成能力配置。

## 部署

宝塔面板部署说明见 [docs/deployment-baota.md](docs/deployment-baota.md)。

