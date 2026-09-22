// Silvis Call Schedule - Date Helpers, ICS Generation & Utilities
// Ported from the Davenport app. Date/ICS/download utilities are kept as-is;
// the shift-model builders are STUBS until Prompt 9 (exports) and Prompt 6
// Slice G (trades) re-express them for one row per day with primary/backup.

/* ═══ Date helpers ═══ */
const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const parse = s => { const [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d); };
const addD = (d,n) => { const r=new Date(d); r.setDate(r.getDate()+n); return r; };
const monOf = d => { const r=new Date(d); r.setDate(r.getDate()-((r.getDay()+6)%7)); return r; };

function getMondays(yr,mo,numWeeks) {
  const ms=[], s=new Date(yr,mo,1);
  let d=monOf(s); if(d<s) d=addD(d,7);
  while(ms.length<numWeeks){ ms.push(new Date(d)); d=addD(d,7); }
  return ms;
}

function onVac(id,ds,v){ return (v[id]||[]).some(([a,b])=>ds>=a&&ds<=b); }

// Start date of a shift, for time-based gating (nav cleanup 2026-09-06):
// a night = its own date, the weekend = its Friday, a service week = its
// Monday — once a shift has STARTED it is history and trade/swap paths
// refuse it. The picker builders in index-source.html inline the same rule.
function shiftStartDate(mondayStr, shiftKey) {
  if (shiftKey === "dayCall") return mondayStr;
  const off = { mon: 0, tue: 1, wed: 2, thu: 3, wknd: 4 }[shiftKey];
  return off === undefined ? mondayStr : fmt(addD(parse(mondayStr), off));
}

/* ═══ TRADE MESSAGE COMPOSERS ═══
   One composition per trade event, shared by in-app and email channels.
   TODO(Prompt 6 Slice G): trades are by DAY + ROLE in Silvis; tradeLegsText
   below is a placeholder that tolerates both the legacy week/shift fields and
   the new day/role fields so nothing throws before the retarget. */
function tradeLegsText(req, tense) {
  // tense: "takes" (accepted) | "would take" (proposed) | "would have taken" (declined)
  const gets = slotLabel(req.day || req.week_monday, req.role || req.shift_key);
  if (!(req.return_day || req.return_week) || !(req.return_role || req.return_shift)) {
    return `${req.to_surgeon_name} ${tense} ${gets} (one-way - no return shift)`;
  }
  const back = slotLabel(req.return_day || req.return_week, req.return_role || req.return_shift);
  return `${req.to_surgeon_name} ${tense} ${gets}; ${req.from_surgeon_name} ${tense} ${back}`;
}
/* The SWAP family (2026-09-07), same doctrine as the trade composers above.
   executeTwoWaySwap's semantics, read off its own apply:
     the CANDIDATE (newName) takes targetShift @ targetMon
     the ORIGINAL holder (oldName) takes returnShift @ returnMon
   One-way swaps are a first-class feature here (the scheduler's emergency
   override), so they degrade explicitly rather than looking two-way.
   No leading "Shift swap —" label: the in-app title is already "Shift Swap"
   and the email header is "Schedule Change" — a label here would stutter
   against both, the defect caught in v16 by rendering the email body. */
function swapMsg(s) {
  const gets = slotLabel(s.targetMon, s.targetShift);
  if (!s.returnMon || !s.returnShift) {
    return `${s.newName} takes ${gets} (one-way — no return shift)`;
  }
  return `${s.newName} takes ${gets}; ${s.oldName} takes ${slotLabel(s.returnMon, s.returnShift)}`;
}
/* Cascade = the knock-on reassignment a trade forces on someone who was not
   party to it. Composed once and used for BOTH the in-app notification and
   the email that this PR adds (previously there was no email at all — the
   person with the least warning got the weakest notice). */
function cascadeMsg(c) {
  return `${slotLabel(c.week, c.shiftKey)} moved from ${c.fromName} to ${c.toName} due to a trade`;
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

// Dated slot label. TODO(Prompt 9 / Slice G): Silvis slots are (dayStr, role)
// where role is "primary" | "backup"; this placeholder renders that shape and
// degrades gracefully for the legacy (mondayStr, shiftKey) calls that remain in
// index-source.html until Prompt 6.
function slotLabel(dayStr, role) {
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let d;
  try { d = parse(String(dayStr)); } catch (e) { d = null; }
  if (!d || isNaN(d.getTime())) return `${dayStr || "?"} ${role || ""}`.trim();
  const md = `${DOW[d.getDay()]} ${MO[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
  if (role === "primary") return `Primary - ${md}`;
  if (role === "backup") return `Backup - ${md}`;
  return `${md}${role ? " - " + role : ""}`;
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
    // Open in a new view; user saves via Share → Save to Files.
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

/* ═══ Printable month ═══
   TODO(Prompt 9): rebuild for the daily model (two lines per day cell:
   P name / B name; OPEN in red; externalCover label). Placeholder returns a
   minimal document so the Print button never throws. */
function buildPrintableCalendarHTML(opts) {
  const o = opts || {};
  const title = "Silvis Call Schedule - printable view (available after Prompt 9)";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${title}</title></head><body style="font-family:Arial,Helvetica,sans-serif;padding:24px;color:#333"><h2>${title}</h2><p>Requested: ${o.numMonths || "?"} month(s) from ${o.startYear || "?"}-${(o.startMonth != null ? o.startMonth + 1 : "?")}.</p></body></html>`;
}
