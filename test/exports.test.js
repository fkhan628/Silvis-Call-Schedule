// Silvis Call Schedule - export builders (helpers.js, Prompt 9) unit test.
//   .ics      buildICSEvents / generateICS: all-day runs (DTSTART;VALUE=DATE /
//             DTEND;VALUE=DATE, exclusive end), stable UIDs, per-surgeon filtering,
//             group naming, nothing for an empty day, the same VEVENTs as the
//             calendar-sync feed's default (its @icsCore block is evaluated here).
//   ER panel  buildErCallPanelsHTML / Text / Document: the ER-panel author's exact header,
//             one row per Mon-Sun week, no collapsing across a week boundary,
//             OPEN in red, externalCover text.
//   share     generateShareHTML: a grid and a week-rows table per month, no
//             scripts, Outfit + system fallback, holiday / vacation / OPEN cells.
//   print     buildPrintableCalendarHTML: P/B strings, OPEN red, pages, bars.
// Then (network) the ER panel for 2026-11-02..2026-12-13 from the LIVE Silvis
// project (anon read of schedule_days + the roster in call_schedule_data),
// saved to test/ui/out/er-panel-2026-11-02-to-12-13.html and printed as text.
// Run: node test/exports.test.js   (exit 1 on any failure; EXPORTS_OFFLINE=1
// skips the live part and says so)
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const H = require(path.join(__dirname, "..", "helpers.js"));

let passed = 0, failed = 0;
const check = (name, fn) => {
  try { fn(); passed++; console.log("ok   " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n     " + (e && e.message || e)); }
};

const roster = [
  { id: "s1", name: "Khan", code: "FAK" }, { id: "s2", name: "Burchett", code: "MAB" }, { id: "s3", name: "Acton", code: "BDA" },
  { id: "s4", name: "Philip", code: "AFP" }, { id: "s5", name: "Fierce", code: "NF" }, { id: "s6", name: "Sarkar", code: "SRK" },
];
const day = (primary, backup, extra) => Object.assign({ primary: primary || null, backup: backup || null, primaryLocked: false, backupLocked: false, source: "manual", externalCover: null, note: null }, extra || {});

// Fixture around the Oct/Nov 2026 boundary. 2026-11-01 (Sun) is the CDT->CST
// fall-back date; the week boundary is Sun 11/1 -> Mon 11/2.
const schedule = {
  "2026-10-30": day("s2", "s3"),
  "2026-10-31": day("s1", "s2"),
  "2026-11-01": day("s1", "s2", { note: "Bring, the; pager" }),
  "2026-11-02": day("s1", "s2"),
  "2026-11-03": day(null, "s5", { externalCover: "Atwell" }),
  "2026-11-04": day(null, "s5", { externalCover: "Atwell" }),
  "2026-11-05": day(null, "s5", { externalCover: "Atwell" }),
  "2026-11-06": day(null, null),
  "2026-11-07": day("s2", "s3"),
  "2026-11-08": day("s2", "s3"),
  "2026-11-10": day("s4", null),
  "2026-11-26": day("s1", "s6"),
};
const holidays = { units: { "2026": [{ name: "Thanksgiving", tier: "major", days: ["2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"] }] } };
const vacations = { s3: [["2026-11-03", "2026-11-05"]] };
// OPEN is shown only from today (Central) forward (Faraz 9/22). Every builder
// below gets an explicit today so the suite never depends on the wall clock:
// TODAY_NOV keeps every fixture day open-eligible; TODAY_MID (Sat 11/7) puts
// 11/6 in the past and 11/9+ in the future.
const TODAY_NOV = "2026-11-01", TODAY_MID = "2026-11-07";

/* ---------------- ICS ----------------
   Since 2026-09-25 (Faraz: "the calendar looks busy, and 07:00 -> 07:00 shifts draw across two days") the download is
   ALL-DAY runs, the same events as the calendar-sync feed's default: one event per run of consecutive days (a surgeon's
   file: the same role; the group file: the same primary AND the same backup), DTSTART;VALUE=DATE the first day,
   DTEND;VALUE=DATE the day after the last (RFC 5545 exclusive end), the exact 07:00 -> 07:00 times in the description.
   The download has no timed mode (the feed keeps one behind ?timed=1). */
const all = H.buildICSEvents(schedule, null, roster, {});
const khan = H.buildICSEvents(schedule, "s1", roster, {});
const khanIcs = H.generateICS(khan, "Silvis Call - Khan");
const allIcs = H.generateICS(all, "Silvis Call - All");

check("ICS all-day runs: each event is DTSTART;VALUE=DATE the first day and DTEND;VALUE=DATE the day after the last (exclusive) - Khan's 10/31-11/2 run (across the fall-back) is ONE event 20261031 -> 20261103; no TZID, no timed stamp, no VTIMEZONE", () => {
  assert.deepStrictEqual(khan.map(x => [x.day, x.last, x.role, x.start, x.end, x.allDay]), [["2026-10-31", "2026-11-02", "primary", "20261031", "20261103", true], ["2026-11-26", "2026-11-26", "primary", "20261126", "20261127", true]]);
  assert.ok(khanIcs.includes("\r\nDTSTART;VALUE=DATE:20261031\r\nDTEND;VALUE=DATE:20261103\r\n"), "the all-day lines");
  assert.ok(!/TZID|T070000|VTIMEZONE|DTSTART:/.test(khanIcs), "no timed stamp, no zone");
});
check("ICS UID stability: 'silvis-<start>-<role>@silvis-call' per surgeon, 'silvis-<start>-group@silvis-call' for the group; identical across builds, unique", () => {
  assert.deepStrictEqual(khan.map(x => x.uid), ["silvis-2026-10-31-primary@silvis-call", "silvis-2026-11-26-primary@silvis-call"]);
  assert.strictEqual(all.find(x => x.day === "2026-10-31").uid, "silvis-2026-10-31-group@silvis-call");
  const again = H.buildICSEvents(schedule, null, roster, {});
  assert.deepStrictEqual(again.map(x => x.uid), all.map(x => x.uid));
  assert.strictEqual(new Set(all.map(x => x.uid)).size, all.length, "duplicate UIDs");
  assert.ok(khanIcs.includes("UID:silvis-2026-10-31-primary@silvis-call\r\n"));
});
check("ICS per-surgeon filtering: Khan's file holds only Khan's runs, titled exactly 'Silvis Primary' / 'Silvis Backup'; a role change splits Burchett's days into three runs", () => {
  khan.forEach(x => assert.strictEqual(x.surgeonId, "s1"));
  assert.deepStrictEqual([...new Set(khan.map(x => x.summary))], ["Silvis Primary"]);
  const burchett = H.buildICSEvents(schedule, "s2", roster, {});
  assert.deepStrictEqual(burchett.map(x => x.role + " " + x.day + ".." + x.last + " " + x.summary), ["primary 2026-10-30..2026-10-30 Silvis Primary", "backup 2026-10-31..2026-11-02 Silvis Backup", "primary 2026-11-07..2026-11-08 Silvis Primary"]);
  assert.ok(!/SUMMARY:Silvis (Primary|Backup) Call/.test(khanIcs), "the per-surgeon title has no 'Call' and no name");
});
check("ICS group naming: one event per run of the SAME primary AND backup, 'P <name> \u00b7 B <name>' (OPEN for an empty backup), runs ascending", () => {
  assert.deepStrictEqual(all.map(x => x.day + ".." + x.last + " " + x.summary), [
    "2026-10-30..2026-10-30 P Burchett \u00b7 B Acton",
    "2026-10-31..2026-11-02 P Khan \u00b7 B Burchett",
    "2026-11-03..2026-11-05 P Atwell (external cover) \u00b7 B Fierce",
    "2026-11-07..2026-11-08 P Burchett \u00b7 B Acton",
    "2026-11-10..2026-11-10 P Philip \u00b7 B OPEN",
    "2026-11-26..2026-11-26 P Khan \u00b7 B Sarkar",
  ]);
  assert.ok(allIcs.includes("SUMMARY:P Khan \u00b7 B Burchett\r\n"), "the middle dot is written as UTF-8");
  all.forEach(x => { assert.strictEqual(x.role, "group"); assert.strictEqual(x.surgeonId, null); });
});
check("ICS emits nothing for a day with neither assignment (11/6, or a cover-only day); an externalCover names the primary of the group bar and of Fierce's backup run - it is never an event of its own", () => {
  assert.ok(!all.some(x => x.day <= "2026-11-06" && x.last >= "2026-11-06"), "11/6 is inside no event");
  const fierce = H.buildICSEvents(schedule, "s5", roster, {});
  assert.deepStrictEqual(fierce.map(x => [x.day, x.last, x.role, x.desc]), [["2026-11-03", "2026-11-05", "backup", "07:00 Tue \u2192 07:00 Fri (Central)\nPrimary: Atwell (external cover)\nBackup: Fierce"]]);
  assert.ok(!all.concat(fierce).some(x => /^Atwell|Silvis .* - Atwell/.test(x.summary)), "an external cover became an event");
  assert.deepStrictEqual(H.buildICSEvents({ "2026-11-03": day(null, null, { externalCover: "Atwell" }) }, null, roster, {}), []);
});
check("ICS DESCRIPTION: '07:00 <Wkd> \u2192 07:00 <Wkd> (Central)' then 'Primary: ...' / 'Backup: ...' (the other role per day when it changes) - the day's internal note never reaches a calendar (Faraz 9/25); RFC 5545 escaping and 75-octet folding; CRLF", () => {
  const k = khan[0];
  assert.strictEqual(k.desc, "07:00 Sat \u2192 07:00 Tue (Central)\nPrimary: Khan\nBackup: Burchett", "the fixture's 11/1 carries a note - it must not be in the description");
  assert.ok(!/Note:|Bring/.test(allIcs), "no note text in the .ics download");
  const mixed = H.buildICSEvents({ "2026-11-06": day("s1", "s2"), "2026-11-07": day("s1", "s3"), "2026-11-08": day("s1", "s3") }, "s1", roster, {});
  assert.deepStrictEqual(mixed.map(x => x.desc), ["07:00 Fri \u2192 07:00 Mon (Central)\nPrimary: Khan\nBackup: 11/6 Burchett, 11/7-11/8 Acton"]);
  const escIcs = H.generateICS(H.buildICSEvents({ "2026-11-05": day(null, "s1", { externalCover: "Lee, locum; a\\b" }) }, null, roster, {}), "Silvis Call - All");
  assert.ok(escIcs.includes("SUMMARY:P Lee\\, locum\\; a\\\\b (external cover) \u00b7 B Khan"), "comma / semicolon / backslash not escaped: " + escIcs.split("\r\n").filter(l => /Lee/.test(l)).join(" | "));
  assert.ok(allIcs.replace(/\r\n[ \t]/g, "").includes("(Central)\\nPrimary: Khan\\nBackup: Burchett"), "newline not escaped as \\n (checked on the unfolded text: the description line is folded at 75 octets)");
  allIcs.split("\r\n").forEach(l => assert.ok(Buffer.byteLength(l, "utf8") <= 75, "line over 75 octets: " + l));
  assert.ok(!/[^\r]\n/.test(allIcs), "a bare LF slipped in");
  assert.ok(allIcs.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Silvis Call Schedule//EN\r\n") && allIcs.endsWith("END:VCALENDAR\r\n"));
  assert.ok(/DTSTAMP:\d{8}T\d{6}Z/.test(allIcs));
});
check("ICS range option {from,to} filters days inclusively before the runs are merged", () => {
  const r = H.buildICSEvents(schedule, null, roster, { from: "2026-11-01", to: "2026-11-02" });
  assert.deepStrictEqual(r.map(x => [x.day, x.last, x.uid]), [["2026-11-01", "2026-11-02", "silvis-2026-11-01-group@silvis-call"]]);
});
check("ICS file names: silvis-call-<lastname>.ics per surgeon, silvis-call-all.ics for the group", () => {
  assert.strictEqual(H.icsFileName(roster[0]), "silvis-call-khan.ics");
  assert.strictEqual(H.icsFileName("Burchett"), "silvis-call-burchett.ics");
  assert.strictEqual(H.icsFileName(null), "silvis-call-all.ics");
});
check("generateICS stays backward compatible: events without tzid or allDay get plain DTSTART and no VTIMEZONE; tzid events still get TZID lines + one VTIMEZONE; opts.tz=false suppresses the zone", () => {
  const legacy = H.generateICS([{ start: "20261031T070000", end: "20261101T070000", summary: "x", desc: "y" }], "Legacy");
  assert.ok(legacy.includes("DTSTART:20261031T070000\r\n") && !legacy.includes("VTIMEZONE") && /UID:[^\r]+@silvis-call/.test(legacy));
  const tzEv = [{ uid: "a@silvis-call", tzid: "America/Chicago", start: "20261031T070000", end: "20261101T070000", summary: "x", desc: "y" }];
  const tz = H.generateICS(tzEv, "Tz");
  assert.ok(tz.includes("DTSTART;TZID=America/Chicago:20261031T070000\r\n") && (tz.match(/BEGIN:VTIMEZONE/g) || []).length === 1 && tz.includes("X-WR-TIMEZONE:America/Chicago\r\n"));
  const noTz = H.generateICS(tzEv, "Tz", { tz: false });
  assert.ok(!noTz.includes("VTIMEZONE") && noTz.includes("DTSTART:20261031T070000\r\n"));
});

/* ---------------- ER Call Panels ---------------- */
const er = H.buildErCallPanelsHTML(schedule, roster, "2026-10-26", "2026-11-15", { today: TODAY_NOV });
const cellText = (html) => html.replace(/<br\s*\/?>/g, " | ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
const erRows = (html) => Array.from(html.matchAll(/<tr data-week="(\d{4}-\d{2}-\d{2})">([\s\S]*?)<\/tr>/g)).map(m => ({ week: m[1], cells: Array.from(m[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map(c => cellText(c[1])) }));

check("ER panel header text is exactly MON/SUN DATES | TRAUMA | TRAUMA BACKUP, in that order", () => {
  const ths = Array.from(er.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)).map(m => cellText(m[1]));
  assert.deepStrictEqual(ths, ["MON/SUN DATES", "TRAUMA", "TRAUMA BACKUP"]);
  assert.ok(er.startsWith("<table") && er.endsWith("</table>"), "the builder returns just the <table>");
  assert.ok(/<thead>[\s\S]*<\/thead><tbody>/.test(er));
});
check("ER panel: one row per Mon-Sun week covering the range (10/26..11/15 -> 3 rows), labelled 'M/D - M/D'", () => {
  const rows = erRows(er);
  assert.deepStrictEqual(rows.map(r => r.week), ["2026-10-26", "2026-11-02", "2026-11-09"]);
  assert.deepStrictEqual(rows.map(r => r.cells[0]), ["10/26 - 11/1", "11/2 - 11/8", "11/9 - 11/15"]);
  rows.forEach(r => assert.strictEqual(r.cells.length, 3));
});
check("ER panel: a same-surgeon run does NOT collapse across the week boundary (Khan 10/31-11/1 in one row, '11/2 Khan' in the next)", () => {
  const rows = erRows(er);
  const w1 = rows.find(r => r.week === "2026-10-26"), w2 = rows.find(r => r.week === "2026-11-02");
  assert.ok(/10\/31-11\/1 Khan/.test(w1.cells[1]), w1.cells[1]);
  assert.ok(/^11\/2 Khan \| /.test(w2.cells[1]), w2.cells[1]);
  assert.ok(!/10\/31-11\/2/.test(er), "collapsed across the week boundary");
  assert.ok(/11\/7-11\/8 Burchett/.test(w2.cells[1]) && /11\/7-11\/8 Acton/.test(w2.cells[2]), "in-week collapse missing");
});
check("ER panel: open days are 'M/D OPEN' in a red bold span, one per day (never collapsed), one entry per line (<br>)", () => {
  assert.ok(er.includes('<span data-kind="open" style="color:#ff0000;font-weight:bold">11/6 OPEN</span>'), "11/6 OPEN red span missing");
  const w3 = erRows(er).find(r => r.week === "2026-11-09");
  assert.deepStrictEqual(w3.cells[1].split(" | "), ["11/9 OPEN", "11/10 Philip", "11/11 OPEN", "11/12 OPEN", "11/13 OPEN", "11/14 OPEN", "11/15 OPEN"]);
  assert.ok(er.includes("</span><br><span"), "entries are not <br>-separated");
  assert.ok(!/OPEN[^<]*<\/span><br><span[^>]*>\d+\/\d+-\d+\/\d+ OPEN/.test(er), "OPEN days collapsed");
});
check("ER panel: an external cover reads 'M/D-M/D Atwell' (not OPEN, not red) and its backup column still lists the surgeon", () => {
  const w2 = erRows(er).find(r => r.week === "2026-11-02");
  assert.ok(/11\/3-11\/5 Atwell/.test(w2.cells[1]), w2.cells[1]);
  assert.ok(er.includes('<span data-kind="external">11/3-11/5 Atwell</span>'));
  assert.ok(/11\/3-11\/5 Fierce/.test(w2.cells[2]), w2.cells[2]);
});
check("ER panel (exp-001): a mid-week range lists WHOLE Mon-Sun weeks by default (from 11/4 -> the 11/2 row still starts '11/2 Khan' under label '11/2 - 11/8'); the document title and erPanelSpan report the widened span", () => {
  const full = erRows(H.buildErCallPanelsHTML(schedule, roster, "2026-11-04", "2026-11-08", { today: TODAY_NOV }));
  assert.strictEqual(full.length, 1);
  assert.strictEqual(full[0].cells[0], "11/2 - 11/8");
  assert.ok(/^11\/2 Khan \| 11\/3-11\/5 Atwell/.test(full[0].cells[1]), full[0].cells[1]);
  // the visible-month default (Oct 2026) keeps 9/28-9/30 and 11/1 in their rows
  const oct = erRows(H.buildErCallPanelsHTML(schedule, roster, "2026-10-01", "2026-10-31", { today: "2026-09-01" }));
  assert.strictEqual(oct[0].cells[0], "9/28 - 10/4");
  assert.ok(oct[0].cells[1].startsWith("9/28"), "first row must start on Monday 9/28, got " + oct[0].cells[1]);
  assert.ok(/11\/1/.test(oct[oct.length - 1].cells[1]) && oct[oct.length - 1].cells[0] === "10/26 - 11/1", "last row must include Sunday 11/1: " + oct[oct.length - 1].cells[1]);
  assert.deepStrictEqual(H.erPanelSpan("2026-10-01", "2026-10-31"), { from: "2026-09-28", to: "2026-11-01", widened: true });
  assert.deepStrictEqual(H.erPanelSpan("2026-11-02", "2026-12-13"), { from: "2026-11-02", to: "2026-12-13", widened: false });
  const doc = H.buildErCallPanelsDocument(schedule, roster, "2026-10-01", "2026-10-31", { today: "2026-09-01" });
  assert.ok(doc.includes("<title>ER Call Panels - Silvis Surgical Care - 9/28 to 11/1</title>"), "document title must name the whole-week span");
  const txt = H.buildErCallPanelsText(schedule, roster, "2026-11-04", "2026-11-08", { today: TODAY_NOV }).split("\n");
  assert.ok(txt[1].startsWith("11/2 - 11/8\t11/2 Khan; "), txt[1]);
});
check("ER panel: clipToRange:true is an explicit opt-in - only in-range days, and the row label shrinks to the clipped span (never a full-week label over a partial row)", () => {
  const clipped = erRows(H.buildErCallPanelsHTML(schedule, roster, "2026-11-04", "2026-11-08", { clipToRange: true, today: TODAY_NOV }));
  assert.strictEqual(clipped.length, 1);
  assert.strictEqual(clipped[0].cells[0], "11/4 - 11/8");
  assert.ok(/^11\/4-11\/5 Atwell \| 11\/6 OPEN/.test(clipped[0].cells[1]), clipped[0].cells[1]);
  const one = erRows(H.buildErCallPanelsHTML(schedule, roster, "2026-11-06", "2026-11-06", { clipToRange: true, today: TODAY_NOV }));
  assert.strictEqual(one[0].cells[0], "11/6");
  const doc = H.buildErCallPanelsDocument(schedule, roster, "2026-11-04", "2026-11-08", { clipToRange: true, today: TODAY_NOV });
  assert.ok(doc.includes("<title>ER Call Panels - Silvis Surgical Care - 11/4 to 11/8</title>"));
});
check("ER panel: names are HTML-escaped; every cell is inline-styled (Word paste keeps borders); text twin is tab-separated; document wraps the table with a title", () => {
  const evil = H.buildErCallPanelsHTML({ "2026-11-02": day(null, null, { externalCover: "<b>x</b>" }) }, roster, "2026-11-02", "2026-11-02");
  assert.ok(evil.includes("&lt;b&gt;x&lt;/b&gt;") && !evil.includes("<b>x</b>"));
  assert.ok(!/<td>/.test(er) && !/<th>/.test(er), "a cell without inline style");
  const txt = H.buildErCallPanelsText(schedule, roster, "2026-10-26", "2026-11-15", { today: TODAY_NOV }).split("\n");
  assert.strictEqual(txt[0], "MON/SUN DATES\tTRAUMA\tTRAUMA BACKUP");
  assert.strictEqual(txt.length, 4);
  assert.ok(txt[1].startsWith("10/26 - 11/1\t") && txt[1].split("\t").length === 3);
  const doc = H.buildErCallPanelsDocument(schedule, roster, "2026-11-02", "2026-12-13");
  assert.ok(doc.startsWith("<!DOCTYPE html>") && doc.includes("<title>ER Call Panels - Silvis Surgical Care - 11/2 to 12/13</title>") && doc.includes('data-export="er-call-panels"'));
});

/* ---------------- Share page ---------------- */
const share = H.generateShareHTML(schedule, roster, { months: ["2026-10", "2026-11"], holidays, vacations, generatedAt: new Date(2026, 8, 22, 9, 5), today: TODAY_NOV });
check("share page: a month grid AND a week-rows table for each requested month, in order", () => {
  const sections = Array.from(share.matchAll(/<section class="mo" data-month="(\d{4}-\d{2})">/g)).map(m => m[1]);
  assert.deepStrictEqual(sections, ["2026-10", "2026-11"]);
  const tables = Array.from(share.matchAll(/<table class="wr" data-month="(\d{4}-\d{2})">/g)).map(m => m[1]);
  assert.deepStrictEqual(tables, ["2026-10", "2026-11"]);
  assert.strictEqual((share.match(/<div class="cg">/g) || []).length, 2);
  assert.strictEqual((share.match(/<div class="ch(?: wk)?">/g) || []).length, 14, "7 day headers per grid");
  // November 2026: 30 day cells; the grid is Sunday-first by default (Item A, Faraz 9/23): Sun 11/1 .. Sat 12/5
  // = 35 cells, 5 of them padding (the Monday-first 10/26..12/6 = 42 cells / 12 padding is the 'mon' setting below).
  const nov = share.slice(share.indexOf('data-month="2026-11">'), share.indexOf('<h3 class="wh">Week rows - November'));
  assert.strictEqual((nov.match(/class="cd[^"]*" data-day="2026-11-/g) || []).length, 30);
  assert.strictEqual((nov.match(/class="ce"/g) || []).length, 5, "Sunday-first November 2026 has 5 padding cells (12/1-12/5)");
  const novRows = Array.from(share.slice(share.indexOf('<table class="wr" data-month="2026-11">')).matchAll(/<tr data-week="(\d{4}-\d{2}-\d{2})">/g)).map(m => m[1]).slice(0, 5);
  assert.deepStrictEqual(novRows, ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"]);
});
/* ---------------- Item A (Faraz 9/23): the month grids start on Sunday, like the Davenport app ----------------
   helpers.monthGridDays(year, month0, weekStartsOn) is the ONE grid builder (calendar view, share page, printable);
   'sun' (default) runs from the Sunday on/before the 1st, 'mon' from the Monday. The week rows stay Mon-Sun. */
check("Item A helpers: monthGridDays is Sunday-first by default (first cell a Sunday, last a Saturday, whole weeks: Oct/Nov 2026 = 35, Aug 2026 = 42); 'mon' keeps the first cell a Monday (Nov 2026 = 42); weekdayLabels follow", () => {
  assert.strictEqual(typeof H.monthGridDays, "function", "helpers.monthGridDays is missing");
  assert.strictEqual(typeof H.weekdayLabels, "function", "helpers.weekdayLabels is missing");
  assert.strictEqual(typeof H.normalizeWeekStart, "function", "helpers.normalizeWeekStart is missing");
  for (let m = 0; m < 24; m++) {
    const y = 2026 + Math.floor(m / 12), mo = m % 12;
    const sun = H.monthGridDays(y, mo), mon = H.monthGridDays(y, mo, "mon");
    assert.strictEqual(H.parse(sun[0]).getDay(), 0, `${y}-${mo + 1} default: first cell ${sun[0]} is not a Sunday`);
    assert.strictEqual(H.parse(sun[sun.length - 1]).getDay(), 6, `${y}-${mo + 1} default: last cell ${sun[sun.length - 1]} is not a Saturday`);
    assert.ok(sun.length % 7 === 0 && sun.length >= 28 && sun.length <= 42, `${y}-${mo + 1} default: ${sun.length} cells`);
    assert.strictEqual(H.parse(mon[0]).getDay(), 1, `${y}-${mo + 1} mon: first cell ${mon[0]} is not a Monday`);
    assert.strictEqual(H.parse(mon[mon.length - 1]).getDay(), 0, `${y}-${mo + 1} mon: last cell ${mon[mon.length - 1]} is not a Sunday`);
    assert.ok(mon.length % 7 === 0 && mon.length >= 28 && mon.length <= 42, `${y}-${mo + 1} mon: ${mon.length} cells`);
    [sun, mon].forEach(g => { assert.ok(g.includes(H.fmt(new Date(y, mo, 1))) && g.includes(H.fmt(new Date(y, mo + 1, 0))), `${y}-${mo + 1}: the grid must hold the 1st and the last day`); });
  }
  assert.deepStrictEqual([H.monthGridDays(2026, 9)[0], H.monthGridDays(2026, 9).length, H.monthGridDays(2026, 9)[34]], ["2026-09-27", 35, "2026-10-31"], "October 2026 Sunday-first = 9/27..10/31");
  assert.deepStrictEqual([H.monthGridDays(2026, 9, "mon")[0], H.monthGridDays(2026, 9, "mon").length, H.monthGridDays(2026, 9, "mon")[34]], ["2026-09-28", 35, "2026-11-01"], "October 2026 Monday-first = 9/28..11/1");
  assert.deepStrictEqual([H.monthGridDays(2026, 10)[0], H.monthGridDays(2026, 10).length], ["2026-11-01", 35], "November 2026 Sunday-first = 11/1..12/5");
  assert.deepStrictEqual([H.monthGridDays(2026, 10, "mon")[0], H.monthGridDays(2026, 10, "mon").length], ["2026-10-26", 42], "November 2026 Monday-first = 10/26..12/6");
  assert.strictEqual(H.monthGridDays(2026, 7).length, 42, "August 2026 (starts on a Saturday) Sunday-first = 7/26..9/5");
  assert.strictEqual(H.monthGridDays(2026, 1).length, 28, "February 2026 (starts on a Sunday, 28 days) Sunday-first = 4 whole weeks");
  assert.deepStrictEqual(H.weekdayLabels(), ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  assert.deepStrictEqual(H.weekdayLabels("mon"), ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  assert.deepStrictEqual(H.weekdayLabels("sun", ["S", "M", "T", "W", "T", "F", "S"]), ["S", "M", "T", "W", "T", "F", "S"]);
  assert.deepStrictEqual(H.weekdayLabels("mon", ["S", "M", "T", "W", "T", "F", "S"]), ["M", "T", "W", "T", "F", "S", "S"]);
  // anything but 'mon' is Sunday (a missing / legacy / garbage stored value never breaks the grid)
  assert.deepStrictEqual([undefined, null, "", "sun", "monday", "MON", 1].map(H.normalizeWeekStart), ["sun", "sun", "sun", "sun", "sun", "sun", "sun"]);
  assert.strictEqual(H.normalizeWeekStart("mon"), "mon");
  assert.deepStrictEqual(H.monthGridDays(2026, 10, "garbage"), H.monthGridDays(2026, 10));
  // the week-based helpers are untouched: monOf is still the Monday, getMondays still Mondays
  assert.strictEqual(H.fmt(H.monOf(H.parse("2026-11-01"))), "2026-10-26");
  assert.strictEqual(H.fmt(H.getMondays(2026, 10, 1)[0]), "2026-11-02");
});
check("Item A share page: the grid header reads Sun..Sat with the wk class on Sun, Fri and Sat by default (the first cell of November 2026 is Sun 11/1, 35 cells); weekStartsOn 'mon' gives Mon..Sun with wk on Fri-Sun (10/26 first, 42 cells); the week rows are Mon-Sun either way", () => {
  const hdrs = (html, month) => { const g = html.slice(html.indexOf(`data-month="${month}">`)); return Array.from(g.slice(0, g.indexOf("</h3>")).matchAll(/<div class="ch( wk)?">([A-Za-z]+)<\/div>/g)).map(m => m[2] + (m[1] ? "*" : "")); };
  const cells = (html, month) => { const g = html.slice(html.indexOf(`data-month="${month}">`)); const grid = g.slice(0, g.indexOf('<h3 class="wh">')); return { n: (grid.match(/<div class="c[de]/g) || []).length, first: (grid.match(/data-day="(\d{4}-\d{2}-\d{2})"/) || [])[1], pad: (grid.match(/class="ce"/g) || []).length }; };
  assert.deepStrictEqual(hdrs(share, "2026-11"), ["Sun*", "Mon", "Tue", "Wed", "Thu", "Fri*", "Sat*"]);
  assert.deepStrictEqual(cells(share, "2026-11"), { n: 35, first: "2026-11-01", pad: 5 });
  assert.deepStrictEqual(cells(share, "2026-10"), { n: 35, first: "2026-10-01", pad: 4 }, "October 2026 Sunday-first: 9/27..10/31, four padding cells before Thu 10/1");
  const mon = H.generateShareHTML(schedule, roster, { months: ["2026-10", "2026-11"], holidays, vacations, generatedAt: new Date(2026, 8, 22, 9, 5), today: TODAY_NOV, weekStartsOn: "mon" });
  assert.deepStrictEqual(hdrs(mon, "2026-11"), ["Mon", "Tue", "Wed", "Thu", "Fri*", "Sat*", "Sun*"]);
  assert.deepStrictEqual(cells(mon, "2026-11"), { n: 42, first: "2026-11-01", pad: 12 });
  assert.deepStrictEqual(cells(mon, "2026-10"), { n: 35, first: "2026-10-01", pad: 4 }, "October 2026 Monday-first: 9/28..11/1, three padding cells before 10/1 and one after 10/31");
  // the weekend tint follows the day, not the column: 11/1 (Sun), 11/6 (Fri), 11/7 (Sat) carry .we in both modes; 11/2 (Mon) never
  [share, mon].forEach(html => {
    ["2026-11-01", "2026-11-06", "2026-11-07"].forEach(d => assert.ok(new RegExp(`class="cd we" data-day="${d}"`).test(html), d + " should be tinted as a weekend day"));
    assert.ok(/class="cd" data-day="2026-11-02"/.test(html), "11/2 (Mon) must not be tinted");
  });
  // The ER-panel author's week rows (MON/SUN DATES) are unchanged by the setting
  const rowsOf = (html) => Array.from(html.slice(html.indexOf('<table class="wr" data-month="2026-11">')).matchAll(/<tr data-week="(\d{4}-\d{2}-\d{2})">/g)).map(m => m[1]).slice(0, 5);
  assert.deepStrictEqual(rowsOf(mon), rowsOf(share));
  assert.deepStrictEqual(rowsOf(share), ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"]);
  assert.ok(share.includes("<th>MON/SUN DATES</th>") && mon.includes("<th>MON/SUN DATES</th>"));
  // the same cell content in both modes (only the padding moves)
  const cell = (html, d) => { const j = html.indexOf(`data-day="${d}"`); const i = html.lastIndexOf('<div class="cd', j); return html.slice(i, html.indexOf("</div></div>", j) + 12); };
  ["2026-10-31", "2026-11-03", "2026-11-06", "2026-11-26"].forEach(d => assert.strictEqual(cell(mon, d), cell(share, d), d));
});
check("share page cells: two-line P/B, OPEN in red class, externalCover label, holiday name, vacation line, note flag", () => {
  const cell = (d) => { const j = share.indexOf(`data-day="${d}"`); const i = share.lastIndexOf('<div class="cd', j); return share.slice(i, share.indexOf("</div></div>", j) + 12); };
  assert.ok(/<span class="rl">P<\/span><span class="bdg"[^>]*>Khan<\/span>/.test(cell("2026-10-31")), cell("2026-10-31"));
  assert.ok(/<span class="rl">B<\/span><span class="bdg"[^>]*>Burchett<\/span>/.test(cell("2026-10-31")));
  assert.strictEqual((cell("2026-11-06").match(/<span class="open">OPEN<\/span>/g) || []).length, 2);
  assert.ok(cell("2026-11-03").includes('<span class="ext">Atwell (ext)</span>'));
  assert.ok(cell("2026-11-26").includes('<span class="ht">Thanksgiving</span>') && /class="cd hol"/.test(cell("2026-11-26")));
  assert.ok(cell("2026-11-04").includes("VAC Acton"));
  assert.ok(cell("2026-11-01").includes(">NOTE</div>"));
  assert.ok(share.includes(".open{color:#c04040"));
});
check("share page week rows: OPEN red class, collapsed runs, external italics", () => {
  assert.ok(share.includes('<div class="wr-open">11/6 OPEN</div>'));
  assert.ok(share.includes('>10/31-11/1 Khan</div>') && share.includes('<div class="wr-ext">11/3-11/5 Atwell</div>'));
});
check("share page is self-contained: no <script>, inline <style>, Outfit from Google Fonts with a system fallback, generated stamp, read-only note", () => {
  assert.ok(!/<script/i.test(share));
  assert.ok(share.includes("<style>") && share.includes("fonts.googleapis.com/css2?family=Outfit"));
  assert.ok(/font-family:'Outfit',[^;]*sans-serif/.test(share));
  assert.ok(share.includes("Read-only snapshot generated 9/22/2026 09:05"));
  assert.ok(share.includes("<title>Silvis Call Schedule - October 2026 to November 2026</title>"));
  assert.ok(share.includes("MON/SUN DATES") && share.includes("<th>TRAUMA</th><th>TRAUMA BACKUP</th>"));
});
check("share page: months default to the schedule's span; {startYear,startMonth,numMonths} and [{year,month}] are accepted too", () => {
  const dflt = H.generateShareHTML(schedule, roster, {});
  assert.deepStrictEqual(Array.from(dflt.matchAll(/<section class="mo" data-month="(\d{4}-\d{2})">/g)).map(m => m[1]), ["2026-10", "2026-11"]);
  const three = H.generateShareHTML(schedule, roster, { months: { startYear: 2026, startMonth: 11, numMonths: 3 } });
  assert.deepStrictEqual(Array.from(three.matchAll(/<section class="mo" data-month="(\d{4}-\d{2})">/g)).map(m => m[1]), ["2026-12", "2027-01", "2027-02"]);
  const one = H.generateShareHTML(schedule, roster, { months: [{ year: 2026, month: 10 }] });
  assert.strictEqual((one.match(/<section class="mo"/g) || []).length, 1);
});

/* ---------------- Printable ---------------- */
const printable = H.buildPrintableCalendarHTML({ startYear: 2026, startMonth: 9, numMonths: 2, schedule, roster, holidays, vacations, today: TODAY_NOV });
check("printable: cells carry 'P <Name>' / 'B <Name>' lines, OPEN in red, the external cover, holiday unit names", () => {
  assert.ok(printable.includes('<span class="role">P</span> <span class="who">Khan</span>'));
  assert.ok(printable.includes('<span class="role">B</span> <span class="who">Burchett</span>'));
  assert.ok(printable.includes('<span class="role">P</span> <span class="open">OPEN</span>') && printable.includes('<span class="role">B</span> <span class="open">OPEN</span>'));
  assert.ok(printable.includes(".shift .open { color: #c00000"));
  assert.ok(printable.includes('<span class="ext">Atwell (ext)</span>'));
  assert.ok(printable.includes('<div class="holiday-note">Thanksgiving</div>'));
  const nov6 = printable.slice(printable.indexOf('data-day="2026-11-06"'), printable.indexOf('data-day="2026-11-07"'));
  assert.strictEqual((nov6.match(/class="open"/g) || []).length, 2);
});
check("printable: one .page per month (2), Sunday-first DOW ribbon, vacation bar '<Name> VAC', footer, print toolbar and @page CSS", () => {
  assert.strictEqual((printable.match(/<div class="page" data-month="/g) || []).length, 2);
  assert.ok(printable.includes('data-month="2026-10"') && printable.includes('data-month="2026-11"'));
  assert.ok(printable.includes('<div class="dow">Sunday</div><div class="dow">Monday</div>'));
  assert.ok(printable.includes('class="bar vac-surgeon"') && printable.includes(">Acton VAC</div>"));
  // Prompt 16 B8: the toolbar's handlers live in ONE inline <script> (its sha256 is a static entry in the app's
  // CSP meta - the popup inherits that policy; test/ci.test.js re-hashes it), never in onclick attributes.
  assert.ok(printable.includes("@page { size: letter portrait") && printable.includes('<button id="pp-print">Print</button>') && printable.includes('<button class="secondary" id="pp-close">Close</button>'));
  assert.strictEqual((printable.match(/<script>/g) || []).length, 1, "exactly one inline script (the toolbar)");
  assert.ok(printable.includes('document.getElementById("pp-print").addEventListener("click", function () { window.print(); });') && !/\son(click|load)=/.test(printable));
  assert.ok(printable.includes("Silvis Surgical Care - Trauma / Acute Care Surgery Call") && printable.includes("Printed "));
  assert.ok(!/DSG|Davenport|APP/.test(printable.replace(/APP_/g, "")), "Davenport wording left behind");
  assert.ok(!/[^\x00-\x7F]/.test(printable.replace(/&middot;/g, "")), "non-ASCII in the printable document");
});
check("Item A printable: Sunday-first by default (November 2026: 5 week rows, no empty cell in the first row, mini calendars S..S); weekStartsOn 'mon' starts the DOW ribbon on Monday, the mini calendars on M, and November 2026 becomes 6 rows with 6 leading empties", () => {
  const page = (html, month) => html.slice(html.indexOf(`<div class="page" data-month="${month}">`), html.indexOf('<div class="footer">', html.indexOf(`<div class="page" data-month="${month}">`)));
  const ribbon = (html) => Array.from(html.matchAll(/<div class="dow">([A-Za-z]+)<\/div>/g)).map(m => m[1]);
  const firstRowEmpties = (html) => { const r = html.slice(html.indexOf('<div class="week-row"'), html.indexOf('<div class="week-row"', html.indexOf('<div class="week-row"') + 10)); return (r.match(/<div class="cell empty">/g) || []).length; };
  const novSun = page(printable, "2026-11");
  assert.deepStrictEqual(ribbon(novSun), ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
  assert.strictEqual((novSun.match(/<div class="week-row"/g) || []).length, 5, "Sunday-first November 2026 is 5 rows (11/1 is a Sunday)");
  assert.strictEqual(firstRowEmpties(novSun), 0);
  assert.strictEqual((printable.match(/<div class="mini-dow">S<\/div><div class="mini-dow">M<\/div>/g) || []).length, (printable.match(/<div class="mini-grid">/g) || []).length, "every mini calendar starts S M");
  const mon = H.buildPrintableCalendarHTML({ startYear: 2026, startMonth: 9, numMonths: 2, schedule, roster, holidays, vacations, today: TODAY_NOV, weekStartsOn: "mon" });
  const novMon = page(mon, "2026-11");
  assert.deepStrictEqual(ribbon(novMon), ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
  assert.strictEqual((novMon.match(/<div class="week-row"/g) || []).length, 6, "Monday-first November 2026 is 6 rows (10/26..12/6)");
  assert.strictEqual(firstRowEmpties(novMon), 6, "Mon 10/26 .. Sat 10/31 are empty (two of them hold the mini calendars) before Sun 11/1");
  assert.ok((mon.match(/<div class="mini-grid">/g) || []).length >= 2 && (mon.match(/<div class="mini-dow">M<\/div><div class="mini-dow">T<\/div>/g) || []).length === (mon.match(/<div class="mini-grid">/g) || []).length, "every mini calendar starts M T");
  assert.strictEqual((mon.match(/<div class="mini-dow">S<\/div><div class="mini-dow">M<\/div>/g) || []).length, 0);
  // the December 2026 mini calendar in Monday mode: 12/1 is a Tuesday -> exactly one leading empty
  const miniDec = novMon.slice(novMon.indexOf("December 2026</div>"), novMon.indexOf("</div></div>", novMon.indexOf("December 2026</div>")));
  assert.strictEqual((miniDec.match(/<div class="mini-day empty">0<\/div>/g) || []).length, 1, miniDec.slice(0, 200));
  // the day cells are the same in both modes
  const cell = (html, d, next) => html.slice(html.indexOf(`data-day="${d}"`), html.indexOf(`data-day="${next}"`));
  assert.strictEqual(cell(mon, "2026-11-06", "2026-11-07"), cell(printable, "2026-11-06", "2026-11-07"));
  assert.strictEqual(cell(mon, "2026-11-26", "2026-11-27"), cell(printable, "2026-11-26", "2026-11-27"));
  assert.strictEqual((mon.match(/<div class="cell" data-day="2026-11-/g) || []).length, 30);
  assert.ok(!/[^\x00-\x7F]/.test(mon.replace(/&middot;/g, "")), "non-ASCII in the Monday-first printable");
});
check("printable: holidays accepted as the blob shape, a flat unit list or a day map; missing roster/vacations do not throw", () => {
  const flat = H.buildPrintableCalendarHTML({ startYear: 2026, startMonth: 10, numMonths: 1, schedule, roster, holidays: [{ name: "Thanksgiving", days: ["2026-11-26"] }] });
  assert.ok(flat.includes('<div class="holiday-note">Thanksgiving</div>'));
  const map = H.holidayNameByDay({ "2026-11-26": { name: "Thanksgiving", tier: "major" }, "2026-12-25": "Christmas" });
  assert.deepStrictEqual(map, { "2026-11-26": "Thanksgiving", "2026-12-25": "Christmas" });
  const bare = H.buildPrintableCalendarHTML({ startYear: 2026, startMonth: 10, numMonths: 1, schedule: {}, today: TODAY_NOV });
  assert.ok(bare.includes('<span class="open">OPEN</span>'));
});

/* ---------------- Item Q (Faraz 9/22): OPEN only from today (Central) forward ----------------
   today = Sat 11/7: 11/6 (open in both roles) is in the past, 11/9.. is the future. */
const shareMid = H.generateShareHTML(schedule, roster, { months: ["2026-11"], holidays, vacations, generatedAt: new Date(2026, 10, 7, 9, 5), today: TODAY_MID });
const shareCell = (html, d) => { const j = html.indexOf(`data-day="${d}"`); assert.ok(j > 0, "no cell " + d); const i = html.lastIndexOf('<div class="cd', j); return html.slice(i, html.indexOf("</div></div>", j) + 12); };
check("share page (today 11/7): the past open day 11/6 has NO <span class=\"open\"> in its cell (the P and B role letters stay), the future open day 11/9 still has two; the week rows drop '11/6 OPEN' and keep '11/9 OPEN'", () => {
  const c6 = shareCell(shareMid, "2026-11-06");
  assert.strictEqual((c6.match(/<span class="open">OPEN<\/span>/g) || []).length, 0, c6);
  assert.ok(!/OPEN/.test(c6), "OPEN text in a past cell: " + c6);
  assert.ok(c6.includes('<div class="ln"><span class="rl">P</span></div>') && c6.includes('<div class="ln"><span class="rl">B</span></div>'), "the empty P/B lines must keep their role letters: " + c6);
  const c9 = shareCell(shareMid, "2026-11-09");
  assert.strictEqual((c9.match(/<span class="open">OPEN<\/span>/g) || []).length, 2, c9);
  const c7 = shareCell(shareMid, "2026-11-07");
  assert.ok(/<span class="rl">P<\/span><span class="bdg"[^>]*>Burchett<\/span>/.test(c7), "assigned days are unchanged: " + c7);
  assert.ok(!shareMid.includes(">11/6 OPEN</div>"), "'11/6 OPEN' must not appear in the week rows");
  assert.ok(shareMid.includes('<div class="wr-open">11/9 OPEN</div>'), "'11/9 OPEN' must still appear");
  const row = shareMid.slice(shareMid.indexOf('<tr data-week="2026-11-02">'), shareMid.indexOf("</tr>", shareMid.indexOf('<tr data-week="2026-11-02">')));
  assert.deepStrictEqual(Array.from(row.matchAll(/<div class="wr-[a-z]+"[^>]*>([^<]*)<\/div>/g)).map(m => m[1]), ["11/2 Khan", "11/3-11/5 Atwell", "11/7-11/8 Burchett", "11/2 Burchett", "11/3-11/5 Fierce", "11/7-11/8 Acton"]);
  // the day of the boundary itself is OPEN when unassigned: 11/7 backup null -> shown
  const boundary = H.generateShareHTML({ "2026-11-07": day("s2", null) }, roster, { months: ["2026-11"], today: TODAY_MID });
  assert.strictEqual((shareCell(boundary, "2026-11-07").match(/<span class="open">OPEN<\/span>/g) || []).length, 1, "today inclusive");
});
const printMid = H.buildPrintableCalendarHTML({ startYear: 2026, startMonth: 10, numMonths: 1, schedule, roster, holidays, vacations, today: TODAY_MID });
check("printable (today 11/7): the 11/6 cell has no class=\"open\" and no OPEN text but keeps both role letters; 11/9 still has two red OPEN spans", () => {
  const cell = (html, d, next) => html.slice(html.indexOf(`data-day="${d}"`), html.indexOf(`data-day="${next}"`));
  const nov6 = cell(printMid, "2026-11-06", "2026-11-07");
  assert.strictEqual((nov6.match(/class="open"/g) || []).length, 0, nov6);
  assert.ok(!/OPEN/.test(nov6), nov6);
  assert.ok(nov6.includes('<div class="shift"><span class="role">P</span> </div>') && nov6.includes('<div class="shift"><span class="role">B</span> </div>'), "empty P/B lines keep the role letters: " + nov6);
  const nov9 = cell(printMid, "2026-11-09", "2026-11-10");
  assert.strictEqual((nov9.match(/<span class="open">OPEN<\/span>/g) || []).length, 2, nov9);
  const nov7 = cell(printMid, "2026-11-07", "2026-11-08");
  assert.ok(nov7.includes('<span class="role">P</span> <span class="who">Burchett</span>'), nov7);
});
check("ER panel (today 11/7): HTML has no data-kind=\"open\" span for 11/6, the text flavour has no '11/6 OPEN', the 11/9 row still lists its OPEN days; the document and clipToRange follow", () => {
  const html = H.buildErCallPanelsHTML(schedule, roster, "2026-11-02", "2026-11-15", { today: TODAY_MID });
  assert.ok(!html.includes("11/6 OPEN"), "11/6 OPEN leaked into the HTML");
  const rows = erRows(html);
  assert.deepStrictEqual(rows.map(r => r.week), ["2026-11-02", "2026-11-09"]);
  assert.strictEqual(rows[0].cells[1], "11/2 Khan | 11/3-11/5 Atwell | 11/7-11/8 Burchett");
  assert.strictEqual(rows[0].cells[2], "11/2 Burchett | 11/3-11/5 Fierce | 11/7-11/8 Acton");
  const w1 = html.slice(html.indexOf('<tr data-week="2026-11-02">'), html.indexOf('<tr data-week="2026-11-09">'));
  assert.strictEqual((w1.match(/data-kind="open"/g) || []).length, 0, w1);
  assert.deepStrictEqual(rows[1].cells[1].split(" | "), ["11/9 OPEN", "11/10 Philip", "11/11 OPEN", "11/12 OPEN", "11/13 OPEN", "11/14 OPEN", "11/15 OPEN"]);
  assert.ok(html.includes('<span data-kind="open" style="color:#ff0000;font-weight:bold">11/9 OPEN</span>'));
  const txt = H.buildErCallPanelsText(schedule, roster, "2026-11-02", "2026-11-15", { today: TODAY_MID }).split("\n");
  assert.strictEqual(txt[1], "11/2 - 11/8\t11/2 Khan; 11/3-11/5 Atwell; 11/7-11/8 Burchett\t11/2 Burchett; 11/3-11/5 Fierce; 11/7-11/8 Acton");
  assert.ok(txt[2].startsWith("11/9 - 11/15\t11/9 OPEN; 11/10 Philip; 11/11 OPEN"), txt[2]);
  const doc = H.buildErCallPanelsDocument(schedule, roster, "2026-11-02", "2026-11-08", { today: TODAY_MID });
  assert.ok(!doc.includes('data-kind="open"') && !doc.includes("11/6 OPEN"), "the document flavour still shows the past open day");
  const clipped = erRows(H.buildErCallPanelsHTML(schedule, roster, "2026-11-06", "2026-11-09", { clipToRange: true, today: TODAY_MID }));
  assert.deepStrictEqual(clipped.map(r => r.cells[1]), ["11/7-11/8 Burchett", "11/9 OPEN"]);
  // today itself is OPEN when unassigned
  const onDay = erRows(H.buildErCallPanelsHTML({ "2026-11-07": day("s2", null) }, roster, "2026-11-07", "2026-11-07", { clipToRange: true, today: TODAY_MID }));
  assert.deepStrictEqual([onDay[0].cells[1], onDay[0].cells[2]], ["11/7 Burchett", "11/7 OPEN"]);
});
check("exports default today (none given): a 2020 ER week / share month / printable month carry no OPEN, a 2099 week carries fourteen", () => {
  const past = H.buildErCallPanelsHTML({}, roster, "2020-01-06", "2020-01-12");
  assert.strictEqual((past.match(/data-kind="open"/g) || []).length, 0, "2020 must be blank under the default today");
  const future = H.buildErCallPanelsHTML({}, roster, "2099-01-05", "2099-01-11"); // Mon 1/5 .. Sun 1/11 2099: one week
  assert.strictEqual((future.match(/data-kind="open"/g) || []).length, 14);
  assert.ok(!/OPEN/.test(H.generateShareHTML({}, roster, { months: ["2020-01"] }).split('<div class="lg">')[1].split("</div>").slice(1).join("</div>")), "2020 share page shows OPEN outside the legend");
  assert.ok(!/<span class="open">/.test(H.buildPrintableCalendarHTML({ startYear: 2020, startMonth: 0, numMonths: 1, schedule: {} })), "2020 printable shows OPEN");
  assert.ok(/<span class="open">OPEN<\/span>/.test(H.buildPrintableCalendarHTML({ startYear: 2099, startMonth: 0, numMonths: 1, schedule: {} })), "2099 printable must show OPEN");
});

/* ---------------- STRICT ICS: parser, VTIMEZONE evaluation, edge-function parity ----------------
   An independent RFC 5545 reader (nothing shared with helpers.js): physical
   layer (CRLF, 75-octet raw lines, unfolding), content-line grammar, component
   nesting, required/once-only properties, then a VTIMEZONE evaluator that turns
   each DTSTART;TZID local stamp into a UTC instant from the RRULEs in the file
   (RFC 5545 3.6.5 semantics). Those instants are checked against the runtime tz
   database (Intl, America/Chicago) and against a port of the edge function's
   centralOffsetHours/icsDate, so the download and the subscribed feed put every
   shift at the same instants across the Nov 2026 fall-back and the Mar 2027
   spring-forward. */
const ICS = (() => {
  const fail = (m) => { throw new Error("ICS strict: " + m); };
  const LOCAL = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/, UTC = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;
  const unfold = (text) => {
    if (!text.endsWith("\r\n")) fail("file must end with CRLF");
    if (/\r(?!\n)/.test(text) || /(^|[^\r])\n/.test(text)) fail("bare CR or LF");
    const raw = text.split("\r\n"); raw.pop();
    const lines = [];
    raw.forEach((l, i) => {
      if (Buffer.byteLength(l, "utf8") > 75) fail(`raw line ${i + 1} exceeds 75 octets: ${l}`);
      if (/[\x00-\x08\x0a-\x1f\x7f]/.test(l)) fail(`control character in raw line ${i + 1}`);
      if (l[0] === " " || l[0] === "\t") { if (!lines.length) fail("continuation before any content line"); lines[lines.length - 1] += l.slice(1); }
      else { if (l === "") fail(`empty content line at raw line ${i + 1}`); lines.push(l); }
    });
    return lines;
  };
  const parseLine = (line) => {
    let i = 0, name = "";
    while (i < line.length && /[A-Za-z0-9-]/.test(line[i])) name += line[i++];
    if (!name) fail("property without a name: " + line);
    const params = {};
    while (line[i] === ";") {
      i++; let pn = "";
      while (i < line.length && /[A-Za-z0-9-]/.test(line[i])) pn += line[i++];
      if (line[i] !== "=") fail("parameter without '=': " + line);
      i++; const vals = [];
      for (;;) {
        let v = "";
        if (line[i] === '"') { i++; while (i < line.length && line[i] !== '"') v += line[i++]; if (line[i] !== '"') fail("unterminated quoted parameter: " + line); i++; }
        else { while (i < line.length && !/[;:,]/.test(line[i])) v += line[i++]; if (v.indexOf('"') >= 0) fail("DQUOTE in an unquoted parameter: " + line); }
        vals.push(v);
        if (line[i] === ",") { i++; continue; }
        break;
      }
      params[pn.toUpperCase()] = vals;
    }
    if (line[i] !== ":") fail("no ':' after name/params: " + line);
    return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
  };
  const parseTree = (lines) => {
    const root = { name: "ROOT", props: [], children: [] }, stack = [root];
    lines.forEach(l => {
      const p = parseLine(l);
      if (p.name === "BEGIN") { const c = { name: p.value, props: [], children: [] }; stack[stack.length - 1].children.push(c); stack.push(c); return; }
      if (p.name === "END") { const top = stack.pop(); if (!top || top.name !== p.value) fail(`END:${p.value} does not close BEGIN:${top && top.name}`); return; }
      stack[stack.length - 1].props.push(p);
    });
    if (stack.length !== 1) fail("unterminated component " + stack[stack.length - 1].name);
    return root;
  };
  const one = (c, n) => { const xs = c.props.filter(p => p.name === n); if (xs.length !== 1) fail(`${c.name}: ${n} must appear exactly once (found ${xs.length})`); return xs[0]; };
  const atMostOne = (c, n) => { const xs = c.props.filter(p => p.name === n); if (xs.length > 1) fail(`${c.name}: ${n} appears ${xs.length} times`); return xs[0] || null; };
  const msLocal = (s) => { const m = LOCAL.exec(s); if (!m) fail("not a local DATE-TIME: " + s); return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]); };
  const offMin = (s) => { const m = /^([+-])(\d{2})(\d{2})$/.exec(s); if (!m) fail("bad UTC offset " + s); return (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +m[3]); };
  const nthWeekday = (y, m1, dow, n) => {
    if (n > 0) { const first = new Date(Date.UTC(y, m1 - 1, 1)); const off = (dow - first.getUTCDay() + 7) % 7; return Date.UTC(y, m1 - 1, 1 + off + 7 * (n - 1)); }
    const last = new Date(Date.UTC(y, m1, 0)); const off = (last.getUTCDay() - dow + 7) % 7; return Date.UTC(y, m1 - 1, last.getUTCDate() - off + 7 * (n + 1));
  };
  const DOWS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  const buildTz = (vt) => {
    const tzid = one(vt, "TZID").value;
    const obs = vt.children.filter(c => c.name === "STANDARD" || c.name === "DAYLIGHT");
    if (!obs.length) fail("VTIMEZONE " + tzid + " has no STANDARD/DAYLIGHT observance");
    const parsed = obs.map(o => {
      const m = LOCAL.exec(one(o, "DTSTART").value); if (!m) fail("observance DTSTART must be a local DATE-TIME");
      const from = offMin(one(o, "TZOFFSETFROM").value), to = offMin(one(o, "TZOFFSETTO").value);
      const rr = atMostOne(o, "RRULE"); let rule = null;
      if (rr) {
        const parts = Object.fromEntries(rr.value.split(";").map(kv => kv.split("=")));
        const bd = /^(-?\d)?([A-Z]{2})$/.exec(parts.BYDAY || "");
        if (parts.FREQ !== "YEARLY" || !bd || !(+parts.BYMONTH >= 1 && +parts.BYMONTH <= 12) || DOWS[bd[2]] === undefined) fail("unsupported/bad RRULE " + rr.value);
        rule = { month: +parts.BYMONTH, dow: DOWS[bd[2]], n: bd[1] ? +bd[1] : 1, hh: +m[4], mm: +m[5], ss: +m[6] };
      }
      const startY = +m[1];
      const onsets = (y) => {
        const out = [];
        if (y === startY) out.push(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - from * 60000);
        if (rule && y >= startY) out.push(nthWeekday(y, rule.month, rule.dow, rule.n) + (rule.hh * 3600 + rule.mm * 60 + rule.ss) * 1000 - from * 60000);
        return out;
      };
      return { kind: o.name, name: (atMostOne(o, "TZNAME") || {}).value, from, to, onsets };
    });
    const latestOnsetBefore = (o, instant) => { let best = -Infinity; const y = new Date(instant).getUTCFullYear(); [y - 1, y].forEach(yy => o.onsets(yy).forEach(t => { if (t <= instant && t > best) best = t; })); return best; };
    const resolve = (local) => {
      const L = msLocal(local);
      const winners = parsed.filter(o => { const I = L - o.to * 60000; const mine = latestOnsetBefore(o, I); return mine !== -Infinity && parsed.every(p => p === o || latestOnsetBefore(p, I) < mine); });
      if (winners.length !== 1) fail(`local ${local} resolves to ${winners.length} observances in ${tzid}`);
      return { utc: new Date(L - winners[0].to * 60000), offsetMin: winners[0].to, zone: winners[0].name };
    };
    const transitions = (y) => parsed.flatMap(o => o.onsets(y).map(t => ({ at: new Date(t), kind: o.kind, name: o.name, to: o.to }))).sort((a, b) => a.at - b.at);
    return { tzid, resolve, transitions };
  };
  const validate = (text) => {
    const tree = parseTree(unfold(text));
    if (tree.props.length || tree.children.length !== 1 || tree.children[0].name !== "VCALENDAR") fail("exactly one top-level VCALENDAR and nothing outside it");
    const cal = tree.children[0];
    if (one(cal, "VERSION").value !== "2.0") fail("VERSION must be 2.0");
    one(cal, "PRODID"); atMostOne(cal, "CALSCALE"); atMostOne(cal, "METHOD");
    const zones = {};
    cal.children.filter(c => c.name === "VTIMEZONE").forEach(vt => { const z = buildTz(vt); if (zones[z.tzid]) fail("duplicate VTIMEZONE " + z.tzid); zones[z.tzid] = z; });
    const uids = new Set();
    const events = cal.children.filter(c => c.name === "VEVENT").map(ev => {
      const uid = one(ev, "UID").value; if (uids.has(uid)) fail("duplicate UID " + uid); uids.add(uid);
      const stamp = one(ev, "DTSTAMP"); if (!UTC.test(stamp.value) || Object.keys(stamp.params).length) fail("DTSTAMP must be a bare UTC stamp: " + stamp.value);
      const ds = one(ev, "DTSTART"), de = atMostOne(ev, "DTEND"), du = atMostOne(ev, "DURATION");
      if ((de && du) || (!de && !du)) fail("VEVENT needs exactly one of DTEND / DURATION");
      ["SUMMARY", "DESCRIPTION"].forEach(n => { const p = atMostOne(ev, n); if (p && /(^|[^\\])[;,]/.test(p.value)) fail(`${n} has an unescaped ; or ,`); });
      const inst = (p) => {
        const tz = p.params.TZID && p.params.TZID[0];
        // RFC 5545 3.3.4 DATE (an all-day event): VALUE=DATE, YYYYMMDD, no TZID, a real calendar date
        if (p.params.VALUE) {
          if (p.params.VALUE.length !== 1 || p.params.VALUE[0] !== "DATE") fail(`${p.name};VALUE must be DATE: ${p.params.VALUE}`);
          const m = /^(\d{4})(\d{2})(\d{2})$/.exec(p.value);
          if (!m || tz) fail(`${p.name};VALUE=DATE must be YYYYMMDD without a TZID: ${p.value}`);
          const dayMs = Date.UTC(+m[1], +m[2] - 1, +m[3]);
          if (new Date(dayMs).toISOString().slice(0, 10).replace(/-/g, "") !== p.value) fail(`${p.name} is not a calendar date: ${p.value}`);
          return { date: p.value, dayMs };
        }
        if (tz) { if (!zones[tz]) fail(`${p.name} uses TZID ${tz} without a VTIMEZONE`); if (!LOCAL.test(p.value)) fail(`${p.name};TZID value must be local form: ${p.value}`); return Object.assign({ local: p.value, tz }, zones[tz].resolve(p.value)); }
        if (UTC.test(p.value)) { const m = UTC.exec(p.value); return { utc: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])), tz: "UTC", offsetMin: 0 }; }
        if (LOCAL.test(p.value)) return { local: p.value, floating: true };
        fail(`${p.name} is not a DATE-TIME: ${p.value}`);
      };
      const start = inst(ds), end = de ? inst(de) : null;
      if (start.utc && end && end.utc && !(end.utc > start.utc)) fail("DTEND not after DTSTART for " + uid);
      if (end && (start.date !== undefined) !== (end.date !== undefined)) fail("DTSTART and DTEND must both be DATE or both DATE-TIME for " + uid);
      if (start.date !== undefined && end && !(end.dayMs > start.dayMs)) fail("DTEND;VALUE=DATE not after DTSTART (the end date is exclusive) for " + uid);
      return { uid, start, end, summary: (atMostOne(ev, "SUMMARY") || {}).value || "", desc: (atMostOne(ev, "DESCRIPTION") || {}).value || "" };
    });
    return { cal, zones, events, childNames: cal.children.map(c => c.name) };
  };
  // Runtime tz database ground truth.
  const parts = (d) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" }).formatToParts(d);
  const intlOffsetMin = (d) => { const p = parts(d), g = t => +p.find(x => x.type === t).value; return Math.round((Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second")) - d.getTime()) / 60000); };
  const intlLocal = (d) => { const p = parts(d), g = t => p.find(x => x.type === t).value; return { ymd: `${g("year")}-${g("month")}-${g("day")}`, hm: `${String(+g("hour") % 24).padStart(2, "0")}:${g("minute")}`, zone: g("timeZoneName") }; };
  // Port of edge-functions/calendar-sync/index.ts centralOffsetHours + icsDate
  // (the feed writes absolute UTC stamps; the download writes TZID local stamps).
  const edgeOffsetHours = (y, m, d) => { const probe = new Date(Date.UTC(y, m - 1, d, 17, 0, 0)); let h = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", hour12: false }).formatToParts(probe).find(p => p.type === "hour").value, 10); if (h === 24) h = 0; return 17 - h; };
  const edgeIcsDate = (y, m, d, h) => { const u = new Date(Date.UTC(y, m - 1, d, h + edgeOffsetHours(y, m, d), 0, 0)); const p2 = n => String(n).padStart(2, "0"); return `${u.getUTCFullYear()}${p2(u.getUTCMonth() + 1)}${p2(u.getUTCDate())}T${p2(u.getUTCHours())}${p2(u.getUTCMinutes())}00Z`; };
  return { validate, intlOffsetMin, intlLocal, edgeIcsDate };
})();

// The calendar-sync feed's own '@icsCore' block (plain JS), evaluated here so the download and the feed are compared
// on the same fixture: the default all-day runs (buildEvents) and ?timed=1 (buildTimedEvents: the old per-day
// 07:00 -> 07:00 events as absolute UTC stamps).
const CS_TS = fs.readFileSync(path.join(__dirname, "..", "edge-functions", "calendar-sync", "index.ts"), "utf8").replace(/\r\n/g, "\n");
const FEED = (() => {
  const s = "// @icsCore-mirror-start", e = "// @icsCore-mirror-end", i = CS_TS.indexOf(s), j = CS_TS.indexOf(e);
  if (i < 0 || j < i) return {};
  return new Function(CS_TS.slice(i + s.length, j) + "\nreturn { buildEvents: typeof buildEvents === 'function' ? buildEvents : null, buildTimedEvents: typeof buildTimedEvents === 'function' ? buildTimedEvents : null, generateICS };")();
})();
const FEED_ROSTER = { byId: Object.fromEntries(roster.map(r => [r.id, r])) };
// the in-memory schedule as schedule_days rows (what the feed reads)
const toRows = (sched) => Object.keys(sched).sort().map(d => ({ day: d, primary_id: sched[d].primary || null, backup_id: sched[d].backup || null, external_cover: sched[d].externalCover || null }));
const veventsOf = (text) => { const t = text.replace(/DTSTAMP:\d{8}T\d{6}Z/g, "DTSTAMP:X"), i = t.indexOf("BEGIN:VEVENT"); return i < 0 ? "" : t.slice(i, t.lastIndexOf("END:VCALENDAR")); };

// Fixture across both clock changes plus an ordinary January day.
const dstSchedule = {
  "2026-10-30": day("s2", "s3"), "2026-10-31": day("s1", "s2"), "2026-11-01": day("s1", "s2", { note: "Bring, the; pager\\ok" }), "2026-11-02": day("s3", "s1"),
  "2026-11-03": day(null, "s5", { externalCover: "Atwell" }), "2026-11-04": day(null, null),
  "2026-12-31": day("s2", "s3"), "2027-01-04": day("s4", "s1"), "2027-01-05": day("s6", null),
  "2027-03-13": day("s1", "s5"), "2027-03-14": day("s1", "s5"), "2027-03-15": day("s2", "s6"),
};
// Fixture across the year change (12/31 -> 1/1, the New Year holiday unit) plus two long runs: Philip primary
// 1/3-1/10 (8 days) and the pair Philip + Sarkar 1/4-1/10 (7 days) - a run of 7+ days names its dates (review 9/25).
const yearSchedule = {
  "2026-12-30": day("s2", "s3"), "2026-12-31": day("s1", "s2"), "2027-01-01": day("s1", "s2"), "2027-01-02": day("s1", "s3"),
  "2027-01-03": day("s4", "s5"), "2027-01-04": day("s4", "s6"), "2027-01-05": day("s4", "s6"), "2027-01-06": day("s4", "s6"),
  "2027-01-07": day("s4", "s6"), "2027-01-08": day("s4", "s6"), "2027-01-09": day("s4", "s6"), "2027-01-10": day("s4", "s6"),
  "2027-01-11": day("s4", null),
};
const strictGroup = ICS.validate(H.generateICS(H.buildICSEvents(dstSchedule, null, roster, {}), "Silvis Call - All"));
const strictKhan = ICS.validate(H.generateICS(H.buildICSEvents(dstSchedule, "s1", roster, {}), "Silvis Call - Khan"));
const toIcsUtc = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

check("strict ICS: the group and per-surgeon downloads parse under an independent RFC 5545 reader (CRLF, 75-octet raw lines, folding, grammar, nesting, once-only UID/DTSTAMP/DTSTART, escaping) as ALL-DAY events - DTSTART;VALUE=DATE / DTEND;VALUE=DATE, the end date exclusive and after the start, no TZID and so no VTIMEZONE", () => {
  assert.strictEqual(strictGroup.events.length, 9, "nine group runs (10/31-11/1 Khan + Burchett and 3/13-3/14 Khan + Fierce are one bar each)");
  assert.strictEqual(strictKhan.events.length, 4, "Khan: primary 10/31-11/1, backup 11/2, backup 1/4, primary 3/13-3/14");
  strictGroup.events.concat(strictKhan.events).forEach(e => { assert.ok(e.start.date && e.end.date, "not an all-day event: " + e.uid); assert.ok(e.end.dayMs > e.start.dayMs); });
  assert.deepStrictEqual(strictGroup.childNames.filter(n => n === "VTIMEZONE"), [], "no event carries a zone, so the file ships no VTIMEZONE");
  assert.throws(() => ICS.validate("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:x\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"), /PRODID|DTSTAMP/, "the reader really is strict");
  assert.throws(() => ICS.validate("BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR\n"), /CRLF|bare/);
  const ev = (ds, de) => "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:x\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTAMP:20260925T000000Z\r\n" + ds + "\r\n" + de + "\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  assert.throws(() => ICS.validate(ev("DTSTART;VALUE=DATE:20261009", "DTEND;VALUE=DATE:20261009")), /exclusive/, "an all-day DTEND equal to DTSTART is refused");
  assert.throws(() => ICS.validate(ev("DTSTART;VALUE=DATE:20261009", "DTEND:20261010T120000Z")), /both DATE/, "mixed DATE / DATE-TIME is refused");
  assert.throws(() => ICS.validate(ev("DTSTART;VALUE=DATE:20261332", "DTEND;VALUE=DATE:20261401")), /calendar date/, "a non-date is refused");
});
check("strict ICS: generateICS's TZID path (kept for callers passing tzid events; the download itself no longer does) ships a VTIMEZONE whose transitions are the tz database's - CST from 2026-11-01T07:00Z, CDT from 2027-03-14T08:00Z - and resolves 07:00 -> 07:00 across the fall-back as 25 h, across the spring-forward as 23 h", () => {
  const tzEv = (d, n) => ({ uid: "tz-" + d + "@silvis-call", tzid: "America/Chicago", start: d + "T070000", end: n + "T070000", summary: "x", desc: "y" });
  const v = ICS.validate(H.generateICS([tzEv("20261031", "20261101"), tzEv("20270313", "20270314"), tzEv("20261102", "20261103")], "tz"));
  const z = v.zones["America/Chicago"];
  assert.ok(z, "no America/Chicago VTIMEZONE");
  assert.ok(v.childNames.indexOf("VTIMEZONE") < v.childNames.indexOf("VEVENT"), "VTIMEZONE must precede the events");
  const t26 = z.transitions(2026), t27 = z.transitions(2027);
  assert.strictEqual(t26.find(t => t.name === "CST").at.toISOString(), "2026-11-01T07:00:00.000Z");
  assert.strictEqual(t27.find(t => t.name === "CDT").at.toISOString(), "2027-03-14T08:00:00.000Z");
  t26.concat(t27).forEach(t => {
    const before = ICS.intlOffsetMin(new Date(t.at - 60000)), after = ICS.intlOffsetMin(t.at);
    assert.strictEqual(after, t.to, `VTIMEZONE offset after ${t.at.toISOString()} (${t.name}) disagrees with the tz database`);
    assert.notStrictEqual(before, after, `tz database has no transition at ${t.at.toISOString()}`);
  });
  assert.deepStrictEqual(v.events.map(e => (e.end.utc - e.start.utc) / 3600000), [25, 23, 24]);
});
check("strict ICS: the feed's ?timed=1 output (calendar-sync buildTimedEvents, absolute UTC stamps) parses under the strict reader; a November (CST) and a January (CST) event start 07:00 Central; the 10/31 shift spans the fall-back (25 h) and 3/13 the spring-forward (23 h); every other shift is 24 h 07:00 -> 07:00 and every instant equals the edge icsDate port", () => {
  assert.ok(FEED.buildTimedEvents, "calendar-sync's @icsCore block defines buildTimedEvents");
  const timed = ICS.validate(FEED.generateICS(FEED.buildTimedEvents(toRows(dstSchedule), FEED_ROSTER, null), "Silvis Call - All"));
  assert.strictEqual(timed.events.length, 20, "one event per filled role per day, as before 9/25");
  const byUid = Object.fromEntries(timed.events.map(e => [e.uid, e]));
  const nov = byUid["silvis-2026-11-02-primary@silvis-call"], jan = byUid["silvis-2027-01-04-primary@silvis-call"];
  assert.deepStrictEqual(ICS.intlLocal(nov.start.utc), { ymd: "2026-11-02", hm: "07:00", zone: "CST" });
  assert.strictEqual(nov.start.utc.toISOString(), "2026-11-02T13:00:00.000Z");
  assert.deepStrictEqual(ICS.intlLocal(jan.start.utc), { ymd: "2027-01-04", hm: "07:00", zone: "CST" });
  const oct31 = byUid["silvis-2026-10-31-primary@silvis-call"];
  assert.deepStrictEqual([ICS.intlLocal(oct31.start.utc).zone, ICS.intlLocal(oct31.end.utc).zone], ["CDT", "CST"]);
  timed.events.forEach(e => {
    const d = e.uid.slice(7, 17), next = H.fmt(H.addD(H.parse(d), 1));
    assert.deepStrictEqual([ICS.intlLocal(e.start.utc).ymd, ICS.intlLocal(e.start.utc).hm], [d, "07:00"], "start " + e.uid);
    assert.deepStrictEqual([ICS.intlLocal(e.end.utc).ymd, ICS.intlLocal(e.end.utc).hm], [next, "07:00"], "end " + e.uid);
    assert.strictEqual((e.end.utc - e.start.utc) / 3600000, d === "2026-10-31" ? 25 : d === "2027-03-13" ? 23 : 24, d);
    const [y, m, dd] = d.split("-").map(Number), [ny, nm, nd] = next.split("-").map(Number);
    assert.strictEqual(toIcsUtc(e.start.utc), ICS.edgeIcsDate(y, m, dd, 7), "start instant differs from the edge port for " + e.uid);
    assert.strictEqual(toIcsUtc(e.end.utc), ICS.edgeIcsDate(ny, nm, nd, 7), "end instant differs from the edge port for " + e.uid);
  });
});
check("strict ICS: the download and the calendar-sync feed agree - on the same fixtures the download's VEVENTs are byte-identical (DTSTAMP normalised) to the feed's default all-day output, for the group and for every surgeon; the feed's all-day text passes the strict reader too", () => {
  assert.ok(FEED.buildEvents, "calendar-sync's @icsCore block defines buildEvents");
  [["dstSchedule", dstSchedule], ["schedule", schedule], ["yearSchedule", yearSchedule]].forEach(([name, sched]) => {
    [null].concat(roster.map(r => r.id)).forEach(id => {
      const dl = H.generateICS(H.buildICSEvents(sched, id, roster, {}), "x");
      const fd = FEED.generateICS(FEED.buildEvents(toRows(sched), FEED_ROSTER, id), "x");
      assert.strictEqual(veventsOf(dl), veventsOf(fd), `${name} ${id || "group"}: the download differs from the feed`);
      ICS.validate(fd);
    });
  });
  const s = strictGroup.events.find(e => e.uid === "silvis-2026-10-31-group@silvis-call");
  assert.ok(s, "the 10/31 group run");
  assert.deepStrictEqual([s.start.date, s.end.date, s.summary], ["20261031", "20261102", "P Khan \u00b7 B Burchett"]);
  assert.strictEqual(s.desc, "07:00 Sat \u2192 07:00 Mon (Central)\\nPrimary: Khan\\nBackup: Burchett", "the times in the description and no note line (Faraz 9/25)");
  assert.deepStrictEqual([...new Set(strictKhan.events.map(e => e.summary))].sort(), ["Silvis Backup", "Silvis Primary"]);
  assert.strictEqual(strictGroup.events.find(e => e.uid === "silvis-2026-11-03-group@silvis-call").summary, "P Atwell (external cover) \u00b7 B Fierce");
  assert.ok(CS_TS.includes("const SHIFT_START_HOUR = 7;") && CS_TS.includes('const UID_DOMAIN = "silvis-call";') && CS_TS.includes('const PRODID = "-//Silvis Call Schedule//EN";'), "feed start hour / UID domain / PRODID changed");
});
check("all-day runs across the YEAR change: Khan primary 12/31-1/2 is ONE event DTSTART;VALUE=DATE:20261231 / DTEND;VALUE=DATE:20270103, '07:00 Thu \u2192 07:00 Sun (Central)', 'Backup: 12/31-1/1 Burchett, 1/2 Acton'; the group bar 12/31-1/1 'P Khan \u00b7 B Burchett' ends 20270102; the download and the feed agree and both pass the strict reader", () => {
  assert.ok(FEED.buildEvents, "calendar-sync's @icsCore block defines buildEvents");
  const k = ICS.validate(H.generateICS(H.buildICSEvents(yearSchedule, "s1", roster, {}), "Silvis Call - Khan"));
  assert.deepStrictEqual(k.events.map(e => [e.uid, e.start.date, e.end.date, e.summary, e.desc]), [["silvis-2026-12-31-primary@silvis-call", "20261231", "20270103", "Silvis Primary", "07:00 Thu \u2192 07:00 Sun (Central)\\nPrimary: Khan\\nBackup: 12/31-1/1 Burchett\\, 1/2 Acton"]]);
  const g = ICS.validate(H.generateICS(H.buildICSEvents(yearSchedule, null, roster, { to: "2027-01-02" }), "Silvis Call - All"));
  assert.deepStrictEqual(g.events.map(e => [e.uid, e.start.date, e.end.date, e.summary]), [
    ["silvis-2026-12-30-group@silvis-call", "20261230", "20261231", "P Burchett \u00b7 B Acton"],
    ["silvis-2026-12-31-group@silvis-call", "20261231", "20270102", "P Khan \u00b7 B Burchett"],
    ["silvis-2027-01-02-group@silvis-call", "20270102", "20270103", "P Khan \u00b7 B Acton"],
  ]);
  assert.strictEqual(g.events[1].desc, "07:00 Thu \u2192 07:00 Sat (Central)\\nPrimary: Khan\\nBackup: Burchett");
  const b = H.buildICSEvents(yearSchedule, "s2", roster, {});
  assert.deepStrictEqual(b.map(e => [e.uid, e.start, e.end]), [["silvis-2026-12-30-primary@silvis-call", "20261230", "20261231"], ["silvis-2026-12-31-backup@silvis-call", "20261231", "20270102"]], "Burchett: primary 12/30, then backup across the year change");
  [null].concat(roster.map(r => r.id)).forEach(id => {
    const fd = FEED.generateICS(FEED.buildEvents(toRows(yearSchedule), FEED_ROSTER, id), "x");
    assert.strictEqual(veventsOf(H.generateICS(H.buildICSEvents(yearSchedule, id, roster, {}), "x")), veventsOf(fd), `yearSchedule ${id || "group"}: the download differs from the feed`);
    ICS.validate(fd);
  });
});
check("all-day DESCRIPTION: a run of 7 days or more names its dates ('07:00 Mon 1/4 \u2192 07:00 Mon 1/11 (Central)', a weekday alone would read Mon -> Mon); a run of up to 6 days keeps the weekdays only; the download and the feed write the same line", () => {
  assert.ok(FEED.buildEvents, "calendar-sync's @icsCore block defines buildEvents");
  const pair = H.buildICSEvents(yearSchedule, null, roster, {}).find(e => e.uid === "silvis-2027-01-04-group@silvis-call");
  assert.ok(pair, "the 1/4-1/10 Philip + Sarkar group run");
  assert.deepStrictEqual([pair.start, pair.end, pair.summary], ["20270104", "20270111", "P Philip \u00b7 B Sarkar"]);
  assert.strictEqual(pair.desc, "07:00 Mon 1/4 \u2192 07:00 Mon 1/11 (Central)\nPrimary: Philip\nBackup: Sarkar", "7 days: dated");
  const philip = H.buildICSEvents(yearSchedule, "s4", roster, {});
  assert.deepStrictEqual(philip.map(e => [e.start, e.end, e.desc]), [["20270103", "20270112", "07:00 Sun 1/3 \u2192 07:00 Tue 1/12 (Central)\nPrimary: Philip\nBackup: 1/3 Fierce, 1/4-1/10 Sarkar, 1/11 OPEN"]], "9 days: dated");
  const sarkar = H.buildICSEvents(Object.assign({}, yearSchedule, { "2027-01-10": day("s4", "s3") }), "s6", roster, {});
  assert.deepStrictEqual(sarkar.map(e => [e.start, e.end, e.desc]), [["20270104", "20270110", "07:00 Mon \u2192 07:00 Sun (Central)\nPrimary: Philip\nBackup: Sarkar"]], "6 days: weekdays only");
  const feedPair = FEED.buildEvents(toRows(yearSchedule), FEED_ROSTER, null).find(e => e.uid === "silvis-2027-01-04-group@silvis-call");
  assert.strictEqual(feedPair && feedPair.desc, pair.desc, "the feed writes the same dated line");
});
check("exports carry no contact data: no email address or phone number in the ICS files, share page, printable or ER panel documents", () => {
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;
  const docs = [allIcs, khanIcs, share, printable, H.buildErCallPanelsDocument(schedule, roster, "2026-10-26", "2026-11-15"), H.generateICS(H.buildICSEvents(dstSchedule, null, roster, {}), "x")];
  docs.forEach((d, i) => { assert.ok(!EMAIL.test(d), "email in document #" + i); assert.ok(!PHONE.test(d), "phone number in document #" + i); });
  // The only @ allowed in the HTML documents: a CSS at-rule (@media / @page)
  // or the weight list in the Google Fonts URL (Outfit:wght@400;600;700).
  [share, printable].forEach(d => (d.match(/\S*@\S*/g) || []).forEach(m => assert.ok(/^@(media|page)\b/.test(m) || /^href="https:\/\/fonts\.googleapis\.com\/css2\?family=Outfit:wght@/.test(m), "unexpected @ in an HTML document: " + m)));
});

/* ---------------- LIVE: ER panel 2026-11-02..2026-12-13 ---------------- */
const FROM = "2026-11-02", TO = "2026-12-13";
const OUT_DIR = path.join(__dirname, "ui", "out");
const OUT_FILE = path.join(OUT_DIR, `er-panel-${FROM}-to-${TO.slice(5)}.html`);

async function livePanel() {
  if (process.env.EXPORTS_OFFLINE === "1") { console.log("skip live ER panel (EXPORTS_OFFLINE=1)"); return; }
  const configSrc = fs.readFileSync(path.join(__dirname, "..", "config.js"), "utf8");
  const url = (configSrc.match(/const SUPABASE_URL = "([^"]+)"/) || [])[1];
  const anon = (configSrc.match(/const SUPABASE_ANON_KEY = "([^"]+)"/) || [])[1];
  assert.ok(url && anon, "could not read SUPABASE_URL / SUPABASE_ANON_KEY from config.js");
  const headers = { apikey: anon, Authorization: "Bearer " + anon };
  // Every read throws on non-2xx: an RLS-blocked read is 200 + [] and would
  // otherwise print an all-OPEN panel as if it were the truth.
  const get = async (p) => {
    const res = await fetch(`${url}/rest/v1/${p}`, { headers: Object.assign({ Prefer: "count=exact" }, headers) });
    if (!res.ok) throw new Error(`${p.split("?")[0]} read failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return { rows: await res.json(), range: res.headers.get("content-range") || "" };
  };
  const blob = await get("call_schedule_data?select=data&id=eq.main");
  const data = blob.rows[0] && (typeof blob.rows[0].data === "string" ? JSON.parse(blob.rows[0].data) : blob.rows[0].data);
  const liveRoster = (data && Array.isArray(data.roster) ? data.roster : []).map(r => ({ id: r.id, name: r.name, code: r.code }));
  assert.ok(liveRoster.length >= 6, "live roster has fewer than 6 entries: " + JSON.stringify(liveRoster));
  const days = await get(`schedule_days?select=day,primary_id,backup_id,primary_locked,backup_locked,source,external_cover,note&day=gte.${FROM}&day=lte.${TO}&order=day.asc`);
  const total = await get("schedule_days?select=day&limit=1");
  const liveSched = {};
  days.rows.forEach(r => { liveSched[String(r.day).slice(0, 10)] = H.dayRowToAssignment(r); });
  const filled = Object.keys(liveSched).filter(d => liveSched[d].primary || liveSched[d].externalCover).length;
  console.log(`live: schedule_days total ${total.range.split("/")[1] || "?"} row(s); ${days.rows.length} row(s) in ${FROM}..${TO}, ${filled} with a primary`);
  const html = H.buildErCallPanelsDocument(liveSched, liveRoster, FROM, TO);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, html, "utf8");
  console.log(`saved ${path.relative(path.join(__dirname, ".."), OUT_FILE)} (${html.length} bytes)`);
  console.log("ER Call Panels " + FROM + " .. " + TO + " (live):");
  H.buildErCallPanelsText(liveSched, liveRoster, FROM, TO).split("\n").forEach(l => console.log("  " + l));
  const rows = erRows(H.buildErCallPanelsHTML(liveSched, liveRoster, FROM, TO));
  assert.strictEqual(rows.length, 6, "11/2..12/13 is six Mon-Sun weeks");
  assert.strictEqual(rows[0].week, "2026-11-02"); assert.strictEqual(rows[5].week, "2026-12-07");
  passed++; console.log("ok   live ER panel: 6 week rows 11/2..12/13 built from the live project and saved");
}

/* ---- Prompt 12 M: an outside surgeon (roster type "external") exports by last name like anyone else;
   the legacy externalCover ("Atwell") keeps its own rendering beside him. ---- */
const rosterExt = roster.concat([{ id: "x1", name: "Locum", code: "LOC", type: "external", active: true }]);
const scheduleExt = Object.assign({}, schedule, {
  "2026-11-12": day("x1", "s3", { primaryLocked: true, source: "manual-external" }),
  "2026-11-13": day("s4", "x1", { backupLocked: true, source: "manual-external" }),
});
check("M: ICS - an outside surgeon's days are events named by last name in the group feed; his own feed (by id) and file name work", () => {
  const ev = H.buildICSEvents(scheduleExt, null, rosterExt, {}).filter(e => e.day === "2026-11-12" || e.day === "2026-11-13");
  assert.deepStrictEqual(ev.map(e => e.summary), ["P Locum \u00b7 B Acton", "P Philip \u00b7 B Locum"]);
  assert.ok(ev[0].desc.endsWith("\nPrimary: Locum\nBackup: Acton"), ev[0].desc);
  const mine = H.buildICSEvents(scheduleExt, "x1", rosterExt, {});
  assert.deepStrictEqual(mine.map(e => e.day + " " + e.role + " " + e.summary), ["2026-11-12 primary Silvis Primary", "2026-11-13 backup Silvis Backup"]);
  assert.strictEqual(H.icsFileName(rosterExt[6]), "silvis-call-locum.ics");
});
check("M: week rows / ER panel - '11/12 Locum' is a surgeon entry (data-kind surgeon, never external); the Atwell cover is unchanged beside it", () => {
  const rows = H.buildWeekRows(scheduleExt, rosterExt, "2026-11-09", "2026-11-15", { today: TODAY_NOV });
  const p = rows[0].primary.find(e => e.id === "x1");
  assert.deepStrictEqual(p && [p.kind, p.name, p.text], ["surgeon", "Locum", "11/12 Locum"]);
  const b = rows[0].backup.find(e => e.id === "x1");
  assert.deepStrictEqual(b && [b.kind, b.text], ["surgeon", "11/13 Locum"]);
  const html = H.buildErCallPanelsHTML(scheduleExt, rosterExt, "2026-11-02", "2026-11-15", { today: TODAY_NOV });
  assert.ok(html.includes('<span data-kind="surgeon">11/12 Locum</span>'), html);
  assert.ok(html.includes('<span data-kind="surgeon">11/13 Locum</span>'), html);
  assert.ok(html.includes('<span data-kind="external">11/3-11/5 Atwell</span>'), "the legacy externalCover must still render as before");
  const text = H.buildErCallPanelsText(scheduleExt, rosterExt, "2026-11-09", "2026-11-15", { today: TODAY_NOV });
  assert.ok(text.includes("11/12 Locum; 11/13 Philip") && text.includes("11/13 Locum"), text);
});
check("M: share page and printable month - the name in the grid cell and the week row, never '(ext)'; Atwell keeps '(ext)'", () => {
  const sh = H.generateShareHTML(scheduleExt, rosterExt, { months: ["2026-11"], holidays, vacations, generatedAt: new Date(2026, 8, 22, 9, 5), today: TODAY_NOV });
  const j = sh.indexOf('data-day="2026-11-12"'); const c = sh.slice(j, sh.indexOf('data-day="2026-11-13"', j));
  assert.ok(j > 0 && c.includes("Locum") && !c.includes("(ext)"), c.slice(0, 300));
  assert.ok(sh.includes(">11/12 Locum</div>"), "week-row entry for the outside surgeon");
  assert.ok(sh.includes('<div class="wr-ext">11/3-11/5 Atwell</div>'), "the legacy cover keeps its week-row style");
  const pr = H.buildPrintableCalendarHTML({ startYear: 2026, startMonth: 10, numMonths: 1, schedule: scheduleExt, roster: rosterExt, holidays, vacations, today: TODAY_NOV });
  const k = pr.indexOf('data-day="2026-11-12"'); const pc = pr.slice(k, pr.indexOf('data-day="2026-11-13"', k));
  assert.ok(k > 0 && pc.includes('<span class="who">Locum</span>'), pc.slice(0, 300));
  assert.ok(pr.includes('<span class="ext">Atwell (ext)</span>'), "the legacy cover keeps its (ext) rendering");
});
check("M: an outside surgeon's id that is NOT in the roster list still renders (as the raw id) rather than crashing an export", () => {
  const html = H.buildErCallPanelsHTML(scheduleExt, roster, "2026-11-09", "2026-11-15", { today: TODAY_NOV });
  assert.ok(html.includes('<span data-kind="surgeon">11/12 x1</span>'), html);
});

livePanel().catch(e => { failed++; console.log("FAIL live ER panel\n     " + (e && e.message || e)); }).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
