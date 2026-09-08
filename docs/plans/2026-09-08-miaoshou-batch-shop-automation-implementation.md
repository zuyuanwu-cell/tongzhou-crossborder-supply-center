# Miaoshou Batch Shop Automation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add safe multi-select batch enable and disable controls for Miaoshou automatic tracking-number application.

**Architecture:** Add one atomic service method and one administrator-only batch API route, then expose it through the typed frontend API client. The Miaoshou page will own selection state and render a compact batch toolbar above the existing shop cards while retaining all single-shop controls.

**Tech Stack:** Node.js service modules, native HTTP routing, React 19, TypeScript, CSS, Node assertion tests.

---

### Task 1: Service behavior

**Files:**
- Modify: `scripts/miaoshou-automation-test.mjs`
- Modify: `server/miaoshou-automation.js`

**Step 1: Write the failing test**

Add assertions that `updateShops` enables two unique shops, reports updated and unchanged counts, rejects unknown or invalid shops atomically, and disables selected shops.

**Step 2: Run test to verify it fails**

Run: `npm run test:miaoshou`

Expected: FAIL because `updateShops` does not exist.

**Step 3: Write minimal implementation**

Normalize and deduplicate at most 500 IDs, validate all shops before mutation, update timestamps and actor fields, save once, and return the public payload plus `batchSummary`.

**Step 4: Run test to verify it passes**

Run: `npm run test:miaoshou`

Expected: `miaoshou automation tests passed`.

### Task 2: API route and client

**Files:**
- Modify: `server/server.js`
- Modify: `src/api.ts`

**Step 1: Add the server route**

Add `PATCH /api/miaoshou/shops/batch` before the single-shop dynamic route, enforce `canManageModule(auth, "miaoshou")`, call `updateShops`, and append one batch action log.

**Step 2: Add the typed client function**

Add `batchUpdateMiaoshouShops(shopIds, input)` and type the optional batch summary in `MiaoshouPayload`.

**Step 3: Verify syntax and service tests**

Run: `node --check server/server.js && node --check server/miaoshou-automation.js && npm run test:miaoshou`

Expected: all commands pass.

### Task 3: Multi-select user interface

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Modify: `src/theme-refresh.css`

**Step 1: Add selection state and derived sets**

Track selected shop IDs, prune IDs that disappear after synchronization, and derive valid current-result IDs plus enable/disable targets.

**Step 2: Add batch actions**

Show confirmation dialogs, submit only shops whose state changes, refresh the payload, clear completed selections, and report modified/unchanged counts.

**Step 3: Add controls and accessibility**

Render card checkboxes, selection count, select-current and clear controls, and disabled/loading states for batch buttons. Ensure labels, focus states, mobile wrapping, empty states, and contrast remain readable.

**Step 4: Build**

Run: `npm run build`

Expected: TypeScript and Vite build pass.

### Task 4: Regression and visual verification

**Files:**
- Verify: `scripts/miaoshou-automation-test.mjs`
- Verify: local `#miaoshou` page

**Step 1: Run focused regression tests**

Run: `npm run test:miaoshou && npm run test:access-control`

Expected: both suites pass.

**Step 2: Inspect the local page**

Open `http://localhost:5173/#miaoshou`, confirm the batch toolbar, valid/invalid selection behavior, responsive layout, and existing single-shop actions.

**Step 3: Commit the completed feature**

Commit only the two plan files and feature files; leave `.playwright-cli/`, `output/`, `reports/`, and `video/` untouched.

