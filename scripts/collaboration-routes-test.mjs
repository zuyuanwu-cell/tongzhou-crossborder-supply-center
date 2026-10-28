import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");
const [main, identityAdmin, workspace] = await Promise.all([
  read("src/main.tsx"),
  read("src/CollaborationIdentityAdmin.tsx"),
  read("src/PartnerCollaborationWorkspace.tsx"),
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

console.log("collaboration-routes-test: ok");
