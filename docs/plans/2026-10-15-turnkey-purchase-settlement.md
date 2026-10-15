# Turnkey Purchase Settlement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Project a turnkey factory's Jiandaoyun purchase orders and purchase inbound documents into its private partner workspace, with purchase inbound quantities as the settlement basis.

**Architecture:** Extend the existing Jiandaoyun outsourcing source adapter to normalize linked purchase orders and their inbound documents. The core bridge filters every document by the bound factory, publishes purchase orders as separate tenant-scoped work items, and embeds only allowlisted inbound settlement summaries in the purchase projection. The collaboration API remains the tenant boundary and the portal renders the read-only settlement facts beside existing procurement feedback actions.

**Tech Stack:** Node.js 20, Zod, PostgreSQL/RLS, React/TypeScript, Node test runner, Vite.

---

### Task 1: Contract and source normalization

**Files:**
- Modify: `collaboration/shared/contracts.js`
- Modify: `server/collaboration-outsourcing-source.js`
- Test: `collaboration/tests/bridge.test.mjs`

**Steps:**
1. Add a failing contract/bridge test for a turnkey factory purchase order with two purchase inbound batches.
2. Run `node --test collaboration/tests/bridge.test.mjs` and confirm the purchase projection assertion fails.
3. Add allowlisted purchase linkage and inbound settlement fields to the projection schema.
4. Normalize purchase lines, exact supplier ownership, multi-batch inbound totals and cancelled/completed status.
5. Re-run the test and confirm it passes.

### Task 2: Bridge synchronization

**Files:**
- Modify: `server/jiandaoyun-client.js`
- Modify: `server/server.js`
- Modify: `server/collaboration-bridge.js`
- Test: `collaboration/tests/bridge.test.mjs`

**Steps:**
1. Inject the existing purchase/inbound fetcher into the collaboration bridge.
2. Fetch linked documents for the bound factory's tracked outsourcing order numbers.
3. Publish only purchase records owned by the exact bound factory and allowed by the procurement grant.
4. Store an independent fingerprint/version per purchase order and keep retry behavior idempotent.
5. Verify unchanged records do not enqueue a second projection and foreign-supplier records never enqueue.

### Task 3: Partner portal settlement view

**Files:**
- Modify: `collaboration/portal/src/types.ts`
- Modify: `collaboration/portal/src/App.tsx`
- Modify: `collaboration/portal/src/styles.css`

**Steps:**
1. Add typed purchase linkage and inbound settlement fields.
2. Show the linked processing order and settlement basis on purchase cards/details.
3. Add quantity/payable summary cards and a compact inbound batch table.
4. Preserve existing purchase fulfillment, shipment and exception actions.
5. Build the portal and visually verify the production demo state.

### Task 4: Regression and security verification

**Files:**
- Modify: `collaboration/tests/contracts.test.mjs`
- Modify: `collaboration/tests/bridge.test.mjs`

**Steps:**
1. Verify production projections still reject price fields.
2. Verify purchase projections reject non-allowlisted payload keys.
3. Verify supplier A cannot receive supplier B purchase/inbound data.
4. Run `npm run test:collaboration`.
5. Run `npm run build:collaboration` and `npm run build`.
