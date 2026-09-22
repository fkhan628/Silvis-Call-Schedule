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
//   ctx comes from rules.buildContext(). rules.js reads ctx.schedule live on
//   every eligibility() call, so each candidate installs its own working copy
//   as ctx.schedule for the duration of the run and the original is restored
//   in a finally block. Only days inside [startDate, endDate] are ever written;
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
//                     none -> open. The target delta uses the per-role fairness
//                     target of genTargets (Prompt 12 J: equal primary and backup
//                     shares; no neutral term, no explicit-null branch).
//   4 backup pass     same with primary fixed, against the backup targets.
//   5 repair          open slots: unit retry (holidays), direct fill, then
//                     1-hop and 2-hop swaps of non-locked generator-placed
//                     day-unit slots, each move re-verified via eligibility().
//   6 smoothing       per role (primary, then backup): move a non-locked
//                     day-unit slot of that role from a surgeon above his
//                     monthly target for the role to one below while eligibility
//                     holds, the soft score does not worsen beyond
//                     weights.smoothingTolerance and the role's deviation
//                     strictly falls.
//   7 evaluate        final eligibility pass over every generator-placed slot
//                     (hard violations must be 0; counted anyway), soft list,
//                     open slots, primary deviation, backup deviation, spreads
//                     -> scoreCandidate().
// Best-of-N keeps the minimum total; early exit only when nothing is open and
// the soft sum is 0.
//
// Prompt 12 J (9/22) - equal-share fairness (rules doc section 6, guide section
// 15): every pool member carries TWO monthly targets, an equal share of the
// month's open primary slots (after the windows surgeon's reserved primaries)
// and, separately, of its open backup slots; counts, unit scoring, pending
// forced slots, smoothing and the score are all per role (genTargets,
// genMonthCount(role), genTargetDelta(role), genSmooth, genEvaluate).
// diagnostics.impliedTargets shows every share and, per member, the two targets
// and the "allowed by rules" slot counts so an availability shortfall is visible.
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

var GEN_DAY_MS = 86400000;
var GEN_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
var GEN_ROLES = ["primary", "backup"];
// Prompt 12 J: primary spread before backup spread (targetDeviation split per role, 9/22).
var GEN_SCORE_WEIGHTS = { uncoveredPrimary: 1e9, uncoveredBackup: 1e7, hardViolations: 1e6, softSum: 1e3, primaryDeviation: 300, backupDeviation: 100, weekendSpread: 10, holidaySpread: 1 };
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
      eastConflicts: eastConflicts
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
function genTodayStr() { var d = new Date(); return d.getFullYear() + "-" + genPad2(d.getMonth() + 1) + "-" + genPad2(d.getDate()); }

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
// Change in |count - target| for `role` when `extra` more days of that role in
// `month` go to `id` (0 when the surgeon carries no target for the role).
function genTargetDelta(G, S, id, month, extra, exceptDay, role) {
  var T = genTargetFor(G, month, id, role);
  if (T === null) return 0;
  var c = genMonthCount(G, S, id, month, role) + genPendingForced(G, S, id, month, exceptDay, role);
  return (Math.abs(c + extra - T) - Math.abs(c - T)) * G.W.low;
}
function genTargetDeltaForDays(G, S, id, days, role) {
  var perMonth = {};
  days.forEach(function (d) { var m = genMonthOf(d); perMonth[m] = (perMonth[m] || 0) + 1; });
  var t = 0;
  Object.keys(perMonth).forEach(function (m) { t += genTargetDelta(G, S, id, m, perMonth[m], null, role); });
  return t;
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
    var fixedP = lockedP || (fillOpen && !!e.primary) || genIsExternal(ctx, e.primary);
    var fixedB = lockedB || (fillOpen && !!e.backup) || genIsExternal(ctx, e.backup);
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
          if (R.eligibility(ctx, d, role, ids[i], { asBlockMember: u.present.length === 3 }).ok) { can = true; countAllowed(d, ids[i], role); }
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
function genOrder(G, role, rng) {
  function decorate(list, kindRank) { return list.map(function (u) { return { u: u, t: u.tightness[role], k: kindRank(u), j: rng() }; }); }
  function cmp(a, b) { return (a.t - b.t) || (a.k - b.k) || (a.j - b.j); }
  var hol = decorate(G.units.holidays, function () { return 0; }).sort(cmp);
  var rest = decorate(G.units.weekends, function () { return 0; }).concat(decorate(G.units.days, function () { return 1; })).sort(cmp);
  return hol.concat(rest).map(function (x) { return x.u; });
}

/* ----------------------------------------------------------- targets */

// Monthly targets - Prompt 12 J (9/22): EQUAL SHARES, per role (rules doc section 6,
// guide section 15 "no neutral/zero terms; primary spread then backup spread").
//   pool                     -> active roster ids with rules.poolMember !== false, no
//                               availableWindows and no roster type "external"
//                               (genPoolIds). Everyone in it carries BOTH targets.
//   per month                -> primaryOpen  = in-range PRIMARY slots open on the
//                               lock-only base minus reservedForWindows, the windows
//                               surgeons' reserved primaries (window target x her
//                               window weeks of the month, capped by her open window
//                               days); backupOpen = in-range BACKUP slots open on the
//                               base. primaryShare = primaryOpen / pool size,
//                               backupShare = backupOpen / pool size. Days already
//                               held through locks (import, derived, published days
//                               outside the range) count TOWARD a share, never on top.
//   pool member              -> primaryTarget = max(lockedHeld.primary,
//                               min(primaryShare, clipPrimary)); clipPrimary =
//                               min(capPreferred, capPrimary - 1) minus the East
//                               PRIMARY-week days of the month he does not hold as
//                               Silvis primary (a countsEastDays cap adds those days
//                               to his primary count whether or not he holds the
//                               derived Silvis backup - K, per role); null when
//                               uncapped, so an implied target never sits on the cap.
//                               backupTarget = max(lockedHeld.backup,
//                               min(backupShare, backupCap.perMonthDays when set)).
//   numeric monthlyTarget    -> a NUMBER is the primary target (the backup target
//                               stays the share); an OBJECT { primary, backup } sets
//                               each numeric member. An explicit null means "equal
//                               share" - there is no neutral term and no
//                               "explicit null = no target" branch any more.
//   availability windows +   -> (Prompt 12 N, 9/22 evening) primaryTarget = target x
//   daysPerWindowWeek.target    the window weeks whose window days fall in that month
//                               AND touch the generated range (a week counts once, in
//                               the month of its first window day); NO backup target;
//                               a month without a window week gives her no target at
//                               all (null, tallies "-"), never a numeric 0 (N review).
//                               She is outside the pool; her reserved primaries come
//                               off the pool's primaryOpen.
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
//                               so a shortfall caused by availability is visible.
//   month scope              -> lockedHeld and the targets are whole-calendar-month
//                               figures (the deviation counts the merged month); a
//                               month the range only touches (rangeDays < its length)
//                               keeps its full-month locked floor although few or no
//                               slots of it are being generated.
//   placeableAtTarget        -> sum over every targeted surgeon of max(0, target -
//                               lockedHeld) per role: the open slots the targets ask
//                               the generator to place. With the flat share it can be
//                               BELOW primaryOpen / backupOpen in a month where a
//                               locked floor or a clip pins a member (his share of
//                               the open slots is not redistributed); those surplus
//                               days carry no target pressure. Reported, not fixed
//                               here (a water-filled share is a spec decision).
// diagnostics.impliedTargets = { rule, pool, months: { m: { primaryOpen, backupOpen,
// poolSize, reservedForWindows, primaryShare, backupShare, rangeDays,
// placeableAtTarget: { primary, backup }, windowTarget, windowWeeks,
// members: { id: { primaryTarget, backupTarget, lockedHeld: { primary, backup },
// clipPrimary, eastPrimaryDays, allowedPrimary, allowedBackup } } } } };
// diagnostics.targets (= scoreTargets) is the per-month { id: { primary, backup } }
// table the unit scoring, smoothing and the deviation terms use.
var GEN_TARGET_RULE = "equal shares per role (J): pool = active, poolMember !== false, no availableWindows, not external; primaryShare = (open in-range primary slots - the windows surgeons' reserved primaries) / pool size; backupShare = open in-range backup slots / pool size; pool member primaryTarget = max(lockedHeld.primary, min(primaryShare, clipPrimary)) with clipPrimary = min(capPreferred, capPrimary - 1) - East primary-week days not held as Silvis primary (K; null when uncapped), backupTarget = max(lockedHeld.backup, min(backupShare, backupCap.perMonthDays)); a numeric monthlyTarget sets the primary target, { primary, backup } sets each, explicit null = equal share; windows + daysPerWindowWeek.target = target x window weeks of the month the range touches, primary only, no backup target, no target in a month without a window week (N); everyone else: no targets; allowedPrimary / allowedBackup = open in-range slots where eligibility passes on the lock-only schedule (a weekend day of a full unit as a block member, a holiday day as a unit candidate); lockedHeld and the targets are whole-calendar-month figures even where the range only touches the month (rangeDays); placeableAtTarget = sum of max(0, target - lockedHeld) per role - below the open slots where a locked floor or a clip pins a member, since the flat share is not redistributed";
// monthlyTarget override -> { primary: number|null, backup: number|null }
function genTargetOverride(v) {
  if (typeof v === "number" && isFinite(v)) return { primary: v, backup: null };
  if (v && typeof v === "object") return { primary: typeof v.primary === "number" && isFinite(v.primary) ? v.primary : null, backup: typeof v.backup === "number" && isFinite(v.backup) ? v.backup : null };
  return { primary: null, backup: null };
}
function genRound1(v) { return Math.round(v * 10) / 10; }
function genTargets(G) {
  var ctx = G.ctx, base = ctx.schedule, ids = ctx.activeIds, pool = genPoolIds(G);
  var byMonth = {}, implied = { rule: GEN_TARGET_RULE, pool: pool.slice(), months: {} };
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
    var primaryShare = poolN ? genRound1(Math.max(0, primaryOpen - reserved) / poolN) : 0;
    var backupShare = poolN ? genRound1(backupOpen / poolN) : 0;
    var I = implied.months[month] = { primaryOpen: primaryOpen, backupOpen: backupOpen, poolSize: poolN, reservedForWindows: reserved, primaryShare: primaryShare, backupShare: backupShare, rangeDays: inMonth.length, placeableAtTarget: { primary: 0, backup: 0 }, windowTarget: windowTarget, windowWeeks: windowWeeks, members: {} };
    byMonth[month] = {};
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
      var tP = ov.primary, tB = ov.backup, clip = null;
      if (poolSet[id]) {
        if (P.capPrimary !== null) {
          var ceiling = P.capPreferred !== null ? Math.min(P.capPreferred, P.capPrimary - 1) : P.capPrimary - 1;
          clip = Math.max(0, ceiling - eastP);
        }
        if (tP === null) tP = genRound1(Math.max(heldP, clip === null ? primaryShare : Math.min(primaryShare, clip)));
        var bCap = r.backupCap && typeof r.backupCap.perMonthDays === "number" ? r.backupCap.perMonthDays : null;
        if (tB === null) tB = genRound1(Math.max(heldB, bCap === null ? backupShare : Math.min(backupShare, bCap)));
      } else if (windowIds[id]) {
        // (N review) no window week in this month -> no target (tallies "-"), never a numeric 0
        if (tP === null) tP = windowWeeks[id] ? windowTarget[id] : null;
      }
      // static availability, counted by buildUnits on the same lock-only schedule (one eligibility walk)
      var al = (G.units.allowed[month] && G.units.allowed[month][id]) || { primary: 0, backup: 0 };
      I.members[id] = { primaryTarget: tP, backupTarget: tB, lockedHeld: { primary: heldP, backup: heldB }, clipPrimary: clip, eastPrimaryDays: eastP, allowedPrimary: al.primary, allowedBackup: al.backup };
      byMonth[month][id] = { primary: tP, backup: tB };
      // the open slots this surgeon's targets ask the generator to place (see placeableAtTarget below)
      if (typeof tP === "number") I.placeableAtTarget.primary += Math.max(0, tP - heldP);
      if (typeof tB === "number") I.placeableAtTarget.backup += Math.max(0, tB - heldB);
    });
    // The flat share (design decision a) divides the OPEN slots by the whole pool while the deviation counts
    // whole-month days, so where a member's locked floor or clip pins him the targets ask for FEWER
    // placements than there are open slots and the surplus days carry no target pressure (only the soft
    // terms place them). placeableAtTarget makes that gap visible next to primaryOpen / backupOpen instead
    // of hiding it; closing it (a water-filled share) is a spec decision recorded in the 9/22 J review.
    I.placeableAtTarget.primary = genRound1(I.placeableAtTarget.primary);
    I.placeableAtTarget.backup = genRound1(I.placeableAtTarget.backup);
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
    var s = genSoftSum(r) + genTargetDelta(G, S, ids[i], month, 1, day, role) + (rng ? rng() * G.jitter : 0);
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
    if (fillable.length && fillable.length < unit.present.length) { used = fillable; partial = true; patterns = R.weekendUnitPatterns(ctx, unit.friday, role, used); }
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
    var s = pat.penalty + (rng ? rng() * G.jitter : 0);
    for (var j = 0; j < slotDay.length; j++) {
      var mid = pat.members[slotKey[j]];
      if (!mid) continue;
      if (!perId) perId = {};
      (perId[mid] = perId[mid] || []).push(slotDay[j]);
    }
    if (perId) for (var pid in perId) s += genTargetDeltaForDays(G, S, pid, perId[pid], role);
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
  if (best.kind === "daily") S.patternPenalties.push({ day: unit.friday, role: role, id: null, reason: "pattern-daily", weight: G.W.patternDaily });
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
    var s = soft + genTargetDeltaForDays(G, S, id, open, role) + genHolidayLoad(G, id, unit.tier) * G.W.medium + (rng ? rng() * G.jitter : 0);
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
    var s = genSoftSum(r) + genTargetDelta(G, S, ids[i], genMonthOf(day), 1, day, role);
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

// Prompt 12 J: smoothing runs per ROLE - a primary day moves from a surgeon above his
// primary target to one below it, a backup day likewise against the backup targets
// (day-unit slots only; every move through eligibility(); the soft score may not
// worsen beyond weights.smoothingTolerance; the role's deviation must strictly fall).
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
        var highs = ids.filter(function (id) { return T[id] !== null && counts[id] > T[id]; }).sort(function (a, b) { return (counts[b] - T[b]) - (counts[a] - T[a]); });
        var lows = ids.filter(function (id) { return T[id] !== null && counts[id] < T[id]; }).sort(function (a, b) { return (T[b] - counts[b]) - (T[a] - counts[a]); });
        if (!highs.length || !lows.length) continue;
        for (var h = 0; h < highs.length && !moved; h++) {
          var H = highs[h];
          var slots = Object.keys(S.placed).map(function (k) { return S.placed[k]; }).filter(function (p) { return p.id === H && p.role === role && p.unitKind === "day" && genMonthOf(p.day) === month; }).sort(function (a, b) { return a.day < b.day ? -1 : a.day > b.day ? 1 : 0; });
          for (var s = 0; s < slots.length && !moved; s++) {
            var slot = slots[s];
            var oldSoft = genSoftSum(R.eligibility(ctx, slot.day, slot.role, H));
            genUnset(G, S, slot.day, slot.role);
            for (var l = 0; l < lows.length; l++) {
              var L = lows[l];
              var before = Math.abs(counts[H] - T[H]) + Math.abs(counts[L] - T[L]);
              var after = Math.abs(counts[H] - 1 - T[H]) + Math.abs(counts[L] + 1 - T[L]);
              if (after >= before) continue;
              var r = R.eligibility(ctx, slot.day, slot.role, L);
              if (!r.ok || genSoftSum(r) - oldSoft > tol) continue;
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
  S.patternPenalties.forEach(function (p) { softList.push(p); softSum += p.weight; });
  // J: one deviation per role (primary first in the lexicographic score)
  var primaryDeviation = 0, backupDeviation = 0;
  G.months.forEach(function (month) {
    var T = G.targets.byMonth[month];
    Object.keys(T).forEach(function (id) {
      if (T[id].primary !== null) primaryDeviation += Math.abs(genMonthCount(G, S, id, month, "primary") - T[id].primary);
      if (T[id].backup !== null) backupDeviation += Math.abs(genMonthCount(G, S, id, month, "backup") - T[id].backup);
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
    return { day: o.day, role: o.role, weekday: genWeekday(o.day), holidayUnit: hol ? hol.name : null, reasons: reasons };
  });
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
    var sumP = null, sumB = null;
    G.months.forEach(function (month) {
      var t = R.talliesFor(ctx, id, month);
      t.cap = R.monthlyCapFor(ctx, id).primary; // K: the cap is on PRIMARY days (preview column "Cap (P)")
      t.eastP = eastPIn(genMonthDays(month));
      t.target = { primary: genTargetFor(G, month, id, "primary"), backup: genTargetFor(G, month, id, "backup") };
      if (t.target.primary !== null) sumP = (sumP || 0) + t.target.primary;
      if (t.target.backup !== null) sumB = (sumB || 0) + t.target.backup;
      months[month] = t;
    });
    var range = genRunStats(G, id, G.days);
    range.cap = R.monthlyCapFor(ctx, id).primary;
    range.eastP = eastPIn(G.days);
    range.target = { primary: sumP === null ? null : genRound1(sumP), backup: sumB === null ? null : genRound1(sumB) };
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
    placedCount: Object.keys(S.placed).length,
    warnings: warnings
  };
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
  var days = genDaysList(startDate, endDate);
  var months = [];
  days.forEach(function (d) { var m = genMonthOf(d); if (months.indexOf(m) < 0) months.push(m); });
  var G = {
    ctx: ctx, R: R, W: W, start: startDate, end: endDate, days: days, months: months,
    respectLocks: opts.respectLocks !== false, jitter: typeof W.jitter === "number" ? W.jitter : 1, warnings: [],
    fillOpenOnly: opts.fillOpenOnly === true, // T: fill only the open slots, every held slot is fixed
    unitKeyOf: {}, unitKindOf: {},
    // N: window weeks per windows surgeon (her monthly primary target = target x these weeks; J counts per role,
    // so her backups simply have no target to count against)
    windowWeeks: genWindowWeeks(ctx)
  };
  try {
    G.base = genSeedLocks(G, original);
    ctx.schedule = G.base;
    G.units = buildUnits(ctx, startDate, endDate);
    G.units.all.forEach(function (u) {
      var list = u.kind === "holiday" ? u.inRange : u.kind === "weekend" ? u.present : [u.day];
      list.forEach(function (d) { G.unitKeyOf[d] = u.key; G.unitKindOf[d] = u.kind; });
    });
    G.targets = genTargets(G);
    G.forced = genForcedSlots(G);
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
    rangePresets: rangePresets,
    buildUnits: buildUnits,
    scoreCandidate: scoreCandidate,
    genPrng: genPrng,
    GEN_SCORE_WEIGHTS: GEN_SCORE_WEIGHTS,
    genAddDays: genAddDays,
    genWeekday: genWeekday,
    genDaysList: genDaysList
  };
}
