# Partner Qualification Coverage Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a read-only, warehouse-scoped qualification coverage page to the partner collaboration portal without exposing certificate files.

**Architecture:** Reuse one shared qualification-coverage domain implementation in the internal UI and the core-to-partner projection writer. Store only sanitized coverage snapshots beside existing warehouse inventory projections, then expose them through a session-scoped partner API and a mobile-first portal page.

**Tech Stack:** Node.js ESM, PostgreSQL, Zod, React 19, TypeScript, Vite, CSS, Node test runner.

---

### Task 1: Share the qualification coverage domain

**Files:**
- Create: `shared/qualification-coverage-core.js`
- Create: `shared/qualification-coverage-core.d.ts`
- Modify: `src/qualification-coverage.ts`
- Test: `scripts/qualification-coverage-test.mjs`

**Step 1: Write the failing test**

Extend the qualification coverage test to import the shared runtime and assert the internal wrapper produces the same risk ordering, country path matching and expiry result.

**Step 2: Run test to verify it fails**

Run: `npm run test:qualification-coverage`
Expected: FAIL because the shared runtime does not exist.

**Step 3: Write minimal implementation**

Move the runtime calculation into the shared ESM module, add strict TypeScript declarations, and make `src/qualification-coverage.ts` a typed re-export.

**Step 4: Run test to verify it passes**

Run: `npm run test:qualification-coverage`
Expected: PASS.

**Step 5: Commit**

```bash
git add shared src/qualification-coverage.ts scripts/qualification-coverage-test.mjs
git commit -m "refactor: share qualification coverage domain"
```

### Task 2: Project sanitized warehouse qualification data

**Files:**
- Modify: `collaboration/shared/contracts.js`
- Modify: `server/collaboration-bridge.js`
- Modify: `server/server.js`
- Test: `collaboration/tests/bridge.test.mjs`
- Test: `scripts/partner-qualification-coverage-test.mjs`
- Modify: `package.json`

**Step 1: Write the failing tests**

Add fixtures covering an overseas WMS warehouse, positive-stock filtering, a qualification-only fingerprint change, and absence of `files`, `fileId`, `url` and `remark` in the queued projection.

**Step 2: Run tests to verify they fail**

Run: `node scripts/partner-qualification-coverage-test.mjs && node --test collaboration/tests/bridge.test.mjs`
Expected: FAIL because the projection contract has no qualification snapshot.

**Step 3: Write minimal implementation**

Extend the projection contract with optional country/category/brand and sanitized coverage fields. Add a WMS snapshot resolver to the bridge while preserving the domestic inventory fallback. Include coverage data in the inventory fingerprint.

**Step 4: Run tests to verify they pass**

Run: `npm run test:partner-qualification-coverage && node --test collaboration/tests/bridge.test.mjs`
Expected: PASS.

**Step 5: Commit**

```bash
git add collaboration/shared/contracts.js server/collaboration-bridge.js server/server.js collaboration/tests/bridge.test.mjs scripts/partner-qualification-coverage-test.mjs package.json
git commit -m "feat: project sanitized warehouse qualification coverage"
```

### Task 3: Persist and expose scoped coverage

**Files:**
- Create: `collaboration/migrations/0013_partner_qualification_coverage.sql`
- Modify: `collaboration/api/integration.js`
- Modify: `collaboration/api/repository.js`
- Modify: `collaboration/api/server.js`
- Modify: `collaboration/api/workspace.js`
- Modify: `collaboration/api/migrate.js`
- Test: `collaboration/tests/qualification-coverage.test.mjs`
- Test: `collaboration/tests/migration.test.mjs`

**Step 1: Write the failing tests**

Assert the migration is additive, the workspace module follows `warehouse.inventory.view`, the endpoint rejects warehouses outside the current organization grants, old rows are reported as unavailable, and serialized results contain no file fields.

**Step 2: Run tests to verify they fail**

Run: `node --test collaboration/tests/qualification-coverage.test.mjs collaboration/tests/migration.test.mjs`
Expected: FAIL because the migration, repository query and route do not exist.

**Step 3: Write minimal implementation**

Add projection columns, persistence mapping, a scoped repository query and the GET route. Build `dataContext` from projection timestamps and completed snapshot counts.

**Step 4: Run tests to verify they pass**

Run: `node --test collaboration/tests/qualification-coverage.test.mjs collaboration/tests/migration.test.mjs`
Expected: PASS.

**Step 5: Commit**

```bash
git add collaboration/migrations/0013_partner_qualification_coverage.sql collaboration/api collaboration/tests
git commit -m "feat: expose scoped partner qualification coverage"
```

### Task 4: Build the partner read-only page

**Files:**
- Create: `collaboration/portal/src/QualificationCoveragePage.tsx`
- Create: `collaboration/portal/src/qualification-coverage.css`
- Modify: `collaboration/portal/src/types.ts`
- Modify: `collaboration/portal/src/api.ts`
- Modify: `collaboration/portal/src/App.tsx`
- Modify: `collaboration/portal/src/styles.css`
- Test: `scripts/partner-qualification-coverage-test.mjs`

**Step 1: Write the failing static UI assertions**

Assert the page exposes warehouse, search and status controls; uses the new endpoint; contains no download action; and adds a workspace-gated route.

**Step 2: Run test to verify it fails**

Run: `npm run test:partner-qualification-coverage`
Expected: FAIL because the portal page and route do not exist.

**Step 3: Write minimal implementation**

Implement data-context feedback, KPI cards, desktop matrix, mobile product cards and a read-only details drawer. Preserve previous successful data while refreshing and restore focus on close.

**Step 4: Run test and builds**

Run: `npm run test:partner-qualification-coverage && npm run build:collaboration && npm run build`
Expected: PASS.

**Step 5: Commit**

```bash
git add collaboration/portal scripts/partner-qualification-coverage-test.mjs
git commit -m "feat: add partner qualification coverage page"
```

### Task 5: Regression and release readiness

**Files:**
- Modify if required: `docs/plans/2026-10-19-partner-qualification-coverage.md`

**Step 1: Run focused tests**

Run: `npm run test:qualification-coverage && npm run test:partner-qualification-coverage && npm run test:collaboration`
Expected: PASS.

**Step 2: Run production builds**

Run: `npm run build && npm run build:collaboration`
Expected: PASS with no TypeScript or Vite errors.

**Step 3: Inspect security-sensitive output**

Search projected fixtures and API serializers for `files`, `fileId`, attachment URLs and remarks. Confirm only allowed read-only fields remain.

**Step 4: Inspect Git diff**

Run: `git status --short && git diff --check`
Expected: only intended files changed and no whitespace errors.

**Step 5: Commit any verification-only adjustment**

```bash
git add <adjusted-files>
git commit -m "test: verify partner qualification coverage"
```
