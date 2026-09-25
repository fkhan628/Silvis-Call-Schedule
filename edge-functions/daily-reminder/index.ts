// ===================================================================
// Silvis Call Schedule - Daily Reminder Edge Function
// ===================================================================
// Retargeted from the Davenport (DSG) daily-reminder v19 on 2026-09-22.
//
// Runs HOURLY from pg_cron (`0 * * * *`) with the shared secret in the
// x-cron-secret header. Each invocation:
//   1. Rejects any caller without the correct x-cron-secret (fail closed,
//      BEFORE any work - the public anon key satisfies the gateway, not this;
//      constant-time compare since Prompt 16 B5, 2026-09-23 - see the
//      @cronSecret block).
//   2. Works out "now" in America/Chicago (DST-aware): the current hour and
//      TOMORROW's calendar date.
//   3. Reads tomorrow's schedule_days row (primary_id, backup_id,
//      external_cover, note).
//   4. For each filled role whose person has reminder_hour_central equal to
//      the current Central hour (null -> DEFAULT_REMINDER_HOUR) and
//      shift_reminders_email not false: emails
//        "Tomorrow you are on Silvis PRIMARY/BACKUP call (07:00 -> 07:00);
//         the other role is <name>".
//      The address comes from user_profiles.email joined on person_id
//      (notification_preferences has no email column at Silvis).
//   5. Prompt 20 F3 (revision o): every FOLLOWER (a viewer / coordinator
//      account whose user_profiles.follows names a surgeon on call tomorrow)
//      gets the same reminder worded for a third party - "Reminder: Dr.
//      Burchett is on primary call at Silvis tomorrow (Fri 10/9), backup
//      Khan" - one e-mail per followed surgeon, at the follower's OWN
//      reminder_hour_central and shift_reminders_email (his prefs row is keyed
//      by profile_id; none -> the default hour, on). The pure pieces are the
//      @followers mirror block (identical in send-notification); the response
//      adds `followers` { accounts, planned, sent, failed, skipped_*, results
//      (tags, never addresses), sample: { subject, line } } - or { error }
//      when the follower read failed (the surgeons' reminders stand).
//
// Dropped from Davenport on purpose: OneSignal push (send-push does not exist
// in the Silvis project), APP shifts / "APP on call with you" / "No APP
// tonight - you're all alone" (no APPs), week+slot decoding (dayCall / nights
// / wknd), hardcoded project URL / anon-key fallback / sender fallback.
//
// Changed on purpose: Davenport reminded people ON the day of their shift
// (default hour 8). Silvis reminds for TOMORROW's 07:00 shift, so the
// default hour is DEFAULT_REMINDER_HOUR (17 = 5 pm the evening before);
// each person overrides it in Settings via reminder_hour_central.
//
// Optional body { dryRun: true } (boolean only - anything else is a 400)
// composes everything and sends nothing; the response shows what would go out
// (counts + person ids, never addresses).
//
// Mode "open-shifts" (Prompt 13 part 5c, 2026-09-22) - body { mode:
// "open-shifts" }, same x-cron-secret gate, same dryRun contract; any other
// mode value is a 400 and an absent mode (or "reminder") is the hourly
// reminder above, unchanged. A third pg_cron job posts it every Monday 12:00
// UTC (07:00 CDT / 06:00 CST). It reads schedule_days for [today, today+30]
// Central, computes the open slots with openSlotsMirror (a plain-JS mirror of
// helpers.js openSlots between the @openSlots-mirror markers, pinned to the
// same fixture by test/open-shifts.test.js), and when any are open e-mails
// every linked surgeon whose schedule_updates_email is not false (addresses
// from user_profiles via the service role, statuses keyed by person_id) and
// inserts the notifications row { type: 'open_shifts', data: { slots,
// through, source: 'cron' } } that the board's "last announced" reads. dryRun
// composes, sends nothing and writes nothing. None open -> 200 { open: 0 }.
//
// Mode "offers" (Prompt 14 part 4, 2026-09-23) - body { mode: "offers" }, same
// x-cron-secret gate, same dryRun contract; any other mode value is a 400 and
// an absent mode (or "reminder") is the hourly reminder above, unchanged. A
// daily pg_cron job posts it at 13:00 UTC (08:00 CDT / 07:00 CST). For every
// call_periods row still 'upcoming' it runs the timeline maths mirrored from
// helpers.js (offerCronPlan / offerRollcall between the @offerTimeline-mirror
// markers, pinned to test/fixtures/offer-timeline.json by
// test/offers-timeline.test.js): on a reminder day (offers_close_at minus each
// groupRules.offerPeriods.remindDaysBeforeClose, default 14 and 3) it e-mails
// the pool members whose derived status is not_started ("your dates for
// <label> freeze on <date> - paint them in the app or choose 'go by my
// rules'"); from offers_close_at on it flips the row to 'closed' (compare-and-
// swap on status = upcoming), writes the audit row period.close and e-mails the
// scheduler / admin accounts the roll call (who submitted how many days, who
// is rules-only, who never answered). Addresses come from user_profiles by
// person_id with the service role; schedule_updates_email = false opts a
// surgeon out of the reminder, while the close roll call to the scheduler /
// admin accounts is unconditional (an operational notice, so a period never
// closes unseen); statuses are keyed by person_id. It never generates or
// publishes and never writes call_offers. dryRun composes, sends nothing,
// writes nothing.
//
// Secrets (by NAME): CRON_SECRET, RESEND_API_KEY, NOTIFICATION_FROM_EMAIL
// (required - no hardcoded fallback sender); SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.
//
// Deploy: supabase functions deploy daily-reminder --project-ref bzhsroegtagqhutbnsrp --no-verify-jwt

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = Deno.env.get("NOTIFICATION_FROM_EMAIL") || "";

const APP_URL = "https://fkhan628.github.io/Silvis-Call-Schedule/";
const APP_NAME = "Silvis Call Schedule";
const DEFAULT_REMINDER_HOUR = 17; // Central hour used when reminder_hour_central is null

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

// "Now" in America/Chicago: calendar date, hour 0-23, weekday. DST-aware.
function centralNow(date: Date = new Date()): { ymd: string; hour: number; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hour12: false, weekday: "long",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  let hour = parseInt(get("hour") || "0", 10);
  if (hour === 24) hour = 0; // some implementations return 24 at midnight
  return { ymd: `${get("year")}-${get("month")}-${get("day")}`, hour, weekday: get("weekday") };
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

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-11-02" -> "Monday, Nov 2"
function fmtDay(ymd: string): string {
  const [y, m, d] = parseYmd(ymd);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[dt.getUTCDay()]}, ${MONTHS[m - 1]} ${d}`;
}

interface RosterEntry { id: string; name: string; code: string }

async function loadRosterNames(): Promise<Record<string, string>> {
  const rows = await rest("call_schedule_data?select=data&id=eq.main");
  const raw = rows?.[0]?.data;
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  const list: RosterEntry[] = Array.isArray(data?.roster) ? data.roster : [];
  const names: Record<string, string> = {};
  for (const r of list) if (r?.id) names[String(r.id)] = r.name || String(r.id);
  return names;
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
// Followers (Prompt 20 F3, Faraz 9/24). A viewer / coordinator account the admin
// set to follow roster surgeons (user_profiles.follows, revision o) receives what
// those surgeons receive, read-only, on its OWN notification_preferences row
// (keyed by profile_id; no row -> every flag on, the default hour). Plain
// JavaScript between the markers, byte-identical in send-notification and
// daily-reminder: test/edge-functions.test.js extracts it, checks the copies
// match, evaluates it with new Function and runs it (followerFollows answers
// exactly like helpers.js followsOf). The accounts are read with select=*, so
// before revision o (no follows column) the list is simply empty - never a 400.
// Responses and logs name a follower by followerTag (the first 8 characters of
// the account id), never by address.
// ---------------------------------------------------------------------------
// @followers-mirror-start
const FOLLOWER_ROLE_NAMES = ["viewer", "coordinator"];
// what send-notification adds followers to: the trade frames (a Prompt 19 give rides them with data.kind "give"),
// the claim note, the open-shifts notice and the publish mail (review F3: the publish broadcast goes to LINKED persons,
// so a follower - person_id null - was never in it); manual_edit, vacation_logged, test and the offers mail are not
const FOLLOWER_SEND_TYPES = ["trade_proposed", "trade_accepted", "trade_declined", "trade_applied", "shift_claimed", "open_shifts", "schedule_published"];
function followerFollows(p) {
  const raw = p && typeof p === "object" ? p.follows : null;
  if (!Array.isArray(raw)) return [];
  const out = [];
  raw.forEach(function (v) { if (typeof v === "string" && v !== "" && out.indexOf(v) < 0) out.push(v); });
  return out;
}
function followerTag(id) { return String(id == null ? "" : id).slice(0, 8); }
// profiles: user_profiles rows (select=*); prefRows: notification_preferences rows (select=*). A follower is a viewer /
// coordinator row with no roster link and a non-empty follows list; his prefs row is the one whose profile_id is his id.
function followerIndex(profiles, prefRows) {
  const prefsByProfile = {};
  (Array.isArray(prefRows) ? prefRows : []).forEach(function (r) { if (r && typeof r === "object" && r.profile_id) prefsByProfile[String(r.profile_id)] = r; });
  const out = [];
  (Array.isArray(profiles) ? profiles : []).forEach(function (p) {
    if (!p || typeof p !== "object" || !p.id) return;
    if (FOLLOWER_ROLE_NAMES.indexOf(p.role) < 0) return;
    if (p.person_id !== null && p.person_id !== undefined && String(p.person_id) !== "") return;
    const follows = followerFollows(p);
    if (!follows.length) return;
    const email = typeof p.email === "string" && p.email.trim() ? p.email.trim() : null;
    const name = typeof p.display_name === "string" && p.display_name.trim() ? p.display_name.trim() : null;
    out.push({ id: String(p.id), tag: followerTag(p.id), email: email, name: name, follows: follows, prefs: prefsByProfile[String(p.id)] || null });
  });
  return out;
}
// send-notification: whose followers a send reaches (review F3) - the notice's own parties, never a scheduler-linked
// copy in targetIds: a trade_* the trade row's two parties (inside targetIds; Prompt 19's trade_applied may add scheduler
// copies), shift_claimed the claimer (a surgeon caller is the claimer; a scheduler caller may name data.surgeon_id),
// open_shifts / schedule_published the targetIds - or null for a broadcast (every follower). Anything else: [].
function followerUniverse(type, targetIds, caller, data, trade) {
  if (FOLLOWER_SEND_TYPES.indexOf(type) < 0) return [];
  const ids = Array.isArray(targetIds) ? targetIds.map(function (x) { return String(x); }) : null;
  if (type.indexOf("trade_") === 0) {
    if (!ids || !trade || typeof trade !== "object") return [];
    const out = [];
    [trade.from_surgeon_id, trade.to_surgeon_id].forEach(function (v) {
      const id = v === null || v === undefined ? "" : String(v);
      if (id && ids.indexOf(id) >= 0 && out.indexOf(id) < 0) out.push(id);
    });
    return out;
  }
  if (type === "shift_claimed") {
    if (!ids) return [];
    const privileged = !!caller && (caller.role === "admin" || caller.role === "scheduler");
    const named = data && typeof data.surgeon_id === "string" ? data.surgeon_id : "";
    const own = caller && caller.personId !== null && caller.personId !== undefined ? String(caller.personId) : "";
    const who = privileged && named ? named : own;
    return who && ids.indexOf(who) >= 0 ? [who] : [];
  }
  return ids;
}
// send-notification: the followers of any id in `universe` (followerUniverse's answer; null = a broadcast, every
// follower with all his follows), once each, for the FOLLOWER_SEND_TYPES only; `via` = the followed ids inside the
// universe. prefKey is the category's flag, read from the FOLLOWER'S row (an explicit false opts out; a missing row or
// flag is on).
function followerRecipients(followers, type, universe, prefKey) {
  const list = [], skipped = [];
  if (FOLLOWER_SEND_TYPES.indexOf(type) < 0) return { list: list, skipped: skipped };
  const all = universe === null;
  const ids = (Array.isArray(universe) ? universe : []).map(function (x) { return String(x); });
  (Array.isArray(followers) ? followers : []).forEach(function (f) {
    const via = all ? f.follows.slice() : f.follows.filter(function (id) { return ids.indexOf(id) >= 0; });
    if (!via.length) return;
    if (prefKey && f.prefs && f.prefs[prefKey] === false) { skipped.push({ follower: f.tag, via: via, status: "skipped_pref_off" }); return; }
    list.push({ id: f.id, tag: f.tag, email: f.email, name: f.name, via: via });
  });
  return { list: list, skipped: skipped };
}
// daily-reminder: one entry per follower x followed surgeon on call tomorrow (onCall: [{ person_id, role, otherLabel }]).
// The hour is the follower's own reminder_hour_central (else defaultHour); his own shift_reminders_email false -> off.
function followerReminderPlan(followers, onCall, hour, defaultHour) {
  const out = [];
  const calls = Array.isArray(onCall) ? onCall : [];
  (Array.isArray(followers) ? followers : []).forEach(function (f) {
    f.follows.forEach(function (id) {
      const o = calls.find(function (c) { return c && String(c.person_id) === id; });
      if (!o) return;
      const prefs = f.prefs || {};
      const userHour = typeof prefs.reminder_hour_central === "number" ? prefs.reminder_hour_central : defaultHour;
      let status = "due";
      if (userHour !== hour) status = "skipped_wrong_hour";
      else if (prefs.shift_reminders_email === false) status = "skipped_off";
      else if (!f.email) status = "skipped_no_email";
      out.push({ follower: f.tag, id: f.id, email: f.email, name: f.name, surgeon: id, role: o.role, otherLabel: o.otherLabel, user_hour: userHour, status: status });
    });
  });
  return out;
}
const FOLLOWER_DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// "Reminder: Dr. Burchett is on primary call at Silvis tomorrow (Fri 10/9), backup Khan"
function followerReminderLine(surgeonName, role, ymd, otherLabel) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
  const when = m ? FOLLOWER_DOW[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()] + " " + Number(m[2]) + "/" + Number(m[3]) : String(ymd || "?");
  const other = role === "primary" ? "backup" : "primary";
  return "Reminder: Dr. " + surgeonName + " is on " + role + " call at Silvis tomorrow (" + when + "), " + other + " " + otherLabel;
}
// @followers-mirror-end

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
// Email
// ---------------------------------------------------------------------------
function buildReminder(opts: {
  name: string; role: "primary" | "backup"; dayLabel: string; otherLabel: string; note: string | null;
}): { subject: string; html: string } {
  const ROLE = opts.role.toUpperCase();
  const otherRole = opts.role === "primary" ? "backup" : "primary";
  const subject = `Call reminder - tomorrow (${opts.dayLabel}) you are Silvis ${ROLE}`;
  const html = `
    <div style="font-family:'Outfit',Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;">
      <div style="background:linear-gradient(135deg,#1a6fa8,#2488c8);color:#fff;padding:14px 20px;border-radius:10px 10px 0 0;">
        <h2 style="margin:0;font-size:18px;">Call Reminder</h2>
        <p style="margin:6px 0 0;font-size:13px;opacity:0.9;">Tomorrow, ${escHtml(opts.dayLabel)}</p>
      </div>
      <div style="background:#fff;border:1px solid #e0e4ea;border-top:none;padding:20px;border-radius:0 0 10px 10px;">
        <p style="font-size:15px;color:#2c3e50;line-height:1.6;margin:0 0 12px;">
          Hi <strong>${escHtml(opts.name)}</strong>,<br><br>
          Tomorrow you are on <strong style="color:#1a6fa8;">Silvis ${ROLE} call</strong> (07:00 to 07:00 next day);
          the ${otherRole} is <strong>${escHtml(opts.otherLabel)}</strong>.
        </p>
        ${opts.note ? `<p style="font-size:13px;color:#5a6a78;line-height:1.6;margin:0 0 12px;padding:10px 14px;background:#f4f6f8;border-radius:8px;">Note: ${escHtml(opts.note)}</p>` : ""}
        <a href="${APP_URL}" style="display:inline-block;margin-top:8px;background:linear-gradient(135deg,#1a6fa8,#2488c8);color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
          View Full Schedule
        </a>
        <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e0e4ea;font-size:12px;color:#8a94a0;">
          ${escHtml(APP_NAME)} - change your reminder hour or turn reminders off under Settings in the app.
        </div>
      </div>
    </div>`;
  return { subject, html };
}

// Prompt 20 F3: the day-before reminder worded for a FOLLOWER (a third party). line = followerReminderLine(...), e.g.
// "Reminder: Dr. Burchett is on primary call at Silvis tomorrow (Fri 10/9), backup Khan".
function buildFollowerReminder(opts: {
  name: string | null; surgeonName: string; role: "primary" | "backup"; line: string; dayLabel: string; note: string | null;
}): { subject: string; html: string } {
  const subject = `Call reminder - tomorrow (${opts.dayLabel}) Dr. ${opts.surgeonName} is Silvis ${opts.role.toUpperCase()}`;
  const html = `
    <div style="font-family:'Outfit',Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;">
      <div style="background:linear-gradient(135deg,#1a6fa8,#2488c8);color:#fff;padding:14px 20px;border-radius:10px 10px 0 0;">
        <h2 style="margin:0;font-size:18px;">Call Reminder</h2>
        <p style="margin:6px 0 0;font-size:13px;opacity:0.9;">Tomorrow, ${escHtml(opts.dayLabel)}</p>
      </div>
      <div style="background:#fff;border:1px solid #e0e4ea;border-top:none;padding:20px;border-radius:0 0 10px 10px;">
        <p style="font-size:15px;color:#2c3e50;line-height:1.6;margin:0 0 12px;">
          ${opts.name ? `Hi <strong>${escHtml(opts.name)}</strong>,` : "Hi,"}<br><br>
          ${escHtml(opts.line)} (07:00 to 07:00 next day).
        </p>
        ${opts.note ? `<p style="font-size:13px;color:#5a6a78;line-height:1.6;margin:0 0 12px;padding:10px 14px;background:#f4f6f8;border-radius:8px;">Note: ${escHtml(opts.note)}</p>` : ""}
        <a href="${APP_URL}" style="display:inline-block;margin-top:8px;background:linear-gradient(135deg,#1a6fa8,#2488c8);color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
          View Full Schedule
        </a>
        <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e0e4ea;font-size:12px;color:#8a94a0;">
          ${escHtml(APP_NAME)} - you receive this because you follow Dr. ${escHtml(opts.surgeonName)}; to change the reminder hour or stop these reminders, use Notification settings under Settings in the app.
        </div>
      </div>
    </div>`;
  return { subject, html };
}

// ---------------------------------------------------------------------------
// Mode "open-shifts" (Prompt 13 part 5c) - the Monday notice without a session
// ---------------------------------------------------------------------------
// @openSlots-mirror-start
// MIRROR of helpers.js openSlots(schedule, from, to, today, opts),
// openSlotsLine(slot, nameOfUnit) and openShiftsEmail(slots, opts) - written
// as plain JavaScript on purpose (no type annotations, nothing from outside
// this block): test/open-shifts.test.js extracts the text between the two
// markers, evaluates it with new Function and runs it against
// test/fixtures/open-slots.json and test/fixtures/open-shifts-email.json,
// expecting results identical to helpers.js (plus 200 seeded random
// schedules). Change helpers.js, this block and the fixtures together.
// schedule_days columns map to the assignment fields the caller builds:
// primary_id -> primary, backup_id -> backup, external_cover -> externalCover
// (a lock flag never holds a slot). Dates are UTC-based here (the runtime has
// no useful local zone); the caller passes Central calendar dates. One
// deliberate difference: helpers.js falls back to todayCentral() for a
// malformed `today`; here a malformed today THROWS (fail loud in the cron log)
// because the caller always has centralNow().ymd.
function osmPad2(n) { return String(n).padStart(2, "0"); }
function osmIsIso(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function osmDate(s) { const p = String(s).split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); }
function osmFmt(d) { return d.getUTCFullYear() + "-" + osmPad2(d.getUTCMonth() + 1) + "-" + osmPad2(d.getUTCDate()); }
function osmIsDay(s) { return osmIsIso(s) && osmFmt(osmDate(s)) === s; }
function osmAdd(iso, n) { const d = osmDate(iso); d.setUTCDate(d.getUTCDate() + n); return osmFmt(d); }
function osmDow(iso) { return osmDate(iso).getUTCDay(); } // 0 Sun ... 6 Sat
function osmDaysBetween(a, b) { return Math.round((osmDate(b).getTime() - osmDate(a).getTime()) / 86400000); }
function osmFmtMD(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "")); return m ? Number(m[2]) + "/" + Number(m[3]) : String(iso || "?"); }
function osmMonday(iso) { return osmAdd(iso, -((osmDow(iso) + 6) % 7)); }
function osmHolder(a, role) {
  if (!a) return null;
  if (role === "primary") return a.primary || (a.externalCover ? "ext:" + a.externalCover : null);
  if (role === "backup") return a.backup || null;
  return null;
}
function osmUnit(day, holidayByDay, weekendKinds) {
  const hol = holidayByDay && typeof holidayByDay === "object" ? holidayByDay[day] : null;
  if (hol && typeof hol === "object") return { kind: "holiday", name: hol.name || null };
  const dow = osmDow(day);
  if (dow !== 5 && dow !== 6 && dow !== 0) return null;
  const friday = dow === 5 ? day : osmAdd(day, dow === 6 ? -1 : -2);
  const kinds = weekendKinds && typeof weekendKinds === "object" ? weekendKinds : {};
  const k = kinds[friday];
  return { kind: "weekend", pattern: k === "block" || k === "split" || k === "daily" ? k : null, friday: friday };
}
function openSlotsMirror(schedule, from, to, today, opts) {
  if (!osmIsDay(from) || !osmIsDay(to) || from > to) return [];
  if (!osmIsIso(today)) throw new Error("openSlotsMirror: today must be YYYY-MM-DD (the caller passes the Central date)");
  const sched = schedule && typeof schedule === "object" ? schedule : {};
  const o = opts && typeof opts === "object" ? opts : {};
  const reasons = o.reasons && typeof o.reasons === "object" ? o.reasons : {};
  const start = from < today ? today : from; // days before today are never open
  if (start > to) return [];
  const out = [];
  const n = osmDaysBetween(start, to);
  for (let k = 0; k <= n; k++) {
    const d = osmAdd(start, k);
    const a = sched[d] || null;
    let unit;
    ["primary", "backup"].forEach(function (role) {
      if (osmHolder(a, role)) return;
      if (unit === undefined) unit = osmUnit(d, o.holidayByDay, o.weekendKinds);
      const r = reasons[d + "|" + role];
      const reason = typeof r === "string" ? r.trim() : "";
      out.push({ day: d, role: role, unit: unit, reason: reason || null });
    });
  }
  return out;
}
const OSM_DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function openSlotsLineMirror(slot, nameOfUnit) {
  const s = slot || {};
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s.day || ""));
  const when = m ? OSM_DOW[osmDow(s.day)] + " " + m[2] + "/" + m[3] : String(s.day || "?");
  const u = s.unit && typeof s.unit === "object" ? s.unit : null;
  let unitText = "";
  if (typeof nameOfUnit === "function") unitText = u ? String(nameOfUnit(u) || "") : "";
  else if (u && u.kind === "holiday") unitText = "holiday: " + (u.name || "unit");
  else if (u && u.kind === "weekend") unitText = "weekend" + (u.pattern ? " " + u.pattern : "");
  const reason = typeof s.reason === "string" && s.reason.trim() ? " - " + s.reason.trim() : "";
  return when + " - " + (s.role || "?") + (unitText ? " (" + unitText + ")" : "") + " - open" + reason;
}
function openShiftsEmailMirror(slots, opts) {
  const o = typeof opts === "string" ? { appUrl: opts } : (opts && typeof opts === "object" ? opts : {});
  const list = (Array.isArray(slots) ? slots : []).filter(function (s) { return s && typeof s === "object" && osmIsDay(s.day) && (s.role === "primary" || s.role === "backup"); });
  list.sort(function (a, b) { return a.day < b.day ? -1 : a.day > b.day ? 1 : a.role === b.role ? 0 : a.role === "primary" ? -1 : 1; });
  const n = list.length;
  const lastDay = n ? list[n - 1].day : null;
  const through = osmIsDay(o.through) && (!lastDay || o.through >= lastDay) ? o.through : lastDay;
  const thruText = through ? " through " + osmFmtMD(through) : "";
  const subject = n + " open shift" + (n === 1 ? "" : "s") + thruText;
  const appUrl = typeof o.appUrl === "string" && o.appUrl.trim() ? o.appUrl.trim() : "";
  const detail = "Take this shift: " + (appUrl ? appUrl + "#openshifts" : "open the Open shifts view in the app");
  const weeks = [];
  list.forEach(function (s) {
    const monday = osmMonday(s.day);
    let w = weeks.length ? weeks[weeks.length - 1] : null;
    if (!w || w.monday !== monday) { w = { monday: monday, lines: [] }; weeks.push(w); }
    w.lines.push("  " + openSlotsLineMirror(s, o.nameOfUnit));
  });
  const lead = n + " open call shift" + (n === 1 ? "" : "s") + thruText + " (one 24-hour shift each, 07:00 to 07:00). Take one from the Open shifts board - the link is below.";
  const message = n
    ? lead + "\n\n" + weeks.map(function (w) { return "Week of Mon " + osmFmtMD(w.monday) + ":\n" + w.lines.join("\n"); }).join("\n\n")
    : "No open shifts - every published day is covered.";
  return { subject: subject, message: message, detail: detail, through: through, count: n, slots: list.map(function (s) { return { day: s.day, role: s.role }; }) };
}
// The cron's window = helpers.obBoardSlots over the rows read (today ..
// today+30): the run of rows that STARTS today is the published block seen
// from today (through = its end; null when today has no row), then the open
// slots of every ASSIGNED run after it (a pre-assigned holiday unit -
// claim_open_slot accepts those days). A day with no row is not published and
// never open - it is neither in the block nor in an assigned run - and a stray
// row nobody holds beyond the block is no assigned range. Fix round of part 5:
// the first cut clipped only the END and so announced every row-less day
// between today and the first row as open in both roles.
function osmCollapse(days) {
  const out = [];
  days.forEach(function (d) {
    const last = out.length ? out[out.length - 1] : null;
    if (last && osmAdd(last.end, 1) === d) last.end = d; else out.push({ start: d, end: d });
  });
  return out;
}
function openShiftsWindowMirror(schedule, today, opts) {
  if (!osmIsDay(today)) throw new Error("openShiftsWindowMirror: today must be YYYY-MM-DD (the caller passes the Central date)");
  const sched = schedule && typeof schedule === "object" ? schedule : {};
  const days = Object.keys(sched).filter(function (d) { return osmIsDay(d) && d >= today; }).sort();
  const runs = osmCollapse(days);
  const through = runs.length && runs[0].start === today ? runs[0].end : null;
  const slots = through ? openSlotsMirror(sched, today, through, today, opts) : [];
  const held = days.filter(function (d) { return (!through || d > through) && (osmHolder(sched[d], "primary") || osmHolder(sched[d], "backup")); });
  const ranges = osmCollapse(held);
  ranges.forEach(function (r) { openSlotsMirror(sched, r.start, r.end, today, opts).forEach(function (s) { slots.push(s); }); });
  return { slots: slots, through: through, ranges: ranges };
}
// @openSlots-mirror-end

// The blob (call_schedule_data.data): roster names for the greeting, the
// holiday units (holidays.units[year][] = { name, days }) and the last
// generate's weekend kinds + operational reasons for the unit / reason text.
async function loadBlobData(): Promise<any> {
  const rows = await rest("call_schedule_data?select=data&id=eq.main");
  const raw = rows?.[0]?.data;
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  return data && typeof data === "object" ? data : {};
}

// Same frame as send-notification's open_shifts category (title, colour, CTA)
// so the Monday notice and the on-demand notice look alike in the inbox.
function buildOpenShiftsEmail(name: string, em: { subject: string; message: string; detail: string }): { subject: string; html: string } {
  const color = "#C2410C";
  const link = `${APP_URL}#openshifts`;
  const html = `
    <div style="font-family:'Outfit',Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;">
      <div style="background:${color};color:#fff;padding:14px 20px;border-radius:10px 10px 0 0;">
        <h2 style="margin:0;font-size:18px;">Open Shifts</h2>
        <p style="margin:6px 0 0;font-size:13px;opacity:0.9;">${escHtml(APP_NAME)}</p>
      </div>
      <div style="background:#fff;border:1px solid #e0e4ea;border-top:none;padding:20px;border-radius:0 0 10px 10px;">
        <p style="font-size:14px;color:#2c3e50;line-height:1.6;margin:0;">
          Hi ${escHtml(name)},<br><br>
          ${escHtml(em.message).replace(/^ {2}/gm, "&nbsp;&nbsp;").replace(/\r?\n/g, "<br>")}
        </p>
        <p style="margin:12px 0 0;padding:10px 14px;background:#f4f6f8;border-left:3px solid ${color};border-radius:6px;font-family:monospace;font-size:13px;color:#2c3e50;line-height:1.6;">
          Take this shift: <a href="${link}" style="color:#1a6fa8;">${escHtml(link)}</a>
        </p>
        <a href="${link}" style="display:inline-block;background:${color};color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-top:16px;">
          Open shifts
        </a>
        <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e0e4ea;font-size:12px;color:#8a94a0;">
          ${escHtml(APP_NAME)} - this note goes out every Monday morning while a shift in the next 30 days is open; turn schedule updates off under Settings in the app to stop it.
        </div>
      </div>
    </div>`;
  return { subject: em.subject, html };
}

async function runOpenShifts(now: { ymd: string; hour: number; weekday: string }, dryRun: boolean): Promise<Response> {
  const from = now.ymd;
  const horizon = addDays(from, 30);
  console.log(`[daily-reminder] mode=open-shifts central=${from} ${now.weekday} window=${from}..${horizon} dryRun=${dryRun}`);

  const [rows, blob] = await Promise.all([
    rest(`schedule_days?select=day,primary_id,backup_id,external_cover,primary_locked,backup_locked&day=gte.${from}&day=lte.${horizon}&order=day.asc`),
    loadBlobData(),
  ]);
  // Column -> assignment field, as the fixture states; the lock flags are read
  // but never hold a slot (a locked, empty day IS open - the scheduler assigns it).
  const schedule: Record<string, { primary: string | null; backup: string | null; externalCover: string | null }> = {};
  for (const r of (Array.isArray(rows) ? rows : [])) {
    if (!r?.day) continue;
    schedule[String(r.day)] = { primary: r.primary_id || null, backup: r.backup_id || null, externalCover: r.external_cover || null };
  }
  if (!Object.keys(schedule).length) {
    console.log(`[daily-reminder] open-shifts: no schedule_days rows in ${from}..${horizon} - nothing published to announce`);
    return json(200, { mode: "open-shifts", dry_run: dryRun, open: 0, through: null, window_end: horizon, sent: 0 });
  }

  const holidayByDay: Record<string, { name: string | null; days: string[] }> = {};
  const unitsByYear = blob?.holidays?.units && typeof blob.holidays.units === "object" ? blob.holidays.units : {};
  for (const yk of Object.keys(unitsByYear)) {
    for (const u of (Array.isArray(unitsByYear[yk]) ? unitsByYear[yk] : [])) {
      if (!u || !Array.isArray(u.days)) continue;
      for (const d of u.days) holidayByDay[String(d)] = { name: u.name || null, days: u.days.map(String) };
    }
  }
  const lg = blob?.lastGenerate && typeof blob.lastGenerate === "object" ? blob.lastGenerate : {};
  const weekendKinds = lg.weekendKinds && typeof lg.weekendKinds === "object" ? lg.weekendKinds : {};
  const reasons: Record<string, string> = {};
  for (const s of (Array.isArray(lg.openSlots) ? lg.openSlots : [])) {
    if (s?.day && s?.role && typeof s.reason === "string") reasons[`${s.day}|${s.role}`] = s.reason;
  }

  // The window the board shows (helpers.obBoardSlots): the block that starts
  // today, then the open slots of the assigned runs after it; a row-less day is
  // never announced. published_through = the block's end (null when today has
  // no row); the notice's own 'through' (subject, feed row) is the later of
  // that and the last listed slot's day.
  const win = openShiftsWindowMirror(schedule, from, { holidayByDay, weekendKinds, reasons });
  const slots = win.slots;
  const blockThrough: string | null = win.through;
  console.log(`[daily-reminder] open-shifts: ${slots.length} open slot(s) in ${from}..${horizon} (block through ${blockThrough || "-"}, later assigned runs ${win.ranges.map((r: { start: string; end: string }) => r.start + ".." + r.end).join(",") || "-"})`);
  if (!slots.length) return json(200, { mode: "open-shifts", dry_run: dryRun, open: 0, through: blockThrough, published_through: blockThrough, window_end: horizon, sent: 0 });

  const em = openShiftsEmailMirror(slots, { appUrl: APP_URL, through: blockThrough });
  const through: string | null = em.through;

  // Recipients: every linked person (user_profiles.person_id not null) whose
  // schedule_updates_email is not explicitly false (missing row = on). Both
  // read with the service role so RLS cannot silently hide a row.
  const [profiles, prefRows] = await Promise.all([
    rest("user_profiles?select=person_id,email&person_id=not.is.null"),
    rest("notification_preferences?select=person_id,schedule_updates_email"),
  ]);
  const prefsById: Record<string, any> = {};
  for (const p of (Array.isArray(prefRows) ? prefRows : [])) if (p?.person_id) prefsById[String(p.person_id)] = p;
  const emailById: Record<string, string | null> = {};
  for (const row of (Array.isArray(profiles) ? profiles : [])) {
    const pid = String(row.person_id);
    const email = typeof row.email === "string" && row.email.trim() ? row.email.trim() : null;
    if (!(pid in emailById) || (!emailById[pid] && email)) emailById[pid] = email;
  }
  const names: Record<string, string> = {};
  for (const r of (Array.isArray(blob?.roster) ? blob.roster : [])) if (r?.id) names[String(r.id)] = r.name || String(r.id);

  const results: { person_id: string; status: string }[] = [];
  let sent = 0, failed = 0, prefOff = 0, noEmail = 0;
  for (const pid of Object.keys(emailById).sort()) {
    const pref = prefsById[pid] || null;
    if (pref && pref.schedule_updates_email === false) { prefOff++; results.push({ person_id: pid, status: "skipped_pref_off" }); continue; }
    const email = emailById[pid];
    if (!email) { noEmail++; results.push({ person_id: pid, status: "skipped_no_email" }); continue; }
    const { subject, html } = buildOpenShiftsEmail(names[pid] || pid, em);
    if (dryRun) { results.push({ person_id: pid, status: "dry_run_composed" }); continue; }
    const r = await sendEmail(email, subject, html, `mode=open-shifts person=${pid}`);
    if (r.ok) { sent++; results.push({ person_id: pid, status: "sent" }); }
    else { failed++; results.push({ person_id: pid, status: `failed_${r.status}` }); }
  }

  // The feed row the board's "last announced" reads - written by the service
  // role, never in a dry run. A failed insert is reported, not hidden.
  let feedRow = "skipped_dry_run";
  if (!dryRun) {
    try {
      await rest("notifications", {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ type: "open_shifts", title: em.subject, message: em.message, data: { slots: em.slots, through, source: "cron" } }),
      });
      feedRow = "inserted";
    } catch (e) {
      feedRow = `failed: ${(e as Error).message}`;
      console.error(`[daily-reminder] open-shifts: notifications insert failed: ${(e as Error).message}`);
    }
  }

  console.log(`[daily-reminder] open-shifts done: open=${slots.length} sent=${sent} failed=${failed} pref_off=${prefOff} no_email=${noEmail} feed_row=${feedRow.split(":")[0]}`);
  return json(200, {
    mode: "open-shifts", dry_run: dryRun, open: slots.length, through, published_through: blockThrough, window_end: horizon,
    sent, failed, skipped_pref_off: prefOff, skipped_no_email: noEmail, feed_row: feedRow, results,
  });
}

// ---------------------------------------------------------------------------
// Mode "offers" (Prompt 14 part 4) - the period timeline runs itself
// ---------------------------------------------------------------------------
// @offerTimeline-mirror-start
// MIRROR of helpers.js offerTimeline(period, rules), offerCronPlan(period,
// today, rules), offerRollcall(period, offers, ids), offerPoolIds(roster) and
// offerStatus(period, offers, personId) - written as plain JavaScript on
// purpose (no type annotations, nothing from outside this block):
// test/offers-timeline.test.js extracts the text between the two markers,
// evaluates it with new Function and runs it against
// test/fixtures/offer-timeline.json, expecting results identical to helpers.js
// (plus 400 seeded random periods). Change helpers.js, this block and the
// fixture together. Dates are UTC-based here (the runtime has no useful local
// zone); the caller passes the Central calendar date. One deliberate
// difference: a Date object is formatted in UTC here, in local time in
// helpers.js - PostgREST hands this function strings, never Dates.
const OTM_DEFAULTS = { lengthMonths: 3, presets: [3, 6], closeWeeksBeforeStart: 6, publishWeeksBeforeStart: 4, remindDaysBeforeClose: [14, 3] }; // = docs/silvis-seed.json groupRules.offerPeriods
function otmPad2(n) { return String(n).padStart(2, "0"); }
function otmDate(s) { const p = String(s).split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); }
function otmFmt(d) { return d.getUTCFullYear() + "-" + otmPad2(d.getUTCMonth() + 1) + "-" + otmPad2(d.getUTCDate()); }
function otmAdd(iso, n) { const d = otmDate(iso); d.setUTCDate(d.getUTCDate() + n); return otmFmt(d); }
function otmDaysBetween(a, b) { return Math.round((otmDate(b).getTime() - otmDate(a).getTime()) / 86400000); }
function otmDay(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return otmFmt(v);
  const s = typeof v === "string" ? v.slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function otmBounds(p) {
  if (!p || typeof p !== "object") return null;
  const a = otmDay(p.start_day !== undefined ? p.start_day : p.start), b = otmDay(p.end_day !== undefined ? p.end_day : p.end);
  return a && b && b >= a ? { start: a, end: b } : null;
}
function otmList(v) {
  if (typeof v === "string") { try { v = JSON.parse(v); } catch (e) { return []; } }
  return Array.isArray(v) ? v : [];
}
function otmStatus(period, offers, personId) {
  const b = otmBounds(period);
  if (!b) return null;
  const rows = Array.isArray(offers) ? offers : [];
  for (let i = 0; i < rows.length; i++) {
    const o = rows[i];
    if (!o || o.person_id !== personId) continue;
    const d = otmDay(o.day);
    if (d && d >= b.start && d <= b.end) return "submitted";
  }
  return otmList(period.rules_only_ids).indexOf(personId) >= 0 ? "rules_only" : "not_started";
}
function otmEndOfPeriod(start, months) {
  const y = +start.slice(0, 4), m = +start.slice(5, 7);
  const idx = m + months - 1, yy = y + Math.floor((idx - 1) / 12), mm = ((idx - 1) % 12) + 1;
  let end = otmFmt(new Date(Date.UTC(yy, mm, 0)));
  const dow = otmDate(end).getUTCDay(); // 0 = Sun .. 6 = Sat
  if (dow === 5 || dow === 6) end = otmAdd(end, 7 - dow);
  return end;
}
function otmTimeline(period, rules) {
  const start = period && typeof period === "object" ? otmDay(period.start_day !== undefined ? period.start_day : period.start) : null;
  if (!start) return null;
  const Rz = Object.assign({}, OTM_DEFAULTS, rules && typeof rules === "object" ? rules : {});
  const num = (v, d) => (typeof v === "number" && isFinite(v) && v > 0 ? v : d);
  const months = num(period.length_months !== undefined ? period.length_months : period.lengthMonths, num(Rz.lengthMonths, OTM_DEFAULTS.lengthMonths));
  const closeW = num(Rz.closeWeeksBeforeStart, OTM_DEFAULTS.closeWeeksBeforeStart), pubW = num(Rz.publishWeeksBeforeStart, OTM_DEFAULTS.publishWeeksBeforeStart);
  const remind = (Array.isArray(Rz.remindDaysBeforeClose) ? Rz.remindDaysBeforeClose : OTM_DEFAULTS.remindDaysBeforeClose).filter((n) => typeof n === "number" && isFinite(n) && n >= 0);
  const end = otmDay(period.end_day !== undefined ? period.end_day : period.end) || otmEndOfPeriod(start, months);
  const close = otmDay(period.offers_close_at) || otmAdd(start, -7 * closeW);
  const publish = otmDay(period.publish_by) || otmAdd(start, -7 * pubW);
  return { start_day: start, end_day: end, length_months: months, offers_close_at: close, publish_by: publish, remind_on: remind.map((n) => otmAdd(close, -n)).sort(), presets: Array.isArray(Rz.presets) ? Rz.presets.slice() : OTM_DEFAULTS.presets.slice() };
}
function otmPoolIds(roster) {
  if (!Array.isArray(roster)) return [];
  const out = [];
  roster.forEach((r) => { if (r && typeof r === "object" && r.id && r.active !== false && r.type !== "external") out.push(String(r.id)); });
  return out;
}
function otmRollcall(period, offers, ids) {
  const b = otmBounds(period);
  if (!b || !Array.isArray(ids)) return [];
  const days = Object.create(null);
  (Array.isArray(offers) ? offers : []).forEach((o) => {
    if (!o || typeof o !== "object" || !o.person_id) return;
    const d = otmDay(o.day);
    if (!d || d < b.start || d > b.end) return;
    (days[o.person_id] = days[o.person_id] || new Set()).add(d);
  });
  return ids.map((id) => ({ id: String(id), status: otmStatus(period, offers, String(id)), offered: days[id] ? days[id].size : 0 }));
}
function otmCronPlan(period, today, rules) {
  const t = otmTimeline(period, rules);
  const d = otmDay(today);
  if (!t || !d) return null;
  const close = t.offers_close_at, daysToClose = otmDaysBetween(d, close);
  const status = period.status === undefined || period.status === null ? "upcoming" : String(period.status);
  const base = { action: "none", reason: "no-trigger", days_to_close: daysToClose, offers_close_at: close, remind_on: t.remind_on };
  if (status !== "upcoming") return Object.assign(base, { reason: "status:" + status });
  if (d >= close) return Object.assign(base, { action: "close", reason: daysToClose === 0 ? "close:today" : "close:overdue" });
  if (t.remind_on.indexOf(d) >= 0) return Object.assign(base, { action: "remind", reason: "remind:" + daysToClose });
  return base;
}
// @offerTimeline-mirror-end

// The blob (call_schedule_data.data), read once: roster (names, the pool) and
// groupRules.offerPeriods (the reminder offsets; absent -> the mirror's defaults).
async function loadOffersBlob(): Promise<{ roster: any[]; rules: any }> {
  const rows = await rest("call_schedule_data?select=data&id=eq.main");
  const raw = rows?.[0]?.data;
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  const roster = Array.isArray(data?.roster) ? data.roster : [];
  const gr = data?.groupRules?.offerPeriods;
  return { roster, rules: gr && typeof gr === "object" && !Array.isArray(gr) ? gr : null };
}

// Same frame as send-notification's offers_reminder / offers_closed
// categories (title, colour, CTA) so the cron's mail and the Periods
// "Remind" button's mail look alike in the inbox. Wording per the prompt.
function offersFrame(title: string, color: string, name: string, bodyHtml: string, cta: string, footer: string): string {
  return `
    <div style="font-family:'Outfit',Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;">
      <div style="background:${color};color:#fff;padding:14px 20px;border-radius:10px 10px 0 0;">
        <h2 style="margin:0;font-size:18px;">${escHtml(title)}</h2>
        <p style="margin:6px 0 0;font-size:13px;opacity:0.9;">${escHtml(APP_NAME)}</p>
      </div>
      <div style="background:#fff;border:1px solid #e0e4ea;border-top:none;padding:20px;border-radius:0 0 10px 10px;">
        <p style="font-size:14px;color:#2c3e50;line-height:1.6;margin:0;">
          Hi <strong>${escHtml(name)}</strong>,<br><br>
          ${bodyHtml}
        </p>
        <a href="${APP_URL}" style="display:inline-block;background:${color};color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-top:16px;">
          ${escHtml(cta)}
        </a>
        <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e0e4ea;font-size:12px;color:#8a94a0;">
          ${escHtml(APP_NAME)} - ${escHtml(footer)}
        </div>
      </div>
    </div>`;
}

function buildOffersReminder(name: string, p: { label: string; start_day: string; end_day: string; offers_close_at: string; days_to_close: number; remind_days: number[] }): { subject: string; html: string } {
  const closeLabel = fmtDay(p.offers_close_at);
  const subject = `Your call dates for ${p.label} freeze on ${closeLabel}`;
  const days = p.days_to_close === 1 ? "tomorrow" : `in ${p.days_to_close} days`;
  // The footer names the effective offsets (groupRules.offerPeriods.remindDaysBeforeClose,
  // editable in Setup -> Rules) - never a literal, so editing the rule keeps the words right.
  const offsets = p.remind_days.length ? p.remind_days.join(" and ") : String(p.days_to_close);
  const footer = `this reminder goes out ${offsets} day${offsets === "1" ? "" : "s"} before a period's freeze to anyone with nothing entered; turn schedule updates off under Settings in the app to stop it.`;
  const body =
    `Your dates for <strong>${escHtml(p.label)}</strong> (${escHtml(fmtDay(p.start_day))} to ${escHtml(fmtDay(p.end_day))}) ` +
    `freeze on <strong>${escHtml(closeLabel)}</strong> (${days}) - paint them in the app or choose 'go by my rules'.<br><br>` +
    `Nothing is entered for you yet. After the freeze the schedule for the period is built from what was offered; anyone ` +
    `with nothing entered is scheduled by their standing rules, and what is still open goes to the open-shifts board.`;
  return { subject, html: offersFrame("Offers Reminder", "#13294B", name, body, "Paint my offers", footer) };
}

function buildOffersClosed(name: string, p: { label: string; start_day: string; end_day: string; offers_close_at: string }, roll: { id: string; status: string; offered: number }[], nameOf: (id: string) => string, periodStatus: string): { subject: string; html: string } {
  const submitted = roll.filter((r) => r.status === "submitted");
  const rulesOnly = roll.filter((r) => r.status === "rules_only");
  const notStarted = roll.filter((r) => r.status === "not_started");
  const subject = `Offers closed for ${p.label} - ${submitted.length} submitted, ${rulesOnly.length} by rules, ${notStarted.length} never answered`;
  const li = (rows: { id: string; offered: number }[], suffix: (r: { offered: number }) => string) =>
    rows.length ? rows.map((r) => `<li>${escHtml(nameOf(r.id))}${suffix(r)}</li>`).join("") : "<li>-</li>";
  const body =
    `Offers for <strong>${escHtml(p.label)}</strong> (${escHtml(fmtDay(p.start_day))} to ${escHtml(fmtDay(p.end_day))}) closed on ` +
    `<strong>${escHtml(fmtDay(p.offers_close_at))}</strong>; the period is now marked <strong>${escHtml(periodStatus)}</strong>.<br><br>` +
    `<strong>Submitted</strong> (days offered inside the period):<ul style="margin:4px 0 10px;padding-left:20px;">${li(submitted, (r) => ` - ${r.offered} day${r.offered === 1 ? "" : "s"}`)}</ul>` +
    `<strong>Go by my rules</strong>:<ul style="margin:4px 0 10px;padding-left:20px;">${li(rulesOnly, () => "")}</ul>` +
    `<strong>Never answered</strong> (scheduled by their standing rules):<ul style="margin:4px 0 10px;padding-left:20px;">${li(notStarted, () => "")}</ul>` +
    `Nothing was generated or published - open Setup, Generate, Periods when you are ready. A late offer can still be entered by the scheduler.`;
  return { subject, html: offersFrame("Offers Closed", "#C2410C", name, body, "Open Periods", "the close summary goes to the scheduler and admin accounts on the morning a period's offers freeze.") };
}

async function runOffers(now: { ymd: string; hour: number; weekday: string }, dryRun: boolean): Promise<Response> {
  const today = now.ymd;
  console.log(`[daily-reminder] mode=offers central=${today} ${now.weekday} dryRun=${dryRun}`);

  const [periods, blob] = await Promise.all([
    rest("call_periods?select=id,label,start_day,end_day,offers_close_at,publish_by,status,rules_only_ids&status=eq.upcoming&order=start_day.asc"),
    loadOffersBlob(),
  ]);
  const list: any[] = Array.isArray(periods) ? periods : [];
  const names: Record<string, string> = {};
  for (const r of blob.roster) if (r?.id) names[String(r.id)] = r.name || String(r.id);
  const nameOf = (id: string) => names[id] || id;
  const poolIds: string[] = otmPoolIds(blob.roster);

  const results: any[] = [];
  let reminded = 0, closed = 0, sent = 0, failed = 0, prefOff = 0, noEmail = 0;

  // Plan first (pure maths), so a morning with nothing to do reads nothing else.
  const plans = list.map((p) => ({ period: p, plan: otmCronPlan(p, today, blob.rules) }));
  for (const { period, plan } of plans) {
    if (!plan) results.push({ period: period?.label ?? null, id: period?.id ?? null, action: "skipped", reason: "period row has no usable dates" });
    else if (plan.action === "none") results.push({ period: period.label, id: period.id, action: "none", reason: plan.reason, days_to_close: plan.days_to_close, offers_close_at: plan.offers_close_at, remind_on: plan.remind_on });
  }
  console.log(`[daily-reminder] offers: ${list.length} upcoming period(s): ${plans.map((x) => `${x.period?.label}=${x.plan ? x.plan.reason : "no-dates"}`).join(", ") || "(none)"}`);
  const due = plans.filter((x) => x.plan && x.plan.action !== "none");
  if (!due.length) {
    return json(200, { mode: "offers", dry_run: dryRun, today, periods: list.length, reminded, closed, sent, failed, skipped_pref_off: prefOff, skipped_no_email: noEmail, results });
  }

  // Recipients, read once with the service role so RLS cannot silently hide a
  // row: linked accounts (person_id -> email) for the reminder, scheduler /
  // admin accounts for the close summary, and the schedule_updates_email flag.
  const [profiles, schedProfiles, prefRows] = await Promise.all([
    rest("user_profiles?select=person_id,email&person_id=not.is.null"),
    rest("user_profiles?select=person_id,email,role&role=in.(scheduler,admin)"),
    rest("notification_preferences?select=person_id,schedule_updates_email"),
  ]);
  const prefsById: Record<string, any> = {};
  for (const p of (Array.isArray(prefRows) ? prefRows : [])) if (p?.person_id) prefsById[String(p.person_id)] = p;
  const emailById: Record<string, string | null> = {};
  for (const row of (Array.isArray(profiles) ? profiles : [])) {
    const pid = String(row.person_id);
    const email = typeof row.email === "string" && row.email.trim() ? row.email.trim() : null;
    if (!(pid in emailById) || (!emailById[pid] && email)) emailById[pid] = email;
  }
  // Scheduler / admin accounts, keyed by person_id (an unlinked admin account is
  // keyed by its role - a key, never an address, reaches the response). One
  // entry per key: a second account for the same key only upgrades a missing
  // address in place, so the response never shows one key twice.
  const schedulers: { key: string; pid: string | null; email: string | null }[] = [];
  for (const row of (Array.isArray(schedProfiles) ? schedProfiles : [])) {
    const pid = row.person_id ? String(row.person_id) : null;
    const email = typeof row.email === "string" && row.email.trim() ? row.email.trim() : null;
    const key = pid || `unlinked-${row.role}`;
    const cur = schedulers.find((s) => s.key === key);
    if (cur) { if (!cur.email && email) cur.email = email; continue; }
    schedulers.push({ key, pid, email });
  }
  const optedOut = (pid: string | null) => !!(pid && prefsById[pid] && prefsById[pid].schedule_updates_email === false);

  for (const { period, plan } of due) {
    const t = otmTimeline(period, blob.rules);
    // The effective reminder offsets (days before the close, largest first) for the mail's footer.
    const remindDays: number[] = t.remind_on.map((d: string) => otmDaysBetween(d, t.offers_close_at)).sort((a: number, b: number) => b - a);
    const offers = await rest(`call_offers?select=person_id,day,role_pref&day=gte.${t.start_day}&day=lte.${t.end_day}`);
    const roll = otmRollcall(period, Array.isArray(offers) ? offers : [], poolIds);
    const recipients: { person_id: string; status: string }[] = [];
    const entry: any = { period: period.label, id: period.id, action: plan.action, reason: plan.reason, days_to_close: plan.days_to_close, offers_close_at: plan.offers_close_at, rollcall: roll, recipients };
    results.push(entry);

    if (plan.action === "remind") {
      reminded++;
      const targets = roll.filter((r) => r.status === "not_started").map((r) => r.id);
      console.log(`[daily-reminder] offers: ${period.label} reminder day (${plan.reason}) -> not_started: ${targets.join(",") || "(nobody)"}`);
      for (const pid of targets) {
        if (optedOut(pid)) { prefOff++; recipients.push({ person_id: pid, status: "skipped_pref_off" }); continue; }
        const email = emailById[pid] || null;
        if (!email) { noEmail++; recipients.push({ person_id: pid, status: "skipped_no_email" }); continue; }
        const { subject, html } = buildOffersReminder(nameOf(pid), { label: period.label, start_day: t.start_day, end_day: t.end_day, offers_close_at: t.offers_close_at, days_to_close: plan.days_to_close, remind_days: remindDays });
        if (dryRun) { recipients.push({ person_id: pid, status: "dry_run_composed" }); continue; }
        const r = await sendEmail(email, subject, html, `mode=offers reminder period=${period.id} person=${pid}`);
        if (r.ok) { sent++; recipients.push({ person_id: pid, status: "sent" }); }
        else { failed++; recipients.push({ person_id: pid, status: `failed_${r.status}` }); }
      }
      continue;
    }

    // plan.action === "close": flip the row first (compare-and-swap on status),
    // then the audit row, then the summary. A dry run does none of the writes.
    let periodStatus = "unchanged_dry_run";
    entry.audit = "skipped_dry_run";
    if (!dryRun) {
      const rows = await rest(`call_periods?id=eq.${period.id}&status=eq.upcoming`, {
        method: "PATCH", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ status: "closed", updated_at: new Date().toISOString() }),
      });
      if (!Array.isArray(rows) || rows.length === 0) {
        // Somebody (the app's "Close now", or a parallel run) closed it first.
        entry.period_status = "already_closed";
        entry.audit = "skipped_already_closed";
        console.log(`[daily-reminder] offers: ${period.label} was no longer upcoming at the CAS - nothing sent`);
        continue;
      }
      closed++;
      periodStatus = "closed";
      try {
        await rest("audit_log", {
          method: "POST", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            actor_id: "cron", actor_name: "daily-reminder (offers)", action: "period.close",
            detail: { period_id: period.id, label: period.label, offers_close_at: plan.offers_close_at, today, rollcall: roll },
          }),
        });
        entry.audit = "inserted";
      } catch (e) {
        entry.audit = `failed: ${(e as Error).message}`;
        console.error(`[daily-reminder] offers: audit_log insert failed for ${period.label}: ${(e as Error).message}`);
      }
    }
    entry.period_status = periodStatus;
    console.log(`[daily-reminder] offers: ${period.label} ${plan.reason} -> ${periodStatus}; summary to ${schedulers.length} scheduler/admin account(s)`);
    // The roll call is unconditional for the scheduler / admin accounts: it is
    // an operational notice to whoever runs the period (the row has just been
    // flipped to closed), not a schedule update, so schedule_updates_email is
    // not consulted here - a period must never close with nobody told. Only
    // a missing address skips an account (reported as skipped_no_email).
    for (const s of schedulers) {
      if (!s.email) { noEmail++; recipients.push({ person_id: s.key, status: "skipped_no_email" }); continue; }
      const { subject, html } = buildOffersClosed(s.pid ? nameOf(s.pid) : "scheduler", { label: period.label, start_day: t.start_day, end_day: t.end_day, offers_close_at: t.offers_close_at }, roll, nameOf, dryRun ? "closed (dry run - not written)" : periodStatus);
      if (dryRun) { recipients.push({ person_id: s.key, status: "dry_run_composed" }); continue; }
      const r = await sendEmail(s.email, subject, html, `mode=offers closed period=${period.id} to=${s.key}`);
      if (r.ok) { sent++; recipients.push({ person_id: s.key, status: "sent" }); }
      else { failed++; recipients.push({ person_id: s.key, status: `failed_${r.status}` }); }
    }
  }

  console.log(`[daily-reminder] offers done: periods=${list.length} reminded=${reminded} closed=${closed} sent=${sent} failed=${failed} pref_off=${prefOff} no_email=${noEmail}`);
  return json(200, { mode: "offers", dry_run: dryRun, today, periods: list.length, reminded, closed, sent, failed, skipped_pref_off: prefOff, skipped_no_email: noEmail, results });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Cron-only gate, evaluated BEFORE anything else. Fail closed: no secret
  // configured means nobody gets in. Constant-time compare (Prompt 16 B5).
  const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
  if (!(await cronSecretMatches(req.headers.get("x-cron-secret"), CRON_SECRET))) {
    console.warn("[daily-reminder] rejected: missing/invalid x-cron-secret");
    return json(401, { error: "unauthorized" });
  }

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json(500, { error: "function misconfigured: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing" });
    if (!RESEND_API_KEY) return json(500, { error: "RESEND_API_KEY not configured" });
    if (!FROM_EMAIL) return json(500, { error: "NOTIFICATION_FROM_EMAIL not configured" });

    const body = await req.json().catch(() => ({}));
    if (body && "dryRun" in body && typeof body.dryRun !== "boolean") {
      return json(400, { error: "dryRun must be a boolean; nothing was sent" });
    }
    const dryRun: boolean = body?.dryRun === true;

    // Prompt 13 part 5c: mode "open-shifts" (the Monday cron) and Prompt 14
    // part 4: mode "offers" (the daily period-timeline cron) share the gate
    // and the dryRun contract above; everything below this block is the
    // hourly reminder, unchanged.
    const mode = body && body.mode !== undefined ? body.mode : "reminder";
    if (mode !== "reminder" && mode !== "open-shifts" && mode !== "offers") {
      return json(400, { error: `mode must be "reminder" (or omitted), "open-shifts" or "offers" (got ${JSON.stringify(mode).slice(0, 40)}); nothing was sent` });
    }
    if (mode === "open-shifts") return await runOpenShifts(centralNow(), dryRun);
    if (mode === "offers") return await runOffers(centralNow(), dryRun);

    const now = centralNow();
    const tomorrow = addDays(now.ymd, 1);
    console.log(`[daily-reminder] central=${now.ymd} ${now.weekday} ${pad(now.hour)}:00 tomorrow=${tomorrow} dryRun=${dryRun}`);

    const [rows, names] = await Promise.all([
      rest(`schedule_days?select=day,primary_id,backup_id,external_cover,note&day=eq.${tomorrow}`),
      loadRosterNames(),
    ]);
    const day = Array.isArray(rows) ? rows[0] : null;
    if (!day) {
      console.warn(`[daily-reminder] no schedule_days row for ${tomorrow}`);
      return json(200, { message: "no schedule row for tomorrow", date_tomorrow: tomorrow, current_hour: now.hour, on_call: 0, sent: 0 });
    }

    const nameOf = (id: string | null): string => (id ? (names[id] || id) : "OPEN");
    const primaryLabel = day.primary_id
      ? nameOf(day.primary_id)
      : (day.external_cover ? `${day.external_cover} (external cover)` : "OPEN");
    const backupLabel = nameOf(day.backup_id);

    const onCall: { person_id: string; role: "primary" | "backup"; otherLabel: string }[] = [];
    if (day.primary_id) onCall.push({ person_id: String(day.primary_id), role: "primary", otherLabel: backupLabel });
    if (day.backup_id) onCall.push({ person_id: String(day.backup_id), role: "backup", otherLabel: primaryLabel });
    console.log(`[daily-reminder] tomorrow on-call: ${onCall.map((o) => `${o.person_id}=${o.role}`).join(", ") || "(none)"}`);

    if (onCall.length === 0) {
      return json(200, { date_tomorrow: tomorrow, current_hour: now.hour, on_call: 0, sent: 0, results: [] });
    }

    // Prefs (person_id-keyed) + addresses (user_profiles by person_id). Both read
    // with the service role so RLS cannot silently hide a row.
    const ids = onCall.map((o) => o.person_id);
    const inList = `in.(${ids.map((s) => `"${s}"`).join(",")})`;
    const [prefRows, profiles] = await Promise.all([
      rest(`notification_preferences?select=*&person_id=${inList}`),
      rest(`user_profiles?select=person_id,email&person_id=${inList}`),
    ]);
    const prefsById: Record<string, any> = {};
    for (const p of (Array.isArray(prefRows) ? prefRows : [])) if (p?.person_id) prefsById[p.person_id] = p;
    const emailById: Record<string, string | null> = {};
    for (const row of (Array.isArray(profiles) ? profiles : [])) {
      const pid = String(row.person_id);
      const email = typeof row.email === "string" && row.email.trim() ? row.email.trim() : null;
      if (!(pid in emailById) || (!emailById[pid] && email)) emailById[pid] = email;
    }

    const dayLabel = fmtDay(tomorrow);
    const results: { person_id: string; role: string; status: string; user_hour?: number }[] = [];
    let sent = 0, failed = 0, wrongHour = 0, off = 0, noEmail = 0;

    for (const o of onCall) {
      const pref = prefsById[o.person_id] || {};
      const userHour = typeof pref.reminder_hour_central === "number" ? pref.reminder_hour_central : DEFAULT_REMINDER_HOUR;
      if (userHour !== now.hour) {
        wrongHour++;
        results.push({ person_id: o.person_id, role: o.role, status: "skipped_wrong_hour", user_hour: userHour });
        continue;
      }
      if (pref.shift_reminders_email === false) {
        off++;
        results.push({ person_id: o.person_id, role: o.role, status: "skipped_off" });
        continue;
      }
      const email = emailById[o.person_id] || null;
      if (!email) {
        noEmail++;
        console.warn(`[daily-reminder] ${o.person_id} has no linked account email - reminder skipped`);
        results.push({ person_id: o.person_id, role: o.role, status: "skipped_no_email" });
        continue;
      }
      const { subject, html } = buildReminder({
        name: nameOf(o.person_id), role: o.role, dayLabel, otherLabel: o.otherLabel, note: day.note || null,
      });
      if (dryRun) {
        results.push({ person_id: o.person_id, role: o.role, status: "dry_run_composed" });
        continue;
      }
      const r = await sendEmail(email, subject, html, `person=${o.person_id} role=${o.role}`);
      if (r.ok) { sent++; results.push({ person_id: o.person_id, role: o.role, status: "sent" }); }
      else { failed++; results.push({ person_id: o.person_id, role: o.role, status: `failed_${r.status}` }); }
    }

    console.log(`[daily-reminder] done: sent=${sent} failed=${failed} wrong_hour=${wrongHour} off=${off} no_email=${noEmail} (hour=${now.hour})`);

    // Prompt 20 F3: FOLLOWERS. After the surgeons' reminders (which stand whatever happens here): every viewer /
    // coordinator account following a surgeon on call tomorrow gets the day-before reminder worded for a third party -
    // one e-mail per followed surgeon, at HIS OWN reminder hour (else DEFAULT_REMINDER_HOUR), only while HIS OWN
    // shift_reminders_email is on (his prefs row is keyed by profile_id; select=* reads, so before revision o the list
    // is empty, never a 400). dryRun composes and sends nothing; the answer is `followers` (counts, tags, a sample line -
    // never an address). A failed read is followers.error, logged.
    let followersOut: any;
    try {
      const [fProfiles, fPrefRows] = await Promise.all([
        rest("user_profiles?select=*&role=in.(viewer,coordinator)"),
        rest("notification_preferences?select=*"),
      ]);
      const followers = followerIndex(fProfiles, fPrefRows);
      const plan = followerReminderPlan(followers, onCall, now.hour, DEFAULT_REMINDER_HOUR);
      const fResults: { follower: string; surgeon: string; role: string; status: string; user_hour?: number }[] = [];
      let fSent = 0, fFailed = 0, fWrongHour = 0, fOff = 0, fNoEmail = 0;
      let sample: { subject: string; line: string } | null = null;
      for (const e of plan) {
        const line = followerReminderLine(nameOf(e.surgeon), e.role, tomorrow, e.otherLabel);
        const { subject, html } = buildFollowerReminder({ name: e.name, surgeonName: nameOf(e.surgeon), role: e.role, line, dayLabel, note: day.note || null });
        if (!sample) sample = { subject, line };
        if (e.status === "skipped_wrong_hour") { fWrongHour++; fResults.push({ follower: e.follower, surgeon: e.surgeon, role: e.role, status: e.status, user_hour: e.user_hour }); continue; }
        if (e.status === "skipped_off") { fOff++; fResults.push({ follower: e.follower, surgeon: e.surgeon, role: e.role, status: e.status }); continue; }
        if (e.status === "skipped_no_email") { fNoEmail++; fResults.push({ follower: e.follower, surgeon: e.surgeon, role: e.role, status: e.status }); continue; }
        if (dryRun) { fResults.push({ follower: e.follower, surgeon: e.surgeon, role: e.role, status: "dry_run_composed" }); continue; }
        const r = await sendEmail(e.email, subject, html, `follower=${e.follower} surgeon=${e.surgeon} role=${e.role}`);
        if (r.ok) { fSent++; fResults.push({ follower: e.follower, surgeon: e.surgeon, role: e.role, status: "sent" }); }
        else { fFailed++; fResults.push({ follower: e.follower, surgeon: e.surgeon, role: e.role, status: `failed_${r.status}` }); }
      }
      followersOut = {
        accounts: followers.length, planned: plan.length, sent: fSent, failed: fFailed,
        skipped_wrong_hour: fWrongHour, skipped_off: fOff, skipped_no_email: fNoEmail,
        results: fResults, sample: sample,
      };
      console.log(`[daily-reminder] followers: accounts=${followers.length} planned=${plan.length} sent=${fSent} failed=${fFailed} wrong_hour=${fWrongHour} off=${fOff} no_email=${fNoEmail}`);
    } catch (e) {
      const why = redactAddresses(e instanceof Error ? e.message : String(e));
      console.error(`[daily-reminder] followers: ${why}`);
      followersOut = { error: why };
    }

    return json(200, {
      date_tomorrow: tomorrow, current_hour: now.hour, dry_run: dryRun,
      on_call: onCall.length, sent, failed,
      skipped_wrong_hour: wrongHour, skipped_off: off, skipped_no_email: noEmail,
      results,
      followers: followersOut,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[daily-reminder] error: ${message}`);
    return json(e instanceof HttpError ? 502 : 500, { error: message, upstream_status: e instanceof HttpError ? e.status : undefined });
  }
});
