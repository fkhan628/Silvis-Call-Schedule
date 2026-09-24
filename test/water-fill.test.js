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
// November backups beyond his 8 locked days go only to days where no other pool member eligible
// for the slot ends the month below share; (3) the per-surgeon tallies and the slot count that
// differs from the published rows are the what-if of docs/REPORT-WATER-FILL-2026-09-23.md, pinned
// as observed (seed 7, bestOf 200, convexity 2). The fixture holds ids, dates, lock flags and
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
  const NOV_PIN = { [KHAN]: { primary: 7, backup: 5 }, [BURCHETT]: { primary: 6, backup: 4 }, [ACTON]: { primary: 9, backup: 4 }, [PHILIP]: { primary: 6, backup: 5 }, [FIERCE]: { primary: 0, backup: 11 }, [SARKAR]: { primary: 2, backup: 1 } };
  const DEC_PIN = { [KHAN]: { primary: 6, backup: 6 }, [BURCHETT]: { primary: 5, backup: 7 }, [ACTON]: { primary: 6, backup: 6 }, [PHILIP]: { primary: 5, backup: 6 }, [FIERCE]: { primary: 7, backup: 6 }, [SARKAR]: { primary: 2, backup: 0 } };
  eq(novW, NOV_PIN, "WF: November tallies (merged backfill + milestone) = the what-if (published: Fierce 16 backups, Khan 3)");
  eq(decW, DEC_PIN, "WF: December tallies (merged) = the what-if");
  const novI = outM.diagnostics.impliedTargets.months["2026-11"], novLevelB = novI.backupShare;
  eq([novI.primaryShare, novLevelB, novI.members[FIERCE].backupTarget, novI.members[FIERCE].lockedHeld.backup], [5.6, 5.8, 5.8, 8], "WF: November levels 5.6 P / 5.8 B; Fierce's backup target is the level, his 8 locked backups above it");
  eq([novI.poolSlots, novI.heldByPool], [{ primary: 28, backup: 29 }, { primary: 20, backup: 14 }], "WF: November pool slots 28 P (8 open + 20 held) / 29 B (15 open + 14 held)");
  // (2) every generated Fierce November backup sits on a day where no other pool member passes eligibility for the
  //     slot on the final schedule with NO soft penalty and ends the month below share - the share allows him nothing
  //     else (11/25: Philip is hard-eligible but carries backup-after-primary + long-run:6 = 7 soft points; 11/21-22:
  //     Khan is the primary, Acton on vacation, Burchett off his list, Philip at his weekend backup cap, Sarkar outside
  //     her window)
  const ctxFinal = R.buildContext(Object.assign({}, FXW.input, { schedule: mergedW, rangeStart: BFW.start, rangeEnd: MS.end }));
  const fierceGen = monthDays("2026-11").filter((d) => mergedW[d] && mergedW[d].backup === FIERCE && !mergedW[d].backupLocked);
  eq(fierceGen.length, novW[FIERCE].backup - 8, "WF: Fierce's generated November backups = his tally beyond the 8 locked days (" + fierceGen.join(", ") + ")");
  eq(fierceGen, ["2026-11-21", "2026-11-22", "2026-11-25"], "WF: Fierce's three generated November backups are the Sat/Sun of Khan's weekend and Khan's locked 11/25 - the slots nobody below share could hold cleanly");
  fierceGen.forEach((d) => {
    const below = POOL.filter((id) => { if (id === FIERCE || novW[id].backup >= novLevelB) return false; const r = R.eligibility(ctxFinal, d, B, id); return r.ok && r.soft.reduce((s, x) => s + (Number(x.weight) || 0), 0) <= 0; });
    eq(below, [], "WF: Fierce took " + d + " backup although " + below.map((id) => CODE[id]).join(", ") + " (below share, eligible, no soft penalty) could hold it");
  });
  // (3) the slots that differ from the published rows (_meta.published = the 112 live rows of 12:38Z, ids only)
  const pubW = FXW._meta.published, diffW = [];
  Object.keys(pubW).sort().forEach((d) => ROLES.forEach((role) => { const x = pubW[d][role] || null, y = (mergedW[d] && mergedW[d][role]) || null; if (x !== y) diffW.push(d + " " + role[0].toUpperCase()); }));
  eq(Object.keys(pubW).length * 2, 224, "WF: the published state has 112 rows = 224 slots");
  eq(diffW.length, 34, "WF: 34 of the 224 slots differ from the published rows (got " + diffW.length + ": " + diffW.join(", ") + ")");
  eq([outM.diagnostics.score.total, outM.diagnostics.candidateScores.indexOf(outM.diagnostics.score.total)], [115551, 20], "WF: milestone best-of-200 score / candidate as observed");
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
