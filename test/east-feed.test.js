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
eq(ef.eastResolveFakId([{ id: "s6", name: "FAK" }]), null, "RG-8: no default code - a missing code resolves to null, never to FAK");
eq(ef.eastResolveFakId([{ id: "s5", name: "NF" }], "nf"), "s5", "RG-8: any code, case-insensitive");
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
  // audit RG-8 (9/23): the forecast code comes from the seed roster (the one active entry with
  // eastFeed.enabled + forecast), never a literal; zero or two such entries refuse, naming the codes.
  ok(typeof script.forecastCodeFromSeed === "function", "RG-8: scripts/east-forecast.js exports forecastCodeFromSeed");
  eq(script.forecastCodeFromSeed(seed), "FAK", "RG-8: the shipped seed's forecast code is FAK (s1 is the only eastFeed.forecast entry)");
  const twoFlags = JSON.parse(JSON.stringify(seed)); twoFlags.surgeonRules.s5.eastFeed.forecast = true;
  let fcErr = null; try { script.forecastCodeFromSeed(twoFlags); } catch (e) { fcErr = e; }
  ok(fcErr && /found 2/.test(fcErr.message) && /FAK/.test(fcErr.message) && /NF/.test(fcErr.message), "RG-8: two forecast flags throw 'found 2' naming both codes, got: " + (fcErr && fcErr.message));
  const noFlag = JSON.parse(JSON.stringify(seed)); delete noFlag.surgeonRules.s1.eastFeed.forecast;
  fcErr = null; try { script.forecastCodeFromSeed(noFlag); } catch (e) { fcErr = e; }
  ok(fcErr && /found 0/.test(fcErr.message), "RG-8: no forecast flag throws 'found 0', got: " + (fcErr && fcErr.message));
  const inactive = JSON.parse(JSON.stringify(seed)); inactive.roster.find(s => s.id === "s1").active = false;
  fcErr = null; try { script.forecastCodeFromSeed(inactive); } catch (e) { fcErr = e; }
  ok(fcErr && /found 0/.test(fcErr.message), "RG-8: an inactive roster entry does not count, got: " + (fcErr && fcErr.message));
  // the JSON output and every printed SQL row carry `code` beside `fakId` (source pins on the two data objects),
  // and the script resolves no literal code.
  const efScriptSrc = require("fs").readFileSync(require("path").join(__dirname, "..", "scripts", "east-forecast.js"), "utf8");
  ok(/code:\s*inp\.code,[^\n]*\n\s*fakId:\s*inp\.fakId/.test(efScriptSrc), "RG-8: docs/east-forecast-latest.json carries code beside fakId");
  ok(/isForecast:\s*true,[^\n]*code:\s*inp\.code,\s*fakId:\s*inp\.fakId/.test(efScriptSrc), "RG-8: each printed east_forecast SQL row carries data.code beside data.fakId");
  ok(!/eastResolveFakId\([^)]*"FAK"\)/.test(efScriptSrc) && /eastResolveFakId\(surgeons,\s*code\)/.test(efScriptSrc), "RG-8: the Davenport id is resolved by the seed's code, never by a literal FAK");
}

// ---- Fix round (review 9/22, finding 16): the preview report dumps diagnostics.eastConflicts ----
{
  const pg = require("fs").readFileSync(require("path").join(__dirname, "..", "scripts", "preview-generate.js"), "utf8");
  ok(/for \(const key of \["holidayUnits"[^\]]*"eastConflicts"[^\]]*\]\)/.test(pg), "C fix 16: scripts/preview-generate.js dumps diagnostics.eastConflicts in the main report");
  ok(/for \(const key of \["fixedViolations"[^\]]*"eastConflicts"[^\]]*\]\)/.test(pg), "C fix 16: ...and in the October backfill section");
}

// ---- Prompt 15 part 1a (9/23): East vacations - Davenport time_off rows -> per-week payload key + helper ----
// Davenport-shaped fixture: roster with CODES (name = code, ids are Davenport
// ids), time_off rows for several people (incl. an APP and a no-call row),
// adjacent and overlapping FAK ranges, a range before the first cached week, one
// in a gap week and one after the last cached week. Only FAK's vacations may
// come through, merged and sorted; the per-week split; the failure path keeps
// the cached vacations; the helper merges across weeks.
{
  const idByCode = { FAK: "s6" };
  const timeOff = [
    { id: 1, person_id: "s6", kind: "vacation", start_date: "2026-11-05", end_date: "2026-11-08" }, // adjacent to the next (merge)
    { id: 2, person_id: "s6", kind: "vacation", start_date: "2026-11-02", end_date: "2026-11-04" },
    { id: 3, person_id: "s1", kind: "vacation", start_date: "2026-11-03", end_date: "2026-11-05" }, // another surgeon - dropped
    { id: 4, person_id: "a2", kind: "vacation", start_date: "2026-11-02", end_date: "2026-11-02" }, // an APP - dropped
    { id: 5, person_id: "s6", kind: "nocall", start_date: "2026-11-10", end_date: "2026-11-10" },   // no-call day: a Davenport concept - dropped
    { id: 6, person_id: "s6", kind: "vacation", start_date: "2026-11-15", end_date: "2026-11-17" }, // overlaps the next (merge)
    { id: 7, person_id: "s6", kind: "vacation", start_date: "2026-11-13", end_date: "2026-11-16" },
    { id: 8, person_id: "s6", kind: "vacation", start_date: "2026-12-09", end_date: "2026-12-10" }, // gap week (12/07 not cached)
    { id: 9, person_id: "s6", kind: "vacation", start_date: "2026-10-01", end_date: "2026-10-02" }, // before the first cached week
    { id: 10, person_id: "s6", kind: "vacation", start_date: "2027-01-08", end_date: "2027-01-10" }, // after the last cached week
    { id: 11, person_id: "s6", kind: "vacation", start_date: "2026-11-03", end_date: "2026-11-03" }, // inside 11/02..11/08 (absorbed)
    { id: 12, person_id: "s6", kind: "vacation", start_date: "nope", end_date: "2026-11-30" },        // malformed - dropped
    { id: 13, person_id: "s6", kind: "vacation", start_date: "2026-11-30", end_date: "2026-11-29" },  // end before start - dropped
    null,
  ];
  const merged = [
    { start: "2026-10-01", end: "2026-10-02" },
    { start: "2026-11-02", end: "2026-11-08" },
    { start: "2026-11-13", end: "2026-11-17" },
    { start: "2026-12-09", end: "2026-12-10" },
    { start: "2027-01-08", end: "2027-01-10" },
  ];
  // merge
  eq(ef.eastMergeRanges([{ start: "2026-11-05", end: "2026-11-08" }, { start: "2026-11-02", end: "2026-11-04" }, { start: "2026-11-15", end: "2026-11-17" }, { start: "2026-11-13", end: "2026-11-16" }, { start: "2026-11-03", end: "2026-11-03" }, { start: "bad", end: "2026-11-30" }, { start: "2026-11-30", end: "2026-11-29" }, null]),
    [{ start: "2026-11-02", end: "2026-11-08" }, { start: "2026-11-13", end: "2026-11-17" }], "P15: adjacent + overlapping + contained ranges merge, sorted; malformed and inverted ranges dropped");
  eq(ef.eastMergeRanges([{ start: "2026-12-31", end: "2026-12-31" }, { start: "2027-01-01", end: "2027-01-02" }]), [{ start: "2026-12-31", end: "2027-01-02" }], "P15: adjacency across the year boundary");
  eq(ef.eastMergeRanges([{ start: "2026-11-02", end: "2026-11-03" }, { start: "2026-11-05", end: "2026-11-06" }]), [{ start: "2026-11-02", end: "2026-11-03" }, { start: "2026-11-05", end: "2026-11-06" }], "P15: a one-day gap is NOT adjacent");
  eq(ef.eastMergeRanges(null), []);
  // Davenport rows -> { CODE: merged ranges } (kind vacation only, resolved ids only)
  eq(ef.vacationsFromTimeOff(timeOff, idByCode), { FAK: merged }, "P15: only the FAK code's vacation rows, merged and sorted; other people, APPs, no-call and malformed rows dropped");
  eq(ef.vacationsFromTimeOff(timeOff, { FAK: "s6", DJA: "s1" }).DJA, [{ start: "2026-11-03", end: "2026-11-05" }], "P15: generic - a second code resolves independently");
  eq(ef.vacationsFromTimeOff(timeOff, {}), {}, "P15: no codes -> nothing");
  eq(ef.vacationsFromTimeOff(null, idByCode), { FAK: [] }, "P15: no rows -> an empty list per code (known-empty, not missing)");
  // per-week split over an UNSORTED cache with a gap week (12/07 missing)
  const wk = [
    { weekMonday: "2026-11-09", data: { dayCall: "s2", nights: {} } },
    { weekMonday: "2026-10-12", data: { dayCall: "s1", nights: {} } },
    { weekMonday: "2026-11-02", data: { dayCall: "s6", nights: {} } },
    { weekMonday: "2026-11-16", data: { dayCall: "s3", nights: {} } },
    { weekMonday: "2026-11-30", data: { dayCall: "s4", nights: {} } },
    { weekMonday: "2026-12-14", data: { dayCall: "s5", nights: {} } },
    { weekMonday: "2026-12-07", data: { isForecast: true, fakBusyProbabilityByDay: {} } }, // forecast row in a mixed cache: never a carrier
  ];
  const before = JSON.stringify(wk);
  const out = ef.attachVacationsToWeeks(wk, { FAK: merged });
  eq(JSON.stringify(wk), before, "P15: input weeks are not mutated");
  const byMon = {}; out.forEach(w => { byMon[w.weekMonday] = w; });
  eq(out.map(w => w.weekMonday), wk.map(w => w.weekMonday), "P15: same rows, same order");
  eq(byMon["2026-10-12"].data.vacations, [{ code: "FAK", start: "2026-10-01", end: "2026-10-02" }], "P15: a range before the first cached week rides on the first week");
  eq(byMon["2026-11-02"].data.vacations, [{ code: "FAK", start: "2026-11-02", end: "2026-11-08" }], "P15: the range touching Mon..Sun of that week, whole (not clipped)");
  eq(byMon["2026-11-09"].data.vacations, [{ code: "FAK", start: "2026-11-13", end: "2026-11-17" }], "P15: a range spanning two weeks is in both (1/2)");
  eq(byMon["2026-11-16"].data.vacations, [{ code: "FAK", start: "2026-11-13", end: "2026-11-17" }], "P15: a range spanning two weeks is in both (2/2)");
  eq(byMon["2026-11-30"].data.vacations, [{ code: "FAK", start: "2026-12-09", end: "2026-12-10" }], "P15: a range in a GAP week rides on the latest cached week before it");
  eq(byMon["2026-12-14"].data.vacations, [{ code: "FAK", start: "2027-01-08", end: "2027-01-10" }], "P15: a range after the last cached week rides on the last week");
  eq(byMon["2026-12-07"].data.vacations, undefined, "P15: a forecast row never carries vacations");
  eq(byMon["2026-11-02"].data.dayCall, "s6", "P15: the rest of the payload is preserved");
  eq(ef.attachVacationsToWeeks([{ weekMonday: "2026-11-02", data: {} }], { FAK: [] })[0].data.vacations, [], "P15: a fetched-but-empty list writes an empty key (known-empty)");
  eq(ef.attachVacationsToWeeks([{ weekMonday: "2026-11-02", data: {} }], null)[0].data.vacations, undefined, "P15: vacations null (fetch failed) -> the key is left alone");
  // the helper merges across cached weeks (the spanning range appears twice)
  const cacheRows = ef.toEastFeedRows(out);
  eq(ef.eastVacations(cacheRows, "FAK"), merged, "P15: eastVacations merges the per-week copies back into one sorted list");
  eq(ef.eastVacations(cacheRows, "fak"), merged, "P15: code match is case-insensitive");
  eq(ef.eastVacations(cacheRows, "DJA"), [], "P15: another code -> empty");
  eq(ef.eastVacations(out, "FAK"), merged, "P15: accepts weekMonday rows too");
  eq(ef.eastVacations([{ week_monday: "2026-11-02", data: { vacations: [{ code: "FAK", start: "2026-11-02", end: "2026-11-04" }] } }, { week_monday: "2026-11-09", data: { vacations: [{ code: "FAK", start: "2026-11-05", end: "2026-11-06" }] } }], "FAK"),
    [{ start: "2026-11-02", end: "2026-11-06" }], "P15: adjacent ranges cached on different weeks merge");
  eq(ef.eastVacations(null, "FAK"), []);
  eq(ef.eastVacations([{ week_monday: "2026-11-02", data: { dayCall: "s6" } }], "FAK"), [], "P15: rows without the key (never refreshed) contribute nothing");
  // failure path: the app keeps the cached vacations per week when the time_off read failed
  const prev = ef.toEastFeedRows(out);
  const fresh = [{ weekMonday: "2026-11-02", data: { dayCall: "s6", nights: {} } }, { weekMonday: "2026-11-09", data: { dayCall: "s2", nights: {} } }, { weekMonday: "2027-01-04", data: { dayCall: "s1" } }];
  const kept = ef.keepCachedVacations(fresh, prev);
  eq(kept[0].data.vacations, [{ code: "FAK", start: "2026-11-02", end: "2026-11-08" }], "P15: a week whose new payload has no vacations key inherits the cached list");
  eq(kept[1].data.vacations, [{ code: "FAK", start: "2026-11-13", end: "2026-11-17" }]);
  eq(kept[2].data.vacations, undefined, "P15: no cached row -> still unknown");
  eq(fresh[0].data.vacations, undefined, "P15: keepCachedVacations does not mutate its input");
  eq(ef.keepCachedVacations([{ weekMonday: "2026-11-02", data: { vacations: [] } }], prev)[0].data.vacations, [], "P15: a fetched (empty) list is NOT overwritten by the cache");
}
// planVacationCache (review E1 finding 1, 9/23): the per-week split and the
// ride-on host rule run over the WHOLE cache (cached published rows + the
// fetched weeks; the fetched payload wins per Monday), and every cached row
// OUTSIDE the fetched set whose list changed is returned for the upsert, so a
// ride-on range that Davenport cancelled or shortened is cleared from its old
// host once that host has left the 28-day refresh window. Reviewer's scenario:
// T1 (Nov 2026) Davenport published through 11/09 -> Khan's 11/24-27, 12/8-10
// and 2027-02-03..28 ride on the 11/09 row; T2 (a refresh on 2026-12-21, window
// from 11/16) Davenport published 11/16..12/21, Khan cancelled 2027-02 and
// shortened 12/8-10 to 12/8-9.
{
  const t1weeks = ["2026-10-26", "2026-11-02", "2026-11-09"].map(m => ({ weekMonday: m, data: { dayCall: "s1" } }));
  const t1vac = { FAK: [{ start: "2026-11-24", end: "2026-11-27" }, { start: "2026-12-08", end: "2026-12-10" }, { start: "2027-02-03", end: "2027-02-20" }] };
  const cacheT1 = ef.toEastFeedRows(ef.attachVacationsToWeeks(t1weeks, t1vac)).map(r => ({ ...r, fetched_at: "2026-11-10T12:00:00.000Z" }));
  eq(cacheT1[2].data.vacations.map(v => v.start), ["2026-11-24", "2026-12-08", "2027-02-03"], "P15 fix 1: T1 - all three future ranges ride on the newest cached week 11/09");
  // a forecast row and a past range on an old row live in the cache too
  cacheT1.push({ week_monday: "2026-12-07", data: { isForecast: true, fakBusyProbabilityByDay: {} }, fetched_at: "2026-11-10T12:00:00.000Z" });
  cacheT1[0].data.vacations = [{ code: "FAK", start: "2026-10-28", end: "2026-10-30" }]; // ended before the T2 window: the read cannot see it
  const t2weeks = ["2026-11-16", "2026-11-23", "2026-11-30", "2026-12-07", "2026-12-14", "2026-12-21"].map(m => ({ weekMonday: m, data: { dayCall: "s2" } }));
  const t2vac = { FAK: [{ start: "2026-11-24", end: "2026-11-27" }, { start: "2026-12-08", end: "2026-12-09" }] };
  const before = JSON.stringify({ cacheT1, t2weeks });
  const plan = ef.planVacationCache(cacheT1, t2weeks, t2vac, { from: "2026-11-16" });
  eq(JSON.stringify({ cacheT1, t2weeks }), before, "P15 fix 1: planVacationCache does not mutate the cache or the fetched weeks");
  eq(plan.weeks.map(w => w.weekMonday), t2weeks.map(w => w.weekMonday), "P15 fix 1: every fetched week comes back, in order");
  eq(plan.weeks[1].data.vacations, [{ code: "FAK", start: "2026-11-24", end: "2026-11-27" }], "P15 fix 1: 11/24-27 lands on the now-published 11/23 week");
  eq(plan.weeks[3].data.vacations, [{ code: "FAK", start: "2026-12-08", end: "2026-12-09" }], "P15 fix 1: the shortened range lands on the 12/07 week");
  eq(plan.weeks[0].data.dayCall, "s2", "P15 fix 1: the fetched payload is kept");
  eq(plan.rewritten.map(w => w.weekMonday), ["2026-11-09"], "P15 fix 1: exactly the old host row (outside the window, list changed) is rewritten - not the unchanged 10/26 and 11/02 rows, never the forecast row");
  eq(plan.rewritten[0].data.vacations, [], "P15 fix 1: the old host's list is cleared (cancelled 2027-02, re-hosted 11/24-27 and 12/8-9)");
  eq(plan.rewritten[0].data.dayCall, "s1", "P15 fix 1: the old host keeps its own week payload");
  eq(plan.rewritten[0].fetchedAt, "2026-11-10T12:00:00.000Z", "P15 fix 1: the old host keeps its fetched_at (its week data was not re-fetched)");
  eq(plan.carriers, 9, "P15 fix 1: carriers = 3 cached published rows + 6 fetched weeks (the forecast row is not one)");
  // the resulting cache (merge-duplicates upsert on week_monday) tells the Davenport truth
  const byMon = {}; cacheT1.forEach(r => { byMon[r.week_monday] = r; });
  ef.toEastFeedRows(plan.weeks).concat(ef.toEastFeedRows(plan.rewritten)).forEach(r => { byMon[r.week_monday] = r; });
  const cacheT2 = Object.keys(byMon).sort().map(m => byMon[m]);
  eq(ef.eastVacations(cacheT2, "FAK"), [{ start: "2026-10-28", end: "2026-10-30" }, { start: "2026-11-24", end: "2026-11-27" }, { start: "2026-12-08", end: "2026-12-09" }], "P15 fix 1: after the upsert the cache holds Davenport's truth - the cancelled 2027-02 range and the 12/13 day are gone; the past 10/28-30 range (before the read window) is kept");
  // T2' variant: Davenport published NOTHING new (0 weeks in the window) - the rewrite still happens
  const plan0 = ef.planVacationCache(cacheT1, [], t2vac, { from: "2026-11-16" });
  eq(plan0.weeks, [], "P15 fix 1: 0 weeks fetched -> no week rows");
  eq(plan0.rewritten.map(w => w.weekMonday), ["2026-11-09"], "P15 fix 1: 0 weeks fetched -> the host row is still rewritten");
  eq(plan0.rewritten[0].data.vacations, [{ code: "FAK", start: "2026-11-24", end: "2026-11-27" }, { code: "FAK", start: "2026-12-08", end: "2026-12-09" }], "P15 fix 1: ...with the current ranges riding on it (2027-02 dropped, 12/10 dropped)");
  eq(plan0.carriers, 3);
  // no churn: rows without the key whose computed list is empty are not rewritten
  const bare = [{ week_monday: "2026-11-02", data: { dayCall: "s1" } }, { week_monday: "2026-11-09", data: { dayCall: "s1" } }];
  eq(ef.planVacationCache(bare, [{ weekMonday: "2026-11-16", data: {} }], { FAK: [] }, { from: "2026-11-16" }).rewritten, [], "P15 fix 1: a known-empty read rewrites no old row (absent key == empty list)");
  eq(ef.planVacationCache(bare, [], { FAK: [{ start: "2027-01-04", end: "2027-01-05" }] }, { from: "2026-11-16" }).rewritten.map(w => w.weekMonday + ":" + w.data.vacations.length), ["2026-11-09:1"], "P15 fix 1: a new ride-on range on a bare cache lands on the newest cached row");
  // a cached row that is ALSO fetched: the fetched payload wins and it is never in rewritten
  const both = ef.planVacationCache(cacheT1, [{ weekMonday: "2026-11-09", data: { dayCall: "s9" } }], { FAK: [] }, { from: "2026-11-02" });
  eq(both.weeks.map(w => w.weekMonday + ":" + w.data.dayCall), ["2026-11-09:s9"]);
  eq(both.rewritten, [], "P15 fix 1: the re-fetched host is written as a fetched week, not as a rewrite");
  // the failure path is not this helper's: vacations null -> fetched weeks as they are, nothing rewritten
  const nul = ef.planVacationCache(cacheT1, t2weeks, null, { from: "2026-11-16" });
  eq(nul.weeks.map(w => w.data.vacations), t2weeks.map(() => undefined), "P15 fix 1: vacations null -> no key written (keepCachedVacations is the caller's next step)");
  eq(nul.rewritten, []);
  eq(ef.planVacationCache(null, null, { FAK: [] }), { weeks: [], rewritten: [], carriers: 0 }, "P15 fix 1: empty everything");
}
// ---- Prompt 31 Part B item 7 (10/13): the refresh windows and the extra leg's week selection ----
// eastRefreshWindows(today) -> { main, extra }: main = the window the in-app refresh has always read WITH the vacations
// (Monday of today - 28 .. + 210 days - unchanged on purpose: the time_off read, the review-reset floor and the forecast
// prune stay where they were); extra = the weeks-only read for the call-totals card: Monday of the same date one year
// back (Feb 29 -> Feb 28) .. Monday of today + EAST_AHEAD_DAYS. eastExtraWeeks(mainWeeks, extraWeeks, win) picks what the
// extra leg caches: the weeks before the main window, and the weeks after it ONLY while contiguous with the last week
// the main read returned (critic 10/13 item 9: a week past a gap would stretch the published coverage over unpublished
// weeks, where the rules read Khan as known clear and ignore the forecast).
{
  const vm = require("vm"), fs = require("fs"), path = require("path"), cp = require("child_process");
  const ROOT = path.join(__dirname, "..");
  const H = require("../helpers.js");   // the refresh's OLD window expression is written with helpers' fmt / monOf / addD / parse
  ok(typeof ef.eastRefreshWindows === "function", "P31B item 7: east-feed.js exports eastRefreshWindows");
  ok(typeof ef.eastExtraWeeks === "function", "P31B item 7: east-feed.js exports eastExtraWeeks");
  eq(ef.EAST_AHEAD_DAYS, 1095, "P31B item 7: the extra read reaches three years ahead (EAST_AHEAD_DAYS)");
  ok(typeof ef.efMonday === "function", "P31B item 7: east-feed.js exports efMonday");
  eq(["2026-10-12", "2026-10-13", "2026-10-18", "2028-02-29", "2027-01-01"].map(ef.efMonday), ["2026-10-12", "2026-10-12", "2026-10-12", "2028-02-28", "2026-12-28"], "P31B item 7: efMonday = the Monday on or before the date");
  // callTotalPeriods (call-totals.js, the ported counter): the extra window must cover every period the card counts
  const box = { console }; box.globalThis = box; vm.createContext(box);
  for (const f of ["helpers.js", "east-feed.js", "call-totals.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), box, { filename: f });
  const ctp = vm.runInContext("callTotalPeriods", box);
  const days = [];
  for (let d = H.parse("2025-12-01"); H.fmt(d) <= "2028-12-31"; d = H.addD(d, 1)) days.push(H.fmt(d));
  ok(days.length === 1127, "P31B item 7: 2025-12-01..2028-12-31 is 1127 days, got " + days.length);
  const isMonday = (s) => H.parse(s).getDay() === 1;
  const bad = [];
  days.forEach(d => {
    const w = ef.eastRefreshWindows(d);
    if (!w || !w.main || !w.extra) { bad.push(d + ": no windows"); return; }
    const oldFrom = H.fmt(H.monOf(H.addD(H.parse(d), -28)));
    const oldTo = H.fmt(H.addD(H.parse(oldFrom), 7 * 30));
    if (w.main.from !== oldFrom || w.main.to !== oldTo) bad.push(d + ": main " + JSON.stringify(w.main) + " != the old " + oldFrom + ".." + oldTo);
    if (!isMonday(w.extra.from) || !isMonday(w.extra.to)) bad.push(d + ": extra not Mondays " + JSON.stringify(w.extra));
    if (w.extra.to !== H.fmt(H.monOf(H.addD(H.parse(d), 1095)))) bad.push(d + ": extra.to " + w.extra.to);
    if (!(w.extra.to >= w.main.to) || !(w.extra.from <= w.main.from)) bad.push(d + ": extra does not contain main");
    const y = Number(d.slice(0, 4)) - 1, back = y + d.slice(4, 8) + String(Math.min(Number(d.slice(8, 10)), new Date(y, Number(d.slice(5, 7)), 0).getDate())).padStart(2, "0");
    if (w.extra.from !== H.fmt(H.monOf(H.parse(back)))) bad.push(d + ": extra.from " + w.extra.from + " != Monday of " + back);
    // the card's "today" is the DEVICE date (D2), at most a day off the Central date the refresh uses
    [-1, 0, 1].forEach(k => {
      const dev = H.fmt(H.addD(H.parse(d), k)), p = ctp(dev);
      if (!p) { bad.push(dev + ": callTotalPeriods null"); return; }
      if (!(w.extra.from <= p.rolling12.from)) bad.push(d + " (device " + dev + "): extra.from " + w.extra.from + " after the 12-month period's start " + p.rolling12.from);
      if (!(w.extra.from <= p.ytd.from) || !(w.extra.from <= p.year.from)) bad.push(d + " (device " + dev + "): extra.from " + w.extra.from + " after Jan 1 " + p.ytd.from);
    });
  });
  eq(bad.slice(0, 5), [], "P31B item 7: over every day 2025-12-01..2028-12-31 main equals the old refresh window exactly and extra (Mondays) covers the card's 12 months, YTD and full year for the device date +/- 1 day (" + bad.length + " problem(s))");
  // spot values (design 2.3, re-computed by the critic)
  eq(ef.eastRefreshWindows("2026-10-13"), { main: { from: "2026-09-14", to: "2027-04-12" }, extra: { from: "2025-10-13", to: "2029-10-08" } }, "P31B item 7: 2026-10-13");
  eq(ef.eastRefreshWindows("2028-02-29").extra.from, "2027-02-22", "P31B item 7: leap day -> one year back is Feb 28 -> its Monday");
  eq(ef.eastRefreshWindows("2027-01-01").extra.from, "2025-12-29", "P31B item 7: a year turn - Monday of 2026-01-01 (Davenport's first week)");
  [undefined, null, "", "2026-02-30", "2026-13-01", "20261013", "2026-10-13T00:00", 20261013, {}].forEach(v => eq(ef.eastRefreshWindows(v), null, "P31B item 7: no window for " + JSON.stringify(v)));
  // the same windows in a child process under another time zone (the offsets proven first)
  const parentAll = JSON.stringify(days.map(d => ef.eastRefreshWindows(d)));
  ["America/Chicago", "Asia/Tokyo"].forEach(tz => {
    const r = cp.spawnSync(process.execPath, ["-e", [
      "const ef = require(process.argv[1]);",
      "const days = []; for (let d = ef.efParse('2025-12-01'); ef.efFmt(d) <= '2028-12-31'; d = ef.efAddD(d, 1)) days.push(ef.efFmt(d));",
      "process.stdout.write(JSON.stringify({ jan: new Date(2026, 0, 15).getTimezoneOffset(), jul: new Date(2026, 6, 15).getTimezoneOffset(), all: JSON.stringify(days.map(d => ef.eastRefreshWindows(d))) }));",
    ].join("\n"), path.join(ROOT, "east-feed.js")], { env: Object.assign({}, process.env, { TZ: tz }), encoding: "utf8" });
    ok(r.status === 0, "P31B item 7: the " + tz + " child ran: " + (r.stderr || "").slice(0, 300));
    const out = JSON.parse(r.stdout);
    eq([out.jan, out.jul], tz === "Asia/Tokyo" ? [-540, -540] : [360, 300], "P31B item 7: the child really runs in " + tz);
    ok(out.all === parentAll, "P31B item 7: the windows under TZ=" + tz + " equal this process's for every day");
  });

  // ---- eastExtraWeeks: what the extra leg caches ----
  const win = ef.eastRefreshWindows("2026-10-13");   // main 2026-09-14..2027-04-12, extra 2025-10-13..2029-10-08
  const wk = (m, extra) => ({ weekMonday: m, data: Object.assign({ dayCall: "s6" }, extra || {}) });
  const mondays = (from, to) => { const out = []; for (let d = H.parse(from); H.fmt(d) <= to; d = H.addD(d, 7)) out.push(H.fmt(d)); return out; };
  const ms = (r) => r.weeks.map(w => w.weekMonday);
  // today's live shape: Davenport publishes 2025-12-29..2026-11-09; the main read returns its part, the extra read all
  const mainLive = mondays("2026-09-14", "2026-11-09").map(m => wk(m));
  const extraLive = mondays("2025-12-29", "2026-11-09").map(m => wk(m));
  const live = ef.eastExtraWeeks(mainLive, extraLive, win);
  eq(ms(live), mondays("2025-12-29", "2026-09-07"), "P31B item 7: the live shape caches the 37 weeks before the main window (12/29/2025 .. 9/7/2026) and nothing the main read returned");
  eq([live.past, live.ahead, live.skipped], [37, 0, 0], "P31B item 7: counts past / ahead / skipped");
  ok(live.weeks.every(w => w.data && w.data.vacations === undefined), "P31B item 7: the selection writes no vacations key (weeks only)");
  // ahead: contiguous with the main read's last week (main.to here), stop at the first missing Monday
  const mainFull = mondays("2026-09-14", "2027-04-12").map(m => wk(m));
  const ahead = ef.eastExtraWeeks(mainFull, [wk("2027-04-19"), wk("2027-04-26"), wk("2027-05-10"), wk("2027-05-17")], win);
  eq(ms(ahead), ["2027-04-19", "2027-04-26"], "P31B item 7 (critic 9): weeks after the main window are kept only while contiguous - 5/3 is missing, so 5/10 and 5/17 are not cached");
  eq([ahead.past, ahead.ahead, ahead.skipped], [0, 2, 2], "P31B item 7 (critic 9): the two weeks past the gap are counted as skipped");
  // the main read's last week inside its window: any week after main.to is past a gap
  const far = ef.eastExtraWeeks(mainLive, extraLive.concat([wk("2027-04-19"), wk("2027-06-07")]), win);
  eq(ms(far), mondays("2025-12-29", "2026-09-07"), "P31B item 7 (critic 9): Davenport's last published week inside the main window -> no week after the main window is cached");
  eq(far.skipped, 2, "P31B item 7 (critic 9): ...both counted as skipped");
  // the main read returned nothing -> nothing ahead (no week to be contiguous with); the weeks before are still cached
  const none = ef.eastExtraWeeks([], [wk("2026-01-05"), wk("2027-04-19")], win);
  eq([ms(none), none.skipped], [["2026-01-05"], 1], "P31B item 7: an empty main read caches nothing ahead");
  // what never reaches the extra leg's upsert
  const mixed = ef.eastExtraWeeks(mainLive, [
    wk("2026-10-05"),                                   // the main read returned it (the smoke's mock answers it to both reads)
    wk("2026-12-07"),                                   // inside the main window but not in the main read: the main leg's business
    { weekMonday: "2026-01-12", data: { isForecast: true } }, // a forecast row
    { weekMonday: "2026/01/19", data: {} }, null, { data: {} }, // malformed
    wk("2025-10-06"),                                   // before extra.from
    wk("2026-02-02"), wk("2026-02-02", { dayCall: "s2" }), // a duplicate Monday: the first one wins
    wk("2026-01-26"),
  ], win);
  eq(ms(mixed), ["2026-01-26", "2026-02-02"], "P31B item 7: never a main-read week, a main-window week, a forecast row, a malformed row, a week outside the extra window or a duplicate; sorted");
  eq(mixed.weeks[1].data.dayCall, "s6", "P31B item 7: the first copy of a duplicate Monday wins");
  // a week the main read returned OUTSIDE its window (the smoke's Davenport mock answers its one week to every read; after
  // 11/2/2026 that week lies before the main window) is the main leg's: never upserted a second time
  const odd = ef.eastExtraWeeks([wk("2026-08-31")], [wk("2026-08-31"), wk("2026-08-24")], win);
  eq([ms(odd), odd.past], [["2026-08-24"], 1], "P31B item 7: a week the main read returned is never in the extra upsert, even outside the main window");
  const pastAfter = ef.eastExtraWeeks(mainFull, [wk("2029-10-15")], win);
  eq([ms(pastAfter), pastAfter.skipped], [[], 0], "P31B item 7: a week after extra.to is outside the window (not a gap skip)");
  // never mutates its inputs; bad input -> nothing
  const mIn = mainLive.map(w => JSON.stringify(w)).join("|"), xIn = extraLive.map(w => JSON.stringify(w)).join("|");
  ef.eastExtraWeeks(mainLive, extraLive, win);
  ok(mainLive.map(w => JSON.stringify(w)).join("|") === mIn && extraLive.map(w => JSON.stringify(w)).join("|") === xIn, "P31B item 7: eastExtraWeeks never mutates its inputs");
  eq(ef.eastExtraWeeks(mainLive, extraLive, null), { weeks: [], past: 0, ahead: 0, skipped: 0 }, "P31B item 7: no windows -> nothing");
  eq(ef.eastExtraWeeks(null, null, win), { weeks: [], past: 0, ahead: 0, skipped: 0 }, "P31B item 7: no weeks -> nothing");
}
// ---- Prompt 31 Part A (A3, critic A7): the silent-empty guard of the in-app refresh (the server refresh mirrors it) ----
// eastVacationReadGuard(feed, cachedRows, codes, from) -> { ok, problems }: the vacation leg of a refresh is trusted only
// when the time_off read worked, every code resolved, a list came back for every code and no code answered 0 ranges while
// the cache holds ranges of it inside the read's window [from, feed.vacationsTo] (an RLS-blocked read answers 200 + []).
{
  ok(typeof ef.eastVacationReadGuard === "function" && typeof ef.eastGuardText === "function", "P31A A3: east-feed.js exports eastVacationReadGuard and eastGuardText");
  const cache = [
    { week_monday: "2026-08-03", data: { vacations: [{ code: "FAK", start: "2026-08-03", end: "2026-08-07" }] } },
    { week_monday: "2026-10-26", data: { vacations: [{ code: "FAK", start: "2026-10-26", end: "2026-10-29" }, { code: "MAB", start: "2026-10-27", end: "2026-10-28" }] } },
    { week_monday: "2026-11-02", data: { isForecast: true, vacations: [{ code: "XYZ", start: "2026-11-03", end: "2026-11-04" }] } },
  ];
  const feed = (over) => Object.assign({ weeks: [], vacations: { FAK: [{ start: "2026-10-26", end: "2026-10-30" }] }, vacationsError: null, vacationsTo: "2028-04-17", vacationCodesUnresolved: [] }, over);
  const g = (f, codes, from) => ef.eastVacationReadGuard(f, cache, codes, from || "2026-09-14");
  eq(g(feed(), ["FAK"]), { ok: true, problems: [] }, "P31A A3 guard: a normal read is trusted");
  eq(g(feed({ vacations: { FAK: [] } }), ["FAK"]), { ok: false, problems: [{ code: "FAK", why: "empty-while-cached", cached: 1 }] }, "P31A A3 guard: 0 ranges while the cache holds 2026-10-26..29 in the window -> NOT trusted");
  eq(g(feed({ vacations: { FAK: [] } }), ["FAK"], "2026-11-02").ok, true, "P31A A3 guard: the cached range ends before the read's window -> a real 'no vacations'");
  eq(g(feed({ vacations: { FAK: [] }, vacationsTo: "2026-10-25" }), ["FAK"]).ok, true, "P31A A3 guard: the cached range starts after the read's horizon -> trusted");
  eq(ef.eastVacationReadGuard(feed({ vacations: { FAK: [] } }), [], ["FAK"], "2026-09-14").ok, true, "P31A A3 guard: an empty cache -> trusted");
  eq(g(feed({ vacations: null, vacationsError: "east-feed: GET time_off failed: HTTP 500" }), ["FAK"]).problems, [{ code: null, why: "read-failed", detail: "east-feed: GET time_off failed: HTTP 500" }], "P31A A3 guard: a failed read");
  eq(g(feed({ vacations: null, vacationCodesUnresolved: ["FAK"] }), ["fak"]).problems, [{ code: "FAK", why: "unresolved" }], "P31A A3 guard: an unresolved code (codes compared upper-cased)");
  eq(g(feed({ vacations: { FAK: [] } }), ["FAK", "MAB"]).problems.map(p => p.code + ":" + p.why), ["FAK:empty-while-cached", "MAB:missing"], "P31A A3 guard: per code - FAK empty while cached, MAB asked but no list came back");
  eq(g(feed({ vacations: { FAK: [{ start: "2026-10-26", end: "2026-10-30" }], MAB: [] } }), ["FAK", "MAB"]).problems, [{ code: "MAB", why: "empty-while-cached", cached: 1 }], "P31A A3 guard: the other code's empty answer trips on its own cached range");
  eq(g(feed({ vacations: { XYZ: [] } }), ["XYZ"]), { ok: true, problems: [] }, "P31A A3 guard: a forecast row's entries are not cache");
  eq(g(feed({ vacations: null }), []), { ok: true, problems: [] }, "P31A A3 guard: no codes -> nothing to guard");
  eq(g(feed({ vacations: { FAK: [] } }), ["FAK", "fak", ""]).problems.length, 1, "P31A A3 guard: a code asked twice (any case) or empty is one code");
  eq(ef.eastVacationReadGuard(null, cache, ["FAK"], "2026-09-14").problems, [{ code: "FAK", why: "missing" }], "P31A A3 guard: no feed at all -> nothing came back (never trusted)");
  const texts = [{ code: "FAK", why: "empty-while-cached", cached: 1 }, { code: null, why: "read-failed", detail: "HTTP 500" }, { code: "FAK", why: "unresolved" }, { code: "MAB", why: "missing" }].map(ef.eastGuardText);
  texts.forEach(t => ok(typeof t === "string" && t.length > 20 && t.length <= 200 && /kept/.test(t) && /no review (is )?reset/.test(t), "P31A A3 guard text: says the cache is kept and no review is reset (<= 200 characters): " + t));
  ok(texts[0].indexOf("FAK") >= 0 && texts[2].indexOf("FAK") >= 0 && texts[3].indexOf("MAB") >= 0, "P31A A3 guard text: names the code");
}
// Prompt 31 Part A review (10/18): the guard's window EDGES. A cached range counts when it overlaps the read's window
// [from, vacationsTo]: one that STRADDLES from (a vacation over the main window's Monday - Davenport is read from `from` on, and
// the range began before it; the cache holds it in the week before the window too) or straddles vacationsTo, or touches an edge
// with its last / first day, keeps the cache; one that ends the day before from or starts the day after vacationsTo lies outside
// what the read could see. Every earlier fixture kept its cached ranges wholly inside or wholly outside the window, so the mutants
// r.start >= from, r.end <= to, r.end > from and r.start < to - applied to east-feed.js and the server's @eastRefresh copy
// together - passed every suite (test/edge-functions.test.js carries the same fixtures and a handler run of the straddling range).
{
  const FROM = "2026-09-14", TO = "2028-04-17";
  const feed = (over) => Object.assign({ weeks: [], vacations: { FAK: [] }, vacationsError: null, vacationsTo: TO, vacationCodesUnresolved: [] }, over);
  // a range as the cache holds it: the same entry in every cached week it touches (attachVacationsToWeeks)
  const held = (mondays, start, end) => mondays.map(m => ({ week_monday: m, data: { vacations: [{ code: "FAK", start, end }] } }));
  const g = (cache, over) => ef.eastVacationReadGuard(feed(over), cache, ["FAK"], FROM);
  const KEPT = { ok: false, problems: [{ code: "FAK", why: "empty-while-cached", cached: 1 }] };
  const TRUSTED = { ok: true, problems: [] };
  eq(g(held(["2026-09-07", "2026-09-14"], "2026-09-10", "2026-09-16")), KEPT, "P31A review guard edge: FAK 09-10..09-16 straddles from (09-14; held by 09-07 and 09-14) and Davenport answers [] -> NOT trusted (the range is in the window from 09-14 on)");
  eq(g(held(["2026-09-07"], "2026-09-10", "2026-09-16")), KEPT, "P31A review guard edge: the same range held by the week before the window alone -> NOT trusted (the guard counts ranges, not the weeks holding them)");
  eq(g(held(["2026-09-07", "2026-09-14"], "2026-09-10", "2026-09-14")), KEPT, "P31A review guard edge: a range whose last day IS from -> NOT trusted");
  eq(g(held(["2026-09-07"], "2026-09-08", "2026-09-13")), TRUSTED, "P31A review guard edge: a range ending the day before from -> trusted (the read could not see it)");
  eq(g(held(["2027-04-05"], "2028-04-15", "2028-04-20")), KEPT, "P31A review guard edge: a range straddling vacationsTo (2028-04-17) -> NOT trusted");
  eq(g(held(["2027-04-05"], "2028-04-17", "2028-04-20")), KEPT, "P31A review guard edge: a range whose first day IS vacationsTo -> NOT trusted");
  eq(g(held(["2027-04-05"], "2028-04-18", "2028-04-20")), TRUSTED, "P31A review guard edge: a range starting the day after vacationsTo -> trusted (past the read's horizon)");
  eq(g(held(["2026-09-07", "2026-09-14"], "2026-09-01", "2028-05-01")), KEPT, "P31A review guard edge: a range spanning the whole window -> NOT trusted");
  eq(g(held(["2026-09-07", "2026-09-14"], "2026-09-10", "2026-09-16"), { vacationsTo: null }), KEPT, "P31A review guard edge: no vacationsTo (no upper bound) - the range straddling from still counts");
}
// ---- Prompt 34 (Faraz 11/11): the East week lists - Fierce's weeks for the weeks Davenport has not published ----
// The Davenport blob holds two lists of Mondays, unsorted, past weeks mixed in: backupMondays (the list behind isBackup:
// Fierce East PRIMARY -> Silvis BACKUP all week) and fierceBackup (behind isFierceBackup: Fierce East BACKUP -> Silvis
// PRIMARY all week). Both refreshes read them from the roster blob they already read, cache them in the payload of the
// main-window east_feed rows (data.eastLists, beside data.vacations) and deriveFierceWeeks reads published > list > stated.
{
  ["eastListsFromBlob", "eastCachedLists", "eastListsGuard", "eastListsGuardText", "eastListsPlan", "eastAttachLists", "deriveFierceWeeksDetail", "efIsMonday"]
    .forEach(k => ok(typeof ef[k] === "function", "P34: east-feed.js exports " + k));

  // -- parsing: valid Mondays only, the rest dropped and named; order and duplicates do not matter
  const blob = {
    surgeons: [{ id: "s6", name: "FAK" }],
    backupMondays: ["2027-04-19", "2026-11-09", "2027-01-04", "2027-02-22", "2027-01-04", "2027-02-23", "2027-02-30", 42, null, "next Monday"],
    fierceBackup: ["2027-05-24", "2026-12-07", "2027-03-29", "2027-02-01"],
  };
  const read = ef.eastListsFromBlob(blob);
  eq(read.eastPrimary, ["2026-11-09", "2027-01-04", "2027-02-22", "2027-04-19"], "P34 parse: backupMondays -> eastPrimary (Fierce East PRIMARY), sorted, the duplicate once, only real Mondays");
  eq(read.eastBackup, ["2026-12-07", "2027-02-01", "2027-03-29", "2027-05-24"], "P34 parse: fierceBackup -> eastBackup (Fierce East BACKUP), sorted from an unsorted list");
  eq(read.problems, [], "P34 parse: both keys are arrays - no key problem");
  eq(read.dropped.map(d => d.list), ["backupMondays", "backupMondays", "backupMondays", "backupMondays", "backupMondays"], "P34 parse: five entries dropped, each naming its list");
  eq(read.dropped.map(d => d.value), ["2027-02-23", "2027-02-30", "42", "null", "next Monday"], "P34 parse: a Tuesday, a day that does not exist, a number, null and text are dropped (values as short text)");
  ok(read.dropped.every(d => typeof d.value === "string" && d.value.length <= 24), "P34 parse: a dropped value is short text, never the raw entry");
  eq(ef.eastListsFromBlob({ backupMondays: ["x".repeat(500)], fierceBackup: [] }).dropped[0].value.length, 24, "P34 parse: a long junk entry is cut to 24 characters");
  eq(ef.eastListsFromBlob({ fierceBackup: ["2027-02-01"] }), { eastPrimary: null, eastBackup: ["2027-02-01"], problems: [{ list: "backupMondays", why: "missing" }], dropped: [] }, "P34 parse: a missing key is unknown (null), never an empty list");
  eq(ef.eastListsFromBlob({ backupMondays: null, fierceBackup: { "2027-02-01": true } }).problems, [{ list: "backupMondays", why: "missing" }, { list: "fierceBackup", why: "not-array" }], "P34 parse: null is missing, an object is not an array");
  eq(ef.eastListsFromBlob({ backupMondays: "2027-01-04", fierceBackup: [] }), { eastPrimary: null, eastBackup: [], problems: [{ list: "backupMondays", why: "not-array" }], dropped: [] }, "P34 parse: a string is not an array; an empty array is a real empty list");
  eq(ef.eastListsFromBlob(null).problems, [{ list: "backupMondays", why: "missing" }, { list: "fierceBackup", why: "missing" }], "P34 parse: no blob - both missing");
  ok(ef.efIsMonday("2027-01-04") && !ef.efIsMonday("2027-01-05") && !ef.efIsMonday("2027-02-30") && !ef.efIsMonday("2027-1-4") && !ef.efIsMonday(null), "P34: efIsMonday - a real date that is a Monday");

  // -- the cached copy: the newest readAt among the rows; forecast rows and malformed copies never count
  const L0 = { eastPrimary: ["2027-02-22", "2027-04-19"], eastBackup: ["2027-03-29", "2027-05-24"], readAt: "2026-11-12T10:30:08.000Z", dropped: 0 };
  const L1 = { eastPrimary: ["2027-02-22"], eastBackup: ["2027-03-29"], readAt: "2026-11-11T10:30:08.000Z", dropped: 0 };
  const row = (m, data) => ({ week_monday: m, data: data || {} });
  const cacheRows = [row("2027-01-04", { isBackup: true, eastLists: L1 }), row("2027-01-11", { eastLists: L0 }), row("2027-01-18", { eastLists: L0 }), row("2027-02-01", { isFierceBackup: true }),
    row("2027-03-01", { isForecast: true, eastLists: { eastPrimary: ["2027-12-06"], eastBackup: [], readAt: "2027-01-01T00:00:00.000Z" } }),
    row("2026-12-28", { eastLists: { eastPrimary: "2027-02-22", eastBackup: [], readAt: "2026-12-31T00:00:00.000Z" } }), row("2026-12-21", { eastLists: { eastPrimary: [], eastBackup: [] } })];
  eq(ef.eastCachedLists(cacheRows), L0, "P34 cache: the copy with the newest readAt wins; a forecast row's copy, a copy with a non-array list and one without readAt are skipped");
  eq(ef.eastCachedLists(cacheRows.map(r => ({ weekMonday: r.week_monday, data: r.data }))), L0, "P34 cache: the app's { weekMonday, data } rows read the same");
  eq(ef.eastCachedLists([row("2027-01-04", { isBackup: true })]), null, "P34 cache: no copy in the cache -> null (unknown), never empty lists");
  eq(ef.eastCachedLists(null), null);
  // review C (11/11): two copies carrying ONE readAt (two writers in the same millisecond) - the first row's stands
  const sameAt = [row("2027-01-04", { eastLists: { eastPrimary: ["2027-02-22"], eastBackup: [], readAt: "2026-11-12T10:30:08.000Z" } }), row("2027-01-11", { eastLists: { eastPrimary: ["2027-04-19"], eastBackup: [], readAt: "2026-11-12T10:30:08.000Z" } })];
  eq(ef.eastCachedLists(sameAt).eastPrimary, ["2027-02-22"], "P34 cache: two copies with one readAt - the first row's stands");
  ok(ef.eastCachedLists(cacheRows) !== L0 && ef.eastCachedLists(cacheRows).eastPrimary !== L0.eastPrimary, "P34 cache: a copy is returned, never the row's own object");

  // -- the read guard. Published weeks: 11/9 + 1/4 carry isBackup, 12/7 + 2/1 isFierceBackup (through 2/15); the cache
  //    holds the upcoming weeks 2/22 + 4/19 (eastPrimary) and 3/29 + 5/24 (eastBackup); today 2026-11-23.
  const pub = [row("2026-11-09", { isBackup: true }), row("2026-11-16"), row("2026-12-07", { isFierceBackup: true }), row("2027-01-04", { isBackup: true }), row("2027-02-01", { isFierceBackup: true }), row("2027-02-15")];
  const TODAY = "2026-11-23";
  const full = { eastPrimary: ["2026-11-09", "2027-01-04", "2027-02-22", "2027-04-19"], eastBackup: ["2026-12-07", "2027-02-01", "2027-03-29", "2027-05-24"], problems: [], dropped: [] };
  const rd = (over) => Object.assign({}, full, over);
  const g = (r, c, w, t) => ef.eastListsGuard(r, c === undefined ? L0 : c, w || pub, t || TODAY);
  eq(g(full), { ok: true, problems: [] }, "P34 guard: a read that holds everything cached is trusted");
  eq(g(rd({ eastPrimary: full.eastPrimary.concat(["2027-06-21"]) })), { ok: true, problems: [] }, "P34 guard: a new week is trusted");
  eq(g(rd({ eastPrimary: null, problems: [{ list: "backupMondays", why: "missing" }] })), { ok: false, problems: [{ list: "backupMondays", why: "missing" }] }, "P34 guard: a missing key keeps the cache");
  eq(g(rd({ eastBackup: null, problems: [{ list: "fierceBackup", why: "not-array" }] })).problems, [{ list: "fierceBackup", why: "not-array" }], "P34 guard: a non-array keeps the cache");
  eq(g(null).problems, [{ list: "backupMondays", why: "missing" }, { list: "fierceBackup", why: "missing" }], "P34 guard: no read at all - nothing came back, never trusted");
  // a legitimate edit: 4/19 leaves the list, every published isBackup week is still on it -> clearly healthy
  eq(g(rd({ eastPrimary: ["2026-11-09", "2027-01-04", "2027-02-22"] })), { ok: true, problems: [] }, "P34 guard: a lost upcoming week is accepted when the list still holds every week Davenport published with that flag");
  // the same loss, but the list also lost the published 1/4 -> not healthy
  eq(g(rd({ eastPrimary: ["2026-11-09", "2027-02-22"] })), { ok: false, problems: [{ list: "backupMondays", why: "lost-week", weeks: ["2027-04-19"], unmatched: ["2027-01-04"], published: 2 }] }, "P34 guard: a lost upcoming week is NOT accepted when the list lacks a week Davenport published with that flag (names both)");
  eq(g(rd({ eastPrimary: [] })), { ok: false, problems: [{ list: "backupMondays", why: "empty-while-cached", weeks: ["2027-02-22", "2027-04-19"], unmatched: ["2026-11-09", "2027-01-04"], published: 2 }] }, "P34 guard: an empty list while the cache holds upcoming weeks keeps the cache - it can never be clearly healthy");
  eq(g(rd({ eastPrimary: [], eastBackup: [] })).problems.map(p => p.list + ":" + p.why), ["backupMondays:empty-while-cached", "fierceBackup:empty-while-cached"], "P34 guard: both lists wiped - both named");
  // no published week carries the flag at all: nothing to check the list against -> not clearly healthy
  const noWitness = pub.map(r => row(r.week_monday, Object.assign({}, r.data, { isBackup: false })));
  eq(g(rd({ eastPrimary: ["2027-02-22"] }), L0, noWitness), { ok: false, problems: [{ list: "backupMondays", why: "lost-week", weeks: ["2027-04-19"], unmatched: [], published: 0 }] }, "P34 guard: a loss with no published week to check the list against is not clearly healthy");
  // each list is judged by its own flag: eastBackup loses 5/24 and still holds 12/7 + 2/1 -> healthy, whatever isBackup says
  eq(g(rd({ eastBackup: ["2026-12-07", "2027-02-01", "2027-03-29"] }), L0, noWitness), { ok: true, problems: [] }, "P34 guard: fierceBackup is judged by the isFierceBackup weeks alone");
  eq(g(rd({ eastBackup: ["2027-02-01", "2027-03-29"] })).problems, [{ list: "fierceBackup", why: "lost-week", weeks: ["2027-05-24"], unmatched: ["2026-12-07"], published: 2 }], "P34 guard: ...and kept when it lacks the published 12/7");
  // a week Davenport has published is never a loss (the published row decides)
  const pub222 = pub.concat([row("2027-02-22", { isBackup: false })]);
  eq(g(rd({ eastPrimary: ["2027-04-19"] }), L0, pub222), { ok: true, problems: [] }, "P34 guard: 2/22 left the list but Davenport published that week - not a loss (and nothing else is lost)");
  eq(g(rd({ eastPrimary: [] }), L0, pub222).problems[0].weeks, ["2027-04-19"], "P34 guard: ...while 4/19, still unpublished, is");
  // a forecast row is not a published week: it neither settles a loss nor witnesses a list
  eq(g(rd({ eastPrimary: ["2026-11-09", "2027-01-04", "2027-04-19"] }), L0, pub.concat([row("2027-02-22", { isForecast: true, isBackup: true })])), { ok: true, problems: [] }, "P34 guard: (healthy) 2/22 lost, a forecast row for it changes nothing");
  eq(g(rd({ eastPrimary: ["2027-04-19"] }), L0, noWitness.concat([row("2027-02-22", { isForecast: true, isBackup: true }), row("2026-10-05", { isForecast: true, isBackup: true })])).problems[0], { list: "backupMondays", why: "lost-week", weeks: ["2027-02-22"], unmatched: [], published: 0 }, "P34 guard: a forecast row is neither a published week nor a witness");
  // only this week and later can be lost: a past cached Monday is not counted, the current week's Monday is
  const Lpast = { eastPrimary: ["2026-11-16", "2026-11-23", "2027-02-22"], eastBackup: [], readAt: "2026-11-22T10:30:00.000Z", dropped: 0 };
  eq(g(rd({ eastPrimary: [], eastBackup: [] }), Lpast, [row("2026-11-09", { isBackup: true })]).problems, [{ list: "backupMondays", why: "empty-while-cached", weeks: ["2026-11-23", "2027-02-22"], unmatched: ["2026-11-09"], published: 1 }], "P34 guard: 11/16 is past (today 11/23, a Monday); 11/23 - this week - and 2/22 count");
  eq(g(rd({ eastPrimary: [], eastBackup: [] }), Lpast, [row("2026-11-09", { isBackup: true })], "2026-11-29").problems[0].weeks, ["2026-11-23", "2027-02-22"], "P34 guard: on Sunday 11/29 the week of 11/23 is still this week");
  eq(g(rd({ eastPrimary: [], eastBackup: [] }), Lpast, [row("2026-11-09", { isBackup: true })], "2026-11-30").problems[0].weeks, ["2027-02-22"], "P34 guard: on Monday 11/30 it is past");
  // review C (11/11): with no valid today nothing is "past" - every cached Monday counts (the careful side)
  [null, undefined, "", "2026-11-31", "today"].forEach(t => eq(ef.eastListsGuard(rd({ eastPrimary: [], eastBackup: [] }), Lpast, [row("2026-11-09", { isBackup: true })], t).problems[0].weeks, ["2026-11-16", "2026-11-23", "2027-02-22"], "P34 guard: today " + JSON.stringify(t) + " - no week is read as past"));
  // first read: nothing cached, nothing can be lost - lists that name weeks are taken as they are...
  eq(g(full, null), { ok: true, problems: [] }, "P34 guard: no cache - the first read is taken");
  eq(g(rd({ eastPrimary: ["2027-02-22"] }), null), { ok: true, problems: [] }, "P34 guard: no cache - a list that lacks a published week is still taken (nothing is known to be lost; the published row decides that week)");
  // ...but an EMPTY list is never taken while a published week carries its flag (review C, 11/11): Davenport writes a list
  // and its week flags together and keeps past weeks on the list, so an empty list beside a flagged published week is a
  // wiped or reset blob - on a cache with no copy too (before the fix a wiped list was accepted there as "0 weeks", ok true)
  eq(g(rd({ eastPrimary: [], eastBackup: [] }), null), { ok: false, problems: [{ list: "backupMondays", why: "empty-while-published", weeks: [], unmatched: ["2026-11-09", "2027-01-04"], published: 2 }, { list: "fierceBackup", why: "empty-while-published", weeks: [], unmatched: ["2026-12-07", "2027-02-01"], published: 2 }] }, "P34 guard: no cache and two EMPTY lists while published weeks carry both flags - not trusted (never 'no Fierce weeks')");
  eq(g(rd({ eastPrimary: [] }), { eastPrimary: ["2026-11-09"], eastBackup: [], readAt: "x", dropped: 0 }).problems, [{ list: "backupMondays", why: "empty-while-published", weeks: [], unmatched: ["2026-11-09", "2027-01-04"], published: 2 }], "P34 guard: an empty list while the cache holds only past weeks of it - still not taken beside flagged published weeks");
  eq(g(rd({ eastBackup: [] }), { eastPrimary: full.eastPrimary, eastBackup: [], readAt: "x", dropped: 0 }).problems.map(p => p.list + ":" + p.why), ["fierceBackup:empty-while-published"], "P34 guard: each list is judged on its own flag");
  // an empty list with nothing against it is a real empty list: no cached upcoming week of it, no published week with its flag
  eq(g(rd({ eastPrimary: [] }), { eastPrimary: ["2026-11-09"], eastBackup: full.eastBackup, readAt: "x", dropped: 0 }, noWitness), { ok: true, problems: [] }, "P34 guard: an empty list when no published week carries its flag and the cache holds no upcoming week of it is taken");
  eq(g(rd({ eastPrimary: [], eastBackup: [] }), null, [row("2026-11-16"), row("2026-11-23")]), { ok: true, problems: [] }, "P34 guard: no cache, two empty lists and no flagged published week - a group that marks no weeks reads as two empty lists");
  eq(ef.eastListsGuard(rd({ eastPrimary: [], eastBackup: [] }), null, pub.map(r => Object.assign({}, r, { fetched_at: "2026-10-01T10:30:00.000Z" })), TODAY, "2026-11-23T10:30:05.000Z"), { ok: true, problems: [] }, "P34 guard: ...and a flagged row nobody re-read lately speaks for nothing here either (the refresh's time given)");
  eq(ef.eastListsGuard(rd({ eastPrimary: [], eastBackup: [] }), null, pub.map(r => Object.assign({}, r, { fetched_at: "2026-11-22T10:30:00.000Z" })), TODAY, "2026-11-23T10:30:05.000Z").problems.map(p => p.why), ["empty-while-published", "empty-while-published"], "P34 guard: ...while one re-read yesterday does");
  // -- review A (11/11): the clearly-healthy test counts only the published weeks this run can VOUCH for - the weeks it
  //    just fetched (they carry no fetched_at) and the cached rows a refresh re-read within 84 h before `now` (the fifth
  //    argument: the refresh's own time). A cached row nobody re-reads any more - older than the 12-month window, or a
  //    week Davenport no longer returns - keeps whatever flag it had: it must not refuse a legitimate edit for months,
  //    and it vouches for nothing. Without `now` every row counts (the readings above).
  const NOW = "2026-11-23T10:30:05.000Z";
  const at = (r, iso) => Object.assign({}, r, { fetched_at: iso });
  const g5 = (r, w, now) => ef.eastListsGuard(r, L0, w, TODAY, now);
  const legit = rd({ eastPrimary: ["2026-11-09", "2027-01-04", "2027-02-22"] });   // 4/19 unmarked; 11/9 and 1/4 (published with isBackup) still listed
  const staleFlag = at(row("2025-10-06", { isBackup: true }), "2025-11-20T10:30:00.000Z");   // last re-read a year ago; its Monday has left the list
  eq(g5(legit, pub.concat([staleFlag]), NOW), { ok: true, problems: [] }, "P34 guard (vouched rows): a cached row last re-read a year ago does not refuse a legitimate edit");
  eq(g5(legit, pub.concat([staleFlag])).problems, [{ list: "backupMondays", why: "lost-week", weeks: ["2027-04-19"], unmatched: ["2025-10-06"], published: 3 }], "P34 guard (vouched rows): ...without `now` every row counts, as before");
  eq(g5(legit, pub.concat([at(row("2026-10-05", { isBackup: true }), "2026-11-22T10:30:07+00:00")]), NOW).problems, [{ list: "backupMondays", why: "lost-week", weeks: ["2027-04-19"], unmatched: ["2026-10-05"], published: 3 }], "P34 guard (vouched rows): a cached row re-read yesterday counts - the list lacks its week, so the loss is kept");
  eq(g5(legit, pub.map(r => at(r, "2026-11-01T10:30:00.000Z")), NOW).problems, [{ list: "backupMondays", why: "lost-week", weeks: ["2027-04-19"], unmatched: [], published: 0 }], "P34 guard (vouched rows): when every flagged row is stale nothing vouches for the list - not clearly healthy");
  // the window is 84 h (the re-check, 11/11: 72 h sat exactly ON the third daily run - a read landing one second later in
  // its minute than the rows it follows found them stale, so "two missed runs" were not tolerated)
  eq(g5(legit, pub.map(r => at(r, "2026-11-20T10:29:58.000Z")), NOW), { ok: true, problems: [] }, "P34 guard (vouched rows): rows of the run three days ago (72 h and seven seconds - two daily runs missed) still count");
  eq(g5(legit, pub.map(r => at(r, "2026-11-19T22:30:05.000Z")), NOW), { ok: true, problems: [] }, "P34 guard (vouched rows): a row re-read exactly 84 h before still counts");
  eq(g5(legit, pub.map(r => at(r, "2026-11-19T22:30:04.999Z")), NOW).ok, false, "P34 guard (vouched rows): ...one millisecond older does not");
  eq(g5(legit, pub.map(r => at(r, "2026-11-19T10:30:00.000Z")), NOW).ok, false, "P34 guard (vouched rows): rows of the run four days ago (three missed) do not");
  eq(g5(legit, pub.map(r => at(r, "2026-11-25T00:00:00.000Z")), NOW), { ok: true, problems: [] }, "P34 guard (vouched rows): a row stamped after `now` (another device's clock) counts");
  eq([g5(legit, pub.map(r => at(r, "soon")), NOW).ok, g5(legit, pub.map(r => at(r, null)), NOW).ok, g5(legit, pub.map(r => at(r, 20261122)), NOW).ok], [false, false, false], "P34 guard (vouched rows): a fetched_at that is no time vouches for nothing");
  eq(g5(legit, pub.map(r => Object.assign({ fetchedAt: "2026-11-01T10:30:00.000Z" }, r)), NOW).ok, false, "P34 guard (vouched rows): the app's fetchedAt spelling reads the same");
  eq(g5(legit, pub.concat([staleFlag]), "not a time").ok, false, "P34 guard (vouched rows): a `now` that is no time reads as none given - every row counts");
  eq(g5(legit, [row("2025-10-06", { isBackup: false })].concat(pub, [staleFlag])), { ok: true, problems: [] }, "P34 guard (vouched rows): the first row of a week decides (the fetched weeks come first) - a later cached copy of it never counts");
  // (the re-check, 11/11: bound with a read that is NOT clearly healthy - it lacks the published 1/4 - so it is taken only
  // because 2/22 is no loss; with the list also holding 1/4 the read was healthy either way and proved nothing)
  const lacks14 = rd({ eastPrimary: ["2026-11-09", "2027-04-19"] });
  eq(g5(lacks14, pub.concat([at(row("2027-02-22", {}), "2025-01-01T00:00:00.000Z")]), NOW), { ok: true, problems: [] }, "P34 guard (vouched rows): a week ANY cached row publishes is no loss, however old the row (the published row decides the derived week either way)");
  eq(g5(lacks14, pub, NOW).problems, [{ list: "backupMondays", why: "lost-week", weeks: ["2027-02-22"], unmatched: ["2027-01-04"], published: 2 }], "P34 guard (vouched rows): ...without that row 2/22 IS lost, and the list, lacking the published 1/4, is kept");
  const texts =[{ list: "backupMondays", why: "missing" }, { list: "fierceBackup", why: "not-array" }, { list: "backupMondays", why: "empty-while-cached", weeks: ["2027-02-22", "2027-04-19"], unmatched: ["2026-11-09"], published: 2 },
    { list: "fierceBackup", why: "lost-week", weeks: ["2027-05-24"], unmatched: ["2026-12-07"], published: 2 }, { list: "backupMondays", why: "lost-week", weeks: ["2027-04-19"], unmatched: [], published: 0 },
    { list: "backupMondays", why: "empty-while-published", weeks: [], unmatched: ["2026-11-09", "2027-01-04"], published: 2 }].map(ef.eastListsGuardText);
  texts.forEach(t => ok(typeof t === "string" && t.length > 20 && t.length <= 200 && /kept/.test(t), "P34 guard text: says the cached lists are kept (<= 200 characters): " + t));
  ok(/backupMondays came back empty although 2 published week\(s\) carry its flag \(2026-11-09, 2027-01-04\)/.test(texts[5]), "P34 guard text: an empty list beside flagged published weeks names them: " + texts[5]);
  ok(/backupMondays/.test(texts[0]) && /fierceBackup/.test(texts[1]) && /2027-02-22/.test(texts[2]) && /2027-05-24/.test(texts[3]) && /2026-12-07/.test(texts[3]), "P34 guard text: names the list, the lost week and the published week the list lacks");
  ok(typeof ef.eastListsGuardText(null) === "string" && /kept/.test(ef.eastListsGuardText(null)), "P34 guard text: no problem object still says kept");

  // -- the write plan: trusted -> the fresh lists from the window's first Monday on; untrusted -> the cached copy, as it is
  const feedOf = (lists) => ({ weeks: pub.map(r => ({ weekMonday: r.week_monday, data: r.data })), fetchedAt: "2026-11-23T10:30:08.000Z", lists });
  const cacheL0 = pub.map(r => row(r.week_monday, Object.assign({}, r.data, { eastLists: L0 })));
  const p1 = ef.eastListsPlan(feedOf(rd({ dropped: [{ list: "backupMondays", value: "junk" }] })), cacheL0, TODAY, "2026-10-26");
  eq(p1.trusted, true);
  eq(p1.lists, { eastPrimary: ["2026-11-09", "2027-01-04", "2027-02-22", "2027-04-19"], eastBackup: ["2026-12-07", "2027-02-01", "2027-03-29", "2027-05-24"], readAt: "2026-11-23T10:30:08.000Z", dropped: 1 }, "P34 plan: a trusted read is cached with the refresh's time and the dropped count");
  eq(ef.eastListsPlan(feedOf(full), cacheL0, TODAY, "2026-12-07").lists.eastPrimary, ["2027-01-04", "2027-02-22", "2027-04-19"], "P34 plan: Mondays before the refresh window's first Monday are not cached");
  eq(ef.eastListsPlan(feedOf(full), cacheL0, TODAY, "2026-12-07").lists.eastBackup, ["2026-12-07", "2027-02-01", "2027-03-29", "2027-05-24"], "P34 plan: the window's own first Monday is");
  eq([p1.guard, p1.dropped], [[], [{ list: "backupMondays", value: "junk" }]], "P34 plan: the dropped entries ride along for the warning");
  const p2 = ef.eastListsPlan(feedOf(rd({ eastPrimary: [] })), cacheL0, TODAY, "2026-10-26");
  eq([p2.trusted, p2.lists, p2.guard.map(x => x.why)], [false, L0, ["empty-while-cached"]], "P34 plan: an untrusted read keeps BOTH cached lists as they are (their own readAt) - nothing new is taken");
  const p3 = ef.eastListsPlan(feedOf(null), cacheL0, TODAY, "2026-10-26");
  eq([p3.trusted, p3.lists, p3.guard.length], [false, L0, 2], "P34 plan: no lists in the feed (an older fetch) keeps the cache");
  const p4 = ef.eastListsPlan(feedOf(rd({ eastPrimary: null, problems: [{ list: "backupMondays", why: "missing" }] })), pub, TODAY, "2026-10-26");
  eq([p4.trusted, p4.lists], [false, null], "P34 plan: untrusted and nothing cached -> nothing to write (no key), never empty lists");
  const p5 = ef.eastListsPlan(feedOf(rd({ eastPrimary: ["2026-11-09", "2027-01-04", "2027-02-22"] })), cacheL0, TODAY, "2026-10-26");
  eq([p5.trusted, p5.lists.eastPrimary], [true, ["2026-11-09", "2027-01-04", "2027-02-22"]], "P34 plan: a clearly healthy loss is taken - the published weeks come from the fetched weeks and the cache rows");
  // review A (11/11): the plan hands the guard the refresh's own time - the fetched weeks vouch, a cached row no refresh
  // re-reads any more does not, one re-read yesterday does
  const cacheAged = cacheL0.map(r => Object.assign({}, r, { fetched_at: "2026-11-22T10:30:09+00:00" })).concat([Object.assign(row("2025-10-06", { isBackup: true }), { fetched_at: "2025-11-20T10:30:00+00:00" })]);
  const p6 = ef.eastListsPlan(feedOf(rd({ eastPrimary: ["2026-11-09", "2027-01-04", "2027-02-22"] })), cacheAged, TODAY, "2026-10-26");
  eq([p6.trusted, p6.guard, p6.lists.eastPrimary], [true, [], ["2026-11-09", "2027-01-04", "2027-02-22"]], "P34 plan (vouched rows): a flagged row last re-read a year ago does not refuse the edit");
  const p7 = ef.eastListsPlan(feedOf(rd({ eastPrimary: ["2026-11-09", "2027-01-04", "2027-02-22"] })), cacheAged.concat([Object.assign(row("2026-10-05", { isBackup: true }), { fetched_at: "2026-11-22T10:30:09+00:00" })]), TODAY, "2026-10-26");
  eq([p7.trusted, p7.guard.map(x => x.unmatched), p7.lists], [false, [["2026-10-05"]], L0], "P34 plan (vouched rows): ...a flagged row re-read yesterday that the list lacks still does (the cached lists are kept)");
  // review C (11/11): WHERE the published weeks come from, bound on each side - the fetched weeks and the cache rows, the
  // fetched copy of a week first. 4/19 leaves the list; the read is clearly healthy only if a witness (11/9, 1/4) is seen.
  const lossy = rd({ eastPrimary: ["2026-11-09", "2027-01-04", "2027-02-22"] }), FAT = "2026-11-23T10:30:08.000Z";
  const noFlagWeeks = [{ weekMonday: "2026-11-16", data: {} }, { weekMonday: "2027-02-15", data: {} }];
  const cacheNoFlag = [row("2026-11-16", { eastLists: L0 }), row("2027-02-15", { eastLists: L0 })];
  const appWeeks = (rows) => rows.map(r => ({ weekMonday: r.week_monday, data: r.data }));
  eq(ef.eastListsPlan({ weeks: noFlagWeeks, fetchedAt: FAT, lists: lossy }, cacheL0, TODAY, "2026-10-26").trusted, true, "P34 plan (witnesses): only the CACHE rows carry the flag - they vouch (the fetch returned other weeks)");
  eq(ef.eastListsPlan({ weeks: appWeeks(pub), fetchedAt: FAT, lists: lossy }, cacheNoFlag, TODAY, "2026-10-26").trusted, true, "P34 plan (witnesses): only the FETCHED weeks carry the flag - they vouch (a week published since the last refresh)");
  eq(ef.eastListsPlan({ weeks: noFlagWeeks, fetchedAt: FAT, lists: lossy }, cacheNoFlag, TODAY, "2026-10-26").guard.map(x => x.why + ":" + x.published), ["lost-week:0"], "P34 plan (witnesses): neither side carries the flag - the loss is kept");
  // the two sides disagree about one week: the FETCHED copy decides (a Monday counts once, the first)
  const unflagged14 = appWeeks(pub).map(w => (w.weekMonday === "2027-01-04" ? { weekMonday: w.weekMonday, data: { isBackup: false } } : w));
  eq(ef.eastListsPlan({ weeks: unflagged14, fetchedAt: FAT, lists: rd({ eastPrimary: ["2026-11-09", "2027-02-22"] }) }, cacheL0, TODAY, "2026-10-26").trusted, true, "P34 plan (witnesses): Davenport unflagged 1/4 and dropped it from the list - the fetched row decides, the cache's older copy of that week does not refuse the read");
  const flagged1116 = appWeeks(pub).map(w => (w.weekMonday === "2026-11-16" ? { weekMonday: w.weekMonday, data: { isBackup: true } } : w));
  eq(ef.eastListsPlan({ weeks: flagged1116, fetchedAt: FAT, lists: lossy }, cacheL0, TODAY, "2026-10-26").guard.map(x => x.unmatched), [["2026-11-16"]], "P34 plan (witnesses): ...and a week the fetch NOW shows flagged, which the list lacks, refuses it whatever the cache's copy says");

  // -- attach: every published week the refresh writes carries the copy; a forecast row never; null writes no key
  const fetched = [{ weekMonday: "2027-01-04", data: { isBackup: true, dayCall: "s1" } }, { weekMonday: "2027-01-11", data: { dayCall: "s2", vacations: [] } }, { weekMonday: "2027-03-01", data: { isForecast: true } }];
  const att = ef.eastAttachLists(fetched, L0);
  eq(att.map(w => w.data.eastLists), [L0, L0, undefined], "P34 attach: both published weeks carry the lists, the forecast row does not");
  eq([att[0].data.dayCall, att[1].data.vacations], ["s1", []], "P34 attach: the week's own payload stays");
  ok(att[0].data.eastLists !== L0 && att[0].data.eastLists !== att[1].data.eastLists && fetched[0].data.eastLists === undefined, "P34 attach: each row gets its own copy; the input is never changed");
  eq(ef.eastAttachLists(fetched, null).map(w => w.data.eastLists), [undefined, undefined, undefined], "P34 attach: nothing to attach -> no key written");
  eq(ef.eastAttachLists(null, L0), []);

  // -- precedence: a published week first, then the lists, then Setup's stated weeks
  const feed34 = [{ weekMonday: "2027-01-04", data: { isBackup: true } }, { weekMonday: "2027-01-11", data: {} }, { weekMonday: "2027-02-01", data: { isFierceBackup: true } }, { weekMonday: "2027-02-08", data: {} }];
  const lists34 = { eastPrimary: ["2027-04-19", "2027-02-22", "2027-01-11", "2027-06-21"], eastBackup: ["2027-05-24", "2027-03-29", "2027-02-08", "2027-06-21"] };
  const stated34 = { eastPrimary: ["2027-03-29", "2027-07-19", "2027-02-22"], eastBackup: ["2027-01-11", "2027-08-02", "2027-04-19"] };
  const d34 = ef.deriveFierceWeeksDetail(feed34, { listedWeeks: lists34, statedWeeks: stated34 });
  eq(d34.weeks.map(w => w.weekMonday + ":" + w.silvisRole + ":" + w.source), [
    "2027-01-04:backup:feed",    // published isBackup
    "2027-02-01:primary:feed",   // published isFierceBackup
    "2027-02-22:backup:list",    // listed (East primary) and stated the same way: the list is the source
    "2027-03-29:primary:list",   // listed East backup; stated East primary -> the list stands
    "2027-04-19:backup:list",    // listed East primary; stated East backup -> the list stands
    "2027-05-24:primary:list",
    "2027-06-21:backup:list",    // in BOTH lists -> read as East primary (Silvis backup), as a published row with both flags reads
    "2027-07-19:backup:stated",  // only stated: the manual override for a week the lists do not name
    "2027-08-02:primary:stated",
  ], "P34 precedence: published > list > stated, sorted, from unsorted lists; 1/11 and 2/8 are published unflagged, so neither the list nor the stated week derives them");
  eq(d34.warnings, [
    { weekMonday: "2027-03-29", why: "list-vs-stated", stands: "primary", stated: "backup" },
    { weekMonday: "2027-04-19", why: "list-vs-stated", stands: "backup", stated: "primary" },
    { weekMonday: "2027-06-21", why: "both-lists", stands: "backup" },
  ], "P34 precedence: a list week whose stated role differs and a Monday in both lists are warnings, sorted by week; an agreeing stated week (2/22) and a published week are not");
  eq(ef.deriveFierceWeeks(feed34, { listedWeeks: lists34, statedWeeks: stated34 }), d34.weeks, "P34: deriveFierceWeeks is the detail's weeks");
  const d34from = ef.deriveFierceWeeksDetail(feed34, { listedWeeks: lists34, statedWeeks: stated34, deriveFrom: "2027-04-19" });
  eq([d34from.weeks.map(w => w.weekMonday), d34from.warnings.map(w => w.weekMonday)], [["2027-04-19", "2027-05-24", "2027-06-21", "2027-07-19", "2027-08-02"], ["2027-04-19", "2027-06-21"]], "P34: deriveFrom still applies - weeks and warnings before it are dropped");
  eq(d34.weeks.map(w => w.weekMonday).join(), d34.weeks.map(w => w.weekMonday).slice().sort().join(), "P34: sorted whatever the order of the lists");
  // by default the lists are the copy the cache rows carry - no caller passes them, none can forget them
  const carried = ef.eastAttachLists(feed34, { eastPrimary: ["2027-02-22"], eastBackup: ["2027-03-29"], readAt: "2026-11-23T10:30:08.000Z", dropped: 0 });
  eq(ef.deriveFierceWeeks(carried, { deriveFrom: "2026-11-02" }).map(w => w.weekMonday + ":" + w.silvisRole + ":" + w.source), ["2027-01-04:backup:feed", "2027-02-01:primary:feed", "2027-02-22:backup:list", "2027-03-29:primary:list"], "P34: the lists are read from the rows themselves (data.eastLists)");
  eq(ef.deriveFierceWeeks(carried, { listedWeeks: null }).map(w => w.source), ["feed", "feed"], "P34: listedWeeks null = no lists (the rows' copy is not read)");
  eq(ef.deriveFierceWeeksDetail(carried).lists.readAt, "2026-11-23T10:30:08.000Z", "P34: the detail says which copy it read (Setup shows when the lists were last read)");
  eq(ef.deriveFierceWeeksDetail(feed34).lists, null, "P34: no copy -> lists null");
  eq(ef.deriveFierceWeeks(feed34, { listedWeeks: { eastPrimary: ["2027-02-23", "junk", null], eastBackup: "2027-03-29" } }).map(w => w.weekMonday), ["2027-01-04", "2027-02-01"], "P34: a list entry that is no Monday, or a list that is no array, derives nothing");
  // a forecast row is not a published week: it never suppresses a listed week
  eq(ef.deriveFierceWeeks(feed34.concat([{ weekMonday: "2027-02-22", data: { isForecast: true } }]), { listedWeeks: lists34 }).filter(w => w.weekMonday === "2027-02-22"), [{ weekMonday: "2027-02-22", silvisRole: "backup", source: "list" }], "P34: a cached forecast week never suppresses a listed week");
  // two stated lists naming one Monday read as before Prompt 34 (the East backup entry wins), no warning
  eq(ef.deriveFierceWeeksDetail([], { statedWeeks: { eastPrimary: ["2027-07-19"], eastBackup: ["2027-07-19"] } }), { weeks: [{ weekMonday: "2027-07-19", silvisRole: "primary", source: "stated" }], warnings: [], lists: null }, "P34: stated weeks alone read exactly as before");
  // review A (11/11): rows in the cache's own spelling (week_monday) are published weeks too - a published week missed for
  // its spelling would let a list (whose copy IS read from such rows) replace it
  const feedDb = feed34.map(w => ({ week_monday: w.weekMonday, data: w.data }));
  eq(ef.deriveFierceWeeksDetail(feedDb, { listedWeeks: { eastPrimary: ["2027-02-01", "2027-02-22"], eastBackup: ["2027-01-04"] } }).weeks.map(w => w.weekMonday + ":" + w.silvisRole + ":" + w.source), ["2027-01-04:backup:feed", "2027-02-01:primary:feed", "2027-02-22:backup:list"], "P34: east_feed-shaped rows (week_monday) read as published weeks - a list never replaces one");
  eq(ef.deriveFierceWeeks(ef.toEastFeedRows(carried), { deriveFrom: "2026-11-02" }), ef.deriveFierceWeeks(carried, { deriveFrom: "2026-11-02" }), "P34: ...and the rows' own copy of the lists derives the same in both spellings");

  // -- the failed-read keep, end to end: refresh 1 caches the lists; refresh 2's blob lacks a key -> the rows it writes
  //    carry the old copy, and the derived weeks do not change. Never "no Fierce weeks".
  const blobOk = { backupMondays: ["2027-02-22", "2026-11-09", "2027-01-04", "2027-04-19"], fierceBackup: ["2027-03-29", "2026-12-07", "2027-02-01", "2027-05-24"] };
  const fetchedWeeks = pub.map(r => ({ weekMonday: r.week_monday, data: r.data }));
  const r1 = ef.eastListsPlan({ weeks: fetchedWeeks, fetchedAt: "2026-11-23T10:30:08.000Z", lists: ef.eastListsFromBlob(blobOk) }, [], TODAY, "2026-10-26");
  const cache1 = ef.toEastFeedRows(ef.eastAttachLists(fetchedWeeks, r1.lists));
  const derived1 = ef.deriveFierceWeeks(cache1.map(r => ({ weekMonday: r.week_monday, data: r.data })), { deriveFrom: "2026-11-02" }).map(w => w.weekMonday + ":" + w.silvisRole + ":" + w.source);
  eq(derived1, ["2026-11-09:backup:feed", "2026-12-07:primary:feed", "2027-01-04:backup:feed", "2027-02-01:primary:feed", "2027-02-22:backup:list", "2027-03-29:primary:list", "2027-04-19:backup:list", "2027-05-24:primary:list"], "P34 keep: refresh 1 - the four published weeks and the four listed ones");
  [{ fierceBackup: blobOk.fierceBackup }, { backupMondays: "oops", fierceBackup: blobOk.fierceBackup }, { backupMondays: [], fierceBackup: [] }, { backupMondays: ["2026-11-09", "2027-02-22"], fierceBackup: blobOk.fierceBackup }].forEach((bad, i) => {
    const r2 = ef.eastListsPlan({ weeks: fetchedWeeks, fetchedAt: "2026-11-24T10:30:08.000Z", lists: ef.eastListsFromBlob(bad) }, cache1, "2026-11-24", "2026-10-26");
    const cache2 = ef.toEastFeedRows(ef.eastAttachLists(fetchedWeeks, r2.lists));
    eq([r2.trusted, r2.lists.readAt], [false, "2026-11-23T10:30:08.000Z"], "P34 keep (" + i + "): the bad read is not trusted and the copy keeps the time of the last good read");
    eq(ef.deriveFierceWeeks(cache2.map(r => ({ weekMonday: r.week_monday, data: r.data })), { deriveFrom: "2026-11-02" }).map(w => w.weekMonday + ":" + w.silvisRole + ":" + w.source), derived1, "P34 keep (" + i + "): the derived weeks are unchanged after a missing key / a non-array / two empty lists / a list that lost 4/19 and the published 1/4");
  });
  // ...and with no week to write there is nothing to attach to (review A, 11/11: both refreshes attach the copy to the weeks
  // of their extra leg too, so a run whose main read is empty still leaves it in the cache - the handler tests run that)
  eq(ef.eastAttachLists([], r1.lists), [], "P34 keep: 0 weeks - nothing to attach to");

  // -- Setup > East feed: the source words, the warnings' words, and what the cache holds of the lists
  eq(["feed", "list", "stated", "x", undefined].map(ef.eastSourceLabel), ["published", "DSG list", "stated", "x", ""], "P34 words: published / DSG list / stated");
  const wt = d34.warnings.map(ef.eastDerivedWarningText);
  ok(/2027-03-29/.test(wt[0]) && /the DSG list says East backup \(Silvis primary\)/.test(wt[0]) && /stated week says East primary \(Silvis backup\)/.test(wt[0]) && /the DSG list stands/.test(wt[0]), "P34 words: list-vs-stated names both readings and which stands: " + wt[0]);
  ok(/2027-06-21/.test(wt[2]) && /BOTH DSG lists/.test(wt[2]) && /East primary \(Silvis backup\)/.test(wt[2]), "P34 words: both-lists says how it is read: " + wt[2]);
  eq(ef.eastDerivedWarningText(null), "");
  const stamp = (rows, at) => rows.map(r => Object.assign({}, r, { fetched_at: at }));
  eq(ef.eastListsStatus(stamp(cache1, "2026-11-23T10:30:08+00:00")), { state: "read", readAt: "2026-11-23T10:30:08.000Z", writtenAt: "2026-11-23T10:30:08+00:00", eastPrimary: 4, eastBackup: 4, dropped: 0 }, "P34 status: read - the rows were written by the refresh that read the lists (the database's own spelling of the same instant)");
  eq(ef.eastListsStatus(stamp(cache1, "2026-11-24T10:30:09+00:00")).state, "kept", "P34 status: kept - a later refresh wrote the older copy back");
  // review A (11/11): the weeks of a refresh's extra leg carry the copy too and are stamped a little after the read (the
  // main leg runs in between) - the same refresh, never 'kept'; five minutes is the line
  eq(ef.eastListsStatus(stamp(cache1, "2026-11-23T10:32:38+00:00")).state, "read", "P34 status: rows written two and a half minutes after the read are the same refresh - read");
  eq(ef.eastListsStatus(cache1.map((r, i) => Object.assign({}, r, { fetched_at: i ? "2026-11-23T10:30:21+00:00" : "2026-11-23T10:30:08+00:00" }))).state, "read", "P34 status: main-leg and extra-leg rows of one refresh - read");
  eq(ef.eastListsStatus(stamp(cache1, "2026-11-23T10:35:09+00:00")).state, "kept", "P34 status: more than five minutes after the read - a later refresh wrote the older copy back");
  eq(ef.eastListsStatus(stamp(pub, "2026-11-24T10:30:09+00:00")), { state: "none", readAt: null, writtenAt: null, eastPrimary: 0, eastBackup: 0, dropped: 0 }, "P34 status: none - the cache holds weeks but no lists (an older writer's refresh): unknown, said so");
  eq(ef.eastListsStatus(null).state, "none");
  // a mixed cache after an untrusted refresh: the fetched rows carry the kept copy, a week new to the window none
  const mixedCache = stamp(cache1, "2026-11-24T10:30:09+00:00").concat([{ week_monday: "2027-02-22", data: { isBackup: true }, fetched_at: "2026-11-24T10:30:09+00:00" }]);
  eq([ef.eastListsStatus(mixedCache).state, ef.eastCachedLists(mixedCache).readAt], ["kept", "2026-11-23T10:30:08.000Z"], "P34 status: a row without a copy changes nothing");
  const ts = (x) => "<" + String(x).slice(0, 10) + ">";
  eq(ef.eastListsStatusText(ef.eastListsStatus(stamp(cache1, "2026-11-23T10:30:08+00:00")), ts), "DSG lists last read <2026-11-23>: 4 East-primary + 4 East-backup week(s) on file.", "P34 status words: when the lists were last read and what they hold");
  eq(ef.eastListsStatusText(ef.eastListsStatus(stamp(cache1, "2026-11-24T10:30:09+00:00")), ts), "DSG lists last read <2026-11-23>: 4 East-primary + 4 East-backup week(s) on file - KEPT: the refresh of <2026-11-24> did not trust its read (see the refresh line above).", "P34 status words: a kept copy says which refresh kept it");
  ok(/^DSG lists: none in the cache/.test(ef.eastListsStatusText(ef.eastListsStatus([]), ts)) && /only published and stated weeks derive/.test(ef.eastListsStatusText(null)), "P34 status words: no lists - said, with what still derives");
  ok(/1 entry that is not a Monday was dropped\.$/.test(ef.eastListsStatusText({ state: "read", readAt: "a", writtenAt: "a", eastPrimary: 1, eastBackup: 0, dropped: 1 })) && /3 entries that are not Mondays were dropped\.$/.test(ef.eastListsStatusText({ state: "read", readAt: "a", writtenAt: "a", eastPrimary: 1, eastBackup: 0, dropped: 3 })), "P34 status words: dropped entries are counted");
  ok(typeof ef.EAST_DERIVED_LEGEND === "string" && ef.EAST_DERIVED_LEGEND.indexOf("published Davenport week decides first") >= 0 && ef.EAST_DERIVED_LEGEND.indexOf("stated weeks") > ef.EAST_DERIVED_LEGEND.indexOf("two week lists"), "P34: the legend names the three sources in the order they decide");
}
// fetchEastWeeks with a stubbed fetch: the time_off read is scoped to the
// resolved ids, kind vacation, the window; its failure is NOT the weeks' failure.
{
  const realFetch = globalThis.fetch;
  const calls = [];
  const rows = { schedule_weeks: [{ week_monday: "2026-11-02", data: { dayCall: "s6" } }, { week_monday: "2026-11-09", data: { dayCall: "s2" } }],
    call_schedule_data: [{ data: { surgeons: [{ id: "s1", name: "DJA" }, { id: "s6", name: "FAK" }] } }],
    time_off: [{ person_id: "s6", kind: "vacation", start_date: "2026-11-18", end_date: "2026-11-22" }, { person_id: "s6", kind: "vacation", start_date: "2026-11-23", end_date: "2026-11-24" }, { person_id: "s1", kind: "vacation", start_date: "2026-11-18", end_date: "2026-11-22" }, { person_id: "s6", kind: "nocall", start_date: "2026-11-10", end_date: "2026-11-10" }] };
  let failTimeOff = false;
  globalThis.fetch = async (url) => {
    calls.push(url);
    const table = url.split("/rest/v1/")[1].split("?")[0];
    if (table === "time_off" && failTimeOff) return { ok: false, status: 500, text: async () => "boom", json: async () => null };
    return { ok: true, status: 200, text: async () => "", json: async () => rows[table] };
  };
  (async () => {
    try {
      const a = await ef.fetchEastWeeks("2026-11-02", "2026-11-09", { vacationCodes: ["FAK", "NF"] });
      eq(a.weeks.map(w => w.weekMonday), ["2026-11-02", "2026-11-09"]);
      eq(a.vacations, { FAK: [{ start: "2026-11-18", end: "2026-11-24" }] }, "P15: fetch -> FAK's vacation rows merged (adjacent 11/22|11/23), s1's and the no-call row dropped");
      eq(a.vacationsError, null);
      eq(a.vacationIdsByCode, { FAK: "s6" }, "P15: ids resolved through the Davenport blob by CODE");
      eq(a.vacationCodesUnresolved, ["NF"], "P15: a code the Davenport roster lacks is reported, not an error");
      // Prompt 34: the two week lists come from the SAME roster blob read - no request is added
      eq(a.lists, { eastPrimary: null, eastBackup: null, problems: [{ list: "backupMondays", why: "missing" }, { list: "fierceBackup", why: "missing" }], dropped: [] }, "P34: a blob without the two lists reports both missing (unknown), never empty lists");
      eq(calls.length, 3, "P34: still three GETs - the weeks, the roster blob, the time_off rows");
      rows.call_schedule_data = [{ data: { surgeons: [{ id: "s1", name: "DJA" }, { id: "s6", name: "FAK" }], backupMondays: ["2027-02-22", "2027-01-04", "2027-01-05"], fierceBackup: ["2027-03-29"], startMondayOverride: "2027-02-22", vacations: [{ id: 1 }] } }];
      calls.length = 0;
      const aL = await ef.fetchEastWeeks("2026-11-02", "2026-11-09", { vacationCodes: ["FAK"] });
      eq(aL.lists, { eastPrimary: ["2027-01-04", "2027-02-22"], eastBackup: ["2027-03-29"], problems: [], dropped: [{ list: "backupMondays", value: "2027-01-05" }] }, "P34: fetchEastWeeks returns the two validated lists of the blob it reads for the roster");
      eq([calls.length, calls.filter(u => u.indexOf("/rest/v1/call_schedule_data") >= 0)], [3, ["https://xqongyahdnkozqunpwmu.supabase.co/rest/v1/call_schedule_data?id=eq.main&select=data"]], "P34: the same three GETs, the blob read unchanged");
      eq(Object.keys(aL).sort().indexOf("blob"), -1, "P34: nothing else of that blob is returned");
      rows.call_schedule_data = [{ data: { surgeons: [{ id: "s1", name: "DJA" }, { id: "s6", name: "FAK" }] } }];
      calls.length = 0;
      await ef.fetchEastWeeks("2026-11-02", "2026-11-09", { vacationCodes: ["FAK", "NF"] });
      const q = calls.filter(u => u.indexOf("/rest/v1/time_off") >= 0);
      eq(q.length, 1, "P15: exactly one time_off GET");
      ok(/kind=eq\.vacation/.test(q[0]) && /person_id=in\.\(s6\)/.test(q[0]) && /end_date=gte\.2026-11-02/.test(q[0]) && /start_date=lte\.2027-11-15/.test(q[0]), "P15 fix 2: scoped to kind vacation, the resolved ids, from the window's Monday to a year past the window's Sunday (vacations reach further than Davenport publishes; Generate will offer 12-month presets): " + q[0]);
      calls.length = 0;
      const a2 = await ef.fetchEastWeeks("2026-11-02", "2026-11-09", { vacationCodes: ["FAK"], vacationsTo: "2027-06-30" });
      ok(/start_date=lte\.2027-06-30/.test(calls.filter(u => u.indexOf("/rest/v1/time_off") >= 0)[0]), "P15 fix 2: opts.vacationsTo sets the time_off horizon on its own (the weeks window is unchanged)");
      eq(a2.vacationsTo, "2027-06-30", "P15 fix 2: the horizon used is reported");
      calls.length = 0;
      const a3 = await ef.fetchEastWeeks("2026-11-02", "2026-11-09", { vacationCodes: ["FAK"], vacationsTo: "2026-11-01" });
      ok(/start_date=lte\.2027-11-15/.test(calls.filter(u => u.indexOf("/rest/v1/time_off") >= 0)[0]) && a3.vacationsTo === "2027-11-15", "P15 fix 2: a vacationsTo before the window's end (or malformed) falls back to the default");
      ok(/week_monday=lte\.2026-11-09/.test(calls.find(u => u.indexOf("/rest/v1/schedule_weeks") >= 0)), "P15 fix 2: the schedule_weeks read keeps the weeks window");
      calls.length = 0;
      const b = await ef.fetchEastWeeks("2026-11-02", "2026-11-09");
      eq(calls.filter(u => u.indexOf("/rest/v1/time_off") >= 0).length, 0, "P15: no vacationCodes -> no time_off read (scripts that only want the roster are unchanged)");
      eq(b.vacations, null);
      failTimeOff = true;
      const c = await ef.fetchEastWeeks("2026-11-02", "2026-11-09", { vacationCodes: ["FAK"] });
      eq(c.weeks.length, 2, "P15: a failed time_off read still returns the weeks");
      eq(c.vacations, null, "P15: ...with vacations null (unknown, never 'no vacations')");
      ok(typeof c.vacationsError === "string" && /time_off/.test(c.vacationsError) && /500/.test(c.vacationsError), "P15: the error names the read: " + c.vacationsError);
      eq(ef.attachVacationsToWeeks(c.weeks, c.vacations)[0].data.vacations, undefined, "P15: nothing is written for the failed read - keepCachedVacations then restores the cache");
      // audit RG-8 (9/23): resolution is generic per requested code; no code is required
      failTimeOff = false;
      const d0 = await ef.fetchEastWeeks("2026-11-02", "2026-11-09", { codes: ["NF", "FAK"] });
      eq(d0.idsByCode, { FAK: "s6" }, "RG-8: opts.codes resolve by CODE into idsByCode");
      eq(d0.codesUnresolved, ["NF"], "RG-8: a requested-but-missing code lands in codesUnresolved");
      eq(d0.fakId, null, "RG-8: fakId is the FIRST requested code's id (NF has none) - a deprecated alias, not a FAK lookup");
      eq((await ef.fetchEastWeeks("2026-11-02", "2026-11-09", { codes: ["FAK"] })).fakId, "s6", "RG-8: ...and FAK's id when FAK is the first requested code");
      const d1 = await ef.fetchEastWeeks("2026-11-02", "2026-11-09", { vacationCodes: ["FAK"] });
      eq([d1.idsByCode, d1.codesUnresolved, d1.vacationIdsByCode], [{ FAK: "s6" }, [], { FAK: "s6" }], "RG-8: vacationCodes appear in both maps");
      rows.call_schedule_data = [{ data: { surgeons: [{ id: "s1", name: "DJA" }] } }];
      const d2 = await ef.fetchEastWeeks("2026-11-02", "2026-11-09");
      eq([d2.weeks.length, d2.fakId, d2.idsByCode, d2.codesUnresolved], [2, null, {}, []], "RG-8: a Davenport roster without FAK does not throw when no code needs it");
      calls.length = 0;
      const d3 = await ef.fetchEastWeeks("2026-11-02", "2026-11-09", { vacationCodes: ["FAK"] });
      eq([d3.weeks.length, d3.codesUnresolved, d3.vacationCodesUnresolved, d3.vacations], [2, ["FAK"], ["FAK"], null], "RG-8: a requested code the roster lacks is reported in both lists; the weeks still come back, vacations stay unknown");
      eq(calls.filter(u => u.indexOf("/rest/v1/time_off") >= 0).length, 0, "RG-8: ...and no time_off read is made for an unresolved code");
      console.log("ok " + n + " assertions");
    } catch (e) { console.error(e); process.exit(1); }
    finally { globalThis.fetch = realFetch; }
  })();
}

