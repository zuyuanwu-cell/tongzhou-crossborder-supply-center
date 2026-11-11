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

## 数据质量（无人值守）

目标：店铺日报的采集数据不再需要人工逐个对 Shopee 后台。2026-11-11 在真实店铺（QLEV，印尼）上逐项核对后确定口径：

| 日报字段 | Shopee 来源 | 2026-11-11 核对结论 |
|---|---|---|
| 支付金额 / 订单数 | 商业分析 · 关键指标，**Paid Order（已付款）** | 与页面一致。后台默认显示 Placed/Confirmed Order，口径不同，人工对比时要切到 Paid Order |
| 访客数 | 关键指标「Visitors」= `hybrid_uv` | **修正**：之前误用 `shop_uv`（只是店铺页访客，424 vs 页面 3,003） |
| 加购 | 商品概览 Add to Cart 人数 `atc_uv` | 一致 |
| 曝光 | 流量来源 · 商品卡曝光 | 一致；前一天的曝光要到当地中午后才生成 |
| 站内广告费 | Shopee 广告：商品广告 + **Shop+ 广告 + 直播广告** | 商品广告一致；Shop+ / 直播之前漏采，已补上 |

### 采集端（同舟智数 0.4.0）
- 每行数据带「采集证据」：接口原始返回摘要（去掉逐小时曲线）、模板版本、缺失字段、Shopee 未出数字段。
- **页面核对**：每个店铺采完后打开商业分析首页，切到「昨天 + 已付款订单」，读页面上显示的支付金额、订单数、访客数，与采集值比对（读的是页面文字，和接口取数互相独立）；然后截图留证、把订单口径切回原来的选项。核对失败不影响采集。
- 截图压缩为 JPEG 后上传 `POST /api/collector/agent/evidence/screenshot`。

### 中台
- 证据随 `POST /api/shop-daily-report/ingest` 一起上传，按最终写入的店铺归档到 `.cache/collector-quality/`（摘要 `quality.json`，明细与截图按日期分目录，保留 45 天）。
- 每 20 分钟巡检一次（节点写入后 3 分钟也会巡检）：判定每个店铺最近 7 天每天的状态——已核验 / 已采集 / 需留意 / 旧口径 / 等出数 / 缺字段 / 有误 / 缺失。检查项：缺失、缺字段、页面核对不一致、逻辑矛盾（有订单无金额等）、与妙手订单数差异（仅提示）、与近 14 天同口径中位数相比的异常波动。
- **自动补采**：缺失、缺字段、有误、等出数、旧口径、异常波动 → 给负责该店铺的节点下发补采命令（同一节点合并为一条）。限制：每个店铺每天最多 3 次（等出数 4 次、旧口径和异常波动 1 次），间隔 90 分钟（等出数 120 分钟）；北京时间 10 点前不补采最近一天；节点正在采集时等它写完。
- **需要人工处理**：紫鸟账号未绑定设备、Shopee 掉登录 / 安全验证、节点离线、补采次数用完仍未解决、多个店铺同时与页面不一致（Shopee 改版）、没有节点负责的店铺。每项写明怎么处理。
- 这些事项同时作为 Hermes 异常巡检的「店铺数据质量」来源，进入 Hermes 异常工作台和异常日报。
- 历史数据：最近 31 天里旧口径（访客 = 店铺页访客）的数据会自动按新口径补采一次。

接口（登录用户，店铺日报权限；修改需编辑权限）：
- `GET /api/collector/quality[?refresh=1]`：状态矩阵、统计、需要人工处理、最近自动处理
- `POST /api/collector/quality/run`：立即检查并补采
- `PATCH /api/collector/quality/settings`：`{ autoBackfill, pageCheck, screenshot }`（页面核对与截图开关随心跳下发给节点）
- `GET /api/collector/quality/evidence?shopKey&date`、`GET /api/collector/quality/screenshot?shopKey&date`
- `POST /api/collector/quality/recollect`：`{ shopKey, dates[] }` 手动补采
