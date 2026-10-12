# Product Library Reference Refinement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the product library around the reference template's compact comparison-first layout while preserving all Tongzhou price permissions, inventory, assets, qualifications, and bundle-calculator behavior.

**Architecture:** Keep the existing `CatalogProduct` payload and SKU-family grouping. Introduce a single selected price mode at the library level, render country variants as comparison rows in cards, and add a separate responsive price-matrix view plus a family price dialog. The existing detailed product modal remains the source for qualifications, assets, product data, and listing tools.

**Tech Stack:** React 18, TypeScript, Vite, existing Lucide icon set, CSS in `src/theme-refresh.css`, Playwright CLI for browser verification.

---

### Task 1: Add price-mode and family presentation helpers

**Files:**
- Modify: `src/main.tsx:12930-13130`
- Test: production TypeScript build

**Steps:**
1. Add the `CatalogPriceMode` type and metadata for distribution, direct, and sales modes.
2. Add a permission-aware helper that returns one normalized price for a product and mode.
3. Add helpers for country abbreviations, inventory tone/text, and variants shown under the active country filter.
4. Run `npm run build`; expect TypeScript to pass.

### Task 2: Rebuild cards and add the family comparison dialog

**Files:**
- Modify: `src/main.tsx:12990-13130`
- Test: Playwright interaction check

**Steps:**
1. Replace country tabs and three simultaneous price boxes with up to three stacked country price rows.
2. Keep image, copyable SKU, add-to-bundle, and product-details actions.
3. Add an accessible family comparison dialog with all country versions, permission-filtered price columns, inventory, country SKU, and per-country bundle actions.
4. Verify keyboard Escape, backdrop close, and button actions in a browser.

### Task 3: Rebuild the page header and sticky controls

**Files:**
- Modify: `src/main.tsx:13373-13716`

**Steps:**
1. Replace the large hero with a compact title and sync-status row.
2. Consolidate search, brand, channel, price mode, view mode, countries, and counts into one sticky control shelf.
3. Compute country SKU counts after search/brand/channel filtering and before the active country filter.
4. Replace card/list/density controls with card/price-matrix controls.

### Task 4: Add the price matrix

**Files:**
- Modify: `src/main.tsx:13373-13716`

**Steps:**
1. Render products as rows and countries as columns.
2. Use the selected price mode in each cell and preserve inventory indicators.
3. Open family comparison from matrix product names/cells and add a concrete country record to the bundle calculator.
4. Limit the matrix to the current incremental-loading window and retain “load 24 more”.

### Task 5: Apply the reference visual system and motion

**Files:**
- Modify: `src/theme-refresh.css:3557-end`

**Steps:**
1. Replace the prior grouped-library overrides with a Noto Sans SC typography stack and compact cold-gray visual hierarchy.
2. Match measured reference values: 12px grid gap, 10px card radius, 1px neutral border, square media, 14px title, 12px SKU/action text.
3. Implement 550ms page entrance, 700ms control reveal, 300ms image scale, and 150ms card shadow transitions.
4. Add responsive 4/3/2/1-column rules, internally scrollable matrices, and reduced-motion overrides.

### Task 6: Verify locally with real data

**Files:**
- Test artifacts only: `output/playwright/`

**Steps:**
1. Run `npm run build`, `npm run test:dashboard-summary`, and `npm run test:exchange-rate-sync`; expect PASS.
2. Start the local API with background jobs disabled and Vite on an unused port.
3. Authenticate with the local internal access code without printing it.
4. Verify 154 SKU families and 233 country versions, all permitted price modes, country filtering, card/matrix switching, comparison dialog, details, bundle calculator, desktop/mobile overflow, and zero console errors.
5. Compare a final screenshot against the reference screenshot and correct any hierarchy or density regressions.

### Task 7: Commit the implementation

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/theme-refresh.css`

**Steps:**
1. Run `git diff --check` and inspect the final diff.
2. Stage only implementation and plan files, excluding Playwright artifacts.
3. Commit with `feat: refine product library comparison experience`.
