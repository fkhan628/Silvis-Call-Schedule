// Silvis Call Schedule - ONE definition of "open" (Prompt 13 part 1).
// helpers.js openSlots(schedule, from, to, today, opts) is the single place
// that decides which slots are open: the coverage strip (suCoverageGlance),
// the calendar's "only OPEN" filter, the Open shifts board, the publish hook
// and the weekly reminder all read it; edge-functions/daily-reminder/index.ts
// mirrors it in TypeScript against the same fixture (part 5). This test pins
// the function against test/fixtures/open-slots.json, the count / text-line
// helpers, the glance equivalence and the SOURCE PINS that keep a second
// definition out of index-source.html and out of suCoverageGlance.
// Run: node test/open-shifts.test.js   (exit 1 on any failure)
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const H = require(path.join(ROOT, "helpers.js"));
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "open-slots.json"), "utf8"));

let passed = 0, failed = 0;
const check = (name, fn) => {
  try { fn(); passed++; console.log("ok   " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n     " + (e && e.message || e)); }
};
const dayRole = (list) => list.map(s => ({ day: s.day, role: s.role }));
const has = (name) => typeof H[name] === "function";

check("helpers.js exports openSlots, openSlotCounts, openSlotsLine, openSlotKey, openSlotWeekendKinds", () => {
  ["openSlots", "openSlotCounts", "openSlotsLine", "openSlotKey", "openSlotWeekendKinds"].forEach(n => assert.ok(has(n), "missing helpers.js export " + n));
});

/* ---- fixture cases ---- */
check("fixture: openSlots(schedule, from, to, today) lists exactly the expected { day, role } pairs, in order", () => {
  const out = H.openSlots(FX.schedule, FX.from, FX.to, FX.today);
  assert.deepStrictEqual(dayRole(out), FX.expected);
  // No opts: no holiday units and no reasons, but a Fri/Sat/Sun still names its weekend (pattern unknown -> null).
  out.forEach(s => {
    const dow = H.parse(s.day).getDay();
    if (dow === 5 || dow === 6 || dow === 0) assert.deepStrictEqual(s.unit, { kind: "weekend", pattern: null, friday: dow === 5 ? s.day : H.suAddDays(s.day, dow === 6 ? -1 : -2) }, "weekend unit on " + s.day);
    else assert.strictEqual(s.unit, null, "no opts -> unit null on " + s.day);
    assert.strictEqual(s.reason, null, "no opts -> reason null on " + s.day);
  });
});
check("fixture: a past open day is excluded (11/02 no row, 11/03 open backup) and today is included in both roles", () => {
  const out = H.openSlots(FX.schedule, FX.from, FX.to, FX.today);
  assert.ok(!out.some(s => s.day < FX.today), "no entry before today");
  assert.deepStrictEqual(dayRole(out).filter(s => s.day === FX.today), [{ day: FX.today, role: "primary" }, { day: FX.today, role: "backup" }]);
});
check("fixture: external cover holds primary (11/06 lists backup only); a locked held day (11/08) is not open; a day with no row (11/07) is open in both roles", () => {
  const out = dayRole(H.openSlots(FX.schedule, FX.from, FX.to, FX.today));
  assert.deepStrictEqual(out.filter(s => s.day === "2026-11-06"), [{ day: "2026-11-06", role: "backup" }]);
  assert.deepStrictEqual(out.filter(s => s.day === "2026-11-08"), []);
  assert.deepStrictEqual(out.filter(s => s.day === "2026-11-07"), [{ day: "2026-11-07", role: "primary" }, { day: "2026-11-07", role: "backup" }]);
});
check("fixture: a locked but EMPTY day (11/17, both lock flags set, no holders) is open in both roles - a lock never holds a slot", () => {
  const row = FX.schedule["2026-11-17"];
  assert.ok(row.primaryLocked && row.backupLocked && !row.primary && !row.backup && !row.externalCover, "fixture row 2026-11-17 is locked and empty");
  const out = dayRole(H.openSlots(FX.schedule, FX.from, FX.to, FX.today));
  assert.deepStrictEqual(out.filter(s => s.day === "2026-11-17"), [{ day: "2026-11-17", role: "primary" }, { day: "2026-11-17", role: "backup" }]);
});
check("fixture with opts: unit (holiday wins over the weekend it overlaps; weekend pattern + friday) and reason match expectedWithUnits", () => {
  const out = H.openSlots(FX.schedule, FX.from, FX.to, FX.today, FX.opts);
  assert.deepStrictEqual(out, FX.expectedWithUnits);
});
check("fixture with opts: a whitespace-only reason (11/05 backup) reads back as null, so the board and the Copy line agree", () => {
  assert.strictEqual(FX.opts.reasons["2026-11-05|backup"].trim(), "", "fixture holds a whitespace-only reason");
  const out = H.openSlots(FX.schedule, FX.from, FX.to, FX.today, FX.opts);
  const s = out.find(x => x.day === "2026-11-05" && x.role === "backup");
  assert.strictEqual(s.reason, null);
  assert.strictEqual(H.openSlotsLine(s), "Thu 11/05 - backup - open");
  // A padded real reason is trimmed the same way.
  const t = H.openSlots({}, "2026-11-10", "2026-11-10", "2026-11-04", { reasons: { "2026-11-10|primary": "  no eligible surgeon  " } });
  assert.strictEqual(t[0].reason, "no eligible surgeon");
});
check("fixture invalidRanges: an ISO-shaped but non-calendar from/to ('2026-13-40', '2026-02-30') yields [] like any other invalid input - never rolled-over days", () => {
  assert.ok(Array.isArray(FX.invalidRanges) && FX.invalidRanges.length >= 4);
  FX.invalidRanges.forEach(r => assert.deepStrictEqual(H.openSlots({}, r.from, r.to, "2020-01-01"), [], r.why + ": " + r.from + ".." + r.to));
  assert.deepStrictEqual(H.openSlots({}, "2026-13-40", "2026-13-41", "2020-01-01"), []);
  assert.deepStrictEqual(H.openSlots({}, "2026-11-01", "2026-02-30", "2020-01-01"), []);
  assert.strictEqual(H.openSlots({}, "2026-11-01", "2026-11-02", "2020-01-01").length, 4, "a real range still lists");
});
check("fixture unitPrecedence: unit is per day - a Friday left over by a Sat-Mon holiday unit keeps its (reduced) weekend unit, the holiday days carry the holiday", () => {
  const U = FX.unitPrecedence;
  const out = H.openSlots(U.schedule, U.from, U.to, U.today, U.opts);
  assert.deepStrictEqual(out, U.expected);
  assert.deepStrictEqual(out[0].unit, { kind: "weekend", pattern: "block", friday: "2026-11-13" });
  assert.deepStrictEqual(out[2].unit, { kind: "holiday", name: "Test unit" });
});
check("fixture: openSlotCounts and openSlotsLine match expectedCounts / expectedLines", () => {
  const out = H.openSlots(FX.schedule, FX.from, FX.to, FX.today, FX.opts);
  assert.deepStrictEqual(H.openSlotCounts(out), FX.expectedCounts);
  assert.deepStrictEqual(out.map(s => H.openSlotsLine(s)), FX.expectedLines);
});

/* ---- boundaries ---- */
check("today inclusive: today's open slots are listed; the day before today is not, even with a row that is open", () => {
  const sched = { "2026-11-03": { primary: null, backup: null }, "2026-11-04": { primary: null, backup: null } };
  assert.deepStrictEqual(dayRole(H.openSlots(sched, "2026-11-01", "2026-11-04", "2026-11-04")), [{ day: "2026-11-04", role: "primary" }, { day: "2026-11-04", role: "backup" }]);
  assert.deepStrictEqual(H.openSlots(sched, "2026-11-01", "2026-11-03", "2026-11-04"), []);
});
check("from/to inclusive: a one-day range yields that day; to before from yields []", () => {
  assert.deepStrictEqual(dayRole(H.openSlots({}, "2026-11-10", "2026-11-10", "2026-11-04")), [{ day: "2026-11-10", role: "primary" }, { day: "2026-11-10", role: "backup" }]);
  assert.deepStrictEqual(dayRole(H.openSlots({}, "2026-11-10", "2026-11-12", "2026-11-04")).map(s => s.day), ["2026-11-10", "2026-11-10", "2026-11-11", "2026-11-11", "2026-11-12", "2026-11-12"]);
  assert.deepStrictEqual(H.openSlots({}, "2026-11-12", "2026-11-10", "2026-11-04"), []);
});
check("today after the range: nothing is open; today inside the range: the range is clipped at today", () => {
  assert.deepStrictEqual(H.openSlots({}, "2026-11-01", "2026-11-05", "2026-11-06"), []);
  assert.deepStrictEqual(dayRole(H.openSlots({}, "2026-11-01", "2026-11-05", "2026-11-05")), [{ day: "2026-11-05", role: "primary" }, { day: "2026-11-05", role: "backup" }]);
});
check("invalid inputs never throw: bad from/to, non-object schedule, undefined everything -> []", () => {
  assert.deepStrictEqual(H.openSlots({}, "nope", "2026-11-05", "2026-11-04"), []);
  assert.deepStrictEqual(H.openSlots({}, "2026-11-01", null, "2026-11-04"), []);
  assert.deepStrictEqual(H.openSlots(undefined, undefined, undefined, undefined), []);
  assert.deepStrictEqual(dayRole(H.openSlots(null, "2026-11-10", "2026-11-10", "2026-11-04")), [{ day: "2026-11-10", role: "primary" }, { day: "2026-11-10", role: "backup" }]);
  assert.deepStrictEqual(dayRole(H.openSlots("garbage", "2026-11-10", "2026-11-10", "2026-11-04")), [{ day: "2026-11-10", role: "primary" }, { day: "2026-11-10", role: "backup" }]);
  assert.deepStrictEqual(H.openSlots({}, "2026-11-10", "2026-11-10", "2026-11-04", { holidayByDay: null, weekendKinds: "x", reasons: 7 }).map(s => s.unit), [null, null]);
});
check("a malformed today falls back to todayCentral(): a 2099 range is open, a 2020 range is not", () => {
  assert.strictEqual(H.openSlots({}, "2099-01-01", "2099-01-02", "not-a-date").length, 4);
  assert.strictEqual(H.openSlots({}, "2020-01-01", "2020-01-02", undefined).length, 0);
});
check("sorting: entries come out by day then role (primary before backup) whatever the map's key order", () => {
  const sched = { "2026-11-12": { primary: null, backup: "s1" }, "2026-11-10": { primary: "s2", backup: null }, "2026-11-11": { primary: null, backup: null } };
  const out = H.openSlots(sched, "2026-11-10", "2026-11-12", "2026-11-04");
  assert.deepStrictEqual(dayRole(out), [
    { day: "2026-11-10", role: "backup" }, { day: "2026-11-11", role: "primary" }, { day: "2026-11-11", role: "backup" }, { day: "2026-11-12", role: "primary" },
  ]);
});
check("an empty-string holder or a blank externalCover is no holder; a held externalCover is one", () => {
  const sched = { "2026-11-10": { primary: "", backup: "", externalCover: "" }, "2026-11-11": { primary: null, backup: null, externalCover: "Atwell" } };
  assert.deepStrictEqual(dayRole(H.openSlots(sched, "2026-11-10", "2026-11-11", "2026-11-04")), [
    { day: "2026-11-10", role: "primary" }, { day: "2026-11-10", role: "backup" }, { day: "2026-11-11", role: "backup" },
  ]);
});

/* ---- units ---- */
check("weekend unit: Fri/Sat/Sun map to their Friday; pattern is weekendKinds[friday] or null; Mon-Thu have no unit", () => {
  const out = H.openSlots({}, "2026-11-05", "2026-11-09", "2026-11-04", { weekendKinds: { "2026-11-06": "split" } });
  const byDay = {}; out.forEach(s => { byDay[s.day] = s.unit; });
  assert.strictEqual(byDay["2026-11-05"], null);
  assert.deepStrictEqual(byDay["2026-11-06"], { kind: "weekend", pattern: "split", friday: "2026-11-06" });
  assert.deepStrictEqual(byDay["2026-11-07"], { kind: "weekend", pattern: "split", friday: "2026-11-06" });
  assert.deepStrictEqual(byDay["2026-11-08"], { kind: "weekend", pattern: "split", friday: "2026-11-06" });
  assert.strictEqual(byDay["2026-11-09"], null);
  const noKinds = H.openSlots({}, "2026-11-07", "2026-11-07", "2026-11-04");
  assert.deepStrictEqual(noKinds[0].unit, { kind: "weekend", pattern: null, friday: "2026-11-06" });
});
check("openSlotWeekendKinds(diagnostics.weekendUnits) keeps block/split/daily and drops locked/open/unfilled", () => {
  const kinds = H.openSlotWeekendKinds([{ friday: "2026-11-06", kind: "block" }, { friday: "2026-11-13", kind: "split" }, { friday: "2026-11-20", kind: "daily" }, { friday: "2026-11-27", kind: "unfilled" }, { friday: "2026-12-04", kind: "locked" }, null, { kind: "block" }]);
  assert.deepStrictEqual(kinds, { "2026-11-06": "block", "2026-11-13": "split", "2026-11-20": "daily" });
  assert.deepStrictEqual(H.openSlotWeekendKinds(undefined), {});
});
check("openSlotKey(day, role) is 'day|role' - the Set key the only-OPEN filter and the reasons map use", () => {
  assert.strictEqual(H.openSlotKey("2026-11-06", "primary"), "2026-11-06|primary");
  const out = H.openSlots(FX.schedule, FX.from, FX.to, FX.today, FX.opts);
  assert.strictEqual(out.find(s => H.openSlotKey(s.day, s.role) === "2026-11-04|primary").reason, FX.opts.reasons["2026-11-04|primary"]);
});

/* ---- counts + text line ---- */
check("openSlotCounts: empty and mixed lists; junk input counts as zero", () => {
  assert.deepStrictEqual(H.openSlotCounts([]), { primary: 0, backup: 0, total: 0 });
  assert.deepStrictEqual(H.openSlotCounts([{ role: "primary" }, { role: "backup" }, { role: "backup" }]), { primary: 1, backup: 2, total: 3 });
  assert.deepStrictEqual(H.openSlotCounts(null), { primary: 0, backup: 0, total: 0 });
});
check("openSlotsLine: 'Fri 11/06 - primary (weekend block) - open'; holiday unit reads 'holiday: Thanksgiving'; no unit -> no parentheses; reason appended", () => {
  assert.strictEqual(H.openSlotsLine({ day: "2026-11-06", role: "primary", unit: { kind: "weekend", pattern: "block", friday: "2026-11-06" }, reason: null }), "Fri 11/06 - primary (weekend block) - open");
  assert.strictEqual(H.openSlotsLine({ day: "2026-11-07", role: "backup", unit: { kind: "weekend", pattern: null, friday: "2026-11-06" }, reason: null }), "Sat 11/07 - backup (weekend) - open");
  assert.strictEqual(H.openSlotsLine({ day: "2026-11-26", role: "backup", unit: { kind: "holiday", name: "Thanksgiving" }, reason: null }), "Thu 11/26 - backup (holiday: Thanksgiving) - open");
  assert.strictEqual(H.openSlotsLine({ day: "2026-11-04", role: "primary", unit: null, reason: null }), "Wed 11/04 - primary - open");
  assert.strictEqual(H.openSlotsLine({ day: "2026-11-04", role: "primary", unit: null, reason: "no eligible surgeon (vacations)" }), "Wed 11/04 - primary - open - no eligible surgeon (vacations)");
});
check("openSlotsLine(slot, nameOfUnit): the optional unit namer replaces the parenthesised text", () => {
  const namer = (u) => u && u.kind === "weekend" ? "wknd " + u.friday : u && u.kind === "holiday" ? u.name.toUpperCase() : "";
  assert.strictEqual(H.openSlotsLine({ day: "2026-11-06", role: "primary", unit: { kind: "weekend", pattern: "block", friday: "2026-11-06" } }, namer), "Fri 11/06 - primary (wknd 2026-11-06) - open");
  assert.strictEqual(H.openSlotsLine({ day: "2026-11-26", role: "backup", unit: { kind: "holiday", name: "Thanksgiving" } }, namer), "Thu 11/26 - backup (THANKSGIVING) - open");
  assert.strictEqual(H.openSlotsLine({ day: "2026-11-04", role: "backup", unit: null }, namer), "Wed 11/04 - backup - open");
});

/* ---- suCoverageGlance goes THROUGH openSlots ---- */
check("suCoverageGlance(schedule, from, 60, ...) openPrimary/openBackup equal openSlots over [from, from+59] with today = from", () => {
  const from = FX.today;
  const g = H.suCoverageGlance(FX.schedule, from, 60, {}, 0.5);
  const list = H.openSlots(FX.schedule, from, H.suAddDays(from, 59), from);
  assert.deepStrictEqual(g.openPrimary, list.filter(s => s.role === "primary").map(s => s.day));
  assert.deepStrictEqual(g.openBackup, list.filter(s => s.role === "backup").map(s => s.day));
  assert.ok(g.openPrimary.length > 4 && g.openBackup.length > 8, "the 60-day window runs past the fixture's rows (no-row days are open)");
  assert.strictEqual(g.openPrimary[0], FX.today);
});
check("suCoverageGlance keeps its shape (forecastPrimary unchanged) and a past fromIso still counts from fromIso (the strip passes today)", () => {
  const fc = { s2: { "2026-11-05": 0.9 } };
  const g = H.suCoverageGlance(FX.schedule, "2026-11-01", 5, fc, 0.5);
  assert.deepStrictEqual(Object.keys(g).sort(), ["forecastPrimary", "openBackup", "openPrimary"]);
  assert.deepStrictEqual(g.openPrimary, ["2026-11-01", "2026-11-02", "2026-11-04"]);
  assert.deepStrictEqual(g.openBackup, ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]);
  assert.deepStrictEqual(g.forecastPrimary, [{ day: "2026-11-05", id: "s2", p: 0.9 }]);
  assert.deepStrictEqual(H.suCoverageGlance({}, "bad", 5), { openPrimary: [], openBackup: [], forecastPrimary: [] });
});

/* ---- board helpers (Prompt 13 part 3): pure filters the Open shifts view renders ---- */
check("helpers.js exports obBoardRows and obLastAnnounced (the board's pure row filter and 'last announced' lookup)", () => {
  ["obBoardRows", "obLastAnnounced"].forEach(n => assert.ok(has(n), "missing helpers.js export " + n));
});
check("obBoardRows: horizonDays 30 keeps today..today+29 (inclusive), 60 keeps 60 days, 'all'/null/0 keeps everything; the input order is kept", () => {
  const all = H.openSlots({}, "2026-11-04", "2027-01-31", "2026-11-04");
  assert.deepStrictEqual(H.obBoardRows(all, { today: "2026-11-04", horizonDays: 30 }).map(s => s.day).filter((d, i, a) => a.indexOf(d) === i).length, 30);
  assert.strictEqual(H.obBoardRows(all, { today: "2026-11-04", horizonDays: 30 }).slice(-1)[0].day, "2026-12-03");
  assert.strictEqual(H.obBoardRows(all, { today: "2026-11-04", horizonDays: 60 }).slice(-1)[0].day, "2027-01-02");
  assert.deepStrictEqual(H.obBoardRows(all, { today: "2026-11-04", horizonDays: "all" }), all);
  assert.deepStrictEqual(H.obBoardRows(all, { today: "2026-11-04", horizonDays: null }), all);
  assert.deepStrictEqual(H.obBoardRows(all, { today: "2026-11-04", horizonDays: 0 }), all);
  assert.deepStrictEqual(H.obBoardRows(all, {}).length > 0, true, "no filters at all keeps the list");
});
check("obBoardRows: role 'primary' / 'backup' filters, anything else keeps both; weekendOnly keeps Fri/Sat/Sun by calendar day (a holiday over a weekend day still counts as a weekend day)", () => {
  const list = H.openSlots(FX.schedule, FX.from, FX.to, FX.today, FX.opts);
  const P = H.obBoardRows(list, { today: FX.today, role: "primary" });
  const B = H.obBoardRows(list, { today: FX.today, role: "backup" });
  assert.ok(P.length && B.length && P.length + B.length === list.length);
  assert.ok(P.every(s => s.role === "primary") && B.every(s => s.role === "backup"));
  assert.deepStrictEqual(H.obBoardRows(list, { today: FX.today, role: "all" }), list);
  assert.deepStrictEqual(H.obBoardRows(list, { today: FX.today, role: "" }), list);
  const W = H.obBoardRows(list, { today: FX.today, weekendOnly: true });
  assert.ok(W.length > 0);
  W.forEach(s => { const w = H.parse(s.day).getDay(); assert.ok(w === 5 || w === 6 || w === 0, s.day + " is not a weekend day"); });
  assert.strictEqual(W.length, list.filter(s => { const w = H.parse(s.day).getDay(); return w === 5 || w === 6 || w === 0; }).length);
  // Thanksgiving Friday 11/27 is a holiday-unit day AND a Friday: weekendOnly keeps it.
  const holFri = H.obBoardRows([{ day: "2026-11-27", role: "backup", unit: { kind: "holiday", name: "Thanksgiving" }, reason: null }], { today: "2026-11-04", weekendOnly: true });
  assert.strictEqual(holFri.length, 1);
  // Filters combine: 30 days + backup + weekend.
  const combo = H.obBoardRows(list, { today: FX.today, horizonDays: 30, role: "backup", weekendOnly: true });
  combo.forEach(s => { assert.strictEqual(s.role, "backup"); assert.ok(s.day <= H.suAddDays(FX.today, 29)); });
});
check("obBoardRows: junk input never throws - a non-array or entries without a day yield [] / are dropped", () => {
  assert.deepStrictEqual(H.obBoardRows(null, { today: "2026-11-04" }), []);
  assert.deepStrictEqual(H.obBoardRows("x", {}), []);
  assert.deepStrictEqual(H.obBoardRows([null, { role: "primary" }, { day: "nope", role: "backup" }, { day: "2026-11-05", role: "primary" }], { today: "2026-11-04" }).length, 1);
  assert.deepStrictEqual(H.obBoardRows([{ day: "2026-11-05", role: "primary" }], null).length, 1);
});
check("obLastAnnounced(notifications, day, role): newest 'open_shifts' row whose data.slots lists { day, role }; other types / other slots / missing data -> null", () => {
  const rows = [
    { type: "open_shifts", created_at: "2026-11-01T12:00:00Z", data: { slots: [{ day: "2026-11-06", role: "primary" }, { day: "2026-11-07", role: "backup" }] } },
    { type: "open_shifts", created_at: "2026-11-03T09:00:00Z", data: { slots: [{ day: "2026-11-06", role: "primary" }] } },
    { type: "shift_claimed", created_at: "2026-11-04T09:00:00Z", data: { day: "2026-11-07", role: "backup", slots: [{ day: "2026-11-07", role: "backup" }] } },
    { type: "open_shifts", created_at: "2026-11-05T09:00:00Z", data: {} },
    null, { type: "open_shifts" },
  ];
  assert.strictEqual(H.obLastAnnounced(rows, "2026-11-06", "primary"), "2026-11-03T09:00:00Z");
  assert.strictEqual(H.obLastAnnounced(rows, "2026-11-07", "backup"), "2026-11-01T12:00:00Z");
  assert.strictEqual(H.obLastAnnounced(rows, "2026-11-06", "backup"), null);
  assert.strictEqual(H.obLastAnnounced(rows, "2026-11-08", "primary"), null);
  assert.strictEqual(H.obLastAnnounced(null, "2026-11-06", "primary"), null);
  assert.strictEqual(H.obLastAnnounced([], "2026-11-06", "primary"), null);
  // Order of the input does not matter (the feed is newest-first in the app, oldest-first here).
  assert.strictEqual(H.obLastAnnounced(rows.slice().reverse(), "2026-11-06", "primary"), "2026-11-03T09:00:00Z");
});

/* ---- source pins: no second definition of OPEN ---- */
{
  const helpersSrc = fs.readFileSync(path.join(ROOT, "helpers.js"), "utf8").replace(/\r\n/g, "\n");
  const appSrc = fs.readFileSync(path.join(ROOT, "index-source.html"), "utf8").replace(/\r\n/g, "\n");
  const bodyOf = (src, name) => {
    const i = src.indexOf("function " + name + "(");
    assert.ok(i >= 0, name + " is declared in helpers.js");
    const j = src.indexOf("\n}\n", i);
    return src.slice(i, j);
  };
  check("helpers.js: suCoverageGlance computes its open lists through openSlots and holds no dayHolder/slotIsOpen definition of its own", () => {
    const body = bodyOf(helpersSrc, "suCoverageGlance");
    assert.ok(/\bopenSlots\(/.test(body), "suCoverageGlance calls openSlots");
    assert.ok(!/dayHolder\(/.test(body), "no dayHolder inside suCoverageGlance");
    assert.ok(!/slotIsOpen\(/.test(body), "no slotIsOpen inside suCoverageGlance");
  });
  check("helpers.js: openSlots is the one place that reads primary/externalCover/backup for OPEN (via dayHolder) - suOpenPrimaryDays no longer re-states the rule", () => {
    assert.ok(/\bopenSlots\(/.test(bodyOf(helpersSrc, "suOpenPrimaryDays")), "suOpenPrimaryDays routes through openSlots");
  });
  check("ONE predicate (P13R): openSlots decides OPEN through slotIsOpen(d, dayHolder(a, role), today) - membership equals the per-cell rule for roster ids, an outside surgeon (item M, roster type external), ext:<cover> on primary only, holderless lock flags, and days before / on / after today", () => {
    assert.ok(bodyOf(helpersSrc, "openSlots").indexOf("slotIsOpen(d, dayHolder(a, role), t)") >= 0, "openSlots calls slotIsOpen(d, dayHolder(a, role), t) - no private holder/today test");
    const today = "2026-11-04";
    const sched = {
      "2026-11-02": { primary: "s1", backup: null },                                        // before today: never open
      "2026-11-03": { primary: null, backup: null, primaryLocked: true, backupLocked: true }, // before today, holderless locks: never open
      "2026-11-04": { primary: null, backup: null, primaryLocked: true },                   // today: both open (a lock flag holds nothing)
      "2026-11-05": { primary: "s7", backup: "s2" },                                        // outside surgeon holds primary: covered
      "2026-11-06": { primary: null, backup: null, externalCover: "Atwell" },               // ext cover: primary covered, backup open
      "2026-11-07": { primary: "", backup: "s3", externalCover: "" },                       // empty strings are no holder: primary open
      "2026-11-08": null,                                                                   // no row: both open
    };
    const from = "2026-11-02", to = "2026-11-09";
    const got = new Set(H.openSlots(sched, from, to, today).map(x => x.day + "|" + x.role));
    let n = 0;
    for (let d = from; d <= to; d = H.suAddDays(d, 1)) ["primary", "backup"].forEach(role => {
      n++;
      const a = sched[d] || null;
      const holder = H.dayHolder(a, role);
      assert.strictEqual(got.has(d + "|" + role), H.slotIsOpen(d, holder, today), d + " " + role + " (holder " + JSON.stringify(holder) + ")");
    });
    assert.strictEqual(n, 16, "every day/role pair of the range was compared");
    assert.deepStrictEqual([...got].sort(), ["2026-11-04|backup", "2026-11-04|primary", "2026-11-06|backup", "2026-11-07|primary", "2026-11-08|backup", "2026-11-08|primary", "2026-11-09|backup", "2026-11-09|primary"], "the expected open set");
  });
  check("index-source.html: the only-OPEN filter dims by an openSlots() Set - 'calOnlyOpen && !(openP || openB)' is gone", () => {
    assert.ok(appSrc.indexOf("calOnlyOpen && !(openP || openB)") < 0, "the per-cell slotIsOpen filter expression is gone");
    assert.ok(/openSlots\(/.test(appSrc), "index-source.html calls openSlots");
    const dimLine = appSrc.split("\n").find(l => /const dim = /.test(l));
    assert.ok(dimLine, "the dim line exists");
    assert.ok(/openKeys\.has\(openSlotKey\(d, "primary"\)\)/.test(dimLine) && /openKeys\.has\(openSlotKey\(d, "backup"\)\)/.test(dimLine), "dim reads the openSlots Set: " + dimLine.trim());
    const memo = appSrc.split("\n").find(l => /const openKeys = useMemo/.test(l));
    assert.ok(memo, "openKeys is memoized");
    assert.strictEqual((appSrc.match(/openKeys = useMemo/g) || []).length, 1);
  });
  check("index-source.html: the only-OPEN Set overlays a generator preview with the cells' own rule (previewGen.schedule[d] || schedule[d] per grid day), not Object.assign", () => {
    const i = appSrc.indexOf("const openKeys = useMemo");
    const j = appSrc.indexOf("}, [schedule, previewGen, gridDays, todayStr]);", i);
    assert.ok(i > 0 && j > i, "the openKeys memo is located");
    const memo = appSrc.slice(i, j);
    assert.ok(!/Object\.assign\(/.test(memo), "no Object.assign overlay in the openKeys memo (a falsy preview row would hide the live row)");
    assert.ok(/previewGen\.schedule\[d\] \|\| schedule\[d\]/.test(memo), "the memo overlays per grid day exactly as the cells do: previewGen.schedule[d] || schedule[d]");
    const cell = appSrc.split("\n").find(l => /const a = pv \|\| schedule\[d\] \|\| null;/.test(l));
    assert.ok(cell, "the cells still draw pv || schedule[d]");
  });
  check("index-source.html: the coverage strip renders suCoverageGlance(schedule, todayStr, 60, ...) only - no dayHolder / slotIsOpen inside the strip", () => {
    assert.ok(/suCoverageGlance\(schedule, todayStr, 60,/.test(appSrc), "glance memo unchanged");
    const a = appSrc.indexOf("Coverage at a glance (Prompt 11): every count links");
    const b = appSrc.indexOf('data-testid="cal-month"', a);
    assert.ok(a > 0 && b > a, "the strip region is located");
    const strip = appSrc.slice(a, b);
    assert.ok(strip.indexOf('data-testid="coverage-strip"') > 0, "the region holds the strip");
    assert.ok(!/dayHolder\(/.test(strip), "no dayHolder inside the coverage strip");
    assert.ok(!/slotIsOpen\(/.test(strip), "no slotIsOpen inside the coverage strip");
    assert.ok(/glance\.openPrimary/.test(strip) && /glance\.openBackup/.test(strip), "the strip reads glance.openPrimary / openBackup");
  });
  check("index-source.html: the JSX block stays ASCII and helpers.js / package.json / build.yml register the test", () => {
    const i = appSrc.indexOf('<script type="text/babel">'), j = appSrc.indexOf("</script>", i);
    assert.ok(i > 0 && j > i);
    assert.ok(!/[^\x00-\x7F]/.test(appSrc.slice(i, j)), "non-ASCII byte in the JSX block");
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    assert.ok(/node test\/open-shifts\.test\.js/.test(pkg.scripts.test), "package.json test script runs test/open-shifts.test.js");
    const yml = fs.readFileSync(path.join(ROOT, ".github", "workflows", "build.yml"), "utf8");
    assert.ok(/run: node test\/open-shifts\.test\.js/.test(yml), "build.yml has a step for test/open-shifts.test.js");
    assert.ok(/- "test\/open-shifts\.test\.js"/.test(yml), "build.yml paths list includes test/open-shifts.test.js");
    assert.ok(/- "test\/fixtures\/open-slots\.json"/.test(yml), "build.yml paths list includes test/fixtures/open-slots.json");
  });

  /* ---- Prompt 13 part 3: the Open shifts board (index-source.html) ---- */
  check("index-source.html: nav has the 'openshifts' tab labelled 'Open shifts' with a count badge that hides at 0 and counts the WHOLE published range (boardSlots)", () => {
    const tabsLine = appSrc.split("\n").find(l => /const allTabs = \[/.test(l));
    assert.ok(tabsLine, "allTabs is declared");
    assert.ok(/\["openshifts","Open shifts"\]/.test(tabsLine), "allTabs lists [\"openshifts\",\"Open shifts\"]: " + tabsLine.trim());
    assert.ok(/k==="openshifts" && boardSlots\.length > 0/.test(appSrc), "the badge renders only when boardSlots.length > 0");
    assert.ok(/data-testid="openshifts-badge"/.test(appSrc), "the badge carries data-testid openshifts-badge");
    assert.ok(/obBoardSlots\(schedule, todayStr, lastPublishedDay, \{/.test(appSrc), "boardSlots = obBoardSlots(schedule, todayStr, lastPublishedDay, { ... }) - the published block plus later assigned ranges, never a preview");
    assert.ok(!/openSlots\(schedule, todayStr, lastPublishedDay \|\| todayStr/.test(appSrc), "the old today-fallback openSlots call (two phantom rows with no schedule on file) is gone");
  });
  check("index-source.html: the board view renders a data-testid openshifts-table filtered through helpers.js obBoardRows and reads 'last announced' through obLastAnnounced", () => {
    assert.ok(/view==="openshifts" && !isPublicMode/.test(appSrc), "the view block is keyed 'openshifts' and hidden in public mode");
    assert.ok(/data-testid="openshifts-table"/.test(appSrc), "the table carries data-testid openshifts-table");
    assert.ok(/obBoardRows\(boardSlots, \{/.test(appSrc), "the rows come from obBoardRows(boardSlots, { ... })");
    assert.ok(/obLastAnnounced\(boardAnnounced, /.test(appSrc), "last announced reads obLastAnnounced(boardAnnounced, day, role) - the feed plus the open_shifts rows fetched for the board");
    assert.ok(/data-testid="claim-sheet"/.test(appSrc), "the confirm sheet carries data-testid claim-sheet");
    assert.ok(/openSlotsLine\(/.test(appSrc), "Copy list uses openSlotsLine");
  });
  check("index-source.html: the claim goes to POST rest/v1/rpc/claim_open_slot { p_day, p_role } with dbAuthHeaders() and the server message is shown verbatim (describeDbError passes CLAIM_* through)", () => {
    const calls = appSrc.split("\n").filter(l => /fetch\(`\$\{SUPABASE_URL\}\/rest\/v1\/rpc\/claim_open_slot`/.test(l));
    assert.strictEqual(calls.length, 1, "exactly one fetch of rest/v1/rpc/claim_open_slot");
    const line = calls[0];
    assert.ok(/method: "POST"/.test(line) && /headers: dbAuthHeaders\(\)/.test(line) && /JSON\.stringify\(\{ p_day: day, p_role: role \}\)/.test(line), "POST with dbAuthHeaders() and { p_day, p_role }: " + line.trim());
    const own = appSrc.split("\n").find(l => /const OWN = \//.test(l));
    assert.ok(own && /CLAIM_\[A-Z_\]\+/.test(own), "describeDbError's OWN regex includes CLAIM_[A-Z_]+: " + (own || "").trim());
    const rx2 = appSrc.split("\n").find(l => /const m = \/\(ON_CALL_CONFLICT\|TRADE_\[A-Z_\]\+/.test(l));
    assert.ok(rx2 && /CLAIM_\[A-Z_\]\+/.test(rx2), "describeDbError's extraction regex includes CLAIM_[A-Z_]+");
    // No duplicate audit / feed row from the client on success: the function writes both. The client logs only a failed outcome.
    const i = appSrc.indexOf("const runClaim = async");
    const j = appSrc.indexOf("\n  };\n", i);
    assert.ok(i > 0 && j > i, "runClaim is declared");
    const body = appSrc.slice(i, j);
    assert.ok(!/addNotification\(/.test(body), "runClaim writes no feed row (the SQL function does)");
    assert.ok(/logAudit\("schedule\.claim", [^\n]*outcome: "failed"/.test(body), "runClaim logs schedule.claim with outcome 'failed' on refusal only");
    assert.strictEqual((body.match(/logAudit\(/g) || []).length, 1, "exactly one logAudit call inside runClaim (the failure path)");
    assert.ok(/sendEmailNotif\("shift_claimed"/.test(body), "runClaim calls the part 5d hook sendEmailNotif('shift_claimed', ...)");
    assert.ok(/refreshDaysRef\.current\(\)/.test(body), "runClaim refetches schedule_days");
  });
  check("index-source.html: the feed shows open_shifts to everyone; tabMap routes open_shifts -> openshifts and shift_claimed -> calendar", () => {
    const i = appSrc.indexOf("const myNotifications = useMemo");
    const j = appSrc.indexOf("}, [notifications, isScheduler, mySurgeon, notifClearedBefore]);", i);
    assert.ok(i > 0 && j > i, "myNotifications memo located");
    assert.ok(/n\.type === "open_shifts"/.test(appSrc.slice(i, j)), "open_shifts passes the member filter");
    const tabMap = appSrc.split("\n").find(l => /const tabMap = \{/.test(l));
    assert.ok(tabMap && /open_shifts:"openshifts"/.test(tabMap) && /shift_claimed:"calendar"/.test(tabMap), "tabMap has open_shifts -> openshifts and shift_claimed -> calendar: " + (tabMap || "").trim());
  });
  check("index-source.html: the DayEditor honours an optional focusExternal prop (the board's 'Outside cover' action) and the editor renders for the board view too", () => {
    assert.ok(/focusExternal/.test(appSrc.slice(appSrc.indexOf("function DayEditor(props)"))), "DayEditor reads focusExternal");
    assert.ok(/\(view==="calendar" \|\| view==="openshifts"\) && editorDay &&/.test(appSrc), "the DayEditor is rendered for the calendar and the board views");
    assert.strictEqual((appSrc.match(/<DayEditor /g) || []).length, 1, "one DayEditor render site");
  });

  /* ---- fix round (review of part 3) ---- */
  check("index-source.html (fix round): the table states the later assigned ranges (data-ranges) and reads 'No schedule days on file yet' when nothing is published", () => {
    assert.ok(/data-ranges=\{/.test(appSrc), "the table carries data-ranges");
    assert.ok(/No schedule days on file yet/.test(appSrc), "the empty-schedule message exists");
    assert.ok(/boardRanges/.test(appSrc), "the header names the later ranges (boardRanges)");
  });
  check("index-source.html (fix round): a locked-but-empty slot disables Take this shift with a 'slot locked' title (the function refuses CLAIM_LOCKED); the chips are unaffected", () => {
    assert.ok(/schedule\[s\.day\]\[s\.role \+ "Locked"\]/.test(appSrc), "the row reads schedule[s.day][s.role + 'Locked']");
    assert.ok(/slot locked - ask the scheduler to assign it/.test(appSrc), "the disabled title reads 'slot locked - ask the scheduler to assign it'");
  });
  check("index-source.html (fix round): sendEmailNotif returns its outcome and treats an 'unknown notification type' 400 as an info toast (never an error); notifyOpenShifts(origin, slots, through) awaits it and words its toast by outcome", () => {
    const i = appSrc.indexOf("const sendEmailNotif = useCallback");
    const j = appSrc.indexOf("}, []);", i);
    assert.ok(i > 0 && j > i, "sendEmailNotif located");
    const body = appSrc.slice(i, j);
    assert.ok(/unknown notification type/.test(body), "sendEmailNotif recognises 'unknown notification type'");
    assert.ok(/notEnabled: true/.test(body), "returns notEnabled: true for it");
    assert.ok(/return \{ ok: true, sent/.test(body), "returns { ok: true, sent, ... } on success");
    const k = appSrc.indexOf("const notifyOpenShifts = async (origin, slots, through)");
    assert.ok(k > 0, "notifyOpenShifts(origin, slots, through) takes explicit inputs");
    // part 5 moved the writes into sendOpenShiftsNotice(origin, n) - the board's preview dialog and the publish hook both end there
    const ks = appSrc.indexOf("const sendOpenShiftsNotice = async (origin, n, quiet)");
    assert.ok(ks > 0, "sendOpenShiftsNotice(origin, n, quiet) holds the writes");
    const nb = appSrc.slice(ks, appSrc.indexOf("\n  };\n", ks));
    assert.ok(/const mail = await sendEmailNotif\("open_shifts"/.test(nb), "sendOpenShiftsNotice awaits sendEmailNotif");
    assert.ok(!/has been told/.test(nb), "no unconditional success toast");
    assert.ok(/const composeOpenShiftsNotice = \(slots, through\)/.test(appSrc), "composeOpenShiftsNotice(slots, through) takes explicit inputs");
    assert.ok(/notifyOpenShifts\("board", boardSlots, boardEnd\)/.test(appSrc), "the board passes (boardSlots, boardEnd)");
  });
  check("index-source.html (fix round): 'last announced' also reads the newest open_shifts rows fetched when the board opens (boardNotices), not only the 50-row feed; a preview's weekend kinds are MERGED over lastGenerate's", () => {
    assert.ok(/readAuthOnlyTable\("notifications", \{ eq: \{ type: "open_shifts" \}/.test(appSrc), "boardNotices: readAuthOnlyTable('notifications', { eq: { type: 'open_shifts' }, ... })");
    assert.ok(/\{ \.\.\.openSlotWeekendKinds\(fromLast\), \.\.\.openSlotWeekendKinds\(fromPreview\) \}/.test(appSrc), "weekend kinds merge the preview over lastGenerate");
  });
  check("index-source.html (fix round): the claim sheet focuses Cancel when it opens, keeps Tab inside, returns focus to the opener on close, and names the unit's other open days (obUnitMates)", () => {
    assert.ok(/ref=\{claimCancelRef\}/.test(appSrc), "Cancel carries claimCancelRef");
    assert.ok(/claimCancelRef\.current\.focus\(\)/.test(appSrc), "Cancel is focused when the sheet opens");
    assert.ok(/claimReturnRef/.test(appSrc), "the opener is remembered for the return focus");
    assert.ok(/obUnitMates\(boardSlots, /.test(appSrc), "the sheet lists obUnitMates(boardSlots, slot)");
    assert.ok(/data-testid="claim-unit-mates"/.test(appSrc), "the unit-mates warning carries data-testid claim-unit-mates");
  });
}

/* ---- fix round: the board's range union and the sheet's unit mates (pure) ---- */
check("helpers.js exports obBoardSlots and obUnitMates (the board's range union and the confirm sheet's 'other open days of this unit')", () => {
  ["obBoardSlots", "obUnitMates"].forEach(n => assert.ok(has(n), "missing helpers.js export " + n));
});
check("obBoardSlots: today..lastPublishedDay first, then the open slots of every ASSIGNED range after it (a pre-assigned unit weeks beyond the block); gap days without a row and stray unheld rows stay out; end + ranges reported", () => {
  const sched = {
    "2026-11-01": { primary: "s1", backup: null },
    "2026-11-26": { primary: "s1", backup: null },
    "2026-11-27": { primary: "s1", backup: null },
    "2026-11-28": { primary: null, backup: "s2" },
    "2026-11-29": { primary: "s1", backup: "s2" },
    "2026-12-05": { primary: null, backup: null },
  };
  const out = H.obBoardSlots(sched, "2026-10-31", "2026-11-01");
  assert.strictEqual(out.end, "2026-11-01");
  assert.deepStrictEqual(out.ranges, [{ start: "2026-11-26", end: "2026-11-29" }]);
  assert.deepStrictEqual(dayRole(out.slots), [
    { day: "2026-10-31", role: "primary" }, { day: "2026-10-31", role: "backup" },
    { day: "2026-11-01", role: "backup" },
    { day: "2026-11-26", role: "backup" }, { day: "2026-11-27", role: "backup" }, { day: "2026-11-28", role: "primary" },
  ]);
  assert.ok(!out.slots.some(s => s.day > "2026-11-01" && s.day < "2026-11-26"), "gap days (no row) are not listed - Generate covers them");
  assert.ok(!out.slots.some(s => s.day === "2026-12-05"), "a stray row nobody holds is not an assigned range");
});
check("obBoardSlots: no published day (null / undefined) -> no rows, never today's two phantom slots; a block that ended before today still lists later assigned ranges from today; opts reach openSlots; a later range before today contributes nothing", () => {
  assert.deepStrictEqual(H.obBoardSlots({}, "2026-10-31", null), { slots: [], end: null, ranges: [] });
  assert.deepStrictEqual(H.obBoardSlots({ "2026-10-31": { primary: null, backup: null } }, "2026-10-31", undefined).slots, []);
  const sched = { "2026-10-01": { primary: "s1", backup: "s2" }, "2026-11-26": { primary: "s1", backup: null } };
  const out = H.obBoardSlots(sched, "2026-10-31", "2026-10-01", { holidayByDay: { "2026-11-26": { name: "Thanksgiving" } }, reasons: { "2026-11-26|backup": "nobody eligible" } });
  assert.strictEqual(out.end, "2026-10-01");
  assert.deepStrictEqual(out.ranges, [{ start: "2026-11-26", end: "2026-11-26" }]);
  assert.deepStrictEqual(out.slots.map(s => [s.day, s.role, s.unit && s.unit.name, s.reason]), [["2026-11-26", "backup", "Thanksgiving", "nobody eligible"]]);
  const past = H.obBoardSlots({ "2026-10-01": { primary: "s1" }, "2026-10-10": { primary: null, backup: "s2" } }, "2026-10-31", "2026-10-01");
  assert.deepStrictEqual(past.slots, []);
  assert.deepStrictEqual(past.ranges, []);
  assert.deepStrictEqual(H.obBoardSlots(null, "2026-10-31", null), { slots: [], end: null, ranges: [] });
  assert.deepStrictEqual(H.obBoardSlots(null, "2026-10-31", "2026-10-31").ranges, [], "a junk schedule has no later ranges");
});
check("obUnitMates(slots, slot): the other OPEN days of the same unit in the same role - a holiday unit always, a weekend only when its pattern is 'block'; other roles / units / years, split-daily-unknown weekends and slots without a unit -> []", () => {
  const H1 = { kind: "holiday", name: "Thanksgiving" };
  const wkB = { kind: "weekend", pattern: "block", friday: "2026-11-06" };
  const wkS = { kind: "weekend", pattern: "split", friday: "2026-11-13" };
  const wkN = { kind: "weekend", pattern: null, friday: "2026-11-20" };
  const slots = [
    { day: "2026-11-26", role: "backup", unit: H1 }, { day: "2026-11-27", role: "backup", unit: H1 }, { day: "2026-11-27", role: "primary", unit: H1 }, { day: "2026-11-29", role: "backup", unit: H1 },
    { day: "2026-11-06", role: "primary", unit: wkB }, { day: "2026-11-08", role: "primary", unit: wkB }, { day: "2026-11-07", role: "backup", unit: wkB },
    { day: "2026-11-13", role: "primary", unit: wkS }, { day: "2026-11-14", role: "primary", unit: wkS },
    { day: "2026-11-20", role: "primary", unit: wkN }, { day: "2026-11-21", role: "primary", unit: wkN },
    { day: "2026-11-03", role: "primary", unit: null },
    { day: "2027-11-25", role: "backup", unit: { kind: "holiday", name: "Thanksgiving" } },
  ];
  const days = (l) => l.map(s => s.day);
  assert.deepStrictEqual(days(H.obUnitMates(slots, slots[0])), ["2026-11-27", "2026-11-29"]);
  assert.deepStrictEqual(days(H.obUnitMates(slots, slots[3])), ["2026-11-26", "2026-11-27"]);
  assert.deepStrictEqual(days(H.obUnitMates(slots, slots[2])), []);
  assert.deepStrictEqual(days(H.obUnitMates(slots, slots[4])), ["2026-11-08"]);
  assert.deepStrictEqual(days(H.obUnitMates(slots, slots[6])), []);
  assert.deepStrictEqual(H.obUnitMates(slots, slots[7]), []);
  assert.deepStrictEqual(H.obUnitMates(slots, slots[9]), []);
  assert.deepStrictEqual(H.obUnitMates(slots, slots[11]), []);
  assert.deepStrictEqual(H.obUnitMates(null, slots[0]), []);
  assert.deepStrictEqual(H.obUnitMates(slots, null), []);
  assert.deepStrictEqual(H.obUnitMates(slots, { day: "2026-11-26", role: "backup" }), []);
});

/* ---- Prompt 13 part 4: WHY IS IT OPEN - persist the reasons ----
   helpers.openSlotReason(reasonsById) renders the generator's per-surgeon hard
   codes as ONE operational sentence (fixed category table, union across the
   surgeons, never an id / name / free text); lastGenerateFromDiagnostics(dg, at)
   builds the blob record call_schedule_data.data.lastGenerate. That blob is
   anon-readable, so every string the generator can make us write is run through
   the importer's denylist gate (Prompt 12 item F) here. */
{
  const R = require(path.join(ROOT, "rules.js"));
  const IMP = require(path.join(ROOT, "importer.js"));
  const LG = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "last-generate-diagnostics.json"), "utf8"));
  const CATEGORIES = ["vacations", "weekday patterns and stated availability", "East feed busy", "East-derived week", "caps reached", "already on call that day", "holiday opt-outs", "backup opt-outs", "locks", "other rules"];
  const NAMES = [].concat(...LG.roster.map(r => [r.id, r.name, r.code]));
  const noNames = (text, what) => NAMES.forEach(n => assert.ok(!new RegExp("\\b" + n + "\\b").test(text), (what || "reason") + " leaks '" + n + "': " + text));
  const oneReason = (code) => H.openSlotReason({ s1: [code], s2: [code], s3: [code], s4: [code], s5: [code], s6: [code] });
  const rulesSrc = fs.readFileSync(path.join(ROOT, "rules.js"), "utf8").replace(/\r\n/g, "\n");
  const appSrc = fs.readFileSync(path.join(ROOT, "index-source.html"), "utf8").replace(/\r\n/g, "\n");

  check("helpers.js exports openSlotReason and lastGenerateFromDiagnostics; rules.js exports HARD_REASONS", () => {
    ["openSlotReason", "lastGenerateFromDiagnostics"].forEach(n => assert.ok(has(n), "missing helpers.js export " + n));
    assert.ok(Array.isArray(R.HARD_REASONS) && R.HARD_REASONS.length > 20, "rules.js exports HARD_REASONS (array of hard-reason codes)");
  });
  check("rules.HARD_REASONS equals the vocabulary comment above rdStatic and covers every hard.push(\"...\") literal in rules.js", () => {
    const i = rulesSrc.indexOf("// Hard reason vocabulary");
    assert.ok(i > 0, "the vocabulary comment exists");
    const j = rulesSrc.indexOf("):", i);
    const k = rulesSrc.indexOf(".\n", j);
    const fromComment = rulesSrc.slice(j + 2, k).replace(/\n\/\/ ?/g, " ").split(",").map(s => s.trim()).filter(Boolean);
    assert.deepStrictEqual(R.HARD_REASONS.slice().sort(), fromComment.slice().sort(), "HARD_REASONS and the comment list the same codes");
    // every code literal ("time-off:", "inactive") whatever its shape; only the comment's own hard.push("...") placeholder is excluded,
    // and the count is pinned so a new literal (of any spelling) has to be added to HARD_REASONS and here
    const pushed = [...new Set((rulesSrc.match(/hard\.push\("([^"]+)"/g) || []).map(m => /"([^"]+)"/.exec(m)[1]).filter(c => c !== "..."))];
    assert.strictEqual(pushed.length, 30, "hard.push literal count changed - update HARD_REASONS, the vocabulary comment and this pin: " + pushed.join(", "));
    pushed.forEach(c => assert.ok(R.HARD_REASONS.includes(c), "pushed code not in HARD_REASONS: " + c));
    ["whitelist-month", "outside-available-weeks", "bad-role:"].forEach(c => assert.ok(R.HARD_REASONS.includes(c), "code assigned outside hard.push missing: " + c));
  });
  check("openSlotReason: each category of the fixed table renders from its own codes (detail after ':' and '@day' suffixes ignored)", () => {
    const table = {
      "vacations": ["time-off:2026-11-05", "day-before-vacation"],
      "weekday patterns and stated availability": ["hard-never-weekday:Mon", "weekday-not-allowed:Tue", "recurring-unavailable:Thu", "not-recurring-available", "whitelist-month", "outside-available-weeks", "outside-window", "weekday-pattern:Wed", "weekend-block-only", "day-before-aledo", "unavailable-row", "no-backup-row", "backup-only-row"],
      "East feed busy": ["east-busy", "east-forecast-busy:2026-12-01"],
      "East-derived week": ["derived-lock:2026-11-09", "derived-lock-held:2026-11-10"],
      "caps reached": ["monthly-cap:8", "backup-cap:7", "backup-weekend-cap:1", "max-consecutive:2", "max-major-holidays:1"],
      "already on call that day": ["holds-other-role"],
      "holiday opt-outs": ["holiday-opt-out:Thanksgiving"],
      "backup opt-outs": ["backup-opt-out"],
      "locks": ["slot-locked:import", "external-cover", "inactive", "unknown-surgeon"],
      "other rules": ["bad-role:nurse", "something-new:1", ""],
    };
    Object.keys(table).forEach(cat => table[cat].forEach(code => {
      assert.strictEqual(oneReason(code), "no eligible surgeon - " + cat, "code " + JSON.stringify(code));
      assert.strictEqual(oneReason(code + "@2026-11-26"), "no eligible surgeon - " + cat, "code " + JSON.stringify(code) + " on a holiday-unit day");
    }));
  });
  check("openSlotReason: the generator's two placeholders (someone WAS eligible, the generator failed to place) never read as a rules outcome - 'generator could not place - report it', with the other surgeons' categories in parentheses when there are any", () => {
    const UNPLACED = "generator could not place - report it";
    ["eligible-but-not-placed", "holiday-unit:eligible-but-unit-not-filled", "eligible-but-not-placed@2026-11-26", "holiday-unit:eligible-but-unit-not-filled@2026-11-27"].forEach(code => {
      assert.strictEqual(oneReason(code), UNPLACED, "code " + JSON.stringify(code));
      assert.strictEqual(H.openSlotReason({ s1: [code] }), UNPLACED, "a single surgeon, code " + JSON.stringify(code));
    });
    assert.strictEqual(H.openSlotReason({ s1: ["time-off:2026-11-26"], s2: ["eligible-but-not-placed"], s3: ["monthly-cap:8"] }), UNPLACED + " (other surgeons: vacations, caps reached)");
    assert.strictEqual(H.openSlotReason({ s1: ["holiday-unit:eligible-but-unit-not-filled"], s2: ["eligible-but-not-placed"], s3: ["what-is-this"] }), UNPLACED + " (other surgeons: other rules)");
    assert.strictEqual(H.openSlotReason({ s1: ["eligible-but-not-placed"], s2: ["bad-role:x"] }), UNPLACED + " (other surgeons: other rules)", "bad-role is still 'other rules'");
    assert.strictEqual(H.openSlotReason({ s1: ["holiday-unit"] }), UNPLACED, "the prefix before ':' is the code");
    assert.strictEqual(H.openSlotReason({ s1: ["eligible-but-not-placed:Khan FAK"], Khan: ["eligible-but-not-placed"] }).indexOf("Khan"), -1, "no detail or key from the input");
    IMP.impRefuseNoteDenylist({ lastGenerate: { openSlots: [{ day: "2026-11-05", role: "backup", reason: UNPLACED }, { day: "2026-11-26", role: "primary", reason: UNPLACED + " (other surgeons: " + CATEGORIES.join(", ") + ")" }] } });
  });
  check("openSlotReason: a mix unions the categories in table order, once each; empty / junk input -> 'no eligible surgeon'; never an id, name or code from the input", () => {
    const mixed = H.openSlotReason({ s1: ["monthly-cap:8", "holds-other-role"], s2: ["time-off:2026-11-05"], s3: ["east-busy", "time-off:2026-11-06"], s4: ["weekday-pattern:Thu"], s5: ["derived-lock:2026-11-09"], s6: ["backup-opt-out"] });
    assert.strictEqual(mixed, "no eligible surgeon - vacations, weekday patterns and stated availability, East feed busy, East-derived week, caps reached, already on call that day, backup opt-outs");
    assert.strictEqual(H.openSlotReason({}), "no eligible surgeon");
    assert.strictEqual(H.openSlotReason(null), "no eligible surgeon");
    assert.strictEqual(H.openSlotReason({ s1: [] }), "no eligible surgeon");
    assert.strictEqual(H.openSlotReason({ s1: "time-off:2026-11-05" }), "no eligible surgeon - vacations", "a bare string is accepted like a one-item list");
    assert.strictEqual(H.openSlotReason({ s1: [null, 3, "east-busy"] }), "no eligible surgeon - East feed busy", "non-strings are skipped");
    // Names / codes smuggled into a detail never reach the sentence.
    const smuggled = H.openSlotReason({ s1: ["time-off:Khan FAK s1"], Khan: ["monthly-cap:Burchett"], FAK: ["what-is-this:Acton wife funeral"] });
    assert.strictEqual(smuggled, "no eligible surgeon - vacations, caps reached, other rules");
    noNames(smuggled);
    noNames(mixed);
    assert.ok(!/[:@]/.test(mixed) && !/\d/.test(mixed), "no detail / date text in the sentence: " + mixed);
  });
  check("EVERY hard code in rules.HARD_REASONS renders to a named category (bad-role: -> other rules) and every sentence passes the importer denylist gate (item F) with no surgeon name", () => {
    const all = R.HARD_REASONS.map(c => c + (c.endsWith(":") ? "x" : ""));
    const rendered = {};
    all.forEach(code => {
      const text = oneReason(code);
      rendered[code] = text;
      assert.ok(text.indexOf("no eligible surgeon - ") === 0, code + " -> " + text);
      const cat = text.slice("no eligible surgeon - ".length);
      assert.ok(CATEGORIES.includes(cat), code + " renders an unknown category: " + cat);
      assert.strictEqual(cat === "other rules", code === "bad-role:x", code + " must map to a named category, got " + cat);
      noNames(text, code);
    });
    // the union of all codes at once, and every single one, through the blob gate
    const everything = H.openSlotReason({ s1: all, s2: all.slice().reverse() });
    assert.strictEqual(everything, "no eligible surgeon - " + CATEGORIES.join(", "));
    IMP.impRefuseNoteDenylist({ lastGenerate: { openSlots: Object.keys(rendered).map(c => ({ day: "2026-11-05", role: "primary", reason: rendered[c] })).concat([{ day: "2026-11-06", role: "backup", reason: everything }]) } });
    IMP.impRefuseNoteDenylist({ lastGenerate: { openSlots: CATEGORIES.map(c => ({ day: "2026-11-05", role: "primary", reason: "no eligible surgeon - " + c })) } });
  });
  check("lastGenerateFromDiagnostics(diagnostics, at) on the fixture: { at, range: { start, end }, openSlots sorted by day then role, weekendKinds } - reasons are the rendered sentences, never the reasons map", () => {
    const out = H.lastGenerateFromDiagnostics(LG.diagnostics, LG.at);
    assert.deepStrictEqual(out, LG.expected);
    assert.deepStrictEqual(Object.keys(out).sort(), ["at", "openSlots", "range", "weekendKinds"], "no extra keys (the diagnostics are NOT persisted)");
    noNames(JSON.stringify(out), "lastGenerate record");
    IMP.impRefuseNoteDenylist({ lastGenerate: out });
    // the board consumes the record as-is
    const reasons = {}; out.openSlots.forEach(s => { reasons[H.openSlotKey(s.day, s.role)] = s.reason; });
    const sched = { "2026-11-05": { primary: null, backup: null }, "2026-11-07": { primary: "s1", backup: null } };
    const slots = H.openSlots(sched, "2026-11-05", "2026-11-07", "2026-11-05", { reasons, weekendKinds: out.weekendKinds });
    assert.deepStrictEqual(slots.map(s => [s.day, s.role, s.reason, s.unit && s.unit.pattern]), [
      ["2026-11-05", "primary", LG.expected.openSlots[0].reason, null], ["2026-11-05", "backup", LG.expected.openSlots[1].reason, null],
      ["2026-11-06", "primary", null, "block"], ["2026-11-06", "backup", null, "block"], ["2026-11-07", "backup", LG.expected.openSlots[2].reason, "block"],
    ]);
  });
  check("lastGenerateFromDiagnostics: junk / partial diagnostics -> an empty record (never throws); a missing 'at' is stamped now (ISO); openSlotWeekendKinds accepts a ready { friday: kind } map (the persisted form) and drops junk entries", () => {
    const before = Date.now();
    const empty = H.lastGenerateFromDiagnostics(null);
    assert.deepStrictEqual(Object.keys(empty).sort(), ["at", "openSlots", "range", "weekendKinds"]);
    assert.deepStrictEqual([empty.range, empty.openSlots, empty.weekendKinds], [{ start: null, end: null }, [], {}]);
    assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(empty.at) && Date.parse(empty.at) >= before, "at is an ISO timestamp of now");
    assert.deepStrictEqual(H.lastGenerateFromDiagnostics({ uncovered: "nope", weekendUnits: {} }, "2026-09-22T15:00:00.000Z"), { at: "2026-09-22T15:00:00.000Z", range: { start: null, end: null }, openSlots: [], weekendKinds: {} });
    assert.deepStrictEqual(H.lastGenerateFromDiagnostics({ range: { start: "2026-11-02", end: "2026-11-30" }, uncovered: [{ day: "2026-13-40", role: "primary", reasons: {} }, { day: "2026-11-03", role: "nurse", reasons: {} }, { day: "2026-11-03", role: "backup" }] }, "x").openSlots,
      [{ day: "2026-11-03", role: "backup", reason: "no eligible surgeon" }], "junk days / roles dropped; a slot without a reasons map still renders");
    assert.deepStrictEqual(H.openSlotWeekendKinds({ "2026-11-06": "block", "2026-11-13": "daily", "2026-11-20": "locked", "bad": "split", "2026-11-27": 7 }), { "2026-11-06": "block", "2026-11-13": "daily" });
    assert.deepStrictEqual(H.openSlotWeekendKinds(LG.diagnostics.weekendUnits), LG.expected.weekendKinds);
  });
  check("a real generator run (seed 1, best of 1, Nov-Dec 2026 over the seed) yields a record whose every reason passes the denylist gate and names nobody", () => {
    const SA = require(path.join(__dirname, "seed-adapter.js"));
    const GEN = require(path.join(ROOT, "generator.js"));
    const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "silvis-seed.json"), "utf8"));
    const ctx = R.buildContext(SA.seedToContextInput(seed, {}));
    const out = GEN.generate(ctx, "2026-11-02", "2026-12-31", { seed: 1, bestOf: 1 });
    const rec = H.lastGenerateFromDiagnostics(out.diagnostics, "2026-09-22T15:00:00.000Z");
    assert.deepStrictEqual(rec.range, { start: "2026-11-02", end: "2026-12-31" });
    assert.strictEqual(rec.openSlots.length, (out.diagnostics.uncovered || []).length, "one record per uncovered slot");
    const roster = [].concat(...seed.roster.map(r => [r.id, r.name, r.code]));
    rec.openSlots.forEach(s => {
      assert.ok(/^(no eligible surgeon( - .+)?|generator could not place - report it( \(other surgeons: .+\))?)$/.test(s.reason), s.day + " " + s.role + ": " + s.reason);
      roster.forEach(n => assert.ok(!new RegExp("\\b" + n + "\\b").test(s.reason), s.day + " leaks " + n));
    });
    IMP.impRefuseNoteDenylist({ lastGenerate: rec });
    assert.ok(Object.keys(rec.weekendKinds).length >= 4, "weekend kinds carried over: " + JSON.stringify(rec.weekendKinds));
  });
  check("index-source.html: Accept & Publish stores lastGenerateFromDiagnostics(pv.diagnostics, ...) only after the CAS write succeeded (r.ok); the autosave watches lastGenerate; the board reads lastGenerate.weekendKinds", () => {
    const acc = appSrc.slice(appSrc.indexOf("const acceptMerged = async"), appSrc.indexOf("// --- Seed import"));
    const okAt = acc.indexOf("if (r && r.ok) {"), setAt = acc.indexOf("setLastGenerate(lastGenerateFromDiagnostics(pv.diagnostics,");
    assert.ok(okAt > 0 && setAt > okAt && setAt < acc.indexOf("} else if (r && r.blocked)"), "setLastGenerate(lastGenerateFromDiagnostics(pv.diagnostics, ...)) sits inside the r.ok branch");
    assert.ok(/\}, \[loaded, surgeons, surgeonRules, groupRules, holidays, settings, lastPublished, lastGenerate, schedule, vacations, availabilityRows\]\);/.test(appSrc), "the autosave effect lists lastGenerate in its dependencies");
    assert.ok(/lastGenerate\.weekendKinds/.test(appSrc), "boardWeekendKinds reads the persisted weekendKinds map");
    assert.ok(/\{ \.\.\.openSlotWeekendKinds\(fromLast\), \.\.\.openSlotWeekendKinds\(fromPreview\) \}/.test(appSrc), "the preview still overlays the persisted kinds");
    // design (b): the board's reasons come from lastGenerate with a live-preview fallback, rendered through the same openSlotReason
    const br = appSrc.slice(appSrc.indexOf("const boardReasons = useMemo("), appSrc.indexOf("const boardWeekendKinds = useMemo("));
    assert.ok(br.length > 0 && br.includes("previewGen.diagnostics.uncovered"), "boardReasons reads previewGen.diagnostics.uncovered");
    assert.ok(br.includes("openSlotReason(u.reasons)"), "the preview's slots are rendered through openSlotReason (never the raw reasons map)");
    assert.ok(br.includes("return { ...fromLast, ...fromPreview };") && /\}, \[previewGen, lastGenerate\]\);\s*$/.test(br), "the preview overlays the persisted reasons and the memo depends on both");
  });
}

/* ---- Prompt 13 part 5: NOTIFICATIONS ----
   helpers.openShiftsEmail(slots, { appUrl, through, nameOfUnit }) is the ONE
   composer of the group notice (Accept & Publish hook, the board's Email the
   group now, and - mirrored in plain JS between the markers
   '// @openSlots-mirror-start' / '// @openSlots-mirror-end' of
   edge-functions/daily-reminder/index.ts - the Monday cron). The mirror block
   is extracted here, evaluated as JavaScript and run against the same fixtures
   as helpers.openSlots / openShiftsEmail. Source pins keep the client, the
   send-notification categories and the README cron job in step. */
{
  const EM = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "open-shifts-email.json"), "utf8"));
  const slotsWithUnits = () => H.openSlots(FX.schedule, FX.from, FX.to, FX.today, FX.opts);
  const drSrc = fs.readFileSync(path.join(ROOT, "edge-functions", "daily-reminder", "index.ts"), "utf8").replace(/\r\n/g, "\n");
  const snSrc = fs.readFileSync(path.join(ROOT, "edge-functions", "send-notification", "index.ts"), "utf8").replace(/\r\n/g, "\n");
  const readme = fs.readFileSync(path.join(ROOT, "edge-functions", "README.md"), "utf8").replace(/\r\n/g, "\n");
  const appSrc = fs.readFileSync(path.join(ROOT, "index-source.html"), "utf8").replace(/\r\n/g, "\n");
  const START = "// @openSlots-mirror-start", END = "// @openSlots-mirror-end";
  const mirrorBlock = () => {
    const i = drSrc.indexOf(START), j = drSrc.indexOf(END);
    assert.ok(i >= 0, "daily-reminder/index.ts carries the marker " + START);
    assert.ok(j > i, "daily-reminder/index.ts carries the marker " + END + " after the start marker");
    return drSrc.slice(i + START.length, j);
  };
  const loadMirror = () => new Function(mirrorBlock() + "\nreturn { openSlots: openSlotsMirror, openShiftsEmail: openShiftsEmailMirror, window: typeof openShiftsWindowMirror === 'function' ? openShiftsWindowMirror : null };")();
  // A tiny seeded PRNG so the client-vs-mirror comparison below is reproducible.
  const prng = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  check("helpers.js exports openShiftsEmail (the pure composer of the open-shifts notice)", () => {
    assert.ok(has("openShiftsEmail"), "missing helpers.js export openShiftsEmail");
  });
  check("openShiftsEmail on the fixture: subject 'N open shifts through M/D', message = lead line + slots grouped by Monday week with one indented openSlotsLine each, detail = 'Take this shift: <appUrl>#openshifts'", () => {
    const out = H.openShiftsEmail(slotsWithUnits(), { appUrl: EM.appUrl, through: EM.through });
    assert.strictEqual(out.subject, EM.expected.subject);
    assert.strictEqual(out.message, EM.expected.message);
    assert.strictEqual(out.detail, EM.expected.detail);
    assert.strictEqual(out.through, EM.expected.through);
    assert.strictEqual(out.count, EM.expected.count);
    assert.deepStrictEqual(out.slots, FX.expected, "slots echo the { day, role } pairs (what the feed row's data.slots stores)");
    // every fixture line appears once, indented by two spaces, and nothing else reads '- open'
    const lines = out.message.split("\n").filter(l => / - open/.test(l));
    assert.deepStrictEqual(lines, FX.expectedLines.map(l => "  " + l));
    assert.strictEqual((out.message.match(/^Week of Mon \d{1,2}\/\d{1,2}:$/gm) || []).length, 4, "four Monday weeks: 11/2, 11/9, 11/16, 11/23");
  });
  check("openShiftsEmail: a single slot reads in the singular; through defaults to the last slot's day; a string second argument is the appUrl; nameOfUnit reaches openSlotsLine", () => {
    const one = H.openShiftsEmail(EM.oneSlot.slots, { appUrl: EM.appUrl });
    assert.deepStrictEqual({ subject: one.subject, message: one.message, detail: one.detail, through: one.through, count: one.count }, EM.oneSlot.expected);
    const viaString = H.openShiftsEmail(EM.oneSlot.slots, EM.appUrl);
    assert.strictEqual(viaString.detail, EM.oneSlot.expected.detail);
    assert.strictEqual(viaString.subject, EM.oneSlot.expected.subject);
    const named = H.openShiftsEmail(EM.oneSlot.slots, { appUrl: EM.appUrl, nameOfUnit: (u) => u.kind === "weekend" ? "wknd" : "" });
    assert.ok(named.message.indexOf("  Fri 11/06 - primary (wknd) - open") > 0, named.message);
    // an explicit through wins over the last slot even when it lies beyond it
    assert.strictEqual(H.openShiftsEmail(EM.oneSlot.slots, { appUrl: EM.appUrl, through: "2026-12-31" }).subject, "1 open shift through 12/31");
  });
  check("openShiftsEmail: input order does not matter (sorted by day then primary before backup); junk entries are dropped; no slots -> a 'fully covered' message with count 0; no appUrl -> a detail that still says where to go; never throws", () => {
    const shuffled = slotsWithUnits().slice().reverse();
    assert.strictEqual(H.openShiftsEmail(shuffled, { appUrl: EM.appUrl, through: EM.through }).message, EM.expected.message);
    const junk = H.openShiftsEmail([null, 3, { day: "nope", role: "primary" }, { day: "2026-11-06", role: "nurse" }].concat(EM.oneSlot.slots), EM.appUrl);
    assert.strictEqual(junk.count, 1);
    assert.strictEqual(junk.subject, EM.oneSlot.expected.subject);
    const none = H.openShiftsEmail([], EM.appUrl);
    assert.strictEqual(none.count, 0);
    assert.strictEqual(none.subject, "0 open shifts");
    assert.ok(/fully covered|No open shifts/.test(none.message), none.message);
    assert.deepStrictEqual(none.slots, []);
    assert.strictEqual(none.through, null);
    [undefined, null, "x", {}].forEach(v => { const r = H.openShiftsEmail(v, EM.appUrl); assert.strictEqual(r.count, 0); });
    const noUrl = H.openShiftsEmail(EM.oneSlot.slots);
    assert.ok(/^Take this shift: /.test(noUrl.detail) && noUrl.detail.indexOf("Open shifts") > 0, noUrl.detail);
    assert.ok(noUrl.detail.indexOf("undefined") < 0 && noUrl.detail.indexOf("null") < 0, noUrl.detail);
    // no address-shaped text can come out of the composer for the fixture (the feed row is anon-readable)
    assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(EM.expected.message + EM.expected.subject), "no e-mail address in the composed text");
  });

  /* -- the TypeScript mirror (plain JS between the markers) -- */
  check("daily-reminder/index.ts: the block between '// @openSlots-mirror-start' and '// @openSlots-mirror-end' is plain JavaScript (evaluates with new Function, no type annotations) and defines openSlotsMirror + openShiftsEmailMirror", () => {
    const block = mirrorBlock();
    assert.ok(!/:\s*(string|number|boolean|any|unknown|void|Record<|Array<|\{\s*\w+:\s*\w+)\b/.test(block.replace(/\/\/[^\n]*/g, "").replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''")), "no TypeScript type annotations inside the mirror block");
    assert.ok(!/\bas\s+(any|string|number|const)\b/.test(block), "no 'as' casts inside the mirror block");
    const m = loadMirror();
    assert.strictEqual(typeof m.openSlots, "function");
    assert.strictEqual(typeof m.openShiftsEmail, "function");
    assert.ok(block.indexOf("helpers.js") > 0 || block.indexOf("open-slots.json") > 0, "the block names its source of truth (helpers.js / the fixture)");
  });
  check("mirror openSlots on the fixture == fixture.expected and == helpers.openSlots (no opts): same { day, role } list in the same order", () => {
    const m = loadMirror();
    assert.deepStrictEqual(dayRole(m.openSlots(FX.schedule, FX.from, FX.to, FX.today)), FX.expected);
    assert.deepStrictEqual(dayRole(m.openSlots(FX.schedule, FX.from, FX.to, FX.today)), dayRole(H.openSlots(FX.schedule, FX.from, FX.to, FX.today)));
  });
  check("mirror openSlots with opts == fixture.expectedWithUnits (holiday over weekend, weekend pattern + friday, whitespace reason -> null) and == helpers on unitPrecedence", () => {
    const m = loadMirror();
    assert.deepStrictEqual(m.openSlots(FX.schedule, FX.from, FX.to, FX.today, FX.opts), FX.expectedWithUnits);
    const up = FX.unitPrecedence;
    assert.deepStrictEqual(m.openSlots(up.schedule, up.from, up.to, up.today, up.opts), up.expected);
    assert.deepStrictEqual(m.openSlots(up.schedule, up.from, up.to, up.today, up.opts), H.openSlots(up.schedule, up.from, up.to, up.today, up.opts));
  });
  check("mirror openSlots: invalid ranges / junk input -> [] like helpers; today clips the range; a day before today is never open; a locked-but-empty day is open; external cover holds primary only", () => {
    const m = loadMirror();
    FX.invalidRanges.forEach(r => assert.deepStrictEqual(m.openSlots(FX.schedule, r.from, r.to, FX.today), [], r.why));
    assert.deepStrictEqual(m.openSlots(null, FX.from, FX.to, FX.today).length, H.openSlots(null, FX.from, FX.to, FX.today).length);
    assert.deepStrictEqual(m.openSlots(FX.schedule, "2026-11-01", "2026-11-03", "2026-11-04"), []);
    assert.deepStrictEqual(dayRole(m.openSlots(FX.schedule, "2026-11-17", "2026-11-17", "2026-11-04")), [{ day: "2026-11-17", role: "primary" }, { day: "2026-11-17", role: "backup" }]);
    assert.deepStrictEqual(dayRole(m.openSlots(FX.schedule, "2026-11-06", "2026-11-06", "2026-11-04")), [{ day: "2026-11-06", role: "backup" }]);
    assert.deepStrictEqual(m.openSlots({}, "2026-11-10", "2026-11-10", "2026-11-10"), [{ day: "2026-11-10", role: "primary", unit: null, reason: null }, { day: "2026-11-10", role: "backup", unit: null, reason: null }]);
    // an empty-string holder or a blank externalCover is no holder; a held externalCover is one (mirrors the helpers check)
    const s = { "2026-11-10": { primary: "", backup: "", externalCover: "  " }, "2026-11-11": { primary: null, backup: "s2", externalCover: "Atwell" } };
    assert.deepStrictEqual(dayRole(m.openSlots(s, "2026-11-10", "2026-11-11", "2026-11-10")), dayRole(H.openSlots(s, "2026-11-10", "2026-11-11", "2026-11-10")));
  });
  check("mirror openSlots == helpers.openSlots on 200 seeded random schedules over Oct 2026 - Jan 2027 (random holders, covers, locks, missing rows, today inside / outside the range, holiday + weekend opts, reasons)", () => {
    const m = loadMirror();
    const rnd = prng(20260922);
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const ids = ["s1", "s2", "s3", "s4", "s5", "s6", null, null, ""];
    const holidayByDay = {};
    ["2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"].forEach(d => { holidayByDay[d] = { name: "Thanksgiving", days: ["2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"] }; });
    ["2026-12-24", "2026-12-25"].forEach(d => { holidayByDay[d] = { name: "Christmas", days: ["2026-12-24", "2026-12-25"] }; });
    const kinds = ["block", "split", "daily", "locked", null];
    for (let t = 0; t < 200; t++) {
      const schedule = {};
      const weekendKinds = {}, reasons = {};
      for (let k = 0; k < 120; k++) {
        const d = H.suAddDays("2026-10-01", k);
        if (rnd() < 0.15) continue; // missing row
        schedule[d] = { primary: pick(ids), backup: pick(ids), primaryLocked: rnd() < 0.2, backupLocked: rnd() < 0.2, source: "generate", externalCover: rnd() < 0.1 ? pick(["Atwell", "", "  ", "Locum"]) : null, note: null };
        if (H.parse(d).getDay() === 5 && rnd() < 0.7) weekendKinds[d] = pick(kinds);
        if (rnd() < 0.2) reasons[H.openSlotKey(d, pick(["primary", "backup"]))] = pick(["no eligible surgeon - vacations", "   ", "generator could not place - report it", ""]);
      }
      const from = H.suAddDays("2026-10-01", Math.floor(rnd() * 60));
      const to = H.suAddDays(from, Math.floor(rnd() * 70));
      const today = H.suAddDays("2026-09-25", Math.floor(rnd() * 130));
      const opts = rnd() < 0.5 ? { holidayByDay, weekendKinds, reasons } : undefined;
      const a = H.openSlots(schedule, from, to, today, opts), b = m.openSlots(schedule, from, to, today, opts);
      assert.deepStrictEqual(b, a, `seeded schedule #${t} (${from}..${to}, today ${today}, opts ${opts ? "on" : "off"})`);
    }
  });
  check("mirror openShiftsEmail == helpers.openShiftsEmail on the fixture (subject, message, detail, through, count, slots) and on the one-slot / empty / shuffled cases", () => {
    const m = loadMirror();
    const slots = slotsWithUnits();
    const a = H.openShiftsEmail(slots, { appUrl: EM.appUrl, through: EM.through });
    const b = m.openShiftsEmail(slots, { appUrl: EM.appUrl, through: EM.through });
    assert.deepStrictEqual(b, a);
    assert.strictEqual(b.message, EM.expected.message);
    assert.deepStrictEqual(m.openShiftsEmail(EM.oneSlot.slots, { appUrl: EM.appUrl }), H.openShiftsEmail(EM.oneSlot.slots, { appUrl: EM.appUrl }));
    assert.deepStrictEqual(m.openShiftsEmail([], EM.appUrl), H.openShiftsEmail([], EM.appUrl));
    assert.deepStrictEqual(m.openShiftsEmail(slots.slice().reverse(), EM.appUrl), H.openShiftsEmail(slots.slice().reverse(), EM.appUrl));
    assert.deepStrictEqual(m.openShiftsEmail(null, EM.appUrl), H.openShiftsEmail(null, EM.appUrl));
  });

  /* -- daily-reminder mode 'open-shifts' (source pins: the contract the orchestrator proves live with a dryRun) -- */
  check("daily-reminder/index.ts: body.mode 'open-shifts' | undefined/'reminder', any other value -> 400; the mode branches AFTER the x-cron-secret gate and the dryRun boolean check; the default path still starts with 'const now = centralNow();' + 'const tomorrow = addDays(now.ymd, 1);'", () => {
    const gate = drSrc.indexOf('req.headers.get("x-cron-secret") !== CRON_SECRET');
    const dry = drSrc.indexOf('typeof body.dryRun !== "boolean"');
    const mode = drSrc.indexOf('"open-shifts"', dry);
    assert.ok(gate > 0 && dry > gate && mode > dry, "gate -> dryRun check -> mode dispatch, in that order");
    assert.ok(/mode must be/.test(drSrc) && /json\(400, \{ error: [^}]*mode/.test(drSrc), "an unknown mode answers 400 with an error naming mode");
    assert.ok(/const now = centralNow\(\);\n\s+const tomorrow = addDays\(now\.ymd, 1\);/.test(drSrc), "the reminder path is intact");
  });
  check("daily-reminder/index.ts mode open-shifts: reads schedule_days for [today, today+30] with the six columns, resolves user_profiles (person_id not null) x notification_preferences.schedule_updates_email, inserts the notifications row { type: 'open_shifts', data: { slots, through, source: 'cron' } } only when not dryRun, answers person ids only", () => {
    assert.ok(/schedule_days\?select=day,primary_id,backup_id,external_cover,primary_locked,backup_locked&day=gte\.\$\{[^}]+\}&day=lte\.\$\{[^}]+\}/.test(drSrc), "schedule_days window read with the six columns");
    assert.ok(/addDays\([^,]+,\s*30\)/.test(drSrc), "the window is today + 30");
    assert.ok(/user_profiles\?select=person_id,email&person_id=not\.is\.null/.test(drSrc), "recipients come from user_profiles via the service role");
    assert.ok(/schedule_updates_email === false/.test(drSrc), "an explicit false opts out; a missing row is on");
    assert.ok(/type: "open_shifts"/.test(drSrc) && /source: "cron"/.test(drSrc), "the feed row is typed open_shifts with source cron");
    const ins = drSrc.indexOf('rest("notifications"');
    assert.ok(ins > 0, "the feed row is inserted through rest('notifications', ...)");
    assert.ok(/if \(!dryRun\)[\s\S]{0,200}rest\("notifications"/.test(drSrc) || /dryRun \? [^:]+: [\s\S]{0,120}rest\("notifications"/.test(drSrc), "the insert sits behind a dryRun check");
    assert.ok(/status: "dry_run_composed"/.test(drSrc), "dryRun composes and reports dry_run_composed per recipient");
    assert.ok(/skipped_pref_off/.test(drSrc) && /skipped_no_email/.test(drSrc) && /open:/.test(drSrc) && /through/.test(drSrc), "the response carries open / through / sent / failed / skipped_pref_off / skipped_no_email");
    assert.ok(!/\bemail:\s*[a-z]+\.email\b/.test(drSrc.slice(drSrc.indexOf("results.push"))), "no address is echoed in results");
  });

  /* -- send-notification categories -- */
  check("send-notification/index.ts: CATEGORIES.open_shifts { pref: schedule_updates_email, title: 'Open Shifts', color '#C2410C', cta 'Open shifts' } and CATEGORIES.shift_claimed { pref: schedule_updates_email, title: 'Shift Taken', color '#1a8040', cta 'View Schedule' }", () => {
    assert.ok(/open_shifts:\s*\{\s*pref:\s*"schedule_updates_email",\s*title:\s*"Open Shifts",\s*color:\s*"#C2410C",\s*cta:\s*"Open shifts"\s*\}/.test(snSrc), "open_shifts category");
    assert.ok(/shift_claimed:\s*\{\s*pref:\s*"schedule_updates_email",\s*title:\s*"Shift Taken",\s*color:\s*"#1a8040",\s*cta:\s*"View Schedule"\s*\}/.test(snSrc), "shift_claimed category");
    assert.strictEqual((snSrc.match(/^const CATEGORIES/gm) || []).length, 1);
  });

  /* -- README: the third pg_cron job exactly as Faraz gave it, the dryRun example, the table row, the live-mail list -- */
  check("edge-functions/README.md: section 4 carries cron.schedule('silvis-open-shifts-weekly', '0 12 * * 1', ...) posting {\"mode\":\"open-shifts\"} with the Vault secret 'silvis_cron_secret', plus the dryRun example and the live-mail paths", () => {
    assert.ok(readme.indexOf("cron.schedule('silvis-open-shifts-weekly', '0 12 * * 1', $$") > 0, "the job name + schedule line");
    assert.ok(/vault\.decrypted_secrets where name = 'silvis_cron_secret' limit 1\), 'unset'\)\)/.test(readme), "the Vault lookup exactly as given");
    assert.ok(readme.indexOf(`body := '{"mode":"open-shifts"}'::jsonb`) > 0, "the body");
    assert.ok(/12:00 UTC = Monday 07:00 CDT \/ 06:00 CST/.test(readme), "the UTC note");
    assert.ok(/other two (live )?jobs (also )?read the secret from Vault/.test(readme), "the note that the other two jobs read Vault");
    assert.ok(readme.indexOf(`'{"mode":"open-shifts","dryRun":true}'`) > 0, "the dryRun example");
    assert.ok(/\{"mode":"open-shifts","dry_run":true,"open":N/.test(readme), "the dryRun response shape");
    assert.ok(/open_shifts/.test(readme) && /shift_claimed/.test(readme), "section 6 lists the new live-mail paths");
    assert.ok(/\| `daily-reminder` \|[^\n]*open-shifts/.test(readme), "the table row names the new mode");
  });

  /* -- index-source.html: publish hook, board dialog with a Preview, claim subject, deep link -- */
  check("index-source.html: Accept & Publish hooks the open-shifts notice AFTER the office publish (triggerPublishNotify: office POST ok -> schedule_published feed + mail -> announceOpenShiftsAfterPublish -> 'Published.' toast)", () => {
    const fn = appSrc.slice(appSrc.indexOf("const triggerPublishNotify = async"), appSrc.indexOf("const triggerDigestTest = async"));
    const pub = fn.indexOf('sendEmailNotif("schedule_published"');
    const hook = fn.indexOf("await announceOpenShiftsAfterPublish(true)");
    const toast = fn.indexOf("showToast(`Published.");
    assert.ok(pub > 0 && hook > pub && toast > hook, "the hook sits between the schedule_published mail and the Published toast");
    assert.ok(fn.indexOf("if (!res.ok)") > 0 && fn.indexOf("if (!res.ok)") < hook, "on Send the hook runs only after the office POST succeeded (Skip / the backdrop announce through closePublishDialog when Accept armed it)");
    const def = appSrc.slice(appSrc.indexOf("const announceOpenShiftsAfterPublish = async"), appSrc.indexOf("const notifyOpenShifts = async"));
    assert.ok(def.length > 0, "announceOpenShiftsAfterPublish is defined before notifyOpenShifts");
    assert.ok(/openSlots\((scheduleRef\.current \|\| schedule|sched), todayStr, through, todayStr,/.test(def), "the hook computes openSlots(schedule, todayStr, lastPublishedDay, todayStr, ...) from the schedule just published");
    assert.ok(/suLastContiguousDay\(/.test(def), "through = the last contiguous published day");
    assert.ok(/sendOpenShiftsNotice\("publish"/.test(def), "the publish hook posts through the shared sender with origin publish");
  });
  check("index-source.html: the notice is composed through helpers.openShiftsEmail (no second composer), the feed row carries data.slots [{day, role}] + through, the e-mail carries subject / message / detail with targetIds omitted", () => {
    assert.ok(/openShiftsEmail\(/.test(appSrc), "index-source.html calls openShiftsEmail");
    const comp = appSrc.slice(appSrc.indexOf("const composeOpenShiftsNotice ="), appSrc.indexOf("const announceOpenShiftsAfterPublish = async"));
    assert.ok(/openShiftsEmail\(list, \{ appUrl: /.test(comp), "composeOpenShiftsNotice delegates to openShiftsEmail");
    assert.ok(/window\.location\.origin \+ window\.location\.pathname/.test(comp), "the app URL is location.origin + location.pathname");
    assert.ok(!/Week of Mon/.test(comp), "no week grouping text in the client (it lives in helpers.js)");
    const send = appSrc.slice(appSrc.indexOf("const sendOpenShiftsNotice = async"), appSrc.indexOf("const notifyOpenShifts = async"));
    assert.ok(/addNotification\("open_shifts", n\.subject, n\.message, \{ slots: n\.slots, through: /.test(send), "feed row: type open_shifts, title = subject, data.slots + through");
    assert.ok(/sendEmailNotif\("open_shifts", \{ subject: n\.subject, message: n\.message, detail: n\.detail[^}]*\}\)/.test(send), "broadcast: sendEmailNotif('open_shifts', { subject, message, detail }) with NO targetIds argument");
    assert.ok(/logAudit\("openshifts\.notify"/.test(send), "audit openshifts.notify");
  });
  check("index-source.html: Email the group now opens a confirm dialog with a Preview (subject, message, detail) and a Send button instead of window.confirm; the claim e-mail subject is '<Name> took <Ddd M/D> <role>' to the schedulers + claimer; '#openshifts' deep-links to the board once signed in", () => {
    assert.ok(appSrc.indexOf('data-testid="ob-email-dialog"') > 0 && appSrc.indexOf('data-testid="ob-email-preview"') > 0 && appSrc.indexOf('data-testid="ob-email-send"') > 0 && appSrc.indexOf('data-testid="ob-email-cancel"') > 0, "dialog, preview, send and cancel test ids");
    const notify = appSrc.slice(appSrc.indexOf("const notifyOpenShifts = async"), appSrc.indexOf("// --- Calendar tools"));
    assert.ok(!/confirm\(/.test(notify), "no window.confirm in notifyOpenShifts");
    assert.ok(/setObNotice\(/.test(notify), "the board path opens the preview dialog");
    const claim = appSrc.slice(appSrc.indexOf("const runClaim = async"), appSrc.indexOf("const composeOpenShiftsNotice ="));
    assert.ok(/sendEmailNotif\("shift_claimed", \{ subject: `\$\{nameOf\(mySurgeon\)\} took \$\{DAY_HDR\[parse\(s\.day\)\.getDay\(\)\]\} \$\{fmtMD\(s\.day\)\} \$\{s\.role\}`/.test(claim), "the claim subject");
    assert.ok(/\[\.\.\.new Set\(\[\.\.\.ids, mySurgeon\]\)\]/.test(claim) && /schedulerIdsLoud\(\)/.test(claim), "targets = uniq(schedulerIds + claimer), schedulers looked up, never hardcoded");
    assert.ok(!/\["s1"\]/.test(claim), "no hardcoded s1");
    const hashAt = appSrc.indexOf('window.location.hash === "#openshifts"');
    assert.ok(hashAt > 0 && /setView\("openshifts"\)/.test(appSrc.slice(hashAt, hashAt + 400)), "the deep link routes to the board");
  });

  /* -- fix round (review of part 5) -- */
  check("openShiftsEmail (fix round): an explicit through that PRECEDES the last slot's day is extended to that day - the subject never says 'through 11/1' over a message that lists 11/26 (board: open slots of an assigned range beyond the block)", () => {
    const out = H.openShiftsEmail(slotsWithUnits(), { appUrl: EM.appUrl, through: "2026-11-01" });
    assert.strictEqual(out.through, "2026-11-29", "through = the last slot's day when the explicit one lies before it");
    assert.strictEqual(out.subject, EM.expected.subject);
    assert.strictEqual(out.message, EM.expected.message);
    // beyond the last slot it still wins (a fully published block whose tail is covered)
    assert.strictEqual(H.openShiftsEmail(EM.oneSlot.slots, { appUrl: EM.appUrl, through: "2026-12-31" }).through, "2026-12-31");
    const m = loadMirror();
    assert.deepStrictEqual(m.openShiftsEmail(slotsWithUnits(), { appUrl: EM.appUrl, through: "2026-11-01" }), out, "the mirror composer extends through the same way");
  });
  // The cron's window: the runs of schedule_days rows in [today, today+30].
  // Rows exist only on published days, so a day WITHOUT a row is not published
  // and never open (claim_open_slot refuses it; Generate covers it). The
  // reviewer's live-shaped case: the import ends 11/1, the Thanksgiving unit
  // is on file 11/26-11/29, today is 11/2 -> nothing between may be announced.
  const gapSchedule = () => ({
    "2026-11-02": { primary: "s1", backup: null, externalCover: null },
    "2026-11-03": { primary: null, backup: "s2", externalCover: null },
    "2026-11-04": { primary: "s3", backup: "s4", externalCover: null },
    "2026-11-05": { primary: null, backup: null, externalCover: null },
    "2026-11-26": { primary: "s1", backup: "s2", externalCover: null },
    "2026-11-27": { primary: "s1", backup: null, externalCover: null },
    "2026-11-28": { primary: "s1", backup: "s2", externalCover: null },
    "2026-11-29": { primary: "s1", backup: null, externalCover: null },
    "2026-12-01": { primary: null, backup: null, externalCover: null }, // a stray row nobody holds - not an assigned range
  });
  const runsOf = (days) => { const out = []; days.forEach(d => { const l = out.length ? out[out.length - 1] : null; if (l && H.suAddDays(l.end, 1) === d) l.end = d; else out.push({ start: d, end: d }); }); return out; };
  check("mirror openShiftsWindowMirror(schedule, today, opts) -> { slots, through, ranges }: a gap between today's block and a later assigned run is NEVER announced (the reviewer's blocking case: rows 11/2-11/5 + Thanksgiving 11/26-11/29, today 11/2 -> 4 block slots + 2 holiday backups, through 11/5, no 11/6..11/25, no stray 12/1)", () => {
    const m = loadMirror();
    assert.ok(typeof m.window === "function", "the mirror block defines openShiftsWindowMirror (the cron's window = the board's obBoardSlots over the rows read)");
    const r = m.window(gapSchedule(), "2026-11-02", {});
    assert.strictEqual(r.through, "2026-11-05", "through = the end of the run that starts today");
    assert.deepStrictEqual(dayRole(r.slots), [
      { day: "2026-11-02", role: "backup" }, { day: "2026-11-03", role: "primary" },
      { day: "2026-11-05", role: "primary" }, { day: "2026-11-05", role: "backup" },
      { day: "2026-11-27", role: "backup" }, { day: "2026-11-29", role: "backup" },
    ]);
    assert.ok(!r.slots.some(s => s.day > "2026-11-05" && s.day < "2026-11-26"), "no day without a row is open");
    assert.ok(!r.slots.some(s => s.day === "2026-12-01"), "a stray unheld row beyond the block is not an assigned range");
    assert.deepStrictEqual(r.ranges, [{ start: "2026-11-26", end: "2026-11-29" }]);
    // == the board on the same rows (helpers.obBoardSlots with lastPublishedDay = the block end)
    const board = H.obBoardSlots(gapSchedule(), "2026-11-02", "2026-11-05", {});
    assert.deepStrictEqual(dayRole(r.slots), dayRole(board.slots));
    assert.deepStrictEqual(r.ranges, board.ranges);
    // the old end-only clip would have listed 2 phantom slots per gap day
    const oldClip = m.openSlots(gapSchedule(), "2026-11-02", "2026-11-29", "2026-11-02", {});
    assert.ok(oldClip.length > r.slots.length + 30, "control: clipping only the end announces the gap (" + oldClip.length + " slots)");
  });
  check("mirror openShiftsWindowMirror: today WITHOUT a row -> through null and only the later ASSIGNED runs are announced (a week before the Thanksgiving unit, nothing else published: its open backups, never the 20 days before); no rows at all -> nothing; junk today throws", () => {
    const m = loadMirror();
    const sched = {};
    ["2026-11-26", "2026-11-28"].forEach(d => { sched[d] = { primary: "s1", backup: "s2", externalCover: null }; });
    ["2026-11-27", "2026-11-29"].forEach(d => { sched[d] = { primary: "s1", backup: null, externalCover: null }; });
    const r = m.window(sched, "2026-11-19", {});
    assert.strictEqual(r.through, null);
    assert.deepStrictEqual(dayRole(r.slots), [{ day: "2026-11-27", role: "backup" }, { day: "2026-11-29", role: "backup" }]);
    assert.deepStrictEqual(m.window({}, "2026-11-19", {}), { slots: [], through: null, ranges: [] });
    // days before today are not open even when the block started earlier (the cron reads rows from today only, but be safe)
    const r2 = m.window(gapSchedule(), "2026-11-04", {});
    assert.strictEqual(r2.through, "2026-11-05");
    assert.deepStrictEqual(dayRole(r2.slots), [{ day: "2026-11-05", role: "primary" }, { day: "2026-11-05", role: "backup" }, { day: "2026-11-27", role: "backup" }, { day: "2026-11-29", role: "backup" }]);
    assert.throws(() => m.window(gapSchedule(), "junk", {}), /today/);
  });
  check("mirror openShiftsWindowMirror == helpers.obBoardSlots on 200 seeded random 31-day windows with gaps (random holders, covers, missing rows, stray unheld rows, holiday + weekend opts) whenever today has a row; when it has none the list is the later assigned runs' open slots only", () => {
    const rnd = prng(20260922);
    const ids = ["s1", "s2", "s3", "s4", "s5", "s6"];
    const m = loadMirror();
    let withBlock = 0, without = 0;
    for (let i = 0; i < 200; i++) {
      const today = H.suAddDays("2026-10-01", Math.floor(rnd() * 90));
      const sched = {};
      for (let k = 0; k <= 30; k++) {
        const d = H.suAddDays(today, k);
        const x = rnd();
        if (x < 0.3) continue; // no row (a gap)
        const held = (p) => rnd() < p;
        sched[d] = { primary: held(0.6) ? ids[Math.floor(rnd() * 6)] : null, backup: held(0.6) ? ids[Math.floor(rnd() * 6)] : null, externalCover: rnd() < 0.1 ? "Locum" : null, primaryLocked: rnd() < 0.2, backupLocked: rnd() < 0.2 };
      }
      const opts = { holidayByDay: FX.opts.holidayByDay, weekendKinds: FX.opts.weekendKinds, reasons: FX.opts.reasons };
      const r = m.window(sched, today, opts);
      const days = Object.keys(sched).sort();
      const runs = runsOf(days);
      const blockEnd = runs.length && runs[0].start === today ? runs[0].end : null;
      assert.strictEqual(r.through, blockEnd, "through on seed " + i);
      r.slots.forEach(s => assert.ok(sched[s.day], "seed " + i + ": " + s.day + " has no row but was announced"));
      if (blockEnd) {
        withBlock++;
        const board = H.obBoardSlots(sched, today, blockEnd, opts);
        assert.deepStrictEqual(r.slots, board.slots, "slots on seed " + i);
        assert.deepStrictEqual(r.ranges, board.ranges, "ranges on seed " + i);
      } else {
        without++;
        const held = days.filter(d => sched[d].primary || sched[d].backup || sched[d].externalCover);
        const exp = [];
        runsOf(held).forEach(run => H.openSlots(sched, run.start, run.end, today, opts).forEach(s => exp.push(s)));
        assert.deepStrictEqual(r.slots, exp, "later-runs slots on seed " + i);
      }
    }
    assert.ok(withBlock > 50 && without > 20, `both shapes exercised (${withBlock} with a block, ${without} without)`);
  });
  check("daily-reminder/index.ts (fix round): runOpenShifts announces openShiftsWindowMirror(schedule, from, ...) - never openSlotsMirror(schedule, from, through, from, ...) over an end-only clip; mode null is NOT the reminder mode (400 like any other non-contract value); the HTML keeps the two-space slot indentation (&nbsp;)", () => {
    const outside = drSrc.slice(drSrc.indexOf(END));
    assert.ok(/openShiftsWindowMirror\(schedule, from, /.test(outside), "runOpenShifts calls openShiftsWindowMirror(schedule, from, opts)");
    assert.ok(!/openSlotsMirror\(schedule, from, through, from/.test(outside), "the end-only clip is gone");
    assert.ok(!/body\.mode !== null/.test(drSrc) && /body\.mode !== undefined \? body\.mode : "reminder"/.test(drSrc), "mode: undefined -> reminder; null falls through to the 400");
    const html = drSrc.slice(drSrc.indexOf("function buildOpenShiftsEmail"), drSrc.indexOf("async function runOpenShifts"));
    assert.ok(/replace\(\/\^ \{2\}\/gm, "&nbsp;&nbsp;"\)/.test(html), "leading two spaces become &nbsp;&nbsp; after escaping");
    assert.ok(html.indexOf("&nbsp;&nbsp;") < html.indexOf('"<br>"'), "the indent is preserved before the newline -> <br> step");
  });
  check("index-source.html (fix round): the group notice is a property of Accept & Publish, not of the office e-mail - acceptMerged arms pendingOpenShiftsNoticeRef after the days are on file; Send announces after the office POST (outcome folded into the Published toast); Skip / backdrop close announce once when armed; a failed office POST keeps the dialog open so the notice still goes out on close", () => {
    const acc = appSrc.slice(appSrc.indexOf("const acceptMerged = async"), appSrc.indexOf("// --- Seed import"));
    assert.ok(/pendingOpenShiftsNoticeRef\.current = true;[\s\S]{0,200}publishRef\.current\(\);/.test(acc), "acceptMerged arms the ref right before opening the publish dialog (inside the r.ok branch)");
    assert.ok(acc.indexOf("pendingOpenShiftsNoticeRef.current = true") > acc.indexOf("if (r && r.ok)"), "armed only when the CAS sync succeeded");
    const close = appSrc.slice(appSrc.indexOf("const closePublishDialog = "), appSrc.indexOf("const triggerPublishNotify = async"));
    assert.ok(close.length > 0 && /setShowPublishDialog\(false\)/.test(close) && /pendingOpenShiftsNoticeRef\.current = false/.test(close) && /announceOpenShiftsAfterPublish\(false\)/.test(close), "closePublishDialog consumes the armed ref and announces (with its own toast)");
    assert.ok(/data-testid="publish-skip" onClick=\{closePublishDialog\}/.test(appSrc), "Skip the notice closes through closePublishDialog");
    assert.ok(/data-testid="publish-dialog" onClick=\{closePublishDialog\}/.test(appSrc), "the backdrop closes through closePublishDialog");
    const fn = appSrc.slice(appSrc.indexOf("const triggerPublishNotify = async"), appSrc.indexOf("const triggerDigestTest = async"));
    assert.ok(/const os = await announceOpenShiftsAfterPublish\(true\);/.test(fn), "Send announces quietly and reads the outcome");
    assert.ok(/pendingOpenShiftsNoticeRef\.current = false;/.test(fn), "Send consumes the ref so Skip cannot announce twice");
    assert.ok(/showToast\(`Published\. Sent \$\{body\.sent \?\? 0\} office email\(s\)\.\$\{os \? " " \+ os\.text : ""\}`, os && os\.tone === "error" \? "error" : "success"\)/.test(fn), "the Published toast carries the open-shifts outcome and its tone");
    assert.ok(fn.indexOf("if (!res.ok)") > 0 && fn.indexOf("if (!res.ok)") < fn.indexOf("const os = await announceOpenShiftsAfterPublish(true);"), "on Send the notice follows the office POST");
    const def = appSrc.slice(appSrc.indexOf("const announceOpenShiftsAfterPublish = async"), appSrc.indexOf("const sendOpenShiftsNotice = async"));
    assert.ok(/= async \(quiet\)/.test(def) && /return null;/.test(def) && /return \{ text:/.test(def), "announceOpenShiftsAfterPublish(quiet) returns null when nothing is open, else the outcome { text, tone }");
    const send = appSrc.slice(appSrc.indexOf("const sendOpenShiftsNotice = async"), appSrc.indexOf("const notifyOpenShifts = async"));
    assert.ok(/= async \(origin, n, quiet\)/.test(send) && /if \(!quiet\) showToast\(text, tone\);/.test(send) && /return \{ count: count, through: thru, mail: mail, text: text, tone: tone \};/.test(send), "sendOpenShiftsNotice(origin, n, quiet) toasts only when not quiet and returns the outcome");
    assert.ok(/open-shifts note[^<]*goes out either way/.test(appSrc), "the dialog copy says the group note goes out whether the office notice is sent or skipped");
  });
  check("index-source.html (fix round): the Email-the-group preview dialog focuses Cancel when it opens, keeps Tab inside (claimSheetKeyDown) and returns focus to the 'Email the group now' button on close", () => {
    assert.ok(/const obCancelRef = useRef\(null\)/.test(appSrc) && /const obEmailBtnRef = useRef\(null\)/.test(appSrc), "refs for the dialog's Cancel and the opener");
    assert.ok(/data-testid="ob-email-cancel" onClick=\{closeObNotice\}/.test(appSrc) && /ref=\{obCancelRef\} data-testid="ob-email-cancel"/.test(appSrc), "Cancel carries the ref and closes through closeObNotice");
    assert.ok(/data-testid="ob-email" ref=\{obEmailBtnRef\}/.test(appSrc), "the opener carries its ref");
    const dlg = appSrc.slice(appSrc.indexOf('data-testid="ob-email-dialog"'), appSrc.indexOf('data-testid="ob-email-preview"'));
    assert.ok(/onKeyDown=\{claimSheetKeyDown\}/.test(dlg), "Tab cycles inside the dialog");
    assert.ok(/closeObNotice\(\)/.test(dlg), "the backdrop closes through closeObNotice");
    const close = appSrc.slice(appSrc.indexOf("const closeObNotice = "), appSrc.indexOf("const sendBoardNotice = async"));
    assert.ok(/setObNotice\(null\)/.test(close) && /obEmailBtnRef\.current/.test(close) && /\.focus\(\)/.test(close), "closeObNotice returns focus to the opener");
    assert.ok(/if \(!obNotice\) return undefined;[\s\S]{0,300}obCancelRef\.current\.focus\(\)/.test(appSrc), "an effect focuses Cancel when the dialog opens");
  });
  check("edge-functions/README.md (fix round): the Vault note says the TWO live jobs read the secret from Vault and the open-shifts job does once created - never 'three live jobs' before it exists", () => {
    assert.ok(!/three live Silvis jobs/.test(readme), "no 'three live Silvis jobs'");
    assert.ok(/two live jobs[^\n]*Vault/.test(readme) && /once (it is )?created/.test(readme), "the two live jobs + 'once created' wording");
  });
}

/* ------------------------------------------------------------------ */
/* Part 6 - docs pins. The guide's section 16 sub-headings, the README */
/* cron job, the ONBOARDING paragraph, the two audit-action lists and  */
/* the prompt text on file. Docs are part of the contract here: the    */
/* orchestrator applies the schema, deploys and creates the cron job   */
/* BY HAND from these pages, so a missing line is a missing live step. */
/* ------------------------------------------------------------------ */
{
  const readDoc = (...p) => { const f = path.join(ROOT, ...p); return fs.existsSync(f) ? fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n") : null; };
  const guide = readDoc("docs", "SILVIS-BUILD-GUIDE.md") || "";
  const readme = readDoc("edge-functions", "README.md") || "";
  const onboarding = readDoc("docs", "ONBOARDING.md") || "";
  const status = readDoc("docs", "STATUS-2026-09-22.md") || "";
  const schemaReview = readDoc("docs", "SCHEMA-REVIEW.md") || "";
  const prompt13 = readDoc("docs", "PROMPT-13-OPEN-SHIFTS.md");
  const HEADS = ["### 16.1 The single definition", "### 16.2 The claim boundary", "### 16.3 The three notification paths", "### 16.4 The cron job", "### 16.5 What is NOT automatic"];
  const sub = (n) => { const i = guide.indexOf("\n" + HEADS[n - 1]); const j = n < HEADS.length ? guide.indexOf("\n" + HEADS[n]) : -1; assert.ok(i > 0, "sub-heading " + HEADS[n - 1]); return guide.slice(i, j > 0 ? j : undefined); };

  check("docs/SILVIS-BUILD-GUIDE.md: section 16 carries the five sub-headings 16.1 The single definition .. 16.5 What is NOT automatic, in order, all after the '## 16.' heading (the last H2)", () => {
    const s16 = guide.indexOf("\n## 16. Open shifts");
    assert.ok(s16 > 0, "the '## 16. Open shifts' heading");
    assert.strictEqual(guide.indexOf("\n## ", s16 + 1), -1, "section 16 is the last H2");
    let last = s16;
    HEADS.forEach(h => { const i = guide.indexOf("\n" + h); assert.ok(i > last, "missing or out of order: " + h); last = i; });
    assert.strictEqual((guide.match(/\n### 16\.\d/g) || []).length, HEADS.length, "exactly five 16.x sub-headings");
  });
  check("guide 16.1 names openSlots as the one definition; 16.2 states the boundary (eligibility() in the client before the button, NOT in SQL; claim_open_slot guards integrity and logs schedule.claim); 16.3 names the three paths with category open_shifts, pref schedule_updates_email, audit openshifts.notify, mode open-shifts + job silvis-open-shifts-weekly, and shift_claimed on a claim", () => {
    assert.ok(/openSlots\(schedule, from, to, today/.test(sub(1)) && /helpers\.js/.test(sub(1)), "16.1");
    const s2 = sub(2);
    assert.ok(/eligibility\(\)/.test(s2) && /NOT in\s+SQL/.test(s2) && /claim_open_slot/.test(s2) && /schedule\.claim/.test(s2) && /CL001/.test(s2), "16.2");
    const s3 = sub(3);
    assert.ok(/Accept & Publish/.test(s3) && /Email the group now/.test(s3) && /Monday/.test(s3), "16.3 names publish / on demand / Monday");
    assert.ok(/`open_shifts`/.test(s3) && /`schedule_updates_email`/.test(s3) && /`openshifts\.notify`/.test(s3) && /`open-shifts`/.test(s3) && /`silvis-open-shifts-weekly`/.test(s3) && /`shift_claimed`/.test(s3), "16.3 names");
    // fix round: '0 12 * * 1' has no DST adjustment - 16.3 must state the UTC hour with both Central halves next to Faraz's 'Monday 07:00 Central'
    assert.ok(/Monday 07:00 Central\*\* \(12:00 UTC: 07:00 CDT \/\s+06:00 CST/.test(s3), "16.3 states 12:00 UTC = 07:00 CDT / 06:00 CST beside 'Monday 07:00 Central'");
  });
  check("guide 16.4 carries the cron job SQL verbatim (job name, '0 12 * * 1', the Vault lookup, the open-shifts body) and 16.5 says schema apply, deploys and the cron job are done by hand - a git push does none of them", () => {
    const s4 = sub(4);
    assert.ok(s4.indexOf("cron.schedule('silvis-open-shifts-weekly', '0 12 * * 1', $") > 0, "16.4 job line");
    assert.ok(/vault\.decrypted_secrets where name = 'silvis_cron_secret' limit 1\), 'unset'\)\)/.test(s4), "16.4 Vault lookup");
    assert.ok(s4.indexOf("body := '{\"mode\":\"open-shifts\"}'::jsonb") > 0, "16.4 body");
    const s5 = sub(5);
    assert.ok(/by hand/.test(s5) && /git push/.test(s5) && /deploy/.test(s5) && /cron\.schedule|cron job/.test(s5) && /migration|schema/.test(s5), "16.5");
  });
  check("edge-functions/README.md names the cron job silvis-open-shifts-weekly (true since part 5 - this pin cannot fail before part 6; it keeps the guide and the README in step)", () => {
    assert.ok(/silvis-open-shifts-weekly/.test(readme), "README job name");
    assert.ok(/silvis-open-shifts-weekly/.test(guide), "guide job name");
  });
  check("edge-functions/README.md states the deployed state truthfully: the four functions were first deployed on 9/22, the Prompt 13 versions of send-notification and daily-reminder were deployed on 2026-09-22 (version 3, byte-identical) with the open-shifts dryRun proof quoted, confirmed with 'supabase functions list' - never 'Nothing in this folder has been deployed yet'", () => {
    assert.ok(!/Nothing in this folder has been deployed yet/.test(readme), "the stale 'Nothing in this folder has been deployed yet' sentence is gone");
    assert.ok(/first deployed on 9\/22/.test(readme) && /deployed on\s+2026-09-22 18:31 UTC/.test(readme) && /version 3/.test(readme) && /byte-identical/.test(readme) && /"mode":"open-shifts","dryRun":true/.test(readme) && /supabase functions list/.test(readme), "the deployed-state paragraph names the first deploy, the 2026-09-22 version-3 deploy of the two functions, the byte-identical check, the dryRun proof and the confirming command");
  });
  check("docs/ONBOARDING.md tells surgeons about the Open shifts tab: 'Take this shift' is immediate and logged, the scheduler can still reassign, and the button is gated by the HARD rules (monthly and backup caps included) - it never claims caps do not block", () => {
    assert.ok(/\*\*Open shifts\*\*/.test(onboarding), "names the tab in bold");
    assert.ok(/Take this shift/.test(onboarding), "names the button");
    assert.ok(/immediate/.test(onboarding) && /logged/.test(onboarding), "'immediate' and 'logged'");
    assert.ok(/reassign/.test(onboarding), "the scheduler can still reassign");
    // fix round: rules.js pushes monthly-cap / backup-cap / backup-weekend-cap and the weekday patterns as HARD reasons - only soft preferences are warnings
    assert.ok(/hard schedule rules allow it/.test(onboarding) && /monthly and backup caps/.test(onboarding), "says the button is offered only when the hard rules allow it, naming the monthly and backup caps");
    assert.ok(!/caps[^.]*do not block/i.test(onboarding), "must not tell surgeons that caps do not block (the monthly cap is a hard eligibility rule)");
  });
  check("index-source.html: the dark-mode style block overrides the .table-wrap swipe-hint covers with the dark card colour - no #ffffff / white cover under dark mode", () => {
    const appSrc = fs.readFileSync(path.join(ROOT, "index-source.html"), "utf8").replace(/\r\n/g, "\n");
    const i = appSrc.indexOf("{darkMode && <style>{`"), j = appSrc.indexOf("`}</style>}", i);
    assert.ok(i > 0 && j > i, "the darkMode <style> block");
    const darkCss = appSrc.slice(i, j);
    const rule = (/\.table-wrap \{[^}]*\}/.exec(darkCss) || [])[0] || "";
    assert.ok(rule, "a .table-wrap rule inside the darkMode style block");
    assert.ok(/#16213e/.test(rule) && /background-image/.test(rule) && /!important/.test(rule), "the dark rule repaints the covers in the dark card colour #16213e: " + rule.slice(0, 160));
    assert.ok(!/#fff|255,\s*255,\s*255/.test(rule), "no white left in the dark .table-wrap rule");
  });
  check("the audit-action lists carry schedule.claim (written by the SQL function) and openshifts.notify (client): docs/STATUS-2026-09-22.md section 6 and docs/SCHEMA-REVIEW.md (a) audit_log", () => {
    const i6 = status.indexOf("\n## 6."), i7 = status.indexOf("\n## 7.");
    assert.ok(i6 > 0 && i7 > i6, "STATUS sections 6 and 7");
    const s6 = status.slice(i6, i7);
    assert.ok(/`schedule\.claim`/.test(s6) && /`openshifts\.notify`/.test(s6), "STATUS section 6");
    assert.ok(/SQL function/.test(s6), "STATUS says the SQL function writes schedule.claim");
    const row = (schemaReview.split("\n").find(l => /^\| `audit_log` \|/.test(l)) || "");
    assert.ok(/`schedule\.claim`/.test(row) && /`openshifts\.notify`/.test(row), "SCHEMA-REVIEW table (a) audit_log row lists both: " + row.slice(0, 160));
  });
  check("docs/PROMPT-13-OPEN-SHIFTS.md is on file: the title, the six numbered parts in order, the cron job", () => {
    assert.ok(prompt13, "docs/PROMPT-13-OPEN-SHIFTS.md exists");
    assert.ok(/^# Prompt 13 /.test(prompt13), "title");
    let last = -1;
    for (let n = 1; n <= 6; n++) { const m = new RegExp("\\n" + n + "\\. [A-Z]").exec(prompt13); assert.ok(m && m.index > last, "part " + n + " in order"); last = m.index; }
    assert.ok(prompt13.indexOf("cron.schedule('silvis-open-shifts-weekly', '0 12 * * 1', $") > 0, "the cron job");
  });
  check("no address-shaped string in the part 6 docs outside the @example.test / @example.com fixtures (guide, README, ONBOARDING, STATUS, SCHEMA-REVIEW, PROMPT-13)", () => {
    const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/g;
    const hits = [];
    [["guide", guide], ["README", readme], ["ONBOARDING", onboarding], ["STATUS", status], ["SCHEMA-REVIEW", schemaReview], ["PROMPT-13", prompt13 || ""]].forEach(([n, t]) => {
      (t.match(EMAIL) || []).forEach(m => { if (!/@example\.(test|com)$/.test(m)) hits.push(n + ": " + m.replace(/[A-Za-z0-9]/g, "x")); });
    });
    assert.deepStrictEqual(hits, [], "address-shaped strings (masked)");
  });
  check("test/ui/smoke.mjs covers the board at 390 px in BOTH themes with the same probe (swipe-hint wrapper, buttons >= 36 px) and writes the six screenshots openshifts.png, -sheet, -email-preview, -390, -dark, -390-dark", () => {
    const smoke = readDoc("test", "ui", "smoke.mjs") || "";
    ["openshifts.png", "openshifts-sheet.png", "openshifts-email-preview.png", "openshifts-390.png", "openshifts-dark.png", "openshifts-390-dark.png"].forEach(f => assert.ok(smoke.indexOf(`"${f}"`) > 0, "screenshot " + f));
    const dark = smoke.slice(smoke.indexOf("const m2 = await mobileProbe()"), smoke.indexOf('"openshifts-390-dark.png"'));
    assert.ok(dark.length > 0, "the dark 390 probe precedes its screenshot");
    assert.ok(/table-wrap/.test(dark) && /swipe sideways/.test(dark) && /minBtn/.test(dark) && /rgb\\\(26, 26, 46\\\)/.test(dark), "the dark 390 pass checks the wrapper hint, the button height and the dark body like the light pass");
    // fix round: the probe reads the wrapper's computed background-image and the dark pass fails on a white cover
    assert.ok(/wrapBg: wrap \? getComputedStyle\(wrap\)\.backgroundImage/.test(smoke), "mobileProbe returns the wrapper's computed backgroundImage as wrapBg");
    assert.ok(/rgb\\\(255, 255, 255\\\)\/\.test\(m2\.wrapBg\)/.test(dark), "the dark 390 pass fails when the swipe-hint cover is white");
    // fix round: the 'ok screenshots' line is earned - every file must exist, be fresh (this run) and stay under 300 KB
    assert.ok(/screenshots missing or stale/.test(smoke) && /300 \* 1024/.test(smoke), "the screenshot ok line is guarded by existence, mtime and the 300 KB size rule");
    // fix round: review screenshots carry no harness artefacts - openshifts.png is taken BEFORE Copy list, the sheet is a viewport shot after the toast is dismissed
    assert.ok(smoke.indexOf('"openshifts.png"') < smoke.indexOf('page.click("[data-testid=ob-copy]")'), "openshifts.png is taken before the Copy list click (no 'Copied' toast over the rows)");
    assert.ok(/"openshifts-sheet\.png"\), fullPage: false/.test(smoke), "the confirm-sheet screenshot is a viewport shot (no full-page stitching band under a fixed overlay)");
    assert.ok(/const clearToast = /.test(smoke) && (smoke.match(/await clearToast\(\)/g) || []).length >= 4, "the harness dismisses the toast before each review screenshot");
  });
}

console.log(`\nopen-shifts: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
