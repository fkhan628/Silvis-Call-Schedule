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
// (test/rules.test.js, test/generator-regression.js, test/water-fill.test.js, test/holidays.test.js),
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
const os = require("os");
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
// The water-fill suite (9/23 fix stage: the November 2026 fixture case moved out of
// the regression so that one stays under 10 s) rides the same variable: default
// 6000 ms, a failing `ok(total <= BUDGET_MS ...)`.
const wfSrc = read("test/water-fill.test.js");
ok(/process\.env\.SILVIS_GEN_BUDGET_MS/.test(wfSrc), "test/water-fill.test.js has no SILVIS_GEN_BUDGET_MS override for its wall-clock budget");
ok(/SILVIS_GEN_BUDGET_MS[\s\S]{0,80}:\s*6000\b/.test(wfSrc), "test/water-fill.test.js wall-clock default must be 6000 ms (the CI gate)");
ok(/ok\(total <= BUDGET_MS/.test(wfSrc), "test/water-fill.test.js budget must stay a failing assertion (`ok(total <= BUDGET_MS ...)`), never a warning");
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

// ---- 6. scripts/: --help is help, an unknown flag is refused, docs/ untouched ----
// (audit T1, 9/23: `preview-generate.js --help` used to run a live-data generate
// and overwrite the committed docs/PREVIEW-*.{md,json} publish record in place.)
const scriptsDir = path.join(ROOT, "scripts");
const scriptFiles = fs.readdirSync(scriptsDir).filter(f => /\.js$/.test(f)).sort();
ok(scriptFiles.length >= 7, "expected the seven Node scripts under scripts/, found " + scriptFiles.length + ": " + scriptFiles.join(", "));
const docsDir = path.join(ROOT, "docs");
// recursive (review 9/23): a file written inside a docs/ subfolder must trip the guard too
const walkFiles = (dir, rel) => fs.readdirSync(dir).sort().flatMap(f => { const p = path.join(dir, f), st = fs.statSync(p); return st.isDirectory() ? walkFiles(p, rel + f + "/") : [[rel + f, st.size + ":" + st.mtimeMs]]; });
const docsSnapshot = () => JSON.stringify(walkFiles(docsDir, ""));
// B10 (9/23): docs/screenshots/ was dropped (the review shots carried the local harness URL), so docs/ has no subfolder
// today; the walker still recurses - proven on a temp tree rather than on a folder that must exist.
{
  const tmpWalk = fs.mkdtempSync(path.join(os.tmpdir(), "silvis-ci-walk-"));
  fs.mkdirSync(path.join(tmpWalk, "sub")); fs.writeFileSync(path.join(tmpWalk, "sub", "f.txt"), "x", "utf8"); fs.writeFileSync(path.join(tmpWalk, "top.txt"), "y", "utf8");
  ok(walkFiles(tmpWalk, "").map(([r]) => r).join(",") === "sub/f.txt,top.txt", "the docs/ snapshot walker recurses into subfolders (nested paths appear as 'sub/f.txt')");
  fs.rmSync(tmpWalk, { recursive: true, force: true });
}
const docsBefore = docsSnapshot();
const spawnScript = (f, arg) => cp.spawnSync(process.execPath, [path.join(scriptsDir, f), arg], { cwd: ROOT, encoding: "utf8", timeout: 60000, env: Object.assign({}, process.env, { SILVIS_SUPABASE_WORKDIR: "" }) });
scriptFiles.forEach(f => {
  ["--help", "-h"].forEach(flag => {
    const r = spawnScript(f, flag);
    ok(r.status === 0, "scripts/" + f + " " + flag + " exited " + r.status + " (expected 0; stderr: " + String(r.stderr || "").trim().slice(0, 200) + ")");
    ok(/usage/i.test(r.stdout || ""), "scripts/" + f + " " + flag + " printed no usage text");
  });
  const u = spawnScript(f, "--no-such-flag-ci-test");
  ok(u.status !== null && u.status !== 0, "scripts/" + f + " --no-such-flag-ci-test exited " + u.status + " (expected a non-zero refusal, never a run)");
  ok(/unknown argument/i.test((u.stderr || "") + (u.stdout || "")), "scripts/" + f + " did not name the unknown argument: " + String(u.stderr || "").trim().slice(0, 200));
});
ok(docsSnapshot() === docsBefore, "a --help / unknown-flag run of a script created or modified a file under docs/");
// rebase follow-up 9/23 (review, minor): the one SHELL script under scripts/ honours the same contract without being
// run here (it probes the live project): its --help / unknown-argument arm sits BEFORE `set -u`, the config.js read
// and the first curl, so `bash scripts/verify-rls.sh --help` prints usage and exits 0 with no request made.
const shFiles = fs.readdirSync(scriptsDir).filter(f => /\.sh$/.test(f)).sort();
ok(JSON.stringify(shFiles) === JSON.stringify(["verify-rls.sh"]), "expected scripts/verify-rls.sh to be the only shell script under scripts/ (a new one needs the same --help arm and a pin here), found: " + shFiles.join(", "));
const vrCode = read("scripts/verify-rls.sh").split("\n").filter(l => !/^\s*#/.test(l)).join("\n");
const vrHelp = vrCode.search(/-h\|--help\)\s*echo "usage: bash scripts\/verify-rls\.sh/);
const vrFirstRun = Math.min(...["set -u", "curl ", "grep -oE"].map(s => vrCode.indexOf(s)).filter(i => i >= 0));
ok(vrHelp >= 0, "scripts/verify-rls.sh has no `-h|--help) echo \"usage: bash scripts/verify-rls.sh ...\"` arm");
ok(vrHelp >= 0 && vrHelp < vrFirstRun, "the --help arm of scripts/verify-rls.sh must come before set -u / the config.js read / the first curl (arm at " + vrHelp + ", first run at " + vrFirstRun + ")");
ok(/\*\)\s*echo "unknown argument: \$1[^\n]*" >&2; exit 2;;/.test(vrCode), "scripts/verify-rls.sh must refuse an unknown argument with 'unknown argument: <arg>' on stderr and exit 2");
// the default --out of preview-generate.js is outside docs/ (a casual re-run can never clobber the committed record)
const pgSrc = read("scripts/preview-generate.js");
ok(/os\.tmpdir\(\)/.test(pgSrc) && !/path\.join\(REPO, "docs", `PREVIEW-/.test(pgSrc), "scripts/preview-generate.js must default --out to os.tmpdir(), never docs/PREVIEW-<range>.md");
flush("scripts --help contract");

// ---- 7. the deploy job: Node floor and the commit-back step (audit T2 / T3, 9/23) ----
const nodeVer = (yml.match(/node-version:\s*"(\d+)"/) || [])[1];
ok(nodeVer && Number(nodeVer) >= 22, "build.yml node-version must be 22 or newer (the Babel 8 engines floor is ^22.18.0 || >=24.11.0); found " + nodeVer);
ok(/"engines"\s*:\s*\{\s*"node"\s*:\s*">=22\.18"/.test(read("package.json")), "package.json must declare engines.node >=22.18 (the same floor for a developer machine)");
const commitStep = stepBlocks.find(b => /name:\s*Commit built files/.test(b)) || "";
ok(commitStep.length > 0, "no 'Commit built files' step in build.yml");
ok(/git fetch(?: --quiet)? origin main/.test(commitStep) && commitStep.indexOf("git fetch") < commitStep.indexOf("git push"), "the commit step must fetch origin/main before it pushes");
ok(/scripts\/ci-watched-paths\.js/.test(commitStep) && /git reset --hard(?: --quiet)? origin\/main/.test(commitStep), "the commit step must ask scripts/ci-watched-paths.js whether main's move is watched and rebuild on top of origin/main when it is not");
ok(!/git pull --rebase/.test(yml.split("\n").filter(l => !/^\s*#/.test(l)).join("\n")), "build.yml must never `git pull --rebase` a compiled index.html over a changed source (a comment may say why not)");
ok(/::error::/.test(commitStep) && /workflow_dispatch/.test(commitStep), "a rejected push must fail with an ::error:: naming the workflow_dispatch recovery");
// review 9/23 (major): the matcher's exit code is captured and switched on - 0 rebuild, 1 step aside, anything
// else (usage / parse error, node missing) FAILS the step. `set -e` ignores a command inside an `if`, and an
// `if ... || node scripts/ci-watched-paths.js` would read a matcher crash as "watched": a green run, nothing pushed.
ok(!/if \[[^\n]*\|\|\s*node scripts\/ci-watched-paths\.js/.test(commitStep), "the commit step must not call scripts/ci-watched-paths.js inside an `if ... ||` condition (every non-zero exit would read as 'watched')");
ok(/node scripts\/ci-watched-paths\.js [^\n]*\|\|\s*rc=\$\?/.test(commitStep) && /case\s+"?\$rc"?\s+in/.test(commitStep), "the commit step must capture the matcher's exit code (`|| rc=$?`) and `case \"$rc\" in` on it");
const rcCases = (commitStep.match(/^\s*(0|1|\*)\)\s*$/gm) || []).map(s => s.trim());
ok(JSON.stringify(rcCases) === JSON.stringify(["0)", "1)", "*)"]), "the case needs exactly the three arms 0) rebuild / 1) step aside / *) fail, found " + JSON.stringify(rcCases));
const starArm = commitStep.split(/^\s*\*\)\s*$/m)[1] || "";
ok(/::error::[^\n]*ci-watched-paths\.js[^\n]*exit \$rc/.test(starArm) && /^\s*exit 1\s*$/m.test(starArm.split("esac")[0]), "the *) arm must print ::error:: naming ci-watched-paths.js and the exit code, then exit 1 (never the ::notice:: + exit 0 of the step-aside arm)");
// the matcher reads the SAME paths filter this file parses
const WP = require(path.join(ROOT, "scripts", "ci-watched-paths.js"));
ok(JSON.stringify(WP.watchedGlobs(yml)) === JSON.stringify(filter), "scripts/ci-watched-paths.js reads the same paths filter as this test");
ok(WP.watchedOf(["docs/PUBLISH-x.md", "sql/schema.sql", "scripts/day-edit.js", "edge-functions/x/index.ts", "README.md"], filter).length === 0, "docs / sql / scripts / edge-function paths are unwatched (a follow-up push there queues no run)");
const watchedSample = ["index-source.html", "rules.js", "test/fixtures/x/y.json", "docs/silvis-seed.json", "package.json"];
ok(JSON.stringify(WP.watchedOf(watchedSample, filter)) === JSON.stringify(watchedSample), "watched paths match and ** crosses directories: " + JSON.stringify(WP.watchedOf(watchedSample, filter)));
ok(WP.watchedOf(["test/fixturesX.json", "rules.jsx", "xindex-source.html"], filter).length === 0, "globs are anchored and '.' is literal");
flush("deploy job pins");

// ---- 8. supply chain (Prompt 16 B8): vendored libraries, the CSP, the lockfile, pinned actions ----
// React, ReactDOM and supabase-js are served from vendor/ - the exact bytes the npm registry publishes for the
// versions below, so a CDN outage, a CDN compromise or an unpinned "latest" can no longer change what the app
// runs. The hashes here are the deploy gate; vendor/README.md is the record. Bumping a library = replace the
// file, re-hash it, update this table and the README row together (the loader names stay).
const crypto = require("crypto");
const os = require("os");
const sha256hex = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const sha256src = (text) => "'sha256-" + crypto.createHash("sha256").update(text, "utf8").digest("base64") + "'";
const VENDORED = [
  { file: "vendor/react.production.min.js", version: "18.3.1", sha256: "d949f1c3687aedadcedac85261865f29b17cd273997e7f6b2bfc53b2f9d4c4dd" },
  { file: "vendor/react-dom.production.min.js", version: "18.3.1", sha256: "35f4f974f4b2bcd44da73963347f8952e341f83909e4498227d4e26b98f66f0d" },
  { file: "vendor/supabase.js", version: "2.117.1", sha256: "dff1e545f4f35bd42895cd6f46431e56137dd13031e46a9759c446447c11a567" },
];
const vendorReadme = fs.existsSync(path.join(ROOT, "vendor", "README.md")) ? read("vendor/README.md") : "";
ok(vendorReadme.length > 0, "vendor/README.md is missing (the record of every vendored file's source URL, version and sha256)");
VENDORED.forEach(v => {
  const p = path.join(ROOT, v.file);
  ok(fs.existsSync(p), v.file + " is missing");
  if (fs.existsSync(p)) {
    const bytes = fs.readFileSync(p);
    ok(sha256hex(bytes) === v.sha256, v.file + " sha256 is " + sha256hex(bytes) + ", expected " + v.sha256 + " (version " + v.version + ")");
    ok(bytes.indexOf("\r") === -1, v.file + " carries CR bytes (an eol conversion changed the vendored bytes; vendor/** is -text in .gitattributes)");
  }
  const row = vendorReadme.split("\n").find(l => l.includes(v.file.replace(/^vendor\//, "")) && l.includes(v.sha256));
  ok(!!row && row.includes(v.version) && /https:\/\/registry\.npmjs\.org\//.test(row), "vendor/README.md has no row naming " + v.file + " with version " + v.version + ", its registry.npmjs.org source URL and sha256 " + v.sha256);
});
ok(/^vendor\/\*\*\s+-text\s*$/m.test(read(".gitattributes")), ".gitattributes must mark `vendor/** -text` (vendored bytes are never eol-converted, so the sha256 pins hold on every OS)");
ok(!fs.existsSync(path.join(ROOT, "vendor", "babel.min.js")) && !/babel(\.min)?\.js|@babel\/standalone/.test(idx), "Babel standalone must not be vendored or loaded at runtime (build.js transpiles; the served index.html carries no Babel)");
ok(filter.includes("vendor/**"), "build.yml's paths filter must watch vendor/** (a library bump must run the suites and bump APP_VERSION so cache-busted clients refetch)");
flush("vendored libraries");

// The CSP meta in index-source.html carries a token that build.js replaces with the sha256 of every inline script
// it emits (the APP_VERSION script, the loader, the transpiled app): a hash list, never 'unsafe-inline' for scripts.
const CSP_TOKEN = "__CSP_SCRIPT_HASHES__";
const cspOf = (html) => (html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/) || [])[1] || "";
const directivesOf = (csp) => Object.fromEntries(csp.split(";").map(s => s.trim()).filter(Boolean).map(s => { const [k, ...v] = s.split(/\s+/); return [k, v]; }));
const srcCsp = cspOf(idx);
ok(srcCsp.length > 0, "index-source.html has no <meta http-equiv=\"Content-Security-Policy\" content=\"...\"> in <head>");
ok(srcCsp.length > 0 && idx.indexOf('<meta http-equiv="Content-Security-Policy"') < idx.indexOf("<script"), "the CSP meta must come before the first <script> (a meta policy governs only what follows it)");
ok(idx.split(CSP_TOKEN).length === 2, "index-source.html must carry the " + CSP_TOKEN + " token exactly once (inside the CSP meta's script-src)");
const srcDirectives = directivesOf(srcCsp);
const expectDirective = (name, values) => { const have = srcDirectives[name] || null; ok(!!have, "CSP lacks " + name); if (have) values.forEach(v => ok(have.includes(v), "CSP " + name + " lacks " + v + " (have: " + have.join(" ") + ")")); };
expectDirective("default-src", ["'self'"]);
expectDirective("script-src", ["'self'", CSP_TOKEN]);
expectDirective("style-src", ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"]);
expectDirective("img-src", ["'self'", "data:", "blob:"]);
expectDirective("connect-src", ["'self'", "https://bzhsroegtagqhutbnsrp.supabase.co", "wss://bzhsroegtagqhutbnsrp.supabase.co", "https://xqongyahdnkozqunpwmu.supabase.co"]);
expectDirective("font-src", ["'self'", "data:", "https://fonts.gstatic.com"]);
expectDirective("object-src", ["'none'"]);
expectDirective("base-uri", ["'self'"]);
expectDirective("form-action", ["'self'"]);
ok(!("frame-ancestors" in srcDirectives), "frame-ancestors is ignored in a <meta> policy (every browser logs a warning); it must not be in the meta");
["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", "http:", "https:", "*", "data:", "blob:"].forEach(v => ok(!(srcDirectives["script-src"] || []).includes(v), "script-src must not allow " + v));
(srcDirectives["connect-src"] || []).forEach(v => ok(/^('self'|https:\/\/[a-z]+\.supabase\.co|wss:\/\/[a-z]+\.supabase\.co)$/.test(v), "connect-src entry outside the two Supabase projects: " + v));
// no CDN script left in the source; the loader serves the vendored trio first, config.js right after
const idxNoComments = idx.replace(/<!--[\s\S]*?-->/g, "");
ok(!/<script[^>]+src="https?:\/\//.test(idx), "index-source.html still loads a script from a remote origin");
ok(!/unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com/.test(idxNoComments), "index-source.html still names a CDN host (unpkg / jsdelivr / cdnjs)");
ok(!/<script type="module">/.test(idx), "index-source.html still carries the <script type=\"module\"> SDK import");
ok(idx.includes("['vendor/react.production.min.js','vendor/react-dom.production.min.js','vendor/supabase.js','config.js','helpers.js','rules.js','east-feed.js','generator.js','importer.js','app-styles.js']"), "the ?v=APP_VERSION loader list must start with the vendored trio (React, ReactDOM, supabase-js, in that order) followed by config.js");
// config.js: the UMD declares a non-configurable `var supabase` global; config.js captures it into window._supabaseSDK
// before its own `var supabase` REST wrapper takes the name (a `const` would be a SyntaxError against the UMD's var).
const cfg = read("config.js");
ok(/^var supabase = \{$/m.test(cfg) && !/^const supabase = \{$/m.test(cfg), "config.js must declare the REST wrapper as `var supabase = {` (the vendored UMD's `var supabase` global makes a `const` a SyntaxError)");
const capAt = cfg.indexOf("window._supabaseSDK = { createClient: sdk.createClient };");
ok(capAt > 0 && capAt < cfg.indexOf("var supabase = {"), "config.js must capture window.supabase.createClient into window._supabaseSDK BEFORE `var supabase = {` takes the global name");
// the printable popup (helpers.js buildPrintableCalendarHTML) inherits this policy: its ONE inline script is pinned by a static hash
const H = require(path.join(ROOT, "helpers.js"));
const printable = H.buildPrintableCalendarHTML({ startYear: 2026, startMonth: 9, numMonths: 1, schedule: {}, roster: [], holidays: [], vacations: [] });
const printScripts = Array.from(printable.matchAll(/<script>([\s\S]*?)<\/script>/g)).map(m => m[1]);
ok(printScripts.length === 1, "the printable page must carry exactly one inline <script> (the toolbar), found " + printScripts.length);
ok(!/\son(click|load)=/.test(printable), "the printable page must not use inline event handlers (they would need 'unsafe-hashes'; the toolbar script is hashed instead)");
const printHash = printScripts.length === 1 ? sha256src(printScripts[0]) : null;
ok(!!printHash && (srcDirectives["script-src"] || []).includes(printHash), "script-src must carry the printable toolbar script's hash " + printHash + " (helpers.js buildPrintableCalendarHTML changed? re-hash the script and update the meta)");
flush("CSP meta (source)");

// Build to a scratch file and check the emitted policy against the emitted inline scripts byte for byte.
{
  const tmpOut = path.join(os.tmpdir(), "silvis-ci-test-build-" + process.pid + ".html");
  const b = cp.spawnSync(process.execPath, [path.join(ROOT, "build.js"), "index-source.html", tmpOut], { cwd: ROOT, encoding: "utf8", timeout: 180000 });
  ok(b.status === 0, "build.js exited " + b.status + ": " + String(b.stderr || "").trim().slice(0, 300));
  if (b.status === 0) {
    const built = fs.readFileSync(tmpOut, "utf8");
    const builtCsp = cspOf(built);
    ok(builtCsp.length > 0 && !builtCsp.includes(CSP_TOKEN), "the built page still carries the " + CSP_TOKEN + " token");
    const inline = Array.from(built.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)).filter(m => !/\bsrc=/.test(m[1])).map(m => m[2]);
    ok(inline.length === 3, "the built page must carry exactly 3 inline scripts (APP_VERSION, loader, transpiled app), found " + inline.length);
    const want = inline.map(sha256src);
    const have = directivesOf(builtCsp)["script-src"] || [];
    want.forEach((h, i) => ok(have.includes(h), "built script-src lacks the hash of inline script #" + (i + 1) + " " + h + " (have: " + have.join(" ") + ")"));
    ok(have.filter(h => /^'sha256-/.test(h)).length === want.length + 1, "built script-src must carry exactly the 3 page hashes + the printable toolbar hash, found " + have.filter(h => /^'sha256-/.test(h)).length);
    ok(!/<script[^>]+src="https?:\/\//.test(built), "the built page still loads a remote script");
    ok(/__CSP_SCRIPT_HASHES__/.test(read("build.js")), "build.js does not fill the CSP token");
  }
  try { fs.unlinkSync(tmpOut); } catch (e) {}
}
flush("CSP meta (built)");

// The lockfile is tracked and CI installs from it; the two actions are pinned to a full commit SHA; permissions are explicit.
const gitignore = read(".gitignore").split("\n").filter(l => l.trim() && !/^\s*#/.test(l)).map(l => l.trim());
ok(!gitignore.includes("package-lock.json"), ".gitignore must not ignore package-lock.json (CI runs npm ci against the committed lockfile)");
ok(gitignore.includes("edge-functions/deployed-backup-*/"), ".gitignore must ignore edge-functions/deployed-backup-*/ (local pre-deploy backups of the live function sources)");
// visible to git = present and not ignored (an intent-to-add or a not-yet-committed lockfile in a review worktree
// passes; a lockfile that .gitignore swallows never does). `git ls-files` confirms the commit once it lands.
ok(fs.existsSync(path.join(ROOT, "package-lock.json")), "package-lock.json is missing (run `npm install` once against the pinned package.json and commit it)");
const lockIgnored = cp.spawnSync("git", ["check-ignore", "-q", "package-lock.json"], { cwd: ROOT, encoding: "utf8" });
ok(lockIgnored.status === 1, "package-lock.json is ignored by git (check-ignore exit " + lockIgnored.status + ") - it must be committed");
const vendorIgnored = cp.spawnSync("git", ["check-ignore", "-q", "vendor/supabase.js"], { cwd: ROOT, encoding: "utf8" });
ok(vendorIgnored.status === 1, "vendor/ is ignored by git (check-ignore exit " + vendorIgnored.status + ") - the vendored files must be committed");
if (fs.existsSync(path.join(ROOT, "package-lock.json"))) {
  const lock = JSON.parse(read("package-lock.json"));
  ok(lock.lockfileVersion >= 2 && lock.packages && lock.packages[""], "package-lock.json is not a v2+/v3 lockfile with a root entry");
  const rootDev = ((lock.packages || {})[""] || {}).devDependencies || {};
  Object.entries(pkg.devDependencies).forEach(([n, v]) => ok(rootDev[n] === v, "package-lock.json root devDependencies." + n + " is " + rootDev[n] + ", package.json pins " + v + " (lockfile out of step - npm ci would refuse)"));
  Object.entries(pkg.devDependencies).forEach(([n, v]) => ok(((lock.packages || {})["node_modules/" + n] || {}).version === v, "package-lock.json resolves " + n + " to " + ((lock.packages || {})["node_modules/" + n] || {}).version + ", package.json pins " + v));
  // Every non-root entry must carry a registry `resolved` URL and a sha512 `integrity`: without them `npm ci` pins
  // versions only and verifies no tarball bytes (a lockfile generated over an existing node_modules comes out that
  // way - regenerate from a clean tree: rm -rf node_modules package-lock.json && npm install).
  const lockEntries = Object.entries(lock.packages || {}).filter(([k]) => k !== "");
  const noResolved = lockEntries.filter(([, v]) => !/^https:\/\/registry\.npmjs\.org\//.test(v.resolved || "")).map(([k]) => k);
  const noIntegrity = lockEntries.filter(([, v]) => !/^sha512-[A-Za-z0-9+/=]+$/.test(v.integrity || "")).map(([k]) => k);
  ok(lockEntries.length > 0, "package-lock.json lists no packages");
  ok(noResolved.length === 0, "package-lock.json: " + noResolved.length + "/" + lockEntries.length + " entries lack a https://registry.npmjs.org/ `resolved` URL (npm ci would verify nothing), e.g. " + noResolved.slice(0, 3).join(", "));
  ok(noIntegrity.length === 0, "package-lock.json: " + noIntegrity.length + "/" + lockEntries.length + " entries lack a sha512 `integrity` hash (npm ci would verify nothing), e.g. " + noIntegrity.slice(0, 3).join(", "));
}
const installStep = stepBlocks.find(b => /name:\s*Install build deps/.test(b)) || "";
ok(/run:\s*npm ci\b/.test(installStep) && !/npm install/.test(installStep.split("\n").filter(l => !/^\s*#/.test(l)).join("\n")), "build.yml's install step must run `npm ci` (never npm install) against the committed lockfile");
const uses = Array.from(yml.matchAll(/^\s*uses:\s*(\S+)\s*(#.*)?$/gm)).map(m => ({ ref: m[1], comment: (m[2] || "").trim() }));
ok(uses.length === 2, "build.yml must use exactly two actions (checkout, setup-node), found " + uses.map(u => u.ref).join(", "));
const PINNED = { "actions/checkout": "11d5960a326750d5838078e36cf38b85af677262", "actions/setup-node": "49933ea5288caeca8642d1e84afbd3f7d6820020" };
uses.forEach(u => {
  const [name, sha] = u.ref.split("@");
  ok(PINNED[name] !== undefined, "unexpected action " + u.ref);
  ok(/^[0-9a-f]{40}$/.test(sha || ""), u.ref + " is not pinned to a full 40-hex commit SHA");
  ok(sha === PINNED[name], u.ref + " is pinned to a SHA this test does not know (tag v4 of " + name + " = v4.4.0 = " + PINNED[name] + " on 2026-09-23; a deliberate bump updates both)");
  ok(/^#\s*v4\b/.test(u.comment), u.ref + " needs a trailing `# v4` comment naming the tag it pins");
});
const topPerms = yml.match(/^permissions:[ \t]*(.*)$/m);
ok(!!topPerms && /^\{\s*\}$/.test((topPerms[1] || "").trim()), "build.yml must set workflow-level `permissions: {}` (nothing by default; the job grants what it needs)");
const buildJob = yml.slice(yml.indexOf("\njobs:"));
const jobPermBlock = (buildJob.match(/^ {4}permissions:[ \t]*\n((?: {6}\S.*\n)+)/m) || [])[1] || "";
ok(jobPermBlock.trim() === "contents: write", "the build job's permissions block must be exactly `contents: write` (the commit-back push), found: " + JSON.stringify(jobPermBlock.trim()));
const gateYml = read(".github/workflows/ci-owned-files-gate.yml");
ok(/^permissions:\s*\n {2}contents: read\s*\n {2}pull-requests: read\s*$/m.test(gateYml), "ci-owned-files-gate.yml must declare `permissions:\\n  contents: read\\n  pull-requests: read`");
ok(!/uses:/.test(gateYml), "ci-owned-files-gate.yml uses no actions (nothing to pin); if one is added, pin it by SHA and add it here");
flush("lockfile / actions / permissions");

console.log("ok " + N + " assertions (" + chain.length + " suites in the chain, " + filter.length + " paths in the filter, " + testSteps.length + " test steps)");
