# 仓库协同项目群通知路由 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让售后单和仓库工单的处理进度按提交人所属项目团队推送到指定企业微信群，并支持 `@` 提交人、负责人、失败兜底和单次提报时临时切换项目团队。

**Architecture:** 企业微信配置增加稳定的“项目团队”实体，用户档案保存默认团队和企业微信 UserID；创建工单时冻结团队及提交人通知身份，后续通知按冻结团队读取当前机器人配置，配置缺失或发送失败时回退到全局运营群。旧工单没有快照时继续走全局群，保证兼容。

**Tech Stack:** Node.js、React、TypeScript、原生 JSON 存储、企业微信群机器人 Webhook、Vitest/Node 测试脚本、Playwright。

---

### Task 1: 通知路由核心规则

**Files:**
- Create: `server/wecom-project-routing.js`
- Create: `scripts/wecom-project-routing-test.mjs`
- Modify: `package.json`

1. 为项目团队、企业微信 UserID、创建时路由快照提供统一规范化函数。
2. 实现“指定团队 > 用户默认团队 > 全局运营群”的路由规则。
3. 实现提交人及团队负责人的去重 `@` 内容生成，并覆盖旧工单兜底。
4. 先运行核心测试，确认规则稳定。

### Task 2: 配置和用户接口

**Files:**
- Modify: `server/user-auth.js`
- Modify: `server/server.js`
- Modify: `src/api.ts`
- Modify: `scripts/access-control-test.mjs`

1. 用户档案增加默认通知团队、企业微信 UserID、是否默认提醒本人。
2. 企业微信配置增加项目团队及其机器人、负责人 UserID。
3. 增加项目团队保存、测试通知、当前用户可选团队、用户通知档案更新接口。
4. 对接口权限、字段格式和脱敏输出补充自动化测试。

### Task 3: 工单路由与通知审计

**Files:**
- Modify: `server/after-sales.js`
- Modify: `server/warehouse-tickets.js`
- Modify: `server/server.js`
- Modify: `src/api.ts`
- Modify: `scripts/after-sales-test.mjs`
- Modify: `scripts/warehouse-tickets-test.mjs`
- Modify: `scripts/smoke-api.mjs`

1. 创建售后单/仓库工单时保存通知路由快照。
2. 仓库受理、驳回、回复、上传面单、状态更新、完结时按项目群发送。
3. 通知日志记录团队、路由来源、兜底状态和提醒人数。
4. 机器人或项目配置失效时回退全局运营群，并记录失败原因。

### Task 4: 管理和提报界面

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/AfterSalesCenter.tsx`
- Modify: `src/WarehouseTicketCenter.tsx`
- Modify: `src/styles.css`

1. 企业微信通知页增加项目团队配置和测试按钮。
2. 用户管理增加默认团队、企业微信 UserID、提醒本人设置。
3. 售后单与仓库工单提报页显示默认通知群，允许本次临时切换。
4. 工单详情和通知记录显示实际通知团队及兜底状态。

### Task 5: 生产级本地验收

**Files:**
- Modify: `reports/` 下的本地验收截图（不纳入业务代码）

1. 执行路由、售后、仓库工单、权限、API 冒烟测试。
2. 执行前端生产构建和 `git diff --check`。
3. 使用本地页面验证配置、提报、仓库处理及通知记录交互。
4. 本轮仅交付本地可验收版本，不更新线上。
