// Silvis Call Schedule - Date Helpers, daily-model data-layer helpers, ICS
// generation and download utilities.
// Ported from the Davenport app. Date/ICS/download utilities are kept as-is;
// the daily-model helpers (dayRowToAssignment ... payloadLooksWipedDaily) were
// added in Prompt 6 Slice A and are unit-tested by test/data-layer.test.js.
// The export builders (share page, printable month, ER Call Panels) arrived
// in Prompt 9 and are unit-tested by test/exports.test.js.
// todayCentral() / slotIsOpen(dateStr, holder, today) (Faraz 9/22): the app's
// ONE notion of today is the Central date, and an unassigned slot is OPEN only
// from today forward - before today it renders blank (no red, no pill, no
// "M/D OPEN" line, no export entry). buildWeekRows and every export builder
// take opts.today (default todayCentral()) and route OPEN through slotIsOpen.
//
// BROWSER-SAFE: this file is loaded as a classic <script>, so every top-level
// name here is a global. Names must not collide with config.js / rules.js /
// east-feed.js / generator.js. Node can also require() it (see the guard at
// the bottom) - keep it free of DOM access at top level.

/* ═══ Date helpers ═══ */
const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const parse = s => { const [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d); };
const addD = (d,n) => { const r=new Date(d); r.setDate(r.getDate()+n); return r; };
const monOf = d => { const r=new Date(d); r.setDate(r.getDate()-((r.getDay()+6)%7)); return r; };

function getMondays(yr,mo,count) {
  const ms=[], s=new Date(yr,mo,1);
  let d=monOf(s); if(d<s) d=addD(d,7);
  while(ms.length<count){ ms.push(new Date(d)); d=addD(d,7); }
  return ms;
}

/* ═══ Week start of the MONTH grids (Item A, Faraz 9/23) ═══
   The calendar view, the share page and the printable month start the week
   on Sunday by default, like the Davenport app, or on Monday by the
   per-device setting (localStorage 'silvis-week-start'). Only those three
   grids read these three helpers: monOf(), the ER-panel author's Mon-Sun week rows, the
   East weeks and the forecast are week-based and stay on Monday. */
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// 'mon' or 'sun' - anything else (missing, legacy, garbage) is Sunday.
const normalizeWeekStart = v => v === "mon" ? "mon" : "sun";
// The seven labels in grid order: Sun..Sat, or Mon..Sun for 'mon'. `names`
// (optional) is a Sunday-first list of seven to rotate instead (S M T ..).
const weekdayLabels = (weekStartsOn, names) => {
  const src = names || WEEKDAY_SHORT, s = normalizeWeekStart(weekStartsOn) === "mon" ? 1 : 0;
  return src.slice(s).concat(src.slice(0, s));
};
// Every day of a month grid as ISO strings: from the Sunday (Monday) on or
// before the 1st, padded to whole weeks past the last day (28, 35 or 42).
const monthGridDays = (year, month0, weekStartsOn) => {
  const startDow = normalizeWeekStart(weekStartsOn) === "mon" ? 1 : 0;
  const first = new Date(year, month0, 1), last = new Date(year, month0 + 1, 0);
  const out = [];
  for (let d = addD(first, -((first.getDay() - startDow + 7) % 7)); d <= last || out.length % 7 !== 0; d = addD(d, 1)) out.push(fmt(d));
  return out;
};

function onVac(id,ds,v){ return (v[id]||[]).some(([a,b])=>ds>=a&&ds<=b); }

// "10/12" from "2026-10-12" (no leading zeros) - the publish-diff convention.
function fmtMD(dayStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayStr || ""));
  if (!m) return String(dayStr || "?");
  return `${Number(m[2])}/${Number(m[3])}`;
}

// Item B (Faraz 9/23 evening): the compact vacation label of the grouped lists -
// "Nov 19-22" (en dash), a single day as one date ("Nov 19"), a cross-month
// range naming both months ("Nov 30-Dec 2"), and a year suffix only when the
// range leaves the current year: "Jan 9-10 (2027)", "Dec 30-Jan 2 (2026-2027)".
// Pure; an unparsable date falls back to the raw strings (never throws).
const VAC_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function vacRangeLabel(start, end, todayStr) {
  const rx = /^(\d{4})-(\d{2})-(\d{2})$/;
  const a = rx.exec(String(start || "")), e = end ? rx.exec(String(end)) : a;
  if (!a || !e) return end && end !== start ? String(start || "?") + "\u2013" + String(end) : String(start || "?");
  const ay = +a[1], am = +a[2] - 1, ad = +a[3], ey = +e[1], em = +e[2] - 1, ed = +e[3];
  const ty = /^\d{4}/.test(String(todayStr || "")) ? +String(todayStr).slice(0, 4) : new Date().getFullYear();
  let text = VAC_MON[am] + " " + ad;
  if (ey !== ay || em !== am) text += "\u2013" + VAC_MON[em] + " " + ed;
  else if (ed !== ad) text += "\u2013" + ed;
  if (ay !== ty || ey !== ty) text += " (" + (ay === ey ? ay : ay + "\u2013" + ey) + ")";
  return text;
}

// Item B: one group per person, in the ORDER GIVEN (the callers pass the roster
// order), from the in-memory vacations map { id: [[start, end, rowId, note], ...] }.
// Each group = { pid, upcoming, past, rows }: rows sorted by start, each
// { pid, vs, ve, id, note, past }; past rows (end < today) are counted on the
// group and listed only with showPast. A person with nothing to show is omitted.
function groupVacationRows(vacations, personIds, todayStr, showPast) {
  const out = [];
  (personIds || []).forEach(pid => {
    const list = (vacations && vacations[pid]) || [];
    const rows = list.map(([vs, ve, id, note]) => ({ pid, vs, ve, id, note, past: ve < todayStr }))
      .sort((x, y) => x.vs < y.vs ? -1 : x.vs > y.vs ? 1 : 0);
    const upcoming = rows.filter(r => !r.past).length, past = rows.length - upcoming;
    const shown = showPast ? rows : rows.filter(r => !r.past);
    if (shown.length) out.push({ pid, upcoming, past, rows: shown });
  });
  return out;
}

// Today's date as "YYYY-MM-DD" in America/Chicago - the same expression
// bump-version.js uses. The call is in Silvis, so the app has ONE notion of
// today (Central) for the today ring, the coverage strip and the OPEN logic,
// whatever device clock a travelling surgeon carries. If the runtime has no
// time-zone data the device-local date is used and a warning is logged.
function todayCentral() {
  try {
    const s = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    console.warn("todayCentral: unexpected en-CA date format, using the device date:", s);
  } catch (e) { console.warn("todayCentral: time zone data unavailable, using the device date", e); }
  return fmt(new Date());
}

// An ISO day if `v` is one, else todayCentral() - how every opts.today is read.
function todayOrCentral(v) {
  return (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : todayCentral();
}

/* ═══ The shift day (review 9/27, Do first 3) ═══
   A call day is ONE 07:00 -> 07:00 shift (America/Chicago), so from 00:00 to
   06:59 Central the pair on call NOW is the previous calendar day's. todayCentral()
   stays the calendar date (the OPEN logic, the today ring, the coverage strip,
   Mine, the board, the notices); only "who is on call now" - the today banner,
   Share today and the ?public=1 banner - reads the shift day.
   shiftClockCentral(now) -> { calendarDay, shiftDay, handoffDay, beforeHandoff }
     calendarDay   the Central calendar date of `now` (todayCentral's answer)
     shiftDay      the call day whose shift covers `now` (calendarDay, or the day
                   before when the Central hour is < 07)
     handoffDay    shiftDay + 1 - the day the current shift ends at 07:00
     beforeHandoff true between 00:00 and 06:59 Central (shiftDay !== calendarDay)
   `now` is a Date or epoch ms (default: the current time; anything else - an
   ISO string included - warns and reads the current time). Read through
   Intl.DateTimeFormat with timeZone America/Chicago and hourCycle 'h23' - never
   the device zone and never hour12 (whose "24" for midnight is a known engine
   quirk); both DST days fall out of the zone data (01:30 CDT and 01:30 CST are
   both before the handoff). With no time-zone data the device clock is used and
   a warning is logged, exactly as todayCentral does. */
const SHIFT_HANDOFF_HOUR = 7;
let shiftClockFormatter = null;
function shiftCentralParts(now) {
  if (now !== undefined && now !== null && !(now instanceof Date) && typeof now !== "number") console.warn("shiftClockCentral: `now` is neither a Date nor epoch ms, using the current time:", now);
  let d = now instanceof Date ? now : (typeof now === "number" ? new Date(now) : new Date());
  if (isNaN(d.getTime())) { console.warn("shiftClockCentral: invalid time, using the current time:", now); d = new Date(); }
  try {
    if (!shiftClockFormatter) shiftClockFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const p = {};
    shiftClockFormatter.formatToParts(d).forEach(x => { if (x.type !== "literal") p[x.type] = x.value; });
    const y = Number(p.year), m = Number(p.month), dd = Number(p.day), h = Number(p.hour), mi = Number(p.minute);
    if (y > 0 && m >= 1 && m <= 12 && dd >= 1 && dd <= 31 && h >= 0 && h <= 24 && mi >= 0 && mi <= 59) return { y, m, d: dd, h: h === 24 ? 0 : h, mi };
    console.warn("shiftClockCentral: unexpected Intl parts, using the device clock:", p);
  } catch (e) { console.warn("shiftClockCentral: time zone data unavailable, using the device clock", e); }
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() };
}
// The ISO day `n` days after the civil date y-m-d (UTC arithmetic - no device zone, no DST).
function shiftIsoPlus(y, m, d, n) {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
function shiftClockCentral(now) {
  const c = shiftCentralParts(now);
  const beforeHandoff = c.h < SHIFT_HANDOFF_HOUR;
  const back = beforeHandoff ? -1 : 0;
  return { calendarDay: shiftIsoPlus(c.y, c.m, c.d, 0), shiftDay: shiftIsoPlus(c.y, c.m, c.d, back), handoffDay: shiftIsoPlus(c.y, c.m, c.d, back + 1), beforeHandoff };
}
// shiftDayCentral(now) -> "YYYY-MM-DD": the call day whose 07:00 -> 07:00 shift covers `now` (Central).
function shiftDayCentral(now) { return shiftClockCentral(now).shiftDay; }

// onCallNow(schedule, now) -> the today banner's / Share today's view of the
// shift clock: { shiftDay, calendarDay, handoffDay, handoffDow, beforeHandoff,
// current, next } - current = schedule[shiftDay] (the pair on call now), next =
// schedule[calendarDay] before 07:00 (the pair from 07:00), else null. A missing
// row is null (the banner's HolderTag reads it OPEN - through dayHolder, never
// slotIsOpen, which answers false for yesterday's shift). Pure given `now`.
function onCallNow(schedule, now) {
  const c = shiftClockCentral(now);
  const s = schedule && typeof schedule === "object" ? schedule : {};
  return { shiftDay: c.shiftDay, calendarDay: c.calendarDay, handoffDay: c.handoffDay, handoffDow: ttDow(c.handoffDay), beforeHandoff: c.beforeHandoff,
    current: s[c.shiftDay] || null, next: c.beforeHandoff ? (s[c.calendarDay] || null) : null };
}
// onCallNowMsg(view, nameOf, loaded) -> the Share today text (names only, never contact data):
//   "Silvis call now (until 07:00 Mon): P Khan / B Acton"
//   + before 07:00 "; from 07:00: P Burchett / B Philip"
// An unassigned slot reads OPEN (holderLabel). Before the first load with no row: "Silvis call now: loading schedule".
// daysRead === false (review 9/27 Do first 1: the load finished but the schedule_days read never landed, so the map
// is not the table): "Silvis call now: schedule not loaded" - never OPEN. Omitted (older callers) = read.
function onCallNowMsg(view, nameOf, loaded, daysRead) {
  const v = view || {};
  if (!loaded && !v.current) return "Silvis call now: loading schedule";
  if (daysRead === false) return "Silvis call now: schedule not loaded";
  const pair = (a) => `P ${holderLabel(dayHolder(a, "primary"), nameOf)} / B ${holderLabel(dayHolder(a, "backup"), nameOf)}`;
  let msg = `Silvis call now (until 07:00 ${v.handoffDow || "?"}): ${pair(v.current)}`;
  if (v.beforeHandoff) msg += `; from 07:00: ${pair(v.next)}`;
  return msg;
}

/* ═══ Group call (Faraz 9/29, Prompt 22 - current practice, written down) ═══
   On weekdays, from the 07:00 handoff until ownPatientsUntil (17:00), each provider takes their own patients' calls. On
   weeknights from then, on weekends and - holidayUnitDaysAllDay - on every day of a holiday unit (the reading call pay
   uses: holidayNameByDay / payHolidaySet), the Trauma primary on call also takes the clinic's patient calls: "group
   call". DATA: groupRules.groupCall, each absent / junk key falling back to GROUP_CALL_DEFAULTS (the OP_NOTICE_DEFAULTS
   pattern - the live blob needs no edit). The blob is anon-readable: the rule only, no names, no reasons. */
const GROUP_CALL_DEFAULTS = { enabled: true, ownPatientsUntil: "17:00", holidayUnitDaysAllDay: true };
// groupCallRules(groupRules) -> { enabled, ownPatientsUntil, untilMinutes, holidayUnitDaysAllDay }. enabled and
// holidayUnitDaysAllDay are booleans (anything else -> the default); ownPatientsUntil is "HH:MM", 00:00-23:59 (anything
// else -> "17:00"); untilMinutes is its minute of the day. A time at or before the 07:00 handoff leaves no own-patients
// window: group call around the clock. Pure.
function groupCallRules(groupRules) {
  const G = groupRules && typeof groupRules === "object" ? groupRules.groupCall : null;
  const g = G && typeof G === "object" && !Array.isArray(G) ? G : {};
  const bool = (v, d) => (typeof v === "boolean" ? v : d);
  const m = typeof g.ownPatientsUntil === "string" ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(g.ownPatientsUntil.trim()) : null;
  const until = m ? m[1] + ":" + m[2] : GROUP_CALL_DEFAULTS.ownPatientsUntil;
  return { enabled: bool(g.enabled, GROUP_CALL_DEFAULTS.enabled), ownPatientsUntil: until,
    untilMinutes: Number(until.slice(0, 2)) * 60 + Number(until.slice(3)),
    holidayUnitDaysAllDay: bool(g.holidayUnitDaysAllDay, GROUP_CALL_DEFAULTS.holidayUnitDaysAllDay) };
}
// groupCallTimeLabel("17:00") -> "5 PM"; "18:30" -> "6:30 PM"; "12:00" -> "12 PM"; "00:15" -> "12:15 AM". Anything that is
// not "HH:MM" reads as the default time's label.
function groupCallTimeLabel(hhmm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || "").trim()) || /^(\d\d):(\d\d)$/.exec(GROUP_CALL_DEFAULTS.ownPatientsUntil);
  const h = Number(m[1]), mi = Number(m[2]);
  return (h % 12 === 0 ? 12 : h % 12) + (mi ? ":" + m[2] : "") + (h < 12 ? " AM" : " PM");
}
// groupCallRuleSentence(groupRules) -> the rule in one or two sentences, built from the data (the banner, the printable
// month and the share page all show it); "" when group call is disabled. Faraz 9/29's wording:
//   "Group call: weekdays until 5 PM, each provider takes their own patients' calls. Weeknights from 5 PM, weekends and
//    holidays, the Trauma primary takes group call."
// holidayUnitDaysAllDay false drops "and holidays" (a weekday holiday then follows the weekday rule); a time at or before the
// 07:00 handoff leaves no own-patients window, so the sentence says the Trauma primary takes group call at all hours.
function groupCallRuleSentence(groupRules) {
  const R = groupCallRules(groupRules);
  if (!R.enabled) return "";
  if (R.untilMinutes <= SHIFT_HANDOFF_HOUR * 60) return "Group call: the Trauma primary takes group call at all hours.";
  const t = groupCallTimeLabel(R.ownPatientsUntil);
  return `Group call: weekdays until ${t}, each provider takes their own patients' calls. ` +
    (R.holidayUnitDaysAllDay ? `Weeknights from ${t}, weekends and holidays, the Trauma primary takes group call.` : `Weeknights from ${t} and weekends, the Trauma primary takes group call.`);
}
// groupCallNow(schedule, now, { groupRules, holidays }) -> who takes the clinic's patient calls at `now`, in Central time
// whatever the device zone (shiftClockCentral's reading; `now` = a Date or epoch ms, default the current time):
//   null  group call is disabled (groupRules.groupCall.enabled === false)
//   { mode: "own", day, until, untilLabel, entry, holder }
//         a Mon-Fri Central calendar day that is not a holiday-unit day (when holidayUnitDaysAllDay; holidayNameByDay's
//         shapes), from the 07:00 handoff until ownPatientsUntil: each provider takes their own patients' calls; entry /
//         holder = that day's primary, who takes group call from `until`
//   { mode: "group", day, until: null, untilLabel: null, entry, holder }
//         any other moment: the Trauma primary of onCallNow(...).current - day is its shift day (before 07:00, the previous
//         calendar day), so a split weekend changes hands at 07:00
// entry is the schedule row or null (a missing row) - the banner hands it to HolderTag with role "primary", which reads
// loading / not loaded / OPEN / an external cover exactly as the On call now banner does; holder = dayHolder(entry,
// "primary"): a roster id, "ext:<name>" or null (OPEN). Pure given `now`.
function groupCallNow(schedule, now, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const R = groupCallRules(o.groupRules);
  if (!R.enabled) return null;
  // one instant for both readings (the own-window test and onCallNow), so a default `now` cannot straddle a boundary
  let t = now;
  if (t === undefined || t === null) t = Date.now();
  else if (!(t instanceof Date) && typeof t !== "number") { console.warn("groupCallNow: `now` is neither a Date nor epoch ms, using the current time:", now); t = Date.now(); }
  else if (isNaN(t instanceof Date ? t.getTime() : t)) { console.warn("groupCallNow: invalid time, using the current time:", now); t = Date.now(); }
  const s = schedule && typeof schedule === "object" ? schedule : {};
  const c = shiftCentralParts(t);
  const cal = shiftIsoPlus(c.y, c.m, c.d, 0);
  const dow = ttDow(cal);
  const holidayDay = R.holidayUnitDaysAllDay && !!holidayNameByDay(o.holidays)[cal];
  const minute = c.h * 60 + c.mi;
  if (dow !== "Sat" && dow !== "Sun" && !holidayDay && minute >= SHIFT_HANDOFF_HOUR * 60 && minute < R.untilMinutes) {
    const entry = s[cal] || null;
    return { mode: "own", day: cal, until: R.ownPatientsUntil, untilLabel: groupCallTimeLabel(R.ownPatientsUntil), entry, holder: dayHolder(entry, "primary") };
  }
  const oc = onCallNow(s, t);
  return { mode: "group", day: oc.shiftDay, until: null, untilLabel: null, entry: oc.current, holder: dayHolder(oc.current, "primary") };
}

// slotIsOpen(dateStr, holder, today) -> true iff the slot has NO holder
// (null / undefined / "") AND dateStr is today or later (today inclusive,
// both ISO strings). An unassigned slot before today is not OPEN - nobody can
// be paged for a day that has passed - so the grid, the week rows and every
// export render it blank (Faraz 9/22). A roster id or "ext:<name>" is a
// holder. A missing or malformed today falls back to todayCentral(). Pure.
function slotIsOpen(dateStr, holder, today) {
  if (holder !== null && holder !== undefined && holder !== "") return false;
  return String(dateStr || "") >= todayOrCentral(today);
}

/* ═══ ONE definition of "open" (Faraz 9/22, Prompt 13 part 1) ═══
   openSlots(schedule, from, to, today, opts) -> [{ day, role, unit, reason }]
   for every day in [from, to] (inclusive, ISO strings) that is >= today
   (inclusive; a missing/malformed today is todayCentral()) where the role is
   unassigned: primary = no primary AND no externalCover; backup = no backup
   (dayHolder - an external cover stands in for the primary). A day with NO
   row inside the range is open in both roles. Sorted by day, then primary
   before backup. Invalid inputs -> [] (never throws).
   opts (all optional):
     holidayByDay  { 'YYYY-MM-DD': { name, days } }  (rulesCtx.holidayByDay)
     weekendKinds  { '<friday>': 'block'|'split'|'daily' }  (openSlotWeekendKinds(diagnostics.weekendUnits))
     reasons       { 'YYYY-MM-DD|primary': string }  (openSlotKey; the last generate's operational reasons)
   unit is decided PER DAY, as generator.js buildUnits builds its units:
   { kind: 'holiday', name } on a holiday-unit day, else { kind: 'weekend',
   pattern: weekendKinds[friday] || null, friday } on any Fri/Sat/Sun - also
   the leftover day(s) of a weekend a holiday unit pre-empts (the generator
   makes a reduced weekend unit of them; tradeUnitOf voiding a whole BLOCK
   trade over such a weekend is a trading rule, not a unit) - else null.
   reason = opts.reasons[openSlotKey(day, role)] trimmed, or null when absent
   or whitespace (so the board and openSlotsLine agree). from/to must be real
   calendar days ('2026-13-40' is ISO-shaped but -> []), from <= to.
   The coverage strip (suCoverageGlance), the calendar's only-OPEN filter, the
   Open shifts board, the publish hook and the weekly reminder ALL read this
   list; part 5 mirrors it in TypeScript in edge-functions/daily-reminder/
   index.ts against test/fixtures/open-slots.json (schedule_days columns
   primary_id / backup_id / external_cover -> primary / backup / externalCover;
   a lock flag never holds a slot). There is no second place that decides what
   "open" means - slotIsOpen above is the per-slot rendering of the same rule
   (holder empty AND day >= today) for one cell. Pure. */
const OPEN_SLOT_ROLES = ["primary", "backup"];
function openSlotKey(day, role) { return day + "|" + role; }
// A real calendar day in ISO form: suIsIso shape AND it survives a parse/fmt round trip.
function openSlotIsDay(s) { return suIsIso(s) && fmt(parse(s)) === s; }
function openSlotUnit(day, holidayByDay, weekendKinds) {
  const hol = holidayByDay && typeof holidayByDay === "object" ? holidayByDay[day] : null;
  if (hol && typeof hol === "object") return { kind: "holiday", name: hol.name || null };
  const dow = parse(day).getDay(); // 0 Sun ... 6 Sat
  if (dow !== 5 && dow !== 6 && dow !== 0) return null;
  const friday = dow === 5 ? day : suAddDays(day, dow === 6 ? -1 : -2);
  const kinds = weekendKinds && typeof weekendKinds === "object" ? weekendKinds : {};
  const k = kinds[friday];
  return { kind: "weekend", pattern: k === "block" || k === "split" || k === "daily" ? k : null, friday: friday };
}
function openSlots(schedule, from, to, today, opts) {
  if (!openSlotIsDay(from) || !openSlotIsDay(to) || from > to) return [];
  const sched = schedule && typeof schedule === "object" ? schedule : {};
  const o = opts && typeof opts === "object" ? opts : {};
  const reasons = o.reasons && typeof o.reasons === "object" ? o.reasons : {};
  const t = todayOrCentral(today);
  // slotIsOpen(d, holder, t) is THE predicate (item Q): no holder AND d >= t.
  // The clip to t below is the same rule applied once to the range (a day
  // before today never yields an entry), not a second definition.
  const start = from < t ? t : from;
  if (start > to) return [];
  const out = [];
  const n = suDaysBetween(start, to);
  for (let k = 0; k <= n; k++) {
    const d = suAddDays(start, k);
    const a = sched[d] || null;
    let unit;
    OPEN_SLOT_ROLES.forEach(role => {
      if (!slotIsOpen(d, dayHolder(a, role), t)) return; // held (roster id, outside surgeon, "ext:<cover>" for primary) or before today
      if (unit === undefined) unit = openSlotUnit(d, o.holidayByDay, o.weekendKinds);
      const r = reasons[openSlotKey(d, role)];
      const reason = typeof r === "string" ? r.trim() : "";
      out.push({ day: d, role: role, unit: unit, reason: reason || null });
    });
  }
  return out;
}
// openSlotCounts(list) -> { primary, backup, total } (the nav badge / strip numbers).
function openSlotCounts(list) {
  const out = { primary: 0, backup: 0, total: 0 };
  (Array.isArray(list) ? list : []).forEach(s => { if (s && (s.role === "primary" || s.role === "backup")) { out[s.role]++; out.total++; } });
  return out;
}
// openSlotWeekendKinds(diagnostics.weekendUnits | { '<friday>': kind }) -> { '<friday>': 'block'|'split'|'daily' }
// (locked / open / unfilled units carry no pattern and are left out). The map
// form is the persisted lastGenerate.weekendKinds (part 4), validated the same way.
function openSlotWeekendKinds(weekendUnits) {
  const out = {};
  const keep = (friday, kind) => { if (suIsIso(friday) && (kind === "block" || kind === "split" || kind === "daily")) out[friday] = kind; };
  if (Array.isArray(weekendUnits)) weekendUnits.forEach(u => { if (u && typeof u === "object") keep(u.friday, u.kind); });
  else if (weekendUnits && typeof weekendUnits === "object") Object.keys(weekendUnits).forEach(f => keep(f, weekendUnits[f]));
  return out;
}
/* openSlotReason(reasonsById) -> 'no eligible surgeon - <categories>' (Prompt 13 part 4).
   reasonsById is one diagnostics.uncovered[i].reasons: { surgeonId: [hardCode...] }
   where a hard code is a rules.js vocabulary entry (rules.HARD_REASONS) with an
   optional ':detail' and, on a holiday-unit day, an '@YYYY-MM-DD' suffix. Only
   the code's PREFIX is read: it maps to one category of the fixed table below,
   the categories are unioned across the surgeons and joined in table order;
   a prefix the table does not know (a renamed rule) reads 'other rules'. The
   generator's two placeholders (eligible-but-not-placed, holiday-unit:
   eligible-but-unit-not-filled - generator.js flags them 'generator bug,
   report it') mean someone WAS eligible, so they never read as a rules outcome:
   the sentence is 'generator could not place - report it', with the other
   surgeons' categories in parentheses when there are any. The sentence is
   written to the anon-readable blob and shown on the board, so it never
   carries an id, a name, a date or any free text from the input -
   test/open-shifts.test.js runs every vocabulary code through the importer's
   denylist gate (Prompt 12 F). No category at all (no active surgeon, junk
   input) -> 'no eligible surgeon'.
   Item E3 (Faraz 9/25: "The open-shifts notice drops its East reason sentences
   for everyone; say 'not available' instead"): the four East codes (east-busy,
   east-forecast-busy, derived-lock, derived-lock-held) share ONE category,
   'not available', in the row the two East categories ('East feed busy',
   'East-derived week') had - so a slot whose reasons were vacations + East reads
   'no eligible surgeon - vacations, not available', once. The sentence reaches
   the board's Why column, in-app Alerts and the group e-mail (Accept & Publish,
   'Email the group now' and the Monday cron, which relays the stored sentence);
   a sentence stored before 9/25 is brought up to date where it is read
   (openSlotReasonCurrent below; an Alerts row already posted through
   openSlotsMessageCurrent). */
const OPEN_SLOT_REASON_TABLE = [
  ["vacations", ["time-off", "day-before-vacation"]],
  ["weekday patterns and stated availability", ["hard-never-weekday", "weekday-not-allowed", "recurring-unavailable", "not-recurring-available", "whitelist-month", "outside-available-weeks", "outside-window", "weekday-pattern", "weekend-block-only", "day-before-aledo", "unavailable-row", "no-backup-row", "backup-only-row", "not-offered", "lone-weekend-day"]],
  ["not available", ["east-busy", "east-forecast-busy", "derived-lock", "derived-lock-held"]], // Item E3 (9/25): East busy / forecast-busy / derived weeks, named for nobody
  ["caps reached", ["monthly-cap", "backup-cap", "backup-weekend-cap", "max-consecutive", "max-major-holidays"]],
  ["already on call that day", ["holds-other-role"]],
  ["holiday opt-outs", ["holiday-opt-out"]],
  ["backup opt-outs", ["backup-opt-out"]],
  ["locks", ["slot-locked", "external-cover", "external-surgeon", "inactive", "unknown-surgeon"]], // external-surgeon: item M, an outside surgeon is never a candidate
];
const OPEN_SLOT_REASON_OTHER = "other rules";
// generator.js placeholders (not rules codes): the surgeon passed eligibility, the generator still left the slot open.
const OPEN_SLOT_REASON_UNPLACED = "generator could not place - report it";
const OPEN_SLOT_UNPLACED_CODES = ["eligible-but-not-placed", "holiday-unit"];
const OPEN_SLOT_REASON_BY_CODE = {};
OPEN_SLOT_REASON_TABLE.forEach(row => row[1].forEach(code => { OPEN_SLOT_REASON_BY_CODE[code] = row[0]; }));
OPEN_SLOT_UNPLACED_CODES.forEach(code => { OPEN_SLOT_REASON_BY_CODE[code] = OPEN_SLOT_REASON_UNPLACED; });
function openSlotReasonCategory(code) {
  const core = String(code).split("@")[0].split(":")[0].trim();
  return OPEN_SLOT_REASON_BY_CODE[core] || OPEN_SLOT_REASON_OTHER;
}
function openSlotReason(reasonsById) {
  const seen = {};
  const src = reasonsById && typeof reasonsById === "object" ? reasonsById : {};
  Object.keys(src).forEach(id => {
    const list = Array.isArray(src[id]) ? src[id] : [src[id]];
    list.forEach(code => { if (typeof code === "string") seen[openSlotReasonCategory(code)] = true; });
  });
  const cats = OPEN_SLOT_REASON_TABLE.map(row => row[0]).concat([OPEN_SLOT_REASON_OTHER]).filter(c => seen[c]);
  if (seen[OPEN_SLOT_REASON_UNPLACED]) return cats.length ? OPEN_SLOT_REASON_UNPLACED + " (other surgeons: " + cats.join(", ") + ")" : OPEN_SLOT_REASON_UNPLACED;
  return cats.length ? "no eligible surgeon - " + cats.join(", ") : "no eligible surgeon";
}
/* openSlotReasonCurrent(reason) -> a STORED reason sentence in today's vocabulary (Item E3, Faraz 9/25). A sentence
   written before 9/25 (blob lastGenerate.openSlots[i].reason) may name the two retired East categories 'East feed
   busy' / 'East-derived week'; both read 'not available' now. The category list after 'no eligible surgeon - ' (or
   inside the placeholder's '(other surgeons: ...)') is renamed, deduplicated and put back in table order; a sentence
   without a retired category is returned unchanged (byte for byte), and so is a non-string; a sentence that names one
   is matched trimmed (a stored value with stray whitespace is still brought up to date - review 9/25). Read-side only:
   the board's reasons map (index-source.html boardReasons), the carry-over of an earlier record
   (lastGenerateFromDiagnostics) and the Alerts feed's open_shifts rows (openSlotsMessageCurrent below) call it; the blob
   itself is rewritten by the next Accept & Publish. The Monday cron (daily-reminder, 5c) relays the stored text as is
   until then - its job, silvis-open-shifts-weekly, is active (edge-functions/README.md section 4; read-only cron.job
   check 2026-09-28, first observed run 2026-09-28 12:00Z). Pure. */
const OPEN_SLOT_REASON_RETIRED = { "East feed busy": "not available", "East-derived week": "not available" };
function openSlotReasonCurrent(reason) {
  if (typeof reason !== "string" || !Object.keys(OPEN_SLOT_REASON_RETIRED).some(k => reason.indexOf(k) >= 0)) return reason;
  const order = OPEN_SLOT_REASON_TABLE.map(row => row[0]).concat([OPEN_SLOT_REASON_OTHER]);
  const fix = (list) => {
    const cats = [];
    list.split(", ").forEach(c => { const n = OPEN_SLOT_REASON_RETIRED[c] || c; if (cats.indexOf(n) < 0) cats.push(n); });
    const known = cats.filter(c => order.indexOf(c) >= 0).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return known.concat(cats.filter(c => order.indexOf(c) < 0)).join(", ");
  };
  const t = reason.trim();
  let m = /^(no eligible surgeon - )(.+)$/.exec(t);
  if (m) return m[1] + fix(m[2]);
  m = /^(generator could not place - report it [(]other surgeons: )(.+)([)])$/.exec(t);
  if (m) return m[1] + fix(m[2]) + m[3];
  return reason;
}
/* openSlotsMessageCurrent(message) -> an open_shifts notice's STORED message (a notifications row: Accept & Publish,
   'Email the group now', the Monday cron) in today's vocabulary (Item E3, Faraz 9/25: "drops its East reason sentences
   for everyone"). Each slot line ('  Fri 11/06 - primary (weekend block) - open - <reason>', openSlotsLine) has its
   reason run through openSlotReasonCurrent; every other line, and a message that names no retired category, is returned
   unchanged (byte for byte), and so is a non-string. Read-side only - the Alerts feed and the browser notification;
   the row itself is never rewritten. Pure. */
function openSlotsMessageCurrent(message) {
  if (typeof message !== "string" || !Object.keys(OPEN_SLOT_REASON_RETIRED).some(k => message.indexOf(k) >= 0)) return message;
  return message.split("\n").map(line => {
    const m = /^(.*? - open - )(.+)$/.exec(line);
    return m ? m[1] + openSlotReasonCurrent(m[2]) : line;
  }).join("\n");
}
/* lastGenerateFromDiagnostics(diagnostics, atIso) -> { at, range: { start, end },
   openSlots: [{ day, role, reason }], weekendKinds: { '<friday>': kind } } - the
   record Accept & Publish stores as call_schedule_data.data.lastGenerate (a blob
   key next to lastPublished, so it survives every autosave and reload). The
   blob is anon-readable: the record carries the rendered operational sentence
   per open slot and NOTHING else from the diagnostics (no ids, tallies,
   penalties, nor the reasons map). openSlots are sorted by day then role
   (primary first); junk days / roles are dropped; a missing atIso is stamped
   now. Never throws. The board reads openSlots as its Why column and
   weekendKinds as the unit patterns (openSlots(..., { reasons, weekendKinds })).
   P13R (9/23, the Prompt 12 head): the record also carries the run's
   mode ("generate" | "fill-open-only", item T) and fixedSlots (the fixed count:
   locks, outside surgeons, claims and trades; null when the diagnostics have
   none) - the board's "last generated" line reads them. The optional third
   argument is the PREVIOUS record: a run over a sub-range (the October
   fill-open-only backfill, item AB's first-open start) must not erase the
   reasons an earlier run recorded for days OUTSIDE its range, so those slots
   (and the weekend kinds of Fridays outside the range) are carried over and
   the record then carries carriedFrom = the earlier record's at. Slots inside
   the new range are always the new run's. */
function lastGenerateFromDiagnostics(diagnostics, atIso, previous) {
  const dg = diagnostics && typeof diagnostics === "object" ? diagnostics : {};
  const range = dg.range && typeof dg.range === "object" ? dg.range : {};
  const start = openSlotIsDay(range.start) ? range.start : null, end = openSlotIsDay(range.end) ? range.end : null;
  const bySlot = (a, b) => a.day < b.day ? -1 : a.day > b.day ? 1 : OPEN_SLOT_ROLES.indexOf(a.role) - OPEN_SLOT_ROLES.indexOf(b.role);
  const fresh = (Array.isArray(dg.uncovered) ? dg.uncovered : [])
    .filter(u => u && typeof u === "object" && openSlotIsDay(u.day) && OPEN_SLOT_ROLES.indexOf(u.role) >= 0)
    .map(u => ({ day: u.day, role: u.role, reason: openSlotReason(u.reasons) }));
  const prev = previous && typeof previous === "object" && start && end ? previous : null;
  const carried = (prev && Array.isArray(prev.openSlots) ? prev.openSlots : [])
    .filter(u => u && typeof u === "object" && openSlotIsDay(u.day) && OPEN_SLOT_ROLES.indexOf(u.role) >= 0 && (u.day < start || u.day > end) && typeof u.reason === "string" && u.reason.trim())
    .map(u => ({ day: u.day, role: u.role, reason: openSlotReasonCurrent(u.reason.trim()) })); // Item E3: a carried pre-9/25 sentence is brought up to date
  const weekendKinds = openSlotWeekendKinds(dg.weekendUnits);
  const prevKinds = prev ? openSlotWeekendKinds(prev.weekendKinds) : {};
  Object.keys(prevKinds).forEach(f => { if ((f < start || f > end) && weekendKinds[f] === undefined) weekendKinds[f] = prevKinds[f]; });
  const out = {
    at: typeof atIso === "string" && atIso ? atIso : new Date().toISOString(),
    range: { start: start, end: end },
    mode: dg.mode === "fill-open-only" ? "fill-open-only" : "generate",
    fixedSlots: Number.isInteger(dg.fixedSlots) && dg.fixedSlots >= 0 ? dg.fixedSlots : null,
    openSlots: fresh.concat(carried).sort(bySlot),
    weekendKinds: weekendKinds,
  };
  if (carried.length) out.carriedFrom = typeof prev.at === "string" && prev.at ? prev.at : null;
  return out;
}
// openSlotsLine(slot, nameOfUnit?) -> 'Fri 11/06 - primary (weekend block) - open'
// - the plain-text line the board's Copy list and the reminder e-mail use:
// weekday + MM/DD from the date, the unit in parentheses ('weekend block',
// 'weekend' when the pattern is unknown, 'holiday: Thanksgiving'; none for a
// plain day), then '- open' and ' - <reason>' when the slot carries one.
// nameOfUnit(unit) -> string overrides the parenthesised text ('' drops it).
const OPEN_SLOT_DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function openSlotsLine(slot, nameOfUnit) {
  const s = slot || {};
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s.day || ""));
  const when = m ? OPEN_SLOT_DOW[parse(s.day).getDay()] + " " + m[2] + "/" + m[3] : String(s.day || "?");
  const u = s.unit && typeof s.unit === "object" ? s.unit : null;
  let unitText = "";
  if (typeof nameOfUnit === "function") unitText = u ? String(nameOfUnit(u) || "") : "";
  else if (u && u.kind === "holiday") unitText = "holiday: " + (u.name || "unit");
  else if (u && u.kind === "weekend") unitText = "weekend" + (u.pattern ? " " + u.pattern : "");
  const reason = typeof s.reason === "string" && s.reason.trim() ? " - " + s.reason.trim() : "";
  return when + " - " + (s.role || "?") + (unitText ? " (" + unitText + ")" : "") + " - open" + reason;
}
// openShiftsEmail(slots, opts) -> { subject, message, detail, through, count, slots }
// The ONE composer of the group notice about open shifts (Prompt 13 part 5):
// Accept & Publish (5a), the board's "Email the group now" (5b) and - mirrored
// in plain JS between the @openSlots-mirror markers of
// edge-functions/daily-reminder/index.ts, checked against the same fixtures
// (test/fixtures/open-slots.json + open-shifts-email.json) by
// test/open-shifts.test.js - the Monday cron (5c) all send exactly this.
//   subject  'N open shifts through M/D'  (fmtMD - no leading zeros; also the
//            feed row's title)
//   message  one lead line, then the slots grouped by their Monday week:
//              'Week of Mon 11/2:' followed by one openSlotsLine per slot,
//              indented two spaces ('  Fri 11/06 - primary (weekend block) - open')
//   detail   'Take this shift: <appUrl>#openshifts' - the deep link the app
//            routes to the Open shifts board once signed in
// opts: a string (the appUrl) or { appUrl, through, nameOfUnit }. through
// (ISO) defaults to the last slot's day and is never EARLIER than it (the
// board's list carries the open slots of an assigned range beyond the
// published block, e.g. a holiday unit - the subject then names that day, not
// the block's end); nameOfUnit reaches openSlotsLine.
// Junk entries are dropped, the list is sorted by day then primary before
// backup whatever the input order, no slots -> count 0 with a 'fully covered'
// message. Operational wording only - no names, no addresses. Pure.
function openShiftsEmail(slots, opts) {
  const o = typeof opts === "string" ? { appUrl: opts } : (opts && typeof opts === "object" ? opts : {});
  const list = (Array.isArray(slots) ? slots : []).filter(s => s && typeof s === "object" && openSlotIsDay(s.day) && (s.role === "primary" || s.role === "backup"));
  list.sort((a, b) => a.day < b.day ? -1 : a.day > b.day ? 1 : a.role === b.role ? 0 : a.role === "primary" ? -1 : 1);
  const n = list.length;
  const lastDay = n ? list[n - 1].day : null;
  const through = openSlotIsDay(o.through) && (!lastDay || o.through >= lastDay) ? o.through : lastDay;
  const thruText = through ? " through " + fmtMD(through) : "";
  const subject = n + " open shift" + (n === 1 ? "" : "s") + thruText;
  const appUrl = typeof o.appUrl === "string" && o.appUrl.trim() ? o.appUrl.trim() : "";
  const detail = "Take this shift: " + (appUrl ? appUrl + "#openshifts" : "open the Open shifts view in the app");
  const weeks = [];
  list.forEach(s => {
    const monday = fmt(monOf(parse(s.day)));
    let w = weeks.length ? weeks[weeks.length - 1] : null;
    if (!w || w.monday !== monday) { w = { monday: monday, lines: [] }; weeks.push(w); }
    w.lines.push("  " + openSlotsLine(s, o.nameOfUnit));
  });
  const lead = n + " open call shift" + (n === 1 ? "" : "s") + thruText + " (one 24-hour shift each, 07:00 to 07:00). Take one from the Open shifts board - the link is below.";
  const message = n
    ? lead + "\n\n" + weeks.map(w => "Week of Mon " + fmtMD(w.monday) + ":\n" + w.lines.join("\n")).join("\n\n")
    : "No open shifts - every published day is covered.";
  return { subject: subject, message: message, detail: detail, through: through, count: n, slots: list.map(s => ({ day: s.day, role: s.role })) };
}
// obBoardRows(slots, { today, horizonDays, role, weekendOnly }) -> the Open
// shifts board's visible rows (Prompt 13 part 3): a filtered copy of an
// openSlots() list, order kept. horizonDays n (> 0) keeps day <= today + n - 1
// (30 -> today .. today+29); anything else ('all', null, 0) keeps every day.
// role 'primary' | 'backup' keeps that role; anything else keeps both.
// weekendOnly keeps Fri / Sat / Sun by CALENDAR day (a holiday-unit day that
// falls on a weekend day still counts - the filter is about the weekend, not
// the unit). Entries without an ISO day are dropped; junk input -> []. Pure.
// The nav badge never goes through this filter - it counts the whole list.
function obBoardRows(slots, filters) {
  const f = filters && typeof filters === "object" ? filters : {};
  const list = (Array.isArray(slots) ? slots : []).filter(s => s && typeof s === "object" && suIsIso(s.day));
  const n = Number(f.horizonDays);
  const last = Number.isFinite(n) && n > 0 ? suAddDays(todayOrCentral(f.today), Math.floor(n) - 1) : null;
  const role = f.role === "primary" || f.role === "backup" ? f.role : null;
  return list.filter(s => {
    if (last && s.day > last) return false;
    if (role && s.role !== role) return false;
    if (f.weekendOnly) { const w = parse(s.day).getDay(); if (w !== 5 && w !== 6 && w !== 0) return false; }
    return true;
  });
}
// obLastAnnounced(notifications, day, role) -> created_at (ISO) of the newest
// feed row of type 'open_shifts' whose data.slots lists { day, role }, else
// null ('never'). Input order does not matter; junk rows are skipped. Pure.
function obLastAnnounced(notifications, day, role) {
  let best = null;
  (Array.isArray(notifications) ? notifications : []).forEach(n => {
    if (!n || n.type !== "open_shifts" || typeof n.created_at !== "string" || !n.created_at) return;
    const slots = n.data && Array.isArray(n.data.slots) ? n.data.slots : [];
    if (!slots.some(s => s && s.day === day && s.role === role)) return;
    if (!best || n.created_at > best) best = n.created_at;
  });
  return best;
}
// obBoardSlots(schedule, today, lastPublishedDay, opts) -> { slots, end, ranges }
// The Open shifts board's list (Prompt 13 part 3, fix round): openSlots over
// today..lastPublishedDay (the contiguous published block, suLastContiguousDay),
// THEN the open slots of every ASSIGNED range after it (suLaterAssignedRanges -
// e.g. a pre-assigned holiday unit weeks beyond the block; claim_open_slot
// accepts those days because its range is min..max of schedule_days). Days
// with no row in a gap stay out - Generate covers them - and so does a stray
// row nobody holds. No published day (lastPublishedDay null) -> no slots:
// never today's two phantom rows. `end` echoes the block's last day (null
// when none), `ranges` the later [{ start, end }] that reach today. opts are
// openSlots' (holidayByDay / weekendKinds / reasons). Pure.
function obBoardSlots(schedule, today, lastPublishedDay, opts) {
  const t = todayOrCentral(today);
  const end = suIsIso(lastPublishedDay) ? lastPublishedDay : null;
  if (!end) return { slots: [], end: null, ranges: [] };
  const slots = openSlots(schedule, t, end, t, opts);
  const ranges = suLaterAssignedRanges(schedule, end).filter(r => r.end >= t);
  ranges.forEach(r => { openSlots(schedule, r.start, r.end, t, opts).forEach(s => slots.push(s)); });
  return { slots: slots, end: end, ranges: ranges };
}
// obUnitMates(slots, slot) -> the OTHER open slots of the same unit in the same
// role (the confirm sheet names them: the schedule keeps one primary + one
// backup through a unit, so a single-day claim leaves the rest open). A
// holiday unit matches by name within the same week (a next-year unit of the
// same name is a different unit); a weekend matches by its Friday and only
// when the pattern is 'block' (split / daily weekends are meant to be taken
// day by day; an unknown pattern says nothing). No unit -> []. Pure.
function obUnitMates(slots, slot) {
  const s = slot && typeof slot === "object" ? slot : null;
  const u = s && s.unit && typeof s.unit === "object" ? s.unit : null;
  if (!s || !u || !suIsIso(s.day) || (s.role !== "primary" && s.role !== "backup")) return [];
  if (u.kind === "weekend" && u.pattern !== "block") return [];
  if (u.kind !== "holiday" && u.kind !== "weekend") return [];
  return (Array.isArray(slots) ? slots : []).filter(o => {
    if (!o || o === s || o.role !== s.role || o.day === s.day || !suIsIso(o.day) || !o.unit || o.unit.kind !== u.kind) return false;
    if (u.kind === "holiday") return (o.unit.name || null) === (u.name || null) && Math.abs(suDaysBetween(s.day, o.day)) <= 6;
    return o.unit.friday === u.friday;
  });
}

/* ═══ DAILY MODEL - row <-> assignment ═══
   In-memory: schedule = { "YYYY-MM-DD": { primary, backup, primaryLocked,
   backupLocked, source, externalCover, note } }. Persisted: one row per day in
   schedule_days (see sql/schema.sql). These two are the ONLY translators. */
function emptyDayAssignment() {
  return { primary: null, backup: null, primaryLocked: false, backupLocked: false, source: null, externalCover: null, note: null };
}

function dayRowToAssignment(row) {
  if (!row || typeof row !== "object") return emptyDayAssignment();
  return {
    primary: row.primary_id || null,
    backup: row.backup_id || null,
    primaryLocked: row.primary_locked === true,
    backupLocked: row.backup_locked === true,
    source: row.source || null,
    externalCover: row.external_cover || null,
    note: (row.note === undefined || row.note === null || row.note === "") ? null : String(row.note),
  };
}

// version / updated_by / updated_at are NOT part of the row body here - the
// CAS sync adds them per write (they are write-time facts, not assignment facts).
function assignmentToDayRow(day, a) {
  const x = a || {};
  return {
    day: day,
    primary_id: x.primary || null,
    backup_id: x.backup || null,
    primary_locked: x.primaryLocked === true,
    backup_locked: x.backupLocked === true,
    source: x.source || null,
    external_cover: x.externalCover || null,
    note: (x.note === undefined || x.note === null || x.note === "") ? null : String(x.note),
  };
}

// True when two in-memory assignments persist to the same schedule_days row
// body (version / updated_by / updated_at excluded). null/undefined read as an
// empty day, so "no row" and "an OPEN row" compare equal.
function sameDayAssignment(day, a, b) {
  return JSON.stringify(assignmentToDayRow(day, a || emptyDayAssignment())) === JSON.stringify(assignmentToDayRow(day, b || emptyDayAssignment()));
}

// A realtime schedule_days row for `day` arrived (INSERT/UPDATE - including
// the echo of our own write). Decide what the in-memory map should hold:
//   - localDay still equals lastSyncDay (nothing unsaved locally) -> adopt the
//     incoming row.
//   - localDay differs from lastSyncDay (an edit inside the autosave debounce
//     or with its write in flight) -> KEEP the local edit. It is the truth the
//     same way refreshDays and the CAS conflict path treat it; the next sync
//     pass PATCHes it against the fresh version, and a genuine collision still
//     surfaces through the CAS zero-row path.
// lastSync ALWAYS advances to the incoming row - it is what the table holds.
// Before this, the echo of "set primary" arriving 200ms after "set backup"
// silently blanked the backup and the pending diff (finding datalayer-001).
function mergeRealtimeDay(day, localDay, lastSyncDay, incoming) {
  const localChanged = !sameDayAssignment(day, localDay, lastSyncDay);
  return { localChanged: localChanged, next: localChanged ? localDay : incoming, lastSync: incoming };
}

// ---- Undo, per edit and per day (Prompt 16 B1) ----
// An undo entry is what ONE action changed: { days: [{ day, before, version }] } - the assignment the day had
// before (null when it had no row) and the schedule_days version this session had last seen for it (null when
// none). Undo puts back only those days, and only where the version is still the recorded one; a day whose
// version moved through a claim, a trade or another device's write is left as the table has it and named in the
// message. The session's OWN write moves the version too (POST -> 1, PATCH v -> v+1): syncScheduleDays reports it
// through undoNoteWrite, which advances every entry that carried the version the write went out against, so an
// entry stays restorable across its own save and a later edit of the same day. A whole-map snapshot used to be
// pushed and put back wholesale, silently reverting whatever had landed meanwhile (the 9/23 review, section 3).
function undoVersionOf(versions, day) {
  const v = versions ? versions[day] : undefined;
  return v === undefined || v === null ? null : v;
}
function undoEntry(prev, next, versions) {
  const p = prev || {}, n = next || {};
  const days = [];
  for (const day of Object.keys(Object.assign({}, p, n)).sort()) {
    if (sameDayAssignment(day, p[day], n[day])) continue;
    days.push({ day, before: p[day] ? JSON.parse(JSON.stringify(p[day])) : null, version: undoVersionOf(versions, day) });
  }
  return days.length ? { days } : null;
}
function undoNoteWrite(history, day, fromVersion, toVersion) {
  const from = fromVersion === undefined || fromVersion === null ? null : fromVersion;
  const to = toVersion === undefined || toVersion === null ? null : toVersion;
  const list = Array.isArray(history) ? history : [];
  if (from === to) return list;
  let touched = false;
  const out = list.map(e => {
    if (!e || !Array.isArray(e.days) || !e.days.some(d => d && d.day === day && d.version === from)) return e;
    touched = true;
    return { ...e, days: e.days.map(d => (d && d.day === day && d.version === from) ? { ...d, version: to } : d) };
  });
  return touched ? out : list;
}
function undoMessage(restored, skipped) {
  const total = restored.length + skipped.length;
  const dayWord = (n) => n + " day" + (n === 1 ? "" : "s");
  if (!skipped.length) return "Undo: " + dayWord(total) + " restored" + (total === 1 ? " (" + fmtMD(restored[0]) + ")" : "") + ".";
  const named = skipped.slice(0, 4).map(fmtMD).join(", ") + (skipped.length > 4 ? ", ..." : "");
  return "Undo: " + restored.length + " of " + dayWord(total) + " restored; " + skipped.length + " changed since (" + named + ").";
}
function undoApply(entry, current, versions) {
  const cur = current || {};
  const next = { ...cur };
  const restored = [], skipped = [];
  for (const d of (entry && Array.isArray(entry.days)) ? entry.days : []) {
    if (!d || !d.day) continue;
    if (undoVersionOf(versions, d.day) !== (d.version === undefined ? null : d.version)) { skipped.push(d.day); continue; }
    if (d.before) next[d.day] = JSON.parse(JSON.stringify(d.before)); else delete next[d.day];
    restored.push(d.day);
  }
  return { next: restored.length ? next : cur, restored, skipped, message: undoMessage(restored, skipped) };
}

// Who effectively holds a role on a day. An external cover (e.g. "Atwell")
// stands in for an OPEN primary: it is not a roster id, so it is carried as
// the string "ext:<name>" and rendered as "<name> (external)" by the label
// helpers below. Backup has no external form.
function dayHolder(a, role) {
  if (!a) return null;
  if (role === "primary") return a.primary || (a.externalCover ? "ext:" + a.externalCover : null);
  if (role === "backup") return a.backup || null;
  return null;
}
function dayLockFlags(a) {
  if (!a) return "";
  return (a.primaryLocked ? "P" : "") + (a.backupLocked ? "B" : "");
}

// diffScheduleDays(prev, next) -> [{ day, role, from, to }], sorted by day then
// role in the order primary, backup, lock, note. A day missing from one side
// is treated as fully empty on that side (so a deleted row reads as
// "Philip -> OPEN", never vanishes from the diff). `source` is metadata and
// is deliberately not diffed.
function diffScheduleDays(prev, next) {
  const p = prev || {}, n = next || {};
  const days = Object.keys(Object.assign({}, p, n)).sort();
  const out = [];
  const ROLE_ORDER = ["primary", "backup", "lock", "note"];
  for (const day of days) {
    const a = p[day] || null, b = n[day] || null;
    const changes = [];
    for (const role of ["primary", "backup"]) {
      const from = dayHolder(a, role), to = dayHolder(b, role);
      if (from !== to) changes.push({ day, role, from, to });
    }
    const lf = dayLockFlags(a), lt = dayLockFlags(b);
    if (lf !== lt) changes.push({ day, role: "lock", from: lf, to: lt });
    const nf = (a && a.note) ? String(a.note) : null, nt = (b && b.note) ? String(b.note) : null;
    if (nf !== nt) changes.push({ day, role: "note", from: nf, to: nt });
    changes.sort((x, y) => ROLE_ORDER.indexOf(x.role) - ROLE_ORDER.indexOf(y.role));
    out.push(...changes);
  }
  return out;
}

// Label for a holder value: roster id -> nameOf(id); "ext:X" -> "X (external)";
// null -> "OPEN".
function holderLabel(v, nameOf) {
  if (v === null || v === undefined || v === "") return "OPEN";
  if (typeof v === "string" && v.indexOf("ext:") === 0) return v.slice(4) + " (external)";
  const name = typeof nameOf === "function" ? nameOf(v) : v;
  return name || String(v);
}

// formatDayChange(change, nameOf) -> "10/12 P Philip -> Fierce". Plain "->" in
// code; the UI may render an arrow glyph instead. Prompt 19 S4: a change labelled
// by labelGiveChanges (via "give") reads "10/10 P Acton -> Burchett (give)".
function formatDayChange(change, nameOf) {
  if (!change) return "";
  const md = fmtMD(change.day);
  const via = change.via === "give" ? " (give)" : "";
  if (change.role === "primary") return `${md} P ${holderLabel(change.from, nameOf)} -> ${holderLabel(change.to, nameOf)}${via}`;
  if (change.role === "backup") return `${md} B ${holderLabel(change.from, nameOf)} -> ${holderLabel(change.to, nameOf)}${via}`;
  if (change.role === "lock") {
    const lockWord = (f) => f === "PB" ? "both locked" : f === "P" ? "primary locked" : f === "B" ? "backup locked" : "unlocked";
    return `${md} lock ${lockWord(change.from)} -> ${lockWord(change.to)}`;
  }
  if (change.role === "note") {
    const q = (s) => s ? `"${String(s).slice(0, 60)}"` : "(none)";
    return `${md} note ${q(change.from)} -> ${q(change.to)}`;
  }
  return `${md} ${change.role} ${String(change.from)} -> ${String(change.to)}`;
}

// describePublishDiff(changes, nameOf) -> [{ key:"2026-10", label:"October 2026",
// lines:[...] }] grouped by month in date order. Empty input -> [].
function describePublishDiff(changes, nameOf) {
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const groups = {};
  (changes || []).forEach(ch => {
    const key = String(ch.day || "").slice(0, 7);
    if (!groups[key]) {
      const m = /^(\d{4})-(\d{2})$/.exec(key);
      groups[key] = { key, label: m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : key, lines: [] };
    }
    groups[key].lines.push(formatDayChange(ch, nameOf));
  });
  return Object.keys(groups).sort().map(k => groups[k]);
}

// Number of days whose PRIMARY slot is populated (a roster id or an external
// cover). This is the baseline the accidental-wipe guard reasons about.
function countPopulatedPrimary(schedule) {
  let n = 0;
  for (const day in (schedule || {})) { if (dayHolder(schedule[day], "primary")) n++; }
  return n;
}

// scheduleWipeCheck(prev, next) -> { baseline, removed, wipe }. `removed` is
// the number of prev days with a populated primary that next leaves OPEN (or
// drops). wipe is true when more than half of a non-empty baseline would go -
// the shape a failed load, a transient render or a stale tab produces, never
// an ordinary edit. clearSchedule / factory reset / restore arm
// intentionalScheduleWipeRef to pass this check on purpose.
function scheduleWipeCheck(prev, next) {
  const p = prev || {}, n = next || {};
  let baseline = 0, removed = 0;
  for (const day in p) {
    if (!dayHolder(p[day], "primary")) continue;
    baseline++;
    if (!dayHolder(n[day], "primary")) removed++;
  }
  return { baseline, removed, wipe: baseline > 0 && removed * 2 > baseline };
}

// The daily-model empty-save predicate: true when the payload carries NONE of
// the operational data that is expensive to recreate - no populated day, no
// vacation, no availability statement. Roster/rules/settings are ignored
// (they default and are therefore always "present").
function payloadLooksWipedDaily(p) {
  if (!p || typeof p !== "object") return true;
  const sched = p.schedule || {};
  let anyDay = false;
  for (const day in sched) {
    const a = sched[day];
    if (a && (a.primary || a.backup || a.externalCover)) { anyDay = true; break; }
  }
  const sizeOf = (v) => Array.isArray(v) ? v.length : (v && typeof v === "object" ? Object.keys(v).length : 0);
  const noVac = sizeOf(p.vacations) === 0;
  const noAvail = sizeOf(p.availability) === 0;
  return !anyDay && noVac && noAvail;
}

// ---- Write retry (review 9/27, Do first 2) ----
// A failed write is retried on a backoff: 5 s after the first failure of a streak, 15 s after the second, then every
// 60 s until a write lands (the streak is the count of consecutive failed runs; a run that fails nothing ends it). Only
// the first failure of a streak toasts - the red header line stays for the whole streak.
const SYNC_RETRY_MS = [5000, 15000, 60000];
function syncRetryDelay(streak) {
  const n = Math.max(1, Math.floor(Number(streak) || 1));
  return SYNC_RETRY_MS[Math.min(n, SYNC_RETRY_MS.length) - 1];
}
// The header's failure line: the day leg (schedule_days) and the blob leg (the shared setup) each keep their own
// unresolved failure, so a later "Saved" of one leg never hides the other's. "" when neither is failing. Each part
// names its leg ("Schedule: " / "Setup: " - review of 9/30: a green "Saved" of the other leg can sit beside it).
function syncFailLine(dayFail, blobFail) {
  const d = String(dayFail || ""), b = String(blobFail || "");
  return [d && "Schedule: " + d, b && "Setup: " + b].filter(Boolean).join(" | ");
}

// ---- The config blob (call_schedule_data 'main') - Prompt 16 A4 ----
// The seven keys the app persists in the blob, in the state bundle's order. Everything else the row may carry
// (a retired key, an importer stamp outside settings) is neither compared nor written by the autosave.
const BLOB_KEYS = ["roster", "surgeonRules", "groupRules", "holidays", "settings", "lastPublished", "lastGenerate"];
// JSON with object keys sorted at every depth: jsonb stores keys in its own order, so a row read back never
// stringifies byte-equal to what was sent even when nothing changed. undefined values drop like JSON.stringify.
function canonicalJson(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(x => (x === undefined ? "null" : canonicalJson(x))).join(",") + "]";
  const keys = Object.keys(v).filter(k => v[k] !== undefined).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + canonicalJson(v[k])).join(",") + "}";
}
// The autosave's content gate: the blob's seven keys, canonical, with a null top-level value read as absent
// (the local default for lastPublished is null where a row that never published has no key at all).
function blobSignature(blob) {
  const d = (blob && typeof blob === "object") ? blob : {};
  const pick = {};
  BLOB_KEYS.forEach(k => { if (d[k] !== undefined && d[k] !== null) pick[k] = d[k]; });
  return canonicalJson(pick);
}
// What the component's adoptBlob turns the local setup state into, field by field, with the same rules: a roster
// only when it is a non-empty array, settings only when an object, lastPublished / lastGenerate / rules / holidays
// whenever the key is present (null included), everything else kept. A bad blob changes nothing.
function adoptBlobState(local, d) {
  const next = { ...(local || {}) };
  if (!d || typeof d !== "object") return next;
  if (Array.isArray(d.roster) && d.roster.length) next.roster = d.roster;
  if (d.surgeonRules !== undefined) next.surgeonRules = d.surgeonRules;
  if (d.groupRules !== undefined) next.groupRules = d.groupRules;
  if (d.holidays !== undefined) next.holidays = d.holidays;
  if (d.settings && typeof d.settings === "object") next.settings = d.settings;
  if (d.lastPublished !== undefined) next.lastPublished = d.lastPublished;
  if (d.lastGenerate !== undefined) next.lastGenerate = d.lastGenerate;
  return next;
}

/* ═══ TRADE MESSAGE COMPOSERS ═══
   One composition per trade event, shared by in-app and email channels.
   Trades are by DAY + ROLE (shift_trade_requests.day / role / return_day /
   return_role). The accept path applies the legs to the schedule through
   apply_trade() (Slice G, live since 9/22); the composers below describe that
   shape. */
function tradeLegsText(req, tense) {
  // tense: "takes" (accepted) | "would take" (proposed) | "would have taken" (declined)
  const gets = slotLabel(req.day, req.role);
  if (!req.return_day || !req.return_role) {
    return `${req.to_surgeon_name} ${tense} ${gets} (one-way - no return shift)`;
  }
  const back = slotLabel(req.return_day, req.return_role);
  return `${req.to_surgeon_name} ${tense} ${gets}; ${req.from_surgeon_name} ${tense} ${back}`;
}

function tradeProposeMsg(req) {
  return `${req.from_surgeon_name} proposed a trade: ${tradeLegsText(req, "would take")}`;
}
function tradeAcceptMsg(req) {
  return `${req.to_surgeon_name} accepted the trade: ${tradeLegsText(req, "takes")}`;
}
function tradeDeclineMsg(req) {
  return `${req.to_surgeon_name} declined the trade: ${tradeLegsText(req, "would have taken")}`;
}
// Prompt 19 (Faraz 9/24): a give - kind 'give', no return leg. Addressed to the receiver ("you") and naming him too, so
// the copy the giver and the scheduler read is unambiguous: "Acton offers you Sat 10/10 primary - nothing in return (a
// give to Burchett)". unitLabel (optional, e.g. "Thanksgiving unit 11/26-11/29 (4 days)") names a whole unit instead.
function tradeGiveWhat(req, unitLabel) {
  return unitLabel ? "the " + unitLabel + " " + req.role : TT_DOW[parse(req.day).getDay()] + " " + fmtMD(req.day) + " " + req.role;
}
function tradeGiveMsg(req, unitLabel) {
  return `${req.from_surgeon_name} offers you ${tradeGiveWhat(req, unitLabel)} - nothing in return (a give to ${req.to_surgeon_name})`;
}
// The give's e-mail (trade_proposed) goes to BOTH parties and send-notification greets each one by name, so its subject
// and message are neutral - no "you" (S2 review 9/24). The receiver-addressed tradeGiveMsg stays the in-app line.
function tradeGiveEmail(req, unitLabel) {
  const what = tradeGiveWhat(req, unitLabel), from = req.from_surgeon_name, to = req.to_surgeon_name;
  return {
    subject: `Day offered: ${what} (${from} to ${to})`,
    message: `${from} is offering ${what} to ${to} - nothing in return. ${to} can accept or decline in the app; the schedule changes only if ${to} accepts.`,
  };
}
// Prompt 19 S3 (Faraz 9/24): accept / decline of a give. Pure; the dashes and the arrow are written as escapes (\u2014 em
// dash, \u2013 en dash, \u2192 arrow) so this file's give wording stays ASCII in source.
// A ROW is a give when it says so (kind 'give') and carries no return leg; a pre-migration row (no kind) is a trade. A
// member's whole-unit trade for ONE return day sends its tail rows as kind 'give' too (S2), so a GROUP (tradeGroupOf) is
// a give only when every row is - the head row carries the return leg and makes the group a trade.
function tradeIsGive(r) {
  return !!r && typeof r === "object" && r.kind === "give" && !r.return_day && !r.return_role;
}
function tradeGroupIsGive(rows) {
  const list = Array.isArray(rows) ? rows : [rows];
  return list.length > 0 && list.every(tradeIsGive);
}
// S3 review: whether a row belongs to a give is decided on its WHOLE proposal, in every status - the app's same-status
// group (tradeGroupOf) is not enough, because a unit's rows drift apart (a tail's apply refused, a PATCH that failed
// part-way) and the 'give' tails of a member's unit trade would then read as a give on their own. The proposal of r:
// r plus the rows with the same unit tag (tagOf(r): kind, start, n - the app's tradeUnitTag), the same parties and
// role, in the same phase (live: pending / accepted / applied; closed: declined / cancelled - a re-offer after a
// decline is its own proposal) and submitted within 10 minutes of r (the rows of one proposal are inserted one after
// the other; a re-offer of the same unit weeks later, after a revert, is its own proposal). A row without a unit tag
// is its own proposal. Sorted by day.
const TRADE_PROPOSAL_WINDOW_MS = 10 * 60 * 1000;
function tradeProposalOf(r, rows, tagOf) {
  if (!r || typeof r !== "object") return [];
  const tag = typeof tagOf === "function" ? tagOf(r) : null;
  if (!tag) return [r];
  const live = (st) => st === "pending" || st === "accepted" || st === "applied";
  const at = (x) => { const t = Date.parse(x && x.submitted_at); return isNaN(t) ? null : t; };
  const t0 = at(r);
  const same = (x) => {
    if (!x || typeof x !== "object" || x.id === r.id) return false;
    const t = tagOf(x);
    if (!t || t.kind !== tag.kind || t.start !== tag.start || t.n !== tag.n) return false;
    if (x.from_surgeon_id !== r.from_surgeon_id || x.to_surgeon_id !== r.to_surgeon_id || x.role !== r.role) return false;
    if (live(x.status) !== live(r.status)) return false;
    const t1 = at(x);
    return t0 === null || t1 === null || Math.abs(t1 - t0) <= TRADE_PROPOSAL_WINDOW_MS;
  };
  return [r].concat((Array.isArray(rows) ? rows : []).filter(same)).sort((a, b) => a.day < b.day ? -1 : a.day > b.day ? 1 : 0);
}
function tradeProposalIsGive(r, rows, tagOf) {
  return !!r && tradeGroupIsGive(tradeProposalOf(r, rows, tagOf));
}
// " (weekend unit, 10/9\u201310/11)" / " (Thanksgiving unit, 11/26\u201311/29)" from a unit tag ({ kind, start, n, text } - the
// app's tradeUnitTag reads it off the row's detail stamp); "" without one.
function tradeGiveUnitNote(tag) {
  if (!tag || typeof tag.start !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(tag.start) || !(Number(tag.n) > 0)) return "";
  const name = String(tag.text || "").split(" unit ")[0];
  const word = tag.kind === "weekend-block" || name === "weekend block" ? "weekend" : (name || "holiday");
  const end = fmt(addD(parse(tag.start), Number(tag.n) - 1));
  return " (" + word + " unit, " + fmtMD(tag.start) + "\u2013" + fmtMD(end) + ")";
}
function tradeGiveSlot(req, tag) {
  return TT_DOW[parse(req.day).getDay()] + " " + fmtMD(req.day) + " " + req.role + tradeGiveUnitNote(tag);
}
// The give's one line in Trades and in Alerts, by status. viewerId === the receiver -> "you" (the receiver's Accept /
// Decline sit under it); anyone else (the giver, the scheduler) reads both names.
//   pending   "Acton offers you Sat 10/10 primary (weekend unit, 10/10\u201310/11) \u2014 nothing in return"
//   accepted / applied  "Burchett takes Sat 10/10 primary from Acton \u2014 nothing in return"
//   declined  "Burchett declined Acton's offer of Sat 10/10 primary"
//   cancelled "Acton withdrew the offer of Sat 10/10 primary to Burchett"
function tradeGiveLine(req, tag, viewerId) {
  const what = tradeGiveSlot(req, tag), from = req.from_surgeon_name, to = req.to_surgeon_name, st = req.status || "pending";
  if (st === "accepted" || st === "applied") return `${to} takes ${what} from ${from} \u2014 nothing in return`;
  if (st === "declined") return `${to} declined ${from}'s offer of ${what}`;
  if (st === "cancelled") return `${from} withdrew the offer of ${what} to ${to}`;
  return (viewerId && viewerId === req.to_surgeon_id ? `${from} offers you ${what}` : `${from} offers ${to} ${what}`) + " \u2014 nothing in return";
}
function tradeGiveAcceptMsg(req, tag) {
  return `${req.to_surgeon_name} accepted ${req.from_surgeon_name}'s give: ${req.to_surgeon_name} takes ${tradeGiveSlot(req, tag)} \u2014 nothing in return`;
}
function tradeGiveDeclineMsg(req, tag) {
  return `${req.to_surgeon_name} declined ${req.from_surgeon_name}'s give: ${tradeGiveSlot(req, tag)} stays with ${req.from_surgeon_name}`;
}
function tradeGiveCancelMsg(req, tag) {
  return `${req.from_surgeon_name} withdrew the give: ${tradeGiveSlot(req, tag)} stays with ${req.from_surgeon_name} (it was offered to ${req.to_surgeon_name})`;
}
// "Give applied: Acton \u2192 Burchett, 10/10\u201310/11 primary" (a unit: its first and last day) / "Give applied: Acton \u2192
// Burchett, Sat 10/10 primary" (one day; no days = the row's own day).
function tradeGiveAppliedLine(req, days) {
  const list = (Array.isArray(days) && days.length ? days : [req.day]).slice().sort();
  const span = list.length > 1 ? fmtMD(list[0]) + "\u2013" + fmtMD(list[list.length - 1]) : TT_DOW[parse(list[0]).getDay()] + " " + fmtMD(list[0]);
  return `Give applied: ${req.from_surgeon_name} \u2192 ${req.to_surgeon_name}, ${span} ${req.role}`;
}
// The applied give's e-mail targets: the two parties, then the scheduler-linked ids (send-notification v7 lets them ride
// beside the parties on trade_applied only), each once. schedulerIds null = the lookup failed (the app already toasted)
// -> the parties alone, never a broadcast.
function tradeAppliedTargets(req, schedulerIds) {
  const out = [];
  [req && req.from_surgeon_id, req && req.to_surgeon_id].concat(Array.isArray(schedulerIds) ? schedulerIds : []).forEach(id => {
    if (id === null || id === undefined || id === "") return;
    const s = String(id);
    if (out.indexOf(s) < 0) out.push(s);
  });
  return out;
}
// What accepting a give writes besides the PATCHes: the trade.accept audit row (kind 'give') and the 'Give accepted' feed
// row naming both parties. rows = the accepted group (names resolved, sorted by day); tag = its unit tag or null.
function giveAcceptedNotes(rows, tag) {
  const list = Array.isArray(rows) ? rows : [rows];
  const first = list[0], ids = list.map(r => r.id);
  const message = tradeGiveAcceptMsg(first, tag);
  return {
    audit: { action: "trade.accept", message, detail: { trade_id: first.id, trade_ids: ids, day: first.day, role: first.role, days: list.map(r => r.day), return_day: null, return_role: null, from: first.from_surgeon_id, to: first.to_surgeon_id, kind: "give" } },
    notification: { type: "trade_accepted", title: "Give accepted", message, data: { from_surgeon_id: first.from_surgeon_id, to_surgeon_id: first.to_surgeon_id, trade_id: first.id, trade_ids: ids, day: first.day, kind: "give" } },
  };
}
// ... and once apply_trade has moved every row: the 'Give applied' feed row (both parties by id; the scheduler reads the
// whole feed) and the ONE trade_applied e-mail (trade_id = the first row) to tradeAppliedTargets.
function giveAppliedNotes(rows, schedulerIds) {
  const list = Array.isArray(rows) ? rows : [rows];
  const first = list[0], ids = list.map(r => r.id), days = list.map(r => r.day);
  const line = tradeGiveAppliedLine(first, days);
  return {
    notification: { type: "trade_applied", title: "Give applied", message: line, data: { from_surgeon_id: first.from_surgeon_id, to_surgeon_id: first.to_surgeon_id, trade_id: first.id, trade_ids: ids, day: first.day, days, kind: "give" } },
    email: { subject: line, message: `${line}. ${first.to_surgeon_name} now holds ${days.length > 1 ? "those days" : "that day"}; nothing comes back to ${first.from_surgeon_name}.`, trade_id: first.id, kind: "give", targetIds: tradeAppliedTargets(first, schedulerIds) },
  };
}
// ---- Prompt 19 S4 (Faraz 9/24): a give reads as a give everywhere - pure, ASCII ----
// The Trades list's section titles: the rows are split by isGive(row) (the app passes its whole-proposal predicate).
// Without gives the pre-Prompt 19 title stands ("Pending trades (2)"); without trades "Pending gives (1)"; both ->
// "Pending trades (2) and gives (1)". Counts are rows, as before (a 4-day unit counts 4).
function tradeListTitle(label, rows, isGive) {
  const list = Array.isArray(rows) ? rows : [];
  const g = typeof isGive === "function" ? list.filter(r => isGive(r)).length : 0, t = list.length - g;
  if (!g) return `${label} trades (${t})`;
  if (!t) return `${label} gives (${g})`;
  return `${label} trades (${t}) and gives (${g})`;
}
function tradeListEmpty(label) {
  return `No ${String(label).toLowerCase()} trades or gives.`;
}
// The row's status chip: "give - pending" / "give - accepted - not applied yet" for a give; a trade's is unchanged.
function tradeRowStatus(status, give) {
  return (give ? "give - " : "") + (status === "accepted" ? "accepted - not applied yet" : String(status || ""));
}
// The Activity log. The client's trade.propose / accept / decline / cancel rows carry detail.kind since Prompt 19; the
// server's trade.apply row (apply_trade, 5b) carries none - its summary reads "Trade applied: <to> takes <Role> <Dy Mon D>
// (from <from>, one-way)". A trade id is a give's when the loaded trade rows say so (isGive = the app's whole-proposal
// predicate) or when one of the give's own audit rows (kind 'give') names it in trade_id / trade_ids - so the apply row
// still reads as a give once its trade row has scrolled out of the last 100.
function auditGiveTradeIds(entries, tradeRows, isGive) {
  const out = [];
  const add = (id) => { if (id === null || id === undefined || id === "") return; const s = String(id); if (out.indexOf(s) < 0) out.push(s); };
  (Array.isArray(tradeRows) ? tradeRows : []).forEach(r => { if (r && typeof isGive === "function" && isGive(r)) add(r.id); });
  (Array.isArray(entries) ? entries : []).forEach(en => {
    const d = en && en.detail;
    if (!d || typeof d !== "object" || d.kind !== "give") return;
    add(d.trade_id);
    (Array.isArray(d.trade_ids) ? d.trade_ids : []).forEach(add);
  });
  return out;
}
// One Activity log line -> { summary, action, give }. A give's trade.apply summary is re-worded ("Give applied: ...,
// nothing in return)"); a give's trade.propose summary - the receiver-addressed tradeGiveMsg ("<giver> offers you ...
// (a give to <receiver>)") - reads neutral in the log ("Give offered: <giver> -> <receiver>, <what> - nothing in return",
// S4 review); a give's other trade.* rows keep their (already give-worded) summary; the action reads "<action> (give)".
// Everything else is the row as before: detail.summary, else the action.
function auditEntryText(en, giveIds) {
  const action = String(en && en.action || "");
  const d = en && en.detail && typeof en.detail === "object" ? en.detail : {};
  const base = d.summary || action;
  const ids = Array.isArray(giveIds) ? giveIds : [];
  const give = action.indexOf("trade.") === 0 && (d.kind === "give" || (action === "trade.apply" && d.trade_id !== undefined && d.trade_id !== null && ids.indexOf(String(d.trade_id)) >= 0));
  if (!give) return { summary: base, action, give: false };
  let summary = base;
  if (action === "trade.apply") {
    summary = typeof d.summary === "string" && /^Trade applied: /.test(d.summary)
      ? d.summary.replace(/^Trade applied: /, "Give applied: ").replace(/, one-way\)$/, ", nothing in return)")
      : "Give applied";
  } else if (action === "trade.propose" && typeof d.summary === "string") {
    const m = /^(.+?) offers you (.+) - nothing in return [(]a give to (.+)[)]$/.exec(d.summary);
    if (m) summary = "Give offered: " + m[1] + " -> " + m[3] + ", " + m[2] + " - nothing in return";
  }
  return { summary, action: action + " (give)", give: true };
}
// The publish diff. schedule_days carries no kind - apply_trade writes source 'trade' for a trade and a give alike - so
// a change is labelled from the shift_trade_requests rows: on a day whose source is 'trade', the LATEST applied row
// (decided_at, else submitted_at) whose leg lands on that slot (day / role -> to_surgeon_id, or the return leg
// return_day / return_role -> from_surgeon_id) must have put change.to there and be a give (isGive) -> via 'give'.
// A later trade or a hand edit over the give, a trade's return leg and a declined give stay unlabelled. Pure: the
// changes are copied, never mutated.
function labelGiveChanges(changes, schedule, tradeRows, isGive) {
  const rows = (Array.isArray(tradeRows) ? tradeRows : []).filter(r => r && r.status === "applied");
  const when = (r) => String(r.decided_at || r.submitted_at || "");
  return (Array.isArray(changes) ? changes : []).map(c => {
    if (!c || (c.role !== "primary" && c.role !== "backup") || !c.to) return c;
    const day = schedule && schedule[c.day];
    if (!day || day.source !== "trade") return c;
    let best = null, holder = null;
    rows.forEach(r => {
      const lands = r.day === c.day && r.role === c.role ? r.to_surgeon_id : r.return_day === c.day && r.return_role === c.role ? r.from_surgeon_id : null;
      if (lands === null || lands === undefined) return;
      if (!best || when(r) > when(best)) { best = r; holder = lands; }
    });
    if (!best || String(holder) !== String(c.to) || typeof isGive !== "function" || !isGive(best)) return c;
    return { ...c, via: "give" };
  });
}
// The shift_trade_requests rows of ONE proposal from the Propose card - one row per given day, in order. Pure.
//   p = { fromId, fromName, toId, toName, days, role, retDays, returnRole, give, isScheduler, stamp(i) -> "" | unit stamp,
//         submittedAt }
// A trade: a single return day rides on the FIRST row (the rest of a unit is one-way inside the group); a return unit of
// the same size pairs day for day. A give (Prompt 19): no return leg on any row, whatever retDays holds. `kind` is sent
// only as 'give' - on every row of a give, and on a member's trade row without a return leg (the tail rows of a whole
// unit traded for one return day: sent as a give so the rows stay valid once the prepared follow-up
// 2026-09-25-member-trade-return-leg.sql makes trade_insert_guard refuse a member 'trade' without a return leg - the
// give-kind migration itself does not refuse it); a trade row with its return leg, and every scheduler trade row, send no kind (default
// 'trade'). detail = the composed sentence (tradeGiveMsg / tradeProposeMsg) plus the unit stamp when one is given.
function tradeProposalRows(p) {
  const days = (p && p.days) || [];
  const ret = p.give ? [] : (p.retDays || []);
  return days.map((d, i) => {
    const back = p.give ? null : ret.length === days.length ? ret[i] : (i === 0 ? (ret[0] || null) : null);
    const req = {
      from_surgeon_id: p.fromId, from_surgeon_name: p.fromName,
      to_surgeon_id: p.toId, to_surgeon_name: p.toName,
      day: d, role: p.role,
      return_day: back || null, return_role: back ? p.returnRole : null,
      status: "pending", submitted_at: p.submittedAt,
    };
    if (p.give || (!back && !p.isScheduler)) req.kind = "give";
    const stamp = typeof p.stamp === "function" ? p.stamp(i) : "";
    req.detail = (p.give ? tradeGiveMsg(req) : tradeProposeMsg(req)) + (stamp ? " " + stamp : "");
    return req;
  });
}

// Dated slot label for (dayStr, role) where role is "primary" | "backup".
function slotLabel(dayStr, role) {
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  let d;
  try { d = parse(String(dayStr)); } catch (e) { console.warn("slotLabel: could not parse", dayStr, e); d = null; }
  if (!d || isNaN(d.getTime())) return `${dayStr || "?"} ${role || ""}`.trim();
  const md = `${DOW[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}`;
  if (role === "primary") return `Primary - ${md}`;
  if (role === "backup") return `Backup - ${md}`;
  return `${md}${role ? " - " + role : ""}`;
}

/* === Item C (Faraz 9/23 evening): suggested trade partners ===
   suggestTradePartners(ctx, schedule, day, role, fromId, opts) -> up to opts.max (3) ranked entries
     { id, name, reason, softCount, total, lowestTotal, window: { from, to }, returnDay, returnRole, returnDays }
   PURE ranking for the "Propose a shift trade" card. The eligibility check is INJECTED so the card
   passes the very check it already runs (tradeEligibility / tradeEligibilityOver - the rules.js
   chokepoint) and this stays DOM- and rules-free:
     opts.eligibility(days, role, candidateId) -> { ok, hard, soft, unknown }   (required; missing = [])
     opts.unitOf(day, role, holderId)          -> { kind, name, days } | null    (the card's tradeUnitOf)
     opts.today, opts.pool [ids], opts.nameOf, opts.offerDays (the given days - the whole unit when
     "Trade the whole unit" is on), opts.twoWay (a member's proposal), opts.floors ({ year: iso } -
     the Totals card's year-to-date floor), opts.max,
     opts.avoidReturnDays ({ start, end } or (day) -> bool): days that must NOT come back as a return
     day - the vacation range that was just refused (review 9/24; the time_off row was never written,
     so the rules cannot know it); a unit is skipped when ANY of its days falls inside,
     opts.horizonDays (OPT-IN cap on the return-day scan; by default every published day from today on
     is scanned - the card's own return picker is unbounded too).
   Ranking: (a) hard-eligible for the given day(s) only - an unknown or thrown check = not shown;
   (b) fewer soft flags first; (c) then the lowest running total in `role` for the day's year
   (ttTotalsFor over Jan 1 / the year's floor .. Dec 31 - the Totals numbers; `window` says which);
   (d) two-way only: people holding an upcoming day the proposer is eligible to take back (the
   EARLIEST workable one is the return day; a unit day of theirs only as the whole unit pairing day
   for day with the given unit, never a split) rank before people with none, who still appear
   ("no return day found") but last. Ties keep the pool (roster) order. Reason text is ONE short
   clause ("lowest primary total, 9" / "primary total 11" / "can give back Tue 10/20 P"); the
   soft-note count stays on softCount for the chip's tooltip. */
function tradeDayShort(day, role) { return TT_DOW[parse(day).getDay()] + " " + fmtMD(day) + " " + (role === "primary" ? "P" : "B"); } // "Tue 10/20 P" (TT_DOW is assigned at load, below)
function suggestTradePartners(ctx, schedule, day, role, fromId, opts) {
  var o = opts || {};
  if (!ctx || !schedule || !suIsIso(day) || !fromId || (role !== "primary" && role !== "backup") || typeof o.eligibility !== "function") return [];
  var pool = (o.pool || []).filter(function (id) { return id && id !== fromId; });
  var offerDays = (o.offerDays && o.offerDays.length ? o.offerDays : [day]).slice().sort();
  var whole = offerDays.length > 1;
  var today = suIsIso(o.today) ? o.today : day;
  var year = day.slice(0, 4);
  var from = year + "-01-01", to = year + "-12-31";
  var floor = o.floors && o.floors[year];
  if (suIsIso(floor) && floor > from) from = floor;
  var unitOf = typeof o.unitOf === "function" ? o.unitOf : function () { return null; };
  var nameOf = typeof o.nameOf === "function" ? o.nameOf : function (id) { return id; };
  var limit = typeof o.horizonDays === "number" ? suAddDays(today, o.horizonDays) : null; // opt-in cap; default = the whole published schedule
  var upcoming = Object.keys(schedule).filter(function (d) { return suIsIso(d) && d >= today && (!limit || d <= limit) && schedule[d]; }).sort();
  var av = o.avoidReturnDays;
  var avoid = typeof av === "function" ? function (d) { try { return !!av(d); } catch (e) { return false; } }
    : av && suIsIso(av.start) && suIsIso(av.end) ? function (d) { return d >= av.start && d <= av.end; }
    : function () { return false; };
  var UNKNOWN = { ok: false, hard: ["rules-unavailable"], soft: [], unknown: true };
  var safe = function (days, r, id) { try { return o.eligibility(days, r, id) || UNKNOWN; } catch (e) { return UNKNOWN; } };
  // (d) the earliest upcoming day `pid` holds (either role) that the proposer may take back - never one inside the avoid window.
  var returnFor = function (pid) {
    for (var i = 0; i < upcoming.length; i++) {
      var d = upcoming[i], e = schedule[d];
      for (var k = 0; k < 2; k++) {
        var rr = k === 0 ? "primary" : "backup";
        if (e[rr] !== pid) continue;
        var u = unitOf(d, rr, pid), retDays = [d];
        if (u) {
          if (!(whole && u.days && u.days.length === offerDays.length)) continue; // a unit day comes back only as the whole unit, day for day
          retDays = u.days.slice().sort();
          if (retDays[0] !== d) continue; // the unit is offered once, from its first day
        }
        if (retDays.some(avoid)) continue; // inside the refused vacation range (any day of a unit)
        var res = safe(retDays, rr, fromId);
        if (res.ok && !res.unknown) return { day: retDays[0], role: rr, days: retDays };
      }
    }
    return null;
  };
  var out = [];
  pool.forEach(function (pid, idx) {
    var e = safe(offerDays, role, pid);
    if (!e.ok || e.unknown) return; // (a) ineligible people never appear
    var t = ttTotalsFor(schedule, pid, from, to, {});
    var ret = o.twoWay ? returnFor(pid) : null;
    out.push({ id: pid, name: nameOf(pid), softCount: (e.soft || []).length, total: t[role] || 0, window: { from: from, to: to }, returnDay: ret ? ret.day : null, returnRole: ret ? ret.role : null, returnDays: ret ? ret.days : [], noReturn: o.twoWay && !ret ? 1 : 0, idx: idx });
  });
  out.sort(function (a, b) { return (a.noReturn - b.noReturn) || (a.softCount - b.softCount) || (a.total - b.total) || (a.idx - b.idx); });
  var lowest = out.length ? Math.min.apply(null, out.map(function (x) { return x.total; })) : 0;
  var top = out.slice(0, typeof o.max === "number" ? o.max : 3);
  top.forEach(function (x) {
    x.lowestTotal = x.total === lowest;
    if (o.twoWay) x.reason = x.returnDay ? "can give back " + tradeDayShort(x.returnDay, x.returnRole) + (x.returnDays.length > 1 ? " (" + x.returnDays.length + "-day unit)" : "") : "no return day found";
    else x.reason = x.lowestTotal ? "lowest " + role + " total, " + x.total : role + " total " + x.total; // one clause - the note count lives in the tooltip
    delete x.noReturn; delete x.idx;
  });
  return top;
}

/* === WEEK ROWS - the ER-panel author's ER Call Panels layout (Prompt 6 Slice C) ===
   buildWeekRows(schedule, roster, rangeStart, rangeEnd, opts) -> rows
     rows:  [{ monday, sunday, label: "9/28 - 10/4", days: [...], primary: [entry], backup: [entry] }]
     entry: { text: "9/28-10/4 Atwell", start, end, kind: "surgeon"|"open"|"external", id, name }
   One row per Mon-Sun week that intersects [rangeStart, rangeEnd] (so the
   partial first/last weeks of a month are included). Every row lists all
   seven days unless opts.clipToRange is true (then only the in-range days).
   Consecutive days held by the SAME surgeon collapse into one entry
   ("10/9-10/11 Acton"); an external cover collapses the same way
   ("9/28-10/4 Atwell"); OPEN days never collapse - each open day stays
   visible as "M/D OPEN" (the ER-panel author's red entries). A day with no row is OPEN.
   Primary: roster id, else externalCover, else OPEN. Backup: roster id or OPEN.
   opts.today ("YYYY-MM-DD", default todayCentral()): an unassigned day BEFORE
   today produces NO entry at all (slotIsOpen) - the day is simply absent from
   that column, so a same-surgeon run never bridges it; assigned days, external
   covers and today/future OPEN days are unchanged (Faraz 9/22).
   Pure: no DOM, no state. Prompt 9's export reuses it. */
function buildWeekRows(schedule, roster, rangeStart, rangeEnd, opts) {
  const o = opts || {};
  const today = todayOrCentral(o.today);
  const sched = schedule || {};
  const nameById = {};
  (roster || []).forEach(r => { if (r && r.id) nameById[r.id] = r.name || r.id; });
  const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!isDay(rangeStart) || !isDay(rangeEnd) || rangeEnd < rangeStart) return [];
  const holderOf = (d, role) => {
    const a = sched[d];
    if (!a) return { kind: "open", id: null, name: "OPEN" };
    if (role === "primary") {
      if (a.primary) return { kind: "surgeon", id: a.primary, name: nameById[a.primary] || a.primary };
      if (a.externalCover) return { kind: "external", id: null, name: String(a.externalCover) };
      return { kind: "open", id: null, name: "OPEN" };
    }
    if (a.backup) return { kind: "surgeon", id: a.backup, name: nameById[a.backup] || a.backup };
    return { kind: "open", id: null, name: "OPEN" };
  };
  const rows = [];
  const end = parse(rangeEnd);
  for (let mon = monOf(parse(rangeStart)); mon <= end; mon = addD(mon, 7)) {
    const monStr = fmt(mon), sunStr = fmt(addD(mon, 6));
    const days = [];
    for (let k = 0; k < 7; k++) {
      const d = fmt(addD(mon, k));
      if (!o.clipToRange || (d >= rangeStart && d <= rangeEnd)) days.push(d);
    }
    const column = (role) => {
      const out = [];
      days.forEach(d => {
        const h = holderOf(d, role);
        if (h.kind === "open" && !slotIsOpen(d, null, today)) return; // past + unassigned: blank, no entry
        const last = out[out.length - 1];
        const adjacent = last && fmt(addD(parse(last.end), 1)) === d;
        if (last && adjacent && last.kind !== "open" && last.kind === h.kind && last.id === h.id && last.name === h.name) { last.end = d; return; }
        out.push({ kind: h.kind, id: h.id, name: h.name, start: d, end: d });
      });
      out.forEach(e => { e.text = (e.start === e.end ? fmtMD(e.start) : fmtMD(e.start) + "-" + fmtMD(e.end)) + " " + e.name; });
      return out;
    };
    rows.push({ monday: monStr, sunday: sunStr, label: fmtMD(monStr) + " - " + fmtMD(sunStr), days: days, primary: column("primary"), backup: column("backup") });
  }
  return rows;
}

/* === Export-builder shared helpers (Prompt 9) === */
const EXPORT_MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
// Fallback pill colours for Node / a roster code config.js does not pin.
const EXPORT_PAL = [
  { tx:"#2c5888", bd:"#9cb8d4", tg:"#dde8f4" }, { tx:"#8a6a10", bd:"#e0c870", tg:"#fcf3d0" }, { tx:"#3a7048", bd:"#a8c8a8", tg:"#e4f0e0" },
  { tx:"#b06050", bd:"#e8b0a0", tg:"#fcdcd0" }, { tx:"#2a3040", bd:"#707888", tg:"#d8dce4" }, { tx:"#a04878", bd:"#e0a8c4", tg:"#fce0ec" },
  { tx:"#4a5a68", bd:"#b8c0c8", tg:"#e8ecf0" },
];
function escHtml(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
// Pill colours for a roster entry: app-styles.js rosterColors(entry, idx) (the
// id / type-keyed theme table - an outside surgeon comes back grey + dashed)
// in the browser, config.js surgeonColors (by code) where only that is loaded,
// the local palette by index elsewhere (Node tests).
function exportColorsFor(entry, idx) {
  if (typeof rosterColors === "function" && entry) {
    try { const c = rosterColors(entry, idx); if (c && c.tx) return c; } catch (e) { console.warn("exportColorsFor: rosterColors threw - falling back", e); }
  }
  if (typeof surgeonColors === "function" && entry) {
    try { const c = surgeonColors(entry.code || entry.name, idx); if (c && c.tx) return c; } catch (e) { console.warn("exportColorsFor: surgeonColors threw - using the export palette", e); }
  }
  return EXPORT_PAL[(idx || 0) % EXPORT_PAL.length];
}
// holidayNameByDay(holidays) -> { "YYYY-MM-DD": "Thanksgiving" }. Accepts the
// blob shape (call_schedule_data.data.holidays = { units: { "2026": [ { name,
// days } ] } }), a flat array of units, the rules-context holidayByDay map
// ({ day: { name, tier } }) or a plain { day: name } map. Anything else -> {}.
function holidayNameByDay(holidays) {
  const out = {};
  if (!holidays || typeof holidays !== "object") return out;
  const addUnit = (u) => { if (u && Array.isArray(u.days)) u.days.forEach(d => { if (typeof d === "string") out[d] = String(u.name || "Holiday"); }); };
  if (Array.isArray(holidays)) { holidays.forEach(addUnit); return out; }
  if (holidays.units && typeof holidays.units === "object") {
    Object.keys(holidays.units).forEach(y => (Array.isArray(holidays.units[y]) ? holidays.units[y] : []).forEach(addUnit));
    return out;
  }
  Object.keys(holidays).forEach(k => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return;
    const v = holidays[k];
    if (typeof v === "string") out[k] = v; else if (v && typeof v === "object" && v.name) out[k] = String(v.name);
  });
  return out;
}
// Months covered by a schedule map, as [{ year, month }] (month 0-based).
function monthsOfSchedule(schedule) {
  const keys = Object.keys(schedule || {}).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (!keys.length) { const n = new Date(); return [{ year: n.getFullYear(), month: n.getMonth() }]; }
  const out = [];
  let cur = new Date(Number(keys[0].slice(0, 4)), Number(keys[0].slice(5, 7)) - 1, 1);
  const last = keys[keys.length - 1];
  while (fmt(cur).slice(0, 7) <= last.slice(0, 7)) { out.push({ year: cur.getFullYear(), month: cur.getMonth() }); cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1); }
  return out;
}
// normalizeMonths(months, schedule): accepts [{year, month}], ["2026-11"],
// { startYear, startMonth, numMonths } or nothing (-> the schedule's span).
function normalizeMonths(months, schedule) {
  if (Array.isArray(months) && months.length) {
    return months.map(m => {
      if (typeof m === "string") { const mm = /^(\d{4})-(\d{2})/.exec(m); return mm ? { year: Number(mm[1]), month: Number(mm[2]) - 1 } : null; }
      if (m && typeof m === "object" && typeof m.year === "number" && typeof m.month === "number") return { year: m.year, month: m.month };
      return null;
    }).filter(Boolean);
  }
  if (months && typeof months === "object" && typeof months.startYear === "number") {
    const out = []; const n = Math.max(1, Number(months.numMonths) || 1);
    for (let i = 0; i < n; i++) { const d = new Date(months.startYear, (months.startMonth || 0) + i, 1); out.push({ year: d.getFullYear(), month: d.getMonth() }); }
    return out;
  }
  return monthsOfSchedule(schedule);
}
function monthLabel(ym) { return EXPORT_MONTH_NAMES[ym.month] + " " + ym.year; }
function monthRange(ym) { return { start: fmt(new Date(ym.year, ym.month, 1)), end: fmt(new Date(ym.year, ym.month + 1, 0)) }; }

/* ═══ ICS Calendar Generation ═══
   Client-side twin of edge-functions/calendar-sync/index.ts buildEvents, the
   feed's default ALL-DAY format since 2026-09-25 (Faraz: "the calendar looks
   busy, and 07:00 -> 07:00 shifts draw across two days"): one all-day event per
   run of consecutive days with the same SUMMARY, DESCRIPTION, UID and
   DTSTART;VALUE=DATE / DTEND;VALUE=DATE lines - test/exports.test.js evaluates
   the feed's @icsCore block and requires the download's VEVENTs to equal the
   feed's. The download is all-day only (the feed alone keeps the old per-day
   07:00 -> 07:00 events behind ?timed=1). generateICS still writes TZID local
   stamps plus a VTIMEZONE block for a caller that passes timed tzid events. */
const ICS_TZID = "America/Chicago";
const ICS_UID_DOMAIN = "silvis-call";
const ICS_ROLE_LABEL = { primary: "Primary", backup: "Backup" };

function icsDate(y,m,d,h,min) {
  return `${y}${String(m).padStart(2,"0")}${String(d).padStart(2,"0")}T${String(h).padStart(2,"0")}${String(min||0).padStart(2,"0")}00`;
}
// RFC 5545 3.3.11 text escaping.
function icsEscape(text) {
  return String(text == null ? "" : text).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
// RFC 5545 3.1 line folding at 75 octets (notes can be long).
function icsFold(line) {
  const enc = (typeof TextEncoder !== "undefined") ? new TextEncoder() : null;
  const octets = (s) => enc ? enc.encode(s).length : Buffer.byteLength(s, "utf8");
  if (octets(line) <= 75) return line;
  const out = []; let cur = "", curLen = 0;
  for (const ch of line) {
    const l = octets(ch);
    const limit = out.length === 0 ? 75 : 74;
    if (curLen + l > limit) { out.push(cur); cur = " " + ch; curLen = 1 + l; }
    else { cur += ch; curLen += l; }
  }
  if (cur) out.push(cur);
  return out.join("\r\n");
}
// America/Chicago: CDT from the second Sunday of March 02:00, CST from the
// first Sunday of November 02:00 (US rules since 2007).
function icsVTimezone(tzid) {
  if (tzid && tzid !== ICS_TZID) return `BEGIN:VTIMEZONE\r\nTZID:${tzid}\r\nEND:VTIMEZONE`;
  return [
    "BEGIN:VTIMEZONE", "TZID:America/Chicago", "X-LIC-LOCATION:America/Chicago",
    "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0600", "TZOFFSETTO:-0500", "TZNAME:CDT", "DTSTART:19700308T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT",
    "BEGIN:STANDARD", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0600", "TZNAME:CST", "DTSTART:19701101T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD",
    "END:VTIMEZONE",
  ].join("\r\n");
}

// Date-string helpers for the runs (UTC arithmetic on YYYY-MM-DD, no zone involved).
const ICS_WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function icsYmdParts(s) { return String(s).split("-").map(Number); }
function icsAddDays(s, n) {
  const p = icsYmdParts(s), d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function icsWeekday(s) { const p = icsYmdParts(s); return ICS_WEEKDAY[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()]; }
function icsMd(s) { const p = icsYmdParts(s); return `${p[1]}/${p[2]}`; }
// An endpoint of a run for the times line: the weekday, plus M/D when the run is 7+ days
// (the weekdays alone would read "Mon -> Mon"); the calendar-sync feed does the same (runTimesLine).
function icsRunAt(run, s) { return icsAddDays(run.first, 7) <= icsAddDays(run.last, 1) ? `${icsWeekday(s)} ${icsMd(s)}` : icsWeekday(s); }
// "Backup: Acton" when one holder covers the run, else "Backup: 10/9-10/10 Acton, 10/11 Philip".
function icsHolderLine(label, days) {
  const groups = [];
  days.forEach(x => {
    const g = groups[groups.length - 1];
    if (g && g.name === x.name) g.last = x.day;
    else groups.push({ first: x.day, last: x.day, name: x.name });
  });
  if (groups.length === 1) return `${label}: ${groups[0].name}`;
  return `${label}: ` + groups.map(g => (g.first === g.last ? icsMd(g.first) : `${icsMd(g.first)}-${icsMd(g.last)}`) + " " + g.name).join(", ");
}

// buildICSEvents(schedule, surgeonId, roster, { from, to }) -> ALL-DAY events,
// one per run of consecutive days (the calendar-sync feed's default format):
//   surgeonId given: the days that surgeon holds the SAME role, titled
//     "Silvis Primary" / "Silvis Backup", UID silvis-<start>-<role>@silvis-call;
//   surgeonId null (the group): the days with the SAME primary AND backup,
//     titled "P <name> \u00b7 B <name>" (OPEN for an empty slot, "<name> (external
//     cover)" for an externalCover), UID silvis-<start>-group@silvis-call. A day
//     with neither a primary nor a backup is no event and ends the run; an
//     externalCover alone is not an event (it is not a roster member).
// UIDs are keyed on the run's START day: a run growing or shrinking at its end
// keeps its UID; a new start day is a new UID. start = the first day, end = the
// day after the last (YYYYMMDD, exclusive - DTEND;VALUE=DATE). desc: "07:00 Fri
// \u2192 07:00 Mon (Central)"; a run of 7+ days adds the dates, "07:00 Mon 1/4 ->
// 07:00 Mon 1/11"), then "Primary: ..." / "Backup: ..." (each holder with
// its days when it changes inside the run). The day's internal note never
// reaches a calendar (Faraz 9/25). from/to (YYYY-MM-DD, inclusive, optional)
// filter the days before the runs are merged. Each event: { uid, allDay: true,
// day (first), last, role ('primary' | 'backup' | 'group'), surgeonId (null for
// the group), start, end, summary, desc }; sorted by first day, primary before
// backup on a shared first day.
function buildICSEvents(schedule, surgeonId, roster, range) {
  const sched = schedule || {};
  const r = range || {};
  const list = Array.isArray(roster) ? roster : [];
  const nameById = {}; list.forEach(x => { if (x && x.id) nameById[x.id] = x.name || x.id; });
  const nameOf = (id) => id ? (nameById[id] || id) : "OPEN";
  const only = surgeonId || null;
  const days = [];
  Object.keys(sched).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().forEach(day => {
    if (r.from && day < r.from) return;
    if (r.to && day > r.to) return;
    const a = sched[day];
    if (!a) return;
    days.push({
      day, primaryId: a.primary || null, backupId: a.backup || null,
      primaryKey: a.primary ? "id:" + a.primary : (a.externalCover ? "ext:" + a.externalCover : ""),
      primaryName: a.primary ? nameOf(a.primary) : (a.externalCover ? `${a.externalCover} (external cover)` : "OPEN"),
      backupName: nameOf(a.backup || null),
    });
  });
  const pairKey = (d) => d.primaryKey + "|" + (d.backupId || "");
  const runs = [], current = {};
  days.forEach(d => {
    const keys = only
      ? ["primary", "backup"].filter(role => (role === "primary" ? d.primaryId : d.backupId) === only)
      : ((d.primaryId || d.backupId) ? ["group"] : []);
    keys.forEach(key => {
      const cur = current[key];
      if (cur && cur.last === icsAddDays(d.day, -1) && (key !== "group" || cur.pair === pairKey(d))) { cur.last = d.day; cur.days.push(d); }
      else { const run = { key, first: d.day, last: d.day, pair: pairKey(d), days: [d] }; runs.push(run); current[key] = run; }
    });
  });
  return runs.map(run => ({
    uid: `silvis-${run.first}-${run.key}@${ICS_UID_DOMAIN}`, allDay: true,
    day: run.first, last: run.last, role: run.key, surgeonId: only,
    start: run.first.replace(/-/g, ""), end: icsAddDays(run.last, 1).replace(/-/g, ""),
    summary: only ? `Silvis ${ICS_ROLE_LABEL[run.key]}` : `P ${run.days[0].primaryName} \u00b7 B ${run.days[0].backupName}`,
    desc: [
      `07:00 ${icsRunAt(run, run.first)} \u2192 07:00 ${icsRunAt(run, icsAddDays(run.last, 1))} (Central)`,
      icsHolderLine("Primary", run.days.map(x => ({ day: x.day, name: x.primaryName }))),
      icsHolderLine("Backup", run.days.map(x => ({ day: x.day, name: x.backupName }))),
    ].join("\n"),
  }));
}

// File names: per surgeon "silvis-call-<lastname>.ics", group "silvis-call-all.ics".
function icsFileName(surgeonOrName) {
  const name = surgeonOrName && typeof surgeonOrName === "object" ? surgeonOrName.name : surgeonOrName;
  const slug = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `silvis-call-${slug || "all"}.ics`;
}

// generateICS(events, calName, opts) -> the VCALENDAR text. An `allDay` event
// (buildICSEvents) is written as DTSTART;VALUE=DATE / DTEND;VALUE=DATE with its
// YYYYMMDD start / end. Events carrying `tzid` are written as
// DTSTART;TZID=<tz>:<local stamp> and the calendar gets one VTIMEZONE block for
// that zone (opts.tz === false suppresses both); other events keep the old
// floating/UTC form. UIDs come from the event when present (stable per run
// start + role) - a random one otherwise.
function generateICS(events, calName, opts) {
  const o = opts || {};
  const evs = Array.isArray(events) ? events : [];
  const zones = [];
  evs.forEach(e => { if (e && e.tzid && zones.indexOf(e.tzid) < 0) zones.push(e.tzid); });
  const useTz = o.tz !== false && zones.length > 0;
  const now = new Date();
  const pad2 = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}T${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}00Z`;
  const randomUid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}@${ICS_UID_DOMAIN}`;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Silvis Call Schedule//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", icsFold(`X-WR-CALNAME:${icsEscape(calName || "Silvis Call")}`)];
  if (useTz) { lines.push(`X-WR-TIMEZONE:${zones[0]}`); zones.forEach(z => lines.push(icsVTimezone(z))); }
  evs.forEach(e => {
    if (!e) return;
    lines.push("BEGIN:VEVENT", `UID:${e.uid || randomUid()}`, `DTSTAMP:${stamp}`);
    if (e.allDay) lines.push(`DTSTART;VALUE=DATE:${e.start}`, `DTEND;VALUE=DATE:${e.end}`);
    else if (useTz && e.tzid) lines.push(`DTSTART;TZID=${e.tzid}:${e.start}`, `DTEND;TZID=${e.tzid}:${e.end}`);
    else lines.push(`DTSTART:${e.start}`, `DTEND:${e.end}`);
    lines.push(icsFold(`SUMMARY:${icsEscape(e.summary)}`), icsFold(`DESCRIPTION:${icsEscape(e.desc)}`), "END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

function downloadICS(content, filename) {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// Download an arbitrary object as a pretty-printed JSON file. Used for the
// manual schedule backup in the Data Management card.
// Returns true if a real file download was triggered, false if it had to fall
// back to opening the JSON in a new view (standalone iOS PWAs ignore the
// <a download> attribute and would otherwise silently do nothing).
function downloadJSON(obj, filename) {
  return downloadBlobFile(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }), filename);
}

// downloadTextFile(text, filename, mime) - the share page / ER panel .html
// downloads. Same iOS-standalone fallback as downloadJSON. Returns true when a
// real download was triggered.
function downloadTextFile(text, filename, mime) {
  return downloadBlobFile(new Blob([String(text)], { type: (mime || "text/plain") + ";charset=utf-8" }), filename);
}

function downloadBlobFile(blob, filename) {
  const url = URL.createObjectURL(blob);

  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone = window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);

  if (isIOS && isStandalone) {
    // Open in a new view; user saves via Share -> Save to Files.
    const w = window.open(url, "_blank");
    if (!w) { try { location.href = url; } catch(e) { console.warn("Couldn't open download (popup blocked and redirect failed):", e); } }
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return false;
  }

  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

/* === Dark-mode text palette (vis-003) ===
   config.js SURGEON_COLOR_BY_CODE.tx is tuned for light backgrounds (it sits
   on the tg pill). Text written straight on the dark page (#1a1a2e / #16213e)
   needs a lightened variant per code; Fierce's charcoal tx is invisible there.
   Every value here clears 4.5:1 against #1a1a2e (the harness checks 3:1 on
   the rendered week rows). Unpinned codes fall back to the border colour,
   which is always a mid tone. */
const SURGEON_DARK_TEXT_BY_CODE = {
  "FAK": "#8fb8e0", // Khan     - slate blue, lightened
  "MAB": "#e6c86a", // Burchett - mustard
  "BDA": "#9fd0a4", // Acton    - sage
  "AFP": "#f0a898", // Philip   - coral
  "NF":  "#c8d0dc", // Fierce   - charcoal -> light grey-blue
  "SRK": "#e8a8c8", // Sarkar   - rose
};
// surgeonTextColor(colors, code, dark) -> css colour for a name on the page.
function surgeonTextColor(c, code, dark) {
  const col = c || {};
  if (!dark) return col.tx || "#2c3e50";
  return SURGEON_DARK_TEXT_BY_CODE[code] || col.bd || "#c0c8d8";
}

/* ═══ Shareable read-only page (Prompt 9) ═══
   generateShareHTML(schedule, roster, { months, holidays, vacations,
   generatedAt, appUrl }) -> one self-contained HTML string: inline CSS, the
   Outfit web font with a system fallback, NO scripts. Per month: the month
   grid the app shows (Sunday-first by default, Monday-first with
   opts.weekStartsOn 'mon' - Item A; two lines per day, "P <name>" / "B <name>", OPEN in
   red, an externalCover in italics, holiday unit names, vacation lines) and
   the ER-panel author's week-rows table for that month (buildWeekRows, always Mon-Sun). `months` follows
   normalizeMonths(); default = the schedule's span. opts.today (default
   todayCentral()): an unassigned slot before today renders an empty line
   (the P/B letter stays, no OPEN text, no red) - slotIsOpen decides. */
// Group call (Faraz 9/29): the rule sentence's styles - appended only when the sentence is shown, so a disabled rule
// leaves the share page and the printable month exactly as they were.
const GROUP_CALL_SHARE_CSS = ".hd p.gc{margin-top:6px;color:#13294B;font-size:12px}\n";
const GROUP_CALL_PRINT_CSS = "    .group-call-rule { text-align: center; font-family: Arial, Helvetica, sans-serif; font-size: 8.5pt; color: #3a2030; padding: 0 16px 8px; line-height: 1.35; }\n";
function generateShareHTML(schedule, roster, opts) {
  const o = opts || {};
  const sched = schedule || {};
  // opts.groupRules (Faraz 9/29): the group-call rule sentence under the title - text only, no names; nothing when disabled
  const gcRule = groupCallRuleSentence(o.groupRules);
  const list = (roster || []).filter(r => r && r.id);
  const months = normalizeMonths(o.months, sched);
  const weekStartsOn = normalizeWeekStart(o.weekStartsOn);
  const holByDay = holidayNameByDay(o.holidays);
  const vacations = o.vacations || {};
  const generatedAt = o.generatedAt ? new Date(o.generatedAt) : new Date();
  const today = todayOrCentral(o.today);
  const nameById = {}, colorById = {};
  list.forEach((r, i) => { nameById[r.id] = r.name || r.id; colorById[r.id] = exportColorsFor(r, i); });
  const nameOf = (id) => nameById[id] || id;
  const pill = (id) => { const c = colorById[id] || EXPORT_PAL[6]; return `<span class="bdg" style="background:${c.tg};color:${c.tx};border-color:${c.bd}${c.dashed ? ";border-style:dashed" : ""}">${escHtml(nameOf(id))}</span>`; };
  const holderHtml = (a, role, ds) => {
    const h = dayHolder(a, role);
    if (!h) return slotIsOpen(ds, h, today) ? `<span class="open">OPEN</span>` : "";
    if (typeof h === "string" && h.indexOf("ext:") === 0) return `<span class="ext">${escHtml(h.slice(4))} (ext)</span>`;
    return pill(h);
  };
  const entryHtml = (e) => e.kind === "open" ? `<div class="wr-open">${escHtml(e.text)}</div>` : e.kind === "external" ? `<div class="wr-ext">${escHtml(e.text)}</div>` : `<div class="wr-s" style="color:${(colorById[e.id] || EXPORT_PAL[6]).tx}">${escHtml(e.text)}</div>`;

  let body = "";
  months.forEach(ym => {
    const range = monthRange(ym);
    const first = parse(range.start), last = parse(range.end);
    let grid = `<div class="cg">` + weekdayLabels(weekStartsOn).map(h => `<div class="ch${h === "Fri" || h === "Sat" || h === "Sun" ? " wk" : ""}">${h}</div>`).join("");
    monthGridDays(first.getFullYear(), first.getMonth(), weekStartsOn).forEach(ds => {
      const d = parse(ds);
      if (ds < range.start || ds > range.end) { grid += `<div class="ce"></div>`; return; }
      const a = sched[ds] || null;
      const dow = d.getDay();
      const isWk = dow === 5 || dow === 6 || dow === 0;
      const hol = holByDay[ds];
      const cls = "cd" + (hol ? " hol" : isWk ? " we" : "");
      let inner = `<div class="dn"><span>${d.getDate()}</span>${hol ? `<span class="ht">${escHtml(hol)}</span>` : ""}</div>`;
      inner += `<div class="ln"><span class="rl">P</span>${holderHtml(a, "primary", ds)}</div>`;
      inner += `<div class="ln"><span class="rl">B</span>${holderHtml(a, "backup", ds)}</div>`;
      const vac = list.filter(s => onVac(s.id, ds, vacations)).map(s => escHtml(s.name));
      if (vac.length) inner += `<div class="vl">VAC ${vac.join(", ")}</div>`;
      if (a && a.note) inner += `<div class="nt" title="${escHtml(a.note)}">NOTE</div>`;
      grid += `<div class="${cls}" data-day="${ds}">${inner}</div>`;
    });
    grid += `</div>`;
    const rows = buildWeekRows(sched, list, range.start, range.end, { today });
    let table = `<table class="wr" data-month="${range.start.slice(0, 7)}"><thead><tr><th>MON/SUN DATES</th><th>TRAUMA</th><th>TRAUMA BACKUP</th></tr></thead><tbody>`;
    rows.forEach(r => { table += `<tr data-week="${r.monday}"><td class="wd">${escHtml(r.label)}</td><td>${r.primary.map(entryHtml).join("")}</td><td>${r.backup.map(entryHtml).join("")}</td></tr>`; });
    table += `</tbody></table>`;
    body += `<section class="mo" data-month="${range.start.slice(0, 7)}"><h2 class="mh">${escHtml(monthLabel(ym))}</h2>${grid}<h3 class="wh">Week rows - ${escHtml(monthLabel(ym))}</h3><div class="tw">${table}</div></section>`;
  });

  const legend = list.map((s, i) => { const c = colorById[s.id]; return `<span><span class="sw" style="background:${c.tg};border-color:${c.bd}${c.dashed ? ";border-style:dashed" : ""}"></span>${escHtml(s.name)} <code>${escHtml(s.code || "")}</code></span>`; }).join("");
  const span = months.length === 1 ? monthLabel(months[0]) : `${monthLabel(months[0])} to ${monthLabel(months[months.length - 1])}`;
  const stamp = `${generatedAt.getMonth() + 1}/${generatedAt.getDate()}/${generatedAt.getFullYear()} ${String(generatedAt.getHours()).padStart(2, "0")}:${String(generatedAt.getMinutes()).padStart(2, "0")}`;
  const css = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Outfit',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f0f2f5;color:#2c3e50;padding:16px;max-width:1100px;margin:0 auto}
.hd{text-align:center;margin-bottom:16px;padding:18px;background:#fff;border:1px solid #dce2e8;border-radius:12px}
.hd h1{font-size:20px;color:#1a2a3a;margin-bottom:4px}.hd p{font-size:12px;color:#6a7a88;line-height:1.5}
.hd a{color:#C2410C}
.ro{text-align:center;margin-bottom:16px;padding:8px 16px;background:#fff;border:1px solid #dce2e8;border-radius:8px;font-size:11px;color:#13294B}
.mo{background:#fff;border:1px solid #dce2e8;border-radius:10px;margin-bottom:16px;padding:14px;overflow:hidden}
.mh{font-size:16px;font-weight:700;color:#1a2a3a;margin-bottom:10px;text-align:center}
.wh{font-size:12px;font-weight:700;color:#13294B;margin:14px 0 6px;text-transform:uppercase;letter-spacing:1px}
.cg{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:2px}
.ch{text-align:center;font-size:10px;font-weight:700;color:#8a94a0;padding:4px 0;text-transform:uppercase;letter-spacing:1px}
.ch.wk{color:#3d6a8c;background:#eef3f8;border-radius:4px}
.ce{background:#f8f9fb;min-height:74px;border-radius:3px}
.cd{background:#fff;border:1px solid #e8ecf0;min-height:74px;padding:3px 4px;border-radius:3px;font-size:11px;line-height:1.35;overflow:hidden}
.cd.we{background:#f3f6f9;border-top:2px solid #a9c4da}
.cd.hol{background:#fdf6dc;border-color:#e8d890}
.dn{display:flex;justify-content:space-between;align-items:center;gap:4px;margin-bottom:2px;font-size:11px;font-weight:600;color:#4a5a68;font-family:ui-monospace,Menlo,Consolas,monospace}
.ht{font-size:9px;font-weight:700;color:#8a6a10;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:'Outfit',sans-serif}
.ln{display:flex;align-items:center;gap:3px;margin-top:2px;min-width:0}
.rl{font-size:9px;font-weight:800;color:#8a94a0;width:8px;flex-shrink:0}
.bdg{display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:4px;padding:0 5px;font-weight:600;border:1px solid transparent}
.open{color:#c04040;font-weight:800;letter-spacing:.4px}
.ext{color:#6a7a88;font-style:italic;background:#eef1f4;border:1px solid #d8dee6;border-radius:4px;padding:0 5px}
.vl{font-size:9px;color:#7a8a98;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nt{font-size:8px;color:#9aa4ae;font-weight:700;letter-spacing:.5px;text-align:right}
.tw{overflow-x:auto}
.wr{width:100%;border-collapse:collapse;font-size:12px}
.wr th{text-align:left;padding:7px 8px;color:#5a6a78;font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #dce2e8}
.wr td{padding:7px 8px;vertical-align:top;border-top:1px solid #eef1f4}
.wr .wd{white-space:nowrap;font-family:ui-monospace,Menlo,Consolas,monospace;color:#4a5a68}
.wr-open{color:#c04040;font-weight:800}.wr-ext{color:#6a7a88;font-style:italic}.wr-s{font-weight:600}
.lg{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;font-size:11px;color:#6a7a88;background:#fff;border:1px solid #dce2e8;border-radius:10px;padding:10px 14px;margin-bottom:16px;line-height:1.6}
.lg span{display:inline-flex;align-items:center;gap:4px}.lg code{font-size:10px;color:#8a94a0}
.sw{width:10px;height:10px;border-radius:3px;border:1px solid;display:inline-block}
.ft{text-align:center;font-size:11px;color:#8a94a0;padding:8px 0 20px}
@media (max-width:600px){body{padding:8px}.cd,.ce{min-height:62px}.bdg{padding:0 3px}.cd{font-size:10px}}
@media print{body{background:#fff;padding:0;max-width:none}.mo{page-break-inside:avoid;box-shadow:none}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Silvis Call Schedule - ${escHtml(span)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap" rel="stylesheet">
<style>${css}${gcRule ? GROUP_CALL_SHARE_CSS : ""}</style></head>
<body>
<div class="hd"><h1>Silvis Surgical Care - Trauma / Acute Care Surgery Call</h1><p>${escHtml(span)} &middot; primary (P, in Silvis) and backup (B) &middot; one 24-hour shift per day, 07:00 to 07:00${o.appUrl ? ` &middot; live schedule: <a href="${escHtml(o.appUrl)}">${escHtml(o.appUrl)}</a>` : ""}</p>${gcRule ? `<p class="gc">${escHtml(gcRule)}</p>` : ""}</div>
<div class="ro">Read-only snapshot generated ${escHtml(stamp)}. Changes made after this time are not shown - the live app is the source of truth.</div>
<div class="lg">${legend}<span><span class="open">OPEN</span> = nobody assigned</span><span><span class="ext">Atwell (ext)</span> = external cover</span><span>Fri-Sun tinted = weekend unit</span><span>gold = holiday unit</span><span>VAC = on vacation</span></div>
${body}
<div class="ft">Silvis Call Schedule &middot; generated ${escHtml(stamp)}</div>
</body></html>`;
}

/* ═══ Printable month (Prompt 9) ═══
   buildPrintableCalendarHTML({ startYear, startMonth, numMonths, schedule,
   roster, holidays, vacations, weekStartsOn }) -> a print-ready document: Davenport's page
   assembly and print CSS (letter portrait, one month per page, Sunday-first
   grid - Monday-first with weekStartsOn 'mon', Item A - mini calendars in the
   leading empty cells, vacation bars laid out in
   lanes) with the daily-model cell content: "P <Name>" / "B <Name>" (OPEN in
   red, an external cover in italics), the holiday unit name, and one bar per
   surgeon vacation ("<Name> VAC"). Opened with window.open + document.write;
   the toolbar offers Print / Close and hides itself when printing.
   opts.today (default todayCentral()): an unassigned slot before today is an
   empty "P" / "B" line - no OPEN text, no red (slotIsOpen). */
function buildPrintableCalendarHTML(opts) {
  const o = opts || {};
  const startYear = Number(o.startYear), startMonth = Number(o.startMonth);
  const numMonths = Math.max(1, Number(o.numMonths) || 1);
  const sched = o.schedule || {};
  const list = (o.roster || o.surgeons || []).filter(r => r && r.id);
  const vacations = o.vacations || {};
  const holByDay = holidayNameByDay(o.holidays);
  const today = todayOrCentral(o.today);
  // Group call (Faraz 9/29): the rule sentence under each page's title - text only, no names; "" (nothing added) when
  // groupRules.groupCall.enabled is false, so the document is then exactly what it was before
  const gcRule = groupCallRuleSentence(o.groupRules);
  const MONTH_NAMES = EXPORT_MONTH_NAMES;
  const weekStartsOn = normalizeWeekStart(o.weekStartsOn);
  const startDow = weekStartsOn === "mon" ? 1 : 0; // the grid's first column, as Date#getDay
  const leadOf = (first) => (first.getDay() - startDow + 7) % 7; // columns before the 1st
  const nameById = {}; list.forEach(r => { nameById[r.id] = r.name || r.id; });
  const nameOf = (id) => nameById[id] || id;

  // Vacation bars for the whole range, one per (surgeon, range).
  const bars = [];
  Object.keys(vacations).forEach(pid => {
    if (!nameById[pid]) return;
    (vacations[pid] || []).forEach(([start, end]) => { if (start && end) bars.push({ label: `${nameOf(pid)} VAC`, start, end, type: "surgeon" }); });
  });

  function cellLinesFor(ds) {
    const a = sched[ds] || null;
    const openOrBlank = (h) => slotIsOpen(ds, h, today) ? `<span class="open">OPEN</span>` : "";
    const p = (a && a.primary) ? `<span class="who">${escHtml(nameOf(a.primary))}</span>`
      : (a && a.externalCover) ? `<span class="ext">${escHtml(a.externalCover)} (ext)</span>`
      : openOrBlank(null);
    const b = (a && a.backup) ? `<span class="who">${escHtml(nameOf(a.backup))}</span>` : openOrBlank(null);
    return `<div class="shift"><span class="role">P</span> ${p}</div><div class="shift"><span class="role">B</span> ${b}</div>`;
  }

  function buildWeeks(year, month) {
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - leadOf(first));
    const weeks = [];
    let cursor = new Date(gridStart);
    while (cursor <= last || cursor.getDay() !== startDow) {
      const week = [];
      for (let i = 0; i < 7; i++) {
        week.push({ date: new Date(cursor), ds: fmt(cursor), dayNum: cursor.getDate(), inMonth: cursor.getMonth() === month });
        cursor = addD(cursor, 1);
      }
      weeks.push(week);
      if (weeks.length > 6) break;
    }
    return weeks;
  }

  function computeBarsForWeek(week) {
    const inMonthDays = week.filter(d => d.inMonth);
    if (inMonthDays.length === 0) return { bars: [], laneCount: 0 };
    const firstInMonthCol = week.findIndex(d => d.inMonth);
    const lastInMonthCol = week.length - 1 - [...week].reverse().findIndex(d => d.inMonth);
    const weekStart = week[firstInMonthCol].ds;
    const weekEnd = week[lastInMonthCol].ds;
    const weekBars = [];
    bars.forEach(b => {
      if (b.end < weekStart || b.start > weekEnd) return;
      const segStart = b.start < weekStart ? weekStart : b.start;
      const segEnd = b.end > weekEnd ? weekEnd : b.end;
      const startCol = week.findIndex(d => d.ds === segStart);
      const endCol = week.findIndex(d => d.ds === segEnd);
      if (startCol === -1 || endCol === -1) return;
      weekBars.push({ label: b.label, type: b.type, startCol, span: endCol - startCol + 1 });
    });
    weekBars.sort((a, b) => a.startCol - b.startCol);
    const lanes = [];
    weekBars.forEach(bar => {
      const endCol = bar.startCol + bar.span - 1;
      let placed = false;
      for (let i = 0; i < lanes.length; i++) {
        const conflict = lanes[i].some(seg => !(bar.startCol > seg.endCol || endCol < seg.startCol));
        if (!conflict) { lanes[i].push({ startCol: bar.startCol, endCol }); bar.lane = i; placed = true; break; }
      }
      if (!placed) { lanes.push([{ startCol: bar.startCol, endCol }]); bar.lane = lanes.length - 1; }
    });
    return { bars: weekBars, laneCount: lanes.length };
  }

  function buildMiniCal(year, month) {
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const lead = leadOf(first);
    const days = last.getDate();
    let html = `<div class="mini-cal"><div class="mini-name">${MONTH_NAMES[month]} ${year}</div><div class="mini-grid">`;
    weekdayLabels(weekStartsOn, ["S","M","T","W","T","F","S"]).forEach(d => { html += `<div class="mini-dow">${d}</div>`; });
    for (let i = 0; i < lead; i++) html += `<div class="mini-day empty">0</div>`;
    for (let d = 1; d <= days; d++) html += `<div class="mini-day">${d}</div>`;
    html += `</div></div>`;
    return html;
  }

  function renderMonth(year, month) {
    const weeks = buildWeeks(year, month);
    const firstWeek = weeks[0];
    const emptyLeading = firstWeek.filter(d => !d.inMonth).length;
    let miniPrev = null, miniNext = null;
    if (emptyLeading >= 2) { miniPrev = { col: 0 }; miniNext = { col: 1 }; }
    else if (emptyLeading === 1) { miniPrev = { col: 0 }; }
    const prevMonth = month === 0 ? { y: year - 1, m: 11 } : { y: year, m: month - 1 };
    const nextMonth = month === 11 ? { y: year + 1, m: 0 } : { y: year, m: month + 1 };

    let html = `<div class="page" data-month="${year}-${String(month + 1).padStart(2, "0")}">`;
    html += `<div class="month-title">${MONTH_NAMES[month]} ${year}</div>`;
    if (gcRule) html += `<div class="group-call-rule">${escHtml(gcRule)}</div>`;
    html += `<div class="dow-row">`;
    weekdayLabels(weekStartsOn, ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]).forEach(d => html += `<div class="dow">${d}</div>`);
    html += `</div>`;

    weeks.forEach((week, weekIdx) => {
      const { bars: weekBars, laneCount } = computeBarsForWeek(week);
      const barZoneHeight = laneCount * 14 + 4;
      const cellMinHeight = 85 + barZoneHeight;
      html += `<div class="week-row" style="min-height:${cellMinHeight}px">`;
      week.forEach((d, col) => {
        if (weekIdx === 0 && miniPrev && col === miniPrev.col) { html += `<div class="cell empty">${buildMiniCal(prevMonth.y, prevMonth.m)}</div>`; return; }
        if (weekIdx === 0 && miniNext && col === miniNext.col) { html += `<div class="cell empty">${buildMiniCal(nextMonth.y, nextMonth.m)}</div>`; return; }
        if (!d.inMonth) { html += `<div class="cell empty"></div>`; return; }
        html += `<div class="cell" data-day="${d.ds}">`;
        html += `<div class="day-num">${d.dayNum}</div>`;
        html += cellLinesFor(d.ds);
        const hol = holByDay[d.ds];
        if (hol) html += `<div class="holiday-note">${escHtml(hol)}</div>`;
        html += `</div>`;
      });
      if (weekBars.length) {
        html += `<div class="bars-layer">`;
        weekBars.forEach(bar => {
          const leftPct = (bar.startCol / 7) * 100;
          const widthPct = (bar.span / 7) * 100;
          const bottom = (laneCount - 1 - bar.lane) * 14;
          html += `<div class="bar vac-surgeon" style="left:calc(${leftPct}% + 2px);width:calc(${widthPct}% - 4px);bottom:${bottom}px">${escHtml(bar.label)}</div>`;
        });
        html += `</div>`;
      }
      html += `</div>`;
    });

    const today = new Date();
    const printed = `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`;
    html += `<div class="footer">Silvis Surgical Care - Trauma / Acute Care Surgery Call &middot; P = primary (in Silvis), B = backup &middot; 07:00 to 07:00 &middot; Printed ${printed}</div>`;
    html += `</div>`;
    return html;
  }

  // Davenport print CSS, kept as-is apart from the cell-content classes
  // (.shift .role/.who/.open/.ext) and the dropped APP / Fierce bar types.
  const css = `
    @page { size: letter portrait; margin: 0.4in; }
    body { margin: 0; padding: 20px; background: #e8e5dd; font-family: Arial, Helvetica, sans-serif; }
    .toolbar { max-width: 800px; margin: 0 auto 16px; text-align: center; }
    .toolbar button { font-family: Arial, Helvetica, sans-serif; font-size: 13px; font-weight: 600; padding: 8px 18px; background: linear-gradient(135deg,#13294B,#1F3A6B); color: #fff; border: 1px solid #13294B; border-radius: 6px; cursor: pointer; margin: 0 4px; }
    .toolbar button.secondary { background: #f0f2f5; color: #5a6a78; border: 1px solid #c8d0d8; }
    .toolbar button:hover { opacity: 0.92; }
    .toolbar .hint { color:#5a6a78; font-size:12px; margin-left:10px; }
    .page { width: 800px; margin: 0 auto 28px; background: #fdfbf5; border: 1.5px solid #8a1838; padding: 0; box-shadow: 0 2px 12px rgba(0,0,0,0.12); position: relative; }
    /* Force browsers to print background colours (economy mode would strip
       the maroon borders, the navy DOW ribbon, the vacation bars and the mini calendars). */
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    @media print {
      body { background: white; padding: 0; }
      .toolbar { display: none; }
      .page { margin: 0 auto; box-shadow: none; page-break-after: always; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      .page:last-child { page-break-after: auto; }
    }
    .month-title { text-align: center; font-family: Georgia, "Times New Roman", serif; font-size: 18pt; font-weight: 400; color: #7a1038; letter-spacing: 0.3px; padding: 10px 0 12px; }
    .dow-row { display: grid; grid-template-columns: repeat(7, 1fr); background: linear-gradient(180deg, #202048 0%, #2a2a55 35%, #4a4a78 50%, #2a2a55 65%, #1a1a3a 100%); border-top: 1px solid #8a1838; border-bottom: 1px solid #8a1838; height: 20px; }
    .dow { font-family: Georgia, "Times New Roman", serif; font-style: italic; font-size: 9pt; color: #ffffff; text-align: right; padding: 2px 6px 0 0; letter-spacing: 0.2px; }
    .week-row { position: relative; display: grid; grid-template-columns: repeat(7, 1fr); border-bottom: 1px solid #8a1838; min-height: 120px; }
    .week-row:last-child { border-bottom: none; }
    .cell { position: relative; border-right: 1px solid #8a1838; padding: 3px 5px; min-height: 120px; box-sizing: border-box; }
    .cell:last-child { border-right: none; }
    .cell.empty { background: #fdfbf5; }
    .day-num { font-family: Georgia, "Times New Roman", serif; font-size: 12pt; font-weight: 400; color: #7a1038; text-align: center; line-height: 1.1; margin-top: 2px; }
    .shift { font-family: Arial, Helvetica, sans-serif; font-size: 8.5pt; color: #000000; text-align: center; margin-top: 4px; letter-spacing: 0.2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .shift .role { font-weight: 700; color: #7a1038; font-size: 7.5pt; }
    .shift .who { font-weight: 600; }
    .shift .open { color: #c00000; font-weight: 700; letter-spacing: 0.4px; }
    .shift .ext { font-style: italic; color: #505860; }
    .holiday-note { font-family: Arial, Helvetica, sans-serif; font-size: 7.5pt; color: #7a1038; text-align: center; margin-top: 2px; font-weight: 600; letter-spacing: 0.2px; }
    .mini-cal { background: #f5ebc8; border: 0.5px solid #d4c890; margin: 8px 6px; padding: 3px 4px; font-family: Georgia, "Times New Roman", serif; }
    .mini-name { text-align: center; font-size: 8pt; font-weight: 400; color: #000; margin-bottom: 2px; font-style: italic; }
    .mini-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 0; font-size: 7pt; text-align: center; }
    .mini-dow { font-style: italic; color: #000; font-weight: 400; padding: 1px 0; }
    .mini-day { color: #000; padding: 0.5px 0; font-family: Georgia, serif; }
    .mini-day.empty { visibility: hidden; }
    .bars-layer { position: absolute; left: 0; right: 0; bottom: 2px; pointer-events: none; }
    .bar { position: absolute; height: 13px; line-height: 13px; font-family: Arial, Helvetica, sans-serif; font-size: 7.5pt; font-weight: 400; text-align: center; white-space: nowrap; overflow: hidden; border: 0.5px solid; letter-spacing: 0.2px; }
    .bar.vac-surgeon { background-image: repeating-linear-gradient(135deg, #c8d0dc 0px, #c8d0dc 3px, #bec6d2 3px, #bec6d2 4px); border-color: #98a0ac; color: #202020; }
    .footer { text-align: center; font-family: Arial, Helvetica, sans-serif; font-size: 8pt; color: #000; padding: 6px 0 8px; border-top: 1px solid #8a1838; }
  ` + (gcRule ? GROUP_CALL_PRINT_CSS : "");

  let pages = "";
  let y = startYear, m = startMonth;
  for (let i = 0; i < numMonths; i++) {
    pages += renderMonth(y, m);
    m++;
    if (m > 11) { m = 0; y++; }
  }
  const firstMonthLabel = `${MONTH_NAMES[startMonth]} ${startYear}`;
  const title = numMonths === 1 ? `${firstMonthLabel} - Silvis Call Schedule` : `Silvis Call Schedule - ${numMonths} months from ${firstMonthLabel}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escHtml(title)}</title>
<style>${css}</style>
</head>
<body>
<div class="toolbar">
  <button id="pp-print">Print</button>
  <button class="secondary" id="pp-close">Close</button>
  <span class="hint">Use your browser's print dialog. Choose Letter portrait, default margins. If colours do not print, enable Background graphics under More settings.</span>
</div>
${pages}
<script>
(function () {
  document.getElementById("pp-print").addEventListener("click", function () { window.print(); });
  document.getElementById("pp-close").addEventListener("click", function () {
    try { window.close(); } catch (e) { console.warn("close blocked by the browser", e); }
    setTimeout(function () {
      if (!window.closed) {
        document.body.innerHTML = "<div style='text-align:center;padding:60px 20px;font-family:Arial,Helvetica,sans-serif;color:#5a6a78'>You can close this tab now.</div>";
      }
    }, 100);
  });
  window.__silvisPrintToolbar = true;
})();
</script>
</body>
</html>`;
}

/* ═══ ER Call Panels export for the ER-panel author (Prompt 9) ═══
   buildErCallPanelsHTML(schedule, roster, from, to, opts) -> an HTML <table>
   in her exact layout: header MON/SUN DATES | TRAUMA | TRAUMA BACKUP, one row
   per Mon-Sun week that intersects from..to,
   entries "M/D Name" one per line, consecutive same-surgeon days collapsed to
   "M/D-M/D Name", open days "M/D OPEN" in red, an external cover "M/D Atwell".
   Everything is inline-styled so a text/html clipboard paste lands in Word as
   a real table. Rows are WHOLE Mon-Sun weeks, like her document: a range that
   starts or ends mid-week is widened to the surrounding Mondays/Sundays
   (erPanelSpan) so the row label "9/28 - 10/4" always matches the days
   listed under it - a clipped row would silently drop covered days under a
   header that claims the full week. opts.clipToRange=true is an explicit
   opt-in for callers that want only the in-range days (then the label is
   the clipped span). buildWeekRows does the collapsing. opts.today (default
   todayCentral()) reaches buildWeekRows: a past unassigned day has no entry
   in the HTML, the text flavour or the document (Faraz 9/22). */
function erPanelSpan(from, to) {
  const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!isDay(from) || !isDay(to) || to < from) return { from: from, to: to, widened: false };
  const f = fmt(monOf(parse(from))), t = fmt(addD(monOf(parse(to)), 6));
  return { from: f, to: t, widened: f !== from || t !== to };
}
function erPanelRows(schedule, roster, from, to, opts) {
  const clip = !!(opts && opts.clipToRange);
  const rows = buildWeekRows(schedule, roster, from, to, { clipToRange: clip, today: opts && opts.today });
  if (clip) rows.forEach(r => { if (r.days.length) { const a = r.days[0], b = r.days[r.days.length - 1]; r.label = a === b ? fmtMD(a) : fmtMD(a) + " - " + fmtMD(b); } });
  return rows;
}
function buildErCallPanelsHTML(schedule, roster, from, to, opts) {
  const rows = erPanelRows(schedule, roster, from, to, opts);
  const font = "font-family:Calibri,Arial,Helvetica,sans-serif;font-size:11pt";
  const thS = `style="border:1px solid #000000;padding:4px 8px;${font};font-weight:bold;text-align:left;vertical-align:top;background:#ffffff"`;
  const tdS = `style="border:1px solid #000000;padding:4px 8px;${font};vertical-align:top;white-space:nowrap"`;
  const entry = (e) => e.kind === "open"
    ? `<span data-kind="open" style="color:#ff0000;font-weight:bold">${escHtml(e.text)}</span>`
    : `<span data-kind="${e.kind}">${escHtml(e.text)}</span>`;
  let html = `<table data-export="er-call-panels" style="border-collapse:collapse;border:1px solid #000000"><thead><tr>`;
  html += `<th ${thS}>MON/SUN DATES</th><th ${thS}>TRAUMA</th><th ${thS}>TRAUMA BACKUP</th></tr></thead><tbody>`;
  rows.forEach(r => {
    html += `<tr data-week="${r.monday}"><td ${tdS}>${escHtml(r.label)}</td><td ${tdS}>${r.primary.map(entry).join("<br>")}</td><td ${tdS}>${r.backup.map(entry).join("<br>")}</td></tr>`;
  });
  html += `</tbody></table>`;
  return html;
}

// Plain-text twin for the clipboard's text/plain flavour and for reports: one
// line per week, tab-separated columns, entries joined with "; ".
function buildErCallPanelsText(schedule, roster, from, to, opts) {
  const rows = erPanelRows(schedule, roster, from, to, opts);
  const lines = ["MON/SUN DATES\tTRAUMA\tTRAUMA BACKUP"];
  rows.forEach(r => lines.push(`${r.label}\t${r.primary.map(e => e.text).join("; ")}\t${r.backup.map(e => e.text).join("; ")}`));
  return lines.join("\n");
}

// Standalone document around the table (the "Download .html" button).
function buildErCallPanelsDocument(schedule, roster, from, to, opts) {
  const table = buildErCallPanelsHTML(schedule, roster, from, to, opts);
  const span = (opts && opts.clipToRange) ? { from: from, to: to } : erPanelSpan(from, to);
  const title = `ER Call Panels - Silvis Surgical Care - ${fmtMD(span.from)} to ${fmtMD(span.to)}`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${escHtml(title)}</title>
<style>body{font-family:Calibri,Arial,Helvetica,sans-serif;font-size:11pt;color:#000;padding:24px;background:#fff}h1{font-size:14pt;margin:0 0 4px}p{margin:0 0 12px;font-size:9pt;color:#444}@media print{body{padding:0}}</style>
</head><body>
<h1>${escHtml(title)}</h1>
<p>Trauma / acute care surgery call (primary in Silvis; backup). Open days in red. Select the table and copy it into the Word document.</p>
${table}
</body></html>`;
}

/* === Setup view helpers (Prompt 6 Slice E) - pure, prefixed su* so no name
   collides with config.js / rules.js / east-feed.js / generator.js. The
   Setup cards (roster, availability paste box, holidays, generate preview,
   seed import, setup issues) call these; index-source.html only wires state. */
function suIsIso(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function suAddDays(iso, n) { return fmt(addD(parse(iso), n)); }
function suDaysBetween(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
function suMakeDate(y, m, d) {
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return fmt(dt);
}
// suParseDateList(text, defaultYear) -> { dates: [ISO...] sorted unique, bad: [token...] }
// Accepts "10/6, 10/10, 10/11", "10/6/2026", ISO dates, and ranges "10/6-10/8",
// "10/6 - 10/8" or "2026-10-06..2026-10-08". M/D tokens take defaultYear.
function suParseDateList(text, defaultYear) {
  const out = new Set(), bad = [];
  const yr = Number(defaultYear) || new Date().getFullYear();
  const one = (tok) => {
    let m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(tok))) return suMakeDate(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(tok))) return suMakeDate(+m[3], +m[1], +m[2]);
    if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(tok))) return suMakeDate(2000 + +m[3], +m[1], +m[2]);
    if ((m = /^(\d{1,2})\/(\d{1,2})$/.exec(tok))) return suMakeDate(yr, +m[1], +m[2]);
    return null;
  };
  const addRange = (a, b, tok) => {
    if (!a || !b || b < a || suDaysBetween(a, b) > 366) { bad.push(tok); return; }
    for (let d = a; d <= b; d = suAddDays(d, 1)) out.add(d);
  };
  const norm = String(text || "").replace(/(\d)\s+(?:-|to)\s+(\d)/g, "$1-$2").replace(/(\d)\s*\.\.\s*(\d)/g, "$1..$2");
  norm.split(/[,\s;]+/).map(t => t.trim()).filter(Boolean).forEach(tok => {
    let m;
    if (tok.indexOf("..") > 0) { const p = tok.split(".."); addRange(one(p[0]), one(p[1]), tok); return; }
    if ((m = /^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)-(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)$/.exec(tok))) { addRange(one(m[1]), one(m[2]), tok); return; }
    const d = one(tok);
    if (d) out.add(d); else bad.push(tok);
  });
  return { dates: Array.from(out).sort(), bad: bad };
}
// suCollapseDates([ISO...]) -> [{ start, end }] consecutive runs merged.
function suCollapseDates(dates) {
  const list = Array.from(new Set((dates || []).filter(suIsIso))).sort();
  const out = [];
  list.forEach(d => {
    const last = out[out.length - 1];
    if (last && suAddDays(last.end, 1) === d) { last.end = d; return; }
    out.push({ start: d, end: d });
  });
  return out;
}
// suNextMatchingDates(matcher, pattern, fromIso, n, horizonDays) -> the next n
// dates on/after fromIso for which matcher(date, pattern) is true. A matcher
// that THROWS (a broken pattern) stops the scan; the partial list comes back
// with `.error` set to the message so the Rules card can say "pattern is
// invalid" instead of "no matching date" (Prompt 11 hardening).
function suNextMatchingDates(matcher, pattern, fromIso, n, horizonDays) {
  const out = [];
  if (typeof matcher !== "function" || !pattern || !suIsIso(fromIso)) return out;
  const limit = horizonDays || 730;
  for (let k = 0; k < limit && out.length < (n || 8); k++) {
    const d = suAddDays(fromIso, k);
    let hit = false;
    try { hit = !!matcher(d, pattern); }
    catch (e) {
      console.warn("suNextMatchingDates: the pattern matcher threw for", pattern, e);
      out.error = String(e && e.message || e);
      return out;
    }
    if (hit) out.push(d);
  }
  return out;
}
// suHolidayCoverage(schedule, unit) -> who covers the unit right now.
//   { primary: id | "ext:<name>" | null | "mixed", backup: id | null | "mixed", days: [{ day, p, b }], openSlots }
function suHolidayCoverage(schedule, unit) {
  const sched = schedule || {};
  const days = ((unit && unit.days) || []).slice().sort().map(day => {
    const a = sched[day] || null;
    return { day: day, p: dayHolder(a, "primary"), b: dayHolder(a, "backup") };
  });
  const uniform = (key) => { const vals = days.map(x => x[key]); const first = vals[0] === undefined ? null : vals[0]; return vals.every(v => v === first) ? first : "mixed"; };
  return { primary: days.length ? uniform("p") : null, backup: days.length ? uniform("b") : null, days: days, openSlots: days.filter(x => !x.p).length + days.filter(x => !x.b).length };
}
// suHolidayCounts(schedule, unitsByYear, sinceIso) -> { id: { major, minor } }:
// units (start day on/after sinceIso) on which the surgeon holds primary or
// backup on at least one day. A unit counts once per surgeon.
function suHolidayCounts(schedule, unitsByYear, sinceIso) {
  const out = {};
  const sched = schedule || {};
  Object.keys(unitsByYear || {}).forEach(y => (unitsByYear[y] || []).forEach(u => {
    const days = (u && Array.isArray(u.days) ? u.days : []).slice().sort();
    if (!days.length || (sinceIso && days[0] < sinceIso)) return;
    const held = new Set();
    days.forEach(d => { const a = sched[d]; if (a && a.primary) held.add(a.primary); if (a && a.backup) held.add(a.backup); });
    held.forEach(id => { const t = out[id] || (out[id] = { major: 0, minor: 0 }); if ((u.tier || "major") === "major") t.major++; else t.minor++; });
  }));
  return out;
}
// suOpenPrimaryDays(schedule, fromIso, count) -> days in [from, from+count) with
// no primary and no external cover - openSlots with today = fromIso (Prompt 13).
function suOpenPrimaryDays(schedule, fromIso, count) {
  if (!suIsIso(fromIso)) return [];
  return openSlots(schedule, fromIso, suAddDays(fromIso, (count || 60) - 1), fromIso).filter(s => s.role === "primary").map(s => s.day);
}
// suCoverageGlance(schedule, fromIso, count, eastForecast, threshold) -> the
// "coverage at a glance" numbers for the next `count` days from fromIso
// (Prompt 11): open primary days, open backup days, and days where a surgeon
// whose East forecast is at/above the threshold holds PRIMARY (should be 0 -
// the generator treats those days as busy). eastForecast is
// { surgeonId: { day: probability } } (ctxInputs.eastForecast shape). Pure.
//   -> { openPrimary: [days], openBackup: [days], forecastPrimary: [{ day, id, p }] }
// openPrimary / openBackup come THROUGH openSlots(schedule, fromIso,
// fromIso + count - 1, fromIso) - the ONE definition of open (Prompt 13 part
// 1); the strip passes todayStr as fromIso, so the window is today forward.
function suCoverageGlance(schedule, fromIso, count, eastForecast, threshold) {
  const sched = schedule || {};
  const out = { openPrimary: [], openBackup: [], forecastPrimary: [] };
  if (!suIsIso(fromIso)) return out;
  const th = typeof threshold === "number" ? threshold : 0.5;
  const fc = eastForecast || {};
  const n = count || 60;
  openSlots(sched, fromIso, suAddDays(fromIso, n - 1), fromIso).forEach(s => { (s.role === "primary" ? out.openPrimary : out.openBackup).push(s.day); });
  for (let k = 0; k < n; k++) {
    const d = suAddDays(fromIso, k);
    const a = sched[d] || null;
    if (a && a.primary && fc[a.primary] && typeof fc[a.primary][d] === "number" && fc[a.primary][d] >= th) out.forecastPrimary.push({ day: d, id: a.primary, p: fc[a.primary][d] });
  }
  return out;
}
// suAgeDays(isoTimestamp, nowMs) -> whole days since the timestamp, or null when unparseable.
function suAgeDays(ts, nowMs) {
  if (!ts) return null;
  const t = new Date(ts).getTime();
  if (isNaN(t)) return null;
  return Math.floor(((nowMs || Date.now()) - t) / 86400000);
}
// suLastAssignedDay(schedule) -> the last day carrying any assignment (null when none).
function suLastAssignedDay(schedule) {
  const days = Object.keys(schedule || {}).filter(d => { const a = schedule[d]; return a && (a.primary || a.backup || a.externalCover); }).sort();
  return days.length ? days[days.length - 1] : null;
}
// suLastContiguousDay(schedule) -> the last day of the longest contiguous run
// of schedule ROWS (a day with both slots open, such as 10/15, still counts:
// it is a published row), or null when the map is empty. Ties go to the later
// run. This is the "last published day" the Generate presets start after:
// stray rows away from the main block (a one-off edit on an early day, the
// pre-assigned Thanksgiving unit weeks after the import) never move it, unlike
// suLastAssignedDay, which returns the last ASSIGNED day anywhere on file.
function suLastContiguousDay(schedule) {
  const days = Object.keys(schedule || {}).filter(suIsIso).sort();
  if (!days.length) return null;
  let bestEnd = days[0], bestLen = 1, runStart = 0;
  for (let i = 1; i <= days.length; i++) {
    if (i < days.length && suAddDays(days[i - 1], 1) === days[i]) continue;
    const len = i - runStart;
    if (len >= bestLen) { bestLen = len; bestEnd = days[i - 1]; }
    runStart = i;
  }
  return bestEnd;
}
// suFirstOpenSlotDay(schedule, today) -> the default Generate START (Faraz 9/22
// late, Prompt 12 AB: "first open slot from today - locks are never touched, so
// starting at the first gap is safe and catches the October opens and any
// 11/5-type hole in one run"). The earliest day d >= today (ISO, Central) such
// that either the saved schedule has a row for d with an OPEN role - primary
// null with no externalCover (an external cover stands in for the primary
// only, as dayHolder reads it), or backup null - or d has no row at all but
// lies INSIDE the saved span (first saved day .. last saved day: an 11/19-type
// gap between saved rows). Returns null when nothing is open on or after
// today; the caller then falls back to the day after suLastContiguousDay, as
// before AB. A day before today is never a candidate (item Q: a past slot is
// not OPEN, nobody can be paged for it), a day after the last saved row is
// not a candidate either (that is the fallback's job), and a held slot is
// never rewritten by the run that starts here (locks are seeded first). Pure;
// string dates via suAddDays, no Date-timezone arithmetic.
function suFirstOpenSlotDay(schedule, today) {
  const sched = schedule || {};
  const days = Object.keys(sched).filter(suIsIso).sort();
  if (!days.length || !suIsIso(today)) return null;
  const last = days[days.length - 1];
  let d = today > days[0] ? today : days[0];
  for (; d <= last; d = suAddDays(d, 1)) {
    const a = sched[d];
    if (!a) return d; // a missing day inside the saved span
    if (!dayHolder(a, "primary") || !dayHolder(a, "backup")) return d;
  }
  return null;
}
// suLaterAssignedRanges(schedule, afterDay) -> [{ start, end }] the assigned days
// strictly after afterDay, collapsed into ranges (the Generate panel names them
// so a pre-assigned unit beyond the published block stays visible).
function suLaterAssignedRanges(schedule, afterDay) {
  const days = Object.keys(schedule || {}).filter(d => {
    if (!suIsIso(d) || (afterDay && d <= afterDay)) return false;
    const a = schedule[d];
    return !!(a && (a.primary || a.backup || a.externalCover));
  });
  return suCollapseDates(days);
}
// suLockedSlotChanges(current, next) -> the primary/backup changes (diffScheduleDays
// shape) that land on a slot LOCKED in the current map. Accept & Publish must
// confirm before writing any of these: they are published, locked days.
function suLockedSlotChanges(current, next) {
  const cur = current || {};
  return diffScheduleDays(cur, next).filter(c => {
    if (c.role !== "primary" && c.role !== "backup") return false;
    const a = cur[c.day];
    if (!a) return false;
    return c.role === "primary" ? !!(a.primaryLocked && (a.primary || a.externalCover)) : !!(a.backupLocked && a.backup);
  });
}
// suSetupIssues(input) -> [warning strings]. Pure; the Setup issues card renders them.
//   input: { roster, surgeonRules, groupRules, holidays, schedule, eastFeedRows, eastForecastRows, today }
function suSetupIssues(input) {
  const i = input || {};
  const out = [];
  const roster = Array.isArray(i.roster) ? i.roster : [];
  const today = suIsIso(i.today) ? i.today : fmt(new Date());
  const ids = {}, codes = {};
  roster.forEach(r => {
    if (!r) return;
    if (r.id) ids[r.id] = (ids[r.id] || 0) + 1;
    const c = String(r.code || "").toUpperCase();
    if (c) codes[c] = (codes[c] || 0) + 1;
    if (!r.id || !r.name || !r.code) out.push("Roster entry " + (r.id || "(no id)") + " is missing an id, last name or code");
  });
  Object.keys(ids).forEach(k => { if (ids[k] > 1) out.push("Roster id " + k + " is used " + ids[k] + " times"); });
  Object.keys(codes).forEach(k => { if (codes[k] > 1) out.push("Roster code " + k + " is used " + codes[k] + " times"); });
  if (i.surgeonRules === undefined || i.groupRules === undefined || i.holidays === undefined) out.push("Rules not imported yet (Setup > Import seed)");
  else {
    // an outside surgeon (type "external", Prompt 12 M) has no rules by design: never in the pool, written in by hand
    roster.forEach(r => { if (r && r.id && r.active !== false && r.type !== "external" && !(i.surgeonRules && i.surgeonRules[r.id])) out.push("No rules for " + (r.name || r.id) + " (" + r.id + ") - every active surgeon needs a surgeonRules entry"); });
  }
  const sched = i.schedule || {};
  const days = Object.keys(sched).sort();
  if (!days.length) out.push("No schedule days yet");
  else {
    const years = new Set(days.map(d => d.slice(0, 4)));
    const units = (i.holidays && i.holidays.units) || {};
    years.forEach(y => { if (!(units[y] && units[y].length)) out.push("No holiday units for " + y + " although the schedule has days in " + y); });
  }
  const feedAges = (i.eastFeedRows || []).map(r => suAgeDays(r.fetched_at, i.nowMs)).filter(a => a !== null);
  if (!(i.eastFeedRows || []).length) out.push("East feed cache is empty - refresh it in Setup > East feed");
  else if (feedAges.length && Math.min.apply(null, feedAges) > 14) out.push("East feed coverage is " + Math.min.apply(null, feedAges) + " days old - refresh it");
  const fcAges = (i.eastForecastRows || []).map(r => suAgeDays(r.generated_at || (r.data && r.data.generatedAt), i.nowMs)).filter(a => a !== null);
  if ((i.eastForecastRows || []).length && fcAges.length && Math.min.apply(null, fcAges) > 7) out.push("East forecast is " + Math.min.apply(null, fcAges) + " days old - rerun scripts/east-forecast.js");
  const openP = suOpenPrimaryDays(sched, today, 60);
  if (openP.length) out.push(openP.length + " open primary day(s) in the next 60 days (first " + fmtMD(openP[0]) + ")");
  return out;
}
// suMergePreview(current, preview, respectLocks) -> the schedule map with the
// generator's preview days applied. With respectLocks a slot that is locked in
// the current map keeps its holder (the generator seeds locks itself; this is
// the belt to its braces). Days outside the preview are untouched.
function suMergePreview(current, preview, respectLocks) {
  const next = Object.assign({}, current || {});
  Object.keys(preview || {}).forEach(day => {
    const p = preview[day] || emptyDayAssignment();
    const cur = next[day] || emptyDayAssignment();
    const a = Object.assign(emptyDayAssignment(), p);
    if (respectLocks && cur.primaryLocked && (cur.primary || cur.externalCover)) { a.primary = cur.primary; a.externalCover = cur.externalCover; a.primaryLocked = true; }
    if (respectLocks && cur.backupLocked && cur.backup) { a.backup = cur.backup; a.backupLocked = true; }
    if (a.primary && a.primary === a.backup) a.backup = cur.backup === a.primary ? null : cur.backup;
    next[day] = a;
  });
  return next;
}
// suSeedDayMerge(current, planRows, liveRows) -> { next, inserted, updated, skipped, changedDays }
// Seed rows land only on days that are missing everywhere, or whose LIVE row
// is still seed-owned (source "import" AND updated_by "seed") and whose
// in-memory day still equals that live row. Any other day - edited in the app
// (another source or updated_by), or carrying an unsaved local change such as
// a generated backup on a locked import day - is never overwritten. Mirrors
// the importer's SQL ownership rule (importer.js header) on the client.
function suSeedDayMerge(current, planRows, liveRows) {
  const next = Object.assign({}, current || {});
  const live = {};
  (liveRows || []).forEach(r => { if (r && r.day) live[String(r.day).slice(0, 10)] = r; });
  let inserted = 0, updated = 0, skipped = 0;
  const changedDays = [];
  (planRows || []).forEach(r => {
    if (!r || !suIsIso(r.day)) return;
    const cur = next[r.day];
    const lv = live[r.day] || null;
    const a = dayRowToAssignment(r);
    if (!cur && !lv) { next[r.day] = a; inserted++; changedDays.push(r.day); return; }
    const seedOwned = !!lv && lv.source === "import" && (lv.updated_by || "") === "seed";
    const localClean = !!lv && sameDayAssignment(r.day, cur, dayRowToAssignment(lv));
    if (!seedOwned || !localClean || (cur && cur.source !== "import")) { skipped++; return; }
    if (sameDayAssignment(r.day, cur, a)) return;
    next[r.day] = a; updated++; changedDays.push(r.day);
  });
  return { next: next, inserted: inserted, updated: updated, skipped: skipped, changedDays: changedDays };
}
function suAvailKey(r) { return [r.person_id, r.kind, r.role || "any", String(r.start_date).slice(0, 10), String(r.end_date).slice(0, 10), r.source || ""].join("|"); }
function suMissingAvailability(planRows, liveRows) {
  const have = new Set((liveRows || []).map(suAvailKey));
  return (planRows || []).filter(r => !have.has(suAvailKey(r)));
}
function suTimeOffKey(r) { return [r.person_id, String(r.start_date).slice(0, 10), String(r.end_date).slice(0, 10)].join("|"); }
function suMissingTimeOff(planRows, liveRows) {
  const have = new Set((liveRows || []).map(suTimeOffKey));
  return (planRows || []).filter(r => !have.has(suTimeOffKey(r)));
}
// suFmtTs(iso) -> "Sep 22, 2:14 PM" style label (never throws).
function suFmtTs(iso) {
  if (!iso) return "never";
  try { const d = new Date(iso); if (isNaN(d.getTime())) return String(iso); return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  catch (e) { console.warn("suFmtTs: could not format", iso, e); return String(iso); }
}

// Node entry point for test/data-layer.test.js. A no-op in the browser.
/* === TOTALS (Prompt 6 Slice F) - pure tally helpers ===
   One 24-h day = one shift; nothing weighted or split; counts only (no $).
   tt-prefixed so nothing collides with rules.js / generator.js globals.
   ttTotalsFor(schedule, surgeonId, from, to, opts) ->
     { primary, backup, total, weekendDays, majorHolidays, minorHolidays, maxConsecutive, holidayUnits: [names] }
   - a day counts when schedule[day].primary === surgeonId or .backup === surgeonId;
     an externally covered day (externalCover set, primary null) is nobody's day;
   - weekendDays: held days whose weekday is in opts.weekendDays (default Fri/Sat/Sun);
   - holiday units: opts.holidayByDay { 'YYYY-MM-DD': { name, tier, days } } (the
     rules ctx map); a unit counts ONCE per call when the surgeon holds any of
     its days inside [from, to], as major or minor by unit.tier;
   - maxConsecutive: the longest run of consecutive PRIMARY days that touches
     [from, to], followed across the range edges (a run starting 10/30 and ending
     11/2 reads 4 in October AND in November); pass opts.countBackup to count
     backup days in that run too (groupRules.countBackupInConsecutive);
   - maxConsecutiveAnyRole: the same for days held in EITHER role (the soft
     limit's measure - Prompt 12 A, 9/22).
     Both are REAL day counts. Days of one holiday unit collapse to one day only
     when opts.unitCollapse is true - the caller passes THIS surgeon's
     surgeonRules.<id>.holidayUnitCountsAsOneDay === true (Khan); the old
     opts.unitExempt (default true) is gone. */
var TT_WEEKEND_DEFAULT = ["Fri", "Sat", "Sun"];
var TT_DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function ttIsIso(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function ttAdd(iso, n) { return fmt(addD(parse(iso), n)); }
function ttDow(iso) { return TT_DOW[parse(iso).getDay()]; }
function ttHolds(schedule, day, id, role) {
  var e = schedule ? schedule[day] : null;
  if (!e || !id) return false;
  if (role === "primary") return e.primary === id;
  if (role === "backup") return e.backup === id;
  return e.primary === id || e.backup === id;
}
function ttUnitKey(u) { return u ? (u.name || "?") + ":" + ((u.days && u.days[0]) || "") : ""; }
// The run of counted days through `day` (inclusive), walked both ways; returns
// the number of days (one holiday unit = one day only when opts.unitCollapse)
// or 0 when day is not counted. Counted = primary (plus backup when
// opts.countBackup), or either role when opts.anyRole.
function ttRunThrough(schedule, id, day, opts) {
  var o = opts || {};
  var byDay = o.holidayByDay || {};
  var counts = o.anyRole
    ? function (d) { return ttHolds(schedule, d, id, "any"); }
    : function (d) { return ttHolds(schedule, d, id, "primary") || (o.countBackup && ttHolds(schedule, d, id, "backup")); };
  if (!counts(day)) return 0;
  var keyOf = function (d) { var u = o.unitCollapse ? byDay[d] : null; return u ? "H:" + ttUnitKey(u) : d; };
  var keys = {}; keys[keyOf(day)] = true;
  var n = 1, d, guard;
  for (d = ttAdd(day, -1), guard = 0; guard < 400 && counts(d); d = ttAdd(d, -1), guard++) { var k1 = keyOf(d); if (!keys[k1]) { keys[k1] = true; n++; } }
  for (d = ttAdd(day, 1), guard = 0; guard < 400 && counts(d); d = ttAdd(d, 1), guard++) { var k2 = keyOf(d); if (!keys[k2]) { keys[k2] = true; n++; } }
  return n;
}
function ttTotalsFor(schedule, surgeonId, from, to, opts) {
  var o = opts || {};
  var weekend = o.weekendDays || TT_WEEKEND_DEFAULT;
  var byDay = o.holidayByDay || {};
  var t = { primary: 0, backup: 0, total: 0, weekendDays: 0, majorHolidays: 0, minorHolidays: 0, maxConsecutive: 0, maxConsecutiveAnyRole: 0, holidayUnits: [] };
  if (!schedule || !surgeonId || !ttIsIso(from) || !ttIsIso(to) || to < from) return t;
  var seenUnits = {};
  var oP = Object.assign({}, o, { anyRole: false }), oA = Object.assign({}, o, { anyRole: true });
  var lastCounted = null, lastAny = null; // skip the run walk for days already inside a measured run
  for (var d = from; d <= to; d = ttAdd(d, 1)) {
    var isP = ttHolds(schedule, d, surgeonId, "primary"), isB = ttHolds(schedule, d, surgeonId, "backup");
    if (isP) t.primary++;
    if (isB) t.backup++;
    if (isP || isB) {
      t.total++;
      if (weekend.indexOf(ttDow(d)) >= 0) t.weekendDays++;
      var u = byDay[d];
      if (u) { var uk = ttUnitKey(u); if (!seenUnits[uk]) { seenUnits[uk] = true; t.holidayUnits.push(u.name || "?"); if (u.tier === "minor") t.minorHolidays++; else t.majorHolidays++; } }
    }
    var inRun = isP || (o.countBackup && isB);
    if (inRun && lastCounted !== ttAdd(d, -1)) { var n = ttRunThrough(schedule, surgeonId, d, oP); if (n > t.maxConsecutive) t.maxConsecutive = n; }
    if (inRun) lastCounted = d;
    if ((isP || isB) && lastAny !== ttAdd(d, -1)) { var na = ttRunThrough(schedule, surgeonId, d, oA); if (na > t.maxConsecutiveAnyRole) t.maxConsecutiveAnyRole = na; }
    if (isP || isB) lastAny = d;
  }
  return t;
}
// Distinct days in [from, to] found in a Set/array/object of date strings (East days for a cap that counts them).
function ttDaysIn(days, from, to) {
  if (!days || !ttIsIso(from) || !ttIsIso(to)) return 0;
  var list = days instanceof Set ? Array.from(days) : Array.isArray(days) ? days : Object.keys(days);
  var n = 0, seen = {};
  list.forEach(function (d) { if (ttIsIso(d) && d >= from && d <= to && !seen[d]) { seen[d] = true; n++; } });
  return n;
}
// ttRangeFor(mode, year, month0, opts) -> { from, to, label, months }
//   mode "month"   -> that calendar month
//   mode "ytd"     -> Jan 1 (or opts.floors[year], e.g. 2026 -> "2026-09-14") .. end of that month
//   mode "rolling" -> the 12 calendar months ending in that month
function ttRangeFor(mode, year, month0, opts) {
  var o = opts || {};
  var y = Number(year), m = Number(month0);
  var monthStart = function (yy, mm) { return fmt(new Date(yy, mm, 1)); };
  var monthEnd = function (yy, mm) { return fmt(new Date(yy, mm + 1, 0)); };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var to = monthEnd(y, m), from, label;
  if (mode === "ytd") {
    from = monthStart(y, 0);
    var floor = o.floors && o.floors[String(y)];
    if (ttIsIso(floor) && floor > from) from = floor;
    if (from > to) from = monthStart(y, m);
    label = "Year to date " + y + " (" + fmtMD(from) + " - " + fmtMD(to) + ")";
  } else if (mode === "rolling") {
    var start = new Date(y, m - 11, 1);
    from = fmt(start);
    label = "Rolling 12 months (" + MON[start.getMonth()] + " " + start.getFullYear() + " - " + MON[m] + " " + y + ")";
  } else {
    from = monthStart(y, m);
    label = MON[m] + " " + y;
  }
  var months = [];
  for (var c = parse(from); fmt(c) <= to; c = new Date(c.getFullYear(), c.getMonth() + 1, 1)) months.push(c.getFullYear() + "-" + String(c.getMonth() + 1).padStart(2, "0"));
  return { from: from, to: to, label: label, months: months };
}
// Signed deviation text: "+2", "-1", "0", or "-" without a target.
function ttDeviation(total, target) {
  if (typeof target !== "number" || isNaN(target)) return "-";
  var d = Number(total || 0) - target;
  return d > 0 ? "+" + d : String(d);
}
// ttOutsideSurgeons(roster, schedule, from, to, opts) -> [{ id, name, code, active, primary, backup, total }]
// The Totals view's "Outside surgeons" section (Prompt 12 M, 9/22): every roster
// entry of type "external" that is active, plus an inactive one that still holds
// a day inside [from, to]; counts from ttTotalsFor (one day = one shift, the same
// opts). Pool surgeons never appear; an externalCover day is nobody's day here
// too. Roster order. An empty list without externals, on a bad range or without
// a roster (never throws).
function ttOutsideSurgeons(roster, schedule, from, to, opts) {
  var out = [];
  if (!Array.isArray(roster) || !ttIsIso(from) || !ttIsIso(to) || to < from) return out;
  roster.forEach(function (r) {
    if (!r || !r.id || r.type !== "external") return;
    var t = ttTotalsFor(schedule || {}, r.id, from, to, opts);
    var active = r.active !== false;
    if (!active && t.total === 0) return;
    out.push({ id: r.id, name: r.name || r.id, code: r.code || "", active: active, primary: t.primary, backup: t.backup, total: t.total });
  });
  return out;
}
// CSV text (RFC 4180 quoting) from a header array and row arrays. CRLF lines.
function ttCsvText(headers, rows) {
  var cell = function (v) {
    var s = v === null || v === undefined ? "" : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  var lines = [headers.map(cell).join(",")];
  (rows || []).forEach(function (r) { lines.push(r.map(cell).join(",")); });
  return lines.join("\r\n") + "\r\n";
}

/* === NOTIFICATION MESSAGE COMPOSERS (Prompt 6 Slice G) ===
   The send-notification function renders data.message verbatim inside a
   per-category frame and REJECTS a payload without it; the same strings feed
   the in-app feed. Trade wording lives in tradeProposeMsg / tradeAcceptMsg /
   tradeDeclineMsg above (day + role legs via slotLabel). */
function tradeAppliedMsg(req) {
  return "Trade applied to the schedule: " + tradeLegsText(req, "takes");
}
function tradeCancelMsg(req) {
  return (req.from_surgeon_name || req.from_surgeon_id) + " cancelled the trade: " + tradeLegsText(req, "would have taken");
}
// "<Name> logged vacation 11/3-11/5" (one date when start === end); the note is operational and optional.
function vacationLoggedMsg(name, start, end, note) {
  var span = start === end || !end ? fmtMD(start) : fmtMD(start) + "-" + fmtMD(end);
  return name + " logged vacation " + span + (note ? " (" + String(note).trim() + ")" : "");
}
// "10/12 P Philip -> Fierce (by Khan)" - change lines from formatDayChange, one per line.
function manualEditMsg(lines, byName) {
  var list = (lines || []).filter(Boolean);
  var body = list.length ? list.join("\n") : "schedule changed";
  return byName ? body + " (by " + byName + ")" : body;
}
// Publish notice: the period plus the change lines (capped, with a count of the rest).
function schedulePublishedMsg(period, lines, maxLines) {
  var cap = typeof maxLines === "number" ? maxLines : 40;
  var list = (lines || []).filter(Boolean);
  var head = period ? "Call schedule " + period + " was published." : "The call schedule was published.";
  if (!list.length) return head + " No slot changes since the last notice.";
  var shown = list.slice(0, cap);
  var more = list.length - shown.length;
  return head + "\nChanges (" + list.length + "):\n" + shown.join("\n") + (more > 0 ? "\n... and " + more + " more" : "");
}

/* === HOLIDAY UNIT BUILDER (Prompt 12 U, Faraz 9/22 evening) ===
   defaultHolidayUnits(year, opts) -> the six holiday units of `year` in the
   seed's shape and order: [{ name, tier, days[, note] }] for Memorial Day,
   July 4th, Labor Day, Thanksgiving, Christmas, New Year's. Memorial Day =
   last Monday of May, Labor Day = first Monday of September, July 4th = the
   OBSERVED day (Prompt 12 AC, Faraz 9/22 late: a Sunday July 4 is observed
   Monday 07-05, a Saturday July 4 is observed Friday 07-03, otherwise 07-04),
   Thanksgiving = fourth Thursday of November through the Sunday after (four
   days, Thu-Sun, every year - Prompt 12 AC; under U it was the Thursday
   alone), Christmas = 12-24 + 12-25, New Year's = 12-31 + 01-01 of the next
   year, keyed under the eve's year like the seed. opts.tiers is the seed's
   holidays.rules.tiers shape ({ major: [names], minor: [names] }); a name in
   neither list keeps the standard tier. opts.mondayMinorAbsorbsWeekend ===
   true (the seed's groupRules.holidays flag): a MINOR holiday whose (observed)
   day is a Monday becomes [Sat, Sun, Mon] - "the unit is Sat-Mon; the Friday
   stays a standalone weekend day (the reduced weekend unit)"; any other day
   stays a single day. So July 4 on a Monday (2033) absorbs, on a Sunday
   (2027, 2032) the observed Monday absorbs (Sat 7/3 - Mon 7/5), on a Tuesday
   (2028) it is alone, and on a Saturday (2037) the observed Friday is alone:
   the rule speaks of the weekend BEFORE a Monday, and no decision covers a
   Friday-observed holiday (the open point in the seed's dayMembershipNote).
   Setup's Add year pre-fills a new year from this; the stored days remain
   authoritative and editable, and the engine reads only stored days (the
   seed's 2026 July 4th stays 07-04 as built). Pure, generic (no surgeon or
   year branches): local-midnight Date arithmetic through parse/fmt/addD
   above, never new Date("YYYY-MM-DD") (UTC parsing, which shifts a day west
   of Greenwich). */
var HU_ORDER = ["Memorial Day", "July 4th", "Labor Day", "Thanksgiving", "Christmas", "New Year's"];
var HU_STANDARD_TIER = { "Memorial Day": "minor", "July 4th": "minor", "Labor Day": "minor", "Thanksgiving": "major", "Christmas": "major", "New Year's": "major" };
// The nth weekday (0 = Sun .. 6 = Sat) of month (1-12) as "YYYY-MM-DD":
// nth >= 1 counts from the first of the month, nth = -1 is the last one.
function huNthWeekday(year, month, weekday, nth) {
  if (nth > 0) {
    var first = new Date(year, month - 1, 1);
    return fmt(addD(first, (weekday - first.getDay() + 7) % 7 + (nth - 1) * 7));
  }
  var last = new Date(year, month, 0);                    // day 0 of the next month = the last day of this one
  return fmt(addD(last, -((last.getDay() - weekday + 7) % 7)));
}
function defaultHolidayUnits(year, opts) {
  var y = typeof year === "string" && /^\d{4}$/.test(year) ? Number(year) : year;
  if (typeof y !== "number" || !isFinite(y) || Math.floor(y) !== y || y < 1000 || y > 9998) throw new Error("defaultHolidayUnits: year must be a 4-digit year, got " + JSON.stringify(year));
  opts = opts || {};
  var absorb = opts.mondayMinorAbsorbsWeekend === true;
  var tierOf = {};
  Object.keys(HU_STANDARD_TIER).forEach(function (n) { tierOf[n] = HU_STANDARD_TIER[n]; });
  if (opts.tiers && typeof opts.tiers === "object") {
    ["major", "minor"].forEach(function (t) { (Array.isArray(opts.tiers[t]) ? opts.tiers[t] : []).forEach(function (n) { tierOf[n] = t; }); });
  }
  var ys = String(y), ns = String(y + 1);
  // July 4th on its observed day: Sunday -> the Monday after, Saturday -> the Friday before (Prompt 12 AC).
  var fourth = parse(ys + "-07-04");
  var observedFourth = fourth.getDay() === 0 ? fmt(addD(fourth, 1)) : fourth.getDay() === 6 ? fmt(addD(fourth, -1)) : ys + "-07-04";
  var single = {
    "Memorial Day": huNthWeekday(y, 5, 1, -1),
    "July 4th": observedFourth,
    "Labor Day": huNthWeekday(y, 9, 1, 1)
  };
  var thanksgiving = parse(huNthWeekday(y, 11, 4, 4));
  return HU_ORDER.map(function (name) {
    var tier = tierOf[name], days, note = null;
    if (name === "Christmas") { days = [ys + "-12-24", ys + "-12-25"]; note = "Eve + Day as one unit"; }
    else if (name === "New Year's") { days = [ys + "-12-31", ns + "-01-01"]; note = "Eve + Day as one unit"; }
    else if (name === "Thanksgiving") { days = [0, 1, 2, 3].map(function (i) { return fmt(addD(thanksgiving, i)); }); } // Thu-Sun (Prompt 12 AC)
    else {
      var d = single[name], dt = parse(d);
      days = absorb && tier === "minor" && dt.getDay() === 1 ? [fmt(addD(dt, -2)), fmt(addD(dt, -1)), d] : [d];
    }
    var unit = { name: name, tier: tier, days: days };
    if (note) unit.note = note;
    return unit;
  });
}

/* === YEARLY HOLIDAY PLAN (Prompt 25, Faraz 9/30: "copy Davenport's split of major and minor holidays"; "the generator
   makes most of the decisions") ===
   planHolidays(year, { units, roster, surgeonRules, groupRules, history, east, vacations, seed }) decides ONE primary and
   ONE backup for every holiday unit of `year`, the whole year at once. Pure: no clock, no network, no writes; nothing
   here locks or publishes (Setup > Holidays shows the plan and only the scheduler's Accept locks it - steps 3-5, the
   block after this function).
   Inputs:
     units        the year's units [{ name, tier, days }] (call_schedule_data.data.holidays.units[year]); or pass
                  `holidays` (the blob shape) and the year's list is read from it
     roster       pool = every ACTIVE roster entry that is not type "external" (Sarkar included: "in for all rotations";
                  poolMember is a TARGET flag - generator.js - and is not read here)
     surgeonRules holidayRules.holidaysOff (+ neverThanksgiving), holidayRules.maxMajorHolidays (or the old
                  preferences.maxMajorHolidays), backupOptOut, eastFeed (enabled / eastBlocksPrimary / eastBlocksBackup /
                  deriveFrom), eastStanding
     groupRules   holidayPlan (holidayPlanRules below; HOLIDAY_PLAN_DEFAULTS = the seed block), eastFeed.forecast.busyThreshold
                  (default 0.5, as rules.js), dayBeforeRules.trailingEdgeRoles (default ['primary'], as rules.js)
     history      [{ year, name, tier?, days?, primary: id | [ids], backup: id | [ids] }] - holidayPlanHistory() builds it
                  from the schedule + groupRules.holidayPlan.history; without `history`, pass `schedule` + `holidays` and
                  it is built here. Entries of `year` itself are ignored (the year being planned is never its own history -
                  Davenport skips it too); only earlier years feed the rates; every other year feeds the 12-month window;
                  the year before AND the year after (when on file - re-planning a year) feed rule 4.
     east         the app's ctxInputs names: { eastBusyDays, eastForecast, eastOverrides, eastDerived, eastFeedCoverage }
                  + eastClear { id: days } - the 'home' East vacation days (holidayPlanInputs), where the forecast is not
                  consulted (rules.js); a feed busy day, an override true and eastStanding still refuse there
     vacations    time_off rows [{ person_id, start_date, end_date }] (a caller may append East vacation ranges as rows)
     seed         the RNG seed of the last tie-break (default: the year)
   Rule 1 - to the PLANNER a plan assignment counts as the surgeon's own availability for those days: windows,
     weekday patterns, dated lists, offers, caps and run limits are not consulted. (Once accepted, rules.js and the
     generator read the rows as ordinary locks, not as availability: Generate lists the waived ones as lockViolations
     and keeps them; a trade of a plan unit still faces those rules - rules doc section 5.) What still refuses (rules.js
     vocabulary): inactive, holiday-opt-out:<name> (both roles), backup-opt-out, time-off:<day> and day-before-vacation
     (trailing-edge roles), east-busy (feed day / override true / eastStanding) and east-forecast-busy:<p> (outside the
     published coverage, at or over the threshold, never on an override-false day) for the roles the surgeon's East
     feature blocks, max-major-holidays:<n> (fewer than 12 calendar months between unit START months, symmetric, history
     included - rules.js), and the derived East week: a unit on any day of a derived week takes the surgeon in that role
     (derived-lock:<role> for his other role, derived-lock-held:<id> for everyone else, as rules.js).
   Decisions, in order (lexicographic over complete plans; each later item only breaks ties of the earlier ones):
     hard  - rule 1's limits; primary != backup on a unit; the tier shape (rule 2): per tier, n = the surgeons who can
             hold at least one of its slots, each serves between floor(S/n) and ceil(S/n) of the tier's S = 2 x units
             slots and holds at most ceil(units/n) primaries - so with 6 everyone holds exactly one major and one minor,
             with fewer the extras are backups (a second primary would pass the cap), with more some sit out; and no
             same holiday in the same role as last year - or as next year, when it is on file (rule 4,
             groupRules.holidayPlan.noRepeatSameRole)
     1. open slots, then shape misses (only when no plan meets the shape - pass 3, listed in `relaxed`)
     2. repeats (only when no plan exists without one - pass 2, listed in `relaxed`)
     3. tier load: sum of served x lifetime LOAD (units held in either role / units eligible, per tier) - the extra
        slots go to the lowest load, the highest load sits out (rule 2)
     4. alternation (rule 3, groupRules.holidayPlan.alternateTiers): surgeons primary in both tiers, or backup-only in
        both, "where the pool allows"
     5. primary rate (rule 3): the sum of the tier primaries' lifetime PRIMARY rate (units held as primary / units
        eligible) - a tier's primaries go to the lowest rate
     6. tie: a different holiday than last year (holders who had the same unit last year, either role)
     7. tie: the longer unit to whoever had the shorter one last year (sum of last year's tier days x this year's)
     8. tie: the seeded RNG (uniform over the plans still tied)
   Copied from Davenport (davenport-ref index-source.html generateHolidayAssignments + config.js holidayRate): the two
   tiers as separate pools with distinct surgeons inside a tier, holidayRate(count, eligible) with zero eligible -> 0
   (never NaN), eligible = the recorded units of the tier dated within the surgeon's tenure (roster activeFrom /
   activeTo; a unit nobody recorded is out of the denominator), the stored years before the one being planned counted
   (Davenport skips the year it regenerates; a LATER year on file is left out of the rates here - it has not happened
   before the planned one - and feeds only the 12-month window and rule 4), a unit held in both roles counted once,
   the order lowest rate -> not last year's holiday -> random (seeded
   here). Not copied: FAK's Christmas lock (Silvis: holidaysOff data), presets, the A / B night-before coverage and the
   greedy one-holiday-at-a-time pick (this searches the whole year, so alternation and no-repeat hold where possible).
   -> { year, assignments: [{ unit: { name, tier, days }, primary, backup, why: [text], blocked: [{ id, role, reasons }] }],
        counts: { id: { name, before: { major|minor: { primary, any, eligible, primaryRate, load } }, lastYearDays,
        plan: { major|minor: { primary, backup } } } }, relaxed: [text], warnings: [text],
        search: { pass, tiedPlans, seed, leaves, truncated, cost } } */
var HOLIDAY_PLAN_DEFAULTS = { alternateTiers: true, noRepeatSameRole: true, history: [] }; // = docs/silvis-seed.json groupRules.holidayPlan
var HPL_TIERS = ["major", "minor"];
var HPL_EPS = 1e-12;
var HPL_MAX_LEAVES = 3000000;
// holidayPlanRules(groupRules) -> { alternateTiers, noRepeatSameRole, history } from groupRules.holidayPlan; an absent or
// non-boolean key reads as the default, a non-list history as [] (the GROUP_CALL_DEFAULTS pattern). Fresh copies.
function holidayPlanRules(groupRules) {
  var G = groupRules && typeof groupRules === "object" ? groupRules.holidayPlan : null;
  var g = G && typeof G === "object" && !Array.isArray(G) ? G : {};
  var bool = function (v, d) { return typeof v === "boolean" ? v : d; };
  return {
    alternateTiers: bool(g.alternateTiers, HOLIDAY_PLAN_DEFAULTS.alternateTiers),
    noRepeatSameRole: bool(g.noRepeatSameRole, HOLIDAY_PLAN_DEFAULTS.noRepeatSameRole),
    history: Array.isArray(g.history) ? g.history.slice() : []
  };
}
function hplRate(count, eligible) { return eligible > 0 ? count / eligible : 0; } // Davenport config.js holidayRate
function hplMonthIndex(iso) { return Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)); } // rules.js rdMonthIndex
function hplIds(v) {
  var list = Array.isArray(v) ? v : (v === null || v === undefined || v === "" ? [] : [v]), out = [];
  list.forEach(function (x) { if (typeof x === "string" && x && out.indexOf(x) < 0) out.push(x); });
  return out;
}
function hplDaySet(v) {
  var out = new Set();
  if (!v) return out;
  if (typeof v === "object" && !(v instanceof Set) && !Array.isArray(v) && v.busy) v = v.busy;
  if (v instanceof Set || Array.isArray(v)) v.forEach(function (d) { if (suIsIso(d)) out.add(d); });
  else if (typeof v === "object") Object.keys(v).forEach(function (d) { if (suIsIso(d) && v[d]) out.add(d); });
  return out;
}
function hplCmp(a, b) {
  for (var i = 0; i < a.length; i++) { var d = a[i] - b[i]; if (d > HPL_EPS) return 1; if (d < -HPL_EPS) return -1; }
  return 0;
}
// mulberry32 (generator.js genPrng's stream; strings hashed with FNV-1a)
function hplPrng(seed) {
  var a;
  if (typeof seed === "number" && isFinite(seed) && Math.floor(seed) === seed) a = seed >>> 0;
  else { var s = String(seed), h = 0x811c9dc5; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } a = h >>> 0; }
  if (a === 0) a = 0x9e3779b9;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hplNormUnit(u) {
  if (!u || typeof u !== "object" || typeof u.name !== "string" || !u.name || !Array.isArray(u.days)) return null;
  var days = [];
  u.days.forEach(function (d) { if (suIsIso(d) && days.indexOf(d) < 0) days.push(d); });
  if (!days.length) return null;
  days.sort();
  return { name: u.name, tier: u.tier === "minor" ? "minor" : "major", days: days }; // rules.js: tier || "major"
}
// The stored units of a year, else the builder's (Setup's Add year pre-fill) for a year the blob does not carry.
function hplUnitsOf(year, holidays, groupRules) {
  var hol = holidays && typeof holidays === "object" ? holidays : {};
  var stored = hol.units && typeof hol.units === "object" ? hol.units[String(year)] : null;
  if (Array.isArray(stored)) return stored;
  try {
    var gh = groupRules && groupRules.holidays && typeof groupRules.holidays === "object" ? groupRules.holidays : {};
    return defaultHolidayUnits(year, { tiers: hol.rules && hol.rules.tiers, mondayMinorAbsorbsWeekend: gh.mondayMinorAbsorbsWeekend === true });
  } catch (e) { return []; }
}
function hplFindUnit(year, name, holidays, groupRules) {
  var found = null;
  hplUnitsOf(year, holidays, groupRules).forEach(function (x) { var n = hplNormUnit(x); if (!found && n && n.name === name) found = n; });
  return found;
}
// holidayPlanHistory({ schedule, holidays, groupRules }) -> { entries: [{ year, name, tier, days, primary: [ids], backup:
// [ids], source: 'schedule' | 'list' }], warnings }. 'schedule': every stored unit (holidays.units, every year) whose days
// hold anyone in the schedule (in-memory shape; an external cover is 'ext:<label>'; split holders are all listed); a
// unit nobody holds is no history (Davenport: nothing stored = out of the denominator). 'list': groupRules.holidayPlan.history,
// the units before the app ([{ year, name, primary, backup }], roster ids), days from holidays.units or the builder; the
// schedule wins a (year, name) both carry, with a warning when they differ. Sorted by first day. Pure.
function holidayPlanHistory(opts) {
  var o = opts || {};
  var warnings = [], out = [], byKey = {};
  var sched = o.schedule && typeof o.schedule === "object" ? o.schedule : {};
  var hol = o.holidays && typeof o.holidays === "object" ? o.holidays : {};
  var byYear = hol.units && typeof hol.units === "object" ? hol.units : {};
  Object.keys(byYear).sort().forEach(function (yk) {
    if (!/^\d{4}$/.test(yk) || !Array.isArray(byYear[yk])) return;
    byYear[yk].forEach(function (raw) {
      var u = hplNormUnit(raw);
      if (!u || byKey[yk + "|" + u.name]) return;
      var P = [], B = [];
      u.days.forEach(function (d) {
        var p = dayHolder(sched[d], "primary"), b = dayHolder(sched[d], "backup");
        if (p && P.indexOf(p) < 0) P.push(p);
        if (b && B.indexOf(b) < 0) B.push(b);
      });
      if (!P.length && !B.length) return;
      var e = { year: Number(yk), name: u.name, tier: u.tier, days: u.days, primary: P, backup: B, source: "schedule" };
      byKey[yk + "|" + u.name] = e; out.push(e);
    });
  });
  holidayPlanRules(o.groupRules).history.forEach(function (h, i) {
    var y = h && typeof h === "object" ? Number(h.year) : NaN;
    var where = "groupRules.holidayPlan.history[" + i + "]";
    if (!Number.isInteger(y) || y < 1000 || y > 9998 || typeof h.name !== "string" || !h.name) { warnings.push(where + ": ignored - needs { year, name, primary, backup }"); return; }
    var u = hplFindUnit(y, h.name, hol, o.groupRules);
    if (!u) { warnings.push(where + ": ignored - " + h.name + " is not a holiday unit of " + y); return; }
    var P = hplIds(h.primary), B = hplIds(h.backup);
    if (!P.length && !B.length) { warnings.push(where + " (" + u.name + " " + y + "): ignored - names nobody"); return; }
    var prev = byKey[y + "|" + u.name];
    if (prev) {
      if (prev.primary.join(",") !== P.join(",") || prev.backup.join(",") !== B.join(",")) warnings.push(where + " (" + u.name + " " + y + ") differs from the schedule - the schedule wins");
      return;
    }
    var e = { year: y, name: u.name, tier: u.tier, days: u.days, primary: P, backup: B, source: "list" };
    byKey[y + "|" + u.name] = e; out.push(e);
  });
  out.sort(function (a, b) { return a.days[0] < b.days[0] ? -1 : a.days[0] > b.days[0] ? 1 : 0; });
  return { entries: out, warnings: warnings };
}
var HPL_ROLES = ["primary", "backup"];
function hplYear(year, fn) {
  var Y = typeof year === "string" && /^\d{4}$/.test(year) ? Number(year) : year;
  if (typeof Y !== "number" || !Number.isInteger(Y) || Y < 1000 || Y > 9998) throw new Error(fn + ": year must be a 4-digit year, got " + JSON.stringify(year));
  return Y;
}
// hplPrepare(Y, opts) - everything a plan is judged by, read once: the year's units, the pool, the history and the
// lifetime counts, every hard per-person limit (rule 1 + rule 5: block[ui][id][role] = the refusal reasons, the derived
// East week's forced holders) and the tier shape (rule 2). planHolidays searches over it; holidayPlanCheck /
// holidayPlanSwapOptions / holidayPlanRecheck judge a given plan by it - ONE refusal logic, never a second copy.
function hplPrepare(Y, o) {
  var warnings = [];
  var groupRules = o.groupRules && typeof o.groupRules === "object" ? o.groupRules : {};
  var surgeonRules = o.surgeonRules && typeof o.surgeonRules === "object" ? o.surgeonRules : {};
  var R = holidayPlanRules(groupRules);
  var ROLES = HPL_ROLES;
  var rulesOf = function (id) { var r = surgeonRules[id]; return r && typeof r === "object" ? r : {}; };

  // ---- the year's units
  var unitsIn = Array.isArray(o.units) ? o.units : (o.holidays && o.holidays.units && Array.isArray(o.holidays.units[String(Y)]) ? o.holidays.units[String(Y)] : null);
  if (!unitsIn) warnings.push("No holiday units for " + Y + " - nothing to plan (Setup > Holidays > Add year)");
  var units = [];
  (unitsIn || []).forEach(function (raw, i) {
    var u = hplNormUnit(raw);
    if (!u) { warnings.push("units[" + i + "]: ignored - needs { name, tier, days: ['YYYY-MM-DD'] }"); return; }
    if (units.some(function (x) { return x.name === u.name; })) { warnings.push("units[" + i + "]: ignored - a second " + u.name + " unit"); return; }
    units.push(u);
  });
  units.sort(function (a, b) { return a.days[0] < b.days[0] ? -1 : a.days[0] > b.days[0] ? 1 : 0; });

  // ---- the pool
  var rosterById = {}, pool = [], inPool = {};
  (Array.isArray(o.roster) ? o.roster : []).forEach(function (r) {
    if (!r || typeof r.id !== "string" || !r.id) return;
    rosterById[r.id] = r;
    if (r.active === false || r.type === "external" || inPool[r.id]) return;
    pool.push(r.id); inPool[r.id] = true;
  });
  var nameOf = function (id) { var r = rosterById[id]; return r && r.name ? r.name : id; };
  if (!pool.length) warnings.push("Nobody in the pool (no active roster surgeon) - every slot stays open");

  // ---- history (rule 6)
  var histIn;
  if (Array.isArray(o.history)) histIn = o.history;
  else { var hb = holidayPlanHistory({ schedule: o.schedule, holidays: o.holidays, groupRules: groupRules }); histIn = hb.entries; hb.warnings.forEach(function (w) { warnings.push(w); }); }
  var hist = [], strangers = [], seenHist = {};
  histIn.forEach(function (h, i) {
    var y = h && typeof h === "object" ? Number(h.year) : NaN;
    if (!Number.isInteger(y) || typeof h.name !== "string" || !h.name) { warnings.push("history[" + i + "]: ignored - needs { year, name, primary, backup }"); return; }
    if (y === Y) return;
    var found = hplFindUnit(y, h.name, o.holidays, groupRules);
    var u = hplNormUnit({ name: h.name, tier: h.tier, days: h.days }) || found;
    if (!u) { warnings.push("history[" + i + "]: ignored - " + h.name + " " + y + " has no days (not a holiday unit of " + y + ")"); return; }
    if (h.tier !== "minor" && h.tier !== "major") u.tier = found ? found.tier : (HU_STANDARD_TIER[h.name] || "major"); // own days, no tier: the unit's
    if (seenHist[y + "|" + u.name]) { warnings.push("history[" + i + "]: ignored - a second " + u.name + " " + y + " entry"); return; }
    seenHist[y + "|" + u.name] = true;
    var P = hplIds(h.primary), B = hplIds(h.backup);
    P.concat(B).forEach(function (id) { if (!rosterById[id] && id.indexOf("ext:") !== 0 && strangers.indexOf(id) < 0) strangers.push(id); });
    hist.push({ year: y, name: u.name, tier: h.tier === "minor" || h.tier === "major" ? h.tier : u.tier, days: u.days, primary: P, backup: B });
  });
  if (strangers.length) warnings.push("history names " + strangers.join(", ") + " - not on the roster, not counted");

  // ---- lifetime counts per tier and role (Davenport's holidayRate, tenure-normalized)
  var counts = {};
  pool.forEach(function (id) {
    counts[id] = { name: nameOf(id), before: {}, lastYearDays: { major: 0, minor: 0 }, plan: {} };
    HPL_TIERS.forEach(function (t) { counts[id].before[t] = { primary: 0, any: 0, eligible: 0, primaryRate: 0, load: 0 }; counts[id].plan[t] = { primary: 0, backup: 0 }; });
  });
  var lastByName = {}, nextByName = {};
  hist.forEach(function (e) {
    if (e.year === Y - 1) lastByName[e.name] = e;
    if (e.year === Y + 1) nextByName[e.name] = e;   // a later year on file: the no-repeat rule looks at it too (re-planning Y)
    if (e.year > Y) return;                          // ...but it has not happened before Y: never in the rates
    pool.forEach(function (id) {
      var r = rosterById[id], c = counts[id].before[e.tier], d0 = e.days[0];
      if ((!suIsIso(r.activeFrom) || d0 >= r.activeFrom) && (!suIsIso(r.activeTo) || d0 <= r.activeTo)) c.eligible++;
      var isP = e.primary.indexOf(id) >= 0, isB = e.backup.indexOf(id) >= 0;
      if (isP) c.primary++;
      if (isP || isB) c.any++;
      if (e.year === Y - 1 && (isP || isB)) counts[id].lastYearDays[e.tier] += e.days.length;
    });
  });
  pool.forEach(function (id) { HPL_TIERS.forEach(function (t) { var c = counts[id].before[t]; c.primaryRate = hplRate(c.primary, c.eligible); c.load = hplRate(c.any, c.eligible); }); });

  // ---- rule 1 / rule 5: the hard per-person limits
  var vac = {};
  (Array.isArray(o.vacations) ? o.vacations : []).forEach(function (row) {
    if (!row || !inPool[row.person_id] || !suIsIso(row.start_date)) return;
    var end = suIsIso(row.end_date) ? row.end_date : row.start_date, set = vac[row.person_id] || (vac[row.person_id] = new Set());
    for (var d = row.start_date, k = 0; d <= end && k < 800; d = suAddDays(d, 1), k++) set.add(d);
  });
  var trailing = groupRules.dayBeforeRules && Array.isArray(groupRules.dayBeforeRules.trailingEdgeRoles) ? groupRules.dayBeforeRules.trailingEdgeRoles : ["primary"];
  var east = o.east && typeof o.east === "object" ? o.east : {};
  var fcRules = groupRules.eastFeed && groupRules.eastFeed.forecast;
  var threshold = fcRules && typeof fcRules.busyThreshold === "number" ? fcRules.busyThreshold : 0.5;
  var cov = east.eastFeedCoverage && suIsIso(east.eastFeedCoverage.from) && suIsIso(east.eastFeedCoverage.to) ? east.eastFeedCoverage : null;
  var busy = {}, clear = {};
  pool.forEach(function (id) { busy[id] = hplDaySet(east.eastBusyDays && east.eastBusyDays[id]); clear[id] = hplDaySet(east.eastClear && east.eastClear[id]); });
  var standingOn = function (id, day) {
    var list = rulesOf(id).eastStanding, md = day.slice(5);
    return Array.isArray(list) && list.some(function (e) { return e && typeof e.name === "string" && e.name.trim() && Array.isArray(e.days) && e.days.indexOf(md) >= 0; });
  };
  var eastReason = function (id, day, role) {
    var ef = rulesOf(id).eastFeed || {};
    if (!ef.enabled || !(role === "primary" ? ef.eastBlocksPrimary : ef.eastBlocksBackup)) return null;
    if (standingOn(id, day)) return "east-busy";
    var ov = east.eastOverrides && east.eastOverrides[id] ? east.eastOverrides[id][day] : undefined;
    if (ov === true) return "east-busy";
    if (ov === false) return null;
    if (busy[id].has(day)) return "east-busy";
    if (clear[id].has(day)) return null;           // a 'home' East vacation day: the forecast is not consulted (rules.js fcApplies = !homeDay)
    if (cov && day >= cov.from && day <= cov.to) return null;
    var p = east.eastForecast && east.eastForecast[id] ? east.eastForecast[id][day] : undefined;
    return typeof p === "number" && p >= threshold ? "east-forecast-busy:" + p.toFixed(2) : null;
  };
  var off = {}, maxMajor = {}, histMajor = {};
  pool.forEach(function (id) {
    var r = rulesOf(id), hr = r.holidayRules && typeof r.holidayRules === "object" ? r.holidayRules : {};
    off[id] = Array.isArray(hr.holidaysOff) ? hr.holidaysOff.slice() : [];
    if (hr.neverThanksgiving && off[id].indexOf("Thanksgiving") < 0) off[id].push("Thanksgiving");
    maxMajor[id] = typeof hr.maxMajorHolidays === "number" ? hr.maxMajorHolidays : (r.preferences && typeof r.preferences.maxMajorHolidays === "number" ? r.preferences.maxMajorHolidays : null);
    histMajor[id] = [];
  });
  hist.forEach(function (e) { if (e.tier === "major") pool.forEach(function (id) { if (e.primary.indexOf(id) >= 0 || e.backup.indexOf(id) >= 0) histMajor[id].push(hplMonthIndex(e.days[0])); }); });
  var block = units.map(function (u) {
    var m = {};
    pool.forEach(function (id) {
      var r = rosterById[id], res = { primary: [], backup: [] };
      ROLES.forEach(function (role) {
        var push = function (why) { if (res[role].indexOf(why) < 0) res[role].push(why); };
        if ((suIsIso(r.activeFrom) && u.days[0] < r.activeFrom) || (suIsIso(r.activeTo) && u.days[u.days.length - 1] > r.activeTo)) push("inactive");
        if (off[id].indexOf(u.name) >= 0) push("holiday-opt-out:" + u.name);
        if (role === "backup" && rulesOf(id).backupOptOut === true) push("backup-opt-out");
        u.days.forEach(function (d) {
          var V = vac[id];
          if (V && V.has(d)) push("time-off:" + d);
          else if (V && trailing.indexOf(role) >= 0 && V.has(suAddDays(d, 1))) push("day-before-vacation");
          var er = eastReason(id, d, role);
          if (er) push(er);
        });
        if (u.tier === "major" && maxMajor[id] !== null) {
          var mi = hplMonthIndex(u.days[0]), n = 1;
          histMajor[id].forEach(function (x) { if (Math.abs(x - mi) < 12) n++; });
          if (n > maxMajor[id]) push("max-major-holidays:" + maxMajor[id]);
        }
      });
      m[id] = res;
    });
    return m;
  });
  // the derived East week (Fierce): a unit on any day of one takes him in that week's Silvis role (rules.js derived locks)
  var derived = {};
  (Array.isArray(east.eastDerived) ? east.eastDerived : []).forEach(function (w, i) {
    if (!w || typeof w.surgeonId !== "string" || !suIsIso(w.weekMonday) || (w.silvisRole !== "primary" && w.silvisRole !== "backup")) { warnings.push("east.eastDerived[" + i + "]: ignored - needs { surgeonId, weekMonday, silvisRole }"); return; }
    if (!inPool[w.surgeonId]) return;
    var from = (rulesOf(w.surgeonId).eastFeed || {}).deriveFrom, map = derived[w.surgeonId] || (derived[w.surgeonId] = {});
    for (var k = 0; k < 7; k++) { var d = suAddDays(w.weekMonday, k); if (suIsIso(from) && d < from) continue; map[d] = w.silvisRole; }
  });
  var forced = units.map(function () { return { primary: null, backup: null }; });
  units.forEach(function (u, ui) {
    pool.forEach(function (id) {
      var map = derived[id];
      if (!map) return;
      var roles = [];
      u.days.forEach(function (d) { if (map[d] && roles.indexOf(map[d]) < 0) roles.push(map[d]); });
      if (!roles.length) return;
      if (roles.length > 1) { warnings.push(nameOf(id) + "'s derived East weeks give him both roles on " + u.name + " " + Y + " - planned for primary only; check by hand"); roles = ["primary"]; }
      var role = roles[0];
      if (forced[ui][role] && forced[ui][role] !== id) { warnings.push(u.name + " " + Y + " " + role + ": derived East weeks name both " + nameOf(forced[ui][role]) + " and " + nameOf(id) + " - the first is kept"); return; }
      forced[ui][role] = id;
      var otherRole = role === "primary" ? "backup" : "primary";
      if (block[ui][id][otherRole].indexOf("derived-lock:" + role) < 0) block[ui][id][otherRole].push("derived-lock:" + role);
    });
    ROLES.forEach(function (role) {
      var f = forced[ui][role];
      if (!f) return;
      pool.forEach(function (id) { if (id !== f) block[ui][id][role].push("derived-lock-held:" + f); });
      if (block[ui][f][role].length) warnings.push("The derived East week makes " + nameOf(f) + " the " + u.name + " " + Y + " " + role + " but " + block[ui][f][role].join(", ") + " - nobody can hold that slot");
    });
  });
  var cand = units.map(function (u, ui) { var c = {}; ROLES.forEach(function (role) { c[role] = pool.filter(function (id) { return !block[ui][id][role].length; }); }); return c; });

  // ---- rule 2: the tier shape
  var tiers = {};
  HPL_TIERS.forEach(function (t) {
    var uis = [];
    units.forEach(function (u, ui) { if (u.tier === t) uis.push(ui); });
    var capable = pool.filter(function (id) { return uis.some(function (ui) { return cand[ui].primary.indexOf(id) >= 0 || cand[ui].backup.indexOf(id) >= 0; }); });
    var n = capable.length, S = 2 * uis.length;
    tiers[t] = { uis: uis, capable: capable, lo: n ? Math.floor(S / n) : 0, hi: n ? Math.ceil(S / n) : 0, pcap: n ? Math.ceil(uis.length / n) : 0 };
    if (uis.length) pool.forEach(function (id) {
      if (capable.indexOf(id) >= 0) return;
      warnings.push(nameOf(id) + " can hold no " + t + " holiday of " + Y + " (" + uis.map(function (ui) { var rs = block[ui][id].primary.concat(block[ui][id].backup).filter(function (x, k, a) { return a.indexOf(x) === k; }); return units[ui].name + ": " + rs.join(", "); }).join("; ") + ")");
    });
  });
  // rule 4: the years (Y - 1 and, when on file, Y + 1) in which he held this unit in this role - a repeat either way
  var repeatYears = function (ui, role, id) {
    var out = [], n = units[ui].name, a = lastByName[n], b = nextByName[n];
    if (a && a[role].indexOf(id) >= 0) out.push(Y - 1);
    if (b && b[role].indexOf(id) >= 0) out.push(Y + 1);
    return out;
  };
  var repeatOf = function (ui, role, id) { return repeatYears(ui, role, id).length > 0; };
  // "2026 and 2027", "2027 and 2028", "2026, 2027 and 2028" - the years of a repeat with the planned one
  var repeatText = function (ui, role, id) { var ys = repeatYears(ui, role, id).concat([Y]).sort(); return ys.length === 2 ? ys[0] + " and " + ys[1] : ys.slice(0, -1).join(", ") + " and " + ys[ys.length - 1]; };
  var heldLastYear = function (ui, id) { var e = lastByName[units[ui].name]; return !!(e && (e.primary.indexOf(id) >= 0 || e.backup.indexOf(id) >= 0)); };
  return {
    Y: Y, R: R, groupRules: groupRules, units: units, pool: pool, inPool: inPool, rosterById: rosterById, nameOf: nameOf,
    hist: hist, lastByName: lastByName, nextByName: nextByName, counts: counts, block: block, forced: forced, cand: cand, tiers: tiers,
    maxMajor: maxMajor, histMajor: histMajor, repeatOf: repeatOf, repeatYears: repeatYears, repeatText: repeatText, heldLastYear: heldLastYear, warnings: warnings
  };
}
function planHolidays(year, opts) {
  var Y = hplYear(year, "planHolidays");
  var o = opts || {};
  var P = hplPrepare(Y, o);
  var warnings = P.warnings, relaxed = [];
  var seed = o.seed === undefined || o.seed === null ? Y : o.seed;
  var ROLES = HPL_ROLES;
  var R = P.R, units = P.units, pool = P.pool, nameOf = P.nameOf, hist = P.hist, counts = P.counts, block = P.block, forced = P.forced;
  var cand = P.cand, tiers = P.tiers, maxMajor = P.maxMajor, histMajor = P.histMajor, repeatOf = P.repeatOf, heldLastYear = P.heldLastYear;

  // ---- the search: per tier every plan meeting the pass's hard rules, grouped by its per-surgeon (primaries, served)
  // signature (all alternation needs); only the groups with the tier's best open / shape / repeat / load prefix can be
  // part of the best year (those terms do not depend on the other tier), then every pair of groups is scored.
  function enumerate(t, pass) {
    var T = tiers[t], slots = [];
    T.uis.forEach(function (ui) { slots.push({ ui: ui, role: "primary" }, { ui: ui, role: "backup" }); });
    var shapeHard = pass < 3, allowOpen = pass === 3, repeatHard = pass === 1 && R.noRepeatSameRole;
    var groups = new Map(), leaves = 0, truncated = false;
    var assign = new Array(slots.length), served = {}, prim = {}, capableSet = {};
    pool.forEach(function (id) { served[id] = 0; prim[id] = 0; });
    T.capable.forEach(function (id) { capableSet[id] = true; });
    function majorOk(id) {
      if (t !== "major" || maxMajor[id] === null) return true;
      var mine = [];
      for (var k = 0; k < slots.length; k++) if (assign[k] === id) mine.push(hplMonthIndex(units[slots[k].ui].days[0]));
      return mine.every(function (m, i) {
        var n = 1;
        mine.forEach(function (x, j) { if (j !== i && Math.abs(x - m) < 12) n++; });
        histMajor[id].forEach(function (x) { if (Math.abs(x - m) < 12) n++; });
        return n <= maxMajor[id];
      });
    }
    function leaf() {
      var open = 0, shape = 0, rep = 0, c2 = 0, t1 = 0, days = {}, c3 = 0, t2 = 0, sig = [];
      for (var k = 0; k < slots.length; k++) {
        var id = assign[k], s = slots[k];
        if (!id) { open++; continue; }
        if (R.noRepeatSameRole && repeatOf(s.ui, s.role, id)) rep++;
        if (s.role === "primary") c2 += counts[id].before[t].primaryRate;
        if (heldLastYear(s.ui, id)) t1++;
        days[id] = (days[id] || 0) + units[s.ui].days.length;
      }
      pool.forEach(function (id) {
        c3 += served[id] * counts[id].before[t].load;
        if (!shapeHard && capableSet[id]) shape += Math.max(0, served[id] - T.hi) + Math.max(0, T.lo - served[id]) + Math.max(0, prim[id] - T.pcap);
        t2 += counts[id].lastYearDays[t] * (days[id] || 0);
        sig.push(prim[id] + "/" + served[id]);
      });
      var vec = [open, shape, rep, c3, c2, t1, t2], key = sig.join(","), g = groups.get(key);
      if (!g) groups.set(key, { prim: pool.map(function (id) { return prim[id]; }), served: pool.map(function (id) { return served[id]; }), vec: vec, leaves: [assign.slice()] });
      else { var c = hplCmp(vec, g.vec); if (c < 0) { g.vec = vec; g.leaves = [assign.slice()]; } else if (c === 0) g.leaves.push(assign.slice()); }
    }
    function dfs(k) {
      if (truncated) return;
      if (k === slots.length) {
        if (shapeHard && T.capable.some(function (id) { return served[id] < T.lo; })) return;
        if (++leaves > HPL_MAX_LEAVES) { truncated = true; return; }
        leaf();
        return;
      }
      if (shapeHard) { var need = 0; T.capable.forEach(function (id) { need += Math.max(0, T.lo - served[id]); }); if (need > slots.length - k) return; }
      var s = slots[k], list = cand[s.ui][s.role];
      for (var i = 0; i < list.length; i++) {
        var id = list[i];
        if (s.role === "backup" && assign[k - 1] === id) continue;                     // primary != backup on a unit
        if (shapeHard && (served[id] >= T.hi || (s.role === "primary" && prim[id] >= T.pcap))) continue;
        if (repeatHard && repeatOf(s.ui, s.role, id)) continue;
        assign[k] = id; served[id]++; if (s.role === "primary") prim[id]++;
        if (majorOk(id)) dfs(k + 1);
        served[id]--; if (s.role === "primary") prim[id]--; assign[k] = undefined;
      }
      if (allowOpen) { assign[k] = null; dfs(k + 1); assign[k] = undefined; }
    }
    dfs(0);
    var kept = [], bestPrefix = null;
    groups.forEach(function (g) {
      var p = g.vec.slice(0, 4), c = bestPrefix ? hplCmp(p, bestPrefix) : -1;
      if (c < 0) { bestPrefix = p; kept = [g]; } else if (c === 0) kept.push(g);
    });
    return { slots: slots, groups: kept, leaves: leaves, truncated: truncated };
  }
  var passes = R.noRepeatSameRole ? [1, 2, 3] : [1, 3];
  var used = null, pick = null, best = null, tiedPlans = 0, bestPair = null;
  for (var pi = 0; pi < passes.length && !pick; pi++) {
    var E = { major: enumerate("major", passes[pi]), minor: enumerate("minor", passes[pi]) };
    if (!E.major.groups.length || !E.minor.groups.length) continue;
    var tied = [];
    best = null;
    E.major.groups.forEach(function (gM) {
      E.minor.groups.forEach(function (gm) {
        var c1 = 0;
        if (R.alternateTiers) pool.forEach(function (id, k) {
          if (gM.prim[k] > 0 && gm.prim[k] > 0) c1++;
          else if (gM.served[k] > 0 && gm.served[k] > 0 && gM.prim[k] === 0 && gm.prim[k] === 0) c1++;
        });
        var v = [gM.vec[0] + gm.vec[0], gM.vec[1] + gm.vec[1], gM.vec[2] + gm.vec[2], gM.vec[3] + gm.vec[3], c1, gM.vec[4] + gm.vec[4], gM.vec[5] + gm.vec[5], gM.vec[6] + gm.vec[6]];
        var c = best ? hplCmp(v, best) : -1;
        if (c < 0) { best = v; tied = [[gM, gm]]; } else if (c === 0) tied.push([gM, gm]);
      });
    });
    tiedPlans = tied.reduce(function (s, p) { return s + p[0].leaves.length * p[1].leaves.length; }, 0);
    var at = Math.floor(hplPrng(seed)() * tiedPlans);
    for (var q = 0; q < tied.length && !pick; q++) {
      var size = tied[q][0].leaves.length * tied[q][1].leaves.length;
      if (at < size) { pick = { major: tied[q][0].leaves[Math.floor(at / tied[q][1].leaves.length)], minor: tied[q][1].leaves[at % tied[q][1].leaves.length] }; bestPair = tied[q]; }
      else at -= size;
    }
    used = { pass: passes[pi], E: E };
  }

  // ---- the result
  var assignments = units.map(function (u) { return { unit: { name: u.name, tier: u.tier, days: u.days.slice() }, primary: null, backup: null, why: [], blocked: [] }; });
  if (pick) HPL_TIERS.forEach(function (t) { used.E[t].slots.forEach(function (s, k) { assignments[s.ui][s.role] = pick[t][k] || null; }); });
  assignments.forEach(function (a) { ROLES.forEach(function (role) { if (a[role]) counts[a[role]].plan[a.unit.tier][role]++; }); });
  var lastText = function (id, t) {
    var parts = [];
    hist.forEach(function (e) { if (e.year !== Y - 1 || e.tier !== t) return; if (e.primary.indexOf(id) >= 0) parts.push(e.name + " primary"); if (e.backup.indexOf(id) >= 0) parts.push(e.name + " backup"); });
    return (Y - 1) + ": " + (parts.length ? parts.join(", ") : "no " + t + " holiday");
  };
  var otherTierText = function (id, t) {
    var o2 = t === "major" ? "minor" : "major", c = counts[id].plan[o2];
    return c.primary && c.backup ? "primary and backup in the " + o2 + " tier" : c.primary ? "primary in the " + o2 + " tier" : c.backup ? "backup in the " + o2 + " tier" : "no " + o2 + " holiday";
  };
  assignments.forEach(function (a, ui) {
    var t = a.unit.tier;
    ROLES.forEach(function (role) {
      pool.forEach(function (id) { if (block[ui][id][role].length) a.blocked.push({ id: id, role: role, reasons: block[ui][id][role].slice() }); });
      var id = a[role];
      if (!id) {
        a.why.push(role + " OPEN: nobody can hold it" + (cand[ui][role].length ? " within the plan's limits" : ""));
        warnings.push("OPEN: " + a.unit.name + " " + Y + " " + role + " - " + (cand[ui][role].length ? "no plan fills it within the limits" : "every surgeon is refused (" + pool.map(function (x) { return nameOf(x) + ": " + block[ui][x][role].join(", "); }).join("; ") + ")"));
        return;
      }
      var c = counts[id].before[t];
      var parts = [];
      if (forced[ui][role] === id) parts.push("derived East week (" + role + ")");
      parts.push(role === "primary" ? t + " primary rate " + c.primary + "/" + c.eligible : t + " load " + c.any + "/" + c.eligible);
      parts.push(otherTierText(id, t));
      parts.push(lastText(id, t));
      if (heldLastYear(ui, id)) parts.push("had " + a.unit.name + " in " + (Y - 1) + " too");
      if (R.noRepeatSameRole && repeatOf(ui, role, id)) { parts.push("same role as " + P.repeatYears(ui, role, id).join(" and ") + " (relaxed)"); relaxed.push("no-repeat: " + nameOf(id) + " " + role + " " + a.unit.name + " " + P.repeatText(ui, role, id) + " - no plan exists without it"); }
      a.why.push(role + " " + nameOf(id) + ": " + parts.join("; "));
    });
  });
  if (used && used.pass === 3) HPL_TIERS.forEach(function (t) {
    var T = tiers[t];
    T.capable.forEach(function (id) {
      var c = counts[id].plan[t], n = c.primary + c.backup;
      if (n < T.lo || n > T.hi || c.primary > T.pcap) relaxed.push("shape: " + nameOf(id) + " holds " + n + " " + t + " holiday" + (n === 1 ? "" : "s") + " (" + c.primary + " primary) - expected " + (T.lo === T.hi ? T.lo : T.lo + "-" + T.hi) + " with at most " + T.pcap + " primary; no plan meets the shape");
    });
  });
  if (best && best[4] > 0) {
    var both = pool.filter(function (id) { var M = counts[id].plan.major, m = counts[id].plan.minor; return (M.primary > 0 && m.primary > 0) || (M.primary + M.backup > 0 && m.primary + m.backup > 0 && M.primary === 0 && m.primary === 0); });
    warnings.push("Alternation not possible for " + both.map(nameOf).join(", ") + " (primary in one tier, backup in the other) - the pool and the limits leave no plan without it");
  }
  ["major", "minor"].forEach(function (t) { if (used && used.E[t].truncated) warnings.push("The " + t + " search stopped at " + HPL_MAX_LEAVES + " plans - the result is the best found, not proven best"); });
  return {
    year: Y, assignments: assignments, counts: counts, relaxed: relaxed, warnings: warnings,
    search: {
      pass: used ? used.pass : 0, tiedPlans: tiedPlans, seed: seed,
      leaves: used ? { major: used.E.major.leaves, minor: used.E.minor.leaves } : { major: 0, minor: 0 },
      truncated: !!(used && (used.E.major.truncated || used.E.minor.truncated)),
      cost: best ? { open: best[0], shape: best[1], repeats: best[2], load: best[3], alternation: best[4], primaryRate: best[5], sameHoliday: best[6], unitLength: best[7] } : null
    }
  };
}

/* === THE HOLIDAY PLAN IN THE APP (Prompt 25 steps 3-5, Faraz 9/30: "nothing is locked or published without the
   scheduler's Accept") ===
   Setup > Holidays > Plan <year> previews planHolidays on the app's live state; the scheduler may swap holders, then
   Accept locks the unit days (schedule_days, both roles locked, source 'holiday-plan-<year>') through the app's guarded
   day-write path. Re-check <year> lists the accepted slots a newer East feed, vacation or rule now refuses. Everything
   below is pure (no clock, network or writes) and judges a plan with hplPrepare - the planner's own refusal logic:
     holidayPlanInputs(year, state)      the planHolidays opts from the app's state (ctxInputs + timeOffRows)
     holidayPlanCheck(year, plan, opts)  which rules a plan breaks (+ its cost vector, the planner's ordering)
     holidayPlanSwapOptions(year, plan, unit, role, opts)
                                         every swap of that slot's holder with another slot's holder, and every
                                         replacement by another pool member, judged and ranked
     holidayPlanRecheck(year, opts)      the accepted slots (rows of source holiday-plan-<year>) the current state
                                         refuses, each with the best swap by the same ranking
     holidayPlanAcceptRows(year, plan, schedule, opts)
                                         the schedule_days assignments Accept writes, and the slots it would replace
     holidayPlanWrittenCheck(year, plan, acc, opts)
                                         the breaks of the year as Accept will ACTUALLY leave it when a started unit
                                         was skipped (its rows on file stay)
     holidayPlanConflictLines(conflicts, label)
                                         the confirm's replaced-slot lines, one per unit + role + holder change
     holidayPlanNoticeChanges(days, after, persisted, held) / holidayPlanHeldNotices(held, persisted, local)
                                         who the change notices go to - after an Accept that saves, and for the
                                         days a failed / conflicted Accept left held (the card's Send button)
   A plan is planHolidays' assignments shape ([{ unit: { name } | name, primary, backup }]) or { <unit name>: { primary,
   backup } }; a unit it does not name is open.
   Breaks (hard - Accept names them in an explicit confirm; a swap that adds one asks first):
     refused      rule 1 / rule 5 refusal reasons for that surgeon, slot and day (rules.js vocabulary: time-off:<day>,
                  day-before-vacation, east-busy, east-forecast-busy:<p>, holiday-opt-out:<name>, backup-opt-out,
                  max-major-holidays:<n>, derived-lock:<role>, derived-lock-held:<id>, inactive)
     not-in-pool  the holder is not an active roster surgeon
     max-major    two majors of the plan within 12 months for a surgeon with maxMajorHolidays (history included)
     no-repeat    the same holiday in the same role as last year, or as next year when it is on file
                  (groupRules.holidayPlan.noRepeatSameRole)
     shape        the tier shape (rule 2): served outside floor(S/n)..ceil(S/n) or more than ceil(units/n) primaries
   STRUCTURAL, never a confirmable break - same-person (one surgeon in both roles of a unit): sql/schema.sql CHECK
     schedule_days_distinct_roles refuses such a row, so a confirm could only start a write that never lands (the sync
     re-sends it forever while the other units land - a partial plan). holidayPlanCheck still names it (the card lists
     it), but hplOptions never offers a move that leaves it on a unit, holidayPlanAcceptRows skips such a unit
     (samePerson: true) and the app's acceptHolidayPlan stops BEFORE its confirm when one is found.
   Soft (listed, never confirmed): alternation - primary in both tiers or backup-only in both (rule 3). Open slots are
   listed apart (Accept leaves an open role as it is on file). */
function holidayPlanSource(year) { return "holiday-plan-" + hplYear(year, "holidayPlanSource"); }
// The schedule_days note of an accepted unit day: the unit and the plan only - no name, no reason (schedule_days is
// anon-readable; CLAUDE.md: notes in anon-readable tables carry no reasons).
function holidayPlanNote(unitName, year) { return String(unitName) + " unit - holiday plan " + hplYear(year, "holidayPlanNote"); }
// The year Plan opens on: the first year after today's with units in the blob, else the latest year with units, else
// next year.
function holidayPlanDefaultYear(holidays, today) {
  var units = holidays && holidays.units && typeof holidays.units === "object" ? holidays.units : {};
  var ty = suIsIso(today) ? Number(today.slice(0, 4)) : null;
  var years = Object.keys(units).filter(function (y) { return /^\d{4}$/.test(y) && Array.isArray(units[y]) && units[y].length; }).map(Number).sort(function (a, b) { return a - b; });
  for (var i = 0; i < years.length; i++) if (ty === null || years[i] > ty) return years[i];
  return years.length ? years[years.length - 1] : (ty === null ? null : ty + 1);
}
// The planHolidays opts from the app's state: ctxInputs (roster, surgeonRules, groupRules, holidays, schedule, the East
// pieces, eastVacationRanges + eastVacationReviews) and timeOffRows. vacations = the time_off rows PLUS each East
// surgeon's Davenport vacation ranges that are away or unreviewed (derivedEastVacations - what rules.js reads as a
// vacation; 'home' ranges are not); east.eastClear = { id: [days] } - the days of each surgeon's 'home' ranges that no
// away / unreviewed range of his covers (rules.js buildContext: an overlap goes to the vacation), where the planner
// does not consult the forecast (rules.js fcApplies = !homeDay; the feed, an override true and eastStanding still
// refuse - eastReason checks them first, as rules.js keeps a feed-busy day out of eastClear); history =
// holidayPlanHistory over the schedule + groupRules.holidayPlan.history (its warnings in historyWarnings - planHolidays
// does not repeat them when history is passed); seed = the year.
function holidayPlanInputs(year, state) {
  var Y = hplYear(year, "holidayPlanInputs");
  var s = state && typeof state === "object" ? state : {};
  var holidays = s.holidays && typeof s.holidays === "object" ? s.holidays : {};
  var units = holidays.units && Array.isArray(holidays.units[String(Y)]) ? holidays.units[String(Y)] : null;
  var hb = holidayPlanHistory({ schedule: s.schedule, holidays: holidays, groupRules: s.groupRules });
  var day = function (v) { return typeof v === "string" ? v.slice(0, 10) : v; };
  var vacations = (Array.isArray(s.timeOffRows) ? s.timeOffRows : []).filter(function (r) { return r && r.person_id; }).map(function (r) { return { person_id: r.person_id, start_date: day(r.start_date), end_date: day(r.end_date || r.start_date) }; });
  var evr = s.eastVacationRanges && typeof s.eastVacationRanges === "object" ? s.eastVacationRanges : {};
  var eastClear = {};
  Object.keys(evr).sort().forEach(function (id) {
    var home = [], away = {};
    derivedEastVacations(evr[id], s.eastVacationReviews, id).ranges.forEach(function (r) {
      if (r.state !== "home") {
        vacations.push({ person_id: id, start_date: r.start, end_date: r.end, east: true });
        for (var d = r.start, k = 0; d <= r.end && k < 800; d = suAddDays(d, 1), k++) away[d] = true;
      } else {
        for (var h = r.start, j = 0; h <= r.end && j < 800; h = suAddDays(h, 1), j++) if (home.indexOf(h) < 0) home.push(h);
      }
    });
    var clear = home.filter(function (d) { return !away[d]; }).sort();
    if (clear.length) eastClear[id] = clear;
  });
  return {
    units: units, roster: Array.isArray(s.roster) ? s.roster : [], surgeonRules: s.surgeonRules || {}, groupRules: s.groupRules || {}, holidays: holidays,
    history: hb.entries, historyWarnings: hb.warnings,
    east: { eastBusyDays: s.eastBusyDays, eastForecast: s.eastForecast, eastOverrides: s.eastOverrides, eastDerived: s.eastDerived, eastFeedCoverage: s.eastFeedCoverage, eastClear: eastClear },
    vacations: vacations, schedule: s.schedule && typeof s.schedule === "object" ? s.schedule : {}, seed: Y
  };
}
// A plan (either shape) -> [{ primary, backup }] per unit of P (unknown unit names are reported, never guessed).
function hplAssignByUi(P, plan) {
  var byName = {}, unknown = [];
  if (Array.isArray(plan)) plan.forEach(function (a) { if (!a) return; var n = a.unit && typeof a.unit === "object" ? a.unit.name : (typeof a.unit === "string" ? a.unit : a.name); if (typeof n === "string") byName[n] = a; });
  else if (plan && typeof plan === "object") Object.keys(plan).forEach(function (n) { byName[n] = plan[n]; });
  Object.keys(byName).forEach(function (n) { if (!P.units.some(function (u) { return u.name === n; })) unknown.push(n); });
  var A = P.units.map(function (u) { var a = byName[u.name] || {}; return { primary: typeof a.primary === "string" && a.primary ? a.primary : null, backup: typeof a.backup === "string" && a.backup ? a.backup : null }; });
  return { A: A, unknown: unknown };
}
function hplAssignOut(P, A) { return P.units.map(function (u, ui) { return { unit: { name: u.name, tier: u.tier, days: u.days.slice() }, primary: A[ui].primary, backup: A[ui].backup }; }); }
function hplBreakKey(b) { return [b.rule, b.unit || "", b.role || "", b.id || "", b.tier || ""].join("|"); }
// b names the slot (unit, role) - directly, or among the slots of a max-major break
function hplBreakTouches(b, unit, role) { return (b.unit === unit && (b.role === role || !b.role)) || (Array.isArray(b.slots) && b.slots.some(function (s) { return s.unit === unit && s.role === role; })); }
// hplEvaluate(P, A) -> { breaks, soft, open, vec } - the hard limits the plan breaks, the soft notes and the planner's cost
// vector [open, shape, repeats, load, alternation, primaryRate, sameHoliday, unitLength] computed exactly as the
// search scores a complete plan (planHolidays' leaf + pair terms).
function hplEvaluate(P, A) {
  var breaks = [], soft = [], open = [];
  var Y = P.Y, nameOf = P.nameOf, units = P.units, pool = P.pool;
  var served = {}, prim = {}, days = {};
  HPL_TIERS.forEach(function (t) { served[t] = {}; prim[t] = {}; days[t] = {}; pool.forEach(function (id) { served[t][id] = 0; prim[t][id] = 0; days[t][id] = 0; }); });
  var vec = [0, 0, 0, 0, 0, 0, 0, 0];
  var push = function (b) { b.key = hplBreakKey(b); if (!breaks.some(function (x) { return x.key === b.key; })) breaks.push(b); };
  units.forEach(function (u, ui) {
    var a = A[ui] || {};
    HPL_ROLES.forEach(function (role) {
      var id = a[role] || null;
      if (!id) { open.push({ unit: u.name, role: role }); vec[0]++; return; }
      // an external cover ('ext:<name>' - read from the file only, e.g. a started unit's holders on file in
      // holidayPlanWrittenCheck; a plan never names one) is labelled as the app's holderLabel does, never by its raw id
      // (second review N2)
      if (!P.inPool[id]) { push({ rule: "not-in-pool", unit: u.name, role: role, id: id, text: (String(id).indexOf("ext:") === 0 ? String(id).slice(4) + " (external - the " + u.name + " " + role + " on file)" : nameOf(id) + " (" + u.name + " " + role + ")") + " is not an active roster surgeon" }); return; }
      served[u.tier][id]++; if (role === "primary") prim[u.tier][id]++;
      days[u.tier][id] += u.days.length;
      var rs = P.block[ui][id][role];
      if (rs.length) push({ rule: "refused", unit: u.name, role: role, id: id, reasons: rs.slice(), text: nameOf(id) + " cannot be the " + u.name + " " + Y + " " + role + ": " + rs.join(", ") });
      if (P.R.noRepeatSameRole && P.repeatOf(ui, role, id)) { vec[2]++; push({ rule: "no-repeat", unit: u.name, role: role, id: id, text: nameOf(id) + " " + role + " on " + u.name + " in " + P.repeatText(ui, role, id) + " (no same holiday in the same role two years running)" }); }
      if (role === "primary") vec[5] += P.counts[id].before[u.tier].primaryRate;
      if (P.heldLastYear(ui, id)) vec[6]++;
    });
    if (a.primary && a.primary === a.backup) push({ rule: "same-person", unit: u.name, role: null, id: a.primary, text: nameOf(a.primary) + " is both primary and backup on " + u.name + " " + Y });
  });
  HPL_TIERS.forEach(function (t) {
    var T = P.tiers[t];
    pool.forEach(function (id) {
      vec[3] += served[t][id] * P.counts[id].before[t].load;
      vec[7] += P.counts[id].lastYearDays[t] * days[t][id];
      if (T.capable.indexOf(id) < 0) return;
      var miss = Math.max(0, served[t][id] - T.hi) + Math.max(0, T.lo - served[t][id]) + Math.max(0, prim[t][id] - T.pcap);
      if (!miss) return;
      vec[1] += miss;
      push({ rule: "shape", unit: null, role: null, id: id, tier: t, text: nameOf(id) + " holds " + served[t][id] + " " + t + " holiday" + (served[t][id] === 1 ? "" : "s") + " (" + prim[t][id] + " primary) - the " + t + " tier gives each " + (T.lo === T.hi ? T.lo : T.lo + "-" + T.hi) + " with at most " + T.pcap + " primary" });
    });
  });
  // two majors of the plan within 12 months (the search's majorOk; a history-only conflict is already a refusal)
  pool.forEach(function (id) {
    if (P.maxMajor[id] === null) return;
    var mine = [];
    units.forEach(function (u, ui) { if (u.tier !== "major") return; HPL_ROLES.forEach(function (role) { if (A[ui] && A[ui][role] === id) mine.push({ unit: u.name, role: role, m: hplMonthIndex(u.days[0]) }); }); });
    var bad = mine.filter(function (x, i) {
      var others = mine.filter(function (y, j) { return j !== i && Math.abs(y.m - x.m) < 12; }).length;
      var n = 1 + others;
      P.histMajor[id].forEach(function (h) { if (Math.abs(h - x.m) < 12) n++; });
      return others > 0 && n > P.maxMajor[id];
    });
    if (bad.length) push({ rule: "max-major", unit: null, role: null, id: id, slots: bad.map(function (x) { return { unit: x.unit, role: x.role }; }), text: nameOf(id) + " holds " + bad.length + " major holidays within 12 months (" + bad.map(function (x) { return x.unit + " " + x.role; }).join(", ") + ") - at most " + P.maxMajor[id] + " per rolling 12 months" });
  });
  if (P.R.alternateTiers) pool.forEach(function (id) {
    var Mp = prim.major[id], mp = prim.minor[id], Ms = served.major[id], ms = served.minor[id];
    if (Mp > 0 && mp > 0) { vec[4]++; soft.push({ rule: "alternation", id: id, text: nameOf(id) + " is primary in both tiers" }); }
    else if (Ms > 0 && ms > 0 && Mp === 0 && mp === 0) { vec[4]++; soft.push({ rule: "alternation", id: id, text: nameOf(id) + " is backup in both tiers" }); }
  });
  return { breaks: breaks, soft: soft, open: open, vec: vec };
}
function hplCostObj(v) { return { open: v[0], shape: v[1], repeats: v[2], load: v[3], alternation: v[4], primaryRate: v[5], sameHoliday: v[6], unitLength: v[7] }; }
// holidayPlanCheck(year, plan, opts) -> { year, ok, breaks, soft, open, cost, warnings } (opts = planHolidays' opts)
function holidayPlanCheck(year, plan, opts) {
  var Y = hplYear(year, "holidayPlanCheck");
  var P = hplPrepare(Y, opts || {});
  var as = hplAssignByUi(P, plan);
  var ev = hplEvaluate(P, as.A);
  var warnings = P.warnings.slice();
  as.unknown.forEach(function (n) { warnings.push("the plan names " + n + ", not a holiday unit of " + Y + " - ignored"); });
  return { year: Y, ok: ev.breaks.length === 0, breaks: ev.breaks, soft: ev.soft, open: ev.open, cost: hplCostObj(ev.vec), warnings: warnings };
}
// Every move of slot (ui, role): a swap with each other filled slot's holder (that holder takes this slot, this holder
// takes his) and a replacement by each other pool member - each judged by hplEvaluate. Sorted by the planner's order:
// fewer breaks first, then the cost vector (hplCmp), then the listing order (units by date, primary before backup,
// swaps before replacements, the pool in roster order) - deterministic; the planner's seeded RNG is not used here.
// Never offered: a move that leaves one surgeon in both roles of a unit it touches (structural - the database's CHECK
// schedule_days_distinct_roles refuses the row; for a swap both units are checked after the swap), and - with `today`
// (Central ISO) - ANY move of a unit that itself starts on or before today (no swap, no replacement: holidayPlanAcceptRows
// leaves a started unit as on file whatever the plan names - second review M2, 10/1) and a swap with another such unit
// (the swap would be written half). fileHeld (optional, hplFileHeld) = per unit, the holders ON FILE in a role the plan
// leaves open (Accept keeps them there): twoRoles reads each as that role's holder, so a move that puts one of them into
// the unit's other role is not offered either - Accept would clear his role (holidayPlanAcceptRows' clash) and leave it
// OPEN, which a "keeps every rule" label never said (second review M1, 10/1).
function hplOptions(P, A, ui, role, base, today, fileHeld) {
  var cur = A[ui][role], u = P.units[ui], out = [], n = 0;
  var started = function (uj) { return !!today && P.units[uj].days[0] <= today; };
  if (started(ui)) return out;
  var baseKeys = base.breaks.map(function (b) { return b.key; });
  var twoRoles = function (B, uj) {
    var p = B[uj].primary, b = B[uj].backup, f = fileHeld && fileHeld[uj];
    if (p && p === b) return true;
    if (f && p && !b && f.backup.indexOf(p) >= 0) return true;    // the plan leaves the backup open: the file's backup stays
    if (f && b && !p && f.primary.indexOf(b) >= 0) return true;   // ...and the primary
    return false;
  };
  var judge = function (B, o) {
    var ev = hplEvaluate(P, B), keys = ev.breaks.map(function (b) { return b.key; });
    o.assignments = hplAssignOut(P, B);
    o.breaks = ev.breaks; o.soft = ev.soft; o.open = ev.open; o.cost = hplCostObj(ev.vec); o.vec = ev.vec;
    o.added = ev.breaks.filter(function (b) { return baseKeys.indexOf(b.key) < 0; });
    o.resolved = base.breaks.filter(function (b) { return keys.indexOf(b.key) < 0; });
    o.ok = ev.breaks.length === 0; o.order = n++;
    out.push(o);
  };
  var copy = function () { return A.map(function (x) { return { primary: x.primary, backup: x.backup }; }); };
  if (cur) P.units.forEach(function (u2, uj) {
    if (uj !== ui && started(uj)) return;
    HPL_ROLES.forEach(function (r2) {
      if (uj === ui && r2 === role) return;
      var x = A[uj][r2];
      if (!x || x === cur) return;
      var B = copy(); B[ui][role] = x; B[uj][r2] = cur;
      if (twoRoles(B, ui) || twoRoles(B, uj)) return;
      judge(B, { kind: "swap", unit: u.name, role: role, id: x, from: cur, with: { unit: u2.name, role: r2, id: cur },
        text: "swap with " + P.nameOf(x) + " (" + u2.name + " " + r2 + ")" });
    });
  });
  P.pool.forEach(function (y) {
    if (y === cur) return;
    var B = copy(); B[ui][role] = y;
    if (twoRoles(B, ui)) return;
    judge(B, { kind: "replace", unit: u.name, role: role, id: y, from: cur, with: null, text: "replace with " + P.nameOf(y) });
  });
  out.sort(function (a, b) { return (a.breaks.length - b.breaks.length) || hplCmp(a.vec, b.vec) || (a.order - b.order); });
  out.forEach(function (o) { delete o.vec; delete o.order; });
  return out;
}
// hplFileHeld(P, A, schedule) -> per unit of P { primary: [ids], backup: [ids] } - the holders ON FILE (the raw primary /
// backup of the unit's days, the fields holidayPlanAcceptRows' clash test reads; an external cover is never one) in each
// role A leaves open - Accept keeps them there (a planned role overwrites what is on file, so it lists nobody).
function hplFileHeld(P, A, schedule) {
  var s = schedule && typeof schedule === "object" ? schedule : {};
  return P.units.map(function (u, ui) {
    var f = { primary: [], backup: [] };
    HPL_ROLES.forEach(function (role) {
      if (A[ui] && A[ui][role]) return;
      u.days.forEach(function (d) { var a = s[d], h = a && typeof a[role] === "string" && a[role] ? a[role] : null; if (h && f[role].indexOf(h) < 0) f[role].push(h); });
    });
    return f;
  });
}
// holidayPlanSwapOptions(year, plan, unitName, role, opts) -> { year, unit, role, current, base: { breaks, soft, cost },
//   options: [{ kind: 'swap' | 'replace', unit, role, id, from, with, text, assignments, breaks, soft, open, cost, added,
//   resolved, ok }] } - the Setup card's swap control and Re-check's suggestion read the same list. opts.today (Central
//   ISO, optional): no move of a unit that starts on or before it and no swap with one (hplOptions). opts.schedule (the
//   map Accept would write over, optional): a role the plan leaves open keeps its holder on file - no move puts him into
//   the unit's other role (hplOptions' fileHeld).
function holidayPlanSwapOptions(year, plan, unitName, role, opts) {
  var Y = hplYear(year, "holidayPlanSwapOptions");
  if (role !== "primary" && role !== "backup") throw new Error("holidayPlanSwapOptions: role must be primary or backup, got " + JSON.stringify(role));
  var o = opts || {};
  var P = hplPrepare(Y, o);
  var A = hplAssignByUi(P, plan).A;
  var ui = -1; P.units.forEach(function (u, i) { if (u.name === unitName) ui = i; });
  if (ui < 0) return { year: Y, unit: unitName, role: role, current: null, base: null, options: [], warnings: P.warnings.concat([unitName + " is not a holiday unit of " + Y]) };
  var base = hplEvaluate(P, A);
  return { year: Y, unit: unitName, role: role, current: A[ui][role], base: { breaks: base.breaks, soft: base.soft, cost: hplCostObj(base.vec) }, options: hplOptions(P, A, ui, role, base, suIsIso(o.today) ? o.today : null, hplFileHeld(P, A, o.schedule)), warnings: P.warnings.slice() };
}
// holidayPlanRecheck(year, opts) -> { year, source, accepted: [{ unit, days, primary, backup, mixed }], blocked: [{ unit,
//   role, id, days, breaks, suggestion, valid, started }], warnings }. opts = planHolidays' opts + `schedule` (in-memory
//   map) + `today` (Central ISO, optional).
//   Accepted = the unit days whose row source is holiday-plan-<year> (a hand edit or a trade turns a row 'manual' /
//   'trade' - it is then an ordinary slot, the East conflict report's to watch), and on them a role only where it is
//   LOCKED: Accept locks every role the plan sets, so an unlocked holder on a plan row is the one on file the plan left
//   open - not an accepted slot (re-checking him would let Apply swap lock him). One holder per role across the unit's
//   accepted days, else the slot is reported mixed and skipped. Each accepted slot is judged on the CURRENT state
//   (vacations, East, rules, roster) with hplEvaluate's slot rules - refused, not-in-pool, same-person, max-major (the
//   plan-level shape / no-repeat / alternation are not a newer feed's doing and are not re-reported). The suggestion
//   is the first option of hplOptions that clears the slot's breaks and adds none (valid: true); failing that, the first
//   that clears them (valid: false, its added breaks listed); else null. With `today`: no swap with a unit that starts
//   on or before it (hplOptions - Accept would write it half), and a blocked slot of a unit that has itself started is
//   listed with started: true and no suggestion (Accept leaves a started unit as on file; the day editor changes it).
//   A suggestion never moves the holder on file in a role the plan left open (an unlocked holder on a plan row, or the
//   holders of a mixed role) into that unit's other role: Apply would clear his role and leave it OPEN (hplOptions'
//   fileHeld - second review M1).
var HPL_SLOT_RULES = ["refused", "not-in-pool", "same-person", "max-major"];
function holidayPlanRecheck(year, opts) {
  var Y = hplYear(year, "holidayPlanRecheck");
  var o = opts || {};
  var P = hplPrepare(Y, o);
  var src = holidayPlanSource(Y), sched = o.schedule && typeof o.schedule === "object" ? o.schedule : {};
  var today = suIsIso(o.today) ? o.today : null;
  var warnings = P.warnings.slice(), accepted = [], A = [];
  P.units.forEach(function (u) {
    var rec = { unit: { name: u.name, tier: u.tier, days: u.days.slice() }, days: [], primary: null, backup: null, mixed: [] };
    HPL_ROLES.forEach(function (role) {
      var ids = [];
      u.days.forEach(function (d) {
        var a = sched[d];
        if (!a || a.source !== src) return;
        if (rec.days.indexOf(d) < 0) rec.days.push(d);
        if (!a[role + "Locked"]) return;          // the plan locks every role it sets; an unlocked holder is the file's
        var h = dayHolder(a, role);
        if (h && ids.indexOf(h) < 0) ids.push(h);
      });
      if (ids.length === 1) rec[role] = ids[0];
      else if (ids.length > 1) { rec.mixed.push(role); warnings.push(u.name + " " + Y + " " + role + ": the accepted days hold " + ids.map(P.nameOf).join(" and ") + " - not one holder; that slot is not re-checked"); }
    });
    rec.days.sort();
    if (rec.days.length) accepted.push(rec);
    A.push({ primary: rec.primary, backup: rec.backup });
  });
  var base = hplEvaluate(P, A), blocked = [];
  var fileHeld = hplFileHeld(P, A, sched);   // the unlocked holder on file in a role the plan left open stays there (M1)
  P.units.forEach(function (u, ui) {
    HPL_ROLES.forEach(function (role) {
      var id = A[ui][role];
      if (!id) return;
      var mine = base.breaks.filter(function (b) { return HPL_SLOT_RULES.indexOf(b.rule) >= 0 && hplBreakTouches(b, u.name, role); });
      if (!mine.length) return;
      var keys = mine.map(function (b) { return b.key; });
      var started = !!today && u.days[0] <= today;
      var list = started ? [] : hplOptions(P, A, ui, role, base, today, fileHeld);
      var clears = function (op) { return !op.breaks.some(function (b) { return keys.indexOf(b.key) >= 0; }); };
      var pick = null, valid = false;
      for (var i = 0; i < list.length && !pick; i++) if (clears(list[i]) && !list[i].added.length) { pick = list[i]; valid = true; }
      for (var j = 0; j < list.length && !pick; j++) if (clears(list[j])) pick = list[j];
      var rec = accepted.filter(function (x) { return x.unit.name === u.name; })[0];
      blocked.push({ unit: { name: u.name, tier: u.tier, days: u.days.slice() }, role: role, id: id, days: rec ? rec.days.slice() : [], breaks: mine, suggestion: pick, valid: valid, started: started });
    });
  });
  return { year: Y, source: src, accepted: accepted, blocked: blocked, warnings: warnings };
}
// holidayPlanAcceptRows(year, plan, schedule, opts) -> { year, source, rows: { day: assignment }, days, units: [{ name,
//   tier, days, primary, backup }], skipped: [{ unit, why[, samePerson, id][, started, primary, backup] }], conflicts:
//   [{ day, unit, role, from, to, locked, clash }], keptNotes: [{ day, unit, note }], changes }. opts: { units | holidays
//   (the year's units), only: [unit names] (a Re-check swap writes its units only), today (Central ISO) }.
//   Skipped (nothing written for the unit), in this order: nothing planned; a unit whose first day is ON or before today
//   (started: true - a 24-hour shift under way or past is left as on file whatever the plan names; primary / backup =
//   its holders on file, one per role across its days, else null - holidayPlanWrittenCheck judges the year with them);
//   one surgeon in both roles (samePerson: true - structural, sql/schema.sql CHECK schedule_days_distinct_roles would
//   refuse every day of it; the app stops before its confirm).
//   Each unit day: the plan's holder in each planned role, locked; source holiday-plan-<year>; note holidayPlanNote,
//   except that a note already on the day that is not a holiday-plan note is KEPT (keptNotes - the confirm names them);
//   a roster primary clears an external cover; a role the plan leaves open keeps what is on file (unless that holder is
//   the plan's holder of the other role - then it is cleared, a conflict with clash: true). conflicts = every planned
//   slot whose row already holds someone else (locked or not - a published holder) - Accept refuses them unless the
//   scheduler confirms replacing them. changes = the (day, role) holder changes.
var HPL_NOTE_RE = /^.+ unit - holiday plan \d{4}$/;
function holidayPlanAcceptRows(year, plan, schedule, opts) {
  var Y = hplYear(year, "holidayPlanAcceptRows");
  var o = opts || {};
  var unitsIn = Array.isArray(o.units) ? o.units : (o.holidays && o.holidays.units && Array.isArray(o.holidays.units[String(Y)]) ? o.holidays.units[String(Y)] : []);
  var units = [];
  unitsIn.forEach(function (raw) { var u = hplNormUnit(raw); if (u && !units.some(function (x) { return x.name === u.name; })) units.push(u); });
  units.sort(function (a, b) { return a.days[0] < b.days[0] ? -1 : a.days[0] > b.days[0] ? 1 : 0; });
  var A = hplAssignByUi({ units: units }, plan).A;
  var only = Array.isArray(o.only) ? o.only : null, today = suIsIso(o.today) ? o.today : null;
  var src = holidayPlanSource(Y), sched = schedule && typeof schedule === "object" ? schedule : {};
  var rows = {}, written = [], skipped = [], conflicts = [], keptNotes = [], changes = 0;
  units.forEach(function (u, ui) {
    if (only && only.indexOf(u.name) < 0) return;
    var a = A[ui];
    if (!a.primary && !a.backup) { skipped.push({ unit: u.name, why: "nothing planned" }); return; }
    if (today && u.days[0] <= today) {
      var onFile = {};
      HPL_ROLES.forEach(function (role) {
        var ids = [];
        u.days.forEach(function (d) { var h = dayHolder(sched[d], role); if (ids.indexOf(h) < 0) ids.push(h); });
        onFile[role] = ids.length === 1 ? ids[0] : null;
      });
      skipped.push({ unit: u.name, why: "starts " + u.days[0] + ", " + (u.days[0] === today ? "today" : "before today") + " - left as on file", started: true, primary: onFile.primary, backup: onFile.backup });
      return;
    }
    // after the started check: a started unit is left as on file whatever the plan names for it
    if (a.primary === a.backup) { skipped.push({ unit: u.name, why: "primary and backup are the same surgeon", samePerson: true, id: a.primary }); return; }
    u.days.forEach(function (d) {
      var cur = sched[d] || null;
      var oldNote = cur && typeof cur.note === "string" && cur.note.trim() ? cur.note : null;
      var keepNote = !!oldNote && !HPL_NOTE_RE.test(oldNote);
      if (keepNote) keptNotes.push({ day: d, unit: u.name, note: oldNote });
      var next = { primary: cur && cur.primary || null, backup: cur && cur.backup || null, primaryLocked: !!(cur && cur.primaryLocked), backupLocked: !!(cur && cur.backupLocked), source: src, externalCover: cur && cur.externalCover || null, note: keepNote ? oldNote : holidayPlanNote(u.name, Y) };
      HPL_ROLES.forEach(function (role) {
        var id = a[role];
        if (!id) return;
        var from = dayHolder(cur, role);
        if (from !== id) { changes++; if (from) conflicts.push({ day: d, unit: u.name, role: role, from: from, to: id, locked: !!(cur && cur[role + "Locked"]), clash: false }); }
        next[role] = id; next[role + "Locked"] = true;
        if (role === "primary") next.externalCover = null;
      });
      HPL_ROLES.forEach(function (role) {
        if (a[role]) return;
        var other = role === "primary" ? "backup" : "primary";
        if (next[role] && next[role] === next[other]) { conflicts.push({ day: d, unit: u.name, role: role, from: next[role], to: null, locked: !!next[role + "Locked"], clash: true }); next[role] = null; next[role + "Locked"] = false; changes++; }
      });
      rows[d] = next;
    });
    written.push({ name: u.name, tier: u.tier, days: u.days.slice(), primary: a.primary, backup: a.backup });
  });
  return { year: Y, source: src, rows: rows, days: Object.keys(rows).sort(), units: written, skipped: skipped, conflicts: conflicts, keptNotes: keptNotes, changes: changes };
}
// holidayPlanWrittenCheck(year, plan, acc, opts) -> { year, plan: [assignments], started: [unit names], breaks, added }
//   acc = holidayPlanAcceptRows' result for `plan`; opts = planHolidays' opts. The year as Accept will ACTUALLY leave it:
//   the plan, except each unit acc skipped because it started (acc.skipped[].started), which keeps its holders on file.
//   breaks = holidayPlanCheck of that year; added = the ones the plan as given does not break (a swap with a started
//   unit written half, a shape the skipped unit leaves short) - Accept names them in its confirm, never silent.
function holidayPlanWrittenCheck(year, plan, acc, opts) {
  var Y = hplYear(year, "holidayPlanWrittenCheck");
  var P = hplPrepare(Y, opts || {});
  var A = hplAssignByUi(P, plan).A;
  var kept = {};
  (acc && Array.isArray(acc.skipped) ? acc.skipped : []).forEach(function (s) { if (s && s.started && typeof s.unit === "string") kept[s.unit] = s; });
  var W = P.units.map(function (u, ui) { var k = kept[u.name]; return k ? { primary: k.primary || null, backup: k.backup || null } : { primary: A[ui].primary, backup: A[ui].backup }; });
  var given = hplEvaluate(P, A), written = hplEvaluate(P, W);
  var keys = given.breaks.map(function (b) { return b.key; });
  return { year: Y, plan: hplAssignOut(P, W), started: P.units.filter(function (u) { return !!kept[u.name]; }).map(function (u) { return u.name; }), breaks: written.breaks, added: written.breaks.filter(function (b) { return keys.indexOf(b.key) < 0; }) };
}
// holidayPlanConflictLines(conflicts, label) -> [text] - the Accept confirm's replaced slots grouped by unit + role +
//   holder change (+ locked / held): "Thanksgiving P locked to Khan -> Sarkar (11/25-11/28, 4 days)", so every replaced
//   slot fits (at most one line per unit, role and holder - never capped by day). label(v) names a holder (the app's
//   holderLabel: an id, 'ext:<name>', null -> OPEN); the default prints the value.
function holidayPlanConflictLines(conflicts, label) {
  var lb = typeof label === "function" ? label : function (v) { return v === null || v === undefined || v === "" ? "OPEN" : String(v); };
  var groups = [], byKey = {};
  (Array.isArray(conflicts) ? conflicts : []).forEach(function (c) {
    if (!c || !suIsIso(c.day)) return;
    var k = [c.unit, c.role, c.from, c.to, c.locked ? 1 : 0].join("|");
    var g = byKey[k];
    if (!g) { g = byKey[k] = { unit: c.unit, role: c.role, from: c.from, to: c.to, locked: !!c.locked, days: [] }; groups.push(g); }
    if (g.days.indexOf(c.day) < 0) g.days.push(c.day);
  });
  return groups.map(function (g) {
    g.days.sort();
    var run = g.days.every(function (d, i) { return i === 0 || suAddDays(g.days[i - 1], 1) === d; });
    var span = g.days.length === 1 ? fmtMD(g.days[0]) : (run ? fmtMD(g.days[0]) + "-" + fmtMD(g.days[g.days.length - 1]) : g.days.map(fmtMD).join(", ")) + ", " + g.days.length + " days";
    return g.unit + " " + (g.role === "primary" ? "P" : "B") + " " + (g.locked ? "locked to" : "held by") + " " + lb(g.from) + " -> " + lb(g.to) + " (" + span + ")";
  });
}
// One line per written unit for the change notice: "Thanksgiving 11/25-11/28: P Sarkar, B Khan".
function holidayPlanUnitLines(units, nameOf) {
  var nm = typeof nameOf === "function" ? nameOf : function (x) { return x; };
  return (units || []).map(function (u) {
    var span = u.days.length > 1 ? fmtMD(u.days[0]) + "-" + fmtMD(u.days[u.days.length - 1]) : fmtMD(u.days[0]);
    return u.name + " " + span + ": " + [u.primary ? "P " + nm(u.primary) : null, u.backup ? "B " + nm(u.backup) : null].filter(Boolean).join(", ");
  });
}
// --- The change notices of an Accept (review fix G; second review S1 / M3, 10/1) ---
// A HELD day (the app's holidayNoticePendingRef[year][day], left by an Accept or Re-check swap whose write failed or met
// someone else's change) = { before, wrote, unit: { name, primary, backup }, swap }: `before` the row as last persisted
// before that Accept (the earliest such Accept's while its write had not been overtaken), `wrote` the row it wrote, its
// unit (the notice lines) and its mode. Holders compare as dayHolder (an external cover reads 'ext:<name>'); a lock or a
// note change alone is no holder change and notifies nobody.
function hplSameHolders(a, b) { return HPL_ROLES.every(function (role) { return dayHolder(a || null, role) === dayHolder(b || null, role); }); }
function hplHolderChanges(day, before, after) {
  var out = [];
  HPL_ROLES.forEach(function (role) { var f = dayHolder(before || null, role), t = dayHolder(after || null, role); if (f !== t) out.push({ day: day, role: role, from: f, to: t }); });
  return out;
}
function hplChangeIds(changes) { var ids = []; changes.forEach(function (c) { [c.from, c.to].forEach(function (id) { if (id && ids.indexOf(id) < 0) ids.push(id); }); }); return ids; }
// holidayPlanNoticeChanges(days, after, persisted, held) -> { before: { day: row | null }, changes: [{ day, role, from,
//   to }], affected: [ids] } - the notices of an Accept that saves, per written day: after = the map it writes,
//   persisted = the rows LAST PERSISTED (the app's lastSyncRef, read before the sync), held = that year's held days.
//   The "before" of a day is the persisted row, except for a held day whose persisted row is still the held `before`
//   (the earlier write never landed) or the held `wrote` (it landed later, by the automatic retry): then the held
//   `before` - the holders that earlier Accept displaced are told. Any other persisted row is someone else's change
//   since (a trade, another device - the conflict reload adopted it): the diff is against it, so the holder the plan
//   actually replaces is told, never the one who lost the day to that other change (second review M3). affected =
//   every holder before or after a change (an 'ext:' cover included - the app keeps roster surgeons only).
function holidayPlanNoticeChanges(days, after, persisted, held) {
  var A = after && typeof after === "object" ? after : {}, Pm = persisted && typeof persisted === "object" ? persisted : {}, Hm = held && typeof held === "object" ? held : {};
  var before = {}, changes = [];
  (Array.isArray(days) ? days : []).forEach(function (d) {
    var p = Pm[d] || null, h = Object.prototype.hasOwnProperty.call(Hm, d) && Hm[d] && typeof Hm[d] === "object" ? Hm[d] : null;
    var b = h && (hplSameHolders(p, h.wrote) || hplSameHolders(p, h.before)) ? (h.before || null) : p;
    before[d] = b;
    changes = changes.concat(hplHolderChanges(d, b, A[d] || null));
  });
  return { before: before, changes: changes, affected: hplChangeIds(changes) };
}
// holidayPlanHeldNotices(held, persisted, local) -> { landed, waiting, dropped: [days], changes, affected, units: [{ name,
//   days, primary, backup }], swap, left } - the app's "Send the held change notices" button over one year's held days:
//   persisted = the rows LAST PERSISTED (lastSyncRef), local = the in-memory map (optional). Per held day:
//     landed   the persisted row holds the holders the Accept wrote - its change is on file: the notice goes out for
//              before -> wrote (changes / affected; units = the landed days per unit, for holidayPlanUnitLines; swap =
//              every landed day came from a Re-check swap);
//     waiting  not on file yet, but the local map still carries them (the automatic retry may still land them) - kept
//              held (left); without `local`, a persisted row still equal to `before` waits;
//     dropped  neither - nothing landed and the local map moved on (an undo, or the conflict reload adopted someone
//              else's row): the plan's change does not stand, nothing is sent for the day.
function holidayPlanHeldNotices(held, persisted, local) {
  var Hm = held && typeof held === "object" ? held : {}, Pm = persisted && typeof persisted === "object" ? persisted : {}, L = local && typeof local === "object" ? local : null;
  var landed = [], waiting = [], dropped = [], changes = [], units = [], byUnit = {}, left = {}, swapAll = true;
  Object.keys(Hm).filter(suIsIso).sort().forEach(function (d) {
    var h = Hm[d] && typeof Hm[d] === "object" ? Hm[d] : {}, p = Pm[d] || null;
    if (hplSameHolders(p, h.wrote)) {
      landed.push(d);
      changes = changes.concat(hplHolderChanges(d, h.before, h.wrote));
      if (!h.swap) swapAll = false;
      var u = h.unit && typeof h.unit.name === "string" ? h.unit : { name: d, primary: null, backup: null };
      var g = byUnit[u.name];
      if (!g) { g = byUnit[u.name] = { name: u.name, days: [], primary: u.primary || null, backup: u.backup || null }; units.push(g); }
      g.days.push(d);
      return;
    }
    if (L ? hplSameHolders(L[d] || null, h.wrote) : hplSameHolders(p, h.before)) { waiting.push(d); left[d] = h; }
    else dropped.push(d);
  });
  return { landed: landed, waiting: waiting, dropped: dropped, changes: changes, affected: hplChangeIds(changes), units: units, swap: landed.length > 0 && swapAll, left: left };
}

/* ---- East vacation reviews (Prompt 15 part 2, 9/23) ----
   The person's Davenport vacation ranges (east-feed.js eastVacations(rows, code):
   [{ start, end }]) meet the east_vacation_reviews rows ({ person_id, start, end,
   decision 'away' | 'home', decided_at, decided_by }). Nothing is mirrored
   blindly: a range with no review is UNREVIEWED (treated like away - a Silvis
   vacation - until the person decides). The match is EXACT and PERSON-SCOPED
   (the same person - the personId argument, else range.person_id - and the same
   start and end), which is what makes a refresh reset a review: a range
   Davenport changed or removed no longer matches its row, so the range reads
   unreviewed again and the old row is STALE - the app deletes it through the
   normal write path (audit eastvac.review, reason reset) and says so in the
   refresh toast. The person scope matters because the app reads ALL
   east_vacation_reviews rows (read-all RLS) while the feed's ranges
   (eastVacations(rows, code)) carry no person_id: another surgeon's row must
   never decide this person's range, and another surgeon's rows are never
   "stale" for this person's refresh (the scheduler may delete anyone's row, so a
   mis-scoped stale list would wipe the other East surgeons' reviews). Without a
   resolvable person nothing matches (every range unreviewed) and nothing is
   stale. rules.js rdEastReviewState applies the same rule inside buildContext
   (filtering the rows by person_id first; pinned equal by test/rules.test.js).
   Pure; never mutates its inputs. */
function evPersonOf(range, personId) {
  if (personId !== undefined && personId !== null && personId !== "") return String(personId);
  return range && range.person_id !== undefined && range.person_id !== null && range.person_id !== "" ? String(range.person_id) : null;
}
function evReviewMatches(range, review, personId) {
  if (!range || !review) return false;
  var who = evPersonOf(range, personId);
  if (!who || review.person_id !== who) return false;
  var rs = review.start !== undefined ? review.start : review.start_date;
  var re = review.end !== undefined ? review.end : review.end_date;
  return rs === range.start && re === range.end;
}
// reviewStateFor(range, reviews, personId) -> { state: 'unreviewed' | 'away' | 'home', review: row | null }
//   personId: the roster id whose range this is (falls back to range.person_id; with neither, always unreviewed).
function reviewStateFor(range, reviews, personId) {
  var list = Array.isArray(reviews) ? reviews : [];
  for (var k = 0; k < list.length; k++) {
    var r = list[k];
    if (!evReviewMatches(range, r, personId)) continue;
    return { state: r.decision === "away" ? "away" : r.decision === "home" ? "home" : "unreviewed", review: r };
  }
  return { state: "unreviewed", review: null };
}
// derivedEastVacations(ranges, reviews, personId) -> { ranges: [{ start, end, state, review }], stale: [{ review, reason, range }] }
//   personId: the roster id whose ranges these are (the East code resolved to the roster id). Only THAT
//           person's review rows are consulted or listed; pass all rows and every other surgeon's rows are
//           simply ignored. Without personId the single person_id every range agrees on is used; with no
//           person at all every range is unreviewed and stale is [] (nothing is ever deleted unscoped).
//   ranges: every valid input range (sorted by start) with its state and matching row (null when unreviewed);
//   stale:  every review row OF THIS PERSON that matches NO range exactly - reason 'changed' when it still
//           overlaps a current range (that range is the one it overlaps: the dates moved),
//           'removed' when it overlaps none (the vacation is gone from Davenport). Both are
//           the rows the refresh deletes; the toast names them by reason.
//   Malformed ranges (no ISO start/end, end before start) and malformed rows are dropped.
function derivedEastVacations(ranges, reviews, personId) {
  var good = (Array.isArray(ranges) ? ranges : []).filter(function (r) { return r && suIsIso(r.start) && suIsIso(r.end) && r.end >= r.start; })
    .slice().sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : a.end < b.end ? -1 : a.end > b.end ? 1 : 0; });
  var who = evPersonOf(null, personId);
  if (!who) {
    var ids = [];
    good.forEach(function (r) { var p = evPersonOf(r); if (p && ids.indexOf(p) < 0) ids.push(p); });
    if (ids.length === 1) who = ids[0];
  }
  var rows = who ? (Array.isArray(reviews) ? reviews : []).filter(function (r) { return r && typeof r === "object" && r.person_id === who; }) : [];
  var out = good.map(function (r) { var s = reviewStateFor(r, rows, who); return { start: r.start, end: r.end, state: s.state, review: s.review }; });
  var stale = [];
  rows.forEach(function (r) {
    var rs = r.start !== undefined ? r.start : r.start_date, re = r.end !== undefined ? r.end : r.end_date;
    if (!suIsIso(rs) || !suIsIso(re)) return;
    if (good.some(function (g) { return evReviewMatches(g, r, who); })) return;
    var overlap = null;
    good.forEach(function (g) { if (!overlap && g.start <= re && g.end >= rs) overlap = g; });
    stale.push({ review: r, reason: overlap ? "changed" : "removed", range: overlap ? { start: overlap.start, end: overlap.end } : null });
  });
  return { ranges: out, stale: stale };
}

/* ═══ Offer periods (Prompt 14 P2, 9/23) ═══
 * Pure period maths shared by Setup -> Periods, the day editor, the daily-reminder mirror and the tests. Rows are
 * DB-shaped (call_periods: start_day / end_day / offers_close_at / publish_by / rules_only_ids / offer_modes;
 * call_offers: person_id / day / role_pref); 'start' / 'end' are accepted as aliases of start_day / end_day and a
 * timestamp-shaped day is read by its date. Nothing here reads the clock or the network. rules.js derives the same
 * status inside buildContext (test/offers.test.js pins the parity); helpers own the timeline. */
const OP_PERIOD_DEFAULTS = { lengthMonths: 3, presets: [3, 6], closeWeeksBeforeStart: 6, publishWeeksBeforeStart: 4, remindDaysBeforeClose: [14, 3] }; // = docs/silvis-seed.json groupRules.offerPeriods
function opDay(v) {
  if (v instanceof Date && !isNaN(v)) return fmt(v);
  const s = typeof v === "string" ? v.slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function opBounds(p) {
  if (!p || typeof p !== "object") return null;
  const a = opDay(p.start_day !== undefined ? p.start_day : p.start), b = opDay(p.end_day !== undefined ? p.end_day : p.end);
  return a && b && b >= a ? { start: a, end: b } : null;
}
function opList(v) {
  if (typeof v === "string") { try { v = JSON.parse(v); } catch (e) { return []; } }
  return Array.isArray(v) ? v : [];
}
// periodFor(day, periods) -> the period row (as given) whose [start_day, end_day] contains the day, the earliest
// start winning an overlap; null for a bad day, no list or no match.
function periodFor(day, periods) {
  const d = opDay(day);
  if (!d || !Array.isArray(periods)) return null;
  let best = null, bestStart = null;
  periods.forEach(p => { const b = opBounds(p); if (!b || d < b.start || d > b.end) return; if (best === null || b.start < bestStart) { best = p; bestStart = b.start; } });
  return best;
}
// offerStatus(period, offers, personId) mirrors SQL offer_status(): 'submitted' when the person has >= 1 call_offers
// row with day between start_day and end_day (inclusive), else 'rules_only' when listed in rules_only_ids (an array,
// or a JSON string from an older caller), else 'not_started'; null when the period has no usable dates.
function offerStatus(period, offers, personId) {
  const b = opBounds(period);
  if (!b) return null;
  const rows = Array.isArray(offers) ? offers : [];
  for (let i = 0; i < rows.length; i++) {
    const o = rows[i];
    if (!o || o.person_id !== personId) continue;
    const d = opDay(o.day);
    if (d && d >= b.start && d <= b.end) return "submitted";
  }
  return opList(period.rules_only_ids).indexOf(personId) >= 0 ? "rules_only" : "not_started";
}
// opEndOfPeriod(start, months) -> the last day of the Nth calendar month counting the start month as month 1,
// extended to the following Sunday when it falls on a Friday or Saturday (the Generate presets' rule, so a period
// never ends mid-weekend): 2026-11-02 + 3 -> 2027-01-31; + 6 -> 2027-04-30 (Fri) -> 2027-05-02.
function opEndOfPeriod(start, months) {
  const y = +start.slice(0, 4), m = +start.slice(5, 7);
  const idx = m + months - 1, yy = y + Math.floor((idx - 1) / 12), mm = ((idx - 1) % 12) + 1;
  let end = fmt(new Date(yy, mm, 0));
  const dow = parse(end).getDay(); // 0 = Sun .. 6 = Sat
  if (dow === 5 || dow === 6) end = suAddDays(end, 7 - dow);
  return end;
}
// offerTimeline(period, rules) -> { start_day, end_day, length_months, offers_close_at, publish_by, remind_on: [...],
// presets } for a new or existing period: start_day is required ('YYYY-MM-DD'; null otherwise); every other date the
// row already carries is kept (each is editable per period), the rest are filled from rules =
// groupRules.offerPeriods (absent keys -> OP_PERIOD_DEFAULTS): end from length_months (or lengthMonths, or the
// rules' default), offers_close_at = start - closeWeeksBeforeStart weeks, publish_by = start - publishWeeksBeforeStart
// weeks, remind_on = offers_close_at - each remindDaysBeforeClose, ascending.
function offerTimeline(period, rules) {
  const start = period && typeof period === "object" ? opDay(period.start_day !== undefined ? period.start_day : period.start) : null;
  if (!start) return null;
  const Rz = Object.assign({}, OP_PERIOD_DEFAULTS, rules && typeof rules === "object" ? rules : {});
  const num = (v, d) => (typeof v === "number" && isFinite(v) && v > 0 ? v : d);
  const months = num(period.length_months !== undefined ? period.length_months : period.lengthMonths, num(Rz.lengthMonths, OP_PERIOD_DEFAULTS.lengthMonths));
  const closeW = num(Rz.closeWeeksBeforeStart, OP_PERIOD_DEFAULTS.closeWeeksBeforeStart), pubW = num(Rz.publishWeeksBeforeStart, OP_PERIOD_DEFAULTS.publishWeeksBeforeStart);
  const remind = (Array.isArray(Rz.remindDaysBeforeClose) ? Rz.remindDaysBeforeClose : OP_PERIOD_DEFAULTS.remindDaysBeforeClose).filter(n => typeof n === "number" && isFinite(n) && n >= 0);
  const end = opDay(period.end_day !== undefined ? period.end_day : period.end) || opEndOfPeriod(start, months);
  const close = opDay(period.offers_close_at) || suAddDays(start, -7 * closeW);
  const publish = opDay(period.publish_by) || suAddDays(start, -7 * pubW);
  return { start_day: start, end_day: end, length_months: months, offers_close_at: close, publish_by: publish, remind_on: remind.map(n => suAddDays(close, -n)).sort(), presets: Array.isArray(Rz.presets) ? Rz.presets.slice() : OP_PERIOD_DEFAULTS.presets.slice() };
}

/* ═══ Offer timeline - the daily cron's date maths (Prompt 14 P4, 9/23) ═══
 * daily-reminder mode 'offers' runs these once a morning (13:00 UTC = 08:00 CDT / 07:00 CST). The SAME maths is
 * mirrored in plain JavaScript between the '// @offerTimeline-mirror-start' / '-end' markers of
 * edge-functions/daily-reminder/index.ts; test/offers-timeline.test.js runs both against
 * test/fixtures/offer-timeline.json. Change the three together. Nothing here reads the clock or the network. */
// offerPoolIds(roster) -> the ids the timeline speaks to: active roster entries that are not outside surgeons
// (type 'external' - written in by hand, never asked for offers), in roster order.
function offerPoolIds(roster) {
  if (!Array.isArray(roster)) return [];
  const out = [];
  roster.forEach(r => { if (r && typeof r === "object" && r.id && r.active !== false && r.type !== "external") out.push(String(r.id)); });
  return out;
}
// offerRollcall(period, offers, ids) -> [{ id, status, offered }] in ids order: status = offerStatus (submitted /
// rules_only / not_started) and offered = the number of DISTINCT days the person offered inside [start_day, end_day]
// (end inclusive; a timestamp-shaped day is read by its date; a role_pref never counts twice); [] when the period
// has no usable dates or ids is not a list. Since Prompt 26 (9/30) the heads-up reminder goes to every pool surgeon whatever
// the status, and the freeze roll call is offerFreezeRollcall (painted days / added vacations / following their rules).
function offerRollcall(period, offers, ids) {
  const b = opBounds(period);
  if (!b || !Array.isArray(ids)) return [];
  const days = Object.create(null);
  (Array.isArray(offers) ? offers : []).forEach(o => {
    if (!o || typeof o !== "object" || !o.person_id) return;
    const d = opDay(o.day);
    if (!d || d < b.start || d > b.end) return;
    (days[o.person_id] = days[o.person_id] || new Set()).add(d);
  });
  return ids.map(id => ({ id: String(id), status: offerStatus(period, offers, String(id)), offered: days[id] ? days[id].size : 0 }));
}
// offerCronPlan(period, today, rules) -> what the daily cron does for one period on `today` (the Central date):
// { action: 'remind' | 'close' | 'none', reason, days_to_close, offers_close_at, remind_on }.
//   close  - today >= offers_close_at and the period is still upcoming (reason close:today / close:overdue): the
//            status flips to closed and the scheduler gets the summary; a 0-day reminder never fires on that day.
//   remind - today is one of offerTimeline's remind_on days (reason remind:<days before the close>).
//   none   - otherwise (no-trigger), or for any status other than upcoming (status:<x>); an absent status reads
//            upcoming (the cron only reads upcoming rows anyway).
// null for a non-ISO today or a period without usable dates (the cron reports the row and moves on). Who is
// actually mailed is offerRollcall's answer (not_started only); this only says whether today is a day.
function offerCronPlan(period, today, rules) {
  const t = offerTimeline(period, rules);
  const d = opDay(today);
  if (!t || !d) return null;
  const close = t.offers_close_at, daysToClose = suDaysBetween(d, close);
  const status = period.status === undefined || period.status === null ? "upcoming" : String(period.status);
  const base = { action: "none", reason: "no-trigger", days_to_close: daysToClose, offers_close_at: close, remind_on: t.remind_on };
  if (status !== "upcoming") return Object.assign(base, { reason: "status:" + status });
  if (d >= close) return Object.assign(base, { action: "close", reason: daysToClose === 0 ? "close:today" : "close:overdue" });
  if (t.remind_on.indexOf(d) >= 0) return Object.assign(base, { action: "remind", reason: "remind:" + daysToClose });
  return base;
}

/* ═══ Offer painter (Prompt 14 part 3a, 9/23) ═══
 * Pure pieces of the OfferPainterSheet (index-source.html, module scope): the draft-to-write diff, the words for a
 * day that cannot be offered, the words for a surgeon's rules and the "next period" pick. Nothing here reads the
 * clock, the DOM or the network; test/data-layer.test.js section F runs them. */
const OFFER_ROLES = { primary: true, backup: true, either: true };
// offersDraftDiff(saved, draft) -> { insert: [{ day, role_pref }], update: [{ day, role_pref, was }], delete: [day],
// bad: [day], count }. saved = the person's call_offers rows (an array; a { day: role_pref } map is accepted too),
// draft = { day: role_pref | null } (null / '' = clear). A draft entry equal to the saved state drops out, a clear of
// a day never saved drops out, a day that is not 'YYYY-MM-DD' or a brush outside primary / backup / either lands in
// `bad` and writes nothing (fail closed). Every list is in day order; count = insert + update + delete.
function offersDraftDiff(saved, draft) {
  const savedMap = {};
  if (Array.isArray(saved)) saved.forEach(r => { const d = r && r.day !== undefined && r.day !== null ? String(r.day).slice(0, 10) : ""; if (suIsIso(d) && OFFER_ROLES[r.role_pref]) savedMap[d] = r.role_pref; });
  else if (saved && typeof saved === "object") Object.keys(saved).forEach(d => { if (suIsIso(d) && OFFER_ROLES[saved[d]]) savedMap[d] = saved[d]; });
  const out = { insert: [], update: [], delete: [], bad: [], count: 0 };
  Object.keys(draft && typeof draft === "object" ? draft : {}).sort().forEach(day => {
    const want = draft[day], have = savedMap[day];
    if (!suIsIso(day)) { out.bad.push(day); return; }
    if (want === null || want === undefined || want === "") { if (have) out.delete.push(day); return; }
    if (!OFFER_ROLES[want]) { out.bad.push(day); return; }
    if (!have) out.insert.push({ day, role_pref: want });
    else if (have !== want) out.update.push({ day, role_pref: want, was: have });
  });
  out.count = out.insert.length + out.update.length + out.delete.length;
  return out;
}
// The two families the painter tells apart (rules doc section 1 "own dates beat own patterns"; guide section 17):
//   OBLIGATIONS grey the day for that role and are never liftable from the painter. The person's own DATED rows
//   (unavailable / no backup / backup only, entered under Setup -> Availability) sit here too: rules.js keeps them
//   hard whatever an offer says (an offer only adds a dated 'available' bit, it never clears a dated statement), so
//   an offer painted over one would be unplaceable - the row must be changed first;
//   the WEEKDAY-PATTERN family is paintable behind one confirmation, because the saved offer is a dated row that
//   lifts the pattern for that date and role (item W). test/data-layer.test.js section F proves BOTH claims from a
//   real ctx: every confirm code the seed can raise vanishes once the offer is saved, the three row codes stay.
// Everything else eligibility reports (caps, runs, the other role, a lock, not-offered) is neither: the generator
// weighs it when it places the offer. The core code is the part before ':'. The same test checks every code in
// rules.HARD_REASONS is classified on purpose.
const OFFER_BLOCK_WORDS = {
  "time-off": "on your vacation",
  "day-before-vacation": "the day before your vacation",
  "east-busy": "East busy",
  "east-forecast-busy": "East forecast busy",
  "derived-lock": "your East/Silvis week",
  "derived-lock-held": "your East/Silvis week",
  "outside-window": "outside your window",
  "holiday-opt-out": "you opted out of this holiday",
  "backup-opt-out": "you opted out of backup",
  "inactive": "not active on the roster",
  "unavailable-row": "a day you stated as unavailable - ask the scheduler to change that row first",
  "no-backup-row": "a day you stated as no backup - ask the scheduler to change that row first",
  "backup-only-row": "a day you stated as backup only - ask the scheduler to change that row first",
};
const OFFER_CONFIRM_WORDS = {
  "hard-never-weekday": "never a call day by your rules",
  "weekday-not-allowed": "not one of your allowed weekdays",
  "recurring-unavailable": "your recurring unavailable day",
  "not-recurring-available": "not one of your recurring available days",
  "weekday-pattern": "your weekday pattern",
  "weekend-block-only": "a standalone weekend day (you take Fri-Sun as a block)",
  "lone-weekend-day": "a Saturday or Sunday on its own (your weekend days come as a pair)", // Prompt 23 B2: a shape rule of his own - a saved offer lifts it like the pattern family (W)
  "day-before-aledo": "the day before an Aledo day",
  "whitelist-month": "outside the days you listed for that month",
  "outside-available-weeks": "outside your listed weeks",
};
// offerDayWhy(hard) -> { block: words | null, confirm: words | null, codes: { block: [...], confirm: [...] } } for one
// role's hard reasons (rules.eligibility(...).hard). block wins the row when set; confirm is the one-line reason the
// confirmation names; the first code of each family gives the words (holiday-opt-out carries the unit's name).
function offerDayWhy(hard) {
  const list = Array.isArray(hard) ? hard : [];
  const out = { block: null, confirm: null, codes: { block: [], confirm: [] } };
  list.forEach(code => {
    const s = String(code || ""); const i = s.indexOf(":"); const core = i < 0 ? s : s.slice(0, i); const arg = i < 0 ? "" : s.slice(i + 1);
    if (OFFER_BLOCK_WORDS[core]) { out.codes.block.push(s); if (!out.block) out.block = core === "holiday-opt-out" && arg ? "you opted out of " + arg : OFFER_BLOCK_WORDS[core]; }
    else if (OFFER_CONFIRM_WORDS[core]) { out.codes.confirm.push(s); if (!out.confirm) out.confirm = OFFER_CONFIRM_WORDS[core]; }
  });
  return out;
}
// offerPeriodOpen(period, today) -> true while a SURGEON may still enter offers / choose a mode for the period: its
// status is 'upcoming' (absent = upcoming) and offers_close_at (alias offersCloseAt) is after today - the same
// reading as OF003 / OM005 (frozen once offers_close_at <= today). The scheduler is never frozen (the caller's
// business). false for junk.
function offerPeriodOpen(period, today) {
  if (!period || typeof period !== "object" || !suIsIso(today)) return false;
  const status = period.status === undefined || period.status === null || period.status === "" ? "upcoming" : String(period.status);
  if (status !== "upcoming") return false;
  const raw = period.offers_close_at !== undefined ? period.offers_close_at : period.offersCloseAt;
  const close = raw === undefined || raw === null ? "" : String(raw).slice(0, 10);
  return !suIsIso(close) || close > today;
}
// offerNextPeriod(periods, today) -> the call_periods row the painter's toggle, "go by my rules", period box and
// period count speak to: the earliest period (by start_day) that is still OPEN for offers (offerPeriodOpen) and not
// over; when none is open, the earliest period still running or ahead (frozen - the caller renders it read-only
// through offerPeriodOpen), so a surgeon looking in between the freeze and the next period's creation still sees
// where they stand. null when there is none or today is not ISO. 'start' / 'end' are read as aliases (the seed's
// shape), like the other period helpers above.
function offerNextPeriod(periods, today) {
  if (!suIsIso(today) || !Array.isArray(periods)) return null;
  let open = null, openStart = null, any = null, anyStart = null;
  periods.forEach(p => {
    if (!p || typeof p !== "object") return;
    const s = String(p.start_day !== undefined ? p.start_day : (p.start !== undefined ? p.start : "")).slice(0, 10);
    const e = String(p.end_day !== undefined ? p.end_day : (p.end !== undefined ? p.end : "")).slice(0, 10);
    if (!suIsIso(s) || !suIsIso(e) || e < today) return;
    if (any === null || s < anyStart) { any = p; anyStart = s; }
    if (offerPeriodOpen(p, today) && (open === null || s < openStart)) { open = p; openStart = s; }
  });
  return open || any;
}

/* === No-primary days (Prompt 28, 10/1 - Faraz: "I do want them to be able to do that"; Burchett: "I need to be blocked
 * out as unavailable for primary call. I can cover backup call these days") ===
 * The painter's fifth brush "No primary": not on primary that day, backup is fine. Stored as ONE availability row per day,
 * kind 'backup_only', role 'any' (rules.js already reads it: primary blocked, backup available), written only through
 * rpc/save_offers -> save_no_primary (security definer; sql/migrations/2026-10-01-no-primary-days.sql). The person's own
 * SINGLE-day backup_only rows (any source - the app's, Setup's, the seed's) are the No primary state, his to change; a
 * multi-day backup_only row (a range the scheduler entered in Setup) shows on each of its days as NO_PRIMARY_RANGE_WORDS
 * and stays read-only in the painter (the database refuses to split it, NP007). Pure: no clock, no DOM, no network;
 * test/offers.test.js section F runs them. */
const NO_PRIMARY_RANGE_WORDS = "No primary (set by the scheduler)";
const NO_PRIMARY_HELD_WORDS = "you hold primary that day - trade it first";
const NP_RANGE_MAX_DAYS = 3660; // a range is expanded day by day for the painter; a junk end date (9999-12-31) never loops for ever
// noPrimaryDays(rows, personId) -> { own: { day: true }, range: { day: true } } from availability rows: kind 'backup_only' of
// that person, any role, any source; ISO start / end (a missing end = the start day), end >= start. start === end -> own[day];
// a longer row -> range[d] for each of its days (at most NP_RANGE_MAX_DAYS of them). A day covered by a range is NOT in own
// (a range wins: read-only). Other kinds, other persons and junk rows are ignored.
function noPrimaryDays(rows, personId) {
  const out = { own: {}, range: {} };
  if (!Array.isArray(rows) || !personId) return out;
  const singles = [], ranges = [];
  rows.forEach(r => {
    if (!r || typeof r !== "object" || r.kind !== "backup_only" || r.person_id !== personId) return;
    const s = r.start_date === undefined || r.start_date === null ? "" : String(r.start_date).slice(0, 10);
    const e = r.end_date === undefined || r.end_date === null || r.end_date === "" ? s : String(r.end_date).slice(0, 10);
    if (!suIsIso(s) || !suIsIso(e) || e < s) return;
    if (s === e) { singles.push(s); return; }
    ranges.push([s, e]);
    let d = s;
    for (let n = 0; d <= e && n < NP_RANGE_MAX_DAYS; n++, d = suAddDays(d, 1)) out.range[d] = true;
  });
  singles.forEach(d => { if (!ranges.some(([s, e]) => d >= s && d <= e)) out.own[d] = true; });
  return out;
}
// offerPaintCell(cell, brush, opts) -> { offer, np, skip, lift, replaced } - what ONE brush does to ONE day of the painter.
//   cell  = { offer: 'primary'|'backup'|'either'|null (the effective offer), np: bool (the effective OWN no-primary), savedOffer,
//             savedNp: bool (the saved state), range: bool (a scheduler's range covers the day), past: bool, frozen: words|null,
//             grey: words|null (past / frozen / both roles blocked - the row's grey), blockPrimary / blockBackup: words|null
//             (a one-role block; a range day's blockPrimary is NO_PRIMARY_RANGE_WORDS), holdsPrimary: bool (published primary) }
//   brush = 'primary'|'backup'|'either'|'noprimary'|'clear'; opts = { single: bool } (a single tap, not a Range / Paste batch)
//   offer / np = the state after the brush; skip = the words the sheet lists in "Skipped N day(s): ..." (null = not listed;
//   unchanged + null = a silent no-op); lift = a primary / either brush lifts a no-primary day (the sheet asks ONCE per batch);
//   replaced = No primary removed a primary / either offer. First matching rule wins, per brush (guide section 17, Prompt 28):
//   noprimary: past -> skip 'past'; frozen -> skip its words; range -> silent; own N -> a single tap takes it back (Range /
//              Paste: silent); greyed -> skip; holds primary -> skip NO_PRIMARY_HELD_WORDS; a primary / either offer -> replaced
//              (offer none, N); otherwise N (a Backup offer stays: backup preferred that day).
//   primary / either: greyed -> skip; range -> skip 'primary - <words>'; a one-role block on a needed role -> skip '<role> - <words>';
//              a single tap on the same brush -> offer none; own N -> offer, N lifted (lift); otherwise -> offer.
//   backup:    greyed -> skip; backup blocked -> skip 'backup - <words>'; a single tap on Backup -> offer none; otherwise Backup
//              (N and the range unchanged).
//   clear:     nothing to clear -> silent (before any grey is named); past -> skip 'past'; frozen -> skip; greyed with neither a
//              saved offer nor a saved N -> skip; otherwise offer none and N lifted (a range stays: read-only).
// The weekday-pattern confirm stays in the sheet (it reads the row's confirm words).
function offerPaintCell(cell, brush, opts) {
  const c = cell && typeof cell === "object" ? cell : {};
  const E = OFFER_ROLES[c.offer] ? c.offer : null;
  const N = !!c.np && !c.range;
  const single = !!(opts && opts.single);
  const frozen = c.frozen ? String(c.frozen) : null;
  const grey = c.grey ? String(c.grey) : c.past ? "past" : frozen;
  const keep = (skip) => ({ offer: E, np: N, skip: skip || null, lift: false, replaced: false });
  const to = (offer, np, extra) => Object.assign({ offer, np: !!np, skip: null, lift: false, replaced: false }, extra || {});
  if (brush === "noprimary") {
    if (c.past) return keep("past");
    if (frozen) return keep(frozen);
    if (c.range) return keep(null);
    if (N) return single ? to(E, false) : keep(null);
    if (grey) return keep(grey);
    if (c.holdsPrimary) return keep(NO_PRIMARY_HELD_WORDS);
    if (E === "primary" || E === "either") return to(null, true, { replaced: true });
    return to(E, true);
  }
  if (brush === "primary" || brush === "either") {
    if (grey) return keep(grey);
    if (c.range) return keep("primary - " + (c.blockPrimary || NO_PRIMARY_RANGE_WORDS));
    const need = brush === "either" ? ["primary", "backup"] : ["primary"];
    const words = { primary: c.blockPrimary || null, backup: c.blockBackup || null };
    const blocked = need.filter(role => words[role]);
    if (blocked.length) return keep(blocked.map(role => role + " - " + words[role]).join(", "));
    if (single && E === brush) return to(null, N);
    if (N) return to(brush, false, { lift: true });
    return to(brush, false);
  }
  if (brush === "backup") {
    if (grey) return keep(grey);
    if (c.blockBackup) return keep("backup - " + c.blockBackup);
    if (single && E === "backup") return to(null, N);
    return to("backup", N);
  }
  if (brush === "clear") {
    if (!E && !N) return keep(null);
    if (c.past) return keep("past");
    if (frozen) return keep(frozen);
    if (grey && !c.savedOffer && !c.savedNp) return keep(grey);
    return to(null, false);
  }
  return keep(null); // an unknown brush changes nothing
}
// noPrimaryDraftDiff(savedOwn, npDraft) -> { add: [day], clear: [day], bad: [day] } in day order. savedOwn = noPrimaryDays(...).own
// (a { day: true } map; an array of days is accepted too), npDraft = { day: true (mark) | false (lift) }. true on a day not saved
// -> add; false on a saved day -> clear; equal to the saved state -> dropped; a day that is not 'YYYY-MM-DD' -> bad (fail closed,
// nothing is written).
function noPrimaryDraftDiff(savedOwn, npDraft) {
  const saved = {};
  if (Array.isArray(savedOwn)) savedOwn.forEach(d => { saved[String(d)] = true; });
  else if (savedOwn && typeof savedOwn === "object") Object.keys(savedOwn).forEach(d => { if (savedOwn[d]) saved[d] = true; });
  const out = { add: [], clear: [], bad: [] };
  const dr = npDraft && typeof npDraft === "object" ? npDraft : {};
  Object.keys(dr).sort().forEach(day => {
    if (!suIsIso(day)) { out.bad.push(day); return; }
    const want = !!dr[day], have = !!saved[day];
    if (want && !have) out.add.push(day);
    else if (!want && have) out.clear.push(day);
  });
  return out;
}
// offersAuditSummary(name, offerCount, np, mode, periodLabel) -> the summary of the painter's ONE audit row 'offers.save'
// (the Activity log shows it through auditEntryText). np = { add: [day], clear: [day] } (null / missing = empty). With np empty
// it is byte-for-byte the text the app wrote before Prompt 28: "<Name>: N offer change(s)[, mode m][ (label)]". Days as M/D,
// ", "-joined, in day order: "Burchett: no primary on 1/6, 1/15"; "Burchett: 2 offer change(s); no primary on 1/6; no primary
// lifted on 2/3 (Jan 2027 - Jun 2027)". Days and counts only - no amount, no contact, no reason.
function offersAuditSummary(name, offerCount, np, mode, periodLabel) {
  const days = (v) => (Array.isArray(v) ? v.map(String).filter(suIsIso) : []).sort();
  const adds = days(np && np.add), clears = days(np && np.clear);
  const n = Number(offerCount) || 0;
  const parts = [];
  if (n > 0 || adds.length + clears.length === 0) parts.push(n + " offer change(s)");
  if (adds.length) parts.push("no primary on " + adds.map(fmtMD).join(", "));
  if (clears.length) parts.push("no primary lifted on " + clears.map(fmtMD).join(", "));
  return String(name) + ": " + parts.join("; ") + (mode ? ", mode " + mode : "") + (periodLabel ? " (" + periodLabel + ")" : "");
}
// noPrimaryErrorWords(msg) -> a message starting "NO_PRIMARY_<X>: " (save_no_primary's NP001-NP009, shown verbatim by
// describeDbError) loses the token and gets a capital first letter ("NO_PRIMARY_ON_CALL: Burchett holds primary on 1/6 - ..." ->
// "Burchett holds primary on 1/6 - ..."); any other message comes back unchanged.
function noPrimaryErrorWords(msg) {
  const s = msg === undefined || msg === null ? "" : String(msg);
  const m = /^NO_PRIMARY_[A-Z_]+:\s*/.exec(s);
  if (!m) return s;
  const rest = s.slice(m[0].length);
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : s;
}

/* ═══ Offer deadline notices (Faraz 9/27: "a 6 week warning for choosing shifts so that the new schedule can be produced at least 4-6 weeks before") ═══
 * The reading implemented (docs/SILVIS-CALL-RULES.md section 4, build guide section 17): a period's choices FREEZE
 * closeWeeksBeforeStart (6) weeks before it starts and its schedule is due publishWeeksBeforeStart (4) weeks before it
 * (both as before); a linked surgeon who has not answered for an open period gets an in-app notice starting
 * noticeDaysBeforeClose (42 = six weeks) days BEFORE the freeze, and the notice turns urgent (it joins the Calendar)
 * noticeUrgentDaysBeforeClose (14) days before it. Both are DATA (groupRules.offerPeriods); their defaults live in
 * OP_NOTICE_DEFAULTS, NOT in OP_PERIOD_DEFAULTS - that one stays literally equal to the daily-reminder mirror's
 * OTM_DEFAULTS, and offerTimeline's output (pinned against the mirror) never carries either key: the cron does not
 * read them. The urgent window is its own key since 9/27 (Faraz: the six-week e-mail, remindDaysBeforeClose
 * [42, 14, 3]) - reading the largest reminder offset would have made every notice urgent for all 42 days.
 * Prompt 26 (Faraz 9/30): the notice is a heads-up before the freeze - enter your vacations, painting days is optional,
 * otherwise the schedule follows your rules - for every pool member whatever his status (offerDeadlineNotices); the
 * scheduler's roll call at the freeze names who painted days and who added vacations, everyone else as following
 * their rules (offerFreezeRollcall / offerFreezeWords); offerHeadsUpWords is the first reminder's subject and body.
 * Wording only: offerStatus / offerRollcall (mirrored in the daily-reminder cron) are unchanged.
 * Pure: nothing here reads the clock, the DOM or the network. */
const OP_NOTICE_DEFAULTS = { noticeDaysBeforeClose: 42, noticeUrgentDaysBeforeClose: 14 };
// opNoticeRules(groupRules) -> the numbers the notices read from groupRules.offerPeriods, each absent / junk key
// falling back to its default: noticeDays (>= 0; 0 = no notice), urgentDays = noticeUrgentDaysBeforeClose (>= 0;
// 0 = urgent never; independent of remindDaysBeforeClose, which only drives the cron's e-mails), closeWeeks /
// publishWeeks (> 0, like offerTimeline).
function opNoticeRules(groupRules) {
  const g = groupRules && typeof groupRules === "object" ? groupRules : {};
  const R = g.offerPeriods && typeof g.offerPeriods === "object" ? g.offerPeriods : {};
  const pos = (v, d) => (typeof v === "number" && isFinite(v) && v > 0 ? v : d);
  const nonNeg = (v, d) => (typeof v === "number" && isFinite(v) && v >= 0 ? v : d);
  return {
    rules: R,
    noticeDays: nonNeg(R.noticeDaysBeforeClose, OP_NOTICE_DEFAULTS.noticeDaysBeforeClose),
    urgentDays: nonNeg(R.noticeUrgentDaysBeforeClose, OP_NOTICE_DEFAULTS.noticeUrgentDaysBeforeClose),
    closeWeeks: pos(R.closeWeeksBeforeStart, OP_PERIOD_DEFAULTS.closeWeeksBeforeStart),
    publishWeeks: pos(R.publishWeeksBeforeStart, OP_PERIOD_DEFAULTS.publishWeeksBeforeStart),
  };
}
// offerDeadlineNotices({ periods, offers, personId, poolIds, today, groupRules }) -> one notice per period this person
// is told about now: status upcoming (absent = upcoming), offers_close_at after today (offerPeriodOpen's reading; an
// absent close is start - closeWeeksBeforeStart through offerTimeline) and daysToClose <= noticeDaysBeforeClose.
// Prompt 26 (Faraz 9/30, "vacations in, painting optional"): EVERY pool member gets it, whatever his offerStatus -
// submitted, rules_only and not_started alike (vacations matter for everyone; painting is optional), and the row
// carries that status for the words. poolIds (offerPoolIds of the roster) is the caller's pool: a list that does not
// hold the person answers [] (an outside surgeon is never told); absent = the caller has checked. Several periods
// can be open at once (Jan 2027 and Feb - Apr 2027 on 9/27) - every one gets its notice, earliest freeze first:
// [{ periodId, label, closeAt, daysToClose, startDay, publishBy, urgent, status }] with urgent = daysToClose <=
// noticeUrgentDaysBeforeClose (default 14). [] for a missing person, a non-ISO today or no list.
function offerDeadlineNotices(args) {
  const a = args && typeof args === "object" ? args : {};
  const today = opDay(a.today);
  if (!today || !a.personId || !Array.isArray(a.periods)) return [];
  if (Array.isArray(a.poolIds) && a.poolIds.map(String).indexOf(String(a.personId)) < 0) return [];
  const N = opNoticeRules(a.groupRules);
  const out = [];
  a.periods.forEach(p => {
    if (!p || typeof p !== "object" || !opBounds(p)) return;
    const status = p.status === undefined || p.status === null || p.status === "" ? "upcoming" : String(p.status);
    if (status !== "upcoming") return;
    const t = offerTimeline(p, N.rules);
    if (!t || !(t.offers_close_at > today)) return;
    const daysToClose = suDaysBetween(today, t.offers_close_at);
    if (daysToClose > N.noticeDays) return;
    out.push({ periodId: p.id === undefined || p.id === null ? null : String(p.id), label: String(p.label || ""), closeAt: t.offers_close_at, daysToClose, startDay: t.start_day, publishBy: t.publish_by, urgent: daysToClose <= N.urgentDays, status: offerStatus(p, a.offers, a.personId) });
  });
  return out.sort((x, y) => (x.closeAt !== y.closeAt ? (x.closeAt < y.closeAt ? -1 : 1) : (x.startDay < y.startDay ? -1 : x.startDay > y.startDay ? 1 : 0)));
}
// offerPeriodLeadWarnings({ periods, today, groupRules, openCounts }) -> the scheduler's lead-time warnings for Setup ->
// Generate -> Periods: { periods: { <key>: [warning...] }, next: null | { from, closeBy, daysToClose } }, key = the
// row's id (else its start_day), openCounts = { <key>: open slots from today on inside the period's range } (the
// caller counts them with openSlots over the schedule - the app never flips a status to published, so "still open
// slots" is the only reading of "not built yet"). Warnings per period:
//   short-lead      - status upcoming and offers_close_at later than start - 7 * closeWeeksBeforeStart:
//                     { closeAt, daysBeforeStart, weeksBeforeStart (whole weeks), defaultWeeks }
//   publish-due     - publish_by within 7 days (0..7) while the range still has open slots: { publishBy, daysToPublish, open }
//   publish-passed  - publish_by passed (the period not over) while the range still has open slots: same fields
//   (neither for a period whose status reads published: it has shipped, and the open-shifts board reports its holes)
// next = the next period is not on file: today >= (last period's end + 1) - 7 * closeWeeksBeforeStart -
// noticeDaysBeforeClose; from = that start, closeBy = the freeze it would get from the rules. No periods -> null
// (the empty state says so already). Nothing here reads the clock.
function offerPeriodLeadWarnings(args) {
  const a = args && typeof args === "object" ? args : {};
  const today = opDay(a.today);
  const res = { periods: {}, next: null };
  if (!today || !Array.isArray(a.periods)) return res;
  const N = opNoticeRules(a.groupRules);
  const counts = a.openCounts && typeof a.openCounts === "object" ? a.openCounts : {};
  let lastEnd = null;
  a.periods.forEach(p => {
    const b = opBounds(p);
    if (!b) return;
    if (lastEnd === null || b.end > lastEnd) lastEnd = b.end;
    const key = p.id === undefined || p.id === null || p.id === "" ? b.start : String(p.id);
    const status = p.status === undefined || p.status === null || p.status === "" ? "upcoming" : String(p.status);
    const list = [];
    const close = opDay(p.offers_close_at), pub = opDay(p.publish_by);
    if (status === "upcoming" && close && close > suAddDays(b.start, -7 * N.closeWeeks)) {
      const d = suDaysBetween(close, b.start);
      list.push({ kind: "short-lead", closeAt: close, daysBeforeStart: d, weeksBeforeStart: Math.floor(d / 7), defaultWeeks: N.closeWeeks });
    }
    const open = Number(counts[key]) || 0;
    if (pub && status !== "published" && b.end >= today && open > 0) {
      const d = suDaysBetween(today, pub);
      if (d <= 7) list.push({ kind: d < 0 ? "publish-passed" : "publish-due", publishBy: pub, daysToPublish: d, open });
    }
    if (list.length) res.periods[key] = list;
  });
  if (lastEnd) {
    const from = suAddDays(lastEnd, 1), closeBy = suAddDays(from, -7 * N.closeWeeks);
    if (today >= suAddDays(closeBy, -N.noticeDays)) res.next = { from, closeBy, daysToClose: suDaysBetween(today, closeBy) };
  }
  return res;
}
// offerFreezeRollcall(period, offers, timeOff, ids) -> the scheduler's roll call at the freeze (Prompt 26): offerRollcall's
// rows ({ id, status, offered }, ids order, status unchanged) plus vacations = the person's time_off rows overlapping
// [start_day, end_day] as [{ start, end }] - CLIPPED to the period and MERGED where they overlap or touch (review 9/30: the
// daily-reminder close summary's offersVacationRanges reading, pinned equal in test/edge-functions.test.js); start_date /
// end_date, or start / end as aliases; a row without both ISO dates or ending before it starts is skipped - and kind =
// 'painted' (offered days inside the period), else 'vacations' (none painted, a vacation overlaps), else 'rules'
// (following their rules). [] when the period has no usable dates or ids is not a list.
function offerFreezeRollcall(period, offers, timeOff, ids) {
  const b = opBounds(period);
  if (!b || !Array.isArray(ids)) return [];
  const vac = Object.create(null);
  (Array.isArray(timeOff) ? timeOff : []).forEach(r => {
    if (!r || typeof r !== "object" || !r.person_id) return;
    const s = opDay(r.start_date !== undefined ? r.start_date : r.start), e = opDay(r.end_date !== undefined ? r.end_date : r.end);
    if (!s || !e || e < s || s > b.end || e < b.start) return;
    const k = String(r.person_id), list = vac[k] = vac[k] || [];
    list.push({ start: s < b.start ? b.start : s, end: e > b.end ? b.end : e });
  });
  const merge = (rows) => {
    const sorted = rows.slice().sort((x, y) => (x.start !== y.start ? (x.start < y.start ? -1 : 1) : (x.end < y.end ? -1 : x.end > y.end ? 1 : 0)));
    const out = [];
    sorted.forEach(x => { const last = out.length ? out[out.length - 1] : null; if (last && x.start <= suAddDays(last.end, 1)) { if (x.end > last.end) last.end = x.end; } else out.push({ start: x.start, end: x.end }); });
    return out;
  };
  return offerRollcall(period, offers, ids).map(r => {
    const v = merge(vac[r.id] || []);
    return { id: r.id, status: r.status, offered: r.offered, vacations: v, kind: r.offered > 0 ? "painted" : v.length ? "vacations" : "rules" };
  });
}
// offerFreezeWords(row, audience) -> the roll call's words for one offerFreezeRollcall row: "painted N day(s)",
// "added vacations M/D-M/D, M/D" (a one-day vacation is one date), both joined by " and ", or - neither -
// "following their rules" ("following your rules" when audience is "you"). Never "missing", "not started" or "never
// answered" (Prompt 26). '' for junk.
function offerFreezeWords(row, audience) {
  if (!row || typeof row !== "object") return "";
  const parts = [];
  const n = Number(row.offered) || 0;
  if (n > 0) parts.push("painted " + n + " day" + (n === 1 ? "" : "s"));
  const v = Array.isArray(row.vacations) ? row.vacations.filter(x => x && suIsIso(x.start) && suIsIso(x.end)) : [];
  if (v.length) parts.push("added vacations " + v.map(x => x.start === x.end ? fmtMD(x.start) : fmtMD(x.start) + "-" + fmtMD(x.end)).join(", "));
  return parts.length ? parts.join(" and ") : (audience === "you" ? "following your rules" : "following their rules");
}
// offerFreezeDay(iso) -> the freeze as the heads-up e-mails spell it: "Mon 11/23" (three-letter weekday, M/D without
// leading zeros); the raw string for a non-ISO input.
const OP_DOW3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function offerFreezeDay(iso) {
  const d = opDay(iso);
  if (!d) return String(iso || "");
  return OP_DOW3[new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))).getUTCDay()] + " " + fmtMD(d);
}
// offerHeadsUpWords({ label, closeAt }) -> { subject, body } of the FIRST heads-up reminder to a pool surgeon (Prompt 26,
// Faraz 9/30 - the daily-reminder cron's first e-mail and the Periods "Remind" button say the same):
//   subject "Silvis call - the <label> schedule is built from your rules on <Mon 11/23>"
//   body    "Before <Mon 11/23>, enter your vacations for <label> in the app. If there are days you'd like to work, or
//            can't, paint them too. Otherwise there is nothing to do - the schedule follows your rules."
function offerHeadsUpWords(args) {
  const a = args && typeof args === "object" ? args : {};
  const label = String(a.label || "").trim() || "next period";
  const freeze = offerFreezeDay(a.closeAt);
  return {
    subject: "Silvis call - the " + label + " schedule is built from your rules on " + freeze,
    body: "Before " + freeze + ", enter your vacations for " + label + " in the app. If there are days you'd like to work, or can't, paint them too. Otherwise there is nothing to do - the schedule follows your rules.",
  };
}
// offerPeriodJump(period, today, shown) -> the painter's "Go to <label> (freezes M/D, in N days)" jump, or null.
// Non-null only while `period` is still OPEN for offers (offerPeriodOpen) and the month shown ({ y, m }, m 0-based)
// lies outside it: { label, start, close, days, y, m, text } - y / m = the period's first month (where the button
// jumps), days = today -> offers_close_at. The opening month of the painter is not changed by it (pinned).
function offerPeriodJump(period, today, shown) {
  if (!period || typeof period !== "object" || !suIsIso(today) || !offerPeriodOpen(period, today)) return null;
  const s = String(period.start_day !== undefined ? period.start_day : (period.start !== undefined ? period.start : "")).slice(0, 10);
  const e = String(period.end_day !== undefined ? period.end_day : (period.end !== undefined ? period.end : "")).slice(0, 10);
  if (!suIsIso(s) || !suIsIso(e)) return null;
  const cur = shown && Number.isInteger(shown.y) && Number.isInteger(shown.m) ? shown.y + "-" + String(shown.m + 1).padStart(2, "0") : "";
  if (cur && cur >= s.slice(0, 7) && cur <= e.slice(0, 7)) return null;
  const raw = period.offers_close_at !== undefined ? period.offers_close_at : period.offersCloseAt;
  const c = raw === undefined || raw === null ? "" : String(raw).slice(0, 10);
  const close = suIsIso(c) ? c : null;
  const days = close ? suDaysBetween(today, close) : null;
  const label = String(period.label || (s + " - " + e));
  const text = "Go to " + label + (close ? " (freezes " + fmtMD(close) + ", in " + days + " day" + (days === 1 ? "" : "s") + ")" : "");
  return { label, start: s, close, days, y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)) - 1, text };
}
// vacationLeadNote(start, today, rules) -> { through, weeks, days } when a vacation starting on `start` begins less than
// closeWeeksBeforeStart weeks from today (rules = groupRules.offerPeriods; absent / bad -> OP_PERIOD_DEFAULTS): the
// schedule through `through` (today + weeks * 7 - 1) is already frozen for offers and being built, so the Time off
// form shows an advisory (never a confirm - the add goes through). null otherwise or on a non-ISO date.
function vacationLeadNote(start, today, rules) {
  if (!suIsIso(start) || !suIsIso(today)) return null;
  const R = rules && typeof rules === "object" ? rules : {};
  const w = R.closeWeeksBeforeStart;   // the same rule as offerTimeline's num(): a number > 0, else the default (a "8" string is not)
  const weeks = typeof w === "number" && isFinite(w) && w > 0 ? w : OP_PERIOD_DEFAULTS.closeWeeksBeforeStart;
  const days = suDaysBetween(today, start);
  if (days >= weeks * 7) return null;
  return { through: suAddDays(today, weeks * 7 - 1), weeks, days };
}

/* ═══ Vacation guard (Faraz 9/30, Prompt 27: "a warning when people are taking vacations and a warning that stops vacations
 * if more than 4 people are on vacation. Need at least 2 surgeons around") ═══
 * DATA: groupRules.vacations.minSurgeonsAround - a whole number 0-99; absent / junk -> VACATION_GUARD_DEFAULTS (the
 * OP_NOTICE_DEFAULTS / GROUP_CALL_DEFAULTS pattern: the live blob needs no edit). With six active surgeons and the default
 * 2, at most four are off on any day. Counted per calendar day over the ACTIVE roster surgeons (a roster entry with
 * active !== false and type !== "external" - the app's poolSurgeons). A surgeon is OFF on a day inside one of his time_off
 * rows, or inside one of his East (Davenport) vacation ranges that is not reviewed 'home' - an unreviewed range counts as
 * away, as everywhere else in the app (the caller passes eastAway from eastVacPeople: { id: [{ start, end, state }] }).
 * A vacation is refused when, on a day it takes the person off (he is active and not off that day already - by another
 * row of his or an East vacation; on an edit, the edited row's own days were his already), fewer than minSurgeonsAround
 * would stay around. The database's time_off trigger (time_off_vacation_guard, sql/migrations/2026-09-30-vacation-guard.sql)
 * applies the same rule; vacationGuardMessage builds its VACATION_TOO_FEW_AROUND text, so the client's refusal and the
 * database's read the same. The scheduler may enter one anyway (the client asks him first - confirmText; the trigger lets
 * silvis_is_sched() through). One difference, on the safe side: the client matches a 'home' review to the merged Davenport
 * range exactly (helpers.derivedEastVacations), the trigger reads any 'home' review covering the day - a stale 'home' row
 * of a changed range can only make the database the more lenient of the two, never refuse what the client allowed.
 * Review fixes 10/1: (1) eastReviewsLoaded false (the app: the East review rows are not loaded - eastVacReviewState is not
 * 'ok') - another surgeon's East range does not count toward a refusal (it may be reviewed 'home'; it stays in alsoOff,
 * pending: true, and the scheduler's line says "(East - reviews not loaded)"), the person's own East range still exempts his
 * days (the lenient side); the database's trigger stays authoritative. (6) A range of over ten years (VG_MAX_DAYS) is
 * refused as a typing slip (tooLong) for everyone - the trigger checks every day of any range, so the client may not skip one.
 * Pure: nothing here reads the clock, the DOM or the network. */
const VACATION_GUARD_DEFAULTS = { minSurgeonsAround: 2 };
const VG_CODE = "VACATION_TOO_FEW_AROUND";
const VG_TAIL = " - pick other dates or ask the scheduler";
const VG_MAX_DAYS = 3660;   // a range of over ten years (end - start >= 3660 days) is a typing slip, not a vacation: refused as such (tooLong), never counted day by day
// vacationRules(groupRules) -> { minSurgeonsAround }: a whole number 0-99, anything else (a "2" string, 2.5, -1, absent) -> 2.
function vacationRules(groupRules) {
  const G = groupRules && typeof groupRules === "object" ? groupRules.vacations : null;
  const v = G && typeof G === "object" && !Array.isArray(G) ? G.minSurgeonsAround : undefined;
  return { minSurgeonsAround: typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 99 ? v : VACATION_GUARD_DEFAULTS.minSurgeonsAround };
}
function vgIso(v) { const s = typeof v === "string" ? v.slice(0, 10) : ""; return suIsIso(s) ? s : null; }
// vgDaysLabel(days) -> the ISO days (sorted, unique) as runs of consecutive days: one day "3/18", two "3/18, 3/19", three
// or more "3/18-3/20"; runs joined by ", ". The trigger writes the same (to_char FMMM/FMDD).
function vgDaysLabel(days) {
  const list = Array.from(new Set((Array.isArray(days) ? days : []).filter(suIsIso))).sort();
  const runs = [];
  list.forEach((d) => {
    const last = runs[runs.length - 1];
    if (last && suAddDays(last.e, 1) === d) { last.e = d; last.n++; } else runs.push({ s: d, e: d, n: 1 });
  });
  return runs.map((r) => r.n === 1 ? fmtMD(r.s) : r.n === 2 ? fmtMD(r.s) + ", " + fmtMD(r.e) : fmtMD(r.s) + "-" + fmtMD(r.e)).join(", ");
}
function vgRangeLabel(s, e) { return s === e ? fmtMD(s) : fmtMD(s) + "-" + fmtMD(e); }
// vacationGuardMessage(overDays, activeCount, minAround) -> the database's refusal, word for word:
//   "VACATION_TOO_FEW_AROUND: on 3/18, 3/19 only 1 of 6 surgeons would be around (minimum 2) - pick other dates or ask the scheduler"
// overDays [{ day, around }]: grouped by the count, the groups in the order of their first day, each group's days as
// vgDaysLabel runs ("on 3/18, 3/20 only 1; on 3/19 only 0 of 6 ..."). "" for no day.
function vacationGuardMessage(overDays, activeCount, minAround) {
  const list = (Array.isArray(overDays) ? overDays : []).filter((x) => x && suIsIso(x.day) && typeof x.around === "number")
    .slice().sort((a, b) => a.day < b.day ? -1 : a.day > b.day ? 1 : 0);
  if (!list.length) return "";
  const groups = [];
  list.forEach((x) => { let g = groups.find((gg) => gg.around === x.around); if (!g) { g = { around: x.around, days: [] }; groups.push(g); } g.days.push(x.day); });
  return VG_CODE + ": on " + groups.map((g) => vgDaysLabel(g.days) + " only " + g.around).join("; on ") + " of " + activeCount + " surgeons would be around (minimum " + minAround + ")" + VG_TAIL;
}
// vgMerge(ranges, same?) -> the ranges sorted, overlapping and adjacent ones merged (the first range's other keys kept);
// with same(a, b) only ranges it accepts are merged (the East ranges of one state - an away range never takes an unreviewed
// neighbour's gloss, or the other way round).
function vgMerge(ranges, same) {
  const out = [];
  ranges.slice().sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0).forEach((r) => {
    const last = out.length ? out.filter((x) => typeof same !== "function" || same(x, r)).pop() : null;
    if (last && r.start <= suAddDays(last.end, 1)) { if (r.end > last.end) last.end = r.end; } else out.push(Object.assign({}, r));
  });
  return out.sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
}
// vgTooLongMessage(days) -> the refusal of a range of over ten years (review 10/1 item 6; the client's own words - the
// database has no such refusal, its trigger checks every day): "That range is 3661 days long (over ten years) - check the
// dates; a vacation that long is not saved."
function vgTooLongMessage(days) { return "That range is " + days + " days long (over ten years) - check the dates; a vacation that long is not saved."; }
// vacationGuard({ personId, start, end, timeOffRows, eastAway, roster, groupRules, excludeId, eastReviewsLoaded }) ->
//   { ok, minAround, active, personId, personActive, start, end, eastPending, tooLong,
//     days: [{ day, off: [ids, roster order - the person included when active], around, checked, over }],
//     overDays: [the days with over], fewest, fewestDays: [the days with the fewest around],
//     alsoOff: [{ id, ranges: [{ start, end, east, state?, pending? }] }] - every OTHER active surgeon off on any of the days,
//              with his whole ranges that touch them (time_off rows merged, East ranges apart and merged per state, roster
//              order; pending: an East range shown but NOT counted - eastReviewsLoaded false),
//     message, confirmText }
//   timeOffRows: time_off rows ({ id, person_id, start_date, end_date }); excludeId: the row being edited (left out of the
//   count; when it is the same person's, its own days are not checked - the trigger's NEW-minus-OLD days). eastReviewsLoaded
//   (default true): false = the East review rows are not loaded, so an East range may be reviewed 'home' unseen - another
//   surgeon's East range is then not counted (never a refusal on a guess), the person's own still exempts his days. ok is
//   true with no days for a missing / inverted range; a range of over ten years (end - start >= VG_MAX_DAYS) is ok false,
//   tooLong true, no days, message = vgTooLongMessage, no confirmText (refused for everyone, the scheduler too). Otherwise
//   message = vacationGuardMessage(overDays) ("" when ok); confirmText = the scheduler's question ("... - enter it anyway?").
function vacationGuard(o) {
  const opts = o && typeof o === "object" ? o : {};
  const min = vacationRules(opts.groupRules).minSurgeonsAround;
  const active = (Array.isArray(opts.roster) ? opts.roster : []).filter((r) => r && typeof r === "object" && r.id && r.active !== false && r.type !== "external").map((r) => String(r.id));
  const pid = opts.personId !== undefined && opts.personId !== null && opts.personId !== "" ? String(opts.personId) : null;
  const act = new Set(active);
  const pending = opts.eastReviewsLoaded === false;
  const out = { ok: true, minAround: min, active: active.length, personId: pid, personActive: !!(pid && act.has(pid)), start: null, end: null, eastPending: pending, tooLong: false,
    days: [], overDays: [], fewest: null, fewestDays: [], alsoOff: [], message: "", confirmText: "" };
  const start = vgIso(opts.start), end = vgIso(opts.end);
  if (!start || !end || end < start) return out;
  out.start = start; out.end = end;
  if (suDaysBetween(start, end) >= VG_MAX_DAYS) {
    out.ok = false; out.tooLong = true; out.message = vgTooLongMessage(suDaysBetween(start, end) + 1);
    return out;
  }
  const rows = Array.isArray(opts.timeOffRows) ? opts.timeOffRows : [];
  const exId = opts.excludeId !== undefined && opts.excludeId !== null && opts.excludeId !== "" ? opts.excludeId : null;
  const exRow = exId !== null ? rows.find((r) => r && r.id === exId) : null;
  const exS = exRow && pid && String(exRow.person_id) === pid ? vgIso(exRow.start_date) : null;
  const exE = exS ? (vgIso(exRow.end_date) || exS) : null;
  const src = {};   // active id -> [{ start, end, east, state? }]
  rows.forEach((r) => {
    if (!r || typeof r !== "object" || (exId !== null && r.id === exId)) return;
    const id = r.person_id === undefined || r.person_id === null ? "" : String(r.person_id);
    if (!act.has(id)) return;
    const s = vgIso(r.start_date), e = vgIso(r.end_date) || s;
    if (!s || e < s) return;
    (src[id] = src[id] || []).push({ start: s, end: e, east: false });
  });
  const ea = opts.eastAway && typeof opts.eastAway === "object" && !Array.isArray(opts.eastAway) ? opts.eastAway : {};
  Object.keys(ea).forEach((id) => {
    if (!act.has(id) || !Array.isArray(ea[id])) return;
    ea[id].forEach((r) => {
      if (!r || typeof r !== "object" || r.state === "home") return;
      const s = vgIso(r.start), e = vgIso(r.end);
      if (!s || !e || e < s) return;
      const x = { start: s, end: e, east: true, state: r.state === "away" ? "away" : "unreviewed" };
      if (pending) x.pending = true;
      (src[id] = src[id] || []).push(x);
    });
  });
  // offOn: another surgeon counts as off by a time_off row or a counted East range; selfOn: the person himself is off already
  // by any of his ranges, a pending East range included (it only ever exempts his day - never a refusal on a guess)
  const offOn = (id, d) => (src[id] || []).some((r) => !r.pending && d >= r.start && d <= r.end);
  const selfOn = (id, d) => (src[id] || []).some((r) => d >= r.start && d <= r.end);
  for (let d = start; d <= end; d = suAddDays(d, 1)) {
    const others = active.filter((id) => id !== pid && offOn(id, d));
    const selfOff = out.personActive && selfOn(pid, d);
    const checked = out.personActive && !selfOff && !(exS && d >= exS && d <= exE);
    const off = out.personActive ? active.filter((id) => id === pid || others.indexOf(id) >= 0) : others;
    const around = active.length - off.length;
    out.days.push({ day: d, off, around, checked, over: checked && around < min });
  }
  out.overDays = out.days.filter((x) => x.over);
  out.ok = out.overDays.length === 0;
  out.fewest = out.days.reduce((m, x) => (m === null || x.around < m ? x.around : m), null);
  out.fewestDays = out.days.filter((x) => x.around === out.fewest).map((x) => x.day);
  active.forEach((id) => {
    if (id === pid || !src[id]) return;
    // merged first (a vacation entered as two adjacent rows reads as one), then the ranges that touch the days
    const ranges = vgMerge(src[id].filter((r) => !r.east)).concat(vgMerge(src[id].filter((r) => r.east), (a, b) => a.state === b.state))
      .filter((r) => r.start <= end && r.end >= start)
      .sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
    if (ranges.length) out.alsoOff.push({ id, ranges });
  });
  if (!out.ok) {
    out.message = vacationGuardMessage(out.overDays, active.length, min);
    out.confirmText = out.message.slice(0, out.message.length - VG_TAIL.length) + ". As the scheduler you may still enter it - enter it anyway?";
  }
  return out;
}
// vacationGuardLine(g, nameOf, { mine, personName, showEast }) -> the Time off form's line while a vacation is typed (the
// others in roster order):
//   "Also off: Burchett 3/18-3/20, Acton 3/15-3/21 - after yours, 3 of 6 are around 3/18-3/20"
//   "Nobody else is off then - after Acton's, 5 of 6 are around 3/18-3/20" (entered for someone else: "after <Name>'s")
// " - under the minimum of 2" is appended when the vacation would be refused. showEast (the scheduler only - East details
// are his, Item E3) lists each range as it is and glosses an East one "(East)" / "(East, unreviewed)" / "(East - reviews not
// loaded)" (pending: shown, not counted). Everyone else sees one merged list of days per person - the time_off and counted
// East ranges merged, no East word, a pending East range left out (review 10/1 items 1 and 3). A tooLong guard reads its
// message. "" with no days.
function vacationGuardLine(g, nameOf, opts) {
  if (g && g.tooLong) return g.message || "";
  if (!g || !g.start || !Array.isArray(g.days) || !g.days.length || !g.active) return "";
  const o = opts || {};
  const name = typeof nameOf === "function" ? nameOf : (id) => id;
  const gloss = (r) => !r.east ? "" : r.pending ? " (East - reviews not loaded)" : " (East" + (r.state === "unreviewed" ? ", unreviewed" : "") + ")";
  const others = [];
  (g.alsoOff || []).forEach((a) => {
    const ranges = o.showEast ? (a.ranges || []) : vgMerge((a.ranges || []).filter((r) => !r.pending).map((r) => ({ start: r.start, end: r.end })));
    if (ranges.length) others.push(name(a.id) + " " + ranges.map((r) => vgRangeLabel(r.start, r.end) + (o.showEast ? gloss(r) : "")).join(", "));
  });
  const lead = others.length ? "Also off: " + others.join(", ") : "Nobody else is off then";
  const whose = o.mine ? "after yours" : "after " + (o.personName || name(g.personId)) + "'s";
  return lead + " - " + whose + ", " + g.fewest + " of " + g.active + " " + (g.fewest === 1 ? "is" : "are") + " around " + vgDaysLabel(g.fewestDays) + (g.ok ? "" : " - under the minimum of " + g.minAround);
}
// vacationGuardOverride(g) -> what a scheduler's override leaves behind (review 10/1 item 5: the audit row's
// detail.vacation_guard_override and the toast) - the short days and the count:
//   { days: "3/18, 3/19", around: 1, active: 6, minimum: 2 }   (around = the fewest around on those days)
// null when nothing was overridden (an ok guard, a tooLong one - never overridable - or no over-limit day).
function vacationGuardOverride(g) {
  if (!g || g.ok || g.tooLong || !Array.isArray(g.overDays) || !g.overDays.length) return null;
  return { days: vgDaysLabel(g.overDays.map((x) => x.day)), around: g.overDays.reduce((m, x) => Math.min(m, x.around), g.active), active: g.active, minimum: g.minAround };
}
// vacationGuardOverrideText(ov) -> "under the minimum on 3/18, 3/19 (1 of 6 around, minimum 2)"; "" for null.
function vacationGuardOverrideText(ov) {
  if (!ov || typeof ov !== "object") return "";
  return "under the minimum on " + ov.days + " (" + ov.around + " of " + ov.active + " around, minimum " + ov.minimum + ")";
}
// tradesWaitingOn(rows, personId, today, tagOf) -> the PENDING trade / give proposals addressed to personId (the ones only
// they can answer: Accept / Decline), ONE row per proposal, in the order given. [] without a person. With `tagOf` (the
// app's tradeUnitTag: { kind, start, n } off a row's unit stamp), the rows of a weekend-block / holiday-unit proposal (same
// tag, parties and role - the app's tradeGroupOf, which Accept / Decline act on) collapse to their earliest-day row, placed
// where the proposal first appears (Faraz 9/27: one row and one badge count per proposal). With an ISO `today`, a
// proposal with any row whose day or return day is before it is left out: the server refuses a member's Accept on it
// (trade_update_guard TRADE_PAST, strict <), so it is not "waiting" - the Pending card still lists it with Decline.
// The Time off & Trades "Waiting on you" block and a surgeon's tab badge read it (the scheduler's badge counts every
// pending proposal group-wide - countPendingProposals, the same one-per-proposal grouping).
// tradeProposalKey(r, tagOf) -> the grouping key of a unit proposal's row (kind|start|n|from|to|role - the app's
// tradeGroupOf, which Accept / Decline act on), or null for a row that is not part of a unit (its own proposal).
function tradeProposalKey(r, tagOf) {
  const tag = r && typeof tagOf === "function" ? tagOf(r) : null;
  return tag ? [tag.kind, tag.start, tag.n, r.from_surgeon_id, r.to_surgeon_id, r.role].join("|") : null;
}
// countPendingProposals(rows, tagOf) -> how many PENDING trade / give proposals the rows hold, ONE per proposal (Faraz 9/27:
// a weekend or holiday unit is one badge count): the pending rows of a unit (tradeProposalKey) count once, every other
// pending row counts 1. The scheduler's Time off tab badge (every pending proposal group-wide, past days included - the
// Pending card lists them all). 0 for a non-array.
function countPendingProposals(rows, tagOf) {
  if (!Array.isArray(rows)) return 0;
  const keys = new Set();
  let n = 0;
  for (const r of rows) {
    if (!r || r.status !== "pending") continue;
    const k = tradeProposalKey(r, tagOf);
    if (k === null) n++;
    else if (!keys.has(k)) { keys.add(k); n++; }
  }
  return n;
}
function tradesWaitingOn(rows, personId, today, tagOf) {
  if (!personId || !Array.isArray(rows)) return [];
  const t = suIsIso(today) ? today : null;
  const past = (d) => t !== null && suIsIso(String(d || "").slice(0, 10)) && String(d).slice(0, 10) < t;
  const mine = rows.filter(r => r && r.status === "pending" && r.to_surgeon_id === personId);
  const groups = new Map(), order = [];
  mine.forEach((r, i) => {
    const k = tradeProposalKey(r, tagOf) || ("row#" + i);
    if (!groups.has(k)) { groups.set(k, []); order.push(k); }
    groups.get(k).push(r);
  });
  const out = [];
  for (const k of order) {
    const g = groups.get(k);
    if (g.some(r => past(r.day) || (r.return_day && past(r.return_day)))) continue;
    out.push(g.slice().sort((a, b) => String(a.day || "") < String(b.day || "") ? -1 : String(a.day || "") > String(b.day || "") ? 1 : 0)[0]);
  }
  return out;
}
// tradeWaitingUnitLine(group, tag, viewerId, isGive) -> the one line of a unit proposal in "Waiting on you" (rows named -
// the app's tradeNamed - and sorted by day; tag = the head's unit tag). It names the unit and its days from the rows that
// move together (Accept / Decline act on them all); the viewer reads "you" (the receiver always is, in Waiting on you), e.g.
//   give   "Acton offers you primary for the Thanksgiving unit 11/26-11/29 (4 days) - nothing in return"
//   trade  "You would take primary for the Thanksgiving unit 11/26-11/29 (4 days); Acton would take backup 12/3-12/6 (4 days)"
//   one-way "... (one-way - no return shift)". ASCII; "" without rows. `isGive` (a boolean) is the app's whole-proposal
// verdict (tradeIsGiveProposal - every status, as the row's data-kind / status chip read it); without one the pending
// group decides (tradeGroupIsGive).
function tradeWaitingUnitLine(group, tag, viewerId, isGive) {
  const g = (Array.isArray(group) ? group : []).filter(r => r && typeof r === "object" && suIsIso(String(r.day || "").slice(0, 10)));
  if (!g.length) return "";
  const first = g[0], last = g[g.length - 1];
  const name = tag && tag.text ? String(tag.text).split(" unit ")[0] : "";
  const span = (a, b, n) => fmtMD(a) + (n > 1 ? "-" + fmtMD(b) : "") + " (" + n + " day" + (n === 1 ? "" : "s") + ")";
  const unit = (name ? "the " + name + " unit " : "") + span(first.day, last.day, g.length);
  const role = String(first.role || "");
  const toYou = !!viewerId && viewerId === first.to_surgeon_id, fromYou = !!viewerId && viewerId === first.from_surgeon_id;
  const toWord = toYou ? "you" : first.to_surgeon_name;
  const give = typeof isGive === "boolean" ? isGive : tradeGroupIsGive(g);
  if (give) return (fromYou ? "You" : first.from_surgeon_name) + " offer" + (fromYou ? " " : "s ") + toWord + " " + role + " for " + unit + " - nothing in return";
  const ret = g.filter(r => r.return_day && r.return_role).map(r => r).sort((a, b) => a.return_day < b.return_day ? -1 : a.return_day > b.return_day ? 1 : 0);
  const taker = toYou ? "You" : first.to_surgeon_name, backTaker = fromYou ? "you" : first.from_surgeon_name;
  if (!ret.length) return taker + " would take " + role + " for " + unit + " (one-way - no return shift)";
  const back = ret.length === 1 ? slotLabel(ret[0].return_day, ret[0].return_role) : ret[0].return_role + " " + span(ret[0].return_day, ret[ret.length - 1].return_day, ret.length);
  return taker + " would take " + role + " for " + unit + "; " + backTaker + " would take " + back;
}
// offerRulesWords(rules, groupRules) -> plain sentences describing one surgeon's rules, built from the DATA in
// call_schedule_data.data.surgeonRules (no surgeon-specific branch; a key that is absent says nothing). Shown by
// the painter next to "Go by my rules" so the person knows what that means for them. Never carries a note field.
function offerRulesWords(rules, groupRules) {
  const R = rules && typeof rules === "object" ? rules : null;
  const G = groupRules && typeof groupRules === "object" ? groupRules : {};
  const out = [];
  if (!R) return ["No rules of yours are on file - the scheduler places you by the group defaults."];
  // Prompt 23 A (9/30): a pattern's start / end bound it (rules.js matchesPattern ANDs them) - say so, or a dated
  // change (Acton's 2027 outreach days) reads as two contradicting rules.
  const mdy = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || "")); return m ? Number(m[2]) + "/" + Number(m[3]) + "/" + m[1] : String(d || ""); };
  const bounds = (p) => (p.start ? " from " + mdy(p.start) : "") + (p.end ? " until " + mdy(p.end) : "");
  const nthWords = (p) => {
    if (!p || !p.weekday) return "";
    if (p.nth !== undefined && p.nth !== null) return "the " + (Array.isArray(p.nth) ? p.nth : [p.nth]).join("/") + " " + p.weekday + bounds(p);
    if (p.nthWeekOfMonth !== undefined && p.nthWeekOfMonth !== null) return p.weekday + " of week " + p.nthWeekOfMonth + bounds(p);
    if (p.beforeNthMonday !== undefined && p.beforeNthMonday !== null) return p.weekday + " before the " + (Array.isArray(p.beforeNthMonday) ? p.beforeNthMonday : [p.beforeNthMonday]).join("/") + " Monday" + bounds(p);
    return "every " + p.weekday + bounds(p);
  };
  const listOf = (v) => (Array.isArray(v) ? v : []).map(nthWords).filter(Boolean).join(", ");
  const md = (d) => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(d || "")); return m ? Number(m[1]) + "/" + Number(m[2]) : String(d || ""); };
  // Prompt 23 B1 (9/30): the contribution key, said plainly (weekends: Prompt 12 L; weekdays: Prompt 23)
  if (R.primaryContribution === "weekdays") out.push("Preferred: weekday primary (Mon-Thu, or a Friday on its own).");
  else if (R.primaryContribution === "weekends") out.push("Preferred: weekend primary (a full Fri-Sun block).");
  if (R.weekdays && Array.isArray(R.weekdays.allowed) && R.weekdays.allowed.length) out.push("Weekdays: " + R.weekdays.allowed.join(", ") + (R.weekdays.autoOffer ? " (offered automatically when East is clear)" : "") + ".");
  // Prompt 23 B4: with hardNeverWeekdaysNoticeDays the rule is hard only that many days ahead (a soft penalty beyond it).
  // Review 2 (10/1): not "only as a last resort" - beyond the notice the soft +hardNeverBeyondNotice cancels the weekday
  // bonus (net 0 at the default weights): a far Tue/Thu competes with a colleague on equal terms, behind his own Mon/Wed;
  // the weights as rules.js reads them (the group's over the defaults), no penalty named when that weight is 0
  const nd = R.hardNeverWeekdaysNoticeDays;
  const noticeOk = typeof nd === "number" && isFinite(nd) && nd >= 0 && Math.floor(nd) === nd;
  if (Array.isArray(R.hardNeverWeekdays) && R.hardNeverWeekdays.length) out.push("Never " + (Array.isArray(R.hardNeverWeekdaysRoles) && R.hardNeverWeekdaysRoles.length ? R.hardNeverWeekdaysRoles.join("/") + " " : "") + "on " + R.hardNeverWeekdays.join(", ") + (noticeOk ? " within " + nd + " days; allowed further ahead" + (suSumWeights(G).hardNeverBeyondNotice ? ", with a soft penalty" : "") : "") + ".");
  // Prompt 23 B2 / B3. Review (10/1): one sentence for the PRIMARY weekend shapes - with standaloneFriday they are {Fri},
  // {Sat, Sun} and {Fri, Sat, Sun} (rules.js), so the weekendStyle line below then speaks of BACKUP weekends only (it used
  // to say "Weekends: Fri-Sun as one block" beside "a Friday may stand alone").
  const sfOn = R.standaloneFriday === true, nlOn = R.noLoneWeekendDay === true;
  if (sfOn) out.push("Primary weekends: a Friday on its own, Saturday + Sunday, or Fri-Sun" + (nlOn ? " - never a Saturday or Sunday alone" : "") + ".");
  else if (nlOn) out.push("Saturday and Sunday come as a pair (never one alone as primary).");
  const wcap = R.weekendCap;
  if (wcap && typeof wcap === "object" && typeof wcap.perMonth === "number") out.push("At most " + wcap.perMonth + " weekend" + (wcap.perMonth === 1 ? "" : "s") + " a month" + (wcap.countsEast ? ", East weekends included" : "") + " (preferred, not a hard limit).");
  if (Array.isArray(R.recurringAvailable) && R.recurringAvailable.length) out.push("Available on " + listOf(R.recurringAvailable) + ".");
  if (Array.isArray(R.recurringUnavailable) && R.recurringUnavailable.length) out.push("Unavailable on " + listOf(R.recurringUnavailable) + ".");
  if (Array.isArray(R.recurringAvoid) && R.recurringAvoid.length) out.push("Prefer not: " + listOf(R.recurringAvoid) + ".");
  if (Array.isArray(R.availableWindows) && R.availableWindows.length) {
    const t = R.daysPerWindowWeek && typeof R.daysPerWindowWeek.target === "number" ? R.daysPerWindowWeek.target : null;
    out.push("Windows: " + R.availableWindows.map(w => md(w && w.start) + "-" + md(w && w.end)).join(", ") + (t !== null ? " (about " + t + " primary day" + (t === 1 ? "" : "s") + " per window week)" : "") + ".");
  }
  if (Array.isArray(R.availableWeeks) && R.availableWeeks.length) out.push("Listed weeks (Mondays): " + R.availableWeeks.slice(0, 6).map(md).join(", ") + (R.availableWeeks.length > 6 ? " and " + (R.availableWeeks.length - 6) + " more" : "") + ".");
  const wp = R.outsideDerivedWeeks && R.outsideDerivedWeeks.weekdayPattern;
  if (wp && typeof wp === "object") {
    const prim = Object.keys(wp).filter(d => wp[d] && wp[d].primary === true);
    const block = Object.keys(wp).filter(d => wp[d] && wp[d].primary === "weekend-block-only");
    const noBackup = Object.keys(wp).filter(d => wp[d] && wp[d].backup === false);
    out.push("Outside your East weeks: primary on " + (prim.length ? prim.join(", ") : "no weekday") + (block.length ? ", " + block.join("/") + " as one block" : "") + "; backup " + (noBackup.length ? "except " + noBackup.join(", ") : "any day") + ".");
  }
  const ef = R.eastFeed;
  if (ef && ef.enabled) {
    if (ef.eastBlocksPrimary || ef.eastBlocksBackup) out.push("Your East (Davenport) call days block " + [ef.eastBlocksPrimary ? "primary" : null, ef.eastBlocksBackup ? "backup" : null].filter(Boolean).join(" and ") + (ef.forecast ? "; the forecast stands in while Davenport is unpublished" : "") + ".");
    if (ef.deriveFrom || ef.statedWeeks) out.push("Your East weeks derive your Silvis week: East primary week = Silvis backup all week, East backup week = Silvis primary all week.");
  }
  if (R.aledo && Array.isArray(R.aledo.weekdays) && R.aledo.weekdays.length) out.push("Aledo days: " + listOf(R.aledo.weekdays) + (R.aledo.hardAvoidDayBefore ? "; never on call the day before" : "") + ".");
  if (R.weekendStyle) out.push((sfOn ? "Backup weekends: " : "Weekends: ") + (R.weekendStyle === "block" ? "Fri-Sun as one block" : R.weekendStyle === "split" ? "split with a partner" : R.weekendStyle === "daily" ? "one day at a time" : String(R.weekendStyle)) + (R.weekendsAvailable && R.weekendsAvailable.primary === false ? " (backup only)" : "") + ".");
  const cap = R.monthlyCap;
  if (typeof cap === "number") out.push("Cap: " + cap + " primary days a month.");
  else if (cap && typeof cap === "object" && typeof cap.primary === "number") out.push("Cap: " + cap.primary + " primary days a month" + (typeof cap.preferred === "number" ? " (" + cap.preferred + " preferred)" : "") + (cap.countsEastDays ? ", East primary-week days included" : "") + ".");
  else if (cap === null) out.push("No monthly cap of your own.");
  else if (cap === undefined && G.defaultMonthlyCap && typeof G.defaultMonthlyCap.primary === "number") out.push("Cap: the group default of " + G.defaultMonthlyCap.primary + " primary days a month.");
  if (R.backupCap && typeof R.backupCap === "object") out.push("Backup cap: " + [typeof R.backupCap.perMonthDays === "number" ? R.backupCap.perMonthDays + " days" : null, typeof R.backupCap.weekendsPerMonth === "number" ? R.backupCap.weekendsPerMonth + " weekend" + (R.backupCap.weekendsPerMonth === 1 ? "" : "s") : null].filter(Boolean).join(" and ") + " a month.");
  if (typeof R.maxConsecutiveDays === "number") out.push("At most " + R.maxConsecutiveDays + " consecutive primary days" + (typeof R.maxConsecutiveAnyRole === "number" ? " (" + R.maxConsecutiveAnyRole + " in any role)" : "") + ".");
  const hr = R.holidayRules;
  if (hr && Array.isArray(hr.holidaysOff) && hr.holidaysOff.length) out.push("Never on " + hr.holidaysOff.join(", ") + ".");
  if (hr && typeof hr.maxMajorHolidays === "number") out.push("At most " + hr.maxMajorHolidays + " major holiday" + (hr.maxMajorHolidays === 1 ? "" : "s") + " in 12 months.");
  if (R.backupOptOut) out.push("No backup shifts.");
  if (R.preferAlternateDays) out.push("Prefer alternating days.");
  if (!out.length) out.push("No recurring rules of yours are on file - the scheduler places you by the group defaults.");
  return out;
}

/* === Setup > Rules in plain words + the rule field registry (Prompt 24, Faraz 9/30: "the rules section in the
   settings is overwhelming") ===
   suRulesSummary(rules, info) -> [{ family, text }]: one line per rule family, saying what rules.js does with each key
   of ONE surgeonRules entry (and, for the seed lists, what the import does) - engine defaults included: the
   hardNeverWeekdays roles default to primary while backup is open, weekdays.autoOffer and aledo.hardAvoidDayBefore
   default on, eastFeed.eastBackupCountsAsBusy defaults on, an absent monthlyCap is the group default, an absent
   maxConsecutiveDays the group default. Data only: names, holiday names and the group rules come in through `info`
   ({ names: { id: name }, holidayNames: [..], groupRules }); there is no surgeon-specific branch. A key the helper does
   not know (top level, or inside an object it reads) is listed on the "Other" line as not read by the engine - nothing
   is hidden; prose keys (note, notes, rule, source, *Note) are documentation and are skipped. Prompt 23's keys
   (primaryContribution "weekdays", standaloneFriday, noLoneWeekendDay, weekendCap, hardNeverWeekdaysNoticeDays) read as
   that engine reads them. Review 10/1: every day-limiting rule present is described on its own (the engine applies
   them together); a soft term says "(soft)", and a pair of soft terms is read with the group's weights (over the
   engine defaults) - a term whose weight is 0 is off, an allowed weekday's "others first" goes when a weekday
   preference outweighs it; a value the engine reads as medium (not a weight) or ignores (a malformed cap) says so.
   test/data-layer.test.js [P24] cross-checks the Primary / Backup lines against rules.js eligibility. SU_RULE_FIELDS
   (below) is the editor's field registry. */
const SU_SUM_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SU_SUM_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function suSumHas(o, k) { return !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k); }
function suSumObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
function suSumProse(k) { return k === "note" || k === "notes" || k === "rule" || k === "source" || /Note$/.test(k); }
function suSumOrd(n) {
  const v = Number(n);
  if (!Number.isInteger(v)) return String(n);
  const t = v % 100;
  return v + (t >= 11 && t <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[v % 10] || "th");
}
// weekday list -> "Mon/Wed"; a run of three or more -> "Fri-Sun"; a value that is not a weekday is kept as written
function suSumDays(list) {
  const arr = Array.isArray(list) ? list : [];
  const idx = SU_SUM_WEEK.map((d, i) => arr.indexOf(d) >= 0 ? i : -1).filter(i => i >= 0);
  const parts = [];
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++;
    if (j - i >= 2) parts.push(SU_SUM_WEEK[idx[i]] + "-" + SU_SUM_WEEK[idx[j]]);
    else for (let k = i; k <= j; k++) parts.push(SU_SUM_WEEK[idx[k]]);
    i = j + 1;
  }
  arr.forEach(d => { if (SU_SUM_WEEK.indexOf(d) < 0) parts.push(String(d)); });
  return parts.join("/");
}
// 'YYYY-MM-DD' -> "11/2" (withYear: "11/2/2026"); anything else as written
function suSumDate(iso, withYear) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso === undefined || iso === null ? "" : iso));
  return m ? Number(m[2]) + "/" + Number(m[3]) + (withYear ? "/" + m[1] : "") : String(iso);
}
// ['2026-10', '2026-11', '2026-12'] -> "Oct-Dec 2026"; a gap -> "Oct, Dec 2026"; two years -> "Dec 2026, Jan 2027"
function suSumMonths(keys) {
  const good = [], bad = [];
  (Array.isArray(keys) ? keys : []).forEach(k => { const m = /^(\d{4})-(\d{2})$/.exec(String(k)); if (m && +m[2] >= 1 && +m[2] <= 12) good.push(+m[1] * 12 + (+m[2] - 1)); else bad.push(String(k)); });
  const years = [];
  Array.from(new Set(good)).sort((a, b) => a - b).forEach(n => { const y = Math.floor(n / 12); let g = years[years.length - 1]; if (!g || g.y !== y) { g = { y, ms: [] }; years.push(g); } g.ms.push(n % 12); });
  return years.map(g => {
    const runs = [];
    for (let i = 0; i < g.ms.length;) { let j = i; while (j + 1 < g.ms.length && g.ms[j + 1] === g.ms[j] + 1) j++; runs.push(j > i ? SU_SUM_MONTHS[g.ms[i]] + "-" + SU_SUM_MONTHS[g.ms[j]] : SU_SUM_MONTHS[g.ms[i]]); i = j + 1; }
    return runs.join(", ") + " " + g.y;
  }).concat(bad).join(", ");
}
// one recurring pattern (rules.js matchesPattern) in words, its start / end bounds included
function suSumPattern(p) {
  if (!suSumObj(p)) return String(p);
  const lst = (v) => (Array.isArray(v) ? v : [v]).map(suSumOrd).join("/");
  const wd = p.weekday || "day";
  let s;
  if (Array.isArray(p.dates)) s = p.dates.length === 1 ? suSumDate(p.dates[0], true) : p.dates.length + " listed dates";
  else if (p.nth !== undefined && p.nth !== null) s = "the " + lst(p.nth) + " " + wd;
  else if (p.nthWeekOfMonth !== undefined && p.nthWeekOfMonth !== null) s = "the " + wd + " in the week of the " + suSumOrd(p.nthWeekOfMonth) + " " + (p.anchorWeekday || "Wed");
  else if (p.beforeNthMonday !== undefined && p.beforeNthMonday !== null) s = "the " + wd + " before the " + lst(p.beforeNthMonday) + " Mon";
  else s = p.weekday ? "every " + p.weekday : "every day";
  if (p.start && p.end) s += " from " + suSumDate(p.start, true) + " to " + suSumDate(p.end, true);
  else if (p.start) s += " from " + suSumDate(p.start, true);
  else if (p.end) s += " until " + suSumDate(p.end, true);
  return s;
}
// rules.js defaultWeights(), restated (test/data-layer.test.js pins the two equal): the summary reads a weight the way the
// engine does - the group's weights over these defaults - to say when a soft term is off (weight 0) and which of two
// opposite terms wins
const SU_SUM_WEIGHT_DEFAULTS = {
  low: 1, medium: 3, strong: 10, preferred: -1, patternDaily: 5, patternMismatch: 3, backToBackWeekend: 3, backupAfterPrimary: 1,
  noTargetWeekday: 1, eastUnknown: 1, eastForecastBelowThreshold: 2, smoothingTolerance: 2, longRunPerDay: 3, weekendContribution: 3,
  eastClear: 2, offerBonus: 6, outsideOffers: 6, offerBonusOverShare: 0, hardNeverBeyondNotice: 3,
};
function suSumWeights(G) { return Object.assign({}, SU_SUM_WEIGHT_DEFAULTS, suSumObj(G) && suSumObj(G.weights) ? G.weights : {}); }
// a value rules.js resolveWeight reads as given (a number, a weight name, a numeric string); anything else it reads as medium
function suSumWeightOk(w, W) { return (typeof w === "number" && !isNaN(w)) || (typeof w === "string" && (Object.prototype.hasOwnProperty.call(W, w) || !isNaN(parseFloat(w)))); }
function suSumWeight(w, W) {
  if (W && !suSumWeightOk(w, W)) return "medium - the value set is not a weight";
  return typeof w === "number" ? "weight " + w : (typeof w === "string" && w ? w : "medium");
}
function suSumNotice(n) { return n >= 14 && n % 7 === 0 ? (n / 7) + " weeks" : n + " day" + (n === 1 ? "" : "s"); }
function suSumPlural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }
// the keys suRulesSummary knows, per object path ("" = the top level); everything else is "other: <path>"
const SU_SUM_KNOWN = {
  "": ["name", "poolMember", "backupOptOut", "availabilityMode", "weekendStyle", "maxConsecutiveDays", "maxConsecutiveAnyRole", "holidayUnitCountsAsOneDay",
    "primaryContribution", "weekdays", "hardNeverWeekdays", "hardNeverWeekdaysRoles", "hardNeverWeekdaysNoticeDays", "eastFeed", "eastStanding", "monthlyTarget",
    "monthlyCap", "recurringAvailable", "recurringUnavailable", "recurringAvoid", "weekendsAvailable", "explicitAvailable", "explicitBackupOnly", "explicitUnavailable",
    "explicitBackupUnavailable", "explicitListMonths", "offerSources", "offeredDays", "timeOff", "holidayRules", "aledo", "availableWeeks", "availableWeeksFrom",
    "preferences", "backupCap", "outsideDerivedWeeks", "availableWindows", "daysPerWindowWeek", "preferAlternateDays", "weekendBlockPenalty", "handoffPartnerRequired",
    "splitPartner", "standaloneFriday", "noLoneWeekendDay", "weekendCap"],
  weekdays: ["allowed", "autoOffer"],
  eastFeed: ["enabled", "eastBlocksPrimary", "eastBlocksBackup", "eastBackupCountsAsBusy", "forecast", "deriveFrom", "statedWeeks"],
  "eastFeed.statedWeeks": ["eastPrimary", "eastBackup"],
  holidayRules: ["holidaysOff", "neverThanksgiving", "maxMajorHolidays"],
  monthlyCap: ["primary", "total", "preferred", "countsEastDays"],
  monthlyTarget: ["primary", "backup"],
  aledo: ["weekdays", "avoidWholeWeek", "hardAvoidDayBefore"],
  backupCap: ["perMonthDays", "weekendsPerMonth"],
  weekendCap: ["perMonth", "countsEast", "roles", "days", "weight"],
  daysPerWindowWeek: ["target", "countsBackup", "min", "max", "minIsSoft"],
  preferences: ["maxMajorHolidays"],
  weekendsAvailable: ["primary", "backup"],
  outsideDerivedWeeks: ["weekdayPattern", "canBePrimary"],
};
function suRulesUnknownKeys(rules) {
  const out = [];
  const scan = (obj, path) => {
    if (!suSumObj(obj)) return;
    const known = SU_SUM_KNOWN[path];
    Object.keys(obj).forEach(k => {
      if (suSumProse(k)) return;
      const p = path ? path + "." + k : k;
      if (known.indexOf(k) < 0) out.push(p);
      else if (SU_SUM_KNOWN[p]) scan(obj[k], p);
    });
  };
  scan(rules, "");
  return out;
}
const SU_SUM_MODE_WORDS = {
  "weekends-plus-weekdays": "weekends plus listed weekdays",
  "whitelist-recurring": "only listed recurring days (primary)",
  "blacklist-recurring": "every day except listed recurring days",
  "whitelist-weeks": "only listed weeks (primary)",
  "whitelist-windows": "only inside date windows",
  "derived-from-east-plus-weekday-pattern": "East-derived weeks plus a weekday pattern",
};
function suRulesSummary(rules, info) {
  const R = suSumObj(rules) ? rules : {};
  const I = suSumObj(info) ? info : {};
  const G = suSumObj(I.groupRules) ? I.groupRules : {};
  const names = suSumObj(I.names) ? I.names : {};
  const holNames = Array.isArray(I.holidayNames) ? I.holidayNames : [];
  const out = [];
  const line = (family, parts) => { const p = parts.filter(Boolean); if (!p.length) return; const t = p.join("; "); out.push({ family, text: t.charAt(0).toUpperCase() + t.slice(1) + (/\.$/.test(t) ? "" : ".") }); };
  const Wt = suSumWeights(G);
  const backupOpen = !(G.backupPolicy && G.backupPolicy.openToEveryone === false);
  const weekendDays = G.weekendUnit && Array.isArray(G.weekendUnit.days) && G.weekendUnit.days.length ? G.weekendUnit.days : ["Fri", "Sat", "Sun"];
  const wkLabel = suSumDays(weekendDays);
  const ef = suSumObj(R.eastFeed) ? R.eastFeed : null;
  const efOn = !!(ef && ef.enabled);
  const efBlocks = efOn ? [ef.eastBlocksPrimary ? "primary" : null, ef.eastBlocksBackup ? "backup" : null].filter(Boolean) : [];
  const efDerive = efOn && !!(ef.deriveFrom || ef.statedWeeks);
  const hn = Array.isArray(R.hardNeverWeekdays) ? R.hardNeverWeekdays : [];
  const hnRoles = Array.isArray(R.hardNeverWeekdaysRoles) && R.hardNeverWeekdaysRoles.length ? R.hardNeverWeekdaysRoles : (backupOpen ? ["primary"] : ["primary", "backup"]);
  const nd = R.hardNeverWeekdaysNoticeDays;
  const ndOk = typeof nd === "number" && isFinite(nd) && nd >= 0 && Math.floor(nd) === nd;
  // beyond the notice rules.js allows the day with the soft +hardNeverBeyondNotice (none when that weight is 0). Review 2
  // (10/1): "allowed" only while no other day rule of that role could close the day (a recurring list, a weekday pattern,
  // date windows, listed weeks, a governed month - rules.js applies each on its own; the weekday allow-list leaves a
  // never-on day to this rule); with one present the far day is left to those rules
  const neverWords = (otherDayRule) => hn.length ? suSumDays(hn) + (ndOk ? " within " + suSumNotice(nd) + (otherDayRule
    ? (Wt.hardNeverBeyondNotice ? " (further out soft, where the other day rules allow it)" : " (further out left to the other day rules)")
    : " (further out allowed" + (Wt.hardNeverBeyondNotice ? ", soft" : "") + ")") : "") : null;
  const wp = R.outsideDerivedWeeks && suSumObj(R.outsideDerivedWeeks.weekdayPattern) ? R.outsideDerivedWeeks.weekdayPattern : null;
  const wpWhere = efDerive ? "outside East weeks: " : "weekday pattern: ";
  const al = suSumObj(R.aledo) ? R.aledo : null;
  const alDays = al && Array.isArray(al.weekdays) && al.weekdays.length ? al.weekdays.map(suSumPattern).join(", ") : null;
  const alRoles = (G.dayBeforeRules && Array.isArray(G.dayBeforeRules.aledoDayBeforeRoles) && G.dayBeforeRules.aledoDayBeforeRoles) || ["primary"];
  const alDayBefore = !!al && al.hardAvoidDayBefore !== false;
  const windows = Array.isArray(R.availableWindows) ? R.availableWindows : [];
  // governed months (rules.js rdGovernedMonths): a plain entry = primary only while backup is open, an object entry = its roles
  const governed = { primary: [], both: [], backup: [] };
  (Array.isArray(R.explicitListMonths) ? R.explicitListMonths : []).forEach(e => {
    let m, roles;
    if (typeof e === "string") { m = e; roles = backupOpen ? ["primary"] : ["primary", "backup"]; }
    else if (suSumObj(e) && e.month) { m = e.month; roles = Array.isArray(e.roles) && e.roles.length ? e.roles : ["primary", "backup"]; }
    else return;
    const p = roles.indexOf("primary") >= 0, b = roles.indexOf("backup") >= 0;
    (p && b ? governed.both : p ? governed.primary : governed.backup).push(m);
  });

  // Availability: the listed weeks, the windows, the governed months. The mode is a label - rules.js reads only
  // "whitelist-recurring" (the Primary line); the others take their days from the keys below / the other lines, so the
  // mode is named only when nothing backs it (it then changes nothing).
  const av = [];
  const mode = R.availabilityMode;
  if (typeof mode === "string" && mode && mode !== "whitelist-recurring") {
    const backed = mode === "weekends-plus-weekdays" ? !!(suSumObj(R.weekdays) && Array.isArray(R.weekdays.allowed))
      : mode === "blacklist-recurring" ? Array.isArray(R.recurringUnavailable) && R.recurringUnavailable.length > 0
      : mode === "whitelist-weeks" ? Array.isArray(R.availableWeeks) && R.availableWeeks.length > 0
      : mode === "whitelist-windows" ? Array.isArray(R.availableWindows) && R.availableWindows.length > 0
      : mode === "derived-from-east-plus-weekday-pattern" ? efDerive || !!wp
      : null;
    if (backed === null) av.push("mode " + JSON.stringify(mode) + " (not a mode the scheduler knows - no effect)");
    else if (!backed) av.push("set to \"" + SU_SUM_MODE_WORDS[mode] + "\" with nothing listed (no effect)");
  }
  if (Array.isArray(R.availableWeeks) && R.availableWeeks.length) {
    const ws = R.availableWeeks.slice().sort();
    // rules.js: the weeks govern from availableWeeksFrom (that very day) or else the 1st of the first listed week's month
    const from = R.availableWeeksFrom ? suSumDate(R.availableWeeksFrom, true) : suSumMonths([String(ws[0]).slice(0, 7)]);
    av.push("primary only in " + suSumPlural(ws.length, "listed week") + ", " + suSumDate(ws[0], true) + " to the week of " + suSumDate(ws[ws.length - 1], true) + " (from " + from + "; none after)");
  }
  if (windows.length) av.push("only inside " + suSumPlural(windows.length, "date window") + ", both roles: " + windows.slice(0, 4).map(w => suSumDate(w && w.start) + "-" + suSumDate(w && w.end)).join(", ") + (windows.length > 4 ? " and " + (windows.length - 4) + " more" : ""));
  const gov = [governed.primary.length ? suSumMonths(governed.primary) + " (primary)" : null, governed.both.length ? suSumMonths(governed.both) + " (both roles)" : null, governed.backup.length ? suSumMonths(governed.backup) + " (backup)" : null].filter(Boolean);
  if (gov.length) av.push("only the listed days in " + gov.join(", "));
  line("Availability", av);

  // Primary: which days, then what blocks or weighs on them. rules.js applies every day-limiting rule present together -
  // the recurring list, the weekday allow-list, the weekday pattern, the windows, the listed weeks - so each is described
  // on its own (review 10/1: an else-if chain hid an active allow-list / pattern behind a recurring list).
  const pr = [];
  const recA = Array.isArray(R.recurringAvailable) ? R.recurringAvailable : [];
  const recOn = R.availabilityMode === "whitelist-recurring" || recA.length > 0;
  const wa = R.weekendsAvailable;
  const waPrim = wa === true || !!(suSumObj(wa) && wa.primary);
  const wd = suSumObj(R.weekdays) ? R.weekdays : null;
  const nonWk = SU_SUM_WEEK.filter(d => weekendDays.indexOf(d) < 0);
  const hnPrim = hnRoles.indexOf("primary") >= 0;
  if (recOn) pr.push("only " + (recA.length ? recA.map(suSumPattern).join(", ") : "listed recurring days (none listed)") + (waPrim ? " and " + wkLabel : ""));
  if (wd && Array.isArray(wd.allowed)) {
    // a weekday on the never-on list is that rule's, not the allow-list's (rules.js skips it here): open when that rule
    // does not cover primary
    const open = nonWk.filter(d => wd.allowed.indexOf(d) >= 0 || (hn.indexOf(d) >= 0 && !hnPrim));
    // an allowed weekday carries +noTargetWeekday while autoOffer is on; a "weekdays" preference takes -weekendContribution off it
    const net = (wd.autoOffer !== false ? Wt.noTargetWeekday : 0) - (R.primaryContribution === "weekdays" ? Wt.weekendContribution : 0);
    const first = net > 0 ? " (others first on equal terms)" : "";
    if (!recOn) pr.push(open.length ? suSumDays(open) + first + " and " + wkLabel : wkLabel + " only (no weekday allowed)");
    else pr.push(open.length ? "of " + suSumDays(nonWk) + " only " + suSumDays(open) + first : "no " + suSumDays(nonWk) + " (no weekday allowed)");
  }
  if (wp) {
    const yes = [], pref = [], block = [], no = [];
    SU_SUM_WEEK.forEach(d => { const pd = wp[d]; const v = pd ? pd.primary : undefined; if (v === true) { yes.push(d); if (pd.preferred) pref.push(d); } else if (v === "weekend-block-only") block.push(d); else no.push(d); });
    pr.push(wpWhere + [yes.length ? suSumDays(yes) + (pref.length ? " (" + (pref.length === yes.length ? "" : suSumDays(pref) + " ") + "preferred)" : "") : null, block.length ? suSumDays(block) + " only as one block" : null, no.length ? "not " + suSumDays(no) : null].filter(Boolean).join(", "));
  }
  if (windows.length) pr.push("only inside the date windows");
  if (Array.isArray(R.availableWeeks) && R.availableWeeks.length) pr.push("only in the listed weeks");
  if (!pr.length) pr.push("any day");
  const never = [];
  const weeksOn = Array.isArray(R.availableWeeks) && R.availableWeeks.length > 0;
  const neverPrim = neverWords(recOn || !!wp || windows.length > 0 || weeksOn || governed.primary.length > 0 || governed.both.length > 0);
  if (neverPrim && hnPrim) never.push(neverPrim);
  (Array.isArray(R.recurringUnavailable) ? R.recurringUnavailable : []).forEach(p => never.push(suSumPattern(p)));
  if (never.length) pr.push("never " + never.join(", "));
  if (efBlocks.indexOf("primary") >= 0) pr.push("not on East call days");
  if (al && !alDays) pr.push("a clinic-day rule with no clinic day set (no effect)");
  else if (al) {
    const dbPrim = alDayBefore && alRoles.indexOf("primary") >= 0;
    if (dbPrim) pr.push("not the day before a clinic day (" + alDays + ")");
    if (al.avoidWholeWeek) pr.push("avoids clinic weeks (" + suSumWeight(al.avoidWholeWeek, Wt) + ")" + (dbPrim ? "" : " - clinic days " + alDays));
  }
  const avoid = Array.isArray(R.recurringAvoid) ? R.recurringAvoid : [];
  if (avoid.length) pr.push("avoids " + avoid.map(p => suSumPattern(p) + " (" + suSumWeight(p && p.weight ? p.weight : "medium", Wt) + ")").join(", "));
  // primaryContribution: weights.weekendContribution carries both readings; 0 switches the term off
  const wcW = Wt.weekendContribution;
  if (R.primaryContribution === "weekends") pr.push(wcW ? "prefers full " + wkLabel + " primary blocks, weekend backup discouraged (soft)" : "prefers weekends (off - its weight is 0)");
  else if (R.primaryContribution === "weekdays") pr.push(wcW ? "prefers weekdays - " + suSumDays(nonWk) + " or a Friday on its own (soft)" : "prefers weekdays (off - its weight is 0)");
  else if (R.primaryContribution !== undefined && R.primaryContribution !== null && R.primaryContribution !== "") pr.push("prefers " + JSON.stringify(R.primaryContribution) + " (not a value the scheduler knows - ignored)");
  line("Primary", pr);

  // Backup: open to everyone unless a rule says otherwise
  const bk = [];
  if (R.backupOptOut === true) bk.push("never (does not take backup)");
  else {
    if (!backupOpen) bk.push("the primary day rules apply to backup too (group setting)");
    // backup: windows, the pattern and a governed month's backup mask close days for backup; the recurring list and the
    // listed weeks only while backup is not open to everyone (rules.js isPrimary)
    const neverBk = neverWords(!!wp || windows.length > 0 || governed.both.length > 0 || governed.backup.length > 0 || (!backupOpen && (recOn || weeksOn)));
    if (neverBk && hnRoles.indexOf("backup") >= 0) bk.push("never " + neverBk);
    if (wp) {
      const noB = [], blockB = [];
      SU_SUM_WEEK.forEach(d => { const pd = wp[d]; const v = pd ? pd.backup : undefined; if (v === "weekend-block-only") blockB.push(d); else if (v !== true) noB.push(d); });
      if (blockB.length) bk.push(wpWhere + suSumDays(blockB) + " only as one block");
      if (noB.length) bk.push(wpWhere + "not " + suSumDays(noB));
    }
    if (windows.length) bk.push("only inside the date windows");
    if (governed.both.length || governed.backup.length) bk.push("only the listed days in " + suSumMonths(governed.both.concat(governed.backup)));
    if (efBlocks.indexOf("backup") >= 0) bk.push("not on East call days");
    if (al && alDays && alDayBefore && alRoles.indexOf("backup") >= 0) bk.push("not the day before a clinic day");
    if (!bk.length) bk.push("any day");
    const bc = suSumObj(R.backupCap) ? R.backupCap : null;
    if (bc) {
      const b = [typeof bc.perMonthDays === "number" ? suSumPlural(bc.perMonthDays, "day") : null, typeof bc.weekendsPerMonth === "number" ? suSumPlural(bc.weekendsPerMonth, "weekend") : null].filter(Boolean);
      if (b.length) bk.push("at most " + b.join(" and ") + " a month");
    }
  }
  line("Backup", bk);

  // Weekends
  const wk = [];
  // the style is soft (+weights.patternMismatch on a shape that does not fit); "daily" only makes a lone weekend day
  // carry no style penalty (rules.js memberPen 0 - it does not make single days preferred). Under standaloneFriday the
  // style governs the BACKUP weekends only (his primary shapes {Fri}, {Sat, Sun}, {Fri, Sat, Sun} carry no mismatch).
  const sf = R.standaloneFriday === true;
  const STYLE = { block: "prefers one " + wkLabel + " block", split: "prefers a split, Fri+Sun / Sat", daily: "a lone weekend day is fine", "saturday-only": "Saturday only (older setting)" };
  const wsty = R.weekendStyle;
  if (wsty) {
    if (!STYLE[wsty]) wk.push("style " + JSON.stringify(wsty) + " (not a style the scheduler knows)");
    else if (wsty === "block" || wsty === "split") wk.push(STYLE[wsty] + " (" + (sf ? "backup, " : "") + "soft)");
    else wk.push(STYLE[wsty] + (sf && wsty === "daily" ? " (backup)" : ""));
  }
  if (R.standaloneFriday === true) wk.push("a Friday may stand alone (primary)");
  if (R.noLoneWeekendDay === true) wk.push("never a lone Saturday or Sunday (primary)");
  const wc = R.weekendCap;
  if (wc !== undefined && wc !== null) {
    const roles = suSumObj(wc) && wc.roles !== undefined ? wc.roles : ["primary"];
    const days = suSumObj(wc) && wc.days !== undefined ? wc.days : ["Sat", "Sun"];
    const okCap = suSumObj(wc) && typeof wc.perMonth === "number" && wc.perMonth >= 0 && Math.floor(wc.perMonth) === wc.perMonth
      && Array.isArray(roles) && roles.length && roles.every(r => r === "primary" || r === "backup")
      && Array.isArray(days) && days.length && days.every(d => d === "Fri" || d === "Sat" || d === "Sun")
      && (wc.countsEast === undefined || typeof wc.countsEast === "boolean")
      // rules.js drops the whole cap on a weight that is neither a finite number nor a weight name / numeric string
      && (wc.weight === undefined || (typeof wc.weight === "number" && isFinite(wc.weight)) || (typeof wc.weight === "string" && (Object.prototype.hasOwnProperty.call(Wt, wc.weight) || !isNaN(parseFloat(wc.weight)))));
    if (!okCap) wk.push("a weekend cap that is not well formed (ignored)");
    else wk.push("at most " + suSumPlural(wc.perMonth, "weekend") + " a month" + (roles.length === 1 && roles[0] === "primary" ? "" : " (" + roles.join(" or ") + ")") + (wc.countsEast === true ? ", East weekends included" : "") + (days.length === 2 && days.indexOf("Sat") >= 0 && days.indexOf("Sun") >= 0 ? "" : ", counting " + suSumDays(days)) + " (soft" + (wc.weight === undefined || wc.weight === "strong" ? "" : ", " + suSumWeight(wc.weight)) + ")");
  }
  // rules.js applies any value but undefined / null - one it cannot read as a weight ("" included) as medium, with a warning
  if (R.weekendBlockPenalty !== undefined && R.weekendBlockPenalty !== null) wk.push("blocks and splits discouraged (" + suSumWeight(R.weekendBlockPenalty, Wt) + ")");
  if (wa && !(R.availabilityMode === "whitelist-recurring" || recA.length)) wk.push("weekend availability set (used only with a recurring list)");
  if (R.splitPartner) wk.push("split partner " + (names[R.splitPartner] || R.splitPartner) + " (recorded only)");
  line("Weekends", wk);

  // Limits
  const lim = [];
  const mcd = typeof R.maxConsecutiveDays === "number" ? R.maxConsecutiveDays : null;
  const dmc = typeof G.defaultMaxConsecutiveDays === "number" ? G.defaultMaxConsecutiveDays : 2;
  lim.push("at most " + (mcd !== null ? mcd : dmc) + " " + (G.countBackupInConsecutive ? "days on call" : "primary days") + " in a row" + (mcd === null ? " (group default)" : "") + (R.holidayUnitCountsAsOneDay === true ? " (a holiday unit counts as one)" : "") + (typeof R.maxConsecutiveAnyRole === "number" ? ", " + R.maxConsecutiveAnyRole + " in any role (soft)" : ""));
  const dcap = suSumObj(G.defaultMonthlyCap) ? (typeof G.defaultMonthlyCap.primary === "number" ? G.defaultMonthlyCap.primary : typeof G.defaultMonthlyCap.total === "number" ? G.defaultMonthlyCap.total : null) : null;
  const capWords = (n) => "cap " + n + " primary days a month";
  if (!suSumHas(R, "monthlyCap")) lim.push(dcap !== null ? capWords(dcap) + " (group default)" : "no monthly cap");
  else if (R.monthlyCap === null) lim.push("no monthly cap");
  else if (typeof R.monthlyCap === "number") lim.push(capWords(R.monthlyCap));
  else if (R.monthlyCap && typeof R.monthlyCap === "object") {
    const mc = R.monthlyCap;
    const own = typeof mc.primary === "number" ? mc.primary : typeof mc.total === "number" ? mc.total : null;
    const c = own !== null ? own : dcap;
    lim.push((c !== null ? capWords(c) + (own === null ? " (group default)" : "") : "no hard monthly cap") + (typeof mc.preferred === "number" ? ", " + mc.preferred + " preferred" : "") + (mc.countsEastDays === true || mc.countsEastDays === "distinct-days" ? ", East primary-week days count" : ""));
  } else lim.push("a monthly cap that is not a number (invalid - no cap applied)"); // rules.js: a string / boolean cap leaves no cap at all
  const mt = R.monthlyTarget;
  // generator.js genTargetOverride: a number = the primary target, an object = its numeric roles, anything else = none
  const mtP = suSumObj(mt) && typeof mt.primary === "number" ? mt.primary : null, mtB = suSumObj(mt) && typeof mt.backup === "number" ? mt.backup : null;
  if (mt !== undefined && mt !== null && typeof mt !== "number" && mtP === null && mtB === null) lim.push("a monthly target without a number (ignored)");
  if (typeof mt === "number") lim.push("target " + mt + " primary days a month");
  else if (mtP !== null || mtB !== null) lim.push("target " + [mtP !== null ? mtP + " primary" : null, mtB !== null ? mtB + " backup" : null].filter(Boolean).join(" / ") + " days a month");
  else if (R.poolMember === false) lim.push("no share target");
  else if (!windows.length) lim.push("equal share");
  const dpw = R.daysPerWindowWeek;
  if (suSumObj(dpw)) {
    if (typeof dpw.target === "number") lim.push("about " + dpw.target + " " + (dpw.countsBackup === true ? "days" : "primary days") + " per window week (soft)");
    else lim.push("days per window week without a target (no effect)");
    if (["min", "max", "minIsSoft"].some(k => suSumHas(dpw, k))) lim.push("old window-week min / max ignored");
  }
  if (R.preferAlternateDays === true) lim.push("prefers alternate days (soft)");
  if (R.handoffPartnerRequired === true) lim.push("flags a primary with no handoff the next day (report only)");
  line("Limits", lim);

  // East / Davenport
  const ea = [];
  if (ef && !efOn) ea.push("East feed off");
  if (efOn) {
    // east-feed.js (the busy-day derivation): in a week the Davenport group is backup, the surgeon's own shifts count as busy
    // (never the whole week) unless eastBackupCountsAsBusy is false
    ea.push(efBlocks.length ? "East call days block " + efBlocks.join(" and ") + (ef.eastBackupCountsAsBusy === false ? " (shifts in East backup weeks do not count)" : " (shifts in East backup weeks count)") : "East call days block no role");
    if (ef.forecast && efBlocks.length) ea.push("the East forecast stands in while Davenport is unpublished");
    if (efDerive) {
      ea.push("Silvis weeks follow East" + (ef.deriveFrom ? " from " + suSumDate(ef.deriveFrom, true) : "") + ": East primary week = Silvis backup, East backup week = Silvis primary");
      const sw = suSumObj(ef.statedWeeks) ? ef.statedWeeks : null;
      const st = sw ? [Array.isArray(sw.eastPrimary) && sw.eastPrimary.length ? "East primary " + sw.eastPrimary.map(d => suSumDate(d)).join(", ") : null, Array.isArray(sw.eastBackup) && sw.eastBackup.length ? "East backup " + sw.eastBackup.map(d => suSumDate(d)).join(", ") : null].filter(Boolean) : [];
      if (st.length) ea.push("stated weeks: " + st.join("; "));
    }
  }
  const standing = Array.isArray(R.eastStanding) ? R.eastStanding.filter(e => suSumObj(e) && e.name && Array.isArray(e.days) && e.days.length) : [];
  if (standing.length) ea.push("on East call every year: " + standing.map(e => e.name + " (" + e.days.map(md => { const m = /^(\d{2})-(\d{2})$/.exec(String(md)); return m ? Number(m[1]) + "/" + Number(m[2]) : String(md); }).join(", ") + ")").join(", ") + (efBlocks.length ? "" : " - ignored while the East feed blocks no role"));
  line("East / Davenport", ea);

  // Holidays
  const ho = [];
  const hr = suSumObj(R.holidayRules) ? R.holidayRules : {};
  const off = (Array.isArray(hr.holidaysOff) ? hr.holidaysOff : []).slice();
  if (hr.neverThanksgiving === true && off.indexOf("Thanksgiving") < 0) off.push("Thanksgiving");
  // rules.js holiday-opt-out is hard for EVERY role on the unit's days; a standing East day blocks the roles the East feed blocks
  if (off.length) ho.push("never covers " + off.join(", ") + " (primary or backup)");
  const mm = typeof hr.maxMajorHolidays === "number" ? hr.maxMajorHolidays : (suSumObj(R.preferences) && typeof R.preferences.maxMajorHolidays === "number" ? R.preferences.maxMajorHolidays : null);
  if (mm !== null) ho.push("at most " + suSumPlural(mm, "major holiday") + " in 12 months");
  if (efBlocks.length) standing.filter(e => holNames.indexOf(e.name) >= 0).forEach(e => ho.push(off.indexOf(e.name) >= 0 ? "the standing East call also rules out " + e.name + " " + efBlocks.join(" and ") : "no " + e.name + " " + efBlocks.join(" or ") + " (standing East call)"));
  line("Holidays", ho);

  // Seed lists: the seed IMPORT (importer.js) reads these from the seed file - the copies here are read by nothing. It
  // writes availability rows (available / backup only / unavailable / no backup) and the vacations; with offer periods
  // on (the CLI's setting) the tagged lists' days inside a period become offers - an available list's days INSTEAD of
  // available rows; offered days are never availability rows (untagged, they are not imported at all).
  const monthsOf = (v) => suSumObj(v) ? Object.keys(v).filter(k => !suSumProse(k)) : [];
  const rowsOf = [["explicitAvailable", "available"], ["explicitBackupOnly", "backup only"], ["explicitUnavailable", "unavailable"], ["explicitBackupUnavailable", "no backup"]].map(([k, w]) => { const m = monthsOf(R[k]); return m.length ? w + " " + suSumMonths(m) : null; }).filter(Boolean);
  const imp = [];
  if (rowsOf.length) imp.push("availability rows (" + rowsOf.join(", ") + ")");
  if (Array.isArray(R.timeOff) && R.timeOff.length) imp.push(suSumPlural(R.timeOff.length, "vacation"));
  const src = suSumObj(R.offerSources) ? R.offerSources : {};
  const tagAvail = monthsOf(src.explicitAvailable), tagOffered = monthsOf(src.offeredDays);
  const offerParts = [tagAvail.length ? "the available days of " + suSumMonths(tagAvail) + " become offers instead" : null, tagOffered.length ? "the offered days of " + suSumMonths(tagOffered) + " become offers" : null, suSumHas(src, "availableWeeks") ? "the listed weeks become offers" : null].filter(Boolean);
  const untagged = monthsOf(R.offeredDays).filter(m => tagOffered.indexOf(m) < 0);
  const slText = [imp.length ? imp.join(", ") : null, offerParts.length ? "with offer periods on, " + offerParts.join(", ") : null, untagged.length ? "offered days of " + suSumMonths(untagged) + " (not imported - no offer tag)" : null].filter(Boolean);
  if (slText.length) line("Seed lists", ["read by the seed import, not the scheduler: " + slText.join("; ")]);

  // a key this helper does not know is one rules.js does not read either (SU_SUM_KNOWN lists every key it reads)
  const unknown = suRulesUnknownKeys(R);
  if (unknown.length) out.push({ family: "Other", text: unknown.join(", ") + " (not read by the engine)" });
  return out;
}

// --- The Setup > Rules field registry (Prompt 24). Groups in display order; each field owns key paths (dot paths),
// used(rules) = the key is present with a value other than its default (an explicit false / null / "" that means the
// same as no key counts as unused - the key stays in the data untouched), start = what "Add a rule" writes (the value the
// old checkbox wrote; undefined = the field only appears, nothing is written until it is filled). Removing a rule
// deletes its paths (an emptied parent object goes too), so it returns to the menu.
// (review 10/1: the order the task lists them - availability, weekdays and patterns, weekends, limits, East / Davenport,
// holidays, backup - for the menu and the panel alike)
const SU_RULE_GROUPS = [
  { id: "availability", label: "Availability" },
  { id: "patterns", label: "Weekdays and patterns" },
  { id: "weekends", label: "Weekends" },
  { id: "limits", label: "Limits" },
  { id: "east", label: "East / Davenport" },
  { id: "holidays", label: "Holidays" },
  { id: "backup", label: "Backup" },
];
const suRfList = (v) => Array.isArray(v) && v.length > 0;
const suRfObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const suRfSet = (v) => v !== undefined && v !== null && v !== "";
const SU_RULE_FIELDS = [
  { id: "availabilityMode", group: "availability", label: "Availability mode", paths: ["availabilityMode"], used: r => suRfSet(r.availabilityMode) },
  { id: "availableWeeks", group: "availability", label: "Listed weeks", paths: ["availableWeeks", "availableWeeksFrom"], used: r => suRfList(r.availableWeeks) || suRfSet(r.availableWeeksFrom) },
  { id: "availableWindows", group: "availability", label: "Date windows", paths: ["availableWindows"], used: r => suRfList(r.availableWindows) },
  { id: "daysPerWindowWeek", group: "availability", label: "Days per window week", paths: ["daysPerWindowWeek"], used: r => suRfObj(r.daysPerWindowWeek), start: { target: 2, countsBackup: false } },
  { id: "weekdays", group: "patterns", label: "Weekdays allowed (primary)", paths: ["weekdays"], used: r => suRfObj(r.weekdays), start: { allowed: [], autoOffer: true } },
  { id: "hardNeverWeekdays", group: "patterns", label: "Never on (weekdays)", paths: ["hardNeverWeekdays", "hardNeverWeekdaysRoles", "hardNeverWeekdaysNoticeDays"], used: r => suRfList(r.hardNeverWeekdays) || suRfSet(r.hardNeverWeekdaysNoticeDays) },
  { id: "recurringAvailable", group: "patterns", label: "Recurring days available (primary)", paths: ["recurringAvailable"], used: r => suRfList(r.recurringAvailable) },
  { id: "recurringUnavailable", group: "patterns", label: "Recurring days off (primary)", paths: ["recurringUnavailable"], used: r => suRfList(r.recurringUnavailable) },
  { id: "recurringAvoid", group: "patterns", label: "Recurring days to avoid (soft)", paths: ["recurringAvoid"], used: r => suRfList(r.recurringAvoid) },
  { id: "outsideDerivedWeeks", group: "patterns", label: "Weekday pattern outside East weeks", paths: ["outsideDerivedWeeks"], used: r => suRfObj(r.outsideDerivedWeeks), start: { canBePrimary: true, weekdayPattern: {} } },
  { id: "aledo", group: "patterns", label: "Clinic days (the day before is blocked)", paths: ["aledo"], used: r => suRfObj(r.aledo), start: { weekdays: [], avoidWholeWeek: "strong", hardAvoidDayBefore: true } },
  { id: "weekendStyle", group: "weekends", label: "Weekend style", paths: ["weekendStyle"], used: r => suRfSet(r.weekendStyle) },
  { id: "primaryContribution", group: "weekends", label: "Prefers weekends or weekdays", paths: ["primaryContribution"], used: r => suRfSet(r.primaryContribution) },
  { id: "standaloneFriday", group: "weekends", label: "A Friday may stand alone", paths: ["standaloneFriday"], used: r => r.standaloneFriday === true, start: true },
  { id: "noLoneWeekendDay", group: "weekends", label: "No lone Saturday or Sunday", paths: ["noLoneWeekendDay"], used: r => r.noLoneWeekendDay === true, start: true },
  { id: "weekendCap", group: "weekends", label: "Weekends per month", paths: ["weekendCap"], used: r => suRfObj(r.weekendCap), start: { perMonth: 2 } },
  // rules.js applies any value but undefined / null ("" as medium, with a warning) - so "" is in use too
  { id: "weekendBlockPenalty", group: "weekends", label: "Discourage multi-day weekends", paths: ["weekendBlockPenalty"], used: r => r.weekendBlockPenalty !== undefined && r.weekendBlockPenalty !== null },
  { id: "weekendsAvailable", group: "weekends", label: "Weekends under the recurring list", paths: ["weekendsAvailable"], used: r => !!r.weekendsAvailable, start: { primary: true, backup: true } },
  { id: "splitPartner", group: "weekends", label: "Split partner", paths: ["splitPartner"], used: r => suRfSet(r.splitPartner) },
  { id: "maxConsecutiveDays", group: "limits", label: "Most primary days in a row", paths: ["maxConsecutiveDays"], used: r => typeof r.maxConsecutiveDays === "number" },
  { id: "maxConsecutiveAnyRole", group: "limits", label: "Most days in a row, any role", paths: ["maxConsecutiveAnyRole"], used: r => typeof r.maxConsecutiveAnyRole === "number" },
  { id: "holidayUnitCountsAsOneDay", group: "limits", label: "A holiday unit counts as one day", paths: ["holidayUnitCountsAsOneDay"], used: r => r.holidayUnitCountsAsOneDay === true, start: true },
  { id: "monthlyTarget", group: "limits", label: "Monthly target", paths: ["monthlyTarget"], used: r => typeof r.monthlyTarget === "number" || suRfObj(r.monthlyTarget) },
  { id: "monthlyCap", group: "limits", label: "Monthly cap", paths: ["monthlyCap"], used: r => suSumHas(r, "monthlyCap") },
  { id: "preferAlternateDays", group: "limits", label: "Prefers alternate days", paths: ["preferAlternateDays"], used: r => r.preferAlternateDays === true, start: true },
  { id: "handoffPartnerRequired", group: "limits", label: "Flag a missing handoff", paths: ["handoffPartnerRequired"], used: r => r.handoffPartnerRequired === true, start: true },
  { id: "eastFeed", group: "east", label: "East (Davenport) call", paths: ["eastFeed"], used: r => suRfObj(r.eastFeed), start: { enabled: true } },
  { id: "holidaysOff", group: "holidays", label: "Never covers", paths: ["holidayRules.holidaysOff", "holidayRules.neverThanksgiving"], used: r => suRfObj(r.holidayRules) && (suRfList(r.holidayRules.holidaysOff) || r.holidayRules.neverThanksgiving === true) },
  { id: "maxMajorHolidays", group: "holidays", label: "Most major holidays in 12 months", paths: ["holidayRules.maxMajorHolidays", "preferences.maxMajorHolidays"], used: r => (suRfObj(r.holidayRules) && typeof r.holidayRules.maxMajorHolidays === "number") || (suRfObj(r.preferences) && typeof r.preferences.maxMajorHolidays === "number") },
  { id: "backupOptOut", group: "backup", label: "Does not take backup", paths: ["backupOptOut"], used: r => r.backupOptOut === true, start: true },
  { id: "backupCap", group: "backup", label: "Backup caps", paths: ["backupCap"], used: r => suRfObj(r.backupCap) },
];
// Known keys with no form field: shown in plain words under the fields, edited as JSON (Advanced).
const SU_RULE_JSON_ONLY = [
  ["explicitListMonths", "months a dated list governs"], ["explicitAvailable", "seed list: available days"], ["explicitBackupOnly", "seed list: backup-only days"],
  ["explicitUnavailable", "seed list: unavailable days"], ["explicitBackupUnavailable", "seed list: no-backup days"], ["offeredDays", "seed list: offered days"],
  ["offerSources", "offer sources"], ["timeOff", "seed vacations"], ["eastStanding", "standing East days"],
];
function suRuleField(id) { return SU_RULE_FIELDS.find(f => f.id === id) || null; }
function suRuleFieldsUsed(rules) { const r = suRfObj(rules) ? rules : {}; return SU_RULE_FIELDS.filter(f => { try { return !!f.used(r); } catch (e) { return false; } }).map(f => f.id); }
function suRulePathHas(rules, path) {
  let o = rules;
  const parts = String(path).split(".");
  for (let i = 0; i < parts.length; i++) { if (!suRfObj(o) || !Object.prototype.hasOwnProperty.call(o, parts[i])) return false; o = o[parts[i]]; }
  return true;
}
function suRuleFieldHasKeys(field, rules) { return !!field && field.paths.some(p => suRulePathHas(rules, p)); }
// a copy of `rules` with the field's start value written (nothing written for a field without one)
function suRuleFieldAdd(field, rules) {
  const n = suRfObj(rules) ? JSON.parse(JSON.stringify(rules)) : {};
  if (!field || field.start === undefined) return n;
  const parts = field.paths[0].split(".");
  let o = n;
  for (let i = 0; i < parts.length - 1; i++) { if (!suRfObj(o[parts[i]])) o[parts[i]] = {}; o = o[parts[i]]; }
  o[parts[parts.length - 1]] = JSON.parse(JSON.stringify(field.start));
  return n;
}
// a copy of `rules` without the field's paths; a parent object the removal empties goes too
function suRuleFieldRemove(field, rules) {
  const n = suRfObj(rules) ? JSON.parse(JSON.stringify(rules)) : {};
  if (!field) return n;
  field.paths.forEach(p => {
    const parts = p.split(".");
    const chain = [n];
    for (let i = 0; i < parts.length - 1; i++) { const nx = chain[i][parts[i]]; if (!suRfObj(nx)) return; chain.push(nx); }
    delete chain[chain.length - 1][parts[parts.length - 1]];
    for (let i = chain.length - 1; i > 0; i--) { if (Object.keys(chain[i]).length) break; delete chain[i - 1][parts[i - 1]]; }
  });
  return n;
}
// Review 10/1: what Remove would delete beyond the field's start value, in plain words - [] when the field holds nothing
// more than what Add writes (or nothing at all), so Remove asks first only when data would go (an East rule holds the
// stated weeks that derive locked East weeks; a recurring list, clinic days, listed weeks the field may not show whole).
// Sub-keys read through SU_RULE_KEY_WORDS (a key not in it: its camel case spelled out); prose keys read "notes".
const SU_RULE_KEY_WORDS = {
  hardNeverWeekdaysRoles: "applies to", hardNeverWeekdaysNoticeDays: "hard only within (days)", availableWeeksFrom: "weeks govern from",
  "holidayRules.neverThanksgiving": "Thanksgiving off", "preferences.maxMajorHolidays": "most major holidays (older place)",
  allowed: "weekdays allowed", autoOffer: "others go first", enabled: "applies", eastBlocksPrimary: "East call days block primary",
  eastBlocksBackup: "East call days block backup", eastBackupCountsAsBusy: "East backup weeks count", forecast: "uses the forecast",
  deriveFrom: "derive Silvis weeks from", statedWeeks: "stated weeks", eastPrimary: "stated East primary weeks", eastBackup: "stated East backup weeks",
  weekdayPattern: "weekday pattern", canBePrimary: "can be primary", weekdays: "clinic days", avoidWholeWeek: "avoid the clinic week",
  hardAvoidDayBefore: "the day before is blocked", perMonth: "weekends per month", countsEast: "East weekends count", roles: "counts",
  days: "counted days", weight: "weight", target: "target", countsBackup: "backup days count", min: "old min", max: "old max",
  minIsSoft: "old min is soft", primary: "primary", backup: "backup", total: "total (older name)", preferred: "preferred at most",
  countsEastDays: "East primary-week days count", perMonthDays: "backup days per month", weekendsPerMonth: "backup weekends per month",
};
function suRuleKeyWords(k) { return SU_RULE_KEY_WORDS[k] || String(k).replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase(); }
// Review 2 (10/1): a choice field's lone value reads as its menu words in the confirm, not the stored token - the mode
// words of the summary, the Weekend style menu's labels (index-source.html; test/data-layer.test.js pins the two equal),
// the block penalty's blank as its menu reads it. A value not listed here reads as stored.
const SU_RULE_VALUE_WORDS = {
  availabilityMode: SU_SUM_MODE_WORDS,
  weekendStyle: { block: "one block (Fri+Sat+Sun)", split: "split (Fri+Sun / Sat)", daily: "single days", "saturday-only": "Saturday only (older setting)" },
  weekendBlockPenalty: { "": "blank - read as medium" },
};
function suRuleCanon(v) { return JSON.stringify(v, (k, x) => suRfObj(x) ? Object.keys(x).sort().reduce((o, kk) => { o[kk] = x[kk]; return o; }, {}) : x); }
function suRuleFieldHeld(field, rules) {
  if (!field || !suRfObj(rules)) return [];
  const out = [];
  let notes = false;
  const vw = SU_RULE_VALUE_WORDS[field.id] || null;
  // Review 2 (10/1): a null the field does not read - used() false on that null alone (monthlyTarget: null is the same as
  // no key) - is nothing to lose: no item, so no question for it; a null the engine reads (monthlyCap: null = no cap,
  // over the group default) still counts
  const nullIsNoKey = (p) => {
    const o = {}, parts = p.split(".");
    let c = o;
    parts.slice(0, -1).forEach(k => { c = c[k] = {}; });
    c[parts[parts.length - 1]] = null;
    try { return !field.used(o); } catch (e) { return false; }
  };
  const val = (label, s) => label ? label + (s === "" ? "" : " " + s) : s;
  const walk = (label, v, sv, depth) => {
    if (v === undefined || suRuleCanon(v) === suRuleCanon(sv)) return;
    if (Array.isArray(v)) {
      if (!v.length) return;
      if (v.every(suIsIso)) out.push(val(label, v.length <= 3 ? v.map(d => suSumDate(d, true)).join(", ") : v.length + " dates"));
      else if (v.every(x => typeof x === "string")) out.push(val(label, suSumDays(v)));
      else if (v.every(suRfObj)) out.push(val(label, v.length <= 2 ? v.map(suSumPattern).join(", ") : v.length + " entries"));
      else out.push(val(label, v.length + " entries"));
      return;
    }
    if (suRfObj(v)) {
      const keys = Object.keys(v);
      if (depth >= 1 && keys.length && keys.every(k => suRfObj(v[k]))) { out.push(val(label, "for " + suSumDays(keys))); return; } // a per-weekday table
      keys.forEach(k => { if (suSumProse(k)) { if (v[k] !== "" && v[k] !== null && v[k] !== undefined) notes = true; return; } walk(suRuleKeyWords(k), v[k], suRfObj(sv) ? sv[k] : undefined, depth + 1); });
      return;
    }
    // a lone value of the field itself (no label) reads "the setting ..." - "This deletes: none" would read as nothing
    const lone = (s) => label ? val(label, s) : "the setting \"" + s + "\"";
    if (v === null) out.push(lone("none"));
    else if (typeof v === "boolean") out.push(label ? label + (v ? "" : ": off") : lone(v ? "on" : "off"));
    else if (suIsIso(v)) out.push(lone(suSumDate(v, true)));
    else out.push(lone(!label && vw && typeof v === "string" && Object.prototype.hasOwnProperty.call(vw, v) ? vw[v] : String(v)));
  };
  field.paths.forEach((p, i) => {
    if (!suRulePathHas(rules, p)) return;
    let v = rules;
    p.split(".").forEach(k => { v = v[k]; });
    if (v === null && nullIsNoKey(p)) return;
    walk(i === 0 ? "" : suRuleKeyWords(p), v, i === 0 ? field.start : undefined, 0);
  });
  if (notes) out.push("notes");
  return out;
}
// The confirm text Remove shows, or null when nothing beyond the start value would be deleted (no question asked).
function suRuleRemoveConfirm(field, rules, who) {
  const held = suRuleFieldHeld(field, rules);
  if (!held.length) return null;
  const shown = held.length > 8 ? held.slice(0, 8).concat(["and " + (held.length - 8) + " more"]) : held;
  return "Remove the rule \"" + field.label + "\"" + (who ? " for " + who : "") + "? This deletes: " + shown.join("; ") + ".";
}
function suRulesJsonOnly(rules) {
  const r = suRfObj(rules) ? rules : {};
  const out = SU_RULE_JSON_ONLY.filter(([k]) => { const v = r[k]; return Array.isArray(v) ? v.length > 0 : suRfObj(v) ? Object.keys(v).length > 0 : suRfSet(v); }).map(([, w]) => w);
  if (r.poolMember === false) out.push("out of the share pool");
  return out;
}
// PatternListEditor's kind switch: a copy of the pattern with the new kind's keys and every other key kept - start /
// end bounds, weight, note and anything else (the old switch dropped the bounds); "dates" carries no weekday.
const SU_PATTERN_KIND_KEYS = ["nth", "nthWeekOfMonth", "anchorWeekday", "beforeNthMonday", "dates"];
function suPatternWithKind(p, kind) {
  const n = suRfObj(p) ? JSON.parse(JSON.stringify(p)) : {};
  SU_PATTERN_KIND_KEYS.forEach(k => { delete n[k]; });
  if (kind === "dates") { delete n.weekday; n.dates = []; return n; }
  n.weekday = n.weekday || "Mon";
  if (kind === "nth") n.nth = [1];
  else if (kind === "week") n.nthWeekOfMonth = 1;
  else if (kind === "before") n.beforeNthMonday = [2, 4];
  return n;
}

/* === Auth link errors (Prompt 16 A2) === */
// GoTrue sends a failed invite / recovery / magic link back to the redirect URL as
//   #error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired
// (the hash form) and, in some flows, as the same three keys in the query (?error=...). Whatever the
// code, the person can do only two things - ask for a new invite or use Forgot your password - so every
// such shape reads as this ONE message. The success shape (#access_token=...&type=recovery|invite) is
// not an error and returns null; so do the app's own deep links (#openshifts, #offers, ?public=1).
const AUTH_LINK_ERROR_MESSAGE = "This invite or reset link has expired or was already used - ask the scheduler for a new invite, or use Forgot your password.";
const AUTH_LINK_ERROR_KEYS = ["error", "error_code", "error_description"];
// authLinkError(hash, search) -> null, or { message, code, description, from: "hash" | "query", cleanSearch }
// where cleanSearch is the query with the three error keys removed ("" or "?k=v...") - what the app hands
// to history.replaceState so a reload does not repeat the message. The hash is read first (one message).
function authLinkError(hash, search) {
  const paramsOf = (s, lead) => {
    if (typeof s !== "string") return null;
    const body = s.charAt(0) === lead ? s.slice(1) : s;
    if (!body) return null;
    try { return new URLSearchParams(body); } catch (e) { return null; }
  };
  const read = (p) => {
    if (!p) return null;
    const code = p.get("error_code") || "", error = p.get("error") || "";
    if (!code && !error) return null;
    return { code: code || error, description: p.get("error_description") || "" };
  };
  const qp = paramsOf(search, "?");
  const fromQuery = read(qp);
  let cleanSearch = "";
  if (qp) { AUTH_LINK_ERROR_KEYS.forEach(k => qp.delete(k)); const rest = qp.toString(); cleanSearch = rest ? "?" + rest : ""; }
  const fromHash = read(paramsOf(hash, "#"));
  const hit = fromHash || fromQuery;
  if (!hit) return null;
  return { message: AUTH_LINK_ERROR_MESSAGE, code: hit.code, description: hit.description, from: fromHash ? "hash" : "query", cleanSearch };
}

/* ═══ Alerts feed by role (Prompt 16 B3) ═══ */
// The notifications table is one shared feed; what an account reads of it is decided here, in one place.
// - the scheduler reads everything;
// - a linked surgeon reads the group-wide types (publish, change, manual edit, open shifts) plus every row that names
//   them (data.surgeon_id, data.from_surgeon_id, data.to_surgeon_id);
// - a VIEWER (role viewer with no roster link: the office viewer, and every invited account until the admin links and
//   promotes it) reads schedule_published and open_shifts only - nothing about trades, vacations or reminders;
// - an account with another role but no roster link yet reads everything (unchanged from before B3);
// - a FOLLOWER (Prompt 20 F3: a viewer whose who.follows names roster ids) reads exactly what each followed surgeon
//   reads - the group-wide types plus every row naming one of them (a give from Prompt 19 names its parties like any
//   trade) - instead of the two viewer types. A coordinator already reads everything; follows never narrows that.
// clearedBefore is the per-device Clear watermark (the feed is shared; Clear is local). Never throws.
const NOTIF_VIEWER_TYPES = ["schedule_published", "open_shifts"];
const NOTIF_GROUP_TYPES = ["schedule_published", "schedule_changed", "manual_edit", "open_shifts"];
function notifVisibleTo(rows, who) {
  const list = (Array.isArray(rows) ? rows : []).filter(n => n && typeof n === "object");
  const w = who || {};
  const cleared = w.clearedBefore || "";
  const follows = (Array.isArray(w.follows) ? w.follows : []).filter(x => typeof x === "string" && x !== "");
  // what a linked surgeon reads, for a list of roster ids (his own id, or the ids a follower follows)
  const readsAs = (ids) => list.filter(n => {
    if (NOTIF_GROUP_TYPES.includes(n.type)) return true;
    const d = n.data || {};
    if (ids.includes(d.surgeon_id)) return true;
    if (ids.includes(d.from_surgeon_id) || ids.includes(d.to_surgeon_id)) return true;
    return false;
  });
  let base;
  if (w.isViewer) base = follows.length ? readsAs(follows) : list.filter(n => NOTIF_VIEWER_TYPES.includes(n.type));
  else if (w.isScheduler || !w.mySurgeon) base = list;
  else base = readsAs([w.mySurgeon]);
  return base.filter(n => (n.created_at || "") > cleared);
}

/* === Own profile on the poll (Prompt 16 B4) === */
// The 60-second poll re-reads the signed-in account's own user_profiles row so a surgeon whose account the admin
// links or promotes while the app is open sees Mine, the painter and the role gates follow it without a reload.
// This decides what that read means for the profile in state, in one place:
// - only person_id / role / display_name count (null, "" and undefined are one value); an unchanged row answers the
//   SAME prev object with changed false, so the caller never calls setState for it (React bails out anyway, but the
//   caller does not even try);
// - a moved field answers the fresh row (without the failed-read marker) with changed true, the moved fields, and
//   linked / unlinked for the roster link appearing / going away;
// - a failed mount read (prev._loadFailed) is replaced by ANY successful read (recovered), even when the three
//   fields match, so the red "couldn't load your profile" banner clears;
// - no prev (the mount read is still in flight), an empty read, junk, or a row for another id keeps the profile:
//   the own row is always readable, so an empty answer is an RLS surprise, never an unlink (failure != empty).
// - Prompt 20 F3 (review): the follows list counts too, order-aware through followsOf (an empty list and no column -
//   before revision o - are one value), so a follow the admin adds or removes reaches an open app on the next poll.
// Never throws.
const PROFILE_POLL_KEYS = ["person_id", "role", "display_name"];
function profilePollMerge(prev, row) {
  const norm = (v) => (v === undefined || v === null || v === "" ? null : v);
  if (!prev || typeof prev !== "object") return { next: prev, changed: false, reason: "no-profile" };
  if (!row || typeof row !== "object" || Array.isArray(row)) return { next: prev, changed: false, reason: "empty" };
  if (row.id && prev.id && row.id !== prev.id) return { next: prev, changed: false, reason: "other-account" };
  const recovered = !!prev._loadFailed;
  const moved = PROFILE_POLL_KEYS.filter(k => norm(prev[k]) !== norm(row[k]));
  if (JSON.stringify(followsOf(prev)) !== JSON.stringify(followsOf(row))) moved.push("follows");
  if (!moved.length && !recovered) return { next: prev, changed: false, reason: "unchanged" };
  const next = { ...row, id: row.id || prev.id };
  delete next._loadFailed;
  return {
    next, changed: true, reason: recovered ? "recovered" : "changed", moved, recovered,
    linked: !norm(prev.person_id) && !!norm(row.person_id),
    unlinked: !!norm(prev.person_id) && !norm(row.person_id),
  };
}

/* === Followers (Prompt 20 F2): Setup > Users' Follows control === */
// A viewer or coordinator account follows roster ids (user_profiles.follows, a jsonb array - revision o, prepared in
// F1) and receives what those surgeons receive, read-only. The admin sets the list in Setup > Users through
// saveUserProfile (the users.link path). These are the pure pieces; none of them throws.
const FOLLOWER_ROLES = ["viewer", "coordinator"];
// followsOf(profile): the follows list as roster-id strings - junk entries, blanks and duplicates dropped. A row
// without the column (the read is select=*, so before revision o the key is simply missing) or with a non-array
// value follows nobody.
function followsOf(p) {
  const raw = p && typeof p === "object" ? p.follows : null;
  if (!Array.isArray(raw)) return [];
  const out = [];
  raw.forEach(v => { if (typeof v === "string" && v !== "" && !out.includes(v)) out.push(v); });
  return out;
}
// followsColumnState(rows): "present" when any profile row carries a follows key (the column is NOT NULL with a
// default, so after revision o every row has it), "absent" when rows came back without one (the column is not
// there yet - a select=* read never errors over it), "unknown" for no rows / a failed read.
function followsColumnState(rows) {
  if (!Array.isArray(rows) || !rows.length) return "unknown";
  return rows.some(r => r && typeof r === "object" && Object.prototype.hasOwnProperty.call(r, "follows")) ? "present" : "absent";
}
// followsToggle(list, id, order): the list with id added or removed, in roster order (`order` = the roster's ids);
// an id the order does not know (a surgeon since removed) keeps its place after the known ones - a toggle of another
// chip never drops it.
function followsToggle(list, id, order) {
  const cur = followsOf({ follows: list });
  const next = cur.includes(id) ? cur.filter(x => x !== id) : cur.concat([id]);
  const ord = Array.isArray(order) ? order : [];
  return ord.filter(x => next.includes(x)).concat(next.filter(x => !ord.includes(x)));
}
// followsAuditText(list): the users.link summary piece - "follows s2, s5" or "follows none".
function followsAuditText(list) {
  const l = followsOf({ follows: list });
  return "follows " + (l.length ? l.join(", ") : "none");
}
// followsPatch(p, patch, rosterIds): what saveUserProfile may send, as far as follows goes. Returns
// { ok: true, patch } or { ok: false, error }.
// - patch.follows given: refused unless the account's role AFTER the patch is viewer / coordinator and the value is
//   an array of distinct roster ids (or ids the row already follows); junk is refused, not cleaned - the chips only
//   ever send clean lists, so anything else is a bug to surface.
// - a role change away from viewer / coordinator on a row that follows somebody: follows: [] joins the same PATCH (the
//   row shows no Follows control any more, so a list left behind would be invisible). A row without the column (before
//   revision o) or following nobody is left alone, so the PATCH never names a column that is not there.
function followsPatch(p, patch, rosterIds) {
  const row = p && typeof p === "object" ? p : {};
  const pt = patch && typeof patch === "object" ? patch : {};
  const nextRole = pt.role || row.role || "viewer";
  if (pt.follows !== undefined) {
    if (!FOLLOWER_ROLES.includes(nextRole)) return { ok: false, error: "only a viewer or coordinator account follows surgeons" };
    const ids = Array.isArray(rosterIds) ? rosterIds : [], had = followsOf(row);
    if (!Array.isArray(pt.follows) || followsOf({ follows: pt.follows }).length !== pt.follows.length || pt.follows.some(id => !ids.includes(id) && !had.includes(id))) {
      return { ok: false, error: "follows must be a list of distinct roster ids" };
    }
    return { ok: true, patch: pt };
  }
  if (pt.role && !FOLLOWER_ROLES.includes(pt.role) && followsOf(row).length) return { ok: true, patch: { ...pt, follows: [] } };
  return { ok: true, patch: pt };
}

// followedIdsOf(profile, rosterIds) (Prompt 20 F3): the roster ids the SIGNED-IN account follows - what drives its
// Alerts feed (notifVisibleTo's follows), the Following tab and the followed surgeons' calendar links. Only a viewer /
// coordinator account with no roster link follows anybody (a linked account is the surgeon himself); a failed profile
// read (its fallback row reads viewer, _loadFailed) follows nobody; ids the roster does not list are dropped (the app
// could not name them); the stored order is kept. Never throws.
function followedIdsOf(p, rosterIds) {
  if (!p || typeof p !== "object" || p._loadFailed) return [];
  if (!FOLLOWER_ROLES.includes(p.role)) return [];
  if (p.person_id !== null && p.person_id !== undefined && String(p.person_id) !== "") return [];
  const known = Array.isArray(rosterIds) ? rosterIds : [];
  return followsOf(p).filter(id => known.includes(id));
}

// ---- Prompt 20 R2 (Faraz 9/25): the notification_preferences row a Settings save sends, for either owner ----
// notifPrefSaveRequest(owner, cur, nowIso) -> { onConflict, row } or null (no write):
//   owner { personId }  - a surgeon's row: on_conflict=person_id, the body names person_id and NEVER profile_id (that
//                          column exists only from revision o, so a surgeon's save must not name it - before AND after).
//   owner { profileId } - a follower's row (a viewer / coordinator with no roster link; profileId = his own
//                          user_profiles.id = auth.uid(), what prefs_own checks): on_conflict=profile_id, the body names
//                          profile_id and carries NO person_id key (the row's person_id stays null - one_owner).
//   neither, or both, or blank -> null.
// The flags are the card's: a flag that is not explicitly false is on; the hour is a number or null (the default).
function notifPrefSaveRequest(owner, cur, nowIso) {
  const o = owner && typeof owner === "object" ? owner : {};
  const personId = typeof o.personId === "string" && o.personId ? o.personId : "";
  const profileId = typeof o.profileId === "string" && o.profileId ? o.profileId : "";
  if ((personId && profileId) || (!personId && !profileId)) return null;
  const c = cur && typeof cur === "object" ? cur : {};
  const flags = {
    schedule_updates_email: c.schedule_updates_email !== false,
    trade_updates_email: c.trade_updates_email !== false,
    shift_reminders_email: c.shift_reminders_email !== false,
    reminder_hour_central: typeof c.reminder_hour_central === "number" ? c.reminder_hour_central : null,
    updated_at: nowIso || new Date().toISOString(),
  };
  return personId
    ? { onConflict: "person_id", row: { person_id: personId, ...flags } }
    : { onConflict: "profile_id", row: { profile_id: profileId, ...flags } };
}
// notifPrefReadFailureState(status, bodyText) - a non-2xx answer to the follower's read
// (notification_preferences?select=*&profile_id=eq.<id>): "unavailable" is PostgREST's missing-column answer, HTTP 400
// with code 42703 naming profile_id (observed live 9/25: {"code":"42703",...,"message":"column
// notification_preferences.profile_id does not exist"} - revision o not applied yet); anything else is "failed".
function notifPrefReadFailureState(status, bodyText) {
  const t = String(bodyText || "");
  return Number(status) === 400 && /profile_id/.test(t) && /42703|does not exist/.test(t) ? "unavailable" : "failed";
}

// ---- Prompt 16 B9 (9/24): small pure pieces the client items are built on ----

// (a) The Generate worker's script. The app builds a classic Web Worker from a Blob of this text - no second script
// file to version and deploy - and the worker importScripts the page's own helpers.js / rules.js / generator.js
// (the caller passes the absolute URLs WITH the page's ?v cache-buster, so the worker runs the bytes the page loaded
// and can never disagree with it on a rule). Classic scripts: their top-level functions are the worker's globals,
// exactly as on the page. buildContext runs inside the worker - the inputs are rows and Sets (structured clone
// carries them), the page's ctx (memo caches) is never cloned. One message in, one answer out, never a throw.
const GEN_WORKER_MODULES = ["helpers.js", "rules.js", "generator.js"];
function genWorkerSource(moduleUrls) {
  const urls = (Array.isArray(moduleUrls) ? moduleUrls : []).map(u => JSON.stringify(String(u)));
  return [
    "importScripts(" + urls.join(", ") + ");",
    "self.onmessage = function (ev) {",
    "  var m = ev.data || {};",
    "  try {",
    "    if (!m.inputs || typeof m.inputs !== 'object') throw new Error('generate worker: no inputs in the message');",
    "    var ctx = buildContext(m.inputs);",
    "    var res = generate(ctx, m.start, m.end, m.opts || {});",
    "    self.postMessage({ id: m.id, ok: true, schedule: res.schedule || {}, diagnostics: res.diagnostics || {}, warnings: ctx.warnings || [] });",
    "  } catch (e) {",
    "    self.postMessage({ id: m.id, ok: false, error: String(e && e.message || e) });",
    "  }",
    "};",
  ].join("\n");
}

// (b) Focus trap: where Tab / Shift+Tab should land so focus stays inside a dialog. `focusable` is the dialog's
// focusable elements in DOM order, `active` the element that has focus. Answers the element to focus, or null
// when the browser's own move stays inside the dialog.
function focusTrapNext(shiftKey, focusable, active) {
  const list = Array.isArray(focusable) ? focusable : [];
  if (!list.length) return null;
  const first = list[0], last = list[list.length - 1];
  if (list.indexOf(active) < 0) return shiftKey ? last : first;
  if (shiftKey && active === first) return last;
  if (!shiftKey && active === last) return first;
  return null;
}

// (d) The line under "Send test notification": "sent" only when new Notification() really showed one.
function notifTestMessage(shown, permission) {
  if (shown) return "Browser notification sent.";
  if (permission === "denied") return "Browser notifications are blocked in this browser's settings - nothing was shown.";
  if (permission !== "granted") return "Browser notifications are not allowed yet - tap Allow notifications first.";
  return "This browser could not show a notification from the page (on an iPhone the app has to be installed to the Home Screen) - nothing was shown.";
}

// Settings > Pop-ups on this device: Notification.permission ("granted" / "denied" / "default", or the app's own
// "unsupported" when the browser has no Notification API) in plain words - never the raw token.
function notifPermissionText(permission) {
  if (permission === "granted") return "Allowed on this device.";
  if (permission === "denied") return "Blocked in this browser - allow them in the browser's site settings to get pop-ups.";
  if (permission === "default") return "Not allowed yet - tap Allow notifications.";
  return "This browser can't show pop-ups (on an iPhone, add the app to the Home Screen first).";
}

// (e) The toasts for Setup saves that wait for the blob write: ONE toast naming every distinct label, in order
// ("Group rules and Holiday units saved.") - the app's toast is single-slot (a second showToast replaces the
// first), so one line per settled run is the only way every label is seen (B9 review 9/24).
function setupSaveToasts(labels, ok, why) {
  const seen = new Set();
  const list = (Array.isArray(labels) ? labels : []).map(l => String(l || "").trim()).filter(k => { if (!k || seen.has(k)) return false; seen.add(k); return true; });
  if (!list.length) return [];
  let reason = String(why || "").trim() || "the write did not go through";
  if (!/[.!?]$/.test(reason)) reason += ".";
  const names = list.length === 1 ? list[0] : list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
  return [ok ? { text: names + " saved.", tone: "success" } : { text: names + " NOT saved - " + reason, tone: "error" }];
}

// (g) Stable keys for an editor whose rows are plain objects without ids (the recurring-pattern lists): reconcile
// a previous id list to `n` rows - same length = the same array (stable keys), longer = fresh unique ids appended,
// shorter = truncated (an outside reset). The editor splices the list itself when it removes a row.
let suRowIdSeq = 0;
function suPatternRowIds(prev, n) {
  const p = Array.isArray(prev) ? prev : [];
  const len = Math.max(0, Math.floor(Number(n) || 0));
  if (p.length === len) return p;
  if (p.length > len) return p.slice(0, len);
  const out = p.slice();
  while (out.length < len) out.push("pr" + (++suRowIdSeq));
  return out;
}

// (h) schedule_days tripwire: a read of ZERO rows after a read of N > 0 is a failed read (an RLS-filtered or dead-
// token answer is HTTP 200 + [], indistinguishable from an empty table), never an empty schedule to adopt.
function daysReadTripped(count, lastCount) {
  return Number(count) === 0 && Number(lastCount) > 0;
}

/* === CALL PAY (Faraz 9/27 - reverses the 9/21 "no compensation logic" rule) ===
   Primary call pay only (backup is never paid). The unit is one PRIMARY 24-h call day D (07:00 D -> 07:00 D+1), paid when
   schedule[D].primary === the person in the CURRENT schedule (an externally covered day - primary null - is nobody's).
   Components per day, in integer cents (a missing rate is NEVER 0: the component and the day's total are null and the rate
   key is listed in `missing` - "rates not set yet"):
     stipend    - rates.stipendPerShift, every primary day
     callIn     - weekday: callInWeekdayRate; weekend / holiday: callInWeekendHolidayRate - when the primary was called in
                  that day (at least one call_pay_logs row), or always when the matching callInRequired* flag is off
     activation - activationUnit "hour": the day's logged hours x activationRate (on a weekday the surgeon enters the
                  after-hours hours, on a weekend / holiday all hours worked); "activation": the number of call-ins x rate
   Kind of D: "holiday" when D is a day of a holiday unit and holidayUnitDaysAreHolidays, else "weekend" when D's weekday is
   in weekendDays (default Sat + Sun - Friday is a weekday for pay), else "weekday". Earned vs projected: D <= today (Central)
   is earned; a later day is projected and counts only what needs no log (the stipend, plus the call-in part when a call-in
   is not required). wRVUs are out of scope for now: components is an object, so a later `wrvu` component slots in.
   NO FIGURE HERE: the rates are data the scheduler enters in the app (call_pay_settings, authenticated only); the defaults
   below are flags only (test/privacy.test.js pins that PAY_FLAG_DEFAULTS carries no number). Pure; never reads the clock
   except through todayOrCentral when opts.today is missing.
   Paid by the call stipend (Faraz 9/27, item 5b): settings.stipendOffIds lists the roster ids switched OFF in Setup > Pay rates
   (default: nobody). A switched-off person has no My pay (payForMonth answers stipendOff with no day) and is left out of
   Totals > Pay and its CSV (payTotalsRows); the database enforces it too (RLS + PY005 in call_pay_logs_guard). */
var PAY_FLAG_DEFAULTS = { weekendDays: ["Sat", "Sun"], holidayUnitDaysAreHolidays: true, callInRequiredWeekday: true, callInRequiredWeekendHoliday: true, activationUnit: "hour", stipendOffIds: [] };
var PAY_WEEK_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];   // weekend chips and the stored list, Monday first
var PAY_RATE_KEYS = ["stipendPerShift", "callInWeekdayRate", "callInWeekendHolidayRate", "activationRate"];
var PAY_RATE_COLUMNS = { stipendPerShift: "stipend_per_shift", callInWeekdayRate: "weekday_callin_rate", callInWeekendHolidayRate: "weekend_holiday_callin_rate", activationRate: "activation_rate" };
var PAY_FLAG_COLUMNS = { weekendDays: "weekend_days", holidayUnitDaysAreHolidays: "holiday_unit_days_are_holidays", callInRequiredWeekday: "callin_required_weekday", callInRequiredWeekendHoliday: "callin_required_weekend_holiday", activationUnit: "activation_unit", stipendOffIds: "stipend_off_ids" };
var PAY_RATE_LABELS = { stipendPerShift: "Stipend per primary shift", callInWeekdayRate: "Weekday call-in rate", callInWeekendHolidayRate: "Weekend / holiday call-in rate", activationRate: "Activation rate" };
var PAY_UNAVAILABLE_TEXT = "Pay tracking is available after the next database update.";
var PAY_RATES_UNSET_TEXT = "Rates not set yet - the scheduler enters them in Setup > Pay rates.";
var PAY_STIPEND_OFF_TEXT = "Not paid by the call stipend.";
// A rate as a number rounded to cents, or null for "not set" (null / "" / junk / out of the 0-99999 range the table checks).
function payRateNum(v) {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  var n = Number(v);
  if (!isFinite(n) || n < 0 || n > 99999) return null;
  return Math.round(n * 100) / 100;
}
function payCents(rate) { return rate === null || rate === undefined ? null : Math.round(Number(rate) * 100); }
// payIdList(v) -> the sorted, de-duplicated non-empty strings of an array (or a JSON-string array); [] for anything else.
function payIdList(v) {
  if (typeof v === "string") { try { v = JSON.parse(v); } catch (e) { v = null; } }
  if (!Array.isArray(v)) return [];
  var out = [];
  v.forEach(function (x) { if (typeof x === "string" && x !== "" && out.indexOf(x) < 0) out.push(x); });
  return out.sort();
}
// paySettingsFromRow(row) -> { rates: { stipendPerShift, ... (number | null) }, weekendDays, holidayUnitDaysAreHolidays,
// callInRequiredWeekday, callInRequiredWeekendHoliday, activationUnit, stipendOffIds (roster ids NOT paid by the call stipend,
// sorted), state: "unset" | "partial" | "set", updatedAt, updatedBy }.
// Accepts the call_pay_settings row (snake_case), a one-row array, null, [] or junk; a bad value falls back to its default.
function paySettingsFromRow(row) {
  var r = Array.isArray(row) ? row[0] : row;
  if (!r || typeof r !== "object") r = {};
  var rates = {};
  PAY_RATE_KEYS.forEach(function (k) { rates[k] = payRateNum(r[PAY_RATE_COLUMNS[k]] !== undefined ? r[PAY_RATE_COLUMNS[k]] : (r.rates ? r.rates[k] : undefined)); });
  var pick = function (k) { var c = PAY_FLAG_COLUMNS[k]; return r[c] !== undefined ? r[c] : r[k]; };
  var wd = pick("weekendDays");
  if (typeof wd === "string") { try { wd = JSON.parse(wd); } catch (e) { wd = null; } }
  var weekendDays = Array.isArray(wd) && wd.every(function (d) { return TT_DOW.indexOf(d) >= 0; })
    ? PAY_WEEK_ORDER.filter(function (d) { return wd.indexOf(d) >= 0; }) : PAY_FLAG_DEFAULTS.weekendDays.slice();
  var bool = function (k) { var v = pick(k); return typeof v === "boolean" ? v : PAY_FLAG_DEFAULTS[k]; };
  var unit = pick("activationUnit");
  var set = PAY_RATE_KEYS.filter(function (k) { return rates[k] !== null; }).length;
  return {
    rates: rates, weekendDays: weekendDays,
    holidayUnitDaysAreHolidays: bool("holidayUnitDaysAreHolidays"), callInRequiredWeekday: bool("callInRequiredWeekday"), callInRequiredWeekendHoliday: bool("callInRequiredWeekendHoliday"),
    activationUnit: unit === "hour" || unit === "activation" ? unit : PAY_FLAG_DEFAULTS.activationUnit,
    stipendOffIds: payIdList(pick("stipendOffIds")),
    state: set === 0 ? "unset" : set === PAY_RATE_KEYS.length ? "set" : "partial",
    updatedAt: typeof r.updated_at === "string" ? r.updated_at : null, updatedBy: typeof r.updated_by === "string" ? r.updated_by : null,
  };
}
function paySettingsNorm(s) { return s && typeof s === "object" && !Array.isArray(s) && s.rates && typeof s.rates === "object" && Array.isArray(s.weekendDays) && Array.isArray(s.stipendOffIds) ? s : paySettingsFromRow(s); }
// payStipendOn(settings, personId) -> false when personId is switched off ("Paid by the call stipend" off in Setup > Pay rates).
function payStipendOn(settings, personId) { return !!personId && paySettingsNorm(settings).stipendOffIds.indexOf(personId) < 0; }
// payStipendDelta(beforeRow, afterRow) -> { off: [ids newly switched off], on: [ids switched back on] } - roster ids only, for
// the pay.rates audit detail (never an amount).
function payStipendDelta(beforeRow, afterRow) {
  var a = paySettingsNorm(beforeRow).stipendOffIds, b = paySettingsNorm(afterRow).stipendOffIds;
  return { off: b.filter(function (id) { return a.indexOf(id) < 0; }), on: a.filter(function (id) { return b.indexOf(id) < 0; }) };
}
// paySettingsHidden(state, row) -> true when the last successful settings read answered NO row. For a linked surgeon that is
// RLS saying he is switched off the stipend (the 'main' row exists since the migration was applied, 2026-09-28): his My pay card is not
// rendered. Never true before a read succeeded (loading / failed / skipped / unavailable are not "switched off").
function paySettingsHidden(state, row) {
  return !!(state && typeof state === "object" && state.settingsLoaded && state.settings !== "unavailable") && (row === null || row === undefined || (Array.isArray(row) && row.length === 0));
}
// payStipendKnown(state) -> true once a settings read has succeeded (payStateAfterRead's settingsLoaded): only then are the
// "Paid by the call stipend" switches known. Before it, paySettingsFromRow(null) reads "nobody switched off" - so Totals > Pay,
// its CSV and a PayCard show NO rows / figures / form until it is true (a failed settings read beside a good call-ins read
// must never bring a switched-off surgeon back). A later failed refresh keeps the row read before, which stays authoritative.
function payStipendKnown(state) { return !!(state && typeof state === "object" && state.settingsLoaded); }
// payStipendPending(state) -> true while the FIRST settings read has not answered (settings "unread", never loaded): a linked
// surgeon's own My pay card is not rendered yet, so a switched-off surgeon never sees a My pay header flash before it hides.
function payStipendPending(state) { return !payStipendKnown(state) && !!state && typeof state === "object" && state.settings === "unread"; }
// paySettingsToRow(settings) -> the call_pay_settings row the scheduler's Save upserts ({ id: "main", snake_case columns });
// rates rounded to cents, null kept as null (never 0). updated_by / updated_at are stamped by the table's trigger.
function paySettingsToRow(settings) {
  var s = paySettingsNorm(settings);
  var row = { id: "main" };
  PAY_RATE_KEYS.forEach(function (k) { row[PAY_RATE_COLUMNS[k]] = payRateNum(s.rates[k]); });
  row.activation_unit = s.activationUnit;
  row.weekend_days = s.weekendDays.slice();
  row.holiday_unit_days_are_holidays = s.holidayUnitDaysAreHolidays;
  row.callin_required_weekday = s.callInRequiredWeekday;
  row.callin_required_weekend_holiday = s.callInRequiredWeekendHoliday;
  row.stipend_off_ids = s.stipendOffIds.slice();
  return row;
}
// payRatesChanged(beforeRow, afterRow) -> the camelCase keys whose value differs - for the pay.rates audit detail, which
// carries KEYS only, never an amount (audit_log is readable by the scheduler and the row's author).
function payRatesChanged(beforeRow, afterRow) {
  var a = paySettingsToRow(beforeRow), b = paySettingsToRow(afterRow), out = [];
  PAY_RATE_KEYS.forEach(function (k) { if (a[PAY_RATE_COLUMNS[k]] !== b[PAY_RATE_COLUMNS[k]]) out.push(k); });
  Object.keys(PAY_FLAG_COLUMNS).forEach(function (k) { if (JSON.stringify(a[PAY_FLAG_COLUMNS[k]]) !== JSON.stringify(b[PAY_FLAG_COLUMNS[k]])) out.push(k); });
  return out;
}
// payHolidaySet(holidays) -> { "YYYY-MM-DD": unit name } - every day of every holiday unit (holidayNameByDay's shapes).
function payHolidaySet(holidays) { return holidayNameByDay(holidays); }
// payDayKind(day, settings, holidaySet) -> "holiday" | "weekend" | "weekday" (holiday wins over weekend).
function payDayKind(day, settings, holidaySet) {
  var s = paySettingsNorm(settings);
  if (s.holidayUnitDaysAreHolidays && holidaySet && holidaySet[day]) return "holiday";
  return ttIsIso(day) && s.weekendDays.indexOf(ttDow(day)) >= 0 ? "weekend" : "weekday";
}
// payPrimaryDays(schedule, personId, from, to) -> the sorted ISO days in [from, to] whose primary is personId.
function payPrimaryDays(schedule, personId, from, to) {
  if (!schedule || typeof schedule !== "object" || !personId) return [];
  return Object.keys(schedule).filter(function (d) {
    var e = schedule[d];
    return ttIsIso(d) && (!from || d >= from) && (!to || d <= to) && e && e.primary === personId;
  }).sort();
}
function payLogDay(l) { return l && l.day ? String(l.day).slice(0, 10) : ""; }
function payLogQuarters(l) { var n = Number(l && l.hours); return isFinite(n) && n > 0 ? Math.round(n * 4) : 0; }
// payForDay(day, personId, { schedule, holidays | holidaySet, logs, settings, today }) -> null when personId is not the
// day's primary; else { day, kind, holiday, primary: true, calledIn, activations, quarters, hours, logs, components:
// { stipend, callIn, activation } (cents or null), totalCents (null when a needed rate is missing), projected, missing }.
function payForDay(day, personId, opts) {
  var o = opts || {};
  var e = o.schedule && ttIsIso(day) ? o.schedule[day] : null;
  if (!e || !personId || e.primary !== personId) return null;
  var s = paySettingsNorm(o.settings);
  var hs = o.holidaySet || payHolidaySet(o.holidays);
  var kind = payDayKind(day, s, hs);
  var today = todayOrCentral(o.today);
  var projected = day > today;
  var logs = (Array.isArray(o.logs) ? o.logs : []).filter(function (l) { return l && l.person_id === personId && payLogDay(l) === day; });
  var counted = projected ? [] : logs;
  var quarters = counted.reduce(function (n, l) { return n + payLogQuarters(l); }, 0);
  var activations = counted.length, calledIn = activations > 0;
  var missing = [];
  var need = function (k) { var c = payCents(s.rates[k]); if (c === null && missing.indexOf(k) < 0) missing.push(k); return c; };
  var comp = { stipend: need("stipendPerShift"), callIn: 0, activation: 0 };
  var wkHol = kind !== "weekday";
  var required = wkHol ? s.callInRequiredWeekendHoliday : s.callInRequiredWeekday;
  if (projected ? !required : (calledIn || !required)) comp.callIn = need(wkHol ? "callInWeekendHolidayRate" : "callInWeekdayRate");
  var units = s.activationUnit === "activation" ? activations : quarters;
  if (units > 0) {
    var rc = need("activationRate");
    comp.activation = rc === null ? null : (s.activationUnit === "activation" ? rc * units : Math.round(rc * units / 4));
  }
  var total = comp.stipend === null || comp.callIn === null || comp.activation === null ? null : comp.stipend + comp.callIn + comp.activation;
  return { day: day, kind: kind, holiday: hs[day] || null, primary: true, calledIn: calledIn, activations: activations, quarters: quarters, hours: quarters / 4,
    logs: logs, components: comp, totalCents: total, projected: projected, missing: missing };
}
function paySummary(days) {
  var out = { earnedCents: 0, projectedCents: 0, primaryDays: days.length, earnedDays: 0, projectedDays: 0, calledInDays: 0, activations: 0, hours: 0, missing: [] };
  days.forEach(function (d) {
    if (d.projected) { out.projectedDays++; out.projectedCents = out.projectedCents === null || d.totalCents === null ? null : out.projectedCents + d.totalCents; }
    else {
      out.earnedDays++; out.earnedCents = out.earnedCents === null || d.totalCents === null ? null : out.earnedCents + d.totalCents;
      if (d.calledIn) out.calledInDays++;
      out.activations += d.activations; out.hours += d.quarters;
    }
    d.missing.forEach(function (k) { if (out.missing.indexOf(k) < 0) out.missing.push(k); });
  });
  out.hours = out.hours / 4;
  return out;
}
// payForMonth(personId, year, month0, opts) -> { from, to, ytdFrom, stipendOff, days: [payForDay ...], orphanLogs, month: summary, ytd: summary }.
// A person switched off the call stipend (settings.stipendOffIds) answers stipendOff: true with no day, no orphan and empty summaries.
// summary = { earnedCents, projectedCents (null when any day's total is), primaryDays, earnedDays, projectedDays, calledInDays,
// activations, hours, missing }. YTD = Jan 1 through the last day of the selected month, split by today. orphanLogs = the
// person's call-ins in the month on a day he is no longer the primary of (after a trade / restore): never counted, deletable.
function payForMonth(personId, year, month0, opts) {
  var o = opts || {};
  var y = Number(year), m = Number(month0);
  var from = fmt(new Date(y, m, 1)), to = fmt(new Date(y, m + 1, 0)), ytdFrom = fmt(new Date(y, 0, 1));
  var shared = Object.assign({}, o, { settings: paySettingsNorm(o.settings), holidaySet: o.holidaySet || payHolidaySet(o.holidays), today: todayOrCentral(o.today) });
  if (!payStipendOn(shared.settings, personId)) return { from: from, to: to, ytdFrom: ytdFrom, stipendOff: true, days: [], orphanLogs: [], month: paySummary([]), ytd: paySummary([]) };
  var all = payPrimaryDays(o.schedule, personId, ytdFrom, to).map(function (d) { return payForDay(d, personId, shared); });
  var days = all.filter(function (d) { return d.day >= from; });
  var orphanLogs = (Array.isArray(o.logs) ? o.logs : []).filter(function (l) {
    var d = payLogDay(l);
    if (!l || l.person_id !== personId || d < from || d > to) return false;
    var e = o.schedule ? o.schedule[d] : null;
    return !e || e.primary !== personId;
  });
  return { from: from, to: to, ytdFrom: ytdFrom, stipendOff: false, days: days, orphanLogs: orphanLogs, month: paySummary(days), ytd: paySummary(all) };
}
// payTotalsRows(roster, year, month0, opts) -> [{ id, name, code, inactive, month, ytd, orphans }] - roster order, for Totals >
// Pay (the scheduler, and the office coordinator read-only): every active pool surgeon, plus an INACTIVE one who has a primary
// day or a call-in in that year (pay he earned before he was set inactive stays in the month / YTD totals and the payroll CSV).
// Outside surgeons are never listed, nor a surgeon switched off the call stipend (settings.stipendOffIds - payStipendOffRows
// names them for the panel's one line).
function payTotalsRows(roster, year, month0, opts) {
  if (!Array.isArray(roster)) return [];
  var o = opts || {};
  var shared = Object.assign({}, o, { settings: paySettingsNorm(o.settings), holidaySet: o.holidaySet || payHolidaySet(o.holidays), today: todayOrCentral(o.today) });
  var y = String(Number(year));
  var logs = Array.isArray(o.logs) ? o.logs : [];
  return roster.filter(function (r) {
    if (!r || !r.id || r.type === "external") return false;
    if (!payStipendOn(shared.settings, r.id)) return false;
    if (r.active !== false) return true;
    return payPrimaryDays(o.schedule, r.id, y + "-01-01", y + "-12-31").length > 0 || logs.some(function (l) { return l && l.person_id === r.id && payLogDay(l).slice(0, 4) === y; });
  }).map(function (r) {
    var pm = payForMonth(r.id, year, month0, shared);
    return { id: r.id, name: r.name || r.id, code: r.code || "", inactive: r.active === false, month: pm.month, ytd: pm.ytd, orphans: pm.orphanLogs.length };
  });
}
// payStipendOffRows(roster, settings) -> [{ id, name }] - the roster's pool surgeons switched off the call stipend, roster order.
function payStipendOffRows(roster, settings) {
  var s = paySettingsNorm(settings);
  return (Array.isArray(roster) ? roster : []).filter(function (r) { return r && r.id && r.type !== "external" && s.stipendOffIds.indexOf(r.id) >= 0; })
    .map(function (r) { return { id: r.id, name: r.name || r.id }; });
}
function payCsvAmount(c) { return c === null || c === undefined ? "" : (c / 100).toFixed(2); }
// payCsv(rows, year, month0) -> { name: "silvis-pay-YYYY-MM.csv", text } (ttCsvText). Plain 2-decimal numbers, no currency
// sign; an amount whose rate is not set is left empty. A local download only (the scheduler's, or the office's read-only one - item 5a) - never sent anywhere.
function payCsv(rows, year, month0) {
  var ym = Number(year) + "-" + String(Number(month0) + 1).padStart(2, "0");
  var headers = ["Month", "Surgeon", "Code", "Primary days", "Called-in days", "Hours", "Earned (month)", "Projected (month)", "YTD earned", "YTD projected"];
  var body = (rows || []).map(function (r) {
    return [ym, r.name + (r.inactive ? " (inactive)" : ""), r.code, r.month.primaryDays, r.month.calledInDays, r.month.hours, payCsvAmount(r.month.earnedCents), payCsvAmount(r.month.projectedCents), payCsvAmount(r.ytd.earnedCents), payCsvAmount(r.ytd.projectedCents)];
  });
  return { name: "silvis-pay-" + ym + ".csv", text: ttCsvText(headers, body) };
}
// payMoney(cents) -> "<currency>1,234.50" (en-US, USD) or "-" when null.
function payMoney(cents) {
  if (cents === null || cents === undefined || !isFinite(Number(cents))) return "-";
  var v = Number(cents) / 100;
  try { return v.toLocaleString("en-US", { style: "currency", currency: "USD" }); } catch (e) { return "USD " + v.toFixed(2); }
}
var PAY_NOTE_CONTACT_RE = /@|[0-9]{3}[^0-9]?[0-9]{3}[^0-9]?[0-9]{4}/;   // the call_pay_logs note check, mirrored
// payLogValidate({ day, hours, note }, { schedule, personId, today, logs, editingId }) -> null when the call-in may be saved,
// else the message. Checks in order: a primary day of the person, not after today, hours 0-24 in quarter steps, the day's
// total within 24 h (the person's other rows), the note (<= 200 characters, no contact-like text).
function payLogValidate(input, opts) {
  var i = input || {}, o = opts || {};
  var day = String(i.day || "");
  if (!ttIsIso(day)) return "Pick the call day (07:00 to 07:00) the call-in belongs to.";
  var e = o.schedule ? o.schedule[day] : null;
  if (!e || !o.personId || e.primary !== o.personId) return "Call pay is logged for the primary only - " + fmtMD(day) + " is not a primary call day of this surgeon.";
  if (day > todayOrCentral(o.today)) return "A call-in is logged once it happened - " + fmtMD(day) + " is after today.";
  var raw = i.hours;
  var h = raw === "" || raw === null || raw === undefined ? NaN : Number(raw);
  if (!isFinite(h) || h < 0 || h > 24 || Math.round(h * 4) !== h * 4) return "Hours must be between 0 and 24, in quarter-hour steps (0.25).";
  var others = (Array.isArray(o.logs) ? o.logs : []).filter(function (l) { return l && l.person_id === o.personId && payLogDay(l) === day && (!o.editingId || l.id !== o.editingId); })
    .reduce(function (n, l) { return n + payLogQuarters(l); }, 0);
  if (others + Math.round(h * 4) > 96) return "One call day holds at most 24 hours - " + (others / 4) + " h are already logged on " + fmtMD(day) + ".";
  var note = i.note === null || i.note === undefined ? "" : String(i.note);
  if (note.length > 200) return "Keep the note to 200 characters.";
  if (PAY_NOTE_CONTACT_RE.test(note)) return "Refused: the note looks like contact data (an @ or a phone number).";
  return null;
}
// payReadFailureState(status, bodyText) -> "unavailable" ONLY when a pay TABLE does not exist (a guard: the migration is
// applied since 2026-09-28 01:15:26Z, so this answers only for a rolled-back or rebuilt project): PostgREST 404 PGRST205 (12.2+), or a 404 / 400 whose error code is 42P01, or `relation "...call_pay_..." does not
// exist` (older versions). Anything else is "failed" - a missing COLUMN (400 42703 after a partial apply or a schema the client
// does not match) is a real failure, never "available after the next database update".
// (written call[_]pay[_] so the table names stay in config.js payDb alone - test/pay.test.js [J])
var PAY_MISSING_RELATION_RE = /relation \\?"(public\.)?call[_]pay[_][a-z_]+\\?" does not exist/;
function payReadFailureState(status, bodyText) {
  var st = Number(status), t = String(bodyText || "");
  var code = null;
  try { var j = JSON.parse(t); code = j && typeof j.code === "string" ? j.code : null; } catch (e) { code = null; }
  if (st === 404 && (code === "PGRST205" || (code === null && /PGRST205/.test(t)))) return "unavailable";
  if ((st === 404 || st === 400) && (code === "42P01" || ((code === null || code === "42P01") && PAY_MISSING_RELATION_RE.test(t)))) return "unavailable";
  return "failed";
}
// payViewState(state, year) -> what a pay card may show for `year`, from CallSchedule's payState { settings, logs,
// loadedYear, attemptYear } (see payStateBeforeRead / payStateAfterRead):
//   "unavailable"  a pay table does not exist (the guard; applied 9/28)  -> PAY_UNAVAILABLE_TEXT
//   "ok"           the call-ins held ARE that year's                     -> figures
//   "stale"        that year's call-ins held, the last refresh failed    -> figures + "couldn't refresh"
//   "failed"       that year's call-ins were never read, the read failed -> no figures (never "not called in")
//   "skipped"      that year's call-ins were never read, no fresh token  -> no figures, "sign in again"
//   "loading"      that year's read is in flight / not started           -> no figures
// The rows held for another year are never shown as this year's: with them every past day would read "not called in".
function payViewState(state, year) {
  if (!state || typeof state !== "object") return "loading";
  if (state.logs === "unavailable" || state.settings === "unavailable") return "unavailable";
  var y = Number(year);
  if (state.loadedYear === y) return state.logs === "failed" && state.attemptYear === y ? "stale" : "ok";
  if (state.attemptYear === y && state.logs === "failed") return "failed";
  if (state.attemptYear === y && state.logs === "skipped") return "skipped";
  return "loading";
}
// payStateBeforeRead(prev, year) -> the payState to set when a read of `year` starts: a year whose rows are not held becomes
// "unread" (loading) - never a carried-over "ok" from another year.
function payStateBeforeRead(prev, year) {
  var p = prev || {}, y = Number(year);
  var out = Object.assign({ settings: "unread", logs: "unread", loadedYear: null, attemptYear: null, settingsLoaded: false }, p, { attemptYear: y });
  if (p.logs === "unavailable") return out;
  if (p.loadedYear === y) { out.logs = p.attemptYear === y ? p.logs : "ok"; return out; }
  out.logs = "unread";
  return out;
}
// payStateAfterRead(prev, year, settingsAnswer, logsAnswer) -> the payState after the read of `year` answered (the caller has
// already dropped an answer that is not the LATEST request - CallSchedule's paySeqRef). "skipped" (no fresh token) keeps what
// is held for the same year and marks another year "skipped" (not read), never "ok".
function payStateAfterRead(prev, year, st, lg) {
  var p = Object.assign({ settings: "unread", logs: "unread", loadedYear: null, attemptYear: null, settingsLoaded: false }, prev || {});
  var y = Number(year), ss = (st && st.state) || "failed", ls = (lg && lg.state) || "failed";
  return {
    settings: ss === "skipped" ? (p.settingsLoaded ? p.settings : "skipped") : ss,
    settingsLoaded: p.settingsLoaded || ss === "ok",
    logs: ls === "skipped" ? (p.loadedYear === y ? (p.logs === "unread" ? "ok" : p.logs) : "skipped") : ls,
    loadedYear: ls === "ok" ? y : p.loadedYear,
    attemptYear: y,
  };
}
// payRatesView(state, settings) -> "loading" | "failed" | "unset" | "partial" | "set": a rates read that never succeeded is
// "failed" (or "loading"), never "rates not set yet" - a failed read must not look like an empty setting.
function payRatesView(state, settings) {
  var s = paySettingsNorm(settings);
  if (state && typeof state === "object" && !state.settingsLoaded) {
    if (state.settings === "failed" || state.settings === "skipped") return "failed";
    if (state.settings === "unread") return "loading";
  }
  return s.state;
}
// payErrorText(err) -> human words for a refused pay write (the guard's tokens / errcodes, RLS, a 0-row answer).
function payErrorText(err) {
  var t = String(err && (err.message || err.error || err.body) || err || "");
  if (/PY001|PAY_FUTURE/.test(t)) return "A call-in is logged once it happened - that day is after today.";
  if (/PY002|PAY_NOT_PRIMARY/.test(t)) return "Call pay is logged for the primary only - that surgeon is not the primary on that day (a trade may have moved it).";
  if (/PY003|PAY_HOURS_OVER/.test(t)) return "One call day holds at most 24 hours.";
  if (/PY004|PAY_READ_ONLY/.test(t)) return "The office reads call pay only - a call-in is logged by the surgeon or the scheduler.";
  if (/PY005|PAY_STIPEND_OFF/.test(t)) return "Not paid by the call stipend - no call-in is logged for this surgeon (Setup > Pay rates).";
  if (/23514|check constraint/.test(t)) return "Refused: hours must be quarter hours from 0 to 24, and a note at most 200 characters with no contact data.";
  if (/42501|row-level security|permission denied/.test(t)) return "Not allowed - a surgeon logs call-ins for his own primary days only.";
  if (/0 rows|refused/.test(t)) return "Nothing changed - the row is not yours or no longer exists. Refresh and try again.";
  if (/PGRST205|42P01/.test(t) || PAY_MISSING_RELATION_RE.test(t)) return PAY_UNAVAILABLE_TEXT;
  return "Couldn't save - check your connection and try again.";
}
// payLogAuditText(name, row) -> "Call-in logged: <Name> <Dy M/D>, <h> h" (no amount - the audit row never carries one).
function payLogAuditText(verb, name, row) {
  var d = payLogDay(row);
  var h = Number(row && row.hours);
  return "Call-in " + (verb || "logged") + ": " + (name || (row && row.person_id) || "?") + " " + (ttIsIso(d) ? ttDow(d) + " " + fmtMD(d) : "?") + ", " + (isFinite(h) ? h : 0) + " h";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    GEN_WORKER_MODULES, genWorkerSource, focusTrapNext, notifTestMessage, notifPermissionText, setupSaveToasts, suPatternRowIds, daysReadTripped,
    reviewStateFor, derivedEastVacations,
    authLinkError, AUTH_LINK_ERROR_MESSAGE,
    notifVisibleTo, NOTIF_VIEWER_TYPES, NOTIF_GROUP_TYPES,
    profilePollMerge, PROFILE_POLL_KEYS,
    FOLLOWER_ROLES, followsOf, followsColumnState, followsToggle, followsAuditText, followsPatch, followedIdsOf,
    notifPrefSaveRequest, notifPrefReadFailureState,
    PAY_FLAG_DEFAULTS, PAY_WEEK_ORDER, PAY_RATE_KEYS, PAY_RATE_COLUMNS, PAY_FLAG_COLUMNS, PAY_RATE_LABELS, PAY_UNAVAILABLE_TEXT, PAY_RATES_UNSET_TEXT, PAY_STIPEND_OFF_TEXT,
    payStipendOn, payStipendDelta, paySettingsHidden, payStipendKnown, payStipendPending, payStipendOffRows,
    payRateNum, paySettingsFromRow, paySettingsToRow, payRatesChanged, payHolidaySet, payDayKind, payPrimaryDays, payForDay, payForMonth, payTotalsRows, payCsv, payMoney, payLogValidate, payReadFailureState, payViewState, payStateBeforeRead, payStateAfterRead, payRatesView, payErrorText, payLogAuditText,
    suIsIso, suAddDays, suDaysBetween, suMakeDate, suParseDateList, suCollapseDates, suNextMatchingDates,
    suHolidayCoverage, suHolidayCounts, suOpenPrimaryDays, suCoverageGlance, suAgeDays, suLastAssignedDay, suLastContiguousDay, suFirstOpenSlotDay, suLaterAssignedRanges, suLockedSlotChanges, suSetupIssues,
    suMergePreview, suSeedDayMerge, suAvailKey, suMissingAvailability, suTimeOffKey, suMissingTimeOff, suFmtTs,
    fmt, parse, addD, monOf, getMondays, onVac, fmtMD, todayCentral, todayOrCentral, slotIsOpen,
    SHIFT_HANDOFF_HOUR, shiftClockCentral, shiftDayCentral, onCallNow, onCallNowMsg,
    GROUP_CALL_DEFAULTS, groupCallRules, groupCallTimeLabel, groupCallRuleSentence, groupCallNow, GROUP_CALL_SHARE_CSS, GROUP_CALL_PRINT_CSS,
    vacRangeLabel, groupVacationRows,
    normalizeWeekStart, weekdayLabels, monthGridDays,
    openSlots, openSlotKey, openSlotCounts, openSlotWeekendKinds, openSlotsLine, openShiftsEmail, obBoardRows, obLastAnnounced, obBoardSlots, obUnitMates,
    openSlotReason, openSlotReasonCurrent, openSlotsMessageCurrent, lastGenerateFromDiagnostics,
    emptyDayAssignment, dayRowToAssignment, assignmentToDayRow, sameDayAssignment, mergeRealtimeDay, dayHolder, dayLockFlags,
    undoEntry, undoNoteWrite, undoApply, undoMessage,
    diffScheduleDays, holderLabel, formatDayChange, describePublishDiff,
    countPopulatedPrimary, scheduleWipeCheck, payloadLooksWipedDaily,
    SYNC_RETRY_MS, syncRetryDelay, syncFailLine,
    BLOB_KEYS, canonicalJson, blobSignature, adoptBlobState,
    tradeLegsText, tradeProposeMsg, tradeAcceptMsg, tradeDeclineMsg, tradeGiveMsg, tradeGiveEmail, tradeProposalRows, tradeIsGive, tradeGroupIsGive, tradeProposalOf, tradeProposalIsGive, tradeGiveLine, tradeGiveAcceptMsg, tradeGiveDeclineMsg, tradeGiveCancelMsg, tradeGiveAppliedLine, tradeAppliedTargets, giveAcceptedNotes, giveAppliedNotes, tradeListTitle, tradeListEmpty, tradeRowStatus, auditGiveTradeIds, auditEntryText, labelGiveChanges, slotLabel, suggestTradePartners, tradeDayShort,
    tradeAppliedMsg, tradeCancelMsg, vacationLoggedMsg, manualEditMsg, schedulePublishedMsg,
    ttTotalsFor, ttRunThrough, ttDaysIn, ttRangeFor, ttDeviation, ttCsvText, ttIsIso, ttOutsideSurgeons,
    buildWeekRows, exportColorsFor,
    SURGEON_DARK_TEXT_BY_CODE, surgeonTextColor,
    escHtml, holidayNameByDay, monthsOfSchedule, normalizeMonths,
    icsDate, icsEscape, icsFold, icsVTimezone, buildICSEvents, icsFileName, generateICS,
    generateShareHTML, buildPrintableCalendarHTML,
    buildErCallPanelsHTML, buildErCallPanelsText, buildErCallPanelsDocument, erPanelSpan,
    defaultHolidayUnits, huNthWeekday, HU_ORDER, HU_STANDARD_TIER,
    HOLIDAY_PLAN_DEFAULTS, holidayPlanRules, holidayPlanHistory, planHolidays,
    holidayPlanSource, holidayPlanNote, holidayPlanDefaultYear, holidayPlanInputs, holidayPlanCheck, holidayPlanSwapOptions, holidayPlanRecheck, holidayPlanAcceptRows, holidayPlanWrittenCheck, holidayPlanConflictLines, holidayPlanUnitLines, holidayPlanNoticeChanges, holidayPlanHeldNotices,
    periodFor, offerStatus, offerTimeline, opEndOfPeriod, OP_PERIOD_DEFAULTS,
    offerPoolIds, offerRollcall, offerCronPlan,
    offersDraftDiff, offerDayWhy, offerNextPeriod, offerPeriodOpen, offerRulesWords, OFFER_BLOCK_WORDS, OFFER_CONFIRM_WORDS,
    NO_PRIMARY_RANGE_WORDS, NO_PRIMARY_HELD_WORDS, noPrimaryDays, offerPaintCell, noPrimaryDraftDiff, offersAuditSummary, noPrimaryErrorWords,
    suRulesSummary, suRulesUnknownKeys, suSumDays, suSumMonths, suSumPattern, SU_SUM_KNOWN, SU_SUM_WEIGHT_DEFAULTS,
    SU_RULE_GROUPS, SU_RULE_FIELDS, SU_RULE_JSON_ONLY, suRuleField, suRuleFieldsUsed, suRuleFieldHasKeys, suRuleFieldAdd, suRuleFieldRemove, suRulesJsonOnly, suPatternWithKind,
    suRuleFieldHeld, suRuleRemoveConfirm, SU_RULE_VALUE_WORDS,
    OP_NOTICE_DEFAULTS, offerDeadlineNotices, offerPeriodLeadWarnings,
    offerFreezeRollcall, offerFreezeWords, offerFreezeDay, offerHeadsUpWords,
    offerPeriodJump, vacationLeadNote, tradesWaitingOn, tradeWaitingUnitLine, countPendingProposals, tradeProposalKey,
    VACATION_GUARD_DEFAULTS, VG_CODE, VG_TAIL, VG_MAX_DAYS, vacationRules, vgDaysLabel, vacationGuardMessage, vacationGuard, vacationGuardLine,
    vacationGuardOverride, vacationGuardOverrideText,
  };
}
