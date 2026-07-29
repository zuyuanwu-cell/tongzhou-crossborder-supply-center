# 内部 Agent 索引接入

该索引层是现有业务数据之上的只读、权限感知网关。它复用网站现有 Bearer 会话令牌，不提供管理员旁路，也不存储第二份业务数据。

## 发现与认证

- 公开发现：`GET /.well-known/agent-index.json`
- 当前身份的完整 manifest：`GET /api/agent/manifest`
- OpenAPI：`GET /api/agent/openapi.json`
- 鉴权：登录后在站内“API 接入”页面创建个人 Key，并发送 `Authorization: Bearer <tzai_...>`
- 权限语义：同一个接口在不同令牌下只声明、枚举和返回该角色可见的资源。

建议 Agent 每次任务先读取 manifest，只调用其中 `accessible: true` 的资源。每个用户应创建自己的 Agent API Key，不应共享管理员 Key。Key 只允许读取 `/api/agent/*`，不能调用普通业务管理接口；账号停用、删除或角色变化会立即影响 Key 权限。

完整 Key 仅在创建时显示一次，服务端只保存哈希。默认有效期 90 天，每个用户最多保留 5 个有效 Key，可随时在页面撤销。

## 数据读取

```text
GET /api/agent/resources/{type}?page=1&limit=100
GET /api/agent/resources/{type}/{id}
GET /api/agent/search?q=关键词&types=product_catalog,qualification&status=active
GET /api/agent/updated_since?since=2026-07-01T00:00:00.000Z&types=product_catalog
GET /api/agent/deleted_since?since=2026-07-01T00:00:00.000Z
```

`search`、列表接口支持 `q`、`status`、`owner`、`created_since`、`created_before`、`updated_since`、`updated_before`。分页最大 `limit=500`。

每条记录包含稳定 `id`、源主键 `source_id`、类型、标题、可搜索文本、来源路径、创建/更新时间、所有者、ACL、来源系统和内容校验和。`get_by_id` 的 `{id}` 应进行 URL 编码。

## 同步协议

1. 全量同步：读取 manifest 中的可访问类型，逐类型分页拉取至 `has_more=false`。
2. 增量同步：保存成功同步时间，下次调用 `updated_since`，分页消费变更。
3. 删除同步：同时调用 `deleted_since` 并按返回的稳定 `id` 删除索引文档。
4. 权限变更：比较每次响应中的 `authorization_scope.checksum`；一旦变化，按新的 `visible_types` 清除不可见类型并重新全量拉取。索引存储必须按用户或 ACL 隔离，不能把高权限结果复用给低权限用户。
5. 定期运行 `npm run check:agent-coverage`，在全量覆盖校验通过后再推进同步水位。

本地删除 tombstone 保存在 `CACHE_DIR/agent-deletions.json`。简道云和 WMS 当前没有接入源端 CDC，manifest 会将删除能力声明为 `local_mutations_only`，不能把上游查询中暂时缺失的记录推断为删除。

## 覆盖率门禁

对运行中的服务执行：

```bash
AGENT_BASE_URL=http://127.0.0.1:8787 AGENT_TOKEN=<bearer-token> npm run check:agent-coverage
```

PowerShell：

```powershell
$env:AGENT_BASE_URL="http://127.0.0.1:8787"
$env:AGENT_TOKEN="<bearer-token>"
npm run check:agent-coverage
```

可用 `AGENT_TYPES=product_catalog,qualification` 限定类型。脚本会把源记录数与 list 实际分页枚举数比较，并检查重复 ID、缺失元数据和上游不完整标志；任何遗漏都会以非零退出码失败。

## 附件与富文本

Markdown 文档和已有纯文本字段会直接进入 `body/searchable_text`。附件保留稳定元数据与提取状态：

- 文本/JSON：当前记录元数据，未主动下载外部文件；
- PDF/图片：`extraction_status=not_extracted`；
- 音频/视频：`extraction_status=unsupported`，当前不做语音识别或画面理解；
- ZIP/RAR：`extraction_status=unsupported`。

`attachments[]` 是后续 PDF 文本解析/OCR worker 的稳定扩展点。worker 应写入附件正文、提取器版本、提取时间与正文 checksum，同时沿用同一记录 ACL。
