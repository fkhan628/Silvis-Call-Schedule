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
    const mk = () => {
      const state = { toasts: [], patched: [] };
      const intentionalScheduleWipeRef = ref(false);
      const lastSyncRef = ref({ "2026-11-02": { primary: "s1" }, "2026-11-03": { primary: "s2" }, "2026-11-04": { primary: "s3" }, "2026-11-05": { primary: "s4" } });
      const params = ["intentionalScheduleWipeRef", "daySyncBusyRef", "daySyncChainRef", "lastSyncRef", "dayVersionsRef", "scheduleRef", "scheduleWipeCheck", "sameAssignment", "assignmentToDayRow", "emptyDayAssignment", "postDayRow", "patchDayRow", "fetchDayRow", "setSaveError", "setSaveStatus", "showToast", "scheduleDaySyncRetry", "loadScheduleDays", "setSchedule", "userProfile", "authUser", "writeFailToast", "setTimeout", "console"];
      const fns = new Function(...params, body + "\nreturn { syncScheduleDays, syncScheduleDaysNow };")(
        intentionalScheduleWipeRef, ref(0), ref(Promise.resolve()), lastSyncRef, ref({ "2026-11-02": 1, "2026-11-03": 1, "2026-11-04": 1, "2026-11-05": 1 }), ref(lastSyncRef.current),
        H.scheduleWipeCheck, sameAssignment, H.assignmentToDayRow, H.emptyDayAssignment,
        async () => ({ version: 1 }), async (row, ver) => { state.patched.push(row.day); return { version: ver + 1 }; }, async () => null,
        () => {}, () => {}, (m) => state.toasts.push(m), () => {}, async () => ({ sched: {}, vers: {} }), () => {}, null, null, () => "write failed", () => 0, { warn: () => {} });
      return { ...fns, state, intentionalScheduleWipeRef, lastSyncRef };
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
    assert.ok(src.includes('color: i >= 4 ? (dk ? T.muted : T.title) : dkSubtext'), "weekend header text is a token");
    assert.ok(src.includes('borderTop: "2px solid " + T.navyMuted'), "weekend bracket is T.navyMuted");
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
    assert.ok(body.includes("if (!pv.respectLocks || lockedChanges.length || heldChanges.length) {"), "one confirm gate over both lists");
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
    const blobLeg = fl.indexOf("call_schedule_data?on_conflict=id");
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
    assert.ok(src.includes("generate(built.ctx, start, end, { seed, bestOf, respectLocks: o.respectLocks !== false, fillOpenOnly: o.fillOpenOnly === true, timeBudgetMs: 25000 })"), "generate() receives fillOpenOnly (T's option)");
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
    assert.ok(cb.includes("eastOverrideRows, eastIdByCode, eastVacationReviewRows]"), "the memo must rebuild when the review rows change");
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
  check("P15: the 'home' -> 'either' offers hook exists as a NO-OP with the Prompt 14 TODO (the painter is on another branch); no call_offers write from this branch", () => {
    assert.ok(src.includes("const offerEitherForHomeRange = (personId, range) => {"), "hook missing");
    assert.ok(src.includes("TODO(Prompt 14 UI wave)"), "the TODO marker must name the wave that wires it");
    assert.ok(src.includes('if (decision === "home") offerEitherForHomeRange(personId, range);'), "a home decision must call the hook");
    assert.strictEqual(src.includes("/rest/v1/call_offers"), false, "no call_offers write on this branch");
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
  check("P15: the office digest and the ER export are untouched (assignments, not availability)", () => {
    const h = readRoot("helpers.js");
    const er = h.slice(h.indexOf("function erPanelRows("), h.indexOf("function buildErCallPanelsDocument(") + 1200);
    assert.ok(er.length > 0 && !/eastVac|east_vacation|eastClear/.test(er), "the ER Call Panels builders mention East vacations");
    const digest = readRoot(path.join("edge-functions", "office-notifications", "index.ts"));
    assert.strictEqual(/east_vacation|eastVac/.test(digest), false, "the office digest reads East vacations");
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
    const prompt15 = readDoc("docs", "PROMPT-15-EAST-VACATIONS.md") || "";
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
      assert.ok(sec18.includes('{ ok: true, offered: 0, pending: "prompt-14" }'), "the no-op hook's exact return shape");
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
      assert.ok(/Refresh from Davenport/.test(khan) && /home/.test(khan), "the first-action note (Refresh from Davenport, then the home decision)");
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
    check("P15 docs: PROMPT-15-EAST-VACATIONS.md carries the delivery note with the live steps, the open questions and the untouched Davenport clone", () => {
      const i = prompt15.indexOf("\n## Delivery note");
      assert.ok(i > 0, "'## Delivery note' heading missing");
      const note = prompt15.slice(i);
      assert.ok(/### Live steps/.test(note) && /### Open questions/.test(note), "the note needs 'Live steps' and 'Open questions' sub-headings");
      assert.ok(note.includes("sql/migrations/2026-09-23-east-vacation-reviews.sql") && note.includes("sql/probes/east-vacation-reviews-probe.sql") && /verify-rls\.sh/.test(note), "the live steps name the migration, the probe and verify-rls.sh");
      assert.ok(/Davenport clone|davenport-ref/.test(note) && /README/.test(note) && /not touched|untouched|NOT touched/.test(note), "states that the Davenport clone's README was not touched (path 1a, no Copy button)");
    });
    check("P15 docs: no address-shaped string in the Prompt 15 docs outside the @example.test / @example.com fixtures", () => {
      const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/g;
      const hits = [];
      [["guide", guide], ["rules", rulesDoc], ["ONBOARDING", onboarding], ["README", efReadme], ["PROMPT-15", prompt15]].forEach(([n, t]) => {
        (t.match(EMAIL) || []).forEach(m => { if (!/@example\.(test|com)$/.test(m)) hits.push(n + ": " + m.replace(/[A-Za-z0-9]/g, "x")); });
      });
      assert.deepStrictEqual(hits, [], "address-shaped strings (masked)");
    });
    // Review round (E4): the observed figure is 16 Davenport time_off ROWS; eastMergeRanges merges adjacent rows and the
    // toast counts the merged lists, so the docs never promise "16 ranges". And the strip's unreviewed count is not
    // windowed (unreviewedUpcoming counts every range ending today or later; only the open-slot glance uses 60 days),
    // so the 60-day question is about the hard block alone, never "the strip's own window".
    check("P15 docs: the post-deploy note counts Davenport rows (the toast names the merged count), never '16 ranges'; the 60-day question names the strip's open-slot window and says the unreviewed nag is not windowed", () => {
      const all = guide + "\n" + rulesDoc + "\n" + prompt15;
      assert.ok(!/16 FAK ranges|the 16 ranges arrive|16 ranges arrive/.test(all), "no doc may promise '16 ranges' - the observed figure is 16 rows and adjacent rows merge");
      assert.ok(/merged count/.test(guide) && /merged count/.test(rulesDoc) && /merged count/.test(prompt15), "each of the three notes says the toast names the merged count");
      assert.ok(!/strip's own window/.test(all) && !/soft \+ nag|plus the nag beyond/.test(all), "the 60-day question must not call 60 days the strip's own window or move the nag");
      assert.ok(/open-slot window/.test(guide) && /open-slot window/.test(rulesDoc) && /open-slot window/.test(prompt15), "each place names the strip's open-slot window");
      assert.ok(/unreviewed count is not windowed/.test(guide) && /unreviewed count is not windowed/.test(rulesDoc) && /unreviewed count is not windowed/.test(prompt15), "each place says the unreviewed count is not windowed (the nag already reaches every horizon)");
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
    // applyPayload hands the two arrays to the app's table applier (which upserts them once part 3 wires it; today it ignores unknown keys)
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
    // once part 3 wires the upsert), and notApplied names the offer tables an older applier ignored
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
    check("U3a pins: one Save = ONE rpc/save_offers request (rows + period + mode together) through dbAuthHeaders + ONE audit row offers.save; a mode-only save = ONE rpc/set_offer_mode; nothing to write = no request and no audit; no direct call_offers / call_periods write", () => {
      assert.ok(src.includes("`${SUPABASE_URL}/rest/v1/rpc/save_offers`, { method: \"POST\", headers: { ...dbAuthHeaders()"), "save_offers must be one POST with dbAuthHeaders");
      assert.strictEqual((src.match(/rest\/v1\/rpc\/save_offers/g) || []).length, 1, "save_offers is called from exactly one place");
      assert.ok(src.includes("body: JSON.stringify({ p_person: personId, p_rows: rows, p_clear: diff.delete, p_period: withMode ? period.id : null, p_mode: withMode ? mode : null })"), "the rows request must carry the period + mode when the same Save changed the toggle (one commit or nothing - the 9/23 review's finding 3)");
      assert.ok(src.includes("`${SUPABASE_URL}/rest/v1/rpc/set_offer_mode`, { method: \"POST\", headers: { ...dbAuthHeaders()"), "set_offer_mode must be one POST with dbAuthHeaders");
      assert.ok(/if \(diff\.count > 0\) \{[\s\S]*?\} else \{\s*const r2 = await fetch\(`\$\{SUPABASE_URL\}\/rest\/v1\/rpc\/set_offer_mode`/.test(src), "set_offer_mode is the MODE-ONLY path (the else of diff.count > 0), never a second request after the rows");
      assert.ok(src.includes("if (diff.count === 0 && !withMode) return { ok: true, nothing: true };"), "nothing to write must return before any request or audit row (finding 10)");
      assert.ok(src.includes("if (diff.count === 0 && !mode) { setBusy(false); setDraft({}); setModeDraft(null); setPendingStart(null); setSavedNote(\"Already saved - nothing to write\");"), "the sheet's Save must drop an equalised draft without calling onCommit");
      assert.strictEqual(src.includes("modeError"), false, "no partial 'rows saved, mode not' state may remain (the combined Save is atomic)");
      assert.strictEqual((src.match(/logAudit\("offers\.save"/g) || []).length, 1, "exactly one offers.save audit site");
      assert.strictEqual(/rest\/v1\/call_offers[^\n]*method: "(POST|PATCH|DELETE)"/.test(src), false, "a direct call_offers write bypasses the atomic RPC");
      assert.strictEqual(/rest\/v1\/call_periods[^\n]*method: "(POST|PATCH|DELETE)"/.test(src), false, "a direct call_periods write (a surgeon cannot; the scheduler path is Periods, not the painter)");
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
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("test runner crashed:", e); process.exit(1); });
