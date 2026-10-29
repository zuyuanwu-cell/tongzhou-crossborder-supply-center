import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");
const [main, identityAdmin, workspace, identityAdminStyles, server, outsourcingSource, jiandaoyunClient] = await Promise.all([
  read("src/main.tsx"),
  read("src/CollaborationIdentityAdmin.tsx"),
  read("src/PartnerCollaborationWorkspace.tsx"),
  read("src/collaboration-identity-admin.css"),
  read("server/server.js"),
  read("server/collaboration-outsourcing-source.js"),
  read("server/jiandaoyun-client.js"),
]);

assert.match(main, /hash: "#outsourcing-collaboration"[\s\S]*hidden: true/);
assert.match(main, /authorizedNavItems\(currentUser, true\)/);
assert.match(main, /const allowedItems = authorizedNavItems\(currentUser, true\);/);
assert.doesNotMatch(main, /const allowedItems = visibleNavItems\(currentUser\);/);
assert.match(main, /if \(user\.permissionOverrides\?\.deny\?\.includes\(permission\)\) return false;/);
assert.match(main, /if \(user\.role === "admin"\) return true;/);
assert.match(main, /<PartnerCollaborationWorkspace taskType="production_order" \/>/);
assert.match(identityAdmin, /organization: detail\.organization\.code, section: "factory-mapping"/);
assert.match(workspace, /requestedOrganizationCode/);
assert.match(workspace, /requestedSection !== "factory-mapping"/);
assert.match(workspace, /getElementById\("outsourcing-factory-mapping"\)/);
assert.match(identityAdmin, /<option value="">请选择要映射的工厂<\/option>/);
assert.match(identityAdmin, /aria-label="选择千顷 ERP 委外工厂"/);
assert.doesNotMatch(identityAdmin, /result\.options\[0\]\?\.factoryId/);
assert.match(identityAdmin, /暂未读取到可映射工厂/);
assert.match(identityAdminStyles, /\.cia-outsourcing-select select\{[^}]*width:100%/);
assert.match(identityAdminStyles, /\.cia-outsourcing-source-body\{[^}]*grid-template-columns/);
assert.match(server, /listActiveOutsourcingOrders:\s*fetchAllJdyOutsourcingOrders/);
assert.match(server, /listOutsourcingFactoryOrders:\s*fetchJdyOutsourcingOrdersByFactoryId/);
assert.match(jiandaoyunClient, /export async function fetchJdyOutsourcingOrdersByFactoryId\(factoryId\)[\s\S]*fields\.factoryId[\s\S]*value: \[value\]/);
assert.doesNotMatch(outsourcingSource, /\.filter\(\(item\) => item\.activeOrderCount > 0\)/);

console.log("collaboration-routes-test: ok");
