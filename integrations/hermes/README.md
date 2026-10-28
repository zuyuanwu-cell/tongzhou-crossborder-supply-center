# 同舟 Hermes 运行时

本目录保存固定版本的 Hermes 容器配置和 `tongzhou-business` 插件。生产环境由同舟 Node 后端代理调用 DeepSeek 官方 API，不依赖 Nous Portal OAuth。DeepSeek API Key 由管理员在“同舟智能体工作台”配置，经 AES-256-GCM 加密后保存在 `.cache/hermes-model-config.json`，不会进入浏览器响应、日志或 Hermes 容器。

## 固定源码与镜像 digest

`source.lock` 固定：

- 标签：`v0.21.7`
- 提交：`71d34bad1045610252eda02ee79549436896e784`

构建并记录不可变镜像：

```powershell
docker compose -f integrations/hermes/docker-compose.build.yml build
docker tag tongzhou/hermes-agent:v0.21.7-71d34bad <registry>/tongzhou/hermes-agent:v0.21.7-71d34bad
docker push <registry>/tongzhou/hermes-agent:v0.21.7-71d34bad
docker pull <registry>/tongzhou/hermes-agent@sha256:<digest>
powershell -File integrations/hermes/scripts/record-image-digest.ps1 -Image <registry>/tongzhou/hermes-agent@sha256:<digest>
```

`record-image-digest.ps1` 会把 digest 写入 `image.lock`。生产的 `HERMES_RUNTIME_IMAGE` 必须使用完整 digest，Compose 会拒绝可变标签。

## 网络边界

`hermes` 只把 API 发布到宿主机回环地址 `127.0.0.1:8642`：

- `tongzhou-hermes-control` 是内部私网（`internal: true`，没有出网路由）。
- `tongzhou-hermes-host`（默认网段 `172.30.86.0/24`，可用 `HERMES_HOST_SUBNET` 改）是普通桥接网，只为两件事存在：让 `127.0.0.1:8642` 端口发布生效，以及让 Hermes 通过 `host.docker.internal:8787` 访问宿主机上的 Node 模型代理与业务桥接。只挂内部网时 Docker 会跳过端口发布、也到不了宿主机，表现为“Hermes 一直连不上 / 任务没响应”。
- 禁止 Hermes 访问公网用宿主机防火墙完成（访问宿主机本身走 INPUT 链，不受影响）：

  ```bash
  sudo iptables -I DOCKER-USER -s 172.30.86.0/24 -j DROP
  sudo iptables -I DOCKER-USER -s 172.30.86.0/24 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  # 验证：第一条应失败，第二条应返回 401/404 等 HTTP 状态
  docker exec tongzhou-hermes curl -sS -m 5 https://api.deepseek.com || echo "公网已拦截"
  docker exec tongzhou-hermes curl -sS -m 5 -o /dev/null -w '%{http_code}\n' http://host.docker.internal:8787/api/health
  ```

  宿主机防火墙（firewalld/ufw）需要允许该网段访问 8787；`INTERNAL_API_ALLOWED_CIDRS` 默认的 `172.16.0.0/12` 已覆盖该网段。
- 从旧版只挂内部网的配置升级时，先 `docker compose -f integrations/hermes/docker-compose.yml down` 再 `up -d`，让 Docker 重建网络。
- 同舟 Node 由 PM2 运行时使用 `HERMES_BASE_URL=http://127.0.0.1:8642` 访问 Hermes。
- Hermes 通过受限的宿主机回环/反向代理访问模型代理与业务桥接；不得把 Hermes API 暴露到公网。

Node 由 PM2 运行在宿主机上时，以上配置即可直接使用；不要把 Hermes API 暴露到公网。

## 启动前检查

1. 生成独立随机的 `HERMES_API_KEY` 和至少 32 字节的 `HERMES_BRIDGE_SECRET`。
2. 分别生成至少 32 字节且互不相同的 `HERMES_MODEL_PROXY_KEY` 与 `HERMES_PARTNER_MODEL_PROXY_KEY`。它们只用于两个 Hermes 档案认证同舟模型代理，不是 DeepSeek API Key；伙伴密钥会触发低温度、JSON 模式、1200 tokens 上限和工具字段剥离。
3. 使用管理员账号打开“同舟智能体工作台 → 模型配置”，填写 DeepSeek API Key，选择模型并保存。保存前后端会连接 `https://api.deepseek.com/models` 验证密钥和模型。
4. 核对 `config/config.yaml` 的 `custom:tongzhou` 提供商仅使用 `chat_completions`，并且只启用 API Server 和 `tongzhou-business`。
   Node 默认允许整项任务最多 32 次 `tongzhou_*` 业务工具调用，可通过 `HERMES_MAX_TOOL_CALLS` 在 12–64 之间调整；Hermes 平台内部调用不占用该预算。单个阶段达到 12 次会收口，累计 20 次会强制复盘计划，硬上限或循环检测会保存检查点并显示“继续完成”。
   每轮“工作时间”上限由 `HERMES_RUN_TIMEOUT_MS` 控制（默认 600000，即 10 分钟，可设 1–30 分钟）；等待人工审批的时间不计入，单次审批最多等待 `HERMES_APPROVAL_TIMEOUT_MS`（默认 900000，即 15 分钟）。到点前 1 分钟会先要求模型用已有证据收尾；事件流断开会自动重连；未能启动的运行 5 分钟后自动释放，工作台的“停止”按钮也能释放卡住的运行。
5. 运行插件和契约测试：

```powershell
npm run test:hermes-plugin
$env:HERMES_CONTRACT_BASE_URL="http://<private-hermes-host>:8642"
$env:HERMES_CONTRACT_API_KEY="<api-key>"
npm run test:hermes-contract
```

默认契约测试只检查能力与安全边界；设置 `HERMES_CONTRACT_RUN=1` 才会产生真实模型调用和费用。

6. Node 首次保持 `HERMES_AGENT_ENABLED=false`，可用 `HERMES_PATROL_ENABLED=true` 进行三天影子巡检。

### AI 凭据轮换

`AI_CREDENTIAL_ENCRYPTION_KEY` 必须是独立的 32 字节以上随机密钥，不能复用会话密钥、协同密钥或模型代理密钥。轮换前先由管理员重新输入并验证 DeepSeek API Key，使用新密钥重新加密配置后再切换运行环境；旧密钥未完成迁移前不得直接替换，否则已有密文将无法解密。任何密钥都不得进入 Git、前端、小程序、容器镜像或日志。

## 伙伴手机快捷汇报

管理员在“同舟智能体工作台 → 伙伴助手”分别配置任务内助手白名单、工作台快捷汇报试点组织、文字/语音开关、限额和腾讯云 ASR 凭据。快捷汇报试点必须同时属于任务内助手白名单。伙伴端只发送当前组织可见且有进度维护权限的活动加工单上下文，Hermes 使用现有 DeepSeek 配置生成草稿，不开放工具、长期记忆或跨任务会话。

- 文字和语音均只生成草稿；“填入表单”只修改小程序本地表单。
- 腾讯云凭据加密保存在协同 PostgreSQL，不进入浏览器、Hermes 容器或日志。
- 录音最长 50 秒、2.5MB，转写后立即删除；清理任务每 5 分钟重试未删除对象。
- 转写文字 30 天后清空，草稿正文与字段依据 90 天后清空，模型、耗时、状态和关联提交等审计事实继续保留。
- 正式提交仍使用原有权限、`If-Match`、幂等和审计链路，并可用 `X-AI-Draft-Id` 关联草稿效果。
- 工作台入口通过确定性匹配返回最多 5 张候选卡；即使唯一高置信候选，也必须由用户确认订单，Hermes 不直接搜索数据库或写业务数据。

运行前需完成 `collaboration/migrations/0014_partner_ai_progress.sql` 与 `collaboration/migrations/0016_partner_ai_sessions.sql`，并配置 `HERMES_PARTNER_BRIDGE_SECRET`（或复用 `HERMES_BRIDGE_SECRET`）、`HERMES_PARTNER_API_KEY`、`HERMES_PARTNER_MODEL_PROXY_KEY` 与 `COLLABORATION_PARTNER_AI_BRIDGE_URL`。容器通过 `/p/tongzhou-partner-progress/` 使用独立档案、独立 API Key 和独立模型代理身份；该档案不加载同舟业务插件、工具、记忆、技能或跨任务会话。

## 分阶段授权

1. 先完成影子巡检和业务标注。
2. 给 5–10 名内部试点用户显式授予 `hermes_agent_use`，开放只读工作台。
3. 验证稳定后再授予 `hermes_agent_action`，写操作仍需逐次确认。
4. 配置 `HERMES_DIGEST_TEAM_ID` 后再开启每日摘要和严重异常提醒。
5. `hermes_agent_admin` 仅用于运行健康、用量和巡检管理。

不要从旧 `tongzhou_ai` 权限自动迁移 Hermes 权限。

## 回滚与数据

将 Node 的 `HERMES_AGENT_ENABLED` 与 `HERMES_PATROL_ENABLED` 设为 `false` 并停止 Hermes 容器即可回滚。主业务继续运行，异常台账和审计数据保留。

业务主记录位于 `.cache/hermes-integration.sqlite`：会话正文默认保留 90 天，工具、审批和异常审计至少保留 365 天。Hermes 容器状态可重建；模型密钥只从服务端环境恢复，不复制到业务 SQLite 或前端。
