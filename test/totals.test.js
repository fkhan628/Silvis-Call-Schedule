// Silvis Call Schedule - Totals helpers (Prompt 6 Slice F) + notification
// message composers (Slice G) in helpers.js. Pure Node assertions.
//   node test/totals.test.js
const assert = require("node:assert");
const path = require("node:path");
const H = require(path.join(__dirname, "..", "helpers.js"));

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log("ok   " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n     " + String(e && e.message || e).split("\n").join("\n     ")); }
}
const day = (p, b, extra) => Object.assign({ primary: p || null, backup: b || null, primaryLocked: false, backupLocked: false, source: null, externalCover: null, note: null }, extra || {});

console.log("[A] ttTotalsFor - counts, weekend days, external cover");
{
  // Oct 2026: 10/2 Fri, 10/3 Sat, 10/4 Sun, 10/5 Mon ...
  const sched = {
    "2026-10-01": day("s2", "s1"),                 // Thu: s2 primary, s1 backup
    "2026-10-02": day("s1", "s2"),                 // Fri: s1 primary (weekend day)
    "2026-10-03": day("s1", "s2"),                 // Sat
    "2026-10-04": day("s1", "s2"),                 // Sun
    "2026-10-05": day(null, "s1", { externalCover: "Atwell" }), // Mon: external primary, s1 backup
    "2026-10-06": day(null, null, { externalCover: "Atwell" }), // Tue: external, nobody
    "2026-10-09": day("s3", "s1"),                 // Fri: s1 backup on a weekend day
  };
  check("primary / backup / total counted separately; one day = one shift", () => {
    const t = H.ttTotalsFor(sched, "s1", "2026-10-01", "2026-10-31");
    assert.strictEqual(t.primary, 3);
    assert.strictEqual(t.backup, 3);
    assert.strictEqual(t.total, 6);
  });
  check("weekend days = held days on Fri/Sat/Sun (either role)", () => {
    const t = H.ttTotalsFor(sched, "s1", "2026-10-01", "2026-10-31");
    assert.strictEqual(t.weekendDays, 4, "10/2, 10/3, 10/4 primary + 10/9 backup");
    const t2 = H.ttTotalsFor(sched, "s2", "2026-10-01", "2026-10-31");
    assert.strictEqual(t2.weekendDays, 3);
    assert.strictEqual(t2.primary, 1);
    assert.strictEqual(t2.backup, 3);
  });
  check("an externally covered day is nobody's primary (not tallied for anyone)", () => {
    ["s1", "s2", "s3", "Atwell"].forEach(id => {
      const t = H.ttTotalsFor(sched, id, "2026-10-05", "2026-10-06");
      assert.strictEqual(t.primary, 0, id + " primary on external days");
    });
    assert.strictEqual(H.ttTotalsFor(sched, "s1", "2026-10-05", "2026-10-06").backup, 1, "the backup slot beside an external cover still counts");
  });
  check("custom weekend days (groupRules.weekendUnit.days) are honoured", () => {
    const t = H.ttTotalsFor(sched, "s1", "2026-10-01", "2026-10-31", { weekendDays: ["Sat", "Sun"] });
    assert.strictEqual(t.weekendDays, 2);
  });
  check("range outside the schedule / bad input -> zeros", () => {
    const z = H.ttTotalsFor(sched, "s1", "2027-01-01", "2027-01-31");
    assert.deepStrictEqual([z.primary, z.backup, z.total, z.weekendDays, z.maxConsecutive], [0, 0, 0, 0, 0]);
    assert.strictEqual(H.ttTotalsFor(sched, "s1", "2026-10-31", "2026-10-01").total, 0, "reversed range");
    assert.strictEqual(H.ttTotalsFor(null, "s1", "2026-10-01", "2026-10-31").total, 0);
  });
}

console.log("\n[B] max consecutive PRIMARY days across month boundaries");
{
  const sched = {};
  // s4 primary 10/29 .. 11/02 (5 straight days), then 11/05 alone; backup 10/28.
  ["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"].forEach(d => { sched[d] = day("s4", "s1"); });
  sched["2026-10-28"] = day("s1", "s4");
  sched["2026-11-05"] = day("s4", null);
  check("a run crossing 10/31 -> 11/1 reads its full length in October AND November", () => {
    assert.strictEqual(H.ttTotalsFor(sched, "s4", "2026-10-01", "2026-10-31").maxConsecutive, 5);
    assert.strictEqual(H.ttTotalsFor(sched, "s4", "2026-11-01", "2026-11-30").maxConsecutive, 5);
    assert.strictEqual(H.ttTotalsFor(sched, "s4", "2026-10-01", "2026-11-30").maxConsecutive, 5);
  });
  check("backup days do not extend a primary run unless countBackup", () => {
    assert.strictEqual(H.ttTotalsFor(sched, "s4", "2026-10-01", "2026-10-31").maxConsecutive, 5, "10/28 backup is not part of the run");
    assert.strictEqual(H.ttTotalsFor(sched, "s4", "2026-10-01", "2026-10-31", { countBackup: true }).maxConsecutive, 6);
  });
  check("a single day is a run of 1; a surgeon with no primary days is 0", () => {
    assert.strictEqual(H.ttTotalsFor(sched, "s4", "2026-11-04", "2026-11-06").maxConsecutive, 1);
    assert.strictEqual(H.ttTotalsFor(sched, "s1", "2026-10-29", "2026-11-02").maxConsecutive, 0, "s1 is backup only there");
    assert.strictEqual(H.ttTotalsFor(sched, "s1", "2026-10-28", "2026-10-28").maxConsecutive, 1);
  });
  check("ttRunThrough returns 0 off-run and the same length from any day of the run", () => {
    assert.strictEqual(H.ttRunThrough(sched, "s4", "2026-10-27"), 0);
    assert.strictEqual(H.ttRunThrough(sched, "s4", "2026-10-29"), 5);
    assert.strictEqual(H.ttRunThrough(sched, "s4", "2026-11-01"), 5);
  });
}

console.log("\n[C] holiday units - counted once per unit, tier by unit; unit days collapse in runs");
{
  const tg = { name: "Thanksgiving", tier: "major", days: ["2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"] };
  const ny = { name: "New Year's", tier: "major", days: ["2026-12-31", "2027-01-01"] };
  const lab = { name: "Labor Day", tier: "minor", days: ["2026-09-05", "2026-09-06", "2026-09-07"] };
  const byDay = {};
  [tg, ny, lab].forEach(u => u.days.forEach(d => { byDay[d] = u; }));
  const sched = {};
  tg.days.forEach(d => { sched[d] = day("s1", "s2"); });           // s1 primary all 4 Thanksgiving days, s2 backup
  ny.days.forEach(d => { sched[d] = day("s3", "s1"); });           // s3 primary NY, s1 backup
  lab.days.forEach(d => { sched[d] = day("s2", "s3"); });          // s2 primary Labor Day (minor)
  sched["2026-11-25"] = day("s1", null);                           // the day before the unit: s1 primary
  sched["2026-11-30"] = day("s1", null);                           // the day after
  check("a 4-day unit held as primary counts ONE major holiday (not 4)", () => {
    const t = H.ttTotalsFor(sched, "s1", "2026-11-01", "2026-11-30", { holidayByDay: byDay });
    assert.strictEqual(t.majorHolidays, 1);
    assert.strictEqual(t.minorHolidays, 0);
    assert.deepStrictEqual(t.holidayUnits, ["Thanksgiving"]);
    assert.strictEqual(t.primary, 6, "the 4 unit days + 11/25 + 11/30 are still 6 shifts");
  });
  check("backup on a unit counts the unit too; minor units go to minorHolidays", () => {
    const s2 = H.ttTotalsFor(sched, "s2", "2026-09-01", "2026-12-31", { holidayByDay: byDay });
    assert.strictEqual(s2.majorHolidays, 1, "Thanksgiving as backup");
    assert.strictEqual(s2.minorHolidays, 1, "Labor Day as primary");
    assert.strictEqual(s2.weekendDays, 5, "Fri 11/27, Sat 11/28, Sun 11/29 (backup) + Sat 9/5, Sun 9/6 (primary)");
  });
  check("a unit that straddles the year counts once in a range covering both days, and once in each month it touches", () => {
    assert.strictEqual(H.ttTotalsFor(sched, "s1", "2026-12-01", "2027-01-31", { holidayByDay: byDay }).majorHolidays, 1);
    assert.strictEqual(H.ttTotalsFor(sched, "s1", "2026-12-01", "2026-12-31", { holidayByDay: byDay }).majorHolidays, 1);
    assert.strictEqual(H.ttTotalsFor(sched, "s1", "2027-01-01", "2027-01-31", { holidayByDay: byDay }).majorHolidays, 1);
  });
  check("max consecutive: unit days are ONE commitment only when opts.unitCollapse - 11/25 + unit + 11/30 = 3; raw = 6 is the default (Prompt 12 A)", () => {
    assert.strictEqual(H.ttTotalsFor(sched, "s1", "2026-11-01", "2026-11-30", { holidayByDay: byDay }).maxConsecutive, 6, "default: real days");
    assert.strictEqual(H.ttTotalsFor(sched, "s1", "2026-11-01", "2026-11-30", { holidayByDay: byDay, unitCollapse: true }).maxConsecutive, 3, "opted in: the unit is one day");
    assert.strictEqual(H.ttTotalsFor(sched, "s1", "2026-11-01", "2026-11-30", { holidayByDay: byDay, unitExempt: true }).maxConsecutive, 6, "the old opts.unitExempt is not read any more");
    assert.strictEqual(H.ttTotalsFor(sched, "s1", "2026-11-01", "2026-11-30").maxConsecutive, 6, "without the holiday map every day counts");
  });
  check("maxConsecutiveAnyRole: the unit collapse applies to the any-role run the same way (s2 backup on all 4 Thanksgiving days)", () => {
    const s2 = H.ttTotalsFor(sched, "s2", "2026-11-01", "2026-11-30", { holidayByDay: byDay });
    assert.deepStrictEqual([s2.maxConsecutive, s2.maxConsecutiveAnyRole], [0, 4], "no primary run; 4 real backup days");
    const s2c = H.ttTotalsFor(sched, "s2", "2026-11-01", "2026-11-30", { holidayByDay: byDay, unitCollapse: true });
    assert.deepStrictEqual([s2c.maxConsecutive, s2c.maxConsecutiveAnyRole], [0, 1]);
    const s1 = H.ttTotalsFor(sched, "s1", "2026-11-01", "2026-11-30", { holidayByDay: byDay, unitCollapse: true });
    assert.deepStrictEqual([s1.maxConsecutive, s1.maxConsecutiveAnyRole], [3, 3]);
  });
}

console.log("\n[C2] maxConsecutiveAnyRole - the any-role run (primary or backup), real days (Prompt 12 A)");
{
  // Review 9/22 item E: Philip 12/22 P, 12/23-25 B, 12/26-28 P = 7 straight on-call days, 3 straight primaries.
  const sched = {
    "2026-12-22": day("s4", "s1"), "2026-12-23": day("s1", "s4"), "2026-12-24": day("s1", "s4"), "2026-12-25": day("s1", "s4"),
    "2026-12-26": day("s4", "s2"), "2026-12-27": day("s4", "s2"), "2026-12-28": day("s4", "s2"),
    "2026-12-30": day("s4", null)
  };
  check("Philip: maxConsecutive 3 (12/26-28), maxConsecutiveAnyRole 7 (12/22-28); 12/30 alone does not extend either", () => {
    const t = H.ttTotalsFor(sched, "s4", "2026-12-01", "2026-12-31");
    assert.strictEqual(t.maxConsecutive, 3);
    assert.strictEqual(t.maxConsecutiveAnyRole, 7);
  });
  check("the any-role run follows the period edges like the primary run", () => {
    assert.strictEqual(H.ttTotalsFor(sched, "s4", "2026-12-26", "2026-12-31").maxConsecutiveAnyRole, 7, "a period starting mid-run still reads the whole run");
    assert.strictEqual(H.ttTotalsFor(sched, "s4", "2026-12-01", "2026-12-22").maxConsecutiveAnyRole, 7);
    assert.strictEqual(H.ttTotalsFor(sched, "s4", "2026-12-29", "2026-12-31").maxConsecutiveAnyRole, 1, "12/30 alone");
  });
  check("ttRunThrough anyRole: 0 off-run, the run length from any day of it; without anyRole a backup day is 0", () => {
    assert.strictEqual(H.ttRunThrough(sched, "s4", "2026-12-24", { anyRole: true }), 7);
    assert.strictEqual(H.ttRunThrough(sched, "s4", "2026-12-24"), 0, "backup day: not part of a primary run");
    assert.strictEqual(H.ttRunThrough(sched, "s4", "2026-12-28"), 3);
    assert.strictEqual(H.ttRunThrough(sched, "s4", "2026-12-29", { anyRole: true }), 0);
  });
  check("a surgeon with primary and backup interleaved: s1 12/22 B + 12/23-25 P is 3 primary / 4 any-role; s2 12/26-28 B is 0 / 3", () => {
    const s1 = H.ttTotalsFor(sched, "s1", "2026-12-01", "2026-12-31");
    assert.deepStrictEqual([s1.maxConsecutive, s1.maxConsecutiveAnyRole], [3, 4], "s1 backup 12/22 + primary 12/23-25 = 4 any-role");
    const s2 = H.ttTotalsFor(sched, "s2", "2026-12-01", "2026-12-31");
    assert.deepStrictEqual([s2.maxConsecutive, s2.maxConsecutiveAnyRole], [0, 3]);
    const z = H.ttTotalsFor(sched, "s6", "2026-12-01", "2026-12-31");
    assert.deepStrictEqual([z.maxConsecutive, z.maxConsecutiveAnyRole], [0, 0]);
  });
}

console.log("\n[D] ranges, East days, deviation, CSV");
{
  check("ttRangeFor month / ytd (with the 2026-09-14 floor) / rolling 12", () => {
    const m = H.ttRangeFor("month", 2026, 9);
    assert.deepStrictEqual([m.from, m.to, m.label, m.months], ["2026-10-01", "2026-10-31", "Oct 2026", ["2026-10"]]);
    const y = H.ttRangeFor("ytd", 2026, 11, { floors: { "2026": "2026-09-14" } });
    assert.deepStrictEqual([y.from, y.to, y.months], ["2026-09-14", "2026-12-31", ["2026-09", "2026-10", "2026-11", "2026-12"]]);
    const y27 = H.ttRangeFor("ytd", 2027, 2, { floors: { "2026": "2026-09-14" } });
    assert.deepStrictEqual([y27.from, y27.to], ["2027-01-01", "2027-03-31"], "the floor applies to its year only");
    const r = H.ttRangeFor("rolling", 2027, 0);
    assert.deepStrictEqual([r.from, r.to, r.months.length, r.months[0], r.months[11]], ["2026-02-01", "2027-01-31", 12, "2026-02", "2027-01"]);
    assert.ok(/Rolling 12 months \(Feb 2026 - Jan 2027\)/.test(r.label), r.label);
  });
  check("ttDaysIn counts distinct in-range days from a Set, array or object", () => {
    const set = new Set(["2026-11-09", "2026-11-10", "2026-12-01", "bogus"]);
    assert.strictEqual(H.ttDaysIn(set, "2026-11-01", "2026-11-30"), 2);
    assert.strictEqual(H.ttDaysIn(["2026-11-09", "2026-11-09"], "2026-11-01", "2026-11-30"), 1);
    assert.strictEqual(H.ttDaysIn({ "2026-11-09": true }, "2026-11-01", "2026-11-30"), 1);
    assert.strictEqual(H.ttDaysIn(null, "2026-11-01", "2026-11-30"), 0);
  });
  check("ttDeviation: signed text, '-' without a target", () => {
    assert.strictEqual(H.ttDeviation(9, 7), "+2");
    assert.strictEqual(H.ttDeviation(5, 7), "-2");
    assert.strictEqual(H.ttDeviation(7, 7), "0");
    assert.strictEqual(H.ttDeviation(7, null), "-");
    assert.strictEqual(H.ttDeviation(7, undefined), "-");
  });
  check("ttCsvText quotes commas, quotes and newlines; CRLF lines; never a $ in the totals columns", () => {
    const csv = H.ttCsvText(["Surgeon", "Primary", "Note"], [["Khan", 3, "a, b"], ["O'Neil \"x\"", 0, "line1\nline2"]]);
    assert.strictEqual(csv, 'Surgeon,Primary,Note\r\nKhan,3,"a, b"\r\n"O\'Neil ""x""",0,"line1\nline2"\r\n');
    assert.ok(!/\$/.test(csv));
  });
}

console.log("\n[E] notification message composers (data.message for send-notification)");
{
  const req = { from_surgeon_id: "s4", from_surgeon_name: "Philip", to_surgeon_id: "s5", to_surgeon_name: "Fierce", day: "2026-11-05", role: "primary", return_day: "2026-11-12", return_role: "backup" };
  check("slotLabel is day + role: 'Primary - Thu Nov 5'", () => {
    assert.strictEqual(H.slotLabel("2026-11-05", "primary"), "Primary - Thu Nov 5");
    assert.strictEqual(H.slotLabel("2026-11-12", "backup"), "Backup - Thu Nov 12");
  });
  check("propose / accept / decline / applied / cancel compositions", () => {
    assert.strictEqual(H.tradeProposeMsg(req), "Philip proposed a trade: Fierce would take Primary - Thu Nov 5; Philip would take Backup - Thu Nov 12");
    assert.strictEqual(H.tradeAcceptMsg(req), "Fierce accepted the trade: Fierce takes Primary - Thu Nov 5; Philip takes Backup - Thu Nov 12");
    assert.strictEqual(H.tradeDeclineMsg(req), "Fierce declined the trade: Fierce would have taken Primary - Thu Nov 5; Philip would have taken Backup - Thu Nov 12");
    assert.strictEqual(H.tradeAppliedMsg(req), "Trade applied to the schedule: Fierce takes Primary - Thu Nov 5; Philip takes Backup - Thu Nov 12");
    assert.strictEqual(H.tradeCancelMsg(req), "Philip cancelled the trade: Fierce would have taken Primary - Thu Nov 5; Philip would have taken Backup - Thu Nov 12");
    const oneWay = Object.assign({}, req, { return_day: null, return_role: null });
    assert.strictEqual(H.tradeProposeMsg(oneWay), "Philip proposed a trade: Fierce would take Primary - Thu Nov 5 (one-way - no return shift)");
  });
  check("vacationLoggedMsg: '<Name> logged vacation <start>-<end>' (single date collapses; note appended)", () => {
    assert.strictEqual(H.vacationLoggedMsg("Acton", "2026-11-03", "2026-11-05"), "Acton logged vacation 11/3-11/5");
    assert.strictEqual(H.vacationLoggedMsg("Acton", "2026-11-03", "2026-11-03"), "Acton logged vacation 11/3");
    assert.strictEqual(H.vacationLoggedMsg("Acton", "2026-11-03", "2026-11-05", " conference "), "Acton logged vacation 11/3-11/5 (conference)");
  });
  check("manualEditMsg: '10/12 P Philip -> Fierce (by Khan)'", () => {
    assert.strictEqual(H.manualEditMsg(["10/12 P Philip -> Fierce"], "Khan"), "10/12 P Philip -> Fierce (by Khan)");
    assert.strictEqual(H.manualEditMsg(["10/12 P Philip -> Fierce", "10/12 B OPEN -> Acton"], "Khan"), "10/12 P Philip -> Fierce\n10/12 B OPEN -> Acton (by Khan)");
    assert.strictEqual(H.manualEditMsg([], null), "schedule changed");
  });
  check("schedulePublishedMsg: period + change lines, capped with a remainder count", () => {
    assert.strictEqual(H.schedulePublishedMsg("Nov 2 - Jan 3", []), "Call schedule Nov 2 - Jan 3 was published. No slot changes since the last notice.");
    const msg = H.schedulePublishedMsg("Nov 2 - Jan 3", ["11/2 P OPEN -> Acton", "11/3 B OPEN -> Khan", "11/4 P OPEN -> Philip"], 2);
    assert.strictEqual(msg, "Call schedule Nov 2 - Jan 3 was published.\nChanges (3):\n11/2 P OPEN -> Acton\n11/3 B OPEN -> Khan\n... and 1 more");
    assert.strictEqual(H.schedulePublishedMsg("", ["x"]).split("\n")[0], "The call schedule was published.");
  });
  check("no composer output carries a $ sign or an @", () => {
    const all = [H.tradeProposeMsg(req), H.tradeAcceptMsg(req), H.tradeDeclineMsg(req), H.tradeAppliedMsg(req), H.tradeCancelMsg(req), H.vacationLoggedMsg("Acton", "2026-11-03", "2026-11-05", "x"), H.manualEditMsg(["a"], "b"), H.schedulePublishedMsg("p", ["l"])].join("\n");
    assert.ok(!/[$@]/.test(all));
  });
}

console.log("[M] ttOutsideSurgeons - the Totals 'Outside surgeons' section (Prompt 12 M)");
{
  const rosterM = [
    { id: "s1", name: "Khan", code: "FAK" }, { id: "s2", name: "Burchett", code: "MAB" },
    { id: "x1", name: "Locum", code: "LOC", type: "external", active: true },
    { id: "x2", name: "Idle", code: "IDL", type: "external", active: true },
    { id: "x3", name: "Gone", code: "GON", type: "external", active: false },
    { id: "x4", name: "Past", code: "PST", type: "external", active: false },
  ];
  const schedM = {
    "2026-11-10": day("x1", "s1"), "2026-11-13": day("s2", "x1"), "2026-11-14": day("x1", "s1"),
    "2026-11-20": day("x4", "s2"),
    "2026-12-01": day("x1", null),
  };
  check("lists active externals (with or without days) and inactive ones only when they hold a day in the period; never a pool surgeon", () => {
    const rows = H.ttOutsideSurgeons(rosterM, schedM, "2026-11-01", "2026-11-30");
    assert.deepStrictEqual(rows.map(r => r.id), ["x1", "x2", "x4"]);
  });
  check("counts come from ttTotalsFor for the period (primary / backup / total), name / code / active carried", () => {
    const rows = H.ttOutsideSurgeons(rosterM, schedM, "2026-11-01", "2026-11-30");
    const x1 = rows.find(r => r.id === "x1");
    assert.deepStrictEqual([x1.primary, x1.backup, x1.total], [2, 1, 3]);
    assert.deepStrictEqual([x1.name, x1.code, x1.active], ["Locum", "LOC", true]);
    const x2 = rows.find(r => r.id === "x2");
    assert.deepStrictEqual([x2.primary, x2.backup, x2.total], [0, 0, 0]);
    const x4 = rows.find(r => r.id === "x4");
    assert.deepStrictEqual([x4.primary, x4.total, x4.active], [1, 1, false]);
    assert.deepStrictEqual(H.ttOutsideSurgeons(rosterM, schedM, "2026-12-01", "2026-12-31").map(r => [r.id, r.primary]), [["x1", 1], ["x2", 0]], "December: x4 held nothing -> not listed");
  });
  check("no externals in the roster -> an empty list; a bad range or no roster -> an empty list (never throws)", () => {
    assert.deepStrictEqual(H.ttOutsideSurgeons(rosterM.slice(0, 2), schedM, "2026-11-01", "2026-11-30"), []);
    assert.deepStrictEqual(H.ttOutsideSurgeons(rosterM, schedM, "2026-11-30", "2026-11-01"), []);
    assert.deepStrictEqual(H.ttOutsideSurgeons(null, schedM, "2026-11-01", "2026-11-30"), []);
    assert.deepStrictEqual(H.ttOutsideSurgeons(rosterM, null, "2026-11-01", "2026-11-30").map(r => r.total), [0, 0]);
  });
  check("an externalCover day (legacy Atwell) stays nobody's day - it never shows in the outside-surgeon counts", () => {
    const rows = H.ttOutsideSurgeons(rosterM, { "2026-11-03": day(null, "x1", { externalCover: "Atwell" }) }, "2026-11-01", "2026-11-30");
    const x1 = rows.find(r => r.id === "x1");
    assert.deepStrictEqual([x1.primary, x1.backup], [0, 1]);
  });
}

console.log("\n[W] Prompt 32 step 1 (Faraz 10/11) - weighted accounting: the ONE weights helper, the weighted load / share, the rounding fix");
{
  // Faraz 10/11 decision 9: the weighted load counts Silvis days only, primary 1, backup 0.5. The weights are data
  // (groupRules.shiftAccounting.weights) read through ONE helper, rules.js shiftWeightsOf(groupRules), whose default
  // { primary: 1, backup: 0.5 } stands in when the key is null / absent / not a positive number - never
  // groupRules.weights (the soft-penalty table). rules.js holds it because the generator (Node: rules.js only) and the
  // page (a global) both reach it there.
  const fs = require("node:fs");
  const R = require(path.join(__dirname, "..", "rules.js"));
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs", "silvis-seed.json"), "utf8"));
  check("rules.js exports shiftWeightsOf and SHIFT_WEIGHT_DEFAULTS = { primary: 1, backup: 0.5 }", () => {
    assert.strictEqual(typeof R.shiftWeightsOf, "function", "rules.js shiftWeightsOf");
    assert.deepStrictEqual(R.SHIFT_WEIGHT_DEFAULTS, { primary: 1, backup: 0.5 });
  });
  check("the seed carries groupRules.shiftAccounting.weights = { primary: 1, backup: 0.5 } and the helper reads it", () => {
    assert.deepStrictEqual(seed.groupRules.shiftAccounting.weights, { primary: 1, backup: 0.5 });
    assert.deepStrictEqual(R.shiftWeightsOf(seed.groupRules), { primary: 1, backup: 0.5 });
  });
  check("null / absent / an empty object -> the default { primary: 1, backup: 0.5 } (the water-fill fixture's frozen null too)", () => {
    const D = { primary: 1, backup: 0.5 };
    [undefined, null, {}, { shiftAccounting: null }, { shiftAccounting: {} }, { shiftAccounting: { weights: null } }, { shiftAccounting: { weights: {} } }].forEach((g) => assert.deepStrictEqual(R.shiftWeightsOf(g), D, JSON.stringify(g)));
    const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "water-fill-2026-10-07-to-2027-01-03.json"), "utf8"));
    assert.strictEqual(fx.input.groupRules.shiftAccounting.weights, null, "the frozen pre-publish blob keeps its null");
    assert.deepStrictEqual(R.shiftWeightsOf(fx.input.groupRules), D, "the frozen fixture's null reads as the default");
  });
  check("a junk key falls back PER KEY (not a positive finite number: a string, 0, a negative, NaN, Infinity, an array, a boolean)", () => {
    const w = (v) => R.shiftWeightsOf({ shiftAccounting: { weights: v } });
    assert.deepStrictEqual(w("1/0.5"), { primary: 1, backup: 0.5 });
    assert.deepStrictEqual(w([1, 0.5]), { primary: 1, backup: 0.5 });
    assert.deepStrictEqual(w({ primary: "1", backup: 0.25 }), { primary: 1, backup: 0.25 });
    assert.deepStrictEqual(w({ primary: 0, backup: -1 }), { primary: 1, backup: 0.5 });
    assert.deepStrictEqual(w({ primary: NaN, backup: Infinity }), { primary: 1, backup: 0.5 });
    assert.deepStrictEqual(w({ primary: true, backup: null }), { primary: 1, backup: 0.5 });
    assert.deepStrictEqual(w({ primary: 2, backup: 1 }), { primary: 2, backup: 1 }, "valid weights are read as given");
    assert.deepStrictEqual(w({ backup: 0.25 }), { primary: 1, backup: 0.25 }, "a missing key reads the default, the other key is kept");
  });
  check("never read from groupRules.weights (the soft-penalty table) - a primary / backup key there changes nothing", () => {
    assert.deepStrictEqual(R.shiftWeightsOf({ weights: { primary: 9, backup: 9 } }), { primary: 1, backup: 0.5 });
    assert.deepStrictEqual(R.shiftWeightsOf({ weights: { primary: 9 }, shiftAccounting: { weights: { primary: 2 } } }), { primary: 2, backup: 0.5 });
  });
  check("fresh copies: mutating a result leaves the default and the next read untouched", () => {
    const a = R.shiftWeightsOf(null); a.primary = 99; a.backup = 99;
    assert.deepStrictEqual(R.shiftWeightsOf(null), { primary: 1, backup: 0.5 });
    assert.deepStrictEqual(R.SHIFT_WEIGHT_DEFAULTS, { primary: 1, backup: 0.5 });
    const g = { shiftAccounting: { weights: { primary: 2, backup: 1 } } };
    const b = R.shiftWeightsOf(g); b.primary = 7;
    assert.deepStrictEqual(g.shiftAccounting.weights, { primary: 2, backup: 1 }, "the blob's own object is never handed out");
  });
  check("buildContext warns once on a present-but-unreadable shiftAccounting.weights (it fell back silently), never on null / absent / valid / the seed", () => {
    const warn = (g) => R.buildContext({ roster: [{ id: "s1", name: "Khan", code: "FAK", active: true }], surgeonRules: {}, groupRules: g, schedule: {}, today: "2026-10-11" }).warnings.filter((x) => /shiftAccounting\.weights/.test(x));
    assert.strictEqual(warn({ shiftAccounting: { weights: { primary: 0, backup: "half" } } }).length, 1, "one warning for a junk value");
    assert.ok(/primary/.test(warn({ shiftAccounting: { weights: { primary: 0 } } })[0]), "the warning names the key");
    assert.ok(/\{ primary: 1, backup: 0\.5 \}/.test(warn({ shiftAccounting: { weights: "x" } })[0]), "the warning names what it reads instead");
    [{}, { shiftAccounting: { weights: null } }, { shiftAccounting: { weights: { primary: 1, backup: 0.5 } } }, { shiftAccounting: { weights: { backup: 0.25 } } }, seed.groupRules].forEach((g) => assert.strictEqual(warn(g).length, 0, JSON.stringify(g).slice(0, 80)));
  });
  check("ttWeightedLoad(P, B, weights) = P x w.primary + B x w.backup, rounded to one decimal; null without weights", () => {
    const W = { primary: 1, backup: 0.5 };
    assert.strictEqual(H.ttWeightedLoad(7, 3, W), 8.5, "Khan Nov 2026 (9/23 record): 7 P + 3 B");
    assert.strictEqual(H.ttWeightedLoad(10, 3, W), 11.5, "Acton Nov 2026: 10 P + 3 B");
    assert.strictEqual(H.ttWeightedLoad(0, 16, W), 8, "Fierce Nov 2026: 16 B");
    assert.strictEqual(H.ttWeightedLoad(0, 0, W), 0);
    assert.strictEqual(H.ttWeightedLoad(1, 1, { primary: 1, backup: 1 / 3 }), 1.3, "custom weights round to one decimal (1.333.. -> 1.3)");
    assert.strictEqual(H.ttWeightedLoad(3, 3, { primary: 1.1, backup: 0.1 }), 3.6, "no float noise (3.3000000000000003 + 0.30000000000000004)");
    assert.strictEqual(H.ttWeightedLoad(7, 3, null), null);
    assert.strictEqual(H.ttWeightedLoad(7, 3, { primary: 1 }), null, "a weights object without both numbers is not guessed at (the default lives in rules.js only)");
  });
  check("ttWeightedShare(targetP, targetB, weights) = targetP x w.primary + targetB x w.backup (a missing role target reads 0, like the green mark's sum); null with no target or no weights", () => {
    const W = { primary: 1, backup: 0.5 };
    assert.strictEqual(H.ttWeightedShare(5.6, 5.8, W), 8.5);
    assert.strictEqual(H.ttWeightedShare(6, 4, W), 8);
    assert.strictEqual(H.ttWeightedShare(5, null, W), 5, "an explicit primary-only monthlyTarget");
    assert.strictEqual(H.ttWeightedShare(null, 4, W), 2);
    assert.strictEqual(H.ttWeightedShare(null, null, W), null, "no target -> no share");
    assert.strictEqual(H.ttWeightedShare(5.6, 5.8, null), null);
    assert.strictEqual(H.ttWeightedShare(5.7, 5.9, W), 8.7, "one decimal (8.65 -> 8.7, no float noise)");
  });
  check("ttDeviation rounds a non-integer difference to one decimal (no float noise); integer outputs unchanged", () => {
    assert.strictEqual(H.ttDeviation(6, 5.6), "+0.4", "was +0.40000000000000036");
    assert.strictEqual(H.ttDeviation(5, 5.6), "-0.6", "was -0.5999999999999996");
    assert.strictEqual(H.ttDeviation(7, 5.6), "+1.4", "was +1.4000000000000004");
    assert.strictEqual(H.ttDeviation(9, 5.6 + 0.5 * 5.8), "+0.5");
    assert.strictEqual(H.ttDeviation(8.5, 8), "+0.5");
    assert.strictEqual(H.ttDeviation(8, 8.5), "-0.5");
    assert.strictEqual(H.ttDeviation(5.6, 5.6000000000000005), "0", "a float-noise difference reads 0, never -0");
    assert.strictEqual(H.ttDeviation(5, 5.04), "0", "a difference that rounds to zero reads 0, never -0");
    assert.deepStrictEqual([H.ttDeviation(9, 7), H.ttDeviation(5, 7), H.ttDeviation(7, 7), H.ttDeviation(0, 0), H.ttDeviation(7, null)], ["+2", "-2", "0", "0", "-"], "integer outputs unchanged");
  });
  check("the weighted helpers never touch pay: payForDay / payForMonth / payTotalsRows read no weight", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "helpers.js"), "utf8");
    ["function payForDay(", "function payForMonth(", "function payTotalsRows("].forEach((fn) => {
      const a = src.indexOf(fn); assert.ok(a > 0, fn);
      const body = src.slice(a, src.indexOf("\n}\n", a));
      assert.ok(!/weight|shiftWeightsOf|ttWeighted/i.test(body), fn + " reads a weight");
    });
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
