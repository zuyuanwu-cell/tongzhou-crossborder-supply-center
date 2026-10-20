# 同舟 Hermes 运行时

本目录保存固定版本的 Hermes 容器配置和 `tongzhou-business` 插件。生产环境还需要由管理员配置 Nous OAuth、Hermes API Key 和桥接密钥。

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

`hermes` 不发布宿主机端口：

- `tongzhou-hermes-control` 仅允许同舟 Node 服务访问 Hermes API。
- `tongzhou-hermes-outbound` 允许 Hermes 访问 Nous Portal。
- 插件通过 `TONGZHOU_BRIDGE_BASE_URL=http://tongzhou-api:8787` 回调同舟 Node 内部网关。

如 Node 仍由 PM2 运行，需要增加受限的 Compose override 或内部反向代理；不要把 Hermes API 暴露到公网。

## 启动前检查

1. 生成独立随机的 `HERMES_API_KEY` 和至少 32 字节的 `HERMES_BRIDGE_SECRET`。
2. 在持久化 `hermes-state` 卷中完成 Nous Portal OAuth；OAuth 凭据不写入业务 SQLite。
3. 核对 `config/config.yaml` 只启用 API Server 和 `tongzhou-business`。
4. 运行插件和契约测试：

```powershell
npm run test:hermes-plugin
$env:HERMES_CONTRACT_BASE_URL="http://<private-hermes-host>:8642"
$env:HERMES_CONTRACT_API_KEY="<api-key>"
npm run test:hermes-contract
```

默认契约测试只检查能力与安全边界；设置 `HERMES_CONTRACT_RUN=1` 才会产生真实模型调用和费用。

5. Node 首次保持 `HERMES_AGENT_ENABLED=false`，可用 `HERMES_PATROL_ENABLED=true` 进行三天影子巡检。

## 分阶段授权

1. 先完成影子巡检和业务标注。
2. 给 5–10 名内部试点用户显式授予 `hermes_agent_use`，开放只读工作台。
3. 验证稳定后再授予 `hermes_agent_action`，写操作仍需逐次确认。
4. 配置 `HERMES_DIGEST_TEAM_ID` 后再开启每日摘要和严重异常提醒。
5. `hermes_agent_admin` 仅用于运行健康、用量和巡检管理。

不要从旧 `tongzhou_ai` 权限自动迁移 Hermes 权限。

## 回滚与数据

将 Node 的 `HERMES_AGENT_ENABLED` 与 `HERMES_PATROL_ENABLED` 设为 `false` 并停止 Hermes 容器即可回滚。主业务继续运行，异常台账和审计数据保留。

业务主记录位于 `.cache/hermes-integration.sqlite`：会话正文默认保留 90 天，工具、审批和异常审计至少保留 365 天。Hermes 容器状态可重建，Nous OAuth 需通过独立运维步骤恢复。
