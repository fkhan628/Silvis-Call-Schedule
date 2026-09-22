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
| Period | **This round: generate through the end of 2026** (range 2026-11-02 → 2027-01-03 so the New Year's weekend is covered). **After that, Generate offers 3-, 6-, 9- and 12-month presets** from the last published day. **Sep 14 – Nov 1 stays exactly as the emails describe it** (locked import, §7); the rules below generate from November onward. | Khan 9/21 |
| Time off | **Vacations only — there are no "no-call days."** Surgeons **enter their own vacations; nothing is approved** — the app logs them (audit trail) and blocks those days from call. A vacation **cannot be entered over a day the surgeon is already published as primary or backup**: the entry is refused, the conflicting dates are listed, and the surgeon must find a switch (trade) first. A vacation day also blocks the day before it (the 07:00 shift end falls on the vacation day). | Khan 9/21 |
| Shift accounting | **Each 24-hour day is one shift.** No half-days, no weighted burden, none of the Davenport split accounting. Primary and backup shifts are counted separately; weekend days and holidays are tracked as well. **Totals are a running yearly tally** (month, year-to-date, rolling 12 months). | Khan 9/21 |
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

Contact details for all six (and for the ER-panel author / administration) are in the private `silvis-contacts.md`.

**Outside surgeons (9/22):** Setup → Roster can add an *outside* surgeon (name + code, `type: "external"`, no account
needed). They appear only in the day editor under "Outside surgeons", never in the generator's pool, and in Totals under
their own heading. They must be written in by hand for each day they agree to cover.

**Atwell is not in the roster** (Faraz, 9/21). His legacy primary week 9/28–10/4 is imported as `externalCover: "Atwell"`
so those days render as covered rather than OPEN and count toward nobody's tallies. If that changes, Faraz will say so.

Other people: **the ER-panel author, RN, TNS** (Trauma & Pediatric Quality Coordinator, Silvis) maintains the official ER Call
Panels Word document — she gets a **read-only (viewer) account** plus the panel export, and is the one office contact
entered in Setup. **administration** (administration) relays Sarkar's availability; no account. **the COO** (COO)
decides the Trauma Director role.

## 3. Per-surgeon rules

### Khan (s1) — weekend primary when available, East-dependent
- ⟶ **9/22: main contribution = PRIMARY on weekends when available** (Fri+Sat+Sun as a block). He is not a backup filler: his backup count is balanced like everyone else's, and the generator should prefer him as weekend *primary* over weekend *backup* whenever East allows.
- **Mondays and Wednesdays are auto-offered as primary** whenever East is clear ("I'll have to figure it out on those days"). **Never Tuesday, never Thursday as primary** — those are his OR days (hard). ⟶ **9/22: backup on any day is fine, Tue/Thu included.** *(Supersedes the earlier "no Mon/Wed nights" statement and the "never Tue/Thu for both roles" reading.)*
- East feed: **primary** only on days he is **not on call at East (Davenport)**; **backup is allowed even on East call days**. ⟶ **9/22: cross-reference ALL of his Davenport call** — service weeks (Mon–Sat), weeknights, weekends, backup weeks, holiday coverage — from the Davenport app's `schedule_weeks` rows for the surgeon coded FAK, plus the forecast until Davenport publishes.
- Max consecutive **3** primary days (hard, real days). ⟶ **9/22 (Prompt 12 A): he is the one surgeon who opted in to count a holiday unit as one day** (`holidayUnitCountsAsOneDay`; his 4-day Thanksgiving unit vs his max 3); any-role soft limit **4** with the long-run penalty beyond it. No monthly target.
- **Thanksgiving 2026: Khan takes Thu 11/26 – Sun 11/29 as one unit, primary** (Faraz 9/21 evening; locked in the seed).
- **East forecast while Davenport is unpublished** (Faraz 9/21 evening): the Davenport schedule for the next period is not out until the end of 2026. Until it is, the East feed carries a forecast built by running the Davenport generator many times over the next period with the live Davenport inputs; days where Khan is on East call in ≥ 50 % of runs are treated as East-busy for Silvis primary (backup allowed), lower probabilities are a soft penalty, and such days show a “forecast” badge. When Davenport publishes, the real feed replaces the forecast and a conflict report lists any Silvis day needing a trade. Faraz can also enter his published Silvis days as Davenport constraints when he generates DSG.

### Burchett (s2) — recurring whitelist (primary) + weekends
- Typically available **for primary**: **2nd & 4th Monday** (unless in Jackson County), **1st Tuesday**, **2nd & 4th Wednesday**. Otherwise in DeWitt / Jackson County most days. ⟶ **9/22: backup on any day** (off-site is fine for standby).
- Weekends: available for **backup every weekend incl. Fridays** when not primary; takes primary weekends too.
- Weekend style: **split** with Acton — one takes Fri+Sun, the other Sat. (the ER-panel author's doc shows exactly this: 9/25 Burchett, 9/26 Acton, 9/27 Burchett.)
- **Max 2 consecutive 24-h primary periods.** **Monthly cap 7–8 primary days** ⟶ 9/22: backup days do not count toward it; prefers ≤7 in December.
- ⟶ **9/22 (Prompt 12 A): the 2-day limit is hard on real primary days** — 12/30, 12/31 and 1/1 are three days even though 12/31 + 1/1 is one holiday unit (no opt-in); any-role (primary or backup) soft limit **3**, a growing penalty beyond it.
- Christmas: prefers to **split it up** (every other day, or 2 on then off).
- October: available 10/6, 10/10, 10/11, 10/12 (backup only), 10/14, 10/26, 10/28. Not available 10/2–10/4, 10/18, 10/23, 10/24, 10/30, 10/31, 11/1. Takes 10/25 (Sun) with Sarkar on 10/24 (Sat).
- December (can take primary or backup): 12/1, 12/5, 12/6, 12/9, 12/12, 12/13, 12/14, 12/19, 12/20, 12/23, 12/25, 12/26, 12/27, 12/28, 12/30, 12/31, 1/1, 1/2, 1/3. "I don't need all these dates but am able to do them."
- ⟶ **9/22 evening (Burchett email): weekends in early 2027 he CANNOT work, either role:** **Sat 1/9–Sun 1/10, Sat 1/16–Sun 1/17,
  Fri 2/12–Sun 2/14, Fri 4/9–Sun 4/11.** Exactly as listed — the two January entries are Sat+Sun only, so Fri 1/8 and
  Fri 1/15 are not excluded. ⟶ **Faraz 9/22: "can essentially be considered vacations"** — entered as four `time_off`
  (vacation) ranges for s2, which blocks both roles and the day before each range for primary, exactly like any other
  vacation; source `burchett-email-2026-09-22`. Beyond the current milestone; recorded now for the next generate period.

### Acton (s3) — recurring blacklist (primary)
- **Unavailable for primary on the 2nd & 4th Monday and Wednesday** (outreach in Maquoketa). These align with Burchett's available days — the two are designed to complement each other. ⟶ **9/22: backup on those days is allowed.**
- Avoid (soft, medium): the **Sunday immediately before a 2nd/4th Monday** (morning carryover before Maquoketa; "may not be as much of an issue" with a true handoff).
- Avoid (soft, medium): **Tuesdays** — [removed].
- Time off: **Nov 19–22** ([removed]), **Nov 25–29** (Thanksgiving week). **Never on Thanksgiving.** Christmas or New Year's is fine; agrees with Burchett's alternating-days strategy.
- Weekend style: **split** with Burchett; has also taken full Fri–Sun (10/9–10/11), so max consecutive 3.
- ⟶ **9/22 (Prompt 12 A): max consecutive 3 primary days is hard on real days** (no holiday-unit opt-in); any-role soft limit **4**.
- October: primary Oct 5, 7, 9, 17, 18, 19, 21, 23; backup Oct 6, 8, 20. Offered to send a full monthly date list like Burchett.
- **No specific monthly cap** (Faraz 9/21); no target stated.

### Philip (s4) — whitelist of weeks (primary)
- In **Aledo the 1st and 3rd Wednesday** of each month **and the Friday of that 3rd week**; tries to avoid Silvis *primary* those whole weeks (strong soft). ⟶ **9/22: backup on any day, Aledo weeks included.**
- **Hard (primary):** not primary the **day before an Aledo day** (Tue before a 1st/3rd Wed; Thu before the 3rd-week Fri) — he leaves before 7 AM, i.e. before the shift ends, and would dump late non-emergent work on the next person.
- Weeks he could be primary or backup (week-of Monday): 11/9, 11/23, 12/7, 12/21, 12/28, 1/11, 1/25, 2/8, 2/22, 3/8, 3/22, 3/29, 4/12, 4/26, 5/10, 5/24, (6/7 tentative vacation), 6/21, 6/28. He does **not** want all of them.
- **No more than one major holiday** (Thanksgiving / Christmas / New Year). **Prefers not a full week at a time** ("call has been getting busier").
- Backup cap (stated for October, treat as monthly): **≤ 7 days and ≤ 1 weekend** of backup — an explicit backup cap, so it survives the 9/22 "backup doesn't count" rule. The group default primary cap (8) applies to his primary days.
- Weekend style: **block**; in practice Thu–Sun (10/29–11/1), so max consecutive 4.
- ⟶ **9/22 (Prompt 12 A): max consecutive 4 primary days is hard on real days**; any-role soft limit **4** with the long-run penalty — this is how "prefers not a full week" is implemented (review item E: 12/22 P, 12/24–25 B, 12/26–29 P is now penalised).
- October: **cannot 10/15** (personal — hard). Primary 10/8, 10/13, 10/16, 10/27, 10/29–11/1. Backup: not 10/15, 10/7, 10/21, 10/23.

### Fierce (s5) — derived East weeks + a weekday pattern the rest of the time
- Takes East call **one week at a time**, alternating between East primary weeks and East backup weeks.
- **East primary week → Silvis BACKUP every day, Mon–Sun.** **East backup week → Silvis PRIMARY every day, Mon–Sun, 24/7.** These are hard pre-assignments (locks) generated from the East feed, never rebalanced. (His own words: "week I am primary at East I cover backup Silvis; week primary at Silvis cover backup East.")
- Source of truth: Davenport `schedule_weeks` rows — `isBackup: true` = Fierce is East primary; `isFierceBackup: true` = Fierce is East backup. **Live-verified 9/21** (Davenport is published through the week of 11/9): East primary weeks **9/28** and **11/9**; East backup week **10/12**. (The Davenport config's `MAY_AUG_FIERCE_*` constants are stale — never use them.) The rule reproduces what the group already did by hand: the ER-panel author's doc has him as Silvis backup all of 9/28–10/4, and Burchett has him primary on 10/12.
- For October the rule is **not** applied retroactively — 10/12 is a single locked day (Faraz 9/21). From November on it is: Silvis **backup 11/9–11/15**. **Faraz 9/21 (evening): East primary week 11/9; East backup weeks 10/12 and 12/7** — so Silvis **primary 12/7–12/13**, entered as an East override until the Davenport rows exist.
- **Outside those weeks he is in the pool and can be primary**, under his weekday pattern (via Faraz, 9/21):

  | Day | Where he is | Silvis eligibility |
  |---|---|---|
  | Mon | East (Davenport) | **backup only** — he must be on site at Silvis when primary (Faraz 9/21) |
  | Tue | Clinton all day | no primary; ⟶ 9/22 backup OK |
  | Wed | Office Clinton/Silvis | **preferred** primary — "good day to be on call" |
  | Thu | Clinton all day | no primary; ⟶ 9/22 backup OK |
  | Fri | Clinton or Dubuque (rotates) | primary only as the start of a **Fri+Sat+Sun block** — never a standalone Friday; ⟶ 9/22 backup OK |
  | Sat / Sun | — | primary as part of his Fri+Sat+Sun block (Faraz 9/21: "his Sat/Sun will run with his Fri"); backup any day |

- **Cap: up to 14 primary call days per month**, counting Silvis primary days and his East primary week (from the feed) ⟶ 9/22: backup days (either site) do not count.
- He described an ideal of East week → following week Silvis → ~10 days with no call. **Not a rule** (Faraz 9/21): no penalty, no Davenport-side alignment; recorded only as his stated preference.
- Max consecutive 7 (his derived weeks). Weekend style **block** (Fri–Sun).
- ⟶ **9/22 (Prompt 12 A): 7 is hard on real primary days**; any-role soft limit **7**.

### Sarkar (s6) — monthly windows only
- Available **only** inside windows supplied by administration. ⟶ **9/22 evening (the clinic manager, after
  meeting Dr. Sarkar): the weeks are Oct 19–23, Nov 16–20, Dec 14–18, Jan 11–15 — Mon–Fri.** (Earlier, via administration
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
- ⟶ **9/22 (Prompt 12 A): max 2 consecutive primary days is hard on real days**; any-role soft limit **2**.

## 4. Weekend unit — how the styles combine

The generator treats Fri/Sat/Sun as one unit and chooses a pattern per weekend:

1. **Block** — one surgeon Fri+Sat+Sun (Khan, Philip, Fierce — for Fierce this is the *only* way he takes a Friday).
2. **Split** — one surgeon Fri+Sun, another Sat (Acton/Burchett pair; also valid for any two surgeons who both accept split). Keeps each under the 2-consecutive limit. Sarkar can only ever be the Saturday half.
3. **Daily** — three independent days; fallback only — except for Sarkar, for whom a standalone Friday or Saturday is the normal pattern (9/22).

Backup for the weekend is filled with the same unit logic after primary. A surgeon's `weekendStyle` is a preference; the hard constraints (availability, caps, max consecutive) always win.

## 5. Holidays — same set as Davenport, but as primary + backup units

Silvis uses the **same six holidays as the DSG app** (major: New Year's, Thanksgiving, Christmas; minor: Memorial Day,
July 4th, Labor Day), but the Davenport "surgeon A on the day, surgeon B the night before" convention does not carry
over. Instead each holiday is a **unit of one or more days with one primary and one backup who both stick through the
whole unit** (Faraz 9/21: "that person will probably stick through for each eve, day"). A holiday unit takes precedence
over any weekend unit it overlaps; the leftover weekend days form a reduced weekend unit.

Default day membership (Faraz's current guess — **editable per year in Setup**, open question #3):

| Holiday | Tier | 2026 unit days | Notes |
|---|---|---|---|
| Memorial Day | minor | Mon 5/25 (past) | 2027: Mon 5/31 |
| July 4th | minor | Sat 7/4 (past) | 2027: Sun 7/4 |
| Labor Day | minor | Mon 9/7 (past) | 2027: Mon 9/6 |
| Thanksgiving | major | **Thu 11/26 – Sun 11/29 (one unit; Khan primary — Faraz 9/21)** | Acton never (opted out); Philip ≤ 1 major; backup: anyone not opted out |
| Christmas | major | Thu 12/24 + Fri 12/25 | Eve + Day as one unit; Burchett available 12/25–28 |
| New Year's | major | Thu 12/31 + Fri 1/1/2027 | Eve + Day as one unit; Burchett available 12/30–1/3 |

**The day rules are not for holidays (Faraz 9/21 evening).** On a holiday-unit day the weekday-pattern rules do not apply — not Khan's Tue/Thu or Mon/Wed-only, not Burchett's recurring whitelist, not Acton's 2nd/4th Monday and Wednesday, not Fierce's Clinton days or Monday-backup-only, not Philip's Aledo weekday rules — for primary or backup. **Anyone can be backup (or primary) on a holiday unless they explicitly want that holiday off** (Acton: Thanksgiving). Still enforced on holidays: vacations, East call days and the East forecast, Fierce's derived-week locks, Sarkar's windows, monthly caps, and Philip's one-major-holiday limit. ⟶ 9/22 (Prompt 12 A): a holiday unit counts as one day for the consecutive limits **only for a surgeon who opted in** (`surgeonRules.<id>.holidayUnitCountsAsOneDay` — Khan); everyone else counts real days. Encoded as `groupRules.holidays` plus per-surgeon `holidayRules.holidaysOff` in the seed.

Burchett's stated Christmas preference ("2 days on then off") is satisfied by the two-day unit. Holiday fairness is
tracked separately from shift counts: major and minor counts per surgeon, lifetime, tenure-normalized — the same idea
as the Davenport holiday pools.

## 6. Fairness model (differs from Davenport) — ⟶ rewritten 9/22

**"We want everyone to be as equal as possible."** Fairness is measured on two separate counts per surgeon per month
(and rolling 12 months): **primary shifts** and **backup shifts**. The generator drives both spreads down across the
pool, within each person's availability:

- **Equal share by default.** Every active pool member (Khan, Burchett, Acton, Philip, Fierce) gets an implied target of
  an equal share of the month's primary slots and, separately, of its backup slots — after subtracting locked days
  (Fierce's derived weeks, imports) and Sarkar's own primaries. Nobody has a "neutral" or zero term; `monthlyTarget: null`
  means "equal share", not "no target".
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

## 7. Existing assignments to import (locks)

`silvis-seed.json → existingAssignments` holds every day from **2026-09-14 through 2026-11-01** exactly as the emails
describe it: the ER-panel author's 9/16 document plus the later email updates, already applied (49 days; the 7 Atwell-covered days
flagged `externalCover`; 16 open backup days). Import them as **locked** slots. The applied updates (logged in
`pendingDeltas` with `status: applied`):

- 10/12 primary → Fierce, **single day only** (Burchett 9/18); the full-week derivation rule applies from November.
- 10/23 primary → Acton (Burchett 9/18).
- 10/20, 10/22, 10/24 primary → Sarkar; 10/25 primary → Burchett (Burchett's 9/17 October plan). ⟶ 9/22 evening: **10/24 taken back off Sarkar** (two days a week, October included) — open primary.

**The only open primary day in the import is 10/15 (Thu)** — Philip cannot (hard), Burchett and Acton did not offer it,
Khan never takes Thursdays, and Fierce is in Clinton on Thursdays. It needs a human decision. Nothing is scheduled from
11/2 onward.

⟶ **9/22 evening — Sat 10/24 is now in question.** the clinic manager's email has Sarkar at **2 days** in the week of
**Oct 19–23 (Mon–Fri)**; the import carries her on 10/20, 10/22 **and Sat 10/24** (Burchett's 9/17 plan). If the new
statement stands, 10/24 comes off Sarkar and becomes a second open primary day in October (Burchett already holds
Sun 10/25 and said he cannot do 10/24; Acton's rules allow a Saturday). ⟶ **Faraz 9/22 evening: adjust her to two days
a week, October locks included — so Sarkar keeps 10/20 and 10/22 and comes OFF Sat 10/24.** 10/24 primary is now the
second open primary day of the import (locked-open like 10/15, listed with reasons; backup 10/24 was already open).
Candidates by the rules: Acton (a Saturday is allowed; he is primary Fri 10/23, so 10/24 would make 2 consecutive),
Khan (weekend primary if East is clear that day), Philip (his October list is the model — check it), or an outside
surgeon written in. Burchett said he cannot do 10/24.

## 8. Answered (9/21) and still open

**Answered by Faraz on 9/21:** shift boundary 07:00→07:00; October stays as the emails describe it (Fierce 10/12 single
day, Acton 10/23, Sarkar 10/20/22/24 — ⟶ 9/22 evening: 10/24 removed —, Burchett 10/25) and the rules generate from November; Sarkar 3–4 days per window
week, Saturday OK, never Fri/Sun, no target; Khan may be backup on East days, Mon/Wed are auto-offered, no cap; Fierce is
in the pool outside his derived weeks under his weekday pattern — Monday backup-only because primary must be on site,
weekends as Fri+Sat+Sun blocks, 14 call days/month cap, and his "10 days off" is a preference not a rule; Acton has no
specific cap; the ER-panel author gets a viewer account (administration none); no compensation in the app; no Atwell; no APPs.

**Scope decisions (Faraz 9/21):** dropped from Davenport — APP info/call/vacation, Fierce's separate backup weeks, no-call
days, the vacation approval workflow, split/weighted shift accounting, compensation. Kept — shift trades, stats with shift
counts and fairness, a running yearly tally. Carried over — office notifications, calendar sync, refresh, data management
and every safety feature. Holidays are the same DSG set, as primary + backup units.

**Answered by Faraz on 9/21 (evening, in chat with Claude Code):** Thanksgiving 2026 = Khan primary Thu 11/26 – Sun 11/29 as one unit; the day rules do not apply on holidays and anyone may be backup unless opted out; the Davenport schedule is not out until year end, so Silvis includes Khan and avoids his most likely East days via a forecast; Fierce East primary week 11/9, East backup weeks 10/12 and 12/7; port the bones and safety features, adjust whatever will not work for Silvis. The defaults taken for every remaining ambiguity (lock semantics for open slots, whitelist months, precedence, consecutive counting, caps, weights, Fierce cap arithmetic, Sarkar minimum, day-before rules primary-only) are listed in `docs/ORIENTATION-2026-09-21.md` §3 and written into `silvis-seed.json` (`groupRules.*`).

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

**Still open:**

1. **10/15 (Thu)** — the one open primary day in the locked October import; nobody's rules allow it. The group will discuss. (Imported unlocked; the generator lists it as uncovered with reasons.)
2. **Sarkar's home email** — none on record (goes into the private `silvis-contacts.md`, not here).
3. **Holiday unit days for 2027 and the minor holidays** — should a Monday holiday unit include the preceding weekend? (Christmas and New Year's stay Eve + Day.)
4. ~~Khan as backup on ordinary Tue/Thu~~ — answered 9/22: backup is open to everyone.
5. **Philip's monthly cap** — none stated; the group default (8 primary) applies from November although his own October was 15 days.
6. **Sat 10/24 primary** — open since Sarkar dropped to two days (Faraz 9/22 evening); who covers it (see §7 candidates).
7. **Sarkar's day count after her first window** — soft target 2 for now; tighten or raise `daysPerWindowWeek` in Setup → Rules once she has been here.
6. **Thanksgiving 11/26–29 for Khan** — recorded by Claude Code as confirmed in an evening chat; the daytime record said pending. Re-confirm before publishing (Prompt 12 B).
7. **Backup opt-outs** — the 9/22 rule says anyone may opt out of backup explicitly; nobody has. Ask the group once.
