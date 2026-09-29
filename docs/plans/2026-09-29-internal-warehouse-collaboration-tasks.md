# Internal Warehouse Collaboration Tasks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Build an internal task publishing and progress workspace that sends warehouse work to the external partner portal and gives administrators a permanent portal shortcut.

**Architecture:** Reuse the core bridge outbox and the collaboration PostgreSQL work-item model. Add internal-token read endpoints in the collaboration API, validate and publish allowlisted projections in the core backend, and expose the workflow through a new permission-scoped React module under Warehouse Collaboration.

**Tech Stack:** Node.js 16-compatible core backend, Node.js 20 collaboration API, PostgreSQL/RLS, sql.js outbox, React 19, TypeScript, Vite, CSS.

---

### Task 1: Contracts and architecture records

**Files:**
- Modify: `collaboration/shared/contracts.js`
- Create: `docs/adr/0007-internal-warehouse-task-publishing.md`
- Test: `collaboration/tests/contracts.test.mjs`

1. Add a strict internal warehouse task publication schema containing only organization, warehouse, task, due-date and public line fields.
2. Add failing allowlist and invalid-type tests.
3. Implement the schema and run `npm run test:collaboration`.
4. Record why publication goes through the core outbox and why portal impersonation is excluded.

### Task 2: Internal collaboration task read API

**Files:**
- Modify: `collaboration/api/integration.js`
- Modify: `collaboration/api/server.js`
- Modify: `collaboration/api/storage.js`
- Test: `collaboration/tests/migration.test.mjs`

1. Add bounded internal list/detail queries that join organizations but never expose credential fields.
2. Add an internal attachment download function that verifies work-item ownership and clean scan status.
3. Add internal-token routes for list, detail and attachment content.
4. Add static security assertions and run collaboration tests.

### Task 3: Core bridge publication and read façade

**Files:**
- Modify: `server/collaboration-bridge.js`
- Modify: `server/collaboration-bridge-api.js`
- Modify: `server/server.js`
- Test: `collaboration/tests/bridge.test.mjs`

1. Add failing bridge tests for options, strict task publication, immediate outbox delivery and progress reads.
2. Build task options from active warehouse organizations, access grants, internal products and warehouse balances.
3. Validate publication server-side, generate an idempotent internal reference, enqueue the projection and attempt immediate delivery.
4. Add permission-aware core routes for options, publish, list, detail and attachment proxy.
5. Run bridge tests and Node syntax checks.

### Task 4: Internal permissions and navigation

**Files:**
- Modify: `server/access-control.js`
- Modify: `src/main.tsx`
- Modify: `src/WarehouseCollaborationCenter.tsx`
- Test: `scripts/access-control-test.mjs`

1. Add `collaboration_task_view` and `collaboration_task_publish` to the permission catalog.
2. Make publish imply view; keep warehouse/distributor/guest roles denied and administrators enabled by default.
3. Allow the Warehouse Collaboration navigation item for users with either new permission.
4. Add a “协同任务” module tab and run access-control tests.

### Task 5: Internal collaboration task UI

**Files:**
- Create: `src/warehouse-collaboration-task-api.ts`
- Create: `src/WarehouseCollaborationTasks.tsx`
- Create: `src/warehouse-collaboration-tasks.css`
- Modify: `src/WarehouseCollaborationCenter.tsx`

1. Implement typed API calls for options, publication, list, detail and attachment download.
2. Build status metrics, filters, responsive task cards/table and detail drawer.
3. Build a publication drawer with organization/warehouse cascading selection, product search, line quantities, due date and validation.
4. Add an always-visible “打开伙伴门户” button using the server-returned configured URL.
5. Run `npm run build` and correct all TypeScript errors.

### Task 6: Partner completion and full verification

**Files:**
- Modify: `collaboration/portal/src/App.tsx`
- Modify: `collaboration/portal/src/styles.css`
- Test: `collaboration/tests/bridge.test.mjs`

1. Add a generic completion action for stockup and exception tasks while retaining inventory-specific confirmation actions.
2. Run `npm run test:collaboration`, `npm run test:access-control`, `npm run build:collaboration`, and `npm run build`.
3. Start local previews, inspect desktop and mobile states with Playwright, and fix visual defects before delivery.
4. Run `git diff --check` and review the scoped diff without staging unrelated user changes.

