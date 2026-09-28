import pg from "pg";
import { collaborationConfig } from "./config.js";

const { Pool } = pg;
const sharedPoolOptions = {
  max: 12,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 8_000,
  statement_timeout: 15_000,
  application_name: "tongzhou-collaboration-api",
};

export const portalPool = new Pool({ connectionString: collaborationConfig.databaseUrl, ...sharedPoolOptions });
export const integrationPool = new Pool({ connectionString: collaborationConfig.integrationDatabaseUrl, ...sharedPoolOptions, application_name: "tongzhou-collaboration-integration" });

export async function withOrganization(organizationId, callback) {
  if (!/^[0-9a-f-]{36}$/i.test(String(organizationId || ""))) throw new Error("Invalid organization context.");
  const client = await portalPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function withSystem(callback) {
  const client = await integrationPool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function closePools() {
  await Promise.all([portalPool.end(), integrationPool.end()]);
}
