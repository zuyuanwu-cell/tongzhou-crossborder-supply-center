# WMS Product Price Sync Implementation Plan

**Goal:** Add a safe one-click workflow that previews and synchronizes the product library's direct supply price to each supported WMS purchase-price field without changing declared value, inventory, or other product attributes.

**Architecture:** The Node API owns capability discovery, exact SKU matching, preview tokens, idempotent execution, audit history, and provider-specific writes. The frontend only renders warehouse selection, diff preview, confirmation, and results. SEA WMS is enabled through its product upsert endpoint with a deliberately minimal payload; YunWMS remains read-only for this feature until an official purchase-price update service is confirmed.

**Tech Stack:** Node.js ESM, React 19, TypeScript, Vite, existing JSON cache helpers, existing WMS adapters.

---

### Task 1: Provider contract and safe adapter

**Files:**
- Modify: `server/wms-adapters.js`
- Test: `scripts/wms-product-price-sync-test.mjs`

1. Expose current WMS purchase price and currency in normalized product rows.
2. Add a capability contract that explicitly marks SEA WMS supported and YunWMS unsupported.
3. Add a SEA purchase-price update adapter that requires an existing WMS SKU id and sends only SKU identity, name, purchase price, and currency.
4. Assert the request never includes declared value, dimensions, inventory, or other product fields.

### Task 2: Preview, execution, idempotency, and audit service

**Files:**
- Create: `server/wms-product-price-sync.js`
- Modify: `server/server.js`
- Test: `scripts/wms-product-price-sync-test.mjs`

1. Build exact SKU/country matching and source-price validation.
2. Generate expiring preview tokens with pending, unchanged, missing-price, unmatched, conflict, and unsupported results.
3. Execute only pending rows from the stored preview, require `Idempotency-Key`, and persist a bounded audit history.
4. Add internal routes for options, preview, and execution protected by `product_sync`.

### Task 3: Product-library user interface

**Files:**
- Create: `src/WmsProductPriceSyncDialog.tsx`
- Create: `src/wms-product-price-sync.css`
- Modify: `src/api.ts`
- Modify: `src/main.tsx`

1. Add an internal-only “同步价格到 WMS” entry to the product library.
2. Let the user select supported warehouses and generate a diff preview.
3. Show source price, current WMS price, status reason, and a warning that declared value is never changed.
4. Require a second confirmation before execution and show per-row results with a retry path.

### Task 4: Verification

**Files:**
- Modify: `package.json`

1. Run the focused WMS price-sync test and existing WMS product-create test.
2. Run access-control tests and the production frontend build.
3. Inspect the final diff and keep the worktree clean except for this feature.
4. Do not deploy; a later frontend release must follow `AGENTS.md` staging, contract, authenticated smoke, backup, and atomic cutover requirements.
