# Stockup Workflow Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Make the stockup execution flow understandable, reversible, and safe for partial shipments without changing or clearing existing JiandaoYun business data.

**Architecture:** Keep JiandaoYun as the source of truth. Add pure transition planners to `server/stockup-workflow.js`, expose guarded mutation endpoints in `server/server.js`, and render one active workflow step at a time in React. Cancellation and voiding are status changes plus exact quantity reconciliation; records are never deleted.

**Tech Stack:** Node.js ESM, React 19, TypeScript, Vite, JiandaoYun v5 APIs, existing assertion-based workflow test script.

---

### Task 1: Specify reversible workflow transitions

**Files:**
- Modify: `scripts/stockup-workflow-test.mjs`
- Modify: `server/stockup-workflow.js`

**Steps:**
1. Add failing assertions for partial-shipment readiness, execution-line rollback, cancelling remaining execution quantity, and shipment-void reconciliation.
2. Run `npm run test:stockup-workflow` and confirm the new imports/assertions fail.
3. Add pure helpers that derive line/order state and build dry-run transition plans.
4. Run `npm run test:stockup-workflow` and confirm all transition assertions pass.

### Task 2: Add guarded workflow mutation endpoints

**Files:**
- Modify: `server/stockup-workflow.js`
- Modify: `server/server.js`
- Modify: `src/api.ts`

**Steps:**
1. Implement execution cancellation that cancels only unshipped remaining quantity and reopens the affected demand quantity.
2. Implement one-step progress rollback without allowing any quantity below already shipped quantity.
3. Implement shipment voiding that rejects locked costs and recomputes shipped totals from all non-void shipments.
4. Add authenticated API routes and action-log entries for each operation.
5. Add typed frontend API functions.
6. Run workflow tests and `npm run build`.

### Task 3: Replace the mixed execution layout with a current-task flow

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`

**Steps:**
1. Replace the simultaneous step 1/3 panels with a three-step task switcher that renders only the selected step.
2. After execution creation, automatically move to progress tracking and keep the new order visible.
3. List every active execution order in the shipment selector; show its available quantity and a clear prerequisite when unavailable.
4. Treat each line as shippable when `qualifiedQty > shippedQty`, including partial qualification.
5. Add guarded actions for rollback, cancelling remaining quantity, and voiding an unlocked shipment.
6. Keep input state local to memoized row components and avoid rerendering inactive forms.
7. Run `npm run build`.

### Task 4: Verify, release, and health-check

**Files:**
- Verify: `scripts/stockup-workflow-test.mjs`
- Verify: built assets under `dist/`

**Steps:**
1. Run `npm run test:stockup-workflow` and `npm run build`.
2. Inspect the git diff and confirm only planned files changed; preserve existing untracked user files.
3. Verify the current server/process and deployment mechanism before replacing assets.
4. Deploy without clearing JiandaoYun or local runtime data.
5. Verify `/api/health` and visually test create → progress → partial shipment readiness plus cancellation/rollback controls.

