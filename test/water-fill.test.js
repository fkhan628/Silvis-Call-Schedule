// Silvis - WF (decision 9/23, the water-filled share): the November 2026 case on the exact
// pre-publish inputs. Its own chain step (fix stage of the 9/23 review): the two bestOf-200 runs
// cost ~2 s, which pushed test/generator-regression.js over its 10 s budget on a loaded developer
// machine, and that budget is a failing assertion by design.
//
// test/fixtures/water-fill-2026-10-07-to-2027-01-03.json = the generator inputs as they stood
// before the 9/23 06:32Z publish (see its _meta; the flat-share generator at 8b38740 reproduces
// the published preview over it byte for byte). The two runs the publish tool made - milestone
// 11/02..01/03, then backfill 10/07..11/01 fill-open-only, seed 7, bestOf 200 - with the
// water-filled share: (1) nothing opens but 10/15 primary, no hard violation; (2) Fierce's
// November backups beyond his 8 locked days go only to days where moving one to a cleanly
// eligible colleague would not lower the convex backup deviation (Prompt 32 step 2: each against
// his own weighted target; it read "no colleague below share"); (3) the per-surgeon tallies and
// the slot count that differs from the published rows are the what-if of
// docs/REPORT-WATER-FILL-2026-09-23.md, pinned as observed (seed 7, bestOf 200, convexity 2).
// Since Prompt 32 (10/11) rules.js reads the frozen blob's Khan / Acton monthlyCap null as its
// group default (a hard 8), and step 2 clips the shares at what the rules allow and weighs the
// backup across the roles (Fierce, who can hold 2 November primaries, is targeted at 13.3 backups),
// so the run differs from that report (re-pinned from a real run; each moved number is explained
// at its pin). The fixture holds ids, dates, lock flags and
// sources only - never a note, never contact data (asserted).
//
// Wall clock: SILVIS_GEN_BUDGET_MS (shared with the regression and the holidays suite) overrides
// the default 6000 ms; the budget is a failing assertion, never a warning.
// Run: node test/water-fill.test.js   (exit 1 on the first failing assertion)
"use strict";
const fs = require("fs");
const path = require("path");

const FIXTURE = path.join(__dirname, "fixtures", "water-fill-2026-10-07-to-2027-01-03.json");
const pad2 = (n) => (n < 10 ? "0" : "") + n;
const dayNum = (s) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000);
const fromDayNum = (n) => { const d = new Date(n * 86400000); return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate()); };
const daysList = (a, b) => { const out = []; for (let n = dayNum(a); n <= dayNum(b); n++) out.push(fromDayNum(n)); return out; };
const monthDays = (m) => { const y = +m.slice(0, 4), mm = +m.slice(5, 7), dim = new Date(Date.UTC(y, mm, 0)).getUTCDate(); const out = []; for (let d = 1; d <= dim; d++) out.push(m + "-" + pad2(d)); return out; };
const P = "primary", B = "backup", ROLES = [P, B];

// h = { R, GEN, ok, eq, log }; returns { line, wfMs } for the caller's summary.
function run(h) {
  const R = h.R, GEN = h.GEN, ok = h.ok, eq = h.eq;
  const log = h.log || (() => {});
  const FXW = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const roster = FXW.input.roster, SR = FXW.input.surgeonRules;
  const byCode = (code) => { const r = roster.find((x) => x.code === code); if (!r) throw new Error("fixture roster has no code " + code); return r.id; };
  const KHAN = byCode("FAK"), BURCHETT = byCode("MAB"), ACTON = byCode("BDA"), PHILIP = byCode("AFP"), FIERCE = byCode("NF"), SARKAR = byCode("SRK");
  const IDS = roster.filter((r) => r.active !== false).map((r) => r.id);
  const CODE = {}; roster.forEach((r) => { CODE[r.id] = r.code; });
  const POOL = IDS.filter((id) => SR[id] && SR[id].poolMember !== false && !(Array.isArray(SR[id].availableWindows) && SR[id].availableWindows.length) && (roster.find((r) => r.id === id) || {}).type !== "external");
  eq(POOL, [KHAN, BURCHETT, ACTON, PHILIP, FIERCE], "WF fixture: the pool is the five (Sarkar has windows)");
  const MS = FXW._meta.ranges.milestone, BFW = FXW._meta.ranges.backfill;
  eq([FXW._meta.seed, FXW._meta.bestOf, Object.keys(FXW.input.schedule).length], [7, 200, 71], "WF fixture: seed 7, bestOf 200, 71 pre-publish rows");
  ok(FXW.input.surgeonRules[BURCHETT].explicitListMonths.includes("2026-12"), "WF fixture: Burchett's December entry is the plain form the 05:28Z generate saw");
  ok(!JSON.stringify(FXW.input).match(/"note"|@/), "WF fixture carries no notes and no contact data");
  const ctxW = R.buildContext(Object.assign({}, FXW.input, { rangeStart: MS.start, rangeEnd: MS.end }));
  // The pre-publish blob still carried the two group keys the engine never read (dropped from the seed by audit
  // RG-1 / RG-2, 9/23; rules.js warns once per key while a blob carries them). The fixture stays the exact
  // snapshot, so exactly those two notices are expected here - and nothing else.
  // B10 (9/23) dropped eleven more read-by-nothing keys from the seed (rules.js warns per group key and once per surgeon):
  // the fixture blob carries them all, so it earns 3 group notices (generationHorizons.presets, eastFeed.forecast.penaltyBelowThreshold,
  // locks.nullSlotIsNeverLocked) + 5 surgeon notices (s1 weekendsInPool + holidays2026, s2 holidayPreference, s3 the two holidayRules
  // keys, s4 preferences.noFullWeek, s5 the four liveVerified* keys) on top of RG-1 / RG-2 = 10.
  const isDeadKeyW = (w) => /groupRules.holidays.anyoneMayCoverUnlessOptedOut|groupRules.eastFeed.unknownIsBusy|groupRules\.(generationHorizons\.presets|eastFeed\.forecast\.penaltyBelowThreshold|locks\.nullSlotIsNeverLocked) is not read|^surgeonRules\.s[1-5]: ignored key/.test(w);
  eq(ctxW.warnings.filter(isDeadKeyW).length, 10, "buildContext warnings (WF fixture): the dead-key notices the pre-publish blob earns (RG-1, RG-2 + B10's 3 group + 5 surgeon notices): " + JSON.stringify(ctxW.warnings.filter(isDeadKeyW)));
  eq(ctxW.warnings.filter((w) => !isDeadKeyW(w)), [], "buildContext warnings (WF fixture)");
  // Prompt 32 (Faraz 10/11): monthlyCap null reads the group default. The fixture is the frozen pre-publish blob - Khan and
  // Acton null, defaultMonthlyCap { primary: 8 } - so rules.js now caps both at a HARD 8 inside it (they were uncapped).
  eq([KHAN, BURCHETT, ACTON, PHILIP, FIERCE, SARKAR].map((id) => { const c = R.monthlyCapFor(ctxW, id); return [c.primary, c.preferred]; }), [[8, null], [8, 7], [8, null], [8, null], [14, null], [8, null]],
    "WF fixture caps as Prompt 32 reads the frozen blob: Khan / Acton null = the fixture's group default 8 (hard), Burchett 8 / 7, Philip / Sarkar absent = 8, Fierce 14");
  const tw0 = Date.now();
  const outM = GEN.generate(ctxW, MS.start, MS.end, { seed: FXW._meta.seed, bestOf: FXW._meta.bestOf, respectLocks: true });
  const outB = GEN.generate(ctxW, BFW.start, BFW.end, { seed: FXW._meta.seed, bestOf: FXW._meta.bestOf, respectLocks: true, fillOpenOnly: true });
  const wfMs = Date.now() - tw0;
  eq(outM.diagnostics.uncovered.map((u) => u.day + " " + u.role), [], "WF milestone: no open slot");
  eq(outB.diagnostics.uncovered.map((u) => u.day + " " + u.role), ["2026-10-15 primary"], "WF backfill: 10/15 primary is the only open slot");
  eq([outM.diagnostics.hardViolations, outB.diagnostics.hardViolations], [[], []], "WF: no hard violation in either run");
  ok(!outM.diagnostics.warnings.some((w) => /deviationConvexity/.test(w)) && !outB.diagnostics.warnings.some((w) => /deviationConvexity/.test(w)), "WF: no deviationConvexity warning (the fixture blob carries no knob; the code default applies silently)");
  eq(outM.diagnostics.impliedTargets.convexity, 2, "WF: convexity 2 in force (the fixture blob has no knob: the code default)");
  const mergedW = {}; Object.keys(FXW.input.schedule).forEach((d) => { mergedW[d] = FXW.input.schedule[d]; }); Object.keys(outB.schedule).forEach((d) => { mergedW[d] = outB.schedule[d]; }); Object.keys(outM.schedule).forEach((d) => { mergedW[d] = outM.schedule[d]; });
  const tallyW = (from, to) => { const t = {}; IDS.forEach((id) => { t[id] = { primary: 0, backup: 0 }; }); daysList(from, to).forEach((d) => { const e = mergedW[d]; if (!e) return; if (e.primary && t[e.primary]) t[e.primary].primary++; if (e.backup && t[e.backup]) t[e.backup].backup++; }); return t; };
  const novW = tallyW("2026-11-01", "2026-11-30"), decW = tallyW("2026-12-01", "2026-12-31");
  // Prompt 32: no fixture member ends a month over the hard 8 the frozen blob now gives Khan and Acton (Acton held 9 November
  // primaries when his null read "uncapped": his 8 locked days plus one generated)
  ok([KHAN, ACTON].every((id) => novW[id].primary <= 8 && decW[id].primary <= 8), "WF (Prompt 32): Khan / Acton at most 8 primaries in November and December under the fixture's default 8: " + JSON.stringify([novW[KHAN], novW[ACTON], decW[KHAN], decW[ACTON]]));
  // pin moved deliberately 10/11: Prompt 32 rules.js reads the frozen blob's Khan / Acton null as its group default 8 (hard),
  // re-derived from a real run (seed 7, bestOf 200). November: Acton 9 -> 8 primaries - his 9th (the generated 11/30, on top
  // of his 8 locked days) is over the hard 8, so 11/30 primary goes to Khan (7 -> 8, at his own 8) and Khan's 11/30 backup to
  // Acton (4 -> 5 backups); 11/19 backup Philip -> Khan keeps Khan at 5 backups, Philip 5 -> 4. December primaries are
  // unchanged; the new best candidate reshuffles nine December backup slots, net Burchett 7 -> 6 and Philip 6 -> 7 backups.
  // Was NOV Khan 7/5, Acton 9/4, Philip 6/5 and DEC Burchett 5/7, Philip 5/6.
  // pin moved deliberately 10/11: Prompt 32 step 2 (the fill clips + the weighted backup), re-derived from a real run (seed 7,
  // bestOf 200). November's targets move (see the levels pin below): the fill clips are Fierce 2 (2 allowed + 0 held), Burchett 6
  // (0 + 6 held), Philip 6 (5 + 1), Khan / Acton their hard 8 - so the 28 primaries fill to a level of 7 (Khan, Acton) - and the
  // weighted backup asks 2 backups per missing primary: Fierce 3.25 + 2 x 5 = 13.25 -> 13.3, Philip 5.25 -> 5.3, Burchett 4 (his
  // backup fill clip: 0 allowed + 4 held), Khan / Acton 3.25 -> 3.3 (was 5.8 for everyone). So November backups: Fierce 11 -> 14 (generated 11/05, 11/20,
  // 11/21, 11/22, 11/24, 11/25 beside his 8 locked), Philip 4 -> 5, Khan 5 -> 4, Acton 5 -> 3, Sarkar 1 -> 0 (Burchett 4 and
  // every November primary unchanged; 11/30 stays Khan / Acton). December's levels are unchanged (5.8 / 6.2: no fill clip binds,
  // equal primaries -> the plain backup share); its primaries move once between Acton and Philip (Acton 6 -> 5, Philip 5 -> 6)
  // in the new best candidate, every December backup count unchanged.
  // Step 3 read NOV Khan 8/5, Acton 8/5, Philip 6/4, Fierce 0/11, Sarkar 2/1 and DEC Acton 6/6, Philip 5/7.
  const NOV_PIN = { [KHAN]: { primary: 8, backup: 4 }, [BURCHETT]: { primary: 6, backup: 4 }, [ACTON]: { primary: 8, backup: 3 }, [PHILIP]: { primary: 6, backup: 5 }, [FIERCE]: { primary: 0, backup: 14 }, [SARKAR]: { primary: 2, backup: 0 } };
  const DEC_PIN = { [KHAN]: { primary: 6, backup: 6 }, [BURCHETT]: { primary: 5, backup: 6 }, [ACTON]: { primary: 5, backup: 6 }, [PHILIP]: { primary: 6, backup: 7 }, [FIERCE]: { primary: 7, backup: 6 }, [SARKAR]: { primary: 2, backup: 0 } };
  eq([outM.schedule["2026-11-30"].primary, outM.schedule["2026-11-30"].backup], [KHAN, ACTON], "WF (Prompt 32): 11/30 primary is Khan's, its backup Acton's - Acton's 9th November primary (over the fixture's hard 8) moved off him");
  eq(novW, NOV_PIN, "WF: November tallies (merged backfill + milestone) = the what-if (published: Fierce 16 backups, Khan 3)");
  eq(decW, DEC_PIN, "WF: December tallies (merged) = the what-if");
  const novI = outM.diagnostics.impliedTargets.months["2026-11"], novLevelB = novI.backupShare;
  // pin moved deliberately 10/11: Prompt 32 step 2 - was [5.6, 5.8, 5.8, 8] ("Fierce's backup target is the level, his 8 locked
  // backups above it"): the primary level is 7 (the fill clips 2 / 6 / 6 take 14 of the 28 slots, Khan and Acton share the other
  // 14), the backup share at that level 3.25 -> 3.3 (W* = 7 + 0.5 x 3.25 = 8.625 -> 8.6: 2 x (W* - 7) x 2 + 2 x (W* - 6) + 4 +
  // 2 x (W* - 2) = 29 backups), and Fierce - 5 primaries below the level - is targeted at 3.25 + 2 x 5 = 13.25 -> 13.3 backups:
  // his 8 locked backups now sit BELOW his target
  eq([novI.primaryShare, novLevelB, novI.weightedShare, novI.members[FIERCE].fillClip.primary, novI.members[FIERCE].backupTarget, novI.members[FIERCE].lockedHeld.backup], [7, 3.3, 8.6, 2, 13.3, 8], "WF (Prompt 32 step 2): November levels 7 P / 3.3 B / W* 8.6; Fierce's primary fill clip 2 -> his weighted backup target 13.3, above his 8 locked backups");
  eq(POOL.map((id) => [novI.members[id].primaryTarget, novI.members[id].backupTarget, novI.members[id].fillClip.primary, novI.members[id].fillClip.backup]), [[7, 3.3, 8, 10], [6, 4, 6, 4], [7, 3.3, 8, 7], [6, 5.3, 6, 7], [2, 13.3, 2, 23]], "WF (Prompt 32 step 2): November targets / fill clips FAK / MAB / BDA / AFP / NF");
  eq([novI.poolSlots, novI.heldByPool], [{ primary: 28, backup: 29 }, { primary: 20, backup: 14 }], "WF: November pool slots 28 P (8 open + 20 held) / 29 B (15 open + 14 held)");
  // Prompt 32 step 2 (Faraz 10/11 decision 3): the cap clip is the soft limit when set, else the hard cap - no "- 1" - minus the
  // East primary-week days: inside the frozen blob Khan / Acton / Philip 8 (their hard 8, was 7), Burchett 7 (his soft 7 under
  // his hard 8, unchanged), Fierce 14 - his 7 November East primary-week days = 7 (was 13 - 7 = 6)
  eq([KHAN, BURCHETT, ACTON, PHILIP, FIERCE].map((id) => novI.members[id].clipPrimary), [8, 7, 8, 8, 7], "WF (Prompt 32 step 2): November cap clips FAK 8 / MAB 7 / BDA 8 / AFP 8 / NF 14 - 7");
  // the weighted view beside the per-role one: W* and every member's weighted share = target P x 1 + target B x 0.5 (the frozen
  // blob's shiftAccounting.weights is null - read as the defaults); the tallies carry it beside .target
  ok(typeof novI.weightedShare === "number" && POOL.every((id) => novI.members[id].weightedShare === Math.round((novI.members[id].primaryTarget + 0.5 * novI.members[id].backupTarget) * 10) / 10), "WF (Prompt 32 step 2): November weightedShare / members' weighted shares = P + 0.5 B: " + JSON.stringify([novI.weightedShare, POOL.map((id) => novI.members[id].weightedShare)]));
  ok(POOL.every((id) => outM.diagnostics.tallies[id].months["2026-11"].weightedShare === novI.members[id].weightedShare && JSON.stringify(Object.keys(outM.diagnostics.tallies[id].months["2026-11"].target)) === JSON.stringify(["primary", "backup"])), "WF (Prompt 32 step 2): tallies carry weightedShare beside a .target that stays { primary, backup }");
  // (2) every generated Fierce November backup sits on a day where no other pool member passes eligibility for the
  //     slot on the final schedule with NO soft penalty and ends the month below share - the share allows him nothing
  //     else (11/25: Philip is hard-eligible but carries backup-after-primary + long-run:6 = 7 soft points; 11/21-22:
  //     Khan is the primary, Acton on vacation, Burchett off his list, Philip at his weekend backup cap, Sarkar outside
  //     her window)
  const ctxFinal = R.buildContext(Object.assign({}, FXW.input, { schedule: mergedW, rangeStart: BFW.start, rangeEnd: MS.end }));
  const fierceGen = monthDays("2026-11").filter((d) => mergedW[d] && mergedW[d].backup === FIERCE && !mergedW[d].backupLocked);
  eq(fierceGen.length, novW[FIERCE].backup - 8, "WF: Fierce's generated November backups = his tally beyond the 8 locked days (" + fierceGen.join(", ") + ")");
  // pin moved deliberately 10/11: Prompt 32 step 2 - six generated backups (was 11/21, 11/22, 11/25): his weighted target is 13.3
  // (2 November primaries he can hold), so 11/05, 11/20 and 11/24 join the Sat/Sun of Khan's weekend and Khan's locked 11/25
  eq(fierceGen, ["2026-11-05", "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-24", "2026-11-25"], "WF: Fierce's six generated November backups (Prompt 32 step 2: his weighted target 13.3)");
  // pin moved deliberately 10/11: Prompt 32 step 2 - this read "no other pool member ... ends the month below share" against the
  // common backup level. The backup targets are per member now (the weighted share: Fierce 13.3, Philip 5.3, Burchett 4, Khan /
  // Acton 3.3), so the check is the one the convex deviation itself makes: moving any generated Fierce November backup to a
  // colleague who passes eligibility on the final schedule with NO soft penalty never strictly lowers the two members' convex
  // backup deviation (|count - own target| ^ 2). The clean colleagues are exactly Khan and Philip on 11/05 and Khan and Acton on
  // 11/24 (pinned); for Khan (4 against 3.3) the move is worse, for Philip (5 -> 6 against 5.3) and Acton (3 -> 4 against 3.3) an
  // exact tie with Fierce's 14 -> 13 against 13.3 (11/20-22: Acton on vacation, Philip at his weekend backup cap, Khan the
  // primary or carrying back-to-back-weekend; 11/25: Philip carries backup-after-primary + long-run).
  const devB = (c, t) => Math.pow(Math.abs(c - t), 2);
  const tgtB = (id) => novI.members[id].backupTarget;
  const clean = [];
  fierceGen.forEach((d) => {
    const better = POOL.filter((id) => {
      if (id === FIERCE) return false;
      const r = R.eligibility(ctxFinal, d, B, id);
      if (!(r.ok && r.soft.reduce((s, x) => s + (Number(x.weight) || 0), 0) <= 0)) return false;
      clean.push(d + " " + CODE[id]);
      const before = devB(novW[FIERCE].backup, tgtB(FIERCE)) + devB(novW[id].backup, tgtB(id)), after = devB(novW[FIERCE].backup - 1, tgtB(FIERCE)) + devB(novW[id].backup + 1, tgtB(id));
      return after < before - 1e-9;
    });
    eq(better, [], "WF: Fierce took " + d + " backup although moving it to " + better.map((id) => CODE[id]).join(", ") + " (eligible, no soft penalty) lowers the convex backup deviation");
  });
  eq(clean, ["2026-11-05 FAK", "2026-11-05 AFP", "2026-11-24 FAK", "2026-11-24 BDA"], "WF (Prompt 32 step 2): the colleagues cleanly eligible for Fierce's generated November backups");
  // (3) the slots that differ from the published rows (_meta.published = the 112 live rows of 12:38Z, ids only)
  const pubW = FXW._meta.published, diffW = [];
  Object.keys(pubW).sort().forEach((d) => ROLES.forEach((role) => { const x = pubW[d][role] || null, y = (mergedW[d] && mergedW[d][role]) || null; if (x !== y) diffW.push(d + " " + role[0].toUpperCase()); }));
  eq(Object.keys(pubW).length * 2, 224, "WF: the published state has 112 rows = 224 slots");
  // pin moved deliberately 10/11: Prompt 32 (the frozen blob's Khan / Acton null = its hard 8) - 34 -> 32: 11/30 P now differs
  // from the published rows (Khan, published Acton) while 12/10 B, 12/17 B and 12/29 B now match them
  // pin moved deliberately 10/11: Prompt 32 step 2 - 32 -> 36. Against the step-3 run 21 slots on 20 days moved: the October
  // backfill hands six backups to Khan / Fierce (10/07, 10/13, 10/15, 10/16, 10/27, 10/29 - Khan's October primary fill clip is 1,
  // so his weighted backup target rises), November gives Fierce 11/05, 11/20, 11/24 and Philip 11/23, December reshuffles nine
  // backups (12/02, 12/09, 12/14, 12/15, 12/23, 12/28 - 12/31) and 12/30 primary Acton -> Philip, and 1/1 backup Khan -> Acton
  eq(diffW.length, 36, "WF: 36 of the 224 slots differ from the published rows (got " + diffW.length + ": " + diffW.join(", ") + ")");
  // pin moved deliberately 10/11: Prompt 32 step 2 - 116951 at candidate 59 -> 91110 at candidate 155: the targets now carry what
  // the rules allow and the weighted backup, so the deviations measure what the generator can still balance - primaryDeviation
  // 49.2 -> 12 (Acton's 8 locked against 7, not 5.6; Fierce's 0 against 2, not 5.6), backupDeviation 41.4 -> 4.8 (Fierce's 14
  // against 13.3, not 11 against 5.8), softSum 98 -> 87, weekendSpread 5 -> 3, holidaySpread 1 -> 0:
  // 87 x 1000 + 12 x 300 + 4.8 x 100 + 3 x 10 + 0 = 91110
  eq([outM.diagnostics.score.total, outM.diagnostics.candidateScores.indexOf(outM.diagnostics.score.total)], [91110, 155], "WF: milestone best-of-200 score / candidate as observed");
  eq([outM.diagnostics.score.softSum, outM.diagnostics.score.primaryDeviation, outM.diagnostics.score.backupDeviation, outM.diagnostics.score.weekendSpread, outM.diagnostics.score.holidaySpread], [87, 12, 4.8, 3, 0], "WF (Prompt 32 step 2): the score parts behind 91110");
  const line = "WF November fixture: " + wfMs + " ms for the two bestOf-200 runs; Nov backups " + POOL.concat([SARKAR]).map((id) => CODE[id] + " " + novW[id].backup).join(", ") + "; " + diffW.length + " of 224 slots differ from the publish";
  log(line);
  return { line: line, wfMs: wfMs };
}

module.exports = { run, FIXTURE };

if (require.main === module) {
  const T0 = Date.now();
  const BUDGET_MS = process.env.SILVIS_GEN_BUDGET_MS ? Math.floor(+process.env.SILVIS_GEN_BUDGET_MS) : 6000;
  const R = require("../rules.js");
  const GEN = require("../generator.js");
  let N = 0;
  const ok = (cond, msg) => { N++; if (!cond) { console.error("FAIL: " + msg); process.exit(1); } };
  const eq = (a, b, msg) => { N++; if (JSON.stringify(a) !== JSON.stringify(b)) { console.error("FAIL: " + msg + " expected " + JSON.stringify(b) + " got " + JSON.stringify(a)); process.exit(1); } };
  run({ R, GEN, ok, eq, log: (s) => console.log("  " + s) });
  const total = Date.now() - T0;
  ok(total <= BUDGET_MS, "test file took " + total + " ms (budget " + BUDGET_MS + " ms" + (process.env.SILVIS_GEN_BUDGET_MS ? " via SILVIS_GEN_BUDGET_MS" : "") + ") - the two bestOf-200 runs must stay under it; never downgrade this to a warning");
  console.log("ok " + N + " assertions (water-fill: the November 2026 case on the pre-publish inputs, seed 7 / bestOf 200 / convexity 2; " + total + " ms; budget " + BUDGET_MS + " ms" + (process.env.SILVIS_GEN_BUDGET_MS ? " via SILVIS_GEN_BUDGET_MS" : "") + ")");
}
