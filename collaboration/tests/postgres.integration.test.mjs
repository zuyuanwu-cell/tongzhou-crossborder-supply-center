import test from "node:test";
import assert from "node:assert/strict";

const portalDatabaseUrl = process.env.COLLABORATION_TEST_DATABASE_URL || "";
const integrationDatabaseUrl = process.env.COLLABORATION_TEST_INTEGRATION_DATABASE_URL || "";

test("PostgreSQL migration and RLS isolate two organizations", { skip: !portalDatabaseUrl || !integrationDatabaseUrl }, async () => {
  assert.notEqual(new URL(portalDatabaseUrl).username, new URL(integrationDatabaseUrl).username, "RLS test requires separate portal and integration roles");
  process.env.SKIP_ENV_FILE = "true";
  process.env.COLLABORATION_DATABASE_URL = portalDatabaseUrl;
  process.env.COLLABORATION_INTEGRATION_DATABASE_URL = integrationDatabaseUrl;
  process.env.COLLABORATION_SECRET_KEY = "test-secret-key-at-least-thirty-two-characters";
  process.env.COLLABORATION_INTERNAL_TOKEN = "test-internal-token-at-least-thirty-two-characters";
  const [{ migrate }, { integrationPool, portalPool, closePools }] = await Promise.all([import("../api/migrate.js"), import("../api/db.js")]);
  await migrate();
  const orgs = await integrationPool.query("INSERT INTO organizations(code,name,organization_type) VALUES ('rls-a','A仓','warehouse'),('rls-b','B仓','warehouse') ON CONFLICT(code) DO UPDATE SET name=excluded.name RETURNING id,code");
  const a = orgs.rows.find((row) => row.code === "rls-a").id;
  const b = orgs.rows.find((row) => row.code === "rls-b").id;
  await integrationPool.query("DELETE FROM warehouse_inventory_projections WHERE organization_id IN ($1,$2)", [a, b]);
  await integrationPool.query("INSERT INTO warehouse_inventory_projections(organization_id,warehouse_ref,warehouse_name,sku,product_name,available_quantity,last_core_synced_at) VALUES ($1,'a','A仓','A-SKU','A产品',1,now()),($2,'b','B仓','B-SKU','B产品',1,now())", [a, b]);
  const client = await portalPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_organization_id',$1,true)", [a]);
    const rows = await client.query("SELECT sku FROM warehouse_inventory_projections ORDER BY sku");
    assert.deepEqual(rows.rows.map((row) => row.sku), ["A-SKU"]);
    await client.query("ROLLBACK");
  } finally {
    client.release();
    await closePools();
  }
});
