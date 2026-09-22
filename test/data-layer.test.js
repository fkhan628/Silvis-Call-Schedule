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

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("test runner crashed:", e); process.exit(1); });
