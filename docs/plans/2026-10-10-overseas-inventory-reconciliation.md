# Overseas Inventory Reconciliation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an overseas-only inventory reconciliation center with period comparison, return lifecycle visibility, unclaimed WMS returns, rankings, and drill-down evidence.

**Architecture:** Add a pure aggregation module that joins movement snapshots, shipped orders, stockup receipts, normalized WMS returns, after-sales tickets, and shop metadata. Expose the result through a scoped server API with a persisted WMS return-fact cache, then render it in a dedicated React page and navigation item.

**Tech Stack:** Node.js ESM, React 19, TypeScript, Vite, lucide-react, existing JSON/SQLite caches, Node assert scripts, Playwright CLI.

---

### Task 1: Lock the reconciliation domain rules with tests

**Files:**
- Create: `scripts/overseas-inventory-reconciliation-test.mjs`
- Create: `server/overseas-inventory-reconciliation.js`
- Modify: `package.json`

**Steps:**
1. Add fixtures for two warehouses, opening/closing snapshots, outbound orders, inbound receipts, WMS return facts, and manually recorded after-sales tickets.
2. Assert the period ranges, warehouse theoretical closing quantity, residual variance, return lifecycle counts, unclaimed facts, and SKU/shop rankings.
3. Run `npm run test:overseas-reconciliation` and confirm the test initially fails.
4. Implement the pure aggregation functions and rerun until the test passes.

### Task 2: Add bounded WMS return-list synchronization and cache

**Files:**
- Modify: `server/warehouse-return-query.js`
- Modify: `scripts/warehouse-return-query-test.mjs`
- Modify: `server/server.js`

**Steps:**
1. Add tests for period listing without an identifier for SEA WMS and YunWMS.
2. Export a bounded `listWarehouseReturns` operation that reuses normalization and pagination rules.
3. Persist normalized facts and per-warehouse sync diagnostics in the existing cache directory.
4. Keep previous successful facts when a warehouse refresh fails.
5. Run warehouse-return and reconciliation tests.

### Task 3: Expose scoped reconciliation and claim APIs

**Files:**
- Modify: `server/stockup-collaboration-service.js`
- Modify: `server/server.js`
- Modify: `server/access-control.js`
- Modify: `scripts/access-control-test.mjs`

**Steps:**
1. Add an internal stockup reconciliation fact reader for confirmed receipts and in-transit shipments.
2. Add `inventory_reconciliation` to the permission catalog and admin defaults.
3. Implement `GET /api/overseas-inventory-reconciliation`, `POST /refresh`, and `POST /returns/:id/claim`.
4. Apply warehouse/country/SKU data scopes to every source.
5. Verify permissions and pure aggregation tests.

### Task 4: Build the dedicated React page

**Files:**
- Create: `src/OverseasInventoryReconciliationPage.tsx`
- Create: `src/overseas-inventory-reconciliation.css`
- Modify: `src/api.ts`
- Modify: `src/main.tsx`

**Steps:**
1. Add typed API payloads and request helpers.
2. Add an independent navigation item and lazy view loading.
3. Render period controls, freshness/source coverage, KPI cards, warehouse reconciliation rows, lifecycle flow, rankings, drill-down tables, CSV export, and the unclaimed-return action queue.
4. Keep the page responsive and accessible at desktop and narrow widths.
5. Run `npm run build` and resolve TypeScript/CSS issues.

### Task 5: Verify behavior and presentation

**Files:**
- Modify as required by verification findings.
- Create screenshots under `output/playwright/` only.

**Steps:**
1. Run the focused test scripts and production build.
2. Start the API and Vite app against local data.
3. Use Playwright CLI to open the new route, inspect the accessibility snapshot, exercise period filters and drill-down, and capture desktop/mobile screenshots.
4. Fix any visual or console defects and repeat verification.
