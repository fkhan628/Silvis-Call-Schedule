// ===================================================================
// Silvis Call Schedule - Email Notification Edge Function
// ===================================================================
// Retargeted from the Davenport (DSG) send-notification v17/v18 on 2026-09-22.
//
// What it keeps from Davenport:
//   - Server-side recipient resolution with the service-role key (a
//     non-scheduler's JWT can only read its OWN prefs row, so client-side
//     resolution silently found nobody to email).
//   - A VERIFIED user session is required: the bearer token is checked against
//     GoTrue (/auth/v1/user). The gateway's verify_jwt cannot do this (the
//     public anon key is itself a valid project JWT) and stays OFF; the
//     in-function check is the security boundary.
//   - Honest accounting: `sent` counts real provider 2xx responses. The
//     response never echoes an email address (per-recipient statuses are
//     keyed by person_id). Full detail goes to the function logs only, and
//     the logs carry counts + person ids, never addresses.
//   - The legacy { recipients } payload (caller-supplied addresses) is
//     REJECTED with 400 - it let any caller email arbitrary addresses through
//     the group's mail account.
//
// What changed for Silvis:
//   - notification_preferences is keyed by person_id and has NO email column
//     (schedule_updates_email, trade_updates_email, shift_reminders_email,
//     reminder_hour_central). Addresses come from user_profiles.email joined
//     on person_id, read with the service role. A person with no linked
//     account (no user_profiles row with that person_id) is skipped_no_email.
//   - Categories: schedule_published, manual_edit, trade_proposed,
//     trade_accepted, trade_declined, trade_applied, vacation_logged,
//     shift_reminder, open_shifts, shift_claimed (since Prompt 13 part 5,
//     2026-09-22: the open-shifts notice broadcast on Accept & Publish / on
//     demand from the board, and the "took the shift" note to the scheduler
//     + claimer), offers_reminder, offers_closed (since Prompt 14 part 4,
//     2026-09-23: the Periods "Remind" button's note to a surgeon with
//     nothing entered for a period, and the close summary to the scheduler;
//     both on schedule_updates_email, recipients by person_id like every
//     other category), test. Davenport names schedule_changed and
//     trade_submitted are accepted as aliases (logged) so deploy order vs the
//     client build does not matter.
//   - The CLIENT composes the words. Payload: { type, data: { subject?,
//     message, detail? }, targetIds? }. The function renders data.message
//     (required except for type "test") inside a per-category frame and never
//     invents schedule facts. Strings are HTML-escaped; newlines become <br>.
//   - No vacation approve/deny templates (vacations need no approval at
//     Silvis), no APP names, no no-call wording, no $ / weighted logic.
//   - WHO MAY SEND (2026-09-23, audit RLS-1; v4). A verified session alone is
//     not enough: before this change any signed-in account - a viewer, any
//     surgeon - could POST any category with any text and no targetIds and
//     the function broadcast it to every linked surgeon from the group
//     sender. Now the caller's user_profiles row (read with the service role
//     by the GoTrue-verified id) decides, in the plain-JS block between
//     '// @sendGate-start' and '// @sendGate-end' that test/edge-functions.test.js
//     extracts and runs: admin / scheduler send every category, targeted or
//     broadcast; a linked surgeon sends only what the app sends on his own
//     behalf and always targeted (trade_* to the two parties with himself
//     among them; shift_claimed to himself + scheduler-linked ids;
//     vacation_logged to scheduler-linked ids; test to himself); a viewer,
//     a missing row or an unlinked surgeon sends nothing. Refusals are 403
//     and the log carries the role and the reason only. The empty-targetIds
//     short circuit (200, sent 0) stays ahead of the gate for every caller.
//     Accepted deviation (fix review 9/23): an admin / scheduler account
//     passes on its role alone - a person_id link is not required, as in
//     office-notifications; the role is admin-assigned in Setup and signup
//     lands as viewer, so the link adds no protection, only a failure mode.
//   - SECURITY MINORS (2026-09-23, review section 3; Prompt 16 B5, v6). Three
//     tightenings over the v5 gate, none of which changes what the app sends:
//     (a) the mail-configuration checks (RESEND_API_KEY, NOTIFICATION_FROM_EMAIL)
//     run only AFTER the role gate, so an unauthenticated or unprivileged
//     caller sees 401 / 403 and never a 500 naming a missing secret; (b)
//     targetIds is capped at roster size + 1 (400 above it; the roster is read
//     once and its names also serve the greeting); (c) every trade_* send names
//     its shift_trade_requests row in data.trade_id (a uuid; 400 without it)
//     and the row's two parties (from_surgeon_id / to_surgeon_id, read with the
//     service role) must be exactly the targetIds as a set (403 otherwise) -
//     for every caller, the scheduler included, so a trade frame can never be
//     addressed to a third person or broadcast. The pure pieces (isTradeType,
//     tradeIdOf, targetCap, tradePartyCheck) sit in the @sendGate block and are
//     unit-tested; the log-redaction regex is the @logRedact block.
//   - GIVE A DAY (Prompt 19 S3, 2026-09-24; v7 - prepared, NOT deployed yet;
//     see README section 3). When a colleague accepts a give (a one-way
//     shift_trade_requests row, kind 'give'), the app mails trade_applied to
//     both parties AND the scheduler(s): targetIds = [from, to, ...scheduler-
//     linked ids]. The gate widens for trade_applied ONLY: scheduler-linked ids
//     may ride beside the two parties (tradeExtraIds -> tradePartyCheck's third
//     argument); the two parties stay required and nobody else is allowed. A
//     surgeon sender still has to be one of the row's parties (tradePartyCheck's
//     senderId) and may name at most the two parties besides the schedulers.
//     trade_proposed / trade_accepted / trade_declined stay "exactly the two
//     parties". The scheduler ids are consulted only when a trade_applied names
//     an id beyond the two parties (tradeNamesOthers); an admin / scheduler
//     caller reads them there (a surgeon's list is already read before
//     sendGate), so a v6-shaped send never depends on that extra read.
//     Everything v6 accepts, v7 accepts - deploy v7 BEFORE the client that
//     sends the give.
//
// Payload contract:
//   POST { type: string, data: { subject?: string, message: string, detail?: string, trade_id?: uuid }, targetIds?: string[] }
//     targetIds ABSENT  -> broadcast to every linked person (opted in for the category)
//     targetIds []      -> send to nobody (200, sent 0) - defense in depth
//     targetIds [ids]   -> only those person ids (s1..s6); at most roster size + 1 of them
//     trade_*           -> data.trade_id required; targetIds must be exactly that row's two parties
//     trade_applied     -> the same two parties, plus (optionally) scheduler-linked ids (Prompt 19 S3, v7)
//   -> 200 { sent, failed, skipped_no_email, skipped_pref_off, results: [{ person_id, status }] }
//
// Secrets (by NAME): RESEND_API_KEY, NOTIFICATION_FROM_EMAIL (required - there is
// NO hardcoded fallback sender); SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// injected by Supabase.
//
// Deploy: supabase functions deploy send-notification --project-ref bzhsroegtagqhutbnsrp --no-verify-jwt

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = Deno.env.get("NOTIFICATION_FROM_EMAIL") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const APP_URL = "https://fkhan628.github.io/Silvis-Call-Schedule/";
const APP_NAME = "Silvis Call Schedule";
const MAX_MESSAGE_CHARS = 4000;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---------------------------------------------------------------------------
// Shared inline helpers (same set in all four Silvis functions; no shared module)
// ---------------------------------------------------------------------------
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

interface RosterEntry { id: string; name: string; code: string }

interface RosterInfo { names: Record<string, string>; count: number }

// The roster from the blob, read ONCE per request: names for the greeting and
// the entry count for the targetIds cap (Prompt 16 B5). Names are cosmetic -
// ids are an acceptable fallback, but say so; a failed read yields count 0,
// which targetCap turns into the fallback size.
async function loadRoster(): Promise<RosterInfo> {
  const names: Record<string, string> = {};
  let count = 0;
  try {
    const rows = await rest("call_schedule_data?select=data&id=eq.main");
    const raw = rows?.[0]?.data;
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    const list: RosterEntry[] = Array.isArray(data?.roster) ? data.roster : [];
    for (const r of list) if (r?.id) { names[String(r.id)] = r.name || String(r.id); count++; }
  } catch (e) {
    console.warn(`[send-notification] roster read failed, greeting by id and capping at the fallback size: ${(e as Error).message}`);
  }
  return { names, count };
}

function escHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function textToHtml(s: string): string {
  return escHtml(s).replace(/\r?\n/g, "<br>");
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
// Categories -> preference flag + visual frame
// ---------------------------------------------------------------------------
interface Category { pref: string | null; title: string; color: string; cta: string }

const CATEGORIES: Record<string, Category> = {
  schedule_published: { pref: "schedule_updates_email", title: "Schedule Published", color: "#1a6fa8", cta: "View Your Schedule" },
  manual_edit:        { pref: "schedule_updates_email", title: "Schedule Changed",   color: "#6030a0", cta: "View Updated Schedule" },
  trade_proposed:     { pref: "trade_updates_email",    title: "Shift Trade Proposed", color: "#6030a0", cta: "Review and Respond" },
  trade_accepted:     { pref: "trade_updates_email",    title: "Shift Trade Accepted", color: "#1a8040", cta: "View Schedule" },
  trade_declined:     { pref: "trade_updates_email",    title: "Shift Trade Declined", color: "#c04040", cta: "Open App" },
  trade_applied:      { pref: "trade_updates_email",    title: "Shift Trade Applied",  color: "#1a8040", cta: "View Updated Schedule" },
  vacation_logged:    { pref: "schedule_updates_email", title: "Vacation Logged",    color: "#c09030", cta: "View Calendar" },
  shift_reminder:     { pref: "shift_reminders_email",  title: "Call Reminder",      color: "#1a6fa8", cta: "View Full Schedule" },
  // Prompt 13 part 5: open shifts. The client composes the list (helpers.js
  // openShiftsEmail: subject, message grouped by week, detail = the
  // '#openshifts' deep link); this table only names the frame and the flag.
  open_shifts:        { pref: "schedule_updates_email", title: "Open Shifts",        color: "#C2410C", cta: "Open shifts" },
  shift_claimed:      { pref: "schedule_updates_email", title: "Shift Taken",        color: "#1a8040", cta: "View Schedule" },
  // Prompt 14 part 4: offer periods. The client composes the words ("your
  // dates for <label> freeze on <date> - paint them in the app or choose 'go
  // by my rules'"; the close roll call); this table only names the frame and
  // the flag. The daily cron (daily-reminder mode "offers") uses the same
  // titles and colours so both routes look alike in the inbox.
  offers_reminder:    { pref: "schedule_updates_email", title: "Offers Reminder",    color: "#13294B", cta: "Paint my offers" },
  offers_closed:      { pref: "schedule_updates_email", title: "Offers Closed",      color: "#C2410C", cta: "Open Periods" },
  test:               { pref: null,                     title: "Test Email",         color: "#1a6fa8", cta: "Open App" },
};

// Davenport type names still emitted by older client builds.
const TYPE_ALIASES: Record<string, string> = {
  schedule_changed: "manual_edit",
  trade_submitted: "trade_proposed",
};

// ---------------------------------------------------------------------------
// Who may send what (2026-09-23, audit RLS-1). Plain JavaScript on purpose:
// test/edge-functions.test.js extracts the block between the markers,
// evaluates it with new Function and runs it against a table of callers, so
// keep it free of type annotations. Both functions return null when the send
// may proceed, else the refusal text (answered as 403; logged with the role).
//   caller       { role, personId } from user_profiles (role null = no row)
//   type         the resolved category (aliases already mapped)
//   targetIds    null = broadcast, else the caller's list
//   schedulerIds person ids linked to an admin / scheduler account
// ---------------------------------------------------------------------------
// @sendGate-start
function senderRole(caller) {
  const role = caller && caller.role;
  if (role === "admin" || role === "scheduler") return null;   // the scheduler sends every category
  if (role !== "surgeon") return "role " + (role || "none") + " may not send notifications";   // viewer, coordinator (Prompt 16 A7: the office relays vacations / offers but never mails through the group sender), no row, unknown
  if (!(caller.personId !== null && caller.personId !== undefined && String(caller.personId) !== "")) {
    return "this account is not linked to a roster entry - nothing to send on its behalf";
  }
  return null;
}
function sendGate(caller, type, targetIds, schedulerIds) {
  const early = senderRole(caller);
  if (early) return early;
  const role = caller.role;
  if (role === "admin" || role === "scheduler") return null;
  // a surgeon: only the categories the app sends on his own behalf, always targeted
  const me = String(caller.personId);
  if (!Array.isArray(targetIds)) return "a surgeon never broadcasts - " + type + " needs targetIds";
  const ids = targetIds.map(function (x) { return String(x); });
  const scheds = (Array.isArray(schedulerIds) ? schedulerIds : []).map(function (x) { return String(x); });
  const isSched = function (id) { return scheds.indexOf(id) >= 0; };
  switch (type) {
    case "trade_proposed":
    case "trade_accepted":
    case "trade_declined":
      if (ids.length > 2) return type + " goes to the two parties only";
      if (ids.indexOf(me) < 0) return type + " must include the caller as a party";
      return null;
    case "trade_applied":
      // Prompt 19 S3 (v7): an accepted give's applied mail also goes to the scheduler(s) - scheduler-linked ids may ride
      // beside the parties; tradePartyCheck (the trade frame) then requires the row's two parties themselves
      if (ids.indexOf(me) < 0) return type + " must include the caller as a party";
      if (ids.filter(function (id, i, a) { return a.indexOf(id) === i && !isSched(id); }).length > 2) return type + " goes to the two parties and the scheduler(s) only";
      return null;
    case "shift_claimed":
      if (ids.indexOf(me) < 0) return "shift_claimed must include the claimer (the caller)";
      if (!ids.every(function (id) { return id === me || isSched(id); })) return "shift_claimed goes to the claimer and the scheduler(s) only";
      return null;
    case "vacation_logged":
      // the client filters the vacationer out of the targets, so the caller is not required here
      if (!ids.every(isSched)) return "vacation_logged goes to the scheduler(s) only";
      return null;
    case "test":
      if (ids.length !== 1 || ids[0] !== me) return "test goes to the caller only";
      return null;
    case "offers_reminder":
    case "offers_closed":
      // Prompt 14 part 4: the Periods "Remind" button (a scheduler session) and the daily-reminder cron path
      // (service role, never through this gate) are the only senders - a surgeon does not remind or close a period
      return type + " is sent by the scheduler (Periods -> Remind) or the daily offers cron only";
    default:
      return type + " is sent by the scheduler only";
  }
}
// Prompt 16 B5 (review 2026-09-23 section 3): the trade frame and the recipient cap.
const TRADE_TYPES = ["trade_proposed", "trade_accepted", "trade_declined", "trade_applied"];
function isTradeType(type) { return TRADE_TYPES.indexOf(type) >= 0; }
// data.trade_id of a trade_* send: the uuid (trimmed), or null when missing / not a uuid (-> 400)
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function tradeIdOf(data) {
  const id = data && typeof data.trade_id === "string" ? data.trade_id.trim() : "";
  if (!UUID_SHAPE.test(id)) return null;
  return id;
}
// The cap on targetIds.length: every roster entry plus one. When the roster
// could not be read (count 0) the group's six stand in; the failure is logged.
const ROSTER_SIZE_FALLBACK = 6;
function targetCap(rosterCount) {
  const n = Number(rosterCount);
  return (n > 0 ? Math.floor(n) : ROSTER_SIZE_FALLBACK) + 1;
}
// A trade_* send goes to exactly the two parties of the shift_trade_requests
// row that data.trade_id names (from_surgeon_id / to_surgeon_id), compared as
// sets of strings. null = proceed, else the refusal (403). The handler reads
// the row with the service role; an unknown id arrives here as null.
// Prompt 19 S3 (v7): extraIds (tradeExtraIds below - trade_applied's
// scheduler-linked ids, [] for every other category) may ride BESIDE the two
// parties: the parties stay required, nobody else is allowed. Without extraIds
// the check is exactly the v6 one. senderId (S3 review): a surgeon caller's
// person id - he must be one of the row's two parties (v6's exact match implied
// it; with extra ids it has to be said); null / undefined for an admin /
// scheduler caller.
function tradePartyCheck(trade, targetIds, extraIds, senderId) {
  if (!Array.isArray(targetIds) || targetIds.length === 0) return "trade mail is never a broadcast - targetIds must name the two parties";
  if (!trade || trade.from_surgeon_id == null || trade.to_surgeon_id == null) return "data.trade_id names no trade";
  const distinctSorted = function (ids) { return ids.map(String).filter(function (id, i, a) { return a.indexOf(id) === i; }).sort(); };
  const want = distinctSorted([trade.from_surgeon_id, trade.to_surgeon_id]);
  if (senderId != null && want.indexOf(String(senderId)) < 0) return "the sender must be a party to the trade";
  const got = distinctSorted(targetIds);
  const extra = distinctSorted(Array.isArray(extraIds) ? extraIds : []);
  if (!extra.length) {
    if (want.length !== got.length || want.some(function (id, i) { return id !== got[i]; })) return "targetIds must be exactly the trade's two parties";
    return null;
  }
  if (!want.every(function (id) { return got.indexOf(id) >= 0; })) return "targetIds must include both of the trade's parties";
  if (got.some(function (id) { return want.indexOf(id) < 0 && extra.indexOf(id) < 0; })) return "targetIds may add only scheduler-linked ids to the trade's two parties";
  return null;
}
// The ids a trade_* send may add to the two parties: the scheduler-linked ids on
// trade_applied (Prompt 19 S3: an accepted give is reported to the scheduler),
// nobody on every other category.
function tradeExtraIds(type, schedulerIds) {
  if (type !== "trade_applied" || !Array.isArray(schedulerIds)) return [];
  return schedulerIds.map(function (x) { return String(x); });
}
// true when targetIds names an id outside the row's two parties - the only case
// in which the scheduler-linked ids are consulted (S3 review: a v6-shaped send
// never waits on, or fails with, that read).
function tradeNamesOthers(trade, targetIds) {
  if (!trade || !Array.isArray(targetIds)) return false;
  const parties = [String(trade.from_surgeon_id), String(trade.to_surgeon_id)];
  return targetIds.some(function (id) { return parties.indexOf(String(id)) < 0; });
}
// @sendGate-end

// Person ids linked to an admin / scheduler account (the same lookup the
// client's schedulerIdsLoud makes), read with the service role. Only needed
// for a surgeon caller; a failure throws (never a silent empty list that
// would refuse a legitimate send without saying why).
async function loadSchedulerIds(): Promise<string[]> {
  const rows = await rest("user_profiles?select=person_id,role&role=in.(admin,scheduler)&person_id=not.is.null");
  const out = new Set<string>();
  for (const r of (Array.isArray(rows) ? rows : [])) if (r?.person_id) out.add(String(r.person_id));
  return Array.from(out);
}

// A missing prefs row or a missing flag defaults to ON; only an explicit false opts out.
function emailEnabled(cat: Category, prefs: any): boolean {
  if (!cat.pref) return true;
  return !(prefs && prefs[cat.pref] === false);
}

function buildEmail(type: string, cat: Category, data: any, recipientName: string): { subject: string; html: string } {
  const subject = (typeof data?.subject === "string" && data.subject.trim())
    ? data.subject.trim().slice(0, 200)
    : `${cat.title} - ${APP_NAME}`;
  const message: string = type === "test"
    ? `Email notifications for the ${APP_NAME} are working.`
    : String(data.message).slice(0, MAX_MESSAGE_CHARS);
  const detail = typeof data?.detail === "string" && data.detail.trim()
    ? `<p style="margin:12px 0 0;padding:10px 14px;background:#f4f6f8;border-left:3px solid ${cat.color};border-radius:6px;font-family:monospace;font-size:13px;color:#2c3e50;line-height:1.6;">${textToHtml(data.detail.slice(0, MAX_MESSAGE_CHARS))}</p>`
    : "";
  const html = `
    <div style="font-family:'Outfit',Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;">
      <div style="background:${cat.color};color:#fff;padding:14px 20px;border-radius:10px 10px 0 0;">
        <h2 style="margin:0;font-size:18px;">${escHtml(cat.title)}</h2>
        <p style="margin:6px 0 0;font-size:13px;opacity:0.9;">${escHtml(APP_NAME)}</p>
      </div>
      <div style="background:#fff;border:1px solid #e0e4ea;border-top:none;padding:20px;border-radius:0 0 10px 10px;">
        <p style="font-size:14px;color:#2c3e50;line-height:1.6;margin:0;">
          Hi ${escHtml(recipientName)},<br><br>
          ${textToHtml(message)}
        </p>
        ${detail}
        <a href="${APP_URL}" style="display:inline-block;background:${cat.color};color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-top:16px;">
          ${escHtml(cat.cta)}
        </a>
        <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e0e4ea;font-size:12px;color:#8a94a0;">
          <a href="${APP_URL}" style="color:#1a6fa8;">Open ${escHtml(APP_NAME)}</a> -
          change your notification settings under Settings in the app.
        </div>
      </div>
    </div>`;
  return { subject, html };
}

// ---------------------------------------------------------------------------
// Recipients: user_profiles (person_id -> email) x notification_preferences
// ---------------------------------------------------------------------------
interface Recipient { person_id: string; email: string | null; name: string; prefs: any }

async function resolveRecipients(cat: Category, targetIds: string[] | null, names: Record<string, string>): Promise<{ list: Recipient[]; skippedPrefOff: number }> {
  const [profiles, prefRows] = await Promise.all([
    rest("user_profiles?select=person_id,email&person_id=not.is.null"),
    rest("notification_preferences?select=*"),
  ]);
  const prefsById: Record<string, any> = {};
  for (const p of (Array.isArray(prefRows) ? prefRows : [])) if (p?.person_id) prefsById[p.person_id] = p;

  // First non-empty email per person wins; a second account for the same
  // person (should not happen) is ignored rather than double-mailed.
  const emailById: Record<string, string | null> = {};
  for (const row of (Array.isArray(profiles) ? profiles : [])) {
    const pid = String(row.person_id);
    const email = typeof row.email === "string" && row.email.trim() ? row.email.trim() : null;
    if (!(pid in emailById) || (!emailById[pid] && email)) emailById[pid] = email;
  }

  // Universe = targetIds when given, else every linked person.
  const universe = targetIds ? targetIds.map(String) : Object.keys(emailById);
  const list: Recipient[] = [];
  let skippedPrefOff = 0;
  for (const pid of new Set(universe)) {
    const prefs = prefsById[pid] || null;
    if (!emailEnabled(cat, prefs)) { skippedPrefOff++; continue; }
    list.push({ person_id: pid, email: emailById[pid] ?? null, name: names[pid] || pid, prefs });
  }
  return { list, skippedPrefOff };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  try {
    // The injected project keys are needed for the auth check itself; the MAIL
    // secrets are checked only after the role gate (Prompt 16 B5), so an
    // unauthenticated caller learns nothing about configuration.
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json(500, { error: "function misconfigured: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing" });

    // -- Auth: require a verified user session (GoTrue), not merely a project JWT.
    const authz = req.headers.get("authorization") || "";
    const token = authz.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json(401, { error: "authentication required" });
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
    });
    if (!userRes.ok) {
      return json(401, { error: "authentication required - sign in again (a stale app build may need a reload)" });
    }
    const user = await userRes.json().catch(() => null);
    const userId = typeof user?.id === "string" ? user.id : "";
    if (!userId) return json(401, { error: "authentication required - sign in again (a stale app build may need a reload)" });

    // -- Role gate (audit RLS-1): the caller's profile, read by the VERIFIED id with the
    //    service role. A viewer, a missing row or an unlinked surgeon sends nothing, and
    //    is told so before the body is even read.
    const prof = await rest(`user_profiles?select=role,person_id&id=eq.${encodeURIComponent(userId)}`);
    const row = Array.isArray(prof) && prof[0] ? prof[0] : null;
    const caller = { role: row && typeof row.role === "string" ? row.role : null, personId: row && row.person_id != null ? String(row.person_id) : null };
    const roleDenied = senderRole(caller);
    if (roleDenied) {
      console.warn(`[send-notification] rejected (403): role=${caller.role || "none"} - ${roleDenied}`);
      return json(403, { error: `not allowed: ${roleDenied}` });
    }
    const privileged = caller.role === "admin" || caller.role === "scheduler";

    // -- Mail configuration, checked only for a caller the role gate let through.
    if (!RESEND_API_KEY) return json(500, { error: "RESEND_API_KEY not configured" });
    if (!FROM_EMAIL) return json(500, { error: "NOTIFICATION_FROM_EMAIL not configured" });

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return json(400, { error: "JSON body required" });

    if (body.recipients !== undefined) {
      console.warn("[send-notification] REJECTED legacy payload with caller-supplied recipients");
      return json(400, { error: "legacy payload no longer accepted - reload the app to update" });
    }

    const rawType = String(body.type || "");
    const type = TYPE_ALIASES[rawType] || rawType;
    if (TYPE_ALIASES[rawType]) console.warn(`[send-notification] alias type "${rawType}" -> "${type}" (older client build)`);
    const cat = CATEGORIES[type];
    if (!cat) return json(400, { error: `unknown notification type "${rawType}"` });

    const data = (body.data && typeof body.data === "object") ? body.data : {};
    if (type !== "test" && !(typeof data.message === "string" && data.message.trim())) {
      return json(400, { error: "data.message (the composed text) is required - the server does not invent schedule facts" });
    }

    // targetIds ABSENT -> broadcast. Present but EMPTY -> send to nobody.
    let targetIds: string[] | null = null;
    if (body.targetIds !== undefined) {
      if (!Array.isArray(body.targetIds)) return json(400, { error: "targetIds must be an array of person ids" });
      if (body.targetIds.length === 0) {
        console.log(`[send-notification] type=${type}: empty targetIds - nothing sent`);
        return json(200, { sent: 0, failed: 0, skipped_no_email: 0, skipped_pref_off: 0, results: [] });
      }
      targetIds = body.targetIds.map((x: unknown) => String(x));
    }

    // -- Recipient cap (Prompt 16 B5): roster size + 1. The roster is read once
    //    here; its names also serve the greeting below.
    const roster = await loadRoster();
    const cap = targetCap(roster.count);
    if (targetIds && targetIds.length > cap) {
      console.warn(`[send-notification] rejected (400): role=${caller.role || "none"} type=${type} targets=${targetIds.length} - over the cap of ${cap} (roster size + 1)`);
      return json(400, { error: `targetIds has ${targetIds.length} ids - the cap is ${cap} (roster size + 1)` });
    }

    // -- Party gate (audit RLS-1): a surgeon sends only his own categories, to the
    //    parties the app names. The scheduler list is read only for a surgeon caller.
    const schedulerIds = privileged ? [] : await loadSchedulerIds();
    const gateDenied = sendGate(caller, type, targetIds, schedulerIds);
    if (gateDenied) {
      console.warn(`[send-notification] rejected (403): role=${caller.role || "none"} type=${type} targets=${targetIds ? targetIds.length : "broadcast"} - ${gateDenied}`);
      return json(403, { error: `not allowed: ${gateDenied}` });
    }

    // -- Trade frame (Prompt 16 B5): a trade_* send names its shift_trade_requests
    //    row in data.trade_id and the row's two parties must be exactly targetIds -
    //    for every caller, the scheduler included (the app always has the row id;
    //    trade mail is never a broadcast and never reaches anyone but the two
    //    parties - and, on trade_applied only (Prompt 19 S3, v7), the
    //    scheduler-linked ids). A surgeon sender must himself be a party.
    if (isTradeType(type)) {
      const tradeId = tradeIdOf(data);
      if (!tradeId) {
        console.warn(`[send-notification] rejected (400): role=${caller.role || "none"} type=${type} - data.trade_id missing or malformed`);
        return json(400, { error: `${type} needs data.trade_id (the shift_trade_requests row this mail is about) - reload the app to update` });
      }
      const rows = await rest(`shift_trade_requests?select=from_surgeon_id,to_surgeon_id&id=eq.${encodeURIComponent(tradeId)}`);
      const trade = Array.isArray(rows) && rows[0] ? rows[0] : null;
      // Prompt 19 S3 (v7): trade_applied may also name the scheduler(s). The list is consulted only when targetIds
      // names someone beyond the two parties - an admin / scheduler caller's is read here, a surgeon's was read before
      // sendGate - so a v6-shaped send never depends on that read. A surgeon sender must be one of the parties.
      const extraIds = type === "trade_applied" && tradeNamesOthers(trade, targetIds) ? tradeExtraIds(type, privileged ? await loadSchedulerIds() : schedulerIds) : [];
      const partyDenied = tradePartyCheck(trade, targetIds, extraIds, privileged ? null : caller.personId);
      if (partyDenied) {
        console.warn(`[send-notification] rejected (403): role=${caller.role || "none"} type=${type} targets=${targetIds ? targetIds.length : "broadcast"} trade=${trade ? "found" : "none"} - ${partyDenied}`);
        return json(403, { error: `not allowed: ${partyDenied}` });
      }
    }

    const { list, skippedPrefOff } = await resolveRecipients(cat, targetIds, roster.names);
    console.log(`[send-notification] type=${type} targets=${targetIds ? targetIds.join(",") : "broadcast"} -> ${list.length} candidate(s), ${skippedPrefOff} opted out`);

    const results: { person_id: string; status: string }[] = [];
    let sent = 0, failed = 0, skippedNoEmail = 0;
    for (const r of list) {
      if (!r.email) { skippedNoEmail++; results.push({ person_id: r.person_id, status: "skipped_no_email" }); continue; }
      const { subject, html } = buildEmail(type, cat, data, r.name);
      const res = await sendEmail(r.email, subject, html, `type=${type} person=${r.person_id}`);
      if (res.ok) { sent++; results.push({ person_id: r.person_id, status: "sent" }); }
      else { failed++; results.push({ person_id: r.person_id, status: `failed_${res.status}` }); }
    }
    console.log(`[send-notification] type=${type} done: sent=${sent} failed=${failed} no_email=${skippedNoEmail} pref_off=${skippedPrefOff}`);

    return json(200, { sent, failed, skipped_no_email: skippedNoEmail, skipped_pref_off: skippedPrefOff, results });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[send-notification] error: ${message}`);
    return json(e instanceof HttpError ? 502 : 500, { error: message, upstream_status: e instanceof HttpError ? e.status : undefined });
  }
});
