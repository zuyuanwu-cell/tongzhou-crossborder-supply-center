# Inventory Value and Returns Optimization Implementation Plan
> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Correct inventory/return accounting, add auditable daily ledgers, and make the inventory-value and overseas-return pages complete, fast, and explainable.

**Architecture:** Validate warehouse-scoped provider data at ingestion, normalize orders and daily inventory ledger rows into indexed SQLite tables, aggregate valuation and reconciliation from those ledgers, and expose completeness-aware APIs consumed by lazy-loaded operational pages.

**Tech Stack:** Node.js ESM, sql.js/SQLite, React 19, TypeScript, Vite, Node assertion scripts.

---

### Task 1: Enforce explicit YunWMS warehouse scope

**Files:**
- Modify: `server/wms-adapters.js`
- Modify: `server/warehouse-return-query.js`
- Modify: `scripts/warehouse-binding-test.mjs`
- Modify: `scripts/warehouse-return-query-test.mjs`

**Steps:**
1. Add failing tests for missing warehouse codes, ambiguous warehouse-name matches, and provider rows from a different warehouse.
2. Require a configured code for inventory, outbound-order, and return synchronization.
3. Validate every returned order/inventory/return row against its own `warehouse_code` before assigning the connection ID.
4. Run `node scripts/warehouse-binding-test.mjs` and `node scripts/warehouse-return-query-test.mjs`.

### Task 2: Correct inventory quantity and valuation boundaries

**Files:**
- Modify: `server/wms-adapters.js`
- Modify: `server/inventory-value.js`
- Modify: `scripts/inventory-value-test.mjs`
- Modify: `src/api.ts`

**Steps:**
1. Add failing assertions proving total/on-hand excludes pending, in-transit, faulty, and temporary quantities.
2. Make `totalQty` the sellable on-hand total and expose separate quantity fields.
3. Remove name-based warehouse cost mapping and use configured provider warehouse codes only.
4. Report unvalued quantity and cost coverage prominently in the payload.
5. Run `npm run test:inventory-value`.

### Task 3: Correct return lifecycle and quality metrics

**Files:**
- Modify: `server/warehouse-return-query.js`
- Modify: `server/overseas-inventory-reconciliation.js`
- Modify: `scripts/warehouse-return-query-test.mjs`
- Modify: `scripts/overseas-inventory-reconciliation-test.mjs`

**Steps:**
1. Add failing tests for cancelled returns, SEA drafts, stable completion dates, bad/scrapped quantity, and damage rate.
2. Separate draft from in-transit, exclude cancelled facts, and stop falling back to mutable `updatedAt` for completion.
3. Add requested/received/unreceived/draft/bad/scrapped metrics and damage rate by summary, warehouse, SKU, and shop.
4. Return `returnFacts` once at the top level; SKU rows carry fact IDs only.
5. Run the return query and overseas reconciliation tests.

### Task 4: Unify business-time and snapshot completeness rules

**Files:**
- Modify: `server/date-time.js`
- Modify: `server/movement-comparison.js`
- Modify: `server/overseas-inventory-reconciliation.js`
- Modify: `server/server.js`
- Modify: `scripts/movement-comparison-test.mjs`
- Modify: `scripts/overseas-inventory-reconciliation-test.mjs`

**Steps:**
1. Add shared business-date helpers and tests around Beijing/Moscow/Jakarta midnight boundaries.
2. Default API anchors and YunWMS cutoffs to business time rather than UTC.
3. Require snapshots at the requested boundary; return missing/partial flags instead of silently choosing an old snapshot.
4. Include faulty/temporary totals in snapshot metadata without adding them to closing on-hand.
5. Run movement and reconciliation tests.

### Task 5: Version historical costs

**Files:**
- Modify: `server/inventory-value.js`
- Modify: `scripts/inventory-value-test.mjs`
- Modify: `src/api.ts`

**Steps:**
1. Add tests for past/future supplemental costs and explicit valuation basis metadata.
2. Remove future-version fallback and mark current product price used for historical snapshots as traced/current basis.
3. Return cost effective date, rate effective date, basis, and missing-cost quantity on each relevant row.
4. Run `npm run test:inventory-value`.

### Task 6: Add indexed order and inventory ledger database

**Files:**
- Create: `server/inventory-ledger-db.js`
- Create: `scripts/inventory-ledger-db-test.mjs`
- Modify: `server/server.js`
- Modify: `package.json`

**Steps:**
1. Write failing database tests for idempotent order upsert, range indexes, daily ledger upsert, flags, and range aggregation.
2. Implement SQLite schema and transactions without resetting existing runtime data.
3. Add compatibility migration/import from JSON caches and keep the legacy cache read-only during transition.
4. Run `node scripts/inventory-ledger-db-test.mjs`.

### Task 7: Materialize daily ledgers and valuation

**Files:**
- Create: `server/inventory-daily-ledger.js`
- Create: `scripts/inventory-daily-ledger-test.mjs`
- Modify: `server/inventory-value.js`
- Modify: `server/overseas-inventory-reconciliation.js`
- Modify: `server/server.js`

**Steps:**
1. Add failing formula tests for inbound, return restock, transfer, outbound, adjustment, missing snapshot, and variance.
2. Build and persist daily rows from unified snapshots and indexed movements/orders.
3. Materialize historical valuation with its exact cost/rate basis.
4. Make value and reconciliation endpoints prefer ledger queries with a safe compatibility fallback.
5. Run all inventory, movement, and reconciliation tests.

### Task 8: Harden API authorization, exports, compression, and caching

**Files:**
- Modify: `server/server.js`
- Create: `scripts/inventory-api-hardening-test.mjs`
- Modify: `package.json`

**Steps:**
1. Add failing route tests for 403 authorization semantics and restricted CORS exports.
2. Add gzip/brotli negotiation for large JSON responses.
3. Add 30–60 second user-scope/range cache invalidated by sync completion.
4. Run route hardening tests and `node --check server/server.js`.

### Task 9: Rework inventory value and return reconciliation pages

**Files:**
- Modify: `src/InventoryValuePage.tsx`
- Modify: `src/OverseasInventoryReconciliationPage.tsx`
- Modify: `src/overseas-inventory-reconciliation.css`
- Modify: `src/api.ts`
- Create: `src/date-presets.ts`
- Create: `scripts/inventory-pages-contract-test.mjs`

**Steps:**
1. Add static contract tests for completeness banners, unified date presets, damage rate, outbound comparison, and exception task lists.
2. Implement the operational layout using existing design tokens and protected UI contract.
3. Add SKU ledger/document drill-down and cost-coverage warnings.
4. Run the page contract test and `npm run build`.

### Task 10: Route-level lazy loading and final verification

**Files:**
- Modify: `src/main.tsx`
- Modify: `scripts/local-performance-check.mjs`
- Modify: `config/production-ui-contract.json` only if additions are required; never weaken existing checks.

**Steps:**
1. Lazy-load inventory, value, reconciliation, and after-sales route components with stable loading states.
2. Verify bundle size and existing protected UI contract.
3. Run focused tests, `npm ci`, `npm run build`, `node scripts/smoke-api.mjs`, and `node scripts/verify-frontend-release.mjs` in the clean worktree/staging flow as applicable.
4. Review `git diff`, confirm no runtime data or `dist/` is staged, and commit the completed implementation.
