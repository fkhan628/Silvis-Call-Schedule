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

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
