# Silvis Surgical Care — Call Schedule Rules & Availability

*Compiled 2026-09-21 from the group's email threads (Aug 27 – Sep 20, 2026), the ER-panel author's ER Call Panels
Word document (9/14–12/13/26 version dated 9/16), Fierce's rules relayed by Faraz, and Faraz Khan's in-session
answers (9/21). This is "the bones" the generator must honor. The machine-readable twin is `silvis-seed.json` —
when the two disagree, fix both.*

---

## 1. The call model

| Item | Rule | Source |
|---|---|---|
| Unit of call | **One calendar day = one 24-hour shift, 07:00 → 07:00 next day** (confirmed) | Khan 9/21 |
| Roles per day | **Primary** (must be physically in Silvis — applies to everyone, Fierce included) + **Backup** (standby) | Burchett 9/18, Khan 9/12, 9/21 |
| Weekdays (Mon–Thu) | Primary + backup, one surgeon each, 24 h at a time | Khan 9/21 |
| Weekend (Fri–Sun) | Handled as a **weekend unit** whose shape depends on the surgeon (see §3, §4) | Khan 9/21, Burchett 9/10 |
| Handoff | Service hands off every morning; whoever operated/consulted on a patient hands them to the next day's primary. The weekend surgeon covers everyone Fri–Sun. Only the primary must be in Silvis; everyone else can be off-site. | Khan 9/9, Burchett 9/10 |
| Fill order | **Fill every primary day first (top priority), then backup.** | Burchett 9/17, 9/18 |
| Backup contract | Backup should never be called if the primary stays true to the location. (Stipend transfer on activation is a group/admin matter — **the app carries no compensation logic or $ display at all.**) | Burchett 9/18, Khan 9/21 |
| Practice hygiene | No operating at another facility while on Silvis primary. 30-minute response time. | Khan 8/29, Burchett 8/27 |
| Consecutive days | Default max **2 consecutive 24-h periods**; per-surgeon overrides below (weekend blocks are 3; Fierce weeks are 7). | Burchett 8/27, Khan 8/29 |
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

**Atwell is not in the roster** (Faraz, 9/21). His legacy primary week 9/28–10/4 is imported as `externalCover: "Atwell"`
so those days render as covered rather than OPEN and count toward nobody's tallies. If that changes, Faraz will say so.

Other people: **the ER-panel author, RN, TNS** (Trauma & Pediatric Quality Coordinator, Silvis) maintains the official ER Call
Panels Word document — she gets a **read-only (viewer) account** plus the panel export, and is the one office contact
entered in Setup. **administration** (administration) relays Sarkar's availability; no account. **the COO** (COO)
decides the Trauma Director role.

## 3. Per-surgeon rules

### Khan (s1) — weekends first, East-dependent
- **Main contribution = weekends** (Fri+Sat+Sun as a block). He is in the weekend pool by default.
- **Mondays and Wednesdays are auto-offered** whenever East is clear ("I'll have to figure it out on those days"). **Never Tuesday, never Thursday** — those are his OR days (hard). *(Stated 9/21; supersedes the earlier "no Mon/Wed nights" statement.)*
- East feed: **primary** only on days he is **not on call at East (Davenport)**; **backup is allowed even on East call days**. Source of truth: the Davenport app's `schedule_weeks` rows for the surgeon coded FAK.
- Max consecutive 3 (a holiday unit counts as one commitment). No monthly target.
- **Thanksgiving 2026: Khan takes Thu 11/26 – Sun 11/29 as one unit, primary** (Faraz 9/21 evening; locked in the seed).
- **East forecast while Davenport is unpublished** (Faraz 9/21 evening): the Davenport schedule for the next period is not out until the end of 2026. Until it is, the East feed carries a forecast built by running the Davenport generator many times over the next period with the live Davenport inputs; days where Khan is on East call in ≥ 50 % of runs are treated as East-busy for Silvis primary (backup allowed), lower probabilities are a soft penalty, and such days show a “forecast” badge. When Davenport publishes, the real feed replaces the forecast and a conflict report lists any Silvis day needing a trade. Faraz can also enter his published Silvis days as Davenport constraints when he generates DSG.

### Burchett (s2) — recurring whitelist + weekends
- Typically available: **2nd & 4th Monday** (unless in Jackson County), **1st Tuesday**, **2nd & 4th Wednesday**. Otherwise in DeWitt / Jackson County most days.
- Weekends: available for **backup every weekend incl. Fridays** when not primary; takes primary weekends too.
- Weekend style: **split** with Acton — one takes Fri+Sun, the other Sat. (the ER-panel author's doc shows exactly this: 9/25 Burchett, 9/26 Acton, 9/27 Burchett.)
- **Max 2 consecutive 24-h periods.** **Monthly cap 7–8 days total (primary + backup)**; prefers ≤7 in December.
- Christmas: prefers to **split it up** (every other day, or 2 on then off).
- October: available 10/6, 10/10, 10/11, 10/12 (backup only), 10/14, 10/26, 10/28. Not available 10/2–10/4, 10/18, 10/23, 10/24, 10/30, 10/31, 11/1. Takes 10/25 (Sun) with Sarkar on 10/24 (Sat).
- December (can take primary or backup): 12/1, 12/5, 12/6, 12/9, 12/12, 12/13, 12/14, 12/19, 12/20, 12/23, 12/25, 12/26, 12/27, 12/28, 12/30, 12/31, 1/1, 1/2, 1/3. "I don't need all these dates but am able to do them."

### Acton (s3) — recurring blacklist
- **Unavailable 2nd & 4th Monday and Wednesday** (outreach in Maquoketa). These align with Burchett's available days — the two are designed to complement each other.
- Avoid (soft, medium): the **Sunday immediately before a 2nd/4th Monday** (morning carryover before Maquoketa; "may not be as much of an issue" with a true handoff).
- Avoid (soft, medium): **Tuesdays** — [removed].
- Time off: **Nov 19–22** ([removed]), **Nov 25–29** (Thanksgiving week). **Never on Thanksgiving.** Christmas or New Year's is fine; agrees with Burchett's alternating-days strategy.
- Weekend style: **split** with Burchett; has also taken full Fri–Sun (10/9–10/11), so max consecutive 3.
- October: primary Oct 5, 7, 9, 17, 18, 19, 21, 23; backup Oct 6, 8, 20. Offered to send a full monthly date list like Burchett.
- **No specific monthly cap** (Faraz 9/21); no target stated.

### Philip (s4) — whitelist of weeks
- In **Aledo the 1st and 3rd Wednesday** of each month **and the Friday of that 3rd week**; tries to avoid Silvis call those whole weeks (strong soft).
- **Hard:** not on call the **day before an Aledo day** (Tue before a 1st/3rd Wed; Thu before the 3rd-week Fri) — he leaves before 7 AM, i.e. before the shift ends, and would dump late non-emergent work on the next person.
- Weeks he could be primary or backup (week-of Monday): 11/9, 11/23, 12/7, 12/21, 12/28, 1/11, 1/25, 2/8, 2/22, 3/8, 3/22, 3/29, 4/12, 4/26, 5/10, 5/24, (6/7 tentative vacation), 6/21, 6/28. He does **not** want all of them.
- **No more than one major holiday** (Thanksgiving / Christmas / New Year). **Prefers not a full week at a time** ("call has been getting busier").
- Backup cap (stated for October, treat as monthly): **≤ 7 days and ≤ 1 weekend** of backup.
- Weekend style: **block**; in practice Thu–Sun (10/29–11/1), so max consecutive 4.
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
  | Tue | Clinton all day | none |
  | Wed | Office Clinton/Silvis | **preferred** — "good day to be on call" |
  | Thu | Clinton all day | none |
  | Fri | Clinton or Dubuque (rotates) | only as the start of a **Fri+Sat+Sun block** — never a standalone Friday |
  | Sat / Sun | — | as part of his Fri+Sat+Sun block (Faraz 9/21: "his Sat/Sun will run with his Fri") |

- **Cap: up to 14 call days per month**, counting Silvis primary + backup and his East week days (from the feed).
- He described an ideal of East week → following week Silvis → ~10 days with no call. **Not a rule** (Faraz 9/21): no penalty, no Davenport-side alignment; recorded only as his stated preference.
- Max consecutive 7 (his derived weeks). Weekend style **block** (Fri–Sun).

### Sarkar (s6) — monthly windows only
- Available **only** inside windows supplied by administration: **Oct 19–24, Nov 16–21, Dec 14–18, Jan 11–16** (Mon–Sat; Dec is Mon–Fri).
- **3–4 days per window week.** **Saturday is fine; never Friday or Sunday** (no Fri–Sun block for her). Max consecutive 2.
- **No target.** Must always have a handoff partner the next morning. Burchett's October plan (Tue/Thu/Sat with handoff partners, Burchett taking the Sunday) is the model.

## 4. Weekend unit — how the styles combine

The generator treats Fri/Sat/Sun as one unit and chooses a pattern per weekend:

1. **Block** — one surgeon Fri+Sat+Sun (Khan, Philip, Fierce — for Fierce this is the *only* way he takes a Friday).
2. **Split** — one surgeon Fri+Sun, another Sat (Acton/Burchett pair; also valid for any two surgeons who both accept split). Keeps each under the 2-consecutive limit. Sarkar can only ever be the Saturday half.
3. **Daily** — three independent days; fallback only.

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

**The day rules are not for holidays (Faraz 9/21 evening).** On a holiday-unit day the weekday-pattern rules do not apply — not Khan's Tue/Thu or Mon/Wed-only, not Burchett's recurring whitelist, not Acton's 2nd/4th Monday and Wednesday, not Fierce's Clinton days or Monday-backup-only, not Philip's Aledo weekday rules — for primary or backup. **Anyone can be backup (or primary) on a holiday unless they explicitly want that holiday off** (Acton: Thanksgiving). Still enforced on holidays: vacations, East call days and the East forecast, Fierce's derived-week locks, Sarkar's windows, monthly caps, and Philip's one-major-holiday limit. A holiday unit counts as one commitment for max-consecutive purposes. Encoded as `groupRules.holidays` plus per-surgeon `holidayRules.holidaysOff` in the seed.

Burchett's stated Christmas preference ("2 days on then off") is satisfied by the two-day unit. Holiday fairness is
tracked separately from shift counts: major and minor counts per surgeon, lifetime, tenure-normalized — the same idea
as the Davenport holiday pools.

## 6. Fairness model (differs from Davenport)

Silvis is **not** an equal-share group. Each surgeon carries a configurable **monthly target** and **caps** rather than
an equal split:

- Pool members (Burchett, Acton, Philip, and Fierce outside his derived weeks) are balanced toward their targets, subject to caps and hard availability. Khan has no target (weekends by default, Mon/Wed when East is clear). Sarkar has no target (her window, 3–4 days a week).
- Fierce's derived weeks and Sarkar's windows are fixed-availability inputs, not fairness levers.
- Metrics to track per surgeon — by month, year-to-date and rolling 12 months: primary shifts, backup shifts, weekend days, major/minor holidays, max consecutive days, and each vs. target/cap. One 24-hour day = one shift; nothing is weighted or split. **No compensation, stipend or $ figures anywhere in the app.**
- The objective when generating: (1) zero uncovered primary days, (2) zero uncovered backup days, (3) zero hard-rule violations, (4) minimize weighted soft-rule penalties, (5) minimize deviation from monthly targets, (6) balance weekends and holidays.

## 7. Existing assignments to import (locks)

`silvis-seed.json → existingAssignments` holds every day from **2026-09-14 through 2026-11-01** exactly as the emails
describe it: the ER-panel author's 9/16 document plus the later email updates, already applied (49 days; the 7 Atwell-covered days
flagged `externalCover`; 16 open backup days). Import them as **locked** slots. The applied updates (logged in
`pendingDeltas` with `status: applied`):

- 10/12 primary → Fierce, **single day only** (Burchett 9/18); the full-week derivation rule applies from November.
- 10/23 primary → Acton (Burchett 9/18).
- 10/20, 10/22, 10/24 primary → Sarkar; 10/25 primary → Burchett (Burchett's 9/17 October plan).

**The only open primary day in the import is 10/15 (Thu)** — Philip cannot (hard), Burchett and Acton did not offer it,
Khan never takes Thursdays, and Fierce is in Clinton on Thursdays. It needs a human decision. Nothing is scheduled from
11/2 onward.

## 8. Answered (9/21) and still open

**Answered by Faraz on 9/21:** shift boundary 07:00→07:00; October stays as the emails describe it (Fierce 10/12 single
day, Acton 10/23, Sarkar 10/20/22/24, Burchett 10/25) and the rules generate from November; Sarkar 3–4 days per window
week, Saturday OK, never Fri/Sun, no target; Khan may be backup on East days, Mon/Wed are auto-offered, no cap; Fierce is
in the pool outside his derived weeks under his weekday pattern — Monday backup-only because primary must be on site,
weekends as Fri+Sat+Sun blocks, 14 call days/month cap, and his "10 days off" is a preference not a rule; Acton has no
specific cap; the ER-panel author gets a viewer account (administration none); no compensation in the app; no Atwell; no APPs.

**Scope decisions (Faraz 9/21):** dropped from Davenport — APP info/call/vacation, Fierce's separate backup weeks, no-call
days, the vacation approval workflow, split/weighted shift accounting, compensation. Kept — shift trades, stats with shift
counts and fairness, a running yearly tally. Carried over — office notifications, calendar sync, refresh, data management
and every safety feature. Holidays are the same DSG set, as primary + backup units.

**Answered by Faraz on 9/21 (evening, in chat with Claude Code):** Thanksgiving 2026 = Khan primary Thu 11/26 – Sun 11/29 as one unit; the day rules do not apply on holidays and anyone may be backup unless opted out; the Davenport schedule is not out until year end, so Silvis includes Khan and avoids his most likely East days via a forecast; Fierce East primary week 11/9, East backup weeks 10/12 and 12/7; port the bones and safety features, adjust whatever will not work for Silvis. The defaults taken for every remaining ambiguity (lock semantics for open slots, whitelist months, precedence, consecutive counting, caps, weights, Fierce cap arithmetic, Sarkar minimum, day-before rules primary-only) are listed in `docs/ORIENTATION-2026-09-21.md` §3 and written into `silvis-seed.json` (`groupRules.*`).

**Still open:**

1. **10/15 (Thu)** — the one open primary day in the locked October import; nobody's rules allow it. The group will discuss. (Imported unlocked; the generator lists it as uncovered with reasons.)
2. **Sarkar's home email** — none on record (goes into the private `silvis-contacts.md`, not here).
3. **Holiday unit days for 2027 and the minor holidays** — should a Monday holiday unit include the preceding weekend? (Christmas and New Year's stay Eve + Day.)
4. **Khan as backup on ordinary Tue/Thu** — currently blocked for both roles; allowing backup is the cheapest lever if Thursday backups come up short.
5. **Philip's monthly cap** — none stated; the group default (8 total) applies from November although his own October was 15 days.
