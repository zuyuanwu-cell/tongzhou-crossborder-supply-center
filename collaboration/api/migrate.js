import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { integrationPool, closePools } from "./db.js";
import { collaborationConfig } from "./config.js";

function quotedIdentifier(value) {
  const identifier = String(value || "");
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(identifier)) throw new Error("Invalid PostgreSQL portal role name.");
  return `"${identifier}"`;
}

async function configurePortalPrivileges(client) {
  const fromUrl = decodeURIComponent(new URL(collaborationConfig.databaseUrl).username || "");
  const integrationRoleName = decodeURIComponent(new URL(collaborationConfig.integrationDatabaseUrl).username || "");
  const roleName = String(process.env.COLLABORATION_PORTAL_DB_ROLE || fromUrl).trim();
  if (roleName === integrationRoleName) throw new Error("Portal and integration PostgreSQL roles must be different so RLS cannot be bypassed.");
  const role = quotedIdentifier(roleName);
  const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [roleName]);
  if (!exists.rows[0]) throw new Error(`PostgreSQL portal role does not exist: ${roleName}`);
  const tables = [
    "organizations", "collaboration_users", "organization_memberships", "collaboration_invitations",
    "collaboration_projects", "collaboration_spaces", "work_items", "warehouse_task_lines",
    "warehouse_inventory_projections", "work_item_events", "partner_commands", "approvals",
    "attachments", "notifications", "audit_log", "oem_artifacts", "supplier_quotes", "production_milestones",
    "organization_access_grants", "integration_outbox",
  ];
  await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await client.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${role}`);
  await client.query(`GRANT SELECT ON organizations,collaboration_users,warehouse_inventory_projections,organization_access_grants TO ${role}`);
  await client.query(`GRANT SELECT,INSERT ON collaboration_projects,collaboration_spaces,warehouse_task_lines TO ${role}`);
  await client.query(`GRANT SELECT,UPDATE ON organization_memberships TO ${role}`);
  await client.query(`GRANT SELECT,INSERT,UPDATE ON collaboration_invitations TO ${role}`);
  await client.query(`GRANT SELECT,INSERT,UPDATE ON work_items TO ${role}`);
  await client.query(`GRANT SELECT,INSERT ON work_item_events,partner_commands,approvals,audit_log,integration_outbox TO ${role}`);
  await client.query(`GRANT SELECT,INSERT,UPDATE ON attachments,notifications TO ${role}`);
  await client.query(`GRANT SELECT,INSERT ON oem_artifacts,supplier_quotes TO ${role}`);
  await client.query(`GRANT SELECT,UPDATE ON production_milestones TO ${role}`);
  await client.query(`REVOKE UPDATE,DELETE ON audit_log FROM ${role}`);
  return tables;
}

export async function migrate() {
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  const files = readdirSync(migrationsDir).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  const client = await integrationPool.connect();
  try {
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const appliedRows = await client.query("SELECT version FROM schema_migrations");
    const applied = new Set(appliedRows.rows.map((row) => row.version));
    for (const file of files) {
      if (applied.has(file)) continue;
      await client.query("BEGIN");
      try {
        await client.query(readFileSync(join(migrationsDir, file), "utf8"));
        await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`[collaboration:migrate] applied ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    await configurePortalPrivileges(client);
  } finally {
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate()
    .then(() => console.log("[collaboration:migrate] complete"))
    .finally(closePools)
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
