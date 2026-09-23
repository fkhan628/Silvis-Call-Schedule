// Silvis rules engine unit tests (plain Node asserts, no framework).
// Exits non-zero on the first failure with a clear message; prints
// 'ok <n> assertions' on success. Builds ctx from docs/silvis-seed.json via
// test/seed-adapter.js plus small synthetic East-feed inputs.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const R = require("../rules.js");
const SA = require("./seed-adapter.js");

const t0 = Date.now();
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs", "silvis-seed.json"), "utf8"));

let N = 0;
let current = "";
function step(name) { current = name; }
function fail(msg) { console.error("FAIL [" + current + "]: " + msg); process.exit(1); }
function ok(cond, msg) { N++; if (!cond) fail(msg || "expected truthy"); }
function eq(a, b, msg) { N++; try { assert.deepStrictEqual(a, b); } catch (e) { fail((msg || "") + " expected " + JSON.stringify(b) + " got " + JSON.stringify(a)); } }
function has(arr, item, msg) { N++; if (!arr.some(x => x === item || (typeof x === "string" && x.startsWith(item)))) fail((msg || "") + " expected " + JSON.stringify(arr) + " to contain " + item); }
function lacks(arr, item, msg) { N++; if (arr.some(x => x === item || (typeof x === "string" && x.startsWith(item)))) fail((msg || "") + " expected " + JSON.stringify(arr) + " not to contain " + item); }
function hasSoft(r, reason, msg) { N++; if (!r.soft.some(s => s.reason === reason || s.reason.startsWith(reason))) fail((msg || "") + " expected soft " + JSON.stringify(r.soft) + " to contain " + reason); }
function lacksSoft(r, reason, msg) { N++; if (r.soft.some(s => s.reason === reason || s.reason.startsWith(reason))) fail((msg || "") + " expected soft " + JSON.stringify(r.soft) + " not to contain " + reason); }
function okElig(r, msg) { N++; if (!r.ok) fail((msg || "") + " expected eligible, hard=" + JSON.stringify(r.hard)); }
function blocked(r, reason, msg) { N++; if (r.ok) fail((msg || "") + " expected blocked by " + reason + " but ok"); has(r.hard, reason, msg); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }

const KHAN = "s1", BURCHETT = "s2", ACTON = "s3", PHILIP = "s4", FIERCE = "s5", SARKAR = "s6";
const P = "primary", B = "backup";

/* ------------------------------------------------ date helpers */
step("date helpers");
eq(R.rdWeekday("2026-11-01"), "Sun");
eq(R.rdWeekday("2026-11-02"), "Mon");
eq(R.rdWeekday("2026-12-01"), "Tue");
eq(R.rdWeekday("2027-02-01"), "Mon");
eq(R.rdWeekday("2026-10-01"), "Thu");
eq(R.rdAddDays("2026-12-31", 1), "2027-01-01");
eq(R.rdAddDays("2026-03-08", 1), "2026-03-09", "DST day");
eq(R.rdAddDays("2026-11-01", -1), "2026-10-31");
eq(R.rdFmt(R.rdParse("2026-11-26")), "2026-11-26");
eq(R.rdDaysBetween("2026-11-01", "2026-12-01"), 30);

/* ------------------------------------------------ matchesPattern */
step("matchesPattern nth weekday");
// December 2026 starts on a Tuesday: Mondays 7, 14, 21, 28 -> 2nd = 14, 4th = 28
const mon24 = { weekday: "Mon", nth: [2, 4] };
ok(R.matchesPattern("2026-12-14", mon24), "2nd Monday Dec 2026");
ok(R.matchesPattern("2026-12-28", mon24), "4th Monday Dec 2026");
ok(!R.matchesPattern("2026-12-07", mon24), "1st Monday Dec 2026");
ok(!R.matchesPattern("2026-12-21", mon24), "3rd Monday Dec 2026");
ok(!R.matchesPattern("2026-12-15", mon24), "a Tuesday never matches");
// February 2027 starts on a Monday: Mondays 1, 8, 15, 22 -> 2nd = 8, 4th = 22
ok(R.matchesPattern("2027-02-08", mon24), "2nd Monday Feb 2027");
ok(R.matchesPattern("2027-02-22", mon24), "4th Monday Feb 2027");
ok(!R.matchesPattern("2027-02-01", mon24), "1st Monday Feb 2027");
// March 2027 also starts Monday and has a 5th Monday (29th) which is not 2nd/4th
ok(!R.matchesPattern("2027-03-29", mon24), "5th Monday");
ok(R.matchesPattern("2026-11-03", { weekday: "Tue", nth: [1] }), "1st Tuesday Nov 2026");
ok(R.matchesPattern("2026-11-03", { weekday: "Tue", nth: 1 }), "nth as a number");

step("matchesPattern nthWeekOfMonth");
const fri3 = { weekday: "Fri", nthWeekOfMonth: 3 };
// Nov 2026: 3rd Wednesday = 11/18 -> week Mon 11/16..Sun 11/22 -> Friday 11/20
ok(R.matchesPattern("2026-11-20", fri3), "3rd-week Friday Nov 2026 = 11/20");
ok(!R.matchesPattern("2026-11-13", fri3), "11/13 is not the 3rd-week Friday");
ok(!R.matchesPattern("2026-11-27", fri3), "11/27 is not the 3rd-week Friday");
// Feb 2027: 3rd Wednesday = 2/17 -> week 2/15..2/21 -> Friday 2/19
ok(R.matchesPattern("2027-02-19", fri3), "3rd-week Friday Feb 2027 = 2/19");
ok(!R.matchesPattern("2027-02-12", fri3), "2/12 not");
// Oct 2026 starts Thursday: 3rd Wednesday = 10/21 -> Friday 10/23 (the 3rd Friday would be 10/16)
ok(R.matchesPattern("2026-10-23", fri3), "3rd-week Friday Oct 2026 = 10/23 (Aledo Friday in the emails)");
ok(!R.matchesPattern("2026-10-16", fri3), "10/16 (3rd Friday) is not the Friday of the 3rd-Wednesday week");
// Week containing the 1st Wednesday can start in the previous month: Oct 2026 1st Wed = 10/7, week 10/5..10/11;
// July 2026 1st Wed = 7/1, week Mon 6/29..Sun 7/5 -> Mon 6/29 matches nthWeekOfMonth 1 via the following month.
ok(R.matchesPattern("2026-06-29", { weekday: "Mon", nthWeekOfMonth: 1 }), "previous-month Monday of the 1st-Wednesday week");
ok(R.matchesPattern("2026-11-18", { weekday: "Wed", nth: [1, 3] }), "3rd Wednesday");
ok(R.matchesPattern("2026-11-04", { weekday: "Wed", nth: [1, 3] }), "1st Wednesday");

step("matchesPattern beforeNthMonday");
const sunB = { weekday: "Sun", beforeNthMonday: [2, 4] };
// Nov 2026 starts on Sunday: Mondays 2, 9, 16, 23, 30 -> Sundays before 2nd/4th = 11/8 and 11/22
ok(R.matchesPattern("2026-11-08", sunB), "Sunday before 2nd Monday (month starts Sunday)");
ok(R.matchesPattern("2026-11-22", sunB), "Sunday before 4th Monday");
ok(!R.matchesPattern("2026-11-01", sunB), "Sunday before the 1st Monday");
ok(!R.matchesPattern("2026-11-15", sunB), "Sunday before the 3rd Monday");
ok(!R.matchesPattern("2026-11-29", sunB), "Sunday before the 5th Monday");
ok(!R.matchesPattern("2026-11-09", sunB), "the Monday itself never matches");

step("matchesPattern other shapes");
ok(R.matchesPattern("2026-11-10", { weekday: "Tue" }), "every Tuesday");
ok(!R.matchesPattern("2026-11-11", { weekday: "Tue" }));
ok(R.matchesPattern("2026-10-15", { dates: ["2026-10-15", "2026-10-16"] }));
ok(!R.matchesPattern("2026-10-17", { dates: ["2026-10-15", "2026-10-16"] }));
ok(R.matchesPattern("2026-10-20", { start: "2026-10-19", end: "2026-10-24" }));
ok(!R.matchesPattern("2026-10-25", { start: "2026-10-19", end: "2026-10-24" }));
ok(R.matchesPattern("2026-10-20", { weekday: "Tue", start: "2026-10-19", end: "2026-10-24" }), "weekday inside a range");
ok(!R.matchesPattern("2026-10-20", {}), "an empty pattern never matches");
ok(R.matchesPattern("2026-12-14", [{ weekday: "Tue", nth: [1] }, mon24]), "array = any");

/* ------------------------------------------------ context builders */
const EAST_COVER = { from: "2026-11-01", to: "2027-01-31" };
const DERIVED = [
  { weekMonday: "2026-11-09", surgeonId: FIERCE, silvisRole: "backup" },   // East primary week -> Silvis backup
  { weekMonday: "2026-12-07", surgeonId: FIERCE, silvisRole: "primary" }   // East backup week -> Silvis primary
];
function makeCtx(extras) {
  return R.buildContext(SA.seedToContextInput(seed, Object.assign({ eastDerived: DERIVED, eastFeedCoverage: EAST_COVER, eastBusyDays: {} }, extras || {})));
}
const ctx = makeCtx();                                  // seed schedule (locked import + Thanksgiving)
const clean = makeCtx({ schedule: {} });                // no assignments at all

step("seed adapter");
const rows = SA.seedToAvailabilityRows(seed);
ok(rows.length > 40, "adapter produced rows");
ok(rows.every(r => !JSON.stringify(r).match(/@|\d{3}[-.]\d{3}[-.]\d{4}/)), "no contact data in rows");
ok(rows.some(r => r.person_id === ACTON && r.kind === "available" && r.role === "primary" && r.start_date === "2026-10-05"), "role-scoped available row");
ok(rows.some(r => r.person_id === BURCHETT && r.kind === "backup_only" && r.start_date === "2026-10-12"), "backup_only row");
ok(rows.some(r => r.person_id === PHILIP && r.kind === "no_backup" && r.role === "backup" && r.start_date === "2026-10-23"), "no_backup row");
ok(!rows.some(r => r.person_id === PHILIP && r.kind === "available" && r.start_date === "2026-11-09"), "availableWeeks are NOT rows (rules.js reads them directly; a row would be a pattern-lifting exception)");
ok(!rows.some(r => r.person_id === SARKAR && r.kind === "available"), "availableWindows are NOT rows (rules.js reads them directly; a row would be a pattern-lifting exception)");
ok(rows.some(r => r.person_id === ACTON && r.kind === "available" && r.role === "primary" && r.start_date === "2026-10-23"), "Acton 10/23 (Burchett 9/18 delta) is on his list");
// explicitListMonths derived from the explicitAvailable keys, role-scoped when the list names one role
const derivedSR = SA.seedToSurgeonRules({ surgeonRules: {
  a: { explicitAvailable: { "2026-10": { primary: ["2026-10-05"], backup: ["2026-10-06"] } } },
  b: { explicitAvailable: { "2026-10": { primary: ["2026-10-08"] } } },
  c: { explicitAvailable: { "2026-12": ["2026-12-01"], "2026-10": ["2026-10-06"] }, explicitListMonths: ["2026-10"] },
  d: { recurringAvailable: [] }
} });
eq(derivedSR.a.explicitListMonths, ["2026-10"], "both roles listed -> plain month");
eq(derivedSR.b.explicitListMonths, [{ month: "2026-10", roles: ["primary"] }], "one role listed -> role-scoped entry");
eq(derivedSR.c.explicitListMonths, ["2026-10", "2026-12"], "seed entries kept as written, missing month derived");
eq(derivedSR.d.explicitListMonths, undefined, "no explicit list -> nothing governed");
// Prompt 12 Y FLIP (9/22 evening): T pinned Acton's November object entry here; his list is preferences now, so the adapter
// sees October only (and no November completion, because the seed has no explicitAvailable['2026-11'] key any more).
eq(SA.seedToSurgeonRules(seed)[ACTON].explicitListMonths, ["2026-10"], "Y: Acton's explicitListMonths = October only (T had the November object entry)");
eq(SA.seedToSurgeonRules(seed)[PHILIP].explicitListMonths, [{ month: "2026-10", roles: ["primary"] }]);
eq(SA.seedToSurgeonRules(seed)[BURCHETT].explicitListMonths, ["2026-10", { month: "2026-11", roles: ["primary", "backup"] }, "2026-12"], "T: Burchett likewise, between his October and December entries (Y leaves his November object entry as written)");
eq(SA.seedToTimeOffRows(seed).length, 7, "seven vacation rows (Acton x2, Philip x1, Burchett x4 - the 2027 weekends stated 9/22 evening)");
const sched = SA.seedToSchedule(seed);
eq(sched["2026-09-30"].primaryLocked, true, "externalCover day is primary-locked");
eq(sched["2026-10-15"].primaryLocked, false, "null slot is never locked");
eq(sched["2026-10-15"].backupLocked, false);
eq(sched["2026-11-26"].primaryLocked, true);
eq(sched["2026-11-26"].backupLocked, false);

step("buildContext basics");
eq(ctx.activeIds, [KHAN, BURCHETT, ACTON, PHILIP, FIERCE, SARKAR]);
// 9/22 (Prompt 12 K): the cap is on PRIMARY days (monthlyCap.primary); monthlyCapFor
// also returns total = primary for one release so UI callers mid-edit keep working.
eq(R.monthlyCapFor(ctx, KHAN).primary, null, "explicit null = no cap");
eq(R.monthlyCapFor(ctx, ACTON).primary, null, "explicit null = no cap");
eq(R.monthlyCapFor(ctx, PHILIP).primary, 8, "absent = group default (defaultMonthlyCap.primary)");
eq(R.monthlyCapFor(ctx, SARKAR).primary, 8, "absent = group default");
eq(R.monthlyCapFor(ctx, BURCHETT), { primary: 8, preferred: 7, total: 8 }, "Burchett { primary: 8, preferred: 7 } plus the one-release total alias");
eq(R.monthlyCapFor(ctx, FIERCE).primary, 14);
eq(R.monthlyCapFor(ctx, FIERCE).total, 14, "total alias = primary");
ok(ctx.per[FIERCE].countsEastDays === true, "seed: Fierce countsEastDays is boolean true");
eq(ctx.per[FIERCE].eastPrimaryDays.size, 7, "K: eastPrimaryDays = the 7 days of his East PRIMARY week (derived Silvis backup 11/9-11/15) only");
ok(ctx.per[FIERCE].eastPrimaryDays.has("2026-11-09") && ctx.per[FIERCE].eastPrimaryDays.has("2026-11-15") && !ctx.per[FIERCE].eastPrimaryDays.has("2026-12-09"), "K: the East BACKUP week (12/7-12/13, Silvis primary) is not an East primary-week day");
ok(!ctx.warnings.some(w => /monthlyCap\.total|defaultMonthlyCap\.total/.test(w)), "K: the seed carries no legacy total keys: " + JSON.stringify(ctx.warnings));
eq(R.resolveWeight(ctx, "medium"), 3);
eq(R.resolveWeight(ctx, "strong"), 10);
eq(R.resolveWeight(ctx, 4), 4);
eq(R.resolveWeight(ctx, "2.5"), 2.5);
eq(R.resolveWeight(ctx, "nonsense"), 3, "unknown string falls back to medium");
eq(R.defaultWeights().patternDaily, 5);
ok(R.isHolidayDay(ctx, "2026-11-27") && R.isHolidayDay(ctx, "2026-11-27").name === "Thanksgiving");
eq(R.isHolidayDay(ctx, "2026-11-25"), null);
ok(R.isHolidayDay(ctx, "2027-01-01") && R.isHolidayDay(ctx, "2027-01-01").year === "2026", "New Year's Day 2027 belongs to the 2026 unit");

/* ------------------------------------------------ Sarkar */
// 9/22 evening (Prompt 12 N, revised): none of Sarkar's rules are hard and fast yet
// (Faraz) - her WINDOWS are the only hard rule (both roles, holidays included). The
// window-week count is a SOFT target (daysPerWindowWeek.target 2, primary only),
// alternate days are a soft preference (preferAlternateDays), a Fri-Sun block is a
// strong soft penalty (weekendBlockPenalty), weekendStyle "daily" makes a window
// Friday an ordinary standalone day, and handoffPartnerRequired is a diagnostics
// flag the generator reads (no soft in eligibility any more).
step("Sarkar seed keys (9/22 evening)");
eq(seed.surgeonRules[SARKAR].daysPerWindowWeek.target, 2, "seed: Sarkar daysPerWindowWeek.target = 2 (the clinic manager 9/22 evening)");
eq(seed.surgeonRules[SARKAR].daysPerWindowWeek.countsBackup, false, "seed: Sarkar's window-week count is primary only");
ok(!("min" in seed.surgeonRules[SARKAR].daysPerWindowWeek) && !("max" in seed.surgeonRules[SARKAR].daysPerWindowWeek) && !("minIsSoft" in seed.surgeonRules[SARKAR].daysPerWindowWeek), "seed: no hard window-week min/max keys any more");
eq(seed.surgeonRules[SARKAR].weekendStyle, "daily", "seed: Sarkar weekendStyle daily (a Friday is a standalone day)");
ok(!("hardNeverWeekdays" in seed.surgeonRules[SARKAR]) && !("hardNeverWeekdaysRoles" in seed.surgeonRules[SARKAR]) && !("hardNeverWeekdaysReason" in seed.surgeonRules[SARKAR]) && !("hardNeverWeekdaysRolesNote" in seed.surgeonRules[SARKAR]), "seed: Sarkar carries no hardNeverWeekdays keys (her windows are the only hard rule)");
eq(seed.surgeonRules[SARKAR].preferAlternateDays, true, "seed: preferAlternateDays (soft)");
eq(seed.surgeonRules[SARKAR].weekendBlockPenalty, "strong", "seed: weekendBlockPenalty strong (soft)");
eq(seed.surgeonRules[SARKAR].handoffPartnerRequired, true, "seed: handoffPartnerRequired stays as a diagnostics flag");
eq([seed.surgeonRules[SARKAR].maxConsecutiveDays, seed.surgeonRules[SARKAR].maxConsecutiveAnyRole], [2, 2], "seed: max 2 consecutive primary (hard, real days) / 2 any role (soft) unchanged");
eq(seed.surgeonRules[SARKAR].monthlyTarget, null, "seed: monthlyTarget stays null (her target comes from the window target)");

step("Sarkar windows (the only hard rule)");
["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"].forEach(d => okElig(R.eligibility(clean, d, P, SARKAR), d));
// windows Mon-Fri since 9/22 evening (the clinic manager): Sat 10/24 is outside the October window now; a Saturday is
// still fine whenever a window carries one again (synthetic window Oct 19-24 - the pre-9/22 shape)
blocked(R.eligibility(clean, "2026-10-24", P, SARKAR), "outside-window", "Sat 10/24 is outside the Mon-Fri window (9/22 evening)");
const srSatWin = clone(SA.seedToSurgeonRules(seed)); srSatWin[SARKAR].availableWindows = srSatWin[SARKAR].availableWindows.map(w => w.start === "2026-10-19" ? { start: w.start, end: "2026-10-24" } : w);
const satWin = makeCtx({ schedule: {}, surgeonRules: srSatWin });
okElig(R.eligibility(satWin, "2026-10-24", P, SARKAR), "Saturday inside a window is fine");
okElig(R.eligibility(clean, "2026-10-23", P, SARKAR), "9/22 evening: a window Friday PRIMARY is an ordinary standalone day (was hard-never-weekday:Fri)");
okElig(R.eligibility(clean, "2026-10-23", B, SARKAR), "a window Friday is open for backup");
blocked(R.eligibility(clean, "2026-10-25", P, SARKAR), "outside-window");
lacks(R.eligibility(clean, "2026-10-25", P, SARKAR).hard, "hard-never-weekday", "no hard-never rule on her any more: a Sunday is simply outside every window");
blocked(R.eligibility(clean, "2026-10-26", P, SARKAR), "outside-window");
blocked(R.eligibility(clean, "2026-11-15", P, SARKAR), "outside-window", "every Sunday is outside every window");
blocked(R.eligibility(clean, "2026-11-22", B, SARKAR), "outside-window", "Sunday backup outside the window");
okElig(R.eligibility(clean, "2026-11-16", P, SARKAR), "Nov window");
okElig(R.eligibility(clean, "2026-11-19", P, SARKAR), "Nov window Thursday");   // windows Mon-Fri since 9/22 evening (was Sat 11/21)
okElig(R.eligibility(clean, "2026-11-20", P, SARKAR), "Nov window Friday primary (9/22 evening: eligible; was hard-never-weekday:Fri)");
// a Saturday / Sunday is outside every window now - pinned for BOTH roles
blocked(R.eligibility(clean, "2026-11-21", P, SARKAR), "outside-window", "Sat 11/21 primary is outside the Nov 16-20 window (9/22 evening)");
blocked(R.eligibility(clean, "2026-11-21", B, SARKAR), "outside-window", "Sat 11/21 backup is outside the window too");
blocked(R.eligibility(clean, "2026-11-22", P, SARKAR), "outside-window", "Sun 11/22 primary");
okElig(R.eligibility(clean, "2026-12-18", P, SARKAR), "Dec window Friday primary (was hard-never-weekday:Fri)");
okElig(R.eligibility(clean, "2026-12-17", P, SARKAR));
blocked(R.eligibility(clean, "2026-12-19", P, SARKAR), "outside-window");
eq(R.eligibility(clean, "2026-11-20", P, SARKAR).hard, [], "the window Friday carries no hard reason at all");
lacks(R.eligibility(clean, "2026-11-20", P, SARKAR).hard, "hard-never-weekday:Fri", "before 9/22 evening this was hard-never-weekday:Fri");

step("Sarkar window-week SOFT target (2 primary days per window week)");
// count = her PRIMARY days in the Mon-Sun week (schedule + assume + the evaluated slot); target 2:
//   a placement at or under the target (0 or 1 OTHER primaries held) -> 'window-week-below-target:2' at -weights.medium (-3),
//   so every day up to the target is wanted (not only the first); over -> 'window-week-over-target:2' at medium x (count - 2)
const softW = (r, prefix) => { const s = r.soft.find(x => x.reason.indexOf(prefix) === 0); return s ? s.weight : null; };
const alone = R.eligibility(clean, "2026-11-18", P, SARKAR);   // count 1 (this slot only)
okElig(alone, "window Wednesday alone");
eq(softW(alone, "window-week-below-target:2"), -3, "0 other primaries in the week: below-target bonus -3");
lacksSoft(alone, "window-week-over-target", "and no over-target");
const one = makeCtx({ schedule: { "2026-11-16": { primary: SARKAR } } });
const atTarget = R.eligibility(one, "2026-11-18", P, SARKAR);    // count 2 = target
eq(softW(atTarget, "window-week-below-target:2"), -3, "1 other primary: the slot that reaches the target still earns the bonus (-3 at 0 or 1 others)");
lacksSoft(atTarget, "window-week-over-target", "...and no penalty");
const two = makeCtx({ schedule: { "2026-11-16": { primary: SARKAR }, "2026-11-20": { primary: SARKAR } } });
const skOver3 = R.eligibility(two, "2026-11-18", P, SARKAR);     // count 3
okElig(skOver3, "a third primary in the window week is still ELIGIBLE (soft, not hard)");
eq(softW(skOver3, "window-week-over-target:2"), 3, "3 primaries: over-target +3 (medium x 1)");
const three = makeCtx({ schedule: { "2026-11-16": { primary: SARKAR }, "2026-11-17": { primary: SARKAR }, "2026-11-20": { primary: SARKAR } } });
const skOver4 = R.eligibility(three, "2026-11-19", P, SARKAR);   // count 4 (Mon, Tue, Thu, Fri) - Thu-Fri is a 2-run, under her hard 2
okElig(skOver4, "a fourth primary is still eligible");
eq(softW(skOver4, "window-week-over-target:2"), 6, "4 primaries: over-target +6 (medium x 2)");
// countsBackup false: her backup days never count, and a backup placement carries no window-week soft at all
const skBk = makeCtx({ schedule: { "2026-11-16": { primary: null, backup: SARKAR }, "2026-11-17": { primary: null, backup: SARKAR } } });
eq(softW(R.eligibility(skBk, "2026-11-18", P, SARKAR), "window-week-below-target:2"), -3, "two window backups do not count: the Wednesday primary is still 1 of 2");
lacksSoft(R.eligibility(skBk, "2026-11-18", B, SARKAR), "window-week", "a backup placement carries no window-week soft");
okElig(R.eligibility(skBk, "2026-11-18", B, SARKAR), "...and stays eligible (backup inside a window is allowed, not targeted)");
// NO hard window-week maximum anywhere: with four primaries ASSUMED in the week a fifth is still eligible
// (maxConsecutiveDays raised to 7 in this clone so the hard consecutive limit stays out of the picture)
const srLongRun = clone(SA.seedToSurgeonRules(seed)); srLongRun[SARKAR].maxConsecutiveDays = 7; srLongRun[SARKAR].maxConsecutiveAnyRole = 7;
const fifth = R.eligibility(makeCtx({ schedule: {}, surgeonRules: srLongRun }), "2026-11-18", P, SARKAR, { assume: [{ date: "2026-11-16", role: P }, { date: "2026-11-17", role: P }, { date: "2026-11-19", role: P }, { date: "2026-11-20", role: P }] });
okElig(fifth, "9/22 evening: a fifth primary in the window week is eligible (was window-week-max:4)");
lacks(fifth.hard, "window-week-max", "no hard window-week-max exists any more");
eq(softW(fifth, "window-week-over-target:2"), 9, "5 primaries: over-target +9 (medium x 3)");
// legacy min/max keys in an older blob: ignored with ONE ctx warning, never a hard reason
const srLegacy = clone(SA.seedToSurgeonRules(seed)); srLegacy[SARKAR].daysPerWindowWeek = { min: 3, max: 4, minIsSoft: true, countsBackup: true }; srLegacy[SARKAR].maxConsecutiveDays = 7; srLegacy[SARKAR].maxConsecutiveAnyRole = 7;
const legacy = makeCtx({ schedule: {}, surgeonRules: srLegacy });
eq(legacy.warnings.filter(w => /daysPerWindowWeek/.test(w)).length, 1, "legacy daysPerWindowWeek.min/max: exactly one ctx warning: " + JSON.stringify(legacy.warnings));
ok(/surgeonRules\.s6\.daysPerWindowWeek/.test(legacy.warnings.join(" ")) && /ignored/.test(legacy.warnings.join(" ")), "the warning names the path and says ignored");
const legacyFifth = R.eligibility(legacy, "2026-11-18", P, SARKAR, { assume: [{ date: "2026-11-16", role: P }, { date: "2026-11-17", role: P }, { date: "2026-11-19", role: P }, { date: "2026-11-20", role: P }] });
okElig(legacyFifth, "legacy max 4 is not enforced");
lacks(legacyFifth.hard, "window-week-max", "no hard reason from the legacy keys");
lacksSoft(legacyFifth, "window-week", "and no target soft either (min/max carry no target)");
ok(clean.warnings.every(w => !/daysPerWindowWeek/.test(w)), "the shipped seed raises no daysPerWindowWeek warning");

step("Sarkar alternate days (soft) and consecutive (hard)");
const sk2 = makeCtx({ schedule: { "2026-10-20": { primary: SARKAR }, "2026-10-21": { primary: SARKAR } } });
blocked(R.eligibility(sk2, "2026-10-22", P, SARKAR), "max-consecutive:2", "the group-wide hard limit on real primary days still applies (Prompt 12 A)");
// preferAlternateDays: 'consecutive-primary' (medium) when the day before OR after is her primary; replaces the old handoff-partner soft
const cp = R.eligibility(makeCtx({ schedule: { "2026-11-18": { primary: SARKAR } } }), "2026-11-19", P, SARKAR);
okElig(cp, "Thursday after her Wednesday: eligible");
eq(softW(cp, "consecutive-primary"), 3, "11/18 hers -> 11/19 primary carries consecutive-primary +3 (medium)");
lacksSoft(cp, "handoff-partner", "the handoff-partner soft is gone (handoffPartnerRequired is a diagnostics flag now)");
eq(softW(R.eligibility(makeCtx({ schedule: { "2026-11-18": { primary: SARKAR } } }), "2026-11-17", P, SARKAR), "consecutive-primary"), 3, "the day BEFORE her primary too");
lacksSoft(R.eligibility(makeCtx({ schedule: { "2026-11-18": { primary: SARKAR } } }), "2026-11-20", P, SARKAR), "consecutive-primary", "two days apart: no penalty");
lacksSoft(R.eligibility(makeCtx({ schedule: { "2026-11-18": { primary: null, backup: SARKAR } } }), "2026-11-19", P, SARKAR), "consecutive-primary", "her BACKUP the day before is not a consecutive primary");
lacksSoft(R.eligibility(makeCtx({ schedule: { "2026-11-18": { primary: SARKAR } } }), "2026-11-19", B, SARKAR), "consecutive-primary", "a backup placement after her primary carries no consecutive-primary (backup-after-primary is the generic soft)");
const srNoAlt = clone(SA.seedToSurgeonRules(seed)); srNoAlt[SARKAR].preferAlternateDays = false;
lacksSoft(R.eligibility(makeCtx({ schedule: { "2026-11-18": { primary: SARKAR } }, surgeonRules: srNoAlt }), "2026-11-19", P, SARKAR), "consecutive-primary", "preferAlternateDays false: no penalty (data, not a name branch)");
okElig(R.eligibility(sk2, "2026-10-22", B, SARKAR), "backup after two primaries is legal (primary-only counting)");
// the seed schedule itself: her locked days evaluate as eligible for herself
okElig(R.eligibility(ctx, "2026-10-20", P, SARKAR), "locked self");
okElig(R.eligibility(ctx, "2026-10-22", P, SARKAR), "locked self Thursday");   // windows Mon-Fri since 9/22 evening (was "locked self Saturday" 10/24)
// 9/22 evening: 10/24 came off Sarkar in the seed (locked-open like 10/15) and sits outside her Mon-Fri window
eq([ctx.schedule["2026-10-24"].primary, ctx.schedule["2026-10-24"].primaryLocked], [null, false], "seed: 10/24 primary open, not locked (null slot)");
blocked(R.eligibility(ctx, "2026-10-24", P, SARKAR), "outside-window", "Sarkar is not eligible for the day she came off");

/* ------------------------------------------------ Burchett */
step("Burchett December list (governed month)");
okElig(R.eligibility(clean, "2026-12-01", P, BURCHETT));
okElig(R.eligibility(clean, "2026-12-09", B, BURCHETT));
okElig(R.eligibility(clean, "2026-12-25", P, BURCHETT), "listed holiday day");
blocked(R.eligibility(clean, "2026-12-02", P, BURCHETT), "whitelist-month");
blocked(R.eligibility(clean, "2026-12-08", P, BURCHETT), "whitelist-month", "1st-Tuesday recurring rule does not apply in a governed month (12/1 is the 1st Tue anyway)");
okElig(R.eligibility(clean, "2026-12-08", B, BURCHETT), "9/22: a governed month restricts primary only - backup any day");
blocked(R.eligibility(clean, "2026-12-11", P, BURCHETT), "whitelist-month", "unlisted Friday in a governed month");
const dec24 = R.eligibility(clean, "2026-12-24", P, BURCHETT); // primary: since 9/22 backup is never governed by the list
okElig(dec24, "Christmas Eve is a holiday-unit day: anyone may cover unless opted out");
hasSoft(dec24, "holiday-waiver:whitelist-month", "but off-list holiday days carry a medium penalty");
step("Burchett January 2027 is NOT whitelist mode");
okElig(R.eligibility(clean, "2027-01-02", P, BURCHETT), "spill-over date is additive");
okElig(R.eligibility(clean, "2027-01-03", B, BURCHETT), "spill-over date is additive");
okElig(R.eligibility(clean, "2027-01-11", P, BURCHETT), "2nd Monday via recurring whitelist");
okElig(R.eligibility(clean, "2027-01-05", P, BURCHETT), "1st Tuesday");
okElig(R.eligibility(clean, "2027-01-13", P, BURCHETT), "2nd Wednesday");
okElig(R.eligibility(clean, "2027-01-23", P, BURCHETT), "weekend via weekendsAvailable");   // was Sat 1/9 - a vacation since 9/22 evening
okElig(R.eligibility(clean, "2027-01-08", B, BURCHETT), "Friday backup via weekendsAvailable (the day before his 1/9-10 vacation blocks primary only)");
// 9/22 evening (Burchett email): the 2027 weekends he cannot work are seed vacations - both roles blocked, the day before primary only
blocked(R.eligibility(clean, "2027-01-09", P, BURCHETT), "time-off:2027-01-09", "Sat 1/9 vacation (primary)");
blocked(R.eligibility(clean, "2027-01-10", B, BURCHETT), "time-off:2027-01-10", "Sun 1/10 vacation (backup)");
blocked(R.eligibility(clean, "2027-01-08", P, BURCHETT), "day-before-vacation", "Fri 1/8 primary: day before the vacation");
blocked(R.eligibility(clean, "2027-01-16", P, BURCHETT), "time-off:2027-01-16"); blocked(R.eligibility(clean, "2027-01-17", P, BURCHETT), "time-off:2027-01-17");
["2027-02-12", "2027-02-13", "2027-02-14", "2027-04-09", "2027-04-10", "2027-04-11"].forEach(d => blocked(R.eligibility(clean, d, B, BURCHETT), "time-off:" + d, "Burchett vacation " + d));
okElig(R.eligibility(clean, "2027-01-15", B, BURCHETT), "Fri 1/15 backup is open (the January entries are Sat+Sun only)");
lacks(R.eligibility(clean, "2027-01-15", P, BURCHETT).hard, "time-off", "Fri 1/15 is not itself a vacation day");
blocked(R.eligibility(clean, "2027-01-04", P, BURCHETT), "not-recurring-available", "1st Monday is not on his recurring list");
blocked(R.eligibility(clean, "2027-01-12", P, BURCHETT), "not-recurring-available", "a Tuesday that is not the 1st");
step("Burchett October import rows");
blocked(R.eligibility(clean, "2026-10-12", P, BURCHETT), "backup-only-row");
okElig(R.eligibility(clean, "2026-10-12", B, BURCHETT));
blocked(R.eligibility(clean, "2026-10-18", P, BURCHETT), "unavailable-row");
blocked(R.eligibility(clean, "2026-10-18", B, BURCHETT), "unavailable-row");
blocked(R.eligibility(clean, "2026-10-13", P, BURCHETT), "whitelist-month");
step("Burchett max consecutive 2 and preferred cap");
const bk = makeCtx({ schedule: { "2026-12-12": { primary: BURCHETT }, "2026-12-13": { primary: BURCHETT } } });
blocked(R.eligibility(bk, "2026-12-14", P, BURCHETT), "max-consecutive:2");
const bk14 = R.eligibility(bk, "2026-12-14", B, BURCHETT);
okElig(bk14, "backup is not counted toward consecutive");
hasSoft(bk14, "backup-after-primary");
const bk7 = {};
["2026-12-01", "2026-12-05", "2026-12-06", "2026-12-09", "2026-12-12", "2026-12-13", "2026-12-14"].forEach(d => { bk7[d] = { primary: BURCHETT }; });
const bkc = makeCtx({ schedule: bk7 });
const b8 = R.eligibility(bkc, "2026-12-19", P, BURCHETT);
okElig(b8, "8th primary is within the cap");
hasSoft(b8, "over-preferred-cap:7", "but above the preferred 7");
// 9/22 (Prompt 12 K): caps count PRIMARY days only - a backup never trips the cap or the preferred cap.
lacksSoft(R.eligibility(bkc, "2026-12-19", B, BURCHETT), "over-preferred-cap", "K: 7 primaries held, a backup does not carry over-preferred-cap");
bk7["2026-12-19"] = { primary: BURCHETT };
blocked(R.eligibility(makeCtx({ schedule: bk7 }), "2026-12-20", P, BURCHETT), "monthly-cap:8", "8 primaries held, a 9th primary");
okElig(R.eligibility(makeCtx({ schedule: bk7 }), "2026-12-20", B, BURCHETT), "K: 8 primaries held, a backup that month is still eligible (was monthly-cap:8 - caps counted both roles)");
step("K: backup days never count toward the monthly cap");
const bkB = {};
["2026-12-01", "2026-12-05", "2026-12-06", "2026-12-09", "2026-12-12", "2026-12-13", "2026-12-14", "2026-12-19"].forEach(d => { bkB[d] = { backup: BURCHETT }; });
const bkBctx = makeCtx({ schedule: bkB });
const p1223 = R.eligibility(bkBctx, "2026-12-23", P, BURCHETT);
okElig(p1223, "K: 8 backup days held in December and 0 primaries -> primary on a listed December day is eligible (was monthly-cap:8)");
lacksSoft(p1223, "over-preferred-cap", "K: 8 backups do not reach the preferred cap either");
okElig(R.eligibility(bkBctx, "2026-12-23", B, BURCHETT), "K: a 9th backup is eligible - no total cap on backup");

/* ------------------------------------------------ Acton */
step("Acton time off and trailing edge");
["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"].forEach(d => {
  blocked(R.eligibility(ctx, d, P, ACTON), "time-off:" + d);
  blocked(R.eligibility(ctx, d, B, ACTON), "time-off:" + d);
});
const vacJan = makeCtx({ schedule: {}, timeOffRows: SA.seedToTimeOffRows(seed).concat([{ person_id: ACTON, start_date: "2027-01-20", end_date: "2027-01-21" }]) }); // synthetic January vacation: since T his real edge 11/18 is a locked published day and 11/18 backup is off his November list
blocked(R.eligibility(vacJan, "2027-01-19", P, ACTON), "day-before-vacation");
okElig(R.eligibility(vacJan, "2027-01-19", B, ACTON), "day before a vacation blocks PRIMARY only");
blocked(R.eligibility(clean, "2026-11-18", P, ACTON), "day-before-vacation", "his real edge: 11/18 is on his November primary list, the vacation rule still blocks primary");
blocked(R.eligibility(ctx, "2026-11-24", P, ACTON), "day-before-vacation", "before the Thanksgiving-week vacation");
// Prompt 12 H (9/22, Faraz): under the open-backup rule both day-before rules stay PRIMARY-only - a standby backup the
// day before a vacation or an Aledo day is acceptable. Pinned in the seed (role lists exactly [primary], note records
// the decision) and in the built ctx; on his real edges the trailing edge never reaches the backup slot (since T his
// 11/18 and 11/24 backups are off his both-role November list, so whitelist-month - not day-before-vacation - is what
// keeps him off them; the January vacation above shows the backup slot eligible).
eq(seed.groupRules.dayBeforeRules.trailingEdgeRoles, [P], "H: seed dayBeforeRules.trailingEdgeRoles is exactly [primary]");
eq(seed.groupRules.dayBeforeRules.aledoDayBeforeRoles, [P], "H: seed dayBeforeRules.aledoDayBeforeRoles is exactly [primary]");
ok(/9\/22/.test(seed.groupRules.dayBeforeRules.note || ""), "H: seed dayBeforeRules.note records the 9/22 decision, got: " + JSON.stringify(seed.groupRules.dayBeforeRules.note));
ok(/standby backup/.test(seed.groupRules.dayBeforeRules.note || ""), "H: seed dayBeforeRules.note says a standby backup the day before is acceptable");
eq(ctx.trailingEdgeRoles, [P], "H: ctx.trailingEdgeRoles from the seed");
eq(ctx.aledoDayBeforeRoles, [P], "H: ctx.aledoDayBeforeRoles from the seed");
lacks(R.eligibility(clean, "2026-11-18", B, ACTON).hard, "day-before-vacation", "H: Acton backup 11/18 (day before his 11/19 vacation) carries no day-before-vacation");
lacks(R.eligibility(clean, "2026-11-24", B, ACTON).hard, "day-before-vacation", "H: Acton backup 11/24 (day before his Thanksgiving-week vacation) carries no day-before-vacation");
step("Acton recurring blacklist and avoid");
// Pinned in January 2027, an ungoverned month: since Prompt 12 T (9/22) November is governed for both of his roles by
// the ER-panel author's published list, so a November day off that list reads whitelist-month before anything recurring.
blocked(R.eligibility(clean, "2027-01-11", P, ACTON), "recurring-unavailable:Mon", "2nd Monday");
blocked(R.eligibility(clean, "2027-01-25", P, ACTON), "recurring-unavailable:Mon", "4th Monday");
okElig(R.eligibility(clean, "2027-01-25", B, ACTON), "9/22: outreach days restrict primary only");
blocked(R.eligibility(clean, "2027-01-13", P, ACTON), "recurring-unavailable:Wed", "2nd Wednesday");
okElig(R.eligibility(clean, "2027-01-18", P, ACTON), "3rd Monday is fine");
okElig(R.eligibility(clean, "2027-01-06", P, ACTON), "1st Wednesday is fine");
const sun8 = R.eligibility(clean, "2027-01-10", P, ACTON);
okElig(sun8); hasSoft(sun8, "recurring-avoid:Sun", "Sunday before the 2nd Monday");
eq(sun8.soft.find(s => s.reason === "recurring-avoid:Sun").weight, 3, "medium = 3");
const tue10 = R.eligibility(clean, "2027-01-12", P, ACTON);
// Prompt 12 X FLIP (9/22 evening): before X this read okElig(tue10); hasSoft(tue10, "recurring-avoid:Tue") - Faraz made his
// Tuesday a hard PRIMARY rule (surgeonRules.s3.hardNeverWeekdays ["Tue"], roles ["primary"]); the soft avoid left the seed.
blocked(tue10, "hard-never-weekday:Tue", "X: Acton PRIMARY on an ungoverned Tuesday is hard");
lacksSoft(R.eligibility(clean, "2027-01-17", P, ACTON), "recurring-avoid", "Sunday before the 3rd Monday is not avoided");
okElig(R.eligibility(clean, "2027-01-04", B, ACTON), "no cap for Acton");
blocked(R.eligibility(clean, "2026-11-23", P, ACTON), "recurring-unavailable:Mon", "T then Y: a November 4th Monday carries the recurring reason");
// Prompt 12 Y FLIP (9/22 evening): under T this line read has(..., "whitelist-month") (November governed for both roles by the
// relayed list); Faraz ruled that list preferences, so the recurring reason now stands alone.
lacks(R.eligibility(clean, "2026-11-23", P, ACTON).hard, "whitelist-month", "Y: ...and nothing else - November is his recurring rules again");
step("Acton no cap (explicit null)");
const ak = {};
["2026-11-02", "2026-11-03", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-16"].forEach(d => { ak[d] = { backup: ACTON }; });
okElig(R.eligibility(makeCtx({ schedule: ak }), "2026-11-17", B, ACTON), "10th day: no monthly cap for Acton");

/* ------------------------------------------------ Khan */
step("Khan weekdays and East");
blocked(R.eligibility(clean, "2026-11-03", P, KHAN), "hard-never-weekday:Tue");
okElig(R.eligibility(clean, "2026-11-03", B, KHAN), "9/22: his OR days restrict primary only");
blocked(R.eligibility(clean, "2026-11-05", P, KHAN), "hard-never-weekday:Thu");
const mon2 = R.eligibility(clean, "2026-11-02", P, KHAN);
okElig(mon2, "Monday with East clear"); hasSoft(mon2, "auto-offer-weekday");
lacksSoft(mon2, "east-unknown", "inside coverage");
okElig(R.eligibility(clean, "2026-11-04", B, KHAN), "Wednesday backup");
["2026-11-06", "2026-11-07", "2026-11-08"].forEach(d => okElig(R.eligibility(clean, d, P, KHAN), "weekend " + d));
const busy = makeCtx({ schedule: {}, eastBusyDays: { [KHAN]: ["2026-11-02", "2026-11-07"] } });
blocked(R.eligibility(busy, "2026-11-02", P, KHAN), "east-busy");
okElig(R.eligibility(busy, "2026-11-02", B, KHAN), "backup allowed on an East day");
okElig(R.eligibility(busy, "2026-11-06", P, KHAN));
blocked(R.eligibility(busy, "2026-11-07", P, KHAN), "east-busy");
okElig(R.eligibility(busy, "2026-11-07", B, KHAN));
okElig(R.eligibility(busy, "2026-11-08", P, KHAN));
const busySet = makeCtx({ schedule: {}, eastBusyDays: { [KHAN]: new Set(["2026-11-02"]) } });
blocked(R.eligibility(busySet, "2026-11-02", P, KHAN), "east-busy", "Set input accepted");
step("Khan East forecast and unknown coverage");
// Prompt 12 C (9/22): the forecast is consulted only OUTSIDE the published coverage
// (EAST_COVER ends 2027-01-31) - these Wednesdays are in February 2027.
const fc = makeCtx({ schedule: {}, eastForecast: { [KHAN]: { "2027-02-03": 0.7, "2027-02-10": 0.2, "2027-02-17": 0.5 } } });
blocked(R.eligibility(fc, "2027-02-03", P, KHAN), "east-forecast-busy:0.70");
okElig(R.eligibility(fc, "2027-02-03", B, KHAN), "forecast never blocks backup");
blocked(R.eligibility(fc, "2027-02-17", P, KHAN), "east-forecast-busy", "threshold is inclusive (>= 0.5)");
const fc11 = R.eligibility(fc, "2027-02-10", P, KHAN);
okElig(fc11); hasSoft(fc11, "east-forecast:0.20");
eq(fc11.soft.find(s => s.reason.startsWith("east-forecast")).weight, 2);
lacksSoft(fc11, "east-unknown", "a forecast entry outside coverage is not 'unknown'");
const unk = R.eligibility(clean, "2027-02-03", P, KHAN); // Wednesday outside coverage (ends 2027-01-31)
okElig(unk); hasSoft(unk, "east-unknown");
eq(unk.soft.find(s => s.reason === "east-unknown").weight, 1);
lacksSoft(R.eligibility(clean, "2027-02-03", B, KHAN), "east-unknown", "unknown only matters for the role East blocks");
const noCover = R.buildContext(SA.seedToContextInput(seed, { schedule: {}, eastDerived: DERIVED }));
hasSoft(R.eligibility(noCover, "2026-11-02", P, KHAN), "east-unknown", "no coverage at all = unknown everywhere");
ok(R.eligibility(noCover, "2026-11-02", P, KHAN).ok, "unknown is never silently busy");

/* ------------------------------------------------ Philip */
step("Philip Aledo and available weeks");
blocked(R.eligibility(clean, "2026-11-03", P, PHILIP), "day-before-aledo", "Tue before the 1st Wed");
lacks(R.eligibility(clean, "2026-11-03", B, PHILIP).hard, "day-before-aledo", "primary-only");
blocked(R.eligibility(clean, "2026-11-19", P, PHILIP), "day-before-aledo", "Thu before the 3rd-week Fri (11/20)");
lacks(R.eligibility(clean, "2026-11-19", B, PHILIP).hard, "day-before-aledo");
blocked(R.eligibility(clean, "2026-11-17", P, PHILIP), "day-before-aledo", "Tue before the 3rd Wed");
okElig(R.eligibility(clean, "2026-11-10", P, PHILIP), "Tue in an available week, 2nd Wed is not Aledo");
lacksSoft(R.eligibility(clean, "2026-11-10", P, PHILIP), "aledo-week");
okElig(R.eligibility(clean, "2026-11-12", P, PHILIP), "Thu 11/12 in week 11/9 (primary; 11/13 is not an Aledo day)");
blocked(R.eligibility(clean, "2026-11-12", B, PHILIP), "derived-lock-held:s5", "backup that week is Fierce's derived lock");
blocked(R.eligibility(clean, "2026-11-04", P, PHILIP), "outside-available-weeks", "week of 11/2 is not on his list");
okElig(R.eligibility(clean, "2026-11-04", B, PHILIP), "9/22: the weeks whitelist restricts primary only");
blocked(R.eligibility(clean, "2026-11-30", P, PHILIP), "outside-available-weeks");
okElig(R.eligibility(clean, "2026-12-08", B, PHILIP), "week of 12/7 (backup; primary that week is Fierce's derived lock)");
blocked(R.eligibility(clean, "2026-12-08", P, PHILIP), "derived-lock-held:s5");
const aledoWeek = R.eligibility(clean, "2026-12-14", P, PHILIP); // week of 12/14 contains 3rd Wed 12/16 + Fri 12/18 (not on his list anyway)
blocked(aledoWeek, "outside-available-weeks");
hasSoft(aledoWeek, "aledo-week", "strong soft on the Aledo week is reported even when hard-blocked");
eq(aledoWeek.soft.find(s => s.reason === "aledo-week").weight, 10, "strong = 10");
step("Philip October: lists are additive, day-before rules from the hand schedule");
blocked(R.eligibility(clean, "2026-10-15", P, PHILIP), "time-off:2026-10-15");
blocked(R.eligibility(clean, "2026-10-14", P, PHILIP), "day-before-vacation");
okElig(R.eligibility(clean, "2026-10-14", B, PHILIP), "he was backup 10/14 in the hand schedule");
blocked(R.eligibility(clean, "2026-10-22", P, PHILIP), "day-before-aledo", "Thu 10/22 before Aledo Friday 10/23");
okElig(R.eligibility(clean, "2026-10-22", B, PHILIP), "he was backup 10/22 in the hand schedule");
// Prompt 12 H (9/22): day-before-Aledo stays PRIMARY-only under the open-backup rule - a standby backup the day before
// an Aledo day is acceptable (his November edges too: Tue 11/03 and 11/17, Thu 11/19).
["2026-11-03", "2026-11-17", "2026-11-19", "2026-10-22"].forEach(d => {
  blocked(R.eligibility(clean, d, P, PHILIP), "day-before-aledo", "H: Philip primary " + d);
  lacks(R.eligibility(clean, d, B, PHILIP).hard, "day-before-aledo", "H: Philip backup " + d);
  okElig(R.eligibility(clean, d, B, PHILIP), "H: Philip backup " + d + " the day before an Aledo day is eligible");
});
blocked(R.eligibility(clean, "2026-10-23", B, PHILIP), "no-backup-row");
okElig(R.eligibility(clean, "2026-10-13", P, PHILIP), "October primary list day");
step("Philip backup caps");
const pb = {};
["2026-12-07", "2026-12-08", "2026-12-09", "2026-12-10", "2026-12-11", "2026-12-12", "2026-12-13"].forEach(d => { pb[d] = { backup: PHILIP }; });
blocked(R.eligibility(makeCtx({ schedule: pb }), "2026-12-21", B, PHILIP), "backup-cap:7");
okElig(R.eligibility(makeCtx({ schedule: pb }), "2026-12-21", P, PHILIP), "the backup cap does not touch primary (8th day is within the group cap)");
const pw = makeCtx({ schedule: { "2026-12-12": { backup: PHILIP } } });
blocked(R.eligibility(pw, "2026-12-26", B, PHILIP), "backup-weekend-cap:1", "second backup weekend in the month");
okElig(R.eligibility(pw, "2026-12-13", B, PHILIP), "same weekend counts once");
okElig(R.eligibility(pw, "2026-12-22", B, PHILIP), "a weekday backup is not a weekend");
step("Philip max one major holiday");
const pm = makeCtx({ schedule: { "2026-12-24": { primary: PHILIP }, "2026-12-25": { primary: PHILIP } } });
blocked(R.eligibility(pm, "2026-12-31", P, PHILIP), "max-major-holidays:1");
blocked(R.eligibility(pm, "2027-01-01", B, PHILIP), "max-major-holidays:1", "either role counts");
okElig(R.eligibility(clean, "2026-12-31", P, PHILIP), "first major holiday is fine");
okElig(R.eligibility(pm, "2026-12-25", P, PHILIP), "re-evaluating a held day of the same unit does not double count");

/* ------------------------------------------------ Fierce */
step("Fierce weekday pattern outside derived weeks");
const noDerived = makeCtx({ schedule: {}, eastDerived: [] });
blocked(R.eligibility(noDerived, "2026-11-10", P, FIERCE), "weekday-pattern:Tue", "11/10 with no derived week");
okElig(R.eligibility(noDerived, "2026-11-10", B, FIERCE), "9/22: a Clinton Tuesday is open for backup");
blocked(R.eligibility(clean, "2026-11-17", P, FIERCE), "weekday-pattern:Tue", "Tuesday outside a derived week");
okElig(R.eligibility(clean, "2026-11-17", B, FIERCE), "9/22: backup on a Clinton Tuesday");
okElig(R.eligibility(clean, "2026-11-05", B, FIERCE), "9/22: backup on a Clinton Thursday");
blocked(R.eligibility(clean, "2026-11-02", P, FIERCE), "weekday-pattern:Mon");
okElig(R.eligibility(clean, "2026-11-02", B, FIERCE), "Monday backup only");
blocked(R.eligibility(clean, "2026-11-06", P, FIERCE), "weekend-block-only");
blocked(R.eligibility(clean, "2026-11-07", P, FIERCE), "weekend-block-only", "Saturday standalone too");
okElig(R.eligibility(clean, "2026-11-06", P, FIERCE, { asBlockMember: true, assume: [{ date: "2026-11-07", role: P }, { date: "2026-11-08", role: P }] }), "Friday as the start of a Fri+Sat+Sun block");
okElig(R.eligibility(clean, "2026-11-08", P, FIERCE, { asBlockMember: true }), "block member flag alone relaxes the rule");
const wed18 = R.eligibility(clean, "2026-11-18", P, FIERCE);
okElig(wed18);
ok(wed18.soft.some(s => s.reason === "preferred" && s.weight === -1), "Wednesday carries a 'preferred' negative-weight soft entry: " + JSON.stringify(wed18.soft));
step("Fierce derived-week locks");
blocked(R.eligibility(clean, "2026-11-11", P, FIERCE), "derived-lock:backup", "Wed of his East-primary week is forced to Silvis backup");
okElig(R.eligibility(clean, "2026-11-11", B, FIERCE));
okElig(R.eligibility(clean, "2026-11-10", B, FIERCE), "Tue inside the derived week: the pattern does not apply");
blocked(R.eligibility(clean, "2026-11-11", B, PHILIP), "derived-lock-held:s5", "nobody else takes his derived slot (Philip: week of 11/9 is on his list; Burchett's 11/11 backup is off his November list since T)");
okElig(R.eligibility(clean, "2026-11-11", P, BURCHETT), "the other role is open");
blocked(R.eligibility(clean, "2026-12-09", B, FIERCE), "derived-lock:primary", "East backup week -> Silvis primary");
okElig(R.eligibility(clean, "2026-12-09", P, FIERCE));
okElig(R.eligibility(clean, "2026-12-13", P, FIERCE), "Sunday of a derived primary week (7 days, max consecutive 7)");
// import lock beats the derived lock
const ovr = makeCtx({ schedule: { "2026-11-11": { primary: null, backup: BURCHETT, backupLocked: true, primaryLocked: false } } });
okElig(R.eligibility(ovr, "2026-11-11", B, BURCHETT), "import lock holder stays");
blocked(R.eligibility(ovr, "2026-11-11", B, FIERCE), "slot-locked:s2");
lacks(R.eligibility(ovr, "2026-11-11", P, FIERCE).hard, "derived-lock", "the overridden derived lock no longer forces him");
// derivation starts at deriveFrom (2026-11-02): an October week is not derived
const octDerived = makeCtx({ schedule: {}, eastDerived: [{ weekMonday: "2026-10-12", surgeonId: FIERCE, silvisRole: "primary" }] });
lacks(R.eligibility(octDerived, "2026-10-14", B, FIERCE).hard, "derived-lock", "October is not derived (single locked day in the import instead)");
step("Fierce 14-day cap counting East days");
// 9/22 (Prompt 12 K): his 14 counts Silvis PRIMARY days plus the days of his East
// PRIMARY week (derived Silvis backup, 11/9-11/15). Backup days on either site and
// a Khan-style East busy-day set never count.
const capFree = makeCtx({ schedule: {} });
okElig(R.eligibility(capFree, "2026-11-04", P, FIERCE), "7 East primary-week days + 1 = 8");
const capBusy = makeCtx({ schedule: {}, eastBusyDays: { [FIERCE]: ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"] } });
okElig(R.eligibility(capBusy, "2026-11-04", P, FIERCE), "K: an East busy-day set is not an East primary week - it does not count (was monthly-cap:14 at 7 + 7 + 1)");
// November arithmetic pinned against 14: 7 East primary-week days + N Silvis primaries (assume-slots on non-adjacent days).
const sixP = ["2026-11-02", "2026-11-18", "2026-11-20", "2026-11-23", "2026-11-25", "2026-11-27"].map(d => ({ date: d, role: P }));
const sevenP = sixP.concat([{ date: "2026-11-30", role: P }]);
okElig(R.eligibility(capFree, "2026-11-04", P, FIERCE, { assume: sixP }), "K: 7 East primary-week days + 6 Silvis primaries + this one = 14 exactly");
blocked(R.eligibility(capFree, "2026-11-04", P, FIERCE, { assume: sevenP }), "monthly-cap:14", "K: 7 + 7 + 1 = 15");
okElig(R.eligibility(capFree, "2026-11-16", B, FIERCE, { assume: sevenP }), "K: at 14 primaries a backup is still eligible - backup days never count");
okElig(R.eligibility(capFree, "2026-12-02", P, FIERCE, { assume: sevenP }), "December is a fresh month");
// A Silvis backup held on an East primary-week day is the same day, never counted twice.
const capDistinct = makeCtx({ schedule: { "2026-11-09": { backup: FIERCE }, "2026-11-10": { backup: FIERCE } } });
okElig(R.eligibility(capDistinct, "2026-11-04", P, FIERCE, { assume: sixP }), "K: 7 (with two of them held as Silvis backup) + 6 + 1 = 14 exactly");
// His East BACKUP week 12/7-12/13 is Silvis primary: those 7 count as Silvis primaries, nothing is added for East.
const decHeld = {};
for (let k = 0; k < 7; k++) decHeld[R.rdAddDays("2026-12-07", k)] = { primary: FIERCE };
const decCtx = makeCtx({ schedule: decHeld });
const decSix = ["2026-12-02", "2026-12-18", "2026-12-21", "2026-12-23", "2026-12-28", "2026-12-30"].map(d => ({ date: d, role: P }));
okElig(R.eligibility(decCtx, "2026-12-16", P, FIERCE, { assume: decSix }), "K: 7 Silvis primaries of the derived week + 6 + this one = 14");
blocked(R.eligibility(decCtx, "2026-12-16", P, FIERCE, { assume: decSix.concat([{ date: "2026-12-04", role: P }]) }), "monthly-cap:14", "K: 7 + 7 + 1 = 15 in December");
step("K: legacy monthlyCap.total alias and the group default");
const srLeg = clone(seed.surgeonRules); srLeg[ACTON].monthlyCap = { total: 5 };
const legCtx = makeCtx({ schedule: {}, surgeonRules: srLeg });
eq(R.monthlyCapFor(legCtx, ACTON), { primary: 5, preferred: null, total: 5 }, "K: monthlyCap { total: 5 } behaves like { primary: 5 }");
ok(legCtx.warnings.some(w => w.indexOf(ACTON) >= 0 && /monthlyCap\.total/.test(w)), "K: buildContext warns once per surgeon still on the legacy total key: " + JSON.stringify(legCtx.warnings));
const fourP = ["2026-11-02", "2026-11-04", "2026-11-06", "2026-11-10"].map(d => ({ date: d, role: P }));
okElig(R.eligibility(legCtx, "2026-11-16", P, ACTON, { assume: fourP }), "K: 4 + 1 = 5 within the aliased cap");
blocked(R.eligibility(legCtx, "2026-11-16", P, ACTON, { assume: fourP.concat([{ date: "2026-11-12", role: P }]) }), "monthly-cap:5", "K: the aliased cap blocks the 6th primary");
okElig(R.eligibility(legCtx, "2026-11-17", B, ACTON, { assume: fourP.concat([{ date: "2026-11-12", role: P }]) }), "K: and never a backup (11/17 is on his November backup list)");
const grLeg = clone(seed.groupRules); grLeg.defaultMonthlyCap = { total: 8 };
const grCtx = makeCtx({ schedule: {}, groupRules: grLeg });
eq(R.monthlyCapFor(grCtx, PHILIP).primary, 8, "K: groupRules.defaultMonthlyCap { total: 8 } still yields 8");
ok(grCtx.warnings.some(w => /defaultMonthlyCap\.total/.test(w)), "K: and warns about the legacy group key: " + JSON.stringify(grCtx.warnings));
const legStr = clone(seed.surgeonRules); legStr[FIERCE].monthlyCap = { primary: 14, countsEastDays: "distinct-days" };
ok(makeCtx({ schedule: {}, surgeonRules: legStr }).per[FIERCE].countsEastDays === true, "K: the legacy countsEastDays string 'distinct-days' still reads as true");

/* ------------------------------------------------ holidays */
/* ------------------------------------------------ Prompt 12 A (9/22): consecutive-day rules */
// Seed pins: the holiday-unit collapse is a per-surgeon opt-in (Khan only); the
// any-role soft limit is per surgeon; the old group key is gone.
step("Prompt 12 A seed: per-surgeon consecutive keys");
ok(!("unitExemptFromMaxConsecutive" in seed.groupRules.holidays), "groupRules.holidays.unitExemptFromMaxConsecutive must be gone from the seed");
eq([KHAN, BURCHETT, ACTON, PHILIP, FIERCE, SARKAR].map(id => seed.surgeonRules[id].holidayUnitCountsAsOneDay), [true, false, false, false, false, false], "only Khan opted in to the unit collapse");
eq([KHAN, BURCHETT, ACTON, PHILIP, FIERCE, SARKAR].map(id => seed.surgeonRules[id].maxConsecutiveDays), [3, 2, 3, 4, 7, 2], "hard primary-only limits");
eq([KHAN, BURCHETT, ACTON, PHILIP, FIERCE, SARKAR].map(id => seed.surgeonRules[id].maxConsecutiveAnyRole), [4, 3, 4, 4, 7, 2], "soft any-role limits");
eq(seed.groupRules.weights.longRunPerDay, 3, "longRunPerDay = the medium weight");
eq(R.defaultWeights().longRunPerDay, 3, "engine default for longRunPerDay (older blobs without the key)");
const srNoCollapse = clone(SA.seedToSurgeonRules(seed)); srNoCollapse[KHAN].holidayUnitCountsAsOneDay = false;

step("Prompt 12 A: the hard max-consecutive counts REAL primary days unless the surgeon opted in");
// Burchett (max 2, no opt-in): locked primary 12/30 + 12/31 (both on his December list) -> 1/1 primary is a third real day.
// Before Prompt 12 A the New Year unit (12/31 + 1/1) collapsed to one commitment for everyone and 1/1 was ok.
const burNY = makeCtx({ schedule: { "2026-12-30": { primary: BURCHETT, primaryLocked: true }, "2026-12-31": { primary: BURCHETT, primaryLocked: true } } });
blocked(R.eligibility(burNY, "2027-01-01", P, BURCHETT), "max-consecutive:2", "Burchett 12/30 + 12/31 + 1/1 = 3 real primary days > 2");
okElig(R.eligibility(makeCtx({ schedule: { "2026-12-31": { primary: BURCHETT, primaryLocked: true } } }), "2027-01-01", P, BURCHETT), "12/31 + 1/1 = 2 real days is his limit, not over it");
const burNYb = R.eligibility(burNY, "2027-01-01", B, BURCHETT);
okElig(burNYb, "the hard limit stays primary-only: backup on 1/1 after two primaries is allowed");
lacksSoft(burNYb, "long-run", "12/30 P + 12/31 P + 1/1 B = 3 any-role days = his soft limit 3, no penalty");
const burNY3 = makeCtx({ schedule: { "2026-12-30": { primary: BURCHETT }, "2026-12-31": { primary: BURCHETT }, "2027-01-01": { backup: BURCHETT } } });
const bur0102 = R.eligibility(burNY3, "2027-01-02", B, BURCHETT);
okElig(bur0102, "a 4th any-role day is legal...");
hasSoft(bur0102, "long-run:4", "...but carries the long-run penalty");
eq((bur0102.soft.find(s => s.reason === "long-run:4") || {}).weight, 3, "weight = longRunPerDay * (4 - 3)");
// Review 9/22 (item A, fix stage): talliesFor reports the REAL run touching the month, followed across the
// month edges like helpers ttTotalsFor - Burchett 12/30 -> 1/1 reads 3 in December AND in January, not 2 / 1
// (the month cut was one of the two reasons the old "Max consec. 2" column hid that run). Counts stay month-scoped.
const burNY3d = makeCtx({ schedule: { "2026-12-30": { primary: BURCHETT, primaryLocked: true }, "2026-12-31": { primary: BURCHETT, primaryLocked: true }, "2027-01-01": { primary: BURCHETT, primaryLocked: true } } });
const burDec = R.talliesFor(burNY3d, BURCHETT, "2026-12"), burJan = R.talliesFor(burNY3d, BURCHETT, "2027-01");
eq([burDec.maxConsecutive, burDec.maxConsecutiveAnyRole], [3, 3], "talliesFor December follows Burchett's 12/30 -> 1/1 primary run across the month edge");
eq([burJan.maxConsecutive, burJan.maxConsecutiveAnyRole], [3, 3], "talliesFor January sees the same 3-day run from its side");
eq([burDec.primary, burJan.primary, burDec.total, burJan.total], [2, 1, 2, 1], "the counts stay month-scoped");
const burMixDec = R.talliesFor(burNY3, BURCHETT, "2026-12"), burMixJan = R.talliesFor(burNY3, BURCHETT, "2027-01");
eq([burMixDec.maxConsecutive, burMixDec.maxConsecutiveAnyRole], [2, 3], "12/30 P + 12/31 P + 1/1 B: December primary run 2, any-role run 3 across the edge");
eq([burMixJan.maxConsecutive, burMixJan.maxConsecutiveAnyRole], [0, 3], "January: no primary run, the any-role run through 1/1 is still 3");

step("Prompt 12 A: Khan's opt-in - the Thanksgiving unit is one day, the real days around it still count");
const khanTg = {}; ["2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"].forEach(d => { khanTg[d] = { primary: KHAN, primaryLocked: true }; });
const k1sched = Object.assign({ "2026-11-25": { primary: KHAN } }, khanTg);
okElig(R.eligibility(makeCtx({ schedule: k1sched }), "2026-11-30", P, KHAN), "11/25 + unit(1) + 11/30 = 3 commitments = his max 3");
blocked(R.eligibility(makeCtx({ schedule: Object.assign({ "2026-11-24": { primary: KHAN } }, k1sched) }), "2026-11-30", P, KHAN), "max-consecutive:3", "11/24 + 11/25 + unit(1) + 11/30 = 4 > 3");
blocked(R.eligibility(makeCtx({ schedule: k1sched, surgeonRules: srNoCollapse }), "2026-11-30", P, KHAN), "max-consecutive:3", "without his opt-in the unit is 4 real days: 11/25 + 4 + 11/30 = 6");
const k1b = R.eligibility(makeCtx({ schedule: k1sched }), "2026-11-30", B, KHAN);
okElig(k1b); lacksSoft(k1b, "long-run", "any-role with his opt-in: 11/25 + unit(1) + 11/30 B = 3 <= his soft limit 4");
const k1bReal = R.eligibility(makeCtx({ schedule: k1sched, surgeonRules: srNoCollapse }), "2026-11-30", B, KHAN);
hasSoft(k1bReal, "long-run:6", "without the opt-in the same shape is 6 real any-role days");
eq((k1bReal.soft.find(s => s.reason === "long-run:6") || {}).weight, 3 * (6 - 4), "weight 3 * (6 - 4) = 6");

step("Prompt 12 A: the any-role soft limit (Philip 4) with the long-run penalty");
const phSched = { "2026-12-22": { primary: PHILIP }, "2026-12-23": { backup: PHILIP }, "2026-12-24": { backup: PHILIP }, "2026-12-25": { backup: PHILIP }, "2026-12-26": { primary: PHILIP }, "2026-12-27": { primary: PHILIP }, "2026-12-28": { primary: PHILIP } };
const ph = makeCtx({ schedule: phSched });
const ph29 = R.eligibility(ph, "2026-12-29", P, PHILIP);
okElig(ph29, "12/29 primary: a 4th straight primary day = his hard max 4, allowed");
hasSoft(ph29, "long-run:8", "12/22 .. 12/29 = 8 straight any-role days");
eq((ph29.soft.find(s => s.reason === "long-run:8") || {}).weight, 3 * (8 - 4), "weight = longRunPerDay * (8 - 4) = 12");
hasSoft(R.eligibility(ph, "2026-12-29", B, PHILIP), "long-run:8", "a backup slot extends the run the same way");
const phGap = clone(phSched); delete phGap["2026-12-23"]; // the review's literal shape: 12/22 P, 12/24-25 B, 12/26-28 P (12/23 open)
const ph29g = R.eligibility(makeCtx({ schedule: phGap }), "2026-12-29", P, PHILIP);
hasSoft(ph29g, "long-run:6", "with 12/23 open the run through 12/29 is 12/24 .. 12/29 = 6");
eq((ph29g.soft.find(s => s.reason === "long-run:6") || {}).weight, 3 * (6 - 4), "weight 6");
lacksSoft(R.eligibility(makeCtx({ schedule: { "2026-12-26": { primary: PHILIP }, "2026-12-27": { primary: PHILIP }, "2026-12-28": { primary: PHILIP } } }), "2026-12-29", P, PHILIP), "long-run", "4 days = the limit itself, no penalty");
const srNoAny = clone(SA.seedToSurgeonRules(seed)); delete srNoAny[PHILIP].maxConsecutiveAnyRole;
lacksSoft(R.eligibility(makeCtx({ schedule: phSched, surgeonRules: srNoAny }), "2026-12-29", P, PHILIP), "long-run", "no maxConsecutiveAnyRole -> no soft limit (there is no group default)");
const phT = R.talliesFor(ph, PHILIP, "2026-12");
eq([phT.maxConsecutive, phT.maxConsecutiveAnyRole], [3, 7], "talliesFor December: 3 straight primaries, 7 straight any-role days (real days)");
const k1T = R.talliesFor(makeCtx({ schedule: Object.assign({ "2026-11-30": { primary: KHAN } }, k1sched) }), KHAN, "2026-11");
eq([k1T.maxConsecutive, k1T.maxConsecutiveAnyRole], [3, 3], "talliesFor Khan November with his opt-in: 11/25 + unit(1) + 11/30 = 3 for both measures");
const k1Treal = R.talliesFor(makeCtx({ schedule: Object.assign({ "2026-11-30": { primary: KHAN } }, k1sched), surgeonRules: srNoCollapse }), KHAN, "2026-11");
eq([k1Treal.maxConsecutive, k1Treal.maxConsecutiveAnyRole], [6, 6], "...and 6 real days for both without it");

step("Prompt 12 A: the legacy group key is ignored with ONE warning, never honoured");
const legacyGroup = clone(seed.groupRules); legacyGroup.holidays.unitExemptFromMaxConsecutive = true;
const ctxLegacy = makeCtx({ schedule: k1sched, surgeonRules: srNoCollapse, groupRules: legacyGroup });
eq(ctxLegacy.warnings.filter(w => /unitExemptFromMaxConsecutive/.test(w)).length, 1, "exactly one warning names the legacy key");
blocked(R.eligibility(ctxLegacy, "2026-11-30", P, KHAN), "max-consecutive:3", "the legacy group key does not collapse the unit for a surgeon who did not opt in");
eq(makeCtx({ schedule: k1sched }).warnings.filter(w => /unitExemptFromMaxConsecutive/.test(w)).length, 0, "no warning when the key is absent");

step("Thanksgiving 2026 decisions");
const tg = R.eligibility(ctx, "2026-11-26", P, KHAN);
okElig(tg, "Khan primary on Thanksgiving Thursday: the Thu block is waived");
lacks(tg.hard, "hard-never-weekday");
okElig(R.eligibility(ctx, "2026-11-29", P, KHAN), "4-day unit is one day for Khan (holidayUnitCountsAsOneDay; max consecutive 3)");
okElig(R.eligibility(clean, "2026-11-29", P, KHAN, { assume: ["2026-11-26", "2026-11-27", "2026-11-28"].map(d => ({ date: d, role: P })) }), "unit evaluated with assume");
// 9/22 Prompt 12 A: the collapse is his opt-in, not a group flag
const noEx = R.eligibility(makeCtx({ surgeonRules: srNoCollapse }), "2026-11-29", P, KHAN);
ok(noEx.ok && noEx.lockHolder === true, "the locked holder stays ok...");
has(noEx.conflicts, "max-consecutive:3", "...but without his opt-in the 4th locked day is reported as a conflict (real days)");
const unlockedTg = {}; ["2026-11-26", "2026-11-27", "2026-11-28"].forEach(d => { unlockedTg[d] = { primary: KHAN }; });
blocked(R.eligibility(makeCtx({ schedule: unlockedTg, surgeonRules: srNoCollapse }), "2026-11-29", P, KHAN), "max-consecutive:3", "unlocked: without his opt-in the 4th real day breaks his max 3");
okElig(R.eligibility(makeCtx({ schedule: unlockedTg }), "2026-11-29", P, KHAN), "unlocked with his opt-in: fine");
okElig(R.eligibility(ctx, "2026-11-26", B, BURCHETT), "Burchett backup on a Thursday: holiday exemption");
okElig(R.eligibility(ctx, "2026-11-26", B, FIERCE), "Fierce backup on a Thursday: holiday exemption");
okElig(R.eligibility(ctx, "2026-11-28", B, FIERCE), "Fierce lone Saturday: holiday exemption");
okElig(R.eligibility(ctx, "2026-11-26", B, PHILIP), "Philip: week of 11/23 is available; first major holiday");
const ac = R.eligibility(ctx, "2026-11-26", B, ACTON);
blocked(ac, "holiday-opt-out:Thanksgiving");
has(ac.hard, "time-off:2026-11-26");
blocked(R.eligibility(ctx, "2026-11-26", B, KHAN), "holds-other-role", "locked primary cannot also be backup");
blocked(R.eligibility(ctx, "2026-11-26", P, BURCHETT), "slot-locked:s1");
blocked(R.eligibility(ctx, "2026-11-26", B, SARKAR), "outside-window", "Sarkar windows still apply on holidays");
step("holidayUnits / holidayUnitCandidates");
const units = R.holidayUnits(ctx, "2026-11-01", "2027-01-01");
eq(units.map(u => u.name), ["Thanksgiving", "Christmas", "New Year's"]);
eq(units[2].days, ["2026-12-31", "2027-01-01"]);
eq(units[2].year, "2026");
eq(R.holidayUnits(ctx, "2027-01-01", "2027-01-10").map(u => u.name), ["New Year's"], "found by its second day across the year boundary");
eq(R.holidayUnits(ctx, "2026-12-01", "2026-12-23"), []);
eq(R.holidayUnitCandidates(ctx, units[0], P), [KHAN], "locked primary is the only primary candidate");
eq(R.holidayUnitCandidates(ctx, units[0], B), [BURCHETT, PHILIP, FIERCE], "backup candidates: not Khan (primary), not Acton (opt-out), not Sarkar (window)");
const xmasP = R.holidayUnitCandidates(clean, units[1], P);
ok(xmasP.indexOf(ACTON) >= 0 && xmasP.indexOf(PHILIP) >= 0, "Christmas primary candidates include Acton, Philip: " + xmasP);
ok(xmasP.indexOf(KHAN) < 0, "...but not Khan since V (9/22 evening): standing East call on 12/24 + 12/25 every year - see the V block at the end: " + xmasP);
ok(xmasP.indexOf(SARKAR) < 0, "Sarkar is outside her window at Christmas");
// unit-wide counting: Burchett with 7 December PRIMARY days already cannot take the 2-day Christmas unit as primary (cap 8 primary days)
const bx = {};
["2026-12-01", "2026-12-05", "2026-12-06", "2026-12-09", "2026-12-14", "2026-12-19", "2026-12-20"].forEach(d => { bx[d] = { primary: BURCHETT }; });
ok(R.holidayUnitCandidates(makeCtx({ schedule: bx }), units[1], P).indexOf(BURCHETT) < 0, "a 2-day unit is counted as a whole against the cap");
ok(R.eligibility(makeCtx({ schedule: bx }), "2026-12-25", P, BURCHETT).ok, "...even though each day alone would fit");
// 9/22 (Prompt 12 K): the same 7 days held as BACKUP do not count - his candidacy for the primary unit is whatever it is with an empty December
const bxB = {};
Object.keys(bx).forEach(d => { bxB[d] = { backup: BURCHETT }; });
eq(R.holidayUnitCandidates(makeCtx({ schedule: bxB }), units[1], P).indexOf(BURCHETT) >= 0, R.holidayUnitCandidates(clean, units[1], P).indexOf(BURCHETT) >= 0, "K: 7 backup days held do not cost him the 2-day primary unit (was excluded by monthly-cap:8)");
ok(R.holidayUnitCandidates(clean, units[1], P).indexOf(BURCHETT) >= 0, "fixture: Burchett is a Christmas primary candidate with an empty December (so the line above is a real check)");

/* ------------------------------------------------ external cover and locks */
step("externalCover 2026-09-30");
ctx.activeIds.forEach(id => blocked(R.eligibility(ctx, "2026-09-30", P, id), "external-cover", id));
okElig(R.eligibility(ctx, "2026-09-30", B, FIERCE), "Fierce is the locked backup");
blocked(R.eligibility(ctx, "2026-09-30", B, BURCHETT), "slot-locked:s5");
lacks(R.eligibility(ctx, "2026-09-30", B, BURCHETT, { ignoreLocks: true }).hard, "slot-locked", "ignoreLocks lifts the slot lock");
step("open October slots: 10/15 primary is open for nobody (rules doc section 8 item 1); since 9/22 its backup slot is open");
const OCT15 = "2026-10-15";
const why1015 = { [KHAN]: "hard-never-weekday:Thu", [BURCHETT]: "whitelist-month", [ACTON]: "whitelist-month", [PHILIP]: "time-off:2026-10-15", [FIERCE]: "weekday-pattern:Thu", [SARKAR]: "outside-window" };
ctx.activeIds.forEach(id => blocked(R.eligibility(ctx, OCT15, P, id), why1015[id], id + " primary 10/15"));
eq(ctx.activeIds.filter(id => R.eligibility(ctx, OCT15, P, id).ok), [], "nobody can take 10/15 primary");
eq(ctx.activeIds.filter(id => R.eligibility(ctx, OCT15, B, id).ok), [KHAN, BURCHETT, ACTON, FIERCE], "10/15 backup: open to everyone the day rules used to block (9/22)");
blocked(R.eligibility(ctx, OCT15, B, PHILIP), "time-off:2026-10-15", "Philip backup 10/15");
has(R.eligibility(ctx, OCT15, B, PHILIP).hard, "no-backup-row", "Philip's own backup exclusion is reported too");
blocked(R.eligibility(ctx, OCT15, B, SARKAR), "outside-window", "Sarkar backup 10/15");
step("Acton/Philip October lists govern (role-scoped)");
blocked(R.eligibility(clean, "2026-10-06", P, ACTON), "whitelist-month", "10/6 is on his BACKUP list only");
okElig(R.eligibility(clean, "2026-10-06", B, ACTON));
blocked(R.eligibility(clean, "2026-10-16", P, ACTON), "whitelist-month", "an unlisted October Friday");
okElig(R.eligibility(clean, "2026-10-16", B, ACTON), "9/22: the governed month restricts primary only");
okElig(R.eligibility(clean, "2026-10-23", P, ACTON), "10/23 (Burchett 9/18 delta) is on his list");
okElig(R.eligibility(clean, "2026-10-10", P, ACTON), "10/10 (the ER-panel author 9/16 Fri-Sun block) is on his list");
okElig(R.eligibility(clean, "2026-11-02", P, ACTON), "11/2 (a 1st Monday) is open to him under his recurring rules (Y: November is no longer a governed month for him)");
okElig(R.eligibility(clean, "2027-01-04", P, ACTON), "January is not governed for Acton (1st Monday, recurring rules only)");
blocked(R.eligibility(clean, "2026-10-09", P, PHILIP), "whitelist-month", "Philip's October PRIMARY list governs primary");
okElig(R.eligibility(clean, "2026-10-09", B, PHILIP), "...but not backup: he only excluded four backup days");
blocked(R.eligibility(clean, "2026-10-21", B, PHILIP), "no-backup-row");
ctx.activeIds.forEach(id => { const r = R.eligibility(ctx, "2026-10-10", P, id); ok(r.ok === (id === ACTON), id + " on locked 10/10: " + JSON.stringify(r.hard)); });
eq(R.eligibility(ctx, "2026-10-10", P, ACTON).conflicts, [], "Acton's locked 10/10 has no rule conflict now that it is on his list");
eq(R.eligibility(ctx, "2026-10-15", P, "s9").hard, ["unknown-surgeon"]);
eq(R.eligibility(ctx, "2026-10-15", "night", KHAN).hard, ["bad-role:night"]);
const inactive = R.buildContext(SA.seedToContextInput(seed, { schedule: {}, roster: seed.roster.map(r => r.id === SARKAR ? Object.assign({}, r, { active: false }) : r) }));
blocked(R.eligibility(inactive, "2026-10-20", P, SARKAR), "inactive");
ok(inactive.activeIds.indexOf(SARKAR) < 0);

/* ------------------------------------------------ weekend patterns */
step("weekendUnitPatterns");
// The generic pattern shapes are pinned on the 1/22-24 weekend (January 2027 is ungoverned for everyone): since
// Prompt 12 T (9/22) November is governed for Burchett and Acton in both roles by the ER-panel author's published lists, so a
// November weekend off their lists offers neither of them.
const wp = R.weekendUnitPatterns(clean, "2027-01-22");
ok(wp.length > 0, "patterns found");
ok(wp.every((p, i) => i === 0 || wp[i - 1].penalty <= p.penalty), "sorted by penalty");
const blocks = wp.filter(p => p.kind === "block");
const splits = wp.filter(p => p.kind === "split");
const dailies = wp.filter(p => p.kind === "daily");
ok(blocks.some(p => p.members.fri === KHAN && p.members.sat === KHAN && p.members.sun === KHAN), "Khan block");
ok(blocks.some(p => p.members.fri === FIERCE), "Fierce block (his only way to take a Friday)");
ok(!blocks.some(p => p.members.fri === BURCHETT && p.penalty === 0), "Burchett block carries a mismatch penalty");
ok(splits.some(p => p.members.fri === BURCHETT && p.members.sun === BURCHETT && p.members.sat === ACTON), "Burchett Fri+Sun / Acton Sat");
ok(splits.some(p => p.members.fri === ACTON && p.members.sun === ACTON && p.members.sat === BURCHETT), "Acton Fri+Sun / Burchett Sat");
ok(!splits.some(p => p.members.fri === FIERCE), "Fierce never splits");
ok(dailies.length > 0 && dailies.every(p => p.fallback === true), "daily is the fallback");
ok(blocks.concat(splits).every(p => p.fallback === false));
ok(wp[0].kind !== "daily", "cheapest pattern is not daily");
ok(wp.every(p => p.members.fri !== SARKAR && p.members.sat !== SARKAR && p.members.sun !== SARKAR), "Sarkar on no day of the 1/22 weekend (outside every window)");
ok(dailies.every(p => p.penalty >= 5), "daily carries weights.patternDaily");
ok(!dailies.some(p => p.members.fri === p.members.sat && p.members.sat === p.members.sun), "block shapes are not repeated as daily");
// 9/22 evening (Prompt 12 N): weekendStyle "daily" + weekendBlockPenalty "strong". A window Friday is an
// ordinary standalone day for her (memberPen 0 in a daily pattern); a multi-day block or a split membership
// is still offered but carries + resolveWeight(weekendBlockPenalty) = +10 per surgeon. Windows are Mon-Fri, so
// with the real seed she appears on Fri 11/20 only (Sat 11/21 and Sun 11/22 are outside the window).
const wpS = R.weekendUnitPatterns(clean, "2026-11-20", "primary");
ok(!wpS.some(p => p.members.sat === SARKAR || p.members.sun === SARKAR), "real seed: Sarkar on no Sat/Sun of the 11/20 weekend (outside her Mon-Fri window)");
const dailyFriS = wpS.filter(p => p.kind === "daily" && p.members.fri === SARKAR);
ok(dailyFriS.length > 0, "9/22 evening: a daily pattern with Sarkar on the window Friday exists (before: no pattern contained her on a Friday)");
ok(!wpS.some(p => p.kind === "block" && p.members.fri === SARKAR), "real seed: no block with her (she cannot take Sat/Sun)");
// her Friday memberPen is 0: the same daily pattern costs exactly weights.patternMismatch (3) more when her style is "block"
const srBlockS = clone(SA.seedToSurgeonRules(seed)); srBlockS[SARKAR].weekendStyle = "block";
const wpSB = R.weekendUnitPatterns(makeCtx({ schedule: {}, surgeonRules: srBlockS }), "2026-11-20", "primary");
const sameShape = (a, b) => a.members.fri === b.members.fri && a.members.sat === b.members.sat && a.members.sun === b.members.sun;
const cheapS = dailyFriS.slice().sort((a, b) => a.penalty - b.penalty)[0];
const cheapSB = wpSB.find(p => p.kind === "daily" && sameShape(p, cheapS));
ok(cheapSB && cheapSB.penalty - cheapS.penalty === 3, "daily style: her Friday memberPen is 0 (block style on the same shape costs +3): " + JSON.stringify([cheapS, cheapSB]));
// a multi-day block with her carries the +10 weekendBlockPenalty: synthetic Nov 16-21 window (Saturday inside),
// reduced unit Fri+Sat (present.length 2; a 3-day block is hard-blocked by her max 2 consecutive anyway)
const srSatNov = clone(SA.seedToSurgeonRules(seed)); srSatNov[SARKAR].availableWindows = srSatNov[SARKAR].availableWindows.map(w => w.start === "2026-11-16" ? { start: w.start, end: "2026-11-21" } : w);
const srSatNovNoPen = clone(srSatNov); delete srSatNovNoPen[SARKAR].weekendBlockPenalty;
const wpS2 = R.weekendUnitPatterns(makeCtx({ schedule: {}, surgeonRules: srSatNov }), "2026-11-20", "primary", ["2026-11-20", "2026-11-21"]);
const wpS2np = R.weekendUnitPatterns(makeCtx({ schedule: {}, surgeonRules: srSatNovNoPen }), "2026-11-20", "primary", ["2026-11-20", "2026-11-21"]);
const blockS = wpS2.find(p => p.kind === "block" && p.members.fri === SARKAR && p.members.sat === SARKAR);
const blockSnp = wpS2np.find(p => p.kind === "block" && p.members.fri === SARKAR && p.members.sat === SARKAR);
ok(blockS && blockSnp, "with a Saturday inside the window a Fri+Sat block with her is OFFERED (soft, not refused): " + JSON.stringify([blockS, blockSnp]));
eq(blockS && blockSnp ? blockS.penalty - blockSnp.penalty : null, 10, "...and carries the +10 weekendBlockPenalty (strong) on top of the same block without the key");
ok(wpS2.some(p => p.kind === "daily" && p.members.fri === SARKAR && p.members.sat !== SARKAR), "her standalone Friday in a daily pattern is still offered beside it");
ok(wpS2.some(p => p.kind === "daily" && p.members.sat === SARKAR && p.members.fri !== SARKAR), "and a standalone Saturday inside a window too");
// weekendStyle "saturday-only" (older blobs) keeps working: Saturday member of a split / daily only, never a block, never Fri/Sun
const srSatOnly = clone(srSatNov); srSatOnly[SARKAR].weekendStyle = "saturday-only";
const wpSO = R.weekendUnitPatterns(makeCtx({ schedule: {}, surgeonRules: srSatOnly }), "2026-11-20", "primary");
ok(wpSO.some(p => p.kind === "split" && p.members.sat === SARKAR), "legacy saturday-only: the Saturday member of a split");
ok(!wpSO.some(p => p.members.fri === SARKAR || p.members.sun === SARKAR), "legacy saturday-only: never on Fri/Sun");
ok(!wpSO.some(p => p.kind === "block" && p.members.sat === SARKAR), "legacy saturday-only: never a block");
// (N review, fix stage) weekendBlockPenalty values: a weight name or a number is applied as given; an unknown
// string falls back to weights.medium (resolveWeight's documented fallback) and buildContext says so ONCE, so a
// typo in the blob is never a silent downgrade from strong (10) to medium (3).
ok(!clean.warnings.some(w => /weekendBlockPenalty/.test(w)), "the seed's weekendBlockPenalty 'strong' warns nothing: " + JSON.stringify(clean.warnings));
const srNumPen = clone(SA.seedToSurgeonRules(seed)); srNumPen[SARKAR].weekendBlockPenalty = 4;
const numPenCtx = makeCtx({ schedule: {}, surgeonRules: srNumPen });
eq(numPenCtx.per[SARKAR].blockPenalty, 4, "a numeric weekendBlockPenalty is applied as given");
ok(!numPenCtx.warnings.some(w => /weekendBlockPenalty/.test(w)), "...and warns nothing");
const srBogusPen = clone(SA.seedToSurgeonRules(seed)); srBogusPen[SARKAR].weekendBlockPenalty = "bogus";
const bogusPenCtx = makeCtx({ schedule: {}, surgeonRules: srBogusPen });
eq(bogusPenCtx.per[SARKAR].blockPenalty, 3, "an unknown weekendBlockPenalty string falls back to weights.medium (3)");
eq(bogusPenCtx.warnings.filter(w => /surgeonRules\.s6\.weekendBlockPenalty/.test(w)).length, 1, "...and buildContext warns exactly once, naming the path: " + JSON.stringify(bogusPenCtx.warnings));
// backup role with primary already set: Khan holds primary Fri-Sun
const wb = makeCtx({ schedule: { "2026-11-06": { primary: KHAN }, "2026-11-07": { primary: KHAN }, "2026-11-08": { primary: KHAN } } });
const wpB = R.weekendUnitPatterns(wb, "2026-11-06", "backup");
ok(wpB.length > 0);
ok(wpB.every(p => p.members.fri !== KHAN && p.members.sat !== KHAN && p.members.sun !== KHAN), "backup != primary each day");
// reduced unit after a holiday pre-empted Friday (e.g. a Friday holiday): only Sat+Sun remain
const wpR = R.weekendUnitPatterns(clean, "2026-11-06", "primary", ["2026-11-07", "2026-11-08"]);
ok(wpR.length > 0);
ok(wpR.every(p => p.kind !== "split"), "no split in a reduced unit");
ok(wpR.every(p => p.members.fri === null), "absent day stays null");
ok(!wpR.some(p => p.kind === "block" && p.members.sat === FIERCE), "Fierce takes no reduced block (never a partial weekend)");
ok(wpR.some(p => p.kind === "block" && p.members.sat === KHAN && p.members.sun === KHAN), "Khan block(remaining)");
// Thanksgiving weekend: Fri-Sun are unit days, Khan locked -> Khan the only primary block
const wpT = R.weekendUnitPatterns(ctx, "2026-11-27");
ok(wpT.length === 1 && wpT[0].kind === "block" && wpT[0].members.fri === KHAN, "locked holder is the only weekend pattern: " + JSON.stringify(wpT));
let threw = false;
try { R.weekendUnitPatterns(clean, "2026-11-07"); } catch (e) { threw = true; }
ok(threw, "a non-Friday is refused");

/* ------------------------------------------------ tallies */
step("talliesFor");
const tOct = R.talliesFor(ctx, ACTON, "2026-10");
eq(tOct.primary, 10, "Acton October primaries in the import: 5,7,9,10,11,17,18,19,21,23");
eq(tOct.backup, 3, "Acton October backups: 6, 8, 20");
eq(tOct.total, 13);
eq(tOct.weekendDays, 6, "9,10,11,17,18,23");
eq(tOct.maxConsecutive, 3, "9-10-11 and 17-18-19 (backup 20 does not extend the run)");
const tNov = R.talliesFor(ctx, KHAN, "2026-11");
eq(tNov, { primary: 5, backup: 0, total: 5, weekendDays: 3, majorHolidays: 1, minorHolidays: 0, maxConsecutive: 2, maxConsecutiveAnyRole: 2 }, "T: 11/25 + the Thanksgiving unit = 5 shifts, 1 major holiday, run 2 for both measures (the unit is one day for Khan)");
eq(R.talliesFor(makeCtx({ surgeonRules: srNoCollapse }), KHAN, "2026-11").maxConsecutive, 5, "without his opt-in the same shape reads 5 real days (11/25 + 4)");
eq(R.talliesFor(ctx, SARKAR, "2026-10").primary, 2, "Sarkar October primaries 10/20 + 10/22 (10/24 came off her 9/22 evening)");
eq(R.talliesFor(clean, SARKAR, "2026-10"), { primary: 0, backup: 0, total: 0, weekendDays: 0, majorHolidays: 0, minorHolidays: 0, maxConsecutive: 0, maxConsecutiveAnyRole: 0 });
eq(R.talliesFor(ctx, FIERCE, "2026-09").backup, 3, "Fierce backup 9/28-9/30");

/* ------------------------------------------------ fix round 1 regressions */
const row = (id, kind, date, role, weight) => ({ person_id: id, kind: kind, role: role || "any", start_date: date, end_date: date, weight: weight });
function withRows(extraRows, extras) {
  return R.buildContext(SA.seedToContextInput(seed, Object.assign({ schedule: {}, eastDerived: DERIVED, eastFeedCoverage: EAST_COVER, availabilityRows: SA.seedToAvailabilityRows(seed).concat(extraRows) }, extras || {})));
}

step("fidelity-02/contract-003: a dated available row lifts the pattern family for its role - hardNeverWeekdays included since Prompt 12 W (9/22 evening), never availableWindows");
const lift = withRows([
  row(ACTON, "available", "2026-11-09", "primary"),
  row(FIERCE, "available", "2026-11-17"),
  row(FIERCE, "available", "2026-11-06", "primary"),
  row(FIERCE, "backup_only", "2026-11-05"),
  row(PHILIP, "available", "2026-11-03", "primary"),
  row(KHAN, "available", "2026-10-15"),
  row(SARKAR, "available", "2026-10-30"),
  row(SARKAR, "available", "2026-10-27", "primary")
]);
okElig(R.eligibility(lift, "2026-11-09", P, ACTON), "row lifts recurring-unavailable (2nd Monday)");
hasSoft(R.eligibility(lift, "2026-11-08", P, ACTON), "recurring-avoid:Sun", "soft preferences are not lifted");
blocked(R.eligibility(lift, "2026-11-09", B, PHILIP), "derived-lock-held:s5", "11/09 backup is Fierce's derived lock, not a pattern block (Philip; Acton's 11/9 backup is off his November list since T)");
okElig(R.eligibility(lift, "2026-12-14", B, ACTON), "9/22: backup on a 2nd Monday (12/14, outside any derived week) needs no row");
// Prompt 12 W (9/22 evening) FLIP: before W a primary row lifted outside-window here (okElig). Faraz's W puts Sarkar's
// windows among the obligations a dated row never lifts - a row outside a window does not open the day.
blocked(R.eligibility(lift, "2026-10-27", P, SARKAR), "outside-window", "W: a primary row does NOT lift outside-window (Tue 10/27 is after her October window; windows are an obligation)");
blocked(R.eligibility(lift, "2026-10-27", B, SARKAR), "outside-window", "a primary-only row does not free backup");
okElig(R.eligibility(lift, "2026-11-17", P, FIERCE), "row lifts weekday-pattern:Tue");
okElig(R.eligibility(lift, "2026-11-17", B, FIERCE), "any-role row lifts both roles");
okElig(R.eligibility(lift, "2026-11-06", P, FIERCE), "row lifts weekend-block-only (a standalone Friday)");
okElig(R.eligibility(lift, "2026-11-06", B, FIERCE), "9/22: a standalone Friday backup needs no row");
okElig(R.eligibility(lift, "2026-11-05", B, FIERCE), "backup_only row lifts the Thursday pattern for backup");
blocked(R.eligibility(lift, "2026-11-05", P, FIERCE), "backup-only-row");
okElig(R.eligibility(lift, "2026-11-03", P, PHILIP), "row lifts day-before-aledo");
// Prompt 12 W (9/22 evening) FLIP: before W this was blocked("hard-never-weekday:Thu", "hardNeverWeekdays is never lifted
// by a row"). Own dates beat own patterns: his any-role row on Thu 10/15 lifts the OR-day rule for primary that date.
okElig(R.eligibility(lift, "2026-10-15", P, KHAN), "W: a dated row of his lifts hard-never-weekday:Thu for primary on that date");
lacks(R.eligibility(lift, "2026-10-15", P, KHAN).hard, "weekday-not-allowed", "W: the Mon/Wed allow-list does not re-block a lifted OR day");
okElig(R.eligibility(lift, "2026-10-15", B, KHAN), "9/22: backup on his OR day needs no row");
// Prompt 12 W (9/22 evening) FLIP: before W these two read okElig + lacks("outside-window") - "a dated row opens a Friday
// outside her window". Windows never lift now; the Friday after her window stays outside-window with or without the row.
blocked(R.eligibility(lift, "2026-10-30", P, SARKAR), "outside-window", "W: a dated row does not open a Friday outside her window");
lacks(R.eligibility(lift, "2026-10-30", P, SARKAR).hard, "hard-never-weekday", "no hard-never on Fridays any more (N) - the block is the window alone");
okElig(R.eligibility(clean, "2026-10-23", P, SARKAR), "and without rows her window Friday is open (9/22 evening: a standalone Friday is her normal pattern)");
blocked(R.eligibility(clean, "2026-10-30", P, SARKAR), "outside-window", "without the row the Friday after her window stays outside-window");
eq(R.eligibility(clean, "2026-10-19", P, SARKAR).hard, [], "window Monday is still open without window rows");

step("fidelity-03: an overridden derived lock re-applies the pattern and the East week");
const ovrTue = makeCtx({ schedule: { "2026-11-10": { primary: null, backup: BURCHETT, backupLocked: true } } });
const f1110 = R.eligibility(ovrTue, "2026-11-10", P, FIERCE);
blocked(f1110, "east-busy", "Tue of his East-primary week: never Silvis primary");
has(f1110.hard, "weekday-pattern:Tue");
lacks(f1110.hard, "derived-lock");
const ovrWed = makeCtx({ schedule: { "2026-11-11": { primary: null, backup: BURCHETT, backupLocked: true } } });
blocked(R.eligibility(ovrWed, "2026-11-11", P, FIERCE), "east-busy", "Wednesday passes his pattern but he is East primary that week");
lacks(R.eligibility(ovrWed, "2026-11-11", P, FIERCE).hard, "weekday-pattern");
const ovrPri = makeCtx({ schedule: { "2026-12-07": { primary: BURCHETT, primaryLocked: true }, "2026-12-08": { primary: BURCHETT, primaryLocked: true } } });
okElig(R.eligibility(ovrPri, "2026-12-08", B, FIERCE), "East-backup week overridden: Tue backup falls back to the pattern, which allows backup since 9/22");
lacks(R.eligibility(ovrPri, "2026-12-08", B, FIERCE).hard, "east-busy", "an East BACKUP week does not block Silvis backup");
okElig(R.eligibility(ovrPri, "2026-12-07", B, FIERCE), "Mon backup is on his pattern");
blocked(R.eligibility(ovrPri, "2026-12-07", P, FIERCE), "slot-locked:s2");
okElig(R.eligibility(clean, "2026-11-10", B, FIERCE), "un-overridden derived week: lock holder, no pattern");
eq(R.eligibility(clean, "2026-11-10", B, FIERCE).lockHolder, true);

step("fidelity-04: maxMajorHolidays window = 12 calendar months between unit starts, symmetric");
const tgHeld = makeCtx({ schedule: { "2026-11-26": { primary: PHILIP }, "2026-11-27": { primary: PHILIP }, "2026-11-28": { primary: PHILIP }, "2026-11-29": { primary: PHILIP } } });
okElig(R.eligibility(tgHeld, "2027-11-25", P, PHILIP), "Thanksgiving 2026 -> Thanksgiving 2027 (364 days, 12 months): allowed");
const xmHeld = makeCtx({ schedule: { "2026-12-24": { primary: PHILIP }, "2026-12-25": { primary: PHILIP } } });
okElig(R.eligibility(xmHeld, "2027-12-24", P, PHILIP), "Christmas 2026 -> Christmas 2027 (365 days, 12 months): allowed, same as Thanksgiving");
blocked(R.eligibility(xmHeld, "2027-11-25", P, PHILIP), "max-major-holidays:1", "Christmas 2026 -> Thanksgiving 2027 is 11 months");
blocked(R.eligibility(xmHeld, "2026-12-31", P, PHILIP), "max-major-holidays:1", "Christmas -> New Year's, same month");
const tg27 = makeCtx({ schedule: { "2027-11-25": { primary: PHILIP } } });
blocked(R.eligibility(tg27, "2026-12-24", P, PHILIP), "max-major-holidays:1", "symmetric: a later held unit blocks an earlier date inside 12 months");
okElig(R.eligibility(tg27, "2026-11-26", P, PHILIP), "...but not one exactly 12 months earlier");

step("tests-03/contract-004: memoized soft entries survive caller mutation");
const m1 = R.eligibility(clean, "2026-11-02", P, KHAN);
const m1Before = JSON.stringify(m1.soft);
ok(m1.soft.length > 0);
m1.soft[0].weight = 999; m1.soft[0].reason = "corrupted";
eq(JSON.stringify(R.eligibility(clean, "2026-11-02", P, KHAN).soft), m1Before, "entry mutation does not leak into the memo");
const m2 = R.eligibility(clean, "2026-11-18", P, FIERCE);
m2.soft.forEach(s => { s.weight = 42; });
eq(R.eligibility(clean, "2026-11-18", P, FIERCE).soft, [{ reason: "preferred", weight: -1 }]);

step("tests-04: an import/manual lock holder stays eligible and reports conflicts");
const eastTg = makeCtx({ eastBusyDays: { [KHAN]: ["2026-11-13", "2026-11-14", "2026-11-15", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-12-11", "2026-12-12", "2026-12-13"] } });
const lh = R.eligibility(eastTg, "2026-11-26", P, KHAN);
okElig(lh, "locked Thanksgiving primary on an East-busy day");
eq(lh.lockHolder, true); eq(lh.hard, []); has(lh.conflicts, "east-busy");
eq(R.holidayUnitCandidates(eastTg, units[0], P), [KHAN], "the locked holder is still the unit's primary candidate");
eq(R.holidayUnitCandidates(eastTg, units[0], B), [BURCHETT, PHILIP, FIERCE]);
blocked(R.eligibility(eastTg, "2026-11-13", P, KHAN), "east-busy", "an unlocked East-busy day is still blocked");
ok(R.weekendUnitPatterns(eastTg, "2026-11-27").length === 1 && R.weekendUnitPatterns(eastTg, "2026-11-27")[0].members.fri === KHAN, "Thanksgiving weekend keeps its locked block");
const lh2 = R.eligibility(makeCtx({ schedule: { "2026-11-03": { primary: KHAN, primaryLocked: true } } }), "2026-11-03", P, KHAN);
okElig(lh2); eq(lh2.lockHolder, true); eq(lh2.conflicts, ["hard-never-weekday:Tue"], "manual lock on an OR day: kept, conflict reported");
const lh3 = R.eligibility(ctx, "2026-10-20", P, SARKAR);
eq(lh3.lockHolder, true); eq(lh3.conflicts, [], "a clean locked row has no conflicts");
eq(R.eligibility(ctx, "2026-11-26", P, KHAN).lockHolder, true);
eq(R.eligibility(clean, "2026-11-26", P, KHAN).lockHolder, undefined, "an unlocked slot carries no lockHolder flag");
blocked(R.eligibility(ctx, "2026-11-26", B, KHAN), "holds-other-role", "the lock covers one role only");

step("tests-05: role mask on availability rows");
okElig(R.eligibility(clean, "2026-11-01", P, PHILIP), "11/1 primary via his October PRIMARY row (spill-over is additive)");
okElig(R.eligibility(clean, "2026-11-01", B, PHILIP), "9/22: backup is open outside his weeks regardless of the row (row scoping is shown on Sarkar's window in fidelity-02)");
const maskCtx = withRows([row(ACTON, "unavailable", "2026-11-17", "primary"), row(BURCHETT, "unavailable", "2027-01-23", "backup")]);   // Tue 11/17 is on Acton's November backup list (T); Sat 1/23 (1/9 is Burchett's vacation since 9/22 evening)
blocked(R.eligibility(maskCtx, "2026-11-17", P, ACTON), "unavailable-row");
okElig(R.eligibility(maskCtx, "2026-11-17", B, ACTON), "a primary-only unavailable row leaves backup open");
blocked(R.eligibility(maskCtx, "2027-01-23", B, BURCHETT), "unavailable-row");
okElig(R.eligibility(maskCtx, "2027-01-23", P, BURCHETT), "a backup-only unavailable row leaves primary open");

step("tests-06: backup cap lower boundary");
const pb6 = {};
["2026-12-07", "2026-12-08", "2026-12-09", "2026-12-10", "2026-12-11", "2026-12-12"].forEach(d => { pb6[d] = { backup: PHILIP }; });
okElig(R.eligibility(makeCtx({ schedule: pb6 }), "2026-12-21", B, PHILIP), "7th backup day is within the cap");
pb6["2026-12-13"] = { backup: PHILIP };
blocked(R.eligibility(makeCtx({ schedule: pb6 }), "2026-12-21", B, PHILIP), "backup-cap:7", "the 8th is not");

/* ------------------------------------------------ 9/22: backup is open to everyone */
step("backup open to everyone (9/22)");
// Rules doc section 1 "Roles per day" and the section 3 per-surgeon 9/22 lines:
// outreach days, OR days, Clinton/Aledo days and the dated whitelists restrict
// PRIMARY only. Every date below is a real seed date.
// Khan: Tue/Thu OR days
blocked(R.eligibility(clean, "2026-11-05", P, KHAN), "hard-never-weekday:Thu", "Khan primary on his OR day stays hard");
okElig(R.eligibility(clean, "2026-11-05", B, KHAN), "Khan backup Thu 11/05");
lacks(R.eligibility(clean, "2026-11-05", B, KHAN).hard, "weekday-not-allowed", "the Mon/Wed allow-list restricts primary only");
okElig(R.eligibility(clean, "2026-11-03", B, KHAN), "Khan backup Tue 11/03");
lacksSoft(R.eligibility(clean, "2026-11-02", B, KHAN), "auto-offer-weekday", "auto-offer is a primary soft");
hasSoft(R.eligibility(clean, "2026-11-02", P, KHAN), "auto-offer-weekday", "...and still applies to primary");
// Burchett: recurring whitelist and governed months
blocked(R.eligibility(clean, "2027-01-07", P, BURCHETT), "not-recurring-available", "an ordinary Thursday is not on his recurring list (January: ungoverned; November is governed for both roles since T)");
okElig(R.eligibility(clean, "2027-01-07", B, BURCHETT), "Burchett backup Thu 1/07");
blocked(R.eligibility(clean, "2026-12-03", P, BURCHETT), "whitelist-month", "12/03 is not on his December list");
okElig(R.eligibility(clean, "2026-12-03", B, BURCHETT), "Burchett backup 12/03 inside his governed December");
// Acton: outreach Mondays/Wednesdays (hard) and his soft avoids (medium for primary, low for backup)
blocked(R.eligibility(clean, "2026-11-09", P, ACTON), "recurring-unavailable:Mon", "2nd Monday");
// Prompt 12 Y FLIP (9/22 evening): under T this read whitelist-month (11/09 off his November backup list). His list is
// preferences now; what still closes 11/09 backup to him is Fierce's derived week (the derived lock), so the open-backup
// check below keeps using the next 2nd Monday.
blocked(R.eligibility(clean, "2026-11-09", B, ACTON), "derived-lock-held:s5", "Y: 11/09 backup is inside Fierce's derived week - his derived lock, no whitelist-month any more");
lacks(R.eligibility(clean, "2026-11-09", B, ACTON).hard, "whitelist-month", "Y: ...no whitelist-month on his November backup");
blocked(R.eligibility(clean, "2026-12-14", P, ACTON), "recurring-unavailable:Mon", "2nd Monday of December");
okElig(R.eligibility(clean, "2026-12-14", B, ACTON), "Acton backup 12/14 (2nd Monday, outside any derived week)");
const tueP = R.eligibility(clean, "2027-01-12", P, ACTON), tueB = R.eligibility(clean, "2027-01-12", B, ACTON); // January: ungoverned
// Prompt 12 X FLIP (9/22 evening): before X these read weight 3 (primary) / 1 (backup) for the soft "recurring-avoid:Tue";
// the avoid is gone - Tuesday is a hard PRIMARY rule for him and backup carries no Tuesday term at all.
blocked(tueP, "hard-never-weekday:Tue", "X: Acton Tuesday primary is hard (no soft avoid left)");
okElig(tueB, "X: Acton Tuesday backup stays open"); lacksSoft(tueB, "recurring-avoid:Tue", "X: ...with no soft Tuesday term for backup");
eq((R.eligibility(clean, "2027-01-10", B, ACTON).soft.find(s => s.reason === "recurring-avoid:Sun") || {}).weight, 1, "Sunday before a 2nd Monday: low (1) for backup");
eq((R.eligibility(clean, "2027-01-10", P, ACTON).soft.find(s => s.reason === "recurring-avoid:Sun") || {}).weight, 3, "...medium (3) for primary");
// Philip: the weeks whitelist, the Aledo week (soft) and day-before-Aledo (hard) are primary rules
blocked(R.eligibility(clean, "2026-11-04", P, PHILIP), "outside-available-weeks", "Wed 11/04 is outside his weeks");
okElig(R.eligibility(clean, "2026-11-04", B, PHILIP), "Philip backup 11/04 outside his weeks");
const alP = R.eligibility(clean, "2026-11-17", P, PHILIP), alB = R.eligibility(clean, "2026-11-17", B, PHILIP); // Tue before the 3rd Wed, Aledo week of 11/16
hasSoft(alP, "aledo-week", "aledo-week soft for primary");
lacksSoft(alB, "aledo-week", "no aledo-week soft for backup");
blocked(alP, "day-before-aledo");
okElig(alB, "Philip backup the day before an Aledo day (aledoDayBeforeRoles stays [primary])");
// Fierce: the seed pattern opens Tue/Thu/Fri/Sat/Sun backup; primary is unchanged
blocked(R.eligibility(clean, "2026-11-03", P, FIERCE), "weekday-pattern:Tue", "Clinton Tuesday primary");
okElig(R.eligibility(clean, "2026-11-03", B, FIERCE), "Fierce backup Tue 11/03");
okElig(R.eligibility(clean, "2026-11-05", B, FIERCE), "Fierce backup Thu 11/05");
blocked(R.eligibility(clean, "2026-11-06", P, FIERCE), "weekend-block-only", "a standalone Friday primary stays block-only");
okElig(R.eligibility(clean, "2026-11-06", B, FIERCE), "Fierce standalone Friday backup (no asBlockMember)");
okElig(R.eligibility(clean, "2026-11-07", B, FIERCE), "Fierce standalone Saturday backup");
blocked(R.eligibility(clean, "2026-11-02", P, FIERCE), "weekday-pattern:Mon", "Monday primary unchanged");
okElig(R.eligibility(clean, "2026-11-02", B, FIERCE), "Monday backup unchanged");
// Sarkar: backup inside her windows only; since 9/22 evening she has no Fri/Sun rule at all (windows are Mon-Fri)
okElig(R.eligibility(clean, "2026-11-17", B, SARKAR), "Sarkar backup 11/17 inside the Nov 16-20 window");
blocked(R.eligibility(clean, "2026-11-25", B, SARKAR), "outside-window", "Sarkar backup 11/25 outside her window");
okElig(R.eligibility(clean, "2026-11-20", P, SARKAR), "a window Friday primary is open (9/22 evening)");
okElig(R.eligibility(clean, "2026-11-20", B, SARKAR), "a window Friday backup is open");
// hardNeverWeekdaysRoles: explicit in the seed (Khan), engine default [primary] when absent, listing both roles still closes backup.
// Sarkar's hardNeverWeekdays keys are gone since 9/22 evening (item N) - the synthetic hardNever below keeps the
// absent-roles-key behaviour pinned on her too.
eq(seed.surgeonRules[KHAN].hardNeverWeekdaysRoles, ["primary"], "seed: Khan's roles list is explicit");
ok(!("hardNeverWeekdaysRoles" in seed.surgeonRules[SARKAR]), "seed: Sarkar carries no hardNeverWeekdaysRoles (no hardNeverWeekdays either)");
const srNoRoles = clone(seed.surgeonRules); delete srNoRoles[KHAN].hardNeverWeekdaysRoles; srNoRoles[SARKAR].hardNeverWeekdays = ["Fri"];
const noRoles = makeCtx({ schedule: {}, surgeonRules: srNoRoles });
blocked(R.eligibility(noRoles, "2026-11-05", P, KHAN), "hard-never-weekday:Thu", "absent roles key: primary still blocked");
okElig(R.eligibility(noRoles, "2026-11-05", B, KHAN), "absent roles key: the engine default is [primary]");
blocked(R.eligibility(noRoles, "2026-11-20", P, SARKAR), "hard-never-weekday:Fri", "a synthetic hardNeverWeekdays [Fri] on Sarkar still blocks her window Friday primary (generic rule, data-driven)");
okElig(R.eligibility(noRoles, "2026-11-20", B, SARKAR), "absent roles key (Sarkar, synthetic hardNever): a window Friday backup is open");
const srBoth = clone(seed.surgeonRules); srBoth[KHAN].hardNeverWeekdaysRoles = ["primary", "backup"];
blocked(R.eligibility(makeCtx({ schedule: {}, surgeonRules: srBoth }), "2026-11-05", B, KHAN), "hard-never-weekday:Thu", "listing both roles still closes backup");

step("still blocks backup (9/22 pins)");
blocked(R.eligibility(ctx, "2026-11-20", B, ACTON), "time-off:2026-11-20");
blocked(R.eligibility(ctx, "2026-11-26", B, ACTON), "holiday-opt-out:Thanksgiving");
blocked(R.eligibility(ctx, "2026-11-26", B, KHAN), "holds-other-role", "locked Thanksgiving primary");
blocked(R.eligibility(clean, "2026-12-09", B, FIERCE), "derived-lock:primary");
blocked(R.eligibility(clean, "2026-11-11", B, PHILIP), "derived-lock-held:s5");
blocked(R.eligibility(clean, "2026-11-11", B, BURCHETT), "whitelist-month", "T: Burchett 11/11 backup is off his November list");
blocked(R.eligibility(ctx, "2026-09-30", B, BURCHETT), "slot-locked:s5");
blocked(R.eligibility(clean, "2026-10-18", B, BURCHETT), "unavailable-row");
blocked(R.eligibility(clean, "2026-10-23", B, PHILIP), "no-backup-row");
const pbCap = {};
["2026-12-07", "2026-12-08", "2026-12-09", "2026-12-10", "2026-12-11", "2026-12-12", "2026-12-13"].forEach(d => { pbCap[d] = { backup: PHILIP }; });
blocked(R.eligibility(makeCtx({ schedule: pbCap }), "2026-12-21", B, PHILIP), "backup-cap:7");
blocked(R.eligibility(makeCtx({ schedule: { "2026-12-12": { backup: PHILIP } } }), "2026-12-26", B, PHILIP), "backup-weekend-cap:1");
const eastThu = makeCtx({ schedule: {}, eastBusyDays: { [KHAN]: ["2026-11-05"] } });
blocked(R.eligibility(eastThu, "2026-11-05", P, KHAN), "east-busy");
okElig(R.eligibility(eastThu, "2026-11-05", B, KHAN), "Khan backup on an East-busy Thursday: East never blocks backup (eastBlocksBackup false)");

step("backup opt-out (9/22)");
ok(ctx.activeIds.every(id => seed.surgeonRules[id].backupOptOut === false), "seed: every surgeon carries backupOptOut:false - nobody has opted out");
const srOpt = clone(seed.surgeonRules); srOpt[BURCHETT].backupOptOut = true; srOpt[KHAN].backupOptOut = true;
const opt = makeCtx({ surgeonRules: srOpt }); // seed schedule: Thanksgiving locked to Khan
blocked(R.eligibility(opt, "2026-11-05", B, BURCHETT), "backup-opt-out", "ordinary Thursday");
blocked(R.eligibility(opt, "2026-11-26", B, BURCHETT), "backup-opt-out", "holiday-unit day: never waived");
blocked(R.eligibility(opt, "2026-12-09", B, BURCHETT), "backup-opt-out", "a day on his own December list does not lift it");
okElig(R.eligibility(opt, "2026-12-14", P, BURCHETT), "primary unaffected (listed December Monday outside Fierce's derived week)");
okElig(R.eligibility(opt, "2026-12-01", P, BURCHETT), "primary unaffected (1st Tuesday, listed)");
blocked(R.eligibility(opt, "2026-12-02", B, KHAN), "backup-opt-out", "Khan on a Wednesday");
okElig(R.eligibility(opt, "2026-12-02", P, KHAN), "Khan primary Wednesday unaffected (12/2: 11/4 is Acton's locked primary since T)");
blocked(R.eligibility(withRows([row(BURCHETT, "available", "2026-11-05", "backup")], { surgeonRules: srOpt }), "2026-11-05", B, BURCHETT), "backup-opt-out", "an explicit available row does not lift it");
eq(R.holidayUnitCandidates(opt, units[0], B), [PHILIP, FIERCE], "opted out: no longer a Thanksgiving backup candidate");
const lockedOpt = R.buildContext(SA.seedToContextInput(seed, { schedule: { "2026-11-05": { backup: BURCHETT, backupLocked: true } }, surgeonRules: srOpt, eastDerived: DERIVED, eastFeedCoverage: EAST_COVER }));
const lo = R.eligibility(lockedOpt, "2026-11-05", B, BURCHETT);
ok(lo.ok && lo.lockHolder === true, "a manual lock is a fact: the holder stays ok...");
has(lo.conflicts, "backup-opt-out", "...with the opt-out reported as a conflict");

step("9/22 review fixes: empty roles list, backupPolicy switch, Sarkar backup not targeted");
// An empty hardNeverWeekdaysRoles list (one click too many in Setup) reads as the
// default [primary], never as "no role" - otherwise Khan's OR days would silently
// stop blocking primary too.
const srEmpty = clone(seed.surgeonRules); srEmpty[KHAN].hardNeverWeekdaysRoles = []; srEmpty[SARKAR].hardNeverWeekdays = ["Fri"]; srEmpty[SARKAR].hardNeverWeekdaysRoles = [];
const emptyRoles = makeCtx({ schedule: {}, surgeonRules: srEmpty });
blocked(R.eligibility(emptyRoles, "2026-11-05", P, KHAN), "hard-never-weekday:Thu", "empty roles list: primary still blocked (reads as the default)");
okElig(R.eligibility(emptyRoles, "2026-11-05", B, KHAN), "empty roles list: backup open (reads as the default)");
blocked(R.eligibility(emptyRoles, "2026-11-20", P, SARKAR), "hard-never-weekday:Fri", "empty roles list (Sarkar with a synthetic hardNever Fri): a window Friday primary still blocked");
// groupRules.backupPolicy.openToEveryone is the data switch for the 9/22 doctrine
// (CLAUDE.md: every rule is data). true (the seed, and the default when the key is
// absent) = backup open to everyone; false restores the pre-9/22 reading in which
// the weekday-pattern family, the dated whitelists, the Aledo week and the
// hardNeverWeekdays default govern BOTH roles. Explicit per-surgeon data
// (hardNeverWeekdaysRoles, backupOptOut) is honoured either way.
eq(seed.groupRules.backupPolicy.openToEveryone, true, "seed: backupPolicy.openToEveryone is true");
const grClosed = clone(seed.groupRules); grClosed.backupPolicy.openToEveryone = false;
const closed = makeCtx({ schedule: {}, groupRules: grClosed, surgeonRules: srNoRoles });
blocked(R.eligibility(closed, "2026-11-05", B, KHAN), "hard-never-weekday:Thu", "closed policy: the hardNeverWeekdaysRoles default is both roles again");
blocked(R.eligibility(closed, "2027-01-07", B, BURCHETT), "not-recurring-available", "closed policy: recurring whitelist governs backup (January: ungoverned)");
blocked(R.eligibility(closed, "2026-12-03", B, BURCHETT), "whitelist-month", "closed policy: governed December governs backup");
blocked(R.eligibility(closed, "2026-12-14", B, ACTON), "recurring-unavailable:Mon", "closed policy: outreach Monday blocks backup");
// Prompt 12 X FLIP (9/22 evening): this pin used Acton's Tuesday avoid on 11/10 backup; that avoid is now the hard primary rule,
// so the same closed-policy weight check reads his remaining soft avoid (the Sunday before a 2nd Monday, 1/10/2027).
eq((R.eligibility(closed, "2027-01-10", B, ACTON).soft.find(s => s.reason === "recurring-avoid:Sun") || {}).weight, 3, "closed policy: recurring-avoid weighs medium for backup too");
blocked(R.eligibility(closed, "2026-11-04", B, PHILIP), "outside-available-weeks", "closed policy: weeks whitelist governs backup");
hasSoft(R.eligibility(closed, "2026-11-17", B, PHILIP), "aledo-week", "closed policy: aledo-week soft applies to backup");
hasSoft(R.eligibility(closed, "2026-11-02", B, KHAN), "auto-offer-weekday", "closed policy: auto-offer applies to backup");
okElig(R.eligibility(closed, "2026-11-02", P, KHAN), "closed policy: primary unchanged (Monday auto-offer)");
const grAbsent = clone(seed.groupRules); delete grAbsent.backupPolicy;
okElig(R.eligibility(makeCtx({ schedule: {}, groupRules: grAbsent, surgeonRules: srNoRoles }), "2026-11-05", B, KHAN), "absent backupPolicy key: open is the default");
const srOptClosed = clone(srNoRoles); srOptClosed[BURCHETT].backupOptOut = true;
blocked(R.eligibility(makeCtx({ schedule: {}, groupRules: grClosed, surgeonRules: srOptClosed }), "2026-12-01", B, BURCHETT), "backup-opt-out", "closed policy: the opt-out is independent of the switch");
// Sarkar (rules doc section 3, 9/22 evening; Prompt 12 item N): backup inside a window is
// allowed but never targeted - the window-week target bonus is a PRIMARY soft, so
// opening her window Fridays for backup (item I) must not reward a Friday backup.
hasSoft(R.eligibility(clean, "2026-11-16", P, SARKAR), "window-week-below-target", "window Monday primary: below-target bonus");
lacksSoft(R.eligibility(clean, "2026-11-20", B, SARKAR), "window-week-below-target", "window Friday BACKUP carries no below-target bonus");
lacksSoft(R.eligibility(clean, "2026-11-17", B, SARKAR), "window-week-below-target", "window Tuesday BACKUP carries no below-target bonus");
okElig(R.eligibility(clean, "2026-11-20", B, SARKAR), "...and stays eligible (allowed, not targeted)");

step("tests-08: soft penalties that feed the score");
const wkHeld = makeCtx({ schedule: { "2026-11-06": { primary: KHAN }, "2026-11-07": { primary: KHAN }, "2026-11-08": { primary: KHAN } } });
eq(R.eligibility(wkHeld, "2026-11-13", P, KHAN).soft, [{ reason: "back-to-back-weekend", weight: 3 }, { reason: "pattern-mismatch:block", weight: 3 }], "Friday after a full weekend");
eq(R.eligibility(clean, "2026-11-14", P, KHAN).soft, [{ reason: "pattern-mismatch:block", weight: 3 }], "lone Saturday for a block-style surgeon");
eq(R.eligibility(clean, "2026-11-14", P, KHAN, { skipPatternSoft: true }).soft, [], "skipPatternSoft drops the mismatch");
eq(R.eligibility(wkHeld, "2026-11-07", P, KHAN).soft, [], "Saturday inside the held block: no mismatch, no b2b");
eq(R.eligibility(wkHeld, "2026-11-14", P, KHAN).soft, [{ reason: "back-to-back-weekend", weight: 3 }, { reason: "pattern-mismatch:block", weight: 3 }], "lone Saturday the weekend after the held block: both");
eq(R.eligibility(clean, "2027-01-23", P, BURCHETT).soft, [], "split-style surgeon on a lone Saturday: no mismatch (1/23: January is ungoverned)");
eq(R.eligibility(clean, "2027-01-22", P, BURCHETT).soft, [], "split-style on Friday with Saturday free: no mismatch");
eq(R.eligibility(makeCtx({ schedule: { "2027-01-23": { primary: BURCHETT } } }), "2027-01-22", P, BURCHETT).soft, [{ reason: "pattern-mismatch:split", weight: 3 }], "split-style holding Sat and asking for Fri: mismatch");
const srTarget = clone(seed.surgeonRules); srTarget[ACTON].monthlyTarget = 2;
const under = R.eligibility(makeCtx({ schedule: {}, surgeonRules: srTarget }), "2026-11-16", P, ACTON);
eq(under.soft.filter(s => s.reason.indexOf("target") >= 0), [{ reason: "under-target", weight: -1 }]);
const over1 = R.eligibility(makeCtx({ schedule: { "2026-11-04": { primary: ACTON }, "2026-11-16": { primary: ACTON } }, surgeonRules: srTarget }), "2026-11-06", P, ACTON); // 11/6: on his November list (governed since T)
eq(over1.soft.filter(s => s.reason.indexOf("target") >= 0), [{ reason: "over-target:1", weight: 1 }], "low * 1 over");
const over2 = R.eligibility(makeCtx({ schedule: { "2026-11-04": { primary: ACTON }, "2026-11-16": { primary: ACTON }, "2026-11-12": { primary: ACTON } }, surgeonRules: srTarget }), "2026-11-06", P, ACTON);
eq(over2.soft.filter(s => s.reason.indexOf("target") >= 0), [{ reason: "over-target:2", weight: 2 }], "low * 2 over");
eq(R.eligibility(makeCtx({ schedule: { "2026-11-04": { primary: ACTON } }, surgeonRules: srTarget }), "2026-11-16", P, ACTON).soft.filter(s => s.reason.indexOf("target") >= 0), [], "exactly on target: nothing");
eq(R.eligibility(clean, "2026-11-16", P, ACTON).soft.filter(s => s.reason.indexOf("target") >= 0), [], "monthlyTarget null: nothing");
const ap = withRows([row(ACTON, "avoid", "2026-11-16"), row(ACTON, "prefer", "2026-11-17"), row(BURCHETT, "avoid", "2026-11-09", "any", "strong"), row(BURCHETT, "prefer", "2026-11-23", "any", -4)]);
eq(R.eligibility(ap, "2026-11-16", P, ACTON).soft.filter(s => s.reason === "avoid-row"), [{ reason: "avoid-row", weight: 3 }], "avoid defaults to medium");
eq(R.eligibility(ap, "2026-11-17", P, ACTON).soft.filter(s => s.reason === "prefer-row"), [{ reason: "prefer-row", weight: -1 }], "prefer defaults to weights.preferred");
eq(R.eligibility(ap, "2026-11-09", P, BURCHETT).soft.filter(s => s.reason === "avoid-row"), [{ reason: "avoid-row", weight: 10 }], "string weights resolve through the table");
eq(R.eligibility(ap, "2026-11-23", P, BURCHETT).soft.filter(s => s.reason === "prefer-row"), [{ reason: "prefer-row", weight: -4 }], "numeric prefer weight");
const srNoHard = clone(seed.surgeonRules); srNoHard[KHAN].hardNeverWeekdays = [];
const nh = makeCtx({ schedule: {}, surgeonRules: srNoHard });
blocked(R.eligibility(nh, "2026-11-03", P, KHAN), "weekday-not-allowed:Tue", "without hardNever the allow-list itself blocks Tuesday");
okElig(R.eligibility(nh, "2026-11-05", B, KHAN), "9/22: the allow-list restricts primary only");
okElig(R.eligibility(nh, "2026-11-04", P, KHAN));
okElig(R.eligibility(nh, "2026-11-07", P, KHAN), "weekend days are pool days, not on the allow-list");
okElig(R.eligibility(withRows([row(KHAN, "available", "2026-11-03")], { surgeonRules: srNoHard }), "2026-11-03", P, KHAN), "a dated row lifts weekday-not-allowed");
blocked(R.eligibility(withRows([row(KHAN, "available", "2026-11-03", "backup")], { surgeonRules: srNoHard }), "2026-11-03", P, KHAN), "weekday-not-allowed:Tue", "but only for its own role");

step("tests-09: weekend pattern penalty arithmetic and shape dedupe");
const penOf = (kind, f, s, u) => { const p = wp.find(q => q.kind === kind && q.members.fri === f && q.members.sat === s && q.members.sun === u); return p ? p.penalty : null; };
// 9/22 (Prompt 12 L): Khan's primaryContribution "weekends" makes his full PRIMARY block the unit-level bonus
// -weights.weekendContribution (3); Fierce (block style, no contribution key) stays at 0.
eq(penOf("block", KHAN, KHAN, KHAN), -3, "block-style surgeon with primaryContribution weekends in a full primary block: -weekendContribution");
eq(penOf("block", FIERCE, FIERCE, FIERCE), 0, "block-style surgeon without the key in a block");
eq(penOf("block", BURCHETT, BURCHETT, BURCHETT), null, "Burchett cannot block: max consecutive 2");
eq(penOf("split", BURCHETT, ACTON, BURCHETT), 0, "the designed split pair");
eq(penOf("split", ACTON, BURCHETT, ACTON), 3, "the mirror split costs Acton's recurring-avoid on Sunday 1/24 (before the 4th Monday)");
eq(R.weekendUnitPatterns(clean, "2027-01-29").find(q => q.kind === "split" && q.members.fri === ACTON && q.members.sat === BURCHETT).penalty, 0, "on a weekend without that Sunday (1/31) the mirror split is free");
eq(penOf("split", KHAN, BURCHETT, KHAN), 3, "block-style X in a split: one mismatch");
eq(penOf("split", KHAN, ACTON, KHAN), 3);
eq(penOf("split", BURCHETT, KHAN, BURCHETT), 3, "block-style Y on the Saturday: one mismatch");
ok(dailies.every(p => !(p.members.fri === p.members.sun && p.members.fri !== p.members.sat)), "split shapes are not repeated as daily");
eq(Math.min.apply(null, dailies.map(p => p.penalty)), 11, "cheapest daily = patternDaily 5 + Khan Fri mismatch 3 + Burchett Sun mismatch 3");
eq(penOf("daily", KHAN, BURCHETT, BURCHETT), 11);
const softSum = r => r.soft.reduce((a, s) => a + s.weight, 0);
const expectKBA = 5
  + softSum(R.eligibility(clean, "2027-01-22", P, KHAN, { skipPatternSoft: true })) + 3
  + softSum(R.eligibility(clean, "2027-01-23", P, BURCHETT, { skipPatternSoft: true })) + 0
  + softSum(R.eligibility(clean, "2027-01-24", P, ACTON, { skipPatternSoft: true })) + 3;
eq(penOf("daily", KHAN, BURCHETT, ACTON), expectKBA, "daily penalty = patternDaily + per-member mismatch + soft sums");
eq(expectKBA, 14, "Acton's Sunday-before-4th-Monday avoid (3) is inside it");
const wpD = R.buildContext(SA.seedToContextInput(seed, { schedule: {}, eastDerived: DERIVED, eastFeedCoverage: EAST_COVER, groupRules: Object.assign(clone(seed.groupRules), { weights: Object.assign({}, seed.groupRules.weights, { patternDaily: 9 }) }) }));
eq(Math.min.apply(null, R.weekendUnitPatterns(wpD, "2027-01-22").filter(p => p.kind === "daily").map(p => p.penalty)), 15, "patternDaily weight is read from groupRules.weights");

step("contract-002: East feed shapes are validated, never silently dropped");
const EF = require("../east-feed.js");
const rawRows = EF.deriveFierceWeeks([{ weekMonday: "2026-11-09", data: { isBackup: true } }], { deriveFrom: "2026-11-02", statedWeeks: { eastBackup: ["2026-12-07"] } });
eq(rawRows.map(r => r.silvisRole), ["backup", "primary"]);
ok(rawRows.every(r => !r.surgeonId), "deriveFierceWeeks rows carry no surgeonId");
const rawCtx = makeCtx({ schedule: {}, eastDerived: rawRows });
eq(rawCtx.warnings.length, 2, "one warning per dropped row: " + JSON.stringify(rawCtx.warnings));
ok(rawCtx.warnings.every(w => w.indexOf("surgeonId") >= 0));
eq(Object.keys(rawCtx.derivedByDay).length, 0);
const nfId = seed.roster.find(x => x.code === "NF").id;
const fixedCtx = makeCtx({ schedule: {}, eastDerived: rawRows.map(r => Object.assign({}, r, { surgeonId: nfId })) });
eq(fixedCtx.warnings, []);
blocked(R.eligibility(fixedCtx, "2026-11-11", P, FIERCE), "derived-lock:backup", "with surgeonId attached the derivation works");
blocked(R.eligibility(fixedCtx, "2026-12-09", B, FIERCE), "derived-lock:primary");
eq(makeCtx({ schedule: {}, eastDerived: [{ surgeonId: "s9", weekMonday: "2026-11-09", silvisRole: "backup" }] }).warnings.length, 1, "unknown surgeonId warns");
eq(clean.warnings, [], "the normal fixtures produce no warnings");
const kb = { busy: new Set(["2026-11-02"]), reasons: { "2026-11-02": ["service-week"] } };
const kbCtx = makeCtx({ schedule: {}, eastBusyDays: { [KHAN]: kb } });
eq(kbCtx.warnings, []);
blocked(R.eligibility(kbCtx, "2026-11-02", P, KHAN), "east-busy", "deriveKhanBusyDays' { busy, reasons } object is accepted as-is");
okElig(R.eligibility(kbCtx, "2026-11-04", P, KHAN));
const badCtx = makeCtx({ schedule: {}, eastBusyDays: { [KHAN]: { foo: true, "2026-11-02": true } } });
eq(badCtx.warnings.length, 1, "non-date keys warn: " + JSON.stringify(badCtx.warnings));
blocked(R.eligibility(badCtx, "2026-11-02", P, KHAN), "east-busy", "the date keys still count");

/* ------------------------------------------------ Prompt 12 L (9/22): Khan = weekend primary when available */
step("L: primaryContribution weekends - per-day softs in eligibility");
// surgeonRules.<id>.primaryContribution === "weekends" (data; Khan in the seed, any surgeon in Setup) with
// groupRules.weights.weekendContribution (3 = medium): a Fri/Sat/Sun PRIMARY evaluated as a member of a full
// Fri+Sat+Sun block (opts.asBlockMember) earns the soft 'weekend-primary' at -weekendContribution per day, so
// repair and smoothing keep the block whole; a Fri/Sat/Sun BACKUP costs the soft 'weekend-backup' at
// +weekendContribution per day (single-day fills and repair keep him off weekend backup). Both are skipped under
// skipPatternSoft: weekendUnitPatterns adds ONE unit-level term of its own instead (next step) - never both.
eq(seed.surgeonRules[KHAN].primaryContribution, "weekends", "seed: Khan primaryContribution = weekends");
eq(seed.groupRules.weights.weekendContribution, 3, "seed: groupRules.weights.weekendContribution = 3 (medium)");
eq(clean.weights.weekendContribution, 3, "ctx.weights carries weekendContribution");
const WC = clean.weights.weekendContribution;
const WK1 = ["2026-11-06", "2026-11-07", "2026-11-08"];
const asBlock = (d, trio) => ({ asBlockMember: true, assume: trio.filter(x => x !== d).map(x => ({ date: x, role: P })) });
const softOf = (r, reason) => r.soft.filter(s => s.reason === reason);
WK1.forEach(d => eq(softOf(R.eligibility(clean, d, P, KHAN, asBlock(d, WK1)), "weekend-primary"), [{ reason: "weekend-primary", weight: -WC }], "Khan primary as a full-block member on " + d + ": weekend-primary -" + WC));
lacksSoft(R.eligibility(clean, "2026-11-07", P, KHAN), "weekend-primary", "a lone Saturday primary (no asBlockMember) earns no bonus");
lacksSoft(R.eligibility(clean, "2026-11-06", P, KHAN, { assume: [{ date: "2026-11-08", role: P }] }), "weekend-primary", "Fri+Sun without the block flag earns no bonus");
lacksSoft(R.eligibility(clean, "2026-11-04", P, KHAN, { asBlockMember: true }), "weekend-primary", "a weekday is never a weekend block member");
lacksSoft(R.eligibility(clean, "2026-11-06", P, KHAN, Object.assign(asBlock("2026-11-06", WK1), { skipPatternSoft: true })), "weekend-primary", "skipPatternSoft drops weekend-primary (weekendUnitPatterns adds the unit-level term)");
WK1.forEach(d => eq(softOf(R.eligibility(clean, d, B, KHAN), "weekend-backup"), [{ reason: "weekend-backup", weight: WC }], "Khan backup on " + d + ": weekend-backup +" + WC));
okElig(R.eligibility(clean, "2026-11-07", B, KHAN), "weekend backup stays ELIGIBLE - the term is soft");
lacksSoft(R.eligibility(clean, "2026-11-03", B, KHAN), "weekend-backup", "a Tuesday backup carries no weekend-backup");
lacksSoft(R.eligibility(clean, "2026-11-06", B, KHAN, { skipPatternSoft: true }), "weekend-backup", "skipPatternSoft drops weekend-backup");
lacksSoft(R.eligibility(clean, "2026-11-06", P, KHAN, asBlock("2026-11-06", WK1)), "weekend-backup", "a primary never carries weekend-backup");
// Holiday units are NOT weekend units (review 9/22, fix stage): the per-day view must equal the unit view, where
// weekendUnitPatterns never sees a holiday-unit day (the generator's present = the non-holiday days) and 'full'
// means three present days. So: no weekend-backup on a holiday-unit day (genFillHoliday ranks by soft sums and
// "anyone can be on backup for holidays"); no weekend-primary when any of the weekend's Fri/Sat/Sun is a
// holiday-unit day (a reduced weekend is never a full block, whatever genHoldsFullBlock says); a non-holiday day of
// a reduced weekend still carries weekend-backup (the enumerator charges its backup term on reduced patterns too).
const xmasB = R.eligibility(clean, "2026-12-25", B, KHAN);
okElig(xmasB, "Khan backup on Christmas Day (a holiday-unit Friday) is eligible");
lacksSoft(xmasB, "weekend-backup", "...and carries no weekend-backup: holiday units are not weekend units");
lacksSoft(R.eligibility(clean, "2027-01-01", B, KHAN), "weekend-backup", "New Year's Day (unit Friday): no weekend-backup");
lacksSoft(R.eligibility(clean, "2026-11-27", B, KHAN), "weekend-backup", "Thanksgiving Friday (unit day): no weekend-backup");
const WKX = ["2026-12-25", "2026-12-26", "2026-12-27"];
const xmasSat = R.eligibility(clean, "2026-12-26", P, KHAN, asBlock("2026-12-26", WKX));
okElig(xmasSat, "Khan primary Sat 12/26 as a block member is eligible");
lacksSoft(xmasSat, "weekend-primary", "...but earns no weekend-primary: the Friday is Christmas, the weekend is reduced (unit view: full blocks only)");
lacksSoft(R.eligibility(clean, "2026-12-27", P, KHAN, asBlock("2026-12-27", WKX)), "weekend-primary", "Sun 12/27 likewise");
const TGF = ["2026-11-27", "2026-11-28", "2026-11-29"];
lacksSoft(R.eligibility(clean, "2026-11-28", P, KHAN, asBlock("2026-11-28", TGF)), "weekend-primary", "Thanksgiving Saturday as a 'block member' (genHoldsFullBlock ignores unit pre-emption): no bonus on a holiday-unit weekend");
hasSoft(R.eligibility(clean, "2026-12-26", B, KHAN), "weekend-backup", "Sat 12/26 is not a holiday day: backup there is still discouraged (reduced-weekend backup patterns carry the term too)");
eq(R.weekendUnitPatterns(clean, "2026-12-25", "primary", ["2026-12-26", "2026-12-27"]).find(q => q.kind === "block" && q.members.sat === KHAN).penalty, 0, "the unit view agrees: Khan's reduced Sat+Sun block after Christmas earns nothing");
ok(R.weekendUnitPatterns(clean, "2026-12-25", "backup", ["2026-12-26", "2026-12-27"]).filter(p => p.surgeons.indexOf(KHAN) >= 0).every(p => p.penalty >= WC), "...and every reduced backup pattern with him costs at least +" + WC);
// the East busy ctx: backup on an East day is allowed AND still carries the weekend-backup soft (it is a weekend day)
hasSoft(R.eligibility(busy, "2026-11-07", B, KHAN), "weekend-backup", "backup on an East-busy Saturday: allowed, still discouraged");
// nobody else carries the key: Philip (block style too) gets neither term
lacksSoft(R.eligibility(clean, "2026-11-06", P, PHILIP, asBlock("2026-11-06", WK1)), "weekend-primary", "Philip: no primaryContribution, no bonus");
lacksSoft(R.eligibility(clean, "2026-11-07", B, PHILIP), "weekend-backup", "Philip: no primaryContribution, no penalty");
// generic and data-driven: the key on another surgeon, a different weight, the engine default, and 0 = off
const srWC = clone(SA.seedToSurgeonRules(seed)); srWC[PHILIP].primaryContribution = "weekends"; delete srWC[KHAN].primaryContribution;
const grWC = Object.assign(clone(seed.groupRules), { weights: Object.assign({}, seed.groupRules.weights, { weekendContribution: 5 }) });
const wcCtx = makeCtx({ schedule: {}, surgeonRules: srWC, groupRules: grWC });
eq(softOf(R.eligibility(wcCtx, "2026-11-07", B, PHILIP), "weekend-backup"), [{ reason: "weekend-backup", weight: 5 }], "the key on Philip with weights.weekendContribution 5");
const WK2 = ["2026-11-13", "2026-11-14", "2026-11-15"]; // the weekend of Philip's listed week 11/09 (11/06 is outside his weeks: hard, no softs at all)
eq(softOf(R.eligibility(wcCtx, "2026-11-14", P, PHILIP, asBlock("2026-11-14", WK2)), "weekend-primary"), [{ reason: "weekend-primary", weight: -5 }], "...and his full block earns -5 (on his listed week)");
blocked(R.eligibility(wcCtx, "2026-11-07", P, PHILIP, asBlock("2026-11-07", WK1)), "outside-available-weeks", "the bonus never opens a weekend his hard rules close");
lacksSoft(R.eligibility(wcCtx, "2026-11-07", B, KHAN), "weekend-backup", "Khan without the key: nothing");
lacksSoft(R.eligibility(wcCtx, "2026-11-07", P, KHAN, asBlock("2026-11-07", WK1)), "weekend-primary", "Khan without the key: no bonus");
const grNoWC = clone(seed.groupRules); delete grNoWC.weights.weekendContribution;
eq(makeCtx({ schedule: {}, groupRules: grNoWC }).weights.weekendContribution, 3, "an older blob without weights.weekendContribution reads the engine default 3");
const grOffWC = Object.assign(clone(seed.groupRules), { weights: Object.assign({}, seed.groupRules.weights, { weekendContribution: 0 }) });
const offCtx = makeCtx({ schedule: {}, groupRules: grOffWC });
lacksSoft(R.eligibility(offCtx, "2026-11-07", B, KHAN), "weekend-backup", "weekendContribution 0 switches the feature off (backup)");
lacksSoft(R.eligibility(offCtx, "2026-11-07", P, KHAN, asBlock("2026-11-07", WK1)), "weekend-primary", "weekendContribution 0 switches the feature off (primary)");
eq(R.weekendUnitPatterns(offCtx, "2026-11-06").find(q => q.kind === "block" && q.members.fri === KHAN).penalty, 0, "weekendContribution 0: his block is back at 0");

step("L: weekendUnitPatterns - the unit-level weekend contribution (no double count)");
// Inside weekendUnitPatterns every member is evaluated with skipPatternSoft, so the per-day softs above are OFF and
// exactly one unit-level term applies: role primary -> a FULL block held by a contribution surgeon gets
// -weekendContribution once; role backup -> every membership of a contribution surgeon (block, split X or Y,
// daily) gets +weekendContribution once per surgeon. Reduced blocks, splits and daily days earn no primary bonus.
ok(wp[0].kind === "block" && wp[0].members.fri === KHAN && wp[0].penalty === -WC, "the cheapest 11/06 primary pattern is Khan's full block at -" + WC + ": " + JSON.stringify(wp[0]));
eq(penOf("split", KHAN, BURCHETT, KHAN), 3, "primary split with Khan as X: only the style mismatch, no bonus (not a full block)");
eq(penOf("daily", KHAN, BURCHETT, BURCHETT), 11, "primary daily with Khan on Friday: unchanged (patternDaily 5 + mismatch 3 + Burchett Sun mismatch 3)");
eq(wpR.find(q => q.kind === "block" && q.members.sat === KHAN && q.members.sun === KHAN).penalty, 0, "a reduced Sat+Sun block (Friday pre-empted) earns no bonus - full blocks only");
// backup enumeration on 12/04-06 (11/13-15 is inside Fierce's derived Silvis-backup week: locked, no backup patterns)
const wpKB = R.weekendUnitPatterns(clean, "2026-12-04", "backup");
const penB = (kind, f, s, u) => { const p = wpKB.find(q => q.kind === kind && q.members.fri === f && q.members.sat === s && q.members.sun === u); return p ? p.penalty : null; };
eq(penB("block", KHAN, KHAN, KHAN), WC, "Khan as the weekend BACKUP block: +" + WC + " exactly once (not +" + 3 * WC + " - no per-day double count)");
eq(penB("split", KHAN, BURCHETT, KHAN), 3 + WC, "Khan as X of a backup split: style mismatch 3 + weekend contribution " + WC);
eq(penB("split", BURCHETT, KHAN, BURCHETT), 3 + WC, "Khan as the Saturday of a backup split: 3 + " + WC);
eq(penB("split", ACTON, BURCHETT, ACTON), 0, "the Acton/Burchett backup split stays free");
ok(wpKB.filter(p => p.surgeons.indexOf(KHAN) >= 0).every(p => p.penalty >= WC), "every backup pattern that includes Khan costs at least +" + WC);
ok(wpKB.filter(p => p.kind === "daily" && p.surgeons.indexOf(KHAN) >= 0).every(p => p.penalty >= 5 + 3 + WC), "a daily backup pattern with Khan: patternDaily + his style mismatch + the contribution");
ok(wpKB[0].surgeons.indexOf(KHAN) < 0 && wpKB[0].penalty === 0, "the cheapest backup pattern excludes Khan: " + JSON.stringify(wpKB[0]));
// the same terms for Philip once the key moves to him (generic rule)
const wpPh = R.weekendUnitPatterns(wcCtx, "2026-11-13");
eq(wpPh.find(q => q.kind === "block" && q.members.fri === PHILIP).penalty, -5, "Philip's full primary block at -5 with the key on him (the weekend of his listed week 11/09)");
eq(wpPh.find(q => q.kind === "block" && q.members.fri === KHAN).penalty, 0, "Khan's block back at 0 without the key");
ok(R.weekendUnitPatterns(wcCtx, "2026-11-13", "backup").filter(p => p.surgeons.indexOf(PHILIP) >= 0).every(p => p.penalty >= 5), "Philip's backup memberships cost at least +5 with the key on him");

/* ------------------------------------------------ Prompt 12 L.2 (9/22): East cross-reference, end to end */
step("L: East cross-reference covers every Davenport source (week row -> deriveKhanBusyDays -> ctx -> eligibility)");
// One synthetic Davenport week row per source, run through east-feed.deriveKhanBusyDays exactly as the app's ctx
// builder and scripts/preview-generate.js do, fed as ctx input eastBusyDays[s1], then eligibility(): PRIMARY is
// blocked by 'east-busy' on every day he holds East call and BACKUP stays eligible on the same day (subject only
// to the ordinary rules - eastBlocksBackup false). The rows use "s6" for FAK: that is his DAVENPORT id (production
// resolves it by roster code, never by id); the Silvis roster id is s1 - the East feed matches on code.
const DFAK = "s6";
const sortedSet = s => [...s].sort();
const eastCtx = (weekRows, opts) => {
  const kb = EF.deriveKhanBusyDays(weekRows, DFAK, Object.assign({ eastBackupCountsAsBusy: seed.surgeonRules[KHAN].eastFeed.eastBackupCountsAsBusy === true }, opts || {}));
  return { kb, ctx: makeCtx({ schedule: {}, eastBusyDays: { [KHAN]: kb } }) };
};
const busyPrimaryFreeBackup = (c, d, why) => { has(R.eligibility(c, d, P, KHAN).hard, "east-busy", why + ": primary must be east-busy on " + d); okElig(R.eligibility(c, d, B, KHAN), why + ": backup must stay eligible on " + d); lacks(R.eligibility(c, d, B, KHAN).hard, "east-busy", why + ": backup never cites east-busy"); };
const freePrimaryAndBackup = (c, d, why) => { lacks(R.eligibility(c, d, P, KHAN).hard, "east-busy", why + ": primary must NOT be east-busy on " + d); okElig(R.eligibility(c, d, B, KHAN), why + ": backup eligible on " + d); };
const NIGHTS_OTHERS = { mon: "s1", tue: "s2", wed: "s3", thu: "s4", wknd: "s5" };
eq(seed.surgeonRules[KHAN].eastFeed.eastBackupCountsAsBusy, true, "seed: s1.eastFeed.eastBackupCountsAsBusy true");
eq([seed.surgeonRules[KHAN].eastFeed.eastBlocksPrimary, seed.surgeonRules[KHAN].eastFeed.eastBlocksBackup], [true, false], "seed: East blocks primary only");
{ // dayCall = the service week Mon..Sat (Sat 07:00 -> Sun 07:00 is his); Sunday is not
  const { kb, ctx: c } = eastCtx([{ weekMonday: "2026-11-02", data: { dayCall: DFAK, nights: NIGHTS_OTHERS, off: "s7" } }]);
  eq(sortedSet(kb.busy), ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"], "dayCall: Mon..Sat derived");
  ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"].forEach(d => busyPrimaryFreeBackup(c, d, "dayCall"));
  freePrimaryAndBackup(c, "2026-11-08", "dayCall Sunday");
  eq(kb.reasons["2026-11-07"], ["service-week"], "the Saturday carries the service-week reason");
}
{ // nights.mon / tue / wed / thu = that weeknight (one row, all four, so each weekday is checked)
  const { kb, ctx: c } = eastCtx([{ weekMonday: "2026-11-30", data: { dayCall: "s2", nights: { mon: DFAK, tue: DFAK, wed: DFAK, thu: DFAK, wknd: "s5" }, off: "s7" } }]);
  eq(sortedSet(kb.busy), ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03"], "nights.mon..thu: Mon..Thu derived");
  [["mon", "2026-11-30"], ["tue", "2026-12-01"], ["wed", "2026-12-02"], ["thu", "2026-12-03"]].forEach(([k, d]) => { eq(kb.reasons[d], ["night"], "nights." + k + " -> " + d); busyPrimaryFreeBackup(c, d, "nights." + k); });
  freePrimaryAndBackup(c, "2026-12-04", "the Friday after four weeknights");
}
{ // nights.wknd = Friday night + Sunday, NOT Saturday day
  const { kb, ctx: c } = eastCtx([{ weekMonday: "2026-11-16", data: { dayCall: "s2", nights: Object.assign({}, NIGHTS_OTHERS, { wknd: DFAK }), off: "s7" } }]);
  eq(sortedSet(kb.busy), ["2026-11-20", "2026-11-22"], "nights.wknd: Fri + Sun derived");
  busyPrimaryFreeBackup(c, "2026-11-20", "nights.wknd Friday");
  busyPrimaryFreeBackup(c, "2026-11-22", "nights.wknd Sunday");
  freePrimaryAndBackup(c, "2026-11-21", "nights.wknd Saturday (the service-week surgeon's day)");
}
{ // holidayCoverage: his own 24h holiday is busy; a holiday held by someone else clears his service-week day
  const { kb, ctx: c } = eastCtx([{ weekMonday: "2026-12-21", data: { dayCall: DFAK, nights: NIGHTS_OTHERS, off: "s7",
    holidayCoverage: { "2026-12-24": { surgeonId: DFAK, role: "holiday_24h" }, "2026-12-25": { surgeonId: "s3", role: "holiday_24h" } } } }]);
  eq(sortedSet(kb.busy), ["2026-12-21", "2026-12-22", "2026-12-23", "2026-12-24", "2026-12-26"], "holidayCoverage: 12/24 his, 12/25 someone else's (service-week Friday cleared)");
  eq(kb.reasons["2026-12-24"], ["service-week", "holiday"], "his holiday keeps every reason");
  busyPrimaryFreeBackup(c, "2026-12-24", "holidayCoverage (his 24h unit, a Silvis holiday-unit day)");
  // V (9/22 evening): the FEED clears 12/25 (kb.busy above lacks it), but 12/25 is a standing East day every year - primary blocked by V, backup still free
  const v1225 = R.eligibility(c, "2026-12-25", P, KHAN);
  blocked(v1225, "east-busy", "holidayCoverage held by another Davenport surgeon clears the feed day, yet 12/25 is a standing East day (V)");
  eq(v1225.eastStanding, "Christmas", "...named as the standing entry, not a feed day");
  okElig(R.eligibility(c, "2026-12-25", B, KHAN), "backup 12/25 stays eligible");
  busyPrimaryFreeBackup(c, "2026-12-26", "the service-week Saturday after the holiday");
  const lone = eastCtx([{ weekMonday: "2026-11-23", data: { dayCall: "s2", nights: NIGHTS_OTHERS, off: "s7", holidayCoverage: { "2026-11-26": { surgeonId: DFAK, role: "holiday_24h" } } } }]);
  eq(sortedSet(lone.kb.busy), ["2026-11-26"], "a holiday unit alone: only that day");
  busyPrimaryFreeBackup(lone.ctx, "2026-11-26", "holidayCoverage alone (Thanksgiving Thursday, clean schedule)");
  freePrimaryAndBackup(lone.ctx, "2026-11-25", "the Wednesday before it");
}
{ // dayCallOverrides: an override of a service-week day to someone else frees it; an override TO FAK on another
  // surgeon's week marks it (holiday 24h > overrides > dayCall)
  const { kb, ctx: c } = eastCtx([
    { weekMonday: "2026-11-02", data: { dayCall: DFAK, nights: NIGHTS_OTHERS, off: "s7", dayCallOverrides: { "2026-11-04": "s2" } } },
    { weekMonday: "2026-12-14", data: { dayCall: "s2", nights: NIGHTS_OTHERS, off: "s7", dayCallOverrides: { "2026-12-16": DFAK } } }
  ]);
  eq(sortedSet(kb.busy), ["2026-11-02", "2026-11-03", "2026-11-05", "2026-11-06", "2026-11-07", "2026-12-16"], "dayCallOverrides: 11/04 released, 12/16 taken");
  freePrimaryAndBackup(c, "2026-11-04", "dayCallOverrides to someone else on his service week");
  busyPrimaryFreeBackup(c, "2026-11-02", "the rest of that service week");
  eq(kb.reasons["2026-12-16"], ["override"], "an override to FAK on a non-service week");
  busyPrimaryFreeBackup(c, "2026-12-16", "dayCallOverrides to FAK");
  freePrimaryAndBackup(c, "2026-12-14", "the other days of that week are not his");
}
{ // isBackup week (the Davenport group is backup): the days FAK holds count as busy for primary with
  // eastBackupCountsAsBusy true (the seed), and are free with false - backup allowed either way
  const row = [{ weekMonday: "2027-01-04", data: { dayCall: "s2", nights: Object.assign({}, NIGHTS_OTHERS, { mon: DFAK }), off: "s7", isBackup: true } }];
  const on = eastCtx(row);
  eq(sortedSet(on.kb.busy), ["2027-01-04"], "isBackup week: his Monday night derived (seed flag true)");
  eq(on.kb.reasons["2027-01-04"], ["night", "backup-week"], "tagged backup-week");
  busyPrimaryFreeBackup(on.ctx, "2027-01-04", "isBackup week with eastBackupCountsAsBusy true");
  freePrimaryAndBackup(on.ctx, "2027-01-05", "a backup week is never busy wholesale");
  const off = eastCtx(row, { eastBackupCountsAsBusy: false });
  eq(sortedSet(off.kb.busy), [], "eastBackupCountsAsBusy false: dropped from the busy set");
  eq(off.kb.reasons["2027-01-04"], ["ignored:night", "ignored:backup-week"], "...but still explained");
  freePrimaryAndBackup(off.ctx, "2027-01-04", "isBackup week with eastBackupCountsAsBusy false");
}
{ // all sources in one feed: the busy set is the union, nothing leaks onto a day with no East call
  const all = eastCtx([
    { weekMonday: "2026-11-02", data: { dayCall: DFAK, nights: NIGHTS_OTHERS, off: "s7", dayCallOverrides: { "2026-11-04": "s2" } } },
    { weekMonday: "2026-11-16", data: { dayCall: "s2", nights: Object.assign({}, NIGHTS_OTHERS, { wknd: DFAK }), off: "s7" } },
    { weekMonday: "2026-11-30", data: { dayCall: "s2", nights: Object.assign({}, NIGHTS_OTHERS, { wed: DFAK }), off: "s7" } },
    { weekMonday: "2026-12-21", data: { dayCall: DFAK, nights: NIGHTS_OTHERS, off: "s7", holidayCoverage: { "2026-12-24": { surgeonId: DFAK }, "2026-12-25": { surgeonId: "s3" } } } },
    { weekMonday: "2027-01-04", data: { dayCall: "s2", nights: Object.assign({}, NIGHTS_OTHERS, { mon: DFAK }), off: "s7", isBackup: true } }
  ]);
  eq(sortedSet(all.kb.busy), ["2026-11-02", "2026-11-03", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-20", "2026-11-22", "2026-12-02", "2026-12-21", "2026-12-22", "2026-12-23", "2026-12-24", "2026-12-26", "2027-01-04"], "every source in one feed");
  eq(all.ctx.warnings, [], "the { busy, reasons } object is accepted without a warning");
  all.kb.busy.forEach(d => has(R.eligibility(all.ctx, d, P, KHAN).hard, "east-busy", "primary east-busy on " + d));
  all.kb.busy.forEach(d => okElig(R.eligibility(all.ctx, d, B, KHAN), "backup eligible on " + d));
  ["2026-11-04", "2026-11-08", "2026-11-21", "2026-12-27", "2027-01-05"].forEach(d => lacks(R.eligibility(all.ctx, d, P, KHAN).hard, "east-busy", "no East reason leaks onto " + d));
  ok(!all.kb.busy.has("2026-12-25"), "the FEED clears 12/25 (someone else's holiday coverage) - the primary block that day is V's standing rule (below), not the feed");
  // and his Friday 11/20 (East Friday night) still allows the weekend BACKUP, carrying the L soft, never a hard block
  const fb = R.eligibility(all.ctx, "2026-11-20", B, KHAN);
  okElig(fb, "backup on an East Friday"); hasSoft(fb, "weekend-backup", "...discouraged by the L soft only");
}

/* ------------------------------------------------ purity and speed */
step("purity and speed");
const before = JSON.stringify(seed);
const t1 = Date.now();
let calls = 0;
for (let i = 0; i < 20; i++) {
  ["2026-11-02", "2026-11-06", "2026-11-11", "2026-11-18", "2026-11-26", "2026-12-09", "2026-12-24"].forEach(d => {
    ctx.activeIds.forEach(id => { R.eligibility(ctx, d, P, id); R.eligibility(ctx, d, B, id); calls += 2; });
  });
  R.weekendUnitPatterns(clean, "2026-11-13");
  R.weekendUnitPatterns(clean, "2026-12-11", "backup");
}
const elapsed = Date.now() - t1;
ok(elapsed < 1500, "hot loop took " + elapsed + " ms for " + calls + " eligibility calls plus 40 weekend enumerations");
eq(JSON.stringify(seed), before, "the seed object is never mutated by the engine");
const r1 = R.eligibility(ctx, "2026-11-04", P, KHAN), r2 = R.eligibility(ctx, "2026-11-04", P, KHAN);
eq(r1, r2, "deterministic");
r1.hard.push("mutated"); r1.soft.push({ reason: "mutated", weight: 1 });
eq(R.eligibility(ctx, "2026-11-04", P, KHAN), r2, "callers cannot corrupt the memo");

step("rules-1: Fierce manually locked PRIMARY on a derived-backup day frees that day's backup slot (generator review)");
const manPri = makeCtx({ schedule: { "2026-11-10": { primary: FIERCE, primaryLocked: true, backup: null } } });
const fp1110 = R.eligibility(manPri, "2026-11-10", P, FIERCE);
ok(fp1110.ok === true && fp1110.lockHolder === true, "manual primary lock: he is the holder, conflicts reported not blocking: " + JSON.stringify(fp1110));
lacks(R.eligibility(manPri, "2026-11-10", B, KHAN).hard, "derived-lock-held", "Khan may take backup: the derived backup lock is moot once Fierce is locked primary");
okElig(R.eligibility(manPri, "2026-11-10", B, KHAN), "Khan backup 11/10 (Tue; backup any day since 9/22)");
// Prompt 12 Y FLIP (9/22 evening): under T this read blocked whitelist-month (11/10 off his November backup list). His list is
// preferences now, a Tuesday BACKUP is allowed (X restricts primary) and the derived lock is moot, so the freed slot is open to him.
okElig(R.eligibility(manPri, "2026-11-10", B, ACTON), "Y: Acton may take the freed 11/10 backup (Tuesday backup allowed; no whitelist; derived lock moot)");
lacks(R.eligibility(manPri, "2026-11-10", B, ACTON).hard, "derived-lock-held", "Y: ...and the derived backup lock does not name him either");
lacks(R.eligibility(manPri, "2026-11-10", B, PHILIP).hard, "derived-lock-held", "Philip too (week of 11/9 is on his list)");
blocked(R.eligibility(manPri, "2026-11-10", B, FIERCE), "holds-other-role", "he cannot also be backup that day");
okElig(R.eligibility(manPri, "2026-11-11", B, FIERCE), "the other derived days stay his");
eq(R.eligibility(manPri, "2026-11-11", B, FIERCE).lockHolder, true, "still the derived lock holder on 11/11");
blocked(R.eligibility(manPri, "2026-11-11", B, PHILIP), "derived-lock-held:s5", "and still held against everyone else on 11/11 (Philip: week of 11/9 is on his list, so only the derived lock blocks him)");

/* ------------------------------------------------ Prompt 12 T (9/22): November governed for BOTH roles + the 9/22 locks */
step("Prompt 12 T: a plain 'YYYY-MM' entry governs PRIMARY only; an object entry governs exactly the roles it names");
// explicitListMonths -> role mask (1 = primary, 2 = backup). Burchett's and Acton's November entries are the explicit
// object form { month, roles: [primary, backup] } (the ER-panel author published their lists, so neither is placed on a November day
// he did not offer, in either role); their October / December entries stay the plain form = primary only (item I).
eq(Object.assign({}, ctx.per[BURCHETT].governedMonths), { "2026-10": 1, "2026-11": 3, "2026-12": 1 }, "T: Burchett governed months - Oct/Dec plain (primary only), Nov object (both roles)");
eq(Object.assign({}, ctx.per[ACTON].governedMonths), { "2026-10": 1 }, "T then Y FLIP: Acton governed months - Oct plain (primary only) ONLY; the November object entry left with Prompt 12 Y (9/22 evening: his list is preferences)");
eq(Object.assign({}, ctx.per[PHILIP].governedMonths), { "2026-10": 1 }, "T: Philip October object naming primary only");
blocked(R.eligibility(clean, "2026-11-10", B, BURCHETT), "whitelist-month", "T: Burchett backup 11/10 - not on his November backup list (before T: eligible, backup any day)");
blocked(R.eligibility(clean, "2026-11-17", B, BURCHETT), "whitelist-month", "T: Burchett backup 11/17 - not offered (a Tuesday outside the derived week)");
blocked(R.eligibility(clean, "2026-11-25", B, BURCHETT), "whitelist-month", "T: 11/25 is on his PRIMARY list only - backup blocked");
blocked(R.eligibility(clean, "2026-11-09", P, BURCHETT), "whitelist-month", "T: 11/9 is on his BACKUP list only - primary blocked");
blocked(R.eligibility(clean, "2026-11-13", P, BURCHETT), "whitelist-month", "T: Burchett primary 11/13 (Fri; not offered)");
okElig(R.eligibility(clean, "2026-11-04", B, BURCHETT), "T: Burchett backup 11/4 - on his backup list");
okElig(R.eligibility(clean, "2026-11-03", P, BURCHETT), "T: Burchett primary 11/3 - on his primary list");
// Prompt 12 Y FLIP (9/22 evening): under T these two read whitelist-month (Acton's November governed for both roles); his list is
// preferences now, so 11/11 backup is open again and 11/10 primary is blocked by his Tuesday rule (X) alone.
blocked(R.eligibility(clean, "2026-11-11", B, ACTON), "derived-lock-held:s5", "Y: Acton backup 11/11 - inside Fierce's derived week, so his derived lock (T read whitelist-month here)");
lacks(R.eligibility(clean, "2026-11-11", B, ACTON).hard, "whitelist-month", "Y: ...and no whitelist-month");
okElig(R.eligibility(clean, "2026-11-23", B, ACTON), "Y: Acton backup on his outreach Monday 11/23 (outside any derived week) - backup any day again (T: whitelist-month)");
blocked(R.eligibility(clean, "2026-11-10", P, ACTON), "hard-never-weekday:Tue", "Y: Acton primary 11/10 - his Tuesday rule (X), no whitelist-month any more (T had whitelist-month here)");
okElig(R.eligibility(clean, "2026-11-05", B, ACTON), "T: Acton backup 11/5 - backup any day (Y: no November list any more)");
okElig(R.eligibility(clean, "2026-11-16", P, ACTON), "T: Acton primary 11/16 - a 3rd Monday under his recurring rules (Y: no November list any more)");
okElig(R.eligibility(clean, "2026-12-08", B, BURCHETT), "T: December stays the plain form - backup on a non-list day is still eligible");
blocked(R.eligibility(clean, "2026-12-08", P, BURCHETT), "whitelist-month", "T: December primary governed as before");
okElig(R.eligibility(clean, "2026-10-13", B, BURCHETT), "T: October stays the plain form - Burchett backup any day (item I, unchanged)");
okElig(R.eligibility(clean, "2026-10-14", B, ACTON), "T: Acton October backup on a non-list day (item I, unchanged)");
const tgBur = R.eligibility(clean, "2026-11-27", B, BURCHETT);
okElig(tgBur, "T: a Thanksgiving-unit day off his November list: the holiday waiver applies to backup as to primary");
hasSoft(tgBur, "holiday-waiver:whitelist-month");
blocked(R.eligibility(closed, "2026-11-10", B, BURCHETT), "whitelist-month", "T: the object entry governs backup under the closed policy too");
blocked(R.eligibility(closed, "2026-12-03", B, BURCHETT), "whitelist-month", "T: closed policy: a plain month governs both roles again (unchanged)");
step("Prompt 12 T: the 9/22 locks on the seed schedule");
eq(R.eligibility(ctx, "2026-11-16", B, FIERCE).lockHolder, true, "T: Fierce backup 11/16 is an import lock holder (the Monday after his derived week)");
eq(R.eligibility(ctx, "2026-11-16", B, FIERCE).conflicts, [], "T: ...with no conflicts (Monday backup is on his pattern)");
eq(R.eligibility(ctx, "2026-11-12", B, FIERCE).lockHolder, true, "T: 11/12 - derived AND import lock, one holder");
blocked(R.eligibility(ctx, "2026-11-12", B, BURCHETT), "slot-locked:s5", "T: everyone else sees the import lock on 11/12");
const k25 = R.eligibility(ctx, "2026-11-25", P, KHAN);
ok(k25.ok === true && k25.lockHolder === true, "T: Khan 11/25 primary is a lock holder (amendment A): " + JSON.stringify(k25));
eq(k25.conflicts, [], "T: 11/25 + the Thanksgiving unit = 2 commitments <= his max 3 - no max-consecutive conflict");
eq([ctx.schedule["2026-11-25"].backup, ctx.schedule["2026-11-25"].backupLocked], [null, false], "T: 11/25 backup is open");
okElig(R.eligibility(ctx, "2026-11-25", B, PHILIP), "T: Philip may take 11/25 backup (week of 11/23 is on his list; backup any day)");
blocked(R.eligibility(ctx, "2026-11-25", B, KHAN), "holds-other-role", "T: Khan holds the primary that day");
blocked(R.eligibility(ctx, "2026-11-25", P, BURCHETT), "slot-locked:s1", "T: the ER-panel author's Burchett 11/25 entry is superseded - the slot is Khan's");
okElig(R.eligibility(ctx, "2026-11-30", P, KHAN), "T: 11/25 + unit(1) + 11/30 = 3 = his max 3 (Monday auto-offer, East clear here)");
const a18 = R.eligibility(ctx, "2026-11-18", P, ACTON);
ok(a18.ok === true && a18.lockHolder === true, "T: Acton 11/18 primary is the ER-panel author's locked entry: " + JSON.stringify(a18));
has(a18.conflicts, "day-before-vacation", "T: ...kept as a fact, the day before his 11/19 vacation reported as a conflict");
// Prompt 12 Y FLIP (9/22 evening): under T this read [] ("11/5 primary has no eligible surgeon once Acton is its locked backup",
// section 8 item 13) and Acton's hard list carried whitelist-month. Faraz resolved item 13: 11/5 is Acton's locked primary.
eq([KHAN, BURCHETT, ACTON, PHILIP, FIERCE, SARKAR].filter(id => R.eligibility(ctx, "2026-11-05", P, id).ok), [ACTON], "Y: 11/5 (Thu) primary - Acton, its lock holder, is the one eligible surgeon (T: nobody)");
eq(R.eligibility(ctx, "2026-11-05", P, ACTON).conflicts, [], "Y: ...and his lock carries no conflict (T: whitelist-month in hard)");

// ---- Prompt 12 U (9/22 evening) ----
// groupRules.holidays.mondayMinorAbsorbsWeekend is DATA the per-year unit builder
// (helpers.defaultHolidayUnits, Setup's Add year) reads; the engine reads only the
// stored unit days. The flag reaches ctx without a warning and changes nothing on a
// milestone day: unit membership and eligibility are identical with the flag removed.
step("U: mondayMinorAbsorbsWeekend reaches ctx.holidayFlags, warns nothing, leaves the milestone units and eligibility alone");
eq(seed.groupRules.holidays.mondayMinorAbsorbsWeekend, true, "seed: groupRules.holidays.mondayMinorAbsorbsWeekend");
eq(ctx.holidayFlags.mondayMinorAbsorbsWeekend, true, "buildContext keeps the flag in ctx.holidayFlags (data; no code branch in rules.js reads it)");
eq(ctx.warnings.filter(w => /mondayMinor/i.test(w)), [], "no buildContext warning about the key");
eq(R.isHolidayDay(ctx, "2026-11-27").days, ["2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"], "Khan's Thanksgiving Friday is still a day of the 4-day 2026 unit");
eq(R.isHolidayDay(ctx, "2026-12-25").days, ["2026-12-24", "2026-12-25"], "Christmas 2026 still Thu 12/24 + Fri 12/25");
eq(R.isHolidayDay(ctx, "2027-01-01").days, ["2026-12-31", "2027-01-01"], "New Year's still 12/31 + 1/1");
const noFlagSeed = clone(seed); delete noFlagSeed.groupRules.holidays.mondayMinorAbsorbsWeekend;
const noFlag = R.buildContext(SA.seedToContextInput(noFlagSeed, { eastDerived: DERIVED, eastFeedCoverage: EAST_COVER, eastBusyDays: {} }));
["2026-11-27", "2026-11-30", "2026-12-24", "2026-12-31", "2027-01-01"].forEach(d => ctx.activeIds.forEach(id => {
  eq(R.eligibility(ctx, d, P, id), R.eligibility(noFlag, d, P, id), "primary eligibility " + d + " " + id + " is independent of the flag");
  eq(R.eligibility(ctx, d, B, id), R.eligibility(noFlag, d, B, id), "backup eligibility " + d + " " + id + " is independent of the flag");
}));

// ---- Prompt 12 V (9/22 evening) ----
// surgeonRules.<id>.eastStanding [{ name, days: ["MM-DD"] }] - a standing East day is a
// published East busy day in EVERY year, independent of the feed and the forecast: the
// same hard "east-busy" for the roles East blocks (Khan: primary only), precedence over
// the forecast and over east-unknown, the same eastFeed gate as busy days. Khan:
// Christmas Eve + Day (Faraz 9/22 evening; the Davenport standing rule of 2026-08-06).
step("V: seed - surgeonRules.s1.eastStanding is Christmas 12-24 + 12-25");
eq(seed.surgeonRules[KHAN].eastStanding.map(e => ({ name: e.name, days: e.days })), [{ name: "Christmas", days: ["12-24", "12-25"] }], "seed: s1.eastStanding");
step("V: Khan PRIMARY on 12/24 and 12/25 is hard east-busy every year (no feed busy day, no forecast)");
const vClean = makeCtx({ schedule: {} });   // eastBusyDays {}, no forecast, coverage 2026-11-01..2027-01-31
eq(vClean.warnings.filter(w => /eastStanding/.test(w)), [], "a well-formed eastStanding list raises no warning");
["2026-12-24", "2026-12-25", "2027-12-24", "2027-12-25", "2028-12-24", "2028-12-25"].forEach(d => {
  const r = R.eligibility(vClean, d, P, KHAN);
  blocked(r, "east-busy", "standing East day " + d);
  eq(r.eastStanding, "Christmas", d + ": the result names the standing entry for the day editor");
  lacks(r.hard, "east-forecast-busy", d + ": no forecast reason");
  lacksSoft(r, "east-unknown", d + ": a standing day is never East-unknown (" + d + " is " + (d < "2027-02-01" ? "inside" : "outside") + " the feed coverage)");
});
step("V: Khan BACKUP on 12/24 and 12/25 is not east-busy (eastBlocksBackup false)");
["2026-12-24", "2026-12-25", "2027-12-25"].forEach(d => { const r = R.eligibility(vClean, d, B, KHAN); lacks(r.hard, "east-busy", "backup " + d); eq(r.eastStanding, undefined, "no standing name on the backup result " + d); });
okElig(R.eligibility(vClean, "2026-12-24", B, KHAN), "Christmas Eve backup stays open to him");
step("V: the neighbouring days carry no east-busy from the standing rule");
["2026-12-23", "2026-12-26", "2027-12-23", "2027-12-26"].forEach(d => lacks(R.eligibility(vClean, d, P, KHAN).hard, "east-busy", "primary " + d + " (other rules may still apply)"));
step("V: standing beats the forecast and the coverage");
const vFc = makeCtx({ schedule: {}, eastForecast: { [KHAN]: { "2026-12-24": 0.10, "2026-12-25": 0.70 } } });
const vFc24 = R.eligibility(vFc, "2026-12-24", P, KHAN);
blocked(vFc24, "east-busy", "forecast 0.10 on a standing day: still the hard east-busy");
lacksSoft(vFc24, "east-forecast", "...and NO east-forecast soft term");
const vFc25 = R.eligibility(vFc, "2026-12-25", P, KHAN);
blocked(vFc25, "east-busy", "forecast 0.70 on a standing day: east-busy, not east-forecast-busy");
lacks(vFc25.hard, "east-forecast-busy", "the forecast-busy code is not added on a standing day");
const vNoCov = R.buildContext(SA.seedToContextInput(seed, { schedule: {}, eastDerived: DERIVED, eastBusyDays: {} }));   // no eastFeedCoverage at all
const vNoCov24 = R.eligibility(vNoCov, "2026-12-24", P, KHAN);
blocked(vNoCov24, "east-busy", "outside any feed coverage: still east-busy");
lacksSoft(vNoCov24, "east-unknown", "...and no east-unknown soft term");
hasSoft(R.eligibility(vNoCov, "2026-12-23", P, KHAN), "east-unknown", "fixture: without coverage the day before IS East-unknown (so the line above is a real check)");
step("V: a malformed entry warns and blocks nothing; a surgeon whose eastFeed is off warns and blocks nothing");
const srBad = clone(SA.seedToContextInput(seed).surgeonRules);
srBad[KHAN].eastStanding = [{ name: "Christmas", days: ["12/24", "12-25"] }, { name: "Bogus", days: ["13-01", "02-30"] }, { days: ["01-01"] }];
const vBad = R.buildContext(SA.seedToContextInput(seed, { schedule: {}, surgeonRules: srBad, eastDerived: DERIVED, eastFeedCoverage: EAST_COVER, eastBusyDays: {} }));
const wBad = vBad.warnings.filter(w => /eastStanding/.test(w));
ok(wBad.some(w => /surgeonRules\.s1\.eastStanding\[0\]/.test(w) && /"12\/24"/.test(w)), "warning names the surgeon, the entry and the bad day: " + JSON.stringify(wBad));
ok(wBad.some(w => /eastStanding\[1\]/.test(w) && /"13-01"/.test(w)) && wBad.some(w => /eastStanding\[1\]/.test(w) && /"02-30"/.test(w)), "13-01 and 02-30 are not real month/days: " + JSON.stringify(wBad));
ok(wBad.some(w => /eastStanding\[2\]/.test(w)), "an entry without a name is refused: " + JSON.stringify(wBad));
lacks(R.eligibility(vBad, "2026-12-24", P, KHAN).hard, "east-busy", "the malformed 12/24 day blocks nothing");
blocked(R.eligibility(vBad, "2026-12-25", P, KHAN), "east-busy", "the well-formed 12-25 day of the same entry still counts");
lacks(R.eligibility(vBad, "2027-01-01", P, KHAN).hard, "east-busy", "the nameless entry blocks nothing");
const srOff = clone(SA.seedToContextInput(seed).surgeonRules);
srOff[KHAN].eastFeed = Object.assign({}, srOff[KHAN].eastFeed, { enabled: false });
const vOff = R.buildContext(SA.seedToContextInput(seed, { schedule: {}, surgeonRules: srOff, eastDerived: DERIVED, eastFeedCoverage: EAST_COVER, eastBusyDays: {} }));
ok(vOff.warnings.some(w => /surgeonRules\.s1\.eastStanding ignored/.test(w) && /enable surgeonRules\.s1\.eastFeed/.test(w)), "eastFeed off: one warning that names the gate: " + JSON.stringify(vOff.warnings.filter(w => /eastStanding/.test(w))));
lacks(R.eligibility(vOff, "2026-12-24", P, KHAN).hard, "east-busy", "eastFeed off: the standing day blocks nothing (same gate as busy days)");
// (V review) eastFeed enabled but blocking neither role: the entries could never act, so they are
// ignored with the same warning (naming the roles) - never validated into the list, never a silent no-op.
const srNoRole = clone(SA.seedToContextInput(seed).surgeonRules);
srNoRole[KHAN].eastFeed = Object.assign({}, srNoRole[KHAN].eastFeed, { enabled: true, eastBlocksPrimary: false, eastBlocksBackup: false });
const vNoRole = R.buildContext(SA.seedToContextInput(seed, { schedule: {}, surgeonRules: srNoRole, eastDerived: DERIVED, eastFeedCoverage: EAST_COVER, eastBusyDays: {} }));
const wNoRole = vNoRole.warnings.filter(w => /eastStanding/.test(w));
ok(wNoRole.length === 1 && /surgeonRules\.s1\.eastStanding ignored/.test(wNoRole[0]) && /eastBlocksPrimary or eastBlocksBackup/.test(wNoRole[0]), "eastFeed on but no role blocked: one warning naming the roles: " + JSON.stringify(wNoRole));
eq(vNoRole.per[KHAN].eastStandingList, [], "eastFeed on but no role blocked: nothing reaches the display list");
eq(R.standingEastDays(vNoRole, KHAN, "2026-11-02", "2027-01-03"), [], "eastFeed on but no role blocked: standingEastDays lists nothing");
lacks(R.eligibility(vNoRole, "2026-12-24", P, KHAN).hard, "east-busy", "eastFeed on but no role blocked: primary not east-busy");
lacks(R.eligibility(vNoRole, "2026-12-24", B, KHAN).hard, "east-busy", "eastFeed on but no role blocked: backup not east-busy");
step("V: standingEastDays(ctx, id, from, to) lists the concrete days of every year in the range");
eq(R.standingEastDays(vClean, KHAN, "2026-11-02", "2027-01-03"), ["2026-12-24", "2026-12-25"], "milestone range");
eq(R.standingEastDays(vClean, KHAN, "2026-12-25", "2028-12-24"), ["2026-12-25", "2027-12-24", "2027-12-25", "2028-12-24"], "edges inclusive, every year in between");
eq(R.standingEastDays(vClean, KHAN, "2027-01-02", "2027-12-23"), [], "none in range");
eq(R.standingEastDays(vClean, BURCHETT, "2026-11-02", "2027-12-31"), [], "a surgeon without entries");
eq(R.standingEastDays(vClean, "nobody", "2026-11-02", "2027-12-31"), [], "unknown surgeon -> []");
step("V: holidayUnitCandidates - Christmas 2026: Khan is absent from primary and present for backup");
const vUnits = R.holidayUnits(vClean, "2026-12-01", "2026-12-31");
eq(vUnits.map(u => u.name), ["Christmas", "New Year's"]);
const vXmasP = R.holidayUnitCandidates(vClean, vUnits[0], P), vXmasB = R.holidayUnitCandidates(vClean, vUnits[0], B);
ok(vXmasP.indexOf(KHAN) < 0, "Khan is not a Christmas 2026 primary candidate: " + vXmasP);
ok(vXmasP.length >= 2, "others remain primary candidates: " + vXmasP);
ok(vXmasB.indexOf(KHAN) >= 0, "Khan IS a Christmas 2026 backup candidate: " + vXmasB);
// and without the standing entry he is a primary candidate again (the exclusion is this rule, nothing else)
const srNoSt = clone(SA.seedToContextInput(seed).surgeonRules); delete srNoSt[KHAN].eastStanding;
const vNoSt = R.buildContext(SA.seedToContextInput(seed, { schedule: {}, surgeonRules: srNoSt, eastDerived: DERIVED, eastFeedCoverage: EAST_COVER, eastBusyDays: {} }));
ok(R.holidayUnitCandidates(vNoSt, vUnits[0], P).indexOf(KHAN) >= 0, "fixture: without eastStanding he is a Christmas primary candidate (so the exclusion above is V's)");

/* ------------------------------------------------ Prompt 12 C: East precedence + conflict report */
// Published coverage > override > forecast (review item C, 9/22). EAST_COVER in these
// tests is 2026-11-01..2027-01-31; 2026-11-04 and 2027-02-03 are Wednesdays (Khan's
// auto-offered weekday), so nothing but East decides the primary answer.
step("C.1: a forecast is never consulted inside the published coverage");
const cStale = makeCtx({ schedule: {}, eastForecast: { [KHAN]: { "2026-11-04": 0.9, "2026-11-11": 0.3 } } });
const cFree = R.eligibility(cStale, "2026-11-04", P, KHAN);
okElig(cFree, "C.1: published-free day inside coverage + stale forecast 0.9 -> eligible primary (published rows win)");
lacksSoft(cFree, "east-forecast", "C.1: no soft forecast term inside coverage either");
lacksSoft(cFree, "east-unknown", "C.1: a covered day is known-clear");
lacksSoft(R.eligibility(cStale, "2026-11-11", P, KHAN), "east-forecast", "C.1: a below-threshold forecast inside coverage adds no soft penalty");
lacks(R.eligibility(cStale, "2026-11-04", P, KHAN).hard, "east-forecast-busy", "C.1: no east-forecast-busy inside coverage");
step("C.1: outside coverage the forecast rule stands");
const cOut = makeCtx({ schedule: {}, eastForecast: { [KHAN]: { "2027-02-03": 0.9, "2027-02-10": 0.2 } } });
blocked(R.eligibility(cOut, "2027-02-03", P, KHAN), "east-forecast-busy:0.90", "C.1: a forecast-busy day outside coverage still blocks primary");
const cOutLow = R.eligibility(cOut, "2027-02-10", P, KHAN);
okElig(cOutLow); hasSoft(cOutLow, "east-forecast:0.20"); lacksSoft(cOutLow, "east-unknown");
step("C.3: east_overrides as a first-class input (busy:false clears forecast AND busy; busy:true busies)");
const cOvF = makeCtx({ schedule: {}, eastForecast: { [KHAN]: { "2027-02-03": 0.9 } }, eastOverrides: { [KHAN]: { "2027-02-03": false } } });
const cOvFr = R.eligibility(cOvF, "2027-02-03", P, KHAN);
okElig(cOvFr, "C.3: override busy:false clears a forecast-busy day (overrides apply AFTER the forecast)");
lacksSoft(cOvFr, "east-forecast", "C.3: ...and its soft term"); lacksSoft(cOvFr, "east-unknown", "C.3: an explicit override is a known answer, not 'unknown'");
const cOvB = makeCtx({ schedule: {}, eastBusyDays: { [KHAN]: ["2026-11-02", "2026-11-04"] }, eastOverrides: { [KHAN]: { "2026-11-02": false } } });
okElig(R.eligibility(cOvB, "2026-11-02", P, KHAN), "C.3: override busy:false clears a published busy day");
blocked(R.eligibility(cOvB, "2026-11-04", P, KHAN), "east-busy", "C.3: the other busy day stays busy");
ok(!cOvB.per[KHAN].eastBusy.has("2026-11-02") && cOvB.per[KHAN].eastBusy.has("2026-11-04"), "C.3: P.eastBusy reflects the override (display + tallies)");
const cOvT = makeCtx({ schedule: {}, eastOverrides: { [KHAN]: { "2026-11-02": true } } });
blocked(R.eligibility(cOvT, "2026-11-02", P, KHAN), "east-busy", "C.3: override busy:true busies a free day for primary");
okElig(R.eligibility(cOvT, "2026-11-02", B, KHAN), "C.3: ...backup stays open on an East day");
ok(cOvT.per[KHAN].eastBusy.has("2026-11-02"), "C.3: an override true lands in P.eastBusy");
const cOvTF = makeCtx({ schedule: {}, eastForecast: { [KHAN]: { "2027-02-10": 0.1 } }, eastOverrides: { [KHAN]: { "2027-02-10": true } } });
blocked(R.eligibility(cOvTF, "2027-02-10", P, KHAN), "east-busy", "C.3: override busy:true beats a low forecast");
const cOvBad = makeCtx({ schedule: {}, eastOverrides: { [KHAN]: { "2026-11-02": "yes", "nonsense": true } } });
ok(cOvBad.warnings.some(w => /eastOverrides\[s1\]/.test(w)), "C.3: a malformed override map warns instead of silently doing nothing: " + JSON.stringify(cOvBad.warnings));
okElig(R.eligibility(cOvBad, "2026-11-02", P, KHAN), "C.3: ...and a non-boolean value is ignored");
step("C.4: eastConflicts(ctx, days) - the conflict report over held slots");
ok(typeof R.eastConflicts === "function", "C.4: rules.eastConflicts is exported");
const cFx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "east-conflicts-2026-11.json"), "utf8"));
const cCtx = makeCtx({ schedule: clone(cFx.schedule), eastBusyDays: cFx.eastBusyDays, eastForecast: cFx.eastForecast });
const cRep = R.eastConflicts(cCtx, Object.keys(cFx.schedule).sort());
eq(cRep, cFx.expected, "C.4: the report lists exactly the fixture's conflicts (Khan primary on an East day, someone else in Fierce's derived slot, Fierce in the other role, a forecast-busy generated primary) and not Fierce holding his own derived role");
eq(R.eastConflicts(cCtx, ["2026-11-11", "2026-11-16"]), [], "C.4: the derived surgeon in the derived role and an open day report nothing");
eq(R.eastConflicts(cCtx, []), [], "C.4: no days, no report");
ok(cCtx.schedule["2026-11-06"].primary === KHAN && cCtx.schedule["2026-11-06"].primaryLocked === true, "C.4: the report never changes the schedule");
// Fix round (review 9/22, finding 9): "a Fierce derived week that no longer matches" -
// for a holder whose rules carry outsideDerivedWeeks the pattern reasons that fire only
// outside his derived weeks (weekday-pattern:, weekend-block-only) are East conflicts
// too; a full Fri+Sat+Sun primary block is evaluated as a block and is fine.
const cRepKeys = cRep.map(r => r.day + " " + r.role + " " + r.reasons.join(","));
has(cRepKeys, "2026-11-30 primary weekday-pattern:Mon", "C fix 9: Fierce primary on a Monday outside his derived weeks (a week that is no longer derived) is listed");
has(cRepKeys, "2026-12-04 primary weekend-block-only", "C fix 9: a standalone Friday primary outside his derived weeks is listed");
ok(!cRep.some(r => r.day >= "2026-11-20" && r.day <= "2026-11-22"), "C fix 9: his full Fri+Sat+Sun primary block 11/20-22 is NOT listed (evaluated as a block): " + JSON.stringify(cRep));
ok(!cRep.some(r => r.day === "2026-10-12"), "C fix 9: his locked Monday 10/12 primary lies BEFORE eastFeed.deriveFrom (October is not derived) - the pattern reasons do not count there: " + JSON.stringify(cRep.filter(r => r.day === "2026-10-12")));
// Fix round (finding 3/8): with no published coverage at all (the app passes null while an
// East id is unresolved) the forecast is still consulted - never a soft 'east-unknown'.
step("C fix: no published coverage -> the forecast still applies");
const cNoCov = makeCtx({ schedule: {}, eastFeedCoverage: null, eastForecast: { [KHAN]: { "2026-11-04": 0.9 } } });
blocked(R.eligibility(cNoCov, "2026-11-04", P, KHAN), "east-forecast-busy:0.90", "C fix: coverage null + forecast 0.9 -> hard block (the app must prune with the coverage it passes, not a wider one)");
// Fix round (finding 7): an east_overrides map for a surgeon whose East feature blocks no
// role can never change an answer - it warns and is ignored, never silently inert.
step("C fix: an override for a surgeon whose East feature blocks no role warns and is ignored");
const cOvInert = makeCtx({ schedule: {}, eastOverrides: { [FIERCE]: { "2026-11-04": true, "2026-11-18": false } } });
ok(cOvInert.warnings.some(w => /eastOverrides\[s5\]: 2 entries ignored - this surgeon's East feature blocks no role/.test(w)), "C fix 7: inert override map warns: " + JSON.stringify(cOvInert.warnings));
ok(!cOvInert.per[FIERCE].eastBusy.has("2026-11-04") && !cOvInert.per[FIERCE].eastDays.has("2026-11-04") && cOvInert.per[FIERCE].eastOverrides["2026-11-04"] === undefined, "C fix 7: ...and the entries never land in his override / busy / East-day sets");
okElig(R.eligibility(cOvInert, "2026-11-04", P, FIERCE), "C fix 7: ...eligibility unchanged (a Wednesday primary is open to Fierce)");
ok(!makeCtx({ schedule: {}, eastOverrides: { [KHAN]: { "2026-11-04": true } } }).warnings.some(w => /blocks no role/.test(w)), "C fix 7: Khan's East feature blocks primary - no such warning for him");
// ---- Prompt 12 W (9/22 evening) ----
// Faraz: "Own dates beat own patterns (his East OR days are not every Tue/Thu): a surgeon's explicit dated
// availability, entered by them or by the scheduler for them, lifts that surgeon's WEEKDAY-PATTERN rules for that
// date and role, including hard ones (Khan's Tue/Thu primary, Fierce's Clinton days, Burchett's outreach days,
// Acton's Tuesdays). It never lifts obligations: vacations, East feed busy days, derived-week locks, Sarkar's windows."
// Engine: rdStatic applies hard-never-weekday:<wd> only when no dated available/backup_only row covers the role that
// day (the same rowAvail flag the rest of the family reads); outside-window no longer reads rowAvail at all.
step("Prompt 12 W: Khan on an ordinary Tuesday - a dated primary row lifts hard-never-weekday, nothing else does");
const W_TUE = "2026-12-01"; // an ordinary Tuesday: no lock, no holiday, no East busy day in these contexts
const wRow = withRows([row(KHAN, "available", W_TUE, "primary")]);
okElig(R.eligibility(wRow, W_TUE, P, KHAN), "W: Khan PRIMARY on Tue 12/1 with a dated available/primary row");
lacks(R.eligibility(wRow, W_TUE, P, KHAN).hard, "hard-never-weekday", "W: the OR-day reason is gone for that date");
blocked(R.eligibility(clean, W_TUE, P, KHAN), "hard-never-weekday:Tue", "W: the same Tuesday without a row stays his OR day");
eq(R.eligibility(clean, W_TUE, P, KHAN).hard, ["hard-never-weekday:Tue"], "W: ...and that is the only hard reason (reason code unchanged)");
blocked(R.eligibility(clean, "2026-12-08", P, KHAN), "hard-never-weekday:Tue", "W: the row is date-scoped - the next Tuesday is still blocked in the row context too");
blocked(R.eligibility(wRow, "2026-12-08", P, KHAN), "hard-never-weekday:Tue", "W: (row context) 12/8 has no row");
// role scope: an available/backup row on a Tuesday lifts nothing for primary (his backup was open anyway)
const wRowB = withRows([row(KHAN, "available", W_TUE, "backup")]);
blocked(R.eligibility(wRowB, W_TUE, P, KHAN), "hard-never-weekday:Tue", "W: a backup-role row does not lift his PRIMARY block (role-scoped)");
okElig(R.eligibility(wRowB, W_TUE, B, KHAN), "W: backup on a Tuesday needs no row (9/22) - the row changes nothing there");
okElig(R.eligibility(clean, W_TUE, B, KHAN), "W: ...and without the row too");
// an any-role row lifts primary (mask 3 covers both roles)
okElig(R.eligibility(withRows([row(KHAN, "available", W_TUE)]), W_TUE, P, KHAN), "W: an any-role row lifts the primary block as well");
step("Prompt 12 W: obligations never lift - East busy, vacation, trailing edge, derived locks, other role, consecutive, opt-out");
const wEast = withRows([row(KHAN, "available", W_TUE, "primary")], { eastBusyDays: { [KHAN]: [W_TUE] } });
blocked(R.eligibility(wEast, W_TUE, P, KHAN), "east-busy", "W: a dated row on an East busy day - east-busy still hard");
lacks(R.eligibility(wEast, W_TUE, P, KHAN).hard, "hard-never-weekday", "W: (the row did lift the OR-day rule; East is the block)");
okElig(R.eligibility(wEast, W_TUE, B, KHAN), "W: backup on his East day stays allowed (eastBlocksBackup false)");
// (merge with Prompt 12 C: the forecast is consulted only OUTSIDE the published coverage - EAST_COVER ends 2027-01-31 -
// so the forecast-obligation case uses Tue 2027-02-02; inside coverage the published rows decide, see the C.1 tests)
const W_TUE_OUT = "2027-02-02"; // a Tuesday outside EAST_COVER
const wFc = withRows([row(KHAN, "available", W_TUE_OUT, "primary")], { eastForecast: { [KHAN]: { [W_TUE_OUT]: 0.9 } } });
blocked(R.eligibility(wFc, W_TUE_OUT, P, KHAN), "east-forecast-busy:0.90", "W: a forecast-busy day (outside published coverage) is an obligation too");
lacks(R.eligibility(wFc, W_TUE_OUT, P, KHAN).hard, "hard-never-weekday", "W: (the row lifted the OR-day rule there as well; the forecast is the block)");
const W_THU = "2026-12-03"; // Thursday inside a synthetic vacation 12/3-12/4
const wVac = withRows([row(KHAN, "available", W_THU, "primary"), row(KHAN, "available", "2026-12-02", "primary")], { timeOffRows: SA.seedToTimeOffRows(seed).concat([{ person_id: KHAN, start_date: W_THU, end_date: "2026-12-04" }]) });
blocked(R.eligibility(wVac, W_THU, P, KHAN), "time-off:" + W_THU, "W: a dated row on a Thursday inside his vacation - time-off still hard");
lacks(R.eligibility(wVac, W_THU, P, KHAN).hard, "hard-never-weekday", "W: (the OR-day rule was lifted; the vacation is the block)");
blocked(R.eligibility(wVac, W_THU, B, KHAN), "time-off:" + W_THU, "W: vacation blocks backup too, row or no row");
blocked(R.eligibility(wVac, "2026-12-02", P, KHAN), "day-before-vacation", "W: a row on the trailing-edge day does not lift day-before-vacation (Wed 12/2 is an allowed weekday otherwise)");
// derived-week locks: Fierce with a dated row inside his derived weeks
const wDer = withRows([row(FIERCE, "available", "2026-11-10", "primary"), row(FIERCE, "available", "2026-12-08", "backup")]);
blocked(R.eligibility(wDer, "2026-11-10", P, FIERCE), "derived-lock:backup", "W: a primary row inside his East-primary (Silvis backup) week - the derived lock still governs");
blocked(R.eligibility(wDer, "2026-12-08", B, FIERCE), "derived-lock:primary", "W: a backup row inside his East-backup (Silvis primary) week - the derived lock still governs");
eq(R.eligibility(wDer, "2026-11-10", B, FIERCE).lockHolder, true, "W: he is still the derived backup holder that day");
// same-day other role
const wOther = withRows([row(KHAN, "available", W_TUE, "primary")], { schedule: { [W_TUE]: { primary: null, backup: KHAN } } });
blocked(R.eligibility(wOther, W_TUE, P, KHAN), "holds-other-role", "W: a row does not lift holds-other-role");
// max consecutive (Khan 3 on real primary days): Wed 12/2 - Fri 12/4 held, the lifted Tuesday would make 4
const wRun = withRows([row(KHAN, "available", W_TUE, "primary")], { schedule: { "2026-12-02": { primary: KHAN }, "2026-12-03": { primary: KHAN }, "2026-12-04": { primary: KHAN } } });
blocked(R.eligibility(wRun, W_TUE, P, KHAN), "max-consecutive:3", "W: a row does not lift max-consecutive (Tue + Wed-Fri = 4 > 3)");
// backup opt-out: a backup row never lifts it
const srWOpt = clone(SA.seedToSurgeonRules(seed)); srWOpt[KHAN].backupOptOut = true;
blocked(R.eligibility(withRows([row(KHAN, "available", W_TUE, "backup")], { surgeonRules: srWOpt }), W_TUE, B, KHAN), "backup-opt-out", "W: a backup row does not lift backup-opt-out");
step("Prompt 12 W: the rest of the pattern family keeps lifting (regression) - Fierce Clinton, Burchett outreach, Acton 2nd Monday");
const wFam = withRows([row(FIERCE, "available", "2026-12-01", "primary"), row(BURCHETT, "available", "2027-01-07", "primary"), row(ACTON, "available", "2026-12-14", "primary")]);
okElig(R.eligibility(wFam, "2026-12-01", P, FIERCE), "W: Fierce Clinton Tuesday primary with a dated row (weekday-pattern:Tue lifted; outside any derived week)");
blocked(R.eligibility(clean, "2026-12-01", P, FIERCE), "weekday-pattern:Tue", "W: ...and blocked without it");
okElig(R.eligibility(wFam, "2027-01-07", P, BURCHETT), "W: Burchett off-list Thursday primary with a dated row (not-recurring-available lifted; January ungoverned)");
blocked(R.eligibility(clean, "2027-01-07", P, BURCHETT), "not-recurring-available", "W: ...and blocked without it");
okElig(R.eligibility(wFam, "2026-12-14", P, ACTON), "W: Acton 2nd-Monday primary with a dated row (recurring-unavailable:Mon lifted; December ungoverned)");
blocked(R.eligibility(clean, "2026-12-14", P, ACTON), "recurring-unavailable:Mon", "W: ...and blocked without it");
// generic, data-driven: a synthetic hardNeverWeekdays ["Tue"] primary rule on Acton (item X's shape) lifts the same way
const srWAct = clone(SA.seedToSurgeonRules(seed)); srWAct[ACTON].hardNeverWeekdays = ["Tue"]; srWAct[ACTON].hardNeverWeekdaysRoles = ["primary"];
blocked(R.eligibility(withRows([], { surgeonRules: srWAct }), "2027-01-12", P, ACTON), "hard-never-weekday:Tue", "W: a hard Tuesday rule on Acton blocks an ungoverned January Tuesday primary");
okElig(R.eligibility(withRows([row(ACTON, "available", "2027-01-12", "primary")], { surgeonRules: srWAct }), "2027-01-12", P, ACTON), "W: ...and his own dated row lifts it (no surgeon-specific code: the rule is data)");
okElig(R.eligibility(withRows([], { surgeonRules: srWAct }), "2027-01-12", B, ACTON), "W: his Tuesday backup stays open (roles [primary])");
step("Prompt 12 W: Sarkar's windows are an obligation - a row inside a window changes nothing, a manual lock is not a row");
okElig(R.eligibility(withRows([row(SARKAR, "available", "2026-11-17", "primary")]), "2026-11-17", P, SARKAR), "W: a dated row on a window day - eligible as before");
blocked(R.eligibility(withRows([row(SARKAR, "available", "2026-11-23")]), "2026-11-23", P, SARKAR), "outside-window", "W: an any-role row on the Monday after her November window does not open it");
blocked(R.eligibility(withRows([row(SARKAR, "available", "2026-11-23")]), "2026-11-23", B, SARKAR), "outside-window", "W: ...for backup either");
blocked(R.eligibility(withRows([row(SARKAR, "available", "2026-11-26", "backup")]), "2026-11-26", B, SARKAR), "outside-window", "W: a row on a holiday-unit day outside a window - still enforced on holidays");
// a manual lock is not a dated availability row: the holder keeps the lock and the OR-day rule is reported as a conflict
const wLock = R.eligibility(makeCtx({ schedule: { [W_TUE]: { primary: KHAN, primaryLocked: true } } }), W_TUE, P, KHAN);
ok(wLock.ok === true && wLock.lockHolder === true, "W: a manual lock on an OR day keeps the holder");
eq(wLock.conflicts, ["hard-never-weekday:Tue"], "W: ...with hard-never-weekday:Tue reported in conflicts (a lock lifts nothing)");
// holiday-unit days: the family is waived there anyway (unchanged) - the row adds nothing and the East rule still holds
blocked(R.eligibility(withRows([row(KHAN, "available", "2026-12-24", "primary")], { eastBusyDays: { [KHAN]: ["2026-12-24"] } }), "2026-12-24", P, KHAN), "east-busy", "W: Christmas Eve (Thu) with a row - hard-never is waived on the unit day anyway, the East day still blocks primary");
// review fix (Prompt 12 W): the BACKUP branch of the rowAvail read - a both-roles hardNeverWeekdays rule
// (hardNeverWeekdaysRoles ["primary","backup"], the openToEveryone=false shape) blocks backup without a row and is
// lifted for backup by a backup_only row or an available/backup row (rdStatic sets RD_MASK.backup for both).
step("Prompt 12 W: a backup_only / available-backup row lifts a both-roles hardNeverWeekdays rule for BACKUP");
const srWBoth = clone(SA.seedToSurgeonRules(seed)); srWBoth[KHAN].hardNeverWeekdaysRoles = ["primary", "backup"];
blocked(R.eligibility(withRows([], { surgeonRules: srWBoth }), W_TUE, B, KHAN), "hard-never-weekday:Tue", "W: roles [primary,backup] - Tuesday backup blocked without a row");
okElig(R.eligibility(withRows([row(KHAN, "backup_only", W_TUE)], { surgeonRules: srWBoth }), W_TUE, B, KHAN), "W: ...a backup_only row lifts it for backup");
okElig(R.eligibility(withRows([row(KHAN, "available", W_TUE, "backup")], { surgeonRules: srWBoth }), W_TUE, B, KHAN), "W: ...an available/backup row lifts it for backup too");
blocked(R.eligibility(withRows([row(KHAN, "backup_only", W_TUE)], { surgeonRules: srWBoth }), W_TUE, P, KHAN), "hard-never-weekday:Tue", "W: ...and a backup_only row lifts nothing for PRIMARY (role-scoped; backup-only-row blocks it as well)");

// ---- Prompt 12 X (9/22 evening) ----
// Faraz: "Acton (s3): never PRIMARY on a Tuesday - promote his Tuesday soft-avoid to a hard primary rule
// (hardNeverWeekdaysRoles primary: ["Tue"]); backup on Tuesdays stays allowed. Any note in an anon-readable table says
// only 'not Tuesdays' - no reason." Data only: surgeonRules.s3.hardNeverWeekdays ["Tue"] + hardNeverWeekdaysRoles
// ["primary"]; the recurringAvoid Tuesday entry left the seed with its note; no *Reason key (a *Reason key becomes a
// category token in the blob). The engine is item W's: the same generic hardNeverWeekdays read, lifted only by his own
// dated available/primary row for that date; a manual/import lock is not a row.
step("Prompt 12 X seed: Acton's Tuesday is a hard PRIMARY rule - no reason key, no soft Tuesday avoid left");
eq(seed.surgeonRules[ACTON].hardNeverWeekdays, ["Tue"], "X seed: s3.hardNeverWeekdays = [Tue]");
eq(seed.surgeonRules[ACTON].hardNeverWeekdaysRoles, ["primary"], "X seed: s3.hardNeverWeekdaysRoles = [primary] (backup on Tuesdays stays allowed)");
ok(!("hardNeverWeekdaysReason" in seed.surgeonRules[ACTON]), "X seed: no hardNeverWeekdaysReason key (no reason may reach the anon-readable blob)");
eq((seed.surgeonRules[ACTON].recurringAvoid || []).map(r => r.weekday), ["Sun"], "X seed: the Tuesday soft avoid (and its note) left; the Sunday avoid stays");
ok(!/family|Tuesday mornings/i.test(JSON.stringify([seed.surgeonRules[ACTON].hardNeverWeekdaysNote, seed.surgeonRules[ACTON].recurringAvoid, seed.surgeonRules[ACTON].notes.filter(n => /Tuesday/i.test(n))])), "X seed: the Tuesday rule carries no reason wording anywhere in s3 (the rules doc is the only place)");
step("Prompt 12 X: Acton PRIMARY on an ordinary Tuesday is hard; BACKUP stays open; his own dated row lifts it (W); the Sunday avoid stays soft");
const X_TUE = "2026-12-01"; // an ordinary Tuesday (December is ungoverned for him; no lock, no holiday)
const xP = R.eligibility(clean, X_TUE, P, ACTON);
blocked(xP, "hard-never-weekday:Tue", "X: Acton PRIMARY on Tue 12/1 is hard");
eq(xP.hard, ["hard-never-weekday:Tue"], "X: ...and that is his only hard reason");
lacksSoft(xP, "recurring-avoid:Tue", "X: no soft Tuesday term for primary either");
const xB = R.eligibility(clean, X_TUE, B, ACTON);
okElig(xB, "X: Acton BACKUP on the same Tuesday needs no row");
lacks(xB.hard, "hard-never-weekday", "X: no hard-never term on his Tuesday backup");
lacksSoft(xB, "recurring-avoid:Tue", "X: no recurring-avoid:Tue soft term remains anywhere for him (checked on a Tuesday backup)");
okElig(R.eligibility(withRows([row(ACTON, "available", X_TUE, "primary")]), X_TUE, P, ACTON), "X/W: a dated available/primary row of his on that Tuesday lifts the block");
blocked(R.eligibility(withRows([row(ACTON, "available", X_TUE, "backup")]), X_TUE, P, ACTON), "hard-never-weekday:Tue", "X/W: a backup-role row lifts nothing for PRIMARY");
blocked(R.eligibility(withRows([row(ACTON, "available", X_TUE, "primary")]), "2026-12-08", P, ACTON), "hard-never-weekday:Tue", "X/W: the row is date-scoped - the next Tuesday stays blocked");
const xSun = R.eligibility(clean, "2027-01-10", P, ACTON);
okElig(xSun, "X: the Sunday before a 2nd Monday is still only avoided"); hasSoft(xSun, "recurring-avoid:Sun", "X: his Sunday avoid still applies (soft)");
eq(xSun.soft.find(s => s.reason === "recurring-avoid:Sun").weight, 3, "X: ...medium (3) for primary as before");
// November (the ER-panel author's locks; not a governed month since Y): his Tuesday entries there are BACKUPS (11/3, 11/17) - locks he holds, untouched by X
["2026-11-03", "2026-11-17"].forEach(d => { const r = R.eligibility(ctx, d, B, ACTON); ok(r.ok === true && r.lockHolder === true && r.conflicts.length === 0, "X: his locked November Tuesday backup " + d + " is unaffected: " + JSON.stringify(r)); });
has(R.eligibility(clean, "2026-11-03", P, ACTON).hard, "hard-never-weekday:Tue", "X: a November Tuesday primary carries the hard-never reason (Y: no whitelist-month beside it any more)");
// a lock is not a row (W): the ER-panel author's published Tue 9/22 primary (the past) keeps its holder, the rule is reported as a conflict
const xLock = R.eligibility(ctx, "2026-09-22", P, ACTON);
ok(xLock.ok === true && xLock.lockHolder === true, "X/W: the published Tue 9/22 primary lock keeps its holder");
has(xLock.conflicts, "hard-never-weekday:Tue", "X/W: ...with hard-never-weekday:Tue in conflicts (a lock lifts nothing)");

// ---- Prompt 12 Y (9/22 evening) ----
// Faraz: "Acton's November list is preferences, not a limit (his 9/17 message gave rules, never dates; the dates came via
// Burchett's relay): remove the November governed-month whitelist for s3. His listed days stay locked; his recurring rules
// govern the rest of November - which makes Thu 11/5 his (primary 11/4-11/6, within his max of 3) with backup from anyone
// eligible. Burchett's November whitelist stays." Data only (seed): s3.explicitListMonths = ["2026-10"], no
// s3.explicitAvailable["2026-11"] block (the importer completes a governed month from the KEY alone), 2026-11-05 = Acton
// primary locked / backup open. The engine is unchanged: rdGovernedMonths + the recurring rules do the rest.
step("Prompt 12 Y seed: Acton's governed months = October (primary) only; Burchett's November object entry stays");
eq(Object.assign({}, ctx.per[ACTON].governedMonths), { "2026-10": 1 }, "Y: Acton governed months - October plain (primary only); November is no longer governed (before Y: '2026-11': 3)");
eq(Object.assign({}, ctx.per[BURCHETT].governedMonths), { "2026-10": 1, "2026-11": 3, "2026-12": 1 }, "Y: Burchett unchanged - his November whitelist stays for both roles");
step("Prompt 12 Y: 11/5 is Acton's locked primary with no conflict - 11/4-11/6 is a run of 3 within his max 3; the backup is open to anyone eligible");
const y5 = R.eligibility(ctx, "2026-11-05", P, ACTON);
ok(y5.ok === true && y5.lockHolder === true, "Y: Acton 11/5 primary is the lock holder (before Y: blocked whitelist-month, and he held the backup): " + JSON.stringify(y5));
eq(y5.conflicts, [], "Y: ...with no conflict - no whitelist-month, no max-consecutive (11/4, 11/5, 11/6 = 3 = his max), no other role");
eq([ctx.schedule["2026-11-05"].primary, ctx.schedule["2026-11-05"].primaryLocked, ctx.schedule["2026-11-05"].backup, ctx.schedule["2026-11-05"].backupLocked], [ACTON, true, null, false], "Y: the seed schedule reads 11/5 = Acton P locked, backup open");
["2026-11-04", "2026-11-06"].forEach(d => { const r = R.eligibility(ctx, d, P, ACTON); ok(r.ok === true && r.lockHolder === true && r.conflicts.length === 0, "Y: his locked " + d + " primary keeps its holder with no max-consecutive conflict (the run is exactly 3): " + JSON.stringify(r)); });
// the run counter is real: a 4th day in a row would be too many (11/7 opened up for the probe; it is Burchett's lock on the seed)
{
  const sched7 = clone(ctx.schedule); sched7["2026-11-07"] = { primary: null, backup: null, primaryLocked: false, backupLocked: false };
  const ctx7 = makeCtx({ schedule: sched7 });
  blocked(R.eligibility(ctx7, "2026-11-07", P, ACTON), "max-consecutive:3", "Y: 11/4-11/6 + 11/7 would be four primaries in a row - blocked by his max 3 (so the run of 3 above is counted, not ignored)");
}
blocked(R.eligibility(ctx, "2026-11-05", B, ACTON), "holds-other-role", "Y: Acton cannot also be 11/5 backup");
okElig(R.eligibility(ctx, "2026-11-05", B, PHILIP), "Y: Philip may take 11/5 backup (backup any day; Aledo restricts primary only)");
okElig(R.eligibility(ctx, "2026-11-05", B, KHAN), "Y: Khan may take 11/5 backup (a Thursday backup is fine since 9/22; East clear in this ctx)");
okElig(R.eligibility(ctx, "2026-11-05", B, FIERCE), "Y: Fierce may take 11/5 backup (Clinton restricts primary only)");
blocked(R.eligibility(ctx, "2026-11-05", B, BURCHETT), "whitelist-month", "Y: Burchett is still whitelist-month blocked - 11/5 is not on his November backup list (his whitelist stays)");
blocked(R.eligibility(ctx, "2026-11-05", B, SARKAR), "outside-window", "Y: Sarkar is outside her window");
ok([KHAN, BURCHETT, ACTON, PHILIP, FIERCE, SARKAR].filter(id => R.eligibility(ctx, "2026-11-05", B, id).ok).length >= 3, "Y: 11/5 backup has eligible surgeons (before Y the day's open slot was the primary, open for nobody)");
step("Prompt 12 Y: the rest of November is Acton's recurring rules again (primary) - restated independently and compared day by day");
{
  // his rules, restated: never Tuesday (X), not the 2nd/4th Monday or Wednesday (outreach), not a vacation day (11/19-22,
  // 11/25-29) nor the day before one (11/18, 11/24), not Thanksgiving (opted out; inside the vacation anyway).
  const nthOf = (d) => Math.floor((+d.slice(8, 10) - 1) / 7) + 1;
  const vac = new Set(["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
  const dayBefore = new Set(["2026-11-18", "2026-11-24"]);
  const expected = [], got = [];
  for (let i = 1; i <= 30; i++) {
    const d = "2026-11-" + (i < 10 ? "0" + i : i), wd = R.rdWeekday(d);
    const allowed = wd !== "Tue" && !((wd === "Mon" || wd === "Wed") && [2, 4].includes(nthOf(d))) && !vac.has(d) && !dayBefore.has(d);
    if (allowed) expected.push(d);
    if (R.eligibility(clean, d, P, ACTON).ok) got.push(d);
  }
  eq(got, expected, "Y: Acton's primary-eligible November days on an empty schedule = exactly his recurring rules (before Y: only the 7 listed dates)");
  eq(expected, ["2026-11-01", "2026-11-02", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-30"], "Y: ...and that set, spelled out (11/5 and 11/12 are the Thursdays; 11/13 the Friday; 11/30 the 5th Monday)");
}
okElig(R.eligibility(ctx, "2026-11-12", P, ACTON), "Y: Thu 11/12 primary is open to Acton on the seed schedule (its backup is Fierce's locked derived week - the other role)");
// Fri 11/13 is open to his RULES (the clean-schedule list above) but not on the seed schedule: his locked 11/14-11/16 run
// would make it a fourth consecutive primary - the same counter that lets 11/4-11/6 stand at exactly 3.
blocked(R.eligibility(ctx, "2026-11-13", P, ACTON), "max-consecutive:3", "Y: Fri 11/13 primary on the seed schedule - blocked only by his max 3 (11/13 + locked 11/14-16 = 4), not by any whitelist");
lacks(R.eligibility(ctx, "2026-11-13", P, ACTON).hard, "whitelist-month", "Y: ...no whitelist-month on 11/13");
blocked(R.eligibility(ctx, "2026-11-10", P, ACTON), "hard-never-weekday:Tue", "Y: Tue 11/10 stays hard (item X), no longer whitelist-month");
lacks(R.eligibility(ctx, "2026-11-10", P, ACTON).hard, "whitelist-month", "Y: ...and whitelist-month is gone from his November reasons");
const y24 = R.eligibility(ctx, "2026-11-24", P, ACTON);
blocked(y24, "hard-never-weekday:Tue", "Y: Tue 11/24 hard (X)"); has(y24.hard, "day-before-vacation", "Y: ...and the day before his 11/25 vacation");
["2026-11-21", "2026-11-22"].forEach(d => blocked(R.eligibility(ctx, d, P, ACTON), "time-off:" + d, "Y: " + d + " is inside his 11/19-22 vacation - his weekend rules do not reach it"));
blocked(R.eligibility(ctx, "2026-11-09", P, ACTON), "recurring-unavailable:Mon", "Y: 2nd Monday 11/9 stays his outreach day (primary)");
okElig(R.eligibility(clean, "2026-11-23", B, ACTON), "Y: backup on his outreach Monday 11/23 is open again (before Y: whitelist-month for backup too; 11/11 would be Fierce's derived week)");
blocked(R.eligibility(ctx, "2026-11-10", P, BURCHETT), "whitelist-month", "Y: Burchett 11/10 primary - still whitelist-month (his November list is unchanged)");
blocked(R.eligibility(ctx, "2026-11-12", P, BURCHETT), "whitelist-month", "Y: Burchett 11/12 primary likewise");
has(R.eligibility(clean, "2026-11-03", P, ACTON).hard, "hard-never-weekday:Tue", "Y: his Tuesday reason stands alone now on 11/3 (an ungoverned November)");
eq(R.eligibility(clean, "2026-11-03", P, ACTON).hard, ["hard-never-weekday:Tue"], "Y: ...exactly one hard reason");

/* ------------------------------------------------ Prompt 12 M: outside surgeons (internal locums) */
// A roster entry of type "external" is written in by hand only: it is in
// rosterById / allIds, in externalIds when active, never in activeIds (the
// generation universe). eligibility() answers the generator path with the hard
// reason external-surgeon; the day editor asks with opts.manual and gets the
// slot facts only (external-cover, slot-locked, holds-other-role, inactive).
step("M: outside surgeons - roster type external");
const G = require("../generator.js");
const LOCUM = { id: "x1", name: "Locum", code: "LOC", fullName: "Locum Tenens", active: true, roles: ["surgeon"], type: "external", note: "covers when asked" };
const LOCUM_OFF = { id: "x2", name: "Retired", code: "RET", active: false, roles: ["surgeon"], type: "external" };
const mRoster = seed.roster.concat([LOCUM, LOCUM_OFF]);
const mSched = clone(ctx.schedule);   // the seed's locked import + Thanksgiving + November rows
mSched["2026-11-10"] = { primary: "x1", backup: null, primaryLocked: true, backupLocked: false, source: "manual-external", externalCover: null, note: null };  // Tue, hand-written primary
mSched["2026-11-12"] = { primary: null, backup: "x1", primaryLocked: false, backupLocked: true, source: "manual-external", externalCover: null, note: null };  // Thu, hand-written backup
const mCtx = makeCtx({ roster: mRoster, schedule: mSched });
ok(mCtx.rosterById.x1 && mCtx.allIds.indexOf("x1") >= 0, "M: an external entry is in rosterById / allIds");
eq(mCtx.activeIds.indexOf("x1"), -1, "M: ...but NOT in activeIds (the generation universe)");
eq(mCtx.externalIds, ["x1"], "M: ctx.externalIds lists the ACTIVE externals only (x2 is inactive)");
eq(mCtx.activeIds, ctx.activeIds, "M: the pool's activeIds are unchanged by the two external entries");
blocked(R.eligibility(mCtx, "2026-11-13", P, "x1"), "external-surgeon", "M: generator path, primary");
blocked(R.eligibility(mCtx, "2026-11-13", B, "x1"), "external-surgeon", "M: generator path, backup");
okElig(R.eligibility(mCtx, "2026-11-13", P, "x1", { manual: true }), "M: manual primary on an open day");
okElig(R.eligibility(mCtx, "2026-11-19", B, "x1", { manual: true }), "M: manual backup on an open day (11/19: 11/13 backup is Fierce's locked week)");
const mMan = R.eligibility(mCtx, "2026-11-13", P, "x1", { manual: true });
eq(mMan.soft, [], "M: the manual path carries no soft terms (no pattern, cap, run or target rule applies to an outside surgeon)");
ok(mMan.external === true, "M: the manual result is flagged external");
blocked(R.eligibility(mCtx, "2026-11-12", P, "x1", { manual: true }), "holds-other-role", "M: manual primary on the day he holds backup");
blocked(R.eligibility(mCtx, "2026-11-03", P, "x1", { manual: true }), "slot-locked:s2", "M: manual primary on a day locked to Burchett");
blocked(R.eligibility(mCtx, "2026-09-30", P, "x1", { manual: true }), "external-cover", "M: manual primary on an Atwell external-cover day");
const mExtB = R.eligibility(mCtx, "2026-09-30", B, "x1", { manual: true });
lacks(mExtB.hard, "external-cover", "M: external-cover never applies to the backup slot on the manual path");
has(mExtB.hard, "slot-locked:s5", "M: ...the backup beside the Atwell cover is judged on its own slot fact (locked to Fierce)");
blocked(R.eligibility(mCtx, "2026-11-13", P, "x2", { manual: true }), "inactive", "M: an inactive external is not assignable by hand either");
const mHeld = R.eligibility(mCtx, "2026-11-10", P, "x1");
ok(mHeld.ok && mHeld.lockHolder === true && (mHeld.conflicts || []).length === 0, "M: the hand-written holder is ok / lockHolder with no conflicts: " + JSON.stringify(mHeld));
blocked(R.eligibility(mCtx, "2026-11-10", P, BURCHETT), "slot-locked:x1", "M: the pool sees his day as locked");
[[PHILIP, B, "2026-11-19"], [KHAN, B, "2026-11-19"], [ACTON, P, "2026-11-13"], [BURCHETT, B, "2026-11-19"]].forEach(([id, role, d]) => eq(R.eligibility(mCtx, d, role, id), R.eligibility(ctx, d, role, id), "M: a pool surgeon's answer is untouched by the two external roster entries (" + id + " " + role + " " + d + ")"));
const mT = R.talliesFor(mCtx, "x1", "2026-11");
eq([mT.primary, mT.backup, mT.total], [1, 1, 2], "M: talliesFor counts an outside surgeon's own held days");
ok(!R.holidayUnitCandidates(mCtx, R.holidayUnits(mCtx, "2026-11-01", "2026-12-31")[0], P).some(id => id === "x1"), "M: holiday-unit candidates never include an external");
ok(!R.weekendUnitPatterns(mCtx, "2026-11-13", P).some(p => JSON.stringify(p.surgeons || p.members || {}).indexOf('"x1"') >= 0), "M: weekend-unit patterns never include an external");
// generator: his held days are fixed input (locked or not), he is never placed, and the open-slot count excludes his days
step("M: generator never touches an outside surgeon");
const mGenSched = clone(mSched);
mGenSched["2026-11-10"].primaryLocked = false;   // held but UNLOCKED: still fixed (design decision c)
const mGenCtx = makeCtx({ roster: mRoster, schedule: mGenSched, rangeStart: "2026-11-02", rangeEnd: "2026-11-15" });
const mGen = G.generate(mGenCtx, "2026-11-02", "2026-11-15", { seed: 1, bestOf: 1 });
const mOut = mGen.schedule;
eq(mOut["2026-11-10"].primary, "x1", "M: the unlocked hand-written primary is kept as a fixed slot");
eq(mOut["2026-11-10"].primaryLocked, false, "M: ...and its lock flag is the input's (unlocked stays unlocked)");
eq(mOut["2026-11-12"].backup, "x1", "M: the locked hand-written backup is kept");
const mStray = Object.keys(mOut).filter(d => (mOut[d].primary === "x1" && d !== "2026-11-10") || (mOut[d].backup === "x1" && d !== "2026-11-12") || mOut[d].primary === "x2" || mOut[d].backup === "x2");
eq(mStray, [], "M: the generator never assigns an external anywhere else");
const mDg = mGen.diagnostics;
ok(!(mDg.lockViolations || []).some(v => v.id === "x1") && !(mDg.fixedViolations || []).some(v => v.id === "x1"), "M: his held days are never reported as lock / fixed violations: " + JSON.stringify((mDg.lockViolations || []).concat(mDg.fixedViolations || []).filter(v => v.id === "x1")));
ok(!Object.prototype.hasOwnProperty.call(mDg.tallies || {}, "x1"), "M: the generator's tallies cover the generation universe only (externals are tallied by the Totals view)");
ok(mDg.impliedTargets.pool.indexOf("x1") < 0 && !mDg.impliedTargets.months["2026-11"].members.x1, "M: not in the equal-share pool and no member row");
// control run without his day: exactly one more open primary slot in November
const mCtrlSched = clone(mGenSched); mCtrlSched["2026-11-10"] = { primary: null, backup: null, primaryLocked: false, backupLocked: false, source: null, externalCover: null, note: null };
const mCtrl = G.generate(makeCtx({ roster: mRoster, schedule: mCtrlSched, rangeStart: "2026-11-02", rangeEnd: "2026-11-15" }), "2026-11-02", "2026-11-15", { seed: 1, bestOf: 1 });
eq(mCtrl.diagnostics.impliedTargets.months["2026-11"].primaryOpen - mDg.impliedTargets.months["2026-11"].primaryOpen, 1, "M: the day an outside surgeon holds is not an open slot (his days reduce the pool's share)");
ok(mCtrl.schedule["2026-11-10"].primary && mCtrl.schedule["2026-11-10"].primary !== "x1", "M: control - without his row the generator fills 11/10 from the pool");

// review 9/22 (M, finding 4): his own vacation is a slot fact on the manual path (the day itself only -
// the trailing-edge day before is a pool pattern rule, not a fact about him)
step("M: an outside surgeon's own vacation is a slot fact on the manual path");
const mVacCtx = makeCtx({ roster: mRoster, schedule: mSched, timeOffRows: SA.seedToTimeOffRows(seed).concat([{ person_id: "x1", start_date: "2026-12-15", end_date: "2026-12-16" }]) });
blocked(R.eligibility(mVacCtx, "2026-12-15", P, "x1", { manual: true }), "time-off:2026-12-15", "M: manual primary on his own vacation day");
blocked(R.eligibility(mVacCtx, "2026-12-16", B, "x1", { manual: true }), "time-off:2026-12-16", "M: manual backup on his own vacation day");
okElig(R.eligibility(mVacCtx, "2026-12-14", P, "x1", { manual: true }), "M: the day before his vacation is not a slot fact (no day-before-vacation for an outside surgeon)");
okElig(R.eligibility(mVacCtx, "2026-12-17", P, "x1", { manual: true }), "M: the day after his vacation is open again");
eq(R.eligibility(mVacCtx, "2026-12-15", P, BURCHETT), R.eligibility(makeCtx({ roster: mRoster, schedule: mSched }), "2026-12-15", P, BURCHETT), "M: a pool surgeon's answer is untouched by the outside surgeon's vacation");

// review 9/22 (M, finding 6): the East derived-week path (Setup -> Rules eastFeed.deriveFrom / statedWeeks) must
// never turn into a generated week for an outside surgeon
step("M: the East derived-week path never assigns an outside surgeon");
const mDerCtx = makeCtx({ roster: mRoster, schedule: {}, eastDerived: DERIVED.concat([{ surgeonId: "x1", weekMonday: "2027-02-01", silvisRole: "backup" }]) });
eq(Object.keys(mDerCtx.derivedByDay).filter(d => mDerCtx.derivedByDay[d].primary === "x1" || mDerCtx.derivedByDay[d].backup === "x1"), [], "M: derivedByDay never names an outside surgeon");
ok(mDerCtx.warnings.some(w => /^eastDerived\[\d+\]: ignored - x1 is an outside surgeon/.test(w)), "M: the ignored derived week is reported in ctx.warnings: " + JSON.stringify(mDerCtx.warnings.filter(w => /x1/.test(w))));
eq(mDerCtx.per.x1.eastDays.size, 0, "M: ...and marks no East days for him");
const mDerCtx2 = makeCtx({ roster: mRoster, schedule: {}, rangeStart: "2027-02-01", rangeEnd: "2027-02-07", eastDerived: [{ surgeonId: "x1", weekMonday: "2027-02-01", silvisRole: "backup" }] });
const mDerGen = G.generate(mDerCtx2, "2027-02-01", "2027-02-07", { seed: 1, bestOf: 1 });
eq(Object.keys(mDerGen.schedule).filter(d => mDerGen.schedule[d].primary === "x1" || mDerGen.schedule[d].backup === "x1"), [], "M: the generator never writes a derived week for an outside surgeon");
ok(!!mDerGen.schedule["2027-02-03"].backup && mDerGen.schedule["2027-02-03"].backupLocked === false, "M: ...the week's backup slots are filled from the pool, unlocked: " + JSON.stringify(mDerGen.schedule["2027-02-03"]));
ok(mDerGen.diagnostics.warnings.some(w => /^eastDerived\[0\]: ignored - x1 is an outside surgeon/.test(w)), "M: ...and the ignored week rides along in the generator's warnings");

// review 9/22 (M, finding 2): a hand-written outside surgeon on one day of a holiday unit must not leave the
// other in-range unit days open - they are filled day by day around him (as a broken weekend unit is)
step("M: a holiday unit broken by a hand-written outside surgeon is filled day by day around him");
const mHolSched = clone(ctx.schedule);
mHolSched["2026-12-25"] = { primary: "x1", backup: null, primaryLocked: true, backupLocked: false, source: "manual-external", externalCover: null, note: null };
const mHolCtx = makeCtx({ roster: mRoster, schedule: mHolSched, rangeStart: "2026-11-02", rangeEnd: "2027-01-03" });
const mHol = G.generate(mHolCtx, "2026-11-02", "2027-01-03", { seed: 1, bestOf: 2 });
eq(mHol.schedule["2026-12-25"].primary, "x1", "M: Christmas Day stays his");
const mEve = mHol.schedule["2026-12-24"];
ok(mEve && mEve.primary && mEve.primary !== "x1", "M: Christmas Eve primary is filled from the pool around him: " + JSON.stringify(mEve));
eq((mHol.diagnostics.uncovered || []).filter(u => u.day === "2026-12-24" && u.role === P), [], "M: 12/24 primary is not an open slot");
ok(mHol.diagnostics.warnings.some(w => /^holiday unit Christmas .*broken by hand-written outside surgeon x1 on 2026-12-25/.test(w)), "M: one warning names the broken unit: " + JSON.stringify(mHol.diagnostics.warnings.filter(w => /broken/.test(w))));
ok(mHol.schedule["2026-12-24"].backup && mHol.schedule["2026-12-24"].backup === mHol.schedule["2026-12-25"].backup, "M: the backup side of the unit is untouched by his primary and stays one holder");
const mHolUnit = (mHol.diagnostics.holidayUnits || []).find(u => /Christmas/.test(u.name) && (u.days || []).indexOf("2026-12-25") >= 0);
ok(mHolUnit && mHolUnit.primaryBrokenBy && mHolUnit.primaryBrokenBy.id === "x1" && mHolUnit.primaryBrokenBy.days[0] === "2026-12-25" && mHolUnit.primaryDaily && mHolUnit.primaryDaily["2026-12-24"] === mEve.primary, "M: the unit diagnostic records the break and the daily fill: " + JSON.stringify(mHolUnit));
// the same for a hand-written BACKUP on the eve (the other role of the unit is one holder as usual)
const mHolSched2 = clone(ctx.schedule);
mHolSched2["2026-12-24"] = { primary: null, backup: "x1", primaryLocked: false, backupLocked: true, source: "manual-external", externalCover: null, note: null };
const mHol2 = G.generate(makeCtx({ roster: mRoster, schedule: mHolSched2, rangeStart: "2026-12-01", rangeEnd: "2027-01-03" }), "2026-12-01", "2027-01-03", { seed: 2, bestOf: 1 });
ok(mHol2.schedule["2026-12-25"].backup && mHol2.schedule["2026-12-25"].backup !== "x1", "M: Christmas Day backup is filled from the pool beside his hand-written eve: " + JSON.stringify(mHol2.schedule["2026-12-25"]));
ok(mHol2.schedule["2026-12-24"].primary && mHol2.schedule["2026-12-24"].primary === mHol2.schedule["2026-12-25"].primary, "M: the primary side of that unit is one holder");

const total = Date.now() - t0;
if (total > 2000) { console.error("FAIL: test file took " + total + " ms (limit 2000)"); process.exit(1); }
console.log("ok " + N + " assertions (" + total + " ms)");
