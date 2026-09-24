# Water-filled share - implemented, proven, and the November what-if (item WF, 2026-09-23)

*Branch `fix/water-filled-share` on 8b38740, worktree `<a worktree of your clone>`. Faraz's decision of 9/23 morning, after `docs/REPORT-NOV-BACKUPS-2026-09-23.md`: adopt the water-filled share - a surgeon's locked and derived-week days count AGAINST his equal share (never a locked floor) and the deviation term grows above target (convex), for both roles, so the leftover slots of a month go to whoever is furthest below share. Every live table was read with the public anon key; **nothing was written anywhere** - no `--apply`, no supabase command, no publish, no key printed; `docs/PREVIEW-2026-11-02-to-2027-01-03.*` are untouched; the published schedule is NOT regenerated. Committed by the fix stage of the 9/23 review in one commit on `fix/water-filled-share` (not pushed; section f).*

## The answer in one paragraph

**With the water-filled share November backups would have been Khan 5, Burchett 4, Acton 4, Philip 5, Fierce 11, Sarkar 1** (published: 3 / 4 / 3 / 4 / 16 / 0), on the exact inputs and the exact two runs the 9/23 publish made (backfill 10/07..11/01 fill-open-only + milestone 11/02..01/03, seed 7, bestOf 200; the pre-publish inputs are proven - the old generator reproduces the publish over them byte for byte). **34 of the 224 slots differ** from the published rows (7 in October, 5 in November, 22 in December, 0 in January); 10/15 primary stays the only open slot; no hard violation; the lock-violation facts are the same nine. Fierce's three generated November backups are 11/21, 11/22 (Khan is the primary, Acton on vacation, Burchett off his list, Philip at his weekend backup cap, Sarkar outside her window) and 11/25 (Khan's locked primary; Philip hard-eligible but at 7 soft points). The price is soft quality: the milestone's soft sum rises from 70 to 96 (mostly back-to-back weekends, block-pattern mismatches and daily patterns) because once a member is two or more days from share the convex term outweighs a medium soft penalty - that is what "furthest below share wins" means at the generator's scale; `groupRules.weights.deviationConvexity` (seed 2) is the lever (1.5 gives Fierce 13 at soft 84; the flat term with the water-filled targets alone gives Fierce 13 at soft 74). **The published schedule is NOT regenerated**; the model applies to every Generate from now on.

## a. The model (generator.js)

- **Targets (`genTargets`, `genWaterFill`).** Per role and calendar month the pool's slots = the open in-range slots (primary: after Sarkar's reserved window primaries) **plus every day of the calendar month a pool member already holds on the lock-only base** (import, manual, derived, claimed, published outside the range). A slot held by a non-pool holder (Sarkar, an outside surgeon, externalCover) is not a pool slot. The slots are poured over the members up to each member's **clip** - the K clip for primary (`min(capPreferred, capPrimary - 1)` minus East primary-week days not held as Silvis primary), `backupCap.perMonthDays` for backup: while the lowest clip is below an equal share of what is left, that member takes his clip and leaves the fill; the level L is the equal share of the rest. A member's target = `min(L, clip)`, rounded to 0.1 when written out, **never floored at `lockedHeld`**. A numeric `monthlyTarget` still overrides: the member leaves the fill for that role and his number comes off the slots first. `primaryShare` / `backupShare` in the diagnostics are now the level L.
- **Deviation (`genDevCost`).** `|count - target| ^ convexity`, convexity = `groupRules.weights.deviationConvexity` when it is a finite number >= 1, else the code default `GEN_DEVIATION_CONVEXITY = 2`. With 2 the marginal cost of one more day is `2d + 1`: from 3 below share to 2 below it is -5, from 1 below to at share -1, at share to 1 above +1, from 2 above to 3 above +5 - the same scale as the old flat term next to the target, growing with the distance either side. `1` restores the flat term exactly.
- **Where it is read.** `genTargetDelta` (the day fill, `genBestFor` in repair, and `genTargetDeltaForDays`, which weekend and holiday unit patterns sum per member over the days he would take, so a block of three is scored as one convex step of three), `genSmooth` (the donor is the surgeon furthest above his target, the receiver the one furthest below; the old "above target -> below target" gate is gone because a move between two members both above share lowers the convex sum whenever their distances differ by more than one day; every move still goes through `eligibility()`, the soft tolerance and the strict-fall test) and `genEvaluate` (`primaryDeviation` / `backupDeviation` are the convex sums; `GEN_SCORE_WEIGHTS` unchanged at 300 / 100).
- **Untouched:** `rules.js`, `helpers.js`, eligibility, unit continuity, caps, hard rules, soft weights, the API (`generate(ctx, start, end, opts) -> { schedule, diagnostics }`), `genInitCounts` (the counters already counted every fixed slot - the November report's finding).
- **Diagnostics.** `impliedTargets.rule` says "water-filled share per role", `impliedTargets.convexity`, per month `poolSlots: { primary, backup }`, `heldByPool`, `primaryShare` / `backupShare` (= the level), `placeableAtTarget` (= sum of max(0, target - lockedHeld); at least the open slots now) and `heldAboveShare` (= sum of max(0, lockedHeld - target), the fixed days already over share, which the generator balances only by placing nothing more on their holders); `members[id].lockedHeld` stays for display. The header comment and the 'design decision a' paragraph are replaced.
- **Data knob:** `docs/silvis-seed.json` `groupRules.weights.deviationConvexity: 2` (explicit) + one `_meta.revisions` entry. Importer dry run (read-only, 13:5xZ): `groupRules=update` (this key) + the settings stamps; `schedule_days` insert 0 / update 0 / delete 0 (the 33 BLOCKED rows are the publish's and today's hand edits, protected as designed). The dry run also shows `surgeonRules=update` and `availability delete 4` - that is another lane's live change of 13:55Z (Burchett's October backup-only dates, `s2.explicitBackupOnly` 2026-10 and four `backup_only` rows) that this branch's seed does not carry yet, not this item.

## b. Tests, test-first

**`test/nov-backups.test.js` (rewritten) + the NB block of `test/generator-regression.js`.** A pool of three (A, B, C) in June 2026, the other role locked every day to a non-pool holder Z so the role under test is a single clean allocation (the first draft used a vacation for B and two open roles; with only two people available on a day the backup is the complement of the primary, so the primary pass fixed the backup split - not a fairness property), every soft weight a bare pool could incur set to 0. A holds N locked days of the role (spread on odd days / preceding the range), N = 6 and 12, peers free or B limited to days 1-7 by a role-scoped unavailable row, seeds 1-5, both roles: 80 runs, 940 assertions. Properties: lockedHeld = N; every target = the share of ALL 30 slots (10) regardless of N and the month's share = 10; the tally = N + generated; N above share with free peers: A receives no generated day while B and C end at 9 / 9 (within one of each other); N below share: the three finish within one day; B limited: A and C finish within one day, and A receives nothing while C is below share. The report line names the targets.

Verbatim fail on the OLD generator (generator.js at 8b38740, run before any engine change; the standalone file stops at the first failure, the scratch runner lists them all):

```
$ node test/nov-backups.test.js
FAIL: nov-backups backup spread free N=6 seed 1: the month's backup share 8 is not the water level 10 (30 slots / 3)
exit 1

$ GEN=<scratch>/gen-old.js node <scratch>/run-nb.js
-> exit 1 | 940 assertions, 80 runs, 224 ms
FAILED 473 of 940 assertions; first 8:
  FAIL: nov-backups backup spread free N=6 seed 1: the month's backup share 8 is not the water level 10 (30 slots / 3)
  FAIL: nov-backups backup spread free N=6 seed 1: A's backup target 8 is not the share 10 regardless of N (locked 6)
  FAIL: nov-backups backup spread free N=6 seed 1: B's backup target 8 is not the share 10 regardless of N (locked 0)
  FAIL: nov-backups backup spread free N=6 seed 1: C's backup target 8 is not the share 10 regardless of N (locked 0)
  FAIL: nov-backups backup spread free N=6 seed 1: impliedTargets.rule does not name the water-filled share
  FAIL: nov-backups backup spread free N=6 seed 1: finals {"a":11,"b":11,"c":8} spread by more than one backup day (A's locked 6 count toward his share)
  FAIL: nov-backups backup spread free N=6 seed 2: the month's backup share 8 is not the water level 10 (30 slots / 3)
  FAIL: nov-backups backup spread free N=6 seed 2: A's backup target 8 is not the share 10 regardless of N (locked 6)
```

Pass on the NEW generator:

```
$ node test/nov-backups.test.js
  nov-backups backup spread free N=6 seed 1: share 10 | targets a 10, b 10, c 10 | generated a 4, b 10, c 10 | month totals a 10, b 10, c 10
  nov-backups backup spread free N=12 seed 1: share 10 | targets a 10, b 10, c 10 | generated a 0, b 9, c 9 | month totals a 12, b 9, c 9
  nov-backups backup spread b-limited N=6 seed 1: share 10 | targets a 10, b 10, c 10 | generated a 8, b 3, c 13 | month totals a 14, b 3, c 13
  nov-backups backup spread b-limited N=12 seed 1: share 10 | targets a 10, b 10, c 10 | generated a 1, b 3, c 14 | month totals a 13, b 3, c 14
  nov-backups backup pre free N=6 seed 1: share 10 | targets a 10, b 10, c 10 | generated a 4, b 10, c 10 | month totals a 10, b 10, c 10
  nov-backups backup pre free N=12 seed 1: share 10 | targets a 10, b 10, c 10 | generated a 0, b 9, c 9 | month totals a 12, b 9, c 9
  nov-backups backup pre b-limited N=6 seed 1: share 10 | targets a 10, b 10, c 10 | generated a 9, b 1, c 14 | month totals a 15, b 1, c 14
  nov-backups backup pre b-limited N=12 seed 1: share 10 | targets a 10, b 10, c 10 | generated a 3, b 0, c 15 | month totals a 15, b 0, c 15
  (the eight primary-role lines read the same)
ok 940 assertions (nov-backups: every fixed slot counts in the generator's running tallies; the target is the water-filled share of ALL the month's slots, never floored at the fixed count; the convex deviation hands every leftover day to the lower count; 245 ms)
```

**Mutation check** (scratch copies of the NEW generator.js, the repo file untouched; `diff` against generator.js shows exactly the one mutated line each):

```
MUT floor-at-lockedHeld (genTargets: tP/tB = max(held, fill.share[id]))       -> exit 1 | 940 assertions, 80 runs
FAILED 55 of 940 assertions; first 8:
  FAIL: nov-backups backup spread free N=12 seed 1: A's backup target 12 is not the share 10 regardless of N (locked 12)
  FAIL: nov-backups backup spread free N=12 seed 2: A's backup target 12 is not the share 10 regardless of N (locked 12)
  ... (every N=12 run, both roles, both placements, both profiles: 40 target lines + 15 behavioural lines)
MUT flat-deviation (genDevCost returns |d|)                                    -> exit 1 | 940 assertions, 80 runs
FAILED 41 of 940 assertions; first 8:
  FAIL: nov-backups backup spread free N=12 seed 1: B 10 and C 8 differ by more than one backup day
  FAIL: nov-backups backup spread free N=12 seed 2: B 8 and C 10 differ by more than one backup day
  FAIL: nov-backups backup spread free N=12 seed 3: B 10 and C 8 differ by more than one backup day
  FAIL: nov-backups backup spread free N=12 seed 4: B 10 and C 8 differ by more than one backup day
  FAIL: nov-backups backup spread free N=12 seed 5: B 8 and C 10 differ by more than one backup day
  FAIL: nov-backups backup spread b-limited N=6 seed 1: with B limited, A 15 (locked 6) and C 12 differ by more than one backup day - the leftover is not going to the lower count
  FAIL: nov-backups backup spread b-limited N=6 seed 4: with B limited, A 15 (locked 6) and C 12 differ by more than one backup day - the leftover is not going to the lower count
  FAIL: nov-backups backup spread b-limited N=6 seed 5: with B limited, A 15 (locked 6) and C 12 differ by more than one backup day - the leftover is not going to the lower count
```

The flat mutant's failures are the coin flips the flat term takes once two candidates are both at or above (or both below) target: with the convex term the lower count wins deterministically, so the finals stay within one day.

**The November 2026 case (`test/fixtures/water-fill-2026-10-07-to-2027-01-03.json` + `test/water-fill.test.js` - its own chain step since the fix stage, section f).** The fixture holds the generator inputs exactly as they stood before the 06:32Z publish, rebuilt from the 12:38:55Z anon snapshot (`schedule_days` 112, `time_off` 7, `availability` 48 all source seed, `east_feed` 7 weeks = coverage 9/28..11/15, `east_forecast` 14 weeks, `east_overrides` 0; the snapshot predates Faraz's 13:38Z hand edits) with the publish log's 110 `OPEN -> holder` changes set back to open (71 rows remain, all import) and the 12:37Z December blob change set back to the plain `2026-12` entry the 05:28Z generate saw; the East inputs as `scripts/preview-generate.js` derives them (Khan busy days from the published coverage: none; forecast outside the coverage: 98 days; Fierce derived weeks 11/09 backup, 12/07 primary); ids and dates only, no notes, no contact data (`_meta.published` carries the 112 published holders for the slot-difference count). **Proof of the inputs**: the generator at 8b38740 over the fixture reproduces the published preview byte for byte - milestone 0 holder mismatches over 11/02..01/03, score `{ softSum 70, primaryDeviation 19.8, backupDeviation 13.2, total 77321 }`, best candidate 20 of 200; backfill 0 mismatches over 10/07..11/01, score total 1000042360, 10/15 primary open. The suite runs both generates with the new generator (seed 7, bestOf 200; 1.4-2.2 s on this machine) and pins: no open slot but 10/15 primary; no hard violation; the November and December per-surgeon tallies of the merged result (section c); November levels 5.6 P / 5.8 B with Fierce's backup target 5.8 under his 8 locked backups; Fierce's generated November backups = exactly 11/21, 11/22, 11/25, each a day where no other pool member is eligible with zero soft penalty and below share; 34 of the 224 published slots differ; milestone score 115551 at candidate 20.

**Regression harness expectations that encoded the flat share (each updated, `test/generator-regression.js`):** (1) `primaryShare / backupShare = (open - reserved) / pool, open / pool` -> the restated water levels over `poolSlots` (own fill loop in the test, clips per member as before); new pins for `poolSlots`, `heldByPool`, `heldAboveShare`, `impliedTargets.convexity`; (2) "a target below the locked days" (target >= lockedHeld) -> removed; targets `= min(level, clip)` per role exactly, and "a target above the share" is now the failure; (3) `placeableAtTarget <= open` -> `>= open` (the room below the targets is at least the open slots); (4) Fierce November `backupTarget >= 7` -> `= the level (5.8)` with his 8 locked backups above it; `primaryTarget = min(primaryShare, 6)` reads the level; (5) `score.primaryDeviation / backupDeviation` restated as convex sums (exponent = the seed knob, pinned to `GEN.GEN_DEVIATION_CONVEXITY` = 2); (6) the milestone "within 3 of the primary target" tolerance now reads above `max(target, locked)` (Acton's 8 locked November primaries cannot come down to a 5.6 target) and separately no more than 3 below the target; (7) the derived-week-overridden fixture's `primaryTarget <= max(locked, 6)` -> `<= 6` (the clip alone); (8) the NB block: 40 -> 80 runs, new wording; (9) the WF block and the summary line. No fixture JSON changed; the five existing fixtures still pass unchanged.

Gates at the fix stage (other agents were running on the machine; the chain ran with `SILVIS_GEN_BUDGET_MS=40000` as instructed, and the two budgeted suites were ALSO run alone at their default budgets): `SILVIS_GEN_BUDGET_MS=40000 npm test` -> exit 0 - rules `ok 1576 assertions (222 ms; budget 5000 ms)`, east-feed `ok 83 assertions`, data-layer, schema, importer, week-rows, exports, totals, holidays `ok 389 assertions (94 ms; limit 40000 ms via SILVIS_GEN_BUDGET_MS)`, publish, open-shifts, ci `ok 90 assertions (14 suites in the chain, 35 paths in the filter, 14 test steps)`, water-fill `ok 23 assertions (water-fill: the November 2026 case on the pre-publish inputs, seed 7 / bestOf 200 / convexity 2; 1489 ms; budget 40000 ms via SILVIS_GEN_BUDGET_MS)`, regression `ok 276549 assertions, 50 seeds x 4 ranges at bestOf 6/5/2/2 (R4 on the even seeds: 25 runs) + 50 fill-open-only backfill runs at bestOf 2 + 1 x bestOf 200 + 11 fixture runs + 80 NB synthetic tally runs + 3 knob-guard runs (6627 ms total; budget 40000 ms via SILVIS_GEN_BUDGET_MS)`. Alone at the defaults: `node test/generator-regression.js` -> `ok 276549 assertions ... (7523 ms total; budget 10000 ms)`, exit 0; `node test/water-fill.test.js` -> `ok 23 assertions (... 1477 ms; budget 6000 ms)`, exit 0. `node build.js` -> `OK build complete, APP_VERSION 2026.09.23f, createElement calls 1660, injected imports 0`, then `git checkout -- index.html version.json` (both restored; CI owns them). Before the split the regression with the WF block inside read 9892 ms of its 10000 on this machine (the fix stage's first run) and the review measured 10042-11073 ms with exit 1 - the plain `npm test` gate of CLAUDE.md was red under load; that is why the November case is its own step (section f). CI's own timing line is to be read on the first run of this branch.

## c. The what-if - report only, nothing written, nothing published

Inputs: the fixture of section b (= the pre-publish state). Runs: exactly the publish tool's - `generate(ctx, 2026-11-02, 2027-01-03, { seed 7, bestOf 200, respectLocks })` then `generate(ctx, 2026-10-07, 2026-11-01, { seed 7, bestOf 200, respectLocks, fillOpenOnly })` - with the new generator (convexity 2), merged over the pre-publish rows. "Published" = the live rows of 12:38Z (before the hand edits).

**Per surgeon and month, primary / backup, published -> water-filled:**

| Period | Khan | Burchett | Acton | Philip | Fierce | Sarkar |
|---|---|---|---|---|---|---|
| Oct 7-31 | P 1 -> 1, B 5 -> 5 | P 4 -> 4, B 3 -> **5** | P 9 -> 9, B 3 -> **5** | P 7 -> 7, B 7 -> 7 | P 1 -> 1, B 7 -> **3** | P 2 -> 2, B 0 -> 0 |
| Nov | P 7 -> 7, B 3 -> **5** | P 6 -> 6, B 4 -> 4 | P 10 -> **9**, B 3 -> **4** | P 5 -> **6**, B 4 -> **5** | P 0 -> 0, B 16 -> **11** | P 2 -> 2, B 0 -> **1** |
| Dec | P 3 -> **6**, B 6 -> 6 | P 6 -> **5**, B 6 -> **7** | P 6 -> 6, B 6 -> 6 | P 5 -> 5, B 7 -> **6** | P 9 -> **7**, B 6 -> 6 | P 2 -> 2, B 0 -> 0 |
| Jan 1-3 | P 2 -> 2, B 1 -> 1 | P 1 -> 1, B 0 -> 0 | P 0 -> 0, B 0 -> 0 | P 0 -> 0, B 2 -> 2 | P 0 -> 0, B 0 -> 0 | P 0 -> 0, B 0 -> 0 |

**Slots that differ (34 of 224 = 112 rows x 2; 178 of the 224 are in the two generated ranges, the rest locked import):**

- October (7, all backups): 10/7 Wed Fierce -> Burchett; 10/15 Thu Khan -> Acton; 10/21 Wed Fierce -> Burchett; 10/29 Thu Khan -> Acton; 10/30 Fri Fierce -> Khan; 10/31 Sat Fierce -> Khan; 11/1 Sun Fierce -> Khan (the backfill's last day).
- November (5): 11/12 Thu P Acton -> Philip; 11/19 Thu B Fierce -> Philip; 11/20 Fri B Fierce -> Sarkar (her window Friday; backup is allowed inside her window and she carries no backup target, so with everyone else at or above share she takes it); 11/24 Tue B Fierce -> Acton; 11/30 Mon B Fierce -> Khan. 11/21-22 (Khan's weekend) and 11/25 stay Fierce - section b names why nobody below share could hold them.
- December (22): 12/1 B Khan -> Fierce; 12/2 P Fierce -> Khan, B Khan -> Philip; 12/3 B Khan -> Philip; 12/7 B Philip -> Khan; 12/8 B Philip -> Burchett; 12/9 B Philip -> Acton; 12/10 B Burchett -> Acton; 12/14 B Acton -> Khan; 12/15 B Acton -> Khan; 12/16 P Fierce -> Khan, B Acton -> Philip; 12/17 B Philip -> Fierce; 12/19 B Burchett -> Acton; 12/21 P Acton -> Philip, B Fierce -> Khan; 12/22 B Fierce -> Acton; 12/28 P Burchett -> Khan, B Khan -> Burchett; 12/29 B Khan -> Burchett; 12/30 P Philip -> Acton, B Acton -> Khan.
- January: none.

**Open slots:** milestone none; backfill `2026-10-15 primary` (as published). **Hard violations:** 0 / 0. **Lock violations (facts, unchanged):** 11/18 primary Acton day-before-vacation; 10/12 primary Fierce weekday-pattern:Mon; Philip's backup-cap:7 on 10/14, 10/17, 10/18, 10/19, 10/22, 10/26, 10/28.

**Best-of-N score.** Milestone: `{ softSum 96, primaryDeviation 51.2, backupDeviation 41.4, weekendSpread 5, holidaySpread 1, total 115551 }`, best candidate 20 of 200 (published: `{ 70, 19.8, 13.2, 6, 1, total 77321 }`, candidate 20 - the deviation parts are convex sums now and not comparable with the flat ones; the soft sum is). Soft by reason, published -> water-filled: pattern-mismatch:block 36 -> 42, back-to-back-weekend 27 -> 30, pattern-daily 15 -> 20, backup-after-primary 2 -> 5, east-forecast 8 -> 12, auto-offer-weekday 0 -> 3, preferred -3 -> -1, weekend-backup 6 -> 6, weekend-primary -9 -> -9, window-week-below-target -12 -> -12. Backfill: `{ softSum 47 (published 41), primaryDeviation 107, backupDeviation 46.8, uncoveredPrimary 1, total 1000083830 }`, candidate 3.

**The targets the new diagnostics report** (`impliedTargets`, level = share of an unclipped member; no clip binds in any month):

| Run / month | open P - reserved / open B | poolSlots P / B | heldByPool P / B | level P / B | placeableAtTarget P / B | heldAboveShare P / B |
|---|---|---|---|---|---|---|
| backfill 2026-10 | 2 - 0 / 15 | 25 / 31 | 23 / 16 | 5 / 6.2 | 9 / 16.8 | 7 / 1.8 |
| backfill 2026-11 (11/1 only) | 0 / 1 | 20 / 15 | 20 / 14 | 4 / 3 | 7 / 7 | 7 / 6 |
| milestone 2026-11 | 10 - 2 / 15 | 28 / 29 | 20 / 14 | 5.6 / 5.8 | 12.8 / 17.2 | 2.8 / 2.2 |
| milestone 2026-12 | 24 - 2 / 31 | 29 / 31 | 7 / 0 | 5.8 / 6.2 | 25.2 / 31 | 1.2 / 0 |
| milestone 2027-01 | 3 / 3 | 3 / 3 | 0 / 0 | 0.6 / 0.6 | 3 / 3 | 0 / 0 |

Per member the targets equal the level in every month (Sarkar: her window target 2 P, no backup target). November, locked vs target: Khan P 5 / 5.6, B 0 / 5.8; Burchett P 6 / 5.6, B 4 / 5.8; Acton P 8 / 5.6, B 2 / 5.8; Philip P 1 / 5.6, B 0 / 5.8; **Fierce P 0 / 5.6 (clip 6), B 8 / 5.8**. The flat share had given Fierce 8, Khan 3, Burchett 4, Acton 3, Philip 3 as backup targets.

**Sensitivity - the knob** (same inputs and runs; report only):

| `deviationConvexity` | Nov backups K / B / A / P / F / S | Dec P Khan | soft sum (milestone) | slots differing | best candidate |
|---|---|---|---|---|---|
| 2 (adopted, seed) | 5 / 4 / 4 / 5 / **11** / 1 | 6 | 96 | 34 | 20 |
| 1.5 | 4 / 4 / 4 / 5 / 13 / 0 | 6 | 84 | 31 | 186 |
| 1 (flat term, water-filled targets only) | 4 / 4 / 4 / 5 / 13 / 0 | 4 | 74 | 27 | 84 |
| published (flat share, flat term) | 3 / 4 / 3 / 4 / 16 / 0 | 3 | 70 | - | 20 |

Most of Fierce's November drop comes from the targets (16 -> 13 with the flat term); the convex term takes it to 11 and buys Khan's two extra December weekend primaries and a fairer December backup spread at the soft cost above.

**Faraz's nine hand edits of today (13:38Z; `Faraz (day-edit CLI, 2026-09-23)`, all locked, source manual) against the published tallies - a table, no judgement:** 10/9, 10/15, 10/20, 10/22 B -> Burchett; 11/19 B -> Philip; 11/24 B -> Khan; 12/4 B -> Fierce; 12/10 B -> Khan; 12/18 B -> Acton.

| Backups | Khan | Burchett | Acton | Philip | Fierce | Sarkar |
|---|---|---|---|---|---|---|
| Oct 7-31 published -> after edits | 5 -> 3 | 3 -> 7 | 3 -> 2 | 7 -> 6 | 7 -> 7 | 0 -> 0 |
| Nov published -> after edits | 3 -> 4 | 4 -> 4 | 3 -> 3 | 4 -> 5 | 16 -> 14 | 0 -> 0 |
| Dec published -> after edits | 6 -> 7 | 6 -> 3 | 6 -> 7 | 7 -> 7 | 6 -> 7 | 0 -> 0 |

(Primaries unchanged in every month. The water-filled what-if above was run on the pre-publish state, so it neither includes nor conflicts with these edits; a future Generate over the same range will see them as locks.)

## d. Docs

- `docs/SILVIS-CALL-RULES.md` section 6: the fairness paragraph (water-filled share, convex deviation, both roles, decided 9/23), the diagnostics key names, the `deviationConvexity` knob, the score / smoothing bullet; section 8: the 9/23 answered paragraph records the decision (the J-review item was never a numbered open item; the open wording lived in section 6 and is replaced).
- `docs/SILVIS-BUILD-GUIDE.md` section 15: the model, the knob, the diagnostics, the effect, the tests; section 6's generator-targets paragraph gets a one-sentence pointer that it is superseded (its "known property of the flat share" text would otherwise contradict section 15, whose header says it overrides anything above it).
- `docs/REPORT-NOV-BACKUPS-2026-09-23.md`: the appended line "Decision 9/23: adopted - see REPORT-WATER-FILL".
- This file.
- Fix stage (9/23 review of this item): rules doc section 6 (the null level, the knob's warning) and section 8 item 18 (Sarkar as backup inside her windows under the convex term - open, a data question); guide section 6 (the flat formula replaced by the water-filled summary, the pointer to section 15 kept) and section 15 (the review fixes, the test file move, the UI wording still open); the seed's `s1.monthlyTargetNote` reworded to the water-filled share (an importer-dropped note; no rule, no date).

## e. Files, commands, and what was not done

Repo (worktree `<a worktree of your clone>`, branch `fix/water-filled-share` on 8b38740; committed by the fix stage in one commit): `generator.js`, `test/nov-backups.test.js` (rewritten), `test/generator-regression.js`, new `test/water-fill.test.js` (fix stage), new `test/fixtures/water-fill-2026-10-07-to-2027-01-03.json`, `package.json` / `.github/workflows/build.yml` / `test/ci.test.js` (the new suite joins the chain, the workflow steps and the paths filter; its 6000 ms gate is pinned like the other three), `docs/silvis-seed.json` (the knob + one revision entry; the `s1.monthlyTargetNote` reworded at the fix stage), `docs/SILVIS-CALL-RULES.md`, `docs/SILVIS-BUILD-GUIDE.md`, `docs/REPORT-NOV-BACKUPS-2026-09-23.md` (one appended line), new `docs/REPORT-WATER-FILL-2026-09-23.md`. `index.html` / `version.json` restored after the build. Not touched: `rules.js`, `helpers.js`, `index-source.html`, `scripts/`, `README.md` (its "twelve-suite chain" sentence was already one short and is now two short; `test/ci.test.js` pins only its two command lines).

Scratch (`...\scratchpad\wf\`): `gen-old.js` (generator.js at 8b38740 with an absolute require), `fetch-live.js` -> `live.json` (13:39:40Z anon read; the 12:38:55Z snapshot is `..\nb\live.json`), `wf-ctx.js` (input rebuild + old-generator replay proof -> `prepublish-input.json`), `run-nb.js` (the test's `run()` against any generator module, every failure listed), `mut-floor.js`, `mut-flat.js`, `wf-whatif.js` -> `whatif.json`, `whatif-merged.json`, `whatif-output.txt`, `whatif-c1.5.json`, `whatif-c1.json`, `regression-1..3.txt`, `npm-test.txt`, `build.txt`, `import-dry-run.txt` / `.sql` (dry run only; the SQL was written to scratch and not run).

Commands run from the worktree: `node <scratch>/fetch-live.js`; `node <scratch>/wf-ctx.js` (old generator replay: 0 / 0 mismatches); `node test/nov-backups.test.js` (fail on old, pass on new); `GEN=<scratch>/gen-old.js node <scratch>/run-nb.js`; `GEN=<scratch>/mut-floor.js ...`; `GEN=<scratch>/mut-flat.js ...`; `node <scratch>/wf-whatif.js` (+ `CONVEXITY=1.5`, `CONVEXITY=1`); `SILVIS_GEN_BUDGET_MS=40000 node test/generator-regression.js` x 3; `node scripts/import-seed.js --dry-run --out <scratch>/import-dry-run.sql`; `SILVIS_GEN_BUDGET_MS=40000 npm test`; `node build.js`; `git checkout -- index.html version.json`.

Not done, on purpose: no write to any table, no regenerate-for-publish, no supabase CLI, no key printed, no commit, no push, `docs/PREVIEW-*` untouched. Follow-ups outside this item's file list (also in guide section 15): (1) `index-source.html`'s Generate panel still says "Every pool member is targeted at an equal share of the month's open primary slots ..." and its per-month head line reads "primary X open - Y reserved = share Z each of N" - with the new diagnostics that equation no longer holds (November: 10 open - 2 reserved, level 5.6), the Totals view titles say "implied equal share of the open ... slots"; wording only, the numbers shown are the new diagnostics; its own lane with `npm run smoke` (the smoke harness reads `data-testid="gen-shares-head-{m}"` - keep the id); (2) `scripts/preview-generate.js` prints the same "Implied shares (equal-share fairness ...)" heading; (3) `rules.js defaultWeights()` does not carry `deviationConvexity`, so Setup's weights field shows no placeholder until the blob has the key (rules.js is outside this item); (4) the live blob carries another lane's 13:55Z change (Burchett's October backup-only dates) that this branch's seed does not - the seed lane's business, noted because the importer dry run shows it; (5) read the regression's and the water-fill suite's timing lines on the first CI run of this branch (the header rule stands: R4 to bestOf 1 before anything else, never a raised budget); (6) `README.md`'s chain sentence. No request from another lane was relayed into this run.

## f. Fix stage - the 9/23 review of this item

Two reviewers (one approve, one changes-needed; ten findings, every number in sections b and c re-derived independently by both and found equal). What was done, per finding:

| Finding | Severity | Done |
|---|---|---|
| `test/generator-regression.js` over its 10 s default budget on the developer machine with the WF block inside (review: 10042-11073 ms, exit 1; fix stage's first run 9892 ms) | major | The November case moved to its own chain step `test/water-fill.test.js` (same assertions plus the November `poolSlots` / `heldByPool` pin and a no-warning pin; default budget 6000 ms via `SILVIS_GEN_BUDGET_MS`, a failing assertion); `package.json`, `.github/workflows/build.yml` (step before the regression + paths filter) and `test/ci.test.js` (the gate pinned like the other three) updated; the regression alone now reads 7523 ms at the default budget on the same loaded machine, the new suite 1477 ms. |
| `index-source.html` / `scripts/preview-generate.js` still print the flat-share equation and wording | major | Not in this item's file list (another lane owns the UI today) - NOT changed; named in section e (1)-(2) and guide section 15 for its own lane with `npm run smoke`. The numbers those lines show are the new diagnostics; only the words and the `X open - Y reserved = share Z` equation are stale. |
| `genWaterFill` reported `level = 0` when every member is clipped (display only; unreachable on today's seed) | minor | `level` is `null` when nobody is left in the fill; `primaryShare` / `backupShare` are `null` in that case (the shares sit at the clips); the harness's restated fill mirrors it and a unit block asserts the all-clipped, one-clipped, non-binding, zero-slot and empty-pool cases against `GEN.genWaterFill`; header comment, rule string and rules doc section 6 say so. |
| `surgeonRules.s1.monthlyTargetNote` in the seed still described the flat share | minor | Reworded to the water-filled share (importer-dropped note; no rule or date changed; the seed's core hash ignores notes). |
| An invalid `weights.deviationConvexity` fell back to 2 silently | minor | `generate()` pushes `weights.deviationConvexity <value> ignored: needs a finite number >= 1; using 2` into `diagnostics.warnings` when the key is present but rejected; the harness asserts 0.5 and the string "2" are rejected with one warning, 1.5 is honoured silently and the seed's own runs carry no warning. `rules.js defaultWeights()` (the Setup placeholder) is outside this item - section e (3). |
| Guide section 6 still stated the flat formula with only a pointer appended | minor | The paragraph now states the water-filled share in two sentences and keeps the pointer to section 15. |
| 11/20 backup to Sarkar: a no-target candidate carries a zero deviation delta, which the convex term amplifies | minor | Recorded as rules doc section 8 item 18 (a data question for the group: her `backupOptOut` or a `groupRules` weight, never a name branch); nothing changed in the model. |

**Mutants re-run on the committed generator** (fresh scratch copies of the final `generator.js`; `diff` shows exactly the mutated lines; the tests' `run()` with non-exiting assertions):

```
old generator (8b38740) | nov-backups: FAILED 473 of 940 (first: 'the month's backup share 8 is not the water level 10 (30 slots / 3)')
                        | water-fill: FAILED 8 of 27 - Nov backups FAK 3, MAB 4, BDA 3, AFP 4, NF 16, SRK 0; 0 of 224 slots differ from the publish (the inputs proof, re-observed); score [77321, 20]
MUT floor-at-lockedHeld | nov-backups: FAILED 55 of 940 (first: 'A's backup target 12 is not the share 10 regardless of N (locked 12)')
                        | water-fill: FAILED 6 of 24 - NF 13 backups, Fierce's target 8 not 5.8, 32 slots differ, score [95250, 49]
MUT flat-deviation      | nov-backups: FAILED 41 of 940 (first: 'B 10 and C 8 differ by more than one backup day')
                        | water-fill: FAILED 5 of 24 - NF 13 backups, 27 slots differ, score [81821, 84]
new generator           | nov-backups: exit 0, 940 assertions, 80 runs | water-fill: ok 23 assertions
```

**What-if re-run** on the committed generator (seed 7, bestOf 200, the same two runs): every number of section c unchanged - November backups Khan 5 / Burchett 4 / Acton 4 / Philip 5 / Fierce 11 / Sarkar 1, 34 differing slots (the same list), 10/15 primary the only open slot, milestone score `{ 96, 51.2, 41.4, 5, 1, 115551 }` at candidate 20, backfill `{ 47, 107, 46.8, uncoveredPrimary 1, 1000083830 }` at candidate 3, the levels table and the hand-edit table as printed. The fix-stage changes touch only the all-clipped display case (no such month in the range), the warning path (no invalid knob in the inputs) and where the test lives.

**Corrected in this report:** the earlier gates paragraph said the default 10 s regression gate "keeps room" - it did not on this machine (9892 ms of 10000 here, 10042-11073 ms and exit 1 in the review); the sentence is replaced and the cause removed. No number in sections b, c or d needed correction.

## g. Rebase onto East vacations + Burchett October (9/23, later)

Rebased by content onto `origin/main` 3435f47 (Prompt 15 East vacations, the Burchett October edits, the CI pins). One
semantic interaction surfaced, in the regression only: the Prompt 15 **home** fixture (Khan home Tue 12/15 - Thu 12/17,
the other four primary candidates unavailable on 12/15) hands him weekday primaries with the east-clear bonus; under the
water-filled share they count against his December primary share (6 placed vs 5.8), and once the share is met the convex
deviation ranks him behind the under-target surgeons on 12/4 - and a 12/18 block would break max-consecutive after
12/15-12/17. On every seed tried (1-20 at bestOf 5; bestOf 10 and 25 at seed 1), not a seed accident. The flat share
(main alone) still handed him a block there. Resolution, test only: `checkRun` gains `extraHome`; for a run WITH fixture
home days the quality-1 pin accepts one reason for no full weekend block - his primary share is met in every month that
offers him an open weekend, and he does hold a home-day primary. Every other run (all 50 R2 seeds, the away fixture, the
bestOf-200 pin) keeps the strict pin. Nothing in `generator.js` or `rules.js` changed for it. Open question for the group:
whether a home week that fills his share should still come with a weekend block (a `weights.weekendContribution` matter,
data, not a name branch).
