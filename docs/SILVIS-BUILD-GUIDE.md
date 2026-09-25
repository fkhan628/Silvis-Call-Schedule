# Silvis Surgical Care Call Schedule — Build Guide for Claude Code

*Read this first, then `SILVIS-CALL-RULES.md` (the rules), then `silvis-seed.json` (the data). The prompt
sequence that built the app and the other working papers are history (`HISTORY.md` indexes them; the files live in the private folder); `CLAUDE.md` is the file that goes
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
| s1 | Khan | FAK | weekend primary when East allows (`primaryContribution: "weekends"`, 9/22); Mon/Wed auto-offered when East is clear (= eligible with a soft +1, `auto-offer-weekday` / `weights.noTargetWeekday` — audit RG-3, 9/23); never Tue/Thu as primary (backup any day since 9/22); East blocks primary only |
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
(the office contact is the one `viewer`; administration has no account).
(the office contact is the one `viewer`; administration has no account) and, since Prompt 16 A7 (2026-09-24), `coordinator`:
an office account with **no roster link** (a check constraint refuses one) that enters and edits any surgeon's
upcoming vacations, may write dated availability rows for them (DB policy only; no UI yet) and relays their offered
dates into the painter (`save_offers` / `set_offer_mode` with `p_person` - a roster id only, OS004 / OM007 otherwise;
`entered_by` = its profile id, `source 'office-relay'`), and reads
its own Activity log entries — with no scheduler power anywhere else. To every guard that asks `silvis_is_sched()` a
coordinator is a non-scheduler (offer freeze, OF004, the time_off on-call trigger, the trade guards). `send-notification`
refuses the role like a viewer. Client: `isCoordinator` sees the viewer's views plus Time off with a person picker and
the "Offers - enter for a surgeon" card; no Setup, no Generate, the day tap opens the read-only detail.

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
- **Pre-launch tightening (Prompt 16 A1, `sql/migrations/2026-09-24-prelaunch-rls.sql`, prepared 2026-09-24 — report-first; applied 2026-09-23 ~18:35 Central by the orchestrator after the BEFORE probe, verify-rls.sh section 10 green).** The `notifications` / `user_profiles` / `audit_log` / `office_contacts` clauses in the bullet above are the live posture until it is applied; afterwards, one row per change:

| change | before | after | client read that depends on it |
|---|---|---|---|
| `user_profiles_read` | every authenticated user reads every row | own row, or the caller is scheduler/admin, or the row's role is admin/scheduler | `fetchProfile` (own row), `schedulerIdsLoud` (scheduler/admin rows); the whole-table reads run only for scheduler / admin |
| `user_profiles_self_update` | pins `role`, `person_id` | also pins `email` on the REST path (display_name stays self-editable; corrections via `user_profiles_admin`, admin only). Residual, accepted (closed 9/24): GoTrue's self-service email change (`PUT /auth/v1/user`, confirmed at the new mailbox) still re-syncs `user_profiles.email` through `handle_new_auth_user` (security definer) — decided 9/24: *Secure email change* is ON in the Supabase dashboard (both mailboxes confirm), no `handle_new_auth_user` migration planned (SCHEMA-REVIEW, A1 "What could break") | none — the client has no self-update path |
| `contacts_read` | every authenticated user | scheduler/admin only | the office-contacts effect is `isScheduler`-gated |
| `notif_insert` | any authenticated user | scheduler/admin or a caller linked to a roster entry | `addNotification` — reached only from linked-person / scheduler actions |
| `audit_insert` | any authenticated user | scheduler/admin, or a linked caller with `actor_id` = their own roster id | `logAudit` writes `actor_id = userProfile.person_id` |
| `notif_delete_sched` | no delete policy | scheduler/admin may delete | none yet (spam removal UI is Part B) |
| `call_offers_guard` / `call_offers_delete_guard` | OF003 freezes by `offers_close_at` only | OF003 also when the period's status is not `upcoming` (matches `helpers.offerPeriodOpen` and OM005); new `OF004 OFFER_IMMUTABLE` — a non-scheduler UPDATE may not move an offer's day or person | the painter clears + inserts (`save_offers`), never moves. The CLI importer (`scripts/import-seed.js`, postgres, no JWT) and the service role are non-schedulers to the guards: a seed change that adds / edits an offer inside a period no longer `upcoming` is refused with OF003 and the import rolls back — late offers go through the app as the scheduler |
| `offer_status` | executable by PUBLIC / anon | authenticated + service_role only | none — the client derives status in `helpers.offerRollcall` |

Proof: `sql/probes/prelaunch-rls-probe.sql` (rolled back; header states every case before and after), `scripts/verify-rls.sh` section 10, the record in `docs/SCHEMA-REVIEW.md` "2026-09-24 - pre-launch RLS".

- **Coordinator role (Prompt 16 A7, `sql/migrations/2026-09-24-coordinator-role.sql`, prepared 2026-09-24 — report-first, ran AFTER A1; applied 2026-09-23 ~19:42 Central by the orchestrator, the AFTER probe's 31 cases all as expected, verify-rls.sh section 11 green).** `user_profiles.role` gains `coordinator` (office users, never linked to a roster id: `user_profiles_coordinator_unlinked`); `silvis_is_coord()` beside `silvis_is_sched()`. One row per change:

| change | before | after | client path that depends on it |
|---|---|---|---|
| `silvis_is_coord` | — | new security-definer helper: own row's role = `coordinator` (default EXECUTE, like the sibling) | every clause below |
| `time_off_self_insert` / `_update` / `_delete` | own rows or scheduler/admin | also any row for a coordinator; the on-call trigger is untouched (a coordinator's range over a published day is refused like anyone's) | Time off → person picker (`isScheduler \|\| isCoordinator`); `created_by` = the coordinator's profile id |
| `availability_write_coord` | scheduler/admin only (`availability_write_sched`) | a coordinator may insert / update / delete any row | none yet (Setup is scheduler-only; the door for the office's future entry path, probed) |
| `call_offers_insert` / `_update` / `_delete` | own rows or scheduler/admin | also a coordinator **while `silvis.office_relay` is on** — the transaction-local flag only `save_offers` sets; a direct REST write by a coordinator never sees it and stays refused (insert 42501, update / delete 0 rows) | the painter's Save (`rpc/save_offers` with `p_person`) |
| `save_offers` / `set_offer_mode` | a non-scheduler may only speak for `silvis_person_id()` (OS001 / OS002, OM001 / OM002) | a coordinator may relay for another person **on the roster** (`call_schedule_data 'main'`; `OS004 OFFERS_UNKNOWN_PERSON` / `OM007 MODE_UNKNOWN_PERSON` otherwise - `call_offers.person_id` has no foreign key; the scheduler's relay is not checked); `entered_by` = its profile id, `source 'office-relay'` (the scheduler's relay keeps `scheduler` / `email-relay`); the freeze (OF003 by close date and status, OM005) applies to it as to a surgeon; `call_offers.source` check gains `office-relay` | "Offers - enter for a surgeon" (Time off view) opens the painter as the office (relayed) |
| `notif_insert` | scheduler/admin or a linked person | also a coordinator | `addNotification` on a coordinator's vacation entry (feed row; the e-mail send is skipped — the function answers 403) |
| `audit_insert` | scheduler/admin, or a linked caller with `actor_id` = own roster id | also a coordinator with `actor_id` = `auth.uid()::text` — what `logAudit` already writes for an unlinked account (`person_id \|\| authUser.id`) | every coordinator write goes through `logAudit` |
| `audit_read_coord` | no read for a non-scheduler | a coordinator reads its **own** rows in the `timeoff.` / `offers.` / `availability.` families | Settings → Activity log ("your entries") for a coordinator; `audit_read` (scheduler/admin) unchanged |

Unchanged for coordinators, proven by the probe: `schedule_days`, `call_schedule_data`, `call_periods`, `shift_trade_requests`, `call_schedule_snapshots`, `office_contacts`, `east_vacation_reviews`, `user_profiles` beyond the own row (and the own role / person_id / email stay pinned). Proof: `sql/probes/coordinator-probe.sql` (rolled back; fixtures in 2030-08 keyed `probe-coord`; BEFORE the migration its setup raises `PROBE_SETUP` — the role check refuses `coordinator`), `scripts/verify-rls.sh` section 11, the record in `docs/SCHEMA-REVIEW.md`.

- **Trade / claim audit rows (Prompt 16 follow-up 5b, `sql/migrations/2026-09-24-trade-audit-names.sql`, prepared 2026-09-24 — report-first, applied 2026-09-24 ~17:21 Central after Faraz's go; two SECURITY DEFINER functions, no table / policy / trigger / row).** `apply_trade` wrote its `audit_log` row without `actor_name` or `detail.summary`, so the Activity log showed `?` and `trade.apply`; `claim_open_slot` named its actor but had no summary. One row per function:

| change | before | after | client read that depends on it |
|---|---|---|---|
| `apply_trade` audit row | `(actor_id, action, detail)` — `actor_name` null, no summary | `actor_name` = the caller's `user_profiles.display_name`, else the roster name for his roster id, else the id; `detail.summary` = "Trade applied: <to> takes <Primary\|Backup> <Dy Mon D> (from <from>, one-way)" / "... (from <from>; <from> takes <Role> <Dy Mon D> in return)" — roster names by id, never the stored name columns; every other detail key kept | Settings → Activity log (`(en.detail && en.detail.summary) \|\| en.action`, actor chip from `actor_name`) |
| `claim_open_slot` audit row | `actor_name` = roster name, no summary | `detail.summary` = the feed title "<Name> took <M/D> <role>"; `actor_name` unchanged | the same log line |

Proof: trade probe `E3` / `F2` and claim probe `B3` (rolled back; expected strings in their headers), `scripts/verify-rls.sh` sections 5 and 7, the record in `docs/SCHEMA-REVIEW.md` "2026-09-24 - trade / claim audit rows carry actor_name + summary (item 5b)" (status PREPARED until the orchestrator's *observed:* line; applied: 2026-09-24 22:21 UTC by the orchestrator through the linked CLI - probes E3 / F2 / B3 as expected, verify-rls sections 5 and 7 green; the two earlier `trade.apply` rows backfilled (actor Khan + summary)).

- **Give a day (Prompt 19, `sql/migrations/2026-09-24-give-kind.sql`, prepared 2026-09-24 — report-first, NOT applied; one column + two checks on `shift_trade_requests`, two trigger functions, no policy / RPC / row).** A member may give one of his days (or each day of a unit) to a named colleague with nothing coming back; the colleague accepts or declines and `apply_trade` applies it like a one-way trade. One row per change:

| change | before | after | client path that depends on it |
|---|---|---|---|
| `shift_trade_requests.kind` | — (every row a trade with an optional return leg) | `text not null default 'trade'`, `'trade'` \| `'give'` (`shift_trade_requests_kind_check`); `shift_trade_requests_give_one_way`: a give never carries a return leg, for any writer; existing rows read `'trade'` | the Prompt 19 client step sends `kind` (never before the apply: PostgREST refuses an unknown column) |
| `trade_insert_guard` | a member's one-way trade is refused by the client only | a member `'trade'` without return_day AND return_role is refused (`TRADE_INELIGIBLE: a trade needs a return shift ...` — added); a `'give'` with a return leg is refused for every caller (`TRADE_INELIGIBLE: a give is one-way ...`); the scheduler may still record a one-way `'trade'` and may insert a `'give'`; from := me / same-surgeon / roster names unchanged (a member's give of a day he does not hold lands from him and `apply_trade` refuses it, TRADE_STALE) | `submitTradeRequest` — the live build's one-way UNIT TAIL rows (rows 2..n of a whole-unit trade with one return day) are refused until EVERY installed app runs the client step, which sends them as `'give'` (a stale app's announced unit proposal can be accepted and applied as a unit split - the rollout window and its mitigations are in the SCHEMA-REVIEW section) |
| `trade_update_guard` | TRADE_IMMUTABLE legs: from / to / day / role / return_day / return_role | kind joins the list (a member may not change it, on his own row either; a non-party's UPDATE is filtered by RLS, 0 rows) | none — the client PATCHes status only |
| `apply_trade` | a party or the scheduler applies; `return_day null` = one-way | unchanged (checked): the receiver applies an accepted give; the 5b summary reads "... (from <from>, one-way)" | accept -> `runApplyTrade` |

Proof: trade probe `GIVE_SETUP` and `O` .. `U3` (rolled back; expected strings in its header), `scripts/verify-rls.sh` section 5 (and 6a now posts a return leg) and section 5c (anon `select=kind` reads HTTP 200 - the gate before the client push), the record in `docs/SCHEMA-REVIEW.md` "2026-09-24 - give a day: shift_trade_requests.kind (Prompt 19)" (status PREPARED until the orchestrator's *observed:* line; applied: _to be filled by the orchestrator_).

### 4.4 Data-loss safeguards (copy, don't reinvent)

`payloadLooksWiped` (retarget to: no `schedule_days` rows would be written AND no vacations AND no availability),
one-shot `intentionalScheduleWipeRef`, snapshot-before-destructive (capture failure **blocks** the action), scheduler
restore UI in Settings, once-per-session snapshot if newest > 6 h. The two Davenport wipe incidents happened because
LOAD is permissive and AUTOSAVE is unconditional — keep the same guards.
**Backup / snapshot scope (Faraz 9/22; Prompt 14 P5, 9/23):** `call_schedule_snapshots.data` = `{ config, schedule_days,
time_off, availability, call_offers, call_periods }` — the client capture (`config.js snapshots.capture`, read with the
writer's identity; both offer tables are authenticated-read) and the importer's pre-import snapshot write the same six
keys, so a restore CAN bring the offers and their periods back; `normalizePayload` accepts a backup without the two keys
(pre-P5) and hands them to the app's table applier — which, as of the 9/23 rebase, still writes `time_off` /
`availability` only: `applyPayload` reports the two tables as `*_in_backup` + `notApplied`, and the app's restore and
JSON import say **PARTIAL** in the alert, the toast and the audit row (`notAppliedSuffix`) instead of claiming them.
Wiring the upsert is an open item (`call_offers_guard` refuses past-day rows on insert and update — OF001 — so it needs
a today-forward filter and `on_conflict=person_id,day`); until then the SQL path restores them. The wipe guards
(`payloadLooksWipedDaily`, the table-side guards) deliberately do not consider offers: a schedule with no assigned day
is still a wipe whatever was offered.

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

### 4.5 Session lifecycle (Prompt 16 A3, 9/23)

A tab or installed PWA kept open past the project's JWT expiry used to have every write fail 401 for the rest of its life (the token was refreshed only inside `auth.getUser()`, at mount and on biometric unlock), a day-editor save re-tried and toasted every five seconds, and the only way out was Sign out - which also disabled Face ID and dropped the unsaved edit. Now `config.js` has `auth.ensureFresh()`: when the stored access token is inside its last `AUTH_REFRESH_AHEAD_MS` (5 min) or past its exp (or undecodable) and a refresh token exists, it refreshes through the existing GoTrue refresh path (single-flight for concurrent callers), stores the new pair (`_saveSession`, which also hands the token to the Realtime client), and returns `{ ok, expired, refreshed }` - it never throws. It runs on `visibilitychange -> visible`, at the top of the 60-second poll's `refreshAll`, and inside `authFetch(url, init)`, the send path of `db.insert / update / upsert`, `postDayRow / patchDayRow`, the four RPCs (`claim_open_slot`, `apply_trade`, `save_offers`, `set_offer_mode`) and the `send-notification` / `office-notifications` POSTs. `authFetch` rebuilds the auth headers **at send time** from `dbAuthHeaders()` (a header object built before the refresh would carry the old token) and, on a 401, refreshes ONCE and retries the same request ONCE; a rejected refresh returns the 401 to the caller unchanged (every write's error contract still fires; the dead pair stays in storage so `dbAuthHeaders()` keeps failing loudly, never as anon), flips `auth.sessionExpired` once (`onSessionChange("expired")`, the same rejected pair is not retried) and the component shows ONE persistent banner "Your session expired - sign in again" (`data-testid="session-expired"`). Its button opens the sign-in card in place - no reload, no `biometric.unenroll()`, no data dropped. `syncScheduleDaysNow` treats a 401 / 403 as final for that run (status "Save failed - sign in again" when the session is known dead, "Save failed - will retry" for a 401 whose refresh only hit a network error, "Not saved - no permission" for a 403; **no** 5-second retry, and no toast beside the banner; the blob leg does the same); after the sign-in `adoptSignedInUser` bumps `reloadTrigger` and the re-run of the data load **merges** the table like `refreshDays` (`mergeLoadedDays`, shared) and re-enqueues `syncScheduleDays`, so an edit made while expired lands as its CAS write. The blob leg of that re-run keeps the same promise (9/23 review): when `call_schedule_data.updated_at` still equals `blobTsRef` (the row has not moved since our last read - `refreshBlobRow`'s rule) leg A does **not** `adoptBlob`; the local Setup state stays the truth and an armed `pendingSaveRef` re-fires the autosave through `saveTick` (a state counter in the autosave's dependencies), so the Setup edit made while expired lands; when the row moved, it is adopted and the scheduler is told to re-check. `loadedAtRef` is set on the **first** load only - a re-run does not re-open the 3-second hydration window, so an edit made right after the card closes syncs like any other. A *different* account signing in on the card (`lastAuthUidRef` vs the new id) drops the pending payload and adopts both tables wholesale (`switchedUserRef`) instead of writing the previous account's edit under the new JWT. After a **granted** proactive refresh (the poll or `visibilitychange`) `resyncPendingRef` re-sends what a 401 left behind: `syncScheduleDays` (a no-op when nothing is pending) plus one autosave run when a payload is armed. `getUser()` (mount / biometric unlock) and `ensureFresh()` share one in-flight refresh (`auth._refreshShared`), so a cold open with an expired token never POSTs the same refresh token twice (outside GoTrue's reuse interval that revokes the family). Realtime: `getSupabaseRT()` creates the client with the SDK's third-party-auth `accessToken` callback (the stored token while fresh, `null` -> anon otherwise) because supabase-js 2.x re-pulls the token from that callback on connect, every heartbeat and each channel join and would otherwise fall back to the anon key a moment after any bare `realtime.setAuth()`; `client.auth` is then a throwing proxy the app never touches (pinned). `auth.applyRealtimeAuth()` (from `adoptSignedInUser`, `_saveSession` and at client creation) still pushes a new token at once so `notifications`, `shift_trade_requests`, `call_offers`, `call_periods` and `east_vacation_reviews` stream without waiting for the next heartbeat. Behaviour tests with a stubbed fetch and the lifted `syncScheduleDaysNow` live in `test/data-layer.test.js` (section A3); the smoke runs the expired-tab scenario end to end in its **own BrowserContext** (own storage and routes, so the main page's poll cannot add refresh attempts to its counters; `session-expired.png`): the heartbeat's single refresh attempt and the banner, a save answered 401 with no retry / no toast over 12 s, a Rules edit whose upsert 401s, the in-place sign-in that lands the pending POST v1 **and** the blob write carrying that edit with the new bearer, then - after a settle marker, not a fixed wait - a granted refresh **before** the next PATCH. Not routed through `authFetch` (out of A3's list, still `dbAuthHeaders()`): the raw-fetch writes of time off, availability, East, trades' status PATCH, periods, contacts, the snapshot capture and the keepalive flush - they benefit from the poll's proactive refresh only. Still to set in the dashboard (review 2 B): the project's JWT expiry.

### 4.6 Blob autosave - content gate and compare-and-swap (Prompt 16 A4, 9/23)

The scheduler's tab used to rewrite the shared setup (`call_schedule_data` 'main') every 60 seconds: the poll re-created the vacation and availability arrays, both were dependencies of the ONE autosave effect, and its blob leg upserted the whole blob with a fresh `updated_at` on every run - no change check, no compare-and-swap - so two scheduler sessions re-triggered each other on every adoption and a stale copy on a slow device could overwrite a Setup edit made on the other (the 9/23 review, item C). Now the autosave is **two effects** (`index-source.html`, "Supabase: Auto-save on changes"): the schedule_days leg keyed on `[loaded, schedule, vacations, availabilityRows, saveTick]` exactly as before (CAS per day, the empty-save guard, the one-shot `allowWipeSaveRef` consumed there), and the blob leg keyed on the setup state **alone** - `[loaded, surgeons, surgeonRules, groupRules, holidays, settings, lastPublished, lastGenerate, saveTick]` - so nothing the poll refreshes can re-fire it (the same hydration window, `loadFailedRef`, `canWriteBlob` and `blobLoadedRef` gates, the same wipe guard). Its write is `saveBlobNow` (serialized through `blobSaveChainRef`, counted in `blobSaveBusyRef`): **(1)** a content gate - `helpers.js blobSignature` (the seven blob keys, JSON with keys sorted at every depth because jsonb reorders them, a null top-level value read as absent) against `lastBlobJsonRef`, which `adoptBlob` records through `adoptBlobState` (what the local state becomes under the same field-by-field rules; `blobLocalRef` follows the committed setup state for that merge) and every 2xx updates - an equal signature is not written at all, so adopting another session's write never produces a write of our own; **(2)** `PATCH /rest/v1/call_schedule_data?id=eq.main&updated_at=eq.<blobTsRef>` (`is.null` before any stamp) with `Prefer: return=representation` through `authFetch`, body `{ data, updated_by, updated_at }` - never an upsert; **(3)** a 2xx **with a row** stamps `blobTsRef` from the RETURNED `updated_at` (PostgREST renders the timestamptz as `...+00:00` with microseconds, not the `...Z` string we sent, and the poll's equality check and the next CAS must match a later GET) and remembers the signature; **(4)** a 2xx with **zero rows** means the row moved under this session: `reloadBlobAfterMiss` re-reads it, adopts the newer copy, toasts "Setup changed elsewhere - reloaded", sets the status and does **not** retry the write (the local edit is superseded, the scheduler is told); a re-read row that already holds the payload's content is this session's own earlier write of the same edit (the keepalive flush landed first) and counts as a silent save - stamp and signature adopted, no toast, no second PATCH; when no 'main' row exists at all (a project before its first seed) one `POST` with `return=representation` inserts it; **(5)** an HTTP failure throws `blob save failed: HTTP <status> ...` for the effect's existing catch (401 / 403 / other classification, the session-expired banner rules of A3). The keepalive flush's blob leg is the same gate and the same CAS PATCH with `keepalive: true` (an unchanged blob is not sent, so a phone lock no longer re-stamps the row for every other session's poll; a blob write already in flight owns the stamp, so the flush skips its blob leg and keeps the payload armed; zero rows -> `reloadBlobAfterMiss`; a rejected response re-arms the payload), and the flush's own PATCH joins the write chain in turn (`blobSaveBusyRef` / `blobSaveChainRef`), so the debounced run of the same edit - whose 800 ms timer may fire before the flush's response arrives - waits for it and skips on the signature instead of sending a second PATCH over the same stamp (the loser of that race used to miss the CAS and toast "changed elsewhere" for the session's own write). The factory reset stamps `blobTsRef` with its clear's `updated_at` (the sent string - PostgREST compares instants, so the CAS matches) and forgets the signature; `adoptBlob` ignores the `{ _intentionalClear: true }` marker without recording a signature, so even when the echo of the clear (realtime or the poll) is re-read inside the debounce the follow-up autosave still PATCHes the defaults over the marker. New with the split: `pendingSaveRef` is released by the leg that landed its payload (the days leg on a sync that reported ok, the blob leg on a 2xx, a skip or a reload) - before, only the blob leg's 2xx cleared it, so a member's or a day-edit payload stayed armed for the life of the tab. Unchanged: the wipe guards, the snapshot rules, `dbAuthHeaders()` on every write. Behaviour tests with a fake PostgREST row (real CAS semantics) and the lifted `adoptBlob` / `refreshBlobRow` / `saveBlobNow` live in `test/data-layer.test.js` (section A4): two polls over an unchanged row write nothing, one Setup change writes exactly once with `updated_at=eq.<last seen>`, a zero-row answer reloads and does not retry, two sessions adopting each other's blob do not ping-pong (two PATCHes total), the missing-row insert, the 401 throw, the silent same-content miss, the flush / debounce race of one edit (one PATCH, no toast) and the reset's echo (the defaults still written over the marker); the smoke asserts that a day edit and a realtime schedule echo write no `call_schedule_data`, that the Rules save lands once as the CAS PATCH, that a Rules edit hidden inside the debounce goes out as the keepalive CAS PATCH carrying the previous write's stamp, that the keepalive-busy flush sends no blob write while the setup is unchanged, and that no `call_schedule_data` write follows the seed import's merge PATCH (the adoption's signature equals the state).

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
9/23 (audit RG-8): `fetchEastWeeks` requires no code at all — it resolves the codes the caller passes (`opts.codes` / `vacationCodes`) into `idsByCode` and reports a missing one in `codesUnresolved` (never a throw; `fakId` stays as a deprecated alias for the first requested code), `scripts/east-forecast.js` takes its code from the seed roster entry whose `eastFeed.forecast` is on and writes `data.code` beside `data.fakId`, and the app and the scripts take a forecast row's id only for that code (older rows without `code` fall through to the roster read).

Derivations (pure functions, unit-tested):
- **Khan busy days:** `dayCall === FAK` → Mon…Sat busy (service week; Sat 07:00→Sun 07:00 is his); `nights.mon/tue/wed/thu === FAK` → that day busy; `nights.wknd === FAK` → Fri and Sun busy (Sat 07:00–Sun 07:00 is not his, but a lone Silvis Saturday breaks his block style — allow only as fallback); `holidayCoverage[d].surgeonId === FAK` → `d` busy. Busy days block Silvis **primary only** — Khan may be Silvis **backup** on an East call day (Faraz 9/21). East backup weeks (`isBackup` true) count as busy for primary too — but only the shifts he actually holds in such a week (his dayCall / override / night / weekend / holiday days), never all seven days; pinned by `test/east-feed.test.js` ("never busy wholesale").
- **Precedence on one date: holiday 24h > `dayCallOverrides` > `dayCall`.** A `holidayCoverage[d]` entry for *another* surgeon means that surgeon holds the whole 07:00→07:00 day (Davenport's calendar drops the Svc/Sat/Ngt/Wknd entries for `d`; its generator reassigns the night/weekend slot), so `d` carries **no** Khan reason — not service-week, override, night or weekend. Verified on the live row 2026-09-07 (dayCall FAK, Labor Day held by another surgeon). In the milestone window this matters for Thanksgiving Thu–Sat 2026 and New Year 12/31–1/2 whenever FAK is the East service surgeon (reviewer finding east-1, 2026-09-22).
- **Fierce derived weeks:** `isBackup` → Silvis **backup** Mon–Sun; `isFierceBackup` → Silvis **primary** Mon–Sun. Faraz's stated weeks (`surgeonRules.s5.eastFeed.statedWeeks`) fill only weeks with no *published* row.
- Cache each fetched week into `east_feed`; the generator reads the cache, never the network. Setup shows "East feed: fetched 2026-09-21 14:02, 26 weeks, next Fierce primary week 2026-12-07" plus a manual override list (`east_overrides`) for days Faraz knows differ. If the fetch fails, keep the cache and warn — never treat failure as "no East call".
- **Forecast rows live in their own table `east_forecast`** (`week_monday pk`, `data`, `generated_at`; printed by `scripts/east-forecast.js --sql`, never executed by the script). `east_feed` holds published Davenport rows only. A forecast row is `{ isForecast:true, runs, generatedAt, fakBusyProbabilityByDay:{date:p}, fierceWeekProbability }` and is consumed only via `forecastFromFeedRows(rows)` → `forecastToBusy(forecast, groupRules.eastFeed.forecast.busyThreshold)`. As a second guard, `deriveKhanBusyDays`, `deriveFierceWeeks`, `coverageOf` and `toEastFeedRows` treat any `data.isForecast === true` row as absent, so a forecast can never read as "published" (Khan silently free, a stated Fierce week suppressed, coverage claimed) — reviewer finding east-2, 2026-09-22.
- **Precedence, pruning and the conflict report (Prompt 12 C, 9/22): published > override > forecast.** Inside the published coverage (`ctx.eastCoverage` = `coverageOf` of the cached Davenport weeks) the forecast is never consulted — no `east-forecast-busy`, no soft `east-forecast`; only the busy set derived from published rows counts, so a stale probability can never block Khan after Davenport publishes (published-free day + forecast 0.9 = eligible). `east_overrides` reach `buildContext` as their own input (`eastOverrides[id] = { day: true|false }`, grouped by `overridesByPerson`): `busy:false` clears the day whether it came from a published row or from the forecast (the day stays "known", never `east-unknown`), `busy:true` is `east-busy` regardless of the forecast; `applyOverrides` on the busy set stays for older callers. Outside the coverage the forecast rule stands as before (`forecastOutsideCoverage` prunes the map the app and `scripts/preview-generate.js` pass). **Refreshing the feed** caches Davenport's published weeks and then `DELETE`s every `east_forecast` row whose `week_monday` lies inside the new published coverage (`Prefer: return=representation` to count them; a failed delete is a toast + warning, never silent); the `east.refresh` audit row carries `forecastRowsDeleted`. The forecast only ever fills weeks Davenport has not published. **Conflict report:** `rules.eastConflicts(ctx, days)` walks the held slots of the given days and lists `{ day, role, id, reasons }` where the East data makes the holder ineligible — `east-busy`, `east-forecast-busy`, `derived-lock:` (the derived surgeon held in the other role of his derived week) and `derived-lock-held:` (someone else in his derived slot); locks are reported too (a lock is a fact that now collides), a holder who is the derived surgeon in the derived role is fine. The generator puts it in `diagnostics.eastConflicts` over the final schedule (empty for generated slots; locked ones may conflict) and the East feed card shows "Conflicts with the published schedule" over the whole schedule map after every load or refresh, each row opening the day editor. `scripts/east-forecast.js` defaults `--runs` to the seed's `groupRules.eastFeed.forecast.runs` (200), the budget to 900 s, and writes `requestedRuns` and `runs` (executed) into `docs/east-forecast-latest.json`. **Fix round (review 9/22):** the app prunes the forecast with the *same* coverage the engine receives (null while an East id is unresolved, so a hard forecast block never degrades to `east-unknown`); the East card's own forecast strip reads the pruned map and names how many rows lie inside the coverage (ignored); a `DELETE` that returns no array records `forecastRowsDeleted: null` ("count unknown"), never a confident 0, and one final toast (tone error) carries a prune failure; an `east_overrides` map for a surgeon whose East feature blocks no role is dropped with a `ctx.warnings` entry; the calendar F badge honours `busy:false` (an O badge marks the cleared day). For a holder with `outsideDerivedWeeks` the conflict report also keeps `weekday-pattern:` / `weekend-block-only` on days outside his current derived weeks and from his `eastFeed.deriveFrom` on (evaluated as a block member when he holds the whole Fri+Sat+Sun block, as the generator does) — that is a derived week that moved away; before `deriveFrom` nothing was ever derived, so Faraz's single locked 10/12 is never listed; a former derived week where he holds *backup* is undetectable here (backup is open) and is covered by `diagnostics.derivedYields` and the E badges. `scripts/preview-generate.js` dumps `diagnostics.eastConflicts` in the report and the backfill section. Contiguity assumption: `coverageOf` is one `[first Monday, last Sunday]` range with no gap check, so the prune `DELETE` and `rdInPublishedCoverage` both assume Davenport's published weeks are contiguous (they are today, 2026-06-01..2026-11-09); a gap week inside the range would be pruned and read as known-clear.
- **East vacations (Prompt 15 part 1a, 2026-09-23).** Davenport's `time_off` table (`id, person_id, kind, start_date, end_date`; inclusive dates; `kind` `vacation` | `nocall`) is read through the East feed's existing read path (probed read-only 2026-09-22; the probe's raw output stays out of the repo), so the path is 1a: no paste box, no Davenport change. *Refresh from Davenport* passes `fetchEastWeeks(from, to, { vacationCodes })` the roster codes of every surgeon whose `eastFeed` feature reads busy days (`eastBlocksPrimary`/`eastBlocksBackup`; FAK today); east-feed.js resolves each code to its Davenport id through the roster blob (never a hard-coded id), reads `time_off?kind=eq.vacation&person_id=in.(ids)&end_date=gte.{from}&start_date=lte.{vacationsTo}` (no-call days stay a Davenport concept; `opts.vacationsTo` defaults to the weeks window's Sunday + 365 days — the `time_off` read does not depend on what Davenport has published and vacations reach further than the weeks, Generate will offer 12-month presets — review E1 finding 2) and merges adjacent/overlapping ranges per code (`eastMergeRanges`, `vacationsFromTimeOff`). The cache stays per week: `attachVacationsToWeeks` writes into every published week's payload the ranges touching its Mon–Sun, whole, as `data.vacations: [{ code, start, end }]` (dates only, never a note — `east_feed` is anon-readable), so a refresh replaces them cleanly; a range that touches **no** cached week — Davenport publishes a few months ahead, vacations reach further (Khan's later ranges lie beyond the published 11/09 week today) — rides on the latest cached week before it (or the first), and moves to its own row once that week is published. **The split runs over the whole cache, not the refresh window** (`planVacationCache(eastFeedRows, feed.weeks, feed.vacations, { from })`, review E1 finding 1): the carriers are the cached published rows plus the fetched weeks (the fetched payload wins per Monday), and every cached row *outside* the window whose list changed — a ride-on range now hosted by a newly published week, or cancelled / shortened in Davenport — is upserted too, with its own payload, the new list and its own `fetched_at`; otherwise a range riding on the newest cached week would go stale the day that host left the 28-day window (still a Silvis vacation under part 2's conservative default while Davenport had cancelled it), and a refresh that fetched 0 weeks would never touch the host. Ranges the read cannot see (`end < from`) stay as cached, so old rows neither churn nor lose past ranges; a row without the key whose computed list is empty is not rewritten. The toast and the audit row name the count ("N older cached week(s) rewritten"). `eastVacations(rows, code)` merges the per-week copies back into one sorted list — the single read path for the app and `rules.js` (`ctx.eastVacations`, part 2). **Failure contract, same as the weeks:** the `time_off` read is a separate step after the weeks and the roster; a non-2xx leaves `vacations: null` + `vacationsError` (unknown, never "no vacations"), the weeks are still cached, `keepCachedVacations` copies each week's previously cached list into the new payload so the upsert never wipes known vacations, and the one final toast (tone error) and the `east.refresh` audit row (`vacations: { codes, ranges, unresolved, error }`) name it. Known blind spot: an RLS-blocked read on the Davenport side is HTTP 200 + `[]` — indistinguishable from "no vacations in the window"; the toast therefore always states the count ("N East vacation range(s) for FAK cached"), so a sudden 0 is visible. Callers that pass no `vacationCodes` (`scripts/preview-generate.js`, `scripts/publish-preview.js`) do no `time_off` read and are unchanged. Nothing visual yet: the review states, badges and the coverage-strip count are parts 2–3.

## 8. UI (index-source.html) — what changes

Views: `calendar` (month grid + week-rows list), `myschedule`, `setup`, `totals`, `timeoff` (vacations + trades), `settings`.
Keep Davenport's auth gate, toasts, dark mode, Collapsible, publish dialog, snapshot/restore, audit view, share/print/ICS
buttons, the notification center, the refresh/version banner, and Settings → Data management exactly as they are.

- **Month grid cell:** two lines — `P Burchett` / `B Acton` — colored per surgeon; open slot = red "OPEN" (the ER-panel author's convention); weekend units get a subtle bracket; locked slots show a padlock; East-derived (Fierce) slots show a small "E". **The East badges are the scheduler's business only (item E, Faraz 9/24: "not important for the Silvis guys to know"):** the E (East-derived week) and F / f (East forecast at / above threshold, 20% or more) cell badges, their two legend lines and the "East-derived: ..." hover-title bit render only when `eastBadgesVisible = isScheduler && !isPublicMode` (one flag nulls the cell's `derived` / `fc` lookups, so `nBadges` and the holiday-label gutter follow it for both audiences) - surgeons, coordinators, viewers and `?public=1` get a clean grid, while the day editor and Setup > East feed keep showing the same East information to the scheduler unchanged; display only - nothing in rules, the feed, the forecast or the generator changed (pins: `test/data-layer.test.js` "Item E (9/24)", smoke "Item E (scheduler, 1180)" / "Item E (scheduler, 390 dark)" / "Item E (surgeon, 390 dark|light)" / "Item E (?public=1)").
- **Week rows list:** the same rows as the ER-panel author's Word document (MON/SUN DATES | TRAUMA | TRAUMA BACKUP — the primary column is headed TRAUMA since 9/22, Prompt 12 P) with ranges collapsed (`9/15–9/18 Philip`) — this is also the export format (§9).
- **Day editor** (click a cell): set primary/backup from a dropdown that shows eligibility — eligible names first, ineligible greyed with the reason; lock toggle; note. Backup lists everyone (9/22: backup is open unless `backupOptOut`). Outside surgeons (M) sit under their own "Outside surgeons" heading for both roles; picking one locks the role and saves `source: "manual-external"`. A Fri/Sat/Sun candidate who already holds the other two block days is judged as a block member (small items 9/22 — Fierce can complete a Fri–Sun block by hand); the same holds for a block-style receiver of a whole Fri–Sun block in the trade path. The editor **fails closed**: a thrown eligibility check makes the option ineligible with the error as its reason and disables Save until the rules evaluate again.
- **Open shifts** (board, self-claim, weekly reminders): §16.
- **Theme (O/R, 9/22; delivered 9/23, Prompt 12 TH):** every colour is a named token in `app-styles.js` — `THEME.light` / `THEME.dark`, read in the JSX as `T = THEME[dk ? "dark" : "light"]` (the older `dkBg` / `dkText` / `dkSubtext` / `dkCardBorder` names are aliases of `T.*`). Light: navy `#13294B` for the header bar, nav, primary buttons and card titles; orange `#FF5F05` as an **accent only** (count badges, the active-tab underline, the today ring, the primary call to action `css.cta`), `#C2410C` wherever orange is text on white, `#FFE8DB` as its tint; page `#F6F8FB`, card white, text `#1F2A3A`, muted `#5B6B82`; **OPEN stays red `#B91C1C`**. Dark: page `#0B1A33`, surface `#13294B`, text `#E6ECF5`, accent `#FF8A4C`, muted `#9FB0C8` (OPEN `#F06060`); the dark `<style>` sheet matches the light literals in React's `rgb()` form and re-paints them. Per-surgeon colours are **data keyed by roster id** (`SURGEON_COLOR_BY_ID`: s1 navy `#1F3A6B`, s2 orange `#D9561A`, s3 teal `#0F766E`, s4 plum `#6B3FA0`, s5 olive `#6B7F1A`, s6 slate `#475569`; each with a pill tint and a dark-page variant) and by roster **type** (`OUTSIDE_SURGEON_COLOR`: grey `#737373`, dashed border) — `rosterColors(entry, idx)` / `rosterNameColor(c, dark)` / `pillBorder(c)`, never a name in code; P/B stay text weight. The opening screens (sign-in / sign-up / reset / set-password card's SSC tile, links and button, the biometric tile, loading, crash) use the orange `OPENING` gradient `#FF5F05 → #E8520A` with white text in both themes; `manifest.json` `theme_color` + `background_color` and `<meta name="theme-color">` are `#FF5F05`; the three icons are the supplied orange "SSC" tiles (installed PWAs pick them up on their next manifest refresh; iOS may need remove + re-add). The exports (share page, printable month, ER panels — `helpers.js exportColorsFor`) resolve through the same `rosterColors(entry, idx)`, and the export CSS carries the theme (`.hd a` `#C2410C`, `.ro` / `.wh` `#13294B`, navy toolbar button); roster pills rendered as buttons carry `data-pill`, which the dark sheet's generic button rule (`button:where(:not([data-pill]):not([data-tab]):not([aria-label="Notifications"]))`) leaves alone; the Fairness bars use `T.barTrack` / `T.barStart` / `T.barEnd` (both gradient stops ≥ 3:1 on the track in each theme); count-badge digits are `onAccent` (`#13294B` light, `#0B1A33` dark, ≥ 4.5:1). Dark mode is the Settings toggle (`silvis-dark-mode`); there is no `prefers-color-scheme` hook. Proof: `test/data-layer.test.js` [TH] pins, `test/ui/contrast.mjs` (every token pair, 4.5:1 text / 3:1 bold labels and glyphs, printed by the smoke), `test/ui/smoke.mjs` (sign-in + month view screenshots per theme, computed-colour probes, the source grep for the Davenport blues / `DSG`).
- **Week starts on Sunday (Item A, Faraz 9/23 evening):** the month grid starts the week on Sunday, like the Davenport app, by a per-device setting - `weekStartsOn` (`'sun'` default / `'mon'`), stored in localStorage `silvis-week-start` (read through `helpers.normalizeWeekStart`, so a missing or garbage value is Sunday) and set under Settings > Appearance ("Week starts on: Sunday / Monday", `data-testid="week-start-sun"` / `week-start-mon`, `aria-pressed`). ONE grid builder serves the three month grids: `helpers.monthGridDays(year, month0, weekStartsOn)` runs from the Sunday (Monday) on/before the 1st, padded to whole weeks (28 / 35 / 42 cells), and `helpers.weekdayLabels(weekStartsOn, names?)` rotates the header labels; the calendar view's `gridDays` and header row read the state (the grid carries `data-week-start`, each header `data-dow` / `data-weekend`), the share page (`generateShareHTML(..., { weekStartsOn })`) and the printable month (`buildPrintableCalendarHTML({ ..., weekStartsOn })` - week rows, DOW ribbon and the mini calendars) take it as an option and default to Sunday. The weekend-unit tint follows the day, not the column - Fri, Sat and Sun wherever they fall (columns 0, 5, 6 in Sunday mode, where Sunday opens the row and Fri/Sat close it) - and the small "weekend unit" label sits on the Fri header. Nothing week-based moves: `monOf()`, the ER-panel author's Mon-Sun week rows (MON/SUN DATES - the ER panels and the share page's table), the East weeks and the forecast are untouched, and the day cells are identical in both modes (only the padding cells move). Proof: `test/exports.test.js` (the three Item A checks: the helper over 24 months, the share grid and the printable in both modes, the week rows unchanged), `test/data-layer.test.js` (the Item A source pins) and the smoke's Item A step (header Sun..Sat by default, Mon..Sun after the Settings control, Sun..Sat again; `calendar-oct-2026-{sunday,monday}-first.png`).
- **Vacations grouped per surgeon (Item B, Faraz 9/23 evening):** the Time off card and Setup > Vacations render one block per surgeon in roster order instead of one date-sorted row per range: a header (`data-testid="vac-group-<id>"`, with `data-upcoming` / `data-past`) carrying the Badge (the last name), the roster full name only when it exists and differs from the chip (Sarkar's is empty in the seed, so his header is Badge + count; whether the header should read Badge + count only, Badge + given name, or as now is Faraz's call - open), "N upcoming" and - with Show past on (`data-testid="vac-show-past"`) - "+M past", then that person's ranges underneath as compact lines (`data-testid="vac-line-<id>-<start>"`, `data-start` / `data-end`): "Nov 19–22", "Nov 25–29", "Jan 9–10 (2027)", a single day as one date, a cross-month range as "Nov 30–Dec 2" (`helpers.vacRangeLabel(start, end, todayStr)` - the year suffix appears only when the range leaves the current year; the ISO dates stay on the line's `title`), the operational note in italics after the range, the "past" tag as before, and each line's Edit / Remove controls with the same permissions (scheduler or coordinator for anyone, a surgeon for own future ranges). `helpers.groupVacationRows(vacations, personIds, todayStr, showPast)` does the grouping (order given = roster order, rows sorted by start, past rows counted on the header and listed only with Show past; a person with nothing to show is omitted); a one-person view (My schedule > My vacations, `data-testid="mine-vacations"`, or a surgeon's own Time off card) shows just the lines without the header. The East (Davenport) list (`EastVacationList`) was already one block per person and is unchanged. Proof: `test/data-layer.test.js` (the two Item B helper checks and the Item B source pins) and the smoke's Item B steps (Time off: groups in roster order, Khan's header, the new "Mar 2–3 (2027) harness range" line with Edit / Remove, the Show past toggle; My schedule: no header in the one-person view - with the fixture holding no upcoming Khan range the smoke says so and the data-layer pin carries the proof; Setup > Vacations: the same groups).
- **Suggested trade partner (Item C, Faraz 9/23 evening):** once "My day + role" (or the date + role) names a slot the From surgeon holds, the Propose a shift trade card shows a "Suggested" row (`data-testid="trade-suggested"`) above Trade with: up to three ranked chips (`data-testid="trade-suggest-chip"`, `data-id`, `data-return-day` / `data-return-role`), each "Name - reason"; one tap fills Trade with and, when one was suggested, the return day + role. The ranking is the pure `helpers.suggestTradePartners(ctx, schedule, day, role, fromId, opts)` over INJECTED checks - the card passes its own `tradeEligibility` / `tradeEligibilityOver` (the rules.js chokepoint, locks ignored, claim flag) as `opts.eligibility(days, role, id)` and `tradeUnitOf` as `opts.unitOf` - through the App-scope `tradeSuggestionsFor(day, role, fromId, kind)`: (a) hard-eligible only (an unknown or thrown check = not shown; no rules context = no row, the existing warning stands); (b) fewer soft flags first; (c) then the lowest running total in that role for the day's year (`ttTotalsFor` from Jan 1 / the year's floor `TOTALS_YTD_FLOORS` to Dec 31 - the Totals numbers), reason "lowest primary total, 9" / "primary total 11" - one clause; the soft-note count and the tally window ("backup total 9/14-12/31: 17", `entry.window`) live in the chip's tooltip; (d) for a member's two-way proposal, people holding an upcoming day (every published day from today on - `opts.horizonDays` is an opt-in cap, none by default, like the card's own return picker) the proposer is eligible to take back rank first, the earliest workable one becomes the chip's return day ("can give back Tue 10/20 P"), someone with none is still listed ("no return day found") but last - the scheduler's proposals and a give (Prompt 19: `kind` "give", the card's Give away switch) skip (d); a return day never falls inside the vacation range that was just refused (`opts.avoidReturnDays`, a `{ start, end }` or predicate that skips a unit when any of its days is inside - the App-scope `tradeAvoidWindow(day, fromId)` supplies `vacConflict`'s range for the refused person's own conflicting slots, so the box and the card agree; the rules cannot know the range because the time_off row was never written); (e) unit-aware: a unit day with "Trade the whole unit" on is ranked over the whole unit and a return unit pairs day for day (a unit day of theirs never comes back as a split; the reason then says "(3-day unit)"). Ties keep roster order. The top suggestion also appears on the vacation-conflict box's button ("propose a trade - suggested: Acton", `data-suggested`) and on the day editor's "Propose a trade for this day" link (via the `suggestTrade` prop); both only pre-fill the card through `proposeTradeForDay(day, role, pick)` - `pick = { from, to, returnDay, returnRole }` sets Trade with and the return day, and for the scheduler also From (the holder the suggestion was made for - a pool member only; the editor suggests nothing for a slot an outside surgeon holds, so From never becomes an id the select cannot show). Nothing about proposing, accepting or applying changed. Proof: `test/data-layer.test.js` (the three Item C helper checks over a fixture schedule with a stubbed check - one-way ranking, two-way return days, the opt-in horizon, the unit pairing, the avoid window and the whole-schedule scan - and the Item C source pins) and the smoke's Item C steps (390 px: chips inside the card, no page scroll, tap fills Trade with; desktop: the editor link names the suggestion and pre-fills the card; the Time off refusal step reads the box's "suggested: <Name>" button and the pre-filled Trade with). The two-way path (a chip carrying a return day filling the return fields) is proven by the helper checks and the source pins only - the main harness session is the scheduler; the Prompt 19 S2 member session (smoke A2m, Burchett at 390 px) shows trade-mode chips carrying a return day and give-mode chips carrying none.
- **Sign-in card (Prompt 16 A2, 9/23):** invite-only. The card has no sign-up path (no "Sign up" link, no sign-up branch in `handleAuthSubmit`, no `auth.signUp` helper in `config.js`; Faraz turns public sign-ups off in the dashboard) and its one secondary action is "Forgot your password?" (accent-coloured). At mount, before the success-hash branch, the app runs `helpers.authLinkError(location.hash, location.search)`: GoTrue sends an expired or already-used invite / reset link back as `#error=…&error_code=otp_expired&error_description=…` (or the same keys as a `?error=…` query), and any such shape shows the ONE message "This invite or reset link has expired or was already used - ask the scheduler for a new invite, or use Forgot your password." — on the card (`data-testid="auth-error"`) when signed out or when a stored session turns out dead (`auth.getUser()` returns no user, so the card follows the spinner), as a toast only once a stored session actually signs the person in or hands over to the biometric tile (never at mount under the Loading spinner) — then `history.replaceState(pathname + cleanSearch)` drops the three error keys (other query keys survive) so a reload does not repeat it. The success hash (`#access_token=…&type=recovery|invite`) is untouched. The parser is unit-tested for the hash, query and success shapes and the card is pinned in `test/data-layer.test.js` (section A2); the smoke opens the signed-out page with the error hash and the query form (`signin-expired-link.png`).
- **Setup:** roster (names/codes; no contact fields); **Users** (link auth users to roster ids, set roles — the only place emails appear, read from `user_profiles`); **Rules** editor per surgeon (availability mode, recurring patterns with a live "next 8 matching dates" preview, weekend style + partner + "Primary contribution" ((none) / weekends, L), max consecutive (hard primary-only, soft any-role), holiday-unit-as-one-day opt-in, monthly cap (primary days) and target (blank = equal share; a number = primary target), "Does not take backup", holiday rules, East feed toggle); **Roster** also takes outside surgeons ("Add outside surgeon": name + code + operational note, M); **Availability** entry (dated rows by kind, plus quick paste of a date list like Burchett's); vacations (scheduler view of everyone's, with override entry); **Holidays** editor — per year, each unit's days (editable) and its primary + backup, with the major/minor fairness counts beside each name; East feed panel; **Generate** with range presets — *Through end of year* (this round) and *3 / 6 / 9 / 12 months from the last published day* ⟶ **9/22 late (Prompt 12 AB): every preset starts at the first open slot on or after today** (§6, §15) — plus N, "respect locks", preview → publish with diff; import from `silvis-seed.json` (file picker; the importer writes no contact fields and refuses a file that contains any); office contacts (entered by hand — the ER-panel author).
- **iOS safe area (Prompt 16 A5, 9/23):** the viewport meta carries `viewport-fit=cover` (the `#FF5F05` `theme-color` meta and the black-translucent status bar stay), so the installed PWA draws under the notch and the home indicator, and `app-styles.js SAFE_AREA` (the two `env(safe-area-inset-*, 0px)` readers, spread after the padding shorthand because React applies style keys in order) keeps the UI out of them: `css.hdr` pads its top by the inset on top of its 14 px, the three fixed bottom banners (update-available, minimum-version, session-expired, 44 px apart) position through `css.bottomBanner(stacked)` - the lowest pads by the inset, the ones above are lifted by it - the toast lifts by it (and by the top inset while a painter sheet parks it at the top), and the day editor's sticky Cancel / Save row pads by it like the painter sheets' footers; proof: `test/data-layer.test.js` [A5] and the smoke's 390 px step under Chromium's `Emulation.setSafeAreaInsetsOverride` (47 / 34 px: header padding-top 61 px, editor footer padding-bottom 46 px, the session-expired banner 43 px at bottom 0; review shots in `docs/screenshots/ios-safe-area/`).
- **Undo per edit and per day (Prompt 16 B1, 9/23):** the header's Undo button used to put back a whole-map snapshot of the schedule, which silently reverted any claim, trade or other device's write that had landed since the edit (the 9/23 review, section 3). Now every push site (the day editor save, Clear range, Accept & Publish, the seed import's schedule leg, a snapshot restore) hands `pushUndo(prev, next)` both maps and `helpers.undoEntry` stores only the days that differ, each as `{ day, before, version }` - the assignment the day had before (null for a day with no row) and the `schedule_days` version this session had last seen for it (`dayVersionsRef`, null when none). Undo (`helpers.undoApply`) puts back only those days and only where the version is still the recorded one; a day whose version moved is left as the table has it and named in the toast ("Undo: 2 of 3 days restored; 1 changed since (10/16)."; "Undo: 1 day restored (10/29)." when nothing was skipped). The session's own write moves the version too (POST -> 1, PATCH v -> v+1), so `syncScheduleDaysNow` reports it right after it advances `dayVersionsRef` through `helpers.undoNoteWrite`, which advances every entry that carried the version the write went out against (`sentAgainst`: the map's version, or - in the duplicate-POST branch, when another device created the row inside the debounce - the re-read version the CAS retry used, so an entry recorded at "no row" is NOT advanced there and that day reads as changed since; the review of B1) - an entry stays restorable across its own save and across a later edit of the same day; the realtime handler, the poll merge and the conflict reload never note anything, which is exactly what makes a foreign move "changed since". The history lives in `scheduleHistoryRef` (the sync loop and the `[]`-deps handlers read it) mirrored into `scheduleHistory` for the button; a restored day re-syncs through the ordinary CAS path (a day restored to "no row" is written empty, never deleted). Proof: `test/data-layer.test.js` [B1] (the helpers, the two stubbed-map scenarios - one action over A and B with a claim on B, and edit A / edit B / foreign change on B's day - the sync-loop note inside the app-safety-2 harness, and the source pins) and the smoke's B1 step (two saves then Undo restores exactly the later one with a `PATCH ?day&version=eq.1`; a save followed by a foreign v9 row is skipped and named, nothing written).
- **Recovery / invite link on a device that already holds a session (Prompt 16 B7, 9/23):** the mount effect used to store the pair from `#access_token=…&type=recovery|invite` unconditionally, so a reset or invite link opened on a shared computer silently replaced whoever was signed in there (the 9/23 review, section 3, security minors). Now the hash leaves the URL first (`history.replaceState`, so a reload never replays the tokens) and the pair goes to `config.js auth.adoptLinkSession(pair)`, the only place that decides: it decodes the link token's `sub` (`jwtClaims`), re-checks a stored session through `auth.getUser()` (which may refresh it, and clears it when it is dead) and stores the pair only for the **same** account or for **nobody** (a dead stored pair counts as nobody) — and when the same account is *live* on the device the link pair is probed first (`auth._probeLinkPair`: `GET /auth/v1/user` with the link's bearer, then one refresh POST with the link's refresh token when the access token is rejected; storage and the session flags untouched), so a dead link answers `{ status: "dead", kept: true }` and the live session stays (the mount effect then goes on to the ordinary session path and the expired-link message is a toast over the signed-in app, never a sign-out), a link whose access token expired but whose refresh token is good is stored as the rotated pair, and a probe that hits a network error keeps the live pair and opens the card for it (`{ status: "ok", kept: true }` — the password PUT goes out with the live session, the same account); for a **different** account it stores nothing and answers `{ status: "conflict", signedIn: { id, email }, linkEmail }` — when the stored session cannot be re-checked (network) the two tokens' `sub` claims decide and the answer is flagged `unverified`. After a store it calls `auth.getUser()` again on the new token and answers `{ status: "ok", user, email }` (`user` null and `unverified` on a network error, the e-mail then from the token's claim), `{ status: "dead" }` when the link token is rejected (nothing left in storage) or `{ status: "invalid" }` for an undecodable pair; it never throws. In the app the set-password card says "Setting a password for **<email>**" (`data-testid="link-account"`); on a conflict the card switches to `authMode === "linkconflict"` (`data-testid="link-conflict"`): "This device is signed in as <signed-in e-mail>. The link you opened sets a password for <link e-mail>." with **Sign out and continue** (`data-testid="link-signout"`: `auth.signOut()`, biometric enrollment dropped like `handleSignOut`, then the same pair is adopted and the set-password card follows) and **Keep me signed in** (the pair is dropped and the page reloads — the hash is already gone, so that is the ordinary mount with the stored session). The waiting pair lives in `pendingLinkRef` (memory only; the app never calls `auth._saveSession` and never writes a token to storage itself); a dead link token shows the A2 expired-link message on the sign-in card. `auth.updatePassword` catches a thrown fetch (`{ error: "No connection - try again" }`, a non-JSON error body still reads as an error) and `submitNewPassword` carries a `.catch`, so an offline password PUT ends the busy state with a message instead of a stuck "Updating" button. Proof: `test/data-layer.test.js` [B7] (twelve behaviour checks with a stubbed `getUser` and a bearer-aware fetch stub — no session, same user (probed once), same account live + dead link (kept, nothing stored), same account live + expired access token with a good refresh token (the rotated pair), same account live + probe on network (kept), different user, different user then `signOut()` and a second adopt, dead stored session, network on the re-check both ways, dead link token, network after the store, junk, `updatePassword` offline — plus the source pins) and the smoke's B7 step (390 px, both themes, a fixture session stored: the same account's hash opens the card at once; the same account's dead hash (`/auth/v1/user` 401, its refresh 400) leaves the stored pair alone and the app comes up signed in with the toast; another account's hash shows the conflict card with both addresses and leaves the stored pair and the logout endpoint untouched; "Keep me signed in" comes back signed in; "Sign out and continue" makes exactly one `POST /auth/v1/logout` with the old bearer and only then stores the link pair; `recovery-conflict-390-*.png`, `recovery-setpassword-390-*.png`).
- **Viewer role (Prompt 16 B3, 9/24):** the read-only account — `userProfile.role === "viewer"` with no roster link (the office viewer, and every invited account until the admin links *and* promotes it in Setup → Users) — used to get the office's dead ends (the 9/23 review, section 3): a permanent "not linked" banner on every view, the same sentence twice on Time off & Trades, an empty calendar-sync card and an unfiltered Alerts feed. `isViewer` (declared beside `isCoordinator`; a failed profile read is never a viewer — its fallback profile also reads `viewer`, but `profileLoadFailed` keeps the red banner and every gate as it was) branches four places: the unlinked banner never renders; Time off & Trades is one "Vacations" card with the viewer's own sentence (`data-testid="viewer-timeoff-note"`), no form and the whole group's vacation list read-only (`renderVacationList(all, false)`; `time_off` is readable by every signed-in account), and the trades IIFE returns null as it does for the office (no card, no request list - and the nav tab reads "Time off" rather than "Time off & Trades" for both roles, pinned); Settings → Live calendar sync offers the public full-schedule feed (`${EDGE_FN_BASE}/calendar-sync`, `data-testid="calsync-full"` — the block the scheduler already had, now shared; the per-surgeon pills stay the scheduler's and the personal block still keys on the roster link, so no empty "My calendar" block); the Alerts feed is `helpers.notifVisibleTo(notifications, { isScheduler, isViewer, mySurgeon, clearedBefore })` — one pure function for every role (scheduler: everything; a linked surgeon: the four group-wide types plus the rows that name them; a viewer: `schedule_published` and `open_shifts` only; an account with a role but no link yet: everything, unchanged) — and the Account line says "a read-only account" instead of "unlinked account". Mine, Paint offers and the offer painter already keyed on the roster link. Proof: `test/data-layer.test.js` [B3] (the helper over a six-row feed for each role and the Clear watermark, plus the source pins) and the smoke's viewer session (a third mocked profile, role `viewer`, no `person_id`, its own `notifications` GET answering four types; 390 px in both themes: no `unlinked-banner`, no `trade-card`, the "not linked" sentence absent from the whole page, `calsync-full` holding the public URL with no "My calendar" block, the Alerts panel listing exactly the publish and open-shifts rows with the badge reading 2; `viewer-390-light.png`, `viewer-390-dark.png`).
- **Six regions in theme tokens + the contrast gate (Prompt 16 B2, 9/24):** the notification-settings labels, the publish diff's lines and notice, the snapshot list, every `SuCheck` label (each Setup checkbox), the open-shifts board and the claim sheet / open-shifts e-mail dialog were written in light-only literals (`#3a4a58`, `#7a8a98`, `#5a6a78`, `#8a94a0`, `#c04040` OPEN, `#1a8040`) that the dark `<style>` sheet never repaints — `#3a4a58` read **1.59:1** on the dark card, `#7a8a98` only 3.55:1 even on white (the 9/23 review, section 3). They now read `T.text` / `T.muted` / `T.open` / `T.border` and a new token pair **`THEME.*.success`** (`#1A8040` light 4.99:1 on the card, `#40C060` dark 6.17:1 — the green the sheet already gave `span`s), the snapshot-load error box is `css.errBox`, and `SuCheck` (module scope, no `dk`) takes `css.suCheck` from `app-styles.js` — the light set's text token, as every `css.*` style is — which the sheet's `label[style*="color: rgb(31, 42, 58)"]` rule repaints (the [TH] pin that keeps `THEME.light.` out of the JSX still holds); the publish dialog's duplicated notice paragraph (a second copy left under the first by the 9/23 theme commit) is gone. `test/ui/theme-regions.js` (CommonJS, shared) names the six regions as unique source anchors with each region's surface per theme, scans a region for every inline `color:` hex literal (plain or `dk ? … : …`, with the element name, the style's own background literal and its font size / weight) and models what the dark sheet does to a light literal per element. **`test/ui/contrast.mjs` is now in package.json's test chain and a build.yml step ("Theme contrast gate", after the data-layer step; both files in the paths filter)**: besides the token table it prints the region table — every literal still written in a region, measured on the region's surface in both themes, 4.5:1 for text and 3:1 for large text (24 px, or 18.66 px at 700+) — and exits 1 on any failing row; on the pre-B2 tree it reported 23 failing rows, worst `notif-settings dark line 6141 <label> #3a4a58 paints #3a4a58 on #1A2A3E = 1.59:1`. Proof: `test/data-layer.test.js` [B2] (no old-set literal and no hex text colour at all in the six regions, the tokens where the literals were, the single notice paragraph, the sheet's label rule, the `success` tokens and `css.suCheck`, the chain / step / filter wiring, and the region table run in a child process against a tree that puts `#3a4a58` back on the SuCheck label — exactly one failing row, `sucheck dark label 1.59:1` — and against this tree, zero rows) and the smoke's (b2) block (the region table, then computed-colour measurements in both themes at 390 px of the notification-settings labels, the snapshot rows or empty line, the Generate card's `SuCheck` labels and every text element of the open-shifts board against the first painted background above it; `b2-settings-<theme>-390.png`, `b2-openshifts-<theme>-390.png`, both full-page so the PNG shows the cards that were measured). Review fix (9/24): the empty open-shifts row's green sits on an inner `<span>`, not the `<td>` - the dark sheet's `td { color: #C9D6E8 !important }` beats an inline td colour, so a td-level `T.success` painted only in light mode; on the span the token paints `#40C060` in dark as well (pinned in [B2], with the full-page screenshots).
- **Own profile on the poll (Prompt 16 B4, 9/24):** the app read `user_profiles` once, in `adoptSignedInUser`, so a surgeon whose account the admin linked (or promoted) in Setup -> Users while their tab or installed PWA was open stayed "not linked" - no Mine, no painter, no role gates - until a reload (the 9/23 review, section 3). Now the 60-second poll's `refreshAll` re-reads the account's own row (`refreshOwnProfile(fr)`, inside the settled batch, so it runs AFTER A3's `ensureFresh` and the read carries a live token; the realtime `SUBSCRIBED` handler goes through the same `refreshAll`, so there is one read site) and `helpers.profilePollMerge(prev, row)` decides what the answer means: only `person_id` / `role` / `display_name` count (null, "" and undefined are one value), an unchanged row answers the same object with `changed: false` and never reaches `setUserProfile` (no re-render), a moved field answers the fresh row once (the roster link appearing shows one toast, "Your account is now linked to <name> - Mine, your alerts and your offers follow it."; a role or name move re-renders silently), a failed mount read (`_loadFailed`) is replaced by the first successful poll read and `profileLoadFailed` clears even when the row still reads viewer / unlinked - and when that recovered read comes back linked the link is applied silently (no toast: the link may predate the session; review 9/24). What it never does: a failed read (non-2xx) keeps the current profile with a console warning (never a demotion - failure != empty), an empty read keeps it too (the own row is always readable under RLS, so `[]` is a surprise, not an unlink), nothing is read on a dead session (`fr.expired` or `auth.sessionExpired` - the banner owns that state) or before the mount profile exists, and an answer that lands after a sign-out or an account switch is dropped (`authUserRef` / `userProfileRef` mirror the two states because the poll effect closes over `reloadTrigger` only). The Users card's own-row PATCH still updates the admin's profile directly, as before. Proof: `test/data-layer.test.js` [B4] (the helper over every shape, then `fetchProfile` + `refreshOwnProfile` lifted verbatim and ticked against a stub fetch: a link flips the profile once and the next ticks make the GET but never call `setUserProfile`; role / name moves; HTTP 500 and `[]` keep the profile; expired session reads nothing; the `_loadFailed` recovery; sign-out and account switch mid-read; the source pins). The smoke's mocked `user_profiles` GET always answers `FAKE_PROFILE`, so the extra read at subscribe time is a no-op there until the Users-card step (which PATCHes the admin's own `display_name` to "Khan (harness)" in state while the GET keeps answering "Khan" - a tick after that step would silently revert the name in the harness only; against the real DB the read returns the patched row); no smoke assertion depends on it and the 60-second tick itself is not exercised in the smoke. Making the mock echo the last PATCH would let a future step exercise the poll.
- **Nine client items from the 9/23 review (Prompt 16 B9, 9/24):** (a) **Generate runs off the main thread.** `runGenerate` posts the same inputs the page would build a ctx from (`ctxInputs` + the live schedule + the range; rows and Sets, which structured clone carries) to a classic Web Worker built from a Blob of `helpers.genWorkerSource(urls)` — the worker `importScripts` the page's own `helpers.js` / `rules.js` / `generator.js` (`GEN_WORKER_MODULES`) at the page's `?v=APP_VERSION` URLs (`genWorkerUrls`), so it runs the bytes the page loaded and no second script file is built, versioned or deployed; `buildContext` + `generate` run inside it and it answers `{ id, ok, schedule, diagnostics, warnings }` or `{ ok: false, error }`, never a throw. One worker per run, terminated when it answers or after the time budget plus 20 s. Any failure (no `Worker` / Blob-URL support, `importScripts`, a clone error, a worker error event, a hung run) rejects and the run falls back to the inline path — and `genWorkerBroken` keeps that device inline for the session. The page CSP (B8) carries a worker-src blob: allowance for it since 2026-09-24 - without that directive every device silently ran Generate inline (seen on the landing branch smoke: "Generate worker failed" + a CSP violation).js` fetched a second time by its `importScripts`, the busy line naming the worker, no `Generate worker failed` warning anywhere in the run) is the gate that would catch it. The busy line under Run now says what is true for the mode that will run (`busyMode`): "in a background worker - the page stays usable while it runs" or "on this page - it may pause for a few seconds until the run finishes"; the old "stays responsive between candidates" is gone. (b) **Day editor:** one `requestClose` — the backdrop tap, the x, Cancel and Escape all go through it, and a dirty draft is dropped only after `confirm("Discard your unsaved changes to this day?")`; the dialog traps Tab / Shift+Tab over every focusable (`helpers.focusTrapNext`, `dialogKeyDown`), takes focus when it opens (`tabIndex -1`, unless the open-shifts board asked for the external-cover input) and returns it to the opener on close. (c) **Banners under the dialogs:** the three fixed bottom banners are `zIndex: 9200` — below the painter sheets (9300), the day editor and the claim sheet (9500); the toast stays at 9999 — so a banner never covers a sticky Save row or the claim buttons on a phone. The session-expired banner is deliberately among them: its Sign in (`openSignInAgain`) sets `authUser` null, which unmounts an open day editor and would drop a dirty draft past the discard confirm — so while a dialog is open a save fails loudly (A3) and Sign in is one tap away the moment the dialog closes. (d) `sendBrowserNotif` answers `true` only when `new Notification()` did not throw (iOS Safari's page context throws even when permission reads granted) and the test button's line comes from `helpers.notifTestMessage(shown, permission)` — "Browser notification sent." only then, otherwise the reason (blocked / not allowed yet / the browser could not show one - install to the Home Screen). (e) **Saved toasts after the write:** `saveGroupRules` / `saveHolidays` register a waiter (`awaitBlobWrite(label)`) instead of toasting at once, and the autosave's blob leg settles the waiters on every exit through `helpers.setupSaveToasts` — "Group rules saved." / "Holiday units saved." once `saveBlobNow` returned a row (skipped and landed-earlier count as saved), "… NOT saved - <why>" on the hydration return, the load-failed and role gates, the wiped and not-loaded guards, a CAS-miss reload and the catch (no permission / session expired / connection). A run settles only the waiters that existed when its timer fired (`takeBlobWaiters` before `saveBlobNow`), so a save clicked while an earlier PATCH is still in flight waits for its own write; one run's labels go out as one line ("Group rules and Holiday units saved.") because the toast is single-slot, and in the catch that line is toasted last so it is the one that stays. (f) `deleteOfficeContact` sends `Prefer: return=representation` and treats a 2xx with zero rows (an RLS-filtered DELETE) as not deleted: the contact stays, an error toast says so, no audit row. (g) `PatternListEditor` keys each row and its typed text by a stable id (`helpers.suPatternRowIds`; Remove splices the id list, Add lets the reconcile mint one) — a Remove no longer shifts the rows below it onto reused DOM. (h) **schedule_days tripwire:** `helpers.daysReadTripped(count, lastCount)` — zero rows after a read of N > 0 is a failed read (200 + [] is what RLS or a dead token answers), so `mergeLoadedDays` keeps the map and the persisted base, logs a console warning on every such read and toasts once until a read with rows arrives (`lastDaysCountRef` / `daysTripwireWarnedRef`; `adoptLoadedDays` records the baseline, the poll's `refreshDays` clears `loadFailedRef` only for an adopted read, the CAS conflict reload keeps the local map too, and the factory reset zeroes the count after its own DELETE so the empty table it made is not a false alarm). A table emptied by another device's factory reset reads the same as a failed read here, so both toasts name both causes and say reload to confirm (a reload adopts the empty table as the new baseline); a Clear range never removes rows — the days leg writes them empty — so it cannot trip the device that ran it. (i) **One today:** every DATE default reads `todayCentral()` — the vacation and clear-range defaults and the vacation form reset, the pasted-list year, the month painter's first month and the East refresh window (the calendar, the board and the claim path already did). Proof: `test/data-layer.test.js` [B9] (the worker script run in a worker-shaped `vm` sandbox — `self`, `importScripts`, `postMessage`, no `window` / `document` — over the seed, a bad message, the pins; `focusTrapNext`; `sendBrowserNotif` lifted and run against a throwing constructor; `notifTestMessage`; `setupSaveToasts` and the blob-leg pins; `deleteOfficeContact` lifted and run against a zero-row 200; `suPatternRowIds`; `daysReadTripped` and `mergeLoadedDays` lifted and fed an empty read after three rows; the `new Date()` sweep) and the smoke: `b9EditorGuard` at 390 px in both themes (focus in the dialog, Tab wrap, a dirty draft kept through a declined backdrop tap and a declined Escape, closed on the accepted one, the cell unchanged), and on the refresh-banner page the day editor's Save centre hitting Save with the banner under it (`elementFromPoint`, z 9200 < 9500) followed by one schedule_days poll answered `200 + []` that keeps every assigned October cell with the toast and one console warning. The harness serves every file from a cache read once at start-up (`servedCache`), so a `git checkout -- index.html` under a running smoke cannot swap the page it serves — run smokes from one tree at a time all the same.
- **Totals:** per surgeon by month, year-to-date and rolling 12 months: primary shifts, backup shifts, weekend days, major/minor holidays, max consecutive (primary-only and any-role, real days), each vs target/cap — the cap is primary-only and the deviation is primary minus target (J/K); an "Outside surgeons" section lists their day counts (M); fairness view (deviation from target). One 24-h day = one shift, nothing weighted. **No stipend, pay or $ figures anywhere** (Faraz 9/21).
- **Time off & trades:** a surgeon enters a vacation range for themselves — no approval; the entry is refused if any day in the range has them published as primary or backup (the conflicting dates are listed with a "propose a trade" shortcut), otherwise it is saved, logged to `audit_log`, and those days are blocked from call. Scheduler can enter for anyone and override. Trades by day+role with eligibility checked for the recipient; an accepted trade is applied to the schedule with an audit entry and notifications (scheduler can revert). **Give away (Prompt 19 S2):** the Propose a shift trade card opens with a two-way switch above the form - "Trade (day for day)" / "Give away (nothing in return)" (`data-testid="trade-kind-trade"` / `"trade-kind-give"`, `aria-pressed`, state `tradeKind`; every "Propose a trade" entry point resets it to trade). In give mode any chosen return day is cleared and every return control (`trade-theirs-pick`, `trade-return-day`, `trade-return-role`, `trade-return-unit`, `trade-return-reason`) is gone; the receiver select reads "Give to"; the Suggested chips take the one-way ranking; the button reads "Offer this day to <Name>" or "Offer the <unit> to <Name>" - a weekend or holiday day goes as the whole unit unless the scheduler splits it, exactly as a trade. `submitTradeRequest` runs the trade's holder, unit-split and receiver-eligibility checks (`tradeEligibility` / `tradeEligibilityOver`), then skips the return leg and the scheduler's one-way confirm; the rows come from the pure `helpers.tradeProposalRows` (a give: `kind: 'give'`, `return_day` / `return_role` null on every row; a member's whole-unit trade for one return day sends its tail rows as `'give'` too - `trade_insert_guard` refuses a member `'trade'` without a return leg; a trade row with its return leg and every scheduler trade row send no `kind`). The `trade.propose` audit row carries `kind`; the in-app `trade_proposed` notification is titled "Day offered - nothing in return" with `data.kind` and the receiver-addressed line `helpers.tradeGiveMsg` ("Acton offers you Sat 10/10 primary - nothing in return (a give to Burchett)"); the `trade_proposed` e-mail goes to both parties, so its words are the neutral `helpers.tradeGiveEmail` ("Day offered: Sat 10/10 primary (Acton to Burchett)"). The scheduler keeps his one-way trade. Rollout: the client push follows the `2026-09-24-give-kind.sql` apply (PostgREST refuses the unknown `kind` column before it). **Accept / decline a give (Prompt 19 S3):** a proposal is a give only when every row of it is (`helpers.tradeIsGive`: kind `'give'` and no return leg), decided on the WHOLE proposal in every status (`helpers.tradeProposalIsGive` / `tradeProposalOf`: the same unit stamp, parties and role, live or closed like the row, submitted within 10 minutes of it - the app's `tradeIsGiveProposal`), so a member's unit trade whose tail rows went as `'give'` stays a trade even when its rows drift apart in status (a refused tail apply, a part-way PATCH). The Trades row (`data-kind="give"`, `data-testid="trade-give-line"`) and the Alerts row for a pending give addressed to this account (`notifGiveTrade`: the receiver only - the scheduler answers from the Trades row; `notif-give-line`, `notif-give-accept`, `notif-give-decline`, the click does not reach the row's Tap to view) read `helpers.tradeGiveLine` - "Acton offers you Sat 10/10 primary (weekend unit, 10/10-10/11) - nothing in return" (em / en dash in the app) for the receiver, both names for the giver and the scheduler. Accept re-checks the receiver's eligibility (the trade path, `tradeEligibility` / `tradeEligibilityOver`; a give has no return leg to check), PATCHes every row accepted, writes `trade.accept` with `kind: 'give'` and a "Give accepted" row naming both parties (`helpers.giveAcceptedNotes`), applies each row through `apply_trade` one-way (`{ p_trade_id }` only), then `notifyGiveApplied`: one "Give applied" row ("Give applied: Acton -> Burchett, 10/10-10/11 primary", arrow in the app) and ONE `trade_applied` e-mail to `[from, to, ...schedulerIds]` (`schedulerIdsLoud({ quiet: true })`; a failed lookup mails the two parties and the final toast says the scheduler was not e-mailed) - `helpers.giveAppliedNotes` / `tradeAppliedTargets`. This needs `send-notification` v7 (prepared, NOT deployed - `edge-functions/README.md` section 3: `trade_applied` may add scheduler-linked ids beside the two parties, nobody else, and a surgeon sender must be one of the parties; the scheduler list is consulted only when the targets name someone beyond the parties; the other `trade_*` stay exactly the two parties); deploy v7 BEFORE the client push, or the v6 gate refuses that mail whole. Decline ("Give declined", the `trade_declined` e-mail to the two parties) and the proposer's Withdraw ("Give withdrawn", in-app only) are the trade paths worded as a give, `kind` on their audit rows; a Retry apply on an accepted give row reports it as a give; the scheduler reverts an applied give in the day editor (the link's title says one-way: put the giver back on the day, nothing else moves). A trade's `trade.accept` / `trade.decline` / `trade.cancel` audit rows now carry `kind: 'trade'`. Proof: `test/data-layer.test.js` (the helpers, and acceptTrade / declineTrade / cancelTrade / retryApplyTrade lifted verbatim and run against stubs - the PATCH / rpc order and bodies, the feed rows, the mail targets), `test/edge-functions.test.js` (the v7 gate) and the smoke's A3r step (a receiver session accepts from Alerts at 390 px).

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
- **Office notifications** — `office_contacts` (the office contact first) receive the schedule-change digest / publish notice through the `office-notifications` edge function pattern, retargeted to day + role.
- **Calendar sync** — the `calendar-sync` edge function serves a per-surgeon ICS feed URL (`?surgeon=<CODE>`), matched on `code`, reading `schedule_days`; `verify_jwt` must stay OFF (clients send no auth header) — verify with an unauthenticated GET → 200 + `BEGIN:VCALENDAR`. Subscription instructions in Settings.
  - **Combined Silvis + Davenport feed (Item D, 2026-09-24)** — `?surgeon=<CODE>&east=1` is the same per-surgeon feed plus one all-day event per Davenport busy day ("Khan – Davenport night / service week / weekend / holiday / day call", the reasons `east-feed.js deriveKhanBusyDays` derives, mirrored in the function's `@eastCalendar` block and pinned by `test/edge-functions.test.js`) and one per East vacation range reviewed as away, read from this project's `east_feed` cache and `east_vacation_reviews` (service role) — no new table, no write. It works for any roster surgeon whose East feature reads busy days (the app's `eastVacationPerson` predicate; today Khan); `east=1` without such a surgeon answers exactly like today, and an unresolvable Davenport id answers 502 rather than a feed without the East events (a subscription replaces its event set on refresh). Settings shows the scheduler the combined link with Copy for office staff at either site; the weekly office digest carries a "Khan at Davenport this week" section (next 14 days, same words) and the link in its footer. Note: the combined feed is an unauthenticated URL; it makes the away / not-away decision of each East vacation range visible to anyone holding the link (dates and last name only, no reason) although `east_vacation_reviews` itself stays authenticated-read (4.3) - the plain per-surgeon feed exposes nothing new.
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
- Supply chain (Prompt 16 B8, 2026-09-23): React 18.3.1, ReactDOM 18.3.1 and supabase-js 2.117.1 are served from `vendor/` (the npm registry's bytes; source URL, version and sha256 per file in `vendor/README.md`, the same hashes pinned in `test/ci.test.js` section 8) through the `?v=APP_VERSION` loader — no script comes from a CDN, and Babel is never loaded at runtime (`build.js` transpiles). To bump one: replace the file, re-hash it, update the README row and the test table together, `npm test && node build.js && npm run smoke` (the smoke fails on any unpkg / jsdelivr request), push — `vendor/**` is a watched path. The page carries a `Content-Security-Policy` meta: `script-src 'self'` plus a hash list that `build.js` fills from the three inline scripts it emits (the `__CSP_SCRIPT_HASHES__` token) plus the printable popup's toolbar script (a static hash — re-hash it when that script in `helpers.js` changes); `connect-src` is this project (https + wss) and the Davenport project; styles allow inline + Google Fonts; `frame-ancestors` cannot travel in a meta and is absent. CI installs with `npm ci` from the committed `package-lock.json` (a dependency change is a lockfile change in the same commit), and both actions are pinned to a full commit SHA with the tag in a trailing comment.
- Two pushes to `main` within one run's window (~30 s; audit T3, 9/23): the commit-back step fetches `origin/main` first — a docs/sql/scripts-only move is rebuilt on top of (its push queued no run), a watched move is left to its own queued run (a notice, nothing pushed), and a push that is still rejected fails the run with an `::error::` — re-run "Build & deploy" from the Actions tab (workflow_dispatch); the live site stays on the previous build until then. CI runs Node 24 (audit T2): the Babel 8 packages need `^22.18.0 || >=24.11.0`, and `package.json` `engines` carries the same floor.

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
- **Water-filled share + convex deviation (Faraz 9/23, item WF, after the November-backups report - history, `docs/HISTORY.md`)** —
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
  (the 9/23 milestone + October backfill preview - since B10 in the private folder, `docs/HISTORY.md`; its copy is `test/fixtures/publish-preview-2026-09-23.json`) server-side, mirroring Accept & Publish
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

After generation some slots may stay open. Prompt 13 (its prompt text is history, `docs/HISTORY.md`) gives the group one list of
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

**Past days (audit RLS-6, 2026-09-23).** `apply_trade` and `trade_update_guard` refuse a non-scheduler applying, or accepting, a trade whose day or return day is before today in Central time (`TRADE_PAST`, strict `<` like `claim_open_slot`'s `CL003`; `sql/migrations/2026-09-23-trade-past-guard.sql`, applied by hand like the other migrations - the apply record lives in `docs/SCHEMA-REVIEW.md`).

**Definer locks + roster names (Prompt 16 B6, 2026-09-24; `sql/migrations/2026-09-24-definer-locks.sql`, applied 2026-09-23 ~19:27 Central by the orchestrator; trade probe E2 share_locks=1, claim probe B2 share_locks=1, verify-rls.sh 70 / 0 afterwards).** `apply_trade` and `claim_open_slot` run `lock table public.time_off in share mode` before the day-row locks and the vacation checks: every `time_off` writer holds ROW EXCLUSIVE, which conflicts with SHARE, so a vacation inserted or edited while a trade or claim is decided waits for the swap and is then refused by its own trigger (or the function waits and its own check sees the new row); a `time_off` writer never waits on a day row, so there is no cycle (lock order in both function headers; the probes read the lock from `pg_locks`). `trade_insert_guard` writes the from/to display names from the roster instead of storing the client's strings; `trade_update_guard` does not pin them yet (a party's status PATCH may still rewrite them - the one-liner is queued in `docs/SCHEMA-REVIEW.md`), so the client's `tradeNamed` resolves both names from the roster by id and never renders the stored strings. The vacation note gets the roster note's denylist in the client (`toAdd` refuses; the backup-restore applier `applyTablesUpsert` blanks the note and counts it); no note column has a server-side denylist.

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

*Status 2026-09-23 evening (B10; supersedes the overnight status this paragraph used to carry): everything in this
section is on `main` and live. Schema: `call_periods` (incl. `offer_modes`), `call_offers`, `offer_status()`, OF001–OF003
(applied 9/22 15:15 and 9/23 07:05Z), the claim-as-offer bodies of `claim_open_slot` / `call_offers_guard` (9/23 07:05Z) and
the painter RPCs `set_offer_mode` / `save_offers` (`sql/migrations/2026-09-23-offer-mode-rpc.sql`, applied 9/23 ~18:45 UTC —
`docs/SCHEMA-REVIEW.md` carries each observed probe; `sql/schema.sql` mirrors every applied body). Data: the seed applied
through the CLI twice on 9/23 — the first period (Nov 2026 – Jan 2027, status `published` since the 9/23 publish) with its 79
seed-relayed offers and modes, and the Feb 2027 – Apr 2027 period (freeze 12/21, publish by 1/4; 9/24: Faraz moved its end from Fri 4/30 to Sun 5/2 by SQL — audit `period.update` — so the last weekend unit stays whole, and created **Jan 2027** — 1/4 – 1/31, freeze 11/23, publish by 12/7 — by SQL 9/24 (with an `audit_log` row) to fill the gap after 1/3; the seed's `offerPeriods[]` carries all three so a re-apply matches the live table). App: the painter
(part 3a), the Periods section with Remind / Close now / Enter for someone / Generate this period (3b), the day editor's
offer column and My schedule's offers (3c), the period-aware Setup import dry run (item IP below), and since Prompt 16 A7 the
office's relay path ("Offers - enter for a surgeon", `source office-relay`). Functions and cron: `send-notification` v5 and
`daily-reminder` v4 deployed 9/23 ~18:50 UTC, cron job `silvis-offers-daily` (jobid 3, `0 13 * * *`) created the same minute
(`edge-functions/README.md` §3 deploy record). Still open, as listed at the end of part 3c: the publish e-mail's off-list
line from `diagnostics.offers.outsideOffers`, the period `generated` / `published` status flips from the app (today the
seed apply sets them), and the `apply_trade()` offer upsert.*
**9/23 (item IP):** the in-app Setup import's dry run is now period-aware — `pickSeedFile` plans with `importPlan(seed, { now, offerPeriods: true })` exactly as the CLI does (same Central `today`, the two authenticated-read tables unknown), displays the `call_periods` / `call_offers` legs (`seed-period-legs`) and reads the CLI's totals, while Apply of a period-carrying seed remains the CLI's (`scripts/import-seed.js --apply`); rule (review, same day): once a period is live, `docs/silvis-seed.json` is never applied in-app with its `offerPeriods` removed — the app cannot read `call_periods`, and a period-free plan re-adds the available rows the period retired (the Setup card says so) — and the "legacy plan" statements later in this section describe the state before IP.
Everything below is live; the section reads as its specification.*

Silvis is an **offers** problem where Davenport is a rules problem: the schedule has always been assembled from the
days each surgeon emails in, relayed through whoever is collecting them and retyped by the ER-panel author. From Prompt 14 the
app is where offers live. **Surgeons may enter offers for any future date, whenever they like** (`call_offers`, one row
per person and day, primary / backup / either). A **period** (default 3 months, preset 6; `groupRules.offerPeriods`)
is the generation window: the days inside the next period **freeze six weeks before the current period ends** (= six
weeks before the next one starts; `offers_close_at`, editable per period), the schedule is due four weeks before
(`publish_by`), and reminders go out 14 and 3 days before the freeze to anyone with nothing entered for that period who
has not chosen **"go by my rules"**. Status per surgeon per period is derived, never typed: submitted / rules-only /
not started. A daily cron mode (`daily-reminder` mode `offers`, job `silvis-offers-daily`, Vault secret like the
others) sends the reminders and the close summary; it never generates or publishes. **Data (part 1, applied live
2026-09-22 15:15; `sql/migrations/2026-09-22-offers-periods.sql`, mirrored in `sql/schema.sql`):** `call_offers`
(`person_id`, `day`, `role_pref` primary / backup / either, operational `note`, `entered_by` = the roster id or
`scheduler`, `source` app / email-relay / import; unique per person and day) and `call_periods` (`label`, `start_day`,
`end_day`, `offers_close_at`, `publish_by`, `status` upcoming / closed / generated / published, `rules_only_ids` jsonb
array). The per-period status is `offer_status(period, person)`, never a column. Three fail-closed triggers on
`call_offers`: `OFFER_PAST` (`OF001`, before today in Central time), `OFFER_ON_VACATION` (`OF002`, inside the person's
`time_off`), `OFFER_FROZEN` (`OF003`, a non-scheduler writing or deleting inside a period whose `offers_close_at` has
passed; the scheduler may still enter a late offer). RLS is **authenticated-only** for both tables (never anon: offers
carry person ids and free text): every signed-in user reads, a surgeon writes only their own rows, scheduler/admin
any row and the periods. `call_periods.offer_modes` jsonb (`sql/migrations/2026-09-23-offer-modes.sql`; Faraz 9/22
evening) holds `{person_id: 'exhaustive' | 'preferred'}`, an absent key meaning `preferred`; the SQL side checks only
that it is an object — **applied live 2026-09-23 07:05Z** (the 9/23 audit's column probe reads it; the observed
line goes into `docs/SCHEMA-REVIEW.md` once the orchestrator pastes the probe output; it precedes the seed apply of
part 5, which writes `offer_modes`). Proof: `sql/probes/offers-probe.sql` (rolls itself back) and
`scripts/verify-rls.sh` section 8; the observed runs are in `docs/SCHEMA-REVIEW.md`.

**Part 3a — the painter (built 9/23, sub-part U3a; on `main` and live since the 9/23 merge; the rest of part 3 is below).** `OfferPainterSheet`
in `index-source.html` is a MODULE-SCOPE component (the Davenport reason: inside the app function it would remount on
every parent render and lose the draft), mounted once beside the vacation painter, outside the view conditionals. Entry
points: **My schedule → "Paint my offers"** (the scheduler's person picker turns it into "Paint offers for <name>" — the
relay path: the sheet says "as the scheduler (relayed)" and the function stamps `entered_by 'scheduler'` / `source
'email-relay'`), the nav-bar action **"Paint offers"** for any signed-in surgeon with a roster link, and the deep link
`<app>#offers` (dropped from the URL once opened, like `#openshifts`). The app reads `call_offers` / `call_periods`
through `readAuthOnlyTable` (authenticated-only tables: no fresh token = the read is skipped, never an RLS-empty `[]`
adopted), on load, on the 60-s poll and on realtime changes to either table; My schedule also shows the person's own
future offers and their status on the next period. The sheet: a vertical day list (one row per day, min 52 px,
safe-area padding), month ‹ › from the current Central month forward without limit (‹ is disabled on the current month); brushes Primary / Backup / Either /
Clear (`css.brush` + `OFFER_BRUSH` tokens in `app-styles.js`: the armed chip is a gradient with white text, which the
dark stylesheet exempts); tap = paint the armed brush, tap again with the same brush = clear; a **Range** toggle turns
taps into start / end (same day twice = one day; the hint line names the step and offers "x cancel start"); a
paste-a-date-list box reusing `suParseDateList` (rows become drafts with the armed brush, never writes). Each row shows
the drafted / saved offer as a pill, what is published that day (holders, or OPEN in red at/after today), "N others
offered", and — greyed and disabled — WHY it cannot be offered: `past`, `frozen - offers for <label> closed <date> - ask
the scheduler` (a non-scheduler inside a period whose `offers_close_at` has passed or whose status is no longer
`upcoming` — one reading, `helpers.offerPeriodOpen`, shared with the period box; the scheduler is never frozen, like
OF003), and every **obligation** `rules.eligibility(ctx, day, role, id, { claim: true })` reports for BOTH roles,
classified by `helpers.offerDayWhy` (`OFFER_BLOCK_WORDS`: time-off, day-before-vacation, east-busy, east-forecast-busy,
derived-lock / derived-lock-held, outside-window, holiday-opt-out, backup-opt-out, inactive, **and the person's own
dated rows** unavailable-row / no-backup-row / backup-only-row — `rules.js` keeps those hard whatever an offer says, an
offer only adds a dated *available* bit and never clears a dated statement, so the painter greys them with "ask the
scheduler to change that row first" rather than promising a lift it cannot deliver; 9/23 review). Blocked in one role
only = paintable in the other ("backup only - East busy"). The **weekday-pattern family** (`OFFER_CONFIRM_WORDS`:
hard-never-weekday, weekday-not-allowed, recurring-unavailable, not-recurring-available, weekday-pattern,
weekend-block-only, day-before-aledo, whitelist-month, outside-available-weeks) never greys: painting such a day asks
once per batch ("Tuesday 11/3 is normally not one of your primary call days (never a call day by your rules) - offer it
anyway?") because the saved offer is a dated row that lifts the pattern (item W); obligations are never liftable here.
Every other hard reason (caps, runs, a lock, the other role, `not-offered` — hence `{ claim: true }`) is the generator's
business and neither greys nor asks. `test/data-layer.test.js` section F checks every code in `rules.HARD_REASONS` is
classified on purpose **and proves the split from a real seed ctx**: every confirm code the first period raises (seven)
vanishes once the offer is saved, the three dated-row codes survive it. The **Clear** brush is the one brush that may
reach a greyed row: a SAVED offer under a later obligation (a vacation entered over it) stays tappable for Clear and a
range with Clear armed takes such rows back, while past and frozen rows are skipped and named (the delete guard would
refuse them with OF003 and fail the whole batch). Header counts: primary / backup / either offered in the shown month
(draft applied) and the days offered in the next period against `monthlyCapFor(ctx, id).primary`. **Save = ONE
request** — `POST rpc/save_offers(p_person, p_rows, p_clear, p_period, p_mode)` with the diff
`helpers.offersDraftDiff(saved, draft)` computes (insert + update as upserts, delete as clears, no-ops dropped,
malformed days refused client-side) **and, when the same Save changed the toggle, the period id + mode** — a `security
invoker` function (`sql/migrations/2026-09-23-offer-mode-rpc.sql`, **not yet applied live as of 9/23** - until then Save
answers `404 PGRST202` and the sheet keeps the draft; probe `sql/probes/offer-rpcs-probe.sql`, cases A..K-anon + L / M)
that upserts and deletes in one transaction as the caller, so RLS and OF001–OF003 apply per row, then runs
`set_offer_mode` **inside that transaction** when `p_mode` is given, so a refused mode rolls the rows back too — days +
mode are one commit or nothing (the 9/23 review's finding; two requests could not promise that). A repaint that sends
no note keeps the row's note (`coalesce(excluded.note, call_offers.note)`: the importer's `seed: <tag>` and the relay's
e-mail date survive a role change). `entered_by` / `source` come from the caller identity, never from the client. A
mode-only save (the toggle alone, "Go by my rules") is one `POST rpc/set_offer_mode(p_period, p_mode, p_person)` — a
`security definer` function because a surgeon cannot write `call_periods`: it writes that one person's key only
(`exhaustive` / `preferred` → `offer_modes[person]` and off `rules_only_ids`; `rules_only` → on `rules_only_ids`, key
dropped, refused with OM006 while the person has offers inside the period), refuses a non-scheduler after the close
(OM005) or naming someone else (OM002). Then **ONE audit row `offers.save`** (`detail.count`, `inserted` / `updated` /
`deleted`, `period_id`, `period`, `mode`). A draft that turned into nothing to write (equalised by a reload from another
device) is dropped with "Already saved - nothing to write" — no request, no audit row. A failed batch shows "Nothing
was saved" naming every pending entry with the database's token verbatim (`describeDbError` now shows `OFFER_*`,
`OFFERS_*`, `MODE_*`), keeps the draft and the unsaved count; Discard and Close confirm on a dirty draft; the saved
note clears after 3 s. The period box speaks to `helpers.offerNextPeriod`: **the earliest period still OPEN for offers**
(status `upcoming`, `offers_close_at` after today), falling back to the running frozen one only when nothing is open —
so from the freeze (10/2) the sheet targets the next period as soon as part 3b creates it, and until then a
non-scheduler sees the frozen one **read-only** ("Offers for <label> closed 10/2 - ask the scheduler for a late
change", no toggle, no "Go by my rules"; the scheduler keeps both, as OM005 lets him). On the phone the box is **one
summary line** by default (`<label> - freezes 10/2 - nothing yet - preferred days`, beside "Paste dates" and "My
rules"), so the day list keeps at least 45 % of a 390 x 844 viewport (the smoke measures it); **Change** expands the
toggle **"Only these days"** / **"These are my preferred days - use my rules to fill gaps"** (default) with one
explaining line and **"Go by my rules for <label>"** (shown until the person has offers inside the period; its confirm
speaks that person's rules in words from `surgeonRules` — `helpers.offerRulesWords`, data-driven, no name branch); a
dirty mode keeps the box open, a Save or Discard folds it. A rules-only surgeon who paints a day inside the period
comes off the list by that save (the derived status would contradict it otherwise). Smoke (`test/ui/smoke.mjs`, both
themes, 390 px + 1180): paint five days with three brushes including a range, the Tue/Thu confirmation counted once
per batch, "1 other offered", the header counts, the list height, Change + the toggle, a forced OF002 failure (one
attempt, nothing else written, every entry named, draft kept), the real Save = exactly one `save_offers` carrying
`p_mode` + one `offers.save` audit and **no** `set_offer_mode`, rows read back saved, the box folded, the note
clearing, tap-again = "will clear", Close confirming, the scheduler's relay for Fierce with Change → "Go by my rules"
(one mode call, one audit), dark at both widths; screenshots `offers-greyed-390.png`, `offers-armed-390.png`,
`offers-range-390.png`, `offers-saved-390.png`, `offers-desktop.png`, `offers-desktop-dark.png`, `offers-390-dark.png`.

**The scheduler's side — Periods (part 3b, U3b, 9/23):** Setup → Generate grows a **Periods** section above the
Generate panel (`PeriodsSection`, module scope, behind the Setup view's scheduler gate; RLS on `call_periods` is
scheduler-only as well). **New period** opens a form pre-filled from the presets in `groupRules.offerPeriods`
(`presets` 3 / 6 as buttons; `helpers.offerTimeline` fills end = the last day of the Nth calendar month, extended to
the following Sunday from a Friday or Saturday, offers close = start − `closeWeeksBeforeStart` weeks, publish by =
start − `publishWeeksBeforeStart` weeks, label "Jan 2027 - Mar 2027"); the start defaults to the day after the last
period on file; every date stays editable per period (a preset click refills every date from the rules; a changed
Start re-derives only the fields the scheduler has not edited by hand, so a hand-set close date or label survives a
nudged start), and the form refuses — before any request — a close after the start (the DB check), a duplicate
start (the unique index) and an overlap with an existing period, and warns when the close has already passed. The
draft is `CallSchedule` state (`prdDraft`, like `genOpts`), so collapsing the Generate card or changing tabs keeps a
half-filled form. **Create** = ONE `POST call_periods` with `Prefer: return=representation` through
`dbAuthHeaders()`, status `upcoming`, empty `rules_only_ids` / `offer_modes`; a 2xx that returns no row (an RLS no-op)
is a failure, and only after the row comes back does the client write ONE audit row **`period.create`**. Each period
renders as a box: label, range, a status pill (upcoming / upcoming − frozen once `offers_close_at` ≤ today / closed /
generated / published), "offers close … publish by …" with the days to go, and a **per-surgeon table** derived on
the spot through `helpers.offerRollcall` over `helpers.offerPoolIds` (active, non-outside roster entries): *submitted
N days* (title = primary / backup / either breakdown), *rules only*, *not started*, and the mode (*only these days* /
*preferred days* / *preferred days (default)*; "-" for rules-only). Per row: **Remind** — on `not_started` rows of a
still-open upcoming period only; ONE `send-notification` call, category `offers_reminder`, `targetIds` [that person],
the words composed by the client exactly like the morning run's (`buildOffersReminder`: "Your dates for <label> (<start>
to <end>) freeze on <date> (in N days) - paint them in the app or choose 'go by my rules'…", `detail` = the `#offers`
deep link; the dates spelled as the cron spells them — `prdDayWords` mirrors `fmtDay`, "Friday, Oct 2" — so a surgeon
who gets both notes reads one spelling); the server honours `schedule_updates_email` and the client already greys the button when the loaded
preference says off; the row then reads "reminded <time>" / "e-mail off - not sent" / "no linked e-mail - not sent";
nothing else is written. **Enter for <name>** opens the offer painter as that surgeon, targeted at that period (the
sheet's new `preferPeriodId`: its period box, toggle and counts speak to it and it opens on the period's first month);
`entered_by 'scheduler'` / `source 'email-relay'` are stamped by `save_offers` from the caller identity — the client
sends neither. The scheduler's own row reads **Paint my offers** instead (his own offers: `entered_by` him, `source
'app'`, exactly as My Schedule's button). **Close now** = the freeze, early: a confirm that names the standing (who has how many days, who goes by
the rules, who has nothing), then ONE compare-and-swap `PATCH call_periods?id=eq.<id>&status=eq.upcoming` to `closed`
with `return=representation` — zero rows back means the morning run or another scheduler got there first (or the
account cannot write periods) and is reported, never audited; one row back → ONE audit row **`period.close`** (`by
scheduler`, the roll call in the detail). The two closers therefore meet on the same flip and only one of them logs
it. **Generate this period** = the existing preview flow (`runGenerate`) with the range set to the period — same
options, confirmations, snapshot and CAS writes, Accept & Publish below it unchanged. Until `offerRows` /
`periodRows` enter `ctxInputs` (below) this places **by the standing rules**, not offers-first, and the section says
so where the scheduler reads it (the intro paragraph, the Close-now toast, the button's title); a data-layer pin
trips when the wiring lands so the copy is rewritten with it. The section paints its own text in the muted token the
dark sheet remaps (`PRD_MUTED` = `#5B6B82` → `#9FB0C8`); only the status pill, which keeps its own light background,
uses an unmapped grey. Smoke (`test/ui/smoke.mjs`, Setup section, both themes, 1180 + 390): the seed period's table
equals the harness's own restatement of `offer_status()` over its stores, Remind on the not-started rows only while
open, the scheduler's own row 'Paint my offers' and the others 'Enter for <name>'; Remind on one = exactly one
`send-notification offers_reminder` with the cron's subject and date spelling and nothing else; a start inside the
seed period refused with zero writes; the 3-month preset's four dates and label equal the harness's date maths; a
hand-set close survives a nudged Start while publish re-derives, the draft survives the card collapsing and
reopening, a preset click refills every date; Create = one POST + one `period.create`; Close
now dismissed = zero writes, confirmed = one CAS PATCH + one `period.close`, the box closed with no Remind / Close
now; Enter for Acton opens the relayed painter targeted at the seed period on its first month; Generate this period
runs the existing flow over the period with no writes; screenshots `periods-desktop.png`, `periods-390.png`,
`periods-desktop-dark.png`, `periods-390-dark.png`.

**What part 3b left for later, and where each item stands (B10, 9/23 evening):** the wiring of `offerRows` /
`periodRows` into `ctxInputs` → `buildContext` (`offers`, `periods`) — done in part 3c below (the painter and the Periods
sub-part had deliberately not done it, because the moment offers reach the ctx an exhaustive surgeon's `not-offered`
becomes live in the day editor, the generator and the trade path, and the trade path had to take the claim reading
first); the in-app Setup import planning with `importPlan(seed, { now, offerPeriods: true })` and refusing Apply for a
seed that carries periods — done (item IP, top of this section); the day editor's "offered primary / either / backup —
rules — not offered" line per candidate — done (3c). The two RPCs are mirrored byte for byte into `sql/schema.sql`,
pinned by `test/schema.test.js` and recorded in `docs/SCHEMA-REVIEW.md` with the observed probe of the 9/23 ~18:45 UTC
apply. Still open: the publish e-mail line from `diagnostics.offers.outsideOffers`, and the period's `generated` /
`published` status flips from the app (today the seed apply carries a status; proposed: Accept & Publish marks the
periods its range covers `published`).

**Part 3c — the wiring, the day editor and My schedule (U3c, 9/23):** `offerRows` / `periodRows` now enter `ctxInputs` as `offers` / `periods` (the one site; `[]` for an anon or token-less reader, so public mode is never offers-governed), which makes "Generate this period" offers-first and an exhaustive surgeon's `not-offered` live in the day editor; the board gate and `tradeEligibility` pass `{ claim: true }` (a claim or a trade acceptance is an offer made on the spot — the hard reason is skipped, the soft `outside-offers` still surfaces; `apply_trade()` does not yet write the offer row — open); the day editor shows, per role block, `Offers (<period label>): <name> - offered primary | backup | either / offered <x> only, not <role> - … / not offered - only these days: ineligible | preferred days: penalty / rules (chose go by my rules | nothing entered)` (`offerCandidateWords`, module scope, from `rules.offerState` on the draft ctx; an eligible dropdown option carries the short tag; `REASON_WORDS` glosses the hard `not-offered`, `softTag` the two soft reasons); My schedule marks each upcoming assignment inside a period the person submitted for `offered` / `offered P|B only` (the other role) / `not offered` and each My-offers pill `(placed)` when the day is already held. Review fixes (9/23): offers-first is only claimed when the two tables were actually read — `offersLoad` records ok / skipped / failed per table and `offersLoadVerdict` (module scope) makes `runGenerate` refuse before the first successful read of both (a token-less scheduler cannot preview a rules-only schedule under offers-first copy) and stamp `previewGen.offersStale` (red warning in the preview header, forced confirm on Accept & Publish) when a later refresh was skipped; the editor's Offers line lists an inactive surgeon only while he holds the draft's slot. Still ahead from the list above (the in-app Setup import switch landed as item IP): the publish e-mail line, the `generated` / `published` status flips, and the `apply_trade()` offer upsert.

**Eligibility is offers-first, at the hardness each surgeon chooses (built in Prompt 14 P2, 9/23):** `rules.buildContext`
takes two more inputs, `offers` (`call_offers` rows) and `periods` (`call_periods` rows with `rules_only_ids` and
`offer_modes`), and derives per surgeon per period the same status SQL `offer_status()` gives — submitted (one or more
offers inside the period), else rules-only (listed), else not started — and the mode, `offer_modes[id]` or `preferred`.
Inside a period a submitted surgeon is offers-governed: in **exhaustive** mode ("only these days") every day/role he
did not offer is the hard `not-offered` (`either` covers both roles); in **preferred** mode (the default, "my
preferred days; use my rules to fill gaps") an offered day carries the soft `offered` bonus (`-weights.offerBonus`, 6)
and any other day is eligible under his ordinary rules with the soft `outside-offers` penalty (`+weights.outsideOffers`,
6) — since B10 (9/23, rules doc §6) **only in a calendar month where he offered at least one day of that period** (`P.offerMonths`, keyed per period — an offer after the period's end or in the next period never switches a month on for this one);
in a month he did not paint at all he competes on the equal share like a rules-only colleague, while his status stays
submitted period-wide and `diagnostics.offers.outsideOffers` still lists every off-list placement — both weights
Setup-editable like the others (`outside-offers` is also carried on an exhaustive surgeon's claim result in any month,
where `not-offered` is skipped, so the board can name the day as outside his offers). Every offer is folded into the same dated-row map the availability
rows feed, so it is a dated row in item W's sense: it lifts the weekday-pattern family (hardNeverWeekdays included)
for that date and role and never an obligation — vacations and the trailing edge, East busy / forecast / standing days,
derived-week locks, windows, backupOptOut, caps, runs, the other role all still apply on an offered day. The dated
lists (`whitelist-month`, `outside-available-weeks`) are not applied to a submitted surgeon inside the period (offers
supersede them — one mechanism); rules-only and silent surgeons, and every day outside a period, get today's rules
byte for byte (the whole regression runs unchanged with `periods: []`). This is the answer to the Tue/Thu gap (rules
doc §8 item 12): Acton's and Philip's rules allow those days even when their lists do not name them. A Prompt 13
claim is an offer made on the spot: `eligibility(ctx, day, role, id, { claim: true })` skips the exhaustive
`not-offered` only, and `claim_open_slot()` writes the `call_offers` row (`sql/migrations/2026-09-23-claim-offer.sql`,
applied after the open-shifts branch; the freeze guard yields to a claim in progress, transaction-locally) — except
for a claimer listed in the period's `rules_only_ids`: he chose "go by my rules", one offer row would flip his derived
status to submitted for the whole period, so his claim is recorded in `schedule_days` and the audit row (`detail.offer
= false`) only; a surgeon with nothing entered does get the row and becomes submitted (preferred) by it. **Trades are
not there yet (review 9/23):** the trade path (`tradeEligibility` / `tradeEligibilityOver` in `index-source.html`) calls
`eligibility` without the claim flag and `apply_trade()` writes no offer row, so once part 3 passes `offers` / `periods`
into `ctxInputs` an exhaustive surgeon could not be traded onto a non-offered day; part 3 must either pass `{ claim:
true }` there (a trade acceptance is an offer made on the spot, the same reading as a claim) and give `apply_trade()`
the same upsert block, or Faraz rules that such trades are refused — latent until then, because `ctxInputs` carries
no offers today. The generator adds order and one fairness rule: after locks, holiday units and derived weeks, the
day and weekend units an eligible surgeon offered are filled before the rest (`genOfferedUnits` / `genOrder`), so a
surgeon's offered days are placed before his own non-offered placements can consume his caps or runs; the bonus
already makes an offered candidate beat a rules-only candidate for the same slot; and **the bonus stops at the share**
(`genOfferTaper` in every candidate score and `genTaperSoftList` in the evaluation): once a placement no longer brings
him towards his target for the role and month, the offered term reads `-weights.offerBonusOverShare` (seed 0; 6 =
the untapered reading), so a surgeon who paints the whole month ends the month at his share within
`smoothingTolerance` and the rest goes to the colleagues below theirs — an offer is not a demand (review 9/23
measured Acton offering every November day, seeds 1–3: 12 primaries / 5 backups against targets of 8 / 3 before the
taper, 11 / 10 / 9 primaries and 3 backups after it — his eight primary locks already equal his target and November's
open primaries exceed the sum of everyone's targets, so every over-share day of his is one no colleague below his own
share could take, which is the invariant the regression pins; caps stay hard; a surgeon with no target — a windows
surgeon — is never tapered). `diagnostics.offers`
= the periods touching the range, `byPerson[id] = { status, mode, offered, placed, unplaced: [{ day, role, reason,
holidayUnit }] }` (unplaced offers carry the slot's reason — `slot-locked:<id>`, `holds-other-role`, `held-by:<id>`…;
on a holiday-unit day the cause, `holiday-unit:<name> <day> <reason>`, the unit's other day he fails, because one
holder covers every unit day), and `outsideOffers = [{ day, role, id }]`
(every generated placement of a submitted surgeon on a day he did not list — the publish email of part 4/6 reads it:
"you were placed on 11/5, a day you did not list — trade if needed"); an open slot inside a period carries
`offered` (who offered it) and the note "no offer and no rule allows it" when nobody did. Helpers own the period
maths (`periodFor`, `offerStatus` mirroring the SQL, `offerTimeline` from `groupRules.offerPeriods`: close = start −
6 weeks, publish by = start − 4 weeks, reminders 14 and 3 days before the close, end = the last day of the Nth month
extended to a Sunday like the Generate presets). The ER-panel author's Word document is **retired at go-live** (Faraz 9/22
evening): the app is the source of truth; the ER-panel author keeps a viewer account, the weekly office digest and the ER Call Panels
export for a paper copy. Published assignments remain locks. Proof: `test/rules.test.js` and
`test/generator-regression.js` Prompt 14 P2 blocks (the real November lists as offers,
`test/fixtures/offers-2026-11.json`), `test/offers.test.js` (period maths, SQL parity, seed and migration pins).

**The first period, through the importer — one mechanism (part 5, built 9/23).** The dated lists that reach the
first period do so as `call_offers` rows planned by `importer.js` from `docs/silvis-seed.json`, never by hand. The
seed carries `offerPeriods[]` — Nov 2026 – Jan 2027 = 2026-11-02 .. 2027-01-03 (the milestone range), `offersCloseAt`
2026-10-02 set by hand (the computed date is past; Faraz may rename it), `publishBy` 2026-10-05, `status upcoming`,
`rulesOnly` Khan + Sarkar, `offerModes` Burchett + Philip **exhaustive**, Acton + Fierce **preferred** — and, per surgeon,
`offerSources` tags on the lists that *are* the offers: Burchett's `explicitAvailable` November (role-keyed, his 9/17
email) and December (plain, the 9/17 thread), Acton's relayed November days under a new `offeredDays['2026-11']` (not
`explicitAvailable`, whose key alone would re-govern November — Prompt 12 Y), Philip's `availableWeeks` (his 9/20
email). Burchett's and Acton's **October** lists are not tagged: October precedes the first period and stays a dated
availability list. Fierce has no dated single day inside the period in the seed (10/12 is October; his 11/9–11/16
backup rows are his derived week plus Faraz's 11/16 decision, locks), so he reads *not started* until he paints
(seed open question 16). `importPlan(seed, { offerPeriods: true })` — **opt-in; the CLI always passes it, the in-app
Setup import does not until part 3** (it applies availability / time_off / schedule_days only and cannot write
offers, so a period-aware default there would retire a whitelist without writing the offers) — plans one `call_periods`
row (upsert by `start_day`; the seed owns label, dates, `rules_only_ids` and its `offer_modes` keys, merged so app-set
modes for others stay; the seed's `status` advances the live row one way — upcoming < closed < generated < published — and never moves it back, so the 9/23 `published` of the first period reaches its row while a stale seed `upcoming` cannot reopen a period the cron or the app closed; PD 9/23, before it status was written on insert only) and the `call_offers` rows: one
per listed day inside the period **on or after today in America/Chicago** (the trigger refuses a past day, OF001);
`role_pref` from the list's role, a plain list = `either` (an optional `rolePref` on the tag overrides it); a day
inside the person's seed vacation is skipped and listed (OF002 would refuse it); a day that is already locked stays an
offer (Burchett's superseded 11/9, 11/14–16 backups and 11/25 primary, Acton's 11/5 backup — they come back as unplaced
offers, the record stays honest); `entered_by 'scheduler'`, `source 'email-relay'`, `note 'seed: <tag>'`. That note
shape plus source and `entered_by` is the seed's ownership mark (as `schedule_days` notes carry `seed: <source>`):
stale seed-owned offers are deleted set-based for days on/after today only, and an offer entered or relayed **in the
app** is never updated or deleted (a planned row over the surgeon's own entry reads *blocked* in the diff). For a
surgeon so *submitted* the importer writes **no `available` row** for a day inside the period and **no
`explicitListMonths` entry** for a month overlapping it (Burchett's blob entry becomes October only; his statement
lists stay in the blob as data); `unavailable` / `no_backup` / `backup_only` rows and everything outside the period
are unchanged, row for row. The per-surgeon status the dry run prints (`surgeon | status | mode | offered days`) is
derived like SQL `offer_status()` from the whole list, whatever today is. Live consequences of the first apply:
`call_periods` insert 1, `call_offers` insert 79 (Burchett 34 = 7 P + 8 B + 19 either, Acton 10 = 7 P + 3 B, Philip
35 = five weeks × 7 either), `availability` delete = Burchett's November / December available rows, blob
`surgeonRules` update, `schedule_days` / `time_off` unchanged. Two facts about the two tables shape the tooling:
they are **authenticated-read**, so the CLI never fetches them with the anon key (200 + `[]` would masquerade as an
empty table — probe I, 9/22): the dry run reads them as *unknown* (every planned row an upsert, counted so the apply
is never skipped) and `--apply` verifies them from the rows the SQL's own returning select hands back
(`call_offers_rows` / `call_periods_rows`); and the `call_offers` insert **selects from a VALUES list and proposes
only rows that would change** (a new `(person_id, day)`, or a seed-owned row whose role / note / source differ) —
a row-level BEFORE INSERT trigger runs for *every* proposed row before the conflict check, so a plain
`insert … values … on conflict do update where …` would put all 79 rows through OF001/OF002/OF003 on every run and,
from `offers_close_at` on, roll the whole import back although nothing changed (the CLI runs as postgres, not as the
scheduler; 9/23 review). As written, a re-run of identical data proposes nothing and fires no trigger; a re-run that
*adds or changes* a seed-owned offer inside the period after `offers_close_at` (2026-10-02) is refused by OF003 and
rolls back loudly — so **the seed's offers must be applied before 2026-10-02**, and late offers are the scheduler's to
enter in the app **once the Periods section ships (the UI wave)** — before that the only late path is a scheduler-JWT
REST write (OF003 is skipped for `silvis_is_sched()`; the CLI is refused). Three consistency refusals guard the seed itself, whether or not the option is on: a surgeon *with*
a mode in a period may not keep an **untagged** `explicitAvailable` / `offeredDays` / `availableWeeks` list that
reaches into it (`OFFER_SOURCE_INVALID` — his status would retire the rows and the month while no offer carried the
days), periods never overlap, and a period label is gated against the note denylist like an offer note (it reaches
the authenticated-read `call_periods`). A submitted surgeon whose planned rows come to 0 (listed days all past or on
a vacation) is named in the dry run's warnings: the retirement follows the whole list, but a fresh database would read
him `not_started` until a row exists.
A planned offer inside a **live** vacation (`time_off` is anon-readable) is listed and blocks `--apply` (exit 3): the
whole transaction would roll back on OF002. One consequence for Faraz (seed open question 15): a plain list under
exhaustive is `either`, so Philip's weeks now limit his **backup** to the listed days too (before the period the weeks
whitelist governed primary only; Burchett's December list already governs both roles since 9/23 - the object entry -
so nothing changes for him) — `rolePref: "primary"` on the tag or `preferred` mode restores the old reading, data only; **his answer is time-coupled**: it lands as a seed re-import,
which after 2026-10-02 is refused by OF003 (above), so it must be settled before the close or entered in-app by the
scheduler. **Where the in-app side stands after the 9/23 rebase (part 3 landed):** `index-source.html` passes `offers` /
`periods` into `buildContext` (the U3c pin in `test/data-layer.test.js`), so every in-app consumer of `eligibility()`
(Generate, trade acceptance, the day editor's warning) reads the period as soon as its row exists — after the apply the
live blob has no November / December whitelist for Burchett and none of his 20 `available` rows, and the offers carry
those days instead. The in-app Setup import, however, still builds the **legacy** plan (`importPlan(seed, { now })`,
no `offerPeriods`): it writes no `call_periods` / `call_offers`, and after the apply it would re-add the whitelist and
the 20 rows. The panel therefore **refuses Apply** for a seed that carries periods the plan did not convert
(`plan.offerPeriods = { enabled: false, seedPeriods: n }` → the `seed-period-block` note naming the count and the CLI
command, the button disabled, a second guard in `applySeedImport`; the dry run stays informational and its diff text
carries the importer's own 'offer periods: the seed carries n period(s) that this plan did NOT convert' line; the
smoke pins it with the seed plus one date, then runs the Apply mechanics on the same seed without `offerPeriods`, a
byte-identical legacy plan). The CLI is the period-aware path; switching the in-app import to
`importPlan(seed, { offerPeriods: true })` with period / offer writers is still open. The published / locked rows are
untouched by the apply either way. `--offers-json <path>` writes the planned `{ periods, offers }`
for an offers-aware generate run; `importer.impSeedContextInput(seed, { offerPeriods: true })` builds the same world
for tests. Proof: `test/importer.test.js` Prompt 14 P5 block (the period row, the 79 offers with exact days and roles,
the Central today filter, the vacation skip, the retired rows and months, October untouched, the SQL shape, the
unknown / exact / blocked diffs, an app-entered offer never deleted, the offers-aware ctx), `test/data-layer.test.js`
P5 block (snapshot scope).

**Notifications — the timeline runs itself (part 4, built 9/23).** `send-notification` gains the categories
`offers_reminder` and `offers_closed`: the client composes the words, both honour `schedule_updates_email`, recipients
are `user_profiles` rows by `person_id` like every other category (the Periods "Remind" button of part 3 sends
`offers_reminder` with a session to one `not_started` surgeon; never a broadcast). `daily-reminder` gains mode
`offers` behind the same `x-cron-secret` gate and `dryRun` contract as its other modes, posted once a morning by the
pg_cron job `silvis-offers-daily` (`0 13 * * *` = 08:00 CDT / 07:00 CST, Vault secret, body `{"mode":"offers"}`;
`edge-functions/README.md` §4). For every `call_periods` row still `upcoming` it runs the timeline maths: on a
reminder day (`offers_close_at` − each `groupRules.offerPeriods.remindDaysBeforeClose`, default 14 and 3) it e-mails
the pool members whose derived status is `not_started` — "your dates for <label> freeze on <date> — paint them in
the app or choose 'go by my rules'"; from `offers_close_at` on it flips the row to `closed` by compare-and-swap
(`status = upcoming` → `closed`, so a parallel close or the app's "Close now" wins and no second summary goes out),
writes the audit row `period.close` (`actor_id` `cron`) and e-mails the scheduler / admin accounts the roll call —
who submitted how many days, who is rules-only, who never answered (the reminder honours `schedule_updates_email`;
the roll call is unconditional — an operational notice to whoever runs the period, so a period never closes with
nobody told; the reminder's footer names the effective offsets, never a literal). It never generates or publishes, never writes
`call_offers`, and a dry run composes without writing or sending; responses carry person ids and counts, never an
address. **The date maths lives once:** `helpers.offerCronPlan(period, today, rules)` (remind / close / none with the
reason and `days_to_close`; close beats a 0-day reminder; any status but `upcoming` is `none`), `offerRollcall(period,
offers, ids)` (status per `offerStatus` + distinct offered days inside the period) and `offerPoolIds(roster)` (active,
non-external), built on `offerTimeline`; the edge function carries a plain-JavaScript mirror between the
`@offerTimeline-mirror-start` / `-end` markers, and `test/offers-timeline.test.js` runs helpers and the extracted
mirror against the same `test/fixtures/offer-timeline.json` (plus 400 seeded random periods), then pins the
categories, the gate and dispatch, the read set (periods, offers, blob, `user_profiles`, `notification_preferences` —
never an anon-readable table for recipients), the CAS + dry-run guards, the README cron statement and this
paragraph. For the first period (close 2026-10-02) the reminder days are 2026-09-18 (past) and 2026-09-29, and the
close summary goes out on 2026-10-02 — the cron must be live by 9/29 for Fierce (`not_started`) to be reminded.

**Where Prompt 14 stands after the 9/23 rebase onto `main`'s audit landing (parts 1, 2, 4, 5, 6 and the UI wave 3a /
3b / 3c are on `main` together — this text is part 6 brought up to date).** In the repo: the schema artefacts
(`sql/migrations/2026-09-22-offers-periods.sql`, `2026-09-23-offer-modes.sql`, `2026-09-23-claim-offer.sql`,
`2026-09-23-offer-mode-rpc.sql`, `sql/probes/offers-probe.sql`, `sql/probes/offer-rpcs-probe.sql`, `sql/schema.sql`
mirroring every applied body), the engine (`rules.js`, `generator.js` — offers first on top of the water-filled share,
`helpers.js`), the importer plan and CLI (`importer.js`, `scripts/import-seed.js`), the two edge-function sources, the
painter, the Periods section, the day editor's offer column and My schedule's offers (`index-source.html`), the seed's
`offerPeriods[]` / `offerSources` and every test named above. **Live (all three of the 9/23 live steps landed the same
day; B10 restates them):** (1) the two RPCs — `sql/migrations/2026-09-23-offer-mode-rpc.sql` (`set_offer_mode`,
`save_offers`) and their probe, applied 9/23 ~18:45 UTC (before it the painter's Save answered `404 PGRST202`); (2) the
seed apply — `node scripts/import-seed.js --apply --workdir <linked dir>` — the first period's `call_periods` row, 79
`call_offers` rows (Burchett 34, Acton 10, Philip 35), the 20 retired `available` rows and the blob's `surgeonRules` /
`groupRules` / `settings`, then (PD, 9/23 afternoon) the second apply: the first period's row updated to `published`, the
Feb 2027 – Apr 2027 row inserted (freeze 12/21, publish by 1/4, no rules-only list, no modes; its end 4/30 → Sun 5/2 since Faraz's 9/24 SQL update, and the Jan 2027 row he created the same morning sits before it — both in the seed), Burchett's 2027-07-22..08-02
`time_off` row, the offers unchanged at 79 — all before 2026-10-02 (OF003 refuses seed-entered offers inside a period
from its close on); (3) `send-notification` v5 (the offers categories over the v4 role / party gate) and
`daily-reminder` v4 (mode `offers` beside open-shifts) deployed 9/23 ~18:50 UTC, then the `silvis-offers-daily` cron
(jobid 3; README §3 deploy record + §4) — in time for Jan 2027's 11/9 and 11/20 reminders (freeze 11/23) and Feb – Apr 2027's 12/7 and 12/18 (the first period is
`published`, so its 9/29 reminder and 10/2 close mail never fire). The in-app Setup import plans period-aware since item
IP (top of this section) and refuses Apply for a seed that carries periods; a snapshot restore in the app writes
`time_off` / `availability` back but not the offers or periods it captured - it says PARTIAL (§3 backup scope). The
**offers-aware preview regeneration** the prompt's part 5 asks for was **not** run for the first period (it was published
9/23 from the rules-based preview; `scripts/import-seed.js --offers-json <path>` writes the generate input, but
`scripts/preview-generate.js` does not read it) — the Prompt 14 P2 regression on `test/fixtures/offers-2026-11.json` is
the proof that Burchett's and Acton's November days come out as the ER-panel author published, and the app's "Generate
this period" is the offers-first path for every period after the published one (Jan 2027, then Feb – Apr 2027). Decisions recorded for the first period: the offer modes
(rules doc §8 item 20 — Burchett / Philip exhaustive, Acton / Fierce preferred, Khan / Sarkar rules-only, set 9/23 as
defaults) and the two consequences recorded there; `offers_close_at` 2026-10-02 (data, renameable).

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
| 1 (E1) | *Refresh from Davenport* also reads the Davenport `time_off` table (read through the East feed's existing read path — probed 2026-09-22; path **1a**, no paste box, no Davenport change) for the codes of every surgeon whose East feature reads busy days, `kind = vacation` only, and caches the ranges per published week in the `east_feed` payload `data.vacations: [{ code, start, end }]`; a range beyond the published weeks rides on the latest cached week; a failed `time_off` read keeps the cache and says so. Details in §7 (the *East vacations* bullet). | `east-feed.js` (`fetchEastWeeks(from, to, { vacationCodes })`, `planVacationCache`, `eastVacations(rows, code)`), `refreshEastFeed` in `index-source.html` |
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
  `eastvac.review`** `{ person_id, start, end, decision: 'away' | 'home' | 'reset', reason, removed? }` is logged;
  nothing else is written.
- **The `home` → `either` offers step: retired (B10, 9/23).** Prompt 15 had left a hook, `offerEitherForHomeRange`, as
  a documented no-op (it returned `{ ok: true, offered: 0, pending: "prompt-14" }` and carried a `TODO(Prompt 14 UI wave)`)
  for the day the painter existed: a home decision would offer to paint the range's days as `either` offers in one tap.
  The painter exists (§17 part 3a) and is the one place a surgeon offers days, with one write path
  (`commitOffersPaint` → `save_offers`); a second entry into `call_offers` from the East-vacation review was not worth a
  second confirm sheet, so the hook and its call were removed. A home decision saves the review row only; the toast says
  the days are available at Silvis and preferred for primary, and the person paints them in *Paint my offers* if he wants
  them offered. Data-layer pin: the hook, its `pending: "prompt-14"` shape and the `TODO(Prompt 14 UI wave)` marker are
  gone from `index-source.html`, and `saveEastVacationReview` writes no `call_offers` row.
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
  day inside the person's own East vacation (the locked Thanksgiving unit case: the range over his own unit, unreviewed, lists his four
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
  is **gitignored**; nothing was copied into `docs/screenshots/` in this delivery, as of `19b9efc` (part 4 added no binaries),
  and since B10 (9/23) the repo carries no screenshot folder at all: the open-shifts set that used to live there showed the
  local harness URL in the e-mail preview, and the harness cannot render the production origin, so review shots stay in
  `test/ui/out/` on the machine that ran the smoke. The files of the 2026-09-23 07:15 run were 43 / 41 / 44 / 41 / 106 / 137 KB.
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
6. Faraz, after the deploy: Setup → East feed → *Refresh from Davenport* (his Davenport `time_off` rows arrive —
   fewer *ranges* where adjacent or overlapping rows merge (`eastMergeRanges`), so the toast names the merged count,
   which may be fewer than the rows), then **home** on the range over his Silvis Thanksgiving unit (per the prompt) and the rest as he decides. Until he
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
5. **Davenport side** (not changed from here): Silvis reads only FAK's rows, through the East feed's existing read
   path; the Davenport project's own read posture is Faraz's call there.
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

*9/23 (audit T1 / T4): the 9/23 preview (`PREVIEW-2026-11-02-to-2027-01-03.{md,json}`, since B10 in the private folder - `docs/HISTORY.md`; the JSON's copy is `test/fixtures/publish-preview-2026-09-23.json`) and the committed `docs/PUBLISH-2026-09-23.md` are the record of the 9/23 publish and are never regenerated or overwritten in place — `preview-generate.js` writes to the OS temp dir unless `--out` names a file (a new range gets a new file name), and `publish-preview.js` writes a dry run's, a refused apply's or a nothing-to-apply run's report to the scratch path and a real apply's report to a new dated `docs/PUBLISH-<YYYY-MM-DD>-<hhmm>.md` (UTC) unless `--report` names one; every script under `scripts/` answers `--help` and refuses an unknown flag without running anything (`test/ci.test.js` section 6).*

*9/23 (item IP): `scripts/import-seed.js --apply` remains the only apply path for a seed that carries offer periods — the in-app Setup import now plans period-aware like the CLI for its dry run (same `offerPeriods: true`, same Central `today`, `call_offers` / `call_periods` passed as unknown), displays the period / offer legs and refuses Apply for such a seed.*

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
10/20, 10/22 — the report is history, `docs/HISTORY.md`). It reads the live rows with the anon key, evaluates each
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
