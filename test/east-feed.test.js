// Silvis east-feed.js unit tests (plain Node asserts, no framework, no network).
// Hand-built Davenport week rows exercise every derivation in east-feed.js:
//   - a FAK service week with a Wednesday override to someone else
//   - a week with FAK on nights.thu and nights.wknd (Fri + Sun, not Sat)
//   - a week with a holidayCoverage entry for FAK
//   - an isBackup week (Fierce East primary) with a FAK night
//   - an isFierceBackup week (Fierce East backup) with a FAK night
//   - a row with the flags undefined (old row) and an override TO FAK
//   - FAK service weeks with ANOTHER surgeon's holiday 24h inside (holiday
//     precedence, incl. an override to FAK and a FAK night on that date)
//   - a forecast row (data.isForecast) mixed into the cache
// plus deriveFierceWeeks (feed + stated merge + deriveFrom cut-off),
// coverageOf, applyOverrides, forecastToBusy, forecastFromFeedRows and
// toEastFeedRows.
// Run: node test/east-feed.test.js   (exit 0 = pass, 1 = failure)
"use strict";
const assert = require("assert");
const ef = require("../east-feed.js");

let n = 0;
function eq(actual, expected, msg) { assert.deepStrictEqual(actual, expected, msg); n++; }
function ok(v, msg) { assert.ok(v, msg); n++; }
const sorted = (set) => [...set].sort();

const FAK = "s6"; // the DAVENPORT id in these fixtures (resolved by code in real use)

// ---- fixtures ----------------------------------------------------------
const weeks = [
  // old row, flags undefined; override of Wed 10/28 TO FAK inside s2's week
  { weekMonday: "2026-10-26", data: { dayCall: "s2", nights: { mon: "s1", tue: "s3", wed: "s4", thu: "s5", wknd: "s7" }, off: "s6", dayCallOverrides: { "2026-10-28": "s6" } } },
  // isFierceBackup week BEFORE deriveFrom (must be cut off by deriveFrom)
  { weekMonday: "2026-10-12", data: { dayCall: "s1", nights: { mon: "s2", tue: "s3", wed: "s4", thu: "s5", wknd: "s7" }, off: "s6", isBackup: false, isFierceBackup: true, holidayCoverage: null } },
  // FAK service week; Wed 11/04 overridden to s2
  { weekMonday: "2026-11-02", data: { dayCall: "s6", nights: { mon: "s1", tue: "s2", wed: "s3", thu: "s4", wknd: "s5" }, off: "s7", isBackup: false, isFierceBackup: false, holidayCoverage: null, dayCallOverrides: { "2026-11-04": "s2" } } },
  // FAK on Thursday night + the weekend (Fri night + Sun). Unflagged row that
  // Faraz's stated list ALSO names - the published row must win.
  { weekMonday: "2026-11-09", data: { dayCall: "s2", nights: { mon: "s1", tue: "s3", wed: "s4", thu: "s6", wknd: "s6" }, off: "s7", isBackup: false, isFierceBackup: false, holidayCoverage: null } },
  // holiday coverage: FAK holds Thanksgiving Thu 11/26 as a 24h unit
  { weekMonday: "2026-11-23", data: { dayCall: "s1", nights: { mon: "s2", tue: "s3", wed: "s4", thu: "s5", wknd: "s7" }, off: "s6", isBackup: false, isFierceBackup: false,
      holidayCoverage: { "2026-11-26": { surgeonId: "s6", role: "holiday_24h", name: "Thanksgiving", type: "major" }, "2026-11-27": { surgeonId: "s1", role: "holiday_24h" } } } },
  // isBackup week (Fierce East PRIMARY): FAK holds Monday night as BACKUP call
  { weekMonday: "2026-12-14", data: { dayCall: "s3", nights: { mon: "s6", tue: "s1", wed: "s2", thu: "s4", wknd: "s5" }, off: "s7", isBackup: true, isFierceBackup: false, holidayCoverage: null } },
  // isFierceBackup week (Fierce East BACKUP): FAK holds Tuesday night
  { weekMonday: "2026-12-21", data: { dayCall: "s3", nights: { mon: "s1", tue: "s6", wed: "s2", thu: "s4", wknd: "s5" }, off: "s7", isBackup: false, isFierceBackup: true, holidayCoverage: null } },
];

// ---- deriveKhanBusyDays ---------------------------------------------------
{
  const { busy, reasons } = ef.deriveKhanBusyDays(weeks, FAK); // default eastBackupCountsAsBusy:true
  eq(sorted(busy), [
    "2026-10-28",                                                       // override TO FAK on an old row
    "2026-11-02", "2026-11-03", "2026-11-05", "2026-11-06", "2026-11-07", // service week minus the overridden Wed
    "2026-11-12", "2026-11-13", "2026-11-15",                           // Thu night, Fri night, Sun
    "2026-11-26",                                                       // holiday unit
    "2026-12-14",                                                       // Mon night in an East backup week
    "2026-12-22",                                                       // Tue night in a Fierce-backup week
  ], "busy dates");
  eq(reasons["2026-10-28"], ["override"]);
  eq(reasons["2026-11-02"], ["service-week"]);
  eq(reasons["2026-11-07"], ["service-week"], "Saturday belongs to the service week");
  eq(reasons["2026-11-04"], undefined, "override to someone else removes the service-week busy");
  eq(reasons["2026-11-08"], undefined, "Sunday is not part of the service week");
  eq(reasons["2026-11-12"], ["night"]);
  eq(reasons["2026-11-13"], ["weekend"]);
  eq(reasons["2026-11-14"], undefined, "wknd does NOT cover Saturday day");
  eq(reasons["2026-11-15"], ["weekend"]);
  eq(reasons["2026-11-26"], ["holiday"]);
  eq(reasons["2026-11-27"], undefined, "another surgeon's holiday day is not FAK-busy");
  eq(reasons["2026-12-14"], ["night", "backup-week"]);
  eq(reasons["2026-12-22"], ["night"], "isFierceBackup week is a regular week for FAK");
  eq(Object.keys(reasons).length, busy.size, "one reasons entry per busy date");
}
{
  // eastBackupCountsAsBusy:false drops ONLY the days FAK holds in isBackup weeks
  const { busy, reasons } = ef.deriveKhanBusyDays(weeks, FAK, { eastBackupCountsAsBusy: false });
  ok(!busy.has("2026-12-14"), "backup-week day dropped when the flag is off");
  eq(reasons["2026-12-14"], ["ignored:night", "ignored:backup-week"]);
  eq(busy.size, 11, "everything else unchanged");
  ok(busy.has("2026-11-02") && busy.has("2026-12-22"));
}
{
  // a backup week where FAK holds nothing is never busy wholesale
  const wk = [{ weekMonday: "2027-01-04", data: { dayCall: "s1", nights: { mon: "s2", tue: "s3", wed: "s4", thu: "s5", wknd: "s7" }, off: "s6", isBackup: true } }];
  eq(ef.deriveKhanBusyDays(wk, FAK).busy.size, 0, "isBackup week with no FAK shift adds no busy days");
  eq(ef.deriveKhanBusyDays(weeks, null).busy.size, 0, "no fakId -> nothing busy (caller must treat as unknown)");
  eq(ef.deriveKhanBusyDays([], FAK).busy.size, 0);
  eq(ef.deriveKhanBusyDays([{ weekMonday: "bad", data: {} }, null], FAK).busy.size, 0, "malformed rows are skipped");
}
{
  // Holiday 24h precedence (reviewer finding east-1): a holidayCoverage entry
  // for SOMEONE ELSE owns the whole 7a-7a day. FAK is the service surgeon for
  // the New Year week; s5 holds Thu 12/31 and Sat 1/2 as 24h units, FAK holds
  // Fri 1/1. An override TO FAK on 12/31 and FAK's own Thu night on 12/31 must
  // not resurrect the day. nights.wknd = FAK -> Fri (his holiday anyway) + Sun.
  const wk = [{ weekMonday: "2026-12-28", data: { dayCall: "s6", nights: { mon: "s1", tue: "s2", wed: "s3", thu: "s6", wknd: "s6" }, off: "s7", isBackup: false, isFierceBackup: false,
    holidayCoverage: { "2026-12-31": { surgeonId: "s5", role: "holiday_24h" }, "2027-01-01": { surgeonId: "s6", role: "holiday_24h" }, "2027-01-02": { surgeonId: "s5", role: "holiday_24h" } },
    dayCallOverrides: { "2026-12-31": "s6" } } }];
  const { busy, reasons } = ef.deriveKhanBusyDays(wk, FAK);
  eq(sorted(busy), ["2026-12-28", "2026-12-29", "2026-12-30", "2027-01-01", "2027-01-03"], "holiday 24h by another surgeon removes FAK's service-week/override/night days");
  eq(reasons["2026-12-28"], ["service-week"]);
  eq(reasons["2026-12-31"], undefined, "Thu: s5's holiday beats FAK's service week, the override to FAK and FAK's Thu night");
  eq(reasons["2027-01-01"], ["service-week", "weekend", "holiday"], "FAK's own holiday keeps every reason");
  eq(reasons["2027-01-02"], undefined, "Sat: s5's holiday beats FAK's service-week Saturday");
  eq(reasons["2027-01-03"], ["weekend"], "Sun is still FAK's wknd");
  // the reviewer's Thanksgiving probe: dayCall FAK, 11/26 -> s1, 11/27 -> s2
  const tg = [{ weekMonday: "2026-11-23", data: { dayCall: "s6", nights: { mon: "s1", tue: "s2", wed: "s3", thu: "s4", wknd: "s5" },
    holidayCoverage: { "2026-11-26": { surgeonId: "s1", role: "holiday_24h" }, "2026-11-27": { surgeonId: "s2", role: "holiday_24h" } } } }];
  eq(sorted(ef.deriveKhanBusyDays(tg, FAK).busy), ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-28"], "Thanksgiving Thu/Fri belong to the holiday surgeons");
  // the live 2026-09-07 shape: dayCall FAK, Labor Day Monday held by s3
  const ld = [{ weekMonday: "2026-09-07", data: { dayCall: "s6", nights: { mon: "s3", tue: "s5", wed: "s7", thu: "s1", wknd: "s4" }, holidayCoverage: { "2026-09-07": { surgeonId: "s3", role: "holiday_24h" } } } }];
  eq(sorted(ef.deriveKhanBusyDays(ld, FAK).busy), ["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12"], "Labor Day Monday is s3's, Tue..Sat stay FAK's");
}

// ---- forecast rows in a mixed cache (reviewer finding east-2) ---------------
// Shaped exactly like scripts/east-forecast.js --sql output. Such a row must be
// invisible to every published-row deriver and readable only via
// forecastFromFeedRows -> forecastToBusy.
const forecastRow = { weekMonday: "2026-12-07", data: { isForecast: true, runs: 100, generatedAt: "2026-09-22T00:00:00Z",
  fakBusyProbabilityByDay: { "2026-12-07": 0.61, "2026-12-08": 0.61, "2026-12-09": 0.6, "2026-12-10": 0.62, "2026-12-11": 0.7, "2026-12-12": 0.6, "2026-12-13": 0.12, "2026-12-14": 0.9 },
  fierceWeekProbability: { eastPrimary: 0, eastBackup: 0 } } };
const stated = { eastPrimary: ["2026-11-09"], eastBackup: ["2026-10-12", "2026-12-07"] };
{
  const mixed = weeks.concat([forecastRow]);
  ok(ef.efIsForecastRow(forecastRow) && !ef.efIsForecastRow(weeks[0]) && !ef.efIsForecastRow(null), "isForecast marker");
  eq(ef.deriveFierceWeeks(mixed, { deriveFrom: "2026-11-02", statedWeeks: stated }).map(w => w.weekMonday + ":" + w.silvisRole + ":" + w.source),
    ["2026-12-07:primary:stated", "2026-12-14:backup:feed", "2026-12-21:primary:feed"], "a cached forecast week never suppresses the stated 12/07 Fierce week");
  eq(ef.deriveFierceWeeks([forecastRow], { statedWeeks: stated }).map(w => w.weekMonday), ["2026-10-12", "2026-11-09", "2026-12-07"], "forecast-only cache = stated weeks only");
  const pub = ef.deriveKhanBusyDays(weeks, FAK), mix = ef.deriveKhanBusyDays(mixed, FAK);
  eq(sorted(mix.busy), sorted(pub.busy), "forecast rows add no published busy days");
  eq(mix.reasons, pub.reasons);
  eq(ef.deriveKhanBusyDays([forecastRow], FAK).busy.size, 0, "a forecast week alone derives NOTHING (the caller must go through forecastFromFeedRows)");
  eq(ef.coverageOf(mixed), { from: "2026-10-12", to: "2026-12-27" }, "forecast rows are not published coverage");
  eq(ef.coverageOf([forecastRow]), null, "a forecast-only cache reports no coverage");
  eq(ef.toEastFeedRows(mixed).map(r => r.week_monday).indexOf("2026-12-07"), -1, "forecast rows are never written to east_feed");
  const f = ef.forecastFromFeedRows(mixed);
  eq(Object.keys(f).sort(), ["2026-12-07", "2026-12-08", "2026-12-09", "2026-12-10", "2026-12-11", "2026-12-12", "2026-12-13"], "only the row's own Mon..Sun dates (12/14 belongs to another week and is dropped)");
  eq(f["2026-12-11"], 0.7);
  eq(sorted(ef.forecastToBusy(f, 0.5)), ["2026-12-07", "2026-12-08", "2026-12-09", "2026-12-10", "2026-12-11", "2026-12-12"], "forecast -> busy at the seed threshold");
  eq(ef.forecastFromFeedRows(weeks), {}, "published rows yield no forecast");
  eq(ef.forecastFromFeedRows([{ week_monday: "2026-12-07", data: forecastRow.data }])["2026-12-13"], 0.12, "raw east_forecast rows (week_monday) are accepted too");
  eq(ef.forecastFromFeedRows(null), {});
}

// ---- deriveFierceWeeks -----------------------------------------------------
{
  const out = ef.deriveFierceWeeks(weeks, { deriveFrom: "2026-11-02", statedWeeks: stated });
  eq(out, [
    { weekMonday: "2026-12-07", silvisRole: "primary", source: "stated" }, // not in feed -> stated fills it
    { weekMonday: "2026-12-14", silvisRole: "backup",  source: "feed" },   // isBackup
    { weekMonday: "2026-12-21", silvisRole: "primary", source: "feed" },   // isFierceBackup
  ], "derived Fierce weeks: feed + stated, sorted, cut at deriveFrom; 11/09 stated is ignored because the feed row exists unflagged");
}
{
  const out = ef.deriveFierceWeeks(weeks, { statedWeeks: stated }); // no cut-off
  eq(out.map(w => w.weekMonday + ":" + w.silvisRole + ":" + w.source), [
    "2026-10-12:primary:feed", "2026-12-07:primary:stated", "2026-12-14:backup:feed", "2026-12-21:primary:feed",
  ], "without deriveFrom the 10/12 feed week is included and the feed beats the 10/12 stated entry");
}
eq(ef.deriveFierceWeeks(weeks), [
  { weekMonday: "2026-10-12", silvisRole: "primary", source: "feed" },
  { weekMonday: "2026-12-14", silvisRole: "backup", source: "feed" },
  { weekMonday: "2026-12-21", silvisRole: "primary", source: "feed" },
], "feed only, no opts");
eq(ef.deriveFierceWeeks([], { statedWeeks: stated, deriveFrom: "2026-11-02" }).map(w => w.weekMonday), ["2026-11-09", "2026-12-07"], "empty feed -> stated weeks only");
eq(ef.deriveFierceWeeks([], { statedWeeks: stated })[0], { weekMonday: "2026-10-12", silvisRole: "primary", source: "stated" });

// ---- coverageOf ------------------------------------------------------------
eq(ef.coverageOf(weeks), { from: "2026-10-12", to: "2026-12-27" });
eq(ef.coverageOf([]), null);
eq(ef.coverageOf(null), null);
eq(ef.coverageOf([{ weekMonday: "2026-12-28", data: {} }]), { from: "2026-12-28", to: "2027-01-03" }, "year boundary");

// ---- applyOverrides --------------------------------------------------------
{
  const base = new Set(["2026-11-02", "2026-11-03"]);
  const rows = [
    { day: "2026-11-04", person_id: "s1", busy: true },   // add
    { day: "2026-11-02", person_id: "s1", busy: false },  // remove
    { day: "2026-11-03", person_id: "s5", busy: false },  // other person - ignored
    { day: "not-a-date", person_id: "s1", busy: true },   // malformed - ignored
  ];
  const out = ef.applyOverrides(base, rows, "s1");
  eq(sorted(out), ["2026-11-03", "2026-11-04"]);
  eq(sorted(base), ["2026-11-02", "2026-11-03"], "input set is not mutated");
  eq(sorted(ef.applyOverrides(base, [], "s1")), ["2026-11-02", "2026-11-03"]);
}

// ---- forecastToBusy --------------------------------------------------------
{
  const f = { "2026-12-01": 0.5, "2026-12-02": 0.49, "2026-12-03": 1, "2026-12-04": 0, "junk": 0.9 };
  eq(sorted(ef.forecastToBusy(f, 0.5)), ["2026-12-01", "2026-12-03"], "prob >= threshold, malformed keys dropped");
  eq(sorted(ef.forecastToBusy(f, 0.2)), ["2026-12-01", "2026-12-02", "2026-12-03"]);
  eq(ef.forecastToBusy(null, 0.5).size, 0);
}

// ---- toEastFeedRows / helpers ------------------------------------------
{
  const rows = ef.toEastFeedRows(weeks.slice(0, 2));
  eq(rows.map(r => r.week_monday), ["2026-10-26", "2026-10-12"]);
  eq(rows[0].data, weeks[0].data);
  eq(ef.toEastFeedRows([{ weekMonday: "x", data: {} }]), []);
}
eq(ef.eastResolveFakId([{ id: "s1", name: "DJA" }, { id: "s6", name: "FAK" }], "FAK"), "s6");
eq(ef.eastResolveFakId([{ id: "s1", name: "DJA" }], "FAK"), null);
eq(ef.efDayOffsets("2026-12-28"), ["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
ok(typeof ef.EAST_PROJECT.url === "string" && ef.EAST_PROJECT.url.startsWith("https://") && ef.EAST_PROJECT.anonKey.length > 100);

// ---- Prompt 12 C (9/22): forecast pruned to the unpublished weeks; overrides grouped per person ----
{
  const fc = { "2026-11-04": 0.9, "2027-01-31": 0.6, "2027-02-01": 0.5, "junk": 0.7 };
  const cov = { from: "2026-11-01", to: "2027-01-31" };
  eq(ef.forecastOutsideCoverage(fc, cov), { "2027-02-01": 0.5 }, "C: days inside the published coverage (inclusive) are dropped, malformed keys too");
  eq(ef.forecastOutsideCoverage(fc, null), { "2026-11-04": 0.9, "2027-01-31": 0.6, "2027-02-01": 0.5 }, "C: no coverage -> the whole (validated) forecast");
  eq(ef.forecastOutsideCoverage(null, cov), {}, "C: no forecast -> empty");
  eq(fc["2026-11-04"], 0.9, "C: input map not mutated");
  const rows = [
    { day: "2026-11-04", person_id: "s1", busy: true },
    { day: "2026-11-02", person_id: "s1", busy: false },
    { day: "2026-11-03", person_id: "s5", busy: false },
    { day: "not-a-date", person_id: "s1", busy: true },
    { day: "2026-11-05", person_id: "s1", busy: "true" },
    null,
  ];
  eq(ef.overridesByPerson(rows), { s1: { "2026-11-04": true, "2026-11-02": false }, s5: { "2026-11-03": false } }, "C: east_overrides rows -> { person: { day: bool } }, malformed rows dropped");
  eq(ef.overridesByPerson([]), {});
  eq(ef.overridesByPerson(null), {});
}

// ---- Prompt 12 C.5: scripts/east-forecast.js defaults come from the seed (runs 200) ----
// Requiring the script must NOT run the forecast (main is guarded by require.main).
{
  const script = require("../scripts/east-forecast.js");
  const seed = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "..", "docs", "silvis-seed.json"), "utf8"));
  eq(seed.groupRules.eastFeed.forecast.runs, 200, "seed: groupRules.eastFeed.forecast.runs is 200");
  eq(script.defaultForecastRuns(), 200, "C.5: the script's default run count is read from the seed");
  const a = script.parseArgs(["node", "east-forecast.js"]);
  eq(a.runs, 200, "C.5: --runs defaults to the seed's 200 (was a hard-coded 100)");
  ok(a.budgetSec >= 900, "C.5: the default budget fits 200 runs (>= 900 s), got " + a.budgetSec);
  eq(script.parseArgs(["node", "east-forecast.js", "--runs", "50", "--budget-sec", "30"]).runs, 50, "C.5: --runs still overrides");
  eq(script.parseArgs(["node", "east-forecast.js", "--runs", "50", "--budget-sec", "30"]).budgetSec, 30);
}

// ---- Fix round (review 9/22, finding 16): the preview report dumps diagnostics.eastConflicts ----
{
  const pg = require("fs").readFileSync(require("path").join(__dirname, "..", "scripts", "preview-generate.js"), "utf8");
  ok(/for \(const key of \["holidayUnits"[^\]]*"eastConflicts"[^\]]*\]\)/.test(pg), "C fix 16: scripts/preview-generate.js dumps diagnostics.eastConflicts in the main report");
  ok(/for \(const key of \["fixedViolations"[^\]]*"eastConflicts"[^\]]*\]\)/.test(pg), "C fix 16: ...and in the October backfill section");
}

console.log("ok " + n + " assertions");
