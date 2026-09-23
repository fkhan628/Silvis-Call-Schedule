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
//   surgeonRules[id].eastStanding  [{ name, days: ['MM-DD'] }] (Prompt 12 V,
//                 9/22 evening) - standing East call in EVERY year (Khan:
//                 Christmas 12-24 + 12-25), treated like a published busy day:
//                 the same hard 'east-busy' for the roles East blocks, ahead of
//                 the forecast and of east-unknown; ignored with a warning
//                 unless eastFeed.enabled blocks a role (eastBlocksPrimary /
//                 eastBlocksBackup); standingEastDays(ctx, id, from, to)
//                 lists the concrete days of a range.
//   eastOverrides { [surgeonId]: { 'YYYY-MM-DD': true | false } } - the
//                 east_overrides rows grouped per person (east-feed.js
//                 overridesByPerson). Prompt 12 C (9/22): precedence is
//                 published > override > forecast. true = 'east-busy' that day
//                 whatever the feed or forecast says; false = the day is clear -
//                 it is removed from the busy set AND the forecast is not
//                 consulted for it (a busy:false override clears a forecast-busy
//                 day). Either value counts as a known answer (no east-unknown).
//                 Non-date keys / non-boolean values are dropped with a warning.
//                 applyOverrides on the busy set (older callers) still works.
//   eastForecast  { [surgeonId]: { 'YYYY-MM-DD': probability } } - consulted
//                 only OUTSIDE the published coverage (eastFeedCoverage); inside
//                 it published rows win and the forecast is ignored entirely.
//   surgeonRules[id].explicitListMonths  ['YYYY-MM', ...] or { month, roles }.
//                 The role scope is read literally (Prompt 12 I + T, 9/22): a
//                 plain 'YYYY-MM' entry governs PRIMARY only (backup is open to
//                 everyone; under backupPolicy.openToEveryone false it governs
//                 both roles again), an object entry governs exactly the roles
//                 it names - { month, roles: ['primary', 'backup'] } restricts
//                 both, the form the seed writes for a list the office has
//                 published (Burchett's and Acton's November, T).
//   eastVacationRanges { [surgeonId]: [{ start, end }] } (Prompt 15 part 2,
//                 9/23) - the person's Davenport VACATIONS from the east_feed
//                 cache (east-feed.js eastVacations(rows, code)), keyed by the
//                 roster id the caller resolves from the East CODE (never a
//                 Davenport id). Ignored with a warning for an unknown id, an
//                 outside surgeon or a surgeon whose eastFeed feature is off.
//   eastVacationReviews  [{ person_id, start, end, decision }] - the
//                 east_vacation_reviews rows. A range with no row that matches
//                 it exactly (same person, start and end) is UNREVIEWED; a row
//                 decides 'away' or 'home' (rdEastReviewState over the rows
//                 filtered to this person mirrors helpers.js
//                 reviewStateFor(range, rows, personId); a test pins them equal).
//                 unreviewed and away -> a DERIVED vacation: every day of the
//                 range joins P.vacation exactly like a time_off row (both
//                 roles, the trailing edge for primary; the same hard codes
//                 'time-off:<date>' / 'day-before-vacation', so every consumer
//                 already understands them) and the result carries
//                 res.eastVacation = 'away' | 'unreviewed' for the UI gloss. A
//                 Silvis time_off day inside the range stands as the Silvis
//                 vacation (no gloss). home -> NOT a vacation: the day is
//                 eastClear - read as a dated availability for both roles
//                 (rowAvail: the weekday-pattern family incl. hardNeverWeekdays
//                 is lifted, obligations are not), known to East (no
//                 east-unknown; the forecast is not consulted - a Davenport
//                 vacation is Davenport's own statement he is off; a forecast
//                 value at or over the threshold there is a warning) and a
//                 small PRIMARY-only soft bonus { east-clear, -weights.eastClear }
//                 (default 2, Setup-editable); res.eastClear = true. On a home
//                 day the East feed cannot also say busy: if the data disagree
//                 the feed (published busy day, standing day, busy:true
//                 override) wins - no east-clear that day, one ctx warning per
//                 surgeon naming the days. Nothing here writes time_off rows.
//                 ctx.eastVacations[id] = { ranges, vacationDays, clearDays,
//                 feedBusyOnHome } is the derived picture for the UI and the
//                 generator's diagnostics. eastVacationConflicts(ctx, schedule)
//                 mirrors the time_off trigger for the derived ranges (a held
//                 day inside an unreviewed/away range, and the day before it
//                 for primary) - a report, never a block on a published lock.
//   surgeonRules[id].backupOptOut  true -> hard 'backup-opt-out' on every
//                 backup slot, holiday units included; never waived, no dated
//                 row lifts it (Faraz 9/22; nobody has opted out).
//   surgeonRules[id].hardNeverWeekdaysRoles  default ['primary'] (9/22); an
//                 empty list reads as the default.
//   Row precedence (Prompt 12 W, Faraz 9/22 evening - "own dates beat own
//                 patterns"): an explicit dated available / backup_only row for
//                 a role lifts every WEEKDAY-PATTERN rule for that date and
//                 role - hardNeverWeekdays included (it moved out of the
//                 never-lifted gates) - and never lifts an obligation: time off
//                 and its trailing edge, East busy / forecast-busy days,
//                 derived-week locks, availableWindows (moved INTO the
//                 never-lifted gates: a row outside a window opens nothing),
//                 backupOptOut, caps, consecutive limits, the other role. A
//                 manual/import lock is not a row: a lock holder on a pattern
//                 day keeps the lock with the rule listed in `conflicts`.
//   offers / periods (Prompt 14 P2, 9/23 - offers first, rules as the fallback):
//                 offers  = call_offers rows { person_id, day, role_pref
//                 primary|backup|either, source, entered_by, note }; periods =
//                 call_periods rows { id, label, start_day, end_day,
//                 offers_close_at, publish_by, status, rules_only_ids,
//                 offer_modes }. Per surgeon per period the STATUS is derived
//                 exactly like SQL offer_status(): 'submitted' when >= 1 offer
//                 lies inside [start_day, end_day], else 'rules_only' when the
//                 id is in rules_only_ids, else 'not_started'; the MODE is
//                 offer_modes[id] ('exhaustive' | 'preferred'), absent =
//                 'preferred'. Inside a period a SUBMITTED surgeon is
//                 offers-governed: exhaustive -> hard 'not-offered' on any
//                 day/role he did not offer ('either' = both roles); preferred
//                 -> soft 'offered' (-weights.offerBonus) on an offered day and
//                 soft 'outside-offers' (+weights.outsideOffers) on any other
//                 day, which stays eligible under his ORDINARY rules (weekday
//                 patterns, recurring lists, Aledo, caps, runs...). The
//                 'offered' bonus is emitted in BOTH modes (so an offered day
//                 beats a rules-only candidate whatever hardness he chose; the
//                 generator tapers it at his share - weights.offerBonusOverShare),
//                 and 'outside-offers' is pushed on every non-offered day of a
//                 submitted surgeon in both modes too: in exhaustive mode the
//                 day is also the hard 'not-offered', so the soft surfaces only
//                 on a claim result (opts.claim) and names the day as outside
//                 his offers for the open-shifts board. Every
//                 offer is folded into P.avail as a dated available row for
//                 its role (item W: it lifts the weekday-pattern family incl.
//                 hardNeverWeekdays for that date and role; obligations never
//                 lift) - one code path decides. The dated lists
//                 (whitelist-month, outside-available-weeks) are NOT applied
//                 to a submitted surgeon inside the period (offers supersede
//                 them); for rules_only / not_started surgeons, and on any day
//                 outside every period, today's rules apply byte for byte.
//                 opts.claim (a Prompt 13 claim = an offer made on the spot)
//                 skips the exhaustive 'not-offered' only. offerState(ctx,
//                 day, id) / offeredOn(ctx, day, role, id) expose the facts;
//                 malformed rows and periods warn and are dropped (fail
//                 closed: a dropped offer never widens anyone's days).
//   groupRules.backupPolicy.openToEveryone  the 9/22 switch (absent = true);
//                 false restores the pre-9/22 both-roles reading of the rules
//                 listed below (explicit per-surgeon data is honoured either way).
//   surgeonRules[id].daysPerWindowWeek  { target, countsBackup } (Prompt 12 N,
//                 9/22 evening): a SOFT target of `target` PRIMARY days per
//                 Mon-Sun window week (countsBackup true counts either role);
//                 a placement at or under the target (0 or 1 other primaries
//                 held for target 2) -> 'window-week-below-target:<t>' at
//                 -weights.medium, over -> 'window-week-over-target:<t>' at
//                 weights.medium per day over. There is no hard window-week
//                 min/max: the pre-N keys min / max / minIsSoft are ignored
//                 with one ctx warning.
//   surgeonRules[id].preferAlternateDays  true -> soft 'consecutive-primary'
//                 (weights.medium) on a primary whose day before or after is
//                 his/her own primary (replaces the old handoff-partner soft).
//   surgeonRules[id].weekendBlockPenalty  a weight ('strong' | number): added
//                 by weekendUnitPatterns to every multi-day block and every
//                 split membership of that surgeon (a weekend day stays
//                 available as a standalone day in a daily pattern).
//   surgeonRules[id].weekendStyle 'daily'  a standalone weekend day is the
//                 normal pattern (memberPen 0); 'saturday-only' (older blobs)
//                 still means Saturday member of a split / daily only.
//   surgeonRules[id].handoffPartnerRequired  a DIAGNOSTICS flag the generator
//                 reads (diagnostics.handoffGaps); no eligibility effect.
//   surgeonRules[id].primaryContribution 'weekends'  (Prompt 12 L, 9/22; Khan)
//                 with groupRules.weights.weekendContribution (3 = medium; 0
//                 switches it off): a Fri/Sat/Sun PRIMARY evaluated as a member
//                 of a full Fri+Sat+Sun block (opts.asBlockMember) -> soft
//                 'weekend-primary' at -weekendContribution per day; a Fri/Sat/Sun
//                 BACKUP -> soft 'weekend-backup' at +weekendContribution per day.
//                 weekendUnitPatterns (which evaluates with skipPatternSoft) adds
//                 ONE unit-level term instead: -weekendContribution on his full
//                 primary block, +weekendContribution per membership of his in a
//                 backup pattern - so when East allows he is the weekend primary
//                 and someone else backs him up. Holiday units are not weekend
//                 units: no term on a holiday-unit day, no block bonus on a weekend
//                 a unit pre-empts (reduced). Any other value warns once.
//
// Backup is open to everyone (Faraz 9/22, rules doc section 1 "Roles per day"):
// outreach days, OR days, Clinton/Aledo days, the recurring whitelist, governed
// months and the weeks whitelist restrict PRIMARY only. Still blocking backup:
// vacations, holiday opt-outs, explicit unavailable / no_backup rows, derived
// East locks, the other role the same day, backup caps, Sarkar's windows and an
// explicit backupOptOut. Fierce's outsideDerivedWeeks pattern stays per-role
// data (the seed says backup:true on every weekday).
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
    noTargetWeekday: 1, eastUnknown: 1, eastForecastBelowThreshold: 2, smoothingTolerance: 2,
    longRunPerDay: 3, // Prompt 12 A (9/22): per day beyond surgeonRules.<id>.maxConsecutiveAnyRole (= medium)
    weekendContribution: 3, // Prompt 12 L (9/22): primaryContribution "weekends" - full-block primary bonus / weekend backup penalty (= medium)
    eastClear: 2, // Prompt 15 part 2 (9/23): PRIMARY bonus on a 'home' East vacation day (no East call, no OR block); 0 switches it off
    offerBonus: 6,     // Prompt 14 P2 (9/23): soft 'offered' bonus on a submitted surgeon's offered day (strong; 0 = off)
    outsideOffers: 6,  // Prompt 14 P2 (9/23): soft 'outside-offers' penalty on a submitted surgeon's non-offered day - preferred mode, and an exhaustive surgeon's claim result (strong; 0 = off)
    offerBonusOverShare: 0 // Prompt 14 P2 review (9/23): what the 'offered' bonus reads in the GENERATOR once the placement no longer brings him towards his share for the role and month (0 = the bonus stops at the share; = offerBonus restores the untapered reading). rules.js itself always emits -offerBonus.
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

// explicitListMonths -> { 'YYYY-MM': roleMask }. A string entry governs the
// roles of `stringMask` (buildContext passes primary only while backup is open
// to everyone, both roles under the closed policy); { month, roles } governs
// exactly the listed roles whatever the policy (an object without roles = both).
function rdGovernedMonths(list, stringMask) {
  var out = Object.create(null);
  var sm = typeof stringMask === "number" ? stringMask : RD_MASK.any;
  (list || []).forEach(function (e) {
    if (typeof e === "string") out[e] = (out[e] || 0) | sm;
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

// eastOverrides[id] -> { 'YYYY-MM-DD': true | false }. Non-date keys and
// non-boolean values are dropped with ONE ctx warning per surgeon (an override
// that silently did nothing would be the worst outcome - Prompt 12 C, 9/22).
function rdOverrideMap(ctx, id, v) {
  var out = Object.create(null);
  if (!v || typeof v !== "object") return out;
  var bad = [];
  Object.keys(v).forEach(function (d) {
    if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && typeof v[d] === "boolean") out[d] = v[d];
    else bad.push(d + "=" + JSON.stringify(v[d]));
  });
  if (bad.length) ctx.warnings.push("eastOverrides[" + id + "]: ignored " + bad.length + " entr" + (bad.length === 1 ? "y" : "ies") + " [" + bad.slice(0, 3).join(", ") + "] - pass { 'YYYY-MM-DD': true|false } (east-feed.js overridesByPerson)");
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
  // 9/22 doctrine switch (groupRules.backupPolicy.openToEveryone; absent = open).
  // false restores the pre-9/22 reading: the weekday-pattern family, the dated
  // whitelists, the Aledo week and the hardNeverWeekdays default govern BOTH roles.
  var backupOpen = !(groupRules.backupPolicy && groupRules.backupPolicy.openToEveryone === false);
  // 9/22 (Prompt 12 K): the group default cap is on PRIMARY days per month
  // (groupRules.defaultMonthlyCap.primary). The pre-K key 'total' is read as an
  // alias (one warning) so an older blob keeps its cap until Setup rewrites it.
  var dmc = groupRules.defaultMonthlyCap;
  var defaultCap = null, defaultCapLegacy = false;
  if (dmc && typeof dmc.primary === "number") defaultCap = dmc.primary;
  else if (dmc && typeof dmc.total === "number") { defaultCap = dmc.total; defaultCapLegacy = true; }

  var ctx = {
    roster: roster,
    rosterById: {},
    activeIds: [],
    allIds: [],
    externalIds: [],   // active roster entries of type "external" (Prompt 12 M): hand-written only, never in activeIds
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
    defaultCap: defaultCap,        // PRIMARY days per month for a surgeon without a monthlyCap key (null = none)
    backupDistinct: groupRules.backupDistinctFromPrimary !== false,
    backupOpen: backupOpen,
    rangeStart: input.rangeStart || null,
    rangeEnd: input.rangeEnd || null,
    periods: [],                        // Prompt 14 P2: normalized call_periods rows, sorted by start (rdBuildOffers)
    periodOfDay: Object.create(null),   // Prompt 14 P2: 'YYYY-MM-DD' -> index into ctx.periods (first period wins an overlap)
    warnings: [],
    _memo: Object.create(null)
  };

  // 9/22 (Prompt 12 A): the holiday-unit collapse is per surgeon now
  // (surgeonRules.<id>.holidayUnitCountsAsOneDay); an older blob's group key is
  // never honoured - one warning so Setup can drop it.
  if (ctx.holidayFlags && Object.prototype.hasOwnProperty.call(ctx.holidayFlags, "unitExemptFromMaxConsecutive")) {
    ctx.warnings.push("groupRules.holidays.unitExemptFromMaxConsecutive is ignored (Prompt 12 A, 9/22): a holiday unit counts as one day for the consecutive limits only for a surgeon whose surgeonRules.<id>.holidayUnitCountsAsOneDay is true - remove the group key from the blob");
  }
  if (defaultCapLegacy) ctx.warnings.push("groupRules.defaultMonthlyCap.total is a legacy key (Prompt 12 K, 9/22): read as defaultMonthlyCap.primary = " + defaultCap + " (a cap on PRIMARY days per month) - rename it in Setup");
  // audit RG-1 (9/23): "anyone not opted out may cover a holiday" is fixed behaviour - the opt-out is
  // surgeonRules.<id>.holidayRules.holidaysOff (hard holiday-opt-out:<name>), the waiver family is
  // holidays.ignoreWeekdayRules; eligibility() never read the former group key. Warn so the blob can drop it.
  if (ctx.holidayFlags && Object.prototype.hasOwnProperty.call(ctx.holidayFlags, "anyoneMayCoverUnlessOptedOut")) {
    ctx.warnings.push("groupRules.holidays.anyoneMayCoverUnlessOptedOut is ignored (audit RG-1, 9/23; never read since e7eec23, 9/22): anyone not opted out (surgeonRules.<id>.holidayRules.holidaysOff) may cover a holiday is fixed behaviour - remove the key from the blob");
  }
  // audit RG-2 (9/23): a day no East data (published or forecast) covers is always clear with the soft
  // east-unknown penalty (weights.eastUnknown) and listed in diagnostics - no key flips that.
  if (groupRules.eastFeed && Object.prototype.hasOwnProperty.call(groupRules.eastFeed, "unknownIsBusy")) {
    ctx.warnings.push("groupRules.eastFeed.unknownIsBusy is not read by the engine (audit RG-2, 9/23): an uncovered East day is always clear with the soft east-unknown penalty (weights.eastUnknown) - remove the key from the blob");
  }

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
    if (r.active === false) return;
    if (r.type === "external") ctx.externalIds.push(r.id); else ctx.activeIds.push(r.id);
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
      external: r.type === "external",   // Prompt 12 M: outside surgeon - see eligibility()
      activeFrom: r.activeFrom || null,
      activeTo: r.activeTo || null,
      rules: rules,
      mode: rules.availabilityMode || "",
      vacation: new Set(),
      dayBeforeVacation: new Set(),
      avail: Object.create(null),
      governedMonths: rdGovernedMonths(rules.explicitListMonths, backupOpen ? RD_MASK.primary : RD_MASK.any), // month -> role mask (T: a plain entry = primary only while backup is open)
      weekDays: new Set(),        // days inside rules.availableWeeks (Mon..Sun per listed Monday)
      weeksFromN: null,           // first day the weeks whitelist governs (day number)
      windowDays: new Set(),      // days inside rules.availableWindows
      hasWindows: !!(rules.availableWindows && rules.availableWindows.length),
      eastEnabled: !!ef.enabled,
      blocksPrimary: !!ef.eastBlocksPrimary,
      blocksBackup: !!ef.eastBlocksBackup,
      eastBusy: rdBusySet(ctx, id, input.eastBusyDays && input.eastBusyDays[id]),
      eastOverrides: rdOverrideMap(ctx, id, input.eastOverrides && input.eastOverrides[id]), // C: { day: true|false }
      eastForecast: (input.eastForecast && input.eastForecast[id]) || null,
      // Prompt 12 V (9/22 evening): surgeonRules.<id>.eastStanding [{ name, days: ["MM-DD"] }] -
      // standing East call in EVERY year (Khan: Christmas 12-24 + 12-25), treated like a
      // published busy day: "MM-DD" -> entry name, plus the validated list for display.
      eastStanding: new Map(),
      eastStandingList: [],
      // Prompt 15 part 2 (9/23): East vacations - the person's Davenport time off (input
      // eastVacationRanges, from the east_feed cache) under the review decisions (input
      // eastVacationReviews). Filled after the time-off loop below.
      eastVacationDays: Object.create(null), // date -> 'away' | 'unreviewed' (a DERIVED vacation day, not a Silvis time_off day)
      eastDayBefore: Object.create(null),    // date -> that state when the derived range starts the next day (trailing-edge gloss)
      eastClear: new Set(),                  // 'home' days: a dated availability for both roles + the east-clear primary bonus
      eastVacationRanges: [],                // [{ start, end, state }] as derived (display / conflicts)
      derived: Object.create(null), // date -> forced Silvis role
      eastDays: new Set(),          // every day he holds ANY East call (busy days + derived weeks) - display / East-only tallies
      // 9/22 (Prompt 12 K): the days of his East PRIMARY weeks only (derived Silvis
      // backup, silvisRole "backup") - the East days a countsEastDays cap adds.
      // A busy-day set (Khan's) is never added to anyone's cap.
      eastPrimaryDays: new Set(),
      capPrimary: null,             // cap on PRIMARY days per calendar month (null = none)
      capPreferred: null,           // soft ceiling on the same count
      countsEastDays: false,        // add eastPrimaryDays of the month to the primary count
      maxConsec: typeof rules.maxConsecutiveDays === "number" ? rules.maxConsecutiveDays : ctx.defaultMaxConsecutive,
      // 9/22 (Prompt 12 A): the any-role SOFT limit (null = no soft check; there is no
      // group default) and the per-surgeon holiday-unit collapse (opt-in; Khan today).
      maxConsecAnyRole: typeof rules.maxConsecutiveAnyRole === "number" ? rules.maxConsecutiveAnyRole : null,
      unitCollapse: rules.holidayUnitCountsAsOneDay === true,
      holidaysOff: new Set(hr.holidaysOff || []),
      maxMajor: null,
      hardNever: new Set(rules.hardNeverWeekdays || []),
      // 9/22: OR days etc. block primary only unless the list says otherwise. An
      // absent OR empty list reads as the default (an empty list never means "no
      // role" - one click too many in Setup must not open Khan's OR days for primary).
      hardNeverRoles: new Set(Array.isArray(rules.hardNeverWeekdaysRoles) && rules.hardNeverWeekdaysRoles.length ? rules.hardNeverWeekdaysRoles : (backupOpen ? ["primary"] : ["primary", "backup"])),
      backupOptOut: rules.backupOptOut === true,
      weekendStyle: rules.weekendStyle || null,
      // Prompt 12 N (9/22 evening): the window-week SOFT target (null = none), what
      // it counts, the alternate-days soft, the weekend-block soft weight (0 = none)
      // and the handoff diagnostics flag (read by the generator, not here).
      windowTarget: null,
      windowCountsBackup: false,
      preferAlternate: rules.preferAlternateDays === true,
      blockPenalty: rules.weekendBlockPenalty !== undefined && rules.weekendBlockPenalty !== null ? resolveWeight(ctx, rules.weekendBlockPenalty) : 0,
      handoffPartnerRequired: rules.handoffPartnerRequired === true,
      // Prompt 12 L (9/22): "weekends" = weekend primary is his main contribution
      // (weights.weekendContribution as a full-block primary bonus / weekend backup
      // penalty); null = no contribution term.
      contribution: rules.primaryContribution === "weekends" ? "weekends" : null,
      // Prompt 14 P2 (9/23): his offers ('YYYY-MM-DD' -> role mask) and, per period key, the derived status
      // ('submitted' | 'rules_only' | 'not_started') and mode ('exhaustive' | 'preferred') - rdBuildOffers.
      offers: Object.create(null),
      offerStatus: Object.create(null),
      offerMode: Object.create(null)
    };
    if (rules.primaryContribution !== undefined && rules.primaryContribution !== null && rules.primaryContribution !== "" && P.contribution === null) {
      ctx.warnings.push("surgeonRules." + id + ".primaryContribution = " + JSON.stringify(rules.primaryContribution) + " is not a value the engine knows (Prompt 12 L: only \"weekends\"): ignored - no contribution term for this surgeon");
    }
    // Prompt 12 V (9/22 evening): standing East days. The same gate as busy days (the
    // surgeon's East feature must be on AND block at least one role - blocksPrimary /
    // blocksBackup - or the entries could never act); a bad entry is a warning and is
    // ignored - never a silent block, never a silent pass.
    if (rules.eastStanding !== undefined && rules.eastStanding !== null) {
      if (!Array.isArray(rules.eastStanding)) ctx.warnings.push("surgeonRules." + id + ".eastStanding is not a list (Prompt 12 V): ignored - use [{ name, days: [\"MM-DD\"] }]");
      else if (!P.eastEnabled || (!P.blocksPrimary && !P.blocksBackup)) { if (rules.eastStanding.length) ctx.warnings.push("surgeonRules." + id + ".eastStanding ignored - enable surgeonRules." + id + ".eastFeed with eastBlocksPrimary or eastBlocksBackup (a standing day is a published East busy day, and busy days act only for the roles a surgeon's East feature blocks)"); }
      else rules.eastStanding.forEach(function (e, idx) {
        var name = e && typeof e.name === "string" && e.name.trim() ? e.name.trim() : null;
        var days = e && Array.isArray(e.days) ? e.days : null;
        if (!name || !days || !days.length) { ctx.warnings.push("surgeonRules." + id + ".eastStanding[" + idx + "]: ignored - needs { name, days: [\"MM-DD\"] } (got " + JSON.stringify(e) + ")"); return; }
        var good = [];
        days.forEach(function (md) {
          if (rdValidMonthDay(md)) { good.push(md); P.eastStanding.set(md, name); }
          else ctx.warnings.push("surgeonRules." + id + ".eastStanding[" + idx + "] (" + name + "): ignored day " + JSON.stringify(md) + " - use \"MM-DD\" with a real month and day");
        });
        if (good.length) P.eastStandingList.push({ name: name, days: good.slice().sort() });
      });
    }
    // (N review) weekendBlockPenalty: a weight name ("strong", "medium", ...) or a number is
    // applied as given; anything else falls back to weights.medium inside resolveWeight - say
    // so once, so a typo in the blob is never a silent downgrade from strong (10) to medium (3).
    var wbp = rules.weekendBlockPenalty;
    if (wbp !== undefined && wbp !== null && !(typeof wbp === "number" && !isNaN(wbp)) && !(typeof wbp === "string" && (Object.prototype.hasOwnProperty.call(ctx.weights, wbp) || !isNaN(parseFloat(wbp))))) {
      ctx.warnings.push("surgeonRules." + id + ".weekendBlockPenalty = " + JSON.stringify(wbp) + " is not a weight name or a number (Prompt 12 N): read as weights.medium = " + P.blockPenalty + " - use \"strong\", \"medium\" or a number in Setup -> Rules");
    }
    var dpw = rules.daysPerWindowWeek;
    if (dpw && typeof dpw === "object") {
      if (typeof dpw.target === "number") P.windowTarget = dpw.target;
      P.windowCountsBackup = dpw.countsBackup === true;
      var legacyKeys = ["min", "max", "minIsSoft"].filter(function (k) { return Object.prototype.hasOwnProperty.call(dpw, k); });
      if (legacyKeys.length) ctx.warnings.push("surgeonRules." + id + ".daysPerWindowWeek." + legacyKeys.join("/") + " are legacy keys (Prompt 12 N, 9/22 evening): ignored - the window-week count is a SOFT target now (daysPerWindowWeek.target, primary days" + (P.windowTarget === null ? "; no target is set" : "") + ") and there is no hard window-week min/max; rewrite it in Setup -> Rules");
    }
    if (hr.neverThanksgiving) P.holidaysOff.add("Thanksgiving");
    if (typeof hr.maxMajorHolidays === "number") P.maxMajor = hr.maxMajorHolidays;
    else if (rules.preferences && typeof rules.preferences.maxMajorHolidays === "number") P.maxMajor = rules.preferences.maxMajorHolidays;

    // monthlyCap semantics (9/22, Prompt 12 K - caps count PRIMARY days only):
    // explicit null = no cap; absent = group default; a number = that many primary
    // days; an object = { primary, preferred, countsEastDays }. The pre-K key
    // 'total' is an alias of 'primary' (one warning per surgeon); the pre-K
    // countsEastDays string "distinct-days" reads as true.
    if (Object.prototype.hasOwnProperty.call(rules, "monthlyCap")) {
      var mc = rules.monthlyCap;
      if (mc === null) P.capPrimary = null;
      else if (typeof mc === "number") P.capPrimary = mc;
      else if (mc && typeof mc === "object") {
        if (typeof mc.primary === "number") P.capPrimary = mc.primary;
        else if (typeof mc.total === "number") {
          P.capPrimary = mc.total;
          ctx.warnings.push("surgeonRules." + id + ".monthlyCap.total is a legacy key (Prompt 12 K, 9/22): read as monthlyCap.primary = " + mc.total + " (a cap on PRIMARY days per month) - rename it in Setup");
        } else P.capPrimary = ctx.defaultCap;
        P.capPreferred = typeof mc.preferred === "number" ? mc.preferred : null;
        P.countsEastDays = mc.countsEastDays === true || mc.countsEastDays === "distinct-days";
        if (mc.countsEastDays && !P.countsEastDays) ctx.warnings.push("surgeonRules." + id + ".monthlyCap.countsEastDays = " + JSON.stringify(mc.countsEastDays) + " is not true - ignored (use true)");
      }
    } else {
      P.capPrimary = ctx.defaultCap;
    }

    // Whitelist of weeks (Philip): governs from the first day of the month of the
    // earliest listed Monday (or rules.availableWeeksFrom) onward; earlier months
    // fall back to explicit-list governance (explicitListMonths) or open rules.
    if (rules.availableWeeks && rules.availableWeeks.length) {
      var mondays = rules.availableWeeks.slice().sort();
      mondays.forEach(function (mon) { for (var k = 0; k < 7; k++) P.weekDays.add(rdAddDays(mon, k)); });
      var from = rules.availableWeeksFrom || (mondays[0].slice(0, 7) + "-01");
      P.weeksFromN = rdInfo(from).n;
      // audit RG-7 (9/23): the list is a whitelist - past its last listed week the surgeon is primary-ineligible
      // everywhere ("outside-available-weeks") until he supplies more weeks. Say so when the range runs past it
      // (generic: every surgeon with a weeks list; the warning rides into diagnostics.warnings and the Generate panel).
      var lastListedSunday = rdAddDays(mondays[mondays.length - 1], 6);
      if (ctx.rangeEnd && ctx.rangeEnd > lastListedSunday) {
        ctx.warnings.push("surgeonRules." + id + ".availableWeeks ends with the week of " + mondays[mondays.length - 1] + " - no primary for " + (r.name || id) + " after " + lastListedSunday + " in this range (outside-available-weeks) until more weeks are entered in Setup -> Rules -> availableWeeks; backup stays open");
      }
    }
    if (P.hasWindows) {
      rules.availableWindows.forEach(function (w) { rdEachDayInRange(w.start, w.end, function (d) { P.windowDays.add(d); }); });
    }
    // C (fix round 9/22, finding 7): an override for a surgeon whose East feature blocks
    // no role could never change an answer - warn and drop it, never silently inert.
    var ovKeys = Object.keys(P.eastOverrides);
    if (ovKeys.length && !P.blocksPrimary && !P.blocksBackup) {
      ctx.warnings.push("eastOverrides[" + id + "]: " + ovKeys.length + " entr" + (ovKeys.length === 1 ? "y" : "ies") + " ignored - this surgeon's East feature blocks no role (surgeonRules." + id + ".eastFeed.eastBlocksPrimary / eastBlocksBackup)");
      P.eastOverrides = Object.create(null);
    }
    // C: overrides beat the published busy set - true adds the day, false removes it.
    // (The forecast side of a false override is handled in rdStatic.)
    Object.keys(P.eastOverrides).forEach(function (d) { if (P.eastOverrides[d] === true) P.eastBusy.add(d); else P.eastBusy.delete(d); });
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

  // East vacations (Prompt 15 part 2, 9/23): the person's Davenport vacation ranges under
  // the review decisions. unreviewed / away -> the days join P.vacation like a time_off row
  // (the trailing edge below follows); home -> eastClear days. A Silvis time_off day inside
  // a range stands as the Silvis vacation. See the header for the contract.
  ctx.eastVacations = Object.create(null);
  var evRanges = input.eastVacationRanges;
  var evReviews = input.eastVacationReviews;
  if (evReviews !== undefined && evReviews !== null && !Array.isArray(evReviews)) {
    ctx.warnings.push("eastVacationReviews is not a list: ignored - every East vacation range reads as unreviewed (pass the east_vacation_reviews rows)");
    evReviews = [];
  }
  evReviews = evReviews || [];
  if (evRanges !== undefined && evRanges !== null && (typeof evRanges !== "object" || Array.isArray(evRanges))) {
    ctx.warnings.push("eastVacationRanges is not a { surgeonId: [{ start, end }] } map: ignored");
    evRanges = null;
  }
  Object.keys(evRanges || {}).forEach(function (id) {
    var list = evRanges[id];
    var P = ctx.per[id];
    if (!P) { ctx.warnings.push("eastVacationRanges[" + id + "]: ignored - unknown surgeon id (key the map by the roster id resolved from the East code, never by a Davenport id)"); return; }
    if (!Array.isArray(list)) { ctx.warnings.push("eastVacationRanges[" + id + "]: ignored - not a list of { start, end } (got " + JSON.stringify(list) + ")"); return; }
    if (!list.length) return;
    if (P.external) { ctx.warnings.push("eastVacationRanges[" + id + "]: " + list.length + " range(s) ignored - " + id + " is an outside surgeon (never generated; the East fields do not apply to him)"); return; }
    if (!P.eastEnabled) { ctx.warnings.push("eastVacationRanges[" + id + "]: " + list.length + " range(s) ignored - this surgeon has no East feature (surgeonRules." + id + ".eastFeed.enabled is not true); East vacations apply to a surgeon with an East code only"); return; }
    var mine = evReviews.filter(function (r) { return r && r.person_id === id; });
    var busyOnHome = [], forecastOnHome = [];
    list.forEach(function (rg, idx) {
      if (!rg || !rdIsDateStr(rg.start) || !rdIsDateStr(rg.end) || rg.end < rg.start) { ctx.warnings.push("eastVacationRanges[" + id + "][" + idx + "]: ignored - needs { start, end } as 'YYYY-MM-DD' with end >= start (got " + JSON.stringify(rg) + ")"); return; }
      var state = rdEastReviewState(rg, mine);
      P.eastVacationRanges.push({ start: rg.start, end: rg.end, state: state });
      rdEachDayInRange(rg.start, rg.end, function (d) {
        if (P.vacation.has(d) && !P.eastVacationDays[d]) return; // his Silvis time_off day: the Silvis vacation stands, no East gloss
        if (state === "home") {
          if (P.eastVacationDays[d]) return;                    // an away/unreviewed range already claimed the day (overlap): conservative
          if (P.eastBusy.has(d) || rdStandingName(P, d)) { busyOnHome.push(d); return; } // the feed wins
          if (P.eastForecast && typeof P.eastForecast[d] === "number" && P.eastForecast[d] >= ctx.forecastThreshold) forecastOnHome.push(d + " (" + P.eastForecast[d].toFixed(2) + ")");
          P.eastClear.add(d);
        } else {
          if (P.eastClear.has(d)) P.eastClear.delete(d);       // overlap with a home range: the vacation wins
          P.vacation.add(d);
          P.eastVacationDays[d] = state;
        }
      });
    });
    if (busyOnHome.length) ctx.warnings.push("eastVacations[" + id + "]: the East feed says busy on " + busyOnHome.join(", ") + " inside a 'home' East vacation range - the feed wins (no east-clear on " + (busyOnHome.length === 1 ? "that day" : "those days") + "); check the Davenport schedule or the override");
    if (forecastOnHome.length) ctx.warnings.push("eastVacations[" + id + "]: the East forecast is at or over the threshold on " + forecastOnHome.join(", ") + " inside a 'home' East vacation range - the forecast is not consulted there (a Davenport vacation is Davenport's own statement he is off); refresh the forecast if it predates the vacation");
    var vacDays = Object.keys(P.eastVacationDays).sort(), clearDays = [];
    P.eastClear.forEach(function (d) { clearDays.push(d); });
    ctx.eastVacations[id] = { ranges: P.eastVacationRanges.slice(), vacationDays: vacDays, clearDays: clearDays.sort(), feedBusyOnHome: busyOnHome.slice().sort() };
  });

  ctx.allIds.forEach(function (id) {
    var P = ctx.per[id];
    P.vacation.forEach(function (d) {
      var before = rdAddDays(d, -1);
      if (!P.vacation.has(before)) {
        P.dayBeforeVacation.add(before);
        if (P.eastVacationDays[d]) P.eastDayBefore[before] = P.eastVacationDays[d]; // the edge of a DERIVED range (gloss only; the code is the same)
      }
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
    // Prompt 12 M (review 9/22): an outside surgeon is never generated - a derived week entered for him
    // (Setup -> Rules eastFeed.deriveFrom / statedWeeks) would otherwise become a whole generated week.
    if (P.external) { ctx.warnings.push("eastDerived[" + idx + "]: ignored - " + w.surgeonId + " is an outside surgeon (written in by hand only, never generated; the East fields do not apply to him)"); return; }
    var ef = P.rules.eastFeed || {};
    var fromN = ef.deriveFrom ? rdInfo(ef.deriveFrom).n : -Infinity;
    for (var k = 0; k < 7; k++) {
      var d = rdAddDays(w.weekMonday, k);
      P.eastDays.add(d); // he is on East call (primary or backup) all week either way
      // K: an East PRIMARY week is the derived Silvis BACKUP week - those days count
      // toward a countsEastDays cap; an East BACKUP week is Silvis primary and
      // counts through the Silvis primary days he holds instead.
      if (w.silvisRole === "backup") P.eastPrimaryDays.add(d);
      if (rdInfo(d).n < fromN) continue;
      P.derived[d] = w.silvisRole;
      var slot = ctx.derivedByDay[d] || (ctx.derivedByDay[d] = {});
      slot[w.silvisRole] = w.surgeonId;
    }
  });

  // Offers + periods (Prompt 14 P2).
  rdBuildOffers(ctx, input);

  return ctx;
}

/* ------------------------------------------------------ offers + periods */

// Prompt 14 P2 (9/23). call_periods rows -> ctx.periods (sorted by start; a day
// shared by two periods stays with the earlier one, with a warning) and
// ctx.periodOfDay; call_offers rows -> P.offers (day -> role mask) AND P.avail
// (an offer is a dated available row for its role - item W, one code path);
// then, per surgeon per period, the derived status and mode exactly as SQL
// offer_status() / offer_modes read them. Everything malformed is dropped with
// one ctx warning naming the row - a dropped offer never widens anyone's days
// (fail closed), a dropped period leaves its days ungoverned (today's rules).
var RD_OFFER_MASK = { primary: 1, backup: 2, either: 3 };
var RD_OFFER_MODES = { exhaustive: true, preferred: true };
function rdDayOf(v) {
  if (v instanceof Date && !isNaN(v)) return rdFmt(v);
  var s = typeof v === "string" ? v.slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function rdJsonish(v) {
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch (e) { return undefined; }
}
function rdBuildOffers(ctx, input) {
  var warn = function (m) { ctx.warnings.push(m); };
  var periodsIn = input.periods, offersIn = input.offers;
  if (periodsIn !== undefined && periodsIn !== null && !Array.isArray(periodsIn)) { warn("periods: not a list - ignored (pass the call_periods rows)"); periodsIn = []; }
  if (offersIn !== undefined && offersIn !== null && !Array.isArray(offersIn)) { warn("offers: not a list - ignored (pass the call_offers rows)"); offersIn = []; }
  periodsIn = periodsIn || []; offersIn = offersIn || [];

  var list = [];
  periodsIn.forEach(function (p, idx) {
    var label = p && (p.label || p.id) ? String(p.label || p.id) : "#" + idx;
    var start = p ? rdDayOf(p.start_day !== undefined ? p.start_day : p.start) : null;
    var end = p ? rdDayOf(p.end_day !== undefined ? p.end_day : p.end) : null;
    if (!start || !end) { warn("periods[" + idx + "] (" + label + "): dropped - needs start_day + end_day as 'YYYY-MM-DD' (got " + JSON.stringify(p && p.start_day) + " .. " + JSON.stringify(p && p.end_day) + ")"); return; }
    if (end < start) { warn("periods[" + idx + "] (" + label + "): dropped - end_day " + end + " is before start_day " + start); return; }
    var ro = rdJsonish(p.rules_only_ids);
    if (ro !== undefined && ro !== null && !Array.isArray(ro)) { warn("periods[" + idx + "] (" + label + "): rules_only_ids is not a list - read as [] (nobody is rules-only by listing)"); ro = []; }
    var rulesOnly = new Set((ro || []).filter(function (x) { return typeof x === "string"; }));
    var modesIn = rdJsonish(p.offer_modes);
    if (modesIn !== undefined && modesIn !== null && (typeof modesIn !== "object" || Array.isArray(modesIn))) { warn("periods[" + idx + "] (" + label + "): offer_modes is not an object - read as {} (everyone preferred)"); modesIn = {}; }
    var modes = Object.create(null);
    Object.keys(modesIn || {}).forEach(function (id) {
      var m = modesIn[id];
      if (RD_OFFER_MODES[m]) modes[id] = m;
      else warn("periods[" + idx + "] (" + label + "): offer_modes." + id + " = " + JSON.stringify(m) + " is not 'exhaustive' or 'preferred' - read as preferred");
    });
    list.push({
      key: p.id !== undefined && p.id !== null ? String(p.id) : label + "|" + start, id: p.id !== undefined && p.id !== null ? p.id : null,
      label: label, start: start, end: end, startN: rdInfo(start).n, endN: rdInfo(end).n,
      closeAt: rdDayOf(p.offers_close_at), publishBy: rdDayOf(p.publish_by), status: typeof p.status === "string" ? p.status : null,
      rulesOnly: rulesOnly, modes: modes, idx: idx
    });
  });
  list.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : a.idx - b.idx; });
  list.forEach(function (per, k) {
    var shared = [];
    rdEachDayInRange(per.start, per.end, function (d) {
      if (ctx.periodOfDay[d] !== undefined) shared.push(d); else ctx.periodOfDay[d] = k;
    });
    if (shared.length) {
      var other = list[ctx.periodOfDay[shared[0]]];
      warn("periods[" + per.idx + "] (" + per.label + ") overlaps periods[" + other.idx + "] (" + other.label + ") on " + shared[0] + ".." + shared[shared.length - 1] + " - the earlier period keeps those days; fix the dates in Setup -> Periods");
    }
  });
  ctx.periods = list;

  offersIn.forEach(function (o, idx) {
    var pid = o && o.person_id;
    var P = pid ? ctx.per[pid] : null;
    if (!P) { warn("offers[" + idx + "]: dropped - unknown person " + JSON.stringify(pid === undefined ? null : pid) + " (roster ids only)"); return; }
    if (P.external) { warn("offers[" + idx + "]: dropped - " + pid + " is an outside surgeon (written in by hand only, never generated)"); return; }
    var day = rdDayOf(o.day);
    if (!day) { warn("offers[" + idx + "]: dropped - day " + JSON.stringify(o.day === undefined ? null : o.day) + " is not 'YYYY-MM-DD'"); return; }
    var mask = RD_OFFER_MASK[o.role_pref];
    if (!mask) { warn("offers[" + idx + "]: dropped - role_pref " + JSON.stringify(o.role_pref === undefined ? null : o.role_pref) + " is not primary / backup / either (fail closed: this row offers nothing)"); return; }
    if (P.offers[day] !== undefined) warn("offers[" + idx + "]: duplicate row for " + pid + " " + day + " - roles merged (the table's unique (person_id, day) prevents this live; a hand-built or duplicated input is the only way here)");
    P.offers[day] = (P.offers[day] || 0) | mask;
    rdAvailRec(P.avail, day).avail |= mask; // W: an offer is a dated available row for its role
  });

  ctx.allIds.forEach(function (id) {
    var P = ctx.per[id];
    var days = Object.keys(P.offers);
    ctx.periods.forEach(function (per) {
      var submitted = false;
      for (var i = 0; i < days.length && !submitted; i++) if (days[i] >= per.start && days[i] <= per.end) submitted = true;
      P.offerStatus[per.key] = submitted ? "submitted" : per.rulesOnly.has(id) ? "rules_only" : "not_started";
      P.offerMode[per.key] = per.modes[id] || "preferred";
    });
  });
}

// offerState(ctx, day, surgeonId) -> null when the day lies outside every period
// (or the surgeon is unknown), else { period: { key, id, label, start, end,
// status, closeAt, publishBy }, status: 'submitted' | 'rules_only' |
// 'not_started', mode: 'exhaustive' | 'preferred', roles: the roles he offered
// that day ([], ['primary'], ['backup'] or both) }. Read-only.
function offerState(ctx, day, surgeonId) {
  var P = ctx && ctx.per ? ctx.per[surgeonId] : null;
  var k = ctx && ctx.periodOfDay ? ctx.periodOfDay[day] : undefined;
  if (!P || k === undefined) return null;
  var per = ctx.periods[k], m = P.offers[day] || 0, roles = [];
  if (m & RD_MASK.primary) roles.push("primary");
  if (m & RD_MASK.backup) roles.push("backup");
  return {
    period: { key: per.key, id: per.id, label: per.label, start: per.start, end: per.end, status: per.status, closeAt: per.closeAt, publishBy: per.publishBy },
    status: P.offerStatus[per.key], mode: P.offerMode[per.key], roles: roles
  };
}
// offeredOn(ctx, day, role, surgeonId) -> true when the day lies inside a period,
// the surgeon is 'submitted' for it and offered that role that day.
function offeredOn(ctx, day, role, surgeonId) {
  var st = offerState(ctx, day, surgeonId);
  return !!(st && st.status === "submitted" && st.roles.indexOf(role) >= 0);
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

function rdIsDateStr(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }

// The review decision for one East vacation range (Prompt 15 part 2): the first
// review row of the same person whose start AND end equal the range's decides
// 'away' | 'home'; no such row (a new, changed or removed range) = 'unreviewed'.
// The exact-match rule is what makes a refresh reset a changed range: the old
// row no longer matches anything (helpers.js derivedEastVacations lists it as
// stale for the app to delete). Mirrors helpers.js reviewStateFor; test/rules.test.js
// pins the two equal. Rows may spell the dates start/end (the table) or
// start_date/end_date (a time_off-shaped copy).
function rdEastReviewState(range, reviews) {
  for (var k = 0; k < reviews.length; k++) {
    var r = reviews[k];
    if (!r) continue;
    var rs = r.start !== undefined ? r.start : r.start_date, re = r.end !== undefined ? r.end : r.end_date;
    if (rs === range.start && re === range.end) return r.decision === "away" ? "away" : r.decision === "home" ? "home" : "unreviewed";
  }
  return "unreviewed";
}

// "MM-DD" naming a real month and day (02-29 counts: it exists in leap years).
function rdValidMonthDay(md) {
  if (typeof md !== "string" || !/^\d{2}-\d{2}$/.test(md)) return false;
  var m = +md.slice(0, 2), d = +md.slice(3, 5);
  return m >= 1 && m <= 12 && d >= 1 && d <= rdDaysInMonth(2000, m);
}

// The standing East entry (its name) that covers `date` for this surgeon, or null (Prompt 12 V).
function rdStandingName(P, date) {
  return P.eastStanding.size ? (P.eastStanding.get(date.slice(5)) || null) : null;
}

// standingEastDays(ctx, surgeonId, from, to) -> the concrete 'YYYY-MM-DD' days of the
// surgeon's standing East entries inside [from, to], every year in the range, sorted
// (Prompt 12 V; the generator's diagnostics and the UI read it). [] for an unknown
// surgeon, no entries or an empty range; a 02-29 entry appears in leap years only.
function standingEastDays(ctx, surgeonId, from, to) {
  var P = ctx && ctx.per ? ctx.per[surgeonId] : null;
  var out = [];
  if (!P || !P.eastStanding.size || typeof from !== "string" || typeof to !== "string" || from > to) return out;
  var y0 = +from.slice(0, 4), y1 = +to.slice(0, 4);
  for (var y = y0; y <= y1; y++) {
    P.eastStanding.forEach(function (name, md) {
      if (+md.slice(3, 5) > rdDaysInMonth(y, +md.slice(0, 2))) return;
      var d = y + "-" + md;
      if (d >= from && d <= to) out.push(d);
    });
  }
  return out.sort();
}

// Inside the PUBLISHED East coverage (ctx.eastCoverage = coverageOf of the cached
// Davenport weeks)? Prompt 12 C (9/22): published rows win - the forecast is never
// consulted for such a day, only the busy set derived from the published rows.
function rdInPublishedCoverage(ctx, info) {
  return !!ctx.eastCoverage && info.n >= ctx.eastCoverage.fromN && info.n <= ctx.eastCoverage.toN;
}
// Is the East answer for this day KNOWN (no 'east-unknown' soft)? Busy, inside the
// published coverage, an explicit override (either value), or a forecast entry
// (which by construction only matters outside the coverage).
function rdEastCovered(ctx, P, info) {
  if (P.eastBusy.has(info.s)) return true;
  if (rdStandingName(P, info.s)) return true; // Prompt 12 V: a standing East day is known, feed or no feed
  if (P.eastClear.has(info.s)) return true;   // Prompt 15 part 2: a 'home' East vacation day is known clear (no East call by Davenport's own statement)
  if (rdInPublishedCoverage(ctx, info)) return true;
  if (P.eastOverrides && P.eastOverrides[info.s] !== undefined) return true;
  return !!(P.eastForecast && P.eastForecast[info.s] != null);
}

// Was the derived lock for (date, role) overridden by an import/manual lock?
// Two ways (import/manual locks beat derived locks, with a warning):
//   (a) another surgeon is locked into his derived slot, or
//   (b) he himself is locked into the OTHER role that day (a manual primary lock
//       on a derived-backup day frees the backup slot for everyone else -
//       he cannot hold both roles, so the derived backup lock is moot).
// This is the general yield rule (Prompt 12 T, 9/22): an explicit published,
// import, manual or claimed row - any locked row - beats a derived-week lock on
// that day. The generator (genSeedLocks) applies the same test when it seeds the
// locks, lists every yielded day in diagnostics.derivedYields with one warning per
// derived week, and lists the days whose locked holder IS the derived surgeon
// (Fierce's explicit backup rows 11/9-11/15) in diagnostics.derivedConfirmed -
// those days yield nothing and the week stays whole.
function rdDerivedOverridden(ctx, date, role, id) {
  var e = ctx.schedule[date];
  if (!e) return false;
  if (e[role + "Locked"] && e[role] && e[role] !== id) return true;
  var other = role === "primary" ? "backup" : "primary";
  return !!(e[other + "Locked"] && e[other] === id);
}

// The weekday-pattern family for one (surgeon, date, role): recurring blacklist,
// weekday allow-list, the outside-derived-weeks pattern and the Aledo rules.
// rowAvail = an explicit dated available/backup_only row covers this role today;
// per groupRules.availabilityPrecedence it lifts every HARD rule in this family
// (soft preferences still apply). hardNeverWeekdays is the caller's and reads
// the same rowAvail flag (Prompt 12 W). Called from the static layer outside
// derived weeks and from the dynamic layer when a derived lock has been overridden.
// 9/22: the recurring blacklist, the allow-list and the Aledo week restrict
// PRIMARY only (backup is open to everyone); day-before-Aledo follows
// ctx.aledoDayBeforeRoles; the outside-derived-weeks pattern is per-role data;
// a recurringAvoid entry weighs its own weight for primary and weights.low for backup.
function rdPatternRules(ctx, P, info, role, asBlock, rowAvail, hard, soft) {
  var rules = P.rules, W = ctx.weights, date = info.s;
  var primary = role === "primary" || !ctx.backupOpen; // backupPolicy.openToEveryone false -> both roles again
  var ru = rdRecurringMatches(rules.recurringUnavailable, date);
  if (primary && ru && !rowAvail) hard.push("recurring-unavailable:" + info.wd);
  var ra = rdRecurringMatches(rules.recurringAvoid, date);
  if (ra) soft.push({ reason: "recurring-avoid:" + info.wd, weight: primary ? resolveWeight(ctx, ra.weight || "medium") : W.low });

  // Weekday allow-list (Khan): Mon-Thu primary only via the list; weekend days are pool days.
  if (primary && rules.weekdays && Array.isArray(rules.weekdays.allowed) && !rdIsWeekendDay(ctx, info)) {
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

  // Aledo (Philip): hard day-before for the configured roles; strong soft on the whole week for primary.
  var al = rules.aledo;
  if (al) {
    if (!rowAvail && al.hardAvoidDayBefore !== false && ctx.aledoDayBeforeRoles.indexOf(role) >= 0 && rdIsAledoDay(rules, rdAddDays(date, 1))) hard.push("day-before-aledo");
    if (primary && al.avoidWholeWeek && rdWeekHasAledo(rules, info.monday)) soft.push({ reason: "aledo-week", weight: resolveWeight(ctx, al.avoidWholeWeek) });
  }
}

function rdMonthIndex(s) { var i = rdInfo(s); return i.y * 12 + i.m; }

/* ------------------------------------------------------- static layer */

// Hard reason vocabulary (test/generator-regression.js REASON_PREFIXES pins it;
// the UI's REASON_WORDS glosses the entries it knows and shows the raw code for
// the rest): unknown-surgeon, bad-role:, inactive,
// backup-opt-out, holiday-opt-out:, time-off:, day-before-vacation,
// unavailable-row, no-backup-row, backup-only-row, east-busy, east-forecast-busy:,
// hard-never-weekday:, recurring-unavailable:, weekday-not-allowed:,
// weekend-block-only, weekday-pattern:, day-before-aledo, whitelist-month,
// not-recurring-available, outside-available-weeks, outside-window,
// external-cover, external-surgeon, slot-locked:, derived-lock:,
// derived-lock-held:, holds-other-role, monthly-cap:, max-consecutive:,
// backup-cap:, backup-weekend-cap:, max-major-holidays:, not-offered.
// not-offered (Prompt 14 P2, 9/23): a SUBMITTED surgeon in EXHAUSTIVE mode on a
// day/role he did not offer inside the period - decided in rdStatic
// (res.notOffered), pushed by eligibility() unless opts.claim; it is the first
// hard reason after the slot facts. Its soft siblings: offered
// (-weights.offerBonus, any submitted surgeon's offered day) and outside-offers
// (+weights.outsideOffers, any submitted surgeon's non-offered day - visible in
// preferred mode and on an exhaustive surgeon's claim result, where not-offered
// is skipped).
// external-surgeon (Prompt 12 M, 9/22): the surgeon is a roster entry of type
// "external" (an outside surgeon / internal locum, ids x1, x2, ...) - written in
// by hand only. He is in ctx.rosterById / allIds and, when active, in
// ctx.externalIds, never in ctx.activeIds (the generation universe), so the
// generator never evaluates him; a caller that does (the trade path, a stray
// loop) gets this hard reason. The day editor asks with opts.manual === true
// and then gets the SLOT facts only (external-cover, slot-locked:, inactive,
// time-off: on his own vacation day, holds-other-role) and ok otherwise - no pattern, cap, run or target rule
// applies to an outside surgeon; the result carries external: true. A day he
// holds is a fact like any lock holder (ok, lockHolder, no conflicts).
// max-consecutive:<limit> is the HARD primary-only run limit on real days (a
// holiday unit is one day only for a surgeon who opted in). Its SOFT sibling
// long-run:<runLength> (Prompt 12 A, 9/22) marks an any-role run (primary or
// backup) longer than surgeonRules.<id>.maxConsecutiveAnyRole, weighted
// weights.longRunPerDay * (runLength - limit).
// Window-week vocabulary (Prompt 12 N, 9/22 evening) is SOFT only:
// window-week-below-target:<t> (-medium), window-week-over-target:<t>
// (medium x days over) and consecutive-primary (medium, preferAlternateDays).
// The pre-N hard reason window-week-max: no longer exists.
// Weekend-contribution vocabulary (Prompt 12 L, 9/22) is SOFT only:
// weekend-primary (-weights.weekendContribution per day, a Fri/Sat/Sun primary
// evaluated as a full-block member) and weekend-backup (+weekendContribution
// per day, a Fri/Sat/Sun backup) for a surgeon whose primaryContribution is
// "weekends"; both are skipped under skipPatternSoft (weekendUnitPatterns
// carries the unit-level term instead) and neither applies on a holiday-unit
// day; weekend-primary also needs the whole Fri/Sat/Sun free of holiday units.
// The same vocabulary as data (Prompt 13 part 4): helpers.openSlotReason maps
// every code to an operational category for the anon-readable blob;
// test/open-shifts.test.js pins this array equal to the comment above and a
// superset of every hard.push("...") literal in this file. P13R (rebase onto
// the Prompt 12 head): window-week-max: left with item N (soft only now),
// external-surgeon joined with item M.
var HARD_REASONS = [
  "unknown-surgeon", "bad-role:", "inactive",
  "backup-opt-out", "holiday-opt-out:", "time-off:", "day-before-vacation",
  "unavailable-row", "no-backup-row", "backup-only-row", "east-busy", "east-forecast-busy:",
  "hard-never-weekday:", "recurring-unavailable:", "weekday-not-allowed:",
  "weekend-block-only", "weekday-pattern:", "day-before-aledo", "whitelist-month",
  "not-recurring-available", "outside-available-weeks", "outside-window",
  "external-cover", "external-surgeon", "slot-locked:", "derived-lock:", "derived-lock-held:",
  "holds-other-role", "monthly-cap:", "max-consecutive:", "backup-cap:",
  "backup-weekend-cap:", "max-major-holidays:"
];
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

  // 9/22: an explicit backup opt-out is hard on every backup slot - holiday
  // units included, never waived, no dated row lifts it. Primary is unaffected.
  if (role === "backup" && P.backupOptOut) hard.push("backup-opt-out");

  // Holiday context.
  var hol = ctx.holidayByDay[date] || null;
  var HF = ctx.holidayFlags;
  var waive = !!(hol && HF.ignoreWeekdayRules !== false);
  var optedOut = !!(hol && P.holidaysOff.has(hol.name));
  if (optedOut) hard.push("holiday-opt-out:" + hol.name);

  // Time off (vacations only). Trailing edge: the day before blocks PRIMARY only.
  // Prompt 15 part 2: a DERIVED East vacation day (unreviewed / away range) sits in the
  // same sets and gets the same codes; res.eastVacation carries its state for the gloss.
  if (P.vacation.has(date)) { hard.push("time-off:" + date); if (P.eastVacationDays[date]) res.eastVacation = P.eastVacationDays[date]; }
  else if (P.dayBeforeVacation.has(date) && ctx.trailingEdgeRoles.indexOf(role) >= 0) { hard.push("day-before-vacation"); if (P.eastDayBefore[date]) res.eastVacation = P.eastDayBefore[date]; }

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
  // Prompt 15 part 2 (9/23): a 'home' East vacation day (no East call, no OR block) is a
  // dated availability for BOTH roles - it lifts exactly what a dated row lifts (the
  // weekday-pattern family incl. hardNeverWeekdays, the dated whitelists), never an
  // obligation - and carries a small PRIMARY-only bonus so the generator prefers him
  // there. A day the feed says busy never reaches P.eastClear (buildContext).
  var homeDay = P.eastClear.has(date);
  if (homeDay) {
    rowAvail = true;
    res.eastClear = true;
    if (role === "primary" && W.eastClear) soft.push({ reason: "east-clear", weight: -W.eastClear });
  }

  // Offers (Prompt 14 P2, 9/23): inside a period a SUBMITTED surgeon is offers-governed.
  // An offered day (P.offers mask covers the role; it is also in P.avail, so rowAvail
  // is true and the weekday-pattern family below is lifted for it - W) earns the
  // 'offered' bonus in either mode; a non-offered day is 'not-offered' (hard, applied
  // by eligibility() unless the caller claims) in exhaustive mode and 'outside-offers'
  // (soft) under the ordinary rules in preferred mode. offersGovern also switches the
  // dated lists (whitelist-month, outside-available-weeks) off for him inside the
  // period. rules_only / not_started, or a day outside every period: nothing here.
  var offersGovern = false;
  var perIdx = ctx.periodOfDay[date];
  if (perIdx !== undefined) {
    var perKey = ctx.periods[perIdx].key;
    if (P.offerStatus[perKey] === "submitted") {
      offersGovern = true;
      if ((P.offers[date] || 0) & mask) { if (W.offerBonus) soft.push({ reason: "offered", weight: -W.offerBonus }); }
      else {
        if (P.offerMode[perKey] === "exhaustive") res.notOffered = true;   // hard unless the caller claims (eligibility)
        if (W.outsideOffers) soft.push({ reason: "outside-offers", weight: W.outsideOffers }); // both modes: the day is outside his offers
      }
    }
  }
  res.offersGovern = offersGovern;

  // East feed: busy days / forecast / unknown for the roles East blocks.
  // Precedence (Prompt 12 C, 9/22): published > override > forecast. P.eastBusy
  // already carries the published busy days WITH the overrides applied (true added,
  // false removed - buildContext). The forecast is consulted only OUTSIDE the
  // published coverage and never on a day an override busy:false cleared.
  if (P.eastEnabled && (role === "primary" ? P.blocksPrimary : P.blocksBackup)) {
    // Prompt 12 V (9/22 evening): a standing East day (surgeonRules.<id>.eastStanding, every
    // year) is a published busy day - the same hard code, ahead of the forecast and of
    // east-unknown; res.eastStanding carries the entry's name for the day editor.
    var standing = rdStandingName(P, date);
    if (P.eastBusy.has(date) || standing) { hard.push("east-busy"); if (standing) res.eastStanding = standing; }
    else {
      // Prompt 15 part 2: never on a 'home' East vacation day (buildContext warned if a value sat there).
      var fcApplies = !homeDay && !rdInPublishedCoverage(ctx, info) && !(P.eastOverrides && P.eastOverrides[date] === false);
      var prob = (fcApplies && P.eastForecast) ? P.eastForecast[date] : undefined;
      if (typeof prob === "number") {
        if (prob >= ctx.forecastThreshold) hard.push("east-forecast-busy:" + prob.toFixed(2));
        else if (prob > 0) soft.push({ reason: "east-forecast:" + prob.toFixed(2), weight: W.eastForecastBelowThreshold });
      } else if (!rdEastCovered(ctx, P, info)) {
        soft.push({ reason: "east-unknown", weight: W.eastUnknown });
      }
    }
  }

  // Weekday-pattern family - waived on holiday-unit days (groupRules.holidays.ignoreWeekdayRules).
  // hardNeverWeekdays (its roles list defaults to primary only since 9/22) is a
  // member of the family: since Prompt 12 W (Faraz 9/22 evening, "own dates beat
  // own patterns") an explicit dated row for the role lifts it for that date like
  // the rest of the family - his OR days are not every Tue/Thu. Nothing else
  // lifts it (a manual lock is not a row; see the header). Inside a derived
  // (East) week the derived lock governs instead, so the rest of the family is
  // deferred: eligibility() re-applies it when an import/manual lock overrides
  // that derived lock (res.patternDeferred + res.rowAvail carry what it needs).
  var notRecurring = false;
  var patternDeferred = false;
  if (!waive) {
    if (P.hardNever.has(info.wd) && P.hardNeverRoles.has(role) && !rowAvail) hard.push("hard-never-weekday:" + info.wd);
    if (P.derived[date]) patternDeferred = true;
    else rdPatternRules(ctx, P, info, role, asBlock, rowAvail, hard, soft);
  }
  res.patternDeferred = patternDeferred;
  res.rowAvail = rowAvail;

  // Dated whitelists. A governed month restricts exactly the roles its
  // explicitListMonths entry names (P.governedMonths carries the mask: a plain
  // entry = primary only since 9/22, an object entry = the roles it lists - T);
  // the recurring whitelist and the weeks whitelist restrict PRIMARY only (backup
  // is open to everyone). Sarkar's windows are her only availability and keep
  // governing both roles; since Prompt 12 W they are an OBLIGATION no dated row
  // lifts (edit the window in Setup instead) - unlike the weeks whitelist.
  var datedBlock = null;
  var isPrimary = role === "primary" || !ctx.backupOpen; // backupPolicy.openToEveryone false -> both roles again
  var governed = !!((P.governedMonths[info.month] || 0) & mask) && !offersGovern; // P2: offers supersede the dated lists for a submitted surgeon
  if (governed) {
    if (!rowAvail) datedBlock = "whitelist-month";
  } else if (isPrimary && (P.mode === "whitelist-recurring" || (rules.recurringAvailable && rules.recurringAvailable.length))) {
    var wa = rules.weekendsAvailable;
    var weekendOk = rdIsWeekendDay(ctx, info) && wa && (wa === true || wa[role]);
    if (!(rowAvail || weekendOk || rdRecurringMatches(rules.recurringAvailable, date))) notRecurring = true;
  }
  if (isPrimary && !offersGovern && P.weeksFromN !== null && info.n >= P.weeksFromN && !(P.weekDays.has(date) || rowAvail)) datedBlock = datedBlock || "outside-available-weeks";
  if (P.hasWindows && !P.windowDays.has(date)) hard.push("outside-window"); // both roles; still enforced on holidays; never lifted by a row (W)

  if (notRecurring && !waive) hard.push("not-recurring-available");
  // Small items (9/22): an EXPLICIT dated list stays HARD on a holiday-unit day -
  // the holiday waiver (waive, above) lifts the recurring weekday patterns only,
  // never the dates a surgeon offered himself: a governed month's list
  // ("whitelist-month" - Burchett's December list omits 12/24 on purpose and names
  // 12/25) and the weeks list ("outside-available-weeks" - Mon 5/31 of Philip's
  // Memorial Day 2027 unit sits outside his listed weeks, which excludes him from
  // the whole unit). On a holiday-unit day the opt-out is
  // enforced by holidaysOff (optedOut, hard) and the waiver family by
  // holidays.ignoreWeekdayRules - nothing else about holiday cover is configurable
  // (audit RG-1, 9/23: the former anyoneMayCoverUnlessOptedOut key was never read).
  if (datedBlock) hard.push(datedBlock);

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
//                    'weekend-block-only' weekday-pattern rule and (Prompt 12 L) enables
//                    the 'weekend-primary' bonus of a primaryContribution "weekends" surgeon.
//   assume         - other slots to count as held by this surgeon (unit / block members)
//                    for caps, consecutive runs and week counts.
//   ignoreLocks    - do not report 'slot-locked' for a slot locked to someone else.
//   manual         - the day editor's hand-written path (Prompt 12 M): an outside surgeon
//                    (roster type "external") is judged on the slot facts only and is ok
//                    otherwise; without it he is hard 'external-surgeon'. Pool surgeons
//                    are unaffected by the flag.
//   skipPatternSoft - weekendUnitPatterns adds the style mismatch and the weekend-contribution
//                    term (weekend-primary / weekend-backup) itself, once per pattern.
//   claim          - a Prompt 13 claim is an offer made on the spot (Prompt 14 P2): a submitted
//                    surgeon in exhaustive mode may claim a non-offered day when every other
//                    hard rule passes - the flag skips 'not-offered' only (the result still
//                    carries the soft 'outside-offers' so the board can say so).
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

  // Outside surgeon (Prompt 12 M): slot facts only - see the vocabulary comment above rdStatic.
  var PX = ctx.per[surgeonId];
  if (PX && PX.external) {
    var otherX = role === "primary" ? "backup" : "primary";
    if (entry && entry[role + "Locked"] && entry[role] === surgeonId) return { ok: true, hard: [], soft: [], lockHolder: true, conflicts: [], external: true };
    if (!PX.active || (PX.activeFrom && dateStr < PX.activeFrom) || (PX.activeTo && dateStr > PX.activeTo)) hard.push("inactive");
    if (PX.vacation.has(dateStr)) hard.push("time-off:" + dateStr);   // his own stated absence (the day itself; no trailing edge for him)
    if (ctx.backupDistinct && entry && entry[otherX] === surgeonId) hard.push("holds-other-role");
    if (!opts.manual) hard.push("external-surgeon");
    return hard.length ? { ok: false, hard: hard, soft: [], external: true } : { ok: true, hard: [], soft: [], external: true };
  }
  var st = rdStatic(ctx, dateStr, role, surgeonId, !!opts.asBlockMember);
  if (st.notOffered && !opts.claim) hard.push("not-offered"); // P2: exhaustive mode, the first reason after the slot facts
  hard = hard.concat(st.hard);
  soft = soft.concat(st.soft.map(function (s) { return { reason: s.reason, weight: s.weight }; })); // copies: the memo's entries stay pristine
  var P = ctx.per[surgeonId];
  if (!P) return { ok: false, hard: hard, soft: soft };

  // Import/manual lock holder: the row is a fact. Every violated rule is still
  // collected (as `conflicts`) so the caller can warn, but the result is ok.
  var importHolder = !!(entry && entry[role + "Locked"] && entry[role] === surgeonId);
  // The static layer's glosses ride on every pool result: the standing East entry's name
  // (V), the derived East vacation state (Prompt 15: 'away' | 'unreviewed' - the reason
  // itself stays time-off: / day-before-vacation) and the 'home' flag (eastClear).
  function glossed(out) {
    if (st.eastStanding) out.eastStanding = st.eastStanding; // Prompt 12 V: the standing East entry's name (the reason itself stays "east-busy")
    if (st.eastVacation) out.eastVacation = st.eastVacation;
    if (st.eastClear) out.eastClear = true;
    return out;
  }
  function blockedResult() {
    return glossed(importHolder ? { ok: true, hard: [], soft: soft, lockHolder: true, conflicts: hard } : { ok: false, hard: hard, soft: soft });
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
  if (lockHolder) return glossed({ ok: true, hard: hard, soft: soft, lockHolder: true }); // derived lock: caps/consecutive/patterns do not apply

  // --- counting helpers (the evaluated slot counts as held; assume-slots too) ---
  function holdsRole(d, r) {
    if (d === dateStr && r === role) return true;
    var e = sched[d];
    if (e && e[r] === surgeonId) return true;
    if (assumeMap) { var a = assumeMap[d]; if (a && (a & RD_MASK[r])) return true; }
    return false;
  }
  function holdsAny(d) { return holdsRole(d, "primary") || holdsRole(d, "backup"); }

  // Monthly cap (9/22, Prompt 12 K): counts PRIMARY days only - distinct days of the
  // evaluated month on which he holds Silvis primary (schedule, assume-slots and
  // this slot) plus, for a countsEastDays cap, the days of his East PRIMARY weeks.
  // The check applies to a PRIMARY placement only: a backup placement never trips
  // monthly-cap or over-preferred-cap, and backup days never count. An explicit
  // backup cap (rules.backupCap, Philip) is the separate block below.
  // A numeric surgeonRules.<id>.monthlyTarget is a PRIMARY target (Prompt 12 J,
  // small items 9/22): its soft over/under-target term below measures the same
  // monthPrimary count as the cap and applies to a primary placement only - a
  // backup placement is never scored against it and backup days never count.
  var monthDays = rdMonthDays(info.month);
  var capApplies = role === "primary" && (P.capPrimary !== null || P.capPreferred !== null);
  var hasTarget = role === "primary" && typeof rules.monthlyTarget === "number";
  var monthPrimary = 0;
  if (capApplies || hasTarget) {
    for (var i = 0; i < monthDays.length; i++) {
      var md = monthDays[i];
      if (holdsRole(md, "primary") || (P.countsEastDays && P.eastPrimaryDays.has(md))) monthPrimary++;
    }
  }
  if (capApplies) {
    if (P.capPrimary !== null && monthPrimary > P.capPrimary) hard.push("monthly-cap:" + P.capPrimary);
    else if (P.capPreferred !== null && monthPrimary > P.capPreferred) soft.push({ reason: "over-preferred-cap:" + P.capPreferred, weight: W.medium });
  }

  // Max consecutive days: the HARD limit counts PRIMARY days only (unless
  // groupRules.countBackupInConsecutive) on REAL calendar days; the days of one
  // holiday unit collapse to one day only for a surgeon who opted in
  // (surgeonRules.<id>.holidayUnitCountsAsOneDay - Khan; 9/22, Prompt 12 A).
  var countBackup = ctx.countBackupInConsecutive;
  var prevDay = rdAddDays(dateStr, -1), nextDay = rdAddDays(dateStr, 1); // computed once: the run walk and the day-neighbour softs below reuse them
  // Both runs through the evaluated day (held both ways; the slot itself and
  // assume-slots count) in ONE walk per direction: nHard = the run the hard limit
  // counts, nAny = the any-role run of the soft check below. The hard run is a
  // prefix of the any-role run (a counted day is a held day), so it stops at the
  // first held day that is not counted while the any-role walk goes on. An
  // isolated day (neither neighbour held) skips the walk - the common case.
  // Unit keys are tracked only for a surgeon who opted into the collapse.
  var wantHard = role === "primary" || countBackup;
  var wantAny = P.maxConsecAnyRole !== null && !!W.longRunPerDay;
  var nHard = 1, nAny = 1;
  if ((wantHard || wantAny) && (holdsAny(prevDay) || holdsAny(nextDay))) {
    var collapse = !!P.unitCollapse, keysH = null, keysA = null, ku;
    if (collapse) { ku = ctx.holidayByDay[dateStr]; var k0 = ku ? "H:" + ku.name + ":" + ku.days[0] : dateStr; keysH = {}; keysA = {}; keysH[k0] = true; keysA[k0] = true; }
    for (var dir = -1; dir <= 1; dir += 2) {
      var hardAlive = wantHard;
      for (var d1 = dir < 0 ? prevDay : nextDay, guard = 0; guard < 60 && holdsAny(d1); d1 = rdAddDays(d1, dir), guard++) {
        var k = null;
        if (collapse) { ku = ctx.holidayByDay[d1]; k = ku ? "H:" + ku.name + ":" + ku.days[0] : d1; }
        if (!collapse || !keysA[k]) { if (collapse) keysA[k] = true; nAny++; }
        if (hardAlive) {
          if (holdsRole(d1, "primary") || (countBackup && holdsRole(d1, "backup"))) { if (!collapse || !keysH[k]) { if (collapse) keysH[k] = true; nHard++; } }
          else hardAlive = false;
        }
      }
    }
  }
  if (wantHard && nHard > P.maxConsec) hard.push("max-consecutive:" + P.maxConsec);

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

  // Days per window week (Prompt 12 N, 9/22 evening): a SOFT target of PRIMARY days
  // in the Mon-Sun week (schedule + assume-slots + this slot); countsBackup true
  // counts either role and then applies to a backup placement too. A placement
  // that keeps her at or under the target (0 or 1 other primaries held when the
  // target is 2) is a bonus (-medium) - every day up to the target is wanted, not
  // just the first; a placement over it is a penalty (medium per day over). There
  // is NO hard window-week maximum or minimum (none of her rules are hard and
  // fast yet - Faraz 9/22 evening; the window itself is the hard rule, above).
  if (P.windowTarget !== null && (role === "primary" || P.windowCountsBackup)) {
    var wcnt = 0;
    for (var w = 0; w < 7; w++) {
      var wd = rdAddDays(info.monday, w);
      if (P.windowCountsBackup ? holdsAny(wd) : holdsRole(wd, "primary")) wcnt++;
    }
    if (wcnt <= P.windowTarget) soft.push({ reason: "window-week-below-target:" + P.windowTarget, weight: -W.medium });
    else soft.push({ reason: "window-week-over-target:" + P.windowTarget, weight: W.medium * (wcnt - P.windowTarget) });
  }

  // Prefer alternate days (Prompt 12 N, 9/22 evening): a primary whose day before or
  // after is the surgeon's own primary (schedule or assume-slots). Replaces the
  // pre-N handoff-partner soft; handoffPartnerRequired is a diagnostics flag now.
  if (P.preferAlternate && role === "primary" && (holdsRole(prevDay, "primary") || holdsRole(nextDay, "primary"))) {
    soft.push({ reason: "consecutive-primary", weight: W.medium });
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
  if (role === "backup" && W.backupAfterPrimary && holdsRole(prevDay, "primary")) soft.push({ reason: "backup-after-primary", weight: W.backupAfterPrimary });

  // 9/22 (Prompt 12 A): the any-role run (primary OR backup held, the evaluated
  // slot and assume-slots included, real days unless he opted in) beyond the
  // surgeon's SOFT limit. Backup is standby, so this is a penalty that grows per
  // day, never a block; no maxConsecutiveAnyRole -> no check (no group default).
  if (wantAny && nAny > P.maxConsecAnyRole) soft.push({ reason: "long-run:" + nAny, weight: W.longRunPerDay * (nAny - P.maxConsecAnyRole) });

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

    // Prompt 12 L (9/22): primaryContribution "weekends". Per-day view, used by the
    // candidate score, single-day fills, repair and smoothing: a primary counts as
    // his contribution only as a member of a full Fri+Sat+Sun block (so a move that
    // breaks the block loses the bonus), a weekend backup is discouraged on any
    // weekend day. weekendUnitPatterns evaluates with skipPatternSoft and adds its
    // own unit-level term instead - exactly one of the two applies anywhere.
    // Holiday units are NOT weekend units (review 9/22): no term on a holiday-unit
    // day (the holiday fill ranks by soft sums; anyone may back up a holiday), and no
    // block bonus when a unit pre-empts any day of this weekend - the enumerator's
    // 'full' is three present non-holiday days, so the per-day view equals the unit
    // view even though genHoldsFullBlock ignores the pre-emption. A non-holiday day
    // of a reduced weekend still carries weekend-backup (reduced patterns do too).
    if (!opts.skipPatternSoft && P.contribution === "weekends" && W.weekendContribution && !hol) {
      var wkWhole = !ctx.holidayByDay[info.friday] && !ctx.holidayByDay[rdAddDays(info.friday, 1)] && !ctx.holidayByDay[rdAddDays(info.friday, 2)];
      if (role === "primary" && opts.asBlockMember && wkWhole) soft.push({ reason: "weekend-primary", weight: -W.weekendContribution });
      else if (role === "backup") soft.push({ reason: "weekend-backup", weight: W.weekendContribution });
    }
  }

  // Numeric monthly target = PRIMARY days only (see the cap block above).
  if (hasTarget) {
    if (monthPrimary > rules.monthlyTarget) soft.push({ reason: "over-target:" + (monthPrimary - rules.monthlyTarget), weight: W.low * (monthPrimary - rules.monthlyTarget) });
    else if (monthPrimary < rules.monthlyTarget) soft.push({ reason: "under-target", weight: W.preferred });
  }

  if (importHolder) return glossed({ ok: true, hard: hard, soft: soft, lockHolder: true, conflicts: [] });
  return glossed({ ok: true, hard: hard, soft: soft });
}

/* ---------------------------------------------------------- weekends */

function rdSoftSum(r) { var s = 0; for (var k = 0; k < r.soft.length; k++) s += r.soft[k].weight; return s; }

// weekendUnitPatterns(ctx, fridayStr, role = 'primary', daysPresent = null)
//   -> [{ kind:'block'|'split'|'daily', members:{fri,sat,sun}, penalty, fallback, surgeons }]
// sorted by penalty. daysPresent (array of date strings) restricts the unit to
// the days a holiday unit did not pre-empt; a reduced unit offers block(remaining)
// and daily only. Block members are evaluated with asBlockMember only for a full
// three-day block. Style mismatches add weights.patternMismatch once per surgeon.
// Prompt 12 N (9/22 evening): a surgeon with surgeonRules.<id>.weekendBlockPenalty
// is still offered in a multi-day block (present.length > 1) and in a split, but
// each such membership adds that weight; weekendStyle "daily" means a standalone
// weekend day is the normal pattern (memberPen 0). "saturday-only" (older blobs)
// keeps its meaning: Saturday member of a split / daily only, never a block.
// Prompt 12 L (9/22): a surgeon with surgeonRules.<id>.primaryContribution
// "weekends" earns -weights.weekendContribution ONCE on a FULL three-day
// primary block he holds, and every pattern membership of his in a BACKUP
// enumeration (block, split X or Y, daily) costs +weekendContribution once per
// surgeon. Members are evaluated with skipPatternSoft, so eligibility()'s
// per-day weekend-primary / weekend-backup softs are off in here: the unit-level
// term is the only one a pattern carries (no double count). Reduced blocks,
// splits and daily days earn no primary bonus (the block must be whole).
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
  // L: the unit-level weekend-contribution term. Backup: +weekendContribution per
  // membership of a "weekends" surgeon in any pattern; primary: the block loop
  // subtracts it for a full block (blockBonus).
  function contrib(id) { return ctx.per[id].contribution === "weekends" && W.weekendContribution ? W.weekendContribution : 0; }
  function backupPen(id) { return role === "backup" ? contrib(id) : 0; }

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
    if (present.length > 1) pen += ctx.per[id].blockPenalty; // N: a multi-day block for a weekendBlockPenalty surgeon (0 for everyone else)
    if (role === "primary" && full) pen -= contrib(id);        // L: his full primary block is the contribution (bonus once per block)
    pen += backupPen(id);                                       // L: him as the weekend backup block (penalty once)
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
      var penX = rdSoftSum(rf) + rdSoftSum(rs) + (sx === "split" ? 0 : W.patternMismatch) + ctx.per[x].blockPenalty + backupPen(x); // N: split membership carries the surgeon's weekendBlockPenalty; L: a backup split membership carries his contribution penalty
      ids.forEach(function (y) {
        if (y === x || !solo[y][sat].ok) return;
        var sy = styleOf(y);
        var pen = penX + rdSoftSum(solo[y][sat]) + ((sy === "split" || sy === "saturday-only") ? 0 : W.patternMismatch) + ctx.per[y].blockPenalty + backupPen(y);
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
    return 0; // "daily" (N) and no style: a standalone day is the normal pattern
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
      for (var c2 = 0; c2 < distinct.length; c2++) pen += backupPen(distinct[c2]); // L: once per surgeon, however many days he holds
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

// runThrough(ctx, surgeonId, day, anyRole) -> the length of the run of counted
// days through `day` (inclusive) in ctx.schedule, walked both ways across month
// and range edges (guard 400 days each way), or 0 when `day` is not counted.
// Counted = primary (plus backup when groupRules.countBackupInConsecutive), or
// either role when anyRole. REAL days; the days of one holiday unit collapse to
// one only for a surgeon who opted in (holidayUnitCountsAsOneDay). The same
// walk helpers.js ttRunThrough does for the Totals view (review 9/22, item A).
function rdRunThrough(ctx, surgeonId, day, anyRole) {
  var sched = ctx.schedule, P = ctx.per[surgeonId];
  var collapse = !!(P && P.unitCollapse), countBackup = !!ctx.countBackupInConsecutive;
  function counts(d) { var e = sched[d]; if (!e) return false; if (e.primary === surgeonId) return true; return e.backup === surgeonId && (anyRole || countBackup); }
  if (!counts(day)) return 0;
  function keyOf(d) { var u = collapse ? ctx.holidayByDay[d] : null; return u ? "H:" + u.name + ":" + u.days[0] : d; }
  var keys = {}, n = 1, d, g, k;
  keys[keyOf(day)] = true;
  for (d = rdAddDays(day, -1), g = 0; g < 400 && counts(d); d = rdAddDays(d, -1), g++) { k = keyOf(d); if (!keys[k]) { keys[k] = true; n++; } }
  for (d = rdAddDays(day, 1), g = 0; g < 400 && counts(d); d = rdAddDays(d, 1), g++) { k = keyOf(d); if (!keys[k]) { keys[k] = true; n++; } }
  return n;
}

// talliesFor(ctx, surgeonId, 'YYYY-MM') -> { primary, backup, total, weekendDays,
// majorHolidays, minorHolidays, maxConsecutive, maxConsecutiveAnyRole } read live
// from ctx.schedule. The counts are month-scoped; the two run measures are the
// longest runs TOUCHING the month, each followed across the month edges (a run
// 12/30 -> 1/1 reads 3 in December and in January - review 9/22, item A).
// maxConsecutive = the run the HARD limit counts (primary-only unless
// countBackupInConsecutive); maxConsecutiveAnyRole = primary or backup (the
// SOFT limit's measure). Both are REAL day counts; the days of a holiday unit
// collapse to one only for a surgeon who opted in (holidayUnitCountsAsOneDay -
// 9/22, Prompt 12 A).
function talliesFor(ctx, surgeonId, month) {
  var days = rdMonthDays(month), sched = ctx.schedule;
  var t = { primary: 0, backup: 0, total: 0, weekendDays: 0, majorHolidays: 0, minorHolidays: 0, maxConsecutive: 0, maxConsecutiveAnyRole: 0 };
  var units = {}, prevIn = false, prevAny = false;
  var countBackup = !!ctx.countBackupInConsecutive;
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
    // measure each run once, from its first counted day inside the month (the walk reaches back before it)
    var inRun = isP || (countBackup && isB), anyRun = isP || isB;
    if (inRun && !prevIn) { var n = rdRunThrough(ctx, surgeonId, d, false); if (n > t.maxConsecutive) t.maxConsecutive = n; }
    if (anyRun && !prevAny) { var na = rdRunThrough(ctx, surgeonId, d, true); if (na > t.maxConsecutiveAnyRole) t.maxConsecutiveAnyRole = na; }
    prevIn = inRun; prevAny = anyRun;
  }
  return t;
}

// monthlyCapFor(ctx, surgeonId) -> { primary: number|null, preferred: number|null, total }
// 9/22 (Prompt 12 K): the cap is on PRIMARY days per month. 'total' is kept equal
// to 'primary' for ONE release so a UI caller mid-edit does not break; new code
// reads .primary. Remove 'total' with the next release.
function monthlyCapFor(ctx, surgeonId) {
  var P = ctx.per[surgeonId];
  var primary = P ? P.capPrimary : null;
  return { primary: primary, preferred: P ? P.capPreferred : null, total: primary };
}

/* ------------------------------------------------------ East conflict report */
// eastConflicts(ctx, days) -> [{ day, role, id, reasons }]   (Prompt 12 C.4, 9/22)
// For every day in `days` whose ctx.schedule row holds a surgeon in a role, the
// East-related HARD reasons that make that holder ineligible now: east-busy,
// east-forecast-busy:, derived-lock: (the derived surgeon held in the OTHER role
// of his derived week) and derived-lock-held: (someone else in his derived
// slot). Locks are evaluated too (ignoreLocks; a lock holder's `conflicts` are
// read) - a locked row is a fact, the report says it now collides with East. A
// holder who IS the derived surgeon in the derived role is fine. The derived
// checks are made explicitly here because eligibility() applies the yield rule
// (a held row beats a derived lock, rdDerivedOverridden) and would otherwise
// stay silent about a locked collision; when the derived surgeon himself is
// held in the other role the day is reported once, on HIS row, not on the
// other role's holder (that slot is his to lose, not theirs). Read-only: the
// schedule is never touched. Rows come out by day, primary before backup.
// Fix round (review 9/22, finding 9) - "a derived week that no longer matches":
// for a holder whose rules carry outsideDerivedWeeks.weekdayPattern the pattern
// reasons that fire only outside his derived weeks (weekday-pattern:,
// weekend-block-only) count too, on days OUTSIDE his current derived weeks and
// from his eastFeed.deriveFrom on (before it nothing was derived): when a
// derived week moves away, the primary rows he kept there fall under the
// pattern. Every holder is evaluated as a block member when he holds the whole
// Fri+Sat+Sun block in that role (rdHoldsFullBlock, as the generator does), so a
// legitimate weekend block is never reported. A former derived week where he
// holds BACKUP cannot be detected here (backup is open to him every day) -
// diagnostics.derivedYields and the calendar's E badges cover it.
var RD_EAST_CONFLICT_PREFIXES = ["east-busy", "east-forecast-busy:", "derived-lock:", "derived-lock-held:"];
var RD_EAST_PATTERN_PREFIXES = ["weekday-pattern:", "weekend-block-only"];
function rdStartsWithAny(r, prefixes) {
  for (var k = 0; k < prefixes.length; k++) { var p = prefixes[k]; if (r === p || r.indexOf(p) === 0) return true; }
  return false;
}
function rdIsEastConflictReason(r) { return rdStartsWithAny(r, RD_EAST_CONFLICT_PREFIXES); }
// Does `id` hold `role` on all three days of the Fri+Sat+Sun block containing `day`?
// (Mirrors generator.js genHoldsFullBlock: Fri = weekday index 4.)
function rdHoldsFullBlock(ctx, day, role, id) {
  var info = rdInfo(day);
  if (info.wdi < 4) return false;
  var fri = rdAddDays(day, 4 - info.wdi);
  for (var k = 0; k < 3; k++) { var e = ctx.schedule[rdAddDays(fri, k)]; if (!e || e[role] !== id) return false; }
  return true;
}
function eastConflicts(ctx, days) {
  var out = [];
  (days || []).forEach(function (day) {
    var e = ctx.schedule[day];
    if (!e) return;
    var dslot = ctx.derivedByDay[day] || null;
    ["primary", "backup"].forEach(function (role) {
      var id = e[role];
      if (!id || !ctx.per[id]) return;
      var P = ctx.per[id];
      var other = role === "primary" ? "backup" : "primary";
      // Pattern reasons count only from his eastFeed.deriveFrom on (before it nothing was
      // ever derived - Faraz's single locked 10/12 must not be listed) and outside his
      // current derived weeks.
      var efc = P.rules && P.rules.eastFeed;
      var deriveFromN = efc && efc.deriveFrom ? rdInfo(efc.deriveFrom).n : null;
      var patternCounts = !!(P.rules && P.rules.outsideDerivedWeeks && P.rules.outsideDerivedWeeks.weekdayPattern) && deriveFromN !== null && rdInfo(day).n >= deriveFromN && !P.derived[day];
      var r = eligibility(ctx, day, role, id, { ignoreLocks: true, asBlockMember: rdHoldsFullBlock(ctx, day, role, id) });
      var reasons = (r.lockHolder ? (r.conflicts || []) : (r.hard || [])).filter(function (x) { return rdIsEastConflictReason(x) || (patternCounts && rdStartsWithAny(x, RD_EAST_PATTERN_PREFIXES)); });
      if (dslot) {
        if (dslot[role] && dslot[role] !== id && e[other] !== dslot[role]) reasons.push("derived-lock-held:" + dslot[role]);
        if (dslot[other] === id) reasons.push("derived-lock:" + other);
      }
      var seen = Object.create(null);
      reasons = reasons.filter(function (x) { if (seen[x]) return false; seen[x] = true; return true; });
      if (reasons.length) out.push({ day: day, role: role, id: id, reasons: reasons });
    });
  });
  return out;
}

/* ------------------------------------------------ East vacation conflict report */
// eastVacationConflicts(ctx, schedule?) -> [{ day, role, surgeonId, state, trailingEdge? }]
// (Prompt 15 part 2, 9/23). The time_off trigger refuses a vacation over a day the
// surgeon is published (and the day before it, for primary); a DERIVED East vacation
// writes no time_off row, so nothing refuses anything - this report mirrors the
// trigger's test client-side: every held slot of `schedule` (default ctx.schedule)
// whose holder's derived days (unreviewed / away range) cover the day, plus, with
// trailingEdge: true, a held PRIMARY the day before such a range starts (the roles
// in ctx.trailingEdgeRoles). Silvis time_off days are not listed (the trigger
// already guards them). Read-only, never a block: a published lock stays; the East
// feed panel lists the rows so the person can decide 'home' or trade. Sorted by day,
// primary before backup.
function eastVacationConflicts(ctx, schedule) {
  var sched = schedule || ctx.schedule || {};
  var out = [];
  Object.keys(sched).sort().forEach(function (day) {
    var e = sched[day];
    if (!e || !rdIsDateStr(day)) return;
    ["primary", "backup"].forEach(function (role) {
      var id = e[role];
      var P = id ? ctx.per[id] : null;
      if (!P) return;
      if (P.eastVacationDays[day]) out.push({ day: day, role: role, surgeonId: id, state: P.eastVacationDays[day] });
      else if (P.eastDayBefore[day] && ctx.trailingEdgeRoles.indexOf(role) >= 0) out.push({ day: day, role: role, surgeonId: id, state: P.eastDayBefore[day], trailingEdge: true });
    });
  });
  return out;
}

if (typeof module !== "undefined") {
  module.exports = {
    HARD_REASONS: HARD_REASONS,
    matchesPattern: matchesPattern,
    buildContext: buildContext,
    eligibility: eligibility,
    eastConflicts: eastConflicts,
    eastVacationConflicts: eastVacationConflicts,
    weekendUnitPatterns: weekendUnitPatterns,
    holidayUnits: holidayUnits,
    holidayUnitCandidates: holidayUnitCandidates,
    isHolidayDay: isHolidayDay,
    resolveWeight: resolveWeight,
    defaultWeights: defaultWeights,
    talliesFor: talliesFor,
    runThrough: rdRunThrough,
    monthlyCapFor: monthlyCapFor,
    standingEastDays: standingEastDays,
    offerState: offerState,
    offeredOn: offeredOn,
    rdFmt: rdFmt,
    rdParse: rdParse,
    rdAddDays: rdAddDays,
    rdWeekday: rdWeekday,
    rdDaysBetween: rdDaysBetween
  };
}
