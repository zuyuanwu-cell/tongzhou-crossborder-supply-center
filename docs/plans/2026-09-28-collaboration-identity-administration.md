# 协同组织与账号管理实施计划

> 变更说明：本计划中的邀请激活与强制 MFA/TOTP 方案已由 [ADR-0002](../adr/0002-password-only-partner-login.md) 替代；现行方案为管理员直接分配账号密码、首次登录强制改密。

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** 在内部供应链中台安全创建合作组织和首位组织管理员，并允许外部门户组织管理员维护本组织成员，全程不共享密码、不暴露内部服务令牌。

**Architecture:** 浏览器只调用现有中台 `/api/collaboration-bridge/*`；中台后端使用内网令牌调用协同 API。协同 API 负责组织、邀请、成员与审计记录，PostgreSQL RLS 继续约束门户侧组织范围。首位管理员及后续成员均通过 48 小时一次性链接自行设置密码，组织管理员强制 MFA。

**Tech Stack:** Node.js 20、PostgreSQL 16、React 19、TypeScript、Zod、现有中台桥接服务。

---

## 设计取舍

- 采用“内部中台代理”方案：内部令牌只存在服务器端，页面无法读取。
- 不采用浏览器直连协同内部 API：否则令牌可能通过构建产物、网络面板或日志泄露。
- 不采用数据库脚本作为日常开户方式：仅保留为故障应急，正常操作必须写审计日志。
- 内部管理员只负责组织、首位管理员、组织停用及邀请恢复；普通成员由该组织管理员维护。
- 未配置 SMTP 时，激活链接只在刚创建或重新签发后显示一次；数据库只保存令牌哈希，无法事后还原。

### Task 1: 协同身份管理服务

**Files:**
- Modify: `collaboration/api/identity.js`
- Modify: `collaboration/api/server.js`
- Test: `collaboration/tests/postgres.integration.test.mjs`

1. 增加组织列表、组织详情、组织状态更新和首位管理员初始化函数。
2. 增加邀请列表、撤销、重新签发函数；所有管理写操作写入只追加审计日志。
3. 邀请接口在邮件未发送时返回一次性激活地址，不返回原始令牌字段。
4. 管理员邀请、撤销、重新签发继续要求近期 MFA。
5. 运行 `npm run test:collaboration`。

### Task 2: 内部中台安全代理

**Files:**
- Modify: `server/collaboration-bridge.js`
- Modify: `server/collaboration-bridge-api.js`
- Modify: `server/access-control.js`
- Test: `collaboration/tests/bridge.test.mjs`

1. 桥接客户端增加组织和邀请管理方法。
2. 中台 API 增加列表、详情、初始化、停用、撤销和重新签发路由。
3. 复用现有仅内部管理员可获得的 `operations` 入口权限，并保留桥接 API 对 `operations + domestic_inventory_manage` 的双重校验，避免扩大既有账号权限。
4. 验证代理请求始终携带服务器端 Bearer Token，页面响应不包含该令牌。

### Task 3: 内部“协同组织与账号”页面

**Files:**
- Create: `src/CollaborationIdentityAdmin.tsx`
- Create: `src/collaboration-identity-admin.css`
- Modify: `src/main.tsx`

1. 增加组织概览、搜索、状态和管理员覆盖率指标。
2. 增加“创建组织并邀请首位管理员”表单，不出现密码输入框。
3. 增加组织详情、成员状态、待激活邀请、撤销/重发邀请和组织停用操作。
4. 对一次性激活地址提供明确的单次复制提示。
5. 页面沿用中台蓝色、橙色和紧凑运营后台视觉。

### Task 4: 门户“成员管理”页面

**Files:**
- Modify: `collaboration/portal/src/types.ts`
- Modify: `collaboration/portal/src/api.ts`
- Modify: `collaboration/portal/src/App.tsx`
- Modify: `collaboration/portal/src/styles.css`

1. 仅向 `organization_admin` 显示成员管理导航。
2. 展示成员、角色、状态、MFA 和最近登录时间。
3. 支持邀请、调整角色、强制 MFA、停用成员、撤销及重发邀请。
4. 敏感操作遇到 `428` 时显示 TOTP 二次验证并在验证后重试。
5. 移动端保持可用，不暴露其他组织任何筛选入口。

### Task 5: 验证

**Files:**
- Test: `collaboration/tests/bridge.test.mjs`
- Test: `collaboration/tests/postgres.integration.test.mjs`

1. 运行 `npm run test:collaboration`，预期全部单元测试通过，未配置数据库时仅跳过真实 PostgreSQL 用例。
2. 运行 `npm run build:collaboration` 和 `npm run build`，预期 TypeScript 与 Vite 构建成功。
3. 使用演示管理员会话检查两端页面在桌面和手机宽度下的布局。
4. 检查 `git diff --check` 和暂存文件，确保未覆盖工作区已有修改。
