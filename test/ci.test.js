// CI + gate hygiene pins (plain Node asserts, no framework, no network).
//
// Why this file exists: a push to main is a live deploy, and the workflow in
// .github/workflows/build.yml only runs when a changed path matches its
// `paths:` filter and only runs the suites it lists as steps. Since review
// 2026-09-27 Do first 10 that filter is the deploy's RUNTIME inputs only (a
// test-, seed- or docs-only push is no deploy and no APP_VERSION bump), and
// .github/workflows/test.yml runs the whole chain on every push and PR. This
// file keeps package.json's chain and build.yml's steps aligned (the deploy
// keeps its own gate), pins the filter to exactly the runtime inputs (every
// file the page loads and the build reads is in it; every tracked file outside
// it is a known non-runtime path), pins test.yml (section 2b), pins the
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

// a. every suite in the chain is a workflow step (the deploy runs the whole
//    chain before it bumps or builds - test.yml does not replace that gate).
chain.forEach(p => ok(stepRuns.includes(p), "suite `" + p + "` is in package.json's test chain but has no `run: node " + p + "` step in build.yml"));
// b. (until 10/2: every suite in the paths filter - retired by Do first 10; a
//    test-only push now runs in test.yml, section 2b, and is no deploy.)
//    Every test step runs BEFORE the version bump and the build (measured on the file
//    without its comment lines - a comment naming `run: node bump-version.js` is no step).
const ymlCode = yml.split("\n").filter(l => !/^\s*#/.test(l)).join("\n");
const bumpAt = ymlCode.indexOf("run: node bump-version.js"), buildAt = ymlCode.indexOf("run: node build.js");
const lastTestAt = Math.max(...testSteps.map(p => ymlCode.indexOf("run: node " + p)));
ok(bumpAt > 0 && buildAt > bumpAt && lastTestAt > 0 && lastTestAt < bumpAt, "every `run: node test/...` step must come before `run: node bump-version.js` and `run: node build.js` (a failing suite stops the deploy before anything is bumped)");
// c. every test step is in the chain (nothing runs in CI that `npm test`,
//    the CLAUDE.md pre-push gate, would not run locally).
testSteps.forEach(p => ok(chain.includes(p), "build.yml runs `" + p + "` but package.json's test chain does not"));
// d. steps run in the chain's order (the fast unit suites gate the slow
//    regression; a re-ordering is a deliberate change, made in both places).
const stepOrder = testSteps.filter(p => chain.includes(p));
ok(JSON.stringify(stepOrder) === JSON.stringify(chain.filter(p => testSteps.includes(p))),
  "build.yml test steps run in a different order than package.json's chain: " + JSON.stringify(stepOrder));
// e. nothing can quietly soften the gate (review 10/2 of Do first 10): no `continue-on-error` anywhere (a failing
//    suite would let the deploy go on), and the ONLY `if:` is the job-level [skip ci] guard - a job `if: false` or a
//    step-level `if:` on a suite would show a green or skipped run while the suite never ran.
ok(!/continue-on-error/.test(ymlCode), "build.yml must not use `continue-on-error` (a failing suite would let the bump and build go on)");
const ymlIfLines = ymlCode.split("\n").filter(l => /^\s*-?\s*if\s*:/.test(l)).map(l => l.replace(/\s+$/, ""));
ok(JSON.stringify(ymlIfLines) === JSON.stringify(["    if: ${{ !contains(github.event.head_commit.message, '[skip ci]') }}"]), "build.yml's only `if:` must be the job-level `if: ${{ !contains(github.event.head_commit.message, '[skip ci]') }}` (no step-level condition on a suite), found " + JSON.stringify(ymlIfLines));
flush("chain vs steps");

// ---- 2. the build filter is exactly the deploy's RUNTIME inputs (review 2026-09-27 Do first 10) ----
// A push matching the filter is a live deploy with an APP_VERSION bump (an update banner on every client), so the
// filter holds what build.js / bump-version.js read, what npm ci installs for the transpile and what Pages serves -
// nothing else. Tests, fixtures, the seed adapter, docs (the seed too), sql, scripts and the edge-function sources
// (deployed by hand) are NOT watched; test.yml (section 2b) runs the whole chain on every push and PR. The list is
// pinned exactly (a change is deliberate, made in build.yml and here together), and the derived pins below make a
// runtime file left out of it fail here instead of silently never deploying.
const RUNTIME_FILTER = [
  "index-source.html", "build.js", "bump-version.js", "package.json", "package-lock.json",
  "config.js", "helpers.js", "rules.js", "east-feed.js", "generator.js", "importer.js", "app-styles.js",
  "vendor/**", "manifest.json", "icon-512.png", "icon-192.png", "apple-touch-icon.png",
];
ok(JSON.stringify(filter.slice().sort()) === JSON.stringify(RUNTIME_FILTER.slice().sort()), "build.yml's paths filter must be exactly the runtime inputs " + JSON.stringify(RUNTIME_FILTER) + "; found " + JSON.stringify(filter));
ok(new Set(filter).size === filter.length, "build.yml's paths filter lists an entry twice: " + JSON.stringify(filter));
const WP = require(path.join(ROOT, "scripts", "ci-watched-paths.js"));
const watched = (p) => WP.watchedOf([p], filter).length === 1;
const idx = read("index-source.html");
// a. the ?v=APP_VERSION loader list - every script the page loads beside itself - is a subset of the filter.
const loaderM = idx.match(/\[('[^\]]+')\]\.forEach\(function\(f\) \{\s*document\.write\('<script src="'\+f\+'\?v='/);
const loaderFiles = loaderM ? loaderM[1].split(",").map(s => s.trim().replace(/^'|'$/g, "")) : [];
ok(loaderFiles.length >= 10, "could not parse the ?v=APP_VERSION loader list out of index-source.html (found " + loaderFiles.length + " entries)");
loaderFiles.forEach(f => {
  ok(watched(f), "loader file `" + f + "` is not in build.yml's paths filter - a push changing only it would never deploy");
  ok(fs.existsSync(path.join(ROOT, f)), "loader file `" + f + "` does not exist");
});
// b. every local file the page references with a literal href / src (the PWA shell) is in the filter.
const pageRefs = Array.from(idx.matchAll(/\b(?:href|src)="([^"]+)"/g)).map(m => m[1])
  .filter(u => !/^(https?:|data:|blob:|mailto:|#)/.test(u) && !/['+]/.test(u));
const SHELL = ["manifest.json", "apple-touch-icon.png", "icon-192.png", "icon-512.png"];
ok(JSON.stringify(Array.from(new Set(pageRefs)).sort()) === JSON.stringify(SHELL.slice().sort()), "index-source.html's local href / src literals changed (expected the PWA shell " + JSON.stringify(SHELL) + ", found " + JSON.stringify(pageRefs) + ") - a new served file belongs in the filter, RUNTIME_FILTER and this list together");
pageRefs.forEach(u => ok(watched(u), "index-source.html references `" + u + "` but build.yml's paths filter does not watch it (a manifest/icon-only push must bump APP_VERSION)"));
// c. the build inputs: build.js / bump-version.js default to the JSX source, require nothing local, and npm ci reads
//    package.json + package-lock.json; every local require of a loader module resolves to a watched file.
const buildSrc = read("build.js"), bumpSrc = read("bump-version.js");
const defaultSrcOf = (src) => (src.match(/process\.argv\[2\] \|\| "([^"]+)"/) || [])[1] || "";
ok(defaultSrcOf(buildSrc) === "index-source.html" && watched(defaultSrcOf(buildSrc)), "build.js's default source must be the watched index-source.html (found `" + defaultSrcOf(buildSrc) + "`)");
ok(defaultSrcOf(bumpSrc) === "index-source.html" && watched(defaultSrcOf(bumpSrc)), "bump-version.js's default file must be the watched index-source.html (found `" + defaultSrcOf(bumpSrc) + "`)");
["build.js", "bump-version.js", "package.json", "package-lock.json"].forEach(f => ok(watched(f), "build input `" + f + "` missing from build.yml's paths filter"));
[["build.js", buildSrc], ["bump-version.js", bumpSrc]].concat(loaderFiles.filter(f => /^[^/]+\.js$/.test(f)).map(f => [f, read(f)])).forEach(([f, src]) => {
  Array.from(src.matchAll(/require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)).map(m => path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]))).forEach(dep => {
    const file = /\.[a-z]+$/.test(dep) ? dep : dep + ".js";
    ok(watched(file), "`" + f + "` requires `" + file + "`, which build.yml's paths filter does not watch");
  });
});
// d. every tracked file is either watched or a known NON-runtime path, and nothing non-runtime is watched; every
//    filter entry matches a tracked file (no dead entry). A new runtime file (a module, an icon) fails here until it
//    is classified - added to the filter, or its path named below as non-runtime.
const NON_RUNTIME = [/^test\//, /^docs\//, /^sql\//, /^scripts\//, /^edge-functions\//, /^\.github\//, /^(README|CLAUDE)\.md$/, /^\.git(ignore|attributes)$/, /^(index\.html|version\.json)$/];
let tracked = [];
try { tracked = cp.execSync("git ls-files", { cwd: ROOT, encoding: "utf8" }).split("\n").map(s => s.trim()).filter(Boolean); } catch (e) { tracked = []; }
ok(tracked.length > 0, "git ls-files listed nothing (the classification below would pass vacuously)");
tracked.forEach(f => {
  const nonRuntime = NON_RUNTIME.some(r => r.test(f));
  ok(watched(f) || nonRuntime, "tracked file `" + f + "` is neither in build.yml's runtime filter nor a known non-runtime path - if the build reads it or Pages serves it, add it to the filter and RUNTIME_FILTER; otherwise name its path in NON_RUNTIME");
  ok(!(watched(f) && nonRuntime), "build.yml's paths filter watches the non-runtime path `" + f + "` (tests / docs / sql / scripts / edge functions are no deploy; test.yml runs the chain on every push)");
});
filter.forEach(g => ok(tracked.some(f => WP.watchedOf([f], [g]).length === 1), "build.yml's paths filter entry `" + g + "` matches no tracked file"));
// e. every tracked test/**/*.test.js reaches `npm test`: in the chain, or required by a chain suite in its folder
//    (test/nov-backups.test.js runs inside test/generator-regression.js - `require("./nov-backups.test.js")`, NB.run -
//    so it is not a chain entry of its own; that would run its 80 synthetic generations twice).
tracked.filter(f => /^test\/.+\.test\.(js|mjs)$/.test(f) && !chain.includes(f)).forEach(f => {
  const host = chain.find(c => path.posix.dirname(c) === path.posix.dirname(f) && read(c).includes('require("./' + path.posix.basename(f) + '")'));
  ok(!!host, "test file `" + f + "` is neither in package.json's test chain nor required by a chain suite - a test that never runs cannot fail");
});
ok(!chain.includes("test/nov-backups.test.js") && /require\("\.\/nov-backups\.test\.js"\)/.test(read("test/generator-regression.js")) && /NB\.run\(/.test(read("test/generator-regression.js")), "test/nov-backups.test.js runs inside test/generator-regression.js (require + NB.run), not as a chain entry of its own");
// f. files the page loads INDIRECTLY (review 10/2 of Do first 10): (d) classifies by folder, so a runtime file placed
//    under docs/ or test/ (Pages serves those too) and loaded through the generator worker, a relative fetch or the
//    manifest would pass it and never deploy. (1) the worker's importScripts list (helpers.js GEN_WORKER_MODULES) is
//    loader files only; (2) every path-shaped relative literal handed to fetch / importScripts / new URL / new Worker /
//    serviceWorker.register / sendBeacon / window.open in index-source.html and the loader modules is watched, or is the
//    CI-owned version.json that every deploy rewrites; (3) every manifest icon is watched.
const GWM = require(path.join(ROOT, "helpers.js")).GEN_WORKER_MODULES;
ok(Array.isArray(GWM) && GWM.length > 0, "could not read helpers.js GEN_WORKER_MODULES (the generator worker's importScripts list)");
(GWM || []).forEach(f => ok(loaderFiles.includes(f) && watched(f), "the generator worker imports `" + f + "` (helpers.js GEN_WORKER_MODULES), which is not a watched ?v= loader file - a push changing only it would never deploy"));
const URL_CALL = /\b(fetch|importScripts|new\s+URL|new\s+Worker|new\s+SharedWorker|serviceWorker\.register|sendBeacon|window\.open)\s*\(\s*(['"`])([^'"`]*)/g;
const relUrls = [];
["index-source.html"].concat(loaderFiles.filter(f => /^[^/]+\.js$/.test(f))).forEach(f => {
  const src = f === "index-source.html" ? idx : read(f);
  for (const m of src.matchAll(URL_CALL)) {
    const pm = m[3].match(/^(?:\.\/)?([A-Za-z0-9_][A-Za-z0-9_.\/-]*)(?:[?#]|\$\{|$)/);
    if (pm) relUrls.push([f, pm[1]]);
  }
});
ok(relUrls.some(([, u]) => u === "version.json"), "the relative-URL scan no longer finds the page's version.json fetch (the scan itself is broken)");
relUrls.forEach(([f, u]) => ok(u === "version.json" || watched(u), "`" + f + "` loads the relative URL `" + u + "`, which build.yml's paths filter does not watch - a runtime file belongs in the filter and RUNTIME_FILTER (only the CI-owned version.json is exempt)"));
const manifest = JSON.parse(read("manifest.json"));
ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, "manifest.json lists no icons (the parse below would pass vacuously)");
(manifest.icons || []).forEach(i => ok(watched(String(i.src).replace(/^\.\//, "")), "manifest.json icon `" + i.src + "` is not in build.yml's paths filter"));
flush("build filter = runtime inputs");

// ---- 2b. test.yml: the whole chain on every push and pull request (review 2026-09-27 Do first 10) ----
// Read-only: no paths / branches filter, contents: read, the same actions and SHAs as build.yml (section 8), the same
// Node, npm ci, then `npm test` - the chain itself, so "chain = steps" holds by construction - with EXPORTS_OFFLINE=1
// and the default wall-clock budgets; no bump, no build, no commit-back; superseded runs of a ref are cancelled.
const tymlPath = path.join(ROOT, ".github", "workflows", "test.yml");
ok(fs.existsSync(tymlPath), ".github/workflows/test.yml is missing (the chain on every push and PR)");
const tyml = fs.existsSync(tymlPath) ? read(".github/workflows/test.yml") : "";
const tymlCode = tyml.split("\n").filter(l => !/^\s*#/.test(l)).join("\n");
const tOn = (tymlCode.match(/^on:[ \t]*\n((?:[ \t]+\S.*\n?)+)/m) || [])[1] || "";
ok(JSON.stringify(tOn.trim().split("\n").map(s => s.trim())) === JSON.stringify(["push:", "pull_request:"]), "test.yml must trigger on bare `push:` and `pull_request:` (no paths / branches filter - every push to any branch and every PR); found " + JSON.stringify(tOn.trim()));
ok(!/^\s*(paths|paths-ignore|branches|branches-ignore|tags)\s*:/m.test(tymlCode), "test.yml carries a paths / branches filter");
ok(/^permissions:[ \t]*\n {2}contents: read[ \t]*\n(?! )/m.test(tymlCode + "\n"), "test.yml must declare workflow-level `permissions:\\n  contents: read` and nothing else");
ok(!/write/.test(tymlCode) && !/^ {4}permissions:/m.test(tymlCode), "test.yml must grant no write permission (no job-level permissions block either)");
ok(/^concurrency:[ \t]*\n {2}group: test-\$\{\{ github\.ref \}\}[ \t]*\n {2}cancel-in-progress: true[ \t]*$/m.test(tymlCode), "test.yml must set `concurrency: group: test-${{ github.ref }}` with `cancel-in-progress: true` (a newer push to the ref cancels the superseded run)");
const tRuns = Array.from(tymlCode.matchAll(/^\s*run:\s*(.+?)\s*$/gm)).map(m => m[1]);
ok(JSON.stringify(tRuns) === JSON.stringify(["npm ci --no-audit --no-fund", "npm test"]), "test.yml must run exactly `npm ci --no-audit --no-fund` then `npm test` (the chain itself; no step of its own), found " + JSON.stringify(tRuns));
const tTestStep = tymlCode.split(/\n(?=\s*-\s*name:)/).find(b => /run:\s*npm test\s*$/m.test(b)) || "";
ok(/env:\s*\n\s+EXPORTS_OFFLINE:\s*"1"/.test(tTestStep), "test.yml's npm test step must set env EXPORTS_OFFLINE: \"1\" (a runner never reads the live project)");
ok(!/SILVIS_GEN_BUDGET_MS\s*:/.test(tymlCode) && !/SILVIS_RULES_BUDGET_MS\s*:/.test(tymlCode), "test.yml must not set SILVIS_GEN_BUDGET_MS / SILVIS_RULES_BUDGET_MS - the default budgets are the gate");
ok(!/git (push|commit)|bump-version|build\.js|pages/i.test(tymlCode), "test.yml must not bump, build, commit, push or deploy (read-only)");
// review 10/2: nothing quietly turns the run off or green (no `if:` at any level, no continue-on-error), a hung suite
// cannot burn the 6 h default, and the checkout leaves no token in .git/config.
ok(!/^\s*-?\s*if\s*:/m.test(tymlCode), "test.yml must carry no `if:` (a job- or step-level condition would show a skipped run while no suite ran)");
ok(!/continue-on-error/.test(tymlCode), "test.yml must not use `continue-on-error` (a failing suite would read as a green run)");
const tTimeout = Number((tymlCode.match(/^ {4}timeout-minutes:\s*(\d+)\s*$/m) || [])[1]);
ok(tTimeout >= 10 && tTimeout <= 60, "test.yml's job must set `timeout-minutes:` between 10 and 60 (found " + tTimeout + ")");
ok(/uses: actions\/checkout@\S+[^\n]*\n\s+with:[ \t]*\n\s+persist-credentials: false[ \t]*$/m.test(tymlCode), "test.yml's checkout must set `with: persist-credentials: false` (nothing here pushes)");
flush("test.yml");

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
const tNodeVer = (tyml.match(/node-version:\s*"(\d+)"/) || [])[1];
ok(tNodeVer === nodeVer, "test.yml node-version must equal build.yml's (" + nodeVer + "), found " + tNodeVer);
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
// the matcher reads the SAME paths filter this file parses (WP is required in section 2)
ok(JSON.stringify(WP.watchedGlobs(yml)) === JSON.stringify(filter), "scripts/ci-watched-paths.js reads the same paths filter as this test");
// review 10/2 of Do first 10: (1) the matcher reads the filter AS OF origin/main - GitHub judged the push that moved
// main with the filter in the pushed commit, not the one this run checked out (a move that edits the filter would
// otherwise step aside for a run that was never queued: a green run, nothing deployed); (2) the rebuild arm re-runs
// the whole chain on origin/main after the reset and before the bump - the move may carry a test, fixture or seed
// change that fails against the runtime about to deploy, and test.yml's run of that push does not gate this deploy.
ok(/node scripts\/ci-watched-paths\.js --ref=origin\/main \$changed \|\| rc=\$\?/.test(commitStep), "the commit step must call `node scripts/ci-watched-paths.js --ref=origin/main $changed || rc=$?` (the filter of the pushed commit decides)");
const zeroArm = (commitStep.split(/^\s*0\)\s*$/m)[1] || "").split(/^\s*1\)\s*$/m)[0];
const zReset = zeroArm.search(/git reset --hard(?: --quiet)? origin\/main/), zTest = zeroArm.search(/^\s*EXPORTS_OFFLINE=1 npm test \|\| \{ echo "::error::[^\n]*"; exit 1; \}\s*$/m);
const zBump = zeroArm.indexOf("node bump-version.js"), zBuild = zeroArm.indexOf("node build.js");
ok(zReset >= 0 && zTest > zReset && zBump > zTest && zBuild > zBump, "the 0) arm must reset onto origin/main, then `EXPORTS_OFFLINE=1 npm test || { echo \"::error::...\"; exit 1; }`, then bump, then build (reset " + zReset + ", test " + zTest + ", bump " + zBump + ", build " + zBuild + ")");
const wpRun = (args) => cp.spawnSync(process.execPath, [path.join(ROOT, "scripts", "ci-watched-paths.js")].concat(args), { cwd: ROOT, encoding: "utf8" });
const wr1 = wpRun(["--ref=HEAD", "index-source.html", "docs/x.md"]), wr0 = wpRun(["--ref=HEAD", "docs/x.md", "test/rules.test.js"]);
ok(wr1.status === 1 && String(wr1.stdout).trim() === "index-source.html", "ci-watched-paths.js --ref=HEAD must report the watched index-source.html (exit 1), got exit " + wr1.status + " " + JSON.stringify(String(wr1.stdout || "") + String(wr1.stderr || "")));
ok(wr0.status === 0 && String(wr0.stdout).trim() === "", "ci-watched-paths.js --ref=HEAD must exit 0 on unwatched paths only, got exit " + wr0.status + " " + JSON.stringify(String(wr0.stderr || "")));
[["--ref=no-such-ref-ci-test"], ["--ref=-p"], ["--ref="]].forEach(a => { const r = wpRun(a.concat(["index-source.html"])); ok(r.status === 2, "ci-watched-paths.js " + a[0] + " must exit 2 (an unreadable filter is never 'none watched' or 'watched'), got " + r.status); });
// Do first 10: tests, fixtures, the seed adapter, the seed and the edge-function sources joined the unwatched set.
const unwatchedSample = ["docs/PUBLISH-x.md", "sql/schema.sql", "scripts/day-edit.js", "edge-functions/x/index.ts", "README.md",
  "test/rules.test.js", "test/fixtures/x/y.json", "test/seed-adapter.js", "docs/silvis-seed.json",
  "edge-functions/daily-reminder/index.ts", "edge-functions/send-notification/index.ts", ".github/workflows/test.yml"];
ok(WP.watchedOf(unwatchedSample, filter).length === 0, "tests / docs / sql / scripts / edge-function / workflow paths are unwatched (a push there is no deploy and queues no build run): " + JSON.stringify(WP.watchedOf(unwatchedSample, filter)));
const watchedSample = ["index-source.html", "rules.js", "vendor/x/y.js", "package.json", "package-lock.json", "manifest.json"];
ok(JSON.stringify(WP.watchedOf(watchedSample, filter)) === JSON.stringify(watchedSample), "watched paths match and ** crosses directories: " + JSON.stringify(WP.watchedOf(watchedSample, filter)));
ok(WP.watchedOf(["vendorX.js", "rules.jsx", "xindex-source.html", "test/rules.js", "docs/config.js"], filter).length === 0, "globs are anchored and '.' is literal");
flush("deploy job pins");

// ---- 8. supply chain (Prompt 16 B8): vendored libraries, the CSP, the lockfile, pinned actions ----
// React, ReactDOM and supabase-js are served from vendor/ - the exact bytes the npm registry publishes for the
// versions below, so a CDN outage, a CDN compromise or an unpinned "latest" can no longer change what the app
// runs. The hashes here are the deploy gate; vendor/README.md is the record. Bumping a library = replace the
// file, re-hash it, update this table and the README row together (the loader names stay).
const crypto = require("crypto");
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
// test.yml (Do first 10) uses the SAME two actions at the SAME SHAs - one table for both workflows, bumped together.
const tUses = Array.from(tymlCode.matchAll(/^\s*uses:\s*(\S+)\s*(#.*)?$/gm)).map(m => ({ ref: m[1], comment: (m[2] || "").trim() }));
ok(JSON.stringify(tUses.map(u => u.ref)) === JSON.stringify(uses.map(u => u.ref)), "test.yml must use exactly build.yml's two actions at the same SHAs, in order (checkout, setup-node); found " + tUses.map(u => u.ref).join(", "));
tUses.forEach(u => {
  const [name, sha] = u.ref.split("@");
  ok(PINNED[name] !== undefined && sha === PINNED[name], "test.yml: " + u.ref + " is not the pinned " + name + "@" + PINNED[name]);
});
ok(Array.from(tyml.matchAll(/^\s*uses:\s*\S+\s*(#.*)?$/gm)).every(m => /^#\s*v4\b/.test((m[1] || "").trim())), "test.yml: every `uses:` needs a trailing `# v4` comment naming the tag it pins");
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
