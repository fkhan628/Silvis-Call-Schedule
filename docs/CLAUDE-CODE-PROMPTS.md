# Claude Code Prompts — Silvis Surgical Care Call Schedule

*Paste these into Claude Code one at a time, in order. Each prompt is self-contained, states what "done" looks like,
and ends with a stop so you can review. Start Claude Code in `<your home folder>\projects` for Prompt 0A (it creates the
repo folder); every later prompt runs inside `<your clone>`. The handoff files
(`CLAUDE.md`, `docs\*`, `sql\schema.sql`) are read from your OneDrive folder
`<the OneDrive folder>` — Prompt 0A copies them in.*

*Milestone that everything serves: a published Silvis schedule through 2026-12-31. Prompts 0A–8 get there; 9–11 are after.*

---

## Prompt 0A — Create the GitHub repo and seed it with the handoff docs

```
Create the new repo for the Silvis call schedule app. Show me every command before running it.
1. Preconditions: run `gh auth status` and `git --version`; confirm the GitHub account is fkhan628. If gh is not installed or not logged in, stop and tell me.
2. Create <your clone> and `git init -b main` inside it. Configure git identity REPO-LOCALLY (git config user.name / user.email — use the same values as the local clone at <your projects folder>\Call-Schedule-App; read them with `git -C ... config user.name`), never globally.
3. Copy the handoff files from "<the OneDrive folder>": CLAUDE.md → repo root; docs\SILVIS-BUILD-GUIDE.md, docs\SILVIS-CALL-RULES.md, docs\CLAUDE-CODE-PROMPTS.md, docs\silvis-seed.json → docs\; sql\schema.sql → sql\. Copy as bytes (Copy-Item / robocopy) — never Get-Content | Set-Content, which double-encodes UTF-8 (the Davenport mojibake incident). Verify with a byte-compare (fc /b or Get-FileHash) that each copy matches its source.
4. Add a .gitignore (node_modules, .DS_Store, *.log, .env*, index.html is NOT ignored — CI commits it).
5. Commit "Initial handoff docs" and create the GitHub repo: `gh repo create fkhan628/Silvis-Call-Schedule --public --source . --remote origin --push --description "Silvis Surgical Care daily primary/backup call schedule (React PWA + Supabase)"`.
6. Enable GitHub Pages from main / root: `gh api -X POST repos/fkhan628/Silvis-Call-Schedule/pages -f "source[branch]=main" -f "source[path]=/"` (if it says Pages already exists, use PUT with the same body). Show me the Pages URL it reports (expected https://fkhan628.github.io/Silvis-Call-Schedule/).
7. Check the Actions workflow-permissions setting: `gh api repos/fkhan628/Silvis-Call-Schedule/actions/permissions/workflow` — the build workflow declares `permissions: contents: write` itself, but confirm the repo does not restrict it to read-only; if default_workflow_permissions is "read" and can_approve_pull_request_reviews is false that is fine, just report it.
8. Print `git remote -v`, `git log --oneline`, and the repo URL. Stop. (Nothing deploys yet — there is no index.html until Prompt 1 builds one and CI commits it.)
```

## Prompt 0B — Sync the contact-free handoff docs, then orientation (no app code changes)

```
Step 1 — sync docs. The handoff docs were revised after Prompt 0A so that NO copy contains contact data (the repo and
OneDrive copies are now identical by design; the only contact file is silvis-contacts.md, which stays in OneDrive).
Byte-copy (Copy-Item, then SHA-256 compare) from "<the OneDrive folder>":
CLAUDE.md → root; docs\SILVIS-BUILD-GUIDE.md, docs\SILVIS-CALL-RULES.md, docs\CLAUDE-CODE-PROMPTS.md, docs\silvis-seed.json → docs\; sql\schema.sql → sql\.
Do NOT copy silvis-contacts.md. Add `silvis-contacts.md` to .gitignore. Then prove the tree is clean:
  git grep -nE "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}" -- . ':!*.yml'   → must print nothing
  git grep -nE "\b[0-9]{3}[-.][0-9]{3}[-.][0-9]{4}\b"                          → must print nothing
Commit "Sync contact-free handoff docs" and push. Show the grep output and the commit hash.

Step 2 — orientation. Read CLAUDE.md, docs/SILVIS-BUILD-GUIDE.md (especially §3.1 Contact data policy),
docs/SILVIS-CALL-RULES.md and docs/silvis-seed.json in full. The Davenport reference clone already exists at
../davenport-ref (read-only; never edit it): read its CLAUDE.md, build.js, config.js (all of it), helpers.js, the top
120 lines of generator.js, and the structure of index-source.html (list the views, the load/publish/snapshot functions,
the auth gate, the exports).

Report back, in prose, no code yet:
1. The reuse map you will follow (what you'll copy verbatim, adapt, rewrite, drop) — compare it to guide §2 and flag any disagreement.
2. Every place in index-source.html that assumes the weekly shift model (dayCall/nights/wknd/backup weeks/APPs) — a numbered list with line ranges, so we can see the blast radius before touching anything.
3. Any open question in docs/SILVIS-CALL-RULES.md §8 whose answer changes the code you would write in Prompts 1–4, and the default you'd take if unanswered.
Stop and wait for my go-ahead.
```

*(After Prompt 1 is green locally, commit and push — that first push to main is what makes CI build `index.html` and Pages go live. Watch the Actions run and confirm the bot's `[skip ci]` commit lands.)*

## Prompt 1 — Scaffold the repo from the Davenport clone

```
Create the Silvis-Call-Schedule repo scaffold from ../davenport-ref, following guide §2:
- Copy verbatim: build.js, bump-version.js, .github/workflows/*.yml, app-styles.js, package.json (rename to silvis-call-schedule-build), .gitignore, icons (we'll recolor later), manifest.json (retitle "Silvis Call" / "Silvis Surgical Care Call Schedule", theme color distinct from Davenport's).
- Copy config.js and immediately: set SUPABASE_URL = "https://bzhsroegtagqhutbnsrp.supabase.co", leave SUPABASE_ANON_KEY as the literal placeholder "PASTE_SILVIS_ANON_KEY" (I will paste it), rename every localStorage key prefix dsg- → silvis-, delete INIT_APPS/APP_PAL/SURGEON_DEPTS/DEPT_LABELS/COUNTS_*/MAY_AUG_*/HAND_SCHEDULE_*/HOLIDAY_PRESETS/NIGHT_KEYS/ALL_SHIFT_KEYS/SHIFT_LABELS/SHIFT_TIMES/SHIFT_ICONS/SCHEDULE_PERIOD_WEEKS/VACATION_DEADLINE_WEEKS_BEFORE/MIN_AVAILABLE_SURGEONS, and replace INIT_SURGEONS with the six-surgeon roster from docs/silvis-seed.json (ids, name, code, fullName, active, roles — NO email field; no Atwell). Contact data never enters config.js or any tracked file (guide §3.1). Keep the DB client, safeguards (payloadLooksWiped, snapshots), auth, dbAuth and biometric objects byte-for-byte — these are the "safety features" and "data management" that must carry over.
- Copy helpers.js; keep fmt/parse/addD/monOf/getMondays/onVac/icsDate/generateICS/downloadICS/downloadJSON; stub buildICSEvents, slotLabel, tradeLegsText and buildPrintableCalendarHTML with TODO comments referencing Prompt 8 (they must still parse).
- Copy index-source.html and do ONLY these edits now: <title> and header text → "Silvis Call Schedule"; remove the OneSignal script tags and OneSignalSDKWorker.js; change APP_VERSION to "2026.09.21a"; add rules.js, generator.js and east-feed.js to the module loader list. Do NOT retarget the shift model yet — the app may render broken cells; that is expected until Prompt 6.
- Create empty-but-valid rules.js, generator.js (exporting generate() that returns { schedule:{}, diagnostics:{ uncovered:[] } }), east-feed.js, test/rules.test.js and test/generator-regression.js (each exits 0 with a "no tests yet" line).
- Add `node test/rules.test.js && node test/generator-regression.js` as a CI step before the build, mirroring how Davenport runs its regression harness.
- Write README.md (short) and docs/ as given.
Run `npm install`, `node build.js`, and show me the gate output. Do not commit; show `git status` and stop.
```

## Prompt 2 — Apply the schema and prove RLS (report-first)

```
Read sql/schema.sql. Do not modify it yet. Produce a report that (a) explains each table's purpose in one line, (b) lists every RLS policy with who can read/write, (c) calls out anything you believe is wrong or risky (recursion in silvis_role(), missing indexes, the self-update policy, anon exposure). Wait for my approval.

After approval: I will paste the schema into the Supabase SQL editor, sign up once through the app's auth screen, and promote myself to admin/s1 with the SQL comment at the bottom of the file. You then write scripts/verify-rls.sh that runs the curl checks at the bottom of schema.sql (anon read OK; anon write blocked; scheduler JWT write OK; time_off ON_CALL_CONFLICT trigger fires — I will paste a JWT into an env var, never into a file) and prints PASS/FAIL per check. Run it and show the raw HTTP status lines. Also write docs/ONBOARDING.md: how I invite each surgeon from the Supabase dashboard (Auth → Users → Invite user) using my private contacts file, and how Setup → Users links the new auth user to a roster id and role. Stop.
```

## Prompt 3 — rules.js: patterns + eligibility (pure, tested)

```
Implement rules.js exactly per guide §5 and docs/SILVIS-CALL-RULES.md §3–§4. Pure functions only, no DOM, no fetch, loadable both by the browser (global functions like the other modules) and by Node tests (guard with `if (typeof module !== "undefined") module.exports = {...}`).

Required API:
- matchesPattern(dateStr, pattern) supporting { weekday, nth:[...] }, { weekday, nthWeekOfMonth:n } (the week containing the nth occurrence of that weekday's anchor — define "week containing the 3rd Wednesday" precisely and document it), { weekday, beforeNthMonday:[...] }, { weekday } (every), and explicit date lists.
- buildContext({ roster, surgeonRules, groupRules, timeOffRows, availabilityRows, eastBusyDays, eastDerived, holidays, schedule, tallies }) → ctx with precomputed per-surgeon maps.
- eligibility(ctx, dateStr, role, surgeonId) → { ok, hard:[string], soft:[{reason, weight}] } implementing every hard block and soft penalty listed in guide §5, including: whitelist-vs-blacklist availability semantics per month, vacation-only time off (no no-call kind) with trailing-edge logic (a vacation day also blocks the day before), holiday units (a unit's days must share one primary and one backup; `neverThanksgiving`, `maxMajorHolidays`), Khan's weekdays (Mon/Wed auto-offered when East is clear; Tue/Thu never), East busy days blocking primary but not backup (eastBlocksPrimary/eastBlocksBackup), Philip's day-before-Aledo, Fierce's weekday pattern outside his derived weeks (Tue/Thu none; Mon backup-only; Wed preferred; Fri only as the start of a Fri+Sat+Sun block) and his 14-day cap that counts East week days, `monthlyCap: null` meaning no cap (Acton, Khan) rather than the group default, Sarkar's window whitelist plus never-Fri/Sun and 3–4 days per window week, maxConsecutiveDays, monthlyCap.total, backupCap, maxMajorHolidays, neverThanksgiving, externalCover days.
- weekendUnitPatterns(ctx, fridayStr) → legal patterns [{ kind:"block"|"split"|"daily", members:{fri,sat,sun}, penalty }] using eligibility().
- holidayUnits(ctx, startDate, endDate) → [{ name, tier, days:[...] }] from config.holidays.units[year], and holidayUnitCandidates(ctx, unit, role) → surgeons eligible for EVERY day of the unit.

Then write test/rules.test.js (plain Node asserts, no framework) covering at least: 2nd/4th Monday across a month that starts on Tuesday and one that starts on Monday; the 3rd-week Friday for Nov 2026 and Feb 2027; Sunday-before-2nd-Monday when the month starts on Sunday; Sarkar whitelist (10/19–10/24 eligible, 10/25 not; 10/23 (Fri) and every Sunday blocked; 10/24 (Sat) allowed; a 5th day in her window week blocked); Burchett December list; Acton 2026-11-19..22 blocked and 11-18 blocked as day-before-vacation; Khan 2026-11-03 (Tue) hard-blocked, 2026-11-02 (Mon) allowed when East is clear and blocked for primary but allowed for backup when East-busy, 2026-11-06..08 weekend allowed unless East-busy; Philip 2026-11-03 (Tue before 1st Wed Aledo) blocked, 2026-11-19 (Thu before 3rd-week Fri) blocked; Fierce 2026-11-10 (Tue) blocked outside a derived week, 2026-11-02 (Mon) blocked for primary but allowed for backup, 2026-11-06 (Fri) blocked as a standalone day but legal inside a 11/06–11/08 block, 2026-11-18 (Wed) allowed with a 'preferred' bonus, 2026-11-11 (Wed of his East-primary week) forced to backup by the derived lock, and a 15th call day in a month blocked by his 14-day cap counting East days; maxConsecutive 2 for Burchett after two assigned days.
Run the tests, show the output, and stop. Do not touch index-source.html.
```

## Prompt 4 — generator.js + regression harness

```
Implement generator.js per guide §6 using rules.js only for eligibility (never re-implement a rule inside the generator). Signature: generate(ctx, startDate, endDate, { seed, bestOf=200, respectLocks=true }) → { schedule, diagnostics }. Deterministic per seed (use a small seeded PRNG, not Math.random). Pipeline: seed locks (existing, manual, East-derived Fierce weeks) → build units (holiday units first — one primary + one backup sticking through every day of the unit, pre-empting overlapping weekend days — then weekend units, then day units) → primary pass (most-constrained-first, pattern scoring) → backup pass → repair (1-hop and 2-hop swaps through eligibility) → target smoothing → score. Diagnostics must include per-surgeon tallies (primary shifts, backup shifts, weekend days, major/minor holidays, max consecutive, month totals vs cap/target — one 24-h day = one shift, nothing weighted), uncovered slots with per-surgeon blocking reasons, soft penalties incurred, and the score breakdown. Also export rangePresets(lastPublishedDay) → [{label:"Through end of year", start, end}, {label:"3 months", ...}, 6, 9, 12] for the UI.

Then rewrite test/generator-regression.js to build ctx from docs/silvis-seed.json plus a synthetic East feed (Fierce: East-primary week 2026-11-09, East-backup week 2026-12-07; Khan East-busy: 2026-11-13..15, 2026-11-23..28 as a service week, and 2026-12-11..13), import existingAssignments as locks, and run 50 seeds × 3 ranges (2026-10-05→2026-11-01 with the imports locked; 2026-11-02→2026-12-31; 2027-01-01→2027-03-31). Assert every item in guide §12 independently (re-state the rules in the test; do not import rules.js except date helpers). Print a table of per-surgeon tallies for the median-score Nov–Dec candidate so I can eyeball fairness. All runs must finish under 10 s total.
Run it; show the output; stop. If any assertion fails, fix the generator, not the test, unless the test mis-states a rule — in that case quote the rule from docs/SILVIS-CALL-RULES.md and ask.
```

## Prompt 5 — Seed import + config blob

```
Add an importer (Setup → "Import seed") that reads docs/silvis-seed.json through a file picker (the repo copy is identical and may also be fetched) and writes: roster (id, name, code, fullName, active, roles — the importer REFUSES a file whose roster or site block contains email or phone fields, and never writes such fields; guide §3.1) → call_schedule_data.data.roster; surgeonRules/groupRules/holidays → the same blob; every dated statement (Sarkar windows, Burchett October/December lists incl. backup_only and unavailable, Acton October primary/backup lists, Philip available weeks, Philip no-backup dates) → availability rows with source "seed"; Acton's Nov 19–22 and Nov 25–29 and Philip's 10/15 → time_off rows (vacations only — there is no no-call kind); holidays.units per year → call_schedule_data.data.holidays; existingAssignments → schedule_days rows with locks, source, externalCover and notes (the email updates in pendingDeltas are already applied inside existingAssignments — show them as an informational list, nothing to apply). The import must be idempotent (re-running updates rather than duplicates: key availability rows on person+kind+role+start+end+source). Snapshot before writing. Show me the diff of what it would write (dry-run mode) before the real run. Then run it for real against the Silvis project, show row counts per table, and stop.
```

## Prompt 6 — Retarget the UI to the daily model (the big one — work in slices)

```
Retarget index-source.html to the daily primary/backup model per guide §8, in this order, building and showing me a screenshot (use the Playwright/Chromium that's installed, or describe if unavailable) after each slice:
Slice A — load/save/publish: replace schedule_weeks load/publish/CAS with schedule_days (per-row version CAS; publish diff lists changed days as "10/12 P Philip → Fierce"); retarget payloadLooksWiped and snapshots.capture to schedule_days/time_off/availability; keep the intentional-wipe ref, the once-per-session snapshot, the reloadTrigger second pass and the client_versions refresh banner working; remove APP shifts, backup-week state, no-call state and the vacation-request state entirely.
Slice B — calendar month grid: two-line cells (P name / B name), per-surgeon colors, OPEN in red, externalCover label, lock icon, "E" badge on East-derived rows, weekend bracket; month/year nav; surgeon filter.
Slice C — week rows list (the ER-panel author's layout) with collapsed ranges.
Slice D — day editor: eligibility-aware dropdowns (eligible first, ineligible greyed with the first hard reason), lock toggles, note, override-with-warning for the scheduler.
Slice E — Setup: roster; per-surgeon Rules editor (availability mode, recurring patterns with a "next 8 matching dates" preview, weekend style/partner, max consecutive, monthly cap/target, holiday rules, East feed toggle); Availability entry with paste-a-date-list; everyone's vacations (scheduler entry + override); Holidays editor (per year: each unit's days editable, primary + backup pickers, major/minor counts beside each name); Generate panel with range presets ("Through end of year" for this round, then 3 / 6 / 9 / 12 months from the last published day), N, preview → publish; import seed; office contacts; snapshots/restore and the rest of Settings → Data management (JSON backup/restore, export, import, factory reset behind the wipe guards).
Slice F — Totals: per surgeon by month, year-to-date and rolling 12 months — primary shifts, backup shifts, weekend days, major/minor holidays, max consecutive, each vs target/cap, plus a fairness view (deviation from target). One 24-h day = one shift; nothing weighted or split. No compensation or $ figures anywhere in the app.
Slice G — My Schedule; Time off (a surgeon enters their own vacation — no approval; if any day in the range has them published as primary or backup, refuse with the conflicting dates and a "propose a trade" shortcut — the DB trigger enforces the same rule; otherwise save, write an audit_log entry, notify); Trades by day+role with eligibility check for the recipient, accepted trades applied to the schedule with audit + notifications (scheduler can revert).
Keep Davenport's auth gate, toasts, dark mode, Collapsible, audit view, notification center. Every slice must pass node build.js. Stop after each slice for review.
```

## Prompt 7 — East feed (Davenport read-only integration)

```
Implement east-feed.js per guide §7: fetchEastWeeks(fromMonday, toMonday) using the Davenport project URL and anon key from ../davenport-ref/config.js (read-only; add a comment that this key is public by design and that we never write to that project); parse week rows {dayCall, nights:{mon,tue,wed,thu,wknd}, isBackup, isFierceBackup, holidayCoverage}; resolve FAK by matching the Davenport roster code; deriveKhanBusyDays(weeks, fakId, { eastBackupCountsAsBusy }) and deriveFierceWeeks(weeks) → [{ weekMonday, silvisRole:"primary"|"backup" }]. Cache into east_feed; apply east_overrides last. Add the Setup panel ("East feed: fetched …, N weeks, next Fierce primary week …", Refresh button, overrides table). Wire the generator: Fierce derived weeks become locks with source "east-derived"; Khan busy days feed eligibility. Unit-test the two derivations in test/rules.test.js with a hand-built week row. Fetch for real, show the derived list for Oct 2026–Jan 2027, and stop — I will confirm against the Davenport app before we generate.
```

## Prompt 8 — Generate and publish Nov 2 → Jan 3 (the milestone)

```
With imports locked and the East feed confirmed: run Generate for 2026-11-02 → 2027-01-03, bestOf 200. Show me (1) the calendar preview, (2) the per-surgeon tally table vs targets/caps, (3) every open slot with its reasons, (4) every soft penalty incurred, grouped by surgeon. Do not publish. I will adjust rules/availability and ask you to regenerate; when I say "publish", snapshot, publish with the diff dialog, verify the rows in Supabase with a count per month, and stop.
```

## Prompt 9 — Exports

```
Implement guide §9: per-surgeon and full-group .ics (07:00→07:00 next day, America/Chicago, titles "Silvis Primary Call"/"Silvis Backup Call"); the shareable read-only HTML page; the printable month; and the ER Call Panels export for the ER-panel author — an HTML table in her exact layout (MON/SUN DATES | TRAUMA | TRAUMA BACKUP, one row per Mon–Sun week, "M/D Name" entries, same-surgeon consecutive days collapsed to "M/D–M/D Name", open days in red) with a "Copy for Word" button that writes text/html to the clipboard. Generate the panel for 11/2–12/13 and show it side by side with the layout in docs/SILVIS-CALL-RULES.md §7 so I can compare. Stop.
```

## Prompt 10 — Edge functions: calendar sync, office notifications, email, reminders (report-first)

```
I have copied the Davenport edge-function sources into ../silvis-edge-src/ (calendar-sync, office-notifications, send-notification, daily-reminder — from my OneDrive Call Schedule App\edge-functions folder). Read all four plus the Davenport CLAUDE.md "Deploy path 2" section. Report first: for each function, what reads schedule_weeks / week+shift slots / APP data / vacation requests and must be retargeted to schedule_days + day+role, what secrets it needs (never commit them), and the verify_jwt setting it must keep (calendar-sync OFF). Wait for approval.

After approval, write the retargeted sources into edge-functions/<slug>/index.ts in the repo (these are deployed by hand with the Supabase CLI, --no-verify-jwt, exactly like Davenport): calendar-sync serves a per-surgeon ICS feed by ?surgeon=<CODE> (07:00→07:00 events, "Silvis Primary Call"/"Silvis Backup Call") and a full-group feed; office-notifications sends the publish/change digest to office_contacts; send-notification emails per notification_preferences; daily-reminder sends the next-day shift reminder at each user's Central hour. Give me the four deploy commands and the verification for each: an unauthenticated GET to calendar-sync must return 200 + BEGIN:VCALENDAR; one real office email; one real reminder. Stop before any invoke that could send real mail.
```

## Prompt 11 — Hardening

```
Do a hardening pass: every empty catch block gets a console.warn + user-visible toast where the user initiated the action; mobile layout pass at 390px width (screenshots); audit_log entries for publish, manual edit, lock, import, vacation entry, trade apply, restore; verify the refresh banner by bumping client_versions.min_version; verify data management end-to-end (JSON backup → intentional wipe through the guarded path → restore from snapshot → byte-compare); a "coverage at a glance" strip (open primary/backup counts for the next 60 days). Stop.
```

---

### How to run these well

- Keep the Davenport clone at `../davenport-ref` for the whole build; it's the reference for every "copy verbatim" instruction.
- After each prompt, run `git add -A && git commit` yourself (the prompts intentionally do not commit).
- Push to `main` only after Prompt 1 is green locally; from then on every push is a live deploy. The first CI run proves the pipeline: it must commit `index.html` back with `[skip ci]` and Pages must serve the shell at https://fkhan628.github.io/Silvis-Call-Schedule/.
- When a rule changes (an answered open question, a new availability email), update `docs/SILVIS-CALL-RULES.md` and `docs/silvis-seed.json` first, then tell Claude Code: "Rules changed — re-read docs/SILVIS-CALL-RULES.md §3 and update rules.js, the regression test, and the seed importer to match."
- Before Prompt 10, copy the four Davenport edge-function sources from your OneDrive `Call Schedule App\edge-functions\` folder into `../silvis-edge-src/` next to the repo.
