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

```bash
cd /www/wwwroot/tongzhou-crossborder
git pull
npm install
npm run build
pm2 restart tongzhou-supply-api
```

## 注意

- 不要在服务器直接修改业务代码，统一在本地开发后提交 GitHub。
- `.env`、`.cache`、`node_modules`、`dist` 不提交仓库。
- 如果修改了后端代码，更新后需要重启 PM2。
