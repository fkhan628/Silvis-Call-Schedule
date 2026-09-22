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

    // Prompt 13 part 5c: mode "open-shifts" (the Monday cron) shares the gate
    // and the dryRun contract above; everything below this block is the hourly
    // reminder, unchanged.
    const mode = body && body.mode !== undefined ? body.mode : "reminder";
    if (mode !== "reminder" && mode !== "open-shifts") {
      return json(400, { error: `mode must be "open-shifts" or omitted (got ${JSON.stringify(mode).slice(0, 40)}); nothing was sent` });
    }
    if (mode === "open-shifts") return await runOpenShifts(centralNow(), dryRun);

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
