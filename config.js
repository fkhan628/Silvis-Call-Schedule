// Silvis Call Schedule - Configuration & Constants
// Supabase config, DB helpers, data-loss safeguards, roster and palette.
// Ported from the Davenport (DSG) app: the client, safeguards, auth, dbAuth and
// biometric objects are carried over intact (the "bones"); every weekly-shift
// constant was removed. payloadLooksWiped / snapshots were retargeted to
// schedule_days + time_off + availability in Prompt 6 Slice A.

/* ═══════════════════════════════════════════════════
   SUPABASE CONFIG
   ═══════════════════════════════════════════════════ */
const SUPABASE_URL = "https://bzhsroegtagqhutbnsrp.supabase.co";
// Edge functions live under the project URL; there is no per-install setting
// for this any more (the Davenport per-install config row is gone).
const EDGE_FN_BASE = SUPABASE_URL + "/functions/v1";
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
  } catch (e) {
    // Still "stale" by contract, but never silently: an undecodable token in
    // storage is worth a line in the console (Prompt 11 hardening).
    console.warn("jwtIsFresh: stored token is not a decodable JWT - treating it as stale:", e);
    return false;
  }
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
    // Read the body as TEXT and check res.ok BEFORE parsing: a non-JSON error
    // body (an HTML 502/504 from a proxy) used to surface as a SyntaxError
    // instead of { error } with the HTTP status (Prompt 11 hardening).
    const text = await res.text().catch(() => "");
    let data = null;
    try { data = text ? JSON.parse(text) : null; }
    catch (e) {
      if (res.ok) { console.warn(`db.insert(${table}): 2xx with a non-JSON body`, text.slice(0, 120)); return { data: null, error: { message: `HTTP ${res.status} with a non-JSON body`, body: text.slice(0, 200) } }; }
      data = { message: `HTTP ${res.status} ${text.slice(0, 200)}`, status: res.status };
    }
    if (!res.ok) console.warn(`db.insert(${table}) failed: HTTP ${res.status}`, text.slice(0, 200));
    if (!res.ok && !data) data = { message: `HTTP ${res.status}`, status: res.status };
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
    // The matched rows come back too (RLS-7): an RLS-filtered PATCH is HTTP 200
    // with ZERO rows - nothing changed - and a caller must be able to tell that
    // from a real update. A 2xx with a non-JSON body counts as zero rows.
    const text = await res.text().catch(() => "");
    let rows = [];
    if (res.ok) {
      try { rows = JSON.parse(text); }
      catch (e) { console.warn(`db.update(${table}): 2xx with a non-JSON body (treated as no row updated)`, text.slice(0, 120)); rows = []; }
    } else console.warn(`db.update(${table}) failed: HTTP ${res.status}`, text.slice(0, 200));
    return { data: Array.isArray(rows) ? rows : [], error: res.ok ? null : (text || `HTTP ${res.status}`) };
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
// expensive to recreate: no populated schedule day, no vacations, no
// availability statements. This deliberately ignores the roster / rules /
// settings (which default and are therefore always "present"). The daily
// predicate itself lives in helpers.js (payloadLooksWipedDaily, unit-tested);
// this name is kept because the guard sites and the snapshot code call it.
// NOTE: p.schedule / p.vacations / p.availability here are the reason
// buildStateBundle keeps those keys in the in-memory bundle even though blob
// writes strip them - this predicate IS their consumer.
function payloadLooksWiped(p) {
  if (typeof payloadLooksWipedDaily === "function") return payloadLooksWipedDaily(p);
  // helpers.js not loaded (should never happen in the app - the loader order
  // is config, helpers, ...). Fail CLOSED: an unknown payload is treated as
  // wiped so the guard refuses the write rather than letting it through.
  console.warn("payloadLooksWiped: payloadLooksWipedDaily is not loaded - treating payload as wiped (write refused).");
  return true;
}

// Build the vacations map from time_off rows - the same shape the app's
// loadTimeOff produces ({ person_id: [[start, end, id, note], ...] }, sorted by
// start). Time off is VACATIONS ONLY at Silvis (there is no kind column and no
// no-call concept), so this is a single map.
const buildTimeOffMaps = (rows) => {
  const vac = {};
  (rows || []).forEach(r => {
    (vac[r.person_id] = vac[r.person_id] || []).push([r.start_date, r.end_date, r.id, r.note || null]);
  });
  const byStart = (a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  Object.values(vac).forEach(a => a.sort(byStart));
  return vac;
};

// Snapshot payload -> the in-memory schedule map (helpers.js translator).
const scheduleMapFromDayRows = (rows) => {
  const sched = {};
  (rows || []).forEach(r => { if (r && r.day) sched[r.day] = dayRowToAssignment(r); });
  return sched;
};

// Snapshot helper. Before any destructive write, copy the row that is CURRENTLY
// persisted (not local state) into call_schedule_snapshots so it can always be
// restored by hand. Best-effort: never throws — a snapshot failure must not
// block the user, but it is surfaced to the console.
// PostgREST silently caps every response at max-rows (Supabase default 1000).
// The snapshot reader pages at this size, exactly like the app's own
// loadScheduleDays, because a snapshot that holds the first 1000 of 1200 days
// reports ok:true and a restore from it writes the missing 200 days EMPTY.
const SNAPSHOT_PAGE = 1000;
const snapshots = {
  // Reads the four persisted sources with the SAME identity the insert will
  // use (dbAuthHeaders). A FAILED READ MUST NOT LOOK LIKE AN EMPTY TABLE:
  // callers gate destructive actions on .ok, so every non-2xx returns
  // {ok:false} - the Davenport hollow-guard bug (`res.ok ? json : []` ->
  // "nothing to snapshot" -> {ok:true}) is exactly what this shape prevents.
  // Pages with limit/offset until a short page; a non-array body THROWS (it
  // is not an empty table either).
  async _readAll(path, label) {
    const all = [];
    let offset = 0;
    for (;;) {
      const sep = path.includes("?") ? "&" : "?";
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}${sep}limit=${SNAPSHOT_PAGE}&offset=${offset}`, { headers: dbAuthHeaders() });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`${label} read failed: HTTP ${res.status} ${body.slice(0, 160)}`);
      }
      const rows = await res.json();
      if (!Array.isArray(rows)) throw new Error(`${label} read failed: unexpected response body (not an array)`);
      for (const r of rows) all.push(r);
      if (rows.length < SNAPSHOT_PAGE) break;
      offset += SNAPSHOT_PAGE;
    }
    return all;
  },
  async capture(reason) {
    try {
      let cfgRows, dayRows, toRows, avRows;
      try {
        cfgRows = await this._readAll("call_schedule_data?id=eq.main&select=data,updated_at", "config");
        dayRows = await this._readAll("schedule_days?select=*&order=day.asc", "schedule_days");
        toRows  = await this._readAll("time_off?select=*&order=start_date.asc,person_id.asc", "time_off");
        avRows  = await this._readAll("availability?select=*&order=start_date.asc,person_id.asc", "availability");
      } catch (e) {
        console.warn("Snapshot capture: source read failed", e);
        return { ok: false, error: String(e && e.message || e) };
      }
      const cfgRow = cfgRows[0] || null;
      let config = cfgRow && cfgRow.data;
      if (typeof config === "string") {
        // A blob that does not parse is CORRUPT, not empty: treating it as
        // empty let the snapshot be skipped with ok:true and a destructive
        // action proceed with nothing saved. Fail the capture instead.
        try { config = JSON.parse(config); }
        catch (e) {
          console.warn("Snapshot capture: the config blob is not valid JSON - refusing to snapshot (and so blocking the action)", e);
          return { ok: false, error: "config blob is not valid JSON: " + String(e && e.message || e) };
        }
      }
      const blobEmpty = !config || typeof config !== "object" || Object.keys(config).length === 0;
      // Skip ONLY when every table is empty AND the blob is empty - a genuine
      // 200 with nothing worth keeping. A real failure returned above, so an
      // empty DB still doesn't block a legitimate reset.
      if (dayRows.length === 0 && toRows.length === 0 && avRows.length === 0 && blobEmpty) {
        return { ok: true, skipped: "empty_or_missing" };
      }
      const data = { config: config || {}, schedule_days: dayRows, time_off: toRows, availability: avRows };
      const ins = await fetch(`${SUPABASE_URL}/rest/v1/call_schedule_snapshots`, {
        method: "POST",
        headers: { ...dbAuthHeaders(), Prefer: "return=minimal" },
        body: JSON.stringify({
          reason: reason || "manual",
          data: data,
          source_updated_at: (cfgRow && cfgRow.updated_at) || null,
        }),
      });
      if (!ins.ok) {
        const body = await ins.text().catch(() => "");
        console.warn(`Snapshot capture: insert failed (HTTP ${ins.status})`, body.slice(0, 200));
        return { ok: false, error: `snapshot insert failed: HTTP ${ins.status}` };
      }
      return { ok: true, counts: { schedule_days: dayRows.length, time_off: toRows.length, availability: avRows.length } };
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
    } catch (e) { console.warn("Snapshot captureIfStale failed:", e); return { ok: false, error: String(e) }; }
  },
  // Validate a snapshot / JSON-backup payload of the daily shape. Returns the
  // normalized payload or throws with a specific reason. Shared by restore()
  // and the Settings JSON import so both paths accept exactly the same thing.
  normalizePayload(payload) {
    if (!payload || typeof payload !== "object") throw new Error("payload is not an object");
    const cfg = payload.config;
    if (cfg !== undefined && (cfg === null || typeof cfg !== "object" || Array.isArray(cfg))) throw new Error("config must be an object");
    const arr = (k) => {
      const v = payload[k];
      if (v === undefined || v === null) return [];
      if (!Array.isArray(v)) throw new Error(`${k} must be an array of rows`);
      return v;
    };
    const days = arr("schedule_days"), to = arr("time_off"), av = arr("availability");
    days.forEach((r, i) => { if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(String(r.day || ""))) throw new Error(`schedule_days[${i}] has no valid day`); });
    to.forEach((r, i) => { if (!r || !r.person_id || !r.start_date || !r.end_date) throw new Error(`time_off[${i}] is missing person_id/start_date/end_date`); });
    av.forEach((r, i) => { if (!r || !r.person_id || !r.kind || !r.start_date || !r.end_date) throw new Error(`availability[${i}] is missing person_id/kind/start_date/end_date`); });
    return { config: cfg || {}, schedule_days: days, time_off: to, availability: av };
  },
  // Restore a snapshot: config back into the call_schedule_data blob, the
  // schedule back into schedule_days THROUGH THE APP'S CAS SYNC (applySchedule,
  // passed in by the component - the same per-day compare-and-swap + wipe
  // guard every schedule write uses), then time_off / availability rows
  // upserted by id via applyTables (merge-duplicates; never deletes). A
  // restore is itself destructive, so the CURRENT state is snapshotted first
  // and the restore aborts if that capture fails.
  async restore(snapshotId, applySchedule, applyTables, onBlobWritten) {
    if (!snapshotId) return { ok: false, error: "No snapshot id" };
    if (typeof applySchedule !== "function") {
      return { ok: false, error: "restore() requires the app's schedule applier (the CAS sync path) - refusing to bypass it" };
    }
    if (typeof applyTables !== "function") {
      return { ok: false, error: "restore() requires the app's table applier (time_off / availability upserts) - refusing to bypass it" };
    }
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/call_schedule_snapshots?id=eq.${encodeURIComponent(snapshotId)}&select=id,reason,created_at,data`,
        { headers: dbAuthHeaders() }
      );
      if (!res.ok) return { ok: false, error: `Snapshot fetch failed (${res.status})` };
      const rows = await res.json();
      const snap = rows?.[0];
      const raw = snap && (typeof snap.data === "string" ? JSON.parse(snap.data) : snap.data);
      if (!raw) return { ok: false, error: "Snapshot not found or has no data" };
      const r = await this.applyPayload(raw, applySchedule, applyTables, "before_restore", onBlobWritten);
      if (!r.ok) return r;
      return { ...r, reason: snap.reason, created_at: snap.created_at };
    } catch (e) {
      console.warn("Snapshot restore failed:", e);
      return { ok: false, error: String(e) };
    }
  },
  // The shared apply step behind restore() and the JSON import. Order:
  // validate -> refuse an empty payload -> snapshot the current state (abort
  // if that fails) -> blob upsert -> onBlobWritten(config, ts) -> CAS schedule
  // apply -> table upserts. onBlobWritten (optional) lets the app adopt the
  // restored setup the moment it is in the DB, BEFORE the schedule leg arms
  // the autosave - otherwise the autosave wrote the pre-restore setup back
  // over it. A leg that fails after the blob landed returns ok:false with
  // blobRestored / scheduleRestored AND the blob it wrote, so the caller
  // reports a PARTIAL restore instead of a failure that "changed nothing".
  async applyPayload(raw, applySchedule, applyTables, preReason, onBlobWritten) {
    let payload;
    try { payload = this.normalizePayload(raw); }
    catch (e) { return { ok: false, error: "Backup shape invalid: " + (e && e.message || e) }; }
    const schedule = scheduleMapFromDayRows(payload.schedule_days);
    const vacations = buildTimeOffMaps(payload.time_off);
    if (payloadLooksWiped({ schedule, vacations, availability: payload.availability })) {
      return { ok: false, error: "Backup looks empty - refusing to restore it" };
    }
    const pre = await this.capture(preReason || "before_restore");
    if (!pre.ok) return { ok: false, error: "Couldn't snapshot the current state first - restore aborted, nothing changed (" + (pre.error || "unknown") + ")" };
    const ts = new Date().toISOString();
    const up = await db.upsert("call_schedule_data", { id: "main", data: payload.config, updated_at: ts });
    if (up && up.error) return { ok: false, error: "Config write failed: " + up.error };
    if (typeof onBlobWritten === "function") {
      try { onBlobWritten(payload.config, ts); }
      catch (e) { console.warn("applyPayload: onBlobWritten threw (the blob is written; the legs continue):", e); }
    }
    const counts = {
      schedule_days: payload.schedule_days.length,
      time_off: payload.time_off.length,
      availability: payload.availability.length,
    };
    // A leg that THROWS (a network exception in a bare fetch) is the same PARTIAL outcome as one that returns
    // ok:false - the blob is already written, so the caller must hear that, never "nothing was changed".
    let applied;
    try { applied = await applySchedule(schedule); }
    catch (e) { applied = { ok: false, error: String(e && e.message || e) }; }
    if (applied && applied.ok === false) {
      return { ok: false, error: applied.error || "Schedule apply failed", blobRestored: true, blob: payload.config, schedule, ts, counts };
    }
    let tables;
    try { tables = await applyTables({ time_off: payload.time_off, availability: payload.availability }); }
    catch (e) { tables = { ok: false, error: String(e && e.message || e) }; }
    if (tables && tables.ok === false) {
      return { ok: false, error: tables.error || "Table restore failed", blobRestored: true, scheduleRestored: true, blob: payload.config, schedule, ts, counts: { ...counts, ...(tables.counts || {}) } };
    }
    return {
      ok: true, blob: payload.config, schedule, ts,
      counts: { ...counts, ...(tables && tables.counts ? tables.counts : {}) },
    };
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

// Lazily-created Supabase JS client for Realtime only (the REST wrapper above
// carries every read/write). The SDK arrives as an ES module (see the module
// script in index-source.html), so this returns null until it has loaded; the
// data-load effect retries on the "supabase-sdk-ready" event and falls back to
// its 60s poll if Realtime never comes up.
let _supabaseRT = null;
function getSupabaseRT() {
  try {
    if (_supabaseRT) return _supabaseRT;
    const sdk = window._supabaseSDK;
    if (!sdk || typeof sdk.createClient !== "function") return null;
    _supabaseRT = sdk.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    return _supabaseRT;
  } catch (e) { console.warn("Realtime client unavailable (poll only):", e); return null; }
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
    } catch(e) { console.warn("auth.getSession: session read failed (reads as signed out):", e); return null; }
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
        // The refresh could not be attempted (network) - the session is kept
        // and the caller sees error:"network", exactly like the first call.
        if (refreshed?.error === "network") return { user: null, error: "network" };
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
      if (!res.ok) {
        console.warn(`auth._refresh: refresh token rejected (HTTP ${res.status}) - clearing the stored session`);
        auth._clearSession();
        return { user: null };
      }
      const data = await res.json();
      auth._saveSession(data);
      return { user: data.user, session: data };
    } catch(e) {
      // A THROWN fetch is a network error (offline, DNS, a transient blip),
      // not a rejected token. Clearing the session here silently logged
      // people out on a bad connection; keep it and report "network".
      console.warn("auth._refresh: network error - session kept, refresh will be retried:", e);
      return { user: null, error: "network" };
    }
  },

  // Sign out
  async signOut() {
    const session = auth.getSession();
    if (session?.access_token) {
      try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
          method: "POST",
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) console.warn(`Server-side logout answered HTTP ${res.status} (session cleared locally anyway):`, (await res.text().catch(() => "")).slice(0, 160));
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

// DB helper that uses auth token for user_profiles table. NO CALLERS in the
// app today (index-source.html reads profiles through fetchProfile /
// loadAllProfilesLoud, which tell "failed" from "empty"). Kept as bones for
// the Davenport parity, but every read now THROWS on a non-2xx: the old
// shape (null / [] on failure) is exactly the silent failure-equals-empty
// contract this codebase must not offer (Prompt 11 hardening).
const dbAuth = {
  async getProfile(userId) {
    const hdrs = auth.getAuthHeaders();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?id=eq.${encodeURIComponent(userId)}&select=*`, { headers: hdrs });
    if (!res.ok) throw new Error(`dbAuth.getProfile failed: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 160)}`);
    const rows = await res.json();
    return Array.isArray(rows) ? (rows[0] || null) : null;
  },
  async upsertProfile(profile) {
    const hdrs = auth.getAuthHeaders();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles`, {
      method: "POST",
      headers: { ...hdrs, Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(profile),
    });
    if (!res.ok) { const t = await res.text().catch(() => ""); console.warn(`dbAuth.upsertProfile failed: HTTP ${res.status}`, t.slice(0, 160)); return { data: null, error: t || `HTTP ${res.status}` }; }
    const data = await res.json();
    return { data: Array.isArray(data) ? (data[0] || null) : data, error: null };
  },
  async getAllProfiles() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?select=*`, { headers: dbAuthHeaders() });
    if (!res.ok) throw new Error(`dbAuth.getAllProfiles failed: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 160)}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("dbAuth.getAllProfiles: unexpected response body (not an array)");
    return rows;
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
    try { return !!localStorage.getItem(BIOMETRIC_CRED_KEY); } catch(e) { console.warn("biometric.isEnrolled: storage read failed (reads as not enrolled):", e); return false; }
  },

  // Get stored user email for biometric
  getStoredUser() {
    try { return localStorage.getItem(BIOMETRIC_USER_KEY) || null; } catch(e) { console.warn("biometric.getStoredUser: storage read failed:", e); return null; }
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
