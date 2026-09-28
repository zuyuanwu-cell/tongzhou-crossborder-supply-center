# 外部协同门户部署与恢复手册

## 1. 交付物与网络边界

| 组件 | 构建/启动 | 建议网络 |
|---|---|---|
| 内部中台前端 | `npm run build` → `dist/` | 公司网络或零信任网关 |
| 内部核心 API | `pm2 start ecosystem.config.cjs`，端口 8787 | 内网 |
| 外部协同门户 | `npm run build:collaboration` → `dist-collaboration/` | 独立公网域名 |
| 协同 API | PM2 应用 `tongzhou-collaboration-api`，端口 8790 | 仅通过门户反代公开 `/collaboration/*` |
| PostgreSQL | 独立数据库、独立 portal/integration 角色 | 私网，不对公网开放 |
| 私有对象存储 | S3 兼容存储 | 私有桶，禁止公开读 |

门户域名不得把 `/api/*` 代理到内部核心 API。内部中台只通过 `COLLABORATION_API_BASE_URL` 和轮换服务令牌访问协同 API 内部路由。

## 2. PostgreSQL 角色

生产环境由 DBA 预先创建 `pgcrypto` 扩展、数据库和两个不同角色。示例中的密码必须替换：

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE ROLE tongzhou_portal LOGIN PASSWORD '<portal-password>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE tongzhou_integration LOGIN PASSWORD '<integration-password>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;
```

数据库对象应由 migration/integration 角色拥有。迁移完成后会按最小权限重置 portal 角色的表权限；若角色名不是连接串中的用户名，设置 `COLLABORATION_PORTAL_DB_ROLE`。

本地首次启动可使用：

```bash
docker compose -p tongzhou-collaboration -f docker-compose.collaboration.yml up -d
npm run collaboration:migrate
npm run collaboration:seed
```

Compose 初始化脚本只在空数据卷首次创建时执行。已有旧数据卷若曾使用共享超级用户，不要直接复用；先备份，再由 DBA 创建双角色并执行权限脚本。

## 3. 生产环境变量

至少配置：

```env
NODE_ENV=production
COLLABORATION_API_PORT=8790
COLLABORATION_DATABASE_URL=postgres://tongzhou_portal:<password>@<private-host>:5432/tongzhou_collaboration
COLLABORATION_INTEGRATION_DATABASE_URL=postgres://tongzhou_integration:<password>@<private-host>:5432/tongzhou_collaboration
COLLABORATION_PUBLIC_ORIGIN=https://partner.example.com
COLLABORATION_COOKIE_SECURE=true
COLLABORATION_SECRET_KEY=<至少32字符随机值>
COLLABORATION_INTERNAL_TOKEN=<至少32字符随机值>
COLLABORATION_STORAGE_DRIVER=s3
COLLABORATION_S3_ENDPOINT=https://<private-s3-endpoint>
COLLABORATION_S3_REGION=<region>
COLLABORATION_S3_BUCKET=<private-bucket>
COLLABORATION_S3_ACCESS_KEY_ID=<key-id>
COLLABORATION_S3_SECRET_ACCESS_KEY=<secret>
COLLABORATION_CLAMSCAN_PATH=/usr/bin/clamscan
COLLABORATION_SMTP_URL=smtps://<user>:<password>@<host>:465
COLLABORATION_AUTO_MIGRATE=false
COLLABORATION_OEM_ENABLED=false

COLLABORATION_API_BASE_URL=http://<private-collaboration-api>:8790
COLLABORATION_BRIDGE_DB_PATH=.cache/collaboration-bridge.sqlite
COLLABORATION_BRIDGE_POLL_MS=10000
```

核心 API 与协同 API 必须使用同一个 `COLLABORATION_INTERNAL_TOKEN`。生产环境不要启用 `COLLABORATION_DEV_TRUST_UPLOADS`。

## 4. 构建和启动

```bash
npm ci
npm run build
npm run build:collaboration
npm run collaboration:migrate
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
```

协同 API 健康检查为 `GET /collaboration/health`。核心桥接状态为内部鉴权后的 `GET /api/collaboration-bridge/status`。

## 5. Nginx 示例

伙伴域名静态目录指向 `dist-collaboration`：

```nginx
server {
  listen 443 ssl http2;
  server_name partner.example.com;
  root /www/wwwroot/tongzhou/dist-collaboration;

  location /collaboration/ {
    proxy_pass http://127.0.0.1:8790;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 52m;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }

  location ^~ /api/ { return 404; }
}
```

在边界防火墙中只允许核心 API 主机访问协同 API 的 `/collaboration/internal/*`；应用层仍会校验服务令牌。

## 6. 上线顺序

1. 冻结新增外部账号进入旧中台，并盘点存量外部账号。
2. 部署 PostgreSQL、对象存储、协同 API 和门户，保持 OEM 门禁关闭。
3. 通过内部接口创建一家国内仓组织及管理员邀请。
4. 双轨发布入库、出库、调拨任务，核对库存流水、附件、审计和通知。
5. 验收通过后停用该仓旧中台账号，再逐仓迁移。
6. 国内仓试点完成并签字后，单独变更 `COLLABORATION_OEM_ENABLED=true`，同时重启核心 API 与协同 API，再启用 OEM 发布。

## 7. 备份与恢复

- PostgreSQL：至少每 15 分钟 WAL/增量备份，每日全量备份；保留跨可用区副本。
- 对象存储：启用版本控制和生命周期策略，数据库与对象存储使用同一恢复批次标签。
- 核心桥接：备份 `.cache/collaboration-bridge.sqlite`；丢失时可重新发布投影，命令结果依靠协同库与国内仓幂等键避免重复流水。
- 每季度执行恢复演练，目标 RPO 15 分钟、RTO 4 小时。

恢复顺序：PostgreSQL → 对象存储 → 协同 API（只读检查）→ 核心桥接 → 门户。恢复后先核对 `integration_inbox`、`partner_commands` 和内部库存流水，再开放伙伴写操作。

## 8. 回滚

- 门户/协同 API 代码回滚不回退数据库迁移；使用上一构建产物重启。
- 关闭 `COLLABORATION_OEM_ENABLED` 可立即停止 OEM 新提交，不删除已产生记录。
- 国内仓试点异常时停止发布新任务并暂停桥接轮询；不要删除 outbox/inbox。修复后利用幂等键继续重试。
- 不得把外部伙伴重新开放到完整内部中台作为长期回滚方案；紧急期间使用人工受控流程。
