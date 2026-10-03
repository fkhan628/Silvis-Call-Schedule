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
//   - notification_preferences is keyed by person_id for a surgeon (by profile_id for a follower since revision o) and has NO email column
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
//     2026-09-23: the Periods "Remind" button's note to a surgeon, and the
//     close summary to the scheduler; both on schedule_updates_email,
//     recipients by person_id like every other category; Prompt 26, 9/30:
//     framed as the heads-up before a freeze - "Schedule Heads-up", CTA "Open
//     the app" - and the freeze roll call, "Period Frozen"), test. Davenport names schedule_changed and
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
//     for every caller, the scheduler included, so targetIds (the addressed
//     parties) can never name a third person or be a broadcast; followers of
//     the parties are added after this gate (Prompt 20 F3). The pure pieces (isTradeType,
//     tradeIdOf, targetCap, tradePartyCheck) sit in the @sendGate block and are
//     unit-tested; the log-redaction regex is the @logRedact block.
//   - GIVE A DAY (Prompt 19 S3, 2026-09-24; v7, deployed 2026-09-25 05:36 UTC;
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
//   - GIVE HEADINGS (Prompt 19 S4, 2026-09-24; part of the same v7, deployed
//     2026-09-25 05:36 UTC).
//     A give is mailed through the existing trade_* categories (no new
//     category); the app marks its mail with data.kind 'give' and the frame's
//     heading (and the default subject) then reads "Day Offered" / "Give
//     Accepted" / "Give Declined" / "Give Applied" instead of "Shift Trade ..."
//     (frameTitle, the plain-JS block between '// @giveFrame-start' and
//     '// @giveFrame-end'). Cosmetic only: the gate never reads kind, and a
//     v6 function simply ignores the extra key.
//
//   - FOLLOWERS (Prompt 20 F3, Faraz 9/24; revision o; v8 on base v7 - deployed 2026-09-27 00:46 UTC; README section 3).
//     A viewer / coordinator account the admin set to follow roster surgeons (user_profiles.follows) receives what they receive, read-only. For trade_* (a Prompt 19 give
//     rides them with data.kind 'give'), shift_claimed, open_shifts and schedule_published, AFTER every gate and
//     after the surgeons' mail, each follower of a surgeon in followerUniverse (the notice's own parties: the trade
//     row's two, the claimer - never a scheduler-linked copy; or, for a broadcast, every follower) gets one e-mail on
//     HIS OWN notification_preferences row (keyed by profile_id - the surgeons' rows stay keyed by person_id; a
//     missing row means every flag on). The cap, sendGate and tradePartyCheck judge targetIds alone: a follower never
//     counts as the acting party, never satisfies the party check, and a follower CALLER is still a 403 (viewer /
//     coordinator never send). The frame says he follows Dr. X and points him at his OWN switches (Settings >
//     Notification settings - his row by profile_id, Prompt 20 R2). The response carries the follower counts; the per-follower list
//     (followerTag id8 + followed ids, never an address) only to an admin / scheduler caller. The surgeons' sent /
//     failed accounting (what the client's toast reads) is unchanged. The pure pieces are the @followers mirror block
//     (identical in daily-reminder).
//
//   - PHONE PUSH (Prompt 30, Faraz 10/2 "Davenport's look, Silvis's own push"; v10 on base v9 - prepared, NOT deployed; README section 3).
//     Web Push with VAPID, no third-party service: every send that has a push switch (PUSH_PREF_OF -
//     schedule_updates_push / trade_updates_push in notification_preferences, revision w) also goes to the phones of the
//     SAME people. resolveRecipients now answers `audience` too (every person of the universe BEFORE the e-mail filter,
//     with his account ids) and the follower step `fAll` (followerRecipients(..., null) - nobody skipped on an e-mail
//     flag); the fan-out reads only those two with the *_push flags, so e-mail off + push on still pushes and the
//     reverse (the e-mail part of the answer is unchanged for every input). It runs AFTER the follower e-mail, in its
//     own try: a push failure never changes the e-mail answer. Devices are push_subscriptions rows (read with the
//     service role); 404 / 410 deletes the row, other failures bump fail_count / last_error_at, never a retry loop.
//     The crypto (RFC 8291 aes128gcm + RFC 8188 one record + RFC 8292 VAPID ES256, WebCrypto only) is the plain-JS
//     block between '// @webPush-start' and '// @webPush-end'; the decisions and the send loop are the block between
//     '// @pushPlan-start' and '// @pushPlan-end' (test/edge-functions.test.js lifts both and checks the RFC 8291
//     Appendix A vector). The payload is { v: 1, title, body, tag, tab, params? } - the body is the first line of
//     data.message (at most 180 characters, addresses redacted), the tap target a whitelisted view (PUSH_TABS), never
//     a URL. An endpoint, a key or a payload text never reaches a response or a log line. Two query routes: GET
//     ?vapid=public (no auth; the public key only) and POST ?push=test (any verified session, the caller's OWN
//     devices, before the role read - a viewer / follower / APP / the office can test; no body is read).
//
// Payload contract:
//   GET  ?vapid=public -> 200 { publicKey } (Cache-Control: no-store) | 503 { error } when the VAPID secrets are missing / malformed
//   POST ?push=test    -> any verified session; 200 { push: { sent, failed, removed, skipped_no_device, skipped_pref_off: 0, devices: { sent, failed, removed }, error: null } } for the caller's own devices | 503 { error } (VAPID secrets missing / malformed) | 401
//   POST { type: string, data: { subject?: string, message: string, detail?: string, trade_id?: uuid, kind?: 'give' }, targetIds?: string[] }
//     data.kind 'give' (Prompt 19 S4, optional) only re-titles a trade_* frame (frameTitle); the gate never reads it
//     targetIds ABSENT  -> broadcast to every linked person (opted in for the category)
//     targetIds []      -> send to nobody (200, sent 0) - defense in depth
//     targetIds [ids]   -> only those person ids (s1..s6); at most roster size + 1 of them
//     trade_*           -> data.trade_id required; targetIds must be exactly that row's two parties
//     trade_applied     -> the same two parties, plus (optionally) scheduler-linked ids (Prompt 19 S3, v7)
//   -> 200 { sent, failed, skipped_no_email, skipped_pref_off, results: [{ person_id, status }],
//            followers_sent, followers_failed, followers_skipped_pref_off, followers_error (null, or why the follower
//            step could not run), and for an admin / scheduler caller followers_added: [{ follower: <id8>, via: [ids], status }],
//            push (Prompt 30): null for a category without a push switch (test, shift_reminder), else { sent, failed, removed,
//            skipped_no_device, skipped_pref_off, devices: { sent, failed, removed }, error (null, or why push did not run) }
//            and for an admin / scheduler caller also results: [{ person_id, status }] and followers: [{ follower: <id8>, via, status }] }
//
// Secrets (by NAME): RESEND_API_KEY, NOTIFICATION_FROM_EMAIL (required - there is
// NO hardcoded fallback sender); VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (Prompt 30 phone push - set by
// setup-push-keys.sh through --env-file; missing / malformed = no push, the e-mail unaffected); SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.
//
// Deploy: supabase functions deploy send-notification --workdir <linked dir> --project-ref bzhsroegtagqhutbnsrp --no-verify-jwt --use-api

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = Deno.env.get("NOTIFICATION_FROM_EMAIL") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
// Prompt 30 phone push: the VAPID pair (web-push formats: the public key = base64url of the 65-byte uncompressed P-256
// point, the private key = base64url of the 32-byte scalar) and the subject (the app's https URL - no address)
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "";

const APP_URL = "https://fkhan628.github.io/Silvis-Call-Schedule/";
const APP_NAME = "Silvis Call Schedule";
const MAX_MESSAGE_CHARS = 4000;

// pin moved deliberately (Prompt 30): GET joins POST / OPTIONS for the public-key route (?vapid=public)
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

// Prompt 19 S4: a give's heading. Plain JavaScript (test/edge-functions.test.js extracts and runs it); only the exact
// data.kind 'give' on one of the four trade_* categories changes the heading - anything else keeps the category's title.
// @giveFrame-start
const GIVE_TITLES = { trade_proposed: "Day Offered", trade_accepted: "Give Accepted", trade_declined: "Give Declined", trade_applied: "Give Applied" };
function frameTitle(type, baseTitle, data) {
  const give = !!data && typeof data === "object" && data.kind === "give" && Object.prototype.hasOwnProperty.call(GIVE_TITLES, type);
  return give ? GIVE_TITLES[type] : baseTitle;
}
// @giveFrame-end

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
  // Prompt 14 part 4: offer periods; reworded by Prompt 26 (Faraz 9/30) from
  // "choose your shifts" to "your schedule follows your rules". The client
  // composes the words (the heads-up before a freeze: "Before <freeze>, enter
  // your vacations for <period> in the app. If there are days you'd like to
  // work, or can't, paint them too. Otherwise there is nothing to do - the
  // schedule follows your rules."; the freeze roll call: painted days, added
  // vacations, following their rules); this table only names the frame and
  // the flag. The daily cron (daily-reminder mode "offers") uses the same
  // titles, colours and CTAs (OFFERS_REMINDER_FRAME / OFFERS_CLOSED_FRAME
  // there; test/edge-functions.test.js compares them) so both routes look
  // alike in the inbox.
  offers_reminder:    { pref: "schedule_updates_email", title: "Schedule Heads-up",  color: "#13294B", cta: "Open the app" },
  offers_closed:      { pref: "schedule_updates_email", title: "Period Frozen",      color: "#C2410C", cta: "Open Periods" },
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

// followed (Prompt 20 F3): the followed surgeons' names when the recipient is a FOLLOWER - the frame then says why he
// receives it; the composed words are the ones the surgeon receives, unchanged.
function buildEmail(type: string, cat: Category, data: any, recipientName: string, followed: string[] = []): { subject: string; html: string } {
  const title = frameTitle(type, cat.title, data); // Prompt 19 S4: a give (data.kind 'give') is headed as a give
  const subject = (typeof data?.subject === "string" && data.subject.trim())
    ? data.subject.trim().slice(0, 200)
    : `${title} - ${APP_NAME}`;
  const message: string = type === "test"
    ? `Email notifications for the ${APP_NAME} are working.`
    : String(data.message).slice(0, MAX_MESSAGE_CHARS);
  const detail = typeof data?.detail === "string" && data.detail.trim()
    ? `<p style="margin:12px 0 0;padding:10px 14px;background:#f4f6f8;border-left:3px solid ${cat.color};border-radius:6px;font-family:monospace;font-size:13px;color:#2c3e50;line-height:1.6;">${textToHtml(data.detail.slice(0, MAX_MESSAGE_CHARS))}</p>`
    : "";
  const followNote = followed.length
    ? `<p style="font-size:13px;color:#5a6a78;line-height:1.6;margin:0 0 12px;padding:10px 14px;background:#f4f6f8;border-radius:8px;">You follow ${escHtml(followed.map((n) => "Dr. " + n).join(" and "))} in the ${escHtml(APP_NAME)} - this is the notice sent to ${escHtml(followed.map((n) => "Dr. " + n).join(" and "))}.</p>`
    : "";
  const html = `
    <div style="font-family:'Outfit',Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;">
      <div style="background:${cat.color};color:#fff;padding:14px 20px;border-radius:10px 10px 0 0;">
        <h2 style="margin:0;font-size:18px;">${escHtml(title)}</h2>
        <p style="margin:6px 0 0;font-size:13px;opacity:0.9;">${escHtml(APP_NAME)}</p>
      </div>
      <div style="background:#fff;border:1px solid #e0e4ea;border-top:none;padding:20px;border-radius:0 0 10px 10px;">
        ${followNote}
        <p style="font-size:14px;color:#2c3e50;line-height:1.6;margin:0;">
          ${recipientName ? `Hi ${escHtml(recipientName)},` : "Hi,"}<br><br>
          ${textToHtml(message)}
        </p>
        ${detail}
        <a href="${APP_URL}" style="display:inline-block;background:${cat.color};color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-top:16px;">
          ${escHtml(cat.cta)}
        </a>
        <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e0e4ea;font-size:12px;color:#8a94a0;">
          <a href="${APP_URL}" style="color:#1a6fa8;">Open ${escHtml(APP_NAME)}</a> -
          ${followed.length ? `You receive this because you follow ${escHtml(followed.map((n) => "Dr. " + n).join(" and "))}; to change what you receive or stop these e-mails, use Notification settings under Settings in the app.` : `change your notification settings under Settings in the app.`}
        </div>
      </div>
    </div>`;
  return { subject, html };
}

// ---------------------------------------------------------------------------
// Phone push (Prompt 30, Faraz 10/2: "Davenport's look, Silvis's own push"). Two plain-JavaScript blocks - no type
// annotations, no Deno / Node globals, WebCrypto through crypto.subtle plus TextEncoder / atob / btoa only - so the
// same text runs here under Deno and in test/edge-functions.test.js under Node (lifted with new Function; the test
// checks the RFC 8291 Appendix A vector byte for byte). '@webPush' is the transport: RFC 8291 message encryption in
// ONE RFC 8188 aes128gcm record (rs 4096) and an RFC 8292 VAPID ES256 token per push-service origin. '@pushPlan' is
// the decisions: which switch, which tab / tag / words, whom (the audience and the followers BEFORE any e-mail flag),
// the bounded send loop and the response object. The handler below only does I/O around them.
// ---------------------------------------------------------------------------
// @webPush-start
const WP_RS = 4096;
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
  if (plain.length + 1 + 16 > WP_RS) throw new Error("the payload does not fit one record");
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
function pushSender(vapid: any, nowSec: number) {
  const jwtCache = new Map();
  return async (sub: any, payloadText: string) => {
    const r = await wpRequest(sub, payloadText, vapid, VAPID_SUBJECT, nowSec, jwtCache);
    const res = await fetch(r.url, { ...r.init, signal: AbortSignal.timeout(PUSH_TIMEOUT_MS) });
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
  for (const f of (d.failedRows || [])) {
    if (!f || !UUID_SHAPE.test(String(f.id))) continue;
    try { await rest(`push_subscriptions?id=eq.${f.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ last_error_at: now, fail_count: f.fail_count }) }); }
    catch (e) { console.error(`[push] bookkeeping (failed row): ${pushLogSafe(e)}`); }
  }
}

// ---------------------------------------------------------------------------
// Recipients: user_profiles (person_id -> email) x notification_preferences
// ---------------------------------------------------------------------------
interface Recipient { person_id: string; email: string | null; name: string; prefs: any }
// Prompt 30: a person of the send's universe BEFORE the e-mail filter, with every account linked to him (the push side
// reads these - it must never lose someone on his e-mail flag)
interface AudienceEntry { person_id: string; name: string; prefs: any; profileIds: string[] }

// pin moved deliberately (Prompt 30): the profiles read adds the account id (the push side's device lookup) and the answer
// adds `audience`; `list` / `skippedPrefOff` / `prefRows` mean exactly what they meant before for every input
async function resolveRecipients(cat: Category, targetIds: string[] | null, names: Record<string, string>): Promise<{ list: Recipient[]; skippedPrefOff: number; prefRows: any[]; audience: AudienceEntry[] }> {
  const [profiles, prefRows] = await Promise.all([
    rest("user_profiles?select=id,person_id,email&person_id=not.is.null"),
    rest("notification_preferences?select=*"),
  ]);
  const prefsById: Record<string, any> = {};
  for (const p of (Array.isArray(prefRows) ? prefRows : [])) if (p?.person_id) prefsById[p.person_id] = p;

  // First non-empty email per person wins; a second account for the same
  // person (should not happen) is ignored rather than double-mailed.
  const emailById: Record<string, string | null> = {};
  const accountsById: Record<string, string[]> = {};   // Prompt 30: every account id linked to the person (push devices)
  for (const row of (Array.isArray(profiles) ? profiles : [])) {
    const pid = String(row.person_id);
    const email = typeof row.email === "string" && row.email.trim() ? row.email.trim() : null;
    if (!(pid in emailById) || (!emailById[pid] && email)) emailById[pid] = email;
    if (row.id != null && String(row.id) !== "") (accountsById[pid] = accountsById[pid] || []).push(String(row.id));
  }

  // Universe = targetIds when given, else every linked person. The prefs rows are handed back so the follower step
  // (Prompt 20 F3) reads the same answer - a follower's own row is in prefRows, keyed by profile_id. The audience
  // (Prompt 30) is the whole universe, recorded BEFORE the e-mail flag is read.
  const universe = targetIds ? targetIds.map(String) : Object.keys(emailById);
  const list: Recipient[] = [];
  const audience: AudienceEntry[] = [];
  let skippedPrefOff = 0;
  for (const pid of new Set(universe)) {
    const prefs = prefsById[pid] || null;
    audience.push({ person_id: pid, name: names[pid] || pid, prefs, profileIds: accountsById[pid] || [] });
    if (!emailEnabled(cat, prefs)) { skippedPrefOff++; continue; }
    list.push({ person_id: pid, email: emailById[pid] ?? null, name: names[pid] || pid, prefs });
  }
  return { list, skippedPrefOff, prefRows: Array.isArray(prefRows) ? prefRows : [], audience };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  // -- Phone push (Prompt 30): GET ?vapid=public hands out the PUBLIC key only - no auth, no database, never another
  //    secret; missing / malformed / mismatched secrets -> 503. Every other GET stays 405.
  if (req.method === "GET" && new URL(req.url).searchParams.get("vapid") === "public") {
    const pair = await vapidKeyPair();
    if (!pair) return json(503, { error: PUSH_NOT_SET_UP });
    return new Response(JSON.stringify({ publicKey: pair.publicB64u }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  // pin moved deliberately (Prompt 30): the 405 now follows the public-key GET above; any other method or GET is refused as before
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

    // -- Phone push test (Prompt 30, READING 7): POST ?push=test pushes to the VERIFIED caller's own devices and nobody
    //    else, for any signed-in role (a viewer, a follower, an APP, the office can test their phones) - so it sits
    //    BEFORE the role read. No body is read (nothing in a request can aim it at someone else); the devices are read
    //    by the verified id alone.
    if (new URL(req.url).searchParams.get("push") === "test") {
      const pair = await vapidKeyPair();
      if (!pair) return json(503, { error: PUSH_NOT_SET_UP });
      if (!UUID_SHAPE.test(userId)) return json(401, { error: "authentication required - sign in again (a stale app build may need a reload)" });
      const own = await rest(`push_subscriptions?select=id,profile_id,endpoint,p256dh,auth,fail_count&profile_id=eq.${encodeURIComponent(userId)}`);
      const mine = (Array.isArray(own) ? own : []).filter((r: any) => r && String(r.profile_id) === userId);
      const delivered = await pushDeliver([{ key: "self", kind: "self", profileIds: [userId] }], { [userId]: mine },
        () => pushPayload("test", {}, { kind: "self" }, PUSH_TITLE), pushSender(pair, Math.floor(Date.now() / 1000)),
        { log: (l: string) => console.error(l) });
      await pushBookkeeping(delivered);
      const p = pushSummary(delivered, [], false);
      console.log(`[push] type=test (own devices) devices=${mine.length} sent=${p.devices.sent} failed=${p.devices.failed} removed=${p.devices.removed}`);
      return json(200, { push: { ...p, skipped_pref_off: 0 } });
    }

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
    //    trade mail is never a broadcast and never names anyone but the two
    //    parties - and, on trade_applied only (Prompt 19 S3, v7), the
    //    scheduler-linked ids - in targetIds. A surgeon sender must himself be
    //    a party. Followers of the two parties are added after every gate
    //    (Prompt 20 F3) and never count as a party.
    let tradeRow: any = null;
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
      tradeRow = trade;
    }

    // pin moved deliberately (Prompt 30): `audience` joins the answer (the push side's people, before any e-mail flag)
    const { list, skippedPrefOff, prefRows, audience } = await resolveRecipients(cat, targetIds, roster.names);
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

    // -- Followers (Prompt 20 F3): AFTER every gate and after the surgeons' mail. The cap, sendGate and tradePartyCheck
    //    above judged targetIds alone; a follower is never the acting party and never satisfies the party check - he is
    //    only added here, for trade_* (a give included), shift_claimed, open_shifts and schedule_published, when
    //    followerUniverse (the notice's own parties - never a scheduler-linked copy; a broadcast = every follower) holds
    //    a surgeon he follows, on HIS OWN flag for the category. One e-mail per follower per send. A failed follower read
    //    is logged and answered as followers_error - the surgeons' mail above has already gone and stands. The
    //    per-follower list goes back to an admin / scheduler caller only; a surgeon gets the counts.
    const followersAdded: { follower: string; via: string[]; status: string }[] = [];
    let followersSent = 0, followersFailed = 0, followersPrefOff = 0;
    let followersError: string | null = null;
    let fAll: any[] = [];   // Prompt 30: every follower of the notice BEFORE his e-mail flag (the push side reads it); [] when the read failed
    if (FOLLOWER_SEND_TYPES.indexOf(type) >= 0) {
      try {
        const fProfiles = await rest("user_profiles?select=*&role=in.(viewer,coordinator)");
        const followers = followerIndex(fProfiles, prefRows);
        const fUniverse = followerUniverse(type, targetIds, caller, data, tradeRow);
        const { list: fList, skipped } = followerRecipients(followers, type, fUniverse, cat.pref);
        // prefKey null skips nobody: the push side applies the follower's *_push flag itself (his own row, by profile_id)
        fAll = followerRecipients(followers, type, fUniverse, null).list.map((f: any) => ({
          ...f, prefs: (followers.find((x: any) => x.id === f.id) || {}).prefs || null, followedNames: f.via.map((id: string) => roster.names[id] || id),
        }));
        followersPrefOff = skipped.length;
        for (const sk of skipped) followersAdded.push(sk);
        for (const f of fList) {
          if (!f.email) { followersAdded.push({ follower: f.tag, via: f.via, status: "skipped_no_email" }); continue; }
          const { subject, html } = buildEmail(type, cat, data, f.name || "", f.via.map((id) => roster.names[id] || id));
          const res = await sendEmail(f.email, subject, html, `type=${type} follower=${f.tag}`);
          if (res.ok) { followersSent++; followersAdded.push({ follower: f.tag, via: f.via, status: "sent" }); }
          else { followersFailed++; followersAdded.push({ follower: f.tag, via: f.via, status: `failed_${res.status}` }); }
        }
        console.log(`[send-notification] type=${type} followers: ${followers.length} account(s) follow someone, added=${fList.length} sent=${followersSent} failed=${followersFailed} pref_off=${followersPrefOff}`);
      } catch (e) {
        followersError = redactAddresses(e instanceof Error ? e.message : String(e));
        console.error(`[send-notification] followers: ${followersError}`);
      }
    }

    // -- Phone push (Prompt 30): the SAME people as the e-mail above, on the PUSH switch of the category. It reads only
    //    `audience` (resolveRecipients' persons before any e-mail flag) and `fAll` (the followers before theirs) - e-mail
    //    off + push on still pushes, and the reverse. Its own try: a failure here is answered as push.error and never
    //    changes the e-mail answer (already final above). A category without a switch (test, shift_reminder) answers
    //    push: null and reads nothing.
    let pushOut: any = null;
    const pushPref = pushPrefOf(type);
    if (pushPref) {
      try {
        const plan = pushTargets(audience, fAll, pushPref);
        if (!plan.targets.length) {
          pushOut = pushSummary({ recipients: [], devices: { sent: 0, failed: 0, removed: 0 } }, plan.skipped, privileged);
        } else {
          const pair = await vapidKeyPair();
          if (!pair) {
            pushOut = pushEmpty(PUSH_NOT_CONFIGURED);
          } else {
            const subsByProfile = await readPushSubscriptions(plan.targets.flatMap((t: any) => t.profileIds));
            const frame = frameTitle(type, cat.title, data);
            const delivered = await pushDeliver(plan.targets, subsByProfile,
              (t: any) => pushPayload(type, data, { kind: t.kind, followedNames: t.followedNames }, frame),
              pushSender(pair, Math.floor(Date.now() / 1000)), { log: (l: string) => console.error(l) });
            await pushBookkeeping(delivered);
            pushOut = pushSummary(delivered, plan.skipped, privileged);
          }
        }
      } catch (e) {
        const why = e instanceof HttpError && /^push_subscriptions /.test(e.message)
          ? "push_subscriptions unavailable: " + pushLogSafe(e.message.replace(/^push_subscriptions GET failed: /, "")).slice(0, 160)
          : pushLogSafe(e);
        pushOut = pushEmpty(why);
      }
      console.log(`[push] type=${type} targets=${pushOut.sent + pushOut.failed + pushOut.skipped_no_device + pushOut.skipped_pref_off} sent=${pushOut.sent} failed=${pushOut.failed} removed=${pushOut.removed} no_device=${pushOut.skipped_no_device} pref_off=${pushOut.skipped_pref_off}${pushOut.error ? ` error=${pushOut.error}` : ""}`);
    }

    return json(200, {
      sent, failed, skipped_no_email: skippedNoEmail, skipped_pref_off: skippedPrefOff, results,
      followers_sent: followersSent, followers_failed: followersFailed, followers_skipped_pref_off: followersPrefOff, followers_error: followersError,
      ...(privileged ? { followers_added: followersAdded } : {}),
      push: pushOut,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[send-notification] error: ${message}`);
    return json(e instanceof HttpError ? 502 : 500, { error: message, upstream_status: e instanceof HttpError ? e.status : undefined });
  }
});
