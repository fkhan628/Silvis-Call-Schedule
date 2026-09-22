// Silvis generator regression harness (guide section 12, scoped per
// docs/ORIENTATION-2026-09-21.md section 3 item 18).
//
// Builds ctx from docs/silvis-seed.json exactly the way the app will
// (test/seed-adapter.js -> rules.buildContext) plus the synthetic East feed of
// Prompt 4 (Fierce East-primary week 2026-11-09 = Silvis backup, East-backup
// week 2026-12-07 = Silvis primary; Khan East-busy 2026-11-13..15,
// 2026-11-23..28 and 2026-12-11..13) and the real East forecast snapshot in
// test/fixtures/east-forecast-2026-09-22.json (Khan primary blocked where the
// probability is >= groupRules.eastFeed.forecast.busyThreshold).
//
// rules.js is imported ONLY to build ctx (buildContext). Every assertion below
// re-states its rule independently from the seed data; nothing here calls
// eligibility(). Since 9/22 (Prompt 12 item I) the restated rule set says backup
// is open to everyone: the per-day items restrict PRIMARY only where the rules
// doc does, and a backup slot is refused only by vacations, holiday opt-outs,
// explicit rows, derived locks, the other role, backup caps, Sarkar's windows
// and an explicit backupOptOut. Hard-rule items assert on GENERATOR-PLACED slots only
// (import/manual locks and Fierce's derived locks are facts: item 3 checks
// they are byte-identical, lock collisions are diagnostics warnings).
//
// Coverage and the 10 s budget (Prompt 4: "All runs must finish under 10 s
// total"): 50 seeds x 4 ranges, then one bestOf 200 Nov-Dec run for the tally
// table (the UI default), plus four short fixture runs (manual lock, backup
// opt-out, legacy group key, range edge). bestOf per range is 6 / 5 / 2 / 2
// (R1 / R2 / R3 / R4), chosen on 2026-09-22 from measured per-candidate costs
// on the dev machine (R1 2.2 ms, R2 8 ms, R3 19 ms, R4 ~10 ms; R4 = the
// milestone range 2026-11-02 -> 2027-01-03 added by Prompt 12 A so the year
// boundary is inside ONE run and the consecutive-run checks see 12/30 -> 1/1).
// R4 runs on the EVEN seeds only (25 runs, ~0.5 s): with all 50 seeds the
// quiet-run total was 8.1 s and a loaded run measured 11.6 s against the 10 s
// budget (2026-09-22; the machine was shared with two other sessions - the
// pre-R4 harness itself measured 5.5 s quiet and 10.5 s loaded the same day).
// The even seeds keep seed 4, the seed that exposed the Burchett 12/30 -> 1/1
// run before the fix. Whole-file numbers after the Prompt 12 A fix stage
// (2026-09-22, two standalone runs on the shared dev machine): 7113 ms and
// 7060 ms total at 2.3 / 8.0 / 20.5 / 9.5 ms per candidate (R1-R4) - the
// engine's hard and any-role runs are measured in ONE walk per direction in
// eligibility() (single-walk rewrite; behaviour-identical to the two-walk
// version on 16 generations and 23,136 eligibility results). If a CI runner
// lands above ~8 s quiet, drop R4 to bestOf 1 (BEST_OF_DEFAULT [6, 5, 2, 1])
// before anything else; never raise the budget to hide it.
// ~77 % of a candidate is inside rules.weekendUnitPatterns
// and eligibility, so nothing on the generator side can buy the 4x that
// bestOf 25 everywhere would need - review findings rules-2 / harness-1 /
// quality-3). The rule assertions run on every winning candidate either way;
// bestOf only changes search depth, and the milestone preview keeps 200.
// SILVIS_GEN_BEST_OF=25 restores the deep run for a deliberate soak (printed;
// the budget is then not enforced); SILVIS_GEN_BUDGET_MS raises the budget for
// a slow CI runner (printed). The budget is a failing assertion, never a
// warning. Known gaps owned by another file are listed in the summary and
// counted, and SILVIS_STRICT=1 turns them into failures.
// Exits 1 on the first failing assertion with seed/range/day.
"use strict";
const fs = require("fs");
const path = require("path");
const R = require("../rules.js");          // buildContext only
const SA = require("./seed-adapter.js");
const GEN = require("../generator.js");

const T_FILE = Date.now();
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs", "silvis-seed.json"), "utf8"));
const forecastFile = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "east-forecast-2026-09-22.json"), "utf8"));

/* ------------------------------------------------------------ harness */
let N = 0;
const CUR = { range: "-", seed: "-", day: "-" };
function fail(msg) {
  console.error("FAIL [range " + CUR.range + " seed " + CUR.seed + " day " + CUR.day + "]: " + msg);
  process.exit(1);
}
function ok(cond, msg) { N++; if (!cond) fail(msg); }
function eq(a, b, msg) { N++; if (JSON.stringify(a) !== JSON.stringify(b)) fail(msg + " expected " + JSON.stringify(b) + " got " + JSON.stringify(a)); }
// A defect this harness can prove but whose fix lives in a file another agent
// owns: counted, printed in the summary with its evidence, and a failure under
// SILVIS_STRICT=1. Once the owner fixes it the strict assertion applies on its own.
const STRICT = process.env.SILVIS_STRICT === "1";
const KNOWN_GAPS = [];
function knownGap(id, owner, evidence) { N++; KNOWN_GAPS.push(id + " [" + owner + "]: " + evidence); if (STRICT) fail("known gap " + id + " still open (" + owner + "): " + evidence); }

/* ------------------------------------------------------- date helpers */
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pad2 = (n) => (n < 10 ? "0" : "") + n;
const dayNum = (s) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000);
const fromDayNum = (n) => { const d = new Date(n * 86400000); return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate()); };
const addDays = (s, n) => fromDayNum(dayNum(s) + n);
const wdi = (s) => ((dayNum(s) + 3) % 7 + 7) % 7; // Mon = 0
const weekday = (s) => WD[wdi(s)];
const nthOf = (s) => Math.floor((+s.slice(8, 10) - 1) / 7) + 1;
const monthOf = (s) => s.slice(0, 7);
const mondayOf = (s) => addDays(s, -wdi(s));
const fridayOf = (s) => (wdi(s) >= 4 ? addDays(s, -(wdi(s) - 4)) : null);
const isWeekend = (s) => wdi(s) >= 4;
const daysList = (a, b) => { const out = []; for (let n = dayNum(a); n <= dayNum(b); n++) out.push(fromDayNum(n)); return out; };
const monthDays = (m) => { const y = +m.slice(0, 4), mm = +m.slice(5, 7), dim = new Date(Date.UTC(y, mm, 0)).getUTCDate(); const out = []; for (let d = 1; d <= dim; d++) out.push(m + "-" + pad2(d)); return out; };
function nthWeekdayOfMonth(y, m, wdName, n) {
  const first = wdi(y + "-" + pad2(m) + "-01"), target = WD.indexOf(wdName);
  const day = 1 + ((target - first + 7) % 7) + (n - 1) * 7;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return day > dim ? null : y + "-" + pad2(m) + "-" + pad2(day);
}

/* ------------------------------------------------------------ roster */
const byCode = (code) => { const r = seed.roster.find((x) => x.code === code); if (!r) throw new Error("no roster entry with code " + code); return r.id; };
const KHAN = byCode("FAK"), BURCHETT = byCode("MAB"), ACTON = byCode("BDA"), PHILIP = byCode("AFP"), FIERCE = byCode("NF"), SARKAR = byCode("SRK");
const IDS = seed.roster.filter((r) => r.active !== false).map((r) => r.id);
const CODE = {}; seed.roster.forEach((r) => { CODE[r.id] = r.code; });
const SR = seed.surgeonRules;
const P = "primary", B = "backup", ROLES = [P, B];

/* -------------------------------------------------- synthetic East feed */
const DERIVE_FROM = SR[FIERCE].eastFeed.deriveFrom; // 2026-11-02
const DERIVED = [
  { weekMonday: "2026-11-09", surgeonId: FIERCE, silvisRole: B }, // East primary week -> Silvis backup
  { weekMonday: "2026-12-07", surgeonId: FIERCE, silvisRole: P }  // East backup week  -> Silvis primary
];
const KHAN_BUSY = ["2026-11-13", "2026-11-14", "2026-11-15", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-12-11", "2026-12-12", "2026-12-13"];
const EAST_COVER = { from: "2026-11-02", to: "2026-12-31" };
const FORECAST = forecastFile.busyProbabilityByDay;
const THRESHOLD = seed.groupRules.eastFeed.forecast.busyThreshold;
const KHAN_NO_PRIMARY = new Set(KHAN_BUSY.concat(Object.keys(FORECAST).filter((d) => FORECAST[d] >= THRESHOLD)));
const DERIVED_ROLE = {};   // day -> forced Silvis role (from deriveFrom on)
const FIERCE_EAST_DAYS = new Set(); // every day of every derived week (East call either way)
DERIVED.forEach((w) => { for (let k = 0; k < 7; k++) { const d = addDays(w.weekMonday, k); FIERCE_EAST_DAYS.add(d); if (d >= DERIVE_FROM) DERIVED_ROLE[d] = w.silvisRole; } });

/* ------------------------------------------------------- context (ctx) */
const input = SA.seedToContextInput(seed, {
  eastDerived: DERIVED, eastBusyDays: { [KHAN]: KHAN_BUSY }, eastFeedCoverage: EAST_COVER, eastForecast: { [KHAN]: FORECAST }
});
const INPUT = JSON.parse(JSON.stringify(input.schedule)); // locked import + Thanksgiving, as the importer writes it
const ctx = R.buildContext(input);
if (ctx.warnings.length) fail("buildContext warnings: " + JSON.stringify(ctx.warnings));
const ORIGINAL_SCHEDULE_REF = ctx.schedule;

/* -------------------------------------- independent restatement of rules */
// Holiday units (all years) by day.
const HOLIDAY = {}; const HOLIDAY_UNITS = [];
Object.keys(seed.holidays.units).forEach((y) => seed.holidays.units[y].forEach((u) => { const unit = { name: u.name, tier: u.tier, days: u.days.slice().sort() }; HOLIDAY_UNITS.push(unit); unit.days.forEach((d) => { HOLIDAY[d] = unit; }); }));
const isHoliday = (d) => !!HOLIDAY[d];
// Vacations: the day itself blocks both roles, the day before blocks PRIMARY (dayBeforeRules.trailingEdgeRoles).
const VAC = {}, DAY_BEFORE_VAC = {};
IDS.forEach((id) => { VAC[id] = new Set(); DAY_BEFORE_VAC[id] = new Set(); });
Object.keys(SR).forEach((id) => (SR[id].timeOff || []).forEach((t) => daysList(t.start, t.end || t.start).forEach((d) => VAC[id].add(d))));
IDS.forEach((id) => VAC[id].forEach((d) => { const b = addDays(d, -1); if (!VAC[id].has(b)) DAY_BEFORE_VAC[id].add(b); }));
eq(seed.groupRules.dayBeforeRules.trailingEdgeRoles, [P], "seed: trailing edge is primary-only");
eq(seed.groupRules.dayBeforeRules.aledoDayBeforeRoles, [P], "seed: day-before-Aledo is primary-only");
eq(seed.groupRules.countBackupInConsecutive, false, "seed: consecutive counts primary days only");
// Prompt 12 A (9/22): the hard limit is per surgeon on REAL primary days; the holiday-unit
// collapse is a per-surgeon opt-in (Khan only); the old group key is gone.
ok(!("unitExemptFromMaxConsecutive" in seed.groupRules.holidays), "seed: groupRules.holidays.unitExemptFromMaxConsecutive must be gone (Prompt 12 A)");
eq(IDS.filter((id) => SR[id].holidayUnitCountsAsOneDay === true), [KHAN], "seed: only Khan opted in to the holiday-unit collapse");
IDS.forEach((id) => ok(typeof SR[id].maxConsecutiveDays === "number", "seed: " + CODE[id] + " has a numeric maxConsecutiveDays"));
eq(IDS.map((id) => SR[id].maxConsecutiveAnyRole), [4, 3, 4, 4, 7, 2], "seed: soft any-role limits Khan 4, Burchett 3, Acton 4, Philip 4, Fierce 7, Sarkar 2");
const NAME = {}; seed.roster.forEach((r) => { NAME[r.id] = r.name; });
const COLLAPSE = new Set(IDS.filter((id) => SR[id].holidayUnitCountsAsOneDay === true));
// 9/22 (rules doc section 1 "Roles per day"; Prompt 12 item I): backup is open to
// everyone every day. The outreach / OR-day / Clinton / Aledo rules and the dated
// whitelists below restrict PRIMARY only. Still blocking backup: vacations, holiday
// opt-outs, explicit unavailable / no_backup rows, derived locks, the other role,
// backup caps, Sarkar's windows and an explicit surgeonRules.<id>.backupOptOut.
eq(!!(seed.groupRules.backupPolicy && seed.groupRules.backupPolicy.openToEveryone), true, "seed: groupRules.backupPolicy.openToEveryone");
eq(IDS.filter((id) => SR[id].backupOptOut !== false), [], "seed: every surgeon carries backupOptOut:false (nobody has opted out)");
const OPTED_OUT = new Set(IDS.filter((id) => SR[id].backupOptOut === true));
const hardNeverApplies = (id, role) => { const r = SR[id].hardNeverWeekdaysRoles; return (Array.isArray(r) && r.length ? r : [P]).includes(role); }; // engine default when the key is absent OR empty: primary only
eq(SR[KHAN].hardNeverWeekdaysRoles, [P], "seed: Khan's OR days block primary only");
eq(SR[SARKAR].hardNeverWeekdaysRoles, [P], "seed: Sarkar's Fri/Sun block primary only");
const FIERCE_WP = SR[FIERCE].outsideDerivedWeeks.weekdayPattern;
eq(WD.map((w) => FIERCE_WP[w].backup), [true, true, true, true, true, true, true], "seed: Fierce may be backup on every weekday (9/22)");
eq(WD.map((w) => FIERCE_WP[w].primary), [false, false, true, false, "weekend-block-only", "weekend-block-only", "weekend-block-only"], "seed: Fierce's primary pattern is unchanged");
// Burchett: recurring whitelist + explicit lists govern PRIMARY (governed months use
// the explicit list only); since 9/22 backup is any day not explicitly unavailable.
const burchettRecurring = (d) => (weekday(d) === "Mon" && [2, 4].includes(nthOf(d))) || (weekday(d) === "Tue" && nthOf(d) === 1) || (weekday(d) === "Wed" && [2, 4].includes(nthOf(d)));
const explicitDates = (obj) => { const s = new Set(); Object.keys(obj || {}).forEach((m) => (Array.isArray(obj[m]) ? obj[m] : []).forEach((d) => s.add(d))); return s; };
const BUR_AVAIL = explicitDates(SR[BURCHETT].explicitAvailable), BUR_BACKUP_ONLY = explicitDates(SR[BURCHETT].explicitBackupOnly), BUR_UNAVAIL = explicitDates(SR[BURCHETT].explicitUnavailable);
const BUR_GOVERNED = new Set(SR[BURCHETT].explicitListMonths.map((e) => (typeof e === "string" ? e : e.month)));
function burchettMay(d, role) {
  if (BUR_UNAVAIL.has(d)) return false;     // explicit rows are never waived
  if (role === B) return true;              // 9/22: backup any day
  if (BUR_BACKUP_ONLY.has(d)) return false; // a backup_only row blocks primary
  if (isHoliday(d)) return true;            // day rules do not apply on holiday-unit days (rules doc section 5)
  if (BUR_AVAIL.has(d)) return true;
  if (BUR_GOVERNED.has(monthOf(d))) return false;
  return burchettRecurring(d) || isWeekend(d);
}
// Acton: 2nd/4th Mon + Wed blocked for PRIMARY; October governed for primary by his explicit list (backup open since 9/22).
const ACT_OCT = SR[ACTON].explicitAvailable["2026-10"];
const actonBlockedRecurring = (d) => ["Mon", "Wed"].includes(weekday(d)) && [2, 4].includes(nthOf(d));
// Philip: Aledo days = 1st/3rd Wednesday + the Friday of the Mon-Sun week containing the 3rd Wednesday.
function isAledoDay(d) {
  if (weekday(d) === "Wed" && [1, 3].includes(nthOf(d))) return true;
  if (weekday(d) === "Fri") {
    for (let step = 0; step < 2; step++) {
      let y = +d.slice(0, 4), m = +d.slice(5, 7) + step;
      if (m > 12) { m = 1; y++; }
      const wed3 = nthWeekdayOfMonth(y, m, "Wed", 3);
      if (wed3 && mondayOf(wed3) === mondayOf(d)) return true;
    }
  }
  return false;
}
const PHILIP_WEEK_DAYS = new Set();
SR[PHILIP].availableWeeks.forEach((mon) => { for (let k = 0; k < 7; k++) PHILIP_WEEK_DAYS.add(addDays(mon, k)); });
const PHILIP_WEEKS_FROM = SR[PHILIP].availableWeeks.slice().sort()[0].slice(0, 7) + "-01";
const PHILIP_OCT_PRIMARY = new Set(SR[PHILIP].explicitAvailable["2026-10"].primary);
const PHILIP_NO_BACKUP = explicitDates(SR[PHILIP].explicitBackupUnavailable);
// Sarkar windows.
const SARKAR_WINDOW = new Set();
SR[SARKAR].availableWindows.forEach((w) => daysList(w.start, w.end).forEach((d) => SARKAR_WINDOW.add(d)));
// Weekend styles.
const BLOCK_STYLE = IDS.filter((id) => SR[id].weekendStyle === "block");
eq(BLOCK_STYLE.sort(), [KHAN, PHILIP, FIERCE].sort(), "seed: block-style surgeons are Khan, Philip, Fierce");
// Caps (an explicit null never falls back to the default).
eq(SR[ACTON].monthlyCap, null, "seed: Acton uncapped"); eq(SR[KHAN].monthlyCap, null, "seed: Khan uncapped");
const DEFAULT_CAP = seed.groupRules.defaultMonthlyCap.total; // 8: Philip (no key) falls back to it
eq(SR[BURCHETT].monthlyCap, { total: 8, preferred: 7 }, "seed: Burchett cap 8 / preferred 7");
eq(SR[FIERCE].monthlyCap.total, 14, "seed: Fierce cap 14"); ok(!("monthlyCap" in SR[PHILIP]), "seed: Philip has no cap key");
// Targets: nobody has a numeric target; Khan and Sarkar carry an explicit null (no fairness target).
IDS.forEach((id) => ok(typeof SR[id].monthlyTarget !== "number", "seed: " + CODE[id] + " has a numeric target"));
eq([KHAN, SARKAR].every((id) => "monthlyTarget" in SR[id] && SR[id].monthlyTarget === null), true, "seed: Khan and Sarkar explicit null target");
// Hard-reason vocabulary (rules doc sections 3-5; guide section 5). A reason in
// diagnostics.uncovered must start with one of these; anything else is a renamed,
// bogus or placeholder reason. Holiday-unit reasons carry "@YYYY-MM-DD".
const REASON_PREFIXES = [
  "time-off:", "day-before-vacation", "unavailable-row", "no-backup-row", "backup-only-row", "inactive", "holiday-opt-out:", "backup-opt-out",
  "hard-never-weekday:", "recurring-unavailable:", "weekday-not-allowed:", "weekend-block-only", "weekday-pattern:", "day-before-aledo",
  "whitelist-month", "not-recurring-available", "outside-available-weeks", "outside-window",
  "east-busy", "east-forecast-busy:", "derived-lock:", "derived-lock-held:", "slot-locked:", "external-cover", "holds-other-role",
  "monthly-cap:", "max-consecutive:", "backup-cap:", "backup-weekend-cap:", "window-week-max:", "max-major-holidays:"
];
// These two mean the GENERATOR (not a rule) left the slot open - always a failure.
const PLACEHOLDER_REASONS = ["eligible-but-not-placed", "holiday-unit:eligible-but-unit-not-filled"];
function reasonOk(r) {
  if (typeof r !== "string" || !r) return false;
  const at = r.indexOf("@");
  const core = at < 0 ? r : r.slice(0, at);
  if (at >= 0 && !/^\d{4}-\d{2}-\d{2}$/.test(r.slice(at + 1))) return false;
  return REASON_PREFIXES.some((p) => core.indexOf(p) === 0);
}
// 9/22 positive pins (review of item I): an uncovered BACKUP slot may never cite a
// primary-only rule for any surgeon - if it does, the engine has re-closed backup.
// Fierce's pattern reasons join the list because the seed pins backup:true on every
// weekday; hard-never-weekday joins for a surgeon whose roles list is primary only;
// the trailing edge and day-before-Aledo are pinned primary-only above; East never
// blocks backup (eastBlocksBackup false).
const PRIMARY_ONLY_FOR_BACKUP = ["recurring-unavailable:", "weekday-not-allowed:", "whitelist-month", "not-recurring-available", "outside-available-weeks", "day-before-aledo", "day-before-vacation", "east-busy", "east-forecast-busy:"]
  .concat(WD.every((w) => FIERCE_WP[w].backup === true) ? ["weekday-pattern:", "weekend-block-only"] : []);
function primaryOnlyReasonForBackup(id, r) {
  const core = String(r).split("@")[0];
  if (core.indexOf("hard-never-weekday:") === 0) return !hardNeverApplies(id, B);
  return PRIMARY_ONLY_FOR_BACKUP.some((p) => core.indexOf(p) === 0);
}
// ...and, across all runs, the generator must actually USE the loosened backup
// rules at least once each (otherwise an engine that re-closes backup would pass
// because the other surgeons fill every slot).
const SAW = { "Khan backup on an OR day (Tue/Thu)": 0, "Burchett backup on a day off his recurring list": 0, "Acton backup on an outreach 2nd/4th Mon/Wed": 0, "Philip backup outside his listed weeks": 0, "Fierce backup on a Clinton Tue/Thu outside a derived week": 0 };

/* ------------------------------------------------------------ helpers */
const RANGES = [
  { name: "R1 Oct (imports locked)", start: "2026-10-05", end: "2026-11-01" },
  { name: "R2 Nov-Dec", start: "2026-11-02", end: "2026-12-31" },
  { name: "R3 Jan-Mar", start: "2027-01-01", end: "2027-03-31" },
  { name: "R4 milestone 2026-11-02..2027-01-03", start: "2026-11-02", end: "2027-01-03" }
];
function lockedIn(day, role) { const e = INPUT[day]; return !!(e && e[role + "Locked"]); }
function derivedLock(day, role, id) { return DERIVED_ROLE[day] === role && id === FIERCE; }
// Expected diagnostics.lockViolations per range, restated from the inputs alone
// (locks are facts the generator keeps; the conflicts must be REPORTED):
//   R1  Philip's locked October is 15 days > the default cap of 8 -> every locked
//       Philip slot in 2026-10 (monthly-cap; his 8 backups also break backup-cap 7),
//       plus Fierce's single locked Monday primary 10/12 outside any derived week
//       (weekday-pattern:Mon - October is not derived).
//   R2  Khan's import-locked Thanksgiving primaries on the synthetic East-busy days
//       11/26, 11/27, 11/28 (east-busy); 11/29 is not East-busy.
//   R3  nothing is locked -> empty.
function expectedLockViolations(range) {
  const out = [];
  const philipOct = monthDays("2026-10").filter((d) => holdsAny(INPUT, d, PHILIP)).length;
  Object.keys(INPUT).sort().forEach((d) => {
    if (d < range.start || d > range.end) return;
    ROLES.forEach((role) => {
      const e = INPUT[d];
      if (!e[role + "Locked"] || !e[role]) return;
      if (e[role] === PHILIP && monthOf(d) === "2026-10" && philipOct > DEFAULT_CAP) out.push({ day: d, role, id: PHILIP, lock: "import", prefix: "monthly-cap:" });
      if (e[role] === FIERCE && role === P && weekday(d) === "Mon" && !DERIVED_ROLE[d]) out.push({ day: d, role, id: FIERCE, lock: "import", prefix: "weekday-pattern:Mon" });
      if (e[role] === KHAN && role === P && KHAN_BUSY.includes(d)) out.push({ day: d, role, id: KHAN, lock: "import", prefix: "east-busy" });
    });
  });
  return out.sort((a, b) => (a.day + a.role).localeCompare(b.day + b.role));
}
function makeView(out) {
  // merged view: generated range from the output, everything else from the published input
  const v = Object.assign({}, INPUT);
  Object.keys(out.schedule).forEach((d) => { v[d] = out.schedule[d]; });
  return v;
}
function holder(view, d, role) { const e = view[d]; return e ? (e[role] || null) : null; }
function holdsAny(view, d, id) { const e = view[d]; return !!(e && (e.primary === id || e.backup === id)); }
function isPlaced(out, d, role) { const id = out.schedule[d] && out.schedule[d][role]; return !!(id && !lockedIn(d, role) && !derivedLock(d, role, id)); }
function inUncovered(out, d, role) { return out.diagnostics.uncovered.some((u) => u.day === d && u.role === role); }
function maxRun(view, days, pred) { let run = 0, best = 0; days.forEach((d) => { if (pred(d)) { run++; if (run > best) best = run; } else run = 0; }); return best; }
// Prompt 12 A: a holiday-unit day keys to its unit only for a surgeon who opted in (Khan); everyone else counts real days.
const runKey = (id, d) => (COLLAPSE.has(id) && HOLIDAY[d]) ? "H:" + HOLIDAY[d].name + ":" + HOLIDAY[d].days[0] : d;
// item G: independent run lengths of the runs TOUCHING `days` (the range days), each run followed across the
// range edges through the merged view (a run that starts in the locked import before the range reads its full
// length - review 9/22 item A, fix stage; the same walk helpers ttRunThrough does):
// maxConsecutive = PRIMARY-only (countBackupInConsecutive:false), maxConsecutiveAnyRole = either role.
function runLengths(view, days, id) {
  const longest = (pred) => {
    let best = 0;
    days.forEach((d, i) => {
      if (!pred(d) || (i > 0 && pred(days[i - 1]))) return; // the first counted day of a run inside the range
      const keys = new Set([runKey(id, d)]);
      for (let x = addDays(d, -1), g = 0; g < 400 && pred(x); x = addDays(x, -1), g++) keys.add(runKey(id, x));
      for (let x = addDays(d, 1), g = 0; g < 400 && pred(x); x = addDays(x, 1), g++) keys.add(runKey(id, x));
      if (keys.size > best) best = keys.size;
    });
    return best;
  };
  return { maxConsecutive: longest((d) => holder(view, d, P) === id), maxConsecutiveAnyRole: longest((d) => holdsAny(view, d, id)) };
}

/* ------------------------------------------------------- the checks */
// deep: also compare diagnostics.tallies[id].range run lengths with runLengths() (every R4 run + the bestOf-200 run).
function checkRun(out, range, seedNo, deep) {
  CUR.range = range.name; CUR.seed = seedNo; CUR.day = "-";
  const days = daysList(range.start, range.end);
  const months = []; days.forEach((d) => { const m = monthOf(d); if (!months.includes(m)) months.push(m); });
  const view = makeView(out);
  const D = out.diagnostics;

  // contract: shape, purity, writes confined to the range
  ok(ctx.schedule === ORIGINAL_SCHEDULE_REF, "generate() must restore ctx.schedule");
  eq(Object.keys(out.schedule).sort(), days, "output holds exactly the range days");
  ["seed", "bestOf", "candidatesTried", "candidateScores", "score", "tallies", "uncovered", "softPenalties", "lockViolations", "holidayUnits", "weekendUnits", "impliedTargets", "eastFeedSnapshot", "eastForecast", "eastUnknownDays", "warnings", "truncated", "hardViolations"].forEach((k) => ok(k in D, "diagnostics." + k + " missing"));
  eq(D.seed, seedNo, "diagnostics.seed"); eq(D.truncated, false, "not truncated");
  eq(D.hardViolations, [], "generator reports hard violations: " + JSON.stringify(D.hardViolations));
  eq(D.score.hardViolations, 0, "score.hardViolations");
  days.forEach((d) => { const e = out.schedule[d]; ["primary", "backup", "primaryLocked", "backupLocked", "source", "externalCover", "note"].forEach((k) => ok(k in e, d + " entry lacks " + k)); });

  // item 12 (per run): best-of-N returns the minimum-score candidate
  eq(D.candidateScores.length, D.candidatesTried, "candidateScores length");
  eq(D.score.total, Math.min.apply(null, D.candidateScores), "score.total is the minimum candidate score");
  // item 1 (run level): the generator never leaves a fillable slot open, and says so
  ok(!D.warnings.some((w) => /generator bug/.test(w)), "generator reports its own bug: " + JSON.stringify(D.warnings.filter((w) => /generator bug/.test(w))));
  const openCount = { primary: 0, backup: 0 };

  days.forEach((d) => {
    CUR.day = d;
    const e = out.schedule[d];
    // item 1: covered XOR uncovered-with-reasons, per role; every reason is a real rule
    const covered = { primary: !!(e.primary || e.externalCover), backup: !!e.backup };
    ROLES.forEach((role) => {
      const listed = inUncovered(out, d, role);
      if (covered[role]) ok(!listed, role + " is filled AND listed as uncovered");
      else {
        openCount[role]++;
        ok(listed, role + " is empty but not in diagnostics.uncovered");
        const u = D.uncovered.find((x) => x.day === d && x.role === role);
        IDS.forEach((id) => {
          ok(Array.isArray(u.reasons[id]) && u.reasons[id].length > 0, "uncovered " + role + " has no reason for " + id);
          u.reasons[id].forEach((r) => {
            ok(!PLACEHOLDER_REASONS.includes(String(r).split("@")[0]), "uncovered " + role + ": " + CODE[id] + " is eligible but the generator left the slot open (" + r + ")");
            ok(reasonOk(r), "uncovered " + role + ": " + CODE[id] + " has a reason outside the rule vocabulary: " + JSON.stringify(r));
            if (role === B) ok(!primaryOnlyReasonForBackup(id, r), "uncovered backup: " + CODE[id] + " blocked by a PRIMARY-only rule (" + r + ") - backup is open to everyone since 9/22");
          });
        });
      }
    });
    // item 2
    if (e.primary && e.backup) ok(e.primary !== e.backup, "primary === backup (" + e.primary + ")");
    // item 3: import/manual locks byte-identical
    const inp = INPUT[d];
    if (inp) ROLES.forEach((role) => {
      if (!inp[role + "Locked"]) return;
      eq(e[role], inp[role], "locked " + role + " changed");
      eq(e[role + "Locked"], true, "lock flag dropped on " + role);
      eq(e.externalCover, inp.externalCover, "externalCover changed");
      eq(e.source, inp.source, "source changed on a locked day");
      eq(e.note, inp.note, "note changed on a locked day");
    });
    // item 9a: Fierce derived weeks appear whole, correct role, as locks
    if (DERIVED_ROLE[d] && !lockedIn(d, DERIVED_ROLE[d])) {
      const role = DERIVED_ROLE[d];
      eq(e[role], FIERCE, "derived " + role + " not held by Fierce");
      eq(e[role + "Locked"], true, "derived " + role + " not locked");
      if (!inp || (!inp.primaryLocked && !inp.backupLocked)) eq(e.source, "east-derived", "derived day source");
    }
    ROLES.forEach((role) => {
      if (!isPlaced(out, d, role)) return;
      const id = e[role];
      // item 4
      ok(!VAC[id].has(d), CODE[id] + " placed on a vacation day");
      if (role === P) ok(!DAY_BEFORE_VAC[id].has(d), CODE[id] + " placed PRIMARY the day before a vacation");
      // item 5 (9/22: his OR days block the roles his hardNeverWeekdaysRoles list names - primary only in the seed)
      if (id === KHAN) {
        if (!isHoliday(d) && hardNeverApplies(KHAN, role)) ok(!["Tue", "Thu"].includes(weekday(d)), "Khan " + role + " on a " + weekday(d));
        if (role === P) ok(!KHAN_NO_PRIMARY.has(d), "Khan PRIMARY on an East busy/forecast-busy day");
      }
      // item 6 (9/22: outreach days and the governed October restrict primary only)
      if (id === ACTON) {
        if (role === P && !isHoliday(d)) ok(!actonBlockedRecurring(d), "Acton PRIMARY on a 2nd/4th " + weekday(d));
        ok(!(d >= "2026-11-19" && d <= "2026-11-22") && !(d >= "2026-11-25" && d <= "2026-11-29"), "Acton on his November time off");
        ok(!(HOLIDAY[d] && HOLIDAY[d].name === "Thanksgiving"), "Acton on a Thanksgiving unit day");
        if (role === P && monthOf(d) === "2026-10" && !isHoliday(d)) ok(ACT_OCT.primary.includes(d), "Acton October PRIMARY is governed by his explicit list");
      }
      // item 7 (9/22: backup any day unless explicitly unavailable)
      if (id === BURCHETT) ok(burchettMay(d, role), "Burchett " + role + " on a day his rules exclude (" + weekday(d) + ")");
      // item 8 (9/22: the weeks whitelist and the Aledo rules restrict primary only; the backup cap and no_backup rows stay)
      if (id === PHILIP) {
        if (role === P && !isHoliday(d)) ok(!isAledoDay(addDays(d, 1)), "Philip PRIMARY the day before an Aledo day");
        ok(d !== "2026-10-15", "Philip on 2026-10-15");
        if (role === B) ok(!PHILIP_NO_BACKUP.has(d), "Philip backup on a no-backup date");
        if (monthOf(d) === "2026-10" && role === P && !isHoliday(d)) ok(PHILIP_OCT_PRIMARY.has(d), "Philip October primary outside his list");
        if (role === P && d >= PHILIP_WEEKS_FROM && !isHoliday(d)) ok(PHILIP_WEEK_DAYS.has(d) || PHILIP_OCT_PRIMARY.has(d), "Philip PRIMARY outside his available weeks");
      }
      // item 9b: Fierce outside derived weeks follows his per-role weekday pattern
      // (pinned above: primary Mon/Tue/Thu never, Wed yes, Fri-Sun block only; backup any day since 9/22)
      if (id === FIERCE) {
        ok(!DERIVED_ROLE[d] || DERIVED_ROLE[d] === role, "Fierce placed in the wrong role inside a derived week");
        if (!DERIVED_ROLE[d] && !isHoliday(d)) {
          const pd = FIERCE_WP[weekday(d)] || {};
          ok(pd[role] === true || pd[role] === "weekend-block-only", "Fierce " + role + " on a " + weekday(d) + " his pattern excludes");
          if (pd[role] === "weekend-block-only") {
            const fri = fridayOf(d);
            const block = [0, 1, 2].every((k) => holder(view, addDays(fri, k), role) === FIERCE && !isHoliday(addDays(fri, k)));
            ok(block, "Fierce holds " + weekday(d) + " " + d + " as " + role + " without the full Fri+Sat+Sun block");
          }
        }
      }
      // item 10 (9/22: windows govern both roles; Fri/Sun follows her hardNeverWeekdaysRoles list - primary only in the seed)
      if (id === SARKAR) {
        ok(SARKAR_WINDOW.has(d), "Sarkar " + role + " outside her windows");
        if (hardNeverApplies(SARKAR, role)) ok(!["Fri", "Sun"].includes(weekday(d)), "Sarkar " + role + " on a " + weekday(d));
      }
      // 9/22: an explicit backup opt-out is hard on every backup slot
      if (role === B) ok(!OPTED_OUT.has(id), CODE[id] + " placed as backup although opted out");
      // 9/22 positive sightings (asserted once at the end: each must happen somewhere in the 150 runs)
      if (role === B && !isHoliday(d)) {
        if (id === KHAN && ["Tue", "Thu"].includes(weekday(d))) SAW["Khan backup on an OR day (Tue/Thu)"]++;
        if (id === BURCHETT && !isWeekend(d) && !burchettRecurring(d) && !BUR_AVAIL.has(d)) SAW["Burchett backup on a day off his recurring list"]++;
        if (id === ACTON && actonBlockedRecurring(d)) SAW["Acton backup on an outreach 2nd/4th Mon/Wed"]++;
        if (id === PHILIP && d >= PHILIP_WEEKS_FROM && !PHILIP_WEEK_DAYS.has(d)) SAW["Philip backup outside his listed weeks"]++;
        if (id === FIERCE && !DERIVED_ROLE[d] && ["Tue", "Thu"].includes(weekday(d))) SAW["Fierce backup on a Clinton Tue/Thu outside a derived week"]++;
      }
      // item 11 (independent half): a block-style surgeon's lone weekend day needs a fallback-flagged unit
      if (BLOCK_STYLE.includes(id) && isWeekend(d) && !isHoliday(d)) {
        const fri = fridayOf(d);
        const present = [0, 1, 2].map((k) => addDays(fri, k)).filter((x) => days.includes(x) && !isHoliday(x));
        const holdsAll = present.every((x) => holder(view, x, role) === id);
        if (!holdsAll) {
          const wu = D.weekendUnits.find((w) => w.friday === fri);
          ok(wu && wu.roles[role] && wu.roles[role].fallback === true, CODE[id] + " holds a lone weekend day (" + d + " " + role + ") in a unit not flagged fallback");
        }
      }
    });
  });
  CUR.day = "-";
  // item 1: the score counts the same open slots the calendar shows
  eq(D.score.uncoveredPrimary, openCount.primary, "score.uncoveredPrimary vs open primary slots");
  eq(D.score.uncoveredBackup, openCount.backup, "score.uncoveredBackup vs open backup slots");
  eq(D.uncovered.length, openCount.primary + openCount.backup, "diagnostics.uncovered length vs open slots");

  // locks are facts, conflicts are reported: diagnostics.lockViolations is exactly
  // the restated set (never a generator-placed slot), and the summary warning names the count
  const expLV = expectedLockViolations(range);
  const gotLV = D.lockViolations.map((l) => ({ day: l.day, role: l.role, id: l.id, lock: l.lock })).sort((a, b) => (a.day + a.role).localeCompare(b.day + b.role));
  eq(gotLV, expLV.map((l) => ({ day: l.day, role: l.role, id: l.id, lock: l.lock })), "lockViolations set");
  D.lockViolations.forEach((l) => {
    CUR.day = l.day;
    ok(lockedIn(l.day, l.role) || derivedLock(l.day, l.role, l.id), "lockViolation on a slot that is not locked in the input");
    eq(INPUT[l.day] && INPUT[l.day][l.role], l.id, "lockViolation holder differs from the input lock");
    const exp = expLV.find((x) => x.day === l.day && x.role === l.role);
    ok(l.reasons.some((r) => r.indexOf(exp.prefix) === 0), "lockViolation reasons " + JSON.stringify(l.reasons) + " lack " + exp.prefix);
    if (exp.id === PHILIP && l.role === B) ok(l.reasons.some((r) => r.indexOf("backup-cap:") === 0), "Philip locked backup day lacks backup-cap");
  });
  CUR.day = "-";
  if (expLV.length) ok(D.warnings.includes(expLV.length + " locked slot(s) break a rule - kept as facts, see lockViolations"), "missing the lock-violation summary warning for " + expLV.length + " slot(s)");
  else ok(!D.warnings.some((w) => /locked slot\(s\) break a rule/.test(w)), "lock-violation warning although nothing is locked");

  // implied targets (quality-2): locked days count toward the share, never on top;
  // an implied target never sits on the cap: clip = min(preferred, cap - 1) - East-only days
  months.forEach((m) => {
    const I = D.impliedTargets.months[m];
    ok(I && typeof I.share === "number", "impliedTargets for " + m);
    eq(I.capClip[BURCHETT], 7, "Burchett clip = preferred 7 in " + m);
    eq(I.capClip[PHILIP], DEFAULT_CAP - 1, "Philip clip = default cap - 1 in " + m);
    eq(I.capClip[FIERCE], 14 - 1 - I.eastOnlyDays[FIERCE], "Fierce clip = 13 minus East-only days in " + m);
    eq(I.capClip[ACTON], null, "Acton has no clip in " + m);
    Object.keys(I.targets).forEach((id) => {
      const t = I.targets[id], held = I.lockedHeld[id], clip = I.capClip[id];
      ok(t >= held, CODE[id] + " implied target " + t + " below his locked days " + held + " in " + m);
      ok(t <= Math.max(held, clip === null ? Infinity : clip), CODE[id] + " implied target " + t + " above his clip " + clip + " in " + m);
      ok(t <= Math.max(held, I.share) + 0.05, CODE[id] + " implied target " + t + " exceeds max(held, share) in " + m);
    });
    // Khan: explicit null -> no fairness target (tallies show none) but a neutral scoring term; Sarkar (windows): no term at all
    ok(!(KHAN in I.targets) && typeof I.neutralTerm[KHAN] === "number", "Khan must carry a neutral scoring term, not a target, in " + m);
    ok(!(SARKAR in I.targets) && !(SARKAR in I.neutralTerm) && I.noTerm.includes(SARKAR), "Sarkar must carry no target term in " + m);
    eq(D.tallies[KHAN].months[m].target, null, "Khan tallies target must stay null in " + m);
  });
  if (range.name.indexOf("R2") === 0) {
    const nov = D.impliedTargets.months["2026-11"];
    eq(nov.lockedHeld[FIERCE], 7, "Fierce holds his 7 derived November days before generation");
    ok(nov.targets[FIERCE] < 14 && nov.targets[FIERCE] <= nov.share + 0.05, "Fierce November implied target " + nov.targets[FIERCE] + " must not be pushed to his cap by the derived week");
  }

  // quality-1 (Nov-Dec, the milestone range with the real forecast): Khan's main
  // contribution is weekends. Among the weekends where he is primary-eligible all
  // three days (in range, no holiday day, no East busy / forecast-busy day, no
  // vacation edge, no lock to someone else) he must hold at least one full
  // Fri+Sat+Sun primary block per run: a no-target surgeon must not become the
  // backup sink. Not asserted for Oct (locked import) or Jan-Mar: there the feed
  // carries forecast doubt (0 < p < threshold = east-forecast soft, +2 per day)
  // on every weekend and, from 2027-02-22, no data at all (east-unknown, +1 per
  // day), which legitimately ranks him behind surgeons at 0 soft - and nothing
  // models surgeonRules.primaryContribution = "weekends" yet (rules.js follow-up).
  if (range.name.indexOf("R2") === 0) {
    const khanWeekends = [];
    days.filter((d) => weekday(d) === "Fri").forEach((f) => {
      const trio = [0, 1, 2].map((k) => addDays(f, k));
      if (!trio.every((d) => days.includes(d) && !isHoliday(d) && !KHAN_NO_PRIMARY.has(d) && !VAC[KHAN].has(d) && !DAY_BEFORE_VAC[KHAN].has(d) && !(lockedIn(d, P) && INPUT[d].primary !== KHAN) && !(INPUT[d] && INPUT[d].externalCover))) return;
      khanWeekends.push(trio);
    });
    ok(khanWeekends.length >= 1, "Nov-Dec must offer Khan at least one eligible weekend (fixture drift?)");
    ok(khanWeekends.some((trio) => trio.every((d) => out.schedule[d].primary === KHAN)), "Khan holds no full weekend primary block although " + khanWeekends.length + " weekend(s) are open to him: " + khanWeekends.map((t) => t[0]).join(", "));
  }

  // per-month counters (flagged only when a generator-placed day contributes)
  months.forEach((m) => {
    CUR.day = m;
    const mdays = monthDays(m);
    const placedIn = (id, role) => mdays.some((d) => out.schedule[d] && isPlaced(out, d, role) && out.schedule[d][role] === id);
    // item 7: Burchett <= 8 total per month
    const burTotal = mdays.filter((d) => holdsAny(view, d, BURCHETT)).length;
    if (placedIn(BURCHETT, P) || placedIn(BURCHETT, B)) ok(burTotal <= 8, "Burchett " + burTotal + " days in " + m);
    // item 7: Acton / Khan uncapped -> the generator never cites a monthly cap for them
    D.uncovered.forEach((u) => { if (monthOf(u.day) === m) [ACTON, KHAN].forEach((id) => ok(!u.reasons[id].some((r) => String(r).indexOf("monthly-cap") === 0), CODE[id] + " blocked by a monthly cap on " + u.day)); });
    // item 8: Philip backup <= 7 days and <= 1 weekend per month
    const phBackups = mdays.filter((d) => holder(view, d, B) === PHILIP);
    const phWeekends = new Set(phBackups.filter(isWeekend).map(fridayOf));
    if (placedIn(PHILIP, B)) { ok(phBackups.length <= 7, "Philip " + phBackups.length + " backup days in " + m); ok(phWeekends.size <= 1, "Philip backup on " + phWeekends.size + " weekends in " + m); }
    // item 9c: Fierce Silvis days + East week days <= 14 (distinct days)
    const fierceDays = mdays.filter((d) => holdsAny(view, d, FIERCE) || FIERCE_EAST_DAYS.has(d)).length;
    if (placedIn(FIERCE, P) || placedIn(FIERCE, B)) ok(fierceDays <= 14, "Fierce " + fierceDays + " call days in " + m);
    // item 10: Sarkar <= 4 days per window week (Mon-Sun)
    const mondays = new Set(mdays.map(mondayOf));
    mondays.forEach((mon) => {
      const wk = [0, 1, 2, 3, 4, 5, 6].map((k) => addDays(mon, k));
      const n = wk.filter((d) => holdsAny(view, d, SARKAR)).length;
      if (wk.some((d) => out.schedule[d] && (isPlaced(out, d, P) && out.schedule[d][P] === SARKAR || isPlaced(out, d, B) && out.schedule[d][B] === SARKAR))) ok(n <= 4, "Sarkar " + n + " days in week of " + mon);
    });
  });
  // consecutive PRIMARY runs (primary-only per countBackupInConsecutive:false) for ALL SIX at the seed's
  // maxConsecutiveDays, across the WHOLE range plus the 7 days before it (no month cut - Prompt 12 A / review G);
  // holiday-unit days collapse to one only for an opted-in surgeon; a run counts when it contains a placed day
  const ctxDays = daysList(addDays(range.start, -7), range.end);
  function checkRuns(id) {
    const limit = SR[id].maxConsecutiveDays;
    let run = [];
    const flush = () => {
      if (run.length) {
        const n = new Set(run.map((d) => runKey(id, d))).size;
        if (n > limit && run.some((d) => isPlaced(out, d, P) && out.schedule[d][P] === id)) { CUR.day = run[0]; fail(NAME[id] + " " + n + " consecutive primary days (limit " + limit + "; " + run.length + " real days) from " + run[0] + " to " + run[run.length - 1]); }
      }
      run = [];
    };
    ctxDays.forEach((d) => { if (holder(view, d, P) === id) run.push(d); else flush(); });
    flush();
    N++;
  }
  IDS.forEach(checkRuns);  // items 7 (Burchett 2), 10 (Sarkar 2) and, since Prompt 12 A, Khan 3 / Acton 3 / Philip 4 / Fierce 7
  // item G: the preview's run columns must equal the harness's own computation
  if (deep) {
    IDS.forEach((id) => {
      CUR.day = "-";
      const exp = runLengths(view, days, id), got = (D.tallies[id] && D.tallies[id].range) || {};
      eq(got.maxConsecutive, exp.maxConsecutive, CODE[id] + " diagnostics.tallies.range.maxConsecutive (primary-only, real days) vs the harness");
      eq(got.maxConsecutiveAnyRole, exp.maxConsecutiveAnyRole, CODE[id] + " diagnostics.tallies.range.maxConsecutiveAnyRole vs the harness");
    });
  }
  // item 8: Philip <= 1 major holiday unit (all units are within a rolling 12 months here)
  const phMajors = HOLIDAY_UNITS.filter((u) => u.tier === "major" && u.days.some((d) => holdsAny(view, d, PHILIP)));
  const phPlacedHoliday = phMajors.some((u) => u.days.some((d) => out.schedule[d] && ROLES.some((role) => isPlaced(out, d, role) && out.schedule[d][role] === PHILIP)));
  if (phPlacedHoliday) ok(phMajors.length <= 1, "Philip holds " + phMajors.length + " major holiday units");

  // item 11 (diagnostics half): unflagged units keep block-style members on every present day
  D.weekendUnits.forEach((w) => {
    CUR.day = w.friday;
    w.present.forEach((d) => ok(!isHoliday(d), "weekend unit lists a holiday day as present"));
    ROLES.forEach((role) => {
      const rd = w.roles[role];
      if (!rd || rd.fallback) return;
      const members = [rd.members.fri, rd.members.sat, rd.members.sun].filter((v, i, a) => v && a.indexOf(v) === i);
      members.forEach((id) => { if (BLOCK_STYLE.includes(id)) ok(w.present.every((d) => holder(view, d, role) === id), CODE[id] + " (block style) does not hold every present day of an unflagged " + rd.kind + " unit"); });
    });
  });

  // item 13: holiday units
  HOLIDAY_UNITS.forEach((u) => {
    const inRange = u.days.filter((d) => days.includes(d));
    if (!inRange.length) return;
    CUR.day = u.days[0];
    ROLES.forEach((role) => {
      const holders = inRange.map((d) => holder(view, d, role));
      const distinct = holders.filter((v, i, a) => a.indexOf(v) === i);
      if (distinct.length === 1 && distinct[0]) return; // one surgeon throughout
      ok(!distinct.some((v) => v) || distinct.filter((v) => v).length <= 1, u.name + " " + role + " is split between " + JSON.stringify(distinct));
      inRange.forEach((d) => { if (!holder(view, d, role)) ok(inUncovered(out, d, role), u.name + " " + role + " " + d + " open but not listed uncovered"); });
    });
    // pre-emption: the weekend unit of an overlapping weekend must not list the holiday days
    inRange.filter(isWeekend).forEach((d) => {
      const w = D.weekendUnits.find((x) => x.friday === fridayOf(d));
      if (w) { ok(!w.present.includes(d), "weekend unit " + w.friday + " did not cede " + d + " to " + u.name); ok(w.preempted.includes(d), "weekend unit " + w.friday + " does not list " + d + " as preempted"); }
    });
    const hd = D.holidayUnits.find((h) => h.name === u.name && h.days[0] === u.days[0]);
    ok(hd, "holiday unit " + u.name + " missing from diagnostics.holidayUnits");
  });
  // Thanksgiving 2026: Khan primary Thu-Sun (locked in the import; asserted again by name)
  ["2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"].forEach((d) => { if (days.includes(d)) { CUR.day = d; eq(out.schedule[d].primary, KHAN, "Thanksgiving primary is not Khan"); eq(out.schedule[d].primaryLocked, true, "Thanksgiving primary not locked"); } });
  CUR.day = "-";
}

/* --------------------------------------------------------------- run */
// Coverage: see the header. bestOf per range; SILVIS_GEN_BEST_OF=n overrides every range (printed, budget not enforced).
const SEEDS = 50;
const BEST_OF_DEFAULT = [6, 5, 2, 2]; // R1 Oct, R2 Nov-Dec, R3 Jan-Mar, R4 milestone (Prompt 12 A)
const BEST_OF_OVERRIDE = process.env.SILVIS_GEN_BEST_OF ? Math.max(1, Math.floor(+process.env.SILVIS_GEN_BEST_OF)) : null;
const BEST_OF = RANGES.map((r, i) => BEST_OF_OVERRIDE || BEST_OF_DEFAULT[i]);
const BUDGET_MS = process.env.SILVIS_GEN_BUDGET_MS ? Math.floor(+process.env.SILVIS_GEN_BUDGET_MS) : 10000;
const timing = {}; RANGES.forEach((r) => { timing[r.name] = { ms: 0, runs: 0, candidates: 0 }; });
const r2Results = [];
const r2Json = new Set();
const R4_SEED = (s) => s % 2 === 0; // R4 on the even seeds only (budget; see the header)
for (let s = 1; s <= SEEDS; s++) {
  RANGES.forEach((range, ri) => {
    if (range.name.indexOf("R4") === 0 && !R4_SEED(s)) return;
    const t = Date.now();
    const out = GEN.generate(ctx, range.start, range.end, { seed: s, bestOf: BEST_OF[ri] });
    const el = Date.now() - t;
    timing[range.name].ms += el; timing[range.name].runs++; timing[range.name].candidates += out.diagnostics.candidatesTried;
    checkRun(out, range, s, range.name.indexOf("R4") === 0);
    if (ri === 1) { r2Results.push({ seed: s, score: out.diagnostics.score.total, out }); r2Json.add(JSON.stringify(out.schedule)); }
  });
}
CUR.range = "R2 Nov-Dec"; CUR.seed = "1/1"; CUR.day = "-";
// item 12: same seed -> deep-equal output; different seeds differ somewhere
const a1 = GEN.generate(ctx, RANGES[1].start, RANGES[1].end, { seed: 1, bestOf: BEST_OF[1] });
const a2 = GEN.generate(ctx, RANGES[1].start, RANGES[1].end, { seed: 1, bestOf: BEST_OF[1] });
eq(JSON.stringify(a1), JSON.stringify(a2), "same seed must give deep-equal schedule + diagnostics");
ok(r2Json.size > 1, "50 seeds produced only " + r2Json.size + " distinct Nov-Dec schedules");

/* ---------------------- rules-1: manual lock in the OTHER role of a derived day */
// test/fixtures/manual-lock-fierce-primary-2026-11-10.json makes Fierce PRIMARY
// (manual lock) on a day of his derived Silvis-BACKUP week. Import/manual locks
// beat derived locks (orientation section 3 item 16): the generator must keep the
// manual lock, skip the derived backup lock for that day with a warning, keep the
// other six derived days, report the collision in lockViolations, and the backup
// slot must be filled - or open with reasons that never cite the skipped derived
// lock. The last clause is the contract rules.rdDerivedOverridden currently
// misses (review finding rules-1; fix owned by rules.js) - a known gap until then.
{
  const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "manual-lock-fierce-primary-2026-11-10.json"), "utf8"));
  const input2 = SA.seedToContextInput(seed, { eastDerived: DERIVED, eastBusyDays: { [KHAN]: KHAN_BUSY }, eastFeedCoverage: EAST_COVER, eastForecast: { [KHAN]: FORECAST } });
  Object.keys(FIX.schedule).forEach((d) => { input2.schedule[d] = JSON.parse(JSON.stringify(FIX.schedule[d])); });
  const ctx2 = R.buildContext(input2);
  if (ctx2.warnings.length) fail("buildContext warnings (fixture): " + JSON.stringify(ctx2.warnings));
  CUR.range = "R2 + fixture manual lock"; CUR.seed = 1; CUR.day = "2026-11-10";
  const DAY = "2026-11-10";
  eq(DERIVED_ROLE[DAY], B, "fixture day must be inside a derived Silvis-backup week");
  eq(FIX.schedule[DAY].primary, FIERCE, "fixture locks Fierce as primary");
  const out2 = GEN.generate(ctx2, RANGES[1].start, RANGES[1].end, { seed: 1, bestOf: BEST_OF[1] });
  const D2 = out2.diagnostics, e2 = out2.schedule[DAY];
  eq(e2.primary, FIERCE, "manual primary lock kept"); eq(e2.primaryLocked, true, "manual lock flag kept"); eq(e2.source, "manual", "manual source kept");
  ok(e2.backup !== FIERCE, "Fierce cannot hold both roles");
  eq(e2.backupLocked, false, "the skipped derived backup lock must not reappear as a lock");
  ok(D2.warnings.some((w) => w.indexOf("derived lock skipped: " + DAY + " backup derived " + FIERCE) === 0), "missing the 'derived lock skipped' warning: " + JSON.stringify(D2.warnings));
  for (let k = 0; k < 7; k++) { const d = addDays("2026-11-09", k); if (d === DAY) continue; eq(out2.schedule[d].backup, FIERCE, "derived backup " + d + " must stay"); eq(out2.schedule[d].backupLocked, true, "derived backup " + d + " must stay locked"); }
  ok(D2.lockViolations.some((l) => l.day === DAY && l.role === P && l.id === FIERCE), "the manual lock's collision with his derived week must be reported in lockViolations");
  ok(!D2.warnings.some((w) => /generator bug/.test(w)), "fixture run: generator reports its own bug");
  eq(D2.hardViolations, [], "fixture run: hard violations");
  const listed2 = D2.uncovered.find((u) => u.day === DAY && u.role === B);
  if (e2.backup) ok(!listed2, "fixture: backup filled AND listed uncovered");
  else {
    ok(listed2, "fixture: backup open but not listed uncovered");
    IDS.forEach((id) => (listed2.reasons[id] || []).forEach((r) => ok(reasonOk(r) && !PLACEHOLDER_REASONS.includes(r), "fixture: bad reason " + r + " for " + CODE[id])));
    const citing = IDS.filter((id) => (listed2.reasons[id] || []).some((r) => r.indexOf("derived-lock-held:" + FIERCE) === 0));
    if (citing.length) knownGap("rules-1", "rules.js rdDerivedOverridden", DAY + " backup open; " + citing.map((id) => CODE[id]).join("/") + " blocked by derived-lock-held:" + FIERCE + " although the generator skipped that derived lock for his manual primary lock (a one-line fix in rdDerivedOverridden fills the slot - verified against a patched copy 2026-09-22)");
    else ok(true, "no surgeon cites the skipped derived lock");
  }
  CUR.range = "R2 Nov-Dec"; CUR.seed = "-"; CUR.day = "-";
}
// rangePresets contract
CUR.seed = "-";
const presets = GEN.rangePresets("2026-11-01");
eq(presets[0], { label: "Through end of year", start: "2026-11-02", end: "2027-01-03", months: null }, "rangePresets through end of year");
eq(presets.map((p) => p.label), ["Through end of year", "3 months", "6 months", "9 months", "12 months"], "preset labels");
presets.slice(1).forEach((p) => ok(!["Fri", "Sat"].includes(weekday(p.end)), p.label + " ends mid-weekend on " + p.end));
eq(presets[1].end, "2027-01-31", "3 months from 2026-11-02");
// genPrng determinism
const p1 = GEN.genPrng(42), p2 = GEN.genPrng(42);
eq([p1(), p1(), p1.int(100)], [p2(), p2(), p2.int(100)], "genPrng is deterministic");

/* ------------------------------------------------ the Nov-Dec table */
const tBig = Date.now();
const big = GEN.generate(ctx, RANGES[1].start, RANGES[1].end, { seed: 1, bestOf: 200 });
const bigMs = Date.now() - tBig;
checkRun(big, RANGES[1], 1, true); // seed 1, bestOf 200; deep = item G tally comparison
// 9/22 (item I review): with backup open to everyone the milestone preview has no
// open slot at all - the three Thursday backups (11/05, 11/19, 12/03) that only the
// old day rules left open are now fillable. Deterministic (genPrng, seed 1).
CUR.range = "R2 Nov-Dec bestOf 200"; CUR.seed = 1; CUR.day = "-";
eq(big.diagnostics.uncovered.map((u) => u.day + " " + u.role), [], "milestone preview (seed 1, bestOf 200): no uncovered slot");
// 9/22 positive sightings across the 150 runs + the bestOf-200 run
CUR.range = "all runs"; CUR.seed = "-"; CUR.day = "-";
Object.keys(SAW).forEach((k) => ok(SAW[k] > 0, "never saw: " + k + " (the loosened backup rule is not in force, or the runs changed - counts " + JSON.stringify(SAW) + ")"));
// 9/22 opt-out with real data: the shipped seed opts nobody out, so run Nov-Dec once
// with Acton (uncapped, a frequent backup filler) opted out - never placed as backup,
// still placed as primary, and every open backup slot names the opt-out for him.
{
  const srOpt = JSON.parse(JSON.stringify(SA.seedToSurgeonRules(seed))); srOpt[ACTON].backupOptOut = true;
  const inputOpt = SA.seedToContextInput(seed, { eastDerived: DERIVED, eastBusyDays: { [KHAN]: KHAN_BUSY }, eastFeedCoverage: EAST_COVER, eastForecast: { [KHAN]: FORECAST }, surgeonRules: srOpt });
  const ctxOpt = R.buildContext(inputOpt);
  if (ctxOpt.warnings.length) fail("buildContext warnings (opt-out run): " + JSON.stringify(ctxOpt.warnings));
  CUR.range = "R2 + Acton backupOptOut"; CUR.seed = 1; CUR.day = "-";
  const outOpt = GEN.generate(ctxOpt, RANGES[1].start, RANGES[1].end, { seed: 1, bestOf: 1 });
  const DO = outOpt.diagnostics;
  ok(!DO.warnings.some((w) => /generator bug/.test(w)), "opt-out run: generator reports its own bug");
  eq(DO.hardViolations, [], "opt-out run: hard violations");
  const actonBackups = Object.keys(outOpt.schedule).filter((d) => outOpt.schedule[d].backup === ACTON);
  eq(actonBackups, [], "opt-out run: Acton placed as backup on " + actonBackups.join(", "));
  ok(Object.keys(outOpt.schedule).some((d) => outOpt.schedule[d].primary === ACTON), "opt-out run: Acton must still be placed as primary (the opt-out is backup-only)");
  DO.uncovered.filter((u) => u.role === B).forEach((u) => ok((u.reasons[ACTON] || []).some((r) => String(r).indexOf("backup-opt-out") === 0), "opt-out run: open backup " + u.day + " does not name backup-opt-out for BDA: " + JSON.stringify(u.reasons[ACTON])));
  CUR.range = "R2 Nov-Dec"; CUR.seed = "-"; CUR.day = "-";
}
// Review 9/22 (item A, fix stage): a rules-context warning - here the ignored legacy group key
// groupRules.holidays.unitExemptFromMaxConsecutive that an older live blob still carries - must reach
// diagnostics.warnings so the Generate panel and preview-generate.js show it (console.warn is not visible
// to the scheduler). One cheap R1 run at bestOf 1.
{
  const grLegacy = JSON.parse(JSON.stringify(seed.groupRules)); grLegacy.holidays.unitExemptFromMaxConsecutive = true;
  const inputLeg = SA.seedToContextInput(seed, { eastDerived: DERIVED, eastBusyDays: { [KHAN]: KHAN_BUSY }, eastFeedCoverage: EAST_COVER, eastForecast: { [KHAN]: FORECAST }, groupRules: grLegacy });
  const ctxLeg = R.buildContext(inputLeg);
  CUR.range = "R1 + legacy group key"; CUR.seed = 1; CUR.day = "-";
  eq(ctxLeg.warnings.filter((w) => /unitExemptFromMaxConsecutive/.test(w)).length, 1, "buildContext: exactly one warning names the legacy key");
  const outLeg = GEN.generate(ctxLeg, RANGES[0].start, RANGES[0].end, { seed: 1, bestOf: 1 });
  ctxLeg.warnings.forEach((w) => ok(outLeg.diagnostics.warnings.includes(w), "ctx warning missing from diagnostics.warnings: " + w));
  eq(outLeg.diagnostics.warnings.filter((w) => /unitExemptFromMaxConsecutive/.test(w)).length, 1, "the legacy-key warning appears exactly once in diagnostics.warnings");
  CUR.range = "R2 Nov-Dec"; CUR.seed = "-"; CUR.day = "-";
}
// Review 9/22 (item A, fix stage): the tally run columns follow a run across the RANGE start and the MONTH
// edge. Philip's locked import primaries 10/29 -> 11/01 (4 days = his max) plus a manual primary lock on
// 11/02 (kept; reported as a lock violation) form a 5-day run that begins before the range: the range row
// and the 2026-11 month row must both read 5, not the in-range / in-month cut. One short run at bestOf 1.
{
  const inputEdge = SA.seedToContextInput(seed, { eastDerived: DERIVED, eastBusyDays: { [KHAN]: KHAN_BUSY }, eastFeedCoverage: EAST_COVER, eastForecast: { [KHAN]: FORECAST } });
  CUR.range = "range-edge fixture 2026-11-02..2026-11-08"; CUR.seed = 1; CUR.day = "2026-11-02";
  eq(["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"].map((d) => holder(inputEdge.schedule, d, P)), [PHILIP, PHILIP, PHILIP, PHILIP], "seed: Philip holds 10/29 -> 11/01 primary (locked import)");
  inputEdge.schedule["2026-11-02"] = { primary: PHILIP, backup: null, primaryLocked: true, backupLocked: false, source: "manual", externalCover: null, note: "harness: range-edge fixture" };
  const ctxEdge = R.buildContext(inputEdge);
  if (ctxEdge.warnings.length) fail("buildContext warnings (range-edge fixture): " + JSON.stringify(ctxEdge.warnings));
  const outEdge = GEN.generate(ctxEdge, "2026-11-02", "2026-11-08", { seed: 1, bestOf: 1 });
  eq(outEdge.schedule["2026-11-02"].primary, PHILIP, "manual primary lock kept");
  ok(outEdge.diagnostics.lockViolations.some((l) => l.day === "2026-11-02" && l.role === P && l.id === PHILIP), "the conflicting lock is reported as a lock violation: " + JSON.stringify(outEdge.diagnostics.lockViolations));
  const expEdge = runLengths(makeView(outEdge), daysList("2026-11-02", "2026-11-08"), PHILIP), gotEdge = outEdge.diagnostics.tallies[PHILIP].range;
  ok(expEdge.maxConsecutive >= 5 && expEdge.maxConsecutiveAnyRole >= 5, "harness: Philip's run through 11/02 reads at least 5 (got " + JSON.stringify(expEdge) + ")");
  eq(gotEdge.maxConsecutive, expEdge.maxConsecutive, "AFP diagnostics.tallies.range.maxConsecutive follows the run across the range start");
  eq(gotEdge.maxConsecutiveAnyRole, expEdge.maxConsecutiveAnyRole, "AFP diagnostics.tallies.range.maxConsecutiveAnyRole follows the run across the range start");
  const novEdge = outEdge.diagnostics.tallies[PHILIP].months["2026-11"];
  eq([novEdge.maxConsecutive, novEdge.maxConsecutiveAnyRole], [expEdge.maxConsecutive, expEdge.maxConsecutiveAnyRole], "AFP 2026-11 month row (talliesFor) follows the same run across the month edge");
  CUR.range = "R2 Nov-Dec"; CUR.seed = "-"; CUR.day = "-";
}
const sortedR2 = r2Results.slice().sort((a, b) => a.score - b.score);
const median = sortedR2[Math.floor(sortedR2.length / 2)];

function pad(s, n, right) { s = String(s); return right ? s.padEnd(n) : s.padStart(n); }
function printTallies(out, title) {
  const D = out.diagnostics;
  console.log("\n" + title);
  console.log("  score " + JSON.stringify(Object.assign({}, D.score, { weights: undefined })) + "; candidates " + D.candidatesTried + "; warnings " + D.warnings.length);
  console.log("  " + pad("surgeon", 8, true) + pad("month", 8, true) + pad("prim", 6) + pad("bkup", 6) + pad("total", 6) + pad("wkend", 6) + pad("major", 6) + pad("minor", 6) + pad("maxCP", 6) + pad("maxCA", 6) + pad("cap", 6) + pad("target", 8));
  Object.keys(D.tallies).forEach((id) => {
    const t = D.tallies[id];
    Object.keys(t.months).forEach((m) => {
      const x = t.months[m];
      console.log("  " + pad(t.code, 8, true) + pad(m, 8, true) + pad(x.primary, 6) + pad(x.backup, 6) + pad(x.total, 6) + pad(x.weekendDays, 6) + pad(x.majorHolidays, 6) + pad(x.minorHolidays, 6) + pad(x.maxConsecutive, 6) + pad(x.maxConsecutiveAnyRole, 6) + pad(x.cap === null ? "-" : x.cap, 6) + pad(x.target === null ? "-" : x.target, 8));
    });
    const r = t.range;
    console.log("  " + pad(t.code, 8, true) + pad("RANGE", 8, true) + pad(r.primary, 6) + pad(r.backup, 6) + pad(r.total, 6) + pad(r.weekendDays, 6) + pad(r.majorHolidays, 6) + pad(r.minorHolidays, 6) + pad(r.maxConsecutive, 6) + pad(r.maxConsecutiveAnyRole, 6) + pad(r.cap === null ? "-" : r.cap, 6) + pad("", 8));
  });
  console.log("  implied targets (" + D.impliedTargets.rule + "):");
  Object.keys(D.impliedTargets.months).forEach((m) => console.log("    " + m + " " + JSON.stringify(D.impliedTargets.months[m])));
  console.log("  uncovered slots (" + D.uncovered.length + "):");
  D.uncovered.forEach((u) => {
    console.log("    " + u.day + " " + u.weekday + " " + u.role + (u.holidayUnit ? " [" + u.holidayUnit + "]" : ""));
    Object.keys(u.reasons).forEach((id) => console.log("      " + pad(CODE[id], 4, true) + u.reasons[id].join(", ")));
  });
  const grouped = {};
  D.softPenalties.forEach((s) => { const k = (s.id ? CODE[s.id] : "(unit)") + " | " + s.reason; grouped[k] = grouped[k] || { weight: 0, n: 0 }; grouped[k].weight += s.weight; grouped[k].n++; });
  const rows = Object.keys(grouped).map((k) => ({ k, w: grouped[k].weight, n: grouped[k].n })).sort((a, b) => b.w - a.w || a.k.localeCompare(b.k)).slice(0, 15);
  console.log("  soft penalties by surgeon (top 15 of " + Object.keys(grouped).length + " groups; softSum " + D.score.softSum + "):");
  rows.forEach((r) => console.log("    " + pad(r.k, 40, true) + pad(r.w, 6) + "  x" + r.n));
  console.log("  holiday units: " + D.holidayUnits.map((h) => h.name + " " + h.days[0] + " P=" + (h.primary ? CODE[h.primary] || h.primary : "-") + " B=" + (h.backup ? CODE[h.backup] : "-") + (h.partial ? " (partial: " + h.outOfRange.join(",") + " out of range)" : "")).join("; "));
  console.log("  weekend units: " + D.weekendUnits.map((w) => w.friday.slice(5) + ":" + w.roles.primary.kind + "/" + w.roles.backup.kind + (w.fallback ? "*" : "")).join(" "));
  console.log("  lock violations (" + D.lockViolations.length + "): " + D.lockViolations.map((l) => l.day + " " + l.role + " " + CODE[l.id] + " " + l.reasons.join("+")).join("; "));
  console.log("  East forecast days >= 0.2 in range: " + D.eastForecast.length + " (" + D.eastForecast.filter((f) => f.assigned).length + " assigned, " + D.eastForecast.filter((f) => f.assigned === "primary").length + " as primary); East-unknown assignments: " + D.eastUnknownDays.length);
  console.log("  warnings: " + JSON.stringify(D.warnings));
}

printTallies(big, "Nov-Dec 2026 (2026-11-02 -> 2026-12-31), seed 1, bestOf 200 - the milestone preview");
console.log("\nmedian-score Nov-Dec candidate across the " + SEEDS + " seeds (bestOf " + BEST_OF + "): seed " + median.seed + ", score " + median.score + " (min " + sortedR2[0].score + " seed " + sortedR2[0].seed + ", max " + sortedR2[sortedR2.length - 1].score + " seed " + sortedR2[sortedR2.length - 1].seed + ")");
console.log("  median candidate range totals: " + Object.keys(median.out.diagnostics.tallies).map((id) => { const r = median.out.diagnostics.tallies[id].range; return CODE[id] + " P" + r.primary + "/B" + r.backup + "/W" + r.weekendDays; }).join("  ") + "; uncovered " + median.out.diagnostics.uncovered.map((u) => u.day.slice(5) + " " + u.role[0].toUpperCase()).join(", "));

console.log("\nitem 14: covered by scripts/verify-rls.sh (DB trigger), not this harness");

const total = Date.now() - T_FILE;
console.log("\ntimings: " + RANGES.map((r, i) => { const t = timing[r.name]; return r.name + " bestOf " + BEST_OF[i] + ": " + t.ms + " ms / " + t.runs + " runs (" + (t.ms / t.candidates).toFixed(1) + " ms per candidate)"; }).join("; ") + "; Nov-Dec bestOf 200: " + bigMs + " ms (" + (bigMs / big.diagnostics.candidatesTried).toFixed(1) + " ms per candidate)");
console.log("ok " + N + " assertions, " + SEEDS + " seeds x " + RANGES.length + " ranges at bestOf " + BEST_OF.join("/") + " (R4 on the even seeds: " + timing[RANGES[3].name].runs + " runs) + 1 x bestOf 200 + 4 fixture runs (" + total + " ms total; budget " + BUDGET_MS + " ms" + (process.env.SILVIS_GEN_BUDGET_MS ? " via SILVIS_GEN_BUDGET_MS" : "") + ")");
if (KNOWN_GAPS.length) console.log("known gaps still open (" + KNOWN_GAPS.length + "; owned outside this harness; SILVIS_STRICT=1 fails on them):\n  " + KNOWN_GAPS.join("\n  "));
CUR.range = "-"; CUR.seed = "-"; CUR.day = "-";
if (BEST_OF_OVERRIDE) console.log("coverage overridden via SILVIS_GEN_BEST_OF=" + BEST_OF_OVERRIDE + ": the " + BUDGET_MS + " ms budget is not enforced for this run");
else ok(total <= BUDGET_MS, "over the " + BUDGET_MS + " ms budget: " + total + " ms total (Prompt 4: all runs must finish under 10 s; lower BEST_OF_DEFAULT or prune rules.weekendUnitPatterns - never downgrade this to a warning)");
process.exit(0);
