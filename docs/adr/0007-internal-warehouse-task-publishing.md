# ADR-0007: Publish Internal Warehouse Tasks Through the Collaboration Outbox

## Status

Accepted

## Context

Internal administrators need to issue warehouse tasks to external collaboration organizations and follow progress. The existing warehouse-ticket module is an internal JSON/WeCom workflow and does not use partner organization isolation, PostgreSQL RLS, task versions, partner commands or the collaboration audit timeline.

## Decision

Add a separate internal collaboration-task workspace. The internal backend validates organization and warehouse grants, projects only allowlisted task fields, and publishes through the existing durable collaboration outbox. The collaboration API provides internal-token-protected read endpoints for task progress and clean attachments. Inventory remains authoritative in the internal core.

The middle platform provides a configured shortcut to the partner portal login page but does not impersonate a partner user.

## Consequences

### Positive

- One task and one timeline are visible to both internal staff and the target warehouse.
- Retries, idempotency, organization isolation and audit behavior remain consistent with existing collaboration flows.
- The legacy operational-issue ticket module remains stable and independent.
- Administrators no longer need to remember the partner-domain address.

### Negative

- Two warehouse task concepts remain visible and require clear labels.
- Progress reads depend on the collaboration API being available; failures must be shown without affecting core inventory.
- Internal attachment download requires a controlled proxy because object storage is private.

### Neutral

- No new database migration is required because work items, lines, events and attachments already model the workflow.

## Alternatives Considered

- Convert the legacy warehouse-ticket store into collaboration work items: rejected because it would create a risky migration and mix internal-only tickets with external tenant data.
- Let the browser call the collaboration API directly: rejected because it would expose internal credentials and bypass the durable outbox.
- Add administrator impersonation: rejected because it weakens identity, authorization and audit guarantees.

## References

- `docs/adr/0001-external-collaboration-boundary.md`
- `docs/adr/0005-organization-resource-permissions.md`
- `docs/adr/0006-partner-initiated-warehouse-operations.md`
- `docs/plans/2026-09-29-internal-warehouse-collaboration-tasks-design.md`
