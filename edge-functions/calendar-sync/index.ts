// Supabase Edge Function: calendar-sync (Silvis Surgical Care call schedule)
// Retargeted from the Davenport (DSG) calendar-sync v14 on 2026-09-22.
//
// Serves a live .ics feed from `schedule_days` (one row per calendar day,
// one 24-hour shift 07:00 -> 07:00 next day, America/Chicago).
//
// URLs:
//   /functions/v1/calendar-sync                 -> full-group feed (every primary + backup)
//   /functions/v1/calendar-sync?surgeon=all     -> same as above
//   /functions/v1/calendar-sync?surgeon=FAK     -> one surgeon's shifts. The param is
//                                                  matched against the roster CODE first
//                                                  (FAK/MAB/BDA/AFP/NF/SRK), then the last
//                                                  name, then the roster id (s1..s6).
//   /functions/v1/calendar-sync?surgeon=FAK&east=1
//       -> Item D (2026-09-24): the same per-surgeon feed PLUS one all-day event
//          per Davenport busy day of that surgeon ("Khan - Davenport night" /
//          "- Davenport service week" / "- Davenport weekend" / "- Davenport
//          holiday" / "- Davenport day call" for a one-day day-call override;
//          an en dash between the name and the words) and one all-day event per
//          East vacation range reviewed as away ("Khan - away (Davenport
//          vacation)"), so one Outlook / Google subscription shows where he is
//          every day - for office staff at either site. Sources are the Silvis
//          caches: east_feed (the Davenport weeks, anon-readable) and
//          east_vacation_reviews (decision 'away', authenticated-read: read here
//          with the service role). Works for any roster surgeon whose East
//          feature reads busy days (the app's eastVacationPerson predicate:
//          surgeonRules.<id>.eastFeed.enabled with eastBlocksPrimary or
//          eastBlocksBackup, a code, not an outside surgeon) - today Khan.
//          CHOICES: east=1 without a single surgeon (all / none) and east=1 for
//          a surgeon outside that predicate (Fierce: derived weeks, no busy-day
//          role) answer EXACTLY like today's feed - the flag is ignored, no
//          error, so a pasted URL never breaks a working subscription. The
//          Davenport id of the surgeon is resolved by CODE, never hard-coded:
//          first from an east_forecast row of this project (data.code +
//          data.fakId, written by scripts/east-forecast.js since 9/23), else
//          from the Davenport roster blob read-only with its PUBLIC anon key
//          (the same GET east-feed.js makes from the browser). If neither
//          resolves, or the east_feed / east_vacation_reviews read fails, the
//          east=1 request answers 502 JSON and NOT a feed: a subscription
//          REPLACES its event set on refresh, so a 200 without the East events
//          would silently delete them from the office calendar, while a 5xx
//          leaves the last good copy in place until the next refresh.
//
// Deploy (see edge-functions/README.md):
//   supabase functions deploy calendar-sync --project-ref bzhsroegtagqhutbnsrp --no-verify-jwt
//
// --no-verify-jwt is CRITICAL: calendar apps (Google, Apple, Outlook) send no
// Authorization header, so the function must be publicly reachable. A DASHBOARD
// deploy re-enables "Verify JWT" (known gotcha) - after ANY deploy verify with an
// unauthenticated GET: expect HTTP 200 and a body starting BEGIN:VCALENDAR.
//
// Data access: reads with the injected service-role key (falls back to the anon
// key; schedule_days and call_schedule_data are anon-readable by design). This
// function performs NO writes and sends NO mail. It never reads contact data.
//
// Differences from Davenport, on purpose:
//   - schedule_weeks (week + slot: dayCall / nights / wknd / holidayCoverage)
//     -> schedule_days (day + role: primary_id / backup_id). No APP feed exists.
//   - Rolling window (PAST_DAYS back, FUTURE_DAYS ahead) instead of the fixed
//     FEED_FLOOR_MONDAY. Davenport's lesson still applies: a subscribed feed
//     REPLACES its event set on refresh, so shrinking PAST_DAYS removes older
//     events from partners' calendars. Change the constants deliberately.
//   - The DST-aware Central -> UTC conversion (centralOffsetHours / icsDate) is
//     kept verbatim; each endpoint of a shift uses its OWN date's offset, so a
//     shift spanning the November fall-back gets the right offset on each end.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const DB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";

const PAST_DAYS = 60;       // days before today (Central) included in the feed
const FUTURE_DAYS = 400;    // days after today included in the feed
// SHIFT_START_HOUR, PRODID and UID_DOMAIN live in the @icsCore block below (plain JS, unit-tested).

// The Davenport (DSG) project, read-only, for ONE read: its roster blob, to
// resolve a roster CODE to a Davenport id when no east_forecast row of this
// project carries it (Item D). The anon key is PUBLIC BY DESIGN (it ships in
// the Davenport PWA and in this repo's east-feed.js); GET only, never a write.
const EAST_PROJECT_URL = "https://xqongyahdnkozqunpwmu.supabase.co";
const EAST_PROJECT_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhxb25neWFoZG5rb3pxdW5wd211Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3Nzg2NDksImV4cCI6MjA5MTM1NDY0OX0.a2p_twcuDAfI_ju-oGzut_NCPNzKjBEbkhVsMGXYyww";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

// ---------------------------------------------------------------------------
// Shared inline helpers (same set in all four Silvis functions; no shared module)
// pad / parseYmd / addDays sit in the @icsCore block below (plain JS).
// ---------------------------------------------------------------------------
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
  });
}

// Every PostgREST read goes through here: a non-2xx NEVER passes as an empty
// result (RLS-blocked reads return 200 + [] silently; a real failure must not).
async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: DB_KEY, Authorization: `Bearer ${DB_KEY}`, "Content-Type": "application/json",
      ...((init.headers as Record<string, string>) || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new HttpError(res.status, `${path.split("?")[0]} read failed: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Calendar date in America/Chicago for an instant (DST-aware via the tz database).
function centralYmd(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

interface RosterEntry { id: string; name: string; code: string; fullName?: string; active?: boolean; type?: "external"; note?: string }
interface Roster { list: RosterEntry[]; byId: Record<string, RosterEntry>; surgeonRules: Record<string, any> }

// Roster = call_schedule_data.data.roster (ids s1..s6, last name, 3-letter code;
// since Prompt 12 M also outside surgeons: ids x1, x2, ..., type "external",
// written in by hand in the app). EVERY entry is served, whatever its roles,
// type or active flag: an outside surgeon has a feed by his code
// (?surgeon=LOC) and appears by last name in the group feed exactly like a
// pool surgeon - no filter here, keep it that way. The note never reaches a
// calendar (nothing below reads it).
// Names and codes only - the blob carries no contact data by policy.
// surgeonRules (data.surgeonRules) rides along for the East predicate of Item D
// (eastFeedPerson) - nothing else in it is read.
async function loadRoster(): Promise<Roster> {
  const rows = await rest("call_schedule_data?select=data&id=eq.main");
  const raw = rows?.[0]?.data;
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  const list: RosterEntry[] = Array.isArray(data?.roster) ? data.roster : [];
  const byId: Record<string, RosterEntry> = {};
  for (const r of list) if (r && r.id) byId[String(r.id)] = r;
  const surgeonRules: Record<string, any> = (data?.surgeonRules && typeof data.surgeonRules === "object") ? data.surgeonRules : {};
  return { list, byId, surgeonRules };
}

// Resolve a roster CODE to the surgeon's DAVENPORT id (FAK is s6 there; never
// hard-code it). 1) an east_forecast row of THIS project carries data.code +
// data.fakId (scripts/east-forecast.js since 9/23; anon-readable, no
// cross-project call); 2) the Davenport roster blob (data.surgeons: [{ id,
// name }], name IS the code), read-only with its public anon key - the read
// east-feed.js makes from the browser. null when neither knows the code; a
// transport / HTTP failure throws (never "no East call").
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

// ---------------------------------------------------------------------------
// ICS core - plain JavaScript between the markers (no type annotations):
// test/edge-functions.test.js extracts the block, evaluates it with new
// Function and builds a real feed from fixture rows (two Silvis days + two
// east_feed days) with no network and no Deno. Everything that shapes an event
// or a line of the .ics lives here; the handler below only fetches.
// ---------------------------------------------------------------------------
// @icsCore-mirror-start
const SHIFT_START_HOUR = 7; // 07:00 Central -> 07:00 Central next day
const PRODID = "-//Silvis Call Schedule//EN";
const UID_DOMAIN = "silvis-call";
const ROLE_LABEL = { primary: "Primary", backup: "Backup" };
const pad = (n) => String(n).padStart(2, "0");

function parseYmd(s) {
  const p = String(s).split("-").map(Number);
  return [p[0], p[1], p[2]];
}

function addDays(s, days) {
  const [y, m, d] = parseYmd(s);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

// America/Chicago UTC offset in hours (5 during CDT, 6 during CST) for a given
// local calendar date - DST-aware, derived from the runtime's tz database, NOT
// a hardcoded constant. Probes 17:00 UTC (late morning in Chicago either
// season, well clear of the 2am DST switch) and reads back the local hour: the
// difference from 17 IS the offset. (Kept verbatim from Davenport v11+.)
function centralOffsetHours(y, m, d) {
  const probe = new Date(Date.UTC(y, m - 1, d, 17, 0, 0));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", hour: "2-digit", hour12: false,
  }).formatToParts(probe);
  const hourPart = parts.find((p) => p.type === "hour");
  let localHour = parseInt(hourPart ? hourPart.value : "0", 10);
  if (localHour === 24) localHour = 0;
  return 17 - localHour; // 17-12=5 (CDT), 17-11=6 (CST)
}

// Format a LOCAL America/Chicago wall-clock time as an absolute UTC ICS stamp
// (YYYYMMDDTHHMMSSZ). Date.UTC normalizes any hour rollover the offset introduces.
function icsDate(y, m, d, h, min) {
  const utc = new Date(Date.UTC(y, m - 1, d, (h || 0) + centralOffsetHours(y, m, d), min || 0, 0));
  return `${utc.getUTCFullYear()}${pad(utc.getUTCMonth() + 1)}${pad(utc.getUTCDate())}T${pad(utc.getUTCHours())}${pad(utc.getUTCMinutes())}00Z`;
}

// Escape ICS text (RFC 5545 3.3.11)
function esc(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Fold long content lines at 75 octets (RFC 5545 3.1) - notes can be long.
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = "";
  let curLen = 0;
  for (const ch of line) {
    const l = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74;
    if (curLen + l > limit) { out.push(cur); cur = " " + ch; curLen = 1 + l; }
    else { cur += ch; curLen += l; }
  }
  if (cur) out.push(cur);
  return out.join("\r\n");
}

// One event per filled role per day. Null slots are skipped (an OPEN day is
// not a calendar entry). A day covered outside the roster (external_cover) has
// primary_id null: no primary event, but the backup event's description names
// the cover so the backup surgeon knows who is in house.
// rows: schedule_days rows { day, primary_id, backup_id, external_cover } (the day's internal note is never read - Faraz 9/25: it never reaches a subscriber's calendar);
// roster: { byId }; onlyId: a roster id or null (the group feed).
function buildEvents(rows, roster, onlyId) {
  const events = [];
  const nameOf = (id) => {
    if (!id) return "OPEN";
    const r = roster.byId[id];
    if (r) return r.name;
    console.warn(`[calendar-sync] id "${id}" not in roster - rendered as-is`);
    return id;
  };
  for (const row of rows) {
    const day = typeof row.day === "string" ? row.day.slice(0, 10) : String(row.day);
    const [y, m, d] = parseYmd(day);
    const next = addDays(day, 1);
    const [ny, nm, nd] = parseYmd(next);
    const primaryLabel = row.primary_id
      ? nameOf(row.primary_id)
      : (row.external_cover ? `${row.external_cover} (external cover)` : "OPEN");
    const backupLabel = nameOf(row.backup_id);

    for (const role of ["primary", "backup"]) {
      const id = role === "primary" ? row.primary_id : row.backup_id;
      if (!id) continue;
      if (onlyId && id !== onlyId) continue;
      const name = nameOf(id);
      const summary = onlyId
        ? `Silvis ${ROLE_LABEL[role]} Call`
        : `Silvis ${ROLE_LABEL[role]} Call - ${name}`;
      const descLines = [
        `Primary: ${primaryLabel}`,
        `Backup: ${backupLabel}`,
        "Shift: 07:00 to 07:00 next day (Central)",
      ];
      events.push({
        uid: `silvis-${day}-${role}@${UID_DOMAIN}`,   // stable per day + role
        allDay: false,
        start: icsDate(y, m, d, SHIFT_START_HOUR, 0),
        end: icsDate(ny, nm, nd, SHIFT_START_HOUR, 0),
        summary,
        desc: descLines.join("\n"),
      });
    }
  }
  return events;
}

// Item D: the East entries (eastEntries, @eastCalendar block) as all-day events.
// DTSTART;VALUE=DATE = the day, DTEND;VALUE=DATE = the next day (exclusive);
// UIDs east-<CODE>-<date>-<reason>@silvis-call and
// east-<CODE>-away-<start>-<end>@silvis-call - stable per day + first reason /
// per range, so a refresh updates in place and never duplicates.
function eastIcsEvents(entries, code) {
  const out = [];
  const ymd = (s) => String(s).replace(/-/g, "");
  ((entries && entries.busy) || []).forEach((e) => out.push({
    uid: `east-${code}-${e.day}-${e.reason}@${UID_DOMAIN}`,
    allDay: true,
    start: ymd(e.day),
    end: ymd(e.end),
    summary: e.title,
    desc: "Davenport (East) call: " + e.detail + "\nSource: the Davenport schedule as cached in the Silvis East feed",
  }));
  ((entries && entries.away) || []).forEach((a) => out.push({
    uid: `east-${code}-away-${a.start}-${a.end}@${UID_DOMAIN}`,
    allDay: true,
    start: ymd(a.start),
    end: ymd(a.endExclusive),
    summary: a.title,
    desc: "Davenport (East) vacation, reviewed as away in the Silvis app",
  }));
  return out;
}

// events: [{ uid, allDay, start, end, summary, desc }]; an all-day event
// carries YYYYMMDD dates and is written as DTSTART;VALUE=DATE / DTEND;VALUE=DATE.
function generateICS(events, title) {
  // DTSTAMP is "when generated" and is ALREADY UTC - format directly, do NOT
  // route through icsDate (which converts a Central wall-clock to UTC).
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}00Z`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(title)}`,
    "X-WR-TIMEZONE:America/Chicago",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const ev of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${ev.uid}`,
      `DTSTAMP:${stamp}`,
      ev.allDay ? `DTSTART;VALUE=DATE:${ev.start}` : `DTSTART:${ev.start}`,
      ev.allDay ? `DTEND;VALUE=DATE:${ev.end}` : `DTEND:${ev.end}`,
      fold(`SUMMARY:${esc(ev.summary)}`),
      fold(`DESCRIPTION:${esc(ev.desc)}`),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
// @icsCore-mirror-end

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

interface DayRow {
  day: string;
  primary_id: string | null;
  backup_id: string | null;
  external_cover: string | null;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "GET") {
    return json(405, { error: "method not allowed - this feed is GET only" }, { Allow: "GET, OPTIONS" });
  }
  if (!SUPABASE_URL || !DB_KEY) {
    console.error("[calendar-sync] SUPABASE_URL / key not injected");
    return json(500, { error: "function misconfigured: SUPABASE_URL or database key missing" });
  }

  try {
    const url = new URL(req.url);
    const surgeonParam = (url.searchParams.get("surgeon") || "").trim();
    const eastParam = (url.searchParams.get("east") || "").trim().toLowerCase();
    const eastWanted = eastParam === "1" || eastParam === "true" || eastParam === "yes";

    const today = centralYmd();
    const from = addDays(today, -PAST_DAYS);
    const to = addDays(today, FUTURE_DAYS);

    const roster = await loadRoster();
    const rows: DayRow[] = (await rest(
      `schedule_days?select=day,primary_id,backup_id,external_cover&day=gte.${from}&day=lte.${to}&order=day.asc`,
    )) || [];

    let onlyId: string | null = null;
    let who: RosterEntry | null = null;
    let title = "Silvis Call - All";
    if (surgeonParam && surgeonParam.toLowerCase() !== "all") {
      const q = surgeonParam.toLowerCase();
      // Match order: CODE (what the app's subscribe URL sends), then last name,
      // then the raw roster id as a last resort. The schedule stores ids.
      who = roster.list.find((r) => String(r.code || "").toLowerCase() === q)
        || roster.list.find((r) => String(r.name || "").toLowerCase() === q)
        || roster.list.find((r) => String(r.id || "").toLowerCase() === q)
        || null;
      if (!who) {
        console.warn(`[calendar-sync] surgeon param did not resolve (roster size ${roster.list.length})`);
        return json(404, { error: `surgeon "${surgeonParam}" not found - use a roster code such as FAK` });
      }
      onlyId = String(who.id);
      title = `Silvis Call - ${who.name}`;
    }

    let events = buildEvents(rows, roster, onlyId);
    let eastCount = 0;
    // Item D: east=1 adds the Davenport side for ONE surgeon whose East feature
    // reads busy days (eastFeedPerson). Anything else leaves the feed exactly as
    // above (the header says why). A failure here is a 502 through the catch
    // below, never a feed without the East events; a missing service role is a
    // direct 500 like the top-of-handler configuration check.
    if (eastWanted && who && onlyId && eastFeedPerson(who, (roster.surgeonRules[onlyId] || {}).eastFeed)) {
      if (!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
        return json(500, { error: "east=1 needs the service role (east_vacation_reviews is authenticated-read) - key not injected" });
      }
      const code = String(who.code).toUpperCase();
      const [eastId, feedRows, reviews] = await Promise.all([
        resolveEastId(code),
        rest("east_feed?select=week_monday,data&order=week_monday.asc"),
        rest(`east_vacation_reviews?select=person_id,start,end,decision&person_id=eq.${encodeURIComponent(onlyId)}&decision=eq.away`),
      ]);
      if (!eastId) throw new HttpError(502, `East id for ${code} unresolved (no east_forecast row names it and the Davenport roster has no ${code}) - the combined feed is withheld rather than served without the Davenport events`);
      const weeks = (Array.isArray(feedRows) ? feedRows : []).map((r: any) => ({ weekMonday: String(r.week_monday).slice(0, 10), data: typeof r.data === "string" ? JSON.parse(r.data) : (r.data || {}) }));
      const entries = eastEntries({ lastName: who.name, code, rosterId: onlyId, eastId, weeks, reviews: Array.isArray(reviews) ? reviews : [], from, to });
      const eastEvents = eastIcsEvents(entries, code);
      eastCount = eastEvents.length;
      events = events.concat(eastEvents);
      title = `Silvis + Davenport - ${who.name}`;
    }
    console.log(`[calendar-sync] feed=${onlyId || "all"} east=${eastWanted ? (eastCount ? "on" : "off") : "no"} days=${rows.length} events=${events.length} (east ${eastCount}) window=${from}..${to}`);

    // A zero-event calendar is still valid ICS, so a subscription stays healthy
    // and simply shows nothing until data appears.
    return new Response(generateICS(events, title), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/calendar; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (e) {
    const status = e instanceof HttpError ? 502 : 500;
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[calendar-sync] error: ${message}`);
    return json(status, { error: message, upstream_status: e instanceof HttpError ? e.status : undefined });
  }
});
