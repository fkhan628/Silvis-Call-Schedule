# Prompt 12 — Pre-publish fixes + the 9/22 rule amendments (v4)

*Paste into Claude Code inside `<your clone>`. Implements `docs/REVIEW-2026-09-22.md` §3
(items A–H) and Faraz's 9/22 rule changes (items I–O) as recorded in `docs/SILVIS-CALL-RULES.md` (the ⟶ 9/22 marks),
plus two UI items from his first look at the live app (P: header without "cardiothoracic"; Q: no red OPEN before
today). v3 added P and Q, v4 adds R (orange opening + SSC icon) — if Prompt 12 v2 already ran, paste only the "Already ran v2?" block at the bottom.*
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
      live offenders (the two notes the review named).
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
   4. SUPERSEDED by item R below (Faraz 9/22 evening): the opening is ORANGE, not navy, and the icons are supplied.
      Run the Playwright smoke harness in both themes and attach the screenshots; check every text/background pair
      with an automated contrast check (fail < 4.5:1 for body text).

P. PANEL HEADER — drop "cardiothoracic" (Faraz 9/22, after seeing the live app)
   1. The primary column of the week-rows table under the calendar and of the ER Call Panels export is headed
      "TRAUMA & CARDIOTHORACIC SURGERY TRAUMA" (copied from the ER-panel author's sheet). Faraz wants it to read just "TRAUMA".
      New header row everywhere: MON/SUN DATES | TRAUMA | TRAUMA BACKUP.
   2. Change every occurrence together: index-source.html (week-rows <thead>, ~line 4006), helpers.js (week-rows share
      page ~634, ER panel HTML ~966 and the tab-separated text flavour ~978, plus the doc comment ~933), the tests that
      pin the header text (test/exports.test.js 152–154, 217, 261; test/ui/smoke.mjs 644, 727, 777–778;
      test/ui/exports-standalone.mjs 80), and the two docs that quote it (docs/SILVIS-BUILD-GUIDE.md §9 ER export line,
      docs/CLAUDE-CODE-PROMPTS.md Prompt 9). Nothing else about the layout changes: same three columns, same order,
      same collapsing, same red open entries, same Copy-for-Word HTML/plain-text flavours. `grep -ri cardiothoracic`
      over the repo must return nothing except this prompt's own history.

Q. NO "OPEN" ON DAYS BEFORE TODAY (Faraz 9/22)
   1. Today the month grid, the week-rows table and the exports paint every unassigned day red "OPEN" — including days
      before today (September before the 9/14 import start, and any past day nobody covered). Those are history, not
      work to do, and the red is noise. Rule: an unassigned slot is OPEN only from today (Central time, the same
      America/Chicago clock the app already uses for shifts) forward; before today it renders BLANK.
   2. Implement it once, in helpers.js, not per call site: give buildWeekRows an opts.today (YYYY-MM-DD); when set, an
      unassigned day earlier than it produces NO entry at all (so a past week nobody covered is an empty cell, and a
      past partial run collapses normally for the assigned days). Add a small pure helper, e.g.
      slotIsOpen(dateStr, holder, today), that the month grid's SlotLine, the "only OPEN" checkbox filter, the
      calendar-month legend counts, the share page, the printable month and the ER Call Panels export all consult, so
      "open" means the same thing everywhere. The coverage-at-a-glance strip already looks only at the next 60 days —
      confirm it is unaffected. The day editor still lets a scheduler assign a past day (it just shows the empty
      select, no red badge). The office-notifications diff and the generator do not change: they never look before
      today, and "no row" and "OPEN row" already compare equal.
   3. Grid rendering for a past blank slot: the role letter and a muted "—" (or nothing), no red, no pill. Week rows:
      no "M/D OPEN" line. Exports: the cell just has no entry for that day.
   4. Tests: extend test/exports.test.js and test/week-rows (or wherever buildWeekRows is pinned) with a fixture whose
      range straddles a fixed "today" — days before it with no row yield no entry, the day itself and later still yield
      "M/D OPEN"; a smoke check that September's week rows carry no data-kind="open" before today and still carry it
      for 10/15. Do not change the meaning of open slots in generator diagnostics or the preview report.

R. ORANGE OPENING + SSC ICON (Faraz 9/22, after installing the PWA next to DSG)
   1. The three icon files in the repo root (icon-512.png, icon-192.png, apple-touch-icon.png) are still Davenport's
      blue "DSG" tiles. Replace them byte-for-byte with the files in the OneDrive folder `assets\icons-ssc\` (Illini
      orange #FF5F05, white "SSC", generated 9/22; same three sizes 512/192/180, maskable-safe). Do not regenerate or
      restyle them.
   2. manifest.json: theme_color and background_color both #FF5F05 (the splash and the Android title bar open orange);
      keep name/short_name. index-source.html <meta name="theme-color"> #FF5F05 to match. Bump nothing by hand — CI
      versions the build; note in the report that installed PWAs pick the new icon up on their next manifest refresh
      (users may need to remove and re-add the home-screen icon on iOS).
   3. The opening screens are orange: the sign-in / sign-up / reset / set-password card's "SSC" tile and its accent
      (links, primary button) and the biometric "Welcome back" tile use an orange gradient (#FF5F05 → #E8520A, white
      text) instead of the Davenport blue gradient (#1a6fa8 → #2488c8), and the loading/crash screens use the same
      orange instead of blue. Inside the app after sign-in, item O stands: navy structure, orange accent, red OPEN.
   4. Smoke: screenshot the sign-in screen in both themes; grep the source for the two Davenport blues and for "DSG" —
      both must come back empty except in comments that explain the history.

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

## Already ran v2? Paste just this

```
Two more items on the same branch (fix/prepublish-review), one commit each, tests that fail before and pass after,
npm test + npm run smoke, then stop for my review before pushing:

P. Rename the primary column header of the week-rows table and the ER Call Panels export from
   "TRAUMA & CARDIOTHORACIC SURGERY TRAUMA" to "TRAUMA" — every occurrence together: index-source.html week-rows <thead>,
   helpers.js (share page, ER panel HTML and the tab-separated text flavour, doc comment), the tests that pin the header
   (test/exports.test.js, test/ui/smoke.mjs, test/ui/exports-standalone.mjs) and the two docs that quote it
   (docs/SILVIS-BUILD-GUIDE.md ER export line, docs/CLAUDE-CODE-PROMPTS.md Prompt 9). Layout otherwise unchanged;
   `grep -ri cardiothoracic` must come back empty.

Q. An unassigned slot is OPEN only from today (Central) forward; before today it renders blank — no red, no pill, no
   "M/D OPEN" line, no entry in exports. Implement once in helpers.js (buildWeekRows opts.today → no entry for a past
   unassigned day; a pure slotIsOpen(dateStr, holder, today) used by the month grid's SlotLine, the "only OPEN" filter,
   the share page, the printable month and the ER Call Panels export). The coverage strip (next 60 days), the day
   editor's ability to assign a past day, the office-notifications diff and the generator's open-slot diagnostics do
   not change. Tests: a fixture straddling a fixed "today" (past unassigned → no entry; today and later → "M/D OPEN"),
   plus a smoke check that September's week rows have no data-kind="open" before today while 10/15 still does.

R. Orange opening + SSC icon (supersedes item O.4). Replace icon-512.png, icon-192.png and apple-touch-icon.png in
   the repo root byte-for-byte with the files in the OneDrive folder assets\icons-ssc\ (orange #FF5F05, white "SSC";
   do not regenerate them). manifest.json theme_color AND background_color = #FF5F05; <meta name="theme-color">
   #FF5F05. The sign-in / sign-up / reset / set-password card's "SSC" tile, its accent links and primary button, the
   biometric "Welcome back" tile, and the loading/crash screens use an orange gradient (#FF5F05 → #E8520A, white
   text) instead of the Davenport blue (#1a6fa8 → #2488c8). After sign-in, item O stands (navy structure, orange
   accent, red OPEN). Smoke-screenshot the sign-in screen in both themes; grep for the two Davenport blues and for
   "DSG" — both empty except in history comments. Note in the report that installed PWAs pick the icon up on their next
   manifest refresh (iOS may need remove + re-add).
```

## U. Minor Monday holidays absorb the weekend before (Faraz 9/22 evening; wave 5)

Faraz, 9/22 evening, verbatim:

> "A minor holiday that falls on a Monday absorbs the weekend before it: the unit is Sat-Mon; the Friday stays a
> standalone weekend day (the reduced weekend unit). groupRules.holidays.mondayMinorAbsorbsWeekend = true, applied
> when a year's units are built (2027: Memorial Day 5/29-5/31, Labor Day 9/4-9/6); days stay editable per year.
> July 4 stays its own day when not a Monday (2027: Sun 7/4; 2028: Tue 7/4). Nothing in the milestone range changes."

The same evening he confirmed the tiers: minor = July 4, Labor Day, Memorial Day; major = New Year's, Thanksgiving,
Christmas (the seed's `holidays.rules.tiers`, unchanged).

Delivered (data plus one generic builder, no surgeon- or year-specific code):
- Seed: `groupRules.holidays.mondayMinorAbsorbsWeekend: true` (+ `...Note`), `holidays.rules.mondayMinor`,
  `dayMembershipNote` extended, `holidays.units["2027"]` Memorial Day → 5/29–5/31 and Labor Day → 9/4–9/6 (July 4th,
  Thanksgiving, Christmas, New Year's 2027 unchanged), `holidays.units["2026"]` byte-identical, `_meta.revisions`.
- `helpers.defaultHolidayUnits(year, opts)`: the six units in the seed's shape and order (Memorial Day = last Monday of
  May, July 4th, Labor Day = first Monday of September, Thanksgiving = fourth Thursday as a single day by default,
  Christmas 12/24 + 12/25, New Year's 12/31 + 1/1 keyed under the eve's year); tiers from `opts.tiers`; a MINOR holiday
  on a Monday becomes Sat–Mon only when `opts.mondayMinorAbsorbsWeekend === true`.
- Setup → Holidays: "Add year" pre-fills the new year from the builder (group flag + the tiers); every unit and day
  stays editable or removable; the `holidays.edit` audit entry is unchanged; one hint line under the editor.
- Tests: `test/holidays.test.js` (new, in `npm test`): builder cases (2027 / 2028 / 2033 / 2026 / tiers / 2026–2040
  independent UTC arithmetic), the seed ⇔ builder pin, and the engine proof — from the seed, `holidayUnits` returns
  Memorial Day 5/29–5/31 and Labor Day 9/4–9/6 with the Fridays free, and a generator run holds one primary and one
  backup through all three days while the Friday is a reduced weekend unit (`diagnostics.weekendUnits`:
  `present: [Fri]`, `preempted: [Sat, Sun]`, `reduced: true` — the generator's real shape). A seed pin in
  `test/generator-regression.js` (2027 minors Sat–Mon, 2026 unchanged) and a `test/rules.test.js` case (the flag reaches
  `ctx.holidayFlags` without a warning and changes no milestone-day unit membership or eligibility).
- Decisions: Sat–Mon (not Fri–Mon) per his text; 2026 units left as built; Thanksgiving 2027 builder default = the
  Thursday only (Thu–Sun still to set); July 4 2027 = the Sunday alone (his table note asks Sat–Sun — recorded as an
  open question in `dayMembershipNote`, not baked in).
- Live: the seed re-import (dry run → diff shown to Faraz → apply) carries the flag and the 2027 unit days to the blob.
  Sequence it before (or with) the Pages deploy that carries this JSX: the hint under the editor reads the flag from
  the shared setup and says "the Monday-minor group rule is off" until the re-import lands.
- Review fixes (same evening): CI step "Holiday unit builder tests" (`node test/holidays.test.js`) added to
  `.github/workflows/build.yml` after the totals step (the workflow lists suites explicitly and does not run `npm test`);
  Add year keeps name / tier / days only (the builder's "Eve + Day as one unit" note never reaches the anon-readable blob,
  which the importer would drop anyway); the hint is conditional on the flag; `test/holidays.test.js` runs the generator
  at 1500 ms per call under a 4000 ms file limit that honours `SILVIS_GEN_BUDGET_MS`. Caveat now in the rules doc §5 and
  the guide §15: Setup holiday edits survive only until the next seed re-import (the importer replaces `blob.holidays`
  wholesale) — mirror them into the seed first, or stop re-importing the blob after go-live. Not done: a smoke step for
  the Add year path (`test/ui/smoke.mjs` is wave 4's file); the flow was observed by lifting the handler's prefill
  expression against the real `helpers.js` instead.

## V. Standing East rule — Khan on Davenport call every Christmas Eve and Christmas Day (Faraz 9/22 evening; wave 5)

Faraz, 9/22 evening, verbatim:

> "Standing East rule: Khan is on Davenport call every Christmas Eve and Christmas Day. Encode as a generic
> surgeonRules.<id>.eastStanding list - for s1: [{ name: "Christmas", days: ["12-24", "12-25"] }] - treated exactly
> like a published East busy day in every year, independent of the feed and forecast: Silvis primary excluded, backup
> allowed per his existing East-day rule. So the Christmas unit never has Khan as primary. rules.test.js case, a
> regression assertion for 2026 and 2027, and docs/SILVIS-CALL-RULES.md §3 Khan / §5 (already updated in the OneDrive
> copy - take it from there)."

His follow-up in chat: "That would mean I can never be on at Silvis on Christmas/Christmas Eve" — answered by the rule
itself: never **primary**; backup stays possible under his East-day rule (`eastFeed.eastBlocksBackup` false).
Background: the Davenport app's standing rule of 2026-08-06 (FAK covers both Christmas Eve and Christmas Day at
Davenport every year).

Delivered (data plus one generic rule, no surgeon-specific code):
- Seed: `surgeonRules.s1.eastStanding = [{ name: "Christmas", days: ["12-24", "12-25"], note }]` next to `eastFeed`;
  `_meta.revisions`. Nothing else in the seed. The importer drops the note as documentation (dry run:
  `surgeonRules.s1.eastStanding[0].note -> drop`) and carries `name` + `days` to the blob.
- `rules.js`: `buildContext` reads the list per surgeon (each day must be `MM-DD` naming a real month/day; a bad day, a
  nameless entry or a non-list is a `ctx.warnings` line naming the surgeon and the entry, and is ignored; entries on a
  surgeon whose `eastFeed.enabled` is not true, or whose feature blocks neither role, are ignored with one warning
  naming the gate — the same gate as busy days; the no-role case was the review's finding) into
  `P.eastStanding` (`"MM-DD" -> name`) and `P.eastStandingList` (validated, for display). Inside the existing East
  block of `eligibility()` a standing day is exactly `P.eastBusy.has(date)`: the same hard `east-busy` (no new
  vocabulary; the UI gloss and the regression's `REASON_PREFIXES` stand), ahead of the forecast (no `east-forecast`
  soft term, no `east-forecast-busy`) and of `east-unknown` (`rdEastCovered` is true for a standing day); the result
  carries `eastStanding: <name>`, which the day editor's "Not eligible" line appends to the east-busy gloss
  ("on East (Davenport) call (standing rule: Christmas, every year)"; review: the field now has a consumer). New pure
  export `standingEastDays(ctx, id, from, to)`.
  `holidayUnitCandidates` needed no change: the Christmas unit's primary candidates exclude s1, backup still lists him.
- `generator.js` (diagnostics only): `diagnostics.eastStandingDays = { [id]: ['YYYY-MM-DD', ...] }` for the run range;
  a standing day is never listed in `eastUnknownDays`; the browser shim exposes `standingEastDays`. No placement change.
- UI (`index-source.html`, ASCII): Setup → East card, one read-only line per surgeon with entries
  (`data-testid="east-standing-<id>"`: "Khan - Standing: Christmas 12-24, 12-25 (every year; ...)"); the day editor's
  East status line names the entry ("East call (standing rule: Christmas, every year) - Silvis primary blocked").
  Not done: the My-schedule badge set has no feed-busy badge at all (only the derived "E" and forecast "F"), so there
  was no badge path to extend; the block is enforced by `rules.js` regardless.
- Tests: `test/rules.test.js` V block (2026 / 2027 / 2028 primary blocked, backup free, neighbours untouched, forecast
  0.10 and 0.70 beaten, no coverage → no `east-unknown`, malformed entries and a disabled feature warn and block
  nothing, `standingEastDays`, Christmas 2026 candidates) plus two reconciled pre-V assertions (the Christmas
  candidates used to include Khan; the L feed test used 12/25 as a "cleared" day — the FEED still clears it, V blocks
  it); `test/generator-regression.js` V pin over every stored run whose days include 12/24–25 (50 R2 + 25 R4 + the
  same-seed R2 run + the bestOf-200 preview; the R4 runs are now kept in `r4Results` — one line in the loop; no new
  generator range, budget untouched); `test/holidays.test.js` D1 (one run 2027-12-20 → 2028-01-03, seed 5, bestOf 3,
  800 ms: Khan not primary on 12/24–25, one other surgeon holds the unit both days, `eastStandingDays.s1`, not
  East-unknown, plus the Christmas 2027 unit candidates).
- Decisions: same `east-busy` code (no new vocabulary); same gate as busy days (warning when `eastFeed` is off or
  blocks no role); standing beats forecast and coverage; the standing name rides on the result object, not in the
  reason list; standing days are NOT added to `P.eastDays` (the Totals "East days" column and East-only tallies count
  feed days and derived weeks only — unchanged and now said so in the rules doc; the Totals column is outside V's
  index-source.html scope; say if they should count). The placement pins in the regression and D1 are belt-and-braces
  (other terms already kept Khan off Christmas in the harness inputs); the candidates lines and the diagnostics field are
  the assertions that bite — both test files say so. Open for Faraz: a per-year exception is a manual override with the
  visible warning (not a data field) — confirm that is enough.
- Live: the seed re-import (dry run → diff shown to Faraz → apply) carries `s1.eastStanding` to the blob; the rule is
  inert in the app until then (the JSX reads it from the shared setup). Run the re-import only from the merged branch:
  this wave-5 base's seed lacks the 20 November `schedule_days` and 20 `availability` rows that are live (wave 4
  carries them), so a dry run from this worktree alone lists them as deletes.

## Item W — own dates beat own patterns (Faraz, 9/22 evening; appended by Claude Code)

Faraz, verbatim: *"Own dates beat own patterns (his East OR days are not every Tue/Thu): a surgeon's explicit dated
availability, entered by them or by the scheduler for them, lifts that surgeon's WEEKDAY-PATTERN rules for that date
and role, including hard ones (Khan's Tue/Thu primary, Fierce's Clinton days, Burchett's outreach days, Acton's
Tuesdays). It never lifts obligations: vacations, East feed busy days, derived-week locks, Sarkar's windows. Confirm the
existing dated-row lift covers hardNeverWeekdays; if not, make it so. rules.test.js: Khan on a Tuesday with a dated row
-> eligible primary; without -> not; a dated row on an East busy day -> still not."*

Finding: the dated-row lift did **not** cover `hardNeverWeekdays` (`rules.js rdStatic` pushed `hard-never-weekday:<wd>`
regardless of the row — "the one member no explicit row lifts"), and `outside-window` **was** lifted by a dated row.
Both changed, minimally and generically (no surgeon branch): `hardNeverWeekdays` now reads the same `rowAvail` flag the
rest of the weekday-pattern family reads (role- and date-scoped; the reason code is unchanged where it applies), and
`outside-window` no longer reads a row at all (windows are an obligation, both roles, holidays included). Untouched, and
proven by tests rather than asserted: time-off / day-before-vacation, east-busy / east-forecast-busy, derived-lock*,
backup-opt-out, holds-other-role, max-consecutive; a manual lock is not a row (a locked holder on an OR day keeps the
lock with `hard-never-weekday:<wd>` in `conflicts`). Two pre-W assertions flipped in place (Sarkar's rowed 10/27 and
10/30 were eligible, now `outside-window`) plus Khan's rowed 10/15 (was `hard-never-weekday:Thu`, now eligible). Seed:
`groupRules.availabilityPrecedence` tiers (hardNeverWeekdays into the row-liftable tier, availableWindows into the
never-lifted gates; short and reason-free — the importer keeps these strings), `availabilityPrecedenceNote`,
`surgeonRules.s1.hardNeverWeekdaysNote`, `s6.availableWindowsNote`, a `_meta.revisions` entry; the importer drops every
`*Note` key, so none of the explanatory prose reaches the blob — only the reason-free tier strings and the
`settings.seedRevisions` entry do (dry run: `groupRules=update`, `settings=update`, 0 row changes). Regression: `test/fixtures/khan-dated-row-2026-12-01.json` (Khan's
dated primary row on an ordinary Tuesday; the other candidates unavailable that day) — the control run leaves 12/1 open
with `hard-never-weekday:Tue` as Khan's only reason, the W run places him; `checkRun` now pins `hardNeverWeekdays`
generically over `surgeonRules.<id>.hardNeverWeekdays + Roles` for every surgeon (Acton's Tuesday from item X is covered
automatically), lifted only by a dated row for that date and role.

## Item X — Acton's Tuesdays (Faraz, 9/22 evening; appended by Claude Code)

Faraz, verbatim: *"Acton (s3): never PRIMARY on a Tuesday — promote his Tuesday soft-avoid to a hard primary rule
(hardNeverWeekdaysRoles primary: ["Tue"]); backup on Tuesdays stays allowed. Any note in an anon-readable table says only
'not Tuesdays' — no reason. rules.test.js case + regression assertion."*

Data only — no code change; the engine is item W's generic `hardNeverWeekdays` read. Seed (`surgeonRules.s3`):
`hardNeverWeekdays: ["Tue"]`, `hardNeverWeekdaysRoles: ["primary"]`, `hardNeverWeekdaysNote` (a `*Note` key — the importer
drops it); the `recurringAvoid` Tuesday entry left the seed together with its note (its category token would otherwise reach
the blob as a reason); no `hardNeverWeekdaysReason` key on purpose (a `*Reason` key becomes a category token in the blob);
one `notes[]` line `"not Tuesdays (primary), 9/22 evening"` (dropped — it reads as documentation); a `_meta.revisions` entry.
The reason stays in the rules doc §3 Acton and nowhere else. Importer dry run (read-only, against the live tables): the s3
inventory reads `hardNeverWeekdaysNote -> drop`, `notes[2] -> drop`, `recurringAvoid[0].note -> category -> outreach` (the
Sunday avoid) and no `recurringAvoid[1]` entry any more; plan diff `surgeonRules=update` (plus the pending `groupRules=update`
and `settings=update` from W), `schedule_days` / `availability` / `time_off` 0 changes. Consequences: his November Tuesday
entries (11/3, 11/17) are backups and unaffected; the ER-panel author's published Tue 9/22 primary is a lock, not a row — it keeps its
holder with `hard-never-weekday:Tue` in `conflicts`; on the milestone preview Tue 12/22 and 12/29 now have Philip as the
only primary candidate (the §8 item 15 structural gap — Khan: OR day, Fierce: Clinton, Burchett: off his December list,
Sarkar: outside her 12/14–18 window; 12/1 is Burchett's first Tuesday, 12/8 is Fierce's derived week, 12/15 is in Sarkar's
window). Tests: `test/rules.test.js` — three pre-X assertions flipped in place (Acton's Tuesday primary read eligible with
the soft `recurring-avoid:Tue` at weight 3, backup at weight 1; the closed-policy weight pin now reads his Sunday avoid) and
a Prompt 12 X block (primary hard with `hard-never-weekday:Tue` as the only reason, backup open with no soft Tuesday term,
his own dated available/primary row lifts it, date- and role-scoped, the Sunday avoid still soft at 3, the November backup
locks untouched, the 9/22 lock keeps its holder); `test/generator-regression.js` — `X_STATS` counts every generated Acton
primary on a non-holiday Tuesday across all runs and the named pin requires zero (fail-before against the old seed: 150
placements, first `R3 Jan-Mar seed 1 2027-01-19`), plus the seed facts; the T pin "no sole-candidate day for Philip in
December" flipped to exactly `12/22, 12/29`. `test/importer.test.js` (not on the item's file list — a forced follow-on):
four lines that indexed `recurringAvoid[1]` (the removed entry) would crash the suite, so they now pin its absence and the
`hardNeverWeekdaysNote -> drop`. Setup → Rules already edits `hardNeverWeekdays` and its roles (the same checkboxes Khan's
rule uses).

## Item Y — Acton's November list is preferences (Faraz, 9/22 evening; appended by Claude Code)

Faraz, verbatim: *"Acton's November list is preferences, not a limit (his 9/17 message gave rules, never dates; the dates
came via Burchett's relay): remove the November governed-month whitelist for s3. His listed days stay locked; his recurring
rules govern the rest of November — which makes Thu 11/5 his (primary 11/4–11/6, within his max of 3) with backup from
anyone eligible. Burchett's November whitelist stays. Update docs/SILVIS-CALL-RULES.md from the OneDrive copy (§3 Acton, §8
items 11–12) and regenerate the preview."*

Data only — no code change (`importer.js` untouched). Finding first: dropping the `{ month: "2026-11", roles: [...] }` entry
from `s3.explicitListMonths` is **not enough** — `importer.js impSeedSurgeonRules` completes a surgeon's `explicitListMonths`
from the KEYS of `explicitAvailable` (`groupRules.whitelistMonths.rule`), so an `s3.explicitAvailable["2026-11"]` block alone
re-governs November (the 9/22 probe: `2026-11-05 primary -> hard: [whitelist-month]`). There is no data-only way to keep that
block without governance: `rdGovernedMonths` reads an object entry with an empty `roles` list as both roles, and the completion
skips only months already listed. So the block is removed; his relayed days live on exactly as Faraz said — as **locks** in
`existingAssignments` — and the importer will **delete the s3 November availability rows the T import wrote today**. That count
is **8**, not the 10 the wave brief predicted: the importer collapses consecutive dates into ranges, so 11/14–16 is one row
(5 primary ranges + 3 backup rows; the live table holds the same 8, its total 56 = the plan's 56 before this item). None of those
rows lifted anything (his listed days are not 2nd/4th Mon/Wed or Tuesdays), so nothing changes on his locked days.

Seed (`docs/silvis-seed.json`, Edit tool, ASCII, LF, valid JSON): `surgeonRules.s3.explicitListMonths` → `["2026-10"]`;
`s3.explicitAvailable["2026-11"]` removed; `s3.notes[1]` rewritten (preferences; whitelist off; 11/5 his; item 13 answered —
dropped by the importer as documentation); `explicitAvailableNote` says why November is absent (dropped too);
`existingAssignments` 2026-11-05 → `primary: "s3"`, `backup: null`, `locked: true`, `source: "faraz-2026-09-22-acton-1105"`,
note `"Acton primary per his recurring rules (Faraz 9/22 evening); his relayed 11/5 backup entry superseded"` (operational only —
no reason, no other surgeon's name; it passes the item-F gate); `pendingDeltas` + 11/5 B s3 → open and 11/5 P open → s3
(applied); `openQuestions` 13 struck through with the answer; a `_meta.revisions` entry. `s2` (Burchett) untouched.

Proof on the seed context (rules level, `test/rules.test.js` Y block): Acton 11/5 primary → `ok, lockHolder, conflicts: []`
(no `whitelist-month`, no `max-consecutive` — 11/4, 11/5, 11/6 each read the same, and a probe that opens 11/7 to him reads
`max-consecutive:3`, so the run of 3 is counted, not ignored); the only soft term on the lock is `long-run:5` (any-role 11/2 P,
11/3 B, 11/4–6 P — the A soft limit, informational); 11/5 backup: Khan, Philip, Fierce eligible, Burchett `whitelist-month`
(his list stays), Sarkar `outside-window`, Acton `holds-other-role`. His primary-eligible November days on an empty schedule
are exactly his recurring rules, restated independently in the test and compared day by day: 11/1, 11/2, 11/4, 11/5, 11/6,
11/7, 11/8, 11/12, 11/13, 11/14, 11/15, 11/16, 11/30 — not the Tuesdays 11/3, 11/10, 11/17, 11/24 (X; 11/24 also
`day-before-vacation`), not 11/9, 11/11, 11/23, 11/25 (2nd/4th Mon/Wed), not 11/18 (day before his vacation), not 11/19–22
and 11/25–29 (vacations; Thanksgiving opted out). On the seed schedule Thu 11/12 is open to him (Fierce's derived backup is the
other role); **Fri 11/13 is not** — `max-consecutive:3` (11/13 + his locked 11/14–16 = 4), so the brief's "11/13 Khan/Philip"
guess was wrong: in the regression's context Khan is East-busy that day and 11/13 stays Philip's alone, next to the Tuesdays
11/10 and 11/24. Governed months: Acton `{ "2026-10": 1 }`, Burchett `{ "2026-10": 1, "2026-11": 3, "2026-12": 1 }` (unchanged).

Tests (test-first; each file run against the unchanged seed before the change). `test/rules.test.js`: banner block first —
fail-before `FAIL [Prompt 12 Y seed: ...]: Y: Acton governed months - October plain (primary only); November is no longer
governed (before Y: '2026-11': 3) expected {"2026-10":1} got {"2026-10":1,"2026-11":3}`; then eight T pins flipped in place
(Acton's governed months; 11/10 primary `whitelist-month` → `hard-never-weekday:Tue`; 11/11 backup → `derived-lock-held:s5`
with 11/23 as the "backup any day again" day; the adapter's "November object entry kept as written" → October only; 11/23's
"next to whitelist-month" → nothing else; 11/09 backup → the derived lock; the `manPri` freed-slot pin → Acton may take it; the
"11/5 primary has no eligible surgeon" pin → Acton, its lock holder, with no conflict) — fail-before of the first flip `FAIL
[Prompt 12 T: ...]: T then Y FLIP: Acton governed months ... expected {"2026-10":1} got {"2026-10":1,"2026-11":3}`; after:
`ok 1269 assertions (151 ms)` (was 1221). `test/importer.test.js`: banner block — fail-before `AssertionError
[ERR_ASSERTION]: Y: s3 explicitListMonths after import = October only (before Y: the { month: '2026-11', roles: [primary,
backup] } object)`; in-place flips (Acton's primary/backup November lists, the four-source set, 11/5's row shape, the
availability counts 10 / 3, open primary 7 / open backup 26, the blob list) — fail-before `AssertionError [ERR_ASSERTION]:
T+Y: Acton primary 11/2, 11/4, 11/5 (Y), 11/6, 11/14, 11/15, 11/16, 11/18`; the block also rebuilds T's live state from the
seed and pins the expected live diff (`schedule_days` update 1 with the lines `11/5 P OPEN -> Acton`, `11/5 B Acton -> OPEN`;
`availability` delete = the 8 s3 November rows, derived; blob update 1; `time_off` 0; an app-edited live 11/5 is BLOCKED);
after: `ok 564 assertions` (was 537). `test/generator-regression.js`: banner block — fail-before `FAIL [range Y (Acton
November) seed 1 day -]: seed: Acton's explicitListMonths = October only (Y; before: + the November object entry) expected
["2026-10"] got ["2026-10",{"month":"2026-11","roles":["primary","backup"]}]`; in-place flips (`ACT_GOV` October only —
fail-before `FAIL [range - seed - day -]: seed: Acton governed Oct primary only (Y; T had Nov both roles) expected
["2026-10:primary"] got ["2026-10:primary","2026-11:backup+primary"]`; the milestone-preview "exactly one open slot — 11/5
primary" pin → no open slot, its per-surgeon reason block removed; Philip's T list → `11/10, 11/13, 11/24`; Acton's locked
backups → 11/3, 11/17). The Y block derives Philip's sole-candidate November days from eligibility over the lock-only seed
schedule (`soleOpen`) and holds the generator to exactly that set, names 11/13's reasons (`max-consecutive:3` for Acton, East
for Khan), pins 11/5 as Acton's byte-identical lock with a generated backup for an eligible surgeon and no lock violation, and
checks every generated Acton November primary against his rules. After: `ok 276484 assertions ... (8986 ms total; budget 40000
ms via SILVIS_GEN_BUDGET_MS)` on the shared machine (the baseline read 5578 ms — two other waves were running; the file's 10 s
budget is untouched). Timings line: `R1 Oct bestOf 6: 732 ms / 50 runs; R2 Nov-Dec bestOf 5: 1945 ms; R3 Jan-Mar bestOf 2:
2619 ms; R4 milestone bestOf 2: 492 ms / 25 runs; R1 backfill bestOf 2: 330 ms; Nov-Dec bestOf 200: 1727 ms`.

Importer dry run (read-only, `node scripts/import-seed.js --dry-run`, the REPORT-FIRST artefact): `live rows before:
{"call_schedule_data":1,"schedule_days":73,"availability":56,"time_off":7}`; `call_schedule_data 'main':
roster=unchanged, surgeonRules=update, groupRules=update, holidays=unchanged, settings=update` (groupRules/settings are the
pending W/X updates on this branch); `schedule_days: insert 0, update 1, delete 0, unchanged 72` — `2026-11: update 1,
unchanged 24` — `11/5 P OPEN -> Acton`, `11/5 B Acton -> OPEN`; `availability: insert 0, update 0, delete 8, unchanged 48` —
`delete s3 available/primary 2026-11-02`, `.../backup 2026-11-03`, `.../primary 2026-11-04`, `.../backup 2026-11-05`,
`.../primary 2026-11-06`, `.../primary 2026-11-14..2026-11-16`, `.../backup 2026-11-17`, `.../primary 2026-11-18` (each
"seed-owned, no longer in the seed"); `time_off: insert 0, delete 0, unchanged 7`; `Total changes: 12 (incl. 8 delete(s) of
seed-owned rows)`. The s3 note inventory is unchanged in kind (`notes[1] -> drop`, `explicitAvailableNote -> drop`). Nothing
was applied; the orchestrator shows Faraz this diff and waits for his go. Preview regeneration is the orchestrator's, after
every rule item has landed.

Review fixes (9/22 evening, Fix stage): (1) `groupRules.whitelistMonths.rule` / `.roleScope` in the seed (blob-bound prose the
importer keeps) still named Acton's November as a governed month for both roles; two clauses were reworded - "Acton Oct (his
November list is preferences since 9/22 evening, Prompt 12 Y)" and "Burchett's November list: the ER-panel author published it, so he is not
placed on a November day he did not offer in either role; Acton's November object entry left with Prompt 12 Y" - operational
wording only, no reason. This is one key outside the brief's named s3 keys, taken as part of "remove the November governed-month
whitelist for s3" so the blob does not state a rule the data reversed; no other p12 wave edits that key (checked against each
wave's merge base). (2) Test-message hygiene: the duplicate Burchett adapter pin was dropped (its note folded into T's line), two
kept T assertions no longer say "on his list" (Acton 11/5 backup = backup any day; 11/16 = a 3rd Monday under his recurring
rules), the X-block comment no longer calls November "governed", and the regression's governed-month message reads "T: October
primary; Y: November ungoverned". (3) Not done here: rules doc section 8 item 15 still gives Philip's sole-candidate November days
as 11/10, 11/12, 11/24 (past-tense framing: "In a month where Acton is held to his list"); after Y the derived set is 11/10,
11/13, 11/24 (11/12 opens to Acton; 11/13 is Philip's alone via Acton's max-consecutive 3 against his locked 11/14-16 and Khan's
East day). Section 8 is outside this item's doc scope and is taken in from the OneDrive copy - the orchestrator's next doc intake
appends that clause to item 15; section 3 Acton (the Y bullet) already carries the new set.

## Item Z — Thanksgiving confirmed; clear the flag (Faraz, 9/22 late evening; appended by Claude Code)

Faraz, verbatim: *"Thanksgiving 11/26–29 is confirmed — clear the flag."* (the first of his four late-evening instructions after
"Go on the 17-change import"; the other three are separate items).

Data only — `importer.js` and `index-source.html` untouched: the awaiting-confirmation marker feature of item B (importer prefix,
`plan.stats` count, dry-run inventory, the app's "confirm" badge) stays available for future provenance flags; the seed simply
flags nothing any more.

Seed (`docs/silvis-seed.json`, Edit tool, ASCII, LF, valid JSON, key order intact): the four `existingAssignments` rows
2026-11-26..29 lose the `awaitingConfirmation` key entirely (not `false` — gone) and their note reads
`"Thanksgiving unit - Khan primary Thu-Sun (Faraz 9/21 evening; confirmed 9/22)"` — the rule and its attribution, no history, no
caveat (Faraz's one standard for anything that reaches a row or the blob); assignments (Khan primary, backup open), `locked: true`
and `source: "faraz-2026-09-21"` unchanged. `surgeonRules.s1.notes[1]` → confirmed by Faraz 9/22 evening (dropped by the importer
as documentation); `s1.holidays2026.thanksgiving.source` → `"Faraz 9/21 (evening); confirmed by Faraz 9/22 (evening)"` — `source`
is not a note key, so this string reaches the anon-readable blob as written (it is the `surgeonRules=update` of the dry run; it
passes the denylist and names no reason); `.note` → confirmed (documentation, dropped); the `holidays.units["2026"]` Thanksgiving
note → confirmed (holidays notes never reach the blob; the four days unchanged); `answeredQuestions` Thanksgiving line → confirmed
by Faraz 9/22, open question 8 closed; `openQuestions` 8 struck through with the answer; a `_meta.revisions` entry (it rides into
`blob.settings.seedRevisions` — the `settings=update`). Item B's own revision entry stays as history. `_meta.generatedOn` stays
2026-09-21 as in every earlier item.

Rules doc (`docs/SILVIS-CALL-RULES.md`): §3 Khan — item B's commit (846188d) had left two Thanksgiving bullets side by side (the
original 9/21 line and B's caveat line); they are one bullet now: confirmed by Faraz 9/22 (evening), B's flag history in one
clause, the marker feature retained, open question #8 closed. §5 — the same commit had duplicated the holiday table's body (a
second block of six rows without a header, carrying B's cell and the pre-item-U 2027 dates); the table is one body again: the
U / V rows as they were, the Thanksgiving cell "Faraz 9/21, confirmed by Faraz 9/22 evening; Prompt 12 Z", and the New Year's row
that only the duplicate block had carried. §8 — item 8 struck through with the answer; the "Answered by Faraz on 9/21"
paragraph's parenthetical reads "confirmed by Faraz 9/22 evening — open question 8, closed". Nothing else in the doc changed
(July 4 2027 and Thanksgiving 2027 belong to instruction 4's item).

Tests (test-first; each file run against the unchanged seed before the change).
`test/importer.test.js`: the item-B block is flipped in place (every flipped assertion says "Z FLIP" and what B expected) and the
flag semantics move to SYNTHETIC rows so the feature stays covered — 11/27 flagged with its note → marker + provenance + note,
11/28 flagged without a note → marker + provenance only, 11/26 `false` and 11/29 absent → no marker; count 2, inventory paths,
the SQL header "(2 awaiting confirmation)" and the marked literal, idempotent; the scrub-inventory pin at (5) flipped ("lists no
awaiting row"). A Z block at the end restates every value: no key at all on the four rows, key order, holder / lock / source /
note per row and per planned row, the row note free of any caveat, the blob's Khan rules free of "pending" / "re-confirm" /
"awaiting" / "recorded by", `holidays2026.thanksgiving.source` in the blob = the plain attribution with its note absent, the
s1.notes Thanksgiving line dropped, answered / open questions, the revision in `blob.settings.seedRevisions`, the blob's unit
days. It then pins the expected live diff by rebuilding item B's live state from the seed itself (flag + B's note back on the
four rows, B's holiday source, the Z revision removed): `call_schedule_data` keys `roster=unchanged, surgeonRules=update,
groupRules=unchanged, holidays=unchanged, settings=update`; `schedule_days` insert 0, update 4, delete 0, blocked 0, unchanged 69;
`changes` = the four `11/2x locks/note change` lines (no holder arrow); November update 4 / unchanged 21; availability and
time_off 0; total 6, no deletes, nothing blocked; per day the planned row equals the live row with the note stripped, the live
note = marker + B's wording, the planned note = the confirmed wording; an app-edited live 11/26 (source manual, v2) is BLOCKED
while the other three update.
Fail-before (unchanged seed): `AssertionError [ERR_ASSERTION]: Z FLIP: no existingAssignments row carries awaitingConfirmation:
true (B: the four Thanksgiving rows did)` — actual `['2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']`, expected `[]`.
After: `ok 689 assertions` (was 634).
`test/ui/smoke.mjs`: the two 11/26 pins flip to "no confirm badge" (grid cell and day editor; the review B-2 badge-geometry check
leaves with the badge), each failure message naming the item-Z expected drift; the 11/25 pins are unchanged. Against the LIVE
project the two 11/26 pins FAIL as expected drift until the orchestrator applies this item (the live notes still start with the
marker from the item-B import); SMOKE_FIXTURE=1 serves the seed through the importer and passes them.

Importer dry run (read-only, `node scripts/import-seed.js --dry-run`, the REPORT-FIRST artefact): `live rows before:
{"call_schedule_data":1,"schedule_days":73,"availability":48,"time_off":7}`; `call_schedule_data 'main': roster=unchanged,
surgeonRules=update, groupRules=unchanged, holidays=unchanged, settings=update`; `schedule_days: insert 0, update 4, delete 0,
unchanged 69` — `2026-11: insert 0, update 4, delete 0, unchanged 21` — `11/26 locks/note change`, `11/27 locks/note change`,
`11/28 locks/note change`, `11/29 locks/note change`; `availability: insert 0, update 0, delete 0, unchanged 48`; `time_off:
insert 0, delete 0, unchanged 7`; `Total changes: 6` — exactly the diff the Z block derives. Nothing was applied; the orchestrator
shows Faraz this diff and applies it with the other late-evening items.

Gates: `npm test` — every file green (`ok 1563`, `ok 83`, data-layer, schema, `ok 689` importer, week-rows, exports, totals,
`ok 326` holidays) and the generator regression passes all of its assertions (`ok 276927 assertions ...`) but on this shared
machine it ran over the file's 10 s budget every time (15.0–16.6 s), so the gate line read `FAIL [range - seed - day -]: over
the 10000 ms budget`. Verified it is the machine, not this item: a read-only `git archive HEAD` copy of the unchanged head, timed
alternately with the worktree and with a copy carrying only the Z seed, read 9.5 / 10.4 / 11.0 / 14.2 / 15.1 s (head) and
11.9 / 16.0 s (head code + Z seed) — the seed change is note text the engine never reads, and the spread is the same for both.
With `SILVIS_GEN_BUDGET_MS=40000` (other agents on the machine; the budget in the file is untouched): `ok 276927 assertions, 50
seeds x 4 ranges at bestOf 6/5/2/2 (R4 on the even seeds: 25 runs) + 50 fill-open-only backfill runs at bestOf 2 + 1 x bestOf 200
+ 9 fixture runs (15505 ms total; budget 40000 ms via SILVIS_GEN_BUDGET_MS)`. `node build.js`: `OK build complete` (APP_VERSION
2026.09.22n locally; `index.html` / `version.json` restored with `git checkout --`, never committed).
Smoke (`PLAYWRIGHT_DIR=<tooling> npm run smoke`, live project, writes intercepted): `SMOKE FAILED: 5 problem(s)` — four are this
item's expected drift until the orchestrator applies the seed: `FAIL 2026-11-26 grid cell still shows the 'confirm' badge (badges
["confirm"]) - the live row note still starts with the 'awaiting confirmation - ' marker until the item-Z seed import is applied
(expected drift)`, `FAIL day editor 2026-11-26: 'confirm' badge still shown (1) - expected drift ...`, `FAIL Import dry run:
expected zero changes against the live rows: Total changes: 6 | Total changes: 6` and `FAIL Import apply dry run (extra
2026-12-03): expected 2 changes (blob surgeonRules + 1 availability insert): Total changes: 7 | ... schedule_days: insert 0, update
4 ...` (6 + the harness's extra row). The fifth, `FAIL Import apply: result panel wrong (expected 1 availability insert of 37 plan
rows, no schedule_days change, 4 Thanksgiving day(s) kept ...): Import applied - blob merged; availability inserted 1, skipped 48;
time_off inserted 0, skipped 7; schedule_days inserted 0, updated 0, kept (app-edited) 15.`, is PRE-EXISTING on the head and not
this item's: the check hard-codes `availability inserted 1, skipped 36` from Prompt 6 (commit 346e7be, a 37-row plan) while the
head's plan — and the live table — hold 48 availability rows (item Y), and its "kept" count names only the four Thanksgiving days
while the harness has by then edited 15 days in-session; it fails identically with `SMOKE_FIXTURE=1`, where this item's rows equal
the fixture rows. Item Z owns only the two 2026-11-26 badge pins, so that stale pin is left for a smoke re-baseline (open question
below). `SMOKE_FIXTURE=1 npm run smoke` (the seed served through the importer): the four badge pins pass — `ok 2026-11-26 grid cell
shows no 'confirm' badge (Thanksgiving confirmed by Faraz 9/22, Prompt 12 Z)`, `ok 2026-11-25 grid cell shows no 'confirm'
badge`, `ok day editor 2026-11-26: no 'confirm' badge (...)`, `ok day editor 2026-11-25: no 'confirm' badge` — and the Import dry
run reads 0 changes; the run's only FAIL is that same pre-existing Import-apply pin (`SMOKE FAILED: 1 problem(s)`).

Decisions: (1) the row note is exactly the brief's wording — attribution only, no reason, no history; (2)
`holidays2026.thanksgiving.source` reaches the blob, so it is a plain attribution, not a sentence; (3) the §3 / §5 duplicates left
by item B's commit are collapsed (one bullet, one table body with the New Year's row kept); (4) the `holidays.units["2026"]`
Thanksgiving note is updated although the brief did not name it — B's review B-3 made it mirror the rows, and it never reaches the
blob; (5) the §8 "Answered by Faraz on 9/21" parenthetical is updated as part of item 8; (6) `_meta.generatedOn` untouched;
(7) the regression's 10 s budget is untouched — the env-var run is reported with the A/B evidence.
Open: the smoke's Import-apply pin (`skipped 36`, `kept 4`) needs a re-baseline against the head's 48-row plan and the harness's
in-session edit count — outside item Z's files. ⟶ **Closed 9/23 (Prompt 13 review fix, P13R-2, feat/open-shifts):** the pin now
derives both numbers — `skipped` = the plan's availability rows − 1 (`importer.importPlan` on the seed the harness uploads), `kept`
= `suSeedDayMerge` restated over every plan day (live row not seed-owned, or grid holders differing from the live row right before
Apply, or one of this run's edited days); the Import dry run's `blocked` count is restated the same way (the 9/23 publish left many
seed-range days app-owned), and every OPEN pin (10/15 cell, `10/7 OPEN` week row, ER panel, Copy for Word, mobile pill, share /
printable) reads the live rows fetched up front instead of a dated constant. Against the live project the harness opens ONE backup
slot in what it serves (never in the table) so the claim scenario runs — `harnessOpen` in test/ui/smoke.mjs.

Review (fix stage, 9/22 late): (Z-1, minor, applied) the two 11/26 badge pins no longer label every `confirm` badge as
"expected drift" - `liveByDay` is built after those pins, so the harness reads the 2026-11-26 row note itself (the fixture row,
or one read-only anon GET of the live row) and the FAIL message says `expected drift ... (the row note still starts with the
'awaiting confirmation - ' marker)` only while the marker is present, `REGRESSION: the row note carries no marker (...)` once the
seed is applied, and `could not be read, so drift vs regression is undetermined` when the read fails; the ok lines are unchanged.
(Z-2, minor, skipped) re-attaching review B-2's runtime badge-geometry check to a synthetic flagged fixture row is not done: the
fixture rows are served through `importer.importPlan` from the unchanged `docs/silvis-seed.json`, and the fixture-mode `Import
seed dry run ... 0 changes against the live rows` pin (plus the app-edited-day counts of the apply run) relies on those rows being
exactly the seed's - a flagged 2026-11-27 fixture row would read as `schedule_days: update 1` and fail a pin outside item Z's two
owned pins. The badge rendering stays pinned statically in `test/data-layer.test.js` (13px `?` square via `badge()`, gutter widened
per badge, the word `confirm` in the day editor) and the marker semantics on synthetic flagged rows in `test/importer.test.js`; a
runtime geometry check needs its own fixture pass (a flagged clone rendered before the import checks) - a smoke item of its own.

## Item AA — one standard for the blob: no reasons, only the rule (Faraz, 9/22 late evening; appended by Claude Code)

Faraz, verbatim: *"Drop the 'OR day' reason token from Khan's rule; one standard for the blob: no reasons, only the rule. Reasons
live in docs/SILVIS-CALL-RULES.md."* (the second of his four late-evening instructions after "Go on the 17-change import").

What was wrong: item F's scrub classified a `surgeonRules` note into one of five category tokens (`outreach`, `family`, `personal`,
`OR day`, `preference`) and wrote the token to the anon-readable blob — the live blob carried `s1.hardNeverWeekdaysReason = "OR day"`,
`s2` / `s3` / `s4` `outreach`, `s3.holidayRules.neverThanksgivingNote` (a one-word token), `s4` / `s5` `preference` (the dry run's eleven
`-> category -> …` lines). A token is a reason in one word. Since AA the importer DROPS every note-like key of `surgeonRules` exactly as
it already did for `groupRules` and `holidays`; nothing classifies, no token exists in the code, and the reason for a rule is
documented in the rules doc only.

Seed (`docs/silvis-seed.json`, Edit tool, ASCII, LF, valid JSON, key order intact): `surgeonRules.s1.hardNeverWeekdaysReason` deleted
— the only `*Reason` key in the file (checked at every depth) — and its wording folded into the existing `s1.hardNeverWeekdaysNote`
("Tue/Thu are his OR days - the reason stays in this Note key and in docs/SILVIS-CALL-RULES.md section 3 only …"; a Note key the
importer drops). One `_meta.revisions` entry (it rides into `blob.settings.seedRevisions`, so it names keys and mechanics and carries
no reason word, no former token and no denylist word — pinned). `_meta.generatedOn` untouched. No row of `existingAssignments`,
`timeOff` or availability statements changed.

Importer (`importer.js`): `impScrubRuleNotes` drops every note-like key (`note`, `notes[]`, `*Note`, `*Notes`, `*Reason`, any depth,
arrays included) from all three blocks; `IMP_NOTE_TOKENS`, `IMP_NOTE_CATEGORIES`, `IMP_NOTE_DOC`, `impNoteIsDocumentation`,
`impNoteCategory` and the `NOTE_UNCLASSIFIED` refusal are REMOVED (dead tables invite reuse; a test asserts none of those names
appears in the file); `impRefuseNoteDenylist` keeps its word list and loses the "an exact token is exempt" branch — no blob string is
exempt; the order is unchanged and now pinned: scrub first, then the gate over the assembled blob, so a denylist word under a
note-like key is dropped and never refused while the same word under a non-note key still refuses. The inventory keeps its shape
(`{ path, action: 'drop', from, to: null }`) with ONE entry per note-like key (item F listed `notes[i]` per element; the drop is
per key, as `groupRules` always was); `plan.noteScrub.counts` loses `category` (`{ drop, timeOffPublic, awaitingConfirmation }`).
`impTimeOffNote` (item S: `public: true` vacation notes to `time_off`) is untouched — those notes are not blob keys and were stated
as public by the surgeon; the seed's four read `unavailable (stated 9/22)` and a test asserts none carries a denylist word, a former
token or a reason word (the status word "unavailable" is not a reason). `scripts/import-seed.js`: the header, the exit-code comment
and the `--dry-run` summary no longer name categories ("72 note-like key(s) dropped …"; each line `<path> -> drop`); `NOTE_UNCLASSIFIED`
left its refusal regex. UI check: the only reader of a `surgeonRules` note is Setup → Rules' `PatternListEditor` (`p.note || ""` into
the note input; `if (p.note) n.note = p.note`) — guarded, renders an empty field; nothing reads `hardNeverWeekdaysReason`, `notes[]`,
`neverThanksgivingNote` or `aledo.note`; the `helpers.js` note readers are day notes. No JSX change; no data-layer or smoke pin
expected a token.

Docs: guide §3.1 — the "Notes are public too" bullet and the scrub bullet rewritten (drop, never classify; no tokens; the gate and
its order; `time_off` public notes; reasons live in the rules doc); `CLAUDE.md` — "Notes in anon-readable tables carry no reasons at
all (not even category tokens); the rule itself is the only content - since 9/22"; rules doc §3 Khan — one line (the OR-day reason
stays there and nowhere else) and the item-X Acton parenthetical corrected (a `*Reason` key is dropped now, not tokenised).

Tests (`test/importer.test.js`, test-first). The item-F block is flipped in place (every flipped assertion says "AA FLIP" and what F
expected: the classified keys are absent, `notes[]` is gone as a key, the inventory lists `drop` only, the counts object has no
`category`, an unclassifiable note is dropped instead of refused, relatives / hosting under `notes[]` never reach the blob in any form,
the exact word `family` in a non-note key now REFUSES where F exempted it, the direct `impScrubRuleNotes` call leaves no note-like key).
The AA block at the end pins: no former token or reason word in any string value under the blob's `surgeonRules` (values, not key
names — `preferences` is a key) and none of the eight literals as a JSON string value; no note-like key under `surgeonRules`
(recursive) and no `*Reason` key anywhere in blob or seed; the wording kept in `s1.hardNeverWeekdaysNote`; rule and roles unchanged;
one `drop` per note-like key of the seed's `surgeonRules` (paths equal, `timeOff` notes excluded), zero `category` entries, counts;
the scrub-before-gate order (a `*Reason` / `notes[]` / `*Note` key carrying `family day` / `wife's birthday dinner` / `school run`
imports with none of the three keys or their wording in blob or SQL, while `s1.label = "family"` and `s1.hardNeverWeekdaysWhy =
"school days"` refuse); no category export and no category name in `importer.js`; idempotency; the four public `time_off` notes;
the CLI source prints no "mapped to a category"; the revision in `blob.settings.seedRevisions`; and the expected live diff derived by
putting the tokens back on a copy of the plan (`roster=unchanged, surgeonRules=update, groupRules=update, holidays=unchanged,
settings=update`; no row change; total 3 — `groupRules` and the third key since the review's `holidayPolicy` move, see below).
Fail-before (unchanged importer and seed): with the FINAL test file overlaid on a scratch `git archive HEAD` the flipped F block fails
first — `AssertionError [ERR_ASSERTION]: AA FLIP: neverThanksgivingNote is dropped from the blob (F: '…' -> the token
'…')` (test/importer.test.js:652; the HEAD counts there read `{"category":11,"drop":79,"timeOffPublic":4,"awaitingConfirmation":0}`,
94 inventory entries). The AA block alone, appended before the flips, failed with `AssertionError [ERR_ASSERTION]: AA: no former
category token or reason word in any surgeonRules string of the planned blob (fail-before: 'OR day', 'outreach', 'family', 'preference')` — actual
`['surgeonRules.s1.hardNeverWeekdaysReason = "OR day"', 'surgeonRules.s2.recurringAvailable[0].note = "outreach"',
'surgeonRules.s2.notes[0] = "outreach"', 'surgeonRules.s3.recurringUnavailable[0].note = "outreach"',
'surgeonRules.s3.recurringUnavailable[1].note = "outreach"', 'surgeonRules.s3.recurringAvoid[0].note = "outreach"',
'surgeonRules.s3.holidayRules.neverThanksgivingNote = "…"', 'surgeonRules.s4.aledo.note = "outreach"',
'surgeonRules.s4.notes[0] = "outreach"', 'surgeonRules.s4.notes[1] = "preference"',
'surgeonRules.s5.outsideDerivedWeeks.weekdayPattern.Wed.note = "preference"']`, expected `[]`. After: `ok 728 assertions` (was 689).

Importer dry run (read-only, `node scripts/import-seed.js --dry-run`, the REPORT-FIRST artefact): summary `rule notes dropped before the
blob (importer.js, guide 3.1; no reasons, no category tokens - reasons live in docs/SILVIS-CALL-RULES.md): 74 note-like key(s) dropped
(every surgeonRules, groupRules and holidays note); the seed keeps its wording; 4 public vacation note(s) written to time_off as stated
(public: true)` (72 before the review's two new Note keys; before AA: `11 mapped to a category, 79 dropped` — 94 entries = 11 category +
79 drop + 4 public, `notes[i]` per element); every inventory line reads `<path> -> drop` (74 of them, incl. `groupRules.holidayPolicyNote`
and `surgeonRules.s5.statedPreferenceNotARuleNote`), zero `-> category` lines, no `surgeonRules.s1.hardNeverWeekdaysReason` line (the key
left the seed). Plan diff (observed after the review edits): `call_schedule_data 'main': roster=unchanged, surgeonRules=update,
groupRules=update, holidays=unchanged, settings=update`; `schedule_days: insert 0, update 4, delete 0, unchanged 69` (the four
`11/26..29 locks/note change` lines are item Z's, still pending live — AA changes no row); `availability: insert 0, update 0, delete 0,
unchanged 48`; `time_off: insert 0, delete 0, unchanged 7`; `Total changes: 7` (= Z's 4 rows + the 3 blob keys; AA alone is
surgeonRules + groupRules + settings). Nothing was applied.

Gates: `npm test` — every file green (`ok 1563`, `ok 83`, data-layer, schema, `ok 728` importer, week-rows, exports, totals,
`ok 326` holidays) and the generator regression passes all `ok 276927 assertions`; inside the `npm test` chain on this shared machine
it read `11092 ms total; budget 10000 ms` (`FAIL … over the 10000 ms budget`), alone right afterwards `8862 ms total; budget 10000 ms`
(green), and under `SILVIS_GEN_BUDGET_MS=40000` `11260 ms total` — machine load, not the item (AA touches importer / seed notes only;
the regression's ctx comes through `impSeedSurgeonRules`, not the scrub); the file's budget is untouched. `node build.js`: `OK build
complete` (APP_VERSION 2026.09.22n locally; `index.html` / `version.json` restored with `git checkout --`, never committed). Smoke not
run: neither `index-source.html` nor `test/ui/smoke.mjs` changed; against the LIVE project the smoke's "Import dry run" pins will read
this item (blob `surgeonRules` + `groupRules` + `settings`) plus item Z's four rows (Total changes: 7) as expected drift until the
orchestrator applies the seed.

Decisions: (1) one inventory entry per note-like KEY (arrays whole), the shape `groupRules` always had — F's `notes[i]` lines are gone;
(2) `counts.category` removed rather than reported as 0 (a dead field invites reuse), tests re-pinned; (3) the token tables and the
documentation heuristic are removed, not kept behind a flag; (4) the denylist gate exempts nothing any more — the exact word `family` in
a non-note key refuses (F let it through as a token); (5) `time_off` public notes stay as stated (status, not reason) with a test
asserting no reason word; (6) the revision wording is mechanics only so it passes its own gate; (7) guide §3.1's adjacent "Notes are
public too" bullet is rewritten too (its example table note was the token `outreach`), and the rules doc's item-X Acton parenthetical
is corrected — both inside the owned sections, named here as deviations from the one-paragraph / one-line brief.
Open: `test/generator-regression.js:1399` and `test/rules.test.js:1747` still say "(a *Reason key reaches the blob as a category
token)" in an assertion message / comment — the assertions hold (no such key) and the files are outside item AA; message-only
staleness for the owner of those files. Two app entry paths still bypass the gate (pre-existing, unchanged by AA): Setup's "Edit as
JSON" editors, and the pattern-row note input in Setup → Rules (`PatternListEditor`, placeholder "operational note (public)",
index-source.html ~5763) — a note typed there autosaves into the blob unchecked and the next seed import drops it; gate it with
`SU_NOTE_DENYLIST` or remove the field (guide §3.1 names both).

**AA review (9/22 late, same night — fix stage).** The reviewer walked the planned blob and found two NON-note prose keys still
carrying a surgeon's stated wish: `surgeonRules.s5.statedPreferenceNotARule` ("Fierce described an ideal … recorded only in his
words" — its own name says it is not a rule; no reader in rules.js / generator.js / east-feed.js / helpers.js / index-source.html /
tests) and the second sentence of `groupRules.holidayPolicy` ("Burchett's stated preference (Christmas split …)" — the only
`preference` string left in the SQL). Both are data-only moves in the seed: the s5 key is renamed `statedPreferenceNotARuleNote`
(value kept) and the sentence moves to a new `groupRules.holidayPolicyNote` right after `holidayPolicy` (which keeps the unit rule and
its pointer to `holidays.rules`); both are Note keys the importer drops (inventory `-> drop`, 74 drops now). Tests appended under
`// ---- Prompt 12 AA review (9/22 late) ----` in `test/importer.test.js`: no `statedPreference*` key anywhere in the blob, the seed keeps
the wording, `holidayPolicy` names no surgeon / no preference and still ends with the `holidays.rules` pointer, `holidayPolicyNote` never
in the blob, both paths in the inventory as drops, and — blob-wide, all five keys — no former token, reason word or moved phrase in
ANY string value or in the SQL; the AA revision entry (now naming the two moves) passes its own gate. Fail-before against the
worktree before the seed edits: `AssertionError [ERR_ASSERTION]: AA review: neither statedPreferenceNotARule nor its Note form under s5
in the blob (fail-before: the key was in the blob)`. After: `ok 739 assertions` (was 728). The expected-live-diff pin (11) is flipped
in place: the reconstruction puts both prose keys back, so `groupRules: "update"` and total 3 (blob keys only; still no row change).
The `_meta.revisions` AA entry names the two moves and the `where` ruling below, worded without any reason word or moved phrase.
NOT changed, reported for Faraz's ruling (reviewer major 2): Fierce's `weekdayPattern.<day>.where` values ("Clinton all day",
"Office Clinton/Silvis", "Clinton or Dubuque (rotates)", "East (Davenport)") remain in the blob — no engine code reads them, but Setup →
Rules has a *Where* column (index-source.html ~5930–5938) that writes the key back, so retiring it is a JSX change outside AA and a
location may or may not count as a reason under his standard; the rules doc §3 Fierce carries the open ruling (strict → `whereNote` +
retire the column; keep → stated exception) and the guide §3.1 names it. Also fixed from the review: the fail-before sentence above now
quotes the FINAL file's first failure (the flipped F assertion at line 652) with the HEAD counts, and the pre-AA inventory size reads
94 (11 category + 79 drop + 4 public), not 90. Not fixed (outside AA's files): the stale message text in `test/generator-regression.js:1399`
and the comment in `test/rules.test.js:1747`.

## Item AB — default Generate start = the first open slot from today (Faraz, 9/22 late evening; appended by Claude Code)

Faraz, verbatim: *"Default Generate start = first open slot from today (10/15). Locks are never touched, so starting at the first gap is
safe and catches the October opens and any 11/5-type hole in one run."* (the third of his four late-evening instructions after "Go on
the 17-change import").

What changed: until AB the presets started the day after the LAST PUBLISHED day (`suLastContiguousDay`, the end of the longest
contiguous block of rows — 2026-11-18 over the 73 rows, so the presets began 11/19 and left the open October backups, the 10/15 and
10/24 primaries and the November holes to a separate fill-open-only pass). Now the range starts at the first open slot on or after
today (Central) and one run covers all of it; locks are seeded first and never touched.

**The date Faraz wrote (10/15) is not what the live rows give.** `suFirstOpenSlotDay` as specified — the first day ≥ today whose saved
row leaves primary open (no holder, no external cover) or backup open, or a missing day inside the saved span — returns **2026-10-07**
on the 73 rows of the 9/22 import run on 9/22: the backups of **10/7, 10/9, 10/10, 10/11 and 10/13** are open (the ER-panel author's 9/16 document;
`existingAssignments`, all locked) and precede the open 10/15 primary. 10/15 is the first open *primary*; an open backup is exactly
the "11/5-type hole" he wants caught, so the rule is implemented as stated and the panel names the computed day. Nothing in the app,
the tests or the smoke encodes 10/15 or 10/7 as the answer — the smoke restates the day from the live rows each run — but the
data-layer suite does pin the seed's rows to 10/07 from 9/22 so a silent change of the rule or the data shows. If Faraz wants the
run to begin at 10/15 regardless, the five earlier backups must be assigned by hand first (or a floor becomes a group rule; not
added — an unanswered question is not baked in).

Delivered:
- `helpers.js`: `suFirstOpenSlotDay(schedule, today)` beside `suLastContiguousDay` (pure, string dates via `suAddDays`, `dayHolder`
  for the primary/external-cover convention; exported). Documented decisions: a day before today is never a candidate (item Q —
  past slots are not OPEN); `externalCover` counts as a filled primary only (Atwell + open backup → that day); a missing day
  AFTER the last saved row is not a candidate (the fallback's job); null when nothing is open on/after today.
- `index-source.html` (CallSchedule): `genToday = todayCentral()`, `genFirstOpenDay = suFirstOpenSlotDay(schedule, genToday)`,
  `genFallback = lastPublishedDay ? suAddDays(lastPublishedDay, 1) : genToday`, `genStart = genFirstOpenDay || max(genFallback, genToday)` (string compare; the clamp is the review fix below); `genPresets =
  rangePresets(suAddDays(genStart, -1))` (rangePresets starts the day after its argument — its END rules are untouched: 'Through
  end of year' still ends 2027-01-03 from any 2026 start, '3 months' from 10/07 ends 2026-12-31); `laterAssignedRanges =
  suLaterAssignedRanges(schedule, suAddDays(genStart, -1))` = the assigned days from the start on. `GeneratePanel` gains
  `genStart` / `genFirstOpenDay`; the sentence (ASCII) reads *"Range starts at the first open slot on or after today: <d> (locks are
  never touched; the run fills every open slot from there and generates the rest). Last saved day (end of the contiguous block):
  <lastPublishedDay>."* — or, with nothing open, *"No open slot on or after today - the range starts the day after the last saved
  day (end of the contiguous block: <lastPublishedDay>), or today when that day has passed: <d>."* — then *" Days with a held slot from
  the start on: <ranges> - locked slots stay as they are while 'respect locks' is on; the open slots on those days are filled."*; `data-testid="gen-last-published"` stays and carries `data-gen-start`. `todayStr` (declared later in the same
  component) is not reachable at the wiring, hence the local `genToday`. Wording deviations from the brief: "Last saved day (end
  of the contiguous block)" instead of "Last saved day" because the contiguous end (11/18) is not the last saved row (11/29), and
  "Days with a held slot from the start on" instead of "Later locked days" because the list now includes the start day itself and
  days whose other slot the run fills (review fix, below).
- `test/data-layer.test.js` (`// ---- Prompt 12 AB (9/22 late) ----`, 7 checks): helper pins on synthetic maps (open backup today
  → today; only past opens → null and today itself counts; missing day inside the span → that day; Atwell + open backup → that day,
  Atwell + held backup → null; fully assigned / empty / null map / today after the span / gap after the span → null; today before
  the span → the first gap inside it) and on the seed's `existingAssignments` (9/22 → 2026-10-07, 10/14 → 10/15, 11/18 → 11/19
  missing day, 11/30 → null); a source pin on the wiring, both panel sentences, `data-gen-start`, the props, and the absence of
  `rangePresets(lastPublishedDay)` and the old sentence. Fail-before against the unchanged code: `FAIL suFirstOpenSlotDay: an open
  backup on today -> today (a held primary does not make the day filled)` / `-> H.suFirstOpenSlotDay is not a function` (six helper
  pins) and `FAIL index-source.html: genStart = suFirstOpenSlotDay(...)` / `-> genFirstOpenDay memo (suFirstOpenSlotDay over the
  saved schedule from the Central today)`; `75 passed, 7 failed`. After: `82 passed, 0 failed`.
- `test/ui/smoke.mjs`: the wave-7 presets restatement is rewritten to the new rule — from the harness's own picture of the map
  (live rows + observed edits, item SM) it walks the days from max(today Central, first row day) to the last row day and takes the
  first with no row or an open role, else the contiguous fallback; asserts the app's 'Through end of year' / '3 months' titles, the
  default Start/End, the panel's `data-gen-start` and both sentences, and the "locked days from the start on" ranges; the sanity
  assertion now says a first open slot lies on/after today inside the span (fallback: inside the span + 1 day); the '3 months' end
  restatement is unchanged. Fail-before (the new restatement against the OLD JSX, built from `HEAD:index-source.html`, live
  project, 73 rows, 9/22): `FAIL Generate presets: expected the default start 2026-10-07 (first open slot on/after today
  2026-09-22), 'Through end of year' = 2026-10-07 to 2027-01-03 (default range), '3 months' = 2026-10-07 to 2026-12-31 and
  data-gen-start=2026-10-07, got teoy=2026-11-19 to 2027-01-03 3m=2026-11-19 to 2027-01-31 start=2026-11-19 end=2027-01-03
  data-gen-start=null` — 227 ok / 6 FAIL. Pass-after (`npm run smoke` on the new JSX): `ok Generate presets: default start
  2026-10-07 = the first open slot on/after today 2026-09-22; 'Through end of year' = 2026-10-07 to 2027-01-03 is the default
  range, 3 months = 2026-10-07 to 2026-12-31, data-gen-start agrees (all derived from the live rows; last contiguous saved day
  2026-11-18); panel names the start, the last saved day and the locked ranges from the start on 10/7-10/14, 10/16-10/23,
  10/25-11/18, 11/20, 11/23, 11/25-11/29`; Accept & Publish pins unchanged (20 CAS writes, changes=25) — 228 ok / 5 FAIL, all
  five expected drift until the orchestrator applies this wave's seed (two item-Z confirm-badge pins, three Import dry-run pins:
  `Total changes: 7`).
- Docs: guide §6 Generate paragraph and a §15 bullet; rules doc §1 "Period" row (one sentence); this entry.

Live actions for the orchestrator: none for AB itself — no seed key, no blob key, no row changes (code + tests + docs only); the
new default is live for the scheduler once this JSX reaches Pages, and the preview regeneration Faraz asked for should use the
in-app default (start 2026-10-07 today) or `scripts/preview-generate.js` with that start so the October backfill and the milestone
are one run.

Review fixes (9/22 late, fix stage; all inside AB's files):
- **Fallback clamped to today** (two reviewers): the day after `suLastContiguousDay` can lie in the PAST once today passes the last
  saved row (published through 1/3, Generate opened 1/10 → start 1/4), and item Q says a past slot is never open. `genStart =
  genFirstOpenDay || (genFallback > genToday ? genFallback : genToday)`; the fallback sentence names both; the data-layer source pin
  and the smoke's fallback branch (`expStart = firstOpen || max(lastPub + 1, today)`, sanity allows `expStart === today`) follow.
  Fail-before against the implementer's JSX: `FAIL index-source.html: genStart = suFirstOpenSlotDay(...)` / `-> genFallback = the day
  after the last contiguous day (today when nothing is on file)` (81 passed, 1 failed); after: 82 passed, 0 failed. On today's rows
  nothing changes (a first open slot exists).
- **Panel wording**: the ranges list every day with ANY held slot (10/7, 10/9, 10/13 ... whose backup the run fills), so "Locked days
  on file from the start on" was wrong by name → *"Days with a held slot from the start on: ... - locked slots stay as they are while
  'respect locks' is on; the open slots on those days are filled."* (smoke `laterRx` and the data-layer pin updated in the same edit).
- **Docs**: guide §2 milestone row (line 34) and the §5 Setup line (338) carry the AB arrow; rules doc §7 gains the sentence that the import
  holds five open backups before 10/15 (10/7, 10/9–10/11 Acton, 10/13 Philip) and that the in-app default run from 10/7 covers the
  backfill and the milestone in one run (the fill-open-only script path stays); the smoke comment carries "(decided 9/22 late)".
- **Decision for Faraz (not code)**: the computed start is 10/7, not the "(10/15)" he wrote. If the five pre-10/15 backups should stay
  open, they are assigned by hand first or a floor is recorded as `groupRules` data — never a code branch.
- Not fixed, not AB's: the stale `groupRules.generationHorizons.note` in the seed ("from the last published day"; the importer drops
  note keys, so it never reaches the blob) — the orchestrator reword/drops it at the next seed edit; the two pre-existing smoke flakes
  (Rules "Primary contribution" blob pin, Factory-reset 900 ms write window vs the autosave upsert) are noted for a follow-up.

## Item AC — 2027 holiday units: Thanksgiving Thu–Sun, July 4 on its observed day (Faraz, 9/22 late evening; appended by Claude Code)

Faraz, verbatim: *"2027 units: Thanksgiving Thu–Sun (same shape as 2026); July 4, 2027 falls on a Sunday and is observed Monday 7/5,
so the unit is Sat 7/3 – Mon 7/5 under the Monday-absorbs-the-weekend rule. Data only, editable in Setup."* (the fourth of his four
late-evening instructions after "Go on the 17-change import").

What changed: item U had left two 2027 questions open — Thanksgiving Thu-only (the builder default, 11/25) vs Thu–Sun, and July 4
2027 (a Sunday) as the Sunday alone vs Sat–Sun. Both are closed as data: the seed's 2027 units carry the shapes he named, and the
generic per-year builder (`helpers.defaultHolidayUnits`, what Setup → Holidays → Add year pre-fills) follows the same two rules in
every year so a future Add year lands on the same shapes. Stored days stay authoritative and editable per year; the engine reads
only stored days; no surgeon- or year-specific code.

Delivered:
- Seed (`docs/silvis-seed.json`, Edit tool, ASCII, key order intact): `holidays.units["2027"]` Thanksgiving → `11/25, 11/26,
  11/27, 11/28`; July 4th → `07/03, 07/04, 07/05`; Memorial Day (5/29–5/31), Labor Day (9/4–9/6), Christmas, New Year's 2027 and
  every 2026 unit unchanged. `holidays.rules.mondayMinor` (a rule string that reaches the blob) gains two sentences: July 4th is
  read on its observed day (Sunday → Monday → Sat–Mon; Saturday → the Friday) and Thanksgiving is Thu–Sun every year — rule
  only, no reason, and only what is ruled (the review dropped "the Friday alone" from it: that shape is undecided and lives in
  `dayMembershipNote` / `openQuestions` / the rules doc, never in a blob-bound rule string). `holidays.rules.dayMembershipNote` (dropped by the importer) closes the two questions and names the one point
  still open: a **Saturday** July 4 is observed on the Friday and the builder default is that Friday alone (next: 2037) — no
  decision covers it. `openQuestions` 3 struck and answered; one `answeredQuestions` line; one `_meta.revisions` sentence
  (reason-free — it lands in `settings.seedRevisions`).
- `helpers.js` `defaultHolidayUnits(year, opts)`: Thanksgiving = the fourth Thursday of November through the Sunday after (four
  days, every year, flag or not — a major never absorbs); July 4th = the observed day (Sunday → 07-05, Saturday → 07-03, else
  07-04) and the existing Monday-minor step then reads that observed day, so a Sunday July 4 becomes [Sat, Sun, Mon] with the
  flag (2027, 2032), a Monday July 4 still does (2033), a Tuesday is alone (2028) and a Saturday July 4 is the observed Friday
  alone with or without the flag (2037) — the rule speaks of the weekend BEFORE a Monday and no decision covers a Friday, so the
  builder does not invent one (documented in the header comment). Memorial Day, Labor Day, Christmas, New Year's, tiers, purity
  and validation unchanged. The observed-day shift is independent of the tier (a July 4th listed as major still lands on its
  observed day; only the absorb step reads the tier).
- `test/holidays.test.js` (test-first): in-place flips with a comment naming AC — A3 (seed → ctx: July 2027 = 7/3–7/5, Fri 7/2
  free), B2/B3 (builder 2027: July 4th observed Monday alone without the flag, Sat–Mon with it; Thanksgiving 4 days), B4 (2028
  Thanksgiving 11/23–26), B6 (2026 builder view: July 4th leaves the "== seed" list, Thanksgiving builder == seed's Thu–Sun), B8
  (2026–2040 loop: 4-day Thanksgiving Thu–Sun, July 4th = the observed day), C1 (dayMembershipNote pins: the two questions closed,
  the Saturday shape named as open; mondayMinor states the observed-day reading) — and the new section E under
  `// ---- Prompt 12 AC (9/22 late) ----`: E1 2028 (Tue 7/4 alone; Thanksgiving 11/23–26), E2 2032 (Sun 7/4 → 7/3–7/5 with the
  flag, observed Monday alone without), E3 2033 (Mon 7/4 → 7/2–7/4), E4 2037 (Sat 7/4 → `["2037-07-03"]`, flag or not), E5 a
  major July 4th still lands on its observed day without absorbing, E6 majors never absorb, E7 the 2026 builder view (Thanksgiving
  11/26–29 = the seed's; July 4 2026, a Saturday → observed Fri 7/3 alone while the seed's `["2026-07-04"]` is asserted
  unchanged — the difference is by design and commented), E8 engine proof from the seed (holidayUnits over 2027-11 = Thanksgiving
  11/25–11/28 only, 11/24 and 11/29 free, four-day unit on every day), E9 `proveUnit` over 2027-07-01..2027-07-11 (seed 3, bestOf 4,
  1500 ms): one primary + one backup through 7/3–7/5, Fri 7/2 a reduced weekend unit (`present: [7/2]`, `preempted: [7/3, 7/4]`,
  `reduced: true`), no hard violations.
  Fail-before, verbatim. Against the unchanged seed and builder: `FAIL [A3: seed -> ctx: July 4 2027 (a Sunday, observed Monday 7/5)
  is Sat 7/3 - Mon 7/5; Fri 7/2 is not a unit day; the milestone-range units are untouched]: holidayUnits July 2027 expected
  [{"name":"July 4th","tier":"minor","days":["2027-07-03","2027-07-04","2027-07-05"]}] got
  [{"name":"July 4th","tier":"minor","days":["2027-07-04"]}]`. With the seed changed and the builder still unchanged: `FAIL [B2: flag
  absent / false -> every minor holiday is a single day (July 4th: the observed day)]: July 4th 2027 without the flag = the observed
  Monday alone expected ["2027-07-05"] got ["2027-07-04"]`; the unchanged builder's own output for 2027 (one-off node, since the
  suite stops at the first failure): Thanksgiving `["2027-11-25"]` (the Thursday only) vs the seed's four days, July 4th
  `["2027-07-04"]` (the Sunday alone) vs the seed's Sat–Mon — the C1 seed ⇔ builder pin fails on it. Pass-after: `ok 389 assertions
  (112 ms; limit 4000 ms)` (was `ok 326 assertions`).
- `test/generator-regression.js` (the U seed pin, flipped in place with the AC comment): `seed 2027 July 4th (a Sunday, observed
  Monday 7/5) is Sat-Mon (Prompt 12 AC)` = `["2027-07-03","2027-07-04","2027-07-05"]`, a new line `seed 2027 Thanksgiving is Thu-Sun,
  4 days (Prompt 12 AC)`, and `["2027-07-02", "2027-07-03", "July 4th"]` joins the Friday-free / Saturday-opens-the-3-day-unit
  ctx loop; the 2026 pins and the budget are untouched. Fail-before against the unchanged seed: `FAIL [range seed-U seed - day -]:
  seed 2027 July 4th (a Sunday, observed Monday 7/5) is Sat-Mon (Prompt 12 AC) expected ["2027-07-03","2027-07-04","2027-07-05"] got
  ["2027-07-04"]`. Pass-after: `ok 276930 assertions, 50 seeds x 4 ranges ... (8744 ms total; budget 40000 ms via
  SILVIS_GEN_BUDGET_MS)` — the override was used because another agent loaded the machine (the unchanged head took 16674 ms and
  tripped the 10 s budget before any AC edit); the budget in the file is unchanged.
- Importer dry run (read-only, live project): with this seed `call_schedule_data 'main': roster=unchanged, surgeonRules=update,
  groupRules=update, holidays=update, settings=update` / `schedule_days: insert 0, update 4, delete 0, unchanged 69` (11/26–11/29
  locks/note change — item Z's marker leaving the notes) / `availability: ... unchanged 48` / `time_off: ... unchanged 7` / `Total
  changes: 8`. The same dry run with the HEAD seed (before AC) reads `holidays=unchanged` and `Total changes: 7`, so AC's whole
  live footprint is the `holidays` blob key (units 2027 + rules.mondayMinor) plus its revision sentence in `settings`; no row changes.
  The denylist gate passed (exit 0).
- Docs: rules doc §5 (the 9/22 paragraph: "still to set" → decided 9/22 late; table rows July 4th and Thanksgiving carry the 2027
  cells) and §8 item 3 struck; guide §15 U bullet gains the observed-day / Thu–Sun clause and its 2027 list; this entry.
- Gates: `npm test` green (rules 1563, east-feed 83, data-layer 82/0, schema 118, importer 739, week-rows 16/0, exports 41/0,
  totals 32/0, holidays 389, regression 276930 — under `SILVIS_GEN_BUDGET_MS=40000`, loaded machine); `node build.js` → `OK  build
  complete` (1566 createElement calls, 0 injected imports) then `git checkout -- index.html version.json`. No smoke: `index-source.html`
  and `test/ui/smoke.mjs` are untouched (Add year already reads the builder). Until the orchestrator applies the seed, the smoke's
  "Import dry run" pins will show the drift above (`Total changes: 8`).
- Decisions: a Saturday July 4 (observed Friday) is a single day in the builder — Faraz's rule names the weekend BEFORE a Monday and
  says nothing about a Friday, so nothing is invented; the seed names it as the remaining open point (2037 is the next case). The
  seed's 2026 July 4th stays `["2026-07-04"]` (past, as built) although the builder now reads that Saturday as the observed Friday —
  stored days are authoritative and the milestone range does not move. The observed-day shift applies to July 4th only (Memorial Day
  and Labor Day are Mondays by definition; the majors have fixed dates). `holidays.rules.mondayMinor` stays a rule string in the
  blob (no reason in it); the reasons and the open point live in the rules doc §5 and the `dayMembershipNote` (dropped by the importer).

Live actions for the orchestrator: apply this wave's seed (`scripts/import-seed.js --apply` after Faraz sees the dry-run diff) — AC's
part is the `holidays` blob update (2027 Thanksgiving 4 days, July 4th 3 days, `rules.mondayMinor`) and the revision line in
`settings`; nothing for `schedule_days`, `time_off` or `availability`; no edge function, no deploy needed for AC (helpers.js reaches
Pages with the next push of `main`).

## Item PUB — publish the regenerated preview from the command line (Faraz, 9/22 evening; appended by Claude Code, 9/23 overnight)

Faraz (asleep): "You can go ahead and deploy, publish and move forward without my go - just ensure it is accurate to the best
of your ability. No one has access yet except me." Accept & Publish runs under his signed-in scheduler session and nobody else
can sign in as him, so the orchestrator publishes `docs/PREVIEW-2026-11-02-to-2027-01-03.json` (milestone 11/2 → 1/3 plus the
October fill-open-only backfill 10/7 → 11/1) SERVER-SIDE with a tool that mirrors that path and proves what it did. This item
BUILDS and TESTS the tool; it was never run with `--apply` here.

- `scripts/publish-preview.js` (new). Default = DRY RUN (anon reads exactly like `scripts/preview-generate.js`): builds the
  plan, runs the preflight, prints per-month insert / update / unchanged / refused counts, every change as `M/D P/B before ->
  after` (`helpers.formatDayChange`), the refused list and the preflight result, writes the SQL (`<dirname(workdir)>/
  publish-preview.sql`, else `<tmp>/silvis-publish-preview.sql`; `--out`) and a Markdown report beside it (`--report`; on
  `--apply` it goes to `docs/PUBLISH-2026-09-23.md`). `--apply --workdir <linked dir>` runs the SQL through `supabase db query
  --linked --workdir … -o json -f <abs>` (the importer's runner, copied — `scripts/import-seed.js` runs `main()` on require),
  then VERIFIES: the batch's final `SELECT` (snapshot_id, snapshots_before → snapshots_after = +1, audit_id, days_by_tool =
  planned rows), an anon re-read (`verifyApplied`: every planned row on file with the planned body, `version` = seen + 1 or 1,
  `updated_by` the tag), a fresh plan reading zero rows, per-surgeon per-month tallies; exit 1 on any mismatch, 2 when the plan
  or the preflight refuses. Exported pure functions: `buildDesired`, `planPublish`, `applyToLive`, `verifyApplied`, `tallies`,
  `previewChecks`, `preflight`, `publishSql`, `auditDetail`, `renderPlan`, `renderPreflight`, `renderReport`; `fetchLive` /
  `buildLiveContext` do the network (the ctx build of `preview-generate.js` DUPLICATED faithfully — same seven sources, same
  East resolve, same `buildContext` input — because that script is a top-level async runner with no exports; extracting a shared
  module would have meant editing a file this item does not own).
- Decisions, each with the app line mirrored:
  - **source**: the preview entry's source. `generator.js genSeedLocks`: `source: (fixedP || fixedB) ? (e.source || "import") :
    "generated"` — a day with a locked import slot keeps `import` when its other role is generated, a fully generated day (10/15,
    10/24: live `import` rows with both roles open and unlocked) becomes `generated`, a derived week with no import lock is
    `east-derived` (`e.source = "east-derived"` a few lines below); `helpers.suMergePreview` then copies the preview entry
    wholesale (`Object.assign(emptyDayAssignment(), p)`) and `syncScheduleDays` PATCHes the whole `assignmentToDayRow` body.
    One guard the app does not need: a live row whose source is an app source (manual / trade / claim) and whose held slots are
    all untouched keeps its own source (never downgraded to `generated`); a changed app-edited slot is refused anyway.
  - **locks**: a live lock with a holder stays (`suMergePreview`: `if (respectLocks && cur.primaryLocked && (cur.primary ||
    cur.externalCover)) { … a.primaryLocked = true }`), otherwise the preview's flag — generated slots come out unlocked, a
    derived-week slot comes out locked exactly as `genSnapshot` writes it (`primaryLocked: … !!e.primaryLocked`).
  - **note**: an existing live note is never overwritten (a differing preview note is warned about, not written); a new
    generated day gets the preview's note = `null` (`genSeedLocks` carries only the input's note: `note: e.note === undefined ?
    null : e.note`). The dry run showed no differing note.
  - **holder → OPEN**: only when the preview left the slot open AND the live holder is `generated`; an `import` or app holder
    is never cleared (refused and listed). The real preview has no such case (milestone `uncovered` empty; the backfill fixes
    every held slot).
  - **external_cover**: the live value, never set or cleared; a preview primary over a cover aborts (none in either range;
    Atwell's 10/1–10/4 lie before the backfill).
  - **audit**: `actor_id null`, `actor_name` = the tool tag, `action 'schedule.generate_accept'`, `detail` = the app's keys
    (`summary`, `start`, `end`, `seed` as a string, `bestOf`, `respectLocks`, `changes`, `uncovered`, `snapshot` counts,
    `outcome`, `error`) plus `mode: "command-line"`, `note: "published from the command line on Faraz's authorisation of
    2026-09-22 evening"`, `authorisedBy: "s1"`, the preview file / generatedAt, inserted / updated / refused, the backfill range
    and its changes, and the snapshot id and before/after counts added by the DO block.
  - **snapshot**: `reason 'generate_publish'` (index-source.html: `snapshots.capture("generate_publish")`), `created_by` the
    tag, `data` = the importer's `jsonb_build_object` (`config`, `schedule_days`, `time_off`, `availability`) — pinned equal to
    `importer.importSql`'s lines in the test; `source_updated_at` = the blob's `updated_at`; unconditional (the tables are not
    empty) and guarded: `RETURNING id` + a before/after count, else `RAISE`.
  - **CAS**: `UPDATE … SET version = version + 1, updated_by = '<tag>', updated_at = now() WHERE day = X AND version = <seen>`
    then `GET DIAGNOSTICS v_n = ROW_COUNT; IF v_n <> 1 THEN RAISE EXCEPTION 'PUBLISH_CAS_MISMATCH…'`; inserts `version 1 … ON
    CONFLICT (day) DO NOTHING` with the same guard (`PUBLISH_INSERT_CONFLICT`); a final `count(*) … where updated_by = tag and
    updated_at = now()` must equal the planned rows. All inside ONE `DO $$` block between `begin;` / `commit;` (the probe of
    9/22 showed the linked CLI runs the file as one request; a raise persists nothing). The SQL is 7-bit clean
    (`importer.impSqlStr`: the 10/24 note's em dash becomes `E'…\u2014…'`).
  - **never**: no `notifications` row, no `send-notification` / `office-notifications` call, no key printed or stored, no
    contact data. The tool tag names the run, not a person; the office notice stays the app's publish dialog, by Faraz.
- `importer.js`: exports only — `impSqlStr`, `impSqlBool`, `impSqlJson` (no behaviour change).
- `test/publish.test.js` (new; `npm test` before the regression; CI step "Publish-preview plan tests") +
  `test/fixtures/publish-synthetic-2026-10.json` (10 synthetic live rows, a synthetic two-range preview; roster ids only).
  A: `buildDesired` — 14 days, an identical overlap takes the milestone row, a differing one is listed and aborts the plan. B:
  the fixture plan — locked roles untouched (10/6 skipped), the open backup on a locked-import day filled by a CAS update on the
  seen version with the lock kept and the generated slot unlocked (10/5), holder → holder on an import-unlocked slot (10/7),
  manual (10/8) and trade (10/17) slots refused and listed with the day skipped, a claim holder left and its open backup filled
  with the `claim` source preserved (10/18), external cover untouched (10/9), holder → OPEN for a `generated` holder (10/10) and
  refused for an `import` holder (10/11), a new day inserted at v1 (10/12), an all-open new day not inserted (10/13), per-month
  counts, the final open list, `--force-app-edited` writing the app-edited days but still never clearing an import holder. C:
  aborts — a differing locked holder, primary == backup, a preview primary over an external cover; a range day missing from
  the preview is warned about and left alone. D: row shape — key order, source / lock / note / external_cover semantics above.
  E: SQL pins — snapshot first with `'generate_publish'`, the importer's data shape, a CAS `WHERE day = X AND version = V` and
  `version = version + 1` per update, `values (…, 1, '<tag>') on conflict (day) do nothing` per insert, one `get diagnostics`
  guard per row, one raise per update / insert, the snapshot and final-count raises, one DO block, begin/commit, the audit row
  (parsed back: summary, keys, `mode`, the note, the backfill range, `refused`), no `notification` substring anywhere, no
  edge-function URL or `@`, the tag in every `updated_by`, 7-bit clean, the final select's columns, no rows → no SQL. F: gate
  (a) — the fixture's open milestone day FAILS it (the real preview leaves none), covered it passes, a hard violation in either
  pass fails; `preflight` on a ctx from the seed — the seed's October week passes once its opens are listed and fails (c) when
  they are not, Khan planted as an unlocked Tuesday primary is caught (`hard-never-weekday:Tue`), the same holder locked is a
  locked fact, an unlisted uncovered day fails (c) and passes once listed. G: `applyToLive` then re-plan → zero rows, zero
  changes, the three refusals still listed; `verifyApplied` passes on the simulated state and catches a differing holder and an
  unmoved version; tallies (Acton P 2 / B 4, Khan P 1 / B 1). H: the real preview — no overlap, ranges 10/7..11/1 and
  11/2..1/3 (89 days), gate (a) passes, backfill open = 10/15 primary, 9 known locked facts, a plan over an empty live set
  renders.
  Fail-before, verbatim (the module did not exist): `Error: Cannot find module
  '<your projects folder>\Silvis-p12-w6\scripts\publish-preview.js'`. First implementation: five assertions I had written
  wrong were corrected against the tool's (specified) behaviour — `final open slots` (10/11 P stays Burchett: the clear was
  refused), the force flag (`refused` = `["2026-10-11"]`, an import clear is never forced), the snapshot-shape line filter
  (it also matched the audit line), gate (a) on the fixture (`the milestone leaves 2 slot(s) open: 2026-10-13 primary,
  2026-10-13 backup` — correct: the fixture leaves 10/13 open on purpose) and the seed week's opens (coverage (c) fails until
  they are listed). Pass-after: `ok 161 assertions (351 ms)`.
- Dry run observed (read-only, live project, 2026-09-23 ~05:53 UTC, after the wave-8 seed apply — blob updated 05:27:45,
  preview generatedAt 05:28:27): `live rows: schedule_days 73, time_off 7, availability 48, east_feed 7, east_forecast 14,
  east_overrides 0`; plan `2026-10: insert 0, update 15, unchanged 10 … slot changes 16 / 2026-11: insert 5, update 16,
  unchanged 9 … 26 / 2026-12: insert 31 … 62 / 2027-01: insert 3 … 6`; `changes (110)` from `10/7 B OPEN -> Fierce` to `1/3 B
  OPEN -> Philip` — every one an OPEN → holder fill (no holder replaced, no clear); `refused (0)`; `open slots in the final
  state (1): 10/15 P`; `rows to write: 70 (39 insert(s), 31 update(s))`; ctx `East coverage 2026-09-28..2026-11-15; derived
  weeks 2026-11-09:backup, 2026-12-07:primary`; preflight `(a) … ok; milestone open 0; backfill open 1 (2026-10-15 primary)`,
  `(b) … 177 slot(s) evaluated; hard reasons remaining 0; locked facts 9` (10/12 P Fierce `weekday-pattern:Mon`; 10/14, 10/17,
  10/18, 10/19, 10/22, 10/26, 10/28 B Philip `backup-cap:7`; 11/18 P Acton `day-before-vacation`), `(c) coverage: ok`, `(d)
  distinct roles: ok`, `preflight result: PASS`; `SQL written … (45351 bytes)`; exit 0. The SQL: 70 `get diagnostics` guards,
  0 `notification` hits, 0 non-ASCII bytes. Final-row tallies (both ranges) in the report: e.g. Nov Fierce B 16 (his derived
  backup week + fills), Dec Fierce P 9 (derived primary week 12/7 + Wed/Fri pattern), Sarkar P 2 per month.
- Gates: `npm test` green (publish 161 added before the regression); `node build.js` → `OK  build complete` then `git checkout
  -- index.html version.json`. No smoke: `index-source.html` untouched.

Live actions for the orchestrator (in this order; both from the worktree, never from the main clone):
```
cd <your projects folder>\Silvis-p12-w6
node scripts/publish-preview.js --dry-run
node scripts/publish-preview.js --apply --workdir <linked supabase dir>
```
The dry run must still read `rows to write: 70`, `refused (0)` and `preflight result: PASS` immediately before the apply (a
row edited in between changes its version and the apply's CAS would raise — re-run the dry run, not `--force-app-edited`).
`--apply` writes `docs/PUBLISH-2026-09-23.md` (commit it with the same message) and ends `VERIFIED: the preview is published`
or exits non-zero with the mismatch listed. Then, when Faraz is up: the app's publish dialog for the office notice (the tool
sent nothing), and 10/15 primary stays the group's open question (rules doc §8).

Fix stage (9/23, after review — 12 findings, all addressed, no behaviour change for the 9/23 data): a ctx note from
`buildLiveContext` (no East id for an `eastBlocks` surgeon, a failed roster resolve) now FAILS the preflight instead of
being printed and ignored (`preflight(ctx, plan, ctxNotes)`; the major finding); the app's wipe guard
(`helpers.scheduleWipeCheck`, live → final) aborts a plan that would empty more than half of the populated primaries; the DO
body is quoted `$pub$ … $pub$` (a `$$` in a note cannot end it); the final `SELECT` reports `stamped_at` and counts the
tool's rows at that timestamp only (the tag is a constant — a second run must not accumulate); `--apply` also proves every
row OUTSIDE the plan unchanged and the total moved by exactly the inserts (`verifyUntouched`); a post-apply re-read that
throws still writes the report and exits 1 saying the batch was sent; `parseCliRows` parses the final row from the END
of stdout and prints the trailing 400 characters on failure; section H of the test pins the 9/23 preview's numbers only
while `generatedAt` is that file's (a regenerated preview cannot turn `npm test` red); the guide's §15 wording (notes are
written, never overwritten) and §19 (seed ownership, the flags-only deviation) were corrected. **Seed ownership after
`--apply`**: the 31 updated days carry `updated_by` = the tag, so `import-seed` (which applies only where `updated_by` is
still `seed`) will no longer touch them — a later seed correction to 10/7 … 11/29 goes through the app; the importer's dry
run lists them as skipped. This is what stops a re-import from wiping the generated backups, and it is what an app publish
does too. Test: `node test/publish.test.js` → `ok 186 assertions` (was 161).

### Delivery note — items O.1–O.3 + R (wave 9, item TH; O.4 superseded by R, its contrast check kept) — 9/23

What changed: the app's colours are tokens. `app-styles.js` defines `THEME.light` / `THEME.dark` (same names in both), the
per-surgeon table keyed by roster **id** plus the outside-surgeon colour keyed by roster **type**, and the orange `OPENING`
gradient; `index-source.html` reads them as `T = THEME[dk ? "dark" : "light"]` (the older `dkBg` / `dkText` / `dkSubtext` /
`dkCardBorder` names became aliases of `T.*` so the many call sites did not have to move) and the old grey literals were
re-tokened in place (`#2c3e50`/`#1a2a3a` → text `#1F2A3A`, `#7a8a98`/`#5a6a78` → muted `#5B6B82`, `#f0f2f5` → page `#F6F8FB`,
`#e0e4ea` → border `#DCE3EC`; the dark literals `#1a1a2e`/`#16213e`/`#2a3a5e`/`#0f3460`/`#e0e0f0`/`#8a8aaa` → `#0B1A33`/`#13294B`/
`#24406B`/`#0F2140`/`#E6ECF5`/`#9FB0C8`). Styling only: no rule, generator, importer, seed or data-path change.

Delivered:
- **O.1 light** (`app-styles.js` `THEME.light` + `css`): navy `#13294B` = header bar (`css.hdr`, both themes), nav (`css.tab`:
  transparent on the bar, the active tab lifted with an orange 2 px underline — the caller passes `T.accent` so dark mode gets
  `#FF8A4C`), primary buttons (`css.btn(true)` = navy gradient `#13294B → #1F3A6B`, `css.mini(true)` solid navy), card titles
  (`css.cardT`) and small titles (publish-diff group labels, "Signed in as", the role word on My schedule, the "you" marker).
  Orange `#FF5F05` is an accent only: the two count badges on the nav (were red `#e04040`), the active-tab underline, the today
  ring + glow (`rgba(255,95,5,0.18)`), the focus ring, Undo, and the primary call to action `css.cta` (orange gradient, white
  text — the opening buttons). `#C2410C` where orange is text on white (the opening links, "Tap to view", snapshot Refresh,
  today's date number, "Propose a trade", "range starts here"); `#FFE8DB` as the tint (the "newer" version chip). Page
  `#F6F8FB`, card white, text `#1F2A3A`, muted `#5B6B82`; **OPEN stays red `#B91C1C`** (`T.open`: grid pill, week rows,
  OpenTag, legend; warning reds `#c04040` in Totals / flags are untouched — they are not OPEN). The legend says
  "orange outline = today". The E badge is navy (`T.badge`), the F badge unchanged.
- **O.2 dark** (`THEME.dark`): page `#0B1A33`, surface `#13294B` (cards, header — the header keeps a `#24406B` bottom rule),
  text `#E6ECF5`, muted `#9FB0C8`, accent `#FF8A4C` (also the orange-text token in dark), OPEN `#F06060`, inputs `#0F2140`,
  border `#24406B`, primary gradient lifted to `#1F3A6B → #2E5090`, E badge `#2E5090`, titles `#C9D6E8`. The dark `<style>`
  sheet was rewritten: React serialises inline colours as `rgb()`, so the inherited hex-form selectors never matched — the new
  rules match the light token literals in `rgb()` form (text, muted, navy title, orange text, OPEN red, page-tint backgrounds,
  the navy gradient / solid navy buttons, the raised `css.btn(false)` surface) and keep the vis-004 `data-flag` rules; roster
  pills rendered as buttons keep their own colour (`:not()` on the seven tint backgrounds) and buttons already in the dark
  orange are not greyed. The Settings toggle (`silvis-dark-mode`) is still the only switch — no `prefers-color-scheme` hook.
- **O.3 per-surgeon colours** (`SURGEON_COLOR_BY_ID`, data keyed by roster id): s1 navy `#1F3A6B`, s2 orange `#D9561A`, s3
  teal `#0F766E`, s4 plum `#6B3FA0`, s5 olive `#6B7F1A`, s6 slate `#475569` — each with a pill tint (`tg`), border (`bd`) and a
  dark-page variant (`dk`, used for names written straight on the dark page: week rows, vacation dots); pills keep tint + `tx` in
  both themes. `OUTSIDE_SURGEON_COLOR` for roster `type: "external"`: grey `#737373`, dashed border (`pillBorder(c)`,
  `borderStyle` on the grid pill); an unpinned id (a future hire) cycles `FALLBACK_SURGEON_COLORS`. `rosterColors(entry, idx)`,
  `rosterNameColor(c, dark)`, `pillBorder(c)` replace every `surgeonColors(name)` / `surgeonTextColor(code)` call in
  `index-source.html` (grid `colorOf`, `Badge`, `css.badge(idx, entry)`, the audit chip, the month painter, the calendar-sync
  buttons). The exports (`helpers.js exportColorsFor → config.js surgeonColors(code)`) resolve by code through the old table, so
  `app-styles.js` re-points that global function binding (a plain function declaration) at the id-keyed table via the fallback
  roster's codes — the share page, printable month and ER panel carry the same six colours (smoke: Khan's share-page pill is
  `rgb(31, 58, 107)`). P / B stay text weight.
- **R.1 icons**: `icon-512.png` / `icon-192.png` / `apple-touch-icon.png` replaced byte-for-byte with the supplied SSC tiles
  (`cmp` identical; sha256 `de6f32a6c6cc…` 7216 B / `4a712c33e8ca…` 2394 B / `55c55e57ad28…` 2257 B). Installed PWAs pick the new
  icon up on their next manifest refresh; iOS home-screen icons may need remove + re-add.
- **R.2**: `manifest.json` `theme_color` and `background_color` = `#FF5F05` (name / short_name / both icon entries kept);
  `<meta name="theme-color" content="#FF5F05">`. Nothing bumped by hand.
- **R.3 opening**: the sign-in / sign-up / reset / set-password card's SSC tile, the biometric "Welcome back" tile, the loading
  tile and the header's SSC tile use `OPENING.gradient` (`#FF5F05 → #E8520A`, white text); the four opening buttons are
  `css.cta`; the opening links are `T.accentText`; the crash screen's Reload button is the same gradient on the `#F6F8FB` page.
- **R.4 / O.4 proof**: `test/ui/contrast.mjs` (new) loads the tokens from `app-styles.js` and prints every pair — **84 pairs, all
  meet their minimum: 26 text pairs at 4.5:1, 58 label / glyph pairs at 3:1**. Text class = body / muted / input text, orange
  text on card / page, OPEN red, header title + subline + inactive tab labels, card titles. Label class (3:1, stated per row) =
  bold button labels on the navy gradient, the white "SSC" / button label on the orange gradient (3.05 / 3.72), the today ring
  and active-tab underline (glyphs), the E badge, the count badge (`onAccent`: white in light 3.05, `#0B1A33` in dark 7.43), the
  600-weight pill names on their tints (lowest: s2 `#D9561A` on `#FDEBE1` 3.43, s5 4.01, outside 4.31) and on the page (s2 3.73,
  s5 4.22), and the orange-on-tint chip (4.39 — the tint sits only under the bold 700 version chip). `npm run smoke` prints the
  table and fails on any failing row; `node test/ui/contrast.mjs` prints it alone.
- **Smoke** (`test/ui/smoke.mjs`): a second page with the session token removed by an init script renders the sign-in card in
  both themes (`silvis-dark-mode` forced through the app's own flag) — SSC tile / Sign in button / sign-up link / page background
  measured on computed colours, screenshots `signin-light.png`, `signin-dark.png`; a signed-in month view per theme on the main
  page — header `rgb(19, 41, 75)`, active-tab underline and today ring in the theme accent, every visible P pill checked against
  the id-keyed table (3 holders in September), OPEN pill, page background — screenshots `theme-month-light.png`,
  `theme-month-dark.png` (plus the existing `calendar-oct-2026.png` / `calendar-oct-dark.png`); the source grep for `#1a6fa8` /
  `#2488c8` / `1f7a5c` / `DSG` outside comments over `index-source.html`, `app-styles.js`, `manifest.json`, `config.js` (empty);
  `helpers.js` joined that set in the review fixes below. Pins moved with the tokens: dark body `rgb(11, 26, 51)`
  (was `rgb(26, 26, 46)`), week-rows OPEN `rgb(185, 28, 28)` (was `#c04040`), the share-page Khan pill.
- **Data-layer pins** (`test/data-layer.test.js` [TH]): exact light / dark hex values; the id-keyed table (keys s1–s6, no name
  or code key, no `SURGEON_COLOR_BY_CODE` read); `rosterColors` by type; no `surgeonColors(` / `surgeonTextColor(` in
  index-source; `T = THEME[...]` + the four aliases; meta + manifest values; the three icon hashes; `OPENING` + `css.cta` usage;
  the no-blue / no-DSG grep; header / title / underline / today ring / OPEN / legend pins. The pre-existing legend pin now
  expects `color:T.open`. **Fail-before, verbatim** (unchanged code): `FAIL app-styles.js exports THEME / SURGEON_COLOR_BY_ID /
  OUTSIDE_SURGEON_COLOR / OPENING / rosterColors / rosterNameColor to Node -> missing export THEME`; `FAIL R.4 no Davenport blue
  … -> [ 'index-source.html: #1a6fa8 x32', 'index-source.html: #2488c8 x9', 'index-source.html: 1f7a5c x1', 'app-styles.js:
  #1a6fa8 x7', 'app-styles.js: #2488c8 x1', 'manifest.json: 1f7a5c x1' ]`; `FAIL R.1 … icon-512.png: '0a0f7d291dfb' …` (11 FAIL,
  `82 passed, 11 failed`). Pass-after: `93 passed, 0 failed`. Contrast module fail-before: `Error: app-styles.js does not export
  THEME.light / THEME.dark`. Smoke fail-before (unchanged code, run from a byte copy): `FAIL sign-in light: the SSC tile is not the
  orange gradient #FF5F05 -> #E8520A: linear-gradient(135deg, rgb(26, 111, 168), rgb(36, 136, 200))`, `FAIL month light: today
  ring is rgb(26, 111, 168), not the orange accent`, `FAIL theme grep: … index-source.html: #1a6fa8 x32 …`,
  `SMOKE FAILED: 23 problem(s)`.
- Docs: guide §8 theme paragraph (full token list, proof files), §15 theme bullet (delivered clause), this note.
- Decisions: (1) and (2) as first delivered (`helpers.js` left blue, `app-styles.js` re-pointing config.js's `surgeonColors`)
  were reversed by the wave-9 review — see "Review fixes" below: `helpers.js`'s export CSS now carries the theme and
  `exportColorsFor` resolves through `rosterColors(entry, idx)`; `config.js` is still untouched (its `SURGEON_COLOR_BY_CODE` /
  `surgeonColors` are now reached only where app-styles.js is not loaded). (3) The item's warning colours
  (`#c04040` over-cap / flags) are not OPEN and were left alone so the vis-004 pins still hold. (4) No `prefers-color-scheme`
  default was added (a behaviour change; the item allows forcing the theme through the app's flag). (5) The white-on-orange CTA
  / tile pairs measure 3.05–3.72:1 — Faraz specified white text on that gradient; they are bold 14–18 px labels and are declared
  in the 3:1 class, not hidden.
- Gates: `npm test` — rules 1563, east-feed 83, data-layer `93 passed, 0 failed`, schema 118, importer 739, week-rows 16/0,
  exports 41/0, totals 32/0, holidays 389; the generator regression's `ok 276930 assertions` in every run but over the wall
  clock on tonight's loaded machine (34925 ms against the 10 s budget inside `npm test`, then 47552 ms and 20397 ms alone under
  `SILVIS_GEN_BUDGET_MS=40000` — the override was used, the budget in the file is unchanged; TH touches no generator code).
  `node build.js` → `OK  build complete` (1566 createElement calls, 0 injected imports) then `git checkout -- index.html
  version.json`. Smoke (final run): every TH line `ok` — `theme contrast: all 84 token pairs meet their minimum (26 text pairs at
  4.5:1, 58 label / glyph pairs at 3:1)`, `theme grep: … absent outside comments …`, `sign-in light|dark: SSC tile = orange
  gradient, white text` / `'Sign in' button = orange gradient, white text` / `sign-up link = orange text rgb(194, 65, 12)` |
  `rgb(255, 138, 76)`, `month light|dark: header bar navy rgb(19, 41, 75)`, `active tab underline rgb(255, 95, 5)` |
  `rgb(255, 138, 76)`, `today ring …`, `3 pill colour(s) match the id-keyed table`, `page background rgb(246, 248, 251)` |
  `rgb(11, 26, 51)`; screenshots `signin-light.png`, `signin-dark.png`, `theme-month-light.png`, `theme-month-dark.png`,
  `calendar-oct-2026.png`, `calendar-oct-dark.png`. `SMOKE FAILED: 4 problem(s)`, none of them TH: the standing `Import apply`
  live-state drift and three Acton "no target" lines (`Fairness view`, `Totals CSV`, `Fairness dark`) that appeared only in the
  two slowest runs after the same run had printed `Totals target: Acton … shows Target 10` — the in-session Rules-card target
  replaced by the 60-s live-blob refresh on a loaded machine (absent in the baseline and in runs 1–2 of the same code).

Live actions for the orchestrator: none for TH beyond the ordinary push of `main` (CI builds `index.html` and bumps the version;
the manifest / icons / theme reach Pages with it). After the deploy: installed PWAs refresh the icon and the `#FF5F05` splash
on their next manifest check; iOS may need the home-screen icon removed and re-added. The smoke's `Import apply` FAIL seen in
every run tonight is live-state drift outside TH (the Thanksgiving backups vs the seed-owned rows), unchanged from the baseline.

**Review fixes (wave 9 review of TH, same night, before the commit):**
- *Blocking — the `.ics` download buttons:* the one remaining `css.badge(idx, s.name)` call (Calendar tools card) fell through
  `rosterColors` to the fallback set (Khan/Philip brown, Burchett/Fierce indigo, Acton/Sarkar green) and, in dark mode, the
  generic button rule painted their labels `#C9D6E8` on the light tints (≈1.3:1). Fixed: the call passes the roster entry; both
  roster-pill buttons (.ics downloads, calendar-sync URLs) carry `data-pill="1"`; the dark sheet's generic button rule is
  `button:where(:not([data-pill]):not([data-tab]):not([aria-label="Notifications"]))` — keyed on markers, no tint literals —
  so pill buttons keep their own text/tint and the nav tabs / Alerts bell keep their inline colours (active tab white, inactive
  `#DCE5F2`, on the navy bar in both themes — the "active tab label greyed in dark" minor falls out of the same rule).
- *Major — dark Fairness bars:* the fill was `THEME.light.primaryStart → primaryEnd` (`#13294B → #1F3A6B`) on a `#13294B`
  track (1.00:1 / 1.30:1). Fixed with tokens: `T.barTrack` / `T.barStart` / `T.barEnd` in both themes (light `#EEF1F4` /
  `#13294B` / `#1F3A6B` = 12.81 / 9.88:1; dark `#0F2140` / `#4A78D0` / `#5B8DEF` = 3.73 / 4.96:1); `TotalsCard` resolves
  `T = THEME[dk ? "dark" : "light"]` (the under-target colour uses `T.primaryEnd`); the track / fill carry
  `data-testid="fairness-track"` / `"fairness-fill"`. `THEME.light.` no longer appears in the JSX (the three sites in
  components without a `dk` prop — GeneratePanel, SeedImportCard, UsersCard — use `LIGHT.title`, re-painted by the dark sheet
  like every `css.*` literal).
- *Major — `helpers.js` export CSS:* `.hd a` → `#C2410C`, `.ro` / `.wh` → `#13294B`, the printable toolbar button →
  `linear-gradient(135deg,#13294B,#1F3A6B)` with a `#13294B` border; `helpers.js` is now in the failing set of the R.4 grep
  (data-layer pin + smoke). This is an edit outside TH's original file list, made because the review's R.4 grep set names
  helpers.js and the share page is what the ER-panel author and the office receive.
- *Major — the `surgeonColors` rebinding:* removed from `app-styles.js`. `helpers.js exportColorsFor(entry, idx)` tries
  `rosterColors(entry, idx)` first (id / type-keyed: an outside surgeon's export pill and legend swatch are grey with
  `border-style:dashed`), then config.js `surgeonColors` where only that is loaded, then the local palette (Node);
  `exportColorsFor` is exported for tests. Pinned by loading `app-styles.js` + `helpers.js` in one vm context
  (`s1 → #1F3A6B`, external → `#737373` dashed).
- *Minors:* light `onAccent` = `#13294B` (count-badge digits navy on `#FF5F05`, 4.76:1, re-classed as **text** in the contrast
  table; dark stays `#0B1A33` on `#FF8A4C`, 7.43:1); the off-palette blues are tokens (weekend header text
  `dk ? T.muted : T.title`, weekend bracket `T.navyMuted`, unread notification `T.accentTint` + `T.accent` border); the TH
  month probes press Escape / wait for a detached Day editor / click "Skip the notice" before the Settings click, so upstream
  drift no longer blocks the theme evidence (in the baseline run the Day editor drift FAIL was followed by both month probes
  still producing results and screenshots). Not changed: Burchett's `#D9561A` on white (3.96:1) — Faraz's O.3 pick, 600-weight,
  declared in the 3:1 class; the generator budget (see Gates).
- *Pins added:* data-layer — `css.badge` never called with `.name`, `data-pill` ×2, the marker-keyed dark rule and zero tint
  `:not()` clauses; `T.bar*` tokens with both stops ≥ 3:1 and `onAccent` ≥ 4.5:1; no `THEME.light.` in the JSX; the vm
  export-colour check; the four blues gone. contrast.mjs — count-badge digits as text, fairness fill start / end, the three
  fallback pills (94 pairs). Smoke — the `.ics` buttons measured against the id-keyed table with ≥ 3:1 in both themes, the
  active-tab label white and distinct from the inactive tabs, the dark Fairness fill stops vs track ≥ 3:1, helpers.js in the
  grep. **Fail-before, verbatim** (unchanged app code, new pins): data-layer `FAIL O.1 light tokens … -> + onAccent: '#FFFFFF'
  - onAccent: '#13294B'`; `FAIL R.4 … -> + 'helpers.js: #1a6fa8 x5', + 'helpers.js: #2488c8 x1'`; `FAIL review: every css.badge
  call passes the roster entry … -> css.badge called with a surgeon NAME … 1 !== 0`; `FAIL review: the Fairness bars use theme
  tokens … -> THEME.light hard-wired in the JSX … 7 !== 0`; `FAIL review: exports resolve colours through rosterColors … ->
  app-styles.js rebinds the config.js surgeonColors declaration … 2 !== 0`; `FAIL review: the grid's weekend header … ->
  #3d6a8c remains`; contrast.mjs `Error: not a 6-digit hex colour: undefined`; smoke (byte copy of the unchanged app code)
  `FAIL Fairness dark: bar fill / track not measurable: … Failed to find element matching selector "[data-testid=fairness-view]
  [data-testid=fairness-track]"`, `FAIL theme grep: … helpers.js: #1a6fa8 x5, helpers.js: #2488c8 x1`, `FAIL month light: .ics
  pill buttons off the id-keyed table / under 3:1: FAK rgb(138, 75, 31) on rgb(248, 236, 224) solid 5.81:1 (want rgb(31, 58, 107)
  on rgb(232, 238, 248)); …`, `FAIL month dark: the active tab label is rgb(201, 214, 232) (inactive rgb(201, 214, 232)) -
  expected white, distinct from the inactive tabs`, `FAIL month dark: .ics pill buttons … FAK rgb(201, 214, 232) on rgb(248,
  236, 224) solid 1.27:1 …`.
- *After the fixes:* data-layer `97 passed, 0 failed`; contrast.mjs `all 94 pairs meet their minimum`; exports `41 passed`,
  week-rows `16 passed`; `npm test` green in every suite with the generator regression in budget on a quiet moment
  (`ok 276930 assertions … (6948 ms total; budget 10000 ms)`); `node build.js` `OK  build complete`, `index.html` / `version.json`
  restored. Smoke (worktree, fixed code): `theme contrast: all 94 token pairs meet their minimum (28 text pairs at 4.5:1, 66 label /
  glyph pairs at 3:1)`, `theme grep: … absent outside comments in index-source.html, app-styles.js, manifest.json, config.js,
  helpers.js`, `month light|dark: active tab label white, inactive rgb(220, 229, 242)`, `month light|dark: 6 .ics pill buttons match
  the id-keyed table, all >= 3:1 - FAK rgb(31, 58, 107), MAB rgb(217, 86, 26), BDA rgb(15, 118, 110), AFP rgb(107, 63, 160), NF
  rgb(107, 127, 26), SRK rgb(71, 85, 105)`, `Fairness dark: bar fill #4a78d0 -> #5b8def on track #0f2140 = 3.73:1 / 4.96:1`,
  `share page: Khan's pill carries the theme navy #1F3A6B`, every sign-in / month / today-ring / OPEN / page-background line `ok`;
  screenshots `signin-light.png`, `signin-dark.png`, `theme-month-light.png`, `theme-month-dark.png`, `fairness-dark.png`,
  `calendar-oct-2026.png`, `calendar-oct-dark.png`. `SMOKE FAILED: 5 problem(s)`, all live-state drift present in the baseline run
  of the unchanged app code (the live rows now run to 2027-01-03, so 10/7 is no longer OPEN and the 11/2–12/13 ER table has no OPEN
  span): `FAIL week row 10/5 lacks '10/7 OPEN' …`, `FAIL Copy for Word: text/html flavour is not the 6-row ER table …`, `FAIL Day
  editor fail-closed: picking a surgeon must not open the override confirm nor set the draft (override=false, draft='s5')` and the
  two `harness exception: page.click: Timeout 30000ms exceeded` lines that follow it (small items, Slice E). The earlier `Import
  apply` drift line is gone.

## Review fixes 2 — RF2, app safety (whole-branch review, 9/23 overnight; appended by Claude Code)

Five confirmed findings of the whole-branch review, all on the deploy set, none touching the published rows:

- **(a) Accept & Publish counted only LOCKED replacements.** An unlocked manual / trade / claim / generated / import
  holder inside the Generate range was regenerated and written for every viewer without a word. Now `acceptPreview`
  builds a second list — `suHeldUnlockedSlotChanges(cur, next)` (index-source.html, pure, module level): every
  primary / backup change of `diffScheduleDays` whose CURRENT holder is a surgeon or an external cover and whose role
  is not locked — and, when it is non-empty, the confirm (the same one as the locked prompt, which keeps its sentence)
  reads "N held but unlocked assignment(s) will be replaced: 10/24 P Khan -> Acton, ... (tick 'Fill open slots only'
  to keep every held day)". Cancel writes nothing (the confirm precedes the snapshot). The post-snapshot re-derivation
  re-checks both lists. Proof: `test/data-layer.test.js` [RF2] (the helper is extracted into the helpers sandbox and
  exercised on synthetic maps; source pins on the order), `test/ui/smoke.mjs` (the confirm on both Accept clicks,
  its count derived from the preview grid vs the live rows' lock flags).
- **(b) Keepalive flush during a long publish.** `syncScheduleDays` counts its runs from enqueue to settle
  (`daySyncBusyRef`); while the count is > 0 the flush skips ONLY its `schedule_days` leg (logs it, re-arms the
  pending payload) and still runs the blob leg, so a phone locked mid-way through Accept & Publish no longer fires
  parallel PATCHes for the same days at the same versions. Proof: data-layer source pins; smoke step (e) holds a CAS
  write open for 5 s (`delayScheduleWriteMs`), fires `visibilitychange` with a second edit pending, asserts zero
  schedule_days writes from the flush, the warn, the blob POST, and that the skipped edit lands afterwards.
- **(c) Fill open slots only + the seed.** GeneratePanel: "Fill open slots only (keep every held day)"
  (`gen-fill-open-only`, default off) passes `{ fillOpenOnly: true }` to `generate()` (item T's option — the mode the
  command-line preview used), kept on re-roll, named in the run toast, the preview meta line and the audit detail; the
  Seed placeholder reads `random - the toast shows the seed` (the toast and the meta line already showed it — confirmed,
  pinned). Guide §12 one line.
- **(d) A seed re-import silently reverted Setup edits.** `scripts/import-seed.js` `fetchLive` now selects the blob's
  `updated_by`; `importer.impBlobOwner(live)` says who wrote it last (the app stamps the person_id from the autosave
  and the in-app Apply — read off `applyTablesUpsert` / the blob upsert — the CLI stamps `seed`). When it is not
  `seed` the plan prints "BLOB WAS EDITED IN THE APP at <ts> by <who>: a re-import would revert Setup edits" and
  `--apply` refuses (exit 4) whenever the plan would change the blob, unless `--overwrite-blob` is given; rows are
  unaffected by the guard. Live on 9/23 05:27Z the blob is still `seed`-owned (anon read), so tonight's re-import
  needs no flag. Proof: `test/importer.test.js` RF2 (synthetic live metadata + CLI source pins).
- **(e) `settings.seedRevisions` in the anon-readable blob.** 15 paragraphs (~17 KB) of internal history were readable
  with the public key. `importer.js` now writes `seedRevisionCount` + `seedLastRevision` (the date prefix of the last
  entry) — the paragraphs stay in the seed. The settings merge is one level deep, so the retired key is removed
  explicitly: the SQL subtracts it (`(coalesce(data -> 'settings', '{}') - 'seedRevisions') || <settings>`) in the
  SET **and** in the idempotency WHERE (a live row still carrying it IS a change), `planDiff` reads such a live blob as
  `settings=update`, and the in-app Apply deletes `IMP_RETIRED_SETTINGS_KEYS` from the merged settings. The next
  `import-seed.js --apply` (orchestrator) therefore removes the paragraphs from the live blob; until then the in-app
  dry run against the live project shows exactly one change (settings=update) — the smoke derives that drift from a
  read-only read of the live settings keys and requires zero again once the key is gone.

Gates: `node test/importer.test.js` → `ok 766 assertions`; `node test/data-layer.test.js` → `91 passed, 0 failed`
(fail-before `82 passed, 9 failed`); `node build.js` → `OK  build complete` then `git checkout -- index.html version.json`;
`SILVIS_GEN_BUDGET_MS=40000 npm test` and `npm run smoke` as reported in the RF2 delivery.

### Review of RF2 (same night, 9/23 overnight) - eight findings, all addressed

- **(d) major x2 - the guard keyed on `updated_by` alone.** The autosave upserts the blob with `updated_by = person_id`
  on ANY state change (a day edit, a trade, a realtime adopt of a foreign write), so after the first app session every
  re-import that touched the blob would have printed BLOB WAS EDITED and demanded `--overwrite-blob` - the flag would
  have become routine and finding 38's failure mode would have returned under a flag. Now content-based: `importPlan`
  stamps `settings.seedCoreHash = impCoreHash(blob)` (canonical JSON of the pool roster rows, surgeonRules, groupRules,
  holidays; two FNV-1a lanes, pure JS because importer.js also runs in the browser); the CLI hashes the LIVE blob's
  same keys (`impBlobEditState`) and reads app-edited only when a stamp is present and differs. `updated_by` is still
  printed ("blob last written by <who> at <ts>") and is the verdict only while the live row carries no stamp (tonight's
  row: `seed`, no stamp -> importer-owned; the next `--apply` writes the stamp). `--apply` refuses (exit 4) only when a
  CORE key would change (`coreWouldChange`); a settings-only plan reads "settings keys only - nothing under Setup is
  reverted". Consequence in `planDiff`: a seed change under a core key now counts 2 blob updates (the key + settings,
  the stamp follows) - three older assertions restated.
- **(d) minor - fresh install exit 4.** `sql/schema.sql` seeds `('main', '{}')` with `updated_at` default now(); an
  empty data object is now no row whatever `updated_at` says (`impBlobOwner`).
- **(b) major - pagehide / beforeunload.** The busy skip applied on every flush source; on pagehide / beforeunload the
  chain dies with the page and nobody would have written the remaining days. The skip is now `visibilitychange` only
  (page alive); the other two sources keep the keepalive days leg (a CAS duplicate matches zero rows at the DB).
- **(b) minor - the re-armed payload had no consumer.** The skip branch also calls `syncScheduleDays(payload.schedule)`:
  the days queue behind the in-flight run and land when it settles even if the debounce timer never fires; a later
  timer run is a no-op against `lastSyncRef`. The comment says a never-settling fetch keeps the count > 0 by design.
- **(c) minor - mode not in the diagnostics.** `GenDiagnostics` prints `mode <generate|fill-open-only>, fixed slots N`
  (`gen-mode`) next to the score line.
- **(a) minor - pointer text.** "(tick 'Fill open slots only' ...)" is appended only when the preview did not run
  fill-open-only.
- **(a) minor - the positive confirm branch never ran.** The smoke fixture now carries one held but UNLOCKED November
  day (2026-11-19 backup s2, source generated - the shape of the published rows) inside the Generate range; under
  `SMOKE_FIXTURE=1` the harness REQUIRES that slot in its derived list, so the confirm is shown, counted and matched.
  The importer ignores an app-generated row the seed lacks, so the Import pins are unaffected.

Gates after the review fixes: `node test/importer.test.js` -> `ok 788 assertions` (fail-before
`TypeError: IMP.impCoreHash is not a function`); `node test/data-layer.test.js` -> `91 passed, 0 failed` (fail-before
`88 passed, 3 failed`: the visibilitychange-only guard, the conditional pointer, the gen-mode line);
`SILVIS_GEN_BUDGET_MS=40000 npm test` -> exit 0; `node build.js` -> `OK  build complete` then
`git checkout -- index.html version.json`; the fixture smoke as reported in the commit message.
Fixture smoke (`SMOKE_FIXTURE=1`, two runs): every RF2 assertion ok, including the positive Accept confirm ("1 held but
unlocked assignment(s) will be replaced: 11/19 B Burchett -> Philip ... - 1 held but unlocked assignment(s) = derived")
and `RF2 GenDiagnostics: mode generate, fixed slots 33`; the Import apply dry run now reads 3 changes (surgeonRules +
settings + 1 availability insert). The only fail left is the pre-existing stale pin at test/ui/smoke.mjs:2801 (37 plan
rows / 4 kept vs the 48-row plan / kept 15). Run 1 also tripped the timing-dependent "Rules: the saved blob carries
surgeonRules.s1.primaryContribution" pin once (the harness grabs the last blob POST as soon as any POST appears, so an
autosave from an earlier state change can land first); it passed on run 2 and is unrelated to RF2.

## Item IB — `import-seed --apply` keeps app-edited days, as the app's Apply does (9/23 overnight; appended by Claude Code)

**Observed.** After the server-side publish (item PUB: 70 rows, `updated_by 'publish-preview (Faraz, 2026-09-23
overnight)'`, versions bumped, `source 'import'` kept on the updated locked days) every seed re-import saw 31 plan days
whose live row is app-owned. The dry run listed them as BLOCKED (correct) and read `Total changes: 3 (+32 blocked)` — 32
blocked slot lines over 31 days (10/24 has P and B) — but `--apply` refused with exit 3 ("refused to apply over app-edited
days ... Resolve them in the app (or update the seed) and re-run"), so the three pending blob-only changes (settings:
`seedRevisions` retired + `seedCoreHash` stamp; roster s6 `fullName ''`; `groupRules.timeOff.conflictRule`) could not
land, and no future re-import could while a schedule is published. The app's Setup → Import → Apply keeps such days
("kept (app-edited)", `helpers.suSeedDayMerge`) and applies the rest; the CLI now agrees.

**Change.** `importer.js`: `planDiff` also returns `blockedDays` (ISO, sorted, deduped; the per-slot `blocked` line list
is unchanged); `importSql(plan, { excludeDays })` filters those days out of BOTH `impSqlScheduleDays` and
`impSqlStaleScheduleDays` (no VALUES row, not in the stale delete's `NOT IN` key list — the row is app-owned, so that
delete's `source = 'import' and updated_by = 'seed'` clause could never reach it anyway; the comment says "N app-edited
day(s) kept out of this key list", never the days) and the header reads `42 schedule_days (31 app-edited day(s) kept, not
written)`; no option / empty list / unknown days → byte-identical SQL; every plan day kept → the no-wipe valve (no delete
at all). `scripts/import-seed.js`: the SQL is always built with `excludeDays: diff.blockedDays` (dry run and apply, so the
file on disk never carries a blocked day's statement); the exit decision moved into a pure exported `decideApply(diff,
owner, coreWouldChange, args)` → `{ code, proceed, lines }` in today's order — 3 only under the new `--strict-blocked`
flag (the old fail-closed refusal, nothing written), 4 the RF2 blob guard untouched, 1 no workdir, 0 proceed (the KEPT
block prints the blocked list exactly as the dry run does) or nothing to apply; `verifyOutcome(verify, keptDays, strict)`
accepts a fresh plan reading `Total changes: 0 (+N blocked)` (under `--strict-blocked` a blocked day after the apply still
fails; a kept set that changed mid-run is NOTEd, never failed); `keptSummary(diff)` = `kept N app-edited day(s): <days>
(M blocked slot change(s))` in the dry-run line, the KEPT block and the VERIFIED line; `main()` runs only under
`require.main === module` so the test can require the helpers without a live fetch; the header's exit-code table
documents 0 (kept) and 3 (`--strict-blocked` only). availability / time_off keep their own ownership rules; the RF2 blob
guard (exit 4 / `--overwrite-blob`) is untouched. One older pin restated: the RF2 source pin `/return 4;/` became
`/code: 4, proceed: false/` (the decision returns an object now).

**Tests** (`test/importer.test.js`, IB block, test-first): a synthetic live set = the plan's rows with two app-owned
differing days (10/7 by `source 'generated'`, 11/29 by `updated_by` alone — both published shapes), one seed-owned
differing day (10/13 → update) and one seed-owned stale day (12/31 → delete): `blockedDays`, counts (blocked 2 / update 1
/ delete 1, `Total changes: 2 ... (+2 blocked)`), the stale list never carries a blocked day, the SQL's schedule_days
section has no statement for either day while 10/13 is written and keyed, 71 `::date` keys, the header, the 3a comment,
snapshot/blob/availability/time_off sections byte-identical, `decideApply` → `[0, proceed]` / `--strict-blocked` → 3 /
exit 4 before and after / `--overwrite-blob` lifts / no workdir → 1, `keptSummary`, and `verifyOutcome` on the
post-apply state reading `Total changes: 0 (+2 blocked)` → VERIFIED (strict → not; a remaining change → NOT FULLY
APPLIED; a grown blocked set → VERIFIED + NOTE; nothing kept → the old wording byte for byte). Fail-before (verbatim):
`AssertionError [ERR_ASSERTION]: RF2: --apply refuses (exit 4) over an app-written blob without --overwrite-blob (IB
restated the pin: ...)` — the run stops at the source pin before requiring the CLI, so a fail-before never touches the
network; pass-after `ok 848 assertions` (`ok 788` before IB).

**Read-only proof against the live project** (`node scripts/import-seed.js --dry-run`, anon key, nothing written):
still `Total changes: 3 (+32 blocked)`, `schedule_days: insert 0, update 0, delete 0, unchanged 42, BLOCKED 31`; the
summary now reads `dry-run: 3 change(s) would be applied; kept 31 app-edited day(s): 2026-10-07, ... 2026-11-29 (32
blocked slot change(s)) - not in the SQL; --apply keeps them as the app's Apply does, --strict-blocked would refuse
(exit 3).`; the SQL file (74017 bytes, header `42 schedule_days (31 app-edited day(s) kept, not written), 48 availability,
7 time_off rows`) was grepped for each of the 31 days listed as BLOCKED inside its schedule_days section (`-- 3a.` …
`-- 4a.`): **0 hits for every day** (before the change: 2 per day — the stale `NOT IN` list and the insert VALUES); 42
`::date` keys and 42 VALUES rows remain. (`'<day>'::date` still appears for some of those dates in the availability /
time_off sections — other tables' keys, unchanged by design.)

**Live, for the orchestrator (not run here):** `node scripts/import-seed.js --apply --workdir <linked>` — expect the KEPT
block (31 rows / 32 lines), 3 blob changes applied, `VERIFIED: the applied part is fully applied - a fresh plan reads
'Total changes: 0 (+32 blocked)'; kept 31 app-edited day(s): ...`, exit 0; then a fresh `--dry-run` reading
`Total changes: 0 (+32 blocked)`. Note the numbers: 31 days, 32 blocked slot lines.

**IB review fixes (same night, six minor findings, all addressed).** *(1 + 4) plan/SQL agreement when every plan day is
app-owned:* `importSql`'s filtered list was empty, so its "plan has no rows" valve suppressed the stale delete (an empty
`NOT IN` list is not valid SQL) while `planDiff` still promised the delete — `planDiff` now shares one state helper
(`impSdState`) and, when every plan day is blocked, reports the stale seed-owned days as KEPT (`[KEPT: every plan day is
app-owned (kept), so the SQL writes no schedule_days statement - seed-owned day not deleted]`, `delete 0`, `Total changes: 0
(+N blocked)`), and the 3a comment states the real reason (`every plan day is app-owned (N kept) - no stale delete
emitted ...`; the "plan has no rows" wording is reserved for a plan that truly has none). The conservative side was
chosen on purpose: no unlisted, wipe-shaped delete is ever emitted. Unreachable with today's live data (42 of 73 plan
days are seed-owned). *(2)* the guide §4.4 and the CLI header now name the pre-existing divergence: `source 'import'` +
NULL `updated_by` is seed-owned to the CLI (`coalesce(updated_by,'seed')`) but app-edited to `suSeedDayMerge`; left as is
(aligning it changes which live rows a re-import may touch — report-first, follow-up item); none of the 31 published
rows carries a NULL. *(3)* documented (header + §4.4): kept days keep their generated holders, so a seed vacation over a
kept day's holder trips the `ON_CALL_CONFLICT` trigger and rolls the whole import back (one transaction, exit 1, nothing
written); today's plan inserts no time_off row. *(5)* behavioural fail-befores reproduced and recorded below. *(6)*
`verifyOutcome` under `--strict-blocked` with 0 applied changes and blocked days prints `APPLIED, but app-edited day(s)
appeared during the run (--strict-blocked): <days> - they were not written and nothing may be kept under the flag;
remaining diff:` before the diff (still exit 1) instead of blaming the apply; the header's exit-1 entry says so.

Fail-befores (verbatim): the review-fix pins — `AssertionError [ERR_ASSERTION]: IB corner: with every plan day app-owned
the stale seed-owned day DS is KEPT, not promised as a delete (fail-before: delete 1, totalChanges 1)` (actual
`[1, 0, 1, 1]`) and `AssertionError [ERR_ASSERTION]: IB: strict + 0 applied changes + blocked days -> a distinct line
naming the days (fail-before: 'NOT FULLY APPLIED - remaining diff:')` (actual `'NOT FULLY APPLIED - remaining diff:'`).
The behavioural IB pins, reproduced by swapping in `HEAD:importer.js` against the new test and by a mutation that ignores
`excludeDays` (`var sdRows = plan.scheduleDayRows;`), the file restored byte-identically (sha 6d1c8c01) after each:
`AssertionError [ERR_ASSERTION]: IB: planDiff.blockedDays = the app-owned differing days, ISO, sorted (fail-before:
undefined)` and `AssertionError [ERR_ASSERTION]: IB: the schedule_days section of the SQL carries no statement for kept
day 2026-10-07 (fail-before: in the stale NOT IN list and in the insert VALUES)`. Pass-after `ok 859 assertions`
(`ok 848` after the first IB pass, `ok 788` before IB); `test/publish.test.js` `ok 186`. Live dry run re-run after the
fixes (read-only): exit 0, `Total changes: 3 (+32 blocked)`, `schedule_days: insert 0, update 0, delete 0, unchanged 42,
BLOCKED 31`, SQL 74017 bytes, 0 hits for each of the 31 BLOCKED days inside the schedule_days section (42 `::date` keys,
42 VALUES rows, one `NOT IN` delete), header unchanged.
