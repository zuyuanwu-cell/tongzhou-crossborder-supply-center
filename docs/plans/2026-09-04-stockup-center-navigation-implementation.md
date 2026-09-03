# Stockup Center Navigation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将“备货建议”和“生产中心”拆成“备货中心”的下级页面，其中生产中心只展示仍在执行中的委外生产产品。

**Architecture:** 保留现有备货工作流与后端接口不变，以路由和前端聚合视图完成职责拆分。`#stockup` 继续承载端到端备货工作流，`#stockup-recommendations` 承载动销建议与计划工具，`#production` 复用供应执行能力但在数据进入组件前按“委外生产 + 非终态”过滤。三个入口共用现有 `stockup` 权限，避免破坏线上角色配置。

**Tech Stack:** React 19、TypeScript、Vite、现有简道云/WMS 工作流 API。

## Confirmed UX contract

- 侧边栏层级为：备货中心 → 备货建议、生产中心。
- 备货建议不再隐藏在“链路总览”的折叠工具中，而是独立页面直接展示。
- 生产中心只包含 `executionMode` 或明细 `supplyMode` 为“委外生产/生产”的执行数据。
- 已完成、已取消、已作废、已关闭的生产明细不计入生产中心，不显示为待办。
- 外采成品、自有成品不进入生产中心，继续在备货中心的供应执行中处理。
- 本次不新增后端权限键；后续如需按角色单独授权生产中心，再迁移为独立权限。

### Task 1: Add navigation and route loading

**Files:**
- Modify: `src/main.tsx`

1. Add child navigation entries for `备货建议` and `生产中心` under `备货中心`.
2. Treat all three stockup hashes as stockup data routes in the active-view loading effect.
3. Add page render branches and accurate topbar titles.
4. Verify with `npm run build`.

### Task 2: Separate recommendation page

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css` only if existing stockup styles cannot express the new page header.

1. Add a stockup page mode for workflow versus recommendations.
2. Keep workflow tabs on the parent page.
3. Render accepted suggestions, planning, outsourced queue, dismissed suggestions, recommendation list, and WMS reference list directly on the recommendation page.
4. Remove the legacy expand/collapse dependency from the parent overview.
5. Verify empty, populated, and syncing states through a production build.

### Task 3: Add production-only center

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css` if a compact production summary needs dedicated layout.

1. Add a production page header and counts derived from production-only active lines.
2. Extend the execution workbench with a `production` scope.
3. Filter orders, progress lines, shipment-ready lines, candidate demands, and WMS confirmation tasks to production records only.
4. Force newly created execution records in this view to use `委外生产` and hide non-production execution options.
5. Ensure terminal records are excluded by the existing active-line rule.
6. Verify that external-purchase records are absent and production records remain editable.

### Task 4: Regression and release

**Files:**
- Test: existing scripts and production bundle

1. Run `npm run build`.
2. Run `npm run test:stockup-workflow`.
3. Review the diff for unrelated changes and secrets.
4. Commit and push the approved implementation.
5. Deploy with the existing Baota deployment script, verify `/api/health`, then browser-check all three hashes.
