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

interface RosterEntry { id: string; name: string; code: string }
interface Roster { ids: Set<string>; nameById: Record<string, string> }

async function loadRoster(): Promise<Roster> {
  const rows = await rest("call_schedule_data?select=data&id=eq.main");
  const raw = rows?.[0]?.data;
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  const list: RosterEntry[] = Array.isArray(data?.roster) ? data.roster : [];
  const nameById: Record<string, string> = {};
  for (const r of list) if (r?.id) nameById[String(r.id)] = r.name || String(r.id);
  return { ids: new Set(Object.keys(nameById)), nameById };
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

function shell(headline: string, sub: string, name: string, intro: string, changesHtml: string, cta: string): string {
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
        <div style="margin-top:20px;padding-top:14px;border-top:1px solid #e0e4ea;font-size:11px;color:#8a94a0;">
          You are receiving this because you are on the Silvis Surgical Care office distribution list. Reply to this email to be removed.
        </div>
      </div>
    </div>`;
}

function renderDigestEmail(name: string, changesHtml: string): { subject: string; html: string } {
  return {
    subject: `${APP_NAME} - Weekly Update`,
    html: shell(APP_NAME, "Weekly update", name, "The Silvis trauma / acute-care call schedule was updated this week. The changes since the last notice:", changesHtml, "View Current Schedule"),
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
      let baseline = state?.snapshot;
      const usable = baseline && typeof baseline === "object" && baseline.days && typeof baseline.days === "object";
      if (!usable) {
        console.warn("[digest] no usable baseline - first run: rebaseline without mail");
        if (dryRun) return json(200, { mode, dryRun: true, message: "no usable baseline; a live run would rebaseline without mail", would_send: 0, sent: 0, ...summary });
        const ok = await writeState({ snapshot: current, last_digest_at: new Date().toISOString() });
        return json(ok ? 200 : 502, { mode, first_run: true, rebaselined: true, snapshot_updated: ok, sent: 0, ...summary });
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
        if (dryRun) return json(200, { mode, dryRun: true, message: "No changes since last digest", would_send: 0, sent: 0, excluded: diff.excluded, ...summary });
        // Quiet week: still write the current snapshot (rolls the window
        // forward and heals an unstamped baseline).
        const ok = await writeState({ snapshot: current, last_digest_at: new Date().toISOString() });
        return json(200, { mode, message: "No changes since last digest", sent: 0, rebaselined: !vacValid, snapshot_updated: ok, excluded: diff.excluded, ...summary });
      }

      const contacts = await loadContacts();
      console.log(`[digest] ${contacts.length} active contact(s)`);
      const changesHtml = wrapChanges(renderDayChangesHtml(diff.dayChanges, roster) + renderVacationChangesHtml(diff.vacationChanges, roster));
      const counts = {
        affected_surgeons: affectedNames,
        total_day_changes: diff.dayChanges.length,
        total_vacation_changes: diff.vacationChanges.length,
        excluded: diff.excluded,
      };

      if (dryRun) {
        const sample = renderDigestEmail("(contact name)", changesHtml);
        return json(200, { mode, dryRun: true, would_send: contacts.length, sent: 0, sample, ...counts, ...summary });
      }
      if (contacts.length === 0) {
        // Nothing to send; leave the baseline so the changes are reported once a contact exists.
        return json(200, { mode, message: "No active office contacts - baseline left unchanged", sent: 0, ...counts, ...summary });
      }

      const out = await broadcast(contacts, (c) => renderDigestEmail(c.name, changesHtml), "digest");
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
