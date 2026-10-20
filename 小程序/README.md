# 同舟协同微信小程序

面向内部供应链中台与仓库、备案服务商、打样工厂、包装厂和生产工厂的移动协同端。当前版本使用微信原生小程序技术，可直接通过微信开发者工具打开本目录。

## 已实现

- 伙伴账号登录与组织数据边界提示
- 登录页可切换“伙伴登录 / 中台登录”，两类会话、令牌和首页相互隔离
- 中台移动总览：跨组织任务、逾期风险、待审批指令和伙伴组织状态
- 中台经营数据：按账号权限查看国内仓库库存、产品库、资质库、产品备货风险和智能装柜
- 中台任务与详情只读查看；高权限账号可审批伙伴指令、查看组织与成员状态
- 中台移动端不提供任务发布和伙伴身份代操作，避免越权与责任边界混淆
- 按组织类型、岗位和资源授权生成工作台与可用动作
- 稳定的工作台、任务、消息、我的导航；库存仅作为仓库工作区模块
- 协同任务按单据类型、状态筛选和搜索，支持详情查看、接单与分角色反馈
- 批次、条码、生产日期、有效期和现场照片凭证
- 本仓库存查询与扫码搜索
- 仓库自主入库、出库、盘点差异申请
- 备案/打样资料结果提交
- 委外生产工作台：加工单/采购单分区、14 天交期、逾期/临期/待补交期和优先级队列
- 加工单详情：只读首件档案、生产工序、物料与包材到齐/测试、生产进度、发货和异常反馈
- 采购单详情：履约进度、发货和异常反馈
- 中台审批、待同步、驳回、空状态和网络异常提示
- 对接现有 `/collaboration` API 的 Cookie、CSRF、幂等键与版本控制
- 任务详情顶部 Hermes 快捷汇报：文字或 50 秒语音转写、逐字段原话依据、缺失项高亮、填入原表单后人工确认提交

## 当前运行方式

工程已关闭演示模式，并连接正式服务：

- 伙伴协同 API：`https://partner.tongzhoukuajing.com`
- 中台移动 API：`https://gyl.tongzhoukuajing.com/api/mobile-admin/v1`

1. 在微信开发者工具中导入当前 `小程序` 目录。
2. 编译后可选择“伙伴登录”或“中台登录”；中台支持内部账号密码或网页端中台访问码。
3. 伙伴类型、岗位权限、组织与仓库数据边界均由伙伴登录会话返回，不能由前端自行选择。
4. 中台页面能力由内部账号现有权限实时决定；账号停用、角色或权限变更后，旧移动会话也会立即受限。

如需离线界面演示，可临时将 `miniprogram/config.js` 的 `demoMode` 改为 `true`。演示账号任意非空密码都可以登录：

- `warehouse.admin`：仓库管理员
- `packaging.operator`：包装厂操作员
- `production.manager`：生产工厂经理
- `material.operator`：物料供应商操作员
- `filing.operator`：备案服务商操作员
- `sampling.operator`：打样工厂操作员

## 连接正式协同 API

编辑 `miniprogram/config.js`：

```js
module.exports = Object.freeze({
  demoMode: false,
  apiBaseUrl: "https://partner.tongzhoukuajing.com",
  adminApiBaseUrl: "https://gyl.tongzhoukuajing.com",
  cloudEnvId: "",
  requestTimeout: 15000,
});
```

同时需要：

1. 在微信公众平台把 `https://partner.tongzhoukuajing.com` 和 `https://gyl.tongzhoukuajing.com` 都加入 `request` 合法域名。
2. API 必须使用受信任的 HTTPS 证书。
3. 反向代理保留响应中的多个 `Set-Cookie` 头。
4. 后端继续开放现有 `/collaboration/auth/*` 和 `/collaboration/v1/*` 路由。
5. 不要把数据库密码、内部令牌或对象存储密钥写入小程序。
6. 非仓库协同上线前设置服务端 `COLLABORATION_OEM_ENABLED=true`。
7. 在小程序隐私保护指引声明录音用途，并在服务端“同舟智能体工作台 → 伙伴汇报”配置试点组织和腾讯云 ASR；语音失败时原手工表单始终可用。

小程序会自行保存协同门户返回的会话 Cookie，并在写操作中携带 CSRF Token、`Idempotency-Key` 和 `If-Match`。

中台登录支持内部账号密码和网页端中台访问码，两种方式都会签发独立的 12 小时 Bearer 会话并使用独立签名受众，不能拿网页端或伙伴端令牌访问。当前开放接口为：

- `POST /api/mobile-admin/v1/auth/login`、`POST /api/mobile-admin/v1/auth/logout`、`GET /api/mobile-admin/v1/session`
- `GET /api/mobile-admin/v1/overview`、`GET /api/mobile-admin/v1/tasks`、`GET /api/mobile-admin/v1/tasks/:id`
- `GET /api/mobile-admin/v1/approvals`、`POST /api/mobile-admin/v1/approvals/:id/review`
- `GET /api/mobile-admin/v1/organizations`、`GET /api/mobile-admin/v1/organizations/:code`
- `GET /api/mobile-admin/v1/business/domestic-inventory`、`GET /api/mobile-admin/v1/business/products`
- `GET /api/mobile-admin/v1/business/qualifications`、`GET /api/mobile-admin/v1/business/stockup-risks`
- `GET /api/mobile-admin/v1/business/container-loading`

中台任务详情会过滤数据投影和例行同步事件；这类后台同步既不进入移动时间轴，也不生成伙伴未读消息。

上述经营模块在移动端为管理查看版：支持搜索、筛选和风险摘要，数据沿用网页端权限与数据范围；库存调整、产品和资质维护、备货决策及装柜确认继续在网页端完成。

真实业务数据由内部服务端投影，不能由小程序直连 WMS、简道云或内部数据库。首件档案也由内部团队维护，伙伴端只读展示，不提供编辑或上传入口：

- 仓库任务：`PUT /collaboration/internal/v1/projections`
- 库存快照：`PUT /collaboration/internal/v1/inventory`
- 备案、打样及伙伴订单：由协同服务内部投影链路同步

内部接口只能使用服务端集成令牌调用。加工/采购伙伴通过 `POST /collaboration/v1/partner-orders/:workItemId/reports` 反馈履约数据；资料和仓库结果会先进入协同指令，再由内部主账处理并回传结果。

## 目录说明

- `miniprogram/pages`：业务页面
- `miniprogram/components/tz-tab-bar`：底部导航
- `miniprogram/utils/api.js`：真实 API 与演示数据适配层
- `miniprogram/utils/admin-api.js`：中台移动 API 与独立 Bearer 会话
- `miniprogram/utils/format.js`：任务状态与日期格式化
- `miniprogram/utils/workspace.js`：组织类型、岗位与动态工作空间适配
- `miniprogram/config.js`：运行环境配置

## 上线前检查

- 将 `demoMode` 关闭并配置正式 API 域名
- 在真机验证伙伴 Cookie 会话、中台 Bearer 会话、拍照、扫码和附件上传
- 配置小程序隐私保护指引中的相机与相册用途
- 验证伙伴账号只能访问本组织和授权仓库数据
- 至少使用两个不同组织和 viewer/operator/manager 三种岗位验证数据与动作隔离
- 使用有/无协同管理权限的两个中台账号验证总览、任务、审批与组织能力隔离
- 使用正式 AppID 生成预览码并完成体验版验收
