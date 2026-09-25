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
  // Prompt 14 P5 FLIP (9/23): the normalized payload carries call_offers / call_periods too (empty when the backup predates them)
  assert.deepEqual(ok, { config: { roster: [] }, schedule_days: [{ day: "2026-01-01" }], time_off: [], availability: [], call_offers: [], call_periods: [] }); // deepEqual: vm-realm objects
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
    check("snapshots.capture: writes { config, schedule_days, time_off, availability, call_offers, call_periods } + source_updated_at", () => {
      assert.strictEqual(r.ok, true);
      // Prompt 14 P5 FLIP (9/23): the snapshot scope gains call_offers + call_periods (Faraz 9/22) - before P5 the counts were the three tables
      assert.deepEqual(r.counts, { schedule_days: 1, time_off: 1, availability: 0, call_offers: 0, call_periods: 0 }); // deepEqual: the object was born in the vm realm
      const post = calls.find(c => c.method === "POST");
      assert.ok(post && post.url.endsWith("/rest/v1/call_schedule_snapshots"));
      assert.strictEqual(post.body.reason, "clear_schedule");
      assert.strictEqual(post.body.source_updated_at, "2026-09-22T00:00:00Z");
      assert.deepStrictEqual(Object.keys(post.body.data).sort(), ["availability", "call_offers", "call_periods", "config", "schedule_days", "time_off"]); // P5 FLIP: was the four keys
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

  // ---- audit 9/23 (app-safety lane) ----
  await (async () => {
    // D12 (app-safety-1): the restored blob is handed to onBlobWritten the moment it is written - after the ONE
    // call_schedule_data POST and BEFORE the schedule leg - and a failed schedule leg is reported as PARTIAL
    // (blobRestored, no scheduleRestored) with blob / ts / counts on the result so the caller can adopt and report.
    const order = []; calls.length = 0;
    setFetch((url, opts) => {
      if (opts && opts.method === "POST" && url.includes("call_schedule_snapshots")) { order.push("snapshot"); return resp(201, ""); }
      if (opts && opts.method === "POST" && url.includes("call_schedule_data")) { order.push("blob"); return resp(201, ""); }
      if (url.includes("call_schedule_data")) return resp(200, [{ data: { roster: [] }, updated_at: "t0" }]);
      if (url.includes("schedule_days")) return resp(200, [{ day: "2026-01-01", primary_id: "s1" }]);
      return resp(200, []);
    });
    const payload = { config: { roster: C.INIT_SURGEONS, groupRules: { x: 2 } }, schedule_days: [{ day: "2026-10-12", primary_id: "s4" }], time_off: [{ id: "a", person_id: "s2", start_date: "2026-04-01", end_date: "2026-04-01" }], availability: [] };
    let written = null, tablesCalled = 0;
    const r = await C.snapshots.applyPayload(payload,
      async () => { order.push("cas"); return { ok: false, error: "wipe blocked" }; },
      async () => { tablesCalled++; order.push("tables"); return { ok: true, counts: {} }; },
      "before_restore",
      (config, ts) => { order.push("onBlobWritten"); written = { config, ts }; });
    check("applyPayload: schedule leg fails -> ok:false + blobRestored only; onBlobWritten ran after the ONE blob POST and before the CAS applier; blob/ts/counts on the result", () => {
      assert.strictEqual(r.ok, false); assert.strictEqual(r.blobRestored, true); assert.ok(!r.scheduleRestored, "scheduleRestored must not be set");
      assert.match(r.error, /wipe blocked/);
      assert.deepStrictEqual(order, ["snapshot", "blob", "onBlobWritten", "cas"]);
      assert.strictEqual(tablesCalled, 0, "the table leg never runs after a failed schedule leg");
      assert.strictEqual(calls.filter(c => c.method === "POST" && c.url.includes("call_schedule_data")).length, 1);
      assert.ok(written && typeof written.ts === "string", "onBlobWritten(config, ts)");
      assert.deepEqual(written.config, payload.config); // deepEqual: vm-realm object
      assert.deepEqual(r.blob, payload.config, "the partial result carries the blob it wrote");
      assert.strictEqual(r.ts, written.ts, "and the ts it wrote it with");
      assert.strictEqual(r.counts && r.counts.schedule_days, 1);
    });
  })();
  await (async () => {
    // D13 (app-safety-1): a failed TABLE leg is PARTIAL with both flags; a throwing onBlobWritten never aborts the legs.
    const order = []; calls.length = 0;
    setFetch((url, opts) => {
      if (opts && opts.method === "POST" && url.includes("call_schedule_snapshots")) { order.push("snapshot"); return resp(201, ""); }
      if (opts && opts.method === "POST" && url.includes("call_schedule_data")) { order.push("blob"); return resp(201, ""); }
      if (url.includes("call_schedule_data")) return resp(200, [{ data: { roster: [] }, updated_at: "t0" }]);
      if (url.includes("schedule_days")) return resp(200, [{ day: "2026-01-01", primary_id: "s1" }]);
      return resp(200, []);
    });
    const payload = { config: { roster: C.INIT_SURGEONS, holidays: [] }, schedule_days: [{ day: "2026-10-12", primary_id: "s4" }], time_off: [{ id: "a", person_id: "s2", start_date: "2026-04-01", end_date: "2026-04-01" }], availability: [] };
    const r = await C.snapshots.applyPayload(payload,
      async () => { order.push("cas"); return { ok: true }; },
      async () => { order.push("tables"); return { ok: false, error: "time_off restore failed: 403", counts: { time_off_upserted: 0 } }; },
      "before_import",
      () => { order.push("onBlobWritten"); throw new Error("adopt threw"); });
    check("applyPayload: table leg fails -> ok:false + blobRestored + scheduleRestored, blob/ts on the result; a throwing onBlobWritten does not abort the legs", () => {
      assert.strictEqual(r.ok, false); assert.strictEqual(r.blobRestored, true); assert.strictEqual(r.scheduleRestored, true);
      assert.match(r.error, /time_off restore failed/);
      assert.deepStrictEqual(order, ["snapshot", "blob", "onBlobWritten", "cas", "tables"]);
      assert.strictEqual(calls.filter(c => c.method === "POST" && c.url.includes("call_schedule_data")).length, 1);
      assert.deepEqual(r.blob, payload.config); assert.strictEqual(typeof r.ts, "string");
    });
  })();
  await (async () => {
    // D13b (review of app-safety-1): a leg that THROWS (a network exception in the app's bare fetch) is the same
    // PARTIAL outcome as a leg that returns ok:false - never "nothing was changed" after the blob POST landed.
    const order = []; calls.length = 0;
    setFetch((url, opts) => {
      if (opts && opts.method === "POST" && url.includes("call_schedule_snapshots")) { order.push("snapshot"); return resp(201, ""); }
      if (opts && opts.method === "POST" && url.includes("call_schedule_data")) { order.push("blob"); return resp(201, ""); }
      if (url.includes("call_schedule_data")) return resp(200, [{ data: { roster: [] }, updated_at: "t0" }]);
      if (url.includes("schedule_days")) return resp(200, [{ day: "2026-01-01", primary_id: "s1" }]);
      return resp(200, []);
    });
    const payload = { config: { roster: C.INIT_SURGEONS, holidays: [] }, schedule_days: [{ day: "2026-10-12", primary_id: "s4" }], time_off: [{ id: "a", person_id: "s2", start_date: "2026-04-01", end_date: "2026-04-01" }], availability: [] };
    let tablesCalled = 0, thrown = null, r1 = null;
    try {
      r1 = await C.snapshots.applyPayload(payload,
        async () => { order.push("cas"); throw new TypeError("Failed to fetch"); },
        async () => { tablesCalled++; order.push("tables"); return { ok: true, counts: {} }; },
        "before_restore", () => { order.push("onBlobWritten"); });
    } catch (e) { thrown = e; }
    check("applyPayload: a THROWING schedule leg is the same PARTIAL result as ok:false (blobRestored, the error text, blob/ts, ONE blob POST, no table leg) - never a rejection", () => {
      assert.strictEqual(thrown, null, "applyPayload must not reject: " + String(thrown));
      assert.strictEqual(r1.ok, false); assert.strictEqual(r1.blobRestored, true); assert.ok(!r1.scheduleRestored);
      assert.match(String(r1.error), /Failed to fetch/);
      assert.deepStrictEqual(order, ["snapshot", "blob", "onBlobWritten", "cas"]);
      assert.strictEqual(tablesCalled, 0);
      assert.strictEqual(calls.filter(c => c.method === "POST" && c.url.includes("call_schedule_data")).length, 1);
      assert.deepEqual(r1.blob, payload.config); assert.strictEqual(typeof r1.ts, "string");
    });
    order.length = 0; thrown = null;
    let r2 = null;
    try {
      r2 = await C.snapshots.applyPayload(payload,
        async () => { order.push("cas"); return { ok: true }; },
        async () => { order.push("tables"); throw new TypeError("Failed to fetch"); },
        "before_import", () => { order.push("onBlobWritten"); });
    } catch (e) { thrown = e; }
    check("applyPayload: a THROWING table leg is PARTIAL with blobRestored + scheduleRestored and the error text - never a rejection", () => {
      assert.strictEqual(thrown, null, "applyPayload must not reject: " + String(thrown));
      assert.strictEqual(r2.ok, false); assert.strictEqual(r2.blobRestored, true); assert.strictEqual(r2.scheduleRestored, true);
      assert.match(String(r2.error), /Failed to fetch/);
      assert.deepStrictEqual(order, ["snapshot", "blob", "onBlobWritten", "cas", "tables"]);
      assert.deepEqual(r2.blob, payload.config); assert.strictEqual(typeof r2.ts, "string");
    });
  })();
  await (async () => {
    // D14 (RLS-7): db.update returns the matched rows so a caller can tell an RLS-filtered PATCH (HTTP 200 + [])
    // from a real update; a 2xx non-JSON body is ZERO rows, never success.
    const db = vm.runInContext("db", sandbox);
    calls.length = 0;
    setFetch(() => resp(200, [{ id: "c1", active: false }]));
    const hit = await db.update("office_contacts", "c1", { active: false });
    setFetch(() => resp(200, []));
    const none = await db.update("office_contacts", "c1", { active: false });
    setFetch(() => resp(200, "<html>proxy</html>"));
    const junk = await db.update("office_contacts", "c1", { active: false });
    setFetch(() => resp(403, "permission denied for table office_contacts"));
    const denied = await db.update("office_contacts", "c1", { active: false });
    setFetch(() => resp(401, ""));
    const bare = await db.update("office_contacts", "c1", { active: false });
    check("db.update: { data: rows, error } - 200+[row] is one row, 200+[] and a non-JSON 2xx are ZERO rows (not success), a non-2xx carries the body as error", () => {
      assert.strictEqual(hit.error, null); assert.strictEqual(hit.data.length, 1); assert.strictEqual(hit.data[0].id, "c1");
      assert.strictEqual(none.error, null); assert.strictEqual(Array.isArray(none.data) && none.data.length, 0);
      assert.strictEqual(junk.error, null); assert.strictEqual(Array.isArray(junk.data) && junk.data.length, 0);
      assert.strictEqual(Array.isArray(denied.data) && denied.data.length, 0); assert.match(String(denied.error), /permission denied/);
      const patch = calls[calls.length - 1]; assert.strictEqual(patch.method, "PATCH"); assert.ok(patch.url.includes("office_contacts?id=eq.c1"));
    });
    // review of RLS-7: a non-2xx with an EMPTY body is still an error (truthy), never the zero-row branch's wording.
    check("db.update: a non-2xx with an empty body reports error 'HTTP <status>' (truthy), not '' - the caller's `if (error)` branch must fire", () => {
      assert.strictEqual(Array.isArray(bare.data) && bare.data.length, 0);
      assert.ok(bare.error, "error must be truthy for a 401 with no body");
      assert.match(String(bare.error), /HTTP 401/);
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
  // Prompt 16 B8 (supply chain): React, ReactDOM and supabase-js come from vendor/ through the same ?v=APP_VERSION
  // loader as the modules (no CDN script, no unpinned "latest"), and the <head> opens with the CSP meta whose
  // script-src is a hash list (build.js fills __CSP_SCRIPT_HASHES__; test/ci.test.js checks the built hashes).
  check("B8: no CDN script tag or module import; the loader serves vendor/react, react-dom, supabase.js before config.js", () => {
    assert.strictEqual(rxCount(/<script[^>]+src="https?:\/\//g), 0, "a <script src=\"https://...\"> is still in index-source.html");
    assert.strictEqual(count("unpkg.com") + count("cdn.jsdelivr.net") + count("cdnjs.cloudflare.com"), 0, "a CDN host is still named");
    assert.strictEqual(rxCount(/<script type="module">/g), 0, "the <script type=\"module\"> SDK import is still there");
    const loader = src.indexOf("['vendor/react.production.min.js','vendor/react-dom.production.min.js','vendor/supabase.js','config.js',");
    assert.ok(loader > 0, "the loader list does not start with the vendored trio followed by config.js");
    assert.ok(loader < src.indexOf('<script type="text/babel">'), "the loader must precede the JSX block");
    assert.strictEqual(count("window._supabaseSDK"), 0, "index-source.html must not set window._supabaseSDK itself (config.js captures the vendored UMD's global)");
  });
  check("B8: the CSP meta is the first <meta> after charset, precedes every <script>, and its script-src is 'self' + the hash token (no 'unsafe-inline')", () => {
    const meta = src.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
    assert.ok(meta, "no CSP meta");
    assert.ok(src.indexOf('<meta charset="UTF-8">') < meta.index && meta.index < src.indexOf("<script"), "the CSP meta must sit right after <meta charset> and before the first <script>");
    const scriptSrc = (meta[1].split(";").map(s => s.trim()).find(s => /^script-src\s/.test(s)) || "").split(/\s+/).slice(1);
    assert.deepStrictEqual(scriptSrc.slice(0, 2), ["'self'", "__CSP_SCRIPT_HASHES__"], "script-src must read 'self' __CSP_SCRIPT_HASHES__ ...: " + scriptSrc.join(" "));
    assert.ok(!scriptSrc.includes("'unsafe-inline'") && !scriptSrc.includes("'unsafe-eval'"), "script-src must not carry 'unsafe-inline' / 'unsafe-eval'");
    assert.ok(/connect-src [^;]*wss:\/\/bzhsroegtagqhutbnsrp\.supabase\.co/.test(meta[1]), "connect-src must allow the Realtime websocket host");
    assert.ok(!/frame-ancestors/.test(meta[1]), "frame-ancestors is ignored in a <meta> policy");
  });
  // Guard census. A new grant site needs its own disarm story AND this pin updated.
  check("intentionalScheduleWipeRef granted at exactly 2 sites (clearSchedule, applyScheduleViaCAS)", () => {
    assert.strictEqual(count("intentionalScheduleWipeRef.current = true"), 2);
  });
  check("intentionalScheduleWipeRef consumed at exactly 2 sites (enqueue-time consume in syncScheduleDays + applier finally)", () => {
    assert.strictEqual(count("intentionalScheduleWipeRef.current = false"), 2);
  });
  // app-safety-2: the grant is consumed synchronously at ENQUEUE (arming and enqueuing are synchronous at both grant
  // sites) and handed to that run; syncScheduleDaysNow gates on the handed-in grant and never touches the ref.
  check("the wipe grant is consumed at enqueue inside syncScheduleDays and handed to that run; syncScheduleDaysNow gates on the grant, not the ref", () => {
    const enq = src.indexOf("const syncScheduleDays = (nextSchedule) => {");
    const fn = src.indexOf("const syncScheduleDaysNow = async (nextSchedule, wipeGranted) => {", enq);
    const read = src.indexOf("const grant = intentionalScheduleWipeRef.current;", enq);
    const consume = src.indexOf("intentionalScheduleWipeRef.current = false;", enq);
    const handoff = src.indexOf("syncScheduleDaysNow(nextSchedule, grant)", enq);
    assert.ok(enq > 0 && fn > enq && read > enq && consume > read && handoff > consume && handoff < fn, `enq=${enq} read=${read} consume=${consume} handoff=${handoff} fn=${fn}`);
    const end = src.indexOf("const scheduleDaySyncRetry = () => {", fn);
    const body = src.slice(fn, end);
    assert.ok(body.includes("if (chk.wipe && !wipeGranted) {"), "the gate reads the handed-in grant");
    assert.strictEqual(body.includes("intentionalScheduleWipeRef"), false, "syncScheduleDaysNow no longer reads or clears the ref");
    const firstWrite = body.indexOf("await postDayRow(");
    assert.ok(body.indexOf("if (chk.wipe && !wipeGranted) {") < firstWrite, "the gate precedes the first write");
  });
  // app-safety-2 (behaviour): the two sync functions are lifted out of the component verbatim and run against stub
  // refs. A queued autosave run (A) enqueued BEFORE a clear / restore armed the one-shot must not spend that grant;
  // the run enqueued right after arming (B) is the intended wipe and must go through.
  await (async () => {
    const start = src.indexOf("  const syncScheduleDays = (nextSchedule) => {");
    const end = src.indexOf("  const scheduleDaySyncRetry = () => {", start);
    const body = src.slice(start, end);
    const ref = (v) => ({ current: v });
    const sameAssignment = (day, a, b) => JSON.stringify(H.assignmentToDayRow(day, a || H.emptyDayAssignment())) === JSON.stringify(H.assignmentToDayRow(day, b || H.emptyDayAssignment()));
    const mk = (stubs) => {
      const s = stubs || {}; // B1 review: the duplicate-POST case swaps in its own history / postDayRow / fetchDayRow
      const state = { toasts: [], patched: [], patchedAgainst: [], historySets: 0 };
      const intentionalScheduleWipeRef = ref(false);
      const scheduleHistoryRef = ref(s.history || [{ days: [{ day: "2026-11-02", before: null, version: 1 }] }]); // Prompt 16 B1: an undo entry at the version the first write goes out against
      const lastSyncRef = ref({ "2026-11-02": { primary: "s1" }, "2026-11-03": { primary: "s2" }, "2026-11-04": { primary: "s3" }, "2026-11-05": { primary: "s4" } });
      const params = ["intentionalScheduleWipeRef", "daySyncBusyRef", "daySyncChainRef", "lastSyncRef", "dayVersionsRef", "scheduleRef", "scheduleWipeCheck", "sameAssignment", "assignmentToDayRow", "emptyDayAssignment", "postDayRow", "patchDayRow", "fetchDayRow", "setSaveError", "setSaveStatus", "showToast", "scheduleDaySyncRetry", "loadScheduleDays", "setSchedule", "userProfile", "authUser", "writeFailToast", "setTimeout", "console", "auth", "undoNoteWrite", "scheduleHistoryRef", "setHistory"];
      const fns = new Function(...params, body + "\nreturn { syncScheduleDays, syncScheduleDaysNow };")(
        intentionalScheduleWipeRef, ref(0), ref(Promise.resolve()), lastSyncRef, ref({ "2026-11-02": 1, "2026-11-03": 1, "2026-11-04": 1, "2026-11-05": 1 }), ref(lastSyncRef.current),
        H.scheduleWipeCheck, sameAssignment, H.assignmentToDayRow, H.emptyDayAssignment,
        s.postDayRow || (async () => ({ version: 1 })), async (row, ver) => { state.patched.push(row.day); state.patchedAgainst.push(ver); return { version: ver + 1 }; }, s.fetchDayRow || (async () => null),
        () => {}, () => {}, (m) => state.toasts.push(m), () => {}, async () => ({ sched: {}, vers: {} }), () => {}, null, null, () => "write failed", () => 0, { warn: () => {} }, { sessionExpired: false },
        H.undoNoteWrite, scheduleHistoryRef, (h) => { scheduleHistoryRef.current = h; state.historySets++; });
      return { ...fns, state, intentionalScheduleWipeRef, lastSyncRef, scheduleHistoryRef };
    };
    const wipe = { "2026-11-02": {}, "2026-11-03": {}, "2026-11-04": {}, "2026-11-05": {} };
    const t = mk();
    const pA = t.syncScheduleDays({ ...t.lastSyncRef.current, "2026-11-02": { primary: "s5" } }); // an ordinary autosave diff, queued first
    t.intentionalScheduleWipeRef.current = true;                                                  // clearSchedule / applyScheduleViaCAS arm ...
    const pB = t.syncScheduleDays(wipe);                                                            // ... and enqueue synchronously
    const spentAtEnqueue = t.intentionalScheduleWipeRef.current === false;
    const [rA, rB] = await Promise.all([pA, pB]);
    check("app-safety-2: a clear/restore enqueued behind a queued autosave run keeps its own wipe grant (the earlier run cannot spend it; the grant is spent at enqueue)", () => {
      assert.strictEqual(rA.ok, true, "run A: " + JSON.stringify(rA));
      assert.strictEqual(rB.ok, true, "run B (the intentional wipe) must not be BLOCKED: " + JSON.stringify(rB));
      assert.strictEqual(spentAtEnqueue, true, "the one-shot is consumed synchronously when its run is enqueued");
      assert.deepStrictEqual(t.state.patched, ["2026-11-02", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]);
      assert.strictEqual(t.state.toasts.some(m => /wipe/i.test(m)), false, "no wipe-blocked toast");
    });
    check("B1 in the sync loop: the undo entry for 11/02 followed the session's two own PATCHes of that day (v1 -> 2 in run A, 2 -> 3 in run B) through undoNoteWrite + setHistory, and no other day was noted", () => {
      assert.deepStrictEqual(t.scheduleHistoryRef.current, [{ days: [{ day: "2026-11-02", before: null, version: 3 }] }]);
      assert.strictEqual(t.state.historySets, 2, "setHistory ran once per own write that matched an entry (the 11/03-11/05 writes matched none)");
    });
    // B1 review (minor): the duplicate-POST branch. dayVersionsRef has no version for 11/06 and the undo entry says
    // "no row when the edit was made" (version null); the POST comes back 409 because another device created the row
    // inside the debounce, the re-read says v3 and the retry PATCHes against 3. The own-write note must be keyed on
    // the version the PATCH really went out against (3), not on `ver` (undefined -> null): the entry at null stays
    // put, the day reads as "changed since", and Undo never writes an empty row over the foreign one.
    const d = mk({ history: [{ days: [{ day: "2026-11-06", before: null, version: null }] }], postDayRow: async () => ({ duplicate: true }), fetchDayRow: async () => ({ version: 3 }) });
    const rD = await d.syncScheduleDays({ ...d.lastSyncRef.current, "2026-11-06": { primary: "s6" } });
    check("B1 review: in the duplicate-POST branch (409 -> re-read v3 -> CAS PATCH against 3) the own-write note is keyed on the version the PATCH went out against, so an undo entry recorded at 'no row' is NOT advanced and the day reads as changed since", () => {
      assert.strictEqual(rD.ok, true, "run: " + JSON.stringify(rD));
      assert.deepStrictEqual(d.state.patched, ["2026-11-06"], "the retry is one CAS PATCH");
      assert.deepStrictEqual(d.state.patchedAgainst, [3], "against the re-read version");
      assert.deepStrictEqual(d.scheduleHistoryRef.current, [{ days: [{ day: "2026-11-06", before: null, version: null }] }], "the entry at null stays at null - the row at v3 is foreign, this session never saw it");
      assert.strictEqual(d.state.historySets, 0, "nothing noted");
    });
    const u = mk();
    const rU = await u.syncScheduleDays(wipe);
    check("app-safety-2: a wipe-shaped run with no grant is still BLOCKED and writes nothing (the gate is unchanged)", () => {
      assert.strictEqual(rU.ok, false); assert.strictEqual(rU.blocked, true);
      assert.deepStrictEqual(u.state.patched, []);
      assert.ok(u.state.toasts.some(m => /Blocked an unexpected schedule wipe/.test(m)));
    });
  })();
  // review of app-safety-2: the grant never survives to an event handler - each grant site enqueues its run in the
  // same synchronous stretch (no await between arming and syncScheduleDays), and syncScheduleDays spends the ref at
  // enqueue; so the keepalive flush reader can only ever see it false, and its comment says so.
  check("the wipe grant never reaches the keepalive flush: no await between either grant site and its syncScheduleDays enqueue; the flush reader is commented as always-false (spent at enqueue)", () => {
    let from = 0, sites = 0;
    for (;;) {
      const g = src.indexOf("intentionalScheduleWipeRef.current = true", from);
      if (g < 0) break;
      sites++;
      const enq = src.indexOf("syncScheduleDays(", g);
      const between = src.slice(g, enq + "syncScheduleDays(".length); // includes the call so the lookahead can exempt `await syncScheduleDays(`
      assert.ok(enq > g && enq - g < 400, `grant site ${sites}: syncScheduleDays enqueue within reach`);
      assert.strictEqual(/\bawait\b(?!\s+syncScheduleDays\()/.test(between), false, `grant site ${sites}: no await between arming and the enqueue`);
      from = g + 1;
    }
    assert.strictEqual(sites, 2);
    const reader = src.indexOf("if (chk.wipe && !intentionalScheduleWipeRef.current) {");
    assert.ok(reader > 0, "the keepalive flush reader exists once");
    assert.strictEqual(count("if (chk.wipe && !intentionalScheduleWipeRef.current) {"), 1);
    assert.ok(src.slice(reader - 600, reader).includes("spent at enqueue"), "the reader's comment says the ref is always false here (spent at enqueue)");
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
  check("autosave: the empty-save gate precedes the consume, leg 1 (days) runs before the blob leg's gate (A4: the blob leg is its own effect after the days effect; its write is saveBlobNow)", () => {
    const eff = src.indexOf("// --- Supabase: Auto-save on changes ---");
    const gate = src.indexOf("payloadLooksWiped(payload) && everHadRealDataRef.current && !allowWipeSaveRef.current", eff);
    const consume = src.indexOf("allowWipeSaveRef.current = false; // consume one-shot bypass", eff);
    const leg1 = src.indexOf("syncScheduleDays(payload.schedule)", eff);
    const leg2gate = src.indexOf("if (!canWriteBlob) {", eff); // Prompt 16 B9 (e): the gate settles the Setup-save waiters before it returns
    const blobWrite = src.indexOf('await saveBlobNow(payload, "autosave")', eff);
    assert.ok(eff > 0 && gate > eff && consume > gate && leg1 > consume && leg2gate > leg1 && blobWrite > leg2gate, `eff=${eff} gate=${gate} consume=${consume} leg1=${leg1} leg2gate=${leg2gate} blob=${blobWrite}`);
  });
  check("blob writes strip schedule / vacations / availability (state-bundle contract)", () => {
    assert.ok(src.includes("delete blobData.schedule; delete blobData.vacations; delete blobData.availability;"));
    assert.strictEqual(count("blobFromBundle("), 4, "autosave + keepalive flush + JSON export + the miss re-read's own-content check (reloadBlobAfterMiss, A4 review)");
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
    assert.ok(src.includes("}, [loaded, surgeons, surgeonRules, groupRules, holidays, settings, lastPublished, lastGenerate, saveTick]);"), "the blob leg's dependencies include lastGenerate (and A3's saveTick) - A4: the blob leg is its own effect");
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
  check("blobLoadedRef: set true at exactly 4 sites (mount read, background refresh, factory reset, adoptRestoredBlob) and never false", () => {
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
  // ---- audit 9/23 (app-safety lane) ----
  // app-safety-1: the restored blob is adopted ONCE, by adoptRestoredBlob, the moment applyPayload has written it
  // (the onBlobWritten applier) - never after the later legs; both callers pass it and both branch on
  // r.blobRestored so a restore / import that lost a later leg is reported as PARTIAL, not as "failed".
  check("restore/import: adoptRestoredBlob is the single adoption site, both callers pass it to applyPayload/restore, both branch on r.blobRestored, afterPayloadApplied no longer adopts", () => {
    assert.strictEqual(count("const adoptRestoredBlob = (config, ts) => {"), 1);
    const helper = src.indexOf("const adoptRestoredBlob = (config, ts) => {");
    const hb = src.slice(helper, src.indexOf("};", helper));
    ["adoptBlob(config", "blobTsRef.current = ts", "blobLoadedRef.current = true", "everHadRealDataRef.current = true"].forEach(n => assert.ok(hb.includes(n), "adoptRestoredBlob must do: " + n));
    assert.strictEqual(count("snapshots.restore(snap.id, applyScheduleViaCAS, applyTablesUpsert, adoptRestoredBlob)"), 1);
    assert.strictEqual(count('snapshots.applyPayload(obj, applyScheduleViaCAS, applyTablesUpsert, "before_import", adoptRestoredBlob)'), 1);
    const rs = src.indexOf("const restoreSnapshot = async (snap) => {");
    const ib = src.indexOf("const importBackupFile = async (file) => {", rs);
    const ex = src.indexOf("const exportBackup = () => {", ib);
    assert.ok(rs > 0 && ib > rs && ex > ib);
    assert.ok(src.slice(rs, ib).includes("r.blobRestored"), "restoreSnapshot branches on r.blobRestored");
    assert.ok(src.slice(ib, ex).includes("r.blobRestored"), "importBackupFile branches on r.blobRestored");
    assert.ok(src.slice(rs, ib).includes('outcome: "partial"') && src.slice(ib, ex).includes('outcome: "partial"'), "a partial apply still writes its audit row");
    const after = src.indexOf("const afterPayloadApplied = (r, what) => {");
    assert.ok(after > 0 && !src.slice(after, src.indexOf("};", after)).includes("adoptBlob("), "afterPayloadApplied no longer adopts - onBlobWritten did, before the schedule leg");
  });
  check("config.js: applyPayload calls onBlobWritten right after the blob upsert and before the schedule applier; restore() passes it through", () => {
    const cfg = fs.readFileSync(path.join(ROOT, "config.js"), "utf8").replace(/\r\n/g, "\n");
    const fn = cfg.indexOf("async applyPayload(raw, applySchedule, applyTables, preReason, onBlobWritten) {");
    const up = cfg.indexOf('db.upsert("call_schedule_data"', fn);
    const cb = cfg.indexOf("onBlobWritten(payload.config, ts)", fn);
    const leg = cfg.indexOf("await applySchedule(schedule)", fn);
    assert.ok(fn > 0 && up > fn && cb > up && leg > cb, `fn=${fn} upsert=${up} callback=${cb} scheduleLeg=${leg}`);
    assert.ok(cfg.includes("async restore(snapshotId, applySchedule, applyTables, onBlobWritten) {"));
    assert.ok(cfg.includes('this.applyPayload(raw, applySchedule, applyTables, "before_restore", onBlobWritten)'));
  });
  // app-safety-3: every automatic snapshot reason the app, config.js and the CLI importer write has a label in the
  // restore list (the raw strings 'generate_publish' / 'before_seed_import' used to show).
  check("snapshotReasonLabel names every snapshot reason written by index-source.html, config.js and importer.js", () => {
    const m = src.indexOf("const snapshotReasonLabel = (r) => ({");
    const mEnd = src.indexOf('}[r] || r || "manual")', m);
    assert.ok(m > 0 && mEnd > m, "the label map keeps its raw-reason fallback");
    const labeled = new Set([...src.slice(m, mEnd).matchAll(/^\s*([a-z_]+):/gm)].map(x => x[1]));
    const used = new Set();
    const census = (text) => {
      [...text.matchAll(/snapshots\.capture(?:IfStale)?\("([a-z_]+)"/g)].forEach(x => used.add(x[1]));
      [...text.matchAll(/applyPayload\([^)]*?"([a-z_]+)"/g)].forEach(x => used.add(x[1]));
    };
    census(src); census(fs.readFileSync(path.join(ROOT, "config.js"), "utf8"));
    [...fs.readFileSync(path.join(ROOT, "importer.js"), "utf8").matchAll(/select '([a-z_]+)',/g)].forEach(x => used.add(x[1]));
    ["generate_publish", "seed_import", "before_seed_import", "before_restore", "before_import", "clear_schedule", "reset_all_data", "periodic_session"].forEach(r => assert.ok(used.has(r), "the census should find " + r + " - a regex drifted"));
    assert.deepStrictEqual([...used].filter(r => !labeled.has(r)), [], "snapshot reasons with no label");
  });
  // app-safety-4: every localStorage key carries the documented silvis- prefix; the two underscore spellings
  // inherited from Davenport are read through once (so the rename deploy still nukes its cache and no panel state
  // is lost) and removed on the next write - never written again.
  check("localStorage keys: silvis- prefix everywhere; the legacy silvis_app_version / silvis_collapse_ keys are read through once and retired, never written", () => {
    assert.strictEqual(rxCount(/localStorage\.setItem\("silvis_/g), 0, "no write to a legacy underscore key");
    assert.ok(src.includes('localStorage.getItem("silvis-app-version") || localStorage.getItem("silvis_app_version")'), "the version read falls back to the legacy key ONCE (a null read would skip the rename deploy's cache nuke)");
    assert.strictEqual(count('localStorage.removeItem("silvis_app_version")'), 2, "both branches retire the legacy key after writing the new one");
    assert.strictEqual(count('"silvis_app_version"'), 3, "one fallback read + two removes");
    assert.strictEqual(count('"silvis_collapse_" + ck'), 2, "one fallback read + one remove");
    assert.ok(src.includes('localStorage.getItem("silvis-collapse-" + ck)') && src.includes('localStorage.setItem("silvis-collapse-" + ck'));
    assert.strictEqual(count('"silvis_collapse_setup_east"'), 0, "openEastVacPanel writes through the helper, not a legacy literal");
    assert.strictEqual(count('writeCollapseFlag("setup_east", true)'), 1);
  });
  // Item A (Faraz 9/23): the calendar week starts on Sunday, like the Davenport app - a per-device setting
  // ('silvis-week-start', 'sun' default / 'mon') read by the ONE grid builder helpers.monthGridDays and handed to
  // both export grids; monOf() and every week-based rule stay Mon-Sun.
  // 2026-09-25 (smoke, first Friday after launch): the weekend-unit bracket is spread after the cell's border and set
  // borderTop navy, so on Fri / Sat / Sun today's cell lost the orange ring's top edge. The bracket keeps the accent for today.
  check("today ring: on a weekend-unit day the bracket's top border stays the orange accent when the day is today", () => {
    assert.ok(src.includes('const bracket = isWk ? { borderTop: "2px solid " + (isToday ? T.accent : T.navyMuted),'), "the weekend bracket keeps the accent top border on today");
    assert.ok(src.indexOf("const isToday = d === todayStr;") >= 0 && src.indexOf("const isToday = d === todayStr;") < src.indexOf("const bracket = isWk ? {"), "isToday is known before the bracket is built");
  });
  // A3 follow-up (smoke 2026-09-25, 'A3 session (no loop): a save-error toast showed beside the banner'): the in-app
  // notification insert must not toast while the session is expired - the one session-expired banner already says so.
  check("A3 follow-up: addNotification suppresses its save-error toast while auth.sessionExpired (the banner is the one message)", () => {
    const fn = src.slice(src.indexOf("const addNotification = useCallback("), src.indexOf("const addNotification = useCallback(") + 900);
    assert.ok(fn.length > 200, "addNotification not found");
    assert.ok(fn.includes('if (insertErr) { console.warn("Notification insert failed:", insertErr); if (!auth.sessionExpired) showToast("Couldn\'t save that notification.", "error"); }'), "the insert-error toast is gated on !auth.sessionExpired");
  });
  check("Item A pins: weekStartsOn state reads 'silvis-week-start' through normalizeWeekStart (Sunday default) and persists it; gridDays = monthGridDays(calYear, calMonth, weekStartsOn); the header row comes from weekdayLabels with the weekend-unit label on Fri; the Settings control is two buttons (week-start-sun / week-start-mon); the share page and the printable get weekStartsOn; monOf still drives the week rows", () => {
    assert.strictEqual(count('localStorage.getItem("silvis-week-start")'), 1, "one read of the week-start key");
    assert.ok(src.includes('normalizeWeekStart(localStorage.getItem("silvis-week-start"))'), "the stored value is normalised (a missing or garbage value is Sunday)");
    assert.strictEqual(count('localStorage.setItem("silvis-week-start", weekStartsOn)'), 1, "persisted from the state, once");
    assert.ok(src.includes("const [weekStartsOn, setWeekStartsOn] = useState("), "weekStartsOn state");
    assert.ok(/const gridDays = useMemo\(\(\) => monthGridDays\(calYear, calMonth, weekStartsOn\), \[calYear, calMonth, weekStartsOn\]\);/.test(src), "gridDays is the shared builder, keyed on the setting");
    assert.strictEqual(count('["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((h, i) => ('), 0, "the hard-coded Mon..Sun header row is gone");
    assert.ok(src.includes("{weekdayLabels(weekStartsOn).map((h, i) => {"), "the header row follows the setting");
    assert.ok(src.includes('{h === "Fri" ? <span className="cal-wk-label"'), "the small 'weekend unit' label sits on the Fri header wherever Fri falls");
    assert.ok(src.includes('data-week-start={weekStartsOn}'), "the grid announces its mode");
    assert.strictEqual(count('data-testid="week-start-sun"'), 1); assert.strictEqual(count('data-testid="week-start-mon"'), 1);
    assert.ok(src.includes('onClick={()=>setWeekStartsOn("sun")}') && src.includes('onClick={()=>setWeekStartsOn("mon")}'));
    assert.ok(src.includes("Week starts on"), "the Settings label");
    assert.ok(/generateShareHTML\(schedule, surgeons, \{[^}]*weekStartsOn[^}]*\}\)/.test(src), "the share page gets the setting");
    assert.ok(/buildPrintableCalendarHTML\(\{[^}]*weekStartsOn[^}]*\}\)/.test(src), "the printable gets the setting");
    assert.ok(src.includes("monOf("), "monOf is still in use (week rows, East weeks) - Item A never touches it");
  });
  // Item B (Faraz 9/23 evening): the vacation lists are grouped per surgeon - one block per roster entry in roster
  // order (a header with the Badge, "N upcoming" and, with Show past on, "+M past"), the ranges underneath as compact
  // "Nov 19-22" lines. Two pure helpers carry the behaviour so the grouping and the label are testable here.
  check("Item B: vacRangeLabel renders 'Nov 19-22' (en dash), a single day as one date, cross-month 'Nov 30-Dec 2', and a year suffix only when the range leaves this year", () => {
    const today = "2026-09-24";
    assert.strictEqual(H.vacRangeLabel("2026-11-19", "2026-11-22", today), "Nov 19\u201322");
    assert.strictEqual(H.vacRangeLabel("2026-11-25", "2026-11-29", today), "Nov 25\u201329");
    assert.strictEqual(H.vacRangeLabel("2027-01-09", "2027-01-10", today), "Jan 9\u201310 (2027)");
    assert.strictEqual(H.vacRangeLabel("2026-11-19", "2026-11-19", today), "Nov 19", "a single day is one date");
    assert.strictEqual(H.vacRangeLabel("2027-03-02", "2027-03-02", today), "Mar 2 (2027)", "a single day next year carries the year");
    assert.strictEqual(H.vacRangeLabel("2026-11-30", "2026-12-02", today), "Nov 30\u2013Dec 2", "a cross-month range names both months");
    assert.strictEqual(H.vacRangeLabel("2026-12-30", "2027-01-02", today), "Dec 30\u2013Jan 2 (2026\u20132027)", "a range across New Year names both years");
    assert.strictEqual(H.vacRangeLabel("2025-08-04", "2025-08-08", today), "Aug 4\u20138 (2025)", "a past year is named too");
    assert.strictEqual(H.vacRangeLabel("2026-11-19", "", today), "Nov 19", "a missing end reads as the start day");
    assert.strictEqual(H.vacRangeLabel("garbage", "2026-11-22", today), "garbage\u20132026-11-22", "an unparsable date falls back to the raw strings, never throws");
    // Review fix (9/24): the four en dashes of the label are written as the \u2013 escape in helpers.js, like every
    // en dash in index-source.html - a runtime string literal never carries a raw non-ASCII byte a text round-trip could
    // mojibake into a user-visible label.
    const hsrc = fs.readFileSync(path.join(ROOT, "helpers.js"), "utf8");
    const fnBody = hsrc.slice(hsrc.indexOf("function vacRangeLabel("), hsrc.indexOf("function groupVacationRows("));
    assert.ok(fnBody.length > 0, "vacRangeLabel precedes groupVacationRows in helpers.js");
    assert.strictEqual((fnBody.match(/[^\x00-\x7F]/g) || []).length, 0, "vacRangeLabel's source is ASCII-only (en dashes as \\u2013)");
    assert.strictEqual((fnBody.match(/\\u2013/g) || []).length, 4, "the four en dashes (fallback, cross-month, same-month, two-year suffix) are \\u2013 escapes");
  });
  check("Item B: groupVacationRows returns one group per person in the ORDER GIVEN (roster order, not date order), rows sorted by start inside a group, past ranges counted on the header and listed only with showPast; people with nothing to show are omitted", () => {
    const vac = {
      s1: [["2026-11-19", "2026-11-22", "b", "conference"], ["2026-05-01", "2026-05-03", "a", null], ["2027-01-09", "2027-01-10", "c", null]],
      s2: [],
      s3: [["2026-04-01", "2026-04-01", "d", null]],
    };
    const today = "2026-09-24";
    const up = H.groupVacationRows(vac, ["s1", "s2", "s3", "s4"], today, false);
    assert.deepStrictEqual(up.map(g => g.pid), ["s1"], "s2 (no rows), s3 (past only) and s4 (unknown) are omitted");
    assert.strictEqual(up[0].upcoming, 2); assert.strictEqual(up[0].past, 1);
    assert.deepStrictEqual(up[0].rows.map(r => [r.vs, r.ve, r.id, r.note, r.past]), [["2026-11-19", "2026-11-22", "b", "conference", false], ["2027-01-09", "2027-01-10", "c", null, false]], "sorted by start, past rows hidden");
    assert.strictEqual(up[0].rows[0].pid, "s1", "every row carries its person id for the Edit / Remove handlers");
    const all = H.groupVacationRows(vac, ["s3", "s1"], today, true);
    assert.deepStrictEqual(all.map(g => g.pid), ["s3", "s1"], "the order given wins over the dates (s3's range is the earliest)");
    assert.deepStrictEqual(all[1].rows.map(r => r.vs + (r.past ? " past" : "")), ["2026-05-01 past", "2026-11-19", "2027-01-09"], "with showPast the past row is listed first, flagged");
    assert.deepStrictEqual([all[0].upcoming, all[0].past, all[1].upcoming, all[1].past], [0, 1, 2, 1]);
    assert.deepStrictEqual(H.groupVacationRows({}, ["s1"], today, true), [], "no vacations at all = no groups (the caller renders the 'No vacations' line)");
    assert.deepStrictEqual(H.groupVacationRows(null, ["s1"], today, false), [], "a missing map never throws");
  });
  check("Item B pins: renderVacationList renders groupVacationRows(vacations, personIds, todayStr, showPastVacations) - a vac-group-<id> header (Badge, name, N upcoming, +M past) only when more than one person is listed, vac-line-<id>-<start> lines labelled by vacRangeLabel with the note in italics and the 'past' tag, and the Edit / Remove permission expression unchanged", () => {
    const rv = src.indexOf("const renderVacationList = (personIds, allowEdit) => {");
    const body = src.slice(rv, src.indexOf("const renderVacationForm = ", rv));
    assert.ok(rv > 0 && body.length > 0, "renderVacationList body");
    assert.ok(body.includes("const groups = groupVacationRows(vacations, personIds, todayStr, showPastVacations);"), "the grouping is the pure helper");
    assert.ok(body.includes('data-testid={"vac-group-" + g.pid}'), "the header carries vac-group-<id>");
    assert.ok(body.includes("const withHeader = personIds.length > 1;"), "a single person's own view shows just the lines");
    assert.ok(body.includes("{withHeader && (") , "the header is conditional");
    assert.ok(body.includes("{g.upcoming} upcoming") && body.includes("{showPastVacations && g.past > 0 && "), "N upcoming, and +M past only with Show past on");
    assert.ok(body.includes('data-testid={"vac-line-" + r.pid + "-" + r.vs}'), "every range line carries vac-line-<id>-<start>");
    assert.ok(body.includes("{vacRangeLabel(r.vs, r.ve, todayStr)}"), "the compact label");
    assert.strictEqual(body.includes("{r.vs}{r.ve !== r.vs ? ` to ${r.ve}` : \"\"}"), false, "the old ISO 'start to end' text is gone");
    assert.ok(body.includes("{r.note && <span style={{...muted,fontStyle:\"italic\"}}>{r.note}</span>}"), "the note stays in italics after the range");
    assert.ok(body.includes("{r.past && <span style={{fontSize:10,color:\"#a0a8b0\"}}>past</span>}"), "the past tag as today");
    assert.ok(body.includes("{allowEdit && r.id && (isScheduler || ((isCoordinator || r.pid === mySurgeon) && r.vs > todayStr)) && ("), "the Edit / Remove permission expression is unchanged");
    assert.ok(body.includes("onClick={()=>setEditVac({ sid: r.pid, rowId: r.id, start: r.vs, end: r.ve })}") && body.includes("onClick={()=>rmVac(r.pid, r.id)}"), "Edit / Remove wired exactly as before");
    assert.strictEqual((body.match(/<Badge id=\{/g) || []).length, 1, "ONE Badge - on the header, not on every line");
    assert.ok(!body.includes("sMap[g.pid].fullName"), "no full-name span beside the Badge (the Badge chip already carries the roster last name; follow-up 9/24)");
    assert.strictEqual(count('data-testid="vac-show-past"'), 2, "the Show past checkbox is addressable in both cards (Setup, Time off)");
    assert.strictEqual(count('data-testid="mine-vacations"'), 1, "the My schedule card is addressable");
    assert.strictEqual(src.split("renderVacationList(").length - 1, 3, "the three call sites (Setup, My schedule, Time off) share the one renderer");
  });
  // Item C (Faraz 9/23 evening): the "Suggested" trade partners of the Propose a shift trade card - a PURE ranking
  // (helpers.suggestTradePartners) over an INJECTED eligibility check (the card passes its own tradeEligibility /
  // tradeEligibilityOver) and an injected unitOf (the card's tradeUnitOf), so the fixture below needs no rules context.
  {
    // Oct 2026 fixture: s1 gives days away; s2..s6 are the pool. Primary totals for the year: s2 = 3, s3 = 1, s4 = 5, s5 = 2.
    const sched = {
      "2026-10-05": { primary: "s1", backup: "s3" },
      "2026-10-06": { primary: "s2", backup: "s1" },
      "2026-10-07": { primary: "s2", backup: "s4" },
      "2026-10-08": { primary: "s4", backup: "s2" },
      "2026-10-09": { primary: "s5", backup: "s3" },   // Fri
      "2026-10-10": { primary: "s5", backup: "s3" },   // Sat
      "2026-10-11": { primary: "s3", backup: "s2" },   // Sun
      "2026-10-12": { primary: "s4", backup: "s5" },
      "2026-10-13": { primary: "s2", backup: "s4" },
      "2026-10-16": { primary: "s1", backup: "s2" },   // Fri  } s1's Fri-Sun block
      "2026-10-17": { primary: "s1", backup: "s2" },   // Sat  }
      "2026-10-18": { primary: "s1", backup: "s2" },   // Sun  }
      "2026-10-23": { primary: "s4", backup: "s1" },   // Fri  } s4's Fri-Sun block (primary)
      "2026-10-24": { primary: "s4", backup: "s1" },   // Sat  }
      "2026-10-25": { primary: "s4", backup: "s1" },   // Sun  }
    };
    const calls = [];
    // The stubbed check: s5 can never take anything (hard), s6 is unknown (rules missing), s2 carries one soft note on
    // every slot, s1 (taking a day back) is refused on 10/06 backup and on any Saturday.
    const elig = (days, role, cand) => {
      calls.push({ days: days.slice(), role, cand });
      if (cand === "s5") return { ok: false, hard: ["time-off:" + days[0]], soft: [] };
      if (cand === "s6") return { ok: false, hard: ["rules-unavailable"], soft: [], unknown: true };
      if (cand === "s1" && days.some(d => d === "2026-10-06" || H.parse(d).getDay() === 6)) return { ok: false, hard: ["max-consecutive"], soft: [] };
      return { ok: true, hard: [], soft: cand === "s2" ? [{ reason: "outside-offers", weight: 1 }] : [] };
    };
    const blockOf = (d) => { const dow = H.parse(d).getDay(); if (dow !== 5 && dow !== 6 && dow !== 0) return null; const fri = H.fmt(H.addD(H.parse(d), dow === 5 ? 0 : dow === 6 ? -1 : -2)); return [fri, H.suAddDays(fri, 1), H.suAddDays(fri, 2)]; };
    // A block-style holder's full Fri-Sun in one role is a unit (the card's tradeUnitOf shape); s1 and s4 are block-style here.
    const unitOf = (day, role, holder) => { if (holder !== "s1" && holder !== "s4") return null; const b = blockOf(day); return b && b.every(x => sched[x] && sched[x][role] === holder) ? { kind: "weekend-block", name: "weekend block", days: b } : null; };
    const base = { today: "2026-10-01", pool: ["s2", "s3", "s4", "s5", "s6"], nameOf, eligibility: elig, unitOf, floors: { "2026": "2026-09-14" } };
    check("Item C: suggestTradePartners (one-way) lists only the hard-eligible (unknown = not shown), ranks fewer soft flags first then the lowest running total in the role for the year, at most three, with a 'lowest primary total, N' / 'primary total N' reason", () => {
      calls.length = 0;
      const out = H.suggestTradePartners({}, sched, "2026-10-05", "primary", "s1", { ...base, twoWay: false });
      assert.deepStrictEqual(out.map(x => x.id), ["s3", "s4", "s2"], "s3 (total 1) before s4 (total 5); s2 (total 3) carries a soft note so he ranks last; s5 hard-ineligible and s6 unknown never appear");
      assert.deepStrictEqual(out.map(x => x.total), [1, 5, 3]);
      assert.deepStrictEqual(out.map(x => x.softCount), [0, 0, 1]);
      assert.strictEqual(out[0].reason, "lowest primary total, 1");
      assert.strictEqual(out[1].reason, "primary total 5");
      assert.strictEqual(out[2].reason, "primary total 3", "one short clause - the soft-note count stays on softCount (the chip's tooltip), never in the reason");
      assert.deepStrictEqual(out[0].window, { from: "2026-09-14", to: "2026-12-31" }, "the tally window (the year's floor .. Dec 31) rides along for the tooltip");
      assert.strictEqual(out[0].name, "Acton");
      assert.deepStrictEqual([out[0].returnDay, out[0].returnRole], [null, null], "a one-way ranking suggests no return day");
      assert.ok(calls.every(c => c.cand !== "s1"), "one-way: the proposer's return eligibility is never checked (d is skipped)");
      // backup role: the backup totals rank (s4 = 2 backup days, s3 = 3, s2 = 5)
      const b = H.suggestTradePartners({}, sched, "2026-10-06", "backup", "s1", { ...base, twoWay: false });
      assert.deepStrictEqual(b.map(x => x.id + ":" + x.total), ["s4:2", "s3:3", "s2:5"]);
      assert.strictEqual(b[0].reason, "lowest backup total, 2");
      // the cap: a pool of four eligible people still yields three chips
      const many = H.suggestTradePartners({}, sched, "2026-10-05", "primary", "s1", { ...base, twoWay: false, pool: ["s2", "s3", "s4", "s7"], eligibility: () => ({ ok: true, hard: [], soft: [] }) });
      assert.strictEqual(many.length, 3);
      // no rules context / no check injected / a bad day = no suggestions, never a throw
      assert.deepStrictEqual(H.suggestTradePartners(null, sched, "2026-10-05", "primary", "s1", base), []);
      assert.deepStrictEqual(H.suggestTradePartners({}, sched, "2026-10-05", "primary", "s1", { ...base, eligibility: null }), []);
      assert.deepStrictEqual(H.suggestTradePartners({}, sched, "garbage", "primary", "s1", base), []);
      assert.deepStrictEqual(H.suggestTradePartners({}, sched, "2026-10-05", "primary", "s1", { ...base, pool: ["s5", "s6"] }), [], "nobody eligible = no row");
      const throwing = H.suggestTradePartners({}, sched, "2026-10-05", "primary", "s1", { ...base, eligibility: () => { throw new Error("boom"); } });
      assert.deepStrictEqual(throwing, [], "a throwing check counts as unknown - nobody is suggested");
    });
    check("Item C: a two-way (member) ranking prefers people holding an upcoming day the proposer may take back - the EARLIEST workable one is the chip's return day - and ranks 'no return day found' last; a unit day of theirs comes back only as a whole unit pairing day for day", () => {
      calls.length = 0;
      const out = H.suggestTradePartners({}, sched, "2026-10-05", "primary", "s1", { ...base, twoWay: true });
      assert.deepStrictEqual(out.map(x => x.id), ["s3", "s4", "s2"]);
      // s3's earliest upcoming day is 10/05 backup (the same day s1 gives) - the injected check decides, and it allows it here
      assert.deepStrictEqual([out[0].returnDay, out[0].returnRole], ["2026-10-05", "backup"]);
      assert.strictEqual(out[0].reason, "can give back Mon 10/5 B");
      // s2: 10/06 primary is refused for s1 (the stub), so his 10/07 primary is the earliest workable return
      assert.deepStrictEqual([out[2].returnDay, out[2].returnRole, out[2].reason], ["2026-10-07", "primary", "can give back Wed 10/7 P"]);
      // s4: 10/07 backup is his earliest day
      assert.deepStrictEqual([out[1].returnDay, out[1].returnRole], ["2026-10-07", "backup"]);
      // someone with no workable return day ranks LAST even with the lowest total: s3 refused on every day of his
      const noRet = (days, role, cand) => cand === "s1" && ["2026-10-05", "2026-10-09", "2026-10-10", "2026-10-11"].some(d => days.indexOf(d) >= 0) ? { ok: false, hard: ["blocked"], soft: [] } : elig(days, role, cand);
      const o2 = H.suggestTradePartners({}, sched, "2026-10-05", "primary", "s1", { ...base, twoWay: true, eligibility: noRet });
      assert.deepStrictEqual(o2.map(x => x.id), ["s4", "s2", "s3"], "s3 drops to the end");
      assert.deepStrictEqual([o2[2].returnDay, o2[2].reason], [null, "no return day found"]);
      // an OPT-IN horizon: nothing after today + horizonDays is offered back (the default scans the whole schedule - below)
      const near = H.suggestTradePartners({}, sched, "2026-10-05", "primary", "s1", { ...base, twoWay: true, today: "2026-10-01", horizonDays: 3 });
      assert.strictEqual(near.find(x => x.id === "s4").returnDay, null, "s4's first day (10/07) lies past a 3-day horizon");
      // unit-aware (e): s1 gives his whole Fri-Sun block 10/16-18 - the check runs over the three days, and a unit day of
      // s4's (his 10/23-25 primary block) comes back only as the whole block, day for day; s4's single 10/07 backup is earlier and plain, so it wins
      calls.length = 0;
      const unitDays = ["2026-10-16", "2026-10-17", "2026-10-18"];
      const unitOut = H.suggestTradePartners({}, sched, "2026-10-16", "primary", "s1", { ...base, twoWay: true, offerDays: unitDays });
      assert.ok(calls.some(c => c.cand === "s3" && c.days.join(",") === unitDays.join(",") && c.role === "primary"), "the give-away check covers the whole unit");
      const s4u = unitOut.find(x => x.id === "s4");
      assert.deepStrictEqual([s4u.returnDay, s4u.returnDays], ["2026-10-07", ["2026-10-07"]], "the earliest plain day wins over the later block");
      // with s4's plain days refused, the block is the return unit - all three days, paired
      const s4Plain = (d) => d.length === 1 && sched[d[0]] && (sched[d[0]].primary === "s4" || sched[d[0]].backup === "s4");
      const u2 = H.suggestTradePartners({}, sched, "2026-10-16", "primary", "s1", { ...base, twoWay: true, offerDays: unitDays, eligibility: (d, r, c) => c === "s1" && d.length === 3 ? { ok: true, hard: [], soft: [] } : (c === "s1" && s4Plain(d) ? { ok: false, hard: ["blocked"], soft: [] } : elig(d, r, c)) });
      const s4b = u2.find(x => x.id === "s4");
      assert.deepStrictEqual([s4b.returnDay, s4b.returnRole, s4b.returnDays, s4b.reason], ["2026-10-23", "primary", ["2026-10-23", "2026-10-24", "2026-10-25"], "can give back Fri 10/23 P (3-day unit)"]);
      // a SINGLE given day never takes a unit day of theirs back (that would split their unit)
      const single = H.suggestTradePartners({}, sched, "2026-10-05", "primary", "s1", { ...base, twoWay: true, eligibility: (d, r, c) => c === "s1" && s4Plain(d) ? { ok: false, hard: ["blocked"], soft: [] } : elig(d, r, c) });
      assert.strictEqual(single.find(x => x.id === "s4").returnDay, null, "s4's only remaining days are his 10/23-25 block - not offered against a single day");
    });
    // Review (9/24): the vacation-conflict box's suggestion must never hand back a return day INSIDE the vacation range
    // that was just refused (the time_off row was never written, so the rules cannot know it) - opts.avoidReturnDays
    // ({ start, end } or a predicate) skips those days (a unit when ANY of its days falls inside); and the return-day
    // scan covers the whole published schedule by default (no 120-day horizon - the card's own return picker is unbounded).
    check("Item C (review): avoidReturnDays skips a return day or unit inside the refused vacation window (the next workable day is offered, someone left with nothing reads 'no return day found' and ranks last) and the default scan covers the whole published schedule, not 120 days", () => {
      // s1 (refused 10/05-10/07 off) gives 10/05 primary: s3's 10/05 B and s2's 10/07 P / s4's 10/07 B lie inside the window
      const win = H.suggestTradePartners({}, sched, "2026-10-05", "primary", "s1", { ...base, twoWay: true, avoidReturnDays: { start: "2026-10-05", end: "2026-10-07" } });
      assert.deepStrictEqual(win.map(x => x.id), ["s3", "s4", "s2"], "the ranking itself is unchanged - everyone still has a workable day");
      assert.deepStrictEqual(win.map(x => x.returnDay + " " + x.returnRole), ["2026-10-09 backup", "2026-10-08 primary", "2026-10-08 backup"], "the earliest day OUTSIDE the window: s3 10/09 B (not 10/05), s4 10/08 P (not 10/07 B), s2 10/08 B (10/06 refused by the stub, 10/07 inside the window)");
      assert.strictEqual(win[0].reason, "can give back Fri 10/9 B");
      // a predicate form; a window swallowing every October day of a partner leaves 'no return day found' - and he ranks last
      const far = { ...sched, "2027-02-10": { primary: "s3", backup: "s2" } };            // 132 days past today - beyond the old 120-day horizon
      const oct = H.suggestTradePartners({}, far, "2026-10-05", "primary", "s1", { ...base, twoWay: true, avoidReturnDays: (d) => d <= "2026-10-31" });
      assert.deepStrictEqual(oct.map(x => x.id), ["s3", "s2", "s4"], "s4 (nothing left to give back) drops to the end although his total ranks him second");
      assert.deepStrictEqual([oct[0].returnDay, oct[0].returnRole, oct[0].reason], ["2027-02-10", "primary", "can give back Wed 2/10 P"], "the default scan reaches the whole published schedule");
      assert.deepStrictEqual([oct[1].returnDay, oct[1].returnRole], ["2027-02-10", "backup"]);
      assert.deepStrictEqual([oct[2].returnDay, oct[2].reason], [null, "no return day found"]);
      // a return UNIT is skipped when any one of its days falls inside the window: s1 gives his 10/16-18 block, s4's plain
      // days are refused, and the window covers 10/24 alone - the 10/23-25 block is no longer offered back
      const unitDays = ["2026-10-16", "2026-10-17", "2026-10-18"];
      const s4Plain = (d) => d.length === 1 && sched[d[0]] && (sched[d[0]].primary === "s4" || sched[d[0]].backup === "s4");
      const blockElig = (d, r, c) => c === "s1" && d.length === 3 ? { ok: true, hard: [], soft: [] } : (c === "s1" && s4Plain(d) ? { ok: false, hard: ["blocked"], soft: [] } : elig(d, r, c));
      const withBlock = H.suggestTradePartners({}, sched, "2026-10-16", "primary", "s1", { ...base, twoWay: true, offerDays: unitDays, eligibility: blockElig });
      assert.strictEqual(withBlock.find(x => x.id === "s4").returnDay, "2026-10-23", "control: without a window the block comes back");
      const noBlock = H.suggestTradePartners({}, sched, "2026-10-16", "primary", "s1", { ...base, twoWay: true, offerDays: unitDays, eligibility: blockElig, avoidReturnDays: { start: "2026-10-24", end: "2026-10-24" } });
      assert.deepStrictEqual([noBlock.find(x => x.id === "s4").returnDay, noBlock.find(x => x.id === "s4").reason], [null, "no return day found"]);
      // the window never touches a one-way ranking or the give-away check itself
      const oneWay = H.suggestTradePartners({}, sched, "2026-10-05", "primary", "s1", { ...base, twoWay: false, avoidReturnDays: { start: "2026-10-01", end: "2026-12-31" } });
      assert.deepStrictEqual(oneWay.map(x => x.id), ["s3", "s4", "s2"]);
    });
    check("Item C pins: the card renders tradeSuggestionsFor (the pure helper over tradeEligibility / tradeEligibilityOver / tradeUnitOf, two-way for members) as trade-suggest-chip buttons that fill Trade with and the return day; the vacation-conflict box and the day editor's link pre-fill the card with the top suggestion", () => {
      const tf = src.indexOf("const tradeSuggestionsFor = (day, role, fromId, kind) => {"); // Prompt 19 S2: kind ("give" skips the return-day ranking)
      assert.ok(tf > 0, "tradeSuggestionsFor at App scope");
      const tfBody = src.slice(tf, src.indexOf("const unitText = ", tf));
      assert.ok(tfBody.length > 0 && tfBody.length < 3000, "tradeSuggestionsFor precedes unitText");
      assert.ok(tfBody.includes("if (!rulesCtx || !suIsIso(day) || !fromId) return [];"), "no rules context = no suggestions");
      assert.ok(tfBody.includes("return suggestTradePartners(rulesCtx, schedule, day, role, fromId, {"), "the pure helper does the ranking");
      assert.ok(tfBody.includes("twoWay: !isScheduler"), "members get the two-way ranking; the scheduler's one-way proposals skip it");
      assert.ok(tfBody.includes("eligibility: (days, r, cand) => days.length > 1 ? tradeEligibilityOver(days, r, cand) : tradeEligibility(days[0], r, cand)"), "the card's own check is injected");
      assert.ok(tfBody.includes("unitOf: tradeUnitOf"), "the card's unit finder is injected");
      assert.ok(tfBody.includes("const whole = !!unit && tradeWholeUnit;") && tfBody.includes("offerDays: whole ? unit.days : [day]"), "unit-aware: the whole unit is ranked when the box is ticked");
      assert.ok(tfBody.includes("floors: TOTALS_YTD_FLOORS") && src.includes("ytdFloors={TOTALS_YTD_FLOORS}"), "the year tally uses the Totals card's floor");
      const card = src.slice(src.indexOf('<div style={css.cardT}>Propose a shift trade</div>'), src.indexOf('data-testid="trades-pending"'));
      assert.ok(card.includes('data-testid="trade-suggested"') && card.includes('data-testid="trade-suggest-chip"'), "the Suggested row and its chips");
      assert.ok(card.indexOf('data-testid="trade-suggested"') < card.indexOf('data-testid="trade-to"'), "the row sits above Trade with");
      assert.ok(card.includes("setTradeTo(x.id); setTradeReturnDay(x.returnDay || \"\"); if (x.returnRole) setTradeReturnRole(x.returnRole);"), "one tap fills Trade with and the return day");
      assert.ok(card.includes("{x.name} - {x.reason}"), "each chip reads 'Name - reason'");
      const vac = src.slice(src.indexOf('data-testid="vac-conflict"'), src.indexOf("const authBox = "));
      assert.ok(vac.includes('data-testid="vac-conflict-trade"') && vac.includes('propose a trade{sug ? " - suggested: " + sug.name : ""}'), "the vacation-conflict button names the top suggestion");
      assert.ok(vac.includes("proposeTradeForDay(c.day, c.role, tradePickOf(vacConflict.personId, sug))"), "and pre-fills the card through proposeTradeForDay");
      const pt = src.slice(src.indexOf("const proposeTradeForDay = (day, role, pick) => {"), src.indexOf("// --- Clear schedule"));
      assert.ok(pt.includes("if (pick && pick.to) { setTradeTo(pick.to); setTradeReturnDay(pick.returnDay || \"\"); if (pick.returnRole) setTradeReturnRole(pick.returnRole); }"), "proposeTradeForDay pre-fills the counter-party and the return day");
      assert.ok(pt.includes("else if (isScheduler && pick && pick.from && poolSurgeons.some(s => s.id === pick.from)) setTradeFrom(pick.from);"), "the scheduler's From follows the holder the suggestion was made for - only a pool member (an outside surgeon written in by hand never becomes From)");
      // review (9/24): the refused-vacation window - the box and the card share it through tradeSuggestionsFor
      assert.ok(tfBody.includes("avoidReturnDays: tradeAvoidWindow(day, fromId)"), "no return day inside the vacation range that was just refused");
      const aw = src.slice(src.indexOf("const tradeAvoidWindow = (day, fromId) =>"), tf);
      assert.ok(aw.length > 0 && aw.length < 900 && aw.includes("vacConflict.personId === fromId") && aw.includes("(vacConflict.items || []).some(i => i.day === day)") && aw.includes("{ start: vacConflict.start, end: vacConflict.end }"), "the window is the refused range, only for the refused person's own conflicting slots");
      assert.ok(src.includes("onTrade={proposeTradeForDay}") && src.includes("suggestTrade={(d, r) => {"), "the day editor gets the suggestion callback");
      const st = src.slice(src.indexOf("suggestTrade={(d, r) => {"), src.indexOf("css={css} dk={dk}/>", src.indexOf("suggestTrade={(d, r) => {")));
      assert.ok(st.includes("return from && poolSurgeons.some(s => s.id === from) ? tradePickOf(from, tradeSuggestionsFor(d, r, from)[0] || null) : null;"), "the editor suggests nothing (and moves no From) when the holder is not a pool member");
      const ed = src.slice(src.indexOf("function DayEditor(props) {"), src.indexOf('data-testid="editor-footer"'));
      assert.ok(ed.includes("const tradePick = typeof suggestTrade === \"function\" && !isPublicMode && (canEdit || myRole) ? suggestTrade(day, tradeLinkRole) : null;"), "the editor computes the top suggestion for the link's role");
      const et = src.indexOf('data-testid="editor-trade"');
      const link = src.slice(et, src.indexOf("Propose a trade for this day", et) + 140);
      assert.ok(link.includes("onClick={() => onTrade(day, tradeLinkRole, tradePick || undefined)}") && link.includes('Propose a trade for this day{tradePick && tradePick.to ? " - suggested: " + tradePick.name : ""}'), "the link names the suggestion and passes it on");
    });
  }
  // Prompt 19 step 2 (Faraz 9/24): "Give a day away" on the Propose card - a Trade / Give away switch; a give carries no
  // return leg, every row is sent with kind 'give' and is worded as a give; the unit rule and the receiver's eligibility
  // check are the trade path's. helpers.tradeGiveMsg / tradeProposalRows are pure (behaviour); the card and
  // submitTradeRequest are pinned.
  {
    const mk = (o) => ({ fromId: "s3", fromName: "Acton", toId: "s2", toName: "Burchett", role: "primary", returnRole: "backup", isScheduler: false, submittedAt: "2026-09-24T12:00:00.000Z", ...o });
    const tg = ["2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"];
    const stampOf = (i) => "[unit holiday 2026-11-26 4: Thanksgiving unit 11/26-11/29 (4 days), day " + (i + 1) + " of 4]";
    check("Prompt 19 S2: helpers.tradeGiveMsg words a give for the receiver and names him - 'Acton offers you Sat 10/10 primary - nothing in return (a give to Burchett)'; a whole unit reads 'the <unit> <role>'; ASCII", () => {
      assert.strictEqual(typeof H.tradeGiveMsg, "function", "helpers.tradeGiveMsg is exported");
      const req = { from_surgeon_name: "Acton", to_surgeon_name: "Burchett", day: "2026-10-10", role: "primary" };
      assert.strictEqual(H.tradeGiveMsg(req), "Acton offers you Sat 10/10 primary - nothing in return (a give to Burchett)");
      assert.strictEqual(H.tradeGiveMsg({ ...req, day: "2026-10-13", role: "backup" }), "Acton offers you Tue 10/13 backup - nothing in return (a give to Burchett)");
      assert.strictEqual(H.tradeGiveMsg({ ...req, day: "2026-11-26" }, "Thanksgiving unit 11/26-11/29 (4 days)"), "Acton offers you the Thanksgiving unit 11/26-11/29 (4 days) primary - nothing in return (a give to Burchett)");
      assert.ok(!/[^\x00-\x7f]/.test(H.tradeGiveMsg(req)), "ASCII");
    });
    // S2 review: the give's e-mail goes to BOTH parties and send-notification greets each by name ("Hi Acton, ..."), so
    // its subject and message are neutral - the receiver-addressed tradeGiveMsg stays the in-app / row wording.
    check("Prompt 19 S2 review: helpers.tradeGiveEmail - a neutral subject 'Day offered: Sat 10/10 primary (Acton to Burchett)' and message for the two-party e-mail (no 'you'); a whole unit reads 'the <unit> <role>'; ASCII", () => {
      assert.strictEqual(typeof H.tradeGiveEmail, "function", "helpers.tradeGiveEmail is exported");
      const req = { from_surgeon_name: "Acton", to_surgeon_name: "Burchett", day: "2026-10-10", role: "primary" };
      assert.deepStrictEqual(H.tradeGiveEmail(req), {
        subject: "Day offered: Sat 10/10 primary (Acton to Burchett)",
        message: "Acton is offering Sat 10/10 primary to Burchett - nothing in return. Burchett can accept or decline in the app; the schedule changes only if Burchett accepts.",
      });
      const u = H.tradeGiveEmail({ ...req, day: "2026-11-26" }, "Thanksgiving unit 11/26-11/29 (4 days)");
      assert.strictEqual(u.subject, "Day offered: the Thanksgiving unit 11/26-11/29 (4 days) primary (Acton to Burchett)");
      assert.ok(u.message.startsWith("Acton is offering the Thanksgiving unit 11/26-11/29 (4 days) primary to Burchett - nothing in return."));
      assert.ok(!/\byou\b/i.test(u.subject + " " + u.message), "neither line addresses one party as 'you'");
      assert.ok(!/[^\x00-\x7f]/.test(u.subject + u.message), "ASCII");
    });
    check("Prompt 19 S2: helpers.tradeProposalRows - a give has no return leg on any row (even when retDays is handed in) and sends kind 'give' on every row; a trade row keeps the pre-Prompt 19 shape (no kind); a member's unit tail rows (no return leg) go as 'give'; the scheduler's rows are unchanged", () => {
      assert.strictEqual(typeof H.tradeProposalRows, "function", "helpers.tradeProposalRows is exported");
      // a single-day give
      const g1 = H.tradeProposalRows(mk({ give: true, days: ["2026-10-10"], retDays: [] }));
      assert.deepStrictEqual(g1, [{ from_surgeon_id: "s3", from_surgeon_name: "Acton", to_surgeon_id: "s2", to_surgeon_name: "Burchett", day: "2026-10-10", role: "primary", return_day: null, return_role: null, status: "pending", submitted_at: "2026-09-24T12:00:00.000Z", kind: "give", detail: "Acton offers you Sat 10/10 primary - nothing in return (a give to Burchett)" }]);
      // a give never carries a return leg, whatever is left in the form
      const g2 = H.tradeProposalRows(mk({ give: true, days: ["2026-10-10"], retDays: ["2026-10-20"] }));
      assert.strictEqual(g2[0].return_day, null); assert.strictEqual(g2[0].return_role, null); assert.strictEqual(g2[0].kind, "give");
      // a whole-unit give: one row per day, each kind give, no return, the unit stamp appended
      const gu = H.tradeProposalRows(mk({ give: true, days: tg, retDays: ["2026-12-01"], stamp: stampOf }));
      assert.deepStrictEqual(gu.map(r => r.day), tg);
      assert.ok(gu.every(r => r.kind === "give" && r.return_day === null && r.return_role === null), "every unit row is a one-way give");
      assert.strictEqual(gu[1].detail, "Acton offers you Fri 11/27 primary - nothing in return (a give to Burchett) " + stampOf(1));
      // the scheduler's give: kind give as well (trade_insert_guard allows it)
      assert.ok(H.tradeProposalRows(mk({ give: true, isScheduler: true, days: tg, stamp: stampOf })).every(r => r.kind === "give" && r.return_day === null));
      // a member's single-day trade: the pre-Prompt 19 row, key for key - no kind (the column default 'trade')
      const t1 = H.tradeProposalRows(mk({ give: false, days: ["2026-10-10"], retDays: ["2026-10-20"] }));
      assert.deepStrictEqual(Object.keys(t1[0]), ["from_surgeon_id", "from_surgeon_name", "to_surgeon_id", "to_surgeon_name", "day", "role", "return_day", "return_role", "status", "submitted_at", "detail"]);
      assert.strictEqual(t1[0].return_day, "2026-10-20"); assert.strictEqual(t1[0].return_role, "backup");
      assert.strictEqual(t1[0].detail, "Acton proposed a trade: Burchett would take Primary - Sat Oct 10; Acton would take Backup - Tue Oct 20");
      // a member's whole unit traded for ONE return day: row 1 carries it (no kind), rows 2..4 are one-way -> kind give
      const tu = H.tradeProposalRows(mk({ give: false, days: tg, retDays: ["2026-12-01"], stamp: stampOf }));
      assert.deepStrictEqual(tu.map(r => [r.return_day, r.kind || null]), [["2026-12-01", null], [null, "give"], [null, "give"], [null, "give"]]);
      assert.ok(tu.every((r, i) => r.detail.endsWith(" " + stampOf(i))), "the unit stamp ties the rows together (tradeGroupOf ignores kind)");
      assert.ok(/proposed a trade: .*one-way - no return shift/.test(tu[1].detail), "a tail row keeps the trade wording");
      // unit for unit: every row has its return -> no kind anywhere
      const uu = H.tradeProposalRows(mk({ give: false, days: tg, retDays: ["2026-12-24", "2026-12-25", "2026-12-26", "2026-12-27"], stamp: stampOf }));
      assert.ok(uu.every((r, i) => r.return_day === ["2026-12-24", "2026-12-25", "2026-12-26", "2026-12-27"][i] && !("kind" in r)));
      // the scheduler: a one-way trade and his unit tails stay 'trade' rows (no kind), exactly as before
      assert.ok(!("kind" in H.tradeProposalRows(mk({ give: false, isScheduler: true, days: ["2026-10-10"], retDays: [] }))[0]));
      assert.ok(H.tradeProposalRows(mk({ give: false, isScheduler: true, days: tg, retDays: ["2026-12-01"], stamp: stampOf })).every(r => !("kind" in r)));
      assert.deepStrictEqual(H.tradeProposalRows(mk({ give: true, days: [] })), [], "no days, no rows");
    });
    check("Prompt 19 S2 pins: submitTradeRequest - the holder, unit-split and receiver-eligibility checks run for a give exactly as for a trade; a give skips the return leg and the one-way confirm; rows come from tradeProposalRows; the audit row, the notification and the e-mail carry / read as a give", () => {
      const a = src.indexOf("const submitTradeRequest = async () => {");
      const b = src.slice(a, src.indexOf("// --- Status writes ---", a));
      assert.ok(a > 0 && b.length > 0 && b.length < 9000, "submitTradeRequest precedes the status writes");
      const at = (needle) => { const i = b.indexOf(needle); assert.ok(i > 0, "missing: " + needle); return i; };
      const giveI = at('const give = tradeKind === "give";');
      const holderI = at("if (holder !== fromId) {");
      const splitI = at("if (unit && !whole) {\n      if (!isScheduler) { showToast(`Blocked: ${fmtMD(tradeDay)} is ${reasonLabel(\"unit-split:\" + unitText(unit))}.`, \"error\"); return; }");
      const eligI = at("const elig = whole ? tradeEligibilityOver(days, tradeRole, tradeTo) : tradeEligibility(tradeDay, tradeRole, tradeTo);");
      const branchI = at("    if (give) {\n");
      const retI = at("} else if (tradeReturnDay) {");
      const reqI = at("} else if (!isScheduler) {\n      showToast(\"A return shift is required - pick the day and role you'll take in return, or switch to Give away (nothing in return).\", \"error\");");
      const confI = at('} else if (!confirm("No return shift specified. One-way trades are for emergencies only. Submit anyway?")) return;');
      const rowsI = at("const rows = tradeProposalRows({ fromId, fromName, toId: tradeTo, toName, days, role: tradeRole, retDays, returnRole: tradeReturnRole, give, isScheduler, stamp: whole ? (i) => tradeUnitStamp(unit, i) : null, submittedAt: new Date().toISOString() });");
      assert.ok(giveI < holderI && holderI < splitI && splitI < eligI && eligI < branchI && branchI < retI && retI < reqI && reqI < confI && confI < rowsI, "order: kind, holder, unit split, receiver eligibility, then give | return leg | member refusal | scheduler confirm, then the rows");
      assert.ok(!/if \(give\)[^\n]*return;/.test(b.slice(giveI, eligI)), "no early exit for a give before the shared checks");
      assert.ok(b.includes('db.insert("shift_trade_requests", req)'), "the insert path is the trade's");
      assert.ok(b.includes("const msg = give ? tradeGiveMsg({ from_surgeon_name: fromName, to_surgeon_name: toName, day: days[0], role: tradeRole }, whole ? unitText(unit) : null)"), "the proposal message reads as a give (the unit named when whole)");
      assert.ok(b.includes('unit: unit ? unit.name : null, kind: give ? "give" : "trade" });'), "the trade.propose audit row carries kind");
      assert.ok(b.includes('await addNotification("trade_proposed", give ? "Day offered - nothing in return" : "Shift trade proposed", msg, {') && b.includes('day: tradeDay, kind: give ? "give" : "trade" });'), "the in-app notification: same type, a give title, kind in data");
      assert.ok(b.includes("const giveMail = give ? tradeGiveEmail({ from_surgeon_name: fromName, to_surgeon_name: toName, day: days[0], role: tradeRole }, whole ? unitText(unit) : null) : null;"), "a give's e-mail words come from tradeGiveEmail (neutral - both parties get it)");
      assert.ok(b.includes('sendEmailNotif("trade_proposed", giveMail ? { message: giveMail.message, subject: giveMail.subject, trade_id: first.id, kind: "give" } : { message: msg, subject: "Shift trade proposed - " + (whole ? unitText(unit) : slotLabel(tradeDay, tradeRole)), trade_id: first.id }, [fromId, tradeTo]);'), "the e-mail: trade_proposed with trade_id, both parties, the neutral give subject / message; a trade's e-mail unchanged");
      assert.ok(!b.includes("Day offered to you"), "no receiver-addressed subject on the two-party e-mail");
      assert.ok(!b.includes("tradeProposeMsg(req)"), "the row sentence is composed in tradeProposalRows");
    });
    check("Prompt 19 S2 pins: the card's Trade / Give away switch (aria-pressed) sits above the form; give clears the return day, hides every return control, says 'Give to', ranks one-way suggestions and labels the button 'Offer this day to <Name>' / 'Offer the <unit> to <Name>'; the trade entry points reset it to trade", () => {
      assert.ok(src.includes('const [tradeKind, setTradeKind] = useState("trade");'), "state, trade by default");
      const c0 = src.indexOf('<div style={css.cardT}>Propose a shift trade</div>');
      const card = src.slice(c0, src.indexOf('data-testid="trades-pending"', c0));
      const sw = card.indexOf('data-testid="trade-kind"'), form = card.indexOf("{!fromId ? <p style={muted}>");
      assert.ok(sw > 0 && form > sw, "the switch sits above the form");
      assert.ok(card.includes('<button type="button" data-testid="trade-kind-trade" aria-pressed={!give} onClick={()=>setTradeKind("trade")}') && card.includes(">Trade (day for day)</button>"), "Trade (day for day)");
      assert.ok(card.includes('<button type="button" data-testid="trade-kind-give" aria-pressed={give} onClick={()=>{ setTradeKind("give"); setTradeReturnDay(""); }}') && card.includes(">Give away (nothing in return)</button>"), "Give away clears any chosen return day");
      const open = card.indexOf("{!give && <>"), close = card.indexOf("</>}", open);
      assert.ok(open > 0 && close > open, "the return controls are wrapped");
      ["trade-theirs-pick", "trade-return-day", "trade-return-role", "trade-return-unit", "trade-return-reason"].forEach(t => {
        const i = card.indexOf('data-testid="' + t + '"');
        assert.ok(i > open && i < close, t + " renders only in trade mode");
      });
      assert.ok(card.indexOf('data-testid="trade-submit"') > close && card.indexOf('data-testid="trade-to"') < open, "Give to and the button stay");
      assert.ok(card.includes('<label style={label}>{give ? "Give to" : "Trade with"}</label>'), "the receiver select reads Give to");
      assert.ok(card.includes('{tradeBusy === "propose" ? "Submitting" : give ? (whole ? "Offer the " + unitText(unit) : "Offer this day") + (tradeTo ? " to " + nameOf(tradeTo) : "") : whole ? `Propose unit trade (${offerDays.length} days)` : "Propose trade"}'), "the button text");
      assert.ok(card.includes("const sugg = tradeSuggestionsFor(tradeDay, tradeRole, fromId, tradeKind);"), "the chips follow the switch");
      assert.ok(src.includes('twoWay: !isScheduler && kind !== "give"'), "a give skips the return-day ranking (d) - the one-way path");
      assert.ok(src.includes('const retUnit = !give && suIsIso(tradeReturnDay)') && src.includes('const retElig = !give && suIsIso(tradeReturnDay)'), "no return checks in give mode");
      const pt = src.slice(src.indexOf("const proposeTradeForDay = (day, role, pick) => {"), src.indexOf("// --- Clear schedule"));
      assert.ok(pt.includes('setTradeKind("trade");'), "'Propose a trade' entry points open the card in trade mode");
      assert.ok(!/[^\x00-\x7f]/.test(card), "the card source stays ASCII");
    });
  }
  // Prompt 19 step 3 (Faraz 9/24): accept / decline of a give. The receiver reads the pending give in Trades and in
  // Alerts ("Acton offers you Sat 10/10 primary (weekend unit, 10/10-10/11) - nothing in return", em / en dash) with
  // Accept / Decline; eligibility is re-checked at accept; apply_trade runs one-way for every row; both parties get the
  // accepted + applied rows and the scheduler(s) get the applied give in-app and by e-mail (trade_applied to [from, to,
  // ...schedulerIds] - send-notification v7). The helpers are pure (behaviour); the status writes are lifted out of the
  // component verbatim and run against stubs (behaviour); the Trades / Alerts rendering is pinned.
  {
    const tag2 = { kind: "weekend-block", start: "2026-10-10", n: 2, text: "weekend block unit 10/10-10/11 (2 days)" };
    const stamp2 = (i) => "[unit weekend-block 2026-10-10 2: weekend block unit 10/10-10/11 (2 days), day " + (i + 1) + " of 2]";
    const giveRow = (o) => ({ id: "g1", from_surgeon_id: "s3", from_surgeon_name: "Acton", to_surgeon_id: "s2", to_surgeon_name: "Burchett", day: "2026-10-10", role: "primary", return_day: null, return_role: null, kind: "give", status: "pending", submitted_at: "2026-09-24T12:00:00.000Z", detail: "x", ...o });
    const unitGive = (o) => [giveRow({ detail: "Acton offers you Sat 10/10 primary - nothing in return (a give to Burchett) " + stamp2(0), ...o }), giveRow({ id: "g2", day: "2026-10-11", detail: "Acton offers you Sun 10/11 primary - nothing in return (a give to Burchett) " + stamp2(1), ...o })];
    check("Prompt 19 S3: helpers.tradeIsGive / tradeGroupIsGive - a row is a give when kind 'give' and no return leg; a GROUP only when every row is (a member's unit trade - head with the return leg, 'give' tails - stays a trade); a pre-migration row (no kind) is a trade", () => {
      assert.strictEqual(typeof H.tradeIsGive, "function", "helpers.tradeIsGive is exported");
      assert.strictEqual(typeof H.tradeGroupIsGive, "function", "helpers.tradeGroupIsGive is exported");
      assert.strictEqual(H.tradeIsGive(giveRow()), true);
      assert.strictEqual(H.tradeIsGive(giveRow({ kind: undefined })), false, "a pre-migration row (no kind) is a trade");
      assert.strictEqual(H.tradeIsGive(giveRow({ kind: "trade" })), false);
      assert.strictEqual(H.tradeIsGive(giveRow({ return_day: "2026-10-20", return_role: "backup" })), false, "a row with a return leg is never read as a give");
      assert.strictEqual(H.tradeIsGive(null), false);
      assert.strictEqual(H.tradeGroupIsGive(unitGive()), true, "every row of the unit is a give");
      assert.strictEqual(H.tradeGroupIsGive([giveRow({ kind: undefined, return_day: "2026-12-01", return_role: "backup" }), giveRow({ id: "g2", day: "2026-10-11" })]), false, "a member's unit TRADE (the head carries the return leg; the tails go as 'give') is a trade");
      assert.strictEqual(H.tradeGroupIsGive([]), false, "no rows");
      assert.strictEqual(H.tradeGroupIsGive(giveRow()), true, "a lone row");
    });
    check("Prompt 19 S3: helpers.tradeGiveLine - the receiver reads 'Acton offers you Sat 10/10 primary (weekend unit, 10/10\u201310/11) \u2014 nothing in return'; the giver and the scheduler read both names; a holiday unit names the holiday; accepted / applied / declined / cancelled wording", () => {
      assert.strictEqual(typeof H.tradeGiveLine, "function", "helpers.tradeGiveLine is exported");
      assert.strictEqual(H.tradeGiveLine(giveRow(), tag2, "s2"), "Acton offers you Sat 10/10 primary (weekend unit, 10/10\u201310/11) \u2014 nothing in return");
      assert.strictEqual(H.tradeGiveLine(giveRow(), null, "s2"), "Acton offers you Sat 10/10 primary \u2014 nothing in return");
      assert.strictEqual(H.tradeGiveLine(giveRow(), tag2, "s3"), "Acton offers Burchett Sat 10/10 primary (weekend unit, 10/10\u201310/11) \u2014 nothing in return", "the giver reads both names");
      assert.strictEqual(H.tradeGiveLine(giveRow(), null, null), "Acton offers Burchett Sat 10/10 primary \u2014 nothing in return", "the scheduler (no roster link needed) reads both names");
      const tg = { kind: "holiday", start: "2026-11-26", n: 4, text: "Thanksgiving unit 11/26-11/29 (4 days)" };
      assert.strictEqual(H.tradeGiveLine(giveRow({ day: "2026-11-27" }), tg, "s2"), "Acton offers you Fri 11/27 primary (Thanksgiving unit, 11/26\u201311/29) \u2014 nothing in return");
      assert.strictEqual(H.tradeGiveLine(giveRow({ status: "accepted" }), null, "s2"), "Burchett takes Sat 10/10 primary from Acton \u2014 nothing in return");
      assert.strictEqual(H.tradeGiveLine(giveRow({ status: "applied", role: "backup" }), null, "s3"), "Burchett takes Sat 10/10 backup from Acton \u2014 nothing in return");
      assert.strictEqual(H.tradeGiveLine(giveRow({ status: "declined" }), null, "s2"), "Burchett declined Acton's offer of Sat 10/10 primary");
      assert.strictEqual(H.tradeGiveLine(giveRow({ status: "cancelled" }), tag2, "s2"), "Acton withdrew the offer of Sat 10/10 primary (weekend unit, 10/10\u201310/11) to Burchett");
    });
    check("Prompt 19 S3: helpers.tradeGiveAppliedLine - 'Give applied: Acton \u2192 Burchett, 10/10\u201310/11 primary' for a unit (days in any order), 'Give applied: Acton \u2192 Burchett, Sat 10/10 primary' for a day; tradeAppliedTargets - [from, to, ...schedulerIds] de-duplicated, the parties alone when the scheduler lookup failed (null)", () => {
      assert.strictEqual(typeof H.tradeGiveAppliedLine, "function", "helpers.tradeGiveAppliedLine is exported");
      assert.strictEqual(typeof H.tradeAppliedTargets, "function", "helpers.tradeAppliedTargets is exported");
      assert.strictEqual(H.tradeGiveAppliedLine(giveRow(), ["2026-10-11", "2026-10-10"]), "Give applied: Acton \u2192 Burchett, 10/10\u201310/11 primary");
      assert.strictEqual(H.tradeGiveAppliedLine(giveRow(), ["2026-10-10"]), "Give applied: Acton \u2192 Burchett, Sat 10/10 primary");
      assert.strictEqual(H.tradeGiveAppliedLine(giveRow({ role: "backup" })), "Give applied: Acton \u2192 Burchett, Sat 10/10 backup", "no days = the row's own day");
      assert.deepStrictEqual(H.tradeAppliedTargets(giveRow(), ["s1"]), ["s3", "s2", "s1"]);
      assert.deepStrictEqual(H.tradeAppliedTargets(giveRow(), ["s1", "s3", "s6"]), ["s3", "s2", "s1", "s6"], "a scheduler who is a party is listed once");
      assert.deepStrictEqual(H.tradeAppliedTargets(giveRow(), null), ["s3", "s2"], "a failed scheduler lookup (null, already toasted) mails the parties");
      assert.deepStrictEqual(H.tradeAppliedTargets(giveRow(), []), ["s3", "s2"]);
    });
    check("Prompt 19 S3: helpers.giveAcceptedNotes / giveAppliedNotes - the trade.accept audit row carries kind 'give'; 'Give accepted' / 'Give applied' rows name both parties (data.from_surgeon_id / to_surgeon_id) with kind give; the e-mail is trade_applied with trade_id, the applied line as the subject and targetIds [from, to, ...schedulerIds]", () => {
      assert.strictEqual(typeof H.giveAcceptedNotes, "function", "helpers.giveAcceptedNotes is exported");
      assert.strictEqual(typeof H.giveAppliedNotes, "function", "helpers.giveAppliedNotes is exported");
      const rows = unitGive({ status: "accepted" });
      const msg = "Burchett accepted Acton's give: Burchett takes Sat 10/10 primary (weekend unit, 10/10\u201310/11) \u2014 nothing in return";
      assert.deepStrictEqual(H.giveAcceptedNotes(rows, tag2), {
        audit: { action: "trade.accept", message: msg, detail: { trade_id: "g1", trade_ids: ["g1", "g2"], day: "2026-10-10", role: "primary", days: ["2026-10-10", "2026-10-11"], return_day: null, return_role: null, from: "s3", to: "s2", kind: "give" } },
        notification: { type: "trade_accepted", title: "Give accepted", message: msg, data: { from_surgeon_id: "s3", to_surgeon_id: "s2", trade_id: "g1", trade_ids: ["g1", "g2"], day: "2026-10-10", kind: "give" } },
      });
      const line = "Give applied: Acton \u2192 Burchett, 10/10\u201310/11 primary";
      assert.deepStrictEqual(H.giveAppliedNotes(rows, ["s1"]), {
        notification: { type: "trade_applied", title: "Give applied", message: line, data: { from_surgeon_id: "s3", to_surgeon_id: "s2", trade_id: "g1", trade_ids: ["g1", "g2"], day: "2026-10-10", days: ["2026-10-10", "2026-10-11"], kind: "give" } },
        email: { subject: line, message: line + ". Burchett now holds those days; nothing comes back to Acton.", trade_id: "g1", kind: "give", targetIds: ["s3", "s2", "s1"] }, // Prompt 19 S4: kind heads the mail as a give
      });
      const one = H.giveAppliedNotes([giveRow({ status: "accepted" })], null);
      assert.strictEqual(one.email.message, "Give applied: Acton \u2192 Burchett, Sat 10/10 primary. Burchett now holds that day; nothing comes back to Acton.");
      assert.deepStrictEqual(one.email.targetIds, ["s3", "s2"]);
      assert.strictEqual(H.tradeGiveDeclineMsg(giveRow(), tag2), "Burchett declined Acton's give: Sat 10/10 primary (weekend unit, 10/10\u201310/11) stays with Acton");
      assert.strictEqual(H.tradeGiveCancelMsg(giveRow(), null), "Acton withdrew the give: Sat 10/10 primary stays with Acton (it was offered to Burchett)");
    });
    // S3 review (major): a give is decided on the WHOLE proposal, whatever each row's status. A member's unit trade for
    // one return day sends its tail rows as kind 'give' (S2); once the head and the tails drift apart (a tail's apply
    // refused, a PATCH that failed part-way) the same-status group of the tails alone would read as a give.
    check("Prompt 19 S3 review: helpers.tradeProposalOf / tradeProposalIsGive(r, rows, tagOf) - the proposal is the rows with the same unit stamp, parties and role, live (pending / accepted / applied) or closed (declined / cancelled) like r, submitted within 10 minutes of r; a give only when every row of it is - a member unit trade with its head applied and its 'give' tails accepted stays a trade", () => {
      assert.strictEqual(typeof H.tradeProposalOf, "function", "helpers.tradeProposalOf is exported");
      assert.strictEqual(typeof H.tradeProposalIsGive, "function", "helpers.tradeProposalIsGive is exported");
      const tagOf = (r) => { const m = /\[unit (holiday|weekend-block) (\d{4}-\d{2}-\d{2}) (\d+): ([^\]]+), day (\d+) of \d+\]/.exec(String(r && r.detail || "")); return m ? { kind: m[1], start: m[2], n: Number(m[3]), text: m[4], index: Number(m[5]) } : null; };
      const st3 = (i) => " [unit weekend-block 2026-10-09 3: weekend block unit 10/9-10/11 (3 days), day " + (i + 1) + " of 3]";
      const unit3 = (sts, o) => ["2026-10-09", "2026-10-10", "2026-10-11"].map((d, i) => giveRow({ id: "t" + i, day: d, status: sts[i], detail: "d" + st3(i), ...(i === 0 && !(o && o.give) ? { kind: "trade", return_day: "2026-10-20", return_role: "backup" } : {}), ...((o && o.row) || {}) }));
      const tr = unit3(["applied", "accepted", "accepted"]);
      assert.strictEqual(H.tradeGroupIsGive(tr.slice(1)), true, "the same-status tails alone look like a give (the bug)");
      assert.deepStrictEqual(H.tradeProposalOf(tr[1], tr, tagOf).map(r => r.id), ["t0", "t1", "t2"], "the whole proposal, sorted by day");
      assert.strictEqual(H.tradeProposalIsGive(tr[1], tr, tagOf), false, "a tail of a member unit trade (head applied) is a trade");
      assert.strictEqual(H.tradeProposalIsGive(tr[0], tr, tagOf), false, "the head is a trade");
      const tp = unit3(["accepted", "pending", "pending"]);
      assert.strictEqual(H.tradeProposalIsGive(tp[2], tp, tagOf), false, "pending tails after the head was accepted: a trade");
      const gv = unit3(["applied", "accepted", "accepted"], { give: true });
      assert.strictEqual(H.tradeProposalIsGive(gv[1], gv, tagOf), true, "a give whose rows drifted apart stays a give");
      const lone = giveRow({ detail: "no stamp" });
      assert.deepStrictEqual(H.tradeProposalOf(lone, [lone, ...tr], tagOf).map(r => r.id), ["g1"], "a row without a unit stamp is its own proposal");
      assert.strictEqual(H.tradeProposalIsGive(lone, [lone], tagOf), true);
      assert.strictEqual(H.tradeProposalIsGive(giveRow({ kind: "trade", return_day: "2026-10-20", return_role: "backup" }), [], tagOf), false);
      // a re-proposal of the same unit is its own proposal: after a decline (closed vs live) and long after an applied one
      const old = unit3(["declined", "declined", "declined"]);
      const again = unit3(["pending", "pending", "pending"], { give: true, row: { submitted_at: "2026-09-24T12:05:00.000Z" } }).map(r => ({ ...r, id: "n" + r.id }));
      assert.strictEqual(H.tradeProposalIsGive(again[0], old.concat(again), tagOf), true, "a give re-offered after the trade was declined");
      assert.strictEqual(H.tradeProposalIsGive(old[1], old.concat(again), tagOf), false, "the declined trade stays a trade");
      const past = unit3(["applied", "applied", "applied"], { row: { submitted_at: "2026-09-01T12:00:00.000Z" } });
      const later = unit3(["pending", "pending", "pending"], { give: true }).map(r => ({ ...r, id: "n" + r.id }));
      assert.strictEqual(H.tradeProposalIsGive(later[1], past.concat(later), tagOf), true, "a give of the same unit weeks after an applied trade (reverted since)");
      assert.strictEqual(H.tradeProposalIsGive(null, tr, tagOf), false);
    });
  }
  // Prompt 19 S3 (behaviour): acceptTrade / declineTrade / cancelTrade / retryApplyTrade and the helpers they call are
  // lifted out of the component verbatim (tradeUnitTag, tradeGroupOf, roleWordOf, tradeNamed, then patchTradeStatus
  // through cancelTrade) and run against stubs: the PATCH fetch, the rpc authFetch, the feed insert, the mail call, the
  // audit log and the scheduler lookup record what they are handed.
  await (async () => {
    const lift = (a, b) => { const i = src.indexOf(a); const j = i >= 0 ? src.indexOf(b, i + a.length) : -1; if (i < 0 || j < 0) throw new Error("lift: '" + a.slice(0, 50) + "' .. '" + b.slice(0, 50) + "' not found"); return src.slice(i, j); };
    let body = null, liftErr = null;
    try {
      body = lift("  const tradeUnitTag = (r) =>", "  // Days a person holds from today on")
        + lift("  const tradeNamed = (r) =>", "\n\n")
        + "\n" + lift("  const patchTradeStatus = async (trade, status) => {", "  // --- Mark Notifications as Seen ---");
    } catch (e) { liftErr = e; }
    const stamp2 = (i) => "[unit weekend-block 2026-10-10 2: weekend block unit 10/10-10/11 (2 days), day " + (i + 1) + " of 2]";
    const base = (o) => ({ id: "g1", from_surgeon_id: "s3", from_surgeon_name: "stored-name", to_surgeon_id: "s2", to_surgeon_name: "stored-name", day: "2026-10-10", role: "primary", return_day: null, return_role: null, kind: "give", status: "pending", submitted_at: "2026-09-24T12:00:00.000Z", detail: "x", ...o });
    const unitRows = () => [base({ detail: "d " + stamp2(0) }), base({ id: "g2", day: "2026-10-11", detail: "d " + stamp2(1) })];
    const PARAMS = ["fetch", "SUPABASE_URL", "dbAuthHeaders", "describeDbError", "console", "authFetch", "setTradeApplyErr", "showToast", "refreshTradesRef", "setTradeRequests", "refreshDaysRef",
      "tradeAppliedMsg", "addNotification", "sendEmailNotif", "slotLabel", "tradeBusy", "isScheduler", "mySurgeon", "tradeRequests", "tradeEligibilityOver", "tradeEligibility", "tradeReasonText",
      "rulesUnknownGate", "nameOf", "confirm", "fmtMD", "setTradeBusy", "tradeAcceptMsg", "tradeDeclineMsg", "tradeCancelMsg", "tradeLegsText", "logAudit", "schedulerIdsLoud",
      "tradeIsGive", "tradeGroupIsGive", "tradeGiveLine", "giveAcceptedNotes", "giveAppliedNotes", "tradeGiveDeclineMsg", "tradeGiveCancelMsg", "tradeProposalIsGive"];
    const mk = (o) => {
      const st = { order: [], patches: [], rpcs: [], notifs: [], mails: [], audits: [], toasts: [], elig: [], lookups: 0 };
      const rows = o.rows;
      const fetchStub = async (url, init) => {
        const id = decodeURIComponent(String(url).split("id=eq.")[1] || "");
        const b = JSON.parse(init.body);
        st.patches.push({ url: String(url), method: init.method, id, status: b.status, body: b }); st.order.push("PATCH " + id + " " + b.status);
        const row = rows.find(r => r.id === id); if (!row) return { ok: true, status: 200, text: async () => "[]" };
        Object.assign(row, b); // the whole PATCH body lands on the row, as PostgREST would write it (S5 review: a return leg PATCHed onto a give would show)
        return { ok: true, status: 200, text: async () => JSON.stringify([{ ...row }]) };
      };
      const authFetch = async (url, init) => {
        const b = JSON.parse(init.body);
        st.rpcs.push({ url: String(url), method: init.method, body: b }); st.order.push("RPC " + b.p_trade_id);
        const row = rows.find(r => r.id === b.p_trade_id); if (row) row.status = "applied";
        return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, trade_id: b.p_trade_id }) };
      };
      const elig = (days, role, cand) => { st.elig.push([days, role, cand]); return o.elig || { ok: true, hard: [], soft: [] }; };
      const args = [fetchStub, "https://x.supabase.co", () => ({ Authorization: "Bearer t" }), (t) => String(t), { warn: () => {} }, authFetch, () => {}, (m) => st.toasts.push(m), { current: null }, () => {},
        // Prompt 19 S5: o.recordRefresh records the calendar refetch (refreshDaysRef) in the order - the rows apply_trade wrote
        { current: o.recordRefresh ? async () => { st.order.push("REFRESH"); } : async () => {} },
        H.tradeAppliedMsg, async (type, title, message, data) => { st.notifs.push({ type, title, message, data }); st.order.push("NOTIF " + type); },
        (type, data, targetIds) => { st.mails.push({ type, data, targetIds }); st.order.push("MAIL " + type); return Promise.resolve({ ok: true }); },
        H.slotLabel, "", !!o.isScheduler, o.me === undefined ? "s2" : o.me, rows, (days, r, c) => elig(days, r, c), (d, r, c) => elig([d], r, c), () => "on vacation",
        () => false, nameOf, () => true, H.fmtMD, () => {}, H.tradeAcceptMsg, H.tradeDeclineMsg, H.tradeCancelMsg, H.tradeLegsText, (action, message, detail) => st.audits.push({ action, message, detail }),
        async () => { st.lookups++; st.order.push("LOOKUP"); return o.schedIds === undefined ? ["s1"] : o.schedIds; },
        H.tradeIsGive, H.tradeGroupIsGive, H.tradeGiveLine, H.giveAcceptedNotes, H.giveAppliedNotes, H.tradeGiveDeclineMsg, H.tradeGiveCancelMsg, H.tradeProposalIsGive];
      const fns = new Function(...PARAMS, body + "\nreturn { acceptTrade, declineTrade, cancelTrade, retryApplyTrade, notifGiveTrade };")(...args);
      return { ...fns, st, rows };
    };
    const run = async (o, fn, pick) => { const t = mk(o); await t[fn](pick ? pick(t.rows) : t.rows[0]); return t; };
    const stamp3 = (i) => "[unit weekend-block 2026-10-09 3: weekend block unit 10/9-10/11 (3 days), day " + (i + 1) + " of 3]";
    // a member's whole-unit TRADE for one return day (S2): the head carries the return leg, the tails go as kind 'give'
    const unitTrade = (sts) => ["2026-10-09", "2026-10-10", "2026-10-11"].map((d, i) => base({ id: "t" + i, day: d, status: sts[i], detail: "d " + stamp3(i), ...(i === 0 ? { kind: "trade", return_day: "2026-10-20", return_role: "backup" } : {}) }));
    let A = null, B = null, C = null, D = null, E = null, F = null, G = null, H1 = null, H2 = null, I1 = null, I2 = null, runErr = null;
    if (!liftErr) {
      try {
        A = await run({ rows: unitRows() }, "acceptTrade");                                                  // the receiver accepts a 2-day weekend give
        B = await run({ rows: [base()], schedIds: null }, "acceptTrade");                                    // a one-day give; the scheduler lookup failed
        C = await run({ rows: [base({ kind: undefined, return_day: "2026-10-20", return_role: "backup" })] }, "acceptTrade"); // an ordinary trade
        D = await run({ rows: [base()], elig: { ok: false, hard: ["vacation"], soft: [] } }, "acceptTrade"); // the receiver is no longer eligible
        E = await run({ rows: unitRows() }, "declineTrade");
        F = await run({ rows: [base()], me: "s3" }, "cancelTrade");
        G = await run({ rows: [base({ status: "accepted" })], isScheduler: true, me: "s1" }, "retryApplyTrade");
        H1 = await run({ rows: unitTrade(["applied", "accepted", "accepted"]), isScheduler: true, me: "s1" }, "retryApplyTrade", (rs) => rs[1]); // Retry apply on a tail
        H2 = await run({ rows: unitTrade(["accepted", "pending", "pending"]) }, "acceptTrade", (rs) => rs[1]);                                // accept the pending tails
        I1 = await run({ rows: [base()], recordRefresh: true }, "acceptTrade");                              // Prompt 19 S5: the one-way apply, a day
        I2 = await run({ rows: unitRows(), recordRefresh: true }, "acceptTrade");                            // ... and a weekend unit
      } catch (e) { runErr = e; }
    }
    const ready = () => { if (liftErr) throw liftErr; if (runErr) throw runErr; };
    const UNIT_LINE = "Give applied: Acton \u2192 Burchett, 10/10\u201310/11 primary";
    check("Prompt 19 S3 (behaviour): the receiver accepts a 2-day weekend give - eligibility re-checked over both days for him; PATCH accepted on both rows, THEN rpc/apply_trade once per row with exactly { p_trade_id } (one-way: no return leg is sent); 'Give accepted' and 'Give applied' rows naming both parties; ONE trade_applied e-mail to [from, to, scheduler] with trade_id and the applied line", () => {
      ready();
      assert.deepStrictEqual(A.st.elig, [[["2026-10-10", "2026-10-11"], "primary", "s2"]], "the receiver's eligibility over the unit, re-checked at accept - no return-leg check for a give");
      assert.deepStrictEqual(A.st.order, ["PATCH g1 accepted", "PATCH g2 accepted", "NOTIF trade_accepted", "RPC g1", "RPC g2", "LOOKUP", "NOTIF trade_applied", "MAIL trade_applied"]);
      A.st.rpcs.forEach(r => { assert.strictEqual(r.method, "POST"); assert.strictEqual(r.url, "https://x.supabase.co/rest/v1/rpc/apply_trade"); assert.deepStrictEqual(Object.keys(r.body), ["p_trade_id"]); });
      assert.deepStrictEqual(A.st.rpcs.map(r => r.body.p_trade_id), ["g1", "g2"]);
      assert.ok(A.st.patches.every(p => p.url === "https://x.supabase.co/rest/v1/shift_trade_requests?id=eq." + p.id && p.method === "PATCH"));
      assert.deepStrictEqual(A.st.notifs.map(n => [n.type, n.title]), [["trade_accepted", "Give accepted"], ["trade_applied", "Give applied"]]);
      assert.strictEqual(A.st.notifs[1].message, UNIT_LINE);
      A.st.notifs.forEach(n => { assert.strictEqual(n.data.from_surgeon_id, "s3"); assert.strictEqual(n.data.to_surgeon_id, "s2"); assert.strictEqual(n.data.kind, "give"); assert.deepStrictEqual(n.data.trade_ids, ["g1", "g2"]); });
      // who reads them (helpers.notifVisibleTo): both parties and the scheduler; not a third surgeon, not a viewer
      const feed = A.st.notifs.map((n, i) => ({ ...n, id: "n" + i, created_at: "2026-09-24T12:00:0" + i + ".000Z" }));
      assert.strictEqual(H.notifVisibleTo(feed, { mySurgeon: "s3" }).length, 2, "the giver");
      assert.strictEqual(H.notifVisibleTo(feed, { mySurgeon: "s2" }).length, 2, "the receiver");
      assert.strictEqual(H.notifVisibleTo(feed, { isScheduler: true, mySurgeon: "s1" }).length, 2, "the scheduler");
      assert.strictEqual(H.notifVisibleTo(feed, { mySurgeon: "s4" }).length, 0, "a third surgeon");
      assert.strictEqual(H.notifVisibleTo(feed, { isViewer: true }).length, 0, "a viewer");
      assert.deepStrictEqual(A.st.mails, [{ type: "trade_applied", data: { message: UNIT_LINE + ". Burchett now holds those days; nothing comes back to Acton.", subject: UNIT_LINE, trade_id: "g1", kind: "give" }, targetIds: ["s3", "s2", "s1"] }]); // Prompt 19 S4: kind give heads the mail as a give
      assert.strictEqual(A.st.audits.length, 1);
      assert.strictEqual(A.st.audits[0].action, "trade.accept");
      assert.strictEqual(A.st.audits[0].detail.kind, "give");
      assert.deepStrictEqual(A.rows.map(r => r.status), ["applied", "applied"]);
      assert.ok(!A.st.toasts.some(m => /NOT applied|Couldn't/.test(m)), "no failure toast: " + JSON.stringify(A.st.toasts));
    });
    // Prompt 19 S5 (tests): the one-way apply as the client runs it - apply_trade moves the day on the server (return_day
    // null: nothing comes back), so after EACH rpc the calendar is re-read (refreshDaysRef) before the next row and before
    // the 'Give applied' row / e-mail and the success toast; no return leg is sent, checked or stored.
    check("Prompt 19 S5 (behaviour): the one-way apply - a one-day give and a weekend-unit give: PATCH accepted, then per row rpc/apply_trade { p_trade_id } alone followed by the calendar refetch, then the scheduler lookup, 'Give applied' and ONE e-mail; the rows stay one-way (return null) and only the receiver's eligibility is consulted; the success toast names the days", () => {
      ready();
      assert.deepStrictEqual(I1.st.order, ["PATCH g1 accepted", "NOTIF trade_accepted", "RPC g1", "REFRESH", "LOOKUP", "NOTIF trade_applied", "MAIL trade_applied"]);
      assert.deepStrictEqual(I2.st.order, ["PATCH g1 accepted", "PATCH g2 accepted", "NOTIF trade_accepted", "RPC g1", "REFRESH", "RPC g2", "REFRESH", "LOOKUP", "NOTIF trade_applied", "MAIL trade_applied"]);
      [I1, I2].forEach((t) => {
        t.st.rpcs.forEach(r => assert.deepStrictEqual(r.body, { p_trade_id: r.body.p_trade_id }, "the rpc body is { p_trade_id } alone - no return leg is sent"));
        t.st.patches.forEach(p => assert.deepStrictEqual(Object.keys(p.body).sort(), ["decided_at", "status"], "the accept PATCH writes status + decided_at only - no return leg, no kind: " + JSON.stringify(p.body)));
        assert.strictEqual(t.st.patches.length, t.rows.length, "one PATCH per row");
        assert.ok(t.rows.every(r => r.status === "applied" && r.return_day === null && r.return_role === null && r.kind === "give"), "every row applied and still one-way: " + JSON.stringify(t.rows));
        assert.ok(t.st.elig.length > 0, "the receiver's eligibility was consulted at all");
        assert.ok(t.st.elig.every(([, , cand]) => cand === "s2"), "only the receiver's eligibility is consulted (no return leg for the giver): " + JSON.stringify(t.st.elig));
        assert.deepStrictEqual(t.st.mails.map(m => m.targetIds), [["s3", "s2", "s1"]]);
      });
      assert.strictEqual(I1.st.toasts[I1.st.toasts.length - 1], "Give accepted - applied to the schedule.");
      assert.strictEqual(I2.st.toasts[I2.st.toasts.length - 1], "Give accepted - 2 days applied to the schedule.");
    });
    check("Prompt 19 S3 (behaviour): a one-day give with a failed scheduler lookup (null) - PATCH, rpc, the two rows; the e-mail goes to the two parties only", () => {
      ready();
      assert.deepStrictEqual(B.st.order, ["PATCH g1 accepted", "NOTIF trade_accepted", "RPC g1", "LOOKUP", "NOTIF trade_applied", "MAIL trade_applied"]);
      assert.strictEqual(B.st.notifs[1].message, "Give applied: Acton \u2192 Burchett, Sat 10/10 primary");
      assert.deepStrictEqual(B.st.mails[0].targetIds, ["s3", "s2"]);
      assert.strictEqual(B.st.mails[0].data.trade_id, "g1");
    });
    check("Prompt 19 S3 (behaviour): an ordinary trade is unchanged - 'Shift trade accepted' / 'Shift trade applied', the e-mail to the two parties (no scheduler lookup), the return leg re-checked for the proposer; the trade.accept audit row carries kind 'trade'", () => {
      ready();
      assert.deepStrictEqual(C.st.order, ["PATCH g1 accepted", "NOTIF trade_accepted", "RPC g1", "NOTIF trade_applied", "MAIL trade_applied"]);
      assert.deepStrictEqual(C.st.notifs.map(n => n.title), ["Shift trade accepted", "Shift trade applied"]);
      assert.deepStrictEqual(C.st.mails[0].targetIds, ["s3", "s2"]);
      assert.strictEqual(C.st.lookups, 0);
      assert.deepStrictEqual(C.st.elig, [[["2026-10-10"], "primary", "s2"], [["2026-10-20"], "backup", "s3"]]);
      assert.strictEqual(C.st.audits[0].detail.kind, "trade");
    });
    check("Prompt 19 S3 (behaviour): the receiver no longer eligible at accept -> 'Can't accept: ...' toast, no PATCH, no rpc, no row, no mail", () => {
      ready();
      assert.deepStrictEqual(D.st.order, []);
      assert.ok(D.st.toasts.some(m => /^Can't accept: Burchett can't take /.test(m)), JSON.stringify(D.st.toasts));
    });
    check("Prompt 19 S3 (behaviour): declining a give - PATCH declined on both unit rows; 'Give declined' row and the trade_declined e-mail to the two parties (give words); the trade.decline audit row carries kind 'give'", () => {
      ready();
      assert.deepStrictEqual(E.st.order, ["PATCH g1 declined", "PATCH g2 declined", "NOTIF trade_declined", "MAIL trade_declined"]);
      assert.strictEqual(E.st.notifs[0].title, "Give declined");
      assert.strictEqual(E.st.notifs[0].message, "Burchett declined Acton's give: Sat 10/10 primary (weekend unit, 10/10\u201310/11) stays with Acton");
      assert.deepStrictEqual(E.st.mails[0].targetIds, ["s3", "s2"]);
      assert.strictEqual(E.st.mails[0].data.trade_id, "g1");
      assert.strictEqual(E.st.audits[0].detail.kind, "give");
      assert.strictEqual(E.st.rpcs.length, 0);
    });
    check("Prompt 19 S3 (behaviour): the proposer withdraws a pending give - PATCH cancelled, a 'Give withdrawn' row, no e-mail; kind 'give' on the audit row", () => {
      ready();
      assert.deepStrictEqual(F.st.order, ["PATCH g1 cancelled", "NOTIF trade_cancelled"]);
      assert.strictEqual(F.st.notifs[0].title, "Give withdrawn");
      assert.strictEqual(F.st.notifs[0].message, "Acton withdrew the give: Sat 10/10 primary stays with Acton (it was offered to Burchett)");
      assert.strictEqual(F.st.audits[0].detail.kind, "give");
    });
    check("Prompt 19 S3 (behaviour): the scheduler's Retry apply on an accepted give - rpc once, then the give's applied row + the e-mail to [from, to, scheduler]", () => {
      ready();
      assert.deepStrictEqual(G.st.order, ["RPC g1", "LOOKUP", "NOTIF trade_applied", "MAIL trade_applied"]);
      assert.strictEqual(G.st.notifs[0].title, "Give applied");
      assert.deepStrictEqual(G.st.mails[0].targetIds, ["s3", "s2", "s1"]);
    });
    check("Prompt 19 S3 review (behaviour): the 'give' tail rows of a member's unit TRADE stay a trade - Retry apply on a tail whose head is applied -> 'Shift trade applied' to the two parties, no scheduler lookup; accepting the pending tails after the head was accepted -> the trade path (audit kind 'trade', 'Shift trade accepted')", () => {
      ready();
      assert.deepStrictEqual(H1.st.order, ["RPC t1", "NOTIF trade_applied", "MAIL trade_applied"]);
      assert.strictEqual(H1.st.notifs[0].title, "Shift trade applied");
      assert.deepStrictEqual(H1.st.mails[0].targetIds, ["s3", "s2"]);
      assert.strictEqual(H1.st.lookups, 0, "no scheduler lookup for a trade");
      assert.deepStrictEqual(H2.st.order, ["PATCH t1 accepted", "PATCH t2 accepted", "NOTIF trade_accepted", "RPC t1", "RPC t2", "NOTIF trade_applied", "MAIL trade_applied"]);
      assert.deepStrictEqual(H2.st.notifs.map(n => n.title), ["Shift trade accepted", "Shift trade applied"]);
      assert.strictEqual(H2.st.audits[0].detail.kind, "trade");
      assert.deepStrictEqual(H2.st.mails[0].targetIds, ["s3", "s2"]);
      assert.strictEqual(H2.st.lookups, 0);
    });
    check("Prompt 19 S3 review (behaviour): a failed scheduler lookup on an applied give is the LAST toast and says who was e-mailed (the two parties), not 'no email was sent'", () => {
      ready();
      const last = B.st.toasts[B.st.toasts.length - 1] || "";
      assert.ok(/scheduler/.test(last) && /only the two parties were e-mailed/.test(last), "the last toast names the missed scheduler mail: " + JSON.stringify(B.st.toasts));
      assert.ok(!B.st.toasts.some(m => /no email was sent/.test(m)), JSON.stringify(B.st.toasts));
      const lastG = G.st.toasts[G.st.toasts.length - 1] || "";
      assert.strictEqual(lastG, "Give applied to the schedule.", "a found scheduler: the plain success toast");
    });
    // Prompt 19 S4: a give's e-mail is marked data.kind 'give' so send-notification heads it as a give ('Give Applied',
    // 'Give Declined') through the same trade_* category; a trade's e-mail carries no kind (v6 / v7 read it as a trade).
    check("Prompt 19 S4 (behaviour): every give e-mail carries data.kind 'give' - the applied give (accept, Retry apply) and the declined give; a trade's e-mails (an ordinary trade, a member unit trade's 'give' tails) carry no kind", () => {
      ready();
      [["accept a unit give", A], ["accept a one-day give, lookup failed", B], ["decline a give", E], ["Retry apply on a give", G]].forEach(([what, t]) => {
        assert.ok(t.st.mails.length > 0, what + ": a mail was sent");
        t.st.mails.forEach(m => assert.strictEqual(m.data.kind, "give", what + ": " + m.type + " data.kind -> " + JSON.stringify(m.data)));
      });
      [["an ordinary trade", C], ["Retry apply on a unit trade's tail", H1], ["accepting a unit trade's pending tails", H2]].forEach(([what, t]) => {
        assert.ok(t.st.mails.length > 0, what + ": a mail was sent");
        t.st.mails.forEach(m => assert.ok(!("kind" in m.data), what + ": " + m.type + " carries no kind -> " + JSON.stringify(m.data)));
      });
    });
    check("Prompt 19 S3 review (behaviour): notifGiveTrade - the Alerts Accept / Decline appear for the RECEIVER of a pending give only (the scheduler answers from Trades); not for the giver, a third surgeon, a trade alert, another alert type, a decided give, or the 'give' tail of a member unit trade", () => {
      ready();
      const give = { type: "trade_proposed", data: { kind: "give", trade_id: "g1" } };
      const who = (o, n, rows) => { const t = mk({ rows: rows || unitRows(), ...o }); const r = t.notifGiveTrade(n || give); return r ? r.id : null; };
      assert.strictEqual(who({ me: "s2" }), "g1", "the receiver");
      assert.strictEqual(who({ isScheduler: true, me: "s1" }), null, "the scheduler (Trades keeps his Accept / Decline)");
      assert.strictEqual(who({ me: "s3" }), null, "the giver");
      assert.strictEqual(who({ me: "s4" }), null, "a third surgeon");
      assert.strictEqual(who({ me: "s2" }, { type: "trade_proposed", data: { kind: "trade", trade_id: "g1" } }), null, "a trade alert");
      assert.strictEqual(who({ me: "s2" }, { type: "trade_accepted", data: { kind: "give", trade_id: "g1" } }), null, "another type");
      assert.strictEqual(who({ me: "s2" }, null, unitRows().map(r => ({ ...r, status: "accepted" }))), null, "a decided give");
      assert.strictEqual(who({ me: "s2" }, { type: "trade_proposed", data: { kind: "give", trade_id: "t1" } }, unitTrade(["accepted", "pending", "pending"])), null, "a unit trade's pending 'give' tail");
    });
  })();
  check("Prompt 19 S3 pins: Trades renders a give group with tradeGiveLine (data-kind give, testid trade-give-line) and keeps Accept / Decline for the receiver and the scheduler; the Alerts panel shows a pending give addressed to this account with the same line and Accept / Decline (click does not bubble to the row's navigation); the scheduler's revert link says a give is reverted one-way; notifyGiveApplied mails [from, to, ...schedulerIds]; ASCII", () => {
    const tr = src.slice(src.indexOf("const tradeRow = (r) => {"), src.indexOf("return <>", src.indexOf("const tradeRow = (r) => {")));
    assert.ok(tr.includes("const giveGroup = tradeIsGiveProposal(r);"), "the row knows whether its proposal (every status) is a give");
    assert.ok(tr.includes('data-kind={giveGroup ? "give" : "trade"}'), "data-kind on the row");
    assert.ok(tr.includes('{giveGroup ? <span data-testid="trade-give-line">{tradeGiveLine(named, tag, mySurgeon)}</span> : tradeLegsText(named, tenseFor(r.status))}'), "the give line replaces the legs text");
    assert.ok(tr.includes("const canAnswer = r.status === \"pending\" && (isScheduler || r.to_surgeon_id === mySurgeon);"), "Accept / Decline: the receiver and the scheduler, unchanged");
    assert.ok(tr.includes('title={giveGroup ? "The scheduler reverts a give by putting " + named.from_surgeon_name + " back on " + fmtMD(r.day) + " in the day editor - one-way, nothing else moves" : "The scheduler reverts a trade by editing the day"}'), "the revert link for a give");
    const np = src.slice(src.indexOf('data-testid="notif-panel"'), src.indexOf("{/* Unlinked-account banner"));
    assert.ok(np.includes("const giveT = notifGiveTrade(n);"), "each alert looks up its pending give");
    assert.ok(np.includes('<p data-testid="notif-give-line"') && np.includes("{tradeGiveLine(tradeNamed(giveT), tradeUnitTag(giveT), mySurgeon)}"), "the Alerts line");
    assert.ok(np.includes('data-testid="notif-give-accept"') && np.includes("onClick={(e)=>{ e.stopPropagation(); acceptTrade(giveT); }}"), "Accept from Alerts");
    assert.ok(np.includes('data-testid="notif-give-decline"') && np.includes("onClick={(e)=>{ e.stopPropagation(); declineTrade(giveT); }}"), "Decline from Alerts");
    const ng = src.slice(src.indexOf("const notifGiveTrade = (n) => {"), src.indexOf("\n  };", src.indexOf("const notifGiveTrade = (n) => {")));
    assert.ok(ng.includes('n.type !== "trade_proposed"') && ng.includes('d.kind !== "give"') && ng.includes('r.status === "pending"') && ng.includes("r.to_surgeon_id === mySurgeon") && !ng.includes("isScheduler") && ng.includes("tradeIsGiveProposal(r)"), "only a pending give addressed to this account (the receiver)");
    const gp = src.slice(src.indexOf("const tradeIsGiveProposal = (r) =>"), src.indexOf("\n", src.indexOf("const tradeIsGiveProposal = (r) =>")));
    assert.strictEqual(gp, "const tradeIsGiveProposal = (r) => tradeProposalIsGive(r, tradeRequests, tradeUnitTag);", "the app's give predicate is the pure whole-proposal helper");
    ["tradeGroupIsGive(group)", "tradeIsGive(applied)", "tradeGroupIsGive(tradeGroupOf("].forEach((x) => assert.ok(!src.includes(x), "no same-status give test left: " + x));
    const nga = src.slice(src.indexOf("const notifyGiveApplied = async (rows) => {"), src.indexOf("// opts.silent: a unit group's caller"));
    assert.ok(nga.includes("const ids = await schedulerIdsLoud({ quiet: true });") && nga.includes("const n = giveAppliedNotes(rows, ids);"), "the scheduler ids ride on the applied give; a failed lookup is reported by the caller's final toast");
    assert.ok(nga.includes('sendEmailNotif("trade_applied", { message: n.email.message, subject: n.email.subject, trade_id: first.id, kind: n.email.kind }, n.email.targetIds);'), "one trade_applied mail with trade_id (and, since S4, kind give)");
    assert.ok(!/[^\x00-\x7f]/.test(src), "index-source.html stays ASCII");
  });
  // Prompt 19 step 4 (Faraz 9/24): "Text everywhere" - a give reads as a give on every surface: the Trades list (section
  // titles count gives separately, the row's status chip and meta line), the e-mail headings (send-notification, through
  // the existing trade_* categories - the client marks a give's mail with data.kind 'give'), the Activity log (the
  // server's trade.apply row carries no kind: the app derives it from the trade id) and the publish diff ("10/10 P Acton
  // -> Burchett (give)": schedule_days carries only source 'trade', so the kind is derived from the applied
  // shift_trade_requests row that put the holder there). Pure helpers (behaviour) + pins.
  check("Prompt 19 S4: helpers.tradeListTitle - 'Pending trades (2)' without gives (the pre-Prompt 19 title), 'Pending gives (1)' without trades, 'Pending trades (2) and gives (1)' with both; tradeListEmpty 'No pending trades or gives.'; tradeRowStatus - a give's chip reads 'give - pending' / 'give - accepted - not applied yet', a trade's is unchanged", () => {
    assert.strictEqual(typeof H.tradeListTitle, "function", "helpers.tradeListTitle is exported");
    const isG = (r) => r.kind === "give";
    const T = { kind: "trade" }, G = { kind: "give" };
    assert.strictEqual(H.tradeListTitle("Pending", [T, T], isG), "Pending trades (2)");
    assert.strictEqual(H.tradeListTitle("Pending", [], isG), "Pending trades (0)");
    assert.strictEqual(H.tradeListTitle("Pending", [G], isG), "Pending gives (1)");
    assert.strictEqual(H.tradeListTitle("Completed", [T, G, T], isG), "Completed trades (2) and gives (1)");
    assert.strictEqual(H.tradeListTitle("Completed", [T, G], null), "Completed trades (2)", "no predicate: everything is a trade");
    assert.strictEqual(H.tradeListEmpty("Pending"), "No pending trades or gives.");
    assert.strictEqual(H.tradeListEmpty("Completed"), "No completed trades or gives.");
    assert.strictEqual(H.tradeRowStatus("pending", true), "give - pending");
    assert.strictEqual(H.tradeRowStatus("accepted", true), "give - accepted - not applied yet");
    assert.strictEqual(H.tradeRowStatus("applied", false), "applied");
    assert.strictEqual(H.tradeRowStatus("accepted", false), "accepted - not applied yet");
  });
  check("Prompt 19 S4: helpers.auditGiveTradeIds / auditEntryText - the server's trade.apply row of a give (known from the trade rows or from a give's own audit rows) reads 'Give applied: Burchett takes Primary Sat Oct 10 (from Acton, nothing in return)' and its action 'trade.apply (give)'; a give's trade.propose row reads neutral ('Give offered: Acton -> Burchett, Sat 10/10 primary - nothing in return', not 'offers you'); trade.accept / decline / cancel rows with kind give keep their give summary; every give row reads '<action> (give)'; a trade's rows (the scheduler's one-way trade included) are unchanged", () => {
    assert.strictEqual(typeof H.auditGiveTradeIds, "function", "helpers.auditGiveTradeIds is exported");
    assert.strictEqual(typeof H.auditEntryText, "function", "helpers.auditEntryText is exported");
    const APPLY = (id, one) => ({ action: "trade.apply", detail: { summary: "Trade applied: Burchett takes Primary Sat Oct 10 (from Acton" + (one ? ", one-way)" : "; Acton takes Backup Tue Oct 20 in return)"), trade_id: id } });
    const entries = [
      APPLY("g1", true), APPLY("g9", true), APPLY("t1", false), APPLY("s1", true),
      { action: "trade.accept", detail: { summary: "Burchett accepted Acton's give: ...", trade_id: "g9", trade_ids: ["g9", "g10"], kind: "give" } },
      { action: "trade.accept", detail: { summary: "Burchett accepted the trade", trade_id: "t1", kind: "trade" } },
      { action: "trade.propose", detail: { summary: "Acton offers you Sat 10/10 primary - nothing in return (a give to Burchett)", trade_id: "g1", kind: "give" } },
      { action: "offers.save", detail: { summary: "Acton: 2 offer change(s)" } },
    ];
    const rows = [{ id: "g1", kind: "give" }, { id: "t1" }, { id: "s1", kind: "trade" }];
    const ids = H.auditGiveTradeIds(entries, rows, (r) => r.kind === "give");
    assert.deepStrictEqual(ids.slice().sort(), ["g1", "g10", "g9"], "from the trade rows (g1) and from a give's audit rows (g9, g10); never a trade's");
    assert.deepStrictEqual(H.auditEntryText(entries[0], ids), { summary: "Give applied: Burchett takes Primary Sat Oct 10 (from Acton, nothing in return)", action: "trade.apply (give)", give: true });
    assert.deepStrictEqual(H.auditEntryText(entries[1], ids), { summary: "Give applied: Burchett takes Primary Sat Oct 10 (from Acton, nothing in return)", action: "trade.apply (give)", give: true }, "known from the accept row only (the trade rows scrolled out of the window)");
    assert.deepStrictEqual(H.auditEntryText(entries[2], ids), { summary: entries[2].detail.summary, action: "trade.apply", give: false }, "a two-way trade");
    assert.deepStrictEqual(H.auditEntryText(entries[3], ids), { summary: entries[3].detail.summary, action: "trade.apply", give: false }, "the scheduler's one-way TRADE stays 'one-way'");
    assert.deepStrictEqual(H.auditEntryText(entries[4], ids), { summary: entries[4].detail.summary, action: "trade.accept (give)", give: true });
    assert.deepStrictEqual(H.auditEntryText(entries[5], ids), { summary: "Burchett accepted the trade", action: "trade.accept", give: false });
    // S4 review: the propose line was addressed to the receiver ("offers you"); the log reads it neutral
    assert.deepStrictEqual(H.auditEntryText(entries[6], ids), { summary: "Give offered: Acton -> Burchett, Sat 10/10 primary - nothing in return", action: "trade.propose (give)", give: true });
    assert.deepStrictEqual(H.auditEntryText({ action: "trade.propose", detail: { summary: "Acton offers you the Oct 9-11 weekend primary - nothing in return (a give to Burchett)", kind: "give" } }, ids).summary, "Give offered: Acton -> Burchett, the Oct 9-11 weekend primary - nothing in return", "a unit give");
    assert.deepStrictEqual(H.auditEntryText({ action: "trade.propose", detail: { summary: "Something else entirely", kind: "give" } }, ids), { summary: "Something else entirely", action: "trade.propose (give)", give: true }, "an unrecognised summary is kept as it is");
    assert.deepStrictEqual(H.auditEntryText(entries[7], ids), { summary: "Acton: 2 offer change(s)", action: "offers.save", give: false });
    assert.deepStrictEqual(H.auditEntryText({ action: "trade.apply", detail: { trade_id: "g1" } }, ids), { summary: "Give applied", action: "trade.apply (give)", give: true }, "no summary on the row");
    assert.deepStrictEqual(H.auditEntryText({ action: "x.y", detail: null }, ids), { summary: "x.y", action: "x.y", give: false }, "no detail: the action, as before");
    assert.deepStrictEqual(H.auditGiveTradeIds(null, null, null), [], "nothing loaded -> no ids");
  });
  check("Prompt 19 S4: helpers.labelGiveChanges - a primary / backup change whose day has source 'trade' and whose latest applied shift_trade_requests leg landing on that slot put change.to there, from a give, carries via 'give'; formatDayChange then reads '10/10 P Acton -> Burchett (give)'; a trade, a later trade over the give, a hand edit (source 'manual', or source kept 'trade' by keepPersonSource when the other role is untouched), a give later traded away and back (latest by decided_at, not the earliest), a give followed by two return legs over the slot, and a return leg of a trade stay unlabelled", () => {
    assert.strictEqual(typeof H.labelGiveChanges, "function", "helpers.labelGiveChanges is exported");
    const isG = (r) => r.kind === "give";
    const schedule = {
      "2026-10-10": { primary: "s2", backup: "s4", source: "trade" },   // given Acton -> Burchett (primary)
      "2026-10-11": { primary: "s2", backup: "s1", source: "trade" },   // given, then traded on to Khan (backup)
      "2026-10-12": { primary: "s6", backup: null, source: "manual" },  // given, then edited by hand
      "2026-10-13": { primary: "s3", backup: "s5", source: "trade" },   // a two-way trade: the return leg lands Acton here
      "2026-10-14": { primary: "s2", backup: null, source: "trade" },   // an ordinary trade
    };
    const tr = [
      { id: "g1", kind: "give", status: "applied", day: "2026-10-10", role: "primary", from_surgeon_id: "s3", to_surgeon_id: "s2", return_day: null, return_role: null, decided_at: "2026-10-01T10:00:00Z" },
      { id: "g2", kind: "give", status: "applied", day: "2026-10-11", role: "backup", from_surgeon_id: "s3", to_surgeon_id: "s6", return_day: null, return_role: null, decided_at: "2026-10-01T10:00:00Z" },
      { id: "t2", status: "applied", day: "2026-10-11", role: "backup", from_surgeon_id: "s6", to_surgeon_id: "s1", return_day: "2026-10-20", return_role: "backup", decided_at: "2026-10-02T10:00:00Z" },
      { id: "g3", kind: "give", status: "applied", day: "2026-10-12", role: "primary", from_surgeon_id: "s3", to_surgeon_id: "s6", return_day: null, return_role: null, decided_at: "2026-10-01T10:00:00Z" },
      { id: "t3", status: "applied", day: "2026-10-01", role: "backup", from_surgeon_id: "s3", to_surgeon_id: "s4", return_day: "2026-10-13", return_role: "primary", decided_at: "2026-10-01T10:00:00Z" },
      { id: "t4", status: "applied", day: "2026-10-14", role: "primary", from_surgeon_id: "s5", to_surgeon_id: "s2", return_day: "2026-10-21", return_role: "primary", decided_at: "2026-10-01T10:00:00Z" },
      { id: "g5", kind: "give", status: "declined", day: "2026-10-14", role: "primary", from_surgeon_id: "s5", to_surgeon_id: "s2", return_day: null, return_role: null, decided_at: "2026-10-03T10:00:00Z" },
    ];
    const changes = [
      { day: "2026-10-10", role: "primary", from: "s3", to: "s2" },
      { day: "2026-10-11", role: "backup", from: "s3", to: "s1" },
      { day: "2026-10-12", role: "primary", from: "s3", to: "s6" },
      { day: "2026-10-13", role: "primary", from: "s4", to: "s3" },
      { day: "2026-10-14", role: "primary", from: "s5", to: "s2" },
    ];
    const out = H.labelGiveChanges(changes, schedule, tr, isG);
    assert.deepStrictEqual(out.map(c => c.via || null), ["give", null, null, null, null]);
    assert.deepStrictEqual(out[0], { day: "2026-10-10", role: "primary", from: "s3", to: "s2", via: "give" }, "the change itself is kept, via added");
    assert.ok(!("via" in changes[0]), "the input is not mutated");
    assert.strictEqual(H.formatDayChange(out[0], nameOf), "10/10 P Acton -> Burchett (give)");
    assert.strictEqual(H.formatDayChange(out[4], nameOf), "10/14 P Fierce -> Burchett", "a trade's line is unchanged");
    assert.strictEqual(H.formatDayChange({ day: "2026-10-10", role: "backup", from: null, to: "s1", via: "give" }, nameOf), "10/10 B OPEN -> Khan (give)");
    assert.deepStrictEqual(H.describePublishDiff(out, nameOf)[0].lines[0], "10/10 P Acton -> Burchett (give)", "the publish dialog's month groups carry the label");
    assert.deepStrictEqual(H.labelGiveChanges(changes, schedule, null, isG).map(c => c.via || null), [null, null, null, null, null], "no trade rows loaded -> nothing labelled");
    assert.deepStrictEqual(H.labelGiveChanges(null, schedule, tr, isG), [], "no changes -> []");
    // S4 review: the three branches that decide the label, each case killing one mutant of helpers.labelGiveChanges.
    const sched2 = {
      // (a) the scheduler hand-edits the given slot (s2 -> s6) and leaves backup alone: keepPersonSource keeps source 'trade'
      "2026-10-15": { primary: "s6", backup: "s4", source: "trade" },
      // (b) given s3 -> s2, traded s2 -> s5, traded back s5 -> s2 (the rows listed out of time order on purpose)
      "2026-10-16": { primary: "s2", backup: "s4", source: "trade" },
      // (c) given s3 -> s2, then two trades whose RETURN legs move the slot s2 -> s5 -> s2
      "2026-10-17": { primary: "s2", backup: "s4", source: "trade" },
    };
    const tr2 = [
      { id: "g6", kind: "give", status: "applied", day: "2026-10-15", role: "primary", from_surgeon_id: "s3", to_surgeon_id: "s2", return_day: null, return_role: null, decided_at: "2026-10-01T10:00:00Z" },
      { id: "t8", status: "applied", day: "2026-10-16", role: "primary", from_surgeon_id: "s5", to_surgeon_id: "s2", return_day: "2026-10-26", return_role: "primary", decided_at: "2026-10-03T10:00:00Z" },
      { id: "g7", kind: "give", status: "applied", day: "2026-10-16", role: "primary", from_surgeon_id: "s3", to_surgeon_id: "s2", return_day: null, return_role: null, decided_at: "2026-10-01T10:00:00Z" },
      { id: "t7", status: "applied", day: "2026-10-16", role: "primary", from_surgeon_id: "s2", to_surgeon_id: "s5", return_day: "2026-10-25", return_role: "primary", decided_at: "2026-10-02T10:00:00Z" },
      { id: "g8", kind: "give", status: "applied", day: "2026-10-17", role: "primary", from_surgeon_id: "s3", to_surgeon_id: "s2", return_day: null, return_role: null, decided_at: "2026-10-01T10:00:00Z" },
      { id: "t9", status: "applied", day: "2026-10-27", role: "primary", from_surgeon_id: "s5", to_surgeon_id: "s2", return_day: "2026-10-17", return_role: "primary", decided_at: "2026-10-02T10:00:00Z" },
      { id: "t10", status: "applied", day: "2026-10-28", role: "primary", from_surgeon_id: "s2", to_surgeon_id: "s5", return_day: "2026-10-17", return_role: "primary", decided_at: "2026-10-03T10:00:00Z" },
    ];
    const ch2 = [
      { day: "2026-10-15", role: "primary", from: "s3", to: "s6" },
      { day: "2026-10-16", role: "primary", from: "s3", to: "s2" },
      { day: "2026-10-17", role: "primary", from: "s3", to: "s2" },
    ];
    const out2 = H.labelGiveChanges(ch2, sched2, tr2, isG);
    assert.strictEqual(out2[0].via, undefined, "(a) a hand edit of the given slot with source still 'trade' is not a give (the latest leg put s2 there, not s6)");
    assert.strictEqual(out2[1].via, undefined, "(b) the LATEST applied leg (t8, a trade, by decided_at) decides, not the earliest (the give g7)");
    assert.strictEqual(out2[2].via, undefined, "(c) a trade's return leg over the slot counts as a leg: the latest (t10's return leg) put s2 back there, not the give");
    // the same slots with only the give loaded read as a give - the three cases fail on the branch, not on the data
    assert.deepStrictEqual(H.labelGiveChanges(ch2.slice(1), sched2, tr2.filter(r => r.kind === "give"), isG).map(c => c.via || null), ["give", "give"], "control: the give alone labels 10/16 and 10/17");
  });
  check("Prompt 19 S4 pins: Trades - the section titles count gives separately (tradeListTitle with the whole-proposal predicate), the empty lines and notes say 'trades and gives', a give row's status chip reads 'give - <status>' and its meta line 'offered by'; the Activity log reads each row through auditEntryText with the give trade ids (tradeRequests + the give audit rows); the publish diff labels a give's change (labelGiveChanges over the live days and tradeRequests); every give e-mail carries data.kind 'give'; ASCII", () => {
    const tr = src.slice(src.indexOf("const tradeRow = (r) => {"), src.indexOf("return <>", src.indexOf("const tradeRow = (r) => {")));
    assert.ok(tr.includes('<span data-testid="trade-status" style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:statusColor(r.status)}}>{tradeRowStatus(r.status, giveGroup)}</span>'), "the status chip names a give");
    assert.ok(tr.includes('<div data-testid="trade-meta" style={{fontSize:10,color:"#9aa4ae",fontFamily:mono,marginTop:2}}>{giveGroup ? "offered" : "proposed"} by {named.from_surgeon_name}'), "a give is 'offered by' the giver");
    const lists = src.slice(src.indexOf('<div style={css.card} data-testid="trades-pending">'), src.indexOf("{/* ================ TOTALS"));
    assert.ok(lists.includes('<div style={css.cardT} data-testid="trades-pending-title">{tradeListTitle("Pending", pending, tradeIsGiveProposal)}</div>'), "the pending title counts gives separately");
    assert.ok(lists.includes('<div style={css.cardT} data-testid="trades-completed-title">{tradeListTitle("Completed", done, tradeIsGiveProposal)}</div>'), "the completed title counts gives separately");
    assert.ok(lists.includes('{tradeListEmpty("Pending")}') && lists.includes('{tradeListEmpty("Completed")}'), "the empty lines say trades or gives");
    assert.ok(lists.includes("Every open trade and give.") && lists.includes("Trades and gives waiting on you show Accept / Decline"), "the section note names gives");
    assert.ok(!lists.includes("Pending trades (") && !lists.includes("Completed trades (") && !lists.includes("No pending trades.") && !lists.includes("No completed trades."), "no hard-coded trade-only title left");
    assert.ok(src.includes("const auditGiveIds = useMemo(() => auditGiveTradeIds(auditEntries, tradeRequests, tradeIsGiveProposal), [auditEntries, tradeRequests]);"), "the give trade ids of the Activity log");
    assert.ok(src.indexOf("const auditGiveIds = useMemo(") > src.indexOf("const tradeIsGiveProposal = (r) =>"), "computed after the predicate it calls");
    const al = src.slice(src.indexOf('ck="settings_audit"'), src.indexOf('ck="settings_client_versions"'));
    assert.ok(al.includes("const at = auditEntryText(en, auditGiveIds);") && al.includes("{at.summary}") && al.includes("{fmtAuditTime(en.created_at)} - {at.action}"), "each Activity log line reads through auditEntryText");
    assert.ok(!al.includes("(en.detail && en.detail.summary) || en.action"), "the raw summary is no longer rendered directly");
    const op = src.slice(src.indexOf("const openPublishDialog = () => {"), src.indexOf("publishRef.current = openPublishDialog;"));
    assert.ok(op.includes('const changes = labelGiveChanges(diffScheduleDays(publishedAsSchedule(lastPublished), schedule).filter(c => c.role === "primary" || c.role === "backup"), schedule, tradeRequests, tradeIsGiveProposal);'), "the publish diff labels the changes a give made");
    const sub = src.slice(src.indexOf("const submitTradeRequest = async () => {"), src.indexOf("// --- Status writes ---"));
    assert.ok(sub.includes("giveMail ? { message: giveMail.message, subject: giveMail.subject, trade_id: first.id, kind: \"give\" }"), "the proposed give's mail carries kind give");
    const dec = src.slice(src.indexOf("const declineTrade = async"), src.indexOf("const cancelTrade = async"));
    assert.ok(dec.includes('trade_id: first.id, ...(give ? { kind: "give" } : {}) }, [first.from_surgeon_id, first.to_surgeon_id]);'), "the declined give's mail carries kind give");
    const nga = src.slice(src.indexOf("const notifyGiveApplied = async (rows) => {"), src.indexOf("// opts.silent: a unit group's caller"));
    assert.ok(nga.includes('sendEmailNotif("trade_applied", { message: n.email.message, subject: n.email.subject, trade_id: first.id, kind: n.email.kind }, n.email.targetIds);'), "the applied give's mail carries kind give");
    assert.ok(!/[^\x00-\x7f]/.test(src), "index-source.html stays ASCII");
  });
  check("Prompt 19 S4 review pins: the error toasts on the give path name a give - submit, accept (incl. 'accepted but NOT applied' and the refresh failure), Retry apply, decline and withdraw read 'give' when the proposal is one; a trade's toasts keep 'trade'", () => {
    const body = (a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a)));
    const sub = body("const submitTradeRequest = async () => {", "// --- Status writes ---");
    const run = body("const runApplyTrade = async (trade, opts) => {", "const acceptTrade = async");
    const acc = body("const acceptTrade = async (trade) => {", "const retryApplyTrade = async");
    const rt = body("const retryApplyTrade = async (trade) => {", "const declineTrade = async");
    const dec = body("const declineTrade = async (trade) => {", "const cancelTrade = async");
    const can = body("const cancelTrade = async (trade) => {", "// --- Mark Notifications as Seen ---");
    [sub, run, acc, rt, dec, can].forEach((b, i) => assert.ok(b.length > 200, "body " + i + " found"));
    assert.ok(sub.includes("showToast(`Couldn't submit the ${give ? \"give\" : \"trade\"} - check your connection and try again.`, \"error\")"), "submit");
    assert.ok(run.includes('showToast("The " + (tradeIsGiveProposal(t) ? "give" : "trade") + " is accepted but NOT applied: " + a.error, "error");'), "accepted but NOT applied");
    assert.ok(run.includes('showToast((tradeIsGiveProposal(t) ? "Give" : "Trade") + " applied, but the calendar could not be refreshed - reload to see it.", "error");'), "the refresh failure after apply");
    assert.ok(acc.indexOf('const noun = give ? "give" : "trade";') > 0 && acc.indexOf('const noun = give ? "give" : "trade";') < acc.indexOf("Only the surgeon asked can accept this"), "accept: the noun is known before the first toast");
    assert.ok(acc.includes("Only the surgeon asked can accept this ${noun}.") && acc.includes("Couldn't accept the ${noun}${accepted.length") && acc.includes("Couldn't accept the ${noun} - check your connection"), "accept");
    assert.ok(rt.includes(' apply the " + (tradeIsGiveProposal(trade) ? "give" : "trade") + " - check your connection and try again.", "error");'), "Retry apply");
    assert.ok(dec.indexOf('const noun = give ? "give" : "trade";') > 0 && dec.includes("Only the surgeon asked can decline this ${noun}.") && dec.includes("Couldn't decline the ${noun}${done.length") && dec.includes("Couldn't decline the ${noun} - check your connection"), "decline");
    assert.ok(can.includes('give ? "Only the giver can withdraw this give." : "Only the proposer can cancel this trade."') && can.includes("Couldn't ${give ? \"withdraw the give\" : \"cancel the trade\"}") && can.includes('were ${give ? "withdrawn" : "cancelled"}'), "withdraw");
    [run, acc, rt, dec].forEach((b, i) => assert.ok(!/the trade is accepted|this trade[.]|Couldn't (accept|decline|apply) the trade/i.test(b), "no trade-only toast left in body " + i));
    assert.ok(!/Couldn't submit the trade -|Couldn't cancel the trade -/.test(sub + can), "no trade-only submit / cancel toast left");
  });
  // RLS-7: the two PATCH handlers that used to trust a 2xx alone now behave like patchTradeStatus - a 200 with zero
  // rows (an RLS-filtered write) adopts nothing locally and logs no audit row.
  check("RLS-7: toEdit and updateOfficeContact treat a 2xx with zero rows as 'not changed' (no local adopt, no audit row, no fabricated row)", () => {
    const te = src.indexOf("const toEdit = async (personId, rowId, newStart, newEnd) => {");
    const tb = src.slice(te, src.indexOf("// SCHEDULE STORAGE:", te));
    const guard = tb.indexOf("rows.length !== 1"), adopt = tb.indexOf("adoptTimeOffRows("), audit = tb.indexOf('logAudit("timeoff.edit"');
    assert.ok(te > 0 && guard > 0 && adopt > guard && audit > adopt, `guard=${guard} adopt=${adopt} audit=${audit}`);
    assert.strictEqual(tb.includes("{ ...old, start_date: newStart"), false, "no fabricated 'updated' row when the PATCH matched nothing");
    assert.ok(tb.includes("loadTimeOff(true)"), "the list is reloaded so the stale row disappears");
    const uo = src.indexOf("const updateOfficeContact = async (id, patch) => {");
    const ub = src.slice(uo, src.indexOf("const deleteOfficeContact = async (id) => {", uo));
    const zero = ub.indexOf("data.length === 0"), rollback = ub.indexOf("setOfficeContacts(before)", zero), uaudit = ub.indexOf('logAudit("office_contact.update"');
    assert.ok(uo > 0 && zero > 0 && rollback > zero && uaudit > rollback, `zero=${zero} rollback=${rollback} audit=${uaudit}`);
  });
  // F07: the office digest is the Monday 06:00 Central cron (README + live job); the app must not call it Saturday.
  // Scoped to digest copy (review): the shift model is Fri/Sat/Sun units, so a legitimate 'Saturday' in weekend or
  // holiday copy must not trip a pin about the digest cron.
  check("F07: no app copy calls the office digest a Saturday digest (the cron is Monday 06:00 Central)", () => {
    assert.strictEqual(rxCount(/Saturday[^.\n]{0,60}digest|digest[^.\n]{0,60}Saturday/gi), 0);
    assert.strictEqual(count("Monday morning change digest"), 1);
    assert.strictEqual(count("Test the weekly digest now"), 1);
    assert.strictEqual(count("Manually fire the weekly digest now?"), 1);
  });
  check("autosave leg 2 and the keepalive blob leg are gated on blobLoadedRef (after the canWriteBlob gate, before the write - A4: saveBlobNow / the CAS PATCH)", () => {
    const eff = src.indexOf("// --- Supabase: Auto-save on changes ---");
    const leg2gate = src.indexOf("if (!canWriteBlob) {", eff); // Prompt 16 B9 (e): the gate settles the Setup-save waiters before it returns
    const blobGate = src.indexOf("if (!blobLoadedRef.current) {", eff);
    const blobWrite = src.indexOf('await saveBlobNow(payload, "autosave")', eff);
    assert.ok(eff > 0 && leg2gate > eff && blobGate > leg2gate && blobWrite > blobGate, `eff=${eff} leg2gate=${leg2gate} blobGate=${blobGate} write=${blobWrite}`);
    const leg1 = src.indexOf("syncScheduleDays(payload.schedule)", eff);
    assert.ok(leg1 < blobGate, "leg 1 (days) is not behind the blob gate (conventions 3a)");
    const flush = src.indexOf("flushRef.current = (source) => {");
    const flushGate = src.indexOf("if (!blobLoadedRef.current) {", flush);
    const flushBlob = src.indexOf("call_schedule_data?id=eq.main${flushCas}", flush);
    const flushDays = src.indexOf("schedule_days?on_conflict=day", flush);
    assert.ok(flush > 0 && flushGate > flush && flushGate < flushBlob && flushDays < flushGate, "flush: days leg first, then the blobLoadedRef gate, then the blob PATCH");
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

  // Item E (Faraz 9/24: "not important for the Silvis guys to know"): the month grid's E (East-derived week) and F / f
  // (East forecast at / above threshold, 20% or more) badges, their two legend lines and the "East-derived: ..." hover bit
  // render only for the scheduler in signed-in mode. One flag gates the cell's derived / forecast lookups, so the E and
  // F badges, the hover bit and nBadges (the holiday-label gutter) follow it together; surgeons, coordinators, viewers
  // and ?public=1 get a clean grid. Display only - the day editor and Setup > East feed keep their own East information.
  check("Item E (9/24): E and F / f badges, their legend lines and the East-derived hover bit render only when isScheduler && !isPublicMode", () => {
    assert.strictEqual(count("const eastBadgesVisible = isScheduler && !isPublicMode;"), 1, "exactly one eastBadgesVisible flag (isScheduler && !isPublicMode)");
    assert.ok(src.includes("const derived = eastBadgesVisible && rulesCtx ? rulesCtx.derivedByDay[d] : null;"), "the cell's derived-week lookup is gated by the flag (E badge, hover bit and nBadges follow)");
    assert.ok(src.includes("const fc = eastBadgesVisible ? forecastByDay[d] : null;"), "the cell's forecast lookup is gated by the flag (F / f badge and nBadges follow)");
    assert.strictEqual(count('{derived && <span data-badge="E" title={"East-derived week: " + derivedWho}'), 1, "the E badge still keys off the (gated) derived lookup");
    assert.strictEqual(count('{fc && fc.p >= 0.2 && <span data-badge={fc.p >= forecastThreshold ? "F" : "f"}'), 1, "the F / f badge still keys off the (gated) forecast lookup");
    assert.ok(src.includes('if (derivedWho) titleBits.push("East-derived: " + derivedWho);'), "the hover bit still keys off derivedWho (empty when the flag is off)");
    assert.ok(src.includes("const nBadges = (derived ? 1 : 0) + (fc && fc.p >= 0.2 ? 1 : 0) + (awaitingConfirmation(a) ? 1 : 0);"), "nBadges counts the gated derived / fc, so the holiday-label gutter is right for both audiences");
    assert.ok(src.includes('{eastBadgesVisible && <span style={{display:"inline-flex",alignItems:"center",gap:3}}><span style={badge(true, T.badge)}>E</span> East-derived week</span>}'), "the legend's E line is gated");
    assert.ok(src.includes('{eastBadgesVisible && <span style={{display:"inline-flex",alignItems:"center",gap:3}}><span style={badge(true, "#8a5a10")}>F</span> East forecast at or above {Math.round(forecastThreshold * 100)}%, <span style={badge(false, "#8a5a10")}>F</span> 20% or more</span>}'), "the legend's F line is gated");
    assert.strictEqual(count("rulesCtx.derivedByDay[d]"), 1, "the grid is the flag's only derivedByDay reader (the day editor and Setup > East feed take their East information from rulesCtx / the feed card as before)");
    assert.strictEqual(count("eastBadgesVisible"), 5, "the flag is declared once and read four times (derived, fc, two legend lines) - nothing in rules, the feed, the forecast or the generator reads it");
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
  // Prompt 16 B6 (review 9/23 section 3): the vacation note reaches the anon-readable time_off table, so toAdd runs the
  // roster note's denylist (SU_NOTE_DENYLIST) before the insert. Client-side only: no note column has a server-side
  // denylist trigger (the day-editor and availability notes carry none at all - out of B6's scope).
  check("B6: the vacation note gets the roster note's denylist - toAdd refuses before the on-call scan and the time_off insert, the toast names the matched word only", () => {
    const fn = src.slice(src.indexOf("  const toAdd = async (personId, start, end, note) => {"), src.indexOf("  const deleteTimeOffRow = async (rowId) => {"));
    assert.ok(fn.length > 400 && fn.length < 6000, "toAdd could not be sliced out");
    const deny = fn.indexOf('const deny = String(note || "").match(SU_NOTE_DENYLIST);');
    assert.ok(deny > 0, "toAdd has no `const deny = String(note || \"\").match(SU_NOTE_DENYLIST);`");
    assert.ok(deny < fn.indexOf("vacationConflictItems("), "the note is refused before the on-call conflict scan");
    assert.ok(deny < fn.indexOf('db.insert("time_off"'), "the note is refused before the insert");
    assert.ok(fn.includes('if (deny) { const msg = `Refused: the vacation note carries a personal word ("${deny[1]}") - keep it operational (e.g. conference) or leave it blank; vacations are readable with the public key.`; showToast(msg, "error"); return { ok: false, error: msg }; }'),
      "the refusal names the matched word (never the whole note), toasts and returns { ok: false } like the other refusals");
    assert.strictEqual(count('db.insert("time_off"'), 1, "one time_off insert path in the app (the seed import posts through fetch and is gated by importer.js IMP_NOTE_DENYLIST)");
    assert.strictEqual(count("SU_NOTE_DENYLIST"), 5, "SU_NOTE_DENYLIST: the definition, the roster note gate, the Time off form's early check (A7 addVac), the vacation note gate in toAdd and the restore applier");
  });
  // B6 review: the second client path that writes time_off notes is the backup-restore applier (whole rows through
  // fetch, on_conflict=id). A backup made before the denylist landed, or edited by hand, must not carry a personal
  // note back into the anon-readable table: the note is blanked (the row still restores - never a refusal) and the
  // count rides in the applier's counts, which config.js merges into the restore / import audit row.
  // Part B assembly (served build 2026.09.23p, console): the rules-context warnings were logged on EVERY context rebuild
  // (each poll rebuilds it), so a blob still carrying an ignored key flooded the console. Logged once per distinct set.
  check("Part B: the rules-context warnings are logged once per distinct set (lastRulesWarnRef), not on every rebuild", () => {
    assert.ok(src.includes('const lastRulesWarnRef = useRef("");'), "no lastRulesWarnRef");
    assert.ok(src.includes('const key = rulesCtx.warnings.join(" | ");'), "the set is keyed by its joined text");
    assert.ok(src.includes('if (key !== lastRulesWarnRef.current) { lastRulesWarnRef.current = key; console.warn("rules context warnings:", rulesCtx.warnings); }'), "the warn is gated on a changed key");
    assert.strictEqual(count('console.warn("rules context warnings:"'), 1, "one log site");
  });
  check("B6 review: applyTablesUpsert blanks a time_off note that trips the denylist and counts it (time_off_notes_blanked), never refuses the restore", () => {
    const fn = src.slice(src.indexOf("  const applyTablesUpsert = async ({ time_off, availability }) => {"), src.indexOf("  // The blob applier for restore / import: applyPayload calls it the moment"));
    assert.ok(fn.length > 300 && fn.length < 4000, "applyTablesUpsert could not be sliced out");
    assert.ok(fn.includes("const blanked = Array.isArray(time_off) ? time_off.filter(r => r && r.note && SU_NOTE_DENYLIST.test(r.note)) : [];"), "the applier does not scan the time_off notes with SU_NOTE_DENYLIST");
    assert.ok(fn.includes('if (blanked.length) time_off = time_off.map(r => blanked.includes(r) ? { ...r, note: "" } : r);'), "a tripping note must be blanked, the row kept");
    assert.ok(fn.includes("counts.time_off_notes_blanked = blanked.length;"), "the blanked count must ride in counts (config.js merges tables.counts into the audit row)");
    assert.ok(fn.indexOf("counts.time_off_notes_blanked") < fn.indexOf("for (const [table, rows] of"), "the scan runs before the upsert loop");
    assert.ok(!/return \{ ok: false[^}]*note/.test(fn), "a personal note must never fail the restore");
  });
  // B6 review: trade_insert_guard now writes the roster names on INSERT, but trade_update_guard does not pin the two
  // name columns, so a party's status PATCH can still rewrite them. The client therefore treats the stored strings as
  // write-only: tradeNamed resolves both names from the roster by id, unconditionally, and the accept / decline /
  // cancel flows re-resolve the PATCH-returned row before it feeds the feed message, the audit line and the e-mail.
  check("B6 review: tradeNamed resolves both display names from the roster by id (never the stored strings); accept / decline / cancel re-resolve the PATCH-returned row", () => {
    assert.ok(src.includes("const tradeNamed = (r) => ({ ...r, from_surgeon_name: nameOf(r.from_surgeon_id), to_surgeon_name: nameOf(r.to_surgeon_id) });"), "tradeNamed must resolve from the roster by id unconditionally");
    assert.ok(!src.includes("r.from_surgeon_name || nameOf") && !src.includes("r.to_surgeon_name || nameOf"), "tradeNamed must not prefer the stored name over the roster's");
    for (const st of ["accepted", "declined", "cancelled"]) {
      assert.ok(src.includes('const row = tradeNamed({ ...g, ...p.row, status: "' + st + '" });'), "the " + st + " flow must wrap the merged PATCH row in tradeNamed (p.row carries the stored names)");
    }
    assert.strictEqual(count("const row = { ...g, ...p.row, status:"), 0, "no status flow may adopt the PATCH-returned names unresolved");
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
  check("Generate panel (WF 9/23): the implied-shares head line reads the water-filled level over the pool slots (poolSlots / heldByPool, 'at caps' when the level is null), the paragraph and the Totals titles no longer state the flat open-slot share", () => {
    const head = src.slice(src.indexOf('data-testid={"gen-shares-head-" + m}'), src.indexOf("</div>", src.indexOf('data-testid={"gen-shares-head-" + m}')));
    assert.ok(head.length > 0, "no gen-shares-head line");
    assert.ok(head.includes("pool slots") && head.includes("I.poolSlots") && head.includes("I.heldByPool"), "head line does not print the pool slots (open + held)");
    assert.ok(head.includes('"at caps"'), "head line has no 'at caps' rendering for a null level");
    assert.strictEqual(count("reserved = share"), 0, "the flat equation 'open - reserved = share' is still printed");
    assert.strictEqual(count("Implied shares (equal-share fairness"), 0, "the Implied shares heading still says equal-share fairness");
    assert.strictEqual(count("equal share of the month's open primary slots"), 0, "the shares paragraph / Totals titles still describe the flat open-slot share");
    assert.strictEqual(count("implied equal share of the open"), 0, "a Totals title (TotalsCard Target / Target B) still describes the flat open-slot share");
    assert.ok(count("Primary-day target for the period: an explicit monthlyTarget in Setup, else min(level, cap)") === 1 && count("Backup-day target for the period: an explicit { backup } target in Setup, else min(level, backup cap)") === 1, "the Totals table's Target / Target B titles do not name min(level, cap)");
    const sharesHead = src.slice(src.indexOf('data-testid={"gen-shares-" + m}'), src.indexOf("</tr></thead>", src.indexOf('data-testid={"gen-shares-" + m}')));
    assert.ok(sharesHead.includes(">Held P</th>") && sharesHead.includes(">Held B</th>") && !sharesHead.includes("Locked P") && !sharesHead.includes("Locked B"), "the shares table still heads its held-day columns 'Locked P' / 'Locked B'");
    assert.ok(count("water-filled") >= 3, "the Generate panel and Totals name the water-filled share fewer than 3 times");
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
    assert.ok(src.includes('color: wk ? (dk ? T.muted : T.title) : dkSubtext'), "weekend header text is a token (Item A: keyed on the day, not the column)");
    assert.ok(src.includes('borderTop: "2px solid " + (isToday ? T.accent : T.navyMuted)'), "weekend bracket is T.navyMuted (T.accent on today - the today ring keeps its top edge)");
    assert.ok(src.includes('background:n.created_at > notifLastSeen ? T.accentTint : "#f8f9fb",border:`1px solid ${n.created_at > notifLastSeen ? T.accent : "#e8ecf0"}`'), "unread notification uses the accent tint + accent border");
  });

  // ---- Review fixes 2 (RF2, 9/23 overnight): app safety ----
  // (a) Accept & Publish counted only LOCKED replacements: an unlocked manual / trade / claim / generated / import
  //     holder inside the range was regenerated and written without a word. (b) the keepalive flush fired parallel
  //     PATCHes for the same days while a long Accept & Publish CAS loop was still running. (c) the app could not
  //     reproduce a fill-open-only run and defaulted to a random seed without saying where the seed shows.
  //     (e) the in-app seed Apply merged settings one level deep and kept the retired seedRevisions key.
  console.log(String.fromCharCode(10) + "[RF2] acceptPreview confirms held-but-unlocked replacements; keepalive flush yields to an in-flight CAS sync; fill-open-only + seed text; in-app seed Apply drops retired settings keys");
  const heldFnText = (() => { const i = src.indexOf("function suHeldUnlockedSlotChanges("); if (i < 0) return null; const j = src.indexOf("\n}\n", i); return j < 0 ? null : src.slice(i, j + 2); })();
  check("RF2 a: index-source.html defines suHeldUnlockedSlotChanges(current, next) at module level (hoisted, pure)", () => {
    assert.ok(heldFnText, "no 'function suHeldUnlockedSlotChanges(' in index-source.html");
    assert.ok(!/\b(setState|useState|document|window|fetch)\b/.test(heldFnText), "the helper must stay pure");
  });
  const heldFn = heldFnText ? vm.runInContext(heldFnText + "\nsuHeldUnlockedSlotChanges;", sandbox) : null;
  const heldList = (cur, next) => JSON.parse(JSON.stringify(heldFn(cur, next))); // the sandbox realm's arrays, re-created here so deepStrictEqual compares values, not prototypes
  const mk = (p, b, pl, bl, extra) => Object.assign({ primary: p, backup: b, primaryLocked: !!pl, backupLocked: !!bl, source: "manual", externalCover: null, note: null }, extra || {});
  check("RF2 a: an unlocked held slot whose holder changes is listed; a LOCKED held slot is not (the locked prompt owns it); an OPEN slot filled is not; an unchanged held slot is not", () => {
    assert.ok(heldFn, "helper missing");
    const cur = { "2026-10-24": mk("s1", "s2", false, false), "2026-10-25": mk("s3", "s4", true, true), "2026-10-26": mk(null, null, false, false), "2026-10-27": mk("s5", "s6", false, false) };
    const next = { "2026-10-24": mk("s3", "s4", false, false, { source: "generated" }), "2026-10-25": mk("s1", "s2", true, true), "2026-10-26": mk("s1", "s2", false, false, { source: "generated" }), "2026-10-27": mk("s5", "s6", false, false) };
    assert.deepStrictEqual(heldList(cur, next).map(c => c.day + " " + c.role + " " + c.from + "->" + c.to), ["2026-10-24 primary s1->s3", "2026-10-24 backup s2->s4"]);
  });
  check("RF2 a: a locked primary beside an unlocked held backup: only the backup is listed; a mixed day (locked P replaced under 'respect locks' off) still lists only the unlocked role", () => {
    const cur = { "2026-11-05": mk("s3", "s2", true, false) };
    assert.deepStrictEqual(heldList(cur, { "2026-11-05": mk("s3", "s4", true, false) }).map(c => c.role + " " + c.from + "->" + c.to), ["backup s2->s4"]);
    assert.deepStrictEqual(heldList(cur, { "2026-11-05": mk("s1", "s4", true, false) }).map(c => c.role + " " + c.from + "->" + c.to), ["backup s2->s4"], "the locked primary belongs to suLockedSlotChanges, not here");
  });
  check("RF2 a: an unlocked externalCover primary counts as held (ext:<name>); a locked one does not", () => {
    const cur = { "2026-09-28": mk(null, "s5", false, false, { externalCover: "Atwell" }), "2026-09-29": mk(null, "s5", true, false, { externalCover: "Atwell" }) };
    const next = { "2026-09-28": mk("s2", "s3", false, false), "2026-09-29": mk(null, "s3", true, false, { externalCover: "Atwell" }) };
    assert.deepStrictEqual(heldList(cur, next).map(c => c.day + " " + c.role + " " + c.from + "->" + c.to), ["2026-09-28 primary ext:Atwell->s2", "2026-09-28 backup s5->s3", "2026-09-29 backup s5->s3"]);
  });
  check("RF2 a: a held slot cleared to OPEN is listed too; null / missing maps never throw; a day missing from next reads as cleared", () => {
    assert.deepStrictEqual(heldList({ "2026-11-03": mk("s1", null, false, false) }, { "2026-11-03": mk(null, null, false, false) }).map(c => c.role + " " + c.to), ["primary null"]);
    assert.deepStrictEqual(heldList(null, null), []);
    assert.deepStrictEqual(heldList({ "2026-11-03": mk("s1", null, false, false) }, {}), [{ day: "2026-11-03", role: "primary", from: "s1", to: null }]);
    assert.deepStrictEqual(heldList({}, { "2026-11-03": mk("s1", null, false, false) }), [], "a day new in next has no held holder in current");
  });
  check("RF2 a: acceptPreview builds the held-but-unlocked list from the merged map, confirms it BEFORE the snapshot (Cancel aborts, nothing written), keeps the locked sentence, and re-checks both lists after the snapshot", () => {
    const fn = src.indexOf("const acceptPreview = async () => {");
    const end = src.indexOf("const acceptMerged = async", fn);
    assert.ok(fn > 0 && end > fn, "acceptPreview / acceptMerged not found");
    const body = src.slice(fn, end);
    assert.ok(body.includes("const heldChanges = suHeldUnlockedSlotChanges(cur, next);"), "heldChanges from suHeldUnlockedSlotChanges(cur, next)");
    assert.ok(body.includes("const lockedChanges = suLockedSlotChanges(cur, next);"), "the locked list stays");
    assert.ok(body.includes("if (!pv.respectLocks || lockedChanges.length || heldChanges.length || pv.offersStale) {"), "one confirm gate over both lists (U3c review 9/23: a preview stamped offersStale joins the same gate)");
    assert.ok(body.includes("held but unlocked assignment(s) will be replaced: "), "the confirm names and lists the held but unlocked assignments");
    assert.ok(body.includes("This replaces ${lockedChanges.length} locked / published slot(s)"), "the locked sentence is unchanged");
    assert.ok(body.includes('${pv.fillOpenOnly ? "" : " (tick \'Fill open slots only\' to keep every held day)"}'), "RF2 review fix: the checkbox pointer is appended only when the preview did NOT run fill-open-only (fail-before: unconditional)");
    assert.ok(!body.includes("more` : \"\"} (tick 'Fill open slots only'"), "RF2 review fix: the unconditional pointer is gone");
    const gate = body.indexOf("if (!confirm(msg))"), snap = body.indexOf('snapshots.capture("generate_publish")');
    assert.ok(gate > 0 && snap > gate, "the confirm precedes the snapshot capture (nothing is written on Cancel)");
    assert.ok(body.includes("const held2 = suHeldUnlockedSlotChanges(cur2, next2);") && body.includes("held2.length > heldChanges.length"), "the post-snapshot re-derivation re-checks the held list too");
  });
  check("RF2 b: daySyncBusyRef counts the unresolved syncScheduleDays runs (+1 on enqueue, -1 when the run settles); the keepalive flush skips ONLY its schedule_days leg while the count is > 0, re-arms the pending payload and still runs the blob leg", () => {
    assert.ok(src.includes("const daySyncBusyRef = useRef(0);"), "daySyncBusyRef declared as a counter");
    const sync = src.slice(src.indexOf("const syncScheduleDays = (nextSchedule) => {"), src.indexOf("const syncScheduleDaysNow = async"));
    assert.ok(sync.includes("daySyncBusyRef.current += 1;"), "+1 on enqueue");
    assert.ok(sync.includes(".finally(() => { daySyncBusyRef.current = Math.max(0, daySyncBusyRef.current - 1); })"), "-1 when the run settles (ok, blocked, conflict or thrown alike)");
    const fl = src.slice(src.indexOf("flushRef.current = (source) => {"), src.indexOf("const onVisibilityChange = () => {"));
    // RF2 review fix: the skip is for the page-ALIVE case only (visibilitychange: the chain drains after the phone
    // unlocks); on pagehide / beforeunload the chain is about to die, so the keepalive days leg still goes out (a CAS
    // duplicate is harmless at the DB). And the skipped days are enqueued BEHIND the in-flight run, never left to the
    // debounce timer alone.
    assert.ok(!fl.includes("} else if (daySyncBusyRef.current > 0) {"), "RF2 review fix: the busy skip is no longer unconditional on the flush source (fail-before: skipped on pagehide / beforeunload too)");
    const guard = fl.indexOf('} else if (daySyncBusyRef.current > 0 && source === "visibilitychange") {');
    const loop = fl.indexOf("for (const day of Object.keys(Object.assign({}, base, cur)))");
    const blobLeg = fl.indexOf("call_schedule_data?id=eq.main${flushCas}"); // A4: the keepalive blob leg is the CAS PATCH
    assert.ok(guard > 0 && loop > guard && blobLeg > loop, `guard=${guard} loop=${loop} blob=${blobLeg}`);
    const guardBlock = fl.slice(guard, fl.indexOf("} else {", guard));
    assert.ok(guardBlock.includes("pendingSaveRef.current = payload;"), "the skip re-arms the pending payload for the next sync");
    assert.ok(guardBlock.includes("syncScheduleDays(payload.schedule);"), "RF2 review fix: the skipped days are enqueued behind the in-flight run (the chain serializes it; a later timer run is a no-op against lastSyncRef)");
    assert.ok(guardBlock.includes("never-settling fetch"), "RF2 review fix: the comment says a never-settling fetch keeps the count > 0 for the session by design");
    assert.ok(!/\breturn\b/.test(guardBlock), "the skip never returns (the blob leg below still runs)");
    assert.ok(guardBlock.includes("schedule_days leg skipped"), "the skip is logged, never silent");
  });
  check("RF2 c: GeneratePanel has the 'Fill open slots only' checkbox (default off) wired to generate({ fillOpenOnly }), re-roll keeps it, the meta line names it, the Seed placeholder says where the seed shows, and the run toast / meta line show the seed", () => {
    assert.ok(src.includes('<SuCheck testid="gen-fill-open-only" label="Fill open slots only (keep every held day)"'), "checkbox");
    assert.ok(src.includes("checked={opts.fillOpenOnly === true} onChange={v => setOpts(o => ({ ...o, fillOpenOnly: v }))}"), "checkbox state");
    assert.ok(src.includes('useState({ start: "", end: "", bestOf: 200, seed: "", respectLocks: true, fillOpenOnly: false })'), "default off");
    // Prompt 16 B9 (a): the one options object (runOpts) goes to the worker run and to the inline fallback alike.
    assert.ok(src.includes("const runOpts = { seed, bestOf, respectLocks: o.respectLocks !== false, fillOpenOnly: o.fillOpenOnly === true, timeBudgetMs: 25000 };") && src.includes("generate(built.ctx, start, end, runOpts)") && src.includes("generateInWorker(inputs, start, end, runOpts)"), "generate() receives fillOpenOnly (T's option) on both paths");
    assert.ok(src.includes("fillOpenOnly: o.fillOpenOnly === true, ranAt:"), "the preview records the mode");
    assert.ok(src.includes("fillOpenOnly: previewGen.fillOpenOnly === true, respectLocks: previewGen.respectLocks"), "re-roll keeps the mode");
    assert.ok(src.includes('{preview.fillOpenOnly ? ", fill open slots only" : ""}'), "the meta line names the mode");
    assert.ok(src.includes('placeholder="random - the toast shows the seed"'), "seed placeholder");
    assert.strictEqual(count('placeholder="random"'), 0, "the bare 'random' placeholder remains");
    assert.ok(src.includes("showToast(`Preview ready (seed ${seed}, "), "the run toast shows the seed");
    assert.ok(src.includes("seed <span style={{ fontFamily: mono }}>{String(preview.seed)}</span>"), "the preview meta line shows the seed");
    // RF2 review fix: diagnostics.mode ('generate' | 'fill-open-only') and diagnostics.fixedSlots are printed in GenDiagnostics too
    const gd = src.slice(src.indexOf("function GenDiagnostics("), src.indexOf("function GeneratePanel("));
    assert.ok(gd.length > 0 && gd.includes('data-testid="gen-mode"') && gd.includes('{dg.mode || "generate"}') && gd.includes("dg.fixedSlots"), "RF2 review fix: GenDiagnostics prints the run mode and the fixed-slot count (gen-mode) next to the score line (fail-before: only the toast and the meta line named the mode)");
  });
  check("RF2 e: the in-app seed Apply drops the retired settings keys (importer.IMP_RETIRED_SETTINGS_KEYS) from the merged blob, as the SQL path does", () => {
    assert.ok(src.includes("(IMP.IMP_RETIRED_SETTINGS_KEYS || []).forEach(k => { delete merged.settings[k]; });"), "retired keys deleted from merged.settings before the CAS PATCH");
  });

  /* ---------------- P15 part 3: East vacations in the UI (source pins) ---------------- */
  console.log("\n[P15] East vacations UI (index-source.html / app-styles.js pins)");
  check("P15: the rules ctx receives the East vacation inputs - eastVacationRanges keyed by the ROSTER id from eastVacations(eastFeedRows, code) (never a Davenport id) and eastVacationReviews = the loaded rows; the ctxInputs memo depends on the review rows", () => {
    const cs = src.indexOf("const ctxInputs = useMemo(() => {");
    const cb = src.slice(cs, src.indexOf("const rulesCtxState = useMemo", cs));
    assert.ok(cs > 0 && cb.length > 0, "ctxInputs memo not found");
    assert.ok(cb.includes("eastVacations(eastFeedRows, s.code)"), "the ranges must come from east-feed.js eastVacations(rows, code) for the surgeon's CODE");
    assert.ok(cb.includes("eastVacationRanges[s.id] ="), "the map must be keyed by the roster id (s.id)");
    assert.ok(cb.includes("eastVacationRanges, eastVacationReviews: eastVacationReviewRows"), "both inputs must reach buildContext");
    assert.ok(cb.includes("eastOverrideRows, eastIdByCode, eastVacationReviewRows, offerRows, periodRows]"), "the memo must rebuild when the review rows change");
  });
  check("P15: east_vacation_reviews is an authenticated-only table - read through readAuthOnlyTable (null on a stale token, never an anon 200 + [] adopted), a 404 (migration not applied) is named, the load runs at start and in the 60-s poll", () => {
    assert.ok(src.includes('readAuthOnlyTable("east_vacation_reviews"'), "the reviews must be read with readAuthOnlyTable");
    assert.strictEqual(src.includes('db.query("east_vacation_reviews"'), false, "never a plain db.query (anon fallback) on the reviews table");
    assert.ok(src.includes('setEastVacReviewState(missing ? "missing" : "failed")'), "a 404 must be recorded as 'missing' (the table is prepared, not applied)");
    assert.ok(src.includes("await loadEastVacationReviews();"), "initial load");
    assert.ok(src.includes("loadTimeOff(true), loadAvailability(true), loadEastTables(true), loadEastVacationReviews(true),"), "the 60-s poll refreshes the reviews too");
  });
  check("P15: the review write path - dbAuthHeaders() on every mutation, an upsert on (person_id,start,end) with merge-duplicates + representation checked non-empty, a reset is a DELETE by the exact triple, one audit eastvac.review, own rows or the scheduler", () => {
    const ws = src.indexOf("const saveEastVacationReview = async");
    assert.ok(ws > 0, "saveEastVacationReview missing");
    const wb = src.slice(ws, src.indexOf("\n  };", ws));
    assert.ok(wb.includes("/rest/v1/east_vacation_reviews?on_conflict=person_id,start,end"), "the upsert must name the unique triple (the primary key is id)");
    assert.ok(wb.includes('Prefer: "resolution=merge-duplicates,return=representation"'), "merge-duplicates + representation");
    assert.ok(wb.includes('method: "DELETE", headers: { ...dbAuthHeaders(), Prefer: "return=representation" }'), "a reset deletes the row and counts the representation");
    assert.ok(wb.includes("person_id=eq.${encodeURIComponent(personId)}&start=eq.${range.start}&end=eq.${range.end}"), "the delete is scoped to the exact (person, start, end)");
    assert.ok((wb.match(/dbAuthHeaders\(\)/g) || []).length >= 2, "every mutation uses dbAuthHeaders()");
    assert.strictEqual(wb.includes("dbReadHeaders()"), false, "no read headers on a write");
    assert.ok(wb.includes('logAudit("eastvac.review"'), "one audit action eastvac.review");
    assert.ok(wb.includes("!isScheduler && personId !== mySurgeon"), "a surgeon reviews his own ranges only; the scheduler anyone's");
    assert.ok(wb.includes("!Array.isArray(rows) || rows.length === 0"), "an empty representation is a failed save (RLS no-op), never success");
  });
  check("B10 (9/23): the 'home' -> 'either' offers hook is retired - no offerEitherForHomeRange, no 'pending: prompt-14' shape, no TODO(Prompt 14 UI wave); a home decision writes the review row only (the painter's commitOffersPaint is the one call_offers write path)", () => {
    assert.strictEqual(src.includes("offerEitherForHomeRange"), false, "the hook (definition or call) is still in the source");
    assert.strictEqual(src.includes('pending: "prompt-14"'), false, "the no-op's return shape is still in the source");
    assert.strictEqual(src.includes("TODO(Prompt 14 UI wave)"), false, "the TODO marker is still in the source");
    const ws = src.indexOf("const saveEastVacationReview = async"), wb = src.slice(ws, src.indexOf("const goToDay = ", ws));
    assert.ok(ws > 0 && wb.length > 0, "saveEastVacationReview body");
    assert.strictEqual(wb.includes("call_offers") || wb.includes("save_offers"), false, "saveEastVacationReview must not touch call_offers");
    assert.strictEqual(src.includes("/rest/v1/call_offers"), false, "no direct REST write to call_offers anywhere (the painter goes through rpc/save_offers)");
  });
  check("P15: the refresh resets changed / removed ranges through derivedEastVacations(...).stale (person-scoped), skips rows the read could not see, and names the resets in the toast + audit", () => {
    const rs = src.indexOf("const refreshEastFeed = async () => {");
    const rb = src.slice(rs, src.indexOf("const saveEastOverride = async", rs));
    assert.ok(rb.includes("derivedEastVacations(newRanges, eastVacationReviewRows, s.id).stale"), "the stale list must be person-scoped (roster id)");
    assert.ok(rb.includes("st.review.end >= fromMon"), "rows for ranges the time_off read could not see (end < from) are kept");
    assert.ok(rb.includes('"unreviewed", { quiet: true, reason: st.reason }'), "a reset goes through the normal write path with the reason");
    assert.ok(rb.includes("reviewResets"), "the audit row carries the resets");
    assert.ok(rb.includes("East vacation review(s) reset:"), "the toast names the resets");
  });
  check("P15: where it shows - calendar marker with the state (data-eastvac-state), the day-editor East line, the coverage strip item opening the panel, My schedule and the Time off view lists, the East feed card section", () => {
    assert.ok(src.includes('data-eastvac-state={m.state}'), "calendar day cells: marker per person with the state");
    assert.ok(src.includes("eastVacMarkStyle(m.state, dk, textColorOf(m.id))"), "the marker style comes from app-styles.js (never a name-keyed colour)");
    assert.ok(src.includes('data-eastvac={l.eastVac || undefined}'), "the day editor's East line carries the state");
    assert.ok(src.includes('data-testid="cov-eastvac-unreviewed"'), "coverage strip item");
    assert.ok(src.includes("unreviewed East vacations: "), "the strip wording");
    assert.ok(src.includes('data-testid="mine-eastvac"'), "My schedule list");
    assert.ok(src.includes('data-testid="eastvac-timeoff"'), "Time off view list");
    assert.ok(src.includes('data-testid="eastvac-card"'), "East feed card section");
    assert.ok(src.includes('data-testid="eastvac-conflicts"'), "the conflicts list (the time_off trigger mirrored, report only)");
    assert.ok(src.includes("eastVacationConflicts(rulesCtx)"), "the conflicts come from rules.eastVacationConflicts over the live ctx");
    const ev = src.indexOf("function EastVacationList(");
    assert.ok(ev > 0, "one shared EastVacationList component");
    const evb = src.slice(ev, src.indexOf("\nfunction ", ev + 10));
    assert.ok(evb.includes('data-testid={"eastvac-set-" + st}'), "segmented control buttons carry eastvac-set-<state>");
    assert.ok(evb.includes('["unreviewed", "away", "home"]'), "three states, in that order");
  });
  check("P15 (re-stated for Item D, 2026-09-24): the ER export and the daily reminder are untouched by East vacations (assignments, not availability); the office digest reads east_vacation_reviews ONLY inside its Item D 'at Davenport this week' section (decision away, rendered as 'away (Davenport vacation)' beside the change list) - never in the baseline / diff path, never as a schedule assignment", () => {
    const h = readRoot("helpers.js");
    const er = h.slice(h.indexOf("function erPanelRows("), h.indexOf("function buildErCallPanelsDocument(") + 1200);
    assert.ok(er.length > 0 && !/eastVac|east_vacation|eastClear/.test(er), "the ER Call Panels builders mention East vacations");
    const digest = readRoot(path.join("edge-functions", "office-notifications", "index.ts"));
    const eastSection = digest.slice(digest.indexOf("async function buildEastSection("), digest.indexOf("// Mail client"));
    assert.ok(eastSection.length > 0 && /east_vacation_reviews\?select=person_id,start,end,decision&person_id=eq\./.test(eastSection) && /decision=eq\.away/.test(eastSection), "the digest's East section reads the away reviews by roster id");
    // comments stripped AFTER the two regions are cut out of the same text (the markers are comment lines)
    const cutSection = digest.replace(eastSection, "");
    const eastBlock = cutSection.slice(cutSection.indexOf("// @eastCalendar-mirror-start"), cutSection.indexOf("// @eastCalendar-mirror-end"));
    assert.ok(eastBlock.length > 0, "the shared @eastCalendar block is present");
    const outside = cutSection.replace(eastBlock, "").replace(/\/\/[^\n]*/g, "");
    assert.strictEqual(/east_vacation|eastVac/.test(outside), false, "outside buildEastSection and the shared @eastCalendar block the office digest reads no East vacation (baseline, diff, publish and rendering paths untouched)");
    const diffPath = digest.slice(digest.indexOf("async function buildCurrent("), digest.indexOf("// Rendering"));
    assert.strictEqual(/east_vacation|eastVac|east_feed/.test(diffPath), false, "the baseline / diff path (buildCurrent, readBaseline, writeState, diffSnapshots) reads neither table");
    const daily = readRoot(path.join("edge-functions", "daily-reminder", "index.ts"));
    assert.strictEqual(/east_vacation|eastVac/.test(daily), false, "the daily reminder reads East vacations");
  });
  check("P15: app-styles.js eastVacMarkStyle - a diamond distinct from the round dot; unreviewed dashed, away outlined in the person's colour, home filled; the outline clears 3:1 on the cell surface in both themes; eastVacSegStyle for the three-way control", () => {
    assert.ok(styles && typeof styles.eastVacMarkStyle === "function", "eastVacMarkStyle not exported");
    assert.ok(typeof styles.eastVacSegStyle === "function", "eastVacSegStyle not exported");
    assert.ok(styles.EASTVAC_COLORS && styles.EASTVAC_COLORS.light && styles.EASTVAC_COLORS.dark, "EASTVAC_COLORS tokens per theme");
    for (const dark of [false, true]) {
      const T = styles.THEME[dark ? "dark" : "light"];
      const u = styles.eastVacMarkStyle("unreviewed", dark, "#1F3A6B"), a = styles.eastVacMarkStyle("away", dark, "#1F3A6B"), hm = styles.eastVacMarkStyle("home", dark, "#1F3A6B");
      assert.strictEqual(u.borderStyle, "dashed", "unreviewed = dashed");
      assert.strictEqual(a.borderStyle, "solid", "away = solid");
      assert.strictEqual(a.borderColor, "#1F3A6B", "away outline = the person's colour");
      assert.strictEqual(a.background, "transparent", "away is hollow");
      assert.notStrictEqual(hm.background, "transparent", "home is filled");
      assert.ok(/rotate\(45deg\)/.test(u.transform), "a diamond (rotated square), not a round dot");
      assert.strictEqual(u.borderRadius, a.borderRadius, "same shape across states");
      const C = styles.EASTVAC_COLORS[dark ? "dark" : "light"];
      assert.ok(ratio(C.unreviewed, T.surface) >= 3, `${dark ? "dark" : "light"} unreviewed outline ${C.unreviewed} on the cell ${T.surface} = ${ratio(C.unreviewed, T.surface).toFixed(2)}:1`);
      assert.ok(ratio(C.home, T.surface) >= 3, `${dark ? "dark" : "light"} home outline ${C.home} on the cell ${T.surface} = ${ratio(C.home, T.surface).toFixed(2)}:1`);
      assert.ok(ratio(C.unreviewed, T.weekend) >= 3, `${dark ? "dark" : "light"} unreviewed outline on a weekend cell`);
      const segOn = styles.eastVacSegStyle(true, "home", dark), segOff = styles.eastVacSegStyle(false, "home", dark);
      assert.notStrictEqual(segOn.background, segOff.background, "the active segment is distinct");
      assert.ok(Number(segOn.minHeight) >= 32, "tap target height");
      // the active fill is a flat gradient (the dark sheet paints a gradient button's text white) and every tone reads white text at 4.5:1
      assert.ok(/^linear-gradient\(/.test(segOn.background), "active segment background is a flat linear-gradient (dark-sheet contract)");
      for (const st of ["unreviewed", "away", "home"]) { const tone = styles.EASTVAC_SEG_TONES[dark ? "dark" : "light"][st]; assert.ok(ratio("#FFFFFF", tone) >= 4.5, `${dark ? "dark" : "light"} ${st} segment tone ${tone} under white text = ${ratio("#FFFFFF", tone).toFixed(2)}:1`); }
    }
  });
  /* E3 review fixes (9/23) */
  check("P15 fix: ONE predicate decides who has East vacations - eastVacationPerson(s, ef) (East feature reads busy days, a roster code, not an outside surgeon) in the ctx input, in eastVacPeople and in the refresh's vacationCodes", () => {
    assert.ok(src.includes("function eastVacationPerson(s, ef)"), "the shared predicate eastVacationPerson(s, ef) must exist");
    const cs = src.indexOf("const ctxInputs = useMemo(() => {");
    const cb = src.slice(cs, src.indexOf("const rulesCtxState = useMemo", cs));
    assert.ok(cb.includes("eastVacationPerson(s, ef)"), "the ctx input eastVacationRanges must use the shared predicate");
    const ps = src.indexOf("const eastVacPeople = useMemo(() => {");
    const pb = src.slice(ps, src.indexOf("const eastVacById = useMemo", ps));
    assert.ok(ps > 0 && pb.includes("eastVacationPerson(s, ef)"), "eastVacPeople must use the shared predicate");
    const rs = src.indexOf("const refreshEastFeed = async () => {");
    const rb = src.slice(rs, src.indexOf("const saveEastOverride = async", rs));
    assert.ok(rb.includes("eastVacationPerson(s, ef)"), "the refresh's vacationCodes must use the shared predicate");
    assert.ok((src.match(/eastVacationPerson\(s, ef\)/g) || []).length >= 4, "the predicate is defined once and used in the three places");
  });
  check("P15 fix: the refresh's stale list is computed against the RELOADED cache picture (eastVacations(cacheRows, code) - the same merged list the panel, the ctx and the markers read), never the raw fetched list; loadEastTables hands the east_feed rows back; no cache -> no reset", () => {
    const ls = src.indexOf("const loadEastTables = async (quiet) => {");
    const lb = src.slice(ls, src.indexOf("\n  };", ls));
    assert.ok(lb.includes("feedRows"), "loadEastTables must return the east_feed rows it loaded (feedRows)");
    const rs = src.indexOf("const refreshEastFeed = async () => {");
    const rb = src.slice(rs, src.indexOf("const saveEastOverride = async", rs));
    assert.ok(rb.includes("const newRanges = eastVacations(cacheRows, code);"), "the stale list must be computed from the reloaded cache (eastVacations(cacheRows, code))");
    assert.strictEqual(rb.includes("feed.vacations[code] || []"), false, "never against the raw fetched list (a kept-unseen range joined in the cache would reset the review on every refresh)");
    assert.ok(rb.includes("feed.vacations && cacheRows &&"), "a failed cache reload resets nothing");
  });
  check("P15 fix: a quiet reset reports through the ONE refresh toast - saveEastVacationReview's failure toasts are conditioned on !quiet; the start-up 404 (migration not applied) is a console.warn + the panel banner, never a toast to every signed-in user", () => {
    const ws = src.indexOf("const saveEastVacationReview = async");
    const wb = src.slice(ws, src.indexOf("\n  };", ws));
    assert.ok(wb.includes("if (!quiet) showToast(\"Couldn't save the East vacation review: \""), "the HTTP failure toast is silenced under quiet");
    assert.ok(wb.includes("if (!quiet) showToast(\"No review row came back"), "the no-representation toast is silenced under quiet");
    assert.ok(wb.includes("if (!quiet) showToast(\"Couldn't save the East vacation review - check your connection"), "the network failure toast is silenced under quiet");
    assert.ok(wb.includes("if (!quiet) showToast(\"The East vacation reviews table is not on the database yet"), "the 'missing' refusal toast is silenced under quiet");
    const ls = src.indexOf("const loadEastVacationReviews = async (quiet) => {");
    const lb = src.slice(ls, src.indexOf("\n  };", ls));
    assert.ok(lb.includes("if (!quiet && !missing) showToast("), "a 404 at start is not toasted (the panel banner names it; a save attempt refuses with a toast)");
  });
  check("P15 fix: public mode draws no East-vacation marker, legend, title or strip item (the reviews are never loaded there, so every state would read 'unreviewed'); the strip item renders for the scheduler and for the person with the East code only (never a dead end for another surgeon or the viewer)", () => {
    const ps = src.indexOf("const eastVacPeople = useMemo(() => {");
    const pb = src.slice(ps, src.indexOf("const eastVacById = useMemo", ps));
    assert.ok(pb.includes("if (isPublicMode) return out;"), "eastVacPeople is empty in public mode");
    assert.ok(pb.includes("eastVacationReviewRows, todayStr, isPublicMode]"), "the memo depends on isPublicMode");
    assert.ok(src.includes("{!isPublicMode && (isScheduler ? eastVacPeople.length > 0 : !!eastVacById[mySurgeon]) && ("), "the strip item's render condition");
  });
  check("P15 fix: the calendar marker is per DAY from the rules ctx when it is available - unreviewed / away from P.eastVacationDays, home from P.eastClear, a home day the feed says busy carries feedBusy (the feed wins), a Silvis time_off day inside a range carries no East marker - and falls back to the range state without a ctx", () => {
    const ms = src.indexOf("const eastVacByDay = useMemo(() => {");
    const mb = src.slice(ms, src.indexOf("\n  }, [", ms) + 60);
    assert.ok(ms > 0, "eastVacByDay memo missing");
    assert.ok(mb.includes("P.eastVacationDays[d]"), "unreviewed / away days come from P.eastVacationDays");
    assert.ok(mb.includes("P.eastClear.has(d)"), "home days come from P.eastClear");
    assert.ok(mb.includes("feedBusy: true"), "a home day the feed says busy is flagged");
    assert.ok(mb.includes("P.vacation.has(d)"), "a Silvis time_off day inside the range: no East marker (the Silvis dot stands, as the day editor shows no East line)");
    assert.ok(mb.includes("[eastVacPeople, gridDays, rulesCtx]"), "the memo depends on the rules ctx");
    assert.ok(src.includes('data-eastvac-feedbusy={m.feedBusy ? "1" : undefined}'), "the cell marker carries the feed-busy flag");
  });

  /* ---------------- P15 part 4: docs pins (E4) ---------------- */
  // The docs are part of the contract: the orchestrator applies the migration and runs the
  // probe BY HAND from these pages, and Faraz reads the rules doc and ONBOARDING. Pinned only on
  // what must STAY true (headings, the table rows, the final wording, the "nothing deployed"
  // statement, no address) - never on dates, counts or screenshot sizes.
  console.log("\n[P15] East vacations docs (guide section 18, rules doc, ONBOARDING, edge-functions README, prompt delivery note)");
  {
    const readDoc = (...p) => { const f = path.join(ROOT, ...p); return fs.existsSync(f) ? fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n") : null; };
    const guide = readDoc("docs", "SILVIS-BUILD-GUIDE.md") || "";
    const rulesDoc = readDoc("docs", "SILVIS-CALL-RULES.md") || "";
    const onboarding = readDoc("docs", "ONBOARDING.md") || "";
    const efReadme = readDoc("edge-functions", "README.md") || "";
    // B10 (9/23): docs/PROMPT-15-EAST-VACATIONS.md moved to the private folder (docs/HISTORY.md); its delivery note's live
    // facts survive in guide section 18 (18.5 Live steps and open questions) and the rules doc, which the pins below read.
    const sec18 = (() => { const i = guide.indexOf("\n## 18. East vacations"); const j = guide.indexOf("\n## 19.", i + 1); return i > 0 ? guide.slice(i, j > 0 ? j : undefined) : ""; })();
    check("P15 docs: guide section 18 carries the sub-headings 18.1 The pipeline .. 18.5 Live steps and open questions, in order, before section 19", () => {
      assert.ok(sec18.length > 0, "'## 18. East vacations' heading missing (or section 19 does not follow)");
      const HEADS = ["### 18.1 The pipeline", "### 18.2 The review step in the app", "### 18.3 Where it shows", "### 18.4 Proof", "### 18.5 Live steps and open questions"];
      let last = -1;
      HEADS.forEach(h => { const i = sec18.indexOf("\n" + h); assert.ok(i > last, "sub-heading '" + h + "' missing or out of order"); last = i; });
    });
    check("P15 docs: guide section 18 states where the smoke screenshots are (test/ui/out/, gitignored), the hook's exact return shape, and documents verify-rls.sh section 9 (9a-9d + the leftover count) and the exact live commands (migration + probe)", () => {
      assert.ok(/test\/ui\/out\//.test(sec18), "the screenshots' location test/ui/out/ is not named");
      assert.ok(/gitignored/.test(sec18), "section 18 must say the screenshot folder is gitignored (nothing was copied into docs/screenshots on this branch)");
      assert.ok(/offers step: retired \(B10, 9\/23\)/.test(sec18) && /offerEitherForHomeRange/.test(sec18) && /commitOffersPaint/.test(sec18), "section 18 must record that the 'home' -> 'either' hook was retired in B10 and name the painter's write path as the one place offers are made");
      ["9a", "9b", "9c", "9d"].forEach(k => assert.ok(new RegExp("\\b" + k + "\\b").test(sec18), "verify-rls section 9 case " + k + " not documented"));
      assert.ok(/leftover/.test(sec18), "the observed-rollback leftover count is not documented");
      assert.ok(sec18.includes("supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-23-east-vacation-reviews.sql"), "the exact migration command");
      assert.ok(sec18.includes("supabase db query --linked --workdir <dir> -f <abs>/sql/probes/east-vacation-reviews-probe.sql"), "the exact probe command");
      assert.ok(/scripts\/preview-generate\.js/.test(sec18) && /eastVacationRanges/.test(sec18), "the open question about the CLI generate path passing no East-vacation inputs");
    });
    check("P15 docs: guide 4.2 lists east_vacation_reviews as a table and 4.3 places it in the authenticated-read set, never in the anon-readable list", () => {
      const s42 = guide.slice(guide.indexOf("\n### 4.2 Tables"), guide.indexOf("\n### 4.3 RLS posture"));
      const s43 = guide.slice(guide.indexOf("\n### 4.3 RLS posture"), guide.indexOf("\n### 4.4 Data-loss safeguards"));
      assert.ok(s42.length > 0 && s43.length > 0, "sections 4.2 / 4.3 not found");
      assert.ok(/^\|\s*`east_vacation_reviews`/m.test(s42), "4.2 has no east_vacation_reviews row");
      const anonLine = s43.split("\n").find(l => /\*\*Anon-readable:\*\*/.test(l)) || "";
      assert.ok(anonLine.length > 0 && !/east_vacation_reviews/.test(anonLine), "east_vacation_reviews must not appear on the anon-readable line");
      assert.ok(/east_vacation_reviews/.test(s43) && /authenticated/.test(s43), "4.3 must name east_vacation_reviews as authenticated-read");
    });
    check("P15 docs: rules doc section 3 Khan carries the final away / home wording (no 'after the UI part lands' placeholder) and section 8 has an East-vacations open item", () => {
      const khan = rulesDoc.slice(rulesDoc.indexOf("\n### Khan (s1)"), rulesDoc.indexOf("\n### Burchett (s2)"));
      assert.ok(khan.length > 0, "Khan section not found");
      assert.ok(/East vacations, away \/ home \(Prompt 15\)/.test(khan), "the 9/22 evening East vacations entry");
      assert.ok(!/after the UI part lands/.test(khan), "the part-2 placeholder 'after the UI part lands' must be gone (the UI landed 9/23)");
      assert.ok(/Refresh from Davenport/.test(khan) && /\*\*home\*\* on the range over his Silvis Thanksgiving unit/.test(khan), "the first-action note (Refresh from Davenport, then the home decision on the Thanksgiving-unit range - no personal dates in the public doc)");
      const s8 = rulesDoc.slice(rulesDoc.indexOf("\n## 8. Answered"));
      assert.ok(/^\d+\. \*\*East vacations/m.test(s8), "section 8 needs a numbered '**East vacations' item");
      assert.ok(/60 days/.test(s8), "the item must raise the 60-day question (should an unreviewed range block the generator only inside the next 60 days?)");
    });
    check("P15 docs: ONBOARDING has one paragraph for the person with an East code - East vacations in bold, Davenport, away / home, where to decide, and that no Silvis vacation row is written", () => {
      assert.ok(/\*\*East vacations/.test(onboarding), "a bold 'East vacations' lead-in");
      const para = onboarding.split("\n\n").find(p => /\*\*East vacations/.test(p)) || "";
      assert.ok(/Davenport/.test(para), "names Davenport");
      assert.ok(/\*\*away\*\*/.test(para) && /\*\*home\*\*/.test(para), "away and home in bold");
      assert.ok(/Refresh from Davenport/.test(para), "the ranges arrive with the scheduler's Refresh from Davenport");
      assert.ok(/Setup/.test(para) && /Time off/.test(para) && /My schedule/.test(para), "names the three places");
      assert.ok(/unreviewed/.test(para) && /treated/.test(para), "explains that an unreviewed range is treated as away");
      assert.ok(/no Silvis vacation row|never writes? a Silvis vacation|never a Silvis vacation row/i.test(para), "states that no Silvis vacation row is written");
    });
    check("P15 docs: edge-functions/README.md states that Prompt 15 deployed nothing (no function changed) and why", () => {
      assert.ok(/Prompt 15/.test(efReadme), "Prompt 15 is not mentioned");
      const para = efReadme.split("\n\n").find(p => /Prompt 15/.test(p)) || "";
      assert.ok(/nothing deployed|nothing was deployed|no function (was )?(changed|deployed)/i.test(para), "must say nothing was deployed for Prompt 15");
      assert.ok(/east_vacation_reviews/.test(para), "must name the one live step that exists instead (the east_vacation_reviews migration)");
      assert.ok(/assignments, not availability/.test(para), "must say why the digest / reminder / calendar are unchanged");
    });
    // B10 (9/23): the "PROMPT-15-EAST-VACATIONS.md carries the delivery note" pin is dropped with the file; the live steps it
    // named (the migration, the probe, verify-rls.sh section 9) are pinned on guide 18.5 above.
    check("P15 docs: no address-shaped string in the Prompt 15 docs outside the @example.test / @example.com fixtures", () => {
      const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/g;
      const hits = [];
      [["guide", guide], ["rules", rulesDoc], ["ONBOARDING", onboarding], ["README", efReadme]].forEach(([n, t]) => {
        (t.match(EMAIL) || []).forEach(m => { if (!/@example\.(test|com)$/.test(m)) hits.push(n + ": " + m.replace(/[A-Za-z0-9]/g, "x")); });
      });
      assert.deepStrictEqual(hits, [], "address-shaped strings (masked)");
    });
    // Review round (E4): the observed figure is a count of Davenport time_off ROWS; eastMergeRanges merges adjacent rows and the
    // toast counts the merged lists, so the docs never promise "N ranges". And the strip's unreviewed count is not
    // windowed (unreviewedUpcoming counts every range ending today or later; only the open-slot glance uses 60 days),
    // so the 60-day question is about the hard block alone, never "the strip's own window".
    check("P15 docs: the post-deploy note counts Davenport rows (the toast names the merged count), never '16 ranges'; the 60-day question names the strip's open-slot window and says the unreviewed nag is not windowed", () => {
      const all = guide + "\n" + rulesDoc; // B10: the PROMPT-15 copy of the note left with the file; the guide and the rules doc remain
      assert.ok(!/16 FAK ranges|the 16 ranges arrive|16 ranges arrive|(^|[^\/\d])16 (Davenport )?(time_off )?rows/m.test(all), "no doc may promise '16 ranges' or quote the row count - the toast names the merged count and adjacent rows merge");
      assert.ok(/merged count/.test(guide) && /merged count/.test(rulesDoc), "each of the two notes says the toast names the merged count");
      assert.ok(!/strip's own window/.test(all) && !/soft \+ nag|plus the nag beyond/.test(all), "the 60-day question must not call 60 days the strip's own window or move the nag");
      assert.ok(/open-slot window/.test(guide) && /open-slot window/.test(rulesDoc), "each place names the strip's open-slot window");
      assert.ok(/unreviewed count is not windowed/.test(guide) && /unreviewed count is not windowed/.test(rulesDoc), "each place says the unreviewed count is not windowed (the nag already reaches every horizon)");
    });
  }

  // ---- Prompt 14 P5 (9/23) ----
  // Snapshot scope (Faraz 9/22, guide 4.4 / 17): call_schedule_snapshots.data gains call_offers[] + call_periods[] so a restore
  // brings the offers back; the wipe guards (payloadLooksWipedDaily) do not consider them. Read with the same identity as the
  // insert (dbAuthHeaders - both tables are authenticated-read, never anon), a failed read fails the capture like any other.
  console.log("\n[P5] snapshot scope: call_offers + call_periods");
  await (async () => {
    calls.length = 0;
    setFetch((url, opts) => {
      if (opts && opts.method === "POST") return resp(201, "");
      if (url.includes("call_schedule_data")) return resp(200, [{ data: { roster: C.INIT_SURGEONS }, updated_at: "2026-09-23T00:00:00Z" }]);
      if (url.includes("schedule_days")) return resp(200, [{ day: "2026-11-03", primary_id: "s2", version: 1 }]);
      if (url.includes("call_offers")) return resp(200, [{ id: "o1", person_id: "s2", day: "2026-11-03", role_pref: "primary", note: "seed: burchett-email-2026-09-17", entered_by: "scheduler", source: "email-relay" }, { id: "o2", person_id: "s3", day: "2026-11-30", role_pref: "either", note: null, entered_by: "s3", source: "app" }]);
      if (url.includes("call_periods")) return resp(200, [{ id: "p1", label: "Nov 2026 - Jan 2027", start_day: "2026-11-02", end_day: "2027-01-03", status: "upcoming", rules_only_ids: ["s1", "s6"], offer_modes: { s2: "exhaustive" } }]);
      return resp(200, []);
    });
    const r = await C.snapshots.capture("seed_import");
    check("P5: capture reads call_offers and call_periods with the writer's identity and stores both arrays", () => {
      assert.strictEqual(r.ok, true, JSON.stringify(r));
      assert.deepEqual(r.counts, { schedule_days: 1, time_off: 0, availability: 0, call_offers: 2, call_periods: 1 });
      const gets = calls.filter(c => c.method === "GET").map(c => c.url);
      assert.ok(gets.some(u => /\/rest\/v1\/call_offers\?select=\*&order=day\.asc,person_id\.asc&limit=1000&offset=0$/.test(u)), "call_offers read (paged like the others): " + gets.join(" | "));
      assert.ok(gets.some(u => /\/rest\/v1\/call_periods\?select=\*&order=start_day\.asc&limit=1000&offset=0$/.test(u)), "call_periods read: " + gets.join(" | "));
      const post = calls.find(c => c.method === "POST");
      assert.deepStrictEqual(Object.keys(post.body.data).sort(), ["availability", "call_offers", "call_periods", "config", "schedule_days", "time_off"]);
      assert.strictEqual(post.body.data.call_offers.length, 2);
      assert.strictEqual(post.body.data.call_offers[1].source, "app", "app-entered offers are in the snapshot too (a restore brings every offer back)");
      assert.strictEqual(post.body.data.call_periods[0].start_day, "2026-11-02");
    });
  })();
  await (async () => {
    // a failed call_offers read fails the whole capture (never an empty table)
    setFetch((url, opts) => url.includes("call_offers") ? resp(500, "down") : resp(200, url.includes("call_schedule_data") ? [{ data: { roster: C.INIT_SURGEONS }, updated_at: null }] : []));
    const r = await C.snapshots.capture("test");
    check("P5: a failed call_offers read returns ok:false (a destructive action stays blocked)", () => { assert.strictEqual(r.ok, false); assert.match(r.error, /call_offers read failed: HTTP 500/); });
  })();
  await (async () => {
    // offers alone are worth a snapshot; every table empty and the blob empty still skips
    calls.length = 0;
    setFetch((url, opts) => {
      if (opts && opts.method === "POST") return resp(201, "");
      if (url.includes("call_offers")) return resp(200, [{ id: "o1", person_id: "s2", day: "2026-11-03", role_pref: "primary" }]);
      return resp(200, []);
    });
    const r = await C.snapshots.capture("test");
    check("P5: offers alone are enough to snapshot", () => {
      assert.strictEqual(r.ok, true); assert.strictEqual(calls.filter(c => c.method === "POST").length, 1);
    });
    setFetch(() => resp(200, []));
    const r2 = await C.snapshots.capture("test");
    check("P5: all six sources empty -> skipped", () => { assert.strictEqual(r2.ok, true); assert.strictEqual(r2.skipped, "empty_or_missing"); });
  })();
  check("P5: normalizePayload accepts optional call_offers / call_periods arrays and validates their keys; old backups without them still pass", () => {
    const withOffers = C.snapshots.normalizePayload({ config: {}, schedule_days: [{ day: "2026-11-03" }], time_off: [], availability: [],
      call_offers: [{ id: "o1", person_id: "s2", day: "2026-11-03", role_pref: "primary" }], call_periods: [{ id: "p1", start_day: "2026-11-02", end_day: "2027-01-03", label: "x" }] });
    assert.deepStrictEqual(Object.keys(withOffers).sort(), ["availability", "call_offers", "call_periods", "config", "schedule_days", "time_off"]);
    assert.strictEqual(withOffers.call_offers.length, 1); assert.strictEqual(withOffers.call_periods.length, 1);
    const old = C.snapshots.normalizePayload({ config: { roster: [] }, schedule_days: [{ day: "2026-01-01" }], time_off: [], availability: null });
    assert.deepEqual(old.call_offers, []); assert.deepEqual(old.call_periods, []);
    assert.throws(() => C.snapshots.normalizePayload({ call_offers: { a: 1 } }), /call_offers must be an array/);
    assert.throws(() => C.snapshots.normalizePayload({ call_offers: [{ person_id: "s2", day: "2026-11-03" }] }), /call_offers\[0\] is missing person_id\/day\/role_pref/);
    assert.throws(() => C.snapshots.normalizePayload({ call_offers: [{ person_id: "s2", day: "11/3/2026", role_pref: "primary" }] }), /call_offers\[0\]/);
    assert.throws(() => C.snapshots.normalizePayload({ call_periods: [{ label: "x" }] }), /call_periods\[0\] is missing start_day\/end_day/);
  });
  await (async () => {
    // applyPayload hands the two arrays to the app's table applier (which still writes time_off / availability only - it ignores the two keys and applyPayload says so via notApplied)
    calls.length = 0;
    setFetch((url, opts) => {
      if (opts && opts.method === "POST") return resp(201, "");
      if (url.includes("call_schedule_data")) return resp(200, [{ data: { roster: [] }, updated_at: "t0" }]);
      if (url.includes("schedule_days")) return resp(200, [{ day: "2026-01-01", primary_id: "s1" }]);
      return resp(200, []);
    });
    let given = null;
    const r = await C.snapshots.applyPayload(
      { config: { roster: C.INIT_SURGEONS }, schedule_days: [{ day: "2026-10-12", primary_id: "s4", version: 7 }], time_off: [], availability: [],
        call_offers: [{ id: "o1", person_id: "s2", day: "2026-11-03", role_pref: "primary" }], call_periods: [{ id: "p1", start_day: "2026-11-02", end_day: "2027-01-03" }] },
      async () => ({ ok: true }), async (t) => { given = t; return { ok: true, counts: {} }; }, "before_restore");
    // Prompt 14 P5 FLIP (9/23 review): the counts never claim a restore the applier did not do - the payload lengths are
    // reported as *_in_backup, the applied counts come from the applier alone (call_offers_upserted / call_periods_upserted,
    // if an applier ever writes them), and notApplied names the offer tables the applier ignored
    check("P5: applyPayload passes call_offers / call_periods to the table applier and reports them as in-backup, not as applied", () => {
      assert.strictEqual(r.ok, true, JSON.stringify(r));
      assert.deepStrictEqual(Object.keys(given).sort(), ["availability", "call_offers", "call_periods", "time_off"]);
      assert.strictEqual(given.call_offers.length, 1); assert.strictEqual(given.call_periods.length, 1);
      assert.strictEqual(r.counts.call_offers_in_backup, 1); assert.strictEqual(r.counts.call_periods_in_backup, 1);
      assert.ok(!("call_offers" in r.counts) && !("call_periods" in r.counts), "no bare call_offers / call_periods count (the audit row would read it as restored): " + JSON.stringify(r.counts));
      assert.deepEqual(r.notApplied, ["call_offers", "call_periods"], "an applier that returns no *_upserted count for them did not write them: " + JSON.stringify(r.notApplied)); // deepEqual: the array is born in the sandbox realm
    });
    const r2 = await C.snapshots.applyPayload(
      { config: { roster: C.INIT_SURGEONS }, schedule_days: [{ day: "2026-10-12", primary_id: "s4", version: 7 }], time_off: [], availability: [],
        call_offers: [{ id: "o1", person_id: "s2", day: "2026-11-03", role_pref: "primary" }], call_periods: [] },
      async () => ({ ok: true }), async () => ({ ok: true, counts: { time_off_upserted: 0, availability_upserted: 0, call_offers_upserted: 1, call_periods_upserted: 0 } }), "before_restore");
    check("P5: an applier that reports call_offers_upserted / call_periods_upserted (part 3) -> nothing notApplied; an empty backup table is never notApplied", () => {
      assert.strictEqual(r2.ok, true, JSON.stringify(r2));
      assert.strictEqual(r2.counts.call_offers_upserted, 1); assert.strictEqual(r2.counts.call_offers_in_backup, 1); assert.strictEqual(r2.counts.call_periods_in_backup, 0);
      assert.strictEqual(r2.notApplied, undefined, JSON.stringify(r2.notApplied));
    });
  })();
  check("P5: the wipe guard does not consider offers (a payload with offers and nothing else still looks wiped)", () => {
    assert.strictEqual(C.payloadLooksWiped({ schedule: {}, vacations: {}, availability: [], call_offers: [{ person_id: "s2", day: "2026-11-03", role_pref: "primary" }] }), true);
  });
  // 9/23 rebase review (major): the app's applier still writes time_off / availability only, so the restore and the JSON
  // import must SAY so - notApplied reaches the audit row (message suffix + detail.notApplied + outcome partial), the
  // alert and the toast; and the in-app seed import refuses Apply for a seed whose offer periods the legacy plan did
  // not convert (the block note, the disabled button, a second guard in applySeedImport).
  check("P5 (rebase review): restore / import surface notApplied as PARTIAL in the audit row, the alert and the toast", () => {
    assert.ok(src.includes("const applyTablesUpsert = async ({ time_off, availability }) => {"), "the applier still destructures the two legacy tables (the pin above expects notApplied for the offer tables)");
    assert.ok(src.includes('const notAppliedSuffix = (r) => notAppliedList(r).length ? ` - PARTIAL: ${notAppliedList(r).join(" / ")} in the backup were not written (the app does not restore them yet)` : "";'), "notAppliedSuffix");
    assert.ok(src.includes('const notAppliedDetail = (r) => notAppliedList(r).length ? { notApplied: notAppliedList(r), outcome: "partial" } : {};'), "notAppliedDetail");
    assert.strictEqual(count('${notAppliedSuffix(r)}`, {'), 2, "both success audit rows (snapshot.restore, data.import) carry the suffix");
    assert.strictEqual(count("...notAppliedDetail(r) });"), 2, "both success audit rows carry notApplied + outcome partial in the detail");
    const after = src.indexOf("const afterPayloadApplied = (r, what) => {");
    const body = src.slice(after, src.indexOf("  const restoreSnapshot = async (snap) => {", after));
    assert.ok(/NOT restored \(captured in the backup only/.test(body) && /\(PARTIAL\)/.test(body), "the alert names the tables not restored and says PARTIAL");
    assert.ok(body.includes('na.length ? "error" : "success"'), "the toast is an error when something in the backup was not written");
  });
  // Prompt 14 IP (9/23): the in-app dry run plans PERIOD-AWARE exactly like scripts/import-seed.js (offerPeriods: true,
  // today = the Central date of now inside importer.js, the two authenticated-read tables passed as null = unknown, as
  // the CLI's fetchLive passes them), so its diff text, counts and 'Total changes' read as the CLI's dry run does; the
  // call_periods / call_offers legs are displayed (seed-period-legs) under the line that says the CLI alone applies
  // them, and Apply stays refused for a plan that carries periods (the app has no writer for the two tables and never
  // deletes the availability rows a period retires). A seed without offerPeriods plans and applies exactly as before.
  check("P5 / IP: the in-app seed import plans period-aware like the CLI, displays the CLI-only legs and refuses Apply for a plan that carries offer periods", () => {
    assert.ok(src.includes("plan = IMP.importPlan(seed, { now: new Date().toISOString(), offerPeriods: true });"), "the in-app plan is the CLI's period-aware plan (offerPeriods: true; today = the Central date of now inside importer.js)");
    assert.ok(!src.includes("plan = IMP.importPlan(seed, { now: new Date().toISOString() });"), "the legacy (period-less) plan call is gone from pickSeedFile");
    assert.ok(src.includes("call_offers: null, call_periods: null"), "fetchLiveForImport passes the two authenticated-read tables as unknown, exactly as the CLI's fetchLive does (never an anon 200 + [] read as empty)");
    assert.ok(src.includes("const periodGap = plan.offerPeriods ? (plan.offerPeriods.seedPeriods || 0) : 0;"), "periodGap = the offer periods the plan carries (0 for a seed without offerPeriods)");
    assert.ok(src.includes("setSeedState(s => ({ ...s, loading: false, plan, diff, live, periodGap }));"), "periodGap reaches the seed state");
    assert.ok(src.includes('if ((st.periodGap || 0) > 0) { showToast(`Apply refused: the seed carries ${st.periodGap} offer period(s) - the app writes no call_periods / call_offers rows and deletes none of the availability rows a period retires; apply it with the CLI (scripts/import-seed.js --apply). Nothing was written.`, "error"); return; }'), "applySeedImport's own guard, before the blob check");
    assert.ok(src.includes("const canApply = !!(d && !state.applying && (d.totalChanges > 0) && !periodBlocked);"), "canApply requires a plan without periods");
    assert.ok(src.includes('<div data-testid="seed-period-legs"'), "the plan's call_periods / call_offers legs are displayed in the dry-run panel");
    assert.ok(src.includes("These legs are applied by the CLI only (node scripts/import-seed.js --apply): the app writes no call_periods / call_offers rows and deletes no retired availability rows."), "the CLI-only line under the legs");
    assert.ok(src.includes('<div data-testid="seed-period-block" style={{ ...css.warnBox, marginBottom: 8 }}>'), "the block note");
    assert.ok(src.includes("node scripts/import-seed.js --apply --workdir &lt;linked dir&gt;"), "the note names the CLI command");
    // IP review: the documented rule for the one path the gate cannot see (a seed with offerPeriods stripped by hand plans period-free and Apply is allowed)
    assert.ok(src.includes("Once a period is live, never apply the seed here with its offerPeriods removed: the app cannot see call_periods, and a period-free plan re-adds the available rows the period retired."), "the Setup card states the rule: never apply the seed in-app with offerPeriods removed once a period is live");
    // the app never gets an apply path for the two legs: no REST call on call_offers / call_periods and no DELETE inside applySeedImport
    const apStart = src.indexOf("  const applySeedImport = async () => {");
    const apEnd = src.indexOf("  const resetAllData = async () => {", apStart);
    assert.ok(apStart > 0 && apEnd > apStart, "applySeedImport is followed by resetAllData");
    const apBody = src.slice(apStart, apEnd);
    assert.ok(!/rest\/v1\/call_(offers|periods)/.test(apBody), "applySeedImport writes neither call_offers nor call_periods");
    assert.ok(!/method: "DELETE"/.test(apBody), "applySeedImport deletes nothing (the retired availability rows are the CLI's)");
  });

  /* ---------------- F. Prompt 14 part 3a (U3a): the offer painter's pure pieces + source pins ---------------- */
  console.log("\n[F] Prompt 14 U3a: offer painter helpers + source pins");
  check("U3a: offersDraftDiff splits a draft against the saved rows into insert / update / delete, drops no-ops, day order", () => {
    const saved = [
      { id: "a", person_id: "s1", day: "2026-11-03", role_pref: "primary" },
      { id: "b", person_id: "s1", day: "2026-11-05T00:00:00", role_pref: "either" }, // a timestamp-shaped day reads by its date
      { id: "c", person_id: "s1", day: "2026-11-09", role_pref: "backup" },
    ];
    const draft = {
      "2026-11-09": null,        // clear a saved offer -> delete
      "2026-11-03": "primary",   // same as saved -> no-op
      "2026-11-05": "backup",    // saved either -> update
      "2026-11-02": "either",    // new -> insert
      "2026-11-01": "",          // clear a day never saved -> no-op
      "2026-11-10": "clear",     // an unknown brush -> bad, writes nothing
      "11/12/2026": "primary",   // not ISO -> bad
    };
    const d = H.offersDraftDiff(saved, draft);
    assert.deepStrictEqual(d.insert, [{ day: "2026-11-02", role_pref: "either" }]);
    assert.deepStrictEqual(d.update, [{ day: "2026-11-05", role_pref: "backup", was: "either" }]);
    assert.deepStrictEqual(d.delete, ["2026-11-09"]);
    assert.deepStrictEqual(d.bad, ["11/12/2026", "2026-11-10"]);
    assert.strictEqual(d.count, 3);
  });
  check("U3a: offersDraftDiff accepts a { day: role } saved map, an empty draft is a zero diff, junk never throws", () => {
    assert.deepStrictEqual(H.offersDraftDiff({ "2026-12-01": "primary" }, { "2026-12-01": "either" }), { insert: [], update: [{ day: "2026-12-01", role_pref: "either", was: "primary" }], delete: [], bad: [], count: 1 });
    assert.deepStrictEqual(H.offersDraftDiff([], {}), { insert: [], update: [], delete: [], bad: [], count: 0 });
    assert.deepStrictEqual(H.offersDraftDiff(null, null).count, 0);
    assert.deepStrictEqual(H.offersDraftDiff("x", 7).count, 0);
  });
  check("U3a: offerDayWhy - obligations grey (first family word), the weekday-pattern family confirms, the rest is neither", () => {
    const w = H.offerDayWhy(["slot-locked:s2", "east-busy", "hard-never-weekday:Tue", "monthly-cap:8"]);
    assert.strictEqual(w.block, "East busy");
    assert.strictEqual(w.confirm, "never a call day by your rules");
    assert.deepStrictEqual(w.codes, { block: ["east-busy"], confirm: ["hard-never-weekday:Tue"] });
    assert.deepStrictEqual(H.offerDayWhy(["holiday-opt-out:Thanksgiving"]).block, "you opted out of Thanksgiving");
    assert.strictEqual(H.offerDayWhy(["time-off:2026-11-19"]).block, "on your vacation");
    assert.strictEqual(H.offerDayWhy(["day-before-vacation"]).block, "the day before your vacation");
    assert.strictEqual(H.offerDayWhy(["derived-lock:backup"]).block, "your East/Silvis week");
    assert.strictEqual(H.offerDayWhy(["outside-window"]).block, "outside your window");
    assert.strictEqual(H.offerDayWhy(["east-forecast-busy:0.75"]).block, "East forecast busy");
    // the person's own dated rows BLOCK (rules.js never lifts them for an offer - the 9/23 review's finding), with words that name the fix
    ["unavailable-row", "no-backup-row", "backup-only-row"].forEach(c => { const r = H.offerDayWhy([c]); assert.ok(r.block && /ask the scheduler to change that row first/.test(r.block) && !r.confirm, c + " must block (not confirm): " + JSON.stringify(r)); });
    const none = H.offerDayWhy(["holds-other-role", "not-offered", "max-consecutive:3", "backup-cap:7"]);
    assert.deepStrictEqual(none, { block: null, confirm: null, codes: { block: [], confirm: [] } });
    assert.deepStrictEqual(H.offerDayWhy(null), { block: null, confirm: null, codes: { block: [], confirm: [] } });
    // every hard code rules.js can raise is classified on purpose: block, confirm, or (listed here) weighed by the generator
    const R = require(path.join(ROOT, "rules.js"));
    const neither = ["unknown-surgeon", "bad-role:", "external-cover", "external-surgeon", "slot-locked:", "holds-other-role", "monthly-cap:", "max-consecutive:", "backup-cap:", "backup-weekend-cap:", "max-major-holidays:", "not-offered"];
    R.HARD_REASONS.forEach(code => {
      const w2 = H.offerDayWhy([code + (code.endsWith(":") ? "x" : "")]);
      if (neither.indexOf(code) >= 0) assert.strictEqual(w2.block || w2.confirm, null, code + " must be neither block nor confirm");
      else assert.ok(w2.block || w2.confirm, code + " is not classified by offerDayWhy (add it to the block or confirm table)");
    });
  });
  check("U3a: the painter's confirm / block split holds in a REAL ctx - every confirm code the seed raises is lifted by a saved offer, the three dated-row codes never are", () => {
    // Built from docs/silvis-seed.json through rules.buildContext (no word table consulted): for every (surgeon, day, role)
    // of the first period whose no-offer hard list carries a confirm-family code, an offer of that role on that day must
    // remove the code; a dated unavailable / no_backup / backup_only row must survive the same offer. This is what makes
    // "the saved offer lifts that pattern" true when the painter says it, and "ask the scheduler to change that row"
    // right when it greys.
    const R = require(path.join(ROOT, "rules.js"));
    const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "silvis-seed.json"), "utf8"));
    const per = seed.offerPeriods[0];
    const base = { roster: seed.roster, surgeonRules: seed.surgeonRules, groupRules: seed.groupRules, holidays: seed.holidays, schedule: {}, availabilityRows: [], periods: [per], today: "2026-09-23" };
    const core = (c) => String(c).split(":")[0];
    const ctx0 = R.buildContext({ ...base, offers: [] });
    const lifted = {}, kept = [];
    for (let d = per.start; d <= per.end; d = H.suAddDays(d, 1)) {
      ["s1", "s2", "s3", "s4", "s5", "s6"].forEach(id => ["primary", "backup"].forEach(role => {
        const codes = R.eligibility(ctx0, d, role, id, { claim: true }).hard.map(core).filter(c => H.OFFER_CONFIRM_WORDS[c]);
        if (!codes.length) return;
        const after = R.eligibility(R.buildContext({ ...base, offers: [{ person_id: id, day: d, role_pref: role }] }), d, role, id, { claim: true }).hard.map(core);
        codes.forEach(c => { if (after.indexOf(c) >= 0) kept.push(id + " " + d + " " + role + " " + c); else lifted[c] = (lifted[c] || 0) + 1; });
      }));
    }
    assert.deepStrictEqual(kept, [], "confirm codes a saved offer did NOT lift (move them to OFFER_BLOCK_WORDS)");
    assert.ok(Object.keys(lifted).length >= 5, "the seed should exercise at least five confirm codes, saw " + JSON.stringify(lifted));
    ["hard-never-weekday", "weekday-pattern", "recurring-unavailable", "weekend-block-only", "whitelist-month", "outside-available-weeks", "day-before-aledo"].forEach(c => assert.ok(lifted[c], c + " was not exercised / lifted: " + JSON.stringify(lifted)));
    // the dated rows: an offer of the same role on the same day never lifts them -> they must be BLOCK codes
    const day = "2026-12-09", pid = "s3"; // a Wed inside the period for Acton (his recurring-unavailable Wed is lifted, the row is not)
    [["unavailable", "either", ["primary", "backup"], "unavailable-row"], ["no_backup", "either", ["backup"], "no-backup-row"], ["backup_only", "primary", ["primary"], "backup-only-row"]].forEach(([kind, pref, roles, code]) => {
      const ctx1 = R.buildContext({ ...base, availabilityRows: [{ person_id: pid, kind, role: "any", start_date: day }], offers: [{ person_id: pid, day, role_pref: pref }] });
      roles.forEach(role => {
        const e = R.eligibility(ctx1, day, role, pid, { claim: true });
        assert.ok(e.hard.map(core).indexOf(code) >= 0, kind + " row + offer " + pref + ": " + role + " should still be hard " + code + ", got " + JSON.stringify(e.hard));
        const why = H.offerDayWhy(e.hard);
        assert.ok(why.block && !why.confirm, code + " must grey the row (block), never confirm: " + JSON.stringify(why));
      });
    });
  });
  check("U3a: offerNextPeriod prefers the earliest period still OPEN for offers, falls back to the running frozen one; offerPeriodOpen reads status + offers_close_at like OF003 / OM005", () => {
    const P = [{ id: "b", start_day: "2027-02-01", end_day: "2027-04-30", offers_close_at: "2027-01-05", status: "upcoming" }, { id: "a", start_day: "2026-11-02", end_day: "2027-01-03", offers_close_at: "2026-10-02", status: "upcoming" }, { id: "z", start_day: "2026-08-01", end_day: "2026-09-20", offers_close_at: "2026-07-01", status: "published" }];
    assert.strictEqual(H.offerNextPeriod(P, "2026-09-23").id, "a", "a is open until 10/2");
    assert.strictEqual(H.offerNextPeriod(P, "2026-10-02").id, "b", "on the freeze day a is frozen (close <= today) -> the next open period b, not a (the 9/23 review's finding)");
    assert.strictEqual(H.offerNextPeriod(P, "2026-12-15").id, "b", "between the freeze and a's end the painter speaks to b");
    assert.strictEqual(H.offerNextPeriod(P, "2027-01-04").id, "b");
    assert.strictEqual(H.offerNextPeriod(P, "2027-05-01"), null);
    assert.strictEqual(H.offerNextPeriod(P, "bad"), null);
    assert.strictEqual(H.offerNextPeriod(null, "2026-09-23"), null);
    // no open period at all -> the running frozen one (read-only in the sheet), never null while a period is still running
    const onlyA = [P[1], P[2]];
    assert.strictEqual(H.offerNextPeriod(onlyA, "2026-12-15").id, "a");
    assert.strictEqual(H.offerPeriodOpen(onlyA[0], "2026-12-15"), false);
    assert.strictEqual(H.offerPeriodOpen(onlyA[0], "2026-10-01"), true);
    assert.strictEqual(H.offerPeriodOpen(onlyA[0], "2026-10-02"), false, "frozen ON offers_close_at (OF003: close <= today)");
    assert.strictEqual(H.offerPeriodOpen({ start_day: "2027-02-01", end_day: "2027-04-30", offers_close_at: "2027-01-05", status: "closed" }, "2026-12-15"), false, "a status other than upcoming is closed whatever the date");
    assert.strictEqual(H.offerPeriodOpen({ start_day: "2027-02-01", end_day: "2027-04-30" }, "2026-12-15"), true, "no status / no close = open (the seed's shape before the importer fills them)");
    assert.strictEqual(H.offerPeriodOpen(null, "2026-12-15"), false);
    assert.strictEqual(H.offerPeriodOpen({}, "bad"), false);
    assert.strictEqual(H.offerNextPeriod([{ id: "s", start: "2026-11-02", end: "2027-01-03", offersCloseAt: "2026-10-02" }], "2026-09-23").id, "s"); // seed aliases
    assert.strictEqual(H.offerPeriodOpen({ start: "2026-11-02", end: "2027-01-03", offersCloseAt: "2026-10-02" }, "2026-10-02"), false, "offersCloseAt alias read");
  });
  check("U3a: offerRulesWords speaks every seed surgeon's rules from the data (no name branch), defaults when nothing is on file", () => {
    const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "silvis-seed.json"), "utf8"));
    const words = (id) => H.offerRulesWords(seed.surgeonRules[id], seed.groupRules);
    const k = words("s1"); assert.ok(k.some(s => /^Weekdays: Mon, Wed \(offered automatically when East is clear\)\.$/.test(s)), JSON.stringify(k)); assert.ok(k.some(s => s === "Never primary on Tue, Thu."), JSON.stringify(k)); // hardNeverWeekdaysRoles ["primary"] in the seed (9/22: backup open Tue/Thu) assert.ok(k.some(s => /East \(Davenport\) call days block primary; the forecast stands in/.test(s)));
    const b = words("s2"); assert.ok(b.some(s => s === "Available on the 2/4 Mon, the 1 Tue, the 2/4 Wed."), JSON.stringify(b)); assert.ok(b.some(s => s === "Cap: 8 primary days a month (7 preferred)."));
    const a = words("s3"); assert.ok(a.some(s => s === "Never primary on Tue.")); assert.ok(a.some(s => s === "Unavailable on the 2/4 Mon, the 2/4 Wed.")); assert.ok(a.some(s => s === "Never on Thanksgiving.")); assert.ok(a.some(s => s === "No monthly cap of your own."));
    const p = words("s4"); assert.ok(p.some(s => /^Listed weeks \(Mondays\): 11\/9, 11\/23, 12\/7, 12\/21, 12\/28, 1\/11 and 13 more\.$/.test(s)), JSON.stringify(p)); assert.ok(p.some(s => /^Aledo days: the 1\/3 Wed, Fri of week 3; never on call the day before\.$/.test(s))); assert.ok(p.some(s => s === "Backup cap: 7 days and 1 weekend a month."));
    const f = words("s5"); assert.ok(f.some(s => s === "Outside your East weeks: primary on Wed, Fri/Sat/Sun as one block; backup any day."), JSON.stringify(f)); assert.ok(f.some(s => /East weeks derive your Silvis week/.test(s))); assert.ok(f.some(s => s === "Cap: 14 primary days a month, East primary-week days included."));
    const s6 = words("s6"); assert.ok(s6.some(s => s === "Windows: 10/19-10/23, 11/16-11/20, 12/14-12/18, 1/11-1/15 (about 2 primary days per window week)."), JSON.stringify(s6)); assert.ok(s6.some(s => s === "Weekends: one day at a time."));
    assert.deepStrictEqual(H.offerRulesWords(null, seed.groupRules), ["No rules of yours are on file - the scheduler places you by the group defaults."]);
    assert.deepStrictEqual(H.offerRulesWords({}, {}), ["No recurring rules of yours are on file - the scheduler places you by the group defaults."]);
    assert.deepStrictEqual(H.offerRulesWords({ name: "X" }, { defaultMonthlyCap: { primary: 8 } }), ["Cap: the group default of 8 primary days a month."]);
    const all = ["s1", "s2", "s3", "s4", "s5", "s6"].flatMap(words).join(" ");
    assert.strictEqual(/@|\b\d{3}[-.]\d{3}[-.]\d{4}\b/.test(all), false, "rules words must never carry an address or phone");
  });
  {
    const src = fs.readFileSync(path.join(ROOT, "index-source.html"), "utf8");
    const styles = require(path.join(ROOT, "app-styles.js"));
    check("U3a pins: OfferPainterSheet is a MODULE-SCOPE component mounted outside the view conditionals, the app never defines it inside CallSchedule", () => {
      const def = src.indexOf("\nfunction OfferPainterSheet(");
      const app = src.indexOf("\nfunction CallSchedule() {");
      const appEnd = src.indexOf("\nfunction MonthPainterSheet(");
      assert.ok(def > 0, "no module-scope OfferPainterSheet");
      assert.ok(app > 0 && appEnd > app && (def < app || def > appEnd), "OfferPainterSheet is defined inside CallSchedule (it would remount and lose the draft)");
      assert.ok(src.includes("{offerSheet && !isPublicMode && (\n        <OfferPainterSheet"), "the sheet is not mounted beside the vacation painter (outside the view conditionals)");
      assert.strictEqual((src.match(/<OfferPainterSheet\b/g) || []).length, 1, "exactly one mount");
    });
    check("U3a pins: one Save = ONE rpc/save_offers request (rows + period + mode together) through authFetch (dbAuthHeaders at send time, Prompt 16 A3) + ONE audit row offers.save; a mode-only save = ONE rpc/set_offer_mode; nothing to write = no request and no audit; no direct call_offers / call_periods write", () => {
      assert.ok(src.includes("`${SUPABASE_URL}/rest/v1/rpc/save_offers`, { method: \"POST\", body: JSON.stringify("), "save_offers must be one POST through authFetch");
      assert.strictEqual((src.match(/rest\/v1\/rpc\/save_offers/g) || []).length, 1, "save_offers is called from exactly one place");
      assert.ok(src.includes("body: JSON.stringify({ p_person: personId, p_rows: rows, p_clear: diff.delete, p_period: withMode ? period.id : null, p_mode: withMode ? mode : null })"), "the rows request must carry the period + mode when the same Save changed the toggle (one commit or nothing - the 9/23 review's finding 3)");
      assert.ok(src.includes("`${SUPABASE_URL}/rest/v1/rpc/set_offer_mode`, { method: \"POST\", body: JSON.stringify("), "set_offer_mode must be one POST through authFetch");
      assert.ok(/if \(diff\.count > 0\) \{[\s\S]*?\} else \{\s*const r2 = await authFetch\(`\$\{SUPABASE_URL\}\/rest\/v1\/rpc\/set_offer_mode`/.test(src), "set_offer_mode is the MODE-ONLY path (the else of diff.count > 0), never a second request after the rows");
      assert.ok(src.includes("if (diff.count === 0 && !withMode) return { ok: true, nothing: true };"), "nothing to write must return before any request or audit row (finding 10)");
      assert.ok(src.includes("if (diff.count === 0 && !mode) { setBusy(false); setDraft({}); setModeDraft(null); setPendingStart(null); setSavedNote(\"Already saved - nothing to write\");"), "the sheet's Save must drop an equalised draft without calling onCommit");
      assert.strictEqual(src.includes("modeError"), false, "no partial 'rows saved, mode not' state may remain (the combined Save is atomic)");
      assert.strictEqual((src.match(/logAudit\("offers\.save"/g) || []).length, 1, "exactly one offers.save audit site");
      assert.strictEqual(/rest\/v1\/call_offers[^\n]*method: "(POST|PATCH|DELETE)"/.test(src), false, "a direct call_offers write bypasses the atomic RPC");
      // U3b: the scheduler's Periods section (createPeriod / closePeriodNow) writes call_periods directly - the painter's commit never does.
      const paintFn = src.slice(src.indexOf("const commitOffersPaint = async"), src.indexOf("// --- Periods (Prompt 14 part 3b, U3b)"));
      assert.ok(paintFn.length > 500 && paintFn.includes("rpc/save_offers"), "commitOffersPaint body not found before the Periods block");
      assert.strictEqual(/rest\/v1\/call_periods/.test(paintFn), false, "a direct call_periods write in the painter's commit (a surgeon cannot; the scheduler path is Periods, not the painter)");
      assert.ok(src.includes("const diff = offersDraftDiff(savedByDay, draft);"), "the sheet's Save must diff through helpers.offersDraftDiff");
      assert.ok(src.includes("if (!res.ok) {\n          const t = await res.text().catch(() => \"\");\n          console.warn(\"Paint offers: save_offers failed\", res.status, t.slice(0, 300));\n          return { ok: false, error: describeDbError(t) };"), "a failed save_offers must warn and return ok:false with the verbatim reason (the sheet keeps the draft)");
      assert.ok(src.includes("OFFERS?_[A-Z_]+|MODE_[A-Z_]+"), "describeDbError must show the OF001-OF003 / OS / OM tokens verbatim");
    });
    check("U3a pins: offers / periods are authenticated-only reads (readAuthOnlyTable), the sheet greys through eligibility(..., { claim: true }) + offerDayWhy, confirms the weekday-pattern family", () => {
      assert.ok(src.includes('readAuthOnlyTable("call_offers"'), "call_offers must be read through readAuthOnlyTable (an anon read answers 200 + [] and would wipe the list)");
      assert.ok(src.includes('readAuthOnlyTable("call_periods"'), "call_periods must be read through readAuthOnlyTable");
      assert.ok(src.includes('eligibility(ctx, ds, role, person.id, { claim: true })'), "the sheet must consult eligibility with { claim: true } (exhaustive not-offered never greys)");
      assert.ok(src.includes("const why = offerDayWhy("), "the sheet must classify the hard reasons through helpers.offerDayWhy");
      assert.ok(src.includes("normally not one of your"), "the weekday-pattern confirmation wording is missing");
      assert.ok(src.includes("frozen") && src.includes("ask the scheduler"), "the frozen reason must say to ask the scheduler");
      assert.ok(src.includes("if (per && !isScheduler && !offerPeriodOpen(per, today))"), "a row's frozen reading must be helpers.offerPeriodOpen (one reading with OF003 / OM005 and the period box)");
      // finding 1: the period box speaks to the OPEN period; a frozen fallback is read-only for a non-scheduler
      assert.ok(src.includes("const periodOpen = !!period && (isScheduler || offerPeriodOpen(period, today));"), "periodOpen must be derived from offerPeriodOpen (the scheduler is never frozen)");
      assert.ok(src.includes("const mode = !periodOpen ? null : modeDirty ? modeDraft :"), "a frozen period never takes a mode from Save");
      assert.ok(src.includes("if (!period || !periodOpen || busy) return;"), "'Go by my rules' must refuse a frozen period");
      assert.ok(src.includes('data-testid="ofp-period-closed"') && src.includes("closed{periodClose ? \" \" + fmtMD(periodClose) : \"\"} - ask the scheduler for a late change."), "a frozen period must render read-only with the closed date and 'ask the scheduler'");
      assert.ok(src.includes("{period && periodOpen && <button data-testid=\"ofp-period-toggle\""), "the Change button (and so the toggle) must exist only on an open period");
      // findings 4 / 9: Clear never queues a past / frozen day, but may take back a saved offer under a later obligation
      assert.ok(src.includes("const clearable = (r) => !!r && !r.past && !r.frozen && !!savedByDay[r.ds];"), "clearable(): a saved offer on an obligation-greyed row, never past / frozen");
      assert.ok(src.includes("if (r.grey && !clearable(r)) { skipped.push(dayText(ds) + \": \" + r.grey); return; }"), "the Clear branch must skip and NAME greyed rows it cannot clear (a range must not fail the whole batch on OF003)");
      assert.ok(src.includes("if (!r || (r.grey && !(armed === \"clear\" && clearable(r)))) return;"), "tapDay must let Clear through on a clearable greyed row");
      assert.ok(src.includes("const tappable = !grey || (armed === \"clear\" && clearable(r));") && src.includes("disabled={!tappable}"), "the row button must be enabled for Clear on a clearable greyed row");
      // findings 5 / 7: the period box is one line by default
      assert.ok(src.includes("const periodExpanded = periodOpen && (periodOpenBox || modeDirty);"), "the period box expands only on Change or while the mode is dirty");
      assert.ok(src.includes('data-testid="ofp-period-line"') && src.includes('data-testid="ofp-list"'), "the one-line period summary and the day list need their test ids (the smoke measures the list's height)");
    });
    check("U3a pins: entry points - My schedule button, the nav action, the #offers deep link; the toggle + 'Go by my rules' + paste box live in the sheet", () => {
      assert.ok(src.includes('data-testid="paint-offers"'), "My schedule lacks the Paint my offers button");
      assert.ok(src.includes('data-testid="nav-paint-offers"'), "the nav bar lacks the Paint offers action");
      assert.ok(src.includes('window.location.hash === "#offers"'), "no #offers deep link");
      assert.ok(src.includes('{["primary", "backup", "either", "clear"].map(k => (\n            <button key={k} data-testid={"ofp-brush-" + k}'), "the four brushes (ofp-brush-<key>) are missing");
      ["ofp-range", "ofp-mode-exhaustive", "ofp-mode-preferred", "ofp-rules-only", "ofp-paste-text", "ofp-paste-add", "ofp-save", "ofp-discard", "ofp-close", "ofp-counts", "ofp-error", "ofp-saved", "ofp-day", "ofp-why", "ofp-cancel-start", "ofp-period-toggle", "ofp-period-line", "ofp-period-closed", "ofp-list", "ofp-footer"].forEach(t => assert.ok(src.includes('data-testid="' + t + '"'), "missing data-testid " + t));
      assert.ok(src.includes("suParseDateList(pasteText, pasteYear)"), "the paste box must reuse the availability paste parser");
      assert.ok(src.includes("data-testid=\"ofp-prev\" disabled={atCurrentMonth}"), "< must be disabled on the current month (navigation is from the current month forward)");
      assert.ok(src.includes("setTimeout(() => setSavedNote(\"\"), 3000)"), "the saved note must clear after 3 s");
    });
    check("U3a pins: app-styles carries the brush tokens the sheet reads (never literals in the JSX)", () => {
      assert.ok(styles.OFFER_BRUSH && styles.OFFER_BRUSH.primary && styles.OFFER_BRUSH.backup && styles.OFFER_BRUSH.either && styles.OFFER_BRUSH.clear, "OFFER_BRUSH tokens missing");
      ["primary", "backup", "either", "clear"].forEach(k => { const b = styles.OFFER_BRUSH[k]; assert.ok(/^linear-gradient\(/.test(b.gradient), k + " armed brush must be a gradient (the dark sheet exempts gradient buttons)"); assert.ok(/^#[0-9A-Fa-f]{6}$/.test(b.text) && /^#[0-9A-Fa-f]{6}$/.test(b.tint) && /^#[0-9A-Fa-f]{6}$/.test(b.border), k + " tokens must be hex"); });
      assert.strictEqual(typeof styles.css.brush, "function", "css.brush(on, key) missing");
      assert.ok(src.includes("css.brush(armed === k, k)"), "the sheet's brushes must read css.brush");
    });

    /* ---------------- G. Prompt 14 part 3b (U3b): the Periods section - the helpers it leans on + source pins ---------------- */
    console.log("\n[G] Prompt 14 U3b: Periods section - timeline / roll call + source pins");
    check("U3b: offerTimeline fills a period from a start + preset like the form does (end = last day of the Nth month, Fri/Sat -> the following Sunday; close = start - 6 weeks; publish = start - 4 weeks); offerRollcall = the table's rows", () => {
      const R = { lengthMonths: 3, presets: [3, 6], closeWeeksBeforeStart: 6, publishWeeksBeforeStart: 4, remindDaysBeforeClose: [14, 3] };
      const t3 = H.offerTimeline({ start_day: "2027-01-04", length_months: 3 }, R);
      assert.deepStrictEqual({ s: t3.start_day, e: t3.end_day, c: t3.offers_close_at, p: t3.publish_by, m: t3.length_months }, { s: "2027-01-04", e: "2027-03-31", c: "2026-11-23", p: "2026-12-07", m: 3 });
      const t6 = H.offerTimeline({ start_day: "2027-01-04", length_months: 6 }, R);
      assert.deepStrictEqual({ e: t6.end_day, c: t6.offers_close_at, p: t6.publish_by }, { e: "2027-06-30", c: "2026-11-23", p: "2026-12-07" });
      assert.strictEqual(H.offerTimeline({ start_day: "2026-08-03", length_months: 3 }, R).end_day, "2026-11-01", "2026-10-31 is a Saturday -> the following Sunday");
      assert.deepStrictEqual(H.offerTimeline({ start_day: "2027-01-04" }, {}).presets, [3, 6], "absent rules -> the defaults' presets");
      const per = { id: "p", start_day: "2026-11-02", end_day: "2027-01-03", rules_only_ids: ["s6"], offer_modes: { s2: "exhaustive" } };
      const offers = [{ person_id: "s2", day: "2026-11-03", role_pref: "primary" }, { person_id: "s2", day: "2026-11-03", role_pref: "backup" }, { person_id: "s2", day: "2026-12-01", role_pref: "either" }, { person_id: "s3", day: "2026-10-14", role_pref: "either" }];
      assert.deepStrictEqual(H.offerRollcall(per, offers, ["s1", "s2", "s3", "s6"]), [{ id: "s1", status: "not_started", offered: 0 }, { id: "s2", status: "submitted", offered: 2 }, { id: "s3", status: "not_started", offered: 0 }, { id: "s6", status: "rules_only", offered: 0 }]);
      assert.deepStrictEqual(H.offerPoolIds([{ id: "s1", active: true }, { id: "x1", active: true, type: "external" }, { id: "s2", active: false }, { id: "s3" }]), ["s1", "s3"], "the table lists active, non-external roster entries");
    });
    check("U3b pins: PeriodsSection is a MODULE-SCOPE component mounted once inside the Generate card above GeneratePanel, behind the Setup view's isScheduler gate; status is derived through offerRollcall over offerPoolIds; the presets fill the dates through offerTimeline", () => {
      const def = src.indexOf("\nfunction PeriodsSection(");
      const app = src.indexOf("\nfunction CallSchedule() {");
      const appEnd = src.indexOf("\nfunction MonthPainterSheet(");
      assert.ok(def > 0 && app > 0 && appEnd > app && (def < app || def > appEnd), "PeriodsSection must be defined at module scope (a component inside CallSchedule remounts and loses the form)");
      assert.strictEqual((src.match(/<PeriodsSection\b/g) || []).length, 1, "exactly one mount");
      const mount = src.indexOf("<PeriodsSection ");
      const card = src.lastIndexOf('<Collapsible css={css} ck="setup_generate"', mount);
      const gen = src.indexOf("<GeneratePanel", mount);
      assert.ok(card > 0 && gen > mount && !src.slice(card, mount).includes("</Collapsible>"), "the section must sit inside the setup_generate card above GeneratePanel");
      const gate = src.lastIndexOf('{view==="setup" && !isPublicMode && isScheduler && <>', mount);
      assert.ok(gate > 0 && gate < card, "the Setup view's isScheduler gate must precede the mount");
      ["periods-section", "prd-new", "prd-form", "prd-label", "prd-start", "prd-end", "prd-close", "prd-publish", "prd-create", "prd-cancel", "prd-form-warn", "prd-form-error", "prd-period", "prd-label-text", "prd-status", "prd-close-now", "prd-generate", "prd-table", "prd-row", "prd-remind", "prd-enter-for", "prd-remind-note"].forEach(t => assert.ok(src.includes('data-testid="' + t + '"'), "missing data-testid " + t));
      assert.ok(src.includes('data-testid={"prd-preset-" + n}') && src.includes("const presets = Array.isArray(rules.presets) && rules.presets.length ? rules.presets : OP_PERIOD_DEFAULTS.presets;"), "the presets come from groupRules.offerPeriods.presets (prd-preset-<n>), defaults otherwise");
      assert.ok(src.includes("const roll = offerRollcall(p, offers || [], ids);") && src.includes("const ids = React.useMemo(() => offerPoolIds(roster || []), [roster]);"), "status must be derived through helpers.offerRollcall over offerPoolIds - never stored");
      assert.ok(src.includes("const t = offerTimeline({ start_day: start, length_months: months }, rules);"), "the presets must fill the dates through helpers.offerTimeline");
      assert.ok(src.includes('if (d.offers_close_at > d.start_day) return "Offers must close on or before the start day') && src.includes('if (o) return "This range overlaps "'), "the form refuses a close after the start (the DB check) and an overlapping period before any request");
    });
    check("U3b pins: createPeriod = ONE POST call_periods through dbAuthHeaders + return=representation with the returned row checked, then ONE audit period.create; closePeriodNow = confirm, ONE compare-and-swap PATCH (status=eq.upcoming) with its row checked, then ONE audit period.close; no DELETE; exactly two call_periods write sites", () => {
      assert.strictEqual((src.match(/`\$\{SUPABASE_URL\}\/rest\/v1\/call_periods`, \{ method: "POST", headers: \{ \.\.\.dbAuthHeaders\(\), Prefer: "return=representation" \}/g) || []).length, 1, "exactly one call_periods POST site (createPeriod)");
      assert.ok(src.includes('if (!Array.isArray(rows) || rows.length !== 1 || !rows[0].id) { console.warn("Periods: create answered without the new row (RLS no-op?)"'), "a 2xx without the new row must be a failure (an RLS no-op is 200 + [])");
      assert.strictEqual((src.match(/logAudit\("period\.create"/g) || []).length, 1, "exactly one period.create audit site");
      assert.strictEqual((src.match(/rest\/v1\/call_periods\?id=eq\.\$\{encodeURIComponent\(p\.id\)\}&status=eq\.upcoming`, \{ method: "PATCH", headers: \{ \.\.\.dbAuthHeaders\(\), Prefer: "return=representation" \}/g) || []).length, 1, "exactly one call_periods PATCH site, a compare-and-swap on status upcoming (closePeriodNow)");
      assert.ok(src.includes('if (!Array.isArray(rows) || rows.length !== 1) { console.warn("Periods: close matched no upcoming row"'), "zero rows back from the CAS PATCH must be reported, never audited as a close");
      assert.strictEqual((src.match(/logAudit\("period\.close"/g) || []).length, 1, "exactly one period.close audit site");
      assert.strictEqual(/rest\/v1\/call_periods[^\n]*method: "DELETE"/.test(src), false, "no call_periods DELETE");
      assert.strictEqual((src.match(/rest\/v1\/call_periods[^\n]*method: "(POST|PATCH)"/g) || []).length, 2, "call_periods is written from exactly two sites (create + close)");
      const create = src.indexOf("const createPeriod = async"), close = src.indexOf("const closePeriodNow = async"), remind = src.indexOf("const remindOffers = async");
      assert.ok(create > 0 && close > create && remind > close, "createPeriod, closePeriodNow, remindOffers in that order");
      const cBody = src.slice(create, close), eBody = src.slice(close, remind);
      assert.ok(cBody.indexOf("rest/v1/call_periods") < cBody.indexOf('logAudit("period.create"'), "the create audit comes after the POST and its row check");
      assert.ok(eBody.indexOf("if (!confirm(`Close offers for ") < eBody.indexOf("rest/v1/call_periods") && eBody.indexOf("rest/v1/call_periods") < eBody.indexOf('logAudit("period.close"'), "Close now: confirm, then the PATCH, then the audit");
      assert.ok(cBody.includes('return { ok: false, error: describeDbError(text) }') && eBody.includes('return { ok: false, error: describeDbError(text) }'), "a failed request returns the verbatim reason and writes nothing more");
    });
    check("U3b pins: Remind = ONE sendEmailNotif('offers_reminder', words composed here, targetIds [that person]) on not_started rows of an open period, honouring schedule_updates_email, writing nothing else; Enter for someone opens the painter targeted at the period (entered_by / source left to the SQL); Generate this period = runGenerate with the period's range", () => {
      assert.strictEqual((src.match(/sendEmailNotif\("offers_reminder"/g) || []).length, 1, "exactly one offers_reminder send site");
      assert.ok(src.includes('const r = await sendEmailNotif("offers_reminder", { subject, message, detail }, [personId]);'), "the reminder is targeted at the one person (never a broadcast)");
      assert.ok(src.includes("const closeLabel = prdDayWords(close);") && src.includes("const subject = `Your call dates for ${p.label} freeze on ${closeLabel}`;") && src.includes("(${prdDayWords(start)} to ${prdDayWords(end)}) freeze on ${closeLabel}${when} - paint them in the app or choose 'go by my rules'."), "the client composes the same words as the morning run (daily-reminder buildOffersReminder), dates in the cron's spelling");
      assert.ok(src.includes("if (pref && pref.schedule_updates_email === false) {"), "a person with schedule-update e-mails off is not mailed (the server gates too)");
      assert.ok(src.includes('{r.status === "not_started" && status === "upcoming" && open && ('), "Remind renders on not_started rows of an open upcoming period only");
      const remindBody = src.slice(src.indexOf("const remindOffers = async"), src.indexOf("const enterOffersFor"));
      assert.strictEqual(/logAudit\(|rest\/v1\//.test(remindBody), false, "Remind writes nothing but the e-mail call");
      assert.ok(src.includes("const enterOffersFor = (p, personId) => { if (!isScheduler || !personId) return; setOfferSheet({ personId, periodId: p && p.id ? p.id : null }); };"), "Enter for someone must open the painter as that surgeon with the period id");
      assert.ok(src.includes("preferPeriodId={offerSheet.periodId || null}") && src.includes("const period = React.useMemo(() => preferred || offerNextPeriod(periods, today), [preferred, periods, today]);"), "the painter must speak to the targeted period");
      const prdBlock = src.slice(src.indexOf("const createPeriod = async"), src.indexOf("// --- Snapshot restore"));
      assert.strictEqual(/entered_by\s*:|source\s*:\s*"/.test(prdBlock), false, "the client never sends entered_by / source - the SQL stamps them from the caller identity");
      assert.ok(src.includes("setGenOpts(o => ({ ...o, start, end }));\n    runGenerate({ ...genOpts, start, end });"), "Generate this period = the existing runGenerate with the period's range (same options, confirmations and writes)");
    });
    check("U3b review pins (9/23): Remind dates spelled like the cron's fmtDay; the section paints its own text in the remapped muted token (no #3a4a58 outside the pill); the scheduler's own row reads 'Paint my offers'; a Start change keeps hand-edited fields; the New-period draft is CallSchedule state; the copy says Generate places by the rules today", () => {
      // prdDayWords mirrors edge-functions/daily-reminder fmtDay: full weekday, short month, day-of-month
      const cron = fs.readFileSync(path.join(ROOT, "edge-functions", "daily-reminder", "index.ts"), "utf8");
      const dow = 'const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];';
      const mon = 'const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];';
      assert.ok(cron.includes(dow) && cron.includes(mon) && cron.includes("return `${WEEKDAYS[dt.getUTCDay()]}, ${MONTHS[m - 1]} ${d}`;"), "the cron's fmtDay changed - re-mirror prdDayWords");
      assert.ok(src.includes(dow.replace("WEEKDAYS", "PRD_DOW")) && src.includes(mon.replace("MONTHS", "PRD_MON")) && src.includes('return PRD_DOW[dt.getUTCDay()] + ", " + PRD_MON[dt.getUTCMonth()] + " " + dt.getUTCDate();'), "prdDayWords must spell dates exactly like the cron's fmtDay");
      const sec = src.slice(src.indexOf("\nfunction PeriodsSection("), src.indexOf("\nfunction GeneratePanel("));
      assert.ok(sec.length > 2000, "PeriodsSection body not found");
      assert.strictEqual((sec.match(/#3a4a58/g) || []).length, 1, "only the status pill (its own light background) may use #3a4a58 - the dark sheet does not remap it");
      assert.ok(src.includes('const PRD_MUTED = "#5B6B82";') && sec.includes("color: PRD_MUTED }}>{day(p.start_day)} - {day(p.end_day)}") && sec.includes("fontSize: 12, color: PRD_MUTED, marginBottom: 6"), "the range and the timeline line take the muted token the dark sheet remaps");
      assert.ok(sec.includes('{r.id === selfId ? "Paint my offers" : "Enter for " + nameOf(r.id)}') && src.includes("selfId={mySurgeon} draft={prdDraft} setDraft={setPrdDraft}"), "the scheduler's own row reads 'Paint my offers' (his own offers: entered_by him, source app), every other row 'Enter for <name>'");
      assert.ok(sec.includes('["end_day", "offers_close_at", "publish_by", "label"].forEach(f => { if (touched[f]) n[f] = d[f]; });') && sec.includes("touched: { ...touched, [k]: true }"), "a Start change re-derives only the fields the scheduler has not edited");
      assert.ok(src.includes("const [prdDraft, setPrdDraft] = useState(null);") && !sec.includes("React.useState(null)"), "the New-period draft lives in CallSchedule (the collapsed card / a tab change unmounts the section)");
      // U3c (9/23): offerRows / periodRows are in ctxInputs now - the copy promises offers-first placement and nothing else
      assert.ok(sec.includes('"Generate this period" places what was offered first (offered days first, gaps by each surgeon\'s rules) over the period\'s range') && src.includes("Generate the period when you are ready - offered days are placed first, the gaps by each surgeon's rules.") && sec.includes("offered days first, the gaps by the rules; Accept & Publish is below"), "the Periods copy (intro, Close-now toast, Generate title) must say offers are placed first now that offerRows / periodRows are in ctxInputs");
      assert.strictEqual(/standing rules - offers are not placed first yet|lands with the engine wiring/.test(src), false, "stale 'not offers-first yet' copy left behind");
    });

    /* ---------------- H. Prompt 14 part 3c (U3c): the day editor's offer labels + My schedule's offer pills ---------------- */
    console.log("\n[H] Prompt 14 U3c: offer labels in the day editor + My schedule");
    // offerCandidateWords lives in index-source.html at MODULE scope as plain JS (no JSX) so the day editor and My
    // schedule share one vocabulary; the test lifts its source text and runs it here (a behaviour test, not a pin).
    const ocwSrc = (() => { const a = src.indexOf("\nfunction offerCandidateWords("); if (a < 0) return null; const b = src.indexOf("\n}\n", a); return src.slice(a, b + 3); })();
    check("U3c: offerCandidateWords speaks the labels from rules.offerState - 'offered <primary|backup|either>', 'offered <x> only, not <role>' + the mode's consequence, 'not offered' + the consequence (exhaustive: ineligible, preferred: penalty), 'rules' (chose / nothing entered); null outside every period or for junk", () => {
      assert.ok(ocwSrc, "no module-scope offerCandidateWords in index-source.html");
      const fn = new Function(ocwSrc + "\nreturn offerCandidateWords;")();
      const per = { key: "p1", label: "Nov 2026 - Jan 2027" };
      assert.strictEqual(fn(null, "primary"), null);
      assert.strictEqual(fn("junk", "primary"), null);
      assert.deepStrictEqual(fn({ period: per, status: "submitted", mode: "preferred", roles: ["primary"] }, "primary"), { kind: "offered", tag: "offered primary", words: "offered primary", mode: "preferred" });
      assert.deepStrictEqual(fn({ period: per, status: "submitted", mode: "exhaustive", roles: ["primary", "backup"] }, "backup"), { kind: "offered", tag: "offered either", words: "offered either", mode: "exhaustive" });
      assert.deepStrictEqual(fn({ period: per, status: "submitted", mode: "exhaustive", roles: ["backup"] }, "primary"), { kind: "offered-other", tag: "offered backup only", words: "offered backup only, not primary - only these days: ineligible", mode: "exhaustive" });
      assert.deepStrictEqual(fn({ period: per, status: "submitted", mode: "preferred", roles: ["primary"] }, "backup"), { kind: "offered-other", tag: "offered primary only", words: "offered primary only, not backup - preferred days: penalty", mode: "preferred" });
      assert.deepStrictEqual(fn({ period: per, status: "submitted", mode: "exhaustive", roles: [] }, "primary"), { kind: "not-offered", tag: "not offered", words: "not offered - only these days: ineligible", mode: "exhaustive" });
      assert.deepStrictEqual(fn({ period: per, status: "submitted", mode: "preferred", roles: [] }, "backup"), { kind: "not-offered", tag: "not offered", words: "not offered - preferred days: penalty", mode: "preferred" });
      assert.deepStrictEqual(fn({ period: per, status: "rules_only", mode: "preferred", roles: [] }, "primary"), { kind: "rules", tag: "rules", words: "rules (chose go by my rules)", mode: null });
      assert.deepStrictEqual(fn({ period: per, status: "not_started", mode: "preferred", roles: [] }, "primary"), { kind: "rules", tag: "rules", words: "rules (nothing entered)", mode: null });
      // an unknown role asks about the day, not a role: an offered day is 'offered <x>' whatever was asked
      assert.strictEqual(fn({ period: per, status: "submitted", mode: "preferred", roles: ["backup"] }, undefined).kind, "offered");
    });
    check("U3c pins: offerRows / periodRows enter ctxInputs as offers / periods (with the memo deps) - the ONE wiring the engine, the day editor, the generator and the trade path share; no second buildContext input site adds them", () => {
      assert.ok(src.includes("      timeOffRows, availabilityRows, schedule, offers: offerRows, periods: periodRows,\n"), "ctxInputs must carry offers: offerRows, periods: periodRows");
      assert.ok(src.includes("}, [surgeons, surgeonRules, groupRules, holidays, timeOffRows, availabilityRows, schedule, eastFeedRows, eastForecastRows, eastOverrideRows, eastIdByCode, eastVacationReviewRows, offerRows, periodRows]);"), "the ctxInputs memo must depend on offerRows and periodRows (a realtime offer must reach the editor)");
      assert.strictEqual((src.match(/offers: offerRows/g) || []).length, 1, "offers: offerRows appears once (the ctxInputs memo) - every consumer builds from ctxInputs");
    });
    check("U3c pins: the day editor lists the offer standing per candidate from offerState on the DRAFT ctx - one editor-<role>-offers line per role block with an editor-offer-cand per pool surgeon (data-id / data-kind), the period's label named; an eligible dropdown option carries the short tag; REASON_WORDS glosses not-offered and softTag knows offered / outside-offers", () => {
      const ed = src.slice(src.indexOf("\nfunction DayEditor("), src.indexOf("// ===================== SETUP VIEW COMPONENTS"));
      assert.ok(ed.length > 5000, "DayEditor body not found");
      assert.ok(ed.includes("const offerInfo = React.useMemo(() => {") && ed.includes("try { st = offerState(ctx, day, s.id); } catch (e) {"), "the editor reads rules.offerState(ctx, day, id) on the draft ctx (a thrown read is logged, never a crash)");
      assert.ok(ed.includes('data-testid={"editor-" + role + "-offers"}') && ed.includes('data-testid="editor-offer-cand" data-id={x.id} data-kind={x.w.kind}') && ed.includes("Offers ({offerInfo.period.label}):"), "the per-role offers line with one span per candidate");
      assert.ok(ed.includes("const tag = offerTagFor(o.id, role);") && ed.includes('(tags.length ? " (" + tags.join(", ") + ")" : "")'), "the dropdown label carries the offer tag among the soft tags");
      assert.ok(ed.includes('.filter(s => s.type !== "external")'), "outside surgeons never offer (rules.js drops their rows) - they are not on the line");
      assert.ok(src.includes('"not-offered": "not among the days offered (only these days)"'), "REASON_WORDS must gloss the hard not-offered");
      assert.ok(src.includes('case "offered": return "offered day (bonus)";') && src.includes('case "outside-offers": return "outside the offered days (penalty)";'), "softTag must word the two soft offer reasons");
    });
    check("U3c pins: with offers in the ctx a claim and a trade acceptance are offers made on the spot (rules doc 2c) - the board gate and tradeEligibility pass { claim: true } (the hard not-offered is skipped, the soft outside-offers still surfaces); the day editor and the generator do NOT claim", () => {
      assert.ok(src.includes("try { return eligibility(rulesCtx, day, role, candidateId, { ignoreLocks: true, claim: true, ...(opts || {}) }); }"), "tradeEligibility must pass claim: true");
      assert.ok(src.includes("try { r = eligibility(rulesCtx, s.day, s.role, sg.id, { claim: true, ...(boardBlockMember(s.day, s.role, sg.id) ? { asBlockMember: true } : {}) }); }"), "the open-shifts board gate must pass claim: true");
      const ed = src.slice(src.indexOf("\nfunction DayEditor("), src.indexOf("// ===================== SETUP VIEW COMPONENTS"));
      assert.strictEqual(/claim:\s*true/.test(ed), false, "the day editor never claims - a manual pick onto a not-offered day goes through the Override panel");
      assert.strictEqual((src.match(/eligibility\([^;\n]*claim: true/g) || []).length, 3, "exactly three claim call sites: the painter, the board gate, the trade path");
    });
    check("U3c pins: My schedule marks each upcoming assignment inside a period the person submitted for as offered / outside the offers (mine-offer-tag, from offerState on the app ctx) and each My-offers pill says when the day is already placed (data-placed)", () => {
      const ms = src.slice(src.indexOf("{/* ================ MY SCHEDULE (Prompt 6 Slice G) ================ */}"), src.indexOf("{/* ================ TIME OFF & TRADES (Prompt 6 Slice G) ================ */}"));
      assert.ok(ms.length > 3000, "My schedule block not found");
      assert.ok(ms.includes("const offerTagOf = (d, role) => {") && ms.includes("const st = rulesCtx ? offerState(rulesCtx, d, pid) : null;"), "the upcoming rows read offerState on the app ctx");
      assert.ok(ms.includes('data-testid="mine-offer-tag" data-offer={t.kind}') && ms.includes('{ kind: "offered"') && ms.includes('{ kind: "outside"'), "the offered / outside chip per upcoming row");
      // review fix (minor 4): a day offered in the OTHER role only is its own chip - "offered P only" / "offered B only", never "not offered"
      assert.ok(ms.includes('if (w.kind === "offered-other") return { kind: "other-role", text: w.tag.replace("primary", "P").replace("backup", "B")'), "the other-role chip (he did offer the day) with the role spelled in the text, not only the title");
      assert.ok(ms.includes('data-testid="mine-offer" data-day={String(o.day).slice(0, 10)} data-placed={placedRole(o) || ""}'), "the My-offers pill carries data-placed");
    });
    check("U3c review pins (9/23): the day editor's Offers line lists an INACTIVE surgeon only while he holds a slot in the draft (the dropdown pool's rule) - the memo depends on draft", () => {
      const ed = src.slice(src.indexOf("\nfunction DayEditor("), src.indexOf("// ===================== SETUP VIEW COMPONENTS"));
      assert.ok(ed.includes('.filter(s => s.type !== "external").filter(s => s.active !== false || s.id === draft.primary || s.id === draft.backup).forEach(s => {'), "the offers line filters inactive surgeons unless they hold the draft's slot");
      assert.ok(ed.includes("    return period ? { period, items } : null;\n  }, [ctx, day, roster, draft]);"), "the offerInfo memo depends on draft");
    });
    // U3c review (major): offers-first is only true when call_offers / call_periods were actually READ. The verdict
    // is plain JS at module scope; lifted and run here, then pinned to loadOffers / loadPeriods / runGenerate.
    const olvSrc = (() => { const a = src.indexOf("\nfunction offersLoadVerdict("); if (a < 0) return null; const b = src.indexOf("\n}\n", a); return src.slice(a, b + 3); })();
    check("U3c review (major): offersLoadVerdict refuses while either table was never read this session (unread / skipped / failed), says 'stale' when both were read once but the latest refresh was skipped or failed, 'ok' when both reads are current", () => {
      assert.ok(olvSrc, "no module-scope offersLoadVerdict in index-source.html");
      const fn = new Function(olvSrc + "\nreturn offersLoadVerdict;")();
      const t = "2026-09-23T20:15:00.000Z";
      assert.strictEqual(fn(null).verdict, "refuse");
      assert.strictEqual(fn({ offers: "unread", periods: "unread", offersOkAt: null, periodsOkAt: null }).verdict, "refuse");
      const skippedBoth = fn({ offers: "skipped", periods: "skipped", offersOkAt: null, periodsOkAt: null });
      assert.strictEqual(skippedBoth.verdict, "refuse");
      assert.strictEqual(skippedBoth.why, "call_offers not read (session token missing or expired); call_periods not read (session token missing or expired)");
      const oneNever = fn({ offers: "ok", periods: "failed", offersOkAt: t, periodsOkAt: null });
      assert.strictEqual(oneNever.verdict, "refuse");
      assert.strictEqual(oneNever.why, "call_periods failed to load");
      assert.strictEqual(fn({ offers: "ok", periods: "unread", offersOkAt: t, periodsOkAt: null }).why, "call_periods not loaded yet");
      assert.deepStrictEqual(fn({ offers: "ok", periods: "ok", offersOkAt: t, periodsOkAt: t }), { verdict: "ok" });
      const stale = fn({ offers: "skipped", periods: "ok", offersOkAt: t, periodsOkAt: t });
      assert.strictEqual(stale.verdict, "stale");
      assert.strictEqual(stale.why, "call_offers last read 2026-09-23 20:15 UTC, the latest refresh was skipped (session token missing or expired)");
      const staleBoth = fn({ offers: "skipped", periods: "failed", offersOkAt: t, periodsOkAt: t });
      assert.strictEqual(staleBoth.verdict, "stale");
      assert.ok(/^call_offers last read .* was skipped \(session token missing or expired\); call_periods last read .* the latest refresh failed$/.test(staleBoth.why), staleBoth.why);
    });
    check("U3c review pins (major): loadOffers / loadPeriods record ok / skipped / failed per table (offersLoad, with the first-ok time); runGenerate consults offersLoadVerdict BEFORE it builds the ctx - 'refuse' toasts and returns (nothing run), 'stale' stamps previewGen.offersStale; the preview header shows the red warning and Accept & Publish confirms it; 'Generate this period' shares the path", () => {
      assert.ok(src.includes('const [offersLoad, setOffersLoad] = useState({ offers: "unread", periods: "unread", offersOkAt: null, periodsOkAt: null });'), "the load state");
      assert.ok(src.includes('const markOffersLoad = (table, outcome) => setOffersLoad(s => ({ ...s, [table]: outcome, ...(outcome === "ok" ? { [table + "OkAt"]: new Date().toISOString() } : {}) }));'), "markOffersLoad stamps the first-ok time");
      assert.ok(src.includes('      if (rows) setOfferRows(rows);\n      markOffersLoad("offers", rows ? "ok" : "skipped");') && src.includes('      console.warn("call_offers load failed", e);\n      markOffersLoad("offers", "failed");'), "loadOffers records ok / skipped (null from readAuthOnlyTable) / failed (threw)");
      assert.ok(src.includes('      if (rows) setPeriodRows(rows);\n      markOffersLoad("periods", rows ? "ok" : "skipped");') && src.includes('      console.warn("call_periods load failed", e);\n      markOffersLoad("periods", "failed");'), "loadPeriods records ok / skipped / failed");
      const rg = src.slice(src.indexOf("  const runGenerate = async (o) => {"), src.indexOf("  const rerollGenerate = () => {"));
      assert.ok(rg.length > 500, "runGenerate not found");
      const iVerdict = rg.indexOf("const ov = offersLoadVerdict(offersLoad);"), iBusy = rg.indexOf("setGenBusy(true);"), iBuild = rg.indexOf("safeBuildContext(");
      assert.ok(iVerdict > 0 && iVerdict < iBusy && iBusy < iBuild, "the verdict is read before the busy flag and the ctx build");
      assert.ok(rg.includes('if (ov.verdict === "refuse") { showToast("Not run: the offers and periods were not loaded (" + ov.why + "), so this run would place nobody\'s offered days first. Sign in again or reload, wait for the load, then generate. Nothing was run.", "error"); return; }'), "refuse = toast + return, nothing run");
      assert.ok(rg.includes('const offersStale = ov.verdict === "stale" ? ov.why : null;') && rg.includes("ranAt: new Date().toISOString(), ms, offersStale });"), "stale rides on previewGen.offersStale");
      assert.ok(rg.includes('WARNING: the offers may be stale (" + offersStale + ") - sign in again and re-run before accepting.'), "the run toast warns");
      assert.ok(src.includes('{preview.offersStale && <span data-testid="gen-preview-offers-warning" role="alert"'), "the preview header shows the warning");
      assert.ok(src.includes("if (!pv.respectLocks || lockedChanges.length || heldChanges.length || pv.offersStale) {") && src.includes("const staleText = pv.offersStale ? `WARNING - this preview was generated while the offers may have been STALE (${pv.offersStale}); offered days may not have been placed first. Sign in again and re-run to be sure.\\n\\n` : \"\";"), "Accept & Publish forces the confirm and names the stale offers");
      assert.ok(src.includes("    runGenerate({ ...genOpts, start, end });\n  };") && !/const generatePeriod = [\s\S]*?safeBuildContext/.test(src.slice(src.indexOf("const generatePeriod ="), src.indexOf("const generatePeriod =") + 600)), "'Generate this period' goes through runGenerate (one gate)");
    });
  }

  /* ---------------- G. Prompt 16 A2: invite-only sign-in; GoTrue's error hash / query reads as ONE message ---------------- */
  console.log("\n[A2] Prompt 16 A2 (invite-only sign-in card, expired-link message)");
  {
    const A2_MSG = "This invite or reset link has expired or was already used - ask the scheduler for a new invite, or use Forgot your password.";
    check("authLinkError: the hash form (#error=...&error_code=otp_expired&error_description=...) reads as the one message, with the code and the decoded description, from 'hash', clean search", () => {
      const r = H.authLinkError("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired", "");
      assert.deepStrictEqual(r, { message: A2_MSG, code: "otp_expired", description: "Email link is invalid or has expired", from: "hash", cleanSearch: "" });
      assert.strictEqual(H.AUTH_LINK_ERROR_MESSAGE, A2_MSG);
    });
    check("authLinkError: the query form (?error=...) reads as the same message from 'query'; cleanSearch drops only the three error keys and keeps the rest (?public=1)", () => {
      const r = H.authLinkError("", "?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
      assert.deepStrictEqual(r, { message: A2_MSG, code: "otp_expired", description: "Email link is invalid or has expired", from: "query", cleanSearch: "" });
      const keep = H.authLinkError("", "?public=1&error=access_denied&error_code=otp_expired");
      assert.strictEqual(keep.message, A2_MSG);
      assert.strictEqual(keep.cleanSearch, "?public=1");
      // GoTrue's older shapes: an error without a code, a code without an error - both are the message
      assert.strictEqual(H.authLinkError("#error=access_denied", "").code, "access_denied");
      assert.strictEqual(H.authLinkError("", "?error_code=otp_expired").code, "otp_expired");
      // the hash wins when both carry an error (one message, one parse)
      assert.strictEqual(H.authLinkError("#error=access_denied&error_code=otp_expired", "?error=x").from, "hash");
    });
    check("authLinkError: the success hash (#access_token=...&type=recovery|invite), the app's own deep links (#openshifts, #offers, ?public=1), an empty URL and non-strings are NOT errors (null)", () => {
      assert.strictEqual(H.authLinkError("#access_token=abc&refresh_token=def&type=recovery", ""), null);
      assert.strictEqual(H.authLinkError("#access_token=abc&type=invite", "?public=1"), null);
      for (const h of ["", "#", "?", "#openshifts", "#offers", "?public=1", "#error", "?error="]) {
        assert.strictEqual(H.authLinkError(h, ""), null, JSON.stringify(h) + " as hash");
        assert.strictEqual(H.authLinkError("", h), null, JSON.stringify(h) + " as search");
      }
      assert.strictEqual(H.authLinkError(null, undefined), null);
      assert.strictEqual(H.authLinkError({}, 42), null);
    });
    check("A2 pins: the sign-in card has no sign-up path - no 'Sign up' / 'Create account' / \"signup\" mode / auth.signUp call in index-source.html; config.js carries no signUp helper and no auth/v1/signup; 'Forgot your password?' stays (once)", () => {
      assert.strictEqual(count("Sign up"), 0, "'Sign up' text");
      assert.strictEqual(count("Create account"), 0, "'Create account' button");
      assert.strictEqual(count("Create your account"), 0, "'Create your account' subtitle");
      assert.strictEqual(count('"signup"'), 0, "the signup authMode");
      assert.strictEqual(count("auth.signUp("), 0, "auth.signUp call");
      assert.strictEqual(count('const [authMode, setAuthMode] = useState("login");     // "login" | "reset" | "newpassword"'), 1, "the authMode comment names the three remaining modes");
      const cfg = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
      assert.ok(!cfg.includes("signUp(") && !cfg.includes("/auth/v1/signup"), "config.js still has the signUp helper");
      assert.strictEqual(count("Forgot your password?</button>"), 1, "the forgot-password link");
    });
    check("A2 pins: the mount effect reads authLinkError(hash, search) BEFORE the success-hash branch, cleans the URL with replaceState(pathname + cleanSearch), and shows the message once - on the card when signed out or when the stored session turns out dead, as a toast only once a stored session signs the person in or waits on biometrics; the card error carries data-testid auth-error", () => {
      const start = src.indexOf("  // --- Auth: Check session on mount ---");
      assert.ok(start > 0, "mount effect not found");
      const eff = src.slice(start, start + 3500);
      const iErr = eff.indexOf("const linkErr = authLinkError(window.location.hash, window.location.search);");
      const iOk = eff.indexOf('if (hash && (hash.includes("type=recovery") || hash.includes("type=invite"))) {');
      assert.ok(iErr > 0, "authLinkError not read in the mount effect");
      assert.ok(iOk > iErr, "the error parse must precede the success-hash branch");
      assert.strictEqual(count("const linkErr = authLinkError("), 1, "one parse site");
      assert.ok(eff.includes('window.history.replaceState(null, "", window.location.pathname + linkErr.cleanSearch);'), "the URL is cleaned with cleanSearch");
      assert.ok(eff.includes("if (!auth.getSession()) setAuthError(linkErr.message);"), "signed out: the card carries the message at once");
      assert.ok(!eff.includes('if (auth.getSession()) showToast(linkErr.message, "error");'), "the toast must not fire at mount on a stored session that may be dead (Loading spinner, then a card with no message)");
      const iBio = eff.indexOf("if (bioEnrolled && session) {");
      const iLive = eff.indexOf("if (user) { if (linkErr) showToast(linkErr.message, \"error\"); await adoptSignedInUser(user); }");
      const iDead = eff.indexOf("else if (linkErr) setAuthError(linkErr.message);");
      assert.ok(iBio > 0 && eff.slice(iBio, iBio + 200).includes('if (linkErr) showToast(linkErr.message, "error");'), "biometric wait: the toast (the tile renders, not the card)");
      assert.ok(iLive > iBio, "live session: the toast, then adoptSignedInUser");
      assert.ok(iDead > iLive && iDead - iLive < 300, "dead session (getUser returned no user): the card that follows carries the message");
      assert.strictEqual(count("showToast(linkErr.message"), 2, "two toast sites (biometric wait, live session), none at mount");
      assert.strictEqual(count("setAuthError(linkErr.message)"), 2, "two card sites (signed out, dead session)");
      assert.strictEqual(count('data-testid="auth-error"'), 1, "the card error testid");
    });
  }

  /* ---------------- H. Prompt 16 A3: session lifecycle - ensureFresh / authFetch / sessionExpired ---------------- */
  console.log("\n[A3] Prompt 16 A3 (session lifecycle: refresh before writes, one 401 retry, the expired banner)");
  {
    const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    const jwt = (expInSec, tag) => `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub: "u1", role: "authenticated", exp: Math.floor(Date.now() / 1000) + expInSec, jti: tag })}.sig`;
    const FRESH = jwt(3600, "fresh"), SOON = jwt(60, "soon"), DEAD = jwt(-3600, "dead"), NEW1 = jwt(3600, "new1"), NEW2 = jwt(3600, "new2"), NEW3 = jwt(3600, "new3"), NEW4 = jwt(3600, "new4");
    const store = sandbox.localStorage;
    const setSession = (tok, ref) => { store._m = {}; if (tok) store.setItem("silvis-auth-token", tok); if (ref) store.setItem("silvis-auth-refresh", ref); };
    const bearerOf = (opts) => String((opts && opts.headers && (opts.headers.Authorization || opts.headers.authorization)) || "").replace(/^Bearer /, "");
    const tokenBody = (tok, ref) => ({ access_token: tok, refresh_token: ref, token_type: "bearer", expires_in: 3600, user: { id: "u1" } });
    const rtAuth = [], events = [], a3calls = [];
    let A3 = null;
    // fetch stub: records { url, method, bearer, body }; `answer(call)` decides the response, and may throw for a network error
    let answer = () => resp(200, []);
    sandbox.__fetch = async (url, opts) => { const c = { url: String(url), method: (opts && opts.method) || "GET", bearer: bearerOf(opts), body: opts && opts.body ? JSON.parse(opts.body) : null }; a3calls.push(c); return answer(c); };
    const isRefresh = (c) => c.method === "POST" && c.url.includes("/auth/v1/token?grant_type=refresh_token");
    const need = () => { if (!A3) throw new Error("the A3 sandbox exports are missing (auth.ensureFresh / authFetch not implemented)"); };
    const acheck = async (name, fn) => { try { need(); await fn(); pass++; console.log("ok   " + name); } catch (e) { fail++; console.log("FAIL " + name + "\n     -> " + (e && e.message ? e.message : e)); } };
    let rtCreate = null; // { url, key, opts } of the createClient call
    check("A3: config.js exposes auth.ensureFresh / auth.onSessionChange / auth.applyRealtimeAuth / auth.sessionExpired and authFetch; getSupabaseRT hands the FRESH stored token to realtime.setAuth when it creates the client", () => {
      sandbox._supabaseSDK = { createClient: (url, key, opts) => { rtCreate = { url, key, opts }; return { realtime: { setAuth: (t) => { rtAuth.push(t); return Promise.resolve(); } } }; } };
      setSession(FRESH, "r0");
      A3 = vm.runInContext("({ auth, db, authFetch, supabase, getSupabaseRT, dbAuthHeaders })", sandbox);
      assert.strictEqual(typeof A3.auth.ensureFresh, "function", "auth.ensureFresh");
      assert.strictEqual(typeof A3.auth.onSessionChange, "function", "auth.onSessionChange");
      assert.strictEqual(typeof A3.auth.applyRealtimeAuth, "function", "auth.applyRealtimeAuth");
      assert.strictEqual(A3.auth.sessionExpired, false, "sessionExpired starts false");
      assert.strictEqual(typeof A3.authFetch, "function", "authFetch");
      assert.ok(A3.getSupabaseRT(), "the realtime client is created once the SDK is present");
      assert.deepStrictEqual(rtAuth, [FRESH], "realtime.setAuth(<stored fresh token>) at client creation");
      A3.auth.onSessionChange((k) => events.push(k));
    });
    // The 9/23 review of A3: supabase-js 2.x re-pulls the Realtime token from the client's `accessToken` callback on
    // connect / heartbeat / channel join and falls back to the anon key without one - a bare realtime.setAuth() is
    // overwritten on the next heartbeat. The client must be created with that callback, answering the stored token
    // while it is fresh and null (-> anon, the SDK's own fallback) once it is not.
    await acheck("A3 realtime: createClient carries the third-party-auth `accessToken` callback - it answers the stored FRESH token, null for an expired / missing one - and neither config.js nor the app ever touches the client's (throwing) `.auth`", async () => {
      assert.ok(rtCreate && rtCreate.opts && typeof rtCreate.opts.accessToken === "function", "createClient(url, key, { accessToken: async () => ... })");
      assert.ok(rtCreate.opts.auth && rtCreate.opts.auth.persistSession === false && rtCreate.opts.auth.autoRefreshToken === false, "the SDK's own auth stays off (no persisted session, no SDK refresh): " + JSON.stringify(rtCreate.opts.auth));
      setSession(FRESH, "r0");
      assert.strictEqual(await rtCreate.opts.accessToken(), FRESH, "fresh stored token -> the token");
      setSession(DEAD, "r0");
      assert.strictEqual(await rtCreate.opts.accessToken(), null, "expired stored token -> null (anon)");
      setSession(null, null);
      assert.strictEqual(await rtCreate.opts.accessToken(), null, "no session -> null");
      setSession(FRESH, "r0");
      const cfg = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
      assert.strictEqual((cfg.match(/_supabaseRT\.auth\b|getSupabaseRT\(\)\.auth\b|\brt\.auth\b/g) || []).length, 0, "config.js never reads the realtime client's .auth");
      assert.strictEqual((src.match(/rtClient\.auth\b|getSupabaseRT\(\)\.auth\b|_supabaseRT\.auth\b/g) || []).length, 0, "index-source.html never reads the realtime client's .auth");
      assert.ok(cfg.includes("accessToken: async () => { try { const s = auth.getSession(); return (s && s.access_token && jwtIsFresh(s.access_token)) ? s.access_token : null; } catch (e) { return null; } },"), "the callback reads the stored session through auth.getSession() + jwtIsFresh");
    });
    await acheck("A3 ensureFresh: a token with an hour left is fresh - no request, { ok: true, expired: false, refreshed: false }", async () => {
      setSession(FRESH, "r0"); a3calls.length = 0;
      const r = await A3.auth.ensureFresh();
      assert.deepStrictEqual({ ok: r.ok, expired: r.expired, refreshed: r.refreshed }, { ok: true, expired: false, refreshed: false });
      assert.strictEqual(a3calls.length, 0, "no fetch");
    });
    await acheck("A3 ensureFresh: a token that expires within the refresh window (60 s left) is refreshed through auth/v1/token?grant_type=refresh_token; the new pair is stored, dbAuthHeaders() carries it, realtime.setAuth gets it, { ok: true, refreshed: true }", async () => {
      setSession(SOON, "r1"); a3calls.length = 0; rtAuth.length = 0;
      answer = (c) => isRefresh(c) ? resp(200, tokenBody(NEW1, "r2")) : resp(500, "unexpected");
      const r = await A3.auth.ensureFresh();
      assert.deepStrictEqual({ ok: r.ok, expired: r.expired, refreshed: r.refreshed }, { ok: true, expired: false, refreshed: true });
      assert.strictEqual(a3calls.length, 1, "exactly one request");
      assert.ok(isRefresh(a3calls[0]) && a3calls[0].body.refresh_token === "r1", "POST grant_type=refresh_token with the stored refresh token");
      assert.strictEqual(store.getItem("silvis-auth-token"), NEW1, "the new access token is stored");
      assert.strictEqual(store.getItem("silvis-auth-refresh"), "r2", "the new refresh token is stored");
      assert.strictEqual(A3.dbAuthHeaders().Authorization, "Bearer " + NEW1, "dbAuthHeaders reads the new token");
      assert.deepStrictEqual(rtAuth, [NEW1], "realtime.setAuth(new token) after the refresh");
      assert.strictEqual(A3.auth.sessionExpired, false);
    });
    await acheck("A3 ensureFresh: a rejected refresh (HTTP 400) sets sessionExpired ONCE (one 'expired' event), keeps the dead token in storage so a write still fails loudly, and a second call makes NO further request", async () => {
      setSession(DEAD, "r3"); a3calls.length = 0; events.length = 0;
      answer = (c) => isRefresh(c) ? resp(400, { error: "invalid_grant", error_description: "Invalid Refresh Token: Refresh Token Not Found" }) : resp(500, "unexpected");
      const r = await A3.auth.ensureFresh();
      assert.deepStrictEqual({ ok: r.ok, expired: r.expired }, { ok: false, expired: true });
      assert.strictEqual(A3.auth.sessionExpired, true, "sessionExpired set");
      assert.deepStrictEqual(events, ["expired"], "one 'expired' event");
      assert.strictEqual(store.getItem("silvis-auth-token"), DEAD, "the dead token stays (dbAuthHeaders keeps sending it - a dead write 401s loudly, never anon)");
      assert.strictEqual(a3calls.filter(isRefresh).length, 1);
      const r2 = await A3.auth.ensureFresh();
      assert.deepStrictEqual({ ok: r2.ok, expired: r2.expired }, { ok: false, expired: true });
      assert.strictEqual(a3calls.filter(isRefresh).length, 1, "the same dead pair is not retried");
      assert.deepStrictEqual(events, ["expired"], "still one event");
    });
    await acheck("A3 ensureFresh: a NETWORK error during the refresh is not an expiry - { ok: false, expired: false }, sessionExpired false, session kept", async () => {
      setSession(SOON, "r4"); a3calls.length = 0; events.length = 0;
      answer = (c) => { if (isRefresh(c)) throw new TypeError("Failed to fetch"); return resp(500, "unexpected"); };
      const r = await A3.auth.ensureFresh();
      assert.deepStrictEqual({ ok: r.ok, expired: r.expired }, { ok: false, expired: false });
      assert.strictEqual(A3.auth.sessionExpired, false, "a new pair in storage cleared the earlier flag, and a network error does not raise it");
      assert.strictEqual(store.getItem("silvis-auth-token"), SOON, "session kept");
      assert.ok(events.includes("restored") && !events.includes("expired"), "events: " + JSON.stringify(events));
    });
    await acheck("A3 authFetch (db.insert): a 401 on a fresh-looking token -> ONE refresh + ONE retry of the same request with the new bearer; the caller sees the 2xx result", async () => {
      setSession(FRESH, "r5"); a3calls.length = 0; rtAuth.length = 0; events.length = 0;
      answer = (c) => {
        if (isRefresh(c)) return resp(200, tokenBody(NEW2, "r6"));
        if (c.url.endsWith("/rest/v1/notifications") && c.method === "POST") return c.bearer === NEW2 ? resp(201, [{ id: 7, message: "hi" }]) : resp(401, { code: "PGRST301", message: "JWT expired" });
        return resp(500, "unexpected");
      };
      const r = await A3.db.insert("notifications", { message: "hi" });
      assert.strictEqual(r.error, null, "the retry's 201 is the result: " + JSON.stringify(r));
      assert.strictEqual(r.data && r.data.id, 7);
      assert.deepStrictEqual(a3calls.map(c => (isRefresh(c) ? "refresh" : c.method + " " + c.bearer.slice(-8))), ["POST " + FRESH.slice(-8), "refresh", "POST " + NEW2.slice(-8)], "insert(401) -> refresh -> insert once more with the new token");
      assert.strictEqual(a3calls[2].body.message, "hi", "the retry carries the same body");
      assert.deepStrictEqual(rtAuth, [NEW2], "realtime.setAuth after the refresh");
      assert.strictEqual(A3.auth.sessionExpired, false);
    });
    await acheck("A3 authFetch (db.insert): a 401 whose refresh is rejected -> the 401 is returned to the caller (error carries status 401), sessionExpired set once, and a second write neither refreshes again nor retries", async () => {
      setSession(FRESH, "r7"); a3calls.length = 0; events.length = 0;
      answer = (c) => isRefresh(c) ? resp(400, { error: "invalid_grant" }) : resp(401, { code: "PGRST301", message: "JWT expired" });
      const r = await A3.db.insert("notifications", { message: "x" });
      assert.strictEqual(r.data, null);
      assert.strictEqual(r.error && r.error.message, "JWT expired");
      assert.deepStrictEqual(a3calls.map(c => (isRefresh(c) ? "refresh" : c.method)), ["POST", "refresh"], "one write, one refresh, NO retry after a rejected refresh");
      assert.strictEqual(A3.auth.sessionExpired, true);
      assert.deepStrictEqual(events, ["expired"], "flagged once");
      a3calls.length = 0;
      const r2 = await A3.db.update("notifications", 1, { read: true });
      assert.ok(r2.error, "the second write fails loudly too");
      assert.deepStrictEqual(a3calls.map(c => (isRefresh(c) ? "refresh" : c.method)), ["PATCH"], "no further refresh attempt, no retry");
      assert.deepStrictEqual(events, ["expired"], "still one event");
    });
    await acheck("A3 authFetch (supabase.upsert): the refresh runs BEFORE the write when the stored token is inside the window - the request goes out with the new bearer and no 401 happens", async () => {
      setSession(SOON, "r8"); a3calls.length = 0;
      answer = (c) => isRefresh(c) ? resp(200, tokenBody(NEW3, "r9")) : (c.bearer === NEW3 ? resp(201, []) : resp(401, { message: "JWT expired" }));
      const r = await A3.supabase.from("call_schedule_data").upsert({ id: "main" });
      assert.strictEqual(r.error, null, JSON.stringify(r));
      assert.deepStrictEqual(a3calls.map(c => (isRefresh(c) ? "refresh" : c.method + " " + c.bearer.slice(-8))), ["refresh", "POST " + NEW3.slice(-8)], "refresh first, then the write with the new token");
    });
    await acheck("A3 sign-in: auth.signIn stores the pair, clears sessionExpired ('restored' event) and hands the token to realtime.setAuth (the recovery / invite hash path goes through the same _saveSession)", async () => {
      A3.auth.sessionExpired = true; a3calls.length = 0; rtAuth.length = 0; events.length = 0;
      answer = (c) => c.url.includes("/auth/v1/token?grant_type=password") ? resp(200, tokenBody(NEW4, "r10")) : resp(500, "unexpected");
      const r = await A3.auth.signIn("someone@example.com", "pw");
      assert.strictEqual(r.error, null);
      assert.strictEqual(store.getItem("silvis-auth-token"), NEW4);
      assert.deepStrictEqual(rtAuth, [NEW4], "realtime.setAuth after sign-in");
      assert.strictEqual(A3.auth.sessionExpired, false);
      assert.deepStrictEqual(events, ["restored"]);
      rtAuth.length = 0;
      A3.auth.applyRealtimeAuth();
      assert.deepStrictEqual(rtAuth, [NEW4], "applyRealtimeAuth() re-applies the stored token (biometric unlock: no new pair, the same token)");
    });
    // The 9/23 review of A3 (minor): getUser (mount / biometric unlock) and ensureFresh (the first refreshAll fires
    // within a second of the mount) started together must share ONE refresh request - two POSTs of the same refresh
    // token outside GoTrue's reuse interval revoke the token family.
    await acheck("A3 single flight: auth.getUser() (user GET answers 403) and auth.ensureFresh() started together make ONE grant_type=refresh_token request; both see the new pair; a rejected shared refresh still clears the session for getUser", async () => {
      const NEW5 = jwt(3600, "new5");
      setSession(DEAD, "r11"); a3calls.length = 0; events.length = 0;
      answer = (c) => {
        if (isRefresh(c)) return new Promise(r => setTimeout(() => r(resp(200, tokenBody(NEW5, "r12"))), 30)); // in flight long enough for the second caller to join
        if (c.url.includes("/auth/v1/user")) return resp(403, { message: "invalid claim" });
        return resp(500, "unexpected");
      };
      const [gu, ef] = await Promise.all([A3.auth.getUser(), A3.auth.ensureFresh()]);
      assert.strictEqual(a3calls.filter(isRefresh).length, 1, "exactly one refresh request: " + JSON.stringify(a3calls.map(c => c.method + " " + c.url.split("/auth/v1/")[1])));
      assert.ok(gu && gu.user && gu.user.id === "u1", "getUser resolved the refreshed user: " + JSON.stringify(gu));
      assert.deepStrictEqual({ ok: ef.ok, refreshed: ef.refreshed }, { ok: true, refreshed: true });
      assert.strictEqual(store.getItem("silvis-auth-token"), NEW5, "the new pair is stored once");
      assert.strictEqual(A3.auth.sessionExpired, false);
      // the shared request with keepOnReject: getUser keeps its clear-on-reject contract (the sign-in card follows)
      setSession(DEAD, "r13"); a3calls.length = 0;
      answer = (c) => isRefresh(c) ? resp(400, { error: "invalid_grant" }) : c.url.includes("/auth/v1/user") ? resp(403, {}) : resp(500, "unexpected");
      const gu2 = await A3.auth.getUser();
      assert.ok(gu2 && gu2.user === null && !gu2.error, "getUser reports no user and no network error after the rejected shared refresh: " + JSON.stringify(gu2));
      assert.strictEqual(store.getItem("silvis-auth-token"), null, "getUser cleared the dead pair");
      assert.strictEqual(a3calls.filter(isRefresh).length, 1);
      setSession(FRESH, "r0"); A3.auth._setExpired(false);
    });
    // syncScheduleDaysNow lifted out of the component (the app-safety-2 harness): a 401 / 403 must NOT arm the
    // 5-second retry; the toast is skipped for a 401 while the banner is up; a 500 keeps the retry + toast.
    await (async () => {
      const start = src.indexOf("  const syncScheduleDays = (nextSchedule) => {");
      const end = src.indexOf("  const scheduleDaySyncRetry = () => {", start);
      const body = src.slice(start, end);
      const ref = (v) => ({ current: v });
      const sameAssignment = (day, a, b) => JSON.stringify(H.assignmentToDayRow(day, a || H.emptyDayAssignment())) === JSON.stringify(H.assignmentToDayRow(day, b || H.emptyDayAssignment()));
      const run = async (status, sessionExpired) => {
        const state = { toasts: [], statuses: [], retries: 0 };
        const lastSyncRef = ref({ "2026-11-02": { primary: "s1" } });
        const params = ["intentionalScheduleWipeRef", "daySyncBusyRef", "daySyncChainRef", "lastSyncRef", "dayVersionsRef", "scheduleRef", "scheduleWipeCheck", "sameAssignment", "assignmentToDayRow", "emptyDayAssignment", "postDayRow", "patchDayRow", "fetchDayRow", "setSaveError", "setSaveStatus", "showToast", "scheduleDaySyncRetry", "loadScheduleDays", "setSchedule", "userProfile", "authUser", "writeFailToast", "setTimeout", "console", "auth", "undoNoteWrite", "scheduleHistoryRef", "setHistory"];
        const fns = new Function(...params, body + "\nreturn { syncScheduleDays, syncScheduleDaysNow };")(
          ref(false), ref(0), ref(Promise.resolve()), lastSyncRef, ref({ "2026-11-02": 1 }), ref(lastSyncRef.current),
          H.scheduleWipeCheck, sameAssignment, H.assignmentToDayRow, H.emptyDayAssignment,
          async () => ({ version: 1 }), async () => ({ error: status === 401 ? "JWT expired" : status === 403 ? "row-level security" : "boom", status }), async () => null,
          () => {}, (s) => state.statuses.push(s), (m) => state.toasts.push(m), () => { state.retries++; }, async () => ({ sched: {}, vers: {} }), () => {}, null, null, (st) => "write failed " + st, () => 0, { warn: () => {} }, { sessionExpired },
          H.undoNoteWrite, ref([]), () => {});
        const r = await fns.syncScheduleDays({ "2026-11-02": { primary: "s3" } });
        return { r, state };
      };
      const e401 = await run(401, true), e401noBanner = await run(401, false), e403 = await run(403, false), e500 = await run(500, false);
      check("A3 syncScheduleDaysNow: a 401 does NOT arm the 5-second retry; with the session-expired banner up the save-error toast is skipped (never stacked); saveStatus says sign in again; the run reports the failure", () => {
        assert.strictEqual(e401.state.retries, 0, "retry armed on 401");
        assert.deepStrictEqual(e401.state.toasts, [], "toast shown beside the banner");
        assert.ok(e401.state.statuses.includes("Save failed - sign in again"), JSON.stringify(e401.state.statuses));
        assert.strictEqual(e401.r.ok, false);
      });
      check("A3 syncScheduleDaysNow: a 401 without the banner (the refresh hit a network error) toasts once, still does not re-arm and says 'will retry' - NOT 'sign in again' (no sign-in is needed; the next granted refresh re-sends it); a 403 toasts once, no retry; a 500 keeps the retry + toast", () => {
        assert.strictEqual(e401noBanner.state.retries, 0); assert.deepStrictEqual(e401noBanner.state.toasts, ["write failed 401"]);
        assert.ok(e401noBanner.state.statuses.includes("Save failed - will retry") && !e401noBanner.state.statuses.some(s => /sign in again/i.test(s)), JSON.stringify(e401noBanner.state.statuses));
        assert.strictEqual(e403.state.retries, 0); assert.deepStrictEqual(e403.state.toasts, ["write failed 403"]); assert.ok(e403.state.statuses.includes("Not saved - no permission"), JSON.stringify(e403.state.statuses));
        assert.strictEqual(e500.state.retries, 1); assert.deepStrictEqual(e500.state.toasts, ["write failed 500"]); assert.ok(e500.state.statuses.includes("Save failed - retrying"));
      });
    })();
    check("A3 pins: every listed write path goes through authFetch - postDayRow / patchDayRow, the four RPCs (claim_open_slot, apply_trade, save_offers, set_offer_mode), the send-notification and office-notifications POSTs; no bare fetch of rest/v1/rpc or of an edge-function POST remains; db.insert / update / upsert in config.js use it", () => {
      assert.strictEqual(count("authFetch(`${SUPABASE_URL}/rest/v1/schedule_days`, {"), 1, "postDayRow");
      assert.strictEqual(count("authFetch(`${SUPABASE_URL}/rest/v1/schedule_days?day=eq.${row.day}&version=eq.${ver}`, {"), 1, "patchDayRow");
      ["claim_open_slot", "apply_trade", "save_offers", "set_offer_mode"].forEach(fn => assert.strictEqual(count("authFetch(`${SUPABASE_URL}/rest/v1/rpc/" + fn + "`"), 1, fn));
      assert.strictEqual(count("fetch(`${SUPABASE_URL}/rest/v1/rpc/"), 0, "a bare fetch of an RPC remains");
      assert.strictEqual(count("authFetch(`${EDGE_FN_BASE}/send-notification`"), 1, "send-notification");
      assert.strictEqual(count("authFetch(`${EDGE_FN_BASE}/office-notifications`"), 2, "office-notifications (publish + digest)");
      assert.strictEqual(count("fetch(`${EDGE_FN_BASE}/"), 0, "a bare fetch of an edge function remains");
      const cfg = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
      assert.strictEqual((cfg.match(/await authFetch\(`\$\{SUPABASE_URL\}\/rest\/v1\/\$\{table\}/g) || []).length, 3, "db.insert, db.update and the upsert of the supabase wrapper send through authFetch");
    });
    check("A3 pins: ensureFresh runs on visibilitychange -> visible and at the top of the 60-second poll's refreshAll; adoptSignedInUser applies the token to realtime; the banner renders once (data-testid session-expired) and its button opens the sign-in card without biometric.unenroll() / reload; the re-run of the data load MERGES the table like refreshDays and re-syncs the pending days", () => {
      assert.strictEqual(count('if (document.visibilityState === "visible") auth.ensureFresh().then(r => { if (r && r.refreshed) resyncPendingRef.current("visibilitychange"); });'), 1, "the visibility handler (refresh, then re-send what a 401 left behind when it did refresh)");
      const ra = src.indexOf("const refreshAll = async () => {");
      const raHead = src.slice(ra, src.indexOf("await Promise.allSettled([", ra));
      assert.ok(ra > 0 && raHead.includes("const fr = await auth.ensureFresh();\n      if (fr && fr.refreshed) resyncPendingRef.current(\"poll\");"), "refreshAll must refresh the session before its reads and re-send the pending save after a granted refresh");
      // the re-send bridge: days through syncScheduleDays (no-op when nothing is pending), an armed payload through one more autosave run
      const rp = src.slice(src.indexOf("resyncPendingRef.current = (source) => {"), src.indexOf("// --- Flush pending save when app is backgrounded or closing ---"));
      assert.ok(rp.includes("if (isPublicMode || !loaded || loadFailedRef.current) return;") && rp.includes("syncScheduleDays(scheduleRef.current);") && rp.includes("if (pendingSaveRef.current) {") && rp.includes("setSaveTick(t => t + 1);"), "resyncPendingRef: " + rp.slice(0, 400));
      assert.ok(src.includes("}, [loaded, schedule, vacations, availabilityRows, saveTick]);") && src.includes("}, [loaded, surgeons, surgeonRules, groupRules, holidays, settings, lastPublished, lastGenerate, saveTick]);"), "saveTick is a dependency of both autosave legs (A4 split)");
      const adopt = src.slice(src.indexOf("const adoptSignedInUser = async (user) => {"), src.indexOf("// --- Auth: Check session on mount ---"));
      assert.ok(adopt.includes("auth.applyRealtimeAuth();"), "adoptSignedInUser -> realtime.setAuth (password, biometric unlock and the stored session all pass here)");
      assert.strictEqual(count('data-testid="session-expired"'), 1, "one banner");
      assert.strictEqual(count('data-testid="session-expired-signin"'), 1, "one button");
      const os = src.indexOf("const openSignInAgain = () => {");
      assert.ok(os > 0, "openSignInAgain missing");
      const handler = src.slice(os, src.indexOf("};", os));
      assert.ok(!handler.includes("biometric.unenroll") && !handler.includes("reload") && !handler.includes("auth.signOut") && !handler.includes("setSchedule"), "the banner's button must not unenroll, reload, sign out or drop data: " + handler);
      assert.ok(handler.includes("setAuthUser(null)") && handler.includes('setAuthMode("login")'), "it shows the sign-in card in place");
      assert.strictEqual(count("auth.onSessionChange("), 1, "the component subscribes to the session events once");
      assert.ok(src.includes("if (loadedAtRef.current && !switchedUserRef.current) { mergeLoadedDays(loadedDays); syncScheduleDays(scheduleRef.current); } else adoptLoadedDays(loadedDays);"), "a re-run of the data load (after a re-auth of the same account) merges and re-syncs instead of adopting the table wholesale; a different account adopts");
      // the blob leg of the re-run (9/23 review, major): the row unchanged since our last read -> keep the local state and re-fire the autosave; moved -> adopt and say so
      const legA = src.slice(src.indexOf("// Leg A - the config blob."), src.indexOf("// Leg B - the schedule itself"));
      assert.ok(legA.includes("const rerun = !!loadedAtRef.current && !switchedUserRef.current;"), "leg A knows a re-run of the same account");
      assert.ok(legA.includes("if (rerun && row.updated_at && row.updated_at === blobTsRef.current) {") && legA.includes("if (pendingSaveRef.current) setSaveTick(t => t + 1);"), "unchanged row on a re-run -> no adoptBlob, the armed payload re-fires");
      const iSkip = legA.indexOf("if (rerun && row.updated_at && row.updated_at === blobTsRef.current) {"), iAdopt = legA.indexOf("adoptBlob(d);");
      assert.ok(iSkip > 0 && iAdopt > iSkip && legA.slice(iSkip, iAdopt).includes("} else {"), "adoptBlob sits in the else branch only");
      assert.ok(legA.includes("if (rerun && isScheduler && pendingSaveRef.current) showToast("), "a moved row over an armed payload is announced");
      // the hydration window opens once; the switched-account flag is consumed at the end of the load
      assert.ok(src.includes("if (!loadedAtRef.current) loadedAtRef.current = Date.now();\n      switchedUserRef.current = false;"), "loadedAtRef is set on the FIRST load only (a re-run does not re-open the 3-s autosave window) and the switch flag is cleared");
      assert.strictEqual(count("loadedAtRef.current = Date.now()"), 1, "one place sets loadedAtRef");
      // a different account on the in-place card drops the previous account's pending edit
      const adoptFn = src.slice(src.indexOf("const adoptSignedInUser = async (user) => {"), src.indexOf("// --- Auth: Check session on mount ---"));
      assert.ok(adoptFn.includes("if (lastAuthUidRef.current && user && lastAuthUidRef.current !== user.id) {") && adoptFn.includes("switchedUserRef.current = true;") && adoptFn.includes("pendingSaveRef.current = null;") && adoptFn.includes("if (user) lastAuthUidRef.current = user.id;"), "adoptSignedInUser: " + adoptFn.slice(0, 600));
      const rd = src.slice(src.indexOf("const refreshDays = async () => {"), src.indexOf("const refreshTradeReqs = async () => {"));
      assert.ok(rd.includes("mergeLoadedDays(fresh);"), "refreshDays uses the shared merge");
      const sync = src.slice(src.indexOf("const syncScheduleDaysNow = async (nextSchedule, wipeGranted) => {"), src.indexOf("const scheduleDaySyncRetry = () => {"));
      assert.ok(sync.includes("if (r.status === 401 || r.status === 403) authFail = r.status;"), "the auth failure is tracked per write");
      const iAuthBranch = sync.indexOf("if (failed && authFail) {");
      assert.ok(iAuthBranch > 0 && iAuthBranch < sync.indexOf("scheduleDaySyncRetry();"), "the auth-failure branch (no retry) must come before the retry branch");
      assert.ok(sync.includes("if (!(authFail === 401 && auth.sessionExpired)) showToast(failMsg, \"error\");"), "the 401 toast is skipped beside the banner");
      assert.strictEqual((sync.match(/scheduleDaySyncRetry\(\);/g) || []).length, 1, "one retry site, in the non-auth branch");
      const blob = src.slice(src.indexOf("// --- Supabase: Auto-save on changes ---"), src.indexOf("// --- Flush pending save when app is backgrounded or closing ---"));
      assert.ok(blob.includes("const authFail = /401|JWT|expired/i.test(failMsg);") && blob.includes("if (!(auth.sessionExpired && authFail)) showToast("), "the blob leg's session-expired toast is skipped while the banner is up");
      assert.ok(blob.includes('authFail ? (auth.sessionExpired ? "Save failed - sign in again" : "Save failed - will retry") : "Save failed - retrying"'), "the blob leg says 'sign in again' only when the session is known dead");
    });
  }

  /* ---------------- P16 A7. the coordinator role (office users) - client gating pins + behaviour ---------------- */
  console.log("\n[P16 A7] coordinator role - client");
  {
    const src = fs.readFileSync(path.join(ROOT, "index-source.html"), "utf8").replace(/\r\n/g, "\n");
    check("A7: isCoordinator is derived from user_profiles.role beside isAdmin; canEnterForAnyone = scheduler or coordinator; the unlinked banner, the Time off card, the trade card and the Settings log read them", () => {
      assert.ok(src.includes('  const isAdmin = userProfile?.role === "admin";\n'), "isAdmin anchor");
      assert.ok(src.includes('  const isCoordinator = userProfile?.role === "coordinator";'), "isCoordinator const");
      assert.ok(src.includes("  const canEnterForAnyone = isScheduler || isCoordinator;"), "canEnterForAnyone const");
      // (B3 widened these same lines for the viewer: the anchors below are the post-B3 forms; the A7 behaviour is unchanged)
      assert.ok(src.includes("{!isPublicMode && isUnlinked && !isCoordinator && !isViewer && ("), "the unlinked banner is not shown to a coordinator (no roster link by design)");
      assert.ok(src.includes('<div style={css.cardT}>{canEnterForAnyone || isViewer ? "Vacations" : "My vacations"}</div>'), "the Time off card title reads Vacations for the office");
      assert.ok(src.includes("{!mySurgeon && !canEnterForAnyone && !isViewer ? <p style={muted}>Your account is not linked to a roster entry yet"), "the not-linked line is skipped for the office");
      assert.ok(src.includes("{!isViewer && renderVacationForm(canEnterForAnyone ? poolSurgeons : poolSurgeons.filter(s => s.id === mySurgeon))}"), "the person picker offers every active surgeon to the office");
      assert.ok(src.includes("{renderVacationList(canEnterForAnyone || isViewer ? surgeons.map(s => s.id) : [mySurgeon], !isViewer)}"), "the list shows everyone's vacations to the office (editable: allowEdit is true for every non-viewer)");
      assert.ok(src.includes("(isScheduler || ((isCoordinator || r.pid === mySurgeon) && r.vs > todayStr)) && ("), "Edit / Remove render for the office on UPCOMING rows only (review: toRemove refuses a started / past one for every non-scheduler, so the button must not offer it)");
      const tradeIife = src.slice(src.indexOf('const fromId = isScheduler ? (tradeFrom || mySurgeon || "") : (mySurgeon || "");'), src.indexOf('const fromId = isScheduler ? (tradeFrom || mySurgeon || "") : (mySurgeon || "");') + 400);
      assert.ok(/if \(isCoordinator \|\| isViewer\) return null; \/\/ Prompt 16 A7 \/ B3/.test(tradeIife), "the trades section returns null for a coordinator (no trade card)");
      assert.ok(src.includes("{(isScheduler || isCoordinator) && (\n            <Collapsible css={css} ck=\"settings_audit\""), "the Activity log card renders for the office too");
      assert.ok(src.includes('{isCoordinator ? "- your entries (vacations, offers)" : "- who changed what"}'), "the log title says whose entries the office sees");
      assert.ok(src.includes('    if (view === "settings" && isScheduler) { loadAudit(); loadSnapshots(); loadClientVersions(); }\n  }, [view]);'), "A1's scheduler effect is untouched (verify-rls 10b pins it)");
      assert.ok(src.includes('    if (view === "settings" && isCoordinator) loadAudit();\n  }, [view, isCoordinator]);'), "the coordinator's own effect loads the audit log only (no snapshots, no client versions)");
      assert.ok(!/if \(view === "settings" && isCoordinator\) \{[^}]*loadSnapshots/.test(src), "no snapshot load for a coordinator");
    });
    check("A7: the vacation write paths - addVac / toRemove / toEdit admit the office for anyone, addVac refuses a note on the SU_NOTE_DENYLIST, created_by stays person_id || profile id, the office entry's feed row names the office and no e-mail is attempted", () => {
      assert.ok(src.includes('    if (!isScheduler && !isCoordinator && vacSurgeon !== mySurgeon) { showToast("You can only enter your own vacations.", "error"); return; }'), "addVac gate");
      assert.ok(src.includes('    if (vacNote && SU_NOTE_DENYLIST.test(vacNote)) { showToast("Notes are operational only (the whole group and the shareable page read them) - leave the reason out.", "error"); return; }'), "addVac denylist");
      assert.strictEqual((src.match(/if \(!isScheduler && !isCoordinator && personId !== mySurgeon\)/g) || []).length, 2, "toRemove + toEdit gates");
      assert.ok(src.includes("        created_by: userProfile?.person_id || authUser?.id || null,"), "created_by = roster id, else the profile id (a coordinator's)");
      const toAdd = src.slice(src.indexOf("  const toAdd = async (personId, start, end, note) => {"), src.indexOf("  const deleteTimeOffRow = async (rowId) => {"));
      assert.ok(toAdd.includes('const enteredBy = actor && actor !== personId ? nameOf(actor) : (!actor && isCoordinator ? (userProfile?.display_name || "the office") : null);'), "the feed message names the office (display name) when a coordinator enters it");
      assert.ok(toAdd.includes('addNotification("vacation_logged", "Vacation logged", msg, { surgeon_id: personId, entered_by: actor || (isCoordinator ? (authUser?.id || null) : null) });'), "the feed row's entered_by carries the coordinator's profile id");
      assert.ok(toAdd.includes("      if (!isCoordinator) (async () => {\n        const ids = await schedulerIdsLoud();"), "the vacation_logged e-mail is skipped for a coordinator (send-notification answers 403 for the role)");
      assert.ok(toAdd.indexOf('logAudit("timeoff.add"') > 0 && toAdd.indexOf('logAudit("timeoff.add"') < toAdd.indexOf("if (!isCoordinator)"), "the audit row is written before the e-mail decision");
    });
    check("A7: the offers relay - the Time off view's 'Offers - enter for a surgeon' card (coordinator only) opens the painter for the picked surgeon; the sheet is relayed as the office; the commit still sends p_person and the function decides entered_by / source", () => {
      assert.ok(src.includes('  const [coordOfferPerson, setCoordOfferPerson] = useState("");'), "the picker state");
      assert.ok(src.includes('{isCoordinator && (\n            <div style={css.card} data-testid="coord-offers-card">'), "the card renders for a coordinator only");
      assert.ok(src.includes('<select data-testid="coord-offers-person" value={coordOfferPerson} onChange={e=>setCoordOfferPerson(e.target.value)}'), "the person select");
      assert.ok(src.includes('<button data-testid="coord-offers-open" disabled={!coordOfferPerson} onClick={()=>setOfferSheet({ personId: coordOfferPerson })}'), "the open button hands the picked surgeon to the one offerSheet state");
      assert.ok(src.includes("          asScheduler={(isScheduler || isCoordinator) && offerSheet.personId !== mySurgeon}\n          relayWord={isCoordinator ? \"the office\" : \"the scheduler\"}\n          isScheduler={isScheduler}"), "the sheet is opened as a relay for the office, with isScheduler=false (frozen periods stay frozen)");
      assert.ok(src.includes("function OfferPainterSheet({ css, dk, person, asScheduler, relayWord, isScheduler,"), "the sheet takes relayWord");
      assert.ok(src.includes('as {relayWord || "the scheduler"} (relayed)'), "the header names the relay");
      assert.ok(src.includes("body: JSON.stringify({ p_person: personId, p_rows: rows, p_clear: diff.delete, p_period: withMode ? period.id : null, p_mode: withMode ? mode : null })"), "commitOffersPaint is unchanged: p_person, nothing about entered_by / source");
      assert.ok(!/entered_by:\s*(authUser|userProfile)/.test(src.slice(src.indexOf("const commitOffersPaint"), src.indexOf("const commitOffersPaint") + 3000)), "the client never stamps entered_by on an offer");
    });
    check("A7: Setup -> Users offers the coordinator role and refuses a linked coordinator; the roster-link placeholder names both unlinked roles", () => {
      assert.ok(src.includes('{["viewer", "surgeon", "coordinator", "scheduler", "admin"].map(r => <option key={r} value={r}>{r}</option>)}'), "the role select lists coordinator");
      assert.ok(src.includes('<option value="">none (viewer / coordinator)</option>'), "the roster-link placeholder");
      const sup = src.slice(src.indexOf("  const saveUserProfile = async (p, patch) => {"), src.indexOf("  const saveUserProfile = async (p, patch) => {") + 2200);
      assert.ok(sup.includes("const nextRole = patch.role || p.role, nextPerson = patch.person_id !== undefined ? patch.person_id : p.person_id;"), "the next role / link are computed from the patch over the row");
      assert.ok(sup.includes('if (nextRole === "coordinator" && nextPerson) { showToast("Refused: a coordinator (office account) is never linked to a roster id - set the roster link to none first.", "error"); return false; }'), "a linked coordinator is refused client-side (the DB check constraint refuses it too)");
      assert.ok(sup.indexOf("nextRole === \"coordinator\"") < sup.indexOf("method: \"PATCH\""), "the refusal runs before the PATCH");
    });
    check("A7 behaviour: logAudit's actor fields for a coordinator session = actor_id the profile id, actor_name the display name (what audit_insert's coordinator clause requires); a linked surgeon keeps roster id + name", () => {
      const m = src.match(/actor_id: (userProfile\?\.person_id \|\| authUser\?\.id \|\| null),\n\s+actor_name: (userProfile\?\.display_name \|\| surgeons\.find\(s => s\.id === userProfile\?\.person_id\)\?\.name \|\| "Unknown"),/);
      assert.ok(m, "logAudit's two actor lines");
      const actor = new Function("userProfile", "authUser", "surgeons", "return { actor_id: " + m[1] + ", actor_name: " + m[2] + " };");
      const surgeons = [{ id: "s3", name: "Acton" }];
      assert.deepStrictEqual(actor({ id: "c0c0", person_id: null, role: "coordinator", display_name: "Office" }, { id: "c0c0" }, surgeons), { actor_id: "c0c0", actor_name: "Office" });
      assert.deepStrictEqual(actor({ id: "c0c0", person_id: null, role: "coordinator", display_name: null }, { id: "c0c0" }, surgeons), { actor_id: "c0c0", actor_name: "Unknown" });
      assert.deepStrictEqual(actor({ id: "u3", person_id: "s3", role: "surgeon", display_name: null }, { id: "u3" }, surgeons), { actor_id: "s3", actor_name: "Acton" });
    });
    check("A7 review: a coordinator's Edit / Remove are offered for upcoming vacations only (the render gate evaluated), toEdit refuses a started / past row for every non-scheduler like toRemove, and ONBOARDING says 'upcoming'", () => {
      const gate = src.match(/\{allowEdit && r\.id && (\(isScheduler \|\| \(\(isCoordinator \|\| r\.pid === mySurgeon\) && r\.vs > todayStr\)\)) && \(/);
      assert.ok(gate, "the Edit / Remove render gate");
      const shows = new Function("isScheduler", "isCoordinator", "r", "mySurgeon", "todayStr", "return " + gate[1] + ";");
      const today = "2026-09-24";
      assert.strictEqual(shows(false, true, { pid: "s3", vs: "2026-10-01" }, "", today), true, "office: upcoming row -> buttons");
      assert.strictEqual(shows(false, true, { pid: "s3", vs: "2026-09-24" }, "", today), false, "office: a row starting today -> no buttons (toRemove would refuse it)");
      assert.strictEqual(shows(false, true, { pid: "s3", vs: "2026-09-01" }, "", today), false, "office: past row -> no buttons");
      assert.strictEqual(shows(true, false, { pid: "s3", vs: "2026-09-01" }, "s1", today), true, "scheduler: every row");
      assert.strictEqual(shows(false, false, { pid: "s2", vs: "2026-10-01" }, "s2", today), true, "surgeon: own upcoming row");
      assert.strictEqual(shows(false, false, { pid: "s2", vs: "2026-10-01" }, "s3", today), false, "surgeon: someone else's row -> nothing");
      const toEdit = src.slice(src.indexOf("  const toEdit = async (personId, rowId, newStart, newEnd) => {"), src.indexOf("  // SCHEDULE STORAGE: schedule_days is the sole source."));
      assert.ok(toEdit.includes('    if (!isScheduler && !isCoordinator && personId !== mySurgeon) { showToast("You can only edit your own vacations.", "error"); return { ok: false }; }\n    const old = timeOffRows.find(r => r.id === rowId);\n    if (!isScheduler && old && String(old.start_date).slice(0, 10) <= todayStr) { showToast("That vacation has started or passed - it stays on record. Ask the scheduler if it needs to go.", "error"); return { ok: false }; }'), "toEdit refuses a started / past row for a non-scheduler (the same rule and toast as toRemove), before the conflict check and the PATCH");
      assert.strictEqual((toEdit.match(/const old = timeOffRows\.find\(r => r\.id === rowId\);/g) || []).length, 1, "old is looked up once");
      assert.ok(toEdit.indexOf("String(old.start_date)") < toEdit.indexOf('method: "PATCH"'), "the past guard runs before the PATCH");
      const onboarding = fs.readFileSync(path.join(ROOT, "docs", "ONBOARDING.md"), "utf8");
      const row = onboarding.split("\n").find(l => /^\| `coordinator`/.test(l)) || "";
      assert.ok(/\*\*any surgeon's upcoming vacation\*\*/.test(row) && /started or past/.test(row), "the ONBOARDING coordinator row says upcoming vacations (a started or past one is the scheduler's to correct): " + row.slice(0, 200));
    });
    check("A7 review: the Activity log read goes through readAuthOnlyTable (null = not read -> a visible toast, the list kept; never a silent 200 + [] from the anon fallback) for the scheduler and the coordinator alike", () => {
      const la = src.slice(src.indexOf("  const loadAudit = async () => {"), src.indexOf("  const fmtAuditTime = (iso) => {"));
      assert.ok(la.includes('const rows = await readAuthOnlyTable("audit_log", { order: "created_at.desc", limit: 150 });'), "audit_log is read through readAuthOnlyTable");
      assert.ok(!/db\.query\("audit_log"/.test(la), "no db.query on audit_log (dbReadHeaders falls back to anon: audit_read / audit_read_coord are 'to authenticated', so the read would be 200 + [])");
      assert.ok(la.includes('if (rows === null) showToast("Couldn\'t load the activity log - your session token is missing or expired. Sign in again; the list was not refreshed.", "error");\n      else setAuditEntries(rows);'), "null = not read -> toast, the current entries kept; an array is adopted");
    });
    check("A7 review: the Time off copy speaks to the office (not 'your own vacations'), and the painter's tap hint / rules toggle name the relayed surgeon instead of 'yourself' / 'My rules' when relaying", () => {
      assert.ok(src.includes("<p style={sectionNote}>{isCoordinator ? \"Enter a surgeon's vacation - no approval, the group is notified. The entry is refused if that surgeon is already published as primary or backup on any of those days (or primary the day before): they trade those shifts first. A vacation that has started stays on record (as the office you can enter, edit or remove anyone's upcoming vacation - each entry is recorded under your account; a started or past one is the scheduler's to correct).\" : <>Enter your own vacations - no approval, the group is notified."), "the coordinator's Time off note");
      assert.ok(src.includes("A vacation that has started stays on record{isScheduler ? \" (as the scheduler you can enter or remove anyone's)\" : \"\"}.</>} Notes are operational and visible to the whole group.</p>"), "the surgeon / scheduler note is unchanged");
      assert.ok(src.includes('const rangeHint = !rangeMode ? `Tap a day to offer ${brushWord(armed) === "clear" ? "nothing (clear)" : (asScheduler && person ? person.name : "yourself") + " as " + brushWord(armed)}; tap again with the same brush to clear it.`'), "the tap hint names the relayed surgeon");
      assert.ok(src.includes('{rulesOpen ? "Hide rules" : asScheduler ? "Rules" : "My rules"}'), "the rules toggle reads Rules when relaying");
    });
    check("A7 behaviour: the vacation-form gate admits the office for any surgeon and keeps refusing a surgeon for someone else (the addVac condition evaluated)", () => {
      const cond = src.match(/if \((!isScheduler && !isCoordinator && vacSurgeon !== mySurgeon)\) \{ showToast\("You can only enter your own vacations\."/);
      assert.ok(cond, "the addVac condition");
      const refused = new Function("isScheduler", "isCoordinator", "vacSurgeon", "mySurgeon", "return " + cond[1] + ";");
      assert.strictEqual(refused(false, true, "s3", ""), false, "a coordinator entering for s3 is not refused");
      assert.strictEqual(refused(false, false, "s3", "s2"), true, "a surgeon entering for someone else is refused");
      assert.strictEqual(refused(false, false, "s2", "s2"), false, "a surgeon entering for himself is not refused");
      assert.strictEqual(refused(true, false, "s3", "s1"), false, "the scheduler for anyone");
      const deny = src.match(/const SU_NOTE_DENYLIST = (\/[^\n]+\/i);/);
      assert.ok(deny, "SU_NOTE_DENYLIST literal");
      const rx = new Function("return " + deny[1] + ";")();
      assert.ok(rx.test("family trip") && !rx.test("conference"), "the denylist catches a personal reason and lets an operational note through");
    });
  }

  /* ---------------- I. Prompt 16 A4: blob autosave - split legs, content gate, CAS PATCH, reload on a lost race ---------------- */
  console.log("\n[A4] Prompt 16 A4 (blob autosave: two legs, content gate, PATCH ?id=eq.main&updated_at=eq.<seen>, reload on zero rows)");
  {
    const needH = (n) => { if (typeof H[n] !== "function") throw new Error("helpers." + n + " is missing"); };
    check("A4 helpers: blobSignature is key-order independent (jsonb reorders keys at every depth), restricted to the seven blob keys, and reads a null top-level key as absent (the local default is null where the row has no key)", () => {
      needH("blobSignature");
      const a = { roster: [{ id: "s1", name: "Khan" }], surgeonRules: { s1: { a: 1, b: { x: 1, y: 2 } } }, settings: { k: 1 }, lastPublished: null };
      const b = { lastPublished: undefined, settings: { k: 1 }, surgeonRules: { s1: { b: { y: 2, x: 1 }, a: 1 } }, roster: [{ name: "Khan", id: "s1" }], importedAt: "x" };
      assert.strictEqual(H.blobSignature(a), H.blobSignature(b));
      assert.notStrictEqual(H.blobSignature(a), H.blobSignature({ ...a, settings: { k: 2 } }));
      assert.notStrictEqual(H.blobSignature(a), H.blobSignature({ ...a, roster: [{ id: "s1", name: "Khan" }, { id: "s2" }] }), "array order counts");
      assert.notStrictEqual(H.blobSignature(a), H.blobSignature({ ...a, lastGenerate: { at: "t" } }));
      assert.strictEqual(H.blobSignature(null), H.blobSignature({}));
      assert.deepStrictEqual(H.BLOB_KEYS, ["roster", "surgeonRules", "groupRules", "holidays", "settings", "lastPublished", "lastGenerate"]);
    });
    check("A4 helpers: adoptBlobState mirrors adoptBlob field by field - an empty / non-array roster and a non-object settings are ignored, an absent key keeps the local value, lastPublished null is adopted, a bad blob leaves local untouched, a new object comes back", () => {
      needH("adoptBlobState");
      const local = { roster: [{ id: "s1" }], surgeonRules: { s1: {} }, groupRules: { g: 1 }, holidays: ["x"], settings: { a: 1 }, lastPublished: { at: "t" }, lastGenerate: { at: "g" } };
      const next = H.adoptBlobState(local, { roster: [], settings: "no", holidays: ["y"], lastPublished: null });
      assert.deepStrictEqual(next, { ...local, holidays: ["y"], lastPublished: null });
      assert.notStrictEqual(next, local);
      assert.deepStrictEqual(H.adoptBlobState(local, null), local);
      assert.deepStrictEqual(H.adoptBlobState(local, "x"), local);
      assert.deepStrictEqual(H.adoptBlobState(local, { roster: [{ id: "s9" }], surgeonRules: { s9: {} }, groupRules: {}, settings: {}, lastGenerate: undefined }), { ...local, roster: [{ id: "s9" }], surgeonRules: { s9: {} }, groupRules: {}, settings: {} });
    });

    // The blob leg lifted out of the component (the A3 harness pattern): adoptBlob, the poll's refreshBlobRow and
    // saveBlobNow / reloadBlobAfterMiss run against a fake PostgREST row with the real CAS semantics (a PATCH whose
    // updated_at filter misses answers 200 + []; a 2xx renders the timestamptz the way PostgREST does, +00:00).
    const A4SRC = {
      adopt: src.slice(src.indexOf("  const adoptBlob = (d) => {"), src.indexOf("  // --- Supabase: Load on mount + real-time sync ---")),
      refresh: src.slice(src.indexOf("    const refreshBlobRow = async () => {"), src.indexOf("    const refreshDays = async () => {")),
      save: src.indexOf("  // --- The blob leg (Prompt 16 A4) ---") < 0 ? "" : src.slice(src.indexOf("  // --- The blob leg (Prompt 16 A4) ---"), src.indexOf("  // --- Supabase: Auto-save on changes ---")),
      // the keepalive flush's blob leg (from its comment to the flush's outer catch) - runs as a function body: its
      // top-level returns end the leg exactly as they do inside flushRef.current
      flush: src.indexOf("      // Blob leg (Prompt 16 A4): the same content gate and CAS PATCH as saveBlobNow") < 0 ? "" : src.slice(src.indexOf("      // Blob leg (Prompt 16 A4): the same content gate and CAS PATCH as saveBlobNow"), src.indexOf("    } catch (e) {\n      console.warn(`Flush pending save (${source}) error:`, e);")),
    };
    const pgTs = (iso) => String(iso).replace(/Z$/, "+00:00"); // PostgREST renders a timestamptz the app sent as ...Z with +00:00
    // the sent stamp is new Date().toISOString() at millisecond resolution: two writes inside one ms would collide, so a
    // check that models two browsers waits for the clock to advance between their writes (real ones are 60 s apart)
    const nextMs = async () => { const t = Date.now(); while (Date.now() === t) await new Promise((r) => setTimeout(r, 1)); };
    const mkDb = (data, ts) => {
      const db = { row: { id: "main", data: JSON.parse(JSON.stringify(data)), updated_by: "seed", updated_at: ts }, writes: [], gets: 0 };
      db.read = async () => { db.gets++; return { data: db.row ? { data: JSON.parse(JSON.stringify(db.row.data)), updated_at: db.row.updated_at } : null, error: null }; };
      db.fetch = async (url, init) => {
        const u = String(url), method = (init && init.method) || "GET", body = init && init.body ? JSON.parse(init.body) : null;
        const h = (init && init.headers) || {};
        const prefer = h.Prefer || h.prefer || "";
        if (method === "GET") { db.gets++; return resp(200, db.row ? [{ data: db.row.data, updated_at: db.row.updated_at }] : []); }
        db.writes.push({ url: u, method, body, prefer });
        if (method === "PATCH") {
          const m = u.match(/[?&]updated_at=(eq\.([^&]+)|is\.null)/);
          const want = m ? (m[1] === "is.null" ? null : decodeURIComponent(m[2])) : undefined;
          if (!u.includes("id=eq.main") || !db.row || (want !== undefined && want !== db.row.updated_at)) return resp(200, []);
          db.row = { ...db.row, data: body.data, updated_by: body.updated_by, updated_at: pgTs(body.updated_at) };
          return resp(200, [{ ...db.row }]);
        }
        if (method === "POST") {
          if (db.row) return resp(409, { code: "23505", message: "duplicate key" });
          db.row = { id: "main", data: body.data, updated_by: body.updated_by, updated_at: pgTs(body.updated_at) };
          return resp(201, [{ ...db.row }]);
        }
        return resp(405, "");
      };
      return db;
    };
    const blobFromBundle = (bundle) => { const b = { ...bundle }; delete b.schedule; delete b.vacations; delete b.availability; return b; };
    const mkSession = (db, who, local) => {
      const ref = (v) => ({ current: v });
      const s = { state: JSON.parse(JSON.stringify(local)), toasts: [], statuses: [], warns: [] };
      const refs = { blobTsRef: ref(null), lastBlobJsonRef: ref(null), blobLocalRef: ref(null), blobLoadedRef: ref(false), pendingSaveRef: ref(null), blobSaveChainRef: ref(Promise.resolve()), blobSaveBusyRef: ref(0) };
      s.bundle = () => ({ roster: s.state.roster, surgeonRules: s.state.surgeonRules, groupRules: s.state.groupRules, holidays: s.state.holidays, settings: s.state.settings, lastPublished: s.state.lastPublished, lastGenerate: s.state.lastGenerate, schedule: { "2026-11-02": { primary: "s1" } }, vacations: {}, availability: [] });
      refs.blobLocalRef.current = blobFromBundle(s.bundle());
      const set = (k) => (v) => { s.state[k] = v; };
      const supabaseStub = { from: () => ({ select: () => ({ eq: () => ({ single: db.read }) }) }) };
      const params = ["setSurgeons", "setSurgeonRules", "setGroupRules", "setHolidays", "setSettings", "setLastPublished", "setLastGenerate", "blobLocalRef", "lastBlobJsonRef", "adoptBlobState", "blobSignature", "supabase", "blobLoadedRef", "blobTsRef", "pendingSaveRef", "blobSaveChainRef", "blobSaveBusyRef", "blobFromBundle", "authFetch", "SUPABASE_URL", "userProfile", "showToast", "setSaveError", "setSaveStatus", "setTimeout", "console"];
      const body = A4SRC.adopt + "\n" + A4SRC.refresh + "\n" + A4SRC.save + "\nreturn { adoptBlob, refreshBlobRow, saveBlobNow, reloadBlobAfterMiss };";
      const consoleStub = { warn: (...a) => s.warns.push(a.join(" ")), error: (...a) => s.warns.push(a.join(" ")), log: () => {} };
      const fns = new Function(...params, body)(
        set("roster"), set("surgeonRules"), set("groupRules"), set("holidays"), set("settings"), set("lastPublished"), set("lastGenerate"),
        refs.blobLocalRef, refs.lastBlobJsonRef, H.adoptBlobState, H.blobSignature, supabaseStub, refs.blobLoadedRef, refs.blobTsRef, refs.pendingSaveRef, refs.blobSaveChainRef, refs.blobSaveBusyRef,
        blobFromBundle, (u, i) => db.fetch(u, i), "https://x.supabase.co", { person_id: who }, (m) => s.toasts.push(m), () => {}, (st) => s.statuses.push(st), () => 0,
        consoleStub);
      s.refs = refs; s.fns = fns;
      // the keepalive flush's blob leg for one armed payload (the tab hidden inside the debounce); fetchImpl stands in
      // for the page's fetch so a test can hold the PATCH's response
      const flushParams = ["source", "payload", "hdrs", "ts", "by", "fetch", "SUPABASE_URL", "blobFromBundle", "blobSignature", "lastBlobJsonRef", "blobSaveBusyRef", "blobSaveChainRef", "blobTsRef", "blobLocalRef", "pendingSaveRef", "reloadBlobAfterMiss", "console"];
      s.flush = (source, payload, fetchImpl) => {
        if (!A4SRC.flush) throw new Error("the keepalive flush's blob leg ('// Blob leg (Prompt 16 A4)' .. the flush's outer catch) is not in index-source.html");
        return new Function(...flushParams, A4SRC.flush)(source, payload, { "Content-Type": "application/json" }, new Date().toISOString(), who, fetchImpl || ((u, i) => db.fetch(u, i)), "https://x.supabase.co", blobFromBundle, H.blobSignature, refs.lastBlobJsonRef, refs.blobSaveBusyRef, refs.blobSaveChainRef, refs.blobTsRef, refs.blobLocalRef, refs.pendingSaveRef, fns.reloadBlobAfterMiss, consoleStub);
      };
      // the effect's run: the render has kept blobLocalRef at the current setup state, the payload is armed, the leg runs
      s.fire = async () => { refs.blobLocalRef.current = blobFromBundle(s.bundle()); const payload = s.bundle(); refs.pendingSaveRef.current = payload; return await fns.saveBlobNow(payload, "autosave"); };
      // one 60-second tick: refreshBlobRow, then the render that follows any adoption
      s.poll = async () => { await fns.refreshBlobRow(); refs.blobLocalRef.current = blobFromBundle(s.bundle()); };
      return s;
    };
    const LOCAL0 = { roster: [{ id: "s1", name: "Khan", code: "FAK" }, { id: "s3", name: "Acton", code: "BDA" }], surgeonRules: { s3: { maxConsecutiveDays: 3 } }, groupRules: { minRest: 1 }, holidays: [{ key: "thanksgiving" }], settings: { importedAt: "2026-09-23" } };
    const DEFAULTS = { roster: [{ id: "s0" }], surgeonRules: undefined, groupRules: undefined, holidays: undefined, settings: {}, lastPublished: null, lastGenerate: undefined };
    const T0 = "2026-09-23T21:26:53.975927+00:00";
    const isBlobWrite = (w) => /call_schedule_data/.test(w.url) && (w.method === "PATCH" || w.method === "POST");
    const lifted = () => { if (!A4SRC.save || !A4SRC.adopt || !A4SRC.refresh) throw new Error("the A4 blob-leg block ('// --- The blob leg (Prompt 16 A4) ---' .. the autosave effect) is not in index-source.html"); };
    const acheck4 = async (name, fn) => { try { lifted(); await fn(); pass++; console.log("ok   " + name); } catch (e) { fail++; console.log("FAIL " + name + "\n     -> " + (e && e.message ? e.message : e)); } };

    await acheck4("A4: two 60-second polls over an unchanged row write NOTHING - zero PATCH / POST of call_schedule_data across the mount read, two ticks and three effect runs; the leg reports skipped (signature equal to the adopted blob), blobTsRef holds the row's stamp and the pending payload is cleared; then ONE Setup change writes exactly once - PATCH ?id=eq.main&updated_at=eq.<last seen>, Prefer return=representation, { data (the seven keys, no schedule / vacations / availability), updated_by, updated_at } - and the returned row's stamp becomes blobTsRef", async () => {
      const db = mkDb(LOCAL0, T0);
      db.row.data = { surgeonRules: LOCAL0.surgeonRules, settings: LOCAL0.settings, roster: LOCAL0.roster, holidays: LOCAL0.holidays, groupRules: LOCAL0.groupRules }; // jsonb key order
      const s = mkSession(db, "s1", DEFAULTS);
      await s.poll();                       // the mount read adopts the row
      const r1 = await s.fire();            // where the old effect fired after the poll re-created the arrays
      await s.poll(); await s.poll();       // two ticks, the row untouched
      const r2 = await s.fire(); const r3 = await s.fire();
      assert.strictEqual(db.writes.filter(isBlobWrite).length, 0, JSON.stringify(db.writes));
      assert.ok(r1 && r1.skipped && r2 && r2.skipped && r3 && r3.skipped, JSON.stringify([r1, r2, r3]));
      assert.strictEqual(s.refs.blobTsRef.current, T0);
      assert.strictEqual(s.refs.lastBlobJsonRef.current, H.blobSignature(blobFromBundle(s.bundle())));
      assert.strictEqual(s.refs.pendingSaveRef.current, null, "an unchanged blob clears the pending payload");
      assert.deepStrictEqual(s.state.surgeonRules, LOCAL0.surgeonRules);
      // a Setup change
      s.state.surgeonRules = { s3: { maxConsecutiveDays: 4 } };
      const r4 = await s.fire();
      const w = db.writes.filter(isBlobWrite);
      assert.strictEqual(w.length, 1, "exactly one write: " + JSON.stringify(w));
      assert.strictEqual(w[0].method, "PATCH");
      assert.strictEqual(w[0].url, "https://x.supabase.co/rest/v1/call_schedule_data?id=eq.main&updated_at=eq." + encodeURIComponent(T0));
      assert.match(w[0].prefer, /return=representation/);
      assert.deepStrictEqual(Object.keys(w[0].body).sort(), ["data", "updated_at", "updated_by"]);
      assert.deepStrictEqual(Object.keys(w[0].body.data).sort(), ["groupRules", "holidays", "lastPublished", "roster", "settings", "surgeonRules"], "the seven keys minus the undefined lastGenerate - no schedule / vacations / availability");
      assert.strictEqual(w[0].body.updated_by, "s1");
      assert.ok(r4 && r4.saved, JSON.stringify(r4));
      assert.strictEqual(s.refs.blobTsRef.current, db.row.updated_at, "blobTsRef = the returned row's stamp");
      assert.notStrictEqual(s.refs.blobTsRef.current, w[0].body.updated_at, "the row's rendering (+00:00), not the sent ISO string - the poll's equality check must hold against a later GET");
      assert.strictEqual(s.refs.lastBlobJsonRef.current, H.blobSignature(blobFromBundle(s.bundle())));
      assert.strictEqual(s.refs.pendingSaveRef.current, null);
      const r5 = await s.fire(); await s.poll(); const r6 = await s.fire();
      assert.strictEqual(db.writes.filter(isBlobWrite).length, 1, "the 2xx, its poll echo and two more runs add no write");
      assert.ok(r5.skipped && r6.skipped, JSON.stringify([r5, r6]));
      assert.strictEqual(s.state.surgeonRules.s3.maxConsecutiveDays, 4, "the poll's echo did not replace the state");
      assert.deepStrictEqual(s.toasts, []);
    });
    await acheck4("A4: a zero-row answer (the row moved under us) reloads the blob - one GET, the newer copy adopted, toast 'Setup changed elsewhere - reloaded', blobTsRef = the newer stamp - and does NOT retry the write; the row is not overwritten and the next run writes nothing", async () => {
      const db = mkDb(LOCAL0, T0);
      const s = mkSession(db, "s1", DEFAULTS);
      await s.poll();
      const T9 = "2026-09-23T22:00:00.123456+00:00";
      db.row = { ...db.row, data: { ...db.row.data, holidays: [{ key: "christmas" }] }, updated_at: T9, updated_by: "s2" };
      const getsBefore = db.gets;
      s.state.settings = { importedAt: "2026-09-23", digest: true };
      const r = await s.fire();
      const w = db.writes.filter(isBlobWrite);
      assert.strictEqual(w.length, 1, JSON.stringify(w));
      assert.strictEqual(w[0].url, "https://x.supabase.co/rest/v1/call_schedule_data?id=eq.main&updated_at=eq." + encodeURIComponent(T0));
      assert.ok(r && r.reloaded && !r.saved, JSON.stringify(r));
      assert.strictEqual(db.gets - getsBefore, 1, "one reload read");
      assert.deepStrictEqual(s.state.holidays, [{ key: "christmas" }], "the newer copy is adopted");
      assert.deepStrictEqual(s.state.settings, { importedAt: "2026-09-23" }, "the server's copy replaced the local edit - nothing overwrote the newer row");
      assert.deepStrictEqual(s.toasts, ["Setup changed elsewhere - reloaded"]);
      assert.strictEqual(s.refs.blobTsRef.current, T9);
      assert.deepStrictEqual(db.row.data.holidays, [{ key: "christmas" }]);
      assert.strictEqual(db.row.updated_by, "s2", "the row was not overwritten");
      assert.strictEqual(s.refs.pendingSaveRef.current, null);
      const r2 = await s.fire();
      assert.strictEqual(db.writes.filter(isBlobWrite).length, 1, "no write follows the reload");
      assert.ok(r2 && r2.skipped, JSON.stringify(r2));
    });
    await acheck4("A4: two sessions adopting each other's blob do not ping-pong - A's Setup write, B adopts (no write), B's Setup write on the new stamp, A adopts (no write), two more ticks each: exactly two PATCHes in total, both end on the same stamp and signature, no toast", async () => {
      const db = mkDb(LOCAL0, T0);
      const A = mkSession(db, "s1", DEFAULTS), B = mkSession(db, "s1", DEFAULTS);
      await A.poll(); await B.poll();
      A.state.settings = { importedAt: "2026-09-23", digest: true };
      const a1 = await A.fire(); await nextMs();
      await B.poll();                    // B adopts A's write
      const b1 = await B.fire();         // B's effect fires on the adopted state
      B.state.holidays = [{ key: "christmas" }];
      const b2 = await B.fire(); await nextMs();
      await A.poll();
      const a2 = await A.fire(); await nextMs();
      await B.poll(); const b3 = await B.fire(); await nextMs(); await A.poll(); const a3 = await A.fire();
      const w = db.writes.filter(isBlobWrite);
      assert.strictEqual(w.length, 2, JSON.stringify(w.map(x => x.method + " " + x.url)));
      assert.ok(a1.saved && b1.skipped && b2.saved && a2.skipped && b3.skipped && a3.skipped, JSON.stringify({ a1, b1, b2, a2, b3, a3 }));
      assert.strictEqual(w[1].url, "https://x.supabase.co/rest/v1/call_schedule_data?id=eq.main&updated_at=eq." + encodeURIComponent(pgTs(w[0].body.updated_at)), "B's CAS carries the stamp A's write left");
      assert.strictEqual(A.refs.blobTsRef.current, B.refs.blobTsRef.current);
      assert.strictEqual(A.refs.lastBlobJsonRef.current, B.refs.lastBlobJsonRef.current);
      assert.deepStrictEqual(A.state.holidays, [{ key: "christmas" }]);
      assert.deepStrictEqual(B.state.settings, { importedAt: "2026-09-23", digest: true });
      assert.deepStrictEqual(A.toasts.concat(B.toasts), []);
    });
    await acheck4("A4: no 'main' row at all - the PATCH (updated_at=is.null, no stamp seen) matches nothing, the reload finds no row, and ONE POST inserts it with Prefer return=representation; stamp and signature come from the inserted row; no toast", async () => {
      const db = mkDb(LOCAL0, T0); db.row = null;
      const s = mkSession(db, "s1", DEFAULTS);
      await s.poll(); // a missing row is a successful read (blobLoadedRef true), nothing adopted
      assert.strictEqual(s.refs.blobLoadedRef.current, true);
      const r = await s.fire();
      const w = db.writes.filter(isBlobWrite);
      assert.deepStrictEqual(w.map(x => x.method), ["PATCH", "POST"], JSON.stringify(w));
      assert.match(w[0].url, /call_schedule_data\?id=eq\.main&updated_at=is\.null$/);
      assert.strictEqual(w[1].url, "https://x.supabase.co/rest/v1/call_schedule_data");
      assert.match(w[1].prefer, /return=representation/);
      assert.strictEqual(w[1].body.id, "main");
      assert.ok(r && r.saved, JSON.stringify(r));
      assert.strictEqual(s.refs.blobTsRef.current, db.row.updated_at);
      assert.strictEqual(s.refs.lastBlobJsonRef.current, H.blobSignature(blobFromBundle(s.bundle())));
      assert.deepStrictEqual(s.toasts, []);
      const r2 = await s.fire();
      assert.ok(r2 && r2.skipped); assert.strictEqual(db.writes.filter(isBlobWrite).length, 2);
    });
    await acheck4("A4: an HTTP failure of the PATCH throws 'blob save failed: HTTP <status> ...' (the effect's catch classifies it - 401 / 403 / other) and leaves stamp, signature and the pending payload alone so the next run retries", async () => {
      const db = mkDb(LOCAL0, T0);
      const s = mkSession(db, "s1", DEFAULTS);
      await s.poll();
      const realFetch = db.fetch;
      s.state.holidays = [{ key: "christmas" }];
      const sig0 = s.refs.lastBlobJsonRef.current;
      db.fetch = async (u, i) => { if (i && i.method === "PATCH") { db.writes.push({ url: String(u), method: "PATCH", body: JSON.parse(i.body), prefer: "" }); return resp(401, JSON.stringify({ code: "PGRST301", message: "JWT expired" })); } return realFetch(u, i); }; // a 401 changes no row
      let err = null;
      try { await s.fire(); } catch (e) { err = e; }
      assert.ok(err && /blob save failed: HTTP 401/.test(err.message) && /JWT expired/.test(err.message), String(err && err.message));
      assert.strictEqual(s.refs.blobTsRef.current, T0);
      assert.strictEqual(s.refs.lastBlobJsonRef.current, sig0);
      assert.ok(s.refs.pendingSaveRef.current, "the payload stays armed");
      assert.deepStrictEqual(s.toasts, [], "the effect's catch owns the toast");
      db.fetch = realFetch;
      const r = await s.fire();
      assert.ok(r && r.saved, "the next run lands it: " + JSON.stringify(r));
    });
    await acheck4("A4 (review): a CAS miss whose reloaded row already holds this payload's content (our own keepalive flush of the same edit landed first) is a SILENT save - no toast, no 'Setup reloaded' status, blobTsRef = the row's stamp, the signature recorded, the pending payload released, no second PATCH; the next run skips", async () => {
      const db = mkDb(LOCAL0, T0);
      const s = mkSession(db, "s1", DEFAULTS);
      await s.poll();
      s.state.holidays = [{ key: "christmas" }];
      const payload = s.bundle();
      // the keepalive flush of this same edit landed first: the row holds the payload under a new stamp
      await db.fetch("https://x.supabase.co/rest/v1/call_schedule_data?id=eq.main&updated_at=eq." + encodeURIComponent(T0), { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ data: blobFromBundle(payload), updated_by: "s1", updated_at: "2026-09-23T22:10:00.000Z" }) });
      assert.notStrictEqual(db.row.updated_at, T0);
      const getsBefore = db.gets;
      const r = await s.fire();               // the debounced run: its PATCH carries T0 and misses
      const w = db.writes.filter(isBlobWrite);
      assert.strictEqual(w.length, 2, "the flush's PATCH and the one miss - never a third: " + JSON.stringify(w.map(x => x.method + " " + x.url)));
      assert.strictEqual(db.gets - getsBefore, 1, "one re-read");
      assert.ok(r && r.ok && r.saved && !r.reloaded, "a silent save, not a reload: " + JSON.stringify(r));
      assert.deepStrictEqual(s.toasts, [], "no 'changed elsewhere' toast for our own content");
      assert.deepStrictEqual(s.statuses, [], "no 'Setup reloaded' status");
      assert.strictEqual(s.refs.blobTsRef.current, db.row.updated_at, "the row's stamp is adopted");
      assert.strictEqual(s.refs.lastBlobJsonRef.current, H.blobSignature(blobFromBundle(s.bundle())));
      assert.strictEqual(s.refs.pendingSaveRef.current, null);
      assert.deepStrictEqual(s.state.holidays, [{ key: "christmas" }]);
      const r2 = await s.fire();
      assert.ok(r2 && r2.skipped, JSON.stringify(r2)); assert.strictEqual(db.writes.filter(isBlobWrite).length, 2, "no write follows");
    });
    await acheck4("A4 (review): the keepalive flush and the debounced run of the SAME Setup edit do not race - the flush's CAS PATCH joins the write chain (blobSaveBusyRef / blobSaveChainRef), so a saveBlobNow that fires while the flush's response is still in flight waits for it and then skips on the signature: exactly ONE PATCH, no toast, no 'Setup reloaded', stamp = the flushed row's", async () => {
      const db = mkDb(LOCAL0, T0);
      const s = mkSession(db, "s1", DEFAULTS);
      await s.poll();
      s.state.holidays = [{ key: "christmas" }];
      const payload = s.bundle(); s.refs.blobLocalRef.current = blobFromBundle(payload); s.refs.pendingSaveRef.current = payload;
      let release; const gate = new Promise(res => { release = res; });
      const slowFetch = async (u, i) => { if (i && i.method === "PATCH") await gate; return db.fetch(u, i); }; // a real network: the response outlives the debounce
      s.flush("visibilitychange", payload, slowFetch);   // the tab hidden inside the 800 ms debounce
      assert.strictEqual(s.refs.blobSaveBusyRef.current, 1, "the flush's write is counted while in flight");
      const debounced = s.fns.saveBlobNow(payload, "autosave"); // the timer fires before the flush's response
      await new Promise(res => setTimeout(res, 20));
      assert.strictEqual(db.writes.filter(isBlobWrite).length, 0, "the debounced run waits behind the flush - nothing has reached the row yet: " + JSON.stringify(db.writes.map(x => x.method + " " + x.url)));
      release();
      const r = await debounced;
      await new Promise(res => setTimeout(res, 20));
      const w = db.writes.filter(isBlobWrite);
      assert.strictEqual(w.length, 1, "exactly one PATCH: " + JSON.stringify(w.map(x => x.method + " " + x.url)));
      assert.strictEqual(w[0].url, "https://x.supabase.co/rest/v1/call_schedule_data?id=eq.main&updated_at=eq." + encodeURIComponent(T0));
      assert.ok(r && r.skipped, "the debounced run skipped on the signature the flush recorded: " + JSON.stringify(r));
      assert.deepStrictEqual(s.toasts, []); assert.deepStrictEqual(s.statuses, []);
      assert.strictEqual(s.refs.blobTsRef.current, db.row.updated_at);
      assert.strictEqual(s.refs.lastBlobJsonRef.current, H.blobSignature(blobFromBundle(payload)));
      assert.strictEqual(s.refs.blobSaveBusyRef.current, 0, "the count is released");
      assert.deepStrictEqual(db.row.data.holidays, [{ key: "christmas" }]);
      const r2 = await s.fire(); assert.ok(r2 && r2.skipped); assert.strictEqual(db.writes.filter(isBlobWrite).length, 1);
    });
    await acheck4("A4 (review): factory reset with the clear's echo inside the debounce - the poll (or realtime) re-reads { _intentionalClear: true } under the row's own rendering of the stamp, adoptBlob ignores the marker and records NO signature, and the follow-up autosave still writes the defaults over the marker as ONE CAS PATCH carrying the stamp the echo left (the row never keeps the marker); no toast", async () => {
      const db = mkDb(LOCAL0, T0);
      const s = mkSession(db, "s1", DEFAULTS);
      await s.poll();
      // the reset: the clear upsert, then the ref lines and the default state ('Step 2 - reset the config blob')
      const clearTs = "2026-09-24T01:10:22.107Z";
      db.row = { id: "main", data: { _intentionalClear: true }, updated_by: "s1", updated_at: pgTs(clearTs) };
      s.refs.blobLoadedRef.current = true; s.refs.blobTsRef.current = clearTs; s.refs.lastBlobJsonRef.current = null;
      s.state = { roster: [{ id: "s1", name: "Khan", code: "FAK" }], surgeonRules: undefined, groupRules: undefined, holidays: undefined, settings: {}, lastPublished: null, lastGenerate: undefined };
      s.refs.blobLocalRef.current = blobFromBundle(s.bundle()); // the render after the reset's setters
      await s.poll();                 // the echo lands first: the row's rendering differs from the sent string -> re-read
      assert.strictEqual(s.refs.blobTsRef.current, pgTs(clearTs), "the poll moved the stamp to the row's rendering");
      assert.strictEqual(s.refs.lastBlobJsonRef.current, null, "the marker recorded no signature");
      assert.deepStrictEqual(s.state.roster, [{ id: "s1", name: "Khan", code: "FAK" }], "nothing adopted from the marker");
      const r = await s.fire();
      const w = db.writes.filter(isBlobWrite);
      assert.strictEqual(w.length, 1, "one PATCH carrying the defaults: " + JSON.stringify(w.map(x => x.method + " " + x.url)));
      assert.strictEqual(w[0].url, "https://x.supabase.co/rest/v1/call_schedule_data?id=eq.main&updated_at=eq." + encodeURIComponent(pgTs(clearTs)), "the CAS carries the stamp the echo left");
      assert.ok(r && r.saved, JSON.stringify(r));
      assert.deepStrictEqual(Object.keys(db.row.data).sort(), ["lastPublished", "roster", "settings"], "the defaults replaced the marker (undefined keys drop out of the JSON)");
      assert.ok(!("_intentionalClear" in db.row.data), "the marker is gone");
      assert.deepStrictEqual(s.toasts, []);
      await s.poll(); const r2 = await s.fire();
      assert.ok(r2 && r2.skipped, JSON.stringify(r2)); assert.strictEqual(db.writes.filter(isBlobWrite).length, 1);
    });

    check("A4 pins: the autosave is TWO effects - the days leg keyed on [loaded, schedule, vacations, availabilityRows, saveTick], the blob leg keyed on [loaded, surgeons, surgeonRules, groupRules, holidays, settings, lastPublished, lastGenerate, saveTick] (no schedule / vacations / availabilityRows: the poll's re-created arrays never re-fire it); the old single dependency list is gone; each leg keeps the hydration window, the loadFailedRef gate and the empty-save guard; the one-shot allowWipeSaveRef is consumed in the days leg only", () => {
      const daysDeps = "}, [loaded, schedule, vacations, availabilityRows, saveTick]);";
      const blobDeps = "}, [loaded, surgeons, surgeonRules, groupRules, holidays, settings, lastPublished, lastGenerate, saveTick]);";
      assert.strictEqual(count(daysDeps), 1, "days-leg dependencies");
      assert.strictEqual(count(blobDeps), 1, "blob-leg dependencies");
      assert.strictEqual(count("}, [loaded, surgeons, surgeonRules, groupRules, holidays, settings, lastPublished, lastGenerate, schedule, vacations, availabilityRows, saveTick]);"), 0, "the single-effect dependency list");
      const eff = src.indexOf("// --- Supabase: Auto-save on changes ---");
      const iDays = src.indexOf(daysDeps, eff), iBlob = src.indexOf(blobDeps, eff);
      assert.ok(eff > 0 && iDays > eff && iBlob > iDays, "days leg first, then the blob leg");
      const days = src.slice(eff, iDays), blob = src.slice(iDays + daysDeps.length, iBlob);
      for (const [name, part] of [["days", days], ["blob", blob]]) {
        assert.ok(/if \(loadedAtRef\.current && Date\.now\(\) - loadedAtRef\.current < 3000\)[^\n]*return;[^\n]*\/\/ hydration window/.test(part), name + ": hydration window"); // B9 (e): the blob leg's line settles the Setup-save waiters before it returns
        assert.ok(part.includes("if (loadFailedRef.current) {"), name + ": loadFailedRef gate");
        assert.ok(part.includes("payloadLooksWiped(payload) && everHadRealDataRef.current && !allowWipeSaveRef.current"), name + ": empty-save guard");
        assert.ok(part.includes("pendingSaveRef.current = payload;"), name + ": arms the pending payload");
      }
      assert.ok(days.includes("syncScheduleDays(payload.schedule)") && !blob.includes("syncScheduleDays("), "the days leg syncs the table; the blob leg never does");
      assert.ok(days.includes("allowWipeSaveRef.current = false; // consume one-shot bypass") && !blob.includes("allowWipeSaveRef.current = false"), "the one-shot is consumed once, in the days leg");
      assert.ok(!blob.includes("vacations") && !blob.includes("availabilityRows"), "the blob leg never names the poll-refreshed arrays");
      const gate = blob.indexOf("if (!canWriteBlob) {"), loadedGate = blob.indexOf("if (!blobLoadedRef.current) {"), call = blob.indexOf("await saveBlobNow(payload, \"autosave\")"); // B9 (e): the gate settles the waiters, then returns
      assert.ok(gate > 0 && loadedGate > gate && call > loadedGate, `blob leg order: canWriteBlob=${gate} blobLoadedRef=${loadedGate} saveBlobNow=${call}`);
    });
    check("A4 pins: saveBlobNow writes PATCH ?id=eq.main&updated_at=eq.<blobTsRef> (is.null without a stamp) with Prefer return=representation through authFetch, skips when blobSignature equals lastBlobJsonRef, hands zero rows to reloadBlobAfterMiss (adopt + toast 'Setup changed elsewhere - reloaded', never a retry), stamps blobTsRef from the RETURNED row; adoptBlob records blobLocalRef / lastBlobJsonRef through adoptBlobState; no blind upsert of the blob is left in the autosave or the flush (the factory reset's intentional clear is the one upsert)", () => {
      const leg = A4SRC.save;
      assert.ok(leg.length > 0, "the block is missing");
      assert.ok(leg.includes("const saveBlobOnce = async (payload, source) => {") && leg.includes("const reloadBlobAfterMiss = async (source, payload) => {"), "both functions");
      assert.ok(leg.includes("const saveBlobNow = (payload, source) => {") && leg.includes("const run = blobSaveChainRef.current.then(() => saveBlobOnce(payload, source)).finally(() => { blobSaveBusyRef.current = Math.max(0, blobSaveBusyRef.current - 1); });") && leg.includes("blobSaveBusyRef.current += 1;"), "writes are serialized and counted (a second Setup edit PATCHes over the stamp the first one left)");
      assert.ok(leg.includes("const sig = blobSignature(blobData);") && leg.includes("if (sig === lastBlobJsonRef.current) {"), "the content gate");
      assert.ok(leg.includes("blobTsRef.current ? `&updated_at=eq.${encodeURIComponent(blobTsRef.current)}` : \"&updated_at=is.null\""), "the CAS filter");
      assert.ok(leg.includes("authFetch(`${SUPABASE_URL}/rest/v1/call_schedule_data?id=eq.main${casQ}`, {") && leg.includes('method: "PATCH", headers: { Prefer: "return=representation" }'), "the PATCH through authFetch");
      assert.ok(leg.includes("throw new Error(`blob save failed: HTTP ${res.status} ${text.slice(0, 200)}`);"), "an HTTP failure throws for the effect's catch");
      assert.ok(leg.includes("if (!Array.isArray(rows) || rows.length === 0) {\n      const r = await reloadBlobAfterMiss(source, payload);\n      if (!r.missing) return r;"), "zero rows -> reload, no retry of the PATCH (the insert below runs only when no row exists at all)");
      assert.strictEqual((leg.match(/method: "PATCH"/g) || []).length, 1, "one PATCH site - never re-sent after a miss");
      assert.ok(leg.includes("blobTsRef.current = (rows[0] && rows[0].updated_at) || ts;") && leg.includes("lastBlobJsonRef.current = sig;"), "the 2xx stamps the returned updated_at and the signature");
      assert.ok(leg.includes('showToast("Setup changed elsewhere - reloaded", "error");'), "the reload toast");
      assert.ok(leg.includes("const wantBlob = payload ? blobFromBundle(payload) : null;") && leg.includes("const want = wantBlob ? blobSignature(wantBlob) : null;") && leg.includes("if (want && row.updated_at && blobSignature(d) === want) {") && leg.indexOf("if (want && row.updated_at && blobSignature(d) === want) {") < leg.indexOf("adoptBlob(d);"), "a miss whose row already holds the payload is a silent save (our own earlier write) - checked before the adoption and the toast");
      assert.ok(leg.includes("return { ok: true, saved: true, landedEarlier: true };"), "the silent save reports saved");
      assert.ok(!/\.upsert\(/.test(leg) && !leg.includes("on_conflict=id"), "no upsert in the leg");
      const adopt = A4SRC.adopt;
      assert.ok(adopt.includes("const next = adoptBlobState(blobLocalRef.current, d);") && adopt.includes("blobLocalRef.current = next;") && adopt.includes("lastBlobJsonRef.current = blobSignature(next);"), "adoptBlob records what the local state becomes");
      assert.ok(adopt.includes("if (d._intentionalClear) return;") && adopt.indexOf("if (d._intentionalClear) return;") < adopt.indexOf("const next = adoptBlobState(blobLocalRef.current, d);"), "the factory reset's clear marker is ignored BEFORE the signature is recorded (the echo of the clear must not make the defaults look written)");
      assert.ok(adopt.includes("if (d.lastGenerate !== undefined) setLastGenerate(d.lastGenerate);"), "the field-by-field setters stay");
      assert.strictEqual(count("call_schedule_data?on_conflict=id"), 0, "the keepalive blob upsert is gone");
      assert.strictEqual(count('.from("call_schedule_data").upsert('), 1, "the factory reset's clear is the only upsert of the blob");
      assert.strictEqual(count('.upsert({ id: "main", data: blobFromBundle('), 0, "the autosave upsert is gone");
      assert.ok(src.includes("const lastBlobJsonRef = useRef(null);") && src.includes("const blobLocalRef = useRef("), "the two refs");
    });
    check("A4 pins: the keepalive flush's blob leg skips an unchanged blob and otherwise sends the same CAS PATCH with keepalive (zero rows -> reloadBlobAfterMiss, a rejected response re-arms the payload); the factory reset stamps blobTsRef with its clear's updated_at and forgets the signature so the follow-up autosave's CAS matches", () => {
      const fl = src.slice(src.indexOf("flushRef.current = (source) => {"), src.indexOf("const onVisibilityChange = () => {"));
      assert.ok(fl.includes("const flushSig = blobSignature(flushBlob);") && fl.includes("if (flushSig === lastBlobJsonRef.current) return;"), "the flush's content gate");
      assert.ok(fl.includes("fetch(`${SUPABASE_URL}/rest/v1/call_schedule_data?id=eq.main${flushCas}`, {") && fl.includes('method: "PATCH", keepalive: true, headers: { ...hdrs, Prefer: "return=representation" }'), "the keepalive CAS PATCH");
      assert.ok(fl.includes("if (!Array.isArray(rows) || rows.length === 0) { console.warn(`Keepalive blob save (${source}): the setup moved under this session - reloading, not overwriting`); return reloadBlobAfterMiss(source, payload).catch("), "zero rows -> reload (awaited by the chain), never a second write");
      assert.ok(fl.includes("blobSaveBusyRef.current += 1;") && fl.includes("const flushRun = fetch(`${SUPABASE_URL}/rest/v1/call_schedule_data?id=eq.main${flushCas}`, {") && fl.includes(".finally(() => { blobSaveBusyRef.current = Math.max(0, blobSaveBusyRef.current - 1); });") && fl.includes("blobSaveChainRef.current = blobSaveChainRef.current.then(() => flushRun);"), "the flush's PATCH joins the write chain: counted while in flight and appended to blobSaveChainRef, so the debounced run of the same edit waits and skips instead of racing it");
      assert.ok(fl.includes("blobTsRef.current = (rows[0] && rows[0].updated_at) || ts; lastBlobJsonRef.current = flushSig;"), "a 2xx stamps the returned updated_at");
      assert.ok(fl.includes("if (blobSaveBusyRef.current > 0) {") && fl.slice(fl.indexOf("if (blobSaveBusyRef.current > 0) {")).split("\n")[0].includes("pendingSaveRef.current = payload; return; }"), "a blob write in flight owns the stamp: the flush skips its blob leg and keeps the payload armed");
      assert.ok(!fl.includes("resolution=merge-duplicates"), "no merge-duplicates upsert header left in the flush");
      assert.ok(fl.indexOf("if (!blobLoadedRef.current) {") < fl.indexOf("const flushSig = blobSignature(flushBlob);"), "the blobLoadedRef gate precedes the leg");
      const reset = src.slice(src.indexOf("// Step 2 - reset the config blob."), src.indexOf("// --- In-app notifications ---"));
      assert.ok(reset.includes("const clearTs = new Date().toISOString();") && reset.includes('.upsert({ id: "main", data: { _intentionalClear: true }, updated_at: clearTs })') && reset.includes("blobTsRef.current = clearTs;") && reset.includes("lastBlobJsonRef.current = null;"), "the reset stamps the ref and forgets the signature");
      assert.ok(!reset.includes("the poll does not treat it as foreign") && reset.includes("the echo of the clear may re-read it"), "the reset's comment says what happens: the CAS matches (instants), the echo may re-read the marker, adoptBlob ignores it");
    });
  }

  /* ---------------- I. Prompt 16 A5: iOS safe area - the header, the fixed bottom banners, the day editor's sticky row, viewport-fit ---------------- */
  console.log("\n[A5] Prompt 16 A5 (iOS safe area: env() insets on the header, the bottom banners, the toast and the sticky row; viewport-fit=cover)");
  {
    const A5SRC = fs.readFileSync(path.join(ROOT, "index-source.html"), "utf8").replace(/\r\n/g, "\n");
    const A5count = (s, needle) => s.split(needle).length - 1;
    const A5line = (needle) => { const i = A5SRC.indexOf(needle); assert.ok(i > 0, "missing: " + needle); return A5SRC.slice(A5SRC.lastIndexOf("\n", i) + 1, A5SRC.indexOf("\n", i)); };
    check("A5: app-styles.js exports SAFE_AREA (the two env() readers, 0px fallback) and css.bottomBanner - the lowest fixed banner pads its bottom by the inset, a banner stacked n high is lifted 44n px plus the inset; css.hdr pads its top by the inset on top of its 14px", () => {
      const st = require(path.join(ROOT, "app-styles.js"));
      assert.deepStrictEqual(st.SAFE_AREA, { top: "env(safe-area-inset-top, 0px)", bottom: "env(safe-area-inset-bottom, 0px)" });
      assert.strictEqual(typeof st.css.bottomBanner, "function", "css.bottomBanner");
      assert.deepStrictEqual(st.css.bottomBanner(0), { bottom: 0, paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 9px)" }, "the lowest banner");
      assert.deepStrictEqual(st.css.bottomBanner(1), { bottom: "calc(44px + env(safe-area-inset-bottom, 0px))" }, "one banner below it");
      assert.deepStrictEqual(st.css.bottomBanner(2), { bottom: "calc(88px + env(safe-area-inset-bottom, 0px))" }, "two banners below it");
      assert.deepStrictEqual(st.css.bottomBanner(), st.css.bottomBanner(0), "no argument = the lowest banner");
      assert.strictEqual(st.css.hdr.paddingTop, "calc(env(safe-area-inset-top, 0px) + 14px)", "css.hdr paddingTop");
      assert.strictEqual(st.css.hdr.padding, "14px 20px", "the shorthand stays");
      const keys = Object.keys(st.css.hdr);
      assert.ok(keys.indexOf("paddingTop") > keys.indexOf("padding"), "paddingTop is declared after the padding shorthand (React applies style keys in order, so the longhand wins)");
    });
    check("A5 pins: the viewport meta carries viewport-fit=cover (once), the #FF5F05 theme-color meta and the black-translucent status bar stay", () => {
      assert.ok(A5SRC.includes('<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">'), "the viewport meta");
      assert.strictEqual(A5count(A5SRC, '<meta name="viewport"'), 1, "one viewport meta");
      assert.strictEqual(A5count(A5SRC, '<meta name="theme-color" content="#FF5F05">'), 1, "the theme-color meta");
      assert.ok(A5SRC.includes('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">'), "black-translucent: the page draws under the status bar, which is why the header pads by the top inset");
    });
    check("A5 pins: the three fixed bottom banners (session-expired above minimum-version above update-available) position through css.bottomBanner spread AFTER their padding shorthand; no literal 44px offset or bottom:0 is left on them; the toast lifts by the bottom inset", () => {
      assert.ok(A5line('data-testid="session-expired"').includes('style={{position:"fixed",left:0,right:0,zIndex:9200,background:"#7a2a2a",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",flexWrap:"wrap",gap:10,padding:"9px 14px",...css.bottomBanner((forceUpdate ? 1 : 0) + (updateAvailable ? 1 : 0)),fontSize:12.5'), "the session-expired banner");
      const fu = A5SRC.slice(A5SRC.indexOf("{forceUpdate && !paintSheet && !offerSheet && ("), A5SRC.indexOf("This app version ({APP_VERSION}) is below the required minimum"));
      assert.ok(fu.includes('<div role="alert" style={{position:"fixed",left:0,right:0,zIndex:9200,background:"#7a2a2a",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",flexWrap:"wrap",gap:10,padding:"9px 14px",...css.bottomBanner(updateAvailable ? 1 : 0),fontSize:12.5'), "the minimum-version banner");
      const ua = A5SRC.slice(A5SRC.indexOf("{updateAvailable && !paintSheet && !offerSheet && ("), A5SRC.indexOf("New version available ({updateAvailable})"));
      assert.ok(ua.includes('<div role="status" aria-live="polite" style={{position:"fixed",left:0,right:0,zIndex:9200,background:"#1F2A3A",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",flexWrap:"wrap",gap:10,padding:"9px 14px",...css.bottomBanner(0),fontSize:12.5'), "the update-available banner");
      assert.strictEqual(A5count(A5SRC, "css.bottomBanner("), 3, "exactly the three banners");
      for (const gone of ["bottom:updateAvailable?44:0", "bottom:(forceUpdate?44:0)+(updateAvailable?44:0)", "bottom:0,zIndex:9998"]) assert.strictEqual(A5count(A5SRC, gone), 0, "literal offset left: " + gone);
      assert.ok(A5line('data-testid="toast"').includes("...((paintSheet || offerSheet) ? { top: `calc(12px + ${SAFE_AREA.top})` } : { bottom: `calc(24px + ${SAFE_AREA.bottom})` }),"), "the toast: lifted by the top inset over a painter sheet, by the bottom inset otherwise");
    });
    check("A5 pins: the day editor's sticky Cancel / Save row pads its bottom by the inset after its padding shorthand (the painter sheets' own four env() literals stay; every other site reads SAFE_AREA)", () => {
      assert.ok(A5line('data-testid="editor-footer"').includes('position:"sticky",bottom:-16,background:panelBg,margin:"0 -18px -16px",padding:"8px 18px 12px",paddingBottom:`calc(${SAFE_AREA.bottom} + 12px)`,borderTop:'), "the editor footer");
      assert.strictEqual(A5count(A5SRC, "env(safe-area-inset-"), 4, "the two painter sheets' header + footer literals, nothing else raw");
      assert.strictEqual(A5count(A5SRC, "${SAFE_AREA.bottom}"), 2, "the toast and the editor footer");
      assert.strictEqual(A5count(A5SRC, "${SAFE_AREA.top}"), 1, "the toast's painter-sheet placement is the only JSX reader of the top inset; the header's lives in css.hdr (app-styles.js)");
    });
  }

  /* ---------------- Prompt 16 B1: Undo per edit and per day ---------------- */
  console.log("\n[B1] Prompt 16 B1 (Undo stores {day, before, version} per edit and puts back only the days whose version has not moved)");
  {
    const needH = (n) => { if (typeof H[n] !== "function") throw new Error("helpers." + n + " is missing"); };
    const A = { primary: "s2", backup: null, primaryLocked: false, backupLocked: false, source: "manual", externalCover: null, note: null };
    const B0 = { primary: "s1", backup: "s3", primaryLocked: false, backupLocked: false, source: "import", externalCover: null, note: null };
    const B1 = { ...B0, backup: "s4", source: "manual" };
    const FOREIGN = { ...B0, primary: "s5", source: "claim" };
    check("B1 helpers: undoEntry keeps only the days that changed, each with the assignment it had before (a deep copy; null for a day with no row) and the version this session had seen (null when none); nothing changed -> null", () => {
      needH("undoEntry");
      const prev = { "2026-10-16": B0, "2026-10-20": A };
      const next = { "2026-10-15": A, "2026-10-16": B1, "2026-10-20": { ...A } };
      const e = H.undoEntry(prev, next, { "2026-10-16": 7, "2026-10-20": 2 });
      assert.deepStrictEqual(e.days.map(d => d.day), ["2026-10-15", "2026-10-16"], "10/20 is unchanged and stays out");
      assert.deepStrictEqual(e.days[0], { day: "2026-10-15", before: null, version: null });
      assert.deepStrictEqual(e.days[1], { day: "2026-10-16", before: B0, version: 7 });
      assert.notStrictEqual(e.days[1].before, B0, "a copy, not the live object");
      assert.strictEqual(H.undoEntry(prev, { ...prev }, {}), null);
      assert.strictEqual(H.undoEntry(null, null, null), null);
    });
    check("B1 behaviour: one action over days A and B, then a claim lands on B (its version moves) -> Undo restores A only, leaves B as the table has it and the message names B", () => {
      needH("undoApply");
      const versions = { "2026-10-16": 7 };
      const before = { "2026-10-16": B0 };
      const after = { "2026-10-15": A, "2026-10-16": B1 };
      const entry = H.undoEntry(before, after, versions);
      // the claim: a realtime / poll row for 10/16 at v8 with a different holder
      const live = { ...after, "2026-10-16": FOREIGN };
      versions["2026-10-15"] = 1; // the entry's own POST of 10/15 is noted below; here the raw versions differ on purpose
      const noted = H.undoNoteWrite([entry], "2026-10-15", undefined, 1)[0];
      versions["2026-10-16"] = 8;
      const r = H.undoApply(noted, live, versions);
      assert.deepStrictEqual(r.restored, ["2026-10-15"]);
      assert.deepStrictEqual(r.skipped, ["2026-10-16"]);
      assert.deepStrictEqual(r.next, { "2026-10-16": FOREIGN }, "10/15 is back to no row; 10/16 keeps the claim");
      assert.strictEqual(r.message, "Undo: 1 of 2 days restored; 1 changed since (10/16).");
      assert.deepStrictEqual(live["2026-10-15"], A, "the input map is not mutated");
    });
    check("B1 behaviour: edit A (entry 1), edit B (entry 2), an external change on B's day -> the first Undo restores nothing and names the day, the second restores A", () => {
      const versions = { "2026-10-16": 7 };
      const m0 = { "2026-10-16": B0 };
      const m1 = { ...m0, "2026-10-15": A };            // edit A: 10/15 OPEN -> Burchett
      const e1 = H.undoEntry(m0, m1, versions);
      const m2 = { ...m1, "2026-10-16": B1 };           // edit B: 10/16 backup Acton -> Philip
      const e2 = H.undoEntry(m1, m2, versions);
      let history = [e1, e2];
      history = H.undoNoteWrite(history, "2026-10-15", undefined, 1); versions["2026-10-15"] = 1; // own POST
      history = H.undoNoteWrite(history, "2026-10-16", 7, 8); versions["2026-10-16"] = 8;           // own PATCH
      const live = { ...m2, "2026-10-16": FOREIGN }; versions["2026-10-16"] = 9;                    // a trade landed on 10/16
      const first = H.undoApply(history[1], live, versions);
      assert.deepStrictEqual(first.restored, []);
      assert.deepStrictEqual(first.skipped, ["2026-10-16"]);
      assert.strictEqual(first.next, live, "nothing to apply -> the same map back");
      assert.strictEqual(first.message, "Undo: 0 of 1 day restored; 1 changed since (10/16).");
      const second = H.undoApply(history[0], first.next, versions);
      assert.deepStrictEqual(second.restored, ["2026-10-15"]);
      assert.deepStrictEqual(second.next, { "2026-10-16": FOREIGN });
      assert.strictEqual(second.message, "Undo: 1 day restored (10/15).");
    });
    check("B1 helpers: undoNoteWrite advances the recorded version in EVERY entry that carried the version the write went out against (own POST null -> 1, own PATCH 1 -> 2); an entry at another version and an unknown day are untouched and the array is returned as-is when nothing matched", () => {
      needH("undoNoteWrite");
      const e1 = { days: [{ day: "2026-10-15", before: null, version: null }] };
      const e2 = { days: [{ day: "2026-10-15", before: A, version: 1 }, { day: "2026-10-16", before: B0, version: 7 }] };
      const h1 = H.undoNoteWrite([e1, e2], "2026-10-15", undefined, 1);
      assert.strictEqual(h1[0].days[0].version, 1, "e1 advanced");
      assert.strictEqual(h1[1].days[0].version, 1, "e2 already at 1 (recorded after the POST) stays");
      assert.strictEqual(e1.days[0].version, null, "input entries are not mutated");
      const h2 = H.undoNoteWrite(h1, "2026-10-15", 1, 2);
      assert.deepStrictEqual(h2.map(e => e.days[0].version), [2, 2], "both entries followed the PATCH");
      assert.strictEqual(h2[1].days[1].version, 7, "10/16 untouched");
      const same = H.undoNoteWrite(h2, "2026-10-16", 3, 4);
      assert.strictEqual(same, h2, "no entry carried v3 for 10/16 -> the same array");
      assert.strictEqual(H.undoNoteWrite(h2, "2026-10-16", 7, 7), h2, "a no-op version");
      const many = H.undoApply({ days: [{ day: "2026-10-15", before: null, version: 0 }, { day: "2026-10-16", before: null, version: 0 }, { day: "2026-10-17", before: null, version: 0 }] }, { "2026-10-15": A, "2026-10-16": A, "2026-10-17": A }, { "2026-10-15": 0, "2026-10-16": 0, "2026-10-17": 0 });
      assert.strictEqual(many.message, "Undo: 3 days restored.");
      assert.deepStrictEqual(many.next, {});
    });
    const B1SRC = fs.readFileSync(path.join(ROOT, "index-source.html"), "utf8").replace(/\r\n/g, "\n");
    const B1count = (s, needle) => s.split(needle).length - 1;
    check("B1 pins: pushUndo takes (prev, next) and stores helpers.undoEntry against dayVersionsRef; no whole-map snapshot is pushed anywhere; undoLastChange applies helpers.undoApply, keeps scheduleRef in step and toasts the message", () => {
      assert.ok(B1SRC.includes("const pushUndo = useCallback((prev, next) => {"), "pushUndo(prev, next)");
      assert.ok(B1SRC.includes("const entry = undoEntry(prev, next, dayVersionsRef.current);"), "undoEntry against the version map");
      assert.strictEqual(B1count(B1SRC, "JSON.parse(JSON.stringify(sched))"), 0, "the whole-map snapshot push is gone");
      assert.ok(B1SRC.includes("const r = undoApply(h[h.length - 1], scheduleRef.current || {}, dayVersionsRef.current);"), "undoApply against the live map and the version map");
      assert.ok(B1SRC.includes("if (r.restored.length) { scheduleRef.current = r.next; setSchedule(r.next); }"), "the map moves only when a day came back");
      assert.ok(B1SRC.includes('showToast(r.message, r.skipped.length ? "error" : "info");'), "the toast says what was restored and what was skipped");
      // every push site hands over both maps
      for (const site of ["pushUndo(schedule, { ...schedule, [day]: after });", "pushUndo(schedule, next);", "pushUndo(cur, next);", "pushUndo(scheduleRef.current || schedule, m.next);", "pushUndo(scheduleRef.current, sched);"]) assert.strictEqual(B1count(B1SRC, site), 1, "push site: " + site);
      assert.strictEqual(B1count(B1SRC, "pushUndo("), 5, "the five sites and nothing else - no one-argument push left");
      assert.strictEqual(B1count(B1SRC, "setScheduleHistory("), 1, "the state setter is reached only through setHistory (ref + state together)");
      assert.ok(B1SRC.includes('data-testid="undo-btn"'), "the smoke's handle on the button");
    });
    check("B1 pins: syncScheduleDays notes the session's OWN write (undoNoteWrite from the version it went out against to the returned one) right after it advances dayVersionsRef - a foreign version move (realtime, poll, conflict reload) is never noted, which is what makes it 'changed since'", () => {
      const i = B1SRC.indexOf("      dayVersionsRef.current[day] = r.version;\n      const nh = undoNoteWrite(scheduleHistoryRef.current, day, sentAgainst, r.version);\n      if (nh !== scheduleHistoryRef.current) setHistory(nh);\n      persisted[day] = JSON.parse(JSON.stringify(a));");
      assert.ok(i > 0, "the own-write note sits between the version advance and the persisted copy in syncScheduleDaysNow and is keyed on sentAgainst");
      // B1 review: sentAgainst is the version the write REALLY went out against - `ver` for an ordinary PATCH / POST,
      // the re-read version in the duplicate-POST branch (a foreign row an undo entry at null must not follow).
      const loop = B1SRC.slice(B1SRC.indexOf("      const ver = dayVersionsRef.current[day];"), i);
      assert.ok(loop.includes("      let sentAgainst = ver;"), "sentAgainst starts as the version map's entry");
      assert.ok(loop.includes("            dayVersionsRef.current[day] = cur.version;\n            sentAgainst = cur.version;\n            r = await patchDayRow(row, cur.version, by, ts);"), "the duplicate branch re-keys it on the re-read version before the CAS retry");
      assert.strictEqual(B1count(loop, "sentAgainst = "), 2, "set in exactly those two places");
      assert.strictEqual(B1count(B1SRC, "undoNoteWrite("), 1, "the sync loop is the only place a write is noted");
      const rt = B1SRC.slice(B1SRC.indexOf("    const onDayChange = (payload) => {"), B1SRC.indexOf("    let rtChannel = null;"));
      assert.ok(!rt.includes("undoNoteWrite") && !rt.includes("setHistory"), "the realtime handler leaves the history alone");
    });
  }

  /* ---------------- Prompt 16 B7: the recovery / invite hash - auth.adoptLinkSession ---------------- */
  console.log("\n[B7] Prompt 16 B7 (recovery / invite hash: the pair is adopted for this device's own account or for nobody; a different account's session is never replaced without a sign-out)");
  {
    const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    const tok = (sub, email, tag) => `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub, email, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, jti: tag })}.sig`;
    const U1 = "00000000-0000-4000-8000-0000000000a1", U2 = "00000000-0000-4000-8000-0000000000a2"; // the zero-prefixed fixture shape (test/privacy.test.js A6b)
    const E1 = "one@example.com", E2 = "two@example.com";
    const STORED = tok(U1, E1, "stored"), LINK = tok(U2, E2, "link"), LINK_SAME = tok(U1, E1, "link-same"), LINK_ROT = tok(U1, E1, "link-rotated");
    const store = sandbox.localStorage;
    const setSession = (t, r) => { store._m = {}; if (t) store.setItem("silvis-auth-token", t); if (r) store.setItem("silvis-auth-refresh", r); };
    const stored = () => ({ token: store.getItem("silvis-auth-token"), refresh: store.getItem("silvis-auth-refresh") });
    let B7 = null;
    const need = () => { if (!B7 || typeof B7.auth.adoptLinkSession !== "function") throw new Error("auth.adoptLinkSession is not implemented in config.js"); };
    const bcheck = async (name, fn) => { try { need(); await fn(); pass++; console.log("ok   " + name); } catch (e) { fail++; console.log("FAIL " + name + "\n     -> " + (e && e.message ? e.message : e)); } };
    check("B7: config.js exposes auth.adoptLinkSession and jwtClaims (the payload's sub / email / exp; null for junk, never throws)", () => {
      B7 = vm.runInContext("({ auth, jwtClaims: (typeof jwtClaims === 'function' ? jwtClaims : null) })", sandbox);
      assert.strictEqual(typeof B7.auth.adoptLinkSession, "function", "auth.adoptLinkSession");
      assert.strictEqual(typeof B7.jwtClaims, "function", "jwtClaims");
      const c = B7.jwtClaims(LINK);
      assert.strictEqual(c.sub, U2); assert.strictEqual(c.email, E2); assert.strictEqual(typeof c.exp, "number");
      assert.strictEqual(B7.jwtClaims("not-a-jwt"), null); assert.strictEqual(B7.jwtClaims(null), null); assert.strictEqual(B7.jwtClaims("a.###.b"), null);
    });
    // getUser stub (the task's contract): answers by the token in storage at the moment of the call - the real one
    // reads auth.getSession() - and records that token; mode[token] = "dead" (cleared, like the real one) | "network".
    const realGetUser = B7 && B7.auth.getUser, realSave = B7 && B7.auth._saveSession;
    const users = { [STORED]: { id: U1, email: E1 }, [LINK]: { id: U2, email: E2 }, [LINK_SAME]: { id: U1, email: E1 }, [LINK_ROT]: { id: U1, email: E1 } };
    let calls = [], saves = 0, mode = {}, fetches = [], probe = {}, grants = {};
    const reset = () => { calls = []; saves = 0; mode = {}; fetches = []; probe = {}; grants = {}; };
    const tokTag = (t) => t === LINK_SAME ? "link-same" : t === STORED ? "stored" : t === LINK ? "link" : t === LINK_ROT ? "link-rotated" : t ? "?" : "";
    // what went out over fetch, as "METHOD /auth/v1/<x> [bearer=<tag>] [refresh=<token>]"
    const seen = () => fetches.map(f => f.method + " " + f.url.replace(/^.*(\/auth\/v1\/[a-z]+).*$/, "$1") + (f.bearer ? " bearer=" + tokTag(f.bearer) : "") + (f.body && f.body.refresh_token ? " refresh=" + f.body.refresh_token : ""));
    if (B7) {
      B7.auth.getUser = async () => { const s = B7.auth.getSession(); const t = s && s.access_token; calls.push(t); if (!t) return { user: null }; if (mode[t] === "network") return { user: null, error: "network" }; if (mode[t] === "dead" || !users[t]) { B7.auth._clearSession(); return { user: null }; } return { user: users[t] }; };
      B7.auth._saveSession = (d) => { saves++; return realSave.call(B7.auth, d); };
    }
    // fetch stub: the logout, and (the review of B7) the probe of a link pair while the SAME account is live on the
    // device - GET /auth/v1/user answered by bearer (probe[token] = "dead" -> 401, "network" -> throws), the refresh
    // POST by the refresh token (grants[refresh] = the rotated pair, else 400 invalid_grant); every call is recorded.
    const bearerOfB7 = (opts) => String((opts && opts.headers && (opts.headers.Authorization || opts.headers.authorization)) || "").replace(/^Bearer /, "");
    sandbox.__fetch = async (url, opts) => {
      const u = String(url), method = (opts && opts.method) || "GET", bearer = bearerOfB7(opts);
      let body = null; try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) { body = null; }
      fetches.push({ url: u, method, bearer, body });
      if (u.includes("/auth/v1/logout")) return resp(204, "");
      if (u.includes("/auth/v1/user") && method === "GET") {
        if (probe[bearer] === "network") throw new TypeError("Failed to fetch");
        if (probe[bearer] === "dead" || !users[bearer]) return resp(401, { message: "invalid JWT: token is expired" });
        return resp(200, users[bearer]);
      }
      if (u.includes("/auth/v1/token?grant_type=refresh_token")) {
        const g = body && grants[body.refresh_token];
        return g ? resp(200, { access_token: g.access_token, refresh_token: g.refresh_token, token_type: "bearer", expires_in: 3600, user: users[g.access_token] || null })
                 : resp(400, { error: "invalid_grant", error_description: "Invalid Refresh Token: Refresh Token Not Found" });
      }
      return resp(500, "unexpected fetch in B7: " + u);
    };
    await bcheck("B7 no session: the link pair is stored, getUser runs ONCE (after the store, on the new token) and the result names the account - { status: 'ok', user, email }", async () => {
      setSession(null, null); reset();
      const r = await B7.auth.adoptLinkSession({ access_token: LINK, refresh_token: "link-r" });
      assert.strictEqual(r.status, "ok", JSON.stringify(r));
      assert.strictEqual(r.email, E2);
      assert.deepStrictEqual({ ...r.user }, { id: U2, email: E2 });
      assert.deepStrictEqual(stored(), { token: LINK, refresh: "link-r" });
      assert.deepStrictEqual(calls, [LINK], "one getUser call, on the stored link token");
      assert.strictEqual(saves, 1, "one _saveSession");
      assert.deepStrictEqual(seen(), [], "nobody signed in: no probe, nothing over fetch");
    });
    await bcheck("B7 same user: a stored session of the SAME account is replaced by the link pair (getUser before, on the stored token; after, on the new one)", async () => {
      setSession(STORED, "r1"); reset();
      const r = await B7.auth.adoptLinkSession({ access_token: LINK_SAME, refresh_token: "link-r2" });
      assert.strictEqual(r.status, "ok", JSON.stringify(r));
      assert.strictEqual(r.email, E1);
      assert.deepStrictEqual(stored(), { token: LINK_SAME, refresh: "link-r2" });
      assert.deepStrictEqual(calls, [STORED, LINK_SAME]);
      assert.strictEqual(saves, 1);
      assert.deepStrictEqual(seen(), ["GET /auth/v1/user bearer=link-same"], "the link pair is probed once, with the link bearer, BEFORE it replaces the live pair");
    });
    await bcheck("B7 same account live + dead link: the link pair is probed BEFORE anything is stored (GET /auth/v1/user with the link bearer -> 401, the refresh POST with the link's refresh token -> 400) - { status: 'dead', kept: true }, the live pair untouched, _saveSession never called, getUser once on the stored token, no expired flag", async () => {
      setSession(STORED, "r1"); reset(); probe[LINK_SAME] = "dead";
      const r = await B7.auth.adoptLinkSession({ access_token: LINK_SAME, refresh_token: "link-r2" });
      assert.strictEqual(r.status, "dead", JSON.stringify(r));
      assert.strictEqual(r.kept, true, "kept: the caller goes on to the ordinary session path");
      assert.deepStrictEqual(stored(), { token: STORED, refresh: "r1" }, "the live pair is untouched");
      assert.deepStrictEqual(calls, [STORED]);
      assert.strictEqual(saves, 0, "_saveSession not called");
      assert.deepStrictEqual(seen(), ["GET /auth/v1/user bearer=link-same", "POST /auth/v1/token refresh=link-r2"]);
      assert.strictEqual(B7.auth.sessionExpired, false, "a dead LINK never raises the session-expired banner");
      reset(); probe[LINK_SAME] = "dead";
      const r2 = await B7.auth.adoptLinkSession({ access_token: LINK_SAME, refresh_token: null });
      assert.strictEqual(r2.status, "dead"); assert.strictEqual(r2.kept, true);
      assert.deepStrictEqual(seen(), ["GET /auth/v1/user bearer=link-same"], "no refresh token: the GET alone decides");
      assert.deepStrictEqual(stored(), { token: STORED, refresh: "r1" });
    });
    await bcheck("B7 same account live + an expired link access token with a good refresh token: the probe's refresh POST rotates the pair (nothing stored before the answer) and the ROTATED pair is what gets stored - { status: 'ok' } (getUser after, on the rotated token)", async () => {
      setSession(STORED, "r1"); reset(); probe[LINK_SAME] = "dead"; grants["link-r2"] = { access_token: LINK_ROT, refresh_token: "link-r3" };
      const r = await B7.auth.adoptLinkSession({ access_token: LINK_SAME, refresh_token: "link-r2" });
      assert.strictEqual(r.status, "ok", JSON.stringify(r));
      assert.strictEqual(r.email, E1);
      assert.deepStrictEqual(stored(), { token: LINK_ROT, refresh: "link-r3" }, "the rotated pair is stored");
      assert.deepStrictEqual(calls, [STORED, LINK_ROT]);
      assert.strictEqual(saves, 1);
      assert.deepStrictEqual(seen(), ["GET /auth/v1/user bearer=link-same", "POST /auth/v1/token refresh=link-r2"]);
    });
    await bcheck("B7 same account live + the probe on network: the live pair is kept and the card opens for it - { status: 'ok', kept: true, user: the signed-in user } - nothing stored, no _saveSession, no second getUser", async () => {
      setSession(STORED, "r1"); reset(); probe[LINK_SAME] = "network";
      const r = await B7.auth.adoptLinkSession({ access_token: LINK_SAME, refresh_token: "link-r2" });
      assert.strictEqual(r.status, "ok", JSON.stringify(r));
      assert.strictEqual(r.kept, true); assert.strictEqual(r.email, E1); assert.strictEqual(r.unverified, false);
      assert.deepStrictEqual({ ...r.user }, { id: U1, email: E1 });
      assert.deepStrictEqual(stored(), { token: STORED, refresh: "r1" }, "the live pair is kept");
      assert.strictEqual(saves, 0);
      assert.deepStrictEqual(calls, [STORED]);
      assert.deepStrictEqual(seen(), ["GET /auth/v1/user bearer=link-same"]);
    });
    await bcheck("B7 different user: { status: 'conflict', signedIn: { id, email }, linkEmail } - NOTHING stored (the stored pair untouched, _saveSession never called, one getUser call on the stored token, no expired flag)", async () => {
      setSession(STORED, "r1"); reset();
      const r = await B7.auth.adoptLinkSession({ access_token: LINK, refresh_token: "link-r" });
      assert.strictEqual(r.status, "conflict", JSON.stringify(r));
      assert.deepStrictEqual({ ...r.signedIn }, { id: U1, email: E1 }); // a host-realm copy: the object was made inside the vm context
      assert.strictEqual(r.linkEmail, E2);
      assert.strictEqual(r.unverified, false);
      assert.deepStrictEqual(stored(), { token: STORED, refresh: "r1" }, "the stored pair is untouched");
      assert.deepStrictEqual(calls, [STORED]);
      assert.strictEqual(saves, 0, "_saveSession not called");
      assert.strictEqual(B7.auth.sessionExpired, false);
      assert.deepStrictEqual(seen(), [], "a different account: refused on getUser alone, the link pair is never probed");
    });
    await bcheck("B7 different user, then the explicit sign-out: auth.signOut() clears the pair (POST /auth/v1/logout), a second adoptLinkSession of the SAME link pair stores it - { status: 'ok' } for the link's account", async () => {
      setSession(STORED, "r1"); reset();
      const first = await B7.auth.adoptLinkSession({ access_token: LINK, refresh_token: "link-r" });
      assert.strictEqual(first.status, "conflict");
      await B7.auth.signOut();
      assert.deepStrictEqual(stored(), { token: null, refresh: null }, "signed out");
      const r = await B7.auth.adoptLinkSession({ access_token: LINK, refresh_token: "link-r" });
      assert.strictEqual(r.status, "ok", JSON.stringify(r));
      assert.strictEqual(r.email, E2);
      assert.deepStrictEqual(stored(), { token: LINK, refresh: "link-r" });
      assert.deepStrictEqual(calls, [STORED, LINK]);
      assert.strictEqual(saves, 1);
    });
    await bcheck("B7 dead stored session: getUser finds no user for the stored pair (cleared, as the real one does) - nobody is signed in, the link pair is stored", async () => {
      setSession(STORED, "r1"); reset(); mode[STORED] = "dead";
      const r = await B7.auth.adoptLinkSession({ access_token: LINK, refresh_token: "link-r" });
      assert.strictEqual(r.status, "ok", JSON.stringify(r));
      assert.deepStrictEqual(stored(), { token: LINK, refresh: "link-r" });
      assert.deepStrictEqual(calls, [STORED, LINK]);
    });
    await bcheck("B7 network while re-checking the stored session: the two tokens' sub claims decide - a different sub is a conflict (unverified: true, the e-mail from the stored token's claim, nothing stored); the same sub proceeds", async () => {
      setSession(STORED, "r1"); reset(); mode[STORED] = "network";
      const r = await B7.auth.adoptLinkSession({ access_token: LINK, refresh_token: "link-r" });
      assert.strictEqual(r.status, "conflict", JSON.stringify(r));
      assert.strictEqual(r.unverified, true);
      assert.deepStrictEqual({ ...r.signedIn }, { id: U1, email: E1 }); // a host-realm copy: the object was made inside the vm context
      assert.deepStrictEqual(stored(), { token: STORED, refresh: "r1" });
      assert.strictEqual(saves, 0);
      reset(); mode[STORED] = "network";
      const r2 = await B7.auth.adoptLinkSession({ access_token: LINK_SAME, refresh_token: "link-r2" });
      assert.strictEqual(r2.status, "ok", JSON.stringify(r2));
      assert.deepStrictEqual(stored(), { token: LINK_SAME, refresh: "link-r2" });
    });
    await bcheck("B7 dead link token: getUser rejects the freshly stored pair - { status: 'dead' }, nothing left in storage (the card then shows the expired-link message)", async () => {
      setSession(null, null); reset(); mode[LINK] = "dead";
      const r = await B7.auth.adoptLinkSession({ access_token: LINK, refresh_token: "link-r" });
      assert.strictEqual(r.status, "dead", JSON.stringify(r));
      assert.deepStrictEqual(stored(), { token: null, refresh: null });
    });
    await bcheck("B7 network after the store: the pair stays stored and the card still opens with the e-mail from the token - { status: 'ok', user: null, unverified: true }", async () => {
      setSession(null, null); reset(); mode[LINK] = "network";
      const r = await B7.auth.adoptLinkSession({ access_token: LINK, refresh_token: "link-r" });
      assert.strictEqual(r.status, "ok", JSON.stringify(r));
      assert.strictEqual(r.user, null); assert.strictEqual(r.email, E2); assert.strictEqual(r.unverified, true);
      assert.deepStrictEqual(stored(), { token: LINK, refresh: "link-r" });
    });
    await bcheck("B7 junk: a pair without a decodable access token is { status: 'invalid' } - nothing stored, no getUser, no _saveSession", async () => {
      setSession(STORED, "r1"); reset();
      const r = await B7.auth.adoptLinkSession({ access_token: "nope", refresh_token: "x" });
      assert.strictEqual(r.status, "invalid");
      assert.deepStrictEqual(stored(), { token: STORED, refresh: "r1" });
      assert.deepStrictEqual(calls, []); assert.strictEqual(saves, 0);
      assert.strictEqual((await B7.auth.adoptLinkSession(null)).status, "invalid");
    });
    await bcheck("B7 updatePassword offline: a THROWN fetch resolves to { error: 'No connection - try again' } instead of rejecting (the card's busy state ends with a message, not a stuck button); a non-JSON error body still resolves to an error", async () => {
      setSession(STORED, "r1"); reset();
      sandbox.__fetch = async () => { throw new TypeError("Failed to fetch"); };
      const r = await B7.auth.updatePassword("placeholder-pw-1");
      assert.deepStrictEqual({ ...r }, { error: "No connection - try again" });
      sandbox.__fetch = async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError("Unexpected token <"); }, text: async () => "<html>bad gateway</html>" });
      const r2 = await B7.auth.updatePassword("placeholder-pw-1");
      assert.ok(r2 && typeof r2.error === "string" && r2.error.length > 0, "an error string for a non-JSON body: " + JSON.stringify(r2));
    });
    if (B7) { B7.auth.getUser = realGetUser; B7.auth._saveSession = realSave; }
    const B7SRC = fs.readFileSync(path.join(ROOT, "index-source.html"), "utf8").replace(/\r\n/g, "\n");
    const B7count = (needle) => B7SRC.split(needle).length - 1;
    check("B7 pins: the mount effect's hash branch drops the hash from the URL, then hands the pair to adoptLinkSession (config.js decides) - the app never calls auth._saveSession itself; the pending pair lives in pendingLinkRef (memory), never in storage; the card says 'Setting a password for' the account; the conflict card carries the Sign out button", () => {
      const start = B7SRC.indexOf("  // --- Auth: Check session on mount ---");
      assert.ok(start > 0, "mount effect not found");
      const eff = B7SRC.slice(start, start + 4000);
      const iHash = eff.indexOf('if (hash && (hash.includes("type=recovery") || hash.includes("type=invite"))) {');
      const iClean = eff.indexOf('window.history.replaceState(null, "", window.location.pathname + window.location.search);');
      const iAdopt = eff.indexOf("await adoptLinkSession({ access_token: accessToken, refresh_token: refreshToken });");
      assert.ok(iHash > 0 && iClean > iHash && iAdopt > iClean, "hash branch -> replaceState -> adoptLinkSession, in that order");
      assert.strictEqual(B7count("auth._saveSession("), 0, "the app never stores a pair itself");
      assert.strictEqual(B7count("auth.adoptLinkSession("), 1, "one call site (the component's adoptLinkSession)");
      assert.strictEqual(B7count('setAuthMode("newpassword")'), 1, "the set-password card is opened in one place (the ok branch)");
      assert.strictEqual(B7count("const pendingLinkRef = useRef(null);"), 1, "the pending pair is a ref");
      assert.strictEqual(B7count("pendingLinkRef.current = pair;"), 1, "set once, on a conflict");
      assert.strictEqual(B7count('localStorage.setItem("silvis-auth'), 0, "no token write to storage from the app");
      assert.strictEqual(B7count("Setting a password for "), 1, "the card names the account");
      assert.strictEqual(B7count('data-testid="link-account"'), 1, "the card's account line");
      assert.strictEqual(B7count('data-testid="link-conflict"'), 1, "the conflict card");
      assert.strictEqual(B7count('data-testid="link-signout"'), 1, "its Sign out button");
      assert.ok(B7SRC.includes('authMode==="linkconflict"'), "the linkconflict card mode");
      assert.ok(B7SRC.includes("setAuthError(AUTH_LINK_ERROR_MESSAGE)"), "a dead link token shows the A2 expired-link message");
    });
    check("B7 pins (review): a dead link over this device's own live session is KEPT - the mount effect reads the verdict and falls through to the ordinary session path, the wrapper shows the expired-link toast (no card); submitNewPassword ends the busy state when updatePassword rejects; config.js probes the link pair (_probeLinkPair) and updatePassword catches a thrown fetch", () => {
      const start = B7SRC.indexOf("  // --- Auth: Check session on mount ---");
      const eff = B7SRC.slice(start, start + 4000);
      assert.ok(eff.includes("const r = await adoptLinkSession({ access_token: accessToken, refresh_token: refreshToken });"), "the mount effect reads the verdict");
      assert.ok(eff.includes('if (!(r && r.kept && r.status === "dead")) { setAuthLoading(false); return; }'), "kept + dead: no early return - the ordinary session path follows");
      assert.strictEqual(B7count('else if (r.status === "dead" && r.kept) {'), 1, "the wrapper's kept branch");
      assert.strictEqual(B7count('showToast(AUTH_LINK_ERROR_MESSAGE, "error")'), 1, "the expired-link toast over the signed-in app (once)");
      assert.ok(/auth\.updatePassword\(newPassword\)\.then\(r=>\{[\s\S]{0,700}?\}\)\.catch\(e=>\{setAuthBusy\(false\);setAuthError\(/.test(B7SRC), "submitNewPassword: .catch ends the busy state with a message");
      const CFG = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
      assert.ok(CFG.includes("async _probeLinkPair(accessToken, refreshToken) {"), "config.js: the probe helper");
      const iUp = CFG.indexOf("async updatePassword(newPassword) {");
      const up = CFG.slice(iUp, iUp + 1500);
      assert.ok(iUp > 0 && /try \{[\s\S]*?fetch\(/.test(up) && up.includes('return { error: "No connection - try again" };'), "updatePassword: the fetch is inside try/catch and a throw answers 'No connection - try again'");
    });
  }

  /* ---------------- P16 B3. the viewer role (read-only account) - the Alerts filter + client gating pins ---------------- */
  console.log("\n[B3] Prompt 16 B3 (viewer: no 'not linked' banner, no trade card, the public full-schedule feed, an Alerts feed of schedule_published + open_shifts only)");
  {
    const B3SRC = fs.readFileSync(path.join(ROOT, "index-source.html"), "utf8").replace(/\r\n/g, "\n");
    const B3count = (s) => B3SRC.split(s).length - 1;
    const feed = [
      { id: "n1", type: "schedule_published", title: "Published", message: "m", data: {}, created_at: "2026-09-20T10:00:00Z" },
      { id: "n2", type: "open_shifts", title: "Open shifts", message: "m", data: {}, created_at: "2026-09-21T10:00:00Z" },
      { id: "n3", type: "trade_proposed", title: "Trade", message: "m", data: { from_surgeon_id: "s2", to_surgeon_id: "s3" }, created_at: "2026-09-22T10:00:00Z" },
      { id: "n4", type: "vacation_logged", title: "Vacation", message: "m", data: { surgeon_id: "s3" }, created_at: "2026-09-23T10:00:00Z" },
      { id: "n5", type: "schedule_changed", title: "Changed", message: "m", data: {}, created_at: "2026-09-23T11:00:00Z" },
      { id: "n6", type: "shift_reminder", title: "Reminder", message: "m", data: { surgeon_id: "s2" }, created_at: "2026-09-23T12:00:00Z" },
    ];
    const ids = (rows) => rows.map(n => n.id);
    check("B3: helpers.notifVisibleTo - a viewer reads schedule_published and open_shifts only; the scheduler and an account with a role but no roster link read everything; a linked surgeon reads the group-wide types plus the rows that name them; the per-device Clear watermark applies to every role", () => {
      assert.strictEqual(typeof H.notifVisibleTo, "function", "helpers.js exports notifVisibleTo");
      assert.deepStrictEqual(H.NOTIF_VIEWER_TYPES, ["schedule_published", "open_shifts"], "the viewer's two types are one exported list");
      assert.deepStrictEqual(ids(H.notifVisibleTo(feed, { isViewer: true })), ["n1", "n2"], "viewer: the publish notice and the open-shifts notice, nothing else");
      assert.deepStrictEqual(ids(H.notifVisibleTo(feed, { isViewer: true, isScheduler: true, mySurgeon: "s1" })), ["n1", "n2"], "isViewer wins over the other flags (a viewer is never a scheduler; belt and braces)");
      assert.deepStrictEqual(ids(H.notifVisibleTo(feed, { isScheduler: true, mySurgeon: "s1" })), ["n1", "n2", "n3", "n4", "n5", "n6"], "scheduler: everything");
      assert.deepStrictEqual(ids(H.notifVisibleTo(feed, { mySurgeon: "" })), ["n1", "n2", "n3", "n4", "n5", "n6"], "a role with no roster link yet (not a viewer): everything, as before B3");
      assert.deepStrictEqual(ids(H.notifVisibleTo(feed, { mySurgeon: "s3" })), ["n1", "n2", "n3", "n4", "n5"], "linked surgeon s3: the four group-wide types + the trade that names him + his vacation; not s2's reminder");
      assert.deepStrictEqual(ids(H.notifVisibleTo(feed, { mySurgeon: "s2" })), ["n1", "n2", "n3", "n5", "n6"], "linked surgeon s2: group-wide + the trade he proposed + his reminder; not s3's vacation");
      assert.deepStrictEqual(ids(H.notifVisibleTo(feed, { isViewer: true, clearedBefore: "2026-09-20T12:00:00Z" })), ["n2"], "viewer + a Clear watermark: only the rows after it");
      assert.deepStrictEqual(ids(H.notifVisibleTo(feed, { isScheduler: true, clearedBefore: "2026-09-23T10:30:00Z" })), ["n5", "n6"], "scheduler + a Clear watermark");
      assert.deepStrictEqual(H.notifVisibleTo(null, { isViewer: true }), [], "a non-array feed reads as empty (never throws)");
      assert.deepStrictEqual(ids(H.notifVisibleTo([feed[0], null, feed[1]], { isViewer: true })), ["n1", "n2"], "a null row is skipped");
    });
    check("B3 pins: isViewer is derived from user_profiles.role beside isCoordinator (role viewer, no roster link, and never a failed profile read); the unlinked banner, the Time off card, the trades section, the calendar-sync card, the Account line and the Alerts filter branch on it", () => {
      assert.strictEqual(B3count('  const isViewer = !!userProfile && userProfile.role === "viewer" && !userProfile.person_id && !profileLoadFailed;\n'), 1, "the isViewer const (a failed profile read keeps its own red banner and is never branded a viewer)");
      assert.ok(B3SRC.indexOf("const isViewer = ") > B3SRC.indexOf("const isUnlinked = "), "declared after isUnlinked, before the first render");
      assert.strictEqual(B3count("{!isPublicMode && isUnlinked && !isCoordinator && !isViewer && ("), 1, "the unlinked-account banner never renders for a viewer (a failed profile read still does: profileLoadFailed keeps isViewer false)");
      assert.strictEqual(B3count("useMemo(() => notifVisibleTo(notifications, { isScheduler, isViewer, mySurgeon, clearedBefore: notifClearedBefore }), [notifications, isScheduler, isViewer, mySurgeon, notifClearedBefore]);"), 1, "myNotifications is the helper with isViewer in its inputs and its deps");
      assert.strictEqual(B3count("if (isCoordinator || isViewer) return null; // Prompt 16 A7 / B3"), 1, "the trades section (the card and the request list) returns null for a viewer as for the office");
      assert.strictEqual(B3count('{!mySurgeon && !canEnterForAnyone && !isViewer ? <p style={muted}>Your account is not linked to a roster entry yet - the scheduler will link it.</p> : ('), 1, "the Time off card's 'not linked' sentence is not shown to a viewer");
      assert.strictEqual(B3count("{!isViewer && renderVacationForm("), 1, "no vacation form for a viewer");
      assert.strictEqual(B3count("{renderVacationList(canEnterForAnyone || isViewer ? surgeons.map(s => s.id) : [mySurgeon], !isViewer)}"), 1, "a viewer reads the whole group's vacation list read-only (allowEdit false)");
      assert.strictEqual(B3count('data-testid="viewer-timeoff-note"'), 1, "the viewer's own Time off sentence (one, instead of the 'not linked' one twice)");
      assert.strictEqual(B3count("{(isScheduler || isViewer) && <>"), 1, "the calendar-sync card's full-schedule block renders for a viewer");
      assert.strictEqual(B3count('data-testid="calsync-full"'), 1, "the full-schedule feed input carries a test id");
      assert.strictEqual(B3count('{isScheduler ? "these URLs" : isViewer ? "the full-schedule feed" : "your personal URL"}'), 1, "the card's sentence names the full-schedule feed for a viewer");
      assert.strictEqual(B3count('(userProfile?.display_name || (isViewer ? "a read-only account" : "unlinked account"))'), 1, "the Account line does not call a viewer 'unlinked'");
      assert.strictEqual(B3count('["timeoff", isCoordinator || isViewer ? "Time off" : "Time off & Trades"]'), 1, "the nav tab reads 'Time off' for a viewer or the office - the trades section returns null for both, so the label must not promise trades");
      // The per-surgeon pills stay the scheduler's: the block that maps surgeons to calendar-sync?surgeon= pills is inside an isScheduler-only guard.
      const calCard = B3SRC.slice(B3SRC.indexOf("<div style={css.cardT}>Live calendar sync</div>"), B3SRC.indexOf("Requires the calendar-sync edge function"));
      assert.ok(calCard.includes("{isScheduler && <>") && calCard.indexOf("{isScheduler && <>") < calCard.indexOf("Per surgeon (matched on code)"), "the per-surgeon pills stay behind isScheduler");
      assert.ok(calCard.indexOf("{(isScheduler || isViewer) && <>") < calCard.indexOf("Full schedule:") && calCard.indexOf("Full schedule:") < calCard.indexOf("{isScheduler && <>"), "the full-schedule block is the shared one, before the per-surgeon block");
      assert.ok(calCard.includes("{mySurgeon && (() => {"), "the personal URL block still keys on the roster link (a viewer has none, so no empty 'My calendar' block)");
    });
  }

  /* ---------------- B2. Prompt 16 B2 (the six regions read theme tokens; the contrast gate is in the chain) ---------------- */
  console.log("\n[B2] Prompt 16 B2 (notification settings, publish diff, snapshot list, SuCheck, open-shifts board, claim sheet carry no literal text colour; test/ui/contrast.mjs gates the chain)");
  {
    const REG = require(path.join(ROOT, "test", "ui", "theme-regions.js"));
    const B2SRC = fs.readFileSync(path.join(ROOT, "index-source.html"), "utf8").replace(/\r\n/g, "\n");
    const regionText = (key) => REG.extractRegion(B2SRC, REG.REGIONS.find(r => r.key === key)).text;
    const countIn = (s, n) => (s.match(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
    check("the six regions are found by unique anchors and none carries a literal of the old set (#3a4a58, #7a8a98, #c04040, #5a6a78, #8a94a0, #1a8040, #f0f2f4)", () => {
      assert.deepStrictEqual(REG.REGIONS.map(r => r.key), ["notif-settings", "publish-diff", "snapshot-list", "sucheck", "openshifts-board", "claim-sheet"]);
      for (const r of REG.REGIONS) {
        const { text } = REG.extractRegion(B2SRC, r);
        assert.ok(text.length > 200, r.key + ": the region slice is suspiciously short (" + text.length + " chars) - an anchor moved");
        for (const lit of REG.OLD_LITERALS) assert.ok(!new RegExp(lit, "i").test(text), `${r.key} (${r.label}) still carries ${lit}`);
      }
    });
    check("theme-regions.js scanRegion reads a plain literal, a dk-conditional pair, a 3-digit hex, the element name, the style's own background, font size / weight (large-text class) and skips borderColor / T.* values; darkPaintOf follows the dark sheet per element", () => {
      const snippet = [
        '<div style={{fontSize:12,color:"#3a4a58",lineHeight:1.5}}>a</div>',
        '<p style={{color:dk?"#c8d2dc":"#3a4a58"}}>b</p>',
        '<span style={{fontSize:10,fontWeight:700,padding:"2px 7px",background:"#faeaea",color:"#c04040",borderColor:"#eabcbc"}}>c</span>',
        '<h2 style={{ fontSize: 24, color: "#fff" }}>d</h2>',
        '<label style={{color:T.text,borderColor:"#000000"}}>e</label>',
        '<td style={{color:"#1a8040"}}>f</td>',
      ].join("\n");
      const hits = REG.scanRegion(snippet, 100);
      assert.deepStrictEqual(hits.map(h => [h.line, h.tag, h.light, h.dark, h.conditional, h.ownBg && h.ownBg.light, h.fontSize, h.fontWeight, REG.isLarge(h)]), [
        [100, "div", "#3a4a58", "#3a4a58", false, null, 12, 400, false],
        [101, "p", "#3a4a58", "#c8d2dc", true, null, null, 400, false],
        [102, "span", "#c04040", "#c04040", false, "#faeaea", 10, 700, false],
        [103, "h2", "#ffffff", "#ffffff", false, null, 24, 400, true],
        [105, "td", "#1a8040", "#1a8040", false, null, null, 400, false],
      ]);
      assert.deepStrictEqual(hits.map(REG.darkPaintOf), ["#3a4a58", "#c8d2dc", "#F06060", "#ffffff", "#C9D6E8"], "unmapped grey stays; conditional takes its dark arm; span #c04040 -> the sheet's #F06060; td -> the td rule");
      assert.throws(() => REG.extractRegion("x", REG.REGIONS[0]), /start anchor not found/);
      assert.throws(() => REG.extractRegion("<span>Notification settings</span> <span>Notification settings</span>", REG.REGIONS[0]), /not unique/);
    });
    check("no inline colour in the six regions is a hex literal at all - plain or dk-conditional (tokens only: T.text / T.muted / T.open / T.success, THEME.light.text in SuCheck, css.errBox)", () => {
      for (const r of REG.REGIONS) {
        const { text, firstLine } = REG.extractRegion(B2SRC, r);
        assert.deepStrictEqual(REG.scanRegion(text, firstLine).map(h => `line ${h.line} <${h.tag}> ${h.snippet}`), [], r.key + ": literal text colours");
      }
    });
    check("the regions read the tokens where the literals were; the publish notice paragraph appears once; the dark sheet repaints the SuCheck label's light token", () => {
      assert.ok(countIn(regionText("notif-settings"), "color:T.text") >= 2 && countIn(regionText("notif-settings"), "color:T.success") === 2, "notification settings: two T.text labels, two T.success");
      assert.ok(countIn(regionText("publish-diff"), "color:T.text") >= 2 && countIn(regionText("publish-diff"), "color:T.muted") >= 2 && regionText("publish-diff").includes('border:"1px solid " + T.border'), "publish diff: T.text lines, T.muted notes, T.border box");
      assert.strictEqual(countIn(regionText("publish-diff"), "The changes listed above are already saved"), 1, "the publish notice paragraph must appear once (the 9/23 theme commit had left a second copy under it)");
      assert.ok(countIn(regionText("snapshot-list"), "color:T.text") >= 1 && countIn(regionText("snapshot-list"), "color:T.muted") >= 3 && regionText("snapshot-list").includes("{...css.errBox,fontWeight:600}") && regionText("snapshot-list").includes('borderBottom:"1px solid " + T.border'), "snapshot list: T.text reason, T.muted stamp / empty / loading, css.errBox, T.border rows");
      assert.ok(regionText("sucheck").includes('data-sucheck="" style={css.suCheck}>'), "SuCheck: style={css.suCheck} + data-sucheck for the smoke probe");
      assert.ok(countIn(regionText("openshifts-board"), "color:T.open") === 2 && countIn(regionText("openshifts-board"), "color:T.muted") >= 6 && countIn(regionText("openshifts-board"), "color:T.success") === 1, "open-shifts board: OPEN + 'nobody' in T.open, the notes in T.muted, the empty row in T.success");
      assert.strictEqual(countIn(regionText("claim-sheet"), "color:T.muted"), 3, "claim sheet + e-mail dialog: three T.muted notes");
      const sheet = B2SRC.slice(B2SRC.indexOf("{darkMode && <style>{`"), B2SRC.indexOf("`}</style>}"));
      assert.ok(/label\[style\*="color: rgb\(31, 42, 58\)"\]\s*\{ color: #E6ECF5 !important; \}/.test(sheet), "the dark sheet must keep repainting label rgb(31, 42, 58) -> #E6ECF5 (SuCheck depends on it)");
    });
    check("THEME.light.success #1A8040 / THEME.dark.success #40C060 (the green the dark sheet already gave spans) exist in both token sets; css.suCheck is the light text token (rgb(31, 42, 58) for the dark sheet's label rule)", () => {
      const styles = require(path.join(ROOT, "app-styles.js"));
      assert.strictEqual(styles.THEME.light.success, "#1A8040"); assert.strictEqual(styles.THEME.dark.success, "#40C060");
      assert.ok(styles.css && styles.css.suCheck, "app-styles.js css.suCheck missing");
      assert.strictEqual(styles.css.suCheck.color, styles.THEME.light.text);
      assert.strictEqual(styles.css.suCheck.display, "inline-flex");
    });
    check("the contrast gate is in the deploy chain (package.json + a build.yml step run `node test/ui/contrast.mjs`) and its region table fails a tree that puts #3a4a58 back on the SuCheck label (1.59:1 dark) while passing this one", () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
      assert.ok(pkg.scripts.test.split("&&").map(s => s.trim()).includes("node test/ui/contrast.mjs"), "package.json test chain lacks `node test/ui/contrast.mjs`");
      const yml = fs.readFileSync(path.join(ROOT, ".github", "workflows", "build.yml"), "utf8");
      assert.ok(/run:\s*node test\/ui\/contrast\.mjs/.test(yml), "build.yml has no `run: node test/ui/contrast.mjs` step");
      assert.ok(/-\s*"test\/ui\/contrast\.mjs"/.test(yml) && /-\s*"test\/ui\/theme-regions\.js"/.test(yml), "build.yml paths filter must watch test/ui/contrast.mjs and test/ui/theme-regions.js");
      const good = 'data-sucheck="" style={css.suCheck}>';
      assert.ok(B2SRC.includes(good), "SuCheck label style not found");
      const bad = B2SRC.replace(good, 'data-sucheck="" style={{ ...css.suCheck, color: "#3a4a58" }}>');
      const { pathToFileURL } = require("url");
      const script = `import fs from "node:fs"; import { regionTable } from ${JSON.stringify(pathToFileURL(path.join(ROOT, "test", "ui", "contrast.mjs")).href)};
        const [good, bad] = JSON.parse(fs.readFileSync(0, "utf8"));
        const pick = (rows) => rows.filter(r => !r.ok).map(r => [r.region, r.theme, r.tag, r.literal, r.fg, r.bg, r.ratio]);
        console.log(JSON.stringify({ goodRows: regionTable(good).length, goodBad: pick(regionTable(good)), badBad: pick(regionTable(bad)) }));`;
      const r = require("child_process").spawnSync(process.execPath, ["--input-type=module", "-e", script], { input: JSON.stringify([B2SRC, bad]), encoding: "utf8", cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
      assert.strictEqual(r.status, 0, "contrast probe crashed: " + String(r.stderr || "").slice(0, 400));
      const out = JSON.parse(String(r.stdout || "").trim().split("\n").pop());
      assert.strictEqual(out.goodRows, 0, "this tree still has literal text colours in the six regions: " + JSON.stringify(out.goodBad));
      assert.deepStrictEqual(out.badBad, [["sucheck", "dark", "label", "#3a4a58", "#3a4a58", "#13294B", 1.59]], "the old literal must fail the region table in dark mode at 1.59:1 (light 9.13:1 passes)");
    });
    check("B2 review: the empty open-shifts row's T.success sits on an inner <span>, never on the <td> (the dark sheet's `td { color: #C9D6E8 !important }` beats an inline td colour, so a td-level token paints only in light mode); the smoke's b2 screenshots are fullPage (at 390 px the notification and snapshot cards sit below the fold)", () => {
      const board = regionText("openshifts-board");
      const emptyRow = board.slice(board.indexOf("{rows.length === 0 && <tr>"), board.indexOf("{rows.map(s => {"));
      assert.ok(emptyRow.length > 0 && emptyRow.length < 600, "the empty-row line moved");
      assert.ok(!/<td[^>]*color:T\.success/.test(emptyRow), "the empty row's <td> must not carry color:T.success (the td rule overrides it in dark mode)");
      assert.ok(/<td colSpan=\{canAct \? 7 : 6\} style=\{\{fontWeight:600,padding:"12px 8px"\}\}><span data-testid="openshifts-empty" style=\{\{color:T\.success\}\}>\{!loaded \? "Loading schedule"/.test(emptyRow), "the empty row's text sits in <span data-testid=\"openshifts-empty\" style={{color:T.success}}> (the sheet leaves a span's inline colour alone; T.success resolves to #40C060 in dark)");
      const smoke = fs.readFileSync(path.join(ROOT, "test", "ui", "smoke.mjs"), "utf8");
      assert.ok(smoke.includes("`b2-settings-${theme}-390.png`), fullPage: true })"), "the smoke's b2-settings-<theme>-390.png must be a fullPage screenshot so the PNG shows the two cards the probe measured");
      assert.ok(smoke.includes("`b2-openshifts-${theme}-390.png`), fullPage: true })"), "the smoke's b2-openshifts-<theme>-390.png must be a fullPage screenshot (the board's rows run past one 844 px viewport)");
      const styles = fs.readFileSync(path.join(ROOT, "app-styles.js"), "utf8");
      assert.ok(/Success green as running text \(Prompt 16 B2: "Saving", a sent test notification, the empty\n\s*\/\/ open-shifts board's <span>/.test(styles), "the app-styles.js success comment names the empty board's <span> (a td would be repainted by the dark sheet)");
    });
  }

  /* ---------------- Prompt 16 B4: the poll re-reads the own user_profiles row - a link made while the app is open shows up without a reload ---------------- */
  console.log("\n[B4] Prompt 16 B4 (the 60-second poll re-reads the own profile after ensureFresh; a new profile only when person_id / role / display_name moved)");
  {
    const B4SRC = fs.readFileSync(path.join(ROOT, "index-source.html"), "utf8").replace(/\r\n/g, "\n");
    const B4count = (s) => B4SRC.split(s).length - 1;
    const U = "00000000-0000-4000-8000-0000000000b4";
    const viewerRow = { id: U, person_id: null, role: "viewer", display_name: null, email: "x@example.com", created_at: "2026-09-01T00:00:00Z" };
    const linkedRow = { ...viewerRow, person_id: "s1", role: "surgeon" };
    check("B4: helpers.profilePollMerge - an unchanged row answers the SAME object with changed false; a moved person_id / role / display_name answers the fresh row with changed true (linked flags the null -> id move); null / '' / undefined are one value; an empty or foreign read keeps the profile; a failed mount read (_loadFailed) is replaced by any successful read", () => {
      assert.strictEqual(typeof H.profilePollMerge, "function", "helpers.js exports profilePollMerge");
      const prev = { id: U, person_id: null, role: "viewer", display_name: null };
      const same = H.profilePollMerge(prev, { ...viewerRow });
      assert.strictEqual(same.changed, false, "unchanged");
      assert.strictEqual(same.next, prev, "the same reference (React bails out of an identical setState)");
      const sameNorm = H.profilePollMerge({ id: U, person_id: "", role: "viewer", display_name: undefined }, { ...viewerRow, display_name: "" });
      assert.strictEqual(sameNorm.changed, false, "null / '' / undefined read as one value");
      const link = H.profilePollMerge(prev, { ...linkedRow });
      assert.strictEqual(link.changed, true, "person_id null -> s1 is a change");
      assert.strictEqual(link.linked, true, "linked: the account gained its roster link");
      assert.deepStrictEqual(link.moved, ["person_id", "role"], "the fields that moved, in the fixed order");
      assert.strictEqual(link.next.person_id, "s1"); assert.strictEqual(link.next.role, "surgeon"); assert.strictEqual(link.next.id, U);
      assert.strictEqual("_loadFailed" in link.next, false, "the fresh profile never carries the failed-read marker");
      const role = H.profilePollMerge({ id: U, person_id: "s1", role: "surgeon", display_name: "Khan" }, { ...linkedRow, role: "scheduler", display_name: "Khan" });
      assert.strictEqual(role.changed, true); assert.strictEqual(role.linked, false); assert.deepStrictEqual(role.moved, ["role"]);
      const name = H.profilePollMerge({ id: U, person_id: "s1", role: "surgeon", display_name: null }, { ...linkedRow, display_name: "F. Khan" });
      assert.strictEqual(name.changed, true); assert.deepStrictEqual(name.moved, ["display_name"]);
      const unlink = H.profilePollMerge({ id: U, person_id: "s1", role: "surgeon", display_name: null }, { ...viewerRow });
      assert.strictEqual(unlink.changed, true); assert.strictEqual(unlink.unlinked, true, "the link can also go away");
      const other = H.profilePollMerge({ id: U, person_id: "s1", role: "scheduler", display_name: null }, { ...linkedRow, id: "someone-else" });
      assert.strictEqual(other.changed, false, "a row for another account is never adopted");
      assert.strictEqual(H.profilePollMerge({ id: U, person_id: "s1", role: "scheduler", display_name: null }, null).changed, false, "an empty read keeps the profile (the own row is always readable - an empty answer is an RLS surprise, never an unlink)");
      assert.strictEqual(H.profilePollMerge(null, { ...linkedRow }).changed, false, "no profile yet (the mount read is in flight) - nothing to merge");
      assert.strictEqual(H.profilePollMerge({ id: U, person_id: "s1", role: "scheduler", display_name: null }, "junk").changed, false, "junk never throws");
      const rec = H.profilePollMerge({ id: U, person_id: null, role: "viewer", display_name: null, _loadFailed: true }, { ...viewerRow });
      assert.strictEqual(rec.changed, true, "a failed mount read replaced by a successful one is a change even when the three fields match (the red banner must clear)");
      assert.strictEqual(rec.recovered, true); assert.strictEqual("_loadFailed" in rec.next, false);
    });
    // behaviour: fetchProfile + refreshOwnProfile lifted out of the component verbatim and run against stub refs / a
    // stub fetch - each tick is one poll pass after ensureFresh; setUserProfile calls are the re-renders.
    const lift = () => {
      const start = B4SRC.indexOf("  const fetchProfile = async (userId) => {");
      const end = B4SRC.indexOf("  // After any successful sign-in: adopt the user, load the profile", start);
      if (start < 0 || end < 0) throw new Error("fetchProfile .. refreshOwnProfile block not found in index-source.html");
      const body = B4SRC.slice(start, end);
      if (!body.includes("const refreshOwnProfile = async (fr) => {")) throw new Error("refreshOwnProfile is not implemented next to fetchProfile");
      return body;
    };
    const mk = () => {
      const state = { renders: [], failedSets: [], toasts: [], warns: 0, gets: 0, answer: () => resp(200, [{ ...viewerRow }]) };
      const authUserRef = { current: { id: U, email: "x@example.com" } };
      const userProfileRef = { current: { id: U, person_id: null, role: "viewer", display_name: null } };
      const auth = { sessionExpired: false };
      const fetch = async (url, opts) => { state.gets++; state.lastUrl = String(url); state.lastAuth = opts && opts.headers && opts.headers.Authorization; return state.answer(); };
      const params = ["authUserRef", "userProfileRef", "auth", "fetch", "SUPABASE_URL", "dbAuthHeaders", "profilePollMerge", "setUserProfile", "setProfileLoadFailed", "showToast", "nameOf", "console"];
      const fn = new Function(...params, lift() + "\nreturn refreshOwnProfile;")(
        authUserRef, userProfileRef, auth, fetch, "https://example.invalid", () => ({ Authorization: "Bearer user-jwt", apikey: "anon" }), H.profilePollMerge,
        (p) => { state.renders.push(p); userProfileRef.current = p; }, (v) => state.failedSets.push(v), (m) => state.toasts.push(m), (id) => ({ s1: "Khan" }[id] || id), { warn: () => { state.warns++; }, log: () => {} });
      return { tick: fn, state, authUserRef, userProfileRef, auth };
    };
    const b4check = async (name, fn) => { try { await fn(); pass++; console.log("ok   " + name); } catch (e) { fail++; console.log("FAIL " + name + "\n     -> " + (e && e.message ? e.message : e)); } };
    await b4check("B4 behaviour: a poll tick whose row now carries person_id s1 flips the profile ONCE (one setUserProfile, one 'linked' toast naming Khan); the next ticks with the same row make the GET but never call setUserProfile; the GET is the own-row read with the user JWT", async () => {
      const t = mk();
      const r0 = await t.tick({ ok: true, expired: false, refreshed: false });
      assert.strictEqual(r0.applied, false, "tick 0 (unchanged viewer row): " + JSON.stringify(r0));
      assert.strictEqual(t.state.renders.length, 0, "no setUserProfile for an identical row");
      assert.ok(/\/rest\/v1\/user_profiles\?id=eq\.00000000-0000-4000-8000-0000000000b4&select=\*$/.test(t.state.lastUrl), "the own-row read: " + t.state.lastUrl);
      assert.strictEqual(t.state.lastAuth, "Bearer user-jwt", "dbAuthHeaders (the user JWT) on the read");
      t.state.answer = () => resp(200, [{ ...linkedRow }]);
      const r1 = await t.tick({ ok: true, expired: false, refreshed: false });
      assert.deepStrictEqual({ applied: r1.applied, reason: r1.reason }, { applied: true, reason: "linked" });
      assert.strictEqual(t.state.renders.length, 1, "exactly one setUserProfile");
      assert.strictEqual(t.state.renders[0].person_id, "s1"); assert.strictEqual(t.state.renders[0].role, "surgeon");
      assert.deepStrictEqual(t.state.toasts, ["Your account is now linked to Khan - Mine, your alerts and your offers follow it."]);
      const r2 = await t.tick({ ok: true, expired: false, refreshed: true });
      const r3 = await t.tick({ ok: true, expired: false, refreshed: false });
      assert.deepStrictEqual([r2.applied, r3.applied], [false, false], "unchanged ticks");
      assert.strictEqual(t.state.gets, 4, "every tick reads (4 GETs)");
      assert.strictEqual(t.state.renders.length, 1, "still one setUserProfile - no re-render for an unchanged row");
      assert.strictEqual(t.state.toasts.length, 1, "the link toast fires once");
      assert.deepStrictEqual(t.state.failedSets, [], "profileLoadFailed untouched when the mount read had succeeded");
    });
    await b4check("B4 behaviour: a role move (viewer -> scheduler) re-renders once without the link toast; a display_name move re-renders once; a failed read (HTTP 500) or an empty read ([]) keeps the current profile with a console warning and no setState; an expired session (fr.expired or auth.sessionExpired) makes no read at all", async () => {
      const t = mk();
      t.userProfileRef.current = { id: U, person_id: "s1", role: "viewer", display_name: null };
      t.state.answer = () => resp(200, [{ ...linkedRow, role: "scheduler" }]);
      const r1 = await t.tick({ ok: true, expired: false, refreshed: false });
      assert.deepStrictEqual({ applied: r1.applied, reason: r1.reason }, { applied: true, reason: "changed" });
      assert.strictEqual(t.state.renders.length, 1); assert.strictEqual(t.state.renders[0].role, "scheduler"); assert.deepStrictEqual(t.state.toasts, []);
      t.state.answer = () => resp(200, [{ ...linkedRow, role: "scheduler", display_name: "Dr Khan" }]);
      const r2 = await t.tick({ ok: true, expired: false, refreshed: false });
      assert.strictEqual(r2.applied, true); assert.strictEqual(t.state.renders.length, 2); assert.strictEqual(t.state.renders[1].display_name, "Dr Khan");
      t.state.answer = () => resp(500, "boom");
      const r3 = await t.tick({ ok: true, expired: false, refreshed: false });
      assert.deepStrictEqual({ applied: r3.applied, reason: r3.reason }, { applied: false, reason: "failed" });
      assert.strictEqual(t.state.warns, 1, "one warning for the failed read");
      t.state.answer = () => resp(200, []);
      const r4 = await t.tick({ ok: true, expired: false, refreshed: false });
      assert.deepStrictEqual({ applied: r4.applied, reason: r4.reason }, { applied: false, reason: "unchanged" }, "an empty read is not an unlink");
      assert.strictEqual(t.state.renders.length, 2, "no setState after the failed / empty reads");
      assert.strictEqual(t.userProfileRef.current.role, "scheduler", "the profile stayed");
      const gets = t.state.gets;
      const r5 = await t.tick({ ok: false, expired: true, refreshed: false });
      t.auth.sessionExpired = true;
      const r6 = await t.tick({ ok: true, expired: false, refreshed: false });
      assert.deepStrictEqual([r5.reason, r6.reason, t.state.gets], ["skipped", "skipped", gets], "no read on a dead session (the banner owns that state)");
    });
    await b4check("B4 behaviour: a failed mount read (the _loadFailed fallback) is replaced by the first successful poll read and profileLoadFailed clears - even when the row still reads viewer / unlinked; a recovered read that comes back LINKED applies the link but never shows the 'now linked' toast (the link may predate the session); a sign-out (authUserRef null) or an account switch while the read is in flight drops the answer; no profile yet (mount read in flight) reads nothing", async () => {
      const t = mk();
      t.userProfileRef.current = { id: U, person_id: null, role: "viewer", display_name: null, _loadFailed: true };
      const r1 = await t.tick({ ok: true, expired: false, refreshed: false });
      assert.deepStrictEqual({ applied: r1.applied, reason: r1.reason }, { applied: true, reason: "recovered" });
      assert.strictEqual(t.state.renders.length, 1); assert.strictEqual("_loadFailed" in t.state.renders[0], false);
      assert.deepStrictEqual(t.state.failedSets, [false], "setProfileLoadFailed(false) once");
      assert.deepStrictEqual(t.state.toasts, [], "no link toast - still unlinked");
      const r1b = await t.tick({ ok: true, expired: false, refreshed: false });
      assert.strictEqual(r1b.applied, false); assert.strictEqual(t.state.renders.length, 1);
      // recovered AND linked: the failed mount fallback is unlinked, the first good read carries s1 - the link is applied,
      // the banner clears, but the toast stays silent (the merge says linked, yet the link may predate this session)
      t.userProfileRef.current = { id: U, person_id: null, role: "viewer", display_name: null, _loadFailed: true };
      t.state.answer = () => resp(200, [{ ...linkedRow }]);
      const r1c = await t.tick({ ok: true, expired: false, refreshed: false });
      assert.deepStrictEqual({ applied: r1c.applied, reason: r1c.reason }, { applied: true, reason: "recovered" });
      assert.strictEqual(t.state.renders.length, 2); assert.strictEqual(t.state.renders[1].person_id, "s1", "the link is applied");
      assert.deepStrictEqual(t.state.failedSets, [false, false], "profileLoadFailed clears again");
      assert.deepStrictEqual(t.state.toasts, [], "no 'now linked' toast on a recovered read, even when it comes back linked");
      t.state.answer = () => resp(200, [{ ...viewerRow }]);
      t.userProfileRef.current = { id: U, person_id: null, role: "viewer", display_name: null };
      t.state.renders.length = 0; t.state.failedSets.length = 0;
      // sign-out mid-read
      t.state.answer = () => { t.authUserRef.current = null; return resp(200, [{ ...linkedRow }]); };
      const r2 = await t.tick({ ok: true, expired: false, refreshed: false });
      assert.deepStrictEqual({ applied: r2.applied, reason: r2.reason }, { applied: false, reason: "stale" });
      assert.strictEqual(t.state.renders.length, 0, "nothing applied after a sign-out");
      // account switch mid-read (adoptSignedInUser replaced the profile object)
      t.authUserRef.current = { id: U };
      t.state.answer = () => { t.userProfileRef.current = { id: U, person_id: "s2", role: "surgeon", display_name: null }; return resp(200, [{ ...linkedRow }]); };
      const r3 = await t.tick({ ok: true, expired: false, refreshed: false });
      assert.strictEqual(r3.reason, "stale"); assert.strictEqual(t.state.renders.length, 0);
      // no profile yet
      t.userProfileRef.current = null; const gets = t.state.gets;
      const r4 = await t.tick({ ok: true, expired: false, refreshed: false });
      assert.strictEqual(r4.reason, "skipped"); assert.strictEqual(t.state.gets, gets, "no read before the mount profile exists");
    });
    check("B4 pins: authUserRef / userProfileRef mirror the two states; refreshAll runs refreshOwnProfile(fr) inside its Promise.allSettled AFTER ensureFresh (A3's order kept); the poll and the realtime SUBSCRIBED handler both go through refreshAll (one read site); setUserProfile has exactly five call sites (adopt x2, sign-out, the Users card editing the admin's own row, the poll)", () => {
      assert.strictEqual(B4count("useEffect(() => { authUserRef.current = authUser; }, [authUser]);"), 1, "authUserRef mirror");
      assert.strictEqual(B4count("useEffect(() => { userProfileRef.current = userProfile; }, [userProfile]);"), 1, "userProfileRef mirror");
      const ra = B4SRC.indexOf("const refreshAll = async () => {");
      const raBody = B4SRC.slice(ra, B4SRC.indexOf("    };", ra));
      const iFresh = raBody.indexOf("const fr = await auth.ensureFresh();"), iSettle = raBody.indexOf("await Promise.allSettled(["), iOwn = raBody.indexOf("refreshOwnProfile(fr),");
      assert.ok(iFresh > 0 && iSettle > iFresh && iOwn > iSettle, "refreshAll: ensureFresh, then the settled batch that includes refreshOwnProfile(fr): " + raBody);
      assert.strictEqual(B4count("refreshOwnProfile(fr)"), 1, "one call site (the poll and the SUBSCRIBED handler share refreshAll)");
      assert.strictEqual(B4count("const pollInterval = setInterval(refreshAll, 60000);"), 1, "the 60-second poll");
      assert.strictEqual(B4count("setUserProfile("), 5, "setUserProfile call sites: adoptSignedInUser (ok + failed), handleSignOut, the Users card PATCH of the admin's own row, refreshOwnProfile");
    });
  }

  // ---------------- [B9] Prompt 16 B9 (nine client items from the 9/23 review, section 3) ----------------
  {
    console.log("\n[B9] Prompt 16 B9 (Generate in a worker with an honest busy line; day-editor discard guard + focus trap; banners under the dialogs; notification / saved toasts only after the fact; contact delete checks the row; pattern rows keyed by id; empty schedule read tripwire; todayCentral everywhere)");
    const B9SRC = fs.readFileSync(path.join(ROOT, "index-source.html"), "utf8").replace(/\r\n/g, "\n");
    const B9count = (needle, hay) => (hay || B9SRC).split(needle).length - 1;
    const B9slice = (from, to) => { const i = B9SRC.indexOf(from); assert.ok(i >= 0, "anchor missing: " + from); const j = B9SRC.indexOf(to, i + from.length); assert.ok(j > i, "end anchor missing: " + to); return B9SRC.slice(i, j); };
    const ref = (v) => ({ current: v });

    // (a) the Generate worker: helpers.genWorkerSource builds the script; run it in a worker-shaped sandbox (self,
    // importScripts, postMessage - NO window, document or localStorage) over the seed and check the answers.
    await (async () => {
      const SA = require(path.join(__dirname, "seed-adapter.js"));
      const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "silvis-seed.json"), "utf8"));
      const urls = ["helpers.js", "rules.js", "generator.js"].map(f => "https://example.test/app/" + f + "?v=2026.09.24x");
      let script = null;
      check("B9a: genWorkerSource(urls) is a classic-worker script - importScripts of exactly the three page modules in load order (helpers, rules, generator; no config.js, no east-feed.js), an onmessage handler, no window / document / localStorage", () => {
        assert.strictEqual(typeof H.genWorkerSource, "function", "helpers.genWorkerSource");
        assert.deepStrictEqual(H.GEN_WORKER_MODULES, ["helpers.js", "rules.js", "generator.js"], "helpers.GEN_WORKER_MODULES");
        script = H.genWorkerSource(urls);
        assert.ok(script.includes('importScripts("https://example.test/app/helpers.js?v=2026.09.24x", "https://example.test/app/rules.js?v=2026.09.24x", "https://example.test/app/generator.js?v=2026.09.24x");'), script);
        assert.ok(script.includes("self.onmessage = function (ev) {"), "onmessage handler");
        assert.ok(!/\b(window|document|localStorage|config\.js|east-feed\.js)\b/.test(script), "no page-only globals: " + script);
      });
      if (!script) return;
      const posted = [];
      const sandbox = { console: { warn: () => {}, log: () => {}, error: () => {} }, Date, Math, JSON, Object, Array, Set, Map, Number, String, Boolean, RegExp, Error, TypeError, RangeError, Intl, parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, setTimeout, clearTimeout };
      sandbox.self = sandbox;
      sandbox.postMessage = (m) => posted.push(structuredClone(m)); // a worker's postMessage structured-clones: a function or a memo in the answer would throw here too
      const loaded = [];
      const ctxv = vm.createContext(sandbox);
      sandbox.importScripts = (...us) => us.forEach(u => { const f = u.split("/").pop().split("?")[0]; loaded.push(f); vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctxv, { filename: f }); });
      const input = SA.seedToContextInput(seed, {});
      check("B9a: the worker script loads the three modules without window / document (their top level touches neither) and the seed inputs survive a structured clone (rows, Sets - no functions)", () => {
        vm.runInContext(script, ctxv, { filename: "generate-worker.js" });
        assert.deepStrictEqual(loaded, ["helpers.js", "rules.js", "generator.js"]);
        assert.strictEqual(typeof ctxv.onmessage, "function", "self.onmessage installed");
        assert.strictEqual(typeof ctxv.buildContext, "function", "rules.js buildContext is a worker global");
        assert.strictEqual(typeof ctxv.generate, "function", "generator.js generate is a worker global");
        structuredClone(input);
      });
      check("B9a: a { id, inputs, start, end, opts } message answers { id, ok: true, schedule, diagnostics } for the seed over 10/05-10/18 (buildContext + generate inside the worker; the answer itself clones)", () => {
        ctxv.onmessage({ data: { id: 7, inputs: structuredClone(input), start: "2026-10-05", end: "2026-10-18", opts: { seed: 11, bestOf: 3, respectLocks: true, fillOpenOnly: false, timeBudgetMs: 8000 } } });
        assert.strictEqual(posted.length, 1, "one answer");
        const a = posted[0];
        assert.strictEqual(a.id, 7); assert.strictEqual(a.ok, true, JSON.stringify(a).slice(0, 300));
        const days = Object.keys(a.schedule).filter(d => d >= "2026-10-05" && d <= "2026-10-18");
        assert.strictEqual(days.length, 14, "every day of the range in the answer: " + days.length);
        // 10/15 primary is OPEN in the seed on purpose (rules doc section 8), so not every primary fills: the contract is
        // that every empty slot is named in diagnostics.uncovered - never silently left empty.
        const emptyP = days.filter(d => !a.schedule[d].primary);
        assert.ok(emptyP.length <= 2, "at most the deliberately open day(s) empty: " + emptyP.join(", "));
        assert.ok(Array.isArray(a.diagnostics.uncovered), "diagnostics.uncovered is a list");
        emptyP.forEach(d => assert.ok(JSON.stringify(a.diagnostics.uncovered).includes(d), d + " empty but not in diagnostics.uncovered: " + JSON.stringify(a.diagnostics.uncovered).slice(0, 300)));
        assert.ok(a.diagnostics && typeof a.diagnostics.candidatesTried === "number" && a.diagnostics.candidatesTried >= 1, "diagnostics.candidatesTried: " + JSON.stringify(a.diagnostics).slice(0, 200));
        assert.ok(Array.isArray(a.warnings), "ctx warnings array");
      });
      check("B9a: a bad message (no inputs) answers { ok: false, error } and never throws out of onmessage (the page falls back to the inline run)", () => {
        assert.doesNotThrow(() => ctxv.onmessage({ data: { id: 8, inputs: null, start: "2026-10-05", end: "2026-10-06", opts: {} } }));
        assert.strictEqual(posted.length, 2);
        assert.strictEqual(posted[1].id, 8); assert.strictEqual(posted[1].ok, false); assert.ok(/inputs/.test(posted[1].error), posted[1].error);
        assert.doesNotThrow(() => ctxv.onmessage({}));
        assert.strictEqual(posted[2].ok, false);
      });
      check("B9a pins: runGenerate tries generateInWorker first and runs inline only when the worker is unsupported or failed (genWorkerBroken); the worker module list and ?v URLs come from GEN_WORKER_MODULES + APP_VERSION; GeneratePanel's busy line names where the run is (worker: the page stays usable; inline: it may pause) and the old 'stays responsive between candidates' claim is gone", () => {
        const rg = B9slice("  const runGenerate = async (o) => {", "  const rerollGenerate = () => {");
        const iW = rg.indexOf("await generateInWorker("), iI = rg.indexOf("generate(built.ctx, start, end,");
        assert.ok(iW > 0 && iI > iW, "worker first, inline after: " + iW + " / " + iI);
        assert.ok(rg.includes("setGenWorkerBroken(true)"), "a failed worker run marks the device inline from then on");
        assert.ok(rg.includes("genWorkerOk"), "the worker path is gated on genWorkerOk");
        assert.strictEqual(B9count("const genWorkerUrls = () => GEN_WORKER_MODULES.map(f => new URL(f + \"?v=\" + APP_VERSION, location.href).href);"), 1, "the module URLs carry the page's ?v");
        assert.strictEqual(B9count("URL.createObjectURL(new Blob([genWorkerSource(urls)], { type: \"text/javascript\" }))"), 1, "a Blob-built worker (no second script file)");
        assert.strictEqual(B9count("const [genWorkerBroken, setGenWorkerBroken] = useState(false);"), 1);
        assert.strictEqual(B9count("const genWorkerOk = genWorkerSupported() && !genWorkerBroken;"), 1);
        const gp = B9slice("function GeneratePanel({", "\n}\n");
        assert.ok(gp.includes("busyMode"), "GeneratePanel takes busyMode");
        assert.ok(gp.includes('busyMode === "worker"'), "two busy lines");
        assert.ok(gp.includes("in a background worker - the page stays usable while it runs") && gp.includes("on this page - it may pause for a few seconds until the run finishes"), "the two honest lines: " + gp.slice(gp.indexOf("gen-busy"), gp.indexOf("gen-busy") + 400));
        assert.strictEqual(B9count("the page stays responsive between candidates"), 0, "the untrue line is gone");
        assert.strictEqual(B9count('busyMode={genWorkerOk ? "worker" : "inline"}'), 1, "the app passes the mode it will really use");
      });
    })();

    // (b) the day editor: a dirty draft is never discarded without asking (backdrop, Escape, the x and Cancel go through
    // requestClose), Tab cycles inside the dialog, focus lands in it on open and goes back to the opener on close.
    check("B9b: focusTrapNext - Tab on the last focusable wraps to the first, Shift+Tab on the first wraps to the last, focus outside the dialog comes back in, anything else is left to the browser", () => {
      const a = {}, b = {}, c = {}, out = {};
      assert.strictEqual(H.focusTrapNext(false, [a, b, c], c), a);
      assert.strictEqual(H.focusTrapNext(true, [a, b, c], a), c);
      assert.strictEqual(H.focusTrapNext(false, [a, b, c], b), null);
      assert.strictEqual(H.focusTrapNext(true, [a, b, c], b), null);
      assert.strictEqual(H.focusTrapNext(false, [a, b, c], out), a);
      assert.strictEqual(H.focusTrapNext(true, [a, b, c], out), c);
      assert.strictEqual(H.focusTrapNext(false, [], a), null);
      assert.strictEqual(H.focusTrapNext(false, null, a), null);
    });
    check("B9b pins: DayEditor - requestClose asks (confirm) only when dirty and is what the backdrop, the x, Cancel and Escape call; no path closes a dirty editor silently; the dialog traps Tab (dialogKeyDown over every focusable), takes focus on open (tabIndex -1) unless the caller asked for the external-cover input, and returns focus to the opener", () => {
      const de = B9slice("function DayEditor(props) {", "// ===================== SETUP VIEW COMPONENTS");
      assert.ok(de.includes("const requestClose = () => {"), "requestClose");
      const rc = de.slice(de.indexOf("const requestClose = () => {"), de.indexOf("};", de.indexOf("const requestClose = () => {")));
      assert.ok(rc.includes("if (dirty && !confirm(") && rc.includes("onCancel();"), "asks only when dirty, then onCancel: " + rc);
      assert.strictEqual(B9count('<div data-testid="day-editor" onClick={requestClose}', de), 1, "backdrop tap goes through requestClose");
      assert.strictEqual(B9count("onClick={onCancel}", de), 0, "no direct onCancel click left (x and Cancel ask too)");
      assert.strictEqual(B9count("onClick={requestClose}", de), 3, "backdrop, x, Cancel");
      assert.ok(de.includes('if (e.key === "Escape") { e.preventDefault(); if (pending) setPending(null); else requestClose(); return; }'), "Escape asks when dirty");
      assert.ok(de.includes("const dialogKeyDown = (e) => {") && de.includes("focusTrapNext(e.shiftKey, focusable, document.activeElement)"), "the Tab trap uses the helper");
      assert.ok(de.includes('onKeyDown={dialogKeyDown}') && de.includes("tabIndex={-1}") && de.includes("ref={dialogRef}"), "the dialog element takes the handler, a tabIndex and a ref");
      assert.ok(de.includes("openerRef.current = document.activeElement"), "the opener is remembered");
      assert.ok(de.includes("if (!focusExternal && dialogRef.current) dialogRef.current.focus();"), "focus lands in the dialog on open unless the external input was asked for");
    });

    // (c) the fixed banners paint UNDER every dialog and sheet: z 9200 < painter sheets 9300 < day editor / claim sheet 9500.
    check("B9c pins: the three fixed bottom banners are zIndex 9200, below the painter sheets (9300), the day editor and the claim sheet (9500) - a banner never covers a sticky Save row or the claim buttons; the toast stays on top (9999)", () => {
      const banners = ['data-testid="session-expired"', "This app version ({APP_VERSION}) is below the required minimum", "New version available ({updateAvailable})"];
      banners.forEach(b => { const at = B9SRC.indexOf(b); assert.ok(at > 0, b); const around = B9SRC.slice(B9SRC.lastIndexOf("\n", B9SRC.lastIndexOf("\n", at) - 1), B9SRC.indexOf("\n", at)); assert.ok(/zIndex:9200/.test(around), b + " -> " + around.slice(0, 200)); }); // the anchor's line and the one before it
      assert.strictEqual(B9count("zIndex:9998"), 0, "no banner left at 9998");
      assert.strictEqual(B9count("zIndex:9200"), 3, "exactly the three banners");
      assert.ok(B9SRC.split("\n").find(l => l.includes('data-testid="day-editor" onClick')).includes("zIndex:9500"), "day editor 9500");
      assert.ok(B9SRC.split("\n").find(l => l.includes('data-testid="claim-sheet"')).includes("zIndex:9500"), "claim sheet 9500");
      assert.strictEqual(B9count('data-testid="ofp-sheet" style={{ position: "fixed", inset: 0, zIndex: 9300'), 1, "painter sheet 9300");
      assert.ok(B9SRC.split("\n").find(l => l.includes('data-testid="toast"')).includes("zIndex:9999"), "toast 9999");
    });

    // (d) "Browser notification sent." only when new Notification() did not throw.
    await (async () => {
      const start = B9SRC.indexOf("  const sendBrowserNotif = useCallback((title, body, tag, forceShow) => {");
      const endMark = "  }, [browserNotifPermission]);";
      const end = B9SRC.indexOf(endMark, start);
      assert.ok(start > 0 && end > start, "sendBrowserNotif anchors");
      const body = B9SRC.slice(start, end + endMark.length);
      const mk = (permission, NotificationCtor, focused) => new Function("useCallback", "browserNotifPermission", "document", "Notification", "console", body + "\nreturn sendBrowserNotif;")((fn) => fn, permission, { hasFocus: () => !!focused }, NotificationCtor, { warn: () => {} });
      const shown = [];
      const Good = function (t, o) { shown.push([t, o && o.body]); };
      const Throws = function () { throw new TypeError("Illegal constructor"); }; // what an iPhone's Safari page context says
      check("B9d: sendBrowserNotif answers true only when new Notification() succeeded - false when it throws (iOS), when permission is not granted, and when the app has focus without forceShow", () => {
        assert.strictEqual(mk("granted", Good, false)("t", "b", "x", true), true);
        assert.deepStrictEqual(shown, [["t", "b"]]);
        assert.strictEqual(mk("granted", Throws, false)("t", "b", "x", true), false, "a throwing constructor is not a sent notification");
        assert.strictEqual(mk("default", Good, false)("t", "b", "x", true), false, "no permission");
        assert.strictEqual(mk("granted", Good, true)("t", "b", "x", false), false, "focused, not forced");
        assert.strictEqual(shown.length, 1);
      });
      check("B9d: notifTestMessage - the sent line only for a shown notification; otherwise the reason (blocked / not allowed yet / the browser could not show one, e.g. an iPhone without the Home Screen install)", () => {
        assert.strictEqual(H.notifTestMessage(true, "granted"), "Browser notification sent.");
        assert.ok(/blocked/i.test(H.notifTestMessage(false, "denied")) && /nothing was shown/i.test(H.notifTestMessage(false, "denied")), H.notifTestMessage(false, "denied"));
        assert.ok(/not allowed yet/i.test(H.notifTestMessage(false, "default")), H.notifTestMessage(false, "default"));
        assert.ok(/could not show/i.test(H.notifTestMessage(false, "granted")) && /Home Screen/.test(H.notifTestMessage(false, "granted")), H.notifTestMessage(false, "granted"));
        assert.ok(!/sent/i.test(H.notifTestMessage(false, "granted")));
      });
      check("B9d pins: sendTestNotification reads the boolean and shows notifTestMessage(shown, browserNotifPermission); the unconditional 'Browser notification sent.' is gone; the e-mail line says the pop-up state truthfully", () => {
        const st = B9slice("  const sendTestNotification = useCallback(async () => {", "  }, [sendBrowserNotif, sendEmailNotif, mySurgeon");
        assert.ok(st.includes("const shown = sendBrowserNotif("), "reads the answer");
        assert.ok(st.includes("notifTestMessage(shown, browserNotifPermission)"), "the helper picks the line");
        assert.strictEqual(B9count('setNotifTestSent("Browser notification sent.")'), 0, "no unconditional sent line");
        assert.ok(st.includes('(shown ? "Browser pop-up shown" : "No browser pop-up") + " + email test sent'), "the e-mail line carries the pop-up truth: " + st);
      });
    })();

    // (e) group rules / holidays: the toast says saved only after the blob write returned.
    check("B9e: setupSaveToasts - ONE toast naming every distinct label (showToast is single-slot: a second toast replaces the first, so 'Group rules and Holiday units saved.' is one line); 'saved.' as success after a write, 'NOT saved - <why>' as error otherwise; nothing for no waiters", () => {
      assert.deepStrictEqual(H.setupSaveToasts(["Group rules", "Holiday units", "Group rules"], true), [{ text: "Group rules and Holiday units saved.", tone: "success" }]);
      assert.deepStrictEqual(H.setupSaveToasts(["Group rules", "Holiday units", "Roster"], false, "no permission"), [{ text: "Group rules, Holiday units and Roster NOT saved - no permission.", tone: "error" }]);
      assert.deepStrictEqual(H.setupSaveToasts(["Holiday units"], false, "no permission"), [{ text: "Holiday units NOT saved - no permission.", tone: "error" }]);
      assert.deepStrictEqual(H.setupSaveToasts(["Group rules"], false, "the setup changed elsewhere and was reloaded."), [{ text: "Group rules NOT saved - the setup changed elsewhere and was reloaded.", tone: "error" }]);
      assert.deepStrictEqual(H.setupSaveToasts(["Group rules"], false), [{ text: "Group rules NOT saved - the write did not go through.", tone: "error" }]);
      assert.deepStrictEqual(H.setupSaveToasts([], true), []);
      assert.deepStrictEqual(H.setupSaveToasts(null, true), []);
    });
    check("B9e pins: saveGroupRules / saveHolidays register a waiter (awaitBlobWrite) instead of toasting 'saved.' at once; the blob leg settles the waiters on every exit - saved / skipped / landed earlier as saved, a CAS-miss reload, the wiped guard, the not-loaded guard, the load-failed and hydration returns and the catch as NOT saved with the reason", () => {
      const gr = B9slice("  const saveGroupRules = (next) => {", "  const saveHolidays = (next) => {");
      const hol = B9slice("  const saveHolidays = (next) => {", "  // Users (admin).");
      assert.ok(gr.includes('awaitBlobWrite("Group rules")') && !gr.includes('showToast("Group rules saved."'), gr);
      assert.ok(hol.includes('awaitBlobWrite("Holiday units")') && !hol.includes('showToast("Holiday units saved."'), hol);
      assert.strictEqual(B9count("const blobWaitersRef = useRef([]);"), 1);
      assert.strictEqual(B9count("const settleBlobWaiters = (ok, why) => settleWaiters(takeBlobWaiters(), ok, why);"), 1);
      const leg = B9slice("    // Leg 2 - the config blob.", "  }, [loaded, surgeons, surgeonRules, groupRules, holidays, settings, lastPublished, lastGenerate, saveTick]);");
      assert.ok(leg.includes('const r = await saveBlobNow(payload, "autosave");'), "the write");
      const after = leg.slice(leg.indexOf('const r = await saveBlobNow(payload, "autosave");'));
      assert.ok(after.includes("if (r && r.reloaded) settleWaiters(mine, false, \"the setup changed on another device and was reloaded - check it and save again\"); else settleWaiters(mine, true);"), "settled after the write returns: " + after.slice(0, 400));
      assert.ok(/catch \(e\) \{[\s\S]*settleWaiters\(mine, false, /.test(after), "the catch settles NOT saved");
      assert.strictEqual(B9count("settleWaiters(mine, false, \"empty data was not written\")", leg), 1, "the wiped guard");
      assert.strictEqual(B9count("settleWaiters(mine, false, \"the shared setup did not load this session\")", leg), 1, "the not-loaded guard");
      const legHead = B9slice("  useEffect(() => {\n    if (!loaded) return;\n    if (isPublicMode) return;  // Public viewers never write to the DB", "    // Leg 2 - the config blob.");
      assert.ok(legHead.includes('settleBlobWaiters(false, "the app is still loading - save again in a moment")'), "the hydration-window return: " + legHead);
      assert.ok(legHead.includes('settleBlobWaiters(false, "data failed to load")'), "the load-failed return");
      assert.ok(leg.includes('if (!canWriteBlob) { settleBlobWaiters(false, "this account cannot write the shared setup"); return; }'), "the role gate");
    });

    // (f) deleteOfficeContact: DELETE with return=representation; zero rows back = nothing deleted -> error toast, list untouched.
    await (async () => {
      const start = B9SRC.indexOf("  const deleteOfficeContact = async (id) => {");
      const end = B9SRC.indexOf("\n  };\n", start);
      assert.ok(start > 0 && end > start, "deleteOfficeContact anchors");
      const body = B9SRC.slice(start, end + 5);
      const mk = (status, rows) => {
        const s = { toasts: [], sets: 0, audits: [], req: null };
        const fetchStub = async (url, init) => { s.req = { url, init }; return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(rows), json: async () => rows }; };
        const fn = new Function("officeContacts", "confirm", "fetch", "SUPABASE_URL", "dbAuthHeaders", "showToast", "setOfficeContacts", "logAudit", "console", "describeDbError", body + "\nreturn deleteOfficeContact;")(
          [{ id: "c1", name: "Front desk" }], () => true, fetchStub, "https://x.supabase.co", () => ({ apikey: "k", Authorization: "Bearer t" }), (m, tone) => s.toasts.push({ m, tone }), () => { s.sets++; }, (k, m, meta) => s.audits.push({ k, meta }), { warn: () => {} }, (e) => String(e));
        return { fn, s };
      };
      await (async () => {
        const { fn, s } = mk(200, []);
        await fn("c1");
        check("B9f: a 2xx DELETE that returns ZERO rows (RLS filtered it) is not a deletion - the contact stays, an error toast names it, no audit row; the request asks for the representation with dbAuthHeaders", () => {
          assert.strictEqual(s.sets, 0, "the list is untouched");
          assert.strictEqual(s.audits.length, 0, "no audit row");
          assert.strictEqual(s.toasts.length, 1, "one toast: " + JSON.stringify(s.toasts)); assert.strictEqual(s.toasts[0].tone, "error"); assert.ok(/No contact row was removed/.test(s.toasts[0].m), s.toasts[0].m);
          assert.strictEqual(s.req.init.method, "DELETE");
          assert.strictEqual(s.req.init.headers.Prefer, "return=representation", JSON.stringify(s.req.init.headers));
          assert.strictEqual(s.req.init.headers.Authorization, "Bearer t", "dbAuthHeaders kept");
        });
      })();
      await (async () => {
        const a = mk(200, [{ id: "c1" }]);
        await a.fn("c1");
        const b = mk(403, { message: "denied" });
        await b.fn("c1");
        check("B9f: a DELETE that returns the row removes it from the list and audits it; a non-2xx answer is the connection toast and nothing else", () => {
          assert.strictEqual(a.s.sets, 1); assert.strictEqual(a.s.audits.length, 1); assert.deepStrictEqual(a.s.audits[0].meta, { id: "c1" }); assert.strictEqual(a.s.toasts.length, 0);
          assert.strictEqual(b.s.sets, 0); assert.strictEqual(b.s.audits.length, 0); assert.strictEqual(b.s.toasts.length, 1); assert.strictEqual(b.s.toasts[0].tone, "error");
        });
      })();
    })();

    // (g) PatternListEditor rows keyed by a stable id, not the index.
    check("B9g: suPatternRowIds - the same length answers the same array (stable keys), a longer list appends fresh unique ids, a shorter list (an outside reset) truncates; ids never repeat across calls", () => {
      const a = H.suPatternRowIds([], 2);
      assert.strictEqual(a.length, 2); assert.notStrictEqual(a[0], a[1]);
      assert.strictEqual(H.suPatternRowIds(a, 2), a, "same array back");
      const b = H.suPatternRowIds(a, 3);
      assert.deepStrictEqual(b.slice(0, 2), a); assert.ok(!a.includes(b[2]));
      const c = H.suPatternRowIds(b, 1);
      assert.deepStrictEqual(c, [a[0]]);
      const d = H.suPatternRowIds(c, 2);
      assert.ok(!b.includes(d[1]), "a minted id is never one that was used before");
      assert.deepStrictEqual(H.suPatternRowIds(null, 0), []);
    });
    check("B9g pins: PatternListEditor keys each row and its typed text by the row id (Remove splices the id so the rows below keep theirs; Add lets the reconcile mint one); no key={i}", () => {
      const pl = B9slice("function PatternListEditor({", "// --- Rules editor:");
      assert.ok(pl.includes("const ids = suPatternRowIds(idsRef.current, items.length); idsRef.current = ids;"), "reconcile per render: " + pl.slice(0, 600));
      assert.strictEqual(B9count("key={ids[i]}", pl), 1, "row key by id");
      assert.strictEqual(B9count("key={i}", pl), 0, "no index key");
      assert.ok(pl.includes("texts[ids[i]] !== undefined ? texts[ids[i]] : suPatternValueText(p)"), "typed text by id");
      assert.ok(pl.includes("[ids[i]]: e.target.value"), "typed text stored by id");
      assert.ok(pl.includes("idsRef.current = ids.filter((_, j) => j !== i); onChange(items.filter((_, j) => j !== i));"), "Remove splices the id list first");
    });

    // (h) schedule_days: 0 rows after N > 0 = a failed read (200 + [] is what RLS / a dead token answer) - keep the map, warn once.
    check("B9h: daysReadTripped - only an EMPTY read after a non-empty one trips; a first empty table, a shrink to fewer rows and a normal read do not", () => {
      assert.strictEqual(H.daysReadTripped(0, 120), true);
      assert.strictEqual(H.daysReadTripped(0, 0), false);
      assert.strictEqual(H.daysReadTripped(0, undefined), false);
      assert.strictEqual(H.daysReadTripped(3, 120), false);
      assert.strictEqual(H.daysReadTripped(120, 120), false);
      assert.strictEqual(H.daysReadTripped(undefined, 120), false);
    });
    await (async () => {
      const body = B9slice("  const mergeLoadedDays = (fresh) => {", "  const writeFailToast = ");
      const sameAssignment = (day, a, b) => JSON.stringify(H.assignmentToDayRow(day, a || H.emptyDayAssignment())) === JSON.stringify(H.assignmentToDayRow(day, b || H.emptyDayAssignment()));
      const mk = (lastCount) => {
        const s = { sets: [], toasts: [], warns: 0 };
        const rows = { "2026-11-02": { primary: "s1" }, "2026-11-03": { primary: "s2" }, "2026-11-04": { primary: "s3" } };
        const lastSyncRef = ref(JSON.parse(JSON.stringify(rows))), scheduleRef = ref(JSON.parse(JSON.stringify(rows)));
        const lastDaysCountRef = ref(lastCount), warnedRef = ref(false);
        const fn = new Function("lastSyncRef", "scheduleRef", "sameAssignment", "dayVersionsRef", "setSchedule", "lastDaysCountRef", "daysTripwireWarnedRef", "daysReadTripped", "showToast", "console", body + "\nreturn mergeLoadedDays;")(
          lastSyncRef, scheduleRef, sameAssignment, ref({ "2026-11-02": 1, "2026-11-03": 1, "2026-11-04": 1 }), (m) => s.sets.push(m), lastDaysCountRef, warnedRef, H.daysReadTripped, (m, tone) => s.toasts.push({ m, tone }), { warn: () => { s.warns++; } });
        return { fn, s, scheduleRef, lastSyncRef, lastDaysCountRef, warnedRef };
      };
      check("B9h: an empty read after 3 rows keeps the map (no setSchedule, lastSyncRef untouched), warns once with a toast, and a second empty read warns in the console only", () => {
        const t = mk(3);
        const r1 = t.fn({ sched: {}, vers: {}, count: 0 });
        assert.strictEqual(r1, false, "reports the read as not adopted");
        assert.deepStrictEqual(t.s.sets, [], "the map is kept");
        assert.deepStrictEqual(Object.keys(t.lastSyncRef.current).sort(), ["2026-11-02", "2026-11-03", "2026-11-04"], "the persisted base is kept");
        assert.strictEqual(t.lastDaysCountRef.current, 3, "the last good count stays");
        assert.strictEqual(t.s.toasts.length, 1); assert.strictEqual(t.s.toasts[0].tone, "error"); assert.ok(/came back empty/.test(t.s.toasts[0].m) && /3 day/.test(t.s.toasts[0].m), t.s.toasts[0].m);
        assert.strictEqual(t.warnedRef.current, true);
        const r2 = t.fn({ sched: {}, vers: {}, count: 0 });
        assert.strictEqual(r2, false); assert.strictEqual(t.s.toasts.length, 1, "warned once"); assert.strictEqual(t.s.warns, 2, "the console names every tripped read");
      });
      check("B9h: a normal read (3 rows, one changed on the server) merges as before and records the count; an empty FIRST read (lastCount 0) adopts the empty table - that is a real empty table, not a failure", () => {
        const t = mk(3);
        const r = t.fn({ sched: { "2026-11-02": { primary: "s5" }, "2026-11-03": { primary: "s2" }, "2026-11-04": { primary: "s3" } }, vers: { "2026-11-02": 2, "2026-11-03": 1, "2026-11-04": 1 }, count: 3 });
        assert.notStrictEqual(r, false);
        assert.strictEqual(t.s.sets.length, 1); assert.strictEqual(t.s.sets[0]["2026-11-02"].primary, "s5");
        assert.strictEqual(t.s.toasts.length, 0); assert.strictEqual(t.lastDaysCountRef.current, 3);
        const u = mk(0);
        const r0 = u.fn({ sched: {}, vers: {}, count: 0 });
        assert.notStrictEqual(r0, false); assert.strictEqual(u.s.toasts.length, 0, "no tripwire on a first empty table"); assert.strictEqual(u.s.sets.length, 1, "the rows vanish from the map as before");
      });
      check("B9h pins: loadScheduleDays returns count; adoptLoadedDays records it; the poll's refreshDays clears loadFailedRef only for a read that was adopted; the conflict reload keeps the local map on a tripped read; the factory reset zeroes the count after its DELETE (an empty table it made is not a failure)", () => {
        assert.strictEqual(B9count("const lastDaysCountRef = useRef(0);"), 1);
        assert.strictEqual(B9count("const daysTripwireWarnedRef = useRef(false);"), 1);
        const adopt = B9slice("  const adoptLoadedDays = (loadedDays) => {", "  const sameAssignment");
        assert.ok(adopt.includes("lastDaysCountRef.current = loadedDays.count;") && adopt.includes("daysTripwireWarnedRef.current = false;"), adopt);
        const rd = B9slice("    const refreshDays = async () => {", "    // Authenticated-read tables");
        assert.ok(rd.includes("const adopted = mergeLoadedDays(fresh);") && rd.includes("if (adopted !== false) loadFailedRef.current = false;"), rd);
        assert.ok(!rd.includes("loadFailedRef.current = false; // the days read succeeded"), "the unconditional clear is gone");
        const cr = B9slice("        const fresh = await loadScheduleDays();\n        const local = scheduleRef.current || {};", "      return { ok: false, error: \"conflict\", conflict: true };");
        assert.ok(cr.includes("if (daysReadTripped(fresh.count, lastDaysCountRef.current)) {"), "the conflict reload consults the tripwire: " + cr.slice(0, 300));
        assert.strictEqual(B9count("lastDaysCountRef.current = 0; // Prompt 16 B9 (h): the table is empty because this reset emptied it"), 1);
      });
    })();

    // (i) one notion of today: todayCentral() - no device-local date left where a DATE (not a timestamp) is meant.
    check("B9i pins: no fmt(new Date()) / new Date().getFullYear() / getMonth() / addD(new Date() in index-source.html - vacation and clear-range defaults, the vacation form reset, the pasted-list year, the painter's first month and the East refresh window all read todayCentral(); the only new Date() left are timestamps and the clock", () => {
      assert.strictEqual(B9count("fmt(new Date())"), 0, "fmt(new Date())");
      assert.strictEqual(B9count("new Date().getFullYear()"), 0);
      assert.strictEqual(B9count("new Date().getMonth()"), 0);
      assert.strictEqual(B9count("addD(new Date()"), 0);
      assert.strictEqual(B9count("const today = new Date();"), 0);
      assert.strictEqual(B9count("useState(() => todayCentral())"), 3, "vacStart, vacEnd, clearStart");
      assert.ok(B9SRC.includes("setVacStart(todayCentral()); setVacEnd(todayCentral());"), "the vacation form reset");
      assert.strictEqual(B9count("year: todayCentral().slice(0, 4)"), 1, "the pasted-list year");
      assert.ok(B9SRC.includes("const today = parse(todayCentral());"), "the painter's first month");
      assert.ok(B9SRC.includes("const fromMon = fmt(monOf(addD(parse(todayCentral()), -28)));"), "the East refresh window");
      const left = B9SRC.split("\n").filter(l => /new Date\(\)/.test(l) && !/toISOString|Date\.now|getTime\(\)|toLocaleTimeString|generatedAt: new Date\(\)|now = new Date\(\)/.test(l));
      assert.deepStrictEqual(left.map(l => l.trim().slice(0, 80)), [], "device-local dates left");
    });

    // ---- B9 review fixes (9/24) ----
    check("B9e fix: a blob-leg run settles only the waiters that existed when it started (takeBlobWaiters first thing inside the timer, before saveBlobNow - a Setup save clicked while an earlier PATCH is in flight waits for its OWN write) and the catch settles them AFTER the generic toast, so the specific 'NOT saved - <why>' line is the one that stays on the single toast slot", () => {
      assert.strictEqual(B9count("const takeBlobWaiters = () => { const l = blobWaitersRef.current; blobWaitersRef.current = []; return l; };"), 1, "takeBlobWaiters");
      assert.strictEqual(B9count("const settleWaiters = (labels, ok, why) => {"), 1, "settleWaiters(labels, ...)");
      const leg = B9slice("    // Leg 2 - the config blob.", "  }, [loaded, surgeons, surgeonRules, groupRules, holidays, settings, lastPublished, lastGenerate, saveTick]);");
      const timerAt = leg.indexOf("const timer = setTimeout(async () => {");
      const mineAt = leg.indexOf("const mine = takeBlobWaiters();");
      const writeAt = leg.indexOf('const r = await saveBlobNow(payload, "autosave");');
      assert.ok(timerAt > 0 && mineAt > timerAt && mineAt < writeAt, `the run takes its waiters first thing inside the timer (timer ${timerAt}, mine ${mineAt}, write ${writeAt})`);
      assert.strictEqual(B9count("settleBlobWaiters(", leg.slice(timerAt)), 0, "nothing inside the timer settles the LIVE list (a waiter registered during the await belongs to the next run)");
      const catchBody = leg.slice(leg.indexOf("} catch (e) {", writeAt));
      const genericAt = catchBody.indexOf('if (!(auth.sessionExpired && authFail)) showToast(denied');
      const settleAt = catchBody.indexOf("settleWaiters(mine, false, denied ?");
      assert.ok(genericAt > 0 && settleAt > genericAt, `the specific line toasts after the generic one (generic ${genericAt}, settle ${settleAt})`);
    });
    check("B9h fix: the two tripwire toasts name the other cause of an empty read - the schedule cleared on another device (its factory reset) - and say reload to confirm; the only local path that DELETEs schedule_days rows is the factory reset (a Clear range writes the days empty, it never removes rows, so it cannot trip this device)", () => {
      const lines = B9SRC.split("\n").filter(l => /came back empty/.test(l) && /showToast/.test(l));
      assert.strictEqual(lines.length, 2, "the poll toast and the conflict-reload toast");
      lines.forEach(l => assert.ok(/cleared on another device - reload to confirm/.test(l), l.trim().slice(0, 240)));
      const deletes = B9SRC.split("\n").filter(l => /\/rest\/v1\/schedule_days\?/.test(l) && /method: "DELETE"/.test(l));
      assert.strictEqual(deletes.length, 1, "one schedule_days DELETE (the factory reset)");
      assert.ok(B9SRC.includes("// Rows are NEVER deleted here; a day dropped from memory is written empty."), "the days leg never deletes");
    });
    check("B9c decision: the session-expired banner stays UNDER the dialogs on purpose - its Sign in (openSignInAgain) swaps the app for the sign-in card (setAuthUser(null)), which would unmount an open day editor and drop a dirty draft past the discard confirm; the JSX names the trade-off", () => {
      const o = B9slice("  const openSignInAgain = () => {", "  // --- Roster helpers ---");
      assert.ok(o.includes("setAuthUser(null);"), o);
      const at = B9SRC.indexOf('data-testid="session-expired"');
      const above = B9SRC.slice(B9SRC.lastIndexOf("{/*", at), at);
      assert.ok(/stays\s+under an open dialog on purpose/.test(above), above.slice(0, 500));
      assert.ok(/zIndex:9200/.test(B9SRC.slice(at, B9SRC.indexOf("\n", at))), "still 9200");
    });
    check("B9a fix: the smoke drives Generate through the assembled worker path - a Worker is created for the run (page.on('worker')), the busy line reads 'in a background worker' and no 'Generate worker failed' warning is logged in the whole run; the harness serves every file from a cache read once at start-up, so a git restore under a running smoke cannot swap the page it serves", () => {
      const smoke = fs.readFileSync(path.join(ROOT, "test", "ui", "smoke.mjs"), "utf8");
      assert.ok(smoke.includes('page.on("worker"'), "worker capture");
      assert.ok(/in a background worker/.test(smoke), "busy-line assertion");
      assert.ok(/Generate worker failed/.test(smoke), "end-of-run warning check");
      assert.ok(smoke.includes("const servedCache = new Map();"), "served-file cache");
      assert.ok(!smoke.includes("fs.createReadStream(file).pipe(res);"), "no per-request disk read of the page");
    });
    check("B9a docs: the build guide's B9 paragraph warns that a future CSP must allow worker-src blob: (without it every device silently runs Generate inline) and names the session-expired banner trade-off", () => {
      const g = fs.readFileSync(path.join(ROOT, "docs", "SILVIS-BUILD-GUIDE.md"), "utf8");
      assert.ok(/worker-src blob:/.test(g), "CSP note");
      assert.ok(/openSignInAgain/.test(g), "banner trade-off");
    });
  }

  /* ---------------- Item 5a (Faraz 9/24). Settings > Client versions: an unlinked account is named from user_profiles ---------------- */
  console.log("\n[Item 5a] Client versions - unlinked accounts named from user_profiles");
  {
    const src = fs.readFileSync(path.join(ROOT, "index-source.html"), "utf8").replace(/\r\n/g, "\n");
    // cvAccountLabel lives at MODULE scope as plain JS (like offerCandidateWords): the test lifts its source and runs it.
    const calSrc = (() => { const a = src.indexOf("\nfunction cvAccountLabel("); if (a < 0) return null; const b = src.indexOf("\n}\n", a); return src.slice(a, b + 3); })();
    check("Item 5a: cvAccountLabel(row, profiles) names a client_versions row with no roster link from its user_profiles row - '<display_name> \\u2014 <role>' and an EMPTY id column; '(unlinked account)' + the id8 only when the profile has no display_name (blank counts as none), no profile matches, or the cross-reference failed (profiles null)", () => {
      assert.ok(calSrc, "no module-scope cvAccountLabel in index-source.html");
      const fn = new Function(calSrc + "\nreturn cvAccountLabel;")();
      const uid = "00000000-0000-4000-8000-0000000000aa";
      const profiles = [{ id: uid, person_id: null, role: "coordinator", display_name: "Office Contact" }, { id: "other", person_id: "s2", role: "surgeon", display_name: "Burchett" }];
      assert.deepStrictEqual(fn({ id: uid, person_id: null }, profiles), { name: "Office Contact \u2014 coordinator", id: "" }, "the named case");
      assert.deepStrictEqual(fn({ id: uid }, [{ id: uid, role: "viewer", display_name: "  " }]), { name: "(unlinked account)", id: "00000000" }, "a blank display_name is no name");
      assert.deepStrictEqual(fn({ id: uid }, [{ id: uid, role: "viewer", display_name: null }]), { name: "(unlinked account)", id: "00000000" }, "display_name null");
      assert.deepStrictEqual(fn({ id: uid }, [{ id: uid, role: null, display_name: "Office Contact" }]), { name: "Office Contact", id: "" }, "no role: the name alone");
      assert.deepStrictEqual(fn({ id: uid }, null), { name: "(unlinked account)", id: "00000000" }, "profiles failed to load (cvProfiles null)");
      assert.deepStrictEqual(fn({ id: uid }, []), { name: "(unlinked account)", id: "00000000" }, "no profile for the id");
      assert.deepStrictEqual(fn(null, profiles), { name: "(unlinked account)", id: "" }, "junk row never throws");
      assert.ok(!/[^\x00-\x7f]/.test(calSrc), "the helper is ASCII (the em dash is the \\u2014 escape)");
    });
    check("Item 5a pins: the card's extras rows (no person_id, or one outside the roster) render through cvAccountLabel(r, cvProfiles) - the unconditional line(r.id, \"(unlinked account)\", r.id.slice(0, 8), ...) is gone; the roster rows keep line(p.id, p.name, p.id, ...); each row carries data-cv-row / data-cv-name / data-cv-id for the smoke", () => {
      assert.ok(src.includes("{extras.map(r => { const lb = cvAccountLabel(r, cvProfiles); return line(r.id, lb.name, lb.id, r, true); })}"), "extras rows through cvAccountLabel");
      assert.strictEqual((src.match(/"\(unlinked account\)"/g) || []).length, 1, "the '(unlinked account)' literal lives in cvAccountLabel only");
      assert.ok(src.includes("{surgeons.map(p => line(p.id, p.name, p.id, byPerson(p.id), (cvProfiles || []).some(pr => pr.person_id === p.id)))}"), "linked roster rows unchanged");
      assert.ok(src.includes("data-cv-row={key}") && src.includes("data-cv-name") && src.includes("data-cv-id"), "row attributes for the smoke");
      assert.ok(src.includes('<span data-cv-id="" style={{flexShrink:0,fontSize:10,color:"#9aa4ae",fontFamily:mono,minWidth:id?22:0,display:id?undefined:"none"}}>{id}</span>'), "a named account's EMPTY id column takes no width (display none, minWidth 0) so no hole opens between the name and the status chips; a real id8 keeps minWidth 22");
    });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("test runner crashed:", e); process.exit(1); });
