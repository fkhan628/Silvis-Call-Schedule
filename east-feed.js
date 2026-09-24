// Silvis Call Schedule - East (Davenport) feed, READ-ONLY.
//
// Reads the Davenport app's Supabase project (schedule_weeks + the roster in
// call_schedule_data) with that project's PUBLIC anon key and derives, for the
// Silvis generator:
//   - Khan's East-busy days   (deriveKhanBusyDays)  -> blocks Silvis PRIMARY only
//   - Fierce's derived weeks  (deriveFierceWeeks)   -> Silvis primary/backup locks
//   - East vacations (Prompt 15 part 1a): the Davenport time_off rows, kind
//     'vacation' only, of any roster surgeon with an East code (fetchEastWeeks
//     opts.vacationCodes -> attachVacationsToWeeks -> east_feed data.vacations:
//     [{ code, start, end }]; read back with eastVacations(rows, code))
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

// Resolve a roster CODE to its Davenport id from the Davenport roster
// (data.surgeons = [{id,name}] where name IS the 3-letter code). Never
// hard-code an id, and no default code (audit RG-8, 9/23): a missing or empty
// code resolves to null. The name keeps its historical "Fak" for the callers.
function eastResolveFakId(roster, code) {
  const want = String(code || "").toUpperCase();
  if (!want) return null;
  const hit = (roster || []).find(s => s && typeof s.name === "string" && s.name.toUpperCase() === want);
  return hit ? hit.id : null;
}

// fetchEastWeeks(fromMonday, toMonday, opts)
//   opts.codes: roster CODES to resolve to Davenport ids (audit RG-8, 9/23) -
//     idsByCode / codesUnresolved in the result; no code is required and none
//     is assumed (a roster without a given code is reported, never thrown - the
//     app treats an unresolved id as "East days unknown"). vacationCodes are
//     resolved the same way and appear in both maps.
//   opts.vacationCodes: roster CODES (e.g. ["FAK"]) whose Davenport time_off
//     VACATIONS are read in the same refresh (Prompt 15 part 1a). Default [] =
//     no time_off read (scripts that only want the roster are unchanged).
//   opts.vacationsTo: YYYY-MM-DD, the inclusive END of the time_off read
//     (start_date <= it). Default: the weeks window's Sunday + 365 days. The
//     time_off read does not depend on what Davenport has published, and
//     vacations reach much further than the published weeks (Generate offers
//     12-month presets after the milestone), so it gets its own horizon
//     (review E1 finding 2, 9/23); a value before the window's Sunday, or a
//     malformed one, falls back to the default.
//   -> { weeks:[{ weekMonday, data }], roster:[{id,name}], fetchedAt,
//        idsByCode: { CODE: davenportId }, codesUnresolved: [CODE],   // codes + vacationCodes
//        fakId,                          // deprecated alias: the FIRST requested code's id, or null
//        vacations: { CODE: [{ start, end }] } | null,   // merged, sorted
//        vacationsError: string | null, vacationsTo,
//        vacationIdsByCode: { CODE: davenportId }, vacationCodesUnresolved: [CODE] }
// Throws on any transport/HTTP failure of the weeks or the roster (never
// resolves to "no East call"). The time_off read is a SEPARATE step: each code
// is resolved to its Davenport id through the roster blob (by code, never a
// hard-coded id), kind = 'vacation' only (no-call days are a Davenport
// concept), rows overlapping [fromMonday, vacationsTo]. Its failure leaves
// vacations null + vacationsError set - unknown, never "no vacations" - while
// the weeks still come back; the caller keeps each week's cached list
// (keepCachedVacations) and names the failure. A 200 with [] is a real "no
// vacations in the window" (an RLS-blocked read on the Davenport side would
// look the same - see guide section 7).
const EAST_VACATIONS_HORIZON_DAYS = 365;
async function fetchEastWeeks(fromMonday, toMonday, opts) {
  if (!efIsDateStr(fromMonday) || !efIsDateStr(toMonday)) throw new Error("east-feed: fetchEastWeeks needs YYYY-MM-DD Mondays");
  const o = Object.assign({ codes: [], vacationCodes: [], vacationsTo: null }, opts || {});
  const q = "schedule_weeks?select=week_monday,data&week_monday=gte." + fromMonday + "&week_monday=lte." + toMonday + "&order=week_monday.asc";
  const rows = await eastGetJson(q);
  const blobRows = await eastGetJson("call_schedule_data?id=eq.main&select=data");
  if (!blobRows.length || !blobRows[0] || !blobRows[0].data) throw new Error("east-feed: Davenport call_schedule_data main row missing (roster unavailable)");
  let blob = blobRows[0].data;
  if (typeof blob === "string") { try { blob = JSON.parse(blob); } catch (e) { throw new Error("east-feed: Davenport blob is not JSON"); } }
  const roster = Array.isArray(blob.surgeons) ? blob.surgeons.map(s => ({ id: s.id, name: s.name })) : [];
  // Resolve every requested code by CODE through the roster (audit RG-8, 9/23: no code is required; a
  // missing one lands in codesUnresolved - reported, never thrown).
  const upper = (list) => (Array.isArray(list) ? list : []).map(c => String(c || "").toUpperCase()).filter(Boolean);
  const wantCodes = upper(o.codes), codes = upper(o.vacationCodes);
  const idsByCode = {}, codesUnresolved = [];
  wantCodes.concat(codes).forEach(c => {
    if (idsByCode[c] || codesUnresolved.indexOf(c) >= 0) return;
    const id = eastResolveFakId(roster, c);
    if (id) idsByCode[c] = id; else codesUnresolved.push(c);
  });
  const firstCode = wantCodes[0] || codes[0] || null;
  const fakId = firstCode ? (idsByCode[firstCode] || null) : null;   // deprecated alias (see the contract above)
  const weeks = rows
    .filter(r => r && efIsDateStr(r.week_monday))
    .map(r => ({ weekMonday: r.week_monday, data: (typeof r.data === "string" ? JSON.parse(r.data) : r.data) || {} }))
    .sort((a, b) => a.weekMonday < b.weekMonday ? -1 : a.weekMonday > b.weekMonday ? 1 : 0);
  // East vacations: the vacation codes' share of the resolution above.
  const vacationIdsByCode = {}, vacationCodesUnresolved = [];
  codes.forEach(c => { if (idsByCode[c]) vacationIdsByCode[c] = idsByCode[c]; else if (vacationCodesUnresolved.indexOf(c) < 0) vacationCodesUnresolved.push(c); });
  const ids = Object.keys(vacationIdsByCode).map(c => vacationIdsByCode[c]);
  let vacations = null, vacationsError = null;
  const windowEnd = efFmt(efAddD(efParse(toMonday), 6));
  const vacationsTo = (efIsDateStr(o.vacationsTo) && o.vacationsTo >= windowEnd) ? o.vacationsTo : efFmt(efAddD(efParse(windowEnd), EAST_VACATIONS_HORIZON_DAYS));
  if (ids.length) {
    const tq = "time_off?select=person_id,kind,start_date,end_date&kind=eq.vacation&person_id=in.(" + ids.join(",") + ")&end_date=gte." + fromMonday + "&start_date=lte." + vacationsTo + "&order=start_date.asc";
    try { vacations = vacationsFromTimeOff(await eastGetJson(tq), vacationIdsByCode); }
    catch (e) { vacationsError = (e && e.message) ? e.message : String(e); }
  }
  return { weeks, roster, fakId, idsByCode, codesUnresolved, fetchedAt: new Date().toISOString(), vacations, vacationsError, vacationsTo, vacationIdsByCode, vacationCodesUnresolved };
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

// ---- East vacations (Prompt 15 part 1a, 9/23) ----
// Davenport keeps vacations in its own time_off table (id, person_id, kind,
// start_date, end_date; inclusive dates; kind 'vacation' | 'nocall'). Verified
// through the same feed path as schedule_weeks (probed 2026-09-22). The Silvis cache is per week, so a
// person's ranges are written into the payload of every cached week they
// touch (whole, not clipped) as data.vacations: [{ code, start, end }] and a
// refresh replaces them cleanly. Ranges that touch NO cached week - Davenport
// publishes a few months ahead, vacations reach further - ride on the latest
// cached week before them (or the first week when none precedes), so nothing
// inside the fetched window is lost; the next refresh, once those weeks are
// published, moves them to their own rows. eastVacations(rows, code) merges the
// per-week copies back into one sorted list for the app and rules.js. The
// ranges are dates only, never a note or reason (east_feed is anon-readable).

function efValidRange(r) { return !!(r && efIsDateStr(r.start) && efIsDateStr(r.end) && r.start <= r.end); }

// eastMergeRanges(ranges) -> [{ start, end }] sorted, overlapping AND adjacent
// (end + 1 day == next start) ranges merged, malformed / inverted ones dropped.
// Never mutates the input.
function eastMergeRanges(ranges) {
  const rs = (ranges || []).filter(efValidRange).map(r => ({ start: r.start, end: r.end }))
    .sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : a.end < b.end ? -1 : a.end > b.end ? 1 : 0);
  const out = [];
  rs.forEach(r => {
    const last = out[out.length - 1];
    if (last && r.start <= efFmt(efAddD(efParse(last.end), 1))) { if (r.end > last.end) last.end = r.end; }
    else out.push({ start: r.start, end: r.end });
  });
  return out;
}

// vacationsFromTimeOff(rows, idByCode) -> { CODE: [{ start, end }] }
//   rows: Davenport time_off rows; idByCode: { CODE: davenportId } (resolved
//   through the Davenport roster blob by fetchEastWeeks). Keeps kind
//   'vacation' rows of the resolved ids only, merged per code. Every requested
//   code gets a list (empty = known-empty; a missing code is "not asked").
function vacationsFromTimeOff(rows, idByCode) {
  const out = {}, codeOfId = {};
  Object.keys(idByCode || {}).forEach(c => {
    const code = String(c).toUpperCase();
    if (!idByCode[c]) return;
    codeOfId[idByCode[c]] = code;
    out[code] = [];
  });
  (rows || []).forEach(r => {
    if (!r || r.kind !== "vacation") return;
    const code = codeOfId[r.person_id];
    if (!code) return;
    out[code].push({ start: String(r.start_date || "").slice(0, 10), end: String(r.end_date || "").slice(0, 10) });
  });
  Object.keys(out).forEach(c => { out[c] = eastMergeRanges(out[c]); });
  return out;
}

// attachVacationsToWeeks(weeks, vacationsByCode) -> new weeks array
//   Writes data.vacations: [{ code, start, end }] (sorted by code, start) into
//   every published week: the ranges touching its Mon..Sun, plus - for a range
//   touching no cached week - the latest cached week before it (or the first).
//   vacationsByCode null (the time_off read failed) -> rows returned as they
//   are, no key written (the caller then runs keepCachedVacations). Forecast
//   rows never carry vacations. Never mutates the input.
function attachVacationsToWeeks(weeks, vacationsByCode) {
  const ws = weeks || [];
  if (!vacationsByCode || typeof vacationsByCode !== "object") return ws.slice();
  const carriers = ws.filter(w => w && efIsDateStr(w.weekMonday) && !efIsForecastRow(w)).map(w => w.weekMonday).sort();
  const per = {};
  carriers.forEach(m => { per[m] = []; });
  if (carriers.length) {
    Object.keys(vacationsByCode).forEach(c => {
      const code = String(c).toUpperCase();
      eastMergeRanges(vacationsByCode[c]).forEach(r => {
        const touched = carriers.filter(m => r.start <= efFmt(efAddD(efParse(m), 6)) && r.end >= m);
        if (touched.length) { touched.forEach(m => per[m].push({ code, start: r.start, end: r.end })); return; }
        let host = null;
        carriers.forEach(m => { if (m <= r.start) host = m; });
        per[host || carriers[0]].push({ code, start: r.start, end: r.end });
      });
    });
  }
  const order = (a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
  return ws.map(w => {
    if (!w || !efIsDateStr(w.weekMonday) || efIsForecastRow(w)) return w;
    const list = (per[w.weekMonday] || []).slice().sort(order).map(e => ({ code: e.code, start: e.start, end: e.end }));
    return Object.assign({}, w, { data: Object.assign({}, w.data || {}, { vacations: list }) });
  });
}

// keepCachedVacations(weeks, prevRows) -> new weeks array
//   The failure path: a freshly fetched week whose payload has NO vacations key
//   (the time_off read failed, or nobody was asked) inherits the list its
//   cached east_feed row (prevRows: [{ week_monday | weekMonday, data }])
//   already carries, so the upsert never wipes known vacations. A fetched list,
//   even an empty one, is never overwritten. Never mutates the input.
function keepCachedVacations(weeks, prevRows) {
  const prev = {};
  (prevRows || []).forEach(r => {
    const m = r && (r.week_monday || r.weekMonday);
    if (efIsDateStr(m) && r.data && Array.isArray(r.data.vacations)) prev[m] = r.data.vacations;
  });
  return (weeks || []).map(w => {
    if (!w || !efIsDateStr(w.weekMonday) || (w.data && w.data.vacations !== undefined) || !prev[w.weekMonday]) return w;
    return Object.assign({}, w, { data: Object.assign({}, w.data || {}, { vacations: prev[w.weekMonday].map(v => Object.assign({}, v)) }) });
  });
}

// planVacationCache(cachedRows, fetchedWeeks, vacationsByCode, opts)
//   -> { weeks, rewritten, carriers }
//   The refresh's write plan (review E1 finding 1, 9/23). The per-week split
//   and the ride-on host rule of attachVacationsToWeeks run over the WHOLE
//   cache - the cached published east_feed rows (cachedRows: [{ week_monday |
//   weekMonday, data, fetched_at? }]) plus the freshly fetched weeks, the
//   fetched payload winning per Monday - not over the refresh window alone.
//   Otherwise a range riding on the newest cached week (Davenport publishes a
//   few months ahead; vacations reach further) would go stale as soon as that
//   host left the 28-day window: cancelled or shortened in Davenport, still in
//   the cache, still a Silvis vacation (part 2's conservative default).
//   weeks:     every fetched week with its vacations attached (upserted with
//              the new fetched_at, as before).
//   rewritten: every cached published row OUTSIDE the fetched set whose list
//              changed - a ride-on range re-hosted on a now-published week, or
//              cancelled - with its own week payload, the new list and its
//              cached fetchedAt (its week data was not re-fetched). Ranges the
//              read could not see (end < opts.from, the time_off window's
//              start) are kept as they were, so old rows neither churn nor lose
//              past ranges; a row without the key whose list is empty is not
//              rewritten (absent == known-empty). Forecast rows are never
//              carriers and never rewritten.
//   carriers:  how many published rows could host a range (0 = nothing to
//              cache the vacations on).
//   vacationsByCode null (the time_off read failed) -> the fetched weeks as
//   they are, nothing rewritten (the caller runs keepCachedVacations). Never
//   mutates its inputs. The 0-weeks-fetched refresh still rewrites the host.
function planVacationCache(cachedRows, fetchedWeeks, vacationsByCode, opts) {
  const o = opts || {};
  const fresh = (fetchedWeeks || []).slice();
  if (!vacationsByCode || typeof vacationsByCode !== "object") return { weeks: fresh, rewritten: [], carriers: 0 };
  const freshBy = {};
  fresh.forEach(w => { if (w && efIsDateStr(w.weekMonday)) freshBy[w.weekMonday] = true; });
  const cached = [];
  (cachedRows || []).forEach(r => {
    const m = r && (r.week_monday || r.weekMonday);
    if (!efIsDateStr(m) || efIsForecastRow(r) || freshBy[m]) return;
    cached.push({ weekMonday: m, data: r.data || {}, fetchedAt: r.fetched_at || r.fetchedAt || null });
  });
  const attached = attachVacationsToWeeks(fresh.concat(cached), vacationsByCode);
  const carriers = attached.filter(w => w && efIsDateStr(w.weekMonday) && !efIsForecastRow(w)).length;
  const order = (a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
  const norm = list => (Array.isArray(list) ? list : []).filter(v => v && efIsDateStr(v.start) && efIsDateStr(v.end))
    .map(v => ({ code: String(v.code || "").toUpperCase(), start: v.start, end: v.end })).sort(order);
  const weeks = attached.slice(0, fresh.length);
  const rewritten = [];
  attached.slice(fresh.length).forEach((w, i) => {
    const prev = norm(cached[i].data.vacations);
    const unseen = efIsDateStr(o.from) ? prev.filter(v => v.end < o.from) : [];
    const next = norm(unseen.concat(w.data.vacations || []));
    if (JSON.stringify(next) === JSON.stringify(prev)) return;
    rewritten.push({ weekMonday: w.weekMonday, data: Object.assign({}, w.data, { vacations: next }), fetchedAt: cached[i].fetchedAt });
  });
  return { weeks, rewritten, carriers };
}

// eastVacations(rows, code) -> [{ start, end }] merged and sorted across every
//   cached week (east_feed rows or fetched weeks) for one roster code
//   (case-insensitive). Rows without the key (never refreshed since Prompt 15)
//   and forecast rows contribute nothing. This is the one read path for the
//   app and rules.js (ctx.eastVacations, Prompt 15 part 2).
function eastVacations(rows, code) {
  const want = String(code || "").toUpperCase();
  if (!want) return [];
  const all = [];
  (rows || []).forEach(r => {
    if (!r || !r.data || efIsForecastRow(r) || !Array.isArray(r.data.vacations)) return;
    r.data.vacations.forEach(v => { if (v && String(v.code || "").toUpperCase() === want) all.push({ start: v.start, end: v.end }); });
  });
  return eastMergeRanges(all);
}

if (typeof module !== "undefined") {
  module.exports = {
    EAST_PROJECT, eastGetJson, eastResolveFakId, fetchEastWeeks,
    deriveKhanBusyDays, deriveFierceWeeks, coverageOf, applyOverrides,
    forecastToBusy, toEastFeedRows, efIsForecastRow, forecastFromFeedRows,
    forecastOutsideCoverage, overridesByPerson,
    eastMergeRanges, vacationsFromTimeOff, attachVacationsToWeeks, keepCachedVacations, planVacationCache, eastVacations,
    EAST_VACATIONS_HORIZON_DAYS, efFmt, efParse, efAddD, efDayOffsets,
  };
}
