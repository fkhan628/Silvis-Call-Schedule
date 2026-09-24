# Silvis Surgical Care — Call Schedule Rules & Availability

*Compiled 2026-09-21 from the group's email threads (Aug 27 – Sep 20, 2026), the ER-panel author's ER Call Panels
Word document (9/14–12/13/26 version dated 9/16), Fierce's rules relayed by Faraz, and Faraz Khan's in-session
answers (9/21 and **9/22 — see the "9/22 amendments" marked ⟶ throughout and §8**). This is "the bones" the generator
must honor. The machine-readable twin is the repo's `docs/silvis-seed.json` (canonical since the overnight build) — when
the two disagree, fix both.*

---

## 1. The call model

| Item | Rule | Source |
|---|---|---|
| Unit of call | **One calendar day = one 24-hour shift, 07:00 → 07:00 next day** (confirmed) | Khan 9/21 |
| Roles per day | **Primary** (must be physically in Silvis — applies to everyone, Fierce included) + **Backup** (standby). ⟶ **9/22: backup is open to everyone, on-site or off-site, every day** — outreach days, OR days and Clinton/Aledo days restrict **primary only** — **unless a surgeon explicitly opts out of backup** (none has so far). | Burchett 9/18, Khan 9/12, 9/21, **9/22** |
| Weekdays (Mon–Thu) | Primary + backup, one surgeon each, 24 h at a time | Khan 9/21 |
| Own dates beat own patterns | ⟶ **9/22 evening: a surgeon's weekday-pattern rules (OR days, outreach and clinic days, Acton's Tuesdays) are defaults; a specific date the surgeon enters as available lifts the pattern for that date and role.** Obligations never lift: vacations, East call days from the feed, Fierce's derived weeks, Sarkar's windows. *Engine (Prompt 12 W): a dated `available` / `backup_only` row for the role lifts `hardNeverWeekdays` too (`rules.js` `rowAvail`, the flag the whole weekday-pattern family reads); `availableWindows` never lift (`outside-window` no longer reads a row); a manual lock is not a row. Seed: `groupRules.availabilityPrecedence` + `availabilityPrecedenceNote`.* | Khan 9/22 |
| Weekend (Fri–Sun) | Handled as a **weekend unit** whose shape depends on the surgeon (see §3, §4) | Khan 9/21, Burchett 9/10 |
| Handoff | Service hands off every morning; whoever operated/consulted on a patient hands them to the next day's primary. The weekend surgeon covers everyone Fri–Sun. Only the primary must be in Silvis; everyone else can be off-site. | Khan 9/9, Burchett 9/10 |
| Fill order | **Fill every primary day first (top priority), then backup.** | Burchett 9/17, 9/18 |
| Fairness | ⟶ **9/22: everyone as equal as possible.** Primary counts are balanced across the pool and backup counts are balanced across the pool, each within the person's availability; nobody is a "neutral" filler. See §6. | Khan 9/22 |
| Caps | ⟶ **9/22: monthly caps count primary days only** — backup days do not count toward Burchett's 8 (or anyone's total cap). An explicitly stated backup cap (Philip: ≤ 7 backup days and ≤ 1 backup weekend per month) still applies. Seed keys (Prompt 12 K): `surgeonRules.<id>.monthlyCap = { primary, preferred, countsEastDays }` — `primary` = hard cap on primary days per calendar month, `preferred` = soft ceiling on the same count, `countsEastDays: true` adds the days of an East *primary* week (Fierce); `null` = no cap, absent = `groupRules.defaultMonthlyCap.primary` (8). The pre-9/22 key `total` is read as an alias of `primary` with a warning. Philip's `backupCap = { perMonthDays: 7, weekendsPerMonth: 1 }` is the separate backup rule. | Khan 9/22 |
| Outside surgeons | ⟶ **9/22: the roster can carry outside surgeons ("internal locums", e.g. a Davenport surgeon willing to take a shift)** who are **written in by hand** for specific days, never auto-assigned by the generator, and tallied separately. | Khan 9/22 |
| Backup contract | Backup should never be called if the primary stays true to the location. (Stipend transfer on activation is a group/admin matter — **the app carries no compensation logic or $ display at all.**) | Burchett 9/18, Khan 9/21 |
| Practice hygiene | No operating at another facility while on Silvis primary. 30-minute response time. | Khan 8/29, Burchett 8/27 |
| Consecutive days | Default max **2 consecutive 24-h PRIMARY periods** (hard, real days); per-surgeon overrides below (weekend blocks are 3; Fierce weeks are 7). ⟶ **9/22 (Prompt 12 A): a holiday unit counts as one day only for a surgeon who opted in (Khan); any-role runs (primary or backup) have a SOFT per-surgeon limit (Burchett 3, Sarkar 2, Khan 4, Acton 4, Philip 4, Fierce 7) with a penalty that grows per day beyond it.** | Burchett 8/27, Khan 8/29, review 9/22 |
| Week-long stints | No more week-long call stints for the general pool (Atwell/Fierce legacy pattern). Fierce's derived weeks are the explicit exception (§3). | Burchett 8/27, Khan 9/21 |
| Period | **The generation window is the offer period** (Process row below; `groupRules.offerPeriods`, default 3 months, preset 6): Nov 2026 – Jan 2027 was generated and published 9/23 (`docs/PUBLISH-2026-09-23.md`); **Jan 2027** (1/4 – 1/31; freeze 11/23, publish by 12/7 — Faraz created the row in Setup → Periods on 9/24 to fill the gap after 1/3) is the next one, then **Feb 2027 – Apr 2027** (2/1 – Sun 5/2; freeze 12/21, publish by 1/4 — 9/24: the end moved from Fri 4/30 to Sun 5/2 so the last weekend unit stays whole); each is generated from Setup → Periods → "Generate this period". **Sep 14 – Nov 1 stays exactly as the emails describe it** (locked import, §7). Generate's own range field keeps its 3-, 6-, 9- and 12-month presets, and (9/22 late, Prompt 12 AB) **its default range starts at the first open slot on or after today** — locks are never touched, whatever the range. ⟶ *B10 (9/23): the two range rules this row used to state — "this round: generate through the end of 2026 (2026-11-02 → 2027-01-03)" and "after that, presets from the last published day" — were the milestone plan, done on 9/23 and superseded by AB; dropped.* | Khan 9/21, **9/22**, 9/23, 9/24 |
| Time off | **Vacations only — there are no "no-call days."** Surgeons **enter their own vacations; nothing is approved** — the app logs them (audit trail) and blocks those days from call. A vacation **cannot be entered over a day the surgeon is already published as primary or backup**: the entry is refused, the conflicting dates are listed, and the surgeon must find a switch (trade) first. A vacation day also blocks the day before it (the 07:00 shift end falls on the vacation day). ⟶ **9/22 (Faraz, Prompt 12 H): under the open-backup rule the day-before block stays PRIMARY-only — a standby backup the day before a vacation is acceptable** (seed `groupRules.dayBeforeRules.trailingEdgeRoles = ["primary"]`; the DB trigger likewise checks `start_date - 1` for primary only). | Khan 9/21, **9/22** |
| Shift accounting | **Each 24-hour day is one shift.** No half-days, no weighted burden, none of the Davenport split accounting. Primary and backup shifts are counted separately; weekend days and holidays are tracked as well. **Totals are a running yearly tally** (month, year-to-date, rolling 12 months). | Khan 9/21 |
| Process (offers first — from the Nov 2026 – Jan 2027 period) | ⟶ **9/22 evening: offers first, rules as the fallback.** Surgeons paint the dates they are willing to cover **for any time ahead, whenever they like** (phone-first calendar, like Davenport's Paint Month); the dates inside the **next period (default 3 months, or 6) freeze six weeks before the current period ends**; the generator places what was offered and **fills the gaps**; anyone with nothing entered for a period is scheduled **by their rules** below; what is still open goes to the open-shifts board. When submitting, a surgeon says whether the list is **"only these days"** (exhaustive) or **"my preferred days — use my rules to fill gaps"** (preferred, the default; every off-list placement is named in that surgeon's publish e-mail — trade if needed), or chooses **"go by my rules"** for the period. Obligations never lift on an offered day (vacations, East days, derived weeks, windows, caps, runs, the other role); a day is refused if it is past, on the person's vacation, or inside a period already frozen (the database lets the scheduler role enter a late offer — OF003 is skipped for `silvis_is_sched()` — from Setup → Periods → "Enter for someone", and since Prompt 16 A7 the office relays one from Time off → "Offers - enter for a surgeon"; the seed CLI runs as postgres and is refused from a period's close on). The status per surgeon per period is derived, never typed: submitted / rules-only / not started; reminders go 14 and 3 days before the freeze to anyone not started, the scheduler gets the roll call at the freeze. See the build guide §17 and Prompt 14. **Live since 9/23 (Prompt 14, every part; B10 restates):** the tables (`call_offers`, `call_periods` with its `offer_modes` column, applied 9/22 and 9/23 07:05Z), the RPCs `save_offers` / `set_offer_mode` (9/23 ~18:45 UTC), the engine below, the first period's offers from the seed through the importer (§3, P5 note — applied 9/23, twice), the timeline e-mails (`daily-reminder` mode `offers` v4 and `send-notification` v5 deployed 9/23 ~18:50 UTC, cron `silvis-offers-daily` the same minute), the painter, the Periods section and the day-editor / My Schedule labels (build guide §17). Modes for the first period: §8 item 16. *Engine (Prompt 14 P2, 9/23): `rules.js` reads `offers` (`call_offers` rows) and `periods` (`call_periods` rows incl. `rules_only_ids` + `offer_modes`); per surgeon per period the status is derived exactly like SQL `offer_status()` (submitted / rules_only / not_started) and the mode is `offer_modes[id]` or `preferred`. Inside a period a submitted surgeon is offers-governed: **exhaustive** = hard `not-offered` off his offered days and roles (`either` = both); **preferred** (default) = soft `offered` (-`weights.offerBonus`, 6) on an offered day and soft `outside-offers` (+`weights.outsideOffers`, 6) on any other day, which stays eligible under his ordinary rules (the `outside-offers` term is also carried on an exhaustive surgeon's claim result, where `not-offered` is skipped, so the board can name the day as outside his offers). An offer is a dated row (item W): it lifts the weekday patterns for its date and role; obligations never lift; `whitelist-month` / `outside-available-weeks` are not applied to a submitted surgeon inside the period (offers supersede the dated lists). rules_only / not_started, and every day outside a period, are today's rules byte for byte. `generator.js` fills offered units first (after locks, holiday units and derived weeks); **an offer is not a demand: the offered bonus stops at the surgeon's share** — once a placement no longer brings him towards his target for the role and month the bonus reads `weights.offerBonusOverShare` (0), so a surgeon who offers more than his share is placed to his share (within `smoothingTolerance`) and the rest goes to the colleagues below theirs (measured 9/23 review, Acton offering every November day, seeds 1–3: 12 primaries / 5 backups against targets of 8 / 3 before the taper; 11 / 10 / 9 primaries and 3 backups after it — his eight primary locks already equal his target and November's open primaries exceed the sum of everyone's targets, so the surplus has to go somewhere: every over-share day of his is one that no colleague below his own share could take); caps and runs are hard either way. It reports `diagnostics.offers` (per surgeon offered / placed / unplaced with the slot's reason — a holiday-unit day names the unit's other day that failed; `outsideOffers` for the publish email) and marks an open slot "no offer and no rule allows it"; a Prompt 13 claim is an offer made on the spot (`eligibility(..., { claim: true })` + `sql/migrations/2026-09-23-claim-offer.sql`, which writes no offer row for a surgeon who chose "go by my rules" for the period — he keeps that status). Seed: `groupRules.offerPeriods`, `weights.offerBonus` / `outsideOffers` / `offerBonusOverShare`.* ⟶ **9/23 afternoon (PD): the first period's schedule is published, so its `call_periods` row reads `published` (no 9/29 reminder, no 10/2 close mail — the offers cron reads `upcoming` rows only and the painter shows it read-only; the importer's period upsert carries a seed status forward, never back), and the next period is what the painter, My schedule and the reminders point at.** ⟶ **9/24 (Faraz): two rows follow the published one — Jan 2027 (2027-01-04 → 01-31, freeze 11/23, publish by 12/7; created in Setup → Periods to fill the gap after 1/3; reminders 11/9 + 11/20) and Feb 2027 – Apr 2027 (2027-02-01 → 05-02, freeze 12/21, publish by 1/4 — the 3-month preset's dates; the end moved from Fri 4/30 to Sun 5/2 by SQL with an `audit_log` `period.update` row so the last weekend unit stays whole; reminders 12/7 + 12/18); nobody rules-only, no offers yet in either. The painter speaks to the earliest open one — Jan 2027 until its 11/23 freeze, then Feb – Apr.** | Khan 9/22, **9/23**, 9/24 |
| Contact info | Surgeons are contacted at **home email** addresses, never MercyOne/MercyHealth. **No contact data in this document, the seed, the schema or the repo** — it lives only in `silvis-contacts.md` in the OneDrive folder (gitignored), and in Supabase only in authenticated-read tables (`user_profiles`, `office_contacts`), never in anon-readable ones. | Khan 9/21; Prompt 0A redaction |

## 2. Roster

| id | Display | Status | Pool? |
|---|---|---|---|
| s1 | **Khan** (FAK) | Active; scheduler/admin; also on Davenport (East) call | Weekends; Mon/Wed auto-offered |
| s2 | **Burchett** (MAB) | Active; Silvis-based; outreach DeWitt / Jackson County | Yes |
| s3 | **Acton** (BDA) | Active; Silvis-based; outreach Maquoketa | Yes |
| s4 | **Philip** (AFP) | Active; Silvis-based; outreach Aledo | Yes |
| s5 | **Fierce** (NF) | Active; alternates with Davenport; Clinton/Dubuque outreach | Derived weeks + weekday pattern |
| s6 | **Sarkar** (SRK) | Active; one window per month (availability relayed by administration) | Window only |

Contact details for all six (and for the office contact / administration) are in the private `silvis-contacts.md`.

**Outside surgeons (9/22):** Setup → Roster can add an *outside* surgeon (name + code, `type: "external"`, no account
needed). They appear only in the day editor under "Outside surgeons", never in the generator's pool, and in Totals under
their own heading. They must be written in by hand for each day they agree to cover.
Key names (Prompt 12 M, 9/22): the roster entry is `{ id, name, code, fullName, active, roles, type: "external", note }` —
ids `x1`, `x2`, … (generated by Setup → Roster "Add outside surgeon"; a pool surgeon stays `s<n>`), codes unique across the
whole roster (Setup refuses a duplicate), `note` optional and **operational only** (shown in Setup only; the item-F denylist
applies in Setup and in the importer because the setup blob is anon-readable; never exported). `rules.buildContext` keeps
the entry in `ctx.rosterById` / `allIds` and, when active, in **`ctx.externalIds`**, never in `ctx.activeIds` (the generation
universe); `eligibility(ctx, day, role, x1)` answers the generator path with the hard reason **`external-surgeon`** and the
day editor's manual path (`opts.manual === true`) with the slot facts only (`external-cover`, `slot-locked:`, `inactive`,
`time-off:` on his own vacation day, `holds-other-role`), ok otherwise, result flagged `external: true`. Picking one in the day editor locks the role and the
save carries **`source: "manual-external"`**; the generator treats a day he holds as a fixed slot in every mode (locked or
not; his own lock flag is kept) and his days come off the pool's open-slot count (`impliedTargets` `primaryOpen` /
`backupOpen`). Totals lists him under "Outside surgeons" (`helpers.js ttOutsideSurgeons`: active externals, plus an inactive
one that still holds a day in the period; the CSV appends a `Type` column, `pool` / `outside`). Exports (ICS, share page,
printable, ER Call Panels) and `calendar-sync` (`?surgeon=<CODE>`) render and serve him by last name / code exactly like a
pool surgeon. The seed adds no outside surgeon (`groupRules.outsideSurgeonsNote` documents it); the legacy
`externalCover` field below is untouched and not migrated. Review 9/22 (same day): **a seed import keeps him** — the seed
owns the pool rows only; live roster rows of type `external` the seed does not name are carried over by `planDiff`
(`roster=unchanged` plus an "outside surgeon(s) kept from the live roster" line), the app's Apply and the generated SQL
(`importer.js impMergeRoster`). A **holiday unit broken by him** (he holds one unit day of a role) is filled day by day
around him from the pool with one warning per unit and role (`diagnostics.holidayUnits[].<role>BrokenBy` / `<role>Daily`)
— he is never a unit candidate, so the other unit days would otherwise stay open. An **East derived week** entered for
him (`eastFeed.deriveFrom` / `statedWeeks`) is ignored with a warning; Setup → Rules offers no rules editing for an `x` id,
and Setup issues never ask for his rules. He is kept out of the vacation form, availability statements, trade parties
(nobody could accept), the Users roster link and the month painter; calendar chips, legend, ICS buttons and exports keep
him. Written in over a slot fact through the override confirm he is locked exactly like a plain pick, and the "written in
by hand" line is an info line, never the red error hint.

**Atwell is not in the roster** (Faraz, 9/21). His legacy primary week 9/28–10/4 is imported as `externalCover: "Atwell"`
so those days render as covered rather than OPEN and count toward nobody's tallies. If that changes, Faraz will say so.

Other people: **the ER-panel author, RN, TNS** (Trauma & Pediatric Quality Coordinator, Silvis) has maintained the ER Call
Panels Word document until now. ⟶ **9/22 evening (Faraz): once the app goes live, the app is the source of truth and
the ER-panel author's document is retired** — she gets a **read-only (viewer) account**, the weekly office digest, and the ER Call
Panels export whenever a paper copy is wanted; she is the one office contact entered in Setup. Nothing is corrected in
her document from now on; corrections go into the app. **Administration** relays Sarkar's availability; no account. **The COO**
decides the Trauma Director role.

## 3. Per-surgeon rules

### Khan (s1) — weekend primary when available, East-dependent
- ⟶ **9/22: main contribution = PRIMARY on weekends when available** (Fri+Sat+Sun as a block). He is not a backup filler: his backup count is balanced like everyone else's, and the generator should prefer him as weekend *primary* over weekend *backup* whenever East allows.
- ⟶ **Seed keys (Prompt 12 L, 9/22):** `surgeonRules.s1.primaryContribution: "weekends"` (generic — any surgeon; seed/blob data today, no Setup field yet) with `groupRules.weights.weekendContribution` = 3 (medium; 0 = off): his full Fri+Sat+Sun primary block earns the soft `weekend-primary` (−3 per day in the score, only as a member of a whole block; once per block inside the weekend-unit choice) and any weekend backup day of his costs the soft `weekend-backup` (+3 per day; once per pattern membership in the unit choice) — both soft, never a block; the weight is editable in Setup → Rules → weights (0 = off). Holiday units are not weekend units: neither term applies on a holiday-unit day and a weekend a unit pre-empts earns no block bonus. East cross-reference sources (`east-feed.js deriveKhanBusyDays`): `dayCall` Mon–Sat, `nights.mon..thu`, `nights.wknd` (Fri + Sun), `holidayCoverage` (24 h; someone else's holiday clears his day), `dayCallOverrides`, `isBackup` weeks (busy for primary while `eastFeed.eastBackupCountsAsBusy` is true — an East backup week busies only the shifts he actually holds in it (his dayCall/override/night/weekend/holiday days), never all seven days; pinned by `test/east-feed.test.js` "never busy wholesale"); each blocks primary (`east-busy`) and leaves backup open.
- **Mondays and Wednesdays are auto-offered as primary** whenever East is clear ("I'll have to figure it out on those days"). **Never Tuesday, never Thursday as primary** — those are his OR days (hard). ⟶ **9/22: backup on any day is fine, Tue/Thu included.** *(Supersedes the earlier "no Mon/Wed nights" statement and the "never Tue/Thu for both roles" reading.)* ⟶ **9/23 (audit RG-3): "auto-offered" = eligible with a soft +1** (`auto-offer-weekday`, `groupRules.weights.noTargetWeekday`), so on otherwise equal terms another surgeon takes the day and weekends stay his main contribution — set the weight to 0 in Setup → Rules → weights for equal footing (the Setup label reads "offer those days (soft +1, weights.noTargetWeekday)").
- ⟶ **9/22 late (Prompt 12 AA): the OR-day reason stays here and nowhere else** — the blob carries the rule only (`surgeonRules.s1.hardNeverWeekdays: ["Tue", "Thu"]`, `hardNeverWeekdaysRoles: ["primary"]`); the former `hardNeverWeekdaysReason` key ("OR day" token in the live blob) is gone from the seed, its wording folded into `hardNeverWeekdaysNote` (a Note key the importer drops), and the importer no longer writes a category token for any surgeon's note. One standard for anything anon-readable: no reasons, only the rule.
- East feed: **primary** only on days he is **not on call at East (Davenport)**; **backup is allowed even on East call days**. ⟶ **9/22: cross-reference ALL of his Davenport call** — service weeks (Mon–Sat), weeknights, weekends, backup weeks, holiday coverage — from the Davenport app's `schedule_weeks` rows for the surgeon coded FAK, plus the forecast until Davenport publishes.
- ⟶ **9/22 evening: his OR days are not every Tuesday and Thursday.** On a Tuesday or Thursday with no East OR block
  he can take Silvis primary — so the Tue/Thu rule is the default, and **a specific date he enters himself lifts it**
  for that date (Setup → availability date list now; the offers painter from Prompt 14). Nothing else lifts it.
- ⟶ **Engine (Prompt 12 W, 9/22 evening):** a dated `available` / `backup_only` row of his for the role lifts `hard-never-weekday:Tue|Thu` for that date (`rules.js rdStatic` reads the same `rowAvail` flag as the rest of the weekday-pattern family; the reason code is unchanged where it applies); a manual lock is not a row (a locked holder on an OR day keeps the lock with `hard-never-weekday:<wd>` in `conflicts`); East busy / forecast-busy days, vacations and derived locks stay hard with or without a row. Seed: `surgeonRules.s1.hardNeverWeekdaysNote`.
- Max consecutive **3** primary days (hard, real days). ⟶ **9/22 (Prompt 12 A): he is the one surgeon who opted in to count a holiday unit as one day** (`holidayUnitCountsAsOneDay`; his 4-day Thanksgiving unit vs his max 3); any-role soft limit **4** with the long-run penalty beyond it. Monthly target: **the equal (water-filled) share of §6**, like every pool member (`monthlyTarget: null` = equal share, never "no target"; B10 9/23 corrects the earlier "No monthly target" here — the seed had followed §6 all along).
- ⟶ **9/22 evening — standing East rule: on Davenport call every Christmas Eve and Christmas Day.** Never Silvis primary
  on 12/24–12/25 in any year (the Christmas unit is someone else's); backup allowed as on any East day.
- ⟶ **Seed key (Prompt 12 V, 9/22 evening):** `surgeonRules.s1.eastStanding = [{ "name": "Christmas", "days": ["12-24", "12-25"] }]` — generic for any surgeon (an `MM-DD` list per named entry; no Setup field yet — seed/blob data like item L; the Setup East card shows it read-only as "Standing: Christmas 12-24, 12-25 (every year)"). `rules.js` treats a standing day exactly like a published East busy day in every year: the same hard `east-busy` for the roles his `eastFeed` blocks (primary), ahead of the forecast and of `east-unknown`, behind the same gate (`eastFeed.enabled` with `eastBlocksPrimary` or `eastBlocksBackup`; a malformed day, a disabled East feature or a feature that blocks no role is a warning, never a silent block or a silent no-op). Not counted in the Totals "East days" column or the East-only tallies until the feed itself carries the day (those count published busy days and derived weeks). A one-year exception (say he swaps Christmas at Davenport once) is a **manual edit in the day editor**, which may override with the visible warning per the eligibility contract — not a data field.
- **Thanksgiving 2026: Khan takes Thu 11/26 – Sun 11/29 as one unit, primary** — Faraz 9/21 evening, **confirmed by Faraz 9/22 (evening)**; locked in the seed (four `existingAssignments` rows, source `faraz-2026-09-21`, note "Thanksgiving unit - Khan primary Thu-Sun (Faraz 9/21 evening; confirmed 9/22)"). ⟶ Prompt 12 B had flagged the rows `awaitingConfirmation: true` (the importer wrote their `schedule_days` note as `awaiting confirmation - seed: …` and the month grid and day editor showed a "confirm" badge) because the daytime record had said pending; ⟶ **Prompt 12 Z (9/22 late): the flag is gone, no badge, the marker leaves the four notes on the next import** — the importer's marker feature itself stays available for future provenance flags; open question #8 closed.
- ⟶ **9/22 (Prompt 12 T, Faraz ~15:40): covers Wed 11/25, 2026 only** — a locked one-off (`existingAssignments` source
  `faraz-2026-09-22-khan-1125`, row note "Khan covers 11/25, 2026 only"), **not a rule** (no Khan rule was added) and **not part
  of the Thanksgiving unit: the unit is 11/26–11/29 only, no eve at Silvis** — 11/25 belongs to no holiday unit; Christmas
  12/24–25 and New Year's 12/31–1/1 keep their eves. The ER-panel author's document had Burchett on 11/25 — superseded (`pendingDeltas`, applied);
  ~~**11/25 backup is open.**~~ ⟶ 9/23: 11/25 backup published to Fierce (generated, unlocked). His run reads 11/25 + the unit (one day for him) = 2 commitments under his max 3.
- ⟶ **9/22 evening — East vacations, away / home (Prompt 15).** Faraz: *"I wonder if I can transfer my vacations over to Silvis as well. The issue is that there are days where I am on vacation at East, where we are not going anywhere, and I can cover call at Silvis."* So his Davenport vacations (`time_off`, kind `vacation` only — no-call days stay a Davenport concept) are mirrored into Silvis by the East feed refresh (part 1, cached per week in the `east_feed` payload `data.vacations`, matched by roster **code**), and **nothing is mirrored blindly**: he marks each range **away** (also off at Silvis) or **home** (available at Silvis — and those are his best Silvis days: a Davenport vacation day has no East call and no OR block). **Rules:**
  - **unreviewed (the default, no decision yet) and away → a Silvis vacation, derived.** Every day of the range is treated exactly like a `time_off` range — both roles blocked (`time-off:<date>`), the day before blocked for primary (`day-before-vacation`, `dayBeforeRules.trailingEdgeRoles`) — in eligibility, the holiday-unit candidates, the generator, the day editor, the claim gate and the open-shifts eligibility. The conservative default: never schedule someone who may be out of town. No `time_off` row is ever written (a change of mind is one tap, no orphan rows); the result carries `eastVacation: 'away' | 'unreviewed'` so the UI can gloss the marker. A Silvis `time_off` day inside the range stands as the Silvis vacation. **Client-side only:** the server-side guards that read `time_off` — `rpc/claim_open_slot` (`CL009 CLAIM_VACATION`), `apply_trade`'s vacation check and the `time_off` trigger — do not see a derived East vacation; it is enforced by the client gate (`eligibility`), so a direct REST claim or a stale PWA that passes no East inputs is not stopped by the database. Extending `CL009` to read the `east_feed` vacations + `east_vacation_reviews` is a possible later migration. **Operational note (9/23):** his real Davenport range over Thanksgiving week covers the locked Thanksgiving unit 11/26–29 and his 11/25 primary — as soon as the app passes the inputs, the unreviewed default lists those four locks as `lockViolations` (`time-off:<date>`, away gloss in the day editor), blocks him for 11/25 backup and shows in any Generate over that week **until he marks the range *home***. **Where he decides (part 3, 9/23):** the *Unreviewed | Away | Home* control on each range in Setup → East feed (the card *East vacations (Davenport time off, reviewed here)*, with the conflicts list), in his own Time off view and in My schedule; the decision is one row in `east_vacation_reviews` (applied by the orchestrator the same night — until then the panel says the table is missing and every range reads unreviewed). His first action after the deploy: *Refresh from Davenport* (his Davenport rows arrive; fewer ranges where adjacent rows merge — the toast names the merged count), then **home** on the range over his Silvis Thanksgiving unit; the rest as he decides.
  - **home → NOT a Silvis vacation.** Those days are `eastClear`: read as **a dated availability of his for both roles** — it lifts exactly what a dated available row lifts (`rules.js` `rowAvail`, Prompt 12 W): `hard-never-weekday` (the Tue/Thu OR-day rule), `recurring-unavailable`, `weekday-not-allowed`, `weekday-pattern`, `weekend-block-only`, `day-before-aledo`, `whitelist-month`, `not-recurring-available`, `outside-available-weeks`; never an obligation — `outside-window`, a vacation (`time-off`) or its trailing edge (`day-before-vacation`), `backup-opt-out`, caps, runs, the other role (Khan has none of the whitelist / Aledo rules today; the list matters for a future East surgeon who does) —, known to East (no `east-unknown`; the forecast is not consulted there, a Davenport vacation being Davenport's own statement that he is off), and they carry a small **primary-only bonus** `east-clear` (−`groupRules.weights.eastClear`, default 2, Setup → Rules → weights; 0 = off) so the generator prefers him as primary there. Backup is unchanged (open anyway).
  - **On a home day the East feed cannot also say busy.** If the data disagree, the feed wins: a published busy day, a standing day (Christmas 12/24–25) or a `busy:true` override inside a home range stays `east-busy` for primary (no bonus), and a diagnostics warning names the day so the Davenport schedule or the override can be checked.
  - **The `time_off` trigger's refusal is mirrored client-side for the derived ranges:** `rules.eastVacationConflicts(ctx)` lists every published day he holds inside an unreviewed/away range (and a published primary the day before one) — a report, never a block on a published lock; the East feed panel shows the list so he can decide *home* or trade.
  - **A refreshed feed that changes or removes a range resets its review** (the match is the exact range: same start and end) — a changed range reads unreviewed again and the old row is deleted (audit `eastvac.review`, reason reset), a removed range's row is dropped the same way, the refresh toast says so; an unchanged range keeps its decision. Audit `eastvac.review { person_id, start, end, decision }`.
  - **Engine keys (generic `eastFeed` feature — any surgeon whose `surgeonRules.<id>.eastFeed.enabled` is true and who has an East code; only Khan today):** `buildContext` inputs `eastVacationRanges { [id]: [{ start, end }] }` (from `east-feed.js eastVacations(rows, code)`, keyed by the roster id resolved from the code) and `eastVacationReviews` (the `east_vacation_reviews` rows: `person_id, start, end, decision`); `ctx.eastVacations[id] = { ranges, vacationDays, clearDays, feedBusyOnHome }`; `diagnostics.eastVacations` in the generator. Ranges for a surgeon without an East feature, an unknown id or an outside surgeon are ignored with a warning. The app-side twins are **person-scoped**: `helpers.reviewStateFor(range, reviews, personId)` and `helpers.derivedEastVacations(ranges, reviews, personId)` consult and list only *that* roster id's rows (the app passes all rows — read-all RLS — for one person's code-resolved ranges; another surgeon's row never decides his range and never appears in `.stale`; with no resolvable person every range is unreviewed and nothing is stale, so the refresh delete is never unscoped). Table + RLS: `docs/SCHEMA-REVIEW.md` (2026-09-23 section).
- **East forecast while Davenport is unpublished** (Faraz 9/21 evening): the Davenport schedule for the next period is not out until the end of 2026. Until it is, the East feed carries a forecast built by running the Davenport generator many times over the next period with the live Davenport inputs; days where Khan is on East call in ≥ 50 % of runs are treated as East-busy for Silvis primary (backup allowed), lower probabilities are a soft penalty, and such days show a “forecast” badge. When Davenport publishes, the real feed replaces the forecast and a conflict report lists any Silvis day needing a trade. Faraz can also enter his published Silvis days as Davenport constraints when he generates DSG. ⟶ **9/22 (Prompt 12 C): precedence published > override > forecast** — inside Davenport's published coverage the forecast is never consulted (published rows win: a published-free day with a stale forecast is eligible); an `east_overrides` `busy:false` clears a published or forecast-busy day and `busy:true` busies it whatever the feed says (an override for a surgeon whose East feature blocks no role is ignored with a warning); *Refresh from Davenport* deletes the `east_forecast` rows for weeks that are now published (count in the `east.refresh` audit row; "count unknown" when the delete returned no rows, never a confident 0); the East feed card ("Conflicts with the published schedule") and `diagnostics.eastConflicts` list the held Silvis slots the new East data makes ineligible. ⟶ **9/23 (overnight review): the published Nov–Jan schedule rests on the 100-run forecast of 2026-09-22** (`docs/east-forecast-latest.json` = `test/fixtures/east-forecast-2026-09-22.json`, `runs: 100`, period 11/16 → 2/21, 14 forecast weeks; 49 of its days fall inside the preview range, 21 of them listed in `diagnostics.eastForecast`); regenerate at 200 runs when convenient (`scripts/east-forecast.js`, a live Davenport read, run by Faraz) and read the conflict report before trusting any Khan weekday it flips.

### Burchett (s2) — recurring whitelist (primary) + weekends
- Typically available **for primary**: **2nd & 4th Monday** (unless in Jackson County), **1st Tuesday**, **2nd & 4th Wednesday**. Otherwise in DeWitt / Jackson County most days. ⟶ **9/22: backup on any day** (off-site is fine for standby).
- Weekends: available for **backup every weekend incl. Fridays** when not primary; takes primary weekends too.
- Weekend style: **split** with Acton — one takes Fri+Sun, the other Sat. (the ER-panel author's doc shows exactly this: 9/25 Burchett, 9/26 Acton, 9/27 Burchett.)
- **Max 2 consecutive 24-h primary periods.** **Monthly cap 7–8 primary days** ⟶ 9/22: backup days do not count toward it; 7 preferred (soft, every month — `s2.monthlyCap.preferred`), 8 hard — Prompt 12 K reading; see §1 Caps.
- ⟶ **9/22 (Prompt 12 A): the 2-day limit is hard on real primary days** — 12/30, 12/31 and 1/1 are three days even though 12/31 + 1/1 is one holiday unit (no opt-in); any-role (primary or backup) soft limit **3**, a growing penalty beyond it.
- Christmas: prefers to **split it up** (every other day, or 2 on then off).
- October: available 10/6, 10/10, 10/11, 10/12 (backup only), 10/14, 10/26, 10/28. Not available 10/2–10/4, 10/18, 10/23, 10/24, 10/30, 10/31, 11/1. Takes 10/25 (Sun) with Sarkar on 10/24 (Sat).
- ⟶ **9/23 (Burchett email, via Faraz 9/23 morning): backup also on 10/9, 10/15, 10/20, 10/22 — dated backup-only rows** (`s2.explicitBackupOnly["2026-10"]`, source `burchett-email-2026-09-23`; the rows' note stays the importer's `seed: Burchett October list`). The four backups moved to him from Khan (10/9, 10/15), Acton (10/20) and Philip (10/22, over his backup cap there) as **locked manual edits** through `scripts/day-edit.js` (guide §19.1); primaries untouched, 10/15 primary stays open (§8 item 1).
- December (can take primary or backup): 12/1, 12/5, 12/6, 12/9, 12/12, 12/13, 12/14, 12/19, 12/20, 12/23, 12/25, 12/26, 12/27, 12/28, 12/30, 12/31, 1/1, 1/2, 1/3. "I don't need all these dates but am able to do them."
- ⟶ **9/23 (Faraz): his December list governs BOTH roles** — his 9/17 email offered "the dates I can take primary call (or
  backup)", so `s2.explicitListMonths` carries `{ month: "2026-12", roles: ["primary", "backup"] }` like November (data
  only; `rules.js` already reads the object form, and the importer keeps an entry as written). He is not placed on a December
  day he did not offer in either role; 12/24 is off the list, so no Christmas-Eve backup either. **The published schedule is
  not regenerated.** The entry invalidates three published backups, all generated and unlocked: **Fri 12/4** (primary Acton),
  **Thu 12/10** (primary Fierce, his derived week) and **Fri 12/18** (primary Khan); his backups on the listed 12/6, 12/19 and
  12/20 stand, as do his primaries (all on the list). Eligible replacements on the published schedule as it stands
  (`eligibility(ctx, day, "backup", id)` with that slot cleared, live rows of 9/23): **12/4 → Khan or Fierce** (Acton holds
  primary, Philip is at his 7-backup December cap and weekend cap, Sarkar is outside her window; Khan already holds the
  12/1, 12/2 and 12/3 backups, so 12/4 would make a 4-day any-role standby run 12/1–12/4 — exactly his `maxConsecutiveAnyRole`
  of 4, no penalty but at the limit; Fierce is the cheaper pick, soft 6 vs Khan's 9); **12/10 → Khan or Acton**
  (Philip at cap, Fierce holds the derived primary, Sarkar outside her window); **12/18 → Acton, Fierce or Sarkar** (Khan
  holds primary, Philip at cap). Faraz reassigns them in the day editor; the rest of December is untouched. Full eligibility table for the three slots, every roster id:
  the December report (history, `docs/HISTORY.md`).
- ⟶ **November (Burchett 9/17 "November Silvis Trauma Call days"; the ER-panel author entered them on 9/22): primary Tue 11/3,
  Sat 11/7, Sun 11/8, Wed 11/11, Fri 11/20, Mon 11/23, Wed 11/25; backup Mon 11/2, Wed 11/4, Fri 11/6, Mon 11/9,
  Sat 11/14, Sun 11/15, Mon 11/16, Wed 11/18.** ⟶ 9/22 evening: backup 11/9, 11/14, 11/15 and 11/16 go to Fierce instead (his derived week, Faraz's call), and **Khan takes Wed 11/25 primary from Burchett this year** — a one-off for 2026, locked, not a rule and not part of the Thanksgiving unit (which stays Thu 11/26 – Sun 11/29); his other entries stand. These match his recurring pattern exactly (1st Tue, 2nd/4th Mon and Wed,
  weekends) but are narrower than it — a whitelist for November (governed month, both roles) and, since the ER-panel author has
  published them, **locked assignments** (§7). He also offered Thanksgiving Day 11/26 with 11/27–28 off and 11/29 —
  superseded by Khan's Thu–Sun unit. Holidays: "every other day or 2-day blocks."
- ⟶ **Faraz 9/22 (final, Prompt 12 T): 11/25 → Khan (2026 only, a locked one-off, not a rule); backup 11/9, 11/14, 11/15,
  11/16 → Fierce (his derived-week rule, Faraz 9/22: it stands moving forward).** Those five entries stay in his list as his
  statement (`s2.explicitAvailable["2026-11"]`, role-keyed: 7 primary + 8 backup dates) but are **not imported as locks**
  (`pendingDeltas`, status applied). Seed keys: `existingAssignments` primary 11/3, 11/7, 11/8, 11/11, 11/20, 11/23 and backup
  11/2, 11/4, 11/6, 11/18 (source `office-er-call-panels-2026-09-22`, locked); `s2.explicitListMonths` gains the object
  entry `{ month: "2026-11", roles: ["primary", "backup"] }`. `rules.js` reads the role scope literally: a plain `'YYYY-MM'`
  entry governs **primary only** (the 9/22 backup rule — his October; his December was one too until 9/23 — see the 9/23 bullet above), an object entry governs **exactly the roles
  it names**, so **November restricts BOTH roles**: he is not generated onto a November day he did not offer, in either role
  (`groupRules.whitelistMonths.roleScope`).
- ⟶ **9/22 evening (Burchett email): weekends in early 2027 he CANNOT work, either role:** **Sat 1/9–Sun 1/10, Sat 1/16–Sun 1/17,
  Fri 2/12–Sun 2/14, Fri 4/9–Sun 4/11.** Exactly as listed — the two January entries are Sat+Sun only, so Fri 1/8 and
  Fri 1/15 are not excluded. ⟶ **Faraz 9/22: "can essentially be considered vacations"** — entered as four `time_off`
  (vacation) ranges for s2, which blocks both roles and the day before each range for primary, exactly like any other
  vacation; source `burchett-email-2026-09-22`. Beyond the current milestone; recorded now for the next generate period.
- ⟶ **9/23 (Faraz): vacation Thu 7/22 – Mon 8/2, 2027** — a fifth `time_off` range for s2 (both roles blocked, 7/21 blocks primary, like any vacation; source `burchett-via-faraz-2026-09-23`); no schedule exists for July 2027, so nothing conflicts, and the July 4th unit (7/3–7/5) is clear of it.

### Acton (s3) — recurring blacklist (primary)
- **Unavailable for primary on the 2nd & 4th Monday and Wednesday** (outreach in Maquoketa). These align with Burchett's available days — the two are designed to complement each other. ⟶ **9/22: backup on those days is allowed.**
- Avoid (soft, medium): the **Sunday immediately before a 2nd/4th Monday** (morning carryover before Maquoketa; "may not be as much of an issue" with a true handoff).
- ⟶ **No Tuesdays for Acton — hard for primary** (Faraz 9/22 evening, at Acton's request); backup on Tuesdays allowed.
- ⟶ **Seed keys (Prompt 12 X, 9/22 evening):** `surgeonRules.s3.hardNeverWeekdays: ["Tue"]`, `hardNeverWeekdaysRoles: ["primary"]` (the generic W read — `rules.js rdStatic`, reason `hard-never-weekday:Tue`, lifted for a date only by his own dated `available`/primary row; a lock is not a row, so his published Tue 9/22 keeps its holder with the rule in `conflicts`), `hardNeverWeekdaysNote` (dropped by the importer); no `hardNeverWeekdaysReason` key on purpose (⟶ 9/22 late, Prompt 12 AA: a `*Reason` key is dropped like every note-like key now — no category token reaches the blob for anyone); the old `recurringAvoid` Tuesday entry left the seed with its note. Data only — no code change; editable in Setup → Rules (hard never weekdays + roles).
- Time off: **Nov 19–22** and **Nov 25–29**; never on Thanksgiving. Christmas or New Year's is fine (alternating days, like Burchett).
- Weekend style: **split** with Burchett; has also taken full Fri–Sun (10/9–10/11), so max consecutive 3.
- ⟶ **9/22 (Prompt 12 A): max consecutive 3 primary days is hard on real days** (no holiday-unit opt-in); any-role soft limit **4**.
- October: primary Oct 5, 7, 9, 17, 18, 19, 21, 23; backup Oct 6, 8, 20. Offered to send a full monthly date list like Burchett.
- ⟶ **November (Burchett's 9/17 relay of "the days Acton submitted"; the ER-panel author entered them into the official
  document on 9/22): primary Mon 11/2, Wed 11/4, Fri 11/6, Sat 11/14, Sun 11/15, Mon 11/16, Wed 11/18; backup Tue 11/3,
  Thu 11/5, Tue 11/17.** A whitelist for November (governed month, both roles) ⟶ 9/22 evening: **no longer — preferences,
  whitelist off (Prompt 12 Y, below)** — and, because the ER-panel author has published them, **locked assignments** (§7). 11/14–16 is
  three consecutive primaries (his max).
- ⟶ **Seed keys (Prompt 12 T, 9/22):** `existingAssignments` primary 11/2, 11/4, 11/6, 11/14, 11/15, 11/16, 11/18 and backup
  11/3, 11/5, 11/17 (locked, source `office-er-call-panels-2026-09-22`; one row per day merges the roles — 11/2 = Acton P +
  Burchett B, 11/14 = Acton P + Fierce B); `s3.explicitAvailable["2026-11"]` role-keyed + the object entry
  `{ month: "2026-11", roles: ["primary", "backup"] }` in `explicitListMonths` (both roles governed; his October stays a plain
  entry = primary only). Consequences: **11/18 primary is the day before his 11/19 vacation** — published as submitted, reported
  as a lock violation, never changed; with him locked as **11/5 backup**, **Thu 11/5 primary has no eligible surgeon** (§8 item 13).
- ⟶ **Seed keys (Prompt 12 Y, 9/22 evening — Faraz: his November list is preferences, not a limit; his 9/17 message gave rules,
  never dates, the dates came via Burchett's relay):** `s3.explicitListMonths` = `["2026-10"]` (the November object entry removed)
  and **no** `s3.explicitAvailable["2026-11"]` block — the importer completes a governed month from that key alone
  (`groupRules.whitelistMonths.rule`, `importer.js impSeedSurgeonRules`), so the data-only way to lift the whitelist is to drop the
  block; his relayed days live on as **locks** in `existingAssignments`, not as availability rows (importer: `availability` delete 8
  — the s3 November rows the T import wrote, 5 primary ranges + 3 backup rows). `existingAssignments` **2026-11-05 = Acton primary
  locked, backup open** (source `faraz-2026-09-22-acton-1105`, row note "Acton primary per his recurring rules (Faraz 9/22 evening);
  his relayed 11/5 backup entry superseded"); `pendingDeltas` 11/5 B s3 → open and 11/5 P open → s3 (applied). Burchett's `s2`
  lists are unchanged (his November whitelist stays). Consequences on the seed: **Thu 11/5 = Acton primary 11/4–11/6, a run of 3 =
  his max**, no conflict on the lock; 11/5 backup open to Khan, Philip, Fierce (Burchett: `whitelist-month`, Sarkar: window);
  Thu 11/12 primary opens to him (its backup is Fierce's derived lock, the other role); **Fri 11/13 is Philip's or Khan's** — Acton is out on his max 3
  (11/13 + his locked 11/14–16 = 4), Burchett on his November whitelist, Sarkar outside her window, Fierce in his derived backup week;
  Khan has **no** Davenport shift that week (the live feed's published coverage runs to 11/15; he is OFF at Davenport the week
  of 11/9, so November inside the coverage holds no East-busy day for him — his East days in the coverage are all Sep/Oct:
  9/30, 10/5–10/10, 10/13, 10/20, 10/26 — and the regression's synthetic feed that busies him 11/13–15 is a test fixture, not
  the feed) and a lone Friday costs him only the soft
  `pattern-mismatch:block`; the 9/23 publish placed Philip; the Tuesdays 11/10 and 11/24 stay Philip's alone
  (item X; §8 item 15); 11/19–22 vacation, 11/18 and 11/24 day-before, 2nd/4th Mon/Wed as before. The milestone preview has no open
  slot any more. §8 item 13 answered.
- **No specific monthly cap** (Faraz 9/21); no target stated.

### Philip (s4) — whitelist of weeks (primary)
- In **Aledo the 1st and 3rd Wednesday** of each month **and the Friday of that 3rd week**; tries to avoid Silvis *primary* those whole weeks (strong soft). ⟶ **9/22: backup on any day, Aledo weeks included.**
- **Hard (primary):** not primary the **day before an Aledo day** (Tue before a 1st/3rd Wed; Thu before the 3rd-week Fri) — he leaves before 7 AM, i.e. before the shift ends, and would dump late non-emergent work on the next person. ⟶ **9/22 (Faraz, Prompt 12 H): under the open-backup rule this stays PRIMARY-only — a standby backup the day before an Aledo day is acceptable** (seed `groupRules.dayBeforeRules.aledoDayBeforeRoles = ["primary"]`; the hand schedule itself had him backup 10/22 before Aledo Friday 10/23).
- Weeks he could be primary or backup (week-of Monday): 11/9, 11/23, 12/7, 12/21, 12/28, 1/11, 1/25, 2/8, 2/22, 3/8, 3/22, 3/29, 4/12, 4/26, 5/10, 5/24, (6/7 tentative vacation), 6/21, 6/28. He does **not** want all of them. ⟶ **B10 (9/23), periods as of 9/24: his 2027 weeks — Jan 2027 (1/11, 1/25) and Feb–Apr 2027 (2/8, 2/22, 3/8, 3/22, 3/29, 4/12, 4/26) — stay a rule** — `surgeonRules.s4.availableWeeks` (primary-only `outside-available-weeks` off them, backup open) — **until he paints those periods himself**: neither Jan 2027 (freeze 11/23) nor Feb 2027 – Apr 2027 (2/1 – 5/2, freeze 12/21) has an offer of his or a mode, so he is *not started* there and the weeks list governs; the first period read them as `either` offers under `exhaustive` (§8 item 15 / item 20), which is the pattern he should not repeat — paint, or be set `preferred`.
- ⟶ **9/23 (audit RG-7): his weeks list runs through the week of 2027-06-28; from 2027-07-05 on he is primary-ineligible everywhere (`outside-available-weeks`) until he supplies more weeks — backup stays open**, and `buildContext` warns (Generate panel, diagnostics) whenever a range runs past any surgeon's last listed week (§8 item 19).
- **No more than one major holiday** (Thanksgiving / Christmas / New Year). **Prefers not a full week at a time.**
- Backup cap (stated for October, treat as monthly): **≤ 7 days and ≤ 1 weekend** of backup — an explicit backup cap, so it survives the 9/22 "backup doesn't count" rule. The group default primary cap (8) applies to his primary days.
- Weekend style: **block**; in practice Thu–Sun (10/29–11/1), so max consecutive 4.
- ⟶ **9/22 (Prompt 12 A): max consecutive 4 primary days is hard on real days**; any-role soft limit **4** with the long-run penalty — this is how "prefers not a full week" is implemented (review item E: 12/22 P, 12/24–25 B, 12/26–29 P is now penalised).
- October: **cannot 10/15** (hard). Primary 10/8, 10/13, 10/16, 10/27, 10/29–11/1. Backup: not 10/15, 10/7, 10/21, 10/23.

### Fierce (s5) — derived East weeks + a weekday pattern the rest of the time
- Takes East call **one week at a time**, alternating between East primary weeks and East backup weeks.
- **East primary week → Silvis BACKUP every day, Mon–Sun.** **East backup week → Silvis PRIMARY every day, Mon–Sun, 24/7.** These are hard pre-assignments (locks) generated from the East feed, never rebalanced. (His own words: "week I am primary at East I cover backup Silvis; week primary at Silvis cover backup East.")
- Source of truth: Davenport `schedule_weeks` rows — `isBackup: true` = Fierce is East primary; `isFierceBackup: true` = Fierce is East backup. **Live-verified 9/21** (Davenport is published through the week of 11/9): East primary weeks **9/28** and **11/9**; East backup week **10/12**. (The Davenport config's `MAY_AUG_FIERCE_*` constants are stale — never use them.) The rule reproduces what the group already did by hand: the ER-panel author's doc has him as Silvis backup all of 9/28–10/4, and Burchett has him primary on 10/12.
- For October the rule is **not** applied retroactively — 10/12 is a single locked day (Faraz 9/21). From November on it is: Silvis **backup 11/9–11/15**. **Faraz 9/21 (evening): East primary week 11/9; East backup weeks 10/12 and 12/7** — so Silvis **primary 12/7–12/13**, carried by `surgeonRules.s5.eastFeed.statedWeeks.eastBackup` (Setup → Rules → Fierce → stated East weeks) until the Davenport rows exist — **not** an `east_overrides` row (that table is empty as of 9/23; the preview and the 9/23 publish derive the week from `statedWeeks`).
- ⟶ **9/22 (Prompt 12 T; Faraz's final word ~15:25): "The original Fierce plan should stand — that rule of his will follow
  moving forward. Primary at East for Fierce = Silvis backup. Silvis primary = East backup."** His derivation rule is
  **authoritative** for his derived weeks: **Silvis BACKUP 11/9–11/16** as explicit locked rows (source
  `fierce-2026-09-22-backup-week`) — 11/9–11/15 coincide with the derived week (same-holder locks that confirm it) and
  **Mon 11/16 is Faraz's explicit decision** (~15:35: "11/16 stays Fierce — that was my decision, not an inference"; an ordinary
  import lock outside any derived week). The ER-panel author's Burchett backup entries on 11/9, 11/14, 11/15, 11/16 are superseded
  (`pendingDeltas`). **Import side:** an ER-panel/email entry that collides with one of his derived weeks is dropped with a
  `pendingDelta` note, never imported as a lock. **Engine side (general rule, unchanged for genuine overrides):** an explicit
  published / import / manual / claimed row beats a derived-week lock — the generator keeps the explicit row, lists the day in
  `diagnostics.derivedYields` (`{ day, role, derivedId, holderId, holderRole, holderSource }`) with ONE warning per derived week
  ("derived week <monday> (<name> Silvis <role>) yields to published entries on <days>"), and lists a day whose explicit holder
  IS the derived surgeon in `diagnostics.derivedConfirmed`. A derived week is *whole* when every day is the derived lock, a
  same-holder explicit lock, or a listed yield. After this amendment November shows **no yield** (`derivedConfirmed` = 11/9–11/15,
  holder Fierce).
- ⟶ **9/22 (Prompt 12 C) — conflict report:** when a refresh adds or moves a derived week, the East feed card ("Conflicts with the
  published schedule") and `diagnostics.eastConflicts` list every held Silvis slot the new East data makes ineligible: someone else
  in his derived slot (`derived-lock-held`), Fierce held in the other role of his derived week (`derived-lock`, plus `east-busy` for a
  primary in an East primary week), and — for a week that is no longer derived — his primary rows that now fall under his weekday
  pattern (`weekday-pattern`, `weekend-block-only`; a full Fri+Sat+Sun block is fine; only from his `deriveFrom` 11/2 on — the single
  locked 10/12 is never listed). A former derived week where he holds **backup**
  raises nothing (backup is open to him every day); the calendar's E badges and `diagnostics.derivedYields` cover it. Locked rows
  are listed too; the report never edits the schedule — open the day to trade or reassign.
- **Outside those weeks he is in the pool and can be primary**, under his weekday pattern (via Faraz, 9/21):

  | Day | Where he is | Silvis eligibility |
  |---|---|---|
  | Mon | East (Davenport) | **backup only** — he must be on site at Silvis when primary (Faraz 9/21) |
  | Tue | Clinton all day | no primary; ⟶ 9/22 backup OK |
  | Wed | Office Clinton/Silvis | **preferred** primary — "good day to be on call" |
  | Thu | Clinton all day | no primary; ⟶ 9/22 backup OK |
  | Fri | Clinton or Dubuque (rotates) | primary only as the start of a **Fri+Sat+Sun block** — never a standalone Friday; ⟶ 9/22 backup OK |
  | Sat / Sun | — | primary as part of his Fri+Sat+Sun block (Faraz 9/21: "his Sat/Sun will run with his Fri"); backup any day |

- ⟶ **9/22 late (Prompt 12 AA review) — open ruling for Faraz:** the "Where he is" column above is also in the anon-readable blob as `surgeonRules.s5.outsideDerivedWeeks.weekdayPattern.<day>.where` ("Clinton all day", "Office Clinton/Silvis", "Clinton or Dubuque (rotates)", "East (Davenport)") because Setup → Rules has a *Where* column for it; no engine code reads it — the rule is the primary/backup flags per weekday, the location is why. Under "no reasons, only the rule" it is the one prose field of his rules left in the blob. **Left as is pending his one-word ruling:** *strict* → the seed key becomes `whereNote` (dropped), the Setup column is retired; *keep* → this line becomes the stated exception. His `statedPreferenceNotARule` sentence (the "ideal" bullet two lines down) already moved to a Note key (`statedPreferenceNotARuleNote`, dropped) — it never was a rule.
- **Cap: up to 14 primary call days per month**, counting Silvis primary days and his East primary week (from the feed) ⟶ 9/22: backup days (either site) do not count.
- He described an ideal of East week → following week Silvis → ~10 days with no call. **Not a rule** (Faraz 9/21): no penalty, no Davenport-side alignment; recorded only as his stated preference.
- Max consecutive 7 (his derived weeks). Weekend style **block** (Fri–Sun).
- ⟶ **9/22 (Prompt 12 A): 7 is hard on real primary days**; any-role soft limit **7**.

### Sarkar (s6) — monthly windows only
- Available **only** inside windows supplied by administration. ⟶ **9/22 evening (the clinic manager, after
  meeting Dr. Sarkar): the weeks are Oct 19–23, Nov 16–20, Dec 14–18, Jan 11–15 — Mon–Fri.** (Earlier, via the administrator
  and Burchett's 9/17 plan: Oct 19–24, Nov 16–21, Jan 11–16 with Saturdays. The Saturdays are no longer stated; see §7
  for what that does to 10/24.)
- ⟶ **9/22 evening: she starts with 2 primary days per window week** ("open to adding more days but wants to see how
  call goes first and then reassess"). This supersedes the 9/22 daytime "3–4 days". Primary days count; backup days do
  not.
- ⟶ **Faraz 9/22 evening: none of Sarkar's rules are hard and fast at this point — "she will adjust once she gets here
  because she will need to."** So: the **2 days is a SOFT target** (`daysPerWindowWeek` target 2, no hard min/max — a
  week with 1 or 3 is a warning in diagnostics, not a violation); every-other-day is a soft preference; the only hard
  facts are her **windows** (she is physically here only those weeks) and the group-wide vacation/lock rules. Keep all
  of it as data in Setup → Rules so it can be tightened after her first window.
- **Mainly every other day when possible** (soft). **A Friday may be taken as a standalone day, separate from
  Saturday/Sunday**; a Saturday standalone is fine if it is ever inside a window again; no Fri–Sun block (soft, strong);
  Sunday is never inside a window. Backup on her remaining window days is allowed but not required.
- Her target is her window-week days, not an equal share. A handoff partner the next morning is a diagnostics check.
- ⟶ **Seed keys (Prompt 12 N, 9/22 evening):** `daysPerWindowWeek.target` = 2 (soft; a primary placement that keeps her **at or under** the target earns the bonus `window-week-below-target`, every day over it costs `window-week-over-target`; `countsBackup: false` = primary days only; the old `min`/`max` keys are ignored with a warning), `preferAlternateDays: true` (soft `consecutive-primary`), `weekendBlockPenalty: "strong"` (soft, on any multi-day block or split membership), `weekendStyle: "daily"` (a window Friday is a standalone day; `saturday-only` is legacy), `handoffPartnerRequired: true` = diagnostic only (`diagnostics.handoffGaps`); no `hardNeverWeekdays` — `availableWindows` is her only hard rule; her monthly primary target = target × window weeks in the month (`diagnostics.impliedTargets…windowTarget`, `diagnostics.windowWeeks`).
- ⟶ **9/22 (Prompt 12 A): max 2 consecutive primary days is hard on real days**; any-role soft limit **2**.

## 4. Weekend unit — how the styles combine

The generator treats Fri/Sat/Sun as one unit and chooses a pattern per weekend:

1. **Block** — one surgeon Fri+Sat+Sun (Khan, Philip, Fierce — for Fierce this is the *only* way he takes a Friday).
2. **Split** — one surgeon Fri+Sun, another Sat (Acton/Burchett pair; also valid for any two surgeons who both accept split). Keeps each under the 2-consecutive limit. Sarkar is offered in a split or block only under her `weekendBlockPenalty` (strong soft, 9/22 evening); with Mon–Fri windows she holds no Saturday or Sunday anyway.
3. **Daily** — three independent days; fallback only — except for Sarkar (`weekendStyle: "daily"`), for whom a window Friday is a standalone day, the normal pattern (9/22 evening); no window carries a Saturday or Sunday now.

Backup for the weekend is filled with the same unit logic after primary. A surgeon's `weekendStyle` is a preference; the hard constraints (availability, caps, max consecutive) always win.

## 5. Holidays — same set as Davenport, but as primary + backup units

Silvis uses the **same six holidays as the DSG app** (major: New Year's, Thanksgiving, Christmas; minor: Memorial Day,
July 4th, Labor Day), but the Davenport "surgeon A on the day, surgeon B the night before" convention does not carry
over. Instead each holiday is a **unit of one or more days with one primary and one backup who both stick through the
whole unit** (Faraz 9/21: "that person will probably stick through for each eve, day"). A holiday unit takes precedence
over any weekend unit it overlaps; the leftover weekend days form a reduced weekend unit.

⟶ **Confirmed 9/22 evening (Faraz): the minor holidays are July 4, Labor Day and Memorial Day** — the tiers in the
table below stand as the rule. ⟶ **9/22 evening (Faraz): a minor holiday that falls on a Monday absorbs the weekend
before it** — the unit is **Sat–Mon** (one primary + one backup through all three days); the Friday stays a standalone
weekend day (the reduced weekend unit). So Memorial Day 2027 = Sat 5/29 – Mon 5/31 and Labor Day 2027 = Sat 9/4 – Mon 9/6.
July 4 is its own day when its observed day is not a Monday (2028: Tue 7/4). Day membership stays **editable per year in Setup**.
⟶ **Decided 9/22 late (Faraz, Prompt 12 AC): Thanksgiving is Thu–Sun every year** (2027: Thu 11/25 – Sun 11/28, the
same shape as 2026), **and July 4 uses its observed day** — July 4, 2027 falls on a Sunday and is observed Monday 7/5,
so the unit is **Sat 7/3 – Mon 7/5** under the Monday-absorbs-the-weekend rule (Fri 7/2 is the reduced weekend unit).
A Saturday July 4 is observed on the Friday; the builder default for that shape is the Friday alone (next: 2037), which
nobody has decided yet — the one point still open. Data only (`holidays.units["2027"]`), editable in Setup; the
per-year builder follows the same shapes for Add year.
Seed keys (Prompt 12 U): `groupRules.holidays.mondayMinorAbsorbsWeekend` (true) — read by the per-year unit builder (`helpers.defaultHolidayUnits`) that Setup's Add year pre-fills; stored days stay authoritative and editable in Setup **until the next seed re-import** (`scripts/import-seed.js --apply` replaces `blob.holidays` from the seed wholesale — mirror Setup holiday edits into `docs/silvis-seed.json` before re-importing, or stop re-importing the blob after go-live); 2026 left as built.

⟶ **9/22 evening — standing East rule: Khan is on Davenport call every Christmas Eve and Christmas Day.** That is
treated like a published East busy day every year, independent of the feed and the forecast: Khan is never Silvis
**primary** on 12/24 or 12/25 (so never the Christmas unit's primary); backup on those days follows his normal
East-day rule (allowed).
Seed key (Prompt 12 V): `surgeonRules.s1.eastStanding` (generic — any surgeon, an `MM-DD` list per named entry; seed/blob data, no Setup field yet) — read by `rules.js` as a published busy day in every year (`east-busy`, primary only for Khan, ahead of the forecast and of the coverage), so `holidayUnitCandidates` never lists him for the Christmas primary; `diagnostics.eastStandingDays` lists the concrete days of a run. Same gate as busy days (`eastFeed.enabled` blocking a role; otherwise a warning). Not counted in the Totals "East days" column until the feed carries the day. A one-year exception is a manual edit with the visible warning.

| Holiday | Tier | 2026 unit days | Notes |
|---|---|---|---|
| Memorial Day | minor | Mon 5/25 (past) | 2027: **Sat 5/29 – Mon 5/31** (Monday absorbs the weekend) |
| July 4th | minor | Sat 7/4 (past) | 2027: **Sat 7/3 – Mon 7/5** (Sunday holiday observed Monday 7/5; the Monday absorbs the weekend — Faraz 9/22 late, Prompt 12 AC); 2028: Tue 7/4 alone |
| Labor Day | minor | Mon 9/7 (past) | 2027: **Sat 9/4 – Mon 9/6** (Monday absorbs the weekend) |
| Thanksgiving | major | **Thu 11/26 – Sun 11/29 (one unit; Khan primary — Faraz 9/21, confirmed by Faraz 9/22 evening; Prompt 12 Z)** | Acton never (opted out); Philip ≤ 1 major; backup: anyone not opted out. 2027: **Thu 11/25 – Sun 11/28** (Thu–Sun every year — Faraz 9/22 late, Prompt 12 AC) |
| Christmas | major | Thu 12/24 + Fri 12/25 | Eve + Day as one unit; **Khan never primary (East, every year)**; Burchett available 12/25–28 |
| New Year's | major | Thu 12/31 + Fri 1/1/2027 | Eve + Day as one unit; Burchett available 12/30–1/3 |

**The day rules are not for holidays (Faraz 9/21 evening).** On a holiday-unit day the weekday-pattern rules do not apply — not Khan's Tue/Thu or Mon/Wed-only, not Burchett's recurring whitelist, not Acton's 2nd/4th Monday and Wednesday, not Fierce's Clinton days or Monday-backup-only, not Philip's Aledo weekday rules — for primary or backup. **Anyone can be backup (or primary) on a holiday unless they explicitly want that holiday off** (Acton: Thanksgiving). Still enforced on holidays: vacations, East call days and the East forecast, Fierce's derived-week locks, Sarkar's windows, monthly caps, Philip's one-major-holiday limit and, since 9/22, every explicit dated list (a governed month's list, Philip's listed weeks — see the small-items note below). ⟶ 9/22 (Prompt 12 A): a holiday unit counts as one day for the consecutive limits **only for a surgeon who opted in** (`surgeonRules.<id>.holidayUnitCountsAsOneDay` — Khan); everyone else counts real days. Encoded as `groupRules.holidays` plus per-surgeon `holidayRules.holidaysOff` in the seed. ⟶ 9/22 (Prompt 12 small items): an **EXPLICIT dated list is never waived** — a governed month's list (`whitelist-month`) and Philip's weeks list (`outside-available-weeks`) stay hard on a holiday-unit day (Burchett's December list omits 12/24 on purpose, so he cannot hold the Christmas unit, and his both-role November list keeps him off Thanksgiving backup; Philip is not a Memorial Day 2027 primary candidate: Sat 5/29 and Sun 5/30 fall in his listed week of Mon 5/24, but Mon 5/31 does not, and a holiday unit needs every day clear); only the recurring weekday patterns above are waived.

Burchett's stated Christmas preference ("2 days on then off") is satisfied by the two-day unit. Holiday fairness is
tracked separately from shift counts: major and minor counts per surgeon, lifetime, tenure-normalized — the same idea
as the Davenport holiday pools.

## 6. Fairness model (differs from Davenport) — ⟶ rewritten 9/22; ⟶ water-filled share decided 9/23

**"We want everyone to be as equal as possible."** Fairness is measured on two separate counts per surgeon per month
(and rolling 12 months): **primary shifts** and **backup shifts**. The generator drives both spreads down across the
pool, within each person's availability:

- **Water-filled share by default (Faraz 9/23, after the November-backups report - history, `docs/HISTORY.md`).** Every active pool member
  (Khan, Burchett, Acton, Philip, Fierce) gets an implied target per role = his share of **all** the month's slots of the
  pool for that role — the open ones **and** the ones already fixed (imports, manual locks, Fierce's derived weeks, claims,
  published days outside the range) — water-filled across the members' clips (a member whose cap / East-day clip is below
  the level takes the clip and the remainder is shared by the others). A surgeon's own locked and derived-week days
  **count against** his share; the target is **never floored at his locked count**. The deviation term is **convex**
  (`|count − target| ^ 2` by default): each slot above share costs more than the one before, and of two candidates below
  share the one **furthest below** wins — so the leftover slots of a month go to whoever is furthest below share, in both
  roles, instead of being split by soft terms and jitter (November 2026: Fierce's 8 derived-week backups made his flat
  target 8 and he took 8 more; with the water-filled share he stands above his 5.8 and the generated backups go to
  Khan / Acton / Philip — the what-if in the water-fill report - history, `docs/HISTORY.md`; `test/water-fill.test.js` restates its runs). Nobody has a "neutral" or zero term;
  `monthlyTarget: null` means "equal share", not "no target". The published schedule was **not** regenerated for the
  decision; it applies to every Generate from 9/23 on.
- **Offers and the share (B10, 9/23 — after the pre-launch review, §5 item 2).** Inside a period a surgeon who painted
  days in **preferred** mode carries the soft `outside-offers` penalty (+`weights.outsideOffers`, 6) on a non-offered day
  **only in a calendar month where he offered at least one day of that period** (an offer after the period's end, or in the next period, never switches a month on for this one); in a month he did not paint at all he competes on the
  equal share like a rules-only colleague (before B10 the penalty rode on every day of the period once he had any offer
  in it — Acton, who painted November only, carried the penalty on all of December and January). The scoping is the
  penalty's alone: his status stays *submitted* period-wide (mode, the dated lists switched off, the e-mail's off-list
  list — `diagnostics.offers.outsideOffers` still names every off-list placement), **exhaustive** stays "only these days"
  over the whole period, and the water-filled share itself is untouched — the penalty is a score term, never a target,
  so in a month without offers he is simply placed to his share. Offers-first placement of offered units is unchanged.
- **Availability limits the share, not the intent.** Someone who cannot take Thursdays or 2nd/4th Mondays gets fewer of
  those, and the generator makes it up elsewhere for them where it can; the diagnostics show each person's share vs.
  what their rules allowed.
- **Caps count primary only** (9/22). Backup runs are unlimited by count; long any-role runs are discouraged by a soft
  penalty (see §1 consecutive days and Prompt 12 A).
- **Khan's weekend preference** is a bonus term: weekend primary for Khan scores better than weekend backup for Khan when
  East allows; his backup count is still balanced like everyone else's.
- **Sarkar** is targeted at her window-week primaries (⟶ 9/22 evening: 2 per week to start, adjustable in Setup → Rules), alternating days when possible; she is outside the
  equal-share pool. **Fierce's** derived weeks count toward his primary/backup tallies and the pool balances the rest.
- **Outside surgeons** (internal locums) are never in the pool; their hand-written days reduce the pool's slot count.
- Metrics per surgeon — by month, year-to-date and rolling 12 months: primary shifts, backup shifts, weekend days,
  major/minor holidays, longest run (primary-only and any-role), each vs. share/cap. One 24-hour day = one shift; nothing
  is weighted or split. **No compensation, stipend or $ figures anywhere in the app.**
- Generation objective, in order: (1) zero uncovered primary days, (2) zero uncovered backup days, (3) zero hard-rule
  violations, (4) minimize soft penalties, (5) minimize primary spread, (6) minimize backup spread, (7) balance weekends
  and holidays.

**Key names (Prompt 12 J, 9/22 — `generator.js genTargets`; data in `call_schedule_data.data.surgeonRules`):**

- `surgeonRules.<id>.monthlyTarget`: `null` or absent = **equal share** (both roles); a **number** = the **primary** target
  for the month (the backup target stays the share); `{ "primary": n, "backup": m }` sets each. There is no neutral or
  zero term. Setup → Rules edits the number form only (its "Monthly target" field is a single number; blank = equal
  share — the field's hint still says "blank = no target", a pending one-line follow-up); the object form is blob-only
  for now. `rules.js` still reads a numeric `monthlyTarget` as an any-role soft term (pending in the rules.js item; no
  shipped surgeon has a number today).
- `surgeonRules.<id>.poolMember: false` takes a surgeon out of the pool (no targets); a roster entry of `type: "external"`
  is never in it; `availableWindows` + `daysPerWindowWeek.target` gives the window target instead (primary only, no
  backup target — item N); `backupCap.perMonthDays` clips the backup target; the K clip
  (`min(monthlyCap.preferred, monthlyCap.primary − 1) − East primary-week days`) clips the primary target.
- Per month the generator reports `diagnostics.impliedTargets.months[m]` = `{ primaryOpen, backupOpen, poolSize,
  reservedForWindows, primaryShare, backupShare, rangeDays, placeableAtTarget: { primary, backup }, members }` with
  `members[id]` = `{ primaryTarget, backupTarget, lockedHeld: { primary, backup }, clipPrimary, eastPrimaryDays,
  allowedPrimary, allowedBackup }` — `allowed` is the number of the month's open slots the rules let the surgeon take
  (a weekend day of a full Fri–Sat–Sun unit counts as a block member, a holiday day as a unit candidate), so a target
  above it is an availability shortfall. `lockedHeld`, `poolSlots` and the targets are whole-calendar-month figures even
  where the range only touches the month (`rangeDays`). ⟶ 9/23: `poolSlots: { primary, backup }` = the pool's slots of
  the month (open + held by pool members), `heldByPool`, `primaryShare` / `backupShare` = the water **level** (the share
  of an unclipped member), `placeableAtTarget` = Σ max(0, target − lockedHeld) per role = the room below the targets (at
  least the open slots; above them by `heldAboveShare` = Σ max(0, lockedHeld − target), the fixed days already over share,
  which the generator balances only by placing nothing more on their holders), `convexity` = the exponent in force;
  `primaryShare` / `backupShare` read `null` when every member sits on his clip (no level exists — ⟶ 9/23 review fix; the
  seed never produces that month).
  `diagnostics.tallies[id].months[m].target` = `{ primary, backup }` (the Totals
  view's **Target** and **Target B** columns — both compare that role's days only; the range row carries the sums).
- `groupRules.weights.deviationConvexity` (⟶ 9/23; seed value **2**, also the code default): the exponent of the deviation
  term, `|count − target| ^ convexity`, read wherever the deviation is scored — the primary and backup passes, weekend and
  holiday unit patterns (the pattern total sums the per-member convex terms), repair, target smoothing and the best-of-N
  score. `1` restores the flat ±1 term; values between temper the growth (the report shows 1.5 and 1 next to 2). A value
  that is present but rejected (non-numeric, `NaN`, below 1) is named in `diagnostics.warnings` (`weights.deviationConvexity
  … ignored: needs a finite number >= 1; using 2`) and 2 applies (⟶ 9/23 review fix; `impliedTargets.convexity` shows the
  value in force either way).
- Score parts, lexicographic: `uncoveredPrimary`, `uncoveredBackup`, `hardViolations`, `softSum`, **`primaryDeviation`
  (×300)**, **`backupDeviation` (×100)**, `weekendSpread`, `holidaySpread` — the two deviations are the sums of the
  per-member convex terms since 9/23; target smoothing moves primary days and, separately, backup days from the surgeon
  furthest above his target to one further below through `eligibility()` whenever the convex deviation strictly falls
  (two members both above share included).

## 7. Existing assignments to import (locks)

`silvis-seed.json → existingAssignments` holds every day from **2026-09-14 through 2026-11-01** exactly as the emails
describe it: the ER-panel author's 9/16 document plus the later email updates, already applied (49 days; the 7 Atwell-covered days
flagged `externalCover`; 16 open backup days). Import them as **locked** slots. ⟶ 9/22 (Prompt 12 T): the file now also
holds Khan's four Thanksgiving rows and the 20 November rows of the ER-panel author's 9/22 document (below) — 73 rows in all. The applied updates (logged in
`pendingDeltas` with `status: applied`):

- 10/12 primary → Fierce, **single day only** (Burchett 9/18); the full-week derivation rule applies from November.
- 10/23 primary → Acton (Burchett 9/18).
- 10/20, 10/22, 10/24 primary → Sarkar; 10/25 primary → Burchett (Burchett's 9/17 October plan). ⟶ 9/22 evening: **10/24 taken back off Sarkar** (two days a week, October included) — open primary.
- Seed keys touched 9/22 evening (Prompt 12 S): `existingAssignments` 2026-10-24 -> `primary: null`, `source: "faraz-2026-09-22-sarkar-two-days"`, `note` (locked-open like 10/15); `pendingDeltas` gains the 10/24 row (`surgeon: null`, `replaces: "s6"`, `status: "applied"`); `surgeonRules.s6.availableWindows` = the four Mon-Fri ranges + `availableWindowsNote`; `surgeonRules.s2.timeOff` = the four 2027 weekends (`public: true`, note `"unavailable (stated 9/22)"`, `source: "burchett-email-2026-09-22"`) + one `notes` line; `_meta.revisions`, `answeredQuestions`, `openQuestions` 6-7. The importer writes a `public: true` vacation note to `time_off` only when it passes the item-F denylist and names no roster surname: a denylist word refuses the import, a surname falls back to `vacation (seed)` (dry run: `-> private-name`); a private note is always `vacation (seed)`.
- Seed keys touched 9/22 evening (Prompt 12 Y): `existingAssignments` 2026-11-05 -> `primary: "s3"`, `backup: null`, `locked: true`, `source: "faraz-2026-09-22-acton-1105"`, note "Acton primary per his recurring rules (Faraz 9/22 evening); his relayed 11/5 backup entry superseded" (the row count stays 73); `pendingDeltas` gains 11/5 B s3 -> open and 11/5 P open -> s3 (both `status: "applied"`); `surgeonRules.s3.explicitListMonths` = `["2026-10"]` and the `s3.explicitAvailable["2026-11"]` block removed (his November list is preferences; the days stay as locks); `openQuestions` 13 answered; `_meta.revisions`. Importer dry run against the live tables (9/22 evening): `schedule_days` update 1 (`11/5 P OPEN -> Acton`, `11/5 B Acton -> OPEN`), `availability` delete 8 (the s3 November rows: 11/2, 11/4, 11/6, 11/14..16, 11/18 primary; 11/3, 11/5, 11/17 backup), blob `surgeonRules=update`, `time_off` unchanged.

**The open primary days in the import are 10/15 (Thu) and, since 9/22 evening, Sat 10/24 (see below).** 10/15: Philip cannot (hard), Burchett and Acton did not offer it,
Khan never takes Thursdays, and Fierce is in Clinton on Thursdays. It needs a human decision (still open after the 9/23 publish, which left 10/15 primary OPEN). ⟶ **9/23: from 11/2 on the
schedule is the 24 locked import rows (20 of the ER-panel author's 9/22 entries, below, plus Khan's 11/25–29) and the generated rows published
2026-09-23 from the committed preview** (`docs/PUBLISH-2026-09-23.md`; unlocked, editable in the day editor) — every November day
holds a row.

⟶ **9/22 evening — Sat 10/24 is now in question.** the clinic manager's email has Sarkar at **2 days** in the week of
**Oct 19–23 (Mon–Fri)**; the import carries her on 10/20, 10/22 **and Sat 10/24** (Burchett's 9/17 plan). If the new
statement stands, 10/24 comes off Sarkar and becomes a second open primary day in October (Burchett already holds
Sun 10/25 and said he cannot do 10/24; Acton's rules allow a Saturday). ⟶ **Faraz 9/22 evening: adjust her to two days
a week, October locks included — so Sarkar keeps 10/20 and 10/22 and comes OFF Sat 10/24.** 10/24 primary is now the
second open primary day of the import (locked-open like 10/15, listed with reasons; backup 10/24 was already open).
Candidates by the rules: Acton (a Saturday is allowed; he is primary Fri 10/23, so 10/24 would make 2 consecutive),
Khan (weekend primary if East is clear that day), Philip (his October list is the model — check it), or an outside
surgeon written in. Burchett said he cannot do 10/24.

### ⟶ 9/22 evening — the ER-panel author's updated document ("ER Sp Trauma 9-14-26 thru 12-13-26", sent 12:49)

The ER-panel author entered Burchett's and Acton's **November** days from the 9/17 email into the official schedule and listed what
is still open in **October**. Two consequences:

1. **November is no longer a blank sheet.** The 25 entries she made (Burchett 7 primary + 8 backup, Acton 7 primary +
   3 backup, §3) are published to the group and are imported as **locked assignments**, exactly like Sep 14 – Nov 1.
   The generator fills the rest of November around them. Both surgeons' November lists also become governed-month
   whitelists, so neither is placed on a November day he did not offer. Open primaries left for the generator after
   the locks: 11/5, 11/9, 11/10, 11/12, 11/13, 11/17, 11/19, 11/21, 11/22, 11/24, 11/30 (11/26–29 is Khan's unit) ⟶ 9/22
   evening (Y): 11/5 became Acton's lock; ⟶ 9/23: the other ten were filled by the published generate
   (`docs/PUBLISH-2026-09-23.md`) — this open list is history, not the current state.
   ⟶ **9/22 (Prompt 12 T, seed):** 20 of the 25 entries are imported — rows 11/2–11/18 daily, 11/20, 11/23, 11/25
   (`schedule_days` total 73); one row per day merges the roles (11/2 = Acton P + Burchett B; 11/14 = Acton P + Fierce B;
   11/9 = Fierce B, primary open; 11/25 = Khan P, backup open; ⟶ 9/22 evening, Prompt 12 Y: **11/5 = Acton P locked, backup
   open**, source `faraz-2026-09-22-acton-1105` — his relayed 11/5 backup entry superseded); a null slot is open for the generator. The five entries
   Faraz's amendments supersede are **not** imported (`pendingDeltas`, applied): Burchett 11/25 primary → **Khan, 2026 only**
   (a locked one-off, source `faraz-2026-09-22-khan-1125`, note "Khan covers 11/25, 2026 only"; not part of the Thanksgiving
   unit, which stays 11/26–11/29) and Burchett backup 11/9, 11/14, 11/15, 11/16 → **Fierce** (below).
2. **One conflict inside her entries:** Burchett as backup on **11/9, 11/14, 11/15, 11/16** falls inside Fierce's
   derived Silvis-backup week (East primary week of 11/9). ⟶ **Decided (Faraz 9/22 evening): Fierce takes backup
   11/9 through 11/16** (Mon–Mon, the derived week plus the Monday). Burchett's published backup on those four days is
   superseded, and **11/25 primary goes to Khan for 2026** (Faraz's one-off, locked; the Thanksgiving unit itself is still
   Thu–Sun). His other November entries (primary 11/3, 11/7, 11/8, 11/11, 11/20, 11/23; backup 11/2, 11/4, 11/6, 11/18)
   stand. (No correction to the ER-panel author's document — it is retired when the app goes live; §2.)

**October per the ER-panel author's document** — open primary: 10/15, 10/20, 10/22, 10/24, 10/25; open backup: 10/15, 10/21,
10/23, 10/24, 10/25, 10/30, 10/31, 11/1. So the ER-panel author does **not** yet have Sarkar on 10/20 and 10/22 (Burchett's 9/17
plan, now consistent with the clinic manager's two-days statement) nor Burchett on 10/25 (his own plan). ⟶ Nothing goes back into her document: the app carries 10/20, 10/22 (Sarkar),
10/25 (Burchett, to confirm) and the open 10/15 and 10/24, and the app is the source of truth from go-live. The eight open October backups are fillable by
anyone under the 9/22 backup rule: run the generator over 10/15 – 11/1 in **fill-open-only** mode (locks untouched)
before publishing, or assign them by hand.
⟶ **9/22 (Prompt 12 T):** the import carries **three more open backups** inside 10/15 – 11/1 than the ER-panel author's list — **10/16, 10/27,
10/29** (Philip primary days her 9/16 document left without a backup; §8 item 14) — eleven open backups in all, plus the two
open primaries 10/15 and 10/24 (⟶ history: all filled by the 9/23 publish, `docs/PUBLISH-2026-09-23.md`, except 10/15 primary — §8 items 6, 11, 14). The fill-open-only pass is `generator.generate(ctx, start, end, { fillOpenOnly: true })`: every
slot held on the input (locked or not, `externalCover` included) is fixed and never rewritten, only open slots are filled,
`diagnostics.mode = "fill-open-only"`, `diagnostics.fixedSlots` = the fixed count, a held unlocked slot that breaks a rule is a
fact in `diagnostics.fixedViolations` (never a hard violation); `scripts/preview-generate.js --backfill 2026-10-15..2026-11-01`
runs it as a second generate over the same live rows and prints a separate section per open slot (placed candidate, or "open"
with per-surgeon reasons, and the alternatives eligible on the input schedule) plus the backfill's tally delta; the JSON gains
`backfill: { range, schedule, diagnostics }`. Nothing is published by the script — Faraz decides (§8 item 11).
⟶ **9/22 late (Prompt 12 AB):** the import also carries **five open backups before 10/15** — **10/7, 10/9, 10/10, 10/11 (Acton primary) and
10/13 (Philip primary)**, the ER-panel author's 9/16 rows, locked — so the first open slot from 9/22 is **10/7**, not 10/15; the in-app default Generate
range now starts there (§1 Period row) and fills those five backups, the eleven above, 10/15 and 10/24 and the milestone in ONE run
(locks untouched — the 10/15 – 11/1 fill-open-only script path above remains available). Whether the five pre-10/15 backups are wanted
filled, or stay open, is Faraz’s call — a floor at 10/15 would be group-rule data, not a code branch (§8 item 11).

⟶ **9/23 (Prompt 13 / P13R):** a slot a surgeon takes **himself** — through the Open shifts board (`claim_open_slot`,
row source `claim`) or a trade (`apply_trade`, row source `trade`), neither of which sets a lock flag — is **fixed for
the generator in both modes exactly like a lock** (every held role of that day; `generator.GEN_PERSON_FIXED_SOURCES`).
A later Generate never silently discards it; its rule conflicts are facts in `diagnostics.fixedViolations`, and it
counts in `diagnostics.fixedSlots`. An unlocked slot written in the **day editor** (source `manual`) stays regenerable —
the lock toggle there is the scheduler's choice. Editing a claimed or traded day (a note, a lock, an assignment on
its open partner role) **keeps** its source while any holder it had stays in place (P13R-2, 9/23); only replacing or
clearing every holder turns it into a `manual` row — the scheduler's explicit, audited and mailed replacement. Because
the source is one fact per day, the partner role of a claimed day is fixed with it (known limitation; guide §16.2). The
board's "Take this shift" gate is `eligibility()` with the same option set the day editor uses (a surgeon
completing his own Fri–Sun block is asked as a block member; outside surgeons are never candidates); the function checks
data integrity only (guide §16.2).

⟶ **9/23 (Prompt 14 P2) — how the lists above meet the offer periods.** From the first period (Nov 2026 – Jan 2027, part 5) the dated lists in this document live as `call_offers` rows and the engine reads them offers-first: Burchett's November list as **exhaustive** offers reproduces his governed-month whitelist exactly (he is placed on no November day he did not name, in either role) and his five superseded entries — backup 11/9, 11/14, 11/15, 11/16 (Fierce's week) and primary 11/25 (Khan) — come back as *unplaced offers* with the slot's reason (`slot-locked`) instead of vanishing; Acton's relayed list as **preferred** offers keeps his locks, lets his recurring rules fill the rest of November with every off-list placement named in `diagnostics.offers.outsideOffers` (his publish email says "trade if needed"), and reports his superseded 11/5 backup as unplaced (`holds-other-role` — he is the 11/5 primary); Khan and Sarkar as **rules-only** are scheduled exactly as before (Khan's East days, Sarkar's windows; her window days are her rules, not offers). The ER-panel locks stay locks whatever the offers say (a lock holder's off-list day is a `conflicts` entry, never a move). An offer is not a demand: whoever offers more than his share is placed to his share — the offered bonus stops there (`weights.offerBonusOverShare`, §1 Process row) — and a claim from the open-shifts board by a rules-only surgeon leaves his status alone (no offer row), while a claim by a surgeon with nothing entered is his first offer. Proof: `test/fixtures/offers-2026-11.json` + the Prompt 14 P2 blocks of `test/generator-regression.js`. ⟶ **9/23 (Prompt 14 P5) — how the lists reach the app:** every list above that falls inside the first period enters `call_offers` through the seed importer (`node scripts/import-seed.js --apply`, `docs/silvis-seed.json` `offerPeriods[]` + `surgeonRules.<id>.offerSources` tags; note `seed: burchett-email-2026-09-17` / `seed: acton-via-burchett-relay-2026-09-17` / `seed: philip-email-2026-09-20`, `entered_by scheduler`, `source email-relay`), never by hand — Burchett's November and December lists and Philip's weeks as **exhaustive** offers, Acton's relayed November days as **preferred** offers, Khan and Sarkar as rules-only, Fierce not started (no single day of his inside the period is on record); the October lists stay dated availability rows, the ER-panel author locks stay locks, and the seed keeps the statements as written (build guide §17, part 5). *Applied 9/23 through the CLI, twice: the first period with its offers and modes, then (PD, the same afternoon) the first period's row set `published` and the second period inserted (Feb 2027 – Apr 2027 — the third since the Jan 2027 row of 9/24, its end Sun 5/2 since 9/24) — build guide §17, "Live".*

## 8. Answered (9/21) and still open

**Answered by Faraz on 9/21:** shift boundary 07:00→07:00; October stays as the emails describe it (Fierce 10/12 single
day, Acton 10/23, Sarkar 10/20/22/24 — ⟶ 9/22 evening: 10/24 removed —, Burchett 10/25) and the rules generate from November; Sarkar 3–4 days per window
week, Saturday OK, never Fri/Sun, no target; Khan may be backup on East days, Mon/Wed are auto-offered, no cap; Fierce is
in the pool outside his derived weeks under his weekday pattern — Monday backup-only because primary must be on site,
weekends as Fri+Sat+Sun blocks, 14 call days/month cap, and his "10 days off" is a preference not a rule; Acton has no
specific cap; the office contact gets a viewer account (administration none); no compensation in the app; no Atwell; no APPs.

**Scope decisions (Faraz 9/21):** dropped from Davenport — APP info/call/vacation, Fierce's separate backup weeks, no-call
days, the vacation approval workflow, split/weighted shift accounting, compensation. Kept — shift trades, stats with shift
counts and fairness, a running yearly tally. Carried over — office notifications, calendar sync, refresh, data management
and every safety feature. Holidays are the same DSG set, as primary + backup units.

**Answered by Faraz on 9/21 (evening, in chat with Claude Code):** Thanksgiving 2026 = Khan primary Thu 11/26 – Sun 11/29 as one unit (confirmed by Faraz 9/22 evening — open question 8, closed); the day rules do not apply on holidays and anyone may be backup unless opted out; the Davenport schedule is not out until year end, so Silvis includes Khan and avoids his most likely East days via a forecast; Fierce East primary week 11/9, East backup weeks 10/12 and 12/7; port the bones and safety features, adjust whatever will not work for Silvis. The defaults taken for every remaining ambiguity (lock semantics for open slots, whitelist months, precedence, consecutive counting, caps, weights, Fierce cap arithmetic, Sarkar minimum, day-before rules primary-only) are listed in the 9/21 orientation (history, `docs/HISTORY.md`) §3 and written into `silvis-seed.json` (`groupRules.*`).

**Answered by Faraz on 9/22 (in Cowork):** backup is open to everyone every day unless a surgeon explicitly opts out;
everyone as equal as possible; monthly caps count primary only (backup days do not count toward the 8); Khan's main
contribution is weekend primary when available, cross-referenced against all of his Davenport call; outside surgeons
("internal locums", e.g. from Davenport) can be added to the roster and written in by hand; Sarkar is primary 3–4 days
of her window week, mainly every other day, and may take a Friday as a standalone day.

**New statements received 9/22 evening (emails forwarded by Faraz):** Sarkar starts with **2 days per window week**
(the clinic manager, after meeting her; weeks Oct 19–23, Nov 16–20, Dec 14–18, Jan 11–15, Mon–Fri; open to
more later) — supersedes "3–4"; Burchett **cannot work** the 2027 weekends 1/9–1/10, 1/16–1/17, 2/12–2/14, 4/9–4/11.
**Faraz's reading (9/22 evening):** Sarkar's rules are **not hard and fast** at this point — she will adjust once she is
here — so her day count is a soft target and only her windows are hard; **but the two-days-a-week figure is applied to
the October locks too: Sarkar keeps 10/20 and 10/22 and comes off Sat 10/24**, which is now open. Burchett's dates
**are vacations**.

**Answered by Faraz on 9/22 afternoon (Prompt 12 T, final wording ~15:25–15:40):** Fierce's original plan stands and his
derivation rule follows moving forward (East primary = Silvis backup, Silvis primary = East backup) — he is Silvis backup
11/9–11/16, Mon 11/16 by Faraz's explicit decision ("not an inference"), so the ER-panel author's Burchett backup entries on 11/9, 11/14,
11/15, 11/16 are superseded (item 10); Khan takes 11/25 from Burchett **for 2026 only** — a locked one-off, not a rule, not part
of the Thanksgiving unit (still Thu 11/26 – Sun 11/29); the rest of the ER-panel author's November entries are imported as locks and both
November lists govern both roles.

**Notes recorded with the Prompt 12 small items (9/22):** Acton's October backup list (10/6, 10/8, 10/20) no longer governs
under the open-backup rule — his October entry is a plain (primary-only) governed month, so it only matters for an October
backfill; Sarkar may be backup on her window Fridays since 9/22 (her windows are her only hard rule; a Friday primary stands
alone). Also since 9/22 (small items): an explicit dated list is never waived on a holiday-unit day — Burchett cannot hold the
Christmas unit (12/24 is off his December list; 12/25, 12/31 and 1/1 are on it) and, his November list governing both roles,
he is not a Thanksgiving backup candidate either; Philip's listed weeks are an explicit dated list too (Mon 5/31 of the Memorial Day 2027
unit is outside them, so he cannot hold the Sat–Mon unit as primary; the list binds primary only, so his backup stays possible); only the recurring weekday patterns are waived on holidays (§5).

**Answered by Faraz on 9/23 (morning):** Burchett's December list governs **both roles** — his 9/17 email gives the dates as the
ones he can take primary call or backup — so the seed's December entry becomes an object entry naming both roles (§3, Burchett);
the three published December backups off his list (12/4, 12/10, 12/18) are reassigned by hand in the day editor, nothing is
regenerated (the December report - history, `docs/HISTORY.md`). Item 16 below: TRIM. **Also 9/23 (after
the November-backups report - history, `docs/HISTORY.md`): the water-filled share is adopted** — the open spec decision the 9/22 J review left
(§6): fixed days count against the share, never a locked floor, convex deviation, both roles; the published schedule is not
regenerated (the water-fill report - history, `docs/HISTORY.md`).

**Still open:**

1. **10/15 (Thu) primary** — the only open slot in the published schedule after the 9/23 publish (`docs/PUBLISH-2026-09-23.md`; 10/24 went to Khan in that publish, item 6); nobody's rules allow it. The group will discuss. Default: stays OPEN, shown on the Open shifts board; its backup is Burchett (locked by hand 9/23 08:38). (Imported unlocked; the generator lists it as uncovered with reasons.)
2. **Sarkar's home email** — none on record (goes into the private `silvis-contacts.md`, not here).
3. ~~Holiday unit days for 2027~~ — tiers confirmed and Monday minors absorb the weekend before (Sat–Mon), decided 9/22 evening; **decided 9/22 late (Prompt 12 AC): Thanksgiving is Thu–Sun every year (2027: 11/25–11/28) and July 4 uses its observed day (2027: Sunday → Monday 7/5, unit Sat 7/3 – Mon 7/5)**; Christmas and New Year's stay Eve + Day. Data in `holidays.units`, editable in Setup. Not yet decided: a Saturday July 4 (observed Friday; the builder default is the Friday alone; next in 2037).
4. ~~Khan as backup on ordinary Tue/Thu~~ — answered 9/22: backup is open to everyone.
5. **Philip's monthly cap** — none stated; the group default (8 primary) applies from November although his own October was 15 days. ⟶ B10 (9/23): and his **2027 weeks remain a rule** (`availableWeeks`, §3) for Jan 2027 (1/11, 1/25) and Feb–Apr 2027 until he paints them — he has no offer and no mode there, so he is *not started* and the list governs primary; ask him to paint (or set him `preferred`) before the freezes (Jan 2027: 11/23; Feb–Apr 2027: 12/21) rather than importing the weeks as `either` offers again (item 15's consequence).
6. ~~**Sat 10/24 primary** — open since Sarkar dropped to two days (Faraz 9/22 evening); who covers it (see §7 candidates).~~ ⟶ published 9/23: Khan primary, Fierce backup (generated, UNLOCKED — lock the row in the day editor if it should survive a re-Generate: the default range starts at the first open slot, 10/15, and covers 10/24).
7. **Sarkar's day count after her first window** — soft target 2 for now; tighten or raise `daysPerWindowWeek` in Setup → Rules once she has been here.
8. ~~Thanksgiving 11/26–29 for Khan~~ — **confirmed by Faraz 9/22 (evening)** (Prompt 12 Z): the item-B `awaitingConfirmation` flag and the "confirm" badge are cleared; the four rows stay locked (source `faraz-2026-09-21`). Wed 11/25 stays a separate locked one-off for Khan (2026 only), not part of the unit.
9. **Backup opt-outs** — the 9/22 rule says anyone may opt out of backup explicitly; nobody has. Ask the group once.
10. ~~11/9, 11/14, 11/15 backup~~ — decided 9/22 evening: **Fierce is backup 11/9–11/16** and **Khan is primary 11/25 (2026 only)**; Burchett's four backup days and his 11/25 are superseded (in the app; the ER-panel author's document is retired).
11. ~~**October's open backups + 10/24 primary** — fill by generator (fill-open-only over 10/15 – 11/1: `scripts/preview-generate.js --backfill`, Prompt 12 T) or by hand before publishing? The backfill section of the preview lists a candidate and the alternatives per open slot; Faraz decides. (The import has eleven open backups in that range, not eight — item 14.)~~ ⟶ answered 9/23: the fill-open-only backfill ran and was published (`docs/PUBLISH-2026-09-23.md`); four October backups were then re-locked to Burchett by hand 9/23 08:38 (10/9, 10/15, 10/20, 10/22 — the October report (history, `docs/HISTORY.md`)).
12. **Burchett 10/25** — in his own 9/17 plan but not in the ER-panel author's document; confirm it stands now that Sarkar is off 10/24. (Published 9/23: Burchett primary — an import lock — with Fierce backup, generated; the confirmation is of a published row.)
13. ~~Thu 11/5 primary~~ — resolved 9/22 evening: Acton's 9/17 message gave rules and preferences, never a date list
    (the November dates came through Burchett's relay), so his November list is preferences, the whitelist comes off,
    and his rules allow Thursday 11/5 (primary 11/4–11/6, within his max of three) with someone else as backup.
14. **10/16, 10/27, 10/29 backup** — ~~open in the import~~ published 9/23 by the backfill as Burchett, Acton, Khan (generated, unlocked). The ER-panel author's 9/16 document had Philip primary and no backup there, and the open-backup list of her 9/22 document (10/15, 10/21, 10/23, 10/24, 10/25, 10/30, 10/31, 11/1) does not name them. Still to confirm: does her 9/22 document carry a backup on those three days? If so, send it and it is imported as a lock, replacing the generated holder (a manual/import row beats a generated one).
15. **Tuesdays and Thursdays are the group's structural gap.** Three of six can never take them as primary (Khan: OR
    days; Fierce: Clinton; Burchett: outreach except the 1st Tuesday), so every Tue/Thu falls on Acton, Philip or
    Sarkar — and with Acton now off Tuesdays (hard, 9/22 evening), **Tuesdays fall on Philip and Sarkar alone** (plus
    Burchett's first Tuesday, and Khan on any Tuesday/Thursday he has no East OR block and enters himself); Thursdays
    on Acton, Philip, Sarkar and those Khan dates. In a month where Acton is held to his list
    (November) that meant Philip alone on 11/10, 11/12, 11/24. After Prompt 12 Y (his November list is preferences) the
    sole-candidate set is the Tuesdays **11/10 and 11/24** (Philip alone — `eligibility()` on the lock-only seed with the live
    East facts, 9/23); Thu 11/12 opened to Acton, and Fri 11/13 is Philip or Khan (Acton's max 3; Khan has no East call that
    week — §3, Acton), so 11/13 is not a sole-candidate day whatever an earlier draft of this item said. Either
    accept Philip carrying them (his own October was 15 days), or ask Acton and Burchett whether their lists are
    exhaustive or preferences, or write in an outside surgeon. ⟶ Faraz 9/22 evening: **treat lists as preferences
    unless the surgeon says "only these days"** — under Prompt 14 each surgeon picks that when submitting (default:
    preferred, rules fill gaps, and they are told which days). Ask Acton about November now ⟶ 9/23: 11/10 and 11/24 primary are published to Philip, so the question is now January onward / the Prompt 14 submissions, not November. The reminder email should
    say plainly that Tuesdays and Thursdays are the days the group most needs.
16. ~~**Personal reasons quoted in this public document — Faraz's call (raised by the 9/23 overnight review).**~~ **DECIDED 9/23: TRIM.**
    The public repo carries rules only, never reasons; the reasons live in Faraz's private notes file in the OneDrive folder
    (gitignored, never copied into `docs/` or the seed). Done 9/23: §3 Acton (the Tuesday and time-off lines) and Philip (10/15,
    the full-week line) carry the bare rule / dates; the seed's `surgeonRules.s3.timeOff[*].note`, `s4.timeOff[0].note` and
    `s3.holidayRules.neverThanksgivingNote` read "off (stated 9/17)" and `s4.notes[1]` "no more full weeks (stated 9/17)"
    (importer-dropped notes — `time_off` still gets "vacation (seed)"); the review and Prompt 12 records no longer quote the old
    note text. The OneDrive `docs/` copy follows the repo (repo → OneDrive).
17. **East vacations — how far out should an unreviewed range block him? (Prompt 15, 9/23).** An unreviewed Davenport
    vacation range is treated as *away* at **any** horizon (the prompt's conservative default: never schedule someone
    who may be out of town), while the coverage strip counts the unreviewed ranges until he decides. Davenport
    vacations reach a year ahead and Generate will offer 12-month presets, so a range he forgets to review would silently
    take him off every weekend in it. Should the hard block apply only inside the next **60 days** (the strip's
    open-slot window — its unreviewed count is not windowed, so the nag already reaches every horizon), with a soft
    penalty beyond that and the nag as today? If yes it is one data key in `groupRules.eastFeed` (e.g.
    `groupRules.eastFeed.vacations.unreviewedHardDays`) and a small rules change, not a code branch per surgeon — not built.
    Also still open from the same prompt (this item is the canonical list; guide §18.5 points here): whether `claim_open_slot`
    (`CL009`), `apply_trade`'s vacation check and the `time_off` trigger should read the feed + the reviews (today they read
    `time_off` rows only, so the derived vacation is enforced client-side only — extend `claim_open_slot` in a later migration,
    or accept client-side-only and say so to the group), and that a command-line generation (`scripts/preview-generate.js`,
    and `publish-preview.js` after it) passes no `eastVacationRanges` / `eastVacationReviews` inputs (`east_feed` is
    anon-readable; `east_vacation_reviews` needs a scheduler JWT or the service role server-side) — generate from the app
    while East vacations matter. His first action after the deploy: *Refresh from Davenport*, then **home** on
    the range over his Silvis Thanksgiving unit (the rest as he decides).
18. **Sarkar as backup inside her windows under the convex term (raised by the 9/23 WF review).** A candidate with no
    target for a role — the windows surgeon as backup (§6, item N: no backup target) — carries a zero deviation delta, so once
    every pool member stands at or above his backup share she becomes the preferred backup on a window day (the what-if hands
    her Fri 11/20). Legal since 9/22 (backup allowed inside her window; §3, Sarkar). Ask the group: should she take backup on
    her window days at all, and if not, should a no-target candidate carry a flat soft weight for that role? Either answer is
    data — her `backupOptOut` / a `groupRules` weight — never a name branch. Not changed for now.
19. **Philip's H2-2027 weeks (audit RG-7, 9/23).** His `availableWeeks` list ends with the week of 2027-06-28, so any Generate whose end passes 2027-07-04 has no Philip primary at all from 2027-07-05 on (today only the 12-month preset, ending 2027-09-30; after the milestone the 9- and 12-month presets) — ask him for his July–December 2027 weeks (and confirm the 6/7 tentative vacation) before such a run and enter them in Setup → Rules → Philip → availableWeeks (blob data; no seed change needed for the live app); the generator warns when a range outruns the list.
20. **Offer modes per surgeon for the first period (Nov 2026 – Jan 2027) — defaults set 9/23 (Prompt 14 P5/P6),
    confirm.** Burchett and Philip **exhaustive** (Burchett's November list was published by the ER-panel author as his days and his
    December list governs both roles since 9/23; Philip's listed weeks are a whitelist — item T), Acton and Fierce **preferred**
    (Acton's relayed November days are preferences — item 13; Fierce's single days are extras on his pattern), Khan
    and Sarkar **rules-only** (East feed; windows — her two days a week are a soft target, not offers). Data, not code:
    `docs/silvis-seed.json` `offerPeriods[0].offerModes` / `rulesOnly` → `call_periods.offer_modes` / `rules_only_ids`
    through `node scripts/import-seed.js --apply`; from the next wave each surgeon sets it in the painter (the seed's
    keys win on a re-import — `offer_modes = coalesce(call_periods.offer_modes, '{}') || excluded.offer_modes` — so
    app-set modes for others are kept, but **once a surgeon has set his own mode in the app, remove his key from
    `offerPeriods[0].offerModes` before the next seed apply, or the apply overwrites his choice**). Two consequences
    of the defaults to confirm:
    (a) under exhaustive a plain list is `either`, so Philip's weeks limit his **backup** to the listed days too
    (before the period the weeks whitelist governed primary only, backup open to everyone; Burchett's December list
    already governs both roles since 9/23 — the object entry — so nothing changes for him) — `rolePref: "primary"` on
    the `offerSources` tag, or `preferred`, restores the old reading; (b) Fierce has no dated day inside the period on record (10/12 is October; 11/9–11/16 are his derived
    week plus the 11/16 decision, locks), so he reads **not started** and is reminded on 9/29 unless he paints or
    Faraz relays days for him. **Time-coupled:** a changed answer lands as a seed re-import, which the database refuses
    for this period's offers from 2026-10-02 on (OF003) — settle before the close, or wait for the UI wave (no
    scheduler entry path exists before it: the CLI runs as postgres, so OF003 refuses it; the only pre-UI alternative
    is a scheduler-JWT REST write). The 10/2 deadline is the only safe answer window. ⟶ **9/23 afternoon (PD): moot for
    this period — its schedule is published and its row reads `published` (the modes above stayed the seed's; a regenerate
    over Nov–Jan would still read the 79 offers, status does not gate the engine). The next answer windows are
    Jan 2027 (1/4 – 1/31; freeze 11/23, publish by 12/7 — Faraz created it 9/24) and then Feb 2027 – Apr 2027 (2/1 – Sun 5/2
    since 9/24; freeze 12/21, publish by 1/4): neither row carries a rules-only list or modes (the preset's shape) — each
    surgeon chooses in the painter, or Faraz lists them in `offerPeriods[1]` / `offerPeriods[2]` before an apply.**
