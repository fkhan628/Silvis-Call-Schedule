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
    const nb = appSrc.slice(k, appSrc.indexOf("\n  };\n", k));
    assert.ok(/const mail = await sendEmailNotif\("open_shifts"/.test(nb), "notifyOpenShifts awaits sendEmailNotif");
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

console.log(`\nopen-shifts: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
