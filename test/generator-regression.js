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
// table (the UI default), 50 fill-open-only backfill runs over 10/15..11/1 at
// bestOf 2 (Prompt 12 T), plus seven short fixture runs (manual lock, backup
// opt-out, legacy group key, range edge, derived week overridden - a
// November-only bestOf 1 run added by the Prompt 12 K fix stage, ~10 ms - and
// the two fill-open-only runs, plain + fill-open-only, Prompt 12 T).
// bestOf per range is 6 / 5 / 2 / 2
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
// version on 16 generations and 23,136 eligibility results). Prompt 12 J
// (equal shares per role, smoothing over both roles, the allowed-by-rules count
// inside buildUnits' tightness walk) added about +0.6 s quiet: the J review's
// sequential A/B on the same machine read 5247 ms -> 5852 ms total (R2 6.1 ->
// 6.6, R3 14.8 -> 16.6 ms per candidate); a loaded worktree run read 7297 ms.
// If a CI runner lands above ~8 s quiet, drop R4 to bestOf 1 (BEST_OF_DEFAULT
// [6, 5, 2, 1]) before anything else; never raise the budget to hide it.
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
// Prompt 12 C (9/22): published coverage ends where the forecast (11/16 on) begins - they never
// overlap (the refresh prunes forecast rows inside the coverage; rules.js never consults the
// forecast inside it). Matches Davenport's real published-through (week of 11/9).
const EAST_COVER = { from: "2026-11-02", to: "2026-11-15" };
const FORECAST = forecastFile.busyProbabilityByDay;
const THRESHOLD = seed.groupRules.eastFeed.forecast.busyThreshold;
// Restated independently: a forecast day counts ONLY outside the published coverage (published rows win).
const KHAN_NO_PRIMARY = new Set(KHAN_BUSY.concat(Object.keys(FORECAST).filter((d) => FORECAST[d] >= THRESHOLD && !(d >= EAST_COVER.from && d <= EAST_COVER.to))));
const DERIVED_ROLE = {};   // day -> forced Silvis role (from deriveFrom on)
const FIERCE_EAST_DAYS = new Set(); // every day of every derived week (East call either way; the Totals "East days" column)
// 9/22 (Prompt 12 K): only the days of an East PRIMARY week (derived Silvis backup, silvisRole B)
// count toward his 14; his East BACKUP week is Silvis primary and counts as Silvis primaries.
const FIERCE_EAST_PRIMARY_DAYS = new Set();
DERIVED.forEach((w) => { for (let k = 0; k < 7; k++) { const d = addDays(w.weekMonday, k); FIERCE_EAST_DAYS.add(d); if (w.silvisRole === B) FIERCE_EAST_PRIMARY_DAYS.add(d); if (d >= DERIVE_FROM) DERIVED_ROLE[d] = w.silvisRole; } });

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
// Prompt 12 N (9/22 evening): Sarkar's windows are her ONLY hard rule. No hardNeverWeekdays keys; the
// window-week count is a SOFT target (daysPerWindowWeek.target 2, primary only) checked through
// diagnostics; alternate days and no Fri-Sun block are soft; handoffPartnerRequired is a diagnostics flag.
ok(!("hardNeverWeekdays" in SR[SARKAR]) && !("hardNeverWeekdaysRoles" in SR[SARKAR]) && !("hardNeverWeekdaysReason" in SR[SARKAR]) && !("hardNeverWeekdaysRolesNote" in SR[SARKAR]), "seed: Sarkar carries no hardNeverWeekdays keys (9/22 evening: her windows are the only hard rule)");
eq([SR[SARKAR].daysPerWindowWeek.target, SR[SARKAR].daysPerWindowWeek.countsBackup], [2, false], "seed: Sarkar daysPerWindowWeek = SOFT target 2 primary days per window week");
ok(!("min" in SR[SARKAR].daysPerWindowWeek) && !("max" in SR[SARKAR].daysPerWindowWeek) && !("minIsSoft" in SR[SARKAR].daysPerWindowWeek), "seed: no hard window-week min/max keys");
eq([SR[SARKAR].weekendStyle, SR[SARKAR].preferAlternateDays, SR[SARKAR].weekendBlockPenalty, SR[SARKAR].handoffPartnerRequired], ["daily", true, "strong", true], "seed: Sarkar weekendStyle daily, preferAlternateDays, weekendBlockPenalty strong, handoffPartnerRequired (diagnostic)");
const SARKAR_TARGET = SR[SARKAR].daysPerWindowWeek.target;
const HANDOFF_IDS = IDS.filter((id) => SR[id].handoffPartnerRequired === true);
eq(HANDOFF_IDS, [SARKAR], "seed: Sarkar is the one surgeon with the handoff diagnostic");
const FIERCE_WP = SR[FIERCE].outsideDerivedWeeks.weekdayPattern;
eq(WD.map((w) => FIERCE_WP[w].backup), [true, true, true, true, true, true, true], "seed: Fierce may be backup on every weekday (9/22)");
eq(WD.map((w) => FIERCE_WP[w].primary), [false, false, true, false, "weekend-block-only", "weekend-block-only", "weekend-block-only"], "seed: Fierce's primary pattern is unchanged");
// Burchett: recurring whitelist + explicit lists. Governance is restated per ROLE (9/22, Prompt 12 I + T): a plain
// 'YYYY-MM' entry in explicitListMonths governs PRIMARY only, an object entry exactly the roles it names; in a month
// governed for a role the eligible days are exactly his explicit list for that role (a plain date list covers both
// roles, a role-keyed list per role); otherwise backup is any day not explicitly unavailable.
const burchettRecurring = (d) => (weekday(d) === "Mon" && [2, 4].includes(nthOf(d))) || (weekday(d) === "Tue" && nthOf(d) === 1) || (weekday(d) === "Wed" && [2, 4].includes(nthOf(d)));
const explicitDates = (obj) => { const s = new Set(); Object.keys(obj || {}).forEach((m) => (Array.isArray(obj[m]) ? obj[m] : []).forEach((d) => s.add(d))); return s; };
const explicitRoleDates = (obj) => { const s = { primary: new Set(), backup: new Set() }; Object.keys(obj || {}).forEach((m) => { const v = obj[m]; if (Array.isArray(v)) v.forEach((d) => { s.primary.add(d); s.backup.add(d); }); else if (v && typeof v === "object") ROLES.forEach((r) => (v[r] || []).forEach((d) => s[r].add(d))); }); return s; };
const governedRoles = (id) => { const out = {}; (SR[id].explicitListMonths || []).forEach((e) => { if (typeof e === "string") out[e] = new Set([P]); else (Array.isArray(e.roles) && e.roles.length ? e.roles : ROLES).forEach((r) => (out[e.month] = out[e.month] || new Set()).add(r)); }); return out; };
const govText = (g) => Object.keys(g).sort().map((m) => m + ":" + [...g[m]].sort().join("+"));
const BUR_AVAIL = explicitRoleDates(SR[BURCHETT].explicitAvailable), BUR_BACKUP_ONLY = explicitDates(SR[BURCHETT].explicitBackupOnly), BUR_UNAVAIL = explicitDates(SR[BURCHETT].explicitUnavailable);
const BUR_GOV = governedRoles(BURCHETT);
eq(govText(BUR_GOV), ["2026-10:primary", "2026-11:backup+primary", "2026-12:primary"], "seed: Burchett governed Oct/Dec primary only (plain entries), Nov both roles (object entry, T)");
eq([[...BUR_AVAIL.primary].filter((d) => monthOf(d) === "2026-11").length, [...BUR_AVAIL.backup].filter((d) => monthOf(d) === "2026-11").length], [7, 8], "seed: Burchett November lists 7 primary + 8 backup dates (his statement, superseded entries included)");
function burchettMay(d, role) {
  if (BUR_UNAVAIL.has(d)) return false;                    // explicit rows are never waived
  if (role === P && BUR_BACKUP_ONLY.has(d)) return false;  // a backup_only row blocks primary
  if (isHoliday(d)) return true;                           // day rules do not apply on holiday-unit days (rules doc section 5)
  const gov = BUR_GOV[monthOf(d)];
  if (gov && gov.has(role)) return BUR_AVAIL[role].has(d); // governed month + role: exactly his list
  if (role === B) return true;                             // 9/22: backup any day
  if (BUR_AVAIL[P].has(d)) return true;
  return burchettRecurring(d) || isWeekend(d);
}
// Acton: 2nd/4th Mon + Wed blocked for PRIMARY; October governed for primary by his explicit list (backup open since
// 9/22); November governed for BOTH roles by the list the ER-panel author published (T).
const ACT_AVAIL = explicitRoleDates(SR[ACTON].explicitAvailable), ACT_GOV = governedRoles(ACTON);
eq(govText(ACT_GOV), ["2026-10:primary", "2026-11:backup+primary"], "seed: Acton governed Oct primary only, Nov both roles (T)");
const GOV = {}; IDS.forEach((id) => { GOV[id] = governedRoles(id); });
const actonBlockedRecurring = (d) => ["Mon", "Wed"].includes(weekday(d)) && [2, 4].includes(nthOf(d));
const otherRoleOf = (role) => (role === P ? B : P);
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
// Sarkar windows (both roles, holidays included); since 9/22 evening every window is Mon-Fri, so a
// Saturday / Sunday is outside every window. Window weeks: Monday -> the window days of that Mon-Sun week.
const SARKAR_WINDOW = new Set();
SR[SARKAR].availableWindows.forEach((w) => daysList(w.start, w.end).forEach((d) => SARKAR_WINDOW.add(d)));
ok([...SARKAR_WINDOW].every((d) => !isWeekend(d) || weekday(d) === "Fri"), "seed: no Sarkar window carries a Saturday or Sunday (9/22 evening)");
const SARKAR_WEEKS = {};
[...SARKAR_WINDOW].sort().forEach((d) => { (SARKAR_WEEKS[mondayOf(d)] = SARKAR_WEEKS[mondayOf(d)] || []).push(d); });
eq(Object.keys(SARKAR_WEEKS).sort(), ["2026-10-19", "2026-11-16", "2026-12-14", "2027-01-11"], "seed: four window weeks");
// window weeks of month m that the generated range touches: a week counts once, in the month of its first window
// day; a week entirely outside the range adds nothing to that month's target (her target is range-scoped like the shares)
const sarkarWeeksInMonth = (m, range) => Object.keys(SARKAR_WEEKS).filter((mon) => monthOf(SARKAR_WEEKS[mon][0]) === m && SARKAR_WEEKS[mon].some((d) => d >= range.start && d <= range.end)).length;
// Weekend styles.
const BLOCK_STYLE = IDS.filter((id) => SR[id].weekendStyle === "block");
eq(BLOCK_STYLE.sort(), [KHAN, PHILIP, FIERCE].sort(), "seed: block-style surgeons are Khan, Philip, Fierce");
// Caps (an explicit null never falls back to the default). 9/22 (Prompt 12 K): a cap
// is on PRIMARY days per month (monthlyCap.primary; defaultMonthlyCap.primary).
eq(SR[ACTON].monthlyCap, null, "seed: Acton uncapped"); eq(SR[KHAN].monthlyCap, null, "seed: Khan uncapped");
const DEFAULT_CAP = seed.groupRules.defaultMonthlyCap.primary; // 8 primary days: Philip (no key) falls back to it
eq(DEFAULT_CAP, 8, "seed: groupRules.defaultMonthlyCap.primary = 8 (K: not the legacy total key)");
ok(!("total" in seed.groupRules.defaultMonthlyCap), "seed: no legacy defaultMonthlyCap.total");
eq(SR[BURCHETT].monthlyCap, { primary: 8, preferred: 7 }, "seed: Burchett cap 8 primary / preferred 7");
eq(SR[FIERCE].monthlyCap.primary, 14, "seed: Fierce cap 14 primary"); eq(SR[FIERCE].monthlyCap.countsEastDays, true, "seed: Fierce countsEastDays is boolean true");
ok(!("total" in SR[BURCHETT].monthlyCap) && !("total" in SR[FIERCE].monthlyCap), "seed: no legacy monthlyCap.total keys");
ok(!("monthlyCap" in SR[PHILIP]), "seed: Philip has no cap key");
// Targets (9/22, Prompt 12 J - equal-share fairness): nobody has a numeric target; Khan and Sarkar carry an
// explicit null, which since J reads "equal share" for a pool member (Khan) and "window target" for the
// windows surgeon (Sarkar) - never a neutral term and never "no target".
IDS.forEach((id) => ok(typeof SR[id].monthlyTarget !== "number", "seed: " + CODE[id] + " has a numeric target"));
eq([KHAN, SARKAR].every((id) => "monthlyTarget" in SR[id] && SR[id].monthlyTarget === null), true, "seed: Khan and Sarkar explicit null target");
// J: the equal-share pool = active roster entries with poolMember !== false, no availableWindows and no roster
// type "external" (the windows surgeon is outside the pool; her window primaries come off the pool's slots).
const POOL = IDS.filter((id) => SR[id].poolMember !== false && !(Array.isArray(SR[id].availableWindows) && SR[id].availableWindows.length) && (seed.roster.find((r) => r.id === id) || {}).type !== "external");
eq(POOL.slice().sort(), [KHAN, BURCHETT, ACTON, PHILIP, FIERCE].sort(), "seed: the equal-share pool is s1-s5 (Sarkar outside it)");
eq(SR[PHILIP].backupCap.perMonthDays, 7, "seed: Philip backupCap.perMonthDays = 7 (clips his backup target)");
const SCORE_PARTS = ["uncoveredPrimary", "uncoveredBackup", "hardViolations", "softSum", "primaryDeviation", "backupDeviation", "weekendSpread", "holidaySpread"];
const round1 = (v) => Math.round(v * 10) / 10;
// Hard-reason vocabulary (rules doc sections 3-5; guide section 5). A reason in
// diagnostics.uncovered must start with one of these; anything else is a renamed,
// bogus or placeholder reason. Holiday-unit reasons carry "@YYYY-MM-DD".
const REASON_PREFIXES = [
  "time-off:", "day-before-vacation", "unavailable-row", "no-backup-row", "backup-only-row", "inactive", "holiday-opt-out:", "backup-opt-out",
  "hard-never-weekday:", "recurring-unavailable:", "weekday-not-allowed:", "weekend-block-only", "weekday-pattern:", "day-before-aledo",
  "whitelist-month", "not-recurring-available", "outside-available-weeks", "outside-window",
  "east-busy", "east-forecast-busy:", "derived-lock:", "derived-lock-held:", "slot-locked:", "external-cover", "holds-other-role",
  "monthly-cap:", "max-consecutive:", "backup-cap:", "backup-weekend-cap:", "max-major-holidays:"
]; // window-week-max: left the vocabulary 9/22 evening (Prompt 12 N: the window-week count is soft)
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
function primaryOnlyReasonForBackup(id, r, day) {
  const core = String(r).split("@")[0];
  if (core.indexOf("hard-never-weekday:") === 0) return !hardNeverApplies(id, B);
  if (core === "whitelist-month") { const g = GOV[id] && GOV[id][monthOf(String(r).split("@")[1] || day)]; return !(g && g.has(B)); } // T: an object entry naming backup governs backup
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
// The Fri+Sat+Sun trios inside `days` where Khan is primary-eligible on all three days, restated from the
// inputs: in range, no holiday day, no East busy / forecast-busy day, no vacation edge, no lock to someone
// else, no external cover (the quality-1 filter; the Prompt 12 L pin on the bestOf-200 run reuses it).
function khanOpenWeekends(days) {
  const out = [];
  days.filter((d) => weekday(d) === "Fri").forEach((f) => {
    const trio = [0, 1, 2].map((k) => addDays(f, k));
    if (!trio.every((d) => days.includes(d) && !isHoliday(d) && !KHAN_NO_PRIMARY.has(d) && !VAC[KHAN].has(d) && !DAY_BEFORE_VAC[KHAN].has(d) && !(lockedIn(d, P) && INPUT[d].primary !== KHAN) && !(INPUT[d] && INPUT[d].externalCover))) return;
    out.push(trio);
  });
  return out;
}
// Expected diagnostics.lockViolations per range, restated from the inputs alone
// (locks are facts the generator keeps; the conflicts must be REPORTED):
//   R1  Philip's locked October is 7 primaries + 8 backups. Since 9/22 (Prompt 12 K)
//       the monthly cap counts PRIMARY days only, so his 7 primaries sit under the
//       default cap of 8 and no locked Philip PRIMARY breaks a rule; his 8 locked
//       backups break backup-cap 7 (the explicit backup cap, unchanged). Plus
//       Fierce's single locked Monday primary 10/12 outside any derived week
//       (weekday-pattern:Mon - October is not derived).
//   R2  Khan's import-locked Thanksgiving primaries on the synthetic East-busy days
//       11/26, 11/27, 11/28 (east-busy); 11/29 is not East-busy.
//   R3  nothing is locked -> empty.
function expectedLockViolations(range) {
  const out = [];
  const philipOctP = monthDays("2026-10").filter((d) => holder(INPUT, d, P) === PHILIP).length; // 7: under the primary cap of 8 (K)
  const philipOctB = monthDays("2026-10").filter((d) => holder(INPUT, d, B) === PHILIP).length; // 8: over his explicit backup cap of 7
  eq([philipOctP, philipOctB], [7, 8], "seed: Philip's locked October is 7 primaries + 8 backups (fixture drift?)");
  Object.keys(INPUT).sort().forEach((d) => {
    if (d < range.start || d > range.end) return;
    ROLES.forEach((role) => {
      const e = INPUT[d];
      if (!e[role + "Locked"] || !e[role]) return;
      if (e[role] === PHILIP && monthOf(d) === "2026-10" && role === P && philipOctP > DEFAULT_CAP) out.push({ day: d, role, id: PHILIP, lock: "import", prefix: "monthly-cap:" });
      if (e[role] === PHILIP && monthOf(d) === "2026-10" && role === B && philipOctB > SR[PHILIP].backupCap.perMonthDays) out.push({ day: d, role, id: PHILIP, lock: "import", prefix: "backup-cap:" });
      if (e[role] === FIERCE && role === P && weekday(d) === "Mon" && !DERIVED_ROLE[d]) out.push({ day: d, role, id: FIERCE, lock: "import", prefix: "weekday-pattern:Mon" });
      if (e[role] === KHAN && role === P && KHAN_BUSY.includes(d)) out.push({ day: d, role, id: KHAN, lock: "import", prefix: "east-busy" });
      // T: the ER-panel author's Acton 11/18 primary precedes his 11/19 vacation - published as submitted, reported (generic: any holder)
      if (VAC[e[role]] && VAC[e[role]].has(d)) out.push({ day: d, role, id: e[role], lock: "import", prefix: "time-off:" });
      else if (role === P && DAY_BEFORE_VAC[e[role]] && DAY_BEFORE_VAC[e[role]].has(d)) out.push({ day: d, role, id: e[role], lock: "import", prefix: "day-before-vacation" });
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
            if (role === B) ok(!primaryOnlyReasonForBackup(id, r, d), "uncovered backup: " + CODE[id] + " blocked by a PRIMARY-only rule (" + r + ") - backup is open to everyone since 9/22");
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
    // item 9a (T): a derived week is WHOLE when every day is either the derived lock or an explicit lock to the
    // derived surgeon himself (diagnostics.derivedConfirmed). An explicit lock to someone else - or the derived
    // surgeon locked in the OTHER role - makes the derived lock yield: the day must be in diagnostics.derivedYields
    // (the explicit row stays) and never a hard violation (hardViolations is [] above).
    if (DERIVED_ROLE[d]) {
      const role = DERIVED_ROLE[d], other = otherRoleOf(role);
      const inpHolder = lockedIn(d, role) ? INPUT[d][role] : null;
      const heldOther = lockedIn(d, other) && INPUT[d][other] === FIERCE;
      const y = (D.derivedYields || []).find((x) => x.day === d && x.role === role);
      const c = (D.derivedConfirmed || []).find((x) => x.day === d && x.role === role);
      if (inpHolder === FIERCE) {
        ok(c && c.id === FIERCE && c.derivedId === FIERCE, "derived " + role + " held by Fierce's own explicit lock must be in derivedConfirmed: " + JSON.stringify(D.derivedConfirmed));
        ok(!y, "a confirmed derived day is not a yield");
        eq([e[role], e[role + "Locked"]], [FIERCE, true], "confirmed derived day");
      } else if (inpHolder || heldOther) {
        ok(y && y.derivedId === FIERCE && (inpHolder ? y.holderId === inpHolder && y.holderRole === role : y.holderId === FIERCE && y.holderRole === other), "yielded derived " + role + " missing from derivedYields (or wrong holder): " + JSON.stringify(D.derivedYields));
        ok(!c, "a yielded derived day is not a confirmation");
        if (inpHolder) eq(e[role], inpHolder, "the explicit holder stays on a yielded derived day"); else ok(e[role] !== FIERCE, "Fierce cannot hold both roles on " + d);
      } else {
        eq(e[role], FIERCE, "derived " + role + " not held by Fierce");
        eq(e[role + "Locked"], true, "derived " + role + " not locked");
        if (!inp || (!inp.primaryLocked && !inp.backupLocked)) eq(e.source, "east-derived", "derived day source");
        ok(!y && !c, "a pure derived lock is neither a yield nor a confirmation");
      }
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
        { const g6 = ACT_GOV[monthOf(d)]; if (g6 && g6.has(role) && !isHoliday(d)) ok(ACT_AVAIL[role].has(d), "Acton " + role + " in governed " + monthOf(d) + " is off his explicit list (T: October primary, November both roles)"); }
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
      // item 10 (9/22 evening, Prompt 12 N): her windows are the ONLY hard rule - both roles, holidays included; a
      // Saturday / Sunday follows (no window carries one). NO assertion on her day count (soft; diagnostics below).
      if (id === SARKAR) {
        ok(SARKAR_WINDOW.has(d), "Sarkar " + role + " outside her windows");
        ok(!["Sat", "Sun"].includes(weekday(d)), "Sarkar " + role + " on a " + weekday(d) + " (outside every Mon-Fri window)");
      }
      // 9/22: an explicit backup opt-out is hard on every backup slot
      if (role === B) ok(!OPTED_OUT.has(id), CODE[id] + " placed as backup although opted out");
      // 9/22 positive sightings (asserted once at the end: each must happen somewhere in the 150 runs)
      if (role === B && !isHoliday(d)) {
        if (id === KHAN && ["Tue", "Thu"].includes(weekday(d))) SAW["Khan backup on an OR day (Tue/Thu)"]++;
        if (id === BURCHETT && !isWeekend(d) && !burchettRecurring(d) && !BUR_AVAIL.backup.has(d)) SAW["Burchett backup on a day off his recurring list"]++;
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
  // T: derivedYields / derivedConfirmed carry in-range days of Fierce's derived weeks only; one warning per yielding
  // derived week (Monday + role) naming its yielded days in order; no such warning when nothing yields.
  ok(Array.isArray(D.derivedYields) && Array.isArray(D.derivedConfirmed), "diagnostics.derivedYields / derivedConfirmed missing");
  D.derivedYields.forEach((y) => ok(days.includes(y.day) && DERIVED_ROLE[y.day] === y.role && y.derivedId === FIERCE && y.holderId && (y.holderRole === P || y.holderRole === B) && typeof y.holderSource === "string", "malformed derivedYields entry " + JSON.stringify(y)));
  D.derivedConfirmed.forEach((c) => ok(days.includes(c.day) && DERIVED_ROLE[c.day] === c.role && c.id === FIERCE && lockedIn(c.day, c.role) && INPUT[c.day][c.role] === FIERCE, "malformed derivedConfirmed entry " + JSON.stringify(c)));
  {
    const byWeek = {};
    D.derivedYields.forEach((y) => { const k = mondayOf(y.day) + "|" + y.role; (byWeek[k] = byWeek[k] || []).push(y.day); });
    const expWarn = Object.keys(byWeek).sort().map((k) => "derived week " + k.split("|")[0] + " (" + NAME[FIERCE] + " Silvis " + k.split("|")[1] + ") yields to published entries on " + byWeek[k].sort().join(", "));
    eq(D.warnings.filter((w) => /^derived week /.test(w)).sort(), expWarn, "one 'derived week ... yields to published entries on ...' warning per yielding derived week");
  }
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

  // J (9/22): equal-share fairness. diagnostics.impliedTargets is restated from the inputs alone: the lock-only
  // base (import/manual locks, externalCover, Fierce's derived weeks), the pool s1-s5, Sarkar's reserved window
  // primaries, and per member the two role targets, the locked days, the K clip and the "allowed by rules" counts
  // (exactly for two surgeons whose backup / primary eligibility is fully data-restatable here).
  const otherRole = (role) => (role === P ? B : P);
  // the lock-only base: an out-of-range day is the published entry as it stands; an in-range day keeps only
  // its import/manual locks plus Fierce's derived weeks (applied to in-range days only, as genSeedLocks does)
  const baseHolder = (d, role) => {
    const e = INPUT[d];
    if (!days.includes(d)) return (e && e[role]) || null;
    if (e && e[role + "Locked"] && e[role]) return e[role];
    if (DERIVED_ROLE[d] === role && !(e && e[otherRole(role) + "Locked"] && e[otherRole(role)] === FIERCE)) return FIERCE; // a derived lock is skipped when he is import-locked in the other role
    return null;
  };
  const baseOpen = (d, role) => !baseHolder(d, role) && !(role === P && INPUT[d] && INPUT[d].externalCover);
  eq((D.impliedTargets.pool || []).slice().sort(), POOL.slice().sort(), "impliedTargets.pool = the restated equal-share pool");
  months.forEach((m) => {
    const I = D.impliedTargets.months[m];
    const mdaysIn = days.filter((d) => monthOf(d) === m);
    ok(I && typeof I.primaryShare === "number" && typeof I.backupShare === "number" && I.members, "impliedTargets " + m + " lacks primaryShare / backupShare / members (keys: " + JSON.stringify(I ? Object.keys(I) : null) + ")");
    ok(!("neutralTerm" in I) && !("noTerm" in I) && !("share" in I) && !("targets" in I), "impliedTargets " + m + " still carries a pre-J key (neutralTerm / noTerm / share / targets)");
    const primaryOpen = mdaysIn.filter((d) => baseOpen(d, P)).length, backupOpen = mdaysIn.filter((d) => baseOpen(d, B)).length;
    const nW = sarkarWeeksInMonth(m, range);
    const openWindow = mdaysIn.filter((d) => SARKAR_WINDOW.has(d) && baseOpen(d, P)).length;
    const reserved = Math.min(SARKAR_TARGET * nW, openWindow);
    eq([I.primaryOpen, I.backupOpen, I.poolSize, I.reservedForWindows], [primaryOpen, backupOpen, POOL.length, reserved], "impliedTargets " + m + " primaryOpen / backupOpen / poolSize / reservedForWindows");
    eq([I.primaryShare, I.backupShare], [round1((primaryOpen - reserved) / POOL.length), round1(backupOpen / POOL.length)], "impliedTargets " + m + " primaryShare / backupShare = (open - reserved) / pool, open / pool");
    POOL.forEach((id) => {
      const M = I.members[id];
      ok(M && typeof M.primaryTarget === "number" && typeof M.backupTarget === "number", CODE[id] + " must carry a primary AND a backup target in " + m + " (got " + JSON.stringify(M) + ")");
      const heldP = monthDays(m).filter((d) => baseHolder(d, P) === id).length, heldB = monthDays(m).filter((d) => baseHolder(d, B) === id).length;
      eq(M.lockedHeld, { primary: heldP, backup: heldB }, CODE[id] + " lockedHeld in " + m);
      ok(M.primaryTarget >= heldP && M.backupTarget >= heldB, CODE[id] + " a target below the locked days in " + m + ": " + JSON.stringify(M));
      ok(M.primaryTarget <= Math.max(heldP, M.clipPrimary === null ? Infinity : M.clipPrimary), CODE[id] + " primary target " + M.primaryTarget + " above his clip " + M.clipPrimary + " in " + m);
      ok(M.primaryTarget <= Math.max(heldP, I.primaryShare) + 0.05, CODE[id] + " primary target " + M.primaryTarget + " exceeds max(held, primaryShare " + I.primaryShare + ") in " + m);
      ok(M.backupTarget <= Math.max(heldB, I.backupShare) + 0.05, CODE[id] + " backup target " + M.backupTarget + " exceeds max(held, backupShare " + I.backupShare + ") in " + m);
      if (SR[id].backupCap && typeof SR[id].backupCap.perMonthDays === "number") ok(M.backupTarget <= Math.max(heldB, SR[id].backupCap.perMonthDays) + 0.05, CODE[id] + " backup target " + M.backupTarget + " above his backup cap in " + m);
      ok(typeof M.allowedPrimary === "number" && typeof M.allowedBackup === "number" && M.allowedPrimary >= 0 && M.allowedPrimary <= primaryOpen && M.allowedBackup >= 0 && M.allowedBackup <= backupOpen, CODE[id] + " allowedPrimary / allowedBackup out of range in " + m + ": " + JSON.stringify(M));
      eq(D.tallies[id].months[m].target, { primary: M.primaryTarget, backup: M.backupTarget }, CODE[id] + " tallies target = { primary, backup } in " + m);
    });
    // clips (K, per role since J): Burchett preferred 7; Philip default 8 - 1; Acton / Khan uncapped; Fierce 13 minus the
    // East primary-week days of the month he does not hold as Silvis PRIMARY - the cap adds those days to his primary
    // count whether or not he holds the derived Silvis backup, so November (derived week held) reads 6, not 13.
    const fierceEastP = monthDays(m).filter((d) => FIERCE_EAST_PRIMARY_DAYS.has(d) && baseHolder(d, P) !== FIERCE).length;
    eq([I.members[BURCHETT].clipPrimary, I.members[PHILIP].clipPrimary, I.members[ACTON].clipPrimary, I.members[KHAN].clipPrimary, I.members[FIERCE].clipPrimary], [7, DEFAULT_CAP - 1, null, null, 14 - 1 - fierceEastP], "clipPrimary MAB 7 / AFP 7 / BDA null / FAK null / NF 13 - East primary-week days in " + m);
    eq(I.members[FIERCE].eastPrimaryDays, fierceEastP, "Fierce members.eastPrimaryDays in " + m);
    // Khan's allowed backup count exactly: since 9/22 backup is open to him on every open in-range backup slot of the
    // month except his vacation days and the days he holds the locked primary (Thanksgiving) - no cap, no East block
    eq(I.members[KHAN].allowedBackup, mdaysIn.filter((d) => baseOpen(d, B) && !VAC[KHAN].has(d) && baseHolder(d, P) !== KHAN).length, "Khan allowedBackup = open in-range backup slots minus vacations and his locked primaries in " + m);
    // Sarkar (N + J): primaryTarget = window target x the window weeks the range touches (null without one), NO
    // backupTarget, outside the pool; allowedPrimary exactly = the open in-range primary slots inside her windows
    const MS = I.members[SARKAR];
    eq([I.windowTarget[SARKAR], I.windowWeeks[SARKAR]], [SARKAR_TARGET * nW, nW], "Sarkar impliedTargets.windowTarget / windowWeeks in " + m);
    eq([MS.primaryTarget, MS.backupTarget], [nW ? SARKAR_TARGET * nW : null, null], "Sarkar primaryTarget = window target, backupTarget null in " + m + " (got " + JSON.stringify(MS) + ")");
    eq(MS.allowedPrimary, mdaysIn.filter((d) => SARKAR_WINDOW.has(d) && baseOpen(d, P) && !VAC[SARKAR].has(d)).length, "Sarkar allowedPrimary = open in-range primary slots inside her windows in " + m);
    eq(D.tallies[SARKAR].months[m].target, { primary: nW ? SARKAR_TARGET * nW : null, backup: null }, "Sarkar tallies target in " + m);
    // J (fix stage, review finding 1): the flat share is measured on OPEN slots while the deviation counts whole-month
    // days, so in a month with locks the targets can ask for FEWER placements than there are open slots (Khan's 4
    // locked Thanksgiving primaries sit inside his 4.6 November target). The generator reports that gap instead of
    // hiding it: placeableAtTarget = sum over every targeted surgeon of max(0, target - lockedHeld) per role, to be
    // read against primaryOpen / backupOpen; rangeDays = the month's days inside the generated range (a partial
    // month carries a whole-month locked floor - review finding 8).
    {
      let plP = 0, plB = 0;
      IDS.forEach((id) => { const M = I.members[id]; if (!M) return; if (typeof M.primaryTarget === "number") plP += Math.max(0, M.primaryTarget - M.lockedHeld.primary); if (typeof M.backupTarget === "number") plB += Math.max(0, M.backupTarget - M.lockedHeld.backup); });
      eq(I.placeableAtTarget, { primary: round1(plP), backup: round1(plB) }, "impliedTargets " + m + " placeableAtTarget = sum of max(0, target - lockedHeld) per role (got " + JSON.stringify(I.placeableAtTarget) + ")");
      ok(I.placeableAtTarget.primary <= primaryOpen + 0.05 && I.placeableAtTarget.backup <= backupOpen + 0.05, "impliedTargets " + m + " placeableAtTarget above the open slots: " + JSON.stringify(I.placeableAtTarget) + " vs open " + primaryOpen + " / " + backupOpen);
      eq(I.rangeDays, mdaysIn.length, "impliedTargets " + m + " rangeDays = the month's in-range days");
    }
    // K (fix stage): diagnostics.tallies carry the East primary-week days a countsEastDays cap adds
    // (eastP) so the Generate preview can flag P + eastP > cap the way the engine counts; 0 for everyone else.
    eq(D.tallies[FIERCE].months[m].eastP, [...FIERCE_EAST_PRIMARY_DAYS].filter((d) => monthOf(d) === m).length, "Fierce tallies.eastP = his East primary-week days in " + m);
    eq(D.tallies[KHAN].months[m].eastP, 0, "Khan tallies.eastP must be 0 (no countsEastDays cap) in " + m);
  });
  eq(D.tallies[FIERCE].range.eastP, days.filter((d) => FIERCE_EAST_PRIMARY_DAYS.has(d)).length, "Fierce tallies.range.eastP = his East primary-week days in the range");
  // range target = the sum of the numeric monthly targets per role (null when no month carries one)
  IDS.forEach((id) => {
    const sum = (role) => { let s = null; months.forEach((m) => { const t = D.tallies[id].months[m].target[role]; if (typeof t === "number") s = (s || 0) + t; }); return s === null ? null : round1(s); };
    eq(D.tallies[id].range.target, { primary: sum(P), backup: sum(B) }, CODE[id] + " tallies.range.target = per-role sums of the monthly targets");
  });
  if (range.name.indexOf("R2") === 0 || range.name.indexOf("R4") === 0) {
    const nov = D.impliedTargets.months["2026-11"], NF = nov.members[FIERCE];
    eq(NF.lockedHeld, { primary: 0, backup: 8 }, "Fierce holds his 7 derived November days (confirmed by his explicit rows) + Mon 11/16 as BACKUP before generation (T)");
    // T: his explicit backup rows 11/9-11/15 ARE the derived week - nothing yields in November, every day is confirmed
    eq(D.derivedConfirmed.map((c) => c.day + " " + c.role), ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"].map((d) => d + " " + B), "T: derivedConfirmed = 11/9-11/15 backup (Fierce's explicit rows confirm his derived week)");
    eq(D.derivedYields.filter((y) => monthOf(y.day) === "2026-11"), [], "T: nothing yields in November");
    ok(!D.warnings.some((w) => /^derived week 2026-11-09 /.test(w)), "T: no yield warning for the week of 11/9");
    // 9/22 (K review, restated per role by J): his held derived East-primary week is 7 locked BACKUPS - it never
    // inflates his primary target - and the cap adds those 7 days to his primary count, so his primary clip is
    // 14 - 1 - 7 = 6; the primary target is min(primaryShare, 6) (nothing primary is locked), never the old 13 clip.
    eq([NF.eastPrimaryDays, NF.clipPrimary], [7, 6], "Fierce November: 7 East primary-week days leave a primary clip of 6");
    eq(NF.primaryTarget, round1(Math.max(0, Math.min(nov.primaryShare, 6))), "Fierce November primary target = min(primaryShare " + nov.primaryShare + ", clip 6)");
    ok(NF.backupTarget >= 7, "Fierce November backup target " + NF.backupTarget + " must hold his 7 locked backups");
  }
  // score (J): the lexicographic parts split the deviation per role - primary first - and targetDeviation is gone;
  // both deviations are restated from the merged view (full calendar months, the way the engine counts) and the
  // total is the weighted sum of the parts.
  eq(Object.keys(D.score.weights), SCORE_PARTS, "score.weights = the J parts (primaryDeviation 300 before backupDeviation 100; no targetDeviation)");
  eq([D.score.weights.primaryDeviation, D.score.weights.backupDeviation], [300, 100], "score weights primaryDeviation 300 / backupDeviation 100");
  ok(!("targetDeviation" in D.score) && typeof D.score.primaryDeviation === "number" && typeof D.score.backupDeviation === "number", "score must carry primaryDeviation + backupDeviation and no targetDeviation: " + JSON.stringify(Object.keys(D.score)));
  {
    let devP = 0, devB = 0;
    months.forEach((m) => IDS.forEach((id) => {
      const M = D.impliedTargets.months[m].members[id];
      if (!M) return;
      if (typeof M.primaryTarget === "number") devP += Math.abs(monthDays(m).filter((d) => holder(view, d, P) === id).length - M.primaryTarget);
      if (typeof M.backupTarget === "number") devB += Math.abs(monthDays(m).filter((d) => holder(view, d, B) === id).length - M.backupTarget);
    }));
    eq([D.score.primaryDeviation, D.score.backupDeviation], [round1(devP), round1(devB)], "score.primaryDeviation / backupDeviation restated from the schedule and the targets");
    const total = SCORE_PARTS.reduce((s, k) => s + D.score[k] * D.score.weights[k], 0);
    eq(D.score.total, Math.round(total * 1000) / 1000, "score.total = sum of parts x weights");
  }

  // quality-1 (Nov-Dec, the milestone range with the real forecast): Khan's main
  // contribution is weekends. Among the weekends where he is primary-eligible all
  // three days (in range, no holiday day, no East busy / forecast-busy day, no
  // vacation edge, no lock to someone else) he must hold at least one full
  // Fri+Sat+Sun primary block per run: a no-target surgeon must not become the
  // backup sink. Not asserted for Oct (locked import) or Jan-Mar: there the feed
  // carries forecast doubt (0 < p < threshold = east-forecast soft, +2 per day)
  // on every weekend and, from 2027-02-22, no data at all (east-unknown, +1 per
  // day), which legitimately ranks him behind surgeons at 0 soft. Since 9/22
  // (Prompt 12 L) surgeonRules.primaryContribution = "weekends" is modelled by
  // rules.js (weekend-primary / weekend-backup softs, weights.weekendContribution);
  // the bestOf-200 pin below the run loop checks the primary-over-backup outcome.
  if (range.name.indexOf("R2") === 0) {
    const khanWeekends = khanOpenWeekends(days);
    ok(khanWeekends.length >= 1, "Nov-Dec must offer Khan at least one eligible weekend (fixture drift?)");
    ok(khanWeekends.some((trio) => trio.every((d) => out.schedule[d].primary === KHAN)), "Khan holds no full weekend primary block although " + khanWeekends.length + " weekend(s) are open to him: " + khanWeekends.map((t) => t[0]).join(", "));
  }

  // per-month counters (flagged only when a generator-placed day contributes)
  months.forEach((m) => {
    CUR.day = m;
    const mdays = monthDays(m);
    const placedIn = (id, role) => mdays.some((d) => out.schedule[d] && isPlaced(out, d, role) && out.schedule[d][role] === id);
    // item 7 (9/22, Prompt 12 K): Burchett <= 8 PRIMARY days per month; his backups are
    // unbounded by the cap (no assertion on the backup count or the primary+backup total)
    const burPrimary = mdays.filter((d) => holder(view, d, P) === BURCHETT).length;
    if (placedIn(BURCHETT, P)) ok(burPrimary <= 8, "Burchett " + burPrimary + " primary days in " + m);
    // K: Philip <= 8 PRIMARY days per month (the group default; his backups fall under item 8 only)
    const phPrimary = mdays.filter((d) => holder(view, d, P) === PHILIP).length;
    if (placedIn(PHILIP, P)) ok(phPrimary <= DEFAULT_CAP, "Philip " + phPrimary + " primary days in " + m + " (default cap " + DEFAULT_CAP + ")");
    // item 7: Acton / Khan uncapped -> the generator never cites a monthly cap for them
    D.uncovered.forEach((u) => { if (monthOf(u.day) === m) [ACTON, KHAN].forEach((id) => ok(!u.reasons[id].some((r) => String(r).indexOf("monthly-cap") === 0), CODE[id] + " blocked by a monthly cap on " + u.day)); });
    // item 8: Philip backup <= 7 days and <= 1 weekend per month
    const phBackups = mdays.filter((d) => holder(view, d, B) === PHILIP);
    const phWeekends = new Set(phBackups.filter(isWeekend).map(fridayOf));
    if (placedIn(PHILIP, B)) { ok(phBackups.length <= 7, "Philip " + phBackups.length + " backup days in " + m); ok(phWeekends.size <= 1, "Philip backup on " + phWeekends.size + " weekends in " + m); }
    // item 9c (9/22, Prompt 12 K): Fierce Silvis PRIMARY days + East PRIMARY-week days <= 14
    // (distinct days; his Silvis backups - including the derived East-primary week - never count)
    const fierceDays = mdays.filter((d) => holder(view, d, P) === FIERCE || FIERCE_EAST_PRIMARY_DAYS.has(d)).length;
    if (placedIn(FIERCE, P)) ok(fierceDays <= 14, "Fierce " + fierceDays + " primary + East primary-week days in " + m);
  });
  // item 10 (Prompt 12 N, 9/22 evening): the window-week count is SOFT - no assertion on it; instead
  // diagnostics.windowWeeks lists every window week overlapping the range (target 2, status consistent with the
  // schedule: partial when some window days are outside the range, else met / under / over by her PRIMARY days in
  // the Mon-Sun week), and a warning appears for exactly the fully-in-range weeks with n != target.
  CUR.day = "-";
  ok(Array.isArray(D.windowWeeks), "diagnostics.windowWeeks missing");
  const expWW = Object.keys(SARKAR_WEEKS).sort().map((mon) => {
    const wdays = SARKAR_WEEKS[mon], inRangeDays = wdays.filter((d) => days.includes(d));
    if (!inRangeDays.length) return null;
    const wk = [0, 1, 2, 3, 4, 5, 6].map((k) => addDays(mon, k));
    const primaries = wk.filter((d) => holder(view, d, P) === SARKAR).length, backups = wk.filter((d) => holder(view, d, B) === SARKAR).length;
    const partial = inRangeDays.length < wdays.length;
    return { monday: mon, surgeonId: SARKAR, windowDays: wdays, inRangeWindowDays: inRangeDays, primaries, backups, target: SARKAR_TARGET, status: partial ? "partial" : primaries === SARKAR_TARGET ? "met" : primaries < SARKAR_TARGET ? "under" : "over" };
  }).filter(Boolean);
  const gotWW = (D.windowWeeks || []).slice().sort((a, b) => (a.monday + a.surgeonId).localeCompare(b.monday + b.surgeonId)).map((w) => ({ monday: w.monday, surgeonId: w.surgeonId, windowDays: w.windowDays, inRangeWindowDays: w.inRangeWindowDays, primaries: w.primaries, backups: w.backups, target: w.target, status: w.status }));
  eq(gotWW, expWW, "diagnostics.windowWeeks (every window week overlapping the range, restated from the seed and the schedule)");
  const expWWWarn = expWW.filter((w) => w.status !== "partial" && w.primaries !== SARKAR_TARGET).map((w) => "window week " + w.monday + ": " + NAME[SARKAR] + " has " + w.primaries + " primary day(s) (target " + SARKAR_TARGET + ")");
  eq(D.warnings.filter((w) => /^window week /.test(w)).sort(), expWWWarn.sort(), "window-week warnings = exactly the fully-in-range weeks with n != " + SARKAR_TARGET);
  // handoff diagnostic (handoffPartnerRequired): every in-range primary of hers whose next day is hers again or open,
  // read from the merged view (a next day beyond the range that is not published is unknown and not listed)
  ok(Array.isArray(D.handoffGaps), "diagnostics.handoffGaps missing");
  const expHG = [];
  HANDOFF_IDS.forEach((id) => days.forEach((d) => {
    if (holder(view, d, P) !== id) return;
    const next = addDays(d, 1), e = view[next];
    if (!e) return;
    if (e.primary === id) expHG.push({ day: d, next, surgeonId: id, problem: "same-surgeon" });
    else if (!e.primary && !e.externalCover) expHG.push({ day: d, next, surgeonId: id, problem: "open" });
  }));
  const gotHG = (D.handoffGaps || []).slice().sort((a, b) => (a.day + a.surgeonId).localeCompare(b.day + b.surgeonId)).map((g) => ({ day: g.day, next: g.next, surgeonId: g.surgeonId, problem: g.problem }));
  eq(gotHG, expHG.sort((a, b) => (a.day + a.surgeonId).localeCompare(b.day + b.surgeonId)), "diagnostics.handoffGaps only where the schedule shows the gap");
  expHG.forEach((g) => ok(D.warnings.some((w) => w.indexOf("handoff " + g.day + ": ") === 0), "missing the handoff warning for " + g.day));
  eq(D.warnings.filter((w) => /^handoff /.test(w)).length, expHG.length, "one handoff warning per gap");
  ok(!D.hardViolations.some((v) => v.reasons.some((r) => /window-week/.test(r))), "no hard violation ever cites the window-week count");
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
  IDS.forEach(checkRuns);  // items 7 (Burchett 2), 10 (Sarkar 2 - the group-wide hard limit, not a window rule) and, since Prompt 12 A, Khan 3 / Acton 3 / Philip 4 / Fierce 7
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
const r4Results = []; // Prompt 12 V
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
    if (ri === 3) r4Results.push({ seed: s, out }); // Prompt 12 V: the R4 runs are re-read at the end (standing East days)
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
  // T: the general yield rule, pinned by name - the manual primary lock makes the derived backup lock yield on 11/10
  eq(D2.derivedYields, [{ day: DAY, role: B, derivedId: FIERCE, holderId: FIERCE, holderRole: P, holderSource: "manual" }], "T: diagnostics.derivedYields names the yielded day, the holder, his role and the row source");
  eq(D2.warnings.filter((w) => /^derived week /.test(w)), ["derived week 2026-11-09 (" + NAME[FIERCE] + " Silvis backup) yields to published entries on " + DAY], "T: one warning for the derived week, naming 11/10");
  eq(D2.derivedConfirmed.map((c) => c.day), ["2026-11-09", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"], "T: the other six days are confirmed by his explicit backup rows");
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

/* ---------------------- T: fill-open-only (the October backfill) */
// generate(ctx, start, end, { fillOpenOnly: true }) fills ONLY the open slots of the input inside the range: every
// held slot - locked or not, externalCover included - is fixed (byte-identical on the output, lock flags untouched),
// smoothing / repair never move it, and its rule conflicts are facts (diagnostics.fixedViolations, never
// hardViolations). Restated from the seed: the open slots of the locked import inside 10/15..11/1 - 10/15 + 10/24
// primary and eleven backups: the eight of the ER-panel author's 9/22 open list (rules doc section 7: 10/15, 10/21, 10/23, 10/24,
// 10/25, 10/30, 10/31, 11/1) plus 10/16, 10/27, 10/29, Philip primary days her 9/16 document left without a backup
// (rules doc section 8 item 14) - and the fixed count; per seed (50 x bestOf 2) the full checkRun contract plus the
// byte-identical held slots and every open slot filled or listed with reasons.
const BF = { name: "R1 backfill fill-open-only 2026-10-15..2026-11-01", start: "2026-10-15", end: "2026-11-01" };
const bfDays = daysList(BF.start, BF.end);
const heldIn = (d, role) => { const e = INPUT[d]; return !!(e && (e[role] || (role === P && e.externalCover))); };
const bfOpen = []; bfDays.forEach((d) => ROLES.forEach((role) => { if (!heldIn(d, role)) bfOpen.push(d + " " + role); }));
CUR.range = BF.name; CUR.seed = "-"; CUR.day = "-";
const OFFICE_OPEN_BACKUPS = ["2026-10-15", "2026-10-21", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-30", "2026-10-31", "2026-11-01"]; // the ER-panel author's 9/22 document (rules doc section 7)
eq(bfOpen, ["2026-10-15 primary", "2026-10-15 backup", "2026-10-16 backup", "2026-10-21 backup", "2026-10-23 backup", "2026-10-24 primary", "2026-10-24 backup", "2026-10-25 backup", "2026-10-27 backup", "2026-10-29 backup", "2026-10-30 backup", "2026-10-31 backup", "2026-11-01 backup"], "seed: the open slots of the locked October import inside the backfill range (10/15 + 10/24 primary, eleven backups)");
ok(OFFICE_OPEN_BACKUPS.every((d) => bfOpen.includes(d + " " + B)), "seed: the ER-panel author's eight open October backups are all open in the import");
eq(bfOpen.filter((k) => /backup$/.test(k)).map((k) => k.split(" ")[0]).filter((d) => !OFFICE_OPEN_BACKUPS.includes(d)), ["2026-10-16", "2026-10-27", "2026-10-29"], "seed: the three open backups beyond the ER-panel author's list are 10/16, 10/27, 10/29 (item 14)");
["2026-10-16", "2026-10-27", "2026-10-29"].forEach((d) => eq([INPUT[d].primary, INPUT[d].primaryLocked], [PHILIP, true], "seed: " + d + " is a locked Philip primary with its backup open"));
const bfFixed = bfDays.length * 2 - bfOpen.length;
timing[BF.name] = { ms: 0, runs: 0, candidates: 0 };
for (let s = 1; s <= SEEDS; s++) {
  const t = Date.now();
  const out = GEN.generate(ctx, BF.start, BF.end, { seed: s, bestOf: 2, fillOpenOnly: true });
  timing[BF.name].ms += Date.now() - t; timing[BF.name].runs++; timing[BF.name].candidates += out.diagnostics.candidatesTried;
  checkRun(out, BF, s, false);
  CUR.range = BF.name; CUR.seed = s; CUR.day = "-";
  eq(out.diagnostics.mode, "fill-open-only", "diagnostics.mode");
  eq(out.diagnostics.fixedSlots, bfFixed, "diagnostics.fixedSlots = every held input slot inside the range");
  bfDays.forEach((d) => ROLES.forEach((role) => {
    if (!heldIn(d, role)) return;
    CUR.day = d;
    const e = out.schedule[d], i = INPUT[d];
    eq([e[role], e[role + "Locked"], e.externalCover, e.source, e.note], [i[role] || null, !!i[role + "Locked"], i.externalCover || null, i.source, i.note], "held " + role + " slot rewritten in fill-open-only mode");
  }));
  CUR.day = "-";
  const filled = bfOpen.filter((k) => { const [d, role] = k.split(" "); return !!out.schedule[d][role]; });
  const listed = bfOpen.filter((k) => { const [d, role] = k.split(" "); return inUncovered(out, d, role); });
  eq(filled.length + listed.length, bfOpen.length, "every open slot is filled or listed with reasons (filled " + JSON.stringify(filled) + ", listed " + JSON.stringify(listed) + ")");
  ok(listed.includes("2026-10-15 primary"), "10/15 primary stays open (nobody's rules allow it): " + JSON.stringify(listed));
  bfOpen.filter((k) => /backup$/.test(k)).forEach((k) => ok(filled.includes(k), "open backup " + k + " gets no candidate although backup is open to everyone (listed: " + JSON.stringify(listed) + ")"));
  ok(filled.includes("2026-10-24 primary") || listed.includes("2026-10-24 primary"), "10/24 primary filled or listed");
}
// The unlocked-held case (test/fixtures/fill-open-only-2026-10.json): Khan written in as 10/21 backup and Acton as
// 10/24 primary, neither locked. A plain generate() regenerates both; fillOpenOnly keeps them byte-identical, counts
// them as fixed, never reports them as hard violations and lists Acton's off-list 10/24 in fixedViolations; the
// locked-slot report (lockViolations) is unaffected.
{
  const FIXO = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "fill-open-only-2026-10.json"), "utf8"));
  const inputO = SA.seedToContextInput(seed, { eastDerived: DERIVED, eastBusyDays: { [KHAN]: KHAN_BUSY }, eastFeedCoverage: EAST_COVER, eastForecast: { [KHAN]: FORECAST } });
  Object.keys(FIXO.schedule).forEach((d) => { inputO.schedule[d] = JSON.parse(JSON.stringify(FIXO.schedule[d])); });
  const ctxO = R.buildContext(inputO);
  if (ctxO.warnings.length) fail("buildContext warnings (fill-open-only fixture): " + JSON.stringify(ctxO.warnings));
  CUR.range = "fill-open-only fixture " + BF.start + ".." + BF.end; CUR.seed = 1; CUR.day = "2026-10-24";
  eq([FIXO.schedule["2026-10-24"].primary, FIXO.schedule["2026-10-24"].primaryLocked, FIXO.schedule["2026-10-21"].backup, FIXO.schedule["2026-10-21"].backupLocked], [ACTON, false, KHAN, false], "fixture: Acton 10/24 primary and Khan 10/21 backup, both unlocked");
  ok(!ACT_AVAIL.primary.has("2026-10-24") && ACT_GOV["2026-10"].has(P), "fixture: 10/24 is off Acton's governed October primary list (a fixed-slot conflict)");
  const outN = GEN.generate(ctxO, BF.start, BF.end, { seed: 1, bestOf: 2 });
  eq(outN.diagnostics.mode, "generate", "default mode");
  eq(outN.diagnostics.fixedSlots, bfFixed, "default mode: only the locked slots are fixed");
  ok(outN.schedule["2026-10-24"].primary !== ACTON, "default mode: the unlocked Acton primary on 10/24 is cleared and regenerated (got " + outN.schedule["2026-10-24"].primary + ")");
  const outO = GEN.generate(ctxO, BF.start, BF.end, { seed: 1, bestOf: 2, fillOpenOnly: true });
  const DOo = outO.diagnostics, e24 = outO.schedule["2026-10-24"], e21 = outO.schedule["2026-10-21"];
  eq(DOo.mode, "fill-open-only", "fixture: mode");
  eq(DOo.fixedSlots, bfFixed + 2, "fixture: the two unlocked held slots count as fixed too");
  eq([e24.primary, e24.primaryLocked, e24.source, e24.note], [ACTON, false, "manual", FIXO.schedule["2026-10-24"].note], "fixture: 10/24 primary - the unlocked Acton stays as written");
  eq([e21.backup, e21.backupLocked, e21.primary, e21.primaryLocked, e21.source], [KHAN, false, ACTON, true, "manual"], "fixture: 10/21 - the unlocked Khan backup stays, the locked Acton primary too");
  ok(e24.backup && e24.backup !== ACTON, "fixture: 10/24 backup is filled by someone else (got " + e24.backup + ")");
  eq(DOo.hardViolations, [], "fixture: fixed slots are facts, never hard violations");
  ok(Array.isArray(DOo.fixedViolations) && DOo.fixedViolations.some((v) => v.day === "2026-10-24" && v.role === P && v.id === ACTON && v.reasons.some((r) => r.indexOf("whitelist-month") === 0)), "fixture: Acton's off-list 10/24 is reported in diagnostics.fixedViolations: " + JSON.stringify(DOo.fixedViolations));
  eq(DOo.lockViolations.map((l) => l.day + " " + l.role + " " + l.id), expectedLockViolations(BF).map((l) => l.day + " " + l.role + " " + l.id), "fixture: lockViolations unaffected by fill-open-only (locked slots only)");
  ok(!DOo.warnings.some((w) => /generator bug/.test(w)), "fixture: generator reports its own bug");
  const openO = []; bfDays.forEach((d) => ROLES.forEach((role) => { const e = inputO.schedule[d]; if (!(e && (e[role] || (role === P && e.externalCover)))) openO.push(d + " " + role); }));
  openO.forEach((k) => { const [d, role] = k.split(" "); ok(!!outO.schedule[d][role] !== inUncovered(outO, d, role), "fixture: open slot " + k + " filled XOR listed"); });
  eq(openO.length, bfOpen.length - 2, "fixture: two fewer open slots than the seed (10/21 backup, 10/24 primary held)");
  CUR.range = "R2 Nov-Dec"; CUR.seed = "-"; CUR.day = "-";
}

/* ------------------------------------------------ the Nov-Dec table */
const tBig = Date.now();
const big = GEN.generate(ctx, RANGES[1].start, RANGES[1].end, { seed: 1, bestOf: 200 });
const bigMs = Date.now() - tBig;
checkRun(big, RANGES[1], 1, true); // seed 1, bestOf 200; deep = item G tally comparison
// 9/22 (item I review): with backup open to everyone the milestone preview has no
// open slot at all - the three Thursday backups (11/05, 11/19, 12/03) that only the
// old day rules left open are now fillable. Deterministic (genPrng, seed 1).
CUR.range = "R2 Nov-Dec bestOf 200"; CUR.seed = 1; CUR.day = "-";
// T (9/22): with the ER-panel author's November locks, Thu 11/5 primary is open for nobody - Acton (its locked backup) did not offer
// 11/5 as primary, Burchett did not offer it at all, Philip's week of 11/2 is not on his list, Khan never takes a
// Thursday, Fierce is in Clinton, Sarkar is outside her window (rules doc section 8 item 13). It is the ONLY open slot
// of the milestone preview; every reason is restated by name.
eq(big.diagnostics.uncovered.map((u) => u.day + " " + u.role), ["2026-11-05 primary"], "milestone preview (seed 1, bestOf 200): exactly one open slot - 11/5 primary (T)");
{
  const u = big.diagnostics.uncovered[0], first = (id) => String((u.reasons[id] || [])[0] || "");
  eq([first(ACTON), first(BURCHETT), first(PHILIP), first(KHAN), first(FIERCE), first(SARKAR)], ["whitelist-month", "whitelist-month", "outside-available-weeks", "hard-never-weekday:Thu", "weekday-pattern:Thu", "outside-window"], "11/5 primary: the first hard reason per surgeon (Acton also holds-other-role)");
}
// J (9/22): equal shares in force on the milestone preview - both checks read the targets from the diagnostics.
// (1) Khan is no longer the default weekend backup: his Nov-Dec backup count is at most 1.5 x his backup target
//     (review section 4 item 2: the old preview gave him 21 backups against a share near 8-9).
// (2) every pool member's monthly primary count is within 3 of the primary target unless availability limits it
//     (allowedPrimary + locked primaries below the target). T (9/22): the symmetric case - a member is FORCED over his
//     target when he is the ONLY pool member eligible for an open primary on the lock-only base (November after the ER-panel author's
//     locks: Philip is the sole candidate for Tue 11/10, Thu 11/12, Fri 11/13 and Tue 11/24 - Burchett and Acton are off
//     their published lists, Khan never a Tue/Thu and East-busy 11/13, Fierce is locked backup 11/9-11/16 and in Clinton,
//     Sarkar is outside her window). Fairness cannot move a day nobody else may take, so such sole-candidate days are
//     subtracted before the tolerance is applied; they are computed here from eligibility (standalone or as a block
//     member) on the lock-only schedule and named in the message, and Philip's November set is pinned by name. Only a
//     GENERATED primary counts (the output's own lock flag is off): import locks and Fierce's derived-week locks are
//     already inside lockedHeld.primary and never forced days.
const soleCandidatePrimaries = (out, id, m) => monthDays(m).filter((d) => d >= RANGES[1].start && d <= RANGES[1].end && out.schedule[d] && out.schedule[d].primary === id && !out.schedule[d].primaryLocked &&
  IDS.every((o) => o === id || !(R.eligibility(ctx, d, P, o).ok || R.eligibility(ctx, d, P, o, { asBlockMember: true }).ok)));
{
  const DB = big.diagnostics, kb = DB.tallies[KHAN].range;
  ok(kb.target && typeof kb.target.backup === "number" && kb.target.backup > 0, "Khan must carry a Nov-Dec backup target (got " + JSON.stringify(kb.target) + ")");
  ok(kb.backup <= 1.5 * kb.target.backup, "Khan holds " + kb.backup + " backups in Nov-Dec against a backup target of " + kb.target.backup + " - more than 1.5x, the backup sink is back");
  DB.range.months.forEach((m) => POOL.forEach((id) => {
    const M = DB.impliedTargets.months[m].members[id], c = DB.tallies[id].months[m].primary;
    if (M.allowedPrimary + M.lockedHeld.primary < M.primaryTarget) return; // availability-limited: visible in the shares table, not a defect
    CUR.day = m;
    const forced = soleCandidatePrimaries(big, id, m);
    ok(Math.abs(c - forced.length - M.primaryTarget) <= 3, CODE[id] + " " + m + ": " + c + " primaries against a primary target of " + M.primaryTarget + " (allowed " + M.allowedPrimary + " + locked " + M.lockedHeld.primary + "; sole-candidate days subtracted: " + (forced.join(", ") || "none") + ") - more than 3 off");
  }));
  CUR.day = "-";
  eq(soleCandidatePrimaries(big, PHILIP, "2026-11"), ["2026-11-10", "2026-11-12", "2026-11-13", "2026-11-24"], "T: Philip is the sole primary candidate on exactly 11/10, 11/12, 11/13, 11/24 once the ER-panel author's November locks are in");
  eq(soleCandidatePrimaries(big, PHILIP, "2026-12"), [], "T: no sole-candidate day for Philip in December");
}
// L (9/22, data-driven): Khan = weekend PRIMARY when East allows. On the milestone preview, among the weekends
// open to him (khanOpenWeekends: primary-eligible all three days) the full-block PRIMARY weekends are at least
// as many as the weekends where he holds ANY backup day, and over the run his weekend backup days are at most
// half his weekend primary days (weekend = Fri/Sat/Sun in range outside a holiday unit, so his locked
// Thanksgiving Fri-Sun does not pad the primary side). Pinned only for the surgeon(s) the seed marks.
// The spec's thresholds ('>=' and 'at most half') held on the pre-L code at the boundary (2 vs 1 weekends, 3 vs 6
// days: the 11/20-22 backup block), so the pins hold the OBSERVED post-L outcome - no backup weekend and no weekend
// backup day at all - which is a real fail-before (review 9/22); the counts are printed so drift is visible.
{
  const DB = big.diagnostics, view = makeView(big), days = daysList(RANGES[1].start, RANGES[1].end);
  const openWk = khanOpenWeekends(days);
  const fullP = openWk.filter((trio) => trio.every((d) => holder(view, d, P) === KHAN)).length;
  const anyB = openWk.filter((trio) => trio.some((d) => holder(view, d, B) === KHAN)).length;
  const wkDays = days.filter((d) => isWeekend(d) && !isHoliday(d));
  const kP = wkDays.filter((d) => holder(view, d, P) === KHAN).length, kB = wkDays.filter((d) => holder(view, d, B) === KHAN).length;
  console.log("L (Khan weekends, Nov-Dec bestOf 200 seed 1): weekends open to him " + openWk.length + ", full-block primary " + fullP + ", with a backup day of his " + anyB + "; weekend days outside holiday units: primary " + kP + ", backup " + kB);
  // T (9/22): the ER-panel author's November locks change the data under these pins - Fri 11/20 is Burchett's, so the 11/20-22 weekend
  // is no longer open to Khan (two open weekends remain: 12/4 and 12/18), and the 11/6-8 primaries are all locked
  // (Acton, Burchett, Burchett), so the only way he can serve that weekend is backup. The pins therefore hold L's own
  // statements rather than the pre-T observed counts: he is never backup on a weekend he could have taken as primary
  // (anyB 0), his full-block primary weekends are at least his backup weekends (spec '>='), he blocks at least one open
  // weekend, and over the run his weekend backup days are at most half his weekend primary days (spec 'at most half').
  ok(fullP >= 1 && fullP >= anyB && anyB === 0, "L: of the " + openWk.length + " weekends open to Khan he is full-block primary on " + fullP + " (>= 1 and >= his backup weekends expected) and holds a backup day on " + anyB + " (0 expected: " + openWk.filter((trio) => trio.some((d) => holder(view, d, B) === KHAN)).map((t) => t[0]).join(", ") + ")");
  ok(kP >= 3 && kB * 2 <= kP, "L: Khan holds " + kB + " weekend backup days (at most half expected) against " + kP + " weekend primary days (>= 3 expected) in Nov-Dec: " + wkDays.filter((d) => holder(view, d, B) === KHAN).join(", "));
  ok(wkDays.filter((d) => holder(view, d, B) === KHAN).every((d) => holder(INPUT, d, P) != null || holder(INPUT, d, B) != null || !R.eligibility(ctx, d, P, KHAN, { asBlockMember: true }).ok), "L/T: every weekend backup day of Khan's lies on a day whose primary was locked to someone else (or East-busy for him): " + wkDays.filter((d) => holder(view, d, B) === KHAN).join(", "));
  ok(DB.softPenalties.some((s) => s.id === KHAN && s.reason === "weekend-primary" && s.weight < 0), "L: the preview's soft list carries Khan's weekend-primary bonus (the term is in force)");
  // holiday units are not weekend units (review 9/22): neither L term ever lands on a holiday-unit day
  eq(DB.softPenalties.filter((s) => (s.reason === "weekend-primary" || s.reason === "weekend-backup") && isHoliday(s.day)).map((s) => s.day + " " + s.role + " " + s.reason), [], "L: no weekend-primary / weekend-backup term on a holiday-unit day");
  eq(IDS.filter((id) => SR[id].primaryContribution === "weekends"), [KHAN], "seed: Khan is the one surgeon with primaryContribution weekends");
  eq(seed.groupRules.weights.weekendContribution, 3, "seed: groupRules.weights.weekendContribution = 3 (medium)");
}
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
  // T (9/22): the ER-panel author's published rows lock Acton as backup on 11/3, 11/5, 11/17 - a lock is a fact the generator never
  // moves, so those three stay (reported as lock violations naming the opt-out); he is never PLACED as backup.
  const actonLockedB = Object.keys(INPUT).filter((d) => d >= RANGES[1].start && d <= RANGES[1].end && lockedIn(d, B) && INPUT[d].backup === ACTON);
  eq(actonLockedB, ["2026-11-03", "2026-11-05", "2026-11-17"], "seed: Acton's locked November backups (the ER-panel author 9/22)");
  const actonBackups = Object.keys(outOpt.schedule).filter((d) => outOpt.schedule[d].backup === ACTON && !actonLockedB.includes(d));
  eq(actonBackups, [], "opt-out run: Acton placed as backup on " + actonBackups.join(", "));
  actonLockedB.forEach((d) => { eq([outOpt.schedule[d].backup, outOpt.schedule[d].backupLocked], [ACTON, true], "opt-out run: the locked Acton backup " + d + " stays a lock"); ok(DO.lockViolations.some((l) => l.day === d && l.role === B && l.id === ACTON && l.reasons.some((r) => String(r).indexOf("backup-opt-out") === 0)), "opt-out run: the locked Acton backup " + d + " is reported as a lock violation naming backup-opt-out: " + JSON.stringify(DO.lockViolations.filter((l) => l.day === d))); });
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
  // T (9/22): the seed now holds the ER-panel author's 11/2 row (Acton P + Burchett B); the fixture replaces the whole row with the manual Philip lock
  eq([holder(inputEdge.schedule, "2026-11-02", P), holder(inputEdge.schedule, "2026-11-02", B)], [ACTON, BURCHETT], "seed: 11/2 is Acton P + Burchett B (the ER-panel author 9/22) - the fixture overrides that row");
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
// Review 9/22 (Prompt 12 K, fix stage): an East PRIMARY week Fierce does NOT hold in the base schedule still
// counts toward his 14 (rules.js adds P.eastPrimaryDays whatever the Silvis schedule says), so the implied-target
// clip must subtract exactly those East-ONLY days - here the backup of 11/09..11/15 is manually locked to Acton
// (import/manual beats derived: the 7 derived locks are overridden with a warning), so the week is East-only:
// eastOnly 7, clip 14 - 1 - 7 = 6, tallies.eastP 7. The held case (eastOnly 0 / clip 13) is pinned in checkRun.
// One November-only run at bestOf 1.
{
  const inputOv = SA.seedToContextInput(seed, { eastDerived: DERIVED, eastBusyDays: { [KHAN]: KHAN_BUSY }, eastFeedCoverage: EAST_COVER, eastForecast: { [KHAN]: FORECAST } });
  CUR.range = "derived-week-overridden fixture 2026-11-02..2026-11-30"; CUR.seed = 1; CUR.day = "2026-11-09";
  const wkOv = daysList("2026-11-09", "2026-11-15");
  eq(wkOv.map((d) => DERIVED_ROLE[d]), [B, B, B, B, B, B, B], "fixture week must be Fierce's derived Silvis-BACKUP (East primary) week");
  wkOv.forEach((d) => { ok(inputOv.schedule[d] && inputOv.schedule[d].backup === FIERCE && inputOv.schedule[d].backupLocked === true, "seed: " + d + " is Fierce's explicit backup row (T) - the fixture replaces it with a manual Acton lock"); inputOv.schedule[d] = { primary: null, backup: ACTON, primaryLocked: false, backupLocked: true, source: "manual", externalCover: null, note: "harness: derived week overridden" }; });
  const ctxOv = R.buildContext(inputOv);
  if (ctxOv.warnings.length) fail("buildContext warnings (derived-week-overridden fixture): " + JSON.stringify(ctxOv.warnings));
  const heldOv = daysList("2026-11-01", "2026-11-30").filter((d) => holder(inputOv.schedule, d, P) === FIERCE || holder(inputOv.schedule, d, B) === FIERCE).length;
  const outOv = GEN.generate(ctxOv, "2026-11-02", "2026-11-30", { seed: 1, bestOf: 1 });
  const DOv = outOv.diagnostics, novOv = DOv.impliedTargets.months["2026-11"];
  CUR.day = "-";
  wkOv.forEach((d) => { eq(outOv.schedule[d].backup, ACTON, "manual backup lock kept on " + d); ok(DOv.warnings.some((w) => w.indexOf("derived lock overridden by import/manual lock: " + d + " backup derived " + FIERCE) === 0), "missing the 'derived lock overridden' warning for " + d + ": " + JSON.stringify(DOv.warnings)); });
  ok(!DOv.warnings.some((w) => /generator bug/.test(w)), "derived-week-overridden run: generator reports its own bug");
  // T: all seven days yield to the manual Acton locks - listed once each, one warning for the week, nothing confirmed
  eq(DOv.derivedYields.map((y) => y.day + ":" + y.role + ":" + y.holderId + ":" + y.holderRole + ":" + y.holderSource), wkOv.map((d) => d + ":" + B + ":" + ACTON + ":" + B + ":manual"), "T: derivedYields lists the whole overridden week");
  eq(DOv.warnings.filter((w) => /^derived week /.test(w)), ["derived week 2026-11-09 (" + NAME[FIERCE] + " Silvis backup) yields to published entries on " + wkOv.join(", ")], "T: one warning naming all seven days");
  eq(DOv.derivedConfirmed, [], "T: nothing confirmed once the whole week is someone else's");
  const NFOv = novOv.members[FIERCE];
  eq(NFOv.lockedHeld.primary + NFOv.lockedHeld.backup, heldOv, "Fierce holds " + heldOv + " November day(s) before generation (the overridden week is not his)");
  eq([NFOv.eastPrimaryDays, NFOv.clipPrimary], [7, 14 - 1 - 7], "the overridden East primary week still counts: eastPrimaryDays 7, clipPrimary 6 (J: the same clip as when he holds the derived backup)");
  ok(NFOv.primaryTarget <= Math.max(NFOv.lockedHeld.primary, 6) + 0.05, "Fierce November primary target " + NFOv.primaryTarget + " above max(locked primaries " + NFOv.lockedHeld.primary + ", clip 6)");
  eq(DOv.tallies[FIERCE].months["2026-11"].eastP, 7, "tallies.eastP still counts the East primary-week days he does not hold in Silvis");
  CUR.range = "R2 Nov-Dec"; CUR.seed = "-"; CUR.day = "-";
}
const sortedR2 = r2Results.slice().sort((a, b) => a.score - b.score);
const median = sortedR2[Math.floor(sortedR2.length / 2)];

function pad(s, n, right) { s = String(s); return right ? s.padEnd(n) : s.padStart(n); }
function printTallies(out, title) {
  const D = out.diagnostics;
  console.log("\n" + title);
  console.log("  score " + JSON.stringify(Object.assign({}, D.score, { weights: undefined })) + "; candidates " + D.candidatesTried + "; warnings " + D.warnings.length);
  const tg = (t, role) => (t && t.target && typeof t.target[role] === "number") ? t.target[role] : "-";
  console.log("  " + pad("surgeon", 8, true) + pad("month", 8, true) + pad("prim", 6) + pad("bkup", 6) + pad("total", 6) + pad("wkend", 6) + pad("major", 6) + pad("minor", 6) + pad("maxCP", 6) + pad("maxCA", 6) + pad("cap(P)", 7) + pad("tgtP", 7) + pad("tgtB", 7));
  Object.keys(D.tallies).forEach((id) => {
    const t = D.tallies[id];
    Object.keys(t.months).forEach((m) => {
      const x = t.months[m];
      console.log("  " + pad(t.code, 8, true) + pad(m, 8, true) + pad(x.primary, 6) + pad(x.backup, 6) + pad(x.total, 6) + pad(x.weekendDays, 6) + pad(x.majorHolidays, 6) + pad(x.minorHolidays, 6) + pad(x.maxConsecutive, 6) + pad(x.maxConsecutiveAnyRole, 6) + pad(x.cap === null ? "-" : x.cap, 7) + pad(tg(x, "primary"), 7) + pad(tg(x, "backup"), 7));
    });
    const r = t.range;
    console.log("  " + pad(t.code, 8, true) + pad("RANGE", 8, true) + pad(r.primary, 6) + pad(r.backup, 6) + pad(r.total, 6) + pad(r.weekendDays, 6) + pad(r.majorHolidays, 6) + pad(r.minorHolidays, 6) + pad(r.maxConsecutive, 6) + pad(r.maxConsecutiveAnyRole, 6) + pad(r.cap === null ? "-" : r.cap, 7) + pad(tg(r, "primary"), 7) + pad(tg(r, "backup"), 7));
  });
  console.log("  implied targets (" + D.impliedTargets.rule + "):");
  Object.keys(D.impliedTargets.months).forEach((m) => {
    const I = D.impliedTargets.months[m];
    console.log("    " + m + " primaryOpen " + I.primaryOpen + " - reserved " + I.reservedForWindows + " / pool " + I.poolSize + " = primaryShare " + I.primaryShare + "; backupOpen " + I.backupOpen + " / " + I.poolSize + " = backupShare " + I.backupShare + "; placeable at target " + I.placeableAtTarget.primary + " P / " + I.placeableAtTarget.backup + " B of " + I.primaryOpen + " / " + I.backupOpen + " open" + (I.rangeDays < monthDays(m).length ? " (partial month: " + I.rangeDays + " days in range)" : ""));
    console.log("      " + pad("member", 6, true) + pad("tgtP", 6) + pad("allwP", 6) + pad("lockP", 6) + pad("clipP", 6) + pad("tgtB", 6) + pad("allwB", 6) + pad("lockB", 6));
    Object.keys(I.members || {}).forEach((id) => { const M = I.members[id]; console.log("      " + pad(CODE[id], 6, true) + pad(M.primaryTarget === null ? "-" : M.primaryTarget, 6) + pad(M.allowedPrimary, 6) + pad(M.lockedHeld.primary, 6) + pad(M.clipPrimary === null ? "-" : M.clipPrimary, 6) + pad(M.backupTarget === null ? "-" : M.backupTarget, 6) + pad(M.allowedBackup, 6) + pad(M.lockedHeld.backup, 6)); });
  });
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

// ---- Prompt 12 U (9/22 evening) ----
// Seed pin, no generator run: a MINOR holiday on a Monday absorbs the weekend
// before it (Sat-Mon) from 2027 on - Memorial Day 5/29-5/31, Labor Day 9/4-9/6,
// July 4 2027 (a Sunday) alone - and 2026's units stay exactly as built before
// the rule, so the milestone range 2026-11-02 -> 2027-01-03 does not move.
// The Friday before each Sat-Mon unit is not a unit day in ctx (it is the
// reduced weekend unit; test/holidays.test.js proves the generator's handling).
{
  CUR.range = "seed-U"; CUR.seed = "-"; CUR.day = "-";
  const unitDays = (y, name) => { const u = (seed.holidays.units[y] || []).find((x) => x.name === name); return u ? u.days : null; };
  eq(seed.groupRules.holidays.mondayMinorAbsorbsWeekend, true, "seed: groupRules.holidays.mondayMinorAbsorbsWeekend (Prompt 12 U)");
  eq(unitDays("2027", "Memorial Day"), ["2027-05-29", "2027-05-30", "2027-05-31"], "seed 2027 Memorial Day is Sat-Mon");
  eq(unitDays("2027", "Labor Day"), ["2027-09-04", "2027-09-05", "2027-09-06"], "seed 2027 Labor Day is Sat-Mon");
  eq(unitDays("2027", "July 4th"), ["2027-07-04"], "seed 2027 July 4th (a Sunday) stays its own day");
  eq(unitDays("2026", "Memorial Day"), ["2026-05-25"], "seed 2026 Memorial Day left as built (past)");
  eq(unitDays("2026", "July 4th"), ["2026-07-04"], "seed 2026 July 4th left as built (past)");
  eq(unitDays("2026", "Labor Day"), ["2026-09-07"], "seed 2026 Labor Day left as built (past)");
  eq(unitDays("2026", "Thanksgiving"), ["2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"], "seed 2026 Thanksgiving unchanged (Thu-Sun)");
  eq(unitDays("2026", "Christmas"), ["2026-12-24", "2026-12-25"], "seed 2026 Christmas unchanged");
  eq(unitDays("2026", "New Year's"), ["2026-12-31", "2027-01-01"], "seed 2026 New Year's unchanged");
  [["2027-05-28", "2027-05-29", "Memorial Day"], ["2027-09-03", "2027-09-04", "Labor Day"]].forEach(([fri, sat, name]) => {
    CUR.day = fri;
    ok(!ctx.holidayByDay[fri] && !HOLIDAY[fri], "the Friday before the " + name + " unit is not a unit day (reduced weekend unit)");
    CUR.day = sat;
    ok(ctx.holidayByDay[sat] && ctx.holidayByDay[sat].name === name && ctx.holidayByDay[sat].days.length === 3, "ctx: " + sat + " opens the 3-day " + name + " unit");
  });
  CUR.range = "-"; CUR.day = "-";
}

// ---- Prompt 12 V (9/22 evening) ----
// Standing East rule (surgeonRules.s1.eastStanding = Christmas 12-24 + 12-25):
// Khan is on Davenport call every Christmas Eve and Christmas Day, so he is
// never Silvis PRIMARY on those days in any year; backup stays open (his East
// days never block backup). Restated here against every stored run whose days
// include 2026-12-24/25 - the 50 R2 runs, the 25 R4 runs, the same-seed R2 run
// and the bestOf-200 preview - on placed AND locked slots (no lock exists there;
// one would be a fact to flag, never to accept silently). No new generator run.
// (V review) The placement pin is belt-and-braces here: the harness's forecast fixture
// (test/fixtures/east-forecast-2026-09-22.json) rates 12/23-12/26 at 1.0, so the forecast
// alone kept Khan off Christmas 2026 before V (a HEAD-engine soak found 0 of 76 runs with
// him primary). The lines that bite on an engine without V are the eastStandingDays
// diagnostics below; the rule itself is proved without a forecast in test/rules.test.js
// (V block) and test/holidays.test.js (D1 candidates).
{
  CUR.range = "V"; CUR.seed = "-"; CUR.day = "-";
  const standing = (SR[KHAN].eastStanding || []).find((e) => e.name === "Christmas");
  eq(standing && standing.days, ["12-24", "12-25"], "seed: surgeonRules.s1.eastStanding Christmas = 12-24 + 12-25 (Prompt 12 V)");
  eq(SR[KHAN].eastFeed.enabled, true, "seed: the standing rule acts through Khan's East feature (same gate as busy days)");
  const runs = r2Results.map((r) => ({ label: "R2 seed " + r.seed, out: r.out }))
    .concat(r4Results.map((r) => ({ label: "R4 seed " + r.seed, out: r.out })))
    .concat([{ label: "R2 seed 1 (a1)", out: a1 }, { label: "Nov-Dec bestOf 200", out: big }]);
  ok(runs.length >= 77, "V covers " + runs.length + " stored runs (50 R2 + 25 R4 + a1 + bestOf 200)");
  let checked = 0;
  runs.forEach((r) => {
    CUR.seed = r.label;
    ["2026-12-24", "2026-12-25"].forEach((d) => {
      CUR.day = d;
      ok(r.out.schedule[d], d + " is in the run");
      ok(r.out.schedule[d].primary !== KHAN, "V: Khan is never Silvis primary on " + d + " (standing East call, every year) - got " + JSON.stringify(r.out.schedule[d]));
      checked++;
    });
    CUR.day = "-";
    eq(r.out.diagnostics.eastStandingDays && r.out.diagnostics.eastStandingDays[KHAN], ["2026-12-24", "2026-12-25"], "diagnostics.eastStandingDays.s1 for a run over Christmas 2026");
    ok(!r.out.diagnostics.eastUnknownDays.some((u) => u.id === KHAN && (u.day === "2026-12-24" || u.day === "2026-12-25")), "a standing day is never listed as East-unknown");
  });
  ok(checked === runs.length * 2, "V checked " + checked + " day slots");
  CUR.range = "-"; CUR.seed = "-"; CUR.day = "-";
}

const total = Date.now() - T_FILE;
console.log("\ntimings: " + RANGES.map((r, i) => { const t = timing[r.name]; return r.name + " bestOf " + BEST_OF[i] + ": " + t.ms + " ms / " + t.runs + " runs (" + (t.ms / t.candidates).toFixed(1) + " ms per candidate)"; }).join("; ") + "; " + BF.name + " bestOf 2: " + timing[BF.name].ms + " ms / " + timing[BF.name].runs + " runs (" + (timing[BF.name].ms / timing[BF.name].candidates).toFixed(1) + " ms per candidate); Nov-Dec bestOf 200: " + bigMs + " ms (" + (bigMs / big.diagnostics.candidatesTried).toFixed(1) + " ms per candidate)");
console.log("ok " + N + " assertions, " + SEEDS + " seeds x " + RANGES.length + " ranges at bestOf " + BEST_OF.join("/") + " (R4 on the even seeds: " + timing[RANGES[3].name].runs + " runs) + " + SEEDS + " fill-open-only backfill runs at bestOf 2 + 1 x bestOf 200 + 7 fixture runs (" + total + " ms total; budget " + BUDGET_MS + " ms" + (process.env.SILVIS_GEN_BUDGET_MS ? " via SILVIS_GEN_BUDGET_MS" : "") + ")");
if (KNOWN_GAPS.length) console.log("known gaps still open (" + KNOWN_GAPS.length + "; owned outside this harness; SILVIS_STRICT=1 fails on them):\n  " + KNOWN_GAPS.join("\n  "));
CUR.range = "-"; CUR.seed = "-"; CUR.day = "-";
if (BEST_OF_OVERRIDE) console.log("coverage overridden via SILVIS_GEN_BEST_OF=" + BEST_OF_OVERRIDE + ": the " + BUDGET_MS + " ms budget is not enforced for this run");
else ok(total <= BUDGET_MS, "over the " + BUDGET_MS + " ms budget: " + total + " ms total (Prompt 4: all runs must finish under 10 s; lower BEST_OF_DEFAULT or prune rules.weekendUnitPatterns - never downgrade this to a warning)");
process.exit(0);
