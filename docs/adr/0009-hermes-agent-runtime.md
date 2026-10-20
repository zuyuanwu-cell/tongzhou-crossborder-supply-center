# ADR-0009：Hermes 业务智能体运行时

## 状态

Accepted

## 背景

旧“同舟领航员”依赖页面拼接上下文，无法可靠调用业务工具、追踪异常闭环或审计写操作。库存、备货和生产场景需要一个可恢复、可审批、可追溯的智能体运行时。

同舟已经拥有 OpenAI Chat Completions 兼容模型网关，因此不应把 Hermes 框架的使用绑定到 Nous Portal 账号或 OAuth。Hermes 负责会话和工具编排，模型推理由同舟自己的服务提供。

## 决策

- 使用固定源码标签 `v0.21.7`、提交 `71d34bad1045610252eda02ee79549436896e784` 构建 Hermes，并在生产使用不可变镜像 digest。
- 使用共享 Hermes Gateway 与 `tongzhou-business` 专用插件。浏览器只访问同舟 Node API，不持有 Hermes 或模型密钥。
- 模型提供商固定为命名自定义提供商 `custom:tongzhou`，传输协议为 `chat_completions`，当前默认模型为 `agnes-3.0-pro`。
- 自有模型密钥通过容器环境变量 `HERMES_MODEL_API_KEY` 注入，不进入配置文件、业务 SQLite、前端或日志；不要求 Nous OAuth。
- 同舟 Node 仍是用户身份、权限、数据范围、幂等和审计的唯一可信源。Hermes 只编排白名单工具，不直接访问业务数据库。
- 写工具必须先预览，再由 Hermes `pre_tool_call` 审批挂起；用户只能本次允许或拒绝。批准后 Node 再次鉴权、检查对象版本并使用幂等键执行。
- 禁用终端、文件、浏览器、公共 Web、长期记忆、Cron、委派、技能创建和所有非同舟工具。
- 确定性规则负责发现和关闭异常；模型只负责查证、归因、排序与建议。

## 结果

### 优点

- 无需注册或授权 Nous Portal，可复用同舟已有模型账号与费用体系。
- 模型提供商可替换，Hermes 的会话、工具、审批和审计契约保持稳定。
- 模型无法伪造用户身份或绕过 Node 权限与数据范围。
- Hermes 容器可重建，业务主记录保存在同舟集成库。

### 代价

- 自有模型必须可靠支持 OpenAI Chat Completions 的 `tools` / `tool_calls` 协议。
- 模型下架或改名时需要更新 `HERMES_MODEL` 并重新做工具调用契约测试。
- SSE 事件仍需由 Node 规范化并持久化，不能直接透传给浏览器。

## 安全边界

- Hermes API 只绑定 `127.0.0.1:8642` 和 Docker 私网。
- 浏览器永远看不到 `HERMES_API_KEY`、`HERMES_MODEL_API_KEY` 或 `HERMES_BRIDGE_SECRET`。
- 插件调用内部网关必须携带时间戳、nonce、请求体摘要和 HMAC，五分钟防重放。
- 写入结果未知时按幂等键查询，不盲目重试。
- Hermes 或模型网关不可用时，主业务与确定性巡检继续运行。

## 参考

- [Hermes API Server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server)
- [Hermes Plugins](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins)
- [Hermes Providers](https://hermes-agent.nousresearch.com/docs/integrations/providers)
