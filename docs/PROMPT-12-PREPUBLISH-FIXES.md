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
