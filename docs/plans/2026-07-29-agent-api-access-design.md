# 登录后 Agent API 自助接入设计

## 目标

在不引入 MCP 服务和第二套权限系统的前提下，让已登录用户从站内完成 Agent API 的发现、密钥创建、复制和撤销。数据访问继续由现有 Agent HTTP API 提供。

## 最小架构

- 增加 `/api/agent/openapi.json`，描述只读 Agent 接口和统一记录 Schema。
- 增加站内“API 接入”页面，所有非游客角色可访问。
- 增加个人 Agent API Key：默认有效期 90 天，最长 365 天，每人最多 5 个有效 Key。
- API Key 只允许访问 `/.well-known/agent-index.json` 与 `/api/agent/*`；不能调用用户、仓库配置等普通业务接口。
- Key 仅在创建时返回一次明文，服务端只持久化 SHA-256 哈希、前缀、所有者、有效期和使用时间。
- 请求时根据 Key 所属用户重新读取当前账号状态与角色。因此账号停用、删除或角色降低会立即影响 Key 权限。

## 数据流

1. 用户使用现有会话登录。
2. 页面通过会话调用 `/api/agent-keys` 创建或撤销 Key。
3. 外部 Agent 以 `Authorization: Bearer tzai_...` 调用 Agent API。
4. Agent API 专用鉴权先验证现有会话，再验证 Agent Key，并将结果交给原权限感知索引层。
5. Agent 比较响应中的 `authorization_scope.checksum`，处理角色或可见范围变化。

## 安全边界

- 不允许使用 Agent Key 创建或修改业务数据。
- 不共享系统级管理员 Key；每个用户创建自己的 Key。
- Key 列表不返回哈希或完整明文。
- 创建、撤销 Key 写入现有操作日志。
- 删除用户时同时撤销该用户的全部 Key。

## 验证

端到端测试覆盖创建、列表不泄密、Agent API 调用、普通业务 API 拒绝、撤销后失效、OpenAPI 可访问，以及现有 Agent 覆盖率和业务冒烟测试。
