// Silvis - Faraz 11/11: a derived week, a holiday unit and the surgeon's own vacation (the two calls he made on the
// Prompt 34 preview, and the 11/12 follow-up). Its own chain and workflow step since 11/22: the block lived in
// test/generator-regression.js until Prompt 37's review, where its 114 runs cost about half a second locally and about
// a second on the slowest hosted runners - with Prompt 37's backup-target runs added, that file would have gone over its
// 10 s wall-clock budget there (a failing assertion by design), so this block moved out, as the water-fill case did
// (painting has had its own step from the start). Nothing in it changed: the same contexts, runs and assertions,
// restated from the seed and the inputs alone - plus one count of the runs at the end (the fix check: with a loop
// emptied the file would still have printed ok; inside the regression the count was printed, never asserted). The few
// names it needs from the regression's prelude are copied below (the harness, the date helpers, the roster constants).
//
// Wall clock: SILVIS_GEN_BUDGET_MS (shared with the regression, water-fill, painting and holidays) overrides the
// default 4000 ms; the budget is a failing assertion, never a warning.
// Run: node test/derived-weeks.test.js   (exit 1 on the first failing assertion, with the case it was in)
"use strict";
const fs = require("fs");
const path = require("path");
const R = require("../rules.js");
const SA = require("./seed-adapter.js");
const GEN = require("../generator.js");

const T_FILE = Date.now();
const BUDGET_MS = process.env.SILVIS_GEN_BUDGET_MS ? Math.floor(+process.env.SILVIS_GEN_BUDGET_MS) : 4000;
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs", "silvis-seed.json"), "utf8"));

/* ------------------------------------------------------------ harness */
let N = 0;
const CUR = { range: "-", seed: "-", day: "-" };
function fail(msg) {
  console.error("FAIL [range " + CUR.range + " seed " + CUR.seed + " day " + CUR.day + "]: " + msg);
  process.exit(1);
}
function ok(cond, msg) { N++; if (!cond) fail(msg); }
function eq(a, b, msg) { N++; if (JSON.stringify(a) !== JSON.stringify(b)) fail(msg + " expected " + JSON.stringify(b) + " got " + JSON.stringify(a)); }

/* ------------------------------------------------------- date helpers */
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pad2 = (n) => (n < 10 ? "0" : "") + n;
const dayNum = (s) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000);
const fromDayNum = (n) => { const d = new Date(n * 86400000); return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate()); };
const wdi = (s) => ((dayNum(s) + 3) % 7 + 7) % 7; // Mon = 0
const weekday = (s) => WD[wdi(s)];
const daysList = (a, b) => { const out = []; for (let n = dayNum(a); n <= dayNum(b); n++) out.push(fromDayNum(n)); return out; };

/* ------------------------------------------------------------ roster */
const byCode = (code) => { const r = seed.roster.find((x) => x.code === code); if (!r) throw new Error("no roster entry with code " + code); return r.id; };
const KHAN = byCode("FAK"), ACTON = byCode("BDA"), FIERCE = byCode("NF");
const IDS = seed.roster.filter((r) => r.active !== false).map((r) => r.id);
const CODE = {}; seed.roster.forEach((r) => { CODE[r.id] = r.code; });
const NAME = {}; seed.roster.forEach((r) => { NAME[r.id] = r.name; });
const SR = seed.surgeonRules;
const P = "primary", B = "backup";

/* ---------------------- Faraz 11/11: a derived week, a holiday unit and his own vacation */
// Two calls Faraz made on the Prompt 34 preview (11/11), restated here from the seed and the inputs alone - never from
// ctx.derivedUnitDays / ctx.derivedVacationYields, which are what is being checked:
//  (1) "Give Fierce Memorial Day": a holiday unit with a day in a derived week is the derived surgeon's in that role on ALL
//      its days. His primary week of 2027-05-24 ends Sun 5/30 and the seed's Memorial Day unit runs Sat 5/29 - Mon 5/31:
//      every day 5/24..5/31 is his locked primary (source east-derived) and the day after is not his (the 8-day lock run
//      counts against his run limit). The same for his backup week of 2027-08-30 and Labor Day (Sat 9/4 - Mon 9/6).
//  (2) "Don't put him on if he has a vacation listed": the primary week of 2027-03-29 over a vacation that starts on its
//      Thursday (fixture dates, 4/1 - 4/7) - Thu - Sun are filled by someone else, or open with reasons that never cite
//      his derived lock, and he holds nothing on a vacation day. Faraz 11/12 ("he can be primary at Silvis that week
//      now"): the day BEFORE a vacation does not yield - he holds Mon, Tue and Wed 3/31, and that Wednesday is his one
//      lock violation (day-before-vacation), said in a warning. The same week with a vacation that starts the Monday
//      after it (fixture dates, 4/5 - 4/9): all seven days are his, Sunday 4/4 the one lock violation. The 11/11
//      reading (the day before yields too) is data - groupRules.eastFeed.derivedWeeks.yieldDayBefore, exactly true -
//      and is run as well, with the cases that pin the kept-day line's own conditions (the 11/12 review; seeds 1 and 2).
const DW_RUNS = { n: 0 };
{
  const WEEKS = [{ weekMonday: "2027-03-29", surgeonId: FIERCE, silvisRole: P }, { weekMonday: "2027-05-24", surgeonId: FIERCE, silvisRole: P }, { weekMonday: "2027-08-30", surgeonId: FIERCE, silvisRole: B }];
  const VAC = { start: "2027-04-01", end: "2027-04-07" };
  const vacDays = daysList(VAC.start, VAC.end);
  const unitDays = (name) => { const u = (seed.holidays.units["2027"] || []).find((x) => x.name === name); if (!u) fail("the seed has no " + name + " 2027 unit"); return u.days.slice().sort(); };
  const MEM = unitDays("Memorial Day"), LAB = unitDays("Labor Day");
  eq([MEM, LAB], [["2027-05-29", "2027-05-30", "2027-05-31"], ["2027-09-04", "2027-09-05", "2027-09-06"]], "seed: the 2027 Memorial Day and Labor Day units run Sat - Mon");
  eq([SR[FIERCE].maxConsecutiveDays, SR[FIERCE].holidayUnitCountsAsOneDay, seed.groupRules.dayBeforeRules.trailingEdgeRoles], [7, false, [P]], "seed: Fierce's run limit is 7 real days and the day before a vacation is a primary rule");
  eq(seed.groupRules.eastFeed.derivedWeeks.yieldDayBefore, false, "seed: the day before a vacation does not move a derived week (yieldDayBefore false)");
  const ctxOf = (extra) => {
    const c = R.buildContext(SA.seedToContextInput(seed, Object.assign({ eastDerived: WEEKS, eastBusyDays: {}, schedule: {} }, extra)));
    if (c.warnings.length) fail("buildContext warnings (derived-week runs): " + JSON.stringify(c.warnings));
    return c;
  };
  const vacCtx = ctxOf({ timeOffRows: [{ person_id: FIERCE, start_date: VAC.start, end_date: VAC.end }] }), plainCtx = ctxOf({});
  // Faraz 11/12: a vacation that starts the Monday after the week (fixture dates), and the 11/11 reading as data
  const VAC_ROW = { person_id: FIERCE, start_date: VAC.start, end_date: VAC.end }, MON_ROW = { person_id: FIERCE, start_date: "2027-04-05", end_date: "2027-04-09" };
  const monCtx = ctxOf({ timeOffRows: [MON_ROW] });
  const grDW = (over) => Object.assign({}, seed.groupRules, { eastFeed: Object.assign({}, seed.groupRules.eastFeed, { derivedWeeks: Object.assign({}, seed.groupRules.eastFeed.derivedWeeks, over) }) });
  const GR_NOKEY = Object.assign({}, seed.groupRules, { eastFeed: Object.assign({}, seed.groupRules.eastFeed) }); delete GR_NOKEY.eastFeed.derivedWeeks;
  const heldRow = (primary, locked) => ({ primary, backup: null, primaryLocked: !!locked, backupLocked: false, source: "manual", externalCover: null, note: null });
  // Faraz 11/12 (held initials - display only): what rules.derivedPending names on the run's INPUT rows is what the run
  // seeds - every pending slot of a day in the range comes out as his locked slot. The display's claim, in the default mode
  // and one way only (a slot an unlocked row holds is not pending, and a default run still clears and seeds it; the narrow
  // corner rules.js names - a unit's added day behind fixed rows without a lock flag - is not claimed); the count is returned.
  const pendingSeeded = (name, c, run, from, to) => {
    let n = 0;
    daysList(from, to).forEach((d) => { const p = R.derivedPending(c, c.schedule, d); [P, B].forEach((role) => { const id = p[role]; if (!id) return; n++; const e = run.schedule[d]; ok(!!e && e[role] === id && e[role + "Locked"] === true, name + ": " + d + " " + role + " is pending for " + id + " on the input rows but the run did not seed it as his lock - " + JSON.stringify(e && [e[role], e[role + "Locked"]])); }); });
    return n;
  };
  const GR_EDGE = Object.assign({}, seed.groupRules, { eastFeed: Object.assign({}, seed.groupRules.eastFeed, { derivedWeeks: Object.assign({}, seed.groupRules.eastFeed.derivedWeeks, { yieldDayBefore: true }) }) });
  const edgeCtx = ctxOf({ timeOffRows: [{ person_id: FIERCE, start_date: VAC.start, end_date: VAC.end }], groupRules: GR_EDGE });
  const EDGE_LINE = (monday, role, days) => "vacation: the derived week of " + monday + " (" + NAME[FIERCE] + " Silvis " + role + ") keeps him on " + days.join(", ") + ", the day before his vacation - the day before a vacation does not move a derived week (lockViolations / fixedViolations list it)";
  const isHis = (e, role) => !!e && e[role] === FIERCE && e[role + "Locked"] === true;
  const common = (name, D, lv) => {
    eq(D.hardViolations, [], name + ": hard violations");
    ok(!D.warnings.some((w) => /generator bug/.test(w)), name + ": the generator reports its own bug");
    eq(D.lockViolations.filter((l) => l.id === FIERCE).map((l) => l.day + " " + l.role + " " + l.lock + " " + l.reasons.join("+")), lv || [], name + ": " + (lv && lv.length ? "his one lock violation is the day before his vacation" : "no lock of his breaks a rule"));
    eq(D.derivedYields, [], name + ": no derived day yields to a published row here");
  };
  for (let s = 1; s <= 8; s++) {
    // (2) the vacation
    CUR.range = "Faraz 11/11 vacation (week of 2027-03-29)"; CUR.seed = s; CUR.day = "-";
    const v = GEN.generate(vacCtx, "2027-03-22", "2027-04-11", { seed: s, bestOf: 2 }), VS = v.schedule, VD = v.diagnostics;
    DW_RUNS.n++;
    common("vacation", VD, ["2027-03-31 primary derived day-before-vacation"]);
    ["2027-03-29", "2027-03-30", "2027-03-31"].forEach((d) => { ok(isHis(VS[d], P), d + ": Mon / Tue / Wed of the week stay his locked primary (Wed 3/31 is the day before his vacation - Faraz 11/12)"); eq(VS[d].source, "east-derived", d + " source"); });
    const yielded = daysList("2027-04-01", "2027-04-04");
    yielded.forEach((d) => {
      CUR.day = d;
      ok(VS[d].primary !== FIERCE, d + ": he is not placed as primary (a vacation day)");
      eq(VS[d].primaryLocked, false, d + ": no derived lock is seeded");
      const listed = VD.uncovered.find((u) => u.day === d && u.role === P);
      if (VS[d].primary) ok(!listed, d + ": primary filled AND listed uncovered");
      else {
        ok(listed, d + ": primary open but not listed uncovered");
        IDS.forEach((id) => (listed.reasons[id] || []).forEach((r) => ok(r.indexOf("derived-lock-held:" + FIERCE) !== 0, d + ": " + CODE[id] + " is refused for his derived lock on a day it yielded")));
        ok((listed.reasons[FIERCE] || []).some((r) => r.indexOf("time-off:") === 0), d + ": his own reason is the vacation: " + JSON.stringify(listed.reasons[FIERCE]));
      }
    });
    CUR.day = "-";
    vacDays.forEach((d) => ok(VS[d].primary !== FIERCE && VS[d].backup !== FIERCE, d + ": he holds nothing on a vacation day"));
    eq(VD.derivedVacationYields, yielded.map((d) => ({ day: d, role: P, surgeonId: FIERCE, reason: "time-off", unit: null })), "diagnostics.derivedVacationYields = Thu 4/1 - Sun 4/4, the vacation's own days");
    eq(VD.derivedUnitDays, [], "the vacation run: no holiday unit is involved");
    eq(VD.warnings.filter((w) => /^vacation: /.test(w)), ["vacation: the derived week of 2027-03-29 (" + NAME[FIERCE] + " Silvis primary) does not place him on " + yielded.join(", ") + " - filled like any other day", EDGE_LINE("2027-03-29", P, ["2027-03-31"])], "one warning for the yielding days and one for the day before");
    // (2b) Faraz 11/12: a vacation from the Monday after the week (fixture dates, 4/5 - 4/9). The whole week is his.
    CUR.range = "Faraz 11/12 vacation from the Monday after (week of 2027-03-29)";
    const w = GEN.generate(monCtx, "2027-03-22", "2027-04-11", { seed: s, bestOf: 2 }), WS = w.schedule, WD = w.diagnostics;
    DW_RUNS.n++;
    common("vacation from the Monday after", WD, ["2027-04-04 primary derived day-before-vacation"]);
    daysList("2027-03-29", "2027-04-04").forEach((d) => { ok(isHis(WS[d], P), d + ": his locked primary - all seven days of the week, Sunday (the day before his vacation) included"); eq(WS[d].source, "east-derived", d + " source"); });
    ok(!WD.uncovered.some((u) => u.day === "2027-04-04" && u.role === P), "Sun 4/4 primary is no open slot");
    daysList(MON_ROW.start_date, MON_ROW.end_date).forEach((d) => ok(WS[d].primary !== FIERCE && WS[d].backup !== FIERCE, d + ": he holds nothing on a vacation day"));
    eq([WD.derivedVacationYields, WD.derivedUnitDays], [[], []], "nothing yields and no unit is involved");
    eq(WD.warnings.filter((x) => /^vacation: /.test(x)), [EDGE_LINE("2027-03-29", P, ["2027-04-04"])], "ONE warning: he is kept on the day before his vacation");
    if (s <= 2) {
      // the 11/11 reading as data (yieldDayBefore exactly true): Wed 3/31 yields with the vacation days and no lock of his breaks a rule
      CUR.range = "yieldDayBefore true (week of 2027-03-29)";
      const o = GEN.generate(edgeCtx, "2027-03-22", "2027-04-11", { seed: s, bestOf: 2 }), OS = o.schedule, OD = o.diagnostics;
      DW_RUNS.n++;
      common("yieldDayBefore true", OD);
      ["2027-03-29", "2027-03-30"].forEach((d) => ok(isHis(OS[d], P), d + ": Mon / Tue stay his locked primary"));
      const oy = ["2027-03-31"].concat(daysList("2027-04-01", "2027-04-04"));
      oy.forEach((d) => { ok(OS[d].primary !== FIERCE, d + ": he is not placed as primary"); eq(OS[d].primaryLocked, false, d + ": no derived lock is seeded"); });
      eq(OD.derivedVacationYields, oy.map((d, i) => ({ day: d, role: P, surgeonId: FIERCE, reason: i === 0 ? "day-before-vacation" : "time-off", unit: null })), "yieldDayBefore true: Wed 3/31 (the day before) and Thu 4/1 - Sun 4/4 yield");
      eq(OD.warnings.filter((x) => /^vacation: /.test(x)), ["vacation: the derived week of 2027-03-29 (" + NAME[FIERCE] + " Silvis primary) does not place him on " + oy.join(", ") + " - filled like any other day"], "one warning, and no kept-day line");
    }
    if (s <= 2) {
      // The 11/12 review: the kept-day line's own conditions, each pinned by a run.
      // (A) yieldToVacation false: the lock stands over the vacation itself too - five lock violations and NO vacation line
      // at all (nothing yields, and nothing is being told apart); yieldDayBefore true on top changes nothing.
      CUR.range = "11/12 review (A) yieldToVacation false";
      const a0 = GEN.generate(ctxOf({ timeOffRows: [VAC_ROW], groupRules: grDW({ yieldToVacation: false }) }), "2027-03-22", "2027-04-11", { seed: s, bestOf: 2 }), A0 = a0.diagnostics;
      DW_RUNS.n++;
      daysList("2027-03-29", "2027-04-04").forEach((d) => ok(isHis(a0.schedule[d], P), d + ": the lock stands (yieldToVacation false)"));
      const lvA = A0.lockViolations.filter((l) => l.id === FIERCE);
      eq(lvA.map((l) => l.day), ["2027-03-31"].concat(daysList("2027-04-01", "2027-04-04")), "the day before and the four vacation days are his lock violations");
      ok(lvA[0].reasons.indexOf("day-before-vacation") >= 0 && lvA.slice(1).every((l) => l.reasons.some((r) => r.indexOf("time-off:") === 0)), "...each with its own reason: " + JSON.stringify(lvA.map((l) => l.reasons)));
      eq(A0.warnings.filter((x) => /^vacation: /.test(x)), [], "no vacation line: no yield, and no kept-day line with yieldToVacation false");
      const a1 = GEN.generate(ctxOf({ timeOffRows: [VAC_ROW], groupRules: grDW({ yieldToVacation: false, yieldDayBefore: true }) }), "2027-03-22", "2027-04-11", { seed: s, bestOf: 2 });
      DW_RUNS.n++;
      eq([a1.diagnostics.derivedVacationYields, a1.diagnostics.warnings.filter((x) => /^vacation: /.test(x)), daysList("2027-03-29", "2027-04-04").every((d) => isHis(a1.schedule[d], P))], [[], [], true], "yieldDayBefore true does nothing without yieldToVacation");
      // (B) no derivedWeeks key at all (the live blob): the defaults - the day before is kept, with its line
      CUR.range = "11/12 review (B) no derivedWeeks key";
      const b0 = GEN.generate(ctxOf({ timeOffRows: [MON_ROW], groupRules: GR_NOKEY }), "2027-03-22", "2027-04-11", { seed: s, bestOf: 2 }), B0 = b0.diagnostics;
      DW_RUNS.n++;
      ok(isHis(b0.schedule["2027-04-04"], P), "no key: Sun 4/4 is his");
      eq(B0.warnings.filter((x) => /^vacation: /.test(x)), [EDGE_LINE("2027-03-29", P, ["2027-04-04"])], "no key: the kept-day line is there");
      // (C) the day a holiday unit ADDS is the day before his vacation (week of 5/24, Memorial Day Mon 5/31, a vacation from
      // Tue 6/1 - fixture dates): the unit stays his whole, and the line names his DERIVED week, 5/24 - not the week 5/31 is in
      CUR.range = "11/12 review (C) the unit's added day is the day before a vacation";
      const c0 = GEN.generate(ctxOf({ timeOffRows: [{ person_id: FIERCE, start_date: "2027-06-01", end_date: "2027-06-03" }] }), "2027-05-17", "2027-06-06", { seed: s, bestOf: 2 }), C0 = c0.diagnostics;
      DW_RUNS.n++;
      daysList("2027-05-24", "2027-05-31").forEach((d) => ok(isHis(c0.schedule[d], P), d + ": the week and the unit's Monday are his"));
      eq(C0.lockViolations.filter((l) => l.id === FIERCE).map((l) => l.day + " " + l.lock + " " + l.reasons.join("+")), ["2027-05-31 derived day-before-vacation"], "Mon 5/31 is his one lock violation");
      eq([C0.derivedUnitDays.map((x) => x.day), C0.derivedVacationYields], [["2027-05-31"], []], "the unit day is added and nothing yields");
      eq(C0.warnings.filter((x) => /^vacation: /.test(x)), [EDGE_LINE("2027-05-24", P, ["2027-05-31"])], "the line names the derived week of 5/24");
      // (D) two days before a vacation in one derived week (a one-day vacation on Wed 3/31 and one from Mon 4/5 - fixture
      // dates): ONE line names both
      CUR.range = "11/12 review (D) two days before a vacation in one week";
      const d0 = GEN.generate(ctxOf({ timeOffRows: [{ person_id: FIERCE, start_date: "2027-03-31", end_date: "2027-03-31" }, MON_ROW] }), "2027-03-22", "2027-04-11", { seed: s, bestOf: 2 }), D0 = d0.diagnostics;
      DW_RUNS.n++;
      ["2027-03-29", "2027-03-30", "2027-04-01", "2027-04-02", "2027-04-03", "2027-04-04"].forEach((d) => ok(isHis(d0.schedule[d], P), d + ": his"));
      ok(d0.schedule["2027-03-31"].primary !== FIERCE, "Wed 3/31, the vacation day, is not his");
      eq(D0.warnings.filter((x) => /^vacation: /.test(x)), ["vacation: the derived week of 2027-03-29 (" + NAME[FIERCE] + " Silvis primary) does not place him on 2027-03-31 - filled like any other day", EDGE_LINE("2027-03-29", P, ["2027-03-30", "2027-04-04"])], "one yield line and ONE kept-day line naming both days");
      // (E) the line is about HIS derived day and the day-before reason only: another surgeon hand-locked the day before his
      // own vacation gets none, nor does a derived lock that breaks another rule (a dated unavailable row of his)
      CUR.range = "11/12 review (E) other locks, other rules";
      const e0 = GEN.generate(ctxOf({ timeOffRows: [{ person_id: ACTON, start_date: "2027-04-08", end_date: "2027-04-09" }], availabilityRows: SA.seedToAvailabilityRows(seed).concat([{ person_id: FIERCE, start_date: "2027-03-30", end_date: "2027-03-30", kind: "unavailable", role: "any" }]), schedule: { "2027-04-07": heldRow(ACTON, true) } }), "2027-03-22", "2027-04-11", { seed: s, bestOf: 2 }), E0 = e0.diagnostics;
      DW_RUNS.n++;
      const lvE = E0.lockViolations.map((l) => l.day + " " + l.id + " " + l.lock + " " + l.reasons.join("+"));
      ok(lvE.some((x) => x.indexOf("2027-04-07 " + ACTON + " import ") === 0 && /day-before-vacation/.test(x)), "Acton's hand lock the day before his own vacation is a lock violation: " + JSON.stringify(lvE));
      ok(lvE.some((x) => x.indexOf("2027-03-30 " + FIERCE + " derived ") === 0 && /unavailable-row/.test(x)), "Fierce's derived lock over his own unavailable row is one too: " + JSON.stringify(lvE));
      eq(E0.warnings.filter((x) => /^vacation: /.test(x)), [], "...and neither gets a kept-day line");
      // (F) fill-open-only: an UNLOCKED row holding him on Sun 4/4 is a fixed slot, not a lock - listed in fixedViolations,
      // and the line covers it too
      CUR.range = "11/12 review (F) fill-open-only, an unlocked row of his on the day before";
      const f0 = GEN.generate(ctxOf({ timeOffRows: [MON_ROW], schedule: { "2027-04-04": heldRow(FIERCE, false) } }), "2027-03-22", "2027-04-11", { seed: s, bestOf: 2, fillOpenOnly: true }), F0 = f0.diagnostics;
      DW_RUNS.n++;
      eq(F0.fixedViolations.filter((x) => x.id === FIERCE).map((x) => x.day + " " + x.role + " " + x.kept + " " + x.reasons.join("+")), ["2027-04-04 primary fill-open-only day-before-vacation"], "the held slot is a fixed violation");
      eq(F0.lockViolations.filter((l) => l.id === FIERCE), [], "...and no lock violation of his");
      eq(F0.warnings.filter((x) => /^vacation: /.test(x)), [EDGE_LINE("2027-03-29", P, ["2027-04-04"])], "the kept-day line covers a fixed slot too");
      // The re-check of those fixes (11/12):
      // (G) his own hand lock in the OTHER role on a derived day is no day his week keeps him on: backup week of 8/30, locked
      // as PRIMARY on Wed 9/1, a vacation on Thu 9/2 - Fri 9/3 (fixture dates) - the lock is a violation, with NO kept-day line
      CUR.range = "11/12 re-check (G) his lock in the other role on a derived day";
      const g0 = GEN.generate(ctxOf({ timeOffRows: [{ person_id: FIERCE, start_date: "2027-09-02", end_date: "2027-09-03" }], schedule: { "2027-09-01": heldRow(FIERCE, true) } }), "2027-08-23", "2027-09-12", { seed: s, bestOf: 2 }), G0 = g0.diagnostics;
      DW_RUNS.n++;
      ok(g0.schedule["2027-09-01"].primary === FIERCE && g0.schedule["2027-09-01"].backup !== FIERCE, "his hand lock as primary on Wed 9/1 stands (and he is not also its backup)");
      ok(G0.lockViolations.some((l) => l.day === "2027-09-01" && l.role === P && l.id === FIERCE && l.reasons.indexOf("day-before-vacation") >= 0), "...and is a lock violation the day before his vacation: " + JSON.stringify(G0.lockViolations.filter((l) => l.id === FIERCE)));
      eq(G0.warnings.filter((x) => /^vacation: /.test(x)), ["vacation: the derived week of 2027-08-30 (" + NAME[FIERCE] + " Silvis backup) does not place him on 2027-09-02, 2027-09-03 - filled like any other day"], "the yield line for his two vacation days, and no kept-day line for a lock that is not his derived role");
      // (H) a fixed slot of the other kind - a claimed day (fixed in every mode): the line covers it as well
      CUR.range = "11/12 re-check (H) a claimed day of his on the day before";
      const h0 = GEN.generate(ctxOf({ timeOffRows: [MON_ROW], schedule: { "2027-04-04": Object.assign(heldRow(FIERCE, false), { source: "claim" }) } }), "2027-03-22", "2027-04-11", { seed: s, bestOf: 2 }), H0 = h0.diagnostics;
      DW_RUNS.n++;
      eq(H0.fixedViolations.filter((x) => x.id === FIERCE).map((x) => x.day + " " + x.role + " " + x.kept + " " + x.reasons.join("+")), ["2027-04-04 primary claim day-before-vacation"], "the claimed day is a fixed violation (kept: claim)");
      eq(H0.warnings.filter((x) => /^vacation: /.test(x)), [EDGE_LINE("2027-03-29", P, ["2027-04-04"])], "...with the kept-day line");
      // (I) a fixed slot BEFORE a lock in one week (fill-open-only: an unlocked row of his on Tue 3/30, the day before a
      // one-day vacation; Sun 4/4 seeded as a derived lock): ONE line, the days in date order
      CUR.range = "11/12 re-check (I) a fixed slot before a lock in one week";
      const i0 = GEN.generate(ctxOf({ timeOffRows: [{ person_id: FIERCE, start_date: "2027-03-31", end_date: "2027-03-31" }, MON_ROW], schedule: { "2027-03-30": heldRow(FIERCE, false) } }), "2027-03-22", "2027-04-11", { seed: s, bestOf: 2, fillOpenOnly: true }), I0 = i0.diagnostics;
      DW_RUNS.n++;
      eq([I0.fixedViolations.filter((x) => x.id === FIERCE).map((x) => x.day), I0.lockViolations.filter((l) => l.id === FIERCE).map((l) => l.day)], [["2027-03-30"], ["2027-04-04"]], "Tue 3/30 is the fixed violation, Sun 4/4 the lock violation");
      ok(I0.warnings.indexOf(EDGE_LINE("2027-03-29", P, ["2027-03-30", "2027-04-04"])) >= 0, "ONE kept-day line, the days in date order: " + JSON.stringify(I0.warnings.filter((x) => /keeps him on/.test(x))));
      // (J) held initials (11/12) with rows in the way: Acton hand-locked on the unit's Sat + Sun - only Mon - Fri of his week
      // are pending on the input rows (the unit is Acton's, so its Monday is not), and each of the five is seeded
      CUR.range = "held initials (J) pending implies seeded, rows in the way";
      const jCtx = ctxOf({ schedule: { "2027-05-29": heldRow(ACTON, true), "2027-05-30": heldRow(ACTON, true) } });
      const j0 = GEN.generate(jCtx, "2027-05-17", "2027-06-06", { seed: s, bestOf: 2 });
      DW_RUNS.n++;
      eq(pendingSeeded("held initials (J)", jCtx, j0, "2027-05-17", "2027-06-06"), 5, "Acton holds the unit's Sat + Sun: five pending days (Mon - Fri), none on the unit - each seeded");
      const k0 = GEN.generate(edgeCtx, "2027-03-22", "2027-04-11", { seed: s, bestOf: 2 });
      DW_RUNS.n++;
      eq(pendingSeeded("yieldDayBefore true", edgeCtx, k0, "2027-03-22", "2027-04-11"), 2, "with the 11/11 reading on, Mon + Tue are pending and seeded (Wed yields)");
    }
    // (1) Memorial Day - his primary week of 5/24 keeps the unit
    CUR.range = "Faraz 11/11 Memorial Day (week of 2027-05-24)";
    const m = GEN.generate(plainCtx, "2027-05-17", "2027-06-06", { seed: s, bestOf: 2 }), MS = m.schedule, MD = m.diagnostics;
    DW_RUNS.n++;
    common("Memorial Day", MD);
    daysList("2027-05-24", "2027-05-31").forEach((d) => { ok(isHis(MS[d], P), d + ": his locked primary (the week's seven days and the unit's Monday)"); eq(MS[d].source, "east-derived", d + " source"); });
    ok(MS["2027-06-01"].primary !== FIERCE, "Tue 6/1: a ninth primary day in a row is past his run limit of 7 (the lock run counts)");
    // review C (11/11): the line above passes whatever his run limit says (Tue is outside his weekday pattern) - bind the
    // claim itself: over the generated schedule, every hard reason read, his run limit refuses the ninth day
    const ninth = R.eligibility(ctxOf({ schedule: MS }), "2027-06-01", P, FIERCE, { allHard: true }).hard;
    ok(ninth.indexOf("max-consecutive:7") >= 0, "Tue 6/1 primary: the 8-day lock run counts against his run limit - " + JSON.stringify(ninth));
    eq(MD.derivedUnitDays, [{ day: "2027-05-31", role: P, surgeonId: FIERCE, unit: "Memorial Day" }], "diagnostics.derivedUnitDays names Mon 5/31");
    eq(MD.derivedVacationYields, [], "no vacation here");
    eq(MD.warnings.filter((w) => /^holiday unit kept /.test(w)), ["holiday unit kept with the derived week: Memorial Day stays with " + NAME[FIERCE] + " (Silvis primary) - 2027-05-31 added to his derived days"], "one warning for the unit");
    const mu = MD.holidayUnits.find((u) => u.name === "Memorial Day");
    eq([mu && mu.primary, MEM.map((d) => MS[d].backup === FIERCE)], [FIERCE, [false, false, false]], "the Memorial Day unit's primary is his; he is never its backup");
    const mb = MEM.map((d) => MS[d].backup);
    ok(mb.every((x) => x === mb[0]), "the unit's backup is one surgeon through its three days (or open through all): " + JSON.stringify(mb));
    // (1) again for a backup week: 8/30 (East primary) and Labor Day
    CUR.range = "Faraz 11/11 Labor Day (backup week of 2027-08-30)";
    const l = GEN.generate(plainCtx, "2027-08-23", "2027-09-12", { seed: s, bestOf: 2 }), LS = l.schedule, LD = l.diagnostics;
    DW_RUNS.n++;
    common("Labor Day", LD);
    daysList("2027-08-30", "2027-09-06").forEach((d) => { ok(isHis(LS[d], B), d + ": his locked backup (the week's seven days and the unit's Monday)"); ok(LS[d].primary !== FIERCE, d + ": never both roles"); });
    eq(LD.derivedUnitDays, [{ day: "2027-09-06", role: B, surgeonId: FIERCE, unit: "Labor Day" }], "diagnostics.derivedUnitDays names Mon 9/6 as backup");
    const lp = LAB.map((d) => LS[d].primary);
    ok(lp.every((x) => x === lp[0]), "the Labor Day unit's primary is one surgeon through its three days (or open through all): " + JSON.stringify(lp));
    // held initials (11/12): pending implies seeded, on these four runs' input rows (none) - the counts are the derived days
    eq([pendingSeeded("vacation", vacCtx, v, "2027-03-22", "2027-04-11"), pendingSeeded("vacation from the Monday after", monCtx, w, "2027-03-22", "2027-04-11"), pendingSeeded("Memorial Day", plainCtx, m, "2027-05-17", "2027-06-06"), pendingSeeded("Labor Day", plainCtx, l, "2027-08-23", "2027-09-12")], [3, 7, 8, 8], "derivedPending names 3 / 7 / 8 / 8 slots on those runs (Mon - Wed; the whole week; the week + the unit's Monday, twice) and each is seeded");
  }
  // The 11/11 review's findings, restated from the inputs:
  //  (a) the unit stays with him only while it IS his. Acton hand-locked as primary on Sat 5/29 + Sun 5/30: the unit is
  //      Acton's, so Mon 5/31 follows the unit's one-holder rule (Acton, as before 11/11) - never a derived lock for
  //      Fierce that splits the unit. The same when the range starts on that Monday and Sat + Sun are published rows
  //      outside it. A regenerate over unlocked rows INSIDE the range keeps the unit with him (they are cleared first).
  //  (b) a lock on the day the unit would add stands, and the diagnostics say so under his week of 5/24 (they named a
  //      "derived week 2027-05-31" and "stays with Fierce - 5/31 added" side by side).
  //  (c) a standing lock on a day that yields to his vacation stays a fact: the warning says he is kept there.
  const rowOf = (primary, locked, source) => ({ primary, backup: null, primaryLocked: !!locked, backupLocked: false, source: source || "manual", externalCover: null, note: null });
  const yieldLine = (D) => D.warnings.filter((w) => /^derived week /.test(w));
  const unitLines = (D) => D.warnings.filter((w) => /^holiday unit/.test(w));
  for (let s = 1; s <= 4; s++) {
    CUR.seed = s; CUR.day = "-";
    CUR.range = "review 11/11 (a) Memorial Day held by Acton (locked)";
    const a = GEN.generate(ctxOf({ schedule: { "2027-05-29": rowOf(ACTON, true), "2027-05-30": rowOf(ACTON, true) } }), "2027-05-17", "2027-06-06", { seed: s, bestOf: 2 }), AS = a.schedule, AD = a.diagnostics;
    DW_RUNS.n++;
    eq(AD.hardViolations, [], "hard violations"); ok(!AD.warnings.some((w) => /generator bug/.test(w)), "no generator bug");
    ok(["2027-05-29", "2027-05-30"].every((d) => AS[d].primary === ACTON && AS[d].primaryLocked === true), "Acton's two hand locks stand");
    daysList("2027-05-24", "2027-05-28").forEach((d) => ok(isHis(AS[d], P), d + ": Mon - Fri of his week stay his locked primary"));
    eq(AS["2027-05-31"].primary, ACTON, "Mon 5/31 primary follows the unit's holder, Acton - the unit is not split");
    ok(AS["2027-05-31"].source !== "east-derived", "...and it is no derived lock");
    eq(AD.derivedYields.map((y) => y.day + " " + y.role + " " + y.holderId), ["2027-05-29 primary " + ACTON, "2027-05-30 primary " + ACTON, "2027-05-31 primary " + ACTON], "diagnostics.derivedYields: the three unit days, held by Acton");
    eq(yieldLine(AD), ["derived week 2027-05-24 (" + NAME[FIERCE] + " Silvis primary) yields to published entries on 2027-05-29, 2027-05-30, 2027-05-31"], "ONE yield warning, under his week of 5/24 (Mon 5/31 is no week of its own)");
    eq(unitLines(AD), ["holiday unit not kept with the derived week: 2027-05-31 primary is not seeded for " + FIERCE + " - the unit's days of his week (2027-05-29, 2027-05-30) are held by " + ACTON,
      "holiday unit: Memorial Day is not kept whole with " + NAME[FIERCE] + "'s derived week (Silvis primary) - 2027-05-31 held by " + NAME[ACTON]], "the unit's warnings state the outcome - never 'stays with Fierce'");
    CUR.range = "review 11/11 (a) the range starts on the holiday Monday";
    const b = GEN.generate(ctxOf({ schedule: { "2027-05-29": rowOf(ACTON, false, "generated"), "2027-05-30": rowOf(ACTON, false, "generated") } }), "2027-05-31", "2027-06-13", { seed: s, bestOf: 2 }), BS = b.schedule, BD = b.diagnostics;
    DW_RUNS.n++;
    eq(BD.hardViolations, [], "hard violations");
    ok(BS["2027-05-31"].primary !== FIERCE && BS["2027-05-31"].source !== "east-derived", "Sat + Sun are Acton's published rows outside the range: Mon 5/31 is not seeded for Fierce (holder " + BS["2027-05-31"].primary + ")");
    ok(BS["2027-05-31"].primary === ACTON || BS["2027-05-31"].primary === null, "...it is the unit holder's, or open - never a third surgeon's: " + BS["2027-05-31"].primary);
    CUR.range = "review 11/11 (a) a regenerate over unlocked rows inside the range";
    const c = GEN.generate(ctxOf({ schedule: { "2027-05-29": rowOf(ACTON, false, "generated"), "2027-05-30": rowOf(ACTON, false, "generated") } }), "2027-05-17", "2027-06-06", { seed: s, bestOf: 2 }), CS = c.schedule;
    DW_RUNS.n++;
    daysList("2027-05-24", "2027-05-31").forEach((d) => ok(isHis(CS[d], P), d + ": unlocked rows inside the range are regenerated - the week and the unit's Monday are his"));
    eq(c.diagnostics.derivedYields, [], "...and nothing yields");
    CUR.range = "review 11/11 (b) the unit's Monday locked to Khan";
    const k = GEN.generate(ctxOf({ schedule: { "2027-05-31": rowOf(KHAN, true) } }), "2027-05-17", "2027-06-06", { seed: s, bestOf: 2 }), KS = k.schedule, KD = k.diagnostics;
    DW_RUNS.n++;
    ok(KS["2027-05-31"].primary === KHAN && KS["2027-05-31"].primaryLocked === true, "the lock on Mon 5/31 stands");
    daysList("2027-05-24", "2027-05-30").forEach((d) => ok(isHis(KS[d], P), d + ": his week is his"));
    eq(yieldLine(KD), ["derived week 2027-05-24 (" + NAME[FIERCE] + " Silvis primary) yields to published entries on 2027-05-31"], "the yield is reported under his week of 5/24");
    eq(unitLines(KD), ["holiday unit: Memorial Day is not kept whole with " + NAME[FIERCE] + "'s derived week (Silvis primary) - 2027-05-31 held by " + NAME[KHAN]], "...and the unit warning names who holds the day - it does not say the day was added");
    CUR.range = "review 11/11 (c) standing locks on his vacation";
    const stand = {}; ["2027-03-31"].concat(daysList("2027-04-01", "2027-04-04")).forEach((d) => { stand[d] = rowOf(FIERCE, true, "east-derived"); });
    const v2 = GEN.generate(ctxOf({ timeOffRows: [{ person_id: FIERCE, start_date: VAC.start, end_date: VAC.end }], schedule: stand }), "2027-03-22", "2027-04-11", { seed: s, bestOf: 2 }), V2 = v2.diagnostics;
    DW_RUNS.n++;
    ok(Object.keys(stand).every((d) => v2.schedule[d].primary === FIERCE && v2.schedule[d].primaryLocked === true), "the five standing locks are kept as facts");
    eq(V2.lockViolations.filter((l) => l.id === FIERCE).map((l) => l.day).sort(), Object.keys(stand).sort(), "...and listed as lock violations");
    eq(V2.warnings.filter((w) => /^vacation: /.test(w)), ["vacation: the derived week of 2027-03-29 (" + NAME[FIERCE] + " Silvis primary) yields on " + daysList("2027-04-01", "2027-04-04").join(", ") + ", but a held slot keeps him there (lockViolations / fixedViolations list it when the vacation itself refuses that day)", EDGE_LINE("2027-03-29", P, ["2027-03-31"])], "the warnings say he is kept there - on the four vacation days by the standing locks, on the day before by his derived week (11/12); never 'does not place him'");
    // The re-check of the fixes (11/11) - four more outcomes of the day a unit would add, each said as it is:
    //  (d) the holder of the unit's days of his week cannot take it (Acton off on the Monday): it is left OPEN, with
    //      reasons - the unit rule's own outcome, as before 11/11; never seeded for Fierce;
    //  (e) those days are an outside cover's, or his own in the other role: not seeded, and the yield names that holder;
    //  (f) the unit was published to him and Sat + Sun were then given to Acton by hand: his lock on the Monday stands
    //      (locks never move) - the unit IS split, and the warning says so instead of "stays with Fierce".
    // And the reviewer of that round (11/12 UTC): ONE line per unit, each added day's fate as the schedule has it -
    //  (g) an outside cover on the added day itself holds it (never "left open");
    //  (h) Acton hand-locked on the Saturday only: Sun and the added Monday stay his - a split, named with the day;
    //  (i) a week that STARTS on the holiday Monday adds the unit's Sat + Sun: with Sat locked to Acton the unit gets one
    //      "not kept whole" line naming both fates (before: a "stays with" line and a "not kept whole" line side by side);
    //      with nothing held, one "kept" line naming both days.
    CUR.range = "re-check 11/11 (d) the unit's holder cannot take the added day";
    const d4 = GEN.generate(ctxOf({ schedule: { "2027-05-29": rowOf(ACTON, true), "2027-05-30": rowOf(ACTON, true) }, timeOffRows: [{ person_id: ACTON, start_date: "2027-05-31", end_date: "2027-05-31" }] }), "2027-05-17", "2027-06-06", { seed: s, bestOf: 2 }), D4 = d4.diagnostics;
    DW_RUNS.n++;
    eq([d4.schedule["2027-05-31"].primary, d4.schedule["2027-05-31"].primaryLocked], [null, false], "Mon 5/31 primary is left open - not seeded for Fierce, nobody else may hold the unit");
    ok(D4.uncovered.some((u) => u.day === "2027-05-31" && u.role === P && (u.reasons[ACTON] || []).some((r) => r.indexOf("time-off:") === 0)), "...and listed uncovered with Acton's own reason");
    eq(unitLines(D4)[1], "holiday unit: Memorial Day is not kept whole with " + NAME[FIERCE] + "'s derived week (Silvis primary) - 2027-05-31 left open", "the warning says left open");
    CUR.range = "re-check 11/11 (e) an outside cover on the unit's days of his week";
    const cover = (d) => Object.assign(rowOf(null, false), { externalCover: "locums" });
    const e4 = GEN.generate(ctxOf({ schedule: { "2027-05-29": cover(), "2027-05-30": cover() } }), "2027-05-17", "2027-06-06", { seed: s, bestOf: 2 }), E4 = e4.diagnostics;
    DW_RUNS.n++;
    ok(e4.schedule["2027-05-31"].primary !== FIERCE, "Mon 5/31 is not seeded for Fierce when an outside cover holds Sat + Sun");
    eq(E4.derivedYields.filter((y) => y.day === "2027-05-31"), [{ day: "2027-05-31", role: P, derivedId: FIERCE, holderId: "ext:locums", holderRole: P, holderSource: "manual" }], "the yield names the outside cover");
    eq(unitLines(E4)[0], "holiday unit not kept with the derived week: 2027-05-31 primary is not seeded for " + FIERCE + " - the unit's days of his week (2027-05-29, 2027-05-30) are held by ext:locums", "...and so does the warning");
    CUR.range = "round 3b (g) an outside cover on the added day itself";
    const h4 = GEN.generate(ctxOf({ schedule: { "2027-05-31": cover() } }), "2027-05-17", "2027-06-06", { seed: s, bestOf: 2 }), H4 = h4.diagnostics;
    DW_RUNS.n++;
    ok(isHis(h4.schedule["2027-05-29"], P) && isHis(h4.schedule["2027-05-30"], P), "Sat + Sun stay his (days of his East week)");
    eq([h4.schedule["2027-05-31"].primary, h4.schedule["2027-05-31"].externalCover], [null, "locums"], "Mon 5/31 stays the outside cover's");
    eq(unitLines(H4), ["holiday unit: Memorial Day is not kept whole with " + NAME[FIERCE] + "'s derived week (Silvis primary) - 2027-05-31 held by an outside cover (locums)"], "the warning names the cover - the day is not 'left open'");
    ok(!H4.uncovered.some((u) => u.day === "2027-05-31" && u.role === P), "...and it is no open slot");
    CUR.range = "round 3b (h) Acton hand-locked on the Saturday only";
    const p4 = GEN.generate(ctxOf({ schedule: { "2027-05-29": rowOf(ACTON, true) } }), "2027-05-17", "2027-06-06", { seed: s, bestOf: 2 }), P4 = p4.diagnostics;
    DW_RUNS.n++;
    eq(P4.hardViolations, [], "hard violations");
    ok(p4.schedule["2027-05-29"].primary === ACTON && isHis(p4.schedule["2027-05-30"], P) && isHis(p4.schedule["2027-05-31"], P), "Sat is Acton's by the hand lock; Sun and the added Monday stay his");
    eq(unitLines(P4), ["holiday unit: Memorial Day is not kept whole with " + NAME[FIERCE] + "'s derived week (Silvis primary) - 2027-05-31 is his while 2027-05-29 of the unit is not (split - settle it by hand)"], "ONE line, naming the split and its day - never 'stays with Fierce'");
    CUR.range = "round 3b (i) a week starting on the holiday Monday, Sat locked to Acton";
    const W31 = [{ weekMonday: "2027-05-31", surgeonId: FIERCE, silvisRole: P }];
    const m4 = GEN.generate(ctxOf({ eastDerived: W31, schedule: { "2027-05-29": rowOf(ACTON, true) } }), "2027-05-17", "2027-06-13", { seed: s, bestOf: 2 }), M4 = m4.diagnostics;
    DW_RUNS.n++;
    ok(m4.schedule["2027-05-29"].primary === ACTON && isHis(m4.schedule["2027-05-30"], P) && isHis(m4.schedule["2027-05-31"], P), "Sat Acton's, Sun (added) and Mon (his week) his");
    eq(unitLines(M4), ["holiday unit: Memorial Day is not kept whole with " + NAME[FIERCE] + "'s derived week (Silvis primary) - 2027-05-29 held by " + NAME[ACTON] + "; 2027-05-30 is his"], "ONE line for the unit with both added days' fates - no 'stays with' line beside it");
    CUR.range = "round 3b (i) a week starting on the holiday Monday, nothing held";
    const n4 = GEN.generate(ctxOf({ eastDerived: W31 }), "2027-05-17", "2027-06-13", { seed: s, bestOf: 2 }), N4 = n4.diagnostics;
    DW_RUNS.n++;
    ok(MEM.every((d) => isHis(n4.schedule[d], P)), "the unit's three days are his");
    eq(unitLines(N4), ["holiday unit kept with the derived week: Memorial Day stays with " + NAME[FIERCE] + " (Silvis primary) - 2027-05-29, 2027-05-30 added to his derived days"], "ONE kept line naming both added days");
    // (j) the range starts ON the added Monday and nothing is published before it: the run holds no row of the unit's
    // Sat + Sun, so nothing can be said about them - the Monday is his and the line says kept (and nothing throws)
    CUR.range = "round 3b (j) the range starts on the added Monday, nothing published before it";
    const j4 = GEN.generate(ctxOf({}), "2027-05-31", "2027-06-13", { seed: s, bestOf: 2 }), J4 = j4.diagnostics;
    DW_RUNS.n++;
    ok(isHis(j4.schedule["2027-05-31"], P) && j4.schedule["2027-05-29"] === undefined, "Mon 5/31 is his derived lock; the run holds no row of Sat 5/29");
    eq(unitLines(J4), ["holiday unit kept with the derived week: Memorial Day stays with " + NAME[FIERCE] + " (Silvis primary) - 2027-05-31 added to his derived days"], "a unit day the run holds no row of says nothing: kept");
    CUR.range = "re-check 11/11 (e) he is locked as backup on the unit's days of his week";
    const asB = () => ({ primary: null, backup: FIERCE, primaryLocked: false, backupLocked: true, source: "manual", externalCover: null, note: null });
    const f4 = GEN.generate(ctxOf({ schedule: { "2027-05-29": asB(), "2027-05-30": asB() } }), "2027-05-17", "2027-06-06", { seed: s, bestOf: 2 }), F4 = f4.diagnostics;
    DW_RUNS.n++;
    eq(F4.hardViolations, [], "hard violations");
    ok(MEM.every((d) => f4.schedule[d].primary !== FIERCE) && f4.schedule["2027-05-29"].backup === FIERCE, "he is backup on Sat + Sun by the hand locks and primary on no day of the unit");
    const fp = MEM.map((d) => f4.schedule[d].primary);
    ok(fp[0] !== null && fp.every((x) => x === fp[0]), "the unit's primary is ONE other surgeon through its three days (before the fix: three open slots): " + JSON.stringify(fp));
    eq(F4.derivedYields.filter((y) => y.day === "2027-05-31"), [{ day: "2027-05-31", role: P, derivedId: FIERCE, holderId: FIERCE, holderRole: B, holderSource: "manual" }], "the yield says he holds the other role there");
    eq(unitLines(F4)[0], "holiday unit not kept with the derived week: 2027-05-31 primary is not seeded for " + FIERCE + " - the unit's days of his week (2027-05-29, 2027-05-30) are held by him as backup", "...and so does the warning");
    CUR.range = "re-check 11/11 (f) the unit published to him, then Sat + Sun given to Acton by hand";
    const g4 = GEN.generate(ctxOf({ schedule: { "2027-05-29": rowOf(ACTON, true), "2027-05-30": rowOf(ACTON, true), "2027-05-31": rowOf(FIERCE, true, "east-derived") } }), "2027-05-17", "2027-06-06", { seed: s, bestOf: 2 }), G4 = g4.diagnostics;
    DW_RUNS.n++;
    ok(isHis(g4.schedule["2027-05-31"], P) && g4.schedule["2027-05-29"].primary === ACTON && g4.schedule["2027-05-30"].primary === ACTON, "every lock stands: Acton Sat + Sun, Fierce Mon");
    eq(unitLines(G4), ["holiday unit: Memorial Day is not kept whole with " + NAME[FIERCE] + "'s derived week (Silvis primary) - 2027-05-31 is his while 2027-05-29, 2027-05-30 of the unit are not (split - settle it by hand)"], "the warning names the split and its days - it never says the unit stays with him");
  }
  CUR.range = "-"; CUR.seed = "-"; CUR.day = "-";
}

const total = Date.now() - T_FILE;
// the run count is asserted (8 seeds x 4 + 2 seeds x 13 + 4 seeds x 14 - the block's 31 call sites): an emptied loop must not pass
eq(DW_RUNS.n, 114, "the derived-week runs");
ok(total <= BUDGET_MS, "test file took " + total + " ms (budget " + BUDGET_MS + " ms" + (process.env.SILVIS_GEN_BUDGET_MS ? " via SILVIS_GEN_BUDGET_MS" : "") + ") - the derived-week runs must stay under it; never downgrade this to a warning");
console.log("ok " + N + " assertions (derived weeks: " + DW_RUNS.n + " runs - a derived week, a holiday unit and his own vacation, Faraz 11/11; " + total + " ms; budget " + BUDGET_MS + " ms" + (process.env.SILVIS_GEN_BUDGET_MS ? " via SILVIS_GEN_BUDGET_MS" : "") + ")");
