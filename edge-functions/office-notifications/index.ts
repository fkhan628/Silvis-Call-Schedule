// ===================================================================
// Silvis Call Schedule - Office Notifications Edge Function
// ===================================================================
// Retargeted from the Davenport (DSG) office-notifications v10 on 2026-09-22.
//
// Recipients are the ACTIVE rows of office_contacts (the office contact first). The
// table is authenticated-read for the app and read here with the service
// role. There is no `departments` column at Silvis, so every active contact
// receives every notice (Davenport's SURGEON_DEPTS / department filtering is
// gone). Responses and logs carry COUNTS and contact ids, never addresses.
//
// Modes (POST JSON):
//
//   { mode: "publish", period_label: "Nov 2 - Jan 3", changes?: [{ day, role, from, to }] }
//     Manual trigger from the app after a publish. Broadcasts a "new schedule
//     published" email to every active contact, rendering the change list the
//     CLIENT computed (the function never invents schedule facts; roster ids
//     in from/to are resolved to names, unresolvable ids are never rendered).
//     Then rewrites the digest baseline so the next digest reports only
//     changes made AFTER this publish. Scheduler JWT only.
//
//   { mode: "digest" }
//     Weekly cron (or the app's "run digest now" button). Diffs the CURRENT
//     schedule_days window against the stored baseline (day + role) and the
//     current vacations (time_off) against the baseline's; if anything
//     changed, emails the change list to every active contact and stores the
//     new baseline. Self-healing like Davenport: no usable baseline -> first
//     run rebaselines silently; a baseline without the time_off stamp
//     suppresses the vacation diff for one run and heals itself.
//
//   { mode: "digest", dryRun: true }
//     Composes the full digest and returns it (counts + one rendered sample)
//     WITHOUT sending and WITHOUT touching the baseline. dryRun must be a
//     boolean and is only valid with mode=digest - anything else is a 400,
//     never a silent live run.
//     Item D (2026-09-24): every digest (live and dryRun) also composes a short
//     "<Name> at Davenport this week" section - the next EAST_DIGEST_DAYS days
//     of Davenport call for every roster surgeon whose East feature reads busy
//     days (today Khan), from the Silvis east_feed cache + east_vacation_reviews
//     (the same words as the combined calendar's events: "Davenport service
//     week" / "night" / "weekend" / "holiday" / "day call", "away (Davenport
//     vacation)"); nothing when there is nothing. The footer carries the
//     combined-feed link (calendar-sync?surgeon=<CODE>&east=1). The response
//     (dryRun included, with or without schedule changes) carries `east`:
//     { people: [{ name, code, lines }], lines: N, html, errors: [] } so the
//     section can be proven live without a send. The send trigger is
//     UNCHANGED: a digest still goes out only when the schedule / vacation diff
//     is non-empty; the East section rides along. A failed East read renders
//     one "could not be read" line and is listed in east.errors - never a
//     silent "no Davenport call".
//
//   { mode: "rebaseline" }
//     Rewrites the baseline from the current sources and sends NOTHING. Safe
//     to invoke any time; the response doubles as a smoke test of the reads.
//
//   { mode: "test" }
//     Sends ONE short test email to the calling scheduler's own account
//     address (from the verified session) - never to office contacts.
//
// Baseline row: office_notification_state (id = 'digest_snapshot'). The table
// is defined in sql/schema.sql (applied to the live project 2026-09-22; the
// SQL is repeated in edge-functions/README.md section 2 for reference). It
// has no RLS policies (service role only); the client never reads it. Writes
// are UPSERTs, so a missing row can never turn into a silent 0-row PATCH.
// Baseline shape: { v: 2, days: { "YYYY-MM-DD": { p, b, x } }, vacations:
// { person_id: [[start, end], ...] }, vacSource: "time_off", window: { from,
// to }, captured_at }   (p = primary_id, b = backup_id, x = external_cover)
//
// AUTH (tightened vs Davenport, which accepted any caller behind the gateway):
//   - x-cron-secret equal to CRON_SECRET  -> modes digest, rebaseline (pg_cron)
//   - a VERIFIED user JWT (GoTrue) whose user_profiles.role is admin or
//     scheduler                          -> every mode
//   Anything else is 401 BEFORE any work. Fail closed: no CRON_SECRET set
//   means the cron path is shut. The gateway verify_jwt stays OFF; this check
//   is the boundary. The secret compare is constant time since Prompt 16 B5
//   (2026-09-23; the @cronSecret block).
//
// Dropped from Davenport: schedule_weeks / week+slot diff (dayCall, nights,
// wknd), APP roster + APP time-off exclusion, kind=nocall skip (time_off has
// no kind column - vacations only), department routing, baselineOverride,
// hardcoded project URL / anon-key fallback / sender address.
//
// Secrets (by NAME): RESEND_API_KEY, NOTIFICATION_FROM_EMAIL (required - no
// hardcoded fallback sender), CRON_SECRET; SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.
//
// Deploy: supabase functions deploy office-notifications --project-ref bzhsroegtagqhutbnsrp --no-verify-jwt

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = Deno.env.get("NOTIFICATION_FROM_EMAIL") || "";

const PUBLIC_URL = "https://fkhan628.github.io/Silvis-Call-Schedule/?public=1";
const APP_NAME = "Silvis Call Schedule";
const STATE_ID = "digest_snapshot";
const WINDOW_DAYS = 400;          // digest compares today .. today + WINDOW_DAYS (Central)
const MAX_RENDERED_DAYS = 300;    // change-list cap per email; the rest is summarised
const MAX_CLIENT_CHANGES = 2000;  // publish-mode change list cap
const EAST_DIGEST_DAYS = 14;      // Item D: the "at Davenport this week" section covers today .. today + 13 (Central)

// The Davenport (DSG) project, read-only, for ONE read: its roster blob, to
// resolve a roster CODE to a Davenport id when no east_forecast row of this
// project carries it (Item D; the same fallback as calendar-sync). The anon
// key is PUBLIC BY DESIGN (it ships in the Davenport PWA and in this repo's
// east-feed.js); GET only, never a write.
const EAST_PROJECT_URL = "https://xqongyahdnkozqunpwmu.supabase.co";
const EAST_PROJECT_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhxb25neWFoZG5rb3pxdW5wd211Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3Nzg2NDksImV4cCI6MjA5MTM1NDY0OX0.a2p_twcuDAfI_ju-oGzut_NCPNzKjBEbkhVsMGXYyww";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---------------------------------------------------------------------------
// Shared inline helpers (same set in all four Silvis functions; no shared module)
// ---------------------------------------------------------------------------
const pad = (n: number) => String(n).padStart(2, "0");

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Service-role PostgREST call. A non-2xx throws - never a silent empty result.
async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json",
      ...((init.headers as Record<string, string>) || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new HttpError(res.status, `${path.split("?")[0]} ${init.method || "GET"} failed: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function centralYmd(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function parseYmd(s: string): [number, number, number] {
  const [y, m, d] = s.split("-").map(Number);
  return [y, m, d];
}

function addDays(s: string, days: number): string {
  const [y, m, d] = parseYmd(s);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

// "2026-11-02" -> "Mon Nov 2"
function fmtDay(ymd: string): string {
  if (!YMD_RE.test(ymd)) return ymd;
  const [y, m, d] = parseYmd(ymd);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[dt.getUTCDay()]} ${MONTHS[m - 1]} ${d}`;
}

// "2026-06-10","2026-06-14" -> "Jun 10-14"; "2026-06-28","2026-07-02" -> "Jun 28 - Jul 2"
function fmtDateRange(start: string, end: string): string {
  if (!start) return end || "";
  if (!end || start === end) { const [, m, d] = parseYmd(start); return `${MONTHS[m - 1]} ${d}`; }
  const [sy, sm, sd] = parseYmd(start);
  const [ey, em, ed] = parseYmd(end);
  if (sy === ey && sm === em) return `${MONTHS[sm - 1]} ${sd}-${ed}`;
  return `${MONTHS[sm - 1]} ${sd} - ${MONTHS[em - 1]} ${ed}`;
}

interface RosterEntry { id: string; name: string; code: string; type?: string }
// eastPeople (Item D): the roster entries whose East feature reads busy days
// (eastFeedPerson over data.surgeonRules) - names, ids and codes only.
interface Roster { ids: Set<string>; nameById: Record<string, string>; eastPeople: RosterEntry[] }

async function loadRoster(): Promise<Roster> {
  const rows = await rest("call_schedule_data?select=data&id=eq.main");
  const raw = rows?.[0]?.data;
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  const list: RosterEntry[] = Array.isArray(data?.roster) ? data.roster : [];
  const nameById: Record<string, string> = {};
  for (const r of list) if (r?.id) nameById[String(r.id)] = r.name || String(r.id);
  const surgeonRules = (data?.surgeonRules && typeof data.surgeonRules === "object") ? data.surgeonRules : {};
  const eastPeople = list.filter((r) => r?.id && eastFeedPerson(r, surgeonRules[String(r.id)] && surgeonRules[String(r.id)].eastFeed));
  return { ids: new Set(Object.keys(nameById)), nameById, eastPeople };
}

function escHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Log redaction (Prompt 16 B5, review 2026-09-23 section 3). Plain JavaScript
// between the markers: test/edge-functions.test.js extracts this block from all
// three mail functions, checks the copies are identical, evaluates it with
// new Function and runs a provider error body through it. Until 9/23 the
// pattern had lost its two backslashes (it matched a run of capital S, an @
// and another run of capital S - nothing real), so a Resend error naming the
// address reached the function log verbatim.
// ---------------------------------------------------------------------------
// @logRedact-mirror-start
function redactAddresses(text) {
  return String(text == null ? "" : text).replace(/\S+@\S+/g, "<redacted>");
}
// @logRedact-mirror-end

// ---------------------------------------------------------------------------
// x-cron-secret compare (Prompt 16 B5, review 2026-09-23 section 3). Plain
// JavaScript between the markers: test/edge-functions.test.js extracts this
// block from both cron functions, checks the copies are identical, evaluates
// it with new Function and runs it. Constant time: both sides are SHA-256
// hashed (crypto.subtle.digest), so the compare always walks the same 32
// bytes whatever the two lengths, and the bytes are XOR-folded with no early
// exit - a near miss costs the same as a miss. Fail closed: an unset / empty
// CRON_SECRET and a missing / empty header refuse before anything is hashed.
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
// East (Davenport) calendar derivation - Item D, 2026-09-24. Plain JavaScript
// between the markers: test/edge-functions.test.js extracts this block from
// calendar-sync AND office-notifications, checks the two copies are
// byte-identical, evaluates it with new Function and pins eastBusyDays against
// east-feed.js deriveKhanBusyDays over the same fixture weeks (the app's own
// derivation; guide section 7). Inputs are the Silvis caches only: east_feed
// rows ({ week_monday | weekMonday, data }: raw Davenport schedule_weeks
// payloads, ids are DAVENPORT ids) and east_vacation_reviews rows. Dates only,
// names only - no contact data reaches an event or a digest line.
// Wording (the event titles and the digest lines share it):
//   service-week -> "Davenport service week"   night -> "Davenport night"
//   weekend      -> "Davenport weekend"        holiday -> "Davenport holiday"
//   override     -> "Davenport day call": a dayCallOverrides entry hands the
//                   day-call (Svc) slot to him for ONE day. The app has no
//                   Davenport-side legend term for it (its "East call
//                   (override)" line is the Silvis east_overrides busy:true
//                   flag - a different thing), so the event names the slot
//                   the override reassigns.
//   away         -> "away (Davenport vacation)" for an East vacation range the
//                   scheduler / the person reviewed as away.
// One all-day event per busy day: when a day carries several reasons the first
// in EAST_REASON_ORDER names it and its UID (a LOWER-precedence reason added
// later never moves the event; a higher one - e.g. a holiday assigned onto a
// service-week day - renames the UID, which a subscription handles as delete +
// add); the others go in the description. A shift inside an East backup
// week (isBackup) is still a Davenport shift and is shown - the calendar says
// where he is, so eastFeed.eastBackupCountsAsBusy (a Silvis eligibility
// switch) is not consulted here.
// ---------------------------------------------------------------------------
// @eastCalendar-mirror-start
const EAST_REASON_ORDER = ["holiday", "override", "service-week", "night", "weekend"];
const EAST_REASON_LABEL = {
  "holiday": "Davenport holiday",
  "override": "Davenport day call",
  "service-week": "Davenport service week",
  "night": "Davenport night",
  "weekend": "Davenport weekend",
};
const EAST_AWAY_LABEL = "away (Davenport vacation)";
const EAST_DASH = "\u2013";
function eastPad2(n) { return (n < 10 ? "0" : "") + n; }
function eastIsDateStr(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function eastAddDays(s, n) {
  const p = String(s).split("-").map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return d.getUTCFullYear() + "-" + eastPad2(d.getUTCMonth() + 1) + "-" + eastPad2(d.getUTCDate());
}
function eastDayOffsets(mondayStr) { const out = []; for (let i = 0; i < 7; i++) out.push(eastAddDays(mondayStr, i)); return out; }
function eastIsForecastRow(w) { return !!(w && w.data && w.data.isForecast === true); }
function eastMondayOf(w) { return w ? (w.weekMonday || w.week_monday) : null; }
// "2026-11-02" -> "Mon Nov 2" (UTC arithmetic on a date string; no zone involved)
function eastFmtDay(ymd) {
  if (!eastIsDateStr(ymd)) return String(ymd);
  const p = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getUTCDay()] + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][p[1] - 1] + " " + p[2];
}
// The app's predicate for "a surgeon with an East code" (index-source.html
// eastVacationPerson): the East feature is on and reads busy days for at least
// one role, the roster entry has a code and is not an outside surgeon. Fierce's
// feature (derived weeks, no busy-day role) is outside it on purpose.
function eastFeedPerson(s, ef) {
  return !!(s && ef && ef.enabled && (ef.eastBlocksPrimary || ef.eastBlocksBackup) && s.code && s.type !== "external");
}
// Mirror of east-feed.js deriveKhanBusyDays(weeks, eastId) with its default
// options: -> { busy: Set<date>, reasons: { date: [reason, ...] } }.
// Rules: dayCall === eastId -> Mon..Sat 'service-week', honouring dayCallOverrides
// (an override TO him -> 'override'; to someone else -> no service-week reason
// on that date); nights.mon..thu -> 'night'; nights.wknd -> Fri + Sun 'weekend'
// (Saturday day is the service week's); holidayCoverage[d].surgeonId === eastId
// -> 'holiday'. A holiday 24h held by SOMEONE ELSE clears every other reason on
// that date. 'backup-week' is appended to every busy day of an isBackup week.
// Forecast rows (data.isForecast) and malformed rows derive nothing.
function eastBusyDays(weeks, eastId) {
  const busy = new Set();
  const reasons = {};
  const add = (date, why) => { (reasons[date] = reasons[date] || []).push(why); busy.add(date); };
  if (!eastId) return { busy, reasons };
  (weeks || []).forEach((w) => {
    const monday = eastMondayOf(w);
    if (!w || !eastIsDateStr(monday) || eastIsForecastRow(w)) return;
    const d = w.data || {};
    const days = eastDayOffsets(monday); // 0=Mon .. 6=Sun
    const nights = d.nights || {};
    const ov = d.dayCallOverrides || {};
    const hc = d.holidayCoverage || {};
    const heldByOther = (date) => { const c = hc[date]; return !!(c && c.surgeonId && c.surgeonId !== eastId); };
    const weekBusy = {};
    const push = (date, why) => {
      if (why !== "holiday" && heldByOther(date)) return;
      (weekBusy[date] = weekBusy[date] || []).push(why);
    };
    for (let i = 0; i <= 5; i++) {
      const ds = days[i];
      const overridden = Object.prototype.hasOwnProperty.call(ov, ds) && ov[ds] != null && ov[ds] !== "";
      if (overridden) {
        if (ov[ds] === eastId) push(ds, "override");
      } else if (d.dayCall === eastId) {
        push(ds, "service-week");
      }
    }
    [["mon", 0], ["tue", 1], ["wed", 2], ["thu", 3]].forEach((pair) => { if (nights[pair[0]] === eastId) push(days[pair[1]], "night"); });
    if (nights.wknd === eastId) { push(days[4], "weekend"); push(days[6], "weekend"); }
    Object.keys(hc).forEach((ds) => {
      if (hc[ds] && hc[ds].surgeonId === eastId && days.indexOf(ds) >= 0) push(ds, "holiday");
    });
    const isBackupWeek = d.isBackup === true;
    Object.keys(weekBusy).forEach((ds) => {
      if (isBackupWeek) weekBusy[ds].push("backup-week");
      weekBusy[ds].forEach((r) => add(ds, r));
    });
  });
  return { busy, reasons };
}
// Mirror of east-feed.js eastMergeRanges: sorted, overlapping AND adjacent
// ranges merged, malformed / inverted ones dropped.
function eastMergeRanges(ranges) {
  const rs = (ranges || []).filter((r) => r && eastIsDateStr(r.start) && eastIsDateStr(r.end) && r.start <= r.end)
    .map((r) => ({ start: r.start, end: r.end }))
    .sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : a.end < b.end ? -1 : a.end > b.end ? 1 : 0);
  const out = [];
  rs.forEach((r) => {
    const last = out[out.length - 1];
    if (last && r.start <= eastAddDays(last.end, 1)) { if (r.end > last.end) last.end = r.end; }
    else out.push({ start: r.start, end: r.end });
  });
  return out;
}
// Mirror of east-feed.js eastVacations(rows, code): the person's Davenport
// vacation ranges from the east_feed payloads (data.vacations: [{ code, start,
// end }]), merged across every cached week. Forecast rows contribute nothing.
function eastVacationRanges(rows, code) {
  const want = String(code || "").toUpperCase();
  if (!want) return [];
  const all = [];
  (rows || []).forEach((r) => {
    if (!r || !r.data || eastIsForecastRow(r) || !Array.isArray(r.data.vacations)) return;
    r.data.vacations.forEach((v) => { if (v && String(v.code || "").toUpperCase() === want) all.push({ start: v.start, end: v.end }); });
  });
  return eastMergeRanges(all);
}
// The ranges reviewed as away: an east_vacation_reviews row of this roster id
// with decision 'away' whose start and end equal a merged feed range (the
// review key; rules.js matches start and end exactly - a review of a range
// Davenport has since changed names nothing).
function eastAwayRanges(ranges, reviews, rosterId) {
  const out = [];
  (ranges || []).forEach((r) => {
    const hit = (reviews || []).some((v) => v && String(v.person_id) === String(rosterId) && v.decision === "away"
      && String(v.start || "").slice(0, 10) === r.start && String(v.end || "").slice(0, 10) === r.end);
    if (hit) out.push({ start: r.start, end: r.end });
  });
  return out;
}
// eastEntries({ lastName, code, rosterId, eastId, weeks, reviews, from, to })
//   -> { busy: [{ kind:'busy', day, end, reason, reasons, backupWeek, title, detail }],
//        away: [{ kind:'away', start, end, endExclusive, title }] }
// busy: one entry per Davenport busy day inside [from, to] (inclusive; a
// missing bound is open); end = the next day (an all-day DTEND is exclusive).
// away: every away range that overlaps the window, whole (not clipped).
function eastEntries(o) {
  const name = String((o && o.lastName) || "").trim() || String((o && o.code) || "");
  const from = o && eastIsDateStr(o.from) ? o.from : null;
  const to = o && eastIsDateStr(o.to) ? o.to : null;
  const inWindow = (d) => (!from || d >= from) && (!to || d <= to);
  const derived = eastBusyDays(o && o.weeks, o && o.eastId);
  const busy = Object.keys(derived.reasons).sort().filter(inWindow).map((day) => {
    const list = derived.reasons[day];
    const ordered = EAST_REASON_ORDER.filter((r) => list.indexOf(r) >= 0);
    const reason = ordered[0] || list[0];
    const backupWeek = list.indexOf("backup-week") >= 0;
    const label = EAST_REASON_LABEL[reason] || "Davenport call";
    return {
      kind: "busy", day, end: eastAddDays(day, 1), reason, reasons: ordered, backupWeek,
      title: name + " " + EAST_DASH + " " + label,
      detail: ordered.map((r) => EAST_REASON_LABEL[r] || r).join(", ") + (backupWeek ? " (East backup week)" : ""),
    };
  });
  const ranges = eastVacationRanges(o && o.weeks, o && o.code);
  const away = eastAwayRanges(ranges, o && o.reviews, o && o.rosterId)
    .filter((r) => (!to || r.start <= to) && (!from || r.end >= from))
    .map((r) => ({ kind: "away", start: r.start, end: r.end, endExclusive: eastAddDays(r.end, 1), title: name + " " + EAST_DASH + " " + EAST_AWAY_LABEL }));
  return { busy, away };
}
// eastDigestLines(entries) -> ["Mon Oct 12 - Sat Oct 17: Davenport service week", ...]
// Consecutive busy days with the same reason collapse into one line; away
// ranges follow in date order. The words are the event titles' (after the
// name). Empty when there is nothing - the digest then renders no section.
function eastDigestLines(entries) {
  const runs = [];
  ((entries && entries.busy) || []).forEach((e) => {
    const last = runs[runs.length - 1];
    if (last && last.reason === e.reason && eastAddDays(last.end, 1) === e.day) last.end = e.day;
    else runs.push({ start: e.day, end: e.day, reason: e.reason, label: EAST_REASON_LABEL[e.reason] || "Davenport call" });
  });
  const items = runs.map((r) => ({ start: r.start, text: (r.start === r.end ? eastFmtDay(r.start) : eastFmtDay(r.start) + " " + EAST_DASH + " " + eastFmtDay(r.end)) + ": " + r.label }))
    .concat(((entries && entries.away) || []).map((a) => ({ start: a.start, text: (a.start === a.end ? eastFmtDay(a.start) : eastFmtDay(a.start) + " " + EAST_DASH + " " + eastFmtDay(a.end)) + ": " + EAST_AWAY_LABEL })));
  return items.sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0).map((i) => i.text);
}
// @eastCalendar-mirror-end

// Resolve a roster CODE to the surgeon's DAVENPORT id (FAK is s6 there; never
// hard-code it) - the same two-step read as calendar-sync: an east_forecast
// row of this project (data.code + data.fakId), else the Davenport roster
// blob, read-only with its public anon key. null when neither knows the code;
// a transport / HTTP failure throws.
async function resolveEastId(code: string): Promise<string | null> {
  const want = String(code || "").toUpperCase();
  if (!want) return null;
  const fc = await rest(`east_forecast?select=data&data->>code=eq.${encodeURIComponent(want)}&order=week_monday.desc&limit=1`);
  const d = Array.isArray(fc) && fc[0] ? fc[0].data : null;
  if (d && d.isForecast === true && d.fakId) return String(d.fakId);
  // 8 s cap: a hung Davenport endpoint must degrade (a thrown error, handled by
  // the caller), never stall the run until the function's wall clock expires.
  const res = await fetch(`${EAST_PROJECT_URL}/rest/v1/call_schedule_data?id=eq.main&select=data`, {
    headers: { apikey: EAST_PROJECT_ANON_KEY, Authorization: `Bearer ${EAST_PROJECT_ANON_KEY}`, Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new HttpError(res.status, `Davenport roster read failed: HTTP ${res.status} (East id for ${want} unresolved)`);
  const rows = await res.json().catch(() => null);
  let blob = Array.isArray(rows) && rows[0] ? rows[0].data : null;
  if (typeof blob === "string") { try { blob = JSON.parse(blob); } catch (_e) { blob = null; } }
  const hit = (blob && Array.isArray(blob.surgeons) ? blob.surgeons : []).find((s: any) => s && typeof s.name === "string" && s.name.toUpperCase() === want);
  return hit && hit.id ? String(hit.id) : null;
}

// Item D: the "<Name> at Davenport this week" section for every East person -
// today .. today + EAST_DIGEST_DAYS - 1 from east_feed + east_vacation_reviews
// (service role: the reviews are authenticated-read). Per person: the lines
// (eastDigestLines - the events' words), or ONE "could not be read" line when
// the id / the caches could not be read (error text in `errors`, never in the
// mail). html is "" when nobody has anything (no section at all).
interface EastSection { html: string; lines: number; people: { name: string; code: string; lines: string[] }[]; errors: string[]; footerHtml: string }

function combinedFeedUrl(code: string): string {
  return `${SUPABASE_URL}/functions/v1/calendar-sync?surgeon=${encodeURIComponent(String(code).toUpperCase())}&east=1`;
}

async function buildEastSection(roster: Roster, today: string): Promise<EastSection> {
  const out: EastSection = { html: "", lines: 0, people: [], errors: [], footerHtml: "" };
  if (!roster.eastPeople.length) return out;
  const from = today, to = addDays(today, EAST_DIGEST_DAYS - 1);
  let weeks: any[] | null = null;
  try {
    const feedRows = await rest("east_feed?select=week_monday,data&order=week_monday.asc");
    weeks = (Array.isArray(feedRows) ? feedRows : []).map((r: any) => ({ weekMonday: String(r.week_monday).slice(0, 10), data: typeof r.data === "string" ? JSON.parse(r.data) : (r.data || {}) }));
  } catch (e) {
    out.errors.push(`east_feed: ${(e as Error).message}`);
  }
  const blocks: string[] = [];
  for (const p of roster.eastPeople) {
    const name = escHtml(p.name || p.id);
    const code = String(p.code).toUpperCase();
    let lines: string[] = [];
    let failed = false;
    if (weeks) {
      try {
        const [eastId, reviews] = await Promise.all([
          resolveEastId(code),
          rest(`east_vacation_reviews?select=person_id,start,end,decision&person_id=eq.${encodeURIComponent(String(p.id))}&decision=eq.away`),
        ]);
        if (!eastId) throw new Error(`East id for ${code} unresolved (no east_forecast row names it and the Davenport roster has no ${code})`);
        lines = eastDigestLines(eastEntries({ lastName: p.name, code, rosterId: String(p.id), eastId, weeks, reviews: Array.isArray(reviews) ? reviews : [], from, to }));
      } catch (e) {
        failed = true;
        out.errors.push(`${code}: ${(e as Error).message}`);
      }
    } else failed = true;
    out.people.push({ name: p.name, code, lines });
    out.lines += lines.length;
    if (!lines.length && !failed) continue;
    let html = `<p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#2c3e50;">${name} at Davenport this week</p>`;
    html += `<ul style="margin:0 0 4px;padding-left:18px;font-size:13px;color:#3a4a58;line-height:1.6;">`;
    if (failed) html += `<li style="color:#a05010;">${name}'s Davenport days could not be read this week - check the East feed in the app</li>`;
    for (const l of lines) html += `<li>${escHtml(l)}</li>`;
    html += `</ul><p style="margin:0 0 8px;font-size:11px;color:#7a8a98;">Next ${EAST_DIGEST_DAYS} days, from the Davenport schedule as cached in the app.</p>`;
    blocks.push(html);
  }
  if (blocks.length) out.html = `<div style="margin-top:14px;padding:12px 14px;background:#f4f6f8;border-radius:8px;border-left:3px solid #7a5a90;">${blocks.join("")}</div>`;
  out.footerHtml = roster.eastPeople.map((p) => {
    const u = combinedFeedUrl(p.code);
    return `<p style="margin:8px 0 0;font-size:12px;color:#7a8a98;line-height:1.5;">${escHtml(p.name || p.id)}'s combined calendar (Silvis + Davenport): <a href="${u}" style="color:#1a6fa8;word-break:break-all;">${u}</a> - paste it into Outlook as an internet calendar; it updates itself.</p>`;
  }).join("");
  return out;
}

// Mail client. Logs counts/keys only - never the address.
async function sendEmail(to: string, subject: string, html: string, logKey: string): Promise<{ ok: boolean; status: number }> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[email] ${logKey}: provider HTTP ${res.status} ${redactAddresses(body).slice(0, 160)}`);
    }
    return { ok: res.ok, status: res.status };
  } catch (e) {
    console.error(`[email] ${logKey}: ${redactAddresses((e as Error).message)}`);
    return { ok: false, status: 0 };
  }
}

// ---------------------------------------------------------------------------
// Auth: cron secret OR verified scheduler/admin session
// ---------------------------------------------------------------------------
type Caller = { via: "cron" } | { via: "user"; userId: string; email: string | null };

async function authorize(req: Request): Promise<Caller | null> {
  const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
  const hdr = req.headers.get("x-cron-secret");
  if (hdr !== null) {
    // A caller that presents the cron header is judged on it alone (constant-time compare, Prompt 16 B5).
    return (await cronSecretMatches(hdr, CRON_SECRET)) ? { via: "cron" } : null;
  }
  const authz = req.headers.get("authorization") || "";
  const token = authz.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return null;
  const user = await userRes.json().catch(() => null);
  if (!user?.id) return null;
  const prof = await rest(`user_profiles?select=role&id=eq.${encodeURIComponent(user.id)}`);
  const role = Array.isArray(prof) && prof[0] ? prof[0].role : null;
  if (role !== "admin" && role !== "scheduler") {
    console.warn(`[office-notifications] rejected: user role=${role || "none"} (scheduler/admin required)`);
    return null;
  }
  return { via: "user", userId: String(user.id), email: typeof user.email === "string" ? user.email : null };
}

// ---------------------------------------------------------------------------
// Baseline / current state
// ---------------------------------------------------------------------------
interface DaySnap { p: string | null; b: string | null; x: string | null }
interface Snapshot {
  v: number;
  days: Record<string, DaySnap>;
  vacations: Record<string, [string, string][]>;
  vacSource: "time_off";
  window: { from: string; to: string };
  captured_at: string;
}

async function buildCurrent(today: string): Promise<Snapshot> {
  const from = today;
  const to = addDays(today, WINDOW_DAYS);
  const [dayRows, toRows] = await Promise.all([
    rest(`schedule_days?select=day,primary_id,backup_id,external_cover&day=gte.${from}&day=lte.${to}&order=day.asc`),
    rest(`time_off?select=person_id,start_date,end_date&end_date=gte.${from}&order=start_date.asc`),
  ]);
  const days: Record<string, DaySnap> = {};
  for (const r of (Array.isArray(dayRows) ? dayRows : [])) {
    const day = String(r.day).slice(0, 10);
    days[day] = { p: r.primary_id || null, b: r.backup_id || null, x: r.external_cover || null };
  }
  const vacations: Record<string, [string, string][]> = {};
  for (const r of (Array.isArray(toRows) ? toRows : [])) {
    if (!r?.person_id) continue;
    (vacations[r.person_id] = vacations[r.person_id] || []).push([String(r.start_date).slice(0, 10), String(r.end_date).slice(0, 10)]);
  }
  return { v: 2, days, vacations, vacSource: "time_off", window: { from, to }, captured_at: new Date().toISOString() };
}

async function readBaseline(): Promise<{ snapshot: any; last_digest_at: string | null } | null> {
  try {
    const rows = await rest(`office_notification_state?select=snapshot,last_digest_at&id=eq.${STATE_ID}`);
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) {
      throw new HttpError(404, "office_notification_state table is missing - apply the SQL in edge-functions/README.md before running the digest");
    }
    throw e;
  }
}

// UPSERT so a missing row can never become a silent 0-row PATCH.
async function writeState(fields: Record<string, unknown>): Promise<boolean> {
  try {
    await rest(`office_notification_state?on_conflict=id`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ id: STATE_ID, updated_at: new Date().toISOString(), ...fields }),
    });
    return true;
  } catch (e) {
    console.error(`[office-notifications] baseline write FAILED: ${(e as Error).message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Diff: current vs baseline, keyed by day + role
// ---------------------------------------------------------------------------
type Role = "primary" | "backup";
interface DayChange { day: string; role: Role; oldId: string | null; newId: string | null; oldExt: string | null; newExt: string | null }
interface VacationChange { personId: string; type: "added" | "removed"; range: [string, string] }

function diffSnapshots(current: Snapshot, baseline: any, roster: Roster) {
  const { from, to } = current.window;
  const dayChanges: DayChange[] = [];
  const vacationChanges: VacationChange[] = [];
  const affected = new Set<string>();
  const unresolvable = new Set<string>();
  let dayChangesDropped = 0;

  // Positive roster filter (Davenport ROSTER RULE): a slot id that does not
  // resolve in the roster is corrupt/stale data - excluded and error-logged,
  // never rendered as a raw database id in somebody's inbox.
  const ok = (id: string | null) => !id || roster.ids.has(id);
  const push = (c: DayChange) => {
    if (ok(c.oldId) && ok(c.newId)) {
      if (c.oldId) affected.add(c.oldId);
      if (c.newId) affected.add(c.newId);
      dayChanges.push(c);
    } else {
      dayChangesDropped++;
      console.error(`[digest] EXCLUDED ${c.role} change on ${c.day} with id outside the roster (old=${c.oldId} new=${c.newId})`);
    }
  };

  const baseDays: Record<string, DaySnap> = (baseline?.days && typeof baseline.days === "object") ? baseline.days : {};
  const allDays = new Set([...Object.keys(current.days), ...Object.keys(baseDays)]);
  const EMPTY: DaySnap = { p: null, b: null, x: null };
  for (const day of Array.from(allDays).sort()) {
    if (day < from || day > to) continue; // rolled out of (or not yet in) the window
    const c = current.days[day] || EMPTY;
    const s = baseDays[day] || EMPTY;
    if ((c.p || null) !== (s.p || null) || (c.x || null) !== (s.x || null)) {
      push({ day, role: "primary", oldId: s.p || null, newId: c.p || null, oldExt: s.x || null, newExt: c.x || null });
    }
    if ((c.b || null) !== (s.b || null)) {
      push({ day, role: "backup", oldId: s.b || null, newId: c.b || null, oldExt: null, newExt: null });
    }
  }

  // Vacations: Record<person_id, [start, end][]>, compared as sets of ranges
  // that end on/after the window start (a vacation that has passed since the
  // baseline is not a "removal").
  const norm = (v: any): string[] => (Array.isArray(v) ? v : [])
    .filter((r: any) => Array.isArray(r) && String(r[1] || "") >= from)
    .map((r: any) => JSON.stringify([String(r[0] || ""), String(r[1] || "")]));
  const baseV = (baseline?.vacations && typeof baseline.vacations === "object") ? baseline.vacations : {};
  for (const pid of new Set([...Object.keys(current.vacations), ...Object.keys(baseV)])) {
    const cur = norm(current.vacations[pid]);
    const old = norm(baseV[pid]);
    const cSet = new Set(cur), oSet = new Set(old);
    const changes: VacationChange[] = [];
    for (const r of cur) if (!oSet.has(r)) changes.push({ personId: pid, type: "added", range: JSON.parse(r) });
    for (const r of old) if (!cSet.has(r)) changes.push({ personId: pid, type: "removed", range: JSON.parse(r) });
    if (changes.length === 0) continue;
    if (!roster.ids.has(pid)) {
      unresolvable.add(pid);
      console.error(`[digest] EXCLUDED unresolvable person_id "${pid}" in vacation section (${changes.length} suppressed)`);
      continue;
    }
    vacationChanges.push(...changes);
    affected.add(pid);
  }

  return {
    dayChanges, vacationChanges,
    affectedIds: Array.from(affected),
    anyChange: affected.size > 0 || dayChanges.length > 0,
    excluded: { unresolvable_ids: Array.from(unresolvable), day_changes_dropped: dayChangesDropped },
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function makeLabeler(roster: Roster) {
  // Backstop: ids are positively filtered before rendering; if one still gets
  // here, render a placeholder and log - NEVER the raw id.
  return (id: string | null, ext: string | null): string => {
    if (id) {
      const n = roster.nameById[id];
      if (n) return escHtml(n);
      console.error(`[render] unresolvable id "${id}" reached the renderer - placeholder used`);
      return "-";
    }
    if (ext) return `${escHtml(ext)} (external cover)`;
    return "OPEN";
  };
}

function renderDayChangesHtml(changes: DayChange[], roster: Roster): string {
  if (changes.length === 0) return "";
  const label = makeLabeler(roster);
  const byDay: Record<string, DayChange[]> = {};
  for (const c of changes) (byDay[c.day] = byDay[c.day] || []).push(c);
  const days = Object.keys(byDay).sort();
  const shown = days.slice(0, MAX_RENDERED_DAYS);
  let html = `<p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#2c3e50;">Call schedule changes</p>`;
  html += `<ul style="margin:0 0 10px;padding-left:18px;font-size:13px;color:#3a4a58;line-height:1.6;">`;
  for (const day of shown) {
    const items = byDay[day].sort((a, b) => (a.role === "primary" ? 0 : 1) - (b.role === "primary" ? 0 : 1));
    html += `<li style="margin-bottom:4px;"><strong>${fmtDay(day)}</strong><ul style="margin:2px 0 0;padding-left:16px;">`;
    for (const c of items) {
      html += `<li>${c.role === "primary" ? "Primary" : "Backup"}: <span style="color:#a05010;">${label(c.oldId, c.oldExt)}</span> &rarr; <span style="color:#1a8040;">${label(c.newId, c.newExt)}</span></li>`;
    }
    html += `</ul></li>`;
  }
  if (days.length > shown.length) {
    html += `<li style="margin-top:6px;color:#7a8a98;">... and ${days.length - shown.length} more day(s) changed - see the full schedule link below.</li>`;
  }
  html += `</ul>`;
  return html;
}

function renderVacationChangesHtml(changes: VacationChange[], roster: Roster): string {
  if (changes.length === 0) return "";
  const label = makeLabeler(roster);
  const byPerson: Record<string, VacationChange[]> = {};
  for (const v of changes) (byPerson[v.personId] = byPerson[v.personId] || []).push(v);
  const people = Object.keys(byPerson).sort((a, b) => (roster.nameById[a] || a).localeCompare(roster.nameById[b] || b));
  let html = `<p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#2c3e50;">Vacation updates</p>`;
  html += `<ul style="margin:0;padding-left:18px;font-size:13px;color:#3a4a58;line-height:1.6;">`;
  for (const pid of people) {
    const items = byPerson[pid].sort((a, b) => a.range[0].localeCompare(b.range[0]));
    html += `<li style="margin-bottom:4px;"><strong>${label(pid, null)}</strong><ul style="margin:2px 0 0;padding-left:16px;">`;
    for (const v of items) {
      const color = v.type === "added" ? "#1a8040" : "#a05010";
      html += `<li><span style="color:${color};">${v.type}</span>: ${fmtDateRange(v.range[0], v.range[1])}</li>`;
    }
    html += `</ul></li>`;
  }
  html += `</ul>`;
  return html;
}

function wrapChanges(inner: string): string {
  if (!inner) return "";
  return `<div style="margin-top:14px;padding:12px 14px;background:#f4f6f8;border-radius:8px;border-left:3px solid #2488c8;">${inner}</div>`;
}

// Publish mode: the client's own change list [{ day, role, from, to }].
// from/to may be roster ids (resolved to names), null/"" (OPEN) or a display
// string such as an external cover name. An id-shaped string that does not
// resolve is never rendered.
function renderClientChangesHtml(list: any[], roster: Roster): { html: string; rendered: number; dropped: number } {
  const label = makeLabeler(roster);
  const idShaped = /^s\d{1,3}$/i;
  const resolve = (v: unknown): string => {
    if (v === null || v === undefined) return "OPEN";
    const s = String(v).trim();
    if (!s || s.toUpperCase() === "OPEN") return "OPEN";
    if (roster.nameById[s]) return label(s, null);
    if (idShaped.test(s)) { console.error(`[publish] unresolvable id "${s}" in client change list - placeholder used`); return "-"; }
    return escHtml(s);
  };
  const byDay: Record<string, { role: string; from: string; to: string }[]> = {};
  let dropped = 0, rendered = 0;
  for (const c of list.slice(0, MAX_CLIENT_CHANGES)) {
    const day = String(c?.day || "");
    const role = String(c?.role || "");
    if (!YMD_RE.test(day) || (role !== "primary" && role !== "backup")) { dropped++; continue; }
    (byDay[day] = byDay[day] || []).push({ role, from: resolve(c.from), to: resolve(c.to) });
    rendered++;
  }
  const days = Object.keys(byDay).sort();
  if (days.length === 0) return { html: "", rendered, dropped };
  const shown = days.slice(0, MAX_RENDERED_DAYS);
  let html = `<p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#2c3e50;">Changes in this publish</p>`;
  html += `<ul style="margin:0;padding-left:18px;font-size:13px;color:#3a4a58;line-height:1.6;">`;
  for (const day of shown) {
    const items = byDay[day].sort((a, b) => (a.role === "primary" ? 0 : 1) - (b.role === "primary" ? 0 : 1));
    html += `<li style="margin-bottom:4px;"><strong>${fmtDay(day)}</strong><ul style="margin:2px 0 0;padding-left:16px;">`;
    for (const c of items) {
      html += `<li>${c.role === "primary" ? "Primary" : "Backup"}: <span style="color:#a05010;">${c.from}</span> &rarr; <span style="color:#1a8040;">${c.to}</span></li>`;
    }
    html += `</ul></li>`;
  }
  if (days.length > shown.length) {
    html += `<li style="margin-top:6px;color:#7a8a98;">... and ${days.length - shown.length} more day(s) - see the full schedule link below.</li>`;
  }
  html += `</ul>`;
  return { html: wrapChanges(html), rendered, dropped };
}

// footerHtml (Item D): extra lines under the "copy this link" paragraph - the digest's combined-feed link(s).
function shell(headline: string, sub: string, name: string, intro: string, changesHtml: string, cta: string, footerHtml: string = ""): string {
  return `
    <div style="font-family:'Outfit',Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;">
      <div style="background:linear-gradient(135deg,#1a6fa8,#2488c8);color:#fff;padding:14px 20px;border-radius:10px 10px 0 0;">
        <h2 style="margin:0;font-size:18px;">${escHtml(headline)}</h2>
        ${sub ? `<p style="margin:6px 0 0;font-size:13px;opacity:0.9;">${escHtml(sub)}</p>` : ""}
      </div>
      <div style="background:#fff;border:1px solid #e0e4ea;border-top:none;padding:20px;border-radius:0 0 10px 10px;">
        <p style="font-size:15px;color:#2c3e50;line-height:1.6;margin:0 0 12px;">
          Hi <strong>${escHtml(name)}</strong>,<br><br>
          ${intro}
        </p>
        ${changesHtml}
        <a href="${PUBLIC_URL}" style="display:inline-block;margin-top:16px;background:linear-gradient(135deg,#1a6fa8,#2488c8);color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
          ${escHtml(cta)}
        </a>
        <p style="margin:10px 0 0;font-size:12px;color:#7a8a98;line-height:1.5;">
          Or copy this link: <a href="${PUBLIC_URL}" style="color:#1a6fa8;word-break:break-all;">${PUBLIC_URL}</a>
        </p>
        ${footerHtml}
        <div style="margin-top:20px;padding-top:14px;border-top:1px solid #e0e4ea;font-size:11px;color:#8a94a0;">
          You are receiving this because you are on the Silvis Surgical Care office distribution list. Reply to this email to be removed.
        </div>
      </div>
    </div>`;
}

// eastHtml / footerHtml (Item D): the "<Name> at Davenport this week" section under the change list, and the
// combined-feed link(s) in the footer - both "" when the roster has no East person.
function renderDigestEmail(name: string, changesHtml: string, eastHtml: string = "", footerHtml: string = ""): { subject: string; html: string } {
  return {
    subject: `${APP_NAME} - Weekly Update`,
    html: shell(APP_NAME, "Weekly update", name, "The Silvis trauma / acute-care call schedule was updated this week. The changes since the last notice:", changesHtml + eastHtml, "View Current Schedule", footerHtml),
  };
}

function renderPublishEmail(name: string, periodLabel: string, changesHtml: string): { subject: string; html: string } {
  const period = periodLabel ? ` - ${periodLabel}` : "";
  const intro = `A new Silvis call schedule period has been published${periodLabel ? ` for <strong>${escHtml(periodLabel)}</strong>` : ""}. Click below to view or print.`;
  return {
    subject: `New ${APP_NAME} Published${period}`,
    html: shell("New Schedule Period Published", periodLabel, name, intro, changesHtml, "View Schedule"),
  };
}

function renderTestEmail(name: string): { subject: string; html: string } {
  return {
    subject: `${APP_NAME} - office notifications test`,
    html: shell("Test Email", "Office notifications", name, "Office notification email from the Silvis Call Schedule is working. No office contact received this message.", "", "Open Schedule"),
  };
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------
interface Contact { id: string; name: string; email: string }

async function loadContacts(): Promise<Contact[]> {
  const rows = await rest("office_contacts?select=id,name,email&active=eq.true&order=created_at.asc");
  const seen = new Set<string>();
  const out: Contact[] = [];
  for (const r of (Array.isArray(rows) ? rows : [])) {
    const email = typeof r.email === "string" ? r.email.trim() : "";
    if (!email) { console.warn(`[office-notifications] contact ${r.id} has no email - skipped`); continue; }
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: String(r.id), name: r.name || "there", email });
  }
  return out;
}

async function broadcast(contacts: Contact[], compose: (c: Contact) => { subject: string; html: string }, logTag: string) {
  const results: { contact_id: string; status: string }[] = [];
  let sent = 0, failed = 0;
  for (const c of contacts) {
    const { subject, html } = compose(c);
    const r = await sendEmail(c.email, subject, html, `${logTag} contact=${c.id}`);
    if (r.ok) { sent++; results.push({ contact_id: c.id, status: "sent" }); }
    else { failed++; results.push({ contact_id: c.id, status: `failed_${r.status}` }); }
  }
  return { sent, failed, results };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json(500, { error: "function misconfigured: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing" });

    const caller = await authorize(req);
    if (!caller) {
      console.warn("[office-notifications] rejected: no valid x-cron-secret or scheduler session");
      return json(401, { error: "unauthorized" });
    }

    const body = await req.json().catch(() => ({}));
    const mode: string = typeof body?.mode === "string" ? body.mode : "digest";
    if (body && "dryRun" in body && typeof body.dryRun !== "boolean") {
      return json(400, { error: `dryRun must be a boolean; nothing was sent or written` });
    }
    const dryRun: boolean = body?.dryRun === true;
    if (dryRun && mode !== "digest") {
      return json(400, { error: `dryRun is only supported for mode=digest (got mode=${mode}); nothing was sent or written` });
    }
    if (caller.via === "cron" && mode !== "digest" && mode !== "rebaseline") {
      return json(403, { error: `mode=${mode} requires a scheduler session, not the cron secret` });
    }
    if (!["publish", "digest", "rebaseline", "test"].includes(mode)) {
      return json(400, { error: `Unknown mode: ${mode}` });
    }
    const needsMail = mode !== "rebaseline" && !dryRun;
    if (needsMail && !RESEND_API_KEY) return json(500, { error: "RESEND_API_KEY not configured" });
    if (needsMail && !FROM_EMAIL) return json(500, { error: "NOTIFICATION_FROM_EMAIL not configured" });

    console.log(`[office-notifications] mode=${mode} dryRun=${dryRun} via=${caller.via}`);

    // --- TEST: one email to the calling scheduler only ---
    if (mode === "test") {
      if (caller.via !== "user" || !caller.email) return json(400, { error: "test mode needs a signed-in scheduler with an account email" });
      const { subject, html } = renderTestEmail("scheduler");
      const r = await sendEmail(caller.email, subject, html, "test caller");
      return json(r.ok ? 200 : 502, { mode, sent: r.ok ? 1 : 0, failed: r.ok ? 0 : 1, provider_status: r.status });
    }

    const today = centralYmd();
    const [roster, current] = await Promise.all([loadRoster(), buildCurrent(today)]);
    const summary = {
      days: Object.keys(current.days).length,
      vacation_person_keys: Object.keys(current.vacations).length,
      window: current.window,
    };
    if (roster.ids.size === 0) {
      return json(409, { error: "roster is empty (call_schedule_data.data.roster) - refusing to compose office mail without names" });
    }

    // --- REBASELINE: write the baseline, send nothing ---
    if (mode === "rebaseline") {
      const ok = await writeState({ snapshot: current, last_digest_at: new Date().toISOString() });
      return json(ok ? 200 : 502, { mode, snapshot_updated: ok, ...summary, sent: 0 });
    }

    // --- DIGEST ---
    if (mode === "digest") {
      const state = await readBaseline();
      // Item D: the Davenport section is composed on EVERY digest path (dryRun
      // included, with or without a diff) so the response can prove it; a
      // failed read is one line in the mail + east.errors, never a thrown digest.
      const east = await buildEastSection(roster, today);
      const eastOut = { people: east.people, lines: east.lines, html: east.html, errors: east.errors };
      console.log(`[digest] east: people=${east.people.length} lines=${east.lines} errors=${east.errors.length}`);
      let baseline = state?.snapshot;
      const usable = baseline && typeof baseline === "object" && baseline.days && typeof baseline.days === "object";
      if (!usable) {
        console.warn("[digest] no usable baseline - first run: rebaseline without mail");
        if (dryRun) return json(200, { mode, dryRun: true, message: "no usable baseline; a live run would rebaseline without mail", would_send: 0, sent: 0, east: eastOut, ...summary });
        const ok = await writeState({ snapshot: current, last_digest_at: new Date().toISOString() });
        return json(ok ? 200 : 502, { mode, first_run: true, rebaselined: true, snapshot_updated: ok, sent: 0, east: eastOut, ...summary });
      }
      const vacValid = baseline.vacSource === "time_off";
      if (!vacValid) {
        console.warn("[digest] baseline vacations not time_off-sourced - suppressing vacation diff this run and healing");
        baseline = { ...baseline, vacations: current.vacations };
      }

      const diff = diffSnapshots(current, baseline, roster);
      const affectedNames = diff.affectedIds.map((id) => roster.nameById[id]).filter(Boolean);
      console.log(`[digest] day_changes=${diff.dayChanges.length} vacation_changes=${diff.vacationChanges.length} affected=${diff.affectedIds.join(",") || "(none)"} dropped=${diff.excluded.day_changes_dropped} unresolvable=${diff.excluded.unresolvable_ids.length}`);

      if (!diff.anyChange) {
        // The send trigger is the diff alone (unchanged by Item D): the sample below shows what the East section
        // WOULD read so it can be proven on a quiet week too.
        if (dryRun) return json(200, { mode, dryRun: true, message: "No changes since last digest", would_send: 0, sent: 0, east: eastOut, sample_east_section: renderDigestEmail("(contact name)", "", east.html, east.footerHtml).html, excluded: diff.excluded, ...summary });
        // Quiet week: still write the current snapshot (rolls the window
        // forward and heals an unstamped baseline).
        const ok = await writeState({ snapshot: current, last_digest_at: new Date().toISOString() });
        return json(200, { mode, message: "No changes since last digest", sent: 0, rebaselined: !vacValid, snapshot_updated: ok, east: eastOut, excluded: diff.excluded, ...summary });
      }

      const contacts = await loadContacts();
      console.log(`[digest] ${contacts.length} active contact(s)`);
      const changesHtml = wrapChanges(renderDayChangesHtml(diff.dayChanges, roster) + renderVacationChangesHtml(diff.vacationChanges, roster));
      const counts = {
        affected_surgeons: affectedNames,
        total_day_changes: diff.dayChanges.length,
        total_vacation_changes: diff.vacationChanges.length,
        excluded: diff.excluded,
        east: eastOut,
      };

      if (dryRun) {
        const sample = renderDigestEmail("(contact name)", changesHtml, east.html, east.footerHtml);
        return json(200, { mode, dryRun: true, would_send: contacts.length, sent: 0, sample, ...counts, ...summary });
      }
      if (contacts.length === 0) {
        // Nothing to send; leave the baseline so the changes are reported once a contact exists.
        return json(200, { mode, message: "No active office contacts - baseline left unchanged", sent: 0, ...counts, ...summary });
      }

      const out = await broadcast(contacts, (c) => renderDigestEmail(c.name, changesHtml, east.html, east.footerHtml), "digest");
      // A failed write here means the next digest re-reports the same changes - say so.
      const ok = await writeState({ snapshot: current, last_digest_at: new Date().toISOString() });
      return json(200, { mode, ...counts, rebaselined: !vacValid, snapshot_updated: ok, sent: out.sent, failed: out.failed, results: out.results, ...summary });
    }

    // --- PUBLISH ---
    if (mode === "publish") {
      const periodLabel = typeof body?.period_label === "string" ? body.period_label.trim().slice(0, 120) : "";
      const clientChanges = Array.isArray(body?.changes) ? body.changes : [];
      const rendered = renderClientChangesHtml(clientChanges, roster);
      const contacts = await loadContacts();
      console.log(`[publish] ${contacts.length} active contact(s), period_label="${periodLabel}", changes=${rendered.rendered} (dropped ${rendered.dropped})`);
      if (contacts.length === 0) {
        return json(200, { mode, message: "No active office contacts", sent: 0, changes_rendered: rendered.rendered, changes_dropped: rendered.dropped });
      }
      const out = await broadcast(contacts, (c) => renderPublishEmail(c.name, periodLabel, rendered.html), "publish");
      const ok = await writeState({ snapshot: current, last_publish_at: new Date().toISOString() });
      return json(200, {
        mode, period_label: periodLabel,
        changes_rendered: rendered.rendered, changes_dropped: rendered.dropped,
        snapshot_updated: ok, sent: out.sent, failed: out.failed, results: out.results, ...summary,
      });
    }

    return json(400, { error: `Unknown mode: ${mode}` });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[office-notifications] error: ${message}`);
    return json(e instanceof HttpError ? 502 : 500, { error: message, upstream_status: e instanceof HttpError ? e.status : undefined });
  }
});
