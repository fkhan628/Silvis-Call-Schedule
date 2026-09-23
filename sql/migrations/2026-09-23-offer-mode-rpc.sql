-- ============================================================================
-- Silvis Call Schedule - migration 2026-09-23: the offer painter's two RPCs (Prompt 14 part 3a, U3a)
--
--   set_offer_mode(p_period uuid, p_mode text, p_person text default null) -> jsonb   SECURITY DEFINER
--     A surgeon cannot write call_periods (RLS: scheduler / admin only), yet the painter lets them choose, for the
--     next period, 'exhaustive' ("only these days") / 'preferred' ("my preferred days - use my rules to fill gaps",
--     the default) or 'rules_only' ("go by my rules"). This function writes THAT ONE PERSON'S KEY and nothing else:
--     exhaustive / preferred -> offer_modes[person] = mode and the person is removed from rules_only_ids;
--     rules_only -> the person is added to rules_only_ids (distinct) and their offer_modes key is dropped - refused
--     while they still have offers inside the period (one offer row would derive them 'submitted' anyway; the
--     painter tells them to clear those days first). p_person is the scheduler's relay path (Periods "Enter for
--     someone"); a non-scheduler may only speak for public.silvis_person_id(). The freeze holds here like OF003:
--     a non-scheduler is refused once offers_close_at has passed or the period is no longer 'upcoming'.
--
--   save_offers(p_person text, p_rows jsonb, p_clear date[], p_period uuid default null, p_mode text default null)
--                                                                                       -> jsonb   SECURITY INVOKER
--     The painter's one Save. One request, one transaction: every upsert (insert ... on conflict (person_id, day)
--     do update) and every delete succeed together or the whole batch rolls back - "a failed commit writes
--     nothing" holds even when a Save both adds and clears days, which two REST requests could not promise. When
--     the same Save also changed the person's mode for the period (p_period + p_mode), set_offer_mode runs INSIDE
--     this transaction after the rows: a refused mode (OM001-OM006) rolls the rows back too, so days + mode are one
--     commit or nothing (the 9/23 review's finding; the client keeps set_offer_mode for the mode-only paths).
--     Runs AS THE CALLER: the call_offers RLS policies (own rows, or scheduler / admin any row) and the three
--     guards (OF001 past, OF002 vacation, OF003 frozen; the delete guard too) apply exactly as on a direct write;
--     nothing is bypassed. entered_by / source are set here from who is calling, never trusted from the client:
--     the person themself -> (their id, 'app'); the scheduler for someone else -> ('scheduler', 'email-relay').
--     p_rows = [{ "day": "YYYY-MM-DD", "role_pref": "primary" | "backup" | "either", "note": text | null }],
--     p_clear = the days to delete. A repaint that sends no note KEEPS the row's operational note (the importer's
--     'seed: <tag>' / the relay's e-mail date survive a role change: coalesce(excluded.note, call_offers.note)).
--     The audit row 'offers.save' (count, mode) is the client's, written after this returns ok - same division as
--     claim_open_slot's caller (one write, one audit).
--
-- Errors: stable tokens + custom SQLSTATEs (class OM = offer mode, OS = offer save); PostgREST returns both and
-- the app shows the message verbatim (describeDbError):
--   OM001 MODE_NOT_LINKED   caller has no roster link (or is anon)
--   OM002 MODE_NOT_YOURS    a non-scheduler named someone else
--   OM003 MODE_BAD_MODE     mode not in (exhaustive, preferred, rules_only)
--   OM004 MODE_NO_PERIOD    no call_periods row with that id
--   OM005 MODE_FROZEN       non-scheduler after offers_close_at, or the period is not 'upcoming'
--   OM006 MODE_HAS_OFFERS   rules_only requested while the person has offers inside the period
--   OS001 OFFERS_NOT_LINKED caller has no roster link (or is anon)
--   OS002 OFFERS_NOT_YOURS  a non-scheduler saving someone else's offers
--   OS003 OFFERS_BAD_ROW    a row without a valid day / role_pref (fail closed: the batch writes nothing)
--
-- Idempotent and additive (create or replace + the grants; no table, trigger or policy is touched; the one `drop
-- function if exists` removes save_offers' earlier three-argument draft, which was never applied live, so a second
-- overload can never leave PostgREST unable to resolve the call). Apply live with the Supabase CLI (absolute path;
-- the workdir is a directory linked with `supabase link --project-ref bzhsroegtagqhutbnsrp`):
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-23-offer-mode-rpc.sql
-- Prove it with sql/probes/offer-rpcs-probe.sql (rolls itself back) and record the observed lines in
-- docs/SCHEMA-REVIEW.md. The two definitions are mirrored into sql/schema.sql byte for byte (test/schema.test.js pins
-- the identity, as for the earlier migrations).
-- ============================================================================

create or replace function public.set_offer_mode(p_period uuid, p_mode text, p_person text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me       text := public.silvis_person_id();
  sched    boolean := public.silvis_is_sched();
  who      text;
  today_c  date := (now() at time zone 'America/Chicago')::date;
  p        public.call_periods%rowtype;
  n_offers integer;
begin
  if auth.uid() is null or (me is null and not sched) then
    raise exception 'MODE_NOT_LINKED: sign in with an account that is linked to a roster entry' using errcode = 'OM001';
  end if;
  who := coalesce(nullif(btrim(p_person), ''), me);
  if who is null then
    raise exception 'MODE_NOT_LINKED: name the person (your account is not linked to a roster entry)' using errcode = 'OM001';
  end if;
  if who <> coalesce(me, '') and not sched then
    raise exception 'MODE_NOT_YOURS: only the scheduler can set another surgeon''s mode' using errcode = 'OM002';
  end if;
  if p_mode is null or p_mode not in ('exhaustive', 'preferred', 'rules_only') then
    raise exception 'MODE_BAD_MODE: mode must be exhaustive, preferred or rules_only (got %)', coalesce(p_mode, 'null') using errcode = 'OM003';
  end if;

  select * into p from public.call_periods where id = p_period for update;
  if not found then
    raise exception 'MODE_NO_PERIOD: no period % on file', coalesce(p_period::text, 'null') using errcode = 'OM004';
  end if;
  if not sched and (p.status <> 'upcoming' or p.offers_close_at <= today_c) then
    raise exception 'MODE_FROZEN: offers for % closed on % - ask the scheduler', p.label, p.offers_close_at using errcode = 'OM005';
  end if;

  if p_mode = 'rules_only' then
    select count(*) into n_offers from public.call_offers o where o.person_id = who and o.day between p.start_day and p.end_day;
    if n_offers > 0 then
      raise exception 'MODE_HAS_OFFERS: % has % offered day(s) inside % - clear them first to go by the rules', who, n_offers, p.label using errcode = 'OM006';
    end if;
    update public.call_periods
       set rules_only_ids = (select coalesce(jsonb_agg(distinct x), '[]'::jsonb)
                               from (select jsonb_array_elements_text(rules_only_ids) as x union all select who) s),
           offer_modes    = offer_modes - who,
           updated_at     = now()
     where id = p_period;
  else
    update public.call_periods
       set rules_only_ids = (select coalesce(jsonb_agg(x), '[]'::jsonb)
                               from jsonb_array_elements_text(rules_only_ids) as x where x <> who),
           offer_modes    = offer_modes || jsonb_build_object(who, p_mode),
           updated_at     = now()
     where id = p_period;
  end if;

  select * into p from public.call_periods where id = p_period;
  return jsonb_build_object('ok', true, 'period_id', p.id, 'label', p.label, 'person_id', who, 'mode', p_mode,
                            'rules_only_ids', p.rules_only_ids, 'offer_modes', p.offer_modes, 'by', coalesce(me, 'scheduler'));
end $$;
revoke all on function public.set_offer_mode(uuid, text, text) from public;
revoke all on function public.set_offer_mode(uuid, text, text) from anon;
grant execute on function public.set_offer_mode(uuid, text, text) to authenticated;
comment on function public.set_offer_mode(uuid, text, text) is 'Prompt 14 part 3a: one person''s offer mode on one period (exhaustive / preferred -> offer_modes[person], off rules_only_ids; rules_only -> on rules_only_ids, key dropped; refused with offers inside the period). Security definer because surgeons cannot write call_periods; a non-scheduler may only set their own, and only before offers_close_at.';

drop function if exists public.save_offers(text, jsonb, date[]);
create or replace function public.save_offers(p_person text, p_rows jsonb, p_clear date[], p_period uuid default null, p_mode text default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  me        text := public.silvis_person_id();
  sched     boolean := public.silvis_is_sched();
  who       text := nullif(btrim(p_person), '');
  v_by      text;
  v_src     text;
  n_up      integer := 0;
  n_del     integer := 0;
  bad       text;
begin
  if auth.uid() is null or (me is null and not sched) then
    raise exception 'OFFERS_NOT_LINKED: sign in with an account that is linked to a roster entry to save offers' using errcode = 'OS001';
  end if;
  who := coalesce(who, me);
  if who is null then
    raise exception 'OFFERS_NOT_LINKED: name the person (your account is not linked to a roster entry)' using errcode = 'OS001';
  end if;
  if who <> coalesce(me, '') and not sched then
    raise exception 'OFFERS_NOT_YOURS: only the scheduler can save another surgeon''s offers' using errcode = 'OS002';
  end if;
  if p_rows is not null and jsonb_typeof(p_rows) <> 'array' then
    raise exception 'OFFERS_BAD_ROW: rows must be a JSON array' using errcode = 'OS003';
  end if;
  -- Fail closed BEFORE any write: one malformed row means the whole batch is refused.
  select string_agg(coalesce(r->>'day', 'null') || ' ' || coalesce(r->>'role_pref', 'null'), ', ') into bad
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
   where r->>'day' !~ '^\d{4}-\d{2}-\d{2}$' or r->>'role_pref' is null or r->>'role_pref' not in ('primary', 'backup', 'either');
  if bad is not null then
    raise exception 'OFFERS_BAD_ROW: % (day must be YYYY-MM-DD, role_pref primary / backup / either) - nothing was saved', bad using errcode = 'OS003';
  end if;

  -- Who entered it is a fact of the call, never a client field.
  if me is not null and who = me then v_by := me; v_src := 'app'; else v_by := 'scheduler'; v_src := 'email-relay'; end if;

  -- The deletes first, then the upserts (order is immaterial inside one transaction; the delete guard OF003 and the
  -- RLS delete policy apply per row). A day in both lists ends up upserted.
  if p_clear is not null and array_length(p_clear, 1) > 0 then
    delete from public.call_offers where person_id = who and day = any(p_clear);
    get diagnostics n_del = row_count;
  end if;
  insert into public.call_offers (person_id, day, role_pref, note, entered_by, source)
  select who, (r->>'day')::date, r->>'role_pref', nullif(btrim(r->>'note'), ''), v_by, v_src
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  on conflict (person_id, day) do update
    set role_pref = excluded.role_pref, note = coalesce(excluded.note, call_offers.note), entered_by = excluded.entered_by, source = excluded.source, updated_at = now();
  get diagnostics n_up = row_count;

  -- The mode, when the same Save changed it: inside this transaction, so a refused mode (OM001-OM006, checked by
  -- set_offer_mode itself) rolls the rows above back too - days + mode are one commit or nothing.
  if p_mode is not null then
    perform public.set_offer_mode(p_period, p_mode, who);
  end if;

  return jsonb_build_object('ok', true, 'person_id', who, 'upserted', n_up, 'deleted', n_del, 'entered_by', v_by, 'source', v_src, 'mode', p_mode);
end $$;
revoke all on function public.save_offers(text, jsonb, date[], uuid, text) from public;
revoke all on function public.save_offers(text, jsonb, date[], uuid, text) from anon;
grant execute on function public.save_offers(text, jsonb, date[], uuid, text) to authenticated;
comment on function public.save_offers(text, jsonb, date[], uuid, text) is 'Prompt 14 part 3a: the offer painter''s one Save - upserts + deletes (+ the period mode through set_offer_mode when p_mode is given) in ONE transaction as the caller (security invoker: RLS + OF001/OF002/OF003 apply per row; nothing bypassed). entered_by / source come from the caller identity; a row sent without a note keeps its note. The client writes the audit row offers.save after ok.';
