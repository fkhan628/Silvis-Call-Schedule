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
//   6. PHONE PUSH (revision z, Faraz 10/20 - decisions D8-D16 of the push
//      follow-ups report; v10 on base v9 - prepared, NOT deployed; README
//      section 3 "Deploy record - push reminders (revision z)"). After the
//      follower e-mails, in its OWN try (a push failure never changes the
//      e-mail answer): the same day-before reminder goes to the phones of the
//      person on call tomorrow at HIS reminder hour, and of every follower of
//      that surgeon at HIS OWN hour (one notice per followed surgeon on call),
//      on the one switch shift_reminders_push (notification_preferences,
//      revision z; only an explicit false is off - a missing row or key is
//      on; independent of shift_reminders_email and of an address). Web Push
//      with VAPID through send-notification's own '@webPush' / '@pushPlan'
//      blocks and its device glue, copied here BYTE FOR BYTE (no shared
//      module; test/edge-functions.test.js pins every copy identical to
//      send-notification's, which is not changed); the reminder's own
//      decisions are the plain-JS '@reminderPush' block. One notice per role:
//      tag silvis-reminder-<yyyymmdd>-<role>, a tap opens My schedule
//      (myschedule); a person reads "Tomorrow (Wed 10/21) you are on Silvis
//      primary call, 07:00 to 07:00 - backup Khan.", a follower the e-mail's
//      followerReminderLine under "Silvis Call (following Dr. X)". 404 / 410
//      deletes the device row; any other failure bumps fail_count /
//      last_error_at (never deleted, never retried); a device in both roles
//      (a follower of both surgeons) is read by the second role as the first
//      left it - a 404 / 410 row is not sent to again. The answer gains `push`
//      (counts, roster ids, follower tags and the notification tags - never
//      an endpoint, a key or the words); push.error says why it did not run
//      (`push not configured` without the VAPID secrets, `push_subscriptions
//      unavailable: ...` without the table) - the e-mail is unaffected either
//      way. dryRun: the plan and a device count (select=id,profile_id - no
//      endpoint is read); nothing is sent or written. The modes open-shifts
//      and offers do not push (D8).
//
// Dropped from Davenport on purpose: OneSignal (send-push does not exist in
// the Silvis project - the reminder's phone push is Silvis's own Web Push, 6.
// above), APP shifts / "APP on call with you" / "No APP
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
// the heads-up before the freeze (Prompt 26, Faraz 9/30 - "vacations in,
// painting optional"): "Silvis call - the <label> schedule is built from your
// rules on <Mon 11/23>" / "Before <freeze>, enter your vacations for <label> in
// the app. If there are days you'd like to work, or can't, paint them too.
// Otherwise there is nothing to do - the schedule follows your rules." It goes
// to EVERY pool surgeon whatever his offer status (submitted, rules_only,
// not_started - vacations matter for everyone); the last call (the smallest
// offset when there are 2+) says the same in one line with the days left; the
// office coordinators (role coordinator, unlinked) get a version worded for
// them on the FIRST (largest-offset) reminder only. The words, the audience
// and the close summary are the plain-JS @offersMail block (unit-tested by
// test/edge-functions.test.js). From offers_close_at on it flips the row to
// 'closed' (compare-and-swap on status = upcoming), writes the audit row
// period.close and e-mails the scheduler / admin accounts the roll call: who
// PAINTED DAYS (offered days inside the period, with the count), who ADDED
// VACATIONS (a time_off row overlapping the period, read with the service role
// for the period's range, ranges clipped to it), and everyone else as
// FOLLOWING THEIR RULES - never "missing" / "never answered". Addresses come
// from user_profiles with the service role; schedule_updates_email = false
// opts a surgeon (his row by person_id) or a coordinator (his row by
// profile_id) out of the heads-up, while the close roll call to the scheduler
// / admin accounts is unconditional (an operational notice, so a period never
// closes unseen); statuses are keyed by person_id (a coordinator by the tag
// "coordinator-<first 8 characters of his account id>" - never an address).
// It never generates or publishes and never writes call_offers or time_off.
// dryRun composes, sends nothing, writes nothing.
//
// Secrets (by NAME): CRON_SECRET, RESEND_API_KEY, NOTIFICATION_FROM_EMAIL
// (required - no hardcoded fallback sender); VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY, VAPID_SUBJECT (revision z, the reminder's phone push -
// the project-wide pair setup-push-keys.sh set for send-notification on
// 2026-10-03; missing / malformed = no push, the e-mail unaffected; the
// private key never reaches a response or a log); SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.
//
// Deploy: supabase functions deploy daily-reminder --workdir <linked dir> --project-ref bzhsroegtagqhutbnsrp --no-verify-jwt --use-api

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = Deno.env.get("NOTIFICATION_FROM_EMAIL") || "";
// revision z: the reminder's phone push reads the project-wide VAPID pair - the same lines as send-notification's
// Prompt 30 phone push: the VAPID pair (web-push formats: the public key = base64url of the 65-byte uncompressed P-256
// point, the private key = base64url of the 32-byte scalar) and the subject (the app's https URL - no address)
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "";

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

// ---------------------------------------------------------------------------
// Phone push (revision z, Faraz 10/20 - the day-before reminder on the phone). send-notification's two plain-JavaScript
// blocks, copied here BYTE FOR BYTE (no shared module - the house pattern): '@webPush' is the transport (RFC 8291
// aes128gcm in one RFC 8188 record + an RFC 8292 VAPID ES256 token), '@pushPlan' the switch, the payload, whom, the
// bounded send loop and the answer object. test/edge-functions.test.js lifts each block from both files and checks
// them identical (as @logRedact / @followers / @cronSecret); a change goes into send-notification first, then here.
// ---------------------------------------------------------------------------
// @webPush-start
const WP_RS = 4096;
// RFC 8291 section 4 / RFC 8030 section 7.2: the whole BODY - the 86-byte header (salt 16 | rs 4 | idlen 1 | key 65) plus the
// record (plaintext | 0x02 | 16-byte tag) - stays within the 4096 bytes every push service must accept: 3993 plaintext bytes
// at most (review 10/3; pushPayload's 3072-byte cap keeps every real payload far below it).
const WP_MAX_BODY = 4096;
const WP_HEADER_LEN = 86;
const WP_TTL = "259200";
// Uint8Array -> base64url without padding (a byte loop - never a spread, which overflows the call stack on large input)
function wpB64uEncode(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
// base64url (padding optional) -> Uint8Array; any other character throws
function wpB64uDecode(text) {
  const t = String(text == null ? "" : text);
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(t)) throw new Error("not base64url");
  const body = t.replace(/=+$/, "");
  if (body.length % 4 === 1) throw new Error("not base64url");
  const s = atob(body.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((body.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function wpConcat(...parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
function wpText(s) { return new TextEncoder().encode(s); }
async function wpHmac(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, dataBytes));
}
// HKDF-SHA-256 (RFC 5869): extract, then ONE expand block - every length here is at most 32
async function wpHkdf(salt, ikm, info, length) {
  if (!(length > 0 && length <= 32)) throw new Error("wpHkdf: length must be 1-32");
  const prk = await wpHmac(salt, ikm);
  const okm = await wpHmac(prk, wpConcat(info, new Uint8Array([1])));
  return okm.slice(0, length);
}
// RFC 8291 + RFC 8188 aes128gcm, ONE record: plaintext || 0x02 (the last-record delimiter), rs 4096,
// header = salt (16) | rs (4, big-endian) | idlen (1) = 65 | as_public (65).
// key_info = "WebPush: info" 0x00 | ua_public | as_public; IKM = HKDF(auth, ecdh, key_info, 32);
// CEK = HKDF(salt, IKM, "Content-Encoding: aes128gcm" 0x00, 16); NONCE = HKDF(salt, IKM, "Content-Encoding: nonce" 0x00, 12).
// opts (tests only): { asPublicB64u, asPrivateB64u, saltB64u } - otherwise a fresh ECDH P-256 pair and 16 random bytes.
async function wpEncrypt(plaintextBytes, uaPublicB64u, authB64u, opts) {
  const o = opts || {};
  const ua = wpB64uDecode(uaPublicB64u);
  if (ua.length !== 65 || ua[0] !== 4) throw new Error("the subscription key is not an uncompressed P-256 point");
  const auth = wpB64uDecode(authB64u);
  if (auth.length !== 16) throw new Error("the subscription auth secret is not 16 bytes");
  const plain = plaintextBytes instanceof Uint8Array ? plaintextBytes : new Uint8Array(plaintextBytes);
  if (WP_HEADER_LEN + plain.length + 1 + 16 > WP_MAX_BODY || plain.length + 1 + 16 > WP_RS) throw new Error("the payload does not fit one record (3993 bytes at most)");
  let asPublic, asPrivate;
  if (o.asPublicB64u && o.asPrivateB64u) {
    asPublic = wpB64uDecode(o.asPublicB64u);
    const jwk = { kty: "EC", crv: "P-256", x: wpB64uEncode(asPublic.slice(1, 33)), y: wpB64uEncode(asPublic.slice(33, 65)), d: wpB64uEncode(wpB64uDecode(o.asPrivateB64u)), ext: true };
    asPrivate = await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  } else {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    asPrivate = pair.privateKey;
  }
  const uaKey = await crypto.subtle.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPrivate, 256));
  const keyInfo = wpConcat(wpText("WebPush: info"), new Uint8Array([0]), ua, asPublic);
  const ikm = await wpHkdf(auth, ecdh, keyInfo, 32);
  const salt = o.saltB64u ? wpB64uDecode(o.saltB64u) : crypto.getRandomValues(new Uint8Array(16));
  if (salt.length !== 16) throw new Error("the salt is not 16 bytes");
  const cek = await wpHkdf(salt, ikm, wpConcat(wpText("Content-Encoding: aes128gcm"), new Uint8Array([0])), 16);
  const nonce = await wpHkdf(salt, ikm, wpConcat(wpText("Content-Encoding: nonce"), new Uint8Array([0])), 12);
  const key = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, key, wpConcat(plain, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, WP_RS, false);
  header[20] = 65;
  return wpConcat(header, asPublic, sealed);
}
// The VAPID pair -> { publicB64u, key } (an ECDSA P-256 signing key). A malformed pair throws, and so does a pair whose
// halves do not belong together (a sign / verify self-check - every push service would refuse its tokens with 403).
async function wpVapidKey(publicB64u, privateB64u) {
  const pub = wpB64uDecode(publicB64u);
  const d = wpB64uDecode(privateB64u);
  if (pub.length !== 65 || pub[0] !== 4 || d.length !== 32) throw new Error("the VAPID key pair is malformed");
  const jwk = { kty: "EC", crv: "P-256", x: wpB64uEncode(pub.slice(1, 33)), y: wpB64uEncode(pub.slice(33, 65)), d: wpB64uEncode(d), ext: true };
  let key, verifyKey;
  try {
    // some WebCrypto implementations refuse an inconsistent JWK here (Node), others accept it (the self-check below decides)
    key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    verifyKey = await crypto.subtle.importKey("raw", pub, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  } catch (e) {
    throw new Error("the VAPID key pair does not match");
  }
  const probe = wpText("silvis-vapid-self-check");
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, probe);
  if (!(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifyKey, sig, probe))) throw new Error("the VAPID key pair does not match");
  return { publicB64u: wpB64uEncode(pub), key: key };
}
// RFC 8292: b64u({"typ":"JWT","alg":"ES256"}) . b64u({"aud","exp","sub"}) . b64u(raw r || s) - exp 12 hours ahead
// (push services refuse more than 24); WebCrypto's ECDSA signature is already the raw 64-byte r || s
async function wpVapidJwt(audience, subject, vapidKey, nowSec) {
  const enc = function (obj) { return wpB64uEncode(wpText(JSON.stringify(obj))); };
  const unsigned = enc({ typ: "JWT", alg: "ES256" }) + "." + enc({ aud: audience, exp: Math.floor(nowSec) + 43200, sub: subject });
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, vapidKey.key, wpText(unsigned)));
  return unsigned + "." + wpB64uEncode(sig);
}
// One push request: aud = the endpoint's ORIGIN; jwtCache (a Map origin -> token) keeps one token per push service per send
async function wpRequest(sub, payloadText, vapidKey, subject, nowSec, jwtCache) {
  const aud = new URL(sub.endpoint).origin;
  let jwt = jwtCache ? jwtCache.get(aud) : undefined;
  if (!jwt) {
    jwt = wpVapidJwt(aud, subject, vapidKey, nowSec);
    if (jwtCache) jwtCache.set(aud, jwt);
  }
  jwt = await jwt;
  const body = await wpEncrypt(wpText(payloadText), sub.p256dh, sub.auth);
  return {
    url: sub.endpoint,
    init: {
      method: "POST",
      headers: { Authorization: "vapid t=" + jwt + ", k=" + vapidKey.publicB64u, "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: WP_TTL, Urgency: "high" },
      body: body,
    },
  };
}
// @webPush-end

// @pushPlan-start
// the views a tap may open (identical literal in helpers.js and sw.js - the tests pin all three against the contract)
const PUSH_TABS = ["calendar", "openshifts", "myschedule", "timeoff", "settings", "setup"];
const PUSH_PREF_OF = { schedule_published: "schedule_updates_push", manual_edit: "schedule_updates_push", vacation_logged: "schedule_updates_push",
  open_shifts: "schedule_updates_push", shift_claimed: "schedule_updates_push", offers_reminder: "schedule_updates_push", offers_closed: "schedule_updates_push",
  trade_proposed: "trade_updates_push", trade_accepted: "trade_updates_push", trade_declined: "trade_updates_push", trade_applied: "trade_updates_push" };
// the database's endpoint check (push_subscriptions_endpoint_shape): https on a known push service only - the function
// POSTs to whatever is stored, so a free-form endpoint would be a server-side request forgery lever
const PUSH_ENDPOINT_RE = /^https:\/\/([a-z0-9-]+\.)*(fcm\.googleapis\.com|android\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com)\/[!-~]*$/;
const PUSH_TTL_SECONDS = 259200, PUSH_MAX_BODY = 180, PUSH_CONCURRENCY = 6, PUSH_TIMEOUT_MS = 8000;
const PUSH_MAX_PAYLOAD_BYTES = 3072;
const PUSH_TITLE = "Silvis Call";
const PUSH_TEST_BODY = "Test - phone notifications reach this device.";
const PUSH_NOT_CONFIGURED = "push not configured";
const PUSH_NOT_SET_UP = "phone notifications are not set up on the server yet";
const PUSH_TAB_OF = { schedule_published: "calendar", manual_edit: "calendar", vacation_logged: "timeoff", open_shifts: "openshifts",
  shift_claimed: "calendar", offers_reminder: "timeoff", offers_closed: "setup", test: "settings" };
// the category's push switch, or null (test, shift_reminder and anything unknown never push)
function pushPrefOf(type) {
  return Object.prototype.hasOwnProperty.call(PUSH_PREF_OF, type) ? PUSH_PREF_OF[type] : null;
}
// only an explicit false is off; a missing row or key is on (as on the e-mail side) - only the push key is ever read
function pushEnabled(prefKey, prefs) {
  if (!prefKey) return true;
  return !(prefs && typeof prefs === "object" && prefs[prefKey] === false);
}
function pushEndpointAllowed(endpoint) {
  return typeof endpoint === "string" && endpoint.length <= 2048 && PUSH_ENDPOINT_RE.test(endpoint);
}
// the secrets' shapes (web-push formats); the pair itself is checked by wpVapidKey's self-check
function pushVapidConfigOk(publicKey, privateKey, subject) {
  return typeof publicKey === "string" && /^B[A-Za-z0-9_-]{86}$/.test(publicKey)
    && typeof privateKey === "string" && /^[A-Za-z0-9_-]{43}$/.test(privateKey)
    && typeof subject === "string" && /^(https:\/\/|mailto:)\S+$/.test(subject);
}
// "YYYY-MM-DD" that names a real calendar day, else null
function pushIsoDay(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof v === "string" ? v : "");
  if (!m) return null;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return dt.getUTCFullYear() === Number(m[1]) && dt.getUTCMonth() === Number(m[2]) - 1 && dt.getUTCDate() === Number(m[3]) ? v : null;
}
// the day a tap opens: the edited day (manual_edit) or the claimed day (shift_claimed); every other category none
function pushDayOf(type, data) {
  if (type !== "manual_edit" && type !== "shift_claimed") return null;
  return pushIsoDay(data && typeof data === "object" ? data.day : null);
}
// the first non-empty line of the composed e-mail text, whitespace collapsed, addresses redacted, at most 180
// characters ("..." when cut); nothing left -> the category's frame title
function pushBodyOf(type, data, frameTitleText) {
  const msg = data && typeof data === "object" && typeof data.message === "string" ? data.message : "";
  const first = msg.split(/\r?\n/).map(function (l) { return l.replace(/\s+/g, " ").trim(); }).find(function (l) { return l !== ""; }) || "";
  let body = redactAddresses(first).replace(/\s+/g, " ").trim();
  if (!body) body = String(frameTitleText || PUSH_TITLE).trim() || PUSH_TITLE;
  const chars = Array.from(body);
  if (chars.length > PUSH_MAX_BODY) body = chars.slice(0, PUSH_MAX_BODY - 3).join("").replace(/\s+$/, "") + "...";
  return body;
}
// the notification tag: a later notice with the same tag replaces the earlier one on the phone (a trade's notices
// replace each other; vacations never do). Always matches sw.js's /^silvis-[a-z0-9-]{1,60}$/.
function pushTagOf(type, data, nowMs) {
  const d = data && typeof data === "object" ? data : {};
  const day = pushDayOf(type, d);
  const compact = day ? day.replace(/-/g, "") : "";
  if (pushPrefOf(type) === "trade_updates_push") {
    const id = typeof d.trade_id === "string" ? d.trade_id.trim().toLowerCase() : "";
    return /^[0-9a-f]{8}/.test(id) ? "silvis-trade-" + id.slice(0, 8) : "silvis-trade";
  }
  switch (type) {
    case "schedule_published": return "silvis-published";
    case "manual_edit": return compact ? "silvis-edit-" + compact : "silvis-edit";
    case "vacation_logged": return "silvis-vacation-" + Math.floor(typeof nowMs === "number" ? nowMs : Date.now()).toString(36);
    case "open_shifts": return "silvis-open-shifts";
    case "shift_claimed": {
      const role = d.role === "primary" || d.role === "backup" ? d.role : "";
      return compact ? "silvis-claimed-" + compact + (role ? "-" + role : "") : "silvis-claimed";
    }
    case "offers_reminder": return "silvis-offers";
    case "offers_closed": return "silvis-offers-closed";
    case "test": return "silvis-test";
    default: return "silvis-generic";
  }
}
// the view a tap opens: a trade opens Time off (a follower's opens his Following view - a viewer's Time off has no
// trade card); always one of PUSH_TABS
function pushTabOf(type, isFollower) {
  if (pushPrefOf(type) === "trade_updates_push") return isFollower ? "myschedule" : "timeoff";
  const t = Object.prototype.hasOwnProperty.call(PUSH_TAB_OF, type) ? PUSH_TAB_OF[type] : "calendar";
  return PUSH_TABS.indexOf(t) >= 0 ? t : "calendar";
}
// the ONLY payload shape sw.js accepts: { v: 1, title, body, tag, tab, params? } - never a url key, never an address.
// recipient { kind: "person" | "follower" | "self", followedNames }; a follower's title names whom he follows (the
// body is the surgeon's wording); "self" is the POST ?push=test notice.
function pushPayload(type, data, recipient, frameTitleText, nowMs) {
  const r = recipient && typeof recipient === "object" ? recipient : { kind: "person" };
  const self = r.kind === "self";
  const follower = r.kind === "follower";
  let title = PUSH_TITLE;
  if (follower) {
    const names = (Array.isArray(r.followedNames) ? r.followedNames : []).filter(function (n) { return typeof n === "string" && n.trim() !== ""; }).map(function (n) { return "Dr. " + n.trim(); });
    if (names.length) {
      const full = PUSH_TITLE + " (following " + names.join(" and ") + ")";
      title = full.length <= 80 ? full : PUSH_TITLE + " (following " + names.length + " surgeons)";
    }
  }
  const body = self ? PUSH_TEST_BODY : pushBodyOf(type, data, frameTitleText);
  const tag = self ? "silvis-test" : pushTagOf(type, data, nowMs);
  const tab = self ? "settings" : pushTabOf(type, follower);
  const day = self ? null : pushDayOf(type, data);
  const out = day ? { v: 1, title: title, body: body, tag: tag, tab: tab, params: { day: day } } : { v: 1, title: title, body: body, tag: tag, tab: tab };
  if (new TextEncoder().encode(JSON.stringify(out)).length > PUSH_MAX_PAYLOAD_BYTES) out.body = PUSH_TITLE;
  return out;
}
// whom a send pushes to: every audience person (his account ids) and every follower of the notice (his account id),
// first come first served per account id, on the PUSH switch only (an explicit false -> skipped_pref_off, devices
// never read). audience = resolveRecipients' persons BEFORE the e-mail filter; followersAll = followerRecipients(...,
// null).list with each follower's own prefs row and followed names.
function pushTargets(audience, followersAll, prefKey) {
  const targets = [], skipped = [], seen = {};
  const claim = function (ids) {
    const out = [];
    (Array.isArray(ids) ? ids : []).forEach(function (id) { const k = id == null ? "" : String(id); if (k && !seen[k]) { seen[k] = true; out.push(k); } });
    return out;
  };
  (Array.isArray(audience) ? audience : []).forEach(function (p) {
    if (!p || typeof p !== "object" || p.person_id == null || String(p.person_id) === "") return;
    const key = String(p.person_id);
    const ids = Array.isArray(p.profileIds) ? p.profileIds.map(String) : [];
    if (!pushEnabled(prefKey, p.prefs)) { claim(ids); skipped.push({ key: key, kind: "person", status: "skipped_pref_off" }); return; }
    const mine = claim(ids);
    if (ids.length && !mine.length) return;
    targets.push({ key: key, kind: "person", profileIds: mine });
  });
  (Array.isArray(followersAll) ? followersAll : []).forEach(function (f) {
    if (!f || typeof f !== "object" || !f.id) return;
    const key = String(f.tag || String(f.id).slice(0, 8));
    const via = Array.isArray(f.via) ? f.via.slice() : [];
    if (!pushEnabled(prefKey, f.prefs)) { claim([f.id]); skipped.push({ key: key, kind: "follower", via: via, status: "skipped_pref_off" }); return; }
    const mine = claim([f.id]);
    if (!mine.length) return;
    targets.push({ key: key, kind: "follower", profileIds: mine, via: via, followedNames: Array.isArray(f.followedNames) ? f.followedNames.slice() : [] });
  });
  return { targets: targets, skipped: skipped };
}
// a push service's answer: 2xx sent; 404 / 410 gone (the subscription is dead - its row is deleted); anything else failed
function pushOutcome(status) {
  const s = Number(status);
  if (s >= 200 && s < 300) return "sent";
  if (s === 404 || s === 410) return "gone";
  return "failed";
}
// any http(s) URL -> "<url>" (a push service's error text may quote the device's endpoint)
function redactEndpoints(text) {
  return String(text == null ? "" : text).replace(/https?:\/\/[^\s"'<>)\]]+/gi, "<url>");
}
// The send loop. send(sub, payloadText) -> Promise<{ status, body? }> (the handler's: wpRequest + fetch); at most
// opts.concurrency (<= PUSH_CONCURRENCY) devices in flight, each bounded by opts.timeoutMs (PUSH_TIMEOUT_MS); a device
// whose endpoint is not a known push service is never fetched (failed, status 0). One log line per device that was not
// sent: the target key, the row id's first 8 characters, the status and 80 characters of the answer with every URL
// and address redacted. Never a retry.
// -> { recipients: [{ key, kind, via?, status }], okIds, goneIds, failedRows: [{ id, fail_count }], devices: { sent, failed, removed } }
async function pushDeliver(targets, subsByProfile, payloadFor, send, opts) {
  const o = opts || {};
  const limit = Math.max(1, Math.min(PUSH_CONCURRENCY, Math.floor(Number(o.concurrency)) || PUSH_CONCURRENCY));
  const timeoutMs = Number(o.timeoutMs) > 0 ? Number(o.timeoutMs) : PUSH_TIMEOUT_MS;
  const log = typeof o.log === "function" ? o.log : function (line) { console.error(line); };
  const recipients = [], okIds = [], goneIds = [], failedRows = [], states = [], jobs = [];
  const devices = { sent: 0, failed: 0, removed: 0 };
  (Array.isArray(targets) ? targets : []).forEach(function (t) {
    const subs = [];
    (Array.isArray(t.profileIds) ? t.profileIds : []).forEach(function (pid) {
      const own = subsByProfile && Array.isArray(subsByProfile[pid]) ? subsByProfile[pid] : [];
      own.forEach(function (s) { subs.push(s); });
    });
    const rec = Array.isArray(t.via) ? { key: t.key, kind: t.kind, via: t.via.slice(), status: "skipped_no_device" } : { key: t.key, kind: t.kind, status: "skipped_no_device" };
    recipients.push(rec);
    if (!subs.length) return;
    let text = null;
    try { const p = payloadFor(t); text = typeof p === "string" ? p : JSON.stringify(p); } catch (e) { text = null; }
    const state = { rec: rec, sent: 0, gone: 0, failed: 0 };
    states.push(state);
    subs.forEach(function (s) { jobs.push({ t: t, s: s, text: text, state: state }); });
  });
  async function one(job) {
    const s = job.s;
    let status = 0, answer = "";
    if (job.text == null) answer = "no payload";
    else if (!pushEndpointAllowed(s && s.endpoint)) answer = "endpoint not on a known push service - not sent";
    else {
      let timer = null;
      try {
        const r = await Promise.race([
          Promise.resolve().then(function () { return send(s, job.text); }),
          new Promise(function (resolve) { timer = setTimeout(function () { resolve({ status: 0, body: "no answer within " + timeoutMs + " ms" }); }, timeoutMs); }),
        ]);
        status = r && typeof r.status === "number" ? r.status : 0;
        answer = r && r.body != null ? String(r.body) : "";
      } catch (e) {
        status = 0;
        answer = e && e.message ? String(e.message) : String(e);
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
    }
    const outcome = pushOutcome(status);
    const id = s && s.id != null ? String(s.id) : "";
    if (outcome === "sent") { devices.sent++; job.state.sent++; okIds.push(id); }
    else if (outcome === "gone") { devices.removed++; job.state.gone++; goneIds.push(id); }
    else { devices.failed++; job.state.failed++; failedRows.push({ id: id, fail_count: (Number(s && s.fail_count) || 0) + 1 }); }
    if (outcome !== "sent") log("[push] " + job.t.key + " device=" + id.slice(0, 8) + " status=" + status + " " + redactEndpoints(redactAddresses(answer)).slice(0, 80));
  }
  let next = 0;
  async function worker() {
    while (next < jobs.length) { const job = jobs[next++]; await one(job); }
  }
  const workers = [];
  for (let i = 0; i < Math.min(limit, jobs.length); i++) workers.push(worker());
  await Promise.all(workers);
  states.forEach(function (st) { st.rec.status = st.sent > 0 ? "sent" : (st.gone > 0 && st.failed === 0 ? "gone" : "failed"); });
  return { recipients: recipients, okIds: okIds, goneIds: goneIds, failedRows: failedRows, devices: devices };
}
// the response's push object: counts for every caller (targets: a surgeon by roster id, a follower by account;
// sent + failed + skipped_no_device + skipped_pref_off = targets; removed = devices answered 404 / 410), the
// per-recipient lists only for an admin / scheduler caller (whether a colleague has phone notifications on is personal)
function pushSummary(delivered, skipped, privileged) {
  const d = delivered && typeof delivered === "object" ? delivered : {};
  const recs = Array.isArray(d.recipients) ? d.recipients : [];
  const sk = Array.isArray(skipped) ? skipped : [];
  const dev = d.devices && typeof d.devices === "object" ? d.devices : {};
  const count = function (names) { return recs.filter(function (r) { return names.indexOf(r.status) >= 0; }).length; };
  const out = {
    sent: count(["sent"]), failed: count(["failed", "gone"]), removed: Number(dev.removed) || 0,
    skipped_no_device: count(["skipped_no_device"]), skipped_pref_off: sk.length,
    devices: { sent: Number(dev.sent) || 0, failed: Number(dev.failed) || 0, removed: Number(dev.removed) || 0 },
    error: null,
  };
  if (privileged) {
    const all = recs.concat(sk);
    out.results = all.filter(function (r) { return r.kind === "person"; }).map(function (r) { return { person_id: r.key, status: r.status }; });
    out.followers = all.filter(function (r) { return r.kind === "follower"; }).map(function (r) { return { follower: r.key, via: Array.isArray(r.via) ? r.via.slice() : [], status: r.status }; });
  }
  return out;
}
// push did not run (why in error); the e-mail answer is unaffected
function pushEmpty(error) {
  return { sent: 0, failed: 0, removed: 0, skipped_no_device: 0, skipped_pref_off: 0, devices: { sent: 0, failed: 0, removed: 0 }, error: error == null ? null : String(error) };
}
// @pushPlan-end

// The uuid shape send-notification's @sendGate block defines - the same line (pinned identical): the device glue below
// drops any account / row id that is not one before a filter is built.
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// send-notification's device glue (from the VAPID pair through pushBookkeeping), copied BYTE FOR BYTE between the two
// markers below (test/edge-functions.test.js compares this region with send-notification's own text).
// @pushGlue-copy-start
// The VAPID pair, imported once per isolate (null = missing / malformed / mismatched: no push, the e-mail unaffected).
let vapidCache: Promise<any> | null = null;
function vapidKeyPair(): Promise<any> {
  if (!vapidCache) {
    vapidCache = (async () => {
      if (!pushVapidConfigOk(VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT)) {
        console.warn("[push] the VAPID secrets are missing or malformed - phone notifications are off (names: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT)");
        return null;
      }
      try { return await wpVapidKey(VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY); }
      catch (e) { console.warn(`[push] the VAPID secrets do not import: ${(e as Error).message}`); return null; }
    })();
  }
  return vapidCache;
}

// a log-safe line from an error: every URL and address redacted
function pushLogSafe(e: unknown): string {
  return redactEndpoints(redactAddresses(e instanceof Error ? e.message : String(e))).slice(0, 200);
}

// The devices of these accounts (service role). Account ids are uuids; anything else is dropped before the filter.
async function readPushSubscriptions(profileIds: string[]): Promise<Record<string, any[]>> {
  const ids = Array.from(new Set(profileIds.map(String).filter((id) => UUID_SHAPE.test(id))));
  const byProfile: Record<string, any[]> = {};
  if (!ids.length) return byProfile;
  const rows = await rest(`push_subscriptions?select=id,profile_id,endpoint,p256dh,auth,fail_count&profile_id=in.(${ids.join(",")})`);
  for (const r of (Array.isArray(rows) ? rows : [])) {
    if (!r || !r.profile_id) continue;
    const k = String(r.profile_id);
    (byProfile[k] = byProfile[k] || []).push(r);
  }
  return byProfile;
}

// The send function pushDeliver calls: the encrypted request (@webPush) and one fetch, bounded at PUSH_TIMEOUT_MS.
// redirect: "manual" (review 10/3): a 3xx is a refusal (pushOutcome -> failed, fail_count + 1), never followed - a followed
// 307 / 308 would POST the body and the VAPID token to whatever Location names, past the PUSH_ENDPOINT_RE allowlist.
function pushSender(vapid: any, nowSec: number) {
  const jwtCache = new Map();
  return async (sub: any, payloadText: string) => {
    const r = await wpRequest(sub, payloadText, vapid, VAPID_SUBJECT, nowSec, jwtCache);
    const res = await fetch(r.url, { ...r.init, redirect: "manual", signal: AbortSignal.timeout(PUSH_TIMEOUT_MS) });
    const text = await res.text().catch(() => "");
    return { status: res.status, body: res.ok ? "" : text };
  };
}

// After the sends (service role, one request each, errors logged, never thrown, never retried): the sent rows get
// last_ok_at + fail_count 0, the 404 / 410 rows are deleted, each failed row gets last_error_at + its fail_count + 1.
async function pushBookkeeping(d: any): Promise<void> {
  const now = new Date().toISOString();
  const okIds = (d.okIds || []).filter((id: string) => UUID_SHAPE.test(id));
  const goneIds = (d.goneIds || []).filter((id: string) => UUID_SHAPE.test(id));
  if (okIds.length) {
    try { await rest(`push_subscriptions?id=in.(${okIds.join(",")})`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ last_ok_at: now, fail_count: 0 }) }); }
    catch (e) { console.error(`[push] bookkeeping (sent rows): ${pushLogSafe(e)}`); }
  }
  if (goneIds.length) {
    try { await rest(`push_subscriptions?id=in.(${goneIds.join(",")})`, { method: "DELETE", headers: { Prefer: "return=minimal" } }); }
    catch (e) { console.error(`[push] bookkeeping (gone rows): ${pushLogSafe(e)}`); }
  }
  // Decided 10/3 (review): a row failing with anything but 404 / 410 is only counted, never deleted here - a server-side
  // VAPID mistake answers 401 / 403 for EVERY device, and a prune would then wipe them all (README section 3).
  for (const f of (d.failedRows || [])) {
    if (!f || !UUID_SHAPE.test(String(f.id))) continue;
    try { await rest(`push_subscriptions?id=eq.${f.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ last_error_at: now, fail_count: f.fail_count }) }); }
    catch (e) { console.error(`[push] bookkeeping (failed row): ${pushLogSafe(e)}`); }
  }
}
// @pushGlue-copy-end

// dryRun (revision z): how many devices these accounts hold - select=id,profile_id only, never an endpoint or a key.
// A missing table throws (rest: a non-2xx is never a silent empty result) and the push step answers push.error.
async function countPushDevices(profileIds: string[]): Promise<Record<string, number>> {
  const ids = Array.from(new Set(profileIds.map(String).filter((id) => UUID_SHAPE.test(id))));
  const counts: Record<string, number> = {};
  if (!ids.length) return counts;
  const rows = await rest(`push_subscriptions?select=id,profile_id&profile_id=in.(${ids.join(",")})`);
  for (const r of (Array.isArray(rows) ? rows : [])) if (r && r.profile_id) counts[String(r.profile_id)] = (counts[String(r.profile_id)] || 0) + 1;
  return counts;
}

// ---------------------------------------------------------------------------
// The reminder's own push decisions (revision z, Faraz 10/20 - D8 the day-before reminder only, D10 default on, D11 one
// hour, D12 independent of the e-mail, D13 followers, D14 the words and the tap). Plain JavaScript between the markers:
// test/edge-functions.test.js lifts it beside the @logRedact, @followers and @pushPlan blocks (it calls pushTargets,
// pushPayload and pushEmpty from @pushPlan and followerReminderLine from @followers) and runs it. Whom: the person on call
// tomorrow when HIS reminder hour (else the default) is now, and every follower of that surgeon whose OWN hour is now -
// whatever either's e-mail switch or address. The switch: shift_reminders_push only (pushTargets: an explicit false is
// skipped_pref_off; a missing row or key is on). The answer: roster ids, follower tags and notification tags - never an
// endpoint, a key or the words.
// ---------------------------------------------------------------------------
// @reminderPush-start
const REMINDER_PUSH_PREF = "shift_reminders_push";
const REMINDER_PUSH_FRAME = "Call Reminder";
const REMINDER_PUSH_TAB = "myschedule";
const REMINDER_PUSH_DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// "2026-10-21" -> "Wed 10/21"
function reminderPushWhen(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
  return m ? REMINDER_PUSH_DOW[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()] + " " + Number(m[2]) + "/" + Number(m[3]) : String(ymd || "?");
}
// the person's own words: "Tomorrow (Wed 10/21) you are on Silvis primary call, 07:00 to 07:00 - backup Khan."
function reminderPushLine(role, ymd, otherLabel) {
  const other = role === "primary" ? "backup" : "primary";
  return "Tomorrow (" + reminderPushWhen(ymd) + ") you are on Silvis " + role + " call, 07:00 to 07:00 - " + other + " " + otherLabel + ".";
}
// one tag per day and role: tomorrow's primary and backup notices never replace each other (a follower of both surgeons
// keeps both); always matches sw.js's /^silvis-[a-z0-9-]{1,60}$/
function reminderPushTag(ymd, role) {
  return "silvis-reminder-" + String(ymd || "").replace(/[^0-9]/g, "").slice(0, 8) + "-" + (role === "backup" ? "backup" : "primary");
}
// The plan: one entry per role on call tomorrow (onCall: the handler's [{ person_id, role, otherLabel }]; names: roster id
// -> name; prefsById: the person_id-keyed prefs rows; accountsById: roster id -> his user_profiles ids; followers:
// followerIndex's list; followerPlan: the e-mail's followerReminderPlan entries, whose user_hour is the follower's own).
// -> [{ role, surgeon, tag, line, followerLine, targets, skipped }] (targets / skipped: pushTargets' answer)
function reminderPushPlan(onCall, ymd, names, prefsById, accountsById, followers, followerPlan, hour, defaultHour) {
  const nm = names && typeof names === "object" ? names : {};
  const prefs = prefsById && typeof prefsById === "object" ? prefsById : {};
  const accounts = accountsById && typeof accountsById === "object" ? accountsById : {};
  const index = Array.isArray(followers) ? followers : [];
  const fplan = Array.isArray(followerPlan) ? followerPlan : [];
  const out = [];
  (Array.isArray(onCall) ? onCall : []).forEach(function (o) {
    if (!o || o.person_id == null || String(o.person_id) === "" || (o.role !== "primary" && o.role !== "backup")) return;
    const pid = String(o.person_id);
    const surgeonName = nm[pid] || pid;
    const own = Object.prototype.hasOwnProperty.call(prefs, pid) ? prefs[pid] : null;
    const userHour = own && typeof own.reminder_hour_central === "number" ? own.reminder_hour_central : defaultHour;
    const audience = userHour === hour ? [{ person_id: pid, prefs: own, profileIds: Array.isArray(accounts[pid]) ? accounts[pid].slice() : [] }] : [];
    const fols = [];
    fplan.forEach(function (e) {
      if (!e || String(e.surgeon) !== pid || e.role !== o.role || e.user_hour !== hour) return;
      const f = index.find(function (x) { return !!x && x.id === e.id; }) || null;
      fols.push({ id: e.id, tag: e.follower, via: [pid], prefs: f && f.prefs ? f.prefs : null, followedNames: [surgeonName] });
    });
    const t = pushTargets(audience, fols, REMINDER_PUSH_PREF);
    out.push({ role: o.role, surgeon: pid, tag: reminderPushTag(ymd, o.role), line: reminderPushLine(o.role, ymd, o.otherLabel),
      followerLine: followerReminderLine(surgeonName, o.role, ymd, o.otherLabel), targets: t.targets, skipped: t.skipped });
  });
  return out;
}
// one target's payload: pushPayload's shape (@pushPlan - the title, a follower's "(following Dr. X)", the first line at
// most 180 characters, the 3072-byte cap), then the reminder's own tag and tab; no day (the e-mail keeps the day's note)
function reminderPushPayload(entry, target) {
  const follower = !!target && target.kind === "follower";
  const p = pushPayload("shift_reminder", { message: follower ? entry.followerLine : entry.line }, follower ? { kind: "follower", followedNames: target.followedNames } : { kind: "person" }, REMINDER_PUSH_FRAME);
  p.tag = entry.tag;
  p.tab = REMINDER_PUSH_TAB;
  return p;
}
// the answer's push object over every role: pushSummary's counts summed (sent + failed + skipped_no_device +
// skipped_pref_off = the targets of every role), its lists with each entry's role, and the notification tags.
// parts: [{ entry, summary }] with summary = pushSummary(delivered, entry.skipped, true)
function reminderPushMerge(parts) {
  const out = pushEmpty(null);
  out.results = []; out.followers = []; out.tags = [];
  (Array.isArray(parts) ? parts : []).forEach(function (p) {
    const s = p && p.summary ? p.summary : pushEmpty(null);
    const role = p && p.entry ? p.entry.role : null;
    ["sent", "failed", "removed", "skipped_no_device", "skipped_pref_off"].forEach(function (k) { out[k] += Number(s[k]) || 0; });
    ["sent", "failed", "removed"].forEach(function (k) { out.devices[k] += Number(s.devices && s.devices[k]) || 0; });
    (Array.isArray(s.results) ? s.results : []).forEach(function (r) { out.results.push({ person_id: r.person_id, role: role, status: r.status }); });
    (Array.isArray(s.followers) ? s.followers : []).forEach(function (f) { out.followers.push({ follower: f.follower, via: Array.isArray(f.via) ? f.via.slice() : [], role: role, status: f.status }); });
    if (p && p.entry) out.tags.push(p.entry.tag);
  });
  return out;
}
// dryRun: what a live run would push - nothing sent, nothing written. A target is "dry_run_composed" when his accounts hold
// a device (countsByProfile: account id -> devices), else "skipped_no_device"; a switch that is off reads skipped_pref_off;
// devices_found = the devices a live run would try.
function reminderPushDryRun(entries, countsByProfile) {
  const counts = countsByProfile && typeof countsByProfile === "object" ? countsByProfile : {};
  const out = { dry_run: true, composed: 0, skipped_no_device: 0, skipped_pref_off: 0, devices_found: 0, error: null, results: [], followers: [], tags: [] };
  (Array.isArray(entries) ? entries : []).forEach(function (e) {
    out.tags.push(e.tag);
    (Array.isArray(e.targets) ? e.targets : []).forEach(function (t) {
      const n = (Array.isArray(t.profileIds) ? t.profileIds : []).reduce(function (a, id) { return a + (Number(counts[id]) || 0); }, 0);
      const status = n > 0 ? "dry_run_composed" : "skipped_no_device";
      if (n > 0) { out.composed++; out.devices_found += n; } else out.skipped_no_device++;
      if (t.kind === "follower") out.followers.push({ follower: t.key, via: Array.isArray(t.via) ? t.via.slice() : [], role: e.role, status: status });
      else out.results.push({ person_id: t.key, role: e.role, status: status });
    });
    (Array.isArray(e.skipped) ? e.skipped : []).forEach(function (s) {
      out.skipped_pref_off++;
      if (s.kind === "follower") out.followers.push({ follower: s.key, via: Array.isArray(s.via) ? s.via.slice() : [], role: e.role, status: s.status });
      else out.results.push({ person_id: s.key, role: e.role, status: s.status });
    });
  });
  return out;
}
// After one role's sends and bookkeeping: the device rows the next role reads (review 10/20). The handler reads the devices
// once for both roles, and one device can be in both - a follower of both of tomorrow's surgeons, or the person on call who
// follows the other - so the next role reads them as this role left them: a 404 / 410 row is dropped (deleted - never POSTed
// again), a sent row reads fail_count 0, a failed row the count just written (a second failure counts on from it). A new map;
// a row this role did not touch stays as read.
function reminderPushRefresh(subsByProfile, delivered) {
  const d = delivered && typeof delivered === "object" ? delivered : {};
  const gone = new Set((Array.isArray(d.goneIds) ? d.goneIds : []).map(String));
  const sent = new Set((Array.isArray(d.okIds) ? d.okIds : []).map(String));
  const bumped = new Map((Array.isArray(d.failedRows) ? d.failedRows : []).filter(function (f) { return !!f; }).map(function (f) { return [String(f.id), f.fail_count]; }));
  const map = subsByProfile && typeof subsByProfile === "object" ? subsByProfile : {};
  const out = {};
  Object.keys(map).forEach(function (k) {
    out[k] = (Array.isArray(map[k]) ? map[k] : []).filter(function (s) { return !(s && gone.has(String(s.id))); }).map(function (s) {
      const id = s && s.id != null ? String(s.id) : "";
      if (sent.has(id)) return Object.assign({}, s, { fail_count: 0 });
      if (bumped.has(id)) return Object.assign({}, s, { fail_count: bumped.get(id) });
      return s;
    });
  });
  return out;
}
// @reminderPush-end

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

// ---------------------------------------------------------------------------
// The heads-up before a freeze (Prompt 26, Faraz 9/30): "requested vacation
// dates and painted dates in" before the next schedule - "the generator makes
// most of the decisions and less work to paint". Plain JavaScript between the
// markers (no type annotations, nothing from outside this block):
// test/edge-functions.test.js extracts it, evaluates it with new Function and
// runs it - the words per audience and reminder, who is mailed per offer
// status, the vacation ranges and the close roll call. Wording only: the
// offer statuses themselves (otmStatus / SQL offer_status()) are unchanged; a
// not_started surgeon is simply "following his rules".
// ---------------------------------------------------------------------------
// @offersMail-start
const OFM_DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function ofmIso(v) {
  const s = typeof v === "string" ? v.slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function ofmAddDay(iso) {
  const p = iso.split("-").map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + 1));
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
}
// "2027-01-04" -> "1/4"
function ofmMD(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  return m ? Number(m[2]) + "/" + Number(m[3]) : String(iso || "?");
}
// "2026-11-23" -> "Mon 11/23"
function ofmDayLabel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return String(iso || "?");
  return OFM_DOW[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()] + " " + Number(m[2]) + "/" + Number(m[3]);
}
// A clipped range -> "1/4-1/10" (one day -> "1/4")
function ofmRange(r) { return r.start === r.end ? ofmMD(r.start) : ofmMD(r.start) + "-" + ofmMD(r.end); }
// Which reminder today's is. remindDays = the effective offsets (days before the close, from the timeline). Only the
// offsets that can fire count, once each (a 0-day reminder falls on the close day, where the close wins - otmCronPlan).
// "first" = the largest (the coordinators' copy rides it); "last" = the smallest when there are 2+ (the one-line last
// call); anything between = "middle" (the full text again). A single offset is "first" - there is no last call.
function offersReminderKind(daysToClose, remindDays) {
  const offs = [];
  (Array.isArray(remindDays) ? remindDays : []).forEach(function (n) {
    if (typeof n === "number" && isFinite(n) && n > 0 && offs.indexOf(n) < 0) offs.push(n);
  });
  offs.sort(function (a, b) { return b - a; });
  if (!offs.length || daysToClose === offs[0]) return "first";
  if (offs.length >= 2 && daysToClose === offs[offs.length - 1]) return "last";
  return "middle";
}
// The office coordinators: user_profiles rows with role coordinator and no roster link, each with his OWN prefs row
// (notification_preferences keyed by profile_id since Prompt 20; no row -> on). key = "coordinator-" + the account id's
// first 8 characters - what reaches the response and the log, never the address.
function offersCoordinators(profiles, prefRows) {
  const prefsByProfile = {};
  (Array.isArray(prefRows) ? prefRows : []).forEach(function (r) {
    if (r && typeof r === "object" && r.profile_id) prefsByProfile[String(r.profile_id)] = r;
  });
  const out = [];
  (Array.isArray(profiles) ? profiles : []).forEach(function (p) {
    if (!p || typeof p !== "object" || !p.id || p.role !== "coordinator") return;
    if (p.person_id !== null && p.person_id !== undefined && String(p.person_id) !== "") return;
    const email = typeof p.email === "string" && p.email.trim() ? p.email.trim() : null;
    const name = typeof p.display_name === "string" && p.display_name.trim() ? p.display_name.trim() : null;
    const pref = prefsByProfile[String(p.id)] || null;
    out.push({ key: "coordinator-" + String(p.id).slice(0, 8), email: email, name: name, opted_out: !!(pref && pref.schedule_updates_email === false) });
  });
  return out;
}
// Who gets today's heads-up: EVERY pool surgeon, whatever his offer status, then - on the FIRST reminder only - the
// coordinators. emailById: roster id -> address (or null) from the linked user_profiles rows; isOptedOut(pid): his own
// schedule_updates_email is false. One entry per recipient { key, audience, pid, email, name, status }, status "due" |
// "skipped_pref_off" | "skipped_no_email" (the switch first, then the address - the order every mode uses).
function offersHeadsUpPlan(poolIds, emailById, isOptedOut, coordinators, kind) {
  const book = emailById && typeof emailById === "object" ? emailById : {};
  const out = [];
  (Array.isArray(poolIds) ? poolIds : []).forEach(function (raw) {
    const pid = String(raw);
    if (out.some(function (e) { return e.key === pid; })) return;
    const email = Object.prototype.hasOwnProperty.call(book, pid) && typeof book[pid] === "string" && book[pid] ? book[pid] : null;
    const status = typeof isOptedOut === "function" && isOptedOut(pid) ? "skipped_pref_off" : email ? "due" : "skipped_no_email";
    out.push({ key: pid, audience: "surgeon", pid: pid, email: email, name: null, status: status });
  });
  if (kind !== "first") return out;
  (Array.isArray(coordinators) ? coordinators : []).forEach(function (c) {
    if (!c || typeof c !== "object" || !c.key) return;
    const address = typeof c.email === "string" && c.email ? c.email : null;
    const status = c.opted_out ? "skipped_pref_off" : address ? "due" : "skipped_no_email";
    out.push({ key: c.key, audience: "coordinator", pid: null, email: address, name: c.name || null, status: status });
  });
  return out;
}
// The words. audience "surgeon" | "coordinator", kind from offersReminderKind, p = { label, offers_close_at,
// days_to_close }. Plain text { subject, text } (the caller escapes it into the frame), or null for a coordinator on
// any reminder but the first (he never gets one).
function offersHeadsUpText(audience, kind, p) {
  const o = p && typeof p === "object" ? p : {};
  const label = String(o.label || "next period");
  const freeze = ofmDayLabel(o.offers_close_at);
  if (audience === "coordinator") {
    if (kind !== "first") return null;
    return {
      subject: "Silvis call - the " + label + " schedule is built from the surgeons' rules on " + freeze,
      text: "Before " + freeze + ", the surgeons enter their vacations for " + label + " in the app; when one asks you, enter it for them under Time off. Painting days is optional - the schedule follows each surgeon's rules.",
    };
  }
  if (kind === "last") {
    const n = typeof o.days_to_close === "number" ? o.days_to_close : 0;
    const left = n + " day" + (n === 1 ? "" : "s") + " left";
    return {
      subject: "Silvis call - " + left + ": the " + label + " schedule is built from your rules on " + freeze,
      text: left + ": enter your vacations for " + label + " in the app before " + freeze + " (and paint any days you'd like to work, or can't) - otherwise the schedule follows your rules.",
    };
  }
  return {
    subject: "Silvis call - the " + label + " schedule is built from your rules on " + freeze,
    text: "Before " + freeze + ", enter your vacations for " + label + " in the app. If there are days you'd like to work, or can't, paint them too. Otherwise there is nothing to do - the schedule follows your rules.",
  };
}
// Vacations inside a period, for the close summary: time_off rows { person_id, start_date, end_date } of POOL surgeons
// overlapping [start, end], clipped to the period and merged (overlapping or touching ranges become one), per roster
// id in start order. A row outside the pool or the period, or without usable dates, is ignored.
function offersVacationRanges(rows, start, end, poolIds) {
  const s0 = ofmIso(start), e0 = ofmIso(end);
  const out = {};
  if (!s0 || !e0 || e0 < s0) return out;
  const pool = (Array.isArray(poolIds) ? poolIds : []).map(function (x) { return String(x); });
  const byId = {};
  (Array.isArray(rows) ? rows : []).forEach(function (r) {
    if (!r || typeof r !== "object") return;
    const pid = r.person_id === null || r.person_id === undefined ? "" : String(r.person_id);
    if (pool.indexOf(pid) < 0) return;
    const a = ofmIso(r.start_date), b = ofmIso(r.end_date);
    if (!a || !b || b < a || b < s0 || a > e0) return;
    (byId[pid] = byId[pid] || []).push({ start: a < s0 ? s0 : a, end: b > e0 ? e0 : b });
  });
  pool.forEach(function (pid) {
    const list = byId[pid];
    if (!list || out[pid]) return;
    list.sort(function (x, y) { return x.start < y.start ? -1 : x.start > y.start ? 1 : 0; });
    const merged = [];
    list.forEach(function (r) {
      const last = merged.length ? merged[merged.length - 1] : null;
      if (last && r.start <= ofmAddDay(last.end)) { if (r.end > last.end) last.end = r.end; }
      else merged.push({ start: r.start, end: r.end });
    });
    out[pid] = merged;
  });
  return out;
}
// The roll call at the freeze: who PAINTED DAYS (otmRollcall's "submitted" - offered days inside the period, with the
// count), who ADDED VACATIONS (offersVacationRanges), and everyone else as FOLLOWING THEIR RULES. A surgeon may be in
// the first two lists; nobody is ever "missing", "never answered" or "not started". roll = otmRollcall rows.
function offersCloseSummary(roll, vacations) {
  const vac = vacations && typeof vacations === "object" ? vacations : {};
  const painted = [], added = [], following = [];
  (Array.isArray(roll) ? roll : []).forEach(function (r) {
    if (!r || typeof r !== "object" || !r.id) return;
    const id = String(r.id);
    const p = r.status === "submitted";
    const v = Object.prototype.hasOwnProperty.call(vac, id) && Array.isArray(vac[id]) && vac[id].length > 0;
    if (p) painted.push({ id: id, offered: typeof r.offered === "number" ? r.offered : 0 });
    if (v) added.push({ id: id, ranges: vac[id].map(ofmRange) });
    if (!p && !v) following.push(id);
  });
  return { painted: painted, vacations: added, following: following };
}
// The close summary's words for the scheduler / admin accounts. p = { label, start_day, end_day, offers_close_at },
// nameOf(id) -> the roster name. Plain text { subject, lead, sections: [{ heading, items }], tail }.
function offersClosedText(p, summary, nameOf) {
  const o = p && typeof p === "object" ? p : {};
  const s = summary && typeof summary === "object" ? summary : {};
  const painted = Array.isArray(s.painted) ? s.painted : [], vacations = Array.isArray(s.vacations) ? s.vacations : [], following = Array.isArray(s.following) ? s.following : [];
  const nm = typeof nameOf === "function" ? nameOf : function (id) { return String(id); };
  const label = String(o.label || "next period");
  const freeze = ofmDayLabel(o.offers_close_at);
  return {
    subject: "Silvis call - " + label + " frozen " + freeze + ": " + painted.length + (painted.length === 1 ? " surgeon" : " surgeons") + " painted days, " + vacations.length + " added vacations, " + following.length + " following their rules",
    lead: label + " (" + ofmDayLabel(o.start_day) + " to " + ofmDayLabel(o.end_day) + ") froze on " + freeze,
    sections: [
      { heading: "Painted days", items: painted.map(function (r) { return nm(r.id) + " - " + r.offered + " day" + (r.offered === 1 ? "" : "s"); }) },
      { heading: "Added vacations", items: vacations.map(function (r) { return nm(r.id) + " - " + r.ranges.join(", "); }) },
      { heading: "Following their rules", items: following.map(function (id) { return nm(id); }) },
    ],
    tail: "Nothing was generated or published - open Setup, Generate, Periods when you are ready. A late vacation is entered under Time off; a late painted day can still be entered by the scheduler.",
  };
}
// @offersMail-end

// The two frames - the same title / colour / CTA as send-notification's offers_reminder / offers_closed categories
// (test/edge-functions.test.js compares them), so the cron's mail and a mail the app sends look alike in the inbox.
const OFFERS_REMINDER_FRAME = { title: "Schedule Heads-up", color: "#13294B", cta: "Open the app" };
const OFFERS_CLOSED_FRAME = { title: "Period Frozen", color: "#C2410C", cta: "Open Periods" };

// name null -> "Hi," (a coordinator account without a display name).
function offersFrame(title: string, color: string, name: string | null, bodyHtml: string, cta: string, footer: string): string {
  return `
    <div style="font-family:'Outfit',Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;">
      <div style="background:${color};color:#fff;padding:14px 20px;border-radius:10px 10px 0 0;">
        <h2 style="margin:0;font-size:18px;">${escHtml(title)}</h2>
        <p style="margin:6px 0 0;font-size:13px;opacity:0.9;">${escHtml(APP_NAME)}</p>
      </div>
      <div style="background:#fff;border:1px solid #e0e4ea;border-top:none;padding:20px;border-radius:0 0 10px 10px;">
        <p style="font-size:14px;color:#2c3e50;line-height:1.6;margin:0;">
          ${name ? `Hi <strong>${escHtml(name)}</strong>,` : "Hi,"}<br><br>
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

// The heads-up mail (Prompt 26): words = offersHeadsUpText(...) for this recipient's audience and today's reminder.
function buildOffersReminder(name: string | null, words: { subject: string; text: string }, p: { audience: string; days_to_close: number; remind_days: number[] }): { subject: string; html: string } {
  // The footer names the effective offsets (groupRules.offerPeriods.remindDaysBeforeClose,
  // editable in Setup -> Rules) - never a literal, so editing the rule keeps the words right.
  const offsets = p.remind_days.length ? p.remind_days.join(" and ") : String(p.days_to_close);
  const footer = p.audience === "coordinator"
    ? `this heads-up goes to the office coordinators with the first reminder, ${p.days_to_close} day${p.days_to_close === 1 ? "" : "s"} before a period's freeze; to stop it, turn off \"Schedule published, open shifts, shifts taken\" under Settings in the app (an office account that follows a surgeon), or ask the scheduler.`
    : `this reminder goes out ${offsets} day${offsets === "1" ? "" : "s"} before a period's freeze to every pool surgeon; turn schedule updates off under Settings in the app to stop it.`;
  const f = OFFERS_REMINDER_FRAME;
  return { subject: words.subject, html: offersFrame(f.title, f.color, name, escHtml(words.text), f.cta, footer) };
}

// The close summary (Prompt 26): words = offersClosedText(...) - painted days, added vacations, following their rules.
function buildOffersClosed(name: string, words: { subject: string; lead: string; sections: { heading: string; items: string[] }[]; tail: string }, periodStatus: string): { subject: string; html: string } {
  const list = (items: string[]) => items.length ? items.map((t) => `<li>${escHtml(t)}</li>`).join("") : "<li>-</li>";
  const body =
    `${escHtml(words.lead)}; the period is now marked <strong>${escHtml(periodStatus)}</strong>.<br><br>` +
    words.sections.map((s) => `<strong>${escHtml(s.heading)}</strong>:<ul style="margin:4px 0 10px;padding-left:20px;">${list(s.items)}</ul>`).join("") +
    escHtml(words.tail);
  const f = OFFERS_CLOSED_FRAME;
  return { subject: words.subject, html: offersFrame(f.title, f.color, name, body, f.cta, "the close summary goes to the scheduler and admin accounts on the morning a period freezes.") };
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
  // row: linked accounts (person_id -> email) for the heads-up, scheduler /
  // admin accounts for the close summary, and the schedule_updates_email flag.
  // The coordinators (and their own prefs rows, by profile_id) are read below,
  // on their own, so a failed read there never costs the surgeons their mail.
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
  // Prompt 26: the office coordinators get the FIRST heads-up of a period (their own prefs row, by profile_id). Read only
  // when a reminder is due; a failed read is logged and answered on the reminder entry (coordinators_error) - the
  // surgeons' heads-up stands.
  let coordinators: any[] = [];
  let coordError: string | null = null;
  if (due.some((x) => x.plan.action === "remind")) {
    try {
      const [cProfiles, cPrefRows] = await Promise.all([
        rest("user_profiles?select=id,person_id,email,display_name,role&role=eq.coordinator&person_id=is.null"),
        rest("notification_preferences?select=*"),   // select=*, as the follower read: offersCoordinators keeps the rows keyed by profile_id
      ]);
      coordinators = offersCoordinators(cProfiles, cPrefRows);
    } catch (e) {
      coordError = redactAddresses(e instanceof Error ? e.message : String(e));
      console.error(`[daily-reminder] offers: coordinator read failed: ${coordError}`);
    }
  }

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
      // Prompt 26: EVERY pool surgeon, whatever his offer status (vacations matter for everyone); the coordinators on
      // the first reminder only; the last call (the smallest of 2+ offsets) in one line. offersHeadsUpPlan decides who,
      // offersHeadsUpText the words (the @offersMail block).
      const kind = offersReminderKind(plan.days_to_close, remindDays);
      entry.reminder = kind;
      if (kind === "first" && coordError) entry.coordinators_error = coordError;
      const headsUp = offersHeadsUpPlan(poolIds, emailById, (pid: string) => optedOut(pid), coordinators, kind);
      console.log(`[daily-reminder] offers: ${period.label} reminder day (${plan.reason}, ${kind}) -> ${headsUp.map((e: any) => e.key).join(",") || "(nobody)"}`);
      for (const e of headsUp) {
        if (e.status === "skipped_pref_off") { prefOff++; recipients.push({ person_id: e.key, status: "skipped_pref_off" }); continue; }
        if (e.status === "skipped_no_email") { noEmail++; recipients.push({ person_id: e.key, status: "skipped_no_email" }); continue; }
        const words = offersHeadsUpText(e.audience, kind, { label: period.label, offers_close_at: t.offers_close_at, days_to_close: plan.days_to_close });
        if (!words) continue;   // never: a coordinator is planned on the first reminder only
        const { subject, html } = buildOffersReminder(e.audience === "coordinator" ? e.name : nameOf(e.pid), words, { audience: e.audience, days_to_close: plan.days_to_close, remind_days: remindDays });
        if (dryRun) { recipients.push({ person_id: e.key, status: "dry_run_composed" }); continue; }
        const r = await sendEmail(e.email, subject, html, `mode=offers reminder period=${period.id} to=${e.key}`);
        if (r.ok) { sent++; recipients.push({ person_id: e.key, status: "sent" }); }
        else { failed++; recipients.push({ person_id: e.key, status: `failed_${r.status}` }); }
      }
      continue;
    }

    // plan.action === "close". Prompt 26: the roll call names who added vacations, so the pool's time_off rows that
    // overlap the period are read first (service role, the period's range; read only) - a failed read throws here,
    // BEFORE anything is written, and the period stays upcoming for the next run.
    const vacRows = await rest(`time_off?select=person_id,start_date,end_date&start_date=lte.${t.end_day}&end_date=gte.${t.start_day}&order=start_date.asc`);
    const summary = offersCloseSummary(roll, offersVacationRanges(Array.isArray(vacRows) ? vacRows : [], t.start_day, t.end_day, poolIds));
    entry.summary = { painted: summary.painted.map((r: any) => r.id), added_vacations: summary.vacations.map((r: any) => r.id), following_rules: summary.following };
    const closedWords = offersClosedText({ label: period.label, start_day: t.start_day, end_day: t.end_day, offers_close_at: t.offers_close_at }, summary, nameOf);
    // Then flip the row (compare-and-swap on status), then the audit row, then
    // the summary. A dry run does none of the writes.
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
            detail: { period_id: period.id, label: period.label, offers_close_at: plan.offers_close_at, today, rollcall: roll, summary: entry.summary },
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
      const { subject, html } = buildOffersClosed(s.pid ? nameOf(s.pid) : "scheduler", closedWords, dryRun ? "closed (dry run - not written)" : periodStatus);
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
    // Revision z: the profiles read adds the account id (the push side's device lookup); the e-mail side reads exactly
    // what it read before (the first non-empty address per person).
    const ids = onCall.map((o) => o.person_id);
    const inList = `in.(${ids.map((s) => `"${s}"`).join(",")})`;
    const [prefRows, profiles] = await Promise.all([
      rest(`notification_preferences?select=*&person_id=${inList}`),
      rest(`user_profiles?select=id,person_id,email&person_id=${inList}`),
    ]);
    const prefsById: Record<string, any> = {};
    for (const p of (Array.isArray(prefRows) ? prefRows : [])) if (p?.person_id) prefsById[p.person_id] = p;
    const emailById: Record<string, string | null> = {};
    const accountsById: Record<string, string[]> = {};   // revision z: every account id linked to the person (push devices)
    for (const row of (Array.isArray(profiles) ? profiles : [])) {
      const pid = String(row.person_id);
      const email = typeof row.email === "string" && row.email.trim() ? row.email.trim() : null;
      if (!(pid in emailById) || (!emailById[pid] && email)) emailById[pid] = email;
      if (row.id != null && String(row.id) !== "") (accountsById[pid] = accountsById[pid] || []).push(String(row.id));
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
    // revision z: the push side's followers - followerIndex's list and the e-mail's plan, kept only AFTER the follower
    // e-mail loop below ([] when the follower read failed: the push then reaches the on-call persons alone)
    let pushFollowers: any[] = [], pushFollowerPlan: any[] = [];
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
      pushFollowers = followers; pushFollowerPlan = plan;
    } catch (e) {
      const why = redactAddresses(e instanceof Error ? e.message : String(e));
      console.error(`[daily-reminder] followers: ${why}`);
      followersOut = { error: why };
    }

    // Revision z (phone push for the day-before reminder; Faraz 10/20, D8-D16): AFTER the follower e-mails, in its OWN try -
    // a failure here is answered as push.error and never changes the e-mail answer (final above). Whom: reminderPushPlan
    // (the person at his hour, the followers of that surgeon at theirs - never an *_email flag or an address), on
    // shift_reminders_push alone; one notice per role (its own tag), each role delivered and booked in turn, the next role
    // reading the devices as the one before left them (reminderPushRefresh - one device can be in both roles). dryRun: the
    // plan and a device count (select=id,profile_id - no endpoint read), nothing sent or written; it always imports the VAPID
    // pair (no network), so a dryRun at any hour says whether push is configured. A live run with nobody to push at this
    // hour (the usual hourly tick) reads and imports nothing.
    let pushOut: any;
    try {
      const entries = reminderPushPlan(onCall, tomorrow, names, prefsById, accountsById, pushFollowers, pushFollowerPlan, now.hour, DEFAULT_REMINDER_HOUR);
      const targets = entries.flatMap((e: any) => e.targets);
      if (!targets.length && !dryRun) {
        pushOut = reminderPushMerge(entries.map((e: any) => ({ entry: e, summary: pushSummary({ recipients: [], devices: { sent: 0, failed: 0, removed: 0 } }, e.skipped, true) })));
      } else {
        const pair = await vapidKeyPair();
        if (!pair) {
          pushOut = { ...pushEmpty(PUSH_NOT_CONFIGURED), ...(dryRun ? { dry_run: true } : {}) };
        } else if (dryRun) {
          pushOut = reminderPushDryRun(entries, targets.length ? await countPushDevices(targets.flatMap((t: any) => t.profileIds)) : {});
        } else {
          let subsByProfile = await readPushSubscriptions(targets.flatMap((t: any) => t.profileIds));
          const send = pushSender(pair, Math.floor(Date.now() / 1000));
          const parts: any[] = [];
          for (const e of entries) {
            const delivered = await pushDeliver(e.targets, subsByProfile, (t: any) => reminderPushPayload(e, t), send, { log: (l: string) => console.error(l) });
            await pushBookkeeping(delivered);
            parts.push({ entry: e, summary: pushSummary(delivered, e.skipped, true) });
            // the next role reads the devices as this one left them (one device can be in both roles - reminderPushRefresh)
            subsByProfile = reminderPushRefresh(subsByProfile, delivered);
          }
          pushOut = reminderPushMerge(parts);
        }
      }
    } catch (e) {
      const why = e instanceof HttpError && /^push_subscriptions /.test(e.message)
        ? "push_subscriptions unavailable: " + pushLogSafe(e.message.replace(/^push_subscriptions GET failed: /, "")).slice(0, 160)
        : pushLogSafe(e);
      pushOut = { ...pushEmpty(why), ...(dryRun ? { dry_run: true } : {}) };
    }
    console.log(`[daily-reminder] push: tags=${(pushOut.tags || []).join(",") || "(none)"} sent=${pushOut.sent || 0} failed=${pushOut.failed || 0} removed=${pushOut.removed || 0} no_device=${pushOut.skipped_no_device || 0} pref_off=${pushOut.skipped_pref_off || 0}${pushOut.dry_run ? ` dry_run composed=${pushOut.composed || 0} devices=${pushOut.devices_found || 0}` : ""}${pushOut.error ? ` error=${pushOut.error}` : ""}`);

    return json(200, {
      date_tomorrow: tomorrow, current_hour: now.hour, dry_run: dryRun,
      on_call: onCall.length, sent, failed,
      skipped_wrong_hour: wrongHour, skipped_off: off, skipped_no_email: noEmail,
      results,
      followers: followersOut,
      push: pushOut,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[daily-reminder] error: ${message}`);
    return json(e instanceof HttpError ? 502 : 500, { error: message, upstream_status: e instanceof HttpError ? e.status : undefined });
  }
});
