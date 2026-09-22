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
}

console.log(`\nopen-shifts: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
