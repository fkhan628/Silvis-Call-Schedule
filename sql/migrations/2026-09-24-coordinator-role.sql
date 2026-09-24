-- ============================================================================
-- Silvis Call Schedule - migration 2026-09-24: the COORDINATOR role (office users) - Prompt 16 A7
-- supersedes: sql/migrations/2026-09-24-prelaunch-rls.sql
--   (same-day file order: A1's notif_insert / audit_insert texts are re-created below with the coordinator clause; A1 is
--    applied live already - this file runs AFTER it and builds on its final texts)
--
-- REPORT-FIRST (CLAUDE.md, guide section 4.3): this file changes row-level security on the live database. Prepared here
-- with its probe (sql/probes/coordinator-probe.sql, rolls itself back) and its verify-rls.sh section (11); the
-- orchestrator applies it after the report. Nothing in the repo applies it.
--
-- What a coordinator is: an office account (user_profiles.role = 'coordinator', NO person_id - the check constraint
-- below refuses a linked one) that enters and edits the surgeons' vacations, writes dated availability rows for them
-- and relays offered dates into the painter on their behalf - with no scheduler power: nothing on schedule_days,
-- call_schedule_data, call_periods, shift_trade_requests, call_schedule_snapshots, office_contacts or another
-- account's profile row. To every guard that asks silvis_is_sched() a coordinator is a non-scheduler: the offer
-- freeze (OF003 by close date AND period status, OM005), OF004, the time_off on-call trigger, the trade guards.
--
-- a) user_profiles.role check gains 'coordinator'; user_profiles_coordinator_unlinked: a coordinator row keeps
--    person_id null (the audit / notification clauses below identify a coordinator by auth.uid(), never by a roster
--    id; a linked coordinator would be a surgeon with office powers). public.silvis_is_coord() is the sibling of
--    silvis_is_sched(): security definer, own row's role = 'coordinator'; grants as for the sibling (none beyond the
--    default EXECUTE - both helpers are read by policies and triggers under every role, anon included).
-- b) time_off: the three write policies gain `or public.silvis_is_coord()` for ANY person_id (the scheduler clause's
--    shape). The on-call trigger time_off_no_call_conflict is untouched: a coordinator's range over a published
--    on-call day is refused like anyone's (probe C4). created_by carries the caller's id (the client writes
--    userProfile.person_id || authUser.id - a coordinator's profile id; the column is free text, no constraint).
--    availability: one new policy availability_write_coord (insert / update / delete for any person_id); the
--    generated availability_write_sched stays as it is. No client UI writes availability outside Setup today - the
--    policy is the door for the office's future entry path and is probed (C5).
-- c) call_offers: a coordinator writes ONLY through save_offers(p_person, ...) / set_offer_mode(p_period, p_mode,
--    p_person) - the existing "enter for someone" path. Both functions accept a coordinator for another person
--    (OS001 / OM001 no longer fire for an unlinked caller who is a coordinator; OS002 / OM002 no longer fire for a
--    coordinator; a coordinator's p_person must be a roster id in call_schedule_data 'main' - OS004 / OM007 otherwise, the
--    scheduler's relay unchanged - because call_offers.person_id has no foreign key); save_offers stamps entered_by = the coordinator's profile id (auth.uid()::text) and source
--    'office-relay' (the scheduler's relay keeps 'scheduler' / 'email-relay'; a surgeon keeps own id / 'app'); the
--    source check gains 'office-relay'. save_offers stays SECURITY INVOKER, so the call_offers policies still apply
--    per row: they gain the clause `(public.silvis_is_coord() and coalesce(current_setting('silvis.office_relay',
--    true), '') = 'on')`, and save_offers turns that transaction-local flag on around its delete / upsert for a
--    coordinator (the same mechanism as silvis.claim_in_progress in claim_open_slot). A direct REST write of
--    call_offers by a coordinator never sees the flag (PostgREST exposes no set_config; the flag dies with the
--    request's transaction) and stays refused - insert 42501, update / delete 0 rows (probe C7 / C22 / C23). The
--    freeze applies to a coordinator as to a surgeon (both guards test silvis_is_sched(): C9 OM005, C10 OF003).
-- d) unchanged for coordinators (no policy names them - proven by the probe): schedule_days, call_schedule_data,
--    call_periods, shift_trade_requests, call_schedule_snapshots, office_contacts, east_vacation_reviews,
--    user_profiles beyond the own row (user_profiles_read: own row + admin / scheduler rows; user_profiles_self_update
--    pins role / person_id / email - a coordinator cannot promote itself: C16).
-- e) notif_insert gains `or public.silvis_is_coord()`; audit_insert gains `or (public.silvis_is_coord() and
--    actor_id = auth.uid()::text)` - what the client's logAudit already writes for an account without a roster
--    link (actor_id: userProfile.person_id || authUser.id; actor_name: display_name). A1's shape is kept, not
--    widened: an unlinked VIEWER still inserts nothing (A1 S3 / S4 hold). audit_read_coord (new): a coordinator
--    reads the rows it authored in the vacation / offer / availability families only (actor_id = auth.uid()::text
--    and action like 'timeoff.%' / 'offers.%' / 'availability.%') - the Activity log in Settings shows a coordinator
--    its own entries; audit_read (scheduler / admin, every row) is unchanged.
-- f) send-notification: role 'coordinator' is refused like 'viewer' (403 on every category; the function's
--    senderRole() admits admin / scheduler / a linked surgeon only - no change of logic, a comment + a test pin;
--    the orchestrator redeploys for byte-identical workdir copies).
--
-- Idempotent: drop policy if exists / create; create or replace; drop constraint if exists / add. No table is
-- created or dropped; no row is touched. Apply live with the Supabase CLI (absolute path; the workdir is a directory
-- linked with `supabase link --project-ref bzhsroegtagqhutbnsrp`), or paste the file into the SQL editor as ONE
-- session:
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-24-coordinator-role.sql
-- Prove it with sql/probes/coordinator-probe.sql (rolls itself back; its header states the string every case reads
-- BEFORE and AFTER this file) and scripts/verify-rls.sh section 11; record the observed lines in docs/SCHEMA-REVIEW.md.
-- Every text below is mirrored into sql/schema.sql byte for byte (test/schema.test.js pins the identity).
-- ============================================================================

-- a) the role, the unlinked check, the helper
alter table public.user_profiles drop constraint if exists user_profiles_role_check;
alter table public.user_profiles add constraint user_profiles_role_check
  check (role in ('admin','scheduler','surgeon','viewer','coordinator'));
alter table public.user_profiles drop constraint if exists user_profiles_coordinator_unlinked;
alter table public.user_profiles add constraint user_profiles_coordinator_unlinked
  check (role <> 'coordinator' or person_id is null);   -- an office account is never a roster entry

create or replace function public.silvis_is_coord() returns boolean
language sql stable security definer set search_path = public as $$
  select public.silvis_role() = 'coordinator';
$$;

-- b) time_off + availability
drop policy if exists time_off_self_insert on public.time_off;
create policy time_off_self_insert on public.time_off for insert to authenticated
  with check (person_id = public.silvis_person_id() or public.silvis_is_sched() or public.silvis_is_coord());
drop policy if exists time_off_self_update on public.time_off;
create policy time_off_self_update on public.time_off for update to authenticated
  using (person_id = public.silvis_person_id() or public.silvis_is_sched() or public.silvis_is_coord())
  with check (person_id = public.silvis_person_id() or public.silvis_is_sched() or public.silvis_is_coord());
drop policy if exists time_off_self_delete on public.time_off;
create policy time_off_self_delete on public.time_off for delete to authenticated
  using (person_id = public.silvis_person_id() or public.silvis_is_sched() or public.silvis_is_coord());
drop policy if exists availability_write_coord on public.availability;
create policy availability_write_coord on public.availability for all to authenticated
  using (public.silvis_is_coord()) with check (public.silvis_is_coord());

-- c) call_offers: the source, the policies (the office-relay flag is set only inside save_offers), the two RPCs
alter table public.call_offers drop constraint if exists call_offers_source_check;
alter table public.call_offers add constraint call_offers_source_check
  check (source in ('app','email-relay','import','office-relay'));
drop policy if exists call_offers_insert on public.call_offers;
create policy call_offers_insert on public.call_offers for insert to authenticated
  with check (person_id = public.silvis_person_id() or public.silvis_is_sched() or (public.silvis_is_coord() and coalesce(current_setting('silvis.office_relay', true), '') = 'on'));
drop policy if exists call_offers_update on public.call_offers;
create policy call_offers_update on public.call_offers for update to authenticated
  using (person_id = public.silvis_person_id() or public.silvis_is_sched() or (public.silvis_is_coord() and coalesce(current_setting('silvis.office_relay', true), '') = 'on'))
  with check (person_id = public.silvis_person_id() or public.silvis_is_sched() or (public.silvis_is_coord() and coalesce(current_setting('silvis.office_relay', true), '') = 'on'));
drop policy if exists call_offers_delete on public.call_offers;
create policy call_offers_delete on public.call_offers for delete to authenticated
  using (person_id = public.silvis_person_id() or public.silvis_is_sched() or (public.silvis_is_coord() and coalesce(current_setting('silvis.office_relay', true), '') = 'on'));

create or replace function public.set_offer_mode(p_period uuid, p_mode text, p_person text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me       text := public.silvis_person_id();
  sched    boolean := public.silvis_is_sched();
  coord    boolean := public.silvis_is_coord();
  who      text;
  today_c  date := (now() at time zone 'America/Chicago')::date;
  p        public.call_periods%rowtype;
  n_offers integer;
begin
  if auth.uid() is null or (me is null and not sched and not coord) then
    raise exception 'MODE_NOT_LINKED: sign in with an account that is linked to a roster entry' using errcode = 'OM001';
  end if;
  who := coalesce(nullif(btrim(p_person), ''), me);
  if who is null then
    raise exception 'MODE_NOT_LINKED: name the person (your account is not linked to a roster entry)' using errcode = 'OM001';
  end if;
  if who <> coalesce(me, '') and not sched and not coord then
    raise exception 'MODE_NOT_YOURS: only the scheduler or the office can set another surgeon''s mode' using errcode = 'OM002';
  end if;
  -- The office relays for a roster id only (review of Prompt 16 A7): call_offers.person_id has no foreign key, so a
  -- hand-made call could otherwise leave offer_modes keys for nobody. The scheduler's relay is unchanged.
  if coord and not exists (select 1 from public.call_schedule_data d, jsonb_array_elements(case when jsonb_typeof(d.data -> 'roster') = 'array' then d.data -> 'roster' else '[]'::jsonb end) r where d.id = 'main' and r ->> 'id' = who) then
    raise exception 'MODE_UNKNOWN_PERSON: % is not a roster id - the office relays for a roster surgeon only', who using errcode = 'OM007';
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
                            'rules_only_ids', p.rules_only_ids, 'offer_modes', p.offer_modes, 'by', coalesce(me, case when sched then 'scheduler' else auth.uid()::text end));
end $$;
revoke all on function public.set_offer_mode(uuid, text, text) from public;
revoke all on function public.set_offer_mode(uuid, text, text) from anon;
grant execute on function public.set_offer_mode(uuid, text, text) to authenticated;
comment on function public.set_offer_mode(uuid, text, text) is 'Prompt 14 part 3a (+ Prompt 16 A7): one person''s offer mode on one period (exhaustive / preferred -> offer_modes[person], off rules_only_ids; rules_only -> on rules_only_ids, key dropped; refused with offers inside the period). Security definer because surgeons cannot write call_periods; a non-scheduler may only set their own - or, as a coordinator, another ROSTER person''s (OM007 otherwise) - and only before the freeze.';

create or replace function public.save_offers(p_person text, p_rows jsonb, p_clear date[], p_period uuid default null, p_mode text default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  me        text := public.silvis_person_id();
  sched     boolean := public.silvis_is_sched();
  coord     boolean := public.silvis_is_coord();
  who       text := nullif(btrim(p_person), '');
  v_by      text;
  v_src     text;
  n_up      integer := 0;
  n_del     integer := 0;
  bad       text;
begin
  if auth.uid() is null or (me is null and not sched and not coord) then
    raise exception 'OFFERS_NOT_LINKED: sign in with an account that is linked to a roster entry to save offers' using errcode = 'OS001';
  end if;
  who := coalesce(who, me);
  if who is null then
    raise exception 'OFFERS_NOT_LINKED: name the person (your account is not linked to a roster entry)' using errcode = 'OS001';
  end if;
  if who <> coalesce(me, '') and not sched and not coord then
    raise exception 'OFFERS_NOT_YOURS: only the scheduler or the office can save another surgeon''s offers' using errcode = 'OS002';
  end if;
  -- The office relays for a roster id only (review of Prompt 16 A7): call_offers.person_id has no foreign key, so a
  -- hand-made call could otherwise leave orphan offer rows. The scheduler's relay is unchanged. Checked before any write.
  if coord and not exists (select 1 from public.call_schedule_data d, jsonb_array_elements(case when jsonb_typeof(d.data -> 'roster') = 'array' then d.data -> 'roster' else '[]'::jsonb end) r where d.id = 'main' and r ->> 'id' = who) then
    raise exception 'OFFERS_UNKNOWN_PERSON: % is not a roster id - the office relays for a roster surgeon only', who using errcode = 'OS004';
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
  if me is not null and who = me then v_by := me; v_src := 'app'; elsif sched then v_by := 'scheduler'; v_src := 'email-relay'; else v_by := auth.uid()::text; v_src := 'office-relay'; end if;

  -- A coordinator's rows pass the call_offers policies only inside this call (Prompt 16 A7): the transaction-local
  -- flag is what the policies' coordinator clause reads; it never exists outside save_offers.
  if coord then perform set_config('silvis.office_relay', 'on', true); end if;

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
  if coord then perform set_config('silvis.office_relay', '', true); end if;

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
comment on function public.save_offers(text, jsonb, date[], uuid, text) is 'Prompt 14 part 3a (+ Prompt 16 A7): the offer painter''s one Save - upserts + deletes (+ the period mode through set_offer_mode when p_mode is given) in ONE transaction as the caller (security invoker: RLS + OF001/OF002/OF003 apply per row; nothing bypassed - a coordinator''s rows pass the policies through the transaction-local silvis.office_relay flag this function sets). entered_by / source come from the caller identity (own id / app; scheduler / email-relay; the coordinator''s profile id / office-relay - for a roster id only, OS004 otherwise); a row sent without a note keeps its note. The client writes the audit row offers.save after ok.';

-- e) notifications + audit_log
drop policy if exists notif_insert on public.notifications;
create policy notif_insert on public.notifications for insert to authenticated
  with check (public.silvis_is_sched() or public.silvis_person_id() is not null or public.silvis_is_coord());
drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log for insert to authenticated
  with check (public.silvis_is_sched() or (public.silvis_person_id() is not null and actor_id = public.silvis_person_id()) or (public.silvis_is_coord() and actor_id = auth.uid()::text));
drop policy if exists audit_read_coord on public.audit_log;
create policy audit_read_coord on public.audit_log for select to authenticated
  using (public.silvis_is_coord() and actor_id = auth.uid()::text and (action like 'timeoff.%' or action like 'offers.%' or action like 'availability.%'));
