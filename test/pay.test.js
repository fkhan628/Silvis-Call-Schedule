// Silvis Call Schedule - call pay (Faraz 9/27; reverses the 9/21 "no compensation logic" rule). Pure Node assertions.
//   node test/pay.test.js
// [A]-[H] the helpers.js pay model (payForDay / payForMonth / settings / validation / CSV) with OBVIOUSLY FAKE rates
// (stipend 100, weekday call-in 10, weekend/holiday call-in 20, activation 5) - the group's real figures are entered by
// the scheduler in the app and never appear in the repo (test/privacy.test.js A6d). Currency strings are built without a
// literal currency sign followed by digits (CUR below), so the privacy pin's "$ amount" scan stays clean.
// [I] config.js payDb in a vm sandbox (the four read states, no request without a fresh token, 0-row writes refused).
// [J] source pins: who sees the pay UI (payVisible), where the tables are named, what the audit rows carry, and that no
// notification / e-mail / calendar feed / share page / edge function ever mentions pay.
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ROOT = path.join(__dirname, "..");
const H = require(path.join(ROOT, "helpers.js"));

let passed = 0, failed = 0;
const queue = [];   // async checks run one after another (they share the sandbox's fetch stub and localStorage)
function check(name, fn) {
  if (fn.constructor && fn.constructor.name === "AsyncFunction") { queue.push({ name, fn }); return; }
  try { fn(); passed++; console.log("ok   " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n     " + String(e && e.message || e).split("\n").join("\n     ")); }
}
const CUR = String.fromCharCode(36);
const day = (p, b, extra) => Object.assign({ primary: p || null, backup: b || null, primaryLocked: false, backupLocked: false, source: null, externalCover: null, note: null }, extra || {});
// FAKE rates only (see the header).
const FAKE_ROW = { id: "main", stipend_per_shift: 100, weekday_callin_rate: 10, weekend_holiday_callin_rate: 20, activation_rate: 5,
  activation_unit: "hour", weekend_days: ["Sat", "Sun"], holiday_unit_days_are_holidays: true, callin_required_weekday: true, callin_required_weekend_holiday: true };
const settings = (patch) => H.paySettingsFromRow(Object.assign({}, FAKE_ROW, patch || {}));
// Oct 2026: 10/1 Thu, 10/2 Fri, 10/3 Sat, 10/4 Sun, 10/5 Mon. Thanksgiving 2026: Thu 11/26 - Sun 11/29.
const HOLIDAYS = { units: { "2026": H.defaultHolidayUnits(2026) } };
const SCHED = {
  "2026-10-01": day("s1", "s2"), "2026-10-02": day("s1", "s2"), "2026-10-03": day("s1", "s2"), "2026-10-04": day("s2", "s1"),
  "2026-10-05": day(null, "s1", { externalCover: "Atwell" }), "2026-10-06": day("s1", null), "2026-10-20": day("s1", "s3"),
  "2026-11-26": day("s1", "s2"), "2026-11-28": day("s1", "s2"), "2026-01-15": day("s1", "s2"), "2026-12-24": day("s1", "s2"),
};
const log = (d, p, h, extra) => Object.assign({ id: "L-" + d + "-" + p + "-" + h, day: d, person_id: p, hours: h, note: null }, extra || {});
const TODAY = "2026-10-10";
const base = (patch) => Object.assign({ schedule: SCHED, holidays: HOLIDAYS, logs: [], settings: settings(), today: TODAY }, patch || {});

console.log("[A] day kinds - weekday / weekend / holiday, from the settings");
check("Thu is a weekday, Sat / Sun are weekend, Friday is a WEEKDAY by default (flag for Faraz)", () => {
  const s = settings(), hs = H.payHolidaySet(HOLIDAYS);
  assert.strictEqual(H.payDayKind("2026-10-01", s, hs), "weekday");
  assert.strictEqual(H.payDayKind("2026-10-02", s, hs), "weekday", "Friday");
  assert.strictEqual(H.payDayKind("2026-10-03", s, hs), "weekend");
  assert.strictEqual(H.payDayKind("2026-10-04", s, hs), "weekend");
  assert.deepStrictEqual(H.PAY_FLAG_DEFAULTS.weekendDays, ["Sat", "Sun"]);
});
check("Friday becomes a weekend day when added to weekendDays", () => {
  assert.strictEqual(H.payDayKind("2026-10-02", settings({ weekend_days: ["Fri", "Sat", "Sun"] }), {}), "weekend");
});
check("every day of a holiday unit is a holiday (Thanksgiving Thu-Sun, Christmas Eve), and a holiday beats a weekend", () => {
  const s = settings(), hs = H.payHolidaySet(HOLIDAYS);
  assert.strictEqual(H.payDayKind("2026-11-26", s, hs), "holiday", "Thanksgiving Thu");
  assert.strictEqual(H.payDayKind("2026-11-28", s, hs), "holiday", "Thanksgiving Sat - holiday, not weekend");
  assert.strictEqual(H.payDayKind("2026-12-24", s, hs), "holiday", "Christmas Eve");
});
check("holidayUnitDaysAreHolidays = false turns unit days back into weekday / weekend", () => {
  const s = settings({ holiday_unit_days_are_holidays: false }), hs = H.payHolidaySet(HOLIDAYS);
  assert.strictEqual(H.payDayKind("2026-11-26", s, hs), "weekday");
  assert.strictEqual(H.payDayKind("2026-11-28", s, hs), "weekend");
});
check("payHolidaySet reads the blob shape, a unit array and the ctx map", () => {
  assert.strictEqual(H.payHolidaySet(HOLIDAYS)["2026-11-27"], "Thanksgiving");
  assert.strictEqual(H.payHolidaySet([{ name: "X", days: ["2026-10-03"] }])["2026-10-03"], "X");
  assert.strictEqual(H.payHolidaySet({ "2026-10-03": { name: "Y", tier: "minor" } })["2026-10-03"], "Y");
  assert.deepStrictEqual(H.payHolidaySet(null), {});
});

console.log("\n[B] payForDay - components in integer cents");
check("a weekday primary day without a call-in: the stipend only", () => {
  const d = H.payForDay("2026-10-01", "s1", base());
  assert.deepStrictEqual(d.components, { stipend: 10000, callIn: 0, activation: 0 });
  assert.strictEqual(d.totalCents, 10000);
  assert.strictEqual(d.kind, "weekday");
  assert.strictEqual(d.calledIn, false);
  assert.strictEqual(d.projected, false);
  assert.deepStrictEqual(d.missing, []);
});
check("a weekday call-in with 2.75 after-hours hours: stipend + weekday call-in + 2.75 h x activation", () => {
  const d = H.payForDay("2026-10-01", "s1", base({ logs: [log("2026-10-01", "s1", 2.75)] }));
  assert.deepStrictEqual(d.components, { stipend: 10000, callIn: 1000, activation: 1375 });
  assert.strictEqual(d.totalCents, 12375);
  assert.strictEqual(d.hours, 2.75);
  assert.strictEqual(d.quarters, 11);
  assert.strictEqual(d.activations, 1);
});
check("a weekend call-in uses the weekend/holiday rate; several call-ins add their hours, the call-in rate is paid once", () => {
  const d = H.payForDay("2026-10-03", "s1", base({ logs: [log("2026-10-03", "s1", 1.75), log("2026-10-03", "s1", 1.5, { id: "L2" })] }));
  assert.strictEqual(d.kind, "weekend");
  assert.deepStrictEqual(d.components, { stipend: 10000, callIn: 2000, activation: 1625 });
  assert.strictEqual(d.activations, 2);
  assert.strictEqual(d.hours, 3.25);
});
check("a holiday call-in uses the weekend/holiday rate", () => {
  const d = H.payForDay("2026-11-26", "s1", base({ today: "2026-12-01", logs: [log("2026-11-26", "s1", 4)] }));
  assert.strictEqual(d.kind, "holiday");
  assert.strictEqual(d.holiday, "Thanksgiving");
  assert.deepStrictEqual(d.components, { stipend: 10000, callIn: 2000, activation: 2000 });
});
check("a call-in with 0 hours still earns the call-in rate (called in at all), no activation", () => {
  const d = H.payForDay("2026-10-01", "s1", base({ logs: [log("2026-10-01", "s1", 0)] }));
  assert.deepStrictEqual(d.components, { stipend: 10000, callIn: 1000, activation: 0 });
  assert.strictEqual(d.calledIn, true);
});
check("callInRequiredWeekday = false pays the weekday call-in rate on every weekday primary day", () => {
  const d = H.payForDay("2026-10-01", "s1", base({ settings: settings({ callin_required_weekday: false }) }));
  assert.strictEqual(d.components.callIn, 1000);
  const w = H.payForDay("2026-10-03", "s1", base({ settings: settings({ callin_required_weekday: false }) }));
  assert.strictEqual(w.components.callIn, 0, "the weekend flag is separate");
});
check("callInRequiredWeekendHoliday = false pays the weekend/holiday rate on every weekend / holiday primary day", () => {
  const w = H.payForDay("2026-10-03", "s1", base({ settings: settings({ callin_required_weekend_holiday: false }) }));
  assert.strictEqual(w.components.callIn, 2000);
  assert.strictEqual(H.payForDay("2026-10-01", "s1", base({ settings: settings({ callin_required_weekend_holiday: false }) })).components.callIn, 0);
});
check("activationUnit 'activation' pays per call-in, not per hour", () => {
  const d = H.payForDay("2026-10-03", "s1", base({ settings: settings({ activation_unit: "activation" }), logs: [log("2026-10-03", "s1", 1.75), log("2026-10-03", "s1", 6, { id: "L2" })] }));
  assert.strictEqual(d.components.activation, 1000, "2 call-ins x 5");
});
check("quarter-hour arithmetic stays in whole cents (0.25 h x a rate with cents rounds once)", () => {
  const d = H.payForDay("2026-10-01", "s1", base({ settings: settings({ activation_rate: 7.35 }), logs: [log("2026-10-01", "s1", 0.25)] }));
  assert.strictEqual(d.components.activation, 184, "735 x 1 / 4 = 183.75 -> 184");
  assert.ok(Number.isInteger(d.totalCents));
});
check("backup days and externally covered days are unpaid (null); another surgeon's primary day is null", () => {
  assert.strictEqual(H.payForDay("2026-10-04", "s1", base()), null, "s1 backup");
  assert.strictEqual(H.payForDay("2026-10-05", "s1", base()), null, "external cover, s1 backup");
  assert.strictEqual(H.payForDay("2026-10-05", "Atwell", base()), null, "external cover is nobody's");
  assert.strictEqual(H.payForDay("2026-10-01", "s2", base()), null, "s2 is backup that day");
  assert.strictEqual(H.payForDay("2026-10-07", "s1", base()), null, "no schedule row");
  assert.strictEqual(H.payForDay("bad", "s1", base()), null);
});
check("only the person's own logs of that day count", () => {
  const d = H.payForDay("2026-10-01", "s1", base({ logs: [log("2026-10-01", "s2", 3), log("2026-10-02", "s1", 3), log("2026-10-01T00:00:00", "s1", 1)] }));
  assert.strictEqual(d.activations, 1, "a timestamp-shaped day is read by its date");
  assert.strictEqual(d.hours, 1);
});

console.log("\n[C] earned vs projected");
check("today is earned; a later day is projected and counts the stipend only", () => {
  assert.strictEqual(H.payForDay("2026-10-06", "s1", base({ today: "2026-10-06" })).projected, false);
  const f = H.payForDay("2026-10-20", "s1", base());
  assert.strictEqual(f.projected, true);
  assert.deepStrictEqual(f.components, { stipend: 10000, callIn: 0, activation: 0 });
});
check("a projected day counts the call-in part when no call-in is required; logs on a future day are ignored", () => {
  const f = H.payForDay("2026-10-20", "s1", base({ settings: settings({ callin_required_weekday: false }), logs: [log("2026-10-20", "s1", 5)] }));
  assert.deepStrictEqual(f.components, { stipend: 10000, callIn: 1000, activation: 0 });
  assert.strictEqual(f.calledIn, false);
});

console.log("\n[D] missing rates are never 0");
check("no rates at all: every total is null and the missing keys are listed; the counts still show", () => {
  const s = H.paySettingsFromRow({ id: "main" });
  assert.strictEqual(s.state, "unset");
  const d = H.payForDay("2026-10-01", "s1", base({ settings: s, logs: [log("2026-10-01", "s1", 2)] }));
  assert.strictEqual(d.totalCents, null);
  assert.deepStrictEqual(d.components, { stipend: null, callIn: null, activation: null });
  assert.deepStrictEqual(d.missing.sort(), ["activationRate", "callInWeekdayRate", "stipendPerShift"]);
  assert.strictEqual(d.hours, 2);
  const m = H.payForMonth("s1", 2026, 9, base({ settings: s, logs: [log("2026-10-01", "s1", 2)] }));
  assert.strictEqual(m.month.earnedCents, null);
  assert.strictEqual(m.month.primaryDays, 5);
  assert.strictEqual(m.month.calledInDays, 1);
  assert.strictEqual(m.month.hours, 2);
});
check("partial rates: a component whose rate is not needed does not make the day null", () => {
  const s = settings({ weekend_holiday_callin_rate: null, activation_rate: "" });
  assert.strictEqual(s.state, "partial");
  const plain = H.payForDay("2026-10-03", "s1", base({ settings: s }));
  assert.strictEqual(plain.totalCents, 10000, "no call-in -> the weekend rate is not needed");
  const called = H.payForDay("2026-10-03", "s1", base({ settings: s, logs: [log("2026-10-03", "s1", 1)] }));
  assert.strictEqual(called.totalCents, null);
  assert.deepStrictEqual(called.missing.sort(), ["activationRate", "callInWeekendHolidayRate"]);
});

console.log("\n[E] payForMonth - month, YTD, orphans");
check("October: rows per primary day, month + YTD totals split by today", () => {
  const logs = [log("2026-10-01", "s1", 2.75), log("2026-10-03", "s1", 3)];
  const m = H.payForMonth("s1", 2026, 9, base({ logs }));
  assert.deepStrictEqual(m.days.map(d => d.day), ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-06", "2026-10-20"]);
  // earned: 10/1 12375, 10/2 10000, 10/3 13500, 10/6 10000 = 45875; projected: 10/20 10000
  assert.strictEqual(m.month.earnedCents, 45875);
  assert.strictEqual(m.month.projectedCents, 10000);
  assert.strictEqual(m.month.earnedDays, 4);
  assert.strictEqual(m.month.projectedDays, 1);
  assert.strictEqual(m.month.calledInDays, 2);
  assert.strictEqual(m.month.hours, 5.75);
  // YTD adds Jan 15 (10000)
  assert.strictEqual(m.ytd.earnedCents, 55875);
  assert.strictEqual(m.ytd.primaryDays, 6);
  assert.strictEqual(m.ytdFrom, "2026-01-01");
  assert.strictEqual(m.to, "2026-10-31");
});
check("YTD ends at the selected month's last day (a later month's days are not in an earlier month's YTD)", () => {
  const sep = H.payForMonth("s1", 2026, 8, base());
  assert.strictEqual(sep.month.primaryDays, 0);
  assert.strictEqual(sep.ytd.primaryDays, 1, "Jan 15 only");
  const dec = H.payForMonth("s1", 2026, 11, base({ today: "2027-01-05" }));
  assert.strictEqual(dec.ytd.primaryDays, 9, "1/15, five in October, 11/26, 11/28, 12/24");
  assert.strictEqual(dec.ytd.projectedCents, 0);
});
check("orphan logs: a call-in on a day the person is no longer primary is listed, never counted", () => {
  const logs = [log("2026-10-04", "s1", 2), log("2026-10-01", "s1", 1), log("2026-10-04", "s2", 1)];
  const m = H.payForMonth("s1", 2026, 9, base({ logs }));
  assert.deepStrictEqual(m.orphanLogs.map(l => l.day), ["2026-10-04"]);
  assert.strictEqual(m.month.hours, 1);
});
check("payTotalsRows: one row per active pool surgeon, roster order; outside surgeons never; an inactive one only with pay in that year", () => {
  const roster = [{ id: "s1", name: "Khan", code: "FAK" }, { id: "s2", name: "Burchett", code: "MAB" }, { id: "x1", name: "Atwell", type: "external" }, { id: "s9", name: "Gone", active: false }];
  const rows = H.payTotalsRows(roster, 2026, 9, base({ logs: [log("2026-10-04", "s2", 1)] }));
  assert.deepStrictEqual(rows.map(r => r.id), ["s1", "s2"], "s9 has no primary day and no call-in in 2026 - left out");
  assert.ok(rows.every(r => r.inactive === false));
  assert.strictEqual(rows[1].month.primaryDays, 1);
  assert.strictEqual(rows[1].month.earnedCents, 10000 + 2000 + 500);
  assert.deepStrictEqual(H.payTotalsRows(null, 2026, 9, base()), []);
});
check("payTotalsRows keeps an INACTIVE surgeon who earned pay earlier in the year (month + YTD + the CSV), marked inactive", () => {
  const roster = [{ id: "s1", name: "Khan", code: "FAK" }, { id: "s9", name: "Gone", code: "GON", active: false }];
  const sched = Object.assign({}, SCHED, { "2026-03-10": day("s9", "s1"), "2026-10-07": day("s9", "s1") });
  const rows = H.payTotalsRows(roster, 2026, 9, base({ schedule: sched }));
  assert.deepStrictEqual(rows.map(r => r.id), ["s1", "s9"]);
  const gone = rows[1];
  assert.strictEqual(gone.inactive, true);
  assert.strictEqual(gone.month.primaryDays, 1, "10/7");
  assert.strictEqual(gone.ytd.primaryDays, 2, "3/10 + 10/7");
  assert.strictEqual(gone.ytd.earnedCents, 20000);
  assert.strictEqual(H.payCsv(rows, 2026, 9).text.split("\r\n")[2], "2026-10,Gone (inactive),GON,1,0,0,100.00,0.00,200.00,0.00");
  // a call-in in the year without a primary day (an orphan) also keeps him listed; another year's pay does not
  assert.deepStrictEqual(H.payTotalsRows(roster, 2026, 9, base({ logs: [log("2026-10-04", "s9", 1)] })).map(r => r.id), ["s1", "s9"]);
  assert.deepStrictEqual(H.payTotalsRows(roster, 2026, 9, base({ schedule: Object.assign({}, SCHED, { "2025-03-10": day("s9", "s1") }) })).map(r => r.id), ["s1"]);
});

console.log("\n[F] settings row <-> settings");
check("paySettingsFromRow tolerates null, [] and junk (defaults, rates null, state unset)", () => {
  [null, undefined, [], "x", 42, { stipend_per_shift: "abc", weekend_days: "junk", activation_unit: "day", callin_required_weekday: "yes" }].forEach((v) => {
    const s = H.paySettingsFromRow(v);
    assert.strictEqual(s.state, "unset", JSON.stringify(v));
    assert.deepStrictEqual(s.weekendDays, ["Sat", "Sun"]);
    assert.strictEqual(s.activationUnit, "hour");
    assert.strictEqual(s.callInRequiredWeekday, true);
    assert.strictEqual(s.holidayUnitDaysAreHolidays, true);
    H.PAY_RATE_KEYS.forEach(k => assert.strictEqual(s.rates[k], null));
  });
});
check("paySettingsFromRow reads string numerics (numeric columns come back as numbers or strings), a one-row array, a JSON-string weekend list", () => {
  const s = H.paySettingsFromRow([{ stipend_per_shift: "100.00", weekday_callin_rate: 10, weekend_holiday_callin_rate: "20", activation_rate: "5.5", weekend_days: '["Sun","Fri","Sat"]' }]);
  assert.strictEqual(s.state, "set");
  assert.deepStrictEqual(s.rates, { stipendPerShift: 100, callInWeekdayRate: 10, callInWeekendHolidayRate: 20, activationRate: 5.5 });
  assert.deepStrictEqual(s.weekendDays, ["Fri", "Sat", "Sun"], "week order");
  assert.strictEqual(H.paySettingsFromRow({ stipend_per_shift: -1 }).rates.stipendPerShift, null, "out of range = not set");
  assert.deepStrictEqual(H.paySettingsFromRow({ weekend_days: [] }).weekendDays, [], "an empty weekend list is valid");
});
check("paySettingsToRow round-trips, keeps null as null (never 0) and rounds to cents", () => {
  const row = H.paySettingsToRow(settings({ activation_rate: 5.555, weekday_callin_rate: null }));
  assert.strictEqual(row.id, "main");
  assert.strictEqual(row.activation_rate, 5.56);
  assert.strictEqual(row.weekday_callin_rate, null);
  assert.deepStrictEqual(H.paySettingsToRow(H.paySettingsFromRow(row)), row);
  assert.deepStrictEqual(Object.keys(row).sort(), ["activation_rate", "activation_unit", "callin_required_weekday", "callin_required_weekend_holiday", "holiday_unit_days_are_holidays", "id", "stipend_per_shift", "weekday_callin_rate", "weekend_days", "weekend_holiday_callin_rate"]);
});
check("payRatesChanged names the changed keys and carries no value", () => {
  const ch = H.payRatesChanged(FAKE_ROW, Object.assign({}, FAKE_ROW, { stipend_per_shift: 101, weekend_days: ["Fri", "Sat", "Sun"] }));
  assert.deepStrictEqual(ch, ["stipendPerShift", "weekendDays"]);
  assert.ok(ch.every(k => typeof k === "string" && !/\d/.test(k)));
  assert.deepStrictEqual(H.payRatesChanged(null, { id: "main" }), []);
  assert.deepStrictEqual(H.payRatesChanged(null, FAKE_ROW), H.PAY_RATE_KEYS);
});
check("PAY_FLAG_DEFAULTS holds flags only - no number anywhere", () => {
  const walk = (v) => typeof v === "number" ? assert.fail("a number in PAY_FLAG_DEFAULTS") : (v && typeof v === "object" ? Object.values(v).forEach(walk) : null);
  walk(H.PAY_FLAG_DEFAULTS);
});

console.log("\n[G] validation, read states, error words");
const V = (input, patch) => H.payLogValidate(input, Object.assign({ schedule: SCHED, personId: "s1", today: TODAY, logs: [] }, patch || {}));
check("payLogValidate accepts a past primary day with quarter hours and a plain note", () => {
  assert.strictEqual(V({ day: "2026-10-01", hours: 2.25, note: "trauma activation, OR till 2am" }), null);
  assert.strictEqual(V({ day: "2026-10-01", hours: "0", note: "" }), null);
  assert.strictEqual(V({ day: TODAY === "2026-10-10" ? "2026-10-06" : TODAY, hours: 24 }), null);
});
check("payLogValidate refuses: no day, not primary (backup), future, bad hours, over 24 h per day, long / contact-like note", () => {
  assert.match(V({ day: "", hours: 1 }), /Pick the call day/);
  assert.match(V({ day: "2026-10-04", hours: 1 }), /primary only/, "s1 is backup on 10/4");
  assert.match(V({ day: "2026-10-20", hours: 1 }), /after today/);
  ["", null, "abc", -0.25, 24.25, 0.3, 1.1].forEach(h => assert.match(V({ day: "2026-10-01", hours: h }), /quarter-hour/, String(h)));
  assert.match(V({ day: "2026-10-01", hours: 2 }, { logs: [log("2026-10-01", "s1", 23)] }), /at most 24 hours/);
  assert.strictEqual(V({ day: "2026-10-01", hours: 2 }, { logs: [log("2026-10-01", "s1", 23, { id: "E" })], editingId: "E" }), null, "editing a row replaces its own hours");
  assert.match(V({ day: "2026-10-01", hours: 1, note: "x".repeat(201) }), /200 characters/);
  assert.match(V({ day: "2026-10-01", hours: 1, note: "reach me a@b" }), /contact data/);
  assert.match(V({ day: "2026-10-01", hours: 1, note: "call 5551234567" }), /contact data/);
});
check("payReadFailureState: a missing table is 'unavailable', every other failure 'failed'", () => {
  assert.strictEqual(H.payReadFailureState(404, '{"code":"PGRST205","message":"Could not find the table \'public.call_pay_logs\' in the schema cache"}'), "unavailable");
  assert.strictEqual(H.payReadFailureState(404, '{"code":"42P01","message":"relation \\"public.call_pay_logs\\" does not exist"}'), "unavailable");
  assert.strictEqual(H.payReadFailureState(400, 'relation "public.call_pay_settings" does not exist'), "unavailable");
  assert.strictEqual(H.payReadFailureState(500, "PGRST205"), "failed");
  assert.strictEqual(H.payReadFailureState(401, "JWT expired"), "failed");
  assert.strictEqual(H.payReadFailureState(403, "permission denied"), "failed");
  assert.strictEqual(H.payReadFailureState(404, "<html>not found</html>"), "failed", "a 404 without the token is not a missing table");
  assert.strictEqual(H.payReadFailureState(400, '{"code":"42703","details":null,"hint":null,"message":"column call_pay_logs.xyz does not exist"}'), "failed", "a missing COLUMN (400 42703) is a real failure, not 'available after the next update'");
  assert.strictEqual(H.payReadFailureState(400, 'column "xyz" does not exist'), "failed");
  assert.strictEqual(H.payReadFailureState(400, 'relation "public.schedule_days" does not exist'), "failed", "only a pay table's absence is 'unavailable'");
  assert.strictEqual(H.payReadFailureState(404, '{"code":"PGRST204","message":"Could not find the column"}'), "failed");
});
console.log("\n[G2] year-aware view state - another year's call-ins are never shown as this year's");
{
  const S0 = { settings: "unread", logs: "unread", loadedYear: null, attemptYear: null, settingsLoaded: false };
  const OK = (rows) => ({ state: "ok", rows: rows || [], row: null });
  const after = (prev, y, st, lg) => H.payStateAfterRead(H.payStateBeforeRead(prev, y), y, st, lg);
  check("payViewState: nothing read yet -> loading; 'unavailable' wins over everything", () => {
    assert.strictEqual(H.payViewState(null, 2026), "loading");
    assert.strictEqual(H.payViewState(S0, 2026), "loading");
    assert.strictEqual(H.payViewState(Object.assign({}, S0, { logs: "unavailable", loadedYear: 2026, attemptYear: 2026 }), 2026), "unavailable");
    assert.strictEqual(H.payViewState(Object.assign({}, S0, { settings: "unavailable", logs: "ok", loadedYear: 2026, attemptYear: 2026 }), 2026), "unavailable");
  });
  check("a loaded year reads ok; the same year after a failed refresh reads stale (the rows ARE that year's)", () => {
    const s26 = after(S0, 2026, OK(), OK());
    assert.deepStrictEqual(s26, { settings: "ok", settingsLoaded: true, logs: "ok", loadedYear: 2026, attemptYear: 2026 });
    assert.strictEqual(H.payViewState(s26, 2026), "ok");
    const stale = after(s26, 2026, OK(), { state: "failed" });
    assert.strictEqual(H.payViewState(stale, 2026), "stale");
  });
  check("year mismatch: 2026 held, 2025 requested -> loading while in flight, never ok", () => {
    const s26 = after(S0, 2026, OK(), OK());
    const inFlight = H.payStateBeforeRead(s26, 2025);
    assert.strictEqual(inFlight.logs, "unread");
    assert.strictEqual(H.payViewState(inFlight, 2025), "loading");
    assert.strictEqual(H.payViewState(s26, 2025), "loading", "even without a read started (Totals' year differs for a render)");
  });
  check("year mismatch + failed read -> failed (not ok with no call-ins)", () => {
    const s = after(after(S0, 2026, OK(), OK()), 2025, OK(), { state: "failed" });
    assert.strictEqual(s.loadedYear, 2026);
    assert.strictEqual(H.payViewState(s, 2025), "failed");
    assert.strictEqual(H.payViewState(S0.logs && after(S0, 2025, OK(), { state: "failed" }), 2025), "failed", "a first read that failed");
  });
  check("year mismatch + skipped read (no fresh token) -> skipped, not a carried-over ok", () => {
    const s = after(after(S0, 2026, OK(), OK()), 2025, { state: "skipped" }, { state: "skipped" });
    assert.strictEqual(s.logs, "skipped");
    assert.strictEqual(H.payViewState(s, 2025), "skipped");
    assert.strictEqual(s.settings, "ok", "the settings read before stays");
    const first = after(S0, 2026, { state: "skipped" }, { state: "skipped" });
    assert.strictEqual(H.payViewState(first, 2026), "skipped", "a skipped FIRST read is not an endless 'Loading'");
    assert.strictEqual(first.settings, "skipped");
    const same = after(after(S0, 2026, OK(), OK()), 2026, { state: "skipped" }, { state: "skipped" });
    assert.strictEqual(H.payViewState(same, 2026), "ok", "same year: a skip keeps what is held");
  });
  check("switching back to the held year reads ok at once (its rows are held), and a later answer settles it", () => {
    const s = after(after(S0, 2026, OK(), OK()), 2025, OK(), { state: "failed" });
    const back = H.payStateBeforeRead(s, 2026);
    assert.strictEqual(H.payViewState(back, 2026), "ok");
  });
  check("out-of-order answers: only the latest request's answer is applied (the caller's sequence check), so the view matches the year shown", () => {
    // 2026 -> 2025 -> 2026: requests A(2025) and B(2026) both in flight; B answers first, A late. The component drops A (seq).
    let s = after(S0, 2026, OK(), OK());
    let seq = 0; const reqA = { y: 2025, seq: ++seq }; s = H.payStateBeforeRead(s, 2025);
    const reqB = { y: 2026, seq: ++seq }; s = H.payStateBeforeRead(s, 2026);
    const land = (req, st, lg) => { if (req.seq !== seq) return; s = H.payStateAfterRead(s, req.y, st, lg); };
    land(reqB, OK(), OK());
    land(reqA, OK(), OK());   // late, dropped
    assert.strictEqual(s.loadedYear, 2026);
    assert.strictEqual(H.payViewState(s, 2026), "ok");
    // without the sequence check the late answer would move loadedYear to 2025 and 2026 would read "loading" again
    assert.strictEqual(H.payViewState(H.payStateAfterRead(s, 2025, OK(), OK()), 2026), "loading");
  });
  check("payRatesView: a rates read that never succeeded is failed / loading - never 'rates not set yet'", () => {
    assert.strictEqual(H.payRatesView(Object.assign({}, S0, { settings: "failed" }), null), "failed");
    assert.strictEqual(H.payRatesView(Object.assign({}, S0, { settings: "skipped" }), null), "failed");
    assert.strictEqual(H.payRatesView(S0, null), "loading");
    assert.strictEqual(H.payRatesView(Object.assign({}, S0, { settings: "ok", settingsLoaded: true }), null), "unset");
    assert.strictEqual(H.payRatesView(Object.assign({}, S0, { settings: "failed", settingsLoaded: true }), FAKE_ROW), "set", "a failed refresh keeps the rates loaded before");
    assert.strictEqual(H.payRatesView(Object.assign({}, S0, { settings: "ok", settingsLoaded: true }), { id: "main", stipend_per_shift: 100 }), "partial");
  });
}
check("payErrorText maps the guard tokens, RLS and a 0-row answer to words", () => {
  assert.match(H.payErrorText({ message: "PY001 PAY_FUTURE: ..." }), /after today/);
  assert.match(H.payErrorText('{"code":"PY002","message":"PAY_NOT_PRIMARY: ..."}'), /primary only/);
  assert.match(H.payErrorText("PY003"), /24 hours/);
  assert.match(H.payErrorText({ code: "23514", message: "violates check constraint" }), /quarter hours/);
  assert.match(H.payErrorText("42501 new row violates row-level security policy"), /Not allowed/);
  assert.match(H.payErrorText("0 rows: the call-in was not changed"), /Nothing changed/);
  assert.strictEqual(H.payErrorText({ message: "PGRST205" }), H.PAY_UNAVAILABLE_TEXT);
  assert.match(H.payErrorText("boom"), /connection/);
});
check("payLogAuditText names the person, the day and the hours - never an amount", () => {
  assert.strictEqual(H.payLogAuditText("logged", "Khan", { day: "2026-10-03", hours: 1.5 }), "Call-in logged: Khan Sat 10/3, 1.5 h");
  assert.ok(!/\$|USD/.test(H.payLogAuditText("deleted", "Khan", { day: "2026-10-03", hours: 2 })));
});

console.log("\n[H] money + CSV");
check("payMoney formats cents in en-US currency and null as '-'", () => {
  assert.strictEqual(H.payMoney(123450), CUR + "1,234.50");
  assert.strictEqual(H.payMoney(0), CUR + "0.00");
  assert.strictEqual(H.payMoney(null), "-");
  assert.strictEqual(H.payMoney(undefined), "-");
});
check("payCsv: file name, header, plain 2-decimal amounts, no currency sign, an unset amount left empty", () => {
  const roster = [{ id: "s1", name: "Khan", code: "FAK" }, { id: "s2", name: "Burchett", code: "MAB" }];
  const rows = H.payTotalsRows(roster, 2026, 9, base({ logs: [log("2026-10-01", "s1", 2.75)] }));
  const c = H.payCsv(rows, 2026, 9);
  assert.strictEqual(c.name, "silvis-pay-2026-10.csv");
  const lines = c.text.split("\r\n");
  assert.strictEqual(lines[0], "Month,Surgeon,Code,Primary days,Called-in days,Hours,Earned (month),Projected (month),YTD earned,YTD projected");
  assert.strictEqual(lines[1], "2026-10,Khan,FAK,5,1,2.75,423.75,100.00,523.75,100.00");
  assert.ok(!c.text.includes(CUR));
  const unset = H.payCsv(H.payTotalsRows(roster, 2026, 9, base({ settings: H.paySettingsFromRow(null) })), 2026, 9);
  assert.strictEqual(unset.text.split("\r\n")[1], "2026-10,Khan,FAK,5,0,0,,,,");
});

console.log("\n[I] config.js payDb (sandboxed)");
{
  const sandbox = {
    console: { log() {}, warn() {}, error() {} }, atob: (s) => Buffer.from(s, "base64").toString("binary"), btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    localStorage: { _m: {}, getItem(k) { return this._m[k] === undefined ? null : this._m[k]; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } },
    navigator: { userAgent: "node" }, Date, JSON, Math, Object, Array, String, Number, Boolean, RegExp, Error, Promise, encodeURIComponent, setTimeout, clearTimeout,
    __fetch: null,
  };
  sandbox.fetch = (...a) => sandbox.__fetch(...a);
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "config.js"), "utf8"), sandbox, { filename: "config.js" });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "helpers.js"), "utf8"), sandbox, { filename: "helpers.js" });
  const payDb = vm.runInContext("payDb", sandbox);
  const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => (typeof body === "string" ? JSON.parse(body) : body), text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "");
  const FRESH = "h." + b64({ sub: "u1", exp: Math.floor(Date.now() / 1000) + 3600 }) + ".s";
  const STALE = "h." + b64({ sub: "u1", exp: Math.floor(Date.now() / 1000) - 60 }) + ".s";
  const calls = [];
  const serve = (fn) => { calls.length = 0; sandbox.__fetch = async (url, init) => { calls.push({ url: String(url), init: init || {} }); return fn(String(url), init || {}); }; };
  check("no token / a stale token -> 'skipped', and NO request goes out (never an anon read of pay data)", async () => {
    serve(() => resp(200, []));
    sandbox.localStorage._m = {};
    assert.strictEqual((await payDb.loadSettings()).state, "skipped");
    sandbox.localStorage._m = { "silvis-auth-token": STALE };
    assert.strictEqual((await payDb.loadLogs({ from: "2026-01-01", to: "2026-12-31" })).state, "skipped");
    assert.strictEqual(calls.length, 0);
  });
  check("ok: the settings row (or null), the logs with the person filter and the user's JWT", async () => {
    sandbox.localStorage._m = { "silvis-auth-token": FRESH };
    serve((url) => resp(200, /call_pay_settings/.test(url) ? [{ id: "main" }] : [{ id: "a", day: "2026-10-01", person_id: "s1", hours: 1 }]));
    const s = await payDb.loadSettings();
    assert.strictEqual(s.state, "ok");
    assert.strictEqual(s.row.id, "main");
    assert.match(calls[0].url, /\/rest\/v1\/call_pay_settings\?select=\*&id=eq\.main$/);
    assert.strictEqual(calls[0].init.headers.Authorization, "Bearer " + FRESH);
    const l = await payDb.loadLogs({ personId: "s1", from: "2026-01-01", to: "2026-12-31" });
    assert.strictEqual(l.state, "ok");
    assert.strictEqual(l.rows.length, 1);
    assert.match(calls[1].url, /call_pay_logs\?select=\*&day=gte\.2026-01-01&day=lte\.2026-12-31&person_id=eq\.s1&order=day\.asc,created_at\.asc,id\.asc&limit=1000&offset=0$/);
    serve(() => resp(200, []));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await payDb.loadSettings())), { state: "ok", row: null });
    const all = await payDb.loadLogs({ personId: null, from: "2026-01-01", to: "2026-12-31" });
    assert.ok(!/person_id=/.test(calls[1].url), "the scheduler's read names no person");
    assert.strictEqual(all.rows.length, 0, "a real empty answer is ok + []");
  });
  check("the call-in read PAGES past PostgREST's max-rows (a capped 200 must not drop the latest days); the settings read does not", async () => {
    sandbox.localStorage._m = { "silvis-auth-token": FRESH };
    const page = (n, from) => Array.from({ length: n }, (_, i) => ({ id: "r" + (from + i), day: "2026-10-01", person_id: "s1", hours: 1 }));
    serve((url) => { const off = Number((url.match(/offset=(\d+)/) || [])[1]); return resp(200, off === 0 ? page(1000, 0) : off === 1000 ? page(1000, 1000) : page(7, 2000)); });
    const l = await payDb.loadLogs({ from: "2026-01-01", to: "2026-12-31" });
    assert.strictEqual(l.state, "ok");
    assert.strictEqual(l.rows.length, 2007);
    assert.deepStrictEqual(calls.map(c => (c.url.match(/offset=(\d+)/) || [])[1]), ["0", "1000", "2000"]);
    assert.strictEqual(new Set(l.rows.map(r => r.id)).size, 2007);
    serve((url) => /offset=1000/.test(url) ? resp(500, "boom") : resp(200, page(1000, 0)));
    assert.strictEqual((await payDb.loadLogs({ from: "2026-01-01", to: "2026-12-31" })).state, "failed", "a failing later page fails the whole read (never a truncated ok)");
    serve(() => resp(200, [{ id: "main" }]));
    await payDb.loadSettings();
    assert.ok(!/limit=|offset=/.test(calls[0].url), "the one-row settings read is not paged");
  });
  check("unavailable: the missing-table 404 (PGRST205) - never an empty ok", async () => {
    sandbox.localStorage._m = { "silvis-auth-token": FRESH };
    serve(() => resp(404, '{"code":"PGRST205","details":null,"hint":null,"message":"Could not find the table \'public.call_pay_logs\' in the schema cache"}'));
    assert.strictEqual((await payDb.loadLogs({ from: "2026-01-01", to: "2026-12-31" })).state, "unavailable");
    assert.strictEqual((await payDb.loadSettings()).state, "unavailable");
  });
  check("failed: a 500, a 403, a non-array body, a network error, missing dates", async () => {
    sandbox.localStorage._m = { "silvis-auth-token": FRESH };
    serve(() => resp(500, "boom"));
    assert.strictEqual((await payDb.loadSettings()).state, "failed");
    serve(() => resp(403, '{"code":"42501"}'));
    assert.strictEqual((await payDb.loadSettings()).state, "failed");
    serve(() => resp(200, { message: "not a list" }));
    assert.strictEqual((await payDb.loadSettings()).state, "failed");
    serve(() => { throw new Error("offline"); });
    const n = await payDb.loadSettings();
    assert.strictEqual(n.state, "failed");
    assert.match(n.error, /offline/);
    assert.strictEqual((await payDb.loadLogs({ from: "x", to: "2026-12-31" })).state, "failed");
  });
  check("writes: update / delete with 0 rows come back refused; a real row comes back ok; saveSettings upserts on id", async () => {
    sandbox.localStorage._m = { "silvis-auth-token": FRESH };
    serve(() => resp(200, []));
    assert.match((await payDb.updateLog("a", { hours: 2 })).error, /^0 rows/);
    assert.match((await payDb.deleteLog("a")).error, /^0 rows/);
    assert.strictEqual(calls[1].init.method, "DELETE");
    assert.match(calls[1].url, /call_pay_logs\?id=eq\.a$/);
    serve(() => resp(200, [{ id: "a", hours: 2 }]));
    assert.strictEqual((await payDb.updateLog("a", { hours: 2 })).error, null);
    assert.strictEqual((await payDb.deleteLog("a")).error, null);
    serve(() => resp(201, [{ id: "n1", day: "2026-10-01" }]));
    const add = await payDb.addLog({ day: "2026-10-01", person_id: "s1", hours: 1 });
    assert.strictEqual(add.error, null);
    assert.strictEqual(add.data.id, "n1");
    serve(() => resp(403, '{"code":"42501","message":"new row violates row-level security policy"}'));
    assert.match((await payDb.addLog({ day: "2026-10-01", person_id: "s2", hours: 1 })).error, /42501|row-level/);
    serve(() => resp(201, ""));
    await payDb.saveSettings({ id: "main" });
    assert.match(calls[0].url, /call_pay_settings\?on_conflict=id$/);
    assert.strictEqual(calls[0].init.method, "POST");
  });
}

console.log("\n[J] source pins - who sees pay, where the tables are named, what never carries pay");
const SRC = fs.readFileSync(path.join(ROOT, "index-source.html"), "utf8");
const CFG = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
const HLP = fs.readFileSync(path.join(ROOT, "helpers.js"), "utf8");
check("payVisible: never on the public page, never while the profile failed to load; the scheduler, or a surgeon-role account linked to a roster id", () => {
  assert.ok(SRC.includes('const payVisible = !isPublicMode && !profileLoadFailed && (isScheduler || (userProfile?.role === "surgeon" && !!mySurgeon));'), "the payVisible expression changed");
  const at = SRC.indexOf("const payVisible = ");
  ["const [isScheduler", "const isPublicMode", "const mySurgeon", "const [profileLoadFailed"].forEach((n) => assert.ok(SRC.indexOf(n) >= 0 && SRC.indexOf(n) < at, n + " must be declared before payVisible (no TDZ read)"));
});
check("the pay UI is rendered only behind payVisible (My pay) / isScheduler (Setup) / payVisible && isScheduler (Totals > Pay)", () => {
  const cardUses = Array.from(SRC.matchAll(/<PayCard\b/g)).map(m => m.index);
  assert.strictEqual(cardUses.length, 1, "one PayCard use");
  assert.ok(/\{payVisible && \(pid === mySurgeon \|\| isScheduler\) && pid && <PayCard\b/.test(SRC), "PayCard behind payVisible and the viewer's own id (or the scheduler)");
  const ratesUses = Array.from(SRC.matchAll(/<PayRatesCard\b/g)).map(m => m.index);
  assert.strictEqual(ratesUses.length, 1, "one PayRatesCard use");
  const SETUP_OPEN = '{view==="setup" && !isPublicMode && isScheduler && <>';
  const setupAt = SRC.indexOf(SETUP_OPEN);
  assert.ok(setupAt > 0 && SRC.indexOf(SETUP_OPEN, setupAt + 1) < 0, "exactly one scheduler-only Setup block opener: " + SETUP_OPEN);
  const setupEnd = SRC.indexOf("{view===", setupAt + SETUP_OPEN.length);
  assert.ok(setupEnd > setupAt, "the Setup block's end (the next {view=== block)");
  const setupBlock = SRC.slice(setupAt, setupEnd);
  assert.ok(ratesUses[0] > setupAt && ratesUses[0] < setupEnd, "PayRatesCard sits INSIDE the scheduler-only Setup block (view===\"setup\" && !isPublicMode && isScheduler)");
  const closeAt = setupBlock.indexOf("\n        </>}");   // the block's own closer (its opener's indentation)
  assert.ok(closeAt > 0 && closeAt === setupBlock.lastIndexOf("\n        </>}"), "the Setup block closes once with </>} at its opener's indentation");
  assert.ok(ratesUses[0] < setupAt + closeAt, "PayRatesCard sits before the Setup block's closing </>}");
  assert.ok(/\{payVisible && isScheduler && modeBtn\("pay", "Pay"\)\}/.test(SRC), "the Totals > Pay mode button renders only for the scheduler");
  assert.ok(/const modeEff = mode === "pay" && !\(payVisible && isScheduler\) \? "month" : mode;/.test(SRC), "a stale 'pay' mode falls back to month for anyone else");
});
check("a year switch never shows another year's call-ins: loadPay drops a stale answer (sequence + account) and the cards gate on payViewState", () => {
  const lp = SRC.slice(SRC.indexOf("const loadPay = async (year, explicit) => {"), SRC.indexOf("// Another account on this page"));
  assert.ok(/const seq = \+\+paySeqRef\.current;/.test(lp), "loadPay numbers its request");
  assert.ok(/setPayState\(prev => payStateBeforeRead\(prev, y\)\);\n\s*const \[st, lg\] = await/.test(lp), "loadPay marks the year loading BEFORE the await");
  assert.ok(/await Promise\.all\([^\n]*\);\n\s*if \(gen !== payGenRef\.current \|\| seq !== paySeqRef\.current\) return;/.test(lp), "right after the await, an answer that is not the latest request (or another account's) is dropped");
  assert.ok(/setPayState\(prev => payStateAfterRead\(prev, y, st, lg\)\);/.test(lp), "the state after the answer is helpers.js payStateAfterRead");
  const card = SRC.slice(SRC.indexOf("function PayCard("), SRC.indexOf("function PayRatesCard("));
  const vsAt = card.indexOf("const vs = payViewState(state, year);");
  assert.ok(vsAt > 0 && /if \(vs === "failed" \|\| vs === "skipped" \|\| vs === "loading"\) return /.test(card), "PayCard returns before any figure unless the call-ins held are this year's");
  assert.ok(card.indexOf("pay-total-month") > vsAt && card.indexOf("pay-log-form") > vsAt, "totals and the log form render only after the payViewState gate");
  const panel = SRC.slice(SRC.indexOf("function PayTotalsPanel("), SRC.indexOf("// ---- end call pay components"));
  const pvs = panel.indexOf("const vs = payViewState(state, year);");
  assert.ok(pvs > 0 && panel.indexOf("pay-csv") > pvs && /if \(vs === "failed" \|\| vs === "skipped" \|\| vs === "loading"\) return /.test(panel), "Totals > Pay (and its CSV) render only after the payViewState gate");
  assert.ok(/data-testid="pay-csv" onClick=\{exportPay\} disabled=\{state\.loadedYear !== Number\(year\)\}/.test(panel), "the pay CSV is disabled unless the rows held are this year's");
  assert.ok(/data-testid="pay-totals-refresh"/.test(panel), "Totals > Pay offers Refresh in the loading / failed / skipped states");
  assert.ok(/<PayCard key=\{pid\} /.test(SRC), "PayCard is keyed by the person (an open edit never carries over to another surgeon)");
  assert.ok(/payRatesNote\(ratesView, T, true\)/.test(card) && /const ratesView = payRatesView\(state, settingsRow\);/.test(card) && /payRatesNote\(ratesView, T, false\)/.test(panel), "both views show a failed rates read as failed (payRatesView), never 'not set yet'");
  assert.ok(/Note \(optional - no patient or contact details\)/.test(card), "the call-in note asks for no patient and no contact details");
});
check("the pay tables are named only in config.js payDb", () => {
  const files = ["index-source.html", "helpers.js", "rules.js", "generator.js", "east-feed.js", "app-styles.js", "importer.js"].filter(f => fs.existsSync(path.join(ROOT, f)));
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");   // comments may explain the tables
  files.forEach(f => assert.ok(!/call_pay_/.test(code(fs.readFileSync(path.join(ROOT, f), "utf8"))), f + " names a call_pay_ table in code (only config.js payDb may)"));
  const pd = CFG.slice(CFG.indexOf("const payDb = {"), CFG.indexOf("\n};", CFG.indexOf("const payDb = {")));
  const outside = CFG.replace(pd, "");
  assert.ok(!/call_pay_/.test(outside.replace(/^\/\/[^\n]*$/gm, "")), "config.js names a call_pay_ table outside payDb");
});
check("the pay audit rows carry keys / days / hours only - never an amount", () => {
  assert.ok(/logAudit\("pay\.rates", "Pay rates updated", \{ changed \}\)/.test(SRC), "pay.rates carries { changed } only");
  const logs = Array.from(SRC.matchAll(/logAudit\("pay\.log\.(add|edit|delete)"[^;]*;/g)).map(m => m[0]);
  assert.strictEqual(logs.length, 3, "pay.log.add / edit / delete");
  logs.forEach(l => { assert.ok(/payLogAuditText\(/.test(l), l); assert.ok(!/Cents|payMoney|rate/i.test(l), "an amount in " + l); });
});
check("no pay in notifications, e-mails, calendar feeds, the share page or the edge functions", () => {
  const fnDir = path.join(ROOT, "edge-functions");
  fs.readdirSync(fnDir).forEach(d => {
    const f = path.join(fnDir, d, "index.ts");
    if (fs.existsSync(f)) assert.ok(!/call_pay|payFor|stipend|PayCard|pay_rate/i.test(fs.readFileSync(f, "utf8")), "edge-functions/" + d + " mentions pay");
  });
  const body = (name) => { const at = HLP.indexOf("function " + name + "("); assert.ok(at >= 0, name); const next = HLP.indexOf("\nfunction ", at + 10); return HLP.slice(at, next < 0 ? HLP.length : next); };
  ["generateShareHTML", "buildICSEvents", "generateICS", "openShiftsEmail", "tradeProposeMsg", "tradeAcceptMsg", "tradeDeclineMsg", "tradeAppliedMsg", "tradeCancelMsg", "vacationLoggedMsg", "manualEditMsg", "schedulePublishedMsg", "tradeGiveEmail"].forEach(n => {
    assert.ok(!/\bpay[A-Z]|PAY_|stipend|call_pay/.test(body(n)), n + " mentions pay");
  });
  const addNotif = Array.from(SRC.matchAll(/addNotification\([^;]*;/g)).map(m => m[0]);
  addNotif.forEach(c => assert.ok(!/\bpay[A-Z]|stipend|Cents/.test(c), "a notification carries pay: " + c.slice(0, 120)));
});
check("the pay UI lives in module-scope components styled by THEME tokens (no hex colours in PayCard / PayRatesCard / PayTotalsPanel)", () => {
  const at = SRC.indexOf("const PAY_KIND_WORD = ");
  const end = SRC.indexOf("// ---- end call pay components", at);
  assert.ok(at > 0 && end > at && SRC.indexOf("function PayCard(") > at, "PAY_KIND_WORD ... PayCard ... end marker");
  const block = SRC.slice(at, end);
  ["function PayCard(", "function PayRatesCard(", "function PayTotalsPanel("].forEach(n => assert.ok(block.includes(n), n));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(block), "a hex colour inside the pay components");
  assert.ok(block.includes("PAY_UNAVAILABLE_TEXT") && block.includes("PAY_RATES_UNSET_TEXT"), "the unavailable / rates-not-set words come from helpers");
});

(async () => {
  if (queue.length) console.log("\n[I, async] config.js payDb checks");
  for (const q of queue) {
    try { await q.fn(); passed++; console.log("ok   " + q.name); }
    catch (e) { failed++; console.log("FAIL " + q.name + "\n     " + String(e && e.stack || e).split("\n").join("\n     ")); }
  }
  console.log(`\npay.test.js: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
