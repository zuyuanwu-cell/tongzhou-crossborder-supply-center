# 内部 Agent 索引层设计

## 目标

在不改变现有前端和业务 API 行为的前提下，为内部 AI agent 提供一个正式、权限感知、可校验的数据入口。索引层复用现有 Bearer 鉴权、四级角色、简道云/WMS 同步结果、JSON 缓存和 SQLite，不引入新的数据库、消息队列或 Web 框架。

## 方案

新增薄层 `server/agent-index.js`，通过回调读取 `server/server.js` 中已经完成权限裁剪或脱敏的数据。所有 Agent 记录转换成统一 envelope：

- 稳定 `id`、`type`、标题和检索正文；
- 源路径、来源系统、创建/更新时间、所有者；
- visibility/permissions；
- checksum/version；
- 白名单化的完整 `data`；
- 附件元数据和正文提取状态。

索引层提供 manifest、分页 list、get by id、跨类型 search、updated_since、deleted_since 和 coverage。Manifest 可以公开发现，但资源数据仍使用现有 Bearer token，并按当前用户角色实时过滤。

## 删除与增量

当前上游没有 CDC，因此 `updated_since` 基于每条记录可获得的源更新时间或缓存观测时间。现有本地 DELETE/恢复接口会写入 `.cache/agent-deletions.json`，供 `deleted_since` 返回 tombstone。简道云/WMS 的源端删除暂不推断，避免分页不完整或同步失败时误删；后续可在“完整同步成功”后增加前后快照 diff。

## 附件

首期索引资质、素材和产品图片的文件名、URL、MIME 推断及提取状态；本地 Markdown 文档直接提取正文。PDF、扫描件、图片 OCR 和压缩包解包保留明确扩展点，未提取内容返回 `not_extracted` 或 `unsupported`，不会静默视为空正文。

## 验证

新增独立缓存目录支持，使 smoke 和 Agent 测试不会污染真实 `.cache`。测试覆盖 manifest、分页、按 ID 获取、角色过滤、搜索、updated_since、本地 tombstone 和覆盖率一致性；覆盖率脚本逐类分页枚举并与源计数、唯一 ID 数量及必要元数据进行核对。
