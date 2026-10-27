# ADR-0009：Hermes 业务智能体运行时

## 状态

Accepted

## 背景

旧“同舟领航员”依赖页面拼接上下文，无法可靠调用业务工具、追踪异常闭环或审计写操作。库存、备货和生产场景需要一个可恢复、可审批、可追溯的智能体运行时。

同舟 Node 后端提供受控的 OpenAI Chat Completions 兼容模型代理，因此不把 Hermes 框架绑定到 Nous Portal 账号或 OAuth。Hermes 负责会话和工具编排，模型推理由 Node 代理调用 DeepSeek 官方 API。

## 决策

- 使用固定源码标签 `v0.21.7`、提交 `71d34bad1045610252eda02ee79549436896e784` 构建 Hermes，并在生产使用不可变镜像 digest。
- 使用共享 Hermes Gateway 与 `tongzhou-business` 专用插件。浏览器只访问同舟 Node API，不持有 Hermes 或模型密钥。
- 模型提供商固定为命名自定义提供商 `custom:tongzhou`，传输协议为 `chat_completions`。内部智能体默认使用 `deepseek-v4-pro`；伙伴结构化提取独立使用 `deepseek-v4-flash`、低温度、JSON 模式与 1200 tokens 上限。
- DeepSeek API Key 只由管理员在内部工作台配置，并使用独立的 `AI_CREDENTIAL_ENCRYPTION_KEY` 进行 AES-256-GCM 加密；Hermes 容器只持有互不相同的内部/伙伴模型代理凭据，不持有 DeepSeek API Key。
- 同舟 Node 仍是用户身份、权限、数据范围、幂等和审计的唯一可信源。Hermes 只编排白名单工具，不直接访问业务数据库。
- 写工具必须先预览，再由 Hermes `pre_tool_call` 审批挂起；用户只能本次允许或拒绝。批准后 Node 再次鉴权、检查对象版本并使用幂等键执行。
- 禁用终端、文件、浏览器、公共 Web、长期记忆、Cron、委派、技能创建和所有非同舟工具。
- 确定性规则负责发现和关闭异常；模型只负责查证、归因、排序与建议。

### 伙伴档案

- 伙伴快捷汇报使用独立的 `tongzhou-partner-progress` 档案、API Key 和模型代理身份，默认模型为 `deepseek-v4-flash`。
- 伙伴档案不加载业务插件、工具、长期记忆或跨任务会话；它只把协同 API 已鉴权、已裁剪的任务上下文转换为结构化草稿。
- 候选订单检索、组织隔离、权限、版本、幂等和正式提交均由协同 API 确定性执行。即使只有一个候选，也必须由用户确认订单；模型不能直接写业务数据。
- 伙伴文字与语音助手不可用时，原人工表单继续可用，不得阻断伙伴履约。

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
- 浏览器永远看不到 `HERMES_API_KEY`、模型代理凭据、DeepSeek API Key 或 `HERMES_BRIDGE_SECRET`。
- 插件调用内部网关必须携带时间戳、nonce、请求体摘要和 HMAC，五分钟防重放。
- 写入结果未知时按幂等键查询，不盲目重试。
- Hermes 或模型网关不可用时，主业务与确定性巡检继续运行。

## 参考

- [Hermes API Server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server)
- [Hermes Plugins](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins)
- [Hermes Providers](https://hermes-agent.nousresearch.com/docs/integrations/providers)
