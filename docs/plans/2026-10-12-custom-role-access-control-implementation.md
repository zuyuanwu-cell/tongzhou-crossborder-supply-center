# Custom Role Access Control Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add editable custom role templates, one-role-per-user assignment, per-user permission exceptions, and clear data-scope diagnostics without breaking existing accounts.

**Architecture:** Persist role definitions beside users in the existing users cache. Keep the legacy role category as a security boundary, resolve the assigned role on every request, and compute effective permissions from role permissions plus user allow/deny overrides. Expose role CRUD and assignment through the existing user administration API, then split the React administration screen into role and user workflows.

**Tech Stack:** Node.js ES modules, React 19, TypeScript, Vite, JSON cache persistence, Node assertion-based tests.

---

### Task 1: Role model and legacy migration

**Files:**
- Create: `server/user-roles.js`
- Create: `scripts/user-roles-test.mjs`
- Modify: `server/access-control.js`

**Steps:**
1. Write failing tests for default-role creation, legacy user role assignment, duplicate-name validation, security-type permission filtering, and protected system role behavior.
2. Run `node scripts/user-roles-test.mjs` and confirm it fails because the role module does not exist.
3. Implement normalized role definitions, stable built-in role IDs, migration helpers, role creation/update helpers, and member-count projection.
4. Extend `effectivePermissions` so explicit `rolePermissions` replace legacy hard-coded defaults while the existing security rules still apply.
5. Run `node scripts/user-roles-test.mjs` and `npm run test:access-control`; expect both to pass.

### Task 2: Resolve roles during authentication and persistence

**Files:**
- Modify: `server/user-auth.js`
- Modify: `server/server.js`
- Modify: `scripts/access-control-test.mjs`

**Steps:**
1. Add failing coverage showing a role edit immediately changes a user's effective permissions while personal deny remains dominant.
2. Normalize roles before users when loading `users.json`, migrate missing `roleId`, and save roles with users.
3. Pass the current role collection through user creation, authentication, session projection, and public user serialization.
4. Return `roleId`, resolved role name, effective permissions, role permissions, and permission-source metadata without exposing password fields.
5. Re-run the role and access-control tests.

### Task 3: Role CRUD and user assignment API

**Files:**
- Modify: `server/server.js`
- Modify: `src/api.ts`
- Create: `scripts/user-roles-api-test.mjs`
- Modify: `package.json`

**Steps:**
1. Add failing API-level tests for listing roles, creating a role, rejecting duplicate names, updating role permissions, assigning a role, and preventing protected-role deletion.
2. Add `POST /api/roles`, `PATCH /api/roles/:id`, and `DELETE /api/roles/:id`; require the existing `users` permission and write action-log entries.
3. Add `PATCH /api/users/:id/role`; validate active roles, warehouse scope, self-demotion, and last-admin safeguards.
4. Include role configuration in `/api/users` and extend TypeScript API types and request helpers.
5. Run the new API test and relevant existing tests.

### Task 4: Role-management interface

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Modify: `src/theme-refresh.css`

**Steps:**
1. Add “用户账号 / 角色模板” workspace tabs without changing the surrounding application shell.
2. Implement role cards with member and permission counts plus add, copy, and edit actions.
3. Build a grouped role-permission editor with security-boundary lock explanations and a live menu preview.
4. Add role selection to user creation and user editing; derive the security type from the selected role.
5. Keep interaction keyboard accessible and provide explicit loading, validation, success, and conflict states.

### Task 5: User exception and data-scope clarity

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`
- Modify: `src/theme-refresh.css`

**Steps:**
1. Replace the ambiguous effective-permission checklist with a role inheritance summary plus per-user extra-allow and explicit-deny states.
2. Show source labels for every effective permission and counts for inherited, added, and removed capabilities.
3. Separate the data-scope section visually and explain that country, warehouse, and SKU filters are combined with AND semantics.
4. Add warnings for restricted users, unknown warehouses, and configurations likely to return no data.
5. Preserve notification-profile editing and existing warehouse validation.

### Task 6: Full verification

**Files:**
- Modify as needed based on test findings.

**Steps:**
1. Run `npm run test:user-roles`, `npm run test:access-control`, and relevant warehouse/stockup permission tests.
2. Run `npm run build`; expect TypeScript and Vite production build success.
3. Start the local application and verify the administrator workflow in a browser: create role, edit role, assign role, add user exception, set data scope, and inspect effective-menu preview.
4. Review the rendered page at desktop and narrow widths; fix any overflow, unreadable permission groups, or unclear states.
5. Inspect `git diff` to confirm existing unrelated work remains intact and no cache credentials or generated output are included.
