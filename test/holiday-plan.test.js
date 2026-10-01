// Silvis - the yearly holiday plan (Prompt 25, Faraz 9/30: "copy Davenport's split of major and minor holidays";
// "the generator makes most of the decisions"). helpers.js planHolidays / holidayPlanHistory / holidayPlanRules and
// the seed data they read. Plain Node asserts like the other suites; exits 1 on the first failure and prints
// 'ok <n> assertions' on success. Wired into `npm test` (package.json) and the CI workflow (test/ci.test.js pins both).
//
// Section A - data: HOLIDAY_PLAN_DEFAULTS = the seed's groupRules.holidayPlan (the GROUP_CALL_DEFAULTS pattern), the
//   key reader's fallbacks, Khan's 9/30 Christmas opt-out (data only, Faraz to confirm), what reaches the blob, the
//   openQuestions entry and the ONE 2026-09-30 revision entry (the last).
// Section B - history (rule 6): the schedule's units + the before-the-app list, the schedule winning a conflict.
// Sections C..G - one per rule: C pool + what still refuses (rule 1), D the tier split (rule 2), E alternation and the
//   primary rate (rule 3), F no repeat + the tie-breaks (rule 4), G the derived East week (rule 5).
// Section H - the 2027 plan on the seed inputs and the 2026 holders as published 9/23 (the report's table).
// Section I - ten simulated years on the seed rules (rotation, alternation, no repeat, every limit).
// Prompt 25 steps 3-5 (the plan in the app - Setup > Holidays > Plan / Accept / Re-check):
// Section J - holidayPlanCheck: the planner's own plans break nothing and score the search's own cost vector; every
//   break kind (refused, same-person, no-repeat, shape, max-major, not-in-pool), open slots apart, alternation soft.
// Section K - holidayPlanSwapOptions: every swap / replacement of a slot, each judged by the same check, ranked.
// Section M - holidayPlanAcceptRows (the rows Accept writes, the conflicts it must confirm) + holidayPlanInputs (the app
//   state -> the planner's opts) + holidayPlanDefaultYear.
// Section L - holidayPlanRecheck: accepted slots a newer vacation / East day / rule / roster change refuses, each with
//   the best swap; applying it clears the slot.
// Section N - the accepted rows: the generator keeps them (both roles locked) and lists the waived rules as lock
//   violations; a trade or a give moves the whole unit.
// Prompt 25 review fixes (10/1): A same-person is structural (K3, M2b); B / C started units - no half swap, the year as
//   written (K3, L5, M2, M2d); D a plan row's unlocked holder is not accepted (L6); E kept notes (M2); F grouped
//   replaced-slot lines (M2c); H home East vacation days (M3, M3b); I no repeat against the next year (F2b); J binding
//   vacations (I1); K the load alone (D2, D3), two in the pool (D4), the shape relaxed with every slot filled (D5);
//   L lock violations (N1).
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const H = require("../helpers.js");
const IMP = require("../importer.js");
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

const TIERS = seed.holidays.rules.tiers;
const UNITS = (y) => H.defaultHolidayUnits(y, { tiers: TIERS, mondayMinorAbsorbsWeekend: true });
const NY = "New Year's";
// a neutral pool: no seed rules, so each section sets exactly the rule it tests
const R6 = ["a", "b", "c", "d", "e", "f"].map((id, i) => ({ id: id, name: ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"][i], code: id.toUpperCase(), active: true }));
const plan = (year, o) => H.planHolidays(year, Object.assign({ units: UNITS(year), roster: R6, surgeonRules: {}, groupRules: {}, history: [], east: {}, vacations: [] }, o || {}));
const byName = (p, name) => p.assignments.find((a) => a.unit.name === name);
const holders = (p) => { const o = {}; p.assignments.forEach((a) => { o[a.unit.name] = [a.primary, a.backup]; }); return o; };
const blockedOf = (p, name, id, role) => { const b = byName(p, name).blocked.find((x) => x.id === id && x.role === role); return b ? b.reasons : []; };
const H26 = (tg, xm, ny) => [{ year: 2026, name: "Thanksgiving", primary: tg[0], backup: tg[1] }, { year: 2026, name: "Christmas", primary: xm[0], backup: xm[1] }, { year: 2026, name: NY, primary: ny[0], backup: ny[1] }];
// the structural checks every full plan of a six-surgeon pool must pass
function wellFormed(p, ids, label) {
  p.assignments.forEach((a) => {
    ok(a.primary && a.backup, label + ": " + a.unit.name + " filled (" + a.primary + " / " + a.backup + ")");
    ok(a.primary !== a.backup, label + ": " + a.unit.name + " primary != backup");
  });
  ids.forEach((id) => {
    const c = p.counts[id].plan;
    eq([c.major.primary + c.major.backup, c.minor.primary + c.minor.backup], [1, 1], label + ": " + id + " holds exactly one major and one minor");
    ok((c.major.primary === 1 && c.minor.backup === 1) || (c.major.backup === 1 && c.minor.primary === 1), label + ": " + id + " is primary in one tier and backup in the other: " + JSON.stringify(c));
  });
}

/* =================================================================== A */
step("A1: HOLIDAY_PLAN_DEFAULTS = the seed's groupRules.holidayPlan; holidayPlanRules falls back key by key");
eq(H.HOLIDAY_PLAN_DEFAULTS, { alternateTiers: true, noRepeatSameRole: true, history: [] }, "the code defaults");
eq(seed.groupRules.holidayPlan, H.HOLIDAY_PLAN_DEFAULTS, "the seed block equals the code defaults (the live blob, which lacks it, reads the same)");
eq(Object.keys(seed.groupRules.holidayPlan).sort(), ["alternateTiers", "history", "noRepeatSameRole"], "the rule's three keys only - no note, no reason (the note is the sibling holidayPlanNote, importer-dropped)");
eq(H.holidayPlanRules(undefined), H.HOLIDAY_PLAN_DEFAULTS, "no groupRules -> the defaults");
eq(H.holidayPlanRules({ holidayPlan: { alternateTiers: "no", noRepeatSameRole: 0, history: "x" } }), H.HOLIDAY_PLAN_DEFAULTS, "junk values -> the defaults, key by key");
eq(H.holidayPlanRules({ holidayPlan: { alternateTiers: false } }), { alternateTiers: false, noRepeatSameRole: true, history: [] }, "a boolean is read as given");
eq(H.holidayPlanRules({ holidayPlan: [] }), H.HOLIDAY_PLAN_DEFAULTS, "an array is not a block");
{ const r = H.holidayPlanRules({}); r.history.push(1); eq(H.HOLIDAY_PLAN_DEFAULTS.history, [], "the reader returns fresh copies (the defaults never move)"); }

step("A2: Khan's 9/30 Christmas opt-out is data only (Faraz to confirm) and reaches the blob without its note");
eq(seed.surgeonRules.s1.holidayRules, { holidaysOff: ["Christmas"], holidaysOffNote: "Faraz to confirm (9/30)" }, "seed s1.holidayRules");
eq(seed.surgeonRules.s3.holidayRules.holidaysOff, ["Thanksgiving"], "Acton's Thanksgiving opt-out unchanged");
eq(seed.surgeonRules.s4.holidayRules.maxMajorHolidays, 1, "Philip's one major per rolling 12 months unchanged");
const imp = IMP.importPlan(seed, { now: "2026-10-01T00:00:00.000Z" });
eq(imp.blob.groupRules.holidayPlan, H.HOLIDAY_PLAN_DEFAULTS, "blob groupRules.holidayPlan = the defaults");
ok(!("holidayPlanNote" in imp.blob.groupRules), "holidayPlanNote is dropped from the blob");
eq(imp.blob.surgeonRules.s1.holidayRules, { holidaysOff: ["Christmas"] }, "blob s1.holidayRules = the rule only (holidaysOffNote dropped)");
ok(IMP.impFindContactValues(seed.groupRules.holidayPlan).length === 0 && !seed.roster.some((r) => JSON.stringify(seed.groupRules.holidayPlan).indexOf(r.name) >= 0), "the block carries no contact-like value and no roster name (the blob is anon-readable)");

step("A3: openQuestions 20 and ONE 2026-09-30 revision entry for Prompt 25, the last");
const q20 = seed.openQuestions.filter((t) => /^20\. Holiday plan \(Prompt 25, Faraz 9\/30\)/.test(t));
eq(q20.length, 1, "one openQuestions entry 20");
ok(/Khan off Christmas in BOTH roles/.test(q20[0]) && /Faraz to confirm/.test(q20[0]) && /holidayPlan\.history/.test(q20[0]) && /2026 Memorial Day, July 4th and Labor Day/.test(q20[0]), "it names the Christmas default to confirm and the 2026 minors awaited for the history list");
ok(/\(c\) tie 2 .* is read as the sum over the pool of last year's days in the tier x this year's days/.test(q20[0]) && /\(d\) Should rules\.js read an accepted holiday-plan row as the holder's own availability .*Default taken: no - kept as locks, listed as lock violations/.test(q20[0]), "review fixes M / L: the tie-2 reading and the lock question are recorded as defaults to confirm");
const rev = seed._meta.revisions.filter((t) => /^2026-09-30 /.test(t) && /Prompt 25/.test(t));
eq(rev.length, 1, "one _meta.revisions entry for Prompt 25");
eq(seed._meta.revisions[seed._meta.revisions.length - 1], rev[0], "it is the last entry");
ok(/groupRules\.holidayPlan/.test(rev[0]) && /HOLIDAY_PLAN_DEFAULTS/.test(rev[0]) && /holidaysOff \['Christmas'\]/.test(rev[0]) && /seedCoreHash moves/.test(rev[0]), "it names the block, the code defaults, Khan's opt-out and the core-hash move");
ok(IMP.impFindContactValues(rev[0]).length === 0 && !/\$\s*\d/.test(rev[0]), "no contact-like value, no amount");
eq(imp.blob.settings.seedLastRevision, "2026-09-30", "blob settings.seedLastRevision");

/* =================================================================== B */
step("B1: holidayPlanHistory reads the schedule's units (split holders listed, external cover kept, empty units skipped)");
const sched26 = {};
["2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"].forEach((d) => { sched26[d] = { primary: "s1", backup: "s4" }; });
sched26["2026-12-24"] = { primary: "s3", backup: "s5" }; sched26["2026-12-25"] = { primary: "s3", backup: "s2" };
sched26["2026-12-31"] = { primary: null, backup: "s1", externalCover: "Locum" }; sched26["2027-01-01"] = { primary: "s2", backup: "s1" };
const hb = H.holidayPlanHistory({ schedule: sched26, holidays: seed.holidays, groupRules: {} });
eq(hb.warnings, [], "no warnings");
eq(hb.entries.map((e) => [e.year, e.name, e.tier, e.days.length, e.primary, e.backup, e.source]), [
  [2026, "Thanksgiving", "major", 4, ["s1"], ["s4"], "schedule"],
  [2026, "Christmas", "major", 2, ["s3"], ["s5", "s2"], "schedule"],
  [2026, NY, "major", 2, ["ext:Locum", "s2"], ["s1"], "schedule"]
], "three 2026 majors; the 2026 minors (before the app) are not history - nothing recorded");

step("B2: the before-the-app list (groupRules.holidayPlan.history) - days from the stored units or the builder; the schedule wins");
const gList = { holidayPlan: { history: [
  { year: 2026, name: "Memorial Day", primary: "s2", backup: "s3" },
  { year: 2025, name: "Christmas", primary: "s4", backup: null },
  { year: 2026, name: "Thanksgiving", primary: "s2", backup: "s4" },
  { year: 2026, name: "Bogus", primary: "s2" },
  { name: "Christmas" },
  { year: 2025, name: "Labor Day" }
] } };
const hl = H.holidayPlanHistory({ schedule: sched26, holidays: seed.holidays, groupRules: gList });
const memo = hl.entries.find((e) => e.name === "Memorial Day" && e.year === 2026), x25 = hl.entries.find((e) => e.name === "Christmas" && e.year === 2025);
eq(memo && [memo.days, memo.primary, memo.backup, memo.source], [["2026-05-25"], ["s2"], ["s3"], "list"], "Memorial Day 2026 from the list, days from the stored 2026 unit");
eq(x25 && [x25.days, x25.primary, x25.backup, x25.tier], [["2025-12-24", "2025-12-25"], ["s4"], [], "major"], "Christmas 2025 from the list, days from the builder (no stored 2025 units)");
eq(hl.entries.find((e) => e.name === "Thanksgiving").primary, ["s1"], "the schedule's Thanksgiving 2026 stands");
eq(hl.warnings, [
  "groupRules.holidayPlan.history[2] (Thanksgiving 2026) differs from the schedule - the schedule wins",
  "groupRules.holidayPlan.history[3]: ignored - Bogus is not a holiday unit of 2026",
  "groupRules.holidayPlan.history[4]: ignored - needs { year, name, primary, backup }",
  "groupRules.holidayPlan.history[5] (Labor Day 2025): ignored - names nobody"
], "every refused entry is named, never silently dropped");
eq(hl.entries.map((e) => e.days[0]), hl.entries.map((e) => e.days[0]).slice().sort(), "sorted by first day");

step("B3: planHolidays builds the same history itself from schedule + holidays when none is passed");
{
  const o = { units: seed.holidays.units["2027"], roster: seed.roster, surgeonRules: seed.surgeonRules, groupRules: seed.groupRules };
  const a = H.planHolidays(2027, Object.assign({ history: H.holidayPlanHistory({ schedule: sched26, holidays: seed.holidays, groupRules: seed.groupRules }).entries }, o));
  const b = H.planHolidays(2027, Object.assign({ schedule: sched26, holidays: seed.holidays }, o));
  eq(holders(b), holders(a), "same plan");
  eq(b.counts, a.counts, "same counts");
  // and the year being planned is never its own history
  const c = H.planHolidays(2027, Object.assign({ history: a.assignments.map((x) => ({ year: 2027, name: x.unit.name, primary: x.primary, backup: x.backup })).concat(H.holidayPlanHistory({ schedule: sched26, holidays: seed.holidays, groupRules: seed.groupRules }).entries) }, o));
  eq(c.counts, a.counts, "entries of the planned year are ignored (Davenport skips the year it regenerates)");
  const own = plan(2027, { history: [{ year: 2026, name: "Labor Day", days: ["2026-09-07"], primary: "a", backup: "b" }] });
  eq([own.counts.a.before.minor.primary, own.counts.a.before.major.primary, own.counts.b.before.minor.any], [1, 0, 1], "an entry with its own days and no tier takes the unit's tier (Labor Day: minor)");
}

/* =================================================================== C */
step("C1: pool = the active roster minus outside surgeons; a full six plan with no history");
{
  const roster = R6.concat([{ id: "g", name: "Golf", active: false }, { id: "x1", name: "Locum", active: true, type: "external" }]);
  const p = plan(2027, { roster: roster });
  wellFormed(p, ["a", "b", "c", "d", "e", "f"], "C1");
  ok(!p.assignments.some((a) => ["g", "x1"].indexOf(a.primary) >= 0 || ["g", "x1"].indexOf(a.backup) >= 0), "the inactive and the outside surgeon are never planned");
  eq(Object.keys(p.counts).sort(), ["a", "b", "c", "d", "e", "f"], "counts cover the pool only");
  eq([p.search.pass, p.relaxed, p.warnings], [1, [], []], "pass 1, nothing relaxed, no warnings");
  const r2 = clone(R6); r2[0].activeTo = "2027-12-01";
  const p2 = plan(2027, { roster: r2 });
  eq(blockedOf(p2, "Christmas", "a", "primary"), ["inactive"], "activeTo before the unit -> inactive");
}

step("C2: a plan day is his own availability - windows, weekday patterns and dated lists are not consulted");
{
  const sr = { a: { availableWindows: [{ start: "2027-01-11", end: "2027-01-15" }], hardNeverWeekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], hardNeverWeekdaysRoles: ["primary", "backup"], availabilityMode: "whitelist-recurring", recurringAvailable: [], explicitListMonths: [{ month: "2027-11", roles: ["primary", "backup"] }], availableWeeks: ["2027-01-04"], monthlyCap: 0 } };
  const p = plan(2027, { surgeonRules: sr });
  ok(p.assignments.every((a) => !a.blocked.some((b) => b.id === "a")), "nothing blocks Alpha");
  eq([p.counts.a.plan.major.primary + p.counts.a.plan.major.backup, p.counts.a.plan.minor.primary + p.counts.a.plan.minor.backup], [1, 1], "Alpha holds one major and one minor anyway");
}

step("C3: vacations refuse both roles; the day before one refuses the trailing-edge roles (primary by default)");
{
  const p = plan(2027, { vacations: [{ person_id: "a", start_date: "2027-11-26", end_date: "2027-11-26" }, { person_id: "b", start_date: "2027-12-26", end_date: "2027-12-30" }] });
  eq(blockedOf(p, "Thanksgiving", "a", "primary"), ["day-before-vacation", "time-off:2027-11-26"], "Alpha's vacation day inside Thanksgiving - primary (Thu 11/25 is also the day before it)");
  eq(blockedOf(p, "Thanksgiving", "a", "backup"), ["time-off:2027-11-26"], "...and backup");
  eq(blockedOf(p, "Christmas", "b", "primary"), ["day-before-vacation"], "Bravo's vacation starts the day after Christmas: primary refused");
  eq(blockedOf(p, "Christmas", "b", "backup"), [], "...backup is not (a standby backup the day before is acceptable)");
  ok(byName(p, "Thanksgiving").primary !== "a" && byName(p, "Thanksgiving").backup !== "a" && byName(p, "Christmas").primary !== "b", "the plan respects both");
  const p2 = plan(2027, { vacations: [{ person_id: "b", start_date: "2027-12-26", end_date: "2027-12-30" }], groupRules: { dayBeforeRules: { trailingEdgeRoles: ["primary", "backup"] } } });
  eq(blockedOf(p2, "Christmas", "b", "backup"), ["day-before-vacation"], "dayBeforeRules.trailingEdgeRoles is read");
}

step("C4: East - feed busy days, the forecast at the threshold, the published coverage, overrides and eastStanding; only the roles East blocks");
{
  const ef = { enabled: true, eastBlocksPrimary: true, eastBlocksBackup: false };
  const sr = { b: { eastFeed: ef } };
  const pBusy = plan(2027, { surgeonRules: sr, east: { eastBusyDays: { b: ["2027-12-31"] } } });
  eq([blockedOf(pBusy, NY, "b", "primary"), blockedOf(pBusy, NY, "b", "backup")], [["east-busy"], []], "a feed busy day refuses his primary only (eastBlocksBackup false)");
  eq(blockedOf(plan(2027, { surgeonRules: sr, east: { eastBusyDays: { b: new Set(["2027-12-31"]) } } }), NY, "b", "primary"), ["east-busy"], "a Set works (the app's ctxInputs shape)");
  eq(blockedOf(plan(2027, { surgeonRules: sr, east: { eastBusyDays: { b: { busy: new Set(["2027-12-31"]) } } } }), NY, "b", "primary"), ["east-busy"], "...and deriveKhanBusyDays' { busy } object");
  eq(blockedOf(plan(2027, { surgeonRules: { b: { eastFeed: { enabled: true, eastBlocksPrimary: true, eastBlocksBackup: true } } }, east: { eastBusyDays: { b: ["2027-12-31"] } } }), NY, "b", "backup"), ["east-busy"], "eastBlocksBackup true refuses the backup too");
  eq(blockedOf(plan(2027, { surgeonRules: { b: { eastFeed: { enabled: false, eastBlocksPrimary: true } } }, east: { eastBusyDays: { b: ["2027-12-31"] } } }), NY, "b", "primary"), [], "East off -> nothing");
  const fc = (p, extra) => plan(2027, Object.assign({ surgeonRules: sr, east: Object.assign({ eastForecast: { b: { "2027-11-26": p } } }, extra || {}) }));
  eq(blockedOf(fc(0.6), "Thanksgiving", "b", "primary"), ["east-forecast-busy:0.60"], "forecast at/over the default threshold 0.5");
  eq(blockedOf(fc(0.5), "Thanksgiving", "b", "primary"), ["east-forecast-busy:0.50"], "the threshold itself counts (>=, as rules.js)");
  eq(blockedOf(fc(0.4), "Thanksgiving", "b", "primary"), [], "below it: no refusal");
  eq(blockedOf(plan(2027, { surgeonRules: sr, groupRules: { eastFeed: { forecast: { busyThreshold: 0.3 } } }, east: { eastForecast: { b: { "2027-11-26": 0.4 } } } }), "Thanksgiving", "b", "primary"), ["east-forecast-busy:0.40"], "groupRules.eastFeed.forecast.busyThreshold is read");
  eq(blockedOf(fc(0.9, { eastFeedCoverage: { from: "2027-11-01", to: "2027-11-30" } }), "Thanksgiving", "b", "primary"), [], "inside the published coverage the forecast is not consulted (published > forecast)");
  eq(blockedOf(fc(0.9, { eastOverrides: { b: { "2027-11-26": false } } }), "Thanksgiving", "b", "primary"), [], "an override false clears a forecast-busy day");
  eq(blockedOf(plan(2027, { surgeonRules: sr, east: { eastBusyDays: { b: ["2027-12-31"] }, eastOverrides: { b: { "2027-12-31": false } } } }), NY, "b", "primary"), [], "...and a feed busy day");
  eq(blockedOf(plan(2027, { surgeonRules: sr, east: { eastOverrides: { b: { "2027-07-04": true } } } }), "July 4th", "b", "primary"), ["east-busy"], "an override true makes the day busy");
  const st = plan(2027, { surgeonRules: { b: { eastFeed: ef, eastStanding: [{ name: "Christmas", days: ["12-24", "12-25"] }] } }, east: { eastOverrides: { b: { "2027-12-24": false } } } });
  eq([blockedOf(st, "Christmas", "b", "primary"), blockedOf(st, "Christmas", "b", "backup")], [["east-busy"], []], "eastStanding refuses the Christmas primary every year (an override cannot clear a standing day - rules.js)");
}

step("C5: holidaysOff (both roles), neverThanksgiving, backupOptOut, maxMajorHolidays (rolling 12 months, history included)");
{
  const p = plan(2027, { surgeonRules: { c: { holidayRules: { holidaysOff: ["Christmas"] } }, d: { holidayRules: { neverThanksgiving: true } } } });
  eq([blockedOf(p, "Christmas", "c", "primary"), blockedOf(p, "Christmas", "c", "backup")], [["holiday-opt-out:Christmas"], ["holiday-opt-out:Christmas"]], "holidaysOff refuses both roles");
  eq(blockedOf(p, "Thanksgiving", "d", "backup"), ["holiday-opt-out:Thanksgiving"], "the old neverThanksgiving flag reads as holidaysOff Thanksgiving");
  wellFormed(p, ["a", "b", "c", "d", "e", "f"], "C5 opt-outs");
  // backupOptOut: Delta can only be primary - one major and one minor, both primary; alternation is impossible for him and says so
  const q = plan(2027, { surgeonRules: { d: { backupOptOut: true } } });
  ok(q.assignments.every((a) => a.backup !== "d"), "backupOptOut: never a backup");
  eq([q.counts.d.plan.major.primary, q.counts.d.plan.minor.primary], [1, 1], "...so he is primary in both tiers");
  // ...which leaves four primary slots for the other five: one of them is backup in both tiers - the minimum, two misses
  ok(q.warnings.some((w) => /^Alternation not possible for [A-Za-z, ]*Delta/.test(w)), "and the plan says alternation was not possible for him: " + JSON.stringify(q.warnings));
  eq(q.search.cost.alternation, 2, "two misses (Delta primary in both, one other backup in both) - no plan has fewer");
  eq(q.search.pass, 1, "alternation is a preference ('where the pool allows'), not a relaxation");
  // maxMajorHolidays: Echo held Christmas 2026; Thanksgiving 2027 starts 11 months later (refused), Christmas / New Year's 2027 12 later (fine)
  const sr = { e: { holidayRules: { maxMajorHolidays: 1 } } };
  const m = plan(2027, { surgeonRules: sr, history: H26(["a", "b"], ["e", "c"], ["d", "f"]) });
  eq(blockedOf(m, "Thanksgiving", "e", "primary"), ["max-major-holidays:1"], "Christmas 2026 -> Thanksgiving 2027 is 11 months: refused");
  eq([blockedOf(m, "Christmas", "e", "backup"), blockedOf(m, NY, "e", "primary")], [[], []], "Christmas / New Year's 2027 are 12 months away: allowed");
  eq(blockedOf(plan(2027, { surgeonRules: { e: { preferences: { maxMajorHolidays: 1 } } }, history: H26(["a", "b"], ["e", "c"], ["d", "f"]) }), "Thanksgiving", "e", "backup"), ["max-major-holidays:1"], "the old preferences.maxMajorHolidays shape is read too");
  // inside the plan: a pool of four must hand out six major slots (two each for two surgeons) - never two majors to Echo
  const four = plan(2027, { roster: R6.filter((r) => ["a", "b", "c", "e"].indexOf(r.id) >= 0), surgeonRules: sr });
  ok(four.counts.e.plan.major.primary + four.counts.e.plan.major.backup <= 1, "within the year Echo holds at most one major: " + JSON.stringify(four.counts.e.plan));
  ok(four.assignments.every((a) => a.primary && a.backup), "and the plan is still full");
}

/* =================================================================== D */
step("D1: six in the pool - everyone exactly one major and one minor, whatever the history");
wellFormed(plan(2027, { history: H26(["a", "b"], ["c", "d"], ["e", "f"]) }), ["a", "b", "c", "d", "e", "f"], "D1");

step("D2: five - the extra slot of each tier is a BACKUP to the lowest lifetime load");
{
  // review fix K: a Y-2 history (2025 only) - no 2026 entry, so tie 1 (same holiday as last year) and tie 2 (last year's
  // days) are neutral and only the load term decides. 2025 majors: Alpha 2 of 3 (TG + NY primary), Charlie 2 of 3 (XM
  // primary + NY backup), Bravo and Delta 1 of 3, Echo 0 of 3 -> Echo takes the extra major
  const H25 = (tg, xm, ny) => [{ year: 2025, name: "Thanksgiving", primary: tg[0], backup: tg[1] }, { year: 2025, name: "Christmas", primary: xm[0], backup: xm[1] }, { year: 2025, name: NY, primary: ny[0], backup: ny[1] }];
  for (let s = 1; s <= 6; s++) {
    const p = plan(2027, { roster: R6.slice(0, 5), history: H25(["a", "b"], ["c", "d"], ["a", "c"]), seed: s });
    const c = p.counts;
    if (s === 1) eq(["a", "b", "c", "d", "e"].map((id) => [c[id].before.major.any, c[id].lastYearDays.major]), [[2, 0], [1, 0], [2, 0], [1, 0], [0, 0]], "loads 2/1/2/1/0 of 3; nobody has 2026 days (tie 2 neutral)");
    eq(["a", "b", "c", "d", "e"].map((id) => c[id].plan.major.primary + c[id].plan.major.backup), [1, 1, 1, 1, 2], "seed " + s + ": Echo (load 0/3, the lowest) holds two majors, everyone else one");
    ok(c.e.plan.major.backup >= 1 && c.e.plan.major.primary <= 1, "seed " + s + ": the extra one is a backup: " + JSON.stringify(c.e.plan.major));
    eq(["a", "b", "c", "d", "e"].map((id) => c[id].plan.minor.primary + c[id].plan.minor.backup).sort(), [1, 1, 1, 1, 2], "seed " + s + ": the minors: one surgeon holds two");
    ok(p.assignments.every((a) => a.primary && a.backup && a.primary !== a.backup), "seed " + s + ": full, primary != backup");
    eq([p.relaxed, p.search.cost.sameHoliday, p.search.cost.unitLength], [[], 0, 0], "seed " + s + ": nothing relaxed (the shape for five IS one or two per tier); both ties zero");
  }
}

step("D3: seven - the highest lifetime load sits a tier out");
{
  const r7 = R6.concat([{ id: "g", name: "Golf", active: true }]);
  // review fix K: 2025 majors (a Y-2 history - ties 1 and 2 neutral): Golf held all three (load 3/3) -> he sits the 2027 majors out
  const hist = [{ year: 2025, name: "Thanksgiving", primary: "g", backup: "a" }, { year: 2025, name: "Christmas", primary: "g", backup: "b" }, { year: 2025, name: NY, primary: "g", backup: "c" }];
  for (let s = 1; s <= 6; s++) {
    const p = plan(2027, { roster: r7, history: hist, seed: s });
    eq(p.counts.g.plan.major, { primary: 0, backup: 0 }, "seed " + s + ": Golf sits the majors out");
    eq(["a", "b", "c", "d", "e", "f"].map((id) => p.counts[id].plan.major.primary + p.counts[id].plan.major.backup), [1, 1, 1, 1, 1, 1], "seed " + s + ": the other six hold one major each");
    eq(["a", "b", "c", "d", "e", "f", "g"].map((id) => p.counts[id].plan.minor.primary + p.counts[id].plan.minor.backup).sort(), [0, 1, 1, 1, 1, 1, 1], "seed " + s + ": the minors (no history): one of the seven sits out");
    eq([p.search.cost.sameHoliday, p.search.cost.unitLength], [0, 0], "seed " + s + ": both ties zero - only the load decided");
  }
}

step("D4: review fix K - two in the pool: every unit filled, primary != backup, over several seeds");
for (let s = 1; s <= 6; s++) {
  const p = plan(2027, { roster: R6.slice(0, 2), seed: s });
  ok(p.assignments.every((a) => a.primary && a.backup && a.primary !== a.backup), "seed " + s + ": " + JSON.stringify(holders(p)));
  eq([p.search.pass, p.relaxed], [1, []], "seed " + s + ": the shape for two (three slots each per tier, at most two primaries) holds");
}

step("D5: review fix K - every slot can be filled but the shape cannot be kept: Foxtrot's derived weeks make him primary on Christmas AND New Year's");
{
  const o = { surgeonRules: { f: { eastFeed: { enabled: true } } }, east: { eastDerived: [{ surgeonId: "f", weekMonday: "2027-12-20", silvisRole: "primary" }, { surgeonId: "f", weekMonday: "2027-12-27", silvisRole: "primary" }] } };
  for (let s = 1; s <= 4; s++) {
    const p = plan(2027, Object.assign({ seed: s }, o));
    eq([byName(p, "Christmas").primary, byName(p, NY).primary], ["f", "f"], "seed " + s + ": the derived weeks hold");
    ok(p.assignments.every((a) => a.primary && a.backup && a.primary !== a.backup), "seed " + s + ": every slot filled");
    eq(p.search.pass, 3, "seed " + s + ": pass 3 - no plan keeps the shape (Foxtrot's second major primary passes the cap)");
    const shapes = p.relaxed.filter((r) => /^shape: /.test(r));
    eq(shapes.length, 2, "seed " + s + ": two 'shape:' entries: " + JSON.stringify(p.relaxed));
    ok(shapes.some((r) => /^shape: Foxtrot holds 2 major holidays \(2 primary\) - expected 1 with at most 1 primary; no plan meets the shape$/.test(r)) && shapes.some((r) => / holds 0 major holidays \(0 primary\) - expected 1 with at most 1 primary; no plan meets the shape$/.test(r)), "seed " + s + ": Foxtrot over, one surgeon without a major");
    eq(p.search.cost.open, 0, "seed " + s + ": no open slot");
  }
}

/* =================================================================== E */
step("E1: alternation - primary in one tier, backup in the other; the tier's primaries go to the lowest primary rate");
{
  const p = plan(2027, { history: H26(["a", "d"], ["b", "e"], ["c", "f"]) });
  wellFormed(p, ["a", "b", "c", "d", "e", "f"], "E1");
  eq(p.assignments.filter((a) => a.unit.tier === "major").map((a) => a.primary).sort(), ["d", "e", "f"], "2026 major primaries Alpha / Bravo / Charlie (1/3 each) -> the 2027 major primaries are Delta / Echo / Foxtrot (0/3)");
  eq(p.assignments.filter((a) => a.unit.tier === "minor").map((a) => a.primary).sort(), ["a", "b", "c"], "...and the minor primaries are the other three");
  eq(p.counts.a.before.major, { primary: 1, any: 1, eligible: 3, primaryRate: 1 / 3, load: 1 / 3 }, "counts: Davenport's holidayRate per tier and role");
}

step("E2: the rate is tenure-normalized (Davenport's holidayRate) - a raw count would tie Foxtrot with the lowest");
{
  // 2025 + 2026 majors; Foxtrot joined 2026-01-02 (eligible for the three 2026 units only; NY 2025 starts 12/31/2025)
  const hist = [
    { year: 2025, name: "Thanksgiving", primary: "b", backup: "c" }, { year: 2025, name: "Christmas", primary: "e", backup: "d" }, { year: 2025, name: NY, primary: "e", backup: "a" },
    { year: 2026, name: "Thanksgiving", primary: "c", backup: "a" }, { year: 2026, name: "Christmas", primary: "d", backup: "b" }, { year: 2026, name: NY, primary: "f", backup: "e" }
  ];
  const roster = clone(R6); roster[5].activeFrom = "2026-01-02";
  const rates = (p) => ["a", "b", "c", "d", "e", "f"].map((id) => [p.counts[id].before.major.primary, p.counts[id].before.major.eligible]);
  for (let s = 1; s <= 8; s++) {
    const p = plan(2027, { roster: roster, history: hist, seed: s });
    if (s === 1) eq(rates(p), [[0, 6], [1, 6], [1, 6], [1, 6], [2, 6], [1, 3]], "primary counts / eligible: Foxtrot 1 of 3, Bravo / Charlie / Delta 1 of 6");
    const prim = p.assignments.filter((a) => a.unit.tier === "major").map((a) => a.primary);
    ok(prim.indexOf("a") >= 0 && prim.indexOf("f") < 0 && prim.indexOf("e") < 0, "seed " + s + ": Alpha (0/6) is a major primary, Foxtrot (1/3) and Echo (2/6) are not: " + prim);
  }
  const g = plan(2027, { roster: R6.concat([{ id: "g", name: "Golf", active: true, activeFrom: "2027-01-01" }]), history: hist });
  eq([g.counts.g.before.major.eligible, g.counts.g.before.major.primaryRate, g.counts.g.before.major.load], [0, 0, 0], "zero eligible -> rate 0, never NaN (a new hire sorts first)");
}

step("E3: alternateTiers false - the term is off (no alternation cost, no alternation warning)");
{
  const sr = { d: { backupOptOut: true } };
  const off = plan(2027, { surgeonRules: sr, groupRules: { holidayPlan: { alternateTiers: false } } });
  ok(!off.warnings.some((w) => /Alternation/.test(w)) && off.search.cost.alternation === 0, "no alternation warning, cost 0");
  ok(plan(2027, { surgeonRules: sr }).search.cost.alternation >= 1, "on (the default): the same pool costs one");
}

/* =================================================================== F */
step("F1: nobody gets the same holiday in the same role two years running");
{
  const hist = H26(["a", "b"], ["c", "d"], ["e", "f"]);
  for (let s = 1; s <= 6; s++) {
    const p = plan(2027, { history: hist, seed: s });
    hist.forEach((h) => { const a = byName(p, h.name); ok(a.primary !== h.primary && a.backup !== h.backup, "seed " + s + ": " + h.name + " repeats a 2026 role: " + JSON.stringify([a.primary, a.backup])); });
    eq([p.search.pass, p.relaxed], [1, []], "seed " + s + ": pass 1, nothing relaxed");
  }
}

step("F2: relaxed only when no plan exists - and said so");
{
  // only Alpha may be the 2027 Thanksgiving primary (the others' East days), and he held it in 2026
  const ef = { enabled: true, eastBlocksPrimary: true, eastBlocksBackup: false };
  const sr = {}, busy = {};
  ["b", "c", "d", "e", "f"].forEach((id) => { sr[id] = { eastFeed: ef }; busy[id] = ["2027-11-25"]; });
  const hist = H26(["a", "b"], ["c", "d"], ["e", "f"]);
  const p = plan(2027, { surgeonRules: sr, east: { eastBusyDays: busy }, history: hist });
  eq(byName(p, "Thanksgiving").primary, "a", "Alpha is the Thanksgiving primary again");
  eq(p.relaxed, ["no-repeat: Alpha primary Thanksgiving 2026 and 2027 - no plan exists without it"], "relaxed names the one repeat");
  eq(p.search.pass, 2, "found in pass 2 (pass 1 - the rule hard - had no plan)");
  ok(byName(p, "Thanksgiving").why.some((w) => /same role as 2026 \(relaxed\)/.test(w)), "the why says so too");
  hist.filter((h) => h.name !== "Thanksgiving").forEach((h) => { const a = byName(p, h.name); ok(a.primary !== h.primary && a.backup !== h.backup, h.name + ": no other repeat"); });
  const q = plan(2027, { surgeonRules: sr, east: { eastBusyDays: busy }, history: hist, groupRules: { holidayPlan: { noRepeatSameRole: false } } });
  eq([byName(q, "Thanksgiving").primary, q.relaxed, q.search.pass], ["a", [], 1], "noRepeatSameRole false: the same plan is no relaxation");
}

step("F2b: review fix I - re-planning a year with the NEXT year on file: no same holiday in the same role as next year either (rates untouched)");
{
  const h26 = H26(["a", "b"], ["c", "d"], ["e", "f"]);
  for (let s = 1; s <= 4; s++) {
    const p0 = plan(2027, { history: h26, seed: s });
    const h28 = p0.assignments.map((a) => ({ year: 2028, name: a.unit.name, primary: a.primary, backup: a.backup }));
    const p1 = plan(2027, { history: h26.concat(h28), seed: s });
    p1.assignments.forEach((a) => { const n = h28.find((x) => x.name === a.unit.name); ok(a.primary !== n.primary && a.backup !== n.backup, "seed " + s + ": " + a.unit.name + " repeats a 2028 role: " + JSON.stringify([a.primary, a.backup, n.primary, n.backup])); });
    eq([p1.search.pass, p1.relaxed], [1, []], "seed " + s + ": pass 1, nothing relaxed");
    eq(p1.counts, Object.assign({}, p0.counts, Object.fromEntries(Object.keys(p0.counts).map((id) => [id, Object.assign({}, p0.counts[id], { plan: p1.counts[id].plan })]))), "seed " + s + ": the 2028 entries change no rate, load or last-year day (a later year is never in the rates)");
    if (s === 1) {
      const chk = H.holidayPlanCheck(2027, p0.assignments, { units: UNITS(2027), roster: R6, surgeonRules: {}, groupRules: {}, history: h26.concat(h28) });
      eq(chk.breaks.filter((b) => b.rule === "no-repeat").length, 12, "the plan 2028 copies breaks no-repeat on all 12 slots");
      ok(chk.breaks.filter((b) => b.rule === "no-repeat").every((b) => / in 2027 and 2028 \(no same holiday in the same role two years running\)$/.test(b.text)), "...each named '2027 and 2028': " + chk.breaks[0].text);
    }
  }
  // forced: only Alpha may be the 2027 Thanksgiving primary, and he holds the 2028 one (and in the second case the 2026 one too)
  const ef = { enabled: true, eastBlocksPrimary: true, eastBlocksBackup: false };
  const sr = {}, busy = {};
  ["b", "c", "d", "e", "f"].forEach((id) => { sr[id] = { eastFeed: ef }; busy[id] = ["2027-11-25"]; });
  const tg28 = { year: 2028, name: "Thanksgiving", primary: "a", backup: "b" };
  const p = plan(2027, { surgeonRules: sr, east: { eastBusyDays: busy }, history: H26(["b", "c"], ["d", "e"], ["f", "a"]).concat([tg28]) });
  eq([byName(p, "Thanksgiving").primary, p.relaxed, p.search.pass], ["a", ["no-repeat: Alpha primary Thanksgiving 2027 and 2028 - no plan exists without it"], 2], "relaxed names the repeat against 2028, pass 2");
  ok(byName(p, "Thanksgiving").why.some((w) => /same role as 2028 \(relaxed\)/.test(w)), "the why says 2028");
  const q = plan(2027, { surgeonRules: sr, east: { eastBusyDays: busy }, history: H26(["a", "c"], ["d", "e"], ["f", "b"]).concat([tg28]) });
  eq(q.relaxed, ["no-repeat: Alpha primary Thanksgiving 2026, 2027 and 2028 - no plan exists without it"], "both neighbours: '2026, 2027 and 2028'");
}

step("F3: tie 1 - a different holiday than last year (either role)");
{
  const hist = H26(["a", "b"], ["c", "d"], ["e", "f"]);
  for (let s = 1; s <= 6; s++) {
    const p = plan(2027, { history: hist, seed: s });
    eq(p.search.cost.sameHoliday, 0, "seed " + s + ": nobody holds a holiday he held in 2026");
    hist.forEach((h) => { const a = byName(p, h.name); ok([a.primary, a.backup].every((id) => id !== h.primary && id !== h.backup), "seed " + s + ": " + h.name + " goes to two surgeons who did not hold it in 2026"); });
  }
}

step("F4: tie 2 - the longer unit to whoever had the shorter one last year");
{
  // 2026 (custom days): Christmas was the 4-day unit (Alpha / Bravo), Thanksgiving and New Year's 2 days. 2027: Thanksgiving
  // is the 4-day unit. Tie 1 alone allows Bravo on the 2027 Thanksgiving primary and Alpha on its backup; tie 2 gives it to
  // the two who had 2 days.
  const hist = [
    { year: 2026, name: "Thanksgiving", days: ["2026-11-26", "2026-11-27"], primary: "c", backup: "d" },
    { year: 2026, name: "Christmas", days: ["2026-12-22", "2026-12-23", "2026-12-24", "2026-12-25"], primary: "a", backup: "b" },
    { year: 2026, name: NY, days: ["2026-12-31", "2027-01-01"], primary: "e", backup: "f" }
  ];
  // primaries 2027 = Bravo / Delta / Foxtrot (rate 0)
  for (let s = 1; s <= 6; s++) {
    const p = plan(2027, { history: hist, seed: s });
    eq(holders(p).Thanksgiving, ["f", "e"], "seed " + s + ": Thanksgiving (4 days) to Foxtrot / Echo (2 days in 2026), not Bravo / Alpha (4)");
    eq([holders(p).Christmas, holders(p)[NY]], [["d", "c"], ["b", "a"]], "seed " + s + ": Christmas Delta / Charlie, New Year's Bravo / Alpha");
    eq(p.counts.a.lastYearDays.major, 4, "lastYearDays counts the stored days");
  }
}

step("F5: tie 3 - the seeded RNG (the same seed = the same plan; seeds spread over the tied plans)");
{
  const a = plan(2027, { seed: 11 }), b = plan(2027, { seed: 11 });
  eq(holders(a), holders(b), "same seed, same plan");
  const seen = new Set(), costs = new Set();
  for (let s = 1; s <= 25; s++) { const p = plan(2027, { seed: s }); seen.add(JSON.stringify(holders(p))); costs.add(JSON.stringify(p.search.cost)); }
  ok(seen.size >= 5, "25 seeds give " + seen.size + " different plans among the ties (no history: every plan ties)");
  eq(costs.size, 1, "...all with the same cost (the RNG only picks among equals)");
  eq(plan(2027, {}).search.seed, 2027, "the default seed is the year");
  eq(plan(2027, { seed: "abc" }).search.seed, "abc", "a string seed is hashed (FNV-1a, as generator.js)");
}

/* =================================================================== G */
step("G1: the derived East week - a unit on any day of one takes him in that week's role");
{
  const sr = { f: { eastFeed: { enabled: true, deriveFrom: "2026-11-02" } } };
  const p = plan(2027, { surgeonRules: sr, east: { eastDerived: [{ surgeonId: "f", weekMonday: "2027-11-22", silvisRole: "primary" }, { surgeonId: "f", weekMonday: "2027-05-31", silvisRole: "backup" }] } });
  eq(byName(p, "Thanksgiving").primary, "f", "his derived Silvis-primary week covers Thanksgiving: he is its primary");
  eq(byName(p, "Memorial Day").backup, "f", "the derived backup week covers Mon 5/31 of the Sat-Mon unit: he is its backup");
  eq(blockedOf(p, "Thanksgiving", "f", "backup"), ["derived-lock:primary"], "he cannot take the other role");
  eq(blockedOf(p, "Thanksgiving", "a", "primary"), ["derived-lock-held:f"], "nobody else can take his role");
  ok(byName(p, "Thanksgiving").why.some((w) => /derived East week \(primary\)/.test(w)), "the why names it");
  wellFormed(p, ["a", "b", "c", "d", "e", "f"], "G1");
  const early = plan(2027, { surgeonRules: { f: { eastFeed: { enabled: true, deriveFrom: "2028-01-03" } } }, east: { eastDerived: [{ surgeonId: "f", weekMonday: "2027-11-22", silvisRole: "primary" }] } });
  eq(blockedOf(early, "Thanksgiving", "a", "primary"), [], "a week before eastFeed.deriveFrom derives nothing");
  const bad = plan(2027, { surgeonRules: sr, east: { eastDerived: [{ surgeonId: "f", weekMonday: "2027-11-22" }] } });
  ok(bad.warnings.some((w) => /^east\.eastDerived\[0\]: ignored/.test(w)), "a malformed row is named");
}

step("G2: a derived holder who is refused leaves the slot OPEN - said loudly, never filled by someone the week excludes");
{
  const sr = { f: { eastFeed: { enabled: true } } };
  const p = plan(2027, { surgeonRules: sr, east: { eastDerived: [{ surgeonId: "f", weekMonday: "2027-11-22", silvisRole: "primary" }] }, vacations: [{ person_id: "f", start_date: "2027-11-27", end_date: "2027-11-27" }] });
  eq(byName(p, "Thanksgiving").primary, null, "Thanksgiving primary stays open");
  ok(p.warnings.some((w) => /^The derived East week makes Foxtrot the Thanksgiving 2027 primary but [^-]*.*time-off:2027-11-27 - nobody can hold that slot$/.test(w)), "warning names the clash: " + JSON.stringify(p.warnings));
  ok(p.relaxed.length > 0 && p.relaxed.every((r) => /^shape: /.test(r)), "pass 3 lists the shape it could not keep (one surgeon short of a major): " + JSON.stringify(p.relaxed));
  ok(p.warnings.some((w) => /^OPEN: Thanksgiving 2027 primary - every surgeon is refused/.test(w)), "and the open slot");
  eq(p.search.pass, 3, "pass 3 (open slots allowed) - the only way to a plan");
  ok(p.assignments.filter((a) => a.unit.name !== "Thanksgiving").every((a) => a.primary && a.backup), "every other slot is filled");
}

step("G3: the seed's own limits - Acton never Thanksgiving, Khan never Christmas (9/30, both roles), Philip one major per 12 months");
{
  const p = H.planHolidays(2027, { units: seed.holidays.units["2027"], roster: seed.roster, surgeonRules: seed.surgeonRules, groupRules: seed.groupRules, history: [] });
  eq([blockedOf(p, "Thanksgiving", "s3", "primary"), blockedOf(p, "Thanksgiving", "s3", "backup")], [["holiday-opt-out:Thanksgiving"], ["holiday-opt-out:Thanksgiving"]], "Acton");
  eq([blockedOf(p, "Christmas", "s1", "primary"), blockedOf(p, "Christmas", "s1", "backup")], [["holiday-opt-out:Christmas", "east-busy"], ["holiday-opt-out:Christmas"]], "Khan: the opt-out on both roles, the standing East day on the primary");
  const ph = H.planHolidays(2027, { units: seed.holidays.units["2027"], roster: seed.roster, surgeonRules: seed.surgeonRules, groupRules: seed.groupRules, history: H26(["s1", "s2"], ["s3", "s4"], ["s5", "s6"]) });
  eq([blockedOf(ph, "Thanksgiving", "s4", "primary"), blockedOf(ph, "Thanksgiving", "s4", "backup"), blockedOf(ph, "Christmas", "s4", "primary")], [["max-major-holidays:1"], ["max-major-holidays:1"], []], "Philip: Christmas 2026 -> Thanksgiving 2027 is 11 months (refused), Christmas 2027 is 12 (allowed)");
}

/* =================================================================== H */
step("H1: the 2027 plan on the seed inputs and the 2026 holders as published 9/23 (verified on the live rows 10/1)");
{
  // live schedule_days: Thanksgiving 11/26-29 Khan / Philip, Christmas 12/24-25 Acton / Fierce, New Year's 12/31 - 1/1 Burchett / Khan
  const hist = H26(["s1", "s4"], ["s3", "s5"], ["s2", "s1"]);
  const p = H.planHolidays(2027, { units: seed.holidays.units["2027"], roster: seed.roster, surgeonRules: seed.surgeonRules, groupRules: seed.groupRules, history: hist, vacations: SA.seedToTimeOffRows(seed), east: {} });
  eq([p.search.pass, p.relaxed, p.warnings], [1, [], []], "pass 1, nothing relaxed, no warnings");
  const h = holders(p);
  eq([h.Thanksgiving, h.Christmas, h[NY]], [["s6", "s1"], ["s4", "s2"], ["s5", "s3"]], "majors: Thanksgiving Sarkar / Khan, Christmas Philip / Burchett, New Year's Fierce / Acton");
  eq(p.assignments.filter((a) => a.unit.tier === "minor").map((a) => a.primary).sort(), ["s1", "s2", "s3"], "minor primaries: Khan, Burchett, Acton (the major backups)");
  eq(p.assignments.filter((a) => a.unit.tier === "minor").map((a) => a.backup).sort(), ["s4", "s5", "s6"], "minor backups: Philip, Fierce, Sarkar (the major primaries)");
  eq([h["Memorial Day"], h["July 4th"], h["Labor Day"]], [["s3", "s6"], ["s2", "s5"], ["s1", "s4"]], "which minor: the seed-2027 draw among the 36 tied plans (no 2026 minors on record)");
  eq(p.search.tiedPlans, 36, "36 tied plans = 3! minor primaries x 3! minor backups");
  eq(p.search.cost, { open: 0, shape: 0, repeats: 0, load: p.search.cost.load, alternation: 0, primaryRate: 0, sameHoliday: 1, unitLength: 44 }, "cost: the one same-holiday tie (Khan's Thanksgiving backup) is forced");
  ok(Math.abs(p.search.cost.load - 2) < 1e-9, "load term: six majors x the holders' load = 2");
  eq(["s1", "s2", "s3", "s4", "s5", "s6"].map((id) => [p.counts[id].before.major.primary, p.counts[id].before.major.any, p.counts[id].before.major.eligible]), [[1, 2, 3], [1, 1, 3], [1, 1, 3], [0, 1, 3], [0, 1, 3], [0, 0, 3]], "2026 major counts: primary / any / eligible");
  eq(["s1", "s2", "s3", "s4", "s5", "s6"].map((id) => p.counts[id].lastYearDays.major), [6, 2, 2, 4, 2, 0], "2026 major days held: Khan 6 (Thanksgiving 4 + New Year's 2), Philip 4, Sarkar 0");
  // the plan from the schedule rows themselves (holidayPlanHistory) is the same
  const sched = {};
  ["2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"].forEach((d) => { sched[d] = { primary: "s1", backup: "s4" }; });
  ["2026-12-24", "2026-12-25"].forEach((d) => { sched[d] = { primary: "s3", backup: "s5" }; });
  ["2026-12-31", "2027-01-01"].forEach((d) => { sched[d] = { primary: "s2", backup: "s1" }; });
  const q = H.planHolidays(2027, { units: seed.holidays.units["2027"], roster: seed.roster, surgeonRules: seed.surgeonRules, groupRules: seed.groupRules, schedule: sched, holidays: seed.holidays, vacations: SA.seedToTimeOffRows(seed) });
  eq(holders(q), h, "built from the schedule rows: the same plan");
}

/* =================================================================== I */
step("I1: ten simulated years (2027-2036) on the seed rules - rotation, alternation, no repeat, every limit");
{
  const U = (y) => (y === 2027 ? seed.holidays.units["2027"] : UNITS(y));
  const daysOf = (y, n) => U(y).find((u) => u.name === n).days;
  const ids = seed.roster.map((r) => r.id);
  const KHAN = "s1", BURCHETT = "s2", ACTON = "s3", PHILIP = "s4", FIERCE = "s5", SARKAR = "s6";
  // East: Khan forecast-busy over July 4th 2029 and New Year's 2030; Fierce's derived weeks - Silvis PRIMARY over Christmas
  // 2032 (an even year, against the rotation) and Silvis BACKUP over Mon 5/30 of Memorial Day 2033; vacations (review fix
  // J: on slots the rotation gives them - the run without vacations below pins that, so the check stays binding):
  // Burchett over Memorial Day 2032, Sarkar over Thanksgiving 2034.
  const fc = {}; daysOf(2029, "July 4th").concat(daysOf(2030, NY)).forEach((d) => { fc[d] = 0.8; });
  const east = { eastForecast: { [KHAN]: fc }, eastDerived: [{ surgeonId: FIERCE, weekMonday: "2032-12-20", silvisRole: "primary" }, { surgeonId: FIERCE, weekMonday: "2033-05-30", silvisRole: "backup" }] };
  const FORCED = { "2032|Christmas|primary": FIERCE, "2033|Memorial Day|backup": FIERCE };
  const md32 = daysOf(2032, "Memorial Day"), tg34 = daysOf(2034, "Thanksgiving");
  const vacations = [{ person_id: BURCHETT, start_date: md32[0], end_date: md32[md32.length - 1] }, { person_id: SARKAR, start_date: tg34[0], end_date: tg34[tg34.length - 1] }];
  {
    const hist0 = H26([KHAN, PHILIP], [ACTON, FIERCE], [BURCHETT, KHAN]), got = {};
    for (let y = 2027; y <= 2036; y++) {
      H.planHolidays(y, { units: U(y), roster: seed.roster, surgeonRules: seed.surgeonRules, groupRules: seed.groupRules, history: hist0, east: east, vacations: [] }).assignments.forEach((a) => { got[y + "|" + a.unit.name] = a.primary; hist0.push({ year: y, name: a.unit.name, primary: a.primary, backup: a.backup }); });
    }
    eq([got["2032|Memorial Day"], got["2034|Thanksgiving"]], [BURCHETT, SARKAR], "without the vacations Burchett is the Memorial Day 2032 primary and Sarkar the Thanksgiving 2034 primary - so the vacations below must move them");
  }
  const history = H26([KHAN, PHILIP], [ACTON, FIERCE], [BURCHETT, KHAN]);
  const life = {}; ids.forEach((id) => { life[id] = { major: 0, minor: 0 }; });
  history.forEach((h) => { life[h.primary].major++; });
  const philipMajors = [hplMonth("2026-11-26")];
  function hplMonth(iso) { return Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)); }
  const spreads = [];
  for (let y = 2027; y <= 2036; y++) {
    const p = H.planHolidays(y, { units: U(y), roster: seed.roster, surgeonRules: seed.surgeonRules, groupRules: seed.groupRules, history: history, east: east, vacations: vacations });
    wellFormed(p, ids, String(y));
    eq(p.warnings, [], y + ": no warnings");
    const last = {}; history.filter((h) => h.year === y - 1).forEach((h) => { last[h.name] = h; });
    let repeats = 0;
    p.assignments.forEach((a) => {
      const n = a.unit.name, L = last[n];
      ["primary", "backup"].forEach((role) => {
        if (L && L[role] === a[role]) { repeats++; ok(FORCED[y + "|" + n + "|" + role] === a[role], y + ": " + n + " " + role + " repeats " + a[role] + " although no derived week forces it"); }
        if (FORCED[y + "|" + n + "|" + role]) eq(a[role], FORCED[y + "|" + n + "|" + role], y + ": the derived week's holder on " + n + " " + role);
      });
      ok(!(n === "Thanksgiving" && (a.primary === ACTON || a.backup === ACTON)), y + ": Acton on Thanksgiving");
      ok(!(n === "Christmas" && (a.primary === KHAN || a.backup === KHAN)), y + ": Khan on Christmas");
      ok(!((y === 2029 && n === "July 4th") || (y === 2030 && n === NY)) || a.primary !== KHAN, y + ": Khan primary on a forecast-busy " + n);
      ok(!(y === 2032 && n === "Memorial Day") || (a.primary !== BURCHETT && a.backup !== BURCHETT), y + ": Burchett on his vacation");
      ok(!(y === 2034 && n === "Thanksgiving") || (a.primary !== SARKAR && a.backup !== SARKAR), y + ": Sarkar on her vacation");
      if (a.unit.tier === "major" && (a.primary === PHILIP || a.backup === PHILIP)) philipMajors.push(hplMonth(a.unit.days[0]));
      if (a.primary) life[a.primary][a.unit.tier]++;
      history.push({ year: y, name: n, primary: a.primary, backup: a.backup });
    });
    eq(p.relaxed.length, repeats, y + ": every repeat is listed in relaxed (and only a derived week ever forces one)");
    const sp = ["major", "minor"].map((t) => Math.max(...ids.map((id) => life[id][t])) - Math.min(...ids.map((id) => life[id][t])));
    spreads.push(sp);
    ok(sp[0] <= 2 && sp[1] <= 2, y + ": lifetime primary counts never spread by more than two: " + JSON.stringify(sp));
    if (y <= 2031) ok(sp[0] <= 1 && sp[1] <= 1, y + ": before the first derived-week override the rotation is exact (spread <= 1): " + JSON.stringify(sp));
  }
  ok(spreads[spreads.length - 1].every((s) => s <= 1), "by 2036 the rotation has caught up (spread <= 1): " + JSON.stringify(spreads));
  philipMajors.sort((a, b) => a - b);
  for (let i = 1; i < philipMajors.length; i++) ok(philipMajors[i] - philipMajors[i - 1] >= 12, "Philip holds two majors within 12 months (month indexes " + philipMajors[i - 1] + ", " + philipMajors[i] + ")");
  ok(philipMajors.length === 11, "Philip holds one major a year (2026 + ten): " + philipMajors.length);
}

/* ===================================================================
   Prompt 25 steps 3-5 - the plan in the app: holidayPlanCheck (J), holidayPlanSwapOptions (K), holidayPlanRecheck (L),
   holidayPlanAcceptRows + holidayPlanInputs (M), and what the generator / a trade do with the accepted rows (N). */
const R = require("../rules.js");
const GEN = require("../generator.js");
const KHAN = "s1", BURCHETT = "s2", ACTON = "s3", PHILIP = "s4", FIERCE = "s5", SARKAR = "s6";
const HIST26 = H26([KHAN, PHILIP], [ACTON, FIERCE], [BURCHETT, KHAN]);
const O27 = (extra) => Object.assign({ units: seed.holidays.units["2027"], roster: seed.roster, surgeonRules: seed.surgeonRules, groupRules: seed.groupRules, history: HIST26, east: {}, vacations: [] }, extra || {});
const P27 = H.planHolidays(2027, O27());
const keysOf = (list) => list.map((b) => b.rule + ":" + (b.unit || "") + ":" + (b.role || "") + ":" + b.id).sort();
const asMap = (assignments) => { const m = {}; assignments.forEach((a) => { m[a.unit.name] = { primary: a.primary, backup: a.backup }; }); return m; };
const withSlot = (assignments, unit, role, id) => assignments.map((a) => a.unit.name === unit ? Object.assign({}, a, { [role]: id }) : a);
const close = (a, b) => Object.keys(a).every((k) => Math.abs(a[k] - b[k]) < 1e-9);

/* =================================================================== J */
step("J1: holidayPlanCheck - the planner's own plan breaks nothing and its cost vector IS the search's (one refusal logic)");
{
  const c = H.holidayPlanCheck(2027, P27.assignments, O27());
  eq([c.ok, c.breaks, c.soft, c.open], [true, [], [], []], "the 2027 plan: no break, no soft note, no open slot");
  ok(close(c.cost, P27.search.cost), "cost " + JSON.stringify(c.cost) + " = search.cost " + JSON.stringify(P27.search.cost));
  eq(H.holidayPlanCheck(2027, asMap(P27.assignments), O27()).cost, c.cost, "the { <unit>: { primary, backup } } shape reads the same");
  // across the rule sections: alternation impossible (C5), pass 2 (F2), pass 3 with an open slot (G2), ten seeds
  const cases = [
    ["C5 backupOptOut", () => plan(2027, { surgeonRules: { d: { backupOptOut: true } } }), { surgeonRules: { d: { backupOptOut: true } } }],
    ["G2 derived + vacation (pass 3)", () => plan(2027, { surgeonRules: { f: { eastFeed: { enabled: true } } }, east: { eastDerived: [{ surgeonId: "f", weekMonday: "2027-11-22", silvisRole: "primary" }] }, vacations: [{ person_id: "f", start_date: "2027-11-27", end_date: "2027-11-27" }] }),
      { surgeonRules: { f: { eastFeed: { enabled: true } } }, east: { eastDerived: [{ surgeonId: "f", weekMonday: "2027-11-22", silvisRole: "primary" }] }, vacations: [{ person_id: "f", start_date: "2027-11-27", end_date: "2027-11-27" }] }]
  ];
  for (let s = 1; s <= 6; s++) cases.push(["seed " + s + " + 2026 history", () => plan(2027, { history: H26(["a", "b"], ["c", "d"], ["e", "f"]), seed: s }), { history: H26(["a", "b"], ["c", "d"], ["e", "f"]) }]);
  cases.forEach(([label, mk, o]) => {
    const p = mk();
    const k = H.holidayPlanCheck(2027, p.assignments, Object.assign({ units: UNITS(2027), roster: R6, surgeonRules: {}, groupRules: {}, history: [], east: {}, vacations: [] }, o));
    ok(close(k.cost, p.search.cost), label + ": cost " + JSON.stringify(k.cost) + " = search.cost " + JSON.stringify(p.search.cost));
    eq(k.open.length, p.search.cost.open, label + ": open slots listed = the cost's open term");
    if (p.search.pass === 1) eq(k.breaks, [], label + ": a pass-1 plan breaks nothing");
    if (p.search.pass === 3) ok(k.breaks.length > 0 && k.breaks.every((b) => b.rule === "shape") && k.breaks.length === p.relaxed.length, label + ": pass 3 - exactly the shape the planner relaxed, as breaks: " + JSON.stringify(k.breaks.map((b) => b.text)));
  });
  const alt = H.holidayPlanCheck(2027, cases[0][1]().assignments, { units: UNITS(2027), roster: R6, surgeonRules: { d: { backupOptOut: true } }, groupRules: {}, history: [] });
  ok(alt.ok && alt.soft.length === 2 && alt.soft.every((x) => x.rule === "alternation"), "alternation misses are SOFT notes, not breaks: " + JSON.stringify(alt.soft));
}

step("J2: holidayPlanCheck names every break kind - refused (with the reasons), same-person, no-repeat, shape, max-major, not-in-pool; open is listed apart");
{
  const A = P27.assignments;
  const vac = H.holidayPlanCheck(2027, A, O27({ vacations: [{ person_id: SARKAR, start_date: "2027-11-27", end_date: "2027-11-27" }] }));
  eq(keysOf(vac.breaks), ["refused:Thanksgiving:primary:s6"], "a vacation inside Sarkar's Thanksgiving primary");
  eq(vac.breaks[0].reasons, ["day-before-vacation", "time-off:2027-11-27"], "...with the planner's own reasons");
  eq(vac.breaks[0].text, "Sarkar cannot be the Thanksgiving 2027 primary: day-before-vacation, time-off:2027-11-27", "...and the text");
  const same = H.holidayPlanCheck(2027, withSlot(A, "Christmas", "backup", PHILIP), O27());
  ok(keysOf(same.breaks).indexOf("same-person:Christmas::s4") >= 0, "Philip both roles of Christmas: " + JSON.stringify(keysOf(same.breaks)));
  const rep = H.holidayPlanCheck(2027, withSlot(withSlot(A, "Thanksgiving", "backup", PHILIP), "Christmas", "backup", KHAN), O27());
  ok(rep.breaks.some((b) => b.rule === "no-repeat" && b.id === PHILIP && b.unit === "Thanksgiving" && b.role === "backup"), "Philip Thanksgiving backup 2026 and 2027: no-repeat");
  ok(rep.breaks.some((b) => b.rule === "refused" && b.id === KHAN && b.unit === "Christmas" && b.reasons.indexOf("holiday-opt-out:Christmas") >= 0), "...and Khan on Christmas is refused (his opt-out)");
  const shape = H.holidayPlanCheck(2027, withSlot(A, "Memorial Day", "backup", BURCHETT), O27());
  eq(shape.breaks.filter((b) => b.rule === "shape").map((b) => [b.id, b.tier]).sort(), [["s2", "minor"], ["s6", "minor"]], "Burchett replaces Sarkar on Memorial Day: two minors for him, none for her - both named");
  ok(/^Burchett holds 2 minor holidays \(1 primary\) - the minor tier gives each 1 with at most 1 primary$/.test(shape.breaks.find((b) => b.id === BURCHETT).text), "shape text: " + shape.breaks.find((b) => b.id === BURCHETT).text);
  // max-major: Philip (one per rolling 12 months) on Christmas AND New Year's 2027
  const mm = H.holidayPlanCheck(2027, withSlot(A, "New Year's", "backup", PHILIP), O27());
  const mb = mm.breaks.find((b) => b.rule === "max-major");
  ok(mb && mb.id === PHILIP && mb.slots.length === 2, "Philip two majors within 12 months: " + JSON.stringify(mm.breaks.map((b) => b.text)));
  ok(/at most 1 per rolling 12 months$/.test(mb.text), "max-major text: " + mb.text);
  const stranger = H.holidayPlanCheck(2027, withSlot(A, "Labor Day", "primary", "s9"), O27());
  ok(stranger.breaks.some((b) => b.rule === "not-in-pool" && b.id === "s9"), "an id outside the pool: not-in-pool");
  const opened = H.holidayPlanCheck(2027, withSlot(A, "July 4th", "backup", null), O27());
  eq(opened.open, [{ unit: "July 4th", role: "backup" }], "an open slot is listed in open");
  ok(opened.breaks.every((b) => b.rule === "shape"), "...it is not a break itself (only the shape it leaves short is)");
  const unk = H.holidayPlanCheck(2027, A.concat([{ unit: { name: "Easter" }, primary: KHAN, backup: SARKAR }]), O27());
  ok(unk.warnings.indexOf("the plan names Easter, not a holiday unit of 2027 - ignored") >= 0, "an unknown unit is named, never guessed");
}

/* =================================================================== K */
step("K1: holidayPlanSwapOptions - every swap with another holder and every replacement, judged by the same check, ranked by the planner's order");
{
  const s = H.holidayPlanSwapOptions(2027, P27.assignments, "Thanksgiving", "primary", O27());
  eq(s.current, SARKAR, "the slot's holder");
  // review fix A: one surgeon in both roles of a unit is structural (the database's CHECK refuses the row) - never offered
  eq(s.options.filter((o) => o.kind === "swap").length, 8, "8 swaps (every other filled slot: 12 minus this one minus her Memorial Day backup, minus Khan's Labor Day primary (Khan would hold both Thanksgiving roles) and Acton's Memorial Day primary (Sarkar would hold both Memorial Day roles))");
  eq(s.options.filter((o) => o.kind === "replace").length, 4, "4 replacements (the pool minus Sarkar, minus Khan - the Thanksgiving backup)");
  s.options.forEach((o, i) => {
    const k = H.holidayPlanCheck(2027, o.assignments, O27());
    eq(keysOf(o.breaks), keysOf(k.breaks), "option " + i + " (" + o.text + "): its breaks = holidayPlanCheck of its assignments");
    eq(o.ok, k.ok, "option " + i + " ok");
  });
  for (let i = 1; i < s.options.length; i++) ok(s.options[i].breaks.length >= s.options[i - 1].breaks.length, "breaks never decrease down the list (" + i + ")");
  eq(s.options.slice(0, 3).map((o) => o.text), ["swap with Fierce (New Year's primary)", "swap with Philip (Christmas primary)", "swap with Burchett (Christmas backup)"], "the three valid swaps first, the two major primaries before the backup (lower cost: Burchett would be primary in both tiers)");
  ok(s.options.slice(0, 3).every((o) => o.ok && !o.added.length), "...and they keep every rule");
  ok(s.options[2].soft.some((x) => x.rule === "alternation" && x.id === BURCHETT), "the third one costs alternation (soft): " + JSON.stringify(s.options[2].soft));
  const acton = s.options.find((o) => o.kind === "swap" && o.id === ACTON);
  ok(acton && acton.added.some((b) => b.rule === "refused" && b.id === ACTON && b.reasons.indexOf("holiday-opt-out:Thanksgiving") >= 0), "the swap with Acton adds his Thanksgiving opt-out: " + JSON.stringify(acton && acton.added));
  eq(acton.with, { unit: "New Year's", role: "backup", id: SARKAR }, "...and says where Sarkar goes");
  const back = H.holidayPlanSwapOptions(2027, acton.assignments, "Thanksgiving", "primary", O27()).options.find((o) => o.kind === "swap" && o.id === SARKAR);
  eq(asMap(back.assignments), asMap(P27.assignments), "the same swap twice is the original plan");
  eq(back.resolved.map((b) => b.rule), ["refused"], "...and resolves the opt-out it had added");
}

step("K2: holidayPlanSwapOptions - an open slot offers replacements only; a bad role throws; an unknown unit lists nothing");
{
  const s = H.holidayPlanSwapOptions(2027, withSlot(P27.assignments, "July 4th", "backup", null), "July 4th", "backup", O27());
  ok(s.current === null && s.options.length === 5 && s.options.every((o) => o.kind === "replace") && !s.options.some((o) => o.id === BURCHETT), "open: the pool members but Burchett (the July 4th primary - never both roles)");
  ok(s.options[0].ok, "...the first one keeps every rule (the holder the planner left out): " + s.options[0].text);
  let threw = null; try { H.holidayPlanSwapOptions(2027, P27.assignments, "Christmas", "both", O27()); } catch (e) { threw = e.message; }
  eq(threw, 'holidayPlanSwapOptions: role must be primary or backup, got "both"', "role checked");
  const u = H.holidayPlanSwapOptions(2027, P27.assignments, "Easter", "primary", O27());
  ok(u.options.length === 0 && u.warnings.indexOf("Easter is not a holiday unit of 2027") >= 0, "unknown unit");
}

step("K3: review fix A - no swap or replacement ever leaves one surgeon in both roles of a unit (structural: sql/schema.sql CHECK schedule_days_distinct_roles); review fix B - with today, no swap with a started unit");
{
  let n = 0;
  P27.assignments.forEach((a) => ["primary", "backup"].forEach((role) => {
    H.holidayPlanSwapOptions(2027, P27.assignments, a.unit.name, role, O27()).options.forEach((o) => {
      n++;
      ok(o.assignments.every((x) => !x.primary || x.primary !== x.backup), a.unit.name + " " + role + ": '" + o.text + "' leaves " + JSON.stringify(o.assignments.find((x) => x.primary && x.primary === x.backup)) + " with one surgeon in both roles");
      ok(!o.added.some((b) => b.rule === "same-person"), a.unit.name + " " + role + ": '" + o.text + "' adds same-person");
    });
  }));
  ok(n > 100, "every option of every slot of the 2027 plan checked (" + n + ")");
  const xm = H.holidayPlanSwapOptions(2027, P27.assignments, "Christmas", "primary", O27()).options;
  eq(xm.filter((o) => o.id === BURCHETT).map((o) => o.text), ["swap with Burchett (Christmas backup)"], "Christmas primary: Burchett (the Christmas backup) only by trading roles with Philip - no 'replace with Burchett', no 'swap with Burchett (July 4th primary)'");
  // a plan that already holds the clash: only moves that clear it are offered on that unit
  const clash = withSlot(P27.assignments, "Christmas", "backup", PHILIP);
  const fix = H.holidayPlanSwapOptions(2027, clash, "Christmas", "backup", O27()).options;
  ok(fix.length > 0 && fix.every((o) => o.assignments.find((x) => x.unit.name === "Christmas").backup !== PHILIP) && fix.every((o) => o.resolved.some((b) => b.rule === "same-person")), "Christmas Philip / Philip: every backup move clears it");
  // review fix B: today 2027-08-15 - Memorial Day and July 4th have started; Labor Day has not
  const lab = H.holidayPlanSwapOptions(2027, P27.assignments, "Labor Day", "primary", O27({ today: "2027-08-15" })).options;
  ok(lab.length > 0 && !lab.some((o) => o.kind === "swap" && ["Memorial Day", "July 4th"].indexOf(o.with.unit) >= 0), "no swap with Memorial Day / July 4th (started): " + lab.map((o) => o.text).join("; "));
  ok(lab.some((o) => o.kind === "replace"), "...replacements stay offered (they touch Labor Day only)");
  ok(H.holidayPlanSwapOptions(2027, P27.assignments, "Labor Day", "primary", O27()).options.some((o) => o.kind === "swap" && o.with.unit === "Memorial Day"), "...without today the Memorial Day swap is offered (the filter is today's)");
  ok(H.holidayPlanSwapOptions(2027, P27.assignments, "Labor Day", "primary", O27({ today: "2027-07-03" })).options.every((o) => o.kind !== "swap" || o.with.unit !== "July 4th"), "a unit starting today counts as started");
}

/* =================================================================== M (before L: L re-checks rows M builds) */
step("M1: holidayPlanAcceptRows - every unit day, both roles locked, source holiday-plan-2027, the unit-only note; nothing to replace on an empty map");
const ACC = H.holidayPlanAcceptRows(2027, P27.assignments, {}, { units: seed.holidays.units["2027"], today: "2026-10-01" });
{
  eq(ACC.source, "holiday-plan-2027", "source");
  eq(ACC.days.length, 17, "17 unit days (3 + 3 + 3 + 4 + 2 + 2)");
  eq([ACC.conflicts, ACC.skipped, ACC.changes], [[], [], 34], "no conflict, nothing skipped, 34 holder changes (17 days x 2 roles)");
  eq(ACC.rows["2027-11-25"], { primary: SARKAR, backup: KHAN, primaryLocked: true, backupLocked: true, source: "holiday-plan-2027", externalCover: null, note: "Thanksgiving unit - holiday plan 2027" }, "Thanksgiving Thu");
  eq(ACC.rows["2028-01-01"].note, "New Year's unit - holiday plan 2027", "the 2028 day of New Year's 2027 belongs to the 2027 plan");
  ok(ACC.days.every((d) => ACC.rows[d].primaryLocked && ACC.rows[d].backupLocked && ACC.rows[d].source === "holiday-plan-2027"), "every day: both locks, the plan source");
  const words = seed.roster.map((r) => r.name).concat(seed.roster.map((r) => r.code));
  ok(ACC.days.every((d) => !words.some((w) => ACC.rows[d].note.indexOf(w) >= 0) && /^[A-Za-z0-9' ]+ unit - holiday plan 2027$/.test(ACC.rows[d].note)), "the note names the unit and the plan only - no surgeon name or code, no reason (schedule_days is anon-readable)");
  eq(H.holidayPlanNote("Christmas", "2027"), "Christmas unit - holiday plan 2027", "holidayPlanNote");
  eq(ACC.units.map((u) => [u.name, u.primary, u.backup]), P27.assignments.map((a) => [a.unit.name, a.primary, a.backup]), "the unit list = the plan");
  eq(H.holidayPlanUnitLines(ACC.units.slice(3, 4), (id) => ({ s6: "Sarkar", s1: "Khan" })[id]), ["Thanksgiving 11/25-11/28: P Sarkar, B Khan"], "holidayPlanUnitLines");
}

step("M2: holidayPlanAcceptRows - a held slot is a conflict (locked or published), the same holder is not; an external cover is replaced; an open plan role keeps what is on file unless it clashes");
{
  const sched = {
    "2027-11-25": { primary: KHAN, backup: BURCHETT, primaryLocked: true, backupLocked: false, source: "manual", externalCover: null, note: "x" },
    "2027-11-26": { primary: SARKAR, backup: null, primaryLocked: false, backupLocked: false, source: "generated", externalCover: null, note: null },
    "2027-12-24": { primary: null, backup: null, primaryLocked: true, backupLocked: false, source: "manual-external", externalCover: "Locum", note: null }
  };
  const r = H.holidayPlanAcceptRows(2027, P27.assignments, sched, { units: seed.holidays.units["2027"] });
  eq(r.conflicts, [
    { day: "2027-11-25", unit: "Thanksgiving", role: "primary", from: KHAN, to: SARKAR, locked: true, clash: false },
    { day: "2027-11-25", unit: "Thanksgiving", role: "backup", from: BURCHETT, to: KHAN, locked: false, clash: false },
    { day: "2027-12-24", unit: "Christmas", role: "primary", from: "ext:Locum", to: PHILIP, locked: true, clash: false }
  ], "a locked different holder, a published (unlocked) different holder and an external cover - each named; 11/26 (Sarkar already primary) is no conflict");
  eq([r.rows["2027-11-26"].primary, r.rows["2027-11-26"].primaryLocked, r.rows["2027-11-26"].backup], [SARKAR, true, KHAN], "the same holder gets the lock and the plan source");
  eq([r.rows["2027-12-24"].primary, r.rows["2027-12-24"].externalCover], [PHILIP, null], "a roster primary clears the external cover");
  const half = H.holidayPlanAcceptRows(2027, withSlot(P27.assignments, "Thanksgiving", "backup", null), { "2027-11-27": { primary: null, backup: BURCHETT, primaryLocked: false, backupLocked: false, source: "generated" }, "2027-11-28": { primary: null, backup: SARKAR, primaryLocked: false, backupLocked: true, source: "manual" } }, { units: seed.holidays.units["2027"], only: ["Thanksgiving"] });
  eq([half.rows["2027-11-27"].backup, half.rows["2027-11-27"].backupLocked], [BURCHETT, false], "an open plan role keeps the holder on file, unlocked as it was");
  eq([half.rows["2027-11-28"].backup, half.rows["2027-11-28"].backupLocked], [null, false], "...unless he is the plan's primary that day - cleared");
  eq(half.conflicts.filter((c) => c.clash), [{ day: "2027-11-28", unit: "Thanksgiving", role: "backup", from: SARKAR, to: null, locked: true, clash: true }], "...and named as a clash");
  eq(half.days, ["2027-11-25", "2027-11-26", "2027-11-27", "2027-11-28"], "only: Thanksgiving's days alone");
  const past = H.holidayPlanAcceptRows(2027, P27.assignments, { "2027-07-03": { primary: KHAN, backup: SARKAR }, "2027-07-04": { primary: KHAN, backup: SARKAR }, "2027-07-05": { primary: KHAN, backup: ACTON } }, { units: seed.holidays.units["2027"], today: "2027-07-04" });
  eq(past.skipped, [
    { unit: "Memorial Day", why: "starts 2027-05-29, before today - left as on file", started: true, primary: null, backup: null },
    { unit: "July 4th", why: "starts 2027-07-03, before today - left as on file", started: true, primary: KHAN, backup: null }
  ], "a unit that started before today is left as on file - with its holders on file (one per role, else null: Sarkar / Acton split the backup)");
  ok(!past.days.some((d) => d <= "2027-07-05"), "...and none of its days is written");
  // review fix C: a unit that STARTS today is under way (07:00 -> 07:00) - left as on file too
  const startsToday = H.holidayPlanAcceptRows(2027, P27.assignments, {}, { units: seed.holidays.units["2027"], today: "2027-09-04" });
  eq(startsToday.skipped.map((x) => [x.unit, x.why, x.started]), [["Memorial Day", "starts 2027-05-29, before today - left as on file", true], ["July 4th", "starts 2027-07-03, before today - left as on file", true], ["Labor Day", "starts 2027-09-04, today - left as on file", true]], "Labor Day starts today (Sat 9/4): skipped");
  eq(startsToday.days[0], "2027-11-25", "the first day written is Thanksgiving's");
  eq(H.holidayPlanAcceptRows(2027, P27.assignments, {}, { units: seed.holidays.units["2027"], today: "2027-09-03" }).days.slice(0, 3), ["2027-09-04", "2027-09-05", "2027-09-06"], "the day before, Labor Day is still written");
  // review fix E: a note already on a unit day that is not a holiday-plan note is kept (and listed for the confirm)
  eq([r.rows["2027-11-25"].note, r.rows["2027-11-26"].note], ["x", "Thanksgiving unit - holiday plan 2027"], "the 11/25 note 'x' is kept; an empty note gets the plan note");
  eq(r.keptNotes, [{ day: "2027-11-25", unit: "Thanksgiving", note: "x" }], "keptNotes names it");
  const replan = H.holidayPlanAcceptRows(2027, P27.assignments, { "2027-11-25": { primary: SARKAR, backup: KHAN, note: "Thanksgiving unit - holiday plan 2026" } }, { units: seed.holidays.units["2027"], only: ["Thanksgiving"] });
  eq([replan.rows["2027-11-25"].note, replan.keptNotes], ["Thanksgiving unit - holiday plan 2027", []], "an older holiday-plan note is the plan's own - replaced, not kept");
}

step("M2b: review fix A - one surgeon in both roles of a unit is structural: holidayPlanAcceptRows skips the unit (the database's CHECK would refuse every day of it)");
{
  const same = H.holidayPlanAcceptRows(2027, withSlot(P27.assignments, "Christmas", "backup", PHILIP), {}, { units: seed.holidays.units["2027"] });
  eq(same.skipped, [{ unit: "Christmas", why: "primary and backup are the same surgeon", samePerson: true, id: PHILIP }], "Christmas (Philip / Philip) is skipped, named");
  ok(!same.days.some((d) => d === "2027-12-24" || d === "2027-12-25") && !same.units.some((u) => u.name === "Christmas"), "...no Christmas row, no Christmas unit written");
  eq(same.days.length, 15, "the other five units are written (17 - 2 days)");
  ok(same.days.every((d) => same.rows[d].primary !== same.rows[d].backup), "no written row holds one surgeon twice");
  const sameStarted = H.holidayPlanAcceptRows(2027, withSlot(P27.assignments, "Memorial Day", "backup", ACTON), {}, { units: seed.holidays.units["2027"], today: "2027-06-01" });
  eq(sameStarted.skipped.map((s) => [s.unit, !!s.started, !!s.samePerson]), [["Memorial Day", true, false]], "a unit that has started is left as on file whatever the plan names for it (started, not samePerson - it never blocks an Accept)");
}

step("M2c: review fix F - holidayPlanConflictLines groups the replaced slots by unit + role + holder change, so every one fits the confirm");
{
  const sched = {};
  ["2027-11-25", "2027-11-26", "2027-11-27", "2027-11-28"].forEach((d) => { sched[d] = { primary: KHAN, backup: BURCHETT, primaryLocked: true, backupLocked: false }; });
  sched["2027-11-28"].backup = ACTON;
  ["2027-12-24", "2027-12-25"].forEach((d) => { sched[d] = { primary: null, backup: null, externalCover: "Locum", primaryLocked: true }; });
  const r = H.holidayPlanAcceptRows(2027, P27.assignments, sched, { units: seed.holidays.units["2027"] });
  eq(r.conflicts.length, 10, "10 replaced slots (4 Thanksgiving primaries, 4 backups, 2 Christmas covers)");
  const names = { s1: "Khan", s2: "Burchett", s3: "Acton", s4: "Philip", s6: "Sarkar" };
  const label = (v) => v === null ? "OPEN" : String(v).indexOf("ext:") === 0 ? String(v).slice(4) + " (external)" : names[v];
  eq(H.holidayPlanConflictLines(r.conflicts, label), [
    "Thanksgiving P locked to Khan -> Sarkar (11/25-11/28, 4 days)",
    "Thanksgiving B held by Burchett -> Khan (11/25-11/27, 3 days)",
    "Thanksgiving B held by Acton -> Khan (11/28)",
    "Christmas P locked to Locum (external) -> Philip (12/24-12/25, 2 days)"
  ], "four lines for ten slots - none left out");
  eq(H.holidayPlanConflictLines([{ day: "2027-05-29", unit: "Memorial Day", role: "backup", from: "s1", to: "s6", locked: false }, { day: "2027-05-31", unit: "Memorial Day", role: "backup", from: "s1", to: "s6", locked: false }]), ["Memorial Day B held by s1 -> s6 (5/29, 5/31, 2 days)"], "days that are not a run are listed; the default label prints the value");
  eq(H.holidayPlanConflictLines([]), [], "nothing to replace: no line");
}

step("M2d: review fix B - holidayPlanWrittenCheck: a full Accept that skips a started unit is judged as it will stand (its holders on file)");
{
  const onFile = Object.assign({}, ACC.rows);
  ["2027-05-29", "2027-05-30", "2027-05-31"].forEach((d) => { onFile[d] = Object.assign({}, onFile[d], { primary: BURCHETT, backup: SARKAR }); });
  const acc = H.holidayPlanAcceptRows(2027, P27.assignments, onFile, { units: seed.holidays.units["2027"], today: "2027-06-01" });
  eq(acc.skipped.map((s) => [s.unit, s.started, s.primary, s.backup]), [["Memorial Day", true, BURCHETT, SARKAR]], "Memorial Day has started - Burchett / Sarkar on file stay");
  const wc = H.holidayPlanWrittenCheck(2027, P27.assignments, acc, O27());
  eq(wc.added.map((b) => [b.rule, b.id, b.tier]).sort(), [["shape", BURCHETT, "minor"], ["shape", ACTON, "minor"]], "the year as written: Burchett holds two minor primaries, Acton none - named");
  eq(wc.plan.find((a) => a.unit.name === "Memorial Day").primary, BURCHETT, "...the written plan carries the file's holders");
  eq(H.holidayPlanWrittenCheck(2027, P27.assignments, H.holidayPlanAcceptRows(2027, P27.assignments, {}, { units: seed.holidays.units["2027"], today: "2026-10-01" }), O27()).added, [], "nothing skipped: nothing added");
}

step("M3: holidayPlanInputs - the planHolidays opts from the app's state (time_off + East away / unreviewed ranges; history from the schedule; seed = year)");
{
  const sched = {}; ["2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"].forEach((d) => { sched[d] = { primary: KHAN, backup: PHILIP }; });
  ["2026-12-24", "2026-12-25"].forEach((d) => { sched[d] = { primary: ACTON, backup: FIERCE }; });
  ["2026-12-31", "2027-01-01"].forEach((d) => { sched[d] = { primary: BURCHETT, backup: KHAN }; });
  const state = {
    roster: seed.roster, surgeonRules: seed.surgeonRules, groupRules: seed.groupRules, holidays: seed.holidays, schedule: sched,
    timeOffRows: [{ id: "t1", person_id: BURCHETT, start_date: "2027-07-22", end_date: "2027-08-02", note: null }],
    eastBusyDays: { s1: new Set(["2027-09-05"]) }, eastForecast: {}, eastOverrides: {}, eastDerived: [], eastFeedCoverage: { from: "2026-08-24", to: "2026-11-15" },
    eastVacationRanges: { s1: [{ start: "2027-03-04", end: "2027-03-28" }, { start: "2027-05-07", end: "2027-05-09" }, { start: "2027-06-26", end: "2027-06-28" }] },
    eastVacationReviews: [{ person_id: "s1", start: "2027-05-07", end: "2027-05-09", decision: "home" }, { person_id: "s1", start: "2027-06-26", end: "2027-06-28", decision: "away" }]
  };
  const inp = H.holidayPlanInputs(2027, state);
  eq(inp.vacations, [
    { person_id: BURCHETT, start_date: "2027-07-22", end_date: "2027-08-02" },
    { person_id: KHAN, start_date: "2027-03-04", end_date: "2027-03-28", east: true },
    { person_id: KHAN, start_date: "2027-06-26", end_date: "2027-06-28", east: true }
  ], "time_off rows + the unreviewed and away East ranges (the home one is not a vacation)");
  eq(inp.history.map((h) => [h.year, h.name, h.primary, h.backup]), HIST26.map((h) => [h.year, h.name, [h.primary], [h.backup]]), "history from the schedule's 2026 units");
  eq([inp.seed, inp.units, inp.east.eastBusyDays, inp.historyWarnings], [2027, seed.holidays.units["2027"], state.eastBusyDays, []], "seed = the year, the blob's units, the East pieces passed through");
  const p = H.planHolidays(2027, inp);
  eq(holders(p), holders(H.planHolidays(2027, O27({ vacations: inp.vacations, east: inp.east }))), "planHolidays on the inputs = on the same opts by hand");
  ok(blockedOf(p, "Labor Day", KHAN, "primary").indexOf("east-busy") >= 0, "the East busy day reaches the planner (Khan's Labor Day primary refused)");
  eq(H.holidayPlanInputs(2028, state).units, null, "a year without stored units: units null (planHolidays then warns 'nothing to plan')");
  eq(inp.east.eastClear, { s1: ["2027-05-07", "2027-05-08", "2027-05-09"] }, "review fix H: the home range's days reach the planner as east.eastClear");
}

step("M3b: review fix H - a forecast-busy day inside a 'home' East vacation range does not refuse (rules.js fcApplies = !homeDay); the feed still does");
{
  const fc = { s1: { "2027-07-03": 0.8, "2027-07-04": 0.8, "2027-07-05": 0.8 } };
  const state = (reviews, extra) => Object.assign({ roster: seed.roster, surgeonRules: seed.surgeonRules, groupRules: seed.groupRules, holidays: seed.holidays, schedule: {}, timeOffRows: [], eastBusyDays: {}, eastForecast: fc, eastOverrides: {}, eastDerived: [], eastFeedCoverage: { from: "2026-08-24", to: "2026-11-15" }, eastVacationRanges: { s1: [{ start: "2027-07-02", end: "2027-07-06" }] }, eastVacationReviews: reviews }, extra || {});
  const home = [{ person_id: "s1", start: "2027-07-02", end: "2027-07-06", decision: "home" }];
  const hp = H.planHolidays(2027, H.holidayPlanInputs(2027, state(home)));
  eq(blockedOf(hp, "July 4th", KHAN, "primary"), [], "home: Khan's July 4th primary is not blocked (the forecast is not consulted on a home day)");
  const rx = H.holidayPlanInputs(2027, state(home));
  const noRange = H.planHolidays(2027, Object.assign({}, rx, { east: Object.assign({}, rx.east, { eastClear: {} }) }));
  eq(blockedOf(noRange, "July 4th", KHAN, "primary"), ["east-forecast-busy:0.80"], "without the home range the same forecast refuses (the case the fix covers)");
  eq(blockedOf(H.planHolidays(2027, H.holidayPlanInputs(2027, state([]))), "July 4th", KHAN, "primary"), ["time-off:2027-07-03", "east-forecast-busy:0.80", "time-off:2027-07-04", "time-off:2027-07-05"], "unreviewed: the range is a vacation (time-off on every unit day) and no home day, so the forecast is read too");
  const feed = H.planHolidays(2027, H.holidayPlanInputs(2027, state(home, { eastBusyDays: { s1: new Set(["2027-07-04"]) } })));
  eq(blockedOf(feed, "July 4th", KHAN, "primary"), ["east-busy"], "a feed busy day inside the home range still refuses (the feed wins - rules.js keeps it out of eastClear)");
  const ov = H.planHolidays(2027, H.holidayPlanInputs(2027, state(home, { eastOverrides: { s1: { "2027-07-05": true } } })));
  eq(blockedOf(ov, "July 4th", KHAN, "primary"), ["east-busy"], "...and an override true");
  // the same day judged by the rules engine itself: no east-forecast-busy on a home day, east-forecast-busy without the range
  const ctxIn = (reviews, ranges) => SA.seedToContextInput(seed, { eastDerived: [], eastBusyDays: {}, eastForecast: fc, eastFeedCoverage: { from: "2026-08-24", to: "2026-11-15" }, eastVacationRanges: ranges, eastVacationReviews: reviews });
  const hardOf = (ci) => { const e = R.eligibility(R.buildContext(ci), "2027-07-04", "primary", KHAN); return (e.hard || e.reasons || []).filter((x) => /^east/.test(x)); };
  eq(hardOf(ctxIn(home, { s1: [{ start: "2027-07-02", end: "2027-07-06" }] })), [], "rules.js: home day - no East refusal for Khan's primary on 7/4");
  eq(hardOf(ctxIn([], {})), ["east-forecast-busy:0.80"], "rules.js: no range - east-forecast-busy:0.80 (the planner now agrees on both)");
}

step("M4: holidayPlanDefaultYear - the first year after today's with units, else the latest, else next year");
eq(H.holidayPlanDefaultYear(seed.holidays, "2026-10-01"), 2027, "2027 from 10/1/2026");
eq(H.holidayPlanDefaultYear(seed.holidays, "2027-03-01"), 2027, "no later year: the latest with units");
eq(H.holidayPlanDefaultYear({ units: {} }, "2026-10-01"), 2027, "no units at all: next year");
eq(H.holidayPlanDefaultYear({ units: { "2027": [], "2028": [{ name: "Christmas", days: ["2028-12-24"] }] } }, "2026-10-01"), 2028, "a year with an empty list does not count");

/* =================================================================== L */
step("L1: holidayPlanRecheck - a freshly accepted plan: six accepted units, nothing blocked");
{
  const rc = H.holidayPlanRecheck(2027, O27({ schedule: ACC.rows }));
  eq(rc.accepted.map((a) => [a.unit.name, a.primary, a.backup, a.days.length]), P27.assignments.map((a) => [a.unit.name, a.primary, a.backup, a.unit.days.length]), "the accepted units read back from the rows");
  eq([rc.blocked, rc.warnings], [[], []], "nothing blocked, no warning");
  eq(H.holidayPlanRecheck(2027, O27({ schedule: {} })).accepted, [], "nothing accepted on an empty map");
}

step("L2: a newer vacation blocks an accepted slot - named with the planner's reasons and the best valid swap; applying the swap clears it");
{
  const vac = [{ person_id: SARKAR, start_date: "2027-11-27", end_date: "2027-11-27" }];
  const rc = H.holidayPlanRecheck(2027, O27({ schedule: ACC.rows, vacations: vac }));
  eq(rc.blocked.map((b) => [b.unit.name, b.role, b.id, b.breaks.map((x) => x.reasons)]), [["Thanksgiving", "primary", SARKAR, [["day-before-vacation", "time-off:2027-11-27"]]]], "Sarkar's Thanksgiving primary");
  const b = rc.blocked[0];
  eq([b.valid, b.suggestion.text, b.suggestion.added], [true, "swap with Fierce (New Year's primary)", []], "the suggestion: the first valid swap by the planner's order");
  eq(b.days, ["2027-11-25", "2027-11-26", "2027-11-27", "2027-11-28"], "the accepted days");
  const units = [b.suggestion.unit, b.suggestion.with.unit];
  const fix = H.holidayPlanAcceptRows(2027, b.suggestion.assignments, ACC.rows, { units: seed.holidays.units["2027"], only: units });
  eq(fix.days.length, 6, "the swap writes the two units only (Thanksgiving 4 days + New Year's 2)");
  eq(fix.conflicts.map((c) => [c.unit, c.role, c.from, c.to, c.locked]).filter((x, i, a) => a.findIndex((y) => y.join() === x.join()) === i), [["Thanksgiving", "primary", SARKAR, FIERCE, true], ["New Year's", "primary", FIERCE, SARKAR, true]], "it replaces two locked holders - the confirm names them");
  const after = H.holidayPlanRecheck(2027, O27({ schedule: Object.assign({}, ACC.rows, fix.rows), vacations: vac }));
  eq(after.blocked, [], "re-check after the swap: nothing blocked");
}

step("L3: a newer East day and a newer rule block accepted slots; a deactivated surgeon is not-in-pool");
{
  const east = H.holidayPlanRecheck(2027, O27({ schedule: ACC.rows, east: { eastBusyDays: { s1: ["2027-09-05"] } } }));
  eq(east.blocked.map((b) => [b.unit.name, b.role, b.id, b.breaks[0].reasons]), [["Labor Day", "primary", KHAN, ["east-busy"]]], "a feed busy day on Khan's Labor Day primary");
  ok(east.blocked[0].valid && east.blocked[0].suggestion.ok, "...with a valid suggestion: " + east.blocked[0].suggestion.text);
  const sr = clone(seed.surgeonRules); sr.s3.holidayRules = { holidaysOff: ["Thanksgiving", "New Year's"] };
  const rule = H.holidayPlanRecheck(2027, O27({ schedule: ACC.rows, surgeonRules: sr }));
  eq(rule.blocked.map((b) => [b.unit.name, b.role, b.id, b.breaks[0].reasons]), [["New Year's", "backup", ACTON, ["holiday-opt-out:New Year's"]]], "Acton's new New Year's opt-out");
  const roster = clone(seed.roster); roster.find((r) => r.id === FIERCE).active = false;
  const gone = H.holidayPlanRecheck(2027, O27({ schedule: ACC.rows, roster: roster }));
  eq(gone.blocked.map((b) => [b.unit.name, b.role, b.id, b.breaks.map((x) => x.rule)]), [["July 4th", "backup", FIERCE, ["not-in-pool"]], ["New Year's", "primary", FIERCE, ["not-in-pool"]]], "Fierce deactivated: both his slots");
  ok(gone.blocked.every((b) => b.suggestion && b.suggestion.kind === "replace"), "...the suggestions replace him (nobody can swap into a pool he left): " + gone.blocked.map((b) => b.suggestion && b.suggestion.text).join("; "));
}

step("L4: only rows still carrying the plan source are re-checked; a unit whose accepted days disagree is named, never guessed");
{
  const sched = clone(ACC.rows);
  ["2027-11-25", "2027-11-26", "2027-11-27", "2027-11-28"].forEach((d) => { sched[d].source = "manual"; });
  const vac = [{ person_id: SARKAR, start_date: "2027-11-27", end_date: "2027-11-27" }];
  const rc = H.holidayPlanRecheck(2027, O27({ schedule: sched, vacations: vac }));
  ok(!rc.accepted.some((a) => a.unit.name === "Thanksgiving") && rc.blocked.length === 0, "hand-edited Thanksgiving (source manual) is an ordinary slot now - not re-checked");
  const mixed = clone(ACC.rows); mixed["2027-12-25"].primary = BURCHETT;
  const m = H.holidayPlanRecheck(2027, O27({ schedule: mixed }));
  ok(m.warnings.indexOf("Christmas 2027 primary: the accepted days hold Philip and Burchett - not one holder; that slot is not re-checked") >= 0, "mixed: " + JSON.stringify(m.warnings));
  eq(m.accepted.find((a) => a.unit.name === "Christmas").mixed, ["primary"], "...and flagged on the unit");
}

step("L5: review fix B - Re-check with today never suggests a swap with a unit that has started (Apply would write it half); a started blocked unit gets no suggestion");
{
  const east = { eastBusyDays: { s1: ["2027-09-05"] } };
  const before = H.holidayPlanRecheck(2027, O27({ schedule: ACC.rows, east }));
  eq(before.blocked.map((b) => [b.unit.name, b.role, b.id, b.suggestion.text]), [["Labor Day", "primary", KHAN, "swap with Acton (Memorial Day primary)"]], "without today: the swap with Acton's Memorial Day primary ranks first");
  const rc = H.holidayPlanRecheck(2027, O27({ schedule: ACC.rows, east, today: "2027-08-15" }));
  const b = rc.blocked[0];
  eq([rc.blocked.length, b.unit.name, b.role, b.id, b.started], [1, "Labor Day", "primary", KHAN, false], "today 2027-08-15: Khan's Labor Day primary is blocked (the feed's 9/5)");
  eq([b.valid, b.suggestion.text, b.suggestion.with], [true, "swap with Philip (Labor Day backup)", { unit: "Labor Day", role: "backup", id: KHAN }], "the valid swap is with the Labor Day backup (Khan's East day blocks his primary only)");
  const all = H.holidayPlanSwapOptions(2027, rc.accepted.map((a) => ({ unit: a.unit, primary: a.primary, backup: a.backup })), "Labor Day", "primary", O27({ east, today: "2027-08-15" })).options;
  ok(!all.some((o) => o.kind === "swap" && ["Memorial Day", "July 4th"].indexOf(o.with.unit) >= 0), "no listed swap touches Memorial Day or July 4th");
  // the half write the fix prevents: the old suggestion applied on 8/15 writes Labor Day alone and breaks the shape
  const half = H.holidayPlanAcceptRows(2027, before.blocked[0].suggestion.assignments, ACC.rows, { units: seed.holidays.units["2027"], only: ["Labor Day", "Memorial Day"], today: "2027-08-15" });
  eq([half.days, half.skipped.map((s) => [s.unit, s.started, s.primary, s.backup])], [["2027-09-04", "2027-09-05", "2027-09-06"], [["Memorial Day", true, ACTON, SARKAR]]], "(the old suggestion on 8/15: Memorial Day is skipped, Labor Day written alone)");
  const wc = H.holidayPlanWrittenCheck(2027, before.blocked[0].suggestion.assignments, half, O27({ schedule: ACC.rows, east }));
  eq(wc.added.map((x) => x.text), ["Khan holds 0 minor holidays (0 primary) - the minor tier gives each 1 with at most 1 primary", "Acton holds 2 minor holidays (2 primary) - the minor tier gives each 1 with at most 1 primary"], "holidayPlanWrittenCheck names the shape breaks the half write leaves (the app refuses such a swap outright)");
  eq(wc.started, ["Memorial Day"], "...and the started unit");
  // a blocked slot of a unit that has itself started: listed, no suggestion
  const late = H.holidayPlanRecheck(2027, O27({ schedule: ACC.rows, east, today: "2027-09-05" }));
  eq(late.blocked.map((x) => [x.unit.name, x.started, x.suggestion]), [["Labor Day", true, null]], "today 9/5 (Labor Day under way): listed with started: true and no suggestion");
}

step("L6: review fix D - a role the plan left open keeps the (unlocked) holder on file; Re-check does not read him as an accepted slot");
{
  const sched = { "2027-11-25": { primary: null, backup: BURCHETT, primaryLocked: false, backupLocked: false, source: "generated" }, "2027-11-26": { primary: null, backup: BURCHETT, primaryLocked: false, backupLocked: false, source: "generated" }, "2027-11-27": { primary: null, backup: BURCHETT, primaryLocked: false, backupLocked: false, source: "generated" }, "2027-11-28": { primary: null, backup: BURCHETT, primaryLocked: false, backupLocked: false, source: "generated" } };
  const half = H.holidayPlanAcceptRows(2027, withSlot(P27.assignments, "Thanksgiving", "backup", null), sched, { units: seed.holidays.units["2027"], only: ["Thanksgiving"] });
  eq([half.rows["2027-11-25"].source, half.rows["2027-11-25"].backup, half.rows["2027-11-25"].backupLocked, half.rows["2027-11-25"].primaryLocked], ["holiday-plan-2027", BURCHETT, false, true], "the row: plan source, Burchett kept unlocked, the planned primary locked");
  const all = Object.assign({}, ACC.rows, half.rows);
  const rc = H.holidayPlanRecheck(2027, O27({ schedule: all, vacations: [{ person_id: BURCHETT, start_date: "2027-11-26", end_date: "2027-11-26" }] }));
  const tg = rc.accepted.find((a) => a.unit.name === "Thanksgiving");
  eq([tg.primary, tg.backup, tg.days.length], [SARKAR, null, 4], "accepted Thanksgiving: Sarkar (locked) only - Burchett is the file's holder, not the plan's");
  ok(!rc.blocked.some((b) => b.id === BURCHETT && b.unit.name === "Thanksgiving"), "Burchett's vacation inside Thanksgiving is not a Re-check item (nothing the plan set) - " + JSON.stringify(rc.blocked.map((b) => [b.unit.name, b.role, b.id])));
  const locked = clone(all); ["2027-11-25", "2027-11-26", "2027-11-27", "2027-11-28"].forEach((d) => { locked[d].backupLocked = true; });
  eq(H.holidayPlanRecheck(2027, O27({ schedule: locked })).accepted.find((a) => a.unit.name === "Thanksgiving").backup, BURCHETT, "(a locked holder on a plan row reads as accepted - the plan locks every role it sets)");
}

/* =================================================================== N */
step("N1: the generator never touches the accepted rows (both roles locked) - Thanksgiving and Christmas / New Year's 2027 runs");
{
  const base = SA.seedToContextInput(seed, { eastDerived: [], eastFeedCoverage: { from: "2026-08-24", to: "2026-11-15" }, eastBusyDays: {} });
  const sched = Object.assign({}, base.schedule, ACC.rows);
  const ctx = R.buildContext(Object.assign({}, base, { schedule: sched }));
  [["2027-11-22", "2027-11-30"], ["2027-12-20", "2028-01-03"]].forEach(([s, e]) => {
    const out = GEN.generate(ctx, s, e, { seed: 7, bestOf: 3, timeBudgetMs: 1500 });
    ACC.days.filter((d) => d >= s && d <= e).forEach((d) => {
      const g = out.schedule[d], a = ACC.rows[d];
      eq([g.primary, g.backup, g.primaryLocked, g.backupLocked, g.source, g.note], [a.primary, a.backup, true, true, "holiday-plan-2027", a.note], s + ".." + e + ": " + d + " kept as accepted");
    });
  });
  // review fix L (documented, engine unchanged): rules.js reads an accepted row as an ordinary LOCK, not as the holder's
  // own availability (rule 1 is the planner's), so Generate lists the slots its rules would refuse as lockViolations -
  // and keeps them. Memorial Day .. July 4th 2027: Sarkar's Memorial Day backup is outside her monthly windows, Burchett's
  // three-day July 4th primary passes his two-day run limit.
  const mj = GEN.generate(ctx, "2027-05-29", "2027-07-05", { seed: 7, bestOf: 3, timeBudgetMs: 1500 });
  const lv = (mj.diagnostics.lockViolations || []).map((v) => [v.day, v.role, v.id, v.reasons.join(",")]);
  eq(lv, [
    ["2027-05-29", "backup", SARKAR, "outside-window"], ["2027-05-30", "backup", SARKAR, "outside-window"], ["2027-05-31", "backup", SARKAR, "outside-window"],
    ["2027-07-03", "primary", BURCHETT, "max-consecutive:2"], ["2027-07-04", "primary", BURCHETT, "max-consecutive:2"], ["2027-07-05", "primary", BURCHETT, "max-consecutive:2"]
  ], "Generate over Memorial Day .. July 4th lists the waived rules of the accepted slots as lock violations");
  ACC.days.filter((d) => d >= "2027-05-29" && d <= "2027-07-05").forEach((d) => {
    const g = mj.schedule[d], a = ACC.rows[d];
    eq([g.primary, g.backup, g.primaryLocked, g.backupLocked, g.source], [a.primary, a.backup, true, true, "holiday-plan-2027"], "...and keeps " + d + " as accepted (a lock violation is a fact, never changed)");
  });
}

step("N2: a trade or a give moves the whole unit - tradeUnitOf keys on rulesCtx.holidayByDay + the holder (never the row source), which covers every accepted day");
{
  const ctx = R.buildContext(SA.seedToContextInput(seed, { schedule: ACC.rows, eastDerived: [], eastBusyDays: {} }));
  // index-source.html tradeUnitOf, restated: the holiday unit of the day, the days of it the holder holds in that role
  const unitOf = (day, role, holder) => { const hol = ctx.holidayByDay[day]; if (!hol) return null; const held = hol.days.filter((d) => ACC.rows[d] && ACC.rows[d][role] === holder); return held.length > 1 ? { kind: "holiday", name: hol.name, days: held } : null; };
  ACC.units.forEach((u) => {
    ["primary", "backup"].forEach((role) => {
      u.days.forEach((d) => {
        const t = unitOf(d, role, u[role]);
        eq(t && [t.kind, t.name, t.days], [ "holiday", u.name, u.days ], u.name + " " + role + " from " + d + ": the whole unit");
      });
    });
  });
  const src = fs.readFileSync(path.join(__dirname, "..", "index-source.html"), "utf8");
  const fn = src.slice(src.indexOf("const tradeUnitOf = (day, role, holderId) => {"), src.indexOf("const tradeSuggestionsFor = "));
  ok(fn.includes("const hol = rulesCtx.holidayByDay ? rulesCtx.holidayByDay[day] : null;") && fn.includes("const held = hol.days.filter(holds);") && !/\.source\b/.test(fn), "the app's tradeUnitOf is the restated rule (holidayByDay + holder, no source test)");
}

const total = Date.now() - t0;
console.log("ok " + N + " assertions (" + total + " ms)");
