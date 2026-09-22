# Prompt 12 — Pre-publish fixes + the 9/22 rule amendments (v2)

*Paste into Claude Code inside `<your clone>`. Implements `docs/REVIEW-2026-09-22.md` §3
(items A–H) and Faraz's 9/22 rule changes (items I–O) as recorded in `docs/SILVIS-CALL-RULES.md` (the ⟶ 9/22 marks).
Same ground rules as every prompt: report-first for RLS/destructive changes, show every edit, verify by observing, one
push at the end. Nothing here publishes a schedule. The repo's `docs/silvis-seed.json` is the canonical seed from now
on; at the end, copy the repo's `docs/` back to the OneDrive folder (repo → OneDrive), not the other way.*

```
Read docs/REVIEW-2026-09-22.md §3 and the ⟶ 9/22 amendments in docs/SILVIS-CALL-RULES.md (§1 table, §3, §6, §8) in
full. Then make the changes below in one branch (fix/prepublish-review), one commit per lettered item, and stop for my
review before pushing. For every item add or extend a test that FAILS before the change and passes after, and quote the
failing assertion in your report. Where an item changes the seed, change docs/silvis-seed.json AND re-run the importer
against the live project (dry run, show the diff, then apply) so the live blob matches.

I. BACKUP IS OPEN TO EVERYONE (9/22) — do this first; several later items depend on it.
   1. rules.js: every weekday-pattern / outreach / OR-day / Aledo / Clinton rule restricts PRIMARY only. Concretely:
      Khan hardNeverWeekdaysRoles = ["primary"]; Burchett recurring whitelist + governed months → primary only (backup
      any day); Acton recurringUnavailable → primary only; Philip Aledo week (soft), day-before-Aledo (hard) and
      availableWeeks (hard) → primary only; Fierce weekday pattern → Tue/Thu/Fri backup true (primary unchanged: Mon
      backup-only, Fri only as a block start); Sarkar → backup allowed inside her windows. Vacations, East busy days
      (primary only, as now), holiday opt-outs, "holds other role today" and derived-week locks still apply to backup.
   2. Add surgeonRules.<id>.backupOptOut (boolean, default false) and honor it as a hard rule for backup; add it to the
      Setup → Rules editor with the label "Does not take backup". Nobody has opted out today.
   3. Acton's soft avoids (Tuesday; Sunday before a 2nd/4th Monday) stay at weight medium for primary and weight low for backup.

J. EQUAL-SHARE FAIRNESS (9/22) — generator.js genTargets + score
   1. Replace the "neutral term" for monthlyTarget: null with an equal share: for each month, primaryShare =
      (primary slots not locked and not Sarkar's) / active pool members; backupShare likewise for backup slots. Every
      pool member (s1–s5) gets both targets unless a numeric monthlyTarget overrides. Sarkar (s6) keeps her window
      target (item N). Remove I.neutralTerm and the "explicit null = neutral" branch.
   2. Score: split targetDeviation into primaryDeviation and backupDeviation (both in the lexicographic score, primary
      first), and keep weekendSpread / holidaySpread.
   3. Smoothing moves must now consider backup slots too (move a backup day from someone above their backup share to
      someone below it, through eligibility), not only primary.
   4. Diagnostics: impliedTargets shows primaryShare / backupShare per member per month and "allowed by rules" counts,
      so a shortfall caused by availability is visible.

K. CAPS COUNT PRIMARY ONLY (9/22) — rules.js monthly cap
   1. monthlyCap.total, capPreferred and Fierce's 14 (countsEastDays) count PRIMARY days only (Silvis primary + East
      primary week days for Fierce). Backup days never count toward a total cap.
   2. Philip's explicit backupCap (≤7 days, ≤1 weekend) stays as a separate, explicit rule.
   3. Seed: groupRules.defaultMonthlyCap = { primary: 8 }; s2.monthlyCap = { primary: 8, preferred: 7 }; s5.monthlyCap =
      { primary: 14, countsEastDays: true }; document in the seed notes.

L. KHAN = WEEKEND PRIMARY WHEN AVAILABLE (9/22)
   1. Implement surgeonRules.s1.primaryContribution = "weekends": in weekend-unit scoring, Khan as PRIMARY of a
      block scores a bonus (weight medium) and Khan as weekend BACKUP scores a penalty of the same size, so when East
      allows, he is the primary and someone else backs him up.
   2. East cross-reference must cover ALL Davenport call for FAK: dayCall (Mon–Sat), nights.mon/tue/wed/thu, nights.wknd
      (Fri + Sun), holidayCoverage, and East backup weeks (isBackup rows count as busy for primary). Add a
      rules.test.js case per source. Keep backup allowed on East days.

M. OUTSIDE SURGEONS / INTERNAL LOCUMS (9/22)
   1. Roster entries may carry type: "external" (name, code, fullName, active) — no account required. The generator
      never assigns them (poolMember false, hard). The day editor lists them under a separate "Outside surgeons"
      heading for both roles; assigning one is a manual, locked assignment with source "manual-external".
   2. Setup → Roster: "Add outside surgeon" (name + code; codes must stay unique; a note field, operational only).
   3. Totals: an "Outside surgeons" section with their day counts; the pool's implied shares subtract their days.
   4. Exports (ICS, share page, printable, ER panel) render their name like anyone else's; calendar-sync serves them by
      code. Keep the legacy externalCover field working for the imported Atwell week; do not migrate it.

N. SARKAR (9/22)
   1. daysPerWindowWeek counts PRIMARY only: min 3 (hard if the window week is fully inside the range), max 4 (hard).
   2. Alternate days when possible: soft penalty (weight medium) for two consecutive Sarkar primaries; hard max
      consecutive stays 2.
   3. Friday and Saturday are allowed as STANDALONE primary days inside a window (remove Fri from her hardNever;
      weekendStyle "daily"); she never forms or joins a Fri–Sun block or a split; Sunday stays out (no window has one).
   4. Backup inside her windows allowed, not targeted, not counted toward the 3–4.
   5. Add the handoff diagnostic the seed promises: the day after each Sarkar primary must have a primary who is not
      Sarkar (warning in diagnostics, not a hard rule).

A. CONSECUTIVE-DAY RULES (review item A)
   1. Make the holiday-unit exemption PER SURGEON: replace groupRules.holidays.unitExemptFromMaxConsecutive with an
      opt-in surgeonRules.<id>.holidayUnitCountsAsOneDay (default false); set it true for s1 only (his 4-day
      Thanksgiving unit vs his max of 3). Everyone else counts real days.
   2. Primary-only maxConsecutiveDays stays HARD as stated (Burchett 2, Sarkar 2, Khan 3, Acton 3, Philip 4, Fierce 7).
      Add surgeonRules.<id>.maxConsecutiveAnyRole as a SOFT limit (backup is standby, 9/22): Burchett 3, Sarkar 2,
      Khan 4, Acton 4, Philip 4, Fierce 7, with a "long-run" penalty that grows with run length beyond it.
   3. talliesFor and the preview "Max consec." column report the real run lengths (primary-only and any-role), with no
      unit collapse unless the surgeon opted in.
   4. Regression: add the milestone range 2026-11-02 → 2027-01-03 as R4 and assert primary-only run limits for ALL six
      across the whole range (no month-boundary cut). With today's rules R4 must FAIL for Burchett at 12/30–1/1 before
      the fix and pass after.

B. THANKSGIVING PROVENANCE (data only)
   1. In the seed and rules doc change "CONFIRMED (Faraz 9/21 evening)" to "recorded by Claude Code on 2026-09-22 as an
      evening decision; the daytime record said pending; Faraz to re-confirm before publish"; add
      "awaitingConfirmation": true on the four existingAssignments rows; the day editor shows a "confirm" badge on locked
      days carrying that flag.
   2. If Faraz confirms in this session, remove the flag; if he declines, unlock the four days (primary null, locked false)
      and restore the Thanksgiving unit to Thu 11/26 only.

C. EAST FEED / FORECAST (review item C)
   1. A forecast probability is never consulted for a day inside published East coverage; published rows win. Test:
      published-free day + stale forecast 0.9 → eligible.
   2. refreshEastFeed deletes east_forecast rows now inside published coverage and records the count in east.refresh.
   3. east_overrides busy:false clears a forecast-busy day (apply overrides AFTER the forecast).
   4. Build the conflict report: after a refresh, for every PUBLISHED schedule_days row, list days where the new East
      data makes the assignment ineligible (Khan primary on an East day; a Fierce derived week that no longer matches).
      Show it in the East feed panel and in diagnostics.eastConflicts.
   5. scripts/east-forecast.js reads groupRules.eastFeed.forecast.runs (200) and writes the run count into
      docs/east-forecast-latest.json; fix the Setup sentence to describe what actually happens.

D. TRADES — SERVER SIDE (sql/schema.sql; report-first, then apply to the live project)
   1. BEFORE INSERT trigger on shift_trade_requests: non-scheduler callers get status forced to 'pending',
      from_surgeon_id = silvis_person_id(), submitted_at = now(), decided_at = null; reject from = to.
   2. apply_trade(): before writing, check (a) to_surgeon_id is an active roster id (pool or external),
      (b) neither leg day is inside a time_off range of the receiving surgeon, (c) neither leg is locked unless the
      caller is scheduler (then clear the lock flag on transfer), (d) the receiver does not already hold the other role
      that day. Raise TRADE_INELIGIBLE with the reason.
   3. scripts/verify-rls.sh: insert with status 'accepted' as a surgeon → lands as 'pending'; apply_trade on a vacation
      day → error.

E. FULL WEEK — covered by A.2 (Philip soft any-role 4 + long-run penalty).

F. PERSONAL WORDING IN ANON-READABLE DATA (importer.js)
   1. Scrub EVERY note/*Note string in surgeonRules and groupRules before they reach call_schedule_data: map to generic
      categories ("outreach", "family", "personal", "OR day", "preference"); refuse import if any note still contains a
      denylist word (family, wife, husband, kid, school, medical, maternity, hosts, illness, funeral). Tests for the two
      live offenders ("[removed]", "[removed]").
   2. Re-run the importer against the live project (dry run → apply); verify with an anon GET that neither phrase remains.

G. REGRESSION SCOPE — covered by A.4; also assert for each surgeon that the preview's "Max consec." equals the harness's
   computed run.

H. DAY-BEFORE RULES — under the 9/22 backup rule these stay PRIMARY-ONLY (a standby backup the day before a vacation or
   an Aledo day is acceptable). Make that explicit in the seed notes and the rules doc; no code change; keep the tests
   that pin primary-only.

O. THEME — University of Illinois blue and orange, easy on the eyes (9/22)
   1. app-styles.js tokens (light): navy #13294B (Illini Blue) for the header bar, nav, primary buttons and titles;
      orange used as an ACCENT only — #FF5F05 (Illini Orange) for badges, active tab underline, "today" ring and the
      primary call-to-action, with a darkened #C2410C wherever orange is text on white (contrast ≥ 4.5:1) and a soft
      tint #FFE8DB for orange backgrounds; page background #F6F8FB; card white; body text #1F2A3A; muted #5B6B82;
      OPEN stays red (#B91C1C) so it never competes with the accent.
   2. Dark mode: background #0B1A33, surface #13294B, text #E6ECF5, accent #FF8A4C, muted #9FB0C8.
   3. Per-surgeon colors: six that read against both themes and do not fight the brand — navy #1F3A6B (Khan),
      orange #D9561A (Burchett), teal #0F766E (Acton), plum #6B3FA0 (Philip), olive #6B7F1A (Fierce), slate #475569
      (Sarkar); outside surgeons grey #737373 with a dashed border. Keep primary/backup as text weight (P bold, B
      regular), not color.
   4. manifest.json theme_color #13294B; recolor the icons to navy with an orange mark so the Silvis PWA is
      distinguishable from Davenport's on a phone. Run the Playwright smoke harness in both themes and attach the
      screenshots; check every text/background pair with an automated contrast check (fail < 4.5:1 for body text).

Small items (one commit): pass asBlockMember through the trade path and the day editor so Fierce can receive a Fri–Sun
block; make the day editor fail CLOSED when eligibility throws (show the error, disable Save); do not waive a surgeon's
EXPLICIT dated availability list on holiday-unit days (Burchett's December list omits 12/24 on purpose) — only the
recurring weekday patterns are waived; align the seed's forecast.runs with reality; update docs/SILVIS-BUILD-GUIDE.md §5,
§6 and §8 to the 9/22 rules (backup open, equal shares, caps primary-only, outside surgeons, Sarkar pattern, theme).

Then: npm test and npm run smoke; regenerate the preview with scripts/preview-generate.js (seed 7, bestOf 200) into
docs/PREVIEW-2026-11-02-to-2027-01-03.md; write docs/PREVIEW-DIFF-2026-09-22.md listing every day whose primary or
backup changed versus the previous preview, the new per-surgeon tallies (primary, backup, real run lengths, share vs
allowed), and the open slots (expect zero open backups now). Copy the repo's docs/ to the OneDrive folder (byte copy).
Stop before pushing.
```
