# 同舟跨境供应链中心

同舟跨境供应链中台，用于同步简道云产品、资质、素材、用户、委外加工单，以及 WMS 库存、订单、备货单数据。

## 本地开发

```bash
npm install
npm run dev:all
```

前端默认运行在 `http://localhost:5173`，后端 API 默认运行在 `http://localhost:8787`。

## 常用命令

```bash
npm run dev       # 启动前端
npm run api       # 启动后端
npm run dev:all   # 同时启动前后端
npm run build     # 构建前端
```

## 环境变量

复制 `.env.example` 为 `.env`，按实际情况填写：

```env
JIANYUN_API_KEY=
JIANYUN_API_HOST=https://api.jiandaoyun.com
INTERNAL_ACCESS_CODE=admin123
API_PORT=8787
USER_ACCOUNT_STATUS_FIELD=
```

`.env` 不会提交到 GitHub。

## 部署

宝塔面板部署说明见 [docs/deployment-baota.md](docs/deployment-baota.md)。
