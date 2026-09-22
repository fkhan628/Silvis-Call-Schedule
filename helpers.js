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

function onVac(id,ds,v){ return (v[id]||[]).some(([a,b])=>ds>=a&&ds<=b); }

// "10/12" from "2026-10-12" (no leading zeros) - the publish-diff convention.
function fmtMD(dayStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayStr || ""));
  if (!m) return String(dayStr || "?");
  return `${Number(m[2])}/${Number(m[3])}`;
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
// code; the UI may render an arrow glyph instead.
function formatDayChange(change, nameOf) {
  if (!change) return "";
  const md = fmtMD(change.day);
  if (change.role === "primary") return `${md} P ${holderLabel(change.from, nameOf)} -> ${holderLabel(change.to, nameOf)}`;
  if (change.role === "backup") return `${md} B ${holderLabel(change.from, nameOf)} -> ${holderLabel(change.to, nameOf)}`;
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

/* ═══ TRADE MESSAGE COMPOSERS ═══
   One composition per trade event, shared by in-app and email channels.
   Trades are by DAY + ROLE (shift_trade_requests.day / role / return_day /
   return_role). TODO(Slice G): the accept path applies the legs to the
   schedule; the composers below already describe that shape. */
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
// Pill colours for a roster entry: config.js surgeonColors (by code) in the
// browser, the local palette by index elsewhere.
function exportColorsFor(entry, idx) {
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
   Client-side twin of edge-functions/calendar-sync/index.ts: same SUMMARY
   strings, same 07:00 -> 07:00 next-day boundaries, same stable UID, same
   DESCRIPTION lines. The server converts Central wall-clock to UTC per
   endpoint; the download instead writes the LOCAL wall-clock with
   TZID=America/Chicago and ships the CST/CDT rules in a VTIMEZONE block, so
   every calendar app resolves each endpoint with its own offset (a shift
   spanning the November fall-back still runs 07:00 to 07:00). */
const ICS_TZID = "America/Chicago";
const ICS_SHIFT_START = "T070000";
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

// buildICSEvents(schedule, surgeonId, roster, { from, to }) -> events sorted by
// day (primary before backup). surgeonId null = the whole group (summaries
// carry " - <Name>"). Null slots are skipped and an externalCover is not an
// event (it is not a roster member); the backup event of such a day still
// names the cover in its description. from/to (YYYY-MM-DD, inclusive) are
// optional. Each event: { uid, day, role, surgeonId, tzid, start, end,
// summary, desc } with start/end as LOCAL wall-clock stamps (07:00).
function buildICSEvents(schedule, surgeonId, roster, range) {
  const sched = schedule || {};
  const r = range || {};
  const list = Array.isArray(roster) ? roster : [];
  const nameById = {}; list.forEach(x => { if (x && x.id) nameById[x.id] = x.name || x.id; });
  const nameOf = (id) => id ? (nameById[id] || id) : "OPEN";
  const only = surgeonId || null;
  const events = [];
  Object.keys(sched).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().forEach(day => {
    if (r.from && day < r.from) return;
    if (r.to && day > r.to) return;
    const a = sched[day];
    if (!a) return;
    const next = fmt(addD(parse(day), 1));
    const primaryLabel = a.primary ? nameOf(a.primary) : (a.externalCover ? `${a.externalCover} (external cover)` : "OPEN");
    const backupLabel = nameOf(a.backup || null);
    ["primary", "backup"].forEach(role => {
      const id = role === "primary" ? a.primary : a.backup;
      if (!id) return;
      if (only && id !== only) return;
      const summary = only ? `Silvis ${ICS_ROLE_LABEL[role]} Call` : `Silvis ${ICS_ROLE_LABEL[role]} Call - ${nameOf(id)}`;
      const descLines = [`Primary: ${primaryLabel}`, `Backup: ${backupLabel}`, "Shift: 07:00 to 07:00 next day (Central)"];
      if (a.note) descLines.push(`Note: ${a.note}`);
      events.push({
        uid: `silvis-${day}-${role}@${ICS_UID_DOMAIN}`, day, role, surgeonId: id, tzid: ICS_TZID,
        start: day.replace(/-/g, "") + ICS_SHIFT_START, end: next.replace(/-/g, "") + ICS_SHIFT_START,
        summary, desc: descLines.join("\n"),
      });
    });
  });
  return events;
}

// File names: per surgeon "silvis-call-<lastname>.ics", group "silvis-call-all.ics".
function icsFileName(surgeonOrName) {
  const name = surgeonOrName && typeof surgeonOrName === "object" ? surgeonOrName.name : surgeonOrName;
  const slug = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `silvis-call-${slug || "all"}.ics`;
}

// generateICS(events, calName, opts) -> the VCALENDAR text. Events carrying
// `tzid` are written as DTSTART;TZID=<tz>:<local stamp> and the calendar gets
// one VTIMEZONE block for that zone (opts.tz === false suppresses both);
// events without tzid keep the old floating/UTC form. UIDs come from the
// event when present (stable per day + role) - a random one otherwise.
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
    if (useTz && e.tzid) lines.push(`DTSTART;TZID=${e.tzid}:${e.start}`, `DTEND;TZID=${e.tzid}:${e.end}`);
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
   Outfit web font with a system fallback, NO scripts. Per month: the Mon..Sun
   grid the app shows (two lines per day, "P <name>" / "B <name>", OPEN in
   red, an externalCover in italics, holiday unit names, vacation lines) and
   the ER-panel author's week-rows table for that month (buildWeekRows). `months` follows
   normalizeMonths(); default = the schedule's span. opts.today (default
   todayCentral()): an unassigned slot before today renders an empty line
   (the P/B letter stays, no OPEN text, no red) - slotIsOpen decides. */
function generateShareHTML(schedule, roster, opts) {
  const o = opts || {};
  const sched = schedule || {};
  const list = (roster || []).filter(r => r && r.id);
  const months = normalizeMonths(o.months, sched);
  const holByDay = holidayNameByDay(o.holidays);
  const vacations = o.vacations || {};
  const generatedAt = o.generatedAt ? new Date(o.generatedAt) : new Date();
  const today = todayOrCentral(o.today);
  const nameById = {}, colorById = {};
  list.forEach((r, i) => { nameById[r.id] = r.name || r.id; colorById[r.id] = exportColorsFor(r, i); });
  const nameOf = (id) => nameById[id] || id;
  const pill = (id) => { const c = colorById[id] || EXPORT_PAL[6]; return `<span class="bdg" style="background:${c.tg};color:${c.tx};border-color:${c.bd}">${escHtml(nameOf(id))}</span>`; };
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
    let grid = `<div class="cg">` + ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((h, i) => `<div class="ch${i >= 4 ? " wk" : ""}">${h}</div>`).join("");
    for (let d = monOf(first); d <= last || (fmt(d) > range.end && parse(fmt(d)).getDay() !== 1); d = addD(d, 1)) {
      const ds = fmt(d);
      if (ds < range.start || ds > range.end) { grid += `<div class="ce"></div>`; continue; }
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
    }
    grid += `</div>`;
    const rows = buildWeekRows(sched, list, range.start, range.end, { today });
    let table = `<table class="wr" data-month="${range.start.slice(0, 7)}"><thead><tr><th>MON/SUN DATES</th><th>TRAUMA</th><th>TRAUMA BACKUP</th></tr></thead><tbody>`;
    rows.forEach(r => { table += `<tr data-week="${r.monday}"><td class="wd">${escHtml(r.label)}</td><td>${r.primary.map(entryHtml).join("")}</td><td>${r.backup.map(entryHtml).join("")}</td></tr>`; });
    table += `</tbody></table>`;
    body += `<section class="mo" data-month="${range.start.slice(0, 7)}"><h2 class="mh">${escHtml(monthLabel(ym))}</h2>${grid}<h3 class="wh">Week rows - ${escHtml(monthLabel(ym))}</h3><div class="tw">${table}</div></section>`;
  });

  const legend = list.map((s, i) => { const c = colorById[s.id]; return `<span><span class="sw" style="background:${c.tg};border-color:${c.bd}"></span>${escHtml(s.name)} <code>${escHtml(s.code || "")}</code></span>`; }).join("");
  const span = months.length === 1 ? monthLabel(months[0]) : `${monthLabel(months[0])} to ${monthLabel(months[months.length - 1])}`;
  const stamp = `${generatedAt.getMonth() + 1}/${generatedAt.getDate()}/${generatedAt.getFullYear()} ${String(generatedAt.getHours()).padStart(2, "0")}:${String(generatedAt.getMinutes()).padStart(2, "0")}`;
  const css = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Outfit',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f0f2f5;color:#2c3e50;padding:16px;max-width:1100px;margin:0 auto}
.hd{text-align:center;margin-bottom:16px;padding:18px;background:#fff;border:1px solid #dce2e8;border-radius:12px}
.hd h1{font-size:20px;color:#1a2a3a;margin-bottom:4px}.hd p{font-size:12px;color:#6a7a88;line-height:1.5}
.hd a{color:#1a6fa8}
.ro{text-align:center;margin-bottom:16px;padding:8px 16px;background:#fff;border:1px solid #dce2e8;border-radius:8px;font-size:11px;color:#1a6fa8}
.mo{background:#fff;border:1px solid #dce2e8;border-radius:10px;margin-bottom:16px;padding:14px;overflow:hidden}
.mh{font-size:16px;font-weight:700;color:#1a2a3a;margin-bottom:10px;text-align:center}
.wh{font-size:12px;font-weight:700;color:#1a6fa8;margin:14px 0 6px;text-transform:uppercase;letter-spacing:1px}
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
<style>${css}</style></head>
<body>
<div class="hd"><h1>Silvis Surgical Care - Trauma / Acute Care Surgery Call</h1><p>${escHtml(span)} &middot; primary (P, in Silvis) and backup (B) &middot; one 24-hour shift per day, 07:00 to 07:00${o.appUrl ? ` &middot; live schedule: <a href="${escHtml(o.appUrl)}">${escHtml(o.appUrl)}</a>` : ""}</p></div>
<div class="ro">Read-only snapshot generated ${escHtml(stamp)}. Changes made after this time are not shown - the live app is the source of truth.</div>
<div class="lg">${legend}<span><span class="open">OPEN</span> = nobody assigned</span><span><span class="ext">Atwell (ext)</span> = external cover</span><span>Fri-Sun tinted = weekend unit</span><span>gold = holiday unit</span><span>VAC = on vacation</span></div>
${body}
<div class="ft">Silvis Call Schedule &middot; generated ${escHtml(stamp)}</div>
</body></html>`;
}

/* ═══ Printable month (Prompt 9) ═══
   buildPrintableCalendarHTML({ startYear, startMonth, numMonths, schedule,
   roster, holidays, vacations }) -> a print-ready document: Davenport's page
   assembly and print CSS (letter portrait, one month per page, Sunday-first
   grid, mini calendars in the leading empty cells, vacation bars laid out in
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
  const MONTH_NAMES = EXPORT_MONTH_NAMES;
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
    gridStart.setDate(first.getDate() - first.getDay());
    const weeks = [];
    let cursor = new Date(gridStart);
    while (cursor <= last || cursor.getDay() !== 0) {
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
    const startDow = first.getDay();
    const days = last.getDate();
    let html = `<div class="mini-cal"><div class="mini-name">${MONTH_NAMES[month]} ${year}</div><div class="mini-grid">`;
    ["S","M","T","W","T","F","S"].forEach(d => { html += `<div class="mini-dow">${d}</div>`; });
    for (let i = 0; i < startDow; i++) html += `<div class="mini-day empty">0</div>`;
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
    html += `<div class="dow-row">`;
    ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].forEach(d => html += `<div class="dow">${d}</div>`);
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
    .toolbar button { font-family: Arial, Helvetica, sans-serif; font-size: 13px; font-weight: 600; padding: 8px 18px; background: linear-gradient(135deg,#1a6fa8,#2488c8); color: #fff; border: 1px solid #1a6fa8; border-radius: 6px; cursor: pointer; margin: 0 4px; }
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
  `;

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
  <button onclick="window.print()">Print</button>
  <button class="secondary" onclick="
    try { window.close(); } catch(e) { console.warn('close blocked by the browser', e); }
    setTimeout(function() {
      if (!window.closed) {
        document.body.innerHTML = '<div style=\\'text-align:center;padding:60px 20px;font-family:Arial,Helvetica,sans-serif;color:#5a6a78\\'>You can close this tab now.</div>';
      }
    }, 100);
  ">Close</button>
  <span class="hint">Use your browser's print dialog. Choose Letter portrait, default margins. If colours do not print, enable Background graphics under More settings.</span>
</div>
${pages}
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
// suOpenPrimaryDays(schedule, fromIso, count) -> days in [from, from+count) with no primary and no external cover.
function suOpenPrimaryDays(schedule, fromIso, count) {
  const out = [];
  const sched = schedule || {};
  for (let k = 0; k < (count || 60); k++) {
    const d = suAddDays(fromIso, k);
    if (!dayHolder(sched[d] || null, "primary")) out.push(d);
  }
  return out;
}
// suCoverageGlance(schedule, fromIso, count, eastForecast, threshold) -> the
// "coverage at a glance" numbers for the next `count` days from fromIso
// (Prompt 11): open primary days, open backup days, and days where a surgeon
// whose East forecast is at/above the threshold holds PRIMARY (should be 0 -
// the generator treats those days as busy). eastForecast is
// { surgeonId: { day: probability } } (ctxInputs.eastForecast shape). Pure.
//   -> { openPrimary: [days], openBackup: [days], forecastPrimary: [{ day, id, p }] }
function suCoverageGlance(schedule, fromIso, count, eastForecast, threshold) {
  const sched = schedule || {};
  const out = { openPrimary: [], openBackup: [], forecastPrimary: [] };
  if (!suIsIso(fromIso)) return out;
  const th = typeof threshold === "number" ? threshold : 0.5;
  const fc = eastForecast || {};
  for (let k = 0; k < (count || 60); k++) {
    const d = suAddDays(fromIso, k);
    const a = sched[d] || null;
    if (!dayHolder(a, "primary")) out.openPrimary.push(d);
    if (!dayHolder(a, "backup")) out.openBackup.push(d);
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
    roster.forEach(r => { if (r && r.id && r.active !== false && !(i.surgeonRules && i.surgeonRules[r.id])) out.push("No rules for " + (r.name || r.id) + " (" + r.id + ") - every active surgeon needs a surgeonRules entry"); });
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
   last Monday of May, July 4th = 07-04, Labor Day = first Monday of
   September, Thanksgiving = fourth Thursday of November (a single day by
   default - the rules doc leaves Thu-only vs Thu-Sun open per year),
   Christmas = 12-24 + 12-25, New Year's = 12-31 + 01-01 of the next year,
   keyed under the eve's year like the seed. opts.tiers is the seed's
   holidays.rules.tiers shape ({ major: [names], minor: [names] }); a name in
   neither list keeps the standard tier. opts.mondayMinorAbsorbsWeekend ===
   true (the seed's groupRules.holidays flag): a MINOR holiday whose date is a
   Monday becomes [Sat, Sun, Mon] - "the unit is Sat-Mon; the Friday stays a
   standalone weekend day (the reduced weekend unit)"; any other date stays a
   single day (July 4 on a Monday - 2033 - absorbs; on a Sunday or a Tuesday
   it does not). Setup's Add year pre-fills a new year from this; the stored
   days remain authoritative and editable, and the engine reads only stored
   days. Pure, generic (no surgeon or year branches): local-midnight Date
   arithmetic through parse/fmt/addD above, never new Date("YYYY-MM-DD")
   (UTC parsing, which shifts a day west of Greenwich). */
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
  var single = {
    "Memorial Day": huNthWeekday(y, 5, 1, -1),
    "July 4th": ys + "-07-04",
    "Labor Day": huNthWeekday(y, 9, 1, 1),
    "Thanksgiving": huNthWeekday(y, 11, 4, 4)
  };
  return HU_ORDER.map(function (name) {
    var tier = tierOf[name], days, note = null;
    if (name === "Christmas") { days = [ys + "-12-24", ys + "-12-25"]; note = "Eve + Day as one unit"; }
    else if (name === "New Year's") { days = [ys + "-12-31", ns + "-01-01"]; note = "Eve + Day as one unit"; }
    else {
      var d = single[name], dt = parse(d);
      days = absorb && tier === "minor" && dt.getDay() === 1 ? [fmt(addD(dt, -2)), fmt(addD(dt, -1)), d] : [d];
    }
    var unit = { name: name, tier: tier, days: days };
    if (note) unit.note = note;
    return unit;
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    suIsIso, suAddDays, suDaysBetween, suMakeDate, suParseDateList, suCollapseDates, suNextMatchingDates,
    suHolidayCoverage, suHolidayCounts, suOpenPrimaryDays, suCoverageGlance, suAgeDays, suLastAssignedDay, suLastContiguousDay, suLaterAssignedRanges, suLockedSlotChanges, suSetupIssues,
    suMergePreview, suSeedDayMerge, suAvailKey, suMissingAvailability, suTimeOffKey, suMissingTimeOff, suFmtTs,
    fmt, parse, addD, monOf, getMondays, onVac, fmtMD, todayCentral, todayOrCentral, slotIsOpen,
    emptyDayAssignment, dayRowToAssignment, assignmentToDayRow, sameDayAssignment, mergeRealtimeDay, dayHolder, dayLockFlags,
    diffScheduleDays, holderLabel, formatDayChange, describePublishDiff,
    countPopulatedPrimary, scheduleWipeCheck, payloadLooksWipedDaily,
    tradeLegsText, tradeProposeMsg, tradeAcceptMsg, tradeDeclineMsg, slotLabel,
    tradeAppliedMsg, tradeCancelMsg, vacationLoggedMsg, manualEditMsg, schedulePublishedMsg,
    ttTotalsFor, ttRunThrough, ttDaysIn, ttRangeFor, ttDeviation, ttCsvText, ttIsIso,
    buildWeekRows,
    SURGEON_DARK_TEXT_BY_CODE, surgeonTextColor,
    escHtml, holidayNameByDay, monthsOfSchedule, normalizeMonths,
    icsDate, icsEscape, icsFold, icsVTimezone, buildICSEvents, icsFileName, generateICS,
    generateShareHTML, buildPrintableCalendarHTML,
    buildErCallPanelsHTML, buildErCallPanelsText, buildErCallPanelsDocument, erPanelSpan,
    defaultHolidayUnits, huNthWeekday, HU_ORDER, HU_STANDARD_TIER,
  };
}
