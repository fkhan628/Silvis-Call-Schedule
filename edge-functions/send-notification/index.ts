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
//     shift_reminder, open_shifts, shift_claimed (the last two since Prompt 13
//     part 5, 2026-09-22: the open-shifts notice broadcast on Accept & Publish
//     / on demand from the board, and the "took the shift" note to the
//     scheduler + claimer), test. Davenport names schedule_changed and
//     trade_submitted are accepted as aliases (logged) so deploy order vs the
//     client build does not matter.
//   - The CLIENT composes the words. Payload: { type, data: { subject?,
//     message, detail? }, targetIds? }. The function renders data.message
//     (required except for type "test") inside a per-category frame and never
//     invents schedule facts. Strings are HTML-escaped; newlines become <br>.
//   - No vacation approve/deny templates (vacations need no approval at
//     Silvis), no APP names, no no-call wording, no $ / weighted logic.
//
// Payload contract:
//   POST { type: string, data: { subject?: string, message: string, detail?: string }, targetIds?: string[] }
//     targetIds ABSENT  -> broadcast to every linked person (opted in for the category)
//     targetIds []      -> send to nobody (200, sent 0) - defense in depth
//     targetIds [ids]   -> only those person ids (s1..s6)
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

async function loadRosterNames(): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  try {
    const rows = await rest("call_schedule_data?select=data&id=eq.main");
    const raw = rows?.[0]?.data;
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    const list: RosterEntry[] = Array.isArray(data?.roster) ? data.roster : [];
    for (const r of list) if (r?.id) names[String(r.id)] = r.name || String(r.id);
  } catch (e) {
    // Names are cosmetic (greeting) - ids are an acceptable fallback, but say so.
    console.warn(`[send-notification] roster read failed, greeting by id: ${(e as Error).message}`);
  }
  return names;
}

function escHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function textToHtml(s: string): string {
  return escHtml(s).replace(/\r?\n/g, "<br>");
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
      console.error(`[email] ${logKey}: provider HTTP ${res.status} ${body.slice(0, 160).replace(/S+@S+/g, "<redacted>")}`);
    }
    return { ok: res.ok, status: res.status };
  } catch (e) {
    console.error(`[email] ${logKey}: ${(e as Error).message}`);
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
  test:               { pref: null,                     title: "Test Email",         color: "#1a6fa8", cta: "Open App" },
};

// Davenport type names still emitted by older client builds.
const TYPE_ALIASES: Record<string, string> = {
  schedule_changed: "manual_edit",
  trade_submitted: "trade_proposed",
};

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

async function resolveRecipients(cat: Category, targetIds: string[] | null): Promise<{ list: Recipient[]; skippedPrefOff: number }> {
  const [profiles, prefRows, names] = await Promise.all([
    rest("user_profiles?select=person_id,email&person_id=not.is.null"),
    rest("notification_preferences?select=*"),
    loadRosterNames(),
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
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json(500, { error: "function misconfigured: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing" });
    if (!RESEND_API_KEY) return json(500, { error: "RESEND_API_KEY not configured" });
    if (!FROM_EMAIL) return json(500, { error: "NOTIFICATION_FROM_EMAIL not configured" });

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

    const { list, skippedPrefOff } = await resolveRecipients(cat, targetIds);
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
