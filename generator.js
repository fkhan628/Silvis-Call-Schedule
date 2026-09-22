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
//   generate(ctx, startDate, endDate, { seed, bestOf, respectLocks, timeBudgetMs })
//     -> { schedule, diagnostics }
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
//   2 build units     holiday units (rules.holidayUnits) pre-empt weekend days;
//                     leftover Fri/Sat/Sun form a reduced weekend unit; every
//                     other day is a day unit. Tightness per unit/role is
//                     measured once on the lock-only schedule.
//   3 primary pass    holidays first, then weekends + days most-constrained-first
//                     (jittered ties). Patterns: holidayUnitCandidates /
//                     weekendUnitPatterns / per-surgeon eligibility. Score =
//                     soft sum + target-deviation delta + pattern penalty +
//                     holiday load + jitter; minimum wins; none -> open. The
//                     target delta uses the fairness target, or a neutral
//                     implied term for an explicit-null pool member (genTargets).
//   4 backup pass     same with primary fixed.
//   5 repair          open slots: unit retry (holidays), direct fill, then
//                     1-hop and 2-hop swaps of non-locked generator-placed
//                     day-unit slots, each move re-verified via eligibility().
//   6 smoothing       move a non-locked day-unit slot from a surgeon above his
//                     monthly target to one below while eligibility holds, the
//                     soft score does not worsen beyond weights.smoothingTolerance
//                     and total target deviation strictly falls.
//   7 evaluate        final eligibility pass over every generator-placed slot
//                     (hard violations must be 0; counted anyway), soft list,
//                     open slots, target deviation, spreads -> scoreCandidate().
// Best-of-N keeps the minimum total; early exit only when nothing is open and
// the soft sum is 0.

var GEN_DAY_MS = 86400000;
var GEN_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
var GEN_ROLES = ["primary", "backup"];
var GEN_SCORE_WEIGHTS = { uncoveredPrimary: 1e9, uncoveredBackup: 1e7, hardViolations: 1e6, softSum: 1e3, targetDeviation: 100, weekendSpread: 10, holidaySpread: 1 };
// Hard reasons that depend only on the schedule state (a swap can lift them).
var GEN_DYNAMIC_REASONS = ["monthly-cap", "max-consecutive", "backup-cap", "backup-weekend-cap", "window-week-max", "max-major-holidays", "holds-other-role"];
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
      talliesFor: talliesFor, runThrough: rdRunThrough, resolveWeight: resolveWeight, monthlyCapFor: monthlyCapFor, defaultWeights: defaultWeights
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
    softSum: p.softSum || 0, targetDeviation: p.targetDeviation || 0, weekendSpread: p.weekendSpread || 0, holidaySpread: p.holidaySpread || 0
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
// Silvis days (any role) the surgeon holds in a month, read from the working schedule.
function genMonthCountScan(W, id, month) {
  var days = genMonthDays(month), c = 0;
  for (var i = 0; i < days.length; i++) { var e = W[days[i]]; if (e && (e.primary === id || e.backup === id)) c++; }
  return c;
}
// Running per-candidate counters (S.counts[month][id]) kept exact by genSet/genUnset.
function genInitCounts(G, S) {
  S.counts = {};
  G.months.forEach(function (month) {
    S.counts[month] = {};
    G.ctx.activeIds.forEach(function (id) { S.counts[month][id] = genMonthCountScan(G.ctx.schedule, id, month); });
  });
}
function genMonthCount(G, S, id, month) {
  var m = S.counts[month];
  return m && m[id] !== undefined ? m[id] : genMonthCountScan(G.ctx.schedule, id, month);
}
function genBump(G, S, day, id, delta) {
  var m = S.counts[genMonthOf(day)];
  if (!m || m[id] === undefined) return;
  var e = G.ctx.schedule[day];
  // distinct days: the counter moves only when the surgeon gains his first / loses his last role that day
  if (delta > 0 && (e.primary === id) !== (e.backup === id)) m[id] += 1;
  else if (delta < 0 && e.primary !== id && e.backup !== id) m[id] -= 1;
}
// Fairness target (deviation term, smoothing, tallies display) - null when the surgeon has none.
function genTargetFor(G, month, id) { var t = G.targets.byMonth[month]; return t && t[id] != null ? t[id] : null; }
// Unit-scoring target: the fairness target, or the neutral term of an explicit-null pool member (see genTargets).
function genScoreTargetFor(G, month, id) { var t = G.targets.scoreByMonth[month]; return t && t[id] != null ? t[id] : null; }
// Still-open day-unit slots in `month` where `id` is the ONLY eligible surgeon
// (measured on the lock-only schedule): load he will carry anyway, so the
// target term sees it before weekends and holidays are handed out.
function genPendingForced(G, S, id, month, exceptDay) {
  var list = G.forced[id] && G.forced[id][month];
  if (!list) return 0;
  var W = G.ctx.schedule, n = 0;
  for (var i = 0; i < list.length; i++) {
    var f = list[i];
    if (f.day === exceptDay) continue;
    var e = W[f.day];
    if (e.primary === id || e.backup === id) continue;
    for (var r = 0; r < f.roles.length; r++) if (genSlotOpen(e, f.roles[r])) { n++; break; }
  }
  return n;
}
// Change in |count - target| when `extra` more days in `month` go to `id`
// (0 when the surgeon carries neither a target nor a neutral term).
function genTargetDelta(G, S, id, month, extra, exceptDay) {
  var T = genScoreTargetFor(G, month, id);
  if (T === null) return 0;
  var c = genMonthCount(G, S, id, month) + genPendingForced(G, S, id, month, exceptDay);
  return (Math.abs(c + extra - T) - Math.abs(c - T)) * G.W.low;
}
function genTargetDeltaForDays(G, S, id, days) {
  var perMonth = {};
  days.forEach(function (d) { var m = genMonthOf(d); perMonth[m] = (perMonth[m] || 0) + 1; });
  var t = 0;
  Object.keys(perMonth).forEach(function (m) { t += genTargetDelta(G, S, id, m, perMonth[m], null); });
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
  genBump(G, S, day, id, +1);
  S.placed[day + "|" + role] = { day: day, role: role, id: id, unitKey: G.unitKeyOf[day], unitKind: G.unitKindOf[day] };
}
function genUnset(G, S, day, role) {
  var id = G.ctx.schedule[day][role];
  G.ctx.schedule[day][role] = null;
  if (id) genBump(G, S, day, id, -1);
  delete S.placed[day + "|" + role];
}

/* ------------------------------------------------------------- locks */

// In-range entries rebuilt from the original schedule: locked slots kept,
// everything else cleared; derived East weeks applied as locks unless an
// import/manual lock already holds the slot (warning). Out-of-range entries
// are shared by reference and never written.
function genSeedLocks(G, original) {
  var base = {}, ctx = G.ctx;
  Object.keys(original).forEach(function (k) { base[k] = original[k]; });
  G.lockSrc = {};
  G.days.forEach(function (d) {
    var e = original[d] || {};
    var lockedP = !!e.externalCover || (G.respectLocks && !!e.primaryLocked && !!e.primary);
    var lockedB = G.respectLocks && !!e.backupLocked && !!e.backup;
    base[d] = {
      primary: lockedP ? (e.primary || null) : null,
      backup: lockedB ? e.backup : null,
      primaryLocked: lockedP,
      backupLocked: lockedB,
      source: (lockedP || lockedB) ? (e.source || "import") : "generated",
      externalCover: e.externalCover || null,
      note: e.note === undefined ? null : e.note
    };
    G.lockSrc[d] = { primary: lockedP ? "import" : null, backup: lockedB ? "import" : null };
  });
  G.days.forEach(function (d) {
    var ds = ctx.derivedByDay[d];
    if (!ds) return;
    GEN_ROLES.forEach(function (role) {
      var id = ds[role];
      if (!id) return;
      var e = base[d], other = role === "primary" ? "backup" : "primary";
      if (e[role + "Locked"]) {
        if (e[role] === id) { G.lockSrc[d][role] = "import+derived"; return; }
        G.warnings.push("derived lock overridden by import/manual lock: " + d + " " + role + " derived " + id + ", locked to " + (e[role] || ("externalCover " + e.externalCover)));
        return;
      }
      if (e[other + "Locked"] && e[other] === id) {
        G.warnings.push("derived lock skipped: " + d + " " + role + " derived " + id + " but he is import-locked as " + other + " that day");
        return;
      }
      e[role] = id;
      e[role + "Locked"] = true;
      if (!G.lockSrc[d].primary && !G.lockSrc[d].backup) e.source = "east-derived";
      G.lockSrc[d][role] = "derived";
    });
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
  // Tightness per role on the current schedule.
  var ids = ctx.activeIds;
  GEN_ROLES.forEach(function (role) {
    holidays.forEach(function (u) {
      var anyOpen = u.inRange.some(function (d) { return genSlotOpen(ctx.schedule[d], role); });
      u.tightness[role] = anyOpen ? R.holidayUnitCandidates(ctx, { name: u.name, tier: u.tier, days: u.inRange }, role).length : 99;
    });
    weekends.forEach(function (u) {
      var anyOpen = u.present.some(function (d) { return genSlotOpen(ctx.schedule[d], role); });
      if (!anyOpen) { u.tightness[role] = 99; return; }
      // distinct surgeons who can take at least one present day solo or as a
      // block member (cheaper than a full pattern enumeration, same ordering)
      var n = 0;
      for (var i = 0; i < ids.length; i++) {
        var can = false;
        for (var k = 0; k < u.present.length && !can; k++) can = R.eligibility(ctx, u.present[k], role, ids[i], { asBlockMember: u.present.length === 3 }).ok;
        if (can) n++;
      }
      u.tightness[role] = n;
    });
    dayUnits.forEach(function (u) {
      if (!genSlotOpen(ctx.schedule[u.day], role)) { u.tightness[role] = 99; return; }
      var n = 0;
      for (var i = 0; i < ids.length; i++) if (R.eligibility(ctx, u.day, role, ids[i]).ok) n++;
      u.tightness[role] = n;
    });
  });
  return { holidays: holidays, weekends: weekends, days: dayUnits, all: holidays.concat(weekends, dayUnits), holidayDaySet: holidayDaySet };
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

// Monthly targets (rules doc section 6; orientation section 3 item 10), per month:
//   numeric monthlyTarget    -> that number: fairness target (deviation term,
//                               smoothing) AND unit-scoring term.
//   absent, pool member      -> implied: target = max(lockedHeld, min(share, clip))
//                               share = the month's open in-range slots / active
//                               pool members without a numeric target; clip =
//                               min(capPreferred, capPrimary - 1) minus the East
//                               PRIMARY-week days of that month he does NOT already
//                               hold in the base schedule (a countsEastDays cap; a
//                               held derived week is in lockedHeld and counts once;
//                               9/22, Prompt 12 K - caps count primary only).
//                               NOTE: Prompt 12 J replaces this target model (equal
//                               primary and backup shares); until then the share
//                               and lockedHeld still count both roles and only the
//                               clip follows the primary-only cap.
//                               Days already held through locks (import, derived,
//                               published days outside the range) count TOWARD the
//                               share, never on top of it, and an implied target
//                               never sits on the cap itself (the cap is a ceiling;
//                               a locked month above it keeps its held count).
//   explicit null, pool member -> NO fairness target (nothing pulls his count,
//                               smoothing never moves his days, tallies show "-")
//                               but the unit-scoring term uses the same implied
//                               number as a NEUTRAL term: a zero term loses every
//                               weekend/day tie while the targeted surgeons are
//                               under target and wins every tie once they are over,
//                               which turns a no-target surgeon into the residual
//                               sink (Khan: 0 primaries, 25 backups). With the neutral
//                               term he competes on equal footing.
//   availability windows     -> no term at all (window rules fix the load).
//   poolMember === false     -> no target, no term.
// diagnostics.impliedTargets[month] prints every input and which surgeons carry
// a neutral term (neutralTerm) or none (noTerm); diagnostics.scoreTargets is the
// per-month table the unit scoring actually used.
var GEN_TARGET_RULE = "target = max(lockedHeld, min(share, clip)); share = open in-range slots / pool members without a numeric target; clip = min(capPreferred, capPrimary - 1) - East primary-week days (K); explicit null = no fairness target but the same number as a neutral scoring term; windows = no term";
function genTargets(G) {
  var ctx = G.ctx, base = G.ctx.schedule, byMonth = {}, scoreByMonth = {}, implied = { rule: GEN_TARGET_RULE, months: {} };
  var ids = ctx.activeIds;
  var noNumeric = ids.filter(function (id) { var r = ctx.per[id].rules; return r.poolMember !== false && typeof r.monthlyTarget !== "number"; });
  G.months.forEach(function (month) {
    var openSlots = 0;
    G.days.forEach(function (d) {
      if (genMonthOf(d) !== month) return;
      GEN_ROLES.forEach(function (role) { if (genSlotOpen(base[d], role)) openSlots++; });
    });
    var share = noNumeric.length ? openSlots / noNumeric.length : 0;
    byMonth[month] = {}; scoreByMonth[month] = {};
    var I = implied.months[month] = { openSlots: openSlots, divisor: noNumeric.length, share: Math.round(share * 10) / 10, targets: {}, neutralTerm: {}, noTerm: [], lockedHeld: {}, eastOnlyDays: {}, capClip: {} };
    ids.forEach(function (id) {
      var P = ctx.per[id], r = P.rules;
      if (typeof r.monthlyTarget === "number") { byMonth[month][id] = r.monthlyTarget; scoreByMonth[month][id] = r.monthlyTarget; return; }
      if (r.poolMember === false) return;
      if (P.hasWindows) { I.noTerm.push(id); return; }
      var held = 0, eastOnly = 0;
      genMonthDays(month).forEach(function (d) {
        var e = base[d], holds = !!(e && (e.primary === id || e.backup === id));
        if (holds) held++;
        // K: the days a countsEastDays cap adds are his East PRIMARY-week days
        // (derived Silvis backup). A day he already holds - as the derived backup
        // itself, or as Silvis primary - is in `held` and is counted ONCE; only an
        // East primary-week day he does NOT hold in the base schedule (the derived
        // lock overridden or skipped) is East-only. Counting a held derived week
        // twice shrank his clip from 13 to 6 and collapsed the November target onto
        // the locked floor (K review, 9/22).
        else if (P.countsEastDays && P.eastPrimaryDays.has(d)) eastOnly++;
      });
      var clip = null;
      if (P.capPrimary !== null) {
        var ceiling = P.capPreferred !== null ? Math.min(P.capPreferred, P.capPrimary - 1) : P.capPrimary - 1;
        clip = Math.max(0, ceiling - eastOnly);
      }
      var t = Math.max(held, clip === null ? share : Math.min(share, clip));
      t = Math.round(t * 10) / 10;
      I.lockedHeld[id] = held; I.eastOnlyDays[id] = eastOnly; I.capClip[id] = clip;
      scoreByMonth[month][id] = t;
      if (Object.prototype.hasOwnProperty.call(r, "monthlyTarget")) { I.neutralTerm[id] = t; return; } // explicit null: neutral term only
      byMonth[month][id] = t;
      I.targets[id] = t;
    });
  });
  return { byMonth: byMonth, scoreByMonth: scoreByMonth, implied: implied };
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
    var s = genSoftSum(r) + genTargetDelta(G, S, ids[i], month, 1, day) + (rng ? rng() * G.jitter : 0);
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
    if (perId) for (var pid in perId) s += genTargetDeltaForDays(G, S, pid, perId[pid]);
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
    var s = soft + genTargetDeltaForDays(G, S, id, open) + genHolidayLoad(G, id, unit.tier) * G.W.medium + (rng ? rng() * G.jitter : 0);
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
    var s = genSoftSum(r) + genTargetDelta(G, S, ids[i], genMonthOf(day), 1, day);
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

function genSmooth(G, S) {
  var ctx = G.ctx, R = G.R, W = ctx.schedule, ids = ctx.activeIds;
  var tol = typeof G.W.smoothingTolerance === "number" ? G.W.smoothingTolerance : 2;
  for (var iter = 0; iter < 200; iter++) {
    var moved = false;
    for (var mi = 0; mi < G.months.length && !moved; mi++) {
      var month = G.months[mi], T = G.targets.byMonth[month];
      if (!T) continue;
      var counts = {};
      ids.forEach(function (id) { counts[id] = genMonthCount(G, S, id, month); });
      var highs = ids.filter(function (id) { return T[id] != null && counts[id] > T[id]; }).sort(function (a, b) { return (counts[b] - T[b]) - (counts[a] - T[a]); });
      var lows = ids.filter(function (id) { return T[id] != null && counts[id] < T[id]; }).sort(function (a, b) { return (T[b] - counts[b]) - (T[a] - counts[a]); });
      if (!highs.length || !lows.length) continue;
      for (var h = 0; h < highs.length && !moved; h++) {
        var H = highs[h];
        var slots = Object.keys(S.placed).map(function (k) { return S.placed[k]; }).filter(function (p) { return p.id === H && p.unitKind === "day" && genMonthOf(p.day) === month; }).sort(function (a, b) { return a.day < b.day ? -1 : a.day > b.day ? 1 : 0; });
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

function genPoolIds(G) {
  return G.ctx.activeIds.filter(function (id) { var P = G.ctx.per[id]; return P.rules.poolMember !== false && !P.hasWindows; });
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
  var targetDeviation = 0;
  G.months.forEach(function (month) {
    var T = G.targets.byMonth[month];
    Object.keys(T).forEach(function (id) { targetDeviation += Math.abs(genMonthCount(G, S, id, month) - T[id]); });
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
    hardViolations: hardViolations.length, softSum: Math.round(softSum * 1000) / 1000, targetDeviation: Math.round(targetDeviation * 10) / 10,
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
    ids.forEach(function (id) {
      if (hol) {
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
  // Locks that break a rule (reported, never changed).
  var lockViolations = [];
  G.days.forEach(function (d) {
    var e = W[d];
    GEN_ROLES.forEach(function (role) {
      if (!e[role + "Locked"] || !e[role]) return;
      var r = R.eligibility(ctx, d, role, e[role], { asBlockMember: genHoldsFullBlock(W, d, role, e[role]) });
      var conflicts = r.conflicts || (r.ok ? [] : r.hard);
      if (conflicts.length) lockViolations.push({ day: d, role: role, id: e[role], lock: G.lockSrc[d][role], reasons: conflicts.slice() });
    });
  });
  // Tallies: per month (full calendar month, running-tally semantics) plus in-range totals.
  var tallies = {};
  ids.forEach(function (id) {
    var P = ctx.per[id], months = {};
    // K: the East PRIMARY-week days a countsEastDays cap adds to the primary count (0 for
    // everyone else) - the preview flags a row when primary + eastP is over the cap, which
    // is the engine's count; a backup day on one of those days is not counted twice.
    var eastPIn = function (list) { return P.countsEastDays ? list.filter(function (d) { return P.eastPrimaryDays.has(d); }).length : 0; };
    G.months.forEach(function (month) {
      var t = R.talliesFor(ctx, id, month);
      t.cap = R.monthlyCapFor(ctx, id).primary; // K: the cap is on PRIMARY days (preview column "Cap (P)")
      t.eastP = eastPIn(genMonthDays(month));
      t.target = genTargetFor(G, month, id);
      months[month] = t;
    });
    var range = genRunStats(G, id, G.days);
    range.cap = R.monthlyCapFor(ctx, id).primary;
    range.eastP = eastPIn(G.days);
    tallies[id] = { code: ctx.rosterById[id].code, name: ctx.rosterById[id].name, months: months, range: range };
  });
  // East feed snapshot / forecast / unknown days.
  var snapshot = { coverage: ctx.eastCoverage ? { from: ctx.eastCoverage.from, to: ctx.eastCoverage.to } : null, busyDaysInRange: {}, forecastDaysInRange: {}, derivedDaysInRange: {}, forecastThreshold: ctx.forecastThreshold };
  var eastForecast = [], eastUnknownDays = [];
  ids.forEach(function (id) {
    var P = ctx.per[id];
    if (!P.eastEnabled) return;
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
      if (role && !P.eastBusy.has(d) && typeof prob !== "number") {
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
    holidayUnits: holidayUnitsOut,
    weekendUnits: weekendUnitsOut,
    impliedTargets: G.targets.implied,
    targets: G.targets.byMonth,
    scoreTargets: G.targets.scoreByMonth,
    forcedSlots: G.forced,
    eastFeedSnapshot: snapshot,
    eastForecast: eastForecast,
    eastUnknownDays: eastUnknownDays,
    placedCount: Object.keys(S.placed).length,
    warnings: warnings
  };
}

function genSnapshot(G, W) {
  var out = {};
  G.days.forEach(function (d) {
    var e = W[d];
    out[d] = { primary: e.primary || null, backup: e.backup || null, primaryLocked: !!e.primaryLocked, backupLocked: !!e.backupLocked, source: e.source, externalCover: e.externalCover || null, note: e.note === undefined ? null : e.note };
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
    unitKeyOf: {}, unitKindOf: {}
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
