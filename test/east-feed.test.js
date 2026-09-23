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

