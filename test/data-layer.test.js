#!/usr/bin/env node
/*
 * Silvis Call Schedule - data-layer unit tests + source pins (Prompt 6 Slice A).
 *
 *   A. helpers.js: dayRowToAssignment / assignmentToDayRow round trip
 *   B. diffScheduleDays / formatDayChange / describePublishDiff
 *   C. wipe predicates: payloadLooksWipedDaily, scheduleWipeCheck, countPopulatedPrimary
 *   D. config.js in a browser-like sandbox: payloadLooksWiped delegates to the
 *      daily predicate, buildTimeOffMaps is a single vacations map, snapshots
 *      capture/normalize/restore fail closed
 *   E. SOURCE PINS on index-source.html: guard-ref grant/consume site counts,
 *      gate-before-consume order, autosave leg order, weekly-model identifiers
 *      absent, the schedule_days CAS literals present, the fix-round-1 guards
 *      (blobLoadedRef gate, realtime merge, reset order, publish arrow)
 *
 * Run: node test/data-layer.test.js   (exit code 1 on any failure)
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const H = require(path.join(ROOT, "helpers.js"));

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log("ok   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n     -> " + (e && e.message ? e.message : e)); }
};
const nameOf = (id) => ({ s1: "Khan", s2: "Burchett", s3: "Acton", s4: "Philip", s5: "Fierce", s6: "Sarkar" }[id] || id);

/* ---------------- A. row <-> assignment ---------------- */
console.log("\n[A] row <-> assignment");
check("dayRowToAssignment maps every column and normalizes blanks", () => {
  const a = H.dayRowToAssignment({ day: "2026-10-12", primary_id: "s4", backup_id: null, primary_locked: true, backup_locked: false, source: "import", external_cover: null, note: "", version: 3 });
  assert.deepStrictEqual(a, { primary: "s4", backup: null, primaryLocked: true, backupLocked: false, source: "import", externalCover: null, note: null });
});
check("dayRowToAssignment of a bad row is an empty assignment (never throws)", () => {
  assert.deepStrictEqual(H.dayRowToAssignment(null), H.emptyDayAssignment());
  assert.deepStrictEqual(H.dayRowToAssignment("x"), H.emptyDayAssignment());
});
check("assignmentToDayRow round-trips and never carries version/updated_*", () => {
  const a = { primary: "s1", backup: "s2", primaryLocked: false, backupLocked: true, source: "manual", externalCover: null, note: "swap" };
  const row = H.assignmentToDayRow("2026-11-02", a);
  assert.deepStrictEqual(row, { day: "2026-11-02", primary_id: "s1", backup_id: "s2", primary_locked: false, backup_locked: true, source: "manual", external_cover: null, note: "swap" });
  assert.strictEqual("version" in row, false);
  assert.deepStrictEqual(H.dayRowToAssignment(row), a);
});
check("assignmentToDayRow tolerates a partial assignment", () => {
  assert.deepStrictEqual(H.assignmentToDayRow("2026-01-01", { primary: "s3" }),
    { day: "2026-01-01", primary_id: "s3", backup_id: null, primary_locked: false, backup_locked: false, source: null, external_cover: null, note: null });
});
check("dayHolder: externalCover stands in for an OPEN primary, never for backup", () => {
  const a = { primary: null, backup: null, externalCover: "Atwell" };
  assert.strictEqual(H.dayHolder(a, "primary"), "ext:Atwell");
  assert.strictEqual(H.dayHolder(a, "backup"), null);
  assert.strictEqual(H.dayHolder({ primary: "s1", externalCover: "Atwell" }, "primary"), "s1");
});

check("sameDayAssignment: null, undefined and an OPEN row compare equal; metadata (source) is part of the row", () => {
  assert.strictEqual(H.sameDayAssignment("2026-10-12", null, undefined), true);
  assert.strictEqual(H.sameDayAssignment("2026-10-12", H.emptyDayAssignment(), undefined), true);
  assert.strictEqual(H.sameDayAssignment("2026-10-12", { primary: "s1" }, { primary: "s1", backup: null }), true);
  assert.strictEqual(H.sameDayAssignment("2026-10-12", { primary: "s1" }, { primary: "s1", source: "manual" }), false);
  assert.strictEqual(H.sameDayAssignment("2026-10-12", { primary: "s1" }, { primary: "s2" }), false);
});
check("mergeRealtimeDay: the datalayer-001 replay keeps the pending backup when the echo of the primary write lands", () => {
  // set P -> autosave writes {P} -> lastSync = {P} -> set B 200ms later -> echo of {P} arrives
  const P = { primary: "s2", backup: null, primaryLocked: false, backupLocked: false, source: "manual", externalCover: null, note: null };
  const PB = { ...P, backup: "s3" };
  const m = H.mergeRealtimeDay("2026-09-01", PB, P, P);
  assert.strictEqual(m.localChanged, true);
  assert.deepStrictEqual(m.next, PB, "the local edit is kept");
  assert.deepStrictEqual(m.lastSync, P, "lastSync advances to what the table holds");
  // the pending diff still exists after the merge -> the next pass PATCHes B
  assert.strictEqual(H.sameDayAssignment("2026-09-01", m.next, m.lastSync), false);
});
check("mergeRealtimeDay: with nothing unsaved locally a foreign row is adopted (local == lastSync)", () => {
  const P = { primary: "s2", backup: null };
  const X = { primary: "s4", backup: "s5", primaryLocked: false, backupLocked: false, source: "manual", externalCover: null, note: null };
  const m = H.mergeRealtimeDay("2026-09-01", P, { primary: "s2" }, X);
  assert.strictEqual(m.localChanged, false);
  assert.deepStrictEqual(m.next, X);
  // first-ever row for a day (no local, no lastSync) is adopted too
  const m2 = H.mergeRealtimeDay("2026-09-02", undefined, undefined, X);
  assert.strictEqual(m2.localChanged, false);
  assert.deepStrictEqual(m2.next, X);
});

/* ---------------- B. diff / format / describe ---------------- */
console.log("\n[B] diff / format / describe");
const prev = {
  "2026-10-12": { primary: "s4", backup: "s3", primaryLocked: false, backupLocked: false, source: "import", externalCover: null, note: null },
  "2026-10-13": { primary: "s4", backup: "s3", primaryLocked: false, backupLocked: false, source: "import", externalCover: null, note: null },
  "2026-10-14": { primary: "s1", backup: "s2", primaryLocked: false, backupLocked: false, source: "import", externalCover: null, note: null },
  "2026-11-01": { primary: "s6", backup: "s5", primaryLocked: false, backupLocked: false, source: "import", externalCover: null, note: "x" },
};
const next = {
  "2026-10-12": { ...prev["2026-10-12"], primary: "s5" },
  "2026-10-13": prev["2026-10-13"],
  // 2026-10-14 dropped entirely -> reads as both roles -> OPEN
  "2026-11-01": { ...prev["2026-11-01"], primaryLocked: true, note: null },
  "2026-11-02": { primary: null, backup: null, primaryLocked: false, backupLocked: false, source: null, externalCover: "Atwell", note: null },
};
const changes = H.diffScheduleDays(prev, next);
check("diffScheduleDays reports each changed role once, sorted by day then role", () => {
  assert.deepStrictEqual(changes.map(c => `${c.day} ${c.role}`), [
    "2026-10-12 primary",
    "2026-10-14 primary", "2026-10-14 backup",
    "2026-11-01 lock", "2026-11-01 note",
    "2026-11-02 primary",
  ]);
});
check("diffScheduleDays: unchanged day and metadata (source) produce nothing", () => {
  assert.strictEqual(changes.some(c => c.day === "2026-10-13"), false);
  assert.deepStrictEqual(H.diffScheduleDays(prev, JSON.parse(JSON.stringify(prev))), []);
  assert.deepStrictEqual(H.diffScheduleDays({ a: { ...prev["2026-10-12"], source: "manual" } }, { a: prev["2026-10-12"] }), []);
});
check("diffScheduleDays: a dropped day reads as -> OPEN, an added day reads from OPEN", () => {
  const dropped = changes.filter(c => c.day === "2026-10-14");
  assert.deepStrictEqual(dropped, [{ day: "2026-10-14", role: "primary", from: "s1", to: null }, { day: "2026-10-14", role: "backup", from: "s2", to: null }]);
  const added = changes.find(c => c.day === "2026-11-02");
  assert.deepStrictEqual(added, { day: "2026-11-02", role: "primary", from: null, to: "ext:Atwell" });
});
check("diffScheduleDays tolerates null/undefined inputs", () => {
  assert.deepStrictEqual(H.diffScheduleDays(null, undefined), []);
  assert.strictEqual(H.diffScheduleDays(undefined, next).length > 0, true);
});
check("formatDayChange renders '10/12 P Philip -> Fierce' (ASCII arrow, no leading zeros)", () => {
  assert.strictEqual(H.formatDayChange(changes[0], nameOf), "10/12 P Philip -> Fierce");
  assert.strictEqual(H.formatDayChange({ day: "2026-01-05", role: "backup", from: null, to: "s2" }, nameOf), "1/5 B OPEN -> Burchett");
  assert.strictEqual(H.formatDayChange({ day: "2026-11-02", role: "primary", from: null, to: "ext:Atwell" }, nameOf), "11/2 P OPEN -> Atwell (external)");
});
check("formatDayChange renders lock and note changes readably", () => {
  assert.strictEqual(H.formatDayChange({ day: "2026-11-01", role: "lock", from: "", to: "P" }, nameOf), "11/1 lock unlocked -> primary locked");
  assert.strictEqual(H.formatDayChange({ day: "2026-11-01", role: "note", from: "x", to: null }, nameOf), '11/1 note "x" -> (none)');
});
check("describePublishDiff groups by month in date order with the formatted lines", () => {
  const g = H.describePublishDiff(changes, nameOf);
  assert.deepStrictEqual(g.map(x => x.label), ["October 2026", "November 2026"]);
  assert.deepStrictEqual(g[0].lines, ["10/12 P Philip -> Fierce", "10/14 P Khan -> OPEN", "10/14 B Burchett -> OPEN"]);
  assert.strictEqual(g[1].key, "2026-11");
  assert.deepStrictEqual(H.describePublishDiff([], nameOf), []);
});

/* ---------------- C. wipe predicates ---------------- */
console.log("\n[C] wipe predicates");
check("payloadLooksWipedDaily: true for nothing, false when any day/vacation/availability exists", () => {
  assert.strictEqual(H.payloadLooksWipedDaily(null), true);
  assert.strictEqual(H.payloadLooksWipedDaily({}), true);
  assert.strictEqual(H.payloadLooksWipedDaily({ schedule: {}, vacations: {}, availability: [] }), true);
  // rows that exist but are all OPEN do not count as data
  assert.strictEqual(H.payloadLooksWipedDaily({ schedule: { "2026-01-01": H.emptyDayAssignment() }, vacations: {}, availability: [] }), true);
  assert.strictEqual(H.payloadLooksWipedDaily({ schedule: { "2026-01-01": { primary: "s1" } } }), false);
  assert.strictEqual(H.payloadLooksWipedDaily({ schedule: { "2026-01-01": { externalCover: "Atwell" } } }), false);
  assert.strictEqual(H.payloadLooksWipedDaily({ vacations: { s1: [["2026-01-01", "2026-01-02", "id"]] } }), false);
  assert.strictEqual(H.payloadLooksWipedDaily({ availability: [{ person_id: "s6" }] }), false);
  // roster/rules alone do not make a payload "real"
  assert.strictEqual(H.payloadLooksWipedDaily({ roster: [{ id: "s1" }], groupRules: {} }), true);
});
check("scheduleWipeCheck: more than half of populated primaries emptied -> wipe", () => {
  const base = {}; for (let i = 1; i <= 10; i++) base["2026-03-" + String(i).padStart(2, "0")] = { primary: "s1", backup: "s2" };
  const half = JSON.parse(JSON.stringify(base)); Object.keys(half).slice(0, 5).forEach(d => { half[d].primary = null; });
  const most = JSON.parse(JSON.stringify(base)); Object.keys(most).slice(0, 6).forEach(d => { most[d].primary = null; });
  assert.deepStrictEqual(H.scheduleWipeCheck(base, half), { baseline: 10, removed: 5, wipe: false });
  assert.deepStrictEqual(H.scheduleWipeCheck(base, most), { baseline: 10, removed: 6, wipe: true });
  assert.deepStrictEqual(H.scheduleWipeCheck(base, {}), { baseline: 10, removed: 10, wipe: true });   // transient-empty render
  assert.deepStrictEqual(H.scheduleWipeCheck({}, base), { baseline: 0, removed: 0, wipe: false });    // first fill is never a wipe
  assert.deepStrictEqual(H.scheduleWipeCheck(base, base), { baseline: 10, removed: 0, wipe: false });
});
check("scheduleWipeCheck: emptying backups only is not a wipe; external cover counts as populated", () => {
  const base = { a: { primary: "s1", backup: "s2" }, b: { primary: null, backup: "s3", externalCover: "Atwell" } };
  const noBackups = { a: { primary: "s1", backup: null }, b: { primary: null, backup: null, externalCover: "Atwell" } };
  assert.strictEqual(H.scheduleWipeCheck(base, noBackups).wipe, false);
  assert.strictEqual(H.countPopulatedPrimary(base), 2);
  assert.strictEqual(H.scheduleWipeCheck(base, { a: { primary: "s1" }, b: {} }).removed, 1);
});

/* ---------------- D. config.js in a sandbox ---------------- */
console.log("\n[D] config.js safeguards (sandboxed)");
const sandbox = {
  console, atob: (s) => Buffer.from(s, "base64").toString("binary"),
  localStorage: { _m: {}, getItem(k) { return this._m[k] === undefined ? null : this._m[k]; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } },
  window: {}, navigator: { userAgent: "node" }, Date, JSON, Math, Object, Array, String, Number, Boolean, RegExp, Error, Promise, encodeURIComponent, setTimeout, clearTimeout,
  __fetch: null,
};
sandbox.fetch = (...a) => sandbox.__fetch(...a);
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "config.js"), "utf8"), sandbox, { filename: "config.js" });
vm.runInContext(fs.readFileSync(path.join(ROOT, "helpers.js"), "utf8"), sandbox, { filename: "helpers.js" });
const C = vm.runInContext("({ payloadLooksWiped, buildTimeOffMaps, snapshots, scheduleMapFromDayRows, INIT_SURGEONS, EDGE_FN_BASE, SUPABASE_URL, getSupabaseRT, dbAuthHeaders })", sandbox);
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
const run = (p) => { let out, err, done = false; p.then(v => { out = v; done = true; }, e => { err = e; done = true; }); return { get: () => { if (!done) throw new Error("promise did not settle synchronously enough for this stub"); if (err) throw err; return out; } }; };
// The stubbed fetch resolves on microtasks only, so awaiting via a tick loop is enough.
const settle = async (p) => await p;

check("config.js and helpers.js load together without top-level errors; the shim block is gone", () => {
  assert.strictEqual(Array.isArray(C.INIT_SURGEONS) && C.INIT_SURGEONS.length === 6, true);
  assert.strictEqual(C.EDGE_FN_BASE, C.SUPABASE_URL + "/functions/v1");
  const src = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
  ["INIT_APPS", "APP_PAL", "COUNTS_1YR", "COUNTS_MULTIYEAR", "NIGHT_KEYS", "ALL_SHIFT_KEYS", "SHIFT_LABELS", "SHIFT_TIMES", "SURGEON_DEPTS", "DEPT_LABELS", "VACATION_DEADLINE_WEEKS_BEFORE", "MIN_AVAILABLE_SURGEONS", "TEMPORARY SHIMS", "holidayRate", "schedule_weeks", "nocall"].forEach(id => {
    assert.strictEqual(src.includes(id), false, "config.js still mentions " + id);
  });
  assert.strictEqual(C.getSupabaseRT(), null, "no SDK in the sandbox -> null client, no throw");
});
check("payloadLooksWiped delegates to the daily predicate", () => {
  assert.strictEqual(C.payloadLooksWiped({ schedule: {}, vacations: {}, availability: [] }), true);
  assert.strictEqual(C.payloadLooksWiped({ schedule: { d: { primary: "s1" } } }), false);
  assert.strictEqual(C.payloadLooksWiped({ appShifts: { x: "a1" } }), true, "the weekly appShifts key no longer counts as data");
});
check("buildTimeOffMaps is a single vacations map with [start, end, id, note], sorted by start", () => {
  const m = C.buildTimeOffMaps([
    { id: "b", person_id: "s2", start_date: "2026-05-02", end_date: "2026-05-03", note: null },
    { id: "a", person_id: "s2", start_date: "2026-04-01", end_date: "2026-04-01", note: "conf" },
    { id: "c", person_id: "s3", start_date: "2026-01-01", end_date: "2026-01-02" },
  ]);
  assert.deepStrictEqual(Object.keys(m).sort(), ["s2", "s3"]);
  assert.deepEqual(m.s2, [["2026-04-01", "2026-04-01", "a", "conf"], ["2026-05-02", "2026-05-03", "b", null]]); // deepEqual: vm-realm arrays
  assert.strictEqual("nc" in m || "vac" in m, false, "returns the map itself, not {vac, nc}");
});
check("scheduleMapFromDayRows keys by day through dayRowToAssignment", () => {
  const m = C.scheduleMapFromDayRows([{ day: "2026-10-12", primary_id: "s4", backup_id: "s3", version: 2 }, { nope: 1 }]);
  assert.deepStrictEqual(Object.keys(m), ["2026-10-12"]);
  assert.strictEqual(m["2026-10-12"].primary, "s4");
});
check("snapshots.normalizePayload accepts the daily shape and rejects the rest with reasons", () => {
  const ok = C.snapshots.normalizePayload({ config: { roster: [] }, schedule_days: [{ day: "2026-01-01" }], time_off: [], availability: null });
  assert.deepEqual(ok, { config: { roster: [] }, schedule_days: [{ day: "2026-01-01" }], time_off: [], availability: [] }); // deepEqual: vm-realm objects
  assert.throws(() => C.snapshots.normalizePayload(null), /not an object/);
  assert.throws(() => C.snapshots.normalizePayload({ schedule_days: { a: 1 } }), /array/);
  assert.throws(() => C.snapshots.normalizePayload({ schedule_days: [{ day: "12/1/2026" }] }), /valid day/);
  assert.throws(() => C.snapshots.normalizePayload({ time_off: [{ person_id: "s1" }] }), /time_off\[0\]/);
  assert.throws(() => C.snapshots.normalizePayload({ config: [] }), /config must be an object/);
  // the old weekly blob shape is not silently accepted as a full backup
  const legacy = C.snapshots.normalizePayload({ surgeons: [], schedule: { "2026-01-05": { dayCall: "s1" } } });
  assert.strictEqual(legacy.schedule_days.length, 0);
});

(async () => {
  const calls = [];
  const setFetch = (table) => { sandbox.__fetch = async (url, opts) => { calls.push({ url: String(url), method: (opts && opts.method) || "GET", body: opts && opts.body ? JSON.parse(opts.body) : null }); return table(String(url), opts); }; };

  await (async () => {
    // D1: a failed source read must NOT look like an empty table -> {ok:false}
    calls.length = 0;
    setFetch((url) => url.includes("schedule_days") ? resp(500, "boom") : resp(200, url.includes("call_schedule_data") ? [{ data: {}, updated_at: "t" }] : []));
    const r = await C.snapshots.capture("test");
    check("snapshots.capture: a failed schedule_days read returns ok:false (no insert)", () => {
      assert.strictEqual(r.ok, false);
      assert.match(r.error, /schedule_days read failed: HTTP 500/);
      assert.strictEqual(calls.some(c => c.method === "POST"), false);
    });
  })();
  await (async () => {
    // D2: everything empty AND blob empty -> skipped, no insert
    calls.length = 0;
    setFetch((url) => resp(200, url.includes("call_schedule_data") ? [{ data: {}, updated_at: "t" }] : []));
    const r = await C.snapshots.capture("test");
    check("snapshots.capture: all tables empty and blob empty -> skipped (no insert)", () => {
      assert.deepEqual(r, { ok: true, skipped: "empty_or_missing" }); // deepEqual: vm-realm object
      assert.strictEqual(calls.some(c => c.method === "POST"), false);
    });
  })();
  await (async () => {
    // D3: rows exist -> insert with the four-array data shape + source_updated_at
    calls.length = 0;
    setFetch((url, opts) => {
      if (opts && opts.method === "POST") return resp(201, "");
      if (url.includes("call_schedule_data")) return resp(200, [{ data: { roster: C.INIT_SURGEONS }, updated_at: "2026-09-22T00:00:00Z" }]);
      if (url.includes("schedule_days")) return resp(200, [{ day: "2026-10-12", primary_id: "s4", version: 1 }]);
      if (url.includes("time_off")) return resp(200, [{ id: "a", person_id: "s2", start_date: "2026-04-01", end_date: "2026-04-01" }]);
      return resp(200, []);
    });
    const r = await C.snapshots.capture("clear_schedule");
    check("snapshots.capture: writes { config, schedule_days, time_off, availability } + source_updated_at", () => {
      assert.strictEqual(r.ok, true);
      assert.deepEqual(r.counts, { schedule_days: 1, time_off: 1, availability: 0 }); // deepEqual: the object was born in the vm realm
      const post = calls.find(c => c.method === "POST");
      assert.ok(post && post.url.endsWith("/rest/v1/call_schedule_snapshots"));
      assert.strictEqual(post.body.reason, "clear_schedule");
      assert.strictEqual(post.body.source_updated_at, "2026-09-22T00:00:00Z");
      assert.deepStrictEqual(Object.keys(post.body.data).sort(), ["availability", "config", "schedule_days", "time_off"]);
      assert.strictEqual(post.body.data.schedule_days[0].day, "2026-10-12");
      assert.strictEqual(post.body.data.config.roster.length, 6);
    });
  })();
  await (async () => {
    // D4: an empty blob with real rows still snapshots (blob emptiness alone never skips)
    calls.length = 0;
    setFetch((url, opts) => {
      if (opts && opts.method === "POST") return resp(201, "");
      if (url.includes("call_schedule_data")) return resp(200, []);
      if (url.includes("availability")) return resp(200, [{ id: "x", person_id: "s6", kind: "available", role: "any", start_date: "2026-11-01", end_date: "2026-11-30" }]);
      return resp(200, []);
    });
    const r = await C.snapshots.capture("test");
    check("snapshots.capture: availability rows alone are enough to snapshot", () => {
      assert.strictEqual(r.ok, true);
      assert.strictEqual(calls.filter(c => c.method === "POST").length, 1);
    });
  })();
  await (async () => {
    // D5: insert failure -> ok:false
    setFetch((url, opts) => (opts && opts.method === "POST") ? resp(403, "denied") : resp(200, url.includes("schedule_days") ? [{ day: "2026-10-12", primary_id: "s4" }] : (url.includes("call_schedule_data") ? [{ data: {}, updated_at: null }] : [])));
    const r = await C.snapshots.capture("test");
    check("snapshots.capture: insert failure returns ok:false", () => { assert.strictEqual(r.ok, false); assert.match(r.error, /insert failed: HTTP 403/); });
  })();
  await (async () => {
    // D6: restore refuses to bypass the appliers
    const r1 = await C.snapshots.restore("id", null, null);
    const r2 = await C.snapshots.restore("id", async () => ({ ok: true }), null);
    check("snapshots.restore refuses without BOTH appliers (CAS sync + table upserts)", () => {
      assert.strictEqual(r1.ok, false); assert.match(r1.error, /schedule applier/);
      assert.strictEqual(r2.ok, false); assert.match(r2.error, /table applier/);
    });
  })();
  await (async () => {
    // D7: applyPayload refuses an empty backup and aborts when the pre-capture fails
    let applied = 0;
    const applySched = async () => { applied++; return { ok: true }; };
    const applyTables = async () => { applied++; return { ok: true, counts: {} }; };
    const empty = await C.snapshots.applyPayload({ config: {}, schedule_days: [], time_off: [], availability: [] }, applySched, applyTables, "before_import");
    setFetch((url) => url.includes("schedule_days") ? resp(500, "down") : resp(200, url.includes("call_schedule_data") ? [{ data: {}, updated_at: null }] : []));
    const blocked = await C.snapshots.applyPayload({ config: {}, schedule_days: [{ day: "2026-10-12", primary_id: "s4" }], time_off: [], availability: [] }, applySched, applyTables, "before_import");
    check("snapshots.applyPayload: empty backup refused; pre-capture failure aborts before any write", () => {
      assert.strictEqual(empty.ok, false); assert.match(empty.error, /looks empty/);
      assert.strictEqual(blocked.ok, false); assert.match(blocked.error, /restore aborted/);
      assert.strictEqual(applied, 0);
    });
  })();
  await (async () => {
    // D8: happy path: capture -> blob upsert -> CAS applier -> table applier, in that order
    const order = [];
    calls.length = 0;
    setFetch((url, opts) => {
      if (opts && opts.method === "POST" && url.includes("call_schedule_snapshots")) { order.push("snapshot"); return resp(201, ""); }
      if (opts && opts.method === "POST" && url.includes("call_schedule_data")) { order.push("blob"); return resp(201, ""); }
      if (url.includes("call_schedule_data")) return resp(200, [{ data: { roster: [] }, updated_at: "t0" }]);
      if (url.includes("schedule_days")) return resp(200, [{ day: "2026-01-01", primary_id: "s1" }]);
      return resp(200, []);
    });
    let schedGiven = null;
    const r = await C.snapshots.applyPayload(
      { config: { roster: C.INIT_SURGEONS, groupRules: { x: 1 } }, schedule_days: [{ day: "2026-10-12", primary_id: "s4", backup_id: "s3", version: 7 }], time_off: [{ id: "a", person_id: "s2", start_date: "2026-04-01", end_date: "2026-04-01" }], availability: [] },
      async (sched) => { order.push("cas"); schedGiven = sched; return { ok: true }; },
      async (t) => { order.push("tables"); return { ok: true, counts: { time_off_upserted: t.time_off.length } }; },
      "before_restore");
    check("snapshots.applyPayload: order is snapshot -> blob -> CAS applier -> table applier, schedule passed as a day map", () => {
      assert.strictEqual(r.ok, true, JSON.stringify(r));
      assert.deepStrictEqual(order, ["snapshot", "blob", "cas", "tables"]);
      assert.deepStrictEqual(Object.keys(schedGiven), ["2026-10-12"]);
      assert.strictEqual(schedGiven["2026-10-12"].primary, "s4");
      assert.strictEqual(r.counts.time_off_upserted, 1);
      const blobPost = calls.find(c => c.method === "POST" && c.url.includes("call_schedule_data"));
      assert.deepStrictEqual(Object.keys(blobPost.body.data).sort(), ["groupRules", "roster"], "the blob gets ONLY the config - never schedule rows");
    });
  })();

  await (async () => {
    // D9: a table past PostgREST max-rows (1000) is PAGED, not truncated
    // (safety-1). 1000 + 200 rows -> counts.schedule_days 1200 and two GETs
    // with limit=1000&offset=0 / offset=1000.
    calls.length = 0;
    const mkDay = (i) => { const d = new Date(Date.UTC(2026, 8, 14)); d.setUTCDate(d.getUTCDate() + i); return { day: d.toISOString().slice(0, 10), primary_id: "s" + (1 + (i % 6)), version: 1 }; };
    const big = Array.from({ length: 1200 }, (_, i) => mkDay(i));
    setFetch((url, opts) => {
      if (opts && opts.method === "POST") return resp(201, "");
      if (url.includes("call_schedule_data")) return resp(200, [{ data: { roster: C.INIT_SURGEONS }, updated_at: "t" }]);
      if (url.includes("schedule_days")) {
        const off = Number((url.match(/offset=(\d+)/) || [])[1] || 0);
        return resp(200, big.slice(off, off + 1000));
      }
      return resp(200, []);
    });
    const r = await C.snapshots.capture("clear_schedule");
    check("snapshots.capture pages schedule_days at 1000: 1200 rows -> 1200 in the snapshot, not 1000", () => {
      assert.strictEqual(r.ok, true, JSON.stringify(r));
      assert.strictEqual(r.counts.schedule_days, 1200);
      const gets = calls.filter(c => c.method === "GET" && c.url.includes("schedule_days"));
      assert.deepStrictEqual(gets.map(c => (c.url.match(/limit=(\d+)&offset=(\d+)/) || []).slice(1).join("/")), ["1000/0", "1000/1000"]);
      const post = calls.find(c => c.method === "POST" && c.url.includes("call_schedule_snapshots"));
      assert.strictEqual(post.body.data.schedule_days.length, 1200);
      assert.strictEqual(post.body.data.schedule_days[1199].day, big[1199].day);
      // every table read is paged the same way (time_off / availability / config)
      for (const t of ["time_off", "availability", "call_schedule_data"]) {
        assert.ok(calls.some(c => c.method === "GET" && c.url.includes(t) && /limit=1000&offset=0/.test(c.url)), t + " read is paged");
      }
    });
  })();
  await (async () => {
    // D10: an exactly-full first page followed by a failed second page is a
    // FAILED capture (ok:false), never a 1000-row "success".
    calls.length = 0;
    setFetch((url, opts) => {
      if (opts && opts.method === "POST") return resp(201, "");
      if (url.includes("call_schedule_data")) return resp(200, [{ data: {}, updated_at: "t" }]);
      if (url.includes("schedule_days")) return /offset=0\b/.test(url) ? resp(200, Array.from({ length: 1000 }, (_, i) => ({ day: "2026-01-01", primary_id: "s1", i }))) : resp(503, "busy");
      return resp(200, []);
    });
    const r = await C.snapshots.capture("test");
    check("snapshots.capture: a failed second page fails the whole capture (no partial snapshot insert)", () => {
      assert.strictEqual(r.ok, false);
      assert.match(r.error, /schedule_days read failed: HTTP 503/);
      assert.strictEqual(calls.some(c => c.method === "POST"), false);
    });
  })();
  await (async () => {
    // D11: a non-array body (a PostgREST error object with HTTP 200 shape, or
    // a proxy page) is a failure, not an empty table.
    calls.length = 0;
    setFetch((url, opts) => {
      if (opts && opts.method === "POST") return resp(201, "");
      if (url.includes("time_off")) return resp(200, { message: "not an array" });
      if (url.includes("call_schedule_data")) return resp(200, [{ data: {}, updated_at: "t" }]);
      return resp(200, []);
    });
    const r = await C.snapshots.capture("test");
    check("snapshots.capture: a non-array response body is a failed read (ok:false), not an empty table", () => {
      assert.strictEqual(r.ok, false);
      assert.match(r.error, /time_off read failed: unexpected response body/);
      assert.strictEqual(calls.some(c => c.method === "POST"), false);
    });
  })();

  /* ---------------- E. source pins ---------------- */
  console.log("\n[E] source pins (index-source.html)");
  // LF-normalize: a Windows checkout without .gitattributes handed us CRLF once and the two-line pins below missed.
  const src = fs.readFileSync(path.join(ROOT, "index-source.html"), "utf8").replace(/\r\n/g, "\n");
  const count = (needle) => src.split(needle).length - 1;
  const rxCount = (rx) => (src.match(rx) || []).length;

  check("exactly one text/babel block; loader order config.js then helpers.js", () => {
    assert.strictEqual(rxCount(/<script\s+type=["']text\/babel["']\s*>/g), 1);
    assert.ok(src.indexOf("'config.js'") < src.indexOf("'helpers.js'"));
  });
  // Guard census. A new grant site needs its own disarm story AND this pin updated.
  check("intentionalScheduleWipeRef granted at exactly 2 sites (clearSchedule, applyScheduleViaCAS)", () => {
    assert.strictEqual(count("intentionalScheduleWipeRef.current = true"), 2);
  });
  check("intentionalScheduleWipeRef consumed at exactly 2 sites (unconditional sync consume + applier finally)", () => {
    assert.strictEqual(count("intentionalScheduleWipeRef.current = false"), 2);
  });
  check("the wipe gate precedes the unconditional consume inside syncScheduleDaysNow", () => {
    const fn = src.indexOf("const syncScheduleDaysNow = async");
    const gate = src.indexOf("chk.wipe && !intentionalScheduleWipeRef.current", fn);
    const consume = src.indexOf("intentionalScheduleWipeRef.current = false;", fn);
    const firstWrite = src.indexOf("await postDayRow(", fn);
    assert.ok(fn > 0 && gate > fn && consume > gate && firstWrite > consume, `fn=${fn} gate=${gate} consume=${consume} firstWrite=${firstWrite}`);
  });
  check("allowWipeSaveRef granted at exactly 1 site (factory reset) and cleared at 2 (autosave consume + reset failure restore)", () => {
    assert.strictEqual(count("allowWipeSaveRef.current = true"), 1);
    assert.strictEqual(count("allowWipeSaveRef.current = false"), 2);
  });
  check("everHadRealDataRef disarmed at exactly 1 site (factory reset) and re-armed on its failure path", () => {
    assert.strictEqual(count("everHadRealDataRef.current = false"), 1);
    const grant = src.indexOf("allowWipeSaveRef.current = true");
    const restore = src.indexOf("allowWipeSaveRef.current = false;\n      everHadRealDataRef.current = true;", grant);
    assert.ok(restore > grant, "the reset failure path must restore both refs");
  });
  check("autosave: the empty-save gate precedes the consume, leg 1 (days) runs before the blob gate", () => {
    const eff = src.indexOf("// --- Supabase: Auto-save on changes ---");
    const gate = src.indexOf("payloadLooksWiped(payload) && everHadRealDataRef.current && !allowWipeSaveRef.current", eff);
    const consume = src.indexOf("allowWipeSaveRef.current = false; // consume one-shot bypass", eff);
    const leg1 = src.indexOf("syncScheduleDays(payload.schedule);", eff);
    const leg2gate = src.indexOf("if (!canWriteBlob) return;", eff);
    const blobUpsert = src.indexOf('.from("call_schedule_data")', eff);
    assert.ok(eff > 0 && gate > eff && consume > gate && leg1 > consume && leg2gate > leg1 && blobUpsert > leg2gate, `eff=${eff} gate=${gate} consume=${consume} leg1=${leg1} leg2gate=${leg2gate} blob=${blobUpsert}`);
  });
  check("blob writes strip schedule / vacations / availability (state-bundle contract)", () => {
    assert.ok(src.includes("delete blobData.schedule; delete blobData.vacations; delete blobData.availability;"));
    assert.strictEqual(count("blobFromBundle("), 3, "autosave + keepalive flush + JSON export");
  });
  check("schedule_days CAS literals present: POST v1, PATCH ?day&version, return=representation, 409 retry, conflict reload", () => {
    assert.ok(src.includes("/rest/v1/schedule_days?select=*&order=day.asc"));
    assert.ok(src.includes("version: 1, updated_by: by, updated_at: ts"));
    assert.ok(src.includes("schedule_days?day=eq.${row.day}&version=eq.${ver}"));
    assert.ok(src.includes("version: ver + 1, updated_by: by, updated_at: ts"));
    assert.ok(src.includes("if (r.status === 409) return { duplicate: true };"));
    assert.ok(src.includes("Changed by someone else - reloaded"));
    assert.strictEqual(rxCount(/Prefer: "return=representation"/g) >= 2, true);
  });
  check("autosave never deletes schedule_days rows; only factory reset issues a DELETE on the table", () => {
    const deletes = src.match(/rest\/v1\/schedule_days[^`"']*`?[^\n]*method: "DELETE"/g) || [];
    assert.strictEqual(deletes.length, 1, "expected exactly the factory-reset delete");
    assert.ok(src.includes("schedule_days?day=not.is.null"));
  });
  check("every write goes through dbAuthHeaders(); reads use dbReadHeaders() or db.query", () => {
    assert.strictEqual(src.includes("headers: dbHeaders"), false, "the bare anon header object must not be used in the component");
    assert.ok(src.includes("{ headers: dbReadHeaders() }"));
  });
  check("signup never sends person_id; invite links are handled like recovery; codeOf exists; calendar-sync uses ?surgeon=<CODE>", () => {
    const signup = src.slice(src.indexOf("const handleAuthSubmit"), src.indexOf("const handleSignOut"));
    assert.strictEqual(signup.includes("person_id"), false, "signup block must not mention person_id");
    assert.ok(src.includes('hash.includes("type=invite")'));
    assert.ok(src.includes("const codeOf = (id)"));
    assert.ok(src.includes("calendar-sync?surgeon=${codeOf(mySurgeon)}"));
    assert.ok(src.includes("calendar-sync?surgeon=${s.code}"));
    assert.ok(src.includes("not linked to a roster entry yet"));
  });
  // Prompt 12 C (9/22): the East refresh prunes east_forecast rows that the new
  // published coverage now covers, says how many in the audit row + toast, the
  // ctx builder passes the forecast pruned to unpublished weeks plus the
  // overrides as their own input, and the East card carries the conflict report.
  check("C.2: refreshEastFeed DELETEs east_forecast rows inside the new published coverage (counted with return=representation) and records forecastRowsDeleted in the east.refresh audit row", () => {
    const fn = src.slice(src.indexOf("const refreshEastFeed = async"), src.indexOf("const saveEastOverride = async"));
    assert.ok(fn.length > 0, "refreshEastFeed not found");
    const del = fn.match(/rest\/v1\/east_forecast\?week_monday=gte\.\$\{[^}]+\}&week_monday=lte\.\$\{[^}]+\}`, \{ method: "DELETE", headers: \{ \.\.\.dbAuthHeaders\(\), Prefer: "return=representation" \}/);
    assert.ok(del, "no DELETE of east_forecast by week_monday range with return=representation inside refreshEastFeed");
    assert.ok(fn.indexOf("coverageOf(feed.weeks)") > 0 && fn.indexOf("coverageOf(feed.weeks)") < fn.indexOf("east_forecast?week_monday"), "the coverage is computed from the fetched published weeks before the delete");
    assert.ok(fn.indexOf("/rest/v1/east_feed") < fn.indexOf("east_forecast?week_monday"), "the delete follows the east_feed upsert");
    assert.match(fn, /logAudit\("east\.refresh",[\s\S]*forecastRowsDeleted/, "the east.refresh audit detail lacks forecastRowsDeleted");
    assert.ok(/couldn't delete the forecast rows/i.test(fn), "a failed forecast delete must toast (never silent)");
    assert.ok(/forecast row\(s\)/.test(fn), "the success toast names the forecast row count");
    // Fix round (review 9/22, findings 5 + 10): a 2xx without an array body records
    // null (count unknown) - never a confident 0 - and the failure is carried by ONE
    // final toast (tone error) after the audit row, not by an earlier toast the
    // summary toast would overwrite (showToast is a single slot).
    assert.ok(fn.includes("Array.isArray(deleted) ? deleted.length : null"), "a non-array DELETE representation must record forecastRowsDeleted null (count unknown), never 0");
    assert.ok(/count unknown/.test(fn), "the audit / toast must say 'count unknown' when the delete succeeded without a representation");
    const toasts = fn.match(/couldn't delete the forecast rows/g) || [];
    assert.strictEqual(toasts.length, 1, "exactly one toast carries the prune failure (found " + toasts.length + ")");
    assert.ok(fn.lastIndexOf("couldn't delete the forecast rows") > fn.indexOf('logAudit("east.refresh"'), "the failure text must be in the FINAL toast (after the audit row), not in an earlier toast that the summary toast overwrites");
    assert.ok(/forecastDeleteError \? "error" : "success"/.test(fn), "the final toast's tone is 'error' when the prune failed");
  });
  check("C.1/C.3: the ctx builder passes the forecast pruned to unpublished weeks (forecastOutsideCoverage) and east_overrides grouped per person as input.eastOverrides", () => {
    const cb = src.slice(src.indexOf("const ctxInputs = useMemo(() => {"), src.indexOf("const rulesCtxState = useMemo"));
    assert.ok(cb.includes("forecastOutsideCoverage("), "ctx builder does not prune the forecast to the unpublished weeks");
    assert.ok(cb.includes("overridesByPerson(eastOverrideRows)"), "ctx builder does not group east_overrides per person");
    assert.match(cb, /eastOverrides[,:]/, "ctx builder does not pass eastOverrides to buildContext");
    // Fix round (findings 3 + 8): prune with the SAME coverage the engine gets - the
    // unresolved-aware one (null while an East id is unresolved) - computed AFTER the
    // resolve loop, so a hard forecast block is never downgraded to 'east-unknown'.
    const covAt = cb.indexOf("const coverage = unresolved ? null : publishedCoverage;");
    assert.ok(covAt >= 0, "the unresolved-aware coverage line is missing");
    assert.ok(cb.includes("forecastOutsideCoverage(forecastAll, coverage)"), "the forecast must be pruned with `coverage` (unresolved-aware), not with publishedCoverage");
    assert.ok(covAt < cb.indexOf("forecastOutsideCoverage(forecastAll, coverage)"), "the prune must follow the unresolved-aware coverage computation");
  });
  check("C.4/C.5: the East card carries the conflict report (data-testid east-conflicts) and the corrected forecast sentence", () => {
    assert.ok(src.includes('data-testid="east-conflicts"'), "no east-conflicts list in the East card");
    assert.ok(src.includes("Refreshing the feed caches Davenport's published weeks and deletes forecast rows for weeks that are now published; the forecast only ever fills weeks Davenport has not published."), "the corrected sentence is missing");
    assert.strictEqual(src.includes("Published weeks replace the forecast automatically"), false, "the old (untrue) sentence is still there");
    assert.ok(src.includes("eastConflicts(rulesCtx"), "the conflict report is not computed from rulesCtx over the schedule map");
    // Fix round (findings 2 + 12): the card's own forecast strip reads the PRUNED map
    // (published coverage applied) and says how many forecast rows are ignored.
    const cs = src.indexOf("function EastFeedCard(");
    const card = src.slice(cs, src.indexOf("\nfunction ", cs + 10));
    assert.ok(card.includes("forecastOutsideCoverage(forecastFromFeedRows(forecastRows || []), cov)"), "EastFeedCard must prune its forecast strip with the published coverage (cov)");
    assert.ok(card.includes("inside the published coverage (ignored)"), "EastFeedCard must say how many forecast rows lie inside the published coverage and are ignored");
    // Fix round (finding 13): the calendar F badge honours an override busy:false.
    const bs = src.indexOf("const badgesFor = (d) => {");
    const badges = src.slice(bs, src.indexOf("return out;", bs));
    assert.ok(badges.includes("P.eastOverrides[d] === false"), "badgesFor must skip the F badge on an override busy:false day");
  });
  check("edge-function base is derived from SUPABASE_URL (no Edge Function URL setting)", () => {
    assert.strictEqual(src.includes("edgeFunctionUrl"), false);
    assert.ok(src.includes("${EDGE_FN_BASE}/office-notifications"));
    assert.ok(src.includes("${EDGE_FN_BASE}/send-notification"));
  });
  check("publish dialog: diff via diffScheduleDays, sends mode publish with the change list, then stores lastPublished", () => {
    const pub = src.slice(src.indexOf("const openPublishDialog"), src.indexOf("const triggerDigestTest"));
    assert.ok(pub.includes("diffScheduleDays(publishedAsSchedule(lastPublished), schedule)"));
    assert.ok(pub.includes('mode: "publish"'));
    assert.ok(pub.indexOf("setLastPublished(") > pub.indexOf("if (!res.ok)"), "watermark stored only after a 2xx");
    assert.ok(src.includes("const triggerDigestTest"));
  });
  check("lastGenerate (Prompt 13 part 4) travels through the state bundle exactly like lastPublished: in buildStateBundle, read back by adoptBlob, written from acceptMerged after the CAS write succeeded, watched by the autosave", () => {
    const bundle = src.slice(src.indexOf("const buildStateBundle = "), src.indexOf("const blobFromBundle = "));
    assert.ok(/settings, lastPublished,\s*\n\s*lastGenerate,/.test(bundle), "buildStateBundle lists lastGenerate next to lastPublished");
    assert.ok(src.includes("if (d.lastGenerate !== undefined) setLastGenerate(d.lastGenerate);"), "adoptBlob reads d.lastGenerate");
    const acc = src.slice(src.indexOf("const acceptMerged = async"), src.indexOf("// --- Seed import"));
    const okAt = acc.indexOf("if (r && r.ok) {"), setAt = acc.indexOf("setLastGenerate(lastGenerateFromDiagnostics(pv.diagnostics, new Date().toISOString(), lastGenerate));"); // P13R (e): the previous record travels too
    assert.ok(okAt > 0 && setAt > okAt && setAt < acc.indexOf("} else if (r && r.blocked)"), "acceptMerged stores the record only in the r.ok branch (a blocked / failed write leaves the old reasons)");
    assert.ok(src.includes("}, [loaded, surgeons, surgeonRules, groupRules, holidays, settings, lastPublished, lastGenerate, schedule, vacations, availabilityRows]);"), "autosave dependencies include lastGenerate");
    assert.ok(src.includes("setLastPublished(null); setLastGenerate(undefined);"), "the state reset clears lastGenerate together with lastPublished");
    assert.strictEqual(count("setLastGenerate("), 3, "adoptBlob + acceptMerged + the state reset only - nothing else writes the record");
  });
  const WEEKLY = ["apps", "appShifts", "noCall", "vacReq", "vacation_requests", "OneSignal", "backupMondays", "fierceBackup", "schedule_weeks", "dayCall", "nights.", "wknd", "SHIFT_LABELS", "NIGHT_KEYS", "COUNTS_", "SURGEON_DEPTS", "call_schedule_config", "send-push", "MIN_AVAILABLE_SURGEONS", "VACATION_DEADLINE", "app_shifts_data", "appDayOff", "AppBadge", "APP_PAL", "holidayAssignments", "pendingLocks", "numWeeks", "startMondayOverride", "priorCounts", "year1Counts", "swapShift", "detectCascadeChanges", "openWeekEditor", "buildPrefs", "doGenerate", "rollForwardCounts", "kind: \"nocall\""];
  check("weekly-model identifiers are absent from index-source.html, config.js, helpers.js and app-styles.js", () => {
    const files = ["index-source.html", "config.js", "helpers.js", "app-styles.js"];
    const hits = [];
    for (const f of files) {
      const text = fs.readFileSync(path.join(ROOT, f), "utf8");
      for (const id of WEEKLY) {
        const rx = id === "apps" ? /\bapps\b/g : new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
        const n = (text.match(rx) || []).length;
        if (n) hits.push(`${f}: ${id} x${n}`);
      }
    }
    assert.deepStrictEqual(hits, []);
  });
  check("no emoji / non-ASCII in the JSX block (ASCII-only convention for new code)", () => {
    const start = src.indexOf('<script type="text/babel">');
    const body = src.slice(start);
    const nonAscii = body.match(/[^\x00-\x7F]/g) || [];
    assert.deepStrictEqual([...new Set(nonAscii)], [], "non-ASCII characters in the babel block: " + [...new Set(nonAscii)].map(c => "U+" + c.charCodeAt(0).toString(16)).join(" "));
  });
  // ---- fix round 1 pins ----
  check("blobLoadedRef: set true at exactly 4 sites (mount read, background refresh, factory reset, restore/import) and never false", () => {
    assert.strictEqual(count("blobLoadedRef.current = true"), 4);
    assert.strictEqual(count("blobLoadedRef.current = false"), 0, "it is a per-session 'have read the blob' fact, never cleared");
    const mount = src.indexOf("// --- Supabase: Load on mount + real-time sync ---");
    const legA = src.indexOf("blobLoadedRef.current = true;", mount);
    const legACatch = src.indexOf('console.error("Supabase load error (call_schedule_data):"', mount);
    const legB = src.indexOf("const loadedDays = await loadScheduleDays();", mount);
    assert.ok(mount > 0 && legA > mount && legACatch > legA && legB > legACatch, "the mount blob read has its own try; the days load follows in a separate try");
    const refresh = src.indexOf("const refreshBlobRow = async () => {");
    const refreshMark = src.indexOf("blobLoadedRef.current = true;", refresh);
    const refreshEarlyReturn = src.indexOf("if (!row?.data) return;", refresh);
    assert.ok(refresh > 0 && refreshMark > refresh && refreshMark < refreshEarlyReturn, "refreshBlobRow marks the blob loaded BEFORE its empty-row early return");
  });
  check("autosave leg 2 and the keepalive blob leg are gated on blobLoadedRef (after the canWriteBlob gate, before the upsert)", () => {
    const eff = src.indexOf("// --- Supabase: Auto-save on changes ---");
    const leg2gate = src.indexOf("if (!canWriteBlob) return;", eff);
    const blobGate = src.indexOf("if (!blobLoadedRef.current) {", eff);
    const blobUpsert = src.indexOf('.from("call_schedule_data")', eff);
    assert.ok(eff > 0 && leg2gate > eff && blobGate > leg2gate && blobUpsert > blobGate, `eff=${eff} leg2gate=${leg2gate} blobGate=${blobGate} upsert=${blobUpsert}`);
    const leg1 = src.indexOf("syncScheduleDays(payload.schedule);", eff);
    assert.ok(leg1 < blobGate, "leg 1 (days) is not behind the blob gate (conventions 3a)");
    const flush = src.indexOf("flushRef.current = (source) => {");
    const flushGate = src.indexOf("if (!blobLoadedRef.current) {", flush);
    const flushBlob = src.indexOf("call_schedule_data?on_conflict=id", flush);
    const flushDays = src.indexOf("schedule_days?on_conflict=day", flush);
    assert.ok(flush > 0 && flushGate > flush && flushGate < flushBlob && flushDays < flushGate, "flush: days leg first, then the blobLoadedRef gate, then the blob POST");
  });
  check("realtime onDayChange merges through mergeRealtimeDay and never overwrites schedule[day] unconditionally", () => {
    const fn = src.indexOf("const onDayChange = (payload) => {");
    const end = src.indexOf("let rtChannel = null;", fn);
    const body = src.slice(fn, end);
    assert.ok(fn > 0 && end > fn);
    assert.ok(body.includes("mergeRealtimeDay(day, (scheduleRef.current || {})[day], base[day], a)"));
    assert.ok(body.includes("if (m.localChanged) {"));
    assert.strictEqual(body.includes("setSchedule(p => { const n = { ...p, [day]: a }"), false, "the unconditional adopt is gone");
    assert.ok(body.indexOf("dayVersionsRef.current[day] = nw.version;") < body.indexOf("if (m.localChanged) {"), "the version map advances regardless");
  });
  check("factory reset: schedule_days DELETE runs before the blob clear; each failure path names what changed", () => {
    const fn = src.indexOf("const resetAllData = async () => {");
    const end = src.indexOf("// --- In-app notifications ---", fn);
    const body = src.slice(fn, end);
    const del = body.indexOf("schedule_days?day=not.is.null");
    const blobClear = body.indexOf("_intentionalClear: true");
    assert.ok(del > 0 && blobClear > del, "DELETE first, blob clear second");
    assert.ok(body.includes("Nothing was changed: the schedule, roster and rules are as they were."));
    assert.ok(body.includes("Partial reset: the schedule rows WERE deleted"));
    assert.strictEqual(body.includes("nothing further was changed"), false, "the old (untrue after a blob clear) message is gone");
    const localClear = body.indexOf("lastSyncRef.current = {};");
    assert.ok(localClear > del && localClear < blobClear, "local schedule state is cleared as soon as the rows are gone");
  });
  check("publish dialog renders a real arrow (single-backslash \\u2192 escape; the source stays ASCII)", () => {
    const line = src.split("\n").find(l => l.includes("u2192"));
    assert.ok(line, "the publish dialog line with the arrow escape exists");
    assert.ok(line.includes('l.replace(" -> ", " \\u2192 ")'), "single-backslash escape");
    assert.strictEqual(line.includes("\\\\u2192"), false, "the double-backslash literal is gone");
    const lit = line.slice(line.indexOf('" \\u2192 "'), line.indexOf('" \\u2192 "') + 10);
    const rendered = new Function("return " + lit)();
    assert.strictEqual(rendered, " \u2192 ");
    assert.strictEqual(rendered.charCodeAt(1), 0x2192);
    assert.strictEqual("10/12 P Philip -> Fierce".replace(" -> ", rendered), "10/12 P Philip \u2192 Fierce");
  });

  check("no helpers.js top-level name collides with config.js / rules.js / east-feed.js / generator.js", () => {
    const decl = (text) => new Set([...text.matchAll(/^(?:const|let|var|function|class|async function)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]));
    const h = decl(fs.readFileSync(path.join(ROOT, "helpers.js"), "utf8"));
    for (const f of ["config.js", "rules.js", "east-feed.js", "generator.js"]) {
      const other = decl(fs.readFileSync(path.join(ROOT, f), "utf8"));
      const both = [...h].filter(n => other.has(n));
      assert.deepStrictEqual(both, [], `helpers.js and ${f} both declare: ${both.join(", ")}`);
    }
  });
  // Prompt 12 B: the importer prefixes a flagged existingAssignments row's schedule_days note with one exact marker;
  // the app shows a "confirm" badge on a locked day whose note starts with it (DayEditor role row beside the padlock,
  // month grid cell). The literal lives in both files and must stay byte-identical.
  check("B: 'confirm' badge - marker literal shared with importer.js, badge testid in the DayEditor role row and the month grid, hover title", () => {
    const imp = fs.readFileSync(path.join(ROOT, "importer.js"), "utf8").replace(/\r\n/g, "\n");
    assert.ok(imp.includes('var IMP_AWAITING_MARKER = "awaiting confirmation - ";'), "importer.js marker literal");
    assert.ok(src.includes('const AWAITING_CONFIRMATION_MARKER = "awaiting confirmation - ";'), "index-source.html marker literal");
    assert.ok(src.includes("const awaitingConfirmation = (a) =>"), "one predicate: a locked day whose note starts with the marker");
    assert.strictEqual(count('data-testid="confirm-badge"'), 2, "DayEditor role row + month grid cell");
    assert.strictEqual(count('data-badge="confirm"'), 1, "the grid badge is readable through [data-badge] like E / F");
    assert.strictEqual(count("awaiting the scheduler's confirmation"), 2, "the hover title on both badges");
    // review B-1: saveDayEdit rebuilds an overridden day's note as '[override: ...] <note>', which moves the marker off
    // index 0 - the predicate strips the app's own override tag (same regex literal as saveDayEdit) before it looks.
    assert.ok(src.includes('const awaitingConfirmation = (a) => !!(a && (a.primaryLocked || a.backupLocked) && typeof a.note === "string" && a.note.replace(/^\\[override:[^\\]]*\\]\\s*/, "").indexOf(AWAITING_CONFIRMATION_MARKER) === 0);'), "the predicate tolerates the '[override: ...] ' prefix saveDayEdit puts in front of the note");
    assert.ok(count("/^\\[override:[^\\]]*\\]\\s*/") >= 2, "saveDayEdit and the predicate share one override-tag regex literal");
    // review B-2: in the month grid the badge is a 13px '?' square like E / F (the header reserves 15px per badge shown),
    // so it never covers the holiday label; the word 'confirm' stays in the day editor where there is room.
    assert.ok(src.includes('<span data-badge="confirm" data-testid="confirm-badge" title="awaiting the scheduler\'s confirmation" style={badge(true, "#c2410c")}>?</span>'), "grid badge = 13px square via badge(), glyph '?'");
    assert.ok(src.includes("paddingRight:Math.max(30, 4 + 15 * nBadges)"), "the cell header widens its reserved gutter per badge shown");
    assert.ok(src.includes("style={confirmBadgeStyle}>confirm</span>"), "the day editor keeps the word 'confirm'");
  });

  /* ---------------- M. outside surgeons (Prompt 12 M) source pins ---------------- */
  console.log("\n[M] outside surgeons pins");
  check("M: the day editor's per-role select carries an 'Outside surgeons' optgroup (data-testid editor-<role>-externals)", () => {
    assert.ok(src.includes('data-testid={"editor-" + role + "-externals"}'), "no optgroup testid in the day editor");
    assert.ok(src.includes('<optgroup label="Outside surgeons"'), "no 'Outside surgeons' optgroup label");
  });
  check("M: a hand-written outside surgeon saves with source 'manual-external' (exactly one literal, in saveDayEdit) and REASON_WORDS glosses external-surgeon", () => {
    assert.strictEqual(count('"manual-external"'), 1, "expected exactly one \"manual-external\" literal in index-source.html");
    const at = src.indexOf('"manual-external"'), fn = src.indexOf("const saveDayEdit = ");
    assert.ok(fn > 0 && at > fn && at < src.indexOf("const proposeTradeForDay"), "the literal must sit inside saveDayEdit");
    assert.ok(src.includes('"external-surgeon": "outside surgeon (written in by hand)"'), "REASON_WORDS lacks external-surgeon");
  });
  check("M: Setup roster has 'Add outside surgeon' (roster-add-external), x-prefixed ids and a note denylist; helpers exports ttOutsideSurgeons; Totals has the section", () => {
    assert.ok(src.includes('data-testid="roster-add-external"'), "no roster-add-external button");
    assert.ok(src.includes("/^x\\d+$/"), "no /^x\\d+$/ id check for externals");
    assert.ok(src.includes("SU_NOTE_DENYLIST"), "the Setup roster note has no denylist gate (item F wording must not reach the anon-readable blob)");
    assert.strictEqual(typeof H.ttOutsideSurgeons, "function");
    assert.ok(src.includes('data-testid="totals-external"') && src.includes('data-testid={"totals-ext-row-" + r.id}'), "Totals lacks the Outside surgeons section / rows");
  });
  check("M: the manual-external literal never appears in the generator or the rules engine (the app writes it; the engine reads roster type only)", () => {
    const g = fs.readFileSync(path.join(ROOT, "generator.js"), "utf8"), r = fs.readFileSync(path.join(ROOT, "rules.js"), "utf8");
    assert.ok(!g.includes('"manual-external"') && !r.includes('"manual-external"'));
    assert.ok(r.includes('"external-surgeon"'), "rules.js lacks the external-surgeon hard reason");
  });
  // review 9/22 (M) fixes
  check("M: the app's seed-import apply merges the live roster's outside surgeons back (impMergeRoster) before writing the blob", () => {
    const at = src.indexOf("impMergeRoster"), from = src.indexOf("// 1) config blob: merge the plan's keys over the live blob");
    assert.ok(from > 0 && at > from && at < src.indexOf("// 2) availability: insert only rows"), "the seed apply's blob merge does not call impMergeRoster (a Setup-added outside surgeon would be dropped by the next Apply)");
  });
  check("M: outside surgeons are hidden from the vacation form, the availability card, the trade counter-party list and the Users roster link (poolSurgeons)", () => {
    assert.ok(src.includes("const poolSurgeons = useMemo("), "no poolSurgeons memo");
    assert.ok(src.includes("renderVacationForm(poolSurgeons)") && !src.includes("renderVacationForm(activeSurgeons)"), "the vacation form still lists externals");
    assert.ok(src.includes("<AvailabilityCard css={css} rows={availabilityRows} roster={poolSurgeons}"), "the availability card still lists externals");
    assert.ok(src.includes("const cands = poolSurgeons.filter(s => s.id !== fromId)"), "the trade counter-party list still offers externals (no account can accept)");
    assert.ok(src.includes("<UsersCard css={css} roster={rosterPool}"), "the Users roster link still offers x-ids");
    assert.ok(src.includes('(roster || []).filter(x => x.type !== "external").map(x => <button key={x.id} data-testid={"rules-pick-" + x.id}'), "Setup -> Rules still offers rule editing (East derived weeks included) for an outside surgeon");
  });
  check("M: the day editor's 'written in by hand' line is an info line (editor-info), never the red error hint, and an override pick of an outside surgeon locks the role too", () => {
    assert.ok(src.includes('data-testid="editor-info"'), "no editor-info line");
    assert.ok(!src.includes('setHint(opt.name + " is an outside surgeon'), "the hand-written note still goes through the red error hint");
    const co = src.indexOf("const confirmOverride = "), cr = src.indexOf("const clearRole = ");
    assert.ok(co > 0 && cr > co && src.slice(co, cr).includes('[p.role + "Locked"]: true'), "confirmOverride does not lock the role for an outside surgeon");
  });
  check("M: Setup issues never nag about rules for an outside surgeon (no rule applies to him)", () => {
    const roster = [{ id: "s1", name: "Khan", code: "FAK", active: true }, { id: "x1", name: "Locum", code: "LOC", active: true, type: "external" }];
    const issues = H.suSetupIssues({ roster, surgeonRules: { s1: {} }, groupRules: {}, holidays: { units: { "2026": ["x"] } }, schedule: { "2026-11-02": { primary: "s1" } }, eastFeedRows: [{ fetched_at: new Date().toISOString() }], nowMs: Date.now() });
    assert.deepStrictEqual(issues.filter(t => /No rules for/.test(t)), [], "issues: " + JSON.stringify(issues));
  });

  /* ---------------- G. small items (Prompt 12, 9/22) ---------------- */
  console.log(String.fromCharCode(10) + "[G] small items 9/22 (one notion of today; day editor fail-closed; block members; Setup fields; wording)");
  check("generator.js rangePresets(null) starts on the CENTRAL date whatever the device zone (genTodayStr = helpers todayCentral)", () => {
    const cp = require("child_process");
    const chicago = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    // one of these two device zones always disagrees with Chicago about the calendar date (they are 26 hours apart)
    const zone = ["Pacific/Kiritimati", "Etc/GMT+12"].find(z => new Date().toLocaleDateString("en-CA", { timeZone: z }) !== chicago);
    assert.ok(zone, "no device zone differs from Chicago right now");
    const code = 'const G = require(process.argv[1]); const d = new Date(); console.log(JSON.stringify({ device: d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"), start: G.rangePresets(null)[0].start }));';
    const r = cp.spawnSync(process.execPath, ["-e", code, path.join(ROOT, "generator.js")], { env: { ...process.env, TZ: zone }, encoding: "utf8" });
    assert.strictEqual(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim());
    assert.notStrictEqual(out.device, chicago, "fixture: the device date under TZ=" + zone + " should differ from Chicago's");
    assert.strictEqual(out.start, chicago, "rangePresets(null).start under TZ=" + zone + ": expected the Central date " + chicago + ", got " + out.start + " (device date " + out.device + ")");
  });
  check("the calendar's default month/year and 'Today' come from todayCentral(), not the device clock", () => {
    assert.ok(src.includes("const [calMonth, setCalMonth] = useState(() => parse(todayCentral()).getMonth());"), "calMonth initialiser");
    assert.ok(src.includes("const [calYear, setCalYear] = useState(() => parse(todayCentral()).getFullYear());"), "calYear initialiser");
    assert.ok(src.includes("const [calYearText, setCalYearText] = useState(() => String(parse(todayCentral()).getFullYear()));"), "calYearText initialiser");
    assert.ok(src.includes("const goToday = () => { const n = parse(todayCentral());"), "goToday");
    assert.strictEqual(count("useState(() => new Date().getMonth())"), 0, "a device-clock month initialiser remains");
  });
  check("empty-schedule note and legend say OPEN is today onward", () => {
    assert.ok(src.includes("No schedule days in the database yet - every day from today shows OPEN."), "empty-schedule note");
    // TH: the legend's OPEN is the theme's red token (T.open = #B91C1C light / #F06060 dark), same wording.
    assert.ok(src.includes('<span style={{color:T.open,fontWeight:800}}>OPEN</span> = nobody assigned (today onward)</span>'), "legend");
    assert.strictEqual(count("= nobody assigned</span>"), 0, "old legend wording remains");
  });
  check("REASON_WORDS glosses the 9/22 soft vocabulary (weekend-primary/backup, window-week targets, consecutive-primary, long-run) plus derived-lock-held, and softTag falls back to it", () => {
    const rw = src.slice(src.indexOf("const REASON_WORDS = {"), src.indexOf("};", src.indexOf("const REASON_WORDS = {")));
    ["weekend-primary", "weekend-backup", "window-week-below-target", "window-week-over-target", "consecutive-primary", "long-run", "derived-lock-held", "backup-opt-out", "external-surgeon", "rules-error"].forEach(k => assert.ok(rw.includes('"' + k + '":'), "REASON_WORDS lacks " + k));
    const st = src.slice(src.indexOf("function softTag(soft) {"), src.indexOf(String.fromCharCode(10) + "}" + String.fromCharCode(10), src.indexOf("function softTag(soft) {")));
    assert.ok(st.includes("default: return REASON_WORDS[key] ? REASON_WORDS[key]"), "softTag does not fall back to REASON_WORDS");
  });
  check("Setup -> Rules: 'Monthly target' hint reads 'blank = equal share; a number = primary target' and a 'Primary contribution' select writes primaryContribution ((none) / weekends)", () => {
    assert.ok(src.includes('<SuField label="Monthly target" hint="blank = equal share; a number = primary target">'), "monthly target hint");
    assert.strictEqual(count('hint="blank = no target"'), 0, "old hint remains");
    const i = src.indexOf('data-testid="rules-primary-contribution"');
    assert.ok(i > 0, "no rules-primary-contribution select");
    const sel = src.slice(src.lastIndexOf("<SuField", i), src.indexOf("</SuField>", i));
    assert.ok(sel.includes('label="Primary contribution"'), "label");
    assert.ok(sel.includes('value={get("primaryContribution", "")}') && sel.includes('set("primaryContribution", e.target.value || undefined)'), "reads/writes surgeonRules.<id>.primaryContribution");
    assert.ok(sel.includes('<option value="">(none)</option>') && sel.includes('<option value="weekends">'), "options (none) / weekends");
    assert.ok(i > src.indexOf('data-testid="rules-weekend-style"'), "sits beside (after) Weekend style");
  });
  check("day editor: a thrown eligibility check fails CLOSED (option ineligible with the error as its reason; Save disabled with a hint)", () => {
    const ev = src.slice(src.indexOf("const evalRole = (role) => {"), src.indexOf("const pick = (role, value) => {"));
    assert.ok(!ev.includes("r = { ok: true, hard: [], soft: [], error: true };"), "a thrown check still yields ok: true");
    assert.ok(ev.includes('r = { ok: false, hard: ["rules-error:" + msg], soft: [], error: msg };'), "thrown check -> ok:false with rules-error:<message>");
    assert.ok(src.includes("const evalBroken = "), "no evalBroken flag");
    assert.ok(src.includes('data-testid="editor-save" onClick={save} disabled={!dirty || evalBroken}'), "Save is not disabled by evalBroken");
    // review (small items): defence in depth - save() itself refuses while evalBroken, not only the button attribute
    const sv = src.slice(src.indexOf("const save = () => {"), src.indexOf("onSave({ ...draft }, { overrides });"));
    assert.ok(sv.includes('if (evalBroken) { setHint("Eligibility check failed - saving is disabled until the rules evaluate again."); return; }'), "save() does not refuse while evalBroken");
    assert.ok(src.includes('data-testid="editor-eval-error"'), "no eval-error hint line");
    assert.ok(src.includes('case "rules-error": return "eligibility check failed: " + arg;'), "reasonLabel lacks rules-error");
  });
  check("asBlockMember flows through the day editor (draft + the other two Fri/Sat/Sun days held by the candidate) and the trade path (full Fri-Sun block, block-style receiver)", () => {
    const ev = src.slice(src.indexOf("const evalRole = (role) => {"), src.indexOf("const pick = (role, value) => {"));
    assert.ok(ev.includes("asBlockMember"), "evalRole never passes asBlockMember");
    assert.ok(src.includes("const editorBlockDays = "), "no editorBlockDays helper (Fri/Sat/Sun triple of the edited day, no holiday-unit day)");
    const tr = src.slice(src.indexOf("const tradeEligibilityOver = (days, role, candidateId) => {"), src.indexOf("const tradeReasonText = "));
    assert.ok(tr.includes("asBlockMember: true") && tr.includes('weekendStyle === "block"'), "tradeEligibilityOver does not evaluate a block-style receiver as a block member");
    assert.ok(src.includes("const tradeIsFullWeekendBlock = (days) => {"), "no tradeIsFullWeekendBlock helper");
  });

  // ---- Prompt 12 AB (9/22 late) ----
  // Faraz: "Default Generate start = first open slot from today. Locks are never touched, so starting at the
  // first gap is safe and catches the October opens and any 11/5-type hole in one run."
  console.log(String.fromCharCode(10) + "[AB] default Generate start = first open slot from today (helpers.suFirstOpenSlotDay + the index-source.html wiring)");
  const full = (p, b) => ({ primary: p, backup: b, primaryLocked: true, backupLocked: true, source: "import", externalCover: null, note: null });
  check("suFirstOpenSlotDay: an open backup on today -> today (a held primary does not make the day filled)", () => {
    const s = { "2026-10-06": full("s2", "s3"), "2026-10-07": full("s3", null), "2026-10-08": full("s4", "s1") };
    assert.strictEqual(H.suFirstOpenSlotDay(s, "2026-10-07"), "2026-10-07");
  });
  check("suFirstOpenSlotDay: a day before today is never a candidate (item Q: past slots are not OPEN) - only past opens -> null", () => {
    const s = { "2026-10-01": full("s2", null), "2026-10-02": full(null, null), "2026-10-03": full("s3", "s4") };
    assert.strictEqual(H.suFirstOpenSlotDay(s, "2026-10-03"), null);
    assert.strictEqual(H.suFirstOpenSlotDay(s, "2026-10-02"), "2026-10-02", "today itself counts");
  });
  check("suFirstOpenSlotDay: a missing day inside the saved span -> that day (an 11/19-type gap between saved rows)", () => {
    const s = { "2026-11-17": full("s2", "s3"), "2026-11-18": full("s3", "s2"), "2026-11-20": full("s2", "s4") };
    assert.strictEqual(H.suFirstOpenSlotDay(s, "2026-11-17"), "2026-11-19");
    assert.strictEqual(H.suFirstOpenSlotDay(s, "2026-11-19"), "2026-11-19", "today can be the missing day");
  });
  check("suFirstOpenSlotDay: externalCover counts as a filled PRIMARY only - Atwell + open backup -> that day; Atwell + held backup -> not a candidate", () => {
    const ext = (b) => ({ primary: null, backup: b, primaryLocked: true, backupLocked: !!b, source: "import", externalCover: "Atwell", note: null });
    assert.strictEqual(H.suFirstOpenSlotDay({ "2026-09-28": ext(null), "2026-09-29": full("s1", "s2") }, "2026-09-28"), "2026-09-28");
    assert.strictEqual(H.suFirstOpenSlotDay({ "2026-09-28": ext("s2"), "2026-09-29": full("s1", "s2") }, "2026-09-28"), null);
  });
  check("suFirstOpenSlotDay: fully assigned -> null; empty map -> null; today after the span -> null; a missing day AFTER the span is not a candidate", () => {
    const s = { "2026-10-01": full("s1", "s2"), "2026-10-02": full("s2", "s3") };
    assert.strictEqual(H.suFirstOpenSlotDay(s, "2026-10-01"), null);
    assert.strictEqual(H.suFirstOpenSlotDay({}, "2026-10-01"), null);
    assert.strictEqual(H.suFirstOpenSlotDay(null, "2026-10-01"), null);
    assert.strictEqual(H.suFirstOpenSlotDay({ "2026-10-01": full("s1", "s2"), "2026-10-05": full(null, null) }, "2026-10-06"), null, "today after the last saved day");
    assert.strictEqual(H.suFirstOpenSlotDay({ "2026-10-01": full("s1", "s2"), "2026-10-03": full("s2", "s1") }, "2026-09-30"), "2026-10-02", "today before the span: the first gap inside the span, never a day before the first row");
  });
  check("suFirstOpenSlotDay on the seed's rows from 2026-09-22 (Central today of the decision) = 2026-10-07: the first open October backup, before the open 10/15 primary", () => {
    const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "silvis-seed.json"), "utf8"));
    const s = {}; seed.existingAssignments.forEach(r => { s[r.date] = { primary: r.primary || null, backup: r.backup || null, primaryLocked: !!r.locked, backupLocked: !!r.locked, source: r.source || null, externalCover: r.externalCover || null, note: null }; });
    assert.strictEqual(H.suFirstOpenSlotDay(s, "2026-09-22"), "2026-10-07");
    assert.strictEqual(H.suFirstOpenSlotDay(s, "2026-10-14"), "2026-10-15", "from 10/14 the next open slot is 10/15 (both roles open)");
    assert.strictEqual(H.suFirstOpenSlotDay(s, "2026-11-18"), "2026-11-19", "the first November gap is a missing day inside the span");
    assert.strictEqual(H.suFirstOpenSlotDay(s, "2026-11-30"), null, "past the last saved row: nothing open -> the caller falls back to the day after the last contiguous day");
  });
  check("index-source.html: genStart = suFirstOpenSlotDay(schedule, todayCentral()) || the day after lastPublishedDay; presets and the later ranges derive from genStart; the panel carries data-gen-start", () => {
    assert.ok(src.includes("const genFirstOpenDay = useMemo(() => suFirstOpenSlotDay(schedule, genToday), [schedule, genToday]);"), "genFirstOpenDay memo (suFirstOpenSlotDay over the saved schedule from the Central today)");
    // AB review fix (9/22 late): the fallback is clamped to today - the day after the contiguous block can lie in the
    // PAST once today passes the last saved row, and a past day is never a start (item Q: past slots are not OPEN).
    assert.ok(src.includes("const genFallback = lastPublishedDay ? suAddDays(lastPublishedDay, 1) : genToday;"), "genFallback = the day after the last contiguous day (today when nothing is on file)");
    assert.ok(src.includes("const genStart = genFirstOpenDay || (genFallback > genToday ? genFallback : genToday);"), "genStart = the first open slot, else the fallback clamped to today (never a past day)");
    assert.strictEqual(count("const genStart = genFirstOpenDay || (lastPublishedDay ? suAddDays(lastPublishedDay, 1) : genToday);"), 0, "the unclamped fallback remains");
    assert.ok(src.includes("const lastPublishedDay = useMemo(() => suLastContiguousDay(schedule), [schedule]);"), "lastPublishedDay still = suLastContiguousDay (the fallback and the panel's last saved day)");
    assert.ok(src.includes("return rangePresets(suAddDays(genStart, -1));"), "presets built from genStart (rangePresets starts the day after its argument)");
    assert.strictEqual(count("rangePresets(lastPublishedDay)"), 0, "the old rangePresets(lastPublishedDay) call remains");
    assert.ok(src.includes("suLaterAssignedRanges(schedule, suAddDays(genStart, -1))"), "laterAssignedRanges = the assigned days from genStart on");
    assert.ok(src.includes('data-testid="gen-last-published" data-gen-start={genStart || ""}'), "gen-last-published span lacks data-gen-start");
    assert.ok(src.includes('"Range starts at the first open slot on or after today: " + genStart + " (locks are never touched; the run fills every open slot from there and generates the rest). Last saved day (end of the contiguous block): " + lastPublishedDay + "."'), "panel sentence (first open slot)");
    assert.ok(src.includes('"No open slot on or after today - the range starts the day after the last saved day (end of the contiguous block: " + lastPublishedDay + "), or today when that day has passed: " + genStart + "."'), "panel sentence (fallback, names the clamp)");
    assert.strictEqual(count("the presets start the day after"), 0, "old panel sentence remains");
    // AB review fix: the ranges list days with ANY held slot (an open backup beside a held primary is in it), so the
    // panel no longer calls them "Locked days" - the run fills the open slots on those days.
    assert.ok(src.includes('" Days with a held slot from the start on: " + laterText + " - locked slots stay as they are while \'respect locks\' is on; the open slots on those days are filled."'), "held-slot days phrase");
    assert.strictEqual(count("Locked days on file from the start on"), 0, "old 'Locked days on file' phrase remains");
    assert.ok(src.includes("genStart={genStart} genFirstOpenDay={genFirstOpenDay}"), "GeneratePanel receives genStart and genFirstOpenDay");
  });

  /* ---------------- TH. theme pins (Prompt 12 items O.1-O.3 + R; O.4 superseded by R) ---------------- */
  console.log("\n[TH] theme - Illini navy structure, orange accent, orange opening, SSC icons");
  const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/[^\n]*/g, "$1").replace(/<!--[\s\S]*?-->/g, "");
  const readRoot = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
  const stylesSrc = readRoot("app-styles.js");
  const manifest = JSON.parse(readRoot("manifest.json"));
  let styles = null;
  check("app-styles.js exports THEME / SURGEON_COLOR_BY_ID / OUTSIDE_SURGEON_COLOR / OPENING / rosterColors / rosterNameColor to Node", () => {
    styles = require(path.join(ROOT, "app-styles.js"));
    for (const k of ["THEME", "SURGEON_COLOR_BY_ID", "OUTSIDE_SURGEON_COLOR", "OPENING", "rosterColors", "rosterNameColor"]) assert.ok(styles && styles[k], "missing export " + k);
  });
  check("O.1 light tokens carry the exact hex values (navy #13294B, accent #FF5F05, orange text #C2410C, tint #FFE8DB, page #F6F8FB, card #FFFFFF, text #1F2A3A, muted #5B6B82, OPEN #B91C1C)", () => {
    const L = styles.THEME.light;
    assert.deepStrictEqual(
      { navy: L.navy, accent: L.accent, accentText: L.accentText, accentTint: L.accentTint, bg: L.bg, surface: L.surface, text: L.text, muted: L.muted, open: L.open, onAccent: L.onAccent },
      { navy: "#13294B", accent: "#FF5F05", accentText: "#C2410C", accentTint: "#FFE8DB", bg: "#F6F8FB", surface: "#FFFFFF", text: "#1F2A3A", muted: "#5B6B82", open: "#B91C1C", onAccent: "#13294B" });
  });
  check("O.2 dark tokens carry the exact hex values (bg #0B1A33, surface #13294B, text #E6ECF5, accent #FF8A4C, muted #9FB0C8)", () => {
    const D = styles.THEME.dark;
    assert.deepStrictEqual({ bg: D.bg, surface: D.surface, text: D.text, accent: D.accent, muted: D.muted }, { bg: "#0B1A33", surface: "#13294B", text: "#E6ECF5", accent: "#FF8A4C", muted: "#9FB0C8" });
    assert.deepStrictEqual(Object.keys(D).sort(), Object.keys(styles.THEME.light).sort(), "light and dark define the same token names");
  });
  check("O.3 per-surgeon colours are a table keyed by roster ID (s1 navy #1F3A6B, s2 orange #D9561A, s3 teal #0F766E, s4 plum #6B3FA0, s5 olive #6B7F1A, s6 slate #475569), never by name in code", () => {
    const M = styles.SURGEON_COLOR_BY_ID;
    assert.deepStrictEqual(Object.keys(M), ["s1", "s2", "s3", "s4", "s5", "s6"]);
    assert.deepStrictEqual(Object.fromEntries(Object.keys(M).map(k => [k, M[k].tx])), { s1: "#1F3A6B", s2: "#D9561A", s3: "#0F766E", s4: "#6B3FA0", s5: "#6B7F1A", s6: "#475569" });
    for (const k of Object.keys(M)) for (const f of ["tx", "bd", "tg", "dk"]) assert.match(M[k][f], /^#[0-9A-F]{6}$/, `${k}.${f}`);
    const code = stripComments(stylesSrc);
    for (const nm of ["Khan", "Burchett", "Acton", "Philip", "Fierce", "Sarkar", "FAK", "MAB", "BDA", "AFP", "SRK"]) assert.ok(!new RegExp('["\']?' + nm + '["\']?\\s*:').test(code), "colour table keyed by " + nm);
    assert.strictEqual((stylesSrc.match(/\bSURGEON_COLOR_BY_CODE\b/g) || []).length, 0, "app-styles.js must not read the code-keyed Davenport table");
  });
  check("O.3 outside surgeons: grey #737373 with a dashed border, resolved by roster type through rosterColors(entry)", () => {
    const X = styles.OUTSIDE_SURGEON_COLOR;
    assert.strictEqual(X.tx, "#737373"); assert.strictEqual(X.dashed, true);
    assert.strictEqual(styles.rosterColors({ id: "x9", type: "external", name: "Atwell" }, 0), X);
    assert.strictEqual(styles.rosterColors({ id: "s2", name: "Burchett" }, 1), styles.SURGEON_COLOR_BY_ID.s2);
    assert.strictEqual(styles.rosterColors({ id: "s7", name: "Newhire" }, 6).tx !== undefined, true, "an unpinned roster id still gets a colour");
    assert.strictEqual(styles.rosterNameColor(styles.SURGEON_COLOR_BY_ID.s1, false), "#1F3A6B");
    assert.strictEqual(styles.rosterNameColor(styles.SURGEON_COLOR_BY_ID.s1, true), styles.SURGEON_COLOR_BY_ID.s1.dk);
  });
  check("index-source.html resolves every surgeon colour through rosterColors / rosterNameColor (no surgeonColors / surgeonTextColor by name) and the dk* variables come from THEME", () => {
    assert.strictEqual(count("surgeonColors("), 0, "index-source.html still calls config.js surgeonColors(name)");
    assert.strictEqual(count("surgeonTextColor("), 0, "index-source.html still calls helpers.js surgeonTextColor(code)");
    assert.ok(count("rosterColors(") >= 3, "rosterColors call sites (grid/colorOf, audit, painter)");
    assert.ok(src.includes('const T = THEME[dk ? "dark" : "light"];'), "T = THEME[dark|light]");
    for (const v of ["const dkBg = T.bg;", "const dkText = T.text;", "const dkSubtext = T.muted;", "const dkCardBorder = T.border;"]) assert.ok(src.includes(v), "missing " + v);
  });
  check("R.2 <meta name=\"theme-color\"> is #FF5F05 and manifest.json has theme_color + background_color #FF5F05 with name / short_name / both icons kept", () => {
    assert.ok(src.includes('<meta name="theme-color" content="#FF5F05">'), "meta theme-color");
    assert.strictEqual(manifest.theme_color, "#FF5F05");
    assert.strictEqual(manifest.background_color, "#FF5F05");
    assert.strictEqual(manifest.name, "Silvis Surgical Care Call Schedule");
    assert.strictEqual(manifest.short_name, "Silvis Call");
    assert.deepStrictEqual(manifest.icons.map(i => i.src + " " + i.sizes + " " + i.purpose), ["icon-192.png 192x192 any maskable", "icon-512.png 512x512 any maskable"]);
  });
  check("R.1 the three icon files are the supplied SSC tiles byte-for-byte (sha256 de6f32a6c6cc / 4a712c33e8ca / 55c55e57ad28)", () => {
    const sha = (f) => require("crypto").createHash("sha256").update(fs.readFileSync(path.join(ROOT, f))).digest("hex");
    assert.deepStrictEqual({ "icon-512.png": sha("icon-512.png").slice(0, 12), "icon-192.png": sha("icon-192.png").slice(0, 12), "apple-touch-icon.png": sha("apple-touch-icon.png").slice(0, 12) },
      { "icon-512.png": "de6f32a6c6cc", "icon-192.png": "4a712c33e8ca", "apple-touch-icon.png": "55c55e57ad28" });
  });
  check("R.3 the opening gradient is the orange #FF5F05 -> #E8520A with white text, defined once (OPENING) and used by the sign-in / biometric / loading tiles, the opening buttons + links and the crash screen", () => {
    assert.deepStrictEqual({ start: styles.OPENING.start, end: styles.OPENING.end, text: styles.OPENING.text }, { start: "#FF5F05", end: "#E8520A", text: "#FFFFFF" });
    assert.strictEqual(styles.OPENING.gradient, "linear-gradient(135deg,#FF5F05,#E8520A)");
    assert.ok(count("OPENING.gradient") >= 5, "opening tiles + crash button use OPENING.gradient (found " + count("OPENING.gradient") + ")");
    assert.ok(count("css.cta") >= 4, "the sign-in / create / reset / set-password / biometric buttons use css.cta (found " + count("css.cta") + ")");
    assert.ok(count("color:T.accentText") + count("color: T.accentText") >= 4, "opening links use the orange text token");
  });
  check("R.4 no Davenport blue (#1a6fa8 / #2488c8), old theme green (1f7a5c) or 'DSG' outside comments in index-source.html, app-styles.js, manifest.json, config.js, helpers.js", () => {
    const hits = [];
    for (const f of ["index-source.html", "app-styles.js", "manifest.json", "config.js", "helpers.js"]) {
      const code = stripComments(readRoot(f));
      for (const needle of ["#1a6fa8", "#2488c8", "1f7a5c", "DSG"]) {
        const n = (code.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")) || []).length;
        if (n) hits.push(`${f}: ${needle} x${n}`);
      }
    }
    assert.deepStrictEqual(hits, []);
  });
  check("O.1 in-app structure: header bar / nav / primary buttons / card titles are navy tokens, the today ring + active tab underline + count badges are the orange accent, OPEN pills are T.open", () => {
    assert.ok(stylesSrc.includes("hdr: { background:LIGHT.navy"), "css.hdr background is the navy token");
    assert.ok(stylesSrc.includes("cardT: { fontSize:13, fontWeight:700, color:LIGHT.title"), "css.cardT uses the navy title token");
    assert.ok(stylesSrc.includes("borderBottom:`2px solid ${a?(accent||LIGHT.accent)"), "active tab underline is the accent (the caller passes the theme accent)");
    assert.strictEqual(count("css.tab(view===k, T.accent)") + count("css.tab(showNotifs, T.accent)"), 2, "both nav call sites pass T.accent");
    assert.ok(src.includes('border: isToday ? "2px solid " + T.accent'), "today ring is the accent");
    assert.ok(src.includes('className="cal-pill cal-open" style={{color:T.open'), "OPEN pill uses T.open");
    assert.ok(src.includes("<span>orange outline = today</span>"), "legend names the orange outline");
    assert.strictEqual(count("blue outline = today"), 0);
  });
  // Review fixes (wave 9 review of TH).
  const ratio = (a, b) => { const lum = (hex) => { const c = [1, 3, 5].map(i => { let v = parseInt(hex.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }; const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
  check("review: every css.badge call passes the roster entry (never x.name); the two pill buttons carry data-pill; the dark sheet's generic button rule excludes [data-pill] / [data-tab] / the Alerts bell instead of listing tint literals", () => {
    assert.strictEqual((src.match(/css\.badge\([^)]*\.name\)/g) || []).length, 0, "css.badge called with a surgeon NAME (falls through to the fallback colours)");
    assert.strictEqual(count('data-pill="1"'), 2, ".ics download buttons + calendar-sync URL buttons carry data-pill");
    assert.ok(src.includes('button:where(:not([data-pill]):not([data-tab]):not([aria-label="Notifications"])) { color: #C9D6E8 !important; }'), "generic dark button rule keyed on data-pill / data-tab");
    assert.strictEqual(count(':not([style*="background: rgb('), 0, "tint-literal :not() clauses remain in the dark sheet");
  });
  check("review: the Fairness bars use theme tokens (T.barTrack / T.barStart / T.barEnd) - TotalsCard resolves THEME by dk, THEME.light is never hard-wired in the JSX - and the dark fill clears 3:1 on its track", () => {
    assert.strictEqual(count("THEME.light."), 0, "THEME.light hard-wired in the JSX");
    const tc = src.slice(src.indexOf("function TotalsCard("), src.indexOf("function TotalsCard(") + 600);
    assert.ok(tc.includes('const T = THEME[dk ? "dark" : "light"];'), "TotalsCard resolves T from dk");
    assert.ok(src.includes('data-testid="fairness-track" style={{ flex: "1 1 220px", position: "relative", height: 18, background: T.barTrack'), "track uses T.barTrack");
    assert.ok(src.includes('data-testid="fairness-fill" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: pct(r.t.total) + "%", background: overCap(r) ? "#c04040" : `linear-gradient(90deg,${T.barStart},${T.barEnd})`'), "fill uses T.barStart -> T.barEnd");
    for (const th of ["light", "dark"]) { const T = styles.THEME[th]; for (const k of ["barTrack", "barStart", "barEnd"]) assert.match(T[k] || "", /^#[0-9A-F]{6}$/, th + "." + k);
      assert.ok(ratio(T.barStart, T.barTrack) >= 3, `${th} bar start ${T.barStart} on track ${T.barTrack} = ${ratio(T.barStart, T.barTrack).toFixed(2)}:1`);
      assert.ok(ratio(T.barEnd, T.barTrack) >= 3, `${th} bar end ${T.barEnd} on track ${T.barTrack} = ${ratio(T.barEnd, T.barTrack).toFixed(2)}:1`); }
    assert.ok(ratio(styles.THEME.light.onAccent, styles.THEME.light.accent) >= 4.5, "light count-badge digits on the accent read as text (>= 4.5:1)");
  });
  check("review: exports resolve colours through rosterColors(entry, idx) (helpers.js exportColorsFor), app-styles.js no longer rebinds config.js surgeonColors; in one context an id-keyed entry gets its table colour and an external entry grey + dashed", () => {
    assert.strictEqual((stripComments(stylesSrc).match(/\bsurgeonColors\s*=/g) || []).length, 0, "app-styles.js rebinds the config.js surgeonColors declaration");
    const hSrc = readRoot("helpers.js");
    assert.ok(hSrc.includes('if (typeof rosterColors === "function" && entry) {'), "exportColorsFor tries rosterColors first");
    assert.ok(hSrc.includes("rosterColors(entry, idx)"), "exportColorsFor passes the roster entry");
    const vm = require("vm"); const ctx = vm.createContext({ console });
    vm.runInContext(stylesSrc, ctx); vm.runInContext(hSrc, ctx);
    const s1 = vm.runInContext('exportColorsFor({ id: "s1", code: "FAK", name: "Khan" }, 3)', ctx);
    const ext = vm.runInContext('exportColorsFor({ id: "x1", type: "external", code: "ATW", name: "Atwell" }, 0)', ctx);
    assert.strictEqual(s1.tx, "#1F3A6B", "s1 export pill is the id-keyed navy");
    assert.strictEqual(ext.tx, "#737373", "external export pill is grey"); assert.strictEqual(ext.dashed, true);
    assert.ok(hSrc.includes("border-style:dashed"), "the share page pill / legend swatch go dashed for an outside surgeon");
    const H = require(path.join(ROOT, "helpers.js"));
    assert.ok(H.exportColorsFor({ id: "s1" }, 0).tx, "Node without app-styles.js still gets a colour (the export palette)");
  });
  check("review: the grid's weekend header / bracket and the unread-notification tint are theme tokens (no off-palette blues #3d6a8c / #a9c4da / #f0f8ff / #c0d8f0)", () => {
    for (const hex of ["#3d6a8c", "#a9c4da", "#f0f8ff", "#c0d8f0"]) assert.strictEqual(count(hex), 0, hex + " remains");
    assert.ok(src.includes('color: i >= 4 ? (dk ? T.muted : T.title) : dkSubtext'), "weekend header text is a token");
    assert.ok(src.includes('borderTop: "2px solid " + T.navyMuted'), "weekend bracket is T.navyMuted");
    assert.ok(src.includes('background:n.created_at > notifLastSeen ? T.accentTint : "#f8f9fb",border:`1px solid ${n.created_at > notifLastSeen ? T.accent : "#e8ecf0"}`'), "unread notification uses the accent tint + accent border");
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("test runner crashed:", e); process.exit(1); });
