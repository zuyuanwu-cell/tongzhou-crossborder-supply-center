# Production Center Separation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Separate stockup execution from the production center and present Tongzhou and domestic-custom production data in two focused tabs.

**Architecture:** Extend the existing JianDaoYun outsourcing-order normalization without changing its source form. Preserve the Tongzhou-only array used by replenishment calculations, add a domestic-custom array and queue, then render both through one reusable production board while moving the execution workbench to its own route.

**Tech Stack:** React 19, TypeScript, CSS, Node.js HTTP server, JianDaoYun API.

---

### Task 1: Lock the data contract with tests

**Files:**
- Modify: `scripts/production-timeline-test.mjs`
- Modify: `server/normalize-outsourcing-orders.js`
- Modify: `server/stockup-center.js`

**Steps:**
1. Add fixtures for a Tongzhou production order, a domestic custom order without Tongzhou SKU, and a completed order.
2. Assert that the legacy Tongzhou order collection stays Tongzhou-only.
3. Assert that domestic custom orders are exposed separately and only active quantities reach the production queue.
4. Run `npm run test:production-timeline` and verify the new assertions fail before implementation.

### Task 2: Extend JianDaoYun normalization

**Files:**
- Modify: `server/field-mapping.js`
- Modify: `server/normalize-outsourcing-orders.js`

**Steps:**
1. Add the verified field IDs for production classification, follow-up information, and dated milestones.
2. Normalize every outsourcing record once.
3. Keep `orders` as the backward-compatible Tongzhou subset and add `domesticCustomizationOrders`.
4. Run `npm run test:production-timeline` and verify normalization assertions pass.

### Task 3: Build the two production queues

**Files:**
- Modify: `server/stockup-center.js`
- Modify: `src/api.ts`

**Steps:**
1. Keep replenishment deductions keyed only by `tongzhouSku`.
2. Build a second queue grouped by `productSku` for domestic customization.
3. Add production milestone fields to the frontend types.
4. Expose counts for both tabs and run the timeline test again.

### Task 4: Separate navigation and pages

**Files:**
- Modify: `src/main.tsx`

**Steps:**
1. Add the `#stockup-execution` navigation item.
2. Render the existing three-step execution workbench on the new page.
3. Remove the execution workbench and formal stockup workflow summary from production center.
4. Keep the production center default route on the Tongzhou tab.

### Task 5: Build the production-only tabbed board

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`

**Steps:**
1. Add accessible Tongzhou and domestic-custom tabs with counts.
2. Add production KPIs, age/deadline labels, last-follow-up status, and the expandable timeline.
3. Add clear loading, warning, and per-tab empty states.
4. Verify responsive behavior at desktop and narrow widths.

### Task 6: Verify locally

**Files:**
- Test: `scripts/production-timeline-test.mjs`

**Steps:**
1. Run `npm run test:production-timeline`.
2. Run `npm run test:stockup-workflow`.
3. Run `npm run build`.
4. Open `http://localhost:5173/#production`, verify both tabs and expand at least one timeline.
5. Open `http://localhost:5173/#stockup-execution` and verify the three execution steps are present only there.

