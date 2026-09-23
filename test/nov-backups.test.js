// Silvis - NB (2026-09-23): do the running tallies the generator balances on count
// the slots that were FIXED before a pass (import / manual locks, imported holders,
// claims and trades, the East-derived week locks, holiday-unit locks)?
//
// Synthetic and independent of docs/silvis-seed.json: a pool of five equal members,
// one calendar month (June 2026, no holiday units), surgeon A holding N LOCKED days
// of one role, B-E holding nothing. Two placements of the locks, because the
// counters are whole-calendar-month figures and the range may start after them:
//   spread - locks on days 1, 3, 5, ... (2N-1), range = the whole month (no
//            consecutive-day or long-run rule can hide a miscount: the pool's
//            maxConsecutiveDays is 31 and no any-role soft limit is set);
//   pre    - locks on days 1..N, range = day N+1 .. 30 (the locks precede the range).
// Restated expectation (Faraz's question, item NB), per role, N below and above the
// equal share, several seeds:
//   1. diagnostics.impliedTargets reports A's lockedHeld = N;
//   2. A's target is EXACTLY max(N, share) - the locked floor lifts the target, it is
//      never placed on top of the share (target = N + share) and never dropped
//      (target = share while the counter already stands at N);
//   3. every peer's target is the equal share of the OPEN in-range slots;
//   4. the whole-month tally reported for A = N + his generated days;
//   5. A receives strictly fewer GENERATED days of the role than every peer;
//   6. A's generated days stay within the room his target leaves, max(0, ceil(share)
//      - N), plus the month's SURPLUS (open slots - placeableAtTarget): the flat share
//      hands the surplus out by soft terms and jitter with no memory of who already
//      holds the most, so A with a room of 0 still takes up to the whole surplus (the
//      unchanged engine does: 3 of a surplus of 4 in two of forty runs). A tighter
//      bound (room + 1) is NOT a property of the engine - see the report, section d.
// A generator whose counters ignored the locks (A starting at 0 against a target of
// N) or whose target sat on top of the share fails 2, 5 and 6 (mutant runs quoted in
// docs/REPORT-NOV-BACKUPS-2026-09-23.md, section d).
//
// Runs inside test/generator-regression.js (the CI chain) through run(); standalone:
//   node test/nov-backups.test.js   (exit 1 on the first failing assertion)
"use strict";
const pad2 = (n) => (n < 10 ? "0" : "") + n;
const MONTH = "2026-06", LAST = 30;
const IDS = ["a", "b", "c", "d", "e"];
const round1 = (v) => Math.round(v * 10) / 10;

function build(R, role, nLocked, variant) {
  const roster = IDS.map((id) => ({ id, name: id.toUpperCase(), code: id.toUpperCase() + id.toUpperCase() + id.toUpperCase(), active: true, roles: ["surgeon"] }));
  const surgeonRules = {};
  IDS.forEach((id) => { surgeonRules[id] = { poolMember: true, monthlyCap: null, maxConsecutiveDays: 31 }; });
  const groupRules = { weekendUnit: { days: ["Fri", "Sat", "Sun"] }, defaultMaxConsecutiveDays: 31, backupDistinctFromPrimary: true };
  const lockDays = [];
  for (let k = 0; k < nLocked; k++) lockDays.push(variant === "spread" ? 2 * k + 1 : k + 1);
  const schedule = {};
  lockDays.forEach((d) => {
    const e = { primary: null, backup: null, primaryLocked: false, backupLocked: false, source: "import", externalCover: null, note: null };
    e[role] = "a"; e[role + "Locked"] = true;
    schedule[MONTH + "-" + pad2(d)] = e;
  });
  const start = MONTH + "-" + pad2(variant === "spread" ? 1 : nLocked + 1), end = MONTH + "-" + pad2(LAST);
  const ctx = R.buildContext({ roster, surgeonRules, groupRules, holidays: { units: {} }, timeOffRows: [], availabilityRows: [], schedule, rangeStart: start, rangeEnd: end });
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
  const summary = [];
  ["backup", "primary"].forEach((role) => {
    ["spread", "pre"].forEach((variant) => {
      [4, 10].forEach((nLocked) => {
        for (let seed = 1; seed <= seeds; seed++) {
          const b = build(R, role, nLocked, variant);
          const out = GEN.generate(b.ctx, b.start, b.end, { seed, bestOf, respectLocks: true });
          const dg = out.diagnostics;
          const tag = "nov-backups " + role + " " + variant + " N=" + nLocked + " seed " + seed;
          ok(dg.uncovered.length === 0, tag + ": open slots " + JSON.stringify(dg.uncovered.map((u) => u.day + " " + u.role)));
          ok(dg.lockViolations.length === 0, tag + ": lock violations " + JSON.stringify(dg.lockViolations));
          const IT = dg.impliedTargets.months[MONTH], M = IT.members, share = IT[role + "Share"];
          const tA = M.a[role + "Target"];
          // 1. the tally sees the locks
          ok(M.a.lockedHeld[role] === nLocked, tag + ": impliedTargets lockedHeld." + role + " for A expected " + nLocked + " got " + M.a.lockedHeld[role]);
          // 2. the locked floor lifts the target - exactly max(N, share), never N + share, never share alone
          ok(tA === round1(Math.max(nLocked, share)), tag + ": A's " + role + " target " + tA + " is not max(locked " + nLocked + ", share " + share + ") = " + round1(Math.max(nLocked, share)));
          // 3. the peers' target is the equal share of the open in-range slots
          IDS.slice(1).forEach((id) => ok(M[id][role + "Target"] === share, tag + ": " + id + "'s " + role + " target " + M[id][role + "Target"] + " differs from the share " + share));
          // 4. the whole-month tally reported for A = locks + generated
          const gen = generatedCounts(out, role);
          ok(dg.tallies.a.months[MONTH][role] === nLocked + gen.a, tag + ": tallies for A " + dg.tallies.a.months[MONTH][role] + " != locked " + nLocked + " + generated " + gen.a);
          // 5. + 6. the counters the pass scores read start at N for A: he gets strictly fewer generated
          //    days than every peer, and no more than the room his target leaves plus the jitter surplus
          IDS.slice(1).forEach((id) => ok(gen.a < gen[id], tag + ": A (locked " + nLocked + ") received " + gen.a + " generated " + role + " day(s), " + id + " " + gen[id] + " - the locked days are not being counted against A's share"));
          const room = Math.max(0, Math.ceil(share) - nLocked);
          const surplus = Math.ceil(IT[role + "Open"] - IT.placeableAtTarget[role]);
          ok(gen.a <= room + surplus, tag + ": A received " + gen.a + " generated " + role + " day(s) against a room of " + room + " + a surplus of " + surplus);
          summary.push(tag + ": share " + share + " | targets A " + tA + " peers " + M.b[role + "Target"] + " | generated " + IDS.map((id) => id + " " + gen[id]).join(", ") + " | A's month total " + dg.tallies.a.months[MONTH][role] + " | room " + room + " surplus " + surplus);
        }
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
  console.log("ok " + N + " assertions (nov-backups: every fixed slot counts in the generator's running tallies; a locked floor lifts the target to max(locked, share), never on top of the share; " + (Date.now() - t0) + " ms)");
}
