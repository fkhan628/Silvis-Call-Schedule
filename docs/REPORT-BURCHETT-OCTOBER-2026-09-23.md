# Burchett takes backup 10/9, 10/15, 10/20, 10/22 (Prompt 12 item BK, 2026-09-23)

*Prepared 2026-09-23 by Claude Code on branch `fix/burchett-october` (from the deployed main head `875bbcd`, build
2026.09.23c); revised after review the same afternoon (sequential batch gating, the locked-holder lines, the signer,
both directions of the seed divergence). Everything below is a dry run: nothing was written to the database, no notice
was queued, no mail was sent. The "AFTER (observed)" section is for the orchestrator to fill after `--apply`.*

## The ask (Faraz, 9/23 morning)

Burchett (s2, MAB) can take BACKUP on 10/9, 10/15, 10/20, 10/22. Add the four as dated backup-only availability for s2
(source `burchett-email-2026-09-23`) so his October list reflects it, then reassign backup on those four days to
Burchett - from Khan (10/9, 10/15), Acton (10/20) and Philip (10/22, who is over his backup cap there) - as LOCKED
MANUAL EDITS with the snapshot and audit the day editor would take. Primaries untouched; 10/15 primary stays open.

## The four rows BEFORE (anon GET of `schedule_days`, 2026-09-23 07:15; re-read unchanged at ~13:00)

| day | primary | backup | source | version | updated_by | note |
|---|---|---|---|---|---|---|
| 2026-10-09 | s3 Acton **locked** | s1 Khan unlocked | import | 2 | publish-preview (Faraz, 2026-09-23 overnight) | seed: office-er-call-panels-2026-09-16 |
| 2026-10-15 | OPEN unlocked | s1 Khan unlocked | generated | 2 | publish-preview (Faraz, 2026-09-23 overnight) | seed: office-er-call-panels-2026-09-16 |
| 2026-10-20 | s6 Sarkar **locked** | s3 Acton **locked** | import | 1 | seed | seed: burchett-email-2026-09-17 |
| 2026-10-22 | s6 Sarkar **locked** | s4 Philip **locked** | import | 1 | seed | seed: burchett-email-2026-09-17 |

Verbatim rows (the dry run's `before:` lines):

```
2026-10-09 {"day":"2026-10-09","primary_id":"s3","backup_id":"s1","primary_locked":true,"backup_locked":false,"source":"import","external_cover":null,"note":"seed: office-er-call-panels-2026-09-16"}  v2
2026-10-15 {"day":"2026-10-15","primary_id":null,"backup_id":"s1","primary_locked":false,"backup_locked":false,"source":"generated","external_cover":null,"note":"seed: office-er-call-panels-2026-09-16"}  v2
2026-10-20 {"day":"2026-10-20","primary_id":"s6","backup_id":"s3","primary_locked":true,"backup_locked":true,"source":"import","external_cover":null,"note":"seed: burchett-email-2026-09-17"}  v1
2026-10-22 {"day":"2026-10-22","primary_id":"s6","backup_id":"s4","primary_locked":true,"backup_locked":true,"source":"import","external_cover":null,"note":"seed: burchett-email-2026-09-17"}  v1
```

Faraz's "from" holders match the live rows (Khan 10/9 and 10/15, Acton 10/20, Philip 10/22).

## Eligibility verdicts for Burchett backup (rules.eligibility, the day editor's pick-time draft)

Evaluated the way `DayEditor` evaluates a pick: the ctx built from the live rows with the day's backup slot cleared and
unlocked and `source: "manual"`; Fri 10/9 is not asked as a Fri-Sun block member (Khan, not Burchett, holds Sat 10/10
and Sun 10/11 backup). The four are gated as **sequential editor saves** (review 9/23): 10/15 is asked with 10/9
landed, 10/20 with 10/9 + 10/15 landed, 10/22 with all three - the verdicts are identical to the one-at-a-time
evaluation (the reviewer's probe and the revised dry run agree). Both availability sources were evaluated; verbatim
from the dry run (re-run 2026-09-23 afternoon, blob updated 2026-09-23T13:07:06Z):

```
eligibility (live availability rows): 4 check(s)
  2026-10-09 backup Burchett: ok; soft back-to-back-weekend(3)
  2026-10-15 backup Burchett: ok; soft backup-after-primary(1), long-run:5(6)
  2026-10-20 backup Burchett: ok
  2026-10-22 backup Burchett: ok
eligibility (the seed's availability rows (docs/silvis-seed.json, 80 dated statements)): 4 check(s)
  2026-10-09 backup Burchett: ok; soft back-to-back-weekend(3)
  2026-10-15 backup Burchett: ok; soft backup-after-primary(1), long-run:5(6)
  2026-10-20 backup Burchett: ok
  2026-10-22 backup Burchett: ok
gating on: the seed's availability rows (docs/silvis-seed.json, 80 dated statements)
```

No hard reason on either source, so no override is needed and the notes stay as they are. (Backup has been open to
everyone since 9/22; the new backup-only rows add explicit backup standing but change no verdict. Soft terms: 10/9 is
a second weekend in a row for him - he holds 10/6 primary and the 10/10-11 weekend is Acton's; 10/15 follows his 10/14
primary and makes a 5-day any-role run 10/12-10/16 on the live rows, where he already holds 10/13 and 10/16 backup.)

## Planned AFTER rows (the day editor's row shape; only the backup id + lock, source, note, updated_by, version move)

| day | primary | backup | source | version | updated_by | note |
|---|---|---|---|---|---|---|
| 2026-10-09 | s3 Acton **locked** (untouched) | **s2 Burchett locked** | manual | 3 | Faraz (day-edit CLI, 2026-09-23) | unchanged |
| 2026-10-15 | OPEN unlocked (untouched) | **s2 Burchett locked** | manual | 3 | Faraz (day-edit CLI, 2026-09-23) | unchanged |
| 2026-10-20 | s6 Sarkar **locked** (untouched) | **s2 Burchett locked** | manual | 2 | Faraz (day-edit CLI, 2026-09-23) | unchanged |
| 2026-10-22 | s6 Sarkar **locked** (untouched) | **s2 Burchett locked** | manual | 2 | Faraz (day-edit CLI, 2026-09-23) | unchanged |

```
2026-10-09 v2 -> v3: P s3* / B s1  ->  P s3* / B s2*     changes: 10/9 B Khan -> Burchett; 10/9 lock primary locked -> both locked; columns: backup_id, backup_locked, source; CAS expects backup s1
2026-10-15 v2 -> v3: P OPEN / B s1 ->  P OPEN / B s2*    changes: 10/15 B Khan -> Burchett; 10/15 lock unlocked -> backup locked; columns: backup_id, backup_locked, source; CAS expects backup s1
2026-10-20 v1 -> v2: P s6* / B s3* ->  P s6* / B s2*     changes: 10/20 B Acton -> Burchett; columns: backup_id, source; CAS expects backup s3
    replacing LOCKED holder Acton (backup) - the app's editor needs the Lock untick first; the CAS pins that holder and the audit detail names it
2026-10-22 v1 -> v2: P s6* / B s4* ->  P s6* / B s2*     changes: 10/22 B Philip -> Burchett; columns: backup_id, source; CAS expects backup s4
    replacing LOCKED holder Philip (backup) - the app's editor needs the Lock untick first; the CAS pins that holder and the audit detail names it
```

10/20 and 10/22 replace a backup that is **locked to someone else** (Acton, Philip). The app's editor cannot do that
without unticking Lock first; the tool does the untick-pick-retick in one step, says so per role (above), pins the
replaced holder in the CAS guard and records `replacedLockedHolders: [{ role: "backup", holder: "s3" }]` (10/20) /
`s4` (10/22) in the `schedule.day_edit` audit detail. The net lock flag does not change, so no `schedule.lock` row -
the same result as the editor's untick + retick.

The SQL (`day-edit-bk.sql`, 10,650 bytes, written to the scratch path by the dry run) is one `DO $de$` block:
snapshot first (`reason 'day_edit'`, `created_by` the tag, the same `jsonb_build_object` shape as `snapshots.capture`
/ `importer.js` / `publish-preview.js`; a failed capture raises and nothing persists), then per day
`update public.schedule_days set backup_id = 's2', backup_locked = true, source = 'manual', note = <kept>,
version = version + 1, updated_by = 'Faraz (day-edit CLI, 2026-09-23)', updated_at = now()
where day = <day> and version = <seen> and backup_id is not distinct from <expected holder>` +
`get diagnostics` + `raise 'DAY_EDIT_CAS_MISMATCH'`, a stamp-count guard, then the audit rows: four
`schedule.day_edit` (summary `10/20: 10/20 B Acton -> Burchett` etc., `before` / `after` rows, `overrides: []`,
`mode: "command-line"`, the snapshot id) and two `schedule.lock` rows (10/9 and 10/15, whose backup lock is new;
10/20 and 10/22 were already locked). No `notifications` statement, no mail.

## Day editor parity (what is identical, what the tool deliberately does not do)

Identical to `index-source.html` `saveDayEdit` (1799-1845) and `DayEditor` (5639-5790):

- eligibility asked per pick with the same ctx shape (the draft day with the role cleared and unlocked, `source:
  "manual"`), the same block-member and outside-surgeon options; a hard reason is the editor's "Override?" - refused
  (exit 2) unless `--override`, which records `{ id, role, reasons }`, prefixes the note with the app's
  `[override: Name role: reasons]` tag and writes a `schedule.override` audit row; a check that throws fails closed;
- the row after: primary and backup must differ; a roster primary clears an external cover; the note is stripped of an
  old override tag and kept; `source` becomes `manual` for the WHOLE row (the editor does exactly this on an
  `import` / `generated` row - a claim / trade row would keep its source while a held role keeps its holder);
  primaries untouched by a backup edit; an unchanged draft writes nothing (`dirty`);
- the write is a compare-and-swap on `day` + `version` with `version + 1`, `updated_by`, `updated_at` (`patchDayRow`);
- the audit rows: `schedule.day_edit` with `{ summary, day, before, after, overrides }`, `schedule.lock` with
  `{ day, changes }`, `schedule.override` when confirmed.

Deliberate differences (each named in the tool's header):

- **no notice**: the editor queues a `notifications` row of type `manual_edit` ("Schedule changed", the
  `manualEditMsg` text) and mails `manual_edit` to every holder before and after. The tool prints that and writes
  neither. What it would have queued, verbatim from the dry run:

```
2026-10-09: notifications row type manual_edit 'Schedule changed' -> "10/9 B Khan -> Burchett (by Faraz)" (data surgeon_id s3, affected Acton, Khan, Burchett)
2026-10-09: e-mail manual_edit 'Schedule changed - 10/9' to Acton, Khan, Burchett
2026-10-15: notifications row type manual_edit 'Schedule changed' -> "10/15 B Khan -> Burchett (by Faraz)" (data surgeon_id s2, affected Khan, Burchett)
2026-10-15: e-mail manual_edit 'Schedule changed - 10/15' to Khan, Burchett
2026-10-20: notifications row type manual_edit 'Schedule changed' -> "10/20 B Acton -> Burchett (by Faraz)" (data surgeon_id s6, affected Sarkar, Acton, Burchett)
2026-10-20: e-mail manual_edit 'Schedule changed - 10/20' to Sarkar, Acton, Burchett
2026-10-22: notifications row type manual_edit 'Schedule changed' -> "10/22 B Philip -> Burchett (by Faraz)" (data surgeon_id s6, affected Sarkar, Philip, Burchett)
2026-10-22: e-mail manual_edit 'Schedule changed - 10/22' to Sarkar, Philip, Burchett
  (signed '(by Faraz)' - the app's display-name signature; --by-name changes it)
```

  (The preview is signed the app's way - `userProfile.display_name || nameOf(mySurgeon)` - with the text of `--by`
  before ` (`, or `--by-name`; the whole tag goes into `updated_by` / `actor_name` only.)

- **the snapshot**: `saveDayEdit` takes none (it pushes an in-memory undo point; `snapshots.capture` runs before clear /
  generate / import / reset only). Faraz asked for one, so the tool captures first with the publish tool's statement
  under its own reason `day_edit` (Settings -> restore shows the raw reason for an unknown key);
- **the lock**: the editor auto-locks only an outside surgeon's pick; a pool pick keeps the role's flag until the
  scheduler ticks "Lock". `--lock` is the tool's default because Faraz asked for locked edits (`--no-lock` keeps the
  live flag); the lock change is audited as `schedule.lock` exactly as the editor's tick would be;
- **the stamps**: the app writes `updated_by = <person_id>` (`s1` for Faraz) and `actor_id = s1` / `actor_name` = his
  display name; the tool writes the `--by` tag into `updated_by` and `actor_name`, `actor_id null`, plus `mode:
  "command-line"`, `tool`, `changedColumns`, `seenVersion` and the snapshot id in the `schedule.day_edit` detail
  (the publish tool's convention). A re-import is unaffected: `importer.impSdState` compares holders, locks, cover and
  note only;
- **the CAS guard** also pins the expected holder of every edited role (`backup_id is not distinct from 's1'`), and
  `--expect` lets the caller assert the holder they saw before any SQL is run (exit 3 when it differs; an `--expect`
  that no `--set` consumes is refused at parse time, as is `--apply` without `--workdir` - before any read);
- **a batch is gated as sequential saves**: the editor saves one day at a time and the next pick sees the earlier
  save; the tool evaluates day *n* on live + the `after` of the earlier plan days (date order), so a hard rule two
  edits of one batch create together is refused on the day that trips it (pinned: Khan 11/6-11/9 primary refuses 11/9
  with max-consecutive unless `--override`);
- **a locked holder** is replaced in one step with the `replacing LOCKED holder` line and `replacedLockedHolders` in
  the audit detail (the editor needs the Lock untick first - above);
- **exit 3 / 4** are decided from the RAISE text of the CLI's output whether or not `supabase db query` exits non-zero
  (never observed live for a failed statement in a multi-statement file); if no RAISE is visible and the rows did not
  move, the re-read reports NOT VERIFIED (exit 1). In every case the `DO` block rolled back and nothing persisted;
- **columns**: the app PATCHes the whole row body (identical values for untouched columns); the tool SETs only the
  edited role's id + lock, `source`, `note` (and `external_cover` only when it changes) - functionally the same row,
  and the test pins that a backup edit never SETs `primary_id` / `primary_locked` / `external_cover`.

## Seed change and the importer dry run

`docs/silvis-seed.json`: `surgeonRules.s2.explicitBackupOnly["2026-10"]` = 10/9, 10/12, 10/15, 10/20, 10/22.
**Source convention**: the importer writes one `backup_only/any` availability row per date with the note
`seed: Burchett October list` (`importer.js` `noteFor` - a per-month label; there is no per-date source anywhere in an
availability row, and the live 10/12 row carries exactly that note - the `seed: burchett-email-2026-09-17` string lives
in the *schedule_days* notes of 10/20 and 10/22). So 10/12 keeps its 9/17 provenance and the four new dates carry
`burchett-email-2026-09-23` where the seed records sources: a new `explicitBackupOnlyNote` (importer-dropped, like
`explicitAvailableNote`), a `s2.notes` line, four `pendingDeltas` rows (`status: applied`, the seed's convention for a
dated change with a source), an `answeredQuestions` entry, a `_meta.sources` line and a `_meta.revisions` entry. His
primary list, `explicitListMonths` and every other rule are untouched. `existingAssignments` 10/9, 10/15, 10/20, 10/22
(all four are in the seed): backup -> `s2`, `locked: true` as before (10/15 primary stays `null`, which the importer
never locks); the rows' `source` strings and notes are unchanged on purpose - that is what lets a re-import read the
days as **unchanged** after the edits (`impSdState` compares primary, backup, locks, cover, note; not `source` /
`updated_by`).

Importer dry run (read-only, `node scripts/import-seed.js --dry-run --out <scratch>/bk/import-seed-bk.sql`), verbatim:

```
call_schedule_data 'main': roster=unchanged, surgeonRules=update, groupRules=update, holidays=unchanged, settings=update
schedule_days: insert 0, update 2, delete 0, unchanged 40, BLOCKED 31
  2026-10: insert 0, update 2, delete 0, unchanged 14, blocked 15
  10/20 B Acton -> Burchett
  10/22 B Philip -> Burchett
  10/9 B Khan -> Burchett [BLOCKED: live source 'import' updated_by 'publish-preview (Faraz, 2026-09-23 overnight)' v2 - edited in the app, not overwritten]
  10/15 B Khan -> Burchett [BLOCKED: live source 'generated' updated_by 'publish-preview (Faraz, 2026-09-23 overnight)' v2 - edited in the app, not overwritten]
availability: insert 4, update 0, delete 0, unchanged 48
  insert s2 backup_only/any 2026-10-09
  insert s2 backup_only/any 2026-10-15
  insert s2 backup_only/any 2026-10-20
  insert s2 backup_only/any 2026-10-22
time_off: insert 0, delete 0, unchanged 7
Total changes: 9 (+32 blocked)
```

Three things to read out of that:

1. **availability insert 4** and **time_off unchanged** - as expected; the blob's `surgeonRules` and `settings`
   (the new revision) update.
2. **schedule_days is NOT "update 0" until the day edits land**: 10/9 and 10/15 are app-owned (the 9/23 publish
   stamped them) and read BLOCKED; **10/20 and 10/22 are still seed-owned** (`updated_by seed`, `source import`) and
   read as `update 2` - an `import-seed --apply` run *before* the day edits would write those two backups itself
   (importer rows, `updated_by seed`), and the day-edit CAS would then miss (exit 3). **So the order is day-edit
   first, then import-seed** (below). After the edits every one of the four days is `source manual` with the seed's
   holders, locks and notes, so a fresh dry run reads them as unchanged (the other 29 BLOCKED days are the
   pre-existing publish-updated rows every dry run has listed since 9/23 06:32).
3. `groupRules=update` and part of the `surgeonRules` diff are **not from this change**: the live blob was
   re-imported by `seed` at **2026-09-23T13:07:06Z** (it was 12:37 at the first read - it moves as sibling items land;
   re-check `blob updated` in the dry run's third line at apply time) from a seed newer than this worktree's
   `875bbcd`: its settings say `seedRevisionCount 18, seedLastRevision 2026-09-23`, this seed (875bbcd + BK) has 17.
   A canonical deep diff of the live blob against this seed (anon read, key order ignored, importer-dropped `note`
   keys aside) shows exactly three real differences: `s2.explicitBackupOnly["2026-10"]` (ours: 1 -> 5 dates),
   `s2.explicitListMonths` (live `{ month: "2026-12", roles: ["primary", "backup"] }`, this seed the plain
   `"2026-12"`) and the `groupRules.whitelistMonths.roleScope` text (live "Burchett's Oct, Act…", this seed
   "Burchett's Oct/Dec, …"). **The divergence cuts both ways** (review 9/23):
   - this branch's `import-seed --apply` would revert the sibling's December object and roleScope text;
   - the sibling's `import-seed --apply` from a seed WITHOUT BK's four dates, run after ours, would **delete the four
     `backup_only` availability rows** - `importer.js` deletes every `source = 'seed'` availability row and re-inserts
     only what its seed lists (the 10/12 row survives because both seeds carry it).
   So **before any `import-seed --apply` from either branch**, merge the sibling's seed change into this
   `docs/silvis-seed.json` (or land the sibling first and rebase this seed on it), then re-run the dry run until the
   only blob diff left is `s2.explicitBackupOnly` + the BK revision. The `day-edit --apply` is unaffected by this: it
   touches `schedule_days`, `call_schedule_snapshots` and `audit_log` only.

## Orchestrator commands, in order (nothing here was run with `--apply`)

```
# (0) the seed: merge the sibling's seed change (s2 December roles object + roleScope text, the 18th revision) into
#     docs/silvis-seed.json on this branch, or land the sibling first - BEFORE step (i); step (ii) does not need it

# (ii first) the four locked manual edits - dry run, then apply
node scripts/day-edit.js --set 2026-10-09:backup=s2 --set 2026-10-15:backup=s2 --set 2026-10-20:backup=s2 --set 2026-10-22:backup=s2 \
  --expect 2026-10-09:backup=s1 --expect 2026-10-15:backup=s1 --expect 2026-10-20:backup=s3 --expect 2026-10-22:backup=s4 \
  --by "Faraz (day-edit CLI, 2026-09-23)" --availability-from-seed --out <scratch>/bk/day-edit-bk.sql
node scripts/day-edit.js --set 2026-10-09:backup=s2 --set 2026-10-15:backup=s2 --set 2026-10-20:backup=s2 --set 2026-10-22:backup=s2 \
  --expect 2026-10-09:backup=s1 --expect 2026-10-15:backup=s1 --expect 2026-10-20:backup=s3 --expect 2026-10-22:backup=s4 \
  --by "Faraz (day-edit CLI, 2026-09-23)" --availability-from-seed --apply --workdir <linked dir>
#   expect: exit 0, "VERIFIED: 4 row(s) edited", snapshot id + 6 audit rows (4 day_edit + 2 lock) + days_by_tool 4, fresh plan 0 rows;
#   the dry run prints 'replacing LOCKED holder Acton (backup)' / 'Philip (backup)' for 10/20 and 10/22 - expected;
#   exit 3 = a row moved since the dry run (re-run the dry run), exit 4 = snapshot not captured (nothing written)

# (i second) the availability rows + blob - only after step (0)
node scripts/import-seed.js --dry-run --out <scratch>/bk/import-seed-bk-after.sql
#   expect: availability insert 4; surgeonRules / settings update; schedule_days update 0, the four days no longer listed
#   (BLOCKED 29 = the pre-existing publish-updated rows); time_off unchanged; groupRules=unchanged once step (0) is done
node scripts/import-seed.js --apply --workdir <linked dir>
#   expect: exit 0, "Total changes: 0 (+N blocked)" on the verify re-plan

# (iii) verification read (anon) - the four rows, Burchett's backup-only rows
#   GET schedule_days?day=in.(2026-10-09,2026-10-15,2026-10-20,2026-10-22)&select=*
#   GET availability?person_id=eq.s2&kind=eq.backup_only&select=start_date,role,note,source
#   expect: backup_id s2 + backup_locked true + source manual + updated_by the tag on all four; primaries and notes as BEFORE;
#   versions 3, 3, 2, 2; five backup_only rows 10/9, 10/12, 10/15, 10/20, 10/22, all 'seed: Burchett October list'
```

The `manual_edit` notice (above) is Faraz's call afterwards - the app's day editor would have sent it; the tool did not.

## AFTER (observed)

Applied by the orchestrator on 2026-09-23 at 08:38 Central (rows stamped 2026-09-23 13:38:51 UTC) from this tool at commit
725e36c, as ONE batch of NINE edits: the four October backups of this report plus five more Faraz asked for the same morning
(backup 11/19 -> Philip, 11/24 -> Khan - the two moves of docs/REPORT-NOV-BACKUPS-2026-09-23.md - and 12/4 -> Fierce, 12/10 -> Khan,
12/18 -> Acton - the three the December rule change invalidated). Dry run first (exit 0, nine rows, every edit `ok` on both availability
sources, soft terms only), then `--apply --workdir <linked dir>`, exit 0. Verification block of the run (verbatim):

```
days_by_tool 9; snapshot_id bed7558b-bba6-4e73-94e4-12de822a2d69; snapshots_after 12
snapshot id bed7558b-bba6-4e73-94e4-12de822a2d69; snapshots after 12; audit rows 16; rows stamped at 2026-09-23 13:38:51.195155+00: 9/9
re-read: every planned row on file, versions incremented, tag present; outside the plan: untouched, total 112; fresh plan: 0 row(s)
VERIFIED: 9 row(s) edited. No notification was queued and no mail was sent - see the preview above.
```

The nine rows as re-read with the anon key right after (day, primary, backup, source, version, updated_by):

| day | primary | backup | source | version | updated_by |
|---|---|---|---|---|---|
| 2026-10-09 | s3 Acton locked | **s2 Burchett locked** | manual | 3 | Faraz (day-edit CLI, 2026-09-23) |
| 2026-10-15 | OPEN unlocked | **s2 Burchett locked** | manual | 3 | Faraz (day-edit CLI, 2026-09-23) |
| 2026-10-20 | s6 Sarkar locked | **s2 Burchett locked** | manual | 2 | Faraz (day-edit CLI, 2026-09-23) |
| 2026-10-22 | s6 Sarkar locked | **s2 Burchett locked** | manual | 2 | Faraz (day-edit CLI, 2026-09-23) |
| 2026-11-19 | s6 Sarkar unlocked | **s4 Philip locked** | manual | 2 | Faraz (day-edit CLI, 2026-09-23) |
| 2026-11-24 | s4 Philip unlocked | **s1 Khan locked** | manual | 2 | Faraz (day-edit CLI, 2026-09-23) |
| 2026-12-04 | s3 Acton unlocked | **s5 Fierce locked** | manual | 2 | Faraz (day-edit CLI, 2026-09-23) |
| 2026-12-10 | s5 Fierce locked | **s1 Khan locked** | manual | 2 | Faraz (day-edit CLI, 2026-09-23) |
| 2026-12-18 | s1 Khan unlocked | **s3 Acton locked** | manual | 2 | Faraz (day-edit CLI, 2026-09-23) |

Primaries untouched; 10/15 primary still OPEN; `schedule_days` still 112 rows; `notifications` unchanged.

Importer apply of this seed (AFTER the edits, from main at a45ec81, 2026-09-23 13:55 UTC): `availability: insert 4` (s2 backup_only/any
2026-10-09, 10-15, 10-20, 10-22), blob surgeonRules + settings update, schedule_days 0 / 0 / 0 (the four October days read as unchanged,
29 previously published days kept), snapshot 13, and the post-apply verify line: `VERIFIED: the applied part is fully applied - a fresh plan
reads 'Total changes: 0 (+30 blocked)'`. Live availability count 48 -> 52.

## Deviations from the item's file list (each unavoidable, none weakens a gate)

- `.github/workflows/build.yml`: a step "Day-edit CLI tests" after the publish-preview step and `test/day-edit.test.js`
  in the paths filter. `test/ci.test.js` pins that every suite in package.json's chain is a workflow step and a paths
  entry; wiring the new suite into the ONE chain (as asked) fails that pin otherwise, and the pin is a safety contract
  (a suite that never runs in CI cannot fail a live deploy).
- `test/rules.test.js` (3 pins), `test/generator-regression.js` (3 pins) and two `test/importer.test.js` pins beyond the
  backup-only count: they restate the seed's October import (10/15 backup open and unlocked; Acton's October backups
  6, 8, 20; Philip's locked October 7 + 8 backups; 16 open October backups / 26 open backups; eleven open backfill
  backups; the ER-panel author's eight open backups all open). The required `existingAssignments` change moves each by exactly the
  four edits; every updated pin names BK and the new value (Philip now sits AT his backup cap of 7, so his locked
  backup-cap violations drop out of the regression's data-driven expectation - the generator agrees).
