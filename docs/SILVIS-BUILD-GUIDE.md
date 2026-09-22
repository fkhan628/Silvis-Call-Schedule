# Silvis Surgical Care Call Schedule — Build Guide for Claude Code

*Read this first, then `SILVIS-CALL-RULES.md` (the rules), then `silvis-seed.json` (the data). The prompt
sequence in `CLAUDE-CODE-PROMPTS.md` walks through the build phase by phase; `CLAUDE.md` is the file that goes
in the new repo's root so Claude Code reads it automatically.*

---

## 0. What we are building, in one paragraph

A React PWA (no bundler — single `index-source.html` JSX block transpiled by `build.js`, plus plain-JS modules)
that generates and publishes the daily **primary + backup** trauma/acute-care call schedule for the six-surgeon
Silvis Surgical Care group at MercyOne Genesis Medical Center – Silvis. It is a **sibling of the Davenport app**
(`github.com/fkhan628/Call-Schedule-App`, live at `fkhan628.github.io/Call-Schedule-App`): same stack, same
build/CI pipeline, same data-safety architecture, same Supabase-REST client, same auth, same exports — but a
**different shift model** (one 24-hour day at a time instead of a weekly service-week rotation), a **different
fairness model** (per-surgeon targets and caps instead of equal shares), and a **rules engine** that expresses each
surgeon's individual availability pattern. Faraz Khan (FAK) is the scheduler, admin and sole developer; he is
also one of the six surgeons and is on the Davenport rotation too, so the app reads the Davenport schedule as
a feed.

## 1. Decisions already made (do not re-open)

| Decision | Value |
|---|---|
| Backend | **New, separate Supabase project from day one**: `https://bzhsroegtagqhutbnsrp.supabase.co` (ref `bzhsroegtagqhutbnsrp`). Anon (publishable) key to be pasted into `config.js` by Faraz. The service-role key never enters the repo or client. |
| Hosting | New public GitHub repo (suggested name `Silvis-Call-Schedule`) under `fkhan628`, GitHub Pages from `main`, same `build.yml` CI as Davenport (bump version → transpile → commit `index.html` back with `[skip ci]`). |
| Features | **Keep from Davenport:** generator + calendar views + locks; vacations + holidays; shift trades; stats (shift counts + fairness, running yearly tally); exports (.ics, shareable read-only HTML, printable, the ER-panel author's panel); auth + roles; **office notifications; calendar sync; refresh / client-version check; data management (backup, restore, export, import, snapshots); every safety feature; audit log; in-app notifications + email.** **Drop:** APP roster/shifts/vacations; Fierce's separate backup weeks; no-call days; the vacation approval workflow + deadline reminders; half-day / weighted shift accounting; anything to do with compensation (no $ display, no stipend math); the Davenport holiday A/B convention. OneSignal push is not requested (optional later). |
| Shift model | Daily 24-h primary + backup, 07:00→07:00 (confirmed). Weekend handled as a unit (block / split / daily). Holidays are units (same six as Davenport) with one primary + one backup sticking through the unit. **One 24-h day = one shift** — no partial or weighted shifts. |
| Fairness | Targets + caps per surgeon (see rules §6), not equal shares. |
| Reuse | Clone the Davenport repo as the starting point; copy the shell and data layer; rewrite the generator. |
| Roster | Six surgeons: Khan, Burchett, Acton, Philip, Fierce, Sarkar. **No Atwell** (his 9/28–10/4 week is imported as `externalCover`). Contact emails are **home** addresses, never MercyOne/MercyHealth. |
| **First milestone** | **A published schedule through 2026-12-31.** Generation range 2026-11-02 → 2027-01-03 (covers the New Year's weekend) on top of the locked Sep 14–Nov 1 import. After this round, Generate offers **3 / 6 / 9 / 12-month presets** from the last published day. Everything in phases 0–6 serves the milestone; exports, edge functions and hardening follow. |

## 2. Repo layout and the reuse map

Start by cloning `fkhan628/Call-Schedule-App` into the new repo directory, then apply this map.

```
Silvis-Call-Schedule/
├── index-source.html      ADAPT   — the app (one <script type="text/babel"> block). Keep the shell; retarget every shift-model-specific piece.
├── config.js              ADAPT   — Supabase URL/key, DB client, safeguards, auth, constants. Replace roster/shift constants; keep the client & auth verbatim.
├── generator.js           REWRITE — new daily constraint model (§6).
├── rules.js               NEW     — pure availability/eligibility engine (§5). No DOM, no React, fully unit-testable.
├── east-feed.js           NEW     — Davenport read-only feed (§7). Pure fetch + parse.
├── helpers.js             ADAPT   — keep date utils, ICS, download, printable; retarget ICS/label builders to day+role.
├── app-styles.js          COPY    — palette/theme; rebrand colors if desired.
├── build.js               COPY    — byte-for-byte (mojibake gate, babel gates). Do not weaken any gate.
├── bump-version.js        COPY
├── package.json           COPY    — rename to silvis-call-schedule-build.
├── .github/workflows/     COPY    — build.yml + ci-owned-files-gate.yml; add `node test/generator-regression.js` and `node test/rules.test.js` before the build step.
├── manifest.json, icons   ADAPT   — "Silvis Call", new icon (a different color than Davenport so users can tell the two PWAs apart on a phone).
├── test/
│   ├── rules.test.js            NEW — recurring-pattern + eligibility unit tests (Node, no deps).
│   └── generator-regression.js  REWRITE — independent re-statement of every hard rule in SILVIS-CALL-RULES.md.
├── sql/schema.sql         NEW     — full schema + RLS for the Silvis Supabase project (§4).
├── docs/                  NEW     — SILVIS-CALL-RULES.md, silvis-seed.json, this guide.
├── CLAUDE.md              NEW     — from the provided file.
└── index.html             CI-OWNED — never hand-edit (build output).
```

**Drop entirely:** APP shifts (`app_shifts_data`, `INIT_APPS`, MonthPainterSheet APP modes, APP badges, APP day-off, APP
vacations), `backupMondaySet`/`fierceBackupSet` and every "Fierce Primary / Fierce Backup week" concept (replaced by the
daily backup role and the derived Fierce weeks), **no-call days** (`kind === "nocall"` branches, the separate
`vacationsOnly` map), the **vacation request/approval workflow** (`vacation_requests`, pending/approved/denied states,
`VACATION_DEADLINE_WEEKS_BEFORE`, the vacation-deadline reminder), `MIN_AVAILABLE_SURGEONS` request gating, the AI
file-scanner remnants, OneSignal SDK tags and `OneSignalSDKWorker.js`, all weighting/billing schemes (SW×6 / 7-1-3 / etc.),
`SHIFT_LABELS/SHIFT_TIMES/NIGHT_KEYS/ALL_SHIFT_KEYS`, and the holiday surgeon-A/surgeon-B convention.

**Carry over intact (retargeted to day + role):** the office-notifications flow (`office_contacts`, the digest/change
emails), calendar sync (per-surgeon ICS subscription feed via the `calendar-sync` edge function), the refresh mechanism
(`client_versions` min-version check + reload, `reloadTrigger` second pass), Settings → Data management (JSON backup /
restore, export, import, snapshots list + restore, factory reset behind the wipe guards), and every safety feature in §4.4.

**Keep verbatim (config.js):** `dbHeaders`, `dbAuthHeaders()`, `jwtIsFresh()`, `dbReadHeaders()`, the minimal
`supabase` wrapper, `db.*`, `payloadLooksWiped` (retarget its fields), `snapshots.capture/restore`, `auth`, `dbAuth`,
`biometric`. Change every localStorage key prefix from `dsg-` to `silvis-` so both PWAs can live in one browser.

## 3. Identity model

Roster entries are `{ id, name, code, fullName, email, active, roles }`. `id` = `s1`…`s6`; `name` is the
**last name** (what people read on the calendar); `code` is a 3-letter chip for narrow cells. **The schedule stores ids.**
Davenport's ids are a different namespace (FAK is `s6` there, `s1` here) — the East feed maps by code (`FAK`).
`email` is the surgeon's **home** address (gmail/yahoo), never a work address.

| id | name | code | home email | pool |
|---|---|---|---|---|
| s1 | Khan | FAK | *(home email — private)* | weekends; Mon/Wed auto-offered when East is clear; never Tue/Thu; East blocks primary only |
| s2 | Burchett | MAB | *(home email — private)* | yes |
| s3 | Acton | BDA | *(home email — private)* | yes |
| s4 | Philip | AFP | *(home email — private)* | yes |
| s5 | Fierce | NF | *(home email — private)* | derived weeks (locks) + weekday pattern outside them; cap 14/month |
| s6 | Sarkar | SRK | TBD | monthly windows only; 3–4 days/week; Sat OK, never Fri/Sun |

There is deliberately **no Atwell entry**. A `DayAssignment` may carry `externalCover: "Atwell"` (primary `null`) for
the imported 9/28–10/4 week; the UI renders the label instead of OPEN and tallies ignore it.

`user_profiles.person_id` links an auth user to a roster id; roles are `admin`, `scheduler`, `surgeon`, `viewer`
(the ER-panel author is the one `viewer`; administration has no account).

## 4. Data model (Supabase)

### 4.1 In-memory schedule shape

```js
// schedule: { "YYYY-MM-DD": DayAssignment }
// DayAssignment: { primary: id|null, backup: id|null,
//                  primaryLocked: bool, backupLocked: bool,
//                  source: "import"|"generated"|"manual"|"east-derived"|"trade",
//                  externalCover: string|null,   // e.g. "Atwell" — covered by someone outside the roster; not OPEN, not tallied
//                  note: string|null }
```
Everything keyed by ISO date. Weeks are a *view* (Mon–Sun rows), never the storage key.

### 4.2 Tables

Paste `sql/schema.sql` into the Supabase SQL editor once. Summary:

| Table | Purpose | Mirrors Davenport |
|---|---|---|
| `call_schedule_data` (`id text pk = 'main'`, `data jsonb`, `updated_at`, `updated_by`) | Roster + `surgeonRules` + `groupRules` + holidays + settings blob | yes (same name) |
| `schedule_days` (`day date pk`, `primary_id`, `backup_id`, `primary_locked`, `backup_locked`, `source`, `external_cover`, `note`, `version int`, `updated_by`, `updated_at`) | One row per day. Publish = upsert changed days with compare-and-swap on `version`. | replaces `schedule_weeks` |
| `time_off` (`id uuid`, `person_id`, `start_date`, `end_date`, `note`, `created_by`, `created_at`) | **Vacations only** (no `kind` column — there are no no-call days). Self-entered by surgeons, no approval; a DB trigger refuses a range that overlaps a published day where that surgeon is primary or backup (see schema). Generator source. | adapted |
| `availability` (`id uuid`, `person_id`, `kind: available\|unavailable\|avoid\|prefer\|backup_only\|no_backup`, `role: any\|primary\|backup`, `start_date`, `end_date`, `note`, `source`, `created_by`, `created_at`) | Dated availability statements (Sarkar windows, Burchett December list, Philip weeks, Acton October days…). Recurring patterns live in the config blob, not here. | new |
| `east_feed` (`week_monday date pk`, `data jsonb`, `fetched_at`) + `east_overrides` (`day date pk`, `person_id`, `busy bool`, `note`) | Cached Davenport weeks and manual corrections | new |
| `shift_trade_requests` (`from_id`, `to_id`, `day`, `role`, `return_day`, `return_role`, `status`, …) | trades by day+role instead of week+shift | adapted |
| `notifications`, `notification_preferences`, `audit_log`, `call_schedule_snapshots`, `client_versions`, `office_contacts`, `user_profiles` | same roles as Davenport (`office_contacts` drives office notifications; `client_versions` drives refresh; `call_schedule_snapshots` drives data management) | yes |

Holiday units and their primary/backup assignments live in the config blob (`call_schedule_data.data.holidays`), like
Davenport's `holidayAssignments`, keyed by year.

### 4.3 RLS posture (report-first before any change to a live DB)

- **Anon-readable:** `schedule_days`, `call_schedule_data`, `time_off`, `availability`, `east_feed`, `client_versions` — required for the shareable page and the future `calendar-sync` function (which sends no auth header). Nothing sensitive lives in these tables.
- **Authenticated write, role-gated:** all writes require a JWT; `schedule_days`, `call_schedule_data`, `availability`, `east_*`, `office_contacts`, `call_schedule_snapshots` writable only by `scheduler`/`admin` (checked via a `security definer` function `silvis_role()` that reads `user_profiles` for `auth.uid()`); `time_off` insertable/deletable by the surgeon named in the row (own vacations, self-service) and by scheduler/admin; `shift_trade_requests` insertable by the surgeon named in the row, updatable by scheduler/admin (and by the counter-party for accept/decline); `notifications` insert by any authenticated user, read by all authenticated; `user_profiles` read by all authenticated, self-update of display fields only, role changes admin-only; `audit_log` insert by authenticated, read by scheduler/admin.
- Remember the Davenport lesson: **an RLS-blocked read returns HTTP 200 + `[]`** — the client must treat "empty" and "failed" differently (`db.query` throws on non-2xx; keep that).

### 4.4 Data-loss safeguards (copy, don't reinvent)

`payloadLooksWiped` (retarget to: no `schedule_days` rows would be written AND no vacations AND no availability),
one-shot `intentionalScheduleWipeRef`, snapshot-before-destructive (capture failure **blocks** the action), scheduler
restore UI in Settings, once-per-session snapshot if newest > 6 h. The two Davenport wipe incidents happened because
LOAD is permissive and AUTOSAVE is unconditional — keep the same guards.

## 5. Rules engine (`rules.js`) — pure functions

```js
// Evaluate a recurring pattern against a date
matchesPattern(dateStr, { weekday:"Mon", nth:[2,4] })              // 2nd & 4th Monday of the month
matchesPattern(dateStr, { weekday:"Fri", nthWeekOfMonth:3 })       // Friday of the 3rd week (the week containing the 3rd Wednesday)
matchesPattern(dateStr, { weekday:"Sun", beforeNthMonday:[2,4] })  // the Sunday immediately before a 2nd/4th Monday

// Eligibility — the single chokepoint every assignment and every rebalancing move passes through
eligibility(ctx, dateStr, role, surgeonId) → { ok: bool, hard: [reasons], soft: [{reason, weight}] }
```

`ctx` bundles: roster, `surgeonRules`, `groupRules`, timeOff map, availability rows, East feed (busy-day set for
Khan, derived Fierce weeks), holidays, the schedule so far (for consecutive-day and monthly-cap checks), and tallies.

Hard blocks (any → `ok:false`): inactive on that date; `time_off` covering the day (vacation — blocks the day itself
*and the day before*, because the shift ends 07:00 on the vacation day; there are no no-call days); `availabilityMode` semantics violated (whitelist: any
`available` row for that surgeon in that month makes uncovered days ineligible; `unavailable` rows always block;
`backup_only` blocks primary; `no_backup` blocks backup); recurring `recurringUnavailable`; `hardNeverWeekdays`
(Khan: Tue/Thu; Sarkar: Fri/Sun); Khan **primary** on an East busy day (backup is allowed — `eastBlocksBackup:false`);
Philip's day-before-Aledo; Fierce's weekday pattern outside his derived weeks (Tue/Thu none; Mon backup-only; Wed preferred;
Fri/Sat/Sun only as one Fri+Sat+Sun block); Sarkar outside her windows or beyond `daysPerWindowWeek.max`; already
holds the other role that day; would exceed `maxConsecutiveDays` (primary-only count by default,
`groupRules.countBackupInConsecutive` toggles); would exceed `monthlyCap.total`; Philip's `backupCap`.

Soft penalties (weights configurable in `groupRules.weights`): `recurringAvoid` / `avoid` rows (medium), Philip on an
Aledo week (strong), `prefer` rows (negative), weekend-style mismatch (block-style surgeon on a lone Sat, etc.), holiday
preferences (`neverThanksgiving` is hard; `maxMajorHolidays` hard once reached; alternating-days preference soft),
back-to-back weekends, backup on the day right after a primary day (mild), distance from monthly target.

Every rule must be expressible in `call_schedule_data.data.surgeonRules` and editable in Setup — no surgeon-specific
`if (name === "Philip")` in code. Fierce's derivation and Khan's East dependency are generic features
(`eastFeed.enabled` + `eastBlocksPrimary` / `eastBlocksBackup` + a `derivedFrom` spec), so a future surgeon who splits
sites can reuse them. Fierce's `monthlyCap.countsEastDays` adds his East week days (7 per derived week) to his monthly total.

## 6. Generator (`generator.js`)

**Entry:** `generate(ctx, startDate, endDate, opts) → { schedule, diagnostics }`, deterministic per seed, randomized
across runs, wrapped in **best-of-N** (N = 200 default; days × surgeons is tiny so this is cheap). The UI passes the
range from a preset: **this round = through 2026-12-31 (2026-11-02 → 2027-01-03)**; afterwards **3 / 6 / 9 / 12 months
from the last published day**. Any range works; the presets are conveniences.

**Pipeline for one candidate:**
1. **Seed locks** — existing locked days, manual locks, Fierce derived weeks (both roles as applicable), imported assignments. Locks are never moved.
2. **Build units** — each holiday (from `config.holidays.units[year]`) is a *holiday unit*: its days get **one primary and one backup who stick through the whole unit**; a holiday unit pre-empts any weekend unit it overlaps, and the leftover Fri/Sat/Sun days form a reduced weekend unit. Each remaining Fri/Sat/Sun triple is a *weekend unit*; every other day is a *day unit*. Holiday units are scored against the holiday pools (major/minor counts, tenure-normalized) and per-surgeon holiday rules (`neverThanksgiving`, `maxMajorHolidays`).
3. **Primary pass** — order units by constraint tightness (fewest eligible candidates first; weekend units generally first). For each unit enumerate legal patterns: day unit → each eligible surgeon; weekend unit → `block(x)`, `split(x,y)`, `daily(x,y,z)` per §4 of the rules. Score = Σ soft penalties + target-deviation term + pattern penalty (`daily` is expensive; `split` cheap for split-style pairs; `block` cheap for block-style surgeons) + small jitter. Pick the min. If a unit has **no** legal pattern, leave it open and record `diagnostics.uncovered` with the blocking reasons per surgeon (the UI shows this — never silently skip).
4. **Backup pass** — same as 3 with primary fixed; backup ≠ primary; caps count primary+backup.
5. **Repair pass** — for each open slot, try 1-hop and 2-hop swaps that free an eligible surgeon (mirrors Davenport's Phase-1B chain swaps) while keeping every move inside `eligibility()`.
6. **Target smoothing** — while any pool surgeon is above target and another below, move a *non-locked* day from high→low if eligibility holds and the soft score does not worsen beyond `weights.smoothingTolerance`.

**Candidate score (lexicographic, lower is better):**
`uncoveredPrimary ×1e9 + uncoveredBackup ×1e7 + hardViolations ×1e6 (should be 0 by construction) + Σsoft ×1e3 + Σ|actual−target| ×100 + weekendSpread ×10 + holidaySpread`.

**Diagnostics** returned with every run: per-surgeon tallies (primary, backup, weekend days, holidays, consecutive max,
month totals vs cap/target), a list of open slots with reasons, the soft penalties incurred (so Faraz can see *why*
Acton got a Tuesday), and the East-feed snapshot used.

**Cross-boundary seeding:** when generating November with October already published, the generator must see the
last 7 published days (consecutive-day and back-to-back-weekend checks) and the month-to-date tallies of any
partially generated month.

## 7. East feed (`east-feed.js`) — read-only integration with the Davenport app

The Davenport project's `schedule_weeks` table is anon-readable — **verified 2026-09-21** with a plain GET using the anon key from the public repo's `config.js` (rows published through the week of 2026-11-09 at that time).
Fetch: `GET {DAV_URL}/rest/v1/schedule_weeks?select=week_monday,data&week_monday=gte.{from}&week_monday=lte.{to}`
with `apikey`/`Authorization: Bearer {DAV_ANON}`. Never write to it.

Week row `data` shape (Davenport `generator.js` line ~825):
`{ dayCall, nights: { mon, tue, wed, thu, wknd }, off, isBackup, isFierceBackup, holidayCoverage: { date: { surgeonId, … } } | null }`
where ids are Davenport ids (FAK = `s6`). Resolve FAK by matching the Davenport roster code, not by hard-coding `s6`.

Derivations (pure functions, unit-tested):
- **Khan busy days:** `dayCall === FAK` → Mon…Sat busy (service week; Sat 07:00→Sun 07:00 is his); `nights.mon/tue/wed/thu === FAK` → that day busy; `nights.wknd === FAK` → Fri and Sun busy (Sat 07:00–Sun 07:00 is not his, but a lone Silvis Saturday breaks his block style — allow only as fallback); `holidayCoverage[d].surgeonId === FAK` → `d` busy. Busy days block Silvis **primary only** — Khan may be Silvis **backup** on an East call day (Faraz 9/21). East backup weeks (`isBackup` true) count as busy for primary too.
- **Fierce derived weeks:** `isBackup` → Silvis **backup** Mon–Sun; `isFierceBackup` → Silvis **primary** Mon–Sun.
- Cache each fetched week into `east_feed`; the generator reads the cache, never the network. Setup shows "East feed: fetched 2026-09-21 14:02, 26 weeks, next Fierce primary week 2026-12-07" plus a manual override list (`east_overrides`) for days Faraz knows differ. If the fetch fails, keep the cache and warn — never treat failure as "no East call".

## 8. UI (index-source.html) — what changes

Views: `calendar` (month grid + week-rows list), `myschedule`, `setup`, `totals`, `timeoff` (vacations + trades), `settings`.
Keep Davenport's auth gate, toasts, dark mode, Collapsible, publish dialog, snapshot/restore, audit view, share/print/ICS
buttons, the notification center, the refresh/version banner, and Settings → Data management exactly as they are.

- **Month grid cell:** two lines — `P Burchett` / `B Acton` — colored per surgeon; open slot = red "OPEN" (the ER-panel author's convention); weekend units get a subtle bracket; locked slots show a padlock; East-derived (Fierce) slots show a small "E".
- **Week rows list:** the same rows as the ER-panel author's Word document (MON/SUN DATES | PRIMARY | BACKUP) with ranges collapsed (`9/15–9/18 Philip`) — this is also the export format (§9).
- **Day editor** (click a cell): set primary/backup from a dropdown that shows eligibility — eligible names first, ineligible greyed with the reason; lock toggle; note.
- **Setup:** roster; **Rules** editor per surgeon (availability mode, recurring patterns with a live "next 8 matching dates" preview, weekend style + partner, max consecutive, monthly cap/target, holiday rules, East feed toggle); **Availability** entry (dated rows by kind, plus quick paste of a date list like Burchett's); vacations (scheduler view of everyone's, with override entry); **Holidays** editor — per year, each unit's days (editable) and its primary + backup, with the major/minor fairness counts beside each name; East feed panel; **Generate** with range presets — *Through end of year* (this round) and *3 / 6 / 9 / 12 months from the last published day* — plus N, "respect locks", preview → publish with diff; import from `silvis-seed.json`; office contacts.
- **Totals:** per surgeon by month, year-to-date and rolling 12 months: primary shifts, backup shifts, weekend days, major/minor holidays, max consecutive, each vs target/cap; fairness view (deviation from target). One 24-h day = one shift, nothing weighted. **No stipend, pay or $ figures anywhere** (Faraz 9/21).
- **Time off & trades:** a surgeon enters a vacation range for themselves — no approval; the entry is refused if any day in the range has them published as primary or backup (the conflicting dates are listed with a "propose a trade" shortcut), otherwise it is saved, logged to `audit_log`, and those days are blocked from call. Scheduler can enter for anyone and override. Trades by day+role with eligibility checked for the recipient; an accepted trade is applied to the schedule with an audit entry and notifications (scheduler can revert).

## 9. Exports

- **.ics** — per surgeon (`silvis-call-<name>.ics`) and full group; events `Silvis Primary Call` / `Silvis Backup Call`, 07:00 → 07:00 next day, `America/Chicago`. Reuse `helpers.js` `generateICS/downloadICS`; replace `buildICSEvents`.
- **Shareable read-only HTML** — same mechanism as Davenport (self-contained page, Outfit font), month grid + week rows.
- **Printable month** — reuse `buildPrintableCalendarHTML` with the new cell content.
- **ER Call Panels export for the ER-panel author** — an HTML table in her exact layout (MON/SUN DATES | TRAUMA & CARDIOTHORACIC SURGERY TRAUMA | TRAUMA BACKUP; one row per Mon–Sun week; entries `M/D Name`, consecutive same-surgeon days collapsed `M/D–M/D Name`; open days in red) with a **Copy for Word** button (writes `text/html` to the clipboard so it pastes as a table). Stretch: true `.docx` via the `docx` UMD build from cdnjs.

## 10. Notifications, office notifications, calendar sync, refresh, data management

All of these are **in scope and carried over from Davenport** (Faraz 9/21):

- **In-app notifications** (`notifications` + per-user `notification_preferences`) — same center, same categories minus vacation approvals: schedule published, manual edit affecting you, trade proposed/accepted/declined/applied, vacation logged, shift reminder.
- **Email** via the `send-notification` edge function pattern (per-user email prefs).
- **Office notifications** — `office_contacts` (the ER-panel author first) receive the schedule-change digest / publish notice through the `office-notifications` edge function pattern, retargeted to day + role.
- **Calendar sync** — the `calendar-sync` edge function serves a per-surgeon ICS feed URL (`?surgeon=<CODE>`), matched on `code`, reading `schedule_days`; `verify_jwt` must stay OFF (clients send no auth header) — verify with an unauthenticated GET → 200 + `BEGIN:VCALENDAR`. Subscription instructions in Settings.
- **Shift reminders** — the `daily-reminder` edge function pattern (reminder hour per user, Central time).
- **Refresh** — `client_versions` min-version check with the reload banner, plus the `reloadTrigger` second-pass load.
- **Data management** — Settings → JSON backup/restore, export, import, snapshots list + one-click restore, factory reset behind the wipe guards.

Edge-function sources are **not in the Davenport repo**: Faraz will copy them from his OneDrive
`...\Genesis\Schedules\Call Schedule App\edge-functions\` folder into `...\Silvis Call Schedule\edge-functions\` for
Claude Code to retarget. Deploy convention is the same as Davenport (Supabase CLI, `--no-verify-jwt`, back up the
deployed source before overwriting, byte-diff after). OneSignal push is not requested.

## 11. Build & deploy (identical to Davenport — follow its CLAUDE.md rules)

- Edit only `index-source.html` and the plain-JS modules. `index.html` and `APP_VERSION` are CI-owned.
- Before every push: `node test/rules.test.js && node test/generator-regression.js && node build.js`; all gates green; `git restore index.html` before committing.
- Repo secrets: none needed (Pages + `GITHUB_TOKEN`). The Supabase anon key is public by design; the service-role key is never committed.
- Pages URL once live: `https://fkhan628.github.io/Silvis-Call-Schedule/`.
- One push to `main` is a live deploy — branch + PR for anything touching destructive paths, sync/state, RLS, or many call sites.

## 12. Testing

`test/generator-regression.js` must **re-state every hard rule independently** (no shared code with `rules.js` beyond
date helpers), generate 50 seeds × 3 ranges (Oct 2026 with imports; Nov–Dec 2026; Jan–Mar 2027) from
`docs/silvis-seed.json` + a synthetic East feed, and assert:

1. Every day in range has a primary and a backup, **or** appears in `diagnostics.uncovered` with reasons (never both, never neither).
2. `primary !== backup` on every day.
3. Locks (imports, manual, Fierce derived) are byte-identical in the output.
4. No assignment on a `time_off` day or on the day before a vacation day.
5. Khan: never Tue/Thu; never **primary** on an East busy day (backup on an East day is legal).
6. Acton: never 2nd/4th Mon or Wed; never 2026-11-19..22 or 11-25..29; never Thanksgiving.
7. Burchett: primary only on whitelist days (recurring or explicit `available`); ≤ 2 consecutive primary days; ≤ 8 total days per month. Acton and Khan have no cap (a `monthlyCap: null` must not fall back to the group default).
8. Philip: never the day before an Aledo day; never 2026-10-15; backup ≤ 7 days and ≤ 1 weekend per month; ≤ 1 major holiday.
9. Fierce: his derived weeks appear whole, with the correct role, as locks; outside them never Tue/Thu, never primary on Mon, a Friday only as the start of a Fri+Sat+Sun block; Silvis days + East week days ≤ 14 per month.
10. Sarkar: only inside her windows; never Fri/Sun; ≤ 4 days per window week; ≤ 2 consecutive.
11. Weekend units: block-style surgeons never hold a lone Fri/Sat/Sun unless the unit is flagged `fallback:true` in diagnostics.
12. Best-of-N returns the candidate with the minimum score; determinism: same seed → same output.
13. Holiday units: every unit in range has one primary and one backup for all its days (same surgeon throughout), the unit pre-empts the overlapping weekend unit, `neverThanksgiving` and `maxMajorHolidays` hold.
14. Time off: a `time_off` row overlapping a published on-call day for that surgeon is refused (DB trigger test via curl or SQL, not just the client check).

`test/rules.test.js` covers `matchesPattern` (nth weekday, week-of-month, Sunday-before-nth-Monday, month edges),
whitelist vs blacklist semantics, trailing-edge vacation logic, East-feed derivations.

CI runs both before the build, exactly like Davenport's workflow runs its regression harness.

## 13. Guardrails carried over from the Davenport CLAUDE.md (non-negotiable)

- ONE task at a time; report-first and wait for approval on anything destructive, sync/state, or RLS.
- Show every edit and command before running; verify by **observing** (a passing test, a real row, a green CI run) — silent failures are this codebase family's signature bug class (empty catch blocks, RLS-empty reads, HTTP errors returned as data).
- Never put the service-role key in client code or a URL. Never hand-edit `index.html`.
- Snapshot before destructive writes; capture failure blocks the action.
- Keep `docs/` in sync: when a rule changes in Setup, update `SILVIS-CALL-RULES.md` and the regression test in the same PR.

## 14. Phases and definition of done

| Phase | Deliverable | Done when |
|---|---|---|
| 0 Scaffold | Repo from Davenport clone, rebranded, builds, CI green, empty app loads against the Silvis Supabase | Pages serves the shell; login works |
| 1 Schema | `sql/schema.sql` applied; RLS verified with anon + user JWT curl checks | anon can read `schedule_days`; anon write is 401/403; scheduler write succeeds |
| 2 Rules engine | `rules.js` + `rules.test.js` | all pattern/eligibility tests pass |
| 3 Generator | `generator.js` + regression harness; Setup → Generate → Preview | 50×3 runs: zero hard violations, uncovered slots explained |
| 4 Import | `silvis-seed.json` loader → roster, rules, availability, locks Sep 14–Nov 1 | calendar matches the ER-panel author's doc exactly (Atwell week shows as external cover) |
| 5 East feed | fetch, cache, derive Khan busy days + Fierce weeks, Setup panel + overrides | Fierce weeks appear as locks; Khan's East days grey out |
| 6 UI | calendar/week rows/day editor/totals/requests/trades retargeted | Faraz can hand-edit any day, publish with diff, restore a snapshot — **and publishes Nov 2 → Dec 31 (Jan 3)** |
| 7 Exports | ICS, share page, print, the ER-panel author's panel copy | the ER-panel author pastes the table into Word with no cleanup |
| 8 Edge functions | calendar-sync, office-notifications, send-notification (email), daily-reminder — ported from the Davenport copies and retargeted to `schedule_days` | unauthenticated GET → `BEGIN:VCALENDAR`; a real office email received; a real reminder received |
| 9 Hardening | audit log everywhere, refresh banner, data management verified end-to-end (backup → wipe → restore), mobile pass | 6 surgeons + the ER-panel author onboarded |
