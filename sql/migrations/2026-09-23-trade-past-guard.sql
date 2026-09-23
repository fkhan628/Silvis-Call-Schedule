-- ============================================================================
-- Silvis Call Schedule - migration 2026-09-23: TRADE_PAST (audit RLS-6)
-- claim_open_slot() refuses a past day (CL003 CLAIM_PAST) but apply_trade() had no past-day check:
-- a party could apply an accepted trade whose day was already past and rewrite the historical
-- schedule and the yearly tallies, and the counter-party could accept such a trade first. Now:
--   apply_trade()        right after the TRADE_NOT_ACCEPTED check and before the first row lock /
--                        any write, a caller who is NOT the scheduler is refused when t.day or
--                        t.return_day is before today in America/Chicago;
--   trade_update_guard() the counter-party moving pending -> accepted is refused on the same
--                        condition (declining or cancelling a stale trade stays open to them; the
--                        scheduler bypass at the top of the guard is untouched).
-- Both raise the same sentence, errcode P0001 like every other TRADE_* error (the app shows it verbatim):
--   TRADE_PAST: <day> is before today (<today>) in Central time; past days are changed by the scheduler only
-- Strict <, so today's already-started 07:00 shift stays tradeable, matching claim_open_slot.
-- trade_insert_guard() is unchanged on purpose: a non-scheduler insert is already forced to 'pending',
-- and a pending past-day trade can now be neither accepted nor applied by a member; the scheduler
-- (or the server-side roles) may still record and apply a phoned-in past swap (Prompt 12 Q).
--
-- Idempotent and self-contained: create-or-replace the two functions, drop/create the update trigger,
-- re-run the revoke/grant. Apply live with the Supabase CLI (absolute path):
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-23-trade-past-guard.sql
-- Prove it with sql/probes/trade-guards-probe.sql before and after (it rolls itself back; cases I..M are
-- the new ones) and scripts/verify-rls.sh section 5. The definitions below are byte-identical to the
-- ones in sql/schema.sql (test/schema.test.js pins that, and pins that the 2026-09-22 trade-guards
-- migration stays frozen as it was applied).
-- Report-first (guide section 4.3): this replaces two live functions and re-creates one trigger; no
-- row changes. Blast radius: a member can no longer accept or apply a trade on a past day (none is
-- pending or accepted on a past day today - check before applying:
--   select id, day, return_day, status from public.shift_trade_requests
--    where status in ('pending', 'accepted') and (day < current_date or return_day < current_date);
-- ). No data migration: 0 applied trades exist live.
-- ============================================================================

-- Non-schedulers may only move a PENDING trade's status: the counter-party to accepted/declined,
-- the proposer to cancelled. Legs (who/day/role/return) are immutable except for the scheduler.
-- 2026-09-23 (audit RLS-6): the counter-party may not ACCEPT a trade whose day or return day is
-- already past in Central time (strict <: today's 07:00 shift stays tradeable) - TRADE_PAST, the
-- same sentence apply_trade() raises; declining or cancelling a stale trade stays open to them.
create or replace function public.trade_update_guard() returns trigger
language plpgsql as $$
declare
  me      text := public.silvis_person_id();
  today_c date := (now() at time zone 'America/Chicago')::date;
begin
  if public.silvis_is_sched() then return new; end if;
  if new.from_surgeon_id <> old.from_surgeon_id or new.to_surgeon_id <> old.to_surgeon_id
     or new.day <> old.day or new.role <> old.role
     or new.return_day is distinct from old.return_day or new.return_role is distinct from old.return_role then
    raise exception 'TRADE_IMMUTABLE: only the scheduler may change the legs of a trade' using errcode = 'P0001';
  end if;
  if current_setting('silvis.apply_trade', true) = '1' and old.status = 'accepted' and new.status = 'applied' then
    return new;   -- set only inside public.apply_trade()
  end if;
  if old.status <> 'pending' then
    raise exception 'TRADE_NOT_PENDING: this trade is already %', old.status using errcode = 'P0001';
  end if;
  if me = old.to_surgeon_id and new.status in ('accepted', 'declined') then
    if new.status = 'accepted' and (old.day < today_c or (old.return_day is not null and old.return_day < today_c)) then
      raise exception 'TRADE_PAST: % is before today (%) in Central time; past days are changed by the scheduler only',
        case when old.day < today_c then old.day else old.return_day end, today_c using errcode = 'P0001';
    end if;
    return new;
  end if;
  if me = old.from_surgeon_id and new.status = 'cancelled' then return new; end if;
  raise exception 'TRADE_FORBIDDEN: % may not set status % on this trade', coalesce(me, 'anon'), new.status using errcode = 'P0001';
end $$;
drop trigger if exists trade_update_guard_trg on public.shift_trade_requests;
create trigger trade_update_guard_trg
  before update on public.shift_trade_requests
  for each row execute function public.trade_update_guard();

-- Apply an ACCEPTED trade atomically (unchanged apart from TRADE_PAST; the full commentary on the
-- roster / vacation / lock / other-role checks is in sql/schema.sql above the function).
-- 2026-09-23 (audit RLS-6): right after the 'accepted' check and before the first row lock, a caller
-- who is not the scheduler is refused with TRADE_PAST when the day or the return day is before today
-- in America/Chicago (strict <, like claim_open_slot's CL003) - past days are the scheduler's to change.
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
