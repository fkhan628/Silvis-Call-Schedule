// call-totals.js - "My call - Silvis + Davenport" (Prompt 31 Part B, Faraz 10/9): the counter behind the call-totals
// card of the signed-in East-code surgeon (Khan today), in Mine. Classic browser script, loaded LAST in
// index-source.html's ?v= loader list - after helpers.js, which provides fmt / parse / addD (byte-identical to the
// Davenport app's), and after east-feed.js. It declares none of them: a second declaration in the page's one global
// scope is a SyntaxError and this module would never load (test/call-totals.test.js T1 and data-layer P31B pin it).
// Node: load it in ONE vm context after helpers.js, as test/call-totals.test.js does; require() alone returns the
// functions, but their fmt / parse / addD are then undefined.
//
// PORTED VERBATIM from the Davenport app (github.com/fkhan628/Call-Schedule-App) at commit eff3b81
// (2026-10-11 02:05 -0500, "Totals card review fixes: labels in days, ... parity contract, stronger guards"), read
// with `git show eff3b81:<path>` in the davenport-ref clone at HEAD bb07a0b (no ported line changed after eff3b81):
//   helpers.js:66-81 weekBillingCredits, helpers.js:107-122 callTotalPeriods, helpers.js:141-191 callTotalsFor,
//   config.js:380 NIGHT_KEYS.
// The Davenport PARITY CONTRACT (its helpers.js:83-99) asks for exactly this module. The NIGHT_KEYS line and the three
// bodies between the verbatim markers are byte-identical to the eff3b81 blobs: test/call-totals.test.js pins their
// sha256 (T2), runs the Davenport session's own fixture (test/fixtures/call-totals-card-synthetic-2026-10-14.json,
// copied byte for byte - T3) and, beside a davenport-ref clone, runs the Davenport app's own counter at eff3b81 on the
// same inputs (T9). NEVER edit them here: a change is made in the Davenport app first and re-ported, with this header's
// commit and the test's digests updated together - one counting definition for both cards (Prompt 31 item 11).
// Units are the Davenport app's Stats > Billing days (weekBillingCredits: each day of a service week, each weeknight,
// Fri + Sat + Sun for a weekend, 2 days for a covered holiday); a backup week counts through the same function, as
// backup roles. Silvis: one 07:00-07:00 day = 1. The weighted total's 0.5 for every backup role is the counter's own
// (Faraz 10/9), never Setup's shift weights - the two cards must agree. `today` is passed in: the card hands it the
// DEVICE date (the parity contract's decision of 2026-10-11), never the Central date.
// The Davenport doc comments above each function are not copied (they are not ASCII); the bodies are.
// Below the verbatim block: the Silvis adapter (step B2) - Silvis's own code, which shapes the app's published data
// (the east_feed cache, the resolved Davenport id of the roster code, the schedule map) into the counter's input and
// its output into the card's text (callTotalsCardFor, the card's one call; crash-safe). It counts nothing itself.

// ---- verbatim (eff3b81) ----
const NIGHT_KEYS = ["mon","tue","wed","thu"];

function weekBillingCredits(mondayStr, wk) {
  if (!wk || wk.isBackup) return [];
  const mon = parse(mondayStr);
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => fmt(addD(mon, i)));
  const covered = {};
  Object.entries(wk.holidayCoverage || {}).forEach(([ds, cov]) => {
    if (cov && cov.surgeonId && cov.type !== "swap" && days.includes(ds)) covered[ds] = cov.surgeonId;
  });
  const credits = [];
  const add = (ds, sid, kind) => { if (sid && !covered[ds]) credits.push({ ds, sid, kind, n: 1 }); };
  if (wk.dayCall) days.forEach(ds => add(ds, (wk.dayCallOverrides && wk.dayCallOverrides[ds]) || wk.dayCall, "dc"));
  NIGHT_KEYS.forEach((sk, i) => add(days[i], wk.nights?.[sk], "nights"));
  if (wk.nights?.wknd) [4, 5, 6].forEach(i => add(days[i], wk.nights.wknd, "wknd"));
  Object.entries(covered).forEach(([ds, sid]) => credits.push({ ds, sid, kind: "hol", n: 2 }));
  return credits;
}

function callTotalPeriods(today) {
  if (typeof today !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(today) || fmt(parse(today)) !== today) return null;
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)), d = Number(today.slice(8, 10));
  const p2 = (n) => String(n).padStart(2, "0");
  const lastDay = (yy, mm) => new Date(yy, mm, 0).getDate(); // mm is 1-based: day 0 of the next month
  const months = [];
  for (let mm = 1; mm <= 12; mm++) months.push({ month: `${y}-${p2(mm)}`, from: `${y}-${p2(mm)}-01`, to: `${y}-${p2(mm)}-${p2(lastDay(y, mm))}` });
  const back = `${y - 1}-${p2(m)}-${p2(Math.min(d, lastDay(y - 1, m)))}`;
  return {
    month: { from: months[m - 1].from, to: months[m - 1].to },
    ytd: { from: `${y}-01-01`, to: today },
    year: { from: `${y}-01-01`, to: `${y}-12-31` },
    rolling12: { from: fmt(addD(parse(back), 1)), to: today },
    months,
  };
}

function callTotalsFor(input) {
  const inp = input || {};
  const want = String(inp.code || "").trim().toUpperCase();
  if (!want) return { ok: false, error: "no roster code to count" };
  const periods = callTotalPeriods(inp.today);
  if (!periods) return { ok: false, error: `not a date: ${JSON.stringify(inp.today)}` };
  const who = (inp.roster || []).find(s => s && String(s.name || "").toUpperCase() === want);
  if (!who || !who.id) return { ok: false, error: `no roster entry for code ${want}` };
  const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && fmt(parse(s)) === s;
  const items = []; // every dated credit of this person: { ds, kind, n }
  let dsgFrom = null, dsgTo = null, silvisFrom = null, silvisTo = null;
  Object.keys(inp.weeks || {}).sort().forEach(mStr => {
    const wk = inp.weeks[mStr];
    if (!wk || typeof wk !== "object" || !isDay(mStr)) return;
    if (!dsgFrom) dsgFrom = mStr;
    dsgTo = fmt(addD(parse(mStr), 6));
    const backup = !!wk.isBackup;
    weekBillingCredits(mStr, backup ? Object.assign({}, wk, { isBackup: false }) : wk).forEach(c => {
      if (c.sid === who.id) items.push({ ds: c.ds, kind: backup ? c.kind + "B" : c.kind, n: c.n });
    });
  });
  const seenP = {}, seenB = {};
  (inp.silvisRows || []).forEach(r => {
    if (!r || !isDay(r.day)) return;
    if (!silvisFrom || r.day < silvisFrom) silvisFrom = r.day;
    if (!silvisTo || r.day > silvisTo) silvisTo = r.day;
    if (!seenP[r.day] && String(r.primary_code || "").toUpperCase() === want) { seenP[r.day] = true; items.push({ ds: r.day, kind: "silvisP", n: 1 }); }
    if (!seenB[r.day] && String(r.backup_code || "").toUpperCase() === want) { seenB[r.day] = true; items.push({ ds: r.day, kind: "silvisB", n: 1 }); }
  });
  const KINDS = ["dc", "nights", "wknd", "hol", "dcB", "nightsB", "wkndB", "holB", "silvisP", "silvisB"];
  const tally = (from, to) => {
    const zero = () => { const o = {}; KINDS.forEach(k => { o[k] = 0; }); return o; };
    const worked = zero(), scheduled = zero();
    items.forEach(it => { if (it.ds >= from && it.ds <= to) (it.ds <= inp.today ? worked : scheduled)[it.kind] += it.n; });
    const sums = (o) => {
      o.dsg = o.dc + o.nights + o.wknd + o.hol;
      o.dsgB = o.dcB + o.nightsB + o.wkndB + o.holB;
      o.total = o.dsg + o.dsgB + o.silvisP + o.silvisB;
      o.weighted = o.dsg + o.silvisP + (o.dsgB + o.silvisB) / 2;
      return o;
    };
    return { from, to, worked: sums(worked), scheduled: sums(scheduled) };
  };
  const P = periods;
  return {
    ok: true, code: want, sid: who.id, today: inp.today,
    range: { dsgFrom, dsgTo, silvisFrom, silvisTo },
    periods: { month: tally(P.month.from, P.month.to), ytd: tally(P.ytd.from, P.ytd.to), year: tally(P.year.from, P.year.to), rolling12: tally(P.rolling12.from, P.rolling12.to) },
    months: P.months.map(p => Object.assign({ month: p.month }, tally(p.from, p.to))),
  };
}
// ---- end verbatim ----

// ---- Silvis adapter (Silvis's own; restates no Davenport rule) ----
// Prompt 31 Part B step B2. Shapes what the Silvis app holds into the ported counter's input, and the counter's output
// into the card's text. Every count comes from callTotalsFor above; nothing here reads a Davenport week's slots.
// Published data only (design D5 / D6): the Davenport weeks are the east_feed cache rows that are not forecast-marked
// (efIsForecastRow, east-feed.js - never east_forecast, east_overrides, stated weeks or the busy days); the Silvis days
// are the schedule map (every schedule_days row - never a Generate preview). Unknown is never zero (design D8): a site
// whose data is not in hand shows "?" in its cells and in the two totals, with the reason in a note.
const CT_UNKNOWN_DAVENPORT_ID = "(davenport-unknown)"; // a roster id no cached week can hold: the counter counts Silvis only
const CT_TITLE = "My call - Silvis + Davenport";
const CT_SUBTITLE = "only you see this";
const CT_PERIODS = [["month", "This month"], ["ytd", "Year to date"], ["year", "Full year"], ["rolling12", "12 months"]];
// The period table's lines (design 3.5): id, label, the counter's field, the site it needs (s Silvis, d Davenport,
// b both), and the strong / sub / top flags. Sub lines show only when the period has backup-week days.
const CT_ROWS = [
  { id: "silvis-primary", label: "Silvis primary days", k: "silvisP", site: "s" },
  { id: "silvis-backup", label: "Silvis backup days", k: "silvisB", site: "s" },
  { id: "dav-daycall", label: "Davenport day-call days", k: "dc", site: "d" },
  { id: "dav-nights", label: "Davenport weeknights", k: "nights", site: "d" },
  { id: "dav-weekend", label: "Davenport weekend days", k: "wknd", site: "d" },
  { id: "dav-holiday", label: "Davenport holiday days", k: "hol", site: "d" },
  { id: "dav-backup", label: "Davenport backup-week days", k: "dsgB", site: "d", strong: true },
  { id: "dav-backup-daycall", label: "day call", k: "dcB", site: "d", sub: true },
  { id: "dav-backup-nights", label: "weeknights", k: "nightsB", site: "d", sub: true },
  { id: "dav-backup-weekend", label: "weekend days", k: "wkndB", site: "d", sub: true },
  { id: "dav-backup-holiday", label: "holiday days", k: "holB", site: "d", sub: true },
  { id: "total", label: "Total call days (both sites)", k: "total", site: "b", strong: true, top: true },
  { id: "weighted", label: "Weighted (backup roles count 0.5)", k: "weighted", site: "b", strong: true },
];
const CT_MONTH_COLS = [
  { id: "silvisP", label: "Silvis P", k: "silvisP", site: "s" }, { id: "silvisB", label: "Silvis B", k: "silvisB", site: "s" },
  { id: "dav", label: "Davenport", k: "dsg", site: "d" }, { id: "davB", label: "Dav. backup", k: "dsgB", site: "d" },
  { id: "total", label: "Total", k: "total", site: "b" }, { id: "weighted", label: "Wtd", k: "weighted", site: "b" },
];
const CT_MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ctIsDay(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && fmt(parse(s)) === s; }
function ctMdy(ds) { return ctIsDay(ds) ? Number(ds.slice(5, 7)) + "/" + Number(ds.slice(8, 10)) + "/" + ds.slice(0, 4) : "?"; }
// ctCell(v, known): "?" when the site is not known (or the value is not a number), "-" for 0, an integer as is, a half
// with one decimal ("7.5").
function ctCell(v, known) {
  if (!known || typeof v !== "number" || !Number.isFinite(v)) return "?";
  if (v === 0) return "-";
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
// ctLocalDay(iso) -> the device-local YYYY-MM-DD of a timestamp, or null (the card's dates are the device's - D2).
function ctLocalDay(iso) {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? fmt(new Date(t)) : null;
}
// ctPublishedRows(feedRows) -> [{ monday, data, fetchedAt }] by week Monday (stable: of two rows for one Monday the
// later in the cache wins in a map): the rows with a YYYY-MM-DD week_monday (a timestamp is read by its date), an object
// payload and no forecast marker.
function ctPublishedRows(feedRows) {
  const out = [];
  (Array.isArray(feedRows) ? feedRows : []).forEach(r => {
    if (!r || typeof r !== "object" || efIsForecastRow(r)) return;
    const monday = r.week_monday == null ? "" : String(r.week_monday).slice(0, 10);
    const data = r.data;
    if (!ctIsDay(monday) || !data || typeof data !== "object" || Array.isArray(data)) return;
    out.push({ monday, data, fetchedAt: r.fetched_at });
  });
  return out.sort((x, y) => (x.monday < y.monday ? -1 : x.monday > y.monday ? 1 : 0));
}

// callTotalsDeviceToday() -> the device's date (Davenport's parity contract, 2026-10-11: both apps' cards count to the
// DEVICE date, so the two cards agree on one phone). The rest of the app keeps the Central date.
function callTotalsDeviceToday() { return fmt(new Date()); }

// callTotalsWeeks(feedRows) -> { 'YYYY-MM-DD': data }: the published east_feed rows by week Monday, each payload as
// cached (the Silvis-side list the refresh adds rides along; the counter reads only the Davenport fields).
function callTotalsWeeks(feedRows) {
  const weeks = {};
  ctPublishedRows(feedRows).forEach(w => { weeks[w.monday] = w.data; });
  return weeks;
}

// callTotalsSilvisRows(schedule, roster) -> [{ day, primary_code, backup_code }] in date order, one per day of the
// schedule map: the roster entry's code upper-cased, null when the id has no roster code (never the id itself - the
// counter compares codes). A day covered from outside the roster has primary null.
function callTotalsSilvisRows(schedule, roster) {
  const codeOfId = {};
  (Array.isArray(roster) ? roster : []).forEach(s => {
    if (!s || typeof s !== "object" || typeof s.id !== "string" || !s.id) return;
    const c = s.code == null ? "" : String(s.code).trim().toUpperCase();
    codeOfId[s.id] = c || null;
  });
  const codeOf = (id) => (typeof id === "string" && Object.prototype.hasOwnProperty.call(codeOfId, id) ? codeOfId[id] : null);
  const src = schedule && typeof schedule === "object" && !Array.isArray(schedule) ? schedule : {};
  const rows = [];
  Object.keys(src).filter(ctIsDay).sort().forEach(day => {
    const a = src[day];
    if (!a || typeof a !== "object") return;
    rows.push({ day, primary_code: codeOf(a.primary), backup_code: codeOf(a.backup) });
  });
  return rows;
}

// callTotalsInputs({ feedRows, feedState, idByCode, schedule, scheduleKnown, roster, personId, today })
//   feedRows / feedState: the east_feed cache rows and their load state (pending | ok | failed);
//   idByCode: the resolved { CODE: Davenport id, _source } map (null while loading, _source "failed" on a failed read);
//   schedule / scheduleKnown: the published Silvis day map and whether it was read; roster / personId: whose card;
//   today: 'YYYY-MM-DD' (the card passes callTotalsDeviceToday()).
//   -> { ok:false, error } (no roster entry / no roster code for personId)
//    | { ok:true, code, today, counter:{ weeks, roster, silvisRows, code, today }, davenport:{ known, why, fetchedAt },
//        silvis:{ known, why } }
//   An unknown Davenport side hands the counter no weeks and a placeholder roster id (it then counts Silvis only); an
//   unknown Silvis side hands it no rows. The card shows "?" for the unknown side - never the zeros the counter returns.
function callTotalsInputs(args) {
  const a = args && typeof args === "object" ? args : {};
  const roster = Array.isArray(a.roster) ? a.roster : [];
  const me = a.personId ? roster.find(s => s && typeof s === "object" && s.id === a.personId) : null;
  if (!me) return { ok: false, error: "no roster entry for " + (a.personId ? String(a.personId) : "this account") };
  const code = me.code == null ? "" : String(me.code).trim().toUpperCase();
  if (!code) return { ok: false, error: "no roster code for " + String(me.name || me.id) };
  const published = ctPublishedRows(a.feedRows);
  const idMap = a.idByCode;
  const davId = idMap && typeof idMap === "object" && Object.prototype.hasOwnProperty.call(idMap, code) && typeof idMap[code] === "string" && idMap[code] ? idMap[code] : null;
  let why = null;
  if (a.feedState === "pending") why = "the Davenport cache is still loading";
  else if (a.feedState !== "ok") why = "the Davenport cache could not be read";
  else if (!published.length) why = "no Davenport weeks are cached yet";
  else if (!idMap) why = "the Davenport roster is still loading";
  else if (idMap._source === "failed") why = "the Davenport roster could not be read";
  else if (!davId) why = "code " + code + " is not in the Davenport roster";
  const davKnown = !why;
  let newest = null, newestT = -Infinity;
  published.forEach(w => { const t = typeof w.fetchedAt === "string" ? Date.parse(w.fetchedAt) : NaN; if (Number.isFinite(t) && t > newestT) { newestT = t; newest = w.fetchedAt; } });
  const weeks = {};
  if (davKnown) published.forEach(w => { weeks[w.monday] = w.data; });
  const silKnown = a.scheduleKnown === true;
  return {
    ok: true, code, today: a.today,
    counter: { weeks, roster: [{ id: davKnown ? davId : CT_UNKNOWN_DAVENPORT_ID, name: code }], silvisRows: silKnown ? callTotalsSilvisRows(a.schedule, roster) : [], code, today: a.today },
    davenport: { known: davKnown, why, fetchedAt: davKnown ? newest : null },
    silvis: { known: silKnown, why: silKnown ? null : "the Silvis schedule is not loaded" },
  };
}

// callTotalsCardModel(totals, inputs) -> the card's text (design 3.8):
//   { ok:false, title, subtitle, error } for a refused count, else { ok:true, title, subtitle, code, today, year,
//   davenportKnown, silvisKnown, ranges, periods:[{ key, label, from, to, rangeText, startsNote, rows:[{ id, label,
//   strong, sub, top, worked, scheduled, all, num }] }], monthCols:[{ id, label }], months:[{ month, label, pending,
//   beforeCache, cells:{ colId: text } }], monthNotes, notes, dataLine, footnote }.
//   Cells are text ("?", "-", "3", "7.5"); `num` holds the numbers ({ worked, scheduled, all }) of a known row, else null.
//   A month that starts before the first cached Davenport week shows "?" in its Davenport cells and totals (the cache
//   does not reach it - a "-" there would read as no call); the period chips say so in their start note.
function callTotalsCardModel(totals, inputs) {
  if (!totals || totals.ok !== true) return { ok: false, title: CT_TITLE, subtitle: CT_SUBTITLE, error: totals && totals.error ? String(totals.error) : "the count was refused" };
  const inp = inputs || {};
  const dav = !!(inp.davenport && inp.davenport.known), sil = !!(inp.silvis && inp.silvis.known);
  const range = totals.range || {};
  const davFrom = dav && ctIsDay(range.dsgFrom) ? range.dsgFrom : null;
  const known = (site) => (site === "s" ? sil : site === "d" ? dav : sil && dav);
  const periods = CT_PERIODS.map(([key, label]) => {
    const p = totals.periods[key];
    const subsOn = dav && p.worked.dsgB + p.scheduled.dsgB > 0;
    const rows = CT_ROWS.filter(r => !r.sub || subsOn).map(r => {
      const k = known(r.site);
      const w = p.worked[r.k], s = p.scheduled[r.k], all = w + s;
      return { id: r.id, label: r.label, strong: !!r.strong, sub: !!r.sub, top: !!r.top, worked: ctCell(w, k), scheduled: ctCell(s, k), all: ctCell(all, k), num: k ? { worked: w, scheduled: s, all } : null };
    });
    const starts = [];
    if (davFrom && davFrom > p.from) starts.push("Davenport weeks are cached from " + ctMdy(davFrom) + " - nothing earlier is counted.");
    if (sil && ctIsDay(range.silvisFrom) && range.silvisFrom > p.from) starts.push("Silvis days start " + ctMdy(range.silvisFrom) + ".");
    return { key, label, from: p.from, to: p.to, rangeText: ctMdy(p.from) + " - " + ctMdy(p.to), startsNote: starts.join(" "), rows };
  });
  let anyBefore = false;
  const months = totals.months.map(m => {
    const pending = m.scheduled.total > 0;
    const beforeCache = !!davFrom && m.from < davFrom;
    if (beforeCache) anyBefore = true;
    const cells = {};
    CT_MONTH_COLS.forEach(c => { cells[c.id] = ctCell(m.worked[c.k] + m.scheduled[c.k], known(c.site) && !(beforeCache && c.site !== "s")); });
    return { month: m.month, label: CT_MONTH_NAMES[Number(m.month.slice(5, 7)) - 1] + (pending ? " *" : ""), pending, beforeCache, cells };
  });
  const monthNotes = ["* includes scheduled days (after today)"];
  if (anyBefore) monthNotes.push("? = before the first cached Davenport week (" + ctMdy(davFrom) + ") - not counted.");
  const davWhy = (inp.davenport && inp.davenport.why) || "no data", silWhy = (inp.silvis && inp.silvis.why) || "no data";
  const notes = [];
  if (!dav) notes.push("Davenport numbers unavailable - " + davWhy + "; its cells and the totals show ?.");
  if (!sil) notes.push("Silvis numbers unavailable - " + silWhy + "; its cells and the totals show ?.");
  const refreshed = dav ? ctLocalDay(inp.davenport.fetchedAt) : null;
  const silPart = !sil ? "Silvis: not available (" + silWhy + ")"
    : ctIsDay(range.silvisFrom) ? "Silvis from " + ctMdy(range.silvisFrom) + " to " + ctMdy(range.silvisTo) : "Silvis: no days on file";
  const davPart = !dav ? "Davenport: not available (" + davWhy + ")"
    : "Davenport from " + ctMdy(davFrom) + " to " + ctMdy(range.dsgTo) + " (its last published week" + (refreshed ? "; cache refreshed " + ctMdy(refreshed) : "") + ")";
  const footnote = "Worked = on or before " + ctMdy(totals.today) + " (this device's date); scheduled = after it. Every number counts role-days, so one date can count twice (a Davenport day-call day and a weeknight, or a Davenport day and a Silvis day). Davenport days are counted the way the Davenport app's Stats > Billing counts them: each day of a service week, each weeknight, Fri + Sat + Sun for a weekend, 2 days for a covered holiday; backup-week roles are listed apart. Silvis: one 07:00-07:00 day = 1. Weighted: every backup role (Silvis backup days, Davenport backup-week days) counts 0.5.";
  return {
    ok: true, title: CT_TITLE, subtitle: CT_SUBTITLE, code: totals.code, today: totals.today, year: Number(String(totals.today).slice(0, 4)),
    davenportKnown: dav, silvisKnown: sil,
    ranges: { silvisFrom: sil ? range.silvisFrom : null, silvisTo: sil ? range.silvisTo : null, davenportFrom: davFrom, davenportTo: dav ? range.dsgTo : null, refreshed },
    periods, monthCols: CT_MONTH_COLS.map(c => ({ id: c.id, label: c.label })), months, monthNotes, notes,
    dataLine: "Data: " + silPart + "; " + davPart + ".", footnote,
  };
}

// callTotalsCardFor(args) -> the card's model, the ONE call the Mine card makes (args: callTotalsInputs'). Crash-safe
// by contract: it runs while the app renders and the only error boundary is the whole app's, so anything that throws
// on malformed data comes back { ok:false, error } - the card then says "Totals unavailable", never zeros.
function callTotalsCardFor(args) {
  try {
    const inputs = callTotalsInputs(args);
    if (!inputs.ok) return { ok: false, title: CT_TITLE, subtitle: CT_SUBTITLE, error: inputs.error };
    return callTotalsCardModel(callTotalsFor(inputs.counter), inputs);
  } catch (e) {
    return { ok: false, title: CT_TITLE, subtitle: CT_SUBTITLE, error: "the totals could not be computed (" + String((e && e.message) || e).slice(0, 160) + ")" };
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    NIGHT_KEYS, weekBillingCredits, callTotalPeriods, callTotalsFor,
    CT_UNKNOWN_DAVENPORT_ID, callTotalsDeviceToday, callTotalsWeeks, callTotalsSilvisRows, callTotalsInputs, callTotalsCardModel, callTotalsCardFor,
  };
}
