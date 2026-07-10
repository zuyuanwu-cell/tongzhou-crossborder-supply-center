# 宝塔面板部署说明

推荐流程：本地开发完成后提交到 GitHub，服务器通过 `git pull` 更新代码，再构建前端并重启后端。

## 服务器环境

- Node.js 20+
- Nginx
- PM2
- Git

## 首次部署

```bash
cd /www/wwwroot
git clone <你的 GitHub 仓库地址> tongzhou-crossborder
cd tongzhou-crossborder
npm install
cp .env.example .env
npm run build
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
```

编辑 `.env`，填写简道云 API Key、状态字段等生产配置。

## Nginx 建议配置

前端静态目录指向：

```text
/www/wwwroot/tongzhou-crossborder/dist
```

API 反向代理：

```nginx
location /api/ {
  proxy_pass http://127.0.0.1:8787;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

## 日常更新

如果暂时不使用 Nginx 托管 `dist` 静态目录，也可以在 `npm run build` 后只让 PM2 启动后端服务。后端会在检测到 `dist/index.html` 时为 `/` 和前端路由返回应用首页，`/api/*` 仍保持 API 响应。

```bash
cd /www/wwwroot/gyl.tongzhoukuajing.com
git pull origin main
npm ci
npm run build
pm2 restart tongzhou-supply-api --update-env
pm2 save
```

如果项目目录不是 `/www/wwwroot/gyl.tongzhoukuajing.com`，请替换为宝塔文件管理器里实际站点目录。

## 关键环境变量

生产 `.env` 建议至少确认：

```env
JIANYUN_API_KEY=
INTERNAL_ACCESS_CODE=
AUTH_SESSION_SECRET=
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

修改 `.env` 后必须使用 `pm2 restart tongzhou-supply-api --update-env`，否则 PM2 仍可能沿用旧环境变量。

## 注意

- 不要在服务器直接修改业务代码，统一在本地开发后提交 GitHub。
- `.env`、`.cache`、`node_modules`、`dist` 不提交仓库。
- 如果修改了后端代码，更新后需要重启 PM2。
