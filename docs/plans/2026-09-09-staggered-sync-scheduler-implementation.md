# Staggered Sync Scheduler Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every normal page load read prepared snapshots while a single staggered background scheduler refreshes each external data source at an appropriate cadence.

**Architecture:** Add a reusable in-process scheduler with persistent task metadata, lane-based concurrency, startup offsets, jitter and retry backoff. Register the existing sync functions as independent tasks, remove page-open external refreshes, and use a safe incremental merge for frequent warehouse-order refreshes.

**Tech Stack:** Node.js ESM, React 19, TypeScript, JSON disk cache, PM2, existing JiandaoYun/Miaoshou/WMS adapters

---

### Task 1: Scheduler core

**Files:**
- Create: `server/sync-scheduler.js`
- Create: `scripts/sync-scheduler-test.mjs`
- Modify: `package.json`

1. Write failing tests for startup staggering, one-at-a-time external execution, failure backoff and state restoration.
2. Run `node scripts/sync-scheduler-test.mjs` and confirm the scheduler module is missing.
3. Implement task registration, heartbeat checks, lane capacity, jitter, retry backoff, status projection and persistence callbacks.
4. Run the focused test and confirm it passes.

### Task 2: Safe incremental order refresh

**Files:**
- Modify: `server/order-cache-policy.js`
- Modify: `scripts/order-cache-policy-test.mjs`
- Modify: `server/server.js`

1. Add failing tests showing recent-window rows are replaced while older rows and undated safe rows remain.
2. Implement the merge helper and mark scheduled order jobs as incremental.
3. Keep manual order jobs as full-range atomic replacement.
4. Run `npm run test:order-cache-policy` and confirm it passes.

### Task 3: Register staggered background tasks

**Files:**
- Modify: `server/server.js`
- Modify: `.env.example`
- Modify: `src/api.ts`
- Modify: `src/main.tsx`

1. Replace independent `setInterval` calls and the monolithic `runAutoSync` with one scheduler heartbeat.
2. Register production, inventory, incremental orders, Miaoshou, products, assets, warehouse information, qualifications, exchange rates, notifications and daily snapshots with separate intervals and offsets.
3. Persist scheduler metadata and expose a permission-protected read-only status endpoint.
4. Include a compact scheduler health summary in the dashboard data-health area.

### Task 4: Make normal reads cache-only

**Files:**
- Modify: `server/server.js`
- Modify: `scripts/outsourcing-cache-policy-test.mjs`

1. Remove production synchronization from `GET /api/stockup`; return the last successful snapshot and its freshness metadata immediately.
2. Keep explicit POST synchronization as a manual recovery path.
3. Verify the stockup and production read endpoints do not start external work.

### Task 5: Verification

**Files:**
- Verify: `scripts/sync-scheduler-test.mjs`
- Verify: `scripts/order-cache-policy-test.mjs`
- Verify: `scripts/after-sales-test.mjs`
- Verify: `scripts/production-materials-test.mjs`
- Verify: `scripts/smoke-api.mjs`

1. Run all focused tests.
2. Run the full project build.
3. Start the local API and verify scheduler status, health latency and cached after-sales/production responses.
4. Open the local pages and verify existing data is visible without a blocking synchronization request.
