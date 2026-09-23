# Prompt 14 — Offers: paint the dates you'll cover; the generator fills the gaps (v2)

*Paste into Claude Code inside `<your clone>` after Prompts 12 and 13 are merged. This is
the process change Faraz described on 9/22 evening, refined the same night: surgeons can enter the dates they are
willing to cover **for any time moving forward**, whenever they like; the dates inside the **next three-month period
freeze six weeks before the current period ends** (= six weeks before the next period starts); the generator then
places what was offered and **fills the gaps**; anyone who entered nothing for a period is scheduled **by their rules**;
what is still open goes to the open-shifts board (Prompt 13). Entry must be **easy on a phone**: a calendar you paint,
like the Davenport app's Paint Month sheet. Silvis is an offers problem (Davenport is a rules problem): until now the
offers arrived as scattered emails that the ER-panel author retyped into Word. After this prompt the app is where the offers
live, and the ER-panel author's document is an export. Same ground rules as every prompt: report-first for schema/RLS, show every
edit, verify by observing, stop before pushing; nothing here publishes a schedule.*

```
Read docs/SILVIS-BUILD-GUIDE.md §15–§17 and docs/SILVIS-CALL-RULES.md §3 and §7 (how the October, November and
December lists actually reached us) before starting. Also read the Davenport reference clone's MonthPainterSheet in
../davenport-ref/index-source.html (search "Month painter") — its contract is the model for part 3. Build on branch
feat/offers, one commit per numbered part, a failing-then-passing test for each, report-first for part 1, stop for my
review before pushing.

1. DATA — sql/schema.sql (report-first)
   a. call_offers: id uuid, person_id text (roster id), day date, role_pref text check in ('primary','backup','either'),
      note text (operational only), entered_by text (the roster id, or 'scheduler' when relaying), source text default
      'app' ('app' | 'email-relay' | 'import'), created_at, updated_at; unique (person_id, day). Offers are NOT tied to
      a period at entry time — a surgeon may paint any future date. RLS: all authenticated read (the group has always
      seen each other's offers on the email chain; it is also how a surgeon sees who else offered a day); insert /
      update / delete OWN rows via public.silvis_person_id(); scheduler/admin any row (relaying an email on someone's
      behalf: entered_by 'scheduler', source 'email-relay'). Triggers, fail closed: refuse a day in the past; refuse a
      day inside that person's time_off (same shape as time_off_no_call_conflict, opposite direction); refuse, for a
      non-scheduler, a day inside a period whose offers_close_at has passed (the freeze — the scheduler can still enter
      a late offer, and it is logged). scripts/verify-rls.sh gets every case: anon refused; own rows only; scheduler any;
      the three refusals; a surgeon cannot write another surgeon's offer.
   b. call_periods: id uuid, label text ("Nov 2026 – Jan 2027"), start_day date, end_day date, offers_close_at date
      (default start_day − 6 weeks = the previous period's end − 6 weeks), publish_by date (default start_day − 4 weeks),
      status text check in ('upcoming','closed','generated','published'), rules_only_ids jsonb default '[]' (surgeons
      who explicitly chose "go by my rules" for this period), created_by, created_at, updated_at. RLS: all
      authenticated read; scheduler/admin write. Per-period, per-surgeon status is DERIVED, never stored twice:
      'submitted' if the person has ≥ 1 call_offers row inside [start_day, end_day]; else 'rules_only' if listed in
      rules_only_ids; else 'not_started'.
   c. Timeline data in call_schedule_data: groupRules.offerPeriods = { lengthMonths: 3, presets: [3, 6],
      closeWeeksBeforeStart: 6, publishWeeksBeforeStart: 4, remindDaysBeforeClose: [14, 3] } (editable in Setup →
      Rules); creating a period from a start day + length fills the dates from these, each editable per period.

2. RULES + GENERATOR — offers first, rules as the fallback
   a. rules.js: new ctx inputs `offers` (call_offers rows), `periodStatus` (the derived map) and, per surgeon per
      period, `offerMode` — 'exhaustive' ("only these days") or 'preferred' ("my preferred days; use my rules to fill
      gaps", the DEFAULT; Faraz 9/22 evening, prompted by Acton's November list). For a 'submitted' surgeon in
      'exhaustive' mode, eligibility(ctx, day, role, id) is TRUE ONLY on a day the person offered, in the offered role
      ('either' = both) — everything else for that surgeon is 'not-offered' (hard). For a 'submitted' surgeon in
      'preferred' mode an offered day is eligible with a strong bonus and a non-offered day is eligible under that
      person's ordinary rules with a strong penalty ('outside-offers'), so the generator reaches for it only when the
      slot would otherwise stay open; every such placement is listed in diagnostics and in that surgeon's publish
      email ("you were placed on 11/5, a day you did not list — trade if needed"). Vacations, East busy days,
      derived-week locks, holiday opt-outs, "holds the other role today" and caps STILL apply on offered days. For
      'rules_only' and 'not_started' surgeons the existing rules apply unchanged. Store the mode on
      call_periods.offer_modes (jsonb {person_id: mode}), set from the painter (part 3a) or by the scheduler. The seed's dated
      lists (explicitAvailable / explicitListMonths / availableWeeks / Fierce's single days) become call_offers rows at
      import time (source 'import' or 'email-relay'), so there is ONE mechanism; recurring weekday patterns, derived
      weeks and Sarkar's windows stay rules.
   b. generator.js: after locks, holiday units and derived weeks, place offers first — an offered day beats a rules-only
      candidate for the same slot (weight high); an offer is not a demand: fairness and caps still decide when someone
      offers more than their share, and unplaced offers are listed per surgeon in diagnostics (offered / placed /
      unplaced, with the reason). Then fill from rules-only surgeons, then repair and smoothing as today. Open slots go
      to the Prompt 13 board with the reason "no offer and no rule allows it".
   c. A Prompt 13 claim is an offer made on the spot: allowed for a 'submitted' surgeon on a non-offered day when the
      hard rules pass, and it inserts the call_offers row so the record stays honest.
   d. Regression: a fixture built from the real November lists (Burchett's and Acton's) as offers — every placed day for
      a submitted surgeon is an offered day; no placement on a non-offered day; a rules-only surgeon's result is
      unchanged versus the previous run; unplaced offers are reported; the freeze trigger and the vacation refusal have
      SQL-level cases.

3. UI — "Paint my offers" (phone-first) and "Periods" (scheduler)
   a. OfferPainterSheet: a full-screen sheet modelled on Davenport's MonthPainterSheet and defined at MODULE SCOPE (the
      Davenport comment explains why — a component defined inside the app function remounts on every parent render and
      loses the draft). Vertical day list, one full-width row per day (min 52 px, safe-area padding for the installed
      PWA), month ‹ › navigation from the current month forward without limit. Brushes at the top: Primary / Backup /
      Either / Clear (gradient when armed, like Davenport's chips). Tap a day to paint the armed brush; tap again with
      the same brush to clear; tap a start day then an end day to paint a range (same day twice = single day) — the hint
      line says which step you are on and offers "✕ cancel start". Each row shows: date + weekday (weekends tinted);
      the drafted/saved offer as a pill; what is already published for that day (holder names, or OPEN in red for a
      day at or after today); how many others have offered it ("2 others offered"); and, when the day cannot be
      offered, WHY, greyed and untappable: past, on your vacation, East busy (Khan), your derived East/Silvis week
      (Fierce), outside your window (Sarkar), frozen (period closed — "ask Faraz"). A day your own WEEKDAY PATTERN
      normally excludes (Khan's Tue/Thu OR days, Fierce's Clinton days, Burchett's outreach days, Acton's Tuesdays) is
      NOT greyed: it is paintable behind one confirmation ("Tuesday is normally an OR day for you — offer it anyway?")
      and the saved offer lifts that pattern for that date and role (rules doc §1 "own dates beat own patterns";
      Faraz 9/22 evening: his OR days are not every Tue/Thu). Obligations (vacation, East feed, derived week, window)
      are never liftable from the painter. A running count in the header:
      offered primary / backup / either for the month being viewed, and for the next period against the person's cap.
      Draft lives in the sheet; Save = ONE batch write (insert/update/delete diff) + ONE audit entry 'offers.save' with
      the count; a failed commit writes nothing, names every pending entry, keeps the draft and the unsaved indicator;
      Discard and Close confirm on a dirty draft; a saved note clears after 3 s. Also a "paste a date list" box for
      those who prefer typing (reuse the availability paste parser; rows become drafts, not writes). A "Go by my rules
      for <period>" button sets rules_only for the next period and explains that person's rules in words from
      surgeonRules. Above the Save button, one toggle for the next period: "Only these days" / "These are my preferred
      days — use my rules to fill gaps" (default), with one line explaining the difference; it writes offer_modes.
      Smoke harness: paint five days with two brushes and a range at 390 px, flip the toggle, save once, assert one
      request, one audit row, the rows in call_offers and the mode on the period.
   b. Periods (Setup → Generate grows a "Periods" section): create the next period from the presets (3 / 6 months);
      the timeline (closes, publish by) editable; per-surgeon status (submitted N days / rules only / not started)
      with a "Remind" button (not_started only); Close now (freeze early); "Enter for someone" opens the painter as
      that surgeon with entered_by 'scheduler', source 'email-relay' (how a relayed email gets in); Generate (existing
      flow, offers-aware, range = the period); Accept & Publish (existing).
   c. The day editor lists, for each candidate, "offered primary / either / backup", "rules", or "not offered", so a
      manual assignment is an informed one; My Schedule shows the person's own future offers under their assignments.

4. NOTIFICATIONS — the timeline runs itself
   a. send-notification gains categories offers_reminder and offers_closed (client composes the words; honours
      schedule_updates_email). The Periods "Remind" button uses it with a session.
   b. daily-reminder gains mode "offers" (x-cron-secret gate, dryRun contract, TypeScript mirror of the date maths
      tested against the same fixture as helpers.js): each morning, for every 'upcoming' period, if today is
      remindDaysBeforeClose days before offers_close_at → offers_reminder to surgeons whose status is not_started
      ("your dates for <label> freeze on <date> — paint them in the app or choose 'go by my rules'"); if today ≥
      offers_close_at and status is still 'upcoming' → set status 'closed' and send offers_closed to the scheduler
      (who submitted how many days, who is rules-only, who never answered). It never generates or publishes. New
      pg_cron job, pasted by me and written into edge-functions/README.md §4 beside the others:
         select cron.schedule('silvis-offers-daily', '0 13 * * *', $$
           select net.http_post(
             url := 'https://bzhsroegtagqhutbnsrp.supabase.co/functions/v1/daily-reminder',
             headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',
               coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'silvis_cron_secret' limit 1), 'unset')),
             body := '{"mode":"offers"}'::jsonb);
         $$);
      (13:00 UTC = 08:00 CDT / 07:00 CST.) Prove it with a dryRun post through pg_net and quote the 200 body.
   c. The office weekly digest and the open-shifts flow are unchanged.

5. THE FIRST PERIOD — migrate what we already have
   Create period "Nov 2026 – Jan 2027" (start 2026-11-02, end 2027-01-03 — the milestone range; its computed close
   date is already past, so set offers_close_at by hand to the day Faraz names, default 2026-10-02, and status
   'upcoming'). Enter, as email-relay offers with the email date in the note: Burchett's November and December lists,
   Acton's November list, Philip's available weeks, Fierce's stated single days; mark Khan rules_only (East feed) and
   Sarkar rules_only (windows; her two days are a soft target, not offers). Offer modes for this first period as
   Faraz sets them after asking (default 'preferred'; Burchett is the likely 'exhaustive'); the November whitelist
   months from item T are replaced by these modes — one mechanism. The locked the ER-panel author entries stay locks. Show
   the resulting status table in the report; then regenerate the preview through the offers-aware path and diff it
   against the previous one — the November days Burchett and Acton offered must come out exactly as the ER-panel author published.

6. DOCS + TESTS
   docs/SILVIS-BUILD-GUIDE.md §17 (already drafted; make it match what was built), docs/ONBOARDING.md (a paragraph for
   surgeons: "paint the dates you'll cover any time; the next three months freeze six weeks before the current period
   ends; or tell the app to go by your rules"), docs/SILVIS-CALL-RULES.md §1 Process row, audit actions offers.save,
   period.create/close. npm test, npm run smoke (both themes, 390 px), scripts/verify-rls.sh green; screenshots of the
   painter on a phone width (armed brush, a painted range, a greyed row with its reason, the save note) and of the
   Periods section. Stop before pushing.
```

---

## Delivery note — 2026-09-23 (branch `feat/offers`; Faraz authorised moving forward overnight without his go)

**What landed tonight, one commit per part, in the order built** (all on top of the merged Prompt 12 head `d682a97`):

| Part | Commit | What it is |
|---|---|---|
| 1 Data | `cfe3a3b` | `sql/migrations/2026-09-22-offers-periods.sql` (the body applied live 9/22 15:15, verbatim), `2026-09-23-offer-modes.sql` (the `call_periods.offer_modes` jsonb column of v2 — **not yet applied live**), `sql/probes/offers-probe.sql` (rolls itself back), `scripts/verify-rls.sh` section 8, `sql/schema.sql` mirror, `test/schema.test.js` pins, `docs/SCHEMA-REVIEW.md` applied-proof section |
| 2 Rules + generator | `969a914` | `rules.buildContext` inputs `offers` / `periods`; per surgeon per period the derived status (mirrors SQL `offer_status()`) and the mode `offer_modes[id]` or `preferred`; **exhaustive** = hard `not-offered` off the offered days/roles, **preferred** = soft `offered` (−`weights.offerBonus` 6) / `outside-offers` (+`weights.outsideOffers` 6); an offer is a dated row (item W: lifts weekday patterns, never an obligation); `whitelist-month` / `outside-available-weeks` not applied to a submitted surgeon inside a period; `generator.js` fills offered units first (`genOfferedUnits` / `genOrder`), the bonus stops at the share (`genOfferTaper`, `weights.offerBonusOverShare` 0), `diagnostics.offers` (`byPerson` offered / placed / unplaced with reasons, `outsideOffers`), open slots "no offer and no rule allows it"; `eligibility(..., { claim: true })`; `sql/migrations/2026-09-23-claim-offer.sql` **prepared, not applied** (after `feat/open-shifts` merges); `test/fixtures/offers-2026-11.json`, `test/offers.test.js`, Prompt 14 P2 blocks in `test/rules.test.js` and `test/generator-regression.js` |
| 5 First period | `19d4094` | seed `offerPeriods[]` (Nov 2026 – Jan 2027 = 2026-11-02 .. 2027-01-03, `offersCloseAt` 2026-10-02 by hand, `publishBy` 2026-10-05, `rulesOnly` s1 + s6, `offerModes` s2 / s4 exhaustive, s3 / s5 preferred) and `surgeonRules.<id>.offerSources` tags; `importer.importPlan(seed, { offerPeriods: true })` (the CLI's setting; the in-app import stays legacy until part 3) plans the period upsert + the `call_offers` rows (`entered_by scheduler`, `source email-relay`, `note seed: <tag>`, from today in America/Chicago, vacation days skipped, locked days kept as offers) and retires the submitted surgeons' `available` rows and governed months inside the period; `scripts/import-seed.js --offers-json`; snapshots cover both tables (`config.js`); `test/importer.test.js` P5 block, `test/data-layer.test.js` P5 block |
| 4 Notifications | `db1494b` | `send-notification` categories `offers_reminder` / `offers_closed`; `daily-reminder` mode `offers` (same `x-cron-secret` gate and `dryRun` contract; reminders on the 14- / 3-day marks to `not_started` pool members; from the close on a compare-and-swap flip to `closed`, audit row `period.close` with `actor_id` `cron`, roll call to scheduler / admin accounts; never generates, publishes or writes `call_offers`); `helpers.offerCronPlan` / `offerRollcall` / `offerPoolIds` with the TypeScript mirror between `@offerTimeline-mirror-start/-end`; `edge-functions/README.md` §3 deploy record + §4 `silvis-offers-daily` cron text; `test/offers-timeline.test.js` + `test/fixtures/offer-timeline.json` — **sources only; nothing deployed** |
| 6 Docs | this note | build guide §17 made to match parts 1 / 2 / 4 / 5 with part 3 marked next wave and the audit actions named; `docs/ONBOARDING.md` surgeon paragraph; rules doc §1 Process row final wording + §8 item 20 (modes to confirm); `CLAUDE.md` one line |

**Live vs pending (9/23):** live = the 9/22 schema (`call_offers`, `call_periods`, `offer_status()`, OF001–OF003,
authenticated-only RLS). Pending, in order: the `offer_modes` column → the seed apply (`node scripts/import-seed.js
--apply`, one period + 79 offers, **before 2026-10-02**, because OF003 refuses seed-entered offers inside the period
from the close on and the CLI runs as `postgres`, not as the scheduler) → the two functions redeployed from the merged
head that also carries the Prompt 13 open-shifts mode, then the cron (**by 9/29** for the 3-day reminder) → the
claim-as-offer SQL after `feat/open-shifts` lands → part 3.

**The first period as the importer plans it** (observed 9/23 offline through `importer.impSeedContextInput(seed,
{ offerPeriods: true })` — no database touched; the dry run against the live rows prints the same table plus the diff):

| Surgeon | Status | Mode | Planned offers |
|---|---|---|---|
| Khan (s1) | rules_only | — | 0 (East feed) |
| Burchett (s2) | submitted | exhaustive | 34 = 7 primary + 8 backup + 19 either (`seed: burchett-email-2026-09-17`) |
| Acton (s3) | submitted | preferred | 10 = 7 primary + 3 backup (`seed: acton-via-burchett-relay-2026-09-17`) |
| Philip (s4) | submitted | exhaustive | 35 either = five weeks × 7 (`seed: philip-email-2026-09-20`) |
| Fierce (s5) | not_started | preferred (recorded) | 0 — no dated single day of his inside the period is on record |
| Sarkar (s6) | rules_only | — | 0 (windows; her two days a week are a soft target) |

**Where tonight's delivery departs from the prompt text, named:**
1. Part 3 (UI) in full, and therefore part 6's smoke, phone screenshots and the Periods screenshot — **the next wave**
   (build guide §17 lists what it owns, including the audit actions `offers.save`, `period.create`, `period.close` and
   the wiring: `ctxInputs` → `buildContext` offers / periods, the in-app import switch, the trade path's claim reading).
2. Part 5 "regenerate the preview through the offers-aware path and diff it" — **not run**: `scripts/preview-generate.js`
   is not offers-aware. The proof that Burchett's and Acton's November days come out as the ER-panel author published is the P2
   regression on `test/fixtures/offers-2026-11.json`; the live preview regen follows the seed apply and a preview-script
   change (UI wave).
3. Part 5 "Fierce's stated single days" — none inside the period exists in the seed, so he is `not_started` rather than
   submitted; his `preferred` mode is recorded for when he paints (rules doc §8 item 20 b).
4. Part 2b "an offer is not a demand" — implemented as the bonus taper at the share (`weights.offerBonusOverShare`, 0),
   measured on Acton offering every November day; caps stay hard.
5. Part 2c — a claim by a surgeon listed in `rules_only_ids` writes **no** offer row (one row would flip his chosen
   status for the whole period); a surgeon with nothing entered does get the row and becomes submitted (preferred).
6. Part 1a triggers — OF003 also refuses a **seed re-import** that adds or changes an offer inside the period after
   the close (the CLI is not the scheduler), hence the 10/2 deadline on every seed-borne answer (item 20).
7. Part 5 modes — set as defaults tonight (Burchett / Philip exhaustive; Acton / Fierce preferred; Khan / Sarkar
   rules-only), to be confirmed; the plain-list-is-`either` consequence for backup is item 20 a.
8. Part 4a "Remind" button — belongs to part 3; the category exists and the cron sends the scheduled reminders.
9. Trades onto a non-offered day for an exhaustive surgeon — latent until part 3 passes offers into `ctxInputs`; part 3
   must give the trade path `{ claim: true }` (and `apply_trade()` the offer upsert) or Faraz rules such trades refused.
10. Late offers after the 10/2 freeze (P6 review, 9/23) — the schema lets the scheduler role enter one (OF003 is skipped
    for `silvis_is_sched()`), but no scheduler entry path exists before part 3: `scripts/import-seed.js` runs as
    postgres (`auth.uid()` null) and is refused, and `index-source.html` writes no offer. Until the Periods section
    ships the only late path is a scheduler-JWT REST write; the docs (ONBOARDING, rules doc §1 / §8 item 20, guide
    §17) say so, and the 10/2 close is the only safe window for a changed mode answer.

**Live actions the orchestrator runs (nothing here was executed by the docs lane):** apply
`sql/migrations/2026-09-23-offer-modes.sql` and prove it (probe + `verify-rls.sh` section 8; observed line into
`docs/SCHEMA-REVIEW.md`); `node scripts/import-seed.js --dry-run` then `--apply` before 10/2 (79 offers, 1 period;
the apply verifies from the SQL's returning rows); deploy `send-notification` and `daily-reminder` from the merged head
and create `silvis-offers-daily` (README §3 record, dryRun 200 body quoted); apply `2026-09-23-claim-offer.sql` after
`feat/open-shifts` merges; mirror `CLAUDE.md` and `docs/` to the OneDrive folder (docs flow repo → OneDrive).
