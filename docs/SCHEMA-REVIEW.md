# Schema review (Prompt 2) — `sql/schema.sql`, 2026-09-22

*Reviewed before the schema was applied to the empty Silvis project (`bzhsroegtagqhutbnsrp`, zero public tables at the
time). Findings marked **applied** were written into `sql/schema.sql` in the same commit and applied through the
Supabase CLI's linked Management-API path (`supabase db query --linked -f sql/schema.sql`), so no live data was at risk.
Verification: `scripts/verify-rls.sh`.*

**Live and `sql/schema.sql` agree again since the 9/23 `feat/offers` merge (audit RLS-2 closed):** `claim_open_slot` and `call_offers_guard` are mirrored from `sql/migrations/2026-09-23-claim-offer.sql` (applied 2026-09-23 07:05Z) and `call_periods` / `call_offers` / `offer_status()` / the `OF001`-`OF003` guards / `offer_modes` from the 9/22 and 9/23 migrations; `test/schema.test.js` compares every migrated body against the newest migration touching it, so the file is re-runnable wholesale again. The only bodies in the repo that are NOT live yet are `set_offer_mode()` / `save_offers()` (`sql/migrations/2026-09-23-offer-mode-rpc.sql`, the orchestrator's next step - subsection below).

## (a) Tables, one line each

| Table | Purpose |
|---|---|
| `user_profiles` | Auth user → roster id + role (`admin`/`scheduler`/`surgeon`/`viewer`); the only place a surgeon's email exists besides `office_contacts`. Authenticated-read. Prompt 20 F1 (applied 2026-09-27 00:43:54Z, report-first - see the section at the end): `follows` jsonb, the roster ids an account follows (admin-set). |
| `call_schedule_data` | One row `main`: roster (names/codes), `surgeonRules`, `groupRules`, holiday units, settings blob. Anon-read. |
| `schedule_days` | The schedule, one row per day: `primary_id`, `backup_id`, per-role locks, `source`, `external_cover`, `note`, `version` (compare-and-swap on publish). Anon-read. |
| `time_off` | Vacations only, self-entered, no approval; a trigger refuses a range over a day the surgeon is published (and the day before, for primary). Anon-read. Vacation guard (Faraz 9/30, **prepared 2026-09-30 - report-first, NOT APPLIED** - section at the end): a second trigger, `time_off_vacation_guard_trg`, refuses a non-scheduler's vacation that would leave fewer than `groupRules.vacations.minSurgeonsAround` (default 2) active surgeons around (`VG001 VACATION_TOO_FEW_AROUND`). |
| `availability` | Dated availability statements by kind/role (windows, whitelists, backup-only, no-backup…). Anon-read. No-primary days (Faraz 10/1, Prompt 28): surgeons / the office write single-day `backup_only` rows only through `save_offers` -> `save_no_primary` (prepared 2026-10-01, NOT APPLIED - section at the end); RLS unchanged (no surgeon write policy). |
| `east_feed` | Cached Davenport `schedule_weeks` rows by week Monday. Anon-read. |
| `east_overrides` | Manual per-day corrections to the East feed (`busy` true/false). Anon-read. |
| `east_forecast` | East forecast rows (`scripts/east-forecast.js --sql`), one per week Monday, kept out of `east_feed` so a forecast can never read as a published Davenport row. Anon-read. Added to `schema.sql` and applied to the live DB 2026-09-22 (14 forecast-week rows observed 2026-09-23). |
| `shift_trade_requests` | Trades by day + role with an optional return leg and a status lifecycle. Authenticated. `kind` `trade` / `give` (a give is one-way; the database's "a member trade needs a return leg" is the separate follow-up `2026-09-25-member-trade-return-leg.sql`, applied 2026-09-27) - Prompt 19, applied 2026-09-25. |
| `notifications` | In-app notification feed (recipients ride in `data`). Authenticated. |
| `notification_preferences` | Per-person email toggles and reminder hour. Own row + scheduler. Prompt 20 F1 (applied 2026-09-27 00:43:54Z): keyed by a new `id`; `person_id` UNIQUE + nullable (a surgeon's row) or `profile_id` → `user_profiles` (an unlinked follower's row), exactly one of the two. |
| `audit_log` | Who did what; insert by scheduler/admin or by the writer as himself (a linked person's roster id, a coordinator's profile id), read by scheduler/admin (a coordinator: its own `timeoff.` / `offers.` / `availability.` rows; Prompt 21 step 1, applied 2026-09-27 00:49:39Z: every signed-in user the rows he wrote - `audit_read_own`, section at the end; the lost rows the tables could rebuild are backfilled, `detail.backfilled` - the rest listed there). Actions are dotted names written by the client (`schedule.publish`, `schedule.day_edit`, `trade.propose`, `openshifts.notify` for the open-shifts notice, ...) or by a SQL function in the same transaction as its write (`trade.apply` from `apply_trade`, `schedule.claim` from `claim_open_slot`). Rows written by the client (`logAudit`) carry `actor_name` and a `detail.summary` the Activity log renders; the two SQL functions' rows do so since the item 5b migration (applied 2026-09-24; the two earlier `trade.apply` rows backfilled - section at the end); the `daily-reminder` edge function's `period.close` rows carry `actor_name` only, so the log shows their raw action. |
| `call_schedule_snapshots` | Restore points captured before destructive actions and once per session. Scheduler/admin. |
| `client_versions` | Row `main` = minimum version + banner message for the refresh check; other rows = per-client heartbeats. |
| `office_contacts` | Office recipients of publish/change digests (the ER-panel author). Authenticated-read, scheduler-write. |
| `call_offers` | Offers: one row per person and day (`role_pref` primary / backup / either, operational `note`, `entered_by`, `source` app / email-relay / import); triggers refuse a past day (`OF001`), a day inside the person's vacation (`OF002`) and non-scheduler writes inside a frozen period (`OF003`). Authenticated. Added 2026-09-22 (Prompt 14 part 1; block below). |
| `call_periods` | Periods: generation windows with `offers_close_at` / `publish_by` / `status` / `rules_only_ids` / `offer_modes` (`{person_id: 'exhaustive' \| 'preferred'}`, absent = preferred; column from `sql/migrations/2026-09-23-offer-modes.sql`, applied live 2026-09-23 07:05Z - see the offer_modes subsection below). Authenticated read, scheduler write. |
| `east_vacation_reviews` | Prompt 15 part 2 (2026-09-23, **applied live 2026-09-23 04:37 — see the section at the end**): one row per reviewed Davenport vacation range of a surgeon with an East code — `person_id`, `"start"`, `"end"`, `decision` (`away` \| `home`), `decided_at`, `decided_by`. Dates and a decision only. Authenticated-read, own-rows or scheduler write. The ranges themselves stay in the `east_feed` payload. |
| `call_pay_settings` | Call pay (Faraz 9/27), **applied live 2026-09-28 01:15 UTC** - section at the end: ONE row `main` - the four rates the scheduler enters in Setup > Pay rates (`stipend_per_shift`, `weekday_callin_rate`, `weekend_holiday_callin_rate`, `activation_rate`; null = not set yet, no default and no figure anywhere in the repo), the pay-model flags (`activation_unit`, `weekend_days`, `holiday_unit_days_are_holidays`, `callin_required_weekday`, `callin_required_weekend_holiday`) and `stipend_off_ids` (the roster ids NOT paid by the call stipend - the per-surgeon switch, default ON = not listed; read through `silvis_pay_enabled`). Authenticated only; anon privileges revoked. |
| `call_pay_logs` | Call pay (Faraz 9/27), **applied live 2026-09-28 01:15 UTC**: one row per call-in of the PRIMARY on a past call day (`day`, `person_id`, `hours` in quarter hours 0-24, optional contact-free `note`, `created_by`); `call_pay_logs_guard` refuses the office coordinator (`PY004`), a switched-off person (`PY005`), a future day (`PY001`), a day the person is not primary (`PY002`) and more than 24 h per day (`PY003`). Authenticated only; anon privileges revoked. |

Helper functions: `silvis_role()`, `silvis_person_id()`, `silvis_is_sched()` — `security definer`, `stable`, `search_path = public`.

## (b) RLS policies — who can read / write

| Table | Read | Write |
|---|---|---|
| `call_schedule_data`, `schedule_days`, `availability`, `east_feed`, `east_forecast` | anyone (anon) | scheduler/admin (all verbs) |
| `client_versions` | anon: row `main` only; authenticated: all rows | scheduler/admin all rows; each authenticated user may insert/update **their own** heartbeat row (`id = auth.uid()`) |
| `time_off` | anyone (anon) | insert/update/delete: the surgeon named in the row (`person_id = silvis_person_id()`) or scheduler/admin |
| `east_overrides` | anyone (anon) | scheduler/admin |
| `user_profiles` | authenticated | self-insert as `viewer` with **no `person_id`**; self-update may not change `role` or `person_id`; admin: everything. Prompt 20 F1 (applied 2026-09-27): self-insert and self-update pin `follows` too (only the admin sets it) |
| `shift_trade_requests` | authenticated | insert: proposer or scheduler; update: parties + scheduler, and a trigger restricts non-schedulers to status moves on a pending trade (counter-party → accepted/declined, proposer → cancelled) |
| `notifications` | authenticated | insert: any authenticated user |
| `notification_preferences` | own row or scheduler | own row or scheduler. Prompt 20 F1 (applied 2026-09-27): "own" = `person_id = silvis_person_id()` or `profile_id = auth.uid()` |
| `audit_log` | scheduler/admin, every row (`audit_read`); a coordinator its own `timeoff.` / `offers.` / `availability.` rows (`audit_read_coord`, Prompt 16 A7). Prompt 21 step 1 (applied 2026-09-27 00:49:39Z, after the 24-hour gate): `audit_read_own` - every signed-in user the rows he wrote (`actor_id` = his roster id when linked, else his profile id), which the client's `INSERT ... RETURNING` needs | insert (`audit_insert`, Prompt 16 A1 / A7): scheduler/admin, a linked person as himself (`actor_id` = his roster id), a coordinator as itself (`actor_id` = its profile id); an unlinked viewer none |
| `call_schedule_snapshots` | scheduler/admin | scheduler/admin |
| `office_contacts` | authenticated | scheduler/admin |
| `call_offers` | authenticated | insert/update/delete: the surgeon named in the row (`person_id = silvis_person_id()`) or scheduler/admin; never anon (deliberately absent from the anon `read_all` loop) |
| `call_periods` | authenticated | scheduler/admin (all verbs); never anon |
| `east_vacation_reviews` (applied 2026-09-23) | authenticated (**no anon policy** — an anon read is a silent `200 + []`) | insert/update/delete: the surgeon named in the row (`person_id = silvis_person_id()`) or scheduler/admin |
| `call_pay_settings` - applied 2026-09-28, call pay 9/27 | scheduler/admin; the office coordinator (read-only, 9/27 item 5a); a surgeon-role account linked to a roster id that is paid by the call stipend (`silvis_pay_enabled`, item 5b); never a switched-off surgeon / viewer / follower / anon (anon privileges revoked) | scheduler/admin (all verbs) |
| `call_pay_logs` - applied 2026-09-28, call pay 9/27 | scheduler/admin and the office coordinator every row (a switched-off surgeon's earlier rows included); a surgeon-role account his own rows while switched on (`person_id = silvis_person_id() and silvis_pay_enabled(person_id)`); nobody else (anon privileges revoked) | insert/update/delete: scheduler/admin, and that surgeon his own rows while switched on - never the coordinator; `call_pay_logs_guard` (PY004 office, PY005 switched off, PY001-PY003) applies to every caller, the scheduler included |

## (c) Findings

**Recursion in `silvis_role()` — none.** The function is `security definer` owned by `postgres`, so its `select … from
user_profiles` bypasses RLS; policies that call it never re-enter policy evaluation. The one subselect on
`user_profiles` inside `user_profiles_self_update` is evaluated under the `user_profiles_read` policy (`authenticated`,
`using (true)`), so it terminates too.

**Wrong or risky, and what was done:**

1. **Self-service impersonation via `person_id`** — `user_profiles_self_insert` pinned `role` but not `person_id`, and
   `user_profiles_self_update` pinned `role` only. Any authenticated user could set `person_id = 's1'` and then pass every
   `person_id = silvis_person_id()` check (enter vacations for another surgeon, propose trades as them). **Applied:**
   self-insert requires `person_id is null`; self-update requires `person_id` unchanged. The admin policy (Setup → Users)
   assigns links and roles. Consequence for the client (Prompt 6): signup must stop sending `person_id`.
2. **Nobody populates `user_profiles.email`.** The guide says "populated by Supabase Auth at signup", but there was no
   trigger, and the Davenport client upserts `{ id, person_id, display_name }` without an email. Invited users who never
   open the app would have no row to link. **Applied:** `handle_new_auth_user()` trigger on `auth.users`
   (insert + update of email) creates/refreshes the viewer row with the email. The client never handles an email.
3. **`time_off` trigger ignored the trailing edge.** It checked `start_date..end_date` only, while every doc (and the
   generator) treats the day before a vacation as blocked because that shift ends at 07:00 on the vacation day.
   **Applied:** the day before the range is checked for **primary** only (both roles inside the range). Primary-only
   matches the group's own hand schedule (Philip was backup 10/14 with 10/15 off, and backup 10/22 before an Aledo Friday)
   and keeps the seed import conflict-free; `groupRules.dayBeforeRules` mirrors it in the rules engine.
4. **Trade update policy had no `with check`.** The proposer could set `status = 'accepted'` on their own trade or rewrite
   its legs. **Applied:** `trade_update_guard()` trigger: non-schedulers may only move a pending trade's status
   (counter-party → accepted/declined; proposer → cancelled); legs are immutable for them.
5. **No `primary ≠ backup` constraint** although `groupRules.backupDistinctFromPrimary` is true. **Applied:** check
   constraint `schedule_days_distinct_roles`.
6. **Snapshot contract mismatch.** Davenport's `snapshots.capture` writes `source_updated_at`, which the table lacked;
   every capture would have failed and, because capture failure blocks destructive actions, every reset/regenerate/restore
   would have been blocked. **Applied:** column added; the `data` shape stays `{ config, schedule_days[], time_off[],
   availability[] }` and Prompt 6 Slice A retargets capture/restore to it.
7. **No idempotency key on `availability`** although the importer keys rows on person+kind+role+start+end+source.
   **Applied:** unique index on that tuple (`coalesce(source,'')`).
8. **Missing indexes** for the hot reads: trades by status/day, notifications, audit and snapshots by `created_at desc`.
   **Applied.**
9. **`client_versions` only knew about `main`.** The carried-over refresh mechanism also has a per-client heartbeat
   (Davenport's Settings → Client Versions card). **Applied:** heartbeat columns and self-upsert policies; anon can read
   only the `main` row, so user agents and person ids are not anon-visible.
10. **Anon exposure, reviewed and accepted:** `call_schedule_data` (rules and operational notes — no contact data by
    policy), `schedule_days`, `time_off`, `availability`, `east_feed`, `east_overrides` (documented now; it was missing
    from the anon list in the guide and `CLAUDE.md`), and `client_versions.main`. None carries contact data; notes are
    kept operational by the importer (personal wording is replaced).
11. **Not changed, noted:** `schedule_days.source` is free text (documented values `import | generated | manual |
    east-derived | trade`); `notifications` insert is open to any authenticated user (same as Davenport); the trigger
    fires on `update` of `time_off` too, so editing a note re-validates the range (harmless); PostgREST default grants
    for `anon`/`authenticated` on new tables are the Supabase defaults.

## (d) Verification

`scripts/verify-rls.sh` prints PASS/FAIL per check with the raw HTTP status lines:

1. anon `GET schedule_days` → 200;
2. anon `POST schedule_days` → 401/403;
3. scheduler-JWT `POST schedule_days` → 201 (runs only when `SILVIS_JWT` is set in the environment — never in a file);
4. trigger: over a published day → `ON_CALL_CONFLICT`; the day after a published **primary** day → `ON_CALL_CONFLICT`;
   the day after a published **backup** day → accepted; a clean range → accepted (run through the CLI's linked SQL
   path with a throw-away `s9test` id, cleaned up afterwards).

Result at the time of writing is recorded in the Prompt 2 update.

## 2026-09-22 - trade guards (Prompt 12 D)

*Answers the 9/22 review, section 3 D (history, `docs/HISTORY.md`). Report-first: the definitions live in `sql/schema.sql` and, byte-identically,
in `sql/migrations/2026-09-22-trade-guards.sql`; the migration is what the scheduler runs against the live project.
`test/schema.test.js` (in `npm test` and CI) pins both files, the check order and the absence of contact data in `sql/`.*

**The hole.** `trade_insert` (RLS) checked only `from_surgeon_id = silvis_person_id()`, `trade_update_guard` runs only
on UPDATE, and `apply_trade()` checked party / status / staleness only. A signed-in surgeon could INSERT a trade from
their own id with `status = 'accepted'` naming any counterparty and call `apply_trade()` at once; the swap ignored the
receiver's vacations, the import locks (a locked day transferred with its lock flag intact) and the roster.

**1. `trade_insert_guard()` - `BEFORE INSERT` trigger `trade_insert_guard_trg` on `shift_trade_requests`.**
For a caller who is not scheduler/admin (and not a server-side role: the CLI's `postgres`, `service_role`, which have no
`auth.uid()`), the row is normalised before RLS's `WITH CHECK` sees it: `status := 'pending'`,
`from_surgeon_id := silvis_person_id()` (an unlinked account gets `TRADE_FORBIDDEN: your account is not linked to a
roster entry`), `submitted_at := now()`, `decided_at := null`. Display names are left as given. For everyone,
`from_surgeon_id = to_surgeon_id` raises `TRADE_INELIGIBLE: a trade needs two different surgeons` (checked after the
normalisation, so a forced `from` that collides with `to` is caught too). A scheduler may still record an already-accepted
trade on someone's behalf. The server-side bypass (`auth.uid() is null and current_user in ('postgres', 'supabase_admin',
'service_role')`) is a standing exception the binding design did not name: no client path reaches it (PostgREST runs as
anon/authenticated), but a future SECURITY DEFINER function owned by postgres that inserted a trade row would inherit
it silently - keep trade inserts out of security-definer code. `test/schema.test.js` pins the exact role list. Faraz may
drop it; then the probe must stage its `accepted` fixtures as its throwaway scheduler user instead of as postgres.

**2. `apply_trade()` - eligibility before any write.** After the existing party / `accepted` / stale checks and before
the first `update public.schedule_days`, each leg's *receiver* (leg 1: `to_surgeon_id`; return leg: `from_surgeon_id`)
is checked, in this order, raising `TRADE_INELIGIBLE: <plain-English reason>` (errcode `P0001`; the app shows it verbatim):

| | Check | Message |
|---|---|---|
| (a) | roster in `call_schedule_data` `main` present (fail closed); receiver is an **active** roster entry (pool or external - any active entry; like every client path, an entry with no `active` key counts as active: `coalesce(r ->> 'active', 'true') <> 'false'`) | `roster unavailable` / `<id> is not an active roster surgeon` |
| (b) | the leg's day is not inside a `time_off` range of the receiver; for a **primary** leg, not the day before one either (SILVIS-CALL-RULES: a vacation day also blocks the day before it - the same rule the `time_off` trigger enforces from the other side). Like that trigger, the SQL side hardcodes primary; the client reads `groupRules.dayBeforeRules.trailingEdgeRoles` (default `['primary']`). One step beyond Prompt 12's wording ("inside a time_off range"); pinned by the test; drop the two `starts a vacation on` blocks in both files if strictly-inside is wanted | `<Name> is on vacation on <day>` / `<Name> starts a vacation on <day+1> (primary the day before is blocked)` |
| (c) | the leg's role is not locked that day unless the caller is the scheduler; the transfer sets the transferred role's lock flag to `false` (a traded slot is no longer the locked import) | `<day> <role> is locked; ask the scheduler` |
| (d) | the receiver does not already hold the other role that day (readable message ahead of the `schedule_days_distinct_roles` constraint). Evaluated per leg against the pre-swap row, so a same-day role *swap* (A's primary for B's backup on one day) is refused here - it tripped the constraint before and the client refuses it too; not a supported trade shape | `<Name> already holds <other role> on <day>` |

Unchanged: `security definer`, `set search_path = public`, `version + 1`, `source = 'trade'`, the `silvis.apply_trade`
bypass token for the status transition, the audit row, `revoke ... from public, anon` / `grant ... to authenticated`.

**2026-09-23 (audit RLS-6) - `TRADE_PAST`:** `apply_trade` (right after the `accepted` check, before the first row lock) and `trade_update_guard` (the counter-party's pending -> accepted move only; decline and cancel stay open) raise `TRADE_PAST: <day> is before today (<today>) in Central time; past days are changed by the scheduler only` (errcode `P0001`, shown verbatim by the app) for a non-scheduler when the day or the return day is before today in America/Chicago - strict `<`, so today's already-started 07:00 shift stays tradeable, matching `claim_open_slot`'s `CL003`; the scheduler still applies or accepts a past-day trade (a phoned-in swap, Prompt 12 Q); `sql/migrations/2026-09-23-trade-past-guard.sql` carries both bodies byte-identically to `schema.sql`, the 2026-09-22 migration stays frozen as applied (sha256 pins), probe cases **I**-**M** (2020-02 fixtures) and `verify-rls.sh` section 5 prove it, and the live apply record (timestamp + probe output) is to be added here when it is applied.

**Applied 2026-09-23 ~16:00 UTC** through the linked CLI (`sql/migrations/2026-09-23-trade-past-guard.sql`, sha256
`a994dc8344c5524b...`). Pre-check: 0 pending / accepted trades with a past day. Probe BEFORE (the hole): `I=status=applied`,
`K=status=accepted`. Probe AFTER, verbatim: `I=ERR TRADE_PAST: 2020-02-03 is before today (2026-09-23) in Central time  past
days are changed by the scheduler only; J=status=applied 02-05p=s2; K=ERR TRADE_PAST: 2020-02-03 is before today (2026-09-23)
in Central time  past days are changed by the scheduler only; L=status=accepted; M=status=declined`, A-H unchanged; 2020-02
leftovers 0; `scripts/verify-rls.sh` 49 PASS / 0 FAIL (sections 1-9, probes I-M graded).

**3. The probe - `sql/probes/trade-guards-probe.sql` (persists nothing).** One multi-statement batch with no
`BEGIN`/`COMMIT`: with `--linked` the CLI submits the file as one multi-statement request through the Management API,
which runs it in a single implicit transaction (observed 2026-09-22 on this project: a batch ending in RAISE persists
nothing), and its last statement is a `DO` block that **raises** `PROBE_RESULTS A=...;B=...;END` (the `;END` sentinel
marks where the message stops and the CLI's own suffix such as ` (SQLSTATE P0001)` begins), which aborts and rolls back
everything (fixtures on 2030-03 days, the `time_off` row, the trades, two throwaway `auth.users` rows `probe-<uuid>@example.test`
whose profiles `handle_new_auth_user` creates and which are linked to `s2`/surgeon and `s1`/scheduler). Each case acts
as that user with `SET LOCAL ROLE authenticated` + `request.jwt.claims` `sub` (what PostgREST sets; `auth.uid()` reads it)
inside an inner `BEGIN ... EXCEPTION` block so the error text is captured (a caught exception's subtransaction rollback
also restores the `postgres` role; the success path resets it explicitly). Cases: **A** surgeon inserts `accepted` with
`decided_at = now()` -> stored `pending`, `decided_at` null; **B** receiver on vacation -> refused; **C** receiver already holds the other role -> refused;
**D** locked slot, surgeon applies -> refused; **E** control: a clean accepted trade with a return leg applies (days
swap, trade `applied`); **F** locked slot, scheduler applies -> applies and the lock clears; **G** `from = to` -> refused;
**H** a surgeon naming someone else as `from` -> forced to their own id. The probe header lists the BEFORE-fix picture per
case (A stores `accepted`; B and D apply; C fails only through the check constraint; F leaves the lock set; G stores;
H is an RLS error).

Run it (absolute path; the workdir is a directory linked with `supabase link --project-ref bzhsroegtagqhutbnsrp`):

    supabase db query --linked --workdir <dir> -f <abs>/sql/probes/trade-guards-probe.sql      # before: shows the hole
    supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-22-trade-guards.sql
    supabase db query --linked --workdir <dir> -f <abs>/sql/probes/trade-guards-probe.sql      # after
    SILVIS_WORKDIR=<dir> bash scripts/verify-rls.sh                                            # section 5 grades each case + leftover count

After EVERY probe run the rollback is observed, never assumed (verify-rls.sh does this itself; by hand after the two
manual runs above):

    supabase db query --linked --workdir <dir> -o json "select ((select count(*) from public.schedule_days where day between '2030-03-01' and '2030-03-31' and source = 'probe') + (select count(*) from public.shift_trade_requests where detail like 'probe %') + (select count(*) from public.time_off where note = 'probe') + (select count(*) from auth.users where email like 'probe-%@example.test'))::int as leftover"

`leftover` must be 0. If it is not, the batch did not run as one transaction: clean up at once (`delete from
public.shift_trade_requests where detail like 'probe %'; delete from public.time_off where note = 'probe'; delete from
public.schedule_days where day between '2030-03-01' and '2030-03-31' and source = 'probe'; delete from auth.users where
email like 'probe-%@example.test';` - `user_profiles` rows cascade) and report before going on.

Expected after the migration: `PROBE_RESULTS A=status=pending from=s2 decided=null;B=ERR TRADE_INELIGIBLE: Burchett is on
vacation on 2030-03-05;C=ERR TRADE_INELIGIBLE: Burchett already holds backup on 2030-03-07;D=ERR TRADE_INELIGIBLE:
2030-03-09 primary is locked  ask the scheduler;E=status=applied 03-11p=s2 03-13b=s3;F=status=applied locked=false;G=ERR
TRADE_INELIGIBLE: a trade needs two different surgeons;H=status=pending from=s2;END` (the probe flattens `;`, quotes and
newlines out of the values so the message survives the CLI's wrapping - hence the two spaces in D - and the reader cuts
at `;END`). Before the migration the same run shows the hole: `A=status=accepted from=s2 decided=<timestamp>;B=status=applied;
C=ERR ... schedule_days_distinct_roles ...;D=status=applied locked=true;E=status=applied 03-11p=s2 03-13b=s3;F=status=applied
locked=true;G=status=pending;H=ERR new row violates row-level security policy ...`. `verify-rls.sh` section 6 adds the
REST-level checks (a surgeon JWT POSTing `status: 'accepted'` lands as `pending`, and the row is then deleted through the
linked CLI; `apply_trade` on a vacation day is a 4xx `TRADE_INELIGIBLE`) and skips until a surgeon-role user exists
(`SILVIS_SURGEON_JWT`).

**Observed 2026-09-22 (Claude Code, before the migration):** the probe ran against the live project through the linked
CLI and returned exactly the pre-fix picture: `PROBE_RESULTS A=status=accepted from=s2 decided=2026-09-22 13:48:42.846398+00;
B=status=applied;C=ERR new row for relation  schedule_days  violates check constraint  schedule_days_distinct_roles ;
D=status=applied locked=true;E=status=applied 03-11p=s2 03-13b=s3;F=status=applied locked=true;G=status=pending;H=ERR new
row violates row-level security policy for table  shift_trade_requests ;END`. The leftover count afterwards was 0 (and the
project still had exactly one auth user and one profile), so the batch rolled back as designed.

**Applied 2026-09-22 (Faraz's go-ahead in chat; Claude Code through the linked CLI):** `sql/migrations/2026-09-22-trade-guards.sql`
ran without error; `pg_proc` shows `apply_trade` (security definer, `search_path=public`) and `trade_insert_guard`, `pg_trigger`
shows `trade_insert_guard_trg` + `trade_update_guard_trg` enabled, and `apply_trade` executes only for `authenticated`,
`postgres`, `service_role`. The probe AFTER returned exactly the expected string: `PROBE_RESULTS A=status=pending from=s2
decided=null;B=ERR TRADE_INELIGIBLE: Burchett is on vacation on 2030-03-05;C=ERR TRADE_INELIGIBLE: Burchett already holds
backup on 2030-03-07;D=ERR TRADE_INELIGIBLE: 2030-03-09 primary is locked  ask the scheduler;E=status=applied 03-11p=s2
03-13b=s3;F=status=applied locked=false;G=ERR TRADE_INELIGIBLE: a trade needs two different surgeons;H=status=pending
from=s2;END`; leftover count afterwards 0 (still one auth user). `SILVIS_WORKDIR=<linked dir> bash scripts/verify-rls.sh`
then reported `RESULT: 15 passed, 0 failed`: sections 1, 2 and 4 as before, section 5 PASS for probes A through H plus
"probe persisted nothing (leftover count 0)"; sections 3 and 6 SKIP until a scheduler / surgeon JWT exists.

**Client consequence.** None required: the app already POSTs `status: 'pending'` with its own id and shows `apply_trade`
errors verbatim; the new messages read as sentences. Acceptance-time client eligibility stays as a courtesy check - the
server is now the authority.

## 2026-09-22 - claim_open_slot (Prompt 13 part 2)

**Status: APPLIED LIVE on 2026-09-22 after Faraz's go-ahead in chat** (report-first: the function text had been put in
front of him earlier that day and the committed body is identical to that draft). The definition sits in `sql/schema.sql`
in its own section right after `apply_trade()` and, byte-identical, in `sql/migrations/2026-09-22-claim-open-slot.sql`
(the file that ran live through the linked CLI; `test/schema.test.js` pins the identity, the nine codes in order, the
placement, the revoke/grant and `security definer set search_path = public`). A `git push` applies nothing.

**Observed 2026-09-22 (Claude Code, linked CLI).** `pg_proc`: `claim_open_slot(p_day date, p_role text)`, security
definer, `search_path=public`; EXECUTE for `authenticated`, `postgres`, `service_role` only. The rolled-back probe
returned: `PROBE_RESULTS A=ERR 42501 permission denied for function claim_open_slot;B=ok version=2 backup=s3
source=claim audit=1 notif=Acton took 4/7 backup;C=ERR CL005 CLAIM_HELD: 2030-04-03 backup is already held by s2;D=ERR
CL007 CLAIM_LOCKED: 2030-04-05 backup is locked  ask the scheduler to assign it;E=ERR CL003 CLAIM_PAST: 2020-01-01 is
before today (2026-09-22) in Central time  past days are not open;F=ERR CL006 CLAIM_EXTERNAL: 2030-04-11 primary is
covered by probe-locum (outside the roster);G=ERR CL008 CLAIM_OTHER_ROLE: you already hold primary on 2030-04-13;H=ERR
CL009 CLAIM_VACATION: your vacation 4/15-4/15 conflicts with 2030-04-15 backup (a primary shift also blocks the day
before a vacation);I=ERR CL009 CLAIM_VACATION: your vacation 4/18-4/18 conflicts with 2030-04-17 primary (a primary
shift also blocks the day before a vacation);I2=ok version=2 backup=s3;J=ERR CL004 CLAIM_OUTSIDE_RANGE: 2030-04-25 is
outside the published schedule (2020-01-01 to 2030-04-17);K=ok version=2 backup=s3 source=claim;L=ok rows=1
primary=s4;END`. Leftover count afterwards 0 (2030-04 rows, the 2020-01-01 row, probe-claim time_off and auth users,
`shift_claimed` notifications, `schedule.claim` audit rows); the project still had one auth user; the live published
range read `2026-09-14..2026-11-29`. `scripts/verify-rls.sh` then reported `RESULT: 30 passed, 0 failed` - section 7:
anon `rpc/claim_open_slot` refused with HTTP 401, probes A through L PASS, "claim probe persisted nothing"; 7c-7e SKIP
until a surgeon-role JWT exists.

**What it is.** `public.claim_open_slot(p_day date, p_role text) returns jsonb` - a linked surgeon takes an OPEN slot
from the Open shifts board ("Take this shift"). Members cannot write `schedule_days` under RLS, so the write runs as
security definer, modelled on `apply_trade()`: every check before the first write, the day's row locked with
`for update` (a day inside the published range with no row gets one, `source = 'claim'`, version 1), then the one
role set with `version = version + 1`, `source = 'claim'`, `updated_by = <caller's roster id>`, `updated_at = now()`
(so every other client's compare-and-swap on that day fails loudly and reloads), an `audit_log` row
`schedule.claim` `{day, role, person, version}` and a `notifications` row (type `shift_claimed`, title
`<Name> took <M/D> <role>`, data `{day, role, surgeon_id, person_id}` - the feed filter shows `data.surgeon_id` rows
to that surgeon, the scheduler sees everything) in the SAME transaction; returns `{ok, day, role, person_id,
version}`. `revoke all ... from public, anon; grant execute ... to authenticated`. The published range is
`min(day)..max(day)` of `schedule_days`; "today" is `(now() at time zone 'America/Chicago')::date`. A scheduler
assigns from the day editor as before and does not use this (the function does not refuse a scheduler whose account
is linked - Khan is also a surgeon - but the UI never offers it to the scheduler path).

**The boundary, stated plainly.** The JS eligibility rules (OR days, Clinton/Aledo days, caps, weekday patterns,
consecutive runs, East busy days, holiday opt-outs) are enforced in the client - `eligibility()` must pass the hard
rules before the "Take this shift" button is offered; soft-rule warnings are shown, not blocking. They are NOT in
SQL. The function guards data integrity only and logs everything: a claim that slips past a client rule is visible
in the audit log and the feed, and the scheduler corrects it from the day editor. For six surgeons that is the
accepted boundary (also written into the guide, section 16).

**Refusals** - each its own SQLSTATE (custom class `CL`) and a message prefixed with a stable token; PostgREST
returns both (a custom class maps to HTTP 400) so the client CAN show the message verbatim - it does not yet (see
"Client consequence" below: a part-3 item). In evaluation order:

| code | token | meaning |
|---|---|---|
| `CL001` | `CLAIM_NOT_LINKED` | `auth.uid()` is null (anon) or the account has no `user_profiles.person_id` |
| `CL002` | `CLAIM_BAD_ROLE` | `p_role` not in (`primary`, `backup`) |
| `CL003` | `CLAIM_PAST` | `p_day` before today in America/Chicago (checked before the range: a past day inside the range is still refused as past) |
| `CL004` | `CLAIM_OUTSIDE_RANGE` | `p_day` outside `min(day)..max(day)` of `schedule_days` (or the table is empty) |
| `CL005` | `CLAIM_HELD` | the slot already has a surgeon |
| `CL006` | `CLAIM_EXTERNAL` | primary requested while `external_cover` is set (non-empty) |
| `CL007` | `CLAIM_LOCKED` | the role's lock flag is set - the scheduler assigns it from the editor (a claim never touches a lock flag) |
| `CL008` | `CLAIM_OTHER_ROLE` | the caller already holds the other role that day (readable message ahead of `schedule_days_distinct_roles`) |
| `CL009` | `CLAIM_VACATION` | a `time_off` row of the caller overlaps `p_day`, or `p_day + 1` when `p_role = 'primary'` (the 07:00 shift end falls on the vacation day - the `time_off` trigger's trailing-edge rule mirrored; like that trigger and `apply_trade`, the SQL side hardcodes primary) |

CL001-CL004 need no row and run before the missing-row insert; CL005-CL009 run against the locked row, before the
update. Two surgeons claiming the same slot at once serialise on the row lock (a missing row: `on conflict (day) do
nothing` then `for update`), so the second sees `CLAIM_HELD`.

**Review notes on the drafted text (kept verbatim; none is a syntax error).** (1) Unlike `apply_trade()` check (a),
the function does not verify that `me` is an ACTIVE roster entry - `person_id` is admin-assigned in Setup -> Users,
and an unlinked account is refused, but a surgeon whose roster entry was later set inactive could still claim; the
client's `eligibility()` refuses inactive entries before the button. (2) The range check widens if a stray
`schedule_days` row exists far outside the published schedule (verify-rls.sh sections 3/4 delete theirs). (3) The
function body references `notifications` and `audit_log`, which `schema.sql` creates further down: plpgsql resolves
tables at run time, and `apply_trade` already does the same with `audit_log`, so a fresh paste of the whole file
works. (4) `p_day` null lands in `CLAIM_PAST` (message prints `<NULL>`); PostgREST rejects a missing argument
before that. (5) **Design gap for Faraz (reviewer, fix stage 2026-09-22):** a claim writes `source = 'claim'` and
deliberately no lock flag, but the generator keeps only LOCKED slots when it rebuilds a range (`generator.js`
`lockedP` / `lockedB` in the base-schedule pass), so a later Generate over a claimed day silently discards the
surgeon's claim. Two ways out, his call for parts 3-4: (a) the claim also sets the role's lock flag (a claimed slot
is a commitment, like an import) - changes the drafted function and the test's "never touches a lock flag" pin, so
needs his go-ahead; or (b) the Generate path treats `source = 'claim'` days as locked, or warns before overwriting
them. Record the decision in `docs/SILVIS-CALL-RULES.md` and the seed/test in the same PR. (6) The
`schedule_days.source` column comment in `schema.sql` now lists the sixth value `claim` (no client whitelist rejects
unknown source values; documentation only).

**The probe - `sql/probes/claim-open-slot-probe.sql` (persists nothing).** Same mechanism as the trade probe: one
batch, no `BEGIN`/`COMMIT`, last statement raises `PROBE_RESULTS A=...;B=...;END`, so fixtures (2030-04 rows plus a
`2020-01-01` row as the range's lower bound, two `time_off` rows note `probe-claim`, two throwaway `auth.users`
`probe-claim-<uuid>@example.test` linked to `s3`/surgeon and `s1`/scheduler) and everything the function writes
(schedule rows, audit rows, feed rows) roll back. Cases, expected AFTER the migration: **A** anon (role `anon`, no
sub) -> `ERR 42501 permission denied for function claim_open_slot`; **B** s3 claims 4/7 backup -> `ok version=2
backup=s3 source=claim audit=1 notif=Acton took 4/7 backup`; **C** held -> `CL005`; **D** locked -> `CL007`; **E**
2020-01-01 -> `CL003` (past before range); **F** external-covered primary -> `CL006`; **G** other role same day ->
`CL008`; **H** vacation on the day -> `CL009`; **I** primary the day before a vacation -> `CL009` while **I2** the
same backup -> `ok version=2 backup=s3`; **J** a day after `max(day)` -> `CL004`; **K** a day inside the range with
no row -> `ok version=2 backup=s3 source=claim`; **L** the scheduler's direct `schedule_days` update (day-editor
path) -> `ok rows=1 primary=s4`. BEFORE the migration every case but L reads `ERR 42883 function
public.claim_open_slot(date, unknown) does not exist`. Errors are recorded as `ERR <SQLSTATE> <message>` (`;` and
quotes flattened to spaces).

Run it (absolute path; workdir linked with `supabase link --project-ref bzhsroegtagqhutbnsrp`):

    supabase db query --linked --workdir <dir> -f <abs>/sql/probes/claim-open-slot-probe.sql        # before: every case 'does not exist'
    supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-22-claim-open-slot.sql
    supabase db query --linked --workdir <dir> -f <abs>/sql/probes/claim-open-slot-probe.sql        # after: the picture above
    SILVIS_WORKDIR=<dir> bash scripts/verify-rls.sh                                                  # section 7: 7a anon REST refusal, 7b probe graded + leftover count

After EVERY probe run the rollback is observed, never assumed (`verify-rls.sh` 7b does it; by hand after the manual runs):

    supabase db query --linked --workdir <dir> -o json "select ((select count(*) from public.schedule_days where day between '2030-04-01' and '2030-04-30' or day = '2020-01-01') + (select count(*) from public.time_off where note = 'probe-claim') + (select count(*) from auth.users where email like 'probe-claim-%@example.test') + (select count(*) from public.audit_log where action = 'schedule.claim' and detail ->> 'day' like '2030-04-%') + (select count(*) from public.notifications where type = 'shift_claimed' and data ->> 'day' like '2030-04-%'))::int as leftover"

`leftover` must be 0; otherwise clean up at once (the `delete` statements `verify-rls.sh` prints) and report.
`verify-rls.sh` 7a needs no JWT: an anon `POST rest/v1/rpc/claim_open_slot` is `404` before the migration and
`401`/`403` after (a `400` would mean anon reached the body - the revoke is missing). 7c-7e run only with
`SILVIS_SURGEON_JWT` (a linked surgeon's token) and exercise refusals only - `CLAIM_PAST`, `CLAIM_BAD_ROLE` (no
fixture, nothing written) and `CLAIM_HELD` (a `2030-04-20` fixture through the CLI, deleted afterwards) - because a
successful claim over REST would be a real, persisted schedule change.

**Client consequence (parts 3-4 of Prompt 13) - REQUIRED, not yet true.** The board calls `rpc/claim_open_slot`
with `dbAuthHeaders()` and must show the `CLAIM_*` message verbatim on a non-2xx, reloading the day on
`CLAIM_HELD` / `CLAIM_LOCKED` (someone else got there first). Today's client does NOT do that: `describeDbError`
in `index-source.html` passes only `ON_CALL_CONFLICT` and `TRADE_*` through verbatim (its `OWN` regex and the
fallback regex), so a `CL0xx` refusal would surface as the first 200 characters of the raw PostgREST JSON body,
and the notification `tabMap` has no `shift_claimed` entry. Part 3 must therefore (i) extend both regexes to
`/ON_CALL_CONFLICT|TRADE_[A-Z_]+|CLAIM_[A-Z_]+/`, (ii) add `shift_claimed: "calendar"` to the `tabMap`, and
(iii) optionally map the roster id in `CLAIM_HELD` ("held by s2") to a name via `nameOf()` before showing it.
Until then the sentence "the app shows the message verbatim" in the SQL banner (kept as drafted) describes the
contract, not the shipped client. Live results (before string, after string, leftover 0) are to be recorded here
when Faraz runs the steps above.

**Fix stage (2026-09-22, reviewer findings).** `verify-rls.sh` 7e now deletes its `2030-04-20` fixture by day
alone before and after the check (a successful REST claim would rewrite `source` to `claim`, and a source-filtered
delete would have left the row in the anon-readable table) and verifies the cleanup delete (`bad "7e cleanup delete
failed ..."` instead of an unconditional "cleanup done"). `test/schema.test.js` grades the section-7 case pins
against the section-7 slice only (section 5's `expect_eq A ...` lines had satisfied cases A-H) and pins the 7e
cleanup and the `source` comment; 291 assertions.

**⟶ 9/23 (P13R, the rebase onto the Prompt 12 head) — review note 5 closed.** The generator treats a row whose source is `claim` or `trade` as fixed in both modes exactly like a lock (`generator.GEN_PERSON_FIXED_SOURCES`; every held role of that day, counted in `diagnostics.fixedSlots`, conflicts in `fixedViolations`), so a later Generate never discards a claim; `manual` stays governed by the day editor's lock toggle. No schema change: `claim_open_slot` still writes `source = 'claim'` and no lock flag. Pinned in `test/generator-regression.js` (fixture `claim-fixed-2026-10.json`) and `test/open-shifts.test.js`.
## Offers and periods (Prompt 14 part 1) - applied 2026-09-22

*Report-first on 9/22 (draft reviewed by Faraz in chat: "approved as drafted, apply it"), applied 2026-09-22 15:15 through
the linked CLI from the scratchpad copy; the repo carries that file byte-for-byte as
`sql/migrations/2026-09-22-offers-periods.sql` (body sha256 `d2deac095ad18e2f245286eb6011ea49b0a3d89964ba5334e682978889c16458`;
the file's last line is a trailer comment saying so, and `test/schema.test.js` hashes the body without it) and the same
DDL merged into `sql/schema.sql` (tables, `offer_status()`, the two guard functions, triggers, RLS - function, policy and
trigger texts pinned identical). Design: the Prompt 14 document, part 1 (history, `docs/HISTORY.md`) and `docs/SILVIS-BUILD-GUIDE.md` section 17.*

**What it adds.** `call_periods` (`label`, `start_day`, `end_day`, `offers_close_at` <= `start_day`, `publish_by`,
`status` upcoming / closed / generated / published, `rules_only_ids` jsonb array, unique `start_day`) and `call_offers`
(`person_id`, `day`, `role_pref` primary / backup / either, operational `note`, `entered_by` = roster id or `scheduler`,
`source` app / email-relay / import, unique `(person_id, day)`). `offer_status(period, person)` derives submitted /
rules_only / not_started (`language sql stable security invoker`, so it reads under the caller's RLS). Triggers on
`call_offers`, fail closed with a stable token and errcode: `OFFER_PAST` `OF001` (before today in America/Chicago),
`OFFER_ON_VACATION` `OF002` (inside the person's `time_off`; the mirror of `time_off_no_call_conflict`), `OFFER_FROZEN`
`OF003` (a non-scheduler inserting, updating or deleting a day inside a period whose `offers_close_at` has passed; the
scheduler may still enter or remove a late offer). RLS: both tables **authenticated-read only - never anon** (offers carry
person ids and free text; they are deliberately absent from the anon `read_all` loop); `call_offers` insert / update /
delete for `person_id = silvis_person_id()` or scheduler/admin; `call_periods` write scheduler/admin. Snapshot / wipe-guard
decision: `call_schedule_snapshots.data` gains `call_offers[]` + `call_periods[]` when the client capture is extended (a
later wave); `payloadLooksWiped` and the table-side wipe guards do not consider them.

**Observed 2026-09-22 (verbatim, the scratchpad note written right after the apply):**

```
Observed 2026-09-22 ~15:15 (Claude Code, linked CLI) right after applying p14/2026-09-22-offers-periods.sql live (Faraz: "approved as drafted, apply it").

Objects: call_offers + call_periods with RLS on; policies call_offers_read/insert/update/delete (authenticated), call_periods_read (authenticated), call_periods_write (ALL, authenticated, scheduler via silvis_is_sched()); triggers call_offers_guard_trg (before insert or update) + call_offers_delete_guard_trg (before delete); functions offer_status, call_offers_guard, call_offers_delete_guard (all security invoker).

Rolled-back probe (p14/offers-probe.sql; throwaway surgeon linked to s3 + scheduler linked to s1; a 'probe frozen' period 2030-05 with offers_close_at 2026-09-01):
PROBE_RESULTS A=ERR OF001 OFFER_PAST: 2020-01-01 is before today (2026-09-22) in Central time;B=ERR OF002 OFFER_ON_VACATION: 2026-11-20 is inside a vacation of s3;C=ok rows=1;D=ERR 42501 new row violates row-level security policy for table "call_offers";E=ok updated=1;F=ERR OF003 OFFER_FROZEN: offers for probe frozen closed on 2026-09-01 - ask the scheduler;G=ok rows=1 status=submitted;H=ERR OF003 OFFER_FROZEN: offers for probe frozen closed on 2026-09-01 - ask the scheduler;I-insert=ERR 42501 new row violates row-level security policy for table "call_offers";I-read=rows=0;J=s2=not_started s6=rules_only s3=submitted;END

Cases: A past day refused (OF001) | B day inside the person's vacation refused (OF002) | C surgeon inserts own future offer ok | D surgeon inserting another surgeon's offer refused by RLS | E surgeon updates own row ok | F surgeon insert inside a frozen period refused (OF003) | G scheduler may enter a late offer (source email-relay) and offer_status reads submitted | H surgeon delete inside a frozen period refused (OF003) | I anon reads 0 rows and cannot insert | J derived statuses not_started / rules_only / submitted.
Leftover count after the probe: 0 (call_offers, call_periods, probe auth users); auth users still 1.

For the Prompt 14 part 1 lane: copy the SQL verbatim into sql/schema.sql and sql/migrations/2026-09-22-offers-periods.sql, turn this probe into sql/probes/offers-probe.sql + verify-rls.sh section 8 (grant the temp table to anon AND authenticated), pin in test/schema.test.js, and quote this observed string in docs/SCHEMA-REVIEW.md. Do NOT re-apply live.
```

**The repo probe - `sql/probes/offers-probe.sql` (persists nothing).** Same shape as the trade probe: one batch, no
`BEGIN`/`COMMIT`, temp table granted to `authenticated` AND `anon` (cases C-I run as those roles), last statement raises
`PROBE_RESULTS ...;END`. Two deliberate differences from the 9/22 scratch probe quoted above: case **B** brings its own
fixture vacation (`s3`, 2030-06-11, note `probe offers`) instead of Acton's live 11/19-22 row, so the probe never depends
on live `time_off`; and cases **K-set / K-type / K-default** prove `offer_modes` (below). Expected after both migrations:
`A=ERR OF001 OFFER_PAST: 2020-01-01 is before today (<today>) in Central time;B=ERR OF002 OFFER_ON_VACATION: 2030-06-11 is
inside a vacation of s3;C=ok rows=1;D=ERR 42501 ...;E=ok updated=1;F=ERR OF003 ... closed on 2026-09-01 - ask the
scheduler;G=ok rows=1 status=submitted;H=ERR OF003 ...;I-insert=ERR 42501 ...;I-read=rows=0;J=s2=not_started s6=rules_only
s3=submitted;K-default=modes={};K-set=ok modes={"s2": "exhaustive"} s2=exhaustive s3=absent;K-type=ERR 23514 new row for
relation "call_periods" violates check constraint "call_periods_offer_modes_object";END`. Before the 9/23 migration the
three K cases read `ERR 42703 column "offer_modes" ... does not exist` and A-J are unchanged.

`scripts/verify-rls.sh` **section 8** grades it and adds the REST view: anon `GET call_offers` / `call_periods` with
`Prefer: count=exact` must be `200` + `[]` with `Content-Range: */0` (the RLS-silent-read caveat: a 200 alone proves
nothing, the count is what is asserted; 401/403 also accepted); anon `POST call_offers` 401/403 or `42501`; with
`SILVIS_JWT`: an own-row insert 201, deleted by id and read back as `[]` (8c), a period with `offer_modes` stored and read
back and a non-object refused with `23514` (8d, cleaned up by label); with the linked CLI: the probe (8e) plus a leftover
count over `call_offers` 2030-05/06, the two probe periods, `time_off` note `probe offers` and `auth.users`
`probe-offers-%@example.test`, which must be 0.

**Observed 2026-09-23 (Claude Code, anon path of verify-rls.sh against the live project, no workdir / no JWT):** section 8
printed `anon GET call_offers -> HTTP 200  Content-Range: */0  body: []`, the same for `call_periods`, and `anon POST
call_offers -> HTTP 401` with body code `42501` (`new row violates row-level security policy for table "call_offers"`) -
`RESULT: 5 passed, 0 failed` for the anon sections; 8c/8d/8e SKIP until run with a JWT and the linked workdir.

### offer_modes (2026-09-23; `sql/migrations/2026-09-23-offer-modes.sql`) - applied 2026-09-23 07:05Z

Faraz 9/22 evening (prompt v2 part 2a): when submitting, a surgeon chooses **exhaustive** ("only these days") or
**preferred** ("my preferred days; use my rules to fill gaps", the default). Stored on the period:
`call_periods.offer_modes jsonb not null default '{}'` with check `call_periods_offer_modes_object`
(`jsonb_typeof(offer_modes) = 'object'`) and the column comment `{person_id: 'exhaustive' | 'preferred'}; absent =
'preferred' (the default, Faraz 9/22 evening); offer_status() is unchanged`. Additive only: no function, trigger or
policy changes; the shape check is deliberately the only SQL-side constraint (the two words are read by the client and
`rules.js`; a check constraint cannot iterate jsonb values without a helper). The same four lines sit in `sql/schema.sql`
(the create-table also declares the column inline for a fresh apply); `test/schema.test.js` pins both copies.

Confirmed NOT applied at the 9/23 morning probe (anon `GET call_periods?select=offer_modes` -> `400` `42703` "column
call_periods.offer_modes does not exist"); **applied 2026-09-23 07:05Z** by the orchestrator through the linked CLI
(the 9/23 audit's column probe reads the column). The probe / verify-rls lines below are what proves it (workdir = a
directory linked with `supabase link --project-ref bzhsroegtagqhutbnsrp`; absolute paths):

    supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-23-offer-modes.sql
    supabase db query --linked --workdir <dir> -f <abs>/sql/probes/offers-probe.sql      # K-set / K-type / K-default as above; A-J unchanged
    SILVIS_WORKDIR=<dir> bash scripts/verify-rls.sh                                     # section 8 grades A-K + leftover count 0

observed: applied 2026-09-23 07:05Z by the orchestrator through the linked CLI; probe re-run 2026-09-23 18:57Z via verify-rls.sh section 8: all cases PASS, leftover 0 - `PROBE_RESULTS A=ERR OF001 OFFER_PAST: 2020-01-01 is before today (2026-09-22) in Central time;B=ERR OF002 OFFER_ON_VACATION: 2026-11-20 is inside a vacation of s3;C=ok rows=1;D=ERR 42501 new row violates row-level security policy for table "call_offers";E=ok updated=1;F=ERR OF003 OFFER_FROZEN: offers for probe frozen closed on 2026-09-01 - ask the scheduler;G=ok rows=1 status=submitted;H=ERR OF003 OFFER_FROZEN: offers for probe frozen closed on 2026-09-01 - ask the scheduler;I-insert=ERR 42501 new row violates row-level security policy for table "call_offers";I-read=rows=0;J=s2=not_started s6=rules_only s3=submitted;END`

### claim-as-offer (2026-09-23; `sql/migrations/2026-09-23-claim-offer.sql`) - applied 2026-09-23 07:05Z

Prompt 14 part 2c: `claim_open_slot()` re-created with the `call_offers` upsert (none for a claimer listed in the
period's `rules_only_ids`; the `schedule.claim` audit detail carries `offer` true / false) and `call_offers_guard()`
skipping `OFFER_FROZEN` while the transaction-local `silvis.claim_in_progress` is on. Applied by the orchestrator through
the linked CLI at 2026-09-23 07:05Z; since the 9/23 `feat/offers` merge `sql/schema.sql` mirrors both bodies from this
file (`test/schema.test.js`: the 9/22 claim migration stays frozen by sha256, the newest-migration guard compares the
live bodies). Base check for the record: the migration header quotes the pre-rebase base sha256
`d86735999738fabe93da4990e4e3bff72e646d66521525a9db73fd179c1cb453` of `claim_open_slot`; the landed
`sql/migrations/2026-09-22-claim-open-slot.sql` body hashes to `88ae39e5b2d14ec956a012532aeda897636f8efb49d472456d1b1ec0d987dd1b`,
and a line diff of the two function texts shows only the offer additions (the declaration, the guarded upsert block, the
audit detail) - the base was not otherwise changed by the open-shifts rebase. Proof of the live state: the claim probe
(`sql/probes/claim-open-slot-probe.sql`, cases A..L) plus `sql/probes/offers-probe.sql`; `verify-rls.sh` sections 7 and 8.

observed: applied 2026-09-23 07:05Z by the orchestrator; claim probe re-run 2026-09-23 18:57Z via verify-rls.sh section 7: all cases PASS, leftover 0 - `PROBE_RESULTS A=ERR 42501 permission denied for function claim_open_slot;B=ok version=2 backup=s3 source=claim audit=1 notif=Acton took 4/7 backup;C=ERR CL005 CLAIM_HELD: 2030-04-03 backup is already held by s2;D=ERR CL007 CLAIM_LOCKED: 2030-04-05 backup is locked ask the scheduler to assign it;E=ERR CL003 CLAIM_PAST: 2020-01-01 is before today (2026-09-23) in Central time past days are not open;F=ERR CL006 CLAIM_EXTERNAL: 2030-04-11 primary is covered by probe-locum (outside the roster);G=ERR CL008 CLAIM_OTHER_ROLE: you already hold primary on 2030-04-13;H=ERR CL009 CLAIM_VACATION: your vacation 4/15-4/15 conflicts with 2030-04-15 backup (a primary shift also blocks the day before a vacation);I=ERR CL009 CLAIM_VACATION: your vacation 4/18-4/18 conflicts with 2030-04-17 primary (a primary shift also blocks the day before a vacation);I2=ok version=2 backup=s3;J=ERR CL004 CLAIM_OUTSIDE_RANGE: 2030-04-25 is outside the published schedule (2020-01-01 to 2030-04-17);K=ok version=2 backup=s3 source=claim;L=ok rows=1 primary=s4;END`

### set_offer_mode() + save_offers() (2026-09-23; `sql/migrations/2026-09-23-offer-mode-rpc.sql`) - applied 2026-09-23 ~18:45 UTC

Prompt 14 part 3a (the offer painter, U3a). Two functions, additive (create or replace + grants; no table, trigger or
policy is touched), mirrored byte for byte into `sql/schema.sql` and pinned by `test/schema.test.js`:

- `set_offer_mode(p_period uuid, p_mode text, p_person text default null) -> jsonb`, **security definer** because a
  surgeon cannot write `call_periods` (RLS: scheduler / admin only) yet chooses, for the next period, `exhaustive` /
  `preferred` / `rules_only` from the painter. It writes that ONE person's key only (`offer_modes[person]` and on/off
  `rules_only_ids`); a non-scheduler may only speak for `silvis_person_id()` (OM002) and only before `offers_close_at`
  while the period is `upcoming` (OM005, like OF003); `rules_only` is refused while the person has offers inside the
  period (OM006). Tokens OM001-OM006 with custom SQLSTATEs; the app shows them verbatim.
- `save_offers(p_person text, p_rows jsonb, p_clear date[], p_period uuid default null, p_mode text default null) ->
  jsonb`, **security invoker**: the painter's one Save as ONE transaction (every upsert and delete succeeds together or
  nothing is written) as the caller, so the `call_offers` policies and OF001 / OF002 / OF003 apply per row - nothing
  bypassed. When `p_mode` is given the function runs `set_offer_mode(p_period, p_mode, who)` inside the same
  transaction after the rows, so a refused mode rolls the rows back too (days + mode are one commit or nothing; the
  9/23 review's finding). A repaint that sends no note keeps the row's note (`coalesce(excluded.note,
  call_offers.note)` - the importer's `seed: <tag>` survives a role change). `entered_by` / `source` come from the
  caller identity (own id / `app`; `scheduler` / `email-relay` when the scheduler paints for someone), never from the
  client. A malformed row refuses the whole batch before any write (OS003). The client writes the one audit row
  `offers.save` after ok. Both are `revoke ... from public, anon; grant execute ... to authenticated`. The migration's
  one `drop function if exists public.save_offers(text, jsonb, date[])` removes the never-applied three-argument draft
  so no second overload can exist (a no-op on the live database).

Applied 2026-09-23 ~18:45 UTC (the `observed:` line below; before the apply the painter's Save answered `404` `PGRST202`
"Could not find the function public.save_offers"). The apply-and-prove commands, kept for a rebuild (workdir = a
directory linked with `supabase link --project-ref bzhsroegtagqhutbnsrp`; absolute paths):

    supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-23-offer-mode-rpc.sql
    supabase db query --linked --workdir <dir> -f <abs>/sql/probes/offer-rpcs-probe.sql   # expects the A..K-anon + L / M lines in the probe header; everything rolls back

Expected PROBE_RESULTS (from the probe header): A ok upserted=2 (by=s3 src=app) rows=2 role=either note=seed: probe;
B ERR OS003 OFFERS_BAD_ROW; C ERR OS002 OFFERS_NOT_YOURS; D ERR OF002 OFFER_ON_VACATION with rows=2 (the good row rolled
back too); E ok upserted=1 deleted=1 rows=1 role=backup note=seed: probe (the note survived the note-less repaint);
F ok mode=exhaustive; G ERR OM006 MODE_HAS_OFFERS; H ok mode=rules_only status=rules_only; L ERR OM003 MODE_BAD_MODE
rows=0 (the row of the combined call rolled back with the refused mode); M ok upserted=1 mode=exhaustive
status=submitted rows=1 (days + mode in one call); I ERR OM005 MODE_FROZEN; J-mode ok / J-save ok by=scheduler
src=email-relay; K-mode ERR OM003 MODE_BAD_MODE; K-anon ERR 42501.

observed: applied 2026-09-23 ~18:45 UTC by the orchestrator through the linked CLI; `pg_proc`: set_offer_mode prosecdef true, save_offers prosecdef false; leftover count 0 - `PROBE_RESULTS A=ok upserted=2 deleted=0 by=s3 src=app rows=2 role=either note=seed: probe;B=ERR OS003 OFFERS_BAD_ROW: 2030-06-07 both (day must be YYYY-MM-DD, role_pref primary / backup / either) - nothing was saved rows=2 role=either note=seed: probe;C=ERR OS002 OFFERS_NOT_YOURS: only the scheduler can save another surgeon's offers;D=ERR OF002 OFFER_ON_VACATION: 2030-06-11 is inside a vacation of s3 rows=2 role=either note=seed: probe;E=ok upserted=1 deleted=1 rows=1 role=backup note=seed: probe;F=ok mode=exhaustive modes={"s3": "exhaustive"} rules_only=[];G=ERR OM006 MODE_HAS_OFFERS: s3 has 1 offered day(s) inside probe rpc open - clear them first to go by the rules;H=ok mode=rules_only rules_only=["s3"] modes={} status=rules_only;I=ERR OM005 MODE_FROZEN: offers for probe rpc frozen closed on 2026-09-01 - ask the scheduler;J-mode=ok mode=preferred rules_only=[];J-save=ok upserted=1 by=scheduler src=email-relay;K-anon=ERR 42501 permission denied for function save_offers;K-mode=ERR OM003 MODE_BAD_MODE: mode must be exhaustive, preferred or rules_only (got x);L=ERR OM003 MODE_BAD_MODE: mode must be exhaustive, preferred or rules_only (got x) rows=0 note=;M=ok upserted=1 mode=exhaustive modes={"s3": "exhaustive"} rules_only=[] status=submitted rows=1 note=;END`

## 2026-09-23 - east_vacation_reviews (Prompt 15 part 2)

**Status: APPLIED — 2026-09-23 04:37 by the orchestrator via the linked CLI, under Faraz's mandate** (report-first per
guide §4.3: this section was written and reviewed before the apply). The migration `sql/migrations/2026-09-23-east-vacation-reviews.sql`
went in as written — the byte-identical text sits in `sql/schema.sql` (revision `d`; `test/schema.test.js` pins the identity, the
columns, the constraints, the four policies, the absence of an anon policy and the placement); the observed strings are in the
*Observed* block at the end of this section. The table is empty until a review is saved from the app.

**What it is.** Prompt 15 mirrors the person's Davenport vacations into Silvis (part 1: `east_feed` payload
`data.vacations`), and nothing is mirrored blindly: each range is **unreviewed** (no row), **away** (also off at Silvis) or
**home** (available at Silvis — no East call, no OR block). This table holds the decision per exact range —
`person_id text`, `"start" date`, `"end" date`, `decision text check in ('away','home')`, `decided_at timestamptz default
now()`, `decided_by text`, `unique (person_id, "start", "end")`, plus `id uuid` as the primary key and `check ("end" >= "start")`.
The ranges themselves are never copied here. `rules.js` derives the consequences from the cached ranges + these rows
(`ctx.eastVacations`: unreviewed/away = a derived vacation with the existing `time-off:` / `day-before-vacation` codes; home
= `eastClear`), so a change of mind is one row and no `time_off` row is ever written. **Column names:** the prompt's
`start` / `end` are kept — `end` is a PostgreSQL reserved word, so the SQL quotes it (`"end"`); over PostgREST the JSON keys
and query parameters are plain `start` / `end`, the same shape as the feed payload `{ start, end }`. A range Davenport changes
or removes no longer matches its row (exact `start`+`end`), so the review resets to unreviewed and the app deletes the
stale row through the normal write path (`helpers.derivedEastVacations` lists it as `changed` / `removed`; audit
`eastvac.review`, reason reset; the refresh toast says so).

**Blast radius.** A new table, its index and four policies; no existing table, row, policy or function is touched
(`test/schema.test.js` pins that the migration's statements name no existing table). The table is empty until a review is
saved from Setup → East feed / the person's Time off view. Nothing in the anon-readable set changes.

**RLS.** `enable row level security`; `east_vacation_reviews_read` = `for select to authenticated using (true)` (read all,
authenticated only — **no anon policy**: a decision says where a surgeon is on a given day, so the table stays off the
anon list like `user_profiles`; an anon read is the silent `200 + []`, which `verify-rls.sh` 9a checks for an *empty* body
while the probe proves rows exist and stay invisible); `_self_insert` / `_self_update` / `_self_delete` = `to authenticated`
with `person_id = public.silvis_person_id() or public.silvis_is_sched()` (`using` + `with check` on update). No `for all`
policy. Contact data: none (dates, a decision, roster ids).

**The probe — `sql/probes/east-vacation-reviews-probe.sql` (persists nothing).** Same mechanism as the trade and claim
probes: one batch, no `BEGIN`/`COMMIT`, last statement raises `PROBE_RESULTS A1=...;END`, so the fixtures (two rows in
2030-05 with `decided_by = 'probe-eastvac'`, two throwaway `auth.users` `probe-eastvac-<uuid>@example.test` linked to
`s3`/surgeon and `s1`/scheduler) and everything a case wrote roll back. Cases, expected AFTER the migration:

| case | as | does | expected |
|---|---|---|---|
| A1 | anon | reads the table while two fixture rows exist | `rows=0` (RLS: silent, not an error) |
| A2 | anon | inserts a row | `ERR 42501 new row violates row-level security policy ...` |
| B | surgeon s3 | inserts his own row, then reads every row | `ok visible=3` (authenticated read-all: s2's row too) |
| C | surgeon s3 | inserts a row for s2 | `ERR 42501 ...` |
| D | surgeon s3 | updates s2's row (home → away) | `updated=0 decision=home` (the `using` filter is silent) |
| E | surgeon s3 | deletes s2's row | `deleted=0` |
| F | surgeon s3 | updates his own fixture row (away → home) | `updated=1 decision=home` |
| G | scheduler | updates s2's row and deletes s3's B row | `updated=1 decision=away deleted=1` |
| H | postgres | `decision = 'maybe'` | `ERR 23514 ...` (check constraint) |
| I | postgres | a second review of the same exact range | `ERR 23505 ...` (unique) |
| J | postgres | `"end"` before `"start"` | `ERR 23514 ...` |

BEFORE the migration the setup raises `PROBE_SETUP` (no table) and no sentinel comes back. Errors are recorded as
`ERR <SQLSTATE> <message>` (`;` and quotes flattened to spaces). Expected string after the migration, up to the
flattened message texts: `PROBE_RESULTS A1=rows=0;A2=ERR 42501 new row violates row-level security policy for table
east_vacation_reviews ;B=ok visible=3;C=ERR 42501 new row violates row-level security policy for table  east_vacation_reviews ;
D=updated=0 decision=home;E=deleted=0;F=updated=1 decision=home;G=updated=1 decision=away deleted=1;H=ERR 23514 new row
for relation  east_vacation_reviews  violates check constraint  east_vacation_reviews_decision_check ;I=ERR 23505 duplicate
key value violates unique constraint  east_vacation_reviews_person_id_start_end_key ;J=ERR 23514 new row for relation
east_vacation_reviews  violates check constraint  east_vacation_reviews_check ;END` (the constraint names are PostgreSQL's
defaults; `verify-rls.sh` grades the SQLSTATE and the `=`-values, not the message text).

Run it (absolute path; workdir linked with `supabase link --project-ref bzhsroegtagqhutbnsrp`):

    SILVIS_WORKDIR=<dir> bash scripts/verify-rls.sh                                                        # before: 9a/9b 404 (named), 9c no sentinel
    supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-23-east-vacation-reviews.sql
    supabase db query --linked --workdir <dir> -f <abs>/sql/probes/east-vacation-reviews-probe.sql        # after: the picture above
    SILVIS_WORKDIR=<dir> bash scripts/verify-rls.sh                                                        # section 9: 9a 200 + [], 9b 401/403, 9c graded + leftover count 0

After EVERY probe run the rollback is observed, never assumed (`verify-rls.sh` 9c does it; by hand after the manual run):

    supabase db query --linked --workdir <dir> -o json "select ((select count(*) from public.east_vacation_reviews where decided_by = 'probe-eastvac') + (select count(*) from auth.users where email like 'probe-eastvac-%@example.test'))::int as leftover"

`leftover` must be 0; otherwise clean up at once (`delete from public.east_vacation_reviews where decided_by =
'probe-eastvac'; delete from auth.users where email like 'probe-eastvac-%@example.test';` — `user_profiles` rows cascade)
and report. 9d (a surgeon's REST read) runs only with `SILVIS_SURGEON_JWT` and is read-only.

**Client consequence (parts 2-3 of Prompt 15, the UI part).** The Setup → East feed panel and the person's Time off view
list every cached range with its state and write these rows with `dbAuthHeaders()` (upsert on `person_id,start,end`;
`Prefer: resolution=merge-duplicates`), delete stale rows on refresh — **per person**:
`helpers.derivedEastVacations(rangesOfThatPerson, allReviewRows, personId).stale` (reason `changed` / `removed`), where
`personId` is the roster id resolved from the East code; the helper consults and lists only that person's rows, so
passing the whole read-all table is safe and another surgeon's rows are never decided by or deleted through his
refresh (without a `personId` nothing is stale) — with the audit row `eastvac.review { person_id, start, end, decision }`
(decision `reset` for a deletion) and name the count in the refresh toast; the app passes `eastVacationRanges` (per
roster id, from `eastVacations(eastFeedRows, code)`) and `eastVacationReviews` (the rows) to `buildContext`, reads
`res.eastVacation` / `res.eastClear` for the day-editor gloss and `rules.eastVacationConflicts(ctx)` for the panel's
conflict list. **Server-side:** `rpc/claim_open_slot` (`CL009 CLAIM_VACATION`), `apply_trade`'s vacation check and the
`time_off` trigger read `time_off` rows only; a derived East vacation is enforced by the client gate. Extending `CL009`
to read the `east_feed` vacations + `east_vacation_reviews` is a possible later migration, not part of this one.

**Observed (orchestrator, 2026-09-23 04:37, linked CLI; recorded here 2026-09-23 on the rebased `feat/east-vacations`):**

- Migration applied: 2026-09-23 04:37 (linked CLI, the migration file of this section; the CLI output line of the apply itself was not handed to this record — the `pg_policies` rows, the probe and the anon GET below are the evidence that the objects exist as written). `pg_policies` for
  the table → **4 rows, every one `roles = {authenticated}`**: `east_vacation_reviews_read` SELECT, `east_vacation_reviews_self_insert` INSERT,
  `east_vacation_reviews_self_update` UPDATE, `east_vacation_reviews_self_delete` DELETE — no anon policy, no `for all` policy;
  `pg_class.relrowsecurity = true`. The table is empty (no rows) after the probe.
- Probe AFTER (verbatim, the whole sentinel): `PROBE_RESULTS A1=rows=0;A2=ERR 42501 new row violates row-level security policy for table "east_vacation_reviews";B=ok visible=3;C=ERR 42501 new row violates row-level security policy for table "east_vacation_reviews";D=updated=0 decision=home;E=deleted=0;F=updated=1 decision=home;G=updated=1 decision=away deleted=1;H=ERR 23514 new row for relation "east_vacation_reviews" violates check constraint "east_vacation_reviews_decision_check";I=ERR 23505 duplicate key value violates unique constraint "east_vacation_reviews_person_id_start_end_key";J=ERR 23514 new row for relation "east_vacation_reviews" violates check constraint "east_vacation_reviews_check";END` — every case matches the expected picture above (A1 silent `rows=0`,
  A2 / C 42501, D / E silent no-ops, F / G the own-row and scheduler writes, H / I / J the constraints).
- Leftover count: `0` (the rollback observed, not assumed).
- `verify-rls.sh` section 9: **9a** anon `GET /rest/v1/east_vacation_reviews?select=person_id,start,end,decision&limit=5` → `HTTP 200` + `[]`
  (the post-migration expectation: the silent RLS empty read, no 404). The 9b and RESULT lines of the after-run were not handed to this
  record — paste them here on the next `SILVIS_WORKDIR=<dir> bash scripts/verify-rls.sh` run (expected 9b `401`/`403`, RESULT all-PASS).

## 2026-09-24 - pre-launch RLS (Prompt 16 A1)

**Status: APPLIED — 2026-09-23 ~18:35 Central by the orchestrator through the linked CLI, under Faraz's standing mandate of 9/23.**
Report-first (guide §4.3): `sql/migrations/2026-09-24-prelaunch-rls.sql` changes row-level security on the live project. This
section was the report; the file ran after the BEFORE probe and the *observed* line at the end carries the AFTER probe. Source of the before-state: the live `pg_policies` dump of 2026-09-23 ~17:10 (read-only); source of the
finding: the 2026-09-23 pre-launch review, item A (security, blocking) and the periods report's "freeze by status" decision.

**Before / after, per policy.** Every text below is byte-identical in the migration and in `sql/schema.sql` (`test/schema.test.js`
pins the identity, the guard bodies, the grants and the probe / verify-rls cases).

| policy / object | before (live 9/23) | after (this migration) | closes |
|---|---|---|---|
| `user_profiles_read` (SELECT, authenticated) | `using (true)` | `using (id = auth.uid() or public.silvis_is_sched() or role in ('admin','scheduler'))` | every signed-in account (a self-made one included) reading every profile row, `email` included; a surgeon's session still reads its own row and the scheduler / admin rows it addresses notifications to |
| `user_profiles_self_update` (UPDATE, authenticated) | with-check pins `role` and `person_id` | the same, plus `and email is not distinct from (select email from public.user_profiles p where p.id = auth.uid())` | a linked surgeon re-pointing his own `email` (what `send-notification` addresses and sends as) to an address he does not control, through the direct PostgREST PATCH; `display_name` stays self-editable. **Residual, stated:** the GoTrue email-change route still re-syncs `user_profiles.email` through `handle_new_auth_user` - see "What could break" |
| `contacts_read` (SELECT, authenticated) | `using (true)` | `using (public.silvis_is_sched())` | any signed-in account reading `office_contacts` |
| `notif_insert` (INSERT, authenticated) | `with check (true)` | `with check (public.silvis_is_sched() or public.silvis_person_id() is not null)` | an unlinked account writing into everyone's in-app feed |
| `audit_insert` (INSERT, authenticated) | `with check (true)` | `with check (public.silvis_is_sched() or (public.silvis_person_id() is not null and actor_id = public.silvis_person_id()))` | an unlinked account writing audit rows; a linked surgeon writing them under another `actor_id` (the client's `logAudit` sends `actor_id = userProfile.person_id`) |
| `notif_delete_sched` (DELETE, authenticated) | no delete policy on `notifications` (nobody could delete) | `using (public.silvis_is_sched())` | nothing - a new capability (spam removal by the scheduler / admin); the app has no delete UI yet (Part B) |
| `call_offers_guard` (trigger function, BEFORE INSERT OR UPDATE) | OF001 / OF002 / OF003 by close date (claim flag skips OF003) | + `OF004 OFFER_IMMUTABLE` on UPDATE when `new.day <> old.day or new.person_id <> old.person_id` and the caller is not a scheduler; OF003 also when `p.status <> 'upcoming'` | a surgeon moving an offer to another day (or person) through UPDATE instead of clear + offer; any surgeon write inside a published / closed / generated period whose close date still lies ahead |
| `call_offers_delete_guard` (trigger function, BEFORE DELETE) | OF003 by close date | OF003 also when `p.status <> 'upcoming'` | a surgeon deleting an offer inside a published period whose close date still lies ahead |
| `offer_status` `(uuid, text)` - function grants | EXECUTE to PUBLIC, anon, authenticated, postgres, service_role | revoked from public and anon; authenticated + service_role keep it | anon calling a status derivation (nothing anon calls it: the client uses `helpers.offerRollcall`, no edge function names it) |
| `user_profiles_admin`, `user_profiles_self_insert`, `notif_read`, `audit_read`, `contacts_write`, `call_offers_*`, `call_periods_*`, `set_offer_mode()` (OM005 already tests `p.status <> 'upcoming' or p.offers_close_at <= today_c`), `save_offers()`, `offer_status()` body | unchanged | unchanged | - |

**What could break, and the client lines checked (build 2026.09.23n, `index-source.html`).** `fetchProfile` :656 reads the own row
(`user_profiles?id=eq.<uid>`) - still readable by everyone. `schedulerIdsLoud` :1077 reads `role=in.(scheduler,admin)` rows - those
rows stay readable to every signed-in user, so a surgeon's session still addresses the scheduler. `loadClientVersions` :874 and
`loadAllProfilesLoud` :2077 read the whole table, but run only from :904 (`view === "settings" && isScheduler`) and :2115
(`view === "setup" && isAdmin`); `saveUserProfile` :2088 refuses a non-admin before any PATCH. The `office_contacts` read :3272 sits
in an effect that returns at :3269 unless `isScheduler`. `logAudit` :828 sends `actor_id = userProfile?.person_id || authUser?.id`:
a linked person's rows pass the new `audit_insert`; an unlinked viewer's would be refused - fire-and-forget with a console warning,
and no viewer action reaches a write today. `addNotification` :2786 is reached only from linked-person / scheduler actions. The
`shift_trade_requests` / `time_off` / `east_vacation_reviews` paths are untouched. `verify-rls.sh` 6b / 8c read the own profile row
(:157, :300). Edge functions read `user_profiles` / `office_contacts` with the service role. Residual, accepted: the scheduler / admin
rows (including their `email`) remain readable to every signed-in account - that is what the surgeon's notification path needs; with
public sign-ups switched off (dashboard, the same review item) "every signed-in account" is the seven invited people. The client
side of the review item - removing the dead "Sign up" link - is a separate front-end item, not part of this migration. A scheduler-
role account that is not admin still cannot correct another account's `email` (unchanged; Faraz's account is admin).

*Non-app writers of `call_offers`.* `silvis_is_sched()` reads `auth.uid()`, which is null for a postgres or service-role session,
so the CLI importer (`scripts/import-seed.js`, `supabase db query --linked`, runs as postgres) and the service role are
non-schedulers to both guards. Today the importer is refused (OF003, whole import rolls back) once `offers_close_at` has passed;
after this migration also once the period leaves `upcoming` - i.e. a seed change that adds or edits an offer inside the published
Nov 2026 - Jan 2027 period is refused from the apply on, not from 10/2. Fail-loud, nothing silent; a re-run of identical data
proposes no rows and fires nothing; late offers go through the app as the scheduler. The importer's own comments
(`scripts/import-seed.js` :95-98, `importer.js` :128 / :1380) still say "after offers_close_at" - a one-line Part B update,
outside A1's file list. `claim_open_slot` is covered by the claim flag; `daily-reminder` never writes `call_offers`.

*The email pin's residual - a decision for Faraz, not baked in.* The new with-check closes the direct PostgREST PATCH only.
GoTrue's self-service email change - `PUT /auth/v1/user {"email": ...}` with the anon key and the own access token, the endpoint
`config.js` already uses for passwords (the client has no email-change UI, so this is a curl-level path) - still rewrites
`auth.users.email` once the new mailbox confirms (and, with secure email change on, the old one too), and `handle_new_auth_user`
(`sql/schema.sql`, `security definer`, `after insert or update of email on auth.users`, `on conflict (id) do update set email =
excluded.email`, unchanged by this migration) copies it into `user_profiles.email` - the column `send-notification` reads for
recipients and sender identity. So "re-point to an address he does not control" is closed; "re-point to a mailbox he can confirm" is
not. Two hardenings, either one a separate prepared item (this file is pinned to exactly two `create or replace function`s):
(1) dashboard - check whether this project's Auth settings let self-service email updates be disabled; (2) a follow-up migration
changing `handle_new_auth_user`'s on-conflict to keep the existing address when the row is linked (`set email = case when
user_profiles.person_id is null then excluded.email else user_profiles.email end`; the admin corrects via Setup -> Users), with its
own probe and pin update. Faraz picks; until then the residual stands as accepted. **CLOSED 2026-09-24 (Faraz): handled in the
Supabase dashboard - Auth > *Secure email change* is ON (a change is confirmed from both the old and the new mailbox before
`auth.users.email` moves, so a stolen session alone cannot re-point the address); hardening (2), the `handle_new_auth_user`
on-conflict follow-up migration, is NOT planned. The analysis above stays as the record.**

**The probe - `sql/probes/prelaunch-rls-probe.sql` (persists nothing).** Same mechanism as the earlier probes: one batch, no
`BEGIN`/`COMMIT`, temp table granted to `authenticated` and `anon`, last statement raises `PROBE_RESULTS ...;END`. Fixtures in
2030-07 (two periods 'probe prelaunch open' 7/1-7/15 upcoming and 'probe prelaunch published' 7/16-7/31 with `offers_close_at`
2030-06-20 **in the future** and status published; s3's offers 7/5, 7/6, 7/20, note `probe-prelaunch`; an inactive
`office_contacts` row `probe-prelaunch`; a `notifications` row titled `probe-prelaunch`; three throwaway auth users
`probe-prelaunch-<uuid>@example.test`: a stranger = unlinked viewer, a surgeon linked to s3, an admin linked to s1). Its header
states, per case, the string read AFTER the migration and BEFORE it - so the same file, run before and after, shows the holes
closing. Expected AFTER (up to the flattened message texts): `A1=own=1 sees_surgeon=1 sees_stranger=1;A2=contacts=1;A3=ok
deleted=3;A4=ok;A5=updated=1;A6=updated=1;A7=ok rows=1;L1=own=1 leak=0 sched_ok=t;L10=ERR OF004 OFFER_IMMUTABLE ...;L11=updated=1;
L12=ERR OF003 OFFER_FROZEN: offers for probe prelaunch published closed on 2030-06-20 - ask the scheduler;L13=ERR OF003 ...;L14=ok
rows=1;L15=ERR OM005 MODE_FROZEN ...;L2=contacts=0;L3=ok;L4=ok;L5=ERR 42501 ... "audit_log";L6=ERR 42501 ... "user_profiles";
L7=updated=1;L8=deleted=0;L9=ERR OF004 OFFER_IMMUTABLE ...;N1=ERR 42501 permission denied for function offer_status;S1=own=1 leak=0
sched_ok=t;S2=contacts=0;S3=ERR 42501 ... "notifications";S4=ERR 42501 ... "audit_log";END`. Expected BEFORE: `S1` / `L1` read
`leak=N` with N >= 1, `S2` / `L2` `contacts=1`, `S3` / `S4` / `L5` `inserted (NO refusal)`, `L6` `updated=1`, `L9` `updated=1`, `L10`
`ERR 42501 ... "call_offers"`, `L12` `ok rows=1`, `L13` `deleted=1`, `A3` `ok deleted=0`, `N1` `status=not_started`; every other
case reads the same before and after. `scripts/verify-rls.sh` **section 10** grades every case, checks the anon `rpc/offer_status`
refusal (10a), the three client gates from the source (10b) and counts leftovers over `office_contacts` name, `notifications`
title, `audit_log` action, `call_offers` note, `call_periods` label and `auth.users` email (must be 0).

**Orchestrator commands, in order (probe before -> migration -> probe after -> verify-rls -> record);** absolute paths, the
workdir linked with `supabase link --project-ref bzhsroegtagqhutbnsrp`:

    supabase db query --linked --workdir <dir> -f <abs>/sql/probes/prelaunch-rls-probe.sql        # BEFORE: the holes, as the header states
    supabase db query --linked --workdir <dir> -o json "select ((select count(*) from public.office_contacts where name = 'probe-prelaunch') + (select count(*) from public.notifications where title = 'probe-prelaunch') + (select count(*) from public.audit_log where action = 'probe.prelaunch') + (select count(*) from public.call_offers where note = 'probe-prelaunch') + (select count(*) from public.call_periods where label like 'probe prelaunch%') + (select count(*) from auth.users where email like 'probe-prelaunch-%@example.test'))::int as leftover"   # 0
    supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-24-prelaunch-rls.sql   # after Faraz's go - ONE session
    supabase db query --linked --workdir <dir> -f <abs>/sql/probes/prelaunch-rls-probe.sql        # AFTER: the picture above
    SILVIS_WORKDIR=<dir> bash scripts/verify-rls.sh                                                  # section 10: 10a 401/403, 10b three PASS, 10c all cases PASS, leftover 0; sections 1-9 unchanged
    supabase db query --linked --workdir <dir> -o json "select tablename, policyname, cmd, roles, qual, with_check from pg_policies where tablename in ('user_profiles','office_contacts','notifications','audit_log') order by 1, 2"   # the after-state, for this record
    supabase db query --linked --workdir <dir> -o json "select grantee, privilege_type from information_schema.routine_privileges where routine_schema = 'public' and routine_name = 'offer_status' order by 1"   # authenticated, postgres, service_role - no PUBLIC, no anon

If the AFTER probe reads anything but the picture above, or the leftover count is not 0, stop and report before anything else is
applied. Rolling back = re-running the 9/22 / 9/23 texts from `git show 9809015:sql/schema.sql` (the five pre-existing policies
`user_profiles_read`, `user_profiles_self_update`, `contacts_read`, `notif_insert`, `audit_insert` and the two guard bodies) plus
`drop policy if exists notif_delete_sched on public.notifications;` (new here, no predecessor) plus
`grant execute on function public.offer_status(uuid, text) to anon and to public` (the before-state had both) - kept out of this
file on purpose.

**Record step (after the AFTER probe, verify-rls and the two after-state queries), one commit:** paste the AFTER probe sentinel, the
leftover 0, the verify-rls section 10 lines and both after-state query outputs at *observed:* below; change this section's status
from PREPARED to APPLIED <timestamp>; fill "applied: _to be filled by the orchestrator_" in guide §4.3; update table (b) above for
`user_profiles` / `notifications` / `audit_log` / `office_contacts`; and - so the header does not go stale the way revision i did -
change `sql/schema.sql`'s `Revision 2026-09-24 j (... report-first, NOT yet applied)` line to `applied <timestamp>` together with its
verbatim pin in `test/schema.test.js` (the `Revision 2026-09-24 j` regex), and in the same edit the `Revision 2026-09-23 i (... NOT
yet applied)` line + its pin, since that migration was applied 2026-09-23 ~18:45 UTC (recorded above). Then re-run
`node test/schema.test.js` (the `observed: ` pin only requires the prefix; the PREPARED pin must be updated to APPLIED).

observed: applied 2026-09-23 ~18:35 Central by the orchestrator through the linked CLI (migration sha256 24a799ec73c4950d...). Probe BEFORE (the holes): `PROBE_RESULTS A1=own=1 sees_surgeon=1 sees_stranger=1;A2=contacts=1;A3=ok deleted=0;A4=ok;A5=updated=1;A6=updated=1;A7=ok rows=1;L1=own=1 leak=1 sched_ok=t;L10=ERR 42501 new row violates row-level security policy for table "call_offers";L11=updated=1;L12=ok rows=1;L13=deleted=1;L14=ok rows=1;L15=ERR OM005 MODE_FROZEN: offers for probe prelaunch published closed on 2030-06-20 - ask the scheduler;L2=contacts=1;L3=ok;L4=ok;L5=inserted (NO refusal);L6=updated=1;L7=updated=1;L8=deleted=0;L9=updated=1;N1=status=not_started;S1=own=1 leak=1 sched_ok=t;S2=contacts=1;S3=inserted (NO refusal);S4=inserted (NO refusal);END`. Probe AFTER: `PROBE_RESULTS A1=own=1 sees_surgeon=1 sees_stranger=1;A2=contacts=1;A3=ok deleted=3;A4=ok;A5=updated=1;A6=updated=1;A7=ok rows=1;L1=own=1 leak=0 sched_ok=t;L10=ERR OF004 OFFER_IMMUTABLE: an offer keeps its day and person (s3 2030-07-06) - clear it and offer the other day instead;L11=updated=1;L12=ERR OF003 OFFER_FROZEN: offers for probe prelaunch published closed on 2030-06-20 - ask the scheduler;L13=ERR OF003 OFFER_FROZEN: offers for probe prelaunch published closed on 2030-06-20 - ask the scheduler;L14=ok rows=1;L15=ERR OM005 MODE_FROZEN: offers for probe prelaunch published closed on 2030-06-20 - ask the scheduler;L2=contacts=0;L3=ok;L4=ok;L5=ERR 42501 new row violates row-level security policy for table "audit_log";L6=ERR 42501 new row violates row-level security policy for table "user_profiles";L7=updated=1;L8=deleted=0;L9=ERR OF004 OFFER_IMMUTABLE: an offer keeps its day and person (s3 2030-07-05) - clear it and offer the other day instead;N1=ERR 42501 permission denied for function offer_status;S1=own=1 leak=0 sched_ok=t;S2=contacts=0;S3=ERR 42501 new row violates row-level security policy for table "notifications";S4=ERR 42501 new row violates row-level security policy for table "audit_log";END`. Leftover count 0 before and after. Policies re-read: user_profiles_read = (id = auth.uid()) OR silvis_is_sched() OR role in (admin, scheduler); user_profiles_self_update with-check pins role, person_id and email; contacts_read = silvis_is_sched(); notif_insert = silvis_is_sched() OR silvis_person_id() is not null; notif_delete_sched = silvis_is_sched(); audit_insert = silvis_is_sched() OR (silvis_person_id() is not null AND actor_id = silvis_person_id()); offer_status EXECUTE now authenticated / postgres / service_role only (anon rpc -> HTTP 401 42501). verify-rls.sh after the migration: 99 PASS / 0 FAIL once the grader strips the CLI-escaped quotes (before that fix 95 / 4 - the four were the escaped-quote artefact, every value correct).

## 2026-09-24 - definer locks + roster names (Prompt 16 B6; `sql/migrations/2026-09-24-definer-locks.sql`)

**Status: APPLIED - 2026-09-23 ~19:27 Central by the orchestrator through the linked CLI, under Faraz's standing mandate of 9/23** (report-first, guide section 4.3; the *observed* line at the end of this section). Review 2026-09-23
section 3, security minors: `apply_trade` and `claim_open_slot` did not lock `time_off` (write skew with a simultaneous vacation
change), and `trade_insert_guard` stored the client's `from_surgeon_name` / `to_surgeon_name`. One migration, three functions
(create or replace, idempotent), the `trade_insert_guard_trg` trigger re-created, both RPC revoke / grant pairs re-run; no table,
policy or row is touched. Bodies byte-identical to `sql/schema.sql` (`test/schema.test.js` pins them and freezes the superseded
9/22 `trade_insert_guard`, 9/23 trade-past `apply_trade` and 9/23 claim-offer `claim_open_slot` by sha256).

- **Table lock.** Both functions run `lock table public.time_off in share mode;` after the past-day / row-less refusals and
  BEFORE the `schedule_days` row locks and the vacation checks. Lock order: `apply_trade` trade row (update) -> time_off table
  (share) -> day rows (update); `claim_open_slot` time_off table (share) -> the day row (update). Why a table lock and not a
  row lock: the common race is a vacation INSERTED while the trade or claim is decided (the app's `toAdd`), and no row lock
  can cover a row that does not exist yet; every INSERT / UPDATE / DELETE on `time_off` holds ROW EXCLUSIVE on the relation
  from statement start (before its trigger runs), and ROW EXCLUSIVE conflicts with SHARE. So the vacation write waits until
  the apply / claim commits and its trigger then sees the committed swap (`ON_CALL_CONFLICT`), or - the other order - the
  function waits until the vacation commits and check (b) / CL009, a fresh snapshot per statement, sees the new or moved
  range. Deadlock-free: a `time_off` writer holds its table + tuple locks and only READS `schedule_days` (ACCESS SHARE; no
  function in the schema writes `time_off`), so it never waits on anything these functions hold; the functions take the
  `time_off` lock before any day row; SHARE is not self-conflicting (concurrent applies / claims do not serialise); every
  reader holds ACCESS SHARE. The lock is held for the rest of the RPC's transaction (milliseconds); a vacation save landing
  in that window waits, then its own trigger decides. The trigger-side change an earlier draft proposed
  (`time_off_no_call_conflict` reading `schedule_days ... FOR SHARE`) is NOT needed with the table lock.
- **Roster names.** `trade_insert_guard` sets both display names from `call_schedule_data 'main' -> roster[]` by id for every
  insert, after the id normalisation; an unknown id or a missing / malformed roster reads as the id (never a refusal).
  **Residual (outside B6's three functions):** `trade_update_guard` does not pin the two name columns and policy `trade_update`
  has no WITH CHECK, so a party's status PATCH may still carry `from_surgeon_name` / `to_surgeon_name`. Client side (this
  commit): `tradeNamed` in `index-source.html` resolves both names from the roster by id unconditionally, and the accept /
  decline / cancel flows re-resolve the PATCH-returned row before it feeds the feed message, the audit line and the e-mail -
  the stored strings are write-only display data. Queued for whoever owns `trade_update_guard` (a migration of its own, probe
  case: a member accepts with names 'Mallory' / 'Eve' -> names unchanged; `schema.test.js` pin), before the status logic:
  `if not public.silvis_is_sched() then new.from_surgeon_name := old.from_surgeon_name; new.to_surgeon_name := old.to_surgeon_name; end if;`
- **Vacation note denylist** is client-side only: `toAdd` refuses a note that trips the roster note's `SU_NOTE_DENYLIST` (the
  toast names the matched word only), and the backup-restore applier `applyTablesUpsert` blanks such a note instead of
  refusing the restore (count `time_off_notes_blanked` in the audit row's counts). No note column (`schedule_days.note`,
  `availability.note`, `call_offers.note`, `time_off.note`, the roster note) has a server-side denylist trigger; one migration
  for all of them is a later option.

Apply: `supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-24-definer-locks.sql` (after the 9/23
trade-past migration, applied ~16:00 UTC). Probes (both roll themselves back; `scripts/verify-rls.sh` sections 5 and 7 grade
them): trade probe `E2` = `share_locks=0` before -> `share_locks=1` after (a relation lock is first-class in `pg_locks`: mode
`ShareLock`, this backend's pid, granted; read right after E because E's inner block COMMITS - a lock taken inside the refused B
is released with B's subtransaction), `N` = `from_name=Mallory to_name=Eve` before -> `from_name=Burchett to_name=Acton` after;
claim probe `B2` = `share_locks=0` before -> `share_locks=1` after (B commits); every other case unchanged; leftover counts 0.
A single batch cannot show a second session waiting - that is PostgreSQL's lock-conflict rule; the statement and its position
are pinned by `test/schema.test.js`. Pre-check (nothing to migrate): `select count(*) from public.shift_trade_requests where
status in ('pending', 'accepted');`.

observed: applied 2026-09-23 ~19:27 Central by the orchestrator through the linked CLI (`supabase db query --linked -f sql/migrations/2026-09-24-definer-locks.sql`, empty result set, no error). Trade probe AFTER: `A=status=pending from=s2 decided=null; B..D=ERR TRADE_INELIGIBLE (vacation / already holds / locked); E=status=applied 03-11p=s2 03-13b=s3; E2=share_locks=1; F=status=applied locked=false; G=ERR TRADE_INELIGIBLE: a trade needs two different surgeons; ...` - every case as expected, the time_off SHARE lock visible in pg_locks. Claim probe AFTER: `A=ERR 42501 permission denied; B=ok version=2 backup=s3 source=claim audit=1; B2=share_locks=1; C=ERR CL005 CLAIM_HELD; D=ERR CL007 CLAIM_LOCKED; E=ERR CL003 CLAIM_PAST; ...` - as expected. verify-rls.sh afterwards: 70 passed, 0 failed (136 / 0 on the full run at 21:50 the same evening). Rollback of both probes observed (leftover 0). Evidence files stay in the orchestrator's scratch folder; the live catalog re-read at 21:45 shows `lock table public.time_off in share mode` in both apply_trade and claim_open_slot.

## 2026-09-24 - launch-night data changes (Prompt 16 step 2: note rename + blob-only seed apply)

**Status: APPLIED.** Two production writes under Faraz's launch-day authorization of 2026-09-23 (item 2). Neither touched a
schedule assignment, a lock, a version, an offer or a period; nothing was regenerated or republished. Both took a
`call_schedule_snapshots` row first (a failed capture blocks the write, as always).

| step | when (UTC) | by | snapshot | what changed | before -> after (observed) |
|---|---|---|---|---|---|
| (b) note rename | 2026-09-24 03:11 | the orchestrator through the linked CLI, one `do $$` block (`scratch: p16/live/note-rename.sql`: expected-count guard, snapshot, UPDATE, count check, audit row) | `2fcecfeb-eef6-45fe-9333-8a316be5cc9f` ("before the ER-panel source slug rename in schedule_days.note") | `schedule_days.note`: the ER-panel source slug that carried a staff member's name -> `office-er-call-panels-<date>` (B10 8b; the seed, the importer pins and the preview fixture carry the same slug since build 2026.09.23p) | rows with the old slug 57 -> 0; rows with the new slug 0 -> 57; `schedule_days` 112 -> 112; `version` / `updated_by` untouched (e.g. 2026-09-14 v1 seed, 2026-10-15 v3 day-edit); audit row `schedule.note_rename` (rows 57, the snapshot id) |
| (a) seed apply | 2026-09-24 03:33 | Faraz, `node scripts/import-seed.js --apply --workdir <linked dir>` from the main clone at the Part B1 build | `before_seed_import` (row 22) | `call_schedule_data 'main'`: `surgeonRules` / `groupRules` / `settings` per the B10 seed hygiene - the inert keys dropped (`groupRules.generationHorizons.presets`, `eastFeed.forecast.penaltyBelowThreshold`, `locks.nullSlotIsNeverLocked`, the per-surgeon dead keys), `weights.eastClear` explicit (2), `settings.importedAt` / `seedCoreHash` restamped | plan after the rename: `schedule_days: insert 0, update 0, unchanged 44, BLOCKED 29`, `Total changes: 84 (+30 blocked)` (blob + the idempotent offer / period upserts); after: blob `updated_at` 03:33:22Z by seed, `call_offers` 79 -> 79, `call_periods` 2 -> 2 (Nov 2026 - Jan 2027 published, Feb - Apr 2027 upcoming), `time_off` 8, `availability` 32, `schedule_days` 112 |

Observed afterwards: the smoke's four Import dry-run pins closed (441 ok / 0 FAIL on the Part B tree); the served app no
longer logs the dead-key warnings. The importer's own last line read `NOT VERIFIED` on Faraz's run - its post-apply parser
understood only the CLI's agent-session output shape; fixed the same night (`scripts/import-seed.js` reads both shapes
through `parseCliRows`, in build 2026.09.23q). No row was skipped: every guarded count matched the plan.

## 2026-09-24 - trade / claim audit rows carry actor_name + summary (item 5b)

**Status: APPLIED 2026-09-24 ~17:21 Central (22:21 UTC) by the orchestrator through the linked CLI, after Faraz's go; the two earlier `trade.apply` rows backfilled at his request (observed line at the end).** `sql/migrations/2026-09-24-trade-audit-names.sql` replaces two SECURITY DEFINER
functions on the live project (`apply_trade`, `claim_open_slot`; guide section 4.3), so this section is the report; the orchestrator
applies the file after Faraz's go and fills the *observed:* line at the end. Source of the finding: Faraz 9/24, item 5b - Settings >
Activity log showed `?` for the actor and the raw action `trade.apply` for the line of every applied trade (the client renders
`(en.detail && en.detail.summary) || en.action` and the actor chip from `actor_name`); the claim rows named their actor but showed
`schedule.claim`. Same-day ordering: the file declares `-- supersedes: sql/migrations/2026-09-24-definer-locks.sql` (B6, applied 9/23
~19:27 Central); `test/schema.test.js` freezes B6's two bodies by sha256 and mirrors `sql/schema.sql` from this file (header
revision m, "report-first, NOT yet applied" until the record step). Only the audit insert and the two helper lookups it needs change:
the day-row writes, the locks (B6 lock order), the checks, the grants and the trigger are byte-for-byte as they were.

**Before / after - the two audit inserts.**

`apply_trade`, before (live since 9/22; unchanged through the 9/23 and 9/24 files):

    insert into public.audit_log (actor_id, action, detail)
    values (me, 'trade.apply', jsonb_build_object('trade_id', p_trade_id, 'day', t.day, 'role', t.role, 'return_day', t.return_day, 'return_role', t.return_role, 'from', t.from_surgeon_id, 'to', t.to_surgeon_id));

`apply_trade`, after (`my_name text; summary text;` added to the declare block; `roster`, `to_name` and `fr_name` are the values the
checks already resolved from `call_schedule_data 'main' -> roster[]` by id):

    select nullif(p.display_name, '') into my_name from public.user_profiles p where p.id = auth.uid();
    my_name := coalesce(my_name, nullif((select r ->> 'name' from jsonb_array_elements(roster) r where r ->> 'id' = me limit 1), ''), me);
    summary := 'Trade applied: ' || to_name || ' takes ' || case when t.role = 'primary' then 'Primary' else 'Backup' end
               || ' ' || to_char(t.day, 'Dy Mon FMDD') || ' (from ' || fr_name
               || case when t.return_day is null then ', one-way)'
                       else '; ' || fr_name || ' takes ' || case when t.return_role = 'primary' then 'Primary' else 'Backup' end
                            || ' ' || to_char(t.return_day, 'Dy Mon FMDD') || ' in return)' end;
    insert into public.audit_log (actor_id, actor_name, action, detail)
    values (me, my_name, 'trade.apply', jsonb_build_object('summary', summary, 'trade_id', p_trade_id, 'day', t.day, 'role', t.role, 'return_day', t.return_day, 'return_role', t.return_role, 'from', t.from_surgeon_id, 'to', t.to_surgeon_id));

`claim_open_slot`, before (live since 9/23 07:05Z):

    insert into public.audit_log (actor_id, actor_name, action, detail)
    values (me, my_name, 'schedule.claim', jsonb_build_object('day', p_day, 'role', p_role, 'person', me, 'version', new_ver, 'offer', wrote_offer));

`claim_open_slot`, after (`summary text;` added to the declare block; the feed title's expression, unchanged where the title is built):

    summary := my_name || ' took ' || to_char(p_day, 'FMMM/FMDD') || ' ' || p_role;
    insert into public.audit_log (actor_id, actor_name, action, detail)
    values (me, my_name, 'schedule.claim', jsonb_build_object('summary', summary, 'day', p_day, 'role', p_role, 'person', me, 'version', new_ver, 'offer', wrote_offer));

- **actor_name (apply_trade).** The caller's own `user_profiles.display_name` (the function runs as the table owner, so the row is
  read whatever the RLS posture), else the roster name for the caller's roster id, else the id (`me`). An unlinked scheduler / admin
  with no display name keeps `actor_name` null, as `actor_id` already is for him - no invented name. The client's `logAudit` resolves
  its actor the same way (`display_name || roster name || "Unknown"`).
- **summary wording (apply_trade).** The client's `trade.accept` family (`helpers.js tradeLegsText`): "Trade applied: <to name> takes
  <Primary|Backup> <Dy Mon D> (from <from name>, one-way)" for a one-way trade; "Trade applied: <to name> takes <Role> <Dy Mon D>
  (from <from name>; <from name> takes <Role> <Dy Mon D> in return)" for a two-way one. Names are the ROSTER last names by id
  (`to_name` / `fr_name`, already resolved for checks (a)-(d)) - never the stored `from_surgeon_name` / `to_surgeon_name`, which a
  party's status PATCH may still rewrite (the B6 residual). Dates through `to_char(day, 'Dy Mon FMDD')` ("Sat Oct 10"; `Dy` / `Mon`
  give English names regardless of `lc_time`). Every other key of the detail object is kept; `summary` is added to it (the source
  text lists it first, as the client's `{ summary, ...details }` does - `jsonb` keeps no key order, so the stored value and what
  PostgREST returns are ordered by key, and the client reads by key).
- **summary (claim_open_slot).** The short form, the feed title it already composes: "<Name> took <M/D> <role>" ("Acton took 4/7
  backup"). Why not the notification sentence: the Activity log is a one-line list, the same words as the in-app feed row read alike
  in both places, and "(07:00 to 07:00)" is shift boilerplate the log does not need. `actor_name` stays `my_name`.

**What could break.** Nothing reads `detail.summary` or `actor_name` server-side: no policy, trigger, view or function tests them, and
the edge functions only INSERT audit rows (`daily-reminder` for the offers reminder) - none reads `audit_log`. The client reads both
for display only (Settings > Activity log; the coordinator's "your entries" view filters by action family, not by these fields). The
RPC return shapes, the CL / TRADE_* refusals, the row writes and the lock order are untouched (`test/schema.test.js` re-runs every
B6 / RLS-6 / D.2 pin against the new file). Existing rows keep their nulls - no backfill. `audit_log.actor_name` and `detail` have no
constraint beyond `detail jsonb not null`. A roster with no entry for the caller (an id the blob does not know) falls back to the id -
display data, never a refusal. Blast radius, in one sentence: from the apply on, every applied trade and every claim writes a
readable Activity log line under the actor's name; nothing else in the database or the app changes.

**The probes (both roll themselves back; `scripts/verify-rls.sh` sections 5 and 7 grade them).** `sql/probes/trade-guards-probe.sql`
gains `E3` (right after `E2`: the `trade.apply` row E wrote, read as postgres by `detail ->> 'trade_id'` - a TWO-WAY trade applied by
the surgeon s2, who has no `display_name`, so the roster fallback shows) and `F2` (right after `F`: the row F wrote - a ONE-WAY trade
applied by the SCHEDULER, whose profile the fixture now gives `display_name = 'Probe Scheduler'`, the display_name branch); its
leftover count also covers `trade.apply` audit rows keyed on the fixture trade ids. `sql/probes/claim-open-slot-probe.sql` gains
`B3` (right after `B2`: the `schedule.claim` row B wrote, by `detail ->> 'day' = '2030-04-07'`). The report flattens `;` to a space,
hence the two spaces inside E3's value. Expected strings:

| case | BEFORE the migration | AFTER |
|---|---|---|
| trade `E3` | `actor=null summary=null` | `actor=Burchett summary=Trade applied: Burchett takes Primary Mon Mar 11 (from Acton  Acton takes Backup Wed Mar 13 in return)` |
| trade `F2` | `actor=null summary=null` | `actor=Probe Scheduler summary=Trade applied: Burchett takes Primary Fri Mar 15 (from Acton, one-way)` |
| claim `B3` | `actor=Acton summary=null` | `actor=Acton summary=Acton took 4/7 backup` |

Every other case unchanged; leftover counts 0. Pre-check (nothing to migrate; the count is the rows that stay as they are):
`select count(*) from public.audit_log where action = 'trade.apply' and actor_name is null;`

Apply: `supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-24-trade-audit-names.sql` (after the B6 file,
applied 2026-09-23 ~19:27 Central). Order: trade probe + claim probe BEFORE (the left column) -> the migration, one session -> both
probes AFTER (the right column) -> `SILVIS_WORKDIR=<dir> bash scripts/verify-rls.sh` (sections 5 and 7 green, leftover 0) -> the
record step, ONE commit that flips four things and their pins in `test/schema.test.js` together (each pin is loud - `fail()` exits 1):
(1) paste the AFTER sentinels and the verify-rls lines at *observed:* below and change this section's status line to
`**Status: APPLIED <timestamp>.**` - pinned by the `Status: PREPARED - report-first \(not applied\)` regex in the 5b docs step, which
must move with it; (2) change `sql/schema.sql`'s `Revision 2026-09-24 m (... report-first, NOT yet applied)` to `applied <timestamp>`
- pinned by the `Revision 2026-09-24 m` regex in the 5b migration step, which must move with it; (3) the guide 4.3 row: `report-first,
NOT applied` -> `report-first, applied 2026-MM-DD` and `applied: _to be filled by the orchestrator_` -> `applied: 2026-MM-DD <how>` -
its two pins already accept both wordings (`report-first, (NOT applied|applied 2026-)` and `applied: (_to be filled by the
orchestrator_|2026-)`), so no test edit for the guide; (4) table (a)'s `audit_log` clause above drops "prepared ... not yet applied"
(not pinned beyond naming `actor_name` + `detail.summary`). Rolling back =
re-running the two bodies from `sql/migrations/2026-09-24-definer-locks.sql` (the B6 texts; frozen by sha256 in the suite).

observed: applied 2026-09-24 22:21 UTC by the orchestrator (`supabase db query --linked -f sql/migrations/2026-09-24-trade-audit-names.sql`, empty result, no error). Trade probe BEFORE: `E3=actor=null summary=null`, `F2=actor=null summary=null`; AFTER: `E3=actor=Burchett summary=Trade applied: Burchett takes Primary Mon Mar 11 (from Acton  Acton takes Backup Wed Mar 13 in return)` (the probe report flattens `;` to a space), `F2=actor=Probe Scheduler summary=Trade applied: Burchett takes Primary Fri Mar 15 (from Acton, one-way)`. Claim probe BEFORE: `B3=actor=Acton summary=null`; AFTER: `B3=actor=Acton summary=Acton took 4/7 backup`. Every other case of both probes (17 trade, 15 claim) identical BEFORE and AFTER (incl. `E2=share_locks=1`, `B2=share_locks=1`, `N=from_name=Burchett to_name=Acton`); both probes leftover 0. `scripts/verify-rls.sh` afterwards: sections 5 and 7 PASS (E3, F2, B3, leftover 0); one unrelated client-source check in section 11a failed on a stale grep (B3 had extended the banner gate to `!isCoordinator && !isViewer`) and was widened in the same record commit - re-run result in the commit message. Live catalog re-read: `apply_trade` and `claim_open_slot` both `prosecdef` true, both still take `lock table public.time_off in share mode`, both write `'summary', summary`.

Backfill (Faraz 9/24, same session, after the apply): the two `trade.apply` rows written 2026-09-24 12:26 CDT before the migration - audit ids `8bb30b4f-...` (trade `61c575f8-...`, Sat 10/10) and `471c899f-...` (trade `6fec84bc-...`, Sun 10/11), both actor_id `s1`, actor_name NULL, no summary - got `actor_name` = `Khan` and `detail.summary` = `Trade applied: Burchett takes Primary Sat Oct 10 (from Acton, one-way)` / `... Sun Oct 11 ...`; nothing else on the rows changed (created_at, actor_id and every other detail key re-read identical). One guarded `do $$` block: each row had to match what was read before (action, actor, null name, no summary, trade id, day, role, from / to, one-way), the weekday / month words were recomputed from the row's day with the function's own `to_char(day, 'Dy Mon FMDD')`, and exactly 2 rows had to change - any mismatch would have raised and persisted nothing. Restore statement (kept with the before-values in the orchestrator's scratch): `update public.audit_log set actor_name = null, detail = detail - 'summary' where id in ('471c899f-9bba-4540-8746-e06f139566bb','8bb30b4f-4840-4eae-a71f-d58fd30e8924');`

## 2026-09-24 - give a day: shift_trade_requests.kind (Prompt 19)

**Status: APPLIED 2026-09-25 ~00:34 Central (05:34 UTC) by the orchestrator through the linked CLI, under Faraz's 9/24 go ("push if it appears things will go well"); the member return-leg refusal is NOT in it (the prepared follow-up below).** `sql/migrations/2026-09-24-give-kind.sql` adds a column and two checks to
`shift_trade_requests` and replaces two live trigger functions (`trade_insert_guard`, `trade_update_guard`; guide section 4.3), so
this section is the report; the orchestrator applies the file after Faraz's go and fills the *observed:* line at the end. Source:
Faraz 9/24, Prompt 19 "Give a day away" - a member offers one of his days (or a whole weekend / holiday unit, one row per day) to a
named colleague, nothing comes back; the colleague accepts or declines; on accept it is applied exactly like a trade. Same-day
ordering: the file declares `-- supersedes: sql/migrations/2026-09-24-definer-locks.sql` (B6's `trade_insert_guard`, applied 9/23
~19:27 Central); `test/schema.test.js` freezes B6's `trade_insert_guard` and the 9/23 trade-past `trade_update_guard` by sha256 and
mirrors `sql/schema.sql` from this file (header revision n, "report-first, NOT yet applied" until the record step).
`apply_trade` is NOT redefined.

**Split (2026-09-24, S1 review - major; Faraz offline, the orchestrator took option (b) of the decision below).** As first
prepared (S1, `f9ad08f`) this file also refused a member `'trade'` without a return leg. That refusal breaks
**old installed builds** during the rollout: the build before Prompt 19's client step saves a member's whole-unit trade for one return day as a
head row WITH the return leg plus tail rows WITHOUT one, so after the apply the tails would be refused, leaving a half-saved unit
proposal whose head row, if accepted, applies as a **unit split** - and an installed PWA keeps its old build until its user
reloads. What ships now (this file): the `kind` column, both checks, the give-one-way refusal for every caller and kind
immutability - nothing an old build sends is refused (it never sends `kind`; the default `'trade'` applies and its tails land as
today). What waits: the member return-leg refusal, re-created byte-for-byte as S1 wrote it in the PREPARED follow-up
`sql/migrations/2026-09-25-member-trade-return-leg.sql` (its own section below), applied only after the `client_versions`
`min_version` bump to the Prompt 19 build (step 7 below) and a day for old builds to drain. The Prompt 19 client already sends a
member's unit tails as kind `'give'` and never inserts a member trade without a return leg, so nothing in the new app depends on
the deferred refusal. `sql/schema.sql` mirrors this file (what the next apply makes live), not the follow-up.

**Before / after.**

Table, before: no `kind`; a row is a trade with an optional return leg. After (additive; existing rows read `'trade'`):

    alter table public.shift_trade_requests add column if not exists kind text not null default 'trade';
    alter table public.shift_trade_requests drop constraint if exists shift_trade_requests_kind_check;
    alter table public.shift_trade_requests add constraint shift_trade_requests_kind_check check (kind in ('trade','give'));
    alter table public.shift_trade_requests drop constraint if exists shift_trade_requests_give_one_way;
    alter table public.shift_trade_requests add constraint shift_trade_requests_give_one_way check (kind = 'trade' or (return_day is null and return_role is null));

`trade_insert_guard`, before (B6, live): a member's row is normalised (from := his roster id, pending, stamped now, undecided), then
the same-surgeon refusal and the roster names - a member one-way trade (no return leg) was **not** refused by the database, only by
the client (`A return shift is required ... One-way trades are the scheduler's call`). After - one block added, everything else
byte-for-byte B6's (a member one-way `'trade'` is still accepted by the database; the refusal is the follow-up's):

    -- after the member branch, for EVERY caller:
    if new.kind = 'give' and (new.return_day is not null or new.return_role is not null) then
      raise exception 'TRADE_INELIGIBLE: a give is one-way - it carries no return shift' using errcode = 'P0001';
    end if;

`trade_update_guard`, before (9/23 trade-past, live): the TRADE_IMMUTABLE leg list is from / to / day / role / return_day /
return_role. After - one line added to the list, everything else byte-for-byte:

         or new.return_day is distinct from old.return_day or new.return_role is distinct from old.return_role
         or new.kind is distinct from old.kind then
        raise exception 'TRADE_IMMUTABLE: only the scheduler may change the legs of a trade' using errcode = 'P0001';

- **Codes.** The new insert refusal uses the existing `TRADE_INELIGIBLE` code (the client shows TRADE_* sentences verbatim); no
  new code. The kind change is refused with the existing `TRADE_IMMUTABLE`.
- **The member 'trade' refusal is deferred** (Faraz: "a 'trade' from a member still needs one" - the rule stands, its server
  half waits): until the follow-up is applied, a member `'trade'` with no or half a return leg is stored exactly as today (probes
  Q / Q3 read the same before and after this file); only the client refuses it. Scheduler / server rows are unchanged: a one-way
  `'trade'` is still theirs to record (probe U).
- **A scheduler-inserted 'give'** is allowed and means the same one-way move as his one-way trade, labelled as a give (probe U3). A
  give with a return leg is refused for every caller - the guard raises the sentence, and `shift_trade_requests_give_one_way`
  holds the invariant for writes that bypass the member rules (a scheduler UPDATE, which `trade_update_guard` lets through).
- **A member's give of a day he does not hold** is not refused at insert (the guard never checked holders; from is forced to the
  caller, as in probe H): it lands as HIS give and `apply_trade` refuses it with `TRADE_STALE` (probes P / P2). The client checks
  the holder before it proposes.
- **kind is a leg.** A member may not change it on his own row after insert (probe R), nor on a row he is a party to (S2); on a
  row he is no party to, policy `trade_update` filters the UPDATE out - 0 rows, as for any column (S). Accept / decline / cancel,
  TRADE_PAST and the `apply_trade` hand-off are unchanged.
- **apply_trade checked, not changed.** Its caller check is `sched or me = t.from_surgeon_id or me = t.to_surgeon_id`, so the
  RECEIVER may apply an accepted one-way row; every return-leg step is guarded by `t.return_day is not null`; the 5b audit summary
  reads "Trade applied: <to> takes <Role> <Dy Mon D> (from <from>, one-way)" (probes T / T2).

**What could break.** (1) **Unit tails - no rollout window in this file.** The live client proposes a whole weekend / holiday
unit as one row per day; with a single return day (a non-unit day) only row 1 carries it - rows 2..n are one-way `'trade'` rows
from a member ("the rest of the unit is one-way inside the group", `submitTradeRequest`). This file does not refuse them (the
member return-leg refusal is the follow-up's), so a stale app's whole-unit proposal saves every row exactly as today and no
half-saved proposal - and no member path to a **unit split** - can arise from this apply. That window belongs to the follow-up
(its section below states it and its gate). The Prompt 19 client sends such tails as `kind: 'give'` (`tradeGroupOf` groups by
the unit stamp, parties, role and status - not by kind - so the group stays one proposal); a client that sends `kind` BEFORE
PostgREST knows the column fails every insert (unknown column), which is why `verify-rls.sh` section 5c gates the push.
(2) Existing rows: untouched (the guard is INSERT-only; every row reads `'trade'`, passes both checks). (3) `verify-rls.sh` 6a
posts a member trade WITH a return leg (`return_day 2030-03-22 backup`), so it passes before and after both files. (4) Nothing
server-side reads `kind` besides the two triggers and the two checks; `send-notification` reads only the two party columns;
`apply_trade` does not read it. Blast radius, in one sentence: from the apply on, a new trade row that is a give must carry no
return leg (a kind no live client sends yet) and a member can no longer change a row's kind; every row an old or new client
sends today is still accepted, and nothing else in the database or the app changes.

**Decision (taken 2026-09-24: option (b)).** Put to Faraz as: (a) Accept the window with the mitigations (the file as first
prepared; the window is only hit by a member proposing a whole unit with ONE non-unit return day from a stale app).
(b) Two phases, no window: apply this file without the member return-leg block (the column, both checks, the give-one-way
refusal and kind immutability are safe for the live client - `kind` defaults to `'trade'`), then apply the block (probe cases
Q / Q3) as a follow-up migration once the min-version bump is in and the heartbeats show no older build - a second report.
(c) A server-side exemption for unit-tail rows (keyed on the `[unit ... day N of M]` detail stamp, N > 1) - no window, but it
ties the database to client text. Faraz is offline for a few days ("push if it appears things will go well"), so the orchestrator took the safe one,
(b): this file is phase 1, `sql/migrations/2026-09-25-member-trade-return-leg.sql` is phase 2 (PREPARED then; applied 2026-09-27 - its own section below).

**The probe (`sql/probes/trade-guards-probe.sql`, rolls itself back; `scripts/verify-rls.sh` section 5 grades it).** A / G / H / N
insert WITH a return leg (return 2030-03-04 backup) so they keep testing what they tested once the follow-up lands - their
expected strings are unchanged. Q / Q3 (a member `'trade'` with no / half a return leg) read the SAME before and after this file
(stored); their refused value is the follow-up's acceptance case (its section below), never graded live before that apply. The give fixtures (2030-03-25 / 03-27, trade ids `...030`-`...034`) sit in a block of their own (GIVE_SETUP) so the
BEFORE run still reports every other case. The report flattens quotes and `;` to spaces.

| case | what | BEFORE the migration | AFTER |
|---|---|---|---|
| `GIVE_SETUP` | give fixtures as postgres | `ERR column  kind  of relation  shift_trade_requests  does not exist` | `ok` |
| `O` | member gives his own day, no return | `ERR column  kind  ... does not exist` | `status=pending from=s2 kind=give return=null` |
| `P` | member gives a day held by s3, naming s3 as from | `ERR column  kind  ... does not exist` | `status=pending from=s2 kind=give` |
| `P2` | member applies an accepted give of a day he does not hold | `ERR TRADE_NOT_FOUND` | `ERR TRADE_STALE: 2030-03-03 primary is no longer held by s2` |
| `Q` | member 'trade' with no return | `status=pending return=null` | `status=pending return=null` (unchanged - refused only by the follow-up) |
| `Q2` | member 'give' with a return | `ERR column  kind  ... does not exist` | `ERR TRADE_INELIGIBLE: a give is one-way - it carries no return shift` |
| `Q3` | member 'trade' with a half leg (return day, no return role) | `status=pending return=2030-03-04 return_role=null` | `status=pending return=2030-03-04 return_role=null` (unchanged - refused only by the follow-up) |
| `Q4` | member 'give' carrying only a return role | `ERR column  kind  ... does not exist` | `ERR TRADE_INELIGIBLE: a give is one-way - it carries no return shift` |
| `R` | member changes kind on his own pending give | `ERR column  kind  ... does not exist` | `ERR TRADE_IMMUTABLE: only the scheduler may change the legs of a trade` |
| `S` | member changes kind on a row between s3 and s4 | `ERR column  kind  ... does not exist` | `rows=0 kind=trade` |
| `S2` | the receiver changes kind on s3's give to him | `ERR column  kind  ... does not exist` | `ERR TRADE_IMMUTABLE: only the scheduler may change the legs of a trade` |
| `S3` | the receiver ACCEPTS the pending give (`...033`) through the changed update guard | `rows=0 status=null` | `rows=1 status=accepted` |
| `T` | the RECEIVER applies an accepted give | `ERR TRADE_NOT_FOUND` | `status=applied 03-25p=s2` |
| `T2` | T's audit row | `actor=null summary=null` | `actor=Burchett summary=Trade applied: Burchett takes Primary Mon Mar 25 (from Acton, one-way)` |
| `U` | scheduler one-way 'trade' | `status=pending from=s3 return=null` | `status=pending from=s3 return=null` (unchanged) |
| `U2` | scheduler 'give' with a return | `ERR column  kind  ... does not exist` | `ERR TRADE_INELIGIBLE: a give is one-way - it carries no return shift` |
| `U3` | scheduler 'give', no return | `ERR column  kind  ... does not exist` | `status=pending from=s3 kind=give` |

Every other case unchanged; leftover count 0 (the fixtures are 2030-03 `source 'probe'` days, `detail like 'probe %'` trades and
`trade.apply` audit rows keyed on the `00000000-0000-4000-8000-0000000000..` fixture ids - all already in section 5's count).
Pre-check (the one-way rows that stay as they are - the guard is INSERT-only):
`select count(*) from public.shift_trade_requests where return_day is null and status in ('pending', 'accepted');`

Apply: `supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-24-give-kind.sql` (after
`2026-09-24-trade-audit-names.sql`, applied 2026-09-24 22:21 UTC). Order (no rollout window runs from this apply - old builds
keep working - but the client push still waits for the 5c gate, and step 7 starts the follow-up's drain clock):
1. trade probe BEFORE (the left column);
2. the migration, one session (it ends with `notify pgrst, 'reload schema'` so PostgREST sees the column at once);
3. trade probe AFTER (the right column);
4. the anon gate of `verify-rls.sh` section 5c - `GET $URL/rest/v1/shift_trade_requests?select=kind&limit=0` with the anon key
   must read HTTP 200 (before the apply: HTTP 400, code 42703 "column shift_trade_requests.kind does not exist", observed
   read-only 2026-09-24); never push the client while it reads 400;
5. the Prompt 19 client push AT ONCE (it sends `kind`), then wait for the CI build + Pages redeploy;
6. `SILVIS_WORKDIR=<dir> bash scripts/verify-rls.sh` in full (section 5 green, 5c PASS, leftover 0) - after the push, not before;
7. `update public.client_versions set min_version = '<the Prompt 19 APP_VERSION>', message = 'Please reload: trades and gives changed' where id = 'main';`
   so every older app shows the reload banner (Settings > client heartbeats shows who is still behind) - the precondition of the
   follow-up, which waits a further day after this for old builds to drain (the orphaned-head check moved to the follow-up: this
   file refuses no unit tail, so it cannot leave a lone head row);
8. the record step, ONE commit: paste the AFTER sentinel and the 5c line at *observed:* below and change this status line to
   `**Status: APPLIED <timestamp>.**`; change `sql/schema.sql`'s `Revision 2026-09-24 n (... report-first, NOT yet applied)` to
   `applied <timestamp>`; the guide 4.3 row `report-first, NOT applied` -> `report-first, applied 2026-MM-DD` and its `applied:`
   placeholder; table (a)'s `shift_trade_requests` row drops "prepared, not yet applied" (-> "applied 2026-MM-DD") - the four
   pins in `test/schema.test.js` accept both wordings.

Rolling back = re-running the B6 `trade_insert_guard` and the 9/23 `trade_update_guard` bodies (frozen by sha256 in the suite),
then `alter table public.shift_trade_requests drop constraint shift_trade_requests_give_one_way, drop constraint
shift_trade_requests_kind_check, drop column kind;` (only after every give row is gone or re-labelled - the column is data).

observed: applied 2026-09-25 05:34:26 UTC (`supabase db query --linked -f sql/migrations/2026-09-24-give-kind.sql`, empty result, no error). Trade probe BEFORE (35 cases): every give case `ERR column kind of relation shift_trade_requests does not exist` (GIVE_SETUP, O, P, Q2, Q4, R, S, S2, U2, U3), `P2=ERR TRADE_NOT_FOUND`, `S3=rows=0 status=null`, `T=ERR TRADE_NOT_FOUND`, `T2=actor=null summary=null`, and the stored `Q=status=pending return=null`, `Q3=status=pending return=2030-03-04 return_role=null`, `U=status=pending from=s3 return=null`. AFTER: `GIVE_SETUP=ok`, `O=status=pending from=s2 kind=give return=null`, `P=status=pending from=s2 kind=give`, `P2=ERR TRADE_STALE: 2030-03-03 primary is no longer held by s2`, `Q2` / `Q4` / `U2` = `ERR TRADE_INELIGIBLE: a give is one-way - it carries no return shift`, `R` / `S2` = `ERR TRADE_IMMUTABLE: only the scheduler may change the legs of a trade`, `S=rows=0 kind=trade`, `S3=rows=1 status=accepted`, `T=status=applied 03-25p=s2`, `T2=actor=Burchett summary=Trade applied: Burchett takes Primary Mon Mar 25 (from Acton, one-way)`, `U3=status=pending from=s3 kind=give`; `Q`, `Q3` and `U` identical before and after (old installed builds keep working - the split); the 17 other cases identical before and after. `scripts/verify-rls.sh` afterwards: 160 passed, 0 failed. send-notification v7 (the give's `trade_applied` may add the scheduler ids) deployed 2026-09-25 05:36:23 UTC BEFORE the client push, as the order requires (edge-functions/README.md section 3).

## 2026-09-25 - member trade return leg (Prompt 19 follow-up; `sql/migrations/2026-09-25-member-trade-return-leg.sql`)

**Status: APPLIED 2026-09-27 00:43:01Z.**
*Rollout (Faraz 9/25): ONE gate for this file and the followers file (revision o) - push the client, raise `client_versions.min_version` to that build, wait 24 h and require every heartbeat of the last 24 h to be on it or newer, then apply both with their probes. The gate (a scheduled task following a runbook outside the repo) grades the AFTER picture with `SILVIS_RETURN_LEG_APPLIED=1 bash scripts/verify-rls.sh` (section 5 then wants Q / Q3 refused; the default run keeps grading them STORED). The record step below makes REFUSED the default and drops that variable.*
*As run (2026-09-27): the gate was run by hand on Faraz's instruction (the scheduled run sat on a permission prompt and applied nothing), with the variable as planned; the record commit has since made REFUSED the only grading of Q / Q3 and dropped `SILVIS_RETURN_LEG_APPLIED` from `scripts/verify-rls.sh`. Was PREPARED - report-first (not applied) until then.*
Phase 2 of the Prompt 19 split (decision (b) in the section above): the member return-leg refusal S1 wrote into
`2026-09-24-give-kind.sql`, moved out because it breaks **old installed builds** during the rollout. The file re-creates
`trade_insert_guard` only - byte-for-byte S1's body (`git show f9ad08f:sql/migrations/2026-09-24-give-kind.sql`; `test/schema.test.js`
pins its sha256, proves it is the give-kind body plus this one block, and that undoing both Prompt 19 blocks gives B6's body) - and
its trigger; no table, check, policy, grant or row. `sql/schema.sql` does NOT mirror it (it mirrors what the next apply makes live);
its header carries a `PREPARED FOLLOW-UP, NOT MIRRORED` line instead of a revision line, and the suite exempts this one file from the
newest-migration mirror pin by name (`PREPARED_NOT_MIRRORED`) while that line and the file's marker say so. Revision
`2026-09-25 p` is planned, written only by the record step. *(As run: the record step of 2026-09-27 mirrored the body as
revision p, replaced that header line and the marker, and emptied `PREPARED_NOT_MIRRORED`.)*

**Before / after.** Before (the give-kind guard): a member `'trade'` with no or half a return leg is stored; only the client
refuses it. After - one block inside the member branch, right after the normalisation, everything else the give-kind body's:

    if new.kind is distinct from 'give' and (new.return_day is null or new.return_role is null) then
      raise exception 'TRADE_INELIGIBLE: a trade needs a return shift - pick the day and role you take in return, or give the day instead' using errcode = 'P0001';
    end if;

An ADDED refusal (Faraz: "a 'trade' from a member still needs one"): return_day AND return_role are both required, so a half leg
is refused too; a `kind` null reads as a trade (the not-null constraint refuses it after the trigger anyway). Scheduler / server
rows are unchanged (a one-way `'trade'` is still theirs to record, probe U); a member give with no return leg stays accepted (O).

**Gate - when to apply.** After the give-kind file is applied, the Prompt 19 client is pushed, and `client_versions` row `main`
carries `min_version` = the Prompt 19 build (give-kind step 7); then wait a day for old builds to drain - Settings > client
heartbeats must show no build older than the Prompt 19 one for that day. Nothing in the new client depends on this refusal: it
sends a member's unit tails as kind `'give'` and never inserts a member trade without a return leg.

**What could break.** **Unit tails - the rollout window** (the reason for the gate). The build before Prompt 19's client step
proposes a whole weekend / holiday unit as one row per day; with a single return day (a non-unit day) only row 1 carries it - rows
2..n are one-way `'trade'` rows from a member ("the rest of the unit is one-way inside the group", `submitTradeRequest`). From this
apply on the guard refuses those tail rows, until EVERY client runs the Prompt 19 build - not merely until the push: an installed
PWA keeps its old build until its user reloads (the min-version gate is a persistent banner; the reload is user-initiated). A
stale client's whole-unit proposal with one return day then inserts row 1 (with the return leg), is refused on row 2, and -
because `submitTradeRequest` returns early only when NO row was inserted - still announces the WHOLE unit: the `trade.propose`
audit row, the `trade_proposed` notification and the e-mail to both parties all read "... would take Primary <Fri>-<Sun> (the
<unit>, moved as one); ... in return". The giver sees "Couldn't submit the trade (1 of N unit days were submitted - cancel them or
ask the scheduler): TRADE_INELIGIBLE: a trade needs a return shift - ... or give the day instead" (a give option that build does
not have). The receiver's `acceptTrade` groups only the rows that exist (`tradeGroupOf` never counts the N days of the stamp), so
the lone head row can be accepted, and `apply_trade` (no unit check) moves day 1 plus the return day while the rest of the unit
stays with the giver - a member path to a **unit split**, which the client otherwise forbids. The gate makes that window empty;
the orphaned-head check below catches a straggler. Matched unit-for-unit trades and single-day trades are unaffected. Blast
radius, in one sentence: from the apply on, a member's new `'trade'` row must carry a full return leg (a give needs none) - which
refuses only what a pre-Prompt 19 build sends for a whole unit with one return day; nothing else changes.

**The probe (`sql/probes/trade-guards-probe.sql`, rolls itself back) - this file's acceptance case.** Every other case keeps its
expectation. `scripts/verify-rls.sh` section 5 grades Q / Q3 as stored until this file's record step (grading them refused before
the apply would fail against the live DB).

| case | what | BEFORE this file (give-kind live) | AFTER |
|---|---|---|---|
| `Q` | member 'trade' with no return | `status=pending return=null` | `ERR TRADE_INELIGIBLE: a trade needs a return shift - pick the day and role you take in return, or give the day instead` |
| `Q3` | member 'trade' with a half leg (return day, no return role) | `status=pending return=2030-03-04 return_role=null` | `ERR TRADE_INELIGIBLE: a trade needs a return shift - pick the day and role you take in return, or give the day instead` |

Apply: `supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-25-member-trade-return-leg.sql` (after the
gate). Order:
1. trade probe BEFORE (Q / Q3 stored);
2. the migration, one session;
3. trade probe AFTER (Q / Q3 refused, every other case unchanged);
4. the orphaned-head check - a unit-stamped head row whose unit has fewer rows than its stamp says, submitted after this apply (a
   straggler on an old build; the scheduler cancels a pending / accepted one and repairs an applied one) - right after the apply
   and again a day later:

       select t.id, t.day, t.role, t.status, t.from_surgeon_id, t.to_surgeon_id, t.detail
         from public.shift_trade_requests t
        where t.submitted_at >= '<apply timestamp>' and t.status in ('pending', 'accepted', 'applied')
          and t.detail ~ ', day 1 of [0-9]+\]'
          and (select count(*) from public.shift_trade_requests x
                where x.from_surgeon_id = t.from_surgeon_id and x.to_surgeon_id = t.to_surgeon_id and x.role = t.role and x.status = t.status
                  and substring(x.detail from '\[unit [a-z-]+ [0-9-]+ [0-9]+:') = substring(t.detail from '\[unit [a-z-]+ [0-9-]+ [0-9]+:'))
              < substring(t.detail from ', day 1 of ([0-9]+)\]')::int;

5. the record step, ONE commit: mirror this body into `sql/schema.sql`'s `trade_insert_guard` and replace its `PREPARED
   FOLLOW-UP, NOT MIRRORED` header line with `Revision 2026-09-25 p (Prompt 19 follow-up, sql/migrations/2026-09-25-member-trade-return-leg.sql,
   applied <timestamp>)`; drop the file's `PREPARED FOLLOW-UP` marker line; in `test/schema.test.js` empty `PREPARED_NOT_MIRRORED`
   (and move the marker-line pin with it), flip `GIVE_CASES` Q / Q3, flip **schema.sql's** `checkInsertGuard` call to
   `needsReturn=true`, compare schema.sql's `trade_insert_guard` with this file (not the give-kind file), undo it with
   `undoFollowUp` and flip the "schema.sql must NOT carry the member block" pin, and grade the `guardVerdict` cases' shipped
   column against the give-kind file's body - the give-kind file stays frozen as applied (one block), so its `checkInsertGuard`
   call **stays** `needsReturn=false` and its undo stays `undoInsert` (optionally freeze its `trade_insert_guard` by sha256 once it
   is no longer the newest); switch `verify-rls.sh` section 5's Q / Q3 lines to the refused sentence; this status line -> `**Status: APPLIED <timestamp>.**` with the AFTER sentinel
   at *observed:*; the guide 4.3 Prompt 19 row.

Rolling back = re-running the give-kind `trade_insert_guard` body and trigger (`sql/migrations/2026-09-24-give-kind.sql`).

**Gate procedure note - comparing probe runs from different days (Faraz's go, 2026-09-27).** Trade probe cases `I` and `K`
print the Central run day inside their `TRADE_PAST` text (`ERR TRADE_PAST: 2020-02-03 is before today (<YYYY-MM-DD>) in Central
time  past days are changed by the scheduler only`). The gate's first pass compared its 9/26 BEFORE run with the 9/25 baseline
text for text and stopped at step 1.1 on that date alone (`drift: I,K`). Any comparison of two probe runs taken on different
Central days - BEFORE against a baseline, AFTER against BEFORE across midnight - blanks that one date on BOTH sides of the
comparison first: only the `today (YYYY-MM-DD)` inside a `TRADE_PAST` text, nothing else, and the `Q` / `Q3` checks stay exact.
The gate's comparer does it with one helper, used on both sides of both comparisons:

    const blank = (v) => (typeof v === "string" ? v.replace(/(TRADE_PAST: .* is before today )\(\d{4}-\d{2}-\d{2}\)/, "$1(<date>)") : v);

With it the 9/26 BEFORE read 34 / 34 equal to the baseline and the run resumed from step 1.1. `scripts/verify-rls.sh` needs no
change for it - section 5 already grades `I` / `K` by the token and the day (`expect_past`), not the sentence. The comparer lives
outside the repo (`silvis-gate`) and carries the fix there; the runbook's text is unchanged. The same holds for any future baseline
taken from this probe.

observed: applied 2026-09-27 00:43:01.250052Z (`supabase db query --linked -f sql/migrations/2026-09-25-member-trade-return-leg.sql`, empty result, no error) by the 24-hour gate, run by hand in the orchestrator session on Faraz's instruction (the scheduled `silvis-24h-gate` run sat on a permission prompt from its first read and applied nothing; it was stopped first). Gate: `client_versions.min_version` 2026.09.25c since 2026-09-25T20:16:18Z; heartbeats PASS 28.08 h after the bump - s1-s5 all on 2026.09.25e (three older unlinked rows, last seen more than 24 h before, not judged). Trade probe BEFORE (34 cases): `Q=status=pending return=null`, `Q3=status=pending return=2030-03-04 return_role=null`, every case equal to the 9/25 post-give-kind baseline once the TRADE_PAST date is blanked (the note above; raw drift `I,K` only). AFTER: `Q=ERR TRADE_INELIGIBLE: a trade needs a return shift - pick the day and role you take in return, or give the day instead`, `Q3=` the same sentence; the other 32 cases unchanged -> RETURN-LEG APPLY ACCEPTED. Orphaned-head check (step 4, `submitted_at >= '2026-09-27 00:43:01.250052+00'`): 0 rows. Interim re-run 2026-09-27 13:35:38Z (orchestrator, linked CLI; Cowork ran the same query at 13:32Z): 0 rows - `shift_trade_requests` has no row submitted since the apply (2 in all, both 2026-09-24, the latest 17:26:22Z); every surgeon who has signed in heartbeats 2026.09.25e or 2026.09.26c (one surgeon has not signed in yet), and the only builds below 2026.09.25c are a viewer (25b) and a coordinator (24h), neither of whom `trade_insert` lets insert a trade (only the caller's own roster id, or the scheduler). Closing (day-after) re-run 2026-09-28 00:47:04Z (Cowork, read-only, the same query, `submitted_at >= '2026-09-27 00:43:01.250052+00'`): 0 rows - no `shift_trade_requests` row submitted since the apply (2 in all, both 2026-09-24); heartbeats in the 8 h before all on 2026.09.27b. The return-leg orphaned-head check is CLOSED. `SILVIS_PREFS_ROWS_BEFORE=2 SILVIS_RETURN_LEG_APPLIED=1 bash scripts/verify-rls.sh` (the gate's copy at 33e529d), after both this file and the followers file: `RESULT: 192 passed, 0 failed` - section 5 `probe Q` / `probe Q3` PASS as refused, leftover 0. Then `send-notification` v8 and `daily-reminder` v6 were deployed (edge-functions/README.md section 3). The record commit: schema.sql revision p (this body), `PREPARED_NOT_MIRRORED` emptied, section 5 grades `Q` / `Q3` refused by default, `SILVIS_RETURN_LEG_APPLIED` gone.

## 2026-09-24 - followers: user_profiles.follows + notification_preferences for an unlinked account (Prompt 20 F1)

**Status: APPLIED 2026-09-27 00:43:54Z.**
*By the 24-hour gate, run by hand on Faraz's instruction, right after the member return-leg follow-up (the section above); observed line at the end. Was PREPARED - report-first (not applied) until then.*
`sql/migrations/2026-09-24-followers.sql` changes row-level security and a primary
key on the live project (guide section 4.3), so this section is the report; the orchestrator applies the file after Faraz's go and fills
the *observed:* line at the end. What it is for: a viewer (or coordinator) account follows one or more surgeons and receives what that
surgeon receives, read-only - no new role, viewer + `follows`. This file is the data half only; the client and the two edge functions
learn to read `follows` / a follower's prefs row in later Prompt 20 steps. Same-day ordering: the file declares
`-- supersedes: sql/migrations/2026-09-24-prelaunch-rls.sql` (it re-creates A1's `user_profiles_self_update`) and runs after Prompt 19's
revision n; `sql/schema.sql` mirrors it (header revision o, "report-first, NOT yet applied" until the record step); `test/schema.test.js`
pins every text, the order of the DDL and this section.

**Before / after.**

| object | before | after |
|---|---|---|
| `user_profiles.follows` | - | `jsonb not null default '[]'` - the roster ids whose notifications the account receives; `user_profiles_follows_shape`: an array of non-empty strings (strict jsonpath, so `[["s2"]]` is refused - lax mode would unwrap it) |
| `user_profiles_self_update` | pins `role`, `person_id`, `email` | also pins `follows` (a follower cannot add a surgeon to his list; a surgeon cannot follow anyone by himself) |
| `user_profiles_self_insert` | `role = 'viewer' and person_id is null` | also `follows = '[]'::jsonb` (that door - reachable only when a profile row is missing - lands following nobody) |
| `user_profiles_admin` | admin: every verb | unchanged - it is the write path for `follows`: Setup > Users' `saveUserProfile` PATCHes `user_profiles?id=eq.<id>` and the client refuses a non-admin before the request (`if (!isAdmin)`). A non-admin scheduler cannot save an account in the client today, so the policy is not widened to the scheduler |
| `notification_preferences` key | `person_id text primary key` | `id uuid not null default gen_random_uuid()` is the primary key (`notification_preferences_pkey`); `person_id` UNIQUE (`notification_preferences_person_id_key`, added before the key moves) and nullable; `profile_id uuid` UNIQUE -> `user_profiles(id)` on delete cascade; `notification_preferences_one_owner`: exactly one of `person_id` / `profile_id` |
| `prefs_own` | `person_id = silvis_person_id() or silvis_is_sched()` | adds `or profile_id = auth.uid()` - a follower reads and writes his own row only |

The three policy texts after the migration, verbatim:

    create policy user_profiles_self_insert on public.user_profiles for insert to authenticated
      with check (id = auth.uid() and role = 'viewer' and person_id is null and follows = '[]'::jsonb);

    create policy user_profiles_self_update on public.user_profiles for update to authenticated
      using (id = auth.uid())
      with check (id = auth.uid()
        and role = (select role from public.user_profiles p where p.id = auth.uid())
        and person_id is not distinct from (select person_id from public.user_profiles p where p.id = auth.uid())
        and email is not distinct from (select email from public.user_profiles p where p.id = auth.uid())
        and follows is not distinct from (select follows from public.user_profiles p where p.id = auth.uid()));

    create policy prefs_own on public.notification_preferences for all to authenticated
      using (person_id = public.silvis_person_id() or profile_id = auth.uid() or public.silvis_is_sched())
      with check (person_id = public.silvis_person_id() or profile_id = auth.uid() or public.silvis_is_sched());

Every existing `notification_preferences` row keeps its `person_id` and flags, gets a fresh `id` and `profile_id` null (the one-owner
check holds for all of them); the file writes and deletes no row. If the live key constraint had another name than
`notification_preferences_pkey`, the `add constraint notification_preferences_pkey primary key (id)` line fails ("multiple primary keys")
and the whole file rolls back - the pre-check reads the names first.

**Decisions (Faraz 9/25).** Taken on the prepared file; nothing in it changes because of them:

- **Followers get the publish e-mail** - yes. `send-notification` (v8, deployed 2026-09-27 00:46:04 UTC) adds the followers to `schedule_published` as F3 built it
  (the publish broadcast reaches linked persons only, so a follower was never in it before).
- **The self-insert pin stays**: `user_profiles_self_insert` keeps `follows = '[]'::jsonb` (and `user_profiles_self_update` keeps its
  `follows` pin) - a profile never chooses whom it follows; the admin sets it in Setup > Users through `user_profiles_admin`.
- **A role change away from viewer / coordinator keeps clearing `follows`** (`helpers.followsPatch` adds `follows: []` to the same PATCH).
- The follower's own notification-preferences editor (the three switches and the reminder hour, saved by `profile_id` through `prefs_own`)
  is built (Prompt 20 R2, 9/25) and ships in the same push - it is what the functions' deploy PRECONDITION (`edge-functions/README.md`
  section 3) asks for. Before this migration it reads PostgREST's 400 `42703` for `profile_id` and says "Follower settings are available
  after the next update" with every control disabled - no write.
- **One rollout** with the member return-leg follow-up (`sql/migrations/2026-09-25-member-trade-return-leg.sql`), so everyone reloads
  once: push the app -> bump `client_versions.min_version` to that build -> 24 h have passed and every heartbeat in Client versions from
  the last 24 h is on that build or newer (if not, report instead of applying) -> apply both migrations with their before / after
  probes and `scripts/verify-rls.sh` -> deploy `send-notification` v8 and `daily-reminder` v6 -> report; stop and report if any probe
  differs. The two files do not overlap: this one touches `user_profiles` / `notification_preferences` (columns, constraints, three
  policies) only; the follow-up redefines `trade_insert_guard()` and re-creates its trigger `trade_insert_guard_trg` on
  `shift_trade_requests` only.

**What could break.**

- **The surgeons' prefs save (found while preparing this file).** The client's upsert (`db.upsert` -> `POST rest/v1/notification_preferences`,
  `Prefer: resolution=merge-duplicates`) sent NO `on_conflict`, so PostgREST merged on the primary key - `person_id` until now. After the move
  the key is `id`, and a payload without `id` hits `notification_preferences_person_id_key` instead: 23505 -> HTTP 409 on every existing
  surgeon's save (probe `S2` shows it). This branch makes the client send `?on_conflict=person_id` (`db.upsert(table, row, { onConflict })`,
  supabase-js's option name; valid BEFORE the migration too, where `person_id` is the key) - so the client ships first. A PWA still
  running an older build gets the loud "Couldn't save notification settings" toast (never a silent loss) until it reloads.
- **The edge functions** read prefs with the service role by `person_id`: `send-notification` (`select=*`, keyed by `person_id`, a row
  without one skipped) and `daily-reminder` (`select=person_id,schedule_updates_email` for the open-shifts / close paths;
  `select=*&person_id=in.(...)` for the day-before reminder).
  Both stay valid; `select=*` now also returns `id` / `profile_id`, which neither reads; a follower's row (`person_id` null) is ignored by
  both until a later Prompt 20 step teaches them to read it.
- **The client's reads.** The prefs load (`select=*`, keyed `prefs[r.person_id]`) skips a row without `person_id`; a follower's own row is
  read on its own path by `profile_id=eq.<his id>` (Prompt 20 R2 - a 400 `42703` before this migration, which the card says); the `user_profiles?select=*` reads (`fetchProfile`, `loadAllProfilesLoud`, `loadClientVersions`) gain a `follows`
  key nobody reads yet; `saveUserProfile` PATCHes only the keys it changes. `handle_new_auth_user` inserts `(id, email, role)` - `follows`
  takes its default; its email re-sync never touches `follows`.
- **PostgREST's schema cache** reloads on DDL by itself on Supabase; if a REST call answers PGRST204 (column not found) right after the
  apply, `notify pgrst, 'reload schema';`.

Blast radius, in one sentence: every `user_profiles` row gains `follows = []` (nothing reads it yet); `notification_preferences` gets a new
primary key and two columns - the surgeons' rows keep their `person_id` and flags, both edge functions' `person_id` reads stay valid, and
the one write path affected is the client's prefs upsert, which this branch pins to `on_conflict=person_id` (client first).

**The probe (`sql/probes/followers-probe.sql`, rolls itself back; `scripts/verify-rls.sh` section 12 grades it).** Four throwaway users
`probe-follow-<uuid>@example.test` - a follower and a second follower (unlinked viewers), a surgeon linked to the NON-roster id
`probe-follow` (no live prefs row is touched even inside the rolled-back batch) and an admin. BEFORE the migration the first block raises
`PROBE_SETUP: user_profiles.follows / notification_preferences.profile_id are absent - ... (this is the BEFORE picture) -
notification_preferences rows=N`; AFTER it every case reads:

| case | who / what | AFTER |
|---|---|---|
| `R1` | postgres, before any fixture: the table's rows | apply-time run: `rows=N person=N profile=0 ids=N` (the same N as the BEFORE run); every run: ids = rows and person + profile = rows (`grade_r1_12` - a follower's saved prefs make it e.g. `rows=N+1 person=N profile=1 ids=N+1`, still green) |
| `K1` | postgres: key + unique constraints | `pk=id unique=person_id,profile_id` |
| `F1` | follower sets his own `follows` to `["s2"]` | `ERR 42501 new row violates row-level security policy for table "user_profiles"` |
| `F2` | follower changes his own display_name | `updated=1` |
| `P1` | follower upserts his own prefs row on `profile_id` | `ok rows=1 schedule=false` |
| `P2` | follower updates it | `updated=1` |
| `P3` | follower reads the table | `own=1 others=0` |
| `P4` | follower updates the surgeon's and the other follower's rows | `updated=0` |
| `P5` | follower deletes them | `deleted=0` |
| `P6` | follower inserts a row for `person_id` s2 | `ERR 42501 ... for table "notification_preferences"` |
| `P7` | follower inserts a row for the other follower's `profile_id` | `ERR 42501 ... for table "notification_preferences"` |
| `P8` | follower re-points his row to `person_id` s2 | `ERR 42501 ... for table "notification_preferences"` |
| `P9` | follower inserts a row with both keys | `ERR 23514 ... violates check constraint "notification_preferences_one_owner"` |
| `A1` | admin sets the follower's `follows` to `["s2"]` | `updated=1 follows=["s2"]` |
| `A2` | admin sets `follows` to `[1]` | `ERR 23514 ... violates check constraint "user_profiles_follows_shape"` |
| `A3` | admin sets `follows` to `{"s2": true}` | `ERR 23514 ... "user_profiles_follows_shape"` |
| `A4` | admin sets `follows` to `[["s2"]]` | `ERR 23514 ... "user_profiles_follows_shape"` |
| `A5` | admin reads the three probe prefs rows | `probe_rows=3` |
| `A6` | admin inserts a prefs row with neither key | `ERR 23514 ... "notification_preferences_one_owner"` |
| `F3` | follower reads whom he follows | `follows=["s2"]` |
| `F4` | follower clears his own `follows` | `ERR 42501 ... for table "user_profiles"` |
| `S1` | surgeon upserts his row on `person_id` (the client's `on_conflict=person_id`) | `ok rows=1 schedule=false` |
| `S2` | surgeon upserts on the primary key (PostgREST without `on_conflict`) | `ERR 23505 duplicate key value violates unique constraint "notification_preferences_person_id_key"` |
| `S3` | surgeon reads the table | `own=1 others=0` |
| `S4` | surgeon sets his own `follows` | `ERR 42501 ... for table "user_profiles"` |
| `I1` | the second follower's profile row deleted as postgres; he self-inserts it with `follows` `["s2"]` | `ERR 42501 ... for table "user_profiles"` |
| `I2` | he self-inserts it following nobody | `ok follows=[]` |
| `X1` | postgres deletes the follower's auth user | `before=1 after=0` (his prefs row cascades through `user_profiles`) |

Leftover count 0 (auth.users `probe-follow-%@example.test`, `user_profiles` display names `probe follow%`, prefs `person_id = 'probe-follow'`).

**Apply order.**

1. Client first: the branch's `saveNotifPref` sends `?on_conflict=person_id` through `notifPrefsDb.save({ personId })` (config.js;
   the row is helpers.js `notifPrefSaveRequest`'s since P20 R2 - pinned by `test/data-layer.test.js` and verify-rls 12a, whose strings
   `test/schema.test.js` checks against the files they name). It ships with the push; observe that the live build carries it before
   step 4: `bash scripts/verify-rls.sh` section 12a' (three anon GETs of the Pages `config.js` / `helpers.js` / `index.html`) must print `ok live client: ...` - red means do NOT apply yet.
   Then raise `client_versions.min_version` (decided, Faraz 9/25 - no longer a choice): a PWA left open on an older build keeps sending
   the upsert without `on_conflict` and gets the "Couldn't save notification settings" toast after step 4 until it reloads. Raise row
   `main`'s `min_version` to the APP_VERSION the deploy stamped (SQL only - no client path writes it: `update public.client_versions set
   min_version = '<that version>' where id = 'main';`, which puts the refresh banner on every older client); record the version in the
   observed line.
   Then the drain gate: wait until 24 h have passed since the bump AND every heartbeat in Client versions (Settings) from the last 24 h
   is on that build or newer. If not, report instead of applying - steps 2-7 wait. The same gate covers the member return-leg
   follow-up (section "2026-09-25 - member trade return leg" above), which is applied in the same window (ONE rollout, see the
   Decisions paragraph); `send-notification` v8 and `daily-reminder` v6 are deployed only after both files are applied and verified.
2. Pre-checks, read-only: `select count(*) from public.notification_preferences;` and
   `select conname, contype from pg_constraint where conrelid = 'public.notification_preferences'::regclass order by 1;`
   (expected: `notification_preferences_pkey` `p` only). The table is authenticated-only, so the count is read through the CLI, not anon.
3. Probe BEFORE: `supabase db query --linked --workdir <dir> -f <abs>/sql/probes/followers-probe.sql` -> `PROBE_SETUP ... rows=N` (N = step 2's count).
4. The migration, one session: `supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-24-followers.sql`.
5. Probe AFTER (the table above; `R1` must say `rows=N person=N profile=0` with step 2's N).
6. `SILVIS_PREFS_ROWS_BEFORE=<N> SILVIS_WORKDIR=<dir> bash scripts/verify-rls.sh` - section 12 green, leftover 0.
7. The record step, ONE commit: this status line -> `**Status: APPLIED <timestamp>.**`; `sql/schema.sql` revision o -> `applied <timestamp>`;
   the guide 4.3 bullet -> `report-first, applied 2026-MM-DD` + its `applied:` line; tables (a) / (b) drop "prepared"; the observed line
   below. The pins accept both wordings.

Rolling back (only while no follower row exists; the client's `on_conflict=person_id` is valid either way). First the read-only guard
`select count(*) from public.notification_preferences where person_id is null;` - it must be 0. Anything else means followers have
saved prefs that the old key (`person_id` not null) cannot hold: stop and decide with Faraz (record the rows first; nothing is
deleted by this recipe). With 0: drop `notification_preferences_one_owner` and
`notification_preferences_pkey`, `alter column person_id set not null`, `add constraint notification_preferences_pkey primary key (person_id)`,
drop `notification_preferences_person_id_key` / `_profile_id_key`, drop the columns `profile_id` and `id`; re-create `prefs_own`,
`user_profiles_self_update` (A1's text in `sql/migrations/2026-09-24-prelaunch-rls.sql`) and `user_profiles_self_insert` (without the
`follows` clause); drop `user_profiles_follows_shape` and the `follows` column.

observed: applied 2026-09-27 00:43:54.256885Z (`supabase db query --linked -f sql/migrations/2026-09-24-followers.sql`, empty result, no error) by the 24-hour gate (run by hand), 53 s after the member return-leg follow-up. Step 1: no separate 12a' run before the apply - the served build was attested by the gate's heartbeats instead: `client_versions.min_version` 2026.09.25c since 2026-09-25T20:16:18Z (the rollout build, whose `config.js` already sends the prefs upsert with `on_conflict=person_id`), heartbeats PASS 28.08 h after the bump (s1-s5 on 2026.09.25e, newer than 2026.09.25c); the post-apply verify-rls run below read 12a' `live client: the served build sends the prefs upsert with on_conflict=person_id` PASS. Pre-checks (read-only): `notification_preferences` rows = 2 (N = 2), `user_profiles.follows` absent, constraints `notification_preferences_pkey:p,notification_preferences_reminder_hour_central_check:c` (one primary key, as expected). Probe BEFORE: `PROBE_SETUP: user_profiles.follows / notification_preferences.profile_id are absent - sql/migrations/2026-09-24-followers.sql is not applied (this is the BEFORE picture) - notification_preferences rows=2`. Probe AFTER, every case its AFTER value: `R1=rows=2 person=2 profile=0 ids=2`, `K1=pk=id unique=person_id,profile_id`, `F1` / `F4` / `S4` / `I1` = `ERR 42501 ... for table "user_profiles"`, `P6` / `P7` / `P8` = `ERR 42501 ... for table "notification_preferences"`, `P9` / `A6` = `ERR 23514 ... "notification_preferences_one_owner"`, `A2` / `A3` / `A4` = `ERR 23514 ... "user_profiles_follows_shape"`, `S2=ERR 23505 duplicate key value violates unique constraint "notification_preferences_person_id_key"`, `F2=updated=1`, `P1=ok rows=1 schedule=false`, `P2=updated=1`, `P3=own=1 others=0`, `P4=updated=0`, `P5=deleted=0`, `A1=updated=1 follows=["s2"]`, `A5=probe_rows=3`, `F3=follows=["s2"]`, `S1=ok rows=1 schedule=false`, `S3=own=1 others=0`, `I2=ok follows=[]`, `X1=before=1 after=0`. Post-check: `follows` column present; prefs rows 2 -> 2 (none lost, none added); constraints now `notification_preferences_one_owner:c, notification_preferences_person_id_key:u, notification_preferences_pkey:p, notification_preferences_profile_id_fkey:f, notification_preferences_profile_id_key:u, notification_preferences_reminder_hour_central_check:c`. `SILVIS_PREFS_ROWS_BEFORE=2 SILVIS_RETURN_LEG_APPLIED=1 bash scripts/verify-rls.sh` (the gate's copy at 33e529d): `RESULT: 192 passed, 0 failed`; section 12 every case PASS, incl. `R1 (apply-time run): no follower row yet and the 2 surgeon rows equal the count before (2)`; leftover 0. `send-notification` v8 and `daily-reminder` v6 deployed after both files (edge-functions/README.md section 3). Next: Faraz sets Follows for the follower accounts in Setup > Users.

## 2026-09-25 - audit_log read-back: audit_read_own (Prompt 21 step 1; `sql/migrations/2026-09-25-audit-read-own.sql`)

**Status: APPLIED 2026-09-27 00:49:39Z.**
*After the 24-hour gate had run (by hand) and passed; observed line at the end. Was PREPARED - report-first (not applied), waiting for the 24-hour gate and Faraz's go - never applied ahead of the gate - until then.*
`sql/migrations/2026-09-25-audit-read-own.sql` changes row-level security on the live project (guide section 4.3), so this section is
the report; the orchestrator applies the file only after the gate has run and Faraz has approved, and fills the *observed:* line at
the end. One select policy on `audit_log`; `audit_insert`, `audit_read` and `audit_read_coord` are byte-unchanged; no table, column,
function, trigger, grant or row. `sql/schema.sql` mirrors it (header revision q, "report-first, NOT yet applied" until the record
step); `test/schema.test.js` pins the text, the mirror, the probe, `scripts/verify-rls.sh` section 13 and this section.

**Evidence (the live check, 9/25 ~7:30 CDT).** Acton entered two vacations on 9/24, at 13:17 and 13:19 CDT. Both
`time_off` rows exist (created 18:17 and 18:19 UTC, `created_by` s3) and so do both `vacation_logged` notifications, but `audit_log`
has no `timeoff.add` row for either. The API gateway log shows `POST /rest/v1/audit_log` -> 403 at 2026-09-24 18:17:57Z and 18:19:23Z -
the only failed writes from a real client in the 24 hours before the 9/25 check. Every row in `audit_log` so far was written by Khan
or by a CLI.

**Cause.** `config.js` `db.insert` sends `Prefer: return=representation`, so PostgREST runs `INSERT ... RETURNING`. A RETURNING that
reads the row's columns needs the new row to pass a SELECT policy as well as the INSERT one (PostgreSQL checks the returned row
against the table's SELECT policies and raises, rather than filtering it). `audit_insert`'s WITH CHECK passes for a linked surgeon
(`actor_id = silvis_person_id()`), but `audit_read` is the scheduler / admin's and `audit_read_coord` covers only a coordinator's own
`timeoff.` / `offers.` / `availability.` rows - so the insert is refused with 42501 `new row violates row-level security policy for
table "audit_log"` -> HTTP 403, and `logAudit` only calls `console.warn`. Probe case `L4` (the prelaunch probe, `scripts/verify-rls.sh`
section 10) inserts WITHOUT RETURNING, which is why verify-rls passed.

**The diagnostic (9/25 ~15:35 CDT, rolled back).** One batch against the live database through the linked CLI with throwaway users
(a surgeon linked to s3, a coordinator, an unlinked viewer, an admin linked to s1); every insert ran once as the database is today
and once after `create policy audit_read_own` inside the same transaction, and the final RAISE rolled everything back. Faraz's
leftover check in the SQL editor at 15:50 CDT: 0 probe users, 0 probe audit rows, the policies still
`audit_insert,audit_read,audit_read_coord`, no probe user or probe audit row of any other kind, `user_profiles` still 10 rows.

| who / what | today (live) | with `audit_read_own` |
|---|---|---|
| surgeon s3, `timeoff.add`, no RETURNING | ok | ok |
| surgeon s3, `RETURNING *` | ERR 42501 | ok |
| surgeon s3, `RETURNING 1` | ok | ok |
| coordinator (no roster link, `actor_id = auth.uid()`), `timeoff.add`, `RETURNING *` | ok (`audit_read_coord` covers the family) | ok |
| coordinator, `prefs.save`, `RETURNING *` | ERR 42501 | ok |
| coordinator, `prefs.save`, no RETURNING | ok | ok |
| unlinked viewer (what a follower is), `prefs.save`, with or without RETURNING | ERR 42501 (`audit_insert`'s WITH CHECK) | ERR 42501 |
| admin s1, `RETURNING *` (control) | ok | ok |
| rows written by someone else, visible to the surgeon / the coordinator | 0 / 0 | 0 / 0 |

`RETURNING 1` reads no column, so no SELECT policy is consulted: the refusal was always the read-back, never the insert.

**The policy (after), verbatim:**

    create policy audit_read_own on public.audit_log for select to authenticated
      using ((public.silvis_person_id() is not null and actor_id = public.silvis_person_id()) or actor_id = auth.uid()::text);

A signed-in user reads the rows whose `actor_id` is his own roster id (a linked person - what `logAudit` writes:
`userProfile.person_id`) or his own profile id (`auth.uid()::text` - `logAudit`'s fallback for an account with no roster link, i.e. a
coordinator). That is exactly the row `audit_insert` has just let him write, so `INSERT ... RETURNING` passes for every caller
`audit_insert` admits. The `silvis_person_id() is not null` guard states the intent (an unlinked account never matches through the
roster clause). Policies are OR'ed, so the scheduler's `audit_read` (every row) is untouched.

**Decisions (Faraz 9/25).**

- **1b** - approved as written: `audit_read_own` with the text above. **`audit_read_coord` is kept**: now redundant (for a
  coordinator its rows are a subset of `audit_read_own`'s), kept on purpose to keep the change small. `audit_insert` is not changed.
- **1c** - approved: no change for viewers or followers now. An unlinked viewer (what a follower is) is refused by `audit_insert`'s
  WITH CHECK before any read-back; the client's follower prefs save deliberately writes no audit row (`saveFollowerPref` in
  `index-source.html`); opening `audit_insert` to viewers would reopen the stranger hole the pre-launch migration closed (prelaunch
  probe `S4`). A follows-scoped clause is a possible later item, not part of this step.
- **1d** - approved: the step-1 files are written and committed locally - not pushed, not applied. Order: the 24-hour gate runs ->
  report -> Faraz approves -> apply -> verify-rls -> push. If the gate reports instead of applying, stop and tell Faraz. Never apply
  this file ahead of the gate (why: apply order step 1). The rebase onto the gate's record commit (apply order step 2) is
  preparation between "Faraz approves" and "apply", not a change to this order.
- **Step 3, widened** - at apply time, backfill EVERY member or coordinator write that has no audit row, not only Acton's two. Faraz
  checked on 9/25: today that is only Acton's two 9/24 vacations (no other member `time_off` rows, offers, prefs or trades since
  launch), but anything entered before the apply is lost the same way, so the candidates are re-read at apply time. Same shape:
  actor + action as `logAudit` words it, `created_at` copied from the source row, `detail.backfilled = true`; a snapshot first; Faraz
  sees the rows before they are inserted.
- Step 2 (the client: `logAudit` sends `Prefer: return=minimal` through an option on `db.insert`) is a separate, later commit. This
  file alone fixes every installed build, because the database refused the read-back, not the write.

**Who reads what afterwards.**

- A linked surgeon: the rows with `actor_id` = his roster id - his own client's rows, the `trade.apply` / `schedule.claim` rows
  `apply_trade` / `claim_open_slot` write when he is the caller, and step 3's backfilled rows in his name. Any account linked to the
  same roster id reads the same rows.
- A coordinator: every row it wrote (`actor_id` = its profile id), not only the three families.
- A viewer / follower: none (it can write none).
- Scheduler / admin: every row, as before.
- Nobody reads a row somebody else wrote. The CLI rows (`scripts/day-edit.js`, `scripts/publish-preview.js`: `actor_id` null) and the
  `daily-reminder` function's `period.close` rows (`actor_id` `cron`) stay scheduler / admin only (probe cases `S6` / `C6` pin both).
- The read follows `actor_id`, not role - unlike `audit_read_coord`, which requires `silvis_is_coord()`. An office account demoted to
  viewer keeps reading the rows it wrote as coordinator (its profile id), and linking an account to a roster id (admin-only:
  `user_profiles_admin`; `user_profiles_self_update` pins `person_id`) hands it that id's audit history - for s1, the scheduler's own
  rows included (`users.link`, `roster.edit`, `data.reset`, `office_contact.*` details). The exposure is small (vacations and
  availability are anon-readable, offers authenticated-readable); the trust boundary is the admin's link.

**What could break.** Nothing that reads today. A surgeon's client never reads `audit_log` - `loadAudit` runs only for `isScheduler`
(Settings) and `isCoordinator` - so the only change a surgeon sees is that his writes stop failing, and the scheduler starts seeing
them in Settings > Activity log. A coordinator's Activity log ("your entries") may now also list its own rows outside the three
families (a `prefs.save` row, should one be written). The reads stay authenticated (`readAuthOnlyTable`; no anon policy on
`audit_log`), and `detail` carries names and dates, no contact data. The `daily-reminder` writes its rows with the service role and
`Prefer: return=minimal` - untouched. Blast radius, in one sentence: from the apply on, every signed-in user can read back the audit
rows he wrote himself - which is what lets his `logAudit` insert land - and nothing else; no write path, no other table and no other
reader changes.

**The probe (`sql/probes/audit-read-own-probe.sql`, rolls itself back; `scripts/verify-rls.sh` section 13 grades it).** Six throwaway
users `probe-auditown-<uuid>@example.test` - a surgeon linked to s3, a second surgeon linked to s2, two coordinators (no roster link),
an unlinked viewer and an admin linked to s1 - and eight fixture audit rows (s3, s2 and s1 `timeoff.add`; the coordinator's
`prefs.save`; the second coordinator's `timeoff.add` and `prefs.save`; a CLI row with `actor_id` null and a `daily-reminder` row with
`actor_id` `cron`). Every probe audit row carries `detail.probe = 'probe-auditown'` and every count is taken over those rows only.
`RETURNING *` is what PostgREST reads back for `return=representation`; `S2` / `C4` use PostgREST's return=representation shape
(the insert inside a CTE `pgrst_source`, `returning public.audit_log.*`, the body through `json_to_record`, the result through
`json_agg`) - RLS-equivalent (a column-reading RETURNING inside the `pgrst_source` CTE), not byte-identical: PostgREST 12's own
statement builds the body through `json_to_recordset(CASE json_typeof ...)` and selects more columns, and no REST call is made
(a REST insert would persist a row). The probe runs clean before the apply too; nine cases move:

| case | who / what | BEFORE (live 9/25) | AFTER |
|---|---|---|---|
| `P1` | postgres: the policies on `audit_log` | `policies=audit_insert,audit_read,audit_read_coord` | `policies=audit_insert,audit_read,audit_read_coord,audit_read_own` |
| `S1` | surgeon s3 inserts his `timeoff.add` row, `RETURNING *` - the case that would have caught the bug | `ERR 42501 new row violates row-level security policy for table "audit_log"` | `ok` |
| `S2` | surgeon s3, PostgREST's return=representation shape (RLS-equivalent) | `ERR 42501 ...` | `ok rows=1` |
| `S3` | surgeon s3, `RETURNING 1` (control) | `ok` | `ok` |
| `S4` | surgeon s3, no RETURNING (control; the prelaunch `L4`) | `ok` | `ok` |
| `S5` | surgeon s3 reads his own probe rows (the fixture, S1-S4) | `own=0` | `own=5` |
| `S6` | surgeon s3 reads the rows of s2, s1, the two coordinators, the CLI (`actor_id` null) and `cron` | `s2=0 s1=0 coord=0 cli=0 cron=0` | `s2=0 s1=0 coord=0 cli=0 cron=0` |
| `S7` | surgeon s3 inserts as s2, `RETURNING *` | `ERR 42501 ...` | `ERR 42501 ...` (`audit_insert`, unchanged) |
| `T1` | surgeon s2 reads his own row and s3's rows | `own=0 s3=0` | `own=1 s3=0` |
| `C1` | coordinator `timeoff.add` as itself, `RETURNING *` | `ok` | `ok` |
| `C2` | coordinator `prefs.save` as itself, `RETURNING *` | `ERR 42501 ...` | `ok` |
| `C3` | coordinator `prefs.save`, no RETURNING (control) | `ok` | `ok` |
| `C4` | coordinator `prefs.save`, PostgREST's return=representation shape (RLS-equivalent) | `ERR 42501 ...` | `ok rows=1` |
| `C5` | coordinator reads its own rows in / outside the three families | `own_family=1 own_other=0` | `own_family=1 own_other=4` |
| `C6` | coordinator reads the second coordinator's, the surgeons', the CLI's and `cron`'s rows | `coord2=0 surgeons=0 cli=0 cron=0` | `coord2=0 surgeons=0 cli=0 cron=0` |
| `C7` | coordinator inserts as s3, `RETURNING *` | `ERR 42501 ...` | `ERR 42501 ...` (`audit_insert`, unchanged) |
| `D1` | second coordinator reads its own family row, its own `prefs.save` row, the first coordinator's rows | `own_family=1 own_other=0 coord=0` | `own_family=1 own_other=1 coord=0` |
| `V1` | viewer `prefs.save` as itself, no RETURNING | `ERR 42501 ...` | `ERR 42501 ...` (decision 1c) |
| `V2` | viewer `prefs.save` as itself, `RETURNING *` | `ERR 42501 ...` | `ERR 42501 ...` |
| `V3` | viewer reads the probe rows | `visible=0` | `visible=0` |
| `A1` | admin s1, `RETURNING *` (control) | `ok` | `ok` |
| `A2` | admin reads every probe row (his count = the count as postgres) | `sees_all=t` | `sees_all=t` |
| `C21` | `sql/probes/coordinator-probe.sql` (section 11): the coordinator reads its own `probe.coord` row | `own_family=1 others=0 own_other=0` | `own_family=1 others=0 own_other=1` |

Leftover count 0 (`audit_log` rows with `detail ->> 'probe' = 'probe-auditown'`, auth.users `probe-auditown-%@example.test`). Section 13
grades the AFTER column, so before the apply it is red on exactly `P1 S1 S2 S5 T1 C2 C4 C5 D1` (it names them, and
`test/schema.test.js` runs the section against a faked CLI both ways); section 11's `C21` is red before the apply too.

**Apply order.**

1. **The 24-hour gate first - never apply this file ahead of it.** The gate (scheduled task `silvis-24h-gate`, Sat 9/26 15:30 CDT) runs
   `scripts/verify-rls.sh` from a detached worktree at `33e529d`, where `coordinator-probe.sql` case `C21` expects
   `own_family=1 others=0 own_other=0` (`own_other` = the coordinator's own `probe.coord` row, outside the three families: invisible
   today). With `audit_read_own` live it reads `own_other=1`, so an early apply turns the gate's verify-rls red and the gate applies
   nothing. The gate's first check also compares `scripts/verify-rls.sh` and `sql/probes/` with `33e529d`, so the commit carrying this
   file is not pushed before the gate has run. The gate runs -> its report -> Faraz approves -> steps 2-9. If the gate reports instead
   of applying, stop and tell Faraz.
2. **Rebase first.** `fix/activity-log-gap` is cut at `33e529d`, and the gate's record commit lands on `main` before this apply. Per
   the followers and return-leg files it flips revision o to applied, mirrors the return-leg follow-up as revision p (replacing the
   `PREPARED FOLLOW-UP, NOT MIRRORED` paragraph), makes section 5's `Q` / `Q3` REFUSED the default and drops
   `SILVIS_RETURN_LEG_APPLIED` from `scripts/verify-rls.sh`, and fills the followers section's *observed:* line and the guide 4.3
   followers bullet - all beside this change's own lines. Rebase this branch onto `origin/main`, resolve the conflicts (the
   `sql/schema.sql` header - revision q stays after p, and `test/schema.test.js` fails otherwise; the end of this file; guide 4.3;
   `scripts/verify-rls.sh`; the tail of `test/schema.test.js`), re-run `SILVIS_GEN_BUDGET_MS=40000 npm test && node build.js` (then
   `git checkout -- index.html version.json`) and `bash -n scripts/verify-rls.sh`, and report the resolutions with the gate results.
   Steps 3-9 run from the rebased branch. If the record commit has not landed yet, step 6 runs with `SILVIS_RETURN_LEG_APPLIED=1`
   whenever the return-leg file is live (section 5's `Q` / `Q3`).
   *As run (2026-09-27): that fallback. The gate was run by hand and its record commit had not landed when this step ran - the
   branch was rebased cleanly onto `7a23f09` (E2 + E3 since `33e529d`, no record commit yet), step 6 ran with
   `SILVIS_RETURN_LEG_APPLIED=1`, and the record commit (revision o applied, revision p, section 5's `Q` / `Q3` refused by
   default, the variable dropped) landed on `main` after this branch's push (`54dcdc0`). From that commit on verify-rls needs no
   variable for section 5.*
3. Probe BEFORE: `supabase db query --linked --workdir <dir> -f <abs>/sql/probes/audit-read-own-probe.sql` -> the BEFORE column.
   Dry run observed 2026-09-25 22:55 UTC (Faraz's go, rolled back): all 22 cases read exactly their BEFORE string (P1 the three
   policies; S1 / S2 / C2 / C4 / S7 / C7 / V1 / V2 ERR 42501; S5 `own=0`; T1 `own=0 s3=0`; C5 `own_family=1 own_other=0`; D1
   `own_family=1 own_other=0 coord=0`; the rest as listed). The leftover check for that run is Cowork's, in the SQL editor.
   Run it again at apply time: the live picture may have moved.
4. The migration, one session: `supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-25-audit-read-own.sql`.
5. Probe AFTER -> the AFTER column (`P1` ends in `audit_read_own`; `S1=ok`, `S2=ok rows=1`, `C2=ok`, `C4=ok rows=1`).
6. `SILVIS_WORKDIR=<dir> bash scripts/verify-rls.sh` from the rebased branch: section 13 green, section 11's `C21` `own_other=1`,
   every leftover count 0. Run it with whatever variables the rebased sections still call for (after the gate's record step section
   5 needs no `SILVIS_RETURN_LEG_APPLIED` - see step 2; `SILVIS_PREFS_ROWS_BEFORE` as the followers section says, if section 12
   still reads it). As run: with `SILVIS_RETURN_LEG_APPLIED=1` (step 2's note) - the variable no longer exists since the record commit.
7. Push (1d: after verify-rls). Nothing in the commit depends on the backfill.
8. **Step 3, the backfill**, in the same session (Faraz 9/25: every member or coordinator write that has no audit row).
   a) The ground truth is the API gateway log - the source of the 9/24 evidence: every `POST /rest/v1/audit_log` -> 403 from launch
   to the apply is one lost `logAudit` row, with its timestamp (and the caller, where the log records the JWT subject). Count them,
   as far back as the project's log retention reaches; if it does not reach launch, the report says so. **Retention is 24 hours on
   this plan (Faraz 9/25 evening), so the list is a chain of reads:** Cowork's reads cover launch -> 2026-09-25 22:27 UTC - the two
   9/24 403s (18:17:57Z, 18:19:23Z) are the only failed `audit_log` writes and both match Acton's `time_off` rows (both have aged
   out of the log since); Cowork reads again on 2026-09-26 at 17:00 CDT; at apply time the orchestrator reads the last 24 hours
   (or asks for a Cowork read). Together those reads are the list. If more than 24 hours separate two consecutive reads, the
   report says so: that window's 403s cannot be known, and the DB reconciliation in (b) / (c) is the only backstop there.
   **The list so far** (Faraz / Cowork; each read's window, then its 403s and what they become):

   | read | window (UTC) | 403s | step 3 |
   |---|---|---|---|
   | Cowork read 1, 2026-09-25 ~12:30Z | 2026-09-24 ~12:30 -> 2026-09-25 ~12:30 (launch -> 9/24 ~12:30: only the scheduler had signed in; the first other sign-in was 2026-09-24 15:02Z) | 2026-09-24 18:17:57, 18:19:23 | Acton's two `timeoff.add`: both match his `time_off` rows -> backfill |
   | Cowork read 2, 2026-09-25 22:27Z | 2026-09-24 22:27 -> 2026-09-25 22:27 | none | - |
   | Cowork read 3, 2026-09-26 22:00Z (17:00 CDT) | 2026-09-25 22:00 -> 2026-09-26 22:00 | 2026-09-25 23:06:06, 23:06:18; 2026-09-26 00:16:35 | Fierce's notification-prefs saves (`prefs.save`, actor `s5`). 23:06:18 matches his `notification_preferences` row (updated 2026-09-25 23:06:18Z) -> backfill one `prefs.save` row, `created_at` 23:06:18Z; 23:06:06 and 00:16:35 are probable `prefs.save` writes, not independently recoverable (the prefs row keeps only its last update) -> listed for Faraz, not backfilled. *As reconciled 2026-09-27: 00:16:35 was not a `prefs.save` - the row still read `updated_at` 23:06:18Z and every prefs save writes `updated_at`; its action is unknown, still listed, not backfilled* *- identified the same night by the seed apply's pre-flight: `call_periods` 'Jan 2027' `updated_at` 2026-09-26 00:16:35.73471Z, Fierce's 'Go by my rules' choice (`set_offer_mode`, then `logAudit('offers.save', ...)` refused) -> backfilled as the fourth row (`b3323705-8b8e-4f63-8c37-aef3d219bd36`, `created_at` 00:16:35.73471Z, snapshot `b2d001e6-b00a-4792-a4ec-bc39fa1c7e8f`)* |
   | apply time: Cowork read 4, 2026-09-27 ~13:15Z (the closing read) | 2026-09-26 ~13:15 -> 2026-09-27 ~13:15 | none | no failed `POST /rest/v1/audit_log`. 2026-09-26 22:00Z -> the apply (2026-09-27 00:49:39Z): no `audit_log` POST at all (only two heartbeats and verify-rls's anon checks); the one `audit_log` POST in the 24 h is a 201 at 2026-09-27 05:23:40Z, after `audit_read_own`. It starts ~8 h 45 min before read 3's end and well inside step 8a's no-gap deadline (a read by 2026-09-27 22:00Z), so there is no gap: coverage launch -> apply is complete across reads 1-4. The DB reconciliation (b) found no candidate in that window either. Nothing to backfill; the list stands (four rows backfilled, 2026-09-25 23:06:06Z not recoverable) |

   A `prefs.save` backfill row reads as `logAudit` words it (`saveNotifPref`): action `prefs.save`, summary
   `Saved notification prefs for <roster name>`, `detail.person_id` = the surgeon's roster id, plus `backfilled: true`.
   b) Re-read the source rows, read-only - every `time_off` row written by a surgeon or a coordinator with no `timeoff.add` row by the
   same writer, for the same person, written right after it (matched on `person_id` and `created_at` proximity, never on the dates:
   `time_off` has no `updated_at`, and a vacation edited after it was added carries its new dates):

          select t.id, t.person_id, t.start_date, t.end_date, t.note, t.created_by, t.created_at
            from public.time_off t
           where t.created_by in (select coalesce(p.person_id, p.id::text) from public.user_profiles p where p.role in ('surgeon', 'coordinator'))
             and not exists (select 1 from public.audit_log a
                              where a.action = 'timeoff.add' and a.actor_id = t.created_by
                                and a.detail ->> 'person_id' = t.person_id
                                and a.created_at between t.created_at - interval '1 minute' and t.created_at + interval '2 minutes')
           order by t.created_at;

   and the same check for every other family a member or the office writes through `logAudit`: `call_offers` rows `entered_by` a
   member or a coordinator (`offers.save`), `shift_trade_requests` rows from a member (`trade.propose`, and their `trade.accept` /
   `trade.decline` / `trade.cancel`), `notification_preferences` rows saved since launch (`prefs.save`), `availability` rows
   `created_by` a coordinator (`availability.add`). On 9/25 the only candidates were Acton's two 9/24 vacations.
   c) Reconcile: the candidates from (b) against the 403s from (a), one to one by time and caller. A 403 no source row explains - a
   `timeoff.edit` or `timeoff.remove` (the row changed or is gone), a `trade.decline` / `trade.cancel` whose row moved on, a repeated
   `prefs.save`, a refused `schedule.claim`, an `eastvac.review`, a `timeoff.paint` - cannot be rebuilt from the tables (the gateway
   log carries no body): it is listed for Faraz as not recoverable, never silently skipped. A `timeoff.add` candidate whose row may
   have been edited since (an extra 403 from the same caller after it) is flagged: its backfill would carry the current dates.
   d) Take a `call_schedule_snapshots` row first (a failed capture blocks the insert).
   e) Build one row per write the way `logAudit` words it: `actor_id` = the writer's roster id (else his profile id); `actor_name` =
   his `display_name`, else his roster name, else `Unknown`; `action` as the client names it; `detail` = `{ summary, ...the client's
   keys }` - for a vacation `summary` = `Added vacation for <roster name>: <start>` plus ` -> <end>` when the range is longer than a
   day, keys `person_id`, `start`, `end`, `note` (null when empty) - plus `backfilled: true`; `created_at` copied from the source row.
   f) Show Faraz the rows (and the 403s listed as not recoverable) before inserting; then insert them in one guarded block (the
   expected count must match, else raise and persist nothing). Undo: `delete from public.audit_log where detail ->> 'backfilled' =
   'true' and id in (<the ids the insert returned>);`.
9. The record step, ONE commit: this status line -> `**Status: APPLIED <timestamp>.**` with the observed line (both probe sentinels,
   the verify-rls section 11 / 13 lines, the leftover counts, the 403 reconciliation, the backfilled rows and their snapshot);
   `sql/schema.sql` revision q `report-first, NOT yet applied` -> `applied <timestamp>` (and the same words in its `audit_log`
   comment block); tables (a) / (b)'s `audit_log` rows and the guide 4.3 bullet drop "prepared" (`report-first, applied
   2026-MM-DD` and its `applied:` line). The `test/schema.test.js` pins accept both wordings. Then Prompt 21 step 2 (the client's
   `Prefer: return=minimal`) and step 4 (the other `return=representation` writers whose writer cannot read the row back - a report)
   follow as their own commits.

Rolling back = `drop policy if exists audit_read_own on public.audit_log;` - it reopens the gap for every build that still sends
`return=representation` (every build before Prompt 21 step 2). The backfilled rows stay (they are the record) unless Faraz asks for
apply step 8's undo.

observed: applied 2026-09-27 00:49:39.789384Z (`supabase db query --linked -f sql/migrations/2026-09-25-audit-read-own.sql`, empty result, no error) by the orchestrator through the linked CLI, in the session that ran the 24-hour gate by hand - the gate PASSED first (return leg and followers applied, verify-rls 192 / 0, `send-notification` v8 / `daily-reminder` v6 deployed; the two sections above). Step 2: the branch rebased cleanly onto `7a23f09` (the record commit had not landed - step 2's note), `SILVIS_GEN_BUDGET_MS=40000 npm test && node build.js` and `bash -n scripts/verify-rls.sh` green. Probe BEFORE (22 cases) = the BEFORE column, 22 / 22: `P1=policies=audit_insert,audit_read,audit_read_coord`, `S1` / `S2` / `C2` / `C4` / `S7` / `C7` / `V1` / `V2` = `ERR 42501 new row violates row-level security policy for table "audit_log"`, `S5=own=0`, `T1=own=0 s3=0`, `C5=own_family=1 own_other=0`, `D1=own_family=1 own_other=0 coord=0`, `S3` / `S4` / `C1` / `C3` / `A1` = `ok`, `S6=s2=0 s1=0 coord=0 cli=0 cron=0`, `C6=coord2=0 surgeons=0 cli=0 cron=0`, `V3=visible=0`, `A2=sees_all=t`. Probe AFTER = the AFTER column, 22 / 22: `P1=policies=audit_insert,audit_read,audit_read_coord,audit_read_own`, `S1=ok`, `S2=ok rows=1`, `C2=ok`, `C4=ok rows=1`, `S5=own=5`, `T1=own=1 s3=0`, `C5=own_family=1 own_other=4`, `D1=own_family=1 own_other=1 coord=0`; the refusals (`S7` / `C7` / `V1` / `V2` ERR 42501), the zero counts (`S6`, `C6`, `V3=visible=0`) and the controls (`S3`, `S4`, `C1`, `C3`, `A1`, `A2`) unchanged. `SILVIS_RETURN_LEG_APPLIED=1 bash scripts/verify-rls.sh` from the rebased branch: `RESULT: 214 passed, 0 failed` - section 13 every case PASS (22 + the leftover check), section 11 `C21=own_family=1 others=0 own_other=1` PASS, section 5 `Q` / `Q3` refused; every leftover count 0 (sections 5, 7, 8, 9, 10, 11, 12, 13). Pushed `7a23f09..54dcdc0` (CI build `6886edc`). Step 3, the backfill: the reconciliation (step 8 b, read-only over `time_off`, `call_offers`, `shift_trade_requests` proposals and decisions, `notification_preferences` and coordinator `availability` since 2026-09-23) found 5 candidates. 2 false positives: Acton's two `trade.propose` rows of 2026-09-24 17:26Z (trades `61c575f8` / `6fec84bc`, 10/10 and 10/11 primary to Burchett) - Khan (s1) proposed and accepted them on Acton's behalf and all six audit rows exist under actor s1; the query matched the proposer on `from_surgeon_id`. 3 backfilled, in one guarded block (source rows re-checked, expected count 3, else raise and persist nothing) after snapshot `4a70d7d6-831a-40c4-96f0-ae72832d19fb` (`call_schedule_snapshots`, reason `audit_backfill`): audit row `ce86ffed-b3b9-4e5f-91d2-576764096ca7` (Acton `timeoff.add`, `Added vacation for Acton: 2027-03-15 -> 2027-03-21`, created_at 2026-09-24 18:17:57.797172Z), audit row `a9f2ab89-0447-43ca-8cbf-d62b77314c37` (Acton `timeoff.add`, `Added vacation for Acton: 2027-04-05 -> 2027-04-11`, 18:19:23.671158Z), audit row `6418111a-e1ae-4d23-bb62-b7fb7e782b3c` (Fierce `prefs.save`, `Saved notification prefs for Fierce`, created_at 2026-09-25 23:06:18.229Z) - actor and summary as `logAudit` words them, `actor_name` the roster name (`Acton` / `Fierce`; `user_profiles.display_name`, which `logAudit` prefers, was not read), `detail.backfilled = true`. Not recoverable, listed for Faraz: Fierce's 403 at 2026-09-25 23:06:06Z (a probable `prefs.save`, overwritten 12 s later by the 23:06:18Z save the row keeps) and his 403 at 2026-09-26 00:16:35Z (no source row explains it: the prefs row still read `updated_at` 2026-09-25 23:06:18.229Z at the reconciliation and every prefs save writes `updated_at`, so it was not a `prefs.save` - action unknown). *Later the same night (the seed apply's pre-flight): the 00:16:35Z 403 is Fierce's mode-only offers save - `call_periods` 'Jan 2027' `rules_only_ids` ["s5"], `updated_at` 2026-09-26 00:16:35.73471Z (the reconciliation covered `call_offers` rows, not a mode-only `set_offer_mode`) - backfilled as a fourth row: `b3323705-8b8e-4f63-8c37-aef3d219bd36` (s5 / Fierce, `offers.save`, summary `Fierce: 0 offer change(s), mode rules_only (Jan 2027)`, detail as `commitOffersPaint` words it plus `backfilled: true`), snapshot `b2d001e6-b00a-4792-a4ec-bc39fa1c7e8f` first. Only 23:06:06Z stays unrecoverable.* 403 coverage, complete: Cowork's four reads (step 8a's table, one row each) cover launch -> 2026-09-27 ~13:15Z with no gap - read 1 (2026-09-25 ~12:30Z; before 9/24 ~12:30Z only the scheduler had signed in), read 2 (2026-09-25 22:27Z, none), read 3 (2026-09-26 22:00Z, Fierce's three) and the closing read 4 (2026-09-27 ~13:15Z, window 2026-09-26 ~13:15Z -> 2026-09-27 ~13:15Z, well inside step 8a's no-gap deadline of 2026-09-27 22:00Z): no failed `audit_log` POST, and no `audit_log` POST at all between 2026-09-26 22:00Z and the apply. The list stands: four rows backfilled, 2026-09-25 23:06:06Z not recoverable; the DB reconciliation agreed (no candidate in that window). Undo of the backfill: `delete from public.audit_log where detail ->> 'backfilled' = 'true' and id in ('ce86ffed-b3b9-4e5f-91d2-576764096ca7', 'a9f2ab89-0447-43ca-8cbf-d62b77314c37', '6418111a-e1ae-4d23-bb62-b7fb7e782b3c', 'b3323705-8b8e-4f63-8c37-aef3d219bd36');`.

## 2026-09-27 - call pay: call_pay_settings + call_pay_logs (Faraz 9/27; `sql/migrations/2026-09-27-call-pay.sql`)

**Status: APPLIED 2026-09-28 01:15:26Z.**

Faraz 9/27 reverses the 9/21 rule "no compensation logic and no $ display anywhere in this app": the app tracks **primary**
call pay (backup is never paid). The pay model, per primary 24-h call day (07:00 -> 07:00): a shift stipend; a call-in rate
when the primary is called in that day (the weekday rate on a weekday, the weekend/holiday rate on a weekend or holiday day);
and an activation rate for the hours worked (on a weekday the after-hours hours the surgeon enters, on a weekend / holiday
all hours) - or, by a flag, per call-in. wRVUs are out of scope for now (no column; room is left). The rates are entered by
the scheduler in the app and live ONLY in `call_pay_settings`; **no figure is in the repo, the seed, the blob or any
anon-readable table** (`test/privacy.test.js` A6d pins it; `test/schema.test.js` pins that the rate columns carry no default
and the SQL no numeric literal beyond its check bounds).

**Folded in before the apply (Faraz's 9/27 decisions on the build report, item 5):** (5a) the office **coordinator reads
call pay, read-only** - SELECT on both tables, no insert / update / delete (the write policies do not admit it and the guard
refuses its insert, `PY004 PAY_READ_ONLY`); in the app it sees Totals > Pay (per surgeon, month + YTD) and its CSV, no My pay,
no log form, no Setup > Pay rates - "the office prepares the stipends". (5b) a per-surgeon **"Paid by the call stipend"
switch** in Setup > Pay rates, default ON for everyone, stored as data in `call_pay_settings.stipend_off_ids` (switched off =
listed; the migration names no roster id - Faraz sets the switches himself). A surgeon switched off gets no My pay, is left out
of Totals > Pay and its CSV, and **cannot read the rates - enforced in RLS**: his settings read and his own call-in policies
require `silvis_pay_enabled(<his roster id>)`; the guard refuses a new or edited call-in of a switched-off person for every
caller (`PY005 PAY_STIPEND_OFF`); the scheduler and the coordinator still read his earlier call-ins. Saving the switches writes
the existing `pay.rates` audit row (the changed keys plus the roster ids switched off / on - never an amount).

| object | before | after |
|---|---|---|
| `call_pay_settings` | - | new table, one row `main` (check `id = 'main'`): four `numeric(10,2)` rates, each null or 0-99999, **no default**; `activation_unit` `hour` \| `activation` (default `hour`); `weekend_days` jsonb array of `Sun`..`Sat` (default `["Sat","Sun"]` - Friday is a weekday for pay); `holiday_unit_days_are_holidays`, `callin_required_weekday`, `callin_required_weekend_holiday` (default true); `stipend_off_ids` jsonb array of non-empty strings (roster ids NOT paid by the call stipend; default `[]` - everyone paid); `updated_by` / `updated_at` stamped by `call_pay_settings_touch`. Seeded `(id)` only - every rate null, nobody switched off |
| `silvis_pay_enabled(pid text)` | - | new helper: `language sql stable security definer set search_path = public, pg_temp`; true when `pid` is not null and not in `stipend_off_ids` - **answered truly only to a caller entitled to know** (9/27 review: it is callable as `/rest/v1/rpc/silvis_pay_enabled` by every signed-in account): the scheduler / admin, the coordinator, the person `pid` himself, or a session with no signed-in user (`auth.uid()` null - service_role, the SQL editor, the linked CLI); a viewer, a follower or a colleague gets an uninformative `true` whoever is switched off (every policy passes the caller's own id, and a write for another person is refused by the write policies anyway). Reads the settings row as its owner, so the settings read policy that calls it does not recurse and the guard sees the list whoever the caller is. EXECUTE revoked from public / anon, granted to authenticated / service_role (as `offer_status`) |
| `call_pay_logs` | - | new table: `id`, `day`, `person_id` (roster id), `hours numeric(5,2)` 0-24 in quarter hours, `note` (<= 200 characters, no `@`, no phone-like digit run), `created_by`, `created_at`, `updated_at`; index `(person_id, day)`, not unique (one row per call-in) |
| `call_pay_logs_guard` (BEFORE INSERT OR UPDATE, security invoker, `set search_path = public`, every caller) | - | `PY004 PAY_READ_ONLY` the caller is the office coordinator; `PY005 PAY_STIPEND_OFF` the person is switched off the stipend (a new or edited row, for everyone); `PY001 PAY_FUTURE` day after today (Central); `PY002 PAY_NOT_PRIMARY` the person is not `schedule_days.primary_id` that day; `PY003 PAY_HOURS_OVER` the person's hours that day would exceed 24 - summed under a transaction advisory lock on (person, day), so two concurrent call-ins cannot both pass; stamps `created_by` / `created_at` on insert, pins them on update. No delete guard: a surgeon removes his own row after the day's primary changed |
| grants | Supabase default (anon + authenticated all verbs on a new table, TRUNCATE / REFERENCES / TRIGGER included) | `revoke all ... from anon` on both tables (defence in depth for pay data - the other authenticated-only tables rely on RLS alone); `revoke truncate, references, trigger ... from authenticated` (RLS does not cover TRUNCATE); authenticated keeps select / insert / update / delete |

The six policies, verbatim (neither table is in the anon `read_all` loop):

    create policy call_pay_settings_read on public.call_pay_settings for select to authenticated
      using (public.silvis_is_sched() or public.silvis_is_coord() or (public.silvis_role() = 'surgeon' and public.silvis_pay_enabled(public.silvis_person_id())));

    create policy call_pay_settings_write on public.call_pay_settings for all to authenticated
      using (public.silvis_is_sched()) with check (public.silvis_is_sched());

    create policy call_pay_logs_read on public.call_pay_logs for select to authenticated
      using (public.silvis_is_sched() or public.silvis_is_coord() or (public.silvis_role() = 'surgeon' and person_id = public.silvis_person_id() and public.silvis_pay_enabled(person_id)));

    create policy call_pay_logs_insert on public.call_pay_logs for insert to authenticated
      with check (public.silvis_is_sched() or (public.silvis_role() = 'surgeon' and person_id = public.silvis_person_id() and public.silvis_pay_enabled(person_id)));

    create policy call_pay_logs_update on public.call_pay_logs for update to authenticated
      using (public.silvis_is_sched() or (public.silvis_role() = 'surgeon' and person_id = public.silvis_person_id() and public.silvis_pay_enabled(person_id)))
      with check (public.silvis_is_sched() or (public.silvis_role() = 'surgeon' and person_id = public.silvis_person_id() and public.silvis_pay_enabled(person_id)));

    create policy call_pay_logs_delete on public.call_pay_logs for delete to authenticated
      using (public.silvis_is_sched() or (public.silvis_role() = 'surgeon' and person_id = public.silvis_person_id() and public.silvis_pay_enabled(person_id)));

Who sees what: a linked **surgeon** paid by the call stipend reads the settings row (the rates his own pay is computed with)
and reads / writes only his own call-ins; a surgeon **switched off** the stipend reads no rate and none of his call-ins and
writes none (the client renders no My pay card for him); the **scheduler / admin** reads and writes everything (Faraz is
admin + s1); the office **coordinator** (never linked) reads the settings row and every call-in and writes nothing - the client
shows it Totals > Pay and its CSV only; a **viewer**, a **follower** and **anon** read and write nothing - and the client
renders no pay UI and no $ for them, nor on the public page. Audit rows the client writes for pay (`pay.rates`, `pay.log.add` / `.edit` / `.delete`) carry changed KEYS,
days and hours - never an amount - since `audit_log` is readable by the scheduler and the row's author.

**Decisions for Faraz to approve with the apply (RLS scope differs from the 9/27 task text in two places - both narrower or
equal, never wider):**

1. **Orphan rows stay readable and deletable by their owner.** The task text says a surgeon may select / insert / update /
   delete his rows "only for days on which he was PRIMARY". As built, insert and update check the primary (PY002, in the
   guard), but select and delete check the owner only (`person_id = silvis_person_id()`). A call-in left behind when a trade,
   give or restore moved the day's primary is therefore still visible to its owner (listed as "not counted") and he can delete
   it; he cannot edit it (PY002). Checking the primary on select / delete too would hide such rows and make them undeletable
   except by the scheduler.
2. **The guard binds the scheduler too.** The task text says "the scheduler can do all". RLS lets the scheduler read and write
   every row, but `call_pay_logs_guard` applies to every caller: the scheduler cannot log a future day (PY001), a day the person
   was not primary (PY002) or more than 24 h per day (PY003) either - for anyone. Deletes stay open to the scheduler.
3. **Anon is refused outright** (privileges revoked on top of RLS), unlike the other authenticated-only tables; verify-rls
   section 14 with `SILVIS_CALL_PAY_APPLIED=1` (and after the record step, always) fails an anon 200 even with `*/0`.
4. **(5b) A switched-on surgeon reads the switch list.** `stipend_off_ids` sits in the settings row a paid surgeon reads (the
   rates his pay is computed with), so he can see which colleagues are switched off - roster ids only, never an amount. A
   separate table would hide it; say so if that matters. A switched-off surgeon reads nothing (0 rows).
5. **(5b) The scheduler may still delete a switched-off surgeon's call-in** (deletes are unguarded); the switched-off surgeon
   himself cannot (RLS). Switching him back on makes his earlier call-ins his again (read / edit / delete).
6. **(9/27 review) Who may ask the switch helper.** `silvis_pay_enabled` is a security-definer function in `public`, so PostgREST
   exposes it over RPC to every signed-in account. It answers truly only to the scheduler / admin, the coordinator, the person
   himself or a no-user session; anyone else (a viewer, a follower, a surgeon asking about a colleague) gets `true` - no one
   outside the pay roles learns who is switched off (probe `O11` / `O12`). A switched-on surgeon still reads the list in the
   settings row (decision 4).

**Blast radius.** Two new tables and one new helper function (`silvis_pay_enabled`); no existing table, column, policy,
function, grant or row changes. The client that ships with
this file reads a missing table (PostgREST 404 `PGRST205`, or `42P01` / 400 "does not exist" on older versions) as
**unavailable** - My schedule > My pay, Totals > Pay and Setup > Pay rates say "Pay tracking is available after the next
database update", no toast, never an empty list - so the client may ship first. The only live side effect of the apply is
PostgREST's schema cache: if the tables do not show after the apply, run `notify pgrst, 'reload schema';`. What users see after
the apply: the scheduler every pay surface; each switched-on surgeon his My pay; the office coordinator Totals > Pay and its CSV
(read-only - a figure shows once the rates are entered); nobody is switched off until Faraz sets the switches.

**What could break.** (1) The probe and verify-rls section 14 are written against an AFTER picture nobody has observed: the first
live run may show a different refusal wording (e.g. anon 401 vs 403 after the revoke, or the exact 42501 text) - section 14
accepts 401 / 403 / 42501, and `*/0` only without `SILVIS_CALL_PAY_APPLIED=1` (strict: an anon 200 is a FAIL - it would mean
the revoke did not take). *(As run 2026-09-28: the AFTER picture was observed - anon 401 `42501` on both tables, the probe's 52
cases as listed; the record step dropped `SILVIS_CALL_PAY_APPLIED`, so section 14 now always FAILs an anon 200, `*/0` included,
a 404 and PROBE_SETUP.)* (2) Pay follows the CURRENT schedule: a trade, give, claim or restore that moves a past day's
primary turns that day's call-ins into orphans (not counted; the owner can delete them, not edit them - PY002). `call_pay_logs` is
not in `call_schedule_snapshots`, so a snapshot restore neither restores nor rolls back call-ins. (3) A later `create table`
could re-grant anon through Supabase's default privileges; harmless - the policies still block anon.

**Apply order.**

1. The client may ship first (it shows "unavailable" until step 4).
2. Pre-check: `select to_regclass('public.call_pay_logs');` -> null.
3. Probe BEFORE: `supabase db query --linked --workdir <dir> -f <abs>/sql/probes/call-pay-probe.sql` -> `PROBE_SETUP: call_pay_logs is absent ...`.
4. The migration, one session: `supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-27-call-pay.sql`.
5. Probe AFTER: every case as its header lists (52 cases; `P1` names the six policies, `P2` `anon_logs=f anon_settings=f auth_truncate=f`,
   `P4` `anon_exec=f auth_exec=t definer=t`; the coordinator `C1`-`C7` read every row and write none - no call-in, no rate, no
   switch; `O1`-`O10` switch s3 off inside the probe's own transaction: no rate, no own row, `PY005` for him and for the admin,
   s2 unchanged, the admin and the coordinator still read his rows; `O11` the helper tells a viewer and a colleague `true`,
   `O12` gives the admin, the coordinator, s3 himself and a no-user session the real `false`). Run locally on 9/27 against a
   Postgres 16 with Supabase-like stubs (auth schema, roles), over a fresh database and over one holding a pre-5b
   `call_pay_settings`: every case read as listed.
6. `SILVIS_CALL_PAY_APPLIED=1 bash scripts/verify-rls.sh` - sections 1-14 green (the flag makes a 404 / PROBE_SETUP a FAIL; 14d
   also reads `stipend_off_ids` before and after the probe and fails if it changed).
7. Faraz enters the rates and sets the "Paid by the call stipend" switches in Setup > Pay rates (the app writes the `pay.rates`
   audit row with the changed keys and the roster ids switched off / on only).
8. The record step, ONE commit: this status -> APPLIED <timestamp> with the observed line; schema.sql revision r -> "applied
   <timestamp>" (and the test pin with it); `SILVIS_CALL_PAY_APPLIED` dropped from verify-rls (strict becomes the default); guide
   4.3's bullet updated.

**Rolling back** = `drop table if exists public.call_pay_logs; drop table if exists public.call_pay_settings; drop function if exists
public.silvis_pay_enabled(text); drop function if exists public.call_pay_logs_guard(); drop function if exists
public.call_pay_settings_touch();` (the triggers and policies go with the tables, the helper after them; the client falls back to
"unavailable").

observed: applied 2026-09-28 01:15:26Z (`supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-27-call-pay.sql`, one implicit transaction, empty result, no error; the `main` row's `updated_at` 2026-09-28 01:15:26.066955Z) by the orchestrator in a local session on Faraz's go (9/27: the decisions above accepted as recorded, decision 4 included). Pre-check 01:15:10Z: `to_regclass('public.call_pay_logs')`, `to_regclass('public.call_pay_settings')` and `to_regprocedure('public.silvis_pay_enabled(text)')` all null. Probe BEFORE: `PROBE_SETUP: call_pay_logs is absent - sql/migrations/2026-09-27-call-pay.sql is not applied` (nothing else ran). After the apply: one settings row `main` with every rate null and `stipend_off_ids` `[]`, 0 call-ins; PostgREST saw both tables at once (anon GET `call_pay_logs` / `call_pay_settings` -> HTTP 401 `42501 permission denied`, not 404 `PGRST205`), so no `notify pgrst, 'reload schema'` was needed. Probe AFTER: all 52 cases exactly as the header lists - `P1=policies=call_pay_logs_delete,call_pay_logs_insert,call_pay_logs_read,call_pay_logs_update,call_pay_settings_read,call_pay_settings_write`, `P2=anon_logs=f anon_settings=f auth_truncate=f`, `P3=rows=1`, `P4=anon_exec=f auth_exec=t definer=t`, N1-N3 `42501`, S1-S17 / X1-X2 / T1 as listed (S4 `PY001 PAY_FUTURE`, S7 / S9 `PY003`, S5 / S8 the check constraints), the coordinator `C1=sees_all=t` `C2=rows=1` `C3=ERR PY004 PAY_READ_ONLY` `C4=updated=0` `C5=deleted=0` `C6=updated=0` `C7=ERR 42501 new row violates row-level security policy for table "call_pay_settings"`, V1-V2 nothing, A1-A4 as listed, `O1=rows=0` ... `O10=sees_s3=t`, `O11=viewer=t colleague=t`, `O12=admin=f coord=f self=f nojwt=f`. `SILVIS_CALL_PAY_APPLIED=1 bash scripts/verify-rls.sh` first read `RESULT: 270 passed, 1 failed` - the one FAIL was 14d's "CHANGED the stipend switches", a false alarm: the script compared the CLI's whole JSON before and after the probe, and CLI 2.84 stamps a random `boundary` into every result, so the two never matched (the live `stipend_off_ids` read `[]` before and after, `updated_at` unchanged). 14d now compares the extracted `off_ids` value only (and `test/schema.test.js`'s faked CLI carries a random boundary and escaped JSON); the strict re-run read `RESULT: 271 passed, 0 failed` (sections 1-14 green; section 14: the anon reads / POST refused 401, every probe case, leftovers 0, switches unchanged `[]`; the JWT-gated checks - 3, 6, 7c-7e, 8c / 8d, 9d, 14c - skipped, no JWT set). The record step: this status and table (a) / (b) rows; `sql/schema.sql` revision r `applied 2026-09-28 01:15:26Z` (and its block comments); the migration's marker line -> APPLIED; `SILVIS_CALL_PAY_APPLIED` dropped from `scripts/verify-rls.sh` (strict is the default: a 404, an anon 200 or PROBE_SETUP FAILs); guide 4.3's bullet; the test pins with them. After the record step, `bash scripts/verify-rls.sh` with no flags: `RESULT: 271 passed, 0 failed` (2026-09-28 01:56Z). No rate and no switch entered - Faraz enters them in Setup > Pay rates (step 7).

## 2026-09-30 - data change: fold January into Jan 2027 - Jun 2027 (Faraz 9/30; TASK 2 of Cowork's 9/30 queue)

**Status: APPLIED 2026-10-01 04:33:12Z** (Faraz, in the Supabase SQL editor - the observed line below). Faraz 9/30: "go from January to June. We will do 6 months." The apply was first attempted by
the orchestrator on 10/1 (Faraz's standing go for the queue) and **refused by the session's permission classifier**; it was
not retried by any other route. Faraz (or a session he permits) runs the file below - one batch, one implicit transaction.
No schema, RLS, policy, schedule row, lock or offer changes; `call_periods` has no foreign key and no trigger pointing at it.

Before (live, read 10/1; snapshot `silvis-gate/run-2026-10-01/call_periods-before.json`, all three rows):

| id | label | days | offers close | publish by | status | rules_only_ids | offer_modes |
|---|---|---|---|---|---|---|---|
| 94f18b04-... | Nov 2026 - Jan 2027 | 2026-11-02 .. 2027-01-03 | 2026-10-02 | 2026-10-05 | published | s1, s6 | s2 exhaustive, s3 preferred, s4 exhaustive, s5 preferred |
| 993950f2-... | Jan 2027 | 2027-01-04 .. 2027-01-31 | 2026-11-23 | 2026-12-07 | upcoming | s5 | {} |
| fb0770b4-... | Feb 2027 - Apr 2027 | 2027-02-01 .. 2027-05-02 | 2026-12-21 | 2027-01-04 | upcoming | [] | {} |

After (the file's dry run on the live database, rolled back - live unchanged afterwards): the Nov - Jan row unchanged;
**Jan 2027 - Jun 2027** 2027-01-04 .. 2027-06-30, offers close 2026-11-23, publish by 2026-12-07, upcoming, rules_only_ids
["s5"], offer_modes {}; the Feb - Apr row gone; 2 audit rows. Nothing to merge (the Feb - Apr row carried no rules-only list
and no modes); offers are keyed by person and day - none sits in 2027-01-04 .. 2027-06-30 today, so none moves.
Fierce's "go by my rules" choice for January (rules_only s5, set 9/26) now covers January - June.

The file (`silvis-gate/run-2026-10-01/fold-jan-jun.sql`; apply with
`supabase db query --linked --workdir <dir> -f <abs>/fold-jan-jun.sql`). Its pre-checks refuse a second run:

```sql
do $$
declare
  jan public.call_periods; feb public.call_periods; merged_ids jsonb; merged_modes jsonb; n int;
begin
  select * into jan from public.call_periods where label = 'Jan 2027' and start_day = date '2027-01-04' for update;
  select * into feb from public.call_periods where label = 'Feb 2027 - Apr 2027' and start_day = date '2027-02-01' for update;
  if jan.id is null then raise exception 'FOLD_PRECHECK: the Jan 2027 row is missing'; end if;
  if feb.id is null then raise exception 'FOLD_PRECHECK: the Feb 2027 - Apr 2027 row is missing (already folded?)'; end if;
  if jan.label <> 'Jan 2027' or jan.start_day <> date '2027-01-04' or jan.end_day <> date '2027-01-31'
     or jan.offers_close_at <> date '2026-11-23' or jan.publish_by <> date '2026-12-07' or jan.status <> 'upcoming' then
    raise exception 'FOLD_PRECHECK: the Jan row is not as read on 10/1: %', row_to_json(jan);
  end if;
  if feb.label <> 'Feb 2027 - Apr 2027' or feb.start_day <> date '2027-02-01' or feb.end_day <> date '2027-05-02' or feb.status <> 'upcoming' then
    raise exception 'FOLD_PRECHECK: the Feb - Apr row is not as read on 10/1: %', row_to_json(feb);
  end if;
  select count(*) into n from public.call_periods where id not in (jan.id, feb.id) and status = 'upcoming'
    and start_day <= date '2027-06-30' and end_day >= date '2027-01-04';
  if n > 0 then raise exception 'FOLD_PRECHECK: % other upcoming period(s) overlap 2027-01-04 .. 2027-06-30', n; end if;
  select coalesce(jsonb_agg(x order by x), '[]'::jsonb) into merged_ids
    from (select distinct jsonb_array_elements_text(jan.rules_only_ids || feb.rules_only_ids) as x) s;
  merged_modes := feb.offer_modes || jan.offer_modes;
  update public.call_periods set end_day = date '2027-06-30', label = 'Jan 2027 - Jun 2027', rules_only_ids = merged_ids,
    offer_modes = merged_modes, updated_at = now() where id = jan.id;
  get diagnostics n = row_count; if n <> 1 then raise exception 'FOLD: the Jan update touched % row(s)', n; end if;
  delete from public.call_periods where id = feb.id;
  get diagnostics n = row_count; if n <> 1 then raise exception 'FOLD: the Feb - Apr delete touched % row(s)', n; end if;
  insert into public.audit_log (actor_id, actor_name, action, detail) values
    ('s1', 'Khan', 'period.update', jsonb_build_object('period_id', jan.id, 'label', 'Jan 2027 - Jun 2027', 'previous_label', jan.label,
      'start_day', jan.start_day, 'end_day', date '2027-06-30', 'previous_end_day', jan.end_day, 'offers_close_at', jan.offers_close_at,
      'publish_by', jan.publish_by, 'rules_only_ids', merged_ids, 'previous_rules_only_ids', jan.rules_only_ids, 'offer_modes', merged_modes,
      'previous_offer_modes', jan.offer_modes, 'summary', 'Period Jan 2027 -> Jan 2027 - Jun 2027: end moved 2027-01-31 -> 2027-06-30 (one 6-month period, Faraz 9/30); offers close 2026-11-23 and publish by 2026-12-07 kept; Feb 2027 - Apr 2027 folded in (rules_only_ids / offer_modes merged: '
        || case when feb.rules_only_ids = '[]'::jsonb and feb.offer_modes = '{}'::jsonb then 'none to merge' else (feb.rules_only_ids::text || ' / ' || feb.offer_modes::text) end || '); applied by SQL')),
    ('s1', 'Khan', 'period.delete', jsonb_build_object('period_id', feb.id, 'label', feb.label, 'start_day', feb.start_day, 'end_day', feb.end_day,
      'offers_close_at', feb.offers_close_at, 'publish_by', feb.publish_by, 'status', feb.status, 'rules_only_ids', feb.rules_only_ids,
      'offer_modes', feb.offer_modes, 'created_by', feb.created_by, 'summary', 'Period Feb 2027 - Apr 2027 (2027-02-01 - 2027-05-02, offers close 2026-12-21, publish by 2027-01-04) deleted: folded into Jan 2027 - Jun 2027 (Faraz 9/30); offers are keyed by person and day, so none moved; applied by SQL'));
end $$;
```

After the apply, check: `select label, start_day, end_day, offers_close_at, publish_by, status, rules_only_ids from
public.call_periods order by start_day;` (two rows, as above) and the two `audit_log` rows (`period.update`,
`period.delete`); then the app (Setup > Periods, the painter's period line and My schedule show one period to 6/30) and
the offers cron's next mornings (11/9 reminder, 11/20 last call, 11/23 close). The seed already mirrors the result
(2026-09-30 revision: the widened row, no Feb - Apr row, `groupRules.offerPeriods` lengthMonths 6, remind [14, 3], notice
14), so a later seed apply cannot bring the Feb - Apr period back. **Order: Run fold-jan-jun.sql BEFORE any seed apply: an apply first would widen the live Jan row to 6/30 while the live Feb - Apr row stays (two overlapping upcoming periods - the importer upserts by start_day and never deletes), and the fold's pre-check would then refuse; the recovery is to delete the Feb - Apr row with its period.delete audit row by hand.**

observed: applied by Faraz in the Supabase SQL editor, committed 2026-10-01 04:33:12Z (the file above, one batch; the orchestrator's own apply had been refused by the session's permission classifier earlier that night). Verified read-only right after by Cowork and again by the orchestrator (linked CLI): `call_periods` holds two rows - Nov 2026 - Jan 2027 unchanged (published, updated_at 2026-09-23 21:26:53Z) and **Jan 2027 - Jun 2027** (2027-01-04 .. 2027-06-30, offers close 2026-11-23, publish by 2026-12-07, upcoming, rules_only_ids ["s5"], offer_modes {}, updated_at 2026-10-01 04:33:12.509979Z); the Feb 2027 - Apr 2027 row is gone; `audit_log` holds `period.update` (label Jan 2027 - Jun 2027) and `period.delete` (label Feb 2027 - Apr 2027), both actor s1 / Khan at 04:33:12.509979Z. The app (build 2026.09.30d) shows the one period to 6/30 in Setup > Periods. The fold ran before any seed apply (the order this section requires), and the seed already mirrors it, so a later apply changes nothing for periods. Fierce's "go by my rules" choice for January now covers January - June.

## 2026-09-30 - vacation guard: time_off_vacation_guard (Faraz 9/30, Prompt 27; `sql/migrations/2026-09-30-vacation-guard.sql`)

**Status: PREPARED - report-first, NOT APPLIED.**

Faraz 9/30: "a warning when people are taking vacations and a warning that stops vacations if more than 4 people are on
vacation. Need at least 2 surgeons around." No approval step - vacations stay self-entered. Needed live before 11/9 (the
heads-up e-mail of the Jan 2027 - Jun 2027 period goes out then and the surgeons enter their 2027 vacations after it).

**The rule.** `groupRules.vacations.minSurgeonsAround` in the blob - a whole number 0-99; absent / junk -> **2**
(`helpers.js` `VACATION_GUARD_DEFAULTS`, the `OP_NOTICE_DEFAULTS` / `GROUP_CALL_DEFAULTS` pattern: the live blob needs no
edit; the seed carries `groupRules.vacations { minSurgeonsAround: 2 }` since its second 2026-09-30 revision). With six active
surgeons at most four are off on any day. Counted per calendar day over the **active** roster surgeons (blob `roster`
entries whose `active` is not `false` and whose `type` is not `external` - the app's `poolSurgeons`). A surgeon is **off** on
a day inside one of his `time_off` rows, or inside one of his East (Davenport) vacation ranges that is not reviewed `home`
(an unreviewed range counts as away, as everywhere in the app). A vacation is refused when, on a day it takes the person off
(he is active and not off that day already; on an UPDATE only the NEW-minus-OLD days of the same person), fewer than the
minimum would stay around.

| object | before | after |
|---|---|---|
| `time_off_vacation_guard()` | - | new trigger function: `language plpgsql security definer set search_path = public, pg_temp` (the reads of `call_schedule_data` / `time_off` / `east_feed` / `east_vacation_reviews` must not depend on the caller's RLS: an RLS-filtered read answers no rows - silently - and would count nobody off). Volatile (the default), so the later rows of one multi-row INSERT see the earlier ones (the month painter's bulk insert is counted cumulatively). Takes one transaction advisory lock (`hashtext('time_off:vacation_guard')`) before it counts, so two concurrent entries cannot both pass. EXECUTE keeps the default grants (a `returns trigger` function cannot be called outside a trigger; PostgREST exposes none) |
| `time_off_vacation_guard_trg` | - | new `BEFORE INSERT OR UPDATE ... FOR EACH ROW` trigger on `public.time_off`; fires after `time_off_no_call_conflict_trg` (Postgres fires a table's BEFORE ROW triggers in name order), so `ON_CALL_CONFLICT` still answers first |
| `time_off_no_call_conflict()` and its trigger | the on-call rule | **unchanged** |
| policies, grants, tables, columns, rows | - | **unchanged** (no PostgREST schema-cache reload needed) |

**What the trigger sees (the task's question).** (1) **`time_off` rows** - every row, the row being written excluded by id
(on an UPDATE the old row too). (2) **East vacations** - the trigger CAN see both kinds: the ranges the East feed refresh
caches in the `east_feed` payload (`data.vacations [{ code, start, end }]` on every cached week; rows with
`data.isForecast = true` skipped - `east-feed.js eastVacations`) for an active surgeon whose East feature reads busy days
(`surgeonRules.<id>.eastFeed.enabled` and `eastBlocksPrimary` / `eastBlocksBackup` true, a roster code - the app's
`eastVacationPerson`; only Khan today), matched by roster **code**, minus the days a `home` row of `east_vacation_reviews`
covers. So an **away** review counts, a **home** review does not, and an **unreviewed** range counts like away - the app's
own reading (`rules.js` derives `P.eastVacationDays` for unreviewed and away; the app shows "Unreviewed counts as away").
**How the client covers the rest:** the client checks the same rule before every write (the Time off form, its Edit, the
month painter) from the ranges `eastVacPeople` already holds (the merged Davenport ranges under the person-scoped review
decisions, `helpers.derivedEastVacations`). The one difference, on the safe side: the client matches a `home` review to the
merged range EXACTLY (a review of a range Davenport later changed reads unreviewed again - counted), the trigger reads any
`home` row covering the day - a stale `home` row (until the next East refresh deletes it) can only make the database the
more lenient of the two; the database never refuses what the client allowed.

**Who it binds.** Every signed-in caller who is not the scheduler: a **surgeon** entering his own vacation and the office
**coordinator** entering one for a surgeon (the office path is refused the same way). **`public.silvis_is_sched()`**
(admin / scheduler) is let through - the client asks him first ("... As the scheduler you may still enter it - enter it
anyway?"). A session with **no signed-in user** (`auth.uid()` null: the SQL editor, the linked CLI, `service_role`) is let
through too - the scheduler's own tools (the seed import's `time_off` rows, a restore); the other probes' setups run that way.
A row of a person who is not an active roster surgeon changes nobody's count and passes. An UPDATE that takes the person off
no new day (same person, the range kept or narrowed, a note edit) is never checked - a surgeon can always shorten a vacation,
also on a day already under the minimum. Deletes are never checked. A missing blob (no `main` row) reads as no roster:
nothing is refused (the app cannot run without the blob).

**The refusal.** One code, `VG001`, with the days and the count:

    VACATION_TOO_FEW_AROUND: on 3/18, 3/19 only 1 of 6 surgeons would be around (minimum 2) - pick other dates or ask the scheduler

The over-limit days are grouped by their count, the groups in the order of their first day ("on 3/18, 3/20 only 1; on 3/19
only 0 of 6 ..."), each group's days as runs ("3/18", "3/18, 3/19", "3/18-3/20"). `helpers.js` `vacationGuardMessage`
builds the same text from the same days, so the client's refusal before the write and the database's after a bypassed check
read the same; the client shows the database's text verbatim (`describeDbError` lists `VACATION_[A-Z_]+` with the other own
tokens).

**Decisions for Faraz to approve with the apply:**

1. **Unreviewed East counts as away** (the app's rule). Khan's Davenport vacations he has not reviewed reduce the count until
   he marks them `home`; the form's "Also off" line shows the days (the scheduler sees them glossed "(East, unreviewed)",
   everyone else sees one merged list of days per person - East details stay the scheduler's, Item E3). This follows the
   app's 9/23 rule (`docs/SILVIS-CALL-RULES.md` section 3, Khan, "East vacations, away / home (Prompt 15)": an unreviewed or
   away range is a derived Silvis vacation - the conservative default). The open question about that default - how far out an
   unreviewed range should block - is the rules doc's section 8 item 17 and is not reopened here; if Faraz narrows it there,
   the guard should read the same horizon. While the app has not loaded the review rows, another surgeon's East range does not
   count toward the client's refusal (review 10/1) - the trigger, which reads the reviews itself, decides.
2. **A no-user session passes** (SQL editor / linked CLI / `service_role`), beside the scheduler. Refusing it would make a
   seed apply or a restore fail on a day the scheduler had already let go over the minimum.
3. **Edits are checked on their new days only** and narrowing is never checked (so a day already under the minimum - entered
   by the scheduler - never traps a surgeon's own shortening).
4. **The person already off is not "taking himself off" again**: a second row over a day his other row or his East vacation
   already covers is not refused.

**Blast radius.** Every `time_off` INSERT / UPDATE by a non-scheduler from the apply on: the Time off form and its Edit (a
surgeon, the office coordinator) and a direct REST call. The month painter (Setup > Vacations > Paint month) is NOT one of
them: Setup opens for the scheduler only, so the painter's bulk insert passes the trigger (the client asks him first and
records his override in the audit row). The client that ships with this file checks the rule BEFORE the write - the form
(and an Edit row) shows who else is off and how many stay around while the dates are typed, a surgeon / the coordinator is
refused with the text above (no write), the scheduler gets a confirm - so the client can ship first; the trigger is the
backstop for a stale build or a direct REST call. A day ALREADY under the minimum in live data stays as it is (nothing is
deleted or re-checked); a new vacation of a non-scheduler over such a day is refused - the query below lists such days. The
other probes' `time_off` fixtures (2030-03 / 04 / 05 / 08) put at most two surgeons off on a day and their setups run with
no signed-in user: none of them changes; verify-rls section 4's `s9test` rows (not on the roster, no signed-in user) pass.

**Known gap (review 10/1): the rule is enforced only when a `time_off` row is written.** Two other paths can push a day
under the minimum with nothing refused: an East review changed to `away` (there is no refusing trigger on
`east_vacation_reviews` - a Davenport absence is a fact the surgeon reports, not a request the group may refuse), and a new or
longer Davenport range arriving through the East feed refresh (`east_feed` is a cache of the other project's facts). The
over-limit query below lists such days (read-only - run it after a refresh or a review change when in doubt); a later
vacation of a non-scheduler over such a day is refused. The East review panel does not show the guard's count when a range
is marked away (left out as not small: it would need the count without the range under review; the query covers it).

**What could break.** (1) The probe and verify-rls section 15 are written against an AFTER picture nobody has observed (no
local Postgres was available to this lane; the SQL was reviewed by reading): the first live run may show a typo or a
different wording - section 15 grades exact strings, so it would say so by case. (2) The expected strings rest on the live
roster (six active surgeons, minimum 2, an East person): P1 / P2 are graded first and name a changed picture. (3) A malformed
date inside a cached `east_feed` range cannot make the trigger raise (a value not shaped `YYYY-MM-DD` is skipped, the rest is
compared as text - never cast), while the read-only over-limit query casts it and would fail loudly. (4) The known gap above:
a day can fall under the minimum through an East review or a feed refresh without any refusal - by design (facts are not
refused), visible only through the over-limit query.

**The days ALREADY under the minimum (read-only; run BEFORE the apply).** `sql/probes/vacation-guard-overlimit.sql` - the
same reading as the trigger, one row per day on which fewer than the minimum stay around (day, around, active, minimum, who
is off - roster order, each person once: his sources are aggregated per day and person first and he is tagged "(East)" only
when every source of his that day is an East range (review 10/1) - and whether the day is past):

```sql
with blob as (
  select c.data from public.call_schedule_data c where c.id = 'main'
),
minimum as (
  select coalesce((select case when jsonb_typeof(b.data #> '{groupRules,vacations,minSurgeonsAround}') = 'number'
                               then case when (b.data #>> '{groupRules,vacations,minSurgeonsAround}')::numeric between 0 and 99
                                          and (b.data #>> '{groupRules,vacations,minSurgeonsAround}')::numeric = trunc((b.data #>> '{groupRules,vacations,minSurgeonsAround}')::numeric)
                                         then (b.data #>> '{groupRules,vacations,minSurgeonsAround}')::numeric::int end end
                     from blob b), 2) as n
),
roster as (
  select e.r->>'id' as id, e.ord, coalesce(e.r->>'name', e.r->>'id') as name, upper(coalesce(e.r->>'code', '')) as code,
         coalesce(e.r->>'code', '') <> ''
           and (b.data #> array['surgeonRules', e.r->>'id', 'eastFeed', 'enabled']) = 'true'::jsonb
           and ((b.data #> array['surgeonRules', e.r->>'id', 'eastFeed', 'eastBlocksPrimary']) = 'true'::jsonb
             or (b.data #> array['surgeonRules', e.r->>'id', 'eastFeed', 'eastBlocksBackup']) = 'true'::jsonb) as east
    from blob b
    cross join lateral jsonb_array_elements(case when jsonb_typeof(b.data->'roster') = 'array' then b.data->'roster' else '[]'::jsonb end) with ordinality as e(r, ord)
   where jsonb_typeof(e.r) = 'object' and coalesce(e.r->>'id', '') <> ''
     and coalesce(e.r->'active', 'true'::jsonb) <> 'false'::jsonb and coalesce(e.r->>'type', '') <> 'external'
),
active_n as (
  select count(*)::int as n from roster
),
east_ranges as (
  select a.id, v.r->>'start' as s, v.r->>'end' as e
    from roster a
    join public.east_feed f on a.east
    cross join lateral jsonb_array_elements(case when jsonb_typeof(f.data->'vacations') = 'array' then f.data->'vacations' else '[]'::jsonb end) as v(r)
   where (f.data->'isForecast') is distinct from 'true'::jsonb
     and jsonb_typeof(v.r) = 'object'
     and upper(coalesce(v.r->>'code', '')) = a.code
     and coalesce(v.r->>'start', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     and coalesce(v.r->>'end', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     and v.r->>'start' <= v.r->>'end'
),
off_days as (
  select g::date as day, t.person_id as id, false as east
    from public.time_off t
    join roster a on a.id = t.person_id
    cross join lateral generate_series(t.start_date::timestamp, t.end_date::timestamp, interval '1 day') as g
  union
  select g::date, er.id, true
    from east_ranges er
    cross join lateral generate_series(er.s::date::timestamp, er.e::date::timestamp, interval '1 day') as g
   where not exists (select 1 from public.east_vacation_reviews w
                      where w.person_id = er.id and w.decision = 'home' and g::date between w."start" and w."end")
),
off_people as (
  select o.day, o.id, bool_and(o.east) as east_only
    from off_days o
   group by o.day, o.id
)
select p.day,
       (select n from active_n) - count(distinct p.id)::int as around,
       (select n from active_n) as active,
       (select n from minimum) as minimum,
       string_agg(a.name || case when p.east_only then ' (East)' else '' end, ', ' order by a.ord) as off,
       p.day < (now() at time zone 'America/Chicago')::date as past
  from off_people p
  join roster a on a.id = p.id
 group by p.day
having (select n from active_n) - count(distinct p.id)::int < (select n from minimum)
 order by p.day;
```

**The probe** (`sql/probes/vacation-guard-probe.sql`; one batch, a temp results table, the last statement raises
`PROBE_RESULTS ...;END`, so everything rolls back; `PROBE_SETUP: time_off_vacation_guard is absent` before the migration).
Throwaway auth users `probe-vacguard-<uuid>@example.test` (surgeon n1, surgeon n2, an unlinked coordinator, an unlinked
admin); fixtures in 2030-10 (the setup refuses to run when `time_off`, `schedule_days`, `east_feed` or
`east_vacation_reviews` already hold anything there); the roster READ from the live blob, never written (E = the East person,
n1..n5 = the next five active surgeons). VG(days) = `ERR VG001 VACATION_TOO_FEW_AROUND: on <days> only 1 of 6 surgeons would
be around (minimum 2) - pick other dates or ask the scheduler`.

| case | what | AFTER |
|---|---|---|
| P1 / P2 | the live picture the strings rest on | `active=6 min=2` / `east=yes` |
| P3 | `time_off`'s triggers in firing order, the guard's security | `triggers=time_off_no_call_conflict_trg,time_off_vacation_guard_trg definer=t` |
| P4 | the id the I case uses | `inactive=roster` or `inactive=non-roster` |
| S1 | surgeon n1 is the 4th off (10/15-10/17) | `ok` |
| S2 | surgeon n2 would be the 5th on 10/16, 10/17 (10/18 only the 4th) | VG(`10/16, 10/17`) |
| S3 | n1 widens his S1 row to 10/19 (10/18 the 4th, 10/19 the 5th) | VG(`10/19`) |
| S4 | n1 narrows his S1 row to 10/15-10/16 | `updated=1` |
| E1 / E2 / E3 | n1 on a day of E's East range reviewed away / home / unreviewed | VG(`10/1`) / `ok` / VG(`10/7`) |
| I1 | n1 the 4th active off beside an inactive / outside id's row | `ok` |
| K1 | n1 over his own primary day 10/13 that would also be the 5th | `ERR P0001 ON_CALL_CONFLICT: ...` (first) |
| K2 | n1 over his backup day 10/29, nobody else off | `ERR P0001 ON_CALL_CONFLICT: ...` (also) |
| C1 | the coordinator enters n1 as the 5th (10/9-10/10) | VG(`10/9, 10/10`) |
| M1 | the coordinator enters n1 and n2 on 10/25 in ONE insert | VG(`10/25`) |
| A1 | the admin (scheduler) enters n1 as the 5th | `ok` |
| N1 | no signed-in user enters n1 as the 5th | `ok` |
| D1 | surgeon n2 enters 10/10, a day at the limit he is already off by his fixture row (decision 4) | `ok` |
| U1 | the coordinator moves the D1 row to n1 (`person_id` changed) - n2 stays off, n1 would be the 5th on 10/10 | VG(`10/10`) |

**Apply order.**

1. The client may ship first (its own check refuses / confirms before any write; it shows the database's text if refused).
2. Pre-check: `select to_regprocedure('public.time_off_vacation_guard()');` -> null; and the over-limit query above (read
   only - report the days to Faraz; nothing is changed).
3. Probe BEFORE: `supabase db query --linked --workdir <dir> -f <abs>/sql/probes/vacation-guard-probe.sql` -> `PROBE_SETUP: time_off_vacation_guard is absent ...`.
4. The migration, one session: `supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-30-vacation-guard.sql`.
5. Probe AFTER: every case as the table lists (20 cases: P1-P4, S1-S4, E1-E3, I1, K1-K2, C1, M1, A1, N1, D1, U1).
6. `SILVIS_VACATION_GUARD_APPLIED=1 bash scripts/verify-rls.sh` - sections 1-15 green (the flag makes the probe's PROBE_SETUP a
   FAIL; section 15 counts the leftovers either way).
7. The record step, ONE commit: this status -> APPLIED <timestamp> with the observed line (its post-apply half); table (a)'s
   `time_off` row; `sql/schema.sql` revision s -> "applied <timestamp>" (and its block comment, and the test pins with them);
   the migration's header -> APPLIED, and the probe's and the over-limit query's headers with it; `SILVIS_VACATION_GUARD_APPLIED`
   dropped from verify-rls (strict becomes the default; section 15's comment with it); guide 4.3's bullet and Proof line; and
   the other docs that say the trigger is not applied: `docs/SILVIS-CALL-RULES.md` section 1's Time off row ("prepared -
   report-first, not applied ... until it is applied the app's own check is the gate"), `docs/SILVIS-BUILD-GUIDE.md` section
   8's "Vacation guard" bullet ("report-first, NOT applied - section 4.3") and `CLAUDE.md`'s time-off sentence ("report-first
   until applied").

**Rolling back** = `drop trigger if exists time_off_vacation_guard_trg on public.time_off; drop function if exists
public.time_off_vacation_guard();` (nothing else refers to either; the client's own check stays).

One command (10/1): Faraz's apply script `apply-vacation-guard.sh`, kept OUTSIDE the repo (Faraz 10/1: the apply scripts carry
machine paths and do not live in the repo). He runs it from the repo root with the linked CLI dir; it runs steps 2-6 above in
order, stops at the first failure and ends with a block to paste back; the record step follows.

observed (pre-apply, 2026-10-01): the read-only over-limit query (`sql/probes/vacation-guard-overlimit.sql`) returned 0 rows on
2026-10-01 ~05:10 UTC - no day under the minimum in live data (the 10/1 review's per-person aggregation changes only its `off`
column, not which days are listed); probe BEFORE: `PROBE_SETUP: time_off_vacation_guard is absent -
sql/migrations/2026-09-30-vacation-guard.sql is not applied` (nothing else ran). The orchestrator's apply was refused by the
session's permission classifier and not retried by any other route: Faraz applies the migration himself (SQL editor or the
linked CLI), as he did the period fold on 10/1 04:33Z. Post-apply: _to be filled after the apply (the probe AFTER - 20 cases -
and the `SILVIS_VACATION_GUARD_APPLIED=1 bash scripts/verify-rls.sh` counts)_

## 2026-10-01 - no-primary days: save_no_primary + save_offers p_np_add / p_np_clear (Faraz 10/1, Prompt 28; `sql/migrations/2026-10-01-no-primary-days.sql`)

**Status: PREPARED - report-first, NOT APPLIED.**

Faraz 10/1: "I do want them to be able to do that" - surgeons mark their own no-primary days. Burchett's e-mail of 10/1: "These
are days I am at Jackson County - I need to be blocked out as unavailable for primary call. I can cover backup call these
days". A no-primary day means "don't put me on primary; backup is fine": one `availability` row per day, kind `backup_only`,
role `any` - the kind `rules.js` already reads (primary blocked by the hard reason `backup-only-row`, backup marked available;
a dated row, so it lifts the weekday-pattern family for backup that day). It is NOT an offer: the offer status, the exhaustive
`not-offered` reason and the period roll-call keep reading `call_offers` only.

| object | before | after |
|---|---|---|
| `save_no_primary(p_person text, p_add date[], p_clear date[])` | - | new function: `language plpgsql security definer set search_path = public, pg_temp`; EXECUTE revoked from public and anon, granted to authenticated (an invoker's nested call needs it; it carries every check itself, so a direct REST call is as safe as the nested one); returns `{ok, person_id, added, cleared, kept, source, created_by}` |
| `save_offers` | five arguments `(text, jsonb, date[], uuid, text)`, security invoker | **dropped** and re-created with seven: `(p_person, p_rows, p_clear, p_period, p_mode, p_np_add date[] default null, p_np_clear date[] default null)`, still `security invoker set search_path = public`; calls `save_no_primary` when the two arrays carry a day, then refuses a day it offers as primary / either that carries a `backup_only` row afterwards (`NP009`); returns the old keys plus `np_added` / `np_cleared` / `np_kept` |
| `availability` policies, `call_offers` policies and triggers, tables, columns, rows | - | **unchanged** - `availability` has no trigger; a surgeon still cannot write it directly (RLS); the function is the only door and opens on single-day `backup_only` rows only |
| PostgREST schema cache | - | the migration ends with `notify pgrst, 'reload schema';` (a seven-key call needs the cache to know `p_np_add` / `p_np_clear` - verify-rls 16b proves it before the client push) |

**The decision: extend `save_offers` AND add the definer sibling, called inside it.** Prompt 28 keeps the painter's Save ONE
request, so `save_offers` stays the entry point and gains two optional parameters; it must stay `security invoker` (the
`call_offers` policies, `OF001`-`OF004` per row and the office-relay flag depend on it), and a surgeon cannot write
`availability` under RLS with no RLS change allowed - so the availability write is a `security definer` sibling with its own
caller checks, called as a plain statement inside `save_offers`' transaction: a refusal there (or after it) rolls the offer rows
back too. Rejected: `save_offers` as definer (it would bypass the `call_offers` policies and the triggers' reading of the
caller), a fake `role_pref` in `p_rows` (overloads the row validation), a new table (forbidden), the sibling in a non-exposed
schema (the house keeps every function in `public`; the sibling's own checks make a direct call safe). The five-argument
signature is dropped in the same transaction: kept beside a seven-argument function with two trailing defaults it would make
every five-key PostgREST call ambiguous (PGRST203); after the drop an older build's five-key call resolves to the new function.

**The refusals** (custom SQLSTATEs - PostgREST answers an unknown class with HTTP 400, like OS / OM / VG; days as M/D in day
order; every check runs BEFORE the first write, in this order, a transaction advisory lock per person taken after `NP003`):

| code | when | message |
|---|---|---|
| `NP001` | no signed-in user, or an unlinked caller who is neither the scheduler nor the office | `NO_PRIMARY_NOT_LINKED: sign in with an account that is linked to a roster entry to mark no-primary days` |
| `NP001` | no person named and the account is not linked | `NO_PRIMARY_NOT_LINKED: name the person (your account is not linked to a roster entry)` |
| `NP002` | another person, the caller neither the scheduler nor the office | `NO_PRIMARY_NOT_YOURS: only the scheduler or the office can mark another surgeon's no-primary days` |
| `NP003` | the office names an id that is not on the roster (the `OS004` expression word for word; the scheduler's relay is not checked) | `NO_PRIMARY_UNKNOWN_PERSON: <id> is not a roster id - the office relays for a roster surgeon only` |
| `NP004` | an empty day in a list | `NO_PRIMARY_BAD_DAY: a day in the list is empty - nothing was saved` |
| `NP004` | a day both marked and cleared | `NO_PRIMARY_BAD_DAY: <days> is both marked and cleared in one save - nothing was saved` |
| `NP005` | a day before today (Central) - **every caller, the scheduler included** (like `OF001`) | `NO_PRIMARY_PAST: <days> is before today (<M/D>) in Central time - a past day stays as it was` |
| `NP006` | not the scheduler, and a day inside a period whose offers closed or whose status is no longer `upcoming` (the `OF003` reading; the earliest such period names the message) | `NO_PRIMARY_FROZEN: offers for <label> closed on <date> - ask the scheduler (<days>)` |
| `NP007` | a day to CLEAR covered by a longer `backup_only` range of the person - **every caller** (a range is never split; the scheduler edits it in Setup) | `NO_PRIMARY_RANGE: <days> is part of a longer no-primary range the scheduler set - change it in Setup > Availability statements` |
| `NP008` | a day to MARK that the person holds as PRIMARY on `schedule_days` - **every caller** (holding backup is fine) | `NO_PRIMARY_ON_CALL: <name> holds primary on <days> - trade those days first, then mark them No primary` |
| `NP009` | a day to MARK with a primary / either offer of the person (it sees the offers this Save wrote) - and, in `save_offers`, a day it OFFERS as primary / either that carries a `backup_only` row afterwards | `NO_PRIMARY_OFFER_CONFLICT: <name> offers primary on <days> and marks it No primary - keep one of the two (nothing was saved)` |

**Sources and created_by** (save_offers' rule, a fact of the call - never a client field): the surgeon himself `app` / his
roster id; the office coordinator `office-relay` / its profile id; the scheduler relaying for someone `email-relay` /
`scheduler`. The note is always NULL (an anon-readable table carries no reasons - CLAUDE.md). Clearing deletes the person's
SINGLE-day `backup_only` rows on the named days whatever their source (`setup`, `seed`, `app`, the relays) - Burchett's own rows
from Setup are his to clear; a day already covered by any `backup_only` row of the person (single or range) is not duplicated
(`kept`). The function writes no audit or notification row: the client's `offers.save` is the one audit row per Save
("Burchett: no primary on 1/6, 1/15").

**Decisions for Faraz** (taken as readings; each is data-free and can be reversed in the function):

1. **Past days bind the scheduler too** (consistent with `OF001`): a past row is his to fix in Setup > Availability statements.
2. **The freeze spares the scheduler only** (`NP006`, as `OF003` / `OM005`); the office coordinator is frozen like a surgeon.
3. **A vacation day is allowed** (no `OF002` equivalent): a no-primary row only restricts, and `rules.js` never lifts the
   vacation for a dated row. The painter never offers it (a vacation greys both roles); Clear stays allowed there.
4. **Only a held PRIMARY is refused** ("backup is fine"); a held backup day may be marked.
5. **The office's roster check works as `OS004`** (`NP003`); the scheduler may relay for any id.
6. **Either on a no-primary day is replaced by nothing**, not turned into Backup (paint Backup if wanted) - the rules doc's
   section 8 item 25.
7. **A cleared seed-sourced row comes back on the next seed apply** (the importer re-creates its `source = 'seed'` rows)
   unless `surgeonRules.s2.explicitBackupOnly` is edited too.
8. **NP009 also binds older builds' Saves**: the old painter already skips primary / either on a `backup-only-row` day and shows
   the database's text verbatim (`describeDbError`'s `OFFERS?_[A-Z_]+` matches the token's tail); a stale painter (a row added
   after it loaded) gets "nothing was saved" with the message, never a silent half-write.

**Flags (live data, never changed here):** (1) Burchett's 13 Jackson County rows (entered by Cowork on 10/1 as single-day
`backup_only` rows, source `setup`, audit `availability.add` 12:03:17Z) carry the public note "Jackson County" - a reason in an
anon-readable table, which CLAUDE.md forbids. The function writes note NULL; whether to blank the live note in Setup is Faraz's
call (nothing was changed live). The pre-check counts the rows with a note (`with_note`), never prints the text. (2) The
seed's October backup-only list for Burchett includes 10/15, which he holds as primary since 9/25 (locked) - the pre-check lists
it under "primary held on a no-primary day"; harmless (the lock stands, the generator never touches it) and nothing here
changes either.

**Blast radius.** Every Save from the apply on resolves to the new `save_offers`: the painter of every build (an older build's
five-key call resolves to the seven-argument function and behaves as before, except that the offers-side `NP009` binds it -
decision 8), the scheduler's "Paint offers for X", the office's relay, Setup > Periods "Enter for X". The other probes' calls
are positional (three or five arguments) and read the return by key - unaffected (observed offline: the offer-rpcs, coordinator,
offers, claim and vacation-guard probes read the same before and after the migration). `claim_open_slot` and `apply_trade` are
untouched. The client that sends `p_np_add` / `p_np_clear` ships AFTER the apply: before it the pre-apply function answers a
seven-key call with PGRST202 (HTTP 404, nothing saved); the client sends the two keys only when non-empty, so its offer Saves
work before the apply and after a rollback.

**Residuals.** (1) `claim_open_slot` does not consult availability on the server (unchanged; its client gate runs
`eligibility`, which blocks primary on such a day). (2) A direct `save_no_primary` call leaves no audit row (as with
`save_offers`). (3) A schedule edit and a no-primary mark for the same day are not serialised against each other (the day
editor's eligibility warning shows the result). (4) The client reads `availability` unpaged (`config.js` `db.query`;
PostgREST max-rows, Supabase default 1000) and each marked day adds a row - the pre-check prints the total; a paged read (the
`PAY_PAGE` pattern) is a follow-up before the table nears the cap. (5) `save_offers`' own `NP009` check reads `availability`
without the per-person advisory lock (the spec's body), so two Saves of one person committed at the same instant from two
devices - one offering primary on a day, the other marking it No primary - could both pass; harmless for the schedule
(`eligibility` blocks primary on a `backup_only` day) and the pre-check's "offer conflict" section lists such a day.

**What could break.** The probe and verify-rls section 16 were written against an AFTER picture observed OFFLINE only: on
2026-10-01 the migration, the probe, the pre-check and the five older probes ran on PGlite (WASM PostgreSQL 18) with stubbed
Supabase roles, `auth.uid()` and the live-shaped roster - every one of the 42 cases read its header string, the leftover count
was 0, a failure inside the migration left the database unchanged, the rollback lines restored the five-argument function, and
section 16 graded the real output 45 / 0. What PGlite cannot show: there the functions' owner is a superuser (live: the
`postgres` role, which bypasses RLS as the owner of `availability` - no `force row level security` anywhere), Supabase's own
`auth.uid()` and grants, and PostgREST (the HTTP codes of 16a / 16b, the schema-cache reload). The live database is what the
apply proves - P1 and S1 for the definer's write, 16b for the cache; section 16 grades exact strings and names any difference
by case.

**The pre-check (read-only; run before and after the apply).** `sql/probes/no-primary-precheck.sql` - one SELECT returning
`ord, section, person_id, detail`; row 1 is the apply gate (`np_fn=no offers5=yes offers7=no overloads=1` before,
`np_fn=yes offers5=no offers7=yes overloads=1` after), rows 2-5 are facts:

```sql
with today as (
  select (now() at time zone 'America/Chicago')::date as d
),
fns as (
  select 1 as ord, 'functions'::text as section, ''::text as person_id,
         'np_fn=' || case when to_regprocedure('public.save_no_primary(text, date[], date[])') is null then 'no' else 'yes' end
      || ' offers5=' || case when to_regprocedure('public.save_offers(text, jsonb, date[], uuid, text)') is null then 'no' else 'yes' end
      || ' offers7=' || case when to_regprocedure('public.save_offers(text, jsonb, date[], uuid, text, date[], date[])') is null then 'no' else 'yes' end
      || ' overloads=' || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'save_offers') as detail
),
total as (
  select 2 as ord, 'availability total'::text as section, ''::text as person_id, 'rows=' || (select count(*) from public.availability) as detail
),
bo as (
  select 3 as ord, 'backup_only rows'::text as section, a.person_id,
         'single=' || count(*) filter (where a.start_date = a.end_date)
      || ' ranges=' || count(*) filter (where a.start_date < a.end_date)
      || ' with_note=' || count(*) filter (where nullif(btrim(coalesce(a.note, '')), '') is not null)
      || ' sources=' || string_agg(distinct coalesce(a.source, '(none)'), ',' order by coalesce(a.source, '(none)')) as detail
    from public.availability a
   where a.kind = 'backup_only'
   group by a.person_id
),
conflict as (
  select 4 as ord, 'offer conflict'::text as section, o.person_id, 'days=' || string_agg(to_char(o.day, 'YYYY-MM-DD'), ',' order by o.day) as detail
    from public.call_offers o
    cross join today t
   where o.day >= t.d and o.role_pref in ('primary', 'either')
     and exists (select 1 from public.availability a where a.person_id = o.person_id and a.kind = 'backup_only' and o.day between a.start_date and a.end_date)
   group by o.person_id
),
held as (
  select 5 as ord, 'primary held on a no-primary day'::text as section, s.primary_id as person_id, 'days=' || string_agg(to_char(s.day, 'YYYY-MM-DD'), ',' order by s.day) as detail
    from public.schedule_days s
    cross join today t
   where s.day >= t.d and s.primary_id is not null
     and exists (select 1 from public.availability a where a.person_id = s.primary_id and a.kind = 'backup_only' and s.day between a.start_date and a.end_date)
   group by s.primary_id
)
select ord, section, person_id, detail from fns
union all select ord, section, person_id, detail from total
union all select ord, section, person_id, detail from bo
union all select ord, section, person_id, detail from conflict
union all select ord, section, person_id, detail from held
order by ord, person_id;
```

**The probe** (`sql/probes/no-primary-probe.sql`; one batch, a temp results table, the last statement raises
`PROBE_RESULTS ...;END`, so everything rolls back; `PROBE_SETUP: save_no_primary is absent ...` before the migration - every
case's BEFORE). Throwaway auth users `probe-noprimary-<uuid>@example.test` (surgeon S linked to s3, an unlinked coordinator C,
an admin A linked to s1); fixtures in 2030-11 plus the past day 2020-04-06 (the setup refuses to run over live rows there):
periods `probe np open` (11/1-11/15, open) and `probe np frozen` (11/16-11/30, offers closed 2026-09-01); s3 holds primary on
11/5 and backup on 11/6; s3's `backup_only` single days 11/8 and 11/21, a range 11/10-11/12, an `unavailable` row 11/9; offers
primary 11/3, backup 11/4, primary 11/13; a vacation 11/14. `sp` = `save_offers('s3', ...)` positional, `npd` =
`save_no_primary`; `<name>` = s3's roster name.

| case | what | AFTER |
|---|---|---|
| P1 | postgres: the functions, their security, search_path, overloads, grants | `np_fn=yes np_definer=yes np_path=yes offers7=yes offers5=no offers_invoker=yes overloads=1 np_anon=no np_auth=yes offers_anon=no offers_auth=yes` |
| S1 | S marks 11/2, 11/7: sp([], null, null, null, {11/2, 11/7}, null) | `ok np_added=2 np_cleared=0 rows=2 src=app by=s3 role=any note=null` |
| S2 | S1 again (idempotent) | `ok np_added=0 np_kept=2 rows=2` |
| S3 | replace a Primary offer: sp([], {11/3}, null, null, {11/3}, null) | `ok deleted=1 np_added=1 offer=none np=1` |
| S4 | keep a Backup offer: sp([], null, null, null, {11/4}, null) | `ok np_added=1 offer=backup np=1` |
| S5 | lift: sp([11/7 primary], null, null, null, null, {11/7}) | `ok upserted=1 np_cleared=1 offer=primary np=0` |
| S6 | lift missing: sp([11/2 either], null) (11/2 still No primary) | `ERR NP009 NO_PRIMARY_OFFER_CONFLICT: <name> offers primary on 11/2 and marks it No primary - keep one of the two (nothing was saved)` |
| S6s | state of 11/2 after S6 (rolled back) | `offer=none np=1` |
| S7 | mark over a Primary offer: sp([], null, null, null, {11/13}, null) | `ERR NP009 NO_PRIMARY_OFFER_CONFLICT: <name> offers primary on 11/13 and marks it No primary - keep one of the two (nothing was saved)` |
| S8 | clear his own Setup single day 11/8 | `ok np_cleared=1 left=0` |
| S9 | clear 11/11, a day of the Setup range | `ERR NP007 NO_PRIMARY_RANGE: 11/11 is part of a longer no-primary range the scheduler set - change it in Setup > Availability statements` |
| S10 | clear 11/9 (only an unavailable row) | `ok np_cleared=0 unavailable=1` |
| S11 | direct insert into availability, kind unavailable, for s3 | `ERR 42501 new row violates row-level security policy for table "availability"` |
| S12 | direct insert into availability, kind backup_only, for s3 | `ERR 42501 new row violates row-level security policy for table "availability"` |
| S13 | offer primary on a range day: sp([11/10 primary], null) | `ERR NP009 NO_PRIMARY_OFFER_CONFLICT: <name> offers primary on 11/10 and marks it No primary - keep one of the two (nothing was saved)` |
| V1 | mark the vacation day 11/14 (no vacation refusal) | `ok np_added=1` |
| H1 | mark 11/5 (he holds primary) | `ERR NP008 NO_PRIMARY_ON_CALL: <name> holds primary on 11/5 - trade those days first, then mark them No primary` |
| H2 | mark 11/6 (he holds backup - fine) | `ok np_added=1` |
| D1 | mark 2020-04-06 | `ERR NP005 NO_PRIMARY_PAST: 4/6 is before today (<today M/D>) in Central time - a past day stays as it was` |
| D2 | clear 2020-04-06 | `ERR NP005 NO_PRIMARY_PAST: 4/6 is before today (<today M/D>) in Central time - a past day stays as it was` |
| F1 | mark 11/20 (frozen period) | `ERR NP006 NO_PRIMARY_FROZEN: offers for probe np frozen closed on 2026-09-01 - ask the scheduler (11/20)` |
| F2 | clear 11/21 (frozen period) | `ERR NP006 NO_PRIMARY_FROZEN: offers for probe np frozen closed on 2026-09-01 - ask the scheduler (11/21)` |
| B1 | one batch: sp([11/1 backup], null, null, null, {11/15, 11/5}, null) | `ERR NP008 NO_PRIMARY_ON_CALL: <name> holds primary on 11/5 - trade those days first, then mark them No primary` |
| B1s | state after B1 (the whole batch rolled back) | `offer_1101=none np_1115=0` |
| B2 | mark and clear 11/15 in one call | `ERR NP004 NO_PRIMARY_BAD_DAY: 11/15 is both marked and cleared in one save - nothing was saved` |
| B3 | '{NULL}' as p_np_add | `ERR NP004 NO_PRIMARY_BAD_DAY: a day in the list is empty - nothing was saved` |
| R1 | S: save_offers('s2', [], null, null, null, {11/2}, null) | `ERR OS002 OFFERS_NOT_YOURS: only the scheduler or the office can save another surgeon's offers` |
| R2 | S: npd('s2', {11/2}, null) | `ERR NP002 NO_PRIMARY_NOT_YOURS: only the scheduler or the office can mark another surgeon's no-primary days` |
| R3 | S: npd('s3', {11/13}, null) (direct, over a Primary offer) | `ERR NP009 NO_PRIMARY_OFFER_CONFLICT: <name> offers primary on 11/13 and marks it No primary - keep one of the two (nothing was saved)` |
| O1 | S: the old three-argument shape save_offers('s3', [11/1 backup], null) | `ok upserted=1 np_added=0` |
| C1 | C: save_offers('s3', [], null, null, null, {11/15}, null) | `ok np_added=1 src=office-relay by=self` |
| C2 | C: the same for 'zz' | `ERR OS004 OFFERS_UNKNOWN_PERSON: zz is not a roster id - the office relays for a roster surgeon only` |
| C3 | C: npd('zz', {11/15}, null) | `ERR NP003 NO_PRIMARY_UNKNOWN_PERSON: zz is not a roster id - the office relays for a roster surgeon only` |
| C4 | C: marks s3 on 11/22 (frozen) | `ERR NP006 NO_PRIMARY_FROZEN: offers for probe np frozen closed on 2026-09-01 - ask the scheduler (11/22)` |
| A1 | A: marks s3 on 11/23 (frozen - the scheduler is exempt) | `ok np_added=1 src=email-relay by=scheduler` |
| A2 | A: clears s3's frozen single day 11/21 | `ok np_cleared=1` |
| A3 | A: marks s3 on 11/5 (s3 holds primary) | `ERR NP008 NO_PRIMARY_ON_CALL: <name> holds primary on 11/5 - trade those days first, then mark them No primary` |
| A4 | A: marks s3 on 2020-04-06 (past binds the scheduler) | `ERR NP005 NO_PRIMARY_PAST: 4/6 is before today (<today M/D>) in Central time - a past day stays as it was` |
| A5 | A: clears s3's range day 11/11 (never split) | `ERR NP007 NO_PRIMARY_RANGE: 11/11 is part of a longer no-primary range the scheduler set - change it in Setup > Availability statements` |
| A6 | A: marks s3 on 11/11 (covered by the range) | `ok np_added=0 np_kept=1` |
| N1 | anon: npd('s3', {11/15}, null) | `ERR 42501 permission denied for function save_no_primary` |
| N2 | postgres, no signed-in user: npd('s3', {11/15}, null) | `ERR NP001 NO_PRIMARY_NOT_LINKED: sign in with an account that is linked to a roster entry to mark no-primary days` |

**Apply order.**

1. Pre-check: `sql/probes/no-primary-precheck.sql` - row 1 must read `np_fn=no offers5=yes offers7=no overloads=1`; rows 2-5 are
   reported (the availability total, the backup_only rows per person, offer conflicts, a primary held on a no-primary day).
2. Probe BEFORE: `supabase db query --linked --workdir <dir> -f <abs>/sql/probes/no-primary-probe.sql` -> `PROBE_SETUP: save_no_primary is absent ...`.
3. The migration, one session: `supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-10-01-no-primary-days.sql`.
4. Probe AFTER: every case as the table lists (42 cases).
5. `SILVIS_NO_PRIMARY_APPLIED=1 bash scripts/verify-rls.sh` - sections 1-16 green (the flag makes the probe's PROBE_SETUP and the
   anon 404s a FAIL; 16b is the gate before the client push; section 16 counts the leftovers either way).
6. The record step, ONE commit: this status -> APPLIED <timestamp> with the observed line; table (a)'s `availability` row;
   `sql/schema.sql` revision t -> "applied <timestamp>" (and its block comment); the migration's and the probe's headers ->
   APPLIED; a `test/schema.test.js` pin of the applied file's sha256 (the `OFFERS_APPLIED_SHA256` pattern) from the log's sha256
   line; `SILVIS_NO_PRIMARY_APPLIED` dropped from verify-rls (strict becomes the default, with its pin moved like call pay's);
   guide 4.3's Proof line "applied:" and its pin; the rules doc's section 1 row "prepared" -> "applied <date>". Then, on Faraz's
   go, the client push (a merge to `main` is a live deploy).

**One command (Faraz):** his apply script `apply-no-primary-days.sh`, kept OUTSIDE the repo (Faraz 10/1: the apply scripts
carry machine paths and do not live in the repo), run from the repo root on the commit its header names, with the CLI dir
linked by `supabase link --project-ref bzhsroegtagqhutbnsrp` - `--dry-run` first (steps 1-3 only, nothing applied). It prints
the branch, HEAD, the migration's sha256, the workdir and the linked ref first, refuses to run unless the ref is
`bzhsroegtagqhutbnsrp`, `sql/` / `scripts/` are committed and the migration's sha256 is the reviewed one, stops at the first
failure, asks for a typed APPLY before the migration, writes everything to a timestamped log beside itself and ends with a
"PASTE THIS BACK TO CLAUDE CODE" block; the record step is done from that block.

**Rolling back** (nothing else refers to `save_no_primary`; the five-argument text is the coordinator file's):

    drop function if exists public.save_offers(text, jsonb, date[], uuid, text, date[], date[]);
    -- re-create the five-argument save_offers from sql/migrations/2026-09-24-coordinator-role.sql (its create, grants, comment)
    drop function if exists public.save_no_primary(text, date[], date[]);
    notify pgrst, 'reload schema';

A rollback after the client push breaks only no-primary Saves (the client omits the np keys when empty).

observed: _to be filled from Faraz's apply log_
