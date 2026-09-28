import test from "node:test";
import assert from "node:assert/strict";

const portalDatabaseUrl = process.env.COLLABORATION_TEST_DATABASE_URL || "";
const integrationDatabaseUrl = process.env.COLLABORATION_TEST_INTEGRATION_DATABASE_URL || "";

test("PostgreSQL migration, direct accounts, and RLS isolation work together", { skip: !portalDatabaseUrl || !integrationDatabaseUrl }, async (t) => {
  assert.notEqual(new URL(portalDatabaseUrl).username, new URL(integrationDatabaseUrl).username, "RLS test requires separate portal and integration roles");
  process.env.SKIP_ENV_FILE = "true";
  process.env.COLLABORATION_DATABASE_URL = portalDatabaseUrl;
  process.env.COLLABORATION_INTEGRATION_DATABASE_URL = integrationDatabaseUrl;
  process.env.COLLABORATION_SECRET_KEY = "test-secret-key-at-least-thirty-two-characters";
  process.env.COLLABORATION_INTERNAL_TOKEN = "test-internal-token-at-least-thirty-two-characters";
  const [{ migrate }, { integrationPool, portalPool, closePools }, identity, authApi] = await Promise.all([import("../api/migrate.js"), import("../api/db.js"), import("../api/identity.js"), import("../api/auth.js")]);
  t.after(closePools);
  await migrate();
  const unique = Date.now().toString(36);
  const initialPassword = `Initial${unique}9`;
  const nextPassword = `Changed${unique}8`;
  const bootstrap = await identity.bootstrapOrganization({
    name: `测试协同仓 ${unique}`,
    organizationType: "warehouse",
    notificationEmail: "",
    administrator: { username: `admin-${unique}`, displayName: "测试管理员", email: "", password: initialPassword },
    actorName: "集成测试",
  });
  assert.match(bootstrap.organization.code, /^wh-[a-z0-9_-]{6,10}$/);
  assert.equal(bootstrap.administrator.email, "");
  assert.equal(bootstrap.administrator.mustChangePassword, true);
  const stored = await integrationPool.query("SELECT password_hash,must_change_password,email FROM collaboration_users WHERE id=$1", [bootstrap.administrator.userId]);
  assert.match(stored.rows[0].password_hash, /^\$argon2id\$/);
  assert.notEqual(stored.rows[0].password_hash, initialPassword);
  assert.equal(stored.rows[0].email, null);
  const request = { headers: { "x-forwarded-for": "127.0.0.1", "user-agent": "collaboration-integration-test" }, socket: { remoteAddress: "127.0.0.1" } };
  const signedIn = await authApi.login(request, { organizationCode: bootstrap.organization.code, username: `admin-${unique}`, password: initialPassword });
  assert.equal(signedIn.auth.mustChangePassword, true);
  await identity.updateOwnProfile(signedIn.auth, { displayName: "更新后的管理员", email: `admin-${unique}@example.test`, currentPassword: initialPassword });
  await identity.changeOwnPassword(signedIn.auth, { currentPassword: initialPassword, newPassword: nextPassword });
  const signedInAgain = await authApi.login(request, { organizationCode: bootstrap.organization.code, username: `admin-${unique}`, password: nextPassword });
  assert.equal(signedInAgain.auth.mustChangePassword, false);
  assert.equal(signedInAgain.auth.user.email, `admin-${unique}@example.test`);
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
  }
});
