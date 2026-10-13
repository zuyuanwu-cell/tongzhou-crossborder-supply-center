# Domestic Warehouse Stockup Workflow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an end-to-end domestic warehouse stockup workbench with inspection, split domestic/overseas outbound routing, warehouse expense capture, and management dashboards.

**Architecture:** Extend the existing stockup SQLite service as the system of record and project warehouse-safe task data into the isolated collaboration portal. Partner actions return through the existing command bridge and update the stockup work order idempotently. React workspaces consume dedicated summary/detail APIs.

**Tech Stack:** React 19, TypeScript, Vite, Node.js, SQL.js, PostgreSQL collaboration service, Zod, Node test runner.

---

### Task 1: Domain tests and storage schema

**Files:**
- Create: `scripts/stockup-warehouse-work-orders-test.mjs`
- Modify: `server/stockup-collaboration-db.js`
- Modify: `server/stockup-collaboration-service.js`

**Steps:**
1. Write failing service tests for work-order creation, inspection quantity conservation, split routes, over-allocation rejection, fee totals and idempotency.
2. Run `node scripts/stockup-warehouse-work-orders-test.mjs`; expect missing-method failures.
3. Add work-order, line, fee, route-allocation and event tables with additive migrations.
4. Implement service methods and status derivation.
5. Re-run the test; expect all cases to pass.

### Task 2: Main API and collaboration bridge

**Files:**
- Modify: `server/stockup-collaboration-api.js`
- Modify: `server/collaboration-bridge.js`
- Modify: `server/server.js`
- Modify: `src/api.ts`
- Modify: `src/stockup/types.ts`

**Steps:**
1. Add work-order list, dashboard, create/publish, detail, processing and expense endpoints.
2. Inject the stockup service into the bridge and apply `stockup_process` commands to the matching work order.
3. Add typed browser API clients.
4. Run the domain and bridge tests.

### Task 3: Partner contract and API

**Files:**
- Modify: `collaboration/shared/contracts.js`
- Create: `collaboration/migrations/0008_stockup_workbench.sql`
- Modify: `collaboration/api/migrate.js`
- Modify: `collaboration/api/repository.js`
- Modify: `collaboration/portal/src/types.ts`
- Modify: `collaboration/portal/src/api.ts`
- Modify: `collaboration/tests/contracts.test.mjs`
- Modify: `collaboration/tests/migration.test.mjs`

**Steps:**
1. Add failing contract tests for safe work instructions, inspection rows, package data, fees and outbound routes.
2. Extend the projection/action schemas and persistence without exposing private costs.
3. Return structured task execution data from detail APIs.
4. Run `npm run test:collaboration`; expect all non-integration tests to pass.

### Task 4: Partner warehouse operations workbench

**Files:**
- Modify: `collaboration/portal/src/App.tsx`
- Modify: `collaboration/portal/src/styles.css`

**Steps:**
1. Add the warehouse dashboard metrics, queue funnel, waiting-receipt product table, due alerts and expense trend.
2. Add a guided stockup work-order drawer with checklist, per-SKU inspection/package entry, split routes and expense entry.
3. Submit one structured idempotent command and show returned status.
4. Run `npm run build:collaboration`; expect success.

### Task 5: Management workbench and dashboards

**Files:**
- Create: `src/stockup/WarehouseOperationsWorkbench.tsx`
- Modify: `src/stockup/StockupCollaborationCenter.tsx`
- Modify: `src/stockup/stockup-collaboration.css`

**Steps:**
1. Add a domestic warehouse operations tab with KPI cards, workflow funnel, route split, expense composition and waiting-product queue.
2. Add work-order creation/publish and detail drill-down.
3. Preserve current request, logistics and cost tabs.
4. Run `npm run build`; expect success.

### Task 6: End-to-end verification

**Files:**
- Modify: `package.json`
- Update: `scripts/stockup-warehouse-work-orders-test.mjs`

**Steps:**
1. Add a repeatable npm test command.
2. Run the new domain test, existing stockup tests, collaboration tests and both production builds.
3. Start local services, exercise create → inspect → split outbound → cost flow, and inspect both workbenches in the browser.
4. Fix all functional, console, overflow and responsive issues found during visual verification.
