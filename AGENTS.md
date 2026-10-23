# Production release safety

The production site is a split deployment: the Node API and the `dist/` frontend are independent release units.

- Never rebuild or replace `dist/` for a backend-only change.
- Never build production assets from a mutable or dirty production checkout.
- A frontend release must come from a clean Git commit, build into a staging directory, pass `scripts/verify-frontend-release.mjs` against the live `dist/` baseline, and pass the configured authenticated UI smoke command before it may remain live.
- The protected UI contract is `config/production-ui-contract.json`. It includes the operations workbench country time/rate cards and the current product-library layout. Removing or redesigning those features requires an explicit contract review; do not weaken the checks just to make a build pass.
- Back up the complete current `dist/` before every frontend cutover. Switch the staged directory atomically and automatically restore the backup if external health or UI smoke fails.
- Production hot patches are not a source of truth. Reconcile them into Git before the next release.
- Do not deploy from a worktree with tracked or untracked source changes. Runtime data, databases, uploads, logs, caches, and generated backups are outside the Git release unit and must never be reset by deployment.
