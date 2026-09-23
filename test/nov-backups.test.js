// Silvis - NB (2026-09-23) / WF (decision 9/23, water-filled share): do the running tallies
// count the slots that were FIXED before a pass, and does a member whose fixed days already
// exceed his share get NO further day of that role while a peer is still below share?
//
// Synthetic and independent of docs/silvis-seed.json: a pool of THREE equal members A, B, C,
// one calendar month (June 2026, no holiday units, every soft weight that a bare pool could
// incur set to 0 so the fairness term decides alone), surgeon A holding N LOCKED days of one
// role, B and C holding nothing. The OTHER role is locked on every day of the month to Z, a
// non-pool holder (poolMember false, no target), so the role under test is a single clean
// allocation: with two open roles and three people the backup of a day is the complement of
// its primary whenever only two are available, and the primary pass would fix the backup
// split (first draft of this test, 9/23). Two placements of the locks (the counters are
// whole-month figures and the range may start after them) and two peer profiles:
//   spread    - locks on days 1, 3, 5, ... (2N-1), range = the whole month;
//   pre       - locks on days 1..N, range = day N+1 .. 30 (the locks precede the range);
//   free      - B and C available every day;
//   b-limited - B unavailable for the role from day 8 to the end of the month (a dated
//               unavailable row for that role), so B cannot reach his share and the days he
//               cannot take must be split between A and C.
// The water-filled share (decision 9/23, rules doc section 6): the pool's slots of the month
// are ALL its slots, open and fixed - 30 here - so every member's target is 30 / 3 = 10
// whatever N is (never floored at the fixed count, never the share of the open slots alone),
// and the deviation term is convex, so the candidate furthest below share wins and each day
// above share costs more than the one before. Restated expectation, per role, N below (6) and
// above (12) the share, five seeds:
//   1. diagnostics.impliedTargets reports A's lockedHeld = N;
//   2. every target is the share (10) regardless of N - A's is NOT max(N, share), NOT the share
//      of the open slots; the share reported for the month is that level;
//   3. the whole-month tally reported for A = N + his generated days;
//   4. N above the share, both peers free: A receives NO generated day of the role while the
//      peers sit below share (they end at 9 and 9 - within one of each other);
//   5. N below the share, both peers free: the three finish within one day of each other;
//   6. B limited: A and C - the two who can take the leftover - finish within one day of each
//      other, however far above the share that lands them (the flat +1 per extra day is gone:
//      the one who holds fewer takes the next); A receives no generated day while C is still
//      below share.
// A generator that floors the target at the fixed count fails 2 (target 12 for N = 12); one
// with a flat deviation term fails 4 / 6 (a coin flip per leftover day instead of the lower
// count) - the mutant runs are quoted in docs/REPORT-WATER-FILL-2026-09-23.md.
//
// Runs inside test/generator-regression.js (the CI chain) through run(); standalone:
//   node test/nov-backups.test.js   (exit 1 on the first failing assertion)
"use strict";
const pad2 = (n) => (n < 10 ? "0" : "") + n;
const MONTH = "2026-06", LAST = 30;
const IDS = ["a", "b", "c"];
const OTHER = "z"; // non-pool holder of the OTHER role, locked every day (see the header)
const LIMIT_FROM = 8; // b-limited: B's unavailable row for the role runs from this day to the end of the month
const round1 = (v) => Math.round(v * 10) / 10;

function build(R, role, nLocked, variant, profile) {
  const other = role === "primary" ? "backup" : "primary";
  const roster = IDS.concat([OTHER]).map((id) => ({ id, name: id.toUpperCase(), code: id.toUpperCase() + id.toUpperCase() + id.toUpperCase(), active: true, roles: ["surgeon"] }));
  const surgeonRules = {};
  IDS.forEach((id) => { surgeonRules[id] = { poolMember: true, monthlyCap: null, maxConsecutiveDays: 31 }; });
  surgeonRules[OTHER] = { poolMember: false, monthlyCap: null, maxConsecutiveDays: 31 };
  // every soft weight a bare pool could incur is 0: the fairness term decides alone
  const weights = { low: 1, medium: 3, strong: 10, preferred: -1, patternDaily: 0, patternMismatch: 0, backToBackWeekend: 0, backupAfterPrimary: 0, weekendContribution: 0, longRunPerDay: 0, smoothingTolerance: 2 };
  const groupRules = { weekendUnit: { days: ["Fri", "Sat", "Sun"] }, defaultMaxConsecutiveDays: 31, backupDistinctFromPrimary: true, weights };
  const lockDays = [];
  for (let k = 0; k < nLocked; k++) lockDays.push(variant === "spread" ? 2 * k + 1 : k + 1);
  const schedule = {};
  for (let d = 1; d <= LAST; d++) {
    const e = { primary: null, backup: null, primaryLocked: false, backupLocked: false, source: "import", externalCover: null, note: null };
    e[other] = OTHER; e[other + "Locked"] = true;
    if (lockDays.indexOf(d) >= 0) { e[role] = "a"; e[role + "Locked"] = true; }
    schedule[MONTH + "-" + pad2(d)] = e;
  }
  const availabilityRows = profile === "b-limited" ? [{ person_id: "b", start_date: MONTH + "-" + pad2(LIMIT_FROM), end_date: MONTH + "-" + pad2(LAST), kind: "unavailable", role }] : [];
  const start = MONTH + "-" + pad2(variant === "spread" ? 1 : nLocked + 1), end = MONTH + "-" + pad2(LAST);
  const ctx = R.buildContext({ roster, surgeonRules, groupRules, holidays: { units: {} }, timeOffRows: [], availabilityRows, schedule, rangeStart: start, rangeEnd: end });
  return { ctx, start, end, lockDays };
}

// generated (= not locked) days of `role` per surgeon over the month
function generatedCounts(out, role) {
  const c = {}; IDS.forEach((id) => { c[id] = 0; });
  Object.keys(out.schedule).forEach((day) => {
    const e = out.schedule[day];
    if (!e || e[role + "Locked"] || !e[role] || c[e[role]] === undefined) return;
    c[e[role]]++;
  });
  return c;
}

// deps: { R, GEN, ok(cond, msg), log(line) }; opts: { seeds, bestOf }. Returns the summary lines.
function run(deps, opts) {
  const R = deps.R, GEN = deps.GEN, ok = deps.ok, log = deps.log || function () {};
  const seeds = (opts && opts.seeds) || 5, bestOf = (opts && opts.bestOf) || 2;
  const SHARE = round1(LAST / IDS.length); // 30 slots of the role in the month, all held or open for the pool of three
  const summary = [];
  ["backup", "primary"].forEach((role) => {
    ["spread", "pre"].forEach((variant) => {
      ["free", "b-limited"].forEach((profile) => {
        [6, 12].forEach((nLocked) => {
          for (let seed = 1; seed <= seeds; seed++) {
            const b = build(R, role, nLocked, variant, profile);
            const out = GEN.generate(b.ctx, b.start, b.end, { seed, bestOf, respectLocks: true });
            const dg = out.diagnostics;
            const tag = "nov-backups " + role + " " + variant + " " + profile + " N=" + nLocked + " seed " + seed;
            ok(dg.uncovered.length === 0, tag + ": open slots " + JSON.stringify(dg.uncovered.map((u) => u.day + " " + u.role)));
            ok(dg.lockViolations.length === 0, tag + ": lock violations " + JSON.stringify(dg.lockViolations));
            ok(dg.hardViolations.length === 0, tag + ": hard violations " + JSON.stringify(dg.hardViolations));
            const IT = dg.impliedTargets.months[MONTH], M = IT.members;
            const targets = {}; IDS.forEach((id) => { targets[id] = M[id][role + "Target"]; });
            // 1. the tally sees the locks
            ok(M.a.lockedHeld[role] === nLocked, tag + ": impliedTargets lockedHeld." + role + " for A expected " + nLocked + " got " + M.a.lockedHeld[role]);
            // 2. the water-filled share: every target is the share of ALL the month's slots, A's included, whatever N is
            ok(IT[role + "Share"] === SHARE, tag + ": the month's " + role + " share " + IT[role + "Share"] + " is not the water level " + SHARE + " (" + LAST + " slots / " + IDS.length + ")");
            IDS.forEach((id) => ok(targets[id] === SHARE, tag + ": " + id.toUpperCase() + "'s " + role + " target " + targets[id] + " is not the share " + SHARE + " regardless of N (locked " + (id === "a" ? nLocked : 0) + ")"));
            ok(/water-filled/.test(dg.impliedTargets.rule || ""), tag + ": impliedTargets.rule does not name the water-filled share");
            // 3. the whole-month tally reported for A = locks + generated
            const gen = generatedCounts(out, role);
            const F = {}; IDS.forEach((id) => { F[id] = dg.tallies[id].months[MONTH][role]; });
            ok(F.a === nLocked + gen.a, tag + ": tallies for A " + F.a + " != locked " + nLocked + " + generated " + gen.a);
            // 4. / 5. / 6. the convex term hands every leftover day to whoever holds fewer
            if (profile === "free") {
              if (nLocked > SHARE) {
                ok(gen.a === 0, tag + ": A (locked " + nLocked + " against a share of " + SHARE + ") received " + gen.a + " generated " + role + " day(s) while B (" + F.b + ") and C (" + F.c + ") sit below share");
                ok(Math.abs(F.b - F.c) <= 1, tag + ": B " + F.b + " and C " + F.c + " differ by more than one " + role + " day");
              } else {
                const vals = IDS.map((id) => F[id]);
                ok(Math.max.apply(null, vals) - Math.min.apply(null, vals) <= 1, tag + ": finals " + JSON.stringify(F) + " spread by more than one " + role + " day (A's locked " + nLocked + " count toward his share)");
              }
            } else {
              ok(Math.abs(F.a - F.c) <= 1, tag + ": with B limited, A " + F.a + " (locked " + nLocked + ") and C " + F.c + " differ by more than one " + role + " day - the leftover is not going to the lower count");
              ok(gen.a === 0 || F.c >= SHARE, tag + ": A received " + gen.a + " generated " + role + " day(s) although C ended below share at " + F.c);
            }
            summary.push(tag + ": share " + IT[role + "Share"] + " | targets " + IDS.map((id) => id + " " + targets[id]).join(", ") + " | generated " + IDS.map((id) => id + " " + gen[id]).join(", ") + " | month totals " + IDS.map((id) => id + " " + F[id]).join(", "));
          }
        });
      });
    });
  });
  summary.filter((s) => / seed 1:/.test(s)).forEach((s) => log(s));
  return summary;
}

module.exports = { run, MONTH, IDS };

if (require.main === module) {
  const R = require("../rules.js");
  const GEN = require("../generator.js");
  let N = 0;
  const ok = (cond, msg) => { N++; if (!cond) { console.error("FAIL: " + msg); process.exit(1); } };
  const t0 = Date.now();
  run({ R, GEN, ok, log: (s) => console.log("  " + s) }, { seeds: 5, bestOf: 2 });
  console.log("ok " + N + " assertions (nov-backups: every fixed slot counts in the generator's running tallies; the target is the water-filled share of ALL the month's slots, never floored at the fixed count; the convex deviation hands every leftover day to the lower count; " + (Date.now() - t0) + " ms)");
}
