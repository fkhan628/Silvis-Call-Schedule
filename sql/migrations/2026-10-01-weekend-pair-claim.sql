-- ============================================================================
-- Silvis Call Schedule - migration 2026-10-01: the weekend pair claim (10/1 follow-up 3 of the queue report: "the Open shifts
-- board taking Khan's Sat + Sun as one claim").
-- REPORT-FIRST, NOT APPLIED (CLAUDE.md: a security-definer function that writes published schedule rows). One NEW function,
-- public.claim_open_weekend_pair(p_saturday date, p_role text); no table, column, policy, trigger, row or existing function
-- changes - claim_open_slot(date, text) stays exactly as it is (it is not re-created here). sql/schema.sql mirrors every
-- statement below (header revision u, "report-first, NOT yet applied" until the record step); test/schema.test.js pins the identity.
--
-- Why. A surgeon whose rules carry noLoneWeekendDay (rules.js, Prompt 23 B2 - Khan's key; "his weekend days come as a pair")
-- is refused a lone Saturday or Sunday as PRIMARY (hard lone-weekend-day:<Sat|Sun>). The Open shifts board asks rules.js per
-- slot, so when both days of a weekend are open he is refused each day alone, and claim_open_slot takes ONE slot. Two
-- claim_open_slot calls in a row are not a pair: the second can fail (someone took the Sunday in between, a vacation, a lock)
-- and leave him on a lone day the rules forbid. This function takes the Saturday AND the Sunday after it in ONE transaction:
-- every check of both days runs before the first write, and any refusal rolls back both days (and any row it created).
--
-- The contract (the same tokens, SQLSTATEs and message text as claim_open_slot, each message naming the failing day; one new
-- refusal, CL010):
--   CL001 CLAIM_NOT_LINKED      caller has no roster link (or is anon - anon has no EXECUTE at all: 42501)
--   CL002 CLAIM_BAD_ROLE        role not in (primary, backup) - the role is generic; the board offers the pair where
--                               rules.js asks for it (lone-weekend-day is a PRIMARY rule today)
--   CL010 CLAIM_NOT_SATURDAY    p_saturday is null or not a Saturday (ISO day of week 6); the Sunday is p_saturday + 1
--   CL003 CLAIM_PAST            the Saturday is before today in America/Chicago (on a Sunday the pair is past - the board
--                               never offers it then)
--   CL004 CLAIM_OUTSIDE_RANGE   the Saturday, then the Sunday, outside [min(day), max(day)] of schedule_days
--   then, per day in day order (Saturday first, then Sunday):
--   CL005 CLAIM_HELD            the slot is already held
--   CL006 CLAIM_EXTERNAL        primary requested while external_cover is set
--   CL007 CLAIM_LOCKED          the slot is locked (the scheduler assigns from the editor)
--   CL008 CLAIM_OTHER_ROLE      the caller already holds the other role that day
--   and last, once for both days:
--   CL009 CLAIM_VACATION        a time_off row of the caller overlaps the Saturday or the Sunday (or the Monday after when
--                               p_role = 'primary' - the Sunday's shift ends 07:00 Monday, as claim_open_slot reads it)
-- Then the writes, for the Saturday and then the Sunday: the role set to the caller, version + 1, source 'claim', updated_by,
-- updated_at; the caller's call_offers row (a claim is an offer made on the spot, Prompt 14 P2) unless he is listed in
-- rules_only_ids of the period containing THAT day (checked per day - a period boundary can split a weekend), written with
-- silvis.claim_in_progress on exactly like claim_open_slot; one audit_log row 'schedule.claim' per day in claim_open_slot's
-- detail shape (summary "<Name> took <M/D> <role>", day, role, person, version, offer) plus 'pair' = the other day; one
-- notifications row 'shift_claimed' per day with claim_open_slot's title / message / data plus 'pair'. Every per-day reader
-- (the Activity log's detail.summary, audit_read_own, the feed's data.day) reads the two rows as two claims. Returns
-- { ok, days: [sat, sun], role, person_id, versions: [v_sat, v_sun], offers: [offer_sat, offer_sun] }.
--
-- Locks. `lock table public.time_off in share mode` after the row-less refusals (CL001-CL004, CL010) and before the first day
-- row lock and the vacation check - the reasoning of claim_open_slot's header (Prompt 16 B6): a vacation of the caller written
-- concurrently waits for this transaction, or this function waits and CL009 sees it. Then the day rows FOR UPDATE in day
-- order, Saturday then Sunday (a missing row inside the range is inserted with source 'claim' first, exactly like
-- claim_open_slot; the insert rolls back with any refusal). Lock order: time_off table (share) -> Saturday row -> Sunday row.
-- Deadlock note: apply_trade() locks a trade's day and then its return day in whatever order the trade names them, so a
-- concurrent Sunday-for-Saturday trade of the same weekend can deadlock with this function. PostgreSQL then aborts ONE of the
-- two transactions with 40P01 - rolled back as a whole, never half-written; the client shows the error and refetches. Not
-- engineered around (a six-surgeon group; the window is milliseconds).
--
-- What it guards: data integrity only, like claim_open_slot - both slots open, unlocked, not past (Central), not external-
-- covered, inside the published range, distinct roles, no vacation conflict. The JS rules (lone-weekend-day itself, caps,
-- patterns, runs) are enforced in the client before the "Take Sat + Sun" button is offered (rules.js eligibility with the
-- partner day assumed), not here - the accepted boundary for a six-surgeon group; everything the function does is logged.
-- security definer, set search_path = public, pg_temp (members cannot write schedule_days or another person's call_offers under
-- RLS; pg_temp last, like the newer definers - every relation here is schema-qualified anyway).
-- EXECUTE: revoked from public and anon, granted to authenticated (the claim_open_slot grants).
--
-- Blast radius: nothing changes for anyone until a client calls the function - one new RPC, POST rest/v1/rpc/
-- claim_open_weekend_pair { p_saturday, p_role }, called only by the client on the same branch (the board's "Take Sat + Sun",
-- shown only to a noLoneWeekendDay surgeon refused each day alone by lone-weekend-day). claim_open_slot, apply_trade, the
-- day editor's writes, the generator's publish and every policy are untouched. The probes of the other functions do not
-- call it. PostgREST must learn the new function: the file ends with `notify pgrst, 'reload schema'` (until it is reloaded the
-- RPC answers 404 PGRST202 - the client reads that as "the two-day claim is not switched on yet - ask the scheduler").
--
-- Apply live with the Supabase CLI (absolute path; the workdir is a directory linked with `supabase link --project-ref
-- bzhsroegtagqhutbnsrp`), or paste the file into the SQL editor as ONE session:
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-10-01-weekend-pair-claim.sql
-- Order: pre-check `select to_regprocedure('public.claim_open_weekend_pair(date,text)');` -> null; probe BEFORE
-- (sql/probes/weekend-pair-claim-probe.sql raises PROBE_SETUP: claim_open_weekend_pair is absent); this file; probe AFTER (20
-- cases); `SILVIS_WEEKEND_PAIR_CLAIM_APPLIED=1 bash scripts/verify-rls.sh` (section 17 strict); the record step
-- (docs/SCHEMA-REVIEW.md "2026-10-01 - weekend pair claim"); then the client (feat/weekend-pair-claim) ships.
-- One command does all of it, stopping at the first failure: apply-weekend-pair-claim.sh in the private gate folder run-2026-10-01.
-- Re-running: idempotent (create or replace; the revoke / grant lines repeat harmlessly).
-- Rolling back = `drop function if exists public.claim_open_weekend_pair(date, text);` (nothing else refers to it; the
-- client's button then answers 404 and says the two-day claim is not switched on).
-- ============================================================================

create or replace function public.claim_open_weekend_pair(p_saturday date, p_role text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me          text := public.silvis_person_id();
  today_c     date := (now() at time zone 'America/Chicago')::date;
  sun         date;
  dd          date;
  d           public.schedule_days%rowtype;
  lo          date;
  hi          date;
  other       text;
  held        text;
  is_locked   boolean;
  my_name     text;
  vac         text;
  new_ver     integer;
  ver_sat     integer;
  ver_sun     integer;
  wrote_offer boolean;
  offer_sat   boolean := false;
  offer_sun   boolean := false;
  summary     text;
begin
  if auth.uid() is null or me is null then
    raise exception 'CLAIM_NOT_LINKED: sign in with an account that is linked to a roster entry to take a shift' using errcode = 'CL001';
  end if;
  if p_role is null or p_role not in ('primary', 'backup') then
    raise exception 'CLAIM_BAD_ROLE: role must be primary or backup (got %)', coalesce(p_role, 'null') using errcode = 'CL002';
  end if;
  if p_saturday is null or extract(isodow from p_saturday) <> 6 then
    raise exception 'CLAIM_NOT_SATURDAY: % is not a Saturday - the two-day claim takes a Saturday and the Sunday after it', coalesce(p_saturday::text, 'null') using errcode = 'CL010';
  end if;
  sun := p_saturday + 1;
  if p_saturday < today_c then
    raise exception 'CLAIM_PAST: % is before today (%) in Central time; past days are not open', p_saturday, today_c using errcode = 'CL003';
  end if;

  -- The published range = every day between the first and the last schedule_days row; the Saturday, then the Sunday.
  select min(day), max(day) into lo, hi from public.schedule_days;
  foreach dd in array array[p_saturday, sun] loop
    if lo is null or dd < lo or dd > hi then
      raise exception 'CLAIM_OUTSIDE_RANGE: % is outside the published schedule (% to %)', dd, coalesce(lo::text, '-'), coalesce(hi::text, '-') using errcode = 'CL004';
    end if;
  end loop;

  -- SHARE on time_off before the day rows are locked and before the vacation check (CL009) - claim_open_slot's reasoning.
  -- Lock order: time_off table (share) -> the Saturday row (update) -> the Sunday row (update).
  lock table public.time_off in share mode;

  other := case when p_role = 'primary' then 'backup' else 'primary' end;
  -- Each day in day order: lock its row (a day inside the range with no row gets one, source 'claim' - rolled back with any
  -- refusal below), then its four slot checks. Nothing is written to a slot before every check of BOTH days has passed.
  foreach dd in array array[p_saturday, sun] loop
    select * into d from public.schedule_days where day = dd for update;
    if not found then
      insert into public.schedule_days (day, source, version, updated_by, updated_at)
        values (dd, 'claim', 1, me, now())
        on conflict (day) do nothing;
      select * into d from public.schedule_days where day = dd for update;
    end if;
    held      := case when p_role = 'primary' then d.primary_id else d.backup_id end;
    is_locked := case when p_role = 'primary' then d.primary_locked else d.backup_locked end;
    if held is not null then
      raise exception 'CLAIM_HELD: % % is already held by %', dd, p_role, held using errcode = 'CL005';
    end if;
    if p_role = 'primary' and coalesce(d.external_cover, '') <> '' then
      raise exception 'CLAIM_EXTERNAL: % primary is covered by % (outside the roster)', dd, d.external_cover using errcode = 'CL006';
    end if;
    if is_locked then
      raise exception 'CLAIM_LOCKED: % % is locked; ask the scheduler to assign it', dd, p_role using errcode = 'CL007';
    end if;
    if (case when p_role = 'primary' then d.backup_id else d.primary_id end) = me then
      raise exception 'CLAIM_OTHER_ROLE: you already hold % on %', other, dd using errcode = 'CL008';
    end if;
  end loop;

  -- Vacation conflict over both days, plus the Monday for a PRIMARY pair (the Sunday shift ends 07:00 Monday - the same
  -- trailing edge claim_open_slot and the time_off trigger read).
  select string_agg(to_char(start_date, 'FMMM/FMDD') || '-' || to_char(end_date, 'FMMM/FMDD'), ', ' order by start_date)
    into vac
    from public.time_off
   where person_id = me
     and start_date <= (case when p_role = 'primary' then sun + 1 else sun end)
     and end_date   >= p_saturday;
  if vac is not null then
    raise exception 'CLAIM_VACATION: your vacation % conflicts with % and % % (a primary shift also blocks the day before a vacation)', vac, p_saturday, sun, p_role using errcode = 'CL009';
  end if;

  -- Display name from the roster blob (last name); falls back to the id.
  select r->>'name' into my_name
    from public.call_schedule_data c, jsonb_array_elements(coalesce(c.data->'roster', '[]'::jsonb)) r
   where c.id = 'main' and r->>'id' = me
   limit 1;
  my_name := coalesce(nullif(my_name, ''), me);

  -- The writes - only now, after every refusal above. The Saturday, then the Sunday: the slot (version + 1 makes every other
  -- client's compare-and-swap on the day fail loudly and reload), the offer row (none for a rules_only claimer of the period
  -- containing THAT day), the audit row and the feed row, each carrying 'pair' = the other day.
  foreach dd in array array[p_saturday, sun] loop
    if p_role = 'primary' then
      update public.schedule_days
         set primary_id = me, version = version + 1, source = 'claim', updated_by = me, updated_at = now()
       where day = dd
       returning version into new_ver;
    else
      update public.schedule_days
         set backup_id = me, version = version + 1, source = 'claim', updated_by = me, updated_at = now()
       where day = dd
       returning version into new_ver;
    end if;

    wrote_offer := false;
    if not exists (select 1 from public.call_periods p where dd between p.start_day and p.end_day and p.rules_only_ids ? me) then
      perform set_config('silvis.claim_in_progress', 'on', true);
      insert into public.call_offers (person_id, day, role_pref, note, entered_by, source)
      values (me, dd, p_role, null, me, 'app')
      on conflict (person_id, day) do update
         set role_pref  = case when public.call_offers.role_pref = excluded.role_pref then public.call_offers.role_pref else 'either' end,
             updated_at = now();
      perform set_config('silvis.claim_in_progress', '', true);
      wrote_offer := true;
    end if;

    summary := my_name || ' took ' || to_char(dd, 'FMMM/FMDD') || ' ' || p_role;
    insert into public.audit_log (actor_id, actor_name, action, detail)
    values (me, my_name, 'schedule.claim', jsonb_build_object('summary', summary, 'day', dd, 'role', p_role, 'person', me, 'version', new_ver, 'offer', wrote_offer, 'pair', case when dd = p_saturday then sun else p_saturday end));

    insert into public.notifications (type, title, message, data)
    values ('shift_claimed',
            summary,
            my_name || ' took the open ' || p_role || ' shift on ' || to_char(dd, 'Dy FMMM/FMDD') || ' (07:00 to 07:00).',
            jsonb_build_object('day', dd, 'role', p_role, 'surgeon_id', me, 'person_id', me, 'pair', case when dd = p_saturday then sun else p_saturday end));

    if dd = p_saturday then
      ver_sat := new_ver; offer_sat := wrote_offer;
    else
      ver_sun := new_ver; offer_sun := wrote_offer;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'days', jsonb_build_array(p_saturday, sun), 'role', p_role, 'person_id', me,
                            'versions', jsonb_build_array(ver_sat, ver_sun), 'offers', jsonb_build_array(offer_sat, offer_sun));
end $$;

revoke all on function public.claim_open_weekend_pair(date, text) from public, anon;
grant execute on function public.claim_open_weekend_pair(date, text) to authenticated;

notify pgrst, 'reload schema';
