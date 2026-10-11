# System Backup and Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a secure administrator-only workflow to export, validate, migrate, restore, and roll back the main application data without exposing secrets or silently overwriting production data.

**Architecture:** Use a streaming, whole-package encrypted `.tzbak` format; persistent asynchronous jobs outside the business cache; a short global write-drain window for consistent snapshots; and an independently supervised restore agent that performs journaled atomic swaps with health-checked rollback. Import defaults to host-preserving environment migration and requires exact Git SHA compatibility.

**Tech Stack:** Node.js ESM and built-in crypto/streams, React 19, TypeScript, Vite, PM2, existing JSON/SQLite caches, Node assertion tests, Playwright CLI.

---

### Task 1: Implement and test the encrypted archive primitives

**Files:**
- Create: `server/system-backup-archive.js`
- Create: `server/system-backup-env.js`
- Create: `scripts/system-backup-test.mjs`
- Modify: `package.json`

**Steps:**
1. Add temporary fixtures and assertions for round-trip fidelity, wrong passwords, ciphertext tampering, path traversal, file-count and extracted-size limits.
2. Implement bounded logical-path validation and a framed gzip archive stream.
3. Implement `scrypt` key derivation and AES-256-GCM container streaming.
4. Implement migration and full-recovery `.env` merge policies without logging values.
5. Run the focused test until all failure and success cases pass.

### Task 2: Add persistent jobs, write draining, and audit storage

**Files:**
- Create: `server/system-backup-service.js`
- Create: `server/system-maintenance-gate.js`
- Modify: `server/collaboration-bridge.js`
- Modify: `server/server.js`

**Steps:**
1. Persist sanitized job state and append-only operational audit records under `.system-backup`.
2. Track mutating requests, reject new mutations during maintenance, and wait for active mutations to drain.
3. Add collaboration-bridge idle waiting alongside the existing sync-scheduler controls.
4. Implement disk preflight, stable snapshot creation, asynchronous export, streaming upload, isolated import validation, and one-time download tickets.
5. Ensure credentials and package passwords remain memory-only and are cleared after use.

### Task 3: Implement the journaled restore agent

**Files:**
- Create: `server/system-restore-transaction.js`
- Create: `server/system-restore-agent.js`
- Create: `scripts/system-restore-transaction-test.mjs`
- Modify: `ecosystem.config.cjs`

**Steps:**
1. Model restore phases in an external transaction journal.
2. Implement stop, rename/swap, restart, health-check, commit, and rollback operations with injectable process hooks.
3. On startup, recover any nonterminal mutated transaction by rolling back before accepting new work.
4. Add a separately named PM2 application for the persistent restore agent and heartbeat.
5. Test successful swaps, injected failures, and restart recovery with temporary directories only.

### Task 4: Add admin APIs and permissions

**Files:**
- Modify: `server/access-control.js`
- Modify: `scripts/access-control-test.mjs`
- Modify: `server/server.js`
- Modify: `scripts/smoke-api.mjs`

**Steps:**
1. Add the admin-only `system_backup` permission.
2. Add status, export, job polling, ticket, download, import creation/upload/validation/apply, and audit endpoints.
3. Require an authenticated administrator, effective permission, and password reauthentication for dangerous operations.
4. Require `ALLOW_SYSTEM_IMPORT=1` and a healthy restore-agent heartbeat before queueing apply.
5. Verify unauthorized, forbidden, disabled-import, and normal API paths.

### Task 5: Build the system-style React page

**Files:**
- Create: `src/SystemBackupPage.tsx`
- Create: `src/system-backup.css`
- Modify: `src/api.ts`
- Modify: `src/main.tsx`

**Steps:**
1. Add typed API helpers including upload-progress support.
2. Add “系统备份” under “工具与设置” and guard it with the new permission.
3. Render scope/health guidance, export credentials and progress, secure download, import mode and upload progress, validation preview, typed apply confirmation, and audit history.
4. Match existing cards, typography, spacing, orange actions, pale-blue tables, responsive behavior, and accessibility conventions.
5. Prevent accidental duplicate submissions and avoid retaining passwords in persisted browser state.

### Task 6: Verify and hand off without deploying

**Files:**
- Modify as required by verification findings.
- Create screenshots under `output/playwright/` only.

**Steps:**
1. Run archive, restore-transaction, access-control, and API tests.
2. Run the production frontend build.
3. Exercise a complete export and validation cycle using temporary fixture data; never use production data as an import target.
4. Use Playwright CLI to inspect the page at desktop and narrow widths and correct visual or console defects.
5. Review the diff, commit the implementation on the `codex/system-backup-migration` branch, and report that deployment remains a separate explicit action.
