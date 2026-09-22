// Silvis Call Schedule - East (Davenport) feed, READ-ONLY.
//
// Reads the Davenport app's Supabase project (schedule_weeks + the roster in
// call_schedule_data) with that project's PUBLIC anon key and derives, for the
// Silvis generator:
//   - Khan's East-busy days   (deriveKhanBusyDays)  -> blocks Silvis PRIMARY only
//   - Fierce's derived weeks  (deriveFierceWeeks)   -> Silvis primary/backup locks
//
// Loaded in the browser as a classic script (config -> helpers -> rules ->
// east-feed -> generator), so every top-level name here is prefixed east/ef and
// must not collide with helpers.js / config.js / rules.js (fmt, parse, addD,
// monOf, DAY_HDR, MO ...). Also require()-able from Node (tests, scripts).
//
// Contract (guide section 7): a FAILED fetch must never look like "no East
// call" - fetchEastWeeks throws on any non-2xx; callers keep their cache and
// warn. Nothing in this file writes to the Davenport project, ever.

// The Davenport project URL and anon key, copied from the public repo's
// config.js (github.com/fkhan628/Call-Schedule-App). The anon key is PUBLIC BY
// DESIGN (it ships in the Davenport PWA); its tables are anon-readable under
// RLS. We use it for GET only. We never write to that project.
const EAST_PROJECT = {
  url: "https://xqongyahdnkozqunpwmu.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhxb25neWFoZG5rb3pxdW5wd211Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3Nzg2NDksImV4cCI6MjA5MTM1NDY0OX0.a2p_twcuDAfI_ju-oGzut_NCPNzKjBEbkhVsMGXYyww",
  note: "Davenport (DSG) project. Public anon key, read-only use. Never write to this project.",
};

// Davenport week-row shape (davenport-ref/generator.js ~line 825, plus the
// app-added dayCallOverrides map):
//   { dayCall, nights:{mon,tue,wed,thu,wknd}, off, isBackup, isFierceBackup,
//     holidayCoverage: { "YYYY-MM-DD": { surgeonId, ... } } | null,
//     dayCallOverrides?: { "YYYY-MM-DD": surgeonId } }
// - dayCall    = the service week, Mon..Sat (Sat 07:00 -> Sun 07:00 is his)
// - nights.mon..thu = that weeknight
// - nights.wknd = Friday night AND Sunday (NOT Saturday day)
// - isBackup        = Fierce is East PRIMARY that week (the Davenport group is backup)
// - isFierceBackup  = Fierce is East BACKUP that week
// - flags may be undefined on old rows; ids are DAVENPORT ids (FAK is s6 there):
//   always resolve FAK by roster code, never hard-code the id.

// ---- private date helpers (local-time, same convention as helpers.js) ----
function efPad2(n) { return (n < 10 ? "0" : "") + n; }
function efFmt(d) { return d.getFullYear() + "-" + efPad2(d.getMonth() + 1) + "-" + efPad2(d.getDate()); }
function efParse(s) { const p = String(s).split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function efAddD(d, n) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
function efIsDateStr(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function efDayOffsets(mondayStr) {
  // Mon..Sun date strings for a week, index 0..6.
  const m = efParse(mondayStr);
  const out = [];
  for (let i = 0; i < 7; i++) out.push(efFmt(efAddD(m, i)));
  return out;
}

// ---- HTTP (GET only) ----
function eastHeaders() {
  return { apikey: EAST_PROJECT.anonKey, Authorization: "Bearer " + EAST_PROJECT.anonKey, Accept: "application/json" };
}
// GET {url}/rest/v1/{pathAndQuery}; throws on non-2xx or a non-array body.
// Exported so scripts/east-forecast.js reuses the same read path.
async function eastGetJson(pathAndQuery) {
  const f = (typeof globalThis !== "undefined" && globalThis.fetch) ? globalThis.fetch : null;
  if (!f) throw new Error("east-feed: fetch is not available in this runtime");
  const url = EAST_PROJECT.url + "/rest/v1/" + pathAndQuery;
  const res = await f(url, { method: "GET", headers: eastHeaders() });
  if (!res.ok) {
    let body = "";
    try { body = (await res.text()).slice(0, 200); } catch (e) { /* ignore */ }
    throw new Error("east-feed: GET " + pathAndQuery + " failed: HTTP " + res.status + " " + body);
  }
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error("east-feed: GET " + pathAndQuery + " returned a non-array body");
  return json;
}

// Resolve FAK's Davenport id from the Davenport roster (data.surgeons =
// [{id,name}] where name IS the 3-letter code). Never hard-code s6.
function eastResolveFakId(roster, code) {
  const want = String(code || "FAK").toUpperCase();
  const hit = (roster || []).find(s => s && typeof s.name === "string" && s.name.toUpperCase() === want);
  return hit ? hit.id : null;
}

// fetchEastWeeks(fromMonday, toMonday)
//   -> { weeks:[{ weekMonday, data }], roster:[{id,name}], fakId, fetchedAt }
// Throws on any transport/HTTP failure (never resolves to "no East call").
async function fetchEastWeeks(fromMonday, toMonday) {
  if (!efIsDateStr(fromMonday) || !efIsDateStr(toMonday)) throw new Error("east-feed: fetchEastWeeks needs YYYY-MM-DD Mondays");
  const q = "schedule_weeks?select=week_monday,data&week_monday=gte." + fromMonday + "&week_monday=lte." + toMonday + "&order=week_monday.asc";
  const rows = await eastGetJson(q);
  const blobRows = await eastGetJson("call_schedule_data?id=eq.main&select=data");
  if (!blobRows.length || !blobRows[0] || !blobRows[0].data) throw new Error("east-feed: Davenport call_schedule_data main row missing (roster unavailable)");
  let blob = blobRows[0].data;
  if (typeof blob === "string") { try { blob = JSON.parse(blob); } catch (e) { throw new Error("east-feed: Davenport blob is not JSON"); } }
  const roster = Array.isArray(blob.surgeons) ? blob.surgeons.map(s => ({ id: s.id, name: s.name })) : [];
  const fakId = eastResolveFakId(roster, "FAK");
  if (!fakId) throw new Error("east-feed: no Davenport roster entry with code FAK");
  const weeks = rows
    .filter(r => r && efIsDateStr(r.week_monday))
    .map(r => ({ weekMonday: r.week_monday, data: (typeof r.data === "string" ? JSON.parse(r.data) : r.data) || {} }))
    .sort((a, b) => a.weekMonday < b.weekMonday ? -1 : a.weekMonday > b.weekMonday ? 1 : 0);
  return { weeks, roster, fakId, fetchedAt: new Date().toISOString() };
}

// deriveKhanBusyDays(weeks, fakId, opts)
//   weeks: [{ weekMonday, data }] (Davenport rows or east_feed cache rows)
//   -> { busy: Set<'YYYY-MM-DD'>, reasons: { date: [reason, ...] } }
// Reasons: 'service-week' | 'override' | 'night' | 'weekend' | 'holiday',
// plus 'backup-week' appended on every busy day inside an isBackup week.
//
// Rules (guide section 7):
//   dayCall === fakId              -> Mon..Sat busy ('service-week')
//   dayCallOverrides[date]===fakId -> that date busy ('override'); an override
//                                     of a service-week date to SOMEONE ELSE
//                                     removes the service-week reason for it
//   nights.mon/tue/wed/thu===fakId -> that weekday busy ('night')
//   nights.wknd === fakId          -> Fri and Sun busy ('weekend') - Saturday
//                                     day belongs to the service-week surgeon
//   holidayCoverage[d].surgeonId===fakId -> d busy ('holiday')
// Precedence on one date: holiday 24h > dayCallOverrides > dayCall. A
// holidayCoverage entry for SOMEONE ELSE on d means that surgeon holds the
// whole 07:00->07:00 day (Davenport's calendar drops the Svc/Sat/Ngt/Wknd
// entries for d; its generator reassigns the night/wknd slot), so FAK gets NO
// reason on d - not service-week, override, night or weekend. Verified on the
// live row 2026-09-07 (dayCall FAK, Labor Day held by another surgeon).
// Rows with data.isForecast === true (scripts/east-forecast.js output) are
// NOT Davenport rows and are skipped here; see forecastFromFeedRows.
// East backup weeks (isBackup): the whole Davenport group is BACKUP that week,
// so FAK's shifts there are backup call. Seed rule s1.eastBackupCountsAsBusy
// (true) says backup call still blocks Silvis primary. CHOICE: the flag is
// applied ONLY to the days FAK actually holds in that week - a backup week is
// never marked busy wholesale, because FAK is on backup only on his own
// shifts, not all seven days. With eastBackupCountsAsBusy:false those days are
// dropped from the busy set entirely (they stay visible in reasons prefixed
// 'ignored:' so a UI can still explain them).
function deriveKhanBusyDays(weeks, fakId, opts) {
  const o = Object.assign({ eastBackupCountsAsBusy: true }, opts || {});
  const busy = new Set();
  const reasons = {};
  const add = (date, why) => { (reasons[date] = reasons[date] || []).push(why); busy.add(date); };
  if (!fakId) return { busy, reasons };
  (weeks || []).forEach(w => {
    if (!w || !efIsDateStr(w.weekMonday) || efIsForecastRow(w)) return;
    const d = w.data || {};
    const days = efDayOffsets(w.weekMonday); // 0=Mon .. 6=Sun
    const nights = d.nights || {};
    const ov = d.dayCallOverrides || {};
    const hc = d.holidayCoverage || {};
    // holiday 24h held by someone else -> that whole day is theirs, not FAK's
    const heldByOther = (date) => { const c = hc[date]; return !!(c && c.surgeonId && c.surgeonId !== fakId); };
    const weekBusy = {}; // date -> [reasons] for this week only
    const push = (date, why) => {
      if (why !== "holiday" && heldByOther(date)) return;
      (weekBusy[date] = weekBusy[date] || []).push(why);
    };

    // service week Mon..Sat, honoring per-day overrides (holiday 24h beats both)
    for (let i = 0; i <= 5; i++) {
      const ds = days[i];
      const overridden = Object.prototype.hasOwnProperty.call(ov, ds) && ov[ds] != null && ov[ds] !== "";
      if (overridden) {
        if (ov[ds] === fakId) push(ds, "override");
        // an override to someone else: service-week busy does NOT apply to ds
      } else if (d.dayCall === fakId) {
        push(ds, "service-week");
      }
    }
    // weeknights
    [["mon", 0], ["tue", 1], ["wed", 2], ["thu", 3]].forEach(([k, i]) => { if (nights[k] === fakId) push(days[i], "night"); });
    // weekend = Friday night + Sunday (not Saturday day)
    if (nights.wknd === fakId) { push(days[4], "weekend"); push(days[6], "weekend"); }
    // holiday coverage (24h units) - only dates inside this week's Mon..Sun
    Object.keys(hc).forEach(ds => {
      if (hc[ds] && hc[ds].surgeonId === fakId && days.indexOf(ds) >= 0) push(ds, "holiday");
    });

    const isBackupWeek = d.isBackup === true;
    Object.keys(weekBusy).forEach(ds => {
      if (isBackupWeek) {
        weekBusy[ds].push("backup-week");
        if (!o.eastBackupCountsAsBusy) { reasons[ds] = (reasons[ds] || []).concat(weekBusy[ds].map(r => "ignored:" + r)); return; }
      }
      weekBusy[ds].forEach(r => add(ds, r));
    });
  });
  return { busy, reasons };
}

// deriveFierceWeeks(weeks, opts)
//   opts: { deriveFrom: 'YYYY-MM-DD' (Monday; weeks before it are dropped),
//           statedWeeks: { eastPrimary:[mondays], eastBackup:[mondays] } }
//   -> [{ weekMonday, silvisRole:'primary'|'backup', source:'feed'|'stated' }]
// Feed rows:   isBackup (Fierce East PRIMARY) -> Silvis 'backup' Mon-Sun
//              isFierceBackup (Fierce East BACKUP) -> Silvis 'primary' Mon-Sun
// Stated weeks (Faraz, ahead of publication) fill ONLY weeks the feed has no
// PUBLISHED row for; a published row always wins, flagged or not. Forecast
// rows (data.isForecast) are not published rows and never suppress a stated week.
function deriveFierceWeeks(weeks, opts) {
  const o = Object.assign({ deriveFrom: null, statedWeeks: null }, opts || {});
  const out = {};
  const feedMondays = new Set();
  (weeks || []).forEach(w => {
    if (!w || !efIsDateStr(w.weekMonday) || efIsForecastRow(w)) return;
    feedMondays.add(w.weekMonday);
    const d = w.data || {};
    if (d.isBackup === true) out[w.weekMonday] = { weekMonday: w.weekMonday, silvisRole: "backup", source: "feed" };
    else if (d.isFierceBackup === true) out[w.weekMonday] = { weekMonday: w.weekMonday, silvisRole: "primary", source: "feed" };
  });
  const st = o.statedWeeks || {};
  (st.eastPrimary || []).forEach(m => { if (efIsDateStr(m) && !feedMondays.has(m)) out[m] = { weekMonday: m, silvisRole: "backup", source: "stated" }; });
  (st.eastBackup || []).forEach(m => { if (efIsDateStr(m) && !feedMondays.has(m)) out[m] = { weekMonday: m, silvisRole: "primary", source: "stated" }; });
  return Object.keys(out)
    .filter(m => !o.deriveFrom || m >= o.deriveFrom)
    .sort()
    .map(m => out[m]);
}

// coverageOf(weeks) -> { from: firstMonday, to: lastSunday } | null
// PUBLISHED coverage only: forecast rows do not count as East coverage.
function coverageOf(weeks) {
  const ms = (weeks || []).filter(w => w && efIsDateStr(w.weekMonday) && !efIsForecastRow(w)).map(w => w.weekMonday).sort();
  if (!ms.length) return null;
  return { from: ms[0], to: efFmt(efAddD(efParse(ms[ms.length - 1]), 6)) };
}

// ---- forecast rows (scripts/east-forecast.js --sql -> public.east_forecast) ----
// A forecast row is { week_monday | weekMonday, data:{ isForecast:true, runs,
// generatedAt, fakBusyProbabilityByDay:{date:p}, fierceWeekProbability } }.
// It lives in its own table (east_forecast), but every deriver above ALSO
// refuses it by the isForecast marker, so a forecast row that ends up in the
// east_feed cache can never read as "published" (Khan free, Fierce stated
// week suppressed, coverage claimed). Forecast data is consumed only here.
function efIsForecastRow(w) { return !!(w && w.data && w.data.isForecast === true); }

// forecastFromFeedRows(rows) -> { 'YYYY-MM-DD': probability }
//   rows: east_forecast rows or a mixed cache; non-forecast rows are ignored.
//   Feed the result to forecastToBusy(forecast, threshold).
function forecastFromFeedRows(rows) {
  const out = {};
  (rows || []).forEach(r => {
    if (!efIsForecastRow(r)) return;
    const m = r.weekMonday || r.week_monday;
    if (!efIsDateStr(m)) return;
    const byDay = r.data.fakBusyProbabilityByDay || {};
    const days = efDayOffsets(m);
    Object.keys(byDay).forEach(ds => {
      const p = Number(byDay[ds]);
      if (days.indexOf(ds) >= 0 && !Number.isNaN(p)) out[ds] = p;
    });
  });
  return out;
}

// forecastOutsideCoverage(forecast, coverage) -> { 'YYYY-MM-DD': probability }
//   Prompt 12 C (9/22): published rows win. Keeps only the forecast days OUTSIDE
//   the published coverage { from, to } (inclusive), drops malformed keys / NaN
//   probabilities, never mutates the input. rules.js ignores the forecast
//   inside ctx.eastCoverage anyway; pruning here keeps every consumer of
//   ctxInputs.eastForecast (badges, coverage strip, day editor, preview
//   script) consistent with the engine. coverage null -> the validated map.
function forecastOutsideCoverage(forecast, coverage) {
  const out = {};
  const from = coverage && efIsDateStr(coverage.from) ? coverage.from : null;
  const to = coverage && efIsDateStr(coverage.to) ? coverage.to : null;
  Object.keys(forecast || {}).forEach(ds => {
    if (!efIsDateStr(ds)) return;
    const p = Number(forecast[ds]);
    if (Number.isNaN(p)) return;
    if (from && to && ds >= from && ds <= to) return;
    out[ds] = p;
  });
  return out;
}

// overridesByPerson(overrideRows) -> { [person_id]: { 'YYYY-MM-DD': true|false } }
//   Silvis east_overrides rows grouped per person for rules.buildContext
//   input.eastOverrides (Prompt 12 C: published > override > forecast - a
//   busy:false override clears a forecast-busy day too, which applyOverrides on
//   the busy set alone cannot). Rows with a malformed day, no person_id or a
//   non-boolean busy are dropped. The last row for a (person, day) wins.
function overridesByPerson(overrideRows) {
  const out = {};
  (overrideRows || []).forEach(r => {
    if (!r || typeof r.person_id !== "string" || !r.person_id || typeof r.busy !== "boolean") return;
    const day = String(r.day || "").slice(0, 10);
    if (!efIsDateStr(day)) return;
    (out[r.person_id] = out[r.person_id] || {})[day] = r.busy;
  });
  return out;
}

// applyOverrides(busySet, overrideRows, personId) -> new Set
//   overrideRows: Silvis east_overrides rows [{ day, person_id, busy }]
//   busy:true adds the day, busy:false removes it. Applied LAST by callers.
//   Kept for older callers; the app and the preview script now ALSO pass the
//   rows as input.eastOverrides (overridesByPerson) so the forecast side of a
//   busy:false override is honoured by rules.js.
function applyOverrides(busySet, overrideRows, personId) {
  const out = new Set(busySet || []);
  (overrideRows || []).forEach(r => {
    if (!r || r.person_id !== personId || !efIsDateStr(r.day)) return;
    if (r.busy === true) out.add(r.day); else if (r.busy === false) out.delete(r.day);
  });
  return out;
}

// forecastToBusy(forecast, threshold) -> Set of dates with prob >= threshold
//   forecast: { 'YYYY-MM-DD': probability }
function forecastToBusy(forecast, threshold) {
  const t = typeof threshold === "number" ? threshold : 0.5;
  const out = new Set();
  Object.keys(forecast || {}).forEach(ds => {
    const p = Number(forecast[ds]);
    if (efIsDateStr(ds) && !Number.isNaN(p) && p >= t) out.add(ds);
  });
  return out;
}

// toEastFeedRows(weeks) -> [{ week_monday, data }] for the Silvis east_feed cache
// Forecast rows are dropped: east_feed holds published Davenport rows only.
function toEastFeedRows(weeks) {
  return (weeks || [])
    .filter(w => w && efIsDateStr(w.weekMonday) && !efIsForecastRow(w))
    .map(w => ({ week_monday: w.weekMonday, data: w.data || {} }));
}

if (typeof module !== "undefined") {
  module.exports = {
    EAST_PROJECT, eastGetJson, eastResolveFakId, fetchEastWeeks,
    deriveKhanBusyDays, deriveFierceWeeks, coverageOf, applyOverrides,
    forecastToBusy, toEastFeedRows, efIsForecastRow, forecastFromFeedRows,
    forecastOutsideCoverage, overridesByPerson,
    efFmt, efParse, efAddD, efDayOffsets,
  };
}
