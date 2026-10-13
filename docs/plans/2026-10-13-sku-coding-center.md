# SKU Coding Center Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the stock-up new-product coding queue into a configurable global SKU numbering center that creates the Jiandaoyun base-product record once and optionally creates product masters in user-selected WMS connections.

**Architecture:** Keep one sequence per complete SKU prefix, independent of country and warehouse. Persist prefix rules, irreversible reservations, archive attempts, and per-WMS results in a small local JSON registry using synchronous atomic replacement so a single API process cannot issue the same number twice. Reuse the existing Jiandaoyun product-base workflow and add provider adapters for YunWMS `createProduct` and SEA WMS `/goods/save_single_sku_goods`; Jiandaoyun success is retained when a WMS call fails, and failed WMS targets remain retryable.

**Tech Stack:** Node.js ESM API, React 19 + TypeScript, existing Jiandaoyun client, YunWMS SOAP adapter, SEA WMS signed JSON adapter, Node assertion scripts, Vite.

---

### Task 1: Persistent coding rules and reservations

**Files:**
- Create: `server/sku-coding-registry.js`
- Create: `scripts/sku-coding-registry-test.mjs`
- Modify: `package.json`

**Step 1: Write the failing test**

Cover normalization, discovery of `TZKJ-IDWG033`, independent prefix counters, atomic reservation of `034`/`035`, disabled rules, edited custom rules, persistence reload, and non-reuse after cancellation.

**Step 2: Run test to verify it fails**

Run: `node scripts/sku-coding-registry-test.mjs`
Expected: FAIL because the registry module does not exist.

**Step 3: Implement the registry**

Implement defaults for `TZKJ-IDWG`, `TZKJ-SJJ`, and `TZKJ-NK`; discover other compatible prefixes from live product options; expose `snapshot`, `upsertRule`, `reserve`, `cancelReservation`, `recordArchiveResult`, and `getReservation`. Persist via a temporary file plus atomic rename.

**Step 4: Run the test**

Run: `npm run test:sku-coding-registry`
Expected: PASS.

### Task 2: WMS product-master adapters

**Files:**
- Modify: `server/wms-adapters.js`
- Create: `scripts/wms-product-create-test.mjs`
- Modify: `package.json`

**Step 1: Write the failing adapter tests**

Verify capability reporting, SEA signed request mapping to `/goods/save_single_sku_goods`, YunWMS SOAP mapping to `createProduct`, success normalization, and useful validation/error messages.

**Step 2: Run test to verify it fails**

Run: `node scripts/wms-product-create-test.mjs`
Expected: FAIL because product-master exports do not exist.

**Step 3: Implement provider adapters**

Add `warehouseProductCreateCapability` and `createWarehouseProduct`. SEA maps SKU, names, barcode, cost, dimensions, weight, HS code, and image URL. YunWMS creates a draft product by default and requires weight, dimensions, declared USD value, and English declared name.

**Step 4: Run related tests**

Run: `npm run test:wms-product-create && npm run test:wms-inbound && npm run test:wms-stockup-push`
Expected: PASS.

### Task 3: Archive orchestration and API

**Files:**
- Modify: `server/field-mapping.js`
- Modify: `server/stockup-workflow.js`
- Modify: `server/server.js`
- Modify: `scripts/stockup-workflow-test.mjs`
- Create: `scripts/sku-coding-api-test.mjs`
- Modify: `package.json`

**Step 1: Add failing service and route tests**

Cover rule list/update, next-number reservation, duplicate blocking, Jiandaoyun field mapping, optional warehouses, partial WMS failure, idempotent retry, permissions, and backward compatibility with legacy manual SKU completion.

**Step 2: Run tests to verify failure**

Run: `npm run test:stockup-workflow && node scripts/sku-coding-api-test.mjs`
Expected: new assertions FAIL.

**Step 3: Implement orchestration**

Initialize the registry at `.cache/sku-coding.json`. Enrich the workflow payload with coding rules, active reservations, archive attempts, and WMS product capabilities. Add endpoints for rule update, reservation, cancellation, coding completion, and failed-WMS retry. Correct the live product-base physical-field mappings required by product-master creation.

**Step 4: Run tests**

Run: `npm run test:stockup-workflow && npm run test:sku-coding-api`
Expected: PASS.

### Task 4: Coding workbench UI

**Files:**
- Modify: `src/api.ts`
- Modify: `src/main.tsx`
- Modify: `src/styles.css`

**Step 1: Extend client contracts**

Add types and functions for coding-center snapshot, rule editing, reservation, completion, cancellation, and retry.

**Step 2: Build the focused workbench**

Replace the raw SKU text field with a rule selector and prominent next-number preview/reserve control. Add an expandable product information form, warehouse capability checkboxes, a Jiandaoyun/WMS result timeline, retry buttons, and an administrator rule drawer. Preserve the existing queue context and responsive layout.

**Step 3: Run type/build verification**

Run: `npm run build`
Expected: TypeScript and Vite build PASS.

### Task 5: Regression and visual acceptance

**Files:**
- Modify as needed based on verification.

**Step 1: Run the focused suite**

Run: `npm run test:sku-coding-registry && npm run test:wms-product-create && npm run test:stockup-workflow && npm run test:sku-coding-api && npm run build`
Expected: all PASS.

**Step 2: Run adjacent regressions**

Run: `npm run test:wms-inbound && npm run test:wms-stockup-push && npm run test:access-control`
Expected: all PASS.

**Step 3: Inspect the browser flow**

Start the API and Vite app with sample fixtures, open the stock-up product-coding step, verify desktop and narrow layouts, reserve a code, select no warehouse and multiple warehouses, inspect partial-failure UI, and confirm animations respect reduced motion.

**Step 4: Review repository state**

Run: `git status --short && git diff --check`
Expected: only feature files are modified and no whitespace errors are reported.
