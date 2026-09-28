# Domestic Inventory Transfer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build two-stage domestic warehouse transfers with batch traceability, secure QR deep links, and A4 printable inbound/outbound/transfer documents.

**Architecture:** Add transfer and transfer-line tables beside the existing inventory ledger. Transfer actions update balances, lots, movements, transfer status, and idempotency in one SQLite transaction. React adds a transfer workspace and uses QR SVG/data URLs inside a browser A4 print template.

**Tech Stack:** Node.js 16, sql.js, React 19, TypeScript, Vite, `qrcode`.

---

### Task 1: Transfer schema and service tests

**Files:**
- Modify: `server/domestic-inventory-db.js`
- Modify: `scripts/domestic-inventory-test.mjs`

1. Add failing tests for create, receive, cancel, duplicate receipt, warehouse scope and batch inheritance.
2. Add transfer and transfer-line tables with indexes.
3. Run `npm run test:domestic-inventory` and confirm the new assertions pass.

### Task 2: Transaction-safe transfer service

**Files:**
- Modify: `server/domestic-inventory-service.js`

1. Normalize transfer input and validate two different active warehouses.
2. Create the outbound movement, FIFO lot allocations and transfer rows in one transaction.
3. Receive into the destination and recreate destination lots from source allocations.
4. Cancel in-transit transfers and restore the exact source lots.
5. Expose scoped list/detail methods and in-transit summary.

### Task 3: Permissions and HTTP API

**Files:**
- Modify: `server/access-control.js`
- Modify: `server/domestic-inventory-api.js`
- Modify: `scripts/access-control-test.mjs`
- Modify: `scripts/domestic-inventory-api-test.mjs`

1. Add `domestic_inventory_transfer` and warehouse-role defaults.
2. Add list/create/detail/receive/cancel endpoints with idempotency and action logs.
3. Verify source and target warehouse scopes at the service boundary.

### Task 4: Client workspace and scan routing

**Files:**
- Modify: `src/api.ts`
- Modify: `src/domestic-inventory/DomesticInventoryCenter.tsx`
- Modify: `src/domestic-inventory/domestic-inventory.css`
- Modify: `src/main.tsx`

1. Add transfer types and API calls.
2. Add the “库存调拨” tab, create form, status list, receive/cancel actions and in-transit count.
3. Read secure document IDs from URL query parameters and open the exact authorized record.
4. Add loading, empty, conflict and permission states.

### Task 5: A4 print/PDF templates with QR

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/domestic-inventory/inventory-print.ts`
- Modify: `src/domestic-inventory/DomesticInventoryCenter.tsx`

1. Add Node.js 16-compatible `qrcode` dependency.
2. Render a print-safe A4 document for inbound, outbound and transfer records.
3. Put only an authenticated HTTPS deep link in the QR code.
4. Verify Chinese text, page breaks and browser “Save as PDF”.

### Task 6: Production verification and release

1. Run domestic inventory, API, access-control and production build tests.
2. Test old database startup and foreign-key integrity on a copy.
3. Verify print output and QR deep links locally.
4. Commit, push, create a production backup, deploy, restart and run health checks.
