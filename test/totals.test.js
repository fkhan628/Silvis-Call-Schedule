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
  check("max consecutive: unit days are ONE commitment when unitExempt (default) - 11/25 + unit + 11/30 = 3; raw = 6", () => {
    assert.strictEqual(H.ttTotalsFor(sched, "s1", "2026-11-01", "2026-11-30", { holidayByDay: byDay }).maxConsecutive, 3);
    assert.strictEqual(H.ttTotalsFor(sched, "s1", "2026-11-01", "2026-11-30", { holidayByDay: byDay, unitExempt: false }).maxConsecutive, 6);
    assert.strictEqual(H.ttTotalsFor(sched, "s1", "2026-11-01", "2026-11-30").maxConsecutive, 6, "without the holiday map every day counts");
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
