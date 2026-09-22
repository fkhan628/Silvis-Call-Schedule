-- ============================================================================
-- Silvis Call Schedule - migration 2026-09-22: server-side trade guards (Prompt 12 D)
-- Answers REVIEW-2026-09-22 section 3 D: a signed-in surgeon could INSERT a trade with
-- status 'accepted' naming any counterparty and call apply_trade(); apply_trade() checked
-- no roster / vacation / lock / double-role eligibility.
--
-- Idempotent and self-contained: create-or-replace the two functions, drop/create the
-- trigger, re-run the revoke/grant. Apply live with the Supabase CLI (absolute path):
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-22-trade-guards.sql
-- Prove it with sql/probes/trade-guards-probe.sql before and after (it rolls itself back).
-- The definitions below are byte-identical to the ones in sql/schema.sql
-- (test/schema.test.js pins that).
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
create or replace function public.trade_insert_guard() returns trigger
language plpgsql as $$
declare
  me     text    := public.silvis_person_id();
  server boolean := auth.uid() is null and current_user in ('postgres', 'supabase_admin', 'service_role');
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
create or replace function public.apply_trade(p_trade_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t        public.shift_trade_requests%rowtype;
  d1       public.schedule_days%rowtype;
  d2       public.schedule_days%rowtype;
  me       text    := public.silvis_person_id();
  sched    boolean := public.silvis_is_sched();
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
