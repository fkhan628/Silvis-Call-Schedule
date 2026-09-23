# Prompt 15 — East vacations: mirror Khan's Davenport time off, with an "away / home" choice

*Paste into Claude Code inside `<your clone>` after Prompt 13 (it uses the Setup → East
feed panel and the self-service time-off path; the last step uses Prompt 14's offers when they exist). Faraz, 9/22
evening: "I wonder if I can transfer my vacations over to Silvis as well. The issue is that there are days where I am
on vacation at East, where we are not going anywhere, and I can cover call at Silvis." So: pull his Davenport time off
into Silvis, but let him mark each range **away** (also off at Silvis) or **home** (available at Silvis — and those are
his best Silvis days, because a Davenport vacation day has no East call and no OR block). Generic `eastFeed` feature
for any surgeon with an East code; only Khan has one today. Same ground rules as every prompt.*

```
Read east-feed.js, the Setup → East feed panel, the time-off write path (self-service, the vacation trigger) and
docs/SILVIS-CALL-RULES.md §3 Khan before starting. Branch feat/east-vacations, one commit per part, failing-then-
passing tests, report-first for anything that touches RLS on EITHER project, stop before pushing.

1. READ THE DAVENPORT TIME OFF — find out first, then build the path that exists
   The Davenport app keeps vacations in its own `time_off` table (columns id, person_id, kind, start_date, end_date;
   FAK is person_id s6 THERE — match on the roster code via the Davenport blob, never on id, as east-feed.js already
   does for schedule_weeks). Probe with the Davenport PUBLIC anon key whether `time_off` is readable (a 200 with rows,
   or a 200 with [] — RLS-blocked reads are silent, so compare against a row you can see in the Davenport app).
   a. If readable: extend east-feed.js to fetch FAK's rows (kind = vacation only; no-call days are a Davenport concept
      and stay there) for the cached range, into a new `east_feed` payload key `vacations: [{start, end}]`. Fetch
      failure keeps the cache and warns, exactly like the weeks.
   b. If NOT readable: do NOT add a public read policy to the Davenport project (it would expose every Davenport
      surgeon's vacations to anyone with the anon key). Instead add a paste box in the Silvis East feed panel —
      "paste your Davenport vacations" — accepting the Davenport app's export text (add a one-line "Copy my
      vacations" button to the Davenport app in a separate, tiny PR there: writes "YYYY-MM-DD – YYYY-MM-DD" lines
      to the clipboard; Faraz owns both apps). Same downstream behaviour either way. Report which path you took and
      the observed probe result.

2. THE REVIEW STEP — nothing is mirrored blindly
   A new table `east_vacation_reviews` (person_id text, start date, end date, decision text check in ('away','home'),
   decided_at, unique (person_id, start, end)); RLS: read all authenticated, write own rows or scheduler/admin. In
   Setup → East feed (and in the surgeon's own Time off view for the person with the East code), list every East
   vacation range with three states: **unreviewed** (default), **away**, **home**. Rules:
   - unreviewed and away → treated as a Silvis vacation: the generator, the day editor, the claim function and the
     open-shifts eligibility all see the person as on vacation those days (conservative default: never schedule
     someone who may be out of town). Implement as a derived vacation in rules.js (ctx.eastVacations), NOT by writing
     time_off rows — so a change of mind is one tap and leaves no orphan rows; the time-off trigger's
     "vacation over a published day" refusal is mirrored client-side for the derived ranges (warn, never block a
     published lock; list the conflict).
   - home → NOT a Silvis vacation. Those days are additionally flagged `eastClear` (no East call, no OR block): the
     weekday-pattern rule (Tue/Thu) is lifted on them automatically, and they carry a small primary bonus, so the
     generator prefers Khan as primary there. With Prompt 14 present, a "home" decision also offers to paint those
     days as `either` offers in one tap (a confirm sheet listing the dates), inserting call_offers rows the normal way.
   - A refreshed feed that changes or removes a range resets its review to unreviewed (changed) or drops it (removed)
     and says so in the refresh toast; a range already reviewed and unchanged keeps its decision.
   Audit: eastvac.review with the range and the decision.

3. WHERE IT SHOWS
   Calendar day cells and the day editor show an East-vacation marker (distinct from a Silvis vacation dot) with the
   state; the coverage strip gains "unreviewed East vacations: N" for the person with the East code, opening the
   panel; My Schedule shows the person's own East ranges with their decisions. The office digest and the ER export are
   unchanged (they show assignments, not availability).

4. TESTS + DOCS
   rules.test.js: unreviewed/away range → not eligible either role; home range → eligible, Tue/Thu lifted, bonus
   applied; East busy day inside a home range cannot happen (vacation ⇒ no call) but assert the feed wins if the data
   ever disagree. east-feed tests for the new payload key (or the paste parser). verify-rls cases for the review table.
   Docs: SILVIS-BUILD-GUIDE.md §18 "East vacations"; SILVIS-CALL-RULES.md §3 Khan gets the away/home rule; the
   Davenport clone's README if a Copy button was added there. npm test, npm run smoke, screenshots of the panel with
   one range in each state. Stop before pushing.
```

## Part 1 — path taken and the observed probe (2026-09-23, branch `feat/east-vacations`)

**Path 1a.** The Davenport project's `time_off` table is read through the East feed's existing read path, so east-feed.js reads it
directly; there is no paste box and no change to the Davenport app. The probe note, copied verbatim from
`scratchpad/p15/davenport-timeoff-probe.txt`:

```
Prompt 15 part 1 probe - observed 2026-09-22 ~22:58 local by Claude Code (read-only, Davenport PUBLIC anon key from east-feed.js):
  GET https://xqongyahdnkozqunpwmu.supabase.co/rest/v1/time_off?select=id,person_id,kind,start_date,end_date&limit=5  -> [removed]
      [removed]
  GET .../time_off?select=count (Prefer: count=exact)  -> 206, [removed]
  GET .../schedule_weeks?select=week_monday&order=week_monday.desc&limit=1 -> 200 (control: the read the East feed already does; latest week 2026-11-09)
Conclusion: [removed] -> Prompt 15 path 1a (fetch FAK's vacation rows by roster CODE via the
Davenport blob, kind = vacation only, into east_feed payload key vacations: [{start, end}]). Path 1b (paste box + Copy button) not needed.
Side observation for Faraz (Davenport side, not changed from here): [removed]
holding that app's public anon key.
```

Second read-only look while building (2026-09-23, same key, `eastGetJson`): the Davenport roster resolves code FAK to
`s6`; [removed]. His ranges lie
mostly **beyond** Davenport's last published week (2026-11-09): [range] (his Silvis Thanksgiving unit — the
"home" case the prompt describes), [range], then 2027. That is why a range touching no cached week rides on the
latest cached week before it (see guide §7) instead of being dropped.

What part 1 built (E1): `fetchEastWeeks(from, to, { vacationCodes })` → `vacations: { CODE: [{ start, end }] }` (kind
`vacation` only, ids resolved by roster code through the Davenport blob, merged and sorted) or `vacations: null` +
`vacationsError` when the `time_off` read fails while the weeks still come back; `attachVacationsToWeeks` puts each
range into every cached week it touches as `data.vacations: [{ code, start, end }]`; `keepCachedVacations` carries a
week's cached list into a refresh whose `time_off` read failed; `eastVacations(rows, code)` merges across the cache.
The app's *Refresh from Davenport* passes the codes of the surgeons whose East feature reads busy days, writes the rows
as before, and names the vacations leg in the toast and the `east.refresh` audit row. Nothing visual yet (parts 2–3).

**Review fixes (E1, same day).** (1) The per-week split and the ride-on host rule now run over the *whole* cache
(`planVacationCache`), and every cached row outside the 28-day refresh window whose list changed is upserted too
(own payload, own `fetched_at`) — the reviewer showed that with Davenport published only through 2026-11-09, Khan's
the three ranges all ride on the 11/09 row, which leaves the window on 2026-12-14; after that a
cancelled or shortened range would have survived in the cache (and a refresh that fetched 0 weeks never touched the
host). Ranges the read cannot see (`end < from`) are kept as cached. (2) The `time_off` read has its own horizon,
`opts.vacationsTo` (default: the weeks window's Sunday + 365 days), instead of ending with the published weeks.
Tests: `test/east-feed.test.js` (the T1/T2 scenario, the 0-weeks case, no-churn, the `start_date=lte.` bound).

## Delivery note (parts 1–4, branch `feat/east-vacations`, 2026-09-23)

**Path 1a, as observed above.** The Davenport `time_off` table is read through the East feed's existing read path, so the East feed
reads it directly; there is no paste box, no "Copy my vacations" button, and the **Davenport clone's README is not
touched** (`..\davenport-ref` stays a read-only reference; nothing in the Davenport app changed). Every part is
committed on this branch; nothing is pushed, nothing is published, no database was written from here.

| part | commit | what |
|---|---|---|
| 1 (E1) | `e8de193` | `east-feed.js`: `fetchEastWeeks(from, to, { vacationCodes })` reads `time_off` (kind `vacation`, ids by roster **code** via the Davenport blob) into the `east_feed` payload `data.vacations`; `planVacationCache` over the whole cache; failure keeps the cache and warns. The app's *Refresh from Davenport* passes the codes and names the leg in the toast + `east.refresh` audit. Guide §7 (the *East vacations* bullet). |
| 2 (E2) | `8e731ea` | `east_vacation_reviews` **prepared** (`sql/migrations/2026-09-23-east-vacation-reviews.sql` = `sql/schema.sql` rev. d, `sql/probes/east-vacation-reviews-probe.sql`, `scripts/verify-rls.sh` section 9, `docs/SCHEMA-REVIEW.md`); `rules.js` derives unreviewed / away = vacation (`time-off:` + `day-before-vacation`), home = `eastClear` (Tue/Thu lifted, primary bonus `weights.eastClear` 2), the feed wins over home; `helpers.js` `reviewStateFor` / `derivedEastVacations` (person-scoped); `generator.js` `diagnostics.eastVacations`. Rules doc §3 Khan. |
| 3 (E3) | `1b7ba91` | The UI: `EastVacationList` in Setup → East feed, the person's Time off view and My schedule (three-way control, conflicts list); `saveEastVacationReview` (upsert on the triple / exact-triple delete, `dbAuthHeaders()`, audit `eastvac.review`); `loadEastVacationReviews` via `readAuthOnlyTable` (404 = `missing`); refresh resets (`changed` / `removed`) from the reloaded cache; calendar diamonds, day-editor lines, coverage-strip count, EV badge; digest / reminder / ER export untouched. Guide §18.1–18.4. |
| 4 (E4) | this commit | Docs made to match parts 1–3 (every claim grepped against the source): guide §18 final (+ §18.5 live steps and open questions, the screenshot location `test/ui/out/`, verify-rls section 9 documented, the hook's exact return shape) and the `east_vacation_reviews` rows in guide §4.2 / §4.3; rules doc §3 Khan final wording + §8 item 16; ONBOARDING paragraph for the person with an East code; `edge-functions/README.md` states that nothing was deployed; this note; docs pins in `test/data-layer.test.js` `[P15]`. |

**Tests.** `test/east-feed.test.js` (part 1), `test/rules.test.js` P15 + `test/generator-regression.js` P15 +
`test/schema.test.js` (part 2), `test/data-layer.test.js` `[P15]` UI pins + `test/ui/smoke.mjs` (part 3; screenshots
`eastvac-panel.png`, `eastvac-panel-390.png`, `eastvac-panel-dark.png`, `eastvac-panel-390-dark.png`,
`calendar-eastvac-2027-04.png`, `mine-eastvac.png` in the gitignored `test/ui/out/`), `test/data-layer.test.js` `[P15]`
docs pins (part 4). Part 4 changed no app file, so the smoke was not re-run for it.

### Live steps (orchestrator, tonight, under Faraz's mandate — exact commands in guide §18.5)

1. `SILVIS_WORKDIR=<dir> bash scripts/verify-rls.sh` before: section 9 reads 9a `HTTP 404` (PASS, named), 9b blocked
   (PASS) and — CLI linked — two expected FAIL lines from 9c ("no sentinel", "leftover count could not be read ...
   table missing before the migration is expected"); the RESULT line is red by exactly those two until step 2.
2. `supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-23-east-vacation-reviews.sql` — one new
   table + index + four policies; nothing existing touched.
3. `supabase db query --linked --workdir <dir> -f <abs>/sql/probes/east-vacation-reviews-probe.sql` — record the
   `PROBE_RESULTS ...;END` string verbatim in `docs/SCHEMA-REVIEW.md` (*Observed*), then the leftover query there → `0`.
4. `SILVIS_WORKDIR=<dir> bash scripts/verify-rls.sh` after: 9a `HTTP 200` + `[]`, 9b `401`/`403`, 9c graded + leftover
   `0`; record the lines and turn the SCHEMA-REVIEW status from PREPARED to APPLIED.
5. No edge-function deploy, no cron change, no Davenport change, no data written to either project.
6. Faraz after the deploy: *Refresh from Davenport* (his 16 Davenport rows; fewer ranges where adjacent rows merge —
   the toast names the merged count), then [range] → **home**, [range] as he decides.

### Open questions (see guide §18.5 for the full text)

1. Should an unreviewed range hard-block the generator only inside the next 60 days (the strip's open-slot window;
   its unreviewed count is not windowed, so the nag already reaches every horizon), soft penalty beyond? Today: away
   at any horizon.
2. `scripts/preview-generate.js` / `publish-preview.js` pass no East-vacation inputs — a CLI generation ignores them;
   the app's Generate does not.
3. Server-side enforcement (`claim_open_slot` `CL009`, `apply_trade`, the `time_off` trigger read `time_off` only) —
   extend later or accept client-side-only.
4. The `home` → `either` offers step is a no-op until Prompt 14's painter lands on this branch.
5. The Davenport project's own read posture — Faraz's call on that project.
6. A future East surgeon who is not the scheduler depends on the scheduler's refresh (`east_feed` is scheduler-written).
