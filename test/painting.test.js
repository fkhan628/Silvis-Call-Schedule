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
// Why the painters ended over their share before fix B (code facts, generator.js genOfferTaper / genSmooth, rules.js
// rdStatic offers): a painter's 'offered' bonus (-6) tapers to -weights.offerBonusOverShare (0) once he reaches his share,
// while a colleague's 'outside-offers' (+6) was never tapered. With the convex share term (W.low x |count - T|^2) the
// painter at share + k still beat a colleague at share + k' while k < k' + 3; smoothing (tolerance 2 < 6) never moved such
// a day back, and best-of-N read each outside-offers placement at 1e3 per weight unit against 300 / 100 per convex unit.
// The two controls prove the cause: with the colleagues rules-only (no +6 anywhere) or with nobody painting, the
// painters sit at their share +/- rounding.
//
// PAINTING FIX B (Faraz 10/18 - the report's recommendation, step 5 (b)): the mirror of the offered taper. A preferred
// colleague's outside-offers term is waived while the placement still brings him towards his share (capacity =
// ceil(T - 0.5) - his count, his offered days first, then his outside days - rules.outsideOffersOn names them); beyond it
// the +6 stands. Exhaustive is untouched. Measured 10/18 on this code (seeds 1-8, bestOf 2), identical to the prototype's
// row in the private report: p1 P/B 99/100, max P +0.8 / B +0.8 / weighted +1.2 (mean +0.29 / +0.35 / +0.46); p2 99/99,
// max +0.8 / +0.8 / +0.7 (mean +0.29 / +0.29 / +0.43); the partial painters at a mean weighted -0.19 / -0.35 / -0.35;
// every surgeon within share + 1 per role in every month; 268 off-list colleague placements waived, 3 standing beyond
// share, all 271 still reported in diagnostics.offers.outsideOffers. The two controls did not move (no outside-offers
// term in either). The order fixture (orderInput) forces placements beyond the share and pins that the offered days
// consume the capacity first, whatever their dates.
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
//   So painting everything still cost more than share + 1 after Prompt 32 (backup up to share + 2.8, weighted up to
//   + 2.6). The smallest fix found (prototyped in a scratch copy) and its numbers are in the private report
//   (REPORT-PROMPT-32-2026-10-11.md, "Step 5 - painting"); fix B (above) applied it and moved the PARTIAL pins below
//   deliberately, keeping the two control pins as they were.
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

// The fixture's own offer facts (never read back from rules.js): did `id` offer `d` (every offer is 'either', so both roles),
// and did he paint at least one day of month `m` (B10's month scope - every fixture surgeon is in preferred mode)?
function fixtureOffered(variant) {
  const idx = {};
  DAYS.forEach((d, i) => { idx[d] = i; });
  return (id, d) => variant !== "nobody" && (PAINTERS.includes(id) || (variant === "partial" && COLLEAGUES.includes(id) && PARTIAL[id](idx[d])));
}
function fixturePainted(variant) {
  return (id, m) => variant !== "nobody" && (PAINTERS.includes(id) || (variant === "partial" && COLLEAGUES.includes(id) && DAYS.some((d, i) => d.slice(0, 7) === m && PARTIAL[id](i))));
}
// Painting fix B (Faraz 10/18) restated from a fixture and a run, per surgeon, month and role:
//   held    = his days in that role; offGen = the held days he offered; offList = the held days he did not offer (a
//             submitted surgeon - what diagnostics.offers.outsideOffers reports, waived or not); outGen = the off-list days
//             in a month he painted in (the days rules.js gives the +outsideOffers term, preferred mode);
//   cap     = ceil(T - 0.5) - the days he held before the run (lockedHeld) - the placements that still bring him towards
//             his share T (the offered taper's capacity); his OFFERED days consume it first, then his OUTSIDE days:
//   expected = the outside-offers terms that stand = max(0, outGen - max(0, cap - offGen)) (all of them with no target);
//   byDate  = what a reading that ranks offered and outside days together by date would leave (the prototype's evaluation)
//             - kept to prove the order check is not vacuous;
//   terms / reported = the outside-offers terms left in diagnostics.softPenalties / his diagnostics.offers.outsideOffers rows.
function offerCells(out, ids, months, days, offeredFx, paintedFx, submittedFx) {
  const D = out.diagnostics, list = [];
  ids.forEach((id) => months.forEach((m) => ["primary", "backup"].forEach((role) => {
    const mem = D.impliedTargets.months[m].members[id];
    const T = role === "primary" ? mem.primaryTarget : mem.backupTarget, base = mem.lockedHeld[role];
    const held = days.filter((d) => d.slice(0, 7) === m && out.schedule[d][role] === id);
    const offDays = held.filter((d) => offeredFx(id, d)), offList = held.filter((d) => !offeredFx(id, d));
    const outDays = paintedFx(id, m) ? offList : [];
    const cap = T === null ? null : Math.max(0, Math.ceil(T - 0.5) - base);
    const expected = cap === null ? outDays.length : Math.max(0, outDays.length - Math.max(0, cap - offDays.length));
    const ranked = offDays.map((d) => [d, "off"]).concat(outDays.map((d) => [d, "out"])).sort((x, y) => (x[0] < y[0] ? -1 : 1));
    const byDate = cap === null ? outDays.length : ranked.filter((x, j) => j >= cap && x[1] === "out").length;
    const terms = D.softPenalties.filter((s) => s.reason === "outside-offers" && s.id === id && s.role === role && s.day.slice(0, 7) === m).length;
    const reported = D.offers.outsideOffers.filter((o) => o.id === id && o.role === role && o.day.slice(0, 7) === m).length;
    list.push({ id: id, month: m, role: role, T: T, base: base, cap: cap, offGen: offDays.length, outGen: outDays.length, offList: submittedFx(id) ? offList.length : 0, terms: terms, reported: reported, expected: expected, byDate: byDate });
  })));
  return list;
}

// Runs the fixture on the given engine (R = rules.js, GEN = generator.js - the repo's, or another copy for a before /
// after comparison) and returns per surgeon the month cells { seed, month, p, b, tP, tB, ws } plus per-run facts
// (offerCells: the fix B restatement above).
function measure(R, GEN, opts) {
  const seed = opts.seedData || JSON.parse(fs.readFileSync(SEED_FILE, "utf8"));
  const ctx = R.buildContext(fixtureInput(seed, opts.variant, opts.data || "after"));
  const cells = {}, runs = [];
  const offeredFx = fixtureOffered(opts.variant), paintedFx = fixturePainted(opts.variant);
  const submittedFx = (id) => opts.variant !== "nobody" && (PAINTERS.includes(id) || opts.variant === "partial");
  IDS.forEach((id) => { cells[id] = []; });
  opts.seeds.forEach((sd) => {
    const out = GEN.generate(ctx, START, END, { seed: sd, bestOf: opts.bestOf || 2 });
    const D = out.diagnostics;
    runs.push({ seed: sd, open: D.uncovered.length, hard: D.hardViolations.length, overSoftLimit: (D.overSoftLimit || []).length, offerCells: offerCells(out, IDS, MONTHS, DAYS, offeredFx, paintedFx, submittedFx) });
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
// Fix B's ORDER (offered days consume the capacity before outside days, whatever their dates) on a board that FORCES
// placements beyond the share: two surgeons cover February 2027 alone (every day one is primary, the other backup), so a
// holds a slot every day; his explicit monthlyTarget { primary: 3, backup: 3 } gives a capacity of 3 per role, and his two
// painted days ('either') are late in the month (2/24, 2/26) - so most of his outside days lie beyond his share and keep
// their +outsideOffers, and a date-ranked reading would waive his first three outside days instead of counting his
// offered days first. b paints nothing (not started). The run limits are opened up (31) so only the share decides.
const ORDER_START = "2027-02-01", ORDER_END = "2027-02-28", ORDER_DAYS = daysList(ORDER_START, ORDER_END), ORDER_OFFERS = ["2027-02-24", "2027-02-26"];
function orderInput(seed) {
  const roster = ["a", "b"].map((id) => ({ id: id, name: "Order" + id.toUpperCase(), code: "OR" + id.toUpperCase(), fullName: "Order surgeon " + id, active: true, roles: ["surgeon"] }));
  const base = { poolMember: true, backupOptOut: false, maxConsecutiveDays: 31, maxConsecutiveAnyRole: 31, holidayUnitCountsAsOneDay: false };
  const surgeonRules = { a: Object.assign({ monthlyTarget: { primary: 3, backup: 3 } }, base), b: Object.assign({}, base) };
  const period = { id: "fixb-order-2027", label: "Fix B order fixture Feb 2027", start_day: ORDER_START, end_day: ORDER_END, offers_close_at: "2027-01-04", publish_by: "2027-01-11", status: "closed", rules_only_ids: [], offer_modes: {} };
  const offers = ORDER_OFFERS.map((d) => ({ person_id: "a", day: d, role_pref: "either", source: "app", entered_by: "a", note: null }));
  return { roster: roster, surgeonRules: surgeonRules, groupRules: JSON.parse(JSON.stringify(seed.groupRules)), holidays: seed.holidays, timeOffRows: [], availabilityRows: [], schedule: {}, periods: [period], offers: offers, today: "2026-11-23" };
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
  // FIX B (Faraz 10/18): a preferred colleague's outside-offers term (+6) is waived while the placement still brings him
  // towards his share - the mirror of the offered taper (capacity ceil(T - 0.5) - his days held before the run, offered
  // days first, then outside days); beyond it the +6 stands. Restated per run, colleague, month and role from the
  // fixture's own offers (offerCells): the terms left in the soft list are exactly the outside days beyond the capacity,
  // and diagnostics.offers.outsideOffers still REPORTS every off-list placement, waived or not (the publish e-mail's list).
  let waived = 0, standing = 0, reportedN = 0;
  A.runs.forEach((r) => r.offerCells.forEach((c) => {
    const at = "partial seed " + r.seed + " " + c.id + " " + c.month + " " + c.role;
    eq(c.base, 0, at + ": the fixture holds nothing before the run (lockedHeld 0)");
    eq(c.terms, c.expected, at + ": outside-offers terms left = the outside days beyond the capacity (" + JSON.stringify(c) + ")");
    eq(c.reported, c.offList, at + ": diagnostics.offers.outsideOffers reports every off-list placement, waived or not (" + JSON.stringify(c) + ")");
    if (PAINTERS.includes(c.id)) eq([c.outGen, c.terms, c.reported], [0, 0, 0], at + ": a full painter has no off-list day");
    waived += c.outGen - c.expected; standing += c.expected; reportedN += c.reported;
  }));
  ok(waived > 0 && standing > 0, "fix B: both halves happen here - colleague placements below share waived, beyond it standing (" + waived + " waived, " + standing + " standing, " + reportedN + " reported)");
  eq([waived, standing], [268, 3], "fix B: the off-list colleague placements over 8 seeds - waived below share / standing beyond it (pinned as observed 10/18)");
  eq(reportedN, waived + standing, "fix B: the report names every off-list placement - the waived and the standing alike");
  // THE B ROW (pin moved deliberately 10/18, painting fix B - was the finding: p1 110/123 max [1.4, 2.8, 2.6] mean
  // [0.97, 1.79, 1.87], p2 111/122 max [1.4, 2.4, 2.6] mean [1.04, 1.73, 1.9], the partial painters at a mean weighted
  // -1.01 / -1.32 / -1.44). The private report's prototype row (10/12 step 5 (b): 99/100 and 99/99, max weighted +1.2 /
  // +0.7, mean +0.46 / +0.43) is reproduced exactly: the painters' surplus goes back to the partial painters and everyone
  // ends at share +/- rounding (the +1.2 is a 7 / 7 March against 6.2 / 6.2, the rounding the nobody control shows)
  eq([sP.p1.P, sP.p1.B, sP.p1.max, sP.p1.mean], [99, 100, [0.8, 0.8, 1.2], [0.29, 0.35, 0.46]], "partial: p1 totals P / B over 16 months and the excess max / mean (P, B, weighted)");
  eq([sP.p2.P, sP.p2.B, sP.p2.max, sP.p2.mean], [99, 99, [0.8, 0.8, 0.7], [0.29, 0.29, 0.43]], "partial: p2 totals P / B over 16 months and the excess max / mean (P, B, weighted)");
  eq(COLLEAGUES.map((id) => sP[id].mean[2]), [-0.19, -0.35, -0.35], "partial: the partial painters' mean weighted excess (c1, c2, c3)");
  // the share + 1 bound the step 5 question asked about now holds for everyone, per role, in every month
  IDS.forEach((id) => A.cells[id].forEach((c) => ok(c.p - c.tP <= 1 && c.b - c.tB <= 1, "partial: " + id + " " + c.month + " seed " + c.seed + " within share + 1 per role under fix B (" + c.p + " / " + c.b + " against " + c.tP + " / " + c.tB + ")")));
  PAINTERS.forEach((id) => ok(A.cells[id].every((c) => c.p + 0.5 * c.b - c.ws <= 1.2 + 1e-9), id + ": within weighted share + 1.2 in every painter-month (the rounding the nobody control shows) - fix B"));
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

  // ---- fix B's order: offered days consume the capacity first, beyond it the +outsideOffers stands (orderInput) ----
  const ctxO = R.buildContext(orderInput(seed));
  eq(ctxO.warnings, [], "order: buildContext raises no warning");
  eq([R.offerState(ctxO, "2027-02-10", "a").status, R.offerState(ctxO, "2027-02-10", "a").mode, R.offerState(ctxO, "2027-02-10", "b").status], ["submitted", "preferred", "not_started"], "order: a submitted in preferred mode, b not started");
  const orderCells = [];
  [1, 2].forEach((sd) => {
    const outO = GEN.generate(ctxO, ORDER_START, ORDER_END, { seed: sd, bestOf: 2 });
    eq([outO.diagnostics.uncovered.length, outO.diagnostics.hardViolations.length], [0, 0], "order seed " + sd + ": no open slot, no hard violation");
    eq(ORDER_DAYS.filter((d) => outO.schedule[d].primary === "a" || outO.schedule[d].backup === "a").length, ORDER_DAYS.length, "order seed " + sd + ": a holds a slot every day (two surgeons, two slots a day)");
    offerCells(outO, ["a"], ["2027-02"], ORDER_DAYS, (id, d) => id === "a" && ORDER_OFFERS.includes(d), (id) => id === "a", (id) => id === "a").forEach((c) => {
      c.seed = sd; orderCells.push(c);
      const at = "order seed " + sd + " a " + c.role;
      eq([c.T, c.base, c.cap], [3, 0, 3], at + ": the explicit target 3, nothing held before the run, capacity 3");
      eq(c.terms, c.expected, at + ": outside-offers terms left = outside days beyond the capacity, offered days counted first (" + JSON.stringify(c) + ")");
      eq(c.reported, c.offList, at + ": every off-list placement is still reported (" + JSON.stringify(c) + ")");
    });
  });
  ok(orderCells.every((c) => c.expected > 0), "order: beyond his share the +outsideOffers stands in every cell (" + orderCells.map((c) => c.role[0] + c.expected).join(" ") + ")");
  ok(orderCells.some((c) => c.offGen > 0 && c.expected !== c.byDate), "order: in at least one cell a date-ranked reading would leave a different count - the check sees the order (" + orderCells.map((c) => c.role[0] + " off " + c.offGen + " out " + c.outGen + " exp " + c.expected + " byDate " + c.byDate).join("; ") + ")");

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
