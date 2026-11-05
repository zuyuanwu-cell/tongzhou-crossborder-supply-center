# 经营分析 PostgreSQL 部署

经营日汇总（店铺 × 日、SKU × 日）写入 PostgreSQL 后，汇总接口改为 SQL 聚合查询，不再扫描全部订单事实。
**不配置也能运行**：未设置 `ANALYTICS_DATABASE_URL` 时，汇总保存在内存，功能完全一致。

## 方式一：独立实例（推荐）

与协同中心的数据库完全隔离，不需要重启协同中心。

```bash
cd /www/wwwroot/gyl.tongzhoukuajing.com
# 1. 生成密码，写入单独的 env 文件（不要提交到 Git）
echo "ANALYTICS_DB_PASSWORD=$(openssl rand -hex 24)" > .env.analytics
chmod 600 .env.analytics
# 2. 启动
docker compose -f docker-compose.analytics.yml --env-file .env.analytics up -d
docker compose -f docker-compose.analytics.yml ps   # 状态应为 healthy
# 3. 把连接串写进后端 .env，然后重启后端
PASS=$(grep ANALYTICS_DB_PASSWORD .env.analytics | cut -d= -f2)
echo "ANALYTICS_DATABASE_URL=postgres://tongzhou_analytics:${PASS}@127.0.0.1:5433/tongzhou_analytics" >> .env
pm2 restart tongzhou-supply-api --update-env
```

## 方式二：复用协同中心的 PostgreSQL

协同中心的 Postgres 在 Docker 私有网络里，没有对宿主机开放端口。复用需要：

1. 在 `docker-compose.collaboration.production.yml` 的 `postgres` 服务下增加 `ports: ["127.0.0.1:5433:5432"]`，并 `docker compose ... up -d postgres`（**会短暂重启协同中心数据库**）。
2. 以 `tongzhou_bootstrap` 登录建库建用户：

```sql
CREATE ROLE tongzhou_analytics LOGIN PASSWORD '<强密码>' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE tongzhou_analytics OWNER tongzhou_analytics;
```

3. 同方式一第 3 步配置 `ANALYTICS_DATABASE_URL` 并重启后端。

## 首次启动后会发生什么

- 后端自动建表（`analytics_partitions`、`analytics_shop_daily`、`analytics_sku_daily`）。
- 启动时把现有分区的日汇总全部写入；之后每次重算只写变化的日期。
- 「经营贡献 → 交易对账」底部显示「日汇总存储：PostgreSQL」。

## 核对

```bash
curl -s -H "Authorization: Bearer <管理员令牌>" "http://127.0.0.1:8787/api/performance-analytics/summary?groupBy=total" | head -c 400
```

返回里的 `backend` 应为 `postgres`。如果 Postgres 暂时不可用，接口会自动改从分区文件计算（`backend: partition-files`），并在页面上提示异常，不影响使用。

## 备份

汇总表可以随时由分区文件重建，不是唯一数据源；删除这些表后重启后端会自动重新写入。
