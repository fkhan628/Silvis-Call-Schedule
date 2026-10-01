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
  // 2026 majors: Alpha 2 of 3, Charlie 2 of 3, Bravo and Delta 1 of 3, Echo 0 of 3 -> Echo takes the extra major
  const p = plan(2027, { roster: R6.slice(0, 5), history: H26(["a", "b"], ["c", "d"], ["c", "a"]) });
  const c = p.counts;
  eq(["a", "b", "c", "d", "e"].map((id) => c[id].plan.major.primary + c[id].plan.major.backup), [1, 1, 1, 1, 2], "Echo (load 0/3, the lowest) holds two majors, everyone else one");
  ok(c.e.plan.major.backup >= 1 && c.e.plan.major.primary <= 1, "the extra one is a backup: " + JSON.stringify(c.e.plan.major));
  eq(["a", "b", "c", "d", "e"].map((id) => c[id].plan.minor.primary + c[id].plan.minor.backup).sort(), [1, 1, 1, 1, 2], "the minors: one surgeon holds two");
  ok(p.assignments.every((a) => a.primary && a.backup && a.primary !== a.backup), "full, primary != backup");
  eq(p.relaxed, [], "nothing relaxed (the shape for five IS one or two per tier)");
}

step("D3: seven - the highest lifetime load sits a tier out");
{
  const r7 = R6.concat([{ id: "g", name: "Golf", active: true }]);
  // 2026 majors: Golf held all three (load 3/3) -> he sits the 2027 majors out
  const hist = [{ year: 2026, name: "Thanksgiving", primary: "g", backup: "a" }, { year: 2026, name: "Christmas", primary: "g", backup: "b" }, { year: 2026, name: NY, primary: "g", backup: "c" }];
  const p = plan(2027, { roster: r7, history: hist });
  eq(p.counts.g.plan.major, { primary: 0, backup: 0 }, "Golf sits the majors out");
  eq(["a", "b", "c", "d", "e", "f"].map((id) => p.counts[id].plan.major.primary + p.counts[id].plan.major.backup), [1, 1, 1, 1, 1, 1], "the other six hold one major each");
  eq(["a", "b", "c", "d", "e", "f", "g"].map((id) => p.counts[id].plan.minor.primary + p.counts[id].plan.minor.backup).sort(), [0, 1, 1, 1, 1, 1, 1], "the minors (no history): one of the seven sits out");
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
  // 2032 (an even year, against the rotation) and Silvis BACKUP over Mon 5/30 of Memorial Day 2033; vacations: Burchett over
  // Labor Day 2032, Sarkar over Christmas 2034.
  const fc = {}; daysOf(2029, "July 4th").concat(daysOf(2030, NY)).forEach((d) => { fc[d] = 0.8; });
  const east = { eastForecast: { [KHAN]: fc }, eastDerived: [{ surgeonId: FIERCE, weekMonday: "2032-12-20", silvisRole: "primary" }, { surgeonId: FIERCE, weekMonday: "2033-05-30", silvisRole: "backup" }] };
  const FORCED = { "2032|Christmas|primary": FIERCE, "2033|Memorial Day|backup": FIERCE };
  const lab32 = daysOf(2032, "Labor Day");
  const vacations = [{ person_id: BURCHETT, start_date: lab32[0], end_date: lab32[lab32.length - 1] }, { person_id: SARKAR, start_date: "2034-12-24", end_date: "2034-12-25" }];
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
      ok(!(y === 2032 && n === "Labor Day") || (a.primary !== BURCHETT && a.backup !== BURCHETT), y + ": Burchett on his vacation");
      ok(!(y === 2034 && n === "Christmas") || (a.primary !== SARKAR && a.backup !== SARKAR), y + ": Sarkar on her vacation");
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

const total = Date.now() - t0;
console.log("ok " + N + " assertions (" + total + " ms)");
