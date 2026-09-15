# Warehouse Collaboration Reminders Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add permission-aware, rate-limited warehouse reminder actions to after-sales tickets and warehouse tickets.

**Architecture:** Keep reminder state inside each ticket's existing timeline and notification history. Add dedicated POST endpoints that validate ownership, data scope, workflow state, and a 30-minute server-side cooldown before routing a Markdown notification to the assigned warehouse robot and returning the refreshed ticket.

**Tech Stack:** Node.js 16 ESM HTTP server, JSON-backed domain services, React 19, TypeScript, enterprise WeChat robot webhooks, Node assertion tests.

---

### Task 1: Domain reminder rules

**Files:**
- Modify: `server/after-sales.js`
- Modify: `server/warehouse-tickets.js`
- Test: `scripts/after-sales-test.mjs`
- Test: `scripts/warehouse-tickets-test.mjs`

**Steps:**
1. Add failing tests for a successful reminder, terminal/rejected-state rejection, and the 30-minute cooldown.
2. Run `npm run test:after-sales` and `npm run test:warehouse-tickets` and confirm the new assertions fail.
3. Add `remind(id, actor)` to both services. Append a `reminder_sent` timeline event without changing status, set `updatedAt`, and reject ineligible states or repeat attempts inside 30 minutes.
4. Return cooldown metadata with the updated ticket.
5. Rerun both workflow tests and confirm they pass.

### Task 2: Warehouse notification routing and APIs

**Files:**
- Modify: `server/after-sales-notifications.js`
- Modify: `server/server.js`
- Test: `scripts/after-sales-test.mjs`
- Test: `scripts/warehouse-tickets-test.mjs`
- Test: `scripts/smoke-api.mjs`

**Steps:**
1. Add failing tests for reminder Markdown content and warehouse deep links.
2. Add `buildAfterSalesReminderMarkdown` and `buildWarehouseTicketReminderMarkdown`.
3. Treat `remind` as a warehouse-targeted event in both notification delivery functions.
4. Add the two POST reminder routes with report/admin permission, ownership, warehouse data-scope checks, audit logging, and HTTP 429 cooldown errors.
5. Extend the API smoke test to verify delivery reaches the warehouse webhook and unauthorized/cross-owner access is blocked.
6. Run the workflow and smoke tests.

### Task 3: Client actions and drawer controls

**Files:**
- Modify: `src/api.ts`
- Modify: `src/AfterSalesCenter.tsx`
- Modify: `src/WarehouseTicketCenter.tsx`
- Modify: `src/theme-refresh.css`

**Steps:**
1. Add typed reminder API clients and cooldown metadata to ticket types.
2. Add reminder handlers to both centers, refresh the selected ticket/list after success, and show the existing notification outcome message.
3. Add a “催办仓库” button for eligible operator/admin users. Disable it during requests and within the cooldown window; show the next available time.
4. Add a compact warning-style button treatment consistent with the existing drawer footer.
5. Build with Node.js 16 to verify TypeScript and Vite compatibility.

### Task 4: Browser verification and delivery

**Files:**
- Verify: `src/AfterSalesCenter.tsx`
- Verify: `src/WarehouseTicketCenter.tsx`

**Steps:**
1. Run all focused workflow tests and `npm run build`.
2. Start the local application and verify both drawers expose one unique reminder button for eligible open tickets.
3. Verify success feedback, timeline insertion, button cooldown text, and no console errors.
4. Commit only the feature files and plan documents; do not include local browser artifacts.
