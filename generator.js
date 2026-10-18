// Silvis Call Schedule - daily primary/backup generator (guide section 6).
//
// Loadable two ways:
//   * browser: classic <script> after helpers.js/config.js/rules.js/east-feed.js.
//     Classic scripts share one global scope, so every top-level name here is
//     either public API (generate, rangePresets, buildUnits, scoreCandidate,
//     genPrng) or carries a gen/GEN_ prefix nothing else declares. rules.js is
//     reached through its globals, resolved lazily on first use.
//   * Node: const gen = require("./generator.js") (rules.js via require).
//
// Contract:
//   generate(ctx, startDate, endDate, { seed, bestOf, respectLocks, timeBudgetMs, fillOpenOnly })
//     -> { schedule, diagnostics }
//   fillOpenOnly (Prompt 12 T, 9/22; default false): every slot that has a
//   holder on the input schedule inside the range - locked or not, externalCover
//   included - is FIXED: kept byte-identical (holder, its own lock flag, source,
//   note), never rewritten, never moved by repair or smoothing, never a hard
//   violation (its rule conflicts go to diagnostics.fixedViolations); only the
//   open slots are filled. diagnostics.mode = "fill-open-only" / "generate",
//   diagnostics.fixedSlots = the fixed count (the lock count in the default mode).
//   lockViolations keeps reporting locked slots only.
//   Prompt 13 / P13R (9/23): a day whose source is in GEN_PERSON_FIXED_SOURCES
//   ("claim" - claim_open_slot; "trade" - apply_trade) carries a commitment a
//   surgeon made himself, written without a lock flag (neither path has one), so
//   every held role of that day is FIXED in BOTH modes exactly like a lock - a
//   claim is never silently discarded by a later Generate. source is a row fact,
//   so a generated holder in the other role of a claimed day is kept too
//   (conservative: nothing on a claimed day moves). "manual" is NOT in the set:
//   the day editor has its own lock toggle, and an unlocked manual slot stays
//   regenerable (pinned by test/generator-regression.js, the fill-open-only
//   fixture). An outside surgeon (item M) stays fixed by roster type, whatever
//   the source.
//   ctx comes from rules.buildContext(). rules.js reads ctx.schedule live on
//   every eligibility() call, so each candidate installs its own working copy
//   as ctx.schedule for the duration of the run and the original is restored
//   in a finally block (ctx.heldSchedule likewise: narrowed for the run by
//   genRunHeld, restored after). Only days inside [startDate, endDate] are ever written;
//   earlier published days stay visible to the rules (consecutive runs,
//   back-to-back weekends, month-to-date counts).
//
//   Every rule lives in rules.js: this file never re-implements one. It only
//   decides ORDER (which unit first), CHOICE (which legal pattern) and REPAIR
//   (which legal swap), always through eligibility() / weekendUnitPatterns() /
//   holidayUnitCandidates().
//
//   Deterministic per seed: one mulberry32 stream (genPrng) drives every
//   tie-break and jitter. Math.random and Date.now are never used inside the
//   pipeline; the optional timeBudgetMs reads a clock only BETWEEN candidates
//   and only shortens the best-of loop (diagnostics.truncated = true).
//
// Pipeline per candidate (genRunCandidate):
//   1 seed locks      import/manual locks, externalCover primaries and Fierce's
//                     East-derived weeks (source "east-derived"); import/manual
//                     locks beat derived locks with a warning. Locks never move.
//                     T: the derived-week yield rule is general - any held row
//                     (published, import, manual, claimed; a fixed slot under
//                     fillOpenOnly) beats a derived lock on its day, either as
//                     another holder of the derived role or as the derived
//                     surgeon held in the other role. Yielded days are listed in
//                     diagnostics.derivedYields with ONE warning per derived week
//                     naming them; days whose holder IS the derived surgeon are
//                     listed in diagnostics.derivedConfirmed (the week is whole).
//   2 build units     holiday units (rules.holidayUnits) pre-empt weekend days;
//                     leftover Fri/Sat/Sun form a reduced weekend unit; every
//                     other day is a day unit. Tightness per unit/role is
//                     measured once on the lock-only schedule.
//   3 primary pass    holidays first, then weekends + days most-constrained-first
//                     (jittered ties). Patterns: holidayUnitCandidates /
//                     weekendUnitPatterns / per-surgeon eligibility. Score =
//                     soft sum + target-deviation delta FOR THE ROLE BEING PLACED
//                     + pattern penalty + holiday load + jitter; minimum wins;
//                     none -> open. The target delta is the CONVEX deviation
//                     change (genTargetDelta / genDevCost) against the per-role
//                     water-filled share of genTargets (J 9/22, WF 9/23; no
//                     neutral term, no explicit-null branch). Prompt 32 step 4:
//                     a PRIMARY candidate this placement takes over his soft
//                     limit (already at / over it) carries the deterministic
//                     tie-break W.low x 0.1 x his weighted load that month
//                     per day it puts over his limit, INSTEAD of the jitter
//                     (genSoftLimitTie), so the lowest
//                     weighted load takes an unavoidable over-limit day.
//   4 backup pass     same with primary fixed, against the backup targets
//                     (Prompt 32 step 2: the WEIGHTED backup share - a member
//                     short of primaries is targeted at wP / wB more backups
//                     per missing primary; genWeightedShares).
//   5 repair          open slots: unit retry (holidays), direct fill, then
//                     1-hop and 2-hop swaps of non-locked generator-placed
//                     day-unit slots, each move re-verified via eligibility().
//   6 smoothing       per role (primary, then backup): move a non-locked
//                     day-unit slot of that role from the surgeon furthest
//                     above his monthly target for the role to one further
//                     below while eligibility holds, the soft score does not
//                     worsen beyond weights.smoothingTolerance and the role's
//                     CONVEX deviation strictly falls (WF 9/23: with the convex
//                     term a move between two members both above or both below
//                     their share can still lower it - both are tried).
//   7 evaluate        final eligibility pass over every generator-placed slot
//                     (hard violations must be 0; counted anyway), soft list,
//                     open slots, primary deviation, backup deviation, spreads
//                     -> scoreCandidate().
// Best-of-N keeps the minimum total; early exit only when nothing is open and
// the soft sum is 0.
//
// Prompt 12 J (9/22) - equal-share fairness (rules doc section 6, guide section
// 15): every pool member carries TWO monthly targets, one per role; counts, unit
// scoring, pending forced slots, smoothing and the score are all per role
// (genTargets, genMonthCount(role), genTargetDelta(role), genSmooth, genEvaluate).
// WF (Faraz 9/23, after the November-backups report - history, docs/HISTORY.md) - the WATER-FILLED
// SHARE with a CONVEX deviation, both roles: the share is computed over ALL the
// month's slots of the pool (open + locked / held / derived / imported), water-
// filled across the members' clips (a member whose clip is below the level takes
// the clip, the remainder is redistributed among the others - genWaterFill), and
// a member's target is that share, NEVER floored at his locked count: his fixed
// days count AGAINST it. The deviation term is |count - target| ^ convexity
// (genDevCost; weights.deviationConvexity, code default GEN_DEVIATION_CONVEXITY
// = 2), so each slot above share costs more than the one before and the
// candidate FURTHEST below share wins a tie against one nearer to it - the
// leftover slots of a month go to whoever is furthest below share instead of
// being split by soft terms and jitter. diagnostics.impliedTargets shows every
// level and, per member, the two targets, lockedHeld and the "allowed by rules"
// slot counts so an availability shortfall is visible.
//
// Prompt 12 N (9/22 evening) - a windows surgeon (availableWindows) with a
// daysPerWindowWeek.target: her monthly PRIMARY target is target x window weeks
// in the month and she has no backup target (genTargets); the window-week
// count itself is SOFT (rules.js eligibility) and is reported, never repaired:
// diagnostics.windowWeeks (one row per window week overlapping the range, with
// status met / under / over / partial) plus a warning per fully-in-range week
// off target. diagnostics.handoffGaps lists every in-range primary of a
// handoffPartnerRequired surgeon whose next day is the same surgeon or open.
// diagnostics.eastConflicts (Prompt 12 C.4, 9/22) = rules.eastConflicts over
// the final schedule: held slots the East data makes ineligible (east-busy,
// east-forecast-busy, derived-lock, derived-lock-held) - generated slots never
// appear there, locked / fixed ones may.
//
// Prompt 14 P2 (9/23) - offers first, rules as the fallback. The rules live in
// rules.js (ctx.offers / ctx.periods: a submitted surgeon's offered day carries
// the soft 'offered' bonus of -weights.offerBonus, a preferred-mode surgeon's
// other days +weights.outsideOffers, an exhaustive surgeon's other days the
// hard 'not-offered'). This file adds ORDER: after locks, holiday units and
// derived weeks, the day and weekend units with at least one eligible surgeon
// who OFFERED an open slot of the unit in that role are filled before the rest
// (genOfferedUnits, measured once on the lock-only schedule; genOrder ranks
// them ahead of the most-constrained-first order, holidays still first) - so a
// surgeon's offered days are placed before his own non-offered placements can
// consume his caps or runs. The bonus alone already makes an offered candidate
// beat a rules-only candidate for the same slot (6 against a target delta of
// weights.low per day off the share) - and it STOPS AT THE SHARE (review 9/23,
// genOfferTaper / genTaperSoftList): once a placement no longer brings him
// towards his target for the role and month the bonus reads
// -weights.offerBonusOverShare (seed 0), so the equal shares decide between him
// and a rules-only colleague exactly as before offers; caps and every other
// hard rule are unchanged - an offer is not a demand. Its mirror (painting fix B,
// Faraz 10/18): a preferred-mode colleague's +weights.outsideOffers is WAIVED while
// a placement still brings him towards his share (every day he holds counts against
// the same capacity - his days with neither term first, then his offered days, then
// his outside days; rules.outsideOffersOn names the last) and stands beyond it, so a
// full painter no longer outbids a partial painter below his share; exhaustive is
// untouched. diagnostics.offers =
// { periods, byPerson: { id: { status, mode, offered, placed, unplaced: [{ day,
// role, reason, holidayUnit }], byPeriod } }, outsideOffers: [{ day, role, id }] }
// (outsideOffers REPORTS every off-list placement, its term waived or not)
// (genOffersDiag; an unplaced offer on a holiday-unit day names the unit's other
// day that failed - "holiday-unit:<name> <day> <reason>" - as the cause);
// an open slot inside a period carries uncovered[].offered (the ids who offered
// it) and uncovered[].note ("no offer and no rule allows it" when nobody did).
// With no period touching the range nothing here changes the output
// (test/generator-regression.js pins the byte-identical run).
//
// Prompt 23 (Faraz 9/30, Khan's new call preferences) - the rules live in rules.js
// and reach the generator through eligibility() / weekendUnitPatterns() like every
// other term: the soft weekday-primary (primaryContribution "weekdays"), the soft
// weekend-cap:<n> (weekendCap; counted once per weekend, on its first held day), the
// soft hard-never-beyond-notice:<wd> (hardNeverWeekdaysNoticeDays - the notice is
// measured from ctx.today, so Generate uses the day it runs; review 2, 10/1: the
// "already held" reading is narrowed for the run to the rows it starts from -
// genRunHeld - so its own placements are judged as new) and the hard
// lone-weekend-day:<wd> (noLoneWeekendDay). This file adds only bookkeeping: a
// 'friday' weekend pattern (standaloneFriday - one surgeon on the Friday, the
// Saturday-Sunday as their own reduced unit) is written like any other pattern,
// counts its daily Sat/Sun sub-pattern in the pattern-daily penalty, and its key
// holder's legal primary shapes ({Fri}, {Sat, Sun}, {Fri, Sat, Sun}) are no style
// mismatch (genStyleMismatch); buildUnits' allowed-slot count judges a surgeon
// blocked ONLY by lone-weekend-day with the partner day assumed, and (review 10/1)
// genFillWeekend's reduced-unit fallback keeps such a surgeon's Sat + Sun together
// instead of dropping the day only he can take (before the fix that Saturday stayed
// open while its Sunday, fillable by others, went to someone else). With none of
// the keys on the roster the output is byte-identical to the pre-23 engine.

var GEN_DAY_MS = 86400000;
var GEN_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
var GEN_ROLES = ["primary", "backup"];
// Prompt 12 J: primary spread before backup spread (targetDeviation split per role, 9/22).
// WF 9/23: primaryDeviation / backupDeviation are the sums of the CONVEX per-member terms
// (|count - target| ^ deviationConvexity, genDevCost), not of the plain distances.
var GEN_SCORE_WEIGHTS = { uncoveredPrimary: 1e9, uncoveredBackup: 1e7, hardViolations: 1e6, softSum: 1e3, primaryDeviation: 300, backupDeviation: 100, weekendSpread: 10, holidaySpread: 1 };
// WF 9/23: the exponent of the deviation term. 2 = squared (each extra slot above target costs
// 2d+1, the member furthest below share gains most); 1 would restore the flat +/-1 term.
// Data knob: groupRules.weights.deviationConvexity (the seed carries 2 explicitly); this is the
// code default when the blob has none or an invalid value (anything below 1 is read as 2).
var GEN_DEVIATION_CONVEXITY = 2;
// Hard reasons that depend only on the schedule state (a swap can lift them).
var GEN_DYNAMIC_REASONS = ["monthly-cap", "max-consecutive", "backup-cap", "backup-weekend-cap", "max-major-holidays", "holds-other-role"]; // window-week-max left the vocabulary 9/22 evening (Prompt 12 N: soft target)
var genRulesCache = null;
var genMonthDaysCache = Object.create(null);

// rules.js API: require() under Node, the shared globals in the browser
// (resolved lazily so load order only matters at first use).
function genRulesApi() {
  if (genRulesCache) return genRulesCache;
  if (typeof module !== "undefined" && typeof require === "function") {
    genRulesCache = require("./rules.js");
  } else {
    genRulesCache = {
      eligibility: eligibility, buildContext: buildContext, weekendUnitPatterns: weekendUnitPatterns,
      holidayUnits: holidayUnits, holidayUnitCandidates: holidayUnitCandidates, isHolidayDay: isHolidayDay,
      talliesFor: talliesFor, runThrough: rdRunThrough, resolveWeight: resolveWeight, monthlyCapFor: monthlyCapFor, defaultWeights: defaultWeights,
      standingEastDays: standingEastDays,
      eastConflicts: eastConflicts,
      eastVacationConflicts: eastVacationConflicts,
      offerState: offerState, offeredOn: offeredOn, outsideOffersOn: outsideOffersOn, // Prompt 14 P2; painting fix B (10/18)
      shiftWeightsOf: shiftWeightsOf, // Prompt 32 step 2: the ONE reader of groupRules.shiftAccounting.weights
      overSoftLimitDays: overSoftLimitDays // Prompt 32 step 4: the ONE reading of the over-soft-limit primary days
    };
  }
  return genRulesCache;
}

/* ------------------------------------------------------------------ dates */

function genPad2(n) { return n < 10 ? "0" + n : "" + n; }
function genIsDateStr(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function genAssertDate(s, what) { if (!genIsDateStr(s)) throw new Error("generator.js: " + what + " must be 'YYYY-MM-DD', got " + JSON.stringify(s)); }
var genDayNumCache = Object.create(null);
function genDayNum(s) {
  var n = genDayNumCache[s];
  if (n === undefined) { n = Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / GEN_DAY_MS); genDayNumCache[s] = n; }
  return n;
}
var genFromDayNumCache = Object.create(null);
function genFromDayNum(n) {
  var s = genFromDayNumCache[n];
  if (s === undefined) { var dt = new Date(n * GEN_DAY_MS); s = dt.getUTCFullYear() + "-" + genPad2(dt.getUTCMonth() + 1) + "-" + genPad2(dt.getUTCDate()); genFromDayNumCache[n] = s; }
  return s;
}
function genAddDays(s, n) { return genFromDayNum(genDayNum(s) + n); }
function genWeekdayIndex(s) { return ((genDayNum(s) + 3) % 7 + 7) % 7; } // Mon = 0
function genWeekday(s) { return GEN_WEEKDAYS[genWeekdayIndex(s)]; }
function genDaysBetween(a, b) { return genDayNum(b) - genDayNum(a); }
function genMonthOf(s) { return s.slice(0, 7); }
function genDaysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function genMonthDays(month) {
  var c = genMonthDaysCache[month];
  if (c) return c;
  var y = +month.slice(0, 4), m = +month.slice(5, 7), out = [];
  for (var d = 1, dim = genDaysInMonth(y, m); d <= dim; d++) out.push(month + "-" + genPad2(d));
  genMonthDaysCache[month] = out;
  return out;
}
function genDaysList(start, end) {
  var out = [], a = genDayNum(start), b = genDayNum(end);
  if (b - a > 1500) throw new Error("generator.js: range longer than 1500 days (" + start + ".." + end + ")");
  for (var n = a; n <= b; n++) out.push(genFromDayNum(n));
  return out;
}
function genFridayOf(s) { var w = genWeekdayIndex(s); return w >= 4 ? genAddDays(s, -(w - 4)) : null; }
function genMondayOf(s) { return genAddDays(s, -genWeekdayIndex(s)); }
// Prompt 12 N: window weeks per windows surgeon -> { [id]: { [monday]: [sorted window days] } }
// (every availableWindows day of ctx.per[id].windowDays grouped by its Mon-Sun week).
function genWindowWeeks(ctx) {
  var out = {};
  ctx.activeIds.forEach(function (id) {
    var P = ctx.per[id];
    if (!P.hasWindows) return;
    var byMon = {};
    P.windowDays.forEach(function (d) { var mon = genMondayOf(d); (byMon[mon] = byMon[mon] || []).push(d); });
    Object.keys(byMon).forEach(function (mon) { byMon[mon].sort(); });
    out[id] = byMon;
  });
  return out;
}
function genSundayOnOrAfter(s) { var w = genWeekdayIndex(s); return w === 6 ? s : genAddDays(s, 6 - w); }
// One notion of today (small items 9/22): the CENTRAL date - the same expression as
// helpers.js todayCentral - so the rangePresets default agrees with the app whatever
// the device zone; the device date is the fallback when time zone data is missing.
function genTodayStr() {
  try {
    var s = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s)) return s;
  } catch (e) { /* fall through to the device date */ }
  var d = new Date(); return d.getFullYear() + "-" + genPad2(d.getMonth() + 1) + "-" + genPad2(d.getDate());
}

/* ------------------------------------------------------------------- prng */

// genPrng(seed) -> next(): float in [0,1); next.int(n): integer in [0,n).
// mulberry32; strings and non-integers are hashed (FNV-1a) into a 32-bit seed.
function genHashSeed(seed) {
  if (typeof seed === "number" && isFinite(seed) && Math.floor(seed) === seed) return seed >>> 0;
  var s = String(seed), h = 0x811c9dc5;
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function genPrng(seed) {
  var a = genHashSeed(seed);
  if (a === 0) a = 0x9e3779b9;
  function next() {
    a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  next.int = function (n) { return Math.floor(next() * n); };
  return next;
}

/* ----------------------------------------------------------------- score */

// scoreCandidate(parts) -> { total, ...parts } with the lexicographic weights
// of guide section 6 (lower is better).
function scoreCandidate(parts) {
  var p = parts || {};
  var out = {
    uncoveredPrimary: p.uncoveredPrimary || 0, uncoveredBackup: p.uncoveredBackup || 0, hardViolations: p.hardViolations || 0,
    softSum: p.softSum || 0, primaryDeviation: p.primaryDeviation || 0, backupDeviation: p.backupDeviation || 0, weekendSpread: p.weekendSpread || 0, holidaySpread: p.holidaySpread || 0
  };
  var total = 0;
  Object.keys(GEN_SCORE_WEIGHTS).forEach(function (k) { total += out[k] * GEN_SCORE_WEIGHTS[k]; });
  out.total = Math.round(total * 1000) / 1000;
  out.weights = GEN_SCORE_WEIGHTS;
  return out;
}

/* --------------------------------------------------------- slot helpers */

function genSlotOpen(e, role) { return !!e && !e[role] && !(role === "primary" && e.externalCover); }
function genSoftSum(r) { var s = 0; for (var k = 0; k < r.soft.length; k++) s += r.soft[k].weight; return s; }
function genDynamicOnly(hard) {
  if (!hard || !hard.length) return false;
  for (var i = 0; i < hard.length; i++) {
    var h = hard[i], dyn = false;
    for (var j = 0; j < GEN_DYNAMIC_REASONS.length; j++) if (h.indexOf(GEN_DYNAMIC_REASONS[j]) === 0) { dyn = true; break; }
    if (!dyn) return false;
  }
  return true;
}
function genHoldsFullBlock(W, day, role, id) {
  var fri = genFridayOf(day);
  if (!fri) return false;
  for (var k = 0; k < 3; k++) { var e = W[genAddDays(fri, k)]; if (!e || e[role] !== id) return false; }
  return true;
}
// Silvis days the surgeon holds in a month IN ONE ROLE, read from the working
// schedule (Prompt 12 J: every count is per role - primary days against the
// primary target, backup days against the backup target; one day held in one
// role is one day).
function genMonthCountScan(W, id, month, role) {
  var days = genMonthDays(month), c = 0;
  for (var i = 0; i < days.length; i++) { var e = W[days[i]]; if (e && e[role] === id) c++; }
  return c;
}
// Running per-candidate counters (S.counts[month][id] = { primary, backup }) kept exact by genSet/genUnset.
function genInitCounts(G, S) {
  S.counts = {};
  G.months.forEach(function (month) {
    S.counts[month] = {};
    G.ctx.activeIds.forEach(function (id) { S.counts[month][id] = { primary: genMonthCountScan(G.ctx.schedule, id, month, "primary"), backup: genMonthCountScan(G.ctx.schedule, id, month, "backup") }; });
  });
}
function genMonthCount(G, S, id, month, role) {
  var m = S.counts[month];
  return m && m[id] ? m[id][role] : genMonthCountScan(G.ctx.schedule, id, month, role);
}
function genBump(G, S, day, id, delta, role) {
  var m = S.counts[genMonthOf(day)];
  if (!m || !m[id]) return;
  m[id][role] += delta;
}
// Fairness target for a role (deviation term, unit scoring, smoothing, tallies
// display) - null when the surgeon has none for that role (see genTargets).
function genTargetFor(G, month, id, role) { var t = G.targets.byMonth[month], x = t && t[id]; return x && x[role] != null ? x[role] : null; }
// Still-open day-unit slots of `role` in `month` where `id` is the ONLY eligible
// surgeon (measured on the lock-only schedule): load he will carry anyway, so
// the target term sees it before weekends and holidays are handed out.
function genPendingForced(G, S, id, month, exceptDay, role) {
  var list = G.forced[id] && G.forced[id][month];
  if (!list) return 0;
  var W = G.ctx.schedule, n = 0;
  for (var i = 0; i < list.length; i++) {
    var f = list[i];
    if (f.day === exceptDay || f.roles.indexOf(role) < 0) continue;
    var e = W[f.day];
    if (e.primary === id || e.backup === id) continue; // already his that day (either role: he cannot take the other)
    if (genSlotOpen(e, role)) n++;
  }
  return n;
}
// WF 9/23: the convex deviation cost of standing `d` days from the target:
// |d| ^ G.convexity (2 by default). Symmetric, so below target the gain of one
// more day GROWS with the distance (from d = -3 to -2: -5; from -1 to 0: -1) and
// above target the cost of one more day grows the same way (0 -> 1: +1; 2 -> 3:
// +5). Every deviation read - the passes, unit patterns, repair, smoothing and
// the best-of-N score - goes through this one function.
function genDevCost(G, d) {
  var a = Math.abs(d);
  return G.convexity === 2 ? a * a : Math.pow(a, G.convexity);
}
// Change in the convex deviation for `role` when `extra` more days of that role
// in `month` go to `id` (0 when the surgeon carries no target for the role). A
// unit pattern sums this per member over the days he would take (genTargetDeltaForDays).
function genTargetDelta(G, S, id, month, extra, exceptDay, role) {
  var T = genTargetFor(G, month, id, role);
  if (T === null) return 0;
  var c = genMonthCount(G, S, id, month, role) + genPendingForced(G, S, id, month, exceptDay, role);
  return (genDevCost(G, c + extra - T) - genDevCost(G, c - T)) * G.W.low;
}
function genTargetDeltaForDays(G, S, id, days, role) {
  var perMonth = {};
  days.forEach(function (d) { var m = genMonthOf(d); perMonth[m] = (perMonth[m] || 0) + 1; });
  var t = 0;
  Object.keys(perMonth).forEach(function (m) { t += genTargetDelta(G, S, id, m, perMonth[m], null, role); });
  return t;
}
// Prompt 32 step 4 (DESIGN "Generator" 8; Faraz 10/11 decision 5: "the generator fills them itself (soft penalty), giving
// the extra day to the eligible surgeon with the lowest weighted load"). When a placement takes a PRIMARY candidate over
// his soft limit (P.capPreferred; he is already at / over it - the placement's days make his month's count, counted as
// the cap counts it, exceed it), rules.js already adds the soft over-preferred-cap at W.medium to every such candidate;
// this adds the tie-break among them: W.low x GEN_SOFT_LIMIT_TIE (0.1) x his WEIGHTED load that month before the placement
// (Silvis days only: primary x w.primary + backup x w.backup from the running counts - Faraz's decision 9), once per day
// of the placement that lands over the limit, per month concerned - one day (a day unit, the repair) is one term; a weekend
// / holiday unit that puts two of his days over carries two, so between two shapes of one unit the lower load takes the
// larger share of the over-limit days (one term per member would score "a 1 day + b 2 days" = "a 2 days + b 1 day" and
// leave it to the enumeration order). Small (about 1 per day for a full month), and deterministic: the scorer adds it INSTEAD of the jitter for such
// a candidate (the rng is still drawn for him, so the stream is unchanged) - the jitter (uniform 0..1) would otherwise
// decide between two over-limit candidates a 0.1 x load apart about as often as the load does. null = the term does not
// apply (a backup placement, no soft limit, or he stays within it): the scorer keeps its jitter as before, so a run with no
// soft limit anywhere is byte-identical. The score structure is otherwise unchanged (no new score part).
var GEN_SOFT_LIMIT_TIE = 0.1;
// A countsEastDays cap's East primary-week days of `month` he does not hold as Silvis primary - LESS the placement's own days
// (`days`): the count is of DISTINCT days, as eligibility's monthPrimary and rules.js rdOverSoftEastBase count it, so a
// placement on one of his East days adds no day (the placement's days are counted once, in perMonth below).
function genSoftLimitEastBase(G, P, id, month, days) {
  if (!P.countsEastDays || !P.eastPrimaryDays) return 0;
  var W = G.ctx.schedule, b = 0;
  P.eastPrimaryDays.forEach(function (d) { if (genMonthOf(d) === month && days.indexOf(d) < 0) { var e = W[d]; if (!(e && e.primary === id)) b++; } });
  return b;
}
function genSoftLimitTie(G, S, id, days, role) {
  if (role !== "primary" || !days || !days.length) return null;
  var P = G.ctx.per[id];
  if (!P || typeof P.capPreferred !== "number") return null;
  var perMonth = {}, months = [], t = null;
  for (var i = 0; i < days.length; i++) { var m = genMonthOf(days[i]); if (!perMonth[m]) { perMonth[m] = 0; months.push(m); } perMonth[m]++; }
  for (var k = 0; k < months.length; k++) {
    var month = months[k], cp = genMonthCount(G, S, id, month, "primary");
    var after = cp + genSoftLimitEastBase(G, P, id, month, days) + perMonth[month];
    if (after <= P.capPreferred) continue;
    var over = Math.min(perMonth[month], after - P.capPreferred); // the placement's days of this month past his limit (>= 1)
    var load = G.shiftWeights.primary * cp + G.shiftWeights.backup * genMonthCount(G, S, id, month, "backup");
    t = (t === null ? 0 : t) + G.W.low * GEN_SOFT_LIMIT_TIE * load * over;
  }
  return t;
}
// Prompt 14 P2 review (9/23): the offered bonus stops at the share - "an offer is
// not a demand". rules.js emits the soft 'offered' at -weights.offerBonus on every
// offered day; here that bonus counts only while the placement still brings the
// surgeon TOWARDS his target for the role and month (the same test genTargetDelta
// makes: |c+1-T| < |c-T|, i.e. c < T - 0.5). Beyond that the term reads
// -weights.offerBonusOverShare (seed 0; = offerBonus restores the untapered reading),
// so between a surgeon at his share and a rules-only colleague below his, the share
// term (weights.low per day) decides, as it did before offers. A surgeon with no
// target for the role (a windows surgeon, poolMember false) is never tapered - only
// his caps govern him. Capacity = the further placements that still improve the
// share; for a multi-day unit the offered days are counted against it first.
function genOfferCapacity(G, S, id, month, role, exceptDay, extra) {
  var T = genTargetFor(G, month, id, role);
  if (T === null) return Infinity;
  var c = genMonthCount(G, S, id, month, role) + genPendingForced(G, S, id, month, exceptDay, role) + (extra || 0);
  return Math.max(0, Math.ceil(T - 0.5) - c);
}
// Painting fix B (Faraz 10/18; Prompt 32 step 5 (b)) - the mirror of the offered taper. A
// preferred-mode colleague who painted a few days of a month carries rules.js's soft
// 'outside-offers' (+weights.outsideOffers) on every other day of it, while a painter's
// 'offered' bonus stops at his share: so a full painter kept winning placements up to
// about share + 3 against him. Now the outside-offers term is WAIVED while the
// placement still brings that colleague towards his share - the same capacity as the
// taper (ceil(T - 0.5) - his count: EVERY day he holds in the month and role), his
// OFFERED days consuming it before his OUTSIDE days; beyond it the +outsideOffers
// stands, so beyond his share preferred mode still keeps him to his painted days. The
// days in scope are rules.outsideOffersOn's (the ONE reading of B10's per-month scope:
// preferred, submitted, a month he painted in, the role not offered that day) -
// exhaustive mode is untouched (hard not-offered; its claim-result term is never
// waived). A surgeon with no target for the role is neither tapered nor waived.
// eligibility() itself always carries the term (the day editor and the board still show
// it); the waiver lives in the fill (genOfferTaper) and the evaluation
// (genTaperSoftList), and diagnostics.offers.outsideOffers still REPORTS every off-list
// placement, waived or not.
//
// ONE ORDER against the capacity, in the fill and in the evaluation (review 10/18, round
// 2): his days that carry NEITHER term first, then his OFFERED days, then his OUTSIDE
// days. A day with neither term is one of his days in that month and role that is not
// offered and not in outsideOffersOn's scope - a day in a period he is not submitted for
// (rules-only, not started), or did not paint that month in, or in no period at all: the
// shape of a month SPLIT by a period boundary (January 2027 - the first period ends Sun
// 1/3; helpers.offerTimeline moves a Friday / Saturday end to the Sunday, so it recurs;
// 11/1/2026 lay in no period). Such days take nothing from the waiver or the taper, but
// they are days he holds, so they count against his share before any term is waived or
// any bonus kept. The days are sorted by rules.offeredOn / rules.outsideOffersOn whatever
// the weights (a zero weight only switches its own amount off; with the taper off his
// offered days still come before his outside days).
//
// The amount to ADD to a candidate's soft sum for taking `days` in `role`, per month
// against the capacity (his count before the placement already holds every earlier
// day; the placement's own days in the order above): each offered day beyond what its
// neither-term days leave swaps -offerBonus for -offerBonusOverShare (the taper), and
// each outside day within what is then left takes back its +outsideOffers (fix B). 0
// whenever no period touches the range (the pre-P2 path is untouched, rng included).
function genOfferTaper(G, S, id, days, role, exceptDay, extra) {
  var bonus = G.W.offerBonus || 0, over = G.W.offerBonusOverShare || 0, outside = G.W.outsideOffers || 0;
  var taper = !!bonus && bonus !== over;
  if (!G.offersLive || (!taper && !outside)) return 0;
  var n = {}, months = [], R = G.R, ctx = G.ctx;
  for (var i = 0; i < days.length; i++) {
    var m = genMonthOf(days[i]);
    if (!n[m]) { n[m] = [0, 0, 0]; months.push(m); } // [neither, offered, outside]
    n[m][R.offeredOn(ctx, days[i], role, id) ? 1 : R.outsideOffersOn(ctx, days[i], role, id) ? 2 : 0]++;
  }
  var adj = 0;
  for (var k = 0; k < months.length; k++) {
    var c = n[months[k]], offN = c[1], outN = c[2];
    if (!(taper && offN) && !(outside && outN)) continue;
    var capN = genOfferCapacity(G, S, id, months[k], role, exceptDay, extra);
    if (capN === Infinity) continue; // no target for the role: neither tapered nor waived
    var left = Math.max(0, capN - c[0]); // what the placement's neither-term days leave of it
    if (taper && offN) adj += Math.max(0, offN - left) * (bonus - over);
    if (outside && outN) adj -= Math.min(outN, Math.max(0, left - offN)) * outside;
  }
  return adj;
}
// His GENERATED slots per "id|month|role" on the candidate (the slots genEvaluate reads:
// held, not locked), split as [neither term, offered, outside] by rules.offeredOn /
// rules.outsideOffersOn - read from the schedule, never from the soft list, so the
// evaluation's order holds whatever the weights (review 10/18, round 2).
function genPlacedKinds(G) {
  var W = G.ctx.schedule, R = G.R, ctx = G.ctx, out = {};
  G.days.forEach(function (d) {
    var e = W[d];
    GEN_ROLES.forEach(function (role) {
      var id = e && e[role];
      if (!id || genSlotOpen(e, role) || e[role + "Locked"]) return;
      var k = id + "|" + genMonthOf(d) + "|" + role, c = out[k] || (out[k] = [0, 0, 0]);
      c[R.offeredOn(ctx, d, role, id) ? 1 : R.outsideOffersOn(ctx, d, role, id) ? 2 : 0]++;
    });
  });
  return out;
}
// The same rules on a finished candidate (genEvaluate), in the same order. Per surgeon,
// month and role the capacity is ceil(T - 0.5) - the days he held before the run (the
// lock-only schedule G.base: the locks in the range, the input's days outside it), and
// every day the run gave him in that month and role counts against it (genPlacedKinds):
// first his generated days with NEITHER term, then his generated OFFERED days - in date
// order they keep the bonus up to what is left, the rest are re-labelled
// 'offered-over-share' at -offerBonusOverShare (dropped when that is 0) - then (fix B)
// his generated OUTSIDE days (rules.outsideOffersOn) in date order: those within what
// is still left lose their 'outside-offers' term (dropped: a zero-weight term never
// stays in the list), the rest keep +outsideOffers. So the evaluation never waives a
// term or keeps a bonus for a surgeon whose days already reach his share (before review
// 10/18 round 2 it took off only his offered days, and a month split by a period
// boundary waived terms beyond the share). A surgeon with no target for the role keeps
// every term.
function genTaperSoftList(G, softList) {
  var bonus = G.W.offerBonus || 0, over = G.W.offerBonusOverShare || 0, outside = G.W.outsideOffers || 0;
  var taper = !!bonus && bonus !== over;
  if (!G.offersLive || (!taper && !outside)) return softList;
  var R = G.R, ctx = G.ctx, groups = {}, keys = [];
  softList.forEach(function (s, i) {
    if (!s.id) return;
    var kind = s.reason === "offered" ? (taper ? "offered" : null) : (s.reason === "outside-offers" && outside && R.outsideOffersOn(ctx, s.day, s.role, s.id)) ? "outside" : null;
    if (!kind) return;
    var k = s.id + "|" + genMonthOf(s.day) + "|" + s.role;
    if (!groups[k]) { groups[k] = { offered: [], outside: [] }; keys.push(k); }
    groups[k][kind].push(i);
  });
  var drop = {}, placed = null;
  var byDay = function (a, b) { return softList[a].day < softList[b].day ? -1 : softList[a].day > softList[b].day ? 1 : 0; };
  keys.forEach(function (k) {
    var g = groups[k], parts = k.split("|"), id = parts[0], month = parts[1], role = parts[2];
    var T = genTargetFor(G, month, id, role);
    if (T === null) return;
    if (!placed) placed = genPlacedKinds(G);
    var p = placed[k] || [0, 0, 0];
    var left = Math.max(0, Math.ceil(T - 0.5) - genMonthCountScan(G.base, id, month, role) - p[0]);
    var idx = g.offered.slice().sort(byDay);
    for (var j = left; j < idx.length; j++) {
      var s = softList[idx[j]];
      if (over) { s.reason = "offered-over-share"; s.weight = -over; } else drop[idx[j]] = true;
    }
    if (!g.outside.length) return;
    var rem = Math.max(0, left - p[1]), out = g.outside.slice().sort(byDay);
    for (var q = 0; q < out.length && q < rem; q++) drop[out[q]] = true;
  });
  return softList.filter(function (s, i) { return !drop[i]; });
}
// Holiday units of this tier the surgeon already holds (any day, any role, whole schedule).
function genHolidayLoad(G, id, tier) {
  var W = G.ctx.schedule, n = 0, units = G.ctx.holidayUnitsAll;
  for (var u = 0; u < units.length; u++) {
    if (units[u].tier !== tier) continue;
    for (var k = 0; k < units[u].days.length; k++) { var e = W[units[u].days[k]]; if (e && (e.primary === id || e.backup === id)) { n++; break; } }
  }
  return n;
}

function genSet(G, S, day, role, id) {
  G.ctx.schedule[day][role] = id;
  genBump(G, S, day, id, +1, role);
  S.placed[day + "|" + role] = { day: day, role: role, id: id, unitKey: G.unitKeyOf[day], unitKind: G.unitKindOf[day] };
}
function genUnset(G, S, day, role) {
  var id = G.ctx.schedule[day][role];
  G.ctx.schedule[day][role] = null;
  if (id) genBump(G, S, day, id, -1, role);
  delete S.placed[day + "|" + role];
}

/* ------------------------------------------------------------- locks */

// In-range entries rebuilt from the original schedule: locked slots kept,
// everything else cleared; derived East weeks applied as locks unless an
// import/manual lock already holds the slot (warning). Out-of-range entries
// are shared by reference and never written.
// Prompt 12 T (9/22), opts.fillOpenOnly: every HELD slot inside the range
// (locked or not, externalCover included) is fixed. Inside the run a fixed slot
// carries the lock flag - so eligibility (slot-locked / lockHolder), the unit
// builders and the derived-yield test below all see it as the fact it is - and
// genSnapshot puts the input's own flag back on the output (G.outLock).
// G.fixed[d][role] marks the fixed slots, G.fixedCount counts them
// (diagnostics.fixedSlots; in the default mode fixed == locked, the count is the
// lock count). G.lockSrc reads "import" / "fixed" (+ "+derived" when the derived
// surgeon holds his own derived day) / "derived".
// The derived-week yield rule (general; rules.js rdDerivedOverridden applies the
// same test): a held slot beats a derived lock on its day - another holder in
// the derived role, or the derived surgeon himself held in the other role - and
// the day is recorded in G.derivedYields with ONE warning per derived week; a
// held slot whose holder IS the derived surgeon confirms the derived lock
// (G.derivedConfirmed; the week stays whole).
function genSeedLocks(G, original) {
  var base = {}, ctx = G.ctx, fillOpen = !!G.fillOpenOnly;
  Object.keys(original).forEach(function (k) { base[k] = original[k]; });
  G.lockSrc = {}; G.fixed = {}; G.outLock = {}; G.fixedCount = 0;
  G.derivedYields = []; G.derivedConfirmed = [];
  G.days.forEach(function (d) {
    var e = original[d] || {};
    var lockedP = !!e.externalCover || (G.respectLocks && !!e.primaryLocked && !!e.primary);
    var lockedB = G.respectLocks && !!e.backupLocked && !!e.backup;
    // Prompt 12 M: a slot held by an outside surgeon (roster type "external", never in
    // ctx.activeIds) is a hand-written fact in every mode - fixed like a lock inside the
    // run (so nobody is placed over him and his own days are never re-evaluated), its
    // own lock flag kept on the output (G.outLock). The day editor locks such a slot
    // anyway; this pins the same reading for an unlocked row.
    // Prompt 13 / P13R: a claimed or traded day (row source) is a commitment of its holder - every held role fixed in both modes.
    var personHeld = genHeldByPerson(e);
    var fixedP = lockedP || (fillOpen && !!e.primary) || genIsExternal(ctx, e.primary) || (personHeld && !!e.primary);
    var fixedB = lockedB || (fillOpen && !!e.backup) || genIsExternal(ctx, e.backup) || (personHeld && !!e.backup);
    base[d] = {
      primary: fixedP ? (e.primary || null) : null,
      backup: fixedB ? e.backup : null,
      primaryLocked: fixedP,
      backupLocked: fixedB,
      source: (fixedP || fixedB) ? (e.source || "import") : "generated",
      externalCover: e.externalCover || null,
      note: e.note === undefined ? null : e.note
    };
    G.lockSrc[d] = { primary: lockedP ? "import" : (fixedP ? "fixed" : null), backup: lockedB ? "import" : (fixedB ? "fixed" : null) };
    G.fixed[d] = { primary: fixedP, backup: fixedB };
    // the flag the OUTPUT carries for a fixed slot: a lock stays a lock, an unlocked held slot stays unlocked
    G.outLock[d] = { primary: lockedP || (fixedP && !!e.primaryLocked), backup: lockedB || (fixedB && !!e.backupLocked) };
    G.fixedCount += (fixedP ? 1 : 0) + (fixedB ? 1 : 0);
  });
  var yieldWeeks = {};
  function yieldOn(d, role, derivedId, holderId, holderRole, holderSource) {
    G.derivedYields.push({ day: d, role: role, derivedId: derivedId, holderId: holderId, holderRole: holderRole, holderSource: holderSource || null });
    var k = genMondayOf(d) + "|" + role + "|" + derivedId;
    (yieldWeeks[k] = yieldWeeks[k] || []).push(d);
  }
  G.days.forEach(function (d) {
    var ds = ctx.derivedByDay[d];
    if (!ds) return;
    GEN_ROLES.forEach(function (role) {
      var id = ds[role];
      if (!id || genIsExternal(ctx, id)) return;   // M (review 9/22): never a derived lock for an outside surgeon (buildContext already drops and warns)
      var e = base[d], other = role === "primary" ? "backup" : "primary";
      if (e[role + "Locked"]) {
        if (e[role] === id) { G.lockSrc[d][role] = G.lockSrc[d][role] + "+derived"; G.derivedConfirmed.push({ day: d, role: role, id: id, derivedId: id, holderSource: e.source }); return; }
        G.warnings.push("derived lock overridden by import/manual lock: " + d + " " + role + " derived " + id + ", locked to " + (e[role] || ("externalCover " + e.externalCover)));
        yieldOn(d, role, id, e[role] || ("ext:" + e.externalCover), role, e.source);
        return;
      }
      if (e[other + "Locked"] && e[other] === id) {
        G.warnings.push("derived lock skipped: " + d + " " + role + " derived " + id + " but he is import-locked as " + other + " that day");
        yieldOn(d, role, id, id, other, e.source);
        return;
      }
      e[role] = id;
      e[role + "Locked"] = true;
      if (!G.lockSrc[d].primary && !G.lockSrc[d].backup) e.source = "east-derived";
      G.lockSrc[d][role] = "derived";
    });
  });
  Object.keys(yieldWeeks).sort().forEach(function (k) {
    var parts = k.split("|"), r = ctx.rosterById[parts[2]];
    G.warnings.push("derived week " + parts[0] + " (" + ((r && r.name) || parts[2]) + " Silvis " + parts[1] + ") yields to published entries on " + yieldWeeks[k].join(", "));
  });
  return base;
}

// Review 2 (10/1): the standing schedule the run's hardNeverWeekdaysNoticeDays test reads (rules.js ctx.heldSchedule -
// "a slot he already holds" reads the soft hard-never-beyond-notice inside the notice; a new placement the hard rule).
// Outside the range the caller's snapshot stands. Inside it a slot is held only when the run STARTS from it (G.base:
// the locks / fixed slots genSeedLocks keeps, derived locks included) AND the caller's snapshot holds it with the same
// surgeon - so every slot the run places itself is a NEW placement measured from ctx.today (the default mode clears
// every unlocked slot first, so a Khan Tue/Thu it puts back inside the notice is hard and genEvaluate / genDiagnostics
// report it as a hard violation), a fill-open-only run's kept rows stay standing (soft), and a derived lock the
// caller's rows do not carry is new as well. A caller without a snapshot -> nothing held (the conservative reading).
function genRunHeld(G, callerHeld) {
  var out = Object.create(null), src = callerHeld || {};
  Object.keys(src).forEach(function (d) { out[d] = src[d]; });
  G.days.forEach(function (d) {
    var b = G.base[d], h = src[d];
    var p = b && h && b.primary && h.primary === b.primary ? b.primary : null;
    var k = b && h && b.backup && h.backup === b.backup ? b.backup : null;
    if (p || k) out[d] = { primary: p, backup: k }; else delete out[d];
  });
  return out;
}

/* ------------------------------------------------------------- units */

// buildUnits(ctx, startDate, endDate) -> { holidays, weekends, days, all, holidayDaySet }
// Holiday units pre-empt weekend days; the leftover Fri/Sat/Sun of a weekend
// form a reduced unit. Tightness (distinct surgeons that can take the unit in
// that role) is measured against ctx.schedule AS IT IS when called - generate()
// calls it on the lock-only schedule; the UI may call it on the live one.
function buildUnits(ctx, startDate, endDate) {
  var R = genRulesApi();
  genAssertDate(startDate, "startDate"); genAssertDate(endDate, "endDate");
  var days = genDaysList(startDate, endDate);
  var inRange = {};
  days.forEach(function (d) { inRange[d] = true; });
  var holidayDaySet = Object.create(null);
  var holidays = R.holidayUnits(ctx, startDate, endDate).map(function (u) {
    var unit = {
      kind: "holiday", key: "H:" + u.name + ":" + u.days[0], name: u.name, tier: u.tier, year: u.year,
      days: u.days.slice(), inRange: u.days.filter(function (d) { return inRange[d]; }), outOfRange: u.days.filter(function (d) { return !inRange[d]; }),
      unit: u, preemptedWeekendDays: [], tightness: {}
    };
    unit.inRange.forEach(function (d) { holidayDaySet[d] = unit; if (genFridayOf(d)) unit.preemptedWeekendDays.push(d); });
    return unit;
  });
  var weekendMap = Object.create(null), weekendOrder = [];
  var dayUnits = [];
  days.forEach(function (d) {
    if (holidayDaySet[d]) return;
    var fri = genFridayOf(d);
    if (fri) {
      var wu = weekendMap[fri];
      if (!wu) { wu = weekendMap[fri] = { kind: "weekend", key: "W:" + fri, friday: fri, present: [], preempted: [], reduced: false, tightness: {} }; weekendOrder.push(fri); }
      wu.present.push(d);
    } else {
      dayUnits.push({ kind: "day", key: "D:" + d, day: d, tightness: {} });
    }
  });
  var weekends = weekendOrder.map(function (fri) {
    var wu = weekendMap[fri];
    for (var k = 0; k < 3; k++) { var d = genAddDays(fri, k); if (wu.present.indexOf(d) < 0) wu.preempted.push(d); }
    wu.reduced = wu.present.length < 3;
    return wu;
  });
  // Tightness per role on the current schedule, and - from the same eligibility walk
  // (Prompt 12 J) - allowed[month][id][role]: the open in-range slots of the role the
  // rules let each surgeon take on this schedule (a holiday day counts when he is a
  // candidate for its unit; a weekend day as a block member of a full unit).
  var ids = ctx.activeIds, allowed = {};
  days.forEach(function (d) { var m = genMonthOf(d); if (!allowed[m]) { allowed[m] = {}; ids.forEach(function (id) { allowed[m][id] = { primary: 0, backup: 0 }; }); } });
  function countAllowed(d, id, role) { allowed[genMonthOf(d)][id][role]++; }
  GEN_ROLES.forEach(function (role) {
    holidays.forEach(function (u) {
      var openDays = u.inRange.filter(function (d) { return genSlotOpen(ctx.schedule[d], role); });
      if (!openDays.length) { u.tightness[role] = 99; return; }
      var cands = R.holidayUnitCandidates(ctx, { name: u.name, tier: u.tier, days: u.inRange }, role);
      u.tightness[role] = cands.length;
      cands.forEach(function (id) { openDays.forEach(function (d) { countAllowed(d, id, role); }); });
    });
    weekends.forEach(function (u) {
      var anyOpen = u.present.some(function (d) { return genSlotOpen(ctx.schedule[d], role); });
      if (!anyOpen) { u.tightness[role] = 99; return; }
      // distinct surgeons who can take at least one present day solo or as a
      // block member (cheaper than a full pattern enumeration, same ordering)
      var n = 0;
      for (var i = 0; i < ids.length; i++) {
        var can = false;
        for (var k = 0; k < u.present.length; k++) {
          var d = u.present[k];
          if (!genSlotOpen(ctx.schedule[d], role)) continue;
          var re = R.eligibility(ctx, d, role, ids[i], { asBlockMember: u.present.length === 3 });
          // Prompt 23 B2: a surgeon blocked ONLY by lone-weekend-day may take the day with its partner (Sat + Sun) - judge
          // him with the partner assumed (no other surgeon's reading changes: only noLoneWeekendDay raises the code)
          if (!re.ok && re.hard.length && re.hard.every(function (h) { return h.indexOf("lone-weekend-day:") === 0; })) {
            var partner = genWeekday(d) === "Sat" ? genAddDays(d, 1) : genAddDays(d, -1);
            if (u.present.indexOf(partner) >= 0) re = R.eligibility(ctx, d, role, ids[i], { asBlockMember: u.present.length === 3, assume: [{ date: partner, role: role }] });
          }
          if (re.ok) { can = true; countAllowed(d, ids[i], role); }
        }
        if (can) n++;
      }
      u.tightness[role] = n;
    });
    dayUnits.forEach(function (u) {
      if (!genSlotOpen(ctx.schedule[u.day], role)) { u.tightness[role] = 99; return; }
      var n = 0;
      for (var i = 0; i < ids.length; i++) if (R.eligibility(ctx, u.day, role, ids[i]).ok) { n++; countAllowed(u.day, ids[i], role); }
      u.tightness[role] = n;
    });
  });
  return { holidays: holidays, weekends: weekends, days: dayUnits, all: holidays.concat(weekends, dayUnits), holidayDaySet: holidayDaySet, allowed: allowed };
}

// Holidays first (tightest first), then weekends and day units together,
// most-constrained-first; ties: weekends before days, then seeded jitter.
// Prompt 14 P2: among the weekend + day units, those an eligible surgeon
// OFFERED (G.offeredUnit, per role) come first - the offers pass; with no
// offers every unit ranks alike and the order is exactly the pre-P2 order (the
// rng is consumed identically).
function genOrder(G, role, rng) {
  var offered = G.offeredUnit || {};
  function decorate(list, kindRank) { return list.map(function (u) { return { u: u, o: offered[u.key] && offered[u.key][role] ? 0 : 1, t: u.tightness[role], k: kindRank(u), j: rng() }; }); }
  function cmp(a, b) { return (a.t - b.t) || (a.k - b.k) || (a.j - b.j); }
  function cmpOffers(a, b) { return (a.o - b.o) || cmp(a, b); }
  var hol = decorate(G.units.holidays, function () { return 0; }).sort(cmp);
  var rest = decorate(G.units.weekends, function () { return 0; }).concat(decorate(G.units.days, function () { return 1; })).sort(cmpOffers);
  return hol.concat(rest).map(function (x) { return x.u; });
}

// Prompt 14 P2: G.offeredUnit[unit.key] = { primary, backup } - true when some
// active surgeon offered an OPEN slot of the unit in that role (rules.offeredOn:
// inside a period, status submitted, role covered) and is eligible for it on the
// lock-only schedule (solo, or as a block member of a full weekend). Measured
// once per generate(); everything false when no period touches the range.
function genOfferedUnits(G) {
  var ctx = G.ctx, R = G.R, out = {};
  var live = !!(ctx.periods && ctx.periods.length && typeof R.offeredOn === "function");
  G.units.all.forEach(function (u) {
    var o = { primary: false, backup: false };
    if (live) {
      var list = u.kind === "holiday" ? u.inRange : u.kind === "weekend" ? u.present : [u.day];
      var full = u.kind === "weekend" && u.present.length === 3;
      GEN_ROLES.forEach(function (role) {
        for (var i = 0; i < list.length && !o[role]; i++) {
          var d = list[i];
          if (!genSlotOpen(ctx.schedule[d], role)) continue;
          for (var j = 0; j < ctx.activeIds.length; j++) {
            var id = ctx.activeIds[j];
            if (!R.offeredOn(ctx, d, role, id)) continue;
            if (R.eligibility(ctx, d, role, id).ok || (full && R.eligibility(ctx, d, role, id, { asBlockMember: true }).ok)) { o[role] = true; break; }
          }
        }
      });
    }
    out[u.key] = o;
  });
  return out;
}

/* ----------------------------------------------------------- targets */

// Monthly targets - Prompt 12 J (9/22) restated by WF (Faraz 9/23): the WATER-FILLED
// SHARE, per role (rules doc section 6, guide section 15); Prompt 32 step 2 (Faraz
// 10/11): the backup share is WEIGHTED across the roles (genWeightedShares).
//   pool                     -> active roster ids with rules.poolMember !== false, no
//                               availableWindows and no roster type "external"
//                               (genPoolIds). Everyone in it carries BOTH targets.
//   per month                -> primaryOpen  = in-range PRIMARY slots open on the
//                               lock-only base; reservedForWindows = the windows
//                               surgeons' reserved primaries (window target x her
//                               window weeks of the month, capped by her open window
//                               days); backupOpen = in-range BACKUP slots open on the
//                               base. poolSlots.primary = (primaryOpen - reserved) +
//                               every PRIMARY day of the whole calendar month a pool
//                               member already holds on the base (import, manual,
//                               derived, claimed, published days outside the range);
//                               poolSlots.backup likewise = backupOpen + held backups.
//                               A slot held by a non-pool holder (the windows surgeon,
//                               an outside surgeon, externalCover) is not a pool slot.
//   clips (Prompt 32 step 2) -> clipPrimary (the CAP clip) = the soft limit
//                               (capPreferred) when set, else the hard cap
//                               (capPrimary) - the smaller when both are set - minus
//                               the East PRIMARY-week days of the month he does not
//                               hold as Silvis primary (a countsEastDays cap adds
//                               those days to his primary count whether or not he
//                               holds the derived Silvis backup - K); no "- 1" any
//                               more (Faraz 10/11: 7 is the group's soft limit and a
//                               target may sit on it); null with neither. The FILL
//                               clips add what the rules allow: fillClip.primary =
//                               min(clipPrimary, allowedPrimary + lockedHeld.primary),
//                               fillClip.backup = min(backupCap.perMonthDays,
//                               allowedBackup + lockedHeld.backup) - a member who
//                               cannot reach his share because of a rule or his
//                               availability takes what he can and the others share
//                               the rest.
//   primary (genWaterFill)   -> the pool's primary slots are poured over its members
//                               up to each member's fill clip: a member whose clip is
//                               below the level takes the clip and the remainder is
//                               shared by the others; the level L is the share of
//                               everyone the clip does not bind (sum over members of
//                               min(L, clip) = poolSlots). primaryShare = L (rounded
//                               to 0.1); null when every member sits on his clip (no
//                               level exists; the slots beyond the clips carry no
//                               target pressure).
//   backup (genWeightedFill) -> WEIGHTED across the roles (groupRules.shiftAccounting.
//                               weights through rules.shiftWeightsOf - primary 1 /
//                               backup 0.5 by default; Silvis days only): a common
//                               weighted level W* with b = clamp((W* - wP x p) / wB,
//                               0, fillClip.backup) summing to the pool's backup slots
//                               (bisection on W*, then solved exactly on the members
//                               it leaves unclamped, snapped to 1e-9). A member short
//                               of primaries carries wP / wB (= 2) backups per missing
//                               primary; when every p is equal it IS the plain equal
//                               backup share. backupShare = the backup share of a
//                               member on the primary level, (W* - wP x L) / wB;
//                               weightedShare = W*; null when every member sits on
//                               his backup clip.
//   reverse makeup           -> a member at his backup fill clip whose weighted load is
//                               below W* is held at min(fillClip.primary, (W* - wB x
//                               clipB) / wP) primaries when that is more than 0.05
//                               over his plain share - taken from the unclipped
//                               primary pool (the others re-fill around the hold) -
//                               and the backup fill re-runs; at most 3 rounds,
//                               deterministic, stop when no hold moves by more than
//                               0.05 (makeupRounds; members.makeupPrimary).
//   pool member              -> primaryTarget = round1(p), backupTarget = round1(b).
//                               NEVER floored at lockedHeld: a member whose fixed
//                               days exceed his share stands ABOVE target and the
//                               convex deviation keeps every further slot of the role
//                               away from him while anyone eligible is below share.
//                               lockedHeld stays in impliedTargets for display.
//                               weightedShare = round1(wP x primaryTarget + wB x
//                               backupTarget) beside the two (a missing role target
//                               reads 0, null without any).
//   numeric monthlyTarget    -> a NUMBER is the primary target (the backup target
//                               stays the share); an OBJECT { primary, backup } sets
//                               each numeric member. An overridden member is taken out
//                               of the fill for that role and his number comes off the
//                               pool's slots before the fill; he takes no makeup, and
//                               a primary-overridden member's backup is weighed at the
//                               primary level (today's handling: the plain share). An
//                               explicit null means "equal share" - there is no
//                               neutral term and no "explicit null = no target" branch.
//   availability windows +   -> (Prompt 12 N, 9/22 evening) primaryTarget = target x
//   daysPerWindowWeek.target    the window weeks whose window days fall in that month
//                               AND touch the generated range (a week counts once, in
//                               the month of its first window day); NO backup target;
//                               a month without a window week gives her no target at
//                               all (null, tallies "-"), never a numeric 0 (N review).
//                               She is outside the pool (and the weighted fill); her
//                               reserved primaries come off the pool's primaryOpen.
//   everyone else            -> no targets (poolMember false, external, windows
//                               without a target), unless a numeric override says so.
//   allowedPrimary / allowedBackup -> the month's in-range open slots of the role
//                               where eligibility() passes on the lock-only base
//                               (static availability, measured once per generate()
//                               inside buildUnits' tightness walk: a holiday day
//                               counts when he is a candidate for its unit, a
//                               weekend day of a full Fri-Sat-Sun unit counts when
//                               he may take it as a BLOCK MEMBER - so a
//                               weekend-block-only surgeon's weekend days count),
//                               so a shortfall caused by availability is visible -
//                               and, since Prompt 32 step 2, bounds the fill clips.
//   month scope              -> lockedHeld, poolSlots and the targets are whole-
//                               calendar-month figures (the deviation counts the
//                               merged month); a month the range only touches
//                               (rangeDays < its length) still pours its whole-month
//                               held days into the fill although few or no slots of
//                               it are being generated.
//   placeableAtTarget        -> sum over every targeted surgeon of max(0, target -
//                               lockedHeld) per role: the room the targets leave below
//                               them. It is at least the open slots of the role and
//                               exceeds them by the excess of the members whose fixed
//                               days already sit above their share (that excess is
//                               the others' room; it cannot be handed back).
//   heldAboveShare           -> sum over the pool of max(0, lockedHeld - target) per
//                               role: the fixed days above share the generator can
//                               only balance by placing nothing more on their holders.
// diagnostics.impliedTargets = { rule, pool, convexity, weights: { primary, backup },
// months: { m: { primaryOpen, backupOpen, poolSize, reservedForWindows, poolSlots:
// { primary, backup }, heldByPool: { primary, backup }, primaryShare, backupShare,
// weightedShare, makeupRounds, weights, rangeDays, placeableAtTarget: { primary,
// backup }, heldAboveShare: { primary, backup }, windowTarget, windowWeeks, members:
// { id: { primaryTarget, backupTarget, weightedShare, lockedHeld: { primary, backup },
// clipPrimary, fillClip: { primary, backup } | null, makeupPrimary, eastPrimaryDays,
// allowedPrimary, allowedBackup } } } } };
// diagnostics.targets (= scoreTargets) is the per-month { id: { primary, backup } }
// table the unit scoring, smoothing and the deviation terms use (the weighted view
// rides beside it in impliedTargets and the tallies, never inside it).
var GEN_TARGET_RULE = "water-filled share per role (J 9/22, WF 9/23) with the backup weighted across the roles (Prompt 32 step 2, 10/11): pool = active, poolMember !== false, no availableWindows, not external; poolSlots.primary = (open in-range primary slots - the windows surgeons' reserved primaries) + every primary day of the calendar month a pool member already holds (import, manual, derived, claimed, published outside the range), poolSlots.backup likewise; clipPrimary = the soft limit when set, else the hard cap (the smaller when both are set) - East primary-week days not held as Silvis primary (K; null with neither; no cap - 1); the fill clips add what the rules allow: fillClip.primary = min(clipPrimary, allowedPrimary + lockedHeld.primary), fillClip.backup = min(backupCap.perMonthDays, allowedBackup + lockedHeld.backup); primary: the slots are water-filled over the members up to their fill clips (a member whose clip is below the level takes the clip and the rest is shared by the others; primaryShare = the level, null when every member sits on his clip); backup: the weighted fill - a common weighted level W* (weights = groupRules.shiftAccounting.weights, primary 1 / backup 0.5 by default, Silvis days only) with backup = clamp((W* - wP x primary) / wB, 0, fillClip.backup) summing to the backup slots, so a member short of primaries carries wP / wB backups per missing primary and equal primaries give the plain equal backup share (backupShare = the backup share at the primary level, weightedShare = W*); reverse makeup: a member at his backup clip below W* is held at min(fillClip.primary, (W* - wB x clipB) / wP) primaries taken from the unclipped pool, at most 3 deterministic rounds (stop when no hold moves by more than 0.05); pool member primaryTarget / backupTarget = the two shares rounded to 0.1, weightedShare = wP x primaryTarget + wB x backupTarget - NEVER floored at lockedHeld, so fixed days count against the share; a numeric monthlyTarget sets the primary target, { primary, backup } sets each (the member leaves the fill for that role and his number comes off the pool's slots; no makeup), explicit null = equal share; windows + daysPerWindowWeek.target = target x window weeks of the month the range touches, primary only, no backup target, no target in a month without a window week (N); everyone else: no targets; the deviation term is |count - target| ^ deviationConvexity (2: convex, each slot above share costs more than the last and the member furthest below share wins); allowedPrimary / allowedBackup = open in-range slots where eligibility passes on the lock-only schedule (a weekend day of a full unit as a block member, a holiday day as a unit candidate); lockedHeld, poolSlots and the targets are whole-calendar-month figures even where the range only touches the month (rangeDays); placeableAtTarget = sum of max(0, target - lockedHeld) per role (the room below the targets; above the open slots by heldAboveShare = sum of max(0, lockedHeld - target), the fixed days already over share)";
// monthlyTarget override -> { primary: number|null, backup: number|null }
function genTargetOverride(v) {
  if (typeof v === "number" && isFinite(v)) return { primary: v, backup: null };
  if (v && typeof v === "object") return { primary: typeof v.primary === "number" && isFinite(v.primary) ? v.primary : null, backup: typeof v.backup === "number" && isFinite(v.backup) ? v.backup : null };
  return { primary: null, backup: null };
}
function genRound1(v) { return Math.round(v * 10) / 10; }
// Prompt 32 step 2: shares are snapped to 1e-9 so float noise never tips a round1 at an x.x5 edge
function genSnap9(v) { return Math.round(v * 1e9) / 1e9; }
// null-safe min (null = no limit)
function genMinNull(a, b) { return a === null || a === undefined ? (b === undefined ? null : b) : (b === null || b === undefined ? a : Math.min(a, b)); }
// WF 9/23 - the water fill. members: [{ id, clip }] (clip null = unclipped), slots: the
// pool's slots of the role in the month. Pours the slots over the members up to each
// clip: while the lowest clip is below an equal share of what is left, that member
// takes his clip and leaves the fill; the level L is the equal share of the rest among
// the members still in. Returns { level, share: { id: min(L, clip) } } with the raw
// (unrounded) values; sum over members of share = slots whenever the clips allow it,
// else every member sits on his clip and level is NULL (review fix 9/23: nobody is
// left in the fill, so there is no level to report - it used to read 0 while every
// share sat at its clip; the slots beyond the sum of the clips carry no target
// pressure, today's clip semantics). The raw values are rounded to 0.1 only when
// they are written out as targets (genRound1).
function genWaterFill(members, slots) {
  var remaining = Math.max(0, slots), share = {}, inFill = members.slice();
  inFill.sort(function (a, b) { return (a.clip === null ? Infinity : a.clip) - (b.clip === null ? Infinity : b.clip); });
  while (inFill.length && inFill[0].clip !== null && inFill[0].clip < remaining / inFill.length) {
    var m = inFill.shift();
    share[m.id] = m.clip;
    remaining -= m.clip;
  }
  var level = inFill.length ? remaining / inFill.length : null;
  inFill.forEach(function (m) { share[m.id] = m.clip === null ? level : Math.min(level, m.clip); });
  return { level: level, share: share };
}
function genByIdOrder(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }
// Prompt 32 step 2 (Faraz 10/11, DESIGN "Generator" 4) - the WEIGHTED backup fill.
// members: [{ id, p (his primary share), clip (backup fill clip, null = none) }],
// slots: the pool's backup slots, w: { primary, backup } (rules.shiftWeightsOf).
// Finds the common weighted level W* with sum over members of b = clamp((W* - w.primary
// x p) / w.backup, 0, clip) = slots: bisection on W* (60 iterations or 1e-9; f(W) is
// non-decreasing), then solved exactly on the members the level leaves unclamped
// (W = (w.backup x (slots - the clamped clips) + w.primary x their p) / their count).
// Returns { level: W* (null when every member sits on his clip, or no member), share:
// { id: b } }, both snapped to 1e-9. Equal p for everyone -> exactly the plain equal
// share of genWaterFill over the same clips (test/generator-regression.js pins it).
function genWeightedFill(members, slots, w) {
  var mem = members.slice().sort(genByIdOrder), share = {}, T = Math.max(0, slots);
  if (!mem.length) return { level: null, share: share };
  var bAt = function (m, W) { var b = (W - w.primary * m.p) / w.backup; if (b < 0) b = 0; if (m.clip !== null && b > m.clip) b = m.clip; return b; };
  var sumAt = function (W) { var s = 0; for (var i = 0; i < mem.length; i++) s += bAt(mem[i], W); return s; };
  var capSum = 0, open = false;
  mem.forEach(function (m) { if (m.clip === null) open = true; else capSum += m.clip; });
  if (!open && capSum < T - 1e-9) { mem.forEach(function (m) { share[m.id] = m.clip; }); return { level: null, share: share }; }
  var lo = Infinity, hi = -Infinity;
  mem.forEach(function (m) {
    var a = w.primary * m.p;
    if (a < lo) lo = a;
    var top = a + w.backup * (m.clip === null ? T : m.clip);
    if (top > hi) hi = top;
  });
  var W = lo; // f(lo) = 0: every b is 0 at the lowest primary load
  if (T > 0) {
    for (var it = 0; it < 60 && hi - lo > 1e-9; it++) { var mid = (lo + hi) / 2; if (sumAt(mid) >= T) hi = mid; else lo = mid; }
    W = hi;
    // exact on the active set: the members strictly between 0 and their clip at W
    var fixed = 0, act = 0, actP = 0;
    mem.forEach(function (m) {
      var b = (W - w.primary * m.p) / w.backup;
      if (b <= 0) return;
      if (m.clip !== null && b >= m.clip) { fixed += m.clip; return; }
      act++; actP += m.p;
    });
    if (act) { var Wx = (w.backup * (T - fixed) + w.primary * actP) / act; if (Math.abs(Wx - W) < 1e-6) W = Wx; }
  }
  mem.forEach(function (m) { share[m.id] = genSnap9(bAt(m, W)); });
  return { level: genSnap9(W), share: share };
}
// Prompt 32 step 2 (DESIGN "Generator" 3-6) - per-role shares + the weighted cross-role
// balance for one month. fm: [{ id, clipP, clipB (fill clips, null = none), ovP, ovB
// (monthlyTarget overrides, null = none) }], slots: { primary, backup } (the pool's
// slots, overrides included), w: the shift weights.
//   3 primary: genWaterFill over the members without a primary override (their numbers
//     come off the slots first) -> p;
//   4 backup: genWeightedFill over the members without a backup override, each weighed
//     at his p (a primary-overridden member at the primary level - today's plain share);
//   5 reverse makeup: a member in both fills at his backup clip whose weighted load is
//     below W* wants min(clipP, (W* - w.backup x clipB) / w.primary) primaries; when that
//     is more than 0.05 over his plain share (min(level, clipP)) he is HELD there, the
//     others re-fill the remaining primaries (the unclipped pool gives them up) and the
//     backup fill re-runs; at most 3 rounds, stop when no hold moves by more than 0.05
//     (a hold may also come back down when the level it read moved). Deterministic: no
//     rng, members in id order.
// Returns { primary: { level, share }, backup: { level: the backup share at the primary
// level ((W* - w.primary x level) / w.backup, null without W*), share }, weightedLevel:
// W*, makeup: { id: hold - plain share }, rounds }.
function genWeightedShares(fm, slots, w) {
  var mem = fm.slice().sort(genByIdOrder), pSlots = slots.primary, bSlots = slots.backup, pm = [], bm = [];
  mem.forEach(function (m) {
    if (m.ovP !== null && m.ovP !== undefined) pSlots -= m.ovP; else pm.push(m);
    if (m.ovB !== null && m.ovB !== undefined) bSlots -= m.ovB; else bm.push(m);
  });
  var holds = {}, rounds = 0;
  var solve = function () {
    var free = [], heldSum = 0;
    pm.forEach(function (m) { if (holds[m.id] !== undefined) heldSum += holds[m.id]; else free.push({ id: m.id, clip: m.clipP }); });
    var fp = genWaterFill(free, pSlots - heldSum), p = {}, pMax = null;
    pm.forEach(function (m) { p[m.id] = holds[m.id] !== undefined ? holds[m.id] : fp.share[m.id]; if (pMax === null || p[m.id] > pMax) pMax = p[m.id]; });
    var lref = fp.level !== null ? fp.level : pMax;
    var fb = genWeightedFill(bm.map(function (m) {
      var pp = m.ovP !== null && m.ovP !== undefined ? (lref !== null ? lref : m.ovP) : p[m.id];
      return { id: m.id, p: pp, clip: m.clipB };
    }), bSlots, w);
    return { p: p, pLevel: fp.level, lref: lref, b: fb.share, wLevel: fb.level };
  };
  var plainOf = function (st, m) { var c = m.clipP === null ? Infinity : m.clipP; return st.pLevel === null ? c : Math.min(st.pLevel, c); };
  var st = solve();
  while (rounds < 3 && st.wLevel !== null) {
    var next = {}, sum = 0;
    pm.forEach(function (m) {
      if ((m.ovB !== null && m.ovB !== undefined) || m.clipB === null) return; // out of the weighted fill / no backup clip to hit
      var want = genSnap9(Math.min(m.clipP === null ? Infinity : m.clipP, (st.wLevel - w.backup * m.clipB) / w.primary));
      if (want > plainOf(st, m) + 0.05) { next[m.id] = want; sum += want; }
    });
    var moved = Object.keys(next).some(function (id) { return holds[id] === undefined || Math.abs(next[id] - holds[id]) > 0.05; }) || Object.keys(holds).some(function (id) { return next[id] === undefined; });
    if (!moved || sum > pSlots) break; // nothing moves, or the holds would not leave the others a non-negative pool
    holds = next; rounds++; st = solve();
  }
  var makeup = {};
  pm.forEach(function (m) { if (holds[m.id] !== undefined) makeup[m.id] = genSnap9(holds[m.id] - plainOf(st, m)); });
  var bLevel = st.wLevel === null || st.lref === null ? null : Math.max(0, genSnap9((st.wLevel - w.primary * st.lref) / w.backup));
  return { primary: { level: st.pLevel, share: st.p }, backup: { level: bLevel, share: st.b }, weightedLevel: st.wLevel, makeup: makeup, rounds: rounds };
}
// weighted share of a role pair (Prompt 32 step 2): a missing role target reads 0; null without any
function genWeightedOf(tP, tB, w) {
  if (typeof tP !== "number" && typeof tB !== "number") return null;
  return genRound1(w.primary * (typeof tP === "number" ? tP : 0) + w.backup * (typeof tB === "number" ? tB : 0));
}
function genTargets(G) {
  var ctx = G.ctx, base = ctx.schedule, ids = ctx.activeIds, pool = genPoolIds(G), sw = G.shiftWeights;
  var byMonth = {}, implied = { rule: GEN_TARGET_RULE, pool: pool.slice(), convexity: G.convexity, weights: { primary: sw.primary, backup: sw.backup }, months: {} };
  var poolSet = {};
  pool.forEach(function (id) { poolSet[id] = true; });
  G.months.forEach(function (month) {
    var inMonth = G.days.filter(function (d) { return genMonthOf(d) === month; });
    var primaryOpen = 0, backupOpen = 0;
    inMonth.forEach(function (d) { if (genSlotOpen(base[d], "primary")) primaryOpen++; if (genSlotOpen(base[d], "backup")) backupOpen++; });
    // N: window target x the window weeks of this month that the generated range touches (a week counts
    // once, by its first window day; a week entirely outside the range adds nothing - like every other
    // target here, hers is measured on the range being generated). Her reserved primaries - capped by
    // the open window days she can actually hold - come off the pool's primary slots.
    var reserved = 0, windowTarget = {}, windowWeeks = {}, windowIds = {};
    ids.forEach(function (id) {
      var P = ctx.per[id];
      if (!P.hasWindows || P.windowTarget === null || P.rules.poolMember === false || genIsExternal(ctx, id)) return;
      var weeks = G.windowWeeks[id] || {};
      var nWeeks = Object.keys(weeks).filter(function (mon) { return genMonthOf(weeks[mon][0]) === month && weeks[mon].some(function (d) { return d >= G.start && d <= G.end; }); }).length;
      var wt = P.windowTarget * nWeeks;
      var openWindow = inMonth.filter(function (d) { return P.windowDays.has(d) && genSlotOpen(base[d], "primary"); }).length;
      windowTarget[id] = wt; windowWeeks[id] = nWeeks; windowIds[id] = true;
      reserved += Math.min(wt, openWindow);
    });
    var poolN = pool.length;
    // per surgeon: whole-month held days per role, the cap clip, the backup cap, the override,
    // static availability (counted by buildUnits on the same lock-only schedule - one eligibility walk)
    // and - pool members - the fill clips (Prompt 32 step 2)
    var facts = {};
    ids.forEach(function (id) {
      var P = ctx.per[id], r = P.rules, ov = genTargetOverride(r.monthlyTarget);
      var heldP = 0, heldB = 0, eastP = 0;
      genMonthDays(month).forEach(function (d) {
        var e = base[d];
        if (e && e.primary === id) heldP++;
        if (e && e.backup === id) heldB++;
        // K: the days a countsEastDays cap adds to his PRIMARY count - every East primary-week day
        // he does not already hold as Silvis primary (held or not as the derived Silvis backup)
        if (P.countsEastDays && P.eastPrimaryDays.has(d) && !(e && e.primary === id)) eastP++;
      });
      // Prompt 32 step 2 (Faraz 10/11 decision 3): the soft limit when set, else the hard cap - no "- 1"
      var clip = null;
      if (poolSet[id]) {
        var lim = genMinNull(P.capPreferred, P.capPrimary);
        if (lim !== null) clip = Math.max(0, lim - eastP);
      }
      var bCap = r.backupCap && typeof r.backupCap.perMonthDays === "number" ? r.backupCap.perMonthDays : null;
      var al = (G.units.allowed[month] && G.units.allowed[month][id]) || { primary: 0, backup: 0 };
      var fillClip = poolSet[id] ? { primary: genMinNull(clip, al.primary + heldP), backup: genMinNull(bCap, al.backup + heldB) } : null;
      facts[id] = { heldP: heldP, heldB: heldB, eastP: eastP, clip: clip, bCap: bCap, ov: ov, al: al, fillClip: fillClip };
    });
    // WF: the pool's slots of the month = the open in-range slots (primary: after the windows surgeons'
    // reserved primaries) + every day of the calendar month a pool member already holds. An overridden
    // member leaves the fill for that role and his number comes off the slots first (genWeightedShares).
    var heldByPool = { primary: 0, backup: 0 };
    pool.forEach(function (id) { heldByPool.primary += facts[id].heldP; heldByPool.backup += facts[id].heldB; });
    var poolSlots = { primary: Math.max(0, primaryOpen - reserved) + heldByPool.primary, backup: backupOpen + heldByPool.backup };
    var shares = genWeightedShares(pool.map(function (id) {
      var f = facts[id];
      return { id: id, clipP: f.fillClip.primary, clipB: f.fillClip.backup, ovP: f.ov.primary, ovB: f.ov.backup };
    }), poolSlots, sw);
    // the levels: primary = the share of an unclipped member; backup = the backup share of a member on that level;
    // weighted = W*; each null when every member sits on his clip (or the pool is empty)
    var primaryShare = shares.primary.level === null ? null : genRound1(shares.primary.level);
    var backupShare = shares.backup.level === null ? null : genRound1(shares.backup.level);
    var weightedShare = shares.weightedLevel === null ? null : genRound1(shares.weightedLevel);
    var I = implied.months[month] = { primaryOpen: primaryOpen, backupOpen: backupOpen, poolSize: poolN, reservedForWindows: reserved, poolSlots: poolSlots, heldByPool: heldByPool, primaryShare: primaryShare, backupShare: backupShare, weightedShare: weightedShare, makeupRounds: shares.rounds, weights: { primary: sw.primary, backup: sw.backup }, rangeDays: inMonth.length, placeableAtTarget: { primary: 0, backup: 0 }, heldAboveShare: { primary: 0, backup: 0 }, windowTarget: windowTarget, windowWeeks: windowWeeks, members: {} };
    byMonth[month] = {};
    ids.forEach(function (id) {
      var f = facts[id], tP = f.ov.primary, tB = f.ov.backup;
      if (poolSet[id]) {
        // the water-filled primary / the weighted backup share; NEVER floored at the held days
        if (tP === null) tP = genRound1(shares.primary.share[id]);
        if (tB === null) tB = genRound1(shares.backup.share[id]);
      } else if (windowIds[id]) {
        // (N review) no window week in this month -> no target (tallies "-"), never a numeric 0
        if (tP === null) tP = windowWeeks[id] ? windowTarget[id] : null;
      }
      var makeupP = poolSet[id] ? (shares.makeup[id] !== undefined ? genRound1(shares.makeup[id]) : 0) : null;
      I.members[id] = { primaryTarget: tP, backupTarget: tB, weightedShare: genWeightedOf(tP, tB, sw), lockedHeld: { primary: f.heldP, backup: f.heldB }, clipPrimary: f.clip, fillClip: f.fillClip, makeupPrimary: makeupP, eastPrimaryDays: f.eastP, allowedPrimary: f.al.primary, allowedBackup: f.al.backup };
      byMonth[month][id] = { primary: tP, backup: tB };
      // the room below the targets, and the fixed days already above share (see the header)
      if (typeof tP === "number") { I.placeableAtTarget.primary += Math.max(0, tP - f.heldP); I.heldAboveShare.primary += Math.max(0, f.heldP - tP); }
      if (typeof tB === "number") { I.placeableAtTarget.backup += Math.max(0, tB - f.heldB); I.heldAboveShare.backup += Math.max(0, f.heldB - tB); }
    });
    I.placeableAtTarget.primary = genRound1(I.placeableAtTarget.primary);
    I.placeableAtTarget.backup = genRound1(I.placeableAtTarget.backup);
    I.heldAboveShare.primary = genRound1(I.heldAboveShare.primary);
    I.heldAboveShare.backup = genRound1(I.heldAboveShare.backup);
  });
  return { byMonth: byMonth, implied: implied };
}

// Day-unit slots where exactly one surgeon is eligible on the lock-only
// schedule -> G.forced[id][month] = [{ day, roles }] (one entry per day).
function genForcedSlots(G) {
  var ctx = G.ctx, R = G.R, ids = ctx.activeIds, out = {};
  G.units.days.forEach(function (u) {
    var sole = {};
    GEN_ROLES.forEach(function (role) {
      if (!genSlotOpen(ctx.schedule[u.day], role)) return;
      var found = null, n = 0;
      for (var i = 0; i < ids.length && n < 2; i++) if (R.eligibility(ctx, u.day, role, ids[i]).ok) { n++; found = ids[i]; }
      if (n === 1) (sole[found] = sole[found] || []).push(role);
    });
    Object.keys(sole).forEach(function (id) {
      var m = genMonthOf(u.day);
      out[id] = out[id] || {};
      (out[id][m] = out[id][m] || []).push({ day: u.day, roles: sole[id] });
    });
  });
  return out;
}

/* ------------------------------------------------------- unit filling */

function genFillUnit(G, S, unit, role, rng) {
  if (unit.kind === "holiday") return genFillHoliday(G, S, unit, role, rng);
  if (unit.kind === "weekend") return genFillWeekend(G, S, unit, role, rng);
  return genFillDay(G, S, unit.day, role, rng);
}

// Day unit / single slot: best eligible surgeon (soft + target delta + jitter).
function genFillDay(G, S, day, role, rng) {
  var ctx = G.ctx, R = G.R, W = ctx.schedule;
  if (!genSlotOpen(W[day], role)) return true;
  var ids = ctx.activeIds, best = null, bestScore = 0, month = genMonthOf(day);
  for (var i = 0; i < ids.length; i++) {
    var r = R.eligibility(ctx, day, role, ids[i]);
    if (!r.ok) continue;
    // Prompt 32 step 4: the jitter is drawn for every eligible candidate as before; one the day takes over his soft limit
    // carries the deterministic tie-break (genSoftLimitTie) instead of it
    var j = rng ? rng() * G.jitter : 0, tie = genSoftLimitTie(G, S, ids[i], [day], role);
    var s = genSoftSum(r) + genOfferTaper(G, S, ids[i], [day], role, day) + genTargetDelta(G, S, ids[i], month, 1, day, role) + (tie === null ? j : tie);
    if (best === null || s < bestScore) { best = ids[i]; bestScore = s; }
  }
  if (best === null) return false;
  genSet(G, S, day, role, best);
  return true;
}

function genWeekendDiag(S, unit) {
  var d = S.weekendDiag[unit.key];
  if (!d) d = S.weekendDiag[unit.key] = { friday: unit.friday, present: unit.present.slice(), preempted: unit.preempted.slice(), reduced: unit.reduced, roles: {} };
  return d;
}
function genMembersOf(W, unit, role) {
  var m = { fri: null, sat: null, sun: null };
  ["fri", "sat", "sun"].forEach(function (k, i) { var d = genAddDays(unit.friday, i); if (unit.present.indexOf(d) >= 0 && W[d]) m[k] = W[d][role] || null; });
  return m;
}
function genStyleMismatch(G, unit, role, members) {
  var W = G.ctx.schedule, out = [];
  var ids = [members.fri, members.sat, members.sun].filter(function (v, i, a) { return v && a.indexOf(v) === i; });
  ids.forEach(function (id) {
    // Prompt 23 B2: a standaloneFriday surgeon's PRIMARY shapes are {Fri}, {Sat, Sun} and {Fri, Sat, Sun} of a whole
    // weekend (whatever his weekendStyle); a weekend a holiday unit cuts carries no shape test for him (rules.js reads
    // the same). Any other holding of his is a mismatch.
    if (role === "primary" && G.ctx.per[id].standaloneFriday) {
      if (unit.present.length < 3) return;
      var h = unit.present.map(function (d) { return W[d][role] === id; });
      if (!((h[0] && !h[1] && !h[2]) || (!h[0] && h[1] && h[2]) || (h[0] && h[1] && h[2]))) out.push(id);
      return;
    }
    if (G.ctx.per[id].weekendStyle !== "block") return;
    var holdsAll = unit.present.every(function (d) { return W[d][role] === id; });
    if (!holdsAll) out.push(id);
  });
  return out;
}

// Weekend unit: legal patterns from rules.weekendUnitPatterns over the present
// (non-holiday, in-range) days. When no pattern covers every present day, the
// days nobody can take are dropped (they stay open with reasons) and the rest
// are enumerated again as a reduced unit flagged fallback.
function genFillWeekend(G, S, unit, role, rng) {
  var ctx = G.ctx, R = G.R, W = ctx.schedule;
  var diag = genWeekendDiag(S, unit);
  var open = unit.present.filter(function (d) { return genSlotOpen(W[d], role); });
  if (!open.length) {
    var mem0 = genMembersOf(W, unit, role);
    diag.roles[role] = { kind: "locked", members: mem0, penalty: 0, fallback: false, styleMismatch: [], locked: true };
    return true;
  }
  var used = unit.present, partial = false;
  var patterns = R.weekendUnitPatterns(ctx, unit.friday, role, used);
  if (!patterns.length) {
    var fillable = unit.present.filter(function (d) {
      if (!genSlotOpen(W[d], role)) return true;
      for (var i = 0; i < ctx.activeIds.length; i++) if (R.eligibility(ctx, d, role, ctx.activeIds[i]).ok) return true;
      return false;
    });
    // Prompt 23 review (10/1): a Saturday / Sunday only a noLoneWeekendDay surgeon can take fails every solo check with
    // lone-weekend-day, yet the PAIR is legal for him (buildUnits and weekendUnitPatterns judge him with the partner
    // assumed). Such a day is kept together with its open partner when one surgeon blocked solo ONLY by lone-weekend-day
    // passes both days with the other assumed - so the pair stays in the reduced unit instead of that day being dropped
    // while its partner (fillable by others) goes to someone else (one open Friday, not an open Friday + Saturday). The
    // pair-kept set is tried first; when it yields no pattern the solo set below runs exactly as before. Nobody with the
    // key on the roster -> nothing here runs (byte-identical).
    var tries = [];
    if (ctx.activeIds.some(function (id) { return ctx.per[id] && ctx.per[id].noLoneWeekend; })) {
      var pairKept = unit.present.filter(function (d) {
        if (fillable.indexOf(d) >= 0) return false;
        var wd = genWeekday(d);
        if (wd !== "Sat" && wd !== "Sun") return false;
        var p = wd === "Sat" ? genAddDays(d, 1) : genAddDays(d, -1);
        if (unit.present.indexOf(p) < 0 || !genSlotOpen(W[p], role)) return false;
        for (var i = 0; i < ctx.activeIds.length; i++) {
          var id = ctx.activeIds[i], r0 = R.eligibility(ctx, d, role, id);
          if (r0.ok || !r0.hard.length || !r0.hard.every(function (h) { return h.indexOf("lone-weekend-day:") === 0; })) continue;
          if (R.eligibility(ctx, d, role, id, { assume: [{ date: p, role: role }] }).ok && R.eligibility(ctx, p, role, id, { assume: [{ date: d, role: role }] }).ok) return true;
        }
        return false;
      });
      if (pairKept.length) tries.push(unit.present.filter(function (d) { return fillable.indexOf(d) >= 0 || pairKept.indexOf(d) >= 0; }));
    }
    tries.push(fillable);
    for (var ti = 0; ti < tries.length && !patterns.length; ti++) {
      var t = tries[ti];
      if (t.length && t.length < unit.present.length) { used = t; partial = true; patterns = R.weekendUnitPatterns(ctx, unit.friday, role, used); }
    }
  }
  if (!patterns.length) {
    diag.roles[role] = { kind: "open", members: genMembersOf(W, unit, role), penalty: 0, fallback: true, styleMismatch: [], openDays: open.slice() };
    return false;
  }
  // Slots this pattern would actually write: present, in `used`, still open.
  var keys = ["fri", "sat", "sun"], slotDay = [], slotKey = [];
  for (var q = 0; q < 3; q++) { var dq = genAddDays(unit.friday, q); if (used.indexOf(dq) >= 0 && genSlotOpen(W[dq], role)) { slotDay.push(dq); slotKey.push(keys[q]); } }
  var best = null, bestScore = 0;
  for (var p = 0; p < patterns.length; p++) {
    var pat = patterns[p], perId = null;
    // Prompt 32 step 4: the pattern's jitter is drawn as before; a pattern that takes a member over his soft limit carries
    // the members' deterministic tie-breaks (genSoftLimitTie) instead of it
    var jit = rng ? rng() * G.jitter : 0, tie = null;
    var s = pat.penalty;
    for (var j = 0; j < slotDay.length; j++) {
      var mid = pat.members[slotKey[j]];
      if (!mid) continue;
      if (!perId) perId = {};
      (perId[mid] = perId[mid] || []).push(slotDay[j]);
    }
    if (perId) for (var pid in perId) {
      s += genTargetDeltaForDays(G, S, pid, perId[pid], role) + genOfferTaper(G, S, pid, perId[pid], role, null);
      var tb = genSoftLimitTie(G, S, pid, perId[pid], role);
      if (tb !== null) tie = (tie === null ? 0 : tie) + tb;
    }
    s += tie === null ? jit : tie;
    if (best === null || s < bestScore) { best = pat; bestScore = s; }
  }
  ["fri", "sat", "sun"].forEach(function (k, i) {
    var d = genAddDays(unit.friday, i), id = best.members[k];
    if (!id || used.indexOf(d) < 0 || !genSlotOpen(W[d], role)) return;
    genSet(G, S, d, role, id);
  });
  var members = genMembersOf(W, unit, role);
  var mismatch = genStyleMismatch(G, unit, role, members);
  diag.roles[role] = {
    kind: best.kind, members: members, penalty: best.penalty, fallback: !!(best.fallback || partial || mismatch.length),
    styleMismatch: mismatch, partial: partial, openDays: unit.present.filter(function (d) { return genSlotOpen(W[d], role); })
  };
  // Prompt 23 B2: a 'friday' pattern whose Saturday-Sunday are two daily days carries the daily-pattern penalty too
  if (best.kind === "daily" || (best.kind === "friday" && best.fallback)) S.patternPenalties.push({ day: unit.friday, role: role, id: null, reason: "pattern-daily", weight: G.W.patternDaily });
  return !partial;
}

function genHolidayDiag(S, unit) {
  var d = S.holidayDiag[unit.key];
  if (!d) d = S.holidayDiag[unit.key] = { name: unit.name, tier: unit.tier, days: unit.days.slice(), inRange: unit.inRange.slice(), outOfRange: unit.outOfRange.slice(), partial: unit.outOfRange.length > 0, preemptedWeekendDays: unit.preemptedWeekendDays.slice(), primary: null, backup: null, primaryLocked: false, backupLocked: false, candidates: {} };
  return d;
}

// Holiday unit: one surgeon for every in-range unit day (rules.holidayUnitCandidates);
// a holder already published on an out-of-range unit day is preferred.
function genFillHoliday(G, S, unit, role, rng) {
  var ctx = G.ctx, R = G.R, W = ctx.schedule;
  var diag = genHolidayDiag(S, unit);
  var open = unit.inRange.filter(function (d) { return genSlotOpen(W[d], role); });
  if (!unit.inRange.length) return true;
  if (!open.length) {
    diag[role] = W[unit.inRange[0]][role] || null;
    diag[role + "Locked"] = !!(W[unit.inRange[0]][role + "Locked"] || W[unit.inRange[0]].externalCover);
    return true;
  }
  // Prompt 12 M (review 9/22): a unit day held by a hand-written outside surgeon breaks the one-holder unit
  // for that role - he is never a unit candidate (not in activeIds), so the other in-range days are filled
  // day by day around him (the path a broken weekend unit takes), never left open for want of a whole-unit
  // holder. One warning per unit and role; the diagnostic records the break and the daily fill.
  var brokenDays = unit.inRange.filter(function (d) { return genIsExternal(ctx, W[d][role]); });
  if (brokenDays.length) {
    var extId = W[brokenDays[0]][role];
    diag[role + "BrokenBy"] = { id: extId, days: brokenDays.slice() };
    var daily = diag[role + "Daily"] = diag[role + "Daily"] || {};
    var brokenMsg = "holiday unit " + unit.name + " " + unit.days[0] + ": " + role + " broken by hand-written outside surgeon " + extId + " on " + brokenDays.join(", ") + " - the other unit day(s) are filled day by day";
    if (S.warnings.indexOf(brokenMsg) < 0) S.warnings.push(brokenMsg);
    var allFilled = true;
    open.forEach(function (d) {
      var best = genBestFor(G, S, d, role, []);
      if (best) { genSet(G, S, d, role, best); daily[d] = best; } else allFilled = false;
    });
    diag[role] = extId;
    diag.candidates[role] = [];
    return allFilled;
  }
  var cands = R.holidayUnitCandidates(ctx, { name: unit.name, tier: unit.tier, days: unit.inRange }, role);
  var outHolder = null, outMixed = false;
  unit.outOfRange.forEach(function (d) { var e = W[d]; var h = e && e[role]; if (!h) return; if (outHolder && outHolder !== h) outMixed = true; outHolder = h; });
  if (outHolder && !outMixed) {
    if (cands.indexOf(outHolder) >= 0) cands = [outHolder];
    else S.warnings.push("holiday unit " + unit.name + " " + unit.days[0] + ": " + role + " " + outHolder + " holds the out-of-range day(s) but is not eligible for the in-range day(s); the unit is split across the range boundary");
  }
  diag.candidates[role] = cands.slice();
  if (!cands.length) { diag[role] = null; return false; }
  var best = null, bestScore = 0;
  for (var c = 0; c < cands.length; c++) {
    var id = cands[c], soft = 0;
    for (var k = 0; k < unit.inRange.length; k++) {
      var d = unit.inRange[k];
      var r = R.eligibility(ctx, d, role, id, { assume: unit.inRange.filter(function (x) { return x !== d; }).map(function (x) { return { date: x, role: role }; }) });
      soft += genSoftSum(r);
    }
    // Prompt 32 step 4: a candidate the unit takes over his soft limit carries the deterministic tie-break instead of the jitter (still drawn)
    var jh = rng ? rng() * G.jitter : 0, tieH = genSoftLimitTie(G, S, id, open, role);
    var s = soft + genOfferTaper(G, S, id, open, role, null) + genTargetDeltaForDays(G, S, id, open, role) + genHolidayLoad(G, id, unit.tier) * G.W.medium + (tieH === null ? jh : tieH);
    if (best === null || s < bestScore) { best = id; bestScore = s; }
  }
  open.forEach(function (d) { genSet(G, S, d, role, best); });
  diag[role] = best;
  return true;
}

/* -------------------------------------------------------------- repair */

function genOpenSlots(G) {
  var out = [], W = G.ctx.schedule;
  G.days.forEach(function (d) { GEN_ROLES.forEach(function (role) { if (genSlotOpen(W[d], role)) out.push({ day: d, role: role }); }); });
  return out;
}

// Best eligible surgeon for a slot by soft sum (no jitter), excluding ids.
function genBestFor(G, S, day, role, exclude) {
  var ctx = G.ctx, R = G.R, ids = ctx.activeIds, best = null, bestScore = 0;
  for (var i = 0; i < ids.length; i++) {
    if (exclude.indexOf(ids[i]) >= 0) continue;
    var r = R.eligibility(ctx, day, role, ids[i]);
    if (!r.ok) continue;
    var tie = genSoftLimitTie(G, S, ids[i], [day], role); // Prompt 32 step 4 (no jitter here; the term alone)
    var s = genSoftSum(r) + genOfferTaper(G, S, ids[i], [day], role, day) + genTargetDelta(G, S, ids[i], genMonthOf(day), 1, day, role) + (tie === null ? 0 : tie);
    if (best === null || s < bestScore) { best = ids[i]; bestScore = s; }
  }
  return best;
}

// Generator-placed, non-locked DAY-UNIT slots of `id` near `nearDay` (weekend
// and holiday slots are never moved: their unit shape would break).
function genMovable(S, id, nearDay) {
  var out = [], keys = Object.keys(S.placed);
  for (var i = 0; i < keys.length; i++) {
    var p = S.placed[keys[i]];
    if (p.id !== id || p.unitKind !== "day") continue;
    var dist = Math.abs(genDaysBetween(nearDay, p.day));
    if (dist > 12) continue;
    out.push({ p: p, dist: dist });
  }
  out.sort(function (a, b) { return (a.dist - b.dist) || (a.p.day < b.p.day ? -1 : a.p.day > b.p.day ? 1 : 0) || (a.p.role < b.p.role ? -1 : 1); });
  return out.map(function (x) { return x.p; });
}

function genVerify(G, moves) {
  for (var i = 0; i < moves.length; i++) {
    var m = moves[i];
    if (!G.R.eligibility(G.ctx, m[0], m[1], m[2], { asBlockMember: genHoldsFullBlock(G.ctx.schedule, m[0], m[1], m[2]) }).ok) return false;
  }
  return true;
}

// 1-hop: X takes the open slot after one of his day-unit slots goes to an
// eligible Y. 2-hop: Y in turn frees one of his slots to an eligible Z. Every
// move is re-checked through eligibility() on the final state or rolled back.
function genSwapFill(G, S, day, role) {
  var ctx = G.ctx, R = G.R, ids = ctx.activeIds;
  for (var xi = 0; xi < ids.length; xi++) {
    var X = ids[xi];
    var rx = R.eligibility(ctx, day, role, X);
    if (rx.ok || !genDynamicOnly(rx.hard)) continue;
    var slotsX = genMovable(S, X, day);
    for (var a = 0; a < slotsX.length; a++) {
      var sx = slotsX[a];
      genUnset(G, S, sx.day, sx.role);
      if (!R.eligibility(ctx, day, role, X).ok) { genSet(G, S, sx.day, sx.role, X); continue; }
      genSet(G, S, day, role, X);
      var Y = genBestFor(G, S, sx.day, sx.role, [X]);
      if (Y) {
        genSet(G, S, sx.day, sx.role, Y);
        if (genVerify(G, [[day, role, X], [sx.day, sx.role, Y]])) return true;
        genUnset(G, S, sx.day, sx.role);
      }
      for (var yi = 0; yi < ids.length; yi++) {
        var Yc = ids[yi];
        if (Yc === X) continue;
        var ry = R.eligibility(ctx, sx.day, sx.role, Yc);
        if (ry.ok || !genDynamicOnly(ry.hard)) continue;
        var slotsY = genMovable(S, Yc, sx.day);
        for (var b = 0; b < slotsY.length; b++) {
          var sy = slotsY[b];
          if (sy.day === day && sy.role === role) continue;
          genUnset(G, S, sy.day, sy.role);
          if (!R.eligibility(ctx, sx.day, sx.role, Yc).ok) { genSet(G, S, sy.day, sy.role, Yc); continue; }
          genSet(G, S, sx.day, sx.role, Yc);
          var Z = genBestFor(G, S, sy.day, sy.role, [Yc]);
          if (Z) {
            genSet(G, S, sy.day, sy.role, Z);
            if (genVerify(G, [[day, role, X], [sx.day, sx.role, Yc], [sy.day, sy.role, Z]])) return true;
            genUnset(G, S, sy.day, sy.role);
          }
          genUnset(G, S, sx.day, sx.role);
          genSet(G, S, sy.day, sy.role, Yc);
        }
      }
      genUnset(G, S, day, role);
      genSet(G, S, sx.day, sx.role, X);
    }
  }
  return false;
}

function genRepair(G, S, rng) {
  var W = G.ctx.schedule;
  genOpenSlots(G).forEach(function (slot) {
    if (!genSlotOpen(W[slot.day], slot.role)) return;
    var hol = G.units.holidayDaySet[slot.day];
    if (hol) { genFillHoliday(G, S, hol, slot.role, rng); return; } // unit-level retry only: a unit is one commitment
    if (genFillDay(G, S, slot.day, slot.role, null)) return;
    genSwapFill(G, S, slot.day, slot.role);
  });
  // Last sweep: anything a swap opened up.
  genOpenSlots(G).forEach(function (slot) {
    if (G.units.holidayDaySet[slot.day]) return;
    genFillDay(G, S, slot.day, slot.role, null);
  });
}

/* ----------------------------------------------------------- smoothing */

// Prompt 12 J: smoothing runs per ROLE - a primary day moves against the primary targets,
// a backup day against the backup targets (day-unit slots only; every move through
// eligibility(); the soft score may not worsen beyond weights.smoothingTolerance; the
// role's CONVEX deviation must strictly fall). WF 9/23: donors are every targeted surgeon
// from the furthest above his target down, receivers every targeted surgeon from the
// furthest below up - a move between two members both above (or both below) share
// lowers the convex sum whenever their distances differ by more than one day, so the
// old "above target -> below target" gate is gone; the strict-fall test keeps it exact.
function genSmooth(G, S) {
  var ctx = G.ctx, R = G.R, ids = ctx.activeIds;
  var tol = typeof G.W.smoothingTolerance === "number" ? G.W.smoothingTolerance : 2;
  for (var iter = 0; iter < 400; iter++) {
    var moved = false;
    for (var mi = 0; mi < G.months.length && !moved; mi++) {
      var month = G.months[mi];
      for (var ri = 0; ri < GEN_ROLES.length && !moved; ri++) {
        var role = GEN_ROLES[ri], T = {}, counts = {};
        ids.forEach(function (id) { T[id] = genTargetFor(G, month, id, role); counts[id] = genMonthCount(G, S, id, month, role); });
        var targeted = ids.filter(function (id) { return T[id] !== null; });
        var highs = targeted.slice().sort(function (a, b) { return (counts[b] - T[b]) - (counts[a] - T[a]); });
        var lows = targeted.slice().sort(function (a, b) { return (counts[a] - T[a]) - (counts[b] - T[b]); });
        if (highs.length < 2) continue;
        for (var h = 0; h < highs.length && !moved; h++) {
          var H = highs[h];
          if (!lows.some(function (L) { return L !== H && genDevCost(G, counts[H] - 1 - T[H]) + genDevCost(G, counts[L] + 1 - T[L]) < genDevCost(G, counts[H] - T[H]) + genDevCost(G, counts[L] - T[L]); })) continue;
          var slots = Object.keys(S.placed).map(function (k) { return S.placed[k]; }).filter(function (p) { return p.id === H && p.role === role && p.unitKind === "day" && genMonthOf(p.day) === month; }).sort(function (a, b) { return a.day < b.day ? -1 : a.day > b.day ? 1 : 0; });
          for (var s = 0; s < slots.length && !moved; s++) {
            var slot = slots[s];
            // P2 review: H's offered bonus on this day is tapered against his count WITHOUT the day (extra -1), so a
            // day he holds over his share can move to a colleague below his (the untapered -6 used to pin it).
            var oldSoft = genSoftSum(R.eligibility(ctx, slot.day, slot.role, H)) + genOfferTaper(G, S, H, [slot.day], slot.role, slot.day, -1);
            genUnset(G, S, slot.day, slot.role);
            for (var l = 0; l < lows.length; l++) {
              var L = lows[l];
              if (L === H) continue;
              var before = genDevCost(G, counts[H] - T[H]) + genDevCost(G, counts[L] - T[L]);
              var after = genDevCost(G, counts[H] - 1 - T[H]) + genDevCost(G, counts[L] + 1 - T[L]);
              if (after >= before) continue;
              var r = R.eligibility(ctx, slot.day, slot.role, L);
              if (!r.ok || genSoftSum(r) + genOfferTaper(G, S, L, [slot.day], slot.role, slot.day) - oldSoft > tol) continue;
              genSet(G, S, slot.day, slot.role, L);
              moved = true;
              break;
            }
            if (!moved) genSet(G, S, slot.day, slot.role, H);
          }
        }
      }
    }
    if (!moved) break;
  }
}

// After repair/smoothing: a weekend unit whose holders no longer match the
// chosen pattern is flagged fallback (its shape was changed by a repair move).
function genRefreshWeekendDiag(G, S) {
  var W = G.ctx.schedule;
  G.units.weekends.forEach(function (unit) {
    var diag = S.weekendDiag[unit.key];
    if (!diag) return;
    GEN_ROLES.forEach(function (role) {
      var rd = diag.roles[role];
      if (!rd) return;
      var now = genMembersOf(W, unit, role);
      var changed = ["fri", "sat", "sun"].some(function (k) { return (rd.members[k] || null) !== (now[k] || null); });
      if (changed) { rd.repaired = true; rd.members = now; rd.fallback = true; }
      rd.styleMismatch = genStyleMismatch(G, unit, role, now);
      if (rd.styleMismatch.length) rd.fallback = true;
      rd.openDays = unit.present.filter(function (d) { return genSlotOpen(W[d], role); });
    });
  });
}

/* ----------------------------------------------------------- evaluate */

// A roster entry of type "external" (outside surgeon / internal locum, Prompt 12 M) is never in the pool.
// rules.buildContext keeps him out of ctx.activeIds altogether (every candidate loop here runs over
// activeIds), so this test only guards the pool filter and the fixed-slot reading in genSeedLocks.
function genIsExternal(ctx, id) { var r = id && ctx.rosterById && ctx.rosterById[id]; return !!(r && r.type === "external"); }
// Prompt 13 / P13R: row sources written by a surgeon acting for himself, without a
// lock flag - fixed for the generator in both modes (see the header). Data,
// exported; test/open-shifts.test.js pins it against the SQL that writes each source.
var GEN_PERSON_FIXED_SOURCES = ["claim", "trade"];
function genHeldByPerson(e) { return !!(e && typeof e.source === "string" && GEN_PERSON_FIXED_SOURCES.indexOf(e.source) >= 0); }
// The equal-share pool (J): active, poolMember !== false, no availability windows, not external.
function genPoolIds(G) {
  return G.ctx.activeIds.filter(function (id) { var P = G.ctx.per[id]; return P.rules.poolMember !== false && !P.hasWindows && !genIsExternal(G.ctx, id); });
}
function genSpread(values) {
  if (!values.length) return 0;
  var mn = Infinity, mx = -Infinity;
  values.forEach(function (v) { if (v < mn) mn = v; if (v > mx) mx = v; });
  return mx - mn;
}

function genEvaluate(G, S) {
  var ctx = G.ctx, R = G.R, W = ctx.schedule;
  var hardViolations = [], softList = [], softSum = 0, open = [];
  G.days.forEach(function (d) {
    var e = W[d];
    GEN_ROLES.forEach(function (role) {
      if (genSlotOpen(e, role)) { open.push({ day: d, role: role }); return; }
      if (e[role + "Locked"] || !e[role]) return;
      var id = e[role];
      var r = R.eligibility(ctx, d, role, id, { asBlockMember: genHoldsFullBlock(W, d, role, id) });
      if (!r.ok) hardViolations.push({ day: d, role: role, id: id, reasons: r.hard.slice() });
      for (var k = 0; k < r.soft.length; k++) if (r.soft[k].weight) { softList.push({ day: d, role: role, id: id, reason: r.soft[k].reason, weight: r.soft[k].weight }); softSum += r.soft[k].weight; }
    });
  });
  softList = genTaperSoftList(G, softList); // P2 review: the offered bonus stops at the share (no-op without a period)
  softSum = 0; softList.forEach(function (s) { softSum += s.weight; });
  S.patternPenalties.forEach(function (p) { softList.push(p); softSum += p.weight; });
  // J: one deviation per role (primary first in the lexicographic score); WF: the convex sum
  var primaryDeviation = 0, backupDeviation = 0;
  G.months.forEach(function (month) {
    var T = G.targets.byMonth[month];
    Object.keys(T).forEach(function (id) {
      if (T[id].primary !== null) primaryDeviation += genDevCost(G, genMonthCount(G, S, id, month, "primary") - T[id].primary);
      if (T[id].backup !== null) backupDeviation += genDevCost(G, genMonthCount(G, S, id, month, "backup") - T[id].backup);
    });
  });
  var pool = genPoolIds(G), wk = {}, hol = {};
  pool.forEach(function (id) { wk[id] = 0; hol[id] = {}; });
  G.days.forEach(function (d) {
    var e = W[d], fri = genFridayOf(d), u = ctx.holidayByDay[d];
    GEN_ROLES.forEach(function (role) {
      var id = e[role];
      if (!id || !(id in wk)) return;
      if (fri) wk[id]++;
      if (u && u.tier === "major") hol[id][u.name + ":" + u.days[0]] = true;
    });
  });
  var weekendSpread = genSpread(pool.map(function (id) { return wk[id]; }));
  var holidaySpread = genSpread(pool.filter(function (id) { return !ctx.per[id].holidaysOff.size; }).map(function (id) { return Object.keys(hol[id]).length; }));
  var score = scoreCandidate({
    uncoveredPrimary: open.filter(function (o) { return o.role === "primary"; }).length,
    uncoveredBackup: open.filter(function (o) { return o.role === "backup"; }).length,
    hardViolations: hardViolations.length, softSum: Math.round(softSum * 1000) / 1000,
    primaryDeviation: Math.round(primaryDeviation * 10) / 10, backupDeviation: Math.round(backupDeviation * 10) / 10,
    weekendSpread: weekendSpread, holidaySpread: holidaySpread
  });
  return { score: score, hardViolations: hardViolations, softList: softList, open: open };
}

/* ------------------------------------------------------- one candidate */

function genRunCandidate(G, rng) {
  var W = {};
  Object.keys(G.base).forEach(function (k) { W[k] = G.base[k]; });
  G.days.forEach(function (d) { W[d] = Object.assign({}, G.base[d]); });
  G.ctx.schedule = W;
  var S = { placed: {}, weekendDiag: {}, holidayDiag: {}, patternPenalties: [], warnings: [] };
  genInitCounts(G, S);
  GEN_ROLES.forEach(function (role) {
    var order = genOrder(G, role, rng);
    for (var i = 0; i < order.length; i++) genFillUnit(G, S, order[i], role, rng);
  });
  genRepair(G, S, rng);
  genSmooth(G, S);
  genRefreshWeekendDiag(G, S);
  var ev = genEvaluate(G, S);
  return { W: W, S: S, ev: ev };
}

/* ---------------------------------------------------------- diagnostics */

// Range tallies (talliesFor semantics over `days`): the counts are range-scoped;
// the run measures are the longest runs TOUCHING the range, each followed
// across the range edges through rules.runThrough (a run that starts in the
// locked import before the range reads its full length - review 9/22, item A).
// maxConsecutive = the run the HARD limit counts (primary-only unless
// countBackupInConsecutive), maxConsecutiveAnyRole = primary or backup. Real
// days; holiday-unit days collapse to one only for a surgeon who opted in
// (Prompt 12 A, 9/22).
function genRunStats(G, id, days) {
  var ctx = G.ctx, R = G.R, W = ctx.schedule;
  var t = { primary: 0, backup: 0, total: 0, weekendDays: 0, majorHolidays: 0, minorHolidays: 0, maxConsecutive: 0, maxConsecutiveAnyRole: 0 };
  var units = {}, prevIn = false, prevAny = false, countBackup = !!ctx.countBackupInConsecutive;
  for (var i = 0; i < days.length; i++) {
    var d = days[i], e = W[d];
    var isP = !!(e && e.primary === id), isB = !!(e && e.backup === id);
    if (isP) t.primary++;
    if (isB) t.backup++;
    if (isP || isB) {
      t.total++;
      if (genFridayOf(d)) t.weekendDays++;
      var u = ctx.holidayByDay[d];
      if (u) { var uk = u.name + ":" + u.days[0]; if (!units[uk]) { units[uk] = true; if (u.tier === "major") t.majorHolidays++; else t.minorHolidays++; } }
    }
    var inRun = isP || (countBackup && isB), anyRun = isP || isB;
    if (inRun && !prevIn) { var n = R.runThrough(ctx, id, d, false); if (n > t.maxConsecutive) t.maxConsecutive = n; }
    if (anyRun && !prevAny) { var na = R.runThrough(ctx, id, d, true); if (na > t.maxConsecutiveAnyRole) t.maxConsecutiveAnyRole = na; }
    prevIn = inRun; prevAny = anyRun;
  }
  return t;
}

function genUncoveredReasons(G, open) {
  var ctx = G.ctx, R = G.R, ids = ctx.activeIds;
  return open.map(function (o) {
    var reasons = {}, hol = G.units.holidayDaySet[o.day];
    // M (review 9/22): a unit broken by a hand-written outside surgeon is filled day by day, so its
    // open slot is explained day by day too (a unit-level reason would read 'slot-locked:x1@<his day>').
    var brokenUnit = !!hol && hol.inRange.some(function (d) { return genIsExternal(ctx, ctx.schedule[d][o.role]); });
    ids.forEach(function (id) {
      if (hol && !brokenUnit) {
        // unit-level: the first unit day the surgeon cannot take (assuming the others)
        var found = null;
        for (var k = 0; k < hol.inRange.length && !found; k++) {
          var d = hol.inRange[k];
          var r = R.eligibility(ctx, d, o.role, id, { assume: hol.inRange.filter(function (x) { return x !== d; }).map(function (x) { return { date: x, role: o.role }; }) });
          if (!r.ok) found = r.hard.map(function (h) { return h + "@" + d; });
        }
        reasons[id] = found || ["holiday-unit:eligible-but-unit-not-filled"];
        return;
      }
      var solo = R.eligibility(ctx, o.day, o.role, id);
      reasons[id] = solo.ok ? ["eligible-but-not-placed"] : solo.hard.slice();
    });
    // Prompt 14 P2: inside a period, who offered this slot, and the one-line reading for the board:
    // "no offer and no rule allows it" when nobody did, else the offering surgeons with their first reason.
    var offered = [], note = null;
    if (ctx.periodOfDay && ctx.periodOfDay[o.day] !== undefined && typeof R.offeredOn === "function") {
      ids.forEach(function (id) { if (R.offeredOn(ctx, o.day, o.role, id)) offered.push(id); });
      note = offered.length
        ? "offered by " + offered.map(function (id) { return (ctx.rosterById[id] && ctx.rosterById[id].name) || id; }).join(", ") + " but blocked: " + offered.map(function (id) { return (reasons[id] || [])[0] || "-"; }).join("; ")
        : "no offer and no rule allows it";
    }
    return { day: o.day, role: o.role, weekday: genWeekday(o.day), holidayUnit: hol ? hol.name : null, reasons: reasons, offered: offered, note: note };
  });
}

// Prompt 14 P2: diagnostics.offers over the FINAL schedule (ctx.schedule = best.W).
//   periods       the periods touching the range
//   byPerson[id]  status / mode from the first period touching the range (byPeriod
//                 carries every touching period), offered = his offered days inside
//                 the range and a period where he is submitted ('either' counts
//                 once), placed = those where he holds an offered role (locked or
//                 generated), unplaced = the rest with the slot's reason: his first
//                 hard reason on the final schedule, or held-by:<id> when the slot
//                 went to someone else, or eligible-but-not-placed (a generator bug,
//                 reported like an open slot). role 'either' reads "primary: ..;
//                 backup: ..".
//   outsideOffers every GENERATED (not locked / fixed) slot held by a submitted
//                 surgeon inside a period on a day/role he did not offer
//                 (preferred mode only, by construction) - the Generate preview
//                 lists it ("Placed outside painted days"); the publish e-mail's
//                 off-list line that is to read it is still open (build guide
//                 section 17), and once published My schedule tags each such day
//                 'not offered'. A REPORT, not the score: it lists every such
//                 placement whether painting fix B waived its outside-offers term
//                 (below his share) or not, and in any month of the period.
// Empty ({ periods: [], byPerson: {}, outsideOffers: [] }) when no period touches
// the range - present always, never absent.
function genOffersDiag(G, warnings) {
  var ctx = G.ctx, R = G.R, W = ctx.schedule, ids = ctx.activeIds;
  var out = { periods: [], byPerson: {}, outsideOffers: [] };
  if (!(ctx.periods && ctx.periods.length && typeof R.offerState === "function")) return out;
  var touching = ctx.periods.filter(function (p) { return p.start <= G.end && p.end >= G.start; });
  if (!touching.length) return out;
  out.periods = touching.map(function (p) { return { key: p.key, id: p.id, label: p.label, start: p.start, end: p.end, status: p.status, closeAt: p.closeAt, publishBy: p.publishBy }; });
  var nameOf = function (id) { return (ctx.rosterById[id] && ctx.rosterById[id].name) || id; };
  var unplacedTotal = {};
  ids.forEach(function (id) {
    var P = ctx.per[id], first = touching[0];
    var row = { status: P.offerStatus[first.key], mode: P.offerMode[first.key], offered: 0, placed: 0, unplaced: [], byPeriod: {} };
    touching.forEach(function (p) { row.byPeriod[p.key] = { status: P.offerStatus[p.key], mode: P.offerMode[p.key] }; });
    G.days.forEach(function (d) {
      var st = R.offerState(ctx, d, id);
      if (!st || st.status !== "submitted" || !st.roles.length) return;
      row.offered++;
      var e = W[d], hol = G.units.holidayDaySet[d] || null;
      var held = st.roles.filter(function (role) { return e && e[role] === id; });
      if (held.length) { row.placed++; return; }
      var why = st.roles.map(function (role) {
        // Review 9/23: on a holiday-unit day the CAUSE is the unit - one holder for every in-range unit day - so the
        // first other unit day he fails in that role is the reason ("holiday-unit:<name> <day> <reason>"), evaluated
        // as the unit builder does (the other unit days assumed his); the final-schedule slot fact (held-by, a cap he
        // reached elsewhere) is only a consequence and is reported when every unit day passes.
        var reason = null;
        if (hol) {
          for (var k = 0; k < hol.inRange.length && !reason; k++) {
            var d2 = hol.inRange[k];
            if (d2 === d) continue;
            var r2 = R.eligibility(ctx, d2, role, id, { assume: hol.inRange.filter(function (x) { return x !== d2; }).map(function (x) { return { date: x, role: role }; }) });
            if (!r2.ok) reason = "holiday-unit:" + hol.name + " " + d2 + " " + r2.hard[0];
          }
        }
        if (!reason) {
          var r = R.eligibility(ctx, d, role, id, { asBlockMember: genHoldsFullBlock(W, d, role, id) });
          reason = !r.ok ? r.hard[0] : (e && e[role]) ? "held-by:" + e[role] : (role === "primary" && e && e.externalCover) ? "external-cover" : "eligible-but-not-placed";
          if (reason === "eligible-but-not-placed") warnings.push("offered slot " + d + " " + role + " is open although " + nameOf(id) + " offered it and is eligible - generator bug, report it");
        }
        return st.roles.length > 1 ? role + ": " + reason : reason;
      });
      row.unplaced.push({ day: d, role: st.roles.length > 1 ? "either" : st.roles[0], reason: why.join("; "), holidayUnit: hol ? hol.name : null });
    });
    if (row.unplaced.length) unplacedTotal[id] = row.unplaced.length;
    out.byPerson[id] = row;
  });
  G.days.forEach(function (d) {
    var e = W[d];
    GEN_ROLES.forEach(function (role) {
      var id = e && e[role];
      if (!id || !ctx.per[id] || e[role + "Locked"] || (G.fixed && G.fixed[d] && G.fixed[d][role])) return;
      var st = R.offerState(ctx, d, id);
      if (st && st.status === "submitted" && st.roles.indexOf(role) < 0) out.outsideOffers.push({ day: d, role: role, id: id });
    });
  });
  Object.keys(unplacedTotal).forEach(function (id) { warnings.push(nameOf(id) + ": " + unplacedTotal[id] + " offered day(s) not placed - see diagnostics.offers.byPerson"); });
  if (out.outsideOffers.length) warnings.push(out.outsideOffers.length + " placement(s) on a day the surgeon did not offer (preferred mode) - see diagnostics.offers.outsideOffers");
  return out;
}

function genDiagnostics(G, best, meta) {
  var ctx = G.ctx, R = G.R, W = ctx.schedule, ids = ctx.activeIds;
  var ev = best.ev, S = best.S;
  // ctx.warnings (e.g. an ignored legacy blob key) ride along so the Generate panel and
  // preview-generate.js show them - console.warn alone is invisible to the scheduler (review 9/22).
  var warnings = G.warnings.concat(S.warnings, ctx.warnings || []);
  var uncovered = genUncoveredReasons(G, ev.open);
  uncovered.forEach(function (u) {
    Object.keys(u.reasons).forEach(function (id) { if (u.reasons[id][0] === "eligible-but-not-placed") warnings.push("open slot " + u.day + " " + u.role + " is fillable by " + id + " - generator bug, report it"); });
  });
  // Locks that break a rule (reported, never changed). T: a fixed slot that is
  // not a lock (fill-open-only) is reported apart, in fixedViolations.
  var lockViolations = [], fixedViolations = [];
  G.days.forEach(function (d) {
    var e = W[d];
    GEN_ROLES.forEach(function (role) {
      if (!e[role + "Locked"] || !e[role]) return;
      var r = R.eligibility(ctx, d, role, e[role], { asBlockMember: genHoldsFullBlock(W, d, role, e[role]) });
      var conflicts = r.conflicts || (r.ok ? [] : r.hard);
      if (!conflicts.length) return;
      var src = G.lockSrc[d][role] || "";
      if (src.indexOf("fixed") === 0) fixedViolations.push({ day: d, role: role, id: e[role], source: e.source, reasons: conflicts.slice() });
      else lockViolations.push({ day: d, role: role, id: e[role], lock: src, reasons: conflicts.slice() });
    });
  });
  if (fixedViolations.length) warnings.push(fixedViolations.length + " held, unlocked slot(s) kept by fill-open-only break a rule - kept as facts, see fixedViolations");
  // Tallies: per month (full calendar month, running-tally semantics) plus in-range totals.
  var tallies = {};
  ids.forEach(function (id) {
    var P = ctx.per[id], months = {};
    // K: the East PRIMARY-week days a countsEastDays cap adds to the primary count (0 for
    // everyone else) - the preview flags a row when primary + eastP is over the cap, which
    // is the engine's count; a backup day on one of those days is not counted twice.
    var eastPIn = function (list) { return P.countsEastDays ? list.filter(function (d) { return P.eastPrimaryDays.has(d); }).length : 0; };
    // J: target = { primary, backup } per month (null where the surgeon has none for the role);
    // the range row carries the per-role sums (null when no month has one).
    // Prompt 32 step 2 (DESIGN "Generator" 7): the weighted view rides BESIDE .target (which stays exactly
    // { primary, backup }): weighted = P x wP + B x wB (Silvis days only), weightedShare = impliedTargets'
    // member weightedShare (null without a target); the range row sums the monthly weighted shares.
    var sumP = null, sumB = null, sumW = null, sw = G.shiftWeights;
    G.months.forEach(function (month) {
      var t = R.talliesFor(ctx, id, month);
      t.cap = R.monthlyCapFor(ctx, id).primary; // K: the cap is on PRIMARY days (preview column "Cap (P)")
      t.eastP = eastPIn(genMonthDays(month));
      t.target = { primary: genTargetFor(G, month, id, "primary"), backup: genTargetFor(G, month, id, "backup") };
      if (t.target.primary !== null) sumP = (sumP || 0) + t.target.primary;
      if (t.target.backup !== null) sumB = (sumB || 0) + t.target.backup;
      var im = G.targets.implied.months[month] && G.targets.implied.months[month].members[id];
      t.weighted = genRound1(sw.primary * t.primary + sw.backup * t.backup);
      t.weightedShare = im ? im.weightedShare : null;
      if (typeof t.weightedShare === "number") sumW = (sumW || 0) + t.weightedShare;
      months[month] = t;
    });
    var range = genRunStats(G, id, G.days);
    range.cap = R.monthlyCapFor(ctx, id).primary;
    range.eastP = eastPIn(G.days);
    range.target = { primary: sumP === null ? null : genRound1(sumP), backup: sumB === null ? null : genRound1(sumB) };
    range.weighted = genRound1(sw.primary * range.primary + sw.backup * range.backup);
    range.weightedShare = sumW === null ? null : genRound1(sumW);
    tallies[id] = { code: ctx.rosterById[id].code, name: ctx.rosterById[id].name, months: months, range: range };
  });
  // East feed snapshot / forecast / unknown days.
  var snapshot = { coverage: ctx.eastCoverage ? { from: ctx.eastCoverage.from, to: ctx.eastCoverage.to } : null, busyDaysInRange: {}, forecastDaysInRange: {}, derivedDaysInRange: {}, forecastThreshold: ctx.forecastThreshold };
  var eastForecast = [], eastUnknownDays = [], eastStandingDays = {};
  ids.forEach(function (id) {
    var P = ctx.per[id];
    if (!P.eastEnabled) return;
    // Prompt 12 V: the standing East days of the range (every year) - known days, never "unknown".
    var standingList = genRulesApi().standingEastDays(ctx, id, G.start, G.end), standingSet = new Set(standingList);
    if (P.eastStandingList && P.eastStandingList.length) eastStandingDays[id] = standingList;
    var busy = 0, fc = 0, derived = 0;
    G.days.forEach(function (d) {
      var e = W[d];
      var role = e.primary === id ? "primary" : e.backup === id ? "backup" : null;
      if (P.eastBusy.has(d)) busy++;
      if (P.derived[d]) derived++;
      var prob = P.eastForecast ? P.eastForecast[d] : undefined;
      if (typeof prob === "number") {
        fc++;
        if (prob >= 0.2) eastForecast.push({ id: id, day: d, weekday: genWeekday(d), probability: prob, busyByThreshold: prob >= ctx.forecastThreshold, assigned: role });
      }
      if (role && !P.eastBusy.has(d) && !standingSet.has(d) && typeof prob !== "number") {
        var covered = ctx.eastCoverage && d >= ctx.eastCoverage.from && d <= ctx.eastCoverage.to;
        var blocks = role === "primary" ? P.blocksPrimary : P.blocksBackup;
        if (!covered && blocks) eastUnknownDays.push({ id: id, day: d, role: role });
      }
    });
    snapshot.busyDaysInRange[id] = busy; snapshot.forecastDaysInRange[id] = fc; snapshot.derivedDaysInRange[id] = derived;
    if (P.countsEastDays) {
      G.months.forEach(function (month) {
        var cov = ctx.eastCoverage && genMonthDays(month).every(function (d) { return d >= ctx.eastCoverage.from && d <= ctx.eastCoverage.to; });
        if (!cov) warnings.push(id + " cap counts East days but the East feed does not cover all of " + month + ": only his Silvis primaries and the derived East primary-week days were counted for that month");
      });
    }
  });
  if (lockViolations.length) warnings.push(lockViolations.length + " locked slot(s) break a rule - kept as facts, see lockViolations");
  // Prompt 12 N (9/22 evening): window weeks of every windows surgeon that overlap the range. primaries /
  // backups count her days over the whole Mon-Sun week (published days outside the range included, as
  // eligibility counts them); status: partial = some window days lie outside the range, else met / under /
  // over against daysPerWindowWeek.target (no-target when the surgeon has windows but no target). A warning
  // per fully-in-range week off target - a diagnostics warning, never a violation and never repaired.
  var windowWeeks = [];
  Object.keys(G.windowWeeks).sort().forEach(function (id) {
    var weeks = G.windowWeeks[id], P = ctx.per[id], name = ctx.rosterById[id].name;
    Object.keys(weeks).sort().forEach(function (mon) {
      var wdays = weeks[mon];
      var inRange = wdays.filter(function (d) { return d >= G.start && d <= G.end; });
      if (!inRange.length) return;
      var primaries = 0, backups = 0;
      for (var k = 0; k < 7; k++) { var we = W[genAddDays(mon, k)]; if (!we) continue; if (we.primary === id) primaries++; if (we.backup === id) backups++; }
      var partial = inRange.length < wdays.length, target = P.windowTarget;
      var status = partial ? "partial" : target === null ? "no-target" : primaries === target ? "met" : primaries < target ? "under" : "over";
      windowWeeks.push({ monday: mon, surgeonId: id, windowDays: wdays.slice(), inRangeWindowDays: inRange, primaries: primaries, backups: backups, target: target, status: status });
      if (!partial && target !== null && primaries !== target) warnings.push("window week " + mon + ": " + name + " has " + primaries + " primary day(s) (target " + target + ")");
    });
  });
  // Handoff diagnostic (surgeonRules.<id>.handoffPartnerRequired): every in-range primary of such a surgeon
  // whose next day is the same surgeon or an open primary. The next day is read from the working schedule
  // (published days beyond the range count; a day beyond the range with no entry is unknown and skipped).
  var handoffGaps = [];
  ids.forEach(function (id) {
    if (!ctx.per[id].handoffPartnerRequired) return;
    var name = ctx.rosterById[id].name;
    G.days.forEach(function (d) {
      var e = W[d];
      if (!e || e.primary !== id) return;
      var next = genAddDays(d, 1), en = W[next];
      if (!en) return;
      var problem = en.primary === id ? "same-surgeon" : (!en.primary && !en.externalCover) ? "open" : null;
      if (!problem) return;
      handoffGaps.push({ day: d, next: next, surgeonId: id, problem: problem });
      warnings.push("handoff " + d + ": " + name + " primary hands off to " + (problem === "open" ? "an open primary" : "the same surgeon") + " on " + next);
    });
  });
  var holidayUnitsOut = G.units.holidays.map(function (u) {
    var d = S.holidayDiag[u.key] || genHolidayDiag(S, u);
    var out = Object.assign({}, d);
    if (u.inRange.length) {
      var e = W[u.inRange[0]];
      out.primary = e.primary || (e.externalCover ? "external:" + e.externalCover : null);
      out.backup = e.backup || null;
    }
    out.uncovered = u.inRange.some(function (x) { return genSlotOpen(W[x], "primary") || genSlotOpen(W[x], "backup"); });
    return out;
  });
  var weekendUnitsOut = G.units.weekends.map(function (u) {
    var d = S.weekendDiag[u.key] || genWeekendDiag(S, u);
    var p = d.roles.primary || { kind: "unfilled", members: genMembersOf(W, u, "primary"), fallback: true, styleMismatch: [] };
    var b = d.roles.backup || { kind: "unfilled", members: genMembersOf(W, u, "backup"), fallback: true, styleMismatch: [] };
    return { friday: d.friday, present: d.present, preempted: d.preempted, reduced: d.reduced, kind: p.kind, members: p.members, fallback: !!(p.fallback || b.fallback), roles: { primary: p, backup: b } };
  });
  var softByReason = {};
  ev.softList.forEach(function (s) { softByReason[s.reason] = (softByReason[s.reason] || 0) + s.weight; });
  var offersDiag = genOffersDiag(G, warnings); // Prompt 14 P2 (adds its own warnings)
  return {
    seed: meta.seed, bestOf: meta.bestOf, candidatesTried: meta.tried, candidateScores: meta.scores.slice(), truncated: meta.truncated,
    range: { start: G.start, end: G.end, days: G.days.length, months: G.months.slice() },
    score: ev.score,
    tallies: tallies,
    uncovered: uncovered,
    softPenalties: ev.softList.slice(),
    softByReason: softByReason,
    hardViolations: ev.hardViolations.slice(),
    lockViolations: lockViolations,
    // T (9/22): the run mode, the fixed-slot count, the conflicts of fixed unlocked slots, and the derived-week yield report
    mode: G.fillOpenOnly ? "fill-open-only" : "generate",
    fixedSlots: G.fixedCount,
    fixedViolations: fixedViolations,
    derivedYields: G.derivedYields.slice(),
    derivedConfirmed: G.derivedConfirmed.slice(),
    holidayUnits: holidayUnitsOut,
    weekendUnits: weekendUnitsOut,
    impliedTargets: G.targets.implied,
    targets: G.targets.byMonth,     // J: { month: { id: { primary, backup } } }
    scoreTargets: G.targets.byMonth, // the unit scoring uses the same per-role table (no neutral terms since J)
    forcedSlots: G.forced,
    windowWeeks: windowWeeks,
    handoffGaps: handoffGaps,
    eastFeedSnapshot: snapshot,
    eastForecast: eastForecast,
    eastUnknownDays: eastUnknownDays,
    eastStandingDays: eastStandingDays, // V: { [id]: ['YYYY-MM-DD', ...] } - standing East days inside the range
    // Prompt 12 C.4 (9/22): the East conflict report over the FINAL schedule of the
    // range (ctx.schedule is best.W here) - empty for generated slots by construction,
    // a locked / fixed slot may collide (Khan primary locked on an East day, someone
    // else in Fierce's derived slot). rules.eastConflicts is read-only.
    eastConflicts: typeof R.eastConflicts === "function" ? R.eastConflicts(ctx, G.days) : [],
    // Prompt 15 part 2 (9/23): the derived East vacations inside the range, per surgeon -
    // the ranges touching it with their review state, the derived vacation days (unreviewed /
    // away: treated like time off), the 'home' days (eastClear: pattern lifted + primary
    // bonus) and the feed-busy days inside a home range (the feed won; buildContext warned) -
    // plus the conflict report over the FINAL schedule (a held slot inside an unreviewed /
    // away range, or the primary the day before one): generated slots never appear there,
    // locked / fixed ones may. Diagnostics only; rules.js owns the rule.
    eastVacations: genEastVacations(G, ctx),
    offers: offersDiag, // Prompt 14 P2: { periods, byPerson, outsideOffers }
    // Prompt 32 step 2 (DESIGN "Generator" 9): the primary days over the holder's soft limit (genOverSoftLimit - since the 10/12
    // review fix every such day of the months the range touches, for a holder this run gave an in-range primary that month)
    overSoftLimit: genOverSoftLimit(G, W),
    placedCount: Object.keys(S.placed).length,
    warnings: warnings
  };
}

// diagnostics.overSoftLimit (Prompt 32 step 2, DESIGN "Generator" 9; Faraz 10/11 decision 5): every primary day that is the
// (L+1)th or later primary of its holder's calendar month in date order - every day of the month counts toward the ordinal
// (locked, published and out-of-range days included) - L = his SOFT limit (ctx.per[id].capPreferred; a surgeon without one,
// a hard cap only or no limit, is never listed). Derived from the final schedule, never stored: plain
// [{ day, id, month, count, limit }] in date order (structured-clone safe). Prompt 32 step 4: read through the ONE helper,
// rules.js overSoftLimitDays (the calendar badge, the Publish dialog and the Accept audit row read the same), which also
// leaves out a day over the holder's hard cap (a hard-cap breach keeps its own wording) and an outside surgeon, and counts
// a countsEastDays cap's East primary-week days first; the tie-break that picks who takes such a day is genSoftLimitTie.
// Prompt 32 review fix (10/12): the days of the WHOLE calendar months the range touches - a range ending mid-month pushes
// the later held days of its holders past the limit, and the calendar badge and the Publish dialog name those too - kept
// only for a (holder, month) this run GAVE an in-range primary (the output's primary differs from the caller's input on an
// in-range day of that month): the trim helpers.overSoftLimitForChanges applies to the Publish dialog's list, so the preview
// box, the Accept audit row and the Publish dialog name the same days. A month over the limit by held days alone is not this
// run's doing and is not listed (the calendar badge and Totals still show it).
function genOverSoftLimit(G, W) {
  var input = G.input || {}, gave = Object.create(null);
  G.days.forEach(function (d) {
    var e = W[d], o = input[d];
    var to = e && e.primary ? e.primary : null, from = o && o.primary ? o.primary : null;
    if (to && to !== from) gave[to + "|" + genMonthOf(d)] = true;
  });
  var lastMonth = genMonthDays(G.months[G.months.length - 1]);
  return G.R.overSoftLimitDays(G.ctx, W, G.months[0] + "-01", lastMonth[lastMonth.length - 1]).filter(function (x) { return gave[x.id + "|" + x.month] === true; });
}

// diagnostics.eastVacations (Prompt 15 part 2): { [id]: { ranges, vacationDays, clearDays, feedBusyOnHome, conflicts } }
// restricted to the range (a range is listed when any of its days is inside; the day lists are
// clipped), one entry per surgeon with any East vacation data; {} when none.
function genEastVacations(G, ctx) {
  var out = {};
  var ev = ctx.eastVacations || {};
  var inRange = function (d) { return d >= G.start && d <= G.end; };
  var conflicts = typeof G.R.eastVacationConflicts === "function" ? G.R.eastVacationConflicts(ctx, ctx.schedule).filter(function (c) { return inRange(c.day); }) : [];
  Object.keys(ev).forEach(function (id) {
    var v = ev[id];
    var ranges = (v.ranges || []).filter(function (r) { return r.end >= G.start && r.start <= G.end; });
    var vac = (v.vacationDays || []).filter(inRange), clear = (v.clearDays || []).filter(inRange), busy = (v.feedBusyOnHome || []).filter(inRange);
    var mine = conflicts.filter(function (c) { return c.surgeonId === id; });
    if (!ranges.length && !vac.length && !clear.length && !busy.length && !mine.length) return;
    out[id] = { ranges: ranges, vacationDays: vac, clearDays: clear, feedBusyOnHome: busy, conflicts: mine };
  });
  return out;
}

function genSnapshot(G, W) {
  var out = {};
  G.days.forEach(function (d) {
    var e = W[d];
    // T: a fixed slot goes out with the input's own lock flag (an unlocked hand-written slot stays unlocked)
    var f = G.fixed && G.fixed[d], o = G.outLock && G.outLock[d];
    out[d] = { primary: e.primary || null, backup: e.backup || null, primaryLocked: f && f.primary ? !!o.primary : !!e.primaryLocked, backupLocked: f && f.backup ? !!o.backup : !!e.backupLocked, source: e.source, externalCover: e.externalCover || null, note: e.note === undefined ? null : e.note };
  });
  return out;
}

/* ------------------------------------------------------------ generate */

function generate(ctx, startDate, endDate, opts) {
  opts = opts || {};
  var R = genRulesApi();
  if (!ctx || !ctx.per || !ctx.schedule) throw new Error("generator.js: ctx must come from rules.buildContext()");
  genAssertDate(startDate, "startDate"); genAssertDate(endDate, "endDate");
  if (endDate < startDate) throw new Error("generator.js: endDate " + endDate + " is before startDate " + startDate);
  var seed = opts.seed === undefined || opts.seed === null ? 1 : opts.seed;
  var bestOf = Math.max(1, Math.floor(Number(opts.bestOf) || 200));
  var W = ctx.weights || R.defaultWeights();
  var original = ctx.schedule;
  var originalHeld = ctx.heldSchedule; // review 2 (10/1): the caller's standing snapshot - narrowed for the run, restored below
  var days = genDaysList(startDate, endDate);
  var months = [];
  days.forEach(function (d) { var m = genMonthOf(d); if (months.indexOf(m) < 0) months.push(m); });
  var G = {
    ctx: ctx, R: R, W: W, start: startDate, end: endDate, days: days, months: months,
    input: original, // Prompt 32 review fix (10/12): the caller's schedule - genOverSoftLimit's "the run gave him a primary" reads it
    respectLocks: opts.respectLocks !== false, jitter: typeof W.jitter === "number" ? W.jitter : 1, warnings: [],
    // WF 9/23: the exponent of the deviation term (data: groupRules.weights.deviationConvexity; 1 = the old flat term)
    convexity: typeof W.deviationConvexity === "number" && isFinite(W.deviationConvexity) && W.deviationConvexity >= 1 ? W.deviationConvexity : GEN_DEVIATION_CONVEXITY,
    // Prompt 32 step 2: the shift weights of the weighted backup fill and the weighted view (data:
    // groupRules.shiftAccounting.weights through rules.shiftWeightsOf, the ONE reader - primary 1 / backup 0.5
    // when null / absent / unreadable; never groupRules.weights, the soft-penalty table)
    shiftWeights: R.shiftWeightsOf(ctx.groupRules),
    fillOpenOnly: opts.fillOpenOnly === true, // T: fill only the open slots, every held slot is fixed
    unitKeyOf: {}, unitKindOf: {},
    // N: window weeks per windows surgeon (her monthly primary target = target x these weeks; J counts per role,
    // so her backups simply have no target to count against)
    windowWeeks: genWindowWeeks(ctx)
  };
  // review fix 9/23: a knob that is present but rejected (non-numeric, NaN, below 1) is named in the warnings
  // instead of falling back silently; impliedTargets.convexity shows the value in force either way
  if (W.deviationConvexity !== undefined && W.deviationConvexity !== null && G.convexity !== W.deviationConvexity) G.warnings.push("weights.deviationConvexity " + JSON.stringify(W.deviationConvexity) + " ignored: needs a finite number >= 1; using " + GEN_DEVIATION_CONVEXITY);
  try {
    G.base = genSeedLocks(G, original);
    ctx.schedule = G.base;
    ctx.heldSchedule = genRunHeld(G, originalHeld);
    G.units = buildUnits(ctx, startDate, endDate);
    G.units.all.forEach(function (u) {
      var list = u.kind === "holiday" ? u.inRange : u.kind === "weekend" ? u.present : [u.day];
      list.forEach(function (d) { G.unitKeyOf[d] = u.key; G.unitKindOf[d] = u.kind; });
    });
    G.targets = genTargets(G);
    G.forced = genForcedSlots(G);
    G.offersLive = !!(ctx.periods && ctx.periods.length && typeof R.offeredOn === "function"); // Prompt 14 P2: a period touches the inputs -> offers terms and taper are live
    G.offeredUnit = genOfferedUnits(G); // Prompt 14 P2: the offers pass (ordering)
    var master = genPrng(seed);
    var best = null, scores = [], tried = 0, truncated = false;
    var budget = typeof opts.timeBudgetMs === "number" && opts.timeBudgetMs > 0 ? opts.timeBudgetMs : 0;
    var clock = typeof opts.now === "function" ? opts.now : function () { return Date.now(); };
    var t0 = budget ? clock() : 0;
    for (var i = 0; i < bestOf; i++) {
      if (budget && i > 0 && clock() - t0 > budget) { truncated = true; break; }
      var cand = genRunCandidate(G, genPrng(master.int(2147483647) + 1));
      tried++;
      scores.push(cand.ev.score.total);
      if (best === null || cand.ev.score.total < best.ev.score.total) best = cand;
      if (cand.ev.score.uncoveredPrimary === 0 && cand.ev.score.uncoveredBackup === 0 && cand.ev.score.softSum === 0) break;
    }
    ctx.schedule = best.W;
    var diagnostics = genDiagnostics(G, best, { seed: seed, bestOf: bestOf, tried: tried, scores: scores, truncated: truncated });
    var schedule = genSnapshot(G, best.W);
    return { schedule: schedule, diagnostics: diagnostics };
  } finally {
    ctx.schedule = original;
    ctx.heldSchedule = originalHeld;
  }
}

/* -------------------------------------------------------------- presets */

// rangePresets(lastPublishedDay, today?) -> [{ label, start, end, months }]
// start = the day after lastPublishedDay (today when null). 'Through end of
// year' ends on the Sunday on/after Dec 31 of the start year; the N-month
// presets end on the last day of the Nth calendar month (the start month is
// month 1), extended to the following Sunday when that day is a Fri or Sat.
function rangePresets(lastPublishedDay, today) {
  var start = lastPublishedDay ? genAddDays(lastPublishedDay, 1) : (today || genTodayStr());
  genAssertDate(start, "start");
  var y = +start.slice(0, 4), m = +start.slice(5, 7);
  var out = [{ label: "Through end of year", start: start, end: genSundayOnOrAfter(y + "-12-31"), months: null }];
  [3, 6, 9, 12].forEach(function (n) {
    var idx = m + n - 1, yy = y + Math.floor((idx - 1) / 12), mm = ((idx - 1) % 12) + 1;
    var end = yy + "-" + genPad2(mm) + "-" + genPad2(genDaysInMonth(yy, mm));
    var wd = genWeekday(end);
    if (wd === "Fri" || wd === "Sat") end = genSundayOnOrAfter(end);
    out.push({ label: n + " months", start: start, end: end, months: n });
  });
  return out;
}

if (typeof module !== "undefined") {
  module.exports = {
    generate: generate,
    GEN_PERSON_FIXED_SOURCES: GEN_PERSON_FIXED_SOURCES,
    rangePresets: rangePresets,
    buildUnits: buildUnits,
    scoreCandidate: scoreCandidate,
    genPrng: genPrng,
    GEN_SCORE_WEIGHTS: GEN_SCORE_WEIGHTS,
    GEN_DEVIATION_CONVEXITY: GEN_DEVIATION_CONVEXITY,
    genWaterFill: genWaterFill,
    genWeightedFill: genWeightedFill, // Prompt 32 step 2: the weighted backup fill
    genWeightedShares: genWeightedShares, // Prompt 32 step 2: per-role shares + the weighted cross-role balance (one month)
    genStyleMismatch: genStyleMismatch, // Prompt 23 review (10/1): test/rules.test.js pins it beside the unit choice and per-day eligibility
    genOfferTaper: genOfferTaper, // painting fix B review (10/18): test/painting.test.js (fillOrder) pins the fill's offered-days-first count on one placement
    genAddDays: genAddDays,
    genWeekday: genWeekday,
    genDaysList: genDaysList
  };
}
