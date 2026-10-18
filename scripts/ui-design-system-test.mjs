import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");
const [tokens, operational, main, partnerMain, partnerStyles, reconciliation] = await Promise.all([
  read("collaboration/shared/ui-tokens.css"),
  read("collaboration/shared/operational-ui.css"),
  read("src/main.tsx"),
  read("collaboration/portal/src/main.tsx"),
  read("collaboration/portal/src/styles.css"),
  read("src/overseas-inventory-reconciliation.css"),
]);

assert.match(tokens, /--op-text-xs:\s*12px/);
assert.match(tokens, /--op-text-sm:\s*14px/);
assert.match(tokens, /--op-motion-fast:\s*160ms/);
assert.match(tokens, /prefers-reduced-motion/);
assert.match(tokens, /:focus-visible/);
assert.ok(main.indexOf('import "../collaboration/shared/ui-tokens.css"') > main.indexOf('import "./theme-refresh.css"'), "shared tokens must load after the legacy main theme");
assert.ok(partnerMain.indexOf('import "../../shared/ui-tokens.css"') > partnerMain.indexOf('import "./styles.css"'), "partner overrides must load after legacy styles");
assert.match(operational, /min-height:\s*40px/);
assert.match(operational, /font-size:\s*max\(12px,\s*1em\)/);
assert.match(operational, /font-size:\s*max\(12px,\s*1em\)\s*!important/);
assert.match(operational, /min-height:\s*36px\s*!important/);
assert.match(operational, /\.app-shell :where\(button, input, select, textarea\) \{ min-height: 40px !important; \}/);
assert.match(partnerStyles, /\.login-page button, \.credential-page button, \.mfa-page button \{ min-height: 40px; \}/);
assert.match(reconciliation, /\.oir-page\s+:where[\s\S]*max\(12px,\s*1em\)/);
assert.match(main, /#products\?\$\{params\.toString\(\)\}/);
assert.match(main, /role="dialog" aria-modal="true"/);
assert.match(main, /HashChangeEvent\("hashchange"\)/);
assert.match(main, /批量采纳 \$\{pendingRecommendations\.length\} 项/);
assert.match(main, /<OverflowMenu label=\{`\$\{robot\.name\} 更多操作`\}>/);
assert.match(main, /className="sync-button header-sync-button"/);

const tinySharedSizes = [...`${tokens}\n${operational}`.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)]
  .map((match) => Number(match[1]))
  .filter((value) => value < 12);
assert.deepEqual(tinySharedSizes, [], "shared design-system CSS must not introduce text smaller than 12px");

console.log("ui-design-system-test: ok");
