// Silvis Call Schedule - Date Helpers, daily-model data-layer helpers, ICS
// generation and download utilities.
// Ported from the Davenport app. Date/ICS/download utilities are kept as-is;
// the daily-model helpers (dayRowToAssignment ... payloadLooksWipedDaily) were
// added in Prompt 6 Slice A and are unit-tested by test/data-layer.test.js.
// The export builders are STUBS until Prompt 9 (exports).
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
  try { d = parse(String(dayStr)); } catch (e) { d = null; }
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
   Pure: no DOM, no state. Prompt 9's export reuses it. */
function buildWeekRows(schedule, roster, rangeStart, rangeEnd, opts) {
  const o = opts || {};
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

/* ═══ ICS Calendar Generation ═══ */
function icsDate(y,m,d,h,min) {
  return `${y}${String(m).padStart(2,"0")}${String(d).padStart(2,"0")}T${String(h).padStart(2,"0")}${String(min||0).padStart(2,"0")}00`;
}

// TODO(Prompt 9): build 07:00 -> 07:00 next-day events ("Silvis Primary Call" /
// "Silvis Backup Call", America/Chicago) from the daily schedule. Placeholder
// returns no events so the ICS buttons render without throwing.
function buildICSEvents(schedule, surgeonId, surgeonName) {
  return [];
}

function generateICS(events, calName) {
  const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2,9)}@callsched`;
  let ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Silvis Call Schedule//EN\r\nCALSCALE:GREGORIAN\r\nX-WR-CALNAME:${calName}\r\n`;
  events.forEach(e => {
    ics += `BEGIN:VEVENT\r\nUID:${uid()}\r\nDTSTART:${e.start}\r\nDTEND:${e.end}\r\nSUMMARY:${e.summary}\r\nDESCRIPTION:${e.desc}\r\nEND:VEVENT\r\n`;
  });
  ics += `END:VCALENDAR\r\n`;
  return ics;
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
  const text = JSON.stringify(obj, null, 2);
  const blob = new Blob([text], { type: "application/json" });
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

/* ═══ Printable month ═══
   TODO(Prompt 9): rebuild for the daily model (two lines per day cell:
   P name / B name; OPEN in red; externalCover label). Placeholder returns a
   minimal document so the Print button never throws. */
function buildPrintableCalendarHTML(opts) {
  const o = opts || {};
  const title = "Silvis Call Schedule - printable view (available after Prompt 9)";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${title}</title></head><body style="font-family:Arial,Helvetica,sans-serif;padding:24px;color:#333"><h2>${title}</h2><p>Requested: ${o.numMonths || "?"} month(s) from ${o.startYear || "?"}-${(o.startMonth != null ? o.startMonth + 1 : "?")}.</p></body></html>`;
}

// Node entry point for test/data-layer.test.js. A no-op in the browser.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    fmt, parse, addD, monOf, getMondays, onVac, fmtMD,
    emptyDayAssignment, dayRowToAssignment, assignmentToDayRow, sameDayAssignment, mergeRealtimeDay, dayHolder, dayLockFlags,
    diffScheduleDays, holderLabel, formatDayChange, describePublishDiff,
    countPopulatedPrimary, scheduleWipeCheck, payloadLooksWipedDaily,
    tradeLegsText, tradeProposeMsg, tradeAcceptMsg, tradeDeclineMsg, slotLabel,
    buildWeekRows,
    SURGEON_DARK_TEXT_BY_CODE, surgeonTextColor,
    icsDate, buildICSEvents, generateICS,
  };
}
