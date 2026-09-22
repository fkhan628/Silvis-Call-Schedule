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
ok(!rows.some(r => r.person_id === SARKAR && r.kind === "available"), "availableWindows are NOT rows (a window row would have opened her hard-never Friday)");
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
eq(SA.seedToSurgeonRules(seed)[ACTON].explicitListMonths, ["2026-10"]);
eq(SA.seedToSurgeonRules(seed)[PHILIP].explicitListMonths, [{ month: "2026-10", roles: ["primary"] }]);
eq(SA.seedToSurgeonRules(seed)[BURCHETT].explicitListMonths, ["2026-10", "2026-12"]);
eq(SA.seedToTimeOffRows(seed).length, 3, "three vacation rows (Acton x2, Philip x1)");
const sched = SA.seedToSchedule(seed);
eq(sched["2026-09-30"].primaryLocked, true, "externalCover day is primary-locked");
eq(sched["2026-10-15"].primaryLocked, false, "null slot is never locked");
eq(sched["2026-10-15"].backupLocked, false);
eq(sched["2026-11-26"].primaryLocked, true);
eq(sched["2026-11-26"].backupLocked, false);

step("buildContext basics");
eq(ctx.activeIds, [KHAN, BURCHETT, ACTON, PHILIP, FIERCE, SARKAR]);
eq(R.monthlyCapFor(ctx, KHAN).total, null, "explicit null = no cap");
eq(R.monthlyCapFor(ctx, ACTON).total, null, "explicit null = no cap");
eq(R.monthlyCapFor(ctx, PHILIP).total, 8, "absent = group default");
eq(R.monthlyCapFor(ctx, SARKAR).total, 8, "absent = group default");
eq(R.monthlyCapFor(ctx, BURCHETT), { total: 8, preferred: 7 });
eq(R.monthlyCapFor(ctx, FIERCE).total, 14);
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
step("Sarkar windows");
["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"].forEach(d => okElig(R.eligibility(clean, d, P, SARKAR), d));
okElig(R.eligibility(clean, "2026-10-24", P, SARKAR), "Saturday inside the window is fine");
blocked(R.eligibility(clean, "2026-10-23", P, SARKAR), "hard-never-weekday:Fri");
blocked(R.eligibility(clean, "2026-10-23", B, SARKAR), "hard-never-weekday:Fri", "both roles");
blocked(R.eligibility(clean, "2026-10-25", P, SARKAR), "outside-window");
has(R.eligibility(clean, "2026-10-25", P, SARKAR).hard, "hard-never-weekday:Sun");
blocked(R.eligibility(clean, "2026-10-26", P, SARKAR), "outside-window");
blocked(R.eligibility(clean, "2026-11-15", P, SARKAR), "hard-never-weekday:Sun", "every Sunday");
blocked(R.eligibility(clean, "2026-11-22", B, SARKAR), "hard-never-weekday:Sun", "every Sunday, backup too");
okElig(R.eligibility(clean, "2026-11-16", P, SARKAR), "Nov window");
okElig(R.eligibility(clean, "2026-11-21", P, SARKAR), "Nov window Saturday");
blocked(R.eligibility(clean, "2026-12-18", P, SARKAR), "hard-never-weekday:Fri", "Dec window is Mon-Fri but Friday is hard-never");
okElig(R.eligibility(clean, "2026-12-17", P, SARKAR));
blocked(R.eligibility(clean, "2026-12-19", P, SARKAR), "outside-window");
hasSoft(R.eligibility(clean, "2026-10-19", P, SARKAR), "window-week-below-min", "min 3 is a soft bonus while under it");

step("Sarkar window-week max and consecutive");
const sk = makeCtx({ schedule: {
  "2026-10-19": { primary: SARKAR, backup: null },
  "2026-10-20": { primary: null, backup: SARKAR },
  "2026-10-22": { primary: SARKAR, backup: null },
  "2026-10-24": { primary: null, backup: SARKAR }
} });
blocked(R.eligibility(sk, "2026-10-21", P, SARKAR), "window-week-max:4", "5th day in the window week");
lacks(R.eligibility(sk, "2026-10-21", P, SARKAR).hard, "max-consecutive", "backup days do not count toward consecutive");
const sk2 = makeCtx({ schedule: { "2026-10-20": { primary: SARKAR }, "2026-10-21": { primary: SARKAR } } });
blocked(R.eligibility(sk2, "2026-10-22", P, SARKAR), "max-consecutive:2");
hasSoft(R.eligibility(makeCtx({ schedule: { "2026-10-20": { primary: SARKAR } } }), "2026-10-21", P, SARKAR), "handoff-partner");
okElig(R.eligibility(sk2, "2026-10-22", B, SARKAR), "backup after two primaries is legal (primary-only counting)");
// the seed schedule itself: her locked days evaluate as eligible for herself
okElig(R.eligibility(ctx, "2026-10-20", P, SARKAR), "locked self");
okElig(R.eligibility(ctx, "2026-10-24", P, SARKAR), "locked self Saturday");

/* ------------------------------------------------ Burchett */
step("Burchett December list (governed month)");
okElig(R.eligibility(clean, "2026-12-01", P, BURCHETT));
okElig(R.eligibility(clean, "2026-12-09", B, BURCHETT));
okElig(R.eligibility(clean, "2026-12-25", P, BURCHETT), "listed holiday day");
blocked(R.eligibility(clean, "2026-12-02", P, BURCHETT), "whitelist-month");
blocked(R.eligibility(clean, "2026-12-08", B, BURCHETT), "whitelist-month", "1st-Tuesday recurring rule does not apply in a governed month (12/1 is the 1st Tue anyway)");
blocked(R.eligibility(clean, "2026-12-11", P, BURCHETT), "whitelist-month", "unlisted Friday in a governed month");
const dec24 = R.eligibility(clean, "2026-12-24", B, BURCHETT);
okElig(dec24, "Christmas Eve is a holiday-unit day: anyone may cover unless opted out");
hasSoft(dec24, "holiday-waiver:whitelist-month", "but off-list holiday days carry a medium penalty");
step("Burchett January 2027 is NOT whitelist mode");
okElig(R.eligibility(clean, "2027-01-02", P, BURCHETT), "spill-over date is additive");
okElig(R.eligibility(clean, "2027-01-03", B, BURCHETT), "spill-over date is additive");
okElig(R.eligibility(clean, "2027-01-11", P, BURCHETT), "2nd Monday via recurring whitelist");
okElig(R.eligibility(clean, "2027-01-05", P, BURCHETT), "1st Tuesday");
okElig(R.eligibility(clean, "2027-01-13", P, BURCHETT), "2nd Wednesday");
okElig(R.eligibility(clean, "2027-01-09", P, BURCHETT), "weekend via weekendsAvailable");
okElig(R.eligibility(clean, "2027-01-08", B, BURCHETT), "Friday backup via weekendsAvailable");
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
okElig(b8, "8th day is within the cap");
hasSoft(b8, "over-preferred-cap:7", "but above the preferred 7");
bk7["2026-12-19"] = { primary: BURCHETT };
blocked(R.eligibility(makeCtx({ schedule: bk7 }), "2026-12-20", P, BURCHETT), "monthly-cap:8");
blocked(R.eligibility(makeCtx({ schedule: bk7 }), "2026-12-20", B, BURCHETT), "monthly-cap:8", "caps count both roles");

/* ------------------------------------------------ Acton */
step("Acton time off and trailing edge");
["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"].forEach(d => {
  blocked(R.eligibility(ctx, d, P, ACTON), "time-off:" + d);
  blocked(R.eligibility(ctx, d, B, ACTON), "time-off:" + d);
});
blocked(R.eligibility(ctx, "2026-11-18", P, ACTON), "day-before-vacation");
okElig(R.eligibility(ctx, "2026-11-18", B, ACTON), "day before a vacation blocks PRIMARY only");
blocked(R.eligibility(ctx, "2026-11-24", P, ACTON), "day-before-vacation", "before the Thanksgiving-week vacation");
step("Acton recurring blacklist and avoid");
blocked(R.eligibility(clean, "2026-11-09", P, ACTON), "recurring-unavailable:Mon");
blocked(R.eligibility(clean, "2026-11-23", B, ACTON), "recurring-unavailable:Mon");
blocked(R.eligibility(clean, "2026-11-11", P, ACTON), "recurring-unavailable:Wed");
okElig(R.eligibility(clean, "2026-11-16", P, ACTON), "3rd Monday is fine");
okElig(R.eligibility(clean, "2026-11-04", P, ACTON), "1st Wednesday is fine");
const sun8 = R.eligibility(clean, "2026-11-08", P, ACTON);
okElig(sun8); hasSoft(sun8, "recurring-avoid:Sun");
eq(sun8.soft.find(s => s.reason === "recurring-avoid:Sun").weight, 3, "medium = 3");
const tue10 = R.eligibility(clean, "2026-11-10", P, ACTON);
okElig(tue10); hasSoft(tue10, "recurring-avoid:Tue");
lacksSoft(R.eligibility(clean, "2026-11-15", P, ACTON), "recurring-avoid", "Sunday before the 3rd Monday is not avoided");
okElig(R.eligibility(clean, "2026-11-02", B, ACTON), "no cap for Acton");
step("Acton no cap (explicit null)");
const ak = {};
["2026-11-02", "2026-11-03", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-16"].forEach(d => { ak[d] = { backup: ACTON }; });
okElig(R.eligibility(makeCtx({ schedule: ak }), "2026-11-17", B, ACTON), "10th day: no monthly cap for Acton");

/* ------------------------------------------------ Khan */
step("Khan weekdays and East");
blocked(R.eligibility(clean, "2026-11-03", P, KHAN), "hard-never-weekday:Tue");
blocked(R.eligibility(clean, "2026-11-03", B, KHAN), "hard-never-weekday:Tue", "both roles on ordinary days");
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
const fc = makeCtx({ schedule: {}, eastForecast: { [KHAN]: { "2026-11-04": 0.7, "2026-11-11": 0.2, "2026-11-18": 0.5 } } });
blocked(R.eligibility(fc, "2026-11-04", P, KHAN), "east-forecast-busy:0.70");
okElig(R.eligibility(fc, "2026-11-04", B, KHAN), "forecast never blocks backup");
blocked(R.eligibility(fc, "2026-11-18", P, KHAN), "east-forecast-busy", "threshold is inclusive (>= 0.5)");
const fc11 = R.eligibility(fc, "2026-11-11", P, KHAN);
okElig(fc11); hasSoft(fc11, "east-forecast:0.20");
eq(fc11.soft.find(s => s.reason.startsWith("east-forecast")).weight, 2);
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
blocked(R.eligibility(clean, "2026-11-04", B, PHILIP), "outside-available-weeks", "week of 11/2 is not on his list");
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
blocked(R.eligibility(noDerived, "2026-11-10", B, FIERCE), "weekday-pattern:Tue");
blocked(R.eligibility(clean, "2026-11-17", P, FIERCE), "weekday-pattern:Tue", "Tuesday outside a derived week");
blocked(R.eligibility(clean, "2026-11-17", B, FIERCE), "weekday-pattern:Tue");
blocked(R.eligibility(clean, "2026-11-05", B, FIERCE), "weekday-pattern:Thu");
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
blocked(R.eligibility(clean, "2026-11-11", B, BURCHETT), "derived-lock-held:s5", "nobody else takes his derived slot");
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
const capFree = makeCtx({ schedule: {} });
okElig(R.eligibility(capFree, "2026-11-04", P, FIERCE), "7 derived East days + 1 = 8");
const capHit = makeCtx({ schedule: {}, eastBusyDays: { [FIERCE]: ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"] } });
blocked(R.eligibility(capHit, "2026-11-04", P, FIERCE), "monthly-cap:14", "7 derived + 7 East busy = 14, the 15th day is blocked");
blocked(R.eligibility(capHit, "2026-11-30", B, FIERCE), "monthly-cap:14");
okElig(R.eligibility(capHit, "2026-12-02", P, FIERCE), "December is a fresh month");
// distinct days: a Silvis backup on an East day is not counted twice
const capDistinct = makeCtx({ schedule: { "2026-11-09": { backup: FIERCE }, "2026-11-10": { backup: FIERCE } }, eastBusyDays: { [FIERCE]: ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"] } });
okElig(R.eligibility(capDistinct, "2026-11-04", P, FIERCE), "7 + 6 + 1 = 14 exactly");

/* ------------------------------------------------ holidays */
step("Thanksgiving 2026 decisions");
const tg = R.eligibility(ctx, "2026-11-26", P, KHAN);
okElig(tg, "Khan primary on Thanksgiving Thursday: the Thu block is waived");
lacks(tg.hard, "hard-never-weekday");
okElig(R.eligibility(ctx, "2026-11-29", P, KHAN), "4-day unit is one commitment (max consecutive 3)");
okElig(R.eligibility(clean, "2026-11-29", P, KHAN, { assume: ["2026-11-26", "2026-11-27", "2026-11-28"].map(d => ({ date: d, role: P })) }), "unit evaluated with assume");
const noExempt = clone(seed.groupRules); noExempt.holidays.unitExemptFromMaxConsecutive = false;
const ctxNoExempt = R.buildContext(SA.seedToContextInput(seed, { groupRules: noExempt, eastDerived: DERIVED, eastFeedCoverage: EAST_COVER }));
const noEx = R.eligibility(ctxNoExempt, "2026-11-29", P, KHAN);
ok(noEx.ok && noEx.lockHolder === true, "the locked holder stays ok...");
has(noEx.conflicts, "max-consecutive:3", "...but without the unit exemption the 4th locked day is reported as a conflict");
const unlockedTg = {}; ["2026-11-26", "2026-11-27", "2026-11-28"].forEach(d => { unlockedTg[d] = { primary: KHAN }; });
blocked(R.eligibility(R.buildContext(SA.seedToContextInput(seed, { schedule: unlockedTg, groupRules: noExempt, eastDerived: DERIVED, eastFeedCoverage: EAST_COVER })), "2026-11-29", P, KHAN), "max-consecutive:3", "unlocked: without the unit exemption the 4th day breaks his max 3");
okElig(R.eligibility(makeCtx({ schedule: unlockedTg }), "2026-11-29", P, KHAN), "unlocked with the exemption: fine");
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
ok(xmasP.indexOf(ACTON) >= 0 && xmasP.indexOf(PHILIP) >= 0 && xmasP.indexOf(KHAN) >= 0, "Christmas primary candidates include Acton, Philip, Khan: " + xmasP);
ok(xmasP.indexOf(SARKAR) < 0, "Sarkar is outside her window at Christmas");
// unit-wide counting: Burchett with 7 December days already cannot take the 2-day Christmas unit (cap 8)
const bx = {};
["2026-12-01", "2026-12-05", "2026-12-06", "2026-12-09", "2026-12-12", "2026-12-13", "2026-12-14"].forEach(d => { bx[d] = { backup: BURCHETT }; });
ok(R.holidayUnitCandidates(makeCtx({ schedule: bx }), units[1], P).indexOf(BURCHETT) < 0, "a 2-day unit is counted as a whole against the cap");
ok(R.eligibility(makeCtx({ schedule: bx }), "2026-12-25", P, BURCHETT).ok, "...even though each day alone would fit");

/* ------------------------------------------------ external cover and locks */
step("externalCover 2026-09-30");
ctx.activeIds.forEach(id => blocked(R.eligibility(ctx, "2026-09-30", P, id), "external-cover", id));
okElig(R.eligibility(ctx, "2026-09-30", B, FIERCE), "Fierce is the locked backup");
blocked(R.eligibility(ctx, "2026-09-30", B, BURCHETT), "slot-locked:s5");
lacks(R.eligibility(ctx, "2026-09-30", B, BURCHETT, { ignoreLocks: true }).hard, "slot-locked", "ignoreLocks lifts the slot lock");
step("open October slots: 10/15 is open for nobody (rules doc section 8 item 1), both roles, with a reason each");
const OCT15 = "2026-10-15";
const why1015 = { [KHAN]: "hard-never-weekday:Thu", [BURCHETT]: "whitelist-month", [ACTON]: "whitelist-month", [PHILIP]: "time-off:2026-10-15", [FIERCE]: "weekday-pattern:Thu", [SARKAR]: "outside-window" };
ctx.activeIds.forEach(id => blocked(R.eligibility(ctx, OCT15, P, id), why1015[id], id + " primary 10/15"));
ctx.activeIds.forEach(id => blocked(R.eligibility(ctx, OCT15, B, id), why1015[id], id + " backup 10/15"));
has(R.eligibility(ctx, OCT15, B, PHILIP).hard, "no-backup-row", "Philip's own backup exclusion is reported too");
eq(ctx.activeIds.filter(id => R.eligibility(ctx, OCT15, P, id).ok || R.eligibility(ctx, OCT15, B, id).ok), [], "nobody can take 10/15 in either role");
step("Acton/Philip October lists govern (role-scoped)");
blocked(R.eligibility(clean, "2026-10-06", P, ACTON), "whitelist-month", "10/6 is on his BACKUP list only");
okElig(R.eligibility(clean, "2026-10-06", B, ACTON));
blocked(R.eligibility(clean, "2026-10-16", P, ACTON), "whitelist-month", "an unlisted October Friday");
blocked(R.eligibility(clean, "2026-10-16", B, ACTON), "whitelist-month");
okElig(R.eligibility(clean, "2026-10-23", P, ACTON), "10/23 (Burchett 9/18 delta) is on his list");
okElig(R.eligibility(clean, "2026-10-10", P, ACTON), "10/10 (the ER-panel author 9/16 Fri-Sun block) is on his list");
okElig(R.eligibility(clean, "2026-11-02", P, ACTON), "November is not governed for Acton");
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
const wp = R.weekendUnitPatterns(clean, "2026-11-06");
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
ok(wp.every(p => p.members.fri !== SARKAR && p.members.sun !== SARKAR), "saturday-only never on Fri/Sun");
ok(dailies.every(p => p.penalty >= 5), "daily carries weights.patternDaily");
ok(!dailies.some(p => p.members.fri === p.members.sat && p.members.sat === p.members.sun), "block shapes are not repeated as daily");
// Sarkar as the Saturday half inside her November window (weekend of 11/20)
const wpS = R.weekendUnitPatterns(clean, "2026-11-20");
ok(wpS.some(p => p.kind === "split" && p.members.sat === SARKAR), "Sarkar appears as the Saturday member of a split");
ok(!wpS.some(p => p.kind === "block" && p.members.sat === SARKAR), "but never as a block");
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
eq(tNov, { primary: 4, backup: 0, total: 4, weekendDays: 3, majorHolidays: 1, minorHolidays: 0, maxConsecutive: 1 }, "Thanksgiving unit = 4 shifts, 1 major holiday, 1 commitment");
eq(R.talliesFor(ctx, SARKAR, "2026-10").primary, 3);
eq(R.talliesFor(clean, SARKAR, "2026-10"), { primary: 0, backup: 0, total: 0, weekendDays: 0, majorHolidays: 0, minorHolidays: 0, maxConsecutive: 0 });
eq(R.talliesFor(ctx, FIERCE, "2026-09").backup, 3, "Fierce backup 9/28-9/30");

/* ------------------------------------------------ fix round 1 regressions */
const row = (id, kind, date, role, weight) => ({ person_id: id, kind: kind, role: role || "any", start_date: date, end_date: date, weight: weight });
function withRows(extraRows, extras) {
  return R.buildContext(SA.seedToContextInput(seed, Object.assign({ schedule: {}, eastDerived: DERIVED, eastFeedCoverage: EAST_COVER, availabilityRows: SA.seedToAvailabilityRows(seed).concat(extraRows) }, extras || {})));
}

step("fidelity-02/contract-003: a dated available row lifts the pattern family for its role, never hardNeverWeekdays");
const lift = withRows([
  row(ACTON, "available", "2026-11-09", "primary"),
  row(FIERCE, "available", "2026-11-17"),
  row(FIERCE, "available", "2026-11-06", "primary"),
  row(FIERCE, "backup_only", "2026-11-05"),
  row(PHILIP, "available", "2026-11-03", "primary"),
  row(KHAN, "available", "2026-10-15"),
  row(SARKAR, "available", "2026-10-30")
]);
okElig(R.eligibility(lift, "2026-11-09", P, ACTON), "row lifts recurring-unavailable (2nd Monday)");
hasSoft(R.eligibility(lift, "2026-11-08", P, ACTON), "recurring-avoid:Sun", "soft preferences are not lifted");
blocked(R.eligibility(lift, "2026-11-09", B, ACTON), "recurring-unavailable:Mon", "a primary-only row does not free backup");
okElig(R.eligibility(lift, "2026-11-17", P, FIERCE), "row lifts weekday-pattern:Tue");
okElig(R.eligibility(lift, "2026-11-17", B, FIERCE), "any-role row lifts both roles");
okElig(R.eligibility(lift, "2026-11-06", P, FIERCE), "row lifts weekend-block-only (a standalone Friday)");
blocked(R.eligibility(lift, "2026-11-06", B, FIERCE), "weekend-block-only", "primary-only row leaves backup as it was");
okElig(R.eligibility(lift, "2026-11-05", B, FIERCE), "backup_only row lifts the Thursday pattern for backup");
blocked(R.eligibility(lift, "2026-11-05", P, FIERCE), "backup-only-row");
okElig(R.eligibility(lift, "2026-11-03", P, PHILIP), "row lifts day-before-aledo");
blocked(R.eligibility(lift, "2026-10-15", P, KHAN), "hard-never-weekday:Thu", "hardNeverWeekdays is never lifted by a row");
blocked(R.eligibility(lift, "2026-10-15", B, KHAN), "hard-never-weekday:Thu");
blocked(R.eligibility(lift, "2026-10-30", P, SARKAR), "hard-never-weekday:Fri", "Sarkar's Friday stays blocked with a dated row");
lacks(R.eligibility(lift, "2026-10-30", P, SARKAR).hard, "outside-window", "the row does satisfy the window gate");
blocked(R.eligibility(clean, "2026-10-23", P, SARKAR), "hard-never-weekday:Fri", "and without rows her window Friday is blocked (no window rows exist any more)");
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
blocked(R.eligibility(ovrPri, "2026-12-08", B, FIERCE), "weekday-pattern:Tue", "East-backup week overridden: Tue backup falls back to the pattern (Clinton)");
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
blocked(R.eligibility(clean, "2026-11-01", B, PHILIP), "outside-available-weeks", "the primary row does not free backup");
const maskCtx = withRows([row(ACTON, "unavailable", "2026-11-16", "primary"), row(BURCHETT, "unavailable", "2027-01-09", "backup")]);
blocked(R.eligibility(maskCtx, "2026-11-16", P, ACTON), "unavailable-row");
okElig(R.eligibility(maskCtx, "2026-11-16", B, ACTON), "a primary-only unavailable row leaves backup open");
blocked(R.eligibility(maskCtx, "2027-01-09", B, BURCHETT), "unavailable-row");
okElig(R.eligibility(maskCtx, "2027-01-09", P, BURCHETT), "a backup-only unavailable row leaves primary open");

step("tests-06: backup cap lower boundary");
const pb6 = {};
["2026-12-07", "2026-12-08", "2026-12-09", "2026-12-10", "2026-12-11", "2026-12-12"].forEach(d => { pb6[d] = { backup: PHILIP }; });
okElig(R.eligibility(makeCtx({ schedule: pb6 }), "2026-12-21", B, PHILIP), "7th backup day is within the cap");
pb6["2026-12-13"] = { backup: PHILIP };
blocked(R.eligibility(makeCtx({ schedule: pb6 }), "2026-12-21", B, PHILIP), "backup-cap:7", "the 8th is not");

step("tests-07: hardNeverWeekdaysRoles lever");
const srLever = clone(seed.surgeonRules); srLever[KHAN].hardNeverWeekdaysRoles = ["primary"];
const lever = makeCtx({ schedule: {}, surgeonRules: srLever });
blocked(R.eligibility(lever, "2026-11-05", P, KHAN), "hard-never-weekday:Thu");
okElig(R.eligibility(lever, "2026-11-05", B, KHAN), "Thursday backup opens when the roles list is primary-only");
lacks(R.eligibility(lever, "2026-11-05", B, KHAN).hard, "weekday-not-allowed", "the allow-list does not re-block a hardNever day");
okElig(R.eligibility(lever, "2026-11-03", B, KHAN), "Tuesday backup too");
blocked(R.eligibility(clean, "2026-11-05", B, KHAN), "hard-never-weekday:Thu", "seed default: both roles");

step("tests-08: soft penalties that feed the score");
const wkHeld = makeCtx({ schedule: { "2026-11-06": { primary: KHAN }, "2026-11-07": { primary: KHAN }, "2026-11-08": { primary: KHAN } } });
eq(R.eligibility(wkHeld, "2026-11-13", P, KHAN).soft, [{ reason: "back-to-back-weekend", weight: 3 }, { reason: "pattern-mismatch:block", weight: 3 }], "Friday after a full weekend");
eq(R.eligibility(clean, "2026-11-14", P, KHAN).soft, [{ reason: "pattern-mismatch:block", weight: 3 }], "lone Saturday for a block-style surgeon");
eq(R.eligibility(clean, "2026-11-14", P, KHAN, { skipPatternSoft: true }).soft, [], "skipPatternSoft drops the mismatch");
eq(R.eligibility(wkHeld, "2026-11-07", P, KHAN).soft, [], "Saturday inside the held block: no mismatch, no b2b");
eq(R.eligibility(wkHeld, "2026-11-14", P, KHAN).soft, [{ reason: "back-to-back-weekend", weight: 3 }, { reason: "pattern-mismatch:block", weight: 3 }], "lone Saturday the weekend after the held block: both");
eq(R.eligibility(clean, "2026-11-07", P, BURCHETT).soft, [], "split-style surgeon on a lone Saturday: no mismatch");
eq(R.eligibility(clean, "2026-11-06", P, BURCHETT).soft, [], "split-style on Friday with Saturday free: no mismatch");
eq(R.eligibility(makeCtx({ schedule: { "2026-11-07": { primary: BURCHETT } } }), "2026-11-06", P, BURCHETT).soft, [{ reason: "pattern-mismatch:split", weight: 3 }], "split-style holding Sat and asking for Fri: mismatch");
const srTarget = clone(seed.surgeonRules); srTarget[ACTON].monthlyTarget = 2;
const under = R.eligibility(makeCtx({ schedule: {}, surgeonRules: srTarget }), "2026-11-16", P, ACTON);
eq(under.soft.filter(s => s.reason.indexOf("target") >= 0), [{ reason: "under-target", weight: -1 }]);
const over1 = R.eligibility(makeCtx({ schedule: { "2026-11-04": { primary: ACTON }, "2026-11-16": { primary: ACTON } }, surgeonRules: srTarget }), "2026-11-13", P, ACTON);
eq(over1.soft.filter(s => s.reason.indexOf("target") >= 0), [{ reason: "over-target:1", weight: 1 }], "low * 1 over");
const over2 = R.eligibility(makeCtx({ schedule: { "2026-11-04": { primary: ACTON }, "2026-11-16": { primary: ACTON }, "2026-11-12": { primary: ACTON } }, surgeonRules: srTarget }), "2026-11-13", P, ACTON);
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
blocked(R.eligibility(nh, "2026-11-05", B, KHAN), "weekday-not-allowed:Thu");
okElig(R.eligibility(nh, "2026-11-04", P, KHAN));
okElig(R.eligibility(nh, "2026-11-07", P, KHAN), "weekend days are pool days, not on the allow-list");
okElig(R.eligibility(withRows([row(KHAN, "available", "2026-11-03")], { surgeonRules: srNoHard }), "2026-11-03", P, KHAN), "a dated row lifts weekday-not-allowed");
blocked(R.eligibility(withRows([row(KHAN, "available", "2026-11-03", "backup")], { surgeonRules: srNoHard }), "2026-11-03", P, KHAN), "weekday-not-allowed:Tue", "but only for its own role");

step("tests-09: weekend pattern penalty arithmetic and shape dedupe");
const penOf = (kind, f, s, u) => { const p = wp.find(q => q.kind === kind && q.members.fri === f && q.members.sat === s && q.members.sun === u); return p ? p.penalty : null; };
eq(penOf("block", KHAN, KHAN, KHAN), 0, "block-style surgeon in a block");
eq(penOf("block", FIERCE, FIERCE, FIERCE), 0);
eq(penOf("block", BURCHETT, BURCHETT, BURCHETT), null, "Burchett cannot block: max consecutive 2");
eq(penOf("split", BURCHETT, ACTON, BURCHETT), 0, "the designed split pair");
eq(penOf("split", ACTON, BURCHETT, ACTON), 3, "the mirror split costs Acton's recurring-avoid on Sunday 11/8 (before the 2nd Monday)");
eq(R.weekendUnitPatterns(clean, "2026-11-13").find(q => q.kind === "split" && q.members.fri === ACTON && q.members.sat === BURCHETT).penalty, 0, "on a weekend without that Sunday the mirror split is free");
eq(penOf("split", KHAN, BURCHETT, KHAN), 3, "block-style X in a split: one mismatch");
eq(penOf("split", KHAN, ACTON, KHAN), 3);
eq(penOf("split", BURCHETT, KHAN, BURCHETT), 3, "block-style Y on the Saturday: one mismatch");
ok(dailies.every(p => !(p.members.fri === p.members.sun && p.members.fri !== p.members.sat)), "split shapes are not repeated as daily");
eq(Math.min.apply(null, dailies.map(p => p.penalty)), 11, "cheapest daily = patternDaily 5 + Khan Fri mismatch 3 + Burchett Sun mismatch 3");
eq(penOf("daily", KHAN, BURCHETT, BURCHETT), 11);
const softSum = r => r.soft.reduce((a, s) => a + s.weight, 0);
const expectKBA = 5
  + softSum(R.eligibility(clean, "2026-11-06", P, KHAN, { skipPatternSoft: true })) + 3
  + softSum(R.eligibility(clean, "2026-11-07", P, BURCHETT, { skipPatternSoft: true })) + 0
  + softSum(R.eligibility(clean, "2026-11-08", P, ACTON, { skipPatternSoft: true })) + 3;
eq(penOf("daily", KHAN, BURCHETT, ACTON), expectKBA, "daily penalty = patternDaily + per-member mismatch + soft sums");
eq(expectKBA, 14, "Acton's Sunday-before-2nd-Monday avoid (3) is inside it");
const wpD = R.buildContext(SA.seedToContextInput(seed, { schedule: {}, eastDerived: DERIVED, eastFeedCoverage: EAST_COVER, groupRules: Object.assign(clone(seed.groupRules), { weights: Object.assign({}, seed.groupRules.weights, { patternDaily: 9 }) }) }));
eq(Math.min.apply(null, R.weekendUnitPatterns(wpD, "2026-11-06").filter(p => p.kind === "daily").map(p => p.penalty)), 15, "patternDaily weight is read from groupRules.weights");

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
lacks(R.eligibility(manPri, "2026-11-10", B, ACTON).hard, "derived-lock-held", "Acton may take backup: the derived backup lock is moot once Fierce is locked primary");
okElig(R.eligibility(manPri, "2026-11-10", B, ACTON), "Acton backup 11/10 (Tue; not a 2nd/4th Mon/Wed)");
lacks(R.eligibility(manPri, "2026-11-10", B, PHILIP).hard, "derived-lock-held", "Philip too (week of 11/9 is on his list)");
blocked(R.eligibility(manPri, "2026-11-10", B, FIERCE), "holds-other-role", "he cannot also be backup that day");
okElig(R.eligibility(manPri, "2026-11-11", B, FIERCE), "the other derived days stay his");
eq(R.eligibility(manPri, "2026-11-11", B, FIERCE).lockHolder, true, "still the derived lock holder on 11/11");
blocked(R.eligibility(manPri, "2026-11-11", B, BURCHETT), "derived-lock-held:s5", "and still held against everyone else on 11/11 (Burchett: a 2nd Wednesday is on his whitelist, so only the derived lock blocks him)");

const total = Date.now() - t0;
if (total > 2000) { console.error("FAIL: test file took " + total + " ms (limit 2000)"); process.exit(1); }
console.log("ok " + N + " assertions (" + total + " ms)");
