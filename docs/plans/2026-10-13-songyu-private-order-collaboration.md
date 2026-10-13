# Songyu Private Order Collaboration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add deny-by-default production, procurement, and sampling collaboration for the Songyu organization, including internal publishing/progress visibility and partner reporting.

**Architecture:** Extend the production-factory access catalog with an opt-in procurement resource. Reuse the existing OEM and partner-order projection contracts for explicit organization-targeted publishing, expose organization-scoped internal work-item reads, and add a compact publisher/progress panel to the identity admin page. The portal remains tenant-isolated by organization ID and adds task-type tabs for mixed-role factories.

**Tech Stack:** React 19, TypeScript, Node.js, Zod, PostgreSQL RLS, existing SQLite outbox bridge, Node test runner.

---

### Task 1: Mixed factory authorization

**Files:**
- Modify: `collaboration/api/access.js`
- Modify: `collaboration/tests/contracts.test.mjs`

1. Add a failing contract assertion that a production factory exposes the procurement resource and its three procurement capabilities.
2. Run `node --test collaboration/tests/contracts.test.mjs` and verify it fails.
3. Add procurement capabilities/resource to the production factory catalog while keeping grants opt-in.
4. Run the contract test and verify it passes.

### Task 2: Safe internal task publication and progress listing

**Files:**
- Modify: `server/collaboration-bridge-api.js`
- Modify: `server/collaboration-bridge.js`
- Modify: `collaboration/tests/bridge.test.mjs`

1. Add failing bridge tests for publishing all three task types to one organization and for organization-scoped listing.
2. Add a high-level publisher that generates event/core references, maps only public fields into existing OEM/partner-order schemas, queues the event, and flushes the outbox.
3. Add administrator-only routes under `/api/collaboration-bridge/organizations/:code/work-items` for GET and POST.
4. Ensure publication rejects a task whose resource is not granted to the target organization.
5. Run `node --test collaboration/tests/bridge.test.mjs`.

### Task 3: Internal administrator UI

**Files:**
- Modify: `src/collaboration-identity-admin-api.ts`
- Modify: `src/CollaborationIdentityAdmin.tsx`
- Modify: `src/collaboration-identity-admin.css`

1. Add typed API helpers for organization work-item listing and publication.
2. Add a “协同单据” section to the selected organization with task-type switch, allowlisted publication form, and current progress list.
3. Disable publishing when the corresponding resource grant is missing and show the exact permission that must be enabled.
4. Build with `npm run build`.

### Task 4: Partner portal type navigation and sampling progress

**Files:**
- Modify: `collaboration/portal/src/App.tsx`
- Modify: `collaboration/portal/src/styles.css`

1. Add task-type tabs and counts for production factories.
2. Keep status/keyword filtering and apply the type filter without widening API scope.
3. Add explicit sampling progress guidance and preserve result/attachment submission.
4. Build with `npm run build:collaboration`.

### Task 5: Regression, Songyu configuration, and production validation

**Files:**
- Modify: `docs/collaboration-acceptance-matrix.md`

1. Run `npm run test:collaboration`, `npm run build`, and `npm run build:collaboration`.
2. Deploy with the existing backup-first production script and preserve all production databases/uploads.
3. Configure organization `mf-j11qkyn6` with `production`, `procurement`, and `sampling` grants through the audited access API.
4. Validate Songyu can see only its own three task categories and cannot retrieve another organization's work item by ID.
5. Record the acceptance result without creating fake production orders.
