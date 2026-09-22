// ===================================================================
// Silvis Call Schedule - Daily Reminder Edge Function
// ===================================================================
// Retargeted from the Davenport (DSG) daily-reminder v19 on 2026-09-22.
//
// Runs HOURLY from pg_cron (`0 * * * *`) with the shared secret in the
// x-cron-secret header. Each invocation:
//   1. Rejects any caller without the correct x-cron-secret (fail closed,
//      BEFORE any work - the public anon key satisfies the gateway, not this).
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

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Cron-only gate, evaluated BEFORE anything else. Fail closed: no secret
  // configured means nobody gets in.
  const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
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
    return json(200, {
      date_tomorrow: tomorrow, current_hour: now.hour, dry_run: dryRun,
      on_call: onCall.length, sent, failed,
      skipped_wrong_hour: wrongHour, skipped_off: off, skipped_no_email: noEmail,
      results,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[daily-reminder] error: ${message}`);
    return json(e instanceof HttpError ? 502 : 500, { error: message, upstream_status: e instanceof HttpError ? e.status : undefined });
  }
});
