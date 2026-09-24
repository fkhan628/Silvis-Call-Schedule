-- ============================================================================
-- Silvis Call Schedule - migration 2026-09-24: definer locks + roster names (Prompt 16 B6; review 2026-09-23
-- section 3, security minors). Three functions, create or replace, idempotent; the trade_insert_guard trigger is
-- dropped and re-created; the two RPC revoke / grant pairs are re-run. No table, policy or row is touched.
--
-- (1) apply_trade() and claim_open_slot() take `lock table public.time_off in share mode` BEFORE the schedule_days row
--     locks and before the vacation checks ((b) / CL009). The race it closes: a vacation of the receiver (the claimer)
--     written - inserted or edited onto the day - while the trade or claim is decided. The time_off BEFORE trigger
--     reads schedule_days without locking, so under read committed both checks could pass (write skew) and the surgeon
--     ended up on call inside a vacation. Every INSERT / UPDATE / DELETE on time_off holds ROW EXCLUSIVE on the
--     relation from statement start (before its trigger runs), and ROW EXCLUSIVE conflicts with SHARE: the vacation
--     write waits until this transaction commits and its trigger then runs against the committed swap
--     (ON_CALL_CONFLICT); in the other order this function waits until the vacation commits and its own check - a
--     fresh snapshot per statement - sees the new or moved range (TRADE_INELIGIBLE / CL009). A row-level FOR SHARE
--     would cover only rows that already exist (no predicate locks under read committed), i.e. the rare EDIT and not
--     the common INSERT (the app's toAdd); the table lock covers both sides, so no trigger-side change is needed.
--     Why it cannot deadlock: a time_off writer holds its table + tuple locks and reads schedule_days with ACCESS SHARE
--     only (no function in this schema writes time_off), so it never waits on anything these functions hold; these
--     functions take the time_off lock BEFORE any day row; SHARE is not self-conflicting, so concurrent applies /
--     claims do not serialise on it; every reader (the app, save_offers, the guards) holds ACCESS SHARE, compatible
--     with SHARE. The lock runs as the table owner (security definer, owner postgres), so the privilege check passes;
--     it is held for the rest of the RPC's transaction - milliseconds. Cost: a vacation save that lands during an
--     apply / claim waits those milliseconds, then its own trigger decides; autovacuum on time_off (SHARE UPDATE
--     EXCLUSIVE) yields to it like to any conflicting lock request.
--     Lock order, apply_trade:      trade row (update) -> time_off table (share) -> day rows (update)
--     Lock order, claim_open_slot:  time_off table (share) -> the day row (update)
--     A relation lock is visible in pg_locks (mode ShareLock, this backend's pid, granted); the probes read it there
--     after a case whose subtransaction committed (a lock taken inside an aborted block is released at its rollback).
-- (2) trade_insert_guard() writes from_surgeon_name / to_surgeon_name from the roster (call_schedule_data 'main' ->
--     roster[] -> name by id) for EVERY insert - scheduler, server-side roles and members alike - instead of storing
--     the client's strings in an authenticated-read table; an id the roster does not know (or a missing / malformed
--     roster) reads as the id itself, never a refusal (the names are display data; apply_trade keeps its own
--     fail-closed roster check). The lookup runs AFTER from_surgeon_id is normalised, so the name follows the final id.
--     Residual (outside B6's three functions): trade_update_guard does not pin from_surgeon_name / to_surgeon_name, so
--     a party's status PATCH (accept / decline / cancel) may still rewrite the stored strings. The client no longer
--     renders them - index-source.html tradeNamed resolves both names from the roster by id, unconditionally - and the
--     one-liner for that trigger is queued in docs/SCHEMA-REVIEW.md (section 2026-09-24) for whoever owns it.
-- (3) the vacation NOTE denylist is client-side only (index-source.html: toAdd refuses, the backup-restore applier
--     applyTablesUpsert blanks the note and counts it; the roster note's SU_NOTE_DENYLIST): no note column has a
--     server-side denylist trigger today, so none is added here for time_off.note.
--
-- Apply live with the Supabase CLI (absolute path), after 2026-09-23-trade-past-guard.sql (applied 9/23 ~16:00 UTC):
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-24-definer-locks.sql
-- Observe it with sql/probes/trade-guards-probe.sql (cases E2 and N are the new ones) and
-- sql/probes/claim-open-slot-probe.sql (case B2) before and after - both roll themselves back; scripts/verify-rls.sh
-- sections 5 and 7 grade them. Expected: trade E2 share_locks=0 -> share_locks=1 (pg_locks, read after E committed its
-- subtransaction); claim B2 share_locks=0 -> share_locks=1 (after B); N from_name=Mallory to_name=Eve ->
-- from_name=Burchett to_name=Acton; every other case unchanged. The definitions below are
-- byte-identical to sql/schema.sql (test/schema.test.js pins that, and freezes the superseded 9/22 trade_insert_guard,
-- 9/23 trade-past apply_trade and 9/23 claim-offer claim_open_slot bodies by sha256).
-- Report-first (guide section 4.3): replaces three live functions, re-creates one trigger; no row changes. Blast
-- radius: a new trade proposal stores roster names (the client already sends the same names; existing rows keep
-- theirs); a trade apply or a claim holds SHARE on time_off for the rest of its transaction (a vacation save landing in
-- that window waits milliseconds, then its own trigger decides). Pre-check (nothing to migrate):
--   select count(*) from public.shift_trade_requests where status in ('pending', 'accepted');
-- ============================================================================

-- ---------- trade INSERT guard (2026-09-22, Prompt 12 D.1)
-- Runs BEFORE INSERT for every caller. Non-schedulers cannot choose the lifecycle fields:
-- the row lands as 'pending', from the caller's own roster id, stamped now, undecided. A
-- scheduler (or a server-side role: the CLI's postgres, service_role) may record a trade
-- as given, e.g. an already-accepted trade agreed by phone. A trade always needs two
-- different surgeons. The trigger fires before RLS's WITH CHECK, so the normalised row is
-- what trade_insert (from_surgeon_id = silvis_person_id() or scheduler) evaluates.
-- The server-side bypass (auth.uid() is null AND current_user in postgres / supabase_admin /
-- service_role) is a standing exception: PostgREST always runs as anon/authenticated, so no client
-- path reaches it, but any future SECURITY DEFINER function owned by postgres that inserts a trade
-- row would inherit it silently. Keep trade inserts out of security-definer code (or re-check
-- silvis_is_sched() there). test/schema.test.js pins the exact role list.
-- 2026-09-24 (Prompt 16 B6, review 9/23 section 3): from_surgeon_name / to_surgeon_name are written from the roster
-- (call_schedule_data 'main' -> roster[] -> name by id) for EVERY insert, after the id normalisation, instead of storing
-- the client's strings; an unknown id or a missing roster reads as the id (display data, never a refusal).
create or replace function public.trade_insert_guard() returns trigger
language plpgsql as $$
declare
  me     text    := public.silvis_person_id();
  server boolean := auth.uid() is null and current_user in ('postgres', 'supabase_admin', 'service_role');
  roster jsonb;
begin
  if not (public.silvis_is_sched() or server) then
    if me is null then
      raise exception 'TRADE_FORBIDDEN: your account is not linked to a roster entry' using errcode = 'P0001';
    end if;
    new.from_surgeon_id := me;
    new.status          := 'pending';
    new.submitted_at    := now();
    new.decided_at      := null;
  end if;
  if new.from_surgeon_id = new.to_surgeon_id then
    raise exception 'TRADE_INELIGIBLE: a trade needs two different surgeons' using errcode = 'P0001';
  end if;
  -- (2026-09-24, Prompt 16 B6) the display names come from the roster, never from the client: call_schedule_data 'main'
  -- -> roster[] -> name (last name) by id, looked up AFTER from_surgeon_id is final. An id the roster does not know, or a
  -- missing / malformed roster, reads as the id itself - a name is display data, never a reason to refuse the insert.
  select d.data -> 'roster' into roster from public.call_schedule_data d where d.id = 'main';
  if roster is null or jsonb_typeof(roster) <> 'array' then roster := '[]'::jsonb; end if;
  new.from_surgeon_name := coalesce(nullif((select r ->> 'name' from jsonb_array_elements(roster) r where r ->> 'id' = new.from_surgeon_id limit 1), ''), new.from_surgeon_id);
  new.to_surgeon_name   := coalesce(nullif((select r ->> 'name' from jsonb_array_elements(roster) r where r ->> 'id' = new.to_surgeon_id limit 1), ''), new.to_surgeon_id);
  return new;
end $$;
drop trigger if exists trade_insert_guard_trg on public.shift_trade_requests;
create trigger trade_insert_guard_trg
  before insert on public.shift_trade_requests
  for each row execute function public.trade_insert_guard();

-- Apply an ACCEPTED trade atomically. Members cannot write schedule_days (scheduler-only RLS), so the
-- swap runs here as security definer with explicit checks: caller must be a party or the scheduler;
-- the trade must be 'accepted'; each leg must still be held by the expected surgeon (stale -> error);
-- both days get version+1 and source 'trade'; the trade becomes 'applied'; an audit row is written.
-- The distinct-roles check constraint still applies (a swap that would double-book a day fails loudly).
-- 2026-09-22 (Prompt 12 D.2): before ANY write, each leg's RECEIVER (leg 1 = to_surgeon_id, return
-- leg = from_surgeon_id) is checked, in this order, and TRADE_INELIGIBLE is raised with a plain reason:
--   (a) the roster in call_schedule_data 'main' is present (fail closed) and the receiver is an
--       ACTIVE roster entry (pool or external - any active entry counts; like the client, an entry
--       with no `active` key is active: coalesce(active, 'true') <> 'false');
--   (b) the leg's day is not inside a time_off range of the receiver (and, for a PRIMARY leg, is not
--       the day before one: the 07:00 shift end falls on the vacation day, the same rule the
--       time_off trigger enforces from the other side). Like that trigger, the SQL side hardcodes
--       PRIMARY here; the client reads groupRules.dayBeforeRules.trailingEdgeRoles (default primary);
--   (c) the leg's role is not locked on that day unless the caller is the scheduler; the transfer
--       clears the transferred role's lock flag (a traded slot is no longer the locked import);
--   (d) the receiver does not already hold the OTHER role that day. Evaluated per leg against the
--       pre-swap row, so a same-day role SWAP (A's primary for B's backup on one day) is refused as
--       'already holds' - before this change the same case tripped schedule_days_distinct_roles and
--       the client refuses it too; it is not a supported trade shape.
-- The app shows these messages verbatim, so they read as sentences.
-- 2026-09-23 (audit RLS-6): right after the 'accepted' check and before the first row lock, a caller
-- who is not the scheduler is refused with TRADE_PAST when the day or the return day is before today
-- in America/Chicago (strict <, like claim_open_slot's CL003) - past days are the scheduler's to change.
-- 2026-09-24 (Prompt 16 B6, review 9/23 section 3): right after the TRADE_PAST refusal and BEFORE the day rows are
-- locked, the function takes `lock table public.time_off in share mode`. The race it closes: a vacation of a receiver
-- inserted or edited onto the day while the trade is applied - the time_off BEFORE trigger reads schedule_days without
-- locking, so under read committed both checks could pass (write skew). Every time_off writer holds ROW EXCLUSIVE on
-- the relation from statement start (before its trigger runs), and ROW EXCLUSIVE conflicts with SHARE: the vacation
-- write waits for this transaction and its trigger then sees the swap (ON_CALL_CONFLICT); in the other order this
-- function waits for the vacation and check (b), a fresh snapshot per statement, sees the new or moved range. A
-- row-level FOR SHARE would miss a row inserted concurrently (no predicate locks under read committed); the table lock
-- covers both sides. No cycle: a time_off writer never waits on a trade row or a day row (its trigger only READS
-- schedule_days; no function in this schema writes time_off), this function takes the time_off lock before any day
-- row, SHARE is not self-conflicting (concurrent applies do not serialise) and every reader holds ACCESS SHARE. The
-- lock runs as the table owner (security definer) and is held for the rest of the RPC's transaction - milliseconds.
-- Lock order: trade row (update) -> time_off table (share) -> day rows (update).
create or replace function public.apply_trade(p_trade_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t        public.shift_trade_requests%rowtype;
  d1       public.schedule_days%rowtype;
  d2       public.schedule_days%rowtype;
  me       text    := public.silvis_person_id();
  sched    boolean := public.silvis_is_sched();
  today_c  date    := (now() at time zone 'America/Chicago')::date;
  holder   text;
  roster   jsonb;
  to_name  text;
  fr_name  text;
begin
  select * into t from public.shift_trade_requests where id = p_trade_id for update;
  if not found then raise exception 'TRADE_NOT_FOUND' using errcode = 'P0001'; end if;
  if not (sched or me = t.from_surgeon_id or me = t.to_surgeon_id) then
    raise exception 'TRADE_FORBIDDEN: only a party or the scheduler may apply this trade' using errcode = 'P0001';
  end if;
  if t.status <> 'accepted' then
    raise exception 'TRADE_NOT_ACCEPTED: status is %', t.status using errcode = 'P0001';
  end if;
  -- (2026-09-23, audit RLS-6) a past day is the scheduler's to change: a member may not rewrite history
  if not sched and (t.day < today_c or (t.return_day is not null and t.return_day < today_c)) then
    raise exception 'TRADE_PAST: % is before today (%) in Central time; past days are changed by the scheduler only',
      case when t.day < today_c then t.day else t.return_day end, today_c using errcode = 'P0001';
  end if;
  -- (2026-09-24, Prompt 16 B6) SHARE on time_off before the day rows are locked and before the vacation check (b): a
  -- vacation of either receiver inserted or edited concurrently waits for this transaction (its trigger then sees the
  -- swap), or this function waits and (b) sees it - see the header. Lock order: trade row (update) -> time_off table
  -- (share) -> day rows (update).
  lock table public.time_off in share mode;
  select * into d1 from public.schedule_days where day = t.day for update;
  holder := case when t.role = 'primary' then d1.primary_id else d1.backup_id end;
  if not found or holder is distinct from t.from_surgeon_id then
    raise exception 'TRADE_STALE: % % is no longer held by %', t.day, t.role, t.from_surgeon_id using errcode = 'P0001';
  end if;
  if t.return_day is not null then
    select * into d2 from public.schedule_days where day = t.return_day for update;
    holder := case when t.return_role = 'primary' then d2.primary_id else d2.backup_id end;
    if not found or holder is distinct from t.to_surgeon_id then
      raise exception 'TRADE_STALE: % % is no longer held by %', t.return_day, t.return_role, t.to_surgeon_id using errcode = 'P0001';
    end if;
  end if;
  -- (a) roster present (fail closed) + each receiver is an ACTIVE roster entry
  select d.data -> 'roster' into roster from public.call_schedule_data d where d.id = 'main';
  if roster is null or jsonb_typeof(roster) <> 'array' or jsonb_array_length(roster) = 0 then
    raise exception 'TRADE_INELIGIBLE: roster unavailable' using errcode = 'P0001';
  end if;
  if not exists (select 1 from jsonb_array_elements(roster) r where r ->> 'id' = t.to_surgeon_id and coalesce(r ->> 'active', 'true') <> 'false') then
    raise exception 'TRADE_INELIGIBLE: % is not an active roster surgeon', t.to_surgeon_id using errcode = 'P0001';
  end if;
  if t.return_day is not null
     and not exists (select 1 from jsonb_array_elements(roster) r where r ->> 'id' = t.from_surgeon_id and coalesce(r ->> 'active', 'true') <> 'false') then
    raise exception 'TRADE_INELIGIBLE: % is not an active roster surgeon', t.from_surgeon_id using errcode = 'P0001';
  end if;
  to_name := coalesce((select r ->> 'name' from jsonb_array_elements(roster) r where r ->> 'id' = t.to_surgeon_id limit 1), t.to_surgeon_id);
  fr_name := coalesce((select r ->> 'name' from jsonb_array_elements(roster) r where r ->> 'id' = t.from_surgeon_id limit 1), t.from_surgeon_id);
  -- (b) neither receiver has a vacation over the day they would take (primary: nor the day before one)
  if exists (select 1 from public.time_off v where v.person_id = t.to_surgeon_id and t.day between v.start_date and v.end_date) then
    raise exception 'TRADE_INELIGIBLE: % is on vacation on %', to_name, t.day using errcode = 'P0001';
  end if;
  if t.role = 'primary' and exists (select 1 from public.time_off v where v.person_id = t.to_surgeon_id and v.start_date = t.day + 1) then
    raise exception 'TRADE_INELIGIBLE: % starts a vacation on % (primary the day before is blocked)', to_name, t.day + 1 using errcode = 'P0001';
  end if;
  if t.return_day is not null then
    if exists (select 1 from public.time_off v where v.person_id = t.from_surgeon_id and t.return_day between v.start_date and v.end_date) then
      raise exception 'TRADE_INELIGIBLE: % is on vacation on %', fr_name, t.return_day using errcode = 'P0001';
    end if;
    if t.return_role = 'primary' and exists (select 1 from public.time_off v where v.person_id = t.from_surgeon_id and v.start_date = t.return_day + 1) then
      raise exception 'TRADE_INELIGIBLE: % starts a vacation on % (primary the day before is blocked)', fr_name, t.return_day + 1 using errcode = 'P0001';
    end if;
  end if;
  -- (c) locked slots move only when the scheduler applies (the transfer below clears the lock)
  if not sched then
    if (t.role = 'primary' and d1.primary_locked) or (t.role = 'backup' and d1.backup_locked) then
      raise exception 'TRADE_INELIGIBLE: % % is locked; ask the scheduler', t.day, t.role using errcode = 'P0001';
    end if;
    if t.return_day is not null and ((t.return_role = 'primary' and d2.primary_locked) or (t.return_role = 'backup' and d2.backup_locked)) then
      raise exception 'TRADE_INELIGIBLE: % % is locked; ask the scheduler', t.return_day, t.return_role using errcode = 'P0001';
    end if;
  end if;
  -- (d) the receiver must not already hold the other role that day
  if (t.role = 'primary' and d1.backup_id = t.to_surgeon_id) or (t.role = 'backup' and d1.primary_id = t.to_surgeon_id) then
    raise exception 'TRADE_INELIGIBLE: % already holds % on %', to_name, case when t.role = 'primary' then 'backup' else 'primary' end, t.day using errcode = 'P0001';
  end if;
  if t.return_day is not null
     and ((t.return_role = 'primary' and d2.backup_id = t.from_surgeon_id) or (t.return_role = 'backup' and d2.primary_id = t.from_surgeon_id)) then
    raise exception 'TRADE_INELIGIBLE: % already holds % on %', fr_name, case when t.return_role = 'primary' then 'backup' else 'primary' end, t.return_day using errcode = 'P0001';
  end if;
  -- writes
  if t.role = 'primary' then
    update public.schedule_days set primary_id = t.to_surgeon_id, primary_locked = false, version = version + 1, source = 'trade', updated_by = coalesce(me, 'scheduler'), updated_at = now() where day = t.day;
  else
    update public.schedule_days set backup_id = t.to_surgeon_id, backup_locked = false, version = version + 1, source = 'trade', updated_by = coalesce(me, 'scheduler'), updated_at = now() where day = t.day;
  end if;
  if t.return_day is not null then
    if t.return_role = 'primary' then
      update public.schedule_days set primary_id = t.from_surgeon_id, primary_locked = false, version = version + 1, source = 'trade', updated_by = coalesce(me, 'scheduler'), updated_at = now() where day = t.return_day;
    else
      update public.schedule_days set backup_id = t.from_surgeon_id, backup_locked = false, version = version + 1, source = 'trade', updated_by = coalesce(me, 'scheduler'), updated_at = now() where day = t.return_day;
    end if;
  end if;
  perform set_config('silvis.apply_trade', '1', true);
  update public.shift_trade_requests set status = 'applied', decided_at = coalesce(decided_at, now()) where id = p_trade_id;
  perform set_config('silvis.apply_trade', '0', true);
  insert into public.audit_log (actor_id, action, detail)
  values (me, 'trade.apply', jsonb_build_object('trade_id', p_trade_id, 'day', t.day, 'role', t.role, 'return_day', t.return_day, 'return_role', t.return_role, 'from', t.from_surgeon_id, 'to', t.to_surgeon_id));
  return jsonb_build_object('ok', true, 'trade_id', p_trade_id, 'day', t.day, 'role', t.role, 'return_day', t.return_day, 'return_role', t.return_role);
end $$;
revoke all on function public.apply_trade(uuid) from public, anon;
grant execute on function public.apply_trade(uuid) to authenticated;

-- ============================================================================
-- claim_open_slot(p_day, p_role) - a linked surgeon takes an OPEN slot (2026-09-22, Prompt 13
-- part 2; applied live through sql/migrations/2026-09-22-claim-open-slot.sql, never by a git push)
--
-- A linked surgeon takes an OPEN slot from the Open shifts board. Modelled on
-- apply_trade(): security definer (members cannot write schedule_days under
-- RLS), explicit checks before the first write, version + 1 so every other
-- client's compare-and-swap sees the change, an audit row and an in-app feed
-- row in the SAME transaction (an error rolls all of it back).
--
-- What it guards: data integrity only - open, unlocked, not past (Central),
-- not external-covered, inside the published range, distinct roles, no
-- vacation conflict (incl. the day before a PRIMARY shift, mirroring the
-- time_off trigger). The JS eligibility rules (OR days, Clinton days, caps,
-- weekday patterns, consecutive runs) are enforced in the client before the
-- "Take this shift" button is offered, not here - the accepted boundary for a
-- six-surgeon group; everything the function does is logged.
--
-- Errors: each refusal has its own SQLSTATE (class CL, custom) and a plain
-- message prefixed with a stable token; PostgREST returns both and the app
-- shows the message verbatim.
--   CL001 CLAIM_NOT_LINKED      caller has no roster link (or is anon)
--   CL002 CLAIM_BAD_ROLE        role not in (primary, backup)
--   CL003 CLAIM_PAST            day is before today in America/Chicago
--   CL004 CLAIM_OUTSIDE_RANGE   day outside [min(day), max(day)] of schedule_days
--   CL005 CLAIM_HELD            slot already held
--   CL006 CLAIM_EXTERNAL        primary requested while external_cover is set
--   CL007 CLAIM_LOCKED          slot is locked (scheduler assigns from the editor)
--   CL008 CLAIM_OTHER_ROLE      caller already holds the other role that day
--   CL009 CLAIM_VACATION        a time_off row of the caller overlaps the day
--                               (or the next day when p_role = 'primary')
--
-- 2026-09-24 (Prompt 16 B6, review 9/23 section 3): after the four row-less refusals (CL001-CL004) and BEFORE the
-- day row is locked, the function takes `lock table public.time_off in share mode`, so a vacation of the caller
-- inserted or edited onto the day while the claim runs waits for this transaction (its trigger then sees the claim),
-- or the claim waits and CL009 sees the new row - the same write skew apply_trade() closes, same reasoning (every
-- time_off writer holds ROW EXCLUSIVE, which conflicts with SHARE), same deadlock argument (see apply_trade's header).
-- Lock order: time_off table (share) -> the day row (update).
-- ============================================================================
create or replace function public.claim_open_slot(p_day date, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me        text := public.silvis_person_id();
  today_c   date := (now() at time zone 'America/Chicago')::date;
  d         public.schedule_days%rowtype;
  lo        date;
  hi        date;
  other     text;
  held      text;
  is_locked boolean;
  my_name   text;
  vac       text;
  new_ver   integer;
  wrote_offer boolean := false;   -- P2 review: false for a rules_only claimer (no call_offers row)
begin
  if auth.uid() is null or me is null then
    raise exception 'CLAIM_NOT_LINKED: sign in with an account that is linked to a roster entry to take a shift' using errcode = 'CL001';
  end if;
  if p_role is null or p_role not in ('primary', 'backup') then
    raise exception 'CLAIM_BAD_ROLE: role must be primary or backup (got %)', coalesce(p_role, 'null') using errcode = 'CL002';
  end if;
  if p_day is null or p_day < today_c then
    raise exception 'CLAIM_PAST: % is before today (%) in Central time; past days are not open', p_day, today_c using errcode = 'CL003';
  end if;

  -- The published range = every day between the first and the last schedule_days row.
  select min(day), max(day) into lo, hi from public.schedule_days;
  if lo is null or p_day < lo or p_day > hi then
    raise exception 'CLAIM_OUTSIDE_RANGE: % is outside the published schedule (% to %)', p_day, coalesce(lo::text, '-'), coalesce(hi::text, '-') using errcode = 'CL004';
  end if;

  -- (2026-09-24, Prompt 16 B6) SHARE on time_off before the day row is locked and before the vacation check (CL009): a
  -- vacation of the caller inserted or edited concurrently waits for this transaction, or this function waits and CL009
  -- sees it - see the header. Lock order: time_off table (share) -> the day row (update).
  lock table public.time_off in share mode;

  -- Lock the day's row; a day inside the range with no row gets one (source 'claim').
  select * into d from public.schedule_days where day = p_day for update;
  if not found then
    insert into public.schedule_days (day, source, version, updated_by, updated_at)
      values (p_day, 'claim', 1, me, now())
      on conflict (day) do nothing;
    select * into d from public.schedule_days where day = p_day for update;
  end if;

  other     := case when p_role = 'primary' then 'backup' else 'primary' end;
  held      := case when p_role = 'primary' then d.primary_id else d.backup_id end;
  is_locked := case when p_role = 'primary' then d.primary_locked else d.backup_locked end;

  if held is not null then
    raise exception 'CLAIM_HELD: % % is already held by %', p_day, p_role, held using errcode = 'CL005';
  end if;
  if p_role = 'primary' and coalesce(d.external_cover, '') <> '' then
    raise exception 'CLAIM_EXTERNAL: % primary is covered by % (outside the roster)', p_day, d.external_cover using errcode = 'CL006';
  end if;
  if is_locked then
    raise exception 'CLAIM_LOCKED: % % is locked; ask the scheduler to assign it', p_day, p_role using errcode = 'CL007';
  end if;
  if (case when p_role = 'primary' then d.backup_id else d.primary_id end) = me then
    raise exception 'CLAIM_OTHER_ROLE: you already hold % on %', other, p_day using errcode = 'CL008';
  end if;

  -- Vacation conflict: the day itself, plus the next day for a PRIMARY shift
  -- (the 07:00 shift end falls on the vacation day - same rule the time_off
  -- trigger enforces in the other direction).
  select string_agg(to_char(start_date, 'FMMM/FMDD') || '-' || to_char(end_date, 'FMMM/FMDD'), ', ' order by start_date)
    into vac
    from public.time_off
   where person_id = me
     and start_date <= (case when p_role = 'primary' then p_day + 1 else p_day end)
     and end_date   >= p_day;
  if vac is not null then
    raise exception 'CLAIM_VACATION: your vacation % conflicts with % % (a primary shift also blocks the day before a vacation)', vac, p_day, p_role using errcode = 'CL009';
  end if;

  -- The write. version + 1 makes every other client's compare-and-swap on this day fail loudly and reload.
  if p_role = 'primary' then
    update public.schedule_days
       set primary_id = me, version = version + 1, source = 'claim', updated_by = me, updated_at = now()
     where day = p_day
     returning version into new_ver;
  else
    update public.schedule_days
       set backup_id = me, version = version + 1, source = 'claim', updated_by = me, updated_at = now()
     where day = p_day
     returning version into new_ver;
  end if;

  -- Prompt 14 P2 (9/23): a claim is an offer made on the spot - the record stays honest. One row per person and
  -- day: the claimed role, entered by the claimer, source 'app', no note. An existing offer in the same role is
  -- left as it was; one in the other role becomes 'either'. The freeze guard (OFFER_FROZEN) is bypassed for this
  -- transaction-local write only - the period closed before the schedule was published; CLAIM_PAST and
  -- CLAIM_VACATION above already enforce what OF001 / OF002 would.
  -- Review 9/23: NOT for a claimer listed in rules_only_ids of the period containing the day - one offer row
  -- would make offer_status() read 'submitted' for his whole period (see the header). Outside every period the
  -- row is written like any other offer (it is then a plain dated availability row for the engine).
  if not exists (select 1 from public.call_periods p where p_day between p.start_day and p.end_day and p.rules_only_ids ? me) then
    perform set_config('silvis.claim_in_progress', 'on', true);
    insert into public.call_offers (person_id, day, role_pref, note, entered_by, source)
    values (me, p_day, p_role, null, me, 'app')
    on conflict (person_id, day) do update
       set role_pref  = case when public.call_offers.role_pref = excluded.role_pref then public.call_offers.role_pref else 'either' end,
           updated_at = now();
    perform set_config('silvis.claim_in_progress', '', true);
    wrote_offer := true;
  end if;

  -- Display name from the roster blob (last name); falls back to the id.
  select r->>'name' into my_name
    from public.call_schedule_data c, jsonb_array_elements(coalesce(c.data->'roster', '[]'::jsonb)) r
   where c.id = 'main' and r->>'id' = me
   limit 1;
  my_name := coalesce(nullif(my_name, ''), me);

  insert into public.audit_log (actor_id, actor_name, action, detail)
  values (me, my_name, 'schedule.claim', jsonb_build_object('day', p_day, 'role', p_role, 'person', me, 'version', new_ver, 'offer', wrote_offer));

  -- In-app feed row: the claimer sees it through data.surgeon_id, the scheduler sees everything.
  insert into public.notifications (type, title, message, data)
  values ('shift_claimed',
          my_name || ' took ' || to_char(p_day, 'FMMM/FMDD') || ' ' || p_role,
          my_name || ' took the open ' || p_role || ' shift on ' || to_char(p_day, 'Dy FMMM/FMDD') || ' (07:00 to 07:00).',
          jsonb_build_object('day', p_day, 'role', p_role, 'surgeon_id', me, 'person_id', me));

  return jsonb_build_object('ok', true, 'day', p_day, 'role', p_role, 'person_id', me, 'version', new_ver);
end $$;

revoke all on function public.claim_open_slot(date, text) from public, anon;
grant execute on function public.claim_open_slot(date, text) to authenticated;
