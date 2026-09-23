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
| Fairness | An **equal share per role** — of the open primary slots and, separately, of the open backup slots — for every pool member, with per-surgeon caps and explicit targets on top (rules §6; Prompt 12 J, 9/22, §15). |
| Reuse | Clone the Davenport repo as the starting point; copy the shell and data layer; rewrite the generator. |
| Roster | Six surgeons: Khan, Burchett, Acton, Philip, Fierce, Sarkar. **No Atwell** (his 9/28–10/4 week is imported as `externalCover`). |
| **Contact data** | **None in the repo, the seed, the docs, the schema, `config.js`, or any anon-readable table.** It lives only in the private `silvis-contacts.md` (OneDrive, gitignored) and, once users exist, in `user_profiles` (via Supabase Auth) and `office_contacts` (entered in Setup) — both authenticated-read only. See §3.1. |
| **First milestone** | **A published schedule through 2026-12-31.** Generation range 2026-11-02 → 2027-01-03 (covers the New Year's weekend) on top of the locked Sep 14–Nov 1 import. After this round, Generate offers **3 / 6 / 9 / 12-month presets** from the last published day ⟶ **9/22 late (Prompt 12 AB): from the first open slot on or after today** (locks are never touched; on the 9/22 rows that is 10/07, the first open October backup — §6, §15). Everything in phases 0–6 serves the milestone; exports, edge functions and hardening follow. |

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

Roster entries are `{ id, name, code, fullName, active, roles }` — **no `email` field**. `id` = `s1`…`s6`; `name` is
the **last name** (what people read on the calendar); `code` is a 3-letter chip for narrow cells. **The schedule stores
ids.** Davenport's ids are a different namespace (FAK is `s6` there, `s1` here) — the East feed maps by code (`FAK`).

| id | name | code | pool |
|---|---|---|---|
| s1 | Khan | FAK | weekend primary when East allows (`primaryContribution: "weekends"`, 9/22); Mon/Wed auto-offered when East is clear; never Tue/Thu as primary (backup any day since 9/22); East blocks primary only |
| s2 | Burchett | MAB | yes |
| s3 | Acton | BDA | yes |
| s4 | Philip | AFP | yes |
| s5 | Fierce | NF | derived weeks (locks) + weekday pattern outside them; cap 14/month |
| s6 | Sarkar | SRK | monthly windows only (Mon–Fri, 9/22 evening); soft target 2 primary days per window week, alternate days preferred; a window Friday may stand alone, never a Fri–Sun block; backup inside her windows allowed, not targeted |

### 3.1 Contact data policy (Faraz 9/21 — established by the Prompt 0A redaction)

- **Never in a tracked file**: not in `docs/`, `sql/`, `config.js`, tests, fixtures or commit messages. The repo is public.
- **Never in an anon-readable table**: `call_schedule_data` (the roster/config blob), `schedule_days`, `time_off`,
  `availability`, `east_feed`, `east_overrides` (its operational note included), `east_forecast` and `client_versions` — the
  eight tables listed under §4.3 — are readable with the public anon key, so anything in them is as public
  as the repo. The roster in the blob carries names and codes only.
- **Where it lives**: the private `silvis-contacts.md` in the OneDrive folder (listed in `.gitignore`), which Faraz uses
  to invite users; `user_profiles.email` (populated by Supabase Auth at signup, authenticated-read only); and
  `office_contacts` (entered by hand in Setup, authenticated-read only). Server-side email sending reads
  `user_profiles` / `office_contacts` with the service-role key inside edge functions.
- **Onboarding flow**: Faraz invites each surgeon from the Supabase dashboard (Auth → Users → Invite) using the private
  file; the surgeon sets a password through the emailed link; the app creates their `user_profiles` row as `viewer`;
  Faraz assigns `person_id` + role in Setup → Users. No email ever passes through the client except the one the user
  types at login.
- **Notes are public too**: `note` columns in anon-readable tables and every string in the blob carry **no reasons at
  all — not even a category token** (Faraz 9/22 late: "one standard for the blob: no reasons, only the rule"); a table
  note is operational status at most ("unavailable (stated 9/22)", "vacation (seed)", "Khan covers 11/25, 2026 only").
  Reasons live in `docs/SILVIS-CALL-RULES.md`. The importer enforces this for the blob (next bullet); table notes are
  checked at entry.
- **Rule notes are dropped by the importer, never classified (Prompt 12 F, then AA on 9/22 late)**: the seed keeps
  its prose, the blob never gets it in any form. `importer.js` (`impScrubRuleNotes`) removes every note-like key in
  `surgeonRules`, `groupRules` and `holidays` — `note`, `notes[]`, any `*Note`, `*Notes` or `*Reason`, at any depth,
  arrays included — before `call_schedule_data` is assembled; the blob's `timeOff` entries carry dates only. There is
  no keyword table, no category token and no `NOTE_UNCLASSIFIED` refusal any more (item F's `outreach` / `family` /
  `personal` / `OR day` / `preference` tokens were themselves reasons; `s1.hardNeverWeekdaysReason` left the seed with
  them — its wording sits in `s1.hardNeverWeekdaysNote` and in the rules doc §3). A denylist gate then scans every
  string in the assembled blob (family/families, wife, husband, kid(s), child(ren), daughter, son, parents, in-laws,
  school, medical, maternity, hosts/hosting, illness, funeral as whole words) and refuses on any hit
  (`NOTE_DENYLIST: <path> ("<word>")`), no string exempt; the order is pinned — the scrub runs first, so a note-like
  key can never trip the gate, and a reason smuggled under a non-note key is caught only when it uses a listed word
  (the denylist is a word list, not a classifier). `node scripts/import-seed.js --dry-run` prints the inventory
  (`<path> -> drop`, one line per note-like key) so the scrub is visible before anything is written; refusal messages
  name paths, never the note text. Nothing in the app parses notes, so the scrub changes no rule. `time_off` public
  notes (`public: true`, item S) are not blob keys: they are written as stated when they pass the same denylist and
  name no roster surname, and the tests assert that none of the seed's carries a reason word. The standard covers
  non-note keys too (AA review): a stated wish under a plain prose key belongs in a `*Note` key, not the blob —
  `s5.statedPreferenceNotARule` became `statedPreferenceNotARuleNote` and the Burchett sentence of `groupRules.holidayPolicy`
  moved to `groupRules.holidayPolicyNote` (both dropped; a test walks every string of the blob). One prose field remains by
  design pending Faraz's ruling: Fierce's `weekdayPattern.<day>.where` ("Clinton all day", "East (Davenport)"…), which Setup →
  Rules shows as the *Where* column and no engine code reads — if a location counts as a reason it becomes `whereNote` and
  the column is retired (rules doc §3 Fierce). Two entry paths in the app still bypass the gate (follow-ups): Setup's
  "Edit as JSON" editors, and the pattern-row note input in Setup → Rules (`PatternListEditor`, placeholder "operational
  note (public)", used by recurringAvailable / recurringUnavailable / recurringAvoid / clinic days) — a note typed there
  autosaves into `call_schedule_data` verbatim, unchecked, and the next seed import silently drops it; gate it with
  `SU_NOTE_DENYLIST` or remove the field. Until then the importer is the only enforcement of the standard.

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
| `call_schedule_data` (`id text pk = 'main'`, `data jsonb`, `updated_at`, `updated_by`) | Roster (names/codes only — **no contact data**) + `surgeonRules` + `groupRules` + holidays + settings blob. Anon-readable. | yes (same name) |
| `schedule_days` (`day date pk`, `primary_id`, `backup_id`, `primary_locked`, `backup_locked`, `source`, `external_cover`, `note`, `version int`, `updated_by`, `updated_at`) | One row per day. Publish = upsert changed days with compare-and-swap on `version`. | replaces `schedule_weeks` |
| `time_off` (`id uuid`, `person_id`, `start_date`, `end_date`, `note`, `created_by`, `created_at`) | **Vacations only** (no `kind` column — there are no no-call days). Self-entered by surgeons, no approval; a DB trigger refuses a range that overlaps a published day where that surgeon is primary or backup (see schema). Generator source. | adapted |
| `availability` (`id uuid`, `person_id`, `kind: available\|unavailable\|avoid\|prefer\|backup_only\|no_backup`, `role: any\|primary\|backup`, `start_date`, `end_date`, `note`, `source`, `created_by`, `created_at`) | Dated availability statements (Sarkar windows, Burchett December list, Philip weeks, Acton October days…). Recurring patterns live in the config blob, not here. | new |
| `east_feed` (`week_monday date pk`, `data jsonb`, `fetched_at`) + `east_overrides` (`day date pk`, `person_id`, `busy bool`, `note`) + `east_forecast` (`week_monday date pk`, `data jsonb`, `generated_at`) | Cached *published* Davenport weeks, manual corrections, and the separate East forecast (§7) | new |
| `east_vacation_reviews` (`id uuid pk`, `person_id`, `"start" date`, `"end" date`, `decision: away\|home`, `decided_at`, `decided_by`; `unique (person_id, "start", "end")`) | The **away / home** decision per mirrored Davenport vacation range (§18). The ranges themselves stay in the `east_feed` payload `data.vacations`, and no `time_off` row is ever written for them. **Authenticated-read only — not in the anon list.** Applied live 2026-09-23 04:37 (orchestrator, linked CLI) from `sql/migrations/2026-09-23-east-vacation-reviews.sql` (schema revision d); the observed strings are in `docs/SCHEMA-REVIEW.md`. | new |
| `shift_trade_requests` (`from_id`, `to_id`, `day`, `role`, `return_day`, `return_role`, `status`, …) | trades by day+role instead of week+shift | adapted |
| `notifications`, `notification_preferences`, `audit_log`, `call_schedule_snapshots`, `client_versions`, `office_contacts`, `user_profiles` | same roles as Davenport (`office_contacts` drives office notifications; `client_versions` drives refresh; `call_schedule_snapshots` drives data management) | yes |

Holiday units and their primary/backup assignments live in the config blob (`call_schedule_data.data.holidays`), like
Davenport's `holidayAssignments`, keyed by year.

### 4.3 RLS posture (report-first before any change to a live DB)

- **Anon-readable:** `schedule_days`, `call_schedule_data`, `time_off`, `availability`, `east_feed`, `east_overrides` (day, roster id, busy flag, an operational note), `east_forecast` (week flags + busy probabilities) and `client_versions` (anon reads the `main` row only) — required for the shareable page and the `calendar-sync` function (which sends no auth header). **Therefore nothing sensitive may live in them** — no contact data, no personal notes (§3.1).
- **Authenticated write, role-gated:** all writes require a JWT; `schedule_days`, `call_schedule_data`, `availability`, `east_*`, `office_contacts`, `call_schedule_snapshots` writable only by `scheduler`/`admin` (checked via a `security definer` function `silvis_role()` that reads `user_profiles` for `auth.uid()`); `time_off` insertable/deletable by the surgeon named in the row (own vacations, self-service) and by scheduler/admin; `shift_trade_requests` insertable by the surgeon named in the row, updatable by scheduler/admin (and by the counter-party for accept/decline); `notifications` insert by any authenticated user, read by all authenticated; `user_profiles` read by all authenticated, self-update of display fields only, role changes admin-only; `audit_log` insert by authenticated, read by scheduler/admin; `east_vacation_reviews` (§18, applied 2026-09-23) read by all authenticated only — **no anon policy** (a decision says where a surgeon is on a given day; an anon read is the silent `200 + []`) — and inserted / updated / deleted by the surgeon named in the row or by scheduler/admin.
- Remember the Davenport lesson: **an RLS-blocked read returns HTTP 200 + `[]`** — the client must treat "empty" and "failed" differently (`db.query` throws on non-2xx; keep that).

### 4.4 Data-loss safeguards (copy, don't reinvent)

`payloadLooksWiped` (retarget to: no `schedule_days` rows would be written AND no vacations AND no availability),
one-shot `intentionalScheduleWipeRef`, snapshot-before-destructive (capture failure **blocks** the action), scheduler
restore UI in Settings, once-per-session snapshot if newest > 6 h. The two Davenport wipe incidents happened because
LOAD is permissive and AUTOSAVE is unconditional — keep the same guards.

**Seed re-import over a published schedule — the CLI and the app agree: app-edited days are kept (IB, 9/23 overnight).**
A plan day whose live `schedule_days` row the app owns (`source` not `import`, or `updated_by` not `seed` — the shape of
the 31 October/November days the server-side publish updated) and that differs from the seed is never overwritten by
either path. Setup → Import → Apply skips it (`helpers.suSeedDayMerge`, reported as "kept (app-edited)") and applies
the rest; `scripts/import-seed.js --apply` now does the same instead of refusing: `planDiff` lists the day as BLOCKED and
returns it in `blockedDays`, `importSql(plan, { excludeDays })` emits **no statement** for it (neither the insert/update
VALUES nor the stale delete's key list — and the row is app-owned, so that delete's ownership clause could not reach it
anyway), the blob / availability / time_off parts apply, the report prints the blocked list plus `kept N app-edited
day(s)`, and the post-apply verify accepts a fresh plan reading `Total changes: 0 (+N blocked)`. `--strict-blocked`
restores the old fail-closed refusal (exit 3, nothing written). Without this a published schedule froze every
blob-only seed change (observed 9/23: `Total changes: 3 (+32 blocked)` could not land). Pinned in `test/importer.test.js`
(IB block: synthetic app-owned days, the SQL string, the exit-code decision, the verify). Three edges (IB review):
**(1)** the two paths read one shape differently — a row with `source 'import'` and a **NULL** `updated_by` is
seed-owned to the CLI (`planDiff` and the SQL guard `coalesce(updated_by, 'seed')`) but app-edited to the app's Apply
(`suSeedDayMerge` reads NULL as not `seed`); pre-existing, left as is because aligning it changes which live rows a
re-import may touch (report-first item); none of the 31 published rows has a NULL `updated_by`. **(2)** kept days keep
their live (generated) holders, so a seed vacation that overlaps a kept day's holder is refused by the `time_off`
`ON_CALL_CONFLICT` trigger and rolls the **whole** import back (one transaction, exit 1, nothing written) — trade or
edit that day in the app first. **(3)** when *every* plan day is app-owned, the SQL emits no stale delete at all (an
empty key list is not valid SQL; an unlisted delete would be wipe-shaped) and `planDiff` reports the stale seed-owned
days as KEPT, so the dry run never promises a delete the SQL cannot carry.

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
*and, for primary only, the day before*, because the shift ends 07:00 on the vacation day — `groupRules.dayBeforeRules`, H; there are no no-call days); `availabilityMode` semantics violated (whitelist: any
`available` row for that surgeon in that month makes uncovered days ineligible; `unavailable` rows always block;
`backup_only` blocks primary; `no_backup` blocks backup); recurring `recurringUnavailable` (primary only since 9/22); `hardNeverWeekdays`
(Khan: Tue/Thu; Acton: Tue since 9/22 evening, Prompt 12 X — both primary only, `hardNeverWeekdaysRoles`; Sarkar has none since 9/22 evening); Khan **primary** on an East busy day (backup is allowed — `eastBlocksBackup:false`);
Philip's day-before-Aledo (primary only — `aledoDayBeforeRoles`, H); Fierce's weekday pattern outside his derived weeks (primary: Tue/Thu none, Mon backup-only, Wed preferred,
Fri/Sat/Sun only as one Fri+Sat+Sun block; backup every day since 9/22); Sarkar outside her windows (both roles; `daysPerWindowWeek` is a soft target since 9/22 evening); already
holds the other role that day; `backupOptOut` on a backup slot (I); would exceed `maxConsecutiveDays` (primary-only count by default,
`groupRules.countBackupInConsecutive` toggles; real days unless `holidayUnitCountsAsOneDay`, A); would exceed `monthlyCap.primary` (primary placements only — see the
9/22 paragraph below); Philip's `backupCap`.

**Backup is open to everyone (9/22, Prompt 12 I).** Every weekday-pattern, outreach, OR-day, Aledo and Clinton rule above
restricts *primary* only; a governed month's explicit list restricts the roles its `explicitListMonths` entry names (a plain
`'YYYY-MM'` = primary only; `{ month, roles }` = exactly those roles — Burchett's November and, since 9/23, December lists
govern both; Acton's November entry left with Prompt 12 Y). A scope change is data: 9/23 flipped Burchett's December entry
to the object form without touching code, and the published December rows were re-checked by hand rather than regenerated.
Vacations, East busy days (primary only), holiday opt-outs, derived-week locks, "holds the other role" and `backupOptOut`
still apply to backup.

**Holiday-unit days (small items, 9/22).** The holiday waiver (`groupRules.holidays.ignoreWeekdayRules`) lifts the
*recurring weekday patterns* only — `hardNeverWeekdays`, `recurringUnavailable`, the weekday allow-list, Fierce's outside-derived-weeks
pattern, the Aledo rules and the recurring whitelist. An **explicit dated list is never waived**: in a governed month
`whitelist-month` stays hard on a holiday-unit day (Burchett's December list omits 12/24 on purpose, so he cannot hold
the Christmas unit; 12/25, 12/31 and 1/1 are on it), and so does Philip's weeks list (`outside-available-weeks` —
Memorial Day 2027 sits outside his listed weeks). Still enforced on holidays as before: vacations, East, derived locks,
Sarkar's windows, caps, `maxMajorHolidays`, `backupOptOut`.

Soft penalties (weights configurable in `groupRules.weights`): `recurringAvoid` / `avoid` rows (medium), Philip on an
Aledo week (strong), `prefer` rows (negative), weekend-style mismatch (block-style surgeon on a lone Sat, etc.), holiday
preferences (`neverThanksgiving` is hard; `maxMajorHolidays` hard once reached; alternating-days preference soft),
back-to-back weekends, backup on the day right after a primary day (mild), distance from monthly target.

Every rule must be expressible in `call_schedule_data.data.surgeonRules` and editable in Setup — no surgeon-specific
`if (name === "Philip")` in code. Fierce's derivation and Khan's East dependency are generic features
(`eastFeed.enabled` + `eastBlocksPrimary` / `eastBlocksBackup` + a `derivedFrom` spec), so a future surgeon who splits
sites can reuse them. Fierce's `monthlyCap.countsEastDays` adds the days of his East *primary* weeks (derived Silvis backup,
7 per week) to his monthly primary count - see the 9/22 paragraph below (Prompt 12 K).

**Caps count primary days only (Prompt 12 K, 9/22).** `monthlyCap.primary` is the hard cap on the distinct days of a
calendar month on which the surgeon holds *primary* (schedule, assume-slots and the evaluated slot); `preferred` is the
soft ceiling on the same count; `eligibility()` runs the check for a primary placement only, so a backup placement never
trips `monthly-cap:N` or `over-preferred-cap:N` and backup days never count. `buildContext` reads the pre-9/22 key
`monthlyCap.total` (and `groupRules.defaultMonthlyCap.total`) as an alias of `primary` with one warning per surgeon;
`monthlyCapFor(ctx, id)` returns `{ primary, preferred }` plus `total = primary` for one release. Fierce
(`countsEastDays: true`) adds `P.eastPrimaryDays` — the days of his East *primary* weeks (derived Silvis backup,
`silvisRole: "backup"`); his East *backup* week is Silvis primary and counts through the primaries he holds; Khan's
busy-day set is never added to anyone's cap. Philip's `backupCap` (≤ 7 backup days, ≤ 1 backup weekend per month) is the
separate, explicit backup rule. The generator's `genTargets` clip and the tallies' `cap` field follow the primary cap
(preview column "Cap (P)"). A numeric `surgeonRules.<id>.monthlyTarget` is a **primary** target (J; small items 9/22): its soft
`over-target:<n>` / `under-target` term measures the same primary count as the cap and applies to a primary placement only —
a backup placement is never scored against it. `null` = equal share (§6).

## 6. Generator (`generator.js`)

**Entry:** `generate(ctx, startDate, endDate, opts) → { schedule, diagnostics }`, deterministic per seed, randomized
across runs, wrapped in **best-of-N** (N = 200 default; days × surgeons is tiny so this is cheap). The UI passes the
range from a preset: **this round = through 2026-12-31 (2026-11-02 → 2027-01-03)**; afterwards **3 / 6 / 9 / 12 months
from the last published day**. Any range works; the presets are conveniences. ⟶ **9/22 late (Faraz, Prompt 12 AB): every
preset now STARTS at the first open slot on or after today** (Central) — `helpers.suFirstOpenSlotDay(schedule, today)`: the
first saved day ≥ today whose primary (no holder, no external cover) or backup is open, or a missing day inside the saved
span; a past day is never a candidate (item Q), nor a day after the last saved row; when nothing is open from today on, the
start falls back to the day after `suLastContiguousDay` (the pre-AB rule; today when nothing is on file), clamped to today — a past day is never a start (AB review). Locks are seeded
first and never touched, so one run from that start fills October's open backups, the 10/15 and 10/24 primaries, every
11/5-type hole and the milestone; the preset END rules are unchanged (`rangePresets` receives start − 1). On the 73 rows of
the 9/22 import, run on 9/22, the start is **2026-10-07** — the first open October backup (10/7, 10/9–10/11, 10/13 precede the
open 10/15 primary).

**Pipeline for one candidate:**
1. **Seed locks** — existing locked days, manual locks, Fierce derived weeks (both roles as applicable), imported assignments. Locks are never moved.
2. **Build units** — each holiday (from `config.holidays.units[year]`) is a *holiday unit*: its days get **one primary and one backup who stick through the whole unit**; a holiday unit pre-empts any weekend unit it overlaps, and the leftover Fri/Sat/Sun days form a reduced weekend unit. Each remaining Fri/Sat/Sun triple is a *weekend unit*; every other day is a *day unit*. Holiday units are scored against the holiday pools (major/minor counts, tenure-normalized) and per-surgeon holiday rules (`neverThanksgiving`, `maxMajorHolidays`).
3. **Primary pass** — order units by constraint tightness (fewest eligible candidates first; weekend units generally first). For each unit enumerate legal patterns: day unit → each eligible surgeon; weekend unit → `block(x)`, `split(x,y)`, `daily(x,y,z)` per §4 of the rules. Score = Σ soft penalties + target-deviation term + pattern penalty (`daily` is expensive; `split` cheap for split-style pairs; `block` cheap for block-style surgeons) + small jitter. Pick the min. If a unit has **no** legal pattern, leave it open and record `diagnostics.uncovered` with the blocking reasons per surgeon (the UI shows this — never silently skip).
4. **Backup pass** — same as 3 with primary fixed; backup ≠ primary; backup placements are scored against the per-role backup targets (J); caps count primary only (K), so a backup placement never trips a cap (Philip's explicit `backupCap` is the one backup cap).
5. **Repair pass** — for each open slot, try 1-hop and 2-hop swaps that free an eligible surgeon (mirrors Davenport's Phase-1B chain swaps) while keeping every move inside `eligibility()`.
6. **Target smoothing** — per role, primary first: while any pool surgeon is above his primary (then backup) target and another below, move a *non-locked* day-unit slot of that role from high→low if eligibility holds, the soft score does not worsen beyond `weights.smoothingTolerance` and that role's total deviation strictly falls.

**Candidate score (lexicographic, lower is better) — Prompt 12 J, 9/22:**
`uncoveredPrimary ×1e9 + uncoveredBackup ×1e7 + hardViolations ×1e6 (should be 0 by construction) + Σsoft ×1e3 + primaryDeviation ×300 + backupDeviation ×100 + weekendSpread ×10 + holidaySpread`.
Targets are per role (`genTargets`; **equal shares — Faraz 9/22; water-filled share — Faraz 9/23, item WF**): each pool
member (active, `poolMember !== false`, no `availableWindows`, not `type: "external"`) gets, per role, the **water-filled
share** of *all* the pool's slots of the month — the open ones (primary: after the windows surgeon's reserved window
primaries; Sarkar's own target is `daysPerWindowWeek.target` × her window weeks in the month, N) **plus** the days pool
members already hold — poured over the members up to each member's clip (the K cap for primary, `backupCap.perMonthDays`
for backup); a member's target is `min(level, clip)`, **never floored at his locked days** (they count against his share).
`monthlyTarget: null` means that share, a number sets the primary target, `{ primary, backup }` sets each; there is no
neutral term. The deviation term is convex (`|count − target| ^ weights.deviationConvexity`, 2). Step 4 scores backup
placements against the backup targets (caps count primary only — K), step 6 smooths primary days and then backup days
separately, and `diagnostics.impliedTargets` shows every level plus, per member, the two targets, `lockedHeld` and the
"allowed by rules" slot counts so an availability shortfall is visible. The model, the knob and the diagnostics are in §15.

**Fill-open-only mode (T, 9/22):** `generate(ctx, start, end, { fillOpenOnly: true })` fixes every slot held on the input
(locked or not, `externalCover` included) and fills only the open ones — `diagnostics.mode = "fill-open-only"`,
`diagnostics.fixedSlots`, and a held unlocked slot that breaks a rule is a fact in `diagnostics.fixedViolations`, never a
hard violation. `scripts/preview-generate.js --backfill <from>..<to>` runs it over the live rows (the October open backups).
Outside surgeons (`type: "external"`, M) are never generated: a day one holds is a fixed slot in every mode and comes off
the pool's open-slot count.

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
- **Khan busy days:** `dayCall === FAK` → Mon…Sat busy (service week; Sat 07:00→Sun 07:00 is his); `nights.mon/tue/wed/thu === FAK` → that day busy; `nights.wknd === FAK` → Fri and Sun busy (Sat 07:00–Sun 07:00 is not his, but a lone Silvis Saturday breaks his block style — allow only as fallback); `holidayCoverage[d].surgeonId === FAK` → `d` busy. Busy days block Silvis **primary only** — Khan may be Silvis **backup** on an East call day (Faraz 9/21). East backup weeks (`isBackup` true) count as busy for primary too — but only the shifts he actually holds in such a week (his dayCall / override / night / weekend / holiday days), never all seven days; pinned by `test/east-feed.test.js` ("never busy wholesale").
- **Precedence on one date: holiday 24h > `dayCallOverrides` > `dayCall`.** A `holidayCoverage[d]` entry for *another* surgeon means that surgeon holds the whole 07:00→07:00 day (Davenport's calendar drops the Svc/Sat/Ngt/Wknd entries for `d`; its generator reassigns the night/weekend slot), so `d` carries **no** Khan reason — not service-week, override, night or weekend. Verified on the live row 2026-09-07 (dayCall FAK, Labor Day held by another surgeon). In the milestone window this matters for Thanksgiving Thu–Sat 2026 and New Year 12/31–1/2 whenever FAK is the East service surgeon (reviewer finding east-1, 2026-09-22).
- **Fierce derived weeks:** `isBackup` → Silvis **backup** Mon–Sun; `isFierceBackup` → Silvis **primary** Mon–Sun. Faraz's stated weeks (`surgeonRules.s5.eastFeed.statedWeeks`) fill only weeks with no *published* row.
- Cache each fetched week into `east_feed`; the generator reads the cache, never the network. Setup shows "East feed: fetched 2026-09-21 14:02, 26 weeks, next Fierce primary week 2026-12-07" plus a manual override list (`east_overrides`) for days Faraz knows differ. If the fetch fails, keep the cache and warn — never treat failure as "no East call".
- **Forecast rows live in their own table `east_forecast`** (`week_monday pk`, `data`, `generated_at`; printed by `scripts/east-forecast.js --sql`, never executed by the script). `east_feed` holds published Davenport rows only. A forecast row is `{ isForecast:true, runs, generatedAt, fakBusyProbabilityByDay:{date:p}, fierceWeekProbability }` and is consumed only via `forecastFromFeedRows(rows)` → `forecastToBusy(forecast, groupRules.eastFeed.forecast.busyThreshold)`. As a second guard, `deriveKhanBusyDays`, `deriveFierceWeeks`, `coverageOf` and `toEastFeedRows` treat any `data.isForecast === true` row as absent, so a forecast can never read as "published" (Khan silently free, a stated Fierce week suppressed, coverage claimed) — reviewer finding east-2, 2026-09-22.
- **Precedence, pruning and the conflict report (Prompt 12 C, 9/22): published > override > forecast.** Inside the published coverage (`ctx.eastCoverage` = `coverageOf` of the cached Davenport weeks) the forecast is never consulted — no `east-forecast-busy`, no soft `east-forecast`; only the busy set derived from published rows counts, so a stale probability can never block Khan after Davenport publishes (published-free day + forecast 0.9 = eligible). `east_overrides` reach `buildContext` as their own input (`eastOverrides[id] = { day: true|false }`, grouped by `overridesByPerson`): `busy:false` clears the day whether it came from a published row or from the forecast (the day stays "known", never `east-unknown`), `busy:true` is `east-busy` regardless of the forecast; `applyOverrides` on the busy set stays for older callers. Outside the coverage the forecast rule stands as before (`forecastOutsideCoverage` prunes the map the app and `scripts/preview-generate.js` pass). **Refreshing the feed** caches Davenport's published weeks and then `DELETE`s every `east_forecast` row whose `week_monday` lies inside the new published coverage (`Prefer: return=representation` to count them; a failed delete is a toast + warning, never silent); the `east.refresh` audit row carries `forecastRowsDeleted`. The forecast only ever fills weeks Davenport has not published. **Conflict report:** `rules.eastConflicts(ctx, days)` walks the held slots of the given days and lists `{ day, role, id, reasons }` where the East data makes the holder ineligible — `east-busy`, `east-forecast-busy`, `derived-lock:` (the derived surgeon held in the other role of his derived week) and `derived-lock-held:` (someone else in his derived slot); locks are reported too (a lock is a fact that now collides), a holder who is the derived surgeon in the derived role is fine. The generator puts it in `diagnostics.eastConflicts` over the final schedule (empty for generated slots; locked ones may conflict) and the East feed card shows "Conflicts with the published schedule" over the whole schedule map after every load or refresh, each row opening the day editor. `scripts/east-forecast.js` defaults `--runs` to the seed's `groupRules.eastFeed.forecast.runs` (200), the budget to 900 s, and writes `requestedRuns` and `runs` (executed) into `docs/east-forecast-latest.json`. **Fix round (review 9/22):** the app prunes the forecast with the *same* coverage the engine receives (null while an East id is unresolved, so a hard forecast block never degrades to `east-unknown`); the East card's own forecast strip reads the pruned map and names how many rows lie inside the coverage (ignored); a `DELETE` that returns no array records `forecastRowsDeleted: null` ("count unknown"), never a confident 0, and one final toast (tone error) carries a prune failure; an `east_overrides` map for a surgeon whose East feature blocks no role is dropped with a `ctx.warnings` entry; the calendar F badge honours `busy:false` (an O badge marks the cleared day). For a holder with `outsideDerivedWeeks` the conflict report also keeps `weekday-pattern:` / `weekend-block-only` on days outside his current derived weeks and from his `eastFeed.deriveFrom` on (evaluated as a block member when he holds the whole Fri+Sat+Sun block, as the generator does) — that is a derived week that moved away; before `deriveFrom` nothing was ever derived, so Faraz's single locked 10/12 is never listed; a former derived week where he holds *backup* is undetectable here (backup is open) and is covered by `diagnostics.derivedYields` and the E badges. `scripts/preview-generate.js` dumps `diagnostics.eastConflicts` in the report and the backfill section. Contiguity assumption: `coverageOf` is one `[first Monday, last Sunday]` range with no gap check, so the prune `DELETE` and `rdInPublishedCoverage` both assume Davenport's published weeks are contiguous (they are today, 2026-06-01..2026-11-09); a gap week inside the range would be pruned and read as known-clear.
- **East vacations (Prompt 15 part 1a, 2026-09-23).** Davenport's `time_off` table (`id, person_id, kind, start_date, end_date`; inclusive dates; `kind` `vacation` | `nocall`) is read through the East feed's existing read path — probed 2026-09-22 22:58: `GET .../time_off?select=...&limit=5` → HTTP 200 with rows, `select=count` → [n] rows (the probe is recorded verbatim at the end of `docs/PROMPT-15-EAST-VACATIONS.md`), so the path is 1a: no paste box, no Davenport change. *Refresh from Davenport* passes `fetchEastWeeks(from, to, { vacationCodes })` the roster codes of every surgeon whose `eastFeed` feature reads busy days (`eastBlocksPrimary`/`eastBlocksBackup`; FAK today); east-feed.js resolves each code to its Davenport id through the roster blob (never a hard-coded id), reads `time_off?kind=eq.vacation&person_id=in.(ids)&end_date=gte.{from}&start_date=lte.{vacationsTo}` (no-call days stay a Davenport concept; `opts.vacationsTo` defaults to the weeks window's Sunday + 365 days — the `time_off` read does not depend on what Davenport has published and vacations reach further than the weeks, Generate will offer 12-month presets — review E1 finding 2) and merges adjacent/overlapping ranges per code (`eastMergeRanges`, `vacationsFromTimeOff`). The cache stays per week: `attachVacationsToWeeks` writes into every published week's payload the ranges touching its Mon–Sun, whole, as `data.vacations: [{ code, start, end }]` (dates only, never a note — `east_feed` is anon-readable), so a refresh replaces them cleanly; a range that touches **no** cached week — Davenport publishes a few months ahead, vacations reach further (Khan's 11/25–11/29 and 12/11–12/13 lie beyond the published 11/09 week today) — rides on the latest cached week before it (or the first), and moves to its own row once that week is published. **The split runs over the whole cache, not the refresh window** (`planVacationCache(eastFeedRows, feed.weeks, feed.vacations, { from })`, review E1 finding 1): the carriers are the cached published rows plus the fetched weeks (the fetched payload wins per Monday), and every cached row *outside* the window whose list changed — a ride-on range now hosted by a newly published week, or cancelled / shortened in Davenport — is upserted too, with its own payload, the new list and its own `fetched_at`; otherwise a range riding on the newest cached week would go stale the day that host left the 28-day window (still a Silvis vacation under part 2's conservative default while Davenport had cancelled it), and a refresh that fetched 0 weeks would never touch the host. Ranges the read cannot see (`end < from`) stay as cached, so old rows neither churn nor lose past ranges; a row without the key whose computed list is empty is not rewritten. The toast and the audit row name the count ("N older cached week(s) rewritten"). `eastVacations(rows, code)` merges the per-week copies back into one sorted list — the single read path for the app and `rules.js` (`ctx.eastVacations`, part 2). **Failure contract, same as the weeks:** the `time_off` read is a separate step after the weeks and the roster; a non-2xx leaves `vacations: null` + `vacationsError` (unknown, never "no vacations"), the weeks are still cached, `keepCachedVacations` copies each week's previously cached list into the new payload so the upsert never wipes known vacations, and the one final toast (tone error) and the `east.refresh` audit row (`vacations: { codes, ranges, unresolved, error }`) name it. Known blind spot: an RLS-blocked read on the Davenport side is HTTP 200 + `[]` — indistinguishable from "no vacations in the window"; the toast therefore always states the count ("N East vacation range(s) for FAK cached"), so a sudden 0 is visible. Callers that pass no `vacationCodes` (`scripts/preview-generate.js`, `scripts/publish-preview.js`) do no `time_off` read and are unchanged. Nothing visual yet: the review states, badges and the coverage-strip count are parts 2–3.

## 8. UI (index-source.html) — what changes

Views: `calendar` (month grid + week-rows list), `myschedule`, `setup`, `totals`, `timeoff` (vacations + trades), `settings`.
Keep Davenport's auth gate, toasts, dark mode, Collapsible, publish dialog, snapshot/restore, audit view, share/print/ICS
buttons, the notification center, the refresh/version banner, and Settings → Data management exactly as they are.

- **Month grid cell:** two lines — `P Burchett` / `B Acton` — colored per surgeon; open slot = red "OPEN" (the ER-panel author's convention); weekend units get a subtle bracket; locked slots show a padlock; East-derived (Fierce) slots show a small "E".
- **Week rows list:** the same rows as the ER-panel author's Word document (MON/SUN DATES | TRAUMA | TRAUMA BACKUP — the primary column is headed TRAUMA since 9/22, Prompt 12 P) with ranges collapsed (`9/15–9/18 Philip`) — this is also the export format (§9).
- **Day editor** (click a cell): set primary/backup from a dropdown that shows eligibility — eligible names first, ineligible greyed with the reason; lock toggle; note. Backup lists everyone (9/22: backup is open unless `backupOptOut`). Outside surgeons (M) sit under their own "Outside surgeons" heading for both roles; picking one locks the role and saves `source: "manual-external"`. A Fri/Sat/Sun candidate who already holds the other two block days is judged as a block member (small items 9/22 — Fierce can complete a Fri–Sun block by hand); the same holds for a block-style receiver of a whole Fri–Sun block in the trade path. The editor **fails closed**: a thrown eligibility check makes the option ineligible with the error as its reason and disables Save until the rules evaluate again.
- **Open shifts** (board, self-claim, weekly reminders): §16.
- **Theme (O/R, 9/22; delivered 9/23, Prompt 12 TH):** every colour is a named token in `app-styles.js` — `THEME.light` / `THEME.dark`, read in the JSX as `T = THEME[dk ? "dark" : "light"]` (the older `dkBg` / `dkText` / `dkSubtext` / `dkCardBorder` names are aliases of `T.*`). Light: navy `#13294B` for the header bar, nav, primary buttons and card titles; orange `#FF5F05` as an **accent only** (count badges, the active-tab underline, the today ring, the primary call to action `css.cta`), `#C2410C` wherever orange is text on white, `#FFE8DB` as its tint; page `#F6F8FB`, card white, text `#1F2A3A`, muted `#5B6B82`; **OPEN stays red `#B91C1C`**. Dark: page `#0B1A33`, surface `#13294B`, text `#E6ECF5`, accent `#FF8A4C`, muted `#9FB0C8` (OPEN `#F06060`); the dark `<style>` sheet matches the light literals in React's `rgb()` form and re-paints them. Per-surgeon colours are **data keyed by roster id** (`SURGEON_COLOR_BY_ID`: s1 navy `#1F3A6B`, s2 orange `#D9561A`, s3 teal `#0F766E`, s4 plum `#6B3FA0`, s5 olive `#6B7F1A`, s6 slate `#475569`; each with a pill tint and a dark-page variant) and by roster **type** (`OUTSIDE_SURGEON_COLOR`: grey `#737373`, dashed border) — `rosterColors(entry, idx)` / `rosterNameColor(c, dark)` / `pillBorder(c)`, never a name in code; P/B stay text weight. The opening screens (sign-in / sign-up / reset / set-password card's SSC tile, links and button, the biometric tile, loading, crash) use the orange `OPENING` gradient `#FF5F05 → #E8520A` with white text in both themes; `manifest.json` `theme_color` + `background_color` and `<meta name="theme-color">` are `#FF5F05`; the three icons are the supplied orange "SSC" tiles (installed PWAs pick them up on their next manifest refresh; iOS may need remove + re-add). The exports (share page, printable month, ER panels — `helpers.js exportColorsFor`) resolve through the same `rosterColors(entry, idx)`, and the export CSS carries the theme (`.hd a` `#C2410C`, `.ro` / `.wh` `#13294B`, navy toolbar button); roster pills rendered as buttons carry `data-pill`, which the dark sheet's generic button rule (`button:where(:not([data-pill]):not([data-tab]):not([aria-label="Notifications"]))`) leaves alone; the Fairness bars use `T.barTrack` / `T.barStart` / `T.barEnd` (both gradient stops ≥ 3:1 on the track in each theme); count-badge digits are `onAccent` (`#13294B` light, `#0B1A33` dark, ≥ 4.5:1). Dark mode is the Settings toggle (`silvis-dark-mode`); there is no `prefers-color-scheme` hook. Proof: `test/data-layer.test.js` [TH] pins, `test/ui/contrast.mjs` (every token pair, 4.5:1 text / 3:1 bold labels and glyphs, printed by the smoke), `test/ui/smoke.mjs` (sign-in + month view screenshots per theme, computed-colour probes, the source grep for the Davenport blues / `DSG`).
- **Setup:** roster (names/codes; no contact fields); **Users** (link auth users to roster ids, set roles — the only place emails appear, read from `user_profiles`); **Rules** editor per surgeon (availability mode, recurring patterns with a live "next 8 matching dates" preview, weekend style + partner + "Primary contribution" ((none) / weekends, L), max consecutive (hard primary-only, soft any-role), holiday-unit-as-one-day opt-in, monthly cap (primary days) and target (blank = equal share; a number = primary target), "Does not take backup", holiday rules, East feed toggle); **Roster** also takes outside surgeons ("Add outside surgeon": name + code + operational note, M); **Availability** entry (dated rows by kind, plus quick paste of a date list like Burchett's); vacations (scheduler view of everyone's, with override entry); **Holidays** editor — per year, each unit's days (editable) and its primary + backup, with the major/minor fairness counts beside each name; East feed panel; **Generate** with range presets — *Through end of year* (this round) and *3 / 6 / 9 / 12 months from the last published day* ⟶ **9/22 late (Prompt 12 AB): every preset starts at the first open slot on or after today** (§6, §15) — plus N, "respect locks", preview → publish with diff; import from `silvis-seed.json` (file picker; the importer writes no contact fields and refuses a file that contains any); office contacts (entered by hand — the ER-panel author).
- **Totals:** per surgeon by month, year-to-date and rolling 12 months: primary shifts, backup shifts, weekend days, major/minor holidays, max consecutive (primary-only and any-role, real days), each vs target/cap — the cap is primary-only and the deviation is primary minus target (J/K); an "Outside surgeons" section lists their day counts (M); fairness view (deviation from target). One 24-h day = one shift, nothing weighted. **No stipend, pay or $ figures anywhere** (Faraz 9/21).
- **Time off & trades:** a surgeon enters a vacation range for themselves — no approval; the entry is refused if any day in the range has them published as primary or backup (the conflicting dates are listed with a "propose a trade" shortcut), otherwise it is saved, logged to `audit_log`, and those days are blocked from call. Scheduler can enter for anyone and override. Trades by day+role with eligibility checked for the recipient; an accepted trade is applied to the schedule with an audit entry and notifications (scheduler can revert).

## 9. Exports

- **.ics** — per surgeon (`silvis-call-<name>.ics`) and full group; events `Silvis Primary Call` / `Silvis Backup Call`, 07:00 → 07:00 next day, `America/Chicago`. Reuse `helpers.js` `generateICS/downloadICS`; replace `buildICSEvents`.
- **Shareable read-only HTML** — same mechanism as Davenport (self-contained page, Outfit font), month grid + week rows.
- **Printable month** — reuse `buildPrintableCalendarHTML` with the new cell content.
- **ER Call Panels export for the ER-panel author** — an HTML table in her exact layout (MON/SUN DATES | TRAUMA | TRAUMA BACKUP; one row per Mon–Sun week; entries `M/D Name`, consecutive same-surgeon days collapsed `M/D–M/D Name`; open days in red) with a **Copy for Word** button (writes `text/html` to the clipboard so it pastes as a table). Stretch: true `.docx` via the `docx` UMD build from cdnjs.
- Unassigned slots before today (Central) render blank in the grid, week rows and every export; OPEN is shown from today forward (Faraz 9/22, Q): one definition, `slotIsOpen(dateStr, holder, today)` / `buildWeekRows(..., { today })` in `helpers.js`, and one notion of today — `todayCentral()` — shared by the grid, the legend ("OPEN = nobody assigned (today onward)"), the calendar's default month, the exports and `generator.rangePresets`.

## 10. Notifications, office notifications, calendar sync, refresh, data management

All of these are **in scope and carried over from Davenport** (Faraz 9/21):

- **In-app notifications** (`notifications` + per-user `notification_preferences`) — same center, same categories minus vacation approvals: schedule published, manual edit affecting you, trade proposed/accepted/declined/applied, vacation logged, shift reminder.
- **Email** via the `send-notification` edge function pattern (per-user email prefs); recipients come from `user_profiles.email` / `office_contacts`, read server-side with the service-role key — never from the blob.
- **Office notifications** — `office_contacts` (the ER-panel author first) receive the schedule-change digest / publish notice through the `office-notifications` edge function pattern, retargeted to day + role.
- **Calendar sync** — the `calendar-sync` edge function serves a per-surgeon ICS feed URL (`?surgeon=<CODE>`), matched on `code`, reading `schedule_days`; `verify_jwt` must stay OFF (clients send no auth header) — verify with an unauthenticated GET → 200 + `BEGIN:VCALENDAR`. Subscription instructions in Settings.
- **Shift reminders** — the `daily-reminder` edge function pattern (reminder hour per user, Central time).
- **Refresh** — `client_versions` min-version check with the reload banner, plus the `reloadTrigger` second-pass load.
- **Data management** — Settings → JSON backup/restore, export, import, snapshots list + one-click restore, factory reset behind the wipe guards.
- **Keepalive flush (RF2, 9/23)** — while a `syncScheduleDays` run is enqueued or in flight (`daySyncBusyRef`), a `visibilitychange` flush skips its `schedule_days` leg (keeps the blob leg), re-arms the pending payload and enqueues the pending days BEHIND the in-flight run (the chain serializes them; nothing is left to the debounce timer), so a long Accept & Publish with the phone locked mid-way never gets the same days PATCHed twice at the same versions. `pagehide` / `beforeunload` keep the keepalive days leg (review fix: the chain dies with the page there; a CAS duplicate matches zero rows). A never-settling fetch keeps the count > 0 for the session by design.

Edge-function sources are **not in the Davenport repo**: Faraz will copy them from his OneDrive
`...\Genesis\Schedules\Call Schedule App\edge-functions\` folder into `...\Silvis Call Schedule\edge-functions\` for
Claude Code to retarget. Deploy convention is the same as Davenport (Supabase CLI, `--no-verify-jwt`, back up the
deployed source before overwriting, byte-diff after). OneSignal push is not requested.

## 11. Build & deploy (identical to Davenport — follow its CLAUDE.md rules)

- Edit only `index-source.html` and the plain-JS modules. `index.html` and `APP_VERSION` are CI-owned.
- Before every push: `npm test && node build.js` (every suite in package.json's test chain, the generator regression last, then the build); all gates green; `git restore index.html` before committing; `npm run smoke` for anything touching `index-source.html`.
- Repo secrets: none needed (Pages + `GITHUB_TOKEN`). The Supabase anon key is public by design; the service-role key is never committed.
- Pages URL once live: `https://fkhan628.github.io/Silvis-Call-Schedule/`.
- One push to `main` is a live deploy — branch + PR for anything touching destructive paths, sync/state, RLS, or many call sites.

## 12. Testing

`test/generator-regression.js` must **re-state every hard rule independently** (no shared code with `rules.js` beyond
date helpers), generate 50 seeds × 4 ranges (Oct 2026 with imports; Nov–Dec 2026; Jan–Mar 2027; the milestone 2026-11-02 → 2027-01-03 on the
even seeds), the fill-open-only October backfill runs (Prompt 12 T) and the fixture runs from
`docs/silvis-seed.json` + a synthetic East feed (`test/fixtures/`), and assert:

1. Every day in range has a primary and a backup, **or** appears in `diagnostics.uncovered` with reasons (never both, never neither).
2. `primary !== backup` on every day.
3. Locks (imports, manual, Fierce derived) are byte-identical in the output.
4. No assignment on a `time_off` day or on the day before a vacation day.
5. Khan: never Tue/Thu **as primary** (backup any day since 9/22); never **primary** on an East busy day (backup on an East day is legal).
6. Acton: never **primary** on a 2nd/4th Mon or Wed (backup allowed since 9/22); never **primary** on a Tuesday (X, 9/22 evening; backup allowed); never 2026-11-19..22 or 11-25..29; never Thanksgiving.
7. Burchett: primary only on whitelist days (recurring or explicit `available`; a governed month's explicit list is not waived on a holiday-unit day); backup only on listed days in a month whose entry governs backup too (November, and December since 9/23); ≤ 2 consecutive primary days (real days); ≤ 8 **PRIMARY** days per month (backup never counts — K). Acton and Khan have no cap (a `monthlyCap: null` must not fall back to the group default).
8. Philip: never **primary** the day before an Aledo day (H); never **primary** outside his listed weeks from 11/2026 (holiday-unit days included — small items 9/22); never 2026-10-15; backup ≤ 7 days and ≤ 1 weekend per month; ≤ 1 major holiday; ≤ 4 consecutive primary days.
9. Fierce: his derived weeks appear whole, with the correct role, as locks; outside them never **primary** on Tue/Thu or Mon (backup any day since 9/22), a Friday primary only as the start of a Fri+Sat+Sun block; Silvis primary days + East primary-week days ≤ 14 per month (K).
10. Sarkar: only inside her windows (Mon–Fri since 9/22 evening), either role; no Fri–Sun block; ≤ 2 consecutive primary days (hard); the 2 primaries per window week are a **soft** target (diagnostics `windowWeeks`, never a violation — N revised).
11. Weekend units: block-style surgeons never hold a lone Fri/Sat/Sun unless the unit is flagged `fallback:true` in diagnostics.
12. Best-of-N returns the candidate with the minimum score; determinism: same seed → same output.
13. Holiday units: every unit in range has one primary and one backup for all its days (same surgeon throughout), the unit pre-empts the overlapping weekend unit, `neverThanksgiving` and `maxMajorHolidays` hold.
14. Time off: a `time_off` row overlapping a published on-call day for that surgeon is refused (DB trigger test via curl or SQL, not just the client check).

`test/rules.test.js` covers `matchesPattern` (nth weekday, week-of-month, Sunday-before-nth-Monday, month edges),
whitelist vs blacklist semantics, trailing-edge vacation logic, East-feed derivations.

CI runs both before the build, exactly like Davenport's workflow runs its regression harness.

RF2 (9/23) pins: `test/data-layer.test.js` [RF2] exercises `suHeldUnlockedSlotChanges` (extracted from index-source.html into the helpers sandbox) and pins the Accept confirm order, the flush guard, the fill-open-only checkbox / seed text and the in-app Apply's retired-key removal; `test/importer.test.js` RF2 pins `seedRevisionCount` / `seedLastRevision`, the SQL's `- 'seedRevisions'` in SET and WHERE, `planDiff` reading a leftover key as `settings=update`, `impBlobOwner` and the CLI guard's source; `test/ui/smoke.mjs` asserts the held-but-unlocked confirm on both Accept clicks (count derived from the grid vs the live rows), the flush during a held-open CAS write (zero schedule_days writes, blob leg sent, the skipped edit lands afterwards) and the checkbox default. Review of RF2 (same night): `importer.test.js` pins `impCoreHash` / `impBlobEditState` (the content-based guard, the `settings.seedCoreHash` stamp, the schema's empty row is no row) and the CLI's `coreWouldChange` refusal; `data-layer` pins the `visibilitychange`-only skip with its enqueue, the conditional checkbox pointer and the `gen-mode` diagnostics line; the fixture smoke injects one unlocked generated November backup (2026-11-19) so the Accept confirm's positive branch runs and is counted.

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

## 15. Amendments of 2026-09-22 (Faraz, in Cowork) — override anything above that conflicts

- **Backup is open to everyone, every day**, on-site or off-site, unless a surgeon explicitly opts out
  (`surgeonRules.<id>.backupOptOut`). Outreach days, OR days, Clinton/Aledo days and weekday patterns restrict **primary
  only**. Vacations, East busy days (primary only), holiday opt-outs, derived-week locks and "holds the other role" still
  apply to backup. (Resolves the open Thursday backups.)
- **Fairness = everyone as equal as possible**: implied equal shares of primary slots and, separately, of backup slots
  for every pool member; no neutral/zero terms; primary spread then backup spread in the score; smoothing moves backup
  days too. Sarkar is outside the equal-share pool; her soft target is 2 primary days per window week instead (the clinic manager
  9/22 evening; supersedes the daytime 3–4; Prompt 12 N revised).
- **Water-filled share + convex deviation (Faraz 9/23, item WF, after `docs/REPORT-NOV-BACKUPS-2026-09-23.md`)** —
  supersedes §6's "flat share" paragraph. *Model* (`generator.js genTargets` / `genWaterFill` / `genDevCost`): per role and
  calendar month the pool's slots = the open in-range slots (primary: after Sarkar's reserved window primaries) **plus every
  day of the month a pool member already holds** (import, manual, derived, claimed, published outside the range); they are
  water-filled over the members up to each member's clip (K clip for primary, `backupCap.perMonthDays` for backup): a member
  whose clip is below the level takes the clip and the rest share the remainder; a member's target = min(level, clip),
  **never floored at `lockedHeld`** — his fixed days count against his share and, when they exceed it, he stands above
  target. A numeric `monthlyTarget` still overrides (the member leaves the fill for that role, his number comes off the
  slots). The deviation term is `|count − target| ^ convexity` in every place it is read — `genTargetDelta` (day fill,
  weekend / holiday unit patterns summed per member, repair's `genBestFor`), `genSmooth` (donor = furthest above, receiver
  = furthest below, any pair whose convex sum strictly falls) and `genEvaluate` (`primaryDeviation` / `backupDeviation` are
  the convex sums; `GEN_SCORE_WEIGHTS` unchanged). *Knob*: `groupRules.weights.deviationConvexity`, seed **2** = code
  default `GEN_DEVIATION_CONVEXITY`; `1` is the old flat term; anything below 1 or non-numeric reads as 2. *Diagnostics*:
  `impliedTargets.convexity`, per month `poolSlots`, `heldByPool`, `primaryShare` / `backupShare` (= the level),
  `placeableAtTarget` (≥ the open slots now) and `heldAboveShare` (the fixed days over share). *Effect on the published
  range* (report, nothing regenerated): November backups Fierce 16 → 11, Khan 3 → 5; 34 of 224 slots differ; soft sum 70 →
  96 — the fairness term outweighs medium soft terms once a member is 2+ days from share, which is the decision's intent;
  the knob is the lever if the group wants it softer. Tests: `test/nov-backups.test.js` (synthetic; fails on a locked floor
  and on a flat term) and `test/water-fill.test.js` (`test/fixtures/water-fill-2026-10-07-to-2027-01-03.json`, the
  pre-publish inputs, the two bestOf-200 runs of the publish, pinned tallies; its own chain step and workflow step, default
  budget 6000 ms via `SILVIS_GEN_BUDGET_MS`, pinned by `test/ci.test.js`). *Review fixes (9/23, fix stage):* the November
  case left `test/generator-regression.js` (the harness read 9.9–11.1 s loaded with it inside against its 10 s failing
  budget); `genWaterFill` reports `level: null` when every member sits on his clip (`primaryShare` / `backupShare` null, the
  shares at the clips — it read 0); a `weights.deviationConvexity` that is present but rejected is named in
  `diagnostics.warnings` ("… ignored: needs a finite number >= 1; using 2"); the seed's `s1.monthlyTargetNote` no longer
  describes the flat share. *Wording follow-up (9/23, after the rebase):* the Generate panel's per-month head line in
  `index-source.html` now prints the pool slots and the level (`primary S pool slots (X open − Y reserved + H held) = level
  L each of N; backup …`, `at caps` when every member sits on his clip and the level is null; a preview persisted before
  9/23 without `poolSlots` is labelled `pre-9/23 preview (flat share)`), its shares paragraph and per-member table (the
  held-day columns read `Held P` / `Held B`, once `Locked P` / `Locked B`; held = locked, derived, claimed or published),
  the Generate tallies table's `Target P` / `Target B` titles, and the Totals table's fairness sentence, footnote and
  `Target` / `Target B` column titles (`TotalsCard`; the second follow-up commit — the first had re-titled only the tallies
  table) describe the water-filled share, and `scripts/preview-generate.js` prints the same head line, heading and table
  header; `test/data-layer.test.js` pins the wording. *Still open outside this item:* `rules.js
  defaultWeights()` does not carry `deviationConvexity` yet, so Setup shows no placeholder until the blob has it; rules doc
  §8 item 18 (Sarkar as backup inside her windows under the convex term).
- **Caps count primary days only**; backup does not count toward any total cap (Burchett's 8, Fierce's 14). Philip's
  explicit backup cap (≤ 7 days, ≤ 1 weekend) remains.
- **Khan contributes primary on weekends when available**; his backup count is balanced like everyone else's; East
  cross-reference covers all Davenport call (service weeks, nights, weekends, backup weeks, holiday coverage, forecast).
- **Outside surgeons ("internal locums")**: roster entries of `type: "external"`, written in by hand in the day editor,
  never generated, tallied separately, exported like anyone else. Legacy `externalCover` stays for the Atwell import.
- **Sarkar**: soft target 2 primary days per window week (9/22 evening; the daytime statement said 3–4; primary counts only),
  alternating days when possible (soft), windows Mon–Fri (a window Friday is an ordinary standalone day; the Saturdays came
  off with the Mon–Fri windows), never a Fri–Sun block, max 2 consecutive (hard), backup optional inside windows.
- **Day-before rules stay primary-only** under the open-backup rule.
- **Theme**: University of Illinois blue and orange, softened — navy #13294B as the structural color, orange #FF5F05 as
  an accent only (darkened #C2410C for text on white), red reserved for OPEN; dark mode on deep navy. See Prompt 12 O.
  **Delivered 9/23 (Prompt 12 TH = O.1–O.3 + R; O.4 superseded by R):** tokens live in `app-styles.js` `THEME`
  (light / dark, same names), per-surgeon colours keyed by roster id / type (`SURGEON_COLOR_BY_ID`,
  `OUTSIDE_SURGEON_COLOR`), the opening is the orange `OPENING` gradient (`#FF5F05 → #E8520A`, white text) with the
  supplied SSC icons and `#FF5F05` manifest / meta theme colour — §8 has the full token list and the proof files.
  The wave-9 review folded `helpers.js` in: the export CSS carries the theme and `exportColorsFor` resolves through
  `rosterColors` (no Davenport blue anywhere outside history comments).
- The repo's `docs/silvis-seed.json` is canonical from the overnight build onward; docs flow repo → OneDrive.
- **UI, from Faraz's first look at the live app (9/22, Prompt 12 P–Q)**: the week-rows / ER Call Panels primary column
  is headed **TRAUMA** (no "cardiothoracic"); an unassigned slot is **OPEN only from today forward** — earlier days
  render blank, never red.
- **Minor Monday holidays absorb the weekend before (Faraz 9/22 evening, Prompt 12 U)**: a minor holiday (Memorial Day,
  July 4th, Labor Day) that falls on a Monday is a **Sat–Mon** unit; the Friday is the reduced weekend unit — and, since
  9/22 late (Prompt 12 AC), July 4th is read on its **observed** day (Sunday → Monday, so 2027 = Sat 7/3 – Mon 7/5;
  Saturday → the Friday; that unit's shape is still open, builder default the Friday alone) while Thanksgiving is
  **Thu–Sun** every year (2027: 11/25–11/28). Data, not
  code: `groupRules.holidays.mondayMinorAbsorbsWeekend` (true), applied when a year's units are built —
  `helpers.defaultHolidayUnits(year, opts)` (generic, pure) pre-fills Setup → Holidays → Add year (name / tier / days
  only — no notes reach the blob); stored unit days stay authoritative and editable per year **until the next seed
  re-import**: the importer replaces `blob.holidays` from the seed wholesale (no app-edited guard, unlike
  `schedule_days`), so mirror Setup holiday edits into `docs/silvis-seed.json` before re-importing, or stop re-importing
  the blob after go-live. 2027: Memorial Day 5/29–5/31, Labor Day 9/4–9/6, July 4th Sat 7/3 – Mon 7/5 (observed Monday;
  AC), Thanksgiving Thu 11/25 – Sun 11/28 (AC); 2026 left as built (the milestone range does not move; the seed's July 4
  2026 stays 7/4 although the builder now reads a Saturday July 4 as the observed Friday). Proof: `test/holidays.test.js`
  (CI step "Holiday unit builder tests").
- **Standing East rule (Faraz 9/22 evening, Prompt 12 V)**: Khan is on Davenport call every Christmas Eve and Christmas
  Day, so he is never Silvis **primary** on 12/24–12/25 in any year (backup stays open under his East-day rule). Data,
  not code: `surgeonRules.<id>.eastStanding = [{ name, days: ["MM-DD"] }]` (s1: Christmas 12-24 + 12-25), read by
  `rules.buildContext` and applied inside the existing East block of `eligibility()` as the same hard `east-busy`,
  ahead of the forecast and of `east-unknown`, behind the same gate as busy days — `eastFeed.enabled` blocking a role (a
  bad day, a nameless entry, a disabled feature or one that blocks no role warns and is ignored); not counted in the
  Totals "East days" column until the feed carries the day; `rules.standingEastDays(ctx, id, from, to)` lists the
  concrete days, `diagnostics.eastStandingDays` carries them per run and they are never "East-unknown"; the Setup East
  card shows a read-only "Standing:" line (`east-standing-<id>`) and the day editor's East line names the entry. No
  Setup field yet (seed/blob data; the rule is inert in the app until the seed re-import carries the key to the blob);
  a one-year exception is a manual override with the visible warning. Proof: `test/rules.test.js` V block,
  `test/generator-regression.js` V pin (every stored run over Christmas 2026), `test/holidays.test.js` D1 (Christmas 2027).

- **Own dates beat own patterns (Faraz 9/22 evening; Prompt 12 W)**: a surgeon's explicit dated `available` /
  `backup_only` row (entered by them or by the scheduler for them) lifts every weekday-pattern rule for that date and
  role, `hardNeverWeekdays` included (`rules.js rdStatic` reads the same `rowAvail` flag as the rest of the family); it
  never lifts an obligation — vacations and the trailing edge, East busy / forecast-busy days, derived-week locks,
  `availableWindows` (moved to the never-lifted gates: a row outside a window no longer opens the day; edit the window
  in Setup instead), `backupOptOut`, caps, consecutive limits, the other role. A manual/import lock is not a row (the
  holder keeps the lock, the rule is listed in `conflicts`). Seed: `groupRules.availabilityPrecedence` tiers and
  `availabilityPrecedenceNote`, `surgeonRules.s1.hardNeverWeekdaysNote`, `s6.availableWindowsNote`; pinned in
  `test/rules.test.js` (Prompt 12 W block) and `test/generator-regression.js` (generic hardNeverWeekdays pin +
  `test/fixtures/khan-dated-row-2026-12-01.json`).
- **Default Generate start = the first open slot from today (Faraz 9/22 late; Prompt 12 AB)**: "Locks are never
  touched, so starting at the first gap is safe and catches the October opens and any 11/5-type hole in one run."
  `helpers.suFirstOpenSlotDay(schedule, todayCentral())` — the first saved day on/after today (Central) with an open
  primary (no holder, no external cover) or an open backup, or a missing day inside the saved span; never a past day
  (item Q), never a day beyond the last saved row; null → the day after `suLastContiguousDay` as before (today when
  nothing is on file), clamped to today (AB review: never a past start). The presets, the default Start/End and the "days with a held slot from the start on" list all
  derive from that start; the panel sentence names it (`data-testid="gen-last-published"`, `data-gen-start`). On the
  live rows of 9/22 that is **2026-10-07** (the first open October backup), not 10/15 — five October backups precede
  the open 10/15 primary. Proof: `test/data-layer.test.js` AB block (helper pins on synthetic maps and on the seed's
  rows; source pin on the wiring), `test/ui/smoke.mjs` (the start restated from the live rows, never from the helper).
- **Review fixes 2 — app safety (RF2, 9/23 overnight)**: Accept & Publish names every **held but unlocked** slot the
  merge replaces (manual / trade / claim / generated / import holder or external cover, not locked in that role) in the
  same confirm as the locked ones, before the snapshot — Cancel writes nothing; Generate has a **"Fill open slots only
  (keep every held day)"** checkbox (T's `fillOpenOnly`, default off, kept on re-roll, named in the toast / meta line /
  audit detail) and the Seed field says where the seed shows (`random - the toast shows the seed`); the keepalive flush
  yields to an in-flight CAS sync (§10); `scripts/import-seed.js` reads the blob's `updated_by` and prints **BLOB WAS
  EDITED IN THE APP at <ts> by <who>** when the live blob's seed-owned keys (pool roster, surgeonRules, groupRules,
  holidays) no longer match the `settings.seedCoreHash` stamp `importPlan` writes (review fix: content-based - the
  autosave re-stamps `updated_by` on any state change, so `updated_by` is information and the fallback only until the
  first stamped import), refusing `--apply` (exit 4) only when the plan would change a **core** key, unless
  `--overwrite-blob` (a settings-only plan never refuses; rows unaffected); and `blob.settings.seedRevisions` (the
  paragraphs) is replaced by `seedRevisionCount` +
  `seedLastRevision` — the SQL subtracts the retired key in SET and WHERE, the in-app Apply deletes it, so the next
  re-import removes the paragraphs from the live blob.
- **Publishing from the command line (Faraz 9/22 evening: "go ahead and deploy, publish and move forward without my
  go"; Prompt 12 PUB, 9/23 overnight)**: `scripts/publish-preview.js` publishes the regenerated preview
  (`docs/PREVIEW-2026-11-02-to-2027-01-03.json`, milestone + October backfill) server-side, mirroring Accept & Publish
  step for step — snapshot `generate_publish` first, compare-and-swap writes on the version the dry run saw, one
  `schedule.generate_accept` audit row — as ONE atomic DO block through the linked CLI. Dry run by default (anon
  reads; prints the plan, writes the SQL and a report to the scratch path); `--apply --workdir <linked dir>` runs it
  and verifies by re-reading. Locked roles never change (a differing locked holder aborts), app-edited slots
  (manual / trade / claim) are refused and listed, an import holder is never cleared, `external_cover` is never set or
  cleared and an existing note is never overwritten, the app's wipe guard runs, and it sends no notice of any kind — the app's publish dialog (office notice, in-app notice, mail)
  stays Faraz's step. Details in §19. Proof: `test/publish.test.js` (CI step "Publish-preview plan tests").

  Prompt 12 SM2 (9/23, after the overnight publish through 2027-01-03): the smoke's other date-bound pins — week-row / ER-copy OPEN entries, the fail-closed and Fri–Sun block days, the Generate preview range (that derived start through the end of its month) and the Import dry-run / apply counts (blocked days, availability / time_off skipped, "kept (app-edited)") — derive from the live rows and the importer's own plan the same way, so the harness survives a published schedule.

## 16. Open shifts — board, self-claim, notifications (Faraz 9/22; Prompt 13)

*Status 2026-09-23 (overnight review): built on branch `feat/open-shifts`, merged to `main` and live — the Pages build
`2026.09.23b` (origin/main `0d78493`) carries it; `claim_open_slot` and both edge functions are deployed (commit `d6df687`).
The Prompt 12 review branch this note was written on predates that merge; the section reads as built.*

After generation some slots may stay open. Prompt 13 (`docs/PROMPT-13-OPEN-SHIFTS.md`) gives the group one list of
them, lets any surgeon take one, and tells everyone while any remain. Five things to know, in order: what "open"
means (16.1), where the claim is checked (16.2), how the group hears about it (16.3), the cron job (16.4), and what a
`git push` does NOT do (16.5).

### 16.1 The single definition

One pure definition — `openSlots(schedule, from, to, today, opts)` in
`helpers.js` → `[{ day, role, unit, reason }]` for every day in `[from, to]` (inclusive) that is `>= today` (inclusive;
the Prompt 12 rule that days before today are never open) where the role is unassigned: **primary** = no `primary_id`
AND no `external_cover`; **backup** = no `backup_id`; a day with NO row inside the range is open in both roles; sorted
by day then role (primary before backup); invalid inputs → `[]`, never throws. `opts` is optional:
`{ holidayByDay, weekendKinds: { '<friday>': 'block'|'split'|'daily' }, reasons: { 'YYYY-MM-DD|primary': string } }`;
`from`/`to` must be real calendar days (`'2026-13-40'` → `[]`). `unit` is decided per day, as the generator builds its
units: `{ kind: 'holiday', name }` on a holiday-unit day, else `{ kind: 'weekend', pattern, friday }` on any Fri/Sat/Sun
(including the leftover days of a weekend a holiday pre-empts — the generator's reduced weekend unit; `tradeUnitOf`
voiding a whole block *trade* over such a weekend is a trading rule), else `null`; `reason` is the last generate's
operational wording from `opts.reasons`, trimmed, or `null` (a lock flag never holds a slot). Companions:
`openSlotKey(day, role)` (`'day|role'`), `openSlotCounts(list)` → `{ primary, backup, total }`,
`openSlotWeekendKinds(diagnostics.weekendUnits)`, and `openSlotsLine(slot, nameOfUnit?)` →
`'Fri 11/06 - primary (weekend block) - open'` (the board's Copy list: weekday, zero-padded `MM/DD`, role, the unit in
parentheses, `- open`, and ` - <reason>` appended when the slot has one). Pinned by `test/open-shifts.test.js` against
`test/fixtures/open-slots.json` (which also states the `schedule_days` column mapping); part 5 mirrors the function in
TypeScript in `edge-functions/daily-reminder/index.ts` against the same fixture — this one function feeds everything:
the coverage strip (`suCoverageGlance` computes its open lists through it), the "only OPEN" filter (a memoized Set of
`openSlotKey`s over the grid's span, a generator preview overlaid per day exactly as the cells draw it; `slotIsOpen`
is the one predicate: `openSlots` applies it per slot as `slotIsOpen(d, dayHolder(a, role), today)` (P13R), and the cells render the same rule), a new **Open shifts** view
(nav badge with the count; table of open slots from today to the end of the published range with weekday, role, unit,
the generator's operational reason, who is eligible now, when it was last announced), and the notifications.
After this prompt there is no second place that decides what "open" means.

**Why it is open (Prompt 13 part 4).** Accept & Publish, once the CAS write of the generated days succeeded, stores
`helpers.lastGenerateFromDiagnostics(diagnostics, at)` as blob key `call_schedule_data.data.lastGenerate =
{ at, range: { start, end }, openSlots: [{ day, role, reason }], weekendKinds: { '<friday>': 'block'|'split'|'daily' } }`
(next to `lastPublished`: in the state bundle, read back by `adoptBlob`, kept across every autosave). Nothing else from
the diagnostics is persisted. Each `reason` is `helpers.openSlotReason(reasonsById)` — the per-surgeon hard codes of
`diagnostics.uncovered[i].reasons` reduced by PREFIX to a fixed category table (`vacations`; `weekday patterns and
stated availability`; `East feed busy`; `East-derived week`; `caps reached`; `already on call that day`;
`holiday opt-outs`; `backup opt-outs`; `locks`; unknown codes `other rules`), unioned across surgeons and rendered as
`no eligible surgeon - vacations, caps reached` (`no eligible surgeon` when nothing applies). The generator's two
placeholders (`eligible-but-not-placed`, `holiday-unit:eligible-but-unit-not-filled` — someone WAS eligible, the
generator still left the slot open) never read as a rules outcome: they render the fixed sentence `generator could not
place - report it`, with the other surgeons' categories in parentheses when there are any. The blob is anon-readable,
so the sentence never carries an id, a name, a date or free text from the diagnostics — never a name-plus-reason pair.
`rules.HARD_REASONS` exports the vocabulary as data and `test/open-shifts.test.js` renders every code through the
importer's denylist gate (`impRefuseNoteDenylist`, Prompt 12 F) and pins the fixture `test/fixtures/last-generate-diagnostics.json`;
the Playwright smoke reads the recorded blob write after Accept & Publish and checks the same. The board's Why column and
unit patterns read this record, and a live preview overlays the slots and weekends it covers (rendered through the same
`openSlotReason`). **Merge across runs (P13R (e), 9/23):** `lastGenerateFromDiagnostics(diagnostics, atIso, previous)`
records the run facts too — `mode` (`generate` | `fill-open-only`, item T) and `fixedSlots` — and inside the newest run's
range its reasons and weekend kinds replace the earlier ones; slots and weekends OUTSIDE that range keep the earlier
record's entries, and the record then carries `carriedFrom` = that earlier record's `at` (so an October fill-open-only
backfill, or item AB's first-open default start, never erases the November–January reasons). The board's
`openshifts-lastgen` line shows mode, fixed count, range and the carried note (`no generate recorded yet` before the
first Accept). Accept & Publish passes the previous record (`acceptMerged`); the fixture and the smoke pin the shape.

### 16.2 The claim boundary

**Any surgeon may claim** an open slot ("Take this shift"): the client offers the button only when `eligibility()`
passes the hard rules (soft-rule warnings are shown, not blocking); the write goes through a security-definer
`claim_open_slot(day, role)` that guards data integrity (open, unlocked, not past, not external-covered, distinct roles,
no vacation conflict, inside the published range), logs `schedule.claim`, and adds an in-app feed row. The scheduler
assigns from the day editor as before, or writes in outside cover.

**The claim boundary (Prompt 13 part 2).** The JS eligibility rules (OR days, Clinton/Aledo days, caps, weekday
patterns, consecutive runs, East busy days, holiday opt-outs) are enforced in the client before the "Take this shift"
button is offered - `eligibility()` must pass the hard rules; soft-rule warnings are shown, not blocking - and NOT in
SQL. `claim_open_slot(p_day, p_role)` guards data integrity only: linked caller, valid role, not past in Central time,
inside the published range (`min(day)..max(day)` of `schedule_days`), open, not external-covered for primary,
unlocked, distinct roles, no vacation conflict (including the day before a primary shift), each refusal with its own
SQLSTATE `CL001`-`CL009` and a token-prefixed message that part 3 surfaces verbatim (`describeDbError` passes
`ON_CALL_CONFLICT` / `TRADE_*` / `CLAIM_*` through; `shift_claimed` is in the notification `tabMap`) - and it logs
everything (`audit_log` `schedule.claim`, `notifications` `shift_claimed`) in the same transaction as the
`version + 1` write. The client never writes `schedule_days`, the audit row or the feed row for a claim itself; it
logs `schedule.claim` only with `outcome: "failed"` when the function refused. For six surgeons that is the accepted
boundary: a claim that slips past a client rule is visible in the audit log and the feed, and the scheduler corrects it
from the day editor, which is untouched. **Decided (P13R, 9/23 — the rebase onto the Prompt 12 head):** a claim sets `source = 'claim'` and no lock flag, and
the generator treats a row whose source is `claim` or `trade` (`generator.GEN_PERSON_FIXED_SOURCES` — the two
sources a surgeon writes for himself, neither path sets a lock) as **fixed in both modes exactly like a lock**: every
held role of that day stays byte-identical, counts in `diagnostics.fixedSlots`, and its rule conflicts are facts in
`diagnostics.fixedViolations` — a claim is never silently discarded by a later Generate. `manual` is not in the set:
the day editor has its own lock toggle, so an unlocked manual slot stays regenerable. **A scheduler edit of a
claimed / traded day keeps its source (P13R-2 review fix, 9/23)** while any role the day held before still has the same
holder: a note, a lock toggle, or "Assign..." on the open partner role from the board leave `source = claim` /
`trade` in place (`saveDayEdit` `keepPersonSource`), so the claimer's unlocked slot never becomes a regenerable
`manual` one behind his back; only when every held role changes hands or is cleared does the row become `manual` — the
scheduler's explicit replacement, audited (`schedule.day_edit`) and mailed (`manual_edit`) to every holder involved.
**Known limitation (row-level fixing):** `schedule_days.source` is one fact per DAY, so on a claimed day the OTHER
role is fixed too — a generated fill of the partner role (or a scheduler's later Assign there) stays put on every
later Generate, and the published row keeps `source = claim` for that generated holder. Conservative on purpose
(nothing on a claimed day moves; conflicts are facts in `fixedViolations`); role-level precision needs the claimed
role recorded (a `claimed_roles` column, or a role-suffixed source such as `claim:backup`) — a schema change, open
for Faraz. To hand a claimed day back to the generator the scheduler clears or replaces every holder on it (source
`manual`) and regenerates. Pinned in `test/generator-regression.js` (fixture `test/fixtures/claim-fixed-2026-10.json`,
plus the unlocked-partner run) and `test/open-shifts.test.js` (the SQL-to-generator contract and the `saveDayEdit`
source rule); `docs/SCHEMA-REVIEW.md` review note 5 is closed. Definition in `sql/schema.sql`
right after `apply_trade()`, applied live only through `sql/migrations/2026-09-22-claim-open-slot.sql` (never by a
git push), proven by the rolled-back `sql/probes/claim-open-slot-probe.sql` and `scripts/verify-rls.sh` section 7
(`docs/SCHEMA-REVIEW.md`).

### 16.3 The three notification paths

**The group is told** on Accept & Publish when open
slots remain (`send-notification` category `open_shifts`, honouring `schedule_updates_email`), on demand from the board
("Email the group now", logged as `openshifts.notify`), and — once the job of 16.4 exists (not yet, 2026-09-23) — every **Monday 07:00 Central** (12:00 UTC: 07:00 CDT /
06:00 CST, see 16.4) while any open slot lies in
the next 30 days (`daily-reminder` mode `open-shifts`, cron job `silvis-open-shifts-weekly`, Vault secret like the
others). Reasons persisted in `call_schedule_data.data.lastGenerate` are operational wording only (anon-readable blob).

The three paths, and the message that follows a claim, in detail (Prompt 13 part 5):

1. **On Accept & Publish (5a).** The notice is a property of Accept & Publish, not of the office e-mail: Accept arms it
   once the generated days are on file; it goes out after the office publish POST succeeded (on Send), or once on Skip /
   closing the publish dialog. The client computes `openSlots` over the schedule ON FILE from today to the last
   contiguous published day; nothing goes out when the range is fully covered. Otherwise it writes one `notifications`
   row (type `open_shifts`, title = the subject `N open shifts through M/D`, `data.slots = [{ day, role }]`,
   `data.through`, `data.origin: "publish"`), then POSTs `send-notification` category `open_shifts` as a **broadcast** (no
   `targetIds`; the function resolves every linked account and gates each recipient on `schedule_updates_email`; frame
   title "Open Shifts", call to action "Open shifts"), then logs `openshifts.notify` with
   `{ count, through, origin, slots, email: "sent N" | "not enabled" | "failed" }`. The message is the Copy-list lines
   grouped under `Week of Mon M/D:` headings; the detail line is the deep link `Take this shift: <app>#openshifts`. A
   failure is reported in the Published toast and never undoes the publish; the board's button is the retry.
2. **On demand (5b).** "Email the group now" on the board (scheduler only) opens a confirm dialog with a **Preview** of
   the subject, the week-grouped list and the deep link, writes nothing until Send, then runs the same three writes with
   `origin: "board"`. The board's "last announced" column reads the most recent `open_shifts` feed row whose
   `data.slots` contains that day + role (the rows are fetched auth-only when the board opens; a fresh session reads
   `never` until the first notice).
3. **Monday cron (5c).** `daily-reminder` with body `{"mode":"open-shifts"}`, behind the same `x-cron-secret` gate and
   `dryRun` contract as the hourly reminder (an unknown mode is a 400, an absent mode is the hourly reminder, unchanged).
   It reads `schedule_days` for `[today, today+30]` in Central time, computes the open slots with the TypeScript mirror
   of `openSlots` (pinned to the same fixture by `test/open-shifts.test.js`), answers `200 { open: 0, sent: 0 }` when
   nothing is open, else e-mails every linked surgeon whose `schedule_updates_email` is not false (addresses from
   `user_profiles` via the service role, results keyed by `person_id` only) and inserts the `notifications` row
   `{ type: 'open_shifts', data: { slots, through, source: 'cron' } }` that "last announced" reads. `dryRun` composes,
   sends nothing and writes no feed row. A day WITHOUT a `schedule_days` row is never announced by the cron: it is not
   published and `claim_open_slot` refuses it. The job is `silvis-open-shifts-weekly` (16.4).
4. **After a claim (5d).** The in-app feed row (`shift_claimed`, title `<Name> took <M/D> <role>`) comes from the SQL
   function. The client then sends `send-notification` category `shift_claimed` to the scheduler(s) (roles
   `scheduler` / `admin`, looked up, never hardcoded) plus the claimer - `targetIds`, never a broadcast. The office learns
   of it through the existing weekly digest diff.

Preferences and the feed: all four categories (`open_shifts`, `shift_claimed`, alongside `schedule_published` and
`manual_edit`) ride the one preference `schedule_updates_email` ("Schedule published / changes affecting me" in
Settings); a missing preference row means on. In the feed, `open_shifts` rows show to everyone and open the Open shifts
tab when tapped (`tabMap` `open_shifts` → `openshifts`); `shift_claimed` rows reach the claimer (`data.surgeon_id`) and
the scheduler, who sees everything, and open the calendar. No message on any path carries an address, an id-plus-reason
pair or free text from the diagnostics: subjects and lines are built from `openSlotsLine` and the fixed reason
categories of 16.1 (`test/fixtures/open-shifts-email.json` pins the composition for the client and the function alike).

### 16.4 The cron job

Pasted once in the SQL editor by Faraz, after the secret is in Vault and `daily-reminder` is deployed (order: secret →
function → cron, so nothing ever runs ungated). `12:00 UTC` = Monday 07:00 CDT / 06:00 CST. Verbatim, as in
`edge-functions/README.md` section 4 next to the other two jobs:

```sql
select cron.schedule('silvis-open-shifts-weekly', '0 12 * * 1', $$
  select net.http_post(
    url := 'https://bzhsroegtagqhutbnsrp.supabase.co/functions/v1/daily-reminder',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',
      coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'silvis_cron_secret' limit 1), 'unset')),
    body := '{"mode":"open-shifts"}'::jsonb);
$$);

select jobid, jobname, schedule, active from cron.job;                 -- expect three rows after this block (two exist today; this statement creates the third)
```

The secret is read from Vault (`vault.create_secret('<value>', 'silvis_cron_secret')` once; the other two live jobs read
it the same way since 9/22), so `cron.job.command` holds only the lookup. Proof after the deploy: one `dryRun` POST
(`{"mode":"open-shifts","dryRun":true}`) through pg_net or curl with the 200 body quoted; the function answers
`{ open: 0, sent: 0 }` when nothing in the window is open, so the job is safe to leave running. Rotation and the
fail-closed 401 behaviour are in the README (section 4, Notes).

### 16.5 What is NOT automatic

A `git push` to `main` redeploys the PWA and nothing else. Everything below is done by hand, in this order, and each
step is proven by observing it (a real row, a quoted 200 body, a byte-diff) — never assumed:

1. **Schema:** `sql/migrations/2026-09-22-claim-open-slot.sql` pasted in the SQL editor (report-first; `sql/schema.sql`
   carries the identical text and `test/schema.test.js` pins the identity). Proven by the rolled-back
   `sql/probes/claim-open-slot-probe.sql` and `scripts/verify-rls.sh` section 7 (anon refused; the nine refusals; a
   linked surgeon's claim succeeds inside the probe and rolls back; leftover count 0).
2. **Deploys:** `send-notification` (the two new categories) and `daily-reminder` (mode `open-shifts`) redeployed with
   the Supabase CLI `--no-verify-jwt` (README section 3), the deployed source downloaded and byte-compared with the repo
   copy afterwards. A dashboard deploy would re-enable Verify JWT — always the CLI.
3. **Vault secret + cron job:** `vault.create_secret` once, then the `cron.schedule` of 16.4; `select ... from cron.job`
   must show three rows. Not before Faraz has approved live mail (README section 6): from then on the Monday notice is a
   real send to every opted-in surgeon whenever anything in the next 30 days is open.
4. **Live mail on the client paths** needs step 2 plus `RESEND_API_KEY` / `NOTIFICATION_FROM_EMAIL` set by name. Until
   `send-notification` is redeployed, the live function answers `400 unknown notification type` for `open_shifts` /
   `shift_claimed`; the client treats that as `notEnabled` — an INFO toast ("the e-mail for this notice is not enabled
   yet"), never an error — and still writes the feed row and the audit row, so the in-app list is complete either way.

Nothing in Prompt 13 publishes a schedule, and no part of it sends mail on its own before steps 2–3 are done.

## 17. Offers — paint the dates you'll cover; the generator fills the gaps (Faraz 9/22 evening; Prompt 14)

*Status 2026-09-23 (overnight review; corrected by the 9/23 audit): the DATA part is live — `call_periods` (incl. the
`offer_modes` column, confirmed by a column probe 9/23 although the branch delivery note said it was pending), `call_offers`,
`offer_status()` and the OF001–OF003 triggers, applied from three `feat/offers` files: `sql/migrations/2026-09-22-offers-periods.sql`
(9/22 15:15), `2026-09-23-offer-modes.sql` and `2026-09-23-claim-offer.sql` (9/23; rolled-back probes A–K and the claim probe
A–L green per `docs/STATUS-2026-09-23.md` — not re-verifiable by an anon read, the tables being authenticated-read only). Both
tables were empty at the 9/23 probes; nothing on `main` reads them, and the only writer reachable from `main` is the live
`claim_open_slot` (the Open shifts board's "Take this shift", `index-source.html` ~3908): a claim by a surgeon who is not
rules-only for the period upserts one `call_offers` row. The painter RPCs (`2026-09-23-offer-mode-rpc.sql`), the rules/generator
changes, the painter UI, the seed period and the offers cron are on `feat/offers` — local, unmerged, not deployed (its head at
review time was `19d4094` "Offers part 5"; trust `git log feat/offers` over this line). Until the merge, `sql/schema.sql` and
`docs/SCHEMA-REVIEW.md` on `main` lag the live database by those objects — use `feat/offers:sql/schema.sql` for a schema
review, and add the applied-migration rows to `docs/SCHEMA-REVIEW.md` and the schema table of §4.2 when it merges.
Nothing below is in the live app; read the section as the specification.*

Silvis is an **offers** problem where Davenport is a rules problem: the schedule has always been assembled from the
days each surgeon emails in, relayed through whoever is collecting them and retyped by the ER-panel author. From Prompt 14 the
app is where offers live. **Surgeons may enter offers for any future date, whenever they like** (`call_offers`, one row
per person and day, primary / backup / either). A **period** (default 3 months, preset 6; `groupRules.offerPeriods`)
is the generation window: the days inside the next period **freeze six weeks before the current period ends** (= six
weeks before the next one starts; `offers_close_at`, editable per period), the schedule is due four weeks before
(`publish_by`), and reminders go out 14 and 3 days before the freeze to anyone with nothing entered for that period who
has not chosen **"go by my rules"**. Status per surgeon per period is derived, never typed: submitted / rules-only /
not started. A daily cron mode (`daily-reminder` mode `offers`, job `silvis-offers-daily`, Vault secret like the
others) sends the reminders and the close summary; it never generates or publishes.

**Entry is phone-first, modelled on Davenport's Paint Month sheet:** a full-screen vertical day list (one tall row per
day, month navigation forward without limit), brushes Primary / Backup / Either / Clear, tap to paint, tap-start /
tap-end for a range, greyed rows that say why a day cannot be offered (past, your vacation, East busy, your derived
week, outside your window, frozen), what is already published that day and how many others offered it, a running count
against the person's cap, drafts kept locally and **one Save = one batch write + one audit entry**, a failed save that
writes nothing. A paste-a-date-list box remains for typists.

**Eligibility becomes offers-first, at the hardness each surgeon chooses:** when submitting, a surgeon picks "only
these days" (exhaustive — eligible only on offered days in the offered role) or "my preferred days; use my rules to
fill gaps" (preferred, the default — offered days first with a strong bonus; a non-offered day only under their
ordinary rules, with a strong penalty, when the slot would otherwise stay open, and every such placement is named in
their publish email). Vacations, East busy days, derived-week locks, holiday opt-outs and caps apply either way; a
rules-only or silent surgeon is scheduled by the existing rules. This is the answer to the Tue/Thu gap (rules doc §8
item 12): Acton's and Philip's rules allow those days even when their lists do not name them. The generator places offers before anything else (an offer is not a
demand — fairness and caps still decide, and unplaced offers are reported per surgeon), fills the remaining slots from
rules-only surgeons, then repairs and smooths as before; whatever stays open goes to the open-shifts board (§16), and a
claim is an offer made on the spot. Every dated list in the seed (Burchett's October/December, Acton's October/November,
Burchett's November, Philip's weeks, Fierce's single days) is migrated into `call_offers` (`source: email-relay`) so
there is one mechanism, not two; recurring patterns, derived weeks and windows stay rules. the ER-panel author's Word document
is **retired at go-live** (Faraz 9/22 evening): the app is the source of truth; the ER-panel author keeps a viewer account, the weekly
office digest and the ER Call Panels export for a paper copy. Published assignments remain locks.

## 18. East vacations — the person's Davenport time off, reviewed away / home (Faraz 9/22 evening; Prompt 15, built 2026-09-23)

*Status 2026-09-23: merged to `main` (branch `feat/east-vacations`, head `19b9efc`) and live on Pages since build `2026.09.23g`
(`23efd7f`, built from that commit; every later build carries it — trust `version.json`). `east_vacation_reviews` was applied
04:37 (§18.5; leftover 0 at apply time). The East feed has NOT been refreshed since the deploy (newest `east_feed.fetched_at`
2026-09-22 05:54 UTC, no `data.vacations` key in any cached week — anon probe 9/23), so no Davenport vacation is cached and
nothing derived is in force: Setup → East feed → Refresh from Davenport is the first live step (§18.5 item 6).*

Faraz: *"there are days where I am on vacation at East, where we are not going anywhere, and I can cover call at
Silvis."* So the East feed mirrors his Davenport vacations into Silvis and **nothing is mirrored blindly**: each range
is **unreviewed** until he decides **away** (also off at Silvis) or **home** (available at Silvis — and his best Silvis
days, because a Davenport vacation day has no East call and no OR block). A generic `eastFeed` feature for any roster
surgeon with an East code (matched by roster **code** through the Davenport roster blob, never by a Davenport id);
only Khan (FAK) has one today. Rules-doc text: `SILVIS-CALL-RULES.md` §3 Khan (the 9/22 evening entry).

### 18.1 The pipeline (three parts, delivered on branch `feat/east-vacations`, merged)

| part | what | where |
|---|---|---|
| 1 (E1) | *Refresh from Davenport* also reads the Davenport `time_off` table ([removed]; path **1a**, no paste box, no Davenport change) for the codes of every surgeon whose East feature reads busy days, `kind = vacation` only, and caches the ranges per published week in the `east_feed` payload `data.vacations: [{ code, start, end }]`; a range beyond the published weeks rides on the latest cached week; a failed `time_off` read keeps the cache and says so. Details in §7 (the *East vacations* bullet). | `east-feed.js` (`fetchEastWeeks(from, to, { vacationCodes })`, `planVacationCache`, `eastVacations(rows, code)`), `refreshEastFeed` in `index-source.html` |
| 2 (E2) | The review table **`east_vacation_reviews`** (`person_id text`, `"start" date`, `"end" date`, `decision check in ('away','home')`, `decided_at`, `decided_by`, `unique (person_id, "start", "end")`; RLS read all authenticated — **no anon policy** — write own rows or scheduler/admin) as a migration (**applied live 2026-09-23 04:37**; observed strings in the schema review) + self-rolling-back probe + `verify-rls.sh` section 9 (`docs/SCHEMA-REVIEW.md`, section *2026-09-23 - east_vacation_reviews*). `rules.js` derives the consequences: `buildContext` inputs `eastVacationRanges { rosterId: [{ start, end }] }` + `eastVacationReviews` (rows); **unreviewed and away = a derived vacation** (every day joins `P.vacation` — the same hard codes `time-off:<date>` for both roles and `day-before-vacation` for primary, so the generator, the day editor, the claim gate and the open-shifts eligibility all see it; `res.eastVacation = 'away' \| 'unreviewed'` for the gloss); **home = `eastClear`** (a dated availability for both roles: the weekday-pattern family incl. `hardNeverWeekdays` is lifted, no `east-unknown`, a primary-only soft bonus `{ east-clear, -weights.eastClear }`, default 2, Setup-editable; `res.eastClear = true`); the published feed wins over home with a `ctx.warnings` line; `eastVacationConflicts(ctx, schedule?)` mirrors the `time_off` trigger for the derived ranges (report only). `helpers.js` `reviewStateFor(range, reviews, personId)` / `derivedEastVacations(ranges, reviews, personId)` — **person-scoped**: another surgeon's row never decides a range and is never listed stale. | `sql/migrations/2026-09-23-east-vacation-reviews.sql`, `sql/schema.sql` rev. d, `sql/probes/east-vacation-reviews-probe.sql`, `scripts/verify-rls.sh` §9, `rules.js`, `helpers.js`, `generator.js` (`diagnostics.eastVacations`) |
| 3 (E3) | The UI: the review controls, the markers, the strip count, the lists, the write path, the refresh resets — this section. | `index-source.html`, `app-styles.js`, `test/ui/smoke.mjs`, `test/data-layer.test.js` |

**No `time_off` row is ever written for an East vacation.** A change of mind is one row in `east_vacation_reviews` (or
its deletion) and leaves no orphans; the Silvis vacation form and its trigger are untouched. **Client-side only
(known, documented):** `rpc/claim_open_slot` (`CL009`), `apply_trade`'s vacation check and the `time_off` trigger read
`time_off` rows only, so a direct REST claim or a stale PWA that passes no East inputs is not stopped by the database;
the client gate (`eligibility`) enforces the derived vacation. Extending `CL009` to read the feed + the reviews is a
possible later migration.

### 18.2 The review step in the app (E3)

- **Loading.** `east_vacation_reviews` is authenticated-read only, so the app reads it with `readAuthOnlyTable`
  (`loadEastVacationReviews`, at start and in the 60-s poll): no fresh token → not read, the last list is kept
  (state `skipped`); an HTTP 404 → state `missing` (the table is missing — a stale-project guard now that the migration went live 2026-09-23 04:37; the panel banner says so and a
  save attempt refuses with a toast; the start-up load itself does **not** toast a 404 to every signed-in user — review
  fix); any other failure → `failed` with a toast. In every non-`ok` state a range without a row still reads
  **unreviewed = away** (the conservative default the rules apply), and the panel names why the decisions are missing.
- **One picture, one component.** `eastVacPeople` = per surgeon for whom **`eastVacationPerson(s, ef)`** holds — the one
  predicate (the East feature reads busy days, i.e. `eastBlocksPrimary || eastBlocksBackup`, a roster code, not an
  outside surgeon) that also decides the ctx input `eastVacationRanges` and the refresh's `vacationCodes`, so the rules
  never derive a vacation the UI has no control for (a derived-weeks-only feature such as Fierce's has none):
  `derivedEastVacations(eastVacations(eastFeedRows, code), reviewRows, rosterId)`
  → `ranges` with `state` / `review` and the person's `stale` rows. Empty in public mode (the reviews are never loaded
  there, so every state would read unreviewed — the public calendar draws no East-vacation marker, legend or strip item).
  `EastVacationList` renders it in **three places** —
  Setup → East feed (card *East vacations (Davenport time off, reviewed here)*, `data-testid="eastvac-card"`), the
  person's own **Time off** view (`eastvac-timeoff`; the scheduler sees every East person) and **My schedule**
  (`mine-eastvac`) — each range as a row (`eastvac-range-<id>-<start>`, `data-state`) with a tappable three-way
  control `Unreviewed | Away | Home` (`eastvac-set-<state>`, `aria-pressed` = the state, ≥ 32 px, the active segment
  white on its tone in both themes — `app-styles.js` `eastVacSegStyle`), the decision's time and author, a *show past*
  toggle, and (in the Setup card) the conflicts list `eastvac-conflicts` = `rules.eastVacationConflicts(rulesCtx)`:
  published days the person holds inside an unreviewed / away range (and a published primary the day before one),
  each opening the day editor — a report, never a block on a lock. Read-only text instead of the control when the
  viewer may not decide (the RLS mirrored: own rows or the scheduler).
- **The write path — `saveEastVacationReview(personId, { start, end }, decision, opts)`**, the only writer. `away` /
  `home` → `POST /rest/v1/east_vacation_reviews?on_conflict=person_id,start,end` with `Prefer:
  resolution=merge-duplicates,return=representation` and `{ person_id, start, end, decision, decided_at, decided_by }`
  (the primary key is `id`, so the upsert must name the unique triple); an empty representation is a **refused save**
  (RLS no-op), never success. `unreviewed` (a change of mind, or the refresh's reset) → `DELETE ...?person_id=eq.
  &start=eq.&end=eq.` with `return=representation`, the count recorded. Every mutation uses `dbAuthHeaders()`. After a
  successful write the rows are re-read (the picture, the rules ctx and every list rebuild), **one audit row
  `eastvac.review`** `{ person_id, start, end, decision: 'away' | 'home' | 'reset', reason, removed? }` is logged,
  and a `home` decision calls `offerEitherForHomeRange(personId, range)`.
- **The `home` → `either` offers step (Prompt 14).** With the offers painter present a home decision offers to paint
  the range's days as `either` offers in one tap (a confirm sheet listing the dates; `call_offers` rows inserted the
  normal way). Prompt 14's painter is on another branch tonight, so the hook is a **documented no-op**
  (`console.info`, returns `{ ok: true, offered: 0, pending: "prompt-14" }`, `TODO(Prompt 14 UI wave)`); the review itself is saved either
  way, and nothing in this delivery writes `call_offers` (data-layer pin + smoke).
- **Refresh resets.** After *Refresh from Davenport* caches the new lists and **re-reads the cache** (`loadEastTables`
  hands the `east_feed` rows back), for each East person whose code was read:
  `derivedEastVacations(eastVacations(cacheRows, CODE), reviewRows, rosterId).stale` — computed against the **reloaded
  cache picture** (the same merged list the panel, the ctx and the markers show), never the raw fetched list: a
  kept-unseen cached range adjacent to a fetched one is joined in the cache, the review is saved on the joined range,
  and the raw list would have reset it on every refresh (review fix). A row that matches no current range
  exactly is **`changed`** (it still overlaps a current range: the dates moved) or **`removed`** (gone from Davenport);
  rows whose `end` lies before the read's lower bound (`from` = today − 28 days) are kept, exactly as the cache keeps
  those ranges; a failed `time_off` read or a failed cache reload resets nothing. Each stale row is deleted through
  `saveEastVacationReview(..., "unreviewed", { quiet: true, reason })` — `quiet` silences that function's own toasts, so
  the resets are audited like any reset and the **one final refresh toast** names them
  ("East vacation review(s) reset: 3/2-3/6 (was home; dates changed), 4/10-4/12 (was away; removed from
  Davenport).") or the failure ("could NOT reset ... - delete the row by hand", tone error); the `east.refresh` audit row
  carries `reviewResets` / `reviewResetFailures`. A range already reviewed and unchanged keeps its decision.

### 18.3 Where it shows

- **Calendar day cells:** an East-vacation **marker** beside the vacation dots — a small diamond, distinct from the
  round Silvis dot, in the review state (`app-styles.js` `eastVacMarkStyle(state, dark, personColor)`: unreviewed =
  dashed amber outline, away = solid outline in the person's colour, home = filled green; `data-eastvac="<id>"`,
  `data-eastvac-state`); the legend explains the three; the cell title names "East vacation: Khan (unreviewed)". The
  marker is **per day from the rules ctx** when it is available (the same picture the day editor shows): unreviewed /
  away from `P.eastVacationDays`, home from `P.eastClear`; a home day the East feed says busy keeps the home diamond
  with `data-eastvac-feedbusy="1"` and a title saying the feed wins; a Silvis `time_off` day inside a range carries no
  East marker (the Silvis dot stands, as the day editor shows no East line there); without a ctx the range state is
  drawn as is. Nothing is drawn in public mode.
- **Day editor:** `eastStatusLines` adds the person's line — *East (Davenport) vacation, unreviewed - treated as a
  Silvis vacation until decided*, *... home - available at Silvis: no East call, Tue/Thu rule lifted, preferred as
  primary*, or *... starts tomorrow - primary blocked (07:00 handoff)* — with the marker and `data-eastvac=<state>`;
  the *Not eligible* list glosses a `time-off:` / `day-before-vacation` reason with "(East vacation, unreviewed - decide
  it in Setup > East feed or Time off)"; `east-clear` reads "home East vacation day (no East call, no OR block -
  preferred as primary)" among the soft tags.
- **Coverage strip:** `unreviewed East vacations: N (Khan)` (`cov-eastvac-unreviewed`, `data-count`) = the person's
  upcoming ranges without a row (any horizon, not the 60-day window); it opens the place where the decision is made —
  the scheduler's Setup → East feed (the card forced open) or the person's own Time off view. Rendered for the
  **scheduler and the person with the East code only** (another surgeon's or the viewer's Time off view has no East
  card, so the item would be a dead end); hidden in public mode and when nobody has an East code.
- **My schedule:** the card *My East (Davenport) vacations (N unreviewed)* with the list, and an **EV** badge on a held
  day inside the person's own East vacation (the locked Thanksgiving unit case: [range] unreviewed lists his four
  held days until he marks the range home) or on a home day.
- **Time off view:** the same list for the person with the East code (the scheduler: every East person) beside his
  Silvis vacations — nothing is entered there and no Silvis row is written.
- **Untouched on purpose:** the office digest, the daily reminder and the ER Call Panels export show assignments, not
  availability (data-layer pin).

### 18.4 Proof

- `test/rules.test.js` (part 2): unreviewed / away range → ineligible both roles + the trailing edge; home → eligible,
  Tue/Thu lifted, the primary bonus; the feed wins over home with a warning; the helpers are person-scoped and equal to
  the ctx's decision. `test/east-feed.test.js` (part 1): the payload key, the ride-on host, the whole-cache rewrite.
  `test/schema.test.js`: the migration = `schema.sql`, columns, constraints, the four policies, no anon policy.
- `test/data-layer.test.js` `[P15]` (part 3): the ctx inputs keyed by roster id from `eastVacations(rows, code)`; the
  reviews read through `readAuthOnlyTable` (never `db.query`), 404 → `missing`, start + poll; the write path (upsert on
  the triple, merge-duplicates + representation checked, the exact-triple delete, `dbAuthHeaders()` only, one audit
  action, own-or-scheduler); the no-op hook with its TODO and no `call_offers` write; the refresh reset through the
  person-scoped `stale` list with the `end >= from` guard and the toast wording; every place it shows; the digest / ER
  export / daily reminder untouched; the marker styles (dashed / hollow / filled diamond, 3:1 outlines in both themes)
  and the segment tones (flat gradient, white text ≥ 4.5:1). Fix-round pins: the one predicate `eastVacationPerson` in
  all three places; the stale list from the reloaded cache (`eastVacations(cacheRows, code)`, never the raw list); the
  quiet toasts and the un-toasted start-up 404; the public-mode guard and the strip's render condition; the per-day
  marker from the ctx (`P.eastVacationDays` / `P.eastClear` / `feedBusy` / the Silvis time_off skip).
- `test/ui/smoke.mjs` (part 3): the harness overlays three FAK ranges on the newest cached `east_feed` row (every live
  `data.vacations` list stripped first), serves `east_vacation_reviews` from an in-harness store (one away, one home;
  the third unreviewed) and answers the mocked Davenport `time_off` with the same rows, then reads the panel, drives the
  three controls (the POST / DELETE shapes, the audit rows, no `time_off` and no `call_offers` write), the conflicts
  list, the markers on three days (dashed / hollow / filled, no Silvis dot), the day editor lines and glosses (Khan
  ineligible on the unreviewed Tuesday, **eligible** on the home Tuesday), the strip count and its click (the card's
  collapse flag set to `0` first, so the click is what opens it), My schedule and the Time off list, and — fix round —
  the **refresh-reset path**: the first Refresh (unchanged ranges) issues no `east_vacation_reviews` DELETE; a second
  Refresh whose mocked Davenport answer moved one range and dropped another issues exactly two DELETEs by the old
  triples, two `eastvac.review` reset audits (reason `changed` / `removed`, `removed: 1`), names both in the toast and
  keeps the unchanged range's row; screenshots `eastvac-panel.png`, `eastvac-panel-390.png`, `eastvac-panel-dark.png`,
  `eastvac-panel-390-dark.png`, `calendar-eastvac-2027-04.png`, `mine-eastvac.png` — written to **`test/ui/out/`**, which
  is **gitignored**; nothing was copied into `docs/screenshots/` in this delivery, as of `19b9efc` (part 4 added no binaries — a
  `docs/screenshots/east-vacations/` copy of the six files is a one-line follow-up). The files of the 2026-09-23 07:15
  run are on disk (43 / 41 / 44 / 41 / 106 / 137 KB).
- **`scripts/verify-rls.sh` section 9** (part 2; before the migration 9a / 9b accept the 404 by name, while 9c — linked
  CLI only — prints two *expected* FAIL lines, "no sentinel-terminated PROBE_RESULTS" and "leftover count could not be
  read (table missing before the migration is expected)", so the RESULT line is red by exactly those two until the
  migration is applied; after it every section-9 line is PASS):
  **9a** anon `GET /rest/v1/east_vacation_reviews?select=person_id,start,end,decision&limit=5` → after the migration
  `HTTP 200` with the body exactly `[]` (no anon policy — the silent Davenport-lesson shape, so the script checks for an
  *empty* body and a non-empty one is FAIL); before it `HTTP 404`, accepted by name ("not created yet - apply the
  migration"). **9b** anon `POST` → `401`/`403` (`404` before). **9c** (linked CLI only) runs
  `sql/probes/east-vacation-reviews-probe.sql` — one batch, fixtures in 2030-05 with `decided_by = 'probe-eastvac'`, two
  throwaway `auth.users` `probe-eastvac-<uuid>@example.test` linked to `s3`/surgeon and `s1`/scheduler — and grades the
  sentinel-terminated `PROBE_RESULTS ...;END` string case by case: A1 `rows=0`, A2 `ERR 42501`, B `ok visible=3`,
  C `ERR 42501`, D `updated=0 decision=home`, E `deleted=0`, F `updated=1 decision=home`, G `updated=1 decision=away
  deleted=1`, H `ERR 23514`, I `ERR 23505`, J `ERR 23514` (the SQLSTATE and the `=`-values, never the message text);
  before the migration the probe's setup raises `PROBE_SETUP` and 9c reports "no sentinel". Then the rollback is
  **observed**, never assumed: a `leftover` count over `east_vacation_reviews where decided_by = 'probe-eastvac'` plus
  `auth.users where email like 'probe-eastvac-%@example.test'` must be `0`; a non-zero count prints the two clean-up
  deletes and fails. **9d** (only with `SILVIS_SURGEON_JWT`, none exists until invites go out) a linked surgeon's REST
  read → `200` + an array; read-only — a REST write there would be a real decision. `docs/SCHEMA-REVIEW.md` (section
  *2026-09-23 - east_vacation_reviews*) holds the full expected string and the *Observed* placeholders the orchestrator
  fills.
- `test/data-layer.test.js` `[P15]` docs pins (part 4): the §18 sub-headings, the 4.2 / 4.3 rows, the rules doc's final
  Khan wording and its §8 item, the ONBOARDING paragraph, the edge-functions README's "nothing deployed" statement, the
  prompt's delivery note, and no address-shaped string in any of them.

### 18.5 Live steps and open questions

**Live steps (DONE 2026-09-23 04:37 by the orchestrator via the linked CLI, under Faraz's mandate; the only database change of this prompt — report-first is
the `docs/SCHEMA-REVIEW.md` section; `<dir>` = the workdir linked with `supabase link --project-ref bzhsroegtagqhutbnsrp`,
`<abs>` = the absolute repo path):**

1. Before: `SILVIS_WORKDIR=<dir> bash scripts/verify-rls.sh` — section 9 reads 9a `HTTP 404` (PASS, named), 9b `404`
   blocked (PASS) and, with the CLI linked, the two expected FAIL lines from 9c ("no sentinel", "leftover count could
   not be read ... table missing before the migration is expected"): the RESULT line is red by exactly those two until
   step 2. Nothing else in the script changes.
2. Apply: `supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-23-east-vacation-reviews.sql` —
   idempotent; one table, one index, RLS on, four policies; touches no existing table, row, policy or function. **Done 2026-09-23 04:37:**
   `pg_policies` → 4 rows, all `{authenticated}` (`_read` SELECT, `_self_insert`, `_self_update`, `_self_delete`), `relrowsecurity` true.
3. Probe: `supabase db query --linked --workdir <dir> -f <abs>/sql/probes/east-vacation-reviews-probe.sql` — paste the
   `PROBE_RESULTS ...;END` string verbatim into the *Observed* block of `docs/SCHEMA-REVIEW.md`; then the leftover
   query printed there (`... ::int as leftover`) — must be `0`. **Done:** the verbatim string is in that *Observed* block (every case
   as expected); leftover `0`; the table is empty.
4. After: `SILVIS_WORKDIR=<dir> bash scripts/verify-rls.sh` — 9a `HTTP 200` + `[]`, 9b `401`/`403`, 9c every case
   graded + leftover `0`; record the 9a, 9b and RESULT lines in the same *Observed* block and turn its status line from
   PREPARED to APPLIED. **Done in part:** 9a observed `HTTP 200` + `[]` and the status line reads APPLIED with the strings; the
   9b and RESULT lines of the after-run were not handed over — paste them on the next run.
5. Nothing else is live for this prompt: no edge-function deploy, no cron change, no Davenport change, no data written
   to either project (`edge-functions/README.md` records the "nothing deployed" state).
6. Faraz, after the deploy: Setup → East feed → *Refresh from Davenport* (his 16 Davenport `time_off` rows arrive —
   fewer *ranges* where adjacent or overlapping rows merge (`eastMergeRanges`), so the toast names the merged count,
   which may be under 16), then **[range] → home** (per the prompt) and **12/11–12/13** as he decides. Until he
   does, the
   unreviewed default lists his four locked Thanksgiving days in the card's conflicts list (a report, never a block).

**Open questions (unknowns, not defaults to bake in; every default taken is data in `groupRules` / `surgeonRules`):**

1. **Horizon of the conservative default** — should the hard block apply only inside the next **60 days** (the strip's
   open-slot window; the strip's unreviewed count is not windowed, so the nag already reaches every horizon)? Open; the
   canonical text is `SILVIS-CALL-RULES.md` §8 item 17 (not built).
2. **The command-line generate path** — `scripts/preview-generate.js` (and `publish-preview.js` after it) pass no
   `eastVacationRanges` / `eastVacationReviews` inputs — open; see `SILVIS-CALL-RULES.md` §8 item 17.
3. **Server-side enforcement** (`claim_open_slot`, `apply_trade`, the `time_off` trigger) — open; see `SILVIS-CALL-RULES.md` §8 item 17.
4. **The `home` → `either` offers step** is a documented no-op until Prompt 14's painter lands on `main`; the
   confirm sheet listing the dates is that wave's.
5. **Davenport side** (not changed from here): [removed]
   [removed]; Silvis reads FAK's rows only. Faraz's call on the Davenport
   project.
6. **Who refreshes.** `east_feed` is scheduler-written, so a future East surgeon who is not the scheduler depends on
   the scheduler's refresh for his ranges to appear (moot while Khan is both).

## 19. Publishing from the command line (Prompt 12 PUB, 2026-09-23 overnight)

Publishing normally happens in the app (Setup → Generate → Accept & Publish) under the scheduler's signed-in session.
On 9/22 evening Faraz authorised the overnight run to publish without him ("no one has access yet except me"), and
nobody else can sign in as him, so `scripts/publish-preview.js` publishes a preview JSON written by
`scripts/preview-generate.js` **server-side**, mirroring the app's path exactly and proving what it did.

```
node scripts/publish-preview.js                                  # dry run (default): plan + preflight, SQL + report to the scratch path
node scripts/publish-preview.js --apply --workdir <linked dir>   # runs the SQL through `supabase db query --linked -f`, then verifies
   [--preview docs/PREVIEW-<start>-to-<end>.json] [--out <sql>] [--report <md>] [--force-app-edited]
```

- **Input**: the preview's `.schedule` (milestone `.start..end`) and `.backfill.schedule` (`.backfill.range`, the
  fill-open-only pass). A day in both must be identical (else abort). Live rows come from the seven anon-readable
  sources `preview-generate.js` reads (`client_versions`, the eighth anon-readable table, is not an input); the rules ctx is rebuilt the same way (that builder is duplicated in the tool
  because `preview-generate.js` is a top-level runner without exports).
- **Plan, per day and role**: a locked live role is never changed and the preview must hold the same holder (else
  abort); a held, unlocked slot whose live source is not `import` / `generated` / `east-derived` is app-edited — the
  change is refused and listed, the day skipped, the run continues (`--force-app-edited` lifts that; unused); an
  `external_cover` is never cleared or set; otherwise a differing preview holder is a change, and holder → OPEN is
  allowed only when the preview left the slot open and the live holder was `generated` (an import holder is never
  cleared — refused and listed). Unchanged days are skipped; a day with no live row and both roles open is not
  inserted; `primary <> backup` is checked on every written row. **Documented deviation**: "unchanged" means the
  holders are equal — a lock / source / note-only difference is never written (the app's sync compares the whole
  row body and would PATCH such a day); conservative, and never the case on 9/23. The app's accidental-wipe guard
  (`helpers.scheduleWipeCheck`, live → final) aborts the plan when more than half of the populated primaries would
  be emptied, even when each single clear is allowed.
- **Row shape** (= `helpers.assignmentToDayRow` + what Accept & Publish writes): `source` is the preview entry's
  (`generator.js genSeedLocks`: a day with a fixed slot keeps its source — so a locked-import day whose backup was
  generated stays `import` — else `generated`; a derived week with no import lock is `east-derived`; a live app source
  whose held slots are untouched is kept); a live lock stays, otherwise the preview's flag (generated slots unlocked,
  a derived-week lock locked); an existing note is never overwritten (a new generated day gets `null`);
  `updated_by = 'publish-preview (Faraz, 2026-09-23 overnight)'`; `version` by compare-and-swap. **After `--apply`
  the updated days are app-owned**: `import-seed` applies only where `updated_by` is still `seed`, so it will no
  longer touch the 31 updated October/November days (their `updated_by` is the tag) — a later seed correction to any
  of them goes through the app (the importer's dry run lists them as BLOCKED). By design: it is what stops a
  re-import from wiping the generated backups, and identical to what an app publish does. IB (same night): those
  BLOCKED days no longer stop the rest of a re-import — `import-seed --apply` keeps them exactly as the app's Apply
  does (no SQL statement for them, `kept N app-edited day(s)` in the summary, verify accepts `Total changes: 0 (+N
  blocked)`), so blob / availability / time_off changes still land while a schedule is published; `--strict-blocked`
  restores the refusal (exit 3). See §4.4.
- **SQL**: one transaction, one `DO $pub$ … $pub$` block (a tagged quote, so a note containing `$$` cannot end the
  body) — snapshot **first** (`reason 'generate_publish'`, `created_by` the tool
  tag, the same `jsonb_build_object` shape as `snapshots.capture` / `importer.js`), then per day
  `UPDATE … SET version = version + 1 … WHERE day = X AND version = <seen>` or `INSERT … version 1 … ON CONFLICT DO
  NOTHING`, each followed by `GET DIAGNOSTICS` + `RAISE` unless exactly one row moved, a final count guard, then one
  `audit_log` row shaped like the app's `schedule.generate_accept` (`actor_name` = the tag, `mode: "command-line"`,
  the authorisation note, the snapshot id and counts). Any raise rolls everything back. **No `notifications` row, no
  edge-function call, no mail** — the office notice is the app's publish dialog, by Faraz, afterwards.
- **Preflight** (before any SQL): (a) `diagnostics.hardViolations` empty in both passes and the milestone's
  `uncovered` empty (backfill opens are listed); (b) `rules.eligibility` over every placed slot of both ranges on the
  FINAL schedule — a lock holder's `conflicts` are the known locked facts (the preview's `lockViolations`), any other
  hard reason aborts; a ctx the builder could not complete (no East id resolved for an `eastBlocks` surgeon, a failed
  Davenport roster read) **fails the preflight outright** — an incomplete ctx would evaluate Khan's East days `ok`
  and PASS silently; (c) every range day covered or listed open; (d) distinct roles. `--apply` refuses unless all pass.
- **Verification on `--apply`**: the batch's final `SELECT` (snapshot id, snapshots before → after, audit id,
  `stamped_at` and the rows stamped **at that timestamp** — the tag is a constant, so the count is scoped to the
  latest run, never all-time), an anon re-read proving every planned row with its incremented version and tag AND
  every row outside the plan unchanged with the total moved by exactly the inserts (`verifyUntouched`), a fresh plan
  reading zero rows, per-surgeon per-month tallies of the final rows; `docs/PUBLISH-2026-09-23.md` is written
  (on a dry run the report goes to the scratch path). Exit 0 verified / 1 not verified / 2 plan or preflight abort.
  A re-read that throws after the batch was sent still writes the report and exits 1 saying the batch may have
  committed (the remedy is a fresh dry run: it must read zero rows). The CLI's `-o json` shape was never observed:
  the final select's row is parsed from the END of stdout, and on a parse failure the trailing 400 characters are
  printed so the snapshot / audit ids can be read by hand.
- **Dry run of 2026-09-23 (read-only, live project)**: 73 live rows; plan 70 rows (39 inserts, 31 updates), 110 slot
  changes, 0 refused, 10/15 primary the only open slot; preflight PASS with the 9 known locked facts (Fierce 10/12 Mon
  pattern, Philip's seven October backup-cap locks, Acton 11/18 day-before-vacation).
- Proof: `test/publish.test.js` (synthetic live rows in `test/fixtures/publish-synthetic-2026-10.json`, a synthetic
  ctx from the seed for the preflight, SQL pins, idempotence); CI step "Publish-preview plan tests".

### 19.1 Day edits from the command line (`scripts/day-edit.js`, Prompt 12 item BK, 2026-09-23)

`node scripts/day-edit.js --set <day>:<role>=<id|OPEN|ext:label> [--set …] --by "<name>" [--expect <day>:<role>=<holder>]
[--lock|--no-lock] [--note …] [--override] [--availability-from-seed] [--dry-run | --apply --workdir <linked dir>]` is the
app's day editor save (`index-source.html` `saveDayEdit`, the ONLY manual mutation path) run server-side, for the case
where the scheduler cannot sign in and a published row must move now (first use: Burchett takes backup 10/9, 10/15,
10/20, 10/22 — `docs/REPORT-BURCHETT-OCTOBER-2026-09-23.md`). It reads the live rows with the anon key, evaluates each
pick with `rules.eligibility` exactly as `DayEditor` does (the ctx built from the pick-time draft: the edited role
cleared and unlocked, `source: "manual"`; a Fri–Sun block holder asked as a block member; an outside surgeon with
`manual: true`), prints hard / soft per edit and refuses a hard failure as the editor's "Override?" warning unless
`--override` (then the note gets the app's `[override: …]` tag and a `schedule.override` audit row; a check that throws
is never overridable). The row after is `saveDayEdit`'s: only the edited role's id + lock move (`--lock`, the default,
locks the pick — the editor itself locks only an outside surgeon automatically; a pool pick needs the "Lock" tick),
primary/backup must differ, a roster primary clears an external cover, the note is kept unless `--note`, and the whole
row's `source` becomes `manual` (a claim / trade row keeps its source while a held role keeps its holder). The SQL is
one `DO $de$` block: snapshot **first** (`reason 'day_edit'` — the editor takes none, it keeps an undo point; a failed
capture raises, exit 4), then per day `UPDATE … SET <role>_id, <role>_locked, source, note, version = version + 1,
updated_by = <--by>, updated_at = now() WHERE day = X AND version = <seen> AND <role>_id IS NOT DISTINCT FROM
<expected holder>` with `GET DIAGNOSTICS` + `RAISE 'DAY_EDIT_CAS_MISMATCH'` (exit 3; `--expect` lets the caller pin the
holder they saw and is refused before any SQL when it differs), a stamp-count guard, then the app's audit rows
(`schedule.day_edit` with before / after / overrides, `schedule.lock`, `schedule.override`; `actor_name` = the tag). It
writes **no `notifications` row and sends no mail**: it prints the `manual_edit` notice the editor would have queued
(message, recipients) so Faraz can decide. `--apply` re-reads and verifies every planned row (body, version + 1, tag),
every other row untouched and a fresh plan reading zero rows. **Prefer the app** whenever the scheduler is signed in:
the editor shows the same eligibility live, the notice goes out in one step, and the autosave keeps everyone's view in
sync; use the CLI for an authorised edit that cannot wait for a session, and never for a bulk change (that is
Generate / publish-preview). A multi-day batch is gated as **sequential editor saves** (review 9/23): day *n* is
evaluated on live + the `after` of every earlier day in the batch, so a hard rule two edits create together (Khan
Fri–Sun + Mon = max-consecutive) is refused on the day that trips it, as the app would show it. A role locked to
someone else is re-assigned in one step, but the plan prints `replacing LOCKED holder <name> (<role>)` per such role
and the audit detail carries `replacedLockedHolders` (the editor needs the Lock untick first). `--apply` without
`--workdir` and an `--expect` that no `--set` consumes are refused at parse time, before any read; the notice preview
is signed with a display name (`--by-name`, else the text of `--by` before ` (`), like the app; the exit 3 / 4
classification reads the RAISE text of the CLI's output whether or not the CLI exits non-zero, and a batch whose rows
did not move is reported NOT VERIFIED (exit 1) by the re-read — the `DO` block rolled back in every case. Proof:
`test/day-edit.test.js` (the live October rows as a fixture, before/after pinned, SQL pins, override gating, the
sequential Khan Fri–Mon batch, verify-after-apply); CI step "Day-edit CLI tests".
