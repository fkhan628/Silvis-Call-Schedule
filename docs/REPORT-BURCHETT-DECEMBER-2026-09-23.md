# Burchett December backups off his list — eligible replacements (2026-09-23, read-only)

*Faraz, 9/23 morning: Burchett's December list governs **both roles** (his 9/17 email: "the dates I can take primary call (or backup)"). The seed's `s2.explicitListMonths` December entry is now `{ month: "2026-12", roles: ["primary", "backup"] }` (dates unchanged). This report lists every live December day where he holds **backup** off that list and who may replace him. Faraz reassigns them in the day editor; nothing was regenerated and nothing was written — one anon GET per table (`schedule_days`, `time_off`, `availability`, `east_feed`, `east_forecast`, `east_overrides`, `call_schedule_data`).*

**Context built exactly as `scripts/preview-generate.js` builds it** (live rows → `helpers.dayRowToAssignment` → `rules.buildContext`; East busy days / forecast / overrides / derived weeks from `east-feed.js`), except that `surgeonRules`, `groupRules` and `holidays` come from the **modified** `docs/silvis-seed.json` (through `test/seed-adapter.js`, the importer's own transform) instead of the live blob, so the December object entry is in force; the roster is the live one. The live schedule (all 112 rows) is the day map, so consecutive-day, weekend-unit and same-day-primary checks see the published holders. `buildContext` warnings: none. Blob `updated_at` 2026-09-23T12:37:02.73257+00:00.

## Live December rows (31)

| Day | Wd | Primary | Backup | Source | Burchett backup on his list? |
|---|---|---|---|---|---|
| 2026-12-01 | Tue | Burchett | Khan | generated |  |
| 2026-12-02 | Wed | Fierce | Khan | generated |  |
| 2026-12-03 | Thu | Acton | Khan | generated |  |
| 2026-12-04 | Fri | Acton | Burchett | generated | **NO** |
| 2026-12-05 | Sat | Burchett | Acton | generated |  |
| 2026-12-06 | Sun | Acton | Burchett | generated | yes |
| 2026-12-07 | Mon | Fierce (L) | Philip | east-derived |  |
| 2026-12-08 | Tue | Fierce (L) | Philip | east-derived |  |
| 2026-12-09 | Wed | Fierce (L) | Philip | east-derived |  |
| 2026-12-10 | Thu | Fierce (L) | Burchett | east-derived | **NO** |
| 2026-12-11 | Fri | Fierce (L) | Philip | east-derived |  |
| 2026-12-12 | Sat | Fierce (L) | Philip | east-derived |  |
| 2026-12-13 | Sun | Fierce (L) | Philip | east-derived |  |
| 2026-12-14 | Mon | Burchett | Acton | generated |  |
| 2026-12-15 | Tue | Sarkar | Acton | generated |  |
| 2026-12-16 | Wed | Fierce | Acton | generated |  |
| 2026-12-17 | Thu | Sarkar | Philip | generated |  |
| 2026-12-18 | Fri | Khan | Burchett | generated | **NO** |
| 2026-12-19 | Sat | Khan | Burchett | generated | yes |
| 2026-12-20 | Sun | Khan | Burchett | generated | yes |
| 2026-12-21 | Mon | Acton | Fierce | generated |  |
| 2026-12-22 | Tue | Philip | Fierce | generated |  |
| 2026-12-23 | Wed | Burchett | Acton | generated |  |
| 2026-12-24 | Thu | Acton | Fierce | generated |  |
| 2026-12-25 | Fri | Acton | Fierce | generated |  |
| 2026-12-26 | Sat | Philip | Fierce | generated |  |
| 2026-12-27 | Sun | Philip | Fierce | generated |  |
| 2026-12-28 | Mon | Burchett | Khan | generated |  |
| 2026-12-29 | Tue | Philip | Khan | generated |  |
| 2026-12-30 | Wed | Philip | Acton | generated |  |
| 2026-12-31 | Thu | Burchett | Khan | generated |  |

Burchett holds backup on 12-04, 12-06, 12-10, 12-18, 12-19, 12-20; off his list: **12-04, 12-10, 12-18** — exactly the three Faraz expected (12/4, 12/10, 12/18). His December primaries (12-01, 12-05, 12-14, 12-23, 12-28, 12-31) are all on the list: true.

## Backup counts, Oct 7 – Jan 3 (live rows, for fairness)

| Surgeon | Backup days | Primary days |
|---|---|---|
| Khan (s1) | 15 | 13 |
| Burchett (s2) | 13 | 17 |
| Acton (s3) | 12 | 25 |
| Philip (s4) | 20 | 17 |
| Fierce (s5) | 29 | 10 |
| Sarkar (s6) | 0 | 6 |

## Eligible replacements for BACKUP (`rules.eligibility(ctx, day, "backup", id)` for every active roster id)

### 2026-12-04 (Fri) — primary Acton, backup now Burchett; day before Acton / Khan, day after Burchett / Acton

| Candidate | Verdict | Hard rules | Soft warnings (reason: weight) | Backup days Oct 7 – Jan 3 |
|---|---|---|---|---|
| Khan (s1) | **eligible** | — | back-to-back-weekend: 3, pattern-mismatch:block: 3, weekend-backup: 3 | 15 |
| Burchett (s2) | ineligible | whitelist-month | — | 13 |
| Acton (s3) | ineligible | holds-other-role | — | 12 |
| Philip (s4) | ineligible | backup-cap:7, backup-weekend-cap:1 | — | 20 |
| Fierce (s5) | **eligible** | — | back-to-back-weekend: 3, pattern-mismatch:block: 3 | 29 |
| Sarkar (s6) | ineligible | outside-window | — | 0 |

### 2026-12-10 (Thu) — primary Fierce (locked), backup now Burchett; day before Fierce / Philip, day after Fierce / Philip

| Candidate | Verdict | Hard rules | Soft warnings (reason: weight) | Backup days Oct 7 – Jan 3 |
|---|---|---|---|---|
| Khan (s1) | **eligible** | — | — | 15 |
| Burchett (s2) | ineligible | whitelist-month | — | 13 |
| Acton (s3) | **eligible** | — | — | 12 |
| Philip (s4) | ineligible | backup-cap:7 | — | 20 |
| Fierce (s5) | ineligible | derived-lock:primary, holds-other-role | — | 29 |
| Sarkar (s6) | ineligible | outside-window | — | 0 |

### 2026-12-18 (Fri) — primary Khan, backup now Burchett; day before Sarkar / Philip, day after Khan / Burchett

| Candidate | Verdict | Hard rules | Soft warnings (reason: weight) | Backup days Oct 7 – Jan 3 |
|---|---|---|---|---|
| Khan (s1) | ineligible | holds-other-role | — | 15 |
| Burchett (s2) | ineligible | whitelist-month | — | 13 |
| Acton (s3) | **eligible** | — | back-to-back-weekend: 3 | 12 |
| Philip (s4) | ineligible | backup-cap:7, backup-weekend-cap:1 | — | 20 |
| Fierce (s5) | **eligible** | — | back-to-back-weekend: 3, pattern-mismatch:block: 3 | 29 |
| Sarkar (s6) | **eligible** | — | backup-after-primary: 1 | 0 |

*Verdicts are standalone eligibility on the published schedule: the current holder (Burchett) is included to show the new rule biting (`whitelist-month`); the same-day primary is excluded by `holds-other-role`. Soft warnings are the engine's own reasons and weights (Setup → Rules → weights). Fairness is Faraz's call — the counts are the running tally of the published Oct 7 – Jan 3 rows. Nothing here was written to the database.*
