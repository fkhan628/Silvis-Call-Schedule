// Silvis Call Schedule - buildWeekRows / slotIsOpen / todayCentral (helpers.js) unit test.
// the ER-panel author's ER Call Panels layout: one row per Mon-Sun week, "M/D Name"
// entries, same-surgeon consecutive days collapsed to "M/D-M/D Name", OPEN
// days each listed in red, externalCover days as "M/D Atwell".
// An unassigned slot is OPEN only from today (Central) forward; before today
// it produces NO entry (Faraz 9/22). Every fixture below passes an explicit
// opts.today so the suite never depends on the wall clock; one check covers
// the default (todayCentral) path with a 2020 and a 2099 fixture.
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

const TODAY_OCT = "2026-10-01"; // fixed "today" for the October fixtures: every October day is today or later
const rows = H.buildWeekRows(schedule, roster, "2026-10-01", "2026-10-31", { today: TODAY_OCT });
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
  const r = H.buildWeekRows(s, roster, "2026-11-02", "2026-11-08", { today: "2026-11-01" })[0];
  assert.deepStrictEqual(r.primary.map(e => e.text), ["11/2 Burchett", "11/3 OPEN", "11/4 Burchett", "11/5 OPEN", "11/6 OPEN", "11/7 OPEN", "11/8 OPEN"]);
});
check("clipToRange keeps only in-range days (first week of October starts at 10/1)", () => {
  const clipped = H.buildWeekRows(schedule, roster, "2026-10-01", "2026-10-31", { clipToRange: true, today: TODAY_OCT });
  assert.deepStrictEqual(clipped[0].days, ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  assert.deepStrictEqual(clipped[0].primary.map(e => e.text), ["10/1-10/4 Atwell"]);
  assert.deepStrictEqual(clipped[clipped.length - 1].days, ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]);
});
check("unknown roster ids fall back to the id; an invalid or reversed range returns []", () => {
  const r = H.buildWeekRows({ "2026-11-02": day("s9", null) }, roster, "2026-11-02", "2026-11-02", { clipToRange: true, today: "2026-11-01" })[0];
  assert.strictEqual(r.primary[0].text, "11/2 s9");
  assert.deepStrictEqual(H.buildWeekRows(schedule, roster, "2026-10-31", "2026-10-01", { today: TODAY_OCT }), []);
  assert.deepStrictEqual(H.buildWeekRows(schedule, roster, "nope", "2026-10-01", { today: TODAY_OCT }), []);
  assert.deepStrictEqual(H.buildWeekRows(null, null, "2026-10-05", "2026-10-05", { clipToRange: true, today: TODAY_OCT })[0].primary.map(e => e.text), ["10/5 OPEN"]);
});
check("pure: the input schedule is not mutated", () => {
  const before = JSON.stringify(schedule);
  H.buildWeekRows(schedule, roster, "2026-09-01", "2026-12-31", { today: TODAY_OCT });
  assert.strictEqual(JSON.stringify(schedule), before);
});

/* ---- Item Q (Faraz 9/22): OPEN only from today (Central) forward ---- */
check("slotIsOpen: an empty holder is open today (inclusive) and later, never before today; any holder (roster id, ext:) is never open", () => {
  assert.strictEqual(typeof H.slotIsOpen, "function", "helpers.js must export slotIsOpen");
  assert.strictEqual(H.slotIsOpen("2026-10-08", null, "2026-10-08"), true, "today is inclusive");
  assert.strictEqual(H.slotIsOpen("2026-10-09", undefined, "2026-10-08"), true);
  assert.strictEqual(H.slotIsOpen("2026-10-09", "", "2026-10-08"), true);
  assert.strictEqual(H.slotIsOpen("2026-10-07", null, "2026-10-08"), false, "yesterday is blank, not OPEN");
  assert.strictEqual(H.slotIsOpen("2025-12-31", null, "2026-10-08"), false);
  assert.strictEqual(H.slotIsOpen("2026-10-09", "s1", "2026-10-08"), false, "a roster holder is not open");
  assert.strictEqual(H.slotIsOpen("2026-10-09", "ext:Atwell", "2026-10-08"), false, "an external cover is a holder");
  assert.strictEqual(H.slotIsOpen("2026-10-07", "s1", "2026-10-08"), false);
});
check("todayCentral: 'YYYY-MM-DD' in America/Chicago (the bump-version.js expression); slotIsOpen falls back to it when today is missing or malformed", () => {
  assert.strictEqual(typeof H.todayCentral, "function", "helpers.js must export todayCentral");
  const t = H.todayCentral();
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(t), "not an ISO day: " + t);
  assert.strictEqual(t, new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }));
  assert.strictEqual(H.slotIsOpen("2020-01-06", null), false, "2020 is in the past under the default today");
  assert.strictEqual(H.slotIsOpen("2099-01-05", null), true, "2099 is in the future under the default today");
  assert.strictEqual(H.slotIsOpen("2020-01-06", null, "nope"), false, "a malformed today falls back to todayCentral()");
  assert.strictEqual(H.slotIsOpen("2099-01-05", null, "nope"), true);
  assert.strictEqual(H.slotIsOpen(t, null), true, "today itself is open under the default");
});
check("buildWeekRows opts.today: a past unassigned day produces NO entry; today and later stay 'M/D OPEN'; assigned past days stay listed; a same-surgeon run across the boundary stays collapsed (week of 10/5, today 10/10)", () => {
  const r = H.buildWeekRows(schedule, roster, "2026-10-05", "2026-10-11", { today: "2026-10-10" })[0];
  assert.deepStrictEqual(r.primary.map(e => e.text), ["10/5 Acton", "10/6 Burchett", "10/7 Acton", "10/8 Philip", "10/9-10/11 Acton"], "assigned past days are unchanged and the 10/9-10/11 run spans today unbroken");
  assert.deepStrictEqual(r.backup.map(e => e.text), ["10/5 Philip", "10/6 Acton", "10/8 Acton", "10/10 OPEN", "10/11 OPEN"], "10/7 and 10/9 (open, past) vanish; 10/10 (today) and 10/11 stay OPEN");
  assert.deepStrictEqual(r.days, ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"], "the row still lists all seven days");
  r.backup.filter(e => e.name === "OPEN").forEach(e => assert.strictEqual(e.kind, "open"));
});
check("buildWeekRows opts.today: the 10/15 open primary is listed when today is 10/15 (inclusive) and absent when today is 10/16", () => {
  const on = H.buildWeekRows(schedule, roster, "2026-10-12", "2026-10-18", { today: "2026-10-15" })[0];
  assert.deepStrictEqual(on.primary.map(e => e.text), ["10/12 Fierce", "10/13 Philip", "10/14 Burchett", "10/15 OPEN", "10/16-10/18 Philip"]);
  const after = H.buildWeekRows(schedule, roster, "2026-10-12", "2026-10-18", { today: "2026-10-16" })[0];
  assert.deepStrictEqual(after.primary.map(e => e.text), ["10/12 Fierce", "10/13 Philip", "10/14 Burchett", "10/16-10/18 Philip"]);
  assert.deepStrictEqual(after.backup.map(e => e.text), ["10/12 Burchett", "10/14 Philip", "10/16 OPEN", "10/17 OPEN", "10/18 OPEN"], "past open backups 10/13 and 10/15 vanish");
});
check("buildWeekRows opts.today: same-surgeon collapsing does not bridge a blank (past, unassigned) day; a past external cover stays listed", () => {
  const s = { "2026-11-02": day("s2", null), "2026-11-04": day("s2", null), "2026-11-05": day(null, "s5", { externalCover: "Atwell" }) };
  const r = H.buildWeekRows(s, roster, "2026-11-02", "2026-11-08", { today: "2026-11-06" })[0];
  assert.deepStrictEqual(r.primary.map(e => e.text), ["11/2 Burchett", "11/4 Burchett", "11/5 Atwell", "11/6 OPEN", "11/7 OPEN", "11/8 OPEN"]);
  assert.strictEqual(r.primary[2].kind, "external");
  assert.deepStrictEqual(r.backup.map(e => e.text), ["11/5 Fierce", "11/6 OPEN", "11/7 OPEN", "11/8 OPEN"]);
  const wholeWeekPast = H.buildWeekRows({}, roster, "2026-11-02", "2026-11-08", { today: "2026-11-09" })[0];
  assert.deepStrictEqual(wholeWeekPast.primary, []); assert.deepStrictEqual(wholeWeekPast.backup, []);
  assert.strictEqual(wholeWeekPast.label, "11/2 - 11/8", "the row itself is still produced");
});
check("buildWeekRows default today (none given): a 2020 fixture week is blank, a 2099 week lists seven OPEN days", () => {
  const past = H.buildWeekRows({}, roster, "2020-01-06", "2020-01-12", { clipToRange: true })[0];
  assert.deepStrictEqual(past.primary, []); assert.deepStrictEqual(past.backup, []);
  const future = H.buildWeekRows({}, roster, "2099-01-05", "2099-01-11", { clipToRange: true })[0];
  assert.strictEqual(future.primary.length, 7); assert.strictEqual(future.backup.length, 7);
  assert.ok(future.primary.every(e => e.kind === "open" && /^1\/\d+ OPEN$/.test(e.text)));
  const malformed = H.buildWeekRows({}, roster, "2020-01-06", "2020-01-12", { clipToRange: true, today: "yesterday" })[0];
  assert.deepStrictEqual(malformed.primary, [], "a malformed today falls back to todayCentral()");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
