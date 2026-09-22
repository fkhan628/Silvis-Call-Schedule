// Silvis Call Schedule - buildWeekRows (helpers.js) unit test.
// the ER-panel author's ER Call Panels layout: one row per Mon-Sun week, "M/D Name"
// entries, same-surgeon consecutive days collapsed to "M/D-M/D Name", OPEN
// days each listed in red, externalCover days as "M/D Atwell".
// Run: node test/week-rows.test.js   (exit 1 on any failure)
const assert = require("assert");
const path = require("path");
const H = require(path.join(__dirname, "..", "helpers.js"));

let passed = 0, failed = 0;
const check = (name, fn) => {
  try { fn(); passed++; console.log("ok   " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n     " + (e && e.message || e)); }
};

const roster = [
  { id: "s1", name: "Khan", code: "FAK" }, { id: "s2", name: "Burchett", code: "MAB" }, { id: "s3", name: "Acton", code: "BDA" },
  { id: "s4", name: "Philip", code: "AFP" }, { id: "s5", name: "Fierce", code: "NF" }, { id: "s6", name: "Sarkar", code: "SRK" },
];
const day = (primary, backup, extra) => Object.assign({ primary: primary || null, backup: backup || null, primaryLocked: false, backupLocked: false, source: "import", externalCover: null, note: null }, extra || {});

// The imported shape around the Sep/Oct boundary (docs/silvis-seed.json section 7).
const schedule = {
  "2026-09-28": day(null, "s5", { externalCover: "Atwell" }), "2026-09-29": day(null, "s5", { externalCover: "Atwell" }),
  "2026-09-30": day(null, "s5", { externalCover: "Atwell" }), "2026-10-01": day(null, "s5", { externalCover: "Atwell" }),
  "2026-10-02": day(null, "s5", { externalCover: "Atwell" }), "2026-10-03": day(null, "s5", { externalCover: "Atwell" }),
  "2026-10-04": day(null, "s5", { externalCover: "Atwell" }),
  "2026-10-05": day("s3", "s4"), "2026-10-06": day("s2", "s3"), "2026-10-07": day("s3", null), "2026-10-08": day("s4", "s3"),
  "2026-10-09": day("s3", null), "2026-10-10": day("s3", null), "2026-10-11": day("s3", null),
  "2026-10-12": day("s5", "s2"), "2026-10-13": day("s4", null), "2026-10-14": day("s2", "s4"), "2026-10-15": day(null, null),
  "2026-10-16": day("s4", null), "2026-10-17": day("s4", null), "2026-10-18": day("s4", null),
};

const rows = H.buildWeekRows(schedule, roster, "2026-10-01", "2026-10-31");
const byMonday = {}; rows.forEach(r => { byMonday[r.monday] = r; });

check("boundaries: October 2026 yields the 5 Mon-Sun weeks that intersect it, partial weeks included", () => {
  assert.deepStrictEqual(rows.map(r => r.monday), ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
  assert.strictEqual(rows[0].sunday, "2026-10-04");
  assert.strictEqual(rows[4].sunday, "2026-11-01");
  assert.strictEqual(rows[0].label, "9/28 - 10/4");
  rows.forEach(r => assert.strictEqual(r.days.length, 7, "a full week per row by default"));
});
check("externalCover week collapses to '9/28-10/4 Atwell' in primary; the backup collapses to '9/28-10/4 Fierce'", () => {
  const r = byMonday["2026-09-28"];
  assert.deepStrictEqual(r.primary.map(e => e.text), ["9/28-10/4 Atwell"]);
  assert.strictEqual(r.primary[0].kind, "external");
  assert.deepStrictEqual(r.backup.map(e => e.text), ["9/28-10/4 Fierce"]);
  assert.strictEqual(r.backup[0].id, "s5");
});
check("collapsing: consecutive same-surgeon days merge, different surgeons stay separate (week of 10/5)", () => {
  const r = byMonday["2026-10-05"];
  assert.deepStrictEqual(r.primary.map(e => e.text), ["10/5 Acton", "10/6 Burchett", "10/7 Acton", "10/8 Philip", "10/9-10/11 Acton"]);
  const last = r.primary[r.primary.length - 1];
  assert.strictEqual(last.start, "2026-10-09"); assert.strictEqual(last.end, "2026-10-11"); assert.strictEqual(last.kind, "surgeon");
});
check("OPEN days never collapse: each open backup day is its own 'M/D OPEN' entry", () => {
  const r = byMonday["2026-10-05"];
  assert.deepStrictEqual(r.backup.map(e => e.text), ["10/5 Philip", "10/6 Acton", "10/7 OPEN", "10/8 Acton", "10/9 OPEN", "10/10 OPEN", "10/11 OPEN"]);
  r.backup.filter(e => e.name === "OPEN").forEach(e => assert.strictEqual(e.kind, "open"));
});
check("the one open primary (10/15) shows as '10/15 OPEN' between Burchett and a collapsed Philip run", () => {
  const r = byMonday["2026-10-12"];
  assert.deepStrictEqual(r.primary.map(e => e.text), ["10/12 Fierce", "10/13 Philip", "10/14 Burchett", "10/15 OPEN", "10/16-10/18 Philip"]);
});
check("days with no schedule row read as OPEN (week of 10/19 has no rows here)", () => {
  const r = byMonday["2026-10-19"];
  assert.strictEqual(r.primary.length, 7);
  assert.ok(r.primary.every(e => e.kind === "open" && /^10\/\d+ OPEN$/.test(e.text)));
  assert.strictEqual(r.backup.length, 7);
});
check("a run is not merged across a non-adjacent gap and a primary beats a stale externalCover on the same day", () => {
  const s = { "2026-11-02": day("s2", null), "2026-11-04": day("s2", null, { externalCover: "Atwell" }) };
  const r = H.buildWeekRows(s, roster, "2026-11-02", "2026-11-08")[0];
  assert.deepStrictEqual(r.primary.map(e => e.text), ["11/2 Burchett", "11/3 OPEN", "11/4 Burchett", "11/5 OPEN", "11/6 OPEN", "11/7 OPEN", "11/8 OPEN"]);
});
check("clipToRange keeps only in-range days (first week of October starts at 10/1)", () => {
  const clipped = H.buildWeekRows(schedule, roster, "2026-10-01", "2026-10-31", { clipToRange: true });
  assert.deepStrictEqual(clipped[0].days, ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  assert.deepStrictEqual(clipped[0].primary.map(e => e.text), ["10/1-10/4 Atwell"]);
  assert.deepStrictEqual(clipped[clipped.length - 1].days, ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]);
});
check("unknown roster ids fall back to the id; an invalid or reversed range returns []", () => {
  const r = H.buildWeekRows({ "2026-11-02": day("s9", null) }, roster, "2026-11-02", "2026-11-02", { clipToRange: true })[0];
  assert.strictEqual(r.primary[0].text, "11/2 s9");
  assert.deepStrictEqual(H.buildWeekRows(schedule, roster, "2026-10-31", "2026-10-01"), []);
  assert.deepStrictEqual(H.buildWeekRows(schedule, roster, "nope", "2026-10-01"), []);
  assert.deepStrictEqual(H.buildWeekRows(null, null, "2026-10-05", "2026-10-05", { clipToRange: true })[0].primary.map(e => e.text), ["10/5 OPEN"]);
});
check("pure: the input schedule is not mutated", () => {
  const before = JSON.stringify(schedule);
  H.buildWeekRows(schedule, roster, "2026-09-01", "2026-12-31");
  assert.strictEqual(JSON.stringify(schedule), before);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
