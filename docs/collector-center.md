# 采集中心（同舟智数采集节点管理）

中台「工具与设置 → 采集中心」管理部署在各台电脑 / 云电脑上的同舟智数采集节点。

## 节点接入
1. 在云电脑上解压运行同舟智数，紫鸟客户端保持登录。
2. 在同舟智数「总览」用中台账号登录一次（需要「经营贡献分析 + 经营销售金额」权限）。
3. 程序自动注册为采集节点（`POST /api/collector/nodes/pair`），拿到节点专属令牌（`tzcn_…`，服务器只存 SHA-256），1 分钟内出现在采集中心。

## 节点 ↔ 中台
| 接口 | 用途 |
|---|---|
| `POST /api/collector/agent/heartbeat` | 每 60 秒：上报版本、紫鸟状态、店铺、是否在采集；返回采集计划与待执行命令 |
| `POST /api/collector/agent/runs` | 采集开始 / 结束时上报运行记录（店铺结果、提醒、写入中台结果） |
| `POST /api/collector/agent/logs` | 每 15 秒批量回传日志（每节点保留最近 3000 行） |
| `POST /api/collector/agent/commands/:id/ack` | 回报命令执行结果 |
| `POST /api/shop-daily-report/ingest` | 节点令牌同样可写入店铺日报 |

节点主动连接中台，云电脑不需要开放端口。中台不可达时节点按本地缓存计划继续采集，恢复后补报运行记录。

## 中台页面接口（登录用户，需要经营贡献分析 + 经营销售金额权限）
- `GET /api/collector/nodes`：节点列表（3 分钟内有心跳视为在线）
- `GET/PATCH/DELETE /api/collector/nodes/:id`：详情、改名 / 停用 / 修改计划（`schedule: { enabled, times[], lookbackDays }`）、删除
- `POST /api/collector/nodes/:id/commands`：`{ type: "collect", dates? }` 立即采集或补采（命令 24 小时内有效）
- `POST /api/collector/nodes/:id/runs/:runId/retry`：重试该次失败 / 部分失败的店铺，日期沿用该次运行
- `GET /api/collector/nodes/:id/runs`、`GET /api/collector/nodes/:id/logs?after=`

## 计划规则
- 节点首次心跳时用节点本地的定时设置初始化中台计划，之后以中台为准；节点上显示「由中台采集中心管理」。
- 采集时间按节点电脑的本地时间；采集日期按各店铺站点时区取最近 N 天。
- 停用节点会立即使其令牌失效；重新启用后需要在节点上重新登录中台。

数据保存在 `.cache/collector-center.json`（运行时数据，不进 Git，不随发布重置）。
