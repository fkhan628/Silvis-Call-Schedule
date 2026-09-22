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
const SHIFT_START_HOUR = 7; // 07:00 Central -> 07:00 Central next day
const PRODID = "-//Silvis Call Schedule//EN";
const UID_DOMAIN = "silvis-call";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

// ---------------------------------------------------------------------------
// Shared inline helpers (same set in all four Silvis functions; no shared module)
// ---------------------------------------------------------------------------
const pad = (n: number) => String(n).padStart(2, "0");

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

function parseYmd(s: string): [number, number, number] {
  const [y, m, d] = s.split("-").map(Number);
  return [y, m, d];
}

function addDays(s: string, days: number): string {
  const [y, m, d] = parseYmd(s);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

interface RosterEntry { id: string; name: string; code: string; fullName?: string; active?: boolean; type?: "external"; note?: string }
interface Roster { list: RosterEntry[]; byId: Record<string, RosterEntry> }

// Roster = call_schedule_data.data.roster (ids s1..s6, last name, 3-letter code;
// since Prompt 12 M also outside surgeons: ids x1, x2, ..., type "external",
// written in by hand in the app). EVERY entry is served, whatever its roles,
// type or active flag: an outside surgeon has a feed by his code
// (?surgeon=LOC) and appears by last name in the group feed exactly like a
// pool surgeon - no filter here, keep it that way. The note never reaches a
// calendar (nothing below reads it).
// Names and codes only - the blob carries no contact data by policy.
async function loadRoster(): Promise<Roster> {
  const rows = await rest("call_schedule_data?select=data&id=eq.main");
  const raw = rows?.[0]?.data;
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  const list: RosterEntry[] = Array.isArray(data?.roster) ? data.roster : [];
  const byId: Record<string, RosterEntry> = {};
  for (const r of list) if (r && r.id) byId[String(r.id)] = r;
  return { list, byId };
}

// America/Chicago UTC offset in hours (5 during CDT, 6 during CST) for a given
// local calendar date - DST-aware, derived from the runtime's tz database, NOT
// a hardcoded constant. Probes 17:00 UTC (late morning in Chicago either
// season, well clear of the 2am DST switch) and reads back the local hour: the
// difference from 17 IS the offset. (Kept verbatim from Davenport v11+.)
function centralOffsetHours(y: number, m: number, d: number): number {
  const probe = new Date(Date.UTC(y, m - 1, d, 17, 0, 0));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", hour: "2-digit", hour12: false,
  }).formatToParts(probe);
  let localHour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  if (localHour === 24) localHour = 0;
  return 17 - localHour; // 17-12=5 (CDT), 17-11=6 (CST)
}

// Format a LOCAL America/Chicago wall-clock time as an absolute UTC ICS stamp
// (YYYYMMDDTHHMMSSZ). Date.UTC normalizes any hour rollover the offset introduces.
function icsDate(y: number, m: number, d: number, h: number = 0, min: number = 0): string {
  const utc = new Date(Date.UTC(y, m - 1, d, h + centralOffsetHours(y, m, d), min, 0));
  return `${utc.getUTCFullYear()}${pad(utc.getUTCMonth() + 1)}${pad(utc.getUTCDate())}T${pad(utc.getUTCHours())}${pad(utc.getUTCMinutes())}00Z`;
}

// Escape ICS text (RFC 5545 3.3.11)
function esc(text: string): string {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Fold long content lines at 75 octets (RFC 5545 3.1) - notes can be long.
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
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

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
interface DayRow {
  day: string;
  primary_id: string | null;
  backup_id: string | null;
  external_cover: string | null;
  note: string | null;
}

interface IcsEvent { uid: string; start: string; end: string; summary: string; desc: string }

const ROLE_LABEL: Record<string, string> = { primary: "Primary", backup: "Backup" };

// One event per filled role per day. Null slots are skipped (an OPEN day is
// not a calendar entry). A day covered outside the roster (external_cover) has
// primary_id null: no primary event, but the backup event's description names
// the cover so the backup surgeon knows who is in house.
function buildEvents(rows: DayRow[], roster: Roster, onlyId: string | null): IcsEvent[] {
  const events: IcsEvent[] = [];
  const nameOf = (id: string | null): string => {
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

    for (const role of ["primary", "backup"] as const) {
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
      if (row.note) descLines.push(`Note: ${row.note}`);
      events.push({
        uid: `silvis-${day}-${role}@${UID_DOMAIN}`,   // stable per day + role
        start: icsDate(y, m, d, SHIFT_START_HOUR, 0),
        end: icsDate(ny, nm, nd, SHIFT_START_HOUR, 0),
        summary,
        desc: descLines.join("\n"),
      });
    }
  }
  return events;
}

function generateICS(events: IcsEvent[], title: string): string {
  // DTSTAMP is "when generated" and is ALREADY UTC - format directly, do NOT
  // route through icsDate (which converts a Central wall-clock to UTC).
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}00Z`;

  const lines: string[] = [
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
      `DTSTART:${ev.start}`,
      `DTEND:${ev.end}`,
      fold(`SUMMARY:${esc(ev.summary)}`),
      fold(`DESCRIPTION:${esc(ev.desc)}`),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
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

    const today = centralYmd();
    const from = addDays(today, -PAST_DAYS);
    const to = addDays(today, FUTURE_DAYS);

    const roster = await loadRoster();
    const rows: DayRow[] = (await rest(
      `schedule_days?select=day,primary_id,backup_id,external_cover,note&day=gte.${from}&day=lte.${to}&order=day.asc`,
    )) || [];

    let onlyId: string | null = null;
    let title = "Silvis Call - All";
    if (surgeonParam && surgeonParam.toLowerCase() !== "all") {
      const q = surgeonParam.toLowerCase();
      // Match order: CODE (what the app's subscribe URL sends), then last name,
      // then the raw roster id as a last resort. The schedule stores ids.
      const who = roster.list.find((r) => String(r.code || "").toLowerCase() === q)
        || roster.list.find((r) => String(r.name || "").toLowerCase() === q)
        || roster.list.find((r) => String(r.id || "").toLowerCase() === q);
      if (!who) {
        console.warn(`[calendar-sync] surgeon param did not resolve (roster size ${roster.list.length})`);
        return json(404, { error: `surgeon "${surgeonParam}" not found - use a roster code such as FAK` });
      }
      onlyId = String(who.id);
      title = `Silvis Call - ${who.name}`;
    }

    const events = buildEvents(rows, roster, onlyId);
    console.log(`[calendar-sync] feed=${onlyId || "all"} days=${rows.length} events=${events.length} window=${from}..${to}`);

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
