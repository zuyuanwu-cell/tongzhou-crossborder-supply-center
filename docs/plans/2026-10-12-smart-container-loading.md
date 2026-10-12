# Smart Container Loading Implementation Plan

**Goal:** Deliver an internal, permission-controlled 3D container loading workspace that turns shipment carton data into versioned, reviewable loading plans.

**Architecture:** Run a deterministic constraint-based packing heuristic in the existing Node backend, persist JSON snapshots and immutable versions in the stockup SQLite store, and lazy-load a Three.js workbench in the React client. Keep production data untouched during development and preserve Node.js 16 compatibility.

## Delivered work

### Backend and persistence

- Added plan, version, and packaging-profile tables through additive SQLite migrations.
- Added candidate generation for maximum load, balance, and SKU completeness.
- Added boundary, door, payload, support, collision, idempotent-version, and source-shipment-version validation.
- Added worker-thread execution with a timeout for plans of 300 cartons or more, keeping the existing API process responsive.
- Added bootstrap, create, read, save-version, recalculate, confirm, and void APIs.
- Added custom container dimensions and carton-count limits.

### Permissions and integration

- Added independent view, manage, and confirm permissions with role implications.
- Added the “智能装柜” route under “备货协同”.
- Added a “3D装柜” action to shipment cards with direct shipment deep-linking.
- Reused the existing authentication, warehouse data scope, action log, and stockup store.

### Frontend

- Added three-strategy comparison, KPI cards, cargo detail, warnings, version history, and CSV export.
- Added an interactive 3D container shell, carton selection, orbit controls, drag controls, rotation, locking, and loading-sequence playback.
- Added carton master-data reuse, custom container or vehicle inputs, product de-duplication by SKU, and “remaining cargo to next container”.
- Added responsive desktop/tablet/mobile layout consistent with the middle-platform blue/orange visual system.

### Verification

- Engine and service assertion tests cover normal packing, door rejection, payload limits, persistence, plan summaries, manual versions, confirmation, and locked-state rejection.
- Access-control tests cover the new permissions.
- Production TypeScript/Vite build succeeds.
- Browser verification covers login, route access, plan creation, 3D selection, collision blocking, version saving, custom containers, leftover continuation, and WebGL context cleanup.

## Deferred enhancements

- Pallet loading, mixed pallet/carton loading, lashing zones, prohibited adjacency, stacking-strength rules, and dangerous-goods segregation.
- PDF loading diagrams with per-layer views and warehouse-facing collaboration delivery.
- Progress polling and queued execution for future workloads beyond the current 2,000-carton limit.
