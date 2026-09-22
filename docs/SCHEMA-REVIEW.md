# Schema review (Prompt 2) — `sql/schema.sql`, 2026-09-22

*Reviewed before the schema was applied to the empty Silvis project (`bzhsroegtagqhutbnsrp`, zero public tables at the
time). Findings marked **applied** were written into `sql/schema.sql` in the same commit and applied through the
Supabase CLI's linked Management-API path (`supabase db query --linked -f sql/schema.sql`), so no live data was at risk.
Verification: `scripts/verify-rls.sh`.*

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
| `east_forecast` | East forecast rows (`scripts/east-forecast.js --sql`), one per week Monday, kept out of `east_feed` so a forecast can never read as a published Davenport row. Anon-read. Added to `schema.sql` 2026-09-22; **not yet applied to the live DB** (additive; apply by hand). |
| `shift_trade_requests` | Trades by day + role with an optional return leg and a status lifecycle. Authenticated. |
| `notifications` | In-app notification feed (recipients ride in `data`). Authenticated. |
| `notification_preferences` | Per-person email toggles and reminder hour. Own row + scheduler. |
| `audit_log` | Who did what; insert by any authenticated user, read by scheduler/admin. Actions are dotted names written by the client (`schedule.publish`, `schedule.day_edit`, `trade.propose`, `openshifts.notify` for the open-shifts notice, ...) or by a SQL function in the same transaction as its write (`trade.apply` from `apply_trade`, `schedule.claim` from `claim_open_slot`). |
| `call_schedule_snapshots` | Restore points captured before destructive actions and once per session. Scheduler/admin. |
| `client_versions` | Row `main` = minimum version + banner message for the refresh check; other rows = per-client heartbeats. |
| `office_contacts` | Office recipients of publish/change digests (the ER-panel author). Authenticated-read, scheduler-write. |

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
