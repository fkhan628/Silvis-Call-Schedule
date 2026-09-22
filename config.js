// Silvis Call Schedule - Configuration & Constants
// Supabase config, DB helpers, data-loss safeguards, roster and palette.
// Ported from the Davenport (DSG) app: the client, safeguards, auth, dbAuth and
// biometric objects are carried over intact (the "bones"); every weekly-shift
// constant was removed. payloadLooksWiped / snapshots are retargeted to
// schedule_days + time_off + availability in Prompt 6 Slice A.

/* ═══════════════════════════════════════════════════
   SUPABASE CONFIG
   ═══════════════════════════════════════════════════ */
const SUPABASE_URL = "https://bzhsroegtagqhutbnsrp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6aHNyb2VndGFncWh1dGJuc3JwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMDg2NjUsImV4cCI6MjEwNTU4NDY2NX0.EFQ8ZS-7KOLIxoB205HeXEnZeWgqT4WjQl5HqBboRLM"; // public anon (publishable) key - safe in client code by design

// Lightweight Supabase REST client (no SDK dependency needed)
const dbHeaders = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" };

// Session-aware headers: returns headers with the logged-in user's JWT when a
// session is stored in localStorage, else falls back to anon-key headers.
// This is what every authenticated WRITE must use so RLS sees the real user.
// NOTE: this deliberately sends the stored token even if it is EXPIRED — an
// expired-token write must fail loudly (401) through each write's error
// contract, never silently degrade to an anon attempt. Reads use
// dbReadHeaders() below, which IS expiry-aware.
function dbAuthHeaders() {
  try {
    const token = localStorage.getItem("silvis-auth-token");
    if (token) return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  } catch(e) { console.warn("dbAuthHeaders: session read failed, using anon:", e); }
  return dbHeaders;
}

// True when the stored JWT is present, decodable, and not within 30s of its
// exp. Defensive by design: ANY parse failure counts as stale (never throws).
function jwtIsFresh(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" && payload.exp * 1000 > Date.now() + 30000;
  } catch (e) { return false; }
}

// READ headers: like dbAuthHeaders(), but if the stored token is expired or
// undecodable, fall back to ANON for this request instead of sending a dead
// token. Root fix for the cold-open race (2026-07-18): the data-load effect's
// first pass runs before the auth path refreshes a >1h-old token, so every
// read 401'd — wiping vacations state pre-PR#14 (the blob-mirror poison behind
// the office-digest incident) and toasting after it. The synced tables are
// anon-readable, so an anon first pass succeeds; reads that DO need identity
// (RLS-filtered rows) return [] and are repaired by the reloadTrigger second
// pass. WRITES must never use this — see dbAuthHeaders above.
function dbReadHeaders() {
  try {
    const token = localStorage.getItem("silvis-auth-token");
    if (token && jwtIsFresh(token)) return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    if (token) console.warn("dbReadHeaders: stored token is expired/undecodable — reading as anon (auth refresh will restore it).");
  } catch(e) { console.warn("dbReadHeaders: session read failed, using anon:", e); }
  return dbHeaders;
}

// The `supabase` wrapper is DELIBERATELY MINIMAL — it implements ONLY the two
// chains the app actually uses:
//   • supabase.from(t).select(cols).eq(col,val).single()  → { data, error }
//       .single() returns the FIRST row or null and never errors on zero rows
//       (maybeSingle semantics) — there is NO .maybeSingle(); use .single().
//   • supabase.from(t).upsert(row)                         → { error }
// For insert/update/delete/order/limit/multiple-filters use db.* (below),
// dbAuth.*, or a raw fetch (see the time_off deletes in index-source.html).
// Any unsupported method throws a clear "not implemented" error. Previously an
// absent method threw a bare "x is not a function" TypeError, which callers'
// catch blocks swallowed — that silence masked a broken delete and a dead
// .maybeSingle() call in the signup path.
const _notImpl = (sig, hint) => () => {
  throw new Error(`supabase wrapper: ${sig} is not implemented — ${hint || "use db.*, dbAuth.*, or a raw fetch."}`);
};
const supabase = {
  from: (table) => ({
    select: (cols) => ({
      eq: (col, val) => ({
        single: async () => {
          // Read path → expiry-aware headers (anon fallback on a dead token).
          const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=${cols}&${col}=eq.${val}`, { headers: dbReadHeaders() });
          // THROW on HTTP failure, exactly like db.query. Previously a failed
          // read returned {data:null, error:null}: a PostgREST error body is an
          // object with message/code and NO `error` key, so rows?.error was
          // undefined and rows?.[0] was undefined — failure was byte-identical
          // to "no such row", AND error:null actively claimed success. Every
          // caller reads only {data}, so a transient 5xx/429 (or a revoked
          // token, or an RLS-blocked read under the anon fallback) silently
          // meant "row absent". At the mount blob read that skipped the whole
          // load block WITHOUT arming loadFailedRef, so a later time_off
          // refresh autosaved default roster/counts/holidays over the real
          // blob and showed "Saved". A genuine empty result is HTTP 200 + []
          // and still returns {data:null} without throwing.
          if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`supabase.${table}.single() failed: HTTP ${res.status} ${body.slice(0, 200)}`);
          }
          const rows = await res.json();
          return { data: rows?.[0] || null, error: rows?.error || null };
        },
        maybeSingle: _notImpl(".eq().maybeSingle()", "use .single(), which already has maybeSingle semantics (first row or null, no error on zero rows)."),
        order: _notImpl(".eq().order()"),
        limit: _notImpl(".eq().limit()"),
        eq: _notImpl("chained .eq().eq()"),
      }),
      single: _notImpl(".select().single() without .eq()"),
      maybeSingle: _notImpl(".select().maybeSingle()"),
      order: _notImpl(".select().order()"),
      limit: _notImpl(".select().limit()"),
      in: _notImpl(".select().in()"),
    }),
    upsert: async (row) => {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: "POST", headers: { ...dbAuthHeaders(), Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(row),
      });
      return { error: res.ok ? null : await res.text() };
    },
    insert: _notImpl("from().insert()", "use db.insert()."),
    update: _notImpl("from().update()", "use db.update()."),
    delete: _notImpl("from().delete()", "use a raw fetch (see the time_off deletes in index-source.html)."),
    eq: _notImpl("from().eq() without .select()"),
  }),
};

// Extended DB helpers for new tables
const db = {
  async query(table, { eq, order, limit, select } = {}) {
    let url = `${SUPABASE_URL}/rest/v1/${table}?select=${select || "*"}`;
    if (eq) Object.entries(eq).forEach(([k, v]) => { url += `&${k}=eq.${v}`; });
    if (order) url += `&order=${order}`;
    if (limit) url += `&limit=${limit}`;
    // Read path → expiry-aware headers (anon fallback on a dead token).
    const res = await fetch(url, { headers: dbReadHeaders() });
    // HTTP failure THROWS, exactly like a network failure already does — a
    // failed read must never be indistinguishable from an empty table. (An
    // RLS-filtered read is HTTP 200 + [] — that's data, not an error, and
    // still returns [].) Every call site already try/catches (the network
    // path has exercised those catches for years); on failure they now keep
    // prior state instead of adopting a wrongly-empty []. The old silent-[]
    // contract let a failed time_off read wipe the vacations state and
    // poison the blob mirror (the 2026-07-18 office-digest incident).
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`db.query(${table}) failed: HTTP ${res.status} ${body.slice(0, 200)}`);
    }
    return await res.json();
  },
  async insert(table, row) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST", headers: { ...dbAuthHeaders(), Prefer: "return=representation" },
      body: JSON.stringify(row),
    });
    const data = await res.json();
    // On failure, return data:null (NOT the PostgREST error body) so callers'
    // `if (data)` success-guards can't mis-fire on the error object — that
    // false-success masked the RLS-blocked notifications insert. `error` still
    // carries the failure detail for callers that check it.
    return { data: res.ok ? (Array.isArray(data) ? data[0] : data) : null, error: res.ok ? null : data };
  },
  async update(table, id, data) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: "PATCH", headers: { ...dbAuthHeaders(), Prefer: "return=representation" },
      body: JSON.stringify(data),
    });
    return { error: res.ok ? null : await res.text() };
  },
  async upsert(table, row) {
    return supabase.from(table).upsert(row);
  },
};

/* ═══════════════════════════════════════════════════
   DATA-LOSS SAFEGUARDS
   ═══════════════════════════════════════════════════
   Context: the May/June 2026 wipe happened because LOAD is permissive
   (only adopts fields that are present) while AUTOSAVE is unconditional
   (always writes the full blob from current state). Any transiently-empty
   state therefore decays the DB one-way. These helpers let the component
   refuse empty-over-real writes and keep recoverable snapshots. */

// A payload "looks wiped" when it carries NONE of the operational data that is
// expensive to recreate: no schedule weeks, no vacations, no APP shifts.
// This deliberately ignores historical count config and the surgeon/APP roster
// (which default to INIT_* and are therefore always "present"). It is true for
// the literal {} blob that the old Reset button wrote, but FALSE for a normal
// clearSchedule (which keeps vacations/appShifts) — so legitimate clears still
// save.
// NOTE: p.schedule/p.vacations here are the reason buildStateBundle keeps
// those keys in the in-memory bundle even though blob writes strip them —
// this predicate IS their consumer. (A dataCounts-marker variant that would
// free the bundle of them was built, verified, and PARKED 2026-08-08 with the
// mirror-retirement cancellation — see REMAINING-WORK.)
function payloadLooksWiped(p) {
  if (!p || typeof p !== "object") return true;
  const noSchedule = !p.schedule || Object.keys(p.schedule).length === 0;
  const noVac      = !p.vacations || Object.keys(p.vacations).length === 0;
  const noApp      = !p.appShifts || Object.keys(p.appShifts).length === 0;
  return noSchedule && noVac && noApp;
}

// Build vacations / noCallDays maps from time_off rows — the same shape the
// app's loadTimeOff produces ({ person_id: [[start, end, id], ...] }, sorted
// by start). Top-level copy so snapshots.capture below can fold time_off;
// the component keeps its own identical local const for now (it shadows this
// one harmlessly — dedupe rides a later refactor, not a data-safety PR).
const buildTimeOffMaps = (rows) => {
  const vac = {}, nc = {};
  (rows || []).forEach(r => {
    const tgt = r.kind === "nocall" ? nc : vac;
    (tgt[r.person_id] = tgt[r.person_id] || []).push([r.start_date, r.end_date, r.id]);
  });
  const byStart = (a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  Object.values(vac).forEach(a => a.sort(byStart));
  Object.values(nc).forEach(a => a.sort(byStart));
  return { vac, nc };
};

// Snapshot helper. Before any destructive write, copy the row that is CURRENTLY
// persisted (not local state) into call_schedule_snapshots so it can always be
// restored by hand. Best-effort: never throws — a snapshot failure must not
// block the user, but it is surfaced to the console.
const snapshots = {
  async capture(reason) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/call_schedule_data?id=eq.main&select=data,updated_at`,
        { headers: dbAuthHeaders() }
      );
      // A FAILED READ MUST NOT LOOK LIKE AN EMPTY ROW. This previously did
      // `res.ok ? json : []` → current=null → the "nothing to snapshot" exit
      // below → {ok:true}. Callers gate destructive actions on .ok, so factory
      // reset / regenerate / clearSchedule all proceeded believing a backup
      // existed when none had been written — the capture-failure-BLOCKS-the-
      // action safeguard (built after two wipe incidents) was hollow. A stale
      // mid-session token guarantees this path: these reads use dbAuthHeaders,
      // which sends the token as-is with no expiry check.
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.warn(`Snapshot capture: source read failed (HTTP ${res.status})`, body.slice(0, 200));
        return { ok: false, error: `source read failed: HTTP ${res.status}` };
      }
      const rows = await res.json();
      let current = rows?.[0]?.data ?? null;
      // The schedule now lives in the schedule_weeks table, not the blob, so
      // fold it back in here — otherwise the snapshot would have no schedule and
      // couldn't restore one. Best-effort: if this fetch fails we still snapshot
      // whatever the blob has.
      try {
        const wres = await fetch(
          `${SUPABASE_URL}/rest/v1/schedule_weeks?select=week_monday,data&order=week_monday.asc`,
          { headers: dbAuthHeaders() }
        );
        if (wres.ok) {
          const wrows = await wres.json();
          if (Array.isArray(wrows) && wrows.length) {
            const sched = {};
            wrows.forEach(r => { sched[r.week_monday] = r.data; });
            current = { ...(current || {}), schedule: sched };
          }
        }
      } catch (e) { console.warn("Snapshot: schedule_weeks fetch failed:", e); }
      // Vacations/no-call live in the time_off table (the blob mirror was
      // retired in PR #18), so fold them back in under the old mirror keys —
      // without this, snapshots carry NO vacations and a time_off wipe would
      // be unrecoverable. Best-effort like the schedule_weeks fold above; the
      // explicit order makes consecutive snapshots byte-stable on ties.
      try {
        const tres = await fetch(
          `${SUPABASE_URL}/rest/v1/time_off?select=id,person_id,kind,start_date,end_date&order=start_date.asc`,
          { headers: dbAuthHeaders() }
        );
        if (tres.ok) {
          const trows = await tres.json();
          if (Array.isArray(trows) && trows.length) {
            const { vac, nc } = buildTimeOffMaps(trows);
            current = { ...(current || {}), vacations: vac, noCallDays: nc };
          }
        }
      } catch (e) { console.warn("Snapshot: time_off fetch failed:", e); }
      // Don't bother snapshotting an already-empty row. This exit is now
      // reached ONLY on a genuine 200 with nothing worth keeping — a real
      // failure returned above — so an empty DB still doesn't block a
      // legitimate reset.
      if (current && !payloadLooksWiped(current)) {
        const ins = await fetch(`${SUPABASE_URL}/rest/v1/call_schedule_snapshots`, {
          method: "POST",
          headers: { ...dbAuthHeaders(), Prefer: "return=minimal" },
          body: JSON.stringify({
            reason: reason || "manual",
            data: current,
            source_updated_at: rows?.[0]?.updated_at ?? null,
          }),
        });
        if (!ins.ok) {
          const body = await ins.text().catch(() => "");
          console.warn(`Snapshot capture: insert failed (HTTP ${ins.status})`, body.slice(0, 200));
          return { ok: false, error: `snapshot insert failed: HTTP ${ins.status}` };
        }
        return { ok: true };
      }
      return { ok: true, skipped: "empty_or_missing" };
    } catch (e) {
      console.warn("Snapshot capture failed:", e);
      return { ok: false, error: String(e) };
    }
  },
  // Returns an ARRAY on success, or NULL when the list could not be loaded.
  // Never [] on failure: the restore UI renders the same "No snapshots yet."
  // for an empty array, so a transient failure read as "you have no backups"
  // in exactly the moment someone is trying to recover. Callers must treat
  // null as "couldn't load" and offer a retry. (Deliberately keeps
  // dbAuthHeaders rather than the expiry-aware read headers: this table is
  // RLS-filtered to [] for anon, so an anon fallback would turn a detectable
  // 401 into an undetectable empty list.)
  async list(limit) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/call_schedule_snapshots?select=id,reason,source_updated_at,created_at&order=created_at.desc&limit=${limit || 25}`,
        { headers: dbAuthHeaders() }
      );
      if (!res.ok) {
        console.warn(`Snapshot list failed (HTTP ${res.status})`);
        return null;
      }
      return await res.json();
    } catch (e) { console.warn("Snapshot list failed:", e); return null; }
  },
  // Periodic safety net: capture at most once per maxAgeHours (default 6), so
  // corruption that never passes through a destructive button still has a
  // recent restore point without flooding the table.
  async captureIfStale(reason, maxAgeHours) {
    try {
      const hours = maxAgeHours || 6;
      const recent = await this.list(1);
      const newest = recent?.[0]?.created_at ? new Date(recent[0].created_at).getTime() : 0;
      if (Date.now() - newest < hours * 3600 * 1000) return { ok: true, skipped: "fresh" };
      return await this.capture(reason || "periodic");
    } catch (e) { return { ok: false, error: String(e) }; }
  },
  // Restore a snapshot: roster/config back into the call_schedule_data blob,
  // schedule back into schedule_weeks. The schedule leg MUST go through the
  // app's own sync (syncSchedWeeks: per-week compare-and-swap + wipe guard),
  // which lives in the component — the caller passes it in as applySchedule.
  // A restore is itself destructive, so the CURRENT state is snapshotted
  // first and the restore aborts if that capture fails.
  async restore(snapshotId, applySchedule) {
    if (!snapshotId) return { ok: false, error: "No snapshot id" };
    if (typeof applySchedule !== "function") {
      return { ok: false, error: "restore() requires the app's schedule applier (the CAS sync path) — refusing to bypass it" };
    }
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/call_schedule_snapshots?id=eq.${encodeURIComponent(snapshotId)}&select=id,reason,created_at,data`,
        { headers: dbAuthHeaders() }
      );
      if (!res.ok) return { ok: false, error: `Snapshot fetch failed (${res.status})` };
      const rows = await res.json();
      const snap = rows?.[0];
      const payload = snap && (typeof snap.data === "string" ? JSON.parse(snap.data) : snap.data);
      if (!payload) return { ok: false, error: "Snapshot not found or has no data" };
      if (payloadLooksWiped(payload)) return { ok: false, error: "Snapshot looks empty — refusing to restore it" };
      const pre = await this.capture("before_restore");
      if (!pre.ok) return { ok: false, error: "Couldn't snapshot the current state first — restore aborted, nothing changed" };
      const schedule = payload.schedule || {};
      const blob = { ...payload }; delete blob.schedule;
      const ts = new Date().toISOString();
      const up = await db.upsert("call_schedule_data", { id: "main", data: blob, updated_at: ts });
      if (up && up.error) return { ok: false, error: "Config write failed: " + up.error };
      const applied = await applySchedule(schedule);
      if (applied && applied.ok === false) {
        return { ok: false, error: applied.error || "Schedule apply failed", blobRestored: true };
      }
      return { ok: true, blob, schedule, ts, reason: snap.reason, created_at: snap.created_at };
    } catch (e) {
      console.warn("Snapshot restore failed:", e);
      return { ok: false, error: String(e) };
    }
  },
};

/* ═══════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════ */
const DAY_HDR = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MO = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const PAL = [
  { tx:"#0e6fa8", bd:"#a8d4f0", tg:"#e8f4fc" },
  { tx:"#a8306a", bd:"#e8a0c8", tg:"#fce8f4" },
  { tx:"#1a8040", bd:"#a0d8b0", tg:"#e8fce8" },
  { tx:"#8a7010", bd:"#e0d090", tg:"#faf4e0" },
  { tx:"#6030a8", bd:"#c0a8e8", tg:"#f0e8fc" },
  { tx:"#2868a8", bd:"#a0c8e8", tg:"#e8f0fc" },
  { tx:"#a85820", bd:"#e8c0a0", tg:"#fcf0e8" },
];

// Pinned surgeon colors keyed by roster CODE (stable across roster order and
// renames). tx = accent (labels, chips), bd = border, tg = soft background.
// FAK keeps the slate blue he has in the Davenport app.
const SURGEON_COLOR_BY_CODE = {
  "FAK": { tx:"#2c5888", bd:"#9cb8d4", tg:"#dde8f4" }, // Khan     - slate blue
  "MAB": { tx:"#8a6a10", bd:"#e0c870", tg:"#fcf3d0" }, // Burchett - warm mustard
  "BDA": { tx:"#3a7048", bd:"#a8c8a8", tg:"#e4f0e0" }, // Acton    - sage green
  "AFP": { tx:"#b06050", bd:"#e8b0a0", tg:"#fcdcd0" }, // Philip   - soft coral
  "NF":  { tx:"#2a3040", bd:"#707888", tg:"#d8dce4" }, // Fierce   - deep charcoal
  "SRK": { tx:"#a04878", bd:"#e0a8c4", tg:"#fce0ec" }, // Sarkar   - dusty rose
};

// Colors for a surgeon by code, last name or id; falls back to the indexed
// palette for anyone not pinned (a future hire).
function surgeonColors(codeOrName, idx) {
  if (codeOrName && SURGEON_COLOR_BY_CODE[codeOrName]) return SURGEON_COLOR_BY_CODE[codeOrName];
  const hit = INIT_SURGEONS.find(s => s.name === codeOrName || s.id === codeOrName);
  if (hit && SURGEON_COLOR_BY_CODE[hit.code]) return SURGEON_COLOR_BY_CODE[hit.code];
  return PAL[(idx || 0) % PAL.length];
}

// Roster fallback for a fresh install; the live roster loads from the
// call_schedule_data blob. Shape: { id, name (last name), code (3-letter chip),
// fullName, active, roles }. NO contact fields: contact data never enters the
// repo or any anon-readable table (guide section 3.1). There is no Atwell.
const INIT_SURGEONS = [
  { id:"s1", name:"Khan", code:"FAK", fullName:"Faraz Khan", active:true, roles:["surgeon","scheduler","admin"] },
  { id:"s2", name:"Burchett", code:"MAB", fullName:"Michael Burchett", active:true, roles:["surgeon"] },
  { id:"s3", name:"Acton", code:"BDA", fullName:"Benjamin Acton", active:true, roles:["surgeon"] },
  { id:"s4", name:"Philip", code:"AFP", fullName:"Andrew Philip", active:true, roles:["surgeon"] },
  { id:"s5", name:"Fierce", code:"NF", fullName:"Nathan Fierce", active:true, roles:["surgeon"] },
  { id:"s6", name:"Sarkar", code:"SRK", fullName:"Dr. Sarkar (first name TBD)", active:true, roles:["surgeon"] },
];

// Holiday fairness rate: lifetime assignments / holidays the surgeon was
// eligible for. ZERO ELIGIBLE (a new hire) MUST resolve to 0, never 0/0 = NaN:
// a NaN comparator makes Array.sort produce arbitrary order with no error.
function holidayRate(count, eligible) {
  if (!eligible || eligible <= 0) return 0;
  return count / eligible;
}

/* ═══════════════════════════════════════════════════
   SUPABASE AUTH HELPERS
   ═══════════════════════════════════════════════════ */
const AUTH_TOKEN_KEY = "silvis-auth-token";
const AUTH_REFRESH_KEY = "silvis-auth-refresh";

const auth = {
  // Get stored session
  getSession() {
    try {
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      const refresh = localStorage.getItem(AUTH_REFRESH_KEY);
      return token ? { access_token: token, refresh_token: refresh } : null;
    } catch(e) { return null; }
  },

  // Store session
  _saveSession(data) {
    try {
      if (data?.access_token) {
        localStorage.setItem(AUTH_TOKEN_KEY, data.access_token);
        if (data.refresh_token) localStorage.setItem(AUTH_REFRESH_KEY, data.refresh_token);
      }
    } catch(e) { console.warn("Couldn't store session (you may be signed out on reload):", e); }
  },

  // Clear session
  _clearSession() {
    try {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      localStorage.removeItem(AUTH_REFRESH_KEY);
    } catch(e) { console.warn("Couldn't clear stored session:", e); }
  },

  // Sign up with email & password
  async signUp(email, password) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) return { user: null, error: data.msg || data.error_description || data.message || "Sign up failed" };
    if (data.access_token) auth._saveSession(data);
    return { user: data.user || data, session: data, error: null };
  },

  // Sign in with email & password
  async signIn(email, password) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) return { user: null, error: data.msg || data.error_description || data.message || "Sign in failed" };
    auth._saveSession(data);
    return { user: data.user, session: data, error: null };
  },

  // Get current user from token
  async getUser() {
    const session = auth.getSession();
    if (!session) return { user: null };
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const user = await res.json();
        return { user };
      }
      // Token rejected. GoTrue may answer 401 OR 403 depending on version/
      // config — attempt a refresh on ANY auth failure when we hold a refresh
      // token, not only on 401. (This project returns 403, which the old
      // 401-only check skipped, silently logging users out on every refresh.)
      if (session.refresh_token) {
        const refreshed = await auth._refresh(session.refresh_token);
        if (refreshed?.user) return refreshed;
      }
      // Refresh wasn't possible or genuinely failed — token is dead.
      auth._clearSession();
      return { user: null };
    } catch (e) {
      // Network error (offline, transient blip). Do NOT clear the session —
      // the token may still be valid. Report no user for now; the next
      // attempt can recover without forcing a fresh login.
      return { user: null, error: "network" };
    }
  },

  // Refresh token
  async _refresh(refreshToken) {
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) { auth._clearSession(); return { user: null }; }
      const data = await res.json();
      auth._saveSession(data);
      return { user: data.user, session: data };
    } catch(e) { auth._clearSession(); return { user: null }; }
  },

  // Sign out
  async signOut() {
    const session = auth.getSession();
    if (session?.access_token) {
      try {
        await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
          method: "POST",
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` },
        });
      } catch(e) { console.warn("Server-side logout failed (session cleared locally anyway):", e); }
    }
    auth._clearSession();
  },

  // Send password reset email
  // The redirect URL is HARDCODED (not built from window.location) because:
  //   1. PWA shortcuts and bookmarks may point to inconsistent paths
  //   2. Some browsers/webviews strip the path segment under redirect
  //   3. Hardcoding ensures reset links always land at the hosted app regardless
  // The hosted app's useEffect detects #type=recovery in the URL hash and
  // switches into "newpassword" mode automatically.
  // NOTE: This URL must ALSO appear in the Supabase dashboard's "Redirect URLs"
  // allow-list (Authentication → URL Configuration). If the allow-list entry
  // doesn't match exactly (including trailing slash), Supabase silently strips
  // redirect_to and falls back to the Site URL default.
  async resetPassword(email) {
    const redirectUrl = "https://fkhan628.github.io/Silvis-Call-Schedule/";
    const url = `${SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectUrl)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        redirect_to: redirectUrl,
        gotrue_meta_security: { captcha_token: "" }
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      return { error: data.msg || data.error_description || data.message || "Reset failed" };
    }
    return { error: null };
  },

  // Update password (after clicking reset link — user has a valid session)
  async updatePassword(newPassword) {
    const session = auth.getSession();
    if (!session?.access_token) return { error: "No active session" };
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: "PUT",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ password: newPassword }),
    });
    if (!res.ok) {
      const data = await res.json();
      return { error: data.msg || data.error_description || data.message || "Update failed" };
    }
    return { error: null };
  },

  // Get auth headers for DB queries (user-level RLS)
  getAuthHeaders() {
    const session = auth.getSession();
    if (!session) return dbHeaders;
    return { ...dbHeaders, Authorization: `Bearer ${session.access_token}` };
  },
};

// DB helper that uses auth token for user_profiles table
const dbAuth = {
  async getProfile(userId) {
    const hdrs = auth.getAuthHeaders();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?id=eq.${userId}&select=*`, { headers: hdrs });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows?.[0] || null;
  },
  async upsertProfile(profile) {
    const hdrs = auth.getAuthHeaders();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles`, {
      method: "POST",
      headers: { ...hdrs, Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(profile),
    });
    if (!res.ok) return { error: await res.text() };
    const data = await res.json();
    return { data: data?.[0] || data, error: null };
  },
  async getAllProfiles() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?select=*`, { headers: dbAuthHeaders() });
    if (!res.ok) return [];
    return await res.json();
  },
};

/* ═══════════════════════════════════════════════════
   BIOMETRIC AUTH (WebAuthn / Face ID / Touch ID)
   ═══════════════════════════════════════════════════ */
const BIOMETRIC_CRED_KEY = "silvis-biometric-cred";
const BIOMETRIC_USER_KEY = "silvis-biometric-user";

const biometric = {
  // Check if WebAuthn platform authenticator is available (Face ID, Touch ID, fingerprint)
  // Returns { available: bool, reason: string } for diagnostics.
  async isAvailable() {
    try {
      if (!window.PublicKeyCredential) {
        return { available: false, reason: "WebAuthn API not present (PublicKeyCredential is undefined). Likely a non-Safari browser or an in-app webview." };
      }
      if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== "function") {
        return { available: false, reason: "isUserVerifyingPlatformAuthenticatorAvailable is not a function on this browser." };
      }
      const result = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (result) {
        return { available: true, reason: "Platform authenticator detected." };
      }
      return { available: false, reason: "API returned false: no platform authenticator (Face ID / Touch ID) reported as available. On fresh PWA installs this sometimes resolves after a device restart, or by enrolling directly via the Try Anyway button below." };
    } catch(e) {
      return { available: false, reason: `API threw: ${e.name || "Error"} — ${e.message || "(no message)"}` };
    }
  },

  // Check if biometric is already enrolled
  isEnrolled() {
    try { return !!localStorage.getItem(BIOMETRIC_CRED_KEY); } catch(e) { return false; }
  },

  // Get stored user email for biometric
  getStoredUser() {
    try { return localStorage.getItem(BIOMETRIC_USER_KEY) || null; } catch(e) { return null; }
  },

  // Register biometric credential (call after successful email/password login)
  async enroll(userId, userEmail) {
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const userIdBytes = new TextEncoder().encode(userId.slice(0, 32));

      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: "Silvis Call Schedule", id: window.location.hostname },
          user: { id: userIdBytes, name: userEmail, displayName: userEmail.split("@")[0] },
          pubKeyCredParams: [
            { alg: -7, type: "public-key" },   // ES256
            { alg: -257, type: "public-key" },  // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: "platform",  // built-in biometric only
            userVerification: "required",         // require Face ID / Touch ID
            residentKey: "preferred",
          },
          timeout: 60000,
        }
      });

      if (credential) {
        // Store credential ID for future authentication
        const credIdArray = Array.from(new Uint8Array(credential.rawId));
        localStorage.setItem(BIOMETRIC_CRED_KEY, JSON.stringify(credIdArray));
        localStorage.setItem(BIOMETRIC_USER_KEY, userEmail);
        return { success: true };
      }
      return { success: false, error: "No credential created" };
    } catch(e) {
      return { success: false, error: e.name === "NotAllowedError" ? "Biometric enrollment was cancelled" : e.message };
    }
  },

  // Authenticate with biometric (call on app open)
  async authenticate() {
    try {
      const credIdJson = localStorage.getItem(BIOMETRIC_CRED_KEY);
      if (!credIdJson) return { success: false, error: "No biometric enrolled" };

      const credIdArray = JSON.parse(credIdJson);
      const credId = new Uint8Array(credIdArray).buffer;
      const challenge = crypto.getRandomValues(new Uint8Array(32));

      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [{ id: credId, type: "public-key", transports: ["internal"] }],
          userVerification: "required",
          timeout: 60000,
        }
      });

      return assertion ? { success: true } : { success: false, error: "Authentication failed" };
    } catch(e) {
      return { success: false, error: e.name === "NotAllowedError" ? "Biometric authentication was cancelled" : e.message };
    }
  },

  // Remove biometric enrollment
  unenroll() {
    try {
      localStorage.removeItem(BIOMETRIC_CRED_KEY);
      localStorage.removeItem(BIOMETRIC_USER_KEY);
    } catch(e) { console.warn("Couldn't remove biometric enrollment keys:", e); }
  },
};

/* =====================================================================
   TEMPORARY SHIMS - Prompt 1 only (remove in Prompt 6 Slice A)
   index-source.html still references these Davenport weekly-model names at
   component top level (useState(INIT_APPS), useState(COUNTS_1YR), ...).
   Without them the first render throws ReferenceError and the app never
   mounts - not even the login gate. Empty values keep the shell alive; every
   feature behind them is dead by design until Slice A deletes the consumers.
   ===================================================================== */
const INIT_APPS = [];
const APP_PAL = [{ tx:"#985020", bd:"#e0b890", tg:"#faf0e4" }];
const COUNTS_1YR = {};
const COUNTS_MULTIYEAR = {};
const NIGHT_KEYS = [];
const ALL_SHIFT_KEYS = [];
const SHIFT_LABELS = {};
const SHIFT_TIMES = {};
const SURGEON_DEPTS = {};
const DEPT_LABELS = {};
const VACATION_DEADLINE_WEEKS_BEFORE = 0;
const MIN_AVAILABLE_SURGEONS = 0;
