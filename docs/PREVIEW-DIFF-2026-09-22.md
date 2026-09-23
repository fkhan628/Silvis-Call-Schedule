# Preview diff - preview-before-2026-09-22.json -> PREVIEW-2026-11-02-to-2027-01-03.json

*Written by scripts/preview-diff.js. Before: seed 7, bestOf 200, generated 2026-09-22T07:34:05.408Z. After: seed 7, bestOf 200, generated 2026-09-23T05:28:27.631Z. Range 2026-11-02 -> 2027-01-03. Run lengths below are REAL consecutive calendar days computed from the schedule (no holiday-unit collapse).*

## Summary

| Metric | Before | After |
|---|---|---|
| Open primary days | 0 | 0 |
| Open backup days | 3 | 0 |
| Hard violations (diagnostics) | 0 | 0 |
| Soft penalty sum (diagnostics) | 122 | 70 |
| Days whose primary changed | | 13 |
| Days whose backup changed | | 47 |

## Per-surgeon tallies (whole range)

| Surgeon | Primary before -> after | Backup before -> after | Weekend days | Longest primary run (from) | Longest any-role run (from) |
|---|---|---|---|---|---|
| Khan | 9 -> **12** | 21 -> **10** | 22 -> 13 | 4 -> **5** (11/25) | 6 -> **5** (11/25) |
| Burchett | 13 -> **13** | 4 -> **10** | 9 -> 11 | 3 -> **2** (11/7) | 5 -> **3** (11/2) |
| Acton | 13 -> **16** | 14 -> **9** | 7 -> 7 | 2 -> **3** (11/4) | 4 -> **5** (11/2) |
| Philip | 11 -> **9** | 4 -> **13** | 6 -> 11 | 4 -> **2** (11/9) | 6 -> **4** (11/26) |
| Fierce | 12 -> **9** | 15 -> **21** | 9 -> 12 | 7 -> **7** (12/7) | 7 -> **8** (11/9) |
| Sarkar | 5 -> **4** | 2 -> **0** | 1 -> 0 | 1 -> **1** (11/17) | 2 -> **1** (11/17) |

## Share vs allowed (after)

*equal shares per role (J): pool = active, poolMember !== false, no availableWindows, not external; primaryShare = (open in-range primary slots - the windows surgeons' reserved primaries) / pool size; backupShare = open in-range backup slots / pool size; pool member primaryTarget = max(lockedHeld.primary, min(primaryShare, clipPrimary)) with clipPrimary = min(capPreferred, capPrimary - 1) - East primary-week days not held as Silvis primary (K; null when uncapped), backupTarget = max(lockedHeld.backup, min(backupShare, backupCap.perMonthDays)); a numeric monthlyTarget sets the primary target, { primary, backup } sets each, explicit null = equal share; windows + daysPerWindowWeek.target = target x window weeks of the month the range touches, primary only, no backup target, no target in a month without a window week (N); everyone else: no targets; allowedPrimary / allowedBackup = open in-range slots where eligibility passes on the lock-only schedule (a weekend day of a full unit as a block member, a holiday day as a unit candidate); lockedHeld and the targets are whole-calendar-month figures even where the range only touches the month (rangeDays); placeableAtTarget = sum of max(0, target - lockedHeld) per role - below the open slots where a locked floor or a clip pins a member, since the flat share is not redistributed*

### 2026-11

```
{
 "primaryOpen": 10,
 "backupOpen": 15,
 "poolSize": 5,
 "reservedForWindows": 2,
 "primaryShare": 1.6,
 "backupShare": 3,
 "rangeDays": 29,
 "placeableAtTarget": {
  "primary": 4.2,
  "backup": 7
 },
 "windowTarget": {
  "s6": 2
 },
 "windowWeeks": {
  "s6": 1
 },
 "members": {
  "s1": {
   "primaryTarget": 5,
   "backupTarget": 3,
   "lockedHeld": {
    "primary": 5,
    "backup": 0
   },
   "clipPrimary": null,
   "eastPrimaryDays": 0,
   "allowedPrimary": 5,
   "allowedBackup": 10
  },
  "s2": {
   "primaryTarget": 6,
   "backupTarget": 4,
   "lockedHeld": {
    "primary": 6,
    "backup": 4
   },
   "clipPrimary": 7,
   "eastPrimaryDays": 0,
   "allowedPrimary": 0,
   "allowedBackup": 0
  },
  "s3": {
   "primaryTarget": 8,
   "backupTarget": 3,
   "lockedHeld": {
    "primary": 8,
    "backup": 2
   },
   "clipPrimary": null,
   "eastPrimaryDays": 0,
   "allowedPrimary": 2,
   "allowedBackup": 5
  },
  "s4": {
   "primaryTarget": 1.6,
   "backupTarget": 3,
   "lockedHeld": {
    "primary": 1,
    "backup": 0
   },
   "clipPrimary": 7,
   "eastPrimaryDays": 0,
   "allowedPrimary": 5,
   "allowedBackup": 15
  },
  "s5": {
   "primaryTarget": 1.6,
   "backupTarget": 8,
   "lockedHeld": {
    "primary": 0,
    "backup": 8
   },
   "clipPrimary": 6,
   "eastPrimaryDays": 7,
   "allowedPrimary": 2,
   "allowedBackup": 15
  },
  "s6": {
   "primaryTarget": 2,
   "backupTarget": null,
   "lockedHeld": {
    "primary": 0,
    "backup": 0
   },
   "clipPrimary": null,
   "eastPrimaryDays": 0,
   "allowedPrimary": 2,
   "allowedBackup": 2
  }
 }
}
```

### 2026-12

```
{
 "primaryOpen": 24,
 "backupOpen": 31,
 "poolSize": 5,
 "reservedForWindows": 2,
 "primaryShare": 4.4,
 "backupShare": 6.2,
 "rangeDays": 31,
 "placeableAtTarget": {
  "primary": 19.6,
  "backup": 31
 },
 "windowTarget": {
  "s6": 2
 },
 "windowWeeks": {
  "s6": 1
 },
 "members": {
  "s1": {
   "primaryTarget": 4.4,
   "backupTarget": 6.2,
   "lockedHeld": {
    "primary": 0,
    "backup": 0
   },
   "clipPrimary": null,
   "eastPrimaryDays": 0,
   "allowedPrimary": 12,
   "allowedBackup": 31
  },
  "s2": {
   "primaryTarget": 4.4,
   "backupTarget": 6.2,
   "lockedHeld": {
    "primary": 0,
    "backup": 0
   },
   "clipPrimary": 7,
   "eastPrimaryDays": 0,
   "allowedPrimary": 12,
   "allowedBackup": 31
  },
  "s3": {
   "primaryTarget": 4.4,
   "backupTarget": 6.2,
   "lockedHeld": {
    "primary": 0,
    "backup": 0
   },
   "clipPrimary": null,
   "eastPrimaryDays": 0,
   "allowedPrimary": 17,
   "allowedBackup": 31
  },
  "s4": {
   "primaryTarget": 4.4,
   "backupTarget": 6.2,
   "lockedHeld": {
    "primary": 0,
    "backup": 0
   },
   "clipPrimary": 7,
   "eastPrimaryDays": 0,
   "allowedPrimary": 11,
   "allowedBackup": 31
  },
  "s5": {
   "primaryTarget": 7,
   "backupTarget": 6.2,
   "lockedHeld": {
    "primary": 7,
    "backup": 0
   },
   "clipPrimary": 13,
   "eastPrimaryDays": 0,
   "allowedPrimary": 12,
   "allowedBackup": 24
  },
  "s6": {
   "primaryTarget": 2,
   "backupTarget": null,
   "lockedHeld": {
    "primary": 0,
    "backup": 0
   },
   "clipPrimary": null,
   "eastPrimaryDays": 0,
   "allowedPrimary": 5,
   "allowedBackup": 5
  }
 }
}
```

### 2027-01

```
{
 "primaryOpen": 3,
 "backupOpen": 3,
 "poolSize": 5,
 "reservedForWindows": 0,
 "primaryShare": 0.6,
 "backupShare": 0.6,
 "rangeDays": 3,
 "placeableAtTarget": {
  "primary": 3,
  "backup": 3
 },
 "windowTarget": {
  "s6": 0
 },
 "windowWeeks": {
  "s6": 0
 },
 "members": {
  "s1": {
   "primaryTarget": 0.6,
   "backupTarget": 0.6,
   "lockedHeld": {
    "primary": 0,
    "backup": 0
   },
   "clipPrimary": null,
   "eastPrimaryDays": 0,
   "allowedPrimary": 3,
   "allowedBackup": 3
  },
  "s2": {
   "primaryTarget": 0.6,
   "backupTarget": 0.6,
   "lockedHeld": {
    "primary": 0,
    "backup": 0
   },
   "clipPrimary": 7,
   "eastPrimaryDays": 0,
   "allowedPrimary": 3,
   "allowedBackup": 3
  },
  "s3": {
   "primaryTarget": 0.6,
   "backupTarget": 0.6,
   "lockedHeld": {
    "primary": 0,
    "backup": 0
   },
   "clipPrimary": null,
   "eastPrimaryDays": 0,
   "allowedPrimary": 3,
   "allowedBackup": 3
  },
  "s4": {
   "primaryTarget": 0.6,
   "backupTarget": 0.6,
   "lockedHeld": {
    "primary": 0,
    "backup": 0
   },
   "clipPrimary": 7,
   "eastPrimaryDays": 0,
   "allowedPrimary": 3,
   "allowedBackup": 3
  },
  "s5": {
   "primaryTarget": 0.6,
   "backupTarget": 0.6,
   "lockedHeld": {
    "primary": 0,
    "backup": 0
   },
   "clipPrimary": 13,
   "eastPrimaryDays": 0,
   "allowedPrimary": 1,
   "allowedBackup": 3
  },
  "s6": {
   "primaryTarget": null,
   "backupTarget": null,
   "lockedHeld": {
    "primary": 0,
    "backup": 0
   },
   "clipPrimary": null,
   "eastPrimaryDays": 0,
   "allowedPrimary": 0,
   "allowedBackup": 0
  }
 }
}
```

## Every day whose primary or backup changed

| Day | Role | Before | After | Locked after |
|---|---|---|---|---|
| 2026-11-02 Mon | backup | Khan | **Burchett** | yes |
| 2026-11-04 Wed | primary | Fierce | **Acton** | yes |
| 2026-11-04 Wed | backup | Khan | **Burchett** | yes |
| 2026-11-05 Thu | backup | OPEN | **Khan** |  |
| 2026-11-06 Fri | primary | Burchett | **Acton** | yes |
| 2026-11-06 Fri | backup | Khan | **Burchett** | yes |
| 2026-11-07 Sat | primary | Acton | **Burchett** | yes |
| 2026-11-14 Sat | primary | Philip | **Acton** | yes |
| 2026-11-15 Sun | primary | Philip | **Acton** | yes |
| 2026-11-16 Mon | backup | Sarkar | **Fierce** | yes |
| 2026-11-18 Wed | primary | Fierce | **Acton** | yes |
| 2026-11-18 Wed | backup | Acton | **Burchett** | yes |
| 2026-11-19 Thu | backup | OPEN | **Fierce** |  |
| 2026-11-20 Fri | backup | Khan | **Fierce** |  |
| 2026-11-21 Sat | primary | Sarkar | **Khan** |  |
| 2026-11-21 Sat | backup | Khan | **Fierce** |  |
| 2026-11-22 Sun | primary | Burchett | **Khan** |  |
| 2026-11-22 Sun | backup | Khan | **Fierce** |  |
| 2026-11-23 Mon | backup | Philip | **Acton** |  |
| 2026-11-24 Tue | backup | Acton | **Fierce** |  |
| 2026-11-25 Wed | primary | Fierce | **Khan** | yes |
| 2026-11-25 Wed | backup | Khan | **Fierce** |  |
| 2026-11-26 Thu | backup | Fierce | **Philip** |  |
| 2026-11-27 Fri | backup | Fierce | **Philip** |  |
| 2026-11-28 Sat | backup | Fierce | **Philip** |  |
| 2026-11-29 Sun | backup | Fierce | **Philip** |  |
| 2026-11-30 Mon | backup | Khan | **Fierce** |  |
| 2026-12-01 Tue | backup | Acton | **Khan** |  |
| 2026-12-03 Thu | backup | OPEN | **Khan** |  |
| 2026-12-04 Fri | backup | Khan | **Burchett** |  |
| 2026-12-05 Sat | backup | Khan | **Acton** |  |
| 2026-12-06 Sun | backup | Khan | **Burchett** |  |
| 2026-12-07 Mon | backup | Khan | **Philip** |  |
| 2026-12-09 Wed | backup | Burchett | **Philip** |  |
| 2026-12-10 Thu | backup | Acton | **Burchett** |  |
| 2026-12-11 Fri | backup | Khan | **Philip** |  |
| 2026-12-12 Sat | backup | Khan | **Philip** |  |
| 2026-12-13 Sun | backup | Khan | **Philip** |  |
| 2026-12-14 Mon | backup | Sarkar | **Acton** |  |
| 2026-12-16 Wed | primary | Acton | **Fierce** |  |
| 2026-12-16 Wed | backup | Fierce | **Acton** |  |
| 2026-12-17 Thu | backup | Acton | **Philip** |  |
| 2026-12-18 Fri | backup | Acton | **Burchett** |  |
| 2026-12-20 Sun | backup | Acton | **Burchett** |  |
| 2026-12-22 Tue | backup | Acton | **Fierce** |  |
| 2026-12-23 Wed | primary | Fierce | **Burchett** |  |
| 2026-12-23 Wed | backup | Khan | **Acton** |  |
| 2026-12-24 Thu | backup | Philip | **Fierce** |  |
| 2026-12-25 Fri | backup | Philip | **Fierce** |  |
| 2026-12-26 Sat | backup | Khan | **Fierce** |  |
| 2026-12-27 Sun | backup | Khan | **Fierce** |  |
| 2026-12-28 Mon | primary | Philip | **Burchett** |  |
| 2026-12-28 Mon | backup | Fierce | **Khan** |  |
| 2026-12-29 Tue | backup | Acton | **Khan** |  |
| 2026-12-30 Wed | primary | Burchett | **Philip** |  |
| 2026-12-30 Wed | backup | Fierce | **Acton** |  |
| 2026-12-31 Thu | backup | Acton | **Khan** |  |
| 2027-01-01 Fri | backup | Acton | **Khan** |  |
| 2027-01-02 Sat | backup | Burchett | **Philip** |  |
| 2027-01-03 Sun | backup | Burchett | **Philip** |  |

## Open slots after

_None._

## Open slots before

- 2026-11-05 Thu backup
- 2026-11-19 Thu backup
- 2026-12-03 Thu backup

## Generator warnings (after)

- s5 cap counts East days but the East feed does not cover all of 2026-11: only his Silvis primaries and the derived East primary-week days were counted for that month
- s5 cap counts East days but the East feed does not cover all of 2026-12: only his Silvis primaries and the derived East primary-week days were counted for that month
- s5 cap counts East days but the East feed does not cover all of 2027-01: only his Silvis primaries and the derived East primary-week days were counted for that month
- 1 locked slot(s) break a rule - kept as facts, see lockViolations
