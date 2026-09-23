// CI + gate hygiene pins (plain Node asserts, no framework, no network).
//
// Why this file exists: a push to main is a live deploy, and the workflow in
// .github/workflows/build.yml only runs when a changed path matches its
// `paths:` filter and only runs the suites it lists as steps. On this branch a
// suite's inputs (the seed, the fixtures, the seed adapter) and the PWA shell
// files were missing from the filter, so a push touching only one of them
// skipped the very test that guards it. This file keeps the three lists
// (package.json chain, workflow steps, workflow paths filter) aligned, pins the
// offline switch on the exports step, pins the overridable wall-clock gates
// (test/rules.test.js, test/generator-regression.js, test/holidays.test.js),
// and pins the docs statements that the 2026-09-23 whole-branch review found
// stale.
//
// Section 5 (docs) is deliberately part of the deploy gate but pinned only on
// what must STAY true (a stale "nothing deployed" / "not yet applied" claim
// may never come back; the secret is never pasted into a cron command) - not
// on dates or version numbers, so a later legitimate rewording (a redeploy
// line, a new version) cannot block index.html from being rebuilt.
//
// Run: node test/ci.test.js   (exit 1 after a failing section; every failure in
// that section is printed first so one run names the whole fix).
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

let N = 0;
const failures = [];
function ok(cond, msg) { N++; if (!cond) failures.push(msg); }
function flush(section) {
  if (failures.length) {
    failures.forEach(f => console.error("FAIL [" + section + "]: " + f));
    process.exit(1);
    failures.length = 0; // only reached when process.exit is stubbed for a full listing
  }
}

// ---- 1. the three lists ---------------------------------------------------
const pkg = JSON.parse(read("package.json"));
const chain = String(pkg.scripts.test).split("&&").map(s => s.trim()).map(s => {
  const m = s.match(/^node\s+(\S+)$/);
  if (!m) { failures.push("package.json test chain entry is not `node <file>`: " + s); return null; }
  return m[1].replace(/\\/g, "/");
}).filter(Boolean);
flush("package.json test chain");
ok(chain.length >= 11, "test chain lists " + chain.length + " suites; expected at least the eleven of 2026-09-23");

const yml = read(".github/workflows/build.yml");

// paths filter: the `- "..."` entries under `paths:`. Walk the lines after it
// and stop at the first non-blank line indented no deeper than `paths:` itself
// (a regex anchored on "same indent" skipped past the top-level keys and read
// 49 lines into the job definition - review 2026-09-23).
function pathsBlockOf(y) {
  const L = y.split("\n");
  const i = L.findIndex(l => /^\s*paths:\s*$/.test(l));
  if (i < 0) return "";
  const ind = L[i].match(/^\s*/)[0].length;
  const out = [];
  for (let k = i + 1; k < L.length; k++) {
    const l = L[k];
    if (!l.trim()) continue;
    if (l.match(/^\s*/)[0].length <= ind) break;
    out.push(l);
  }
  return out.join("\n");
}
const pathsBlock = pathsBlockOf(yml);
const filter = pathsBlock.split("\n").map(l => (l.match(/^\s*-\s*"([^"]+)"\s*(#.*)?$/) || [])[1]).filter(Boolean);
ok(filter.length > 0, "could not parse the `paths:` filter out of build.yml");
// self-check on the parse: the block holds the JSX source and nothing from
// the job definition or the other trigger keys.
ok(filter.includes("index-source.html"), "paths filter parse lost `index-source.html` - the block boundary is wrong");
ok(!/runs-on|^\s*jobs:|workflow_dispatch|^\s*steps:/m.test(pathsBlock), "paths filter parse ran past the `paths:` list into the rest of the workflow");

// steps: every `run: node <file>` line.
const stepRuns = Array.from(yml.matchAll(/^\s*run:\s*node\s+(\S+)\s*$/gm)).map(m => m[1]);
const testSteps = stepRuns.filter(p => /^test\//.test(p));
ok(testSteps.length > 0, "could not find any `run: node test/...` step in build.yml");
flush("build.yml parse");

// a. every suite in the chain is a workflow step
chain.forEach(p => ok(stepRuns.includes(p), "suite `" + p + "` is in package.json's test chain but has no `run: node " + p + "` step in build.yml"));
// b. every suite in the chain is in the paths filter (a push touching only
//    the test file must re-run it - a test that never runs cannot fail).
chain.forEach(p => ok(filter.includes(p), "suite `" + p + "` is in the test chain but missing from build.yml's paths filter"));
// c. every test step is in the chain (nothing runs in CI that `npm test`,
//    the CLAUDE.md pre-push gate, would not run locally).
testSteps.forEach(p => ok(chain.includes(p), "build.yml runs `" + p + "` but package.json's test chain does not"));
// d. steps run in the chain's order (the fast unit suites gate the slow
//    regression; a re-ordering is a deliberate change, made in both places).
const stepOrder = testSteps.filter(p => chain.includes(p));
ok(JSON.stringify(stepOrder) === JSON.stringify(chain.filter(p => testSteps.includes(p))),
  "build.yml test steps run in a different order than package.json's chain: " + JSON.stringify(stepOrder));
flush("chain vs steps vs filter");

// ---- 2. inputs the suites consume that the filter must also watch ---------
// Every seed-based suite reads docs/silvis-seed.json through test/seed-adapter.js;
// the regression, rules and publish tests read test/fixtures/*.json. A push
// that changes only one of these must re-run the suites that consume it.
["docs/silvis-seed.json", "test/fixtures/**", "test/seed-adapter.js"].forEach(p =>
  ok(filter.includes(p), "shared test input `" + p + "` missing from build.yml's paths filter"));
// A module the suites load that is not in the index-source loader list.
["importer.js"].forEach(p => ok(filter.includes(p), "module `" + p + "` (required by the importer/publish suites) missing from the paths filter"));
// PWA shell: index-source.html links these four; a manifest/icon-only push
// must bump APP_VERSION so cache-busted clients refetch them.
const SHELL = ["manifest.json", "icon-512.png", "icon-192.png", "apple-touch-icon.png"];
SHELL.forEach(p => ok(filter.includes(p), "PWA shell file `" + p + "` missing from build.yml's paths filter"));
const idx = read("index-source.html");
SHELL.forEach(p => ok(idx.includes(p), "index-source.html no longer references `" + p + "` - drop it from this pin and the filter together"));
flush("paths filter inputs");

// ---- 3. step environment pins --------------------------------------------
// The exports suite's live ER-panel section needs network to Supabase; CI runs
// it offline so a transient fetch failure can never turn a live deploy red.
const stepBlocks = yml.split(/\n(?=\s*-\s*name:)/);
const exportsStep = stepBlocks.find(b => /run:\s*node test\/exports\.test\.js/.test(b)) || "";
ok(exportsStep.length > 0, "no build.yml step runs test/exports.test.js");
ok(/EXPORTS_OFFLINE:\s*"1"/.test(exportsStep), "the exports step must set env EXPORTS_OFFLINE: \"1\" (CI has no business reading the live project; test/exports.test.js honours the switch and prints a note)");
ok(/process\.env\.EXPORTS_OFFLINE === "1"/.test(read("test/exports.test.js")), "test/exports.test.js no longer honours EXPORTS_OFFLINE=1");
// The regression keeps its default budget in CI (runners read ~3.6 s; the
// budget is a failing assertion by design - raise it locally, never in CI).
// (an env ASSIGNMENT `NAME:` is what is refused; a comment may name the variable)
ok(!/SILVIS_GEN_BUDGET_MS\s*:/.test(yml), "build.yml must not set SILVIS_GEN_BUDGET_MS - the regression's default budget is the CI gate");
ok(!/SILVIS_RULES_BUDGET_MS\s*:/.test(yml), "build.yml must not set SILVIS_RULES_BUDGET_MS - the rules suite's default budget is the CI gate");
flush("step env pins");

// ---- 4. rules.test.js wall-clock gate: overridable, never a warning --------
const rulesSrc = read("test/rules.test.js");
ok(/process\.env\.SILVIS_RULES_BUDGET_MS/.test(rulesSrc), "test/rules.test.js has no SILVIS_RULES_BUDGET_MS override for its wall-clock gate");
ok(/SILVIS_RULES_BUDGET_MS[\s\S]{0,80}:\s*5000\b/.test(rulesSrc), "test/rules.test.js wall-clock default must be 5000 ms");
ok(!/limit 2000/.test(rulesSrc), "test/rules.test.js still carries the fixed 2000 ms wall-clock gate");
// Behaviour: a 1 ms budget must FAIL the suite (exit 1 + FAIL line), proving
// the gate is an assertion and not a printed warning.
const tiny = cp.spawnSync(process.execPath, [path.join(ROOT, "test", "rules.test.js")], { env: Object.assign({}, process.env, { SILVIS_RULES_BUDGET_MS: "1" }), encoding: "utf8" });
ok(tiny.status === 1, "rules.test.js with SILVIS_RULES_BUDGET_MS=1 exited " + tiny.status + "; expected 1 (the budget must be a failing assertion)");
ok(/FAIL: test file took \d+ ms \(budget 1 ms via SILVIS_RULES_BUDGET_MS\)/.test(tiny.stderr || ""), "rules.test.js did not print the budget FAIL line; stderr: " + String(tiny.stderr || "").trim().slice(0, 200));
// The other two gates ride SILVIS_GEN_BUDGET_MS: the generator regression
// (default 10000 ms, a failing `ok(total <= BUDGET_MS ...)`) and the holidays
// suite (default 4000 ms, a hard exit). Static pins only - the regression is
// far too slow to spawn twice, and its own header forbids a warning.
const genSrc = read("test/generator-regression.js");
ok(/process\.env\.SILVIS_GEN_BUDGET_MS/.test(genSrc), "test/generator-regression.js has no SILVIS_GEN_BUDGET_MS override for its wall-clock budget");
ok(/SILVIS_GEN_BUDGET_MS[\s\S]{0,80}:\s*10000\b/.test(genSrc), "test/generator-regression.js wall-clock default must be 10000 ms (the CI gate)");
ok(/ok\(total <= BUDGET_MS/.test(genSrc), "test/generator-regression.js budget must stay a failing assertion (`ok(total <= BUDGET_MS ...)`), never a warning");
const holSrc = read("test/holidays.test.js");
ok(/process\.env\.SILVIS_GEN_BUDGET_MS/.test(holSrc), "test/holidays.test.js no longer shares SILVIS_GEN_BUDGET_MS for its wall-clock limit");
ok(/SILVIS_GEN_BUDGET_MS[\s\S]{0,80}:\s*4000\b/.test(holSrc), "test/holidays.test.js wall-clock default must be 4000 ms");
ok(/if \(total > LIMIT_MS\) \{[^\n]*process\.exit\(1\)/.test(holSrc), "test/holidays.test.js wall-clock limit must stay a hard exit(1)");
flush("rules wall-clock gate");

// ---- 5. docs statements the 2026-09-23 review found stale ------------------
const readme = read("README.md");
ok(/npm test && node build\.js/.test(readme), "README.md build recipe must read `npm test && node build.js` (CLAUDE.md's pre-push gate)");
ok(/npm run smoke/.test(readme), "README.md build recipe must mention `npm run smoke` for index-source.html changes");
ok(!/node test\/rules\.test\.js && node test\/east-feed\.test\.js && node test\/generator-regression\.js/.test(readme), "README.md still lists the three-suite recipe instead of the npm chain");
const efReadme = read("edge-functions/README.md");
ok(!/has been deployed yet/.test(efReadme), "edge-functions/README.md still says nothing has been deployed");
ok(/deploy record/i.test(efReadme), "edge-functions/README.md lacks a deploy record (the dated 'Deploy record' paragraph; its dates and versions are free to change)");
const section4 = (efReadme.split("## 4.")[1] || "").split("## 5.")[0];
ok((section4.match(/vault\.decrypted_secrets/g) || []).length >= 2 && /silvis_cron_secret/.test(section4), "edge-functions/README.md section 4 must show both cron statements reading the secret from Vault (silvis_cron_secret) at run time");
ok(!/'<CRON_SECRET>'\)/.test(efReadme), "edge-functions/README.md still pastes '<CRON_SECRET>' into a cron command");
const onHeader = read("edge-functions/office-notifications/index.ts").split("\n").slice(0, 80).join("\n");
ok(!/NOT in sql\/schema\.sql/.test(onHeader), "office-notifications/index.ts header still says the baseline table is not in sql/schema.sql");
ok(/office_notification_state/.test(read("sql/schema.sql")), "sql/schema.sql no longer defines office_notification_state");
const schemaReview = read("docs/SCHEMA-REVIEW.md");
const efLine = schemaReview.split("\n").find(l => /^\|\s*`east_forecast`/.test(l)) || "";
ok(efLine.length > 0, "docs/SCHEMA-REVIEW.md has no east_forecast table row");
ok(!/not yet applied/.test(efLine), "docs/SCHEMA-REVIEW.md still says east_forecast is not yet applied to the live DB");
flush("docs statements");

console.log("ok " + N + " assertions (" + chain.length + " suites in the chain, " + filter.length + " paths in the filter, " + testSteps.length + " test steps)");
