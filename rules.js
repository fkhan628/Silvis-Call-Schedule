// Silvis Call Schedule - rules engine (pure functions; no DOM, no fetch, no
// Date.now()/Math.random inside eligibility).
//
// Loadable two ways:
//   * browser: classic <script> after helpers.js/config.js. Classic scripts share
//     one global lexical scope, so every top-level name here is either part of
//     the public API (matchesPattern, buildContext, eligibility, ...) or carries
//     an rd/RD_ prefix that nothing else in the app declares.
//   * Node: `const rules = require("./rules.js")` (module.exports at the bottom).
//
// eligibility(ctx, date, role, surgeonId) is the single chokepoint: every
// assignment, repair move, trade acceptance and manual edit consults it. It is
// evaluated in two layers:
//   1. STATIC layer - memoized per (surgeon, role, date, asBlockMember): roster
//      activity, time off, dated availability rows, whitelist modes, recurring
//      and weekday patterns, East busy/forecast/unknown, holiday waivers.
//   2. DYNAMIC layer - read live from ctx.schedule on every call: external
//      cover, slot locks, derived (East) locks, same-day other role, monthly
//      caps, max consecutive, backup caps, Sarkar's window-week count, major
//      holiday limits and the schedule-shape soft penalties.
// ctx.schedule is the live schedule object: the generator mutates it in place
// and eligibility sees the change on the next call (no tally refresh needed).
// Hard reasons from the static layer are complete; the dynamic gates are only
// evaluated once the static layer passes (the UI shows the first hard reason).
//
// Lock holders: a surgeon who holds a locked slot (import/manual lock, or a
// derived East lock that no import/manual lock overrides) always evaluates
// { ok:true, lockHolder:true }; rules the locked row violates are listed in
// `conflicts` so callers keep the lock and surface a warning.
//
// Input shapes the caller must respect (buildContext warns on the rest):
//   eastDerived   [{ surgeonId, weekMonday, silvisRole }] - deriveFierceWeeks()
//                 returns rows WITHOUT surgeonId; the caller attaches the roster
//                 id it resolves by code (never a literal id) before passing them.
//   eastBusyDays  { [surgeonId]: Array | Set | { 'YYYY-MM-DD': truthy } |
//                 { busy: Set, reasons } } - the last is deriveKhanBusyDays()'s
//                 own return shape.
//   surgeonRules[id].explicitListMonths  ['YYYY-MM', ...] governs both roles;
//                 { month:'YYYY-MM', roles:['primary'] } governs only those roles
//                 (a role-scoped explicit list, e.g. Philip's October primaries).
//
// Every rule reads data from surgeonRules / groupRules - there is no
// surgeon-specific branch in this file.

var RD_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
var RD_DAY_MS = 86400000;
var RD_MASK = { primary: 1, backup: 2, any: 3 };
var rdInfoCache = Object.create(null);
var rdMonthCache = Object.create(null);

/* ------------------------------------------------------------------ dates */

function rdPad2(n) { return n < 10 ? "0" + n : "" + n; }

// Day number (days since 1970-01-01, UTC arithmetic so DST never shifts a day).
function rdFromDayNum(n) {
  var dt = new Date(n * RD_DAY_MS);
  return dt.getUTCFullYear() + "-" + rdPad2(dt.getUTCMonth() + 1) + "-" + rdPad2(dt.getUTCDate());
}

// Cached facts about one 'YYYY-MM-DD' string.
function rdInfo(s) {
  var i = rdInfoCache[s];
  if (i) return i;
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("rules.js: bad date string " + JSON.stringify(s));
  var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
  var n = Math.round(Date.UTC(y, m - 1, d) / RD_DAY_MS);
  var wdi = ((n + 3) % 7 + 7) % 7; // 1970-01-01 was a Thursday -> index 3 (Mon = 0)
  i = {
    s: s, y: y, m: m, d: d, n: n, wdi: wdi, wd: RD_WEEKDAYS[wdi],
    month: s.slice(0, 7),
    nth: Math.floor((d - 1) / 7) + 1,              // nth occurrence of this weekday in its month
    monday: rdFromDayNum(n - wdi),                  // Monday of the Mon-Sun week containing s
    friday: wdi >= 4 ? rdFromDayNum(n - (wdi - 4)) : null // Friday of the weekend unit (Fri/Sat/Sun only)
  };
  rdInfoCache[s] = i;
  return i;
}

function rdFmt(d) { return d.getFullYear() + "-" + rdPad2(d.getMonth() + 1) + "-" + rdPad2(d.getDate()); }
function rdParse(s) { var i = rdInfo(s); return new Date(i.y, i.m - 1, i.d); }
function rdAddDays(s, n) { return rdFromDayNum(rdInfo(s).n + n); }
function rdWeekday(s) { return rdInfo(s).wd; }
function rdDaysBetween(a, b) { return rdInfo(b).n - rdInfo(a).n; }
function rdDaysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function rdMonthKey(y, m) { return y + "-" + rdPad2(m); }

// All date strings of 'YYYY-MM' (cached).
function rdMonthDays(month) {
  var c = rdMonthCache[month];
  if (c) return c;
  var y = +month.slice(0, 4), m = +month.slice(5, 7), dim = rdDaysInMonth(y, m), out = [];
  for (var d = 1; d <= dim; d++) out.push(month + "-" + rdPad2(d));
  rdMonthCache[month] = out;
  return out;
}

// Date of the nth <weekday> of month (y, m), or null when the month has no nth one.
function rdNthWeekdayOfMonth(y, m, weekday, n) {
  var first = rdInfo(rdMonthKey(y, m) + "-01");
  var target = RD_WEEKDAYS.indexOf(weekday);
  if (target < 0) return null;
  var day = 1 + ((target - first.wdi + 7) % 7) + (n - 1) * 7;
  if (day > rdDaysInMonth(y, m)) return null;
  return rdMonthKey(y, m) + "-" + rdPad2(day);
}

/* --------------------------------------------------------------- patterns */

// matchesPattern(dateStr, pattern) -> boolean. Weekday names are 'Mon'..'Sun'.
//   { dates: [...] }                     explicit list (membership)
//   { start, end }                       inclusive range
//   { weekday }                          every such weekday
//   { weekday, nth: [2,4] }              nth occurrence of that weekday in its month
//                                        (nth = floor((dayOfMonth-1)/7)+1)
//   { weekday, nthWeekOfMonth: 3 }       that weekday inside the Mon-Sun week that CONTAINS
//                                        the nth anchor weekday (anchor default 'Wed') of the
//                                        month. 'Friday of the 3rd week' = the Friday of the
//                                        Mon-Sun week containing the 3rd Wednesday. Because
//                                        such a week can start in the previous month (a Mon/Tue
//                                        before a 1st Wednesday on the 1st-3rd), the date's own
//                                        month AND the following month are both tried.
//   { weekday, beforeNthMonday: [2,4] }  the weekday immediately before an nth Monday, i.e.
//                                        date + 1 day is a Monday whose nth is in the list
//                                        (with weekday 'Sun' this is the Sunday before it).
// A pattern that names none of these keys never matches. An array of patterns
// matches when any element matches.
function matchesPattern(dateStr, pattern) {
  if (!pattern) return false;
  if (Array.isArray(pattern)) {
    for (var k = 0; k < pattern.length; k++) if (matchesPattern(dateStr, pattern[k])) return true;
    return false;
  }
  var info = rdInfo(dateStr);
  var matchedSomething = false;
  if (pattern.dates) {
    if (pattern.dates.indexOf(dateStr) < 0) return false;
    matchedSomething = true;
  }
  if (pattern.start || pattern.end) {
    if (pattern.start && dateStr < pattern.start) return false;
    if (pattern.end && dateStr > pattern.end) return false;
    matchedSomething = true;
  }
  if (pattern.weekday) {
    if (pattern.weekday !== info.wd) return false;
    matchedSomething = true;
  }
  if (pattern.nth !== undefined && pattern.nth !== null) {
    var nthList = Array.isArray(pattern.nth) ? pattern.nth : [pattern.nth];
    if (nthList.indexOf(info.nth) < 0) return false;
    matchedSomething = true;
  }
  if (pattern.nthWeekOfMonth !== undefined && pattern.nthWeekOfMonth !== null) {
    var anchor = pattern.anchorWeekday || "Wed";
    var inWeek = false;
    for (var step = 0; step < 2 && !inWeek; step++) {
      var y = info.y, m = info.m + step;
      if (m > 12) { m = 1; y++; }
      var anchorDate = rdNthWeekdayOfMonth(y, m, anchor, pattern.nthWeekOfMonth);
      if (!anchorDate) continue;
      var monN = rdInfo(rdInfo(anchorDate).monday).n;
      if (info.n >= monN && info.n <= monN + 6) inWeek = true;
    }
    if (!inWeek) return false;
    matchedSomething = true;
  }
  if (pattern.beforeNthMonday !== undefined && pattern.beforeNthMonday !== null) {
    var list = Array.isArray(pattern.beforeNthMonday) ? pattern.beforeNthMonday : [pattern.beforeNthMonday];
    var next = rdInfo(rdAddDays(dateStr, 1));
    if (next.wd !== "Mon" || list.indexOf(next.nth) < 0) return false;
    matchedSomething = true;
  }
  return matchedSomething;
}

/* ---------------------------------------------------------------- weights */

function defaultWeights() {
  return {
    low: 1, medium: 3, strong: 10, preferred: -1,
    patternDaily: 5, patternMismatch: 3, backToBackWeekend: 3, backupAfterPrimary: 1,
    noTargetWeekday: 1, eastUnknown: 1, eastForecastBelowThreshold: 2, smoothingTolerance: 2
  };
}

// resolveWeight(ctx, 'medium' | 4 | '2.5') -> number. Unknown strings fall back to medium.
function resolveWeight(ctx, w) {
  var W = (ctx && ctx.weights) || defaultWeights();
  if (typeof w === "number" && !isNaN(w)) return w;
  if (typeof w === "string") {
    if (Object.prototype.hasOwnProperty.call(W, w)) return W[w];
    var f = parseFloat(w);
    if (!isNaN(f)) return f;
  }
  return W.medium;
}

/* ------------------------------------------------------------- context */

function rdToSet(v) {
  if (!v) return new Set();
  if (v instanceof Set) return new Set(v);
  if (Array.isArray(v)) return new Set(v);
  if (typeof v === "object") return new Set(Object.keys(v).filter(function (k) { return v[k]; }));
  return new Set();
}

function rdEachDayInRange(start, end, fn) {
  if (!start || !end || end < start) return;
  var a = rdInfo(start).n, b = rdInfo(end).n;
  if (b - a > 5000) throw new Error("rules.js: range too long " + start + ".." + end);
  for (var n = a; n <= b; n++) fn(rdFromDayNum(n));
}

// Normalize schedule entries in place: a seed/import row may carry a single
// `locked` flag; the engine reads primaryLocked/backupLocked. A null slot is
// never locked (groupRules.locks.nullSlotIsNeverLocked).
function rdNormalizeSchedule(schedule) {
  var keys = Object.keys(schedule);
  for (var i = 0; i < keys.length; i++) {
    var e = schedule[keys[i]];
    if (!e || typeof e !== "object") continue;
    if (e.primary === undefined) e.primary = null;
    if (e.backup === undefined) e.backup = null;
    if (e.primaryLocked === undefined) e.primaryLocked = !!(e.locked && (e.primary != null || e.externalCover));
    if (e.backupLocked === undefined) e.backupLocked = !!(e.locked && e.backup != null);
    if (e.externalCover === undefined) e.externalCover = null;
  }
  return schedule;
}

function rdAvailRec(map, date) {
  var r = map[date];
  if (!r) r = map[date] = { unavail: 0, avail: 0, backupOnly: false, noBackup: false, avoid: 0, prefer: 0 };
  return r;
}

// explicitListMonths -> { 'YYYY-MM': roleMask }. A string entry governs both
// roles; { month, roles } governs only the listed roles.
function rdGovernedMonths(list) {
  var out = Object.create(null);
  (list || []).forEach(function (e) {
    if (typeof e === "string") out[e] = (out[e] || 0) | RD_MASK.any;
    else if (e && typeof e === "object" && e.month) {
      var roles = Array.isArray(e.roles) && e.roles.length ? e.roles : ["primary", "backup"];
      roles.forEach(function (r) { out[e.month] = (out[e.month] || 0) | (RD_MASK[r] || 0); });
    }
  });
  return out;
}

// eastBusyDays[id] -> Set of date strings. Accepts an array, a Set, a
// { date: truthy } map or deriveKhanBusyDays()'s { busy, reasons } object; any
// non-date key is dropped with a ctx warning instead of silently becoming a
// never-matching "day" (which would make the surgeon never East-busy).
function rdBusySet(ctx, id, v) {
  if (!v) return new Set();
  if (typeof v === "object" && !(v instanceof Set) && !Array.isArray(v) && v.busy) v = v.busy;
  var out = new Set(), bad = [];
  rdToSet(v).forEach(function (d) {
    if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) out.add(d); else bad.push(String(d));
  });
  if (bad.length) ctx.warnings.push("eastBusyDays[" + id + "]: ignored " + bad.length + " non-date key(s) [" + bad.slice(0, 3).join(", ") + "] - pass date strings or the { busy } object from deriveKhanBusyDays");
  return out;
}

// buildContext(input) -> ctx. See the file header and the docs for the input
// shape. Everything per surgeon is precomputed once here so eligibility() is
// O(1)-ish per call.
function buildContext(input) {
  input = input || {};
  var roster = input.roster || [];
  var surgeonRules = input.surgeonRules || {};
  var groupRules = input.groupRules || {};
  var weights = Object.assign(defaultWeights(), groupRules.weights || {});
  var holidaysIn = input.holidays || {};
  var weekendDays = (groupRules.weekendUnit && groupRules.weekendUnit.days) || ["Fri", "Sat", "Sun"];
  var schedule = rdNormalizeSchedule(input.schedule || {});
  var dayBefore = groupRules.dayBeforeRules || {};
  var forecastThreshold = (groupRules.eastFeed && groupRules.eastFeed.forecast && groupRules.eastFeed.forecast.busyThreshold);
  if (typeof forecastThreshold !== "number") forecastThreshold = 0.5;

  var ctx = {
    roster: roster,
    rosterById: {},
    activeIds: [],
    allIds: [],
    surgeonRules: surgeonRules,
    groupRules: groupRules,
    weights: weights,
    weekendDays: weekendDays,
    holidays: holidaysIn,
    holidayFlags: groupRules.holidays || {},
    schedule: schedule,
    per: {},
    holidayByDay: Object.create(null),
    holidayUnitsAll: [],
    derivedByDay: Object.create(null),
    eastCoverage: null,
    forecastThreshold: forecastThreshold,
    trailingEdgeRoles: dayBefore.trailingEdgeRoles || ["primary"],
    aledoDayBeforeRoles: dayBefore.aledoDayBeforeRoles || ["primary"],
    countBackupInConsecutive: !!groupRules.countBackupInConsecutive,
    defaultMaxConsecutive: typeof groupRules.defaultMaxConsecutiveDays === "number" ? groupRules.defaultMaxConsecutiveDays : 2,
    defaultCap: (groupRules.defaultMonthlyCap && typeof groupRules.defaultMonthlyCap.total === "number") ? groupRules.defaultMonthlyCap.total : null,
    backupDistinct: groupRules.backupDistinctFromPrimary !== false,
    rangeStart: input.rangeStart || null,
    rangeEnd: input.rangeEnd || null,
    warnings: [],
    _memo: Object.create(null)
  };

  if (input.eastFeedCoverage && input.eastFeedCoverage.from && input.eastFeedCoverage.to) {
    ctx.eastCoverage = { from: input.eastFeedCoverage.from, to: input.eastFeedCoverage.to,
      fromN: rdInfo(input.eastFeedCoverage.from).n, toN: rdInfo(input.eastFeedCoverage.to).n };
  }

  // Holiday units: arbitrary sorted day lists, looked up by day across every year key.
  var unitsByYear = holidaysIn.units || {};
  Object.keys(unitsByYear).sort().forEach(function (yearKey) {
    (unitsByYear[yearKey] || []).forEach(function (u) {
      if (!u || !Array.isArray(u.days) || !u.days.length) return;
      var unit = { name: u.name, tier: u.tier || "major", year: yearKey, days: u.days.slice().sort() };
      ctx.holidayUnitsAll.push(unit);
      unit.days.forEach(function (d) { ctx.holidayByDay[d] = unit; });
    });
  });
  ctx.holidayUnitsAll.sort(function (a, b) { return a.days[0] < b.days[0] ? -1 : a.days[0] > b.days[0] ? 1 : 0; });

  // Roster.
  roster.forEach(function (r) {
    if (!r || !r.id) return;
    ctx.rosterById[r.id] = r;
    ctx.allIds.push(r.id);
    if (r.active !== false) ctx.activeIds.push(r.id);
  });

  // Per-surgeon precompute.
  ctx.allIds.forEach(function (id) {
    var r = ctx.rosterById[id];
    var rules = surgeonRules[id] || {};
    var ef = rules.eastFeed || {};
    var hr = rules.holidayRules || {};
    var P = {
      id: id,
      active: r.active !== false,
      activeFrom: r.activeFrom || null,
      activeTo: r.activeTo || null,
      rules: rules,
      mode: rules.availabilityMode || "",
      vacation: new Set(),
      dayBeforeVacation: new Set(),
      avail: Object.create(null),
      governedMonths: rdGovernedMonths(rules.explicitListMonths), // month -> role mask
      weekDays: new Set(),        // days inside rules.availableWeeks (Mon..Sun per listed Monday)
      weeksFromN: null,           // first day the weeks whitelist governs (day number)
      windowDays: new Set(),      // days inside rules.availableWindows
      hasWindows: !!(rules.availableWindows && rules.availableWindows.length),
      eastEnabled: !!ef.enabled,
      blocksPrimary: !!ef.eastBlocksPrimary,
      blocksBackup: !!ef.eastBlocksBackup,
      eastBusy: rdBusySet(ctx, id, input.eastBusyDays && input.eastBusyDays[id]),
      eastForecast: (input.eastForecast && input.eastForecast[id]) || null,
      derived: Object.create(null), // date -> forced Silvis role
      eastDays: new Set(),          // every day he holds ANY East call (busy days + derived weeks)
      capTotal: null,
      capPreferred: null,
      countsEastDays: false,
      maxConsec: typeof rules.maxConsecutiveDays === "number" ? rules.maxConsecutiveDays : ctx.defaultMaxConsecutive,
      holidaysOff: new Set(hr.holidaysOff || []),
      maxMajor: null,
      hardNever: new Set(rules.hardNeverWeekdays || []),
      hardNeverRoles: new Set(rules.hardNeverWeekdaysRoles || ["primary", "backup"]),
      weekendStyle: rules.weekendStyle || null
    };
    if (hr.neverThanksgiving) P.holidaysOff.add("Thanksgiving");
    if (typeof hr.maxMajorHolidays === "number") P.maxMajor = hr.maxMajorHolidays;
    else if (rules.preferences && typeof rules.preferences.maxMajorHolidays === "number") P.maxMajor = rules.preferences.maxMajorHolidays;

    // monthlyCap semantics: explicit null = no cap; absent = group default; object = its total.
    if (Object.prototype.hasOwnProperty.call(rules, "monthlyCap")) {
      var mc = rules.monthlyCap;
      if (mc === null) P.capTotal = null;
      else if (typeof mc === "number") P.capTotal = mc;
      else if (mc && typeof mc === "object") {
        P.capTotal = typeof mc.total === "number" ? mc.total : ctx.defaultCap;
        P.capPreferred = typeof mc.preferred === "number" ? mc.preferred : null;
        P.countsEastDays = !!mc.countsEastDays;
      }
    } else {
      P.capTotal = ctx.defaultCap;
    }

    // Whitelist of weeks (Philip): governs from the first day of the month of the
    // earliest listed Monday (or rules.availableWeeksFrom) onward; earlier months
    // fall back to explicit-list governance (explicitListMonths) or open rules.
    if (rules.availableWeeks && rules.availableWeeks.length) {
      var mondays = rules.availableWeeks.slice().sort();
      mondays.forEach(function (mon) { for (var k = 0; k < 7; k++) P.weekDays.add(rdAddDays(mon, k)); });
      var from = rules.availableWeeksFrom || (mondays[0].slice(0, 7) + "-01");
      P.weeksFromN = rdInfo(from).n;
    }
    if (P.hasWindows) {
      rules.availableWindows.forEach(function (w) { rdEachDayInRange(w.start, w.end, function (d) { P.windowDays.add(d); }); });
    }
    P.eastBusy.forEach(function (d) { P.eastDays.add(d); });
    ctx.per[id] = P;
  });

  // Time off (vacations only): the day itself and the trailing-edge day before it.
  (input.timeOffRows || []).forEach(function (row) {
    var P = ctx.per[row.person_id];
    if (!P || !row.start_date) return;
    var end = row.end_date || row.start_date;
    rdEachDayInRange(row.start_date, end, function (d) { P.vacation.add(d); });
  });
  ctx.allIds.forEach(function (id) {
    var P = ctx.per[id];
    P.vacation.forEach(function (d) {
      var before = rdAddDays(d, -1);
      if (!P.vacation.has(before)) P.dayBeforeVacation.add(before);
    });
  });

  // Dated availability rows.
  (input.availabilityRows || []).forEach(function (row) {
    var P = ctx.per[row.person_id];
    if (!P || !row.start_date) return;
    var mask = RD_MASK[row.role || "any"] || 3;
    var kind = row.kind;
    var end = row.end_date || row.start_date;
    rdEachDayInRange(row.start_date, end, function (d) {
      var rec = rdAvailRec(P.avail, d);
      if (kind === "available") rec.avail |= mask;
      else if (kind === "unavailable") rec.unavail |= mask;
      else if (kind === "backup_only") { rec.backupOnly = true; rec.avail |= RD_MASK.backup; }
      else if (kind === "no_backup") rec.noBackup = true;
      else if (kind === "avoid") rec.avoid = Math.max(rec.avoid, resolveWeight(ctx, row.weight || "medium"));
      else if (kind === "prefer") rec.prefer = Math.min(rec.prefer, typeof row.weight === "number" ? row.weight : weights.preferred);
    });
  });

  // Derived (East) weeks -> forced Silvis role per day, from deriveFrom onward.
  (input.eastDerived || []).forEach(function (w, idx) {
    if (!w || !w.surgeonId || !w.weekMonday || !w.silvisRole) {
      ctx.warnings.push("eastDerived[" + idx + "]: dropped - needs surgeonId + weekMonday + silvisRole (got " + JSON.stringify(w) + "); attach the roster id resolved by code before calling buildContext");
      return;
    }
    var P = ctx.per[w.surgeonId];
    if (!P) { ctx.warnings.push("eastDerived[" + idx + "]: dropped - unknown surgeonId " + w.surgeonId); return; }
    var ef = P.rules.eastFeed || {};
    var fromN = ef.deriveFrom ? rdInfo(ef.deriveFrom).n : -Infinity;
    for (var k = 0; k < 7; k++) {
      var d = rdAddDays(w.weekMonday, k);
      P.eastDays.add(d); // he is on East call (primary or backup) all week either way
      if (rdInfo(d).n < fromN) continue;
      P.derived[d] = w.silvisRole;
      var slot = ctx.derivedByDay[d] || (ctx.derivedByDay[d] = {});
      slot[w.silvisRole] = w.surgeonId;
    }
  });

  return ctx;
}

/* ------------------------------------------------------------ helpers */

function rdIsWeekendDay(ctx, info) { return ctx.weekendDays.indexOf(info.wd) >= 0; }

function rdRecurringMatches(list, dateStr) {
  if (!list || !list.length) return null;
  for (var k = 0; k < list.length; k++) if (matchesPattern(dateStr, list[k])) return list[k];
  return null;
}

function rdIsAledoDay(rules, dateStr) {
  var a = rules.aledo;
  if (!a || !a.weekdays) return false;
  return !!rdRecurringMatches(a.weekdays, dateStr);
}

function rdWeekHasAledo(rules, mondayStr) {
  for (var k = 0; k < 7; k++) if (rdIsAledoDay(rules, rdAddDays(mondayStr, k))) return true;
  return false;
}

function rdEastCovered(ctx, P, info) {
  if (P.eastBusy.has(info.s)) return true;
  if (P.eastForecast && P.eastForecast[info.s] != null) return true;
  if (!ctx.eastCoverage) return false;
  return info.n >= ctx.eastCoverage.fromN && info.n <= ctx.eastCoverage.toN;
}

// Was the derived lock for (date, role) overridden by an import/manual lock on
// another surgeon? (import/manual locks beat derived locks, with a warning)
function rdDerivedOverridden(ctx, date, role, id) {
  var e = ctx.schedule[date];
  if (!e) return false;
  return !!(e[role + "Locked"] && e[role] && e[role] !== id);
}

// The weekday-pattern family for one (surgeon, date, role): recurring blacklist,
// weekday allow-list, the outside-derived-weeks pattern and the Aledo rules.
// rowAvail = an explicit dated available/backup_only row covers this role today;
// per groupRules.availabilityPrecedence it lifts every HARD rule in this family
// (soft preferences still apply). hardNeverWeekdays is the caller's and is never
// lifted. Called from the static layer outside derived weeks and from the
// dynamic layer when a derived lock has been overridden.
function rdPatternRules(ctx, P, info, role, asBlock, rowAvail, hard, soft) {
  var rules = P.rules, W = ctx.weights, date = info.s;
  var ru = rdRecurringMatches(rules.recurringUnavailable, date);
  if (ru && !rowAvail) hard.push("recurring-unavailable:" + info.wd);
  var ra = rdRecurringMatches(rules.recurringAvoid, date);
  if (ra) soft.push({ reason: "recurring-avoid:" + info.wd, weight: resolveWeight(ctx, ra.weight || "medium") });

  // Weekday allow-list (Khan): Mon-Thu only via the list; weekend days are pool days.
  if (rules.weekdays && Array.isArray(rules.weekdays.allowed) && !rdIsWeekendDay(ctx, info)) {
    if (rules.weekdays.allowed.indexOf(info.wd) < 0) {
      if (!P.hardNever.has(info.wd) && !rowAvail) hard.push("weekday-not-allowed:" + info.wd);
    } else if (rules.weekdays.autoOffer !== false) {
      soft.push({ reason: "auto-offer-weekday", weight: W.noTargetWeekday });
    }
  }

  // Weekday pattern outside derived weeks (Fierce).
  var odw = rules.outsideDerivedWeeks;
  if (odw && odw.weekdayPattern) {
    var pd = odw.weekdayPattern[info.wd];
    var v = pd ? pd[role] : undefined;
    if (v === true) { if (pd.preferred) soft.push({ reason: "preferred", weight: W.preferred }); }
    else if (v === "weekend-block-only") { if (!asBlock && !rowAvail) hard.push("weekend-block-only"); }
    else if (!rowAvail) hard.push("weekday-pattern:" + info.wd);
  }

  // Aledo (Philip): hard day-before for the configured roles; strong soft on the whole week.
  var al = rules.aledo;
  if (al) {
    if (!rowAvail && al.hardAvoidDayBefore !== false && ctx.aledoDayBeforeRoles.indexOf(role) >= 0 && rdIsAledoDay(rules, rdAddDays(date, 1))) hard.push("day-before-aledo");
    if (al.avoidWholeWeek && rdWeekHasAledo(rules, info.monday)) soft.push({ reason: "aledo-week", weight: resolveWeight(ctx, al.avoidWholeWeek) });
  }
}

function rdMonthIndex(s) { var i = rdInfo(s); return i.y * 12 + i.m; }

/* ------------------------------------------------------- static layer */

function rdStatic(ctx, date, role, id, asBlock) {
  var key = id + "|" + role + "|" + date + (asBlock ? "|b" : "");
  var memo = ctx._memo[key];
  if (memo) return memo;

  var hard = [], soft = [];
  var W = ctx.weights;
  var P = ctx.per[id];
  var res = { hard: hard, soft: soft };
  if (!P) { hard.push("unknown-surgeon"); ctx._memo[key] = res; return res; }
  var info = rdInfo(date);
  var rules = P.rules;
  var mask = RD_MASK[role] || 0;

  if (!P.active || (P.activeFrom && date < P.activeFrom) || (P.activeTo && date > P.activeTo)) hard.push("inactive");

  // Holiday context.
  var hol = ctx.holidayByDay[date] || null;
  var HF = ctx.holidayFlags;
  var waive = !!(hol && HF.ignoreWeekdayRules !== false);
  var optedOut = !!(hol && P.holidaysOff.has(hol.name));
  if (optedOut) hard.push("holiday-opt-out:" + hol.name);
  var anyoneMay = !!(hol && HF.anyoneMayCoverUnlessOptedOut !== false && !optedOut);

  // Time off (vacations only). Trailing edge: the day before blocks PRIMARY only.
  if (P.vacation.has(date)) hard.push("time-off:" + date);
  else if (P.dayBeforeVacation.has(date) && ctx.trailingEdgeRoles.indexOf(role) >= 0) hard.push("day-before-vacation");

  // Dated availability rows (explicit statements - never waived).
  var rec = P.avail[date];
  var rowAvail = false;
  if (rec) {
    if (rec.unavail & mask) hard.push("unavailable-row");
    if (role === "backup" && rec.noBackup) hard.push("no-backup-row");
    if (role === "primary" && rec.backupOnly) hard.push("backup-only-row");
    if (rec.avoid) soft.push({ reason: "avoid-row", weight: rec.avoid });
    if (rec.prefer) soft.push({ reason: "prefer-row", weight: rec.prefer });
    rowAvail = !!(rec.avail & mask);
  }

  // East feed: busy days / forecast / unknown for the roles East blocks.
  if (P.eastEnabled && (role === "primary" ? P.blocksPrimary : P.blocksBackup)) {
    if (P.eastBusy.has(date)) hard.push("east-busy");
    else {
      var prob = P.eastForecast ? P.eastForecast[date] : undefined;
      if (typeof prob === "number") {
        if (prob >= ctx.forecastThreshold) hard.push("east-forecast-busy:" + prob.toFixed(2));
        else if (prob > 0) soft.push({ reason: "east-forecast:" + prob.toFixed(2), weight: W.eastForecastBelowThreshold });
      } else if (!rdEastCovered(ctx, P, info)) {
        soft.push({ reason: "east-unknown", weight: W.eastUnknown });
      }
    }
  }

  // Weekday-pattern family - waived on holiday-unit days (groupRules.holidays.ignoreWeekdayRules).
  // hardNeverWeekdays is the one member no explicit row lifts. Inside a derived
  // (East) week the derived lock governs instead, so the rest of the family is
  // deferred: eligibility() re-applies it when an import/manual lock overrides
  // that derived lock (res.patternDeferred + res.rowAvail carry what it needs).
  var notRecurring = false;
  var patternDeferred = false;
  if (!waive) {
    if (P.hardNever.has(info.wd) && P.hardNeverRoles.has(role)) hard.push("hard-never-weekday:" + info.wd);
    if (P.derived[date]) patternDeferred = true;
    else rdPatternRules(ctx, P, info, role, asBlock, rowAvail, hard, soft);
  }
  res.patternDeferred = patternDeferred;
  res.rowAvail = rowAvail;

  // Dated whitelists (governance is per role: a role-scoped explicit list governs only its roles).
  var datedBlock = null;
  var governed = !!((P.governedMonths[info.month] || 0) & mask);
  if (governed) {
    if (!rowAvail) datedBlock = "whitelist-month";
  } else if (P.mode === "whitelist-recurring" || (rules.recurringAvailable && rules.recurringAvailable.length)) {
    var wa = rules.weekendsAvailable;
    var weekendOk = rdIsWeekendDay(ctx, info) && wa && (wa === true || wa[role]);
    if (!(rowAvail || weekendOk || rdRecurringMatches(rules.recurringAvailable, date))) notRecurring = true;
  }
  if (P.weeksFromN !== null && info.n >= P.weeksFromN && !(P.weekDays.has(date) || rowAvail)) datedBlock = datedBlock || "outside-available-weeks";
  if (P.hasWindows && !(P.windowDays.has(date) || rowAvail)) hard.push("outside-window"); // still enforced on holidays

  if (notRecurring && !waive) hard.push("not-recurring-available");
  if (datedBlock) {
    if (anyoneMay) soft.push({ reason: "holiday-waiver:" + datedBlock, weight: W.medium });
    else hard.push(datedBlock);
  }

  ctx._memo[key] = res;
  return res;
}

/* ------------------------------------------------------ dynamic layer */

function rdAssumeMap(assume) {
  if (!assume || !assume.length) return null;
  var m = Object.create(null);
  for (var k = 0; k < assume.length; k++) {
    var a = assume[k];
    var d = Array.isArray(a) ? a[0] : a.date;
    var r = Array.isArray(a) ? a[1] : a.role;
    if (!d) continue;
    m[d] = (m[d] || 0) | (RD_MASK[r || "any"] || 3);
  }
  return m;
}

// eligibility(ctx, dateStr, role, surgeonId, opts?) -> { ok, hard:[string], soft:[{reason, weight}] }
//   plus lockHolder:true (and conflicts:[string]) when the surgeon holds the slot's lock.
// The returned arrays and soft entries are fresh copies: callers may mutate them.
// opts: { asBlockMember: bool, assume: [{date, role}], ignoreLocks: bool, skipPatternSoft: bool }
//   asBlockMember  - the caller is evaluating a full Fri+Sat+Sun block; relaxes only the
//                    'weekend-block-only' weekday-pattern rule.
//   assume         - other slots to count as held by this surgeon (unit / block members)
//                    for caps, consecutive runs and week counts.
//   ignoreLocks    - do not report 'slot-locked' for a slot locked to someone else.
//   skipPatternSoft - weekendUnitPatterns adds the style mismatch itself.
function eligibility(ctx, dateStr, role, surgeonId, opts) {
  opts = opts || {};
  if (role !== "primary" && role !== "backup") return { ok: false, hard: ["bad-role:" + role], soft: [] };
  var sched = ctx.schedule;
  var entry = sched[dateStr] || null;
  var hard = [], soft = [];

  // Day-level gates first (they describe the slot, not the surgeon):
  // external cover - the primary slot is covered by someone outside the roster;
  // slot locked to someone else (import / manual lock).
  if (role === "primary" && entry && entry.externalCover) hard.push("external-cover");
  if (!opts.ignoreLocks && entry && entry[role + "Locked"] && entry[role] && entry[role] !== surgeonId) hard.push("slot-locked:" + entry[role]);

  var st = rdStatic(ctx, dateStr, role, surgeonId, !!opts.asBlockMember);
  hard = hard.concat(st.hard);
  soft = soft.concat(st.soft.map(function (s) { return { reason: s.reason, weight: s.weight }; })); // copies: the memo's entries stay pristine
  var P = ctx.per[surgeonId];
  if (!P) return { ok: false, hard: hard, soft: soft };

  // Import/manual lock holder: the row is a fact. Every violated rule is still
  // collected (as `conflicts`) so the caller can warn, but the result is ok.
  var importHolder = !!(entry && entry[role + "Locked"] && entry[role] === surgeonId);
  function blockedResult() {
    if (importHolder) return { ok: true, hard: [], soft: soft, lockHolder: true, conflicts: hard };
    return { ok: false, hard: hard, soft: soft };
  }
  if (hard.length) return blockedResult();

  var W = ctx.weights;
  var info = rdInfo(dateStr);
  var rules = P.rules;
  var other = role === "primary" ? "backup" : "primary";
  var assumeMap = rdAssumeMap(opts.assume);

  // Derived (East) locks.
  var lockHolder = false;
  var dRole = P.derived[dateStr];
  if (dRole) {
    if (!rdDerivedOverridden(ctx, dateStr, dRole, surgeonId)) {
      if (dRole !== role) hard.push("derived-lock:" + dRole); else lockHolder = true;
    } else {
      // An import/manual lock overrode his derived slot. He is still on East call
      // that week: the ordinary weekday pattern applies to the role being asked
      // about, and an East PRIMARY week (derived Silvis backup) blocks Silvis
      // primary because the primary must be on site at Silvis.
      if (st.patternDeferred) rdPatternRules(ctx, P, info, role, !!opts.asBlockMember, st.rowAvail, hard, soft);
      if (dRole === "backup" && role === "primary" && ctx.groupRules.noOperatingElsewhereWhilePrimary !== false) hard.push("east-busy");
    }
  }
  var dslot = ctx.derivedByDay[dateStr];
  if (dslot && dslot[role] && dslot[role] !== surgeonId && !rdDerivedOverridden(ctx, dateStr, role, dslot[role])) hard.push("derived-lock-held:" + dslot[role]);

  // Already holds the other role that day.
  if (ctx.backupDistinct && entry && entry[other] === surgeonId) hard.push("holds-other-role");

  if (hard.length) return blockedResult();
  if (lockHolder) return { ok: true, hard: hard, soft: soft, lockHolder: true }; // derived lock: caps/consecutive/patterns do not apply

  // --- counting helpers (the evaluated slot counts as held; assume-slots too) ---
  function holdsRole(d, r) {
    if (d === dateStr && r === role) return true;
    var e = sched[d];
    if (e && e[r] === surgeonId) return true;
    if (assumeMap) { var a = assumeMap[d]; if (a && (a & RD_MASK[r])) return true; }
    return false;
  }
  function holdsAny(d) { return holdsRole(d, "primary") || holdsRole(d, "backup"); }

  // Monthly cap (distinct days with any Silvis call; Fierce also counts East days).
  var monthDays = rdMonthDays(info.month);
  var monthCount = 0;
  for (var i = 0; i < monthDays.length; i++) {
    var md = monthDays[i];
    if (holdsAny(md) || (P.countsEastDays && P.eastDays.has(md))) monthCount++;
  }
  if (P.capTotal !== null && monthCount > P.capTotal) hard.push("monthly-cap:" + P.capTotal);
  else if (P.capPreferred !== null && monthCount > P.capPreferred) soft.push({ reason: "over-preferred-cap:" + P.capPreferred, weight: W.medium });

  // Max consecutive days (primary-only unless groupRules.countBackupInConsecutive);
  // days inside one holiday unit count as one commitment when unitExemptFromMaxConsecutive.
  var countBackup = ctx.countBackupInConsecutive;
  if (role === "primary" || countBackup) {
    var unitExempt = ctx.holidayFlags.unitExemptFromMaxConsecutive !== false;
    var inRun = function (d) { return holdsRole(d, "primary") || (countBackup && holdsRole(d, "backup")); };
    var keyOf = function (d) { var u = unitExempt ? ctx.holidayByDay[d] : null; return u ? "H:" + u.name + ":" + u.days[0] : d; };
    var keys = {}; keys[keyOf(dateStr)] = true;
    var n = 1, d1, guard;
    for (d1 = rdAddDays(dateStr, -1), guard = 0; guard < 60 && inRun(d1); d1 = rdAddDays(d1, -1), guard++) { var k1 = keyOf(d1); if (!keys[k1]) { keys[k1] = true; n++; } }
    for (d1 = rdAddDays(dateStr, 1), guard = 0; guard < 60 && inRun(d1); d1 = rdAddDays(d1, 1), guard++) { var k2 = keyOf(d1); if (!keys[k2]) { keys[k2] = true; n++; } }
    if (n > P.maxConsec) hard.push("max-consecutive:" + P.maxConsec);
  }

  // Backup caps (Philip): days per month and weekends per month (a weekend counts once).
  var bc = rules.backupCap;
  if (role === "backup" && bc) {
    if (typeof bc.perMonthDays === "number") {
      var bcount = 0;
      for (var j = 0; j < monthDays.length; j++) if (holdsRole(monthDays[j], "backup")) bcount++;
      if (bcount > bc.perMonthDays) hard.push("backup-cap:" + bc.perMonthDays);
    }
    if (typeof bc.weekendsPerMonth === "number" && info.friday) {
      var wk = {}, wcount = 0;
      for (var q = 0; q < monthDays.length; q++) {
        var qi = rdInfo(monthDays[q]);
        if (qi.friday && holdsRole(qi.s, "backup") && !wk[qi.friday]) { wk[qi.friday] = true; wcount++; }
      }
      if (!wk[info.friday]) wcount++;
      if (wcount > bc.weekendsPerMonth) hard.push("backup-weekend-cap:" + bc.weekendsPerMonth);
    }
  }

  // Days per window week (Sarkar): max hard, min as a soft bonus while under it.
  var dp = rules.daysPerWindowWeek;
  if (dp) {
    var wcnt = 0;
    for (var w = 0; w < 7; w++) {
      var wd = rdAddDays(info.monday, w);
      if (dp.countsBackup === false ? holdsRole(wd, "primary") : holdsAny(wd)) wcnt++;
    }
    if (typeof dp.max === "number" && wcnt > dp.max) hard.push("window-week-max:" + dp.max);
    if (typeof dp.min === "number" && wcnt < dp.min) soft.push({ reason: "window-week-below-min:" + dp.min, weight: W.preferred });
  }

  // Handoff partner required (Sarkar): consecutive primary days hand off to herself.
  if (rules.handoffPartnerRequired && role === "primary" && (holdsRole(rdAddDays(dateStr, -1), "primary") || holdsRole(rdAddDays(dateStr, 1), "primary"))) {
    soft.push({ reason: "handoff-partner", weight: W.medium });
  }

  // Max major holidays: at most N major units within any 12 calendar-month span,
  // measured between unit START months and symmetric (a later held unit blocks an
  // earlier date too). The same holiday next year is 12 months away and never
  // counts (Thanksgiving 11/26 -> 11/25 = 12, Christmas -> Christmas = 12);
  // Christmas -> next Thanksgiving is 11 and does.
  var hol = ctx.holidayByDay[dateStr] || null;
  if (P.maxMajor !== null && hol && hol.tier === "major") {
    var majors = 1, holMonth = rdMonthIndex(hol.days[0]);
    for (var u = 0; u < ctx.holidayUnitsAll.length; u++) {
      var unit = ctx.holidayUnitsAll[u];
      if (unit === hol || unit.tier !== "major") continue;
      if (Math.abs(rdMonthIndex(unit.days[0]) - holMonth) >= 12) continue;
      for (var ud = 0; ud < unit.days.length; ud++) if (holdsAny(unit.days[ud])) { majors++; break; }
    }
    if (majors > P.maxMajor) hard.push("max-major-holidays:" + P.maxMajor);
  }

  if (hard.length) return blockedResult();

  // --- schedule-shape soft penalties ---
  if (role === "backup" && W.backupAfterPrimary && holdsRole(rdAddDays(dateStr, -1), "primary")) soft.push({ reason: "backup-after-primary", weight: W.backupAfterPrimary });

  if (info.friday) {
    var b2b = false;
    for (var s = -7; s <= 7 && !b2b; s += 14) for (var t = 0; t < 3; t++) if (holdsAny(rdAddDays(info.friday, s + t))) { b2b = true; break; }
    if (b2b && W.backToBackWeekend) soft.push({ reason: "back-to-back-weekend", weight: W.backToBackWeekend });

    if (!opts.skipPatternSoft && !opts.asBlockMember && P.weekendStyle && W.patternMismatch) {
      var fri = info.friday, sat = rdAddDays(fri, 1), sun = rdAddDays(fri, 2);
      var mismatch = false;
      if (P.weekendStyle === "block") {
        var others = [fri, sat, sun].filter(function (x) { return x !== dateStr; });
        mismatch = !(holdsRole(others[0], role) && holdsRole(others[1], role));
      } else if (P.weekendStyle === "split") {
        mismatch = info.wd === "Sat" ? (holdsRole(fri, role) || holdsRole(sun, role)) : holdsRole(sat, role);
      }
      if (mismatch) soft.push({ reason: "pattern-mismatch:" + P.weekendStyle, weight: W.patternMismatch });
    }
  }

  if (typeof rules.monthlyTarget === "number") {
    if (monthCount > rules.monthlyTarget) soft.push({ reason: "over-target:" + (monthCount - rules.monthlyTarget), weight: W.low * (monthCount - rules.monthlyTarget) });
    else if (monthCount < rules.monthlyTarget) soft.push({ reason: "under-target", weight: W.preferred });
  }

  if (importHolder) return { ok: true, hard: hard, soft: soft, lockHolder: true, conflicts: [] };
  return { ok: true, hard: hard, soft: soft };
}

/* ---------------------------------------------------------- weekends */

function rdSoftSum(r) { var s = 0; for (var k = 0; k < r.soft.length; k++) s += r.soft[k].weight; return s; }

// weekendUnitPatterns(ctx, fridayStr, role = 'primary', daysPresent = null)
//   -> [{ kind:'block'|'split'|'daily', members:{fri,sat,sun}, penalty, fallback, surgeons }]
// sorted by penalty. daysPresent (array of date strings) restricts the unit to
// the days a holiday unit did not pre-empt; a reduced unit offers block(remaining)
// and daily only. Block members are evaluated with asBlockMember only for a full
// three-day block. Style mismatches add weights.patternMismatch once per surgeon.
function weekendUnitPatterns(ctx, fridayStr, role, daysPresent) {
  role = role || "primary";
  if (rdWeekday(fridayStr) !== "Fri") throw new Error("weekendUnitPatterns: " + fridayStr + " is not a Friday");
  var W = ctx.weights;
  var fri = fridayStr, sat = rdAddDays(fri, 1), sun = rdAddDays(fri, 2);
  var all = [fri, sat, sun];
  var present = daysPresent ? all.filter(function (d) { return daysPresent.indexOf(d) >= 0; }) : all;
  if (!present.length) return [];
  var full = present.length === 3;
  var ids = ctx.activeIds;
  var out = [];

  function members(map) { return { fri: map[fri] || null, sat: map[sat] || null, sun: map[sun] || null }; }
  function styleOf(id) { return ctx.per[id].weekendStyle; }
  function assumeFor(days, skip) { return days.filter(function (d) { return d !== skip; }).map(function (d) { return { date: d, role: role }; }); }

  // Solo eligibility per surgeon per day (daily / split-Sat members).
  var solo = {};
  ids.forEach(function (id) {
    solo[id] = {};
    present.forEach(function (d) { solo[id][d] = eligibility(ctx, d, role, id, { skipPatternSoft: true }); });
  });

  // Block: one surgeon on every present day.
  ids.forEach(function (id) {
    var style = styleOf(id);
    if (style === "saturday-only" && !(present.length === 1 && present[0] === sat)) return;
    var pen = 0, map = {};
    for (var k = 0; k < present.length; k++) {
      var r = eligibility(ctx, present[k], role, id, { asBlockMember: full, assume: assumeFor(present, present[k]), skipPatternSoft: true });
      if (!r.ok) return;
      pen += rdSoftSum(r);
      map[present[k]] = id;
    }
    if (present.length > 1 ? style !== "block" : style === "block") pen += W.patternMismatch;
    out.push({ kind: "block", members: members(map), penalty: pen, fallback: false, surgeons: [id] });
  });

  // Split: X on Fri+Sun, Y on Sat (full units only).
  if (full) {
    ids.forEach(function (x) {
      var sx = styleOf(x);
      if (sx === "saturday-only") return;
      var rf = eligibility(ctx, fri, role, x, { assume: [{ date: sun, role: role }], skipPatternSoft: true });
      if (!rf.ok) return;
      var rs = eligibility(ctx, sun, role, x, { assume: [{ date: fri, role: role }], skipPatternSoft: true });
      if (!rs.ok) return;
      var penX = rdSoftSum(rf) + rdSoftSum(rs) + (sx === "split" ? 0 : W.patternMismatch);
      ids.forEach(function (y) {
        if (y === x || !solo[y][sat].ok) return;
        var sy = styleOf(y);
        var pen = penX + rdSoftSum(solo[y][sat]) + ((sy === "split" || sy === "saturday-only") ? 0 : W.patternMismatch);
        var map = {}; map[fri] = x; map[sun] = x; map[sat] = y;
        out.push({ kind: "split", members: members(map), penalty: pen, fallback: false, surgeons: [x, y] });
      });
    });
  }

  // Daily: independent days (fallback). Shapes already covered by block/split are skipped.
  var cands = present.map(function (d) { return ids.filter(function (id) { return solo[id][d].ok; }); });
  function memberPen(id, d) {
    var s = styleOf(id);
    if (s === "block") return W.patternMismatch;
    if (s === "split" || s === "saturday-only") return d === sat ? 0 : W.patternMismatch;
    return 0;
  }
  (function rec(idx, map, chosen) {
    if (idx === present.length) {
      var distinct = chosen.filter(function (v, i, a) { return a.indexOf(v) === i; });
      if (present.length > 1 && distinct.length === 1) return;                    // == block
      if (full && distinct.length === 2 && chosen[0] === chosen[2]) return;        // == split
      var pen = W.patternDaily;
      for (var k = 0; k < present.length; k++) {
        var d = present[k], id = chosen[k];
        var repeats = chosen.filter(function (c) { return c === id; }).length > 1;
        var r = repeats
          ? eligibility(ctx, d, role, id, { assume: present.filter(function (x, i) { return x !== d && chosen[i] === id; }).map(function (x) { return { date: x, role: role }; }), skipPatternSoft: true })
          : solo[id][d];
        if (!r.ok) return;
        pen += rdSoftSum(r) + memberPen(id, d);
      }
      out.push({ kind: "daily", members: members(map), penalty: pen, fallback: true, surgeons: distinct });
      return;
    }
    var d0 = present[idx];
    for (var c = 0; c < cands[idx].length; c++) {
      var id0 = cands[idx][c];
      if (styleOf(id0) === "saturday-only" && d0 !== sat) continue;
      map[d0] = id0; chosen.push(id0);
      rec(idx + 1, map, chosen);
      chosen.pop(); delete map[d0];
    }
  })(0, {}, []);

  out.sort(function (a, b) { return a.penalty - b.penalty; });
  return out;
}

/* ---------------------------------------------------------- holidays */

function isHolidayDay(ctx, dateStr) { return ctx.holidayByDay[dateStr] || null; }

// Units with ANY day inside [startDate, endDate], across all year keys, sorted.
function holidayUnits(ctx, startDate, endDate) {
  return ctx.holidayUnitsAll.filter(function (u) {
    for (var k = 0; k < u.days.length; k++) if (u.days[k] >= startDate && u.days[k] <= endDate) return true;
    return false;
  });
}

// Surgeon ids eligible for EVERY day of the unit in that role (the other unit
// days are assumed held, so caps and consecutive runs see the whole unit). A
// locked holder on any unit day is the only candidate for that role.
function holidayUnitCandidates(ctx, unit, role) {
  role = role || "primary";
  return ctx.activeIds.filter(function (id) {
    for (var k = 0; k < unit.days.length; k++) {
      var d = unit.days[k];
      var r = eligibility(ctx, d, role, id, { assume: unit.days.filter(function (x) { return x !== d; }).map(function (x) { return { date: x, role: role }; }) });
      if (!r.ok) return false;
    }
    return true;
  });
}

/* ----------------------------------------------------------- tallies */

// talliesFor(ctx, surgeonId, 'YYYY-MM') -> { primary, backup, total, weekendDays,
// majorHolidays, minorHolidays, maxConsecutive } read live from ctx.schedule.
function talliesFor(ctx, surgeonId, month) {
  var days = rdMonthDays(month), sched = ctx.schedule;
  var t = { primary: 0, backup: 0, total: 0, weekendDays: 0, majorHolidays: 0, minorHolidays: 0, maxConsecutive: 0 };
  var units = {}, run = 0, runKeys = {};
  var countBackup = ctx.countBackupInConsecutive;
  var unitExempt = ctx.holidayFlags.unitExemptFromMaxConsecutive !== false;
  for (var i = 0; i < days.length; i++) {
    var d = days[i], e = sched[d], info = rdInfo(d);
    var isP = !!(e && e.primary === surgeonId), isB = !!(e && e.backup === surgeonId);
    if (isP) t.primary++;
    if (isB) t.backup++;
    if (isP || isB) {
      t.total++;
      if (rdIsWeekendDay(ctx, info)) t.weekendDays++;
      var u = ctx.holidayByDay[d];
      if (u) { var uk = u.name + ":" + u.days[0]; if (!units[uk]) { units[uk] = true; if (u.tier === "major") t.majorHolidays++; else t.minorHolidays++; } }
    }
    var counts = isP || (countBackup && isB);
    if (counts) {
      var hu = unitExempt ? ctx.holidayByDay[d] : null;
      var key = hu ? "H:" + hu.name + ":" + hu.days[0] : d;
      if (!runKeys[key]) { runKeys[key] = true; run++; }
      if (run > t.maxConsecutive) t.maxConsecutive = run;
    } else { run = 0; runKeys = {}; }
  }
  return t;
}

// monthlyCapFor(ctx, surgeonId) -> { total: number|null, preferred: number|null }
function monthlyCapFor(ctx, surgeonId) {
  var P = ctx.per[surgeonId];
  return P ? { total: P.capTotal, preferred: P.capPreferred } : { total: null, preferred: null };
}

if (typeof module !== "undefined") {
  module.exports = {
    matchesPattern: matchesPattern,
    buildContext: buildContext,
    eligibility: eligibility,
    weekendUnitPatterns: weekendUnitPatterns,
    holidayUnits: holidayUnits,
    holidayUnitCandidates: holidayUnitCandidates,
    isHolidayDay: isHolidayDay,
    resolveWeight: resolveWeight,
    defaultWeights: defaultWeights,
    talliesFor: talliesFor,
    monthlyCapFor: monthlyCapFor,
    rdFmt: rdFmt,
    rdParse: rdParse,
    rdAddDays: rdAddDays,
    rdWeekday: rdWeekday,
    rdDaysBetween: rdDaysBetween
  };
}
