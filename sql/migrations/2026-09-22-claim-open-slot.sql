-- ============================================================================
-- Silvis Call Schedule - migration 2026-09-22: claim_open_slot() (Prompt 13 part 2)
-- Lets a signed-in surgeon whose account is linked to a roster entry take an OPEN
-- slot from the Open shifts board ("Take this shift"). Members cannot write
-- schedule_days under RLS, so the write runs here as security definer, modelled on
-- apply_trade(): explicit checks before the first write, version + 1, an audit row
-- and an in-app feed row in the same transaction.
--
-- Idempotent and self-contained: create-or-replace the function, re-run the
-- revoke/grant. Apply live with the Supabase CLI (absolute path):
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-22-claim-open-slot.sql
-- Prove it with sql/probes/claim-open-slot-probe.sql before and after (it rolls itself
-- back; before the migration every case reads "function ... does not exist").
-- The definition below is byte-identical to the one in sql/schema.sql
-- (test/schema.test.js pins that).
-- ============================================================================

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

  -- Display name from the roster blob (last name); falls back to the id.
  select r->>'name' into my_name
    from public.call_schedule_data c, jsonb_array_elements(coalesce(c.data->'roster', '[]'::jsonb)) r
   where c.id = 'main' and r->>'id' = me
   limit 1;
  my_name := coalesce(nullif(my_name, ''), me);

  insert into public.audit_log (actor_id, actor_name, action, detail)
  values (me, my_name, 'schedule.claim', jsonb_build_object('day', p_day, 'role', p_role, 'person', me, 'version', new_ver));

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
