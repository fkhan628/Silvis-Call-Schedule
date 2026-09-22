#!/usr/bin/env node
// Silvis Call Schedule - East (Davenport) call FORECAST for Khan (FAK). Node only.
//
// WHY (Faraz, 2026-09-21 evening): the Davenport schedule for the next period is
// not published until the end of 2026, but Silvis must schedule Khan now. So we
// run the REAL Davenport generator many times over the next Davenport period,
// with the live Davenport inputs (its config blob, time_off and published
// weeks, read the way the live East feed reads them), and record per calendar day the fraction of runs
// in which FAK is on East call under the SAME derivation the live feed uses
// (east-feed.js deriveKhanBusyDays). Silvis treats days above a threshold as
// East-busy for PRIMARY (backup allowed), shows a "forecast" badge, and swaps
// in the real feed when Davenport publishes.
//
// READ-ONLY: every network call is a GET with the Davenport PUBLIC anon key.
// Nothing is ever written to the Davenport project. The --sql flag PRINTS
// upserts for the SILVIS east_forecast table (sql/schema.sql); it executes
// nothing. Forecast rows never go into east_feed: that table holds published
// Davenport rows only, and east-feed.js treats data.isForecast rows as absent
// everywhere except forecastFromFeedRows (reviewer finding east-2).
//
// Usage:
//   node scripts/east-forecast.js [--start YYYY-MM-DD] [--weeks N] [--runs N]
//                                 [--threshold 0.2] [--budget-sec 900] [--sql]
//                                 [--ref path/to/davenport-ref]
//   --start     first Monday of the forecast period
//               (default: last published Davenport week_monday + 7 days)
//   --weeks     number of weeks (default: blob.numWeeks, else 14)
//   --runs      generate() runs to aggregate (default: the seed's
//               groupRules.eastFeed.forecast.runs, 200 today - Prompt 12 C.5;
//               auto-reduced to fit --budget-sec after timing the first run;
//               the script says so and the JSON records BOTH numbers)
//   --threshold table cut-off for the printed day list (default 0.2)
//   --budget-sec wall-clock budget for the runs (default 900 s - sized so the
//               seed's 200 runs fit at ~4 s per generate())
//   --sql       also print east_forecast upsert SQL (one row per forecast week)
//   --ref       Davenport clone (default ../../davenport-ref relative to this
//               file, or env DAVENPORT_REF)
//
// Output: docs/east-forecast-latest.json =
//   { generatedAt, davenportPublishedThrough, period:{start,end,numWeeks},
//     requestedRuns, runs (actually executed), fakId, busyProbabilityByDay:{date:p},
//     reasonCountsByDay:{date:{reason:n}},
//     fierceWeekProbability:{weekMonday:{eastPrimary:p, eastBackup:p}}, notes:[] }
//
// Module use (tests): require() exports { parseArgs, defaultForecastRuns } and
// runs nothing - main is guarded by require.main === module.
//
// How generate()'s arguments are built: exactly like the Davenport app's
// doGenerate (davenport-ref/index-source.html ~3751-3846) and buildTimeOffMaps
// (~1249-1259), see buildDavenportInputs() below. Anything we could not
// reproduce faithfully is listed in the printed notes rather than approximated
// silently.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const ef = require(path.join(ROOT, "east-feed.js"));

// ---------------------------------------------------------------- CLI
// Default run count = docs/silvis-seed.json groupRules.eastFeed.forecast.runs
// (200; Prompt 12 C.5 - the seed's number is what runs unless --runs says
// otherwise). A missing / malformed seed value falls back to 100 with a note
// on stderr so the default is never silently something else.
const FALLBACK_RUNS = 100;
function defaultForecastRuns(seedPath) {
  try {
    const seed = JSON.parse(fs.readFileSync(seedPath || path.join(ROOT, "docs", "silvis-seed.json"), "utf8"));
    const n = seed && seed.groupRules && seed.groupRules.eastFeed && seed.groupRules.eastFeed.forecast && seed.groupRules.eastFeed.forecast.runs;
    if (Number.isInteger(n) && n > 0) return n;
    console.error("east-forecast: groupRules.eastFeed.forecast.runs missing or invalid in the seed (" + JSON.stringify(n) + ") - defaulting to " + FALLBACK_RUNS + " runs");
  } catch (e) {
    console.error("east-forecast: could not read docs/silvis-seed.json for the default run count (" + (e && e.message || e) + ") - defaulting to " + FALLBACK_RUNS + " runs");
  }
  return FALLBACK_RUNS;
}
function parseArgs(argv) {
  const a = { start: null, weeks: null, runs: defaultForecastRuns(), runsFrom: "seed", threshold: 0.2, budgetSec: 900, sql: false, ref: process.env.DAVENPORT_REF || path.join(ROOT, "..", "davenport-ref") };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--start") { a.start = v; i++; }
    else if (k === "--weeks") { a.weeks = parseInt(v, 10); i++; }
    else if (k === "--runs") { a.runs = parseInt(v, 10); a.runsFrom = "--runs"; i++; }
    else if (k === "--threshold") { a.threshold = parseFloat(v); i++; }
    else if (k === "--budget-sec") { a.budgetSec = parseFloat(v); i++; }
    else if (k === "--sql") { a.sql = true; }
    else if (k === "--ref") { a.ref = v; i++; }
    else if (k === "--help" || k === "-h") { console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 40).join("\n")); process.exit(0); }
    else { console.error("unknown argument: " + k); process.exit(2); }
  }
  if (a.start && !/^\d{4}-\d{2}-\d{2}$/.test(a.start)) { console.error("--start must be YYYY-MM-DD"); process.exit(2); }
  if (a.weeks !== null && !(a.weeks > 0)) { console.error("--weeks must be a positive integer"); process.exit(2); }
  if (!(a.runs > 0)) { console.error("--runs must be a positive integer"); process.exit(2); }
  return a;
}

// ---------------------------------------------------------------- Davenport modules in a vm sandbox
// Same recipe as davenport-ref/test/generator-regression.js: browser globals
// stubbed, fetch THROWS so a generator that touched the network would fail
// loudly, and top-level const/let pulled out with one last script.
// The Davenport generator logs "[validation] UNRESOLVED ..." lines to the
// console when its repair pass cannot fix a week (the app shows them in the
// browser console too). Over 100 runs x best-of-50 that is thousands of lines,
// so the sandbox console COUNTS them by message instead of printing; the
// summary goes into the notes. Real errors are still printed.
const sandboxLog = { counts: {}, total: 0 };
function collectLog(level) {
  return function () {
    const msg = Array.from(arguments).map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
    if (level === "error") { console.error("[davenport " + level + "] " + msg); return; }
    const key = msg.replace(/\s+/g, " ").slice(0, 160);
    sandboxLog.counts[key] = (sandboxLog.counts[key] || 0) + 1;
    sandboxLog.total++;
  };
}
function loadDavenport(refDir) {
  for (const f of ["helpers.js", "config.js", "generator.js"]) {
    if (!fs.existsSync(path.join(refDir, f))) throw new Error("Davenport clone not found at " + refDir + " (missing " + f + "); pass --ref or set DAVENPORT_REF");
  }
  const sandbox = {
    console: { log: collectLog("log"), info: collectLog("info"), warn: collectLog("warn"), debug: collectLog("debug"), error: collectLog("error") },
    window: {},
    document: undefined,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    fetch: () => { throw new Error("fetch called during generation - generator must be pure"); },
    navigator: { userAgent: "node-east-forecast" },
    setTimeout, clearTimeout,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ["helpers.js", "config.js", "generator.js"]) {
    vm.runInContext(fs.readFileSync(path.join(refDir, f), "utf8"), sandbox, { filename: f });
  }
  const app = vm.runInContext("({ generate, getHolidays, fmt, parse, addD, monOf, getMondays, INIT_SURGEONS, COUNTS_1YR, COUNTS_MULTIYEAR })", sandbox);
  if (typeof app.generate !== "function") throw new Error("generate() not found after loading Davenport modules");
  if (typeof app.getHolidays !== "function") throw new Error("getHolidays() not found after loading Davenport modules");
  return app;
}

// ---------------------------------------------------------------- live Davenport inputs (GET only)
async function fetchDavenportInputs() {
  const blobRows = await ef.eastGetJson("call_schedule_data?id=eq.main&select=data,updated_at");
  if (!blobRows.length || !blobRows[0].data) throw new Error("Davenport call_schedule_data main row missing");
  let blob = blobRows[0].data;
  if (typeof blob === "string") blob = JSON.parse(blob);
  const timeOff = await ef.eastGetJson("time_off?select=id,person_id,kind,start_date,end_date&order=start_date.asc");
  const weekRows = await ef.eastGetJson("schedule_weeks?select=week_monday,data&order=week_monday.asc");
  const schedule = {};
  weekRows.forEach(r => { if (r && r.week_monday) schedule[r.week_monday] = typeof r.data === "string" ? JSON.parse(r.data) : r.data; });
  return { blob, blobUpdatedAt: blobRows[0].updated_at || null, timeOff, schedule, weekRows };
}

// ---------------------------------------------------------------- build generate() arguments like doGenerate
// index-source.html ~1249-1259: time_off rows -> { vac, nc } maps of
// [start, end, id] ranges per person_id, sorted by start. kind 'nocall' goes
// to nc, everything else to vac.
function buildTimeOffMaps(rows) {
  const vac = {}, nc = {};
  (rows || []).forEach(r => {
    const tgt = r.kind === "nocall" ? nc : vac;
    (tgt[r.person_id] = tgt[r.person_id] || []).push([r.start_date, r.end_date, r.id]);
  });
  const byStart = (a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  Object.values(vac).forEach(a => a.sort(byStart));
  Object.values(nc).forEach(a => a.sort(byStart));
  return { vac, nc };
}

// index-source.html ~3751: surgeon preferences by roster code.
function buildPrefs(surgeons) {
  const p = {};
  surgeons.forEach(s => {
    const n = String(s.name || "").toUpperCase();
    if (n === "MCC") p[s.id] = { preferShift: "tue", avoidShift: null };
    else if (n === "DJA") p[s.id] = { preferShift: null, avoidShift: "thu" };
  });
  return p;
}

function buildDavenportInputs(dav, live, args, notes) {
  const { blob, timeOff, schedule } = live;
  const { fmt, parse, addD, monOf } = dav;

  // surgeons: the app's `surgeons` state = blob.surgeons (falls back to INIT_SURGEONS)
  const surgeons = Array.isArray(blob.surgeons) && blob.surgeons.length ? blob.surgeons : dav.INIT_SURGEONS;
  const fakId = ef.eastResolveFakId(surgeons, "FAK");
  if (!fakId) throw new Error("no Davenport roster entry with code FAK");

  // period
  const publishedMondays = Object.keys(schedule).sort();
  const publishedThrough = publishedMondays.length ? publishedMondays[publishedMondays.length - 1] : null;
  let startStr = args.start || (publishedThrough ? fmt(addD(parse(publishedThrough), 7)) : null);
  if (!startStr) throw new Error("no published weeks and no --start given");
  let startD = parse(startStr);
  if (startD.getDay() !== 1) { startD = monOf(startD); notes.push("start " + startStr + " was not a Monday; snapped to " + fmt(startD) + " (as the app does)"); startStr = fmt(startD); }
  const numWeeks = args.weeks || blob.numWeeks || 14;
  const mondays = []; { let d = new Date(startD); for (let i = 0; i < numWeeks; i++) { mondays.push(new Date(d)); d = addD(d, 7); } }
  const endStr = fmt(addD(mondays[mondays.length - 1], 6));

  // time off -> availability (vacation + no-call merged) and vacationsOnly
  const { vac, nc } = buildTimeOffMaps(timeOff);
  const availability = {};
  new Set([...Object.keys(vac), ...Object.keys(nc)]).forEach(id => { availability[id] = [...(vac[id] || []), ...(nc[id] || [])]; });

  // sets persisted as blob arrays
  const backupMondaySet = new Set(Array.isArray(blob.backupMondays) ? blob.backupMondays : []);
  const fierceBackupSet = new Set(Array.isArray(blob.fierceBackup) ? blob.fierceBackup : []);

  // counts: the app keeps its built-in defaults unless the blob has any value > 0
  const anyPositive = (c) => c && Object.values(c).some(x => x && Object.values(x).some(v => v > 0));
  const priorCounts = anyPositive(blob.priorCounts) ? blob.priorCounts : dav.COUNTS_MULTIYEAR;
  const year1Counts = anyPositive(blob.year1Counts) ? blob.year1Counts : dav.COUNTS_1YR;
  if (priorCounts !== blob.priorCounts) notes.push("blob.priorCounts empty -> used Davenport COUNTS_MULTIYEAR defaults (as the app does)");
  if (year1Counts !== blob.year1Counts) notes.push("blob.year1Counts empty -> used Davenport COUNTS_1YR defaults (as the app does)");

  const holidayAssignments = blob.holidayAssignments || {};
  const pendingLocks = Array.isArray(blob.pendingLocks) ? blob.pendingLocks : [];
  const prefs = buildPrefs(surgeons);

  // prevWeekSeed: exactly doGenerate's IIFE (contiguous prior week + recent DC offsets)
  const prevWeekSeed = (() => {
    if (!mondays.length) return null;
    const first = mondays[0];
    const prevWk = schedule[fmt(addD(first, -7))];
    const recentDc = {};
    for (let k = 1; k <= 60; k++) {
      const wk = schedule[fmt(addD(first, -7 * k))];
      if (!wk) continue;
      const dc = wk.dayCall;
      if (dc && recentDc[dc] === undefined) recentDc[dc] = -k;
    }
    return { dayCall: (prevWk && prevWk.dayCall) || null, wknd: (prevWk && prevWk.nights && prevWk.nights.wknd) || null, recentDc };
  })();
  const seedDebug = { first: startStr, prevKey: fmt(addD(mondays[0], -7)), prevFound: !!schedule[fmt(addD(mondays[0], -7))], seedDayCall: prevWeekSeed.dayCall, recentDcCount: Object.keys(prevWeekSeed.recentDc).length, scheduleWeeks: publishedMondays.length };

  const args12 = [surgeons, mondays, availability, backupMondaySet, priorCounts, prefs, fierceBackupSet, holidayAssignments, pendingLocks, prevWeekSeed, vac, year1Counts];
  return { args12, surgeons, fakId, mondays, startStr, endStr, numWeeks, publishedThrough, seedDebug, vac, nc, backupMondaySet, fierceBackupSet, holidayAssignments, pendingLocks };
}

// ---------------------------------------------------------------- helpers
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function pad(s, n) { s = String(s); return s.length >= n ? s : s + " ".repeat(n - s.length); }
function lpad(s, n) { s = String(s); return s.length >= n ? s : " ".repeat(n - s.length) + s; }
function round3(x) { return Math.round(x * 1000) / 1000; }
function sqlStr(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

// ---------------------------------------------------------------- main
async function main() {
  const args = parseArgs(process.argv);
  const notes = [];
  const t0 = Date.now();

  console.log("east-forecast: requested runs " + args.runs + " (" + (args.runsFrom === "seed" ? "seed groupRules.eastFeed.forecast.runs" : "--runs") + "), budget " + args.budgetSec + " s");
  console.log("east-forecast: loading Davenport modules from " + args.ref);
  const dav = loadDavenport(args.ref);
  console.log("east-forecast: fetching live Davenport inputs (GET only, anon key) from " + ef.EAST_PROJECT.url);
  const live = await fetchDavenportInputs();
  const inp = buildDavenportInputs(dav, live, args, notes);
  const { fmt, parse, addD } = dav;

  console.log("  published weeks: " + Object.keys(live.schedule).length + ", through " + inp.publishedThrough + " (blob updated " + live.blobUpdatedAt + ")");
  console.log("  roster: " + inp.surgeons.map(s => s.id + "=" + s.name).join(" ") + "  -> FAK id " + inp.fakId);
  console.log("  period: " + inp.startStr + " .. " + inp.endStr + " (" + inp.numWeeks + " weeks)" + (args.start ? " [--start]" : " [last published + 7d]") + (args.weeks ? " [--weeks]" : " [blob.numWeeks=" + (live.blob.numWeeks || "n/a") + "]"));
  console.log("  seed: " + JSON.stringify(inp.seedDebug));
  console.log("  time_off rows: " + live.timeOff.length + " (" + Object.keys(inp.vac).length + " people with vacation, " + Object.keys(inp.nc).length + " with no-call)");
  console.log("  backupMondays in period: " + [...inp.backupMondaySet].filter(m => m >= inp.startStr && m <= inp.endStr).sort().join(", ") || "(none)");
  console.log("  fierceBackup in period:  " + [...inp.fierceBackupSet].filter(m => m >= inp.startStr && m <= inp.endStr).sort().join(", ") || "(none)");
  console.log("  pendingLocks: " + inp.pendingLocks.length + ", holidayAssignments years: " + Object.keys(inp.holidayAssignments).join(",") + ", prefs: " + JSON.stringify(buildPrefs(inp.surgeons)));

  // FAK-specific fixed inputs worth surfacing
  const fakVac = (inp.vac[inp.fakId] || []).filter(([a, b]) => b >= inp.startStr && a <= inp.endStr).map(([a, b]) => a + ".." + b);
  const fakNc = (inp.nc[inp.fakId] || []).filter(([a, b]) => b >= inp.startStr && a <= inp.endStr).map(([a, b]) => a + ".." + b);
  if (fakVac.length) notes.push("FAK Davenport vacation ranges in period (never scheduled there): " + fakVac.length + " range(s); the dates are not recorded here");
  if (fakNc.length) notes.push("FAK Davenport no-call in period: " + fakNc.join(", "));
  const fixedHol = [];
  Object.values(inp.holidayAssignments).forEach(arr => (arr || []).forEach(h => (h.coverage || []).forEach(c => {
    if (!c.isEve && c.surgeon === inp.fakId && c.date >= inp.startStr && c.date <= inp.endStr) fixedHol.push(c.date + " (" + c.label + ")");
  })));
  if (fixedHol.length) notes.push("FAK holds these Davenport holiday 24h units by blob assignment (deterministic, p=1): " + fixedHol.join(", "));
  const fakLocks = inp.pendingLocks.filter(l => l && l.surgeonId === inp.fakId && l.mondayStr >= inp.startStr && l.mondayStr <= inp.endStr);
  if (fakLocks.length) notes.push("FAK manual locks in period: " + fakLocks.map(l => l.mondayStr + ":" + l.slot).join(", "));

  // ---- time one generate() and size the run count
  const runOnce = () => dav.generate.apply(null, inp.args12);
  const tA = Date.now();
  const first = runOnce();
  const msPer = Date.now() - tA;
  if (!first || typeof first !== "object") throw new Error("generate() returned nothing");
  const firstWeeks = Object.keys(first).sort();
  if (firstWeeks.length !== inp.numWeeks) notes.push("generate() returned " + firstWeeks.length + " weeks for a " + inp.numWeeks + "-week period");
  // sanity: the flags in the output must mirror the blob sets, else the sets were passed wrong
  firstWeeks.forEach(m => {
    if (!!first[m].isBackup !== inp.backupMondaySet.has(m) || !!first[m].isFierceBackup !== inp.fierceBackupSet.has(m)) throw new Error("week " + m + " flags do not mirror the blob sets - argument order wrong?");
  });
  let runs = args.runs;
  const budgetMs = args.budgetSec * 1000;
  const fit = Math.max(1, Math.floor(budgetMs / Math.max(msPer, 1)));
  console.log("  one generate() took " + msPer + " ms (best-of-50 inside); " + args.runs + " runs ~ " + Math.round(args.runs * msPer / 1000) + " s");
  if (args.runs * msPer > budgetMs) {
    runs = fit;
    notes.push("runs reduced from " + args.runs + " (requested) to " + runs + " (executed) to stay within ~" + args.budgetSec + " s (one generate() = " + msPer + " ms); the JSON records both as requestedRuns / runs");
    console.log("  -> " + runs + " runs to fit the " + args.budgetSec + " s budget (say --runs/--budget-sec to change)");
  }

  // ---- aggregate
  const period = []; for (let i = 0; i < inp.numWeeks * 7; i++) period.push(fmt(addD(inp.mondays[0], i)));
  const busyCount = {}; period.forEach(d => busyCount[d] = 0);
  const reasonCounts = {};
  const fierce = {}; inp.mondays.forEach(m => fierce[fmt(m)] = { eastPrimary: 0, eastBackup: 0 });
  const dcCount = {}; // how often FAK gets the service week per week (diagnostic)
  function absorb(sched) {
    const weeks = Object.keys(sched).map(m => ({ weekMonday: m, data: sched[m] }));
    const { busy, reasons } = ef.deriveKhanBusyDays(weeks, inp.fakId, { eastBackupCountsAsBusy: true });
    busy.forEach(d => { if (busyCount[d] !== undefined) busyCount[d]++; });
    Object.keys(reasons).forEach(d => { const rc = reasonCounts[d] = reasonCounts[d] || {}; reasons[d].forEach(r => rc[r] = (rc[r] || 0) + 1); });
    weeks.forEach(w => {
      if (!fierce[w.weekMonday]) return;
      if (w.data.isBackup) fierce[w.weekMonday].eastPrimary++;
      if (w.data.isFierceBackup) fierce[w.weekMonday].eastBackup++;
      if (w.data.dayCall === inp.fakId) dcCount[w.weekMonday] = (dcCount[w.weekMonday] || 0) + 1;
    });
  }
  absorb(first);
  for (let i = 1; i < runs; i++) {
    absorb(runOnce());
    if (i % 10 === 0) process.stdout.write("  run " + i + "/" + runs + " (" + Math.round((Date.now() - tA) / 1000) + " s)\r");
  }
  process.stdout.write(pad("", 40) + "\r");
  console.log("  " + runs + " runs in " + Math.round((Date.now() - tA) / 1000) + " s");

  const busyProbabilityByDay = {}; period.forEach(d => busyProbabilityByDay[d] = round3(busyCount[d] / runs));
  const fierceWeekProbability = {}; Object.keys(fierce).forEach(m => fierceWeekProbability[m] = { eastPrimary: round3(fierce[m].eastPrimary / runs), eastBackup: round3(fierce[m].eastBackup / runs) });

  // Davenport generator console summary (validation leftovers etc.)
  if (sandboxLog.total) {
    const top = Object.keys(sandboxLog.counts).sort((a, b) => sandboxLog.counts[b] - sandboxLog.counts[a]).slice(0, 6);
    notes.push("Davenport generator console: " + sandboxLog.total + " messages over " + runs + " runs (x best-of-50 candidates), suppressed. Most frequent: " + top.map(k => "\"" + k + "\" x" + sandboxLog.counts[k]).join("; "));
  }

  notes.unshift(
    "Forecast of Khan's East (Davenport) call for the NEXT Davenport period, produced by running the real Davenport generator (best-of-50 inside each run) " + runs + " times on live Davenport inputs. Not a published schedule.",
    "Derivation per run = east-feed.js deriveKhanBusyDays with eastBackupCountsAsBusy:true (service week Mon-Sat, weeknights, wknd = Fri + Sun, holiday 24h units; a holiday 24h held by another surgeon frees FAK for that whole day).",
    "Period start = last published Davenport week_monday + 7 days" + (args.start ? " overridden by --start " + args.start : "") + "; Faraz may pick a different start/length when he actually generates.",
    "Davenport startMondayOverride in the blob is " + (live.blob.startMondayOverride || "(empty)") + " (the CURRENT period's start) and was deliberately not used.",
    "Not reproduced: edits Faraz makes before generating (new time_off rows, pendingLocks, holiday assignment changes, roster changes), his manual post-generation edits (week editor, dayCallOverrides, trades), and which best-of-50 candidate his single click lands on. Math.random is unseeded in the Davenport generator, so each run here is an independent draw."
  );

  // ---- write JSON
  const out = {
    generatedAt: new Date().toISOString(),
    davenportPublishedThrough: inp.publishedThrough,
    period: { start: inp.startStr, end: inp.endStr, numWeeks: inp.numWeeks },
    requestedRuns: args.runs,   // what was asked for (seed groupRules.eastFeed.forecast.runs unless --runs)
    runs,                       // what actually ran (budget-reduced when the note says so)
    fakId: inp.fakId,
    busyProbabilityByDay,
    reasonCountsByDay: reasonCounts,
    fierceWeekProbability,
    fakServiceWeekProbability: Object.fromEntries(Object.keys(fierce).map(m => [m, round3((dcCount[m] || 0) / runs)])),
    notes,
  };
  const outPath = path.join(ROOT, "docs", "east-forecast-latest.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log("\nwrote " + outPath + " (requestedRuns " + out.requestedRuns + ", runs executed " + out.runs + ")");

  // ---- table
  console.log("\nDays with P(FAK on East call) >= " + args.threshold + "   [" + inp.startStr + " .. " + inp.endStr + ", " + runs + " runs]");
  console.log("  date        dow  p      top reasons");
  period.forEach(d => {
    const p = busyProbabilityByDay[d];
    if (p < args.threshold) return;
    const rc = reasonCounts[d] || {};
    const top = Object.keys(rc).sort((a, b) => rc[b] - rc[a]).map(r => r + " " + Math.round(100 * rc[r] / runs) + "%").join(", ");
    console.log("  " + d + "  " + DOW[parse(d).getDay()] + "  " + lpad(p.toFixed(2), 5) + "  " + top);
  });
  console.log("\nHistogram of p over all " + period.length + " days in the period");
  const bins = new Array(10).fill(0);
  period.forEach(d => { const p = busyProbabilityByDay[d]; bins[Math.min(9, Math.floor(p * 10))]++; });
  bins.forEach((c, i) => {
    const lo = (i / 10).toFixed(1), hi = i === 9 ? "1.0]" : ((i + 1) / 10).toFixed(1) + ")";
    console.log("  [" + lo + ", " + hi + "  " + lpad(c, 3) + "  " + "#".repeat(c));
  });
  const above = period.filter(d => busyProbabilityByDay[d] >= 0.5).length;
  console.log("  days with p >= 0.5: " + above + " (busy for Silvis primary at the seed threshold 0.5); p == 0: " + period.filter(d => busyProbabilityByDay[d] === 0).length);

  console.log("\nFierce weeks in the period (from the blob sets; deterministic):");
  Object.keys(fierceWeekProbability).forEach(m => {
    const f = fierceWeekProbability[m];
    if (f.eastPrimary || f.eastBackup) console.log("  " + m + "  eastPrimary=" + f.eastPrimary + " (Silvis backup)  eastBackup=" + f.eastBackup + " (Silvis primary)");
  });
  console.log("FAK service-week probability by week: " + Object.keys(out.fakServiceWeekProbability).map(m => m.slice(5) + ":" + out.fakServiceWeekProbability[m].toFixed(2)).join("  "));

  console.log("\nNotes:"); notes.forEach(n => console.log("  - " + n));

  // ---- optional SQL (printed, never executed)
  if (args.sql) {
    console.log("\n-- SQL for the SILVIS east_forecast table (print only; review, then run in the Silvis SQL editor):");
    console.log("-- one row per forecast week; NOT east_feed (published Davenport rows only). data.isForecast=true is a");
    console.log("-- second guard: east-feed.js derivers ignore such a row even if it were ever copied into east_feed.");
    const rowsSql = [];
    inp.mondays.forEach(m => {
      const ms = fmt(m);
      const days = ef.efDayOffsets(ms);
      const wk = {}; days.forEach(d => wk[d] = busyProbabilityByDay[d]);
      const data = { isForecast: true, runs, generatedAt: out.generatedAt, fakBusyProbabilityByDay: wk, fierceWeekProbability: fierceWeekProbability[ms] };
      rowsSql.push("insert into public.east_forecast (week_monday, data, generated_at) values (" + sqlStr(ms) + ", " + sqlStr(JSON.stringify(data)) + "::jsonb, " + sqlStr(out.generatedAt) + "::timestamptz) on conflict (week_monday) do update set data = excluded.data, generated_at = excluded.generated_at;");
    });
    // round-trip check: the printed rows must read back through east-feed.js as
    // a forecast (forecastFromFeedRows) and as NOTHING for the published derivers
    const check = inp.mondays.map(m => { const ms = fmt(m); const days = ef.efDayOffsets(ms); const wk = {}; days.forEach(d => wk[d] = busyProbabilityByDay[d]); return { weekMonday: ms, data: { isForecast: true, fakBusyProbabilityByDay: wk } }; });
    const back = ef.forecastFromFeedRows(check);
    const same = period.every(d => back[d] === busyProbabilityByDay[d]);
    const leak = ef.deriveKhanBusyDays(check, inp.fakId).busy.size + (ef.coverageOf(check) ? 1 : 0) + ef.deriveFierceWeeks(check).length;
    if (!same || leak) throw new Error("forecast SQL round-trip failed (same=" + same + ", leak=" + leak + ") - not printing");
    rowsSql.forEach(s => console.log(s));
    console.log("-- " + rowsSql.length + " rows; round-trip through east-feed.js verified (forecast readable, invisible to published derivers)");
  }
  console.log("\ndone in " + Math.round((Date.now() - t0) / 1000) + " s. Nothing was written to the Davenport project.");
}

if (require.main === module) {
  main().catch(e => { console.error("east-forecast FAILED: " + (e && e.stack || e)); process.exit(1); });
}
module.exports = { parseArgs, defaultForecastRuns, FALLBACK_RUNS };
