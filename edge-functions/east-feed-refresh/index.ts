// ===================================================================
// Silvis Call Schedule - East feed refresh (server side, daily) - Edge Function
// ===================================================================
// Prompt 31 Part A item 6 (Faraz 10/9: "Keep the East data fresh without anyone opening the app"; decisions 10/14).
// NOT DEPLOYED. It calls three functions of the revision x database apply (sql/migrations/2026-10-14-east-vacations.sql):
// deploy it only after that apply, in the order of edge-functions/README.md section 3 ("Deploy record - Prompt 31 Part
// A"), and create its pg_cron job (section 4, 'silvis-east-feed-daily', 10:30 UTC) only after the dryRun proof there.
//
// One run is the in-app Setup > East feed > "Refresh from Davenport" (index-source.html refreshEastFeed), unattended,
// with the same windows, the same plan and the writes in the same order:
//   0. The x-cron-secret gate comes FIRST - before the method, the body or any read (constant-time compare: the
//      @cronSecret block, byte-identical to daily-reminder's and office-notifications'). Fail closed: an unset
//      CRON_SECRET or a missing / wrong header is 401 and nothing is read. No CORS: a browser never calls this
//      function, so a preflight is refused like any other call without the secret.
//   1. Central today (America/Chicago) -> eastRefreshWindows (east-feed.js, mirrored below in UTC): the MAIN window,
//      Monday of (today - 28) .. that Monday + 210 days, read with the vacations; the weeks-only EXTRA window, 12 months
//      back .. Monday of (today + 1095) (Prompt 31 item 7 - one window in both refreshes, Part B's design D7).
//   2. Silvis reads (service role): the blob (roster + surgeonRules -> the East vacation codes, the app's
//      eastVacationPerson) and every east_feed row (the cache).
//   3. Davenport reads with its PUBLIC anon key (GET only, 8 s each, never a write): the main window's published weeks,
//      its roster blob and the vacation rows of the codes - fetchEastWeeks' three reads, query for query.
//   4. The silent-empty guard (critic A7). The vacation leg is trusted only when the time_off read worked, every code
//      resolved, and no code answered 0 ranges while the cache holds ranges of it inside the read's window: a blocked
//      read answers 200 + [], and one unattended run would otherwise clear the cached ranges, after which the reset
//      below would delete every review as 'removed'. Untrusted: each fetched week keeps its cached list
//      (keepCachedVacations, the in-app failure path), no review is reset, and the run records ok:false.
//   5. Writes (service role), in the in-app order: the east_feed upsert (merge-duplicates on week_monday: the weeks
//      fetched + the older cached rows whose list planVacationCache rewrote); the east_forecast prune inside the
//      published coverage of the weeks fetched; the cache re-read; the ONE review reset, the SQL function
//      east_vacation_reset_stale(p_from = the main window's Monday) the in-app refresh calls too - only on a trusted
//      vacation leg and a re-read cache; the EXTRA leg (the weeks outside the main window: 12 months back, ahead only
//      while contiguous - eastExtraWeeks - each keeping its cached list); ONE east.refresh audit_log row, actor_id
//      'cron', actor_name 'east-feed-refresh (cron)', with ok and error (the scheduler reads it in Setup).
//   6. Item 2's warning (report section 3, critic A12). When the refresh made a new or changed away / unreviewed range
//      (silvis_derived_vacations, compared exactly with the ranges the cache held before), the audit detail names -
//      dates only - the days from today on which that range leaves fewer than the minimum around
//      (silvis_vacation_short_days: the ONE SQL definition, never a copy of the guard's counting) and the published
//      days the person holds inside it, plus a trailing-edge-role day before it. Never a block, a drop or a lock.
//   Never: a delete of a cached week (east_feed rows are only upserted), a write to the other project, a mail or a
//   push, a contact read, a write to time_off.
//
// Body: {} (the cron) or { "dryRun": true } - a boolean only; anything else is a 400 and nothing is read. dryRun reads
// everything (steps 1-4 and the extra leg's read), plans, and writes NOTHING (no east_feed row, no prune, no reset, no
// audit row); the answer says what a live run would write - the post-deploy proof.
//
// Answers: 401 (the gate), 405 (not POST), 400 (dryRun not a boolean), 500 (SUPABASE_URL / the service key missing);
// 502 when a read the plan needs failed (the Silvis blob or cache, the weeks or the roster blob of the other project) or
// the east_feed upsert failed - nothing was written to the cache, and a live run's audit row says ok:false with the
// error; otherwise 200 with ok true / false (false: the time_off read, the guard, the prune, the re-read, the reset, the
// extra leg or the warning reads failed or were skipped for safety - each one named in errors, each <= 200 characters).
// The answer starts with "dryRun" (the proof reads its first 400 characters through pg_net).
//
// Audit detail (the in-app east.refresh row's keys plus the server's): { summary, source 'cron', ok, error, errors,
// failed, today, from, to, weeks, coverage, forecastRowsDeleted, forecastDeleteError, vacations { codes, ranges, to,
// rewrittenWeeks, unresolved, error, trusted, guard }, reviewResets [{ person_id, start, end, reason, decision }],
// reviewResetError, reviewResetSkipped, extra { from, to, weeks, past, ahead, skipped, error }, newRanges
// [{ person_id, start, end }], shortDays [day], heldDays [day], warningsError, fetchedAt }.
//
// Secrets (by NAME): CRON_SECRET (exists - the live pg_cron jobs use it); SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// injected by Supabase. No new secret.
//
// Deploy (Faraz, by hand - a git push never deploys a function):
//   supabase functions deploy east-feed-refresh --project-ref bzhsroegtagqhutbnsrp --no-verify-jwt

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// The other (Davenport) project, read-only: the URL and the anon key copied from east-feed.js EAST_PROJECT (the same
// constants calendar-sync and office-notifications carry). The anon key is PUBLIC BY DESIGN - it ships in that
// project's PWA. GET only, never a write.
const EAST_PROJECT_URL = "https://xqongyahdnkozqunpwmu.supabase.co";
const EAST_PROJECT_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhxb25neWFoZG5rb3pxdW5wd211Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3Nzg2NDksImV4cCI6MjA5MTM1NDY0OX0.a2p_twcuDAfI_ju-oGzut_NCPNzKjBEbkhVsMGXYyww";

// Each read of the other project is capped (a hung endpoint must fail the run, never stall it until the wall clock);
// the pg_cron job gives the whole run 60 s (timeout_milliseconds), five reads of 8 s fit inside it.
const DAVENPORT_TIMEOUT_MS = 8000;
const SILVIS_TIMEOUT_MS = 10000;

// ---------------------------------------------------------------------------
// Inline helpers (no shared module between the Silvis functions)
// ---------------------------------------------------------------------------
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const cut = (s: unknown): string => String(s == null ? "" : s).slice(0, 200);

// Service-role PostgREST call. A non-2xx throws - never a silent empty result.
async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json",
      ...((init.headers as Record<string, string>) || {}),
    },
    signal: AbortSignal.timeout(SILVIS_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new HttpError(res.status, `${path.split("?")[0]} ${init.method || "GET"} failed: HTTP ${res.status} ${text.slice(0, 160)}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// GET {other project}/rest/v1/{pathAndQuery} - east-feed.js eastGetJson with a timeout: a non-2xx or a non-array body
// throws (a failed read never means "no East call").
async function davGetJson(pathAndQuery: string): Promise<any[]> {
  const res = await fetch(`${EAST_PROJECT_URL}/rest/v1/${pathAndQuery}`, {
    method: "GET",
    headers: { apikey: EAST_PROJECT_ANON_KEY, Authorization: `Bearer ${EAST_PROJECT_ANON_KEY}`, Accept: "application/json" },
    signal: AbortSignal.timeout(DAVENPORT_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new HttpError(res.status, `Davenport GET ${pathAndQuery.split("?")[0]} failed: HTTP ${res.status} ${body.slice(0, 120)}`);
  }
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new HttpError(502, `Davenport GET ${pathAndQuery.split("?")[0]} returned a non-array body`);
  return rows;
}

// ---------------------------------------------------------------------------
// x-cron-secret compare (Prompt 16 B5). Plain JavaScript between the markers: test/edge-functions.test.js extracts this
// block from every cron function, checks the copies are identical, evaluates it with new Function and runs it.
// Constant time: both sides are SHA-256 hashed, the 32 bytes XOR-folded with no early exit. Fail closed: an unset /
// empty CRON_SECRET and a missing / empty header refuse before anything is hashed.
// ---------------------------------------------------------------------------
// @cronSecret-mirror-start
async function sha256Bytes(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
  return new Uint8Array(digest);
}
function bytesEqualConstantTime(a, b) {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (i < a.length ? a[i] : 0) ^ (i < b.length ? b[i] : 0);
  return diff === 0;
}
async function cronSecretMatches(given, expected) {
  if (typeof expected !== "string" || expected.length === 0) return false;   // nothing configured: nobody gets in
  if (typeof given !== "string" || given.length === 0) return false;         // no header / an empty header
  const [g, e] = await Promise.all([sha256Bytes(given), sha256Bytes(expected)]);
  return bytesEqualConstantTime(g, e);
}
// @cronSecret-mirror-end

// ---------------------------------------------------------------------------
// The East feed refresh's pure pieces - plain JavaScript between the markers (Deno cannot load the app's classic
// east-feed.js). The first part is east-feed.js itself, function for function, with ONE difference on purpose: the
// date arithmetic is UTC (efParse / efFmt / efAddD / efMonday, the last day of a month) where east-feed.js uses the
// device's local time - both read and write plain YYYY-MM-DD strings, so the answers are the same in every zone.
// test/edge-functions.test.js pins that by BEHAVIOUR (critic A9), not by bytes: every ported function against
// east-feed.js over generated fixtures in child processes under six time zones (fetchEastWeeks request for request),
// and a local-time mutant that the zones west of UTC catch. Change east-feed.js and this block together.
// The second part is the server's own: the codes (the app's eastVacationPerson), the A7 guard, the two write plans,
// the warning days, Central today and the summary - each unit-tested there, the handler run against a fake Silvis
// and a fake Davenport.
// ---------------------------------------------------------------------------
// @eastRefresh-mirror-start
const EAST_AHEAD_DAYS = 1095;
const EAST_VACATIONS_HORIZON_DAYS = 365;
function efPad2(n) { return (n < 10 ? "0" : "") + n; }
function efFmt(d) { return d.getUTCFullYear() + "-" + efPad2(d.getUTCMonth() + 1) + "-" + efPad2(d.getUTCDate()); }
function efParse(s) { const p = String(s).split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); }
function efAddD(d, n) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n)); }
function efIsDateStr(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function efMonday(s) { const d = efParse(s); return efFmt(efAddD(d, -((d.getUTCDay() + 6) % 7))); }

// eastRefreshWindows(today) -> { main:{ from, to }, extra:{ from, to } } | null - east-feed.js's, in UTC.
function eastRefreshWindows(today) {
  if (!efIsDateStr(today) || efFmt(efParse(today)) !== today) return null;
  const mainFrom = efMonday(efFmt(efAddD(efParse(today), -28)));
  const mainTo = efFmt(efAddD(efParse(mainFrom), 210));
  const y = Number(today.slice(0, 4)) - 1, m = Number(today.slice(5, 7)), d = Number(today.slice(8, 10));
  const back = y + "-" + efPad2(m) + "-" + efPad2(Math.min(d, new Date(Date.UTC(y, m, 0)).getUTCDate()));
  return { main: { from: mainFrom, to: mainTo }, extra: { from: efMonday(back), to: efMonday(efFmt(efAddD(efParse(today), EAST_AHEAD_DAYS))) } };
}

// eastExtraWeeks(mainWeeks, extraWeeks, win) -> { weeks, past, ahead, skipped } - east-feed.js's (the extra leg's
// selection: the 12 months back, and ahead only while contiguous with the main read's last week).
function eastExtraWeeks(mainWeeks, extraWeeks, win) {
  const none = { weeks: [], past: 0, ahead: 0, skipped: 0 };
  if (!win || !win.main || !win.extra || !efIsDateStr(win.main.from) || !efIsDateStr(win.main.to) || !efIsDateStr(win.extra.from) || !efIsDateStr(win.extra.to)) return none;
  const ok = (w) => !!(w && efIsDateStr(w.weekMonday) && !efIsForecastRow(w));
  const mainSet = new Set((mainWeeks || []).filter(ok).map(w => w.weekMonday));
  const lastMain = [...mainSet].sort().pop() || null;
  const seen = new Set(), past = [], later = [];
  (extraWeeks || []).forEach(w => {
    if (!ok(w) || mainSet.has(w.weekMonday) || seen.has(w.weekMonday)) return;
    seen.add(w.weekMonday);
    const m = w.weekMonday;
    if (m < win.extra.from || m > win.extra.to) return;
    if (m < win.main.from) past.push(w);
    else if (m > win.main.to) later.push(w);
  });
  const byMonday = (a, b) => a.weekMonday < b.weekMonday ? -1 : a.weekMonday > b.weekMonday ? 1 : 0;
  past.sort(byMonday); later.sort(byMonday);
  const ahead = [];
  if (lastMain) {
    let want = efFmt(efAddD(efParse(lastMain), 7));
    for (const w of later) { if (w.weekMonday !== want) break; ahead.push(w); want = efFmt(efAddD(efParse(want), 7)); }
  }
  return { weeks: past.concat(ahead), past: past.length, ahead: ahead.length, skipped: later.length - ahead.length };
}

function efIsForecastRow(w) { return !!(w && w.data && w.data.isForecast === true); }
function efValidRange(r) { return !!(r && efIsDateStr(r.start) && efIsDateStr(r.end) && r.start <= r.end); }

// eastMergeRanges(ranges) -> [{ start, end }] sorted; overlapping AND touching (end + 1 day == next start) ranges merged.
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

// vacationsFromTimeOff(rows, idByCode) -> { CODE: [{ start, end }] } - kind 'vacation' rows of the resolved ids, merged.
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

// attachVacationsToWeeks(weeks, vacationsByCode) -> new weeks array (data.vacations per published week; a range that
// touches no cached week rides on the latest cached week before it, or the first).
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

// keepCachedVacations(weeks, prevRows) -> new weeks array (the failure path: a fetched week without a vacations key
// inherits its cached row's list; a fetched list, even an empty one, is never overwritten).
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

// planVacationCache(cachedRows, fetchedWeeks, vacationsByCode, opts) -> { weeks, rewritten, carriers } - the write
// plan over the WHOLE cache (review E1 finding 1, 9/23), east-feed.js's.
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

// eastVacations(rows, code) -> [{ start, end }] merged across every cached week for one code (case-insensitive).
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

// toEastFeedRows(weeks) -> [{ week_monday, data }] (forecast rows dropped). coverageOf(weeks) -> { from, to } | null.
function toEastFeedRows(weeks) {
  return (weeks || [])
    .filter(w => w && efIsDateStr(w.weekMonday) && !efIsForecastRow(w))
    .map(w => ({ week_monday: w.weekMonday, data: w.data || {} }));
}
function coverageOf(weeks) {
  const ms = (weeks || []).filter(w => w && efIsDateStr(w.weekMonday) && !efIsForecastRow(w)).map(w => w.weekMonday).sort();
  if (!ms.length) return null;
  return { from: ms[0], to: efFmt(efAddD(efParse(ms[ms.length - 1]), 6)) };
}

// eastResolveFakId(roster, code) -> the Davenport id of a roster CODE (by code, never a hard-coded id), or null.
function eastResolveFakId(roster, code) {
  const want = String(code || "").toUpperCase();
  if (!want) return null;
  const hit = (roster || []).find(s => s && typeof s.name === "string" && s.name.toUpperCase() === want);
  return hit ? hit.id : null;
}

// eastFetchWeeks(fromMonday, toMonday, opts, getJson) - east-feed.js fetchEastWeeks with the GET injected (the handler
// passes davGetJson): the weeks, the roster blob, then the vacation rows of the codes - the same three requests.
function eastFetchWeeks(fromMonday, toMonday, opts, getJson) {
  return (async () => {
    if (!efIsDateStr(fromMonday) || !efIsDateStr(toMonday)) throw new Error("east-feed: fetchEastWeeks needs YYYY-MM-DD Mondays");
    const o = Object.assign({ codes: [], vacationCodes: [], vacationsTo: null }, opts || {});
    const q = "schedule_weeks?select=week_monday,data&week_monday=gte." + fromMonday + "&week_monday=lte." + toMonday + "&order=week_monday.asc";
    const rows = await getJson(q);
    const blobRows = await getJson("call_schedule_data?id=eq.main&select=data");
    if (!blobRows.length || !blobRows[0] || !blobRows[0].data) throw new Error("east-feed: Davenport call_schedule_data main row missing (roster unavailable)");
    let blob = blobRows[0].data;
    if (typeof blob === "string") { try { blob = JSON.parse(blob); } catch (e) { throw new Error("east-feed: Davenport blob is not JSON"); } }
    const roster = Array.isArray(blob.surgeons) ? blob.surgeons.map(s => ({ id: s.id, name: s.name })) : [];
    const upper = (list) => (Array.isArray(list) ? list : []).map(c => String(c || "").toUpperCase()).filter(Boolean);
    const wantCodes = upper(o.codes), codes = upper(o.vacationCodes);
    const idsByCode = {}, codesUnresolved = [];
    wantCodes.concat(codes).forEach(c => {
      if (idsByCode[c] || codesUnresolved.indexOf(c) >= 0) return;
      const id = eastResolveFakId(roster, c);
      if (id) idsByCode[c] = id; else codesUnresolved.push(c);
    });
    const firstCode = wantCodes[0] || codes[0] || null;
    const fakId = firstCode ? (idsByCode[firstCode] || null) : null;
    const weeks = rows
      .filter(r => r && efIsDateStr(r.week_monday))
      .map(r => ({ weekMonday: r.week_monday, data: (typeof r.data === "string" ? JSON.parse(r.data) : r.data) || {} }))
      .sort((a, b) => a.weekMonday < b.weekMonday ? -1 : a.weekMonday > b.weekMonday ? 1 : 0);
    const vacationIdsByCode = {}, vacationCodesUnresolved = [];
    codes.forEach(c => { if (idsByCode[c]) vacationIdsByCode[c] = idsByCode[c]; else if (vacationCodesUnresolved.indexOf(c) < 0) vacationCodesUnresolved.push(c); });
    const ids = Object.keys(vacationIdsByCode).map(c => vacationIdsByCode[c]);
    let vacations = null, vacationsError = null;
    const windowEnd = efFmt(efAddD(efParse(toMonday), 6));
    const vacationsTo = (efIsDateStr(o.vacationsTo) && o.vacationsTo >= windowEnd) ? o.vacationsTo : efFmt(efAddD(efParse(windowEnd), EAST_VACATIONS_HORIZON_DAYS));
    if (ids.length) {
      const tq = "time_off?select=person_id,kind,start_date,end_date&kind=eq.vacation&person_id=in.(" + ids.join(",") + ")&end_date=gte." + fromMonday + "&start_date=lte." + vacationsTo + "&order=start_date.asc";
      try { vacations = vacationsFromTimeOff(await getJson(tq), vacationIdsByCode); }
      catch (e) { vacationsError = (e && e.message) ? e.message : String(e); }
    }
    return { weeks, roster, fakId, idsByCode, codesUnresolved, fetchedAt: new Date().toISOString(), vacations, vacationsError, vacationsTo, vacationIdsByCode, vacationCodesUnresolved };
  })();
}

// ---- the server's own pieces ----

// eastFeedPerson(s, ef): the app's eastVacationPerson - the East feature is on and blocks a role, the roster entry has
// a code and is not an outside surgeon. eastVacationCodes(roster, surgeonRules): the in-app refresh's vacationCodes
// (every roster entry, in roster order, the code upper-cased).
function eastFeedPerson(s, ef) {
  return !!(s && ef && ef.enabled && (ef.eastBlocksPrimary || ef.eastBlocksBackup) && s.code && s.type !== "external");
}
function eastVacationCodes(roster, surgeonRules) {
  return (Array.isArray(roster) ? roster : []).filter(s => {
    const ef = surgeonRules && s && surgeonRules[s.id] && surgeonRules[s.id].eastFeed;
    return eastFeedPerson(s, ef);
  }).map(s => String(s.code).toUpperCase());
}

// eastVacationReadGuard(feed, cachedRows, codes, from) -> { ok, problems } - critic A7. The vacation leg of a run is
// trusted only when: the time_off read did not fail ('read-failed'); every code resolved in the other roster
// ('unresolved'); a list came back for every code ('missing'); and no code answered 0 ranges while the cache holds
// ranges of it inside the read's window [from, feed.vacationsTo] ('empty-while-cached' - a blocked read answers
// 200 + []). A cached range outside that window does not count (the read could not see it). No codes -> ok.
function eastVacationReadGuard(feed, cachedRows, codes, from) {
  const problems = [];
  const asked = [];
  (codes || []).forEach(c => { const u = String(c || "").toUpperCase(); if (u && asked.indexOf(u) < 0) asked.push(u); });
  if (!asked.length) return { ok: true, problems };
  const f = feed || {};
  if (f.vacationsError) return { ok: false, problems: [{ code: null, why: "read-failed", detail: String(f.vacationsError).slice(0, 120) }] };
  const unresolved = (f.vacationCodesUnresolved || []).map(c => String(c || "").toUpperCase());
  asked.forEach(code => {
    if (unresolved.indexOf(code) >= 0) { problems.push({ code, why: "unresolved" }); return; }
    const list = f.vacations && Object.prototype.hasOwnProperty.call(f.vacations, code) ? f.vacations[code] : null;
    if (!Array.isArray(list)) { problems.push({ code, why: "missing" }); return; }
    if (list.length) return;
    const to = efIsDateStr(f.vacationsTo) ? f.vacationsTo : null;
    const cached = eastVacations(cachedRows, code).filter(r => (!efIsDateStr(from) || r.end >= from) && (!to || r.start <= to)).length;
    if (cached) problems.push({ code, why: "empty-while-cached", cached });
  });
  return { ok: problems.length === 0, problems };
}
function eastGuardText(p) {
  const tail = " - the cached East vacations are kept and no review is reset";
  if (!p) return "the East vacation read is not trusted" + tail;
  if (p.why === "read-failed") return ("East time_off read FAILED" + tail + ": " + (p.detail || "")).slice(0, 200);
  if (p.why === "unresolved") return (p.code + " is not in the Davenport roster" + tail).slice(0, 200);
  if (p.why === "missing") return ("no vacation list came back for " + p.code + tail).slice(0, 200);
  return ("Davenport answered no vacation for " + p.code + " while the cache holds " + p.cached + " range(s) in the read's window" + tail + " (a blocked read answers the same way)").slice(0, 200);
}

// eastMainPlan(feed, cachedRows, codes, win) - the in-app refresh's main write plan, behind the guard: trusted ->
// planVacationCache over the whole cache, else the failure path (keepCachedVacations). rows = the weeks fetched (the
// run's fetchedAt) + the rewritten older rows (their own fetchedAt) - one merge-duplicates upsert.
function eastMainPlan(feed, cachedRows, codes, win) {
  const guard = eastVacationReadGuard(feed, cachedRows, codes, win.main.from);
  const trusted = guard.ok && !!feed.vacations;
  const plan = trusted ? planVacationCache(cachedRows, feed.weeks, feed.vacations, { from: win.main.from })
    : { weeks: keepCachedVacations(feed.weeks, cachedRows), rewritten: [], carriers: 0 };
  const weekRows = toEastFeedRows(plan.weeks).map(r => Object.assign({}, r, { fetched_at: feed.fetchedAt }));
  const rewrittenRows = plan.rewritten.map(w => ({ week_monday: w.weekMonday, data: w.data, fetched_at: w.fetchedAt || feed.fetchedAt }));
  const ranges = feed.vacations ? Object.keys(feed.vacations).reduce((acc, c) => acc + feed.vacations[c].length, 0) : null;
  return { guard, trusted, carriers: plan.carriers, weekRows, rewrittenRows, rows: weekRows.concat(rewrittenRows), coverage: coverageOf(feed.weeks), ranges };
}

// eastExtraPlan(feed, more, win, cacheRows) - the in-app extra leg: the weeks eastExtraWeeks keeps, each keeping the
// list its cached row carries (cacheRows = the cache as re-read after the main upsert), the extra read's fetchedAt.
function eastExtraPlan(feed, more, win, cacheRows) {
  const sel = eastExtraWeeks(feed.weeks, more.weeks, win);
  const rows = toEastFeedRows(keepCachedVacations(sel.weeks, cacheRows)).map(r => Object.assign({}, r, { fetched_at: more.fetchedAt }));
  return { rows, past: sel.past, ahead: sel.ahead, skipped: sel.skipped };
}

// eastCacheAfter(cachedRows, upsertRows) -> the cache after a merge-duplicates upsert on week_monday, sorted.
function eastCacheAfter(cachedRows, upsertRows) {
  const by = {};
  (cachedRows || []).forEach(r => { const m = r && (r.week_monday || r.weekMonday); if (efIsDateStr(m)) by[m] = { week_monday: m, data: r.data || {}, fetched_at: r.fetched_at || r.fetchedAt || null }; });
  (upsertRows || []).forEach(r => { if (r && efIsDateStr(r.week_monday)) by[r.week_monday] = { week_monday: r.week_monday, data: r.data || {}, fetched_at: r.fetched_at || null }; });
  return Object.keys(by).sort().map(m => by[m]);
}

// eastRangeRows(cacheRows, roster, surgeonRules) -> [{ person_id, start_date, end_date }]: every merged range of every
// East person (no review state) - the dry run's planned picture, shaped like silvis_derived_vacations' rows.
function eastRangeRows(cacheRows, roster, surgeonRules) {
  const out = [];
  (Array.isArray(roster) ? roster : []).forEach(s => {
    const ef = surgeonRules && s && surgeonRules[s.id] && surgeonRules[s.id].eastFeed;
    if (!eastFeedPerson(s, ef)) return;
    eastVacations(cacheRows, s.code).forEach(r => out.push({ person_id: String(s.id), start_date: r.start, end_date: r.end }));
  });
  return out;
}

// eastNewRanges(derivedRows, beforeRows, roster, today) -> [{ person_id, start, end }]: the derived rows (away /
// unreviewed) that are not exactly a merged range the cache held for that person's code BEFORE the run, ending today
// or later; sorted by start, then person.
function eastNewRanges(derivedRows, beforeRows, roster, today) {
  const codeOf = {};
  (Array.isArray(roster) ? roster : []).forEach(s => { if (s && s.id && s.code) codeOf[String(s.id)] = String(s.code).toUpperCase(); });
  const out = [], seen = {};
  (derivedRows || []).forEach(r => {
    const pid = r && r.person_id ? String(r.person_id) : "";
    const s = String((r && r.start_date) || "").slice(0, 10), e = String((r && r.end_date) || "").slice(0, 10);
    if (!pid || !efIsDateStr(s) || !efIsDateStr(e) || s > e || (efIsDateStr(today) && e < today)) return;
    const before = codeOf[pid] ? eastVacations(beforeRows, codeOf[pid]) : [];
    if (before.some(b => b.start === s && b.end === e)) return;
    const k = pid + "|" + s + "|" + e;
    if (seen[k]) return;
    seen[k] = true;
    out.push({ person_id: pid, start: s, end: e });
  });
  return out.sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : a.person_id < b.person_id ? -1 : a.person_id > b.person_id ? 1 : 0);
}

// eastShortDays(shortRows, newRanges) -> [day]: the days silvis_vacation_short_days lists that lie inside a new range
// whose person is off that day through a derived row only (the East range is what puts the day under the minimum).
function eastShortDays(shortRows, newRanges) {
  const out = {};
  (shortRows || []).forEach(r => {
    const d = String((r && r.day) || "").slice(0, 10);
    const ids = Array.isArray(r && r.derived_only_ids) ? r.derived_only_ids.map(String) : [];
    if (!efIsDateStr(d)) return;
    if ((newRanges || []).some(n => n && d >= n.start && d <= n.end && ids.indexOf(n.person_id) >= 0)) out[d] = true;
  });
  return Object.keys(out).sort();
}

// eastTrailingRoles(groupRules): the roles whose day before a vacation is its trailing edge - rules.js buildContext's
// reading (groupRules.dayBeforeRules.trailingEdgeRoles, default ["primary"]).
function eastTrailingRoles(groupRules) {
  const dayBefore = (groupRules && groupRules.dayBeforeRules) || {};
  return dayBefore.trailingEdgeRoles || ["primary"];
}
// eastHeldSpan(newRanges) -> { from, to } | null: the published days to read (the day before the first start .. the
// last end).
function eastHeldSpan(newRanges) {
  const ok = (newRanges || []).filter(n => n && efIsDateStr(n.start) && efIsDateStr(n.end) && n.start <= n.end);
  if (!ok.length) return null;
  const from = ok.map(n => n.start).sort()[0], to = ok.map(n => n.end).sort().pop();
  return { from: efFmt(efAddD(efParse(from), -1)), to };
}
// eastHeldDays(newRanges, scheduleRows, trailingRoles, today) -> [day]: the published days the person holds (primary or
// backup) inside a new range, plus the day before it when he holds a trailing-edge role then; from today on.
function eastHeldDays(newRanges, scheduleRows, trailingRoles, today) {
  const roles = trailingRoles && typeof trailingRoles.indexOf === "function" ? trailingRoles : ["primary"];
  const byDay = {};
  (scheduleRows || []).forEach(r => { const d = String((r && r.day) || "").slice(0, 10); if (efIsDateStr(d)) byDay[d] = r; });
  const out = {};
  (newRanges || []).forEach(n => {
    if (!n || !efIsDateStr(n.start) || !efIsDateStr(n.end) || n.start > n.end) return;
    for (let d = n.start; d <= n.end; d = efFmt(efAddD(efParse(d), 1))) {
      const r = byDay[d];
      if (r && (r.primary_id === n.person_id || r.backup_id === n.person_id)) out[d] = true;
    }
    const before = efFmt(efAddD(efParse(n.start), -1)), rb = byDay[before];
    if (rb && ((roles.indexOf("primary") >= 0 && rb.primary_id === n.person_id) || (roles.indexOf("backup") >= 0 && rb.backup_id === n.person_id))) out[before] = true;
  });
  return Object.keys(out).filter(d => !efIsDateStr(today) || d >= today).sort();
}

// centralYmd(date) -> 'YYYY-MM-DD' in America/Chicago (helpers.js todayCentral's reading, DST-aware).
function centralYmd(date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (t) => { const p = parts.find(x => x.type === t); return p ? p.value : ""; };
  return get("year") + "-" + get("month") + "-" + get("day");
}

// eastRefreshResult(today, win, dryRun) -> the run's answer (and, without dryRun / audit, its audit detail) before
// anything is read. dryRun is the first key: the post-deploy proof reads the answer's first 400 characters.
function eastRefreshResult(today, win, dryRun) {
  return {
    dryRun: !!dryRun, ok: false, error: null, errors: [], failed: false, source: "cron", today,
    from: win ? win.main.from : null, to: win ? win.main.to : null,
    weeks: null, coverage: null, forecastRowsDeleted: null, forecastDeleteError: null,
    vacations: { codes: [], ranges: null, to: null, rewrittenWeeks: 0, unresolved: [], error: null, trusted: false, guard: [] },
    reviewResets: [], reviewResetError: null, reviewResetSkipped: null,
    extra: { from: win ? win.extra.from : null, to: win ? win.extra.to : null, weeks: 0, past: 0, ahead: 0, skipped: 0, error: null },
    newRanges: [], shortDays: [], heldDays: [], warningsError: null, fetchedAt: null,
  };
}
// eastRefreshSummary(r) -> the audit row's one-line summary (the scheduler reads it in Setup).
function eastRefreshSummary(r) {
  const head = r.dryRun ? "Server refresh of the East feed, DRY RUN (nothing written)" : "Server refresh of the East feed (cron)";
  if (r.failed) return (head + " FAILED - nothing was written to the cache: " + (r.error || "unknown error")).slice(0, 400);
  const bits = [(r.weeks == null ? 0 : r.weeks) + " published week(s) between " + r.from + " and " + r.to];
  bits.push(!r.coverage ? "forecast prune skipped (no published weeks)"
    : r.dryRun ? "forecast rows inside " + r.coverage.from + ".." + r.coverage.to + " to be deleted"
    : r.forecastRowsDeleted !== null ? r.forecastRowsDeleted + " forecast row(s) inside the published coverage deleted"
    : r.forecastDeleteError ? "forecast prune FAILED" : "forecast prune not run");
  const v = r.vacations || {};
  bits.push(!(v.codes || []).length ? "no East vacation codes"
    : v.trusted ? (v.ranges == null ? 0 : v.ranges) + " East vacation range(s) for " + v.codes.join(", ") + " through " + v.to
    : "East vacations NOT trusted - cached ones kept");
  if (r.reviewResets.length || r.reviewResetError) bits.push(r.reviewResets.length + " East vacation review(s) reset" + (r.reviewResetError ? ", the reset FAILED" : ""));
  const x = r.extra || {};
  bits.push(x.error ? "Davenport weeks outside the window NOT cached" : x.weeks + " more published week(s) cached (" + x.from + ".." + x.to + (x.skipped ? "; " + x.skipped + " after a gap skipped" : "") + ")");
  if (r.newRanges.length) bits.push(r.newRanges.length + " new or changed East vacation range(s): " + r.shortDays.length + " day(s) under the vacation minimum, " + r.heldDays.length + " published day(s) held");
  return (head + ": " + bits.join("; ") + (r.ok ? "" : "; NOT OK: " + (r.error || "see errors"))).slice(0, 600);
}
// @eastRefresh-mirror-end

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------
async function readBlob(): Promise<any> {
  const rows = await rest("call_schedule_data?select=data&id=eq.main");
  let data = Array.isArray(rows) && rows[0] ? rows[0].data : null;
  if (typeof data === "string") data = JSON.parse(data);
  if (!data || !Array.isArray(data.roster) || !data.roster.length) throw new HttpError(502, "the blob (call_schedule_data main) has no roster");
  return data;
}

async function readCache(): Promise<any[]> {
  const rows = await rest("east_feed?select=week_monday,data,fetched_at&order=week_monday.asc");
  if (!Array.isArray(rows)) throw new HttpError(502, "the east_feed read returned a non-array body");
  return rows;
}

async function upsertFeed(rows: any[]): Promise<void> {
  await rest("east_feed", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });
}

async function writeAudit(r: any): Promise<string> {
  const detail: Record<string, unknown> = { summary: r.summary };
  for (const k of Object.keys(r)) if (k !== "dryRun" && k !== "audit" && k !== "summary") detail[k] = r[k];
  try {
    await rest("audit_log", {
      method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ actor_id: "cron", actor_name: "east-feed-refresh (cron)", action: "east.refresh", detail }),
    });
    return "inserted";
  } catch (e) {
    console.error(`[east-feed-refresh] audit_log insert failed: ${errText(e)}`);
    return "failed: " + cut(errText(e));
  }
}

function finish(r: any): void {
  r.ok = r.errors.length === 0;
  r.error = r.errors.length ? cut(r.errors.join("; ")) : null;
  r.summary = eastRefreshSummary(r);
}

// A step the run cannot go past (a read the plan needs, the cache write): nothing more is written; the answer is 502.
class StopRun extends Error {
  status: number;
  constructor(message: string, status = 502) { super(message); this.status = status; }
}

// The run: the steps fill r; ONE place finishes it, writes the audit row (live runs only) and answers - so no step can
// fail after the audit row is written, and a run that stops (StopRun, or anything unexpected) still leaves its row.
async function runRefresh(dryRun: boolean): Promise<Response> {
  const today = centralYmd(new Date());
  const win = eastRefreshWindows(today);
  const r: any = eastRefreshResult(today, win, dryRun);
  console.log(`[east-feed-refresh] central=${today} main=${r.from}..${r.to} extra=${r.extra.from}..${r.extra.to} dryRun=${dryRun}`);
  let status = 200;
  try {
    if (!win) throw new StopRun("no refresh window for " + today);
    await refreshSteps(r, win, today, dryRun);
  } catch (e) {
    // the failure leads errors (and so error); the summary says FAILED
    status = e instanceof StopRun ? e.status : 500;
    r.errors.unshift(cut(e instanceof StopRun ? e.message : "unexpected error - the run stopped here: " + errText(e)));
    r.failed = true;
  }
  finish(r);
  if (!dryRun) r.audit = await writeAudit(r);
  const line = `[east-feed-refresh] ${r.summary}${dryRun ? "" : " audit=" + r.audit}`;
  if (status === 200) console.log(line); else console.error(line);
  return json(status, r);
}

async function refreshSteps(r: any, win: any, today: string, dryRun: boolean): Promise<void> {
  // 2. Silvis reads: the blob (the codes) and the cache
  let blob: any, cacheBefore: any[];
  try { blob = await readBlob(); cacheBefore = await readCache(); }
  catch (e) { throw new StopRun("Silvis read failed - nothing written: " + errText(e)); }
  const roster = blob.roster, surgeonRules = blob.surgeonRules || {};
  const codes = eastVacationCodes(roster, surgeonRules);

  // 3. the other project: the main window with the vacation codes
  let feed: any;
  try { feed = await eastFetchWeeks(win.main.from, win.main.to, { vacationCodes: codes }, davGetJson); }
  catch (e) { throw new StopRun("Davenport read failed - the cached weeks are kept (a failed read never means no East call): " + errText(e)); }
  r.fetchedAt = feed.fetchedAt;

  // 4. the plan behind the A7 guard
  const main = eastMainPlan(feed, cacheBefore, codes, win);
  r.weeks = main.weekRows.length;
  r.coverage = main.coverage;
  r.vacations = {
    codes, ranges: main.ranges, to: feed.vacationsTo || null, rewrittenWeeks: main.rewrittenRows.length,
    unresolved: feed.vacationCodesUnresolved || [], error: feed.vacationsError ? cut(feed.vacationsError) : null,
    trusted: main.trusted, guard: main.guard.problems,
  };
  main.guard.problems.forEach((p: any) => r.errors.push(eastGuardText(p)));
  if (!main.trusted) r.reviewResetSkipped = codes.length ? "the vacation leg is not trusted (see errors)" : "no East vacation codes";

  if (dryRun) {
    // reads only: the extra leg's read and its plan over the cache as the main upsert would leave it
    const planned = eastCacheAfter(cacheBefore, main.rows);
    let extraRows = 0;
    try {
      const more = await eastFetchWeeks(win.extra.from, win.extra.to, {}, davGetJson);
      const x = eastExtraPlan(feed, more, win, planned);
      extraRows = x.rows.length;
      r.extra.weeks = x.rows.length; r.extra.past = x.past; r.extra.ahead = x.ahead; r.extra.skipped = x.skipped;
    } catch (e) {
      r.extra.error = cut(errText(e));
      r.errors.push(cut("the Davenport weeks outside the window could NOT be read: " + errText(e)));
    }
    r.newRanges = eastNewRanges(eastRangeRows(planned, roster, surgeonRules), cacheBefore, roster, today);
    r.would = { upsert: main.rows.length, weekRows: main.weekRows.length, rewrittenRows: main.rewrittenRows.length, prune: main.coverage, reset: main.trusted ? { p_from: win.main.from } : null, extra: extraRows };
    return;
  }

  // 5a. the cache write (one merge-duplicates upsert)
  if (main.rows.length) {
    try { await upsertFeed(main.rows); }
    catch (e) { throw new StopRun(`fetched ${main.weekRows.length} week(s) but couldn't cache them - the cache is unchanged: ` + errText(e)); }
  }
  // 5b. published rows win: the forecast rows inside the published coverage of the weeks fetched
  if (main.coverage) {
    try {
      const gone = await rest(`east_forecast?week_monday=gte.${main.coverage.from}&week_monday=lte.${main.coverage.to}`, { method: "DELETE", headers: { Prefer: "return=representation" } });
      if (Array.isArray(gone)) r.forecastRowsDeleted = gone.length;
      else { r.forecastDeleteError = "delete succeeded but no representation returned (count unknown)"; r.errors.push("forecast prune: " + r.forecastDeleteError); }
    } catch (e) {
      r.forecastDeleteError = cut(errText(e));
      r.errors.push(cut("forecast prune FAILED: " + errText(e)));
    }
  }
  // 5c. the cache as it is now
  let cacheRows: any[] | null = null;
  try { cacheRows = await readCache(); }
  catch (e) { r.errors.push(cut("the cache re-read failed - no review reset, no extra leg, no warning: " + errText(e))); }
  // 5d. the ONE review reset (the SQL function both refreshes call), on a trusted vacation leg and a re-read cache only
  if (main.trusted && !cacheRows) r.reviewResetSkipped = "the cache did not reload";
  else if (main.trusted) {
    try {
      const rows = await rest("rpc/east_vacation_reset_stale", { method: "POST", body: JSON.stringify({ p_from: win.main.from }) });
      r.reviewResets = (Array.isArray(rows) ? rows : []).map((x: any) => ({
        person_id: x.person_id, start: String(x.start_date).slice(0, 10), end: String(x.end_date).slice(0, 10), reason: x.reason, decision: x.decision,
      }));
    } catch (e) {
      r.reviewResetError = cut(errText(e));
      r.errors.push(cut("review reset FAILED: " + errText(e)));
    }
  }
  if (!cacheRows) { r.extra.error = "the cache did not reload - skipped"; return; }
  // 5e. the extra leg: the weeks outside the main window, each keeping its cached list
  try {
    const more = await eastFetchWeeks(win.extra.from, win.extra.to, {}, davGetJson);
    const x = eastExtraPlan(feed, more, win, cacheRows);
    r.extra.skipped = x.skipped;
    if (x.rows.length) {
      await upsertFeed(x.rows);
      r.extra.weeks = x.rows.length; r.extra.past = x.past; r.extra.ahead = x.ahead;
    }
  } catch (e) {
    r.extra.error = cut(errText(e));
    r.errors.push(cut("the Davenport weeks outside the window were NOT cached: " + errText(e)));
  }
  // 6. item 2's warning: a new or changed away / unreviewed range -> the days under the minimum (the ONE SQL
  // definition) and the published days held inside it - dates only
  try {
    const derived = await rest("rpc/silvis_derived_vacations", { method: "POST", body: "{}" });
    r.newRanges = eastNewRanges(Array.isArray(derived) ? derived : [], cacheBefore, roster, today);
    if (r.newRanges.length) {
      const short = await rest("rpc/silvis_vacation_short_days", { method: "POST", body: JSON.stringify({ p_from: today, p_to: null }) });
      r.shortDays = eastShortDays(Array.isArray(short) ? short : [], r.newRanges);
      const span = eastHeldSpan(r.newRanges);
      const sched = span ? await rest(`schedule_days?select=day,primary_id,backup_id&day=gte.${span.from}&day=lte.${span.to}&order=day.asc`) : [];
      r.heldDays = eastHeldDays(r.newRanges, Array.isArray(sched) ? sched : [], eastTrailingRoles(blob.groupRules), today);
    }
  } catch (e) {
    r.shortDays = []; r.heldDays = [];
    r.warningsError = cut(errText(e));
    r.errors.push(cut("the vacation-minimum / held-day check failed: " + errText(e)));
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
serve(async (req) => {
  // Cron-only gate, evaluated BEFORE anything else (the method, the body, every read). Fail closed: no secret
  // configured means nobody gets in. Constant-time compare (the @cronSecret block).
  const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
  if (!(await cronSecretMatches(req.headers.get("x-cron-secret"), CRON_SECRET))) {
    console.warn("[east-feed-refresh] rejected: missing/invalid x-cron-secret");
    return json(401, { error: "unauthorized" });
  }
  if (req.method !== "POST") return json(405, { error: "POST only" });
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json(500, { error: "function misconfigured: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing" });
    const body = await req.json().catch(() => ({}));
    if (body && typeof body === "object" && "dryRun" in body && typeof body.dryRun !== "boolean") {
      return json(400, { error: "dryRun must be a boolean; nothing was read or written" });
    }
    const dryRun: boolean = !!(body && typeof body === "object" && body.dryRun === true);
    return await runRefresh(dryRun);
  } catch (e) {
    const message = errText(e);
    console.error(`[east-feed-refresh] error: ${message}`);
    return json(500, { error: cut(message) });
  }
});
