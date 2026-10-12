# ADR-0008: Hybrid Constraint-Based 3D Container Loading

## Status

Accepted

## Context

The supply-chain center needs to estimate how many cartons fit in a container, compare alternative loading arrangements, and give operators an understandable loading sequence. The result is operational guidance rather than a physics or structural-engineering certificate. Shipment data and packaging profiles already belong to the internal middle platform, while the existing production host must remain compatible with Node.js 16.

## Decision

Keep the feature in the existing repository and internal backend. Use a deterministic, axis-aligned carton-placement engine on the server and a lazy-loaded Three.js viewer in the browser. Plans with 300 cartons or more run in a bounded Node worker thread so the existing API event loop remains responsive.

The engine enforces container bounds, door dimensions, maximum payload, carton orientation, collision avoidance, and a minimum support ratio. It generates three auditable candidates: maximum load, weight balance, and SKU completeness. Users may select cartons, adjust coordinates, rotate horizontally, lock positions, replay the loading sequence, save immutable versions, confirm a version, or void the plan. Server-side validation runs again before any manual version is persisted.

Plans store a snapshot of container dimensions, shipment version, carton inputs, candidates, metrics, and warnings in the stockup SQLite database. Confirmation checks that the source shipment version has not changed. The feature has separate view, manage, and confirm permissions. Custom container and vehicle dimensions are supported, and unplaced cartons can seed the next container without duplicating already loaded cartons.

## Consequences

### Positive

- Operators receive a visual plan without introducing a separate service, Kubernetes, or a newer Node runtime.
- Three strategies expose trade-offs instead of presenting one opaque answer.
- Versioning, source-version checks, audit actions, and server validation make manual adjustments traceable.
- Three.js is loaded only on the smart-loading route, so normal middle-platform pages do not pay the 3D bundle cost.

### Negative

- The heuristic does not model deformation, lashing, palletization, axle loads, hazardous-goods segregation, or dynamic transport forces.
- Large carton counts are computation-heavy and render only the first 1,500 cartons in detail.
- Operators must maintain accurate carton dimensions and weight; poor master data produces poor recommendations.

### Neutral

- The generated plan is an operational assistant. The loader and carrier remain responsible for checking the actual container, packaging strength, legal payload, and safe securing method.

## Alternatives Considered

- Full rigid-body physics: rejected for the first release because it adds complexity without reliable packaging strength or friction data.
- Browser-only optimization: rejected because long calculations, permission checks, and repeatable version snapshots belong on the server.
- A standalone microservice: rejected because current scale and the old production host do not justify extra deployment and operations risk.
- Static 2D diagrams: rejected because operators need rotation, selection, loading playback, and spatial inspection.

## References

- `docs/plans/2026-10-12-smart-container-loading-design.md`
- `docs/plans/2026-10-12-smart-container-loading.md`
