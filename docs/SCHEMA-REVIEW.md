# Schema review (Prompt 2) — `sql/schema.sql`, 2026-09-22

*Reviewed before the schema was applied to the empty Silvis project (`bzhsroegtagqhutbnsrp`, zero public tables at the
time). Findings marked **applied** were written into `sql/schema.sql` in the same commit and applied through the
Supabase CLI's linked Management-API path (`supabase db query --linked -f sql/schema.sql`), so no live data was at risk.
Verification: `scripts/verify-rls.sh`.*

**Live and `sql/schema.sql` agree again since the 9/23 `feat/offers` merge (audit RLS-2 closed):** `claim_open_slot` and `call_offers_guard` are mirrored from `sql/migrations/2026-09-23-claim-offer.sql` (applied 2026-09-23 07:05Z) and `call_periods` / `call_offers` / `offer_status()` / the `OF001`-`OF003` guards / `offer_modes` from the 9/22 and 9/23 migrations; `test/schema.test.js` compares every migrated body against the newest migration touching it, so the file is re-runnable wholesale again. The only bodies in the repo that are NOT live yet are `set_offer_mode()` / `save_offers()` (`sql/migrations/2026-09-23-offer-mode-rpc.sql`, the orchestrator's next step - subsection below).

## (a) Tables, one line each

| Table | Purpose |
|---|---|
| `user_profiles` | Auth user → roster id + role (`admin`/`scheduler`/`surgeon`/`viewer`); the only place a surgeon's email exists besides `office_contacts`. Authenticated-read. |
| `call_schedule_data` | One row `main`: roster (names/codes), `surgeonRules`, `groupRules`, holiday units, settings blob. Anon-read. |
| `schedule_days` | The schedule, one row per day: `primary_id`, `backup_id`, per-role locks, `source`, `external_cover`, `note`, `version` (compare-and-swap on publish). Anon-read. |
| `time_off` | Vacations only, self-entered, no approval; a trigger refuses a range over a day the surgeon is published (and the day before, for primary). Anon-read. |
| `availability` | Dated availability statements by kind/role (windows, whitelists, backup-only, no-backup…). Anon-read. |
| `east_feed` | Cached Davenport `schedule_weeks` rows by week Monday. Anon-read. |
| `east_overrides` | Manual per-day corrections to the East feed (`busy` true/false). Anon-read. |
| `east_forecast` | East forecast rows (`scripts/east-forecast.js --sql`), one per week Monday, kept out of `east_feed` so a forecast can never read as a published Davenport row. Anon-read. Added to `schema.sql` and applied to the live DB 2026-09-22 (14 forecast-week rows observed 2026-09-23). |
| `shift_trade_requests` | Trades by day + role with an optional return leg and a status lifecycle. Authenticated. |
| `notifications` | In-app notification feed (recipients ride in `data`). Authenticated. |
| `notification_preferences` | Per-person email toggles and reminder hour. Own row + scheduler. |
| `audit_log` | Who did what; insert by any authenticated user, read by scheduler/admin. Actions are dotted names written by the client (`schedule.publish`, `schedule.day_edit`, `trade.propose`, `openshifts.notify` for the open-shifts notice, ...) or by a SQL function in the same transaction as its write (`trade.apply` from `apply_trade`, `schedule.claim` from `claim_open_slot`). |
| `call_schedule_snapshots` | Restore points captured before destructive actions and once per session. Scheduler/admin. |
| `client_versions` | Row `main` = minimum version + banner message for the refresh check; other rows = per-client heartbeats. |
| `office_contacts` | Office recipients of publish/change digests (the ER-panel author). Authenticated-read, scheduler-write. |
| `call_offers` | Offers: one row per person and day (`role_pref` primary / backup / either, operational `note`, `entered_by`, `source` app / email-relay / import); triggers refuse a past day (`OF001`), a day inside the person's vacation (`OF002`) and non-scheduler writes inside a frozen period (`OF003`). Authenticated. Added 2026-09-22 (Prompt 14 part 1; block below). |
| `call_periods` | Periods: generation windows with `offers_close_at` / `publish_by` / `status` / `rules_only_ids` / `offer_modes` (`{person_id: 'exhaustive' \| 'preferred'}`, absent = preferred; column from `sql/migrations/2026-09-23-offer-modes.sql`, applied live 2026-09-23 07:05Z - see the offer_modes subsection below). Authenticated read, scheduler write. |
| `east_vacation_reviews` | Prompt 15 part 2 (2026-09-23, **applied live 2026-09-23 04:37 — see the section at the end**): one row per reviewed Davenport vacation range of a surgeon with an East code — `person_id`, `"start"`, `"end"`, `decision` (`away` \| `home`), `decided_at`, `decided_by`. Dates and a decision only. Authenticated-read, own-rows or scheduler write. The ranges themselves stay in the `east_feed` payload. |

Helper functions: `silvis_role()`, `silvis_person_id()`, `silvis_is_sched()` — `security definer`, `stable`, `search_path = public`.

## (b) RLS policies — who can read / write

| Table | Read | Write |
|---|---|---|
| `call_schedule_data`, `schedule_days`, `availability`, `east_feed`, `east_forecast` | anyone (anon) | scheduler/admin (all verbs) |
| `client_versions` | anon: row `main` only; authenticated: all rows | scheduler/admin all rows; each authenticated user may insert/update **their own** heartbeat row (`id = auth.uid()`) |
| `time_off` | anyone (anon) | insert/update/delete: the surgeon named in the row (`person_id = silvis_person_id()`) or scheduler/admin |
| `east_overrides` | anyone (anon) | scheduler/admin |
| `user_profiles` | authenticated | self-insert as `viewer` with **no `person_id`**; self-update may not change `role` or `person_id`; admin: everything |
| `shift_trade_requests` | authenticated | insert: proposer or scheduler; update: parties + scheduler, and a trigger restricts non-schedulers to status moves on a pending trade (counter-party → accepted/declined, proposer → cancelled) |
| `notifications` | authenticated | insert: any authenticated user |
| `notification_preferences` | own row or scheduler | own row or scheduler |
| `audit_log` | scheduler/admin | insert: any authenticated user |
| `call_schedule_snapshots` | scheduler/admin | scheduler/admin |
| `office_contacts` | authenticated | scheduler/admin |
| `call_offers` | authenticated | insert/update/delete: the surgeon named in the row (`person_id = silvis_person_id()`) or scheduler/admin; never anon (deliberately absent from the anon `read_all` loop) |
| `call_periods` | authenticated | scheduler/admin (all verbs); never anon |
| `east_vacation_reviews` (applied 2026-09-23) | authenticated (**no anon policy** — an anon read is a silent `200 + []`) | insert/update/delete: the surgeon named in the row (`person_id = silvis_person_id()`) or scheduler/admin |

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

*Answers REVIEW-2026-09-22 section 3 D. Report-first: the definitions live in `sql/schema.sql` and, byte-identically,
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
trigger texts pinned identical). Design: `docs/PROMPT-14-OFFER-PERIODS.md` part 1 and `docs/SILVIS-BUILD-GUIDE.md` section 17.*

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

Not applied as of 2026-09-23 (the painter's Save answers `404` `PGRST202` "Could not find the function
public.save_offers" until it is). Apply and prove (workdir = a directory linked with
`supabase link --project-ref bzhsroegtagqhutbnsrp`; absolute paths):

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
own probe and pin update. Faraz picks; until then the residual stands as accepted.

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

**Status: NOT yet applied** - the orchestrator applies after Faraz's go (report-first, guide section 4.3). Review 2026-09-23
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

observed: (placeholder - the orchestrator fills in the apply time, the before / after `PROBE_RESULTS` lines for E2 / N / B2 and the leftover counts)
