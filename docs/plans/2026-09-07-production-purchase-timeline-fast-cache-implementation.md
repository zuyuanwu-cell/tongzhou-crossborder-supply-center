# Production Purchase Timeline and Fast Cache Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add purchase timing milestones and packaging lead-time risk while making the production page render the last successful snapshot immediately.

**Architecture:** Enrich the existing production-material aggregation with purchase-order summaries and per-material lead-time metadata. Change the stockup GET endpoint to stale-while-revalidate with one shared background refresh job, and let the React client poll only while that job is active.

**Tech Stack:** Node.js ESM, React 19, TypeScript, Vite, JSON disk cache, JiandaoYun API

---

### Task 1: Purchase lead-time model

**Files:**
- Modify: `scripts/production-materials-test.mjs`
- Modify: `server/production-materials.js`
- Modify: `server/field-mapping.js`

1. Add failing assertions for purchase dates, derived/manual expected delivery, duration days and risk states.
2. Run `npm run test:production-materials` and confirm failure.
3. Implement material classification, date arithmetic and purchase-order summaries.
4. Run the test and confirm it passes.

### Task 2: Stale-while-revalidate production cache

**Files:**
- Create: `server/outsourcing-cache-policy.js`
- Create: `scripts/outsourcing-cache-policy-test.mjs`
- Modify: `server/server.js`
- Modify: `package.json`

1. Add failing tests for freshness, immediate cached response metadata and refresh de-duplication.
2. Implement the policy helpers and one shared refresh promise.
3. Make `GET /api/stockup` return cached content before background synchronization.
4. Keep `POST /api/outsourcing-orders/sync` as the explicit blocking refresh.

### Task 3: Production UI

**Files:**
- Modify: `src/api.ts`
- Modify: `src/main.tsx`
- Modify: `src/styles.css`

1. Extend TypeScript types with purchase-order and lead-time fields.
2. Render purchase timing in material details and add two timeline nodes per purchase order.
3. Preserve the last payload during background refresh and poll until the fresh snapshot is ready.
4. Add compact responsive styling for the new timing rows and refresh notice.

### Task 4: Verification

**Files:**
- Verify: `scripts/production-materials-test.mjs`
- Verify: `scripts/production-timeline-test.mjs`
- Verify: `scripts/stockup-workflow-test.mjs`

1. Run the focused tests.
2. Run `npm run build`.
3. Open `http://localhost:5173/#production`, verify immediate cached rendering, expanded purchase timing and browser console state.
4. Keep all deployment actions out of scope until the user requests an online update.
