-- ============================================================================
-- Silvis Call Schedule - migration 2026-09-23: a claim is an offer made on the spot (Prompt 14 part 2c)
--
-- Faraz 9/22 evening (docs/PROMPT-14-OFFER-PERIODS.md v2, part 2c): "A Prompt 13 claim is an offer made on the
-- spot: allowed for a 'submitted' surgeon on a non-offered day when the hard rules pass, and it inserts the
-- call_offers row so the record stays honest." The client side is rules.eligibility(ctx, day, role, id,
-- { claim: true }) (skips the exhaustive 'not-offered' only). This file is the database side:
--
--   1. claim_open_slot(p_day, p_role) - the body below is the recorded base from feat/open-shifts at commit 336210b
--      (sql/migrations/2026-09-22-claim-open-slot.sql there; applied live 9/22 - the applied proof is the section
--      '2026-09-22 - claim_open_slot (Prompt 13 part 2)' of docs/SCHEMA-REVIEW.md on that branch), byte for byte,
--      plus ONE addition between the schedule_days write and the audit row: an upsert into public.call_offers
--      (person_id = the claimer, day, role_pref = the claimed role, note null, entered_by = the claimer, source 'app').
--      ON CONFLICT (person_id, day): the same role stays as it was; an existing offer in the OTHER role becomes
--      'either' (he offered one role and just took the other); 'either' stays 'either'. updated_at moves.
--      Review 9/23: a claimer listed in rules_only_ids of the period containing p_day writes NO offer row - one row
--      would flip his derived status (offer_status(), rules.js) to 'submitted' for the whole period, switch his
--      dated lists off and put +outsideOffers on every other day of his. He chose "go by my rules"; the claim
--      itself is still recorded (schedule_days, the audit row with detail.offer = false, the feed row). A surgeon
--      who is neither listed nor submitted (not_started) DOES get the row: his claim is his first offer and he
--      becomes 'submitted' (preferred) for the period - the reading the prompt asks for ("an offer made on the
--      spot"); Faraz may rule otherwise (open question in the Fix-stage report).
--      Base record for the orchestrator: the base function text (from the line
--      'create or replace function public.claim_open_slot' through the line 'end $$;', LF) hashes to sha256
--      d86735999738fabe93da4990e4e3bff72e646d66521525a9db73fd179c1cb453. Before applying, extract the same span
--      from the LANDED sql/schema.sql (or the landed 2026-09-22 file) and compare: if it differs, REFUSE to apply
--      and re-base this file first - feat/open-shifts was still being rebased when this was written, and a
--      CREATE OR REPLACE from a stale base would silently revert later changes to claim_open_slot.
--   2. call_offers_guard() - the applied 9/22 body (sql/migrations/2026-09-22-offers-periods.sql) with ONE change:
--      the OFFER_FROZEN check is skipped while the transaction-local setting silvis.claim_in_progress is 'on'.
--      A claim lands after the period closed by definition (the schedule is published), so without this the
--      trigger would refuse the offer row and roll the claim back. OF001 (past) and OF002 (vacation) are not
--      skipped and cannot fire: CLAIM_PAST and CLAIM_VACATION above the write already refuse the same days.
--      claim_open_slot sets the flag right before the upsert and clears it right after; set_config(..., true) is
--      transaction-local either way, so nothing leaks past the claim's own transaction. Nothing else about the
--      guard, the delete guard, the RLS policies or offer_status() changes.
--
-- Idempotent and self-contained: create-or-replace both functions, re-run the revoke/grant. Apply live with the
-- Supabase CLI (absolute path; the workdir is a directory linked with `supabase link --project-ref
-- bzhsroegtagqhutbnsrp`) - AFTER feat/open-shifts has landed and its claim_open_slot is live (this file replaces
-- that body; applying it first would create the function early with the offer write already in it, which is
-- harmless but out of order for the README's record):
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-23-claim-offer.sql
-- Prove it with sql/probes/claim-open-slot-probe.sql (rolls itself back) plus three added cases: a claim by a linked
-- surgeon leaves a call_offers row (person_id = me, day, role_pref = the claimed role, source 'app'); a second
-- claim of the other role the same day reads role_pref 'either'; a claim by a surgeon listed in the period's
-- rules_only_ids leaves NO row and an audit detail offer = false.
-- Mirroring into sql/schema.sql once feat/open-shifts is merged - read this carefully: test/schema.test.js pins
-- schema.sql's call_offers_guard / call_offers_delete_guard byte-identical to the 2026-09-22 offers file and (on
-- feat/open-shifts) schema.sql's claim_open_slot byte-identical to the 2026-09-22 claim file. Copying the two
-- bodies below into schema.sql therefore FAILS both pins unless the same commit re-points them: schema.sql
-- claim_open_slot == this file's claim_open_slot and schema.sql call_offers_guard == this file's call_offers_guard
-- (call_offers_delete_guard stays pinned to the 9/22 file; keep the 9/22 files' sha256 'as applied' pins - those
-- files are history). Record the applied run in docs/SCHEMA-REVIEW.md next to the claim_open_slot section.
-- No contact data, no personal reasons: the offer row carries ids, a day, a role and 'app'.
-- ============================================================================

-- ---------- 1. claim_open_slot(): the recorded base + the call_offers upsert
-- Errors (unchanged from the base; class CL, custom):
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

-- ---------- 2. call_offers_guard(): the applied 9/22 body + the transaction-local claim bypass of OFFER_FROZEN
--   OFFER_PAST        the day is before today in America/Chicago
--   OFFER_ON_VACATION the day lies inside one of the person's time_off ranges (mirror of time_off_no_call_conflict)
--   OFFER_FROZEN      a non-scheduler writes a day inside a period whose offers_close_at has passed
--                     (the scheduler may still enter a late offer; a claim in progress may write its own row)
create or replace function public.call_offers_guard() returns trigger
language plpgsql as $$
declare
  today_c date := (now() at time zone 'America/Chicago')::date;
  frozen  record;
begin
  if new.day < today_c then
    raise exception 'OFFER_PAST: % is before today (%) in Central time', new.day, today_c using errcode = 'OF001';
  end if;
  if exists (select 1 from public.time_off t where t.person_id = new.person_id and new.day between t.start_date and t.end_date) then
    raise exception 'OFFER_ON_VACATION: % is inside a vacation of %', new.day, new.person_id using errcode = 'OF002';
  end if;
  if not public.silvis_is_sched() and coalesce(current_setting('silvis.claim_in_progress', true), '') <> 'on' then
    select p.label, p.offers_close_at into frozen
      from public.call_periods p
     where new.day between p.start_day and p.end_day and p.offers_close_at <= today_c
     limit 1;
    if found then
      raise exception 'OFFER_FROZEN: offers for % closed on % - ask the scheduler', frozen.label, frozen.offers_close_at using errcode = 'OF003';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
-- The trigger itself (call_offers_guard_trg, before insert or update) is unchanged and already bound to this
-- function name; create or replace above is enough - no drop/create of the trigger here.
