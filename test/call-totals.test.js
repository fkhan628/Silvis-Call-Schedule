// Silvis call-totals.js tests (Prompt 31 Part B, Faraz 10/9) - plain Node asserts, no framework, no network.
//   node test/call-totals.test.js                      (exit 0 = pass, 1 = failure)
//   CT_REQUIRE_CLONE=1 node test/call-totals.test.js   (the clone parity leg T9 MUST run; Faraz's pre-push run and the
//                                                       implementer's gate set it - a missing clone then fails)
//
// call-totals.js carries the Davenport app's call-totals counter PORTED VERBATIM from its commit eff3b81
// (weekBillingCredits, callTotalPeriods, callTotalsFor and the NIGHT_KEYS line), so the "My call - Silvis + Davenport"
// card shows the same numbers as the Davenport app's own card for the same period (Prompt 31 item 11). There is ONE
// counting definition: this suite pins the port byte for byte and never restates a counting rule of its own.
//   T1 load: helpers.js + east-feed.js + call-totals.js load in ONE vm context (the browser's global scope); call-totals.js
//      declares no name another page module or index-source.html's module scope declares (fmt / parse / addD above all)
//      and loads LAST in the ?v= loader list; Node require() gets the export guard's names
//   T2 verbatim: each body and the NIGHT_KEYS line hash to the digests of the eff3b81 blobs (LF text); the verbatim block
//      holds nothing else; each name is defined once; the header names eff3b81; the file is ASCII; Silvis's fmt / parse /
//      addD (which the port reuses) still hash to Davenport's helpers.js:4-6 at eff3b81
//   T3 the Davenport session's fixture (copied byte for byte from eff3b81): callTotalsFor(input) = its `expected`
//   T4 invariants on every period and month (sums, weights, months add up to the year and to YTD)
//   T5 the periods (rolling 12 months, YTD, month, leap day, year turn); a bad date -> null
//   T6 fail loud: unknown / empty code and impossible dates refuse; codes case-insensitive; malformed rows ignored
//   T7 purity and one definition: no clock, DOM, storage, fetch or draft state; callTotalsFor delegates every Davenport
//      rule to weekBillingCredits; the file never reads Setup's shift weights or the Central "today"
//   T8 T3 again in child processes under TZ=America/Chicago and TZ=Asia/Tokyo (the offsets proven)
//   T9 clone parity, against the PINNED commit (git -C <clone> show eff3b81:<path> - LF blobs, never the CRLF working
//      tree): the clone's bodies, NIGHT_KEYS line, fmt / parse / addD and fixture equal ours; a second vm loads
//      Davenport's OWN helpers.js + config.js at eff3b81 and both vms run the fixture, Davenport's two live-week
//      fixtures (read from the clone, never copied here) and 300 seeded synthetic inputs - outputs compared as canonical
//      JSON. The clone's HEAD is also compared: a counter changed after eff3b81 means a re-port (a failure under
//      CT_REQUIRE_CLONE=1, a printed NOTE otherwise - so a later Davenport commit never turns this repo's gate red by
//      itself). No clone (CI): "clone parity: SKIPPED", unless CT_REQUIRE_CLONE=1.
//   T10 the Silvis adapter (B2), on test/fixtures/call-totals-silvis-shapes-2026-10-14.json (the copied fixture re-shaped
//      as east_feed rows, a resolved code map, the Silvis roster and day assignments by id): the counter's input is the
//      copied fixture's and its output the copied `expected`, exactly; forecast rows never count; ids map to roster codes
//      (never the id itself); every unknown state (cache pending / failed / empty, Davenport roster loading / failed /
//      without the code, Silvis schedule not loaded) names its reason and turns that site's cells, the total and the
//      weighted total into "?", never zeros; malformed inputs and a throwing read give ok:false, never a throw (the
//      card renders inside the app - a throw would take the whole app to the crash screen); the device date
//   T11 the card model: titles, periods, row ids / labels / order, cell text ("-", "7.5", "?"), sub rows, the month list
//      (with "?" for months before the cache's first Davenport week), notes, the data line and the footnote - the
//      text hand-transcribed in the shapes fixture's expectedCells; every string ASCII, never "East" or "DSG"
//   T12 the docs (B5): the build guide's "My call - Silvis + Davenport" section, found by its title with its number
//      derived (23 on this base; the next free number after a rebase - the guide's section numbers unique and ascending)
//      (its sub-headings, the port commit, the parity rule, the units, the device date, the gate, every "?" reason
//      verbatim, the item 7 windows), guide sections 2 / 7 / 11 (NIGHT_KEYS's one home, the pointer to <n>.5, the runtime
//      modules = the ?v= loader list), the rules doc's section 6 bullet (display only; the card's 0.5 apart from the
//      Silvis shift accounting; one day = one shift), HISTORY's Part B row and ONBOARDING's paragraph for the East-code
//      surgeon
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const cp = require("child_process");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const readRoot = (p) => fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log("ok   " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n     " + String(e && e.message || e).split("\n").join("\n     ")); }
}

// ---- the port's identity (design section 1.1; every digest is over the LF blob text, `function` line .. closing `}`) ----
const PORT_COMMIT = "eff3b81";
const MODULE = "call-totals.js";
const BODY_DIGESTS = {
  weekBillingCredits: "af538ff9cd50f38fcb6299b9124a76222fbb58da7f54066cd10a3c51e7864236",
  callTotalPeriods: "e1180e7dabdede899ff62715f2a22e9760af8d8a9856ebc582dd39156981aa12",
  callTotalsFor: "e6ba81571f2a92354d342e6bd555840098a96bcc5e79970be5d2db73e4499ded",
};
const NIGHT_KEYS_LINE = 'const NIGHT_KEYS = ["mon","tue","wed","thu"];';
const NIGHT_KEYS_DIGEST = "156eaac5a4d6142f1e86df0113c54df12d83e4164813f88f5918b242fd922fe5";
// Silvis helpers.js `const fmt = ...`, `const parse = ...`, `const addD = ...` joined by "\n" = Davenport helpers.js:4-6.
const DATE_HELPERS_DIGEST = "50daa13b214f5b5685116c76bc9a499e94630ae7612e1eceae0eec418353bf2e";
const FIXTURE = "test/fixtures/call-totals-card-synthetic-2026-10-14.json";
const FIXTURE_DIGEST = "7de9f873820a067847a936ce2de194bc09e90dcecdf7147e756a47ce841063ac";
const VERBATIM_OPEN = "// ---- verbatim (" + PORT_COMMIT + ") ----";
const VERBATIM_CLOSE = "// ---- end verbatim ----";

// bodyOf(text, name): `^function name(` .. the first `^}$` after it (inclusive), or null.
function bodyOf(text, name) {
  const lines = text.split("\n");
  const i = lines.findIndex(l => l.startsWith("function " + name + "("));
  if (i < 0) return null;
  let j = i;
  while (j < lines.length && lines[j] !== "}") j++;
  return j < lines.length ? lines.slice(i, j + 1).join("\n") : null;
}
const dateHelperLines = (text) => ["fmt", "parse", "addD"].map(n => text.split("\n").find(l => l.startsWith("const " + n + " = ")) || "").join("\n");
// stripComments: block comments and // line comments (not inside a "://" URL); good enough for pins on this code.
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
// topNames(text): the names a classic script declares at column 0 (const / let / var / function / class, and a
// destructuring `const { a, b } =`) - the names that share the page's one global lexical scope.
function topNames(text) {
  const out = new Set();
  for (const m of text.matchAll(/^(?:const|let|var|function\*?|class|async function)\s+([A-Za-z_$][\w$]*)/gm)) out.add(m[1]);
  for (const m of text.matchAll(/^(?:const|let|var)\s*\{([^}]*)\}\s*=/gm)) m[1].split(",").map(s => s.split(":").pop().trim()).filter(Boolean).forEach(n => out.add(n));
  return out;
}

const sortKeys = (x) => (x && typeof x === "object" && !Array.isArray(x)) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x;
const canon = (v) => JSON.stringify(v, (k, x) => sortKeys(x));
const copy = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
function firstDiff(a, b, p) {
  p = p || "$";
  if (canon(a) === canon(b)) return "";
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) { const d = firstDiff(a[k], b[k], p + "." + k); if (d) return d; }
  }
  return (p + ": got " + JSON.stringify(a) + " want " + JSON.stringify(b)).slice(0, 300);
}

// ---- the page's global scope, in Node: one vm context, the loader list's order ----
function pageContext() {
  const box = {
    console, window: {}, document: undefined, navigator: { userAgent: "node-test" },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => { throw new Error("no network in this test"); }, setTimeout, clearTimeout,
  };
  box.globalThis = box;
  vm.createContext(box);
  return box;
}
const loadErrors = [];
const SBOX = pageContext();
for (const f of ["helpers.js", "east-feed.js", MODULE]) {
  try { vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), SBOX, { filename: f }); }
  catch (e) { loadErrors.push(f + ": " + String(e && e.message || e).split("\n")[0]); }
}
const S = (() => {
  try { return vm.runInContext('({ ctf: typeof callTotalsFor === "function" ? callTotalsFor : null, ctp: typeof callTotalPeriods === "function" ? callTotalPeriods : null, wbc: typeof weekBillingCredits === "function" ? weekBillingCredits : null, nk: typeof NIGHT_KEYS !== "undefined" ? NIGHT_KEYS : null })', SBOX); }
  catch (e) { return { ctf: null, ctp: null, wbc: null, nk: null }; }
})();
const NONE = "callTotalsFor is not defined (call-totals.js missing or not loaded)";
const ct = (input) => { if (!S.ctf) return null; try { return copy(S.ctf(copy(input))); } catch (e) { return { threw: String(e && e.message || e).slice(0, 200) }; } };
const fx = fs.existsSync(path.join(ROOT, FIXTURE)) ? JSON.parse(readRoot(FIXTURE)) : null;
const MOD = fs.existsSync(path.join(ROOT, MODULE)) ? readRoot(MODULE) : "";
const KINDS = ["dc", "nights", "wknd", "hol", "dcB", "nightsB", "wkndB", "holB", "silvisP", "silvisB", "dsg", "dsgB", "total", "weighted"];

// ======================================================================================================================
console.log("[T1] load: one global scope, no collision, loaded last");
check("T1 helpers.js, east-feed.js and call-totals.js load together in ONE context (the page's global scope) without error, and call-totals.js exposes callTotalsFor / callTotalPeriods / weekBillingCredits / NIGHT_KEYS", () => {
  assert.ok(fs.existsSync(path.join(ROOT, MODULE)), MODULE + " does not exist");
  assert.deepStrictEqual(loadErrors, []);
  assert.ok(S.ctf && S.ctp && S.wbc, NONE);
  assert.strictEqual(canon(copy(S.nk)), canon(["mon", "tue", "wed", "thu"]));
});
check("T1 call-totals.js declares no top-level name that another page script declares (config.js, helpers.js, rules.js, east-feed.js, generator.js, importer.js, app-styles.js, index-source.html's module scope, the vendored React / ReactDOM / supabase globals) - a second `const fmt` is a SyntaxError and the module would never load", () => {
  const mine = topNames(MOD);
  assert.ok(mine.has("callTotalsFor") && mine.has("NIGHT_KEYS"), "the scan found call-totals.js's own names");
  ["fmt", "parse", "addD", "monOf"].forEach(n => assert.ok(!mine.has(n), "call-totals.js declares " + n + " (reuse helpers.js's)"));
  const clashes = [];
  for (const f of ["config.js", "helpers.js", "rules.js", "east-feed.js", "generator.js", "importer.js", "app-styles.js"]) {
    const other = topNames(readRoot(f));
    [...mine].filter(n => other.has(n)).forEach(n => clashes.push(f + ": " + n));
  }
  const idx = readRoot("index-source.html");
  const a = idx.indexOf('<script type="text/babel">'), b = idx.indexOf("</script>", a);
  const jsx = idx.slice(a, b);
  const page = topNames(jsx);
  const pre = jsx.match(/^\s*const \{([^}]*)\} = React;$/m);
  if (pre) pre[1].split(",").map(s => s.trim()).filter(Boolean).forEach(n => page.add(n));
  assert.ok(page.has("CallSchedule") && page.has("useState"), "the module-scope scan of index-source.html found CallSchedule and the React hooks (not vacuous)");
  [...mine].filter(n => page.has(n)).forEach(n => clashes.push("index-source.html: " + n));
  ["React", "ReactDOM", "supabase", "window", "document"].filter(n => mine.has(n)).forEach(n => clashes.push("vendored global: " + n));
  assert.deepStrictEqual(clashes, []);
});
check("T1 call-totals.js is the LAST entry of index-source.html's ?v= loader list - after helpers.js (fmt / parse / addD) and east-feed.js", () => {
  const idx = readRoot("index-source.html");
  const m = idx.match(/\[('[^\]]+')\]\.forEach\(function\(f\) \{\s*document\.write\('<script src="'\+f\+'\?v='/);
  assert.ok(m, "loader list not found");
  const list = m[1].split(",").map(s => s.trim().replace(/^'|'$/g, ""));
  assert.strictEqual(list[list.length - 1], MODULE, "loader list: " + JSON.stringify(list));
  assert.strictEqual(list.filter(f => f === MODULE).length, 1);
  assert.ok(list.indexOf("helpers.js") >= 0 && list.indexOf("helpers.js") < list.indexOf(MODULE) && list.indexOf("east-feed.js") < list.indexOf(MODULE));
});
check("T1 Node: require('call-totals.js') returns the export guard's names (functions whose fmt is helpers.js's only inside one vm context - see the header)", () => {
  const M = require(path.join(ROOT, MODULE));
  ["weekBillingCredits", "callTotalPeriods", "callTotalsFor"].forEach(n => assert.strictEqual(typeof M[n], "function", n));
  assert.deepStrictEqual(M.NIGHT_KEYS, ["mon", "tue", "wed", "thu"]);
  assert.ok(/^if \(typeof module !== "undefined" && module\.exports\) \{/m.test(MOD), "the export guard (`if (typeof module !== \"undefined\" && module.exports) {`) is at column 0");
});

// ======================================================================================================================
console.log("\n[T2] verbatim: the eff3b81 bodies, byte for byte");
check("T2 each ported body hashes to the eff3b81 blob's digest (LF text, `function` line .. closing `}`) and the NIGHT_KEYS line to config.js:380's", () => {
  const bad = [];
  for (const [n, d] of Object.entries(BODY_DIGESTS)) { const b = bodyOf(MOD, n); if (!b || sha(b) !== d) bad.push(n + ": " + (b ? sha(b) : "missing")); }
  const nkLines = MOD.split("\n").filter(l => /\bNIGHT_KEYS\s*=/.test(l));
  if (nkLines.length !== 1 || nkLines[0] !== NIGHT_KEYS_LINE || sha(nkLines[0]) !== NIGHT_KEYS_DIGEST) bad.push("NIGHT_KEYS: " + JSON.stringify(nkLines));
  assert.deepStrictEqual(bad, []);
});
check("T2 the verbatim block (between `" + VERBATIM_OPEN + "` and `" + VERBATIM_CLOSE + "`) holds the NIGHT_KEYS line and the three bodies and NOTHING else (blank lines only between them)", () => {
  assert.strictEqual(MOD.split(VERBATIM_OPEN).length - 1, 1, "one opening marker");
  assert.strictEqual(MOD.split(VERBATIM_CLOSE).length - 1, 1, "one closing marker");
  const a = MOD.indexOf(VERBATIM_OPEN), b = MOD.indexOf(VERBATIM_CLOSE);
  assert.ok(a >= 0 && b > a, "markers in order");
  let block = MOD.slice(a + VERBATIM_OPEN.length, b);
  const parts = [NIGHT_KEYS_LINE].concat(Object.keys(BODY_DIGESTS).map(n => bodyOf(MOD, n)));
  parts.forEach((p, i) => { assert.ok(p && block.includes(p), "part " + i + " is inside the verbatim block"); block = block.replace(p, ""); });
  assert.strictEqual(block.trim(), "", "the verbatim block carries something besides the ported lines: " + JSON.stringify(block.trim().slice(0, 120)));
});
check("T2 each ported name is defined exactly once in call-totals.js and nowhere else among the page scripts (one counting definition)", () => {
  const bad = [];
  for (const n of ["weekBillingCredits", "callTotalPeriods", "callTotalsFor", "NIGHT_KEYS"]) {
    const defs = (MOD.match(new RegExp("(^function " + n + "\\(|^(const|let|var) " + n + "\\b|\\b" + n + "\\s*=[^=])", "gm")) || []).length;
    if (defs !== 1) bad.push(MODULE + " " + n + " x" + defs);
    for (const f of ["config.js", "helpers.js", "rules.js", "east-feed.js", "generator.js", "importer.js", "app-styles.js", "sw.js", "index-source.html"]) {
      if (new RegExp("\\bfunction " + n + "\\b|\\b(const|let|var) " + n + "\\b").test(readRoot(f))) bad.push(f + " defines " + n);
    }
  }
  assert.deepStrictEqual(bad, []);
});
check("T2 the header says PORTED VERBATIM from commit " + PORT_COMMIT + ", names the ported lines and is ASCII with no machine path", () => {
  const head = MOD.slice(0, MOD.indexOf(VERBATIM_OPEN));
  assert.ok(/PORTED VERBATIM/.test(head) && head.includes("commit " + PORT_COMMIT), "header names the port and its commit");
  ["helpers.js:66-81 weekBillingCredits", "helpers.js:107-122 callTotalPeriods", "helpers.js:141-191 callTotalsFor", "config.js:380 NIGHT_KEYS"].forEach(s => assert.ok(head.includes(s), "header names " + s));
  assert.ok(!/[^\x00-\x7F]/.test(MOD), "call-totals.js is ASCII");
  assert.ok(!/\b[A-Za-z]:[\\/]|Users[\\/]/.test(MOD), "no machine path in call-totals.js");
});
check("T2 Silvis helpers.js's fmt / parse / addD - which the port reuses, never redeclares - still hash to Davenport helpers.js:4-6 at " + PORT_COMMIT, () => {
  const lines = dateHelperLines(readRoot("helpers.js"));
  assert.strictEqual(sha(lines), DATE_HELPERS_DIGEST, "helpers.js fmt / parse / addD changed - the port's dates would no longer be Davenport's:\n" + lines);
});

// ======================================================================================================================
console.log("\n[T3] the Davenport session's fixture, end to end");
check("T3 " + FIXTURE + " is the eff3b81 file byte for byte (sha256 of the LF text)", () => {
  assert.ok(fx, FIXTURE + " is missing");
  assert.strictEqual(sha(readRoot(FIXTURE)), FIXTURE_DIGEST);
});
check("T3 callTotalsFor(fixture.input) gives exactly fixture.expected (5 periods x worked / scheduled, 12 months, the data ranges)", () => {
  assert.ok(fx, FIXTURE + " is missing");
  const out = ct(fx.input);
  assert.ok(out, NONE);
  assert.ok(canon(out) === canon(fx.expected), firstDiff(out, fx.expected));
});
check("T3 headline: October worked 3 day-call days + 1 weeknight + 3 backup-week weekend days + Silvis 1 primary / 2 backup = 10 (weighted 7.5); scheduled 4 day-call days + 1 primary = 5; today (10/14) counts as worked", () => {
  const out = ct(fx && fx.input);
  const oct = out && out.periods && out.periods.month;
  assert.ok(oct && oct.worked, NONE);
  assert.deepStrictEqual([oct.worked.total, oct.worked.weighted, oct.scheduled.total, oct.worked.dc, oct.scheduled.dc, oct.worked.nights, oct.worked.wkndB, oct.worked.silvisP, oct.worked.silvisB, oct.scheduled.silvisP],
    [10, 7.5, 5, 3, 4, 1, 3, 1, 2, 1]);
});

// ======================================================================================================================
console.log("\n[T4] invariants");
function invariantErrors(o, label) {
  if (!o || !o.ok || !o.periods || !Array.isArray(o.months)) return [label + ": no output"];
  const errs = [];
  const cOk = (c, w) => {
    if (!c || KINDS.some(k => typeof c[k] !== "number")) { errs.push(w + ": missing fields"); return; }
    const dsg = c.dc + c.nights + c.wknd + c.hol, dsgB = c.dcB + c.nightsB + c.wkndB + c.holB;
    if (c.dsg !== dsg || c.dsgB !== dsgB || c.total !== dsg + dsgB + c.silvisP + c.silvisB || c.weighted !== dsg + c.silvisP + 0.5 * (dsgB + c.silvisB)) errs.push(w + ": sums");
  };
  ["month", "ytd", "year", "rolling12"].forEach(p => { cOk(o.periods[p] && o.periods[p].worked, label + " " + p + ".worked"); cOk(o.periods[p] && o.periods[p].scheduled, label + " " + p + ".scheduled"); });
  o.months.forEach(m => { cOk(m.worked, label + " " + m.month + ".worked"); cOk(m.scheduled, label + " " + m.month + ".scheduled"); });
  if (o.months.length !== 12) errs.push(label + ": " + o.months.length + " months");
  if (errs.length) return errs;
  const sum = (ms, part) => Object.fromEntries(KINDS.map(k => [k, ms.reduce((a, m) => a + ((m[part] || {})[k] || 0), 0)]));
  if (canon(sum(o.months, "worked")) !== canon(o.periods.year.worked) || canon(sum(o.months, "scheduled")) !== canon(o.periods.year.scheduled)) errs.push(label + ": months != year");
  const mi = Number(o.today.slice(5, 7));
  if (canon(sum(o.months.slice(0, mi), "worked")) !== canon(o.periods.ytd.worked)) errs.push(label + ": Jan..this month worked != YTD");
  if (KINDS.some(k => o.periods.ytd.scheduled[k] !== 0 || o.periods.rolling12.scheduled[k] !== 0)) errs.push(label + ": YTD / 12 months must hold nothing scheduled");
  const mm = o.months[mi - 1];
  if (canon(o.periods.month) !== canon({ from: mm.from, to: mm.to, worked: mm.worked, scheduled: mm.scheduled })) errs.push(label + ": this month != its row in the month list");
  return errs;
}
check("T4 on the fixture: the Davenport sums / backup sums / total / weighted are their parts in every period and month; Jan..Dec add up to the year; Jan..October worked = YTD; YTD and 12 months hold nothing scheduled", () => {
  assert.deepStrictEqual(invariantErrors(ct(fx && fx.input), "fixture"), []);
});
check("T4 the same invariants for every roster code of the fixture and for four other todays (2026-01-01, 2026-02-28, 2026-12-31, 2027-01-04)", () => {
  const errs = [];
  for (const r of (fx ? fx.input.roster : [])) for (const today of ["2026-10-14", "2026-01-01", "2026-02-28", "2026-12-31", "2027-01-04"]) errs.push(...invariantErrors(ct(Object.assign(copy(fx.input), { code: r.name, today })), r.name + "@" + today));
  assert.ok(fx && errs.length === 0, errs.slice(0, 4).join(" | ") || "no fixture");
});

// ======================================================================================================================
console.log("\n[T5] periods");
const P = (t) => (S.ctp ? copy(S.ctp(t)) : null);
const span = (p) => (p ? p.from + ".." + p.to : "null");
check("T5 today 2026-10-14: month 10-01..10-31, YTD 01-01..10-14, year 01-01..12-31, 12 months 2025-10-15..2026-10-14, the month list Jan..Dec (Feb 2026 ends the 28th)", () => {
  const p = P("2026-10-14");
  assert.ok(p, "callTotalPeriods is not defined");
  assert.deepStrictEqual([span(p.month), span(p.ytd), span(p.year), span(p.rolling12), p.months.length, p.months[0].month, span(p.months[1]), p.months[11].month],
    ["2026-10-01..2026-10-31", "2026-01-01..2026-10-14", "2026-01-01..2026-12-31", "2025-10-15..2026-10-14", 12, "2026-01", "2026-02-01..2026-02-28", "2026-12"]);
});
check("T5 edges: leap day 2028-02-29 -> 12 months from 2027-03-01 and February ends the 29th; 2027-01-01 -> YTD is that one day, 12 months from 2026-01-02; 2026-03-31 -> from 2025-04-01; 2026-12-31 -> 12 months = the calendar year", () => {
  const pLeap = P("2028-02-29"), pJan1 = P("2027-01-01"), pMar31 = P("2026-03-31"), pDec31 = P("2026-12-31");
  assert.ok(pLeap && pJan1 && pMar31 && pDec31, "callTotalPeriods is not defined");
  assert.deepStrictEqual([span(pLeap.rolling12), span(pLeap.month), span(pLeap.months[1]), span(pJan1.ytd), span(pJan1.rolling12), pMar31.rolling12.from, span(pDec31.rolling12)],
    ["2027-03-01..2028-02-29", "2028-02-01..2028-02-29", "2028-02-01..2028-02-29", "2027-01-01..2027-01-01", "2026-01-02..2027-01-01", "2025-04-01", "2026-01-01..2026-12-31"]);
});
check("T5 a malformed or impossible date gives null, never a guessed period: '2026-13-01', '2026-02-30', '2026-2-3', '', 'today', null, undefined, a Date", () => {
  assert.ok(S.ctp, "callTotalPeriods is not defined");
  ["2026-13-01", "2026-02-30", "2026-2-3", "", "today", null, undefined, new Date(2026, 9, 14)].forEach(t => assert.strictEqual(S.ctp(t), null, String(t)));
});

// ======================================================================================================================
console.log("\n[T6] fail loud");
check("T6 an unknown code, an empty code and an impossible today refuse (ok:false, the reason names the problem) - never zeros that read as 'no call'", () => {
  const base = copy(fx.input);
  const u = ct(Object.assign(copy(base), { code: "ZZZ" })), e = ct(Object.assign(copy(base), { code: "  " })), d = ct(Object.assign(copy(base), { today: "2026-02-30" }));
  assert.ok(u && e && d, NONE);
  assert.deepStrictEqual([u.ok, /ZZZ/.test(u.error), e.ok, d.ok, /2026-02-30/.test(d.error)], [false, true, false, false, true], JSON.stringify([u, e, d]).slice(0, 300));
  const n = ct(Object.assign(copy(base), { roster: [{ id: "", name: "FAK" }] }));
  assert.strictEqual(n.ok, false, "a roster entry with no id refuses");
});
check("T6 codes compare case-insensitively on both sides: 'fak' and lower-case Silvis codes give the fixture's numbers", () => {
  const base = copy(fx.input);
  const o = ct(Object.assign(base, { code: "fak", silvisRows: base.silvisRows.map(r => Object.assign({}, r, { primary_code: r.primary_code && r.primary_code.toLowerCase(), backup_code: r.backup_code && r.backup_code.toLowerCase() })) }));
  assert.ok(o && o.ok === true && o.sid === "s6" && o.code === "FAK", JSON.stringify(o).slice(0, 200));
  assert.ok(canon(o.periods) === canon(fx.expected.periods), firstDiff(o.periods, fx.expected.periods));
});
check("T6 no data at all is ok with null ranges and zeros (the card, not the counter, says the data is missing)", () => {
  const o = ct({ weeks: {}, roster: fx.input.roster, silvisRows: [], code: "FAK", today: "2026-10-14" });
  assert.ok(o && o.ok === true, NONE);
  assert.deepStrictEqual([o.range.dsgFrom, o.range.dsgTo, o.range.silvisFrom, o.range.silvisTo, o.periods.year.worked.total, o.periods.year.scheduled.total], [null, null, null, null, 0, 0]);
});
check("T6 malformed Silvis rows, non-date week keys and empty weeks are ignored (the same card as the clean fixture)", () => {
  const noisy = copy(fx.input);
  noisy.weeks.notes = { dayCall: "s6" }; noisy.weeks["2026-13-02"] = { dayCall: "s6" }; noisy.weeks["2026-07-06"] = null;
  noisy.silvisRows.push(null, { day: "2026-10-1", primary_code: "FAK" }, { primary_code: "FAK" }, { day: "garbage", backup_code: "FAK" });
  const o = ct(noisy);
  assert.ok(o && canon(o) === canon(fx.expected), o ? firstDiff(o, fx.expected) : NONE);
});

// ======================================================================================================================
console.log("\n[T7] purity and one definition");
const CLOCK_ETC = ["new Date()", "Date.now", "useState", "useMemo", "useEffect", "window.", "document.", "localStorage", "fetch(", "previewGen", "previewSchedule", "Math.random"];
check("T7 the three ported bodies are pure - none of " + JSON.stringify(CLOCK_ETC) + " (the literal `new Date()` only: callTotalPeriods' `new Date(yy, mm, 0)` is a calendar computation)", () => {
  const hits = [];
  Object.keys(BODY_DIGESTS).forEach(n => { const b = bodyOf(MOD, n) || ""; if (!b) hits.push(n + " missing"); CLOCK_ETC.forEach(t => { if (b.includes(t)) hits.push(n + ": " + t); }); });
  assert.deepStrictEqual(hits, []);
});
check("T7 no second definition: callTotalsFor delegates every Davenport rule to weekBillingCredits (it never reads dayCallOverrides, holidayCoverage, a nights slot, NIGHT_KEYS or dayCall itself)", () => {
  const b = bodyOf(MOD, "callTotalsFor") || "";
  assert.ok(b.includes("weekBillingCredits("), "callTotalsFor calls weekBillingCredits");
  const m = b.match(/dayCallOverrides|holidayCoverage|NIGHT_KEYS|\.nights\??\.|\.nights\??\[|\.dayCall\b/);
  assert.strictEqual(m && m[0], null);
});
check("T7 the whole of call-totals.js (code, comments stripped) reads no clock but the device date, no network, storage, DOM, draft or forecast state, and none of Setup's shift weights or the Central today: `new Date()` only inside callTotalsDeviceToday; none of shiftAccounting, shiftWeightsOf, todayCentral, deriveKhanBusyDays, east_overrides, applyOverrides, eastForecast, previewGen, fetch(, localStorage, document., Math.random", () => {
  const code = stripComments(MOD);
  const banned = ["shiftAccounting", "shiftWeightsOf", "todayCentral", "deriveKhanBusyDays", "east_overrides", "applyOverrides", "eastForecast", "previewGen", "fetch(", "localStorage", "document.", "Math.random", "Date.now"];
  assert.deepStrictEqual(banned.filter(t => code.includes(t)), []);
  const lines = code.split("\n");
  const bad = [];
  lines.forEach((l, i) => {
    if (!l.includes("new Date()")) return;
    let k = i; while (k >= 0 && !/^function /.test(lines[k])) k--;
    if (k < 0 || !/^function callTotalsDeviceToday\(/.test(lines[k])) bad.push("line " + (i + 1) + ": " + l.trim());
  });
  assert.deepStrictEqual(bad, []);
});

// ======================================================================================================================
console.log("\n[T8] time zones");
{
  const code = [
    'const vm = require("vm"), fs = require("fs"), path = require("path");',
    'const sb = { console, window: {}, document: undefined, navigator: { userAgent: "node-test" }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, fetch: () => { throw new Error("no fetch"); }, setTimeout, clearTimeout };',
    "sb.globalThis = sb; vm.createContext(sb);",
    'for (const f of ["helpers.js", "east-feed.js", "call-totals.js"]) vm.runInContext(fs.readFileSync(path.join(process.argv[1], f), "utf8"), sb, { filename: f });',
    'const ctf = vm.runInContext("typeof callTotalsFor === \\"function\\" ? callTotalsFor : null", sb);',
    'const input = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).input;',
    'process.stdout.write(JSON.stringify({ tz: process.env.TZ, off: new Date(2026, 9, 24).getTimezoneOffset(), naive: new Date("2026-10-14").getDate(), out: ctf ? ctf(input) : null }));',
  ].join("\n");
  const inZone = (TZ) => {
    const r = cp.spawnSync(process.execPath, ["-e", code, ROOT, path.join(ROOT, FIXTURE)], { env: Object.assign({}, process.env, { TZ }), encoding: "utf8" });
    if (r.status !== 0) return { err: String(r.stderr || r.error).slice(0, 300) };
    try { return JSON.parse(r.stdout); } catch (e) { return { err: "bad output: " + String(r.stdout).slice(0, 200) }; }
  };
  const chi = inZone("America/Chicago"), tok = inZone("Asia/Tokyo");
  check("T8 the children really run in America/Chicago (offset 300; the naive new Date('2026-10-14') is the 13th there) and Asia/Tokyo (offset -540, the 14th)", () => {
    assert.deepStrictEqual([chi.tz, chi.off, chi.naive, tok.tz, tok.off, tok.naive], ["America/Chicago", 300, 13, "Asia/Tokyo", -540, 14], JSON.stringify({ chi: chi.err, tok: tok.err }));
  });
  check("T8 under TZ=America/Chicago and TZ=Asia/Tokyo the fixture gives exactly the same card", () => {
    assert.ok(chi.out && tok.out && fx, NONE + " " + JSON.stringify({ chi: chi.err, tok: tok.err }));
    assert.ok(canon(chi.out) === canon(fx.expected), "Chicago: " + firstDiff(chi.out, fx.expected));
    assert.ok(canon(tok.out) === canon(fx.expected), "Tokyo: " + firstDiff(tok.out, fx.expected));
  });
}

// ======================================================================================================================
console.log("\n[T9] clone parity (Davenport's own counter at " + PORT_COMMIT + ")");
{
  const REQUIRE = process.env.CT_REQUIRE_CLONE === "1";
  const CLONE = process.env.DAVENPORT_REF ? path.resolve(process.env.DAVENPORT_REF) : path.join(ROOT, "..", "davenport-ref");
  const git = (args) => cp.execFileSync("git", ["-C", CLONE].concat(args), { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
  const show = (rev, p) => git(["show", rev + ":" + p]).replace(/\r\n/g, "\n");
  let cloneWhy = null, HEAD = null;
  if (!fs.existsSync(CLONE)) cloneWhy = "no davenport-ref clone";
  else {
    try { git(["cat-file", "-e", PORT_COMMIT + "^{commit}"]); HEAD = git(["rev-parse", "HEAD"]).trim(); }
    catch (e) { cloneWhy = "the davenport-ref clone has no commit " + PORT_COMMIT; }
  }
  if (cloneWhy) {
    if (REQUIRE) check("T9 CT_REQUIRE_CLONE=1: the clone parity leg must run", () => { assert.fail(cloneWhy + " (set DAVENPORT_REF to the clone, or unset CT_REQUIRE_CLONE)"); });
    else console.log("clone parity: SKIPPED (" + cloneWhy + ")");
  } else {
    console.log("clone parity: reading " + PORT_COMMIT + " with git show (clone HEAD " + HEAD.slice(0, 7) + ")");
    const dHelpers = show(PORT_COMMIT, "helpers.js"), dConfig = show(PORT_COMMIT, "config.js");
    check("T9 (a) the clone's three bodies and NIGHT_KEYS line at " + PORT_COMMIT + " equal call-totals.js's byte for byte, and hash to the pinned digests", () => {
      const bad = [];
      for (const [n, d] of Object.entries(BODY_DIGESTS)) {
        const theirs = bodyOf(dHelpers, n), ours = bodyOf(MOD, n);
        if (!theirs || theirs !== ours || sha(theirs) !== d) bad.push(n);
      }
      const nk = dConfig.split("\n").filter(l => /^const NIGHT_KEYS\b/.test(l)), ourNk = MOD.split("\n").filter(l => /^const NIGHT_KEYS\b/.test(l));
      if (nk.length !== 1 || canon(nk) !== canon(ourNk) || nk[0] !== NIGHT_KEYS_LINE || sha(nk[0]) !== NIGHT_KEYS_DIGEST) bad.push("NIGHT_KEYS clone " + JSON.stringify(nk) + " ours " + JSON.stringify(ourNk));
      assert.deepStrictEqual(bad, []);
    });
    check("T9 (a) Davenport's fmt / parse / addD at " + PORT_COMMIT + " are Silvis helpers.js's, byte for byte", () => {
      assert.strictEqual(dateHelperLines(dHelpers), dateHelperLines(readRoot("helpers.js")));
      assert.strictEqual(sha(dateHelperLines(dHelpers)), DATE_HELPERS_DIGEST);
    });
    let dFixture = null;
    check("T9 (b) the clone's fixture at " + PORT_COMMIT + " equals " + FIXTURE, () => {
      dFixture = show(PORT_COMMIT, FIXTURE);
      assert.ok(dFixture === readRoot(FIXTURE), "the copied fixture differs from the clone's");
    });

    // (c) Davenport's own counter: its helpers.js + config.js at the pinned commit, in their own vm (sync-guards' sandbox).
    const DBOX = pageContext();
    let dLoad = null;
    try { for (const [f, t] of [["helpers.js", dHelpers], ["config.js", dConfig]]) vm.runInContext(t, DBOX, { filename: "davenport-" + PORT_COMMIT + "/" + f }); }
    catch (e) { dLoad = String(e && e.message || e).split("\n")[0]; }
    const D = dLoad ? {} : vm.runInContext('({ ctf: typeof callTotalsFor === "function" ? callTotalsFor : null, ctp: typeof callTotalPeriods === "function" ? callTotalPeriods : null, wbc: typeof weekBillingCredits === "function" ? weekBillingCredits : null })', DBOX);
    const run = (fn, arg) => { try { return { out: copy(fn(copy(arg))) }; } catch (e) { return { threw: String(e && e.message || e).slice(0, 200) }; } };
    const both = (input) => [run(S.ctf, input), run(D.ctf, input)];
    const compareAll = (inputs, label) => {
      const bad = [];
      inputs.forEach((inp, i) => { const [ours, theirs] = both(inp); if (canon(ours) !== canon(theirs)) bad.push(label + " #" + i + " (code " + JSON.stringify(inp.code) + ", today " + JSON.stringify(inp.today) + "): " + firstDiff(ours, theirs)); });
      return bad;
    };
    check("T9 (c) Davenport's own helpers.js + config.js at " + PORT_COMMIT + " load in their own vm and expose its counter", () => {
      assert.strictEqual(dLoad, null);
      assert.ok(D.ctf && D.ctp && D.wbc && S.ctf, "a counter is missing");
    });
    if (!dLoad && D.ctf && S.ctf) {
      check("T9 (c) the fixture: both counters give the same card, and it is the fixture's expected", () => {
        const [ours, theirs] = both(fx.input);
        assert.ok(canon(ours) === canon(theirs), firstDiff(ours, theirs));
        assert.ok(canon(theirs.out) === canon(fx.expected), firstDiff(theirs.out, fx.expected));
      });
      const SILVIS_CODES = ["FAK", "MAB", "BDA", "AFP", "NF", "SRK"];
      const roster = fx.input.roster;
      const liveSets = [];
      for (const f of ["test/fixtures/billing-live-weeks-2026-10-01.json", "test/fixtures/schedule-weeks-live-2026-10-02.json"]) {
        let weeks = null; try { weeks = JSON.parse(show(PORT_COMMIT, f)); } catch (e) { weeks = null; }
        liveSets.push([f, weeks]);
      }
      check("T9 (c) Davenport's two live-week fixtures (read from the clone at " + PORT_COMMIT + ", never copied): every roster code, with and without the fixture's Silvis rows, four todays - the same output from both counters", () => {
        liveSets.forEach(([f, w]) => assert.ok(w && typeof w === "object" && Object.keys(w).length >= 10, f + " could not be read from the clone"));
        const inputs = [];
        liveSets.forEach(([, weeks]) => roster.forEach(r => ["2026-10-14", "2026-03-01", "2026-12-31", "2027-01-01"].forEach(today => [[], fx.input.silvisRows].forEach(rows => inputs.push({ weeks, roster, silvisRows: rows, code: r.name, today })))));
        const bad = compareAll(inputs, "live");
        assert.ok(inputs.length === 2 * 7 * 4 * 2 && bad.length === 0, bad.slice(0, 3).join(" | ") || "inputs " + inputs.length);
        const nonZero = inputs.filter(inp => { const o = run(S.ctf, inp).out; return o && o.ok && o.periods.year.worked.total + o.periods.year.scheduled.total > 0; }).length;
        assert.ok(nonZero > inputs.length / 2, "the live inputs count something (not a vacuous comparison): " + nonZero + " of " + inputs.length);
      });

      // 300 seeded synthetic inputs (mulberry32): random weeks 2025-12-29..2027-01, overrides inside and outside the
      // week, swap / minor / major / odd-cased coverage inside and outside it, missing coverers, isBackup, missing or
      // odd nights, non-object and non-date rows; lower-case / padded / unknown / empty codes; null-coded, duplicated
      // and malformed Silvis rows; todays across 2026-2028 with the leap day, 12/31, 1/1 and impossible dates.
      function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
      const rnd = mulberry32(31102026);
      const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
      const chance = (p) => rnd() < p;
      const p2 = (n) => String(n).padStart(2, "0");
      const dayStr = (d) => d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
      const plus = (s, n) => { const [y, m, d] = s.split("-").map(Number); return dayStr(new Date(y, m - 1, d + n)); };
      const SIDS = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"];
      const sidOrNot = () => (chance(0.85) ? pick(SIDS) : pick([null, undefined, "", "s9"]));
      function synthWeek(mon) {
        const wk = {};
        if (chance(0.9)) wk.dayCall = sidOrNot();
        if (chance(0.92)) { wk.nights = {}; ["mon", "tue", "wed", "thu", "wknd"].forEach(k => { if (chance(0.9)) wk.nights[k] = sidOrNot(); }); }
        else if (chance(0.5)) wk.nights = pick([null, "x", []]);
        if (chance(0.3)) wk.isBackup = true; else if (chance(0.3)) wk.isBackup = false;
        if (chance(0.15)) wk.isFierceBackup = true;
        if (chance(0.35)) { wk.dayCallOverrides = {}; const n = 1 + Math.floor(rnd() * 3); for (let i = 0; i < n; i++) wk.dayCallOverrides[plus(mon, Math.floor(rnd() * 10) - 1)] = sidOrNot(); }
        if (chance(0.35)) {
          wk.holidayCoverage = {}; const n = 1 + Math.floor(rnd() * 2);
          for (let i = 0; i < n; i++) wk.holidayCoverage[plus(mon, Math.floor(rnd() * 10) - 1)] = chance(0.08) ? null : { surgeonId: sidOrNot(), type: pick(["swap", "minor", "major", "Major", "SWAP", undefined, ""]), role: "holiday_24h" };
        } else if (chance(0.1)) wk.holidayCoverage = null;
        if (chance(0.2)) wk.vacations = [{ code: "XXX", start: plus(mon, 1), end: plus(mon, 3) }];
        return wk;
      }
      function synthInput() {
        const weeks = {};
        let mon = "2025-12-29";
        while (mon <= "2027-01-25") { if (chance(0.55)) weeks[mon] = synthWeek(mon); mon = plus(mon, 7); }
        if (chance(0.1)) weeks.notes = { dayCall: "s6" };
        if (chance(0.1)) weeks["2026-13-02"] = { dayCall: "s6" };
        if (chance(0.1)) weeks[pick(Object.keys(weeks).concat(["2026-07-06"]))] = pick([null, 5, "x"]);
        const ros = roster.map(r => ({ id: r.id, name: chance(0.1) ? r.name.toLowerCase() : r.name }));
        if (chance(0.05)) ros.push(null);
        const code = chance(0.9) ? (r => (chance(0.2) ? r.name.toLowerCase() : chance(0.1) ? " " + r.name + " " : r.name))(pick(roster)) : pick(["ZZZ", "", "  ", null, undefined]);
        const rows = [];
        const n = Math.floor(rnd() * 60);
        for (let i = 0; i < n; i++) {
          const d = plus("2026-09-01", Math.floor(rnd() * 150));
          const c = () => (chance(0.15) ? null : chance(0.3) ? String(code || "FAK").trim() : pick(SILVIS_CODES.concat(roster.map(r => r.name))));
          const row = { day: d, primary_code: c(), backup_code: c() };
          if (row.primary_code && chance(0.15)) row.primary_code = row.primary_code.toLowerCase();
          rows.push(row);
          if (chance(0.08)) rows.push(Object.assign({}, row));
        }
        if (chance(0.15)) rows.push(null, { day: "2026-10-1", primary_code: "FAK" }, { primary_code: "FAK" }, { day: "garbage", backup_code: "FAK" });
        const today = chance(0.15) ? pick(["2028-02-29", "2026-12-31", "2027-01-01", "2026-01-01", "2026-02-30", "2027-02-29", "x"]) : plus("2026-01-01", Math.floor(rnd() * 1095));
        return { weeks, roster: ros, silvisRows: rows, code, today };
      }
      const synth = []; for (let i = 0; i < 300; i++) synth.push(synthInput());
      check("T9 (c) 300 seeded synthetic inputs (mulberry32): both counters give the same output, a refusal or a throw included", () => {
        const bad = compareAll(synth, "synthetic");
        assert.ok(bad.length === 0, bad.slice(0, 3).join(" | "));
        const okCount = synth.filter(inp => { const o = run(S.ctf, inp).out; return o && o.ok; }).length;
        assert.ok(okCount > 200 && okCount < 300, "the synthetic set holds both counted and refused inputs (not vacuous): " + okCount + " ok of 300");
      });
      check("T9 (c) weekBillingCredits and callTotalPeriods directly: every synthetic week and every synthetic today give the same result in both vms", () => {
        const bad = [];
        synth.forEach((inp, i) => {
          Object.keys(inp.weeks).forEach(k => { const a = run(x => S.wbc(k, x), inp.weeks[k]), b = run(x => D.wbc(k, x), inp.weeks[k]); if (canon(a) !== canon(b)) bad.push("week " + i + " " + k + ": " + firstDiff(a, b)); });
          const a = run(S.ctp, inp.today), b = run(D.ctp, inp.today);
          if (canon(a) !== canon(b)) bad.push("periods " + JSON.stringify(inp.today) + ": " + firstDiff(a, b));
        });
        assert.ok(bad.length === 0, bad.slice(0, 3).join(" | "));
      });
    }

    // (d) the clone's HEAD against the clone's OWN eff3b81 blobs (our copy is T2 / T9 (a)'s business): Davenport changed
    // the counter after eff3b81 -> a re-port (review the change, port it, update the digests and the header's commit).
    // A failure only under CT_REQUIRE_CLONE=1, a NOTE otherwise.
    {
      let drift = [];
      try {
        const hHelpers = show("HEAD", "helpers.js"), hConfig = show("HEAD", "config.js");
        for (const n of Object.keys(BODY_DIGESTS)) if (bodyOf(hHelpers, n) !== bodyOf(dHelpers, n)) drift.push(n);
        const nkOf = (t) => canon(t.split("\n").filter(l => /^const NIGHT_KEYS\b/.test(l)));
        if (nkOf(hConfig) !== nkOf(dConfig)) drift.push("NIGHT_KEYS");
        if (dateHelperLines(hHelpers) !== dateHelperLines(dHelpers)) drift.push("fmt / parse / addD");
        let hFix = null, eFix = null; try { hFix = show("HEAD", FIXTURE); eFix = show(PORT_COMMIT, FIXTURE); } catch (e) { hFix = null; }
        if (hFix === null || hFix !== eFix) drift.push(FIXTURE);
      } catch (e) { drift = ["the clone's HEAD could not be read: " + String(e && e.message || e).split("\n")[0]]; }
      const msg = "clone HEAD " + HEAD.slice(0, 7) + " differs from " + PORT_COMMIT + " in: " + drift.join(", ") + " - the Davenport app changed the counter after the port: re-port it (review first)";
      if (REQUIRE) check("T9 (d) CT_REQUIRE_CLONE=1: the clone's HEAD (" + HEAD.slice(0, 7) + ") still carries the ported counter, NIGHT_KEYS, fmt / parse / addD and fixture unchanged", () => { assert.ok(drift.length === 0, msg); });
      else if (drift.length) console.log("NOTE " + msg + " (not a failure without CT_REQUIRE_CLONE=1)");
      else console.log("clone parity: HEAD " + HEAD.slice(0, 7) + " carries the " + PORT_COMMIT + " counter unchanged");
    }
  }
}

// ======================================================================================================================
// T10 / T11 - the Silvis adapter and the card model (Prompt 31 Part B step B2). The adapter is Silvis's own: it shapes the
// app's data (east_feed rows, the resolved Davenport id map, the published schedule by roster id) into the ported
// counter's input and its output into the card's text. It restates no counting rule (T7 and the T10 code scan).
const SHAPES = "test/fixtures/call-totals-silvis-shapes-2026-10-14.json";
const SH = fs.existsSync(path.join(ROOT, SHAPES)) ? JSON.parse(readRoot(SHAPES)) : null;
const ADAPTER_MARK = "// ---- Silvis adapter";
const ADAPTER_NAMES = ["CT_UNKNOWN_DAVENPORT_ID", "callTotalsDeviceToday", "callTotalsWeeks", "callTotalsSilvisRows", "callTotalsInputs", "callTotalsCardModel", "callTotalsCardFor"];
const SA = (() => {
  try {
    return vm.runInContext("({" + ADAPTER_NAMES.map(n => n + ": typeof " + n + ' !== "undefined" ? ' + n + " : null").join(", ") + "})", SBOX);
  } catch (e) { return {}; }
})();
const NOA = "the adapter is not defined (call-totals.js has no Silvis adapter yet)";
const callA = (name, ...args) => { if (typeof SA[name] !== "function") throw new Error(NOA + ": " + name); return copy(SA[name](...args)); };
const shapeArgs = (over) => Object.assign({
  feedRows: copy(SH.feedRows), feedState: "ok", idByCode: copy(SH.eastIdByCode), schedule: copy(SH.schedule), scheduleKnown: true,
  roster: copy(SH.roster), personId: SH.personId, today: SH.today,
}, over || {});
const cardFor = (over) => callA("callTotalsCardFor", shapeArgs(over));
const periodOf = (m, key) => (m && Array.isArray(m.periods) ? m.periods.find(p => p.key === key) : null);
const rowsOf = (m, key) => { const p = periodOf(m, key); return p ? p.rows.map(r => [r.id, r.worked, r.scheduled, r.all]) : null; };
const monthsOf = (m) => (m && Array.isArray(m.months) && Array.isArray(m.monthCols) ? m.months.map(x => [x.month, x.label].concat(m.monthCols.map(c => x.cells[c.id]))) : null);
const EC = SH ? SH.expectedCells : null;
const DAV_ROWS = ["dav-daycall", "dav-nights", "dav-weekend", "dav-holiday", "dav-backup", "dav-backup-daycall", "dav-backup-nights", "dav-backup-weekend", "dav-backup-holiday"];
const SIL_ROWS = ["silvis-primary", "silvis-backup"];
// every string (keys included) a model carries, for the ASCII / wording pins
const stringsOf = (v, acc) => { acc = acc || []; if (typeof v === "string") acc.push(v); else if (v && typeof v === "object") Object.keys(v).forEach(k => { acc.push(k); stringsOf(v[k], acc); }); return acc; };

console.log("\n[T10] the Silvis adapter");
check("T10 call-totals.js defines the adapter (" + ADAPTER_NAMES.join(", ") + ") once, AFTER the verbatim block under a `" + ADAPTER_MARK + "` marker, and the export guard (require) names them", () => {
  const a = MOD.indexOf(ADAPTER_MARK), v = MOD.indexOf(VERBATIM_CLOSE);
  assert.ok(a > 0 && v > 0 && a > v, "the adapter marker is missing or not after the verbatim block");
  assert.strictEqual(MOD.split(ADAPTER_MARK).length - 1, 1, "one adapter marker");
  const tail = MOD.slice(a);
  const bad = ADAPTER_NAMES.filter(n => (MOD.match(new RegExp("^(function|const) " + n + "\\b", "gm")) || []).length !== 1 || !new RegExp("^(function|const) " + n + "\\b", "m").test(tail));
  assert.deepStrictEqual(bad, [], "defined once, in the adapter section");
  ADAPTER_NAMES.forEach(n => assert.ok(SA[n] !== null && SA[n] !== undefined, n + " is not visible in the page's global scope"));
  const M = require(path.join(ROOT, MODULE));
  assert.deepStrictEqual(ADAPTER_NAMES.filter(n => M[n] === undefined), [], "require() does not export every adapter name");
});
check("T10 the shapes fixture is the copied Davenport fixture re-shaped: its published feed rows' data are the copied weeks (the one synthetic XXX list aside), its schedule the copied Silvis rows by roster id plus the 10/20 outside cover, and it names the copied file", () => {
  assert.ok(SH && fx, SHAPES + " or " + FIXTURE + " is missing");
  assert.strictEqual(SH.expectedFrom, FIXTURE);
  const pub = SH.feedRows.filter(r => !(r.data && r.data.isForecast === true));
  const weeks = {};
  pub.forEach(r => { const d = copy(r.data); delete d.vacations; weeks[r.week_monday] = d; });
  assert.ok(canon(weeks) === canon(fx.input.weeks), firstDiff(weeks, fx.input.weeks));
  assert.deepStrictEqual(pub.filter(r => r.data.vacations).map(r => [r.week_monday, r.data.vacations.map(x => x.code).join()]), [["2026-08-31", "XXX"]]);
  assert.deepStrictEqual(SH.feedRows.filter(r => r.data && r.data.isForecast === true).map(r => r.week_monday), ["2026-11-30", "2027-02-01"]);
  const codeOf = {}; SH.roster.forEach(r => { codeOf[r.id] = r.code; });
  const rows = Object.keys(SH.schedule).sort().filter(d => d !== "2026-10-20").map(d => ({ day: d, primary_code: SH.schedule[d].primary ? codeOf[SH.schedule[d].primary] : null, backup_code: SH.schedule[d].backup ? codeOf[SH.schedule[d].backup] : null }));
  assert.deepStrictEqual(rows, fx.input.silvisRows.map(r => ({ day: r.day, primary_code: r.primary_code, backup_code: r.backup_code })));
  assert.deepStrictEqual([SH.schedule["2026-10-20"].primary, SH.schedule["2026-10-20"].externalCover], [null, "Visiting surgeon"]);
});
check("T10 callTotalsWeeks: the east_feed rows keyed by week_monday with their data as cached (the vacation list rides along - the counter ignores it); forecast-marked rows, malformed keys, non-object data and non-rows are dropped", () => {
  const w = callA("callTotalsWeeks", SH.feedRows);
  assert.deepStrictEqual(Object.keys(w), Object.keys(fx.input.weeks).sort());
  assert.deepStrictEqual(w["2026-08-31"].vacations, [{ code: "XXX", start: "2026-09-01", end: "2026-09-03" }]);
  assert.ok(!w["2026-11-30"] && !w["2027-02-01"], "a forecast row is in the weeks");
  const noisy = SH.feedRows.concat([null, 5, "x", { week_monday: null, data: {} }, { week_monday: "2026-13-02", data: { dayCall: "s6" } }, { week_monday: "notes", data: {} },
    { week_monday: "2026-07-06", data: null }, { week_monday: "2026-07-13", data: "x" }, { week_monday: "2026-07-20", data: [] }, { week_monday: "2026-07-27T00:00:00", data: { dayCall: "s6" } }]);
  const wn = callA("callTotalsWeeks", noisy);
  assert.deepStrictEqual(Object.keys(wn), Object.keys(fx.input.weeks).concat(["2026-07-27"]).sort(), "a timestamp-shaped week_monday is read by its date; everything else malformed is dropped");
  [null, undefined, "x", 5, {}].forEach(v => assert.deepStrictEqual(callA("callTotalsWeeks", v), {}, JSON.stringify(v)));
});
check("T10 callTotalsSilvisRows: every day of the schedule map in date order, roster ids -> upper-cased roster codes, null for an id with no roster code (NEVER the id itself), the outside-cover day's primary null; malformed keys and entries dropped", () => {
  const rows = callA("callTotalsSilvisRows", SH.schedule, SH.roster);
  const want = fx.input.silvisRows.map(r => ({ day: r.day, primary_code: r.primary_code, backup_code: r.backup_code }));
  want.splice(7, 0, { day: "2026-10-20", primary_code: null, backup_code: "BDA" });
  assert.deepStrictEqual(rows, want);
  const odd = callA("callTotalsSilvisRows", { "2026-10-02": { primary: "s9", backup: "s2" }, "2026-10-01": { primary: "s1", backup: "s5" }, "2026-10-03": null, notes: { primary: "s1" }, "2026-13-01": { primary: "s1" }, "2026-10-04": "s1" },
    [{ id: "s1", code: " fak " }, { id: "s2" }, null, 5, { id: "s5", code: "" }]);
  assert.deepStrictEqual(odd, [{ day: "2026-10-01", primary_code: "FAK", backup_code: null }, { day: "2026-10-02", primary_code: null, backup_code: null }]);
  [[null, SH.roster], ["x", SH.roster], [SH.schedule, null]].forEach(([s, r]) => assert.ok(Array.isArray(callA("callTotalsSilvisRows", s, r))));
  assert.ok(callA("callTotalsSilvisRows", SH.schedule, null).every(x => x.primary_code === null && x.backup_code === null), "no roster: no code, never an id");
});
check("T10 callTotalsInputs on the shapes fixture: the counter's input is the copied fixture's (weeks, Silvis rows, code FAK, today) with a one-entry Davenport roster [{ id: s6, name: FAK }], and callTotalsFor of it is the copied `expected` EXACTLY - the forecast rows never count (dsgTo stays 2026-12-27) and the 2026-10-20 outside cover changes nothing", () => {
  const inp = callA("callTotalsInputs", shapeArgs());
  assert.ok(inp && inp.ok === true, JSON.stringify(inp).slice(0, 200));
  assert.deepStrictEqual([inp.code, inp.today, inp.davenport.known, inp.davenport.why, inp.davenport.fetchedAt, inp.silvis.known, inp.silvis.why], ["FAK", "2026-10-14", true, null, "2026-10-14T13:00:00.000+00:00", true, null]);
  assert.deepStrictEqual(inp.counter.roster, [{ id: "s6", name: "FAK" }]);
  assert.deepStrictEqual([inp.counter.code, inp.counter.today], ["FAK", "2026-10-14"]);
  const out = ct(inp.counter);
  assert.ok(out && canon(out) === canon(fx.expected), out ? firstDiff(out, fx.expected) : NONE);
  assert.strictEqual(out.range.dsgTo, "2026-12-27");
});
check("T10 callTotalsCardFor on the shapes fixture: every period row's and every month cell's numbers are the copied `expected`'s (worked, scheduled, worked + scheduled)", () => {
  const m = cardFor();
  assert.ok(m && m.ok === true, JSON.stringify(m).slice(0, 200));
  const KEY = { "silvis-primary": "silvisP", "silvis-backup": "silvisB", "dav-daycall": "dc", "dav-nights": "nights", "dav-weekend": "wknd", "dav-holiday": "hol", "dav-backup": "dsgB",
    "dav-backup-daycall": "dcB", "dav-backup-nights": "nightsB", "dav-backup-weekend": "wkndB", "dav-backup-holiday": "holB", total: "total", weighted: "weighted" };
  const bad = [];
  ["month", "ytd", "year", "rolling12"].forEach(pk => {
    const e = fx.expected.periods[pk], p = periodOf(m, pk);
    if (!p || p.from !== e.from || p.to !== e.to) { bad.push(pk + " span"); return; }
    p.rows.forEach(r => { const k = KEY[r.id]; if (!r.num || r.num.worked !== e.worked[k] || r.num.scheduled !== e.scheduled[k] || r.num.all !== e.worked[k] + e.scheduled[k]) bad.push(pk + " " + r.id + " " + JSON.stringify(r.num)); });
  });
  const COL = { silvisP: "silvisP", silvisB: "silvisB", dav: "dsg", davB: "dsgB", total: "total", weighted: "weighted" };
  fx.expected.months.forEach((e, i) => {
    const x = m.months[i];
    if (!x || x.month !== e.month || x.pending !== (e.scheduled.total > 0)) { bad.push(e.month + " month"); return; }
    Object.keys(COL).forEach(c => { const v = e.worked[COL[c]] + e.scheduled[COL[c]]; const t = v === 0 ? "-" : (Number.isInteger(v) ? String(v) : v.toFixed(1)); if (x.cells[c] !== t) bad.push(e.month + " " + c + " " + x.cells[c] + " != " + t); });
  });
  assert.deepStrictEqual(bad, []);
});
const UNKNOWN_DAV = [
  [{ feedState: "pending" }, "the Davenport cache is still loading"],
  [{ feedState: "failed" }, "the Davenport cache could not be read"],
  [{ feedState: undefined }, "the Davenport cache could not be read"],
  [{ feedRows: [] }, "no Davenport weeks are cached yet"],
  [{ feedRows: "FORECAST_ONLY" }, "no Davenport weeks are cached yet"],
  [{ idByCode: null }, "the Davenport roster is still loading"],
  [{ idByCode: { _source: "failed" } }, "the Davenport roster could not be read"],
  [{ idByCode: { _source: "davenport", MAB: "s2" } }, "code FAK is not in the Davenport roster"],
  [{ idByCode: { _source: "davenport", FAK: 6 } }, "code FAK is not in the Davenport roster"],
];
check("T10 each Davenport-unknown state (cache pending / failed / no state, no published week, roster loading / failed / without the code / a non-string id) names its reason, hands the counter no weeks and a placeholder id, shows ? in every Davenport cell, the total and the weighted total (no sub rows), and keeps the Silvis numbers", () => {
  assert.ok(SH, SHAPES + " is missing");
  const base = cardFor();
  assert.ok(base && base.ok === true, NOA);
  const bad = [];
  UNKNOWN_DAV.forEach(([over, why]) => {
    // Object.assign, not copy(): a JSON round trip would drop `feedState: undefined` and test the default instead
    const o = Object.assign({}, over); if (o.feedRows === "FORECAST_ONLY") o.feedRows = SH.feedRows.filter(r => r.data && r.data.isForecast === true);
    const inp = callA("callTotalsInputs", shapeArgs(o)), m = cardFor(o);
    const tag = JSON.stringify(over);
    if (!inp.ok || inp.davenport.known !== false || inp.davenport.why !== why) { bad.push(tag + " why " + JSON.stringify(inp.davenport)); return; }
    if (canon(inp.counter.weeks) !== "{}" || canon(inp.counter.roster) !== canon([{ id: SA.CT_UNKNOWN_DAVENPORT_ID, name: "FAK" }])) bad.push(tag + " counter");
    if (!m.ok || m.davenportKnown !== false || m.silvisKnown !== true) { bad.push(tag + " model " + JSON.stringify(m).slice(0, 120)); return; }
    if (canon(m.notes) !== canon(["Davenport numbers unavailable - " + why + "; its cells and the totals show ?."])) bad.push(tag + " notes " + JSON.stringify(m.notes));
    if (!m.dataLine.includes("Davenport: not available (" + why + ")")) bad.push(tag + " dataLine " + m.dataLine);
    m.periods.forEach(p => {
      const bp = periodOf(base, p.key);
      p.rows.forEach(r => {
        if (r.sub) bad.push(tag + " " + p.key + " sub row " + r.id);
        const unknownRow = DAV_ROWS.includes(r.id) || r.id === "total" || r.id === "weighted";
        if (unknownRow && (r.worked !== "?" || r.scheduled !== "?" || r.all !== "?" || r.num !== null)) bad.push(tag + " " + p.key + " " + r.id + " not ?");
        if (SIL_ROWS.includes(r.id)) { const b = bp.rows.find(x => x.id === r.id); if (canon([r.worked, r.scheduled, r.all, r.num]) !== canon([b.worked, b.scheduled, b.all, b.num])) bad.push(tag + " " + p.key + " " + r.id + " changed"); }
      });
    });
    m.months.forEach((x, i) => {
      if (["dav", "davB", "total", "weighted"].some(c => x.cells[c] !== "?")) bad.push(tag + " " + x.month + " not ?");
      if (x.cells.silvisP !== base.months[i].cells.silvisP || x.cells.silvisB !== base.months[i].cells.silvisB) bad.push(tag + " " + x.month + " Silvis changed");
    });
  });
  assert.deepStrictEqual(bad, []);
});
check("T10 the Silvis schedule not loaded (scheduleKnown false): its reason, no Silvis rows handed to the counter, ? in the Silvis cells, the total and the weighted total, the Davenport numbers unchanged; both sites unknown: both reasons, every cell ?", () => {
  const base = cardFor();
  const inp = callA("callTotalsInputs", shapeArgs({ scheduleKnown: false })), m = cardFor({ scheduleKnown: false });
  assert.deepStrictEqual([inp.silvis.known, inp.silvis.why, inp.counter.silvisRows, inp.davenport.known], [false, "the Silvis schedule is not loaded", [], true]);
  assert.ok(m.ok && m.silvisKnown === false && m.davenportKnown === true, JSON.stringify(m).slice(0, 160));
  const bad = [];
  m.periods.forEach(p => p.rows.forEach(r => {
    const b = periodOf(base, p.key).rows.find(x => x.id === r.id);
    if ((SIL_ROWS.includes(r.id) || r.id === "total" || r.id === "weighted") && (r.worked !== "?" || r.scheduled !== "?" || r.all !== "?" || r.num !== null)) bad.push(p.key + " " + r.id + " not ?");
    if (DAV_ROWS.includes(r.id) && (!b || canon([r.worked, r.scheduled, r.all, r.num]) !== canon([b.worked, b.scheduled, b.all, b.num]))) bad.push(p.key + " " + r.id + " changed");
  }));
  assert.deepStrictEqual(bad, []);
  const both = cardFor({ scheduleKnown: false, feedState: "failed" });
  assert.deepStrictEqual(both.notes, ["Davenport numbers unavailable - the Davenport cache could not be read; its cells and the totals show ?.", "Silvis numbers unavailable - the Silvis schedule is not loaded; its cells and the totals show ?."]);
  assert.ok(both.periods.every(p => p.rows.every(r => r.worked === "?" && r.scheduled === "?" && r.all === "?")) && both.months.every(x => Object.values(x.cells).every(c => c === "?")), "every cell ? when both sites are unknown");
});
check("T10 refusals: a person with no roster entry, a roster entry with no code, no arguments, an impossible today - ok:false with the title and a reason, never zeros", () => {
  const cases = [
    [{ personId: "s9" }, /no roster entry for s9/],
    [{ personId: "" }, /no roster entry/],
    [{ roster: SH.roster.map(r => (r.id === "s1" ? { id: "s1", name: "Khan", code: " " } : r)) }, /no roster code for Khan/],
    [{ today: "2026-02-30" }, /not a date: "2026-02-30"/],
    [{ today: undefined }, /not a date/],
  ];
  const bad = [];
  cases.forEach(([over, rx]) => { const m = cardFor(over); if (!m || m.ok !== false || m.title !== "My call - Silvis + Davenport" || !rx.test(String(m.error)) || m.periods) bad.push(JSON.stringify(over).slice(0, 60) + " -> " + JSON.stringify(m).slice(0, 160)); });
  [undefined, null, {}, 5].forEach(a => { const m = callA("callTotalsCardFor", a); if (!m || m.ok !== false || !m.error) bad.push(String(a) + " -> " + JSON.stringify(m)); });
  assert.deepStrictEqual(bad, []);
  const inp = callA("callTotalsInputs", shapeArgs({ roster: SH.roster.map(r => (r.id === "s1" ? Object.assign({}, r, { code: "fak" }) : r)) }));
  assert.deepStrictEqual([inp.ok, inp.code, inp.counter.roster[0].name], [true, "FAK", "FAK"], "a lower-case roster code is counted upper-cased");
});
check("T10 crash-safe: malformed rows, maps, rosters and id maps never throw (the card renders inside the app; the only error boundary is the whole app's) - and a read that throws comes back ok:false 'the totals could not be computed (...)'", () => {
  const bad = [];
  const weird = [
    { feedRows: [null, 5, "x", { week_monday: "2026-10-12", data: { dayCall: "s6", holidayCoverage: "nope", nights: 7, dayCallOverrides: 3, isBackup: "yes" } }, { week_monday: "2026-10-19", data: { dayCall: { id: "s6" }, holidayCoverage: { "2026-10-20": null, "2026-10-21": 5 }, nights: { mon: ["s6"] } } }] },
    { schedule: null }, { schedule: "x" }, { schedule: { "2026-10-01": null, "2026-10-02": "s1", "2026-10-03": { primary: {}, backup: 5 }, notes: { primary: "s1" } } },
    { roster: [null, 5, { id: "s1", code: "FAK" }] }, { roster: "x" }, { roster: null },
    { idByCode: "x" }, { idByCode: 5 }, { idByCode: { _source: "davenport", FAK: { id: "s6" } } }, { idByCode: [] },
    { feedRows: SH.feedRows.map(r => Object.assign({}, r, { fetched_at: r.week_monday === "2026-10-12" ? "garbage" : null })) },
    { today: 20261014 }, { today: null }, { feedState: { ok: true } }, { scheduleKnown: "yes" },
  ];
  weird.forEach(over => {
    let m; try { m = cardFor(over); } catch (e) { bad.push(JSON.stringify(over).slice(0, 80) + " THREW " + e.message); return; }
    if (!m || typeof m.ok !== "boolean" || m.title !== "My call - Silvis + Davenport" || (m.ok === false && !m.error)) bad.push(JSON.stringify(over).slice(0, 80) + " -> " + JSON.stringify(m).slice(0, 120));
  });
  const boomRow = Object.defineProperty({ week_monday: "2026-10-12" }, "data", { enumerable: true, get() { throw new Error("boom in a row"); } });
  const boomDay = Object.defineProperty({}, "2026-10-01", { enumerable: true, get() { throw new Error("boom in a day"); } });
  [[{ feedRows: [boomRow] }, "boom in a row"], [{ schedule: boomDay }, "boom in a day"]].forEach(([over, msg]) => {
    let m; try { m = SA.callTotalsCardFor ? copy(SA.callTotalsCardFor(shapeArgs(over))) : null; } catch (e) { bad.push(msg + " THREW " + e.message); return; }
    if (!m || m.ok !== false || m.error !== "the totals could not be computed (" + msg + ")" || m.title !== "My call - Silvis + Davenport") bad.push(msg + " -> " + JSON.stringify(m));
  });
  assert.deepStrictEqual(bad, []);
});
check("T10 the counter is handed published rows only: callTotalsInputs takes no forecast / override input (extra keys change nothing), and the adapter's code reads no Davenport week field and no busy-day, forecast, override, Central-today or shift-weight source", () => {
  const plain = callA("callTotalsInputs", shapeArgs());
  const extra = callA("callTotalsInputs", shapeArgs({ forecastRows: [{ week_monday: "2026-11-30", data: { isForecast: true, dayCall: "s6" } }], overrideRows: [{ day: "2026-10-15", person_id: "s1", busy: true }], eastForecastRows: [1], eastOverrideRows: [1], previewGen: { schedule: { "2026-10-16": { primary: "s1" } } } }));
  assert.ok(canon(plain) === canon(extra), firstDiff(extra, plain));
  // the adapter section = the marker .. the export guard (the guard itself names the ported functions to export them)
  const a = MOD.indexOf(ADAPTER_MARK), g = MOD.indexOf('if (typeof module !== "undefined" && module.exports) {');
  assert.ok(a > 0 && g > a, "no adapter section before the export guard");
  const code = stripComments(MOD.slice(a, g));
  const m = code.match(/dayCallOverrides|holidayCoverage|NIGHT_KEYS|\.nights\??\.|\.nights\??\[|\.dayCall\b|\.isBackup\b|weekBillingCredits|deriveKhanBusyDays|deriveFierceWeeks|eastForecast|forecastFromFeedRows|east_overrides|applyOverrides|overridesByPerson|todayCentral|shiftAccounting|shiftWeightsOf|previewGen|groupRules/);
  assert.strictEqual(m && m[0], null);
  assert.ok(/callTotalsFor\(/.test(code), "the adapter counts through callTotalsFor");
});
{
  const code = [
    'const vm = require("vm"), fs = require("fs"), path = require("path");',
    'const sb = { console, window: {}, document: undefined, navigator: { userAgent: "node-test" }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, fetch: () => { throw new Error("no fetch"); }, setTimeout, clearTimeout };',
    "sb.globalThis = sb; vm.createContext(sb);",
    'for (const f of ["helpers.js", "east-feed.js", "call-totals.js"]) vm.runInContext(fs.readFileSync(path.join(process.argv[1], f), "utf8"), sb, { filename: f });',
    'const p2 = (n) => String(n).padStart(2, "0"); const local = () => { const d = new Date(); return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()); };',
    'const before = local(); const dev = vm.runInContext("typeof callTotalsDeviceToday === \\"function\\" ? callTotalsDeviceToday() : null", sb); const after = local();',
    'const sh = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));',
    'const cf = vm.runInContext("typeof callTotalsCardFor === \\"function\\" ? callTotalsCardFor : null", sb);',
    'const card = cf ? cf({ feedRows: sh.feedRows, feedState: "ok", idByCode: sh.eastIdByCode, schedule: sh.schedule, scheduleKnown: true, roster: sh.roster, personId: sh.personId, today: sh.today }) : null;',
    'process.stdout.write(JSON.stringify({ tz: process.env.TZ, off: new Date(2026, 9, 24).getTimezoneOffset(), dev, okDev: dev === before || dev === after, card }));',
  ].join("\n");
  const inZone = (TZ) => {
    const r = cp.spawnSync(process.execPath, ["-e", code, ROOT, path.join(ROOT, SHAPES)], { env: Object.assign({}, process.env, { TZ }), encoding: "utf8" });
    if (r.status !== 0) return { err: String(r.stderr || r.error).slice(0, 300) };
    try { return JSON.parse(r.stdout); } catch (e) { return { err: "bad output: " + String(r.stdout).slice(0, 200) }; }
  };
  const chi = inZone("America/Chicago"), tok = inZone("Asia/Tokyo");
  check("T10 the device date: callTotalsDeviceToday() is the device's own local YYYY-MM-DD (children proven in America/Chicago, offset 300, and Asia/Tokyo, offset -540), and the shapes card - its data line's cache date included - is the same text in both zones", () => {
    assert.deepStrictEqual([chi.tz, chi.off, tok.tz, tok.off], ["America/Chicago", 300, "Asia/Tokyo", -540], JSON.stringify({ chi: chi.err, tok: tok.err }));
    assert.ok(chi.okDev === true && tok.okDev === true && /^\d{4}-\d{2}-\d{2}$/.test(String(chi.dev)), "device date: " + JSON.stringify([chi.dev, tok.dev]));
    assert.ok(chi.card && tok.card && chi.card.ok === true, NOA + " " + JSON.stringify({ chi: chi.err, tok: tok.err }));
    assert.ok(canon(chi.card) === canon(tok.card), firstDiff(chi.card, tok.card));
    assert.ok(EC && chi.card.dataLine === EC.dataLine, "data line: " + chi.card.dataLine);
  });
}

console.log("\n[T11] the card model");
const ROW_SPEC = [
  ["silvis-primary", "Silvis primary days", false, false, false], ["silvis-backup", "Silvis backup days", false, false, false],
  ["dav-daycall", "Davenport day-call days", false, false, false], ["dav-nights", "Davenport weeknights", false, false, false],
  ["dav-weekend", "Davenport weekend days", false, false, false], ["dav-holiday", "Davenport holiday days", false, false, false],
  ["dav-backup", "Davenport backup-week days", true, false, false],
  ["dav-backup-daycall", "day call", false, true, false], ["dav-backup-nights", "weeknights", false, true, false],
  ["dav-backup-weekend", "weekend days", false, true, false], ["dav-backup-holiday", "holiday days", false, true, false],
  ["total", "Total call days (both sites)", true, false, true], ["weighted", "Weighted (backup roles count 0.5)", true, false, false],
];
check("T11 the head: title 'My call - Silvis + Davenport', subtitle 'only you see this', today / year / code, the four periods in order (This month, Year to date, Full year, 12 months) with their spans, M/D/YYYY range text and start notes", () => {
  const m = cardFor();
  assert.ok(m && m.ok === true, NOA);
  assert.deepStrictEqual([m.title, m.subtitle, m.today, m.year, m.code], ["My call - Silvis + Davenport", "only you see this", "2026-10-14", 2026, "FAK"]);
  assert.deepStrictEqual(m.periods.map(p => [p.key, p.label, p.from, p.to]), [["month", "This month", "2026-10-01", "2026-10-31"], ["ytd", "Year to date", "2026-01-01", "2026-10-14"], ["year", "Full year", "2026-01-01", "2026-12-31"], ["rolling12", "12 months", "2025-10-15", "2026-10-14"]]);
  assert.deepStrictEqual(m.periods.map(p => [p.rangeText, p.startsNote]), ["month", "ytd", "year", "rolling12"].map(k => [EC.periods[k].rangeText, EC.periods[k].startsNote]));
});
check("T11 the period rows: ids, labels, order and the strong / sub / top flags of the design (3.5); every cell's text - worked, scheduled, total - is the hand-transcribed expectedCells for all four periods ('-' for 0, '7.5' for a half)", () => {
  const m = cardFor();
  assert.ok(m && m.ok === true, NOA);
  assert.deepStrictEqual(periodOf(m, "year").rows.map(r => [r.id, r.label, r.strong, r.sub, r.top]), ROW_SPEC);
  const bad = [];
  ["month", "ytd", "year", "rolling12"].forEach(k => { const got = rowsOf(m, k); if (canon(got) !== canon(EC.periods[k].rows)) bad.push(k + ": " + firstDiff(got, EC.periods[k].rows)); });
  assert.deepStrictEqual(bad, []);
});
check("T11 the backup-week sub rows show only when the period's backup-week days (worked + scheduled) are above 0 and Davenport is known: June 2026 (none) has no sub rows, the year has all four", () => {
  const jun = cardFor({ today: "2026-06-14" });
  assert.ok(jun && jun.ok === true, NOA);
  assert.deepStrictEqual(rowsOf(jun, "month").map(r => r[0]), ["silvis-primary", "silvis-backup", "dav-daycall", "dav-nights", "dav-weekend", "dav-holiday", "dav-backup", "total", "weighted"]);
  assert.deepStrictEqual(rowsOf(jun, "month").find(r => r[0] === "dav-backup"), ["dav-backup", "-", "-", "-"]);
  assert.strictEqual(rowsOf(jun, "year").filter(r => /^dav-backup-/.test(r[0])).length, 4);
});
check("T11 the month list: columns Silvis P / Silvis B / Davenport / Dav. backup / Total / Wtd, Jan..Dec of today's year, ' *' on a month with scheduled days, every cell the hand-transcribed expectedCells (worked + scheduled), and the '*' note", () => {
  const m = cardFor();
  assert.ok(m && m.ok === true, NOA);
  assert.deepStrictEqual(m.monthCols, [{ id: "silvisP", label: "Silvis P" }, { id: "silvisB", label: "Silvis B" }, { id: "dav", label: "Davenport" }, { id: "davB", label: "Dav. backup" }, { id: "total", label: "Total" }, { id: "weighted", label: "Wtd" }]);
  const got = monthsOf(m);
  assert.ok(canon(got) === canon(EC.months), firstDiff(got, EC.months));
  assert.deepStrictEqual(m.months.filter(x => x.pending).map(x => x.month), ["2026-10", "2026-11", "2026-12"]);
  assert.deepStrictEqual(m.monthNotes, EC.monthNotes);
});
check("T11 the hand-transcribed variants: Davenport unknown (the roster still loading) and the Silvis schedule not loaded - the year rows, the month list, the start notes, the notes and the data line", () => {
  const bad = [];
  [["davenportUnknown", { idByCode: null }], ["silvisUnknown", { scheduleKnown: false }]].forEach(([name, over]) => {
    const v = EC[name], m = cardFor(over);
    if (canon(v.set) !== canon(over)) bad.push(name + " fixture set " + JSON.stringify(v.set));
    if (!m || m.ok !== true) { bad.push(name + " " + JSON.stringify(m).slice(0, 120)); return; }
    if (canon(rowsOf(m, "year")) !== canon(v.year)) bad.push(name + " year: " + firstDiff(rowsOf(m, "year"), v.year));
    if (canon(monthsOf(m)) !== canon(v.months)) bad.push(name + " months: " + firstDiff(monthsOf(m), v.months));
    if (canon(m.notes) !== canon(v.notes)) bad.push(name + " notes " + JSON.stringify(m.notes));
    if (m.dataLine !== v.dataLine) bad.push(name + " dataLine " + m.dataLine);
    if (periodOf(m, "rolling12").startsNote !== v.rolling12StartsNote) bad.push(name + " rolling12 note " + periodOf(m, "rolling12").startsNote);
    if (v.ytdStartsNote !== undefined && periodOf(m, "ytd").startsNote !== v.ytdStartsNote) bad.push(name + " ytd note " + periodOf(m, "ytd").startsNote);
  });
  assert.deepStrictEqual(bad, []);
});
check("T11 months before the cache's first Davenport week show ? (Davenport, Dav. backup, Total, Wtd) - never a '-' that reads as no call - with a note naming that week; the start notes name it on the chips; the data line starts there (shapes fixture minus the weeks before 2026-08-31)", () => {
  const v = EC.cacheFrom20260831;
  const m = cardFor({ feedRows: SH.feedRows.filter(r => r.week_monday >= v.dropWeeksBefore) });
  assert.ok(m && m.ok === true, NOA);
  const got = monthsOf(m);
  assert.ok(canon(got) === canon(v.months), firstDiff(got, v.months));
  assert.deepStrictEqual(m.months.filter(x => x.beforeCache).map(x => x.month), ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
  assert.deepStrictEqual([m.monthNotes, periodOf(m, "ytd").startsNote, m.dataLine], [v.monthNotes, v.ytdStartsNote, v.dataLine]);
  assert.deepStrictEqual(m.notes, [], "the cache start is a note on the months and chips, not an unavailable site");
  const mid = cardFor({ feedRows: SH.feedRows.filter(r => r.week_monday >= "2026-09-07") });
  assert.deepStrictEqual(monthsOf(mid).find(x => x[0] === "2026-09").slice(2), ["1", "1", "?", "?", "?", "?"], "a month the cache covers only in part (cache from 9/7) is ?, never an undercount that reads as complete");
  const full = cardFor();
  assert.deepStrictEqual(full.months.filter(x => x.beforeCache), [], "a cache starting before Jan 1 marks no month");
});
check("T11 the data line and the footnote are the transcribed text: data from / to for both sites with the cache's newest published fetched_at (forecast rows' later fetched_at ignored), today's device date in the footnote; no data line date is hard-coded (a cache without fetched_at drops the refresh clause)", () => {
  const m = cardFor();
  assert.ok(m && m.ok === true, NOA);
  assert.deepStrictEqual([m.dataLine, m.footnote, m.notes], [EC.dataLine, EC.footnote, EC.notes]);
  const nf = cardFor({ feedRows: SH.feedRows.map(r => { const x = copy(r); delete x.fetched_at; return x; }) });
  assert.strictEqual(nf.dataLine, "Data: Silvis from 9/14/2026 to 1/3/2027; Davenport from 12/29/2025 to 12/27/2026 (its last published week).");
  const ns = cardFor({ schedule: {} });
  assert.ok(ns.dataLine.startsWith("Data: Silvis: no days on file; Davenport from 12/29/2025"), ns.dataLine);
  assert.ok(/^Worked = on or before 6\/1\/2027 \(this device's date\)/.test(cardFor({ today: "2027-06-01" }).footnote));
});
check("T11 every string of every model state (ok, each unknown state, refusals, the late cache) is ASCII and never says East or DSG (/\\beast\\b|dsg/i), keys included", () => {
  const models = [cardFor(), cardFor({ scheduleKnown: false }), cardFor({ feedRows: SH.feedRows.filter(r => r.week_monday >= "2026-08-31") }), cardFor({ personId: "s9" }), cardFor({ today: "x" })]
    .concat(UNKNOWN_DAV.map(([over]) => cardFor(over.feedRows === "FORECAST_ONLY" ? { feedRows: [] } : Object.assign({}, over))));
  const bad = [];
  models.forEach((m, i) => stringsOf(m).forEach(s => { if (/[^\x00-\x7F]/.test(s) || /\beast\b|dsg/i.test(s)) bad.push(i + ": " + s.slice(0, 80)); }));
  assert.ok(models[0] && models[0].ok === true, NOA);
  assert.deepStrictEqual(bad, []);
});

// ======================================================================================================================
// T12 (step B5) - the docs are part of the contract: Faraz reads the build guide, the rules doc and ONBOARDING. Pinned only
// on what must STAY true (the P15 docs-pin rule in data-layer.test.js): the headings, the names a reader greps for, the
// port commit (the same as call-totals.js's header - a re-port updates both), the card's "?" reasons (the same strings as
// the adapter's), the guide's runtime-module list (= the ?v= loader list) - never dates, live counts or wording beyond
// those. CLAUDE.md is Faraz's own file: it is not pinned here (its module and suite lists are his to update).
// The section NUMBER is not pinned (B5 review, 10/14): Prompt 32 appends its own section after section 22 and merges
// first, so at the rebase this section becomes the next free number. Every check reads the number off the heading found
// by its title, and the guide's "## <n>." numbers must be unique and ascending - a rebase that keeps two section 23s, or
// renumbers the heading but leaves a stale pointer (guide 2 / 7, an internal "<n>.<k>", the rules doc, HISTORY), fails
// here. Nor does any statement here hold the rest of Silvis unweighted: Prompt 32 weights the Silvis load
// (groupRules.shiftAccounting.weights); the card's 0.5 is its own constant and reads none of it.
console.log("\n[T12] docs: the build guide, the rules doc, HISTORY and ONBOARDING");
{
  const readDoc = (p) => (fs.existsSync(path.join(ROOT, p)) ? readRoot(p) : "");
  const guide = readDoc("docs/SILVIS-BUILD-GUIDE.md"), rulesDoc = readDoc("docs/SILVIS-CALL-RULES.md");
  const onboarding = readDoc("docs/ONBOARDING.md"), historyDoc = readDoc("docs/HISTORY.md");
  // h2(text, head): the section from "\n" + head to the next "\n## " (or the end), "" when the heading is missing
  const h2 = (t, head) => { const i = t.indexOf("\n" + head); if (i < 0) return ""; const j = t.indexOf("\n## ", i + 1); return t.slice(i, j < 0 ? t.length : j); };
  // the guide's numbered sections in file order; this one found by its TITLE, its number N read off the heading (23 on
  // this base, the next free number after the rebase onto Prompt 32) - never a literal 23 below
  const TITLE = "My call - Silvis + Davenport";
  const HEADINGS = [...guide.matchAll(/^## (\d+)\. (.*)$/gm)].map(m => ({ n: Number(m[1]), title: m[2] }));
  const MINE = HEADINGS.filter(h => h.title.startsWith(TITLE));
  const N = MINE.length === 1 ? MINE[0].n : NaN;
  const secN = MINE.length === 1 ? h2(guide, "## " + N + ". " + TITLE) : "";
  const flat = (t) => t.replace(/\s+/g, " ");
  const sectRefs = (t) => (t.match(/§\d+(?:\.\d+)?/g) || []);  // every "§<n>" / "§<n>.<k>" in a text
  // a statement that holds the REST of Silvis unweighted - true before Prompt 32, false after it (it weights the Silvis load
  // in groupRules.shiftAccounting.weights); the card's text says what the card reads (none of that), never what the rest weighs
  const UNWEIGHTED = /\bunweighted\b|nothing (?:else )?(?:is )?weighted|never weighted|no weighted burden/i;
  const loaderModules = (() => {
    const m = readRoot("index-source.html").match(/\[('[^\]]+')\]\.forEach\(function\(f\) \{\s*document\.write\('<script src="'\+f\+'\?v='/);
    return m ? m[1].split(",").map(s => s.trim().replace(/^'|'$/g, "")).filter(f => !f.startsWith("vendor/")) : [];
  })();
  // the card's unknown-state reasons, as the adapter writes them (design D8 / 3.3)
  const REASONS = ["the Davenport cache is still loading", "the Davenport cache could not be read", "no Davenport weeks are cached yet",
    "the Davenport roster is still loading", "the Davenport roster could not be read", "is not in the Davenport roster", "the Silvis schedule is not loaded"];
  check("T12 guide: the '## <n>.' section numbers are unique and ascending; exactly one is '" + TITLE + "' (section " + N + "), directly after section " + (N - 1) + " (22 or later), with the sub-headings " + N + ".1 .. " + N + ".6 in order and every internal '<n>.<k>' pointer its own number", () => {
    assert.strictEqual(MINE.length, 1, "exactly one '## <n>. " + TITLE + "' heading in the guide (found " + MINE.length + ")");
    const nums = HEADINGS.map(h => h.n);
    const dups = nums.filter((n, i) => nums.indexOf(n) !== i);
    assert.deepStrictEqual(dups, [], "each '## <n>.' number appears ONCE in the guide - rebased onto another prompt's section " + N + ", renumber this one to the next free number with its pointers (guide 2 / 7, its own <n>.<k>, the rules doc's section 6 bullet, HISTORY)");
    nums.forEach((n, i) => assert.ok(i === 0 || n > nums[i - 1], "the guide's section numbers ascend ('## " + n + ".' follows '## " + nums[i - 1] + ".')"));
    const at = HEADINGS.indexOf(MINE[0]);
    assert.ok(N >= 23 && at > 0 && HEADINGS[at - 1].n === N - 1, "section " + N + " must directly follow section " + (N - 1) + " (after 22, phone push)");
    const HEADS = ["One counting definition", "Units, periods and today", "Published data only", "Who sees the card", "Item 7", "Tests and the ship"].map((t, i) => "### " + N + "." + (i + 1) + " " + t);
    let last = -1;
    HEADS.forEach(h => { const i = secN.indexOf("\n" + h); assert.ok(i > last, "sub-heading '" + h + "' missing or out of order"); last = i; });
    const stale = (secN.match(/(?<![\d.\/:-])\d{2}\.[1-9](?!\d)/g) || []).filter(r => Number(r.split(".")[0]) !== N);
    assert.deepStrictEqual(stale, [], "section " + N + "'s internal pointers ('<n>.<k>') must name section " + N);
  });
  check("T12 guide " + N + " names the port (call-totals.js, the commit call-totals.js's header names, verbatim, the parity contract, the re-port rule, CT_REQUIRE_CLONE), the units and the fixed 0.5 (never reading groupRules.shiftAccounting, never holding the rest of Silvis unweighted), the device date, the gate, every '?' reason verbatim, the months before the cache, the crash-safe call, the item 7 window and the Refresh after the ship", () => {
    const hdr = /PORTED VERBATIM from the Davenport app \(github\.com\/fkhan628\/Call-Schedule-App\) at commit ([0-9a-f]{7,40})\b/.exec(MOD);
    assert.ok(hdr && hdr[1] === PORT_COMMIT, "call-totals.js's header names the port commit " + PORT_COMMIT);
    const s = flat(secN);
    ["`call-totals.js`", "commit " + PORT_COMMIT, "verbatim", "PARITY CONTRACT", "re-port", "CT_REQUIRE_CLONE=1", "test/fixtures/call-totals-card-synthetic-2026-10-14.json",
      "Stats > Billing", "0.5", "shiftAccounting", "one shift", "callTotalsDeviceToday", "device date", "callTotalsShown", "eastVacationPerson", "pid === mySurgeon",
      "callTotalsCardFor", "crash", "efIsForecastRow", "east_forecast", "east_overrides", "previewGen", "before the first cached Davenport week",
      "eastRefreshWindows", "eastExtraWeeks", "EAST_AHEAD_DAYS", "contiguous", "keepCachedVacations", "Refresh from Davenport", "?public=1", "\"East\"", "\"DSG\""]
      .forEach(w => assert.ok(s.includes(w), "section " + N + " must name " + JSON.stringify(w)));
    REASONS.forEach(r => {
      assert.ok(MOD.includes(r), "call-totals.js no longer writes the reason " + JSON.stringify(r) + " - update the list here and guide " + N + " together");
      assert.ok(s.includes(r), "section " + N + " must list the reason " + JSON.stringify(r) + " verbatim");
    });
    assert.ok(/never reads `groupRules\.shiftAccounting`/.test(s), "section " + N + " must say call-totals.js never reads `groupRules.shiftAccounting` (the Silvis shift accounting - Prompt 32's weights): the card's 0.5 is its own");
    assert.ok(!UNWEIGHTED.test(s), "section " + N + " must not hold the rest of Silvis unweighted (" + (s.match(UNWEIGHTED) || [""])[0] + ") - false once Prompt 32 weights the Silvis load; say the card reads none of it");
    assert.ok(!/\bNOT applied\b|not live yet|not pushed yet/i.test(s), "worded true before and after the ship (no 'not applied / not live yet / not pushed yet')");
  });
  check("T12 guide: section 11's runtime inputs name exactly the ?v= loader modules (call-totals.js included), section 2's dropped-constants line says where NIGHT_KEYS lives now (pointing at section " + N + " only), and section 7's refresh-windows bullet points at " + N + ".5 (and section " + N + " only)", () => {
    assert.ok(loaderModules.includes(MODULE) && loaderModules.includes("helpers.js"), "loader list read: " + JSON.stringify(loaderModules));
    const s11 = flat(h2(guide, "## 11. Build & deploy"));
    const m = /the `\?v=` loader modules \(([^)]*)\)/.exec(s11);
    assert.ok(m, "section 11's runtime-input sentence lists 'the `?v=` loader modules (...)'");
    const named = (m[1].match(/`[^`]+`/g) || []).map(x => x.slice(1, -1));
    assert.deepStrictEqual(named.slice().sort(), loaderModules.slice().sort(), "section 11's loader modules = index-source.html's ?v= list (vendor aside)");
    const s2 = flat(h2(guide, "## 2. Repo layout"));
    assert.ok(/NIGHT_KEYS[^.]*call-totals\.js/.test(s2), "section 2's dropped-constants sentence must say call-totals.js carries NIGHT_KEYS (the verbatim port only)");
    const p2 = /Prompt 31 Part B: the Davenport `NIGHT_KEYS`[^)]*\)/.exec(s2);
    const r2 = p2 ? sectRefs(p2[0]) : [];
    assert.ok(r2.length > 0 && r2.every(r => r === "§" + N), "section 2's Part B note must point at §" + N + " only (found " + JSON.stringify(r2) + ")");
    const b7 = h2(guide, "## 7. East feed").split(/\n(?=- )/).filter(b => b.startsWith("- **Refresh windows (Prompt 31 item 7"));
    assert.strictEqual(b7.length, 1, "section 7 has one '- **Refresh windows (Prompt 31 item 7' bullet");
    const r7 = sectRefs(b7[0]);
    assert.ok(b7[0].includes("eastRefreshWindows") && r7.includes("§" + N + ".5") && r7.every(r => r === "§" + N || r.startsWith("§" + N + ".")),
      "section 7's refresh-windows bullet must point at §" + N + ".5 (eastRefreshWindows) and section " + N + " only (found " + JSON.stringify(r7) + ")");
  });
  check("T12 rules doc section 6: one bullet says the card's weighted total is display only - its 0.5 the card's own, never reading groupRules.shiftAccounting, nothing (generator, shares, caps, Totals, pay) reading the card, a Silvis day one shift - pointing at build guide section " + N + " only and never holding the rest of Silvis unweighted; section 1's shift-accounting row still opens 'Each 24-hour day is one shift. No half-days,'", () => {
    const s6 = h2(rulesDoc, "## 6. Fairness model");
    assert.ok(s6.length > 0, "rules doc section 6 not found");
    const bullets = s6.split(/\n(?=- )/).filter(b => b.startsWith("- ") && /My call - Silvis \+ Davenport/.test(b));
    assert.strictEqual(bullets.length, 1, "exactly one section 6 bullet names the card");
    const b = flat(bullets[0].split("\n\n")[0]);
    ["display only", "0.5", "Davenport", "generator", "caps", "Totals", "pay", "one shift", "build guide §" + N].forEach(w => assert.ok(b.includes(w), "the bullet must say " + JSON.stringify(w)));
    const gRefs = (b.match(/build guide §\d+/g) || []);
    assert.ok(gRefs.every(r => r === "build guide §" + N), "the bullet's build-guide pointers must name section " + N + " only (found " + JSON.stringify(gRefs) + ")");
    assert.ok(/never reads `groupRules\.shiftAccounting`/.test(b), "the bullet must say the card never reads `groupRules.shiftAccounting` (the Silvis shift accounting - Prompt 32's weights)");
    assert.ok(!UNWEIGHTED.test(b), "the bullet must not hold the rest of Silvis unweighted (" + (b.match(UNWEIGHTED) || [""])[0] + ") - false once Prompt 32 weights the Silvis load");
    // pin moved deliberately 10/13: Prompt 31 Part B B5 review (10/14) - Prompt 32 strikes "no weighted burden" in this row
    // and merges first; only what both prompts keep is pinned (it was "... No half-days, no weighted burden")
    assert.ok(/^\| Shift accounting \| \*\*Each 24-hour day is one shift\.\*\* No half-days,/m.test(rulesDoc), "section 1's shift-accounting row still opens 'Each 24-hour day is one shift. No half-days,'");
  });
  check("T12 HISTORY: the Part B design row points at guide section " + N + " (renumbered with the section)", () => {
    const rows = historyDoc.split("\n").filter(l => l.includes("PART-B-DESIGN.md"));
    assert.strictEqual(rows.length, 1, "exactly one HISTORY row names PART-B-DESIGN.md");
    const refs = (rows[0].match(/guide section \d+/g) || []);
    assert.ok(refs.length > 0 && refs.every(r => r === "guide section " + N), "the row must point at 'guide section " + N + "' only (found " + JSON.stringify(refs) + ")");
  });
  check("T12 ONBOARDING: one paragraph for the person with an East code - the card in Mine, worked / scheduled, published days only, '?' never zero, nobody else sees it, and the one Refresh from Davenport after the ship - apart from the East vacations paragraph", () => {
    const paras = onboarding.split("\n\n").filter(p => /\*\*My call - Silvis \+ Davenport/.test(p));
    assert.strictEqual(paras.length, 1, "exactly one ONBOARDING paragraph leads with **My call - Silvis + Davenport");
    const p = flat(paras[0]);
    ["East code", "Khan today", "**Mine**", "worked", "scheduled", "published", "?", "never zero", "0.5", "office", "public", "Refresh from Davenport"].forEach(w => assert.ok(p.includes(w), "the paragraph must say " + JSON.stringify(w)));
    assert.ok(!/\*\*East vacations/.test(paras[0]), "not inside the East vacations paragraph (data-layer P15 reads the first paragraph with that lead-in)");
  });
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
