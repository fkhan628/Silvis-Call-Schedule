// Silvis - holiday unit builder + Monday-minor engine proof (Prompt 12 U,
// Faraz 9/22 evening: "A minor holiday that falls on a Monday absorbs the
// weekend before it: the unit is Sat-Mon; the Friday stays a standalone
// weekend day (the reduced weekend unit)").
// Plain Node asserts like the other suites; exits 1 on the first failure and
// prints 'ok <n> assertions' on success. Wired into `npm test` (package.json).
//
// Section A - ENGINE PROOF (seed + rules.js + generator.js only, no builder):
//   the seed's 2027 Memorial Day / Labor Day units are Sat-Mon, the Friday
//   before each is NOT a unit day (the reduced weekend unit), July 4 2027 (a
//   Sunday) stays its own day; a generator run over each unit holds ONE
//   primary and ONE backup through all three days and lists the Friday as a
//   reduced weekend unit of its own (diagnostics.weekendUnits: present = [Fri],
//   preempted = [Sat, Sun], reduced = true - the generator's real shape; there
//   is no `days` key on a weekend unit).
// Section B - BUILDER: helpers.defaultHolidayUnits(year, opts) returns the six
//   units in the seed's shape and order; a MINOR holiday on a Monday absorbs
//   the weekend before it only when opts.mondayMinorAbsorbsWeekend === true;
//   tiers come from opts.tiers (the seed's holidays.rules.tiers shape).
// Section C - PIN: the builder for 2027 (seed flag + seed tiers) deep-equals
//   the seed's holidays.units["2027"], and 2026 stays as built before the rule.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const R = require("../rules.js");
const GEN = require("../generator.js");
const H = require("../helpers.js");
const SA = require("./seed-adapter.js");

const t0 = Date.now();
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs", "silvis-seed.json"), "utf8"));

let N = 0;
let current = "";
function step(name) { current = name; }
function fail(msg) { console.error("FAIL [" + current + "]: " + msg); process.exit(1); }
function ok(cond, msg) { N++; if (!cond) fail(msg || "expected truthy"); }
function eq(a, b, msg) { N++; try { assert.deepStrictEqual(a, b); } catch (e) { fail((msg || "") + " expected " + JSON.stringify(b) + " got " + JSON.stringify(a)); } }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function byName(units, name) { return (units || []).find((u) => u.name === name) || null; }
// independent weekday arithmetic (UTC; never the local-time Date parser)
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function dow(iso) { return DOW[new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))).getUTCDay()]; }
function plusDays(iso, n) { const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000); return d.toISOString().slice(0, 10); }

const ORDER = ["Memorial Day", "July 4th", "Labor Day", "Thanksgiving", "Christmas", "New Year's"];
const MEMORIAL_27 = ["2027-05-29", "2027-05-30", "2027-05-31"];
const LABOR_27 = ["2027-09-04", "2027-09-05", "2027-09-06"];

/* =================================================================== A */
// ctx exactly the way rules.test.js builds it (seed adapter + the synthetic East inputs).
const EAST_COVER = { from: "2026-11-01", to: "2027-01-31" };
const DERIVED = [
  { weekMonday: "2026-11-09", surgeonId: "s5", silvisRole: "backup" },
  { weekMonday: "2026-12-07", surgeonId: "s5", silvisRole: "primary" }
];
function makeCtx(extras) {
  return R.buildContext(SA.seedToContextInput(seed, Object.assign({ eastDerived: DERIVED, eastFeedCoverage: EAST_COVER, eastBusyDays: {} }, extras || {})));
}

step("A1: seed -> ctx: Memorial Day 2027 is Sat 5/29 - Mon 5/31 (minor); Fri 5/28 is not a unit day");
const ctx = makeCtx();
eq(ctx.warnings, [], "buildContext warnings");
const flat = (units) => units.map((u) => ({ name: u.name, tier: u.tier, days: u.days }));
eq(flat(R.holidayUnits(ctx, "2027-05-01", "2027-06-30")), [{ name: "Memorial Day", tier: "minor", days: MEMORIAL_27 }], "holidayUnits May-June 2027");
eq(ctx.holidayByDay["2027-05-28"], undefined, "Fri 2027-05-28 must be free (the reduced weekend unit)");
MEMORIAL_27.forEach((d) => ok(ctx.holidayByDay[d] && ctx.holidayByDay[d].name === "Memorial Day", d + " belongs to the Memorial Day unit"));

step("A2: seed -> ctx: Labor Day 2027 is Sat 9/4 - Mon 9/6 (minor); Fri 9/3 is not a unit day");
eq(flat(R.holidayUnits(ctx, "2027-08-01", "2027-09-30")), [{ name: "Labor Day", tier: "minor", days: LABOR_27 }], "holidayUnits Aug-Sep 2027");
eq(ctx.holidayByDay["2027-09-03"], undefined, "Fri 2027-09-03 must be free (the reduced weekend unit)");

step("A3: seed -> ctx: July 4 2027 (a Sunday) stays its own day; the milestone-range units are untouched");
eq(flat(R.holidayUnits(ctx, "2027-07-01", "2027-07-31")), [{ name: "July 4th", tier: "minor", days: ["2027-07-04"] }], "holidayUnits July 2027");
eq(ctx.holidayByDay["2027-07-03"], undefined, "Sat 2027-07-03 is not a unit day");
eq(ctx.holidayByDay["2027-07-05"], undefined, "Mon 2027-07-05 is not a unit day");
eq(flat(R.holidayUnits(ctx, "2026-11-02", "2027-01-03")), [
  { name: "Thanksgiving", tier: "major", days: ["2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"] },
  { name: "Christmas", tier: "major", days: ["2026-12-24", "2026-12-25"] },
  { name: "New Year's", tier: "major", days: ["2026-12-31", "2027-01-01"] }
], "milestone range 2026-11-02 -> 2027-01-03: the three 2026 major units, byte-identical");

// A generator run over a Sat-Mon unit: one primary + one backup through all three
// days; the Friday before is a reduced weekend unit of its own.
function proveUnit(label, start, end, unitDays, friday, unitName) {
  step(label);
  const c = makeCtx({ schedule: {} });                                   // no locks anywhere
  // 1500 ms per call x 2 calls < the file limit (4000 ms default), so the generator's own budget trips first under load
  const out = GEN.generate(c, start, end, { seed: 3, bestOf: 4, timeBudgetMs: 1500 });
  const S = out.schedule, D = out.diagnostics;
  unitDays.concat([friday]).forEach((d) => ok(S[d], d + " is in the generated range"));
  const openOn = D.uncovered.filter((u) => unitDays.indexOf(u.day) >= 0);
  const p = S[unitDays[0]].primary, b = S[unitDays[0]].backup;
  ok(p, unitName + " primary was placed (open slots: " + JSON.stringify(openOn) + ")");
  ok(b, unitName + " backup was placed (open slots: " + JSON.stringify(openOn) + ")");
  ok(p !== b, "primary and backup are two people");
  unitDays.forEach((d) => { eq(S[d].primary, p, d + ": the same primary holds every day of the unit"); eq(S[d].backup, b, d + ": the same backup holds every day of the unit"); });
  const hu = D.holidayUnits.find((h) => h.name === unitName);
  ok(hu, unitName + " listed in diagnostics.holidayUnits");
  eq(hu.days, unitDays, "diagnostics.holidayUnits days");
  eq([hu.primary, hu.backup], [p, b], "diagnostics.holidayUnits holders");
  // the Friday is its own (reduced) weekend unit - the generator's real representation:
  // { friday, present: [Fri], preempted: [Sat, Sun], reduced: true, ... } (no `days` key)
  const wu = D.weekendUnits.find((w) => w.friday === friday);
  ok(wu, "a weekend unit keyed on " + friday + " in diagnostics.weekendUnits (have " + JSON.stringify(D.weekendUnits.map((w) => w.friday)) + ")");
  eq(wu.present, [friday], "the reduced weekend unit holds the Friday only");
  eq(wu.preempted, [unitDays[0], unitDays[1]], "Sat + Sun are pre-empted by the holiday unit");
  eq(wu.reduced, true, "flagged reduced");
  ok(!D.weekendUnits.some((w) => w.friday !== friday && (w.present.indexOf(unitDays[0]) >= 0 || w.present.indexOf(unitDays[1]) >= 0)), "no weekend unit carries the unit's Saturday or Sunday");
  ok(D.hardViolations.length === 0, "no hard violations: " + JSON.stringify(D.hardViolations));
  return out;
}
proveUnit("A4: generator 2027-05-24 -> 2027-06-06: Memorial Day Sat-Mon held by one primary + one backup; Fri 5/28 is a reduced weekend unit", "2027-05-24", "2027-06-06", MEMORIAL_27, "2027-05-28", "Memorial Day");
proveUnit("A5: generator 2027-08-30 -> 2027-09-12: Labor Day Sat-Mon held by one primary + one backup; Fri 9/3 is a reduced weekend unit", "2027-08-30", "2027-09-12", LABOR_27, "2027-09-03", "Labor Day");

/* =================================================================== B */
step("B1: helpers.defaultHolidayUnits exists and returns the six units in the seed's order");
ok(typeof H.defaultHolidayUnits === "function", "helpers.js must export defaultHolidayUnits (got " + typeof H.defaultHolidayUnits + ")");
const plain27 = H.defaultHolidayUnits(2027);
eq(plain27.map((u) => u.name), ORDER, "order");
eq(plain27.map((u) => u.tier), ["minor", "minor", "minor", "major", "major", "major"], "standard tiers");
plain27.forEach((u) => eq(Object.keys(u).filter((k) => k !== "note"), ["name", "tier", "days"], u.name + ": seed key shape"));

step("B2: flag absent / false -> every minor holiday is a single day");
eq(byName(plain27, "Memorial Day").days, ["2027-05-31"], "Memorial Day 2027 (last Monday of May)");
eq(byName(plain27, "Labor Day").days, ["2027-09-06"], "Labor Day 2027 (first Monday of September)");
eq(byName(plain27, "July 4th").days, ["2027-07-04"], "July 4th 2027");
eq(byName(plain27, "Thanksgiving").days, ["2027-11-25"], "Thanksgiving 2027 (fourth Thursday, single day by default)");
eq(byName(plain27, "Christmas").days, ["2027-12-24", "2027-12-25"], "Christmas = eve + day");
eq(byName(plain27, "New Year's").days, ["2027-12-31", "2028-01-01"], "New Year's = 12/31 + 1/1 of the next year, keyed under the eve's year");
eq(H.defaultHolidayUnits(2027, { mondayMinorAbsorbsWeekend: false }), plain27, "flag false == flag absent");
eq(H.defaultHolidayUnits(2027, {}), plain27, "empty opts == no opts");

step("B3: 2027 with the flag -> Memorial Day and Labor Day become Sat-Mon; July 4 (Sunday) does not");
const abs27 = H.defaultHolidayUnits(2027, { mondayMinorAbsorbsWeekend: true });
eq(byName(abs27, "Memorial Day").days, MEMORIAL_27, "Memorial Day 2027 Sat-Mon");
eq(byName(abs27, "Labor Day").days, LABOR_27, "Labor Day 2027 Sat-Mon");
eq(byName(abs27, "July 4th").days, ["2027-07-04"], "July 4th 2027 is a Sunday: its own day");
eq(byName(abs27, "Thanksgiving").days, ["2027-11-25"], "majors untouched");
eq(byName(abs27, "Christmas").days, ["2027-12-24", "2027-12-25"]);
eq(byName(abs27, "New Year's").days, ["2027-12-31", "2028-01-01"]);

step("B4: 2028 with the flag");
const abs28 = H.defaultHolidayUnits(2028, { mondayMinorAbsorbsWeekend: true });
eq(byName(abs28, "Memorial Day").days, ["2028-05-27", "2028-05-28", "2028-05-29"], "Memorial Day 2028 Sat-Mon");
eq(byName(abs28, "July 4th").days, ["2028-07-04"], "July 4th 2028 is a Tuesday: its own day");
eq(byName(abs28, "Labor Day").days, ["2028-09-02", "2028-09-03", "2028-09-04"], "Labor Day 2028 Sat-Mon");
eq(byName(abs28, "Thanksgiving").days, ["2028-11-23"], "Thanksgiving 2028");
eq(byName(abs28, "New Year's").days, ["2028-12-31", "2029-01-01"], "New Year's 2028");

step("B5: a year where July 4 is a Monday (2033) absorbs the weekend; not without the flag");
eq(byName(H.defaultHolidayUnits(2033, { mondayMinorAbsorbsWeekend: true }), "July 4th").days, ["2033-07-02", "2033-07-03", "2033-07-04"], "July 4th 2033 Sat-Mon");
eq(byName(H.defaultHolidayUnits(2033), "July 4th").days, ["2033-07-04"], "July 4th 2033 single without the flag");

step("B6: 2026 (built before the rule) - the builder without the flag reproduces the seed's past minor units");
const plain26 = H.defaultHolidayUnits(2026);
["Memorial Day", "July 4th", "Labor Day", "Christmas", "New Year's"].forEach((n) => eq(byName(plain26, n).days, byName(seed.holidays.units["2026"], n).days, n + " 2026 == seed"));
eq(byName(plain26, "Thanksgiving").days, ["2026-11-26"], "Thanksgiving 2026 builder default = the Thursday only");
eq(byName(seed.holidays.units["2026"], "Thanksgiving").days, ["2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"], "the seed's 2026 Thanksgiving is the scheduler's Thu-Sun (Faraz 9/21) - stored days stay authoritative");
eq(byName(H.defaultHolidayUnits(2026, { mondayMinorAbsorbsWeekend: true }), "Memorial Day").days, ["2026-05-23", "2026-05-24", "2026-05-25"], "the rule WOULD have made Memorial Day 2026 Sat-Mon - the seed keeps the past single day on purpose");

step("B7: tiers honoured from opts.tiers (the seed's holidays.rules.tiers shape); a major Monday never absorbs");
const swapped = { major: ["July 4th", "New Year's", "Thanksgiving", "Christmas"], minor: ["Memorial Day", "Labor Day"] };
const t33 = H.defaultHolidayUnits(2033, { mondayMinorAbsorbsWeekend: true, tiers: swapped });
eq(byName(t33, "July 4th").tier, "major", "tier from opts.tiers");
eq(byName(t33, "July 4th").days, ["2033-07-04"], "July 4th 2033 as a MAJOR holiday does not absorb the weekend");
eq(byName(t33, "Memorial Day").days, ["2033-05-28", "2033-05-29", "2033-05-30"], "Memorial Day 2033 (minor) still does");
eq(H.defaultHolidayUnits(2027, { mondayMinorAbsorbsWeekend: true, tiers: seed.holidays.rules.tiers }).map((u) => u.tier), ["minor", "minor", "minor", "major", "major", "major"], "the seed's tiers == the standard mapping");
eq(byName(H.defaultHolidayUnits(2027, { tiers: { major: ["Christmas"], minor: [] } }), "Thanksgiving").tier, "major", "a name missing from both lists falls back to the standard tier");

step("B8: independent arithmetic over 2026-2040 (UTC weekday; no local-time day shift)");
for (let y = 2026; y <= 2040; y++) {
  const on = H.defaultHolidayUnits(y, { mondayMinorAbsorbsWeekend: true }), off = H.defaultHolidayUnits(y);
  const mem = byName(off, "Memorial Day").days, lab = byName(off, "Labor Day").days, tg = byName(off, "Thanksgiving").days, j4 = byName(off, "July 4th").days;
  eq([mem.length, lab.length, tg.length, j4.length], [1, 1, 1, 1], y + ": single days without the flag");
  ok(dow(mem[0]) === "Mon" && mem[0].slice(0, 7) === y + "-05" && +mem[0].slice(8) >= 25, y + " Memorial Day = last Monday of May: " + mem[0]);
  ok(dow(lab[0]) === "Mon" && lab[0].slice(0, 7) === y + "-09" && +lab[0].slice(8) <= 7, y + " Labor Day = first Monday of September: " + lab[0]);
  ok(dow(tg[0]) === "Thu" && tg[0].slice(0, 7) === y + "-11" && +tg[0].slice(8) >= 22 && +tg[0].slice(8) <= 28, y + " Thanksgiving = fourth Thursday of November: " + tg[0]);
  eq(j4, [y + "-07-04"], y + " July 4th");
  eq(byName(off, "Christmas").days, [y + "-12-24", y + "-12-25"], y + " Christmas");
  eq(byName(off, "New Year's").days, [y + "-12-31", (y + 1) + "-01-01"], y + " New Year's");
  on.forEach((u) => {
    const single = byName(off, u.name).days;
    if (u.tier === "minor" && dow(single[0]) === "Mon") eq(u.days, [plusDays(single[0], -2), plusDays(single[0], -1), single[0]], y + " " + u.name + " on a Monday absorbs Sat + Sun");
    else eq(u.days, single, y + " " + u.name + " unchanged by the flag");
  });
}

step("B9: purity and validation");
const optsIn = { mondayMinorAbsorbsWeekend: true, tiers: clone(seed.holidays.rules.tiers) };
const before = JSON.stringify(optsIn);
const a1 = H.defaultHolidayUnits(2027, optsIn), a2 = H.defaultHolidayUnits(2027, optsIn);
eq(JSON.stringify(optsIn), before, "opts never mutated");
eq(a1, a2, "deterministic");
ok(a1 !== a2 && a1[0].days !== a2[0].days, "fresh arrays on every call");
eq(H.defaultHolidayUnits("2027", { mondayMinorAbsorbsWeekend: true }), a1, "a '2027' string year is accepted");
["", "abc", 27, 20271, null, undefined, 2027.5].forEach((bad) => { let threw = false; try { H.defaultHolidayUnits(bad); } catch (e) { threw = /defaultHolidayUnits/.test(String(e && e.message)); } ok(threw, "rejects year " + JSON.stringify(bad)); });

/* =================================================================== C */
step("C1: builder(2027, seed flag + seed tiers) deep-equals the seed's holidays.units[2027] - the seed and the builder pin each other");
eq(seed.groupRules.holidays.mondayMinorAbsorbsWeekend, true, "seed: groupRules.holidays.mondayMinorAbsorbsWeekend");
const seedOpts = Object.assign({}, seed.groupRules.holidays, { tiers: seed.holidays.rules.tiers });
eq(H.defaultHolidayUnits(2027, seedOpts), seed.holidays.units["2027"], "2027 units");
ok(typeof seed.holidays.rules.mondayMinor === "string" && /Sat-Mon/.test(seed.holidays.rules.mondayMinor) && /Friday/.test(seed.holidays.rules.mondayMinor), "seed: holidays.rules.mondayMinor states the rule and the Friday");
ok(/Thanksgiving 2027/.test(seed.holidays.rules.dayMembershipNote) && /Sat-Sun/.test(seed.holidays.rules.dayMembershipNote), "seed: dayMembershipNote records the open 2027 questions (Thanksgiving Thu-only vs Thu-Sun; July 4 Sat-Sun)");

step("C2: 2026 units stay as built before the rule (the milestone range does not move)");
eq(seed.holidays.units["2026"].map((u) => ({ name: u.name, days: u.days })), [
  { name: "Memorial Day", days: ["2026-05-25"] },
  { name: "July 4th", days: ["2026-07-04"] },
  { name: "Labor Day", days: ["2026-09-07"] },
  { name: "Thanksgiving", days: ["2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"] },
  { name: "Christmas", days: ["2026-12-24", "2026-12-25"] },
  { name: "New Year's", days: ["2026-12-31", "2027-01-01"] }
], "seed 2026 units");

/* =================================================================== D */
// ---- Prompt 12 V (9/22 evening) ----
// Standing East rule: Khan (s1) is on Davenport call every Christmas Eve and
// Christmas Day (surgeonRules.s1.eastStanding = Christmas 12-24 + 12-25), so he
// is never the Christmas unit's PRIMARY in any year; backup stays open. One
// generator run over Christmas 2027 from the seed: no feed busy days, no
// forecast, and the synthetic coverage ends 2027-01-31, so December 2027 is
// outside every feed input - only the standing rule can know about it.
step("D1: generator 2027-12-20 -> 2028-01-03: Khan is not primary on 12/24 or 12/25; one other surgeon holds the Christmas 2027 unit as primary on both days");
{
  const c = makeCtx({ schedule: {} });
  const out = GEN.generate(c, "2027-12-20", "2028-01-03", { seed: 5, bestOf: 3, timeBudgetMs: 800 });
  const S = out.schedule, D = out.diagnostics;
  // (V review) The placement pins below are belt-and-braces: without the key other terms (the
  // east-unknown soft outside the coverage) already kept Khan off Christmas 2027 in every probed
  // seed, so a still-green placement line is not proof on its own. The assertions that bite on an
  // engine without V are diagnostics.eastStandingDays.s1 and the R.holidayUnitCandidates(...)
  // lines at the end of this block (at HEAD the Christmas 2027 primary candidates were s1..s5).
  ["2027-12-24", "2027-12-25"].forEach((d) => {
    ok(S[d], d + " is in the generated range");
    ok(S[d].primary !== "s1", d + ": Khan is not Silvis primary (standing East call) - got " + JSON.stringify(S[d]));
  });
  const p = S["2027-12-24"].primary;
  ok(p && p !== "s1", "the Christmas 2027 primary is one other surgeon (open slots on the unit: " + JSON.stringify(D.uncovered.filter((u) => u.day === "2027-12-24" || u.day === "2027-12-25")) + ")");
  eq(S["2027-12-25"].primary, p, "the same primary holds both days of the unit");
  const hu = D.holidayUnits.find((h) => h.name === "Christmas");
  ok(hu && hu.days.join(",") === "2027-12-24,2027-12-25", "diagnostics.holidayUnits lists Christmas 2027 as 12/24 + 12/25");
  eq(hu.primary, p, "diagnostics.holidayUnits primary");
  ok(hu.primary !== "s1", "...and it is not Khan");
  eq(D.eastStandingDays && D.eastStandingDays.s1, ["2027-12-24", "2027-12-25"], "diagnostics.eastStandingDays.s1 for the range");
  ok(!D.eastUnknownDays.some((u) => u.id === "s1" && (u.day === "2027-12-24" || u.day === "2027-12-25")), "the standing days are not listed as East-unknown (outside the feed coverage, yet known)");
  ok(D.hardViolations.length === 0, "no hard violations: " + JSON.stringify(D.hardViolations));
  // and at the rules level for the same unit: Khan is no Christmas 2027 PRIMARY candidate, still a BACKUP candidate
  const xmas27 = R.holidayUnits(c, "2027-12-01", "2027-12-31").find((u) => u.name === "Christmas");
  eq(xmas27 && xmas27.days, ["2027-12-24", "2027-12-25"], "seed: Christmas 2027 unit");
  const candP = R.holidayUnitCandidates(c, xmas27, "primary"), candB = R.holidayUnitCandidates(c, xmas27, "backup");
  ok(candP.indexOf("s1") < 0, "Khan is not a Christmas 2027 primary candidate: " + candP);
  ok(candP.indexOf(p) >= 0, "the placed primary is a candidate: " + candP);
  ok(candB.indexOf("s1") >= 0, "Khan IS a Christmas 2027 backup candidate: " + candB);
}

const total = Date.now() - t0;
// Same override as test/generator-regression.js for a loaded machine; the default stays 4000 ms.
const LIMIT_MS = process.env.SILVIS_GEN_BUDGET_MS ? Math.floor(+process.env.SILVIS_GEN_BUDGET_MS) : 4000;
if (total > LIMIT_MS) { console.error("FAIL: test file took " + total + " ms (limit " + LIMIT_MS + ")"); process.exit(1); }
console.log("ok " + N + " assertions (" + total + " ms; limit " + LIMIT_MS + " ms" + (process.env.SILVIS_GEN_BUDGET_MS ? " via SILVIS_GEN_BUDGET_MS" : "") + ")");
