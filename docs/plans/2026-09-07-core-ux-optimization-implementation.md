# 同舟供应链核心体验优化 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在不部署、不改写线上业务数据的前提下，完成数据可信度、经营工作台、库存风险、风险到备货、信息架构、橙蓝白视觉和响应式的第一轮本地改版。

**Architecture:** 保留现有 React/Vite 前端、Node HTTP API、权限键和业务写入接口。新增纯函数形式的数据可信度与指标口径层，由 `/api/dashboard-summary` 返回可解释的统一指标；前端在现有页面中增量抽取共享组件和主题变量，不做一次性重写。备货联动通过 URL hash 查询参数和本地草稿保存实现，正式提交仍走现有服务端校验。

**Tech Stack:** React 19、TypeScript、Vite、Node.js、CSS、现有 Node assert 测试脚本。

---

### Task 1: 数据可信度与首页指标契约

**Files:**
- Create: `server/dashboard-summary.js`
- Create: `scripts/dashboard-summary-test.mjs`
- Modify: `server/server.js`
- Modify: `src/api.ts`

**Step 1: Write the failing test**

覆盖混合币种金额、分页截断、未配置仓库、部分同步、风险状态互斥和已建档/未建档库存集合。

**Step 2: Run test to verify it fails**

Run: `node scripts/dashboard-summary-test.mjs`
Expected: FAIL，因为新的摘要构建函数尚不存在。

**Step 3: Write minimal implementation**

提取首页摘要纯函数；为指标返回 `label/value/unit/scope/window/snapshotAt/completeness/detail`；仓库状态拆为连接、任务和数据完整性；金额仅汇总可识别且可换算的同币种/人民币事实，其他币种列入排除说明。

**Step 4: Run test to verify it passes**

Run: `node scripts/dashboard-summary-test.mjs`
Expected: PASS，截断不正常、缺失不健康、混币不直接相加。

### Task 2: 经营工作台信息顺序与指标下钻

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`

**Step 1: Add the data confidence banner and metric metadata rendering**

首屏按“数据范围 → 重点待办 → 核心指标 → 仓库健康 → 趋势与风险”排序；指标显示单位、快照和口径。

**Step 2: Add filtered navigation helpers**

指标及待办跳转时携带仓库、风险状态、SKU等上下文，返回工作台后保留状态。

**Step 3: Verify desktop first screen**

Run: local browser at `http://localhost:5173/#dashboard`
Expected: 1440×960 首屏可看到三条重点待办和四个核心指标。

### Task 3: 库存风险工作台

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Modify: `src/api.ts`
- Modify: `server/movement-analytics.js`
- Modify: `scripts/movement-comparison-test.mjs`

**Step 1: Add calculation metadata**

动销条目增加计算窗口、销量基准、规则版本、数据完整性和预计断货日；无销量不输出误导性的可售天数。

**Step 2: Reorder the page**

改名为“库存风险”，默认先显示风险清单；同步任务与技术诊断进入可展开区域。

**Step 3: Add a SKU detail drawer**

抽屉显示库存组成、计算依据、快照时间、数据缺口、仓库拆分及“创建备货草稿”入口。

**Step 4: Verify filters and counts**

Expected: 卡片计数、筛选结果和导出使用同一集合；仓库孤儿SKU为独立标签。

### Task 4: 风险到备货草稿闭环

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Modify: `src/api.ts`
- Modify: `server/stockup-workflow.js`
- Modify: `scripts/stockup-workflow-test.mjs`

**Step 1: Add searchable product and warehouse selectors**

正式SKU可搜索；目的国与目的仓使用现有仓库主数据联动；平台字典加入 WILDBERRIES。

**Step 2: Add draft handoff and recovery**

从风险抽屉带入 SKU、国家、仓库、建议量、原因和快照；草稿保存在浏览器本机，提交失败时保留。

**Step 3: Add visible validation**

按钮附近列出缺失字段；拒绝负数、过去日期和无效仓库组合；提交前显示摘要确认。

**Step 4: Verify the task flow**

Expected: 风险SKU到备货草稿不超过3次主要操作，取消或接口失败不会丢失输入。

### Task 5: 信息架构与橙蓝白设计系统

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`

**Step 1: Regroup navigation**

归并为工作台、商品资料、库存与履约、备货协同、经营分析、工具与设置；保留原权限键和 hash。

**Step 2: Add design tokens**

建立品牌橙、操作橙、品牌蓝、深蓝、白、浅背景、文字、边框和语义色变量；用浅色工作区替换当前大面积黑色。

**Step 3: Restyle shared controls**

统一顶栏、侧栏、卡片、按钮、筛选、表格、抽屉、空态、数字对齐和焦点状态。

**Step 4: Verify visual hierarchy**

Expected: 蓝色负责导航/链接，橙色负责主操作，风险状态不只依赖颜色。

### Task 6: 响应式、无障碍与回归

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Modify: `package.json`

**Step 1: Verify named controls and keyboard flow**

为搜索、筛选、选择框、抽屉和错误提示补齐 label、aria 属性、焦点返回和 Escape 关闭。

**Step 2: Verify breakpoints**

检查 390、768、1440 宽度；移动端导航、表格滚动和备货表单必须可操作。

**Step 3: Run automated checks**

Run: `npm run build`
Run: `npm run test:movement-comparison`
Run: `npm run test:stockup-workflow`
Run: `npm run test:performance-analytics`
Run: `npm run test:access-control`
Expected: 全部通过。

**Step 4: Start local preview**

Run: `npm run dev:all`
Expected: 前端本地打开，API健康检查正常；不执行部署、拉取线上代码或重启线上服务。
