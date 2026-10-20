# Hermes 伙伴快捷汇报发布清单

## 上线顺序

1. 部署 Node 与协同 API，但保持伙伴快捷汇报总开关关闭。
2. 执行 PostgreSQL 迁移 `0014_partner_ai_progress.sql`，确认门户账号仍受 RLS 限制。
3. 配置 Hermes/DeepSeek、独立且不同于主档案的 `HERMES_PARTNER_API_KEY` 和 `HERMES_PARTNER_MODEL_PROXY_KEY`、私网桥接 HMAC 密钥和腾讯云 ASR；在工作台测试连接。
4. 用脱敏话术验证明确字段抽取和模糊表达不填数值。
5. 先对白名单组织开放文字，再开放语音；真机验证录音权限、编辑转写、填表和版本冲突。
6. 观察草稿到正式提交转化、字段修改率、错误率、P95 延迟和录音清理状态。

## 回滚

在“伙伴汇报”关闭总开关；若数据库中尚未保存过配置，也可将 `COLLABORATION_PARTNER_AI_ENABLED=false`。数据库配置存在时优先于环境默认值。小程序会隐藏快捷入口，原有表单、人工提交与协同业务不受影响；已生成草稿和审计记录按留存策略保留。

## 验证命令

```powershell
npm run test:hermes
npm run test:assistant
npm run test:collaboration
npm run test:hermes-plugin
npm run build
```
