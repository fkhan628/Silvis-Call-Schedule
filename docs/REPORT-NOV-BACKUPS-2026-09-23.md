# November backups - why Fierce holds 16 and Khan 3 (item NB, 2026-09-23)

*Report-only analysis on branch `fix/nov-backup-tally` at the deployed head 875bbcd. Every live table was read with the public anon key; **the published schedule was not touched** - nothing was written to Supabase, nothing was regenerated for publication, no `--apply`, no supabase command. Scratch scripts and dumps live outside the repo (paths in section g). Two test files changed: `test/nov-backups.test.js` (new; a synthetic module that also runs standalone) and `test/generator-regression.js` (runs it inside the CI chain); no engine code changed, because the test passes on the unchanged generator and fails on three in-memory mutants of it (section d). Reviewed 9/23 by two independent derivations; their corrections (the Variant A tie, 11/16, the December entry's effect on a replay, line 788) are folded in.*

## The answer in one paragraph

**Khan was not chosen** for the seven November backup slots for four different reasons, none of them East, Tue/Thu, a cap or a consecutive-day rule: on **11/25 he is the locked primary** (`holds-other-role`); on **11/21 and 11/22 he is the generated Sat/Sun primary** (the primary pass gave that weekend to Burchett-locked-Fri / Khan / Khan), so only Friday 11/20 was open to him as backup and the one weekend pattern that contains him (`daily Khan/Fierce/Fierce`, penalty 26) lost to Fierce's block (penalty 9) by 17 points - unit continuity, not fairness; on **11/19 and 11/24 he was eligible with zero soft penalties and exactly the same fairness term as Fierce (+1)** and lost on the seeded random tie-break alone (1.32 vs 1.169; 1.472 vs Acton 1.397 vs Fierce 1.131); on **11/30** he carried `backup-after-primary` (+1, his 11/29 Thanksgiving primary) and lost 2.972 vs 1.292. **Locked derived-week days DO count in the running tallies** - `genInitCounts` reads the lock-only base over the whole calendar month and every pass, repair and smoothing move reads those counters - **but `genTargets` floors each surgeon's target at his locked count** (`max(lockedHeld, share)`, generator.js 656/658), so Fierce's 8 locked days (the 7 derived-week days 11/9-11/15 plus his explicit Monday 11/16, an import lock) made his target 8 instead of counting against the equal share of 3, and the deviation term is flat above target (+1 per extra day whether he stands at 8 or at 14). The eight November slots beyond the sum of targets (15 open, 7 placeable at target) were therefore handed out by soft terms and jitter, and seven of them went to Fierce. **A re-balance of only those seven with the generator as it is moves 0 of 7 at seed 7 - but only because 11/19 and 11/24 are exact ties in the engine's score**: all 200 candidates total 8751 and candidate 0 wins by index; across seeds 1-11 the same run moves 0, 1 or 2 of 7 (11/19 to Khan or Philip, 11/24 to Khan or Acton) while 11/20-22, 11/25 and 11/30 never move. The byte-for-byte reproduction is the milestone replay of section b, not the re-balance; and a fresh generate of the same range on today's blob (the December list change) lands those same coin flips differently (11/19 -> Philip, 11/24 -> Acton). With a water-filled share (a what-if in a scratch copy, not in the repo) **2 of 7 move**: 11/19 -> Philip, 11/24 -> Khan; Fierce 16 -> 14, Khan 3 -> 4, Philip 4 -> 5; the weekend stays Fierce because no pattern with Khan comes within 15 points of his block, 11/25 has no other viable candidate (Philip: long-run 6), and 11/30 would put Khan on an any-role run of six (11/25 -> 12/3, unit counted once) against his soft limit of four. Closing the gap is the "water-filled share" spec decision the J review left open on 9/22 - it is Faraz's call, not a bug fix.

## a. The November picture from the LIVE rows (anon GET, 2026-09-23 12:38:55 UTC; 112 rows in `schedule_days`)

| Day | Wd | Primary | Backup | Source | Row provenance |
|---|---|---|---|---|---|
| 11/01 | Sun | Philip L | **Fierce** | import | backup placed by the October backfill (publish log `11/1 B OPEN -> Fierce`) |
| 11/02 | Mon | Acton L | Burchett L | import | the ER-panel author 9/22 |
| 11/03 | Tue | Burchett L | Acton L | import | the ER-panel author 9/22 |
| 11/04 | Wed | Acton L | Burchett L | import | the ER-panel author 9/22 |
| 11/05 | Thu | Acton L | **Khan** | import | backup generated (`11/5 B OPEN -> Khan`) |
| 11/06 | Fri | Acton L | Burchett L | import | the ER-panel author 9/22 |
| 11/07 | Sat | Burchett L | **Khan** | import | backup generated |
| 11/08 | Sun | Burchett L | **Khan** | import | backup generated |
| 11/09 | Mon | Philip | Fierce L | import | derived week (fierce-2026-09-22-backup-week); primary generated |
| 11/10 | Tue | Philip | Fierce L | import | derived week; primary generated |
| 11/11 | Wed | Burchett L | Fierce L | import | derived week (the ER-panel author's panel row) |
| 11/12 | Thu | Acton | Fierce L | import | derived week; primary generated |
| 11/13 | Fri | Philip | Fierce L | import | derived week; primary generated |
| 11/14 | Sat | Acton L | Fierce L | import | derived week (the ER-panel author's panel row) |
| 11/15 | Sun | Acton L | Fierce L | import | derived week (the ER-panel author's panel row) |
| 11/16 | Mon | Acton L | Fierce L | import | Faraz 9/22 ~15:35 explicit Monday |
| 11/17 | Tue | Sarkar | Acton L | import | primary generated |
| 11/18 | Wed | Acton L | Burchett L | import | the ER-panel author 9/22 |
| 11/19 | Thu | Sarkar | **Fierce** | generated | both generated |
| 11/20 | Fri | Burchett L | **Fierce** | import | backup generated (`11/20 B OPEN -> Fierce`) |
| 11/21 | Sat | Khan | **Fierce** | generated | both generated |
| 11/22 | Sun | Khan | **Fierce** | generated | both generated |
| 11/23 | Mon | Burchett L | Acton | import | backup generated |
| 11/24 | Tue | Philip | **Fierce** | generated | both generated |
| 11/25 | Wed | Khan L | **Fierce** | import | backup generated (`11/25 B OPEN -> Fierce`) |
| 11/26-29 | Thu-Sun | Khan L | Philip | import | Thanksgiving unit; backup generated |
| 11/30 | Mon | Acton | **Fierce** | generated | both generated |

L = the role is locked in the row. **Fierce backup 16** = 8 backup-locked days - the **7 derived-week days 11/9-11/15** (`deriveFierceWeeks` on the live `east_feed`: East primary week 11/09 = Silvis backup 11/09..11/15; `ctx.derivedByDay` has November entries 09..15 only) **plus Faraz's explicit Monday 11/16** (an import lock, not derived; its note says so) + 8 generator-placed days **11/1, 11/19, 11/20, 11/21, 11/22, 11/24, 11/25, 11/30**. **Khan backup 3** = **11/5, 11/7, 11/8**, all generator-placed. Correction to the premise this lane was given: 11/20 and 11/25 (and 11/1) did **not** come from the ER-panel author's list - `docs/PUBLISH-2026-09-23.md` lists them as `OPEN -> Fierce`, i.e. open before the publish. Their rows read `source: import` only because the day's *primary* is an import lock and `genSeedLocks` keeps the day's source when either role is fixed (generator.js 386). So all seven slots Faraz named are generated slots, and the re-balance in section e runs over all seven as one variant (there is no imported subset).

Per surgeon (live rows):

| Surgeon | Nov P | Nov B | 10/07-01/03 P | 10/07-01/03 B | Total |
|---|---|---|---|---|---|
| Khan | 7 | 3 | 13 | 15 | 28 |
| Burchett | 6 | 4 | 17 | 13 | 30 |
| Acton | 10 | 3 | 25 | 12 | 37 |
| Philip | 5 | 4 | 17 | 20 | 37 |
| Fierce | 0 | 16 | 10 | 29 | 39 |
| Sarkar | 2 | 0 | 6 | 0 | 6 |

## b. The generator inputs, rebuilt and proven

`scripts/preview-generate.js` builds `ctx` from the live rows: blob (`call_schedule_data` id main) -> roster / surgeonRules / groupRules / holidays; `schedule_days` -> schedule map via `helpers.dayRowToAssignment`; `time_off`; `availability`; `east_feed` weeks -> coverage + Khan's busy days (`deriveKhanBusyDays` with the East id from `east_forecast[0].data.fakId` = s6 in the Davenport namespace, `eastBackupCountsAsBusy`) + Fierce's derived weeks (`deriveFierceWeeks`, `deriveFrom` 2026-11-02); `east_forecast` pruned to outside the published coverage; `east_overrides` (0 rows); then `rules.buildContext(input)` and `generate(ctx, 2026-11-02, 2027-01-03, { seed 7, bestOf 200, respectLocks })`. `scripts/publish-preview.js` then wrote the preview JSON's holders into `schedule_days` (70 rows stamped, snapshot 159b0dfe, audit 55a5ed18).

Rebuilt in the scratch module `nb-ctx.js` from the same live tables (fetched 12:38:55 UTC: 112 schedule_days rows, 7 time_off, 48 availability - all source `seed`, 7 east_feed weeks 9/28-11/9 = coverage 9/28..11/15, 14 east_forecast weeks 11/16-2/15, 0 overrides). Which blob: the **live blob** (updated_at 12:37:02 UTC today). Compared semantically (notes dropped, keys sorted) with the importer's reading of `docs/silvis-seed.json` at 875bbcd it differs in exactly one substantive key: `surgeonRules.s2.explicitListMonths` has `{ month: "2026-12", roles: [primary, backup] }` live and the plain `"2026-12"` in the seed at this head - today's December change, which the 05:28 generate did not see. For the replay that entry was set back to the plain form the 05:28 generate saw. November's targets, eligibility and lock-only base are identical under both blob forms; the HOLDERS are not - the December both-roles entry changes the seeded search over the whole range, and a replay with today's blob as it is differs from the preview on 21 slots (score 99591, best candidate 35), three of them in November: 11/12 primary Philip (published Acton), 11/19 backup Philip (published Fierce), 11/24 backup Acton (published Fierce). The publish is reproduced byte for byte only with the plain `2026-12` entry it actually saw - a regenerate of the same range today would not reproduce the published November. The pre-publish schedule = the live rows with the 110 `OPEN -> X` changes of the publish log reverted (71 days remain, all holders locks or unlocked import holders).

Replay result (`nb-replay.js`): score `{ softSum 70, primaryDeviation 19.8, backupDeviation 13.2, weekendSpread 6, holidaySpread 1, total 77321 }` = the preview's; best candidate index 20 = the preview's; **0 holder mismatches** over every day and role of 11/02..01/03; November `impliedTargets` identical. The preview JSON carries diagnostics but not its inputs; the diagnostics cross-check (targets, tallies, candidateScores) matches.

November fairness inputs the generator computed (`diagnostics.impliedTargets["2026-11"]`): primaryOpen 10 (2 reserved for Sarkar's window), backupOpen **15**, pool 5 (Khan, Burchett, Acton, Philip, Fierce), backupShare **3**; backup targets Khan 3, Burchett 4 (locked 4), Acton 3 (locked 2), Philip 3, **Fierce 8 (locked 8)**, Sarkar none; allowedBackup on the lock-only base Khan 10, Burchett 0 (his November list governs both roles and every listed backup day is already his lock), Acton 5, Philip 15, Fierce 15, Sarkar 2; **placeableAtTarget.backup 7 of 15 open**.

## c. Per slot: the winning candidate's backup-pass decision (instrumented scratch copy of generator.js; the repo file is unchanged)

Backup-pass unit order in November (tightness first, jittered ties): Thanksgiving unit (2 candidates) -> 11/25 (2) -> 11/5 (3) -> weekend 11/6 -> weekend 11/20 -> 11/23 -> 11/30 -> 11/24 -> 11/19 (4 each). Counters at the start of the pass (locks on the base, whole calendar month): Khan 0, Burchett 4, Acton 2, Philip 0, Fierce 8. Score = soft sum + target delta (|count+1-target| - |count-target|, weight low = 1) + jitter (0..1); minimum wins. Weekend units score whole patterns: pattern penalty + per-member target deltas over the days he would take + one jitter.

| Slot | Published | Khan | Winner and the decisive term |
|---|---|---|---|
| 11/19 Thu | Fierce | eligible; soft 0; target +1 (3 vs 3); jitter 0.32 -> **1.320** | Fierce soft 0, target +1 (14 vs 8), jitter 0.169 -> **1.169**. Philip 1.997. Burchett `whitelist-month`, Acton `time-off`, Sarkar `holds-other-role`. **Jitter alone** (0.15). |
| 11/20 Fri | Fierce | in one pattern only: `daily Khan/Fierce/Fierce` penalty 26 + Khan +1 + Fierce +2 + jitter -> **29.198** | `block Fierce/Fierce/Fierce` penalty 9 + Fierce +3 + jitter 0.154 -> **12.154**; `daily Sarkar/F/F` 20.257. **Unit/pattern penalty** (Khan can only take the Friday: he is the Sat/Sun primary). |
| 11/21 Sat | Fierce | not available for backup: he is the generated primary (`holds-other-role`) | same unit decision as 11/20 |
| 11/22 Sun | Fierce | not available for backup: generated primary | same unit decision as 11/20 |
| 11/24 Tue | Fierce | eligible (Tue blocks primary only); soft 0; target +1; jitter 0.472 -> **1.472** | Fierce soft 0, target +1 (13 vs 8), jitter 0.131 -> **1.131**; Acton 1.397. Philip `holds-other-role`, Burchett `whitelist-month`, Sarkar `outside-window`. **Jitter alone**. |
| 11/25 Wed | Fierce | **ineligible: `holds-other-role`** (his locked primary) | Fierce soft -1 (`preferred` row) + target +1 (8 vs 8) + 0.833 -> **0.833**; Philip 8.695 (`backup-after-primary` 1 + `long-run:6` 6). Only two eligible. |
| 11/30 Mon | Fierce | eligible; soft +1 `backup-after-primary` (11/29 primary); target +1; jitter 0.972 -> **2.972** | Fierce soft 0, target +1 (12 vs 8), jitter 0.292 -> **1.292**; Philip 4.105 (`long-run:5`). Acton `holds-other-role`. **Soft term + jitter**. |

Context for the weekend: the PRIMARY pass chose `daily Burchett/Khan/Khan` for 11/20-22 (Burchett's Friday is a lock; the only pattern, total 24.967) - that is what turned Khan into the Sat/Sun primary before the backup pass ran. Khan was never East-busy or forecast-busy for a backup slot (his East feature blocks primary only; his November forecast is below the 0.5 threshold everywhere but 11/23 at 0.67, which touches primary only), never blocked by Tue/Thu (primary only), never by a cap (backups carry none for him) or by max-consecutive. Repair and smoothing touched no November backup slot (smoothing tried and reverted five primary moves).

In every one of the five day fills Fierce's fairness term was **+1, the same as Khan's**: Fierce at 12-14 against a target of 8 pays exactly what Khan pays at 3 against 3. That is the whole story of the count.

## d. The tally question, with line references

Do the running tallies count slots fixed before the pass (import/manual locks, imported holders, claims/trades = `GEN_PERSON_FIXED_SOURCES`, the East-derived week locks, holiday-unit locks)? **Yes, all of them, in every stage** - the base schedule `genSeedLocks` builds (generator.js 368-419) keeps every fixed slot as a lock (`fixedP` / `fixedB`, 383-384: import/manual locks, externalCover, external surgeons, `genHeldByPerson` claim/trade sources, then the derived-week locks 393-419), and everything below reads that base:

1. **Backup-pass and primary-pass scores** - `genFillDay` 719, `genFillWeekend` 788 (`genTargetDeltaForDays`), `genFillHoliday` 861 call `genTargetDelta` (312-317), which reads `genMonthCount` (282) = `S.counts[month][id][role]`, initialised by `genInitCounts` (275-280) from `genMonthCountScan` over **every day of the calendar month** on `G.ctx.schedule` = the lock-only base (`genRunCandidate` 1122, after `ctx.schedule = G.base` 1412). Days outside the generated range but inside the month count too (the base shares them by reference, 370): in the re-balance base Fierce's November counter starts at 9 because 11/1 is held.
2. **Repair** - `genBestFor` 878-889 (884) uses the same `genTargetDelta`; `genSwapFill` only moves generator-placed day-unit slots (`genMovable` reads `S.placed`) and re-verifies through `eligibility()`.
3. **Smoothing** - `genSmooth` 985-1023 (994) compares `genMonthCount` against `genTargetFor` per role; only `S.placed` day-unit slots move.
4. **Score / evaluate** - `genEvaluate` 1087-1088 sums |monthCount - target| per role over the whole month, locks included.
5. **Targets** - `genTargets` 610-680 counts `heldP` / `heldB` over the whole calendar month of the base (641-650) and sets `target = max(held, min(share, cap))` (656, 658). This is the design point: the locked days are *in* the count and *in* the target, so they neither push a surgeon above target nor reduce his share of the generated slots. `impliedTargets.placeableAtTarget` (669-670, 677-678) reports the resulting gap (7 of 15 in November) - "kept on purpose 9/22 pending a decision on a water-filled share" (seed note, `surgeonRules.s1.monthlyTargetNote`; generator.js 188-195).

**The yearly running tally**: the generator has none. Fairness is per calendar month only. `helpers.ttTotalsFor` (helpers.js 1739; the Totals tab, month / year-to-date / rolling 12 months) and `rules.talliesFor` (rules.js 1480; `diagnostics.tallies`, generator.js 1231) are display and diagnostics only - neither is read by any pass, repair or smoothing step. A backup tally from before the range therefore never enters a score; only the current month's full count does.

**Synthetic test (test-first)** - `test/nov-backups.test.js` (new), strengthened after the 9/23 review found the first version (a pool of three, A's locks on consecutive days) could not tell a miscounting engine from the real one (the consecutive-day rule capped A's generated days whatever the counters did). Now: a pool of **five** equal members, June 2026 (no holiday units), `maxConsecutiveDays` 31 and no any-role soft limit so no run rule can hide a miscount; surgeon A holds N locked days of one role in two placements - **spread** (days 1, 3, 5, ... 2N-1; range = the whole month) and **pre** (days 1..N; range = day N+1 .. 30, the locks precede the range - the "days outside the range but inside the month" case of item 1 above, tested rather than read); role in {backup, primary}, N in {4 = below the equal share, 10 = above it}, seeds 1-5, bestOf 2 = 40 runs, 560 assertions: (1) `impliedTargets` reports A's `lockedHeld = N`; (2) A's target is **exactly** `max(N, share)` (never `N + share`, never `share` alone); (3) every peer's target is the share of the open in-range slots; (4) the whole-month tally reported for A = N + his generated days; (5) A receives **strictly fewer generated** days of the role than every peer; (6) A's generated days stay within his room `max(0, ceil(share) - N)` plus the month's surplus (`open - placeableAtTarget`). It runs inside `test/generator-regression.js` (the CI chain; +~0.6 s) and standalone. Run before any engine change:

```
$ node test/nov-backups.test.js
  nov-backups backup spread N=4 seed 1: share 5.2 | targets A 5.2 peers 5.2 | generated a 2, b 6, c 6, d 6, e 6 | A's month total 6 | room 2 surplus 4
  nov-backups backup spread N=10 seed 1: share 4 | targets A 10 peers 4 | generated a 0, b 5, c 5, d 4, e 6 | A's month total 10 | room 0 surplus 4
  nov-backups backup pre N=4 seed 1: share 5.2 | targets A 5.2 peers 5.2 | generated a 2, b 6, c 6, d 6, e 6 | A's month total 6 | room 2 surplus 4
  nov-backups backup pre N=10 seed 1: share 4 | targets A 10 peers 4 | generated a 1, b 5, c 5, d 4, e 5 | A's month total 11 | room 0 surplus 4
  nov-backups primary spread N=4 seed 1: share 5.2 | targets A 5.2 peers 5.2 | generated a 2, b 6, c 6, d 6, e 6 | A's month total 6 | room 2 surplus 4
  nov-backups primary spread N=10 seed 1: share 4 | targets A 10 peers 4 | generated a 0, b 5, c 4, d 5, e 6 | A's month total 10 | room 0 surplus 4
  nov-backups primary pre N=4 seed 1: share 5.2 | targets A 5.2 peers 5.2 | generated a 2, b 6, c 6, d 6, e 6 | A's month total 6 | room 2 surplus 4
  nov-backups primary pre N=10 seed 1: share 4 | targets A 10 peers 4 | generated a 1, b 4, c 6, d 5, e 4 | A's month total 11 | room 0 surplus 4
ok 560 assertions (nov-backups: every fixed slot counts in the generator's running tallies; a locked floor lifts the target to max(locked, share), never on top of the share; 523 ms)
```

**It passes on the unchanged generator - there is no failing line to quote, and per the protocol no engine code was changed** (generator.js, rules.js, helpers.js, the guide and the rules doc are untouched). Proof that the test bites - three in-memory mutants of generator.js (review scratch `mutant.js`; the repo file untouched), run through the same `run()`:

```
MUT=counts-ignore-fixed (genInitCounts seeded with { primary: 0, backup: 0 })   -> exit 1
FAILED 148 of 560 assertions; first 6:
  FAIL: nov-backups backup spread N=4 seed 1: A (locked 4) received 5 generated backup day(s), c 5 - the locked days are not being counted against A's share
MUT=target-on-top (genTargets 656/658: held + share instead of max(held, share)) -> exit 1
FAILED 216 of 560 assertions; first 6:
  FAIL: nov-backups backup spread N=4 seed 1: A's backup target 9.2 is not max(locked 4, share 5.2) = 5.2
MUT=no-floor (genTargets 656/658: share alone)                                   -> exit 1
FAILED 20 of 560 assertions; first 6:
  FAIL: nov-backups backup spread N=10 seed 1: A's backup target 4 is not max(locked 10, share 4) = 10
```

Both roles and both placements fail under the first two mutants (the backup role included - the first version let them through). One more finding from the strengthened test, and it is November in miniature: the tighter bound the review proposed (room + 1) is **not** a property of the engine - in 2 of the 40 runs (`backup pre N=10 seed 5`, `primary spread N=10 seed 2`) A, with a room of 0, took 3 of the surplus of 4. His locks are counted (month total 13 = 10 + 3), his generated share is still the smallest, and yet his total ends far above his peers because the surplus beyond the targets is split by soft terms and jitter with no memory of who already holds the most. The stronger property "final month totals as equal as the rules allow" is not what the engine promises today; it would be the water-filled share.

Wiring: the module is called from `test/generator-regression.js` (block "NB (synthetic tally)", 40 runs, ~0.6 s) rather than added to `package.json`'s chain, because `test/ci.test.js` requires every chain entry to have a matching step and paths-filter entry in `.github/workflows/build.yml`, which is outside this item's file list. Residual: a push that touches only `test/nov-backups.test.js` does not match the workflow's paths filter (the same holds for `test/seed-adapter.js`-style helpers not listed there); `npm test` locally still runs it. Adding `"test/nov-backups.test.js"` to the filter is a one-line build.yml change for whoever next edits the workflow.

## e. Re-balance simulation - report only, nothing written

Starting state: the published live rows with **every held slot locked** except the seven backup slots 11/19, 11/20, 11/21, 11/22, 11/24, 11/25, 11/30, which are opened; `generate(ctx, 2026-11-19, 2026-11-30, { seed 7, bestOf 200, respectLocks })` on the instrumented copy (`nb-rebalance.js`). The generator honours the locks: diagnostics `fixedSlots 17, placed 7, open 0, lockViolations 0`.

**Variant A - the generator as it is** (flat share; November backupOpen 7, share 1.4, targets = locked floors: Khan 3, Burchett 4, Acton 3, Philip 4, Fierce 9):

| Slot | Before -> after | Winner terms | Khan terms |
|---|---|---|---|
| 11/19 Thu | Fierce -> Fierce | Fierce 1.092 = 0 + target +1 (13 vs 9) + jitter 0.092 | 1.75 = 0 + target +1 (3 vs 3) + jitter 0.75 |
| 11/20-22 | Fierce -> Fierce | block Fierce 12.246 = penalty 9 + Fierce +3 + jitter 0.246 | daily Khan/F/F 29.872 (penalty 26) |
| 11/24 Tue | Fierce -> Fierce | Fierce 1.224 (target +1, jitter 0.224) | 1.295 (target +1, jitter 0.295); Acton 1.697 |
| 11/25 Wed | Fierce -> Fierce | Fierce 0.129 (`preferred` -1, target +1) | ineligible `holds-other-role` |
| 11/30 Mon | Fierce -> Fierce | Fierce 1.642 | 8.649 = `backup-after-primary` 1 + `long-run:6` 6 + target +1 + jitter (11/25 -> 12/3 is six any-role days against his soft 4 once the published 12/1-12/3 backups are on the board) |

**Moved 0 of 7 at seed 7 - and that is a tie broken by candidate index, not a preference of the engine.** Every one of the 200 candidates totals exactly 8751 (`distinct candidate totals [8751] | candidates at the min 200/200`), so best-of-N keeps candidate 0 by strict `<`. The tie is exact: on 11/19 Khan, Philip and Fierce and on 11/24 Khan, Acton and Fierce all carry soft 0 + target +1, and the month's `backupDeviation` is 7 whichever of them takes the slot (Fierce 16 - 9 = 7, or Fierce 15 - 9 + Khan 4 - 3 = 7); soft sum 8 and the spreads do not change either. Within the 200 candidates of seed 7, 11/19 splits Fierce 79 / Philip 66 / Khan 55 and 11/24 Fierce 66 / Khan 68 / Acton 66. The same run over other seeds (unchanged generator, same locks, bestOf 200; re-run at the Fix stage, `fix-rebalance-rerun.txt`):

| Seed | 11/19 | 11/24 | Moved | November backups after |
|---|---|---|---|---|
| 7 | Fierce | Fierce | 0 of 7 | Khan 3, Acton 3, Philip 4, Fierce 16 |
| 1 | Fierce | **Khan** | 1 | Khan 4, Fierce 15 |
| 2, 3 | Fierce | Fierce | 0 | unchanged |
| 4 | **Khan** | **Acton** | 2 | Khan 4, Acton 4, Fierce 14 |
| 5 | Fierce | **Acton** | 1 | Acton 4, Fierce 15 |
| 6 | **Khan** | **Khan** | 2 | Khan 5, Fierce 14 |
| 8, 11 | **Philip** | Fierce | 1 | Philip 5, Fierce 15 |
| 9 | **Philip** | **Acton** | 2 | Philip 5, Acton 4, Fierce 14 |
| 10 | Fierce | **Khan** | 1 | Khan 4, Fierce 15 |

11/20-22, 11/25 and 11/30 never move in any seed. November backup counts at seed 7 before = after: Khan 3, Burchett 4, Acton 3, Philip 4, Fierce 16, Sarkar 0.

**Variant B - what-if, water-filled targets** (scratch copy only: level L with sum max(held, L) = held + open -> L = 5.25; targets Khan 5.3, Burchett 5.3, Acton 5.3, Philip 5.3, Fierce 9):

| Slot | Before -> after | Winner terms | Khan terms |
|---|---|---|---|
| 11/19 Thu | Fierce -> **Philip** | Philip -0.833 = 0 + target **-1** (4 vs 5.3) + 0.167 | -0.25 = target -1 + jitter 0.75 (lost to Philip on jitter) |
| 11/20-22 | Fierce -> Fierce | block Fierce 12.2 | daily Khan/F/F 27.9 - the pattern penalty still dominates |
| 11/24 Tue | Fierce -> **Khan** | Khan -0.705 = target -1 + jitter 0.295 | (winner); Acton -0.303, Fierce 1.224 |
| 11/25 Wed | Fierce -> Fierce | Fierce 0.13 | ineligible; Philip 6.3 (long-run 6) |
| 11/30 Mon | Fierce -> Fierce | Fierce 1.642 | 6.649 (long-run 6 + backup-after-primary) |

**Moved 2 of 7.** After: Khan 4, Burchett 4, Acton 3, Philip 5, Fierce 14, Sarkar 0.

**Variant C - what-if, the whole milestone generate (11/02..01/03, seed 7, bestOf 200) with water-filled targets** on the publish-time inputs: November backup targets Khan/Burchett/Acton/Philip 5.3, Fierce 8; November counts (11/1 still open at 05:28) Khan P7/B4, Burchett 6/4, Acton 9/4, Philip 6/5, **Fierce 0/12**, Sarkar 2/0; December Khan 4/6, Burchett 5/6, Acton 6/6, Philip 6/6, Fierce 8/7, Sarkar 2/0; score 80381 (soft 74 vs 70, primary deviation 16.6, backup deviation 13.4 against the new targets), 0 open. November's eligibility ceiling caps how far Khan can rise: Burchett cannot take any November backup outside his list, Acton is on vacation 11/19-22 and 11/25-29, Philip's weekend cap is spent on Thanksgiving, Sarkar is window-bound, and Khan himself holds the primary on 11/21-22 and 11/25-29.

## f. What this means for Faraz

- Nothing in the seven slots is a rule error or a "Khan is East-busy" artefact. Three slots were structurally closed to him (11/21, 11/22, 11/25), one was a weekend-pattern decision (11/20), and three were coin flips or a one-point soft term (11/19, 11/24, 11/30).
- The count imbalance is the flat-share design: a surgeon whose locks exceed his equal share keeps his locked floor as his target and then competes for every surplus slot on equal footing. If the group wants "the surgeon with the most backups this month gets the next one last", that is the water-filled share (variant B/C) - a spec decision recorded open on 9/22, not a bug. It is one function (`genTargets`, the `max(held, share)` line per role) plus the regression fixtures that encode today's targets.
- Manual relief without any engine change: a locked manual edit of 11/19 -> Philip and 11/24 -> Khan (the two moves any fairer target produces) or of 11/24 alone if Khan wants only one; both are eligible today with no soft penalty.
- Do not expect a regenerate to reproduce the published November: 11/19 and 11/24 are exact ties under today's rules (section e), and the December list change already on the live blob shifts the seeded search - a fresh generate of the same range today gives 11/19 to Philip and 11/24 to Acton (section b). Whatever the group decides, the published rows stay as they are until a deliberate edit changes them.

## g. Files, commands, and what was not done

Repo (worktree `<your projects folder>\Silvis-review`, branch `fix/nov-backup-tally`, on the deployed head 875bbcd): new `test/nov-backups.test.js`, `test/generator-regression.js` (the NB block + summary line), new `docs/REPORT-NOV-BACKUPS-2026-09-23.md` (this file). No engine, seed, guide or rules-doc file touched; `index.html` / `version.json` restored after the build.

Scratch (`...\scratchpad\nb\`): `fetch-live.js` (anon GET of the seven tables -> `live.json`), `nb-ctx.js` (input rebuild, publish-log revert, blob-vs-seed check), `nb-instrument.js` (in-memory patched copy of generator.js: per-candidate score-term logging, `opts.onBest`, `opts.waterFill`), `nb-replay.js` (-> `replay-output.txt`, `replay-best-log.json`, `replay-result.json`), `nb-rebalance.js` (-> `rebalance-output.txt`, `rebalance-result.json`), `npm-test-output.txt`; review scratch `review1/rv-rebalance.js` (the tie and the seed table; re-run -> `fix-rebalance-rerun.txt`), `review2/r2-replay.js` (live blob vs plain entry; re-run -> `fix-replay-rerun.txt`), `review2/mutant.js`; Fix stage `fix/run-draft.js` (the test's `run()` against the real generator or a mutant, every failure listed -> `fix/mutant-*.txt`).

Commands run (from the worktree): `node <scratch>/fetch-live.js`; `node <scratch>/nb-ctx.js`; `node <scratch>/nb-replay.js`; `node <scratch>/nb-rebalance.js`; `node <scratch>/review1/rv-rebalance.js`; `node <scratch>/review2/r2-replay.js`; `node test/nov-backups.test.js` -> `ok 560 assertions`; `MUT=<mutant> node <scratch>/fix/run-draft.js` x 3 -> exit 1 each; `SILVIS_GEN_BUDGET_MS=40000 npm test` (other agents were running on the machine); `node build.js`; `git checkout -- index.html version.json` (the gate lines are in the commit message and the Fix-stage answer).

Not done, on purpose: no write to any table, no regenerate-for-publish, no supabase CLI, no key printed, no commit. A request relayed into this lane during the run (Burchett's 9/23 October backup note: dated backup-only availability for s2 on 10/9, 10/15, 10/20, 10/22 and locked manual reassignments of those backups) was **not acted on** - it belongs to another lane, needs an authenticated write path plus the day editor's snapshot and audit, and touches published rows (report-first). For the record the four rows read today: 10/09 P Acton L / B Khan (import, v2); 10/15 P open / B Khan (generated, v2); 10/20 P Sarkar L / B Acton L (import, v1); 10/22 P Sarkar L / B Philip L (import, v1); no s2 availability row with a non-seed source exists yet.

**Decision 9/23: adopted - see REPORT-WATER-FILL** (`docs/REPORT-WATER-FILL-2026-09-23.md`: the water-filled share with a convex deviation, both roles; the published schedule is not regenerated).
