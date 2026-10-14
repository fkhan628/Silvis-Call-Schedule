// Silvis - Prompt 32 step 5 (10/12): "painting everything" - does a surgeon who paints every day of a period pay more
// than his share + 1, and why. From code + fixtures only (Faraz 10/11: no live offers are read).
//
// The fixture is synthetic on purpose: a pool of five plain surgeons (no weekday rule, no East feed, no list, no cap of
// their own - every one on the group default) over Mon 2027-02-01 .. Wed 2027-03-31 (no holiday unit, whole weekend
// units), so nothing but the offers and the equal shares decides. One period covers the range; every mode is the default
// 'preferred'. The group rules are the seed's (Prompt 32 values: the soft 7, the shift weights primary 1 / backup 0.5).
//   painters p1, p2  - offer EVERY day of the period as 'either'
//   colleagues c1-c3 - offer every 4th / 5th / 7th day as 'either' (about 7 / 6 / 4 a month), so each is 'submitted' and,
//                      in preferred mode, carries +weights.outsideOffers (6) on every other day and role (B10: he painted
//                      in that month)
// Shares: February 28 / 5 = 5.6 per role (weighted 5.6 + 0.5 x 5.6 = 8.4), March 31 / 5 = 6.2 (weighted 9.3) - nobody is
// clipped, so the weighted backup fill gives the plain equal share (Prompt 32 step 2).
//
// Why the painters end over their share (code facts, generator.js genOfferTaper / genSmooth, rules.js rdStatic offers):
// a painter's 'offered' bonus (-6) tapers to -weights.offerBonusOverShare (0) once he reaches his share, while a
// colleague's 'outside-offers' (+6) is never tapered. With the convex share term (W.low x |count - T|^2) the painter at
// share + k still beats a colleague at share + k' while k < k' + 3; smoothing (tolerance 2 < 6) never moves such a day
// back, and best-of-N reads each outside-offers placement at 1e3 per weight unit against 300 / 100 per convex unit.
// The two controls prove the cause: with the colleagues rules-only (no +6 anywhere) or with nobody painting, the
// painters sit at their share +/- rounding.
//
// Measured 10/12 (seeds 1-8 at bestOf 2, 16 painter-months per painter; excess = count - target, weighted = P + 0.5 B
// against tP + 0.5 tB):
//   BEFORE Prompt 32 - origin/main's rules.js / generator.js (git show origin/main:<file> into a temp dir outside the
//     repo, engine = 4d79cea) with the pre-32 group values (defaultMonthlyCap { primary: 8 }, shiftAccounting.weights
//     null): p1 P/B 117/122, excess max P +2.4 / B +2.4 / weighted +3.1 (mean +1.41 / +1.73 / +2.27); p2 P/B 115/118,
//     max +1.8 / +2.4 / +2.7 (mean +1.29 / +1.48 / +2.02) - painters reached 8 primaries (under the hard 8) and 8
//     backups; the partial painters ended at a mean weighted -1.04 / -1.6 / -1.66.
//   AFTER Prompt 32 - this code with the seed (the soft 7): the soft limit holds the primaries at 7 (never 8 - a
//     colleague below his share can take the 8th), but the surplus moves to the backups: p1 P/B 110/123, max +1.4 / +2.8
//     / +2.6 (mean +0.97 / +1.79 / +1.87); p2 P/B 111/122, max +1.4 / +2.4 / +2.6 (mean +1.04 / +1.73 / +1.9); the
//     partial painters end at a mean weighted -1.01 / -1.32 / -1.44.
//   The controls (seeds 1-4) read the same on both engines: rules-only p1 50/49, p2 48/48; nobody 47/47 each.
//   So painting everything still costs more than share + 1 (backup up to share + 2.8, weighted up to + 2.6). The
//   smallest fix found (prototyped in a scratch copy, NOT applied - a decision for Faraz) and its numbers are in the
//   private report (REPORT-PROMPT-32-2026-10-11.md, "Step 5 - painting"); applying a fix moves the PARTIAL pins below
//   deliberately and must keep the two control pins as they are.
// The pins are the observed after-numbers (re-derive them from a run when the engine changes; never loosen them).
//
// Wall clock: SILVIS_GEN_BUDGET_MS (shared with the regression, the holidays and the water-fill suites) overrides the
// default 4000 ms (16 runs at bestOf 2, ~0.4 s on the dev machine); the budget is a failing assertion, never a warning.
// Run: node test/painting.test.js   (exit 1 on the first failing assertion)
"use strict";
const fs = require("fs");
const path = require("path");

const SEED_FILE = path.join(__dirname, "..", "docs", "silvis-seed.json");
const pad2 = (n) => (n < 10 ? "0" : "") + n;
const dayNum = (s) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000);
const fromDayNum = (n) => { const d = new Date(n * 86400000); return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate()); };
const daysList = (a, b) => { const out = []; for (let n = dayNum(a); n <= dayNum(b); n++) out.push(fromDayNum(n)); return out; };
const r2 = (v) => Math.round(v * 100) / 100;

const START = "2027-02-01", END = "2027-03-31";
const DAYS = daysList(START, END);
const MONTHS = ["2027-02", "2027-03"];
const PAINTERS = ["p1", "p2"], COLLEAGUES = ["c1", "c2", "c3"], IDS = PAINTERS.concat(COLLEAGUES);
// the colleagues' painted days: index i of the day in the period
const PARTIAL = { c1: (i) => i % 4 === 0, c2: (i) => i % 5 === 1, c3: (i) => i % 7 === 2 };
// variant: "partial" (the case) | "rulesOnly" (control: the colleagues go by their rules) | "nobody" (control: no offer)
// data:    "after" (the seed - Prompt 32) | "before" (the pre-32 group values: defaultMonthlyCap { primary: 8 }, weights null)
function fixtureInput(seed, variant, data) {
  const gr = JSON.parse(JSON.stringify(seed.groupRules));
  if (data === "before") { gr.defaultMonthlyCap = { primary: 8 }; gr.shiftAccounting = Object.assign({}, gr.shiftAccounting, { weights: null }); }
  const roster = IDS.map((id) => ({ id: id, name: "Fixture" + id.toUpperCase(), code: id.toUpperCase() + "X", fullName: "Fixture surgeon " + id, active: true, roles: ["surgeon"] }));
  const surgeonRules = {};
  IDS.forEach((id) => { surgeonRules[id] = { poolMember: true, backupOptOut: false, maxConsecutiveDays: 3, maxConsecutiveAnyRole: 4, holidayUnitCountsAsOneDay: false }; });
  const period = { id: "p32-painting-2027", label: "Painting fixture Feb - Mar 2027", start_day: START, end_day: END, offers_close_at: "2027-01-04", publish_by: "2027-01-11", status: "closed", rules_only_ids: variant === "rulesOnly" ? COLLEAGUES.slice() : [], offer_modes: {} };
  const offers = [];
  const offer = (id, d) => ({ person_id: id, day: d, role_pref: "either", source: "app", entered_by: id, note: null });
  if (variant !== "nobody") DAYS.forEach((d, i) => {
    PAINTERS.forEach((id) => offers.push(offer(id, d)));
    if (variant === "partial") COLLEAGUES.forEach((id) => { if (PARTIAL[id](i)) offers.push(offer(id, d)); });
  });
  return { roster: roster, surgeonRules: surgeonRules, groupRules: gr, holidays: seed.holidays, timeOffRows: [], availabilityRows: [], schedule: {}, periods: [period], offers: offers, today: "2026-11-23" };
}

// Runs the fixture on the given engine (R = rules.js, GEN = generator.js - the repo's, or another copy for a before /
// after comparison) and returns per surgeon the month cells { seed, month, p, b, tP, tB, ws } plus per-run facts.
function measure(R, GEN, opts) {
  const seed = opts.seedData || JSON.parse(fs.readFileSync(SEED_FILE, "utf8"));
  const ctx = R.buildContext(fixtureInput(seed, opts.variant, opts.data || "after"));
  const cells = {}, runs = [];
  IDS.forEach((id) => { cells[id] = []; });
  opts.seeds.forEach((sd) => {
    const out = GEN.generate(ctx, START, END, { seed: sd, bestOf: opts.bestOf || 2 });
    const D = out.diagnostics;
    runs.push({ seed: sd, open: D.uncovered.length, hard: D.hardViolations.length, overSoftLimit: (D.overSoftLimit || []).length });
    MONTHS.forEach((m) => {
      const mem = D.impliedTargets.months[m].members;
      IDS.forEach((id) => {
        const p = DAYS.filter((d) => d.slice(0, 7) === m && out.schedule[d].primary === id).length;
        const b = DAYS.filter((d) => d.slice(0, 7) === m && out.schedule[d].backup === id).length;
        const tP = mem[id].primaryTarget, tB = mem[id].backupTarget;
        cells[id].push({ seed: sd, month: m, p: p, b: b, tP: tP, tB: tB, ws: r2(tP + 0.5 * tB) });
      });
    });
  });
  return { ctx: ctx, cells: cells, runs: runs };
}
// per surgeon: total P / B over the cells and the max / mean excess per role and weighted (P + 0.5 B against tP + 0.5 tB)
function summarize(list) {
  const exP = list.map((c) => c.p - c.tP), exB = list.map((c) => c.b - c.tB), exW = list.map((c) => c.p + 0.5 * c.b - c.ws);
  const max = (a) => r2(Math.max.apply(null, a)), mean = (a) => r2(a.reduce((s, v) => s + v, 0) / a.length);
  return { P: list.reduce((s, c) => s + c.p, 0), B: list.reduce((s, c) => s + c.b, 0), max: [max(exP), max(exB), max(exW)], mean: [mean(exP), mean(exB), mean(exW)] };
}

// h = { R, GEN, ok, eq, log }
function run(h) {
  const R = h.R, GEN = h.GEN, ok = h.ok, eq = h.eq, log = h.log || (() => {});
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf8"));
  const W = seed.groupRules.weights;
  // the weights the finding is about (a change here re-opens step 5)
  eq([W.offerBonus, W.outsideOffers, W.offerBonusOverShare, W.smoothingTolerance, W.low, W.deviationConvexity], [6, 6, 0, 2, 1, 2], "seed: offerBonus 6 / outsideOffers 6 / offerBonusOverShare 0 / smoothingTolerance 2 / low 1 / convexity 2 (the painting finding is measured on these)");
  eq([seed.groupRules.defaultMonthlyCap, R.shiftWeightsOf(seed.groupRules)], [{ preferred: 7 }, { primary: 1, backup: 0.5 }], "seed: the group's soft 7 and the shift weights primary 1 / backup 0.5 (Prompt 32)");

  // ---- the case: two full painters, three partial painters (preferred) ----
  const A = measure(R, GEN, { variant: "partial", data: "after", seeds: [1, 2, 3, 4, 5, 6, 7, 8], bestOf: 2, seedData: seed });
  eq(A.ctx.warnings, [], "fixture: buildContext raises no warning");
  eq(IDS.map((id) => [R.monthlyCapFor(A.ctx, id).primary, R.monthlyCapFor(A.ctx, id).preferred]), IDS.map(() => [null, 7]), "fixture: every surgeon on the group default - no hard cap, the soft 7");
  const painted = {};
  IDS.forEach((id) => { painted[id] = MONTHS.map((m) => DAYS.filter((d) => d.slice(0, 7) === m && R.offeredOn(A.ctx, d, "primary", id) && R.offeredOn(A.ctx, d, "backup", id)).length); });
  eq(painted, { p1: [28, 31], p2: [28, 31], c1: [7, 8], c2: [6, 6], c3: [4, 5] }, "fixture: days painted per month ('either') - the painters every day, the colleagues a few");
  IDS.forEach((id) => { const st = R.offerState(A.ctx, "2027-02-10", id); eq([st.status, st.mode], ["submitted", "preferred"], "fixture: " + id + " is submitted in preferred mode"); });
  // B10: a colleague's non-painted day carries +outsideOffers in a month he painted; a painter never does
  const c1Off = DAYS.find((d, i) => !PARTIAL.c1(i));
  ok(R.eligibility(A.ctx, c1Off, "primary", "c1").soft.some((s) => s.reason === "outside-offers" && s.weight === W.outsideOffers), "fixture: c1 carries outside-offers (+" + W.outsideOffers + ") on " + c1Off + ", a day he did not paint");
  ok(DAYS.every((d) => ["primary", "backup"].every((role) => !R.eligibility(A.ctx, d, role, "p1").soft.some((s) => s.reason === "outside-offers"))), "fixture: a full painter carries no outside-offers term anywhere");
  // the shares: 28 / 5 and 31 / 5 per role, the plain equal share (nobody clipped), weighted 8.4 / 9.3
  IDS.forEach((id) => A.cells[id].forEach((c) => eq([c.tP, c.tB, c.ws], c.month === "2027-02" ? [5.6, 5.6, 8.4] : [6.2, 6.2, 9.3], "fixture: " + id + " " + c.month + " seed " + c.seed + " shares P / B / weighted")));
  A.runs.forEach((r) => eq([r.open, r.hard], [0, 0], "partial seed " + r.seed + ": no open slot, no hard violation"));
  // the soft 7 holds every painter-month at 7 primaries or fewer (a colleague below his share is eligible for the 8th),
  // so no day is over the soft limit
  PAINTERS.forEach((id) => ok(A.cells[id].every((c) => c.p <= 7), id + ": at most 7 primaries a month under the soft 7 (got " + A.cells[id].map((c) => c.p).join(" ") + ")"));
  eq(A.runs.map((r) => r.overSoftLimit), [0, 0, 0, 0, 0, 0, 0, 0], "partial: no primary day over the soft limit on any seed");
  const sP = {}; IDS.forEach((id) => { sP[id] = summarize(A.cells[id]); });
  // THE FINDING (pinned as observed 10/12; a fix moves these deliberately): painting everything costs more than
  // share + 1 - the backup up to share + 2.8 and the weighted load up to + 2.6, every painter-month over share in the
  // weighted reading - while the partial painters end below theirs
  eq([sP.p1.P, sP.p1.B, sP.p1.max, sP.p1.mean], [110, 123, [1.4, 2.8, 2.6], [0.97, 1.79, 1.87]], "partial: p1 totals P / B over 16 months and the excess max / mean (P, B, weighted)");
  eq([sP.p2.P, sP.p2.B, sP.p2.max, sP.p2.mean], [111, 122, [1.4, 2.4, 2.6], [1.04, 1.73, 1.9]], "partial: p2 totals P / B over 16 months and the excess max / mean (P, B, weighted)");
  eq(COLLEAGUES.map((id) => sP[id].mean[2]), [-1.01, -1.32, -1.44], "partial: the partial painters' mean weighted excess (c1, c2, c3)");
  PAINTERS.forEach((id) => ok(A.cells[id].every((c) => c.p + 0.5 * c.b > c.ws), id + ": over his weighted share in every painter-month (the painters carry the colleagues' unpainted days)"));
  PAINTERS.forEach((id) => ok(sP[id].max[1] > 1 && sP[id].max[2] > 1, id + ": the share + 1 bound fails in the partial case (backup " + sP[id].max[1] + ", weighted " + sP[id].max[2] + ") - the step 5 finding"));
  COLLEAGUES.forEach((id) => ok(sP[id].mean[2] < 0, id + ": a partial painter ends below his weighted share on average (" + sP[id].mean[2] + ")"));
  // every slot is held: per month the five hold all of it
  MONTHS.forEach((m, mi) => [1, 2, 3, 4, 5, 6, 7, 8].forEach((sd, si) => {
    const cellsAt = IDS.map((id) => A.cells[id][si * 2 + mi]);
    const slots = DAYS.filter((d) => d.slice(0, 7) === m).length;
    eq([cellsAt.reduce((s, c) => s + c.p, 0), cellsAt.reduce((s, c) => s + c.b, 0)], [slots, slots], "partial seed " + sd + " " + m + ": the five hold every primary and backup slot");
  }));

  // ---- the controls: the bound holds when no colleague carries the untapered +6 ----
  const ctl = {};
  ["rulesOnly", "nobody"].forEach((variant) => {
    const C = measure(R, GEN, { variant: variant, data: "after", seeds: [1, 2, 3, 4], bestOf: 2, seedData: seed });
    eq(C.ctx.warnings, [], variant + ": buildContext raises no warning");
    C.runs.forEach((r) => eq([r.open, r.hard, r.overSoftLimit], [0, 0, 0], variant + " seed " + r.seed + ": no open slot, no hard violation, nothing over the soft limit"));
    if (variant === "rulesOnly") COLLEAGUES.forEach((id) => eq(R.offerState(C.ctx, "2027-02-10", id).status, "rules_only", "rulesOnly: " + id + " goes by his rules"));
    if (variant === "nobody") IDS.forEach((id) => eq(R.offerState(C.ctx, "2027-02-10", id).status, "not_started", "nobody: " + id + " has not painted"));
    ctl[variant] = {};
    // per role every surgeon stays within share + 1 (rounding: 7 against 6.2), and the painters within weighted share + 1;
    // the weighted reading of a non-painter can still read + 1.2 by rounding alone (nobody, c3: a 7 / 7 March against
    // 6.2 / 6.2), so it is not asserted for him
    IDS.forEach((id) => {
      ctl[variant][id] = summarize(C.cells[id]);
      C.cells[id].forEach((c) => ok(c.p - c.tP <= 1 && c.b - c.tB <= 1 && (COLLEAGUES.includes(id) || c.p + 0.5 * c.b - c.ws <= 1), variant + ": " + id + " " + c.month + " seed " + c.seed + " within share + 1 (" + c.p + " / " + c.b + " against " + c.tP + " / " + c.tB + ")"));
    });
  });
  // pinned as observed 10/12 (identical on the pre-32 engine with the pre-32 values: no colleague carries a term the cap
  // or the weights would read differently)
  eq(PAINTERS.map((id) => [ctl.rulesOnly[id].P, ctl.rulesOnly[id].B, ctl.rulesOnly[id].max[2]]), [[50, 49, 0.7], [48, 48, 0.6]], "rulesOnly: the painters' P / B totals over 8 months and their max weighted excess");
  eq(PAINTERS.map((id) => [ctl.nobody[id].P, ctl.nobody[id].B, ctl.nobody[id].max[2]]), [[47, 47, 0.6], [47, 47, 0.7]], "nobody: the P / B totals over 8 months and the max weighted excess");

  const fmt = (s) => s.P + "P/" + s.B + "B, excess max P +" + s.max[0] + " B +" + s.max[1] + " W +" + s.max[2] + " (mean W +" + s.mean[2] + ")";
  const line = "painting (Feb-Mar 2027 fixture, bestOf 2): partial seeds 1-8 - p1 " + fmt(sP.p1) + "; p2 " + fmt(sP.p2) + "; controls seeds 1-4 - rules-only max W +" + Math.max(ctl.rulesOnly.p1.max[2], ctl.rulesOnly.p2.max[2]) + ", nobody max W +" + Math.max(ctl.nobody.p1.max[2], ctl.nobody.p2.max[2]);
  log(line);
  return { line: line, partial: sP, controls: ctl };
}

module.exports = { run, measure, summarize, fixtureInput, IDS, PAINTERS, COLLEAGUES, START, END, MONTHS };

if (require.main === module) {
  const T0 = Date.now();
  const BUDGET_MS = process.env.SILVIS_GEN_BUDGET_MS ? Math.floor(+process.env.SILVIS_GEN_BUDGET_MS) : 4000;
  const R = require("../rules.js");
  const GEN = require("../generator.js");
  let N = 0;
  const ok = (cond, msg) => { N++; if (!cond) { console.error("FAIL: " + msg); process.exit(1); } };
  const eq = (a, b, msg) => { N++; if (JSON.stringify(a) !== JSON.stringify(b)) { console.error("FAIL: " + msg + " expected " + JSON.stringify(b) + " got " + JSON.stringify(a)); process.exit(1); } };
  run({ R, GEN, ok, eq, log: (s) => console.log("  " + s) });
  const total = Date.now() - T0;
  ok(total <= BUDGET_MS, "test file took " + total + " ms (budget " + BUDGET_MS + " ms" + (process.env.SILVIS_GEN_BUDGET_MS ? " via SILVIS_GEN_BUDGET_MS" : "") + ") - the 16 fixture runs must stay under it; never downgrade this to a warning");
  console.log("ok " + N + " assertions (painting: two full painters against partial painters, Prompt 32 step 5; " + total + " ms; budget " + BUDGET_MS + " ms" + (process.env.SILVIS_GEN_BUDGET_MS ? " via SILVIS_GEN_BUDGET_MS" : "") + ")");
}
